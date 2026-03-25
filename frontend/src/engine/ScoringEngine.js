// ─── SCORING ENGINE ───
// Pure-function scoring engine for role-specific + system-wide player evaluation.
// No React dependencies — importable from anywhere.

import { SCORING_CONFIG } from '../shared/constants.js';

// ─── Piecewise Linear Interpolation ───
// breakpoints: [[x0,y0],[x1,y1],...] sorted ascending by x
// Returns interpolated y for given x, clamped to edge values.
export function mapThreshold(value, breakpoints) {
    if (!breakpoints || breakpoints.length === 0) return 50;
    if (breakpoints.length === 1) return breakpoints[0][1];

    // Below first breakpoint
    if (value <= breakpoints[0][0]) return breakpoints[0][1];
    // Above last breakpoint
    if (value >= breakpoints[breakpoints.length - 1][0]) return breakpoints[breakpoints.length - 1][1];

    // Find bounding pair and interpolate
    for (let i = 0; i < breakpoints.length - 1; i++) {
        const [x0, y0] = breakpoints[i];
        const [x1, y1] = breakpoints[i + 1];
        if (value >= x0 && value <= x1) {
            if (x1 === x0) return y0;
            const t = (value - x0) / (x1 - x0);
            return y0 + t * (y1 - y0);
        }
    }
    return breakpoints[breakpoints.length - 1][1];
}

// Clamp utility
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ─── ROLE SCORE COMPUTATION ───
// Each role has a primary KPI (80% weight) and supporting KPIs (20% weight).
// Returns { roleScore: 0-100, primary: {name, value, score}, secondary: [{name, value, score}] }

export function computeRoleScore(role, stats) {
    const cfg = SCORING_CONFIG[role] || SCORING_CONFIG.GENERATOR;

    switch (role) {
        case 'TRADER': return traderRoleScore(stats, cfg);
        case 'GENERATOR': return generatorRoleScore(stats, cfg);
        case 'BESS': return bessRoleScore(stats, cfg);
        case 'SUPPLIER': return supplierRoleScore(stats, cfg);
        case 'DSR': return dsrRoleScore(stats, cfg);
        case 'NESO': return nesoRoleScore(stats, SCORING_CONFIG.NESO);
        case 'ELEXON': return elexonRoleScore(stats, SCORING_CONFIG.ELEXON);
        case 'INTERCONNECTOR': return interconnectorRoleScore(stats, cfg);
        default: return generatorRoleScore(stats, SCORING_CONFIG.GENERATOR);
    }
}

// ── Trader ──
// Primary: Risk-Adjusted Return = NetProfit / max(1, MaxDrawdown)
// Secondary: Margin events penalty (-10 per event)
function traderRoleScore(stats, cfg) {
    const rar = stats.netProfit / Math.max(1, stats.maxDrawdown || 1);
    const primaryScore = clamp(mapThreshold(rar, cfg.breakpoints), 0, 100);

    const marginEvtPenalty = Math.min(stats.marginEvents || 0, 10);
    const secondaryScore = clamp(100 - (cfg.marginPenalty || 10) * marginEvtPenalty, 0, 100);

    const pw = cfg.primaryWeight || 0.85;
    const roleScore = clamp(Math.round(pw * primaryScore + (1 - pw) * secondaryScore), 0, 100);

    return {
        roleScore,
        primary: { name: 'Risk-Adjusted Return', value: +rar.toFixed(2), score: Math.round(primaryScore) },
        secondary: [
            { name: 'Margin Events', value: stats.marginEvents || 0, score: Math.round(secondaryScore) }
        ]
    };
}

