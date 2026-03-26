"""
GridForge Game Loop — server-authoritative market and dispatch state machine,
aligned with GB short-term power markets.

Structure (one delivery day D):

  Day-level trading phases (all 48 SPs traded in parallel):
    FORECAST_0 → DA → FORECAST_1 → IDA1 → FORECAST_2 → IDA2 → ID_ROUNDS

  Real-time balancing phase (SP-by-SP dispatch):
    REALTIME → for SP 1..48:  BM_OPEN → BM_CLEAR → SP_SETTLED

  End-of-day and rollover:
    RESULTS → FORECAST_0 (next day)

Semantics:
  FORECAST_0 / _1 / _2 are progressively more accurate forecast updates
  shown between trading stages. Uncertainty collapses as the day approaches.

  DA / IDA1 / IDA2 are discrete auctions where players build and adjust
  positions for every Settlement Period of delivery day D.

  ID_ROUNDS represents continuous intraday trading in a small number of
  rounds where only near-term SPs are tradable (gate closure per SP).

  BM_OPEN → BM_CLEAR → SP_SETTLED is the real-time, per-SP mechanism:
  the system operator accepts balancing bids/offers, computes NIV and
  system prices, and settles imbalances for that SP.
"""

from __future__ import annotations
from typing import Any
import os
import copy
import time
import json

from .constants import (
    ASSETS, SP_DURATION_H, SPS_PER_DAY, FORGIVENESS, SCORING_CONFIG,
    GAME_MODES, CASHOUT_MODE, IDA_CONFIG,
    GB_PHASE_TABLE, MARKET_COMPARISON, PHASE_DURATIONS,
)
from .market_engine import (
    market_for_sp, clear_bm, clear_da, clear_ida, ida_forecast,
    feedback_market_state, compute_forecasts, generate_forecast_update,
    compute_niv,
)
from .asset_physics import init_sof, update_sof, supplier_demand_mw
from .scoring_engine import compute_role_score, compute_system_score, compute_overall_score
from .physical_engine import (
    create_system_state, update_system_state,
    compute_player_system_impact, update_player_impact, build_player_stats,
)
from .da_curve_engine import clear_full_auction, validate_full_curve
from .id_trading_engine import clear_id_round
from .forecast_engine import ForecastEngine


# ─── Day-level phase sequence ───
# Game modes skip trading phases whose market key isn't in their "markets" list.
# FORECAST_* phases always run (they precede each trading stage).
# REALTIME and RESULTS always run.
_DAY_PHASE_SEQ = [
    "FORECAST_0", "DA",
    "FORECAST_1", "IDA1",
    "FORECAST_2", "IDA2",
    "ID_ROUNDS",
    "REALTIME", "RESULTS",
]

# Maps trading phases to their market key (used to skip disabled phases).
_PHASE_TO_MARKET = {
    "DA": "da", "IDA1": "ida1", "IDA2": "ida2", "ID_ROUNDS": "id", "REALTIME": "bm",
}

# Forecast phase that precedes each trading phase (for skip logic).
# If a trading phase is disabled, its preceding forecast is also skipped.
_FORECAST_BEFORE = {
    "DA": "FORECAST_0", "IDA1": "FORECAST_1", "IDA2": "FORECAST_2",
}

# Error reduction per forecast stage (uncertainty collapses)
_FORECAST_ERROR_REDUCTION = {
    "FORECAST_0": 1.0,   # full uncertainty
    "FORECAST_1": 0.6,   # after DA, new weather data
    "FORECAST_2": 0.3,   # morning-of, sharp update
}


# ─── In-memory room state (persisted to DB in production) ───

_room_states: dict[str, dict] = {}


def _get_room(room_id: str) -> dict:
    if room_id not in _room_states:
        _room_states[room_id] = _new_room_state()
    return _room_states[room_id]


def _new_room_state(seed: int | None = None) -> dict:
    if seed is None:
        # Cryptographically random 31-bit seed so replays are reproducible
        seed = int.from_bytes(os.urandom(4), 'little') & 0x7FFFFFFF
    return {
        # Determinism: seed stored so it can be persisted in DB and replayed
        "rngSeed": seed,
        # Day / phase tracking
        "day": 1,
        "dayPhase": "FORECAST_0",
        "currentSp": 0,             # 0 = not in REALTIME; 1-48 during REALTIME
        "bmSubPhase": None,          # "BM_OPEN" | "BM_CLEAR" | "SP_SETTLED"
        "phaseStartTs": int(time.time() * 1000),  # ms epoch — used by client countdown timers

        # Config
        "scenarioId": "NORMAL",
        "gameMode": "FULL",
        "cashoutMode": CASHOUT_MODE,
        "tickSpeed": 15000,
        "paused": False,
        "advanceMode": "AUTO",       # "MANUAL" | "AUTO"
        "simSpeedId": "NORMAL",      # key into SIM_SPEEDS
        "simSpeedFactor": 0.33,      # multiplier on PHASE_DURATIONS

        # Markets for all 48 SPs (populated during FORECAST_0)
        "markets": {},               # sp(1-48) → { forecast, actual }

        # Per-player per-SP contracted positions (MW)
        # Built up through: DA → IDA1 → IDA2 → ID_ROUNDS
        "positions": {},             # pid → { sp: float }

        # Day-level order books (bids for multiple SPs)
        "daOrderBook": {},           # pid → [ { sp, side, mw, price }, ... ]
        "daCurves": {},              # pid → curve (for clear_full_auction)
        "ida1OrderBook": {},         # pid → [ { sp, side, mw, price }, ... ]
        "ida2OrderBook": {},
        "idOrderBook": {},           # pid → [ { sp, side, mw, price }, ... ]

        # SP-level order book (current SP only, reset each SP)
        "bmOrderBook": {},           # pid → { side, mw, price, asset, ... }

        # NESO acceptance overrides per SP
        "nesoOverrides": {},         # sp → { reject, priority, volumeCap }

        # Clearing results
        "daResults": {},             # sp → { cp, volume, accepted_bids }
        "ida1Results": {},
        "ida2Results": {},
        "bmResults": {},             # sp → { accepted, cp, cleared, full }
        "spSettlements": {},         # sp → { pid → settlement_data }

        # Cumulative (persists across days)
        "systemState": create_system_state(),
        "playerStates": {},          # pid → { cash, role, asset, spHistory, ... }

        # Player readiness tracking (server-authoritative phase lock).
        # Each non-NESO player signals "done with this phase" after submitting their bid.
        # NESO sees a readiness panel; can force-advance any time regardless.
        # Format: pid → { phase: str, role: str, name: str, ts: int }
        "playerReady": {},

        # ── Event Sourcing ──────────────────────────────────────────────────
        # _eventSeq: monotonically increasing sequence counter for this room.
        # _pendingEvents: events accumulated since last flush (written to DB
        #   by server.py _flush_events after each advance call).
        "_eventSeq": 0,
        "_pendingEvents": [],

        # Forecast
        "forecastEngine": ForecastEngine(seed=seed),
        "publishedForecast": None,

        # Forecast update bulletins shown to all players between phases.
        # Each entry produced by generate_forecast_update(); last 10 kept.
        # Maps directly to real GB weather-model-run cadence:
        #   FORECAST_0 → 06Z initial run (D-1 06:00)
        #   FORECAST_1 → 12Z run (D-1 after DA 09:30)
        #   FORECAST_2 → 06Z short-range run (D 07:30)
        "forecastUpdateHistory": [],

        # ── Nested SP Timeline (per-SP gate closure + BM state) ──────────
        # Tracks intraday gate closure and per-SP BM progression.
        # phase: ID_OPEN → GC_PASSED → BM_OPEN → BM_CLEAR → SP_SETTLED → SETTLED
        "spTimeline": {
            sp: {
                "phase": "ID_OPEN",
                "gateClosed": False,
                "bmSubPhase": None,
            }
            for sp in range(1, SPS_PER_DAY + 1)
        },
        # ID gate closure round counter (advances during ID_ROUNDS)
        "idRound": 0,
    }


def _emit(rs: dict, event_type: str, data: dict) -> None:
    """Append an immutable event to the room's pending event buffer.

    Called at the end of every phase handler.  Events are flushed to the
    event_log table by server.py after each advance_day_phase / advance_bm
    call, keeping DB writes off the hot path and out of the synchronous
    game logic.
    """
    rs["_eventSeq"] = rs.get("_eventSeq", 0) + 1
    rs.setdefault("_pendingEvents", []).append({
        "sequence": rs["_eventSeq"],
        "occurred_at": int(time.time() * 1000),  # ms epoch for consistency with client
        "event_type": event_type,
        "data": data,
    })


def _build_replay_state(rs: dict) -> dict:
    """Capture minimal authoritative state needed for cold-start replay."""
    return {
        "positions": {
            pid: {int(sp): float(mw) for sp, mw in sps.items()}
            for pid, sps in rs.get("positions", {}).items()
            if isinstance(sps, dict)
        },
        "playerStates": {
            pid: {
                "cash": float(ps.get("cash", 0)),
                "daCash": float(ps.get("daCash", 0)),
            }
            for pid, ps in rs.get("playerStates", {}).items()
            if isinstance(ps, dict)
        },
    }


