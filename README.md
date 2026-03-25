Readme · MDCopyGridForge ⚡
A browser-based multiplayer simulation of the GB electricity market.
Players take on real industry roles — generator operator, battery trader, DSR aggregator, system operator — and compete across live market phases to balance the grid, earn revenue, and outscore each other on a multi-dimensional leaderboard. Built for university workshops, industry training, and competitive market literacy programmes.

Table of Contents

Overview
Quick Start
Architecture
Roles
Market Phases
Physical Asset Models
Market & Settlement Logic
Scoring System
Game Modes
Instructor Controls
Forecasting
Component Reference
Engine Reference
Known Bugs


Overview
GridForge simulates three interlocking GB electricity markets within each 30-minute Settlement Period (SP):

Day-Ahead (DA) — forward auction where generators and suppliers submit volume offers/bids 6 SPs ahead, locking in contracted positions at a pay-as-clear clearing price.
Intraday Auctions (IDA1/IDA2) — sealed-bid uniform-price auctions with progressively more accurate forecasts.
Intraday (ID) — continuous bilateral trading to adjust positions as new weather information arrives.
Balancing Mechanism (BM) — real-time merit-order dispatch where the System Operator calls on flexibility to resolve Net Imbalance Volume (NIV). Uniform pricing: all accepted offers earn the marginal clearing price.

State is server-authoritative: a FastAPI backend with PostgreSQL holds all game state, and clients synchronise in real time via WebSocket with a versioned delta protocol.

Quick Start
bashgit clone <repo>
cd gridforge
npm install
npm run dev        # Vite dev server on localhost:5173
Production build:
bashnpm run build
npm run preview
Joining a game:

Open the app and enter your name.
Enter (or create) a 4-letter room code.
Choose a role and asset. The first player to join becomes the host/instructor.
Wait in the lobby until the host starts the game.


Architecture
src/
├── App.jsx                    # Root component: state, WebSocket subscriptions, game loop
├── main.jsx                   # React entry point
│
├── components/
│   ├── WaitingRoom.jsx        # Lobby, host election, player list
│   ├── SharedLayout.jsx       # Phase header, timer bar, market info strip
│   ├── ForecastPanel.jsx      # NESO forecast draw/publish canvas
│   │
│   ├── charts/
│   │   ├── DayAheadCurve.jsx          # Supply/demand crossing chart (DA)
│   │   ├── IntradayDepthChart.jsx     # ID order book depth + executions timeline
│   │   ├── MarketInfoPanel.jsx        # Foreign prices, interconnector flows
│   │   ├── MarketOverviewPanel.jsx    # NIV, frequency, system status
│   │   └── SupplyDemandCurve.jsx      # BM merit-order chart
│   │
│   └── roles/
│       ├── BessScreen.jsx             # Battery ESS operator
│       ├── DsrScreen.jsx              # Demand Side Response aggregator
│       ├── ElexonScreen.jsx            # Settlement body
│       ├── GeneratorScreen.jsx        # Thermal / wind / solar / hydro
│       ├── NESOScreen.jsx             # System & market operator
│       ├── SupplierScreen.jsx         # Energy retailer
│       └── TraderScreen.jsx           # Independent power trader
│
├── engine/
│   ├── MarketEngine.js        # SP state, clearBM, clearDA, computeForecasts
│   ├── AssetPhysics.js        # availMW, updateSoF, initSoF
│   ├── SettlementEngine.js    # Imbalance MW, imbalance cash
│   ├── ScoringEngine.js       # Role scores, system score, overall score
│   ├── PhysicalEngine.js      # System NIV tracking, player impact attribution
│   ├── ForecastEngine.js      # Stochastic demand/wind/solar models
│   ├── LeaderboardEngine.js   # Ranking, narratives, round debrief
│   ├── Achievements.js        # Achievement definitions and check functions
│   └── GateLogic.js           # BM gate closure guard
│
├── hooks/
│   ├── useGameEngine.js       # Phase transition handler (DA/ID/BM/SETTLED)
│   └── useApi.js              # REST API + WebSocket wrapper
│
└── shared/
    ├── constants.js           # ASSETS, SCENARIOS, EVENTS, SCORING_CONFIG, …
    └── utils.js               # clamp, f0, f1, fpp, spTime, uid, roomKey
State sync model: All shared game state (phase, SP number, order books, forecasts, settlement contracts) flows through the FastAPI backend and is broadcast to clients via WebSocket with a versioned delta protocol. The server is the sole source of truth for phase advancement, market clearing, and settlement. Clients submit bids/actions via REST and receive state updates via WebSocket.

