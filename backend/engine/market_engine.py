"""
GridForge Market Engine — Python port of src/engine/MarketEngine.js

Deterministic market state generation, BM clearing, DA clearing,
forecast computation, and feedback market state updates.
"""

from __future__ import annotations
import math
from typing import Optional

from .constants import (
    ASSETS, EVENTS, SCENARIOS, MIN_SOC, MAX_SOC,
    SP_DURATION_H, SYSTEM_PARAMS,
)
from .utils import clamp


# ─── Deterministic RNG (matches JS version exactly) ───

def _rng(seed: int):
    """Return a callable that produces deterministic floats in [0, 1)."""
    s = (seed & 0xFFFFFFFF)

    def _next() -> float:
        nonlocal s
        s = ((s ^ (s >> 15)) * (1 | s) + 0x6D2B79F5) & 0xFFFFFFFF
        t = (((s ^ (s >> 7)) * (61 | s)) ^ s) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return _next


# ─── Renewable physics helpers ───

def _wind_speed_for_sp(sp: int, room_seed: int = 0) -> float:
    base = 6 + 3 * math.sin(((sp - 1) / 48) * math.pi * 2)
    w_rng = _rng(sp * 4211 + 17 + room_seed)
    noise = (w_rng() - 0.5) * 2
    return max(0.0, base + noise)


def _forecast_wind_speed(true_speed: float, sp: int, room_seed: int = 0) -> float:
    err_scale = 0.12 + 0.08 * _rng(sp * 3127 + 9 + room_seed)()
    sign = -1 if _rng(sp * 531 + 3 + room_seed)() < 0.5 else 1
    return max(0.0, true_speed * (1 + sign * err_scale))


def _wind_fraction_from_speed(v: float) -> float:
    if v < 3 or v >= 25:
        return 0.0
    if v < 12:
        x = (v - 3) / (12 - 3)
        return x ** 3
    if v <= 15:
        return 1.0
    return 1.0 - (v - 15) / (25 - 15)


def _solar_irradiance_for_sp(sp: int, room_seed: int = 0) -> float:
    hr = ((sp - 1) / 2) % 24
    if hr < 6 or hr > 18:
        return 0.0
    base = math.sin(((hr - 6) / 12) * math.pi)
    s_rng = _rng(sp * 715 + 23 + room_seed)
    noise = (s_rng() - 0.5) * 0.3
    return clamp(base + noise, 0.0, 1.0)


def _forecast_solar_irradiance(true_irr: float, sp: int, room_seed: int = 0) -> float:
    err_scale = 0.07 + 0.03 * _rng(sp * 811 + 5 + room_seed)()
    sign = -1 if _rng(sp * 929 + 2 + room_seed)() < 0.5 else 1
    return clamp(true_irr * (1 + sign * err_scale), 0.0, 1.0)


# ─── Market State for an SP ───

