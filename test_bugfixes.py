"""Regression tests for the 6 bugs found during audit."""
import sys

from engine.game_loop import (
    register_player, generate_market, advance_phase,
    settle_current_sp, _get_room, advance_day_phase,
    advance_bm, set_room_config,
)
from engine.constants import SCORING_CONFIG

ROOM = "BUGFIX_TEST"

# ── Setup: register 3 players, use TUTORIAL to skip to REALTIME quickly ──
register_player(ROOM, "p1", {"name": "Alice", "asset": "BESS_M", "role": "BESS"})
register_player(ROOM, "p2", {"name": "Bob", "asset": "OCGT", "role": "GENERATOR"})
register_player(ROOM, "p3", {"name": "Carol", "asset": "WIND", "role": "INTERCONNECTOR"})
set_room_config(ROOM, {"gameMode": "TUTORIAL"})

errors = []

# ══════════════════════════════════════════════
# BUG 1: update_system_state called per-player
# After one settlement, totalSPs should be 1, not 3.
# ══════════════════════════════════════════════
print("BUG 1: update_system_state per-SP (not per-player)...")
# FORECAST_0 → REALTIME (TUTORIAL skips DA/IDA/ID)
advance_day_phase(ROOM)
# BM_OPEN → BM_CLEAR (settles SP 1)
advance_bm(ROOM)
rs = _get_room(ROOM)

total_sps = rs["systemState"]["totalSPs"]
if total_sps == 1:
    print(f"  PASS: totalSPs = {total_sps}")
else:
    errors.append(f"BUG 1 FAIL: totalSPs = {total_sps}, expected 1")
    print(f"  FAIL: totalSPs = {total_sps}, expected 1")

# ══════════════════════════════════════════════
# BUG 2: spHistory never populated
# After settlement, each player should have 1 entry in spHistory.
# ══════════════════════════════════════════════
print("BUG 2: spHistory populated after settlement...")
history = []
for pid in ["p1", "p2", "p3"]:
    history = rs["playerStates"][pid].get("spHistory", [])
    if len(history) == 1:
        print(f"  PASS: {pid} spHistory length = {len(history)}")
    else:
        errors.append(f"BUG 2 FAIL: {pid} spHistory length = {len(history)}, expected 1")
        print(f"  FAIL: {pid} spHistory length = {len(history)}, expected 1")

# Check that spHistory has required keys
required_keys = {"sp", "revenue", "bmRev", "daRev", "contractPosMw", "accepted"}
if history:
    sp_entry = history[0]
    missing = required_keys - set(sp_entry.keys())
    if not missing:
        print(f"  PASS: spHistory entry has all required keys")
    else:
        errors.append(f"BUG 2 FAIL: spHistory missing keys: {missing}")
        print(f"  FAIL: spHistory missing keys: {missing}")

# ══════════════════════════════════════════════
# BUG 3: INTERCONNECTOR missing from SCORING_CONFIG
# ══════════════════════════════════════════════
print("BUG 3: INTERCONNECTOR in SCORING_CONFIG...")
if "INTERCONNECTOR" in SCORING_CONFIG:
    ic_cfg = SCORING_CONFIG["INTERCONNECTOR"]
    if "breakpoints" in ic_cfg and "primaryWeight" in ic_cfg:
        print(f"  PASS: INTERCONNECTOR config has breakpoints and primaryWeight")
    else:
        errors.append("BUG 3 FAIL: INTERCONNECTOR config missing breakpoints or primaryWeight")
        print(f"  FAIL: missing breakpoints or primaryWeight")
else:
    errors.append("BUG 3 FAIL: INTERCONNECTOR not in SCORING_CONFIG")
    print(f"  FAIL: INTERCONNECTOR not in SCORING_CONFIG")

# ══════════════════════════════════════════════
# BUG 4: Phase name aliases
# ══════════════════════════════════════════════
print("BUG 4: Phase alias normalization...")
try:
    from engine.game_loop import _canon_phase
    tests = [
        ("BM_GATE", "BM"),
        ("DELIVERY", "BM"),
        ("SETTLEMENT", "SETTLED"),
        ("DA", "DA"),
        ("BM", "BM"),
        ("SETTLED", "SETTLED"),
    ]
    for inp, expected in tests:
        got = _canon_phase(inp)
        if got == expected:
            print(f"  PASS: _canon_phase('{inp}') = '{got}'")
        else:
            errors.append(f"BUG 4 FAIL: _canon_phase('{inp}') = '{got}', expected '{expected}'")
            print(f"  FAIL: _canon_phase('{inp}') = '{got}', expected '{expected}'")
