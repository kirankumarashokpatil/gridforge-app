// ─── PHYSICAL ENGINE ───
// Tracks system-level metrics across settlement periods.
// Computes NIV tracking, system impact attribution, and builds player stats for scoring.

import { SCORING_CONFIG, ASSETS, SP_DURATION_H } from '../shared/constants.js';

// ─── Create Initial System State ───
export function createSystemState() {
    return {
        nivHistory: [],          // { sp, niv, absNiv, balancingCost, isStress }
        totalBalancingCost: 0,
        stressEvents: 0,
        blackouts: 0,
        totalSPs: 0,
        playerImpacts: {},       // pid → { totalNIVContribution, stressWindowHelps, missedDeliveries, causedBlackout }
    };
}

// ─── Update System State Each SP ───
// spData: { sp, niv, balancingCost, freq, blackout }
export function updateSystemState(state, spData) {
    const absNiv = Math.abs(spData.niv || 0);
    const stressThreshold = SCORING_CONFIG?.stressNIVThreshold ?? 300;
    const isStress = absNiv > stressThreshold;

    const entry = {
        sp: spData.sp,
        niv: spData.niv || 0,
        absNiv,
        balancingCost: spData.balancingCost || 0,
        isStress,
    };

    return {
        ...state,
        nivHistory: [...state.nivHistory, entry],
        totalBalancingCost: state.totalBalancingCost + (spData.balancingCost || 0),
        stressEvents: state.stressEvents + (isStress ? 1 : 0),
        blackouts: state.blackouts + (spData.blackout ? 1 : 0),
        totalSPs: state.totalSPs + 1,
    };
}

// ─── Compute Player System Impact for a Single SP ───
// Positive = player helped reduce |NIV| (their imbalance offset system imbalance)
// Negative = player worsened |NIV|
// playerImbalance: signed MW (positive = injected surplus, negative = short)
// systemNIV: signed MW (positive = system long, negative = system short)
export function computePlayerSystemImpact(playerImbalance, systemNIV) {
    if (playerImbalance === 0) return 0;

    // If system is short (negative NIV) and player injected (positive imbalance), player helped
    // If system is long (positive NIV) and player absorbed (negative imbalance), player helped
    // The metric: how much did |NIV| decrease because of this player?

    const nivWithout = Math.abs(systemNIV - playerImbalance); // hypothetical |NIV| if player wasn't there
    const nivWith = Math.abs(systemNIV);

    // Positive = player reduced |NIV|, negative = player increased it
    return nivWithout - nivWith;
}

// ─── Update Per-Player System Impact Accumulator ───
export function updatePlayerImpact(currentImpacts, pid, spImpact, isStressSP, deliveredOk) {
    const prev = currentImpacts[pid] || {
        totalNIVContribution: 0,
        stressWindowHelps: 0,
        missedDeliveries: 0,
        causedBlackout: false,
    };

    return {
        ...currentImpacts,
        [pid]: {
            totalNIVContribution: prev.totalNIVContribution + spImpact,
            stressWindowHelps: prev.stressWindowHelps + (isStressSP && spImpact > 0 ? 1 : 0),
            missedDeliveries: prev.missedDeliveries + (deliveredOk ? 0 : 1),
            causedBlackout: prev.causedBlackout, // set separately if blackout triggered
        },
    };
}

// ─── Build Player Stats Object for ScoringEngine ───
// Assembles the stats object that ScoringEngine.computeRoleScore() expects.
export function buildPlayerStats(role, data) {
    const {
        spHistory = [],
        assetKey = '',
        soc = 50,
        cash = 0,
        daCash = 0,
        imbalancePenalty = 0,
        systemImpacts = {},
        pid = '',
        congestionRevenue = 0,
    } = data;

    const def = ASSETS[assetKey] || {};
    const totalSPs = spHistory.length;
    const netProfit = cash;

    // Compute revenue components from SP history
    let totalBmRev = 0;
    let totalDaRev = 0;
    let totalIdRev = 0;
    let totalMWh = 0;
    let maxDrawdown = 0;
    let runningPL = 0;
    let peakPL = 0;
    let marginEvents = 0;

    for (const sp of spHistory) {
        const spRev = sp.revenue || 0;
        totalBmRev += Math.abs(sp.bmRev || 0);
        totalDaRev += Math.abs(sp.daRev || 0);
        totalIdRev += Math.abs(sp.idRev || 0);
        totalMWh += Math.abs(sp.contractPosMw || 0) * SP_DURATION_H; // MW * time per SP

        // Drawdown tracking
        runningPL += spRev;
        if (runningPL > peakPL) peakPL = runningPL;
        const dd = peakPL - runningPL;
        if (dd > maxDrawdown) maxDrawdown = dd;

        // Margin event: if running PL fell below -500 (configurable)
        if (runningPL < -500) marginEvents++;
    }

    const totalRevenue = totalBmRev + totalDaRev + totalIdRev;
    const impact = systemImpacts[pid] || {};

    // MWh shifted for BESS: approximate from SP history
    const mwhShifted = totalMWh || 1;

    const baseStats = {
        netProfit,
        totalRevenue,
        totalSPs,
        maxDrawdown: Math.max(1, maxDrawdown),
        marginEvents,
        capacityMW: def.maxMW || 1,
        totalMWh: totalMWh || 1,
        imbalanceCost: imbalancePenalty,
        bmRevenue: totalBmRev,
        mwhShifted,
        socPenalties: 0, // TODO: track from SoC limit hits
        congestionRevenue,

        // Supplier-specific
        netCost: Math.abs(netProfit),
        hedgeRatio: totalDaRev > 0 ? Math.min(totalDaRev / Math.max(1, totalRevenue), 1) : 0.5,

        // DSR-specific
        reliability: 1.0, // Default to 100% reliability for now
        missedEvents: impact.missedDeliveries || 0,

        // NESO-specific — use real system data when available
        avgAbsNIV: 0,
        totalSystemCost: 0,
        forecastMAE: 0,
        priceVolatility: 0,
        participationRate: 0.5,

        // Elexon-specific
        settlementError: 0,
        onTimeRate: 1.0,
        auditCoverage: 1.0,

        // Interconnector-specific
        availability: 1.0,
        stressContribution: (impact.stressWindowHelps || 0),
    };

    // Override with role-specific real data when available
    if (role === 'NESO' && data.systemState) {
        const nesoSpecific = buildNesoStats(data.systemState, spHistory);
        Object.assign(baseStats, nesoSpecific);
    }
    if (role === 'ELEXON' && data.spContracts) {
        const elexonSpecific = buildElexonStats(data.spContracts, spHistory);
        Object.assign(baseStats, elexonSpecific);
    }

    return baseStats;
}

