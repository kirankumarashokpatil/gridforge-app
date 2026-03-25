"""
State-machine exhaustive tests.

Covers gaps NOT tested by test_day_architecture.py:
  1. INTERMEDIATE mode phase sequence (skips DA/IDA)
  2. ADVANCED mode full sequence + multiAsset flag
  3. Phase guard: advance_day_phase() rejected during REALTIME
  4. Phase guard: advance_bm() rejected outside REALTIME
  5. BM sub-phase tracking for ALL 48 SPs (not just SPs 1-2)
  6. phaseInfo present in get_room_state() with all keys
  7. phaseInfo updates across phase transitions
  8. Rapid 48-SP cycle performance (< 15s)
  9. No NaN/corruption after full cycle
 10. Double advance from RESULTS — no day double-increment
"""
import sys, os, time, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from engine.game_loop import (
    register_player, advance_day_phase, advance_bm,
    _get_room, get_room_state, set_room_config, _new_room_state,
)
from engine import game_loop
from engine.constants import SPS_PER_DAY, GAME_MODES

errors = []
passed = 0


def check(name, condition, detail=""):
    global passed
    if condition:
        passed += 1
        print(f"  PASS: {name}")
    else:
        msg = f"{name}: {detail}" if detail else name
        errors.append(msg)
        print(f"  FAIL: {msg}")


# ══════════════════════════════════════════════
print("TEST 1: INTERMEDIATE mode — skips DA/IDA, keeps ID...")
# ══════════════════════════════════════════════
ROOM1 = "SM_INTERMEDIATE"
register_player(ROOM1, "g1", {"name": "Gen1", "asset": "OCGT", "role": "GENERATOR"})
set_room_config(ROOM1, {"gameMode": "INTERMEDIATE"})

rs1 = _get_room(ROOM1)
check("INTERMEDIATE starts at FORECAST_0", rs1["dayPhase"] == "FORECAST_0")

# INTERMEDIATE markets = ["bm", "id"] → skips DA, FORECAST_1, IDA1, FORECAST_2, IDA2
advance_day_phase(ROOM1)
rs1 = _get_room(ROOM1)
check("Skips to ID_ROUNDS", rs1["dayPhase"] == "ID_ROUNDS", f"got {rs1['dayPhase']}")

advance_day_phase(ROOM1)
rs1 = _get_room(ROOM1)
check("ID_ROUNDS → REALTIME", rs1["dayPhase"] == "REALTIME", f"got {rs1['dayPhase']}")
check("currentSp = 1", rs1["currentSp"] == 1)
check("bmSubPhase = BM_OPEN", rs1["bmSubPhase"] == "BM_OPEN")


# ══════════════════════════════════════════════
print("\nTEST 2: ADVANCED mode — same phases as FULL + multiAsset...")
# ══════════════════════════════════════════════
ROOM2 = "SM_ADVANCED"
register_player(ROOM2, "g1", {"name": "Gen1", "asset": "OCGT", "role": "GENERATOR"})
set_room_config(ROOM2, {"gameMode": "ADVANCED"})

check("ADVANCED has multiAsset", GAME_MODES["ADVANCED"]["multiAsset"] is True)

EXPECTED_ADV_SEQ = [
    "FORECAST_0", "DA", "FORECAST_1", "IDA1",
    "FORECAST_2", "IDA2", "ID_ROUNDS", "REALTIME",
]

visited = [_get_room(ROOM2)["dayPhase"]]
for _ in range(20):
    advance_day_phase(ROOM2)
    rs2 = _get_room(ROOM2)
    visited.append(rs2["dayPhase"])
    if rs2["dayPhase"] == "REALTIME":
        break

check("ADVANCED visits all FULL phases", visited == EXPECTED_ADV_SEQ,
      f"got {visited}")


# ══════════════════════════════════════════════
print("\nTEST 3: Guard — advance_day_phase() rejected during REALTIME...")
# ══════════════════════════════════════════════
ROOM3 = "SM_GUARD_DAY"
register_player(ROOM3, "g1", {"name": "Gen1", "asset": "OCGT", "role": "GENERATOR"})
set_room_config(ROOM3, {"gameMode": "TUTORIAL"})
advance_day_phase(ROOM3)  # FORECAST_0 → REALTIME

