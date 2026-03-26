// ─── TIMING ───
export const TICK_MS = 15000;
export const MIN_SOC = 10;
export const MAX_SOC = 90;
export const DA_CYCLE = 6;
export const DA_MS = 9000;

// ─── SETTLEMENT PERIOD UNITS ───
// Single half‑hour settlement period duration (hours).
// All internal energy and cash calculations must use this named constant,
// never a magic 0.5 literal.
export const SP_DURATION_H = 0.5;

// Total settlement periods per trading day.
export const SPS_PER_DAY = 48;

// ─── CASHOUT MODE ───
// "single" = post-P305 single cash-out price; "dual" = pre-2015 dual SBP/SSP.
export const CASHOUT_MODE = "single";

// ─── GRID FAILURE (System Failure Rule — §7) ───
export const FREQ_FAIL_LO = 49.5;
export const FREQ_FAIL_HI = 50.5;
export const FREQ_FAIL_DURATION = 5;

// ─── SYSTEM PARAMETERS ───
// Real-time grid state displayed to players. All calculated, not hardcoded.
export const SYSTEM_PARAMS = {
    // Base demand (GW) — MUST be calculated from game state, not hardcoded display value
    // NESOScreen currently shows: 35 + Math.abs(niv) / 1000
    // This constant is grid reference baseline; actual displayed value comes from MarketEngine
    baseDemandGW: 35,

    // Wind capacity (GW) — from ASSETS config, not static display
    maxWindGW: 12,

    // Frequency operating band (Hz)
    freqNominal: 50.0,
    freqBandLow: 49.8,
    freqBandHigh: 50.2,

    // Reserve margin threshold (%)
    reserveMarginThreshold: 15,

    // Dynamic Containment service capacity (MW)
    dcCapacityMW: 500,

    // Frequency Response available capacity (MW) when within freq band
    freqResponseCapacityMW: 75,

    // Value of Lost Load (£/MWh) — scarcity pricing cap
    VoLL: 6000,

    // Interconnector flows (GW) — MUST be calculated from asset state, not static
    interconnectorFlows: {
        IFA: 2.0,    // IFA → EU
        NSL: 1.4,    // NSL → NI
        BRITNED: 1.0, // BritNed → NL
        VIKING: 1.4,  // Viking Link → DK
    },

    // Trading margin parameters (£)
    traderStartCapitalBonus: 5000,
    marginWarningThreshold: 1000,

    // Bid strategy multipliers (not user input, default placeholders)
    // These should NOT be hardcoded in UI; shown as hints only
    bidStrategyMultipliers: {
        genBM: { sbpMultiplier: 0.8, sspMultiplier: 1.2 },    // 20% below SBP, 20% above SSP
        bessBM: { sbpMultiplier: 0.8, sspMultiplier: 1.2 },   // Same as Generator
        dsrBM: { sspMultiplier: 0.8, sbpMultiplier: 1.5 },    // Different: DSR-specific
        icBM: { sbpMultiplier: 0.8, sspMultiplier: 1.2 },     // Interconnector
    },

    // Map display constants (UI only, not game logic)
    mapProjection: {
        scale: 2200,
        centerLon: -2,
        centerLat: 54.3,
    },
};

// ─── TICK SPEED PRESETS ───
export const TICK_SPEEDS = {
    SLOW: { id: "SLOW", ms: 30000, label: "Slow (30s)", emoji: "🐢", desc: "Tutorial pace — extra time to discuss" },
    NORMAL: { id: "NORMAL", ms: 15000, label: "Normal (15s)", emoji: "⚡", desc: "Standard workshop pace" },
    FAST: { id: "FAST", ms: 10000, label: "Fast (10s)", emoji: "🏃", desc: "Experienced players — pressure builds" },
    TURBO: { id: "TURBO", ms: 5000, label: "Turbo (5s)", emoji: "🚀", desc: "Expert mode — maximum intensity" },
};

// ─── ADVANCE MODES ───
// MANUAL: NESO clicks to advance each phase (no timer auto-advance)
// AUTO:   Timer-driven — each phase auto-advances after its SIM_SPEED duration
export const ADVANCE_MODES = {
    MANUAL: { id: "MANUAL", label: "Manual", emoji: "🖱️", desc: "Click to advance each phase" },
    AUTO: { id: "AUTO", label: "Automatic", emoji: "⏱️", desc: "Timer auto-advances phases" },
};

