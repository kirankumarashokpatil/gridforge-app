import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ASSETS, SUPPLIERS, SCENARIOS, EVENTS, TICK_MS, MIN_SOC, MAX_SOC, DA_CYCLE, DA_MS, FREQ_FAIL_LO, FREQ_FAIL_HI, FREQ_FAIL_DURATION, TICK_SPEEDS, FORGIVENESS, GAME_MODES, ROLES, ID_WINDOW_MS, TUTORIAL_STEPS, SP_DURATION_H, SIM_SPEEDS, ADVANCE_MODES } from "./shared/constants.js";
import { clamp, f0, f1, fpp, spTime, uid, getOrCreatePlayerId, setPlayerId, normalizePlayer } from "./shared/utils.js";
// Server-authoritative: market generation, clearing, settlement all come from server.
// Client imports retained ONLY for: display helpers (computeForecasts), UI validation
// (availMW, canSubmitBmBid), state init (initSoF), and leaderboard fallback.
import { computeForecasts } from "./engine/MarketEngine.js";
import { availMW, availMWDirectional, initSoF } from "./engine/AssetPhysics.js";
import { canSubmitBmBid } from "./engine/GateLogic.js";
import { useApi, useToasts } from "./hooks/useApi.js";
import { ACHIEVEMENTS } from "./engine/Achievements.js";
import { buildLeaderboard, getScoreColor, generatePlayerNarrative, getRankLabel } from "./engine/LeaderboardEngine.js";


// Role Screens
import NESOScreen from './components/roles/NESOScreen';
import ElexonScreen from './components/roles/ElexonScreen';
import GeneratorScreen from './components/roles/GeneratorScreen';
import SupplierScreen from './components/roles/SupplierScreen';
import TraderScreen from './components/roles/TraderScreen';
import DsrScreen from './components/roles/DsrScreen';
// Interconnector is now a system asset, not a player role; its screen is no longer imported
import BessScreen from './components/roles/BessScreen';
import WaitingRoom from './components/WaitingRoom';

// ─── Extracted UI atoms ───
import ToastContainer from './components/ui/ToastContainer';
import ConnectivityIndicator from './components/ui/ConnectivityIndicator';

// ─── Extracted screens ───
import LobbyScreen from './screens/LobbyScreen';
import AssetScreen from './screens/AssetScreen';



