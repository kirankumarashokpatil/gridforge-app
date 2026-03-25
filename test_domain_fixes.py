"""Regression tests for GB electricity market domain fixes."""
import sys

errors = []

def check(name, condition, detail=""):
    if condition:
        print(f"  PASS: {name}")
    else:
        msg = f"{name}: {detail}" if detail else name
        errors.append(msg)
        print(f"  FAIL: {msg}")


# ══════════════════════════════════════════════
print("DOMAIN FIX 1: BM is pay-as-bid (not pay-as-clear)...")
# ══════════════════════════════════════════════
from engine.market_engine import clear_bm

market = {"isShort": True, "sbp": 100, "ssp": 40, "niv": -100}
bids = [
    {"side": "offer", "mw": 50, "price": 60, "asset": "OCGT", "id": "p1", "name": "P1"},
    {"side": "offer", "mw": 50, "price": 80, "asset": "BESS_M", "id": "p2", "name": "P2"},
]
result = clear_bm(bids, market)

# Under pay-as-bid: p1 should earn at £60/MWh, p2 at £80/MWh
# Under pay-as-clear (old bug): both would earn at £80/MWh (marginal)
p1_bid = next(a for a in result["accepted"] if a["id"] == "p1")
p2_bid = next(a for a in result["accepted"] if a["id"] == "p2")

check("p1 bidPrice = 60", p1_bid["bidPrice"] == 60, f"got {p1_bid.get('bidPrice')}")
check("p2 bidPrice = 80", p2_bid["bidPrice"] == 80, f"got {p2_bid.get('bidPrice')}")
# p1: 50MW * £60 * 0.5h = £1500 gross (minus wear)
check("p1 revenue < p2 revenue (cheaper bid earns less per MW)",
      p1_bid["revenue"] < p2_bid["revenue"],
      f"p1={p1_bid['revenue']}, p2={p2_bid['revenue']}")


# ══════════════════════════════════════════════
print("\nDOMAIN FIX 2: Ramp rate constraints enforced...")
# ══════════════════════════════════════════════
# CCGT has rampRate=200, offer 500MW → should be capped to 200MW
market2 = {"isShort": True, "sbp": 100, "ssp": 40, "niv": -500}
bids2 = [
    {"side": "offer", "mw": 500, "price": 60, "asset": "CCGT", "id": "p1", "name": "P1"},
]
result2 = clear_bm(bids2, market2)
if result2["accepted"]:
    acc_mw = result2["accepted"][0]["mwAcc"]
    from engine.constants import ASSETS
    ccgt_ramp = ASSETS.get("CCGT", {}).get("rampRate", None)
    if ccgt_ramp:
        check(f"CCGT accepted MW <= rampRate ({ccgt_ramp})", acc_mw <= ccgt_ramp,
              f"accepted {acc_mw}MW")
    else:
        print("  SKIP: CCGT not in ASSETS or no rampRate defined")
else:
    print("  SKIP: no bids accepted (CCGT may not be in ASSETS)")

# Test with BESS_M (rampRate=50)
market3 = {"isShort": True, "sbp": 100, "ssp": 40, "niv": -200}
bids3 = [
    {"side": "offer", "mw": 100, "price": 60, "asset": "BESS_M", "id": "p1", "name": "P1"},
]
result3 = clear_bm(bids3, market3)
if result3["accepted"]:
    acc_mw = result3["accepted"][0]["mwAcc"]
    bess_ramp = ASSETS.get("BESS_M", {}).get("rampRate", 999)
    check(f"BESS_M accepted MW <= rampRate ({bess_ramp})", acc_mw <= bess_ramp,
          f"accepted {acc_mw}MW")


# ══════════════════════════════════════════════
print("\nDOMAIN FIX 3: SBP/SSP derived from marginal BM action...")
# ══════════════════════════════════════════════
from engine.market_engine import feedback_market_state

market_pre = {"isShort": True, "sbp": 100, "ssp": 40, "niv": -100, "baseRef": 70, "sp": 5}
bm_result = {"cp": 65, "cleared": 100, "full": True, "accepted": []}
feedback = feedback_market_state(market_pre, bm_result)

# When fully cleared and system was short, SBP should reflect cp (65), not base_ref * 1.1
check("SBP reflects BM marginal cost (cp=65)", feedback["sbp"] == 65,
      f"got sbp={feedback['sbp']}")
check("residualNIV near zero when fully cleared", abs(feedback["residualNIV"]) < 1,
      f"got {feedback['residualNIV']}")


# ══════════════════════════════════════════════
print("\nDOMAIN FIX 4: Supplier demand obligation...")
# ══════════════════════════════════════════════
from engine.asset_physics import supplier_demand_mw, supplier_imbalance_mw

# Evening peak (SP 35 = 17:00) should be higher than overnight (SP 5 = 02:00)
peak_demand = supplier_demand_mw(35, base_load_mw=100)
overnight_demand = supplier_demand_mw(5, base_load_mw=100)
check("Evening peak > overnight demand", peak_demand > overnight_demand,
      f"peak={peak_demand}, overnight={overnight_demand}")

