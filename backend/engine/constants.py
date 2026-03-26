"""
GridForge constants — Python port of src/shared/constants.js

Every magic number, asset definition, scenario, role, and scoring
config lives here so the server engine is the single source of truth.
"""

from __future__ import annotations

# ─── TIMING ───
TICK_MS = 15_000
MIN_SOC = 10
MAX_SOC = 90
DA_CYCLE = 6
DA_MS = 9_000

# ─── SETTLEMENT PERIOD UNITS ───
SP_DURATION_H = 0.5
SPS_PER_DAY = 48

# ─── GRID FAILURE ───
FREQ_FAIL_LO = 49.5
FREQ_FAIL_HI = 50.5
FREQ_FAIL_DURATION = 5

# ─── SYSTEM PARAMETERS ───
SYSTEM_PARAMS = {
    "baseDemandGW": 35,
    "maxWindGW": 12,
    "freqNominal": 50.0,
    "freqBandLow": 49.8,
    "freqBandHigh": 50.2,
    "reserveMarginThreshold": 15,
    "dcCapacityMW": 500,
    "freqResponseCapacityMW": 75,
    "VoLL": 6000,
    "interconnectorFlows": {
        "IFA": 2.0,
        "NSL": 1.4,
        "BRITNED": 1.0,
        "VIKING": 1.4,
    },
    "traderStartCapitalBonus": 5000,
    "marginWarningThreshold": 1000,
    "bidStrategyMultipliers": {
        "genBM": {"sbpMultiplier": 0.8, "sspMultiplier": 1.2},
        "bessBM": {"sbpMultiplier": 0.8, "sspMultiplier": 1.2},
        "dsrBM": {"sspMultiplier": 0.8, "sbpMultiplier": 1.5},
        "icBM": {"sbpMultiplier": 0.8, "sspMultiplier": 1.2},
    },
    "mapProjection": {"scale": 2200, "centerLon": -2, "centerLat": 54.3},
}

# ─── TICK SPEED PRESETS ───
TICK_SPEEDS = {
    "SLOW": {"id": "SLOW", "ms": 30000, "label": "Slow (30s)"},
    "NORMAL": {"id": "NORMAL", "ms": 15000, "label": "Normal (15s)"},
    "FAST": {"id": "FAST", "ms": 10000, "label": "Fast (10s)"},
    "TURBO": {"id": "TURBO", "ms": 5000, "label": "Turbo (5s)"},
}

# ─── PER-PHASE TICK DURATIONS (ms) ───
# Overrides the room-level tickSpeed when the engine enters each phase.
# Forecast phases are quick (players just read); trading phases give more
# time for bids; BM per-SP ticks are short to keep REALTIME snappy.
# A multiplier is applied to the room's TICK_SPEED preset, so Instructor
# speed selection (SLOW / NORMAL / FAST / TURBO) still scales everything.
PHASE_DURATIONS = {
    "FORECAST_0": 10_000,   # 10s — read initial forecast
    "DA":         30_000,   # 30s — submit DA bids/curves
    "FORECAST_1": 10_000,   # 10s — read revised forecast
    "IDA1":       25_000,   # 25s — adjust positions
    "FORECAST_2":  8_000,   #  8s — final forecast update
    "IDA2":       25_000,   # 25s — near-delivery auction
    "ID_ROUNDS":  20_000,   # 20s per ID sub-round
    "BM_OPEN":    15_000,   # 15s — submit BM bids
    "BM_CLEAR":    5_000,   #  5s — view clearing result
    "SP_SETTLED":  5_000,   #  5s — settlement display
    "RESULTS":    20_000,   # 20s — review scores
}

# ─── ADVANCE MODES ───
# "MANUAL" — NESO/Instructor clicks button to advance each phase (no auto timer)
# "AUTO"   — Timer auto-advances phases based on PHASE_DURATIONS × simSpeedFactor
ADVANCE_MODES = ("MANUAL", "AUTO")

