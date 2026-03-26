#!/usr/bin/env python3
"""
GridForge FastAPI Server — thin assembly.

All logic lives in dedicated modules:
  db.py          — Database class + schema
  ws.py          — WebSocket ConnectionManager + event flush + advance guards
  routes/rooms   — Room CRUD
  routes/players — Player CRUD + NESO election
  routes/bids    — BM / DA / DA-curve / ID bid endpoints
  routes/events  — Instructor events + event_log retrieval
  routes/engine  — Authoritative game-loop endpoints (advance, clear, settle, etc.)
"""

import os
import json
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from db import db
from ws import manager
from engine import game_loop
from room_worker import RoomWorker
from bus import create_bus

# Route modules
from routes.rooms import router as rooms_router
from routes.players import router as players_router
from routes.bids import router as bids_router
from routes.events import router as events_router
from routes.engine import router as engine_router, set_bus


# ==================== APP LIFECYCLE ====================

worker = RoomWorker()
bus = create_bus(worker=worker, broadcast_callback=manager.broadcast_to_room)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage app startup and shutdown"""
    await db.connect()
    await bus.start()
    set_bus(bus)
    yield
    await bus.stop()
    await db.disconnect()

app = FastAPI(
    title="GridForge API",
    description="REST API + WebSocket for energy market simulation",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS middleware — restrict origins in production via CORS_ORIGINS env var
_cors_origins = os.getenv("CORS_ORIGINS", "*")
_allowed_origins = [o.strip() for o in _cors_origins.split(",")] if _cors_origins != "*" else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== REGISTER ROUTERS ====================

app.include_router(rooms_router)
app.include_router(players_router)
app.include_router(bids_router)
app.include_router(events_router)
app.include_router(engine_router)


# ==================== WEBSOCKET ====================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint with delta protocol.

    Query params:
      room        — required room ID
      player      — required player ID (must exist in room)
      lastVersion — optional; if provided the server tries to replay only
                    missed broadcasts instead of a full state snapshot.
    """
    room_id = websocket.query_params.get("room")
    player_id = websocket.query_params.get("player")

    if not room_id:
        await websocket.close(code=1008, reason="Missing room parameter")
        return

    # Verify player belongs to this room (lightweight auth)
    if player_id:
        try:
            rows = await db.query(
                "SELECT 1 FROM players WHERE player_id = $1 AND room_id = $2",
                player_id, room_id,
            )
            if not rows:
                await websocket.close(code=1008, reason="Player not found in room")
                return
        except Exception:
            pass  # Allow connection on DB error — game still playable via REST

    await manager.connect(room_id, websocket)

    # If using RedisBus, subscribe this room's broadcast channel
    if hasattr(bus, 'subscribe_room'):
        await bus.subscribe_room(room_id)

    # Hydrate the client: delta replay when possible, full snapshot otherwise
    try:
        last_version_str = websocket.query_params.get("lastVersion")
        if last_version_str is not None:
            last_version = int(last_version_str)
            replay = manager.get_delta_replay(room_id, last_version)
            if replay is not None:
                await websocket.send_json({
                    "type": "delta_replay",
                    "data": replay,
                    "_v": manager.get_room_version(room_id),
                })
            else:
                # Gap too large — fall back to full snapshot
                snapshot = game_loop.get_room_state(room_id)
                await websocket.send_json({
                    "type": "state_snapshot",
                    "data": snapshot,
                    "_v": manager.get_room_version(room_id),
                })
        else:
            # First connect — always full snapshot
            snapshot = game_loop.get_room_state(room_id)
            await websocket.send_json({
                "type": "state_snapshot",
                "data": snapshot,
                "_v": manager.get_room_version(room_id),
            })
    except Exception:
        pass  # non-fatal — client will poll REST as fallback

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                continue  # silently drop malformed frames

            # Only relay whitelisted client-originated message types.
            # All game-state mutations flow through REST→bus→worker;
            # the WS receive path is kept for heartbeats / typing indicators only.
            msg_type = message.get("type")
            if msg_type in ("ping", "heartbeat", "typing"):
                await manager.broadcast_to_room(room_id, message)
    except WebSocketDisconnect:
        manager.disconnect(room_id, websocket)


# ==================== STATIC FILES ====================

DIST_DIR = os.path.join(os.path.dirname(__file__), "dist")

if os.path.exists(DIST_DIR):
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="static")

# ==================== MAIN ====================

if __name__ == "__main__":
    PORT = int(os.getenv("PORT", 80))
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=PORT,
        reload=os.getenv("ENV", "production") == "development",
    )