def market_for_sp(
    sp: int,
    scenario_id: str = "NORMAL",
    injected_events: list | None = None,
    published_forecast: dict | None = None,
    room_seed: int = 0,
) -> dict:
    """Generate forecast + actual market state for a settlement period."""

    injected_events = injected_events or []
    sc = SCENARIOS.get(scenario_id, SCENARIOS["NORMAL"])
    r = _rng(sp * 1337 + 42 + room_seed)
    err_rng = _rng(sp * 9999 + 777 + room_seed)

    hr = (sp - 1) // 2

    # 1. BASE EXPECTED STATE
    expected_demand = 0.72 + 0.28 * (0.5 - 0.5 * math.cos(((hr - 5) / 24) * 2 * math.pi))

    true_wind_speed = _wind_speed_for_sp(sp, room_seed)
    forecast_wind_spd = _forecast_wind_speed(true_wind_speed, sp, room_seed)
    expected_wind = _wind_fraction_from_speed(forecast_wind_spd) * sc["windMod"]

    true_irr = _solar_irradiance_for_sp(sp, room_seed)
    forecast_irr = _forecast_solar_irradiance(true_irr, sp, room_seed)
    expected_solar = forecast_irr

    # Override with published forecast if provided
    if published_forecast and published_forecast.get("demand") and published_forecast.get("wind"):
        idx = (sp - 1) % 48
        expected_demand = clamp(published_forecast["demand"][idx] / 45000, 0.4, 1.2)
        expected_wind = clamp(published_forecast["wind"][idx] / 25000, 0, 1) * sc["windMod"]
        expected_solar = (
            clamp(published_forecast["solar"][idx] / 15000, 0, 1)
            if published_forecast.get("solar")
            else 0
        )

    # System assets (absolute MW)
    base_demand_mw = SYSTEM_PARAMS["baseDemandGW"] * 1000
    wind_cap_mw = SYSTEM_PARAMS["maxWindGW"] * 1000
    solar_assets = [a for a in ASSETS.values() if a.get("kind") == "solar"]
    solar_cap_mw = sum(a.get("maxMW", 0) for a in solar_assets)

    forecast_system = {
        "demandMw": round(expected_demand * base_demand_mw),
        "windMw": round(expected_wind * wind_cap_mw),
        "solarMw": round(expected_solar * solar_cap_mw),
        "windCapMw": wind_cap_mw,
        "solarCapMw": solar_cap_mw,
        "baseDemandMw": base_demand_mw,
    }

    base_niv = (r() - 0.52) * 650 * expected_demand + sc["nivBias"]
    expected_ref_price = (65 + r() * 55) * sc["priceMod"]

    # European prices
    expected_price_fr = (50 + 40 * math.sin(((hr - 2) / 24) * 2 * math.pi) + (r() * 15 - 5)) * sc["priceMod"]
    expected_price_no = (40 + 20 * math.sin(((hr - 6) / 24) * 2 * math.pi) + (r() * 5)) * sc["priceMod"]
    expected_price_nl = (expected_ref_price * 0.95) + (r() * 20 - 10)
    expected_price_dk = (30 + (1 - expected_wind) * 60 + (r() * 10)) * sc["priceMod"]

    niv_val = clamp(base_niv, -620, 620)
    is_short_val = base_niv < 0

    forecast = {
        "sp": sp,
        "hr": hr,
        "niv": niv_val,
        "indicativeNiv": niv_val,
        "rawImbalanceMw": niv_val,
        "isShort": is_short_val,
        "wf": expected_wind,
        "sf": expected_solar,
        "sbp": clamp(expected_ref_price * 1.32 if is_short_val else expected_ref_price * 0.82, 10, 900),
        "ssp": clamp(expected_ref_price * 0.72 if is_short_val else expected_ref_price * 1.22, 5, 800),
        "baseRef": expected_ref_price,
        "priceFR": expected_price_fr,
        "priceNO": expected_price_no,
        "priceNL": expected_price_nl,
        "priceDK": expected_price_dk,
        "system": forecast_system,
    }

    # 2. ACTUAL STATE
    event = None
    cum = 0.0
    er = err_rng()
    for e in EVENTS:
        adj = e["prob"] * sc["eventProb"]
        cum += adj
        if er < cum:
            event = e
            break

    # Manual injection
    injected = next((ie for ie in injected_events if ie.get("sp") == sp), None)
    if injected:
        found = next((e for e in EVENTS if e["id"] == injected.get("eventId")), None)
        if found:
            event = found

    wind_error = (err_rng() - 0.4) * 0.3
    demand_error_mv = (err_rng() - 0.5) * 120
    solar_error = (err_rng() - 0.3) * 0.2

    mod_wind_speed = true_wind_speed
    if event:
        eid = event["id"]
        if eid == "WIND_UP":
            mod_wind_speed *= 1.6
        elif eid == "WIND_LOW":
            mod_wind_speed *= 0.3
        elif eid == "DUNKEL":
            mod_wind_speed *= 0.05
    true_wind = _wind_fraction_from_speed(mod_wind_speed)
    true_solar = clamp(true_irr + solar_error, 0, 1)

    true_niv = clamp(base_niv + demand_error_mv + (event["niv"] if event else 0), -620, 620)
    true_is_short = true_niv < 0
    true_ref_price = expected_ref_price + (event["pd"] if event else 0) + (25 if true_is_short else -15)

    true_price_fr = expected_price_fr + (err_rng() * 12 - 6)
    true_price_no = expected_price_no + (err_rng() * 4 - 2)
    true_price_nl = expected_price_nl + (err_rng() * 16 - 8)
    true_price_dk = expected_price_dk + (wind_error * -40) + (err_rng() * 10 - 5)

    tripped_assets = _generate_trips(err_rng, event["id"]) if event and event["id"] in ("TRIP", "CASCADE") else []

    freq_deviation = clamp(-true_niv / 15000, -0.4, 0.4)
    freq_rng = _rng((sp or 1) * 42 + 7)
    freq = clamp(50 + freq_deviation * (0.5 + freq_rng() * 1.0), 49.3, 50.7)

    actual = {
        "sp": sp,
        "hr": hr,
        "niv": true_niv,
        "indicativeNiv": true_niv,
        "rawImbalanceMw": true_niv,
        "isShort": true_is_short,
        "wf": true_wind,
        "sf": true_solar,
        "sbp": clamp(true_ref_price * 1.32 if true_is_short else true_ref_price * 0.82, 10, 900),
        "ssp": clamp(true_ref_price * 0.72 if true_is_short else true_ref_price * 1.22, 5, 800),
        "freq": freq,
        "event": event,
        "trippedAssets": tripped_assets,
        "baseRef": true_ref_price,
        "priceFR": true_price_fr,
        "priceNO": true_price_no,
        "priceNL": true_price_nl,
        "priceDK": true_price_dk,
        "system": {
            "demandMw": round((expected_demand + demand_error_mv / base_demand_mw) * base_demand_mw),
            "windMw": round(true_wind * wind_cap_mw),
            "solarMw": round(true_solar * solar_cap_mw),
            "windCapMw": wind_cap_mw,
            "solarCapMw": solar_cap_mw,
            "baseDemandMw": base_demand_mw,
        },
        "bots": [],
    }

    # LoLP / VoLL scarcity pricing
    approx_capacity_gw = SYSTEM_PARAMS["baseDemandGW"] * 1.5
    reserve_margin_pct = ((approx_capacity_gw - abs(true_niv) / 1000) / approx_capacity_gw) * 100
    if reserve_margin_pct < 5:
        lolp_mult = max(1, (10 - reserve_margin_pct) / 2)
        actual["sbp"] = min(SYSTEM_PARAMS["VoLL"], actual["sbp"] * lolp_mult)
        actual["ssp"] = max(0, actual["ssp"] / lolp_mult)

    # Interconnector flows
    def _calc_flow(market_obj: dict, asset_def: dict) -> int:
        fpk = asset_def.get("foreignPriceKey", "priceFR")
        uk = market_obj.get("baseRef") or market_obj.get("sbp", 0)
        fr = market_obj.get(fpk, uk)
        flow = (uk - fr) * 15
        cap = asset_def.get("maxMW", 1000)
        return round(clamp(flow, -cap, cap))

    ic_defs = [a for a in ASSETS.values() if a.get("kind") == "interconnector"]
    forecast["interconnectorFlows"] = {d["key"]: _calc_flow(forecast, d) for d in ic_defs}
    actual["interconnectorFlows"] = {d["key"]: _calc_flow(actual, d) for d in ic_defs}

    # Demand curves
    def _make_curve(base_mw: float, rng_fn) -> list[dict]:
        steps = []
        points = 6
        for i in range(points + 1):
            vol = round((i / points) * base_mw)
            price = round(10 + (190 * (i / points)) + (rng_fn() * 20 - 10))
            steps.append({"mw": vol, "price": price})
        return steps

    forecast["demandCurve"] = _make_curve(forecast_system["demandMw"], r)
    actual["demandCurve"] = _make_curve(actual["system"]["demandMw"], err_rng)

    return {"forecast": forecast, "actual": actual}