# ─── SIM-TIME SPEED PRESETS (AUTO mode only) ───
# factor: multiplier on PHASE_DURATIONS base tick. Lower = faster.
SIM_SPEEDS = {
    "REALTIME": {"id": "REALTIME", "factor": 1.0,  "label": "30min = 30s"},
    "RELAXED":  {"id": "RELAXED",  "factor": 0.5,  "label": "30min = 15s"},
    "NORMAL":   {"id": "NORMAL",   "factor": 0.33, "label": "30min = 10s"},
    "FAST":     {"id": "FAST",     "factor": 0.17, "label": "30min = 5s"},
    "TURBO":    {"id": "TURBO",    "factor": 0.07, "label": "30min = 2s"},
}

# ─── FORGIVENESS MODE ───
FORGIVENESS = {
    "penaltyMultiplier": 0.25,
    "freqFailDuration": 15,
    "wearMultiplier": 0.5,
}

# ─── CASHOUT MODE ───
# "single" = post-P305 (2015+): SBP ≈ SSP ≈ marginal balancing cost.
#            Long/short parties face the same imbalance price.
# "dual"   = pre-2015: SBP > SSP. Shorts pay more, longs receive less.
#            Creates asymmetric risk → stronger incentive to balance.
CASHOUT_MODE = "single"

# ─── ROOM STATES ───
ROOM_STATES = {
    "LOBBY": "LOBBY",
    "READY_TO_START": "READY_TO_START",
    "RUNNING": "RUNNING",
}

# ─── GAME MODES ───
GAME_MODES = {
    "TUTORIAL": {
        "id": "TUTORIAL", "name": "Tutorial",
        "markets": ["bm"], "multiAsset": False, "forgiveness": True,
    },
    "INTERMEDIATE": {
        "id": "INTERMEDIATE", "name": "Intermediate",
        "markets": ["bm", "id"], "multiAsset": False, "forgiveness": False,
    },
    "FULL": {
        "id": "FULL", "name": "Full Game",
        "markets": ["da", "ida1", "ida2", "id", "bm"], "multiAsset": False, "forgiveness": False,
    },
    "ADVANCED": {
        "id": "ADVANCED", "name": "Advanced",
        "markets": ["da", "ida1", "ida2", "id", "bm"], "multiAsset": True, "forgiveness": False,
    },
}

# ─── INTRADAY MARKET ───
ID_WINDOW_MS = 4000

# ─── INTRADAY AUCTIONS (EPEX-style) ───
# IDA1: first intraday auction — updated forecast, adjust DA positions
# IDA2: second intraday auction — closer to delivery, tighter spreads
# These are sealed-bid uniform-price auctions (like DA) but with
# progressively more accurate forecasts.
IDA_CONFIG = {
    "IDA1": {
        "name": "Intraday Auction 1",
        "forecastErrorReduction": 0.4,   # 40% of DA forecast error removed
        "description": "First intraday auction — updated wind/demand forecast",
    },
    "IDA2": {
        "name": "Intraday Auction 2",
        "forecastErrorReduction": 0.7,   # 70% of DA forecast error removed
        "description": "Second intraday auction — near-delivery accuracy",
    },
}

