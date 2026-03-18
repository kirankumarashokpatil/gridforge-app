"""
GridForge Scoring Engine — Python port of src/engine/ScoringEngine.js

Pure-function scoring engine for role-specific + system-wide player evaluation.
"""

from __future__ import annotations
import math

from .constants import SCORING_CONFIG
from .utils import clamp


# ─── Piecewise Linear Interpolation ───

def map_threshold(value: float, breakpoints: list[list[float]]) -> float:
    if not breakpoints:
        return 50.0
    if len(breakpoints) == 1:
        return breakpoints[0][1]

    if value <= breakpoints[0][0]:
        return breakpoints[0][1]
    if value >= breakpoints[-1][0]:
        return breakpoints[-1][1]

    for i in range(len(breakpoints) - 1):
        x0, y0 = breakpoints[i]
        x1, y1 = breakpoints[i + 1]
        if x0 <= value <= x1:
            if x1 == x0:
                return y0
            t = (value - x0) / (x1 - x0)
            return y0 + t * (y1 - y0)

    return breakpoints[-1][1]


# ─── ROLE SCORE COMPUTATION ───

def compute_role_score(role: str, stats: dict) -> dict:
    cfg = SCORING_CONFIG.get(role, SCORING_CONFIG["GENERATOR"])

    dispatch = {
        "TRADER": _trader_role_score,
        "GENERATOR": _generator_role_score,
        "BESS": _bess_role_score,
        "SUPPLIER": _supplier_role_score,
        "DSR": _dsr_role_score,
        "NESO": lambda s, c: _neso_role_score(s, SCORING_CONFIG["NESO"]),
        "ELEXON": lambda s, c: _elexon_role_score(s, SCORING_CONFIG["ELEXON"]),
        "INTERCONNECTOR": _interconnector_role_score,
    }

    fn = dispatch.get(role, lambda s, c: _generator_role_score(s, SCORING_CONFIG["GENERATOR"]))
    return fn(stats, cfg)


# ── Trader ──
def _trader_role_score(stats: dict, cfg: dict) -> dict:
    rar = stats.get("netProfit", 0) / max(1, stats.get("maxDrawdown", 1))
    primary_score = clamp(map_threshold(rar, cfg.get("breakpoints", [])), 0, 100)

    margin_evt_penalty = min(stats.get("marginEvents", 0), 10)
    secondary_score = clamp(100 - cfg.get("marginPenalty", 10) * margin_evt_penalty, 0, 100)

    pw = cfg.get("primaryWeight", 0.85)
    role_score = clamp(round(pw * primary_score + (1 - pw) * secondary_score), 0, 100)

    return {
        "roleScore": role_score,
        "primary": {"name": "Risk-Adjusted Return", "value": round(rar, 2), "score": round(primary_score)},
        "secondary": [
            {"name": "Margin Events", "value": stats.get("marginEvents", 0), "score": round(secondary_score)},
        ],
    }


# ── Generator ──
def _generator_role_score(stats: dict, cfg: dict) -> dict:
    cap_mw = stats.get("capacityMW", 1)
    profit_per_mw = stats.get("netProfit", 0) / cap_mw if cap_mw > 0 else 0
    primary_score = clamp(map_threshold(profit_per_mw, cfg.get("breakpoints", [])), 0, 100)

    imb_ref = 50
    total_mwh = stats.get("totalMWh", 1)
    imb_cost_per_mwh = abs(stats.get("imbalanceCost", 0)) / total_mwh if total_mwh > 0 else 0
    secondary_score = clamp(100 - (imb_cost_per_mwh / imb_ref) * 100, 0, 100)

    pw = cfg.get("primaryWeight", 0.80)
    role_score = clamp(round(pw * primary_score + (1 - pw) * secondary_score), 0, 100)

    return {
        "roleScore": role_score,
        "primary": {"name": "Profit/MW", "value": round(profit_per_mw), "score": round(primary_score)},
        "secondary": [
            {"name": "Imbalance Cost/MWh", "value": round(imb_cost_per_mwh, 1), "score": round(secondary_score)},
        ],
    }


