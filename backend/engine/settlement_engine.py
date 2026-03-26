"""
GridForge Settlement Engine — Python port of src/engine/SettlementEngine.js

Imbalance computation, price selection, and settlement cash flows.
"""

from __future__ import annotations

from .constants import SP_DURATION_H


def compute_imbalance(actual_physical_mw: float, contracted_mw: float, bm_accepted_mw: float = 0) -> float:
    """
    imbalanceMw = actualPhysicalMw − (contractedMw + bmAcceptedMw)
    Positive = Surplus (Paid SSP); Negative = Shortage (Pays SBP)
    """
    return actual_physical_mw - (contracted_mw + (bm_accepted_mw or 0))


def select_imbalance_price(imbalance_mw: float, sbp: float, ssp: float) -> float:
    return sbp if imbalance_mw < 0 else ssp


def compute_imbalance_settlement(
    actual_physical_mw: float,
    contracted_mw: float,
    bm_accepted_mw: float = 0,
    sbp: float = 50,
    ssp: float = 40,
    sp_duration_h: float = SP_DURATION_H,
) -> dict:
    imbalance_mw = compute_imbalance(actual_physical_mw, contracted_mw, bm_accepted_mw)
    price = select_imbalance_price(imbalance_mw, sbp, ssp)
    mwh = imbalance_mw * sp_duration_h
    cash = mwh * price

    return {
        "imbalanceMw": imbalance_mw,
        "price": price,
        "mwh": mwh,
        "cash": cash,
    }


def compute_hub_fee_from_settlements(settlements: list[dict]) -> dict:
    sum_player_imb_cash = sum(s.get("imbCash", 0) for s in settlements)
    return {"sumPlayerImbCash": sum_player_imb_cash, "hubFee": -sum_player_imb_cash}
