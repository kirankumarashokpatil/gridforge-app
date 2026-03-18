"""
Regression tests for the new day-level + SP-level phase architecture.

Architecture:
  Day-level: FORECAST → DA → IDA1 → IDA2 → ID → REALTIME
  Real-time: SP 1..48, each with BM_OPEN → BM_CLOSE
  End:       RESULTS → next day
"""
import sys

from engine.game_loop import (
    register_player, advance_phase, advance_day_phase, advance_bm,
    generate_all_markets, submit_da_bids, submit_ida_bids,
    submit_id_orders, submit_bm_bid, set_room_config,
    _get_room, _next_day_phase, get_room_state,
)
from engine.constants import SPS_PER_DAY, GAME_MODES, IDA_CONFIG

errors = []


def check(name, condition, detail=""):
    if condition:
        print(f"  PASS: {name}")
    else:
        msg = f"{name}: {detail}" if detail else name
        errors.append(msg)
        print(f"  FAIL: {msg}")


# ══════════════════════════════════════════════
print("TEST 1: Room initialises with day-level state...")
# ══════════════════════════════════════════════
ROOM = "ARCH_TEST_1"
register_player(ROOM, "g1", {"name": "Gen1", "asset": "OCGT", "role": "GENERATOR"})
rs = _get_room(ROOM)
check("day = 1", rs["day"] == 1)
check("dayPhase = FORECAST", rs["dayPhase"] == "FORECAST")
check("currentSp = 0", rs["currentSp"] == 0)
check("bmSubPhase = None", rs["bmSubPhase"] is None)
check("markets is empty dict", rs["markets"] == {})
check("positions is empty dict", rs["positions"] == {})

# ══════════════════════════════════════════════
print("\nTEST 2: FULL mode day-level phase sequence...")
# ══════════════════════════════════════════════
ROOM2 = "ARCH_TEST_2"
register_player(ROOM2, "g1", {"name": "Gen1", "asset": "OCGT", "role": "GENERATOR"})
rs2 = _get_room(ROOM2)

# FORECAST → DA
r = advance_day_phase(ROOM2)
check("FORECAST → DA", rs2["dayPhase"] == "DA", rs2["dayPhase"])
check("Markets generated for 48 SPs", r.get("marketsGenerated") == 48)
check("48 markets exist", len(rs2["markets"]) == 48)
check("Positions initialised", "g1" in rs2["positions"])
check("Position for SP 1 = 0", rs2["positions"]["g1"].get(1) == 0.0)

# DA → IDA1
r = advance_day_phase(ROOM2)
check("DA → IDA1", rs2["dayPhase"] == "IDA1", rs2["dayPhase"])
check("daResults populated", len(rs2["daResults"]) == 48)

# IDA1 → IDA2
r = advance_day_phase(ROOM2)
check("IDA1 → IDA2", rs2["dayPhase"] == "IDA2", rs2["dayPhase"])

# IDA2 → ID
r = advance_day_phase(ROOM2)
check("IDA2 → ID", rs2["dayPhase"] == "ID", rs2["dayPhase"])

# ID → REALTIME (enters BM for SP 1)
r = advance_day_phase(ROOM2)
check("ID → REALTIME", rs2["dayPhase"] == "REALTIME", rs2["dayPhase"])
check("currentSp = 1", rs2["currentSp"] == 1)
check("bmSubPhase = BM_OPEN", rs2["bmSubPhase"] == "BM_OPEN")

# ══════════════════════════════════════════════
print("\nTEST 3: TUTORIAL mode skips DA/IDA/ID...")
# ══════════════════════════════════════════════
ROOM3 = "ARCH_TEST_3"
register_player(ROOM3, "t1", {"name": "Tut", "asset": "BESS_M", "role": "BESS"})
set_room_config(ROOM3, {"gameMode": "TUTORIAL"})

# FORECAST → REALTIME (skips DA, IDA1, IDA2, ID)
r = advance_day_phase(ROOM3)  # FORECAST → next
rs3 = _get_room(ROOM3)
check("TUTORIAL: FORECAST → REALTIME", rs3["dayPhase"] == "REALTIME",
      rs3["dayPhase"])
check("TUTORIAL: currentSp = 1", rs3["currentSp"] == 1)

