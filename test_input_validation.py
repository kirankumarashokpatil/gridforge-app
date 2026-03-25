"""
Tests for server-side input validation (security hardening).
Validates bid constraints, role/asset enum checks, and constants sync.
"""
import sys
import importlib

errors = []


def check(name, condition, detail=""):
    if condition:
        print(f"  PASS: {name}")
    else:
        msg = f"{name}: {detail}" if detail else name
        errors.append(msg)
        print(f"  FAIL: {msg}")


# ══════════════════════════════════════════════
print("TEST 1: Bid validation helper — valid bid accepted...")
# ══════════════════════════════════════════════
from routes.bids import _validate_bid, MAX_PRICE, MIN_PRICE, MAX_MW
from fastapi import HTTPException

try:
    _validate_bid({"mw": 50, "price": 60, "side": "offer"})
    check("Valid bid passes", True)
except HTTPException:
    check("Valid bid passes", False, "raised HTTPException")

# ══════════════════════════════════════════════
print("\nTEST 2: Bid validation — mw <= 0 rejected...")
# ══════════════════════════════════════════════
for bad_mw in [0, -1, -100]:
    try:
        _validate_bid({"mw": bad_mw, "price": 50, "side": "offer"})
        check(f"mw={bad_mw} rejected", False, "should have raised")
    except HTTPException as e:
        check(f"mw={bad_mw} rejected", e.status_code == 422)

# ══════════════════════════════════════════════
print("\nTEST 3: Bid validation — missing mw/price rejected...")
# ══════════════════════════════════════════════
try:
    _validate_bid({"price": 50, "side": "offer"})
    check("Missing mw rejected", False, "should have raised")
except HTTPException as e:
    check("Missing mw rejected", e.status_code == 422)

try:
    _validate_bid({"mw": 50, "side": "offer"})
    check("Missing price rejected", False, "should have raised")
except HTTPException as e:
    check("Missing price rejected", e.status_code == 422)

# ══════════════════════════════════════════════
print("\nTEST 4: Bid validation — extreme price rejected...")
# ══════════════════════════════════════════════
try:
    _validate_bid({"mw": 50, "price": MAX_PRICE + 1, "side": "offer"})
    check("Price above max rejected", False, "should have raised")
except HTTPException as e:
    check("Price above max rejected", e.status_code == 422)

try:
    _validate_bid({"mw": 50, "price": MIN_PRICE - 1, "side": "offer"})
    check("Price below min rejected", False, "should have raised")
except HTTPException as e:
    check("Price below min rejected", e.status_code == 422)

# Negative prices within range should pass (valid in GB markets)
try:
    _validate_bid({"mw": 50, "price": -100, "side": "offer"})
    check("Negative price in range passes", True)
except HTTPException:
    check("Negative price in range passes", False, "raised unexpectedly")

# ══════════════════════════════════════════════
print("\nTEST 5: Bid validation — invalid side rejected...")
# ══════════════════════════════════════════════
try:
    _validate_bid({"mw": 50, "price": 50, "side": "INVALID"})
    check("Invalid side rejected", False, "should have raised")
except HTTPException as e:
    check("Invalid side rejected", e.status_code == 422)

# ══════════════════════════════════════════════
print("\nTEST 6: Bid validation — extreme MW rejected...")
# ══════════════════════════════════════════════
try:
    _validate_bid({"mw": MAX_MW + 1, "price": 50, "side": "offer"})
    check("MW above max rejected", False, "should have raised")
except HTTPException as e:
    check("MW above max rejected", e.status_code == 422)

# ══════════════════════════════════════════════
print("\nTEST 7: Role enum validation — valid roles accepted...")
# ══════════════════════════════════════════════
from routes.players import _VALID_ROLES, _VALID_ASSETS
from engine.constants import ROLES, ASSETS

for role_id in ROLES:
    check(f"Role {role_id} in valid set", role_id in _VALID_ROLES)

check("UNASSIGNED in valid set", "UNASSIGNED" in _VALID_ROLES)

# ══════════════════════════════════════════════
print("\nTEST 8: Asset enum validation — valid assets accepted...")
# ══════════════════════════════════════════════
for asset_id in ASSETS:
    check(f"Asset {asset_id} in valid set", asset_id in _VALID_ASSETS)

# ══════════════════════════════════════════════
print("\nTEST 9: Frontend ↔ Backend GAME_MODES markets sync...")
# ══════════════════════════════════════════════
from engine.constants import GAME_MODES as BE_GAME_MODES

# Backend FULL mode must include ida1 and ida2
full_markets = BE_GAME_MODES["FULL"]["markets"]
check("Backend FULL has ida1", "ida1" in full_markets, str(full_markets))
check("Backend FULL has ida2", "ida2" in full_markets, str(full_markets))
check("Backend FULL has da", "da" in full_markets, str(full_markets))
check("Backend FULL has id", "id" in full_markets, str(full_markets))
check("Backend FULL has bm", "bm" in full_markets, str(full_markets))

# ══════════════════════════════════════════════
print("\nTEST 10: Delta buffer size is configurable...")
# ══════════════════════════════════════════════
from ws import DELTA_BUFFER_SIZE
check("DELTA_BUFFER_SIZE >= 500", DELTA_BUFFER_SIZE >= 500,
      f"got {DELTA_BUFFER_SIZE}")

# ══════════════════════════════════════════════
print()
if errors:
    print(f"FAILURES ({len(errors)}):")
    for e in errors:
        print(f"  ✗ {e}")
    if __name__ == "__main__": sys.exit(1)
else:
    print("=== ALL INPUT VALIDATION TESTS PASSED ===")
    if __name__ == "__main__": sys.exit(0)