# ─── GB MARKET PHASE TABLE ───
# Maps each simulation phase to real GB market timing context.
# Display-only metadata — does not change phase advance logic.
#
# Real GB sequence (D-1 / D):
#   FORECAST_0 (D-1 06:00) → DA (D-1 09:20) → FORECAST_1 (post-DA)
#   → IDA1 (D-1 15:30) → FORECAST_2 (D-1 16:30) → IDA2 (D-1 17:30)
#   → ID_ROUNDS (D-1 18:30–D 00:00) → REALTIME (D 00:00–24:00)
#
GB_PHASE_TABLE = {
    "FORECAST_0": {
        "label": "Initial Forecast (06Z NWP)",
        "realTime": "D-1 06:00 – 09:20",
        "type": "forecast",
        "spRange": [1, 48],
        "description": "06Z NWP weather run arrives. Full uncertainty — first view of tomorrow's wind, demand, and solar.",
    },
    "DA": {
        "label": "Day-Ahead Auction",
        "realTime": "D-1 09:20 gate close",
        "type": "auction",
        "spRange": [1, 48],
        "description": "Sealed-bid uniform-price auction for all 48 SPs. Batch cleared at gate closure. Blind order book.",
    },
    "FORECAST_1": {
        "label": "Revised Forecast (12Z NWP + DA Price)",
        "realTime": "D-1 09:30 – 15:30",
        "type": "forecast",
        "spRange": [1, 48],
        "description": "12Z weather run + DA clearing price signal. Forecast uncertainty reduced ~40%.",
    },
    "IDA1": {
        "label": "Intraday Auction 1",
        "realTime": "D-1 15:30 gate close",
        "type": "auction",
        "spRange": [1, 48],
        "description": "First intraday auction — correct DA positions using updated forecast. Uniform price, all 48 SPs.",
    },
    "FORECAST_2": {
        "label": "Short-Range Forecast (D 06Z)",
        "realTime": "D-1 16:30 – 17:30",
        "type": "forecast",
        "spRange": [1, 48],
        "description": "Morning-of short-range run. Very sharp — uncertainty reduced ~70%.",
    },
    "IDA2": {
        "label": "Intraday Auction 2",
        "realTime": "D-1 17:30 gate close",
        "type": "auction",
        "spRange": [25, 48],
        "description": "Second intraday auction — near-delivery accuracy. Real GB covers SPs 25-48 only.",
    },
    "ID_ROUNDS": {
        "label": "Continuous Intraday Trading",
        "realTime": "D-1 18:30 – D 00:00",
        "type": "continuous",
        "spRange": [1, 48],
        "description": "Transparent order book, pay-as-bid matching. Trade near-term SPs until gate closure (1h before delivery).",
    },
    "REALTIME": {
        "label": "Balancing Mechanism (Real-Time)",
        "realTime": "D 00:00 – 24:00",
        "type": "bm",
        "spRange": [1, 48],
        "description": "ESO dispatches BM bids/offers to balance the system. Pay-as-bid, merit-order dispatch.",
    },
    "RESULTS": {
        "label": "Settlement & Scoring",
        "realTime": "D+1",
        "type": "results",
        "spRange": [],
        "description": "Final imbalance settlement, P&L, role scores, and leaderboard.",
    },
}

# ─── MARKET TYPE COMPARISON ───
# Educational reference: auction markets vs continuous ID.
MARKET_COMPARISON = {
    "auctions": {
        "markets": ["DA", "IDA1", "IDA2"],
        "clearing": "Batch clear at gate closure",
        "visibility": "Blind (sealed bid, no order book)",
        "pricing": "Uniform price per SP",
        "scope": "All SPs at once (or remaining)",
    },
    "continuous": {
        "markets": ["ID_ROUNDS"],
        "clearing": "Match immediately on submission",
        "visibility": "Transparent order book",
        "pricing": "Pay-as-bid per trade",
        "scope": "Only near-term SPs (before gate closure)",
    },
    "bm": {
        "markets": ["REALTIME"],
        "clearing": "ESO dispatches merit order per SP",
        "visibility": "Blind (ESO sees all, players see own)",
        "pricing": "Pay-as-bid (accepted at own price)",
        "scope": "Current SP only",
    },
}


def gate_closure_simtime(sp: int) -> int:
    """GB Gate Closure: 1 hour before SP delivery start.

    SP n starts at simtime 2880 + (n-1)*30.
    Gate closes 60 sim-minutes before that.
    """
    return 2880 + (sp - 1) * 30 - 60