// ─── SIM-TIME SPEED PRESETS (AUTO mode only) ───
// Maps 30 sim-minutes (1 phase tick) to real-world seconds.
// Phase durations are multiplied by this factor.
export const SIM_SPEEDS = {
    REALTIME: { id: "REALTIME", factor: 1.0, label: "30min = 30s", emoji: "🐌", desc: "Near real-time pace" },
    RELAXED:  { id: "RELAXED",  factor: 0.5, label: "30min = 15s", emoji: "🐢", desc: "Relaxed workshop pace" },
    NORMAL:   { id: "NORMAL",   factor: 0.33, label: "30min = 10s", emoji: "⚡", desc: "Standard workshop" },
    FAST:     { id: "FAST",     factor: 0.17, label: "30min = 5s",  emoji: "🏃", desc: "Fast-paced workshop" },
    TURBO:    { id: "TURBO",    factor: 0.07, label: "30min = 2s",  emoji: "🚀", desc: "Speed-run demo" },
};

// ─── PER-PHASE TICK DURATIONS (ms) ───
// Server overrides tickSpeed per-phase; these are reference values for UI display.
export const PHASE_DURATIONS = {
    FORECAST_0: 10000,
    DA:         30000,
    FORECAST_1: 10000,
    IDA1:       25000,
    FORECAST_2:  8000,
    IDA2:       25000,
    ID_ROUNDS:  20000,
    BM_OPEN:    15000,
    BM_CLEAR:    5000,
    SP_SETTLED:  5000,
    RESULTS:    20000,
};

// ─── FORGIVENESS MODE (Appendix D.1) ───
export const FORGIVENESS = {
    penaltyMultiplier: 0.25,       // imbalance penalties × 0.25 in tutorial
    freqFailDuration: 15,          // 15s instead of 5s before blackout
    wearMultiplier: 0.5,           // half wear cost
};

// ─── ROOM STATES ───
export const ROOM_STATES = {
    LOBBY: "LOBBY",           // NESO created room, in lobby view
    READY_TO_START: "READY_TO_START",  // All required roles present, can start game
    RUNNING: "RUNNING",       // Game is active
};

// ─── GAME MODES (§4.2 Progressive Difficulty) ───
export const GAME_MODES = {
    TUTORIAL: { id: "TUTORIAL", name: "Tutorial", emoji: "📖", desc: "BM only, 1 asset — learn the physics", markets: ["bm"], multiAsset: false, forgiveness: true },
    INTERMEDIATE: { id: "INTERMEDIATE", name: "Intermediate", emoji: "📈", desc: "BM + Intraday — learn risk correction", markets: ["bm", "id"], multiAsset: false, forgiveness: false },
    FULL: { id: "FULL", name: "Full Game", emoji: "⚡", desc: "DA + IDA + ID + BM — complete market coupling", markets: ["da", "ida1", "ida2", "id", "bm"], multiAsset: false, forgiveness: false },
    ADVANCED: { id: "ADVANCED", name: "Advanced", emoji: "🏆", desc: "Full game + multi-asset portfolios + all roles", markets: ["da", "ida1", "ida2", "id", "bm"], multiAsset: true, forgiveness: false },
};

// ─── INTRADAY MARKET (§3.2) ───
export const ID_WINDOW_MS = 4000;  // intraday trading window (ms within a tick)

// ─── INTRADAY AUCTIONS (EPEX-style) ───
export const IDA_CONFIG = {
    IDA1: {
        name: "Intraday Auction 1",
        forecastErrorReduction: 0.4,
        description: "First intraday auction — updated wind/demand forecast",
    },
    IDA2: {
        name: "Intraday Auction 2",
        forecastErrorReduction: 0.7,
        description: "Second intraday auction — near-delivery accuracy",
    },
};