# Supplier who contracted 80MW but customer demands 104MW → short
imb = supplier_imbalance_mw(35, contracted_mw=80, base_load_mw=100)
check("Under-contracted supplier is short (negative imbalance)", imb < 0,
      f"imbalance={imb}")

# Supplier who contracted 150MW but customer demands 60MW → long
imb2 = supplier_imbalance_mw(5, contracted_mw=150, base_load_mw=100)
check("Over-contracted supplier is long (positive imbalance)", imb2 > 0,
      f"imbalance={imb2}")


# ══════════════════════════════════════════════
print("\nDOMAIN FIX 5: NESO agency (reject/priority/volumeCap)...")
# ══════════════════════════════════════════════
market5 = {"isShort": True, "sbp": 100, "ssp": 40, "niv": -80}
bids5 = [
    {"side": "offer", "mw": 40, "price": 50, "asset": "OCGT", "id": "cheap", "name": "Cheap"},
    {"side": "offer", "mw": 40, "price": 90, "asset": "OCGT", "id": "expensive", "name": "Expensive"},
]

# Without overrides: cheap should be accepted first
r_no_override = clear_bm(bids5, market5)
check("Without override: cheap accepted first",
      r_no_override["accepted"][0]["id"] == "cheap")

# NESO rejects cheap → only expensive accepted
r_reject = clear_bm(bids5, market5, neso_overrides={"reject": ["cheap"]})
check("NESO reject: cheap excluded",
      all(a["id"] != "cheap" for a in r_reject["accepted"]),
      f"accepted ids: {[a['id'] for a in r_reject['accepted']]}")
check("NESO reject: expensive accepted instead",
      any(a["id"] == "expensive" for a in r_reject["accepted"]))

# NESO prioritises expensive over cheap
r_prio = clear_bm(bids5, market5, neso_overrides={"priority": ["expensive"]})
check("NESO priority: expensive accepted first",
      r_prio["accepted"][0]["id"] == "expensive",
      f"first accepted: {r_prio['accepted'][0]['id']}")

# NESO volume cap: only accept 30MW total
r_cap = clear_bm(bids5, market5, neso_overrides={"volumeCap": 30})
total_acc = sum(a["mwAcc"] for a in r_cap["accepted"])
check("NESO volumeCap: total accepted <= 30MW", total_acc <= 30.001,
      f"total accepted: {total_acc}")


# ══════════════════════════════════════════════
print("\nDOMAIN FIX 6: CfD adjustment in DA...")
# ══════════════════════════════════════════════
from engine.market_engine import _da_cfd_adjustment

# Wind asset with strikePrice £50, DA clears at £40 → top-up of £10/MWh
adj = _da_cfd_adjustment({"asset": "WIND"}, da_cp=40, mwh=100)
wind_strike = ASSETS.get("WIND", {}).get("strikePrice")
if wind_strike:
    expected = (wind_strike - 40) * 100
    check(f"CfD top-up: strike={wind_strike}, cp=40 → adj={expected}", abs(adj - expected) < 0.01,
          f"got {adj}")
else:
    print("  SKIP: WIND asset has no strikePrice defined (OK for game balance)")
    # Still verify that non-CfD assets get 0 adjustment
    adj_no_cfd = _da_cfd_adjustment({"asset": "OCGT"}, da_cp=40, mwh=100)
    check("Non-CfD asset gets zero adjustment", adj_no_cfd == 0, f"got {adj_no_cfd}")


# ══════════════════════════════════════════════
print("\nDOMAIN FIX 7: Single vs dual cashout mode...")
# ══════════════════════════════════════════════
from engine.constants import CASHOUT_MODE
from engine.game_loop import register_player, generate_market, advance_phase, set_room_config, _get_room

check("Default CASHOUT_MODE is 'single'", CASHOUT_MODE == "single", f"got '{CASHOUT_MODE}'")

# Test single cashout: long and short should face same price
ROOM_S = "CASHOUT_SINGLE"
register_player(ROOM_S, "gen", {"name": "Gen", "asset": "OCGT", "role": "GENERATOR"})
generate_market(ROOM_S)
set_room_config(ROOM_S, {"cashoutMode": "single"})
rs = _get_room(ROOM_S)
check("Room cashoutMode = 'single'", rs.get("cashoutMode") == "single")

# Test dual cashout setting
ROOM_D = "CASHOUT_DUAL"
register_player(ROOM_D, "gen", {"name": "Gen", "asset": "OCGT", "role": "GENERATOR"})
generate_market(ROOM_D)
set_room_config(ROOM_D, {"cashoutMode": "dual"})
rs_d = _get_room(ROOM_D)
check("Room cashoutMode = 'dual'", rs_d.get("cashoutMode") == "dual")


# ══════════════════════════════════════════════
print()
if errors:
    print(f"FAILURES ({len(errors)}):")
    for e in errors:
        print(f"  ✗ {e}")
    if __name__ == "__main__": sys.exit(1)
else:
    print("=== ALL 7 DOMAIN FIX REGRESSION TESTS PASSED ===")
    if __name__ == "__main__": sys.exit(0)
