import { spTime } from '../shared/utils.js';

/**
 * ID Trading Engine
 * 
 * Implements Intraday trading with gate closures:
 * - DA results lock in initial positions for all 48 SPs of tomorrow
 * - ID trading allows individual SP adjustments until gate closure
 * - Gate closures happen progressively:
 *   SP1: 23:00 D (Day before)
 *   SP2: 23:30 D
 *   ...
 *   SP20: 08:30 D+1
 *   SP48: 22:30 D+1
 * - BM_GATE locks 1 hour before each SP's delivery
 * - Players trade SP-by-SP with per-SP buy/sell buttons
 */

// ─── GATE CLOSURE TIMING ───
// Each SP has a gate closure time (in hours from start of Day D)
// SP1 (00:00-00:30 D+1) closes at 23:00 D
// SP2 (00:30-01:00 D+1) closes at 23:30 D
// ...
// SP48 (23:30-00:00 D+2) closes at 22:30 D+1

export function getGateClosureHour(sp) {
  // SP1-20: closes on Day D (23:00, 23:30, ... 08:30)
  // SP21-48: closes on Day D+1 (09:00, 09:30, ... 22:30)
  if (sp >= 1 && sp <= 20) {
    // 23:00 for SP1, 23:30 for SP2, etc.
    return 23 + (sp - 1) * 0.5;
  } else {
    // SP21 = 09:00, SP22 = 09:30, ... SP48 = 22:30
    return 9 + (sp - 21) * 0.5;
  }
}

export function getBMGateClosureHour(sp) {
  // BM gate closes 1 hour before SP delivery
  // SP1 delivery at 00:00, BM gate closes at 23:00 previous day
  const spStartHour = ((sp - 1) * 0.5) % 24;
  let bmGateHour = spStartHour - 1;
  if (bmGateHour < 0) {
    bmGateHour += 24; // Previous day
  }
  
  // Adjust for day boundary
  if (sp <= 2) {
    return 23 + (sp - 1) * 0.5; // Day D
  } else {
    return bmGateHour; // Day D+1
  }
}

export function formatGateClosureTime(sp) {
  const hour = getGateClosureHour(sp);
  const day = sp <= 20 ? "TODAY" : "TOMORROW";
  const h = Math.floor(hour) % 24;
  const m = (hour % 1) * 60;
  return `${String(h).padStart(2, '0')}:${String(Math.round(m)).padStart(2, '0')} ${day}`;
}

// ─── GATE STATUS ───

/**
 * Check if a specific SP is open for ID trading
 * @param {number} sp - Settlement period (1-48)
 * @param {number} currentTimeHour - Current game time in hours from Day D start
 * @returns {boolean}
 */
export function isIDGateOpen(sp, currentTimeHour) {
  const gateHour = getGateClosureHour(sp);
  // If SP is on Day D+1 (sp > 20), adjust currentTimeHour to account for day rollover
  if (sp > 20) {
    // Current time needs to be Day D+1 hours (24+) to compare
    return currentTimeHour >= 24 && currentTimeHour < gateHour + 24;
  }
  return currentTimeHour < gateHour;
}

/**
 * Get time remaining until gate closure
 * @param {number} sp - Settlement period (1-48)
 * @param {number} currentTimeHour - Current game time in hours
 * @returns {number} Hours remaining (negative if closed)
 */
export function getTimeToGateClosure(sp, currentTimeHour) {
  const gateHour = getGateClosureHour(sp);
  if (sp > 20) {
    return (gateHour + 24) - currentTimeHour;
  }
  return gateHour - currentTimeHour;
}

/**
 * Get all open SPs for ID trading
 * @param {number} currentTimeHour - Current game time in hours
 * @returns {Array} Array of open SP numbers
 */
export function getOpenSPs(currentTimeHour) {
  const open = [];
  for (let sp = 1; sp <= 48; sp++) {
    if (isIDGateOpen(sp, currentTimeHour)) {
      open.push(sp);
    }
  }
  return open;
}

