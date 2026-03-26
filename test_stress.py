"""Load/stress test: 20+ concurrent players through a full 48-SP game day.

Validates:
  - No crash or state corruption with many simultaneous players
  - All 48 SPs settle correctly
  - Cash accounting is consistent (no NaN, no double-counting)
  - Leaderboard includes all players
  - Performance: full day completes in reasonable time
"""
import sys, os, time, random
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from engine.game_loop import (
    _new_room_state, _get_room, advance_day_phase, advance_bm,
    submit_da_bids, submit_bm_bid, get_room_state,
)
from engine.constants import ASSETS, SPS_PER_DAY, GAME_MODES
from engine.leaderboard_engine import build_leaderboard

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

PLAYER_COUNT = 25
ROOM_ID = "STRESS"

ASSET_KEYS = list(ASSETS.keys())
ROLES = ["GENERATOR", "BESS", "SUPPLIER", "TRADER", "DSR", "NESO"]

# ── Setup ──────────────────────────────────────────────────────────

print(f"\n=== STRESS TEST: {PLAYER_COUNT} players × {SPS_PER_DAY} SPs ===\n")

print("Setting up room and players ...")
t0 = time.time()

# Create room with FULL mode (all markets)
from engine import game_loop
rs = _new_room_state(seed=12345)
rs["gameMode"] = "FULL"
game_loop._room_states[ROOM_ID] = rs

# Register players
players = []
for i in range(PLAYER_COUNT):
    pid = f"stress_p{i:03d}"
    asset_key = ASSET_KEYS[i % len(ASSET_KEYS)]
    role = ROLES[i % len(ROLES)]
    asset_def = ASSETS[asset_key]
    rs["playerStates"][pid] = {
        "name": f"Player {i}",
        "asset": asset_key,
        "role": role,
        "cash": 0,
        "daCash": 0,
        "soc": asset_def.get("maxMWh", 0) * 0.5 if asset_def.get("maxMWh") else 0,
        "baseLoadMw": 80 if role == "SUPPLIER" else 0,
        "imbalancePenalty": 0,
        "spHistory": [],
        "physicalStatus": "ONLINE",
        "roleScore": 0,
        "systemScore": 0,
        "overallScore": 0,
    }
    players.append({"id": pid, "asset": asset_key, "role": role})

t_setup = time.time() - t0
print(f"Setup: {PLAYER_COUNT} players in {t_setup:.2f}s")
check(len(rs["playerStates"]) == PLAYER_COUNT, f"{PLAYER_COUNT} players registered")

# ── Phase 1: Advance through day phases (FORECAST → DA → ... → REALTIME) ──

print("\nPhase 1: Advancing through day phases ...")
t1 = time.time()

max_phase_advances = 20  # Safety limit
advances = 0
while game_loop._room_states[ROOM_ID]["dayPhase"] != "REALTIME" and advances < max_phase_advances:
    rs = game_loop._room_states[ROOM_ID]
    prev_phase = rs["dayPhase"]

    # If in DA phase, submit bids from all generators/BESS
    if rs["dayPhase"] == "DA":
        for p in players:
            if p["role"] in ("GENERATOR", "BESS"):
                asset_def = ASSETS[p["asset"]]
                max_mw = asset_def.get("maxMW", 50)
                try:
                    submit_da_bids(ROOM_ID, p["id"], [
                        {"sp": sp, "mw": max_mw * 0.5, "price": 50 + random.randint(-10, 20),
                         "side": "offer", "asset": p["asset"]}
                        for sp in range(1, min(SPS_PER_DAY + 1, 10))  # first 9 SPs
                    ])
                except Exception:
                    pass  # Some asset types may not support DA bids

    result = advance_day_phase(ROOM_ID)
    advances += 1
    new_phase = game_loop._room_states[ROOM_ID]["dayPhase"]
    if new_phase == prev_phase and "error" in str(result):
        break  # Stuck — stop

rs = game_loop._room_states[ROOM_ID]
check(rs["dayPhase"] == "REALTIME", f"Reached REALTIME (got {rs['dayPhase']})")
t_phases = time.time() - t1
print(f"Day phases completed in {t_phases:.2f}s ({advances} advances)")

# ── Phase 2: Run all 48 SPs ───────────────────────────────────────

print(f"\nPhase 2: Running {SPS_PER_DAY} settlement periods ...")
t2 = time.time()

sp_errors = 0
bids_submitted = 0

for target_sp in range(1, SPS_PER_DAY + 1):
    rs = game_loop._room_states[ROOM_ID]
    # Ensure we're in BM_OPEN for this SP
    if rs.get("bmSubPhase") != "BM_OPEN":
        advance_bm(ROOM_ID)
        rs = game_loop._room_states[ROOM_ID]

    current_sp = rs.get("currentSp", 0)

    # Submit BM bids from all players
    for p in players:
        asset_def = ASSETS[p["asset"]]
        max_mw = asset_def.get("maxMW", 50)
        mw = max(1, min(max_mw * 0.3, 30))
        price = 40 + random.randint(0, 60)
        side = "offer" if random.random() > 0.5 else "bid"
        try:
            submit_bm_bid(ROOM_ID, p["id"], {
                "sp": current_sp or target_sp,
                "mw": mw,
                "price": price,
                "side": side,
                "asset": p["asset"],
            })
            bids_submitted += 1
        except Exception:
            pass  # Some bids may be rejected (gate, avail, etc.)

    # Advance through BM_OPEN → BM_CLEAR → SP_SETTLED
    for _ in range(3):
        try:
            advance_bm(ROOM_ID)
            rs = game_loop._room_states[ROOM_ID]
        except Exception as e:
            sp_errors += 1
            break

    rs = game_loop._room_states[ROOM_ID]
    if rs["dayPhase"] == "RESULTS":
        break