// ─── GB MARKET PHASE TABLE ───
// Maps each simulation phase to real GB market timing context.
// Display-only metadata — does not change phase advance logic.
//
// Real GB sequence (D-1 / D):
//   FORECAST_0 (D-1 06:00) → DA (D-1 09:20) → FORECAST_1 (post-DA)
//   → IDA1 (D-1 15:30) → FORECAST_2 (D-1 16:30) → IDA2 (D-1 17:30)
//   → ID_ROUNDS (D-1 18:30–D 00:00) → REALTIME (D 00:00–24:00)
//
export const GB_PHASE_TABLE = {
    FORECAST_0: {
        label: "Initial Forecast (06Z NWP)",
        realTime: "D-1 06:00 – 09:20",
        type: "forecast",
        spRange: [1, 48],
        description: "06Z NWP weather run arrives. Full uncertainty — first view of tomorrow's wind, demand, and solar.",
    },
    DA: {
        label: "Day-Ahead Auction",
        realTime: "D-1 09:20 gate close",
        type: "auction",
        spRange: [1, 48],
        description: "Sealed-bid uniform-price auction for all 48 SPs. Batch cleared at gate closure. Blind order book.",
    },
    FORECAST_1: {
        label: "Revised Forecast (12Z NWP + DA Price)",
        realTime: "D-1 09:30 – 15:30",
        type: "forecast",
        spRange: [1, 48],
        description: "12Z weather run + DA clearing price signal. Forecast uncertainty reduced ~40%.",
    },
    IDA1: {
        label: "Intraday Auction 1",
        realTime: "D-1 15:30 gate close",
        type: "auction",
        spRange: [1, 48],
        description: "First intraday auction — correct DA positions using updated forecast. Uniform price, all 48 SPs.",
    },
    FORECAST_2: {
        label: "Short-Range Forecast (D 06Z)",
        realTime: "D-1 16:30 – 17:30",
        type: "forecast",
        spRange: [1, 48],
        description: "Morning-of short-range run. Very sharp — uncertainty reduced ~70%.",
    },
    IDA2: {
        label: "Intraday Auction 2",
        realTime: "D-1 17:30 gate close",
        type: "auction",
        spRange: [25, 48],
        description: "Second intraday auction — near-delivery accuracy. Real GB covers SPs 25-48 only.",
    },
    ID_ROUNDS: {
        label: "Continuous Intraday Trading",
        realTime: "D-1 18:30 – D 00:00",
        type: "continuous",
        spRange: [1, 48],
        description: "Transparent order book, pay-as-bid matching. Trade near-term SPs until gate closure (1h before delivery).",
    },
    REALTIME: {
        label: "Balancing Mechanism (Real-Time)",
        realTime: "D 00:00 – 24:00",
        type: "bm",
        spRange: [1, 48],
        description: "ESO dispatches BM bids/offers to balance the system. Pay-as-bid, merit-order dispatch.",
    },
    RESULTS: {
        label: "Settlement & Scoring",
        realTime: "D+1",
        type: "results",
        spRange: [],
        description: "Final imbalance settlement, P&L, role scores, and leaderboard.",
    },
};

// ─── MARKET TYPE COMPARISON ───
// Educational reference: auction markets vs continuous ID vs BM.
export const MARKET_COMPARISON = [
    { header: "Feature", auction: "DA / IDA1 / IDA2 (Auctions)", continuous: "Continuous ID", bm: "Balancing Mechanism" },
    { header: "Clearing", auction: "Batch clear at gate closure", continuous: "Match immediately", bm: "ESO dispatches merit order" },
    { header: "Visibility", auction: "Blind (sealed bid)", continuous: "Transparent order book", bm: "Blind (ESO sees all)" },
    { header: "Pricing", auction: "Uniform price per SP", continuous: "Pay-as-bid per trade", bm: "Pay-as-bid (own price)" },
    { header: "Scope", auction: "All SPs at once", continuous: "Near-term SPs only", bm: "Current SP only" },
];

