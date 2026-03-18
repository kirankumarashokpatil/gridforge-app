"""
GridForge DA Curve Engine — Python port of src/engine/DACurveEngine.js

EPEX/N2EX-style Day-Ahead curve submission and clearing.
Players submit piecewise linear curves covering 48 SPs.
Clearing finds the uniform price where supply = demand per SP.
"""

from __future__ import annotations
import math
import time
import random

from .utils import clamp


# ─── DA CURVE SEGMENT STRUCTURE ───

DEFAULT_DA_SEGMENTS = [
    {"spStart": 1, "spEnd": 12, "pmin": 0, "pmax": 50, "price1": 40, "price2": 60, "name": "Night/Low Demand"},
    {"spStart": 13, "spEnd": 24, "pmin": 0, "pmax": 100, "price1": 50, "price2": 80, "name": "Morning Ramp"},
    {"spStart": 25, "spEnd": 36, "pmin": 0, "pmax": 150, "price1": 60, "price2": 100, "name": "Peak Hours"},
    {"spStart": 37, "spEnd": 48, "pmin": 0, "pmax": 80, "price1": 45, "price2": 70, "name": "Evening/Return"},
]


# ─── VALIDATION ───

def validate_curve_segment(segment: dict) -> dict:
    errors = []
    if segment.get("spStart", 0) < 1 or segment.get("spStart", 0) > 48:
        errors.append(f"SP start must be 1-48, got {segment.get('spStart')}")
    if segment.get("spEnd", 0) < 1 or segment.get("spEnd", 0) > 48:
        errors.append(f"SP end must be 1-48, got {segment.get('spEnd')}")
    if segment.get("spStart", 0) > segment.get("spEnd", 0):
        errors.append(f"SP start ({segment.get('spStart')}) must be <= SP end ({segment.get('spEnd')})")
    if segment.get("pmin", 0) < 0:
        errors.append(f"Pmin must be >= 0, got {segment.get('pmin')}")
    if segment.get("pmax", 0) < 0:
        errors.append(f"Pmax must be >= 0, got {segment.get('pmax')}")
    if segment.get("pmin", 0) > segment.get("pmax", 0):
        errors.append(f"Pmin ({segment.get('pmin')}) must be <= Pmax ({segment.get('pmax')})")
    if not (0 <= segment.get("price1", 0) <= 1000):
        errors.append(f"Price1 must be 0-1000, got {segment.get('price1')}")
    if not (0 <= segment.get("price2", 0) <= 1000):
        errors.append(f"Price2 must be 0-1000, got {segment.get('price2')}")
    return {"valid": len(errors) == 0, "errors": errors}


def validate_full_curve(segments: list[dict]) -> dict:
    errors = []
    for i in range(len(segments)):
        for j in range(i + 1, len(segments)):
            s1, s2 = segments[i], segments[j]
            if s1["spStart"] <= s2["spEnd"] and s2["spStart"] <= s1["spEnd"]:
                errors.append(
                    f"Segments {i+1} and {j+1} overlap on SPs "
                    f"{max(s1['spStart'], s2['spStart'])}-{min(s1['spEnd'], s2['spEnd'])}"
                )
        seg_val = validate_curve_segment(segments[i])
        if not seg_val["valid"]:
            errors.extend(f"Segment {i+1}: {e}" for e in seg_val["errors"])

    covered_sps = set()
    for seg in segments:
        for sp in range(seg["spStart"], seg["spEnd"] + 1):
            covered_sps.add(sp)
    uncovered = [sp for sp in range(1, 49) if sp not in covered_sps]

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "uncoveredSPs": uncovered,
        "isComplete": len(uncovered) == 0,
    }


# ─── CURVE EVALUATION ───