def _hydrate_replay_state(rs: dict, replay_state: dict) -> None:
    """Restore positions/cash snapshot from a persisted replay payload."""
    positions = replay_state.get("positions") if isinstance(replay_state, dict) else None
    if isinstance(positions, dict):
        for pid, sps in positions.items():
            if not isinstance(sps, dict):
                continue
            rs["positions"][pid] = {int(sp): float(mw) for sp, mw in sps.items()}

    players = replay_state.get("playerStates") if isinstance(replay_state, dict) else None
    if isinstance(players, dict):
        for pid, vals in players.items():
            if not isinstance(vals, dict):
                continue
            ps = rs["playerStates"].get(pid)
            if not ps:
                continue
            if "cash" in vals:
                ps["cash"] = float(vals["cash"])
            if "daCash" in vals:
                ps["daCash"] = float(vals["daCash"])


def _event_ts_ms(event: dict) -> int | None:
    """Best-effort conversion of event timestamp to epoch-ms."""
    ts = event.get("occurred_at")
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        return int(ts)
    if hasattr(ts, "timestamp"):
        return int(ts.timestamp() * 1000)
    return None


def _snapshot(rs: dict) -> dict:
    """Deep-copy room state to support the immutable state machine (Phase 2).

    All phase handlers operate on this snapshot.  Only once all mutations
    succeed does the caller atomically replace _room_states[room_id] with
    the snapshot, so the previous state is never partially overwritten.

    ForecastEngine is excluded from deepcopy because it holds file handles or
    other non-serialisable objects.  It is only mutated during FORECAST phases
    (single-threaded within one advance call), so sharing the reference is safe.
    """
    fe = rs.get("forecastEngine")
    snap = copy.deepcopy({k: v for k, v in rs.items() if k != "forecastEngine"})
    snap["forecastEngine"] = fe
    return snap


def get_room_state(room_id: str) -> dict:
    """Return a serialisable snapshot of room state."""
    rs = _get_room(room_id)
    forecasts = compute_forecasts(
        rs.get("currentSp", 0), rs.get("scenarioId", "NORMAL"), rs.get("publishedForecast")
    )
    return {
        "day": rs["day"],
        "dayPhase": rs["dayPhase"],
        "currentSp": rs["currentSp"],
        "bmSubPhase": rs["bmSubPhase"],
        "phaseStartTs": rs.get("phaseStartTs", 0),
        "scenarioId": rs["scenarioId"],
        "gameMode": rs["gameMode"],
        "cashoutMode": rs["cashoutMode"],
        "tickSpeed": rs["tickSpeed"],
        "paused": rs["paused"],
        "advanceMode": rs.get("advanceMode", "AUTO"),
        "simSpeedId": rs.get("simSpeedId", "NORMAL"),
        "simSpeedFactor": rs.get("simSpeedFactor", 0.33),
        "rngSeed": rs.get("rngSeed"),
        "markets": rs["markets"],
        "positions": rs["positions"],
        "systemState": rs["systemState"],
        "playerStates": rs["playerStates"],
        "playerReady": rs.get("playerReady", {}),
        "daResults": rs["daResults"],
        "ida1Results": rs.get("ida1Results", {}),
        "ida2Results": rs.get("ida2Results", {}),
        "bmResults": rs["bmResults"],
        "spSettlements": rs["spSettlements"],
        "orderBooks": {
            "da": rs.get("daOrderBook", {}),
            "ida1": rs.get("ida1OrderBook", {}),
            "ida2": rs.get("ida2OrderBook", {}),
            "id": rs.get("idOrderBook", {}),
            "bm": rs.get("bmOrderBook", {}),
        },
        "daCurves": rs.get("daCurves", {}),
        "publishedForecast": rs.get("publishedForecast"),
        "forecasts": forecasts,
        # Last 3 forecast update bulletins for the timeline panel
        "forecastUpdateHistory": rs.get("forecastUpdateHistory", [])[-3:],
        # Most recent update (convenient for single-banner display)
        "forecastUpdateSummary": (
            rs["forecastUpdateHistory"][-1]
            if rs.get("forecastUpdateHistory")
            else None
        ),
        # GB market phase metadata — labels, real timing, market type
        "phaseInfo": GB_PHASE_TABLE.get(rs["dayPhase"]),
        "marketComparison": MARKET_COMPARISON,
        # Nested SP timeline for ID gate closure + per-SP BM state
        "spTimeline": rs.get("spTimeline", {}),
        "idRound": rs.get("idRound", 0),
    }


# ═══════════════════════════════════════════════
# DAY-LEVEL PHASE MACHINE
# ═══════════════════════════════════════════════

def _enabled_markets(rs: dict) -> list[str]:
    gm = rs.get("gameMode", "FULL")
    return GAME_MODES.get(gm, GAME_MODES["FULL"]).get("markets", [])


def _next_day_phase(current: str, rs: dict) -> str:
    """Advance to next day phase, skipping disabled trading phases and their forecasts."""
    markets = _enabled_markets(rs)
    idx = _DAY_PHASE_SEQ.index(current) if current in _DAY_PHASE_SEQ else 0
    for i in range(idx + 1, len(_DAY_PHASE_SEQ)):
        candidate = _DAY_PHASE_SEQ[i]
        # Always-run phases
        if candidate in ("REALTIME", "RESULTS"):
            return candidate
        # Forecast phases: skip if the trading phase they precede is disabled
        if candidate.startswith("FORECAST_"):
            # Find which trading phase this forecast precedes
            next_trading = None
            for j in range(i + 1, len(_DAY_PHASE_SEQ)):
                if not _DAY_PHASE_SEQ[j].startswith("FORECAST_"):
                    next_trading = _DAY_PHASE_SEQ[j]
                    break
            if next_trading:
                mkey = _PHASE_TO_MARKET.get(next_trading)
                if mkey and mkey not in markets:
                    continue  # skip this forecast — its trading phase is disabled
            return candidate
        # Trading phases: skip if market not enabled
        market_key = _PHASE_TO_MARKET.get(candidate)
        if market_key and market_key in markets:
            return candidate
    return "RESULTS"


def advance_day_phase(room_id: str) -> dict:
    """
    Advance to the next day-level phase.

    Full sequence: FORECAST_0 → DA → FORECAST_1 → IDA1 → FORECAST_2 → IDA2
                   → ID_ROUNDS → REALTIME.

    Once in REALTIME, use advance_bm() instead.
    After RESULTS, this starts a new day at FORECAST_0.

    Phase 2 — Immutable State Machine:
    All mutations happen on a deep-copy (snapshot) of the current state.
    _room_states[room_id] is atomically replaced only after all handlers
    succeed, so partial failures never corrupt the live room state.
    """
    rs = _get_room(room_id)
    old_phase = rs["dayPhase"]

    # ── Snapshot: all mutations from here operate on `snap`, not `rs` ──────
    snap = _snapshot(rs)

    result: dict[str, Any] = {"oldPhase": old_phase, "day": snap["day"]}

    # Reset readiness tracking for the phase we're about to enter.
    snap["playerReady"] = {}

    # --- Exit actions for the phase we're leaving ---

    if old_phase.startswith("FORECAST_"):
        result.update(_on_forecast(snap, old_phase))

    elif old_phase == "DA":
        result.update(_on_da_close_all(snap))

    elif old_phase in ("IDA1", "IDA2"):
        result.update(_on_ida_close_all(snap, old_phase))

    elif old_phase == "ID_ROUNDS":
        result.update(_on_id_close(snap))

    elif old_phase == "REALTIME":
        return {"error": "Use advance_bm() during REALTIME phase",
                "dayPhase": old_phase, "currentSp": rs["currentSp"]}

    elif old_phase == "RESULTS":
        result.update(_start_new_day(snap))
        snap["dayPhase"] = "FORECAST_0"
        snap["phaseStartTs"] = int(time.time() * 1000)
        _apply_phase_tick(snap)
        result["newPhase"] = snap["dayPhase"]
        # Atomically commit snapshot
        _room_states[room_id] = snap
        return result

    # --- Determine next phase ---

    if old_phase == "ID_ROUNDS":
        # After ID_ROUNDS, always enter REALTIME
        snap["dayPhase"] = "REALTIME"
        snap["currentSp"] = 1
        snap["bmSubPhase"] = "BM_OPEN"
        snap["bmOrderBook"] = {}
        _recompute_niv_for_sp(snap, 1)
    else:
        snap["dayPhase"] = _next_day_phase(old_phase, snap)
        # If we jumped straight to REALTIME (e.g. TUTORIAL skips DA/IDA/ID)
        if snap["dayPhase"] == "REALTIME":
            snap["currentSp"] = 1
            snap["bmSubPhase"] = "BM_OPEN"
            snap["bmOrderBook"] = {}
            _recompute_niv_for_sp(snap, 1)

    result["newPhase"] = snap["dayPhase"]
    result["currentSp"] = snap["currentSp"]

    # Update phase start timestamp for client countdown timers
    snap["phaseStartTs"] = int(time.time() * 1000)

    # Apply per-phase tick duration (scales with instructor speed preset)
    _apply_phase_tick(snap)

    # ── Atomically replace live room state with the mutated snapshot ────────
    _room_states[room_id] = snap
    return result