except ImportError:
    print("  SKIP: _canon_phase removed (day-level phase machine supersedes aliases)")

# ══════════════════════════════════════════════
# BUG 5: settle_current_sp works independently
# ══════════════════════════════════════════════
print("BUG 5: settle_current_sp works independently...")
ROOM2 = "SETTLE_TEST"
register_player(ROOM2, "x1", {"name": "Test", "asset": "BESS_M", "role": "BESS"})
generate_market(ROOM2)
# Advance to REALTIME so currentSp >= 1
rs2 = _get_room(ROOM2)
while rs2.get("dayPhase") != "REALTIME":
    advance_day_phase(ROOM2)
    rs2 = _get_room(ROOM2)
result = settle_current_sp(ROOM2)
settlements = result.get("settlements", {})
if "x1" in settlements:
    s = settlements["x1"]
    has_keys = all(k in s for k in ("deviation", "imbalancePenalty", "cash", "cashDelta"))
    if has_keys:
        print(f"  PASS: settle_current_sp returned valid settlement for x1")
    else:
        errors.append(f"BUG 5 FAIL: settlement missing keys, got: {list(s.keys())}")
        print(f"  FAIL: settlement missing keys")
else:
    errors.append("BUG 5 FAIL: x1 not in settlements")
    print(f"  FAIL: x1 not in settlements")

# ══════════════════════════════════════════════
# BUG 6: Dead imports removed (just verify import works)
# ══════════════════════════════════════════════
print("BUG 6: Clean imports (no crash)...")
try:
    import engine.game_loop
    print("  PASS: engine.game_loop imports cleanly")
except ImportError as e:
    errors.append(f"BUG 6 FAIL: import error: {e}")
    print(f"  FAIL: {e}")

# ══════════════════════════════════════════════
# BUG 7: BM accepted MW overwrite — multiple accepted bids must SUM, not overwrite
# ══════════════════════════════════════════════
print("BUG 7: BM accepted MW sums multiple bids (not overwrite)...")
ROOM3 = "BM_OVERWRITE_TEST"
register_player(ROOM3, "gen1", {"name": "Gen1", "asset": "OCGT", "role": "GENERATOR"})
generate_market(ROOM3)

# Advance to REALTIME
rs3 = _get_room(ROOM3)
while rs3.get("dayPhase") != "REALTIME":
    advance_day_phase(ROOM3)
    rs3 = _get_room(ROOM3)

sp = rs3["currentSp"]

# Simulate two accepted BM bids for the same player in the same SP
# by directly injecting into bmResults
rs3["bmResults"][sp] = {
    "accepted": [
        {"id": "gen1", "player_id": "gen1", "mwAcc": 50, "price": 60, "revenue": 1500},
        {"id": "gen1", "player_id": "gen1", "mwAcc": 50, "price": 62, "revenue": 1550},
    ],
    "isShort": True,
}
rs3["markets"][sp]["actual"]["isShort"] = True

result = settle_current_sp(ROOM3)
settlements = result.get("settlements", {})
if "gen1" in settlements:
    bm_acc = settlements["gen1"].get("bmAccMw", 0)
    if bm_acc == 100:
        print(f"  PASS: bmAccMw = {bm_acc} (correctly summed 50+50)")
    else:
        errors.append(f"BUG 7 FAIL: bmAccMw = {bm_acc}, expected 100 (50+50)")
        print(f"  FAIL: bmAccMw = {bm_acc}, expected 100 (50+50 summed)")
else:
    errors.append("BUG 7 FAIL: gen1 not in settlements")
    print(f"  FAIL: gen1 not in settlements")

# ══════════════════════════════════════════════
print()
if errors:
    print(f"FAILURES ({len(errors)}):")
    for e in errors:
        print(f"  ✗ {e}")
    if __name__ == "__main__": sys.exit(1)
else:
    print("=== ALL 7 BUG REGRESSION TESTS PASSED ===")
    if __name__ == "__main__": sys.exit(0)