// ── Generator ──
// Primary: Profit per MW = NetProfit / CapacityMW
// Secondary: Imbalance cost per MWh (lower is better)
function generatorRoleScore(stats, cfg) {
    const profitPerMW = stats.capacityMW > 0 ? stats.netProfit / stats.capacityMW : 0;
    const primaryScore = clamp(mapThreshold(profitPerMW, cfg.breakpoints), 0, 100);

    // Imbalance cost: 0 → 100, reference ceiling → 0
    const imbRef = 50; // £50/MWh reference ceiling
    const imbCostPerMWh = stats.totalMWh > 0 ? Math.abs(stats.imbalanceCost || 0) / stats.totalMWh : 0;
    const secondaryScore = clamp(100 - (imbCostPerMWh / imbRef) * 100, 0, 100);

    const pw = cfg.primaryWeight || 0.80;
    const roleScore = clamp(Math.round(pw * primaryScore + (1 - pw) * secondaryScore), 0, 100);

    return {
        roleScore,
        primary: { name: 'Profit/MW', value: +profitPerMW.toFixed(0), score: Math.round(primaryScore) },
        secondary: [
            { name: 'Imbalance Cost/MWh', value: +imbCostPerMWh.toFixed(1), score: Math.round(secondaryScore) }
        ]
    };
}

// ── BESS ──
// Primary: Revenue per MWh shifted (net of losses/degradation)
// Secondary: BM revenue share + SoC health (no penalties)
function bessRoleScore(stats, cfg) {
    const mwhShifted = Math.max(1, stats.mwhShifted || 1);
    const revPerMWh = stats.netProfit / mwhShifted;
    const primaryScore = clamp(mapThreshold(revPerMWh, cfg.breakpoints), 0, 100);

    // BM share: what % of revenue came from BM (>=50% is excellent)
    const bmShare = stats.totalRevenue > 0 ? (stats.bmRevenue || 0) / stats.totalRevenue : 0;
    const bmShareScore = clamp(bmShare * 200, 0, 100); // 50% → 100

    // SoC health: fewer penalty events = higher
    const socPenalties = stats.socPenalties || 0;
    const socScore = clamp(100 - socPenalties * 20, 0, 100);

    const secondaryScore = (bmShareScore + socScore) / 2;

    const pw = cfg.primaryWeight || 0.75;
    const roleScore = clamp(Math.round(pw * primaryScore + (1 - pw) * secondaryScore), 0, 100);

    return {
        roleScore,
        primary: { name: '£/MWh Shifted', value: +revPerMWh.toFixed(1), score: Math.round(primaryScore) },
        secondary: [
            { name: 'BM Revenue Share', value: +(bmShare * 100).toFixed(0) + '%', score: Math.round(bmShareScore) },
            { name: 'SoC Health', value: socPenalties + ' penalties', score: Math.round(socScore) }
        ]
    };
}

// ── Supplier ──
// Primary: Net cost per MWh after imbalance (lower = better — INVERTED)
// Secondary: Hedge ratio + imbalance as % of cost
function supplierRoleScore(stats, cfg) {
    const costPerMWh = stats.totalMWh > 0 ? Math.abs(stats.netCost || 0) / stats.totalMWh : 80;
    // Inverted breakpoints: lower cost = higher score
    const primaryScore = clamp(mapThreshold(costPerMWh, cfg.breakpoints), 0, 100);

    const hedgeRatio = clamp((stats.hedgeRatio || 0.5) * 100, 0, 100);
    const imbPct = stats.netCost > 0 ? Math.abs(stats.imbalanceCost || 0) / stats.netCost * 100 : 50;
    const imbPctScore = clamp(100 - imbPct * 2, 0, 100); // 0% imbalance → 100, 50%+ → 0

    const secondaryScore = (hedgeRatio + imbPctScore) / 2;

    const pw = cfg.primaryWeight || 0.80;
    const roleScore = clamp(Math.round(pw * primaryScore + (1 - pw) * secondaryScore), 0, 100);

    return {
        roleScore,
        primary: { name: 'Cost/MWh', value: '£' + costPerMWh.toFixed(0), score: Math.round(primaryScore) },
        secondary: [
            { name: 'Hedge Ratio', value: (stats.hedgeRatio * 100 || 0).toFixed(0) + '%', score: Math.round(hedgeRatio) },
            { name: 'Imbalance % of Cost', value: imbPct.toFixed(0) + '%', score: Math.round(imbPctScore) }
        ]
    };
}

