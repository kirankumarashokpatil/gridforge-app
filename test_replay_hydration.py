"""Regression test: replay_from_events restores DA/IDA/ID positions/cash and phaseStartTs."""
import sys

sys.path.insert(0, "backend")

from engine import game_loop


def _mk_players_from_state(rs: dict) -> list[dict]:
    players = []
    for pid, ps in rs.get("playerStates", {}).items():
        players.append(
            {
                "player_id": pid,
                "name": ps.get("name", pid),
                "role": ps.get("role", "GENERATOR"),
                "asset": ps.get("asset", ""),
                "cash": ps.get("cash", 0),
                "da_cash": ps.get("daCash", 0),
                "sof": ps.get("soc", 50),
            }
        )
    return players


def _assert_close(a: float, b: float, eps: float = 1e-6) -> None:
    assert abs(float(a) - float(b)) <= eps, f"Expected {a} ~= {b}"


ROOM = "REPLAY_HYDRATION_TEST"

# Build a state path that includes DA, IDA, and ID changes.
game_loop.register_player(ROOM, "g1", {"name": "Gen", "asset": "OCGT", "role": "GENERATOR"})
game_loop.register_player(ROOM, "s1", {"name": "Sup", "asset": "DSR", "role": "SUPPLIER"})

# FORECAST_0 -> DA
game_loop.advance_day_phase(ROOM)

# DA submissions and clear (DA -> FORECAST_1)
game_loop.submit_da_bids(ROOM, "g1", [{"sp": 5, "side": "offer", "mw": 40, "price": 50}])
game_loop.submit_da_bids(ROOM, "s1", [{"sp": 5, "side": "bid", "mw": 35, "price": 120}])
game_loop.advance_day_phase(ROOM)

# FORECAST_1 -> IDA1
game_loop.advance_day_phase(ROOM)

# IDA1 submissions and clear (IDA1 -> FORECAST_2)
game_loop.submit_ida_bids(ROOM, "IDA1", "g1", [{"sp": 5, "side": "offer", "mw": 10, "price": 55}])
game_loop.submit_ida_bids(ROOM, "IDA1", "s1", [{"sp": 5, "side": "bid", "mw": 10, "price": 90}])
game_loop.advance_day_phase(ROOM)

# FORECAST_2 -> IDA2 -> ID_ROUNDS
game_loop.advance_day_phase(ROOM)
game_loop.advance_day_phase(ROOM)

# ID orders then ID close (ID_ROUNDS -> REALTIME)
game_loop.submit_id_orders(ROOM, "g1", [{"sp": 5, "side": "offer", "mw": 5, "price": 58}])
game_loop.submit_id_orders(ROOM, "s1", [{"sp": 5, "side": "bid", "mw": 5, "price": 95}])
game_loop.advance_day_phase(ROOM)

original = game_loop._get_room(ROOM)
original_pos = {
    pid: dict(sp_map) for pid, sp_map in original.get("positions", {}).items()
}
original_cash = {
    pid: float(ps.get("cash", 0)) for pid, ps in original.get("playerStates", {}).items()
}
original_dacash = {
    pid: float(ps.get("daCash", 0)) for pid, ps in original.get("playerStates", {}).items()
}

# Use in-memory pending events to simulate persisted event log rows.
events = [dict(ev) for ev in original.get("_pendingEvents", [])]
assert any(ev.get("event_type") == "DA_CLEARED" for ev in events)
assert any(ev.get("event_type") == "IDA_CLEARED" for ev in events)
assert any(ev.get("event_type") == "ID_CLOSED" for ev in events)

players = _mk_players_from_state(original)
last_event_ts = int(events[-1]["occurred_at"])

# Simulate cold-start: clear in-memory room and replay from events.
game_loop._room_states.pop(ROOM, None)
recovered = game_loop.replay_from_events(ROOM, players, events, scenario_id="NORMAL")

assert recovered.get("dayPhase") == "REALTIME"
assert recovered.get("currentSp") == 1
assert recovered.get("bmSubPhase") == "BM_OPEN"
assert int(recovered.get("phaseStartTs", 0)) == last_event_ts

for pid in ("g1", "s1"):
    for sp, mw in original_pos.get(pid, {}).items():
        _assert_close(recovered.get("positions", {}).get(pid, {}).get(sp, 0), mw)
    _assert_close(recovered.get("playerStates", {}).get(pid, {}).get("cash", 0), original_cash[pid])
    _assert_close(recovered.get("playerStates", {}).get(pid, {}).get("daCash", 0), original_dacash[pid])

print("PASS: replay hydration restores DA/IDA/ID positions/cash and phaseStartTs")