# ══════════════════════════════════════════════
print("\nTEST 4: BM loop cycles through SPs...")
# ══════════════════════════════════════════════
ROOM4 = "ARCH_TEST_4"
register_player(ROOM4, "g1", {"name": "Gen1", "asset": "OCGT", "role": "GENERATOR"})

# Get to REALTIME
advance_day_phase(ROOM4)  # FORECAST
advance_day_phase(ROOM4)  # DA
advance_day_phase(ROOM4)  # IDA1
advance_day_phase(ROOM4)  # IDA2
advance_day_phase(ROOM4)  # ID → REALTIME, SP 1

rs4 = _get_room(ROOM4)
check("In REALTIME SP 1", rs4["currentSp"] == 1 and rs4["dayPhase"] == "REALTIME")

# BM_OPEN → BM_CLOSE (clears + settles SP 1)
r = advance_bm(ROOM4)
check("BM_OPEN → BM_CLOSE", rs4["bmSubPhase"] == "BM_CLOSE", rs4["bmSubPhase"])
check("SP 1 settled", 1 in rs4["spSettlements"])

# BM_CLOSE → next SP (BM_OPEN for SP 2)
r = advance_bm(ROOM4)
check("Advance to SP 2", rs4["currentSp"] == 2, rs4["currentSp"])
check("BM_OPEN for SP 2", rs4["bmSubPhase"] == "BM_OPEN")

# ══════════════════════════════════════════════
print("\nTEST 5: Complete day cycle (all 48 SPs)...")
# ══════════════════════════════════════════════
ROOM5 = "ARCH_TEST_5"
register_player(ROOM5, "g1", {"name": "Gen1", "asset": "OCGT", "role": "GENERATOR"})
set_room_config(ROOM5, {"gameMode": "TUTORIAL"})  # Skip trading phases

# FORECAST → REALTIME
advance_day_phase(ROOM5)
rs5 = _get_room(ROOM5)
check("Start REALTIME", rs5["dayPhase"] == "REALTIME")

# Run all 48 SPs (each needs BM_OPEN + BM_CLOSE = 2 advances)
for sp_num in range(1, SPS_PER_DAY + 1):
    advance_bm(ROOM5)  # BM_OPEN → BM_CLOSE (clear + settle)
    if sp_num < SPS_PER_DAY:
        advance_bm(ROOM5)  # BM_CLOSE → next SP BM_OPEN

# After last SP's BM_CLOSE, advance should go to RESULTS
advance_bm(ROOM5)
check("All SPs done → RESULTS", rs5["dayPhase"] == "RESULTS", rs5["dayPhase"])
check("currentSp = 0 after RESULTS", rs5["currentSp"] == 0)
check("48 SPs settled", len(rs5["spSettlements"]) == 48,
      f"got {len(rs5['spSettlements'])}")

# Scores computed
check("g1 has roleScore", rs5["playerStates"]["g1"]["roleScore"] is not None)
check("g1 has overallScore", rs5["playerStates"]["g1"]["overallScore"] is not None)

# ══════════════════════════════════════════════
print("\nTEST 6: New day resets day-level state...")
# ══════════════════════════════════════════════
# Continue from ROOM5 which is in RESULTS
advance_day_phase(ROOM5)  # RESULTS → FORECAST (new day)
check("New day: dayPhase = FORECAST", rs5["dayPhase"] == "FORECAST", rs5["dayPhase"])
check("New day: day = 2", rs5["day"] == 2)
check("New day: markets cleared", len(rs5["markets"]) == 0)
check("New day: positions cleared", len(rs5["positions"]) == 0)
check("New day: bmResults cleared", len(rs5["bmResults"]) == 0)
check("New day: spSettlements cleared", len(rs5["spSettlements"]) == 0)
# But player state persists
check("Player state persists", "g1" in rs5["playerStates"])
check("Cash persists", rs5["playerStates"]["g1"]["cash"] is not None)

# ══════════════════════════════════════════════
print("\nTEST 7: DA bids across all SPs update positions...")
# ══════════════════════════════════════════════
ROOM7 = "ARCH_TEST_7"
register_player(ROOM7, "gen", {"name": "Gen", "asset": "OCGT", "role": "GENERATOR"})
register_player(ROOM7, "sup", {"name": "Sup", "asset": "OCGT", "role": "SUPPLIER"})

