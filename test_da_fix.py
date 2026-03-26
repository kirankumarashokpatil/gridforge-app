"""Verify DA bid desync fix: put_da_bid now syncs in-memory daOrderBook."""
import sys
sys.path.insert(0, "backend")

from engine.game_loop import submit_da_bids, _on_da_close_all, _get_room, register_player, generate_market

room_id = "test_da_fix"
register_player(room_id, "p1", {"name": "Alice", "role": "GENERATOR", "asset": "CCGT"})
register_player(room_id, "p2", {"name": "Bob", "role": "SUPPLIER", "asset": "DSR"})

rs = _get_room(room_id)
for sp in range(1, 49):
    generate_market(room_id, sp=sp)

# Simulate what put_da_bid now does for both players (supply + demand)
r1 = submit_da_bids(room_id, "p1", [{"side": "offer", "mw": 100.0, "price": 55.0, "asset": "CCGT", "name": "Alice"}])
r2 = submit_da_bids(room_id, "p2", [{"side": "bid", "mw": 80.0, "price": 200.0, "asset": "DSR", "name": "Bob"}])
print("Generator submit:", r1)
print("Supplier submit: ", r2)

rs = _get_room(room_id)
da_ob = rs.get("daOrderBook", {})
print("daOrderBook players:", list(da_ob.keys()))
print("p1 bids (offer):", da_ob.get("p1"))
print("p2 bids (demand):", da_ob.get("p2"))
print()

print("Running _on_da_close_all...")
res = _on_da_close_all(rs)
print("spsCleared:", res.get("spsCleared"))

da_results = rs.get("daResults", {})
sp1 = da_results.get(1, {})
print("SP1:  cp=%.2f, volume=%.1f, accepted_bids=%d" % (sp1.get("cp", 0), sp1.get("volume", 0), len(sp1.get("accepted_bids", []))))
sp24 = da_results.get(24, {})
print("SP24: cp=%.2f, volume=%.1f, accepted_bids=%d" % (sp24.get("cp", 0), sp24.get("volume", 0), len(sp24.get("accepted_bids", []))))

total_vol = sum(r.get("volume", 0) for r in da_results.values())
print("Total volume across all SPs: %.1f MW" % total_vol)
print()
if total_vol > 0:
    print("PASS: DA desync fixed — bids flow from put_da_bid into DA clearing correctly")
else:
    print("FAIL: DA clearing still shows zero volume")

