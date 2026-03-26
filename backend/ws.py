"""
GridForge WebSocket Manager — connection pool, delta protocol, and event flush.

Advance guards are implemented in room_worker.py.
"""

import json
import asyncio
import os
import time
from collections import deque
from typing import Optional, Dict, Any, Set, List

from fastapi import WebSocket

from db import db

# Number of recent broadcasts kept per room for delta replay on reconnect
DELTA_BUFFER_SIZE = int(os.environ.get("DELTA_BUFFER_SIZE", 500))


class ConnectionManager:
    """Manage WebSocket connections per room with versioned delta protocol.

    Every broadcast is tagged with a monotonically increasing ``_v`` (version)
    per room and stored in a ring buffer.  Reconnecting clients send their
    ``lastVersion``; if the gap fits inside the buffer the server replays only
    the missed messages instead of a full state snapshot.
    """

    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self._room_versions: Dict[str, int] = {}
        self._room_deltas: Dict[str, deque] = {}

    # ── version helpers ─────────────────────────────────────────────────

    def _next_version(self, room_id: str) -> int:
        v = self._room_versions.get(room_id, 0) + 1
        self._room_versions[room_id] = v
        return v

    def get_room_version(self, room_id: str) -> int:
        return self._room_versions.get(room_id, 0)

    def get_delta_replay(self, room_id: str, since_version: int) -> Optional[List[dict]]:
        """Return broadcasts after *since_version*, or ``None`` if the gap
        exceeds the buffer (caller should fall back to a full snapshot)."""
        buf = self._room_deltas.get(room_id)
        if not buf:
            return None
        oldest_v = buf[0].get("_v", 0)
        if since_version < oldest_v:
            return None  # gap too large
        return [msg for msg in buf if msg.get("_v", 0) > since_version]

    # ── connection lifecycle ────────────────────────────────────────────

    async def connect(self, room_id: str, websocket: WebSocket):
        """Add new connection"""
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = set()
        self.active_connections[room_id].add(websocket)
        print(f"Client connected to room {room_id} ({len(self.active_connections[room_id])} total)")

    def disconnect(self, room_id: str, websocket: WebSocket):
        """Remove connection"""
        if room_id in self.active_connections:
            self.active_connections[room_id].discard(websocket)
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]

    # ── broadcasting ────────────────────────────────────────────────────

    async def broadcast_to_room(self, room_id: str, message: dict):
        """Send versioned message to all clients in room and buffer it."""
        v = self._next_version(room_id)
        message["_v"] = v

        # Store in ring buffer for delta replay
        if room_id not in self._room_deltas:
            self._room_deltas[room_id] = deque(maxlen=DELTA_BUFFER_SIZE)
        self._room_deltas[room_id].append(message)

        if room_id not in self.active_connections:
            return

        disconnected = set()
        for connection in self.active_connections[room_id]:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.add(connection)

        for conn in disconnected:
            self.disconnect(room_id, conn)


manager = ConnectionManager()


# ── Event Sourcing helpers ──────────────────────────────────────────────────

async def flush_events(room_id: str, pending_events: list) -> None:
    """Batch-insert pending game events into event_log and clear the buffer.

    Called as a fire-and-forget asyncio task after every advance_day_phase /
    advance_bm call.  Uses ON CONFLICT DO NOTHING so retries are safe.
    Any DB error is logged but does not block the game.
    """
    if not pending_events:
        return
    try:
        rows = [
            (
                room_id,
                ev["sequence"],
                int(ev.get("occurred_at") or int(time.time() * 1000)),
                ev["event_type"],
                json.dumps(ev["data"]),
            )
            for ev in pending_events
        ]
        async with db.pool.acquire() as conn:
            await conn.executemany(
                "INSERT INTO event_log (room_id, sequence, occurred_at, event_type, data) "
                "VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, $5::jsonb) ON CONFLICT DO NOTHING",
                rows,
            )
    except Exception as exc:
        print(f"[event_log] flush error for room {room_id}: {exc}")