def _generate_trips(r, event_id: str) -> list[str]:
    candidates = ["OCGT", "HYDRO", "BESS_L", "WIND"]
    trips = [candidates[int(r() * len(candidates)) % len(candidates)]]
    if event_id == "CASCADE":
        trips.append(candidates[int(r() * len(candidates)) % len(candidates)])
    return trips


# ─── Clear Balancing Mechanism ───

def clear_bm(bids: list[dict], market: dict, neso_overrides: dict | None = None) -> dict:
    """
    Clear the Balancing Mechanism (pay-as-bid).
    Returns { accepted, cp, cleared, full }.

    neso_overrides (optional): Allows the NESO player to exert real control:
      - "reject": list of player IDs to reject
      - "priority": list of player IDs in preferred acceptance order
      - "volumeCap": max MW the NESO is willing to accept this SP
    """
    is_short = market.get("isShort", False)
    sbp = market.get("sbp", 50)
    ssp = market.get("ssp", 40)
    raw_imbalance_mw = float(market.get("rawImbalanceMw", market.get("niv", 0)))
    overrides = neso_overrides or {}

    side = "offer" if is_short else "bid"
    cands = [b for b in bids if b.get("side") == side and float(b.get("mw", 0)) > 0 and _is_num(b.get("price"))]

    # NESO rejection list
    reject_ids = set(overrides.get("reject", []))
    if reject_ids:
        cands = [b for b in cands if b.get("id") not in reject_ids]

    # NESO priority reorder: prioritised IDs first, then remaining by merit order
    priority_ids = overrides.get("priority", [])
    if priority_ids:
        prio_set = set(priority_ids)
        prio_bids = sorted(
            [b for b in cands if b.get("id") in prio_set],
            key=lambda b: priority_ids.index(b.get("id")) if b.get("id") in priority_ids else 999,
        )
        rest_bids = sorted(
            [b for b in cands if b.get("id") not in prio_set],
            key=lambda b: float(b["price"]),
            reverse=(not is_short),
        )
        cands = prio_bids + rest_bids
    else:
        cands = sorted(cands, key=lambda b: float(b["price"]), reverse=(not is_short))

    rem = abs(raw_imbalance_mw)
    # NESO volume cap: limit total accepted MW
    neso_cap = overrides.get("volumeCap")
    if neso_cap is not None:
        rem = min(rem, float(neso_cap))
    cp = sbp if is_short else ssp
    acc: list[dict] = []

    for b in cands:
        if rem <= 0.001:
            break
        offered_mw = float(b["mw"])
        # Enforce ramp rate: cap accepted volume to asset's ramp capability per SP
        asset_def = ASSETS.get(b.get("asset", ""), {})
        ramp_limit = asset_def.get("rampRate", offered_mw)  # MW/SP; default = no limit
        effective_mw = min(offered_mw, ramp_limit)
        mw_acc = min(effective_mw, rem)
        cp = float(b["price"])
        acc.append({**b, "mwAcc": mw_acc})
        rem -= mw_acc

    # Pay-as-bid: each accepted action settles at its OWN submitted price
    # (matches real GB BM rules — unlike DA which is pay-as-clear)
    result = []
    for idx, a in enumerate(acc):
        asset_def = ASSETS.get(a.get("asset", ""), {})
        bid_price = float(a["price"])  # player's own submitted price
        mwh = a["mwAcc"] * SP_DURATION_H
        gross_revenue = a["mwAcc"] * bid_price * SP_DURATION_H * (1 if is_short else -1)
        wear_cost = asset_def.get("wear", 0) * mwh
        net_revenue = gross_revenue - wear_cost

        cfd_adjustment = 0.0
        strike = asset_def.get("strikePrice")
        if strike:
            cfd_adjustment = (strike - bid_price) * mwh
            net_revenue += cfd_adjustment

        result.append({
            **a,
            "revenue": round(net_revenue, 2),
            "wearCost": round(wear_cost, 2),
            "cfdAdjustment": round(cfd_adjustment, 2),
            "bidPrice": bid_price,
            "marginal": idx == len(acc) - 1,
        })

    cleared = abs(raw_imbalance_mw) - max(0, rem)
    accepted_buy_volume = 0 if is_short else cleared
    accepted_sell_volume = cleared if is_short else 0

    return {
        "accepted": result,
        "cp": cp,
        "cleared": cleared,
        "full": rem <= 0.001,
        "acceptedBuyVolume": accepted_buy_volume,
        "acceptedSellVolume": accepted_sell_volume,
        "niv": accepted_buy_volume - accepted_sell_volume,
        "systemDirection": "SHORT" if is_short else "LONG",
    }