Roles
🏭 Generator
Operates a thermal, wind, solar, or hydro plant. Submits MW offers to the BM when the grid is short; sits out when long (wind/OCGT/hydro). Participates in DA auctions to lock in forward revenue.
Physical constraints: Thermal units have startup times (startupTime > 0), startup costs, and ramp limits. Wind and solar output is weather-driven and capped at def.maxMW × wf (or × sf). Hydro has a state-of-fuel (SoF) tank.
Strategy: OCGT bids near SBP for near-certain dispatch during shortfall events. Wind bids £0–10 (near-zero marginal cost). Hydro conserves SoF for high-price SPs flagged by the forecast.
🔋 BESS (Battery Energy Storage)
Operates a small, medium, or large battery. Sells (discharges) when the grid is short and buys (charges) when long. State of Charge (SoC) is tracked across SPs; efficiency losses (def.eff) apply to charging.
Physical constraints: Available MW is limited by both the hardware rating (def.maxMW) and energy remaining in the battery:

Discharge: ((SoC - MIN_SOC) / 100 × maxMWh × eff) / SP_DURATION_H
Charge: ((MAX_SOC - SoC) / 100 × maxMWh / eff) / SP_DURATION_H

Strategy: Buy low (charge at cheap SSP), sell high (discharge at expensive SBP). Forecast future NIV to plan SoC positioning.
🏗️ DSR Aggregator
Manages a portfolio of flexible industrial loads. Can turn up (absorb) or turn down (shed) unlimited energy at near-zero cost. No SoC or fuel constraint. Sides automatically match grid direction.
Physical constraints: Curtailment duration is capped at def.maxCurtailDuration SPs. After curtailing, a mandatory rebound (pendingReboundMwh) must be served, creating a forced demand obligation in subsequent SPs.
Strategy: Bid very low when selling (SHORT) and very high when buying (LONG) — should almost never miss dispatch.
🌐 NESO (National Energy System Operator)
Combines the role of System Operator (real-time balancing) and Market Operator (DA/ID auction management). Does not hold an asset. Publishes the official demand/wind/solar forecast that all players use. Can manually override NIV and trigger market events.
Scoring: Weighted across: system stability (40%), system balancing cost (20%), forecast MAE (15%), DA/ID clearing quality (25%).
📊 Elexon (Settlement Body)
Audits and validates settlement calculations across all SPs. Scored on settlement accuracy, timeliness, and audit coverage. Primarily an observer/verification role suited to teaching metering and settlement concepts.
📈 Trader
An independent participant with no physical asset. Opens long/short positions in the DA and ID markets. Scored on risk-adjusted return (net P&L / max drawdown). Capital is limited; margin events (running P&L below -£500) penalise the score.
🏪 Supplier
Represents a retail energy company that must procure power to cover its customers. Buys in DA/ID markets and faces BM imbalance charges if actual demand diverges from contracts. Scored on cost per MWh (lower is better) and hedge ratio.

Market Phases
Each Settlement Period cycles through four phases. In FULL mode the timer auto-advances; in WORKSHOP mode the instructor manually advances.
DA (Day-Ahead)
  ↓  Auction closes → clearDA() → contracts locked
ID (Intraday)
  ↓  Bilateral trades → positions adjusted
BM (Balancing Mechanism)
  ↓  Merit-order dispatch → clearBM() → uniform price
SETTLED
  ↓  Imbalance charges, scores updated → next SP
Day-Ahead Phase

Generators/BESS submit offer (sell) bids; Suppliers/Traders submit bid (buy) bids.
clearDA() finds the supply/demand curve intersection and sets the clearing price.
Accepted bids establish contracted positions (contractPosition) used for imbalance settlement.
DA cycle covers DA_CYCLE SPs (default 6); all SPs in the cycle share the same DA order book.

Intraday Phase

Continuous bilateral trading on id_{sp} order book.
Trades shown on the IntradayDepthChart as depth and executions views.
Positions updated before BM gate closure.

BM Phase

Grid direction (SHORT/LONG) determined by NIV from market.actual.
SHORT: sellers (generators, BESS discharge, DSR turn-down) submit offers sorted cheapest-first.
LONG: buyers (BESS charge, DSR turn-up) submit bids sorted highest-first.
clearBM() dispatches in merit order until NIV is covered.
Uniform pricing: all accepted participants earn/pay the marginal clearing price (cp).
Gate closure: canSubmitBmBid(phase, msLeft) — no new bids after timer expires.