# ═══════════════════════════════════════════════
# REALTIME / BM PHASE (SP-by-SP)
# ═══════════════════════════════════════════════

def _recompute_niv_for_sp(rs: dict, sp: int) -> None:
    """Recompute NIV for a SP using the real GB formula (hybrid).

    Called when entering BM_OPEN for a new SP. Adjusts the actual market
    state to account for player contracted positions accumulated during
    DA/IDA/ID trading.  Updates rawImbalanceMw, niv, indicativeNiv,
    and isShort in-place on market["actual"].
    """
    market = rs.get("markets", {}).get(sp)
    if not market or not market.get("actual"):
        return
    actual = market["actual"]
    system = actual.get("system", {})
    base_noise = actual.get("baseNoise", actual.get("rawImbalanceMw", 0))
    positions = rs.get("positions", {})
    niv_result = compute_niv(system, base_noise, positions, sp)
    actual["niv"] = niv_result["niv"]
    actual["rawImbalanceMw"] = niv_result["niv"]
    actual["indicativeNiv"] = niv_result["niv"]
    actual["isShort"] = niv_result["isShort"]
    actual["nivBreakdown"] = niv_result

def advance_bm(room_id: str) -> dict:
    """
    Advance within the REALTIME phase.
    Cycles: BM_OPEN → BM_CLEAR → SP_SETTLED → (next SP) BM_OPEN → ...
    After SP 48 is settled, transitions to RESULTS.

    Phase 2 — Immutable State Machine:
    Operates on a snapshot; atomically replaces _room_states[room_id] on success.
    """
    rs = _get_room(room_id)
    if rs["dayPhase"] != "REALTIME":
        return {"error": f"Not in REALTIME (current: {rs['dayPhase']})"}

    sp = rs["currentSp"]
    sub = rs["bmSubPhase"]

    # ── Snapshot: all mutations operate on `snap` ────────────────────────────
    snap = _snapshot(rs)
    result: dict[str, Any] = {"day": snap["day"], "sp": sp}

    if sub == "BM_OPEN":
        # Clear BM for this SP: merit order clearing, feedback, compute NIV
        result.update(_on_bm_close_sp(snap, sp))
        snap["bmSubPhase"] = "BM_CLEAR"

    elif sub == "BM_CLEAR":
        # Settlement: imbalance charges, P&L, system metrics
        snap["bmSubPhase"] = "SP_SETTLED"

    elif sub == "SP_SETTLED":
        if sp >= SPS_PER_DAY:
            # All SPs done → finalise day scores
            result.update(_finalize_day(snap))
            snap["dayPhase"] = "RESULTS"
            snap["currentSp"] = 0
            snap["bmSubPhase"] = None
        else:
            # Move to next SP
            snap["currentSp"] = sp + 1
            snap["bmSubPhase"] = "BM_OPEN"
            snap["bmOrderBook"] = {}
            _recompute_niv_for_sp(snap, sp + 1)
            result["sp"] = sp + 1

    result["bmSubPhase"] = snap["bmSubPhase"]
    result["dayPhase"] = snap["dayPhase"]

    # Update phase start timestamp for client countdown timers
    snap["phaseStartTs"] = int(time.time() * 1000)

    # Apply per-phase tick duration (BM_OPEN/BM_CLEAR/SP_SETTLED have different speeds)
    _apply_phase_tick(snap)

    # ── Atomically replace live room state with the mutated snapshot ────────
    _room_states[room_id] = snap
    return result


# ═══════════════════════════════════════════════
# PER-PHASE TICK SPEED
# ═══════════════════════════════════════════════

def _apply_phase_tick(rs: dict) -> None:
    """Set tickSpeed from PHASE_DURATIONS for the current phase/sub-phase.

    Uses the BM sub-phase key during REALTIME, otherwise the dayPhase key.
    The base duration is multiplied by simSpeedFactor (set by instructor's
    sim-speed preset), so switching from NORMAL→FAST scales all phases.

    In MANUAL advance mode, tickSpeed is set very high (999999) so the
    client timer never fires — the instructor must click to advance.
    """
    if rs.get("advanceMode") == "MANUAL":
        rs["tickSpeed"] = 999_999
        return

    if rs["dayPhase"] == "REALTIME" and rs.get("bmSubPhase"):
        key = rs["bmSubPhase"]
    elif rs["dayPhase"] == "RESULTS":
        key = "RESULTS"
    else:
        key = rs["dayPhase"]
    duration = PHASE_DURATIONS.get(key)
    if duration is not None:
        factor = rs.get("simSpeedFactor", 0.33)
        rs["tickSpeed"] = max(2000, int(duration * factor))


# ═══════════════════════════════════════════════
# FORECAST PHASES (generate/refine markets for all 48 SPs)
# ═══════════════════════════════════════════════

def _on_forecast(rs: dict, phase: str = "FORECAST_0") -> dict:
    """
    Generate or refine forecast + actual markets for all 48 SPs.

    Real GB timing mirrors:
      FORECAST_0: D-1 06:00 — 06Z NWP run, initial DA forecast (full uncertainty).
      FORECAST_1: D-1 09:30 — 12Z run arrives; DA price is a signal; uncertainty -40%.
      FORECAST_2: D   07:30 — 06Z short-range run; very sharp; uncertainty -70%.

    Produces a forecastUpdateSummary bulletin stored in forecastUpdateHistory
    so all players see what triggered the revision (weather run, wind delta, DA price).
    """
    err_mult = _FORECAST_ERROR_REDUCTION.get(phase, 1.0)

    if phase == "FORECAST_0" or not rs["markets"]:
        # Generate fresh markets for the day using the 06Z initial run.
        for sp in range(1, SPS_PER_DAY + 1):
            rs["markets"][sp] = market_for_sp(
                sp, rs["scenarioId"], [],
                rs["publishedForecast"],
                room_seed=rs.get("rngSeed", 0),
            )
        # Initialise per-player positions for this day
        for pid in rs["playerStates"]:
            rs["positions"][pid] = {sp: 0.0 for sp in range(1, SPS_PER_DAY + 1)}
        update_summary = {
            "stage": "FORECAST_0",
            "weatherRun": "06Z",
            "trigger": "06Z weather run · initial DA forecast for all 48 SPs — full uncertainty",
            "windDeltaGW": 0.0,
            "demandDeltaMW": 0,
            "daAvgPrice": None,
            "daPriceSignal": None,
            "confidenceGain": 0,
            "spTightest": None,
            "perSpRevisions": {},
        }
        rs.setdefault("forecastUpdateHistory", []).append(update_summary)
        rs["forecastUpdateHistory"] = rs["forecastUpdateHistory"][-10:]
        r = {
            "marketsGenerated": SPS_PER_DAY,
            "forecastStage": phase,
            "errorMultiplier": err_mult,
            "forecastUpdateSummary": update_summary,
        }
        _emit(rs, "FORECAST_GENERATED", {"phase": phase, "spsGenerated": SPS_PER_DAY, "errorMultiplier": err_mult})
        return r
    else:
        # ── FORECAST_1 (12Z run, post-DA) or FORECAST_2 (06Z short-range) ──
        # Refine existing forecasts with progressively reduced error.
        updated = 0
        for sp in range(1, SPS_PER_DAY + 1):
            market = rs["markets"].get(sp)
            if not market:
                continue
            updated_fc = ida_forecast(market, err_mult)
            market[f"{phase.lower()}Forecast"] = updated_fc
            # Update the primary forecast to the refined version
            market["forecast"] = {**market.get("forecast", {}), **updated_fc}
            updated += 1

        # For FORECAST_1: incorporate DA clearing price as an information signal.
        # Real rationale: traders see where DA cleared vs their model → revise NIV.
        da_avg_price: float | None = None
        if phase == "FORECAST_1" and rs.get("daResults"):
            prices = [
                r.get("cp", 0) for r in rs["daResults"].values()
                if isinstance(r, dict) and r.get("cp")
            ]
            if prices:
                da_avg_price = round(sum(prices) / len(prices), 1)

        # Generate weather-run bulletin visible to all players.
        update_summary = generate_forecast_update(
            rs["markets"], phase, rs.get("scenarioId", "NORMAL"), da_avg_price
        )
        rs.setdefault("forecastUpdateHistory", []).append(update_summary)
        rs["forecastUpdateHistory"] = rs["forecastUpdateHistory"][-10:]

        r = {
            "marketsUpdated": updated,
            "forecastStage": phase,
            "errorMultiplier": err_mult,
            "forecastUpdateSummary": update_summary,
        }
        _emit(rs, "FORECAST_REFINED", {"phase": phase, "spsUpdated": updated, "errorMultiplier": err_mult, "daAvgPrice": da_avg_price})
        return r


def generate_all_markets(room_id: str) -> dict:
    """Public API: generate markets for all SPs (FORECAST_0 phase action)."""
    rs = _get_room(room_id)
    return _on_forecast(rs, "FORECAST_0")


# ═══════════════════════════════════════════════
# DA CLOSE (all 48 SPs at once)
# ═══════════════════════════════════════════════