# ─── ROLES ───
ROLES = {
    "NESO": {
        "id": "NESO", "name": "System Operator",
        "canOwnAssets": False, "canTrade": False, "hasDemand": False,
        "isOperator": True, "isSystem": True,
    },
    "ELEXON": {
        "id": "ELEXON", "name": "Elexon",
        "canOwnAssets": False, "canTrade": False, "hasDemand": False,
        "isSettlement": True, "isSystem": True,
    },
    "GENERATOR": {
        "id": "GENERATOR", "name": "Generator",
        "canOwnAssets": True, "canTrade": True, "hasDemand": False,
    },
    "SUPPLIER": {
        "id": "SUPPLIER", "name": "Supplier",
        "canOwnAssets": False, "canTrade": True, "hasDemand": True,
    },
    "TRADER": {
        "id": "TRADER", "name": "Trader",
        "canOwnAssets": False, "canTrade": True, "hasDemand": False,
        "startCapital": 5000, "marginFloor": 0,
    },
    "DSR": {
        "id": "DSR", "name": "Demand Controller",
        "canOwnAssets": True, "canTrade": True, "hasDemand": True,
    },
    "BESS": {
        "id": "BESS", "name": "Battery Storage",
        "canOwnAssets": True, "canTrade": True, "hasDemand": False,
    },
    "INSTRUCTOR": {
        "id": "INSTRUCTOR", "name": "Instructor",
        "canOwnAssets": True, "canTrade": False, "hasDemand": False,
    },
}

# ─── SCENARIOS ───
SCENARIOS = {
    "NORMAL": {"id": "NORMAL", "name": "Normal Day", "nivBias": 0, "priceMod": 1.0, "windMod": 1.0, "eventProb": 1.0},
    "WINTER_PEAK": {"id": "WINTER_PEAK", "name": "Winter Peak", "nivBias": -150, "priceMod": 1.45, "windMod": 0.65, "eventProb": 1.3},
    "WIND_GLUT": {"id": "WIND_GLUT", "name": "Renewables Glut", "nivBias": 160, "priceMod": 0.55, "windMod": 1.85, "eventProb": 0.8},
    "DUNKELFLAUTE": {"id": "DUNKELFLAUTE", "name": "Dunkelflaute Week", "nivBias": -220, "priceMod": 1.90, "windMod": 0.04, "eventProb": 0.6},
    "SPIKE": {"id": "SPIKE", "name": "Scarcity Event", "nivBias": -180, "priceMod": 2.20, "windMod": 0.50, "eventProb": 2.0},
}

