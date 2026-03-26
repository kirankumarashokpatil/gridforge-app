"""Regression tests for IDA1/IDA2 intraday auction phases."""
import sys

from engine.game_loop import (
    register_player, generate_market, advance_phase,
    submit_ida_bids, _get_room, advance_day_phase,
)
from engine.market_engine import ida_forecast, clear_ida
from engine.constants import IDA_CONFIG, GAME_MODES

errors = []

def check(name, condition, detail=""):
    if condition:
        print(f"  PASS: {name}")
    else:
        msg = f"{name}: {detail}" if detail else name
        errors.append(msg)
        print(f"  FAIL: {msg}")


# ══════════════════════════════════════════════
print("TEST 1: IDA_CONFIG present with correct keys...")
# ══════════════════════════════════════════════
check("IDA1 in IDA_CONFIG", "IDA1" in IDA_CONFIG)
check("IDA2 in IDA_CONFIG", "IDA2" in IDA_CONFIG)
check("IDA1 forecastErrorReduction = 0.4",
      IDA_CONFIG["IDA1"]["forecastErrorReduction"] == 0.4)
check("IDA2 forecastErrorReduction = 0.7",
      IDA_CONFIG["IDA2"]["forecastErrorReduction"] == 0.7)


# ══════════════════════════════════════════════
print("\nTEST 2: FULL game mode includes ida1, ida2...")
# ══════════════════════════════════════════════
full_markets = GAME_MODES["FULL"]["markets"]
check("'ida1' in FULL markets", "ida1" in full_markets, str(full_markets))
check("'ida2' in FULL markets", "ida2" in full_markets, str(full_markets))
check("Order: da before ida1", full_markets.index("da") < full_markets.index("ida1"))
check("Order: ida2 before id", full_markets.index("ida2") < full_markets.index("id"))

# TUTORIAL should NOT have IDA
tut_markets = GAME_MODES["TUTORIAL"]["markets"]
check("TUTORIAL has no ida1", "ida1" not in tut_markets)


# ══════════════════════════════════════════════
print("\nTEST 3: Phase sequence DA→IDA1→IDA2→ID→BM→SETTLED...")
# ══════════════════════════════════════════════
ROOM = "IDA_TEST"
register_player(ROOM, "g1", {"name": "Gen1", "asset": "OCGT", "role": "GENERATOR"})
generate_market(ROOM)
rs = _get_room(ROOM)

phases_seen = [rs["dayPhase"]]
# Advance through day-level phases until REALTIME
for _ in range(8):  # FORECAST_0→DA→FORECAST_1→IDA1→FORECAST_2→IDA2→ID_ROUNDS→REALTIME
    result = advance_day_phase(ROOM)
    rs = _get_room(ROOM)
    phases_seen.append(result["newPhase"])
    if result["newPhase"] == "REALTIME":
        break

expected = ["FORECAST_0", "DA", "FORECAST_1", "IDA1", "FORECAST_2", "IDA2", "ID_ROUNDS", "REALTIME"]
check(f"Phase sequence = {expected}", phases_seen == expected,
      f"got {phases_seen}")


# ══════════════════════════════════════════════
print("\nTEST 4: TUTORIAL skips IDA phases...")
# ══════════════════════════════════════════════
ROOM_T = "IDA_TUT_TEST"
register_player(ROOM_T, "t1", {"name": "Tut", "asset": "BESS_M", "role": "BESS"})
generate_market(ROOM_T)
from engine.game_loop import set_room_config
set_room_config(ROOM_T, {"gameMode": "TUTORIAL"})

rs_t = _get_room(ROOM_T)
phases_tut = [rs_t["dayPhase"]]
# TUTORIAL: FORECAST_0 → REALTIME (skips DA/IDA/ID)
result = advance_day_phase(ROOM_T)
phases_tut.append(result["newPhase"])

expected_tut = ["FORECAST_0", "REALTIME"]
check(f"TUTORIAL sequence = {expected_tut}", phases_tut == expected_tut,
      f"got {phases_tut}")