# FORECAST
advance_day_phase(ROOM7)
rs7 = _get_room(ROOM7)

# Submit DA bids: gen offers 50MW for SP 10, sup bids 50MW for SP 10
submit_da_bids(ROOM7, "gen", [{"sp": 10, "side": "offer", "mw": 50, "price": 55}])
submit_da_bids(ROOM7, "sup", [{"sp": 10, "side": "bid", "mw": 50, "price": 70}])

# DA clears
advance_day_phase(ROOM7)
check("DA cleared", rs7["dayPhase"] == "IDA1", rs7["dayPhase"])

# Check gen's position for SP 10 was updated
gen_pos_10 = rs7["positions"].get("gen", {}).get(10, 0)
check("Gen position for SP 10 > 0 (sold)",
      gen_pos_10 > 0, f"got {gen_pos_10}")

# SP 1 should still be 0 (no bids for it)
gen_pos_1 = rs7["positions"].get("gen", {}).get(1, 0)
check("Gen position for SP 1 = 0 (no bids)", gen_pos_1 == 0.0)

# ══════════════════════════════════════════════
print("\nTEST 8: IDA bids further adjust positions...")
# ══════════════════════════════════════════════
# Continue from ROOM7 (now in IDA1)
old_pos = rs7["positions"]["gen"][10]
submit_ida_bids(ROOM7, "IDA1", "gen", [{"sp": 10, "side": "offer", "mw": 10, "price": 60}])
submit_ida_bids(ROOM7, "IDA1", "sup", [{"sp": 10, "side": "bid", "mw": 10, "price": 75}])

advance_day_phase(ROOM7)  # IDA1 → IDA2
new_pos = rs7["positions"]["gen"][10]
check("IDA1 increased gen position for SP 10",
      new_pos >= old_pos, f"old={old_pos}, new={new_pos}")

# ══════════════════════════════════════════════
print("\nTEST 9: advance_phase compat routes correctly...")
# ══════════════════════════════════════════════
ROOM9 = "ARCH_TEST_9"
register_player(ROOM9, "g1", {"name": "G", "asset": "OCGT", "role": "GENERATOR"})
set_room_config(ROOM9, {"gameMode": "TUTORIAL"})

# advance_phase should work as compat wrapper
r = advance_phase(ROOM9)  # FORECAST → REALTIME
rs9 = _get_room(ROOM9)
check("Compat: dayPhase = REALTIME", rs9["dayPhase"] == "REALTIME", rs9["dayPhase"])

# In REALTIME, advance_phase should route to advance_bm
r = advance_phase(ROOM9)  # BM_OPEN → BM_CLOSE
check("Compat: bmSubPhase = BM_CLOSE", rs9["bmSubPhase"] == "BM_CLOSE",
      rs9["bmSubPhase"])

# ══════════════════════════════════════════════
print("\nTEST 10: get_room_state returns new fields...")
# ══════════════════════════════════════════════
state = get_room_state(ROOM9)
check("State has 'day'", "day" in state)
check("State has 'dayPhase'", "dayPhase" in state)
check("State has 'currentSp'", "currentSp" in state)
check("State has 'bmSubPhase'", "bmSubPhase" in state)
check("State has 'positions'", "positions" in state)
check("State has 'markets'", "markets" in state)
check("State has 'daResults'", "daResults" in state)


# ══════════════════════════════════════════════
print("\nTEST 11: SPS_PER_DAY = 48...")
# ══════════════════════════════════════════════
check("SPS_PER_DAY = 48", SPS_PER_DAY == 48)


# ══════════════════════════════════════════════
print("\nTEST 12: BM bids only apply to current SP...")
# ══════════════════════════════════════════════
ROOM12 = "ARCH_TEST_12"
register_player(ROOM12, "g1", {"name": "G1", "asset": "OCGT", "role": "GENERATOR"})
set_room_config(ROOM12, {"gameMode": "TUTORIAL"})
advance_day_phase(ROOM12)  # FORECAST → REALTIME

rs12 = _get_room(ROOM12)
check("SP 1 BM_OPEN", rs12["currentSp"] == 1 and rs12["bmSubPhase"] == "BM_OPEN")