def _collect_bids_for_sp(order_book: dict, sp: int) -> list[dict]:
    """Collect bids from an order book that target a specific SP."""
    sp_bids = []
    for pid, bids in order_book.items():
        if isinstance(bids, list):
            for bid in bids:
                bid_sp = bid.get("sp")
                if bid_sp == sp or bid_sp is None:
                    sp_bids.append({**bid, "id": pid})
        elif isinstance(bids, dict):
            bid_sp = bids.get("sp")
            if bid_sp == sp or bid_sp is None:
                sp_bids.append({**bids, "id": pid})
    return sp_bids


def _apply_accepted_to_positions(rs: dict, sp: int, accepted_bids: list[dict]) -> None:
    """Update positions and credit revenue for accepted bids."""
    for accepted in accepted_bids:
        pid = accepted.get("id") or accepted.get("player_id")
        if not pid or pid not in rs["playerStates"]:
            continue
        ps = rs["playerStates"][pid]
        mw_acc = accepted.get("mwAcc", 0)
        revenue = accepted.get("revenue", 0)

        if accepted.get("side") == "offer":
            rs["positions"].setdefault(pid, {})[sp] = (
                rs["positions"].get(pid, {}).get(sp, 0) + mw_acc
            )
        elif accepted.get("side") == "bid":
            rs["positions"].setdefault(pid, {})[sp] = (
                rs["positions"].get(pid, {}).get(sp, 0) - mw_acc
            )

        ps["cash"] = ps.get("cash", 0) + revenue
        ps["daCash"] = ps.get("daCash", 0) + revenue


def _on_da_close_all(rs: dict) -> dict:
    """Clear DA auction for all 48 SPs simultaneously."""
    # If players submitted full curves, use uniform 48-SP curve auction.
    if rs.get("daCurves"):
        player_curves = []
        for pid, curve in rs["daCurves"].items():
            if not isinstance(curve, dict):
                continue
            player_curves.append({
                "playerId": pid,
                "segments": curve.get("segments", []),
                "side": curve.get("side", "sell"),
                "blocks": curve.get("blocks", []),
            })

        market_ctx = []
        for sp in range(1, SPS_PER_DAY + 1):
            mkt = rs["markets"].get(sp, {})
            fc = mkt.get("forecast", {})
            market_ctx.append({
                "demandMW": max(0.0, float(fc.get("demandMw", 300) or 300)),
                "forecastPrice": float(fc.get("baseRef", 50) or 50),
            })

        curve_result = clear_full_auction(player_curves, market_ctx)

        # Map curve result into per-SP structure expected by existing UI/state.
        all_results = {}
        for sp in range(1, SPS_PER_DAY + 1):
            cp = curve_result["prices"][sp - 1]
            accepted_bids = []
            for pid, vols in curve_result.get("volumes", {}).items():
                vol = vols[sp - 1]
                if abs(vol) <= 0:
                    continue
                side = "offer" if vol < 0 else "bid"
                mw_acc = abs(vol)
                revenue = (mw_acc * cp * SP_DURATION_H) * (1 if side == "offer" else -1)
                accepted_bids.append({
                    "id": pid,
                    "player_id": pid,
                    "side": side,
                    "mwAcc": mw_acc,
                    "revenue": revenue,
                    "price": cp,
                })

                # Update contracted position and cash.
                rs["positions"].setdefault(pid, {})[sp] = (
                    rs["positions"].get(pid, {}).get(sp, 0) - vol
                )
                if pid in rs["playerStates"]:
                    rs["playerStates"][pid]["cash"] = rs["playerStates"][pid].get("cash", 0) + revenue
                    rs["playerStates"][pid]["daCash"] = rs["playerStates"][pid].get("daCash", 0) + revenue

            total_volume = sum(b["mwAcc"] for b in accepted_bids if b["side"] == "offer")
            all_results[sp] = {"cp": cp, "volume": total_volume, "accepted_bids": accepted_bids}

        rs["daResults"] = all_results
        avg_cp = round(sum(v["cp"] for v in all_results.values()) / len(all_results), 2) if all_results else None
        total_vol = sum(v["volume"] for v in all_results.values())
        _emit(
            rs,
            "DA_CLEARED",
            {
                "spsCleared": len(all_results),
                "avgClearingPrice": avg_cp,
                "totalVolumeMW": total_vol,
                "method": "curves",
                "replayState": _build_replay_state(rs),
            },
        )
        return {
            "daResults": all_results,
            "spsCleared": len(all_results),
            "acceptedBlocks": curve_result.get("acceptedBlocks", []),
            "rejectedBlocks": curve_result.get("rejectedBlocks", []),
        }

    all_results = {}
    for sp in range(1, SPS_PER_DAY + 1):
        market = rs["markets"].get(sp)
        if not market:
            continue
        sp_bids = _collect_bids_for_sp(rs["daOrderBook"], sp)
        if not sp_bids:
            all_results[sp] = {
                "cp": market["forecast"].get("baseRef", 50),
                "volume": 0, "accepted_bids": [],
            }
            continue

        da_result = clear_da(sp_bids, market["forecast"])
        all_results[sp] = da_result
        _apply_accepted_to_positions(rs, sp, da_result.get("accepted_bids", []))

    rs["daResults"] = all_results
    avg_cp = round(sum(v["cp"] for v in all_results.values()) / len(all_results), 2) if all_results else None
    total_vol = sum(v["volume"] for v in all_results.values())
    _emit(
        rs,
        "DA_CLEARED",
        {
            "spsCleared": len(all_results),
            "avgClearingPrice": avg_cp,
            "totalVolumeMW": total_vol,
            "method": "simple",
            "replayState": _build_replay_state(rs),
        },
    )

    return {"daResults": all_results, "spsCleared": len(all_results)}


# ═══════════════════════════════════════════════
# IDA CLOSE (all SPs, updated forecast)
# ═══════════════════════════════════════════════

def _on_ida_close_all(rs: dict, ida_round: str) -> dict:
    """Clear IDA1 or IDA2 for all 48 SPs with progressively better forecast."""
    ob_key = f"{ida_round.lower()}OrderBook"
    result_key = f"{ida_round.lower()}Results"
    ida_cfg = IDA_CONFIG.get(ida_round, {})
    err_reduction = ida_cfg.get("forecastErrorReduction", 0.5)

    # If full curves exist, clear IDA rounds using the same curve auction model.
    if rs.get("daCurves"):
        market_ctx = []
        for sp in range(1, SPS_PER_DAY + 1):
            market = rs["markets"].get(sp)
            if not market:
                market_ctx.append({"demandMW": 300.0, "forecastPrice": 50.0})
                continue
            updated_fc = ida_forecast(market, err_reduction)
            market[f"{ida_round.lower()}Forecast"] = updated_fc
            market_ctx.append({
                "demandMW": max(0.0, float(updated_fc.get("demandMw", 300) or 300)),
                "forecastPrice": float(updated_fc.get("baseRef", 50) or 50),
            })

        player_curves = []
        for pid, curve in rs["daCurves"].items():
            if not isinstance(curve, dict):
                continue
            player_curves.append({
                "playerId": pid,
                "segments": curve.get("segments", []),
                "side": curve.get("side", "sell"),
                "blocks": curve.get("blocks", []),
            })

        curve_result = clear_full_auction(player_curves, market_ctx)
        all_results = {}
        for sp in range(1, SPS_PER_DAY + 1):
            cp = curve_result["prices"][sp - 1]
            accepted_bids = []
            for pid, vols in curve_result.get("volumes", {}).items():
                vol = vols[sp - 1]
                if abs(vol) <= 0:
                    continue
                side = "offer" if vol < 0 else "bid"
                mw_acc = abs(vol)
                revenue = (mw_acc * cp * SP_DURATION_H) * (1 if side == "offer" else -1)
                accepted_bids.append({
                    "id": pid,
                    "player_id": pid,
                    "side": side,
                    "mwAcc": mw_acc,
                    "revenue": revenue,
                    "price": cp,
                })

                rs["positions"].setdefault(pid, {})[sp] = (
                    rs["positions"].get(pid, {}).get(sp, 0) - vol
                )
                if pid in rs["playerStates"]:
                    rs["playerStates"][pid]["cash"] = rs["playerStates"][pid].get("cash", 0) + revenue

            all_results[sp] = {
                "cp": cp,
                "volume": sum(b["mwAcc"] for b in accepted_bids if b["side"] == "offer"),
                "accepted_bids": accepted_bids,
                "updatedForecast": rs["markets"].get(sp, {}).get(f"{ida_round.lower()}Forecast", {}),
            }

        rs[result_key] = all_results
        avg_cp = round(sum(v["cp"] for v in all_results.values()) / len(all_results), 2) if all_results else None
        total_vol = sum(v["volume"] for v in all_results.values())
        _emit(
            rs,
            "IDA_CLEARED",
            {
                "round": ida_round,
                "spsCleared": len(all_results),
                "avgClearingPrice": avg_cp,
                "totalVolumeMW": total_vol,
                "method": "curves",
                "replayState": _build_replay_state(rs),
            },
        )
        return {
            f"{ida_round.lower()}Results": all_results,
            "acceptedBlocks": curve_result.get("acceptedBlocks", []),
            "rejectedBlocks": curve_result.get("rejectedBlocks", []),
        }

    all_results = {}
    for sp in range(1, SPS_PER_DAY + 1):
        market = rs["markets"].get(sp)
        if not market:
            continue

        updated_fc = ida_forecast(market, err_reduction)
        market[f"{ida_round.lower()}Forecast"] = updated_fc

        sp_bids = _collect_bids_for_sp(rs.get(ob_key, {}), sp)
        ida_result = clear_ida(sp_bids, updated_fc)
        all_results[sp] = {**ida_result, "updatedForecast": updated_fc}

        # Update positions (IDA revenue credited but NOT to daCash)
        for accepted in ida_result.get("accepted_bids", []):
            pid = accepted.get("id") or accepted.get("player_id")
            if not pid or pid not in rs["playerStates"]:
                continue
            ps = rs["playerStates"][pid]
            mw_acc = accepted.get("mwAcc", 0)
            revenue = accepted.get("revenue", 0)

            if accepted.get("side") == "offer":
                rs["positions"].setdefault(pid, {})[sp] = (
                    rs["positions"].get(pid, {}).get(sp, 0) + mw_acc
                )
            elif accepted.get("side") == "bid":
                rs["positions"].setdefault(pid, {})[sp] = (
                    rs["positions"].get(pid, {}).get(sp, 0) - mw_acc
                )
            ps["cash"] = ps.get("cash", 0) + revenue

    rs[result_key] = all_results
    avg_cp = round(sum(v["cp"] for v in all_results.values()) / len(all_results), 2) if all_results else None
    total_vol = sum(v["volume"] for v in all_results.values())
    _emit(
        rs,
        "IDA_CLEARED",
        {
            "round": ida_round,
            "spsCleared": len(all_results),
            "avgClearingPrice": avg_cp,
            "totalVolumeMW": total_vol,
            "method": "simple",
            "replayState": _build_replay_state(rs),
        },
    )
    return {f"{ida_round.lower()}Results": all_results}


