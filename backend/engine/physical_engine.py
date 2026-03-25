"""
GridForge Physical Engine — Python port of src/engine/PhysicalEngine.js

Tracks system-level metrics across settlement periods.
Computes NIV tracking, system impact attribution, and builds player stats for scoring.
"""

from __future__ import annotations
import math

from .constants import SCORING_CONFIG, ASSETS, SP_DURATION_H


def create_system_state() -> dict:
    return {
        "nivHistory": [],
        "totalBalancingCost": 0,
        "stressEvents": 0,
        "blackouts": 0,
        "totalSPs": 0,
        "playerImpacts": {},
    }


def update_system_state(state: dict, sp_data: dict) -> dict:
    """
    Update system state each SP.
    sp_data: { sp, niv, balancingCost, freq, blackout }
    """
    abs_niv = abs(sp_data.get("niv", 0))
    stress_threshold = SCORING_CONFIG.get("stressNIVThreshold", 300)
    is_stress = abs_niv > stress_threshold

    entry = {
        "sp": sp_data.get("sp"),
        "niv": sp_data.get("niv", 0),
        "absNiv": abs_niv,
        "balancingCost": sp_data.get("balancingCost", 0),
        "isStress": is_stress,
    }

    return {
        **state,
        "nivHistory": [*state.get("nivHistory", []), entry],
        "totalBalancingCost": state.get("totalBalancingCost", 0) + sp_data.get("balancingCost", 0),
        "stressEvents": state.get("stressEvents", 0) + (1 if is_stress else 0),
        "blackouts": state.get("blackouts", 0) + (1 if sp_data.get("blackout") else 0),
        "totalSPs": state.get("totalSPs", 0) + 1,
    }


def compute_player_system_impact(player_imbalance: float, system_niv: float) -> float:
    """
    Positive = player helped reduce |NIV|, negative = player worsened it.
    """
    if player_imbalance == 0:
        return 0.0
    niv_without = abs(system_niv - player_imbalance)
    niv_with = abs(system_niv)
    return niv_without - niv_with


def update_player_impact(
    current_impacts: dict,
    pid: str,
    sp_impact: float,
    is_stress_sp: bool,
    delivered_ok: bool,
) -> dict:
    prev = current_impacts.get(pid, {
        "totalNIVContribution": 0,
        "stressWindowHelps": 0,
        "missedDeliveries": 0,
        "causedBlackout": False,
    })

    return {
        **current_impacts,
        pid: {
            "totalNIVContribution": prev["totalNIVContribution"] + sp_impact,
            "stressWindowHelps": prev["stressWindowHelps"] + (1 if is_stress_sp and sp_impact > 0 else 0),
            "missedDeliveries": prev["missedDeliveries"] + (0 if delivered_ok else 1),
            "causedBlackout": prev["causedBlackout"],
        },
    }


def build_player_stats(role: str, data: dict) -> dict:
    """
    Assemble the stats object that scoring_engine.compute_role_score() expects.
    """
    sp_history = data.get("spHistory", [])
    asset_key = data.get("assetKey", "")
    cash = data.get("cash", 0)
    da_cash = data.get("daCash", 0)
    imbalance_penalty = data.get("imbalancePenalty", 0)
    system_impacts = data.get("systemImpacts", {})
    pid = data.get("pid", "")
    congestion_revenue = data.get("congestionRevenue", 0)

    asset_def = ASSETS.get(asset_key, {})
    total_sps = len(sp_history)
    net_profit = cash + da_cash

    total_bm_rev = 0
    total_da_rev = 0
    total_id_rev = 0
    total_mwh = 0
    max_drawdown = 0
    running_pl = 0
    peak_pl = 0
    margin_events = 0

    for sp in sp_history:
        sp_rev = sp.get("revenue", 0)
        total_bm_rev += abs(sp.get("bmRev", 0))
        total_da_rev += abs(sp.get("daRev", 0))
        total_id_rev += abs(sp.get("idRev", 0))
        total_mwh += abs(sp.get("contractPosMw", 0)) * SP_DURATION_H

        running_pl += sp_rev
        if running_pl > peak_pl:
            peak_pl = running_pl
        dd = peak_pl - running_pl
        if dd > max_drawdown:
            max_drawdown = dd

        if running_pl < -500:
            margin_events += 1

    total_revenue = total_bm_rev + total_da_rev + total_id_rev
    impact = system_impacts.get(pid, {})
    mwh_shifted = total_mwh or 1

    base_stats = {
        "netProfit": net_profit,
        "totalRevenue": total_revenue,
        "totalSPs": total_sps,
        "maxDrawdown": max(1, max_drawdown),
        "marginEvents": margin_events,
        "capacityMW": asset_def.get("maxMW", 1),
        "totalMWh": total_mwh or 1,
        "imbalanceCost": imbalance_penalty,
        "bmRevenue": total_bm_rev,
        "mwhShifted": mwh_shifted,
        "socPenalties": 0,
        "congestionRevenue": congestion_revenue,
        # Supplier-specific
        "netCost": abs(net_profit),
        "hedgeRatio": min(total_da_rev / max(1, total_revenue), 1) if total_da_rev > 0 else 0.5,
        # DSR-specific
        "reliability": 1.0,
        "missedEvents": impact.get("missedDeliveries", 0),
        # NESO-specific
        "avgAbsNIV": 0,
        "totalSystemCost": 0,
        "forecastMAE": 0,
        "priceVolatility": 0,
        "participationRate": 0.5,
        # Elexon-specific
        "settlementError": 0,
        "onTimeRate": 1.0,
        "auditCoverage": 1.0,
        # Interconnector-specific
        "availability": 1.0,
        "stressContribution": impact.get("stressWindowHelps", 0),
    }

    if role == "NESO" and data.get("systemState"):
        neso_specific = build_neso_stats(data["systemState"], sp_history)
        base_stats.update(neso_specific)

    if role == "ELEXON" and data.get("spContracts"):
        elexon_specific = build_elexon_stats(data["spContracts"], sp_history)
        base_stats.update(elexon_specific)

    return base_stats