# ─── ASSETS ───
ASSETS: dict[str, dict] = {
    "BESS_S": {
        "key": "BESS_S", "name": "Small BESS", "short": "Mini Battery", "col": "#1de98b",
        "maxMW": 15, "maxMWh": 30, "startSoC": 50, "eff": 0.92, "wear": 4,
        "kind": "soc", "sides": "both",
        "minMw": 0, "rampRate": 15, "startupTime": 0, "startupCost": 0, "varCost": 0, "fuelType": "battery",
    },
    "BESS_M": {
        "key": "BESS_M", "name": "Grid BESS", "short": "Grid Battery", "col": "#38c0fc",
        "maxMW": 50, "maxMWh": 100, "startSoC": 50, "eff": 0.90, "wear": 8,
        "kind": "soc", "sides": "both",
        "minMw": 0, "rampRate": 50, "startupTime": 0, "startupCost": 0, "varCost": 0, "fuelType": "battery",
    },
    "BESS_L": {
        "key": "BESS_L", "name": "Mega BESS", "short": "Mega Battery", "col": "#b78bfa",
        "maxMW": 100, "maxMWh": 400, "startSoC": 50, "eff": 0.87, "wear": 13,
        "kind": "soc", "sides": "both",
        "minMw": 0, "rampRate": 100, "startupTime": 0, "startupCost": 0, "varCost": 0, "fuelType": "battery",
    },
    "HYDRO": {
        "key": "HYDRO", "name": "Pumped Hydro", "short": "Pumped Hydro", "col": "#67e8f9",
        "maxMW": 120, "maxMWh": 720, "startSoC": 65, "eff": 0.76, "wear": 1.5,
        "kind": "soc", "sides": "both",
        "minMw": 0, "rampRate": 60, "startupTime": 0, "startupCost": 0, "varCost": 0, "fuelType": "water",
    },
    "OCGT": {
        "key": "OCGT", "name": "Gas Peaker", "short": "OCGT", "col": "#f0455a",
        "maxMW": 150, "fuelMWh": 600, "startFuel": 600, "wear": 0,
        "kind": "fuel", "sides": "short",
        "minMw": 40, "rampRate": 30, "startupTime": 1, "startupCost": 3500, "varCost": 85, "fuelType": "gas",
        "cmPayment": 750,
    },
    "CCGT": {
        "key": "CCGT", "name": "Combined Cycle Gas", "short": "CCGT", "col": "#fb923c",
        "maxMW": 450, "fuelMWh": 999999, "startFuel": 999999, "wear": 0,
        "kind": "fuel", "sides": "short",
        "minMw": 180, "rampRate": 15, "startupTime": 2, "startupCost": 12000, "varCost": 65, "fuelType": "gas",
        "cmPayment": 2250,
    },
    "NUCLEAR": {
        "key": "NUCLEAR", "name": "Nuclear Plant", "short": "Nuclear", "col": "#34d399",
        "maxMW": 1000, "fuelMWh": 999999, "startFuel": 999999, "wear": 0,
        "kind": "fuel", "sides": "short",
        "minMw": 700, "rampRate": 5, "startupTime": 6, "startupCost": 50000, "varCost": 10, "fuelType": "uranium",
        "cmPayment": 5000,
    },
    "DSR": {
        "key": "DSR", "name": "Demand Response", "short": "Flex Load", "col": "#f5b222",
        "maxMW": 65, "wear": 0, "kind": "dsr", "sides": "both",
        "minMw": 0, "rampRate": 65, "startupTime": 0, "startupCost": 0, "varCost": 0, "fuelType": "none",
        "maxCurtailDuration": 2, "reboundMultiplier": 1.2, "reboundDuration": 1,
    },
    "WIND": {
        "key": "WIND", "name": "Offshore Wind", "short": "Wind Farm", "col": "#a3e635",
        "maxMW": 120, "wear": 0, "kind": "wind", "sides": "short",
        "minMw": 0, "rampRate": 120, "startupTime": 0, "startupCost": 0, "varCost": 0, "fuelType": "weather",
        "strikePrice": 50,
    },
    "SOLAR": {
        "key": "SOLAR", "name": "Solar Farm", "short": "Solar", "col": "#fde047",
        "maxMW": 80, "wear": 0, "kind": "solar", "sides": "short",
        "minMw": 0, "rampRate": 80, "startupTime": 0, "startupCost": 0, "varCost": 0, "fuelType": "weather",
        "strikePrice": 45,
    },
    "IC_IFA": {
        "key": "IC_IFA", "name": "IFA (France)", "short": "IFA", "col": "#8b5cf6",
        "maxMW": 2000, "wear": 0, "kind": "interconnector", "sides": "both",
        "minMw": 0, "rampRate": 500, "startupTime": 0, "startupCost": 0, "varCost": 0, "fuelType": "none",
        "lossFactor": 0.03, "foreignPriceKey": "priceFR",
    },
    "IC_NSL": {
        "key": "IC_NSL", "name": "North Sea Link (Norway)", "short": "NSL", "col": "#38c0fc",
        "maxMW": 1400, "wear": 0, "kind": "interconnector", "sides": "both",
        "minMw": 0, "rampRate": 350, "startupTime": 0, "startupCost": 0, "varCost": 0, "fuelType": "none",
        "lossFactor": 0.03, "foreignPriceKey": "priceNO",
    },
    "IC_BRITNED": {
        "key": "IC_BRITNED", "name": "BritNed (Netherlands)", "short": "BritNed", "col": "#f5b222",
        "maxMW": 1000, "wear": 0, "kind": "interconnector", "sides": "both",
        "minMw": 0, "rampRate": 250, "startupTime": 0, "startupCost": 0, "varCost": 0, "fuelType": "none",
        "lossFactor": 0.03, "foreignPriceKey": "priceNL",
    },
    "IC_VIKING": {
        "key": "IC_VIKING", "name": "Viking Link (Denmark)", "short": "Viking", "col": "#1de98b",
        "maxMW": 1400, "wear": 0, "kind": "interconnector", "sides": "both",
        "minMw": 0, "rampRate": 350, "startupTime": 0, "startupCost": 0, "varCost": 0, "fuelType": "none",
        "lossFactor": 0.03, "foreignPriceKey": "priceDK",
    },
}