/* ─── ROOT APP ─── */
export default function App() {
  const { api, ready, connect, subscribe } = useApi();
  const { toasts, add: addToast } = useToasts();

  // Support URL query params for E2E testing: ?playerName=Alice&roomCode=ALPHA
  const _urlParams = new URLSearchParams(window.location.search);
  const _urlName = _urlParams.get('playerName') || '';
  const _urlRoom = _urlParams.get('roomCode') || '';

  const [screen, setScreen] = useState("lobby");
  const [name, setName] = useState(_urlName);
  const [room, setRoom] = useState(_urlRoom);
  // Initialize pid eagerly so WaitingRoom always receives a valid pid on first render
  const [pid, setPid] = useState(() => getOrCreatePlayerId());
  const [asset, setAsset] = useState(null);
  const [assetConfig, setAssetConfig] = useState(null);
  const [isInstructor, setIsInstructor] = useState(false);
  const [scenarioId, setScenarioId] = useState("NORMAL");
  const [sp, setSp] = useState(0);            // currentSp from backend (0 = pre-REALTIME)
  const [phase, setPhase] = useState("FORECAST_0"); // dayPhase from backend
  const [bmSubPhase, setBmSubPhase] = useState(null); // BM_OPEN / BM_CLEAR / SP_SETTLED during REALTIME
  const [day, setDay] = useState(1);           // Current trading day
  const [phaseStartTs, setPhaseStartTs] = useState(0);
  const [market, setMarket] = useState(null); // Current SP market { forecast, actual }
  const [msLeft, setMsLeft] = useState(TICK_MS);
  const [soc, setSoc] = useState(50);
  const [cash, setCash] = useState(0);
  const [daCash, setDaCash] = useState(0); // Kept for UI backwards compatibility

  const [submitted, setSubmitted] = useState(false);
  const [myBid, setMyBid] = useState({ mw: 10, price: "" });
  const [daMyBid, setDaMyBid] = useState({ mw: 15, price: "" });
  const [daSubmitted, setDaSubmitted] = useState(false);
  const [daCurveSegments, setDaCurveSegments] = useState(null); // EPEX piecewise curve segments
  const [daCurves, setDaCurves] = useState({}); // All players' DA curves
  const [daAuctionResults, setDaAuctionResults] = useState(null); // Full 48-SP auction results

  const [lastRes, setLastRes] = useState(null);
  const [daResult, setDaResult] = useState(null);
  const [players, setPlayers] = useState({});
  const [orderBook, setOrderBook] = useState({});
  const [daOrderBook, setDaOrderBook] = useState({});
  const [spHistory, setSpHistory] = useState([]);
  const [forecasts, setForecasts] = useState([]);
  const [publishedForecast, setPublishedForecast] = useState(null); // Shared NESO forecast version
  const [forecastUpdateSummary, setForecastUpdateSummary] = useState(null); // Latest weather-run bulletin
  const [roomScenario, setRoomScenario] = useState("NORMAL");
  const [spContracts, setSpContracts] = useState({}); // Master ledger for Elexon settlement

  // ─── SCORING ENGINE STATE ───
  const [systemState, setSystemState] = useState(() => ({ nivHistory: [], totalBalancingCost: 0, stressEvents: [], blackouts: 0 }));
  const [playerScores, setPlayerScores] = useState({}); // pid → { roleScore, systemScore, overallScore, roleDetail }
  const [overallScoreHistory, setOverallScoreHistory] = useState([]); // for multi-round final score
  // Server-authoritative leaderboard pushed after each phase advance.
  // When present, used instead of local buildLeaderboard() recomputation.
  const [serverLeaderboard, setServerLeaderboard] = useState(null);


  // ─── WORKSHOP FEATURES ───
  const [tickSpeed, setTickSpeed] = useState(TICK_MS);
  const [paused, setPaused] = useState(false);
  const [advanceMode, setAdvanceMode] = useState("AUTO"); // "MANUAL" | "AUTO"
  const [simSpeedId, setSimSpeedId] = useState("NORMAL");
  const [freqBreachSec, setFreqBreachSec] = useState(0);

  // ─── LIVE NIV (BM_OPEN) ───
  const [liveNivData, setLiveNivData] = useState(null); // { indicativeResidual, coverage, totalBidMw, bidCount, rawNiv, isShort }
  const [blackout, setBlackout] = useState(false);

  // ─── BATCH 1: Achievements & Forgiveness ───
  const [earnedAchievements, setEarnedAchievements] = useState([]);
  const [gameMode, setGameMode] = useState("FULL");
  const [role, setRole] = useState("GENERATOR");

  // ─── BATCH 2: Intraday & Settlement ───
  const [idOrderBook, setIdOrderBook] = useState({});
  const [idMyOrder, setIdMyOrder] = useState({ mw: 10, price: "", side: "buy" });
  const [idSubmitted, setIdSubmitted] = useState(false);
  // Player-Ready system: tracks per-player readiness signalled to the server
  const [playerReadiness, setPlayerReadiness] = useState({});
  // Position flow: positions[48] is the master array. DA fills all 48 at once.
  // ID accumulates per-SP. contractPosition is derived for backward compat.
  const [positions, setPositions] = useState(new Array(48).fill(0));       // MW per SP (DA + ID)
  const [contracts, setContracts] = useState(new Array(48).fill(0));       // Frozen at gate closure
  const [daPositions, setDaPositions] = useState(new Array(48).fill(0));   // DA-only volumes (before ID)
  const contractPosition = positions[Math.max(0, (sp || 1) - 1)] || 0;    // Derived for current SP
  const setContractPosition = (valOrFn) => {                               // Compat shim for existing code
    setPositions(prev => {
      const next = [...prev];
      const idx = Math.max(0, (sp || 1) - 1);
      next[idx] = typeof valOrFn === 'function' ? valOrFn(prev[idx]) : valOrFn;
      return next;
    });
  };
  const [imbalancePenalty, setImbalancePenalty] = useState(0);

  // ─── BATCH 3: Multi-asset ───
  const [portfolio, setPortfolio] = useState([]);          // list of asset keys
  const [activeAssetIdx, setActiveAssetIdx] = useState(0); // which one is selected
  const [portfolioSocs, setPortfolioSocs] = useState({});  // soc per asset
  const [portfolioCash, setPortfolioCash] = useState({});  // cash per asset

  // ─── BATCH 4: Tutorial & Replay ───
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialActive, setTutorialActive] = useState(false);
  const [replayData, setReplayData] = useState([]);  // full tick snapshots for scrubber
  const [replayIdx, setReplayIdx] = useState(-1);    // -1 = live, >=0 = replaying
  const [showDebrief, setShowDebrief] = useState(false);
  const [roomState, setRoomState] = useState("WAITING");

  // ─── BATCH 5: Physical Realism ───
  const [physicalState, setPhysicalState] = useState({
    status: "ONLINE", // Generator: "OFFLINE" | "STARTING" | "ONLINE"
    spUntilOnline: 0,
    currentMw: 0,     // Common: Current actual dispatch tracking
    // DSR Specific Tracking
    curtailSpsRemaining: 2, // Must start at maxCurtailDuration (default 2), NOT 0
    reboundSpsRemaining: 0,
    pendingReboundMwh: 0,
  });

  const refs = useRef({}); refs.current = { sp, phase, bmSubPhase, day, phaseStartTs, soc, cash, daCash, submitted, pid, name, room, asset, assetConfig, isInstructor, scenarioId: roomScenario, gameMode, role, contractPosition, positions, contracts, daPositions, orderBookSnap: orderBook, daOrderBookSnap: daOrderBook, idOrderBookSnap: idOrderBook, spContracts, players, physicalState, msLeft, tickSpeed, paused, advanceMode, daCurves, publishedForecast };
  const prevPhaseRef = useRef({ phase: "INIT", sp: 0, bmSubPhase: null });
  // Bug 8: guard against double-fire in StrictMode or fast re-renders
  const gameInitFiredRef = useRef(false);
  const lastEventRef = useRef(null);
  const advanceInFlightRef = useRef(false);
  // Holds the authoritative DA results from the most-recent server broadcast.
  // Used by the phase-transition effect to replace client-side clearFullAuction calls.
  const lastDaBroadcastRef = useRef(null);
  // Stores refined market forecasts after FORECAST_1/2 phases apply ida_forecast().
  // Keyed by SP (1-48). Effect 1 uses these instead of raw marketForSp() output so
  // the JS engine stays in sync with the Python server without being dependent on it.
  // Cleared each day on FORECAST_0. (Bug 7 fix — correct approach)
  const refinedMarketsRef = useRef({});
  // Phase 3 — server-authoritative BM settlement.
  // Populated from the bm_advance broadcast before the phase-transition useEffect fires.
  // The useEffect reads these refs to get server-computed values instead of re-running clearBM.
  const lastBmResultRef = useRef(null);       // server's clear_bm() output {cp, accepted, niv, ...}
  const lastBmPlayerUpdatesRef = useRef(null); // per-pid {cash, soc, imbalancePenalty, ...}
  // Phase 4 — server-authoritative ID clearing.
  // Populated from the day_phase_change broadcast when old phase is ID/ID_ROUNDS.
  const lastIdPlayerSummariesRef = useRef(null); // per-pid {mwMatched, avgPrice, cashDelta, side, positionDeltas}
  const gmCfg = GAME_MODES[gameMode] || GAME_MODES.FULL;
  const isForgive = gmCfg.forgiveness;

  const handleJoin = useCallback(async (chosenAsset, customConfig = null) => {
    if (!name.trim() || !room.trim() || !chosenAsset || !api) return;
    const def = { ...ASSETS[chosenAsset], ...(customConfig || {}) };
    const id = getOrCreatePlayerId();
    const soc0 = initSoF(def);
    setPid(id);
    setAsset(chosenAsset);
    setAssetConfig(customConfig);
    setSoc(soc0);

    // Initialize physical state based on startup requirements
    const requiresStartup = def.startupTime > 0;
    setPhysicalState({
      status: requiresStartup ? "OFFLINE" : "ONLINE",
      spUntilOnline: 0,
      currentMw: 0,
      curtailSpsRemaining: def.maxCurtailDuration || 2,
      reboundSpsRemaining: 0,
      pendingReboundMwh: 0,
    });

    const assignedRole = isInstructor ? "instructor" : role;

    // Connect to WebSocket for real-time updates
    connect(room);

    // Create player via API
    await api.putPlayer(room, id, {
      name: name.trim(),
      asset: chosenAsset,
      custom_config: customConfig,
      cash: 0,
      da_cash: 0,
      sof: soc0,
      role: assignedRole,
      status: 'ACTIVE'
    });

    // Create or update room
    await api.createRoom(room, scenarioId);

    // Always fetch and apply the latest state after join/rejoin
    try {
      const state = await api.engineGetState(room);
      if (state) {
        // Apply all relevant state fields to UI/game state
        // Engine returns dayPhase/currentSp; fallback to phase/sp for legacy compat
        if (state.dayPhase) setPhase(state.dayPhase);
        else if (state.phase) setPhase(state.phase);
        if (state.currentSp !== undefined) setSp(state.currentSp);
        else if (state.sp !== undefined) setSp(state.sp);
        if (state.day !== undefined) setDay(state.day);
        if (state.bmSubPhase !== undefined) setBmSubPhase(state.bmSubPhase);
        if (state.players) setPlayers(state.players);
        if (state.orderBook) setOrderBook(state.orderBook);
        if (state.daOrderBook) setDaOrderBook(state.daOrderBook);
        if (state.idOrderBook) setIdOrderBook(state.idOrderBook);
        if (state.spHistory) setSpHistory(state.spHistory);
        if (state.forecasts) setForecasts(state.forecasts);
        if (state.publishedForecast) setPublishedForecast(state.publishedForecast);
        if (state.forecastUpdateSummary) setForecastUpdateSummary(state.forecastUpdateSummary);
        if (state.roomScenario) setRoomScenario(state.roomScenario);
        if (state.spContracts) setSpContracts(state.spContracts);
        // Prefer server-broadcast markets (authoritative) over client-computed ones.
        // Fall back to client-side idaForecast() blending only when the server hasn't
        // sent markets yet (e.g. first-ever join before FORECAST_0 runs).
        if (state.markets && Object.keys(state.markets).length > 0) {
          refinedMarketsRef.current = state.markets;
          const curSp = Math.max(1, state.currentSp || state.sp || 1);
          if (refinedMarketsRef.current[curSp]) setMarket(refinedMarketsRef.current[curSp]);
        } else {
          // Server-authoritative: markets will arrive via WS room:meta broadcast.
          // No client-side generation needed.
          refinedMarketsRef.current = {};
        }
        if (state.soc !== undefined) setSoc(state.soc);
        if (state.cash !== undefined) setCash(state.cash);
        if (state.daCash !== undefined) setDaCash(state.daCash);
        if (state.positions) setPositions(state.positions);
        if (state.contracts) setContracts(state.contracts);
        if (state.daPositions?.[id]) setDaPositions(state.daPositions[id]);
        if (state.imbalancePenalty !== undefined) setImbalancePenalty(state.imbalancePenalty);
        if (state.earnedAchievements) setEarnedAchievements(state.earnedAchievements);
        if (state.gameMode) setGameMode(state.gameMode);
        if (state.role) setRole(state.role);
        if (state.daCurves) setDaCurves(state.daCurves);
        if (state.daAuctionResults) setDaAuctionResults(state.daAuctionResults);
        if (state.playerScores) setPlayerScores(state.playerScores);
        if (state.systemState) setSystemState(state.systemState);
        if (state.overallScoreHistory) setOverallScoreHistory(state.overallScoreHistory);
        if (state.physicalState) setPhysicalState(state.physicalState);
        if (state.portfolio) setPortfolio(state.portfolio);
        if (state.activeAssetIdx !== undefined) setActiveAssetIdx(state.activeAssetIdx);
        if (state.portfolioSocs) setPortfolioSocs(state.portfolioSocs);
        if (state.portfolioCash) setPortfolioCash(state.portfolioCash);
        if (state.tutorialStep !== undefined) setTutorialStep(state.tutorialStep);
        if (state.tutorialActive !== undefined) setTutorialActive(state.tutorialActive);
        if (state.replayData) setReplayData(state.replayData);
        if (state.replayIdx !== undefined) setReplayIdx(state.replayIdx);
        if (state.showDebrief !== undefined) setShowDebrief(state.showDebrief);
      }
    } catch (err) {
      console.error('[App] Failed to fetch/apply latest state after join:', err);
    }

    prevPhaseRef.current = { phase: refs.current.phase, sp: refs.current.sp, bmSubPhase: refs.current.bmSubPhase };
    setScreen("game");
  }, [name, room, api, isInstructor, scenarioId, role, connect]);

  useEffect(() => {
    if ((screen !== "game" && screen !== "waiting_room" && screen !== "game_init") || !api || !room) return;
    const unsubPlayers = subscribe(`room:${room}:players`, (data) => {
      if (data && typeof data === 'object') {
        // Normalize: ensure each player record has consistent field names
        setPlayers(prev => {
          const normalized = {};
          for (const [key, val] of Object.entries(data)) {
            if (val && typeof val === 'object') {
              normalized[key] = normalizePlayer(val, prev[key]);
            } else {
              normalized[key] = val;
            }
          }
          return { ...prev, ...normalized };
        });
      }
    });

    // Subscribe to room meta updates
    const unsubMeta = subscribe(`room:${room}:meta`, (data) => {
      if (data?.scenarioId) setRoomScenario(data.scenarioId);
      if (data?.roomState) setRoomState(data.roomState);
      else if (data?.room_state) setRoomState(data.room_state);
      // New backend fields: dayPhase, currentSp, bmSubPhase, day
      if (data?.currentSp !== undefined) setSp(data.currentSp);
      else if (data?.sp !== undefined) setSp(data.sp); // legacy compat
      if (data?.dayPhase) {
        console.log('[API] Phase update received:', data.dayPhase, 'at', new Date().toISOString());
        setPhase(data.dayPhase);
      } else if (data?.newPhase) {
        console.log('[API] Phase update received (newPhase):', data.newPhase, 'at', new Date().toISOString());
        setPhase(data.newPhase);
      } else if (data?.phase) {
        setPhase(data.phase); // legacy compat
      }
      if (data?.bmSubPhase !== undefined) setBmSubPhase(data.bmSubPhase);
      if (data?.day !== undefined) setDay(data.day);
      if (data?.phaseStartTs) setPhaseStartTs(data.phaseStartTs);
      if (data?.tickSpeed) setTickSpeed(data.tickSpeed);
      if (data?.paused !== undefined) setPaused(data.paused);
      if (data?.advanceMode) setAdvanceMode(data.advanceMode);
      if (data?.simSpeedId) setSimSpeedId(data.simSpeedId);
      // Bug 6: sync gameMode broadcast from NESO at game start
      if (data?.gameMode) setGameMode(data.gameMode);
      // Forecast update bulletin produced by FORECAST_* phase advance
      if (data?.forecastUpdateSummary) setForecastUpdateSummary(data.forecastUpdateSummary);
      if (data?.publishedForecast) setPublishedForecast(data.publishedForecast);
      // Capture server-authoritative DA/IDA results for the phase-transition effect.
      // This prevents the client from re-clearing independently (Bug 3).
      // IDA1/IDA2 results come back as ida1Results/ida2Results, not daResults —
      // map all three into the same ref so isAuctionClose handler works uniformly.
      if (data?.daResults && Object.keys(data.daResults).length > 0) {
        lastDaBroadcastRef.current = data.daResults;
      }
      if (data?.ida1Results && Object.keys(data.ida1Results).length > 0) {
        lastDaBroadcastRef.current = data.ida1Results;
      }
      if (data?.ida2Results && Object.keys(data.ida2Results).length > 0) {
        lastDaBroadcastRef.current = data.ida2Results;
      }
      // Phase 3: capture server BM result + per-player settlement from bm_advance broadcast.
      // The phase-transition useEffect reads these refs instead of re-running clearBM() locally.
      if (data?.bmResult) {
        lastBmResultRef.current = data.bmResult;
      }
      if (data?.playerUpdates) {
        lastBmPlayerUpdatesRef.current = data.playerUpdates;
        // Apply authoritative scores to leaderboard display (non-null only after day finalize)
        const myPid = refs.current.pid;
        const myUpd = data.playerUpdates[myPid];
        if (myUpd?.roleScore != null) {
          setPlayerScores(prev => ({
            ...prev,
            [myPid]: { roleScore: myUpd.roleScore, systemScore: myUpd.systemScore, overallScore: myUpd.overallScore },
          }));
          setOverallScoreHistory(prev => [...prev, myUpd.overallScore]);
        }
      }
      // Phase 4: capture server ID clearing result. playerIdSummaries is per-pid;
      // stored before the phase-transition useEffect fires so the ID CLOSED block reads it.
      if (data?.playerIdSummaries && Object.keys(data.playerIdSummaries).length > 0) {
        lastIdPlayerSummariesRef.current = data.playerIdSummaries;
      }
      // Server-authoritative markets: when the server broadcasts all 48 SP markets
      // (after any FORECAST phase or on state_snapshot), use them directly and skip
      // client-side marketForSp() + idaForecast() recalculation.
      if (data?.markets && Object.keys(data.markets).length > 0) {
        refinedMarketsRef.current = data.markets;
        const curSp = Math.max(1, data.currentSp || 1);
        if (refinedMarketsRef.current[curSp]) setMarket(refinedMarketsRef.current[curSp]);
      } else if (data?.forecastStage === "FORECAST_0") {
        // FORECAST_0 clears refinements so the new day starts with a fresh server-generated set.
        refinedMarketsRef.current = {};
      }
      // Server-authoritative: if forecasts updated without full markets broadcast,
      // rely on the next server-broadcast to deliver refined markets.
      // Transition from waiting_room to game when host starts
      if (data?.roomState === 'RUNNING') {
        setScreen(prev => {
          if (prev === 'waiting_room') {
            return 'game_init'; // Intermediate state to initialize all roles
          }
          return prev;
        });
      }
    });

    // Subscribe to forecast updates
    const unsubForecast = subscribe(`room:${room}:forecast`, (data) => {
      console.log('[App.jsx] Received forecast data from API:', data ? Object.keys(data) : 'null');
      if (data) {
        setPublishedForecast(data);
      }
    });

    // Listen for published settlement contracts (Elexon sync)
    const unsubSpContracts = subscribe(`room:${room}:sp_contracts`, (data) => {
      if (!data) return;
      if (Array.isArray(data)) {
        data.forEach(record => {
          if (record?.sp == null || !record?.contracts) return;
          setSpContracts(prev => ({ ...prev, [record.sp]: record.contracts }));
        });
        return;
      }
      if (typeof data === 'object') {
        if (data.sp != null && data.contracts) {
          setSpContracts(prev => ({ ...prev, [data.sp]: data.contracts }));
          return;
        }
        // Fallback for map-shaped payloads keyed by SP.
        setSpContracts(prev => ({ ...prev, ...data }));
      }
    });

    // Player-Ready updates: NESO sees per-player readiness; non-NESO can track their own ack
    const unsubReady = subscribe(`room:${room}:player_ready`, (data) => {
      if (data?.readiness) setPlayerReadiness(data);
    });

    // Server-authoritative leaderboard — broadcast after every phase advance.
    // Replaces local buildLeaderboard() so all clients show identical rankings.
    const unsubLeaderboard = subscribe(`room:${room}:leaderboard`, (data) => {
      if (data?.overall) setServerLeaderboard(data);
    });

    // Server achievement broadcasts — emitted after each SP_SETTLED.
    // Supplements (or replaces) the per-SP client-side checkAchievements() effect.
    const unsubAchievements = subscribe(`room:${room}:achievements`, (data) => {
      if (!data) return;
      const myPid = refs.current.pid;
      const myNewIds = data[myPid];
      if (myNewIds && myNewIds.length > 0) {
        // Merge server-confirmed achievement IDs into local earned list
        setEarnedAchievements(prev => {
          const existingIds = new Set(prev.map(a => a.id || a));
          const newOnes = myNewIds.filter(id => !existingIds.has(id));
          if (newOnes.length === 0) return prev;
          // Show toast for each newly confirmed achievement (ACHIEVEMENTS already imported at top)
          for (const id of newOnes) {
            const a = ACHIEVEMENTS.find(x => x.id === id);
            if (a) addToast({ emoji: a.emoji, title: `🏆 ${a.name}`, body: a.desc, col: a.col });
          }
          return [...prev, ...newOnes.map(id => ({ id }))];
        });
      }
    });

    // Polling fallback: if WebSocket doesn't deliver roomState: RUNNING, poll REST
    let roomStatePoll = null;
    let forecastPoll = null;
    if (screen === 'waiting_room') {
      roomStatePoll = setInterval(async () => {
        try {
          const meta = await api.getRoomMeta(room);
          if (meta?.room_state) setRoomState(meta.room_state);
          else if (meta?.roomState) setRoomState(meta.roomState);
          if (meta?.room_state === 'RUNNING' || meta?.roomState === 'RUNNING') {
            setScreen(prev => prev === 'waiting_room' ? 'game_init' : prev);
          }
        } catch (_) {
          // Ignore poll errors
        }
      }, 2000);
    }

    // Forecast visibility fallback: keep forecasts/published forecast in sync
    // even if websocket delivery is delayed or missed.
    forecastPoll = setInterval(async () => {
      try {
        const fc = await api.engineGetForecasts(room);
        if (fc?.forecasts) setForecasts(fc.forecasts);
      } catch (_) {
        // Ignore polling errors
      }
      try {
        const state = await api.engineGetState(room);
        if (state?.publishedForecast) setPublishedForecast(state.publishedForecast);
        if (state?.forecastUpdateSummary) setForecastUpdateSummary(state.forecastUpdateSummary);
      } catch (_) {
        // Ignore polling errors
      }
    }, 3000);

    return () => {
      unsubPlayers?.();
      unsubMeta?.();
      unsubForecast?.();
      unsubSpContracts?.();
      unsubReady?.();
      unsubLeaderboard?.();
      unsubAchievements?.();
      if (roomStatePoll) clearInterval(roomStatePoll);
      if (forecastPoll) clearInterval(forecastPoll);
    };
  }, [screen, room, api, subscribe]);

  // Bug 8: reset gameInitFiredRef whenever the player is back at lobby or waiting room
  // so a second game_init entry (different session) works correctly.
  useEffect(() => {
    if (screen === 'waiting_room' || screen === 'lobby') {
      gameInitFiredRef.current = false;
    }
  }, [screen]);

  // ─── GAME INIT FROM WAITING ROOM (all roles) ───
  useEffect(() => {
    if (screen !== "game_init") return;
    // Bug 8: guard against double-fire (StrictMode double-invoke or fast re-renders)
    if (gameInitFiredRef.current) return;
    gameInitFiredRef.current = true;

    const initGame = async () => {
      const id = pid || getOrCreatePlayerId();
      setPid(id);

      const currentRole = refs.current.role;
      const noAssetRoles = ['NESO', 'ELEXON', 'TRADER', 'SUPPLIER'];
      const needsAsset = !noAssetRoles.includes(currentRole);

      // Determine the assigned asset from player state
      const myPlayerRecord = refs.current.players?.[id];
      const assignedAsset = myPlayerRecord?.assignedAssetKey || myPlayerRecord?.asset || null;

      // Bug 3: guard — if this role requires an asset but none was assigned by NESO,
      // send the player back to the waiting room instead of silently joining with no asset.
      if (needsAsset && !assignedAsset) {
        console.warn('[game_init] Asset role without assigned asset — returning to waiting_room');
        gameInitFiredRef.current = false;
        setScreen('waiting_room');
        return;
      }

      // Bug 2: detect rejoin so we don't zero-out accumulated cash/SoC
      const existingCash = myPlayerRecord?.cash ?? null;
      const isRejoin = existingCash !== null && existingCash !== 0;

      let resolvedAsset = 'NONE';
      let resolvedSoc = 100;

      if (needsAsset && assignedAsset) {
        // Asset-owning roles: initialize asset, SoC, physical state
        const customConfig = myPlayerRecord?.custom_config || null;
        const def = { ...ASSETS[assignedAsset], ...(customConfig || {}) };
        const soc0 = isRejoin ? (myPlayerRecord?.sof ?? initSoF(def)) : initSoF(def);
        resolvedAsset = assignedAsset;
        resolvedSoc = soc0;
        setAsset(assignedAsset);
        setAssetConfig(customConfig);
        setSoc(soc0);
        const requiresStartup = def.startupTime > 0;
        setPhysicalState({
          status: requiresStartup ? "OFFLINE" : "ONLINE",
          spUntilOnline: 0,
          currentMw: 0,
          curtailSpsRemaining: def.maxCurtailDuration || 2,
          reboundSpsRemaining: 0,
          pendingReboundMwh: 0,
        });
        if (api && room) {
          // Bug 2: only write cash/soc on fresh join; preserve existing values on rejoin
          const putPayload = {
            name: name.trim(),
            asset: assignedAsset,
            custom_config: customConfig,
            role: currentRole,
            status: 'ACTIVE',
          };
          if (!isRejoin) {
            putPayload.cash = 0;
            putPayload.da_cash = 0;
            putPayload.sof = soc0;
          }
          await api.putPlayer(room, id, putPayload)
            .catch(err => console.error('[game_init] putPlayer failed:', err));
        }
      } else {
        // Non-asset roles (NESO, ELEXON, TRADER, SUPPLIER)
        setAsset("NONE");
        setSoc(100);
        if (currentRole === "TRADER" && !isRejoin) setCash(5000);
        if (api && room) {
          const putPayload = {
            name: name.trim(),
            asset: "NONE",
            role: currentRole,
            status: 'ACTIVE',
          };
          if (!isRejoin) {
            putPayload.cash = currentRole === "TRADER" ? 5000 : 0;
            putPayload.da_cash = 0;
            putPayload.sof = 100;
          }
          await api.putPlayer(room, id, putPayload)
            .catch(err => console.error('[game_init] putPlayer failed:', err));
        }
      }

      // Bug 1+5: Register this player in the engine's in-memory playerStates so
      // BM settlements, cash updates and SoC changes are applied correctly.
      if (api && room) {
        await api.engineRegister(room, {
          playerId: id,
          name: name.trim(),
          role: currentRole,
          asset: resolvedAsset,
          sof: resolvedSoc,
        }).catch(err => console.warn('[game_init] engineRegister failed (non-fatal):', err));
      }

      // Fetch authoritative state from server engine
      try {
        if (api && room) {
          const state = await api.engineGetState(room);
          if (state) {
            // Engine returns dayPhase/currentSp; fallback to phase/sp for legacy compat
            if (state.dayPhase) setPhase(state.dayPhase);
            else if (state.phase) setPhase(state.phase);
            if (state.currentSp !== undefined) setSp(state.currentSp);
            else if (state.sp !== undefined) setSp(state.sp);
            if (state.day !== undefined) setDay(state.day);
            if (state.bmSubPhase !== undefined) setBmSubPhase(state.bmSubPhase);
            if (state.players) setPlayers(state.players);
            if (state.orderBook) setOrderBook(state.orderBook);
            if (state.daOrderBook) setDaOrderBook(state.daOrderBook);
            if (state.idOrderBook) setIdOrderBook(state.idOrderBook);
            if (state.spHistory) setSpHistory(state.spHistory);
            if (state.forecasts) setForecasts(state.forecasts);
            if (state.publishedForecast) setPublishedForecast(state.publishedForecast);
            if (state.roomScenario) setRoomScenario(state.roomScenario);
            if (state.spContracts) setSpContracts(state.spContracts);
            // Server-authoritative: use markets from engine/state response.
            if (state.markets && Object.keys(state.markets).length > 0) {
              refinedMarketsRef.current = state.markets;
              const curSp = Math.max(1, state.currentSp || state.sp || 1);
              if (refinedMarketsRef.current[curSp]) setMarket(refinedMarketsRef.current[curSp]);
            } else {
              refinedMarketsRef.current = {};
            }
            if (state.daCurves) setDaCurves(state.daCurves);
            if (state.daAuctionResults) setDaAuctionResults(state.daAuctionResults);
            if (state.playerScores) setPlayerScores(state.playerScores);
            if (state.systemState) setSystemState(state.systemState);
            // Sync timer state so auto-advance fires correctly at FORECAST_0
            if (state.phaseStartTs) setPhaseStartTs(state.phaseStartTs);
            if (state.tickSpeed) setTickSpeed(state.tickSpeed);
          }
        }
      } catch (err) {
        console.error('[game_init] Failed to fetch engine state:', err);
      }

      // Connect WebSocket if not connected
      connect(room);
      // Seed prevPhaseRef with the current server state so the first real phase-change
      // broadcast is processed correctly (prevents "INIT" guard misfires on hot-join).
      prevPhaseRef.current = { phase: refs.current.phase, sp: refs.current.sp, bmSubPhase: refs.current.bmSubPhase };
      setScreen("game");
    };
    initGame();
  }, [screen, api, room]);

  // ─── NON-ASSET ROLE JOIN (NESO, ELEXON, TRADER, SUPPLIER) ───
  useEffect(() => {
    if (screen !== "game_no_asset") return;
    const id = pid || getOrCreatePlayerId();
    setPid(id);
    setAsset("NONE");
    setSoc(100);
    if (role === "TRADER") setCash(5000);
    if (api && room) {
      const assignedRole = isInstructor ? "instructor" : role;
      api.putPlayer(room, id, {
        name: name.trim(),
        asset: "NONE",
        cash: role === "TRADER" ? 5000 : 0,
        da_cash: 0,
        sof: 100,
        role: assignedRole,
        status: 'ACTIVE'
      });
      api.updateRoom(room, { scenarioId });
    }
    // Always fetch and apply the latest state after join/rejoin for non-asset roles
    const fetchAndApplyState = async () => {
      try {
        if (api && room) {
          const state = await api.engineGetState(room);
          if (state) {
            // Engine returns dayPhase/currentSp; fallback to phase/sp for legacy compat
            if (state.dayPhase) setPhase(state.dayPhase);
            else if (state.phase) setPhase(state.phase);
            if (state.currentSp !== undefined) setSp(state.currentSp);
            else if (state.sp !== undefined) setSp(state.sp);
            if (state.day !== undefined) setDay(state.day);
            if (state.bmSubPhase !== undefined) setBmSubPhase(state.bmSubPhase);
            if (state.players) setPlayers(state.players);
            if (state.orderBook) setOrderBook(state.orderBook);
            if (state.daOrderBook) setDaOrderBook(state.daOrderBook);
            if (state.idOrderBook) setIdOrderBook(state.idOrderBook);
            if (state.spHistory) setSpHistory(state.spHistory);
            if (state.forecasts) setForecasts(state.forecasts);
            if (state.publishedForecast) setPublishedForecast(state.publishedForecast);
            if (state.roomScenario) setRoomScenario(state.roomScenario);
            if (state.spContracts) setSpContracts(state.spContracts);
            // Server-authoritative: use markets from engine/state response.
            if (state.markets && Object.keys(state.markets).length > 0) {
              refinedMarketsRef.current = state.markets;
              const curSp = Math.max(1, state.currentSp || state.sp || 1);
              if (refinedMarketsRef.current[curSp]) setMarket(refinedMarketsRef.current[curSp]);
            } else {
              refinedMarketsRef.current = {};
            }
            if (state.soc !== undefined) setSoc(state.soc);
            if (state.cash !== undefined) setCash(state.cash);
            if (state.daCash !== undefined) setDaCash(state.daCash);
            if (state.positions) setPositions(state.positions);
            if (state.contracts) setContracts(state.contracts);
            if (state.daPositions?.[id]) setDaPositions(state.daPositions[id]);
            if (state.imbalancePenalty !== undefined) setImbalancePenalty(state.imbalancePenalty);
            if (state.earnedAchievements) setEarnedAchievements(state.earnedAchievements);
            if (state.gameMode) setGameMode(state.gameMode);
            if (state.role) setRole(state.role);
            if (state.daCurves) setDaCurves(state.daCurves);
            if (state.daAuctionResults) setDaAuctionResults(state.daAuctionResults);
            if (state.playerScores) setPlayerScores(state.playerScores);
            if (state.systemState) setSystemState(state.systemState);
            if (state.overallScoreHistory) setOverallScoreHistory(state.overallScoreHistory);
            if (state.physicalState) setPhysicalState(state.physicalState);
            if (state.portfolio) setPortfolio(state.portfolio);
            if (state.activeAssetIdx !== undefined) setActiveAssetIdx(state.activeAssetIdx);
            if (state.portfolioSocs) setPortfolioSocs(state.portfolioSocs);
            if (state.portfolioCash) setPortfolioCash(state.portfolioCash);
            if (state.tutorialStep !== undefined) setTutorialStep(state.tutorialStep);
            if (state.tutorialActive !== undefined) setTutorialActive(state.tutorialActive);
            if (state.replayData) setReplayData(state.replayData);
            if (state.replayIdx !== undefined) setReplayIdx(state.replayIdx);
            if (state.showDebrief !== undefined) setShowDebrief(state.showDebrief);
            // Sync timer state so auto-advance fires correctly at FORECAST_0
            if (state.phaseStartTs) setPhaseStartTs(state.phaseStartTs);
            if (state.tickSpeed) setTickSpeed(state.tickSpeed);
          }
        }
      } catch (err) {
        console.error('[App] Failed to fetch/apply latest state after join (no-asset role):', err);
      }
      prevPhaseRef.current = { phase: refs.current.phase, sp: refs.current.sp, bmSubPhase: refs.current.bmSubPhase };
      setScreen("game");
    };
    fetchAndApplyState();
  }, [screen, api, room]);

  useEffect(() => {
    if (screen !== "game" || !api || !room) return;
    setOrderBook({}); setDaOrderBook({}); setIdOrderBook({});
    const spForBooks = sp > 0 ? sp : 1;
    const daCycle = Math.floor(spForBooks / DA_CYCLE);
    
    // Subscribe to BM order book
    const unsubBm = subscribe(`room:${room}:bm:${spForBooks}`, (data) => {
      if (data && typeof data === 'object') {
        const pid = data.id || data.player_id;
        if (pid) {
          setOrderBook(prev => ({ ...prev, [pid]: data }));
        } else {
          setOrderBook(prev => ({ ...prev, ...data }));
        }
      }
    });
    
    // Subscribe to DA order book
    const unsubDa = subscribe(`room:${room}:da:${daCycle}`, (data) => {
      if (data && typeof data === 'object') {
        const pid = data.id || data.player_id;
        if (pid) {
          setDaOrderBook(prev => ({ ...prev, [pid]: data }));
        } else {
          setDaOrderBook(prev => ({ ...prev, ...data }));
        }
      }
    });
    
    // Subscribe to ID order book
    const unsubId = subscribe(`room:${room}:id:${spForBooks}`, (data) => {
      if (data && typeof data === 'object') {
        const pid = data.id || data.player_id;
        if (pid) {
          setIdOrderBook(prev => ({ ...prev, [pid]: data }));
        } else {
          setIdOrderBook(prev => ({ ...prev, ...data }));
        }
      }
    });
    
    // Subscribe to DA curve submissions
    const unsubDaCurves = subscribe(`room:${room}:da_curves`, (data) => {
      if (data && typeof data === 'object') {
        const pid = data.player_id || data.id;
        if (pid && data.segments) {
          setDaCurves(prev => ({ ...prev, [pid]: { ...data, playerId: pid } }));
          return;
        }
        Object.entries(data).forEach(([id, curve]) => {
          if (curve && curve.segments) {
            setDaCurves(prev => ({ ...prev, [id]: { ...curve, playerId: id } }));
          }
        });
      }
    });

    // Subscribe to live NIV updates during BM_OPEN
    const unsubBmNiv = subscribe(`room:${room}:bm_niv_update`, (data) => {
      if (data && typeof data === 'object') {
        setLiveNivData(data);
      }
    });

    return () => {
      unsubBm?.();
      unsubDa?.();
      unsubId?.();
      unsubDaCurves?.();
      unsubBmNiv?.();
    };
  }, [sp, screen, room, api, subscribe]);

  const instructorNextPhase = useCallback(async () => {
    if (!api || !room) return;
    if (advanceInFlightRef.current) return;
    advanceInFlightRef.current = true;

    const {
      phase: currentPhase,
      sp: expectedSp,
      bmSubPhase: expectedBmSubPhase,
    } = refs.current;
    const expectedState = {
      expectedDayPhase: currentPhase,
      expectedSp,
      expectedBmSubPhase,
    };

    try {
      // Unified advance — server routes internally (day/ID-sub-round/BM)
      const result = await api.engineAdvanceGame(room, expectedState);
      if (result) {
        // Eagerly apply authoritative state so refs.current stays in sync
        if (result.dayPhase || result.newPhase) setPhase(result.dayPhase || result.newPhase);
        if (result.currentSp !== undefined) setSp(result.currentSp);
        if (result.bmSubPhase !== undefined) {
          setBmSubPhase(result.bmSubPhase);
          if (result.bmSubPhase !== "BM_OPEN") setLiveNivData(null);
        }
        if (result.phaseStartTs) setPhaseStartTs(result.phaseStartTs);
        if (result.tickSpeed) setTickSpeed(result.tickSpeed);
        const label = currentPhase === "REALTIME"
          ? `SP ${result.currentSp || ''} — ${result.bmSubPhase || ''}`
          : `Moved to ${result.dayPhase || result.newPhase || 'next phase'}`;
        const emoji = currentPhase === "REALTIME" ? "⚡" : "✅";
        addToast({ emoji, title: "Phase Advanced", body: label, col: "#b78bfa" });
      }
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (msg.includes("API error: 409")) {
        // Stale-state conflict: resync from server to break 409 loops
        try {
          const state = await api.engineGetState(room);
          if (state) {
            if (state.dayPhase) setPhase(state.dayPhase);
            if (state.currentSp !== undefined) setSp(state.currentSp);
            if (state.bmSubPhase !== undefined) setBmSubPhase(state.bmSubPhase);
            if (state.phaseStartTs) setPhaseStartTs(state.phaseStartTs);
            if (state.tickSpeed) setTickSpeed(state.tickSpeed);
          }
        } catch (_) {}
        return;
      }
      throw err;
    } finally {
      advanceInFlightRef.current = false;
    }
  }, [api, room, addToast]);

  // Player-Ready: fire-and-forget signal to server that this player has completed their phase work
  const signalReady = useCallback(async () => {
    if (!api || !room) return;
    const { pid: id, phase: ph, role: r, name: n } = refs.current;
    if (!id || r === 'NESO' || r === 'ELEXON') return;
    try { await api.playerSignalReady(room, { playerId: id, phase: ph, role: r, name: n }); } catch (_) {}
  }, [api, room]);

  // 1. RE-COMPUTE MARKET WHEN SP/PHASE/FORECAST CHANGES
  useEffect(() => {
    if (screen !== "game") return;
    console.log('[App] Phase changed to:', phase, 'SP:', sp);

    // Bug 7 fix (correct approach): JS engine is the primary market authority.
    // After FORECAST_1/2 broadcasts, refinedMarketsRef holds idaForecast()-blended
    // values that match the Python server exactly. Fall back to raw marketForSp() for
    // FORECAST_0 or before any refinement arrives.
    const refinedMkt = refinedMarketsRef.current[sp || 1] ||
                       (sp === 0 ? refinedMarketsRef.current[1] : null);
    if (!refinedMkt) return; // Wait for server-broadcast markets
    const mState = refinedMkt;
    setMarket(mState);
    setForecasts(computeForecasts(sp, scenarioId, publishedForecast));

    if (mState.actual?.event && mState.actual.event.id !== lastEventRef.current) {
      lastEventRef.current = mState.actual.event.id;
      if (["ID", "ID_ROUNDS", "BM", "BM_OPEN", "BM_CLEAR", "BM_CLOSE", "REALTIME"].includes(phase)) {
        addToast({ emoji: mState.actual.event.emoji, title: mState.actual.event.name, body: mState.actual.event.desc, col: mState.actual.event.col });
      }
    }
  }, [sp, phase, scenarioId, screen, addToast, publishedForecast]);

  // 2. GLOBAL TIMER (Visual only, Instructor Auto-Advances)
  useEffect(() => {
    if (screen !== "game" || blackout) return;
    const loop = setInterval(() => {
      const { phaseStartTs: pts, tickSpeed: ts, isInstructor, paused: isPaused, gameMode, advanceMode: mode } = refs.current;
      if (isPaused || !pts) return;

      const elapsed = Date.now() - pts;
      const remaining = Math.max(0, ts - elapsed);
      setMsLeft(remaining);

      // Auto-advance only when AUTO mode (MANUAL = NESO clicks only)
      if (remaining <= 0 && isInstructor && mode !== "MANUAL") {
        instructorNextPhase();
      }

      // GRID FAILURE CHECK
      const curPhase = refs.current.phase;
      const m = ["FORECAST_0", "FORECAST_1", "FORECAST_2", "FORECAST", "DA", "IDA1", "IDA2", "ID", "ID_ROUNDS"].includes(curPhase) ? market?.forecast : market?.actual;
      if (m) {
        const freqLimit = gameMode === "TUTORIAL" ? FORGIVENESS.freqFailDuration : FREQ_FAIL_DURATION;
        if (m.freq < FREQ_FAIL_LO || m.freq > FREQ_FAIL_HI) {
          setFreqBreachSec(prev => {
            const next = prev + 1;
            if (next >= freqLimit) {
              setBlackout(true);
              addToast({ emoji: "💀", title: "GRID FAILURE", body: `Frequency breached safe limits for ${freqLimit}s — ALL PLAYERS LOSE`, col: "#f0455a" });
            }
            return next;
          });
        } else {
          setFreqBreachSec(0);
        }
      }
    }, 1000);
    return () => clearInterval(loop);
  }, [screen, blackout, market, instructorNextPhase]);

  // 3. PHASE TRANSITION STATE MACHINE
  useEffect(() => {
    const prev = prevPhaseRef.current;
    if (phase === prev.phase && sp === prev.sp && bmSubPhase === prev.bmSubPhase) return;
    const old = { ...prev };
    prevPhaseRef.current = { phase, sp, bmSubPhase };

    // Detect BM sub-phase transitions during REALTIME
    const bmJustClosed = (phase === "REALTIME" && (bmSubPhase === "BM_CLEAR" || bmSubPhase === "BM_CLOSE") && old.bmSubPhase === "BM_OPEN");
    const bmJustOpened = (phase === "REALTIME" && bmSubPhase === "BM_OPEN" && (old.bmSubPhase === "BM_CLEAR" || old.bmSubPhase === "BM_CLOSE" || old.bmSubPhase === "SP_SETTLED"));

    const { pid: id, name: n, room: rm, asset: ak, orderBookSnap, daOrderBookSnap, soc: s, gameMode } = refs.current;

    // --- AUCTION CLOSED (DA / IDA1 / IDA2) ---
    // NOTE: This block runs BEFORE the !market guard so that a race between state
    // updates never silently drops the auction-close logic (Bug 2 + Bug 3 fix).
    const isAuctionClose = ["DA", "IDA1", "IDA2"].includes(old.phase);
    if (isAuctionClose && old.phase !== "INIT") {
      // ── Prefer server-authoritative results from the broadcast (Bug 3 fix) ──
      const serverDaResults = lastDaBroadcastRef.current; // { sp → {cp, volume, accepted_bids} }
      let fullResult = null;

      if (serverDaResults && Object.keys(serverDaResults).length > 0) {
        // Convert server format → client format: { prices[48], volumes:{pid:[48]} }
        const prices = new Array(48).fill(50);
        const volumes = {};
        for (let spk = 1; spk <= 48; spk++) {
          const r = serverDaResults[spk] || serverDaResults[String(spk)];
          if (!r) continue;
          prices[spk - 1] = r.cp ?? 50;
          for (const bid of (r.accepted_bids || [])) {
            if (!volumes[bid.id]) volumes[bid.id] = new Array(48).fill(0);
            // side="offer" → seller → negative volume (client convention for sellers)
            volumes[bid.id][spk - 1] = bid.side === "offer" ? -(bid.mwAcc ?? 0) : (bid.mwAcc ?? 0);
          }
        }
        fullResult = { prices, volumes, pmax: {}, spDetails: [] };
        // Clear ref so a stale result can't be replayed by a future IDA close
        lastDaBroadcastRef.current = null;
      } else {
        // Server-authoritative: DA clearing always handled server-side.
        // If daResults broadcast was missed, the next phase advance will re-send.
        console.warn("[App] DA results not yet received from server");
      }

      if (fullResult) {

        setDaAuctionResults(fullResult);

        // Fill ALL 48 SP positions from auction results
        const myVolumes = fullResult.volumes[id] || new Array(48).fill(0);
        setPositions([...myVolumes]);         // Auction volumes → position array
        if (old.phase === "DA") setDaPositions([...myVolumes]); // Keep DA-only snapshot for UI

        // Store per-SP contracts for settlement ledger
        setSpContracts(prev => {
          const next = { ...prev };
          for (let spk = 1; spk <= 48; spk++) {
            const spIdx = spk - 1;
            const cp = fullResult.prices[spIdx] || 50;
            if (!next[spk]) next[spk] = {};
            // Iterate players from fullResult.volumes (works for both server & client results)
            for (const [playerId, vols] of Object.entries(fullResult.volumes)) {
              const vol = (vols && vols[spIdx]) || 0;
              if (!next[spk][playerId]) next[spk][playerId] = {};
              next[spk][playerId].daMw = Math.abs(vol);
              next[spk][playerId].daPrice = cp;
              next[spk][playerId].daSide = vol >= 0 ? "bid" : "offer";
            }
          }
          return next;
        });

        // Show DA result for current SP
        const spIdx = old.sp - 1;
        const cp = fullResult.prices[spIdx] || 50;
        const myVol = myVolumes[spIdx] || 0;
        // Estimate total DA revenue across all 48 SPs
        const totalDaRev = myVolumes.reduce((sum, vol, i) => {
          const p = fullResult.prices[i] || 50;
          const rev = Math.abs(vol) * p * SP_DURATION_H;
          return sum + (vol < 0 ? rev : -rev); // sellers earn, buyers pay
        }, 0);
        setDaCash(totalDaRev);

        const auctionLabel = old.phase === "DA" ? "DA" : old.phase;
        if (Math.abs(myVol) > 0.01) {
          setDaResult({ accepted: true, revenue: totalDaRev, cp, mw: Math.abs(myVol), curveCleared: true, allVolumes: myVolumes, allPrices: fullResult.prices });
          const totalMw = myVolumes.reduce((s, v) => s + Math.abs(v), 0);
          addToast({ emoji: "📋", title: `${auctionLabel} Auction Cleared (48 SPs)`, body: `Total: ${f0(totalMw)}MW across 48 SPs. SP${old.sp}: ${myVol > 0 ? "BUY" : "SELL"} ${f0(Math.abs(myVol))}MW @ £${f1(cp)}`, col: "#f5b222" });
        } else {
          setDaResult({ accepted: false, revenue: 0, cp, mw: 0, curveCleared: true, allVolumes: myVolumes, allPrices: fullResult.prices });
        }
      } else {
        // No server results arrived for this auction — data will arrive via server broadcast.
        // Removed legacy clearDA() fallback: client-side re-clearing was incorrect because
        // it only had access to one SP's worth of bids and produced divergent results from
        // the server's full 48-SP EPEX clearing.
        console.warn('[App] Auction close with no server results captured — results should arrive via broadcast');
        setDaResult(null);
      }
      setDaSubmitted(false);
    }

    // For all non-auction transitions, market must be loaded and phase must not be INIT
    if (old.phase === "INIT" || !market) return;

    // --- ID CLOSED ---
    // Phase 4: use server's ID clearing result (from day_phase_change broadcast stored in
    // lastIdPlayerSummariesRef) instead of re-running the two-sided matching locally.
    if (old.phase === "ID" || old.phase === "ID_ROUNDS") {
      const serverIdSummaries = lastIdPlayerSummariesRef.current || {};

      // Build per-SP spContracts entries from server's positionDeltas (all players)
      setSpContracts(prev => {
        const next = { ...prev };
        for (const [pid, summary] of Object.entries(serverIdSummaries)) {
          const posDeltas = summary.positionDeltas || {};
          for (const [spStr, deltaMw] of Object.entries(posDeltas)) {
            const spNum = Number(spStr);
            if (!next[spNum]) next[spNum] = {};
            if (!next[spNum][pid]) next[spNum][pid] = {};
            next[spNum][pid].idMw = Math.abs(deltaMw);
            next[spNum][pid].idPrice = summary.avgPrice || 0;
            next[spNum][pid].idSide = deltaMw > 0 ? "offer" : "bid";
          }
        }
        return next;
      });

      // Apply my position delta(s) per SP and show toast.
      // Uses per-SP deltas from server summary to correctly update all 48 SP slots —
      // the old setContractPosition(prev + netDelta) only patched the current SP slot.
      const myIdSum = serverIdSummaries[id];
      if (myIdSum && myIdSum.mwMatched > 0) {
        const posDeltas = myIdSum.positionDeltas || {};
        if (Object.keys(posDeltas).length > 0) {
          setPositions(prev => {
            const next = [...prev];
            for (const [spStr, delta] of Object.entries(posDeltas)) {
              const idx = Number(spStr) - 1;
              if (idx >= 0 && idx < 48) next[idx] = (next[idx] || 0) + delta;
            }
            return next;
          });
        }
        addToast({
          emoji: "🤝",
          title: "ID Trade Executed",
          body: `${myIdSum.side === "offer" ? "SOLD" : "BOUGHT"} ${f0(myIdSum.mwMatched)}MW @ £${myIdSum.avgPrice.toFixed(2)}`,
          col: "#38c0fc"
        });
      }

      setIdSubmitted(false);
    }

    // --- BM CLOSED (Actual Delivery) ---
    // Phase 3: use the server's BM result (from bm_advance broadcast stored in lastBmResultRef)
    // instead of re-running the merit-order algorithm client-side.
    if (old.phase === "BM" || old.phase === "BM_OPEN" || old.phase === "BM_CLEAR" || bmJustClosed) {
      const res = lastBmResultRef.current || { accepted: [], cp: 0, cleared: 0, niv: 0 };
      // Server BM result already contains updated market state; no client-side feedbackMarketState needed.
      const mine = res.accepted?.find(a => a.id === id || a.player_id === id);

      const myDef = { ...ASSETS[ak], ...(refs.current.assetConfig || {}) };
      // SoC: use server-provided value (server calls update_sof in _on_bm_close_sp).
      const serverUpd = lastBmPlayerUpdatesRef.current?.[id];
      const newS = serverUpd?.soc ?? s;
      setSoc(newS);

      // Startup cost: charge only if asset was OFFLINE before BM cleared.
      let startupDeduction = 0;
      if (mine && myDef.startupCost) {
        const prevSpPhysical = spContracts[old.sp - 1]?.[id]?.physicalAtEndOfSp;
        const wasOnlineBefore = prevSpPhysical?.status === "ONLINE";
        if (!wasOnlineBefore) {
          startupDeduction = myDef.startupCost;
        }
      }

      setSpContracts(prev => {
        const next = { ...prev };
        if (!next[old.sp]) next[old.sp] = {};
        for (const b of (res.accepted || [])) {
          if (b.isBot && (b.id || b.player_id || "").startsWith("BOT_")) continue;
          const bPid = b.id || b.player_id;
          if (!bPid) continue;
          if (!next[old.sp][bPid]) next[old.sp][bPid] = {};
          next[old.sp][bPid].bmAccepted = { mw: b.mwAcc, price: res.cp, rev: b.revenue, side: b.side };
        }
        return next;
      });

      const netRevenue = (mine?.revenue || 0) - startupDeduction + (mine ? myDef.cmPayment || 0 : 0);
      setLastRes({ accepted: !!mine, revenue: netRevenue, cp: res.cp, mw: mine?.mwAcc || 0, sp: old.sp, isShort: !!res.isShort, myPrice: mine?.price, prevSof: s, newSof: newS, wearCost: mine?.wearCost || 0, startupCost: startupDeduction, cmPayment: mine ? myDef.cmPayment || 0 : 0 });
      setSubmitted(false);
    }

    // --- ENTERING SETTLEMENT (Elexon Calculation) ---
    // Skip settlement on RESULTS if coming from REALTIME — each SP was already settled on BM_CLOSE
    const skipResultsSettlement = (phase === "RESULTS" && old.phase === "REALTIME");
    if (!skipResultsSettlement && (phase === "SETTLED" || phase === "RESULTS" || phase === "BM_CLOSE" || phase === "BM_CLEAR" || phase === "SP_SETTLED" || bmJustClosed)) {
      const settleSp = old.sp; // Use the SP that just completed, NOT the current sp
      // Bug #11 fix: capture the market state NOW before the timeout fires.
      const settledMarket = market;
      // Phase 3: capture server settlement data synchronously before the 300ms async gap.
      const serverUpd = lastBmPlayerUpdatesRef.current?.[id] ?? null;
      setTimeout(() => {
        const myDef = { ...ASSETS[ak], ...(refs.current.assetConfig || {}) };
        const contractPosMw = serverUpd?.contractPosMw ?? refs.current.contractPosition;
        let actualPhysical = serverUpd?.actualPhysical
          ?? (contractPosMw + (refs.current.spContracts[settleSp]?.[id]?.bmAccepted
            ? (settledMarket.actual.isShort
              ? refs.current.spContracts[settleSp][id].bmAccepted.mw
              : -refs.current.spContracts[settleSp][id].bmAccepted.mw)
            : 0));

        // ─── ROLE-SPECIFIC PHYSICAL STATE (UI feedback only) ───
        // These update physicalState for the role UI panels (generator MW display,
        // BESS SoC gauges, DSR rebound countdown). Cash/settlement comes from the server.
        let pState = { ...refs.current.physicalState };
        const isGenerator = ["fuel", "wind", "solar", "nuclear"].includes(myDef.kind);
        const isStorage = myDef.kind === "soc";

        if (isGenerator) {
          if (pState.status !== "ONLINE") {
            if (pState.status === "STARTING") {
              pState.spUntilOnline -= 1;
              if (pState.spUntilOnline <= 0) pState.status = "ONLINE";
            }
          } else {
            if (myDef.minMw && actualPhysical > 0 && actualPhysical < myDef.minMw) {
              pState.status = "OFFLINE";
              addToast({ emoji: "⚠️", title: "Plant Tripped", body: `Dispatched below minimum stable (${myDef.minMw}MW). Plant is now OFFLINE.`, col: "#f0455a" });
            }
            const maxRamp = myDef.rampRate || 9999;
            if (actualPhysical > pState.currentMw + maxRamp) actualPhysical = pState.currentMw + maxRamp;
            else if (actualPhysical < pState.currentMw - maxRamp) actualPhysical = pState.currentMw - maxRamp;
          }
          pState.currentMw = actualPhysical;
          setPhysicalState(pState);
        }

        if (settledMarket.actual.trippedAssets?.includes(ak)) {
          const isDsr = myDef.kind === "dsr";
          if (!(isDsr && pState.pendingReboundMwh > 0 && pState.reboundSpsRemaining === 0)) {
            actualPhysical = 0;
          }
          if (isGenerator) setPhysicalState(prev => ({ ...prev, status: "OFFLINE", currentMw: 0 }));
        }

        if (isStorage) {
          // SoC-gate cropping for UI consistency (server soc is authoritative via setSoc() above)
          const maxDischargeMwh = (refs.current.soc / 100) * myDef.maxMWh;
          const maxChargeMwh = myDef.maxMWh - maxDischargeMwh;
          if (actualPhysical > 0) {
            const reqMwh = (actualPhysical * SP_DURATION_H) / (myDef.eff || 1);
            if (reqMwh > maxDischargeMwh) actualPhysical = (maxDischargeMwh * (myDef.eff || 1)) / SP_DURATION_H;
          } else if (actualPhysical < 0) {
            const reqChargeMwh = Math.abs(actualPhysical) * SP_DURATION_H * (myDef.eff || 1);
            if (reqChargeMwh > maxChargeMwh) actualPhysical = -(maxChargeMwh / (myDef.eff || 1)) / SP_DURATION_H;
          }
        }

        if (myDef.kind === "dsr") {
          const isCurtailing = actualPhysical > 0;
          if (pState.reboundSpsRemaining > 0) {
            actualPhysical = -(pState.pendingReboundMwh / SP_DURATION_H);
            pState.reboundSpsRemaining -= 1;
            if (pState.reboundSpsRemaining <= 0) {
              pState.pendingReboundMwh = 0;
              pState.curtailSpsRemaining = myDef.maxCurtailDuration || 2;
            }
            setPhysicalState(pState);
          } else if (isCurtailing) {
            pState.curtailSpsRemaining -= 1;
            pState.pendingReboundMwh += (actualPhysical * SP_DURATION_H) * (myDef.reboundMultiplier || 1.2);
            if (pState.curtailSpsRemaining <= 0) {
              pState.reboundSpsRemaining = myDef.reboundDuration || 1;
              addToast({ emoji: "⚠️", title: "Forced Rebound", body: `DSR max duration reached. Forced to buy back ${f0(pState.pendingReboundMwh)} MWh next SP.`, col: "#f0455a" });
            }
            setPhysicalState(pState);
          } else if (pState.curtailSpsRemaining < (myDef.maxCurtailDuration || 2)) {
            if (actualPhysical < 0) {
              pState.pendingReboundMwh = Math.max(0, pState.pendingReboundMwh - Math.abs(actualPhysical) * SP_DURATION_H);
              if (pState.pendingReboundMwh === 0) pState.curtailSpsRemaining = myDef.maxCurtailDuration || 2;
            }
            setPhysicalState(pState);
          }
        }

        // ─── SERVER-AUTHORITATIVE FINANCIALS ───
        const newC = serverUpd?.cash ?? refs.current.cash;
        const imbPen = serverUpd?.imbalancePenalty ?? 0;
        const bsuoSCharge = serverUpd?.bsuosCharge ?? 0;
        const totalSpRev = serverUpd?.cashDelta ?? 0;
        const deviation = serverUpd?.deviation ?? (actualPhysical - contractPosMw);

        // Margin liquidation for traders (positional)
        if (role === "TRADER" && (newC + refs.current.daCash) < ROLES.TRADER.marginFloor) {
          setContractPosition(0);
          addToast({ emoji: "💥", title: "Margin Call", body: `Cash fell below margin floor. Position liquidated.`, col: "#f0455a" });
        }
        setCash(newC);

        // Store physical state at end of SP for next SP's startup cost determination
        setSpContracts(prev => {
          const next = { ...prev };
          if (!next[settleSp]) next[settleSp] = {};
          if (!next[settleSp][id]) next[settleSp][id] = {};
          next[settleSp][id].physicalAtEndOfSp = { status: pState.status, currentMw: pState.currentMw };
          return next;
        });

        if (imbPen < -5) {
          setImbalancePenalty(prev => prev + Math.abs(imbPen));
          addToast({ emoji: "⚠️", title: "Imbalance Penalty", body: `Deviated ${f0(Math.abs(deviation))}MW! -£${f0(Math.abs(imbPen))}`, col: "#f0455a" });
        }

        const mine = lastBmResultRef.current?.accepted?.find(a => a.id === id || a.player_id === id);
        setSpHistory(prev => [{
          sp: settleSp,
          niv: settledMarket.actual.niv,
          indicativeNiv: settledMarket.forecast?.indicativeNiv,
          forecastSbp: settledMarket.forecast?.sbp,
          forecastSsp: settledMarket.forecast?.ssp,
          cp: settledMarket.actual.sbp,
          sbp: settledMarket.actual.sbp,
          ssp: settledMarket.actual.ssp,
          wf: settledMarket.actual.wf,
          revenue: totalSpRev,
          event: settledMarket.actual.event,
          contractPosMw,
          actualPhysical,
          imbPrc: settledMarket.actual.isShort ? settledMarket.actual.sbp * 1.05 : settledMarket.actual.ssp * 0.95,
          imbPen,
          daRev: 0,
          bmRev: mine?.revenue || 0,
          idRev: 0,
          operatingCost: totalSpRev - (mine?.revenue || 0) - (imbPen || 0) - (bsuoSCharge || 0),
          accepted: !!mine,
          mw: mine?.mwAcc || 0,
          time: new Date().toLocaleTimeString()
        }, ...prev.slice(0, 47)]);

        if (api && rm) {
          const assignedRole = refs.current.isInstructor ? "instructor" : refs.current.role;
          api.putPlayer(rm, id, { name: n, asset: ak, cash: newC, sof: refs.current.soc, role: assignedRole });
        }
        setReplayData(prev => [...prev, { sp, market, orderBook: refs.current.orderBookSnap }].slice(-200));
      }, 300);
    }

    // --- ENTERING NEW SP ---
    // Position is NOT reset — it persists from DA across all 48 SPs.
    // Only clear per-SP UI results. Position[SP] was filled by DA, modified by ID.
    if (old.sp !== sp) {
      // Freeze the old SP's position as its contract (gate closure)
      setContracts(prev => {
        const next = [...prev];
        next[Math.max(0, old.sp - 1)] = refs.current.positions[Math.max(0, old.sp - 1)] || 0;
        return next;
      });
      setDaResult(null);
      setLastRes(null);
    }
  }, [phase, sp, bmSubPhase]);

  // Keep refs in sync for pause, tickSpeed, gameMode, scoring state
  useEffect(() => { refs.current.paused = paused; }, [paused]);
  useEffect(() => { refs.current.tickSpeed = tickSpeed; }, [tickSpeed]);
  useEffect(() => { refs.current.gameMode = gameMode; }, [gameMode]);
  useEffect(() => { refs.current.systemState = systemState; }, [systemState]);
  useEffect(() => { refs.current.imbalancePenalty = imbalancePenalty; }, [imbalancePenalty]);
  useEffect(() => { refs.current.spHistory = spHistory; }, [spHistory]);

  // Server-authoritative: achievements are computed server-side after each SP_SETTLED
  // and broadcast via room:\:achievements. The WS handler (subscribe block above)
  // merges new IDs into earnedAchievements and shows toasts. No client-side checking needed.

  // ─── IMBALANCE SETTLEMENT ───
  // REMOVED: Duplicate imbalance penalty calculation. Imbalance is already handled
  // in the SETTLED phase transition block above (lines ~386-412) which correctly
  // calculates deviation and applies imbPen to the total SP revenue.


  // Instructor speed/pause sync via API
  const instructorSetSpeed = useCallback((speedId) => {
    const sp = TICK_SPEEDS[speedId];
    if (!sp) return;
    setTickSpeed(sp.ms);
    if (api && room) api.updateRoom(room, { tickSpeed: sp.ms });
    addToast({ emoji: sp.emoji, title: "Tick speed changed", body: sp.label, col: "#b78bfa" });
  }, [api, room, addToast]);

  const instructorTogglePause = useCallback(() => {
    setPaused(p => {
      const next = !p;
      if (api && room) api.updateRoom(room, { paused: next });
      addToast({ emoji: next ? "⏸️" : "▶️", title: next ? "GAME PAUSED" : "GAME RESUMED", body: next ? "Instructor has frozen the game for discussion" : "Game is live again", col: next ? "#f5b222" : "#1de98b" });
      return next;
    });
  }, [api, room, addToast]);

  const instructorSetAdvanceMode = useCallback((mode) => {
    if (mode !== "MANUAL" && mode !== "AUTO") return;
    setAdvanceMode(mode);
    if (api && room) api.updateRoom(room, { advanceMode: mode });
    addToast({ emoji: mode === "MANUAL" ? "🖱️" : "⏱️", title: `Advance: ${mode}`, body: mode === "MANUAL" ? "Click to advance each phase" : "Timer auto-advances phases", col: "#b78bfa" });
  }, [api, room, addToast]);

  const instructorSetSimSpeed = useCallback((speedId) => {
    const preset = SIM_SPEEDS[speedId];
    if (!preset) return;
    setSimSpeedId(speedId);
    if (api && room) api.updateRoom(room, { simSpeedId: speedId, simSpeedFactor: preset.factor });
    addToast({ emoji: preset.emoji, title: "Sim speed changed", body: preset.label, col: "#b78bfa" });
  }, [api, room, addToast]);

  useEffect(() => { refs.current.orderBookSnap = orderBook; }, [orderBook]);
  useEffect(() => { refs.current.daOrderBookSnap = daOrderBook; }, [daOrderBook]);

  const submitBid = useCallback(() => {
    const { submitted: sub, pid: id, name: n, soc: s, sp: t, room: rm, asset: ak, assetConfig, role, phase: currentPhase, msLeft: remainingMs } = refs.current;
    if (!api || !id) return;
    // Gate closure: BM bids only allowed during BM phase and before timer expiry
    if (!canSubmitBmBid(currentPhase, remainingMs)) {
      addToast({ emoji: "🚫", title: "BM Gate Closed", body: `Gate closed — bids for SP ${t} are no longer accepted.`, col: "#f0455a" });
      return;
    }
    if (sub) return;
    if (!myBid.price || isNaN(+myBid.price) || +myBid.mw <= 0) return;
    const m = refinedMarketsRef.current[t] || market;
    const isTraderRole = ROLES[role]?.canOwnAssets === false;
    const def = { ...ASSETS[ak], ...(assetConfig || {}) };

    // Use the exact same market evaluation as the host screen does, safely resolving isShort from the market object
    const isSystemShort = m?.actual?.isShort ?? m?.forecast?.isShort ?? m?.isShort ?? false;
    const bidSide = isTraderRole && myBid.side ? myBid.side : (isSystemShort ? "offer" : "bid");

    // For BM phase, validate against directional availability (BESS can bid either way)
    let avail;
    if (isTraderRole) {
      avail = Infinity;
    } else if (def.kind === "soc") {
      const directional = availMWDirectional(def, s);
      avail = bidSide === "offer" ? directional.discharge : directional.charge;
    } else {
      avail = availMW(def, s, m);
    }
    if (!isTraderRole && +myBid.mw > avail + 0.5) { alert(`⚠ Max available: ${f0(avail)} MW`); return; }

    const bid = { id, name: n, asset: ak, mw: +myBid.mw, price: +myBid.price, side: bidSide, col: def.col, isBot: false };
    setSubmitted(true); setOrderBook(p => ({ ...p, [id]: bid }));
    api.putBmBid(rm, t, id, bid)
      .then(() => {
        signalReady();
        addToast({ emoji: "📤", title: "BM bid submitted", body: `${f0(myBid.mw)}MW @ £${myBid.price}/MWh`, col: "#38c0fc" });
      })
      .catch(err => {
        setSubmitted(false);
        setOrderBook(p => { const n2 = { ...p }; delete n2[id]; return n2; });
        const detail = err?.message?.replace(/^API error: \d+ /, "") || "Bid rejected by server";
        addToast({ emoji: "⚠️", title: "BM Bid Rejected", body: detail, col: "#f0455a" });
      });
  }, [myBid, api, addToast, publishedForecast]);

  const submitDaBid = useCallback(() => {
    const { pid: id, name: n, room: rm, asset: ak, sp: t, role } = refs.current;
    if (!id || !api || daSubmitted) return;
    if (!daMyBid.price || isNaN(+daMyBid.price) || +daMyBid.mw <= 0) return;
    const m = refinedMarketsRef.current[t] || market; const def = ASSETS[ak] || { col: "#ffffff" };
    const daCycle = Math.floor(t / DA_CYCLE);
    const isTraderRole = ROLES[role]?.canOwnAssets === false;
    const bidSide = isTraderRole && daMyBid.side ? daMyBid.side : (m.forecast.isShort ? "offer" : "bid");
    const bid = { id, name: n, asset: ak, mw: +daMyBid.mw, price: +daMyBid.price, side: bidSide, col: def.col, isBot: false };
    api.putDaBid(rm, daCycle, id, bid);
    setDaSubmitted(true); refs.current.daSubmitted = true; setDaOrderBook(p => ({ ...p, [id]: bid }));
    signalReady();
    addToast({ emoji: "📋", title: "DA bid submitted", body: `${f0(daMyBid.mw)}MW @ £${daMyBid.price}/MWh`, col: "#f5b222" });
  }, [daMyBid, api, daSubmitted, addToast]);

  // ─── EPEX DA CURVE SUBMISSION (piecewise linear segments for all 48 SPs) ───
  const submitDaCurve = useCallback((curvePayload) => {
    const { pid: id, name: n, room: rm, asset: ak, role } = refs.current;
    const segments = Array.isArray(curvePayload)
      ? curvePayload
      : (curvePayload?.segments || []);
    const blocks = Array.isArray(curvePayload?.blocks)
      ? curvePayload.blocks
      : [];
    if (!id || !api || !segments || segments.length === 0) return;
    const def = ASSETS[ak] || {};
    // Determine side from asset type: generators/BESS sell, suppliers buy, traders both
    const r = ROLES[role] || {};
    const side = r.hasDemand ? "buy" : (r.canOwnAssets ? "sell" : "both");
    // Submit curve segments via API
    api.putDaCurve(rm, id, {
      segments,
      blocks,
      side,
      name: n,
      asset: ak,
      col: def.col || "#38c0fc",
      ts: Date.now(),
    });
    setDaCurveSegments(segments);
    setDaSubmitted(true);
    signalReady();
    const totalSPs = segments.reduce((s, seg) => s + (seg.spEnd - seg.spStart + 1), 0);
    const maxVol = Math.max(...segments.map(s => s.pmax));
    const blockText = blocks.length ? `, ${blocks.length} blocks` : "";
    addToast({ emoji: "📋", title: "DA Curve Submitted", body: `${segments.length} segments${blockText}, ${totalSPs} SPs, up to ${f0(maxVol)}MW`, col: "#f5b222" });
  }, [api, addToast]);

  const submitIdOrder = useCallback(() => {
    const { pid: id, name: n, room: rm, asset: ak, sp: t } = refs.current;
    if (!id || !api || !["ID", "ID_ROUNDS"].includes(phase) || idSubmitted) return;
    if (!idMyOrder.price || isNaN(+idMyOrder.price) || +idMyOrder.mw <= 0) return;
    const def = ASSETS[ak] || { col: "#ffffff" };
    const bid = { id, name: n, asset: ak, mw: +idMyOrder.mw, price: +idMyOrder.price, side: idMyOrder.side, col: def.col, isBot: false };
    api.putIdBid(rm, t, id, bid);
    setIdSubmitted(true); setIdOrderBook(p => ({ ...p, [id]: bid }));
    signalReady();
    addToast({ emoji: "🤝", title: "ID Order Placed", body: `${idMyOrder.side === "buy" ? "BUY" : "SELL"} ${f0(idMyOrder.mw)}MW @ £${idMyOrder.price}/MWh`, col: "#38c0fc" });
  }, [idMyOrder, phase, api, idSubmitted, addToast]);

  const instructorTrigger = useCallback((eventId) => {
    if (!api || !room) return;
    api.triggerEvent(room, eventId);
    addToast({ emoji: "🎓", title: "Event triggered", body: EVENTS.find(e => e.id === eventId)?.name || eventId, col: "#b78bfa" });
  }, [api, room, addToast]);

  const instructorSetScenario = useCallback((scId) => {
    if (!api || !room) return;
    api.updateRoom(room, { scenarioId: scId });
    addToast({ emoji: "🌍", title: "Scenario changed", body: SCENARIOS[scId]?.name || scId, col: "#f5b222" });
  }, [api, room, addToast]);

  const publishForecast = useCallback(async (forecastPayload) => {
    if (!api || !room) return null;
    try {
      const published = await api.enginePublishForecast(room, forecastPayload || {});
      if (published) {
        setPublishedForecast(published);
      }
      return published;
    } catch (err) {
      console.error('[Forecast] publish failed:', err);
      addToast({ emoji: '⚠️', title: 'Forecast publish failed', body: 'Could not publish forecast.', col: '#f0455a' });
      throw err;
    }
  }, [api, room, addToast]);

  // ─── MULTI-DIMENSIONAL LEADERBOARD ───
  // Prefer server-broadcast leaderboard (authoritative, computed from DB scores).
  // Fall back to local buildLeaderboard() recomputation only when no server data yet.
  const leaderboardData = useMemo(() => {
    if (serverLeaderboard?.overall) return serverLeaderboard;
    const activePlayers = Object.values(players).filter(p => p && p.name && Date.now() - (p.lastSeen || 0) < 120000)
      .map(p => ({
        ...p,
        cash: (p.cash || 0),
        roleScore: p.roleScore || playerScores[p.id]?.roleScore || 0,
        systemScore: p.systemScore || playerScores[p.id]?.systemScore || 50,
        overallScore: p.overallScore || playerScores[p.id]?.overallScore || 0,
        roleDetail: playerScores[p.id]?.roleDetail || null,
      }));
    return buildLeaderboard(activePlayers);
  }, [players, playerScores, serverLeaderboard]);
  const leaderboard = leaderboardData.overall;

  const allBids = [...Object.values(orderBook).filter(b => b && b.mw), ...(market?.actual?.bots || [])];
  const sc = SCENARIOS[roomScenario] || SCENARIOS.NORMAL;

  if (screen === "lobby") return <LobbyScreen name={name} setName={setName} room={room} setRoom={setRoom} ready={ready} onNext={() => {
    // pid is already initialized eagerly — just switch to waiting room
    setScreen("waiting_room");
  }} />;
  if (screen === "waiting_room") return <WaitingRoom api={api} room={room} name={name} pid={pid} setPid={setPid} role={role} setRole={setRole} setScreen={setScreen} isHost={isInstructor} setIsHost={setIsInstructor} gameMode={gameMode} setGameMode={setGameMode} scenarioId={scenarioId} setScenarioId={setScenarioId} players={players} setPlayers={setPlayers} roomState={roomState} connect={connect} />;
  if (screen === "asset") return <AssetScreen onSelect={handleJoin} playerName={name} room={room} scenario={sc} role={role} />;
  if (screen === "game_init" || screen === "game_no_asset") return (
    <div style={{ background: "#050e16", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: "#38c0fc" }}>
      <div style={{ fontSize: 32, marginBottom: 16 }}>⚡</div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>Joining game...</div>
      <div style={{ fontSize: 11, color: "#4d7a96", marginTop: 8 }}>Setting up your role</div>
    </div>
  );


  // ─── BLACKOUT OVERLAY (System Failure Rule — §7) ───
  if (blackout) return (
    <div style={{ background: "#050e16", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, #f0455a11 0%, #050e16 70%)", animation: "pulse 2s ease-in-out infinite" }} />
      <div style={{ textAlign: "center", zIndex: 1 }}>
        <div style={{ fontSize: 72, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 28, fontWeight: 900, color: "#f0455a", letterSpacing: 3, marginBottom: 8 }}>GRID FAILURE</div>
        <div style={{ fontSize: 14, color: "#f0455a88", marginBottom: 6 }}>System frequency breached safe limits for {FREQ_FAIL_DURATION} seconds</div>
        <div style={{ fontSize: 12, color: "#4d7a96", marginBottom: 24, maxWidth: 420, lineHeight: 1.7 }}>
          The grid has collapsed. In real life, this triggers automatic load shedding and potentially widespread blackouts.
          <strong style={{ color: "#ddeeff" }}> All players lose — regardless of individual profit.</strong>
        </div>
        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#f0455a", marginBottom: 24 }}>
          Last freq: {market?.actual?.freq?.toFixed(3) || "??"}Hz · Total P&L: {fpp(cash + daCash)}
        </div>
        <button onClick={() => { setBlackout(false); setFreqBreachSec(0); setScreen("lobby"); setCash(0); setDaCash(0); setSpHistory([]); }}
          style={{ padding: "10px 28px", background: "#1f0709", border: "2px solid #f0455a44", borderRadius: 8, color: "#f0455a", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Outfit'" }}>
          ← Return to Lobby
        </button>
      </div>
    </div>
  );

  const renderRoleScreen = () => {
    // Pre-DA phases (FORECAST_0) have no markets yet — use a safe placeholder
    // so the role screen can render instead of blocking on a loading guard.
    const m = market || {
      forecast: { wind: 0, solar: 0, demand: 30, baseRef: 50, sbp: 55, ssp: 45, niv: 0, isShort: false },
      actual:   { wind: 0, solar: 0, demand: 30, baseRef: 50, sbp: 55, ssp: 45, niv: 0, isShort: false },
    };

    const allIdOrders = Object.values(idOrderBook).filter(b => b && b.mw);
    const allDaOrders = Object.values(daOrderBook).filter(b => b && b.mw);
    const isAuctionPhase = ["DA", "IDA1", "IDA2"].includes(phase);
    const isBookViewer = isInstructor || role === "NESO";
    const ownOnly = (b) => {
      const bidPid = b?.id || b?.player_id || b?.playerId;
      return bidPid && bidPid === pid;
    };

    // Blind order-book behaviour: during auction phases, participants only see
    // their own submitted auction orders until gate closure.
    const visibleDaOrders = (isAuctionPhase && !isBookViewer)
      ? allDaOrders.filter(ownOnly)
      : allDaOrders;

    // Keep ID order visibility unchanged outside auction phases, but align DA/IDA
    // tabs to own-order view while auctions are open.
    const visibleIdOrders = (isAuctionPhase && !isBookViewer)
      ? allIdOrders.filter(ownOnly)
      : allIdOrders;

    const commonProps = {
      market: m, sp, msLeft, phase, tickSpeed, spContracts, pid, cash, daCash, spHistory, leaderboard, assetKey: asset,
      day, bmSubPhase,
      myBid, setMyBid, submitted, onSubmit: submitBid,
      daMyBid, setDaMyBid, daSubmitted, onDaSubmit: submitDaBid,
      idMyOrder, setIdMyOrder, idSubmitted, onIdSubmit: submitIdOrder,
      idOrderBook: visibleIdOrders,
      daOrderBook: visibleDaOrders,
      daResult, currentSp: sp, simRes: lastRes, bmOrderBook: allBids,
      allBids, lastRes, forecasts, publishedForecast, playerName: name, room, scenario: sc,
      isInstructor, paused, freqBreachSec, contractPosition, imbalancePenalty, earnedAchievements, gameMode, role,
      advanceMode, simSpeedId,
      onTickSpeedChange: instructorSetSpeed, onPauseToggle: instructorTogglePause, onNextPhase: instructorNextPhase,
      onAdvanceModeChange: instructorSetAdvanceMode, onSimSpeedChange: instructorSetSimSpeed,
      onExecuteEvent: instructorTrigger, onScenarioChange: instructorSetScenario, soc, players,
      onForecastPublish: publishForecast,
      forecastUpdateSummary,
      physicalState, setPhysicalState,
      ready,
      playerReadiness,
      // ─── Scoring Engine data ───
      playerScores, leaderboardData, systemState, overallScoreHistory,
      getScoreColor, getRankLabel, generatePlayerNarrative,
      // ─── EPEX DA Curve data ───
      daCurveSegments, setDaCurveSegments, onDaCurveSubmit: submitDaCurve,
      daAuctionResults, daCurves,
      // ─── Position flow (48-SP arrays) ───
      positions, daPositions, contracts,
      // ─── Live NIV during BM_OPEN ───
      liveNivData,
    };

    switch (role) {
      case "NESO": return <NESOScreen {...commonProps} />;
      case "ELEXON": return <ElexonScreen {...commonProps} />;
      case "GENERATOR": return <GeneratorScreen {...commonProps} />;
      case "BESS": return <BessScreen {...commonProps} />;
      case "SUPPLIER": return <SupplierScreen {...commonProps} />;
      case "TRADER": return <TraderScreen {...commonProps} />;
      // INTERCONNECTOR role is no longer available; system handles flows automatically
      case "DSR": return <DsrScreen {...commonProps} />;
      default: return <GeneratorScreen {...commonProps} />;
    }
  };

  return (
    <>
      <ToastContainer toasts={toasts} />
      <div style={{ position: "fixed", top: 12, left: 12, zIndex: 10001 }}>
        <ConnectivityIndicator ready={ready} />
      </div>
      {renderRoleScreen()}
    </>
  );
}