Settlement Phase

Imbalance = actualPhysicalMw − (contractedMw + bmAcceptedMw)
Surplus imbalance paid at SSP; shortage imbalance charged at SBP.
Scores updated: role score, system score, overall score.
Achievements checked.


Physical Asset Models
Wind & Solar (MarketEngine.js)
Wind output uses a turbine power curve: cubic ramp from cut-in (3 m/s) to rated (12 m/s); flat from 12–15 m/s; linear decrease to cut-out (25 m/s). Wind speed follows a daily sinusoidal pattern with deterministic RNG noise.
Solar irradiance is modelled as a sine bell between 06:00–18:00 with random cloud noise. Both have separate forecast-error functions that add 7–20% uncertainty to the day-ahead view.
Actual output used in BM: trueWind × def.maxMW and trueSolar × def.maxMW.
BESS State of Charge
Discharge:  newSoC = SoC − (mwAcc × SP_DURATION_H / eff) / maxMWh × 100
Charge:     newSoC = SoC + (mwAcc × SP_DURATION_H × eff) / maxMWh × 100
SoC is clamped to [MIN_SOC, MAX_SOC] (default 5–95%).
DSR Rebound
After curtailSpsRemaining drops to zero, a forced rebound demand equal to pendingReboundMwh / reboundSps MW per SP must be served. This creates unavoidable long exposure in subsequent periods.
Thermal Startup
Assets with startupTime > 0 begin as OFFLINE. Each SP while offline decrements spUntilOnline. A startup cost (def.startupCost) is charged once on the first SP of dispatch after being offline.

Market & Settlement Logic
NIV and Grid Direction
Net Imbalance Volume (NIV): positive = system long (surplus), negative = system short (deficit).

SHORT (niv < 0): ESO needs to buy generation → sellers dispatched.
LONG (niv > 0): ESO needs to absorb surplus → buyers dispatched.

NIV is computed from a base stochastic model, modified by scenario bias, demand errors, and injected events.
Imbalance Settlement (SettlementEngine.js)
imbalanceMw = actualPhysicalMw − (contractedMw + bmAcceptedMw)
imbalancePrice = imbalanceMw < 0 ? SBP : SSP
imbalanceCash = imbalanceMw × imbalancePrice × SP_DURATION_H
Shortage imbalance pays the punitive System Buy Price (SBP). Surplus imbalance receives the (lower) System Sell Price (SSP).
BM Merit Order (MarketEngine.js — clearBM)
Candidates sorted by price (cheapest offers first when SHORT; highest bids first when LONG). Dispatched in merit order until NIV is covered. The last accepted bid's price becomes the uniform clearing price (cp) paid to all accepted participants.
Day-Ahead Clearing (MarketEngine.js — clearDA)
Supply and demand curves are built from submitted bids. Intersection is found iteratively. Pro-rata allocation applied at the marginal price when offers or bids are partially filled.
Scarcity / VoLL Pricing
When reserve margin falls below 5%, Loss of Load Probability (LoLP) multipliers apply: SBP is scaled up to SYSTEM_PARAMS.VoLL; SSP is divided by the same multiplier.
CfD Adjustment
Assets with a strikePrice property receive a Contract for Difference top-up: (strikePrice − cp) × mwh. Positive when market price is below strike (generator paid top-up); negative when above (generator repays windfall).
Interconnector Flows
Each interconnector asset tracks a foreign price (priceFR, priceNO, priceNL, priceDK). Flow is proportional to the GB/foreign price spread: (gbPrice − foreignPrice) × 15 MW/£, capped at def.maxMW.

Scoring System
All scores are 0–100. Updated after each SETTLED phase.
Role Score (60% of Overall)
Each role has a primary KPI (75–85% weight) and supporting KPIs (15–25%):
RolePrimary KPISupportingGeneratorProfit per installed MWImbalance cost/MWhBESSRevenue per MWh shiftedBM revenue share, SoC healthDSRReliability-adjusted revenueMissed dispatch eventsTraderRisk-adjusted return (P&L / drawdown)Margin eventsSupplierCost per MWh (lower = better)Hedge ratio, imbalance %NESOStability index (low avg abs NIV)System cost, forecast MAE, clearing qualityElexonSettlement accuracyOn-time rate, audit coverage
Scores are mapped through piecewise linear breakpoints defined in SCORING_CONFIG (constants.js).
System Score (40% of Overall)
Common to all roles. Measures contribution to grid stability:

