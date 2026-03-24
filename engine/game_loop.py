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

from .constants import (
    ASSETS, SP_DURATION_H, SPS_PER_DAY, FORGIVENESS, SCORING_CONFIG,
    GAME_MODES, CASHOUT_MODE, IDA_CONFIG,
)
from .market_engine import (
    market_for_sp, clear_bm, clear_da, clear_ida, ida_forecast,
    feedback_market_state, compute_forecasts, generate_forecast_update,
)
from .asset_physics import init_sof, supplier_demand_mw
from .scoring_engine import compute_role_score, compute_system_score, compute_overall_score
from .physical_engine import (
    create_system_state, update_system_state,
    compute_player_system_impact, update_player_impact, build_player_stats,
)
from .da_curve_engine import clear_full_auction
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


def _new_room_state() -> dict:
    return {
        # Day / phase tracking
        "day": 1,
        "dayPhase": "FORECAST_0",
        "currentSp": 0,             # 0 = not in REALTIME; 1-48 during REALTIME
        "bmSubPhase": None,          # "BM_OPEN" | "BM_CLEAR" | "SP_SETTLED"

        # Config
        "scenarioId": "NORMAL",
        "gameMode": "FULL",
        "cashoutMode": CASHOUT_MODE,
        "tickSpeed": 15000,
        "paused": False,

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

        # Forecast
        "forecastEngine": ForecastEngine(),
        "publishedForecast": None,

        # Forecast update bulletins shown to all players between phases.
        # Each entry produced by generate_forecast_update(); last 10 kept.
        # Maps directly to real GB weather-model-run cadence:
        #   FORECAST_0 → 06Z initial run (D-1 06:00)
        #   FORECAST_1 → 12Z run (D-1 after DA 09:30)
        #   FORECAST_2 → 06Z short-range run (D 07:30)
        "forecastUpdateHistory": [],
    }


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
        "scenarioId": rs["scenarioId"],
        "gameMode": rs["gameMode"],
        "cashoutMode": rs["cashoutMode"],
        "tickSpeed": rs["tickSpeed"],
        "paused": rs["paused"],
        "markets": rs["markets"],
        "positions": rs["positions"],
        "playerStates": rs["playerStates"],
        "daResults": rs["daResults"],
        "bmResults": rs["bmResults"],
        "spSettlements": rs["spSettlements"],
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
    """
    rs = _get_room(room_id)
    old_phase = rs["dayPhase"]
    result: dict[str, Any] = {"oldPhase": old_phase, "day": rs["day"]}

    # --- Exit actions for the phase we're leaving ---

    if old_phase.startswith("FORECAST_"):
        result.update(_on_forecast(rs, old_phase))

    elif old_phase == "DA":
        result.update(_on_da_close_all(rs))

    elif old_phase in ("IDA1", "IDA2"):
        result.update(_on_ida_close_all(rs, old_phase))

    elif old_phase == "ID_ROUNDS":
        result.update(_on_id_close(rs))

    elif old_phase == "REALTIME":
        return {"error": "Use advance_bm() during REALTIME phase",
                "dayPhase": old_phase, "currentSp": rs["currentSp"]}

    elif old_phase == "RESULTS":
        result.update(_start_new_day(rs))
        rs["dayPhase"] = "FORECAST_0"
        result["newPhase"] = rs["dayPhase"]
        return result

    # --- Determine next phase ---

    if old_phase == "ID_ROUNDS":
        # After ID_ROUNDS, always enter REALTIME
        rs["dayPhase"] = "REALTIME"
        rs["currentSp"] = 1
        rs["bmSubPhase"] = "BM_OPEN"
        rs["bmOrderBook"] = {}
    else:
        rs["dayPhase"] = _next_day_phase(old_phase, rs)
        # If we jumped straight to REALTIME (e.g. TUTORIAL skips DA/IDA/ID)
        if rs["dayPhase"] == "REALTIME":
            rs["currentSp"] = 1
            rs["bmSubPhase"] = "BM_OPEN"
            rs["bmOrderBook"] = {}

    result["newPhase"] = rs["dayPhase"]
    result["currentSp"] = rs["currentSp"]
    return result


# ═══════════════════════════════════════════════
# REALTIME / BM PHASE (SP-by-SP)
# ═══════════════════════════════════════════════

def advance_bm(room_id: str) -> dict:
    """
    Advance within the REALTIME phase.
    Cycles: BM_OPEN → BM_CLEAR → SP_SETTLED → (next SP) BM_OPEN → ...
    After SP 48 is settled, transitions to RESULTS.
    """
    rs = _get_room(room_id)
    if rs["dayPhase"] != "REALTIME":
        return {"error": f"Not in REALTIME (current: {rs['dayPhase']})"}

    sp = rs["currentSp"]
    sub = rs["bmSubPhase"]
    result: dict[str, Any] = {"day": rs["day"], "sp": sp}

    if sub == "BM_OPEN":
        # Clear BM for this SP: merit order clearing, feedback, compute NIV
        result.update(_on_bm_close_sp(rs, sp))
        rs["bmSubPhase"] = "BM_CLEAR"

    elif sub == "BM_CLEAR":
        # Settlement: imbalance charges, P&L, system metrics
        rs["bmSubPhase"] = "SP_SETTLED"

    elif sub == "SP_SETTLED":
        if sp >= SPS_PER_DAY:
            # All SPs done → finalise day scores
            result.update(_finalize_day(rs))
            rs["dayPhase"] = "RESULTS"
            rs["currentSp"] = 0
            rs["bmSubPhase"] = None
        else:
            # Move to next SP
            rs["currentSp"] = sp + 1
            rs["bmSubPhase"] = "BM_OPEN"
            rs["bmOrderBook"] = {}
            result["sp"] = sp + 1

    result["bmSubPhase"] = rs["bmSubPhase"]
    result["dayPhase"] = rs["dayPhase"]
    return result


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
        return {
            "marketsGenerated": SPS_PER_DAY,
            "forecastStage": phase,
            "errorMultiplier": err_mult,
            "forecastUpdateSummary": update_summary,
        }
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

        return {
            "marketsUpdated": updated,
            "forecastStage": phase,
            "errorMultiplier": err_mult,
            "forecastUpdateSummary": update_summary,
        }


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

    return {
        "idTradesMatched": len(id_result.get("trades", [])),
        "totalVolumeMW": id_result.get("totalVolume", 0),
        "trades": id_result.get("trades", []),
        "positionsFrozen": True,
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

        startup_deduction = 0
        if asset_def.get("startupCost") and sp > 1:
            prev_settlement = rs["spSettlements"].get(sp - 1, {}).get(pid, {})
            if prev_settlement.get("physicalStatus") != "ONLINE":
                startup_deduction = asset_def["startupCost"]

        net_revenue = bid.get("revenue", 0) - startup_deduction
        ps["cash"] = ps.get("cash", 0) + net_revenue

    # Settle this SP
    settlement = _settle_sp(rs, sp)
    rs["spSettlements"][sp] = settlement

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
                bm_acc_mw = mw if actual.get("isShort") else -mw

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
    # playerStates, systemState, forecastEngine persist across days
    return {"newDay": rs["day"]}


# ═══════════════════════════════════════════════
# BID SUBMISSION
# ═══════════════════════════════════════════════

def submit_da_bids(room_id: str, player_id: str, bids: list[dict]) -> dict:
    """
    Submit DA bids for multiple SPs.
    bids: [ { sp, side, mw, price }, ... ]
    If sp is omitted, bid applies to all SPs.
    """
    rs = _get_room(room_id)
    rs["daOrderBook"][player_id] = bids
    return {"success": True, "count": len(bids)}


def submit_da_curve(room_id: str, player_id: str, curve: dict) -> dict:
    """Submit a DA curve for the full auction mechanism."""
    rs = _get_room(room_id)
    rs["daCurves"][player_id] = curve
    return {"success": True}


def submit_ida_bids(room_id: str, ida_round: str, player_id: str,
                    bids: list[dict]) -> dict:
    """
    Submit IDA bids for multiple SPs.
    ida_round: "IDA1" or "IDA2"
    """
    rs = _get_room(room_id)
    ob_key = f"{ida_round.lower()}OrderBook"
    rs[ob_key][player_id] = bids
    return {"success": True, "count": len(bids)}


def submit_id_orders(room_id: str, player_id: str,
                     orders: list[dict]) -> dict:
    """Submit continuous ID orders for specific SPs."""
    rs = _get_room(room_id)
    rs["idOrderBook"][player_id] = orders
    return {"success": True, "count": len(orders)}


def submit_bm_bid(room_id: str, player_id: str, bid: dict) -> dict:
    """Submit a BM bid for the current SP (during REALTIME only)."""
    rs = _get_room(room_id)
    rs["bmOrderBook"][player_id] = {**bid, "id": player_id}
    return {"success": True, "sp": rs["currentSp"]}


def submit_neso_overrides(room_id: str, sp: int, overrides: dict) -> dict:
    """NESO player submits acceptance overrides for a specific SP's BM."""
    rs = _get_room(room_id)
    rs.setdefault("nesoOverrides", {})[sp] = overrides
    return {"success": True}


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
        "physicalStatus": (
            "OFFLINE" if asset_def.get("startupTime", 0) > 0 else "ONLINE"
        ),
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
    for key in ("scenarioId", "cashoutMode", "gameMode", "tickSpeed", "paused"):
        if key in config:
            rs[key] = config[key]
    return {"success": True}


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