// ── DSR Aggregator ──
// Primary: Reliability-adjusted revenue = Revenue × Reliability%
// Secondary: Customer impact penalty score
function dsrRoleScore(stats, cfg) {
    const reliability = clamp(stats.reliability || 1, 0, 1);
    const relAdjRev = (stats.netProfit || 0) * reliability;
    const primaryScore = clamp(mapThreshold(relAdjRev, cfg.breakpoints), 0, 100);

    const missedEvents = stats.missedEvents || 0;
    const secondaryScore = clamp(100 - missedEvents * 15, 0, 100);

    const pw = cfg.primaryWeight || 0.80;
    const roleScore = clamp(Math.round(pw * primaryScore + (1 - pw) * secondaryScore), 0, 100);

    return {
        roleScore,
        primary: { name: 'Reliability-Adj Rev', value: '£' + relAdjRev.toFixed(0), score: Math.round(primaryScore) },
        secondary: [
            { name: 'Missed Events', value: missedEvents, score: Math.round(secondaryScore) }
        ]
    };
}

// ── NESO (Combined System Operator + Market Operator) ──
// Four-part weighted: stability (40%), cost (20%), forecast MAE (15%), market clearing quality (25%)
// Reflects combined role: DA/ID auction clearing + real-time BM dispatch + constraint management
function nesoRoleScore(stats, cfg) {
    // Stability: based on average |NIV| — lower is better (real-time balancing quality)
    const avgAbsNIV = stats.avgAbsNIV || 0;
    const stabilityScore = clamp(100 - (avgAbsNIV / 6.2), 0, 100); // 0 NIV→100, 620→0

    // Cost: lower total system cost is better (market clearing efficiency)
    const costPerSP = stats.totalSystemCost / Math.max(1, stats.totalSPs || 1);
    const costScore = clamp(100 - (costPerSP / 50), 0, 100);

    // Forecast MAE: lower is better
    const maeScore = clamp(100 - (stats.forecastMAE || 0) * 2, 0, 100);

    // Market Clearing Quality: how well DA/ID auctions matched supply to demand
    // Based on: price stability (lower volatility = better), participation rate, bid coverage
    const priceVol = stats.priceVolatility || 0;
    const priceVolScore = clamp(100 - priceVol * 0.5, 0, 100);
    const participation = clamp((stats.participationRate || 0.5) * 100, 0, 100);
    const clearingScore = (priceVolScore + participation) / 2;

    const sw = cfg.stabilityWeight || 0.40;
    const cw = cfg.costWeight || 0.20;
    const mw = cfg.maeWeight || 0.15;
    const clw = cfg.clearingWeight || 0.25;
    const roleScore = clamp(Math.round(sw * stabilityScore + cw * costScore + mw * maeScore + clw * clearingScore), 0, 100);

    return {
        roleScore,
        primary: { name: 'Stability Index', value: Math.round(stabilityScore), score: Math.round(stabilityScore) },
        secondary: [
            { name: 'System Cost/SP', value: '£' + costPerSP.toFixed(0), score: Math.round(costScore) },
            { name: 'Forecast MAE', value: (stats.forecastMAE || 0).toFixed(1), score: Math.round(maeScore) },
            { name: 'Clearing Quality', value: Math.round(clearingScore), score: Math.round(clearingScore) }
        ]
    };
}

