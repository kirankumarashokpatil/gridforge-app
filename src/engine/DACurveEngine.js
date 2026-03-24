import { clamp } from '../shared/utils.js';

/**
 * DA Curve Submission Engine
 * 
 * Implements the EPEX/N2EX-style Day-Ahead curve submission:
 * - Players submit ONE curve covering all 48 Settlement Periods (SPs)
 * - Curve is defined as piecewise linear segments with:
 *   - SP range (e.g., SP1-SP12)
 *   - Pmin/Pmax (volume limits in MW)
 *   - Price1/Price2 (price boundaries in £/MWh)
 * 
 * Clearing algorithm:
 * 1. Extract bids for each SP independently
 * 2. Build supply/demand curves
 * 3. Find uniform clearing price where supply = demand
 * 4. All "in the money" bids get filled at clearing price
 */

// ─── DA CURVE SEGMENT STRUCTURE ───
// Segment: { spStart, spEnd, pmin, pmax, price1, price2 }
// Where price1 applies at pmin, price2 applies at pmax (linear slope between)

export const DEFAULT_DA_SEGMENTS = [
  { spStart: 1, spEnd: 12, pmin: 0, pmax: 50, price1: 40, price2: 60, name: "Night/Low Demand" },
  { spStart: 13, spEnd: 24, pmin: 0, pmax: 100, price1: 50, price2: 80, name: "Morning Ramp" },
  { spStart: 25, spEnd: 36, pmin: 0, pmax: 150, price1: 60, price2: 100, name: "Peak Hours" },
  { spStart: 37, spEnd: 48, pmin: 0, pmax: 80, price1: 45, price2: 70, name: "Evening/Return" }
];

// ─── VALIDATION ───

