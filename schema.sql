-- GridForge Database Schema (PostgreSQL)
-- Compatible with GunDB data model used in the application

-- =====================================================
-- 1. ROOMS (Game Sessions)
-- =====================================================
CREATE TABLE rooms (
    room_id VARCHAR(20) PRIMARY KEY,
    scenario_id VARCHAR(50) NOT NULL DEFAULT 'NORMAL',
    sp INTEGER NOT NULL DEFAULT 1 CHECK (sp >= 1 AND sp <= 48),
    phase VARCHAR(10) NOT NULL DEFAULT 'DA' CHECK (phase IN ('DA', 'ID', 'BM', 'SETTLED')),
    room_state VARCHAR(20) DEFAULT 'WAITING' CHECK (room_state IN ('WAITING', 'RUNNING', 'FINISHED')),
    phase_start_ts BIGINT NOT NULL,
    tick_speed INTEGER NOT NULL DEFAULT 60000,
    paused BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 2. PLAYERS
-- =====================================================
CREATE TABLE players (
    player_id VARCHAR(50) PRIMARY KEY,
    room_id VARCHAR(20) NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(30) NOT NULL,
    asset VARCHAR(30),
    status VARCHAR(20) DEFAULT 'UNASSIGNED' CHECK (status IN ('UNASSIGNED', 'READY', 'ACTIVE', 'DISCONNECTED')),
    custom_config JSONB,
    cash NUMERIC(12,2) NOT NULL DEFAULT 0,
    da_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
    sof NUMERIC(10,2) NOT NULL DEFAULT 50,
    last_seen BIGINT NOT NULL,
    role_score INTEGER CHECK (role_score >= 0 AND role_score <= 100),
    system_score INTEGER CHECK (system_score >= 0 AND system_score <= 100),
    overall_score INTEGER CHECK (overall_score >= 0 AND overall_score <= 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_players_room ON players(room_id);
CREATE INDEX idx_players_last_seen ON players(last_seen);

-- =====================================================
-- 3. BIDS / ORDERS
-- =====================================================

-- Day-Ahead bids (per auction cycle)
CREATE TABLE da_bids (
    room_id VARCHAR(20) NOT NULL,
    cycle INTEGER NOT NULL,
    player_id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    asset VARCHAR(30),
    mw NUMERIC(10,2) NOT NULL CHECK (mw > 0),
    price NUMERIC(10,2) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('offer', 'bid')),
    col VARCHAR(20),
    is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, cycle, player_id),
    FOREIGN KEY (room_id, player_id) REFERENCES players(room_id, player_id) ON DELETE CASCADE
);
CREATE INDEX idx_da_bids_room_cycle ON da_bids(room_id, cycle);

-- Intraday bids (per settlement period)
CREATE TABLE id_bids (
    room_id VARCHAR(20) NOT NULL,
    sp INTEGER NOT NULL CHECK (sp >= 1 AND sp <= 48),
    player_id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    asset VARCHAR(30),
    mw NUMERIC(10,2) NOT NULL CHECK (mw > 0),
    price NUMERIC(10,2) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
    col VARCHAR(20),
    is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, sp, player_id),
    FOREIGN KEY (room_id, player_id) REFERENCES players(room_id, player_id) ON DELETE CASCADE
);
CREATE INDEX idx_id_bids_room_sp ON id_bids(room_id, sp);

-- Balancing Mechanism bids (per settlement period)
CREATE TABLE bm_bids (
    room_id VARCHAR(20) NOT NULL,
    sp INTEGER NOT NULL CHECK (sp >= 1 AND sp <= 48),
    player_id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    asset VARCHAR(30),
    mw NUMERIC(10,2) NOT NULL CHECK (mw > 0),
    price NUMERIC(10,2) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('offer', 'bid')),
    col VARCHAR(20),
    is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, sp, player_id),
    FOREIGN KEY (room_id, player_id) REFERENCES players(room_id, player_id) ON DELETE CASCADE
);
CREATE INDEX idx_bm_bids_room_sp ON bm_bids(room_id, sp);

-- DA Curves (EPEX-style piecewise linear)
CREATE TABLE da_curves (
    room_id VARCHAR(20) NOT NULL,
    player_id VARCHAR(50) NOT NULL,
    segments JSONB NOT NULL,  -- Array of {spStart, spEnd, price1, price2, pmax}
    side VARCHAR(10) CHECK (side IN ('buy', 'sell', 'both')),
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, player_id),
    FOREIGN KEY (room_id, player_id) REFERENCES players(room_id, player_id) ON DELETE CASCADE
);

