import { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = process.env.VITE_API_URL || '';

// Simple fetch wrapper
async function api(method, endpoint, body = null) {
  const url = `${API_BASE}${endpoint}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);
  
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
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
    const ws = new WebSocket(`ws://${window.location.host}/ws?room=${room}`);
    
    ws.onopen = () => {
      console.log('[WebSocket] Connected to room:', room);
    };
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const { type, data, sp, cycle } = message;
      
      // Notify all registered listeners
      listenersRef.current.forEach((callback, key) => {
        if (key === type || key === `${type}_${sp}` || key === `${type}_${cycle}`) {
          callback(data);
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
    listenersRef.current.set(key, callback);
    
    // Return unsubscribe function
    return () => listenersRef.current.delete(key);
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