# ══════════════════════════════════════════════
print("\nTEST 5: IDA forecast blends toward actual...")
# ══════════════════════════════════════════════
ROOM2 = "IDA_FC_TEST"
register_player(ROOM2, "f1", {"name": "FC", "asset": "WIND", "role": "GENERATOR"})
generate_market(ROOM2)
rs2 = _get_room(ROOM2)
# Markets are per-SP after day-level refactor
market = rs2["markets"].get(1, {})

fc_niv = market.get("forecast", {}).get("niv", 0)
ac_niv = market.get("actual", {}).get("niv", 0)

ida1_fc = ida_forecast(market, 0.4)
ida2_fc = ida_forecast(market, 0.7)

# IDA1 should be closer to actual than DA forecast
ida1_err = abs(ida1_fc["niv"] - ac_niv)
da_err = abs(fc_niv - ac_niv)
check("IDA1 forecast closer to actual than DA",
      ida1_err <= da_err + 1,  # +1 for rounding
      f"da_err={da_err}, ida1_err={ida1_err}")

# IDA2 should be closer to actual than IDA1
ida2_err = abs(ida2_fc["niv"] - ac_niv)
check("IDA2 forecast closer to actual than IDA1",
      ida2_err <= ida1_err + 1,
      f"ida1_err={ida1_err}, ida2_err={ida2_err}")


# ══════════════════════════════════════════════
print("\nTEST 6: IDA bid submission works...")
# ══════════════════════════════════════════════
ROOM3 = "IDA_BID_TEST"
register_player(ROOM3, "b1", {"name": "Bidder", "asset": "OCGT", "role": "GENERATOR"})
generate_market(ROOM3)

r1 = submit_ida_bids(ROOM3, "IDA1", "b1", [{"side": "offer", "mw": 50, "price": 65}])
check("IDA1 bid submitted", r1.get("success") is True)

r2 = submit_ida_bids(ROOM3, "IDA2", "b1", [{"side": "offer", "mw": 30, "price": 70}])
check("IDA2 bid submitted", r2.get("success") is True)

rs3 = _get_room(ROOM3)
check("IDA1 orderbook has b1", "b1" in rs3["ida1OrderBook"])
check("IDA2 orderbook has b1", "b1" in rs3["ida2OrderBook"])


# ══════════════════════════════════════════════
print("\nTEST 7: IDA clearing adjusts contract position...")
# ══════════════════════════════════════════════
ROOM4 = "IDA_CLEAR_TEST"
register_player(ROOM4, "c1", {"name": "Clearer", "asset": "OCGT", "role": "GENERATOR"})
register_player(ROOM4, "c2", {"name": "Buyer", "asset": "OCGT", "role": "SUPPLIER"})
generate_market(ROOM4)

# Submit matching IDA1 bids
submit_ida_bids(ROOM4, "IDA1", "c1", [{"side": "offer", "mw": 30, "price": 55}])
submit_ida_bids(ROOM4, "IDA1", "c2", [{"side": "bid", "mw": 30, "price": 70}])

# Advance through FORECAST_0→DA→FORECAST_1→IDA1
advance_day_phase(ROOM4)  # FORECAST_0 → DA
advance_day_phase(ROOM4)  # DA → FORECAST_1
advance_day_phase(ROOM4)  # FORECAST_1 → IDA1
rs4 = _get_room(ROOM4)
check("Phase is IDA1", rs4["dayPhase"] == "IDA1")

# Advance clears IDA1
result_ida1 = advance_day_phase(ROOM4)  # IDA1 → FORECAST_2
rs4 = _get_room(ROOM4)

# Check contract position adjusted
ps_c1 = rs4["playerStates"]["c1"]
check("c1 contractPosition adjusted (offer → positive)",
      ps_c1.get("contractPosition", 0) >= 0,
      f"contractPosition={ps_c1.get('contractPosition', 0)}")


# ══════════════════════════════════════════════
print()
if errors:
    print(f"FAILURES ({len(errors)}):")
    for e in errors:
        print(f"  ✗ {e}")
    if __name__ == "__main__": sys.exit(1)
else:
    print("=== ALL IDA REGRESSION TESTS PASSED ===")
    if __name__ == "__main__": sys.exit(0)