// ─── ROLES (§5) ───
export const ROLES = {
    NESO: {
        id: "NESO", name: "System Operator", emoji: "🎯",
        desc: "System Operator & Market Operator — clear DA/ID auctions, manage real-time balancing, dispatch BM. WIN: Keep frequency stable at lowest cost.",
        canOwnAssets: false, canTrade: false, hasDemand: false, isOperator: true, isSystem: true,
        hint: "Your sole job: dispatch BM efficiently. Minimize total SBP+SSP costs while maintaining 50 Hz. Winners dispatch the most value with fewest bids rejected.",
        guide: "As NESO, you clear all markets deterministically by price. Your score reflects market efficiency: how well you balanced supply/demand and what prices you accepted. Study the merit order to find cheap flexibility, and always consider frequency breach risk when calling bids.",
    },
    ELEXON: {
        id: "ELEXON", name: "Elexon", emoji: "📊",
        desc: "Settlement body — calculate imbalance charges, verify metering, reconcile P&L. WIN: Ensure fair settlement.",
        canOwnAssets: false, canTrade: false, hasDemand: false, isSettlement: true,
        hint: "You compute imbalance penalties and settlement reports. Your score reflects accuracy and fairness: all players' cash should sum correctly, with zero 'money creation' errors.",
        guide: "Elexon watches the blockchain of all trades and ensures each player pays/receives the correct amount. Your role is observational. Study the settlement formulas to understand how players earn/lose cash.",
    },
    GENERATOR: {
        id: "GENERATOR", name: "Generator", emoji: "⚡",
        desc: "Produce power — bid into BM. WIN: Maximize revenue by bidding into profitable markets when asked.",
        canOwnAssets: true, canTrade: true, hasDemand: false,
        hint: "Lock a profitable DA price, then use ID/BM to capture upside. Default bid if you think you'll be short at settlement. Higher bids = higher revenue if called, but lower acceptance risk.",
        guide: "Generators win by being profitable at high prices (SBP) while avoiding penalties (SSP). DA gives you a baseline, ID lets you adjust, and BM is your final defense against imbalance.",
    },
    SUPPLIER: {
        id: "SUPPLIER", name: "Supplier", emoji: "🏢",
        desc: "Hedge for retail customers. WIN: Buy cheap power and sell it at profitable retail margins.",
        canOwnAssets: false, canTrade: true, hasDemand: true,
        hint: "You MUST meet demand every SP or pay SSP penalties. Lock coverage in DA, adjust in ID, refine in BM. Worst case: lose margin on retail contracts when wholesale gets expensive.",
        guide: "Suppliers live on margin shrinkage: if wholesale spikes above your retail price, you lose. Hedge by buying DA/ID even if it looks expensive. SSP penalties exceed any margin you earn.",
    },
    TRADER: {
        id: "TRADER", name: "Trader", emoji: "💼",
        desc: "Trade contracts — no physical assets. WIN: Close your position before BM gate closure.",
        canOwnAssets: false, canTrade: true, hasDemand: false, startCapital: 5000, marginFloor: 0,
        hint: "You have no physical assets, so you MUST exit your contract by BM gate or face imbalance penalties. Maximum leverage: use DA as a spread trade, then close in ID.",
        guide: "Traders are market-makers: you profit from spreads, not from being right on direction. DA/ID liquidity attracts you, but BM is a penalty box. Risk: margin call if prices move against you.",
    },
    DSR: {
        id: "DSR", name: "Demand Controller", emoji: "🏗️",
        desc: "Manage load — curtail when profitable. WIN: Curtail only during high-price SPs to maximize revenue.",
        canOwnAssets: true, canTrade: true, hasDemand: true,
        hint: "Curtailing is FREE but triggers a +120% forced rebound next SP. Only worthwhile if this SP's SBP >> next SP's price. Misjudge rebound and you'll lose money.",
        guide: "DSRs win by market timing: curtail when desperation prices (SBP) spike, but avoid rebounding into another spike. Maximum curtail is 1 hour (2 SPs); rebound debt accumulates if you keep curtailing.",
    },
    BESS: {
        id: "BESS", name: "Battery Storage", emoji: "🔋",
        desc: "Charge when cheap, discharge when expensive. WIN: Buy low-cost power, store it, sell high.",
        canOwnAssets: true, canTrade: true, hasDemand: false,
        hint: "Your SoC is your inventory. Lock DA price to define cost base, use ID to optimize, and dispatch in BM when SSP/SBP justify throughput. Efficiency tax: 10% round-trip.",
        guide: "BESS players win through arbitrage: buy DA at £40, discharge in BM at £90 (£50 margin). SoC management is critical: if you're empty when prices spike (short), you lose the bid. If full when they drop (long), you miss charging.",
    },
    INSTRUCTOR: {
        id: "INSTRUCTOR", name: "Instructor", emoji: "🎓",
        desc: "Control game — admin view, never visible to players. WIN: Teach the mechanics through scenarios.",
        canOwnAssets: true, canTrade: false, hasDemand: false,
        hint: "You can pause the game, adjust roles, and select scenarios. Use this to guide discussion and diagnose understanding gaps.",
        guide: "Instructors can freeze the game, reassign roles mid-game, and change scenarios. Ideal for teaching: pause after each phase to discuss the economic incentives players faced.",
    },
};

// ─── SCENARIOS ───
export const SCENARIOS = {
    NORMAL: { id: "NORMAL", name: "Normal Day", emoji: "☀️", col: "#38c0fc", desc: "Standard grid. All assets competitive. Learn the basics.", nivBias: 0, priceMod: 1.0, windMod: 1.0, eventProb: 1.0 },
    WINTER_PEAK: { id: "WINTER_PEAK", name: "Winter Peak", emoji: "🥶", col: "#67e8f9", desc: "Cold snap drives demand up. Grid usually SHORT. Gas & Hydro dominate.", nivBias: -150, priceMod: 1.45, windMod: 0.65, eventProb: 1.3 },
    WIND_GLUT: { id: "WIND_GLUT", name: "Renewables Glut", emoji: "🌬️", col: "#a3e635", desc: "Too much wind & solar. Grid mostly LONG. Batteries charge cheap.", nivBias: +160, priceMod: 0.55, windMod: 1.85, eventProb: 0.8 },
    DUNKELFLAUTE: { id: "DUNKELFLAUTE", name: "Dunkelflaute Week", emoji: "🌑", col: "#f0455a", desc: "Dark doldrums — no wind, no sun. Only thermal can serve demand.", nivBias: -220, priceMod: 1.90, windMod: 0.04, eventProb: 0.6 },
    SPIKE: { id: "SPIKE", name: "Scarcity Event", emoji: "🚀", col: "#f5b222", desc: "Multiple plant trips. Prices spike. Timing your asset is everything.", nivBias: -180, priceMod: 2.20, windMod: 0.50, eventProb: 2.0 },
};