Base: 50 + (NIV contribution × 0.1), where positive contribution = helped reduce |NIV|
+5 per stress-window help (up to +25 bonus)
-10 per missed delivery
-40 for causing a blackout

Overall Score
overallScore = 0.6 × roleScore + 0.4 × systemScore
Alpha configurable via SCORING_CONFIG.alpha.
Multi-Round Final Score
finalScore = mean(overallScores) − consistencyPenalty × stdDev(overallScores)
Rewards consistency across rounds. Penalty factor from SCORING_CONFIG.consistencyPenalty (default 0.1).

Game Modes
ModeBehaviourFULLAll phases auto-advance by timer. Forgiveness multiplier = 1 (full penalties).TUTORIALTimer-driven but imbalance penalties reduced by FORGIVENESS.penaltyMultiplier.WORKSHOPInstructor manually advances each phase. Ideal for pausing to discuss market outcomes.

Instructor Controls
The Game Master (GM) panel is visible to the first player to join (the host). Controls:

Advance Phase (WORKSHOP mode): Push meta.phase to the next phase for all players.
Pause / Resume: Freezes the countdown timer; players can still view charts.
Tick Speed: SLOW (120 s), NORMAL (60 s), FAST (30 s), TURBO (15 s) per phase.
Inject Market Events: Trigger shortage (TRIP, CASCADE, SPIKE, DUNKEL, COLD_SNAP) or surplus (WIND_UP, DMD_LO, INTERCON) events mid-session.
Change Scenario: Switch all players to a different base scenario (NORMAL, HIGH_WIND, SCARCITY, DUNKELFLAUTE, COLD_SNAP).
Manual NIV Override: Directly set NIV (overrides stochastic model). Published to neso_niv key.
Discussion Prompts: Five pre-written Socratic questions displayed in-panel for facilitated debrief.


Forecasting
NESO Forecast Canvas (ForecastPanel.jsx)
The NESO player draws demand, wind, and solar curves on an SVG canvas. Published versions are serialised to JSON and broadcast via WebSocket. All other players read and display this forecast.
A history of up to 50 published versions is maintained by ForecastEngine. Versions are labelled by author and timestamp.
ForecastEngine (ForecastEngine.js)
Supports three operating modes:

manual — NESO draws curves; auto-generation locked.
auto — Stochastic models generate demand (double-peak), wind (AR(1) walk), solar (bell curve) automatically.
mixed — Auto runs until a manual publish, which then engages the lock.

Shock injection (injectShock) can modify a published baseline (e.g. wind_drop, demand_spike) to simulate unexpected events.
Forecast Error Model (MarketEngine.js)
Day-ahead wind uncertainty: 12–20% error on wind speed. Intraday: ~5%. Solar: 7–10%. These forecast errors propagate into the SP-level forecast vs actual divergence that drives NIV surprises.
Forecast Strip (ForecastStrip in App.jsx)
All role screens display a 4-SP forward forecast strip showing: time, NIV direction, price range, wind%, solar%, and a warning flag if volatility is detected 1–2 SPs ahead.

Component Reference
Role Screens
BessScreen.jsx — SoC gauge, charge/discharge controls, DA/BM bid panels, revenue breakdown (note: see BUG-006 re: label accuracy). Displays round-trip efficiency and energy availability.
DsrScreen.jsx — Curtailment toggle, rebound status bar, DSR capacity widget showing available turn-up/turn-down MW. Correctly tracks curtailSpsRemaining from physicalState.
ElexonScreen.jsx — Settlement ledger showing all players' SP contracts, imbalance charges, and audit status. Read-only observer role.
GeneratorScreen.jsx — Startup status panel, expected output calculator (note: see BUG-001 re: maxMw typo), BM bid panel with Smart Bid and Quick Price buttons, live simulation preview.
NESOScreen.jsx — Split layout: left = ForecastPanel canvas; centre = manual dispatch controls and NIV override; right = system frequency gauge and event injection. Contains executeManualDispatch ordering issue (see BUG-005).
SupplierScreen.jsx — Procurement cost dashboard, hedge ratio display, DA bid submission, imbalance exposure calculator.
TraderScreen.jsx — Open position tracker, DA/ID bid panels, P&L attribution breakdown across markets.
Shared Components
WaitingRoom.jsx — Lobby with player list, role/asset selection, server-authoritative NESO election (see BUG-004 re: reconnect edge case).
SharedLayout.jsx — Persistent phase header bar (phase name, SP number, timer countdown, market signal indicator). Used by all role screens.
ForecastPanel.jsx — Interactive SVG canvas for drawing and publishing demand/wind/solar forecasts. Supports zoom, undo, and version history.
Chart Components
DayAheadCurve.jsx — Staircase supply/demand crossing chart. Handles negative prices correctly. Intersection highlighted with clearing price annotation.
IntradayDepthChart.jsx — Two-view chart: depth view (cumulative order book) and executions view (trade timeline). Note BUG-003: executions all render at same X when msLeft is defined.
MarketInfoPanel.jsx — Foreign electricity prices (FR, NO, NL, DK) and derived interconnector flows. Static display, no logic.
MarketOverviewPanel.jsx — Live system NIV bar, frequency gauge (49.3–50.7 Hz), grid event banner. Routes correctly between forecast/actual states by phase.
SupplyDemandCurve.jsx — BM merit-order chart with accepted/rejected bid shading. Note BUG-002: negative prices clipped to zero.

