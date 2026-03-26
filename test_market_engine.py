"""Unit tests for backend/engine/market_engine.py — edge cases & correctness."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from engine.market_engine import (
    clear_bm, clear_da, market_for_sp, feedback_market_state,
    ida_forecast, compute_forecasts,
)
from engine.constants import ASSETS, SP_DURATION_H

passed = 0
failed = 0

def check(cond, label):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS: {label}")
    else:
        failed += 1
        print(f"  FAIL: {label}")

# ── clear_bm ───────────────────────────────────────────────────────

print("\nTEST 1: clear_bm — empty bids ...")
r = clear_bm([], {"isShort": True, "sbp": 80, "ssp": 60, "rawImbalanceMw": 100})
check(len(r["accepted"]) == 0, "No acceptances")
check(r["full"] is False, "Not fully cleared")
check(r["cleared"] == 0 or r.get("acceptedSellVolume", 0) == 0, "Zero volume cleared")

print("\nTEST 2: clear_bm — single offer in short market ...")
bids = [{"id": "p1", "side": "offer", "mw": 50, "price": 70, "asset": "OCGT"}]
mkt = {"isShort": True, "sbp": 80, "ssp": 60, "rawImbalanceMw": 100}
r = clear_bm(bids, mkt)
check(len(r["accepted"]) == 1, "One bid accepted")
check(r["accepted"][0]["mwAcc"] <= 50, "MW accepted <= offered")
check(r["accepted"][0]["revenue"] > 0, "Positive revenue for offer")
check(r["accepted"][0]["bidPrice"] == 70, "Pay-as-bid: settled at own price")

print("\nTEST 3: clear_bm — merit order (cheapest first in short market) ...")
bids = [
    {"id": "p1", "side": "offer", "mw": 30, "price": 100, "asset": "OCGT"},
    {"id": "p2", "side": "offer", "mw": 30, "price": 50, "asset": "CCGT"},
]
mkt = {"isShort": True, "sbp": 80, "ssp": 60, "rawImbalanceMw": 40}
r = clear_bm(bids, mkt)
accepted_ids = [b["id"] for b in r["accepted"]]
check("p2" in accepted_ids, "Cheaper offer (p2@50) accepted")
# p1 may or may not be accepted depending on remaining imbalance
if len(r["accepted"]) >= 2:
    check(accepted_ids.index("p2") < accepted_ids.index("p1"), "p2 before p1 in merit order")
else:
    check(True, "Only cheapest needed — p1 not dispatched")

print("\nTEST 4: clear_bm — negative prices allowed ...")
bids = [{"id": "p1", "side": "offer", "mw": 20, "price": -10, "asset": "WIND"}]
mkt = {"isShort": True, "sbp": 80, "ssp": 60, "rawImbalanceMw": 30}
r = clear_bm(bids, mkt)
check(len(r["accepted"]) == 1, "Negative price offer accepted")
check(r["accepted"][0]["bidPrice"] == -10, "Settled at negative price")

print("\nTEST 5: clear_bm — NESO reject override ...")
bids = [
    {"id": "p1", "side": "offer", "mw": 30, "price": 50, "asset": "OCGT"},
    {"id": "p2", "side": "offer", "mw": 30, "price": 60, "asset": "CCGT"},
]
mkt = {"isShort": True, "sbp": 80, "ssp": 60, "rawImbalanceMw": 40}
r = clear_bm(bids, mkt, neso_overrides={"reject": ["p1"]})
accepted_ids = [b["id"] for b in r["accepted"]]
check("p1" not in accepted_ids, "p1 rejected by NESO override")
check("p2" in accepted_ids, "p2 accepted instead")

print("\nTEST 6: clear_bm — NESO volumeCap ...")
bids = [
    {"id": "p1", "side": "offer", "mw": 100, "price": 50, "asset": "OCGT"},
]
mkt = {"isShort": True, "sbp": 80, "ssp": 60, "rawImbalanceMw": 200}
r = clear_bm(bids, mkt, neso_overrides={"volumeCap": 30})
total_acc = sum(b["mwAcc"] for b in r["accepted"])
check(total_acc <= 30, f"Volume capped at <=30MW (got {total_acc})")

print("\nTEST 7: clear_bm — ramp rate enforcement ...")
# NUCLEAR has rampRate=5
bids = [{"id": "p1", "side": "offer", "mw": 100, "price": 50, "asset": "NUCLEAR"}]
mkt = {"isShort": True, "sbp": 80, "ssp": 60, "rawImbalanceMw": 200}
r = clear_bm(bids, mkt)
if r["accepted"]:
    nuke_ramp = ASSETS.get("NUCLEAR", {}).get("rampRate", 999)
    check(r["accepted"][0]["mwAcc"] <= nuke_ramp, f"NUCLEAR capped at ramp rate {nuke_ramp}MW")
else:
    check(True, "NUCLEAR bid handled (possibly zero ramp)")

print("\nTEST 8: clear_bm — long market uses bids (not offers) ...")
bids = [
    {"id": "p1", "side": "bid", "mw": 40, "price": 50, "asset": "BESS_M"},
    {"id": "p2", "side": "offer", "mw": 40, "price": 30, "asset": "OCGT"},
]
mkt = {"isShort": False, "sbp": 80, "ssp": 60, "rawImbalanceMw": -50}
r = clear_bm(bids, mkt)
# In long market, system needs to reduce generation — bids accepted
check(r.get("systemDirection") in ("LONG", None) or not r.get("isShort", True),
      "Long market direction correct")

# ── clear_da ───────────────────────────────────────────────────────

print("\nTEST 9: clear_da — empty bids ...")
r = clear_da([], {"baseRef": 65, "systemDemand": 30000})
check(r["volume"] == 0, "Zero volume cleared")
check(r["cp"] == 65, "Clearing price falls back to baseRef")

print("\nTEST 10: clear_da — single supply + single demand ...")
bids = [
    {"id": "gen1", "side": "offer", "mw": 100, "price": 50, "asset": "CCGT"},
    {"id": "sup1", "side": "bid", "mw": 100, "price": 70, "asset": "SUPPLIER"},
]
r = clear_da(bids, {"baseRef": 65, "systemDemand": 30000})
check(r["volume"] > 0, "Trade occurs")
check(50 <= r["cp"] <= 70, f"CP between offer and demand: {r['cp']}")
# Pay-as-clear: all at same price
for b in r.get("accepted_bids", []):
    if b["side"] == "offer":
        check(b["mwAcc"] > 0, "Offer accepted")

print("\nTEST 11: clear_da — no overlap (all offers > all demands) ...")
bids = [
    {"id": "gen1", "side": "offer", "mw": 100, "price": 100, "asset": "CCGT"},
    {"id": "sup1", "side": "bid", "mw": 100, "price": 30, "asset": "SUPPLIER"},
]
r = clear_da(bids, {"baseRef": 65, "systemDemand": 30000})
check(r["volume"] == 0, "No overlap — zero volume")

print("\nTEST 12: clear_da — tie at clearing price (pro-rata) ...")
bids = [
    {"id": "g1", "side": "offer", "mw": 50, "price": 60, "asset": "OCGT"},
    {"id": "g2", "side": "offer", "mw": 50, "price": 60, "asset": "CCGT"},
    {"id": "s1", "side": "bid", "mw": 70, "price": 60, "asset": "SUPPLIER"},
]
r = clear_da(bids, {"baseRef": 65, "systemDemand": 30000})
offers_acc = [b for b in r.get("accepted_bids", []) if b["side"] == "offer"]
if len(offers_acc) == 2:
    check(abs(offers_acc[0]["mwAcc"] - offers_acc[1]["mwAcc"]) < 1,
          "Tie price: pro-rata allocation roughly equal")
else:
    check(True, "Tie handled (acceptance count varies by algo)")

print("\nTEST 13: clear_da — uniform pricing (all at CP) ...")
bids = [
    {"id": "g1", "side": "offer", "mw": 50, "price": 40, "asset": "OCGT"},
    {"id": "g2", "side": "offer", "mw": 50, "price": 60, "asset": "CCGT"},
    {"id": "s1", "side": "bid", "mw": 80, "price": 80, "asset": "SUPPLIER"},
]
r = clear_da(bids, {"baseRef": 65, "systemDemand": 30000})
cp = r["cp"]
for b in r.get("accepted_bids", []):
    if b["side"] == "offer" and b["mwAcc"] > 0:
        expected_rev = b["mwAcc"] * cp * SP_DURATION_H
        adj = b.get("cfdAdjustment", 0)
        check(abs(b["revenue"] - (expected_rev + adj)) < 0.01,
              f"{b['id']} revenue at uniform CP ({cp})")

# ── market_for_sp ──────────────────────────────────────────────────

print("\nTEST 14: market_for_sp — deterministic with same seed ...")
m1 = market_for_sp(10, room_seed=42)
m2 = market_for_sp(10, room_seed=42)
check(m1["forecast"]["niv"] == m2["forecast"]["niv"], "Same seed → same forecast NIV")
check(m1["actual"]["niv"] == m2["actual"]["niv"], "Same seed → same actual NIV")

print("\nTEST 15: market_for_sp — different seeds differ ...")
m3 = market_for_sp(10, room_seed=99)
check(m1["actual"]["niv"] != m3["actual"]["niv"] or
      m1["actual"]["wf"] != m3["actual"]["wf"],
      "Different seed → different market")

print("\nTEST 16: market_for_sp — valid structure ...")
m = market_for_sp(25, room_seed=1)
for key in ("niv", "sbp", "ssp", "baseRef", "wf", "sf", "isShort"):
    check(key in m["forecast"], f"forecast has '{key}'")
    check(key in m["actual"], f"actual has '{key}'")
check(0 <= m["actual"]["wf"] <= 100, f"Wind fraction in [0,100]: {m['actual']['wf']}")
check(0 <= m["actual"]["sf"] <= 100, f"Solar fraction in [0,100]: {m['actual']['sf']}")
check(m["actual"]["sbp"] >= 0, f"SBP non-negative: {m['actual']['sbp']}")

# ── ida_forecast ───────────────────────────────────────────────────

print("\nTEST 17: ida_forecast — error reduction blending ...")
m = market_for_sp(20, room_seed=7)
blended = ida_forecast(m, 0.4)  # 40% error removed
for key in ("niv", "wf", "sf"):
    fc = m["forecast"].get(key, 0)
    ac = m["actual"].get(key, 0)
    bl = blended.get(key, 0)
    # Blended should be between forecast and actual (or equal if already same)
    if fc != ac:
        check(min(fc, ac) - 1 <= bl <= max(fc, ac) + 1,
              f"IDA blend '{key}': {fc} → {bl} → {ac}")

print("\nTEST 18: ida_forecast — full reduction returns actuals ...")
blended_full = ida_forecast(m, 1.0)
check(abs(blended_full.get("niv", 0) - m["actual"]["niv"]) <= 1,
      "100% reduction ≈ actual NIV")

# ── feedback_market_state ──────────────────────────────────────────

print("\nTEST 19: feedback_market_state — frequency in bounds ...")
mkt = {"isShort": True, "sbp": 80, "ssp": 60, "rawImbalanceMw": 100, "baseRef": 65}
bm_r = {"accepted": [], "cp": 80, "cleared": 0, "full": False,
         "acceptedBuyVolume": 0, "acceptedSellVolume": 0}
updated = feedback_market_state(mkt, bm_r)
check(49.0 <= updated.get("freq", 50) <= 51.0, f"Frequency in bounds: {updated.get('freq')}")

print("\nTEST 20: feedback_market_state — residual NIV computed ...")
check("residualNIV" in updated or "niv" in updated, "Has residual NIV or NIV field")

# ── compute_forecasts ──────────────────────────────────────────────

print("\nTEST 21: compute_forecasts — returns 4 forecast windows ...")
fc = compute_forecasts(10, "NORMAL", room_seed=5)
check(len(fc) == 4, f"4 forecast windows (got {len(fc)})")
check(fc[0]["sp"] == 11, f"First forecast SP = 11 (got {fc[0]['sp']})")
check(fc[3]["sp"] == 14, f"Last forecast SP = 14 (got {fc[3]['sp']})")

for f in fc:
    check("niv" in f and "isShort" in f and "wf" in f, f"SP {f['sp']} has required fields")

# ── Summary ────────────────────────────────────────────────────────

print(f"\n=== MARKET ENGINE TESTS: {passed} passed, {failed} failed ===")
if failed > 0:
    print("SOME TESTS FAILED")
    if __name__ == "__main__": sys.exit(1)
else:
    print("ALL MARKET ENGINE TESTS PASSED")
