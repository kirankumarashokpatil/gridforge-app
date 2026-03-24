#!/usr/bin/env python3
"""
GridForge FastAPI Server
PostgreSQL-backed REST API with WebSocket real-time sync
"""

import os
import json
import asyncio
from typing import Optional, Dict, Any, Set
from datetime import datetime
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Path, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import asyncpg

# Server-authoritative engine
from engine import game_loop
from engine.constants import SP_DURATION_H
from engine.market_engine import market_for_sp, clear_bm, clear_da, compute_forecasts
from engine.da_curve_engine import clear_full_auction, validate_full_curve
from engine.settlement_engine import compute_imbalance_settlement
from engine.scoring_engine import compute_role_score, compute_system_score, compute_overall_score
from engine.leaderboard_engine import build_leaderboard, build_round_debrief
from engine.achievements import build_achievement_stats, check_achievements

# ==================== DATABASE ====================

class Database:
    """PostgreSQL connection pool manager"""
    
    def __init__(self):
        self.pool = None
    
    async def connect(self):
        """Initialize connection pool"""
        self.pool = await asyncpg.create_pool(
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', 'postgres'),
            database=os.getenv('DB_NAME', 'gridforge'),
            host=os.getenv('DB_HOST', 'localhost'),
            port=int(os.getenv('DB_PORT', 5432)),
            min_size=5,
            max_size=20,
        )
        print(f"Connected to PostgreSQL at {os.getenv('DB_HOST', 'localhost')}:{os.getenv('DB_PORT', 5432)}")
        await self.init_db()
    
    async def disconnect(self):
        """Close connection pool"""
        if self.pool:
            await self.pool.close()
    
    async def query(self, sql: str, *args):
        """Execute query and return results"""
        async with self.pool.acquire() as conn:
            return await conn.fetch(sql, *args)
    
    async def execute(self, sql: str, *args):
        """Execute statement without returning results"""
        async with self.pool.acquire() as conn:
            return await conn.execute(sql, *args)
    
    async def init_db(self):
        """Initialize database schema"""
        async with self.pool.acquire() as conn:
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS rooms (
                    room_id TEXT PRIMARY KEY,
                    scenario_id TEXT DEFAULT 'NORMAL',
                    phase TEXT DEFAULT 'DA',
                    sp INT DEFAULT 1,
                    tick_speed INT DEFAULT 1000,
                    paused BOOLEAN DEFAULT FALSE,
                    room_state TEXT DEFAULT 'WAITING',
                    phase_start_ts BIGINT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE TABLE IF NOT EXISTS players (
                    player_id TEXT NOT NULL,
                    room_id TEXT NOT NULL,
                    name TEXT,
                    asset TEXT,
                    role TEXT,
                    custom_config JSONB DEFAULT '{}',
                    cash FLOAT DEFAULT 0,
                    da_cash FLOAT DEFAULT 0,
                    sof FLOAT DEFAULT 50,
                    status TEXT DEFAULT 'UNASSIGNED',
                    role_score FLOAT DEFAULT 0,
                    system_score FLOAT DEFAULT 0,
                    overall_score FLOAT DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_seen BIGINT,
                    PRIMARY KEY (player_id, room_id),
                    FOREIGN KEY (room_id) REFERENCES rooms(room_id)
                );
                
                CREATE TABLE IF NOT EXISTS bm_bids (
                    bid_id SERIAL PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    sp INT NOT NULL,
                    player_id TEXT NOT NULL,
                    name TEXT,
                    asset TEXT,
                    mw FLOAT,
                    price FLOAT,
                    side TEXT,
                    col TEXT,
                    is_bot BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(room_id, sp, player_id),
                    FOREIGN KEY (room_id) REFERENCES rooms(room_id)
                );
                
                CREATE TABLE IF NOT EXISTS da_bids (
                    bid_id SERIAL PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    cycle INT NOT NULL,
                    player_id TEXT NOT NULL,
                    name TEXT,
                    asset TEXT,
                    mw FLOAT,
                    price FLOAT,
                    side TEXT,
                    col TEXT,
                    is_bot BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(room_id, cycle, player_id),
                    FOREIGN KEY (room_id) REFERENCES rooms(room_id)
                );
                
                CREATE TABLE IF NOT EXISTS da_curves (
                    curve_id SERIAL PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    player_id TEXT NOT NULL,
                    segments JSONB,
                    side TEXT,
                    name TEXT,
                    asset TEXT,
                    col TEXT,
                    ts BIGINT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(room_id, player_id),
                    FOREIGN KEY (room_id) REFERENCES rooms(room_id)
                );
                
                CREATE TABLE IF NOT EXISTS id_bids (
                    bid_id SERIAL PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    sp INT NOT NULL,
                    player_id TEXT NOT NULL,
                    name TEXT,
                    asset TEXT,
                    mw FLOAT,
                    price FLOAT,
                    side TEXT,
                    col TEXT,
                    is_bot BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(room_id, sp, player_id),
                    FOREIGN KEY (room_id) REFERENCES rooms(room_id)
                );
                
                CREATE TABLE IF NOT EXISTS contracts (
                    contract_id SERIAL PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    sp INT NOT NULL,
                    player_id TEXT NOT NULL,
                    settlement JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(room_id, sp, player_id),
                    FOREIGN KEY (room_id) REFERENCES rooms(room_id)
                );
                
                CREATE TABLE IF NOT EXISTS events (
                    event_id SERIAL PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    event_type TEXT,
                    ts BIGINT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (room_id) REFERENCES rooms(room_id)
                );
            ''')

db = Database()

# ==================== APP LIFECYCLE ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage app startup and shutdown"""
    await db.connect()
    yield
    await db.disconnect()

app = FastAPI(
    title="GridForge API",
    description="REST API + WebSocket for energy market simulation",
    version="2.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== WEBSOCKET MANAGER ====================

class ConnectionManager:
    """Manage WebSocket connections per room"""
    
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
    
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
    
    async def broadcast_to_room(self, room_id: str, message: dict):
        """Send message to all clients in room"""
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

# Serialize phase advances per room to prevent double-advance races under latency.
_room_advance_locks: Dict[str, asyncio.Lock] = {}


def _get_room_advance_lock(room_id: str) -> asyncio.Lock:
    lock = _room_advance_locks.get(room_id)
    if lock is None:
        lock = asyncio.Lock()
        _room_advance_locks[room_id] = lock
    return lock


def _validate_advance_precondition(rs: Dict[str, Any], data: Optional[Dict[str, Any]]) -> Optional[str]:
    """Reject stale client advances so retries cannot skip phases/SPs."""
    if not data:
        return None

    expected_phase = data.get("expectedDayPhase") or data.get("expectedPhase")
    expected_sp = data.get("expectedSp")
    expected_bm = data.get("expectedBmSubPhase")

    if expected_phase is not None and expected_phase != rs.get("dayPhase"):
        return f"stale phase (expected {expected_phase}, current {rs.get('dayPhase')})"
    if expected_sp is not None and int(expected_sp) != int(rs.get("currentSp") or 0):
        return f"stale sp (expected {expected_sp}, current {rs.get('currentSp')})"
    if expected_bm is not None and expected_bm != rs.get("bmSubPhase"):
        return f"stale bmSubPhase (expected {expected_bm}, current {rs.get('bmSubPhase')})"

    return None

# ==================== ROOMS ENDPOINTS ====================

@app.post("/api/rooms/{room_id}")
async def create_or_get_room(room_id: str, scenario_id: Optional[str] = "NORMAL"):
    """Create or get room (idempotent - ON CONFLICT DO NOTHING prevents race condition 500s)"""
    try:
        await db.execute(
            "INSERT INTO rooms (room_id, scenario_id, phase_start_ts) VALUES ($1, $2, $3) ON CONFLICT (room_id) DO NOTHING",
            room_id, scenario_id, int(datetime.now().timestamp() * 1000)
        )
        room = await db.query("SELECT * FROM rooms WHERE room_id = $1", room_id)
        return dict(room[0]) if room else {"error": "Room not found"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/rooms/{room_id}/meta")
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

@app.delete("/api/rooms/{room_id}")
async def delete_room(room_id: str):
    """Delete a room and all its players/bids (used by E2E tests to clean up stale data)"""
    try:
        await db.execute("DELETE FROM players WHERE room_id = $1", room_id)
        await db.execute("DELETE FROM rooms WHERE room_id = $1", room_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/rooms/{room_id}/meta")
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
                continue  # Skip unknown fields instead of using raw key as column
            if value is not None:
                updates.append(f"{field} = ${idx}")
                values.append(value)
                idx += 1
        
        if not updates:
            return {"success": True}
        
        updates.append("last_active = CURRENT_TIMESTAMP")
        values.append(room_id)
        
        sql = f"UPDATE rooms SET {', '.join(updates)} WHERE room_id = ${idx}"
        await db.execute(sql, *values)
        
        # Broadcast update
        await manager.broadcast_to_room(room_id, {"type": "meta", "data": data})
        
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== PLAYERS ENDPOINTS ====================

@app.get("/api/rooms/{room_id}/players")
async def get_players(room_id: str):
    """Get all players in room"""
    try:
        result = await db.query(
            "SELECT * FROM players WHERE room_id = $1 ORDER BY created_at",
            room_id
        )
        players = []
        for row in result:
            p = dict(row)
            p["id"] = p.get("player_id")  # Add 'id' alias for frontend compatibility
            players.append(p)
        return players
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rooms/{room_id}/players/{player_id}")
async def put_player(room_id: str, player_id: str, data: Dict[str, Any]):
    """Create or update player (atomic upsert — race-condition-free).
    
    Uses INSERT ON CONFLICT DO NOTHING to atomically ensure the row exists,
    then a separate UPDATE for the partial-field changes. Two concurrent calls
    for the same player will both succeed: the loser of the INSERT race does
    nothing on INSERT, then both apply their UPDATE (idempotent for same data).
    """
    try:
        now_ts = int(datetime.now().timestamp() * 1000)

        # Ensure room exists (auto-create with defaults to satisfy FK constraint)
        await db.execute(
            "INSERT INTO rooms (room_id, scenario_id, phase_start_ts) VALUES ($1, 'NORMAL', $2) ON CONFLICT (room_id) DO NOTHING",
            room_id, now_ts
        )

        # Step 1: Atomic upsert — inserts new row (with name if provided) OR updates
        # last_seen and name on conflict. The ON CONFLICT...DO UPDATE atomically
        # ensures the name is set on the very first successful write with no window
        # where the row exists with a null name.
        _name_val = data.get("name")
        if isinstance(_name_val, str) and not _name_val.strip():
            _name_val = None  # treat blank as NULL

        await db.execute(
            """
            INSERT INTO players (player_id, room_id, name, custom_config, cash, da_cash, sof, status, last_seen)
            VALUES ($1, $2, COALESCE($3, ''), '{}', 0, 0, 50, 'UNASSIGNED', $4)
            ON CONFLICT (player_id, room_id) DO UPDATE SET
                name = CASE
                    WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name != ''
                    THEN EXCLUDED.name
                    ELSE players.name
                END,
                last_seen = GREATEST(EXCLUDED.last_seen, players.last_seen)
            """,
            player_id, room_id, _name_val, now_ts
        )

        # Step 2: Partial UPDATE — only touch the fields actually provided in data
        field_map = {
            "name": "name",
            "asset": "asset",
            "role": "role",
            "custom_config": "custom_config",
            "cash": "cash",
            "da_cash": "da_cash",
            "sof": "sof",
            "status": "status",
            # lastSeen / last_seen intentionally excluded — we always set last_seen = now_ts below
            "ready": "status",  # ready flag maps to status column
            "assignedAssetKey": "asset",
        }

        updates = []
        values = []
        idx = 1

        for key, value in data.items():
            col = field_map.get(key)
            if col is None:
                continue  # skip unknown fields
            # Special handling for custom_config (serialize to JSON)
            if key == "custom_config":
                value = json.dumps(value or {})
            # Never overwrite name/role/asset with None or empty string
            if key in ("name", "role", "asset") and (value is None or (isinstance(value, str) and not value.strip())):
                continue
            # ready flag → status; don't double-set if 'status' is also in data
            if key == "ready":
                if "status" in data:
                    continue
                value = "READY" if value else "ASSIGNED"
            updates.append(f"{col} = ${idx}")
            values.append(value)
            idx += 1

        # Always refresh last_seen and updated_at
        updates.append(f"last_seen = ${idx}")
        values.append(now_ts)
        idx += 1
        updates.append("updated_at = CURRENT_TIMESTAMP")

        if updates:
            values.append(player_id)
            values.append(room_id)
            sql = f"UPDATE players SET {', '.join(updates)} WHERE player_id = ${idx} AND room_id = ${idx + 1}"
            await db.execute(sql, *values)

        # Fetch the full current player record to broadcast
        updated = await db.query(
            "SELECT * FROM players WHERE player_id = $1 AND room_id = $2",
            player_id, room_id
        )
        player_record = dict(updated[0]) if updated else {"player_id": player_id}
        # Add 'id' alias for frontend compatibility  
        player_record["id"] = player_record.get("player_id", player_id)
        # Preserve non-DB fields from request (preferences) for frontend display
        for extra_key in ("preferredRole", "preferredAssetKey", "ready", "assignedAssetKey"):
            if extra_key in data:
                player_record[extra_key] = data[extra_key]

        await manager.broadcast_to_room(room_id, {
            "type": "players",
            "data": {player_id: player_record}
        })
        
        return {"success": True, "player_id": player_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/rooms/{room_id}/players/{player_id}/scores")
async def update_player_scores(room_id: str, player_id: str, scores: Dict[str, float]):
    """Update player scores"""
    try:
        await db.execute(
            '''UPDATE players 
               SET role_score = $1, system_score = $2, overall_score = $3, updated_at = CURRENT_TIMESTAMP
               WHERE player_id = $4 AND room_id = $5''',
            scores.get("roleScore", 0),
            scores.get("systemScore", 0),
            scores.get("overallScore", 0),
            player_id,
            room_id
        )
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== BM BIDS ENDPOINTS ====================

@app.get("/api/rooms/{room_id}/bm/{sp}")
async def get_bm_bids(room_id: str, sp: int):
    """Get BM bids for SP"""
    try:
        result = await db.query(
            "SELECT * FROM bm_bids WHERE room_id = $1 AND sp = $2",
            room_id, sp
        )
        return [dict(row) for row in result]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rooms/{room_id}/bm/{sp}/{player_id}")
async def put_bm_bid(room_id: str, sp: int, player_id: str, bid: Dict[str, Any]):
    """Submit BM bid"""
    try:
        await db.execute(
            '''INSERT INTO bm_bids 
               (room_id, sp, player_id, name, asset, mw, price, side, col, is_bot)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (room_id, sp, player_id) DO UPDATE SET
               name = EXCLUDED.name,
               asset = EXCLUDED.asset,
               mw = EXCLUDED.mw,
               price = EXCLUDED.price,
               side = EXCLUDED.side,
               col = EXCLUDED.col,
               is_bot = EXCLUDED.is_bot''',
            room_id, sp, player_id,
            bid.get("name"),
            bid.get("asset"),
            bid.get("mw"),
            bid.get("price"),
            bid.get("side"),
            bid.get("col"),
            bid.get("isBot", False)
        )
        
        await manager.broadcast_to_room(room_id, {"type": "bm_bid", "sp": sp, "data": bid})
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== DA BIDS ENDPOINTS ====================

@app.get("/api/rooms/{room_id}/da/{cycle}")
async def get_da_bids(room_id: str, cycle: int):
    """Get DA bids for cycle"""
    try:
        result = await db.query(
            "SELECT * FROM da_bids WHERE room_id = $1 AND cycle = $2",
            room_id, cycle
        )
        return [dict(row) for row in result]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rooms/{room_id}/da/{cycle}/{player_id}")
async def put_da_bid(room_id: str, cycle: int, player_id: str, bid: Dict[str, Any]):
    """Submit DA bid"""
    try:
        await db.execute(
            '''INSERT INTO da_bids 
               (room_id, cycle, player_id, name, asset, mw, price, side, col, is_bot)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (room_id, cycle, player_id) DO UPDATE SET
               name = EXCLUDED.name,
               asset = EXCLUDED.asset,
               mw = EXCLUDED.mw,
               price = EXCLUDED.price,
               side = EXCLUDED.side,
               col = EXCLUDED.col,
               is_bot = EXCLUDED.is_bot''',
            room_id, cycle, player_id,
            bid.get("name"),
            bid.get("asset"),
            bid.get("mw"),
            bid.get("price"),
            bid.get("side"),
            bid.get("col"),
            bid.get("isBot", False)
        )
        
        await manager.broadcast_to_room(room_id, {"type": "da_bid", "cycle": cycle, "data": bid})
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== DA CURVES ENDPOINTS ====================

@app.post("/api/rooms/{room_id}/da_curves/{player_id}")
async def put_da_curve(room_id: str, player_id: str, curve: Dict[str, Any]):
    """Submit DA curve"""
    try:
        await db.execute(
            '''INSERT INTO da_curves 
               (room_id, player_id, segments, side, name, asset, col, ts)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (room_id, player_id) DO UPDATE SET
               segments = EXCLUDED.segments,
               side = EXCLUDED.side,
               name = EXCLUDED.name,
               asset = EXCLUDED.asset,
               col = EXCLUDED.col,
               ts = EXCLUDED.ts''',
            room_id, player_id,
            json.dumps(curve.get("segments", [])),
            curve.get("side"),
            curve.get("name"),
            curve.get("asset"),
            curve.get("col"),
            curve.get("ts", int(datetime.now().timestamp() * 1000))
        )
        
        await manager.broadcast_to_room(room_id, {"type": "da_curve", "player_id": player_id, "data": curve})
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== ID BIDS ENDPOINTS ====================

@app.get("/api/rooms/{room_id}/id/{sp}")
async def get_id_bids(room_id: str, sp: int):
    """Get ID bids for SP"""
    try:
        result = await db.query(
            "SELECT * FROM id_bids WHERE room_id = $1 AND sp = $2",
            room_id, sp
        )
        return [dict(row) for row in result]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rooms/{room_id}/id/{sp}/{player_id}")
async def put_id_bid(room_id: str, sp: int, player_id: str, bid: Dict[str, Any]):
    """Submit ID bid"""
    try:
        await db.execute(
            '''INSERT INTO id_bids 
               (room_id, sp, player_id, name, asset, mw, price, side, col, is_bot)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (room_id, sp, player_id) DO UPDATE SET
               name = EXCLUDED.name,
               asset = EXCLUDED.asset,
               mw = EXCLUDED.mw,
               price = EXCLUDED.price,
               side = EXCLUDED.side,
               col = EXCLUDED.col,
               is_bot = EXCLUDED.is_bot''',
            room_id, sp, player_id,
            bid.get("name"),
            bid.get("asset"),
            bid.get("mw"),
            bid.get("price"),
            bid.get("side"),
            bid.get("col"),
            bid.get("isBot", False)
        )
        
        await manager.broadcast_to_room(room_id, {"type": "id_bid", "sp": sp, "data": bid})
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== EVENTS ENDPOINTS ====================

@app.post("/api/rooms/{room_id}/events")
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

# ==================== AUTHORITATIVE ENGINE ENDPOINTS ====================

@app.post("/api/rooms/{room_id}/engine/register")
async def engine_register_player(room_id: str, data: Dict[str, Any]):
    """Register a player in the server-side game loop"""
    try:
        player_id = data.get("playerId")
        if not player_id:
            raise HTTPException(status_code=400, detail="playerId required")
        result = game_loop.register_player(room_id, player_id, data)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/rooms/{room_id}/engine/state")
async def engine_get_state(room_id: str):
    """Get the current authoritative room state"""
    try:
        return game_loop.get_room_state(room_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/market")
async def engine_generate_market(room_id: str, data: Optional[Dict[str, Any]] = None):
    """Generate / refresh market state for the current SP"""
    try:
        sp = data.get("sp") if data else None
        market = game_loop.generate_market(room_id, sp)
        await manager.broadcast_to_room(room_id, {"type": "market", "data": market})
        return market
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/advance")
async def engine_advance_phase(room_id: str):
    """Advance to the next game phase (day-level or BM SP-level)"""
    try:
        result = game_loop.advance_phase(room_id)

        # Persist phase/sp to DB
        rs = game_loop._get_room(room_id)
        await db.execute(
            "UPDATE rooms SET phase = $1, sp = $2, last_active = CURRENT_TIMESTAMP WHERE room_id = $3",
            rs["dayPhase"], rs["currentSp"], room_id
        )

        # Broadcast phase change + results
        await manager.broadcast_to_room(room_id, {
            "type": "phase_change",
            "data": result,
        })
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/advance-day")
async def engine_advance_day_phase(room_id: str, data: Optional[Dict[str, Any]] = None):
    """Advance to the next day-level phase (FORECAST→DA→IDA1→IDA2→ID→REALTIME)"""
    try:
        lock = _get_room_advance_lock(room_id)
        async with lock:
            rs = game_loop._get_room(room_id)
            precondition_err = _validate_advance_precondition(rs, data)
            if precondition_err:
                raise HTTPException(status_code=409, detail=precondition_err)

            result = game_loop.advance_day_phase(room_id)
            now_ts = int(datetime.now().timestamp() * 1000)
            rs = game_loop._get_room(room_id)
            db_sp = max(1, rs["currentSp"])  # engine uses 0 as sentinel for non-REALTIME; DB requires sp >= 1
            await db.execute(
                "UPDATE rooms SET phase = $1, sp = $2, phase_start_ts = $3, last_active = CURRENT_TIMESTAMP WHERE room_id = $4",
                rs["dayPhase"], db_sp, now_ts, room_id
            )
            # Ensure the broadcast includes fields the client expects
            broadcast_data = {
                **result,
                "dayPhase": rs["dayPhase"],
                "currentSp": rs["currentSp"],
                "bmSubPhase": rs["bmSubPhase"],
                "phaseStartTs": now_ts,
            }
            await manager.broadcast_to_room(room_id, {"type": "day_phase_change", "data": broadcast_data})
            return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/advance-bm")
async def engine_advance_bm(room_id: str, data: Optional[Dict[str, Any]] = None):
    """Advance within REALTIME phase (BM_OPEN→BM_CLOSE per SP)"""
    try:
        lock = _get_room_advance_lock(room_id)
        async with lock:
            rs = game_loop._get_room(room_id)
            precondition_err = _validate_advance_precondition(rs, data)
            if precondition_err:
                raise HTTPException(status_code=409, detail=precondition_err)

            result = game_loop.advance_bm(room_id)
            now_ts = int(datetime.now().timestamp() * 1000)
            rs = game_loop._get_room(room_id)
            await db.execute(
                "UPDATE rooms SET phase = $1, sp = $2, phase_start_ts = $3, last_active = CURRENT_TIMESTAMP WHERE room_id = $4",
                rs["dayPhase"], rs["currentSp"], now_ts, room_id
            )

            # Ensure the broadcast includes fields the client expects
            broadcast_data = {
                **result,
                "dayPhase": rs["dayPhase"],
                "currentSp": rs["currentSp"],
                "bmSubPhase": rs["bmSubPhase"],
                "phaseStartTs": now_ts,
            }
            await manager.broadcast_to_room(room_id, {"type": "bm_advance", "data": broadcast_data})

            # Broadcast server settlement for client-side logging/validation
            # (client computes its own authoritative cash and persists via putPlayer)
            settlement = result.get("settlement")
            if settlement:
                await manager.broadcast_to_room(room_id, {
                    "type": "server_settlement",
                    "sp": result.get("sp"),
                    "data": settlement,
                })

            return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/clear-bm")
async def engine_clear_bm(room_id: str):
    """Run BM clearing on current SP bids using server engine"""
    try:
        rs = game_loop._get_room(room_id)
        sp = rs["currentSp"] or 1
        market = rs["markets"].get(sp)
        if not market:
            game_loop.generate_all_markets(room_id)
            market = rs["markets"].get(sp, {})

        # Collect bids from DB
        bids_rows = await db.query(
            "SELECT * FROM bm_bids WHERE room_id = $1 AND sp = $2",
            room_id, sp
        )
        bids = [dict(row) for row in bids_rows]
        actual = market.get("actual", {})

        bm_result = clear_bm(bids, actual)

        # Persist accepted bids & update player cash
        for accepted in bm_result.get("accepted", []):
            pid = accepted.get("player_id")
            if pid:
                revenue = accepted.get("revenue", 0)
                await db.execute(
                    "UPDATE players SET cash = cash + $1, updated_at = CURRENT_TIMESTAMP WHERE player_id = $2 AND room_id = $3",
                    revenue, pid, room_id
                )

        await manager.broadcast_to_room(room_id, {"type": "bm_clear", "data": bm_result})
        return bm_result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/clear-da")
async def engine_clear_da(room_id: str):
    """Run DA clearing on all 48 SPs using server engine"""
    try:
        rs = game_loop._get_room(room_id)
        if not rs["markets"]:
            game_loop.generate_all_markets(room_id)

        # Use the day-level DA close (clears all SPs at once)
        da_result = game_loop._on_da_close_all(rs)

        # Persist DA revenue per player
        all_results = da_result.get("daResults", {})
        for sp_key, sp_result in all_results.items():
            for accepted in sp_result.get("accepted_bids", []):
                pid = accepted.get("id") or accepted.get("player_id")
                if pid:
                    revenue = accepted.get("revenue", 0)
                    await db.execute(
                        "UPDATE players SET da_cash = da_cash + $1, cash = cash + $1, updated_at = CURRENT_TIMESTAMP WHERE player_id = $2 AND room_id = $3",
                        revenue, pid, room_id
                    )

        await manager.broadcast_to_room(room_id, {"type": "da_clear", "data": da_result})
        return da_result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/clear-da-curves")
async def engine_clear_da_curves(room_id: str):
    """Run full 48-SP DA curve auction clearing"""
    try:
        rs = game_loop._get_room(room_id)

        # Collect DA curves from DB
        curves_rows = await db.query(
            "SELECT * FROM da_curves WHERE room_id = $1",
            room_id
        )
        player_curves = []
        for row in curves_rows:
            row_dict = dict(row)
            segments = row_dict.get("segments")
            if isinstance(segments, str):
                segments = json.loads(segments)
            player_curves.append({
                "playerId": row_dict["player_id"],
                "segments": segments or [],
                "side": row_dict.get("side", "sell"),
            })

        # Build market context from forecast
        market_ctx_array = None
        if rs.get("publishedForecast"):
            pf = rs["publishedForecast"]
            demand = pf.get("demand", [0] * 48)
            market_ctx_array = [
                {"demandMW": demand[i] if i < len(demand) else 300, "forecastPrice": 50}
                for i in range(48)
            ]

        result = clear_full_auction(player_curves, market_ctx_array)

        # Persist per-player DA revenues (sellers earn, buyers pay)
        for pid, vols in result.get("volumes", {}).items():
            total_rev = sum(
                (abs(v) * result["prices"][i] * SP_DURATION_H) * (-1 if v >= 0 else 1)
                for i, v in enumerate(vols)
            )
            if total_rev != 0:
                await db.execute(
                    "UPDATE players SET da_cash = da_cash + $1, cash = cash + $1, updated_at = CURRENT_TIMESTAMP WHERE player_id = $2 AND room_id = $3",
                    total_rev, pid, room_id
                )

        await manager.broadcast_to_room(room_id, {"type": "da_curve_clear", "data": result})
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/ida/{ida_round}/bid")
async def engine_ida_bid(room_id: str, ida_round: str, request: Request):
    """Submit IDA bids for multiple SPs"""
    try:
        body = await request.json()
        player_id = body.get("playerId")
        bids = body.get("bids", [])
        # Support legacy single-bid format
        if not bids and body.get("bid"):
            bids = [body["bid"]]
        ida_round_upper = ida_round.upper()
        if ida_round_upper not in ("IDA1", "IDA2"):
            raise HTTPException(status_code=400, detail=f"Unknown IDA round: {ida_round}")
        result = game_loop.submit_ida_bids(room_id, ida_round_upper, player_id, bids)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/ida/{ida_round}/clear")
async def engine_ida_clear(room_id: str, ida_round: str):
    """Clear IDA1 or IDA2 auction for all 48 SPs"""
    try:
        ida_round_upper = ida_round.upper()
        if ida_round_upper not in ("IDA1", "IDA2"):
            raise HTTPException(status_code=400, detail=f"Unknown IDA round: {ida_round}")
        rs = game_loop._get_room(room_id)
        result = game_loop._on_ida_close_all(rs, ida_round_upper)
        await manager.broadcast_to_room(room_id, {"type": f"{ida_round.lower()}_clear", "data": result})
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/rooms/{room_id}/engine/ida/{ida_round}/forecast")
async def engine_ida_forecast(room_id: str, ida_round: str):
    """Get the updated IDA forecast for all SPs"""
    try:
        from engine.market_engine import ida_forecast as ida_fc
        from engine.constants import IDA_CONFIG
        ida_round_upper = ida_round.upper()
        cfg = IDA_CONFIG.get(ida_round_upper, {})
        err_reduction = cfg.get("forecastErrorReduction", 0.5)
        rs = game_loop._get_room(room_id)
        if not rs.get("markets"):
            raise HTTPException(status_code=400, detail="No markets generated yet")
        # Return updated forecast for each SP
        forecasts = {}
        for sp, market in rs["markets"].items():
            forecasts[sp] = ida_fc(market, err_reduction)
        return forecasts
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/id/submit")
async def engine_id_submit(room_id: str, request: Request):
    """Submit continuous ID orders for specific SPs"""
    try:
        body = await request.json()
        player_id = body.get("playerId")
        orders = body.get("orders", [])
        result = game_loop.submit_id_orders(room_id, player_id, orders)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/id/clear")
async def engine_id_clear(room_id: str):
    """Run one round of continuous ID order-book clearing (pay-as-bid)"""
    try:
        rs = game_loop._get_room(room_id)
        result = game_loop._on_id_close(rs)

        # Persist cash changes from ID trades
        for pid, cash_delta in (result.get("trades") or []):
            pass  # Trades are already applied to in-memory state
        # Broadcast trades to room
        await manager.broadcast_to_room(room_id, {"type": "id_clear", "data": result})
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/settle")
async def engine_settle(room_id: str):
    """Run settlement for the current SP"""
    try:
        result = game_loop.settle_current_sp(room_id)
        settlements = result.get("settlements", {})

        # Persist updated scores and cash to DB
        for pid, s in settlements.items():
            await db.execute(
                """UPDATE players 
                   SET cash = $1, role_score = $2, system_score = $3, overall_score = $4,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE player_id = $5 AND room_id = $6""",
                s.get("cash", 0),
                s.get("roleScore", 0),
                s.get("systemScore", 0),
                s.get("overallScore", 0),
                pid, room_id
            )

        await manager.broadcast_to_room(room_id, {"type": "settlement", "data": settlements})
        return settlements
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/rooms/{room_id}/engine/forecasts")
async def engine_get_forecasts(room_id: str):
    """Get forecasts for upcoming SPs"""
    try:
        rs = game_loop._get_room(room_id)
        forecasts = compute_forecasts(
            rs.get("currentSp", 0), rs["scenarioId"], rs.get("publishedForecast")
        )
        return {"forecasts": forecasts}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/forecast/publish")
async def engine_publish_forecast(room_id: str, data: Optional[Dict[str, Any]] = None):
    """Publish a new forecast (manual or auto-generated)"""
    try:
        result = game_loop.publish_forecast(room_id, data)
        await manager.broadcast_to_room(room_id, {"type": "forecast", "data": result})
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rooms/{room_id}/engine/config")
async def engine_set_config(room_id: str, config: Dict[str, Any]):
    """Update room configuration (scenario, game mode, tick speed, pause)"""
    try:
        result = game_loop.set_room_config(room_id, config)

        # Persist to DB
        if "scenarioId" in config:
            await db.execute(
                "UPDATE rooms SET scenario_id = $1 WHERE room_id = $2",
                config["scenarioId"], room_id
            )
        if "tickSpeed" in config:
            await db.execute(
                "UPDATE rooms SET tick_speed = $1 WHERE room_id = $2",
                config["tickSpeed"], room_id
            )
        if "paused" in config:
            await db.execute(
                "UPDATE rooms SET paused = $1 WHERE room_id = $2",
                config["paused"], room_id
            )

        await manager.broadcast_to_room(room_id, {"type": "config", "data": config})
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/rooms/{room_id}/engine/leaderboard")
async def engine_get_leaderboard(room_id: str):
    """Get computed leaderboard from server-side scores"""
    try:
        players_rows = await db.query(
            "SELECT * FROM players WHERE room_id = $1",
            room_id
        )
        players = [
            {
                "id": dict(row)["player_id"],
                "name": dict(row).get("name", ""),
                "role": dict(row).get("role", "GENERATOR"),
                "roleScore": dict(row).get("role_score", 0),
                "systemScore": dict(row).get("system_score", 0),
                "overallScore": dict(row).get("overall_score", 0),
                "cash": dict(row).get("cash", 0),
            }
            for row in players_rows
        ]

        leaderboard = build_leaderboard(players)
        rs = game_loop._get_room(room_id)
        debrief = build_round_debrief(leaderboard, rs.get("systemState", {}))

        return {"leaderboard": leaderboard, "debrief": debrief}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/rooms/{room_id}/engine/achievements/{player_id}")
async def engine_get_achievements(room_id: str, player_id: str):
    """Check achievements for a player"""
    try:
        rs = game_loop._get_room(room_id)
        ps = rs.get("playerStates", {}).get(player_id, {})

        stats = build_achievement_stats({
            "spHistory": ps.get("spHistory", []),
            "cash": ps.get("cash", 0),
            "daCash": ps.get("daCash", 0),
            "assetKey": ps.get("asset", ""),
            "assetKind": "",
            "scenario": rs.get("scenarioId", "NORMAL"),
            "soc": ps.get("soc", 50),
            "freqBreachSec": 0,
        })

        earned = ps.get("achievements", [])
        newly_earned = check_achievements(stats, earned)

        return {"stats": stats, "newlyEarned": newly_earned, "alreadyEarned": earned}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== WEBSOCKET ====================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates"""
    room_id = websocket.query_params.get("room")
    
    if not room_id:
        await websocket.close(code=1000)
        return
    
    await manager.connect(room_id, websocket)
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
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
        reload=os.getenv("ENV", "production") == "development"
    )