export function validateCurveSegment(segment) {
  const errors = [];
  
  if (segment.spStart < 1 || segment.spStart > 48) {
    errors.push(`SP start must be 1-48, got ${segment.spStart}`);
  }
  if (segment.spEnd < 1 || segment.spEnd > 48) {
    errors.push(`SP end must be 1-48, got ${segment.spEnd}`);
  }
  if (segment.spStart > segment.spEnd) {
    errors.push(`SP start (${segment.spStart}) must be <= SP end (${segment.spEnd})`);
  }
  if (segment.pmin < 0) {
    errors.push(`Pmin must be >= 0, got ${segment.pmin}`);
  }
  if (segment.pmax < 0) {
    errors.push(`Pmax must be >= 0, got ${segment.pmax}`);
  }
  if (segment.pmin > segment.pmax) {
    errors.push(`Pmin (${segment.pmin}) must be <= Pmax (${segment.pmax})`);
  }
  if (segment.price1 < 0 || segment.price1 > 1000) {
    errors.push(`Price1 must be 0-1000, got ${segment.price1}`);
  }
  if (segment.price2 < 0 || segment.price2 > 1000) {
    errors.push(`Price2 must be 0-1000, got ${segment.price2}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateFullCurve(segments) {
  const errors = [];
  
  // Check for overlapping segments
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const s1 = segments[i];
      const s2 = segments[j];
      // Check overlap: s1 covers [spStart, spEnd], s2 covers [spStart, spEnd]
      if (s1.spStart <= s2.spEnd && s2.spStart <= s1.spEnd) {
        errors.push(`Segments ${i+1} and ${j+1} overlap on SPs ${Math.max(s1.spStart, s2.spStart)}-${Math.min(s1.spEnd, s2.spEnd)}`);
      }
    }
    
    // Validate each segment
    const segValidation = validateCurveSegment(segments[i]);
    if (!segValidation.valid) {
      errors.push(...segValidation.errors.map(e => `Segment ${i+1}: ${e}`));
    }
  }
  
  // Check for gaps (optional - some strategies may want gaps)
  const coveredSPs = new Set();
  for (const seg of segments) {
    for (let sp = seg.spStart; sp <= seg.spEnd; sp++) {
      coveredSPs.add(sp);
    }
  }
  const uncovered = [];
  for (let sp = 1; sp <= 48; sp++) {
    if (!coveredSPs.has(sp)) {
      uncovered.push(sp);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    uncoveredSPs: uncovered,
    isComplete: uncovered.length === 0
  };
}

// ─── CURVE EVALUATION ───

/**
 * Get the volume a player is willing to trade at a given price for a specific SP.
 * This is a raw interpolation within the segment's price/volume envelope.
 * Returns 0 if no segment covers this SP.
 * 
 * For SELL side: price1 is minimum acceptable price.
 *   price < price1 → 0MW (out of money)
 *   price >= price2 → pmax (full capacity offered)
 *   price between → linear interpolation from pmin to pmax
 * 
 * For BUY side: price2 is maximum willingness to pay.
 *   price > price2 → 0MW (too expensive)
 *   price <= price1 → pmax (cheap, buy max)
 *   price between → linear interpolation from pmax down to pmin
 * 
 * @param {Array} segments - Player's curve segments
 * @param {number} sp - Settlement period (1-48)
 * @param {number} price - Market clearing price (£/MWh)
 * @param {string} side - 'sell' or 'buy' (affects out-of-money logic)
 * @returns {number} Volume in MW (always >= 0, unsigned)
 */
export function getVolumeAtPrice(segments, sp, price, side = 'sell') {
  const segment = segments.find(s => sp >= s.spStart && sp <= s.spEnd);
  if (!segment) return 0;

  const { pmin, pmax, price1, price2 } = segment;
  const priceRange = price2 - price1;

  if (side === 'sell') {
    // Seller: price1 = min acceptable price, price2 = price at which full pmax offered
    if (price < price1) return 0;           // Out of money
    if (price >= price2) return pmax;        // Full capacity
    if (Math.abs(priceRange) < 0.001) return price >= price1 ? pmax : 0;
    // Linear interpolation between pmin @ price1 and pmax @ price2
    const vol = pmin + (price - price1) * (pmax - pmin) / priceRange;
    return clamp(vol, pmin, pmax);
  } else {
    // Buyer: price1 = cheap price (buy max), price2 = max willingness (buy min)
    if (price > price2) return 0;            // Too expensive
    if (price <= price1) return pmax;        // Cheap, buy max
    if (Math.abs(priceRange) < 0.001) return price <= price1 ? pmax : 0;
    // Linear interpolation: high price → low volume
    const vol = pmax - (price - price1) * (pmax - pmin) / priceRange;
    return clamp(vol, pmin, pmax);
  }
}

// ─── MARKET CLEARING ───

/**
 * Clear a single SP using uniform price auction.
 * 
 * In real EPEX, supply meets demand at the clearing price. In our game, since
 * we may only have a few player sellers, we inject synthetic market demand
 * (based on forecast) so that clearing price and partial fills are realistic.
 * 
 * Result per player: awarded volume can be 0 (out of money), partial, or full Pmax.
 * Awarded volume is ALWAYS within [0, Pmax] — auction takes what it needs.
 * 
 * @param {number} sp - Settlement period (1-48)
 * @param {Array} playerCurves - Array of { playerId, segments, side: 'buy'|'sell'|'both' }
 * @param {Object} [marketCtx] - Optional { demandMW, forecastPrice } for synthetic demand
 * @returns {Object} { sp, clearingPrice, volumes: { playerId: signedMW }, pmax: { playerId: MW }, totalDemand, totalSupply }
 */
export function clearSingleSP(sp, playerCurves, marketCtx = null) {
  // Collect supply and demand curve entries
  const sellers = []; // { playerId, segments, curve entry }
  const buyers = [];

  for (const curve of playerCurves) {
    const segment = curve.segments.find(s => sp >= s.spStart && sp <= s.spEnd);
    if (!segment) continue;
    const side = curve.side || 'sell';
    if (side === 'sell') sellers.push({ ...curve, segment });
    else if (side === 'buy') buyers.push({ ...curve, segment });
    else {
      // 'both' — treat as seller (generator default)
      sellers.push({ ...curve, segment });
    }
  }

  // If no player supply at all, return zeros
  if (sellers.length === 0 && buyers.length === 0) {
    const volumes = {};
    const pmax = {};
    for (const c of playerCurves) {
      volumes[c.playerId] = 0;
      pmax[c.playerId] = 0;
    }
    return { sp, clearingPrice: 50, volumes, pmax, totalDemand: 0, totalSupply: 0 };
  }

  // Synthetic market demand: simulates rest-of-market so a small game still clears.
  // demandMW = total MW needed this SP. forecastPrice = expected clearing level.
  const synDemandMW = marketCtx?.demandMW ?? (300 + Math.sin(sp * 0.25) * 150); // ~150-450MW wave
  const synForecastPrice = marketCtx?.forecastPrice ?? (45 + Math.sin(sp * 0.2) * 20); // ~25-65

  // Build price sample grid (fine enough for realistic results)
  const priceSet = new Set();
  for (let p = 0; p <= 300; p += 2) priceSet.add(p);
  for (const s of sellers) { priceSet.add(s.segment.price1); priceSet.add(s.segment.price2); }
  for (const b of buyers) { priceSet.add(b.segment.price1); priceSet.add(b.segment.price2); }
  priceSet.add(synForecastPrice);
  const testPrices = [...priceSet].sort((a, b) => a - b);

  // At each test price, compute total supply and demand
  let clearingPrice = synForecastPrice;
  let bestDiff = Infinity;

  for (const price of testPrices) {
    // Player supply (sellers)
    let totalSupply = 0;
    for (const s of sellers) {
      totalSupply += getVolumeAtPrice([s.segment], sp, price, 'sell');
    }

    // Player demand (buyers)
    let totalDemand = 0;
    for (const b of buyers) {
      totalDemand += getVolumeAtPrice([b.segment], sp, price, 'buy');
    }

    // Synthetic demand: elastic around forecastPrice
    // At low prices, demand is high (everyone wants cheap power)
    // At high prices, demand drops
    const synDemand = synDemandMW * Math.max(0, 1 - (price - synForecastPrice) / 100);
    totalDemand += Math.max(0, synDemand);

    const diff = Math.abs(totalSupply - totalDemand);
    if (diff < bestDiff) {
      bestDiff = diff;
      clearingPrice = price;
    }
  }

  // Calculate awarded volumes at clearing price
  // Supply side: each seller gets their curve volume at the clearing price
  // But total supply may exceed demand → pro-rata curtailment
  const volumes = {};
  const pmaxMap = {};
  let rawTotalSupply = 0;
  const sellerVols = {};

  for (const s of sellers) {
    const vol = getVolumeAtPrice([s.segment], sp, clearingPrice, 'sell');
    sellerVols[s.playerId] = vol;
    rawTotalSupply += vol;
    pmaxMap[s.playerId] = s.segment.pmax;
  }

  // Buyer side
  let rawTotalDemand = 0;
  const buyerVols = {};
  for (const b of buyers) {
    const vol = getVolumeAtPrice([b.segment], sp, clearingPrice, 'buy');
    buyerVols[b.playerId] = vol;
    rawTotalDemand += vol;
    pmaxMap[b.playerId] = b.segment.pmax;
  }

  // Synthetic demand at clearing price
  const synDemandAtClear = Math.max(0, synDemandMW * Math.max(0, 1 - (clearingPrice - synForecastPrice) / 100));
  const totalDemandAtClear = rawTotalDemand + synDemandAtClear;

  // Pro-rata supply curtailment if supply > demand
  const supplyRatio = rawTotalSupply > 0 && rawTotalSupply > totalDemandAtClear
    ? totalDemandAtClear / rawTotalSupply
    : 1;

  // Assign final volumes
  for (const c of playerCurves) {
    const segment = c.segments.find(s => sp >= s.spStart && sp <= s.spEnd);
    if (!pmaxMap[c.playerId]) pmaxMap[c.playerId] = segment?.pmax || 0;

    if (sellerVols[c.playerId] !== undefined) {
      // Seller: negative volume (they sell into the market)
      const awarded = Math.round(sellerVols[c.playerId] * supplyRatio * 100) / 100;
      volumes[c.playerId] = -awarded; // Negative = sell
    } else if (buyerVols[c.playerId] !== undefined) {
      // Buyer: positive volume
      volumes[c.playerId] = Math.round(buyerVols[c.playerId] * 100) / 100;
    } else {
      volumes[c.playerId] = 0;
    }
  }

  return {
    sp,
    clearingPrice: Math.round(clearingPrice * 100) / 100,
    volumes,
    pmax: pmaxMap,
    totalDemand: totalDemandAtClear,
    totalSupply: rawTotalSupply * supplyRatio
  };
}

/**
 * Clear full DA auction for all 48 SPs independently.
 * Returns per-SP clearing prices, per-player awarded volumes, and per-player Pmax
 * so the UI can show partial/full/zero status and remaining capacity.
 * 
 * @param {Array} playerCurves - Array of { playerId, segments, side }
 * @param {Array} [marketCtxArray] - Optional array of 48 { demandMW, forecastPrice }
 * @returns {Object} { prices[48], volumes: { pid: [48] }, pmax: { pid: [48] }, spDetails[48] }
 */
export function clearFullAuction(playerCurves, marketCtxArray = null) {
  const prices = new Array(48).fill(0);
  const volumes = {};
  const pmaxArrays = {};
  const spDetails = []; // Per-SP detail for UI table
  
  // Initialize arrays for all players
  for (const curve of playerCurves) {
    volumes[curve.playerId] = new Array(48).fill(0);
    pmaxArrays[curve.playerId] = new Array(48).fill(0);
  }
  
  // Clear each SP independently
  for (let sp = 1; sp <= 48; sp++) {
    const ctx = marketCtxArray ? marketCtxArray[sp - 1] : null;
    const result = clearSingleSP(sp, playerCurves, ctx);
    prices[sp - 1] = result.clearingPrice;
    
    for (const [playerId, vol] of Object.entries(result.volumes)) {
      if (volumes[playerId]) {
        volumes[playerId][sp - 1] = vol;
      }
    }
    for (const [playerId, pm] of Object.entries(result.pmax || {})) {
      if (pmaxArrays[playerId]) {
        pmaxArrays[playerId][sp - 1] = pm;
      }
    }

    spDetails.push({
      sp,
      clearingPrice: result.clearingPrice,
      totalDemand: result.totalDemand,
      totalSupply: result.totalSupply
    });
  }
  
  return {
    prices,
    volumes,
    pmax: pmaxArrays,
    spDetails,
    // Bug fix: was dividing by 2 assuming equal buyer+seller volumes, but one-sided markets
    // (synthetic demand fills the other side) only have seller volumes — /2 halved the total incorrectly.
    totalTradedMW: Math.max(
      ...Object.values(volumes).map(vols => vols.reduce((s, v) => s + Math.max(0, -v), 0)) // max seller volume across any player
    ) || Object.values(volumes).flat().reduce((sum, v) => sum + Math.abs(v), 0) / 2
  };
}

// ─── PREVIEW HELPERS ───

/**
 * Generate preview of expected revenue for a curve given forecast prices
 * @param {Array} segments - Player's curve segments
 * @param {Array} forecastPrices - Array of 48 forecast prices
 * @returns {Object} Revenue preview by SP and total
 */
export function previewCurveRevenue(segments, forecastPrices) {
  const spRevenues = [];
  let totalRevenue = 0;
  
  for (let sp = 1; sp <= 48; sp++) {
    const price = forecastPrices[sp - 1] || 50;
    const volume = getVolumeAtPrice(segments, sp, price);
    const revenue = volume * price * 0.5; // 0.5 hours per SP
    
    spRevenues.push({
      sp,
      price,
      volume,
      revenue
    });
    
    totalRevenue += revenue;
  }
  
  return {
    spRevenues,
    totalRevenue,
    totalVolume: spRevenues.reduce((sum, r) => sum + Math.abs(r.volume), 0)
  };
}

// ─── SEGMENT EDITING HELPERS ───

export function createSegment(spStart = 1, spEnd = 48, pmin = 0, pmax = 50, price1 = 40, price2 = 60, name = "New Segment") {
  return {
    id: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    spStart: clamp(spStart, 1, 48),
    spEnd: clamp(spEnd, 1, 48),
    pmin: Math.max(0, pmin),
    pmax: Math.max(0, pmax),
    price1: clamp(price1, 0, 1000),
    price2: clamp(price2, 0, 1000),
    name
  };
}

export function updateSegment(segments, segmentId, updates) {
  return segments.map(s => 
    s.id === segmentId ? { ...s, ...updates } : s
  );
}

export function deleteSegment(segments, segmentId) {
  return segments.filter(s => s.id !== segmentId);
}

export function addSegment(segments, newSegment) {
  return [...segments, newSegment];
}
