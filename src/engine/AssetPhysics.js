import { ASSETS, MIN_SOC, MAX_SOC, SP_DURATION_H } from '../shared/constants.js';
import { clamp } from '../shared/utils.js';

export function availMW(def, sofuel, market) {
    if (!def) return 0;
    // Handle market object structure (can be market, market.actual, or market.forecast)
    const isShort = market?.actual?.isShort ?? market?.forecast?.isShort ?? market?.isShort ?? false;
    const wf = market?.actual?.wf ?? market?.forecast?.wf ?? market?.wf ?? 0.5;
    const sf = market?.actual?.sf ?? market?.forecast?.sf ?? market?.sf ?? 0.5;

    if (def.kind === "soc") {
        // Energy-based limit respecting MIN_SOC and MAX_SOC
        const effectiveSoC = clamp(sofuel, MIN_SOC, MAX_SOC);
        
        // Discharge: can only discharge down to MIN_SOC
        const maxDischargeMWh = ((effectiveSoC - MIN_SOC) / 100) * (def.maxMWh || 0);
        const dischargeLimitMW = (maxDischargeMWh * (def.eff || 1)) / (SP_DURATION_H || 0.5);

        // Charge: can only charge up to MAX_SOC
        const maxChargeMWh = ((MAX_SOC - effectiveSoC) / 100) * (def.maxMWh || 0);
        const chargeLimitMW = (maxChargeMWh / (def.eff || 1)) / (SP_DURATION_H || 0.5);

        // Final clamp by physical hardware rating
        return clamp(isShort ? dischargeLimitMW : chargeLimitMW, 0, def.maxMW || 0);
    }

    if (def.kind === "wind") return clamp(Math.round(wf * (def.maxMW || 0)), 0, def.maxMW || 0);
    if (def.kind === "solar") return clamp(Math.round(sf * (def.maxMW || 0)), 0, def.maxMW || 0);
    if (def.kind === "fuel") return clamp((sofuel || 0) / (SP_DURATION_H || 0.5), 0, def.maxMW || 0);
    if (def.kind === "none") return def.maxMW || 0;
    return def.maxMW || 0; // Default fallback instead of 0
}

// Directional availability for BM phase where BESS can bid either way regardless of grid state
export function availMWDirectional(def, sofuel) {
    if (!def) return { charge: 0, discharge: 0 };

    if (def.kind === "soc") {
        // Respect MIN_SOC and MAX_SOC limits
        const effectiveSoC = clamp(sofuel, MIN_SOC, MAX_SOC);
        
        // Discharge: can only discharge down to MIN_SOC
        const maxDischargeMWh = ((effectiveSoC - MIN_SOC) / 100) * (def.maxMWh || 0);
        const dischargeLimitMW = (maxDischargeMWh * (def.eff || 1)) / (SP_DURATION_H || 0.5);

        // Charge: can only charge up to MAX_SOC
        const maxChargeMWh = ((MAX_SOC - effectiveSoC) / 100) * (def.maxMWh || 0);
        const chargeLimitMW = (maxChargeMWh / (def.eff || 1)) / (SP_DURATION_H || 0.5);

        return {
            charge: clamp(chargeLimitMW, 0, def.maxMW || 0),
            discharge: clamp(dischargeLimitMW, 0, def.maxMW || 0)
        };
    }

    // Non-storage assets return same value for both
    const limit = def.maxMW || 0;
    return { charge: limit, discharge: limit };
}

export function updateSoF(def, sofuel, mwAcc, isShort) {
    if (!def) return sofuel;
    const mwh = mwAcc * SP_DURATION_H;
    if (def.kind === "soc") {
        const eff = def.eff || 1;
        if (isShort) {
            const internalCostMwh = mwh / eff;
            return clamp(sofuel - (internalCostMwh / def.maxMWh) * 100, 0, 100);
        } else {
            const internalGainMwh = mwh * eff;
            return clamp(sofuel + (internalGainMwh / def.maxMWh) * 100, 0, 100);
        }
    }
    if (def.kind === "fuel") return isShort ? clamp(sofuel - mwh, 0, def.fuelMWh) : sofuel;
    return sofuel;
}

export function initSoF(def) {
    if (!def) return 0;
    if (def.kind === "soc") return def.startSoC;
    if (def.kind === "fuel") return def.startFuel ?? def.fuelMWh;
    return 0;
}