rs3 = _get_room(ROOM3)
check("In REALTIME", rs3["dayPhase"] == "REALTIME")

result3 = advance_day_phase(ROOM3)
check("Returns error dict", "error" in result3, f"got {result3}")
check("Error mentions REALTIME", "REALTIME" in str(result3.get("error", "")))

# State unchanged
rs3_after = _get_room(ROOM3)
check("Phase unchanged after rejected advance",
      rs3_after["dayPhase"] == "REALTIME")


# ══════════════════════════════════════════════
print("\nTEST 4: Guard — advance_bm() rejected outside REALTIME...")
# ══════════════════════════════════════════════
ROOM4 = "SM_GUARD_BM"
register_player(ROOM4, "g1", {"name": "Gen1", "asset": "OCGT", "role": "GENERATOR"})

rs4 = _get_room(ROOM4)
check("Starts at FORECAST_0", rs4["dayPhase"] == "FORECAST_0")

result4 = advance_bm(ROOM4)
check("advance_bm returns error", "error" in result4, f"got {result4}")
check("Error mentions current phase", rs4["dayPhase"] in str(result4.get("error", "")))


# ══════════════════════════════════════════════
print("\nTEST 5: BM sub-phase tracking for ALL 48 SPs...")
# ══════════════════════════════════════════════
ROOM5 = "SM_48SP"
rs5 = _new_room_state(seed=42)
rs5["gameMode"] = "TUTORIAL"
rs5["playerStates"]["g1"] = {
    "name": "Gen1", "asset": "OCGT", "role": "GENERATOR",
    "cash": 0, "daCash": 0, "soc": 0, "baseLoadMw": 0,
    "imbalancePenalty": 0, "spHistory": [], "physicalStatus": "ONLINE",
    "roleScore": 0, "systemScore": 0, "overallScore": 0,
}
game_loop._room_states[ROOM5] = rs5

advance_day_phase(ROOM5)  # FORECAST_0 → REALTIME
rs5 = _get_room(ROOM5)
check("In REALTIME", rs5["dayPhase"] == "REALTIME")

sp_order = []
bm_subs_per_sp = {}

for _ in range(SPS_PER_DAY * 3 + 10):
    rs5 = _get_room(ROOM5)
    if rs5["dayPhase"] != "REALTIME":
        break
    sp = rs5["currentSp"]
    sub = rs5["bmSubPhase"]
    if sp not in bm_subs_per_sp:
        bm_subs_per_sp[sp] = []
        sp_order.append(sp)
    bm_subs_per_sp[sp].append(sub)
    advance_bm(ROOM5)

rs5 = _get_room(ROOM5)
check("Reached RESULTS", rs5["dayPhase"] == "RESULTS", f"got {rs5['dayPhase']}")
check("All 48 SPs visited", len(sp_order) == SPS_PER_DAY, f"got {len(sp_order)}")
check("SPs in sequential order", sp_order == list(range(1, SPS_PER_DAY + 1)))

sub_ok = 0
for sp in range(1, SPS_PER_DAY + 1):
    subs = bm_subs_per_sp.get(sp, [])
    if subs == ["BM_OPEN", "BM_CLEAR", "SP_SETTLED"]:
        sub_ok += 1
    else:
        check(f"SP {sp} sub-phases", False, f"got {subs}")
check(f"All {SPS_PER_DAY} SPs have correct sub-phases", sub_ok == SPS_PER_DAY,
      f"{sub_ok}/{SPS_PER_DAY}")


# ══════════════════════════════════════════════
print("\nTEST 6: phaseInfo present in get_room_state()...")
# ══════════════════════════════════════════════
ROOM6 = "SM_PHASE_INFO"
register_player(ROOM6, "g1", {"name": "Gen1", "asset": "OCGT", "role": "GENERATOR"})

state6 = get_room_state(ROOM6)
pi = state6.get("phaseInfo")
check("phaseInfo present", pi is not None)
for key in ("label", "realTime", "type", "spRange", "description"):
    check(f"phaseInfo has '{key}'", key in (pi or {}))

