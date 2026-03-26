"""
Room Worker — owns game-loop state and processes all room commands.

Every public game operation is a *command* dispatched via ``execute()``.
The result is a ``CommandResult`` containing:
  • ``result``     – JSON-serialisable dict returned to the HTTP caller
  • ``broadcasts`` – list of messages the gateway should push to the room's WS clients
  • ``error`` / ``status_code`` – set when the command fails

The route layer (``routes/engine.py``) becomes a thin HTTP adapter: parse the
request, call ``bus.send_command()``, send broadcasts, return the result.
"""

import json
import asyncio
from typing import Optional, Dict, Any
from datetime import datetime

from bus import CommandResult
from db import db
from ws import flush_events
from engine import game_loop
from engine.constants import SP_DURATION_H, GB_PHASE_TABLE
from engine.market_engine import clear_bm, compute_forecasts
from engine.da_curve_engine import clear_full_auction
from engine.leaderboard_engine import build_leaderboard, build_round_debrief
from engine.achievements import build_achievement_stats, check_achievements


class RoomWorker:
    """Processes game commands for all rooms (single-process deployment).

    When the architecture moves to isolated room processes (Step 4) each
    subprocess will host its own ``RoomWorker`` instance handling only one room.
    """

    def __init__(self):
        self._advance_locks: Dict[str, asyncio.Lock] = {}

    # ── helpers ──────────────────────────────────────────────────────────

    def _get_advance_lock(self, room_id: str) -> asyncio.Lock:
        lock = self._advance_locks.get(room_id)
        if lock is None:
            lock = asyncio.Lock()
            self._advance_locks[room_id] = lock
        return lock

    @staticmethod
    def _validate_precondition(rs: dict, data: Optional[dict]) -> Optional[str]:
        """Reject stale client advances so retries cannot skip phases/SPs."""
        if not data:
            return None
        expected_phase = data.get("expectedDayPhase") or data.get("expectedPhase")
        expected_sp = data.get("expectedSp")
        expected_bm = data.get("expectedBmSubPhase")

        if expected_phase is not None and expected_phase != rs.get("dayPhase"):
            return f"stale phase (expected {expected_phase}, current {rs.get('dayPhase')})"
        if expected_sp is not None and rs.get("dayPhase") == "REALTIME":
            if int(expected_sp) != int(rs.get("currentSp") or 0):
                return f"stale sp (expected {expected_sp}, current {rs.get('currentSp')})"
        if expected_bm is not None and expected_bm != rs.get("bmSubPhase"):
            return f"stale bmSubPhase (expected {expected_bm}, current {rs.get('bmSubPhase')})"
        return None

    # ── dispatch ─────────────────────────────────────────────────────────

    async def execute(
        self, room_id: str, command: str, data: dict | None = None
    ) -> CommandResult:
        handler = getattr(self, f"_cmd_{command}", None)
        if handler is None:
            return CommandResult(error=f"Unknown command: {command}", status_code=400)
        try:
            return await handler(room_id, data or {})
        except Exception as exc:
            return CommandResult(error=str(exc), status_code=500)

    # ═══════════════════════════════════════════════════════════════════
    # COMMANDS
    # ═══════════════════════════════════════════════════════════════════

    async def _cmd_register(self, room_id: str, data: dict) -> CommandResult:
        player_id = data.get("playerId")
        if not player_id:
            return CommandResult(error="playerId required", status_code=400)
        result = game_loop.register_player(room_id, player_id, data)
        return CommandResult(result=result)

    # ── state retrieval (with cold-start recovery) ──────────────────────

    async def _cmd_get_state(self, room_id: str, data: dict) -> CommandResult:
        cold_start = room_id not in game_loop._room_states
        if cold_start:
            try:
                event_rows = await db.query(
                    "SELECT sequence, occurred_at, event_type, data FROM event_log "
                    "WHERE room_id = $1 ORDER BY sequence ASC",
                    room_id,
                )
                if event_rows:
                    events = [
                        {
                            "sequence": r["sequence"],
                            "occurred_at": r.get("occurred_at"),
                            "event_type": r["event_type"],
                            "data": (
                                r["data"]
                                if isinstance(r["data"], dict)
                                else json.loads(r["data"])
                            ),
                        }
                        for r in event_rows
                    ]
                    room_rows = await db.query(
                        "SELECT scenario_id FROM rooms WHERE room_id = $1", room_id
                    )
                    scenario_id = (
                        dict(room_rows[0]).get("scenario_id", "NORMAL")
                        if room_rows
                        else "NORMAL"
                    )
                    player_rows = await db.query(
                        "SELECT player_id, name, role, asset, cash, da_cash, sof "
                        "FROM players WHERE room_id = $1",
                        room_id,
                    )
                    players = [dict(r) for r in player_rows]
                    game_loop.replay_from_events(room_id, players, events, scenario_id)
                    state = game_loop.get_room_state(room_id)
                    state["_recovered"] = True
                    state["_eventLogMaxSeq"] = events[-1]["sequence"]
                    return CommandResult(result=state)
            except Exception as replay_err:
                print(f"[cold-start] replay failed for {room_id!r}: {replay_err}")
        return CommandResult(result=game_loop.get_room_state(room_id))

    # ── player ready ────────────────────────────────────────────────────

    async def _cmd_player_ready(self, room_id: str, data: dict) -> CommandResult:
        pid = data.get("playerId")
        phase = data.get("phase")
        role = data.get("role", "")
        name = data.get("name", pid or "")

        if not pid or not phase:
            return CommandResult(error="playerId and phase required", status_code=400)

        rs = game_loop._get_room(room_id)
        if phase != rs.get("dayPhase"):
            return CommandResult(result={"success": True, "ignored": True, "reason": "stale phase"})

        rs["playerReady"][pid] = {
            "phase": phase,
            "role": role,
            "name": name,
            "ts": int(datetime.now().timestamp() * 1000),
        }

        observer_roles = {"NESO", "ELEXON"}
        all_players = {
            k: v
            for k, v in rs["playerStates"].items()
            if v.get("role") not in observer_roles
        }
        current_ready = {
            k: v
            for k, v in rs["playerReady"].items()
            if v.get("phase") == rs["dayPhase"]
        }
        readiness = {
            p: {
                "name": all_players[p].get("name", p) if p in all_players else name,
                "role": all_players[p].get("role", role) if p in all_players else role,
                "ready": p in current_ready,
                "readyTs": current_ready.get(p, {}).get("ts"),
            }
            for p in (set(all_players) | {pid})
        }
        all_ready = len(all_players) > 0 and all(p in current_ready for p in all_players)

        return CommandResult(
            result={"success": True, "allReady": all_ready},
            broadcasts=[
                {
                    "type": "player_ready_update",
                    "data": {
                        "phase": rs["dayPhase"],
                        "readiness": readiness,
                        "allReady": all_ready,
                        "readyCount": len(current_ready),
                        "totalCount": len(all_players),
                    },
                }
            ],
        )

    # ── market generation ───────────────────────────────────────────────

    async def _cmd_generate_market(self, room_id: str, data: dict) -> CommandResult:
        sp = data.get("sp")
        market = game_loop.generate_market(room_id, sp)
        return CommandResult(
            result=market,
            broadcasts=[{"type": "market", "data": market}],
        )

    # ── phase advance (legacy single-step) ──────────────────────────────

    async def _cmd_advance_phase(self, room_id: str, data: dict) -> CommandResult:
        result = game_loop.advance_phase(room_id)
        rs = game_loop._get_room(room_id)
        await db.execute(
            "UPDATE rooms SET phase = $1, sp = $2, last_active = CURRENT_TIMESTAMP WHERE room_id = $3",
            rs["dayPhase"],
            rs["currentSp"],
            room_id,
        )
        return CommandResult(
            result=result,
            broadcasts=[{"type": "phase_change", "data": result}],
        )

    # ── advance day phase ───────────────────────────────────────────────

    async def _cmd_advance_day(self, room_id: str, data: dict) -> CommandResult:
        lock = self._get_advance_lock(room_id)
        async with lock:
            rs = game_loop._get_room(room_id)
            err = self._validate_precondition(rs, data)
            if err:
                return CommandResult(error=err, status_code=409)

            # On ID→REALTIME transition, reload ID bids from DB
            if rs.get("dayPhase") == "ID_ROUNDS":
                id_rows = await db.query(
                    "SELECT player_id, sp, side, mw, price FROM id_bids WHERE room_id = $1",
                    room_id,
                )
                orders_by_player: dict = {}
                for row in id_rows:
                    pid = row["player_id"]
                    orders_by_player.setdefault(pid, []).append(
                        {
                            "sp": row["sp"],
                            "side": row["side"],
                            "mw": float(row["mw"]),
                            "price": float(row["price"]),
                        }
                    )
                for pid, orders in orders_by_player.items():
                    game_loop.submit_id_orders(room_id, pid, orders)

            result = game_loop.advance_day_phase(room_id)
            rs = game_loop._get_room(room_id)
            now_ts = int(rs.get("phaseStartTs") or int(datetime.now().timestamp() * 1000))

            # Flush event log (fire-and-forget)
            pending = list(rs.get("_pendingEvents", []))
            rs["_pendingEvents"] = []
            asyncio.ensure_future(flush_events(room_id, pending))

            db_sp = max(1, rs["currentSp"])
            await db.execute(
                "UPDATE rooms SET phase = $1, sp = $2, phase_start_ts = $3, last_active = CURRENT_TIMESTAMP WHERE room_id = $4",
                rs["dayPhase"],
                db_sp,
                now_ts,
                room_id,
            )

            fus = result.get("forecastUpdateSummary")
            pf = game_loop.get_room_state(room_id).get("publishedForecast")
            current_sp = max(1, rs["currentSp"])
            current_market = rs["markets"].get(current_sp)
            broadcast_data = {
                **result,
                "dayPhase": rs["dayPhase"],
                "currentSp": rs["currentSp"],
                "bmSubPhase": rs["bmSubPhase"],
                "phaseStartTs": now_ts,
                "forecastUpdateSummary": fus,
                "publishedForecast": pf,
                "currentMarket": current_market,
                "phaseInfo": GB_PHASE_TABLE.get(rs["dayPhase"]),
            }
            if result.get("marketsGenerated") or result.get("marketsUpdated"):
                broadcast_data["markets"] = rs["markets"]

            broadcasts = [{"type": "day_phase_change", "data": broadcast_data}]

            # Leaderboard broadcast
            try:
                players_rows = await db.query(
                    "SELECT * FROM players WHERE room_id = $1", room_id
                )
                lb_players = [
                    {
                        "id": dict(r)["player_id"],
                        "name": dict(r).get("name", ""),
                        "role": dict(r).get("role", ""),
                        "roleScore": dict(r).get("role_score") or 0,
                        "systemScore": dict(r).get("system_score") or 0,
                        "overallScore": dict(r).get("overall_score") or 0,
                        "cash": dict(r).get("cash") or 0,
                    }
                    for r in players_rows
                ]
                lb = build_leaderboard(lb_players)
                broadcasts.append({"type": "leaderboard", "data": lb})
            except Exception:
                pass

            return CommandResult(
                result={**result, "dayPhase": rs["dayPhase"], "currentSp": rs["currentSp"], "bmSubPhase": rs["bmSubPhase"], "phaseStartTs": now_ts},
                broadcasts=broadcasts,
            )

    # ── advance BM (within REALTIME) ────────────────────────────────────

    async def _cmd_advance_bm(self, room_id: str, data: dict) -> CommandResult:
        lock = self._get_advance_lock(room_id)
        async with lock:
            rs = game_loop._get_room(room_id)
            err = self._validate_precondition(rs, data)
            if err:
                return CommandResult(error=err, status_code=409)

            result = game_loop.advance_bm(room_id)
            now_ts = int(datetime.now().timestamp() * 1000)
            rs = game_loop._get_room(room_id)

            # Flush event log
            pending = list(rs.get("_pendingEvents", []))
            rs["_pendingEvents"] = []
            asyncio.ensure_future(flush_events(room_id, pending))

            await db.execute(
                "UPDATE rooms SET phase = $1, sp = $2, phase_start_ts = $3, last_active = CURRENT_TIMESTAMP WHERE room_id = $4",
                rs["dayPhase"],
                rs["currentSp"],
                now_ts,
                room_id,
            )

            settlement_map = result.get("settlement") or {}
            player_updates: dict = {}
            for pid, ps in rs["playerStates"].items():
                sp_settle = settlement_map.get(pid) or {}
                player_updates[pid] = {
                    "cash": ps.get("cash", 0),
                    "daCash": ps.get("daCash", 0),
                    "soc": ps.get("soc", 50),
                    "roleScore": ps.get("roleScore"),
                    "systemScore": ps.get("systemScore"),
                    "overallScore": ps.get("overallScore"),
                    "deviation": sp_settle.get("deviation"),
                    "imbalancePenalty": sp_settle.get("imbalancePenalty"),
                    "cashDelta": sp_settle.get("cashDelta"),
                    "bsuosCharge": sp_settle.get("bsuosCharge"),
                    "bmAccMw": sp_settle.get("bmAccMw"),
                    "contractPosMw": sp_settle.get("contractPosMw"),
                    "actualPhysical": sp_settle.get("actualPhysical"),
                }

            broadcast_data = {
                **result,
                "dayPhase": rs["dayPhase"],
                "currentSp": rs["currentSp"],
                "bmSubPhase": rs["bmSubPhase"],
                "phaseStartTs": now_ts,
                "playerUpdates": player_updates,
                "phaseInfo": GB_PHASE_TABLE.get(rs["dayPhase"]),
            }
            broadcasts = [{"type": "bm_advance", "data": broadcast_data}]

            settlement = result.get("settlement")
            if settlement:
                broadcasts.append(
                    {
                        "type": "server_settlement",
                        "sp": result.get("sp"),
                        "data": settlement,
                    }
                )

            # Achievement check after settlement
            if rs.get("bmSubPhase") == "SP_SETTLED" or result.get("bmSubPhase") == "SP_SETTLED":
                try:
                    achievement_updates: dict = {}
                    for pid, ps in rs.get("playerStates", {}).items():
                        sp_hist = ps.get("spHistory", [])
                        if not sp_hist:
                            continue
                        stats = build_achievement_stats(
                            {
                                "spHistory": sp_hist,
                                "cash": ps.get("cash", 0),
                                "daCash": ps.get("daCash", 0),
                                "assetKey": ps.get("asset"),
                                "assetKind": ps.get("assetKind"),
                                "scenario": rs.get("scenarioId", "NORMAL"),
                                "soc": ps.get("soc", 50),
                                "freqBreachSec": 0,
                            }
                        )
                        already = [
                            a["id"] if isinstance(a, dict) else a
                            for a in ps.get("achievements", [])
                        ]
                        newly = check_achievements(stats, already)
                        if newly:
                            achievement_updates[pid] = [
                                a["id"] if isinstance(a, dict) else a["id"]
                                for a in newly
                            ]
                    if achievement_updates:
                        broadcasts.append({"type": "achievements", "data": achievement_updates})
                except Exception:
                    pass

            return CommandResult(
                result={**result, "dayPhase": rs["dayPhase"], "currentSp": rs["currentSp"], "bmSubPhase": rs["bmSubPhase"], "phaseStartTs": now_ts},
                broadcasts=broadcasts,
            )

    # ── unified advance (routes internally) ─────────────────────────────

    async def _cmd_advance_game(self, room_id: str, data: dict) -> CommandResult:
        """Unified advance — single entry point for NESO / Instructor clicks.

        Routes to the correct handler:
          - REALTIME → advance_bm
          - ID_ROUNDS → gate-closure sub-round (then REALTIME)
          - All other day phases → advance_day_phase
        """
        lock = self._get_advance_lock(room_id)
        async with lock:
            rs = game_loop._get_room(room_id)
            err = self._validate_precondition(rs, data)
            if err:
                return CommandResult(error=err, status_code=409)

            phase_before = rs.get("dayPhase")

            # Reload ID bids if we're about to close an ID round
            if phase_before == "ID_ROUNDS":
                try:
                    id_rows = await db.query(
                        "SELECT player_id, sp, side, mw, price FROM id_bids WHERE room_id = $1",
                        room_id,
                    )
                    orders_by_player: dict = {}
                    for row in id_rows:
                        pid = row["player_id"]
                        orders_by_player.setdefault(pid, []).append(
                            {
                                "sp": row["sp"],
                                "side": row["side"],
                                "mw": float(row["mw"]),
                                "price": float(row["price"]),
                            }
                        )
                    for pid, orders in orders_by_player.items():
                        game_loop.submit_id_orders(room_id, pid, orders)
                except Exception:
                    pass  # table may not exist yet

            result = game_loop.advance_game(room_id)
            now_ts = int(datetime.now().timestamp() * 1000)
            rs = game_loop._get_room(room_id)

            # Flush event log
            pending = list(rs.get("_pendingEvents", []))
            rs["_pendingEvents"] = []
            asyncio.ensure_future(flush_events(room_id, pending))

            db_sp = max(1, rs["currentSp"])
            await db.execute(
                "UPDATE rooms SET phase = $1, sp = $2, phase_start_ts = $3, last_active = CURRENT_TIMESTAMP WHERE room_id = $4",
                rs["dayPhase"],
                db_sp,
                now_ts,
                room_id,
            )

            # Build broadcast payload
            fus = result.get("forecastUpdateSummary")
            pf = game_loop.get_room_state(room_id).get("publishedForecast")
            current_sp = max(1, rs["currentSp"])
            current_market = rs["markets"].get(current_sp)
            settlement_map = result.get("settlement") or {}

            # Per-player state updates (for BM settlement broadcasting)
            player_updates: dict = {}
            for pid, ps in rs["playerStates"].items():
                sp_settle = settlement_map.get(pid) or {}
                player_updates[pid] = {
                    "cash": ps.get("cash", 0),
                    "daCash": ps.get("daCash", 0),
                    "soc": ps.get("soc", 50),
                    "roleScore": ps.get("roleScore"),
                    "systemScore": ps.get("systemScore"),
                    "overallScore": ps.get("overallScore"),
                    "deviation": sp_settle.get("deviation"),
                    "imbalancePenalty": sp_settle.get("imbalancePenalty"),
                    "cashDelta": sp_settle.get("cashDelta"),
                    "bsuosCharge": sp_settle.get("bsuosCharge"),
                    "bmAccMw": sp_settle.get("bmAccMw"),
                    "contractPosMw": sp_settle.get("contractPosMw"),
                    "actualPhysical": sp_settle.get("actualPhysical"),
                }

            broadcast_data = {
                **result,
                "dayPhase": rs["dayPhase"],
                "currentSp": rs["currentSp"],
                "bmSubPhase": rs["bmSubPhase"],
                "phaseStartTs": now_ts,
                "tickSpeed": rs.get("tickSpeed"),
                "forecastUpdateSummary": fus,
                "publishedForecast": pf,
                "currentMarket": current_market,
                "phaseInfo": GB_PHASE_TABLE.get(rs["dayPhase"]),
                "playerUpdates": player_updates,
                "spTimeline": rs.get("spTimeline", {}),
                "idRound": rs.get("idRound", 0),
            }
            if result.get("marketsGenerated") or result.get("marketsUpdated"):
                broadcast_data["markets"] = rs["markets"]

            # Use day_phase_change for day-level, bm_advance for REALTIME
            if rs["dayPhase"] == "REALTIME" and phase_before == "REALTIME":
                bcast_type = "bm_advance"
            else:
                bcast_type = "day_phase_change"

            broadcasts = [{"type": bcast_type, "data": broadcast_data}]

            if settlement_map:
                broadcasts.append(
                    {"type": "server_settlement", "sp": result.get("sp"), "data": settlement_map}
                )

            # Leaderboard on day-level changes
            if bcast_type == "day_phase_change":
                try:
                    players_rows = await db.query(
                        "SELECT * FROM players WHERE room_id = $1", room_id
                    )
                    lb_players = [
                        {
                            "id": dict(r)["player_id"],
                            "name": dict(r).get("name", ""),
                            "role": dict(r).get("role", ""),
                            "roleScore": dict(r).get("role_score") or 0,
                            "systemScore": dict(r).get("system_score") or 0,
                            "overallScore": dict(r).get("overall_score") or 0,
                            "cash": dict(r).get("cash") or 0,
                        }
                        for r in players_rows
                    ]
                    lb = build_leaderboard(lb_players)
                    broadcasts.append({"type": "leaderboard", "data": lb})
                except Exception:
                    pass

            return CommandResult(
                result={
                    **result,
                    "dayPhase": rs["dayPhase"],
                    "currentSp": rs["currentSp"],
                    "bmSubPhase": rs["bmSubPhase"],
                    "phaseStartTs": now_ts,
                    "tickSpeed": rs.get("tickSpeed"),
                    "spTimeline": rs.get("spTimeline", {}),
                    "idRound": rs.get("idRound", 0),
                },
                broadcasts=broadcasts,
            )

    # ── BM clearing ─────────────────────────────────────────────────────

    async def _cmd_clear_bm(self, room_id: str, data: dict) -> CommandResult:
        async with self._get_advance_lock(room_id):
            return await self._cmd_clear_bm_inner(room_id, data)

    async def _cmd_clear_bm_inner(self, room_id: str, data: dict) -> CommandResult:
        rs = game_loop._get_room(room_id)
        sp = rs["currentSp"] or 1
        market = rs["markets"].get(sp)
        if not market:
            game_loop.generate_all_markets(room_id)
            market = rs["markets"].get(sp, {})

        bids_rows = await db.query(
            "SELECT * FROM bm_bids WHERE room_id = $1 AND sp = $2", room_id, sp
        )
        bids = [dict(row) for row in bids_rows]
        actual = market.get("actual", {})
        bm_result = clear_bm(bids, actual)

        for accepted in bm_result.get("accepted", []):
            pid = accepted.get("player_id")
            if pid:
                revenue = accepted.get("revenue", 0)
                await db.execute(
                    "UPDATE players SET cash = cash + $1, updated_at = CURRENT_TIMESTAMP "
                    "WHERE player_id = $2 AND room_id = $3",
                    revenue,
                    pid,
                    room_id,
                )

        return CommandResult(
            result=bm_result,
            broadcasts=[{"type": "bm_clear", "data": bm_result}],
        )

    # ── DA clearing ─────────────────────────────────────────────────────

    async def _cmd_clear_da(self, room_id: str, data: dict) -> CommandResult:
        async with self._get_advance_lock(room_id):
            return await self._cmd_clear_da_inner(room_id, data)

    async def _cmd_clear_da_inner(self, room_id: str, data: dict) -> CommandResult:
        rs = game_loop._get_room(room_id)
        if not rs["markets"]:
            game_loop.generate_all_markets(room_id)

        da_result = game_loop._on_da_close_all(rs)
        all_results = da_result.get("daResults", {})
        for sp_key, sp_result in all_results.items():
            for accepted in sp_result.get("accepted_bids", []):
                pid = accepted.get("id") or accepted.get("player_id")
                if pid:
                    revenue = accepted.get("revenue", 0)
                    await db.execute(
                        "UPDATE players SET da_cash = da_cash + $1, cash = cash + $1, "
                        "updated_at = CURRENT_TIMESTAMP WHERE player_id = $2 AND room_id = $3",
                        revenue,
                        pid,
                        room_id,
                    )

        return CommandResult(
            result=da_result,
            broadcasts=[{"type": "da_clear", "data": da_result}],
        )

    # ── DA-curve clearing ───────────────────────────────────────────────

    async def _cmd_clear_da_curves(self, room_id: str, data: dict) -> CommandResult:
        async with self._get_advance_lock(room_id):
            return await self._cmd_clear_da_curves_inner(room_id, data)

    async def _cmd_clear_da_curves_inner(self, room_id: str, data: dict) -> CommandResult:
        rs = game_loop._get_room(room_id)

        curves_rows = await db.query(
            "SELECT * FROM da_curves WHERE room_id = $1", room_id
        )
        player_curves = []
        for row in curves_rows:
            row_dict = dict(row)
            segments = row_dict.get("segments")
            if isinstance(segments, str):
                segments = json.loads(segments)
            blocks = row_dict.get("blocks")
            if isinstance(blocks, str):
                blocks = json.loads(blocks)
            player_curves.append(
                {
                    "playerId": row_dict["player_id"],
                    "segments": segments or [],
                    "side": row_dict.get("side", "sell"),
                    "blocks": blocks or [],
                }
            )

        market_ctx_array = None
        if rs.get("publishedForecast"):
            pf = rs["publishedForecast"]
            demand = pf.get("demand", [0] * 48)
            market_ctx_array = [
                {"demandMW": demand[i] if i < len(demand) else 300, "forecastPrice": 50}
                for i in range(48)
            ]

        result = clear_full_auction(player_curves, market_ctx_array)

        for pid, vols in result.get("volumes", {}).items():
            total_rev = sum(
                (abs(v) * result["prices"][i] * SP_DURATION_H) * (-1 if v >= 0 else 1)
                for i, v in enumerate(vols)
            )
            if total_rev != 0:
                await db.execute(
                    "UPDATE players SET da_cash = da_cash + $1, cash = cash + $1, "
                    "updated_at = CURRENT_TIMESTAMP WHERE player_id = $2 AND room_id = $3",
                    total_rev,
                    pid,
                    room_id,
                )

        return CommandResult(
            result=result,
            broadcasts=[{"type": "da_curve_clear", "data": result}],
        )

    # ── IDA bid ─────────────────────────────────────────────────────────

    async def _cmd_ida_bid(self, room_id: str, data: dict) -> CommandResult:
        player_id = data.get("playerId")
        bids = data.get("bids", [])
        if not bids and data.get("bid"):
            bids = [data["bid"]]
        ida_round = data.get("idaRound", "").upper()
        if ida_round not in ("IDA1", "IDA2"):
            return CommandResult(error=f"Unknown IDA round: {ida_round}", status_code=400)
        # Gate closure: reject bids outside the IDA phase
        rs = game_loop._get_room(room_id)
        if rs.get("dayPhase") != ida_round:
            return CommandResult(
                error=f"Gate closed for {ida_round} bids in phase {rs.get('dayPhase')}",
                status_code=403,
            )
        result = game_loop.submit_ida_bids(room_id, ida_round, player_id, bids)
        return CommandResult(
            result=result,
            broadcasts=[{
                "type": f"{ida_round.lower()}_bid",
                "playerId": player_id,
                "data": result,
            }],
        )

    # ── IDA clear ───────────────────────────────────────────────────────

    async def _cmd_ida_clear(self, room_id: str, data: dict) -> CommandResult:
        async with self._get_advance_lock(room_id):
            return await self._cmd_ida_clear_inner(room_id, data)

    async def _cmd_ida_clear_inner(self, room_id: str, data: dict) -> CommandResult:
        ida_round = data.get("idaRound", "").upper()
        if ida_round not in ("IDA1", "IDA2"):
            return CommandResult(error=f"Unknown IDA round: {ida_round}", status_code=400)
        rs = game_loop._get_room(room_id)
        result = game_loop._on_ida_close_all(rs, ida_round)
        return CommandResult(
            result=result,
            broadcasts=[{"type": f"{ida_round.lower()}_clear", "data": result}],
        )

    # ── IDA forecast ────────────────────────────────────────────────────

    async def _cmd_ida_forecast(self, room_id: str, data: dict) -> CommandResult:
        from engine.market_engine import ida_forecast as ida_fc
        from engine.constants import IDA_CONFIG

        ida_round = data.get("idaRound", "").upper()
        cfg = IDA_CONFIG.get(ida_round, {})
        err_reduction = cfg.get("forecastErrorReduction", 0.5)
        rs = game_loop._get_room(room_id)
        if not rs.get("markets"):
            return CommandResult(error="No markets generated yet", status_code=400)
        forecasts = {}
        for sp, market in rs["markets"].items():
            forecasts[sp] = ida_fc(market, err_reduction)
        return CommandResult(result=forecasts)

    # ── ID submit ───────────────────────────────────────────────────────

    async def _cmd_id_submit(self, room_id: str, data: dict) -> CommandResult:
        player_id = data.get("playerId")
        orders = data.get("orders", [])
        result = game_loop.submit_id_orders(room_id, player_id, orders)
        return CommandResult(result=result)

    # ── ID clear ────────────────────────────────────────────────────────

    async def _cmd_id_clear(self, room_id: str, data: dict) -> CommandResult:
        async with self._get_advance_lock(room_id):
            return await self._cmd_id_clear_inner(room_id, data)

    async def _cmd_id_clear_inner(self, room_id: str, data: dict) -> CommandResult:
        rs = game_loop._get_room(room_id)
        result = game_loop._on_id_close(rs)
        return CommandResult(
            result=result,
            broadcasts=[{"type": "id_clear", "data": result}],
        )

    # ── settlement ──────────────────────────────────────────────────────

    async def _cmd_settle(self, room_id: str, data: dict) -> CommandResult:
        async with self._get_advance_lock(room_id):
            return await self._cmd_settle_inner(room_id, data)

    async def _cmd_settle_inner(self, room_id: str, data: dict) -> CommandResult:
        result = game_loop.settle_current_sp(room_id)
        settlements = result.get("settlements", {})

        for pid, s in settlements.items():
            await db.execute(
                """UPDATE players
                   SET cash = $1,
                       role_score = COALESCE($2, role_score),
                       system_score = COALESCE($3, system_score),
                       overall_score = COALESCE($4, overall_score),
                       updated_at = CURRENT_TIMESTAMP
                   WHERE player_id = $5 AND room_id = $6""",
                s.get("cash", 0),
                s.get("roleScore"),
                s.get("systemScore"),
                s.get("overallScore"),
                pid,
                room_id,
            )

        return CommandResult(
            result=settlements,
            broadcasts=[{"type": "settlement", "data": settlements}],
        )

    # ── forecasts ───────────────────────────────────────────────────────

    async def _cmd_get_forecasts(self, room_id: str, data: dict) -> CommandResult:
        rs = game_loop._get_room(room_id)
        forecasts = compute_forecasts(
            rs.get("currentSp", 0),
            rs.get("scenarioId", "NORMAL"),
            rs.get("publishedForecast"),
        )
        return CommandResult(result={"forecasts": forecasts})

    async def _cmd_publish_forecast(self, room_id: str, data: dict) -> CommandResult:
        result = game_loop.publish_forecast(room_id, data if data else None)
        return CommandResult(
            result=result,
            broadcasts=[{"type": "forecast", "data": result}],
        )

    # ── config ──────────────────────────────────────────────────────────

    async def _cmd_set_config(self, room_id: str, data: dict) -> CommandResult:
        result = game_loop.set_room_config(room_id, data)
        if "scenarioId" in data:
            await db.execute(
                "UPDATE rooms SET scenario_id = $1 WHERE room_id = $2",
                data["scenarioId"],
                room_id,
            )
        if "tickSpeed" in data:
            await db.execute(
                "UPDATE rooms SET tick_speed = $1 WHERE room_id = $2",
                data["tickSpeed"],
                room_id,
            )
        if "paused" in data:
            await db.execute(
                "UPDATE rooms SET paused = $1 WHERE room_id = $2",
                data["paused"],
                room_id,
            )
        return CommandResult(
            result=result,
            broadcasts=[{"type": "config", "data": data}],
        )

    # ── leaderboard ─────────────────────────────────────────────────────

    async def _cmd_get_leaderboard(self, room_id: str, data: dict) -> CommandResult:
        players_rows = await db.query(
            "SELECT * FROM players WHERE room_id = $1", room_id
        )
        players = [
            {
                "id": dict(row)["player_id"],
                "name": dict(row).get("name", ""),
                "role": dict(row).get("role", "GENERATOR"),
                "roleScore": dict(row).get("role_score", 0),
                "systemScore": dict(row).get("system_score", 0),
                "overallScore": dict(row).get("overall_score", 0),
                "cash": dict(row).get("cash", 0),
            }
            for row in players_rows
        ]
        leaderboard = build_leaderboard(players)
        rs = game_loop._get_room(room_id)
        debrief = build_round_debrief(leaderboard, rs.get("systemState", {}))
        return CommandResult(result={"leaderboard": leaderboard, "debrief": debrief})

    # ── achievements ────────────────────────────────────────────────────

    async def _cmd_get_achievements(self, room_id: str, data: dict) -> CommandResult:
        player_id = data.get("playerId", "")
        rs = game_loop._get_room(room_id)
        ps = rs.get("playerStates", {}).get(player_id, {})
        stats = build_achievement_stats(
            {
                "spHistory": ps.get("spHistory", []),
                "cash": ps.get("cash", 0),
                "daCash": ps.get("daCash", 0),
                "assetKey": ps.get("asset", ""),
                "assetKind": "",
                "scenario": rs.get("scenarioId", "NORMAL"),
                "soc": ps.get("soc", 50),
                "freqBreachSec": 0,
            }
        )
        earned = ps.get("achievements", [])
        newly_earned = check_achievements(stats, earned)
        return CommandResult(
            result={"stats": stats, "newlyEarned": newly_earned, "alreadyEarned": earned}
        )
