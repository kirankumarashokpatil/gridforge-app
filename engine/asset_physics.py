"""
GridForge Asset Physics — Python port of src/engine/AssetPhysics.js

Handles SoC/fuel availability, directional availability,
SoC/fuel updates after dispatch, and initial state.
"""

from __future__ import annotations
import math

from .constants import ASSETS, MIN_SOC, MAX_SOC, SP_DURATION_H
from .utils import clamp


def avail_mw(asset_def: dict, sofuel: float, market: dict) -> float:
    """
    Available MW for a given asset definition, SoC/fuel level, and market state.
    Market can be { actual: {}, forecast: {} } or a flat dict.
    """
    if not asset_def:
        return 0.0

    # Resolve market fields from nested or flat structure
    actual = market.get("actual", {})
    forecast = market.get("forecast", {})
    is_short = actual.get("isShort", forecast.get("isShort", market.get("isShort", False)))
    wf = actual.get("wf", forecast.get("wf", market.get("wf", 0.5)))
    sf = actual.get("sf", forecast.get("sf", market.get("sf", 0.5)))

    kind = asset_def.get("kind", "")

    if kind == "soc":
        effective_soc = clamp(sofuel, MIN_SOC, MAX_SOC)
        max_mwh = asset_def.get("maxMWh", 0)
        eff = asset_def.get("eff", 1)
        max_mw = asset_def.get("maxMW", 0)
        sp_h = SP_DURATION_H or 0.5

        # Discharge: down to MIN_SOC
        max_discharge_mwh = ((effective_soc - MIN_SOC) / 100) * max_mwh
        discharge_limit_mw = (max_discharge_mwh * eff) / sp_h

        # Charge: up to MAX_SOC
        max_charge_mwh = ((MAX_SOC - effective_soc) / 100) * max_mwh
        charge_limit_mw = (max_charge_mwh / eff) / sp_h

        return clamp(discharge_limit_mw if is_short else charge_limit_mw, 0, max_mw)

    if kind == "wind":
        return clamp(round(wf * asset_def.get("maxMW", 0)), 0, asset_def.get("maxMW", 0))

    if kind == "solar":
        return clamp(round(sf * asset_def.get("maxMW", 0)), 0, asset_def.get("maxMW", 0))

    if kind == "fuel":
        return clamp((sofuel or 0) / (SP_DURATION_H or 0.5), 0, asset_def.get("maxMW", 0))

    if kind == "none":
        return asset_def.get("maxMW", 0)

    return asset_def.get("maxMW", 0)


def avail_mw_directional(asset_def: dict, sofuel: float) -> dict:
    """
    Directional availability for BM phase where BESS can bid either way.
    Returns { charge: MW, discharge: MW }.
    """
    if not asset_def:
        return {"charge": 0, "discharge": 0}

    kind = asset_def.get("kind", "")

    if kind == "soc":
        effective_soc = clamp(sofuel, MIN_SOC, MAX_SOC)
        max_mwh = asset_def.get("maxMWh", 0)
        eff = asset_def.get("eff", 1)
        max_mw = asset_def.get("maxMW", 0)
        sp_h = SP_DURATION_H or 0.5

        max_discharge_mwh = ((effective_soc - MIN_SOC) / 100) * max_mwh
        discharge_limit_mw = (max_discharge_mwh * eff) / sp_h

        max_charge_mwh = ((MAX_SOC - effective_soc) / 100) * max_mwh
        charge_limit_mw = (max_charge_mwh / eff) / sp_h

        return {
            "charge": clamp(charge_limit_mw, 0, max_mw),
            "discharge": clamp(discharge_limit_mw, 0, max_mw),
        }

    limit = asset_def.get("maxMW", 0)
    return {"charge": limit, "discharge": limit}


def update_sof(asset_def: dict, sofuel: float, mw_acc: float, is_short: bool) -> float:
    """Update SoC/fuel after dispatch. Returns new sofuel value."""
    if not asset_def:
        return sofuel

    mwh = mw_acc * SP_DURATION_H
    kind = asset_def.get("kind", "")

    if kind == "soc":
        eff = asset_def.get("eff", 1)
        max_mwh = asset_def.get("maxMWh", 1)
        if is_short:
            internal_cost_mwh = mwh / eff
            return clamp(sofuel - (internal_cost_mwh / max_mwh) * 100, 0, 100)
        else:
            internal_gain_mwh = mwh * eff
            return clamp(sofuel + (internal_gain_mwh / max_mwh) * 100, 0, 100)

    if kind == "fuel":
        return clamp(sofuel - mwh, 0, asset_def.get("fuelMWh", 0)) if is_short else sofuel

    return sofuel


def init_sof(asset_def: dict) -> float:
    """Initial SoC/fuel for an asset."""
    if not asset_def:
        return 0.0
    kind = asset_def.get("kind", "")
    if kind == "soc":
        return asset_def.get("startSoC", 50)
    if kind == "fuel":
        return asset_def.get("startFuel", asset_def.get("fuelMWh", 0))
    return 0.0


# ─── SUPPLIER DEMAND OBLIGATION ───

def supplier_demand_mw(sp: int, base_load_mw: float = 80) -> float:
    """
    Customer load profile for a supplier, in MW.
    Models a typical GB domestic+I&C demand shape:
      - overnight trough ~60% of base
      - morning ramp 07:00–09:00
      - daytime plateau
      - evening peak 17:00–19:00 at ~130% of base
      - evening decline

    In real GB, each supplier serves a portfolio of customers with
    a profile-class-weighted load shape. This is a simplified aggregate.
    """
    hr = ((sp - 1) / 2) % 24

    # Piecewise demand shape (fraction of base_load_mw)
    if hr < 5:
        frac = 0.60
    elif hr < 7:
        frac = 0.60 + (hr - 5) * 0.15        # ramp 0.60 → 0.90
    elif hr < 9:
        frac = 0.90 + (hr - 7) * 0.10         # ramp 0.90 → 1.10
    elif hr < 16:
        frac = 1.00                            # daytime plateau
    elif hr < 17:
        frac = 1.00 + (hr - 16) * 0.30        # ramp to peak
    elif hr < 19:
        frac = 1.30                            # evening peak
    elif hr < 22:
        frac = 1.30 - (hr - 19) * 0.20        # decline 1.30 → 0.70
    else:
        frac = 0.70 - (hr - 22) * 0.05        # late evening
        frac = max(frac, 0.60)

    return round(base_load_mw * frac, 1)


def supplier_demand_forecast_mw(sp: int, base_load_mw: float = 80, error_pct: float = 0.05) -> float:
    """
    Forecast of customer demand (what the supplier sees before delivery).
    Has a small forecast error vs actual, creating natural imbalance exposure.
    """
    actual = supplier_demand_mw(sp, base_load_mw)
    # Deterministic error based on SP (so it's reproducible)
    err_seed = ((sp * 7919 + 31) % 1000) / 1000.0  # 0..1
    err = (err_seed - 0.5) * 2 * error_pct * actual
    return round(actual + err, 1)


def supplier_imbalance_mw(sp: int, contracted_mw: float, base_load_mw: float = 80) -> float:
    """
    Supplier imbalance = contracted purchases − actual customer demand.
    Positive = over-contracted (long), Negative = under-contracted (short).
    """
    actual_demand = supplier_demand_mw(sp, base_load_mw)
    return contracted_mw - actual_demand