check("marketComparison present", state6.get("marketComparison") is not None)
check("marketComparison is dict", isinstance(state6.get("marketComparison"), dict))


# ══════════════════════════════════════════════
print("\nTEST 7: phaseInfo updates across phase transitions...")
# ══════════════════════════════════════════════
ROOM7 = "SM_PHASE_INFO_UPD"
register_player(ROOM7, "g1", {"name": "Gen1", "asset": "OCGT", "role": "GENERATOR"})
set_room_config(ROOM7, {"gameMode": "FULL"})

labels = []
state7 = get_room_state(ROOM7)
labels.append(state7["phaseInfo"]["label"])

for _ in range(3):
    advance_day_phase(ROOM7)
    state7 = get_room_state(ROOM7)
    labels.append(state7["phaseInfo"]["label"])

check("4 distinct labels across 4 phases", len(set(labels)) == 4,
      f"got {labels}")
check("First label contains 'Forecast'", "Forecast" in labels[0], labels[0])


# ══════════════════════════════════════════════
print("\nTEST 8: Rapid 48-SP cycle performance...")
# ══════════════════════════════════════════════
ROOM8 = "SM_PERF"
rs8 = _new_room_state(seed=777)
rs8["gameMode"] = "TUTORIAL"
rs8["playerStates"]["g1"] = {
    "name": "Gen1", "asset": "OCGT", "role": "GENERATOR",
    "cash": 0, "daCash": 0, "soc": 0, "baseLoadMw": 0,
    "imbalancePenalty": 0, "spHistory": [], "physicalStatus": "ONLINE",
    "roleScore": 0, "systemScore": 0, "overallScore": 0,
}
game_loop._room_states[ROOM8] = rs8

advance_day_phase(ROOM8)  # → REALTIME
t0 = time.time()
for _ in range(SPS_PER_DAY * 3 + 5):
    rs8 = _get_room(ROOM8)
    if rs8["dayPhase"] != "REALTIME":
        break
    advance_bm(ROOM8)
elapsed = time.time() - t0

check(f"48-SP cycle < 15s (took {elapsed:.2f}s)", elapsed < 15)


# ══════════════════════════════════════════════
print("\nTEST 9: No NaN/corruption after full cycle...")
# ══════════════════════════════════════════════
rs9 = _get_room(ROOM8)
check("Reached RESULTS", rs9["dayPhase"] == "RESULTS")
ps = rs9["playerStates"]["g1"]
check("Cash is not NaN", not math.isnan(ps["cash"]))
check("overallScore not None", ps["overallScore"] is not None)
check("roleScore not None", ps["roleScore"] is not None)
check("spHistory has 48 entries", len(ps["spHistory"]) == SPS_PER_DAY,
      f"got {len(ps['spHistory'])}")
check("All spHistory entries have 'sp' key",
      all("sp" in h for h in ps["spHistory"]))


# ══════════════════════════════════════════════
print("\nTEST 10: Double advance from RESULTS — no day skip...")
# ══════════════════════════════════════════════
# ROOM8 is in RESULTS after tests 8-9
advance_day_phase(ROOM8)
rs10 = _get_room(ROOM8)
check("First advance → FORECAST_0", rs10["dayPhase"] == "FORECAST_0",
      f"got {rs10['dayPhase']}")
check("Day = 2", rs10["day"] == 2, f"got {rs10['day']}")

advance_day_phase(ROOM8)
rs10b = _get_room(ROOM8)
check("Second advance moves to next phase (not FORECAST_0)",
      rs10b["dayPhase"] != "FORECAST_0", f"got {rs10b['dayPhase']}")
check("Day still 2 (no double-increment)", rs10b["day"] == 2,
      f"got {rs10b['day']}")


# ══════════════════════════════════════════════
print(f"\n{'='*50}")
print(f"STATE MACHINE TESTS: {passed} passed, {len(errors)} failed")
print(f"{'='*50}")
if errors:
    for e in errors:
        print(f"  * {e}")
    print("SOME TESTS FAILED")
else:
    print("ALL STATE MACHINE TESTS PASSED")

if __name__ == "__main__":
    sys.exit(1 if errors else 0)