# ─── CfD adjustment for DA ───

def _da_cfd_adjustment(bid: dict, da_cp: float, mwh: float) -> float:
    """
    Contract for Difference top-up / clawback for DA offers.
    In real GB, CfD renewables receive (strike − reference_price) per MWh.
    If DA CP > strike, generator pays back the excess.
    If DA CP < strike, generator receives the top-up.
    Only applies to assets with a strikePrice defined.
    """
    asset_def = ASSETS.get(bid.get("asset", ""), {})
    strike = asset_def.get("strikePrice")
    if not strike:
        return 0.0
    return (strike - da_cp) * mwh


# ─── Day-Ahead Auction Clearing (Pay-As-Clear) ───

def clear_da(bids: list[dict], market_forecast: dict) -> dict:
    """
    Clear the Day-Ahead auction.
    Returns { cp, volume, accepted_bids }.
    """
    offers = sorted(
        [b for b in bids if b.get("side") == "offer" and float(b.get("mw", 0)) > 0 and _is_num(b.get("price"))],
        key=lambda b: float(b["price"]),
    )
    demands = sorted(
        [b for b in bids if b.get("side") == "bid" and float(b.get("mw", 0)) > 0 and _is_num(b.get("price"))],
        key=lambda b: float(b["price"]),
        reverse=True,
    )

    price_points = sorted(set(
        [float(o["price"]) for o in offers] + [float(d["price"]) for d in demands]
    ))

    cp = market_forecast.get("baseRef", 50)
    volume = 0.0
    accepted_bids: list[dict] = []

    for p in price_points:
        supply_at_p = sum(float(o["mw"]) for o in offers if float(o["price"]) <= p)
        demand_at_p = sum(float(d["mw"]) for d in demands if float(d["price"]) >= p)
        v = min(supply_at_p, demand_at_p)
        if v > volume:
            volume = v
            cp = p

    if volume > 0:
        # Accept offers
        offers_at_cp = [o for o in offers if float(o["price"]) < cp]
        marginal_offers = [o for o in offers if float(o["price"]) == cp]
        infra_vol = sum(float(o["mw"]) for o in offers_at_cp)
        marginal_needed = max(0, volume - infra_vol)
        marginal_total = sum(float(o["mw"]) for o in marginal_offers)

        for o in offers_at_cp:
            acc_mw = float(o["mw"])
            mwh = acc_mw * SP_DURATION_H
            base_rev = acc_mw * cp * SP_DURATION_H
            cfd_adj = _da_cfd_adjustment(o, cp, mwh)
            accepted_bids.append({**o, "mwAcc": acc_mw, "revenue": base_rev + cfd_adj, "cfdAdjustment": round(cfd_adj, 2)})

        if marginal_needed > 0 and marginal_total > 0:
            for o in marginal_offers:
                share = (float(o["mw"]) / marginal_total) * marginal_needed
                acc_mw = min(float(o["mw"]), share)
                if acc_mw > 0:
                    mwh = acc_mw * SP_DURATION_H
                    base_rev = acc_mw * cp * SP_DURATION_H
                    cfd_adj = _da_cfd_adjustment(o, cp, mwh)
                    accepted_bids.append({**o, "mwAcc": acc_mw, "revenue": base_rev + cfd_adj, "cfdAdjustment": round(cfd_adj, 2)})

        # Accept demands
        demands_at_cp = [d for d in demands if float(d["price"]) > cp]
        marginal_demands = [d for d in demands if float(d["price"]) == cp]
        infra_demand_vol = sum(float(d["mw"]) for d in demands_at_cp)
        demand_marginal_needed = max(0, volume - infra_demand_vol)
        demand_marginal_total = sum(float(d["mw"]) for d in marginal_demands)

        for d in demands_at_cp:
            acc_mw = float(d["mw"])
            accepted_bids.append({**d, "mwAcc": acc_mw, "revenue": -(acc_mw * cp * SP_DURATION_H)})

        if demand_marginal_needed > 0 and demand_marginal_total > 0:
            for d in marginal_demands:
                share = (float(d["mw"]) / demand_marginal_total) * demand_marginal_needed
                acc_mw = min(float(d["mw"]), share)
                if acc_mw > 0:
                    accepted_bids.append({**d, "mwAcc": acc_mw, "revenue": -(acc_mw * cp * SP_DURATION_H)})

    return {"cp": cp, "volume": volume, "accepted_bids": accepted_bids}