# Submit BM bid for current SP
submit_bm_bid(ROOM12, "g1", {"side": "offer", "mw": 20, "price": 65})
check("BM bid in orderbook", "g1" in rs12["bmOrderBook"])

# Advance BM_OPEN → BM_CLOSE (clears SP 1)
advance_bm(ROOM12)
check("SP 1 BM_CLOSE", rs12["bmSubPhase"] == "BM_CLOSE")

# Advance to SP 2 — BM orderbook should be fresh
advance_bm(ROOM12)
check("SP 2 BM_OPEN", rs12["currentSp"] == 2 and rs12["bmSubPhase"] == "BM_OPEN")
check("BM orderbook cleared for SP 2", len(rs12["bmOrderBook"]) == 0)


# ══════════════════════════════════════════════
print("\nTEST 13: Continuous ID order-book pay-as-bid matching...")
# ══════════════════════════════════════════════
from engine.id_trading_engine import match_id_orders, clear_id_round

buys = [
    {"playerId": "buyer1", "sp": 5, "price": 70, "volumeMW": 30},
    {"playerId": "buyer2", "sp": 5, "price": 60, "volumeMW": 20},
]
sells = [
    {"playerId": "seller1", "sp": 5, "price": 50, "volumeMW": 25},
    {"playerId": "seller2", "sp": 5, "price": 65, "volumeMW": 20},
]
trades = match_id_orders(buys, sells)
check("ID trades matched", len(trades) > 0, f"got {len(trades)}")

# buyer1 (70) matches seller1 (50) at sell price 50 (pay-as-bid)
t0 = trades[0]
check("First trade at seller price (pay-as-bid)",
      t0["price"] == 50.0, f"got {t0['price']}")
check("First trade buyer = buyer1", t0["buyerId"] == "buyer1")
check("First trade seller = seller1", t0["sellerId"] == "seller1")

# buyer1 has 5MW left (30-25=5), buyer2 (60) >= seller2 (65)? No, 60<65.
# So buyer1's residual 5MW matches seller2? 70>=65 yes
if len(trades) >= 2:
    t1 = trades[1]
    check("Second trade at seller2 price (65)",
          t1["price"] == 65.0, f"got {t1['price']}")
    check("Second trade volume = 5MW (buyer1 residual)",
          t1["volumeMW"] == 5.0, f"got {t1['volumeMW']}")

# buyer2 at 60 < seller2 at 65 → no match
total_vol = sum(t["volumeMW"] for t in trades)
check("Total ID volume = 30MW (25+5)", total_vol == 30.0, f"got {total_vol}")


# ══════════════════════════════════════════════
print("\nTEST 14: clear_id_round processes multi-SP orders...")
# ══════════════════════════════════════════════
orders_by_player = {
    "gen1": [
        {"sp": 3, "side": "sell", "mw": 40, "price": 55},
        {"sp": 7, "side": "sell", "mw": 20, "price": 60},
    ],
    "sup1": [
        {"sp": 3, "side": "buy", "mw": 40, "price": 58},
        {"sp": 7, "side": "buy", "mw": 15, "price": 62},
    ],
}
id_result = clear_id_round(orders_by_player, open_sps=[3, 7])
check("ID round has trades", len(id_result["trades"]) > 0)
check("Trades for SP 3", 3 in id_result["tradesBySp"])
check("Trades for SP 7", 7 in id_result["tradesBySp"])

# Position deltas: gen1 sells → positive delta, sup1 buys → negative delta
gen1_delta_3 = id_result["positionDeltas"].get("gen1", {}).get(3, 0)
sup1_delta_3 = id_result["positionDeltas"].get("sup1", {}).get(3, 0)
check("gen1 sells SP 3 → positive delta", gen1_delta_3 > 0, f"got {gen1_delta_3}")
check("sup1 buys SP 3 → negative delta", sup1_delta_3 < 0, f"got {sup1_delta_3}")

# Cash: seller receives, buyer pays
check("gen1 receives cash", id_result["cashDeltas"].get("gen1", 0) > 0)
check("sup1 pays cash", id_result["cashDeltas"].get("sup1", 0) < 0)

