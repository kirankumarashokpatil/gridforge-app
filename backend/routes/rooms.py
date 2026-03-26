"""
Room CRUD endpoints — create, get meta, update meta, delete.
"""

from typing import Optional, Dict, Any
from datetime import datetime

from fastapi import APIRouter, HTTPException

from db import db
from ws import manager
from engine import game_loop
# Import the singleton worker so delete_room can evict the in-memory lock
from room_worker import RoomWorker as _RoomWorkerType

router = APIRouter(prefix="/api/rooms", tags=["rooms"])

# Set by server.py at startup (same pattern as set_bus in routes/engine.py)
_worker: _RoomWorkerType | None = None


def set_worker(worker: _RoomWorkerType) -> None:
    global _worker
    _worker = worker


@router.post("/{room_id}")
async def create_or_get_room(room_id: str, scenario_id: Optional[str] = "NORMAL"):
    """Create or get room (idempotent - ON CONFLICT DO NOTHING prevents race condition 500s)"""
    try:
        rs = game_loop._get_room(room_id)
        seed = rs.get("rngSeed")
        await db.execute(
            "INSERT INTO rooms (room_id, scenario_id, phase_start_ts, rng_seed) VALUES ($1, $2, $3, $4) ON CONFLICT (room_id) DO NOTHING",
            room_id, scenario_id, int(datetime.now().timestamp() * 1000), seed
        )
        room = await db.query("SELECT * FROM rooms WHERE room_id = $1", room_id)
        return dict(room[0]) if room else {"error": "Room not found"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{room_id}/meta")
async def get_room_meta(room_id: str):
    """Get room metadata"""
    try:
        result = await db.query("SELECT * FROM rooms WHERE room_id = $1", room_id)
        if not result:
            raise HTTPException(status_code=404, detail="Room not found")
        return dict(result[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{room_id}")
async def delete_room(room_id: str):
    """Delete a room and all its data (used by E2E tests and admin tooling).

    Deletes child tables in FK-safe order before removing rooms, so there are
    no constraint violations when the same room_id is reused in a later test run.
    """
    try:
        # Child tables must be deleted before players/rooms (FK ordering)
        await db.execute("DELETE FROM event_log  WHERE room_id = $1", room_id)
        await db.execute("DELETE FROM events     WHERE room_id = $1", room_id)
        await db.execute("DELETE FROM contracts  WHERE room_id = $1", room_id)
        await db.execute("DELETE FROM id_bids    WHERE room_id = $1", room_id)
        await db.execute("DELETE FROM da_curves  WHERE room_id = $1", room_id)
        await db.execute("DELETE FROM da_bids    WHERE room_id = $1", room_id)
        await db.execute("DELETE FROM bm_bids    WHERE room_id = $1", room_id)
        await db.execute("DELETE FROM players    WHERE room_id = $1", room_id)
        await db.execute("DELETE FROM rooms      WHERE room_id = $1", room_id)

        # Evict in-memory game state and advance lock so the next run starts clean
        if _worker is not None:
            _worker.cleanup_room(room_id)
        else:
            # Fallback: evict only the game-loop state (lock stays but is harmless)
            game_loop._room_states.pop(room_id, None)

        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{room_id}/meta")
async def update_room_meta(room_id: str, data: Dict[str, Any]):
    """Update room metadata"""
    try:
        updates = []
        values = []
        idx = 1

        field_map = {
            "phase": "phase",
            "sp": "sp",
            "tickSpeed": "tick_speed",
            "paused": "paused",
            "scenarioId": "scenario_id",
            "roomState": "room_state",
            "phaseStartTs": "phase_start_ts",
        }

        for key, value in data.items():
            field = field_map.get(key)
            if field is None:
                continue
            if value is not None:
                updates.append(f"{field} = ${idx}")
                values.append(value)
                idx += 1

        if not updates:
            # Even if no DB columns to update, still sync game state below
            pass
        else:
            updates.append("last_active = CURRENT_TIMESTAMP")
            values.append(room_id)
            sql = f"UPDATE rooms SET {', '.join(updates)} WHERE room_id = ${idx}"
            await db.execute(sql, *values)

        # Sync config to in-memory game state (paused, advanceMode, simSpeed, tickSpeed, gameMode)
        config_keys = {"paused", "tickSpeed", "advanceMode", "simSpeedId", "simSpeedFactor", "gameMode"}
        game_config = {k: v for k, v in data.items() if k in config_keys}
        if game_config:
            game_loop.set_room_config(room_id, game_config)
            # Include resulting tickSpeed in broadcast so clients stay in sync
            rs = game_loop._get_room(room_id)
            data["tickSpeed"] = rs.get("tickSpeed")

        await manager.broadcast_to_room(room_id, {"type": "meta", "data": data})

        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