# ─── Intraday Auction (IDA) Clearing ───

def ida_forecast(market: dict, error_reduction: float) -> dict:
    """
    Generate an updated forecast for IDA rounds.
    Blends the DA forecast toward the actual values by error_reduction (0..1).
    IDA1 removes ~40% of forecast error, IDA2 removes ~70%.
    """
    forecast = market.get("forecast", {})
    actual = market.get("actual", {})
    if not forecast or not actual:
        return forecast

    def _blend(f_val, a_val):
        if f_val is None or a_val is None:
            return f_val
        return f_val + (a_val - f_val) * error_reduction

    return {
        **forecast,
        "niv": round(_blend(forecast.get("niv", 0), actual.get("niv", 0))),
        "isShort": _blend(forecast.get("niv", 0), actual.get("niv", 0)) < 0,
        "wf": round(_blend(forecast.get("wf", 0.5), actual.get("wf", 0.5)), 3),
        "sf": round(_blend(forecast.get("sf", 0.5), actual.get("sf", 0.5)), 3),
        "sbp": round(_blend(forecast.get("sbp", 50), actual.get("sbp", 50)), 2),
        "ssp": round(_blend(forecast.get("ssp", 40), actual.get("ssp", 40)), 2),
        "baseRef": round(_blend(forecast.get("baseRef", 60), actual.get("baseRef", 60)), 2),
        "idaRound": f"IDA (err_reduction={error_reduction})",
    }