# ═══════════════════════════════════════════════
# ID_ROUNDS CLOSE (gate closure — freeze positions)
# ═══════════════════════════════════════════════

def _on_id_close(rs: dict) -> dict:
    """
    Close continuous intraday trading (gate closure for all SPs).

    Uses order-book pay-as-bid matching via clear_id_round:
      - Buys/sells matched per SP at the passive-side price
      - Positions and cash updated from matched trades
      - Unmatched orders expire
      - Positions frozen for BM
    """
    id_book = rs.get("idOrderBook", {})

    # Run order-book clearing across all 48 SPs
    id_result = clear_id_round(id_book, open_sps=list(range(1, SPS_PER_DAY + 1)))

    # Apply position deltas from matched trades
    for pid, sp_deltas in id_result.get("positionDeltas", {}).items():
        for sp, delta in sp_deltas.items():
            rs["positions"].setdefault(pid, {})[sp] = (
                rs["positions"].get(pid, {}).get(sp, 0) + delta
            )

    # Apply cash deltas (buyer pays, seller receives)
    for pid, cash_delta in id_result.get("cashDeltas", {}).items():
        ps = rs["playerStates"].get(pid)
        if ps:
            ps["cash"] = ps.get("cash", 0) + cash_delta

    # Store ID clearing results
    rs["idResults"] = id_result

    # Snapshot frozen positions (final contracted position before BM)
    rs["frozenPositions"] = {
        pid: dict(sps) for pid, sps in rs["positions"].items()
    }

    # Build per-player trade summary so the client can apply toasts + position updates
    # from the server result without performing its own matching.
    player_id_summaries: dict[str, dict] = {}
    cash_deltas = id_result.get("cashDeltas", {})
    pos_deltas = id_result.get("positionDeltas", {})
    for pid in set(list(cash_deltas.keys()) + list(pos_deltas.keys())):
        pid_deltas = pos_deltas.get(pid, {})
        total_mw = sum(abs(v) for v in pid_deltas.values())
        cash_delta = cash_deltas.get(pid, 0.0)
        # Determine side: positive pos_delta means seller (added contracted supply),
        # negative means buyer (added contracted demand).
        total_delta = sum(pid_deltas.values())
        side = "offer" if total_delta > 0 else "bid"
        avg_price = (abs(cash_delta) / (total_mw * SP_DURATION_H)) if total_mw > 0 else 0
        player_id_summaries[pid] = {
            "mwMatched": total_mw,
            "avgPrice": avg_price,
            "cashDelta": cash_delta,
            "side": side,
            "positionDeltas": pid_deltas,
        }

    _emit(rs, "ID_CLOSED", {
        "tradesMatched": len(id_result.get("trades", [])),
        "totalVolumeMW": id_result.get("totalVolume", 0),
        "positionsFrozen": True,
        "positionDeltas": id_result.get("positionDeltas", {}),
        "cashDeltas": id_result.get("cashDeltas", {}),
        "playerIdSummaries": player_id_summaries,
        "replayState": _build_replay_state(rs),
    })

    return {
        "idTradesMatched": len(id_result.get("trades", [])),
        "totalVolumeMW": id_result.get("totalVolume", 0),
        "trades": id_result.get("trades", []),
        "positionsFrozen": True,
        "playerIdSummaries": player_id_summaries,
    }


# ═══════════════════════════════════════════════
# BM CLOSE (single SP during REALTIME)
# ═══════════════════════════════════════════════

def _on_bm_close_sp(rs: dict, sp: int) -> dict:
    """Clear BM and settle a single SP."""
    market = rs["markets"].get(sp)
    if not market:
        return {"error": f"No market for SP {sp}"}

    actual = market["actual"]
    bm_bids = list(rs["bmOrderBook"].values())

    # NESO acceptance overrides
    neso_overrides = rs.get("nesoOverrides", {}).get(sp)
    bm_result = clear_bm(bm_bids, actual, neso_overrides=neso_overrides)

    # Feedback: update actual with residual NIV, freq, SBP/SSP
    market["actual"] = feedback_market_state(actual, bm_result)
    rs["bmResults"][sp] = bm_result

    # Credit BM revenue to players
    for bid in bm_result.get("accepted", []):
        pid = bid.get("id") or bid.get("player_id")
        if not pid or pid not in rs["playerStates"]:
            continue
        ps = rs["playerStates"][pid]
        asset_def = ASSETS.get(ps.get("asset", ""), {})

        ps["cash"] = ps.get("cash", 0) + bid.get("revenue", 0)

        # Update SoC/fuel after dispatch
        is_short = actual.get("isShort", False)
        ps["soc"] = update_sof(asset_def, ps.get("soc", init_sof(asset_def)), bid.get("mwAcc", 0), is_short)

    # Settle this SP
    settlement = _settle_sp(rs, sp)
    rs["spSettlements"][sp] = settlement

    # Emit after settlement so the event carries final per-player cash values
    _emit(rs, "BM_CLEARED", {
        "sp": sp,
        "cp": bm_result.get("cp"),
        "cleared": bm_result.get("cleared", False),
        "niv": rs["markets"].get(sp, {}).get("actual", {}).get("niv"),
        "playerSettlements": {
            pid: {
                "cashDelta": s.get("cashDelta"),
                "deviation": s.get("deviation"),
                "cash": s.get("cash"),
                "soc": rs["playerStates"].get(pid, {}).get("soc"),
            }
            for pid, s in settlement.items()
        },
    })
    return {"sp": sp, "bmResult": bm_result, "settlement": settlement}


# ═══════════════════════════════════════════════
# PER-SP SETTLEMENT (called after BM closes for each SP)
# ═══════════════════════════════════════════════

