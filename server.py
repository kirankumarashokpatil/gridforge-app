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
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Path
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import asyncpg

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

# ==================== ROOMS ENDPOINTS ====================

@app.post("/api/rooms/{room_id}")
async def create_or_get_room(room_id: str, scenario_id: Optional[str] = "NORMAL"):
    """Create or get room"""
    try:
        # Check if exists
        existing = await db.query(
            "SELECT * FROM rooms WHERE room_id = $1",
            room_id
        )
        
        if not existing:
            await db.execute(
                "INSERT INTO rooms (room_id, scenario_id, phase_start_ts) VALUES ($1, $2, $3)",
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
            field = field_map.get(key, key)
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
        return [dict(row) for row in result]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rooms/{room_id}/players/{player_id}")
async def put_player(room_id: str, player_id: str, data: Dict[str, Any]):
    """Create or update player"""
    try:
        sql = '''
            INSERT INTO players 
            (player_id, room_id, name, asset, role, custom_config, cash, da_cash, sof, status, last_seen)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (player_id, room_id) DO UPDATE SET
            name = EXCLUDED.name,
            asset = EXCLUDED.asset,
            role = EXCLUDED.role,
            custom_config = EXCLUDED.custom_config,
            cash = EXCLUDED.cash,
            da_cash = EXCLUDED.da_cash,
            sof = EXCLUDED.sof,
            status = EXCLUDED.status,
            last_seen = EXCLUDED.last_seen,
            role_score = COALESCE(EXCLUDED.role_score, players.role_score),
            system_score = COALESCE(EXCLUDED.system_score, players.system_score),
            overall_score = COALESCE(EXCLUDED.overall_score, players.overall_score),
            updated_at = CURRENT_TIMESTAMP
        '''
        
        await db.execute(
            sql,
            player_id,
            room_id,
            data.get("name"),
            data.get("asset"),
            data.get("role"),
            json.dumps(data.get("custom_config", {})),
            data.get("cash", 0),
            data.get("da_cash", 0),
            data.get("sof", 50),
            data.get("status", "UNASSIGNED"),
            int(datetime.now().timestamp() * 1000)
        )
        
        await manager.broadcast_to_room(room_id, {
            "type": "players",
            "data": {"player_id": player_id, "name": data.get("name"), "status": data.get("status")}
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