# ─── Weather model-run constants (UK Met Office / GFS run times) ───

# Each GB forecast phase is triggered by a specific NWP model run time.
# Matches real EPEX/N2EX trader workflow:
#   DA:       last good run before 09:20 gate = 06Z (D-1)
#   FORECAST_1: 12Z run arrives ~15:00 D-1, used before IDA1 (17:30 gate)
#   FORECAST_2: 06Z short-range run D-day, used before IDA2 (08:00 gate)
_WEATHER_RUN_FOR_STAGE = {
    "FORECAST_0": "06Z",
    "FORECAST_1": "12Z",
    "FORECAST_2": "06Z (short-range)",
}

# Max peak-hour wind revision in GW (± either way) per stage.
# Real GB: 12Z can move evening wind ±1–3 GW; morning 06Z smaller.
_WIND_REVISION_GW = {
    "FORECAST_1": 2.0,
    "FORECAST_2": 0.8,
}


def generate_forecast_update(
    markets: dict,
    stage: str,
    scenario_id: str,
    da_avg_price: float | None = None,
) -> dict:
    """
    Produce the forecast-update bulletin shown to all players when entering a
    FORECAST_1 or FORECAST_2 phase.

    Mirrors real GB trader workflow:
      FORECAST_1 (~09:30 D-1): 12Z weather run + DA clearing price as signal.
      FORECAST_2 (~07:30 D):   06Z short-range run — sharpest pre-delivery update.

    Returns a dict with:
        stage, weatherRun, trigger, windDeltaGW, demandDeltaMW,
        daAvgPrice, daPriceSignal, confidenceGain, spTightest, perSpRevisions
    """
    weather_run = _WEATHER_RUN_FOR_STAGE.get(stage, "12Z")
    max_wind_gw = _WIND_REVISION_GW.get(stage, 1.0)

    # Deterministic-but-varied wind revision (seeded on stage + market count).
    seed = (hash(stage) ^ (len(markets) * 31337)) & 0xFFFFFFFF
    rng = _rng(seed)

    wind_delta_gw = round((rng() - 0.5) * 2.0 * max_wind_gw, 2)
    demand_delta_mw = round((rng() - 0.5) * 350.0)

    # DA price signal: compare cleared price vs mid-day forecast baseline.
    da_price_signal: str | None = None
    if da_avg_price is not None and markets:
        sample_sps = [sp for sp in [20, 24, 28, 32, 36] if sp in markets]
        if sample_sps:
            avg_fc_sbp = sum(
                markets[sp]["forecast"].get("sbp", 50) for sp in sample_sps
            ) / len(sample_sps)
            diff = da_avg_price - avg_fc_sbp
            if diff > 5:
                da_price_signal = "TIGHTER"    # cleared above forecast → more short
            elif diff < -5:
                da_price_signal = "LOOSER"     # cleared below forecast → more long
            else:
                da_price_signal = "AS EXPECTED"

    # Per-SP revision summary (wind revisions scale with each SP's wind fraction).
    per_sp_revisions: dict[str, dict] = {}
    rng2 = _rng(seed ^ 0xDEADC0DE)
    for sp, market in sorted(markets.items()):
        wf = market.get("forecast", {}).get("wf", 0.0)
        sp_wind_delta_mw = round(wind_delta_gw * 1000.0 * (0.4 + wf * 1.2))
        sp_demand_delta = round(demand_delta_mw * 0.9 + (rng2() - 0.5) * 80.0)
        sp_niv_delta = -(sp_wind_delta_mw + sp_demand_delta)
        per_sp_revisions[str(sp)] = {
            "windDeltaMW": sp_wind_delta_mw,
            "demandDeltaMW": sp_demand_delta,
            "nivDelta": sp_niv_delta,
        }

    # SP where system is most tightened after revision.
    sp_tightest: int | None = None
    if per_sp_revisions:
        sp_tightest = int(
            min(per_sp_revisions.items(), key=lambda kv: kv[1]["nivDelta"])[0]
        )

    # Human-readable trigger string.
    direction_word = "cut" if wind_delta_gw < 0 else "added"
    abs_wind = abs(wind_delta_gw)
    if stage == "FORECAST_1":
        parts = [f"{weather_run} weather run — wind {direction_word} {abs_wind:.1f} GW"]
        if da_avg_price is not None:
            parts.append(f"DA cleared £{da_avg_price:.1f}/MWh")
        if da_price_signal and da_price_signal != "AS EXPECTED":
            parts.append(f"system {da_price_signal.lower()} than forecast")
        trigger = " · ".join(parts)
    elif stage == "FORECAST_2":
        sign = "+" if demand_delta_mw >= 0 else ""
        trigger = (
            f"{weather_run} — wind {direction_word} {abs_wind:.1f} GW"
            f" · demand revised {sign}{demand_delta_mw:.0f} MW"
            " · high confidence pre-IDA2 update"
        )
    else:
        trigger = f"{weather_run} run · initial DA forecast — full ±uncertainty"

    confidence_gain = {"FORECAST_1": 40, "FORECAST_2": 70}.get(stage, 0)

    return {
        "stage": stage,
        "weatherRun": weather_run,
        "trigger": trigger,
        "windDeltaGW": wind_delta_gw,
        "demandDeltaMW": demand_delta_mw,
        "daAvgPrice": da_avg_price,
        "daPriceSignal": da_price_signal,
        "confidenceGain": confidence_gain,
        "spTightest": sp_tightest,
        "perSpRevisions": per_sp_revisions,
    }