# ── BESS ──
def _bess_role_score(stats: dict, cfg: dict) -> dict:
    mwh_shifted = max(1, stats.get("mwhShifted", 1))
    rev_per_mwh = stats.get("netProfit", 0) / mwh_shifted
    primary_score = clamp(map_threshold(rev_per_mwh, cfg.get("breakpoints", [])), 0, 100)

    total_revenue = stats.get("totalRevenue", 1)
    bm_share = stats.get("bmRevenue", 0) / total_revenue if total_revenue > 0 else 0
    bm_share_score = clamp(bm_share * 200, 0, 100)

    soc_penalties = stats.get("socPenalties", 0)
    soc_score = clamp(100 - soc_penalties * 20, 0, 100)

    secondary_score = (bm_share_score + soc_score) / 2

    pw = cfg.get("primaryWeight", 0.75)
    role_score = clamp(round(pw * primary_score + (1 - pw) * secondary_score), 0, 100)

    return {
        "roleScore": role_score,
        "primary": {"name": "£/MWh Shifted", "value": round(rev_per_mwh, 1), "score": round(primary_score)},
        "secondary": [
            {"name": "BM Revenue Share", "value": f"{round(bm_share * 100)}%", "score": round(bm_share_score)},
            {"name": "SoC Health", "value": f"{soc_penalties} penalties", "score": round(soc_score)},
        ],
    }


# ── Supplier ──
def _supplier_role_score(stats: dict, cfg: dict) -> dict:
    total_mwh = stats.get("totalMWh", 1)
    cost_per_mwh = abs(stats.get("netCost", 0)) / total_mwh if total_mwh > 0 else 80
    primary_score = clamp(map_threshold(cost_per_mwh, cfg.get("breakpoints", [])), 0, 100)

    hedge_ratio = clamp(stats.get("hedgeRatio", 0.5) * 100, 0, 100)
    net_cost = stats.get("netCost", 1)
    imb_pct = abs(stats.get("imbalanceCost", 0)) / net_cost * 100 if net_cost > 0 else 50
    imb_pct_score = clamp(100 - imb_pct * 2, 0, 100)

    secondary_score = (hedge_ratio + imb_pct_score) / 2

    pw = cfg.get("primaryWeight", 0.80)
    role_score = clamp(round(pw * primary_score + (1 - pw) * secondary_score), 0, 100)

    return {
        "roleScore": role_score,
        "primary": {"name": "Cost/MWh", "value": f"£{round(cost_per_mwh)}", "score": round(primary_score)},
        "secondary": [
            {"name": "Hedge Ratio", "value": f"{round(stats.get('hedgeRatio', 0) * 100)}%", "score": round(hedge_ratio)},
            {"name": "Imbalance % of Cost", "value": f"{round(imb_pct)}%", "score": round(imb_pct_score)},
        ],
    }


# ── DSR ──
def _dsr_role_score(stats: dict, cfg: dict) -> dict:
    reliability = clamp(stats.get("reliability", 1), 0, 1)
    rel_adj_rev = stats.get("netProfit", 0) * reliability
    primary_score = clamp(map_threshold(rel_adj_rev, cfg.get("breakpoints", [])), 0, 100)

    missed_events = stats.get("missedEvents", 0)
    secondary_score = clamp(100 - missed_events * 15, 0, 100)

    pw = cfg.get("primaryWeight", 0.80)
    role_score = clamp(round(pw * primary_score + (1 - pw) * secondary_score), 0, 100)

    return {
        "roleScore": role_score,
        "primary": {"name": "Reliability-Adj Rev", "value": f"£{round(rel_adj_rev)}", "score": round(primary_score)},
        "secondary": [
            {"name": "Missed Events", "value": missed_events, "score": round(secondary_score)},
        ],
    }


# ── NESO ──
def _neso_role_score(stats: dict, cfg: dict) -> dict:
    avg_abs_niv = stats.get("avgAbsNIV", 0)
    stability_score = clamp(100 - (avg_abs_niv / 6.2), 0, 100)

    total_sps = max(1, stats.get("totalSPs", 1))
    cost_per_sp = stats.get("totalSystemCost", 0) / total_sps
    cost_score = clamp(100 - (cost_per_sp / 50), 0, 100)

    mae_score = clamp(100 - (stats.get("forecastMAE", 0)) * 2, 0, 100)

    price_vol = stats.get("priceVolatility", 0)
    price_vol_score = clamp(100 - price_vol * 0.5, 0, 100)
    participation = clamp(stats.get("participationRate", 0.5) * 100, 0, 100)
    clearing_score = (price_vol_score + participation) / 2

    sw = cfg.get("stabilityWeight", 0.40)
    cw = cfg.get("costWeight", 0.20)
    mw = cfg.get("maeWeight", 0.15)
    clw = cfg.get("clearingWeight", 0.25)
    role_score = clamp(round(sw * stability_score + cw * cost_score + mw * mae_score + clw * clearing_score), 0, 100)

    return {
        "roleScore": role_score,
        "primary": {"name": "Stability Index", "value": round(stability_score), "score": round(stability_score)},
        "secondary": [
            {"name": "System Cost/SP", "value": f"£{round(cost_per_sp)}", "score": round(cost_score)},
            {"name": "Forecast MAE", "value": round(stats.get("forecastMAE", 0), 1), "score": round(mae_score)},
            {"name": "Clearing Quality", "value": round(clearing_score), "score": round(clearing_score)},
        ],
    }


