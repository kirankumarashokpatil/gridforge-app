"""Unit tests for backend/engine/scoring_engine.py — edge cases & correctness."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from engine.scoring_engine import (
    compute_role_score,
    compute_system_score,
    compute_overall_score,
)

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

def score_in_range(score, lo=0, hi=100):
    return isinstance(score, (int, float)) and lo <= score <= hi

# ── compute_role_score — all roles ─────────────────────────────────

print("\nTEST 1: TRADER role score ...")
r = compute_role_score("TRADER", {
    "netProfit": 5000, "maxDrawdown": 1000, "marginEvents": 2
})
check("roleScore" in r, "Has roleScore")
check(score_in_range(r["roleScore"]), f"Score in [0,100]: {r['roleScore']}")
check("primary" in r, "Has primary breakdown")

print("\nTEST 2: TRADER — zero drawdown ...")
r = compute_role_score("TRADER", {
    "netProfit": 5000, "maxDrawdown": 0, "marginEvents": 0
})
check(score_in_range(r["roleScore"]), f"Score in [0,100]: {r['roleScore']}")

print("\nTEST 3: TRADER — negative profit ...")
r = compute_role_score("TRADER", {
    "netProfit": -2000, "maxDrawdown": 500, "marginEvents": 5
})
check(score_in_range(r["roleScore"]), f"Negative profit score in [0,100]: {r['roleScore']}")

print("\nTEST 4: GENERATOR role score ...")
r = compute_role_score("GENERATOR", {
    "capacityMW": 500, "netProfit": 10000, "totalMWh": 200, "imbalanceCost": 500
})
check(score_in_range(r["roleScore"]), f"Score in [0,100]: {r['roleScore']}")

print("\nTEST 5: GENERATOR — zero capacity ...")
r = compute_role_score("GENERATOR", {
    "capacityMW": 0, "netProfit": 0, "totalMWh": 0, "imbalanceCost": 0
})
check(score_in_range(r["roleScore"]), f"Zero inputs: {r['roleScore']}")

print("\nTEST 6: BESS role score ...")
r = compute_role_score("BESS", {
    "mwhShifted": 100, "netProfit": 3000,
    "totalRevenue": 5000, "bmRevenue": 2000, "socPenalties": 1
})
check(score_in_range(r["roleScore"]), f"BESS score: {r['roleScore']}")

print("\nTEST 7: BESS — zero MWh shifted ...")
r = compute_role_score("BESS", {
    "mwhShifted": 0, "netProfit": 0,
    "totalRevenue": 0, "bmRevenue": 0, "socPenalties": 0
})
check(score_in_range(r["roleScore"]), f"Zero BESS: {r['roleScore']}")

print("\nTEST 8: SUPPLIER role score ...")
r = compute_role_score("SUPPLIER", {
    "totalMWh": 500, "netCost": 20000, "hedgeRatio": 0.8, "imbalanceCost": 2000
})
check(score_in_range(r["roleScore"]), f"Supplier score: {r['roleScore']}")

print("\nTEST 9: DSR role score ...")
r = compute_role_score("DSR", {
    "reliability": 0.95, "netProfit": 1500, "missedEvents": 1
})
check(score_in_range(r["roleScore"]), f"DSR score: {r['roleScore']}")

print("\nTEST 10: DSR — zero reliability ...")
r = compute_role_score("DSR", {
    "reliability": 0, "netProfit": 0, "missedEvents": 10
})
check(score_in_range(r["roleScore"]), f"Zero reliability: {r['roleScore']}")

print("\nTEST 11: NESO role score ...")
r = compute_role_score("NESO", {
    "avgAbsNIV": 200, "totalSPs": 48, "totalSystemCost": 50000,
    "forecastMAE": 10, "priceVolatility": 15, "participationRate": 0.9
})
check(score_in_range(r["roleScore"]), f"NESO score: {r['roleScore']}")

print("\nTEST 12: NESO — perfect stability ...")
r = compute_role_score("NESO", {
    "avgAbsNIV": 0, "totalSPs": 48, "totalSystemCost": 0,
    "forecastMAE": 0, "priceVolatility": 0, "participationRate": 1.0
})
check(r["roleScore"] >= 90, f"Perfect NESO >= 90: {r['roleScore']}")

print("\nTEST 13: ELEXON role score ...")
r = compute_role_score("ELEXON", {
    "settlementError": 2, "onTimeRate": 0.95, "auditCoverage": 0.85
})
check(score_in_range(r["roleScore"]), f"Elexon score: {r['roleScore']}")

print("\nTEST 14: INTERCONNECTOR role score ...")
r = compute_role_score("INTERCONNECTOR", {
    "congestionRevenue": 5000, "availability": 0.98, "stressContribution": 3.0
})
check(score_in_range(r["roleScore"]), f"IC score: {r['roleScore']}")

# ── Edge cases: empty/missing stats ────────────────────────────────

print("\nTEST 15: Role score with empty stats ...")
for role in ("TRADER", "GENERATOR", "BESS", "SUPPLIER", "DSR", "NESO", "ELEXON", "INTERCONNECTOR"):
    try:
        r = compute_role_score(role, {})
        check(score_in_range(r["roleScore"]),
              f"{role} empty stats → {r['roleScore']}")
    except Exception as e:
        check(False, f"{role} empty stats threw: {e}")

# ── compute_system_score ───────────────────────────────────────────

print("\nTEST 16: system_score — neutral (None metrics) ...")
s = compute_system_score(None)
check(s == 50, f"None metrics → 50 (got {s})")

print("\nTEST 17: system_score — positive contribution ...")
s = compute_system_score({
    "totalNIVContribution": 200, "stressWindowHelps": 3,
    "missedDeliveries": 0, "causedBlackout": False
})
check(score_in_range(s), f"Positive system score: {s}")
check(s > 50, f"Positive contribution → above 50: {s}")

print("\nTEST 18: system_score — blackout penalty ...")
s = compute_system_score({
    "totalNIVContribution": 100, "stressWindowHelps": 2,
    "missedDeliveries": 0, "causedBlackout": True
})
s_no_blackout = compute_system_score({
    "totalNIVContribution": 100, "stressWindowHelps": 2,
    "missedDeliveries": 0, "causedBlackout": False
})
check(s < s_no_blackout, f"Blackout penalty: {s} < {s_no_blackout}")

print("\nTEST 19: system_score — missed deliveries penalty ...")
s = compute_system_score({
    "totalNIVContribution": 0, "stressWindowHelps": 0,
    "missedDeliveries": 5, "causedBlackout": False
})
check(s < 50, f"Missed deliveries → below 50: {s}")

print("\nTEST 20: system_score — stress helps capped ...")
s5 = compute_system_score({
    "totalNIVContribution": 0, "stressWindowHelps": 5,
    "missedDeliveries": 0, "causedBlackout": False
})
s10 = compute_system_score({
    "totalNIVContribution": 0, "stressWindowHelps": 10,
    "missedDeliveries": 0, "causedBlackout": False
})
check(s5 == s10, f"5 helps = 10 helps (capped): {s5} == {s10}")

print("\nTEST 21: system_score — clamped to [0,100] ...")
s = compute_system_score({
    "totalNIVContribution": -99999, "stressWindowHelps": 0,
    "missedDeliveries": 20, "causedBlackout": True
})
check(s >= 0, f"Floor at 0: {s}")

s = compute_system_score({
    "totalNIVContribution": 99999, "stressWindowHelps": 10,
    "missedDeliveries": 0, "causedBlackout": False
})
check(s <= 100, f"Ceiling at 100: {s}")

# ── compute_overall_score ──────────────────────────────────────────

print("\nTEST 22: overall_score — default alpha blend ...")
o = compute_overall_score(80, 60)
check(score_in_range(o), f"Overall score: {o}")
# Default alpha=0.6: 0.6*80 + 0.4*60 = 48+24 = 72
check(o == 72, f"0.6*80 + 0.4*60 = 72 (got {o})")

print("\nTEST 23: overall_score — pure role (alpha=1.0) ...")
o = compute_overall_score(80, 60, alpha=1.0)
check(o == 80, f"Alpha=1.0 → role score 80 (got {o})")

print("\nTEST 24: overall_score — pure system (alpha=0.0) ...")
o = compute_overall_score(80, 60, alpha=0.0)
check(o == 60, f"Alpha=0.0 → system score 60 (got {o})")

print("\nTEST 25: overall_score — clamped ...")
o = compute_overall_score(100, 100)
check(o <= 100, f"Max scores → ≤100 (got {o})")
o = compute_overall_score(0, 0)
check(o >= 0, f"Min scores → ≥0 (got {o})")

# ── compute_final_score (if exists) ────────────────────────────────

print("\nTEST 26: compute_final_score (multi-round) ...")
try:
    from engine.scoring_engine import compute_final_score

    f = compute_final_score([70, 80, 75])
    check(score_in_range(f), f"Final multi-round score: {f}")

    f_single = compute_final_score([85])
    check(f_single == 85, f"Single round → that score: {f_single}")

    f_empty = compute_final_score([])
    check(f_empty == 0, f"Empty → 0: {f_empty}")

    f_consistent = compute_final_score([80, 80, 80])
    f_volatile = compute_final_score([60, 100, 60])
    check(f_consistent >= f_volatile,
          f"Consistent ({f_consistent}) >= volatile ({f_volatile})")
except ImportError:
    check(True, "compute_final_score not exported (optional)")

# ── Summary ────────────────────────────────────────────────────────

print(f"\n=== SCORING ENGINE TESTS: {passed} passed, {failed} failed ===")
if failed > 0:
    print("SOME TESTS FAILED")
    if __name__ == "__main__": sys.exit(1)
else:
    print("ALL SCORING ENGINE TESTS PASSED")