def clear_ida(bids: list[dict], ida_forecast_data: dict) -> dict:
    """
    Clear an Intraday Auction (IDA1 or IDA2).
    Same uniform-price mechanism as DA, but uses the updated IDA forecast.
    Players can adjust positions with better information.
    Returns { cp, volume, accepted_bids }.
    """
    return clear_da(bids, ida_forecast_data)


# ─── Feedback Market State ───

def feedback_market_state(market: dict, clear_result: dict) -> dict:
    is_short = market.get("isShort", False)
    raw_imbalance_mw = float(market.get("rawImbalanceMw", market.get("niv", 0)))
    base_ref = market.get("baseRef", 50)
    cp_val = clear_result.get("cp", base_ref)
    cleared = clear_result.get("cleared", 0)
    cleared_niv = clear_result.get("niv", market.get("niv", 0))

    # When short (NIV<0), clearing offers adds generation → NIV moves toward 0
    # When long  (NIV>0), clearing bids removes generation → NIV moves toward 0
    residual_niv = raw_imbalance_mw + cleared if is_short else raw_imbalance_mw - cleared
    freq_deviation = clamp(-residual_niv / 15000, -0.4, 0.4)
    freq_rng = _rng((market.get("sp", 1)) * 42 + 7)
    freq = clamp(50 + freq_deviation * (0.5 + freq_rng() * 1.0), 49.3, 50.7)

    # Post-P305 / PAR-style: imbalance price = marginal BM action cost
    # When short: SBP driven by marginal offer price; SSP stays near base
    # When long:  SSP driven by marginal bid price; SBP stays near base
    if is_short:
        sbp = cp_val if clear_result.get("full") else max(cp_val, base_ref * 1.3)
        ssp = min(cp_val * 0.85, base_ref * 0.9)
    else:
        ssp = cp_val if clear_result.get("full") else min(cp_val, base_ref * 0.7)
        sbp = max(cp_val * 1.15, base_ref * 1.1)

    return {
        **market,
        "freq": freq,
        "niv": cleared_niv,
        "indicativeNiv": raw_imbalance_mw,
        "sbp": clamp(sbp, 10, 900),
        "ssp": clamp(ssp, 5, 800),
        "residualNIV": residual_niv,
    }


# ─── Forecasts ───

def compute_forecasts(
    current_sp: int,
    scenario_id: str,
    published_forecast: dict | None = None,
    max_offsets: int = 4,
    room_seed: int = 0,
) -> list[dict]:
    fcasts = []
    for offset in range(1, max_offsets + 1):
        sp = current_sp + offset
        state = market_for_sp(sp, scenario_id, [], published_forecast, room_seed=room_seed)
        f = state["forecast"]
        fcasts.append({
            **f,
            "sp": f["sp"],
            "time": sp_time_str(f["sp"]),
            "niv": round(f["niv"]),
            "isShort": f["isShort"],
            "priceLo": round(f["sbp"] * 0.8),
            "priceHi": round(f["sbp"] * 1.2),
            "wf": round(f["wf"] * 100),
            "sf": round(f["sf"] * 100),
            "event": (
                {"id": "WARNING", "name": "Grid Volatility Warning"}
                if offset <= 2 and state["actual"].get("event") and state["actual"]["event"].get("prob", 0) > 0.05
                else None
            ),
            "confident": offset <= 2,
        })
    return fcasts


def sp_time_str(sp: int) -> str:
    from .utils import sp_time
    return sp_time(sp)


# ─── Helpers ───

def _is_num(v) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False