Engine Reference
MarketEngine.js

marketForSp(sp, scenarioId, injectedEvents, publishedForecast, manualNivOverride) — Returns { forecast, actual } state objects for a given SP. Deterministic per sp seed; forecast and actual diverge via separate RNG streams.
clearBM(bids, market) — Merit-order BM dispatch. Returns { accepted, cp, cleared, full }.
clearDA(bids, market_forecast) — Supply/demand intersection. Returns { cp, volume, accepted_bids }.
feedbackMarketState(market, clearResult) — Post-clearing SBP/SSP and frequency update.
computeForecasts(currentSp, scenarioId, publishedForecast, maxOffsets) — Lookahead strip of 4 SPs.

AssetPhysics.js

availMW(def, sofuel, market) — Available MW given current SoC/fuel and market weather.
updateSoF(def, sofuel, mwAcc, isShort) — State of charge/fuel update after dispatch.
initSoF(def) — Initial SoC or fuel level on join.

SettlementEngine.js

computeImbalance(actualMw, contractedMw, bmAcceptedMw) — Signed imbalance in MW.
selectImbalancePrice(imbalanceMw, sbp, ssp) — Returns SBP (if short) or SSP (if long).
computeImbalanceSettlement(params) — Full settlement: MW, price, MWh, cash.
computeHubFeeFromSettlements(settlements) — Net imbalance cash pool balancing check.

ScoringEngine.js

computeRoleScore(role, stats) — Role-specific KPI score 0–100.
computeSystemScore(metrics) — System impact score 0–100.
computeOverallScore(roleScore, systemScore, alpha) — Weighted blend.
computeFinalScore(overallScores) — Multi-round consistency-penalised final.
mapThreshold(value, breakpoints) — Piecewise linear interpolation for KPI → score mapping.

PhysicalEngine.js

createSystemState() — Initial NIV history and impact accumulator.
updateSystemState(state, spData) — Append SP entry, accumulate balancing cost.
computePlayerSystemImpact(playerImbalance, systemNIV) — Signed NIV delta attributable to this player.
updatePlayerImpact(impacts, pid, spImpact, isStress, deliveredOk) — Accumulate per-player system metrics.
buildPlayerStats(role, data) — Assemble stats object consumed by computeRoleScore.
buildNesoStats(systemState, spHistory) — NESO-specific stability and forecast metrics.
buildElexonStats(spContracts, spHistory) — Elexon settlement accuracy metrics.

LeaderboardEngine.js

buildLeaderboard(players) — Returns { overall, roleWinners, systemSteward, mostConsistent }.
generatePlayerNarrative(player) — One-sentence performance summary for debrief overlay.
buildRoundDebrief(leaderboardData, systemState) — Full debrief data structure (podium, narratives, system metrics).
getScoreColor(score) — Colour mapping for 0–100 score display.

ForecastEngine.js

ForecastEngine class with autoGenerate(), createManual(), injectShock() methods.
Stochastic models: _modelDemand() (double-peak), _modelWind() (AR(1) walk), _modelSolar() (bell curve).
History capped at 50 versions (_publish sliding window).

GateLogic.js

canSubmitBmBid(phase, msLeftMs) — Returns true only when phase === "BM" and msLeftMs > 0.

Achievements.js

15 achievements across BM mastery, revenue milestones, asset-specific feats, scenario challenges, and strategic play.
buildAchievementStats(data) — Derive stats object from SP history, cash, SoC.
checkAchievements(stats, alreadyEarned) — Returns newly unlocked achievements.

Known Bugs


