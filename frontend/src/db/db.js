import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/gridforge',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log('Executed query', { text: text.substring(0, 50), duration, rows: result.rowCount });
  return result;
}

export async function getClient() {
  return pool.connect();
}

// Initialize database with schema
export async function initDb() {
  const client = await getClient();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id VARCHAR(20) PRIMARY KEY,
        scenario_id VARCHAR(50) NOT NULL DEFAULT 'NORMAL',
        sp INTEGER NOT NULL DEFAULT 1,
        phase VARCHAR(10) NOT NULL DEFAULT 'DA',
        room_state VARCHAR(20) DEFAULT 'WAITING',
        phase_start_ts BIGINT NOT NULL DEFAULT 0,
        tick_speed INTEGER NOT NULL DEFAULT 60000,
        paused BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS players (
        player_id VARCHAR(50) PRIMARY KEY,
        room_id VARCHAR(20) NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(30) NOT NULL,
        asset VARCHAR(30),
        status VARCHAR(20) DEFAULT 'UNASSIGNED',
        custom_config JSONB,
        cash NUMERIC(12,2) NOT NULL DEFAULT 0,
        da_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
        sof NUMERIC(10,2) NOT NULL DEFAULT 50,
        last_seen BIGINT NOT NULL DEFAULT 0,
        role_score INTEGER,
        system_score INTEGER,
        overall_score INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);

      CREATE TABLE IF NOT EXISTS bm_bids (
        room_id VARCHAR(20) NOT NULL,
        sp INTEGER NOT NULL,
        player_id VARCHAR(50) NOT NULL,
        name VARCHAR(100) NOT NULL,
        asset VARCHAR(30),
        mw NUMERIC(10,2) NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        side VARCHAR(10) NOT NULL,
        col VARCHAR(20),
        is_bot BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, sp, player_id)
      );

      CREATE INDEX IF NOT EXISTS idx_bm_bids_room_sp ON bm_bids(room_id, sp);

      CREATE TABLE IF NOT EXISTS da_bids (
        room_id VARCHAR(20) NOT NULL,
        cycle INTEGER NOT NULL,
        player_id VARCHAR(50) NOT NULL,
        name VARCHAR(100) NOT NULL,
        asset VARCHAR(30),
        mw NUMERIC(10,2) NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        side VARCHAR(10) NOT NULL,
        col VARCHAR(20),
        is_bot BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, cycle, player_id)
      );

      CREATE INDEX IF NOT EXISTS idx_da_bids_room_cycle ON da_bids(room_id, cycle);

      CREATE TABLE IF NOT EXISTS id_bids (
        room_id VARCHAR(20) NOT NULL,
        sp INTEGER NOT NULL,
        player_id VARCHAR(50) NOT NULL,
        name VARCHAR(100) NOT NULL,
        asset VARCHAR(30),
        mw NUMERIC(10,2) NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        side VARCHAR(10) NOT NULL,
        col VARCHAR(20),
        is_bot BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, sp, player_id)
      );

      CREATE INDEX IF NOT EXISTS idx_id_bids_room_sp ON id_bids(room_id, sp);

      CREATE TABLE IF NOT EXISTS da_curves (
        room_id VARCHAR(20) NOT NULL,
        player_id VARCHAR(50) NOT NULL,
        segments JSONB NOT NULL,
        side VARCHAR(10),
        submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, player_id)
      );

      CREATE TABLE IF NOT EXISTS contracts (
        room_id VARCHAR(20) NOT NULL,
        sp INTEGER NOT NULL,
        player_id VARCHAR(50) NOT NULL,
        da_mw NUMERIC(10,2),
        da_price NUMERIC(10,2),
        da_side VARCHAR(10),
        id_mw NUMERIC(10,2),
        id_price NUMERIC(10,2),
        id_side VARCHAR(10),
        bm_accepted JSONB,
        physical_mw NUMERIC(10,2),
        settlement JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, sp, player_id)
      );

      CREATE INDEX IF NOT EXISTS idx_contracts_room_sp ON contracts(room_id, sp);
    `);
    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}
