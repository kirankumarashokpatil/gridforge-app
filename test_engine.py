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

print("\n=== ALL SMOKE TESTS PASSED ===")
if __name__ == "__main__":
    sys.exit(0)