// ─── Build NESO-Specific Stats from System State ───
export function buildNesoStats(systemState, spHistory = []) {
    const nivHist = systemState.nivHistory || [];
    const totalSPs = nivHist.length || 1;
    const avgAbsNIV = nivHist.reduce((s, e) => s + e.absNiv, 0) / totalSPs;

    // Compute forecastMAE: average |forecast NIV - actual NIV| across SPs
    // spHistory entries have niv (actual) — we compare against forecast
    let forecastMAE = 0;
    if (spHistory.length > 0) {
        // MAE is average absolute deviation of the forecast from actual
        // A lower MAE means the NESO published better forecasts
        const totalDeviation = spHistory.reduce((sum, h) => {
            const actualNiv = h.niv || 0;
            // Estimate forecast NIV from sbp/ssp relationship (forecast was more optimistic)
            // Since we don't store forecast NIV separately, use cp vs sbp spread as proxy
            const forecastError = Math.abs(actualNiv) * 0.15 + Math.abs((h.sbp || 0) - (h.ssp || 0)) * 0.1;
            return sum + forecastError;
        }, 0);
        forecastMAE = totalDeviation / spHistory.length;
    }

    // Price volatility: std dev of clearing prices
    let priceVolatility = 0;
    if (spHistory.length > 1) {
        const prices = spHistory.map(h => h.cp || h.sbp || 50);
        const mean = prices.reduce((s, v) => s + v, 0) / prices.length;
        const variance = prices.reduce((s, v) => s + (v - mean) ** 2, 0) / (prices.length - 1);
        priceVolatility = Math.sqrt(variance);
    }

    // Participation rate: what fraction of SPs had bids accepted
    const spsWithActivity = spHistory.filter(h => Math.abs(h.bmRev || 0) > 0 || Math.abs(h.daRev || 0) > 0).length;
    const participationRate = spHistory.length > 0 ? spsWithActivity / spHistory.length : 0.5;

    return {
        netProfit: 0,
        totalRevenue: 0,
        totalSPs,
        avgAbsNIV,
        totalSystemCost: systemState.totalBalancingCost || 0,
        forecastMAE,
        priceVolatility,
        participationRate,
        stressEvents: systemState.stressEvents,
        blackouts: systemState.blackouts,
    };
}

// ─── Build Elexon-Specific Stats from Settlement Data ───
export function buildElexonStats(spContracts, spHistory = []) {
    // Settlement accuracy: measures how consistently settlements were calculated
    // Lower error = better. Compare settlement totals to expected values.
    let totalError = 0;
    let settledSPs = 0;

    for (const [spNum, contracts] of Object.entries(spContracts)) {
        for (const [pid, c] of Object.entries(contracts)) {
            if (c.settlement) {
                settledSPs++;
                // Check internal consistency: total should = sum of components
                const expected = (c.settlement.daCash || 0) +
                    (c.settlement.idCash || 0) +
                    (c.settlement.bmCash || 0) +
                    (c.settlement.imbCash || 0) +
                    (c.settlement.startupCost || 0) +
                    (c.settlement.operatingCost || 0) +
                    (c.settlement.bsuoSCharge || 0);
                const actual = c.settlement.totalCash || 0;
                totalError += Math.abs(expected - actual);
            }
        }
    }

    const settlementError = settledSPs > 0 ? totalError / settledSPs : 0;

    // On-time rate: fraction of SPs that have been settled
    const totalSPsPlayed = spHistory.length || 1;
    const settledSPNumbers = new Set(Object.keys(spContracts).filter(sp => {
        const contracts = spContracts[sp];
        return Object.values(contracts).some(c => c.settlement);
    }));
    const onTimeRate = Math.min(settledSPNumbers.size / totalSPsPlayed, 1.0);

    // Audit coverage: fraction of players that have complete settlement records
    const auditCoverage = settledSPs > 0 ? Math.min(settledSPs / (totalSPsPlayed * 2), 1.0) : 0.5;

    return {
        settlementError,
        onTimeRate,
        auditCoverage,
    };
}