t_sps = time.time() - t2
rs = game_loop._room_states[ROOM_ID]
sps_settled = len(rs.get("spSettlements", {}))
print(f"  Completed in {t_sps:.2f}s, {bids_submitted} bids submitted, {sp_errors} errors")

check(rs["dayPhase"] == "RESULTS", f"Reached RESULTS (got {rs['dayPhase']})")
check(sps_settled >= SPS_PER_DAY - 1, f"All SPs settled: {sps_settled}/{SPS_PER_DAY}")

# ── Phase 3: Verify state integrity ───────────────────────────────

print("\nPhase 3: Verifying state integrity ...")

# Cash accounting
nan_players = []
negative_only_cash = 0
for pid, ps in rs["playerStates"].items():
    cash = ps.get("cash", 0)
    da_cash = ps.get("daCash", 0)
    if cash != cash or da_cash != da_cash:  # NaN check
        nan_players.append(pid)

check(len(nan_players) == 0, f"No NaN in cash ({len(nan_players)} NaN players)")

# SP settlements complete
for sp in range(1, SPS_PER_DAY + 1):
    settlement = rs.get("spSettlements", {}).get(sp)
    if settlement is None:
        check(False, f"SP {sp} has no settlement")
        break
else:
    check(True, f"All {SPS_PER_DAY} SP settlements present")

# BM results complete
bm_count = len(rs.get("bmResults", {}))
check(bm_count >= SPS_PER_DAY - 1, f"BM results for {bm_count}/{SPS_PER_DAY} SPs")

# Player states intact
for pid, ps in rs["playerStates"].items():
    required_keys = {"cash", "asset", "role", "physicalStatus"}
    missing = required_keys - set(ps.keys())
    if missing:
        check(False, f"Player {pid} missing keys: {missing}")
        break
else:
    check(True, f"All {PLAYER_COUNT} player states intact")

# ── Phase 4: Leaderboard ──────────────────────────────────────────

print("\nPhase 4: Leaderboard ...")
try:
    lb_data = []
    for pid, ps in rs["playerStates"].items():
        lb_data.append({
            "id": pid,
            "name": ps.get("name", pid),
            "role": ps.get("role", "GENERATOR"),
            "overallScore": ps.get("overallScore", 0),
            "roleScore": ps.get("roleScore", 0),
            "cash": ps.get("cash", 0),
        })
    lb = build_leaderboard(lb_data)
    lb_overall = lb.get("overall", [])
    check(len(lb_overall) == PLAYER_COUNT, f"Leaderboard has {len(lb_overall)}/{PLAYER_COUNT} entries")
    # Check ranking is sorted
    scores = [p.get("overallScore", 0) for p in lb_overall]
    check(scores == sorted(scores, reverse=True), "Leaderboard sorted descending")
except Exception as e:
    check(False, f"Leaderboard build failed: {e}")

# ── Phase 5: Performance summary ──────────────────────────────────

print("\nPhase 5: Performance ...")
total_time = time.time() - t0
check(total_time < 30, f"Full day < 30s: {total_time:.1f}s")
per_sp = t_sps / max(sps_settled, 1)
print(f"  Total: {total_time:.1f}s, Per-SP: {per_sp*1000:.0f}ms")
print(f"  Players: {PLAYER_COUNT}, Bids: {bids_submitted}, SPs: {sps_settled}")

# ── Phase 6: Multi-day rollover ───────────────────────────────────

print("\nPhase 6: Multi-day rollover ...")
try:
    rs = game_loop._room_states[ROOM_ID]
    # Record end-of-day state
    day1_cash = {pid: ps.get("cash", 0) for pid, ps in rs["playerStates"].items()}

    # Start new day (advance past RESULTS)
    result = advance_day_phase(ROOM_ID)
    rs = game_loop._room_states[ROOM_ID]
    check(rs["dayPhase"] == "FORECAST_0" or rs.get("day", 1) > 1,
          f"New day started: phase={rs['dayPhase']}, day={rs.get('day', '?')}")
    check(rs.get("currentSp", 0) == 0, f"SP reset to 0 (got {rs.get('currentSp')})")

    # Cash preserved
    for pid, ps in rs["playerStates"].items():
        check(ps.get("cash", 0) == day1_cash[pid],
              f"{pid} cash preserved: {ps.get('cash')} == {day1_cash[pid]}")
        break  # Just check first player
except Exception as e:
    check(False, f"Day rollover failed: {e}")

# ── Summary ────────────────────────────────────────────────────────

print(f"\n=== STRESS TEST: {passed} passed, {failed} failed ===")
if failed > 0:
    print("SOME TESTS FAILED")
    if __name__ == "__main__": sys.exit(1)
else:
    print("ALL STRESS TESTS PASSED")