def get_volume_at_price(segments: list[dict], sp: int, price: float, side: str = "sell") -> float:
    segment = next((s for s in segments if s["spStart"] <= sp <= s["spEnd"]), None)
    if not segment:
        return 0.0

    pmin = segment["pmin"]
    pmax = segment["pmax"]
    price1 = segment["price1"]
    price2 = segment["price2"]
    price_range = price2 - price1

    if side == "sell":
        if price < price1:
            return 0.0
        if price >= price2:
            return pmax
        if abs(price_range) < 0.001:
            return pmax if price >= price1 else 0.0
        vol = pmin + (price - price1) * (pmax - pmin) / price_range
        return clamp(vol, pmin, pmax)
    else:
        if price > price2:
            return 0.0
        if price <= price1:
            return pmax
        if abs(price_range) < 0.001:
            return pmax if price <= price1 else 0.0
        vol = pmax - (price - price1) * (pmax - pmin) / price_range
        return clamp(vol, pmin, pmax)


# ─── MARKET CLEARING ───

def clear_single_sp(sp: int, player_curves: list[dict], market_ctx: dict | None = None) -> dict:
    sellers = []
    buyers = []

    for curve in player_curves:
        segment = next((s for s in curve.get("segments", []) if s["spStart"] <= sp <= s["spEnd"]), None)
        if not segment:
            continue
        side = curve.get("side", "sell")
        if side == "sell":
            sellers.append({**curve, "segment": segment})
        elif side == "buy":
            buyers.append({**curve, "segment": segment})
        else:
            sellers.append({**curve, "segment": segment})

    if not sellers and not buyers:
        volumes = {c["playerId"]: 0 for c in player_curves}
        pmax_map = {c["playerId"]: 0 for c in player_curves}
        return {"sp": sp, "clearingPrice": 50, "volumes": volumes, "pmax": pmax_map, "totalDemand": 0, "totalSupply": 0}

    syn_demand_mw = market_ctx.get("demandMW", 300 + math.sin(sp * 0.25) * 150) if market_ctx else (300 + math.sin(sp * 0.25) * 150)
    syn_forecast_price = market_ctx.get("forecastPrice", 45 + math.sin(sp * 0.2) * 20) if market_ctx else (45 + math.sin(sp * 0.2) * 20)

    price_set = set(range(0, 302, 2))
    for s in sellers:
        price_set.add(s["segment"]["price1"])
        price_set.add(s["segment"]["price2"])
    for b in buyers:
        price_set.add(b["segment"]["price1"])
        price_set.add(b["segment"]["price2"])
    price_set.add(syn_forecast_price)
    test_prices = sorted(price_set)

    clearing_price = syn_forecast_price
    best_diff = float("inf")

    for price in test_prices:
        total_supply = sum(get_volume_at_price([s["segment"]], sp, price, "sell") for s in sellers)
        total_demand = sum(get_volume_at_price([b["segment"]], sp, price, "buy") for b in buyers)
        syn_demand = syn_demand_mw * max(0, 1 - (price - syn_forecast_price) / 100)
        total_demand += max(0, syn_demand)

        diff = abs(total_supply - total_demand)
        if diff < best_diff:
            best_diff = diff
            clearing_price = price

    volumes = {}
    pmax_map = {}
    raw_total_supply = 0
    seller_vols = {}

    for s in sellers:
        vol = get_volume_at_price([s["segment"]], sp, clearing_price, "sell")
        seller_vols[s["playerId"]] = vol
        raw_total_supply += vol
        pmax_map[s["playerId"]] = s["segment"]["pmax"]

    raw_total_demand = 0
    buyer_vols = {}
    for b in buyers:
        vol = get_volume_at_price([b["segment"]], sp, clearing_price, "buy")
        buyer_vols[b["playerId"]] = vol
        raw_total_demand += vol
        pmax_map[b["playerId"]] = b["segment"]["pmax"]

    syn_demand_at_clear = max(0, syn_demand_mw * max(0, 1 - (clearing_price - syn_forecast_price) / 100))
    total_demand_at_clear = raw_total_demand + syn_demand_at_clear

    supply_ratio = (total_demand_at_clear / raw_total_supply) if (raw_total_supply > 0 and raw_total_supply > total_demand_at_clear) else 1

    for c in player_curves:
        segment = next((s for s in c.get("segments", []) if s["spStart"] <= sp <= s["spEnd"]), None)
        if c["playerId"] not in pmax_map:
            pmax_map[c["playerId"]] = segment["pmax"] if segment else 0

        if c["playerId"] in seller_vols:
            awarded = round(seller_vols[c["playerId"]] * supply_ratio * 100) / 100
            volumes[c["playerId"]] = -awarded
        elif c["playerId"] in buyer_vols:
            volumes[c["playerId"]] = round(buyer_vols[c["playerId"]] * 100) / 100
        else:
            volumes[c["playerId"]] = 0

    return {
        "sp": sp,
        "clearingPrice": round(clearing_price * 100) / 100,
        "volumes": volumes,
        "pmax": pmax_map,
        "totalDemand": total_demand_at_clear,
        "totalSupply": raw_total_supply * supply_ratio,
    }


