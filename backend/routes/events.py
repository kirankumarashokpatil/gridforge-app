"""
Instructor event endpoints — trigger + event log retrieval.
"""

from typing import Dict, Any
from datetime import datetime

from fastapi import APIRouter, HTTPException

from db import db
from ws import manager

router = APIRouter(prefix="/api/rooms", tags=["events"])


@router.post("/{room_id}/events")
async def trigger_event(room_id: str, event: Dict[str, Any]):
    """Trigger instructor event"""
    try:
        await db.execute(
            "INSERT INTO events (room_id, event_type, ts) VALUES ($1, $2, $3)",
            room_id,
            event.get("eventId"),
            event.get("ts", int(datetime.now().timestamp() * 1000))
        )

        await manager.broadcast_to_room(room_id, {"type": "event", "data": event})
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{room_id}/events")
async def get_room_events(room_id: str, since: int = 0, limit: int = 500):
    """Return event_log entries for a room from sequence `since` onward.

    Used by:
    - Post-game replay viewer
    - Debug tooling (sequence all state changes)
    - Phase 2 cold-start recovery (replay to rebuild in-memory state)
    """
    try:
        import json
        limit = min(limit, 2000)
        rows = await db.query(
            "SELECT sequence, occurred_at, event_type, data "
            "FROM event_log WHERE room_id = $1 AND sequence > $2 "
            "ORDER BY sequence ASC LIMIT $3",
            room_id, since, limit,
        )
        events = [
            {
                "sequence": r["sequence"],
                "occurredAt": r["occurred_at"].isoformat() if r["occurred_at"] else None,
                "eventType": r["event_type"],
                "data": r["data"] if isinstance(r["data"], dict) else json.loads(r["data"]),
            }
            for r in rows
        ]
        return {"roomId": room_id, "events": events, "count": len(events)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