// ─── ASSETS ───
export const ASSETS = {
    BESS_S: {
        key: "BESS_S", name: "Small BESS", short: "Mini Battery", emoji: "🔋", col: "#1de98b", tier: "STARTER",
        maxMW: 15, maxMWh: 30, startSoC: 50, eff: 0.92, wear: 4, kind: "soc", sides: "both",
        minMw: 0, rampRate: 15, startupTime: 0, startupCost: 0, varCost: 0, fuelType: "battery",
        pros: ["Easy SoC", "Low wear", "Good for learning"], cons: ["Low MW", "Fills fast"],
        desc: "15MW/30MWh entry-level battery. Low risk, low reward. Perfect for learning the basics."
    },
    BESS_M: {
        key: "BESS_M", name: "Grid BESS", short: "Grid Battery", emoji: "⚡", col: "#38c0fc", tier: "STANDARD",
        maxMW: 50, maxMWh: 100, startSoC: 50, eff: 0.90, wear: 8, kind: "soc", sides: "both",
        minMw: 0, rampRate: 50, startupTime: 0, startupCost: 0, varCost: 0, fuelType: "battery",
        pros: ["Balanced", "Both directions", "Proven revenue"], cons: ["Moderate wear cost"],
        desc: "50MW/100MWh — the benchmark BESS. Versatile and well understood by all market participants."
    },
    BESS_L: {
        key: "BESS_L", name: "Mega BESS", short: "Mega Battery", emoji: "🏭", col: "#b78bfa", tier: "ADVANCED",
        maxMW: 100, maxMWh: 400, startSoC: 50, eff: 0.87, wear: 13, kind: "soc", sides: "both",
        minMw: 0, rampRate: 100, startupTime: 0, startupCost: 0, varCost: 0, fuelType: "battery",
        pros: ["Huge potential", "Deep reserves", "Dominates merit order"], cons: ["£13/MWh wear", "Complex SoC"],
        desc: "100MW/400MWh — massive. Can swing an entire market clearing. Wear is punishing if mis-operated."
    },
    HYDRO: {
        key: "HYDRO", name: "Pumped Hydro", short: "Pumped Hydro", emoji: "💧", col: "#67e8f9", tier: "ADVANCED",
        maxMW: 120, maxMWh: 720, startSoC: 65, eff: 0.76, wear: 1.5, kind: "soc", sides: "both",
        minMw: 0, rampRate: 60, startupTime: 0, startupCost: 0, varCost: 0, fuelType: "water",
        pros: ["Massive capacity", "Tiny wear", "Dominant when full"], cons: ["76% efficiency", "Slow refill"],
        desc: "120MW/720MWh pumped storage. Nearly free to operate, but round-trip efficiency is only 76%."
    },
    OCGT: {
        key: "OCGT", name: "Gas Peaker", short: "OCGT", emoji: "🔥", col: "#f0455a", tier: "ADVANCED",
        maxMW: 150, fuelMWh: 600, startFuel: 600, wear: 0, kind: "fuel", sides: "short",
        minMw: 40, rampRate: 30, startupTime: 1, startupCost: 3500, varCost: 85, fuelType: "gas",
        cmPayment: 750, // £ per SP for capacity availability
        pros: ["Fast start", "Earns most in scarcity"], cons: ["Finite fuel", "Expensive to start & run"],
        desc: "150MW open-cycle gas peaker. Starts in roughly 30 mins (1 SP). Expensive fuel."
    },
    CCGT: {
        key: "CCGT", name: "Combined Cycle Gas", short: "CCGT", emoji: "🏭", col: "#fb923c", tier: "ADVANCED",
        maxMW: 450, fuelMWh: 999999, startFuel: 999999, wear: 0, kind: "fuel", sides: "short",
        minMw: 180, rampRate: 15, startupTime: 2, startupCost: 12000, varCost: 65, fuelType: "gas",
        cmPayment: 2250, // £ per SP
        pros: ["Huge baseload", "Efficient fuel"], cons: ["Slow 1-hour start", "High minimum stable gen"],
        desc: "450MW Combined Cycle Gas Turbine. Slow to start, but cheap variable cost once online."
    },
    NUCLEAR: {
        key: "NUCLEAR", name: "Nuclear Plant", short: "Nuclear", emoji: "☢️", col: "#34d399", tier: "ADVANCED",
        maxMW: 1000, fuelMWh: 999999, startFuel: 999999, wear: 0, kind: "fuel", sides: "short",
        minMw: 700, rampRate: 5, startupTime: 6, startupCost: 50000, varCost: 10, fuelType: "uranium",
        cmPayment: 5000, // £ per SP
        pros: ["Massive baseload", "Very cheap fuel"], cons: ["3-hour start", "Inflexible", "Huge min stable"],
        desc: "1000MW Nuclear Reactor. Takes ~3 hours (6 SPs) to start, ramps slowly, prefers constant output."
    },
    DSR: {
        key: "DSR", name: "Demand Response", short: "Flex Load", emoji: "🏗️", col: "#f5b222", tier: "STANDARD",
        maxMW: 65, wear: 0, kind: "dsr", sides: "both",
        minMw: 0, rampRate: 65, startupTime: 0, startupCost: 0, varCost: 0, fuelType: "none",
        maxCurtailDuration: 2, reboundMultiplier: 1.2, reboundDuration: 1, // DSR Physics
        pros: ["No energy limits", "Zero wear", "High availability"], cons: ["Forced Rebound Penalty", "Max 1hr duration"],
        desc: "65MW industrial flex load. Can curtail for max 1 hour (2 SPs) before triggering a forced +120% rebound."
    },
    WIND: {
        key: "WIND", name: "Offshore Wind", short: "Wind Farm", emoji: "🌬️", col: "#a3e635", tier: "STANDARD",
        maxMW: 120, wear: 0, kind: "wind", sides: "short",
        minMw: 0, rampRate: 120, startupTime: 0, startupCost: 0, varCost: 0, fuelType: "weather",
        strikePrice: 50, // £/MWh CfD strike price
        pros: ["Zero marginal cost", "Front of merit order"], cons: ["Output depends on weather"],
        desc: "120MW offshore wind. Near-zero cost, but maximum output is defined entirely by wind conditions."
    },
    SOLAR: {
        key: "SOLAR", name: "Solar Farm", short: "Solar", emoji: "☀️", col: "#fde047", tier: "STANDARD",
        maxMW: 80, wear: 0, kind: "solar", sides: "short",
        minMw: 0, rampRate: 80, startupTime: 0, startupCost: 0, varCost: 0, fuelType: "weather",
        strikePrice: 45, // £/MWh CfD strike price
        pros: ["Zero marginal cost", "Predictable curve"], cons: ["Only produces during daytime"],
        desc: "80MW solar farm. Highest output around midday, drops to zero at night."
    },
    IC_IFA: {
        key: "IC_IFA", name: "IFA (France)", short: "IFA", emoji: "⚡", col: "#8b5cf6", tier: "ADVANCED",
        maxMW: 2000, wear: 0, kind: "interconnector", sides: "both",
        minMw: 0, rampRate: 500, startupTime: 0, startupCost: 0, varCost: 0, fuelType: "none",
        lossFactor: 0.03, foreignPriceKey: "priceFR",
        pros: ["2000MW baseload", "Tied to stable nuclear pricing"], cons: ["Vulnerable to French fleet outages", "3% heat loss"],
        desc: "2000MW HVDC link to France. Imports stable nuclear baseload, but flow reverses if France peaks."
    },
    IC_NSL: {
        key: "IC_NSL", name: "North Sea Link (Norway)", short: "NSL", emoji: "⚡", col: "#38c0fc", tier: "ADVANCED",
        maxMW: 1400, wear: 0, kind: "interconnector", sides: "both",
        minMw: 0, rampRate: 350, startupTime: 0, startupCost: 0, varCost: 0, fuelType: "none",
        lossFactor: 0.03, foreignPriceKey: "priceNO",
        pros: ["Acts like a massive battery", "Seasonal arbitrage"], cons: ["Hydro reservoir limits"],
        desc: "1400MW HVDC link to Norway. Imports Nordic hydro storage when GB is tight; exports when GB wind overgenerates."
    },
    IC_BRITNED: {
        key: "IC_BRITNED", name: "BritNed (Netherlands)", short: "BritNed", emoji: "⚡", col: "#f5b222", tier: "ADVANCED",
        maxMW: 1000, wear: 0, kind: "interconnector", sides: "both",
        minMw: 0, rampRate: 250, startupTime: 0, startupCost: 0, varCost: 0, fuelType: "none",
        lossFactor: 0.03, foreignPriceKey: "priceNL",
        pros: ["Strong price volatility", "Tight European gas coupling"], cons: ["Tracks European gas curves exactly"],
        desc: "1000MW HVDC link to the Netherlands. Flows rapidly flip based on minute-to-minute European gas/power spreads."
    },
    IC_VIKING: {
        key: "IC_VIKING", name: "Viking Link (Denmark)", short: "Viking", emoji: "⚡", col: "#1de98b", tier: "ADVANCED",
        maxMW: 1400, wear: 0, kind: "interconnector", sides: "both",
        minMw: 0, rampRate: 350, startupTime: 0, startupCost: 0, varCost: 0, fuelType: "none",
        lossFactor: 0.03, foreignPriceKey: "priceDK",
        pros: ["Correlated to global wind fronts"], cons: ["Danish wind crashes at the same time as UK wind"],
        desc: "1400MW HVDC link to Denmark. Highly correlated with wind availability across the Nordic and German grids."
    }
};

