"""Unit tests for backend/engine/settlement_engine.py — edge cases & correctness."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from engine.settlement_engine import (
    compute_imbalance,
    select_imbalance_price,
    compute_imbalance_settlement,
    compute_hub_fee_from_settlements,
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

# ── compute_imbalance ──────────────────────────────────────────────

print("\nTEST 1: compute_imbalance — basic shortage ...")
imb = compute_imbalance(actual_physical_mw=80, contracted_mw=100)
check(imb == -20, f"80 actual - 100 contracted = -20 (got {imb})")

print("\nTEST 2: compute_imbalance — basic surplus ...")
imb = compute_imbalance(actual_physical_mw=120, contracted_mw=100)
check(imb == 20, f"120 actual - 100 contracted = 20 (got {imb})")

print("\nTEST 3: compute_imbalance — zero imbalance ...")
imb = compute_imbalance(actual_physical_mw=100, contracted_mw=100)
check(imb == 0, f"Balanced: imbalance = 0 (got {imb})")

print("\nTEST 4: compute_imbalance — with BM accepted MW ...")
imb = compute_imbalance(actual_physical_mw=130, contracted_mw=100, bm_accepted_mw=20)
check(imb == 10, f"130 - (100+20) = 10 (got {imb})")

print("\nTEST 5: compute_imbalance — zero contracted (pure BM player) ...")
imb = compute_imbalance(actual_physical_mw=50, contracted_mw=0, bm_accepted_mw=40)
check(imb == 10, f"50 - (0+40) = 10 (got {imb})")

print("\nTEST 6: compute_imbalance — all zeros ...")
imb = compute_imbalance(actual_physical_mw=0, contracted_mw=0, bm_accepted_mw=0)
check(imb == 0, f"All zero = 0 (got {imb})")

# ── select_imbalance_price ─────────────────────────────────────────

print("\nTEST 7: select_imbalance_price — shortage pays SBP ...")
p = select_imbalance_price(-20, sbp=80, ssp=60)
check(p == 80, f"Shortage → SBP 80 (got {p})")

print("\nTEST 8: select_imbalance_price — surplus receives SSP ...")
p = select_imbalance_price(20, sbp=80, ssp=60)
check(p == 60, f"Surplus → SSP 60 (got {p})")

print("\nTEST 9: select_imbalance_price — zero imbalance → SSP ...")
p = select_imbalance_price(0, sbp=80, ssp=60)
check(p == 60, f"Zero → SSP 60 (got {p})")

print("\nTEST 10: select_imbalance_price — SBP == SSP (single cashout) ...")
p = select_imbalance_price(-10, sbp=70, ssp=70)
check(p == 70, f"Single cashout → 70 (got {p})")

# ── compute_imbalance_settlement ───────────────────────────────────

print("\nTEST 11: settlement — shortage costs money ...")
s = compute_imbalance_settlement(
    actual_physical_mw=80, contracted_mw=100,
    sbp=80, ssp=60, sp_duration_h=0.5
)
check(s["imbalanceMw"] == -20, f"Imbalance = -20 (got {s['imbalanceMw']})")
check(s["price"] == 80, f"Price = SBP 80 (got {s['price']})")
check(s["mwh"] == -10, f"MWh = -20 * 0.5 = -10 (got {s['mwh']})")
check(s["cash"] == -800, f"Cash = -10 * 80 = -800 (got {s['cash']})")

print("\nTEST 12: settlement — surplus earns money ...")
s = compute_imbalance_settlement(
    actual_physical_mw=120, contracted_mw=100,
    sbp=80, ssp=60, sp_duration_h=0.5
)
check(s["imbalanceMw"] == 20, f"Imbalance = 20 (got {s['imbalanceMw']})")
check(s["price"] == 60, f"Price = SSP 60 (got {s['price']})")
check(s["cash"] == 600, f"Cash = 10 * 60 = 600 (got {s['cash']})")

print("\nTEST 13: settlement — zero imbalance = zero cash ...")
s = compute_imbalance_settlement(
    actual_physical_mw=100, contracted_mw=100,
    sbp=80, ssp=60
)
check(s["imbalanceMw"] == 0, f"Zero imbalance (got {s['imbalanceMw']})")
check(s["cash"] == 0, f"Zero cash (got {s['cash']})")

print("\nTEST 14: settlement — with BM accepted MW ...")
s = compute_imbalance_settlement(
    actual_physical_mw=130, contracted_mw=100, bm_accepted_mw=20,
    sbp=80, ssp=60, sp_duration_h=0.5
)
check(s["imbalanceMw"] == 10, f"130 - (100+20) = 10 (got {s['imbalanceMw']})")
check(s["price"] == 60, f"Surplus → SSP (got {s['price']})")

print("\nTEST 15: settlement — large shortage ...")
s = compute_imbalance_settlement(
    actual_physical_mw=0, contracted_mw=500,
    sbp=200, ssp=100, sp_duration_h=0.5
)
check(s["imbalanceMw"] == -500, f"Severe shortage -500 (got {s['imbalanceMw']})")
check(s["cash"] == -500 * 0.5 * 200, f"Cash = -50000 (got {s['cash']})")

# ── compute_hub_fee_from_settlements ───────────────────────────────

print("\nTEST 16: hub fee — zero sum conservation ...")
settlements = [
    {"imbCash": -800},
    {"imbCash": 600},
    {"imbCash": -200},
]
hf = compute_hub_fee_from_settlements(settlements)
total_player = sum(s["imbCash"] for s in settlements)
check(hf["sumPlayerImbCash"] == total_player,
      f"Sum player cash = {total_player} (got {hf['sumPlayerImbCash']})")
check(hf["hubFee"] == -total_player,
      f"Hub fee = {-total_player} (got {hf['hubFee']})")

print("\nTEST 17: hub fee — empty settlements ...")
hf = compute_hub_fee_from_settlements([])
check(hf["sumPlayerImbCash"] == 0, f"Empty sum = 0 (got {hf['sumPlayerImbCash']})")
check(hf["hubFee"] == 0, f"Empty hub fee = 0 (got {hf['hubFee']})")

print("\nTEST 18: hub fee — all surplus players ...")
settlements = [{"imbCash": 500}, {"imbCash": 300}]
hf = compute_hub_fee_from_settlements(settlements)
check(hf["hubFee"] == -800, f"All surplus → hub fee = -800 (got {hf['hubFee']})")

print("\nTEST 19: hub fee — all shortage players ...")
settlements = [{"imbCash": -400}, {"imbCash": -600}]
hf = compute_hub_fee_from_settlements(settlements)
check(hf["hubFee"] == 1000, f"All shortage → hub fee = 1000 (got {hf['hubFee']})")

# ── Summary ────────────────────────────────────────────────────────

print(f"\n=== SETTLEMENT ENGINE TESTS: {passed} passed, {failed} failed ===")
if failed > 0:
    print("SOME TESTS FAILED")
    if __name__ == "__main__": sys.exit(1)
else:
    print("ALL SETTLEMENT ENGINE TESTS PASSED")
