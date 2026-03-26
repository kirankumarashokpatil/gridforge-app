"""Quick smoke test for the engine package."""
import sys

print("1. Importing modules...")
from engine.market_engine import market_for_sp, clear_bm
print("   market_engine OK")

from engine.da_curve_engine import clear_full_auction, DEFAULT_DA_SEGMENTS
print("   da_curve_engine OK")

from engine.settlement_engine import compute_imbalance_settlement
print("   settlement_engine OK")

from engine.scoring_engine import compute_role_score
print("   scoring_engine OK")

from engine.game_loop import register_player, generate_market, get_room_state
print("   game_loop OK")

print("\n2. Testing market_for_sp...")
m = market_for_sp(5, "NORMAL")
print(f"   forecast NIV={m['forecast']['niv']:.0f}, actual NIV={m['actual']['niv']:.0f}")

print("\n3. Testing clear_bm...")
bids = [
    {"side": "offer", "mw": 50, "price": 80, "asset": "OCGT", "name": "P1"},
    {"side": "offer", "mw": 30, "price": 60, "asset": "BESS_M", "name": "P2"},
]
bm = clear_bm(bids, m["actual"])
print(f"   cp={bm['cp']}, accepted={len(bm['accepted'])}")

print("\n4. Testing clear_full_auction...")
curves = [{"playerId": "p1", "segments": DEFAULT_DA_SEGMENTS, "side": "sell"}]
da = clear_full_auction(curves)
print(f"   totalTraded={da['totalTradedMW']:.0f}MW")

print("\n5. Testing settlement...")
s = compute_imbalance_settlement(100, 80, 10, sbp=90, ssp=40)
print(f"   imb={s['imbalanceMw']}MW, cash={s['cash']:.0f}")

print("\n6. Testing scoring...")
rs = compute_role_score("GENERATOR", {"netProfit": 500, "capacityMW": 100, "totalMWh": 200, "imbalanceCost": 50})
print(f"   roleScore={rs['roleScore']}")

print("\n7. Testing game_loop...")
register_player("TEST", "p1", {"name": "Alice", "asset": "BESS_M", "role": "BESS"})
generate_market("TEST")
st = get_room_state("TEST")
print(f"   sp={st.get('currentSp', st.get('sp'))}, phase={st.get('dayPhase', st.get('phase'))}, players={len(st['playerStates'])}")

# ═══════════════════════════════════════════════
# NEW: GB NIV Formula tests
# ═══════════════════════════════════════════════
from engine.market_engine import compute_niv, compute_indicative_residual, compute_system_price

print("\n8. Testing compute_niv()...")

# 8a. No positions → NIV = base_noise
system = {"demandMw": 35000, "windMw": 8000, "solarMw": 3000}
r1 = compute_niv(system, 200.0, {}, 5)
assert r1["niv"] == 200.0, f"Expected 200, got {r1['niv']}"
assert r1["isShort"] is False, "200 MW should be LONG"
assert r1["totalPositionsMw"] == 0, "No positions"
print("   8a: No positions → NIV=baseNoise OK")

# 8b. Positions subtract from NIV
positions = {
    "p1": {5: 100.0, 6: 50.0},
    "p2": {5: 80.0, 6: 30.0},
}
r2 = compute_niv(system, 200.0, positions, 5)
assert r2["niv"] == 200.0 - 180.0, f"Expected 20, got {r2['niv']}"
assert r2["totalPositionsMw"] == 180.0, f"Expected 180, got {r2['totalPositionsMw']}"
assert r2["isShort"] is False
print("   8b: Positions subtract OK (200-180=20)")

# 8c. Positions can flip SHORT
r3 = compute_niv(system, 100.0, positions, 5)
assert r3["niv"] == 100.0 - 180.0, f"Expected -80, got {r3['niv']}"
assert r3["isShort"] is True
print("   8c: Position flip SHORT OK (100-180=-80)")

# 8d. Clamping at ±620
r4 = compute_niv(system, 600.0, {"p1": {5: -500.0}}, 5)
assert r4["niv"] == 620.0, f"Expected clamped 620, got {r4['niv']}"
print("   8d: Clamping at ±620 OK")

# 8e. SP not in positions → 0 contribution
r5 = compute_niv(system, 200.0, positions, 99)
assert r5["niv"] == 200.0, f"Expected 200 for unknown SP, got {r5['niv']}"
print("   8e: Missing SP → 0 contribution OK")

print("\n9. Testing compute_indicative_residual()...")

# 9a. SHORT system → only offers count
bids_9 = [
    {"side": "offer", "mw": 30},
    {"side": "offer", "mw": 20},
    {"side": "bid", "mw": 100},  # wrong side
]
ir1 = compute_indicative_residual(-100.0, True, bids_9)
assert ir1["totalBidMw"] == 50.0, f"Expected 50, got {ir1['totalBidMw']}"
assert ir1["residual"] == 50.0, f"Expected 50, got {ir1['residual']}"
assert ir1["bidCount"] == 2
assert abs(ir1["coverage"] - 0.5) < 0.01
print("   9a: SHORT → offers only OK (50/100 coverage)")

# 9b. LONG system → only bids count
ir2 = compute_indicative_residual(100.0, False, bids_9)
assert ir2["totalBidMw"] == 100.0
assert ir2["residual"] == 0.0
assert ir2["coverage"] == 1.0
print("   9b: LONG → bids only OK (100% coverage)")

# 9c. Zero NIV → no division error
ir3 = compute_indicative_residual(0.0, True, [])
assert ir3["residual"] == 0.0
print("   9c: Zero NIV OK")

print("\n10. Testing compute_system_price() (P305 VW average)...")

# 10a. SHORT → SBP = volume-weighted average of offers
accepted_10 = [
    {"price": 60, "mwAcc": 50},
    {"price": 80, "mwAcc": 30},
]
# VWAP = (60*50 + 80*30) / (50+30) = (3000+2400)/80 = 67.5
sp1 = compute_system_price(accepted_10, True, 100, 40)
assert abs(sp1["sbp"] - 67.5) < 0.1, f"Expected SBP≈67.5, got {sp1['sbp']}"
assert sp1["ssp"] < sp1["sbp"], "SSP should be less than SBP when SHORT"
print(f"   10a: SHORT VW SBP={sp1['sbp']} OK")

# 10b. LONG → SSP = volume-weighted average of bids
sp2 = compute_system_price(accepted_10, False, 100, 40)
assert abs(sp2["ssp"] - 67.5) < 0.1, f"Expected SSP≈67.5, got {sp2['ssp']}"
assert sp2["sbp"] > sp2["ssp"], "SBP should be > SSP when LONG"
print(f"   10b: LONG VW SSP={sp2['ssp']} OK")

# 10c. Empty accepted → fallback
sp3 = compute_system_price([], True, 100, 40)
assert sp3["sbp"] == 100 and sp3["ssp"] == 40
print("   10c: Empty → fallback OK")

print("\n11. Testing market_for_sp baseNoise field...")
m2 = market_for_sp(10, "NORMAL")
assert "baseNoise" in m2["forecast"], "forecast should have baseNoise"
assert "baseNoise" in m2["actual"], "actual should have baseNoise"
print(f"   11: baseNoise present: forecast={m2['forecast']['baseNoise']:.1f}, actual={m2['actual']['baseNoise']:.1f}")

print("\n=== ALL SMOKE TESTS PASSED ===")
if __name__ == "__main__":
    sys.exit(0)