# ─── SUPPLIERS ───
SUPPLIERS = {
    "BRITISH_GAS": {
        "key": "BRITISH_GAS", "name": "British Gas", "portfolioMw": 1800,
        "riskAppetite": "LOW", "forecastErrorPct": 0.04, "retailTariff": 150,
    },
    "OCTOPUS": {
        "key": "OCTOPUS", "name": "Octopus Energy", "portfolioMw": 1200,
        "riskAppetite": "HIGH", "forecastErrorPct": 0.06, "retailTariff": 140,
    },
    "EDF": {
        "key": "EDF", "name": "EDF Energy", "portfolioMw": 1500,
        "riskAppetite": "MEDIUM", "forecastErrorPct": 0.05, "retailTariff": 145,
    },
    "OVO": {
        "key": "OVO", "name": "OVO Energy", "portfolioMw": 900,
        "riskAppetite": "MEDIUM", "forecastErrorPct": 0.05, "retailTariff": 148,
    },
    "SCOTTISH_POWER": {
        "key": "SCOTTISH_POWER", "name": "Scottish Power", "portfolioMw": 1100,
        "riskAppetite": "MEDIUM", "forecastErrorPct": 0.05, "retailTariff": 146,
    },
}

# ─── EVENTS ───
EVENTS = [
    {"id": "TRIP", "name": "Generator Trip", "niv": -280, "pd": 45, "prob": 0.06},
    {"id": "WIND_UP", "name": "Wind Surge", "niv": 200, "pd": -18, "prob": 0.08},
    {"id": "DMD_HI", "name": "Demand Spike", "niv": -140, "pd": 18, "prob": 0.09},
    {"id": "DMD_LO", "name": "Demand Drop", "niv": 120, "pd": -14, "prob": 0.07},
    {"id": "DUNKEL", "name": "DUNKELFLAUTE", "niv": -350, "pd": 65, "prob": 0.03},
    {"id": "COLD", "name": "Cold Snap", "niv": -200, "pd": 35, "prob": 0.04},
    {"id": "INTERCON", "name": "Interconnector On", "niv": 180, "pd": -22, "prob": 0.05},
    {"id": "CASCADE", "name": "Cascade Trip", "niv": -420, "pd": 80, "prob": 0.02},
    {"id": "SPIKE", "name": "Price Spike", "niv": -250, "pd": 90, "prob": 0.02},
    {"id": "WIND_LOW", "name": "Wind Drop", "niv": -180, "pd": 22, "prob": 0.10},
]

# ─── SCORING CONFIG ───
SCORING_CONFIG = {
    "alpha": 0.6,
    "consistencyPenalty": 0.1,
    "stressNIVThreshold": 300,
    "TRADER": {
        "breakpoints": [[-1000, 10], [0, 30], [0.5, 50], [1, 70], [1.5, 85], [2, 100]],
        "marginPenalty": 10,
        "primaryWeight": 0.85,
    },
    "GENERATOR": {
        "breakpoints": [[-500, 0], [0, 20], [100, 50], [400, 70], [700, 85], [1000, 100]],
        "primaryWeight": 0.80,
    },
    "BESS": {
        "breakpoints": [[0, 20], [50, 50], [100, 70], [150, 85], [200, 100]],
        "primaryWeight": 0.75,
    },
    "SUPPLIER": {
        "breakpoints": [[40, 100], [50, 80], [65, 60], [80, 40], [100, 10]],
        "primaryWeight": 0.80,
    },
    "DSR": {
        "breakpoints": [[-500, 0], [0, 20], [50, 50], [100, 70], [150, 85], [200, 100]],
        "primaryWeight": 0.80,
    },
    "NESO": {
        "stabilityWeight": 0.40,
        "costWeight": 0.20,
        "maeWeight": 0.15,
        "clearingWeight": 0.25,
    },
    "ELEXON": {
        "accuracyWeight": 0.50,
        "timelinessWeight": 0.30,
        "transparencyWeight": 0.20,
    },
    "INTERCONNECTOR": {
        "breakpoints": [[0, 20], [200, 50], [500, 70], [1000, 85], [2000, 100]],
        "primaryWeight": 0.80,
    },
}