// ── Elexon (Settlement Body) ──
// Scores settlement accuracy, timeliness, and transparency
// In simulator context: how accurately the Elexon player identified/reported imbalances
function elexonRoleScore(stats, cfg) {
    // Accuracy: how close settlement calculations match actual metered data
    // Lower settlement error = higher score
    const settlementError = stats.settlementError || 0;
    const accuracyScore = clamp(100 - settlementError * 5, 0, 100);

    // Timeliness: fraction of settlements processed on time
    const onTimeRate = clamp((stats.onTimeRate || 1.0) * 100, 0, 100);

    // Transparency: audit completeness — how many SPs have complete audit trails
    const auditCoverage = clamp((stats.auditCoverage || 1.0) * 100, 0, 100);

    const aw = cfg?.accuracyWeight || 0.50;
    const tw = cfg?.timelinessWeight || 0.30;
    const trw = cfg?.transparencyWeight || 0.20;
    const roleScore = clamp(Math.round(aw * accuracyScore + tw * onTimeRate + trw * auditCoverage), 0, 100);

    return {
        roleScore,
        primary: { name: 'Settlement Accuracy', value: Math.round(accuracyScore) + '%', score: Math.round(accuracyScore) },
        secondary: [
            { name: 'On-Time Rate', value: Math.round(onTimeRate) + '%', score: Math.round(onTimeRate) },
            { name: 'Audit Coverage', value: Math.round(auditCoverage) + '%', score: Math.round(auditCoverage) }
        ]
    };
}

// ── Interconnector ──
// Primary: Congestion revenue
// Secondary: Availability %, stress contribution
function interconnectorRoleScore(stats, cfg) {
    const congestionRev = stats.congestionRevenue || 0;
    const primaryScore = clamp(mapThreshold(congestionRev, cfg.breakpoints), 0, 100);

    const availability = clamp((stats.availability || 1) * 100, 0, 100);
    const stressHelp = clamp((stats.stressContribution || 0) * 20, 0, 100);
    const secondaryScore = (availability + stressHelp) / 2;

    const pw = cfg.primaryWeight || 0.80;
    const roleScore = clamp(Math.round(pw * primaryScore + (1 - pw) * secondaryScore), 0, 100);

    return {
        roleScore,
        primary: { name: 'Congestion Revenue', value: '£' + congestionRev.toFixed(0), score: Math.round(primaryScore) },
        secondary: [
            { name: 'Availability', value: availability.toFixed(0) + '%', score: Math.round(availability) },
            { name: 'Stress Help', value: (stats.stressContribution || 0).toFixed(1), score: Math.round(stressHelp) }
        ]
    };
}

// ─── SYSTEM SCORE ───
// Common for all roles. Measures how much a player helped or hurt system stability.
// Input: { totalNIVContribution, stressWindowHelps, missedDeliveries, causedBlackout }
// Output: 0-100

export function computeSystemScore(metrics) {
    if (!metrics) return 50; // neutral default

    // Base: map NIV contribution percentile
    // Positive contribution = helped (reduced |NIV|), negative = hurt
    const nivBase = clamp(50 + (metrics.totalNIVContribution || 0) * 0.1, 0, 100);

    // Bonus for stress window help
    const stressBonus = Math.min((metrics.stressWindowHelps || 0) * 5, 25);

    // Penalties
    const missedPenalty = (metrics.missedDeliveries || 0) * 10;
    const blackoutPenalty = metrics.causedBlackout ? 40 : 0;

    return clamp(Math.round(nivBase + stressBonus - missedPenalty - blackoutPenalty), 0, 100);
}

// ─── OVERALL SCORE ───
export function computeOverallScore(roleScore, systemScore, alpha) {
    const a = alpha ?? SCORING_CONFIG.alpha ?? 0.6;
    return clamp(Math.round(a * roleScore + (1 - a) * systemScore), 0, 100);
}

// ─── MULTI-ROUND FINAL SCORE ───
// Rewards consistency: mean - penalty * std
export function computeFinalScore(overallScores) {
    if (!overallScores || overallScores.length === 0) return 0;
    const n = overallScores.length;
    const mean = overallScores.reduce((s, v) => s + v, 0) / n;
    if (n < 2) return Math.round(mean);

    const variance = overallScores.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
    const std = Math.sqrt(variance);
    const penalty = SCORING_CONFIG.consistencyPenalty ?? 0.1;

    return clamp(Math.round(mean - penalty * std), 0, 100);
}