// ─── SUPPLIERS (Real UK Retail Companies) ───
export const SUPPLIERS = {
    BRITISH_GAS: {
        key: "BRITISH_GAS", name: "British Gas", short: "BG", emoji: "🔵", col: "#3b82f6",
        portfolioMw: 1800, customers: "~7M homes", hedgeHorizon: "12–24 months",
        riskAppetite: "LOW", forecastErrorPct: 0.04, retailTariff: 150, // £/MWh fixed
        pros: ["Very large base", "Heavily pre-hedged"], cons: ["Slow to react", "Low upside"],
        desc: "UK's largest residential supplier. Conservative hedging strategy. Low imbalance exposure but low margin upside."
    },
    OCTOPUS: {
        key: "OCTOPUS", name: "Octopus Energy", short: "Octopus", emoji: "🟣", col: "#a855f7",
        portfolioMw: 1200, customers: "~5M homes", hedgeHorizon: "3–12 months",
        riskAppetite: "HIGH", forecastErrorPct: 0.06, retailTariff: 140,
        pros: ["Agile pricing", "Smart tariff innovation"], cons: ["Higher imbalance risk", "Volatile margin"],
        desc: "Fast-growing tech-driven supplier. Aggressive short-horizon hedging. Higher risk appetite but can exploit flexibility."
    },
    EDF: {
        key: "EDF", name: "EDF Energy", short: "EDF", emoji: "🟡", col: "#eab308",
        portfolioMw: 1500, customers: "~5M homes", hedgeHorizon: "12–24 months",
        riskAppetite: "MEDIUM", forecastErrorPct: 0.05, retailTariff: 145,
        pros: ["Self-hedged via nuclear gen", "Stable margin"], cons: ["Less flexible"],
        desc: "Vertically integrated — owns nuclear generation. Natural hedge against wholesale spikes. Moderate risk profile."
    },
    OVO: {
        key: "OVO", name: "OVO Energy", short: "OVO", emoji: "🟢", col: "#22c55e",
        portfolioMw: 900, customers: "~4M homes", hedgeHorizon: "6–12 months",
        riskAppetite: "MEDIUM", forecastErrorPct: 0.05, retailTariff: 148,
        pros: ["Data-driven", "Smart meter penetration"], cons: ["Medium wholesale exposure"],
        desc: "Major challenger supplier. Acquired SSE retail customers. Data-driven demand forecasting reduces error."
    },
    SCOTTISH_POWER: {
        key: "SCOTTISH_POWER", name: "Scottish Power", short: "ScotPow", emoji: "🔴", col: "#ef4444",
        portfolioMw: 1100, customers: "~3M homes", hedgeHorizon: "12 months",
        riskAppetite: "MEDIUM", forecastErrorPct: 0.05, retailTariff: 146,
        pros: ["Strong renewable PPAs", "Iberdrola backing"], cons: ["Wind-dependent hedging"],
        desc: "Owned by Iberdrola. Heavy renewable PPA portfolio. Naturally hedged when wind is high, exposed when wind drops."
    }
};
// ─── EVENTS ───
export const EVENTS = [
    { id: "TRIP", name: "Generator Trip", emoji: "⚡", col: "#f0455a", niv: -280, pd: +45, prob: .06, desc: "Large plant tripped — emergency generation needed" },
    { id: "WIND_UP", name: "Wind Surge", emoji: "🌬", col: "#1de98b", niv: +200, pd: -18, prob: .08, desc: "Wind surged — excess generation across GB" },
    { id: "DMD_HI", name: "Demand Spike", emoji: "📈", col: "#f0455a", niv: -140, pd: +18, prob: .09, desc: "Demand higher than forecast" },
    { id: "DMD_LO", name: "Demand Drop", emoji: "📉", col: "#1de98b", niv: +120, pd: -14, prob: .07, desc: "Demand lower than forecast — grid long" },
    { id: "DUNKEL", name: "DUNKELFLAUTE", emoji: "🌑", col: "#f0455a", niv: -350, pd: +65, prob: .03, desc: "No wind, no sun — all thermal must fire!" },
    { id: "COLD", name: "Cold Snap", emoji: "🥶", col: "#f0455a", niv: -200, pd: +35, prob: .04, desc: "Heating demand surging across GB" },
    { id: "INTERCON", name: "Interconnector On", emoji: "🔌", col: "#1de98b", niv: +180, pd: -22, prob: .05, desc: "IFA2 ramps up — cheap imports arriving" },
    { id: "CASCADE", name: "Cascade Trip", emoji: "💥", col: "#f0455a", niv: -420, pd: +80, prob: .02, desc: "Multiple generators offline!" },
    { id: "SPIKE", name: "Price Spike", emoji: "🚀", col: "#f5b222", niv: -250, pd: +90, prob: .02, desc: "Scarcity pricing — LOLP multiplier active!" },
    { id: "WIND_LOW", name: "Wind Drop", emoji: "💨", col: "#f0455a", niv: -180, pd: +22, prob: .10, desc: "Wind fell sharply — grid needs more generation" },
];



