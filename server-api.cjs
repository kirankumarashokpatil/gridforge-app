const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { query, initDb } = require('./src/db/db.cjs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT ? Number(process.env.PORT) : 80;
const DIST_DIR = path.join(__dirname, 'dist');

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

// ==================== ROOMS API ====================

// Create or get room
app.post('/api/rooms/:roomId', async (req, res) => {
  const { roomId } = req.params;
  const { scenarioId } = req.body;
  
  try {
    const existing = await query('SELECT * FROM rooms WHERE room_id = $1', [roomId]);
    
    if (existing.rows.length === 0) {
      await query(
        'INSERT INTO rooms (room_id, scenario_id, phase_start_ts) VALUES ($1, $2, $3)',
        [roomId, scenarioId || 'NORMAL', Date.now()]
      );
    }
    
    const room = await query('SELECT * FROM rooms WHERE room_id = $1', [roomId]);
    res.json(room.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get room meta
app.get('/api/rooms/:roomId/meta', async (req, res) => {
  try {
    const result = await query('SELECT * FROM rooms WHERE room_id = $1', [req.params.roomId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Room not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update room meta
app.put('/api/rooms/:roomId/meta', async (req, res) => {
  const { roomId } = req.params;
  const { phase, sp, tickSpeed, paused, scenarioId, room_state, phase_start_ts } = req.body;
  
  try {
    const updates = [];
    const values = [];
    let idx = 1;
    
    if (phase !== undefined) { updates.push(`phase = $${idx++}`); values.push(phase); }
    if (sp !== undefined) { updates.push(`sp = $${idx++}`); values.push(sp); }
    if (tickSpeed !== undefined) { updates.push(`tick_speed = $${idx++}`); values.push(tickSpeed); }
    if (paused !== undefined) { updates.push(`paused = $${idx++}`); values.push(paused); }
    if (scenarioId !== undefined) { updates.push(`scenario_id = $${idx++}`); values.push(scenarioId); }
    if (room_state !== undefined) { updates.push(`room_state = $${idx++}`); values.push(room_state); }
    if (phase_start_ts !== undefined) { updates.push(`phase_start_ts = $${idx++}`); values.push(phase_start_ts); }
    
    updates.push('last_active = CURRENT_TIMESTAMP');
    values.push(roomId);
    
    await query(`UPDATE rooms SET ${updates.join(', ')} WHERE room_id = $${idx}`, values);
    
    // Broadcast to WebSocket clients
    broadcast(roomId, { type: 'meta', data: req.body });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PLAYERS API ====================

// Get all players in room
app.get('/api/rooms/:roomId/players', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM players WHERE room_id = $1 ORDER BY created_at',
      [req.params.roomId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create/update player
app.post('/api/rooms/:roomId/players', async (req, res) => {
  const { roomId } = req.params;
  const { player_id, name, asset, role, custom_config, cash, da_cash, sof, status } = req.body;
  
  try {
    await query(
      `INSERT INTO players (player_id, room_id, name, asset, role, custom_config, cash, da_cash, sof, status, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (player_id) DO UPDATE SET
       name = EXCLUDED.name, asset = EXCLUDED.asset, role = EXCLUDED.role,
       custom_config = EXCLUDED.custom_config, cash = EXCLUDED.cash, da_cash = EXCLUDED.da_cash,
       sof = EXCLUDED.sof, status = EXCLUDED.status, last_seen = EXCLUDED.last_seen, updated_at = CURRENT_TIMESTAMP`,
      [player_id, roomId, name, asset, role, custom_config || {}, cash || 0, da_cash || 0, sof || 50, status || 'UNASSIGNED', Date.now()]
    );
    
    broadcast(roomId, { type: 'players', data: { player_id, name, asset, role, status } });
    res.json({ success: true, player_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update player scores
app.put('/api/rooms/:roomId/players/:playerId/scores', async (req, res) => {
  const { playerId } = req.params;
  const { role_score, system_score, overall_score } = req.body;
  
  try {
    await query(
      'UPDATE players SET role_score = $1, system_score = $2, overall_score = $3 WHERE player_id = $4',
      [role_score, system_score, overall_score, playerId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== BM BIDS API ====================

// Get BM bids for SP
app.get('/api/rooms/:roomId/bm/:sp', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM bm_bids WHERE room_id = $1 AND sp = $2',
      [req.params.roomId, req.params.sp]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit BM bid
app.post('/api/rooms/:roomId/bm/:sp', async (req, res) => {
  const { roomId, sp } = req.params;
  const { player_id, name, asset, mw, price, side, col, is_bot } = req.body;
  
  try {
    await query(
      `INSERT INTO bm_bids (room_id, sp, player_id, name, asset, mw, price, side, col, is_bot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (room_id, sp, player_id) DO UPDATE SET
       name = EXCLUDED.name, asset = EXCLUDED.asset, mw = EXCLUDED.mw,
       price = EXCLUDED.price, side = EXCLUDED.side, col = EXCLUDED.col, is_bot = EXCLUDED.is_bot`,
      [roomId, sp, player_id, name, asset, mw, price, side, col, is_bot || false]
    );
    
    broadcast(roomId, { type: 'bm_bid', sp, data: req.body });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== DA BIDS API ====================

app.get('/api/rooms/:roomId/da/:cycle', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM da_bids WHERE room_id = $1 AND cycle = $2',
      [req.params.roomId, req.params.cycle]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rooms/:roomId/da/:cycle', async (req, res) => {
  const { roomId, cycle } = req.params;
  const { player_id, name, asset, mw, price, side, col, is_bot } = req.body;
  
  try {
    await query(
      `INSERT INTO da_bids (room_id, cycle, player_id, name, asset, mw, price, side, col, is_bot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (room_id, cycle, player_id) DO UPDATE SET
       name = EXCLUDED.name, asset = EXCLUDED.asset, mw = EXCLUDED.mw,
       price = EXCLUDED.price, side = EXCLUDED.side, col = EXCLUDED.col, is_bot = EXCLUDED.is_bot`,
      [roomId, cycle, player_id, name, asset, mw, price, side, col, is_bot || false]
    );
    
    broadcast(roomId, { type: 'da_bid', cycle, data: req.body });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ID BIDS API ====================

app.get('/api/rooms/:roomId/id/:sp', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM id_bids WHERE room_id = $1 AND sp = $2',
      [req.params.roomId, req.params.sp]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rooms/:roomId/id/:sp', async (req, res) => {
  const { roomId, sp } = req.params;
  const { player_id, name, asset, mw, price, side, col, is_bot } = req.body;
  
  try {
    await query(
      `INSERT INTO id_bids (room_id, sp, player_id, name, asset, mw, price, side, col, is_bot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (room_id, sp, player_id) DO UPDATE SET
       name = EXCLUDED.name, asset = EXCLUDED.asset, mw = EXCLUDED.mw,
       price = EXCLUDED.price, side = EXCLUDED.side, col = EXCLUDED.col, is_bot = EXCLUDED.is_bot`,
      [roomId, sp, player_id, name, asset, mw, price, side, col, is_bot || false]
    );
    
    broadcast(roomId, { type: 'id_bid', sp, data: req.body });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CONTRACTS API ====================

app.get('/api/rooms/:roomId/contracts/:sp', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM contracts WHERE room_id = $1 AND sp = $2',
      [req.params.roomId, req.params.sp]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rooms/:roomId/contracts/:sp', async (req, res) => {
  const { roomId, sp } = req.params;
  const { player_id, settlement } = req.body;
  
  try {
    await query(
      `INSERT INTO contracts (room_id, sp, player_id, settlement)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_id, sp, player_id) DO UPDATE SET
       settlement = EXCLUDED.settlement`,
      [roomId, sp, player_id, settlement]
    );
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Static files
app.use(express.static(DIST_DIR));

app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// Start server
const server = app.listen(PORT, async () => {
  console.log(`GridForge API server listening on port ${PORT}`);
  await initDb();
});

// WebSocket for real-time sync
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Map(); // room -> Set of clients

function broadcast(roomId, message) {
  const roomClients = clients.get(roomId);
  if (roomClients) {
    const data = JSON.stringify(message);
    roomClients.forEach(client => {
      if (client.readyState === 1) { // OPEN
        client.send(data);
      }
    });
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const roomId = url.searchParams.get('room');
  
  if (!roomId) {
    ws.close();
    return;
  }
  
  if (!clients.has(roomId)) {
    clients.set(roomId, new Set());
  }
  clients.get(roomId).add(ws);
  
  ws.on('close', () => {
    clients.get(roomId)?.delete(ws);
  });
});

console.log('WebSocket server initialized on /ws?room=ROOM_ID');