def _settle_sp(rs: dict, sp: int) -> dict:
    """Settle imbalances for a single SP after BM clearing."""
    market = rs["markets"].get(sp)
    if not market or not market.get("actual"):
        return {}

    actual = market["actual"]
    game_mode = rs.get("gameMode", "FULL")
    gm_cfg = GAME_MODES.get(game_mode, GAME_MODES["FULL"])
    forgive_mult = FORGIVENESS["penaltyMultiplier"] if gm_cfg.get("forgiveness") else 1
    cashout = rs.get("cashoutMode", CASHOUT_MODE)

    # Update system-level metrics ONCE per SP
    system_niv = actual.get("niv", 0)
    stress_threshold = SCORING_CONFIG.get("stressNIVThreshold", 300)
    is_stress = abs(system_niv) > stress_threshold

    rs["systemState"] = update_system_state(rs["systemState"], {
        "sp": sp,
        "niv": system_niv,
        "balancingCost": abs(system_niv) * actual.get("sbp", 50) * 0.01,
        "freq": actual.get("freq", 50),
    })

    settlements: dict[str, dict] = {}

    for pid, ps in rs["playerStates"].items():
        role = ps.get("role", "GENERATOR")
        asset_key = ps.get("asset", "")

        # Contracted position from day-level trading (DA + IDA1 + IDA2 + ID)
        contract_pos_mw = rs["positions"].get(pid, {}).get(sp, 0)

        # BM accepted volume for this SP
        bm_result = rs["bmResults"].get(sp, {})
        bm_acc_mw = 0
        for acc in bm_result.get("accepted", []):
            if (acc.get("id") == pid or acc.get("player_id") == pid):
                mw = acc.get("mwAcc", 0)
                bm_acc_mw += mw if actual.get("isShort") else -mw

        # Actual physical = contracted + BM adjustment
        actual_physical = contract_pos_mw + bm_acc_mw
        if asset_key in (actual.get("trippedAssets") or []):
            actual_physical = 0

        # Compute deviation
        if role == "SUPPLIER":
            base_load = ps.get("baseLoadMw", 80)
            customer_demand = supplier_demand_mw(sp, base_load)
            deviation = contract_pos_mw - customer_demand
            ps["customerDemandMw"] = customer_demand
        else:
            deviation = actual_physical - contract_pos_mw

        # Cashout pricing: single (post-P305) or dual (pre-2015)
        if cashout == "single":
            imb_price = actual.get("sbp", 50)
            imb_pen = deviation * imb_price * SP_DURATION_H * forgive_mult
        else:
            imb_pen = (
                deviation * actual["ssp"] * SP_DURATION_H * forgive_mult
                if deviation >= 0
                else deviation * actual["sbp"] * SP_DURATION_H * forgive_mult
            )

        # Operating cost (fuel/wear)
        asset_def = ASSETS.get(asset_key, {})
        var_cost = asset_def.get("varCost", 0) or asset_def.get("wear", 0)
        operating_cost = -(abs(actual_physical) * var_cost * SP_DURATION_H)

        sp_cash_delta = imb_pen + operating_cost
        ps["cash"] = ps.get("cash", 0) + sp_cash_delta
        if imb_pen < -5:
            ps["imbalancePenalty"] = ps.get("imbalancePenalty", 0) + abs(imb_pen)

        # Per-player system impact
        sp_impact = compute_player_system_impact(deviation, system_niv)
        delivered_ok = abs(deviation) < 5
        rs["systemState"]["playerImpacts"] = update_player_impact(
            rs["systemState"]["playerImpacts"], pid, sp_impact, is_stress, delivered_ok
        )

        # Append to spHistory
        bm_rev = sum(
            a.get("revenue", 0) for a in bm_result.get("accepted", [])
            if a.get("id") == pid or a.get("player_id") == pid
        )
        da_rev = sum(
            a.get("revenue", 0)
            for a in rs["daResults"].get(sp, {}).get("accepted_bids", [])
            if a.get("id") == pid
        )
        ida1_rev = sum(
            a.get("revenue", 0)
            for a in rs.get("ida1Results", {}).get(sp, {}).get("accepted_bids", [])
            if a.get("id") == pid
        )
        ida2_rev = sum(
            a.get("revenue", 0)
            for a in rs.get("ida2Results", {}).get(sp, {}).get("accepted_bids", [])
            if a.get("id") == pid
        )

        sp_record = {
            "sp": sp,
            "revenue": bm_rev + da_rev + ida1_rev + ida2_rev + imb_pen + operating_cost,
            "bmRev": bm_rev,
            "daRev": da_rev,
            "ida1Rev": ida1_rev,
            "ida2Rev": ida2_rev,
            "idRev": 0,
            "contractPosMw": contract_pos_mw,
            "accepted": bm_acc_mw != 0,
            "isShort": actual.get("isShort", False),
            "niv": system_niv,
            "sbp": actual.get("sbp", 50),
            "ssp": actual.get("ssp", 40),
            "cp": actual.get("cp") or actual.get("sbp", 50),
        }
        if "spHistory" not in ps:
            ps["spHistory"] = []
        ps["spHistory"].append(sp_record)

        settlements[pid] = {
            "deviation": deviation,
            "imbalancePenalty": imb_pen,
            "operatingCost": operating_cost,
            "cashDelta": sp_cash_delta,
            "cash": ps["cash"],
            "soc": ps.get("soc", 50),
            "contractPosMw": contract_pos_mw,
            "bmAccMw": bm_acc_mw,
            "actualPhysical": actual_physical,
            "physicalStatus": ps.get("physicalStatus", "ONLINE"),
        }

    # BSUoS socialization: spread total imbalance cost across all players
    total_imb_cost = sum(
        abs(s.get("imbalancePenalty", 0))
        for s in settlements.values()
        if s.get("imbalancePenalty", 0) < 0
    )
    num_players = len(settlements) or 1
    bsuos_per_player = -(total_imb_cost / num_players) if total_imb_cost > 0 else 0

    for pid, sdata in settlements.items():
        ps = rs["playerStates"].get(pid)
        if ps and bsuos_per_player != 0:
            ps["cash"] = ps.get("cash", 0) + bsuos_per_player
            sdata["cashDelta"] = sdata.get("cashDelta", 0) + bsuos_per_player
            sdata["cash"] = ps["cash"]
        sdata["bsuosCharge"] = bsuos_per_player

    return settlements


# ═══════════════════════════════════════════════
# END OF DAY
# ═══════════════════════════════════════════════

def _finalize_day(rs: dict) -> dict:
    """Compute final scores at end of day (after all 48 SPs settled)."""
    scores = {}
    for pid, ps in rs["playerStates"].items():
        role = ps.get("role", "GENERATOR")
        asset_key = ps.get("asset", "")

        player_stats = build_player_stats(role, {
            "spHistory": ps.get("spHistory", []),
            "assetKey": asset_key,
            "cash": ps.get("cash", 0),
            "daCash": ps.get("daCash", 0),
            "imbalancePenalty": ps.get("imbalancePenalty", 0),
            "systemImpacts": rs["systemState"]["playerImpacts"],
            "pid": pid,
            "systemState": rs["systemState"],
            "spContracts": {},
        })

        role_result = compute_role_score(role, player_stats)
        system_score = compute_system_score(
            rs["systemState"]["playerImpacts"].get(pid)
        )
        overall_score = compute_overall_score(role_result["roleScore"], system_score)

        ps["roleScore"] = role_result["roleScore"]
        ps["systemScore"] = system_score
        ps["overallScore"] = overall_score

        scores[pid] = {
            "roleScore": role_result["roleScore"],
            "roleDetail": role_result,
            "systemScore": system_score,
            "overallScore": overall_score,
            "cash": ps["cash"],
        }

    _emit(rs, "DAY_FINALIZED", {"day": rs["day"], "scores": {
        pid: {"roleScore": s["roleScore"], "systemScore": s["systemScore"], "overallScore": s["overallScore"], "cash": s["cash"]}
        for pid, s in scores.items()
    }})
    return {"scores": scores, "day": rs["day"]}


def _start_new_day(rs: dict) -> dict:
    """Reset day-level state for a new trading day."""
    rs["day"] += 1
    rs["currentSp"] = 0
    rs["bmSubPhase"] = None
    rs["markets"] = {}
    rs["positions"] = {}
    rs["daOrderBook"] = {}
    rs["daCurves"] = {}
    rs["ida1OrderBook"] = {}
    rs["ida2OrderBook"] = {}
    rs["idOrderBook"] = {}
    rs["bmOrderBook"] = {}
    rs["nesoOverrides"] = {}
    rs["daResults"] = {}
    rs["ida1Results"] = {}
    rs["ida2Results"] = {}
    rs["bmResults"] = {}
    rs["spSettlements"] = {}
    rs["phaseStartTs"] = int(time.time() * 1000)
    # Reset nested SP timeline and ID round counter
    rs["spTimeline"] = {
        sp: {"phase": "ID_OPEN", "gateClosed": False, "bmSubPhase": None}
        for sp in range(1, SPS_PER_DAY + 1)
    }
    rs["idRound"] = 0
    # playerStates, systemState, forecastEngine persist across days
    return {"newDay": rs["day"]}


# ═══════════════════════════════════════════════
# BID SUBMISSION
# ═══════════════════════════════════════════════

# ── Validation helpers ──

_MAX_PRICE = 9999
_MIN_PRICE = -500
_MAX_MW = 2000  # absolute ceiling (largest asset is NUCLEAR at 1000 MW)

def _is_num(v) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def _validate_bid(bid: dict, rs: dict, player_id: str | None = None) -> str | None:
    """Return an error string if the bid is malformed, else None."""
    mw = bid.get("mw")
    price = bid.get("price")
    sp = bid.get("sp")

    if mw is not None:
        if not _is_num(mw) or float(mw) < 0:
            return f"MW must be a non-negative number, got {mw}"
        if float(mw) > _MAX_MW:
            return f"MW must be <= {_MAX_MW}, got {mw}"

    if price is not None:
        if not _is_num(price):
            return f"Price must be a number, got {price}"
        p = float(price)
        if p < _MIN_PRICE or p > _MAX_PRICE:
            return f"Price must be between {_MIN_PRICE} and {_MAX_PRICE}, got {p}"

    if sp is not None:
        try:
            sp_int = int(sp)
        except (TypeError, ValueError):
            return f"SP must be an integer 1-{SPS_PER_DAY}, got {sp}"
        if sp_int < 1 or sp_int > SPS_PER_DAY:
            return f"SP must be 1-{SPS_PER_DAY}, got {sp_int}"

    if player_id is not None:
        ps = rs.get("playerStates", {})
        if ps and player_id not in ps:
            return f"Unknown player {player_id}"

    return None


def submit_da_bids(room_id: str, player_id: str, bids: list[dict]) -> dict:
    """
    Submit DA bids for multiple SPs.
    bids: [ { sp, side, mw, price }, ... ]
    If sp is omitted, bid applies to all SPs.
    """
    rs = _get_room(room_id)
    for b in bids:
        err = _validate_bid(b, rs, player_id)
        if err:
            return {"success": False, "error": err}
    rs["daOrderBook"][player_id] = bids
    return {"success": True, "count": len(bids)}