// ─── TUTORIAL STEPS (§9.1) ───
export const TUTORIAL_STEPS = [
    { id: "welcome", target: null, title: "Welcome to GridForge!", body: "You're about to operate a power asset on the GB electricity grid. Let's learn the basics.", emoji: "⚡" },
    { id: "grid", target: "grid-signal", title: "Grid Signal", body: "The grid is either SHORT (needs power) or LONG (has excess). Watch the NIV indicator.", emoji: "📊" },
    { id: "asset", target: "asset-panel", title: "Your Asset", body: "This panel shows your asset's status — power capacity, energy stored, and wear cost.", emoji: "🔋" },
    { id: "bid", target: "bid-area", title: "Submit a Bid", body: "Set your price and MW volume, then submit. The Smart button auto-suggests a competitive price.", emoji: "💰" },
    { id: "merit", target: "merit-order", title: "Merit Order", body: "Bids are stacked cheapest-first. The last accepted bid sets the clearing price for ALL.", emoji: "📈" },
    { id: "result", target: "result-area", title: "Settlement", body: "After each SP, you see if your bid was accepted and how much you earned. Keep an eye on your P&L!", emoji: "🏆" },
    { id: "forecast", target: "forecast", title: "Forecasts", body: "Look ahead! The forecast strip shows predicted NIV and prices for the next 4 settlement periods.", emoji: "🔮" },
];