# ── Elexon ──
def _elexon_role_score(stats: dict, cfg: dict) -> dict:
    settlement_error = stats.get("settlementError", 0)
    accuracy_score = clamp(100 - settlement_error * 5, 0, 100)

    on_time_rate = clamp(stats.get("onTimeRate", 1.0) * 100, 0, 100)
    audit_coverage = clamp(stats.get("auditCoverage", 1.0) * 100, 0, 100)

    aw = cfg.get("accuracyWeight", 0.50)
    tw = cfg.get("timelinessWeight", 0.30)
    trw = cfg.get("transparencyWeight", 0.20)
    role_score = clamp(round(aw * accuracy_score + tw * on_time_rate + trw * audit_coverage), 0, 100)

    return {
        "roleScore": role_score,
        "primary": {"name": "Settlement Accuracy", "value": f"{round(accuracy_score)}%", "score": round(accuracy_score)},
        "secondary": [
            {"name": "On-Time Rate", "value": f"{round(on_time_rate)}%", "score": round(on_time_rate)},
            {"name": "Audit Coverage", "value": f"{round(audit_coverage)}%", "score": round(audit_coverage)},
        ],
    }


# ── Interconnector ──
def _interconnector_role_score(stats: dict, cfg: dict) -> dict:
    congestion_rev = stats.get("congestionRevenue", 0)
    primary_score = clamp(map_threshold(congestion_rev, cfg.get("breakpoints", [])), 0, 100)

    availability = clamp(stats.get("availability", 1) * 100, 0, 100)
    stress_help = clamp(stats.get("stressContribution", 0) * 20, 0, 100)
    secondary_score = (availability + stress_help) / 2

    pw = cfg.get("primaryWeight", 0.80)
    role_score = clamp(round(pw * primary_score + (1 - pw) * secondary_score), 0, 100)

    return {
        "roleScore": role_score,
        "primary": {"name": "Congestion Revenue", "value": f"£{round(congestion_rev)}", "score": round(primary_score)},
        "secondary": [
            {"name": "Availability", "value": f"{round(availability)}%", "score": round(availability)},
            {"name": "Stress Help", "value": round(stats.get("stressContribution", 0), 1), "score": round(stress_help)},
        ],
    }


# ─── SYSTEM SCORE ───

def compute_system_score(metrics: dict | None) -> int:
    if not metrics:
        return 50

    niv_base = clamp(50 + (metrics.get("totalNIVContribution", 0)) * 0.1, 0, 100)
    stress_bonus = min((metrics.get("stressWindowHelps", 0)) * 5, 25)
    missed_penalty = (metrics.get("missedDeliveries", 0)) * 10
    blackout_penalty = 40 if metrics.get("causedBlackout") else 0

    return clamp(round(niv_base + stress_bonus - missed_penalty - blackout_penalty), 0, 100)


# ─── OVERALL SCORE ───

def compute_overall_score(role_score: int, system_score: int, alpha: float | None = None) -> int:
    a = alpha if alpha is not None else SCORING_CONFIG.get("alpha", 0.6)
    return clamp(round(a * role_score + (1 - a) * system_score), 0, 100)


# ─── MULTI-ROUND FINAL SCORE ───

def compute_final_score(overall_scores: list[float]) -> int:
    if not overall_scores:
        return 0
    n = len(overall_scores)
    mean = sum(overall_scores) / n
    if n < 2:
        return round(mean)

    variance = sum((v - mean) ** 2 for v in overall_scores) / (n - 1)
    std = math.sqrt(variance)
    penalty = SCORING_CONFIG.get("consistencyPenalty", 0.1)

    return clamp(round(mean - penalty * std), 0, 100)
