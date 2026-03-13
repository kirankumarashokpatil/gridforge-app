import { ASSETS, EVENTS, SCENARIOS, MIN_SOC, MAX_SOC, SP_DURATION_H, SYSTEM_PARAMS } from '../shared/constants.js';
import { clamp, spTime } from '../shared/utils.js';

// ─── Deterministic RNG ───
function rng(seed) {
    let s = (seed | 0) >>> 0;
    return () => {
        s = ((Math.imul(s ^ (s >>> 15), 1 | s) + 0x6D2B79F5) | 0) >>> 0;
        let t = Math.imul(s ^ (s >>> 7), 61 | s) ^ s;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ─── Renewable physics helpers ───

// Wind speed model (m/s) for a given SP. Produces realistic day‑night
// variation and random fluctuations using deterministic RNG.
function windSpeedForSp(sp) {
    const base = 6 + 3 * Math.sin(((sp - 1) / 48) * Math.PI * 2); // 3–9 m/s daily cycle
    const wRng = rng(sp * 4211 + 17);
    const noise = (wRng() - 0.5) * 2; // ±1 m/s
    return Math.max(0, base + noise);
}

// Add forecast error to wind speed (10‑20% day‑ahead, ~5% intraday)
function forecastWindSpeed(trueSpeed, sp) {
    const errScale = 0.12 + 0.08 * rng(sp * 3127 + 9)(); // 0.12‑0.20
    const sign = rng(sp * 531 + 3)() < 0.5 ? -1 : 1;
    return Math.max(0, trueSpeed * (1 + sign * errScale));
}

// Convert wind speed (m/s) into capacity fraction using a typical turbine
// power curve with cut-in 3 m/s, rated 12 m/s, cut-out 25 m/s.
function windFractionFromSpeed(v) {
    if (v < 3 || v >= 25) return 0;
    if (v < 12) {
        // cubic ramp between 3 and 12
        const x = (v - 3) / (12 - 3);
        return Math.pow(x, 3);
    }
    if (v <= 15) return 1;
    // above rated until cut-out simple linear drop
    return 1 - (v - 15) / (25 - 15);
}

// Solar irradiance fraction (0‑1) for a given SP. Sinusoidal daylight pattern
// with random cloud noise.
function solarIrradianceForSp(sp) {
    const hr = ((sp - 1) / 2) % 24;
    if (hr < 6 || hr > 18) return 0;
    const base = Math.sin(((hr - 6) / 12) * Math.PI);
    const sRng = rng(sp * 715 + 23);
    const noise = (sRng() - 0.5) * 0.3; // ±15% cloud effect
    return clamp(base + noise, 0, 1);
}

// Forecast error for solar (smaller than wind)
function forecastSolarIrradiance(trueIrr, sp) {
    const errScale = 0.07 + 0.03 * rng(sp * 811 + 5)(); // 7‑10%
    const sign = rng(sp * 929 + 2)() < 0.5 ? -1 : 1;
    return clamp(trueIrr * (1 + sign * errScale), 0, 1);
}

// ─── Market State for an SP (Forecast vs Actual) ───
export function marketForSp(sp, scenarioId = "NORMAL", injectedEvents = [], publishedForecast = null, manualNivOverride = null) {
    const sc = SCENARIOS[scenarioId] || SCENARIOS.NORMAL;
    const r = rng(sp * 1337 + 42); // Base RNG for expected state
    const errRng = rng(sp * 9999 + 777); // RNG for forecast errors and surprises

    // 1. BASE EXPECTED STATE (Day-Ahead Forecast)
    const hr = Math.floor((sp - 1) / 2);

    // demand remains synthetic for now (could later drive by weather)
    let expectedDemand = 0.72 + 0.28 * (0.5 - 0.5 * Math.cos(((hr - 5) / 24) * 2 * Math.PI));

    // Forecast and true renewable resource states
    const trueWindSpeed = windSpeedForSp(sp);
    const forecastWindSpd = forecastWindSpeed(trueWindSpeed, sp);
    let expectedWind = windFractionFromSpeed(forecastWindSpd) * sc.windMod;

    const trueIrr = solarIrradianceForSp(sp);
    const forecastIrr = forecastSolarIrradiance(trueIrr, sp);
    let expectedSolar = forecastIrr;

    // override with publishedForecast if provided (DA override)
    if (publishedForecast && publishedForecast.demand && publishedForecast.wind) {
        const idx = (sp - 1) % 48;
        expectedDemand = clamp(publishedForecast.demand[idx] / 45000, 0.4, 1.2);
        expectedWind = clamp(publishedForecast.wind[idx] / 25000, 0, 1) * sc.windMod;
        expectedSolar = publishedForecast.solar ? clamp(publishedForecast.solar[idx] / 15000, 0, 1) : 0;
    }

    // --- SYSTEM ASSETS (absolute MW values) ---
    const baseDemandMw = SYSTEM_PARAMS.baseDemandGW * 1000;
    const windCapMw = SYSTEM_PARAMS.maxWindGW * 1000;
    const solarAssets = Object.values(ASSETS).filter(a => a.kind === "solar");
    const solarCapMw = solarAssets.reduce((sum, a) => sum + (a.maxMW || 0), 0);

    const forecastSystem = {
        demandMw: Math.round(expectedDemand * baseDemandMw),
        windMw: Math.round(expectedWind * windCapMw),
        solarMw: Math.round(expectedSolar * solarCapMw),
        // also expose raw capacity so UI can scale sparklines or panels
        windCapMw,
        solarCapMw,
        baseDemandMw
    };

    const baseNIV = (r() - 0.52) * 650 * expectedDemand + sc.nivBias;
    const expectedRefPrice = (65 + r() * 55) * sc.priceMod;

    // 4 Distinct Regional European Prices
    const expectedPriceFR = (50 + 40 * Math.sin(((hr - 2) / 24) * 2 * Math.PI) + (r() * 15 - 5)) * sc.priceMod; // Stable nuclear, predictable daily curve
    const expectedPriceNO = (40 + 20 * Math.sin(((hr - 6) / 24) * 2 * Math.PI) + (r() * 5)) * sc.priceMod; // Nordic hydro: flat, cheap, highly stable
    const expectedPriceNL = (expectedRefPrice * 0.95) + (r() * 20 - 10); // Netherlands: strongly gas-coupled to GB but slightly discounted
    const expectedPriceDK = (30 + (1 - expectedWind) * 60 + (r() * 10)) * sc.priceMod; // Denmark: Highly inversely correlated to GB wind

    // debug: log expected wind/solar to diagnose NaN issues
    if (import.meta.env.DEV) console.log('DEBUG forecast', { sp, expectedWind, expectedSolar });
    const forecast = {
        sp,
        hr,
        niv: manualNivOverride !== null ? clamp(manualNivOverride, -620, 620) : clamp(baseNIV, -620, 620),
        isShort: manualNivOverride !== null ? manualNivOverride < 0 : baseNIV < 0,
        wf: expectedWind,
        sf: expectedSolar,
        sbp: clamp((manualNivOverride !== null ? manualNivOverride < 0 : baseNIV < 0) ? expectedRefPrice * 1.32 : expectedRefPrice * 0.82, 10, 900),
        ssp: clamp((manualNivOverride !== null ? manualNivOverride < 0 : baseNIV < 0) ? expectedRefPrice * 0.72 : expectedRefPrice * 1.22, 5, 800),
        baseRef: expectedRefPrice,
        priceFR: expectedPriceFR,
        priceNO: expectedPriceNO,
        priceNL: expectedPriceNL,
        priceDK: expectedPriceDK,
        system: forecastSystem
    };

    // 2. ACTUAL STATE (Reality hits during ID and BM)
    let event = null;
    let cum = 0;
    const er = errRng();
    for (const e of EVENTS) {
        const adj = e.prob * sc.eventProb;
        cum += adj;
        if (er < cum) { event = e; break; }
    }

    // Allow NESO to inject events manually
    const injected = injectedEvents.find(e => e.sp === sp);
    if (injected) {
        event = EVENTS.find(e => e.id === injected.eventId) || event;
    }

    // Forecast error applied (e.g. wind dropping or demand surging unexpectedly)
    const windError = (errRng() - 0.4) * 0.3; // noise for Danish price coupling (not applied to wind output)
    const demandErrorMv = (errRng() - 0.5) * 120;
    const solarError = (errRng() - 0.3) * 0.2; // -6% to +14% swing

    // True physical conditions derived from wind speed and irradiance
    let modWindSpeed = trueWindSpeed;
    if (event?.id === "WIND_UP") modWindSpeed *= 1.6;
    if (event?.id === "WIND_LOW") modWindSpeed *= 0.3;
    if (event?.id === "DUNKEL") modWindSpeed *= 0.05;
    const trueWind = windFractionFromSpeed(modWindSpeed);

    // solar error still adds some noise on top of irradiance
    const trueSolar = clamp(trueIrr + solarError, 0, 1);

    const trueNIV = manualNivOverride !== null ? clamp(manualNivOverride, -620, 620) : clamp(baseNIV + demandErrorMv + (event ? event.niv : 0), -620, 620);
    const trueIsShort = trueNIV < 0;
    const trueRefPrice = expectedRefPrice + (event ? event.pd : 0) + (trueIsShort ? 25 : -15);
    // Add real-time noise to foreign markets
    const truePriceFR = expectedPriceFR + (errRng() * 12 - 6);
    const truePriceNO = expectedPriceNO + (errRng() * 4 - 2); // Very steady
    const truePriceNL = expectedPriceNL + (errRng() * 16 - 8);
    const truePriceDK = expectedPriceDK + (windError * -40) + (errRng() * 10 - 5); // Exacerbated by wind error

    // Asset constraints caused by events (e.g. generator trips)
    const trippedAssets = event?.id === "TRIP" || event?.id === "CASCADE" ? generateTrips(errRng, event.id) : [];

    const actual = {
        sp,
        hr,
        niv: trueNIV,
        isShort: trueIsShort,
        wf: trueWind,
        sf: trueSolar,
        sbp: clamp(trueIsShort ? trueRefPrice * 1.32 : trueRefPrice * 0.82, 10, 900),
        ssp: clamp(trueIsShort ? trueRefPrice * 0.72 : trueRefPrice * 1.22, 5, 800),
        freq: clamp(50 + clamp(-trueNIV / 15000, -0.4, 0.4) * (0.5 + errRng() * 1.0), 49.3, 50.7),
        event,
        trippedAssets,
        baseRef: trueRefPrice,
        priceFR: truePriceFR,
        priceNO: truePriceNO,
        priceNL: truePriceNL,
        priceDK: truePriceDK,
        system: {
            demandMw: Math.round((expectedDemand + demandErrorMv / baseDemandMw) * baseDemandMw),
            windMw: Math.round(trueWind * windCapMw),
            solarMw: Math.round(trueSolar * solarCapMw),
            windCapMw,
            solarCapMw,
            baseDemandMw
        }
    };

    // Bots (Generate generic BM bots based on ACTUAL state)
    actual.bots = [];

    // LoLP / VoLL Scarcity Pricing
    const approxCapacityGW = SYSTEM_PARAMS.baseDemandGW * 1.5; // rough estimate of total capacity
    const reserveMarginPct = ((approxCapacityGW - Math.abs(trueNIV) / 1000) / approxCapacityGW) * 100;
    if (reserveMarginPct < 5) { // LoLP > 5%
        const lolpMultiplier = Math.max(1, (10 - reserveMarginPct) / 2); // scale up to 5x at 0% margin
        actual.sbp = Math.min(SYSTEM_PARAMS.VoLL, actual.sbp * lolpMultiplier);
        actual.ssp = Math.max(0, actual.ssp / lolpMultiplier);
    }


    // --- Automatic interconnector flow simulation ---

    // --- Demand curve / supply curve derivation ---
    // Provide a simple stepwise curve for UI plotting or for more advanced
    // market-clearing algorithms.  Uses deterministic RNG so the shape is
    // repeatable for the same SP.
    function makeCurve(baseMw, rngFn) {
        const steps = [];
        const points = 6; // number of vertices (small for performance)
        for (let i = 0; i <= points; i++) {
            const vol = Math.round((i / points) * baseMw);
            // price from 10 to 200 with some randomness
            const price = Math.round(10 + (190 * (i / points)) + (rngFn() * 20 - 10));
            steps.push({ mw: vol, price });
        }
        return steps;
    }

    forecast.demandCurve = makeCurve(forecastSystem.demandMw, r);
    actual.demandCurve = makeCurve(actual.system.demandMw, errRng);
    function calcFlow(marketObj, def) {
        const fpk = def.foreignPriceKey || "priceFR";
        const uk = marketObj.baseRef || marketObj.sbp || 0;
        const fr = marketObj[fpk] || uk;
        // simple proportional coupling: 15 MW per £ spread (arbitrary scale)
        let flow = (uk - fr) * 15;
        const cap = def.maxMW || 1000;
        if (flow > cap) flow = cap;
        if (flow < -cap) flow = -cap;
        return Math.round(flow);
    }

    const icDefs = Object.values(ASSETS).filter(a => a.kind === "interconnector");
    forecast.interconnectorFlows = {};
    actual.interconnectorFlows = {};
    icDefs.forEach(def => {
        forecast.interconnectorFlows[def.key] = calcFlow(forecast, def);
        actual.interconnectorFlows[def.key] = calcFlow(actual, def);
    });

    return { forecast, actual };
}

function generateTrips(r, eventId) {
    // Determine which bots or player assets randomly tripped
    const candidates = ["OCGT", "HYDRO", "BESS_L", "WIND"];
    const trips = [];
    trips.push(candidates[Math.floor(r() * candidates.length)]);
    if (eventId === "CASCADE") trips.push(candidates[Math.floor(r() * candidates.length)]);
    return trips;
}



// ─── Clear Balancing Mechanism ───
export function clearBM(bids, market) {
    const { isShort, sbp, ssp, niv } = market;
    const side = isShort ? "offer" : "bid";
    const cands = bids.filter(b => b.side === side && +b.mw > 0 && !isNaN(+b.price))
        .sort((a, b) => isShort ? +a.price - +b.price : +b.price - +a.price);

    let rem = Math.abs(niv);
    let cp = isShort ? sbp : ssp;
    const acc = [];

    for (const b of cands) {
        // Precision-safe break
        if (rem <= 0.001) break;
        const mwAcc = Math.min(+b.mw, rem);
        cp = +b.price;
        acc.push({ ...b, mwAcc });
        rem -= mwAcc;
    }

    const result = acc.map((a, idx) => {
        const def = ASSETS[a.asset];
        const mwh = a.mwAcc * SP_DURATION_H;
        const grossRevenue = a.mwAcc * cp * SP_DURATION_H * (isShort ? 1 : -1);
        const wearCost = (def?.wear || 0) * mwh;
        let netRevenue = grossRevenue - wearCost;

        let cfdAdjustment = 0;
        if (def?.strikePrice) {
            cfdAdjustment = (def.strikePrice - cp) * mwh;
            netRevenue += cfdAdjustment;
        }

        return {
            ...a,
            revenue: +netRevenue.toFixed(2),
            wearCost: +wearCost.toFixed(2),
            cfdAdjustment: +cfdAdjustment.toFixed(2),
            marginal: idx === acc.length - 1,
        };
    });

    return {
        accepted: result,
        cp,
        cleared: Math.abs(niv) - Math.max(0, rem),
        full: rem <= 0.001
    };
}

// ─── Day-Ahead Auction Clearing (Pay-As-Clear) ───
export function clearDA(bids, market_forecast) {
    const offers = bids.filter(b => b.side === "offer" && +b.mw > 0 && !isNaN(+b.price))
        .sort((a, b) => +a.price - +b.price);
    const demands = bids.filter(b => b.side === "bid" && +b.mw > 0 && !isNaN(+b.price))
        .sort((a, b) => +b.price - +a.price);

    // Build supply and demand price points
    const pricePoints = Array.from(new Set([
        ...offers.map(o => +o.price),
        ...demands.map(d => +d.price)
    ])).sort((a, b) => a - b);

    // Find intersection
    let cp = market_forecast.baseRef; // default
    let volume = 0;
    const accepted_bids = [];

    // Check all price points for intersection (find price that maximizes volume)
    for (const p of pricePoints) {
        const supplyAtP = offers.filter(o => +o.price <= p).reduce((s, o) => s + +o.mw, 0);
        const demandAtP = demands.filter(d => +d.price >= p).reduce((s, d) => s + +d.mw, 0);
        const v = Math.min(supplyAtP, demandAtP);

        if (v > volume) {
            volume = v;
            cp = p;
        }
    }

    if (volume > 0) {
        // Accept offers up to this price with pro-rata allocation at marginal price
        let accCum = 0;
        const offersAtCp = offers.filter(o => +o.price < cp);
        const marginalOffers = offers.filter(o => +o.price === cp);
        const infraMarginalOfferVolume = offersAtCp.reduce((sum, o) => sum + +o.mw, 0);
        const marginalVolumeNeeded = Math.max(0, volume - infraMarginalOfferVolume);
        const marginalTotalVolume = marginalOffers.reduce((sum, o) => sum + +o.mw, 0);

        // Accept all infra-marginal offers
        for (const o of offersAtCp) {
            const accMW = +o.mw;
            accepted_bids.push({ ...o, mwAcc: accMW, revenue: accMW * cp * SP_DURATION_H });
            accCum += accMW;
        }

        // Pro-rata allocate marginal volume among offers at clearing price
        if (marginalVolumeNeeded > 0 && marginalTotalVolume > 0) {
            for (const o of marginalOffers) {
                const proRataShare = (+o.mw / marginalTotalVolume) * marginalVolumeNeeded;
                const accMW = Math.min(+o.mw, proRataShare);
                if (accMW > 0) {
                    accepted_bids.push({ ...o, mwAcc: accMW, revenue: accMW * cp * SP_DURATION_H });
                    accCum += accMW;
                }
            }
        }

        // Accept bids down to this price with pro-rata allocation at marginal price
        accCum = 0;
        const demandsAtCp = demands.filter(d => +d.price > cp);
        const marginalDemands = demands.filter(d => +d.price === cp);
        const infraMarginalDemandVolume = demandsAtCp.reduce((sum, d) => sum + +d.mw, 0);
        const demandMarginalVolumeNeeded = Math.max(0, volume - infraMarginalDemandVolume);
        const demandMarginalTotalVolume = marginalDemands.reduce((sum, d) => sum + +d.mw, 0);

        // Accept all infra-marginal demands
        for (const d of demandsAtCp) {
            const accMW = +d.mw;
            accepted_bids.push({ ...d, mwAcc: accMW, revenue: -(accMW * cp * SP_DURATION_H) });
            accCum += accMW;
        }

        // Pro-rata allocate marginal volume among demands at clearing price
        if (demandMarginalVolumeNeeded > 0 && demandMarginalTotalVolume > 0) {
            for (const d of marginalDemands) {
                const proRataShare = (+d.mw / demandMarginalTotalVolume) * demandMarginalVolumeNeeded;
                const accMW = Math.min(+d.mw, proRataShare);
                if (accMW > 0) {
                    accepted_bids.push({ ...d, mwAcc: accMW, revenue: -(accMW * cp * SP_DURATION_H) });
                    accCum += accMW;
                }
            }
        }
    }

    return { cp, volume, accepted_bids };
}

// ─── Feedback Market State (Post-Clearing Updates) ───
export function feedbackMarketState(market, clearResult) {
    const { isShort, niv, baseRef } = market;
    const { cp, cleared } = clearResult;

    // Post-clearing residual NIV (after BM dispatch)
    const residualNIV = niv - (isShort ? cleared : -cleared);

    // Dynamic Frequency based on residual NIV
    const freqDeviation = clamp(-residualNIV / 15000, -0.4, 0.4);
    const freqRng = rng((market.sp || 1) * 42 + 7);
    const freq = clamp(50 + freqDeviation * (0.5 + freqRng() * 1.0), 49.3, 50.7);

    // Clearing-derived SBP/SSP
    let sbp, ssp;
    if (isShort) {
        // Short system (discharging): SBP = max(clearResult.cp, market.baseRef * 1.1), SSP drops to 80%
        sbp = Math.max(cp, baseRef * 1.1);
        ssp = baseRef * 0.8;
    } else {
        // Long system (charging): SSP = min(clearResult.cp, market.baseRef * 0.9), SBP rises to 120%
        ssp = Math.min(cp, baseRef * 0.9);
        sbp = baseRef * 1.2;
    }

    return {
        ...market,
        freq,
        sbp: clamp(sbp, 10, 900),
        ssp: clamp(ssp, 5, 800),
        residualNIV
    };
}

// ─── Forecasts ───
export function computeForecasts(currentSp, scenarioId, publishedForecast = null, maxOffsets = 4) {
    const fcasts = [];
    for (let offset = 1; offset <= maxOffsets; offset++) {
        const sp = currentSp + offset;
        const state = marketForSp(sp, scenarioId, [], publishedForecast);
        // During DA, players only see the forecast.
        fcasts.push({
            ...state.forecast,
            sp: state.forecast.sp,
            time: spTime(state.forecast.sp),
            niv: Math.round(state.forecast.niv),
            isShort: state.forecast.isShort,
            priceLo: Math.round(state.forecast.sbp * 0.8),
            priceHi: Math.round(state.forecast.sbp * 1.2),
            wf: Math.round(state.forecast.wf * 100),
            sf: Math.round(state.forecast.sf * 100),
            event: offset <= 2 && state.actual.event?.prob > 0.05
                ? { id: "WARNING", name: "Grid Volatility Warning", emoji: "⚠️" } : null,
            confident: offset <= 2,
        });
    }
    return fcasts;
}
