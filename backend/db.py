"""
GridForge Database — PostgreSQL connection pool + schema init.
"""

import os
import asyncpg


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
                    rng_seed BIGINT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                ALTER TABLE rooms ADD COLUMN IF NOT EXISTS rng_seed BIGINT;
                
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
                    blocks JSONB,
                    side TEXT,
                    name TEXT,
                    asset TEXT,
                    col TEXT,
                    ts BIGINT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(room_id, player_id),
                    FOREIGN KEY (room_id) REFERENCES rooms(room_id)
                );

                ALTER TABLE da_curves ADD COLUMN IF NOT EXISTS blocks JSONB;
                
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

                -- Event sourcing: immutable append-only log of every game state change.
                -- sequence is monotonically increasing per room; used for ordered replay.
                CREATE TABLE IF NOT EXISTS event_log (
                    id BIGSERIAL PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    occurred_at TIMESTAMPTZ DEFAULT NOW(),
                    event_type TEXT NOT NULL,
                    data JSONB NOT NULL,
                    UNIQUE(room_id, sequence),
                    FOREIGN KEY (room_id) REFERENCES rooms(room_id)
                );
                CREATE INDEX IF NOT EXISTS idx_event_log_room ON event_log(room_id, sequence);
            ''')


db = Database()
