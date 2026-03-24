#!/usr/bin/env python3
"""Test backend player persistence"""
import urllib.request
import json

room = 'TEST_ROOM_004'

# First create the room
print("Creating room...")
data = json.dumps({'scenarioId': 'BAU'}).encode()
req = urllib.request.Request(
    f'http://localhost:8000/api/rooms/{room}',
    data=data,
    headers={'Content-Type': 'application/json'},
    method='POST'
)
try:
    resp = urllib.request.urlopen(req)
    print("✓ Room created:", resp.read().decode())
except Exception as e:
    print(f"✗ Create room failed: {e}")

# Now create a player with a name
print("\nCreating player with name...")
pid = 'test_p_004'
data = json.dumps({'name': 'MyTestName', 'role': 'NESO'}).encode()
req = urllib.request.Request(
    f'http://localhost:8000/api/rooms/{room}/players/{pid}',
    data=data,
    headers={'Content-Type': 'application/json'},
    method='POST'
)
try:
    resp = urllib.request.urlopen(req)
    print("✓ Player created:", resp.read().decode())
except Exception as e:
    print(f"✗ Create player failed: {type(e).__name__}: {e}")

# Query all players in the room
print("\nQuerying all players in room...")
try:
    resp = urllib.request.urlopen(f'http://localhost:8000/api/rooms/{room}/players')
    players = json.loads(resp.read().decode())
    for p in players:
        print(f"  - {p['player_id']}: name={p['name']}, role={p['role']}")
except Exception as e:
    print(f"✗ Query failed: {e}")