def build_neso_stats(system_state: dict, sp_history: list | None = None) -> dict:
    sp_history = sp_history or []
    niv_hist = system_state.get("nivHistory", [])
    total_sps = len(niv_hist) or 1
    avg_abs_niv = sum(e.get("absNiv", 0) for e in niv_hist) / total_sps

    forecast_mae = 0.0
    if sp_history:
        total_deviation = sum(
            abs(h.get("niv", 0)) * 0.15 + abs(h.get("sbp", 0) - h.get("ssp", 0)) * 0.1
            for h in sp_history
        )
        forecast_mae = total_deviation / len(sp_history)

    price_volatility = 0.0
    if len(sp_history) > 1:
        prices = [h.get("cp") or h.get("sbp", 50) for h in sp_history]
        mean = sum(prices) / len(prices)
        variance = sum((v - mean) ** 2 for v in prices) / (len(prices) - 1)
        price_volatility = math.sqrt(variance)

    sps_with_activity = sum(
        1 for h in sp_history if abs(h.get("bmRev", 0)) > 0 or abs(h.get("daRev", 0)) > 0
    )
    participation_rate = sps_with_activity / len(sp_history) if sp_history else 0.5

    return {
        "netProfit": 0,
        "totalRevenue": 0,
        "totalSPs": total_sps,
        "avgAbsNIV": avg_abs_niv,
        "totalSystemCost": system_state.get("totalBalancingCost", 0),
        "forecastMAE": forecast_mae,
        "priceVolatility": price_volatility,
        "participationRate": participation_rate,
        "stressEvents": system_state.get("stressEvents", 0),
        "blackouts": system_state.get("blackouts", 0),
    }


def build_elexon_stats(sp_contracts: dict, sp_history: list | None = None) -> dict:
    sp_history = sp_history or []
    total_error = 0.0
    settled_sps = 0

    for sp_num, contracts in sp_contracts.items():
        if not isinstance(contracts, dict):
            continue
        for pid, c in contracts.items():
            if not isinstance(c, dict):
                continue
            settlement = c.get("settlement")
            if settlement:
                settled_sps += 1
                expected = (
                    settlement.get("daCash", 0)
                    + settlement.get("idCash", 0)
                    + settlement.get("bmCash", 0)
                    + settlement.get("imbCash", 0)
                    + settlement.get("startupCost", 0)
                    + settlement.get("operatingCost", 0)
                )
                actual = settlement.get("totalCash", 0)
                total_error += abs(expected - actual)

    settlement_error = total_error / settled_sps if settled_sps > 0 else 0

    total_sps_played = len(sp_history) or 1
    settled_sp_numbers = set()
    for sp_num, contracts in sp_contracts.items():
        if isinstance(contracts, dict) and any(
            isinstance(c, dict) and c.get("settlement") for c in contracts.values()
        ):
            settled_sp_numbers.add(sp_num)
    on_time_rate = min(len(settled_sp_numbers) / total_sps_played, 1.0)

    audit_coverage = min(settled_sps / (total_sps_played * 2), 1.0) if settled_sps > 0 else 0.5

    return {
        "settlementError": settlement_error,
        "onTimeRate": on_time_rate,
        "auditCoverage": audit_coverage,
    }