/**
 * Get recently closed SPs (for notifications)
 * @param {number} currentTimeHour - Current game time
 * @param {number} prevTimeHour - Previous game time
 * @returns {Array} SPs that just closed
 */
export function getNewlyClosedSPs(currentTimeHour, prevTimeHour) {
  const newlyClosed = [];
  for (let sp = 1; sp <= 48; sp++) {
    const wasOpen = isIDGateOpen(sp, prevTimeHour);
    const isClosed = !isIDGateOpen(sp, currentTimeHour);
    if (wasOpen && isClosed) {
      newlyClosed.push(sp);
    }
  }
  return newlyClosed;
}

// ─── ID TRADE STRUCTURE ───

export function createIDTrade(sp, playerId, side, volumeMW, price, timestamp) {
  return {
    id: `id_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    sp,
    playerId,
    side, // 'buy' or 'sell'
    volumeMW: Math.abs(volumeMW),
    price,
    timestamp,
    status: 'pending' // pending, confirmed, rejected
  };
}

// ─── POSITION TRACKING ───

/**
 * Calculate current position for each SP after DA + ID trades
 * @param {Array} daVolumes - Array of 48 DA volumes (positive=buy/accept, negative=sell/generate)
 * @param {Array} idTrades - Array of ID trade objects
 * @param {string} playerId - Player ID
 * @returns {Array} Array of 48 position objects
 */
export function calculatePositions(daVolumes, idTrades, playerId) {
  const positions = [];
  
  for (let sp = 1; sp <= 48; sp++) {
    const daVol = daVolumes[sp - 1] || 0;
    const spTrades = idTrades.filter(t => t.sp === sp && t.playerId === playerId && t.status === 'confirmed');
    
    const idBuyVol = spTrades
      .filter(t => t.side === 'buy')
      .reduce((sum, t) => sum + t.volumeMW, 0);
    const idSellVol = spTrades
      .filter(t => t.side === 'sell')
      .reduce((sum, t) => sum + t.volumeMW, 0);
    
    const netPosition = daVol + idBuyVol - idSellVol;
    
    positions.push({
      sp,
      daVolume: daVol,
      idBuyVolume: idBuyVol,
      idSellVolume: idSellVol,
      netPosition,
      trades: spTrades,
      isOpen: true // Will be updated by caller with current time
    });
  }
  
  return positions;
}

// ─── ID MARKET CLEARING ───

/**
 * Simple continuous matching for ID trades
 * Matches buy and sell orders at overlapping prices
 * @param {Array} buyOrders - Buy orders [{ playerId, volumeMW, price, sp }]
 * @param {Array} sellOrders - Sell orders [{ playerId, volumeMW, price, sp }]
 * @returns {Array} Matched trades [{ buyOrder, sellOrder, matchVolume, matchPrice }]
 */
export function matchIDOrders(buyOrders, sellOrders) {
  const matches = [];
  
  // Sort buys high price first, sells low price first
  const sortedBuys = [...buyOrders].sort((a, b) => b.price - a.price);
  const sortedSells = [...sellOrders].sort((a, b) => a.price - b.price);
  
  for (const buy of sortedBuys) {
    for (const sell of sortedSells) {
      // Match if buy price >= sell price
      if (buy.price >= sell.price && buy.volumeMW > 0 && sell.volumeMW > 0) {
        const matchVolume = Math.min(buy.volumeMW, sell.volumeMW);
        const matchPrice = (buy.price + sell.price) / 2; // Midpoint
        
        matches.push({
          sp: buy.sp,
          buyerId: buy.playerId,
          sellerId: sell.playerId,
          volumeMW: matchVolume,
          price: matchPrice
        });
        
        buy.volumeMW -= matchVolume;
        sell.volumeMW -= matchVolume;
      }
    }
  }
  
  return matches;
}

// ─── UI HELPERS ───

export function getGateStatusDisplay(sp, currentTimeHour) {
  const isOpen = isIDGateOpen(sp, currentTimeHour);
  const hoursRemaining = getTimeToGateClosure(sp, currentTimeHour);
  
  if (!isOpen) {
    return {
      status: 'closed',
      message: 'LOCKED - No more ID trades',
      color: '#f0455a',
      canTrade: false
    };
  }
  
  if (hoursRemaining <= 0.5) {
    return {
      status: 'urgent',
      message: `${Math.round(hoursRemaining * 60)}m left - URGENT`,
      color: '#f5b222',
      canTrade: true
    };
  }
  
  if (hoursRemaining <= 2) {
    return {
      status: 'warning',
      message: `${Math.round(hoursRemaining * 10) / 10}h left`,
      color: '#fb923c',
      canTrade: true
    };
  }
  
  return {
    status: 'open',
    message: `${Math.round(hoursRemaining * 10) / 10}h left`,
    color: '#1de98b',
    canTrade: true
  };
}

export function formatPosition(position) {
  if (position === 0) return { text: 'FLAT', color: '#64748b', emoji: '➖' };
  if (position > 0) return { text: `LONG ${position.toFixed(1)}MW`, color: '#38c0fc', emoji: '📈' };
  return { text: `SHORT ${Math.abs(position).toFixed(1)}MW`, color: '#f0455a', emoji: '📉' };
}

// ─── PHASE MANAGEMENT ───

export const PHASES = {
  FORECAST: 'FORECAST',   // Day-ahead forecast generation
  DA: 'DA',               // Day-ahead curve submission
  IDA1: 'IDA1',           // Intraday auction round 1
  IDA2: 'IDA2',           // Intraday auction round 2
  ID: 'ID',               // Continuous intraday trading (order-book pay-as-bid)
  REALTIME: 'REALTIME',   // Real-time BM phase (SP-by-SP)
  BM_OPEN: 'BM_OPEN',     // BM accepting bids for current SP
  BM_CLOSE: 'BM_CLOSE',   // BM cleared + settled for current SP
  RESULTS: 'RESULTS',     // End-of-day results & scoring
};

export const PHASE_DISPLAY_NAMES = {
  [PHASES.FORECAST]: 'Forecast',
  [PHASES.DA]: 'Day-Ahead Auction',
  [PHASES.IDA1]: 'Intraday Auction 1',
  [PHASES.IDA2]: 'Intraday Auction 2',
  [PHASES.ID]: 'Continuous Intraday',
  [PHASES.REALTIME]: 'Real-Time Delivery',
  [PHASES.BM_OPEN]: 'BM Open',
  [PHASES.BM_CLOSE]: 'BM Closed',
  [PHASES.RESULTS]: 'Settlement & Results',
};

export function getPhaseFromTime(currentTimeHour) {
  if (currentTimeHour < 0.5) return PHASES.FORECAST;
  if (currentTimeHour < 1.5) return PHASES.DA;
  if (currentTimeHour < 2.5) return PHASES.IDA1;
  if (currentTimeHour < 3.5) return PHASES.IDA2;
  if (currentTimeHour < 23) return PHASES.ID;
  if (currentTimeHour < 24) return PHASES.REALTIME;
  return PHASES.RESULTS;
}

// ─── DA AUCTION TIMING ───

// Real GB market: 09:20 hourly, 15:30 half-hourly
// Game: Simplified to single 15:30 submission
export const DA_AUCTION_TIMES = [9.33, 15.5]; // 09:20 and 15:30 in decimal hours

export function getNextDAAuction(currentTimeHour) {
  for (const time of DA_AUCTION_TIMES) {
    if (currentTimeHour < time) {
      return time;
    }
  }
  // Next day
  return DA_AUCTION_TIMES[0] + 24;
}

export function isDAAuctionOpen(currentTimeHour) {
  // Open from 08:00 until 09:20 (hourly) and 14:00 until 15:30 (half-hourly)
  const isHourlyWindow = currentTimeHour >= 8 && currentTimeHour < 9.33;
  const isHalfHourlyWindow = currentTimeHour >= 14 && currentTimeHour < 15.5;
  return isHourlyWindow || isHalfHourlyWindow;
}