// ─── SCORING CONFIG (Game Logic — 4-Layer Scoring) ───
export const SCORING_CONFIG = {
    alpha: 0.6,                 // OverallScore = alpha × RoleScore + (1-alpha) × SystemScore
    consistencyPenalty: 0.1,    // Multi-round: FinalScore = mean - penalty × std
    stressNIVThreshold: 300,    // |NIV| above this = stress event

    // ── Role-specific threshold tables ──
    // breakpoints: [[inputValue, outputScore], ...] — used by mapThreshold for piecewise linear interpolation

    TRADER: {
        breakpoints: [[-1000, 10], [0, 30], [0.5, 50], [1, 70], [1.5, 85], [2, 100]],
        marginPenalty: 10,      // points lost per margin event
        primaryWeight: 0.85,
    },
    GENERATOR: {
        breakpoints: [[-500, 0], [0, 20], [100, 50], [400, 70], [700, 85], [1000, 100]],
        primaryWeight: 0.80,
    },
    BESS: {
        breakpoints: [[0, 20], [50, 50], [100, 70], [150, 85], [200, 100]],
        primaryWeight: 0.75,
    },
    SUPPLIER: {
        // Inverted: lower cost = higher score (breakpoints sorted ascending by input)
        breakpoints: [[40, 100], [50, 80], [65, 60], [80, 40], [100, 10]],
        primaryWeight: 0.80,
    },
    DSR: {
        breakpoints: [[-500, 0], [0, 20], [50, 50], [100, 70], [150, 85], [200, 100]],
        primaryWeight: 0.80,
    },
    NESO: {
        // Combined System Operator + Market Operator scoring
        stabilityWeight: 0.40,   // Real-time balancing: avg |NIV|
        costWeight: 0.20,        // Market clearing efficiency: total system cost
        maeWeight: 0.15,         // Forecast accuracy
        clearingWeight: 0.25,    // Market clearing quality: price volatility, participation
    },
    ELEXON: {
        // Settlement accuracy scoring
        accuracyWeight: 0.50,    // Settlement accuracy: correct imbalance calculations
        timelinessWeight: 0.30,  // Timeliness: settlements processed promptly
        transparencyWeight: 0.20, // Transparency: clear audit trail
    },
};