def clear_full_auction(player_curves: list[dict], market_ctx_array: list[dict] | None = None) -> dict:
    prices = [0.0] * 48
    volumes: dict[str, list[float]] = {}
    pmax_arrays: dict[str, list[float]] = {}
    sp_details = []

    for curve in player_curves:
        volumes[curve["playerId"]] = [0.0] * 48
        pmax_arrays[curve["playerId"]] = [0.0] * 48

    for sp in range(1, 49):
        ctx = market_ctx_array[sp - 1] if market_ctx_array else None
        result = clear_single_sp(sp, player_curves, ctx)
        prices[sp - 1] = result["clearingPrice"]

        for player_id, vol in result["volumes"].items():
            if player_id in volumes:
                volumes[player_id][sp - 1] = vol
        for player_id, pm in result.get("pmax", {}).items():
            if player_id in pmax_arrays:
                pmax_arrays[player_id][sp - 1] = pm

        sp_details.append({
            "sp": sp,
            "clearingPrice": result["clearingPrice"],
            "totalDemand": result["totalDemand"],
            "totalSupply": result["totalSupply"],
        })

    total_traded = sum(abs(v) for vols in volumes.values() for v in vols) / 2

    return {
        "prices": prices,
        "volumes": volumes,
        "pmax": pmax_arrays,
        "spDetails": sp_details,
        "totalTradedMW": total_traded,
    }


# ─── PREVIEW HELPERS ───

def preview_curve_revenue(segments: list[dict], forecast_prices: list[float]) -> dict:
    sp_revenues = []
    total_revenue = 0.0

    for sp in range(1, 49):
        price = forecast_prices[sp - 1] if sp - 1 < len(forecast_prices) else 50
        volume = get_volume_at_price(segments, sp, price)
        revenue = volume * price * 0.5
        sp_revenues.append({"sp": sp, "price": price, "volume": volume, "revenue": revenue})
        total_revenue += revenue

    return {
        "spRevenues": sp_revenues,
        "totalRevenue": total_revenue,
        "totalVolume": sum(abs(r["volume"]) for r in sp_revenues),
    }


# ─── SEGMENT EDITING HELPERS ───

def create_segment(
    sp_start: int = 1, sp_end: int = 48,
    pmin: float = 0, pmax: float = 50,
    price1: float = 40, price2: float = 60,
    name: str = "New Segment",
) -> dict:
    rand_suffix = "".join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=5))
    return {
        "id": f"seg_{int(time.time() * 1000)}_{rand_suffix}",
        "spStart": clamp(sp_start, 1, 48),
        "spEnd": clamp(sp_end, 1, 48),
        "pmin": max(0, pmin),
        "pmax": max(0, pmax),
        "price1": clamp(price1, 0, 1000),
        "price2": clamp(price2, 0, 1000),
        "name": name,
    }


def update_segment(segments: list[dict], segment_id: str, updates: dict) -> list[dict]:
    return [{**s, **updates} if s.get("id") == segment_id else s for s in segments]


def delete_segment(segments: list[dict], segment_id: str) -> list[dict]:
    return [s for s in segments if s.get("id") != segment_id]


def add_segment(segments: list[dict], new_segment: dict) -> list[dict]:
    return [*segments, new_segment]