# SP 7: gen1 offers 20@60, sup1 bids 15@62 → matched 15MW at 60
sp7_trades = id_result["tradesBySp"].get(7, [])
if sp7_trades:
    check("SP 7 trade at sell price 60", sp7_trades[0]["price"] == 60.0,
          f"got {sp7_trades[0]['price']}")
    check("SP 7 trade volume = 15MW", sp7_trades[0]["volumeMW"] == 15.0,
          f"got {sp7_trades[0]['volumeMW']}")


# ══════════════════════════════════════════════
print("\nTEST 15: ID close wired into game loop updates positions...")
# ══════════════════════════════════════════════
ROOM15 = "ARCH_TEST_15"
register_player(ROOM15, "g1", {"name": "Gen", "asset": "OCGT", "role": "GENERATOR"})
register_player(ROOM15, "s1", {"name": "Sup", "asset": "OCGT", "role": "SUPPLIER"})

# Advance to ID phase
advance_day_phase(ROOM15)  # FORECAST
advance_day_phase(ROOM15)  # DA
advance_day_phase(ROOM15)  # IDA1
advance_day_phase(ROOM15)  # IDA2

rs15 = _get_room(ROOM15)
check("In ID phase", rs15["dayPhase"] == "ID", rs15["dayPhase"])

# Submit ID orders
submit_id_orders(ROOM15, "g1", [{"sp": 5, "side": "offer", "mw": 30, "price": 52}])
submit_id_orders(ROOM15, "s1", [{"sp": 5, "side": "bid", "mw": 30, "price": 55}])

g1_pos_before = rs15["positions"]["g1"][5]
s1_pos_before = rs15["positions"]["s1"][5]
g1_cash_before = rs15["playerStates"]["g1"]["cash"]
s1_cash_before = rs15["playerStates"]["s1"]["cash"]

# Advance ID → REALTIME (this triggers _on_id_close with order-book matching)
r = advance_day_phase(ROOM15)
check("ID → REALTIME", rs15["dayPhase"] == "REALTIME", rs15["dayPhase"])
check("ID trades matched > 0", r.get("idTradesMatched", 0) > 0,
      f"got {r.get('idTradesMatched')}")

g1_pos_after = rs15["positions"]["g1"][5]
s1_pos_after = rs15["positions"]["s1"][5]
check("gen position increased (sold)", g1_pos_after > g1_pos_before,
      f"before={g1_pos_before}, after={g1_pos_after}")
check("sup position decreased (bought)", s1_pos_after < s1_pos_before,
      f"before={s1_pos_before}, after={s1_pos_after}")

g1_cash_after = rs15["playerStates"]["g1"]["cash"]
s1_cash_after = rs15["playerStates"]["s1"]["cash"]
check("gen received cash from ID sell", g1_cash_after > g1_cash_before,
      f"before={g1_cash_before}, after={g1_cash_after}")
check("sup paid cash for ID buy", s1_cash_after < s1_cash_before,
      f"before={s1_cash_before}, after={s1_cash_after}")

# Positions are frozen
check("Positions frozen", "frozenPositions" in rs15)
check("Frozen matches current", rs15["frozenPositions"]["g1"][5] == g1_pos_after)


# ══════════════════════════════════════════════
print("\nTEST 16: Gate closure — closed SPs rejected...")
# ══════════════════════════════════════════════
# clear_id_round with restricted open_sps should ignore orders for closed SPs
orders_gate = {
    "a": [{"sp": 1, "side": "sell", "mw": 10, "price": 50}],
    "b": [{"sp": 1, "side": "buy", "mw": 10, "price": 55},
          {"sp": 99, "side": "buy", "mw": 10, "price": 55}],  # SP 99 doesn't exist
}
gate_result = clear_id_round(orders_gate, open_sps=[1])
check("SP 1 trades matched", len(gate_result["trades"]) == 1)
check("SP 99 ignored (not open)", 99 not in gate_result.get("tradesBySp", {}))

# Empty open_sps = no trades
empty_result = clear_id_round(orders_gate, open_sps=[])
check("No open SPs → no trades", len(empty_result["trades"]) == 0)


# ══════════════════════════════════════════════
print()
if errors:
    print(f"FAILURES ({len(errors)}):")
    for e in errors:
        print(f"  ✗ {e}")
    sys.exit(1)
else:
    print("=== ALL DAY-ARCHITECTURE TESTS PASSED ===")
    sys.exit(0)
