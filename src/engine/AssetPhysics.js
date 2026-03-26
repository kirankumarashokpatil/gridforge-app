import { ASSETS, MIN_SOC, MAX_SOC, SP_DURATION_H } from '../shared/constants.js';
import { clamp } from '../shared/utils.js';

export function availMW(def, sofuel, market) {
    if (!def) return 0;
    const { isShort, wf, sf } = market;

    if (def.kind === "soc") {
        // Energy-based limit: (Current Energy / Time)
        const energyLimitMW = isShort
            ? ((sofuel - MIN_SOC) / 100 * def.maxMWh * (def.eff || 1)) / SP_DURATION_H
            : ((MAX_SOC - sofuel) / 100 * def.maxMWh / (def.eff || 1)) / SP_DURATION_H;
        
        // Final clamp by physical hardware rating
        return clamp(energyLimitMW, 0, def.maxMW);
    }
    
    if (def.kind === "wind") return clamp(Math.round(wf * def.maxMW), 0, def.maxMW);
    if (def.kind === "solar") return clamp(Math.round(sf * def.maxMW), 0, def.maxMW);
    if (def.kind === "fuel") return clamp(sofuel / SP_DURATION_H, 0, def.maxMW);
    if (def.kind === "none") return def.maxMW;
    if (def.kind === "dsr") return def.maxMW;
    if (def.kind === "interconnector") return def.maxMW;
    return 0;
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