def submit_da_curve(room_id: str, player_id: str, curve: dict) -> dict:
    """Submit a DA curve for the full auction mechanism."""
    rs = _get_room(room_id)
    segments = curve.get("segments", [])
    if segments:
        val = validate_full_curve(segments)
        if not val["valid"]:
            return {"success": False, "error": "; ".join(val["errors"])}
    rs["daCurves"][player_id] = curve
    return {"success": True}


def submit_ida_bids(room_id: str, ida_round: str, player_id: str,
                    bids: list[dict]) -> dict:
    """
    Submit IDA bids for multiple SPs.
    ida_round: "IDA1" or "IDA2"
    """
    rs = _get_room(room_id)
    if ida_round.upper() not in ("IDA1", "IDA2"):
        return {"success": False, "error": f"Invalid IDA round: {ida_round}"}
    for b in bids:
        err = _validate_bid(b, rs, player_id)
        if err:
            return {"success": False, "error": err}
    ob_key = f"{ida_round.lower()}OrderBook"
    rs[ob_key][player_id] = bids
    return {"success": True, "count": len(bids)}


def submit_id_orders(room_id: str, player_id: str,
                     orders: list[dict]) -> dict:
    """Submit continuous ID orders for specific SPs."""
    rs = _get_room(room_id)
    for o in orders:
        err = _validate_bid(o, rs, player_id)
        if err:
            return {"success": False, "error": err}
    rs["idOrderBook"][player_id] = orders
    return {"success": True, "count": len(orders)}


def submit_bm_bid(room_id: str, player_id: str, bid: dict) -> dict:
    """Submit a BM bid for the current SP (during REALTIME only)."""
    rs = _get_room(room_id)
    err = _validate_bid(bid, rs, player_id)
    if err:
        return {"success": False, "error": err}
    rs["bmOrderBook"][player_id] = {**bid, "id": player_id}
    return {"success": True, "sp": rs["currentSp"]}


def submit_neso_overrides(room_id: str, sp: int, overrides: dict) -> dict:
    """NESO player submits acceptance overrides for a specific SP's BM."""
    rs = _get_room(room_id)
    if not isinstance(sp, int) or sp < 1 or sp > SPS_PER_DAY:
        return {"success": False, "error": f"SP must be 1-{SPS_PER_DAY}"}
    vol_cap = overrides.get("volumeCap")
    if vol_cap is not None:
        if not _is_num(vol_cap) or float(vol_cap) < 0:
            return {"success": False, "error": "volumeCap must be non-negative"}
    player_states = rs.get("playerStates", {})
    for key in ("reject", "priority"):
        ids = overrides.get(key, [])
        if not isinstance(ids, list):
            return {"success": False, "error": f"{key} must be a list"}
        for pid in ids:
            if pid not in player_states:
                return {"success": False, "error": f"Unknown player {pid} in {key}"}
    rs.setdefault("nesoOverrides", {})[sp] = overrides
    return {"success": True}


# ═══════════════════════════════════════════════
# PHASE 2 — EVENT REPLAY (cold-start recovery)
# ═══════════════════════════════════════════════

def replay_from_events(
    room_id: str,
    players: list[dict],
    events: list[dict],
    scenario_id: str = "NORMAL",
) -> dict:
    """Rebuild room state by hydrating from a persisted event log.

    Called by server.py when the API restarts mid-game and a room is not found
    in _room_states.  Uses two reconstruction strategies:

    1. **Re-run** for deterministic phases (FORECAST_*): calls _on_forecast()
       with the same scenarioId — same seeded RNG → identical market output.
    2. **Hydrate** for clearing phases (DA, IDA, BM, ID): reads positions and
       cash from the event payloads (which capture final per-player values).

    The recovered state is approximate: order books (DA curves, BM bids) are
    empty, meaning players must re-submit for the current open phase.  All
    settled cash, positions and scores are restored accurately.

    Parameters:
        players     List of player dicts from DB (player_id, name, role, asset,
                    cash, da_cash, sof).
        events      Ordered list from event_log (sequence, event_type, data).
        scenario_id From rooms table.

    Returns the rebuilt room state dict; also sets _room_states[room_id].
    """
    rs = _new_room_state()
    rs["scenarioId"] = scenario_id

    # ── Hydrate players from DB ──────────────────────────────────────────────
    for p in players:
        pid = p.get("player_id") or p.get("id")
        if not pid:
            continue
        asset_key = p.get("asset") or ""
        asset_def = ASSETS.get(asset_key, {})
        rs["playerStates"][pid] = {
            "name": p.get("name", pid),
            "role": p.get("role", "GENERATOR"),
            "asset": asset_key,
            "cash": float(p.get("cash", 0)),
            "daCash": float(p.get("da_cash", 0)),
            "soc": float(p.get("sof", 50)),
            "spHistory": [],
            "imbalancePenalty": 0,
            "physicalStatus": "ONLINE",
            "baseLoadMw": 80,
        }
        # Initialise position dict (filled per SP during replay)
        rs["positions"][pid] = {}

    # ── Replay events oldest → newest ────────────────────────────────────────
    for ev in sorted(events, key=lambda e: e.get("sequence", 0)):
        et = ev["event_type"]
        data = ev.get("data", {})
        event_ts = _event_ts_ms(ev)

        def _mark_phase_start() -> None:
            if event_ts is not None:
                rs["phaseStartTs"] = event_ts

        if et == "FORECAST_GENERATED":
            # Re-run deterministically: same scenarioId + seed → identical markets
            phase = data.get("phase", "FORECAST_0")
            _on_forecast(rs, phase)
            rs["dayPhase"] = "DA"  # next expected phase after FORECAST_0
            _mark_phase_start()

        elif et == "FORECAST_REFINED":
            phase = data.get("phase", "FORECAST_1")
            _on_forecast(rs, phase)
            # Phase after FORECAST_1 is IDA1; after FORECAST_2 is IDA2
            rs["dayPhase"] = {"FORECAST_1": "IDA1", "FORECAST_2": "IDA2"}.get(phase, "IDA1")
            _mark_phase_start()

        elif et == "DA_CLEARED":
            replay_state = data.get("replayState")
            if replay_state:
                _hydrate_replay_state(rs, replay_state)
            rs["dayPhase"] = "FORECAST_1"
            _mark_phase_start()

        elif et == "IDA_CLEARED":
            replay_state = data.get("replayState")
            if replay_state:
                _hydrate_replay_state(rs, replay_state)
            ida_round = data.get("round", "IDA1")
            rs["dayPhase"] = "FORECAST_2" if ida_round == "IDA1" else "ID_ROUNDS"
            _mark_phase_start()

        elif et == "ID_CLOSED":
            replay_state = data.get("replayState")
            if replay_state:
                _hydrate_replay_state(rs, replay_state)
            else:
                # Backward-compatible fallback for older sparse events.
                for pid, sp_deltas in data.get("positionDeltas", {}).items():
                    if not isinstance(sp_deltas, dict):
                        continue
                    for sp, delta in sp_deltas.items():
                        rs["positions"].setdefault(pid, {})[int(sp)] = (
                            rs["positions"].get(pid, {}).get(int(sp), 0) + float(delta)
                        )
                for pid, cash_delta in data.get("cashDeltas", {}).items():
                    ps = rs["playerStates"].get(pid)
                    if ps:
                        ps["cash"] = ps.get("cash", 0) + float(cash_delta)
            rs["dayPhase"] = "REALTIME"
            rs["currentSp"] = 1
            rs["bmSubPhase"] = "BM_OPEN"
            _recompute_niv_for_sp(rs, 1)
            _mark_phase_start()
            # Freeze replayed positions for BM.
            rs["frozenPositions"] = {
                pid: dict(sps) for pid, sps in rs["positions"].items()
            }

        elif et == "BM_CLEARED":
            sp = data.get("sp", 1)
            rs["currentSp"] = sp
            rs["dayPhase"] = "REALTIME"
            rs["bmSubPhase"] = "SP_SETTLED"
            # Hydrate per-player cash and SoC from event (most accurate post-settlement values)
            for pid, s in data.get("playerSettlements", {}).items():
                ps = rs["playerStates"].get(pid)
                if not ps:
                    continue
                if "cash" in s:
                    ps["cash"] = s["cash"]
                if "soc" in s:
                    ps["soc"] = s["soc"]
            # Store settlement data
            rs["spSettlements"][sp] = data.get("playerSettlements", {})
            _mark_phase_start()

        elif et == "DAY_FINALIZED":
            rs["dayPhase"] = "RESULTS"
            rs["currentSp"] = 0
            rs["bmSubPhase"] = None
            for pid, s in data.get("scores", {}).items():
                ps = rs["playerStates"].get(pid)
                if ps:
                    for key in ("roleScore", "systemScore", "overallScore", "cash"):
                        if key in s:
                            ps[key] = s[key]
            _mark_phase_start()

        # Track event sequence watermark
        rs["_eventSeq"] = max(rs.get("_eventSeq", 0), ev.get("sequence", 0))

    # ── Atomically install recovered state ───────────────────────────────────
    _room_states[room_id] = rs
    print(
        f"[replay] room {room_id!r}: recovered {len(events)} events → "
        f"phase={rs['dayPhase']} sp={rs['currentSp']} "
        f"players={len(rs['playerStates'])}"
    )
    return rs


