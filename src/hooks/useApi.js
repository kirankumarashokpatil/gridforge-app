import { useState, useEffect, useRef, useCallback } from 'react';

const DEFAULT_API_BASE = `${window.location.protocol}//${window.location.hostname}:8000`;
const API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, '');
const WS_BASE = (import.meta.env.VITE_WS_BASE_URL || API_BASE.replace(/^http/, 'ws')).replace(/\/$/, '');

// Simple fetch wrapper
async function api(method, endpoint, body = null) {
  const url = `${API_BASE}${endpoint}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);
  
  const res = await fetch(url, options);
  if (!res.ok) {
    let detail = '';
    try {
      const payload = await res.json();
      detail = payload?.detail || payload?.error || '';
    } catch {
      // ignore json parse errors and fall back to status only
    }
    throw new Error(detail ? `API error: ${res.status} ${detail}` : `API error: ${res.status}`);
  }
  return res.json();
}

export function useApi() {
  const [ready, setReady] = useState(true); // Always ready with REST
  const wsRef = useRef(null);
  const roomRef = useRef(null);
  const listenersRef = useRef(new Map());

  // Connect to WebSocket for real-time updates
  const connect = useCallback((room) => {
    if (!room || wsRef.current?.readyState === WebSocket.OPEN) return;
    
    roomRef.current = room;
    const ws = new WebSocket(`${WS_BASE}/ws?room=${encodeURIComponent(room)}`);
    
    ws.onopen = () => {
      console.log('[WebSocket] Connected to room:', room);
    };
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const { type, data, sp, cycle, player_id } = message;

      // Notify all registered listeners for matching keys.
      // Subscription keys use format "room:ROOM:type" or "room:ROOM:type:qualifier"
      // Server broadcasts use {type: "players"} or {type: "bm_bid", sp: 5}
      // We match when the key's type segment matches the broadcast type,
      // and any qualifier (SP/cycle) also matches.
      listenersRef.current.forEach((callbacks, key) => {
        const parts = key.split(':');
        // Extract the type part and optional qualifier from the subscription key
        // Format: "room:ROOMID:type" or "room:ROOMID:type:qualifier"
        const keyType = parts.length >= 3 ? parts[2] : key;
        const keyQualifier = parts.length >= 4 ? parts[3] : null;

        // Map server broadcast types to subscription key types
        // Server sends: "players", "meta", "forecast", "bm_bid", "da_bid", "id_bid",
        //               "da_curve", "phase_change", "day_phase_change", "bm_advance",
        //               "bm_clear", "da_clear", "da_curve_clear", "id_clear",
        //               "settlement", "config", "event", "market"
        // App subscribes to: "players", "meta", "forecast", "sp_contracts",
        //                    "bm", "da", "id", "da_curves"
        const typeMap = {
          'bm_bid': 'bm', 'bm_clear': 'bm', 'bm_advance': 'meta',
          'da_bid': 'da', 'da_clear': 'da',
          'da_curve': 'da_curves', 'da_curve_clear': 'da_curves',
          'id_bid': 'id', 'id_clear': 'id',
          'phase_change': 'meta', 'day_phase_change': 'meta',
          'config': 'meta', 'settlement': 'sp_contracts',
          'server_settlement': 'server_settlement',
        };
        const mappedType = typeMap[type] || type;

        let matches = false;
        if (keyType === type || keyType === mappedType) {
          if (keyQualifier != null) {
            // Qualifier must match SP or cycle
            matches = (sp != null && String(keyQualifier) === String(sp))
                   || (cycle != null && String(keyQualifier) === String(cycle));
          } else {
            matches = true;
          }
        }

        if (matches) {
          for (const cb of callbacks) {
            try {
              cb(data);
            } catch (err) {
              console.error('[WebSocket] listener callback failed:', err);
            }
          }
        }
      });
    };
    
    ws.onclose = () => {
      console.log('[WebSocket] Disconnected');
      // Auto-reconnect after 3 seconds
      setTimeout(() => connect(room), 3000);
    };
    
    wsRef.current = ws;
  }, []);

  // Subscribe to updates
  const subscribe = useCallback((key, callback) => {
    if (!listenersRef.current.has(key)) {
      listenersRef.current.set(key, new Set());
    }
    const callbacks = listenersRef.current.get(key);
    callbacks.add(callback);

    // Return unsubscribe function for this specific callback
    return () => {
      const current = listenersRef.current.get(key);
      if (!current) return;
      current.delete(callback);
      if (current.size === 0) {
        listenersRef.current.delete(key);
      }
    };
  }, []);

  // API methods replacing Gun operations
  const apiRef = useRef({
    // Room operations
    createRoom: (roomId, scenarioId) => api('POST', `/api/rooms/${roomId}`, { scenarioId }),
    getRoomMeta: (roomId) => api('GET', `/api/rooms/${roomId}/meta`),
    updateRoom: (roomId, data) => api('PUT', `/api/rooms/${roomId}/meta`, data),
    
    // Player operations  
    getPlayers: (roomId) => api('GET', `/api/rooms/${roomId}/players`),
    putPlayer: (roomId, playerId, data) => api('POST', `/api/rooms/${roomId}/players/${playerId}`, data),
    putPlayerScores: (roomId, playerId, scores) => api('PUT', `/api/rooms/${roomId}/players/${playerId}/scores`, scores),
    
    // BM bids
    getBmBids: (roomId, sp) => api('GET', `/api/rooms/${roomId}/bm/${sp}`),
    putBmBid: (roomId, sp, playerId, bid) => api('POST', `/api/rooms/${roomId}/bm/${sp}/${playerId}`, bid),
    
    // DA bids
    getDaBids: (roomId, cycle) => api('GET', `/api/rooms/${roomId}/da/${cycle}`),
    putDaBid: (roomId, cycle, playerId, bid) => api('POST', `/api/rooms/${roomId}/da/${cycle}/${playerId}`, bid),
    
    // DA curves
    getDaCurves: (roomId) => api('GET', `/api/rooms/${roomId}/da_curves`),
    putDaCurve: (roomId, playerId, curve) => api('POST', `/api/rooms/${roomId}/da_curves/${playerId}`, curve),
    
    // ID bids
    getIdBids: (roomId, sp) => api('GET', `/api/rooms/${roomId}/id/${sp}`),
    putIdBid: (roomId, sp, playerId, bid) => api('POST', `/api/rooms/${roomId}/id/${sp}/${playerId}`, bid),
    
    // Contracts
    getContracts: (roomId, sp) => api('GET', `/api/rooms/${roomId}/contracts/${sp}`),
    putContracts: (roomId, sp, data) => api('POST', `/api/rooms/${roomId}/contracts/${sp}`, data),
    
    // Instructor events
    triggerEvent: (roomId, eventId) => api('POST', `/api/rooms/${roomId}/events`, { eventId, ts: Date.now() }),

    // ── Authoritative Engine Endpoints ──
    engineRegister: (roomId, data) => api('POST', `/api/rooms/${roomId}/engine/register`, data),
    engineGetState: (roomId) => api('GET', `/api/rooms/${roomId}/engine/state`),
    engineGenerateMarket: (roomId, data) => api('POST', `/api/rooms/${roomId}/engine/market`, data || {}),
    engineAdvancePhase: (roomId) => api('POST', `/api/rooms/${roomId}/engine/advance`),
    engineAdvanceDayPhase: (roomId, data) => api('POST', `/api/rooms/${roomId}/engine/advance-day`, data || {}),
    engineAdvanceBm: (roomId, data) => api('POST', `/api/rooms/${roomId}/engine/advance-bm`, data || {}),
    engineClearBM: (roomId) => api('POST', `/api/rooms/${roomId}/engine/clear-bm`),
    engineClearDA: (roomId) => api('POST', `/api/rooms/${roomId}/engine/clear-da`),
    engineClearDACurves: (roomId) => api('POST', `/api/rooms/${roomId}/engine/clear-da-curves`),
    engineIdaBid: (roomId, round, data) => api('POST', `/api/rooms/${roomId}/engine/ida/${round}/bid`, data),
    engineClearIda: (roomId, round) => api('POST', `/api/rooms/${roomId}/engine/ida/${round}/clear`),
    engineIdaForecast: (roomId, round) => api('GET', `/api/rooms/${roomId}/engine/ida/${round}/forecast`),
    engineIdSubmit: (roomId, data) => api('POST', `/api/rooms/${roomId}/engine/id/submit`, data),
    engineIdClear: (roomId) => api('POST', `/api/rooms/${roomId}/engine/id/clear`),
    engineSettle: (roomId) => api('POST', `/api/rooms/${roomId}/engine/settle`),
    engineGetForecasts: (roomId) => api('GET', `/api/rooms/${roomId}/engine/forecasts`),
    enginePublishForecast: (roomId, data) => api('POST', `/api/rooms/${roomId}/engine/forecast/publish`, data || {}),
    engineSetConfig: (roomId, config) => api('POST', `/api/rooms/${roomId}/engine/config`, config),
    engineGetLeaderboard: (roomId) => api('GET', `/api/rooms/${roomId}/engine/leaderboard`),
    engineGetAchievements: (roomId, playerId) => api('GET', `/api/rooms/${roomId}/engine/achievements/${playerId}`),
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    api: apiRef.current,
    ready,
    connect,
    subscribe,
    room: roomRef.current,
  };
}

// Toast hook (unchanged from useGun.js)
export function useToasts() {
  const [toasts, setToasts] = useState([]);

  const add = useCallback(({ emoji, title, body, col }) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const toast = { id, emoji, title, body, col, exiting: false };
    setToasts(prev => [...prev, toast]);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 300);
    }, 4000);
    
    return id;
  }, []);

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, add, remove };
}