-- =====================================================
-- 4. CONTRACTS & SETTLEMENTS
-- =====================================================
CREATE TABLE contracts (
    room_id VARCHAR(20) NOT NULL,
    sp INTEGER NOT NULL CHECK (sp >= 1 AND sp <= 48),
    player_id VARCHAR(50) NOT NULL,
    da_mw NUMERIC(10,2),
    da_price NUMERIC(10,2),
    da_side VARCHAR(10) CHECK (da_side IN ('offer', 'bid')),
    id_mw NUMERIC(10,2),
    id_price NUMERIC(10,2),
    id_side VARCHAR(10) CHECK (id_side IN ('offer', 'bid')),
    bm_accepted JSONB,  -- { mw: number, price: number, rev: number }
    physical_mw NUMERIC(10,2),
    settlement JSONB,   -- { imbMw, imbCash, daCash, idCash, bmCash, operatingCost, totalCash }
    bsuos_charge NUMERIC(12,2),  -- BSUoS socialized charge
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, sp, player_id),
    FOREIGN KEY (room_id, player_id) REFERENCES players(room_id, player_id) ON DELETE CASCADE
);
CREATE INDEX idx_contracts_room_sp ON contracts(room_id, sp);
CREATE INDEX idx_contracts_player ON contracts(room_id, player_id);

-- =====================================================
-- 5. FORECASTS
-- =====================================================
CREATE TABLE forecasts (
    forecast_id VARCHAR(50) PRIMARY KEY,
    room_id VARCHAR(20) NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
    author VARCHAR(50) NOT NULL,
    mode VARCHAR(20) NOT NULL CHECK (mode IN ('manual', 'auto')),
    published_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    demand JSONB NOT NULL,      -- Array[48] of MW values
    wind JSONB NOT NULL,        -- Array[48] of capacity factors (0-1)
    solar JSONB NOT NULL,       -- Array[48] of capacity factors (0-1)
    confidence JSONB,           -- Array[48] of uncertainty values
    note TEXT
);
CREATE INDEX idx_forecasts_room ON forecasts(room_id);

-- =====================================================
-- 6. NESO NIV OVERRIDE
-- =====================================================
CREATE TABLE neso_niv_overrides (
    room_id VARCHAR(20) PRIMARY KEY REFERENCES rooms(room_id) ON DELETE CASCADE,
    mode VARCHAR(10) NOT NULL CHECK (mode IN ('auto', 'manual')),
    niv NUMERIC(10,2),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 7. INSTRUCTOR EVENTS
-- =====================================================
CREATE TABLE instructor_events (
    event_id SERIAL PRIMARY KEY,
    room_id VARCHAR(20) NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    triggered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_events_room ON instructor_events(room_id);

-- =====================================================
-- 8. SYSTEM STATE (Analytics)
-- =====================================================
CREATE TABLE system_states (
    room_id VARCHAR(20) NOT NULL,
    sp INTEGER NOT NULL CHECK (sp >= 1 AND sp <= 48),
    niv NUMERIC(10,2),
    abs_niv NUMERIC(10,2),
    balancing_cost NUMERIC(12,2),
    is_stress BOOLEAN,
    freq NUMERIC(6,3),
    sbp NUMERIC(10,2),
    ssp NUMERIC(10,2),
    blackout BOOLEAN DEFAULT FALSE,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, sp),
    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
);
CREATE INDEX idx_system_states_room ON system_states(room_id);

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Leaderboard view
CREATE VIEW player_leaderboard AS
SELECT 
    p.room_id,
    p.player_id,
    p.name,
    p.role,
    p.asset,
    p.cash + p.da_cash as total_profit,
    p.role_score,
    p.system_score,
    p.overall_score,
    RANK() OVER (PARTITION BY p.room_id ORDER BY p.overall_score DESC) as rank
FROM players p
WHERE p.overall_score IS NOT NULL;

-- Settlement summary per SP
CREATE VIEW settlement_summary AS
SELECT 
    c.room_id,
    c.sp,
    COUNT(DISTINCT c.player_id) as num_players,
    SUM((c.settlement->>'totalCash')::NUMERIC) as total_cashflow,
    SUM((c.settlement->>'imbCash')::NUMERIC) as total_imbalance,
    AVG((c.settlement->>'imbMw')::NUMERIC) as avg_imbalance_mw
FROM contracts c
GROUP BY c.room_id, c.sp;

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Update player timestamp trigger
CREATE OR REPLACE FUNCTION update_player_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_player_timestamp
    BEFORE UPDATE ON players
    FOR EACH ROW
    EXECUTE FUNCTION update_player_timestamp();

-- Cleanup old rooms (run periodically)
CREATE OR REPLACE FUNCTION cleanup_old_rooms(cutoff_hours INTEGER DEFAULT 24)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM rooms 
    WHERE last_active < NOW() - INTERVAL '1 hour' * cutoff_hours
    AND room_state != 'RUNNING';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