# ═══════════════════════════════════════════════
# PLAYER MANAGEMENT
# ═══════════════════════════════════════════════

def register_player(room_id: str, player_id: str, data: dict) -> dict:
    rs = _get_room(room_id)
    asset_key = data.get("asset", "")
    asset_def = ASSETS.get(asset_key, {})

    rs["playerStates"][player_id] = {
        "name": data.get("name", ""),
        "asset": asset_key,
        "role": data.get("role", "GENERATOR"),
        "cash": data.get("cash", 0),
        "daCash": data.get("daCash", 0),
        "soc": init_sof(asset_def),
        "baseLoadMw": data.get("baseLoadMw", 80),
        "imbalancePenalty": 0,
        "spHistory": [],
        "physicalStatus": "ONLINE",
        "roleScore": 0,
        "systemScore": 0,
        "overallScore": 0,
    }

    # Initialise positions if markets already generated
    if rs["markets"]:
        rs["positions"][player_id] = {
            sp: 0.0 for sp in range(1, SPS_PER_DAY + 1)
        }

    return {"success": True, "playerId": player_id}


# ═══════════════════════════════════════════════
# FORECAST MANAGEMENT
# ═══════════════════════════════════════════════

def publish_forecast(room_id: str, forecast_data: dict | None = None) -> dict:
    rs = _get_room(room_id)
    fe = rs["forecastEngine"]

    if forecast_data:
        version = fe.create_manual(
            author=forecast_data.get("author", "NESO"),
            demand_ts=forecast_data.get("demand", []),
            wind_ts=forecast_data.get("wind", []),
            solar_ts=forecast_data.get("solar", []),
        )
    else:
        version = fe.auto_generate()

    rs["publishedForecast"] = version.to_dict()
    return rs["publishedForecast"]


# ═══════════════════════════════════════════════
# ROOM CONFIG
# ═══════════════════════════════════════════════

def set_room_config(room_id: str, config: dict) -> dict:
    rs = _get_room(room_id)
    for key in ("scenarioId", "cashoutMode", "gameMode", "tickSpeed", "paused",
                "advanceMode", "simSpeedId", "simSpeedFactor"):
        if key in config:
            rs[key] = config[key]
    # When advanceMode or simSpeedFactor changes, recalculate current tickSpeed
    if "advanceMode" in config or "simSpeedFactor" in config:
        _apply_phase_tick(rs)
    return {"success": True}


# ═══════════════════════════════════════════════
# NESTED SP TIMELINE — per-SP gate closure + trading eligibility
# ═══════════════════════════════════════════════

# ID gate closure schedule: SPs close in batches as delivery approaches.
# In real GB, gate closure is 1h before delivery for each SP.
# We model this as 4 rounds during ID_ROUNDS, closing ~12 SPs each.
_ID_GC_BATCHES = [
    list(range(1, 13)),     # Round 1: SPs 1-12 (nearest delivery)
    list(range(13, 25)),    # Round 2: SPs 13-24
    list(range(25, 37)),    # Round 3: SPs 25-36
    list(range(37, 49)),    # Round 4: SPs 37-48 (furthest)
]


def _advance_id_sub_round(rs: dict) -> dict:
    """Advance one ID gate-closure sub-round.

    Each sub-round closes the next batch of SPs for intraday trading and
    runs order-book clearing only for the newly-closed SPs.  After all
    batches are closed, the ID_ROUNDS phase is complete.

    Returns a result dict describing what happened.
    """
    current_round = rs.get("idRound", 0)
    if current_round >= len(_ID_GC_BATCHES):
        return {"idRoundsComplete": True, "idRound": current_round}

    closing_sps = _ID_GC_BATCHES[current_round]
    timeline = rs.get("spTimeline", {})

    # Mark these SPs as gate-closed
    for sp in closing_sps:
        tl = timeline.get(sp)
        if tl:
            tl["gateClosed"] = True
            tl["phase"] = "GC_PASSED"

    # Clear ID orders only for the newly-closed SPs
    id_book = rs.get("idOrderBook", {})
    id_result = clear_id_round(id_book, open_sps=closing_sps)

    # Apply position deltas from matched trades
    for pid, sp_deltas in id_result.get("positionDeltas", {}).items():
        for sp_key, delta in sp_deltas.items():
            rs["positions"].setdefault(pid, {})[sp_key] = (
                rs["positions"].get(pid, {}).get(sp_key, 0) + delta
            )

    # Apply cash deltas
    for pid, cash_delta in id_result.get("cashDeltas", {}).items():
        ps = rs["playerStates"].get(pid)
        if ps:
            ps["cash"] = ps.get("cash", 0) + cash_delta

    rs["idRound"] = current_round + 1

    _emit(rs, "ID_GC_ROUND", {
        "round": current_round + 1,
        "closedSps": closing_sps,
        "tradesMatched": len(id_result.get("trades", [])),
        "totalVolumeMW": id_result.get("totalVolume", 0),
    })

    return {
        "idRound": current_round + 1,
        "closedSps": closing_sps,
        "idTradesMatched": len(id_result.get("trades", [])),
        "totalVolumeMW": id_result.get("totalVolume", 0),
        "idRoundsComplete": (current_round + 1) >= len(_ID_GC_BATCHES),
    }


def can_trade_sp(rs: dict, sp: int) -> bool:
    """Check if a given SP is still tradable in the current phase.

    DA/IDA: all 48 SPs tradable (parallel auction).
    IDA2: real GB only covers SPs 25-48, but we keep all 48 for simplicity.
    ID_ROUNDS: tradable until gate closure for that SP.
    REALTIME: no ID trading (BM only).
    """
    day_phase = rs.get("dayPhase")
    if day_phase in ("DA", "IDA1", "IDA2"):
        return True
    if day_phase == "ID_ROUNDS":
        timeline = rs.get("spTimeline", {}).get(sp, {})
        return not timeline.get("gateClosed", False)
    return False


def advance_game(room_id: str) -> dict:
    """Unified advance: routes to the correct inner handler.

    Single entry point for NESO / Instructor button clicks.
    Replaces the need for clients to distinguish advance_day_phase vs advance_bm.

    During ID_ROUNDS: advances gate-closure sub-rounds, then transitions
    to REALTIME once all ID rounds complete.

    During REALTIME: delegates to advance_bm().

    All other phases: delegates to advance_day_phase().
    """
    rs = _get_room(room_id)
    phase = rs["dayPhase"]

    if phase == "REALTIME":
        return advance_bm(room_id)

    if phase == "ID_ROUNDS":
        # Advance within ID sub-rounds (gate closure batches)
        snap = _snapshot(rs)
        result: dict[str, Any] = {"day": snap["day"], "oldPhase": "ID_ROUNDS"}

        sub_result = _advance_id_sub_round(snap)
        result.update(sub_result)

        if sub_result.get("idRoundsComplete"):
            # All ID rounds done — run final ID close and transition to REALTIME
            result.update(_on_id_close(snap))

            snap["dayPhase"] = "REALTIME"
            snap["currentSp"] = 1
            snap["bmSubPhase"] = "BM_OPEN"
            snap["bmOrderBook"] = {}
            _recompute_niv_for_sp(snap, 1)

            # Mark all SPs as BM_OPEN in timeline
            for sp in range(1, SPS_PER_DAY + 1):
                tl = snap.get("spTimeline", {}).get(sp, {})
                tl["phase"] = "BM_OPEN"
                tl["bmSubPhase"] = "BM_OPEN"

            result["newPhase"] = "REALTIME"
            result["currentSp"] = 1

        snap["phaseStartTs"] = int(time.time() * 1000)
        snap["playerReady"] = {}
        _apply_phase_tick(snap)

        _room_states[room_id] = snap
        result["dayPhase"] = snap["dayPhase"]
        result["currentSp"] = snap["currentSp"]
        result["bmSubPhase"] = snap["bmSubPhase"]
        return result

    # All other day-level phases
    return advance_day_phase(room_id)


# ═══════════════════════════════════════════════
# BACKWARD COMPATIBILITY ALIASES
# ═══════════════════════════════════════════════

def advance_phase(room_id: str) -> dict:
    """
    COMPAT: Routes to advance_day_phase() or advance_bm() depending
    on current phase.  New code should call the specific function.
    """
    rs = _get_room(room_id)
    if rs["dayPhase"] == "REALTIME":
        return advance_bm(room_id)
    return advance_day_phase(room_id)


def generate_market(room_id: str, sp: int | None = None) -> dict:
    """COMPAT: Generates all 48 SP markets (equivalent to FORECAST)."""
    return generate_all_markets(room_id)


def settle_current_sp(room_id: str) -> dict:
    """COMPAT: Settle the current SP during REALTIME."""
    rs = _get_room(room_id)
    sp = rs["currentSp"]
    if sp < 1:
        return {}
    settlement = _settle_sp(rs, sp)
    rs["spSettlements"][sp] = settlement
    return {"settlements": settlement}
