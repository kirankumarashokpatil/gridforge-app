import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ASSETS, SUPPLIERS, SCENARIOS, EVENTS, BOT_ROSTER, TICK_MS, MIN_SOC, MAX_SOC, DA_CYCLE, DA_MS, FREQ_FAIL_LO, FREQ_FAIL_HI, FREQ_FAIL_DURATION, TICK_SPEEDS, FORGIVENESS, GAME_MODES, ROLES, ID_WINDOW_MS, TUTORIAL_STEPS, SCORING_CONFIG, SP_DURATION_H } from "./shared/constants.js";
import { clamp, f0, f1, fpp, spTime, uid, roomKey } from "./shared/utils.js";
import { marketForSp, clearBM, feedbackMarketState, clearDA, computeForecasts } from "./engine/MarketEngine.js";
import { availMW, updateSoF, initSoF } from "./engine/AssetPhysics.js";
import { computeImbalanceSettlement } from "./engine/SettlementEngine.js";
import { canSubmitBmBid } from "./engine/GateLogic.js";
import { useGun, useToasts } from "./hooks/useGun.js";
import { ACHIEVEMENTS, buildAchievementStats, checkAchievements } from "./engine/Achievements.js";
import { computeRoleScore, computeSystemScore, computeOverallScore } from "./engine/ScoringEngine.js";
import { createSystemState, updateSystemState, computePlayerSystemImpact, updatePlayerImpact, buildPlayerStats, buildNesoStats, buildElexonStats } from "./engine/PhysicalEngine.js";
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


/* ─── TOAST ─── */
function ToastContainer({ toasts }) {
  return (
    <div style={{ position: "fixed", top: 52, right: 12, zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id} className={t.exiting ? "toast-exit" : "toast-enter"}
          style={{ background: "#0e1e30", border: `1px solid ${t.col}55`, borderRadius: 8, padding: "8px 12px", minWidth: 220, maxWidth: 300, boxShadow: "0 4px 24px #00000066" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 16 }}>{t.emoji}</span>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: t.col }}>{t.title}</div>
              <div style={{ fontSize: 8.5, color: "#4d7a96", lineHeight: 1.5, marginTop: 1 }}>{t.body}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── ANIMATED P&L ─── */
function AnimatedPL({ value, size = 15 }) {
  const [bump, setBump] = useState(false); const prevRef = useRef(value);
  useEffect(() => { if (value !== prevRef.current) { setBump(true); setTimeout(() => setBump(false), 400); prevRef.current = value; } }, [value]);
  return <span className={bump ? "pl-bump" : ""} style={{ fontFamily: "'JetBrains Mono'", fontSize: size, fontWeight: 900, color: value >= 0 ? "#1de98b" : "#f0455a", display: "inline-block" }}>{fpp(value)}</span>;
}

/* ─── CONNECTIVITY INDICATOR ─── */
function ConnectivityIndicator({ ready }) {
  const status = ready === true ? "Online" : ready === "error" ? "Error" : "Connecting";
  const col = ready === true ? "#1de98b" : ready === "error" ? "#f0455a" : "#f5b222";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: `${col}15`, border: `1px solid ${col}44`, padding: "4px 10px", borderRadius: 20 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: col, boxShadow: `0 0 10px ${col}aa` }} className={ready === true ? "" : "pulse"} />
      <span style={{ fontSize: 10, fontWeight: 800, color: col, textTransform: "uppercase", letterSpacing: 0.5 }}>{status}</span>
    </div>
  );
}

/* ─── ROOT APP ─── */
export default function App() {
  const { gun, ready } = useGun();
  const { toasts, add: addToast } = useToasts();

  const [screen, setScreen] = useState("lobby");
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [pid, setPid] = useState(null);
  const [asset, setAsset] = useState(null);
  const [assetConfig, setAssetConfig] = useState(null);
  const [isInstructor, setIsInstructor] = useState(false);
  const [scenarioId, setScenarioId] = useState("NORMAL");
  const [sp, setSp] = useState(1);
  const [phase, setPhase] = useState("DA"); // "DA", "ID", "BM", "SETTLED"
  const [phaseStartTs, setPhaseStartTs] = useState(0);
  const [market, setMarket] = useState(null); // Will hold { forecast, actual }
  const [msLeft, setMsLeft] = useState(TICK_MS);
  const [soc, setSoc] = useState(50);
  const [cash, setCash] = useState(0);
  const [daCash, setDaCash] = useState(0); // Kept for UI backwards compatibility

  const [submitted, setSubmitted] = useState(false);
  const [myBid, setMyBid] = useState({ mw: 10, price: "" });
  const [daMyBid, setDaMyBid] = useState({ mw: 15, price: "" });
  const [daSubmitted, setDaSubmitted] = useState(false);

  const [lastRes, setLastRes] = useState(null);
  const [daResult, setDaResult] = useState(null);
  const [players, setPlayers] = useState({});
  const [orderBook, setOrderBook] = useState({});
  const [daOrderBook, setDaOrderBook] = useState({});
  const [spHistory, setSpHistory] = useState([]);
  const [forecasts, setForecasts] = useState([]);
  const [publishedForecast, setPublishedForecast] = useState(null); // Shared NESO forecast version
  const [roomScenario, setRoomScenario] = useState("NORMAL");
  const [spContracts, setSpContracts] = useState({}); // Master ledger for Elexon settlement
  const [nesoNivOverride, setNesoNivOverride] = useState(null); // null = auto, number = manual

  // ─── SCORING ENGINE STATE ───
  const [systemState, setSystemState] = useState(() => createSystemState());
  const [playerScores, setPlayerScores] = useState({}); // pid → { roleScore, systemScore, overallScore, roleDetail }
  const [overallScoreHistory, setOverallScoreHistory] = useState([]); // for multi-round final score


  // ─── WORKSHOP FEATURES ───
  const [tickSpeed, setTickSpeed] = useState(TICK_MS);
  const [paused, setPaused] = useState(false);
  const [freqBreachSec, setFreqBreachSec] = useState(0);
  const [blackout, setBlackout] = useState(false);

  // ─── BATCH 1: Achievements & Forgiveness ───
  const [earnedAchievements, setEarnedAchievements] = useState([]);
  const [gameMode, setGameMode] = useState("FULL");
  const [role, setRole] = useState("GENERATOR");

  // ─── BATCH 2: Intraday & Settlement ───
  const [idOrderBook, setIdOrderBook] = useState({});
  const [idMyOrder, setIdMyOrder] = useState({ mw: 10, price: "", side: "buy" });
  const [idSubmitted, setIdSubmitted] = useState(false);
  const [contractPosition, setContractPosition] = useState(0);  // MW from DA + ID
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

  const refs = useRef({}); refs.current = { sp, phase, phaseStartTs, soc, cash, daCash, imbalancePenalty, submitted, pid, name, room, asset, assetConfig, isInstructor, scenarioId: roomScenario, gameMode, role, contractPosition, orderBookSnap: orderBook, daOrderBookSnap: daOrderBook, idOrderBookSnap: idOrderBook, spContracts, players, physicalState, msLeft, tickSpeed };
  const prevPhaseRef = useRef({ phase: "INIT", sp: 0 });
  const lastEventRef = useRef(null);
  const gmCfg = GAME_MODES[gameMode] || GAME_MODES.FULL;
  const isForgive = gmCfg.forgiveness;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.gunState = { phase };
    }
  }, [phase]);

  const handleJoin = useCallback(async (chosenAsset, customConfig = null) => {
    if (!name.trim() || !room.trim() || !chosenAsset || !gun.current) return;
    const def = { ...ASSETS[chosenAsset], ...(customConfig || {}) };
    const id = uid(); const soc0 = initSoF(def);
    setPid(id); setAsset(chosenAsset); setAssetConfig(customConfig); setSoc(soc0);

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
    gun.current.get(roomKey(room, "players")).get(id).put({ name: name.trim(), asset: chosenAsset, customConfig, cash: 0, daCash: 0, soc: soc0, lastSeen: Date.now(), role: assignedRole });
    gun.current.get(roomKey(room, "meta")).put({ scenarioId });
    setScreen("game");
  }, [name, room, gun, isInstructor, scenarioId, role]);

  useEffect(() => {
    if (screen !== "game" || !gun.current || !room) return;
    gun.current.get(roomKey(room, "players")).map().on((data, id) => { if (data && id && data.name) setPlayers(p => ({ ...p, [id]: { ...data, id } })); });

    const metaRef = gun.current.get(roomKey(room, "meta"));
    metaRef.on(data => {
      if (data?.scenarioId) setRoomScenario(data.scenarioId);
      if (data?.sp) setSp(data.sp);
      if (data?.phase) {
        console.log('[GunDB] Phase update received:', data.phase, 'at', new Date().toISOString());
        setPhase(data.phase);
      }
      if (data?.phaseStartTs) setPhaseStartTs(data.phaseStartTs);
      if (data?.tickSpeed) setTickSpeed(data.tickSpeed);
      if (data?.paused !== undefined) setPaused(data.paused);
    });

    // CRITICAL FIX: For late joiners, also read current value to catch in-flight updates
    // This ensures that if the host advanced phase before all subscriptions were ready,
    // late joiners will still see the current phase.
    metaRef.once(data => {
      if (data?.phase) {
        console.log('[GunDB] Initial phase read (after subscription):', data.phase);
        setPhase(data.phase);
      }
    });

    gun.current.get(roomKey(room, "forecast")).on((data) => {
      console.log('[App.jsx] Received forecast data from GunDB:', data ? Object.keys(data) : 'null');
      if (data && data.json) {
        try {
          const parsed = JSON.parse(data.json);
          console.log('[App.jsx] Parsed forecast, has demand:', !!parsed.demand);
          setPublishedForecast(parsed);
        } catch (e) {
          console.error('[App.jsx] Failed to parse forecast JSON:', e);
        }
      }
    });
    // Listen for NESO manual NIV override
    gun.current.get(roomKey(room, "neso_niv")).on((data) => {
      if (data && data.mode === "manual" && data.niv !== undefined) {
        setNesoNivOverride(+data.niv);
      } else {
        setNesoNivOverride(null);
      }
    });

    // Listen for published settlement contracts (Elexon sync)
    gun.current.get(roomKey(room, "sp_contracts")).on((data) => {
      if (data && data.json) {
        try {
          const parsed = JSON.parse(data.json);
          setSpContracts(prev => ({ ...prev, [parsed.sp]: parsed.contracts }));
        } catch (e) { }
      }
    });
  }, [screen, room, gun]);

  // ─── NON-ASSET ROLE JOIN (NESO, ELEXON, TRADER, SUPPLIER) ───
  useEffect(() => {
    if (screen !== "game_no_asset") return;
    const id = pid || uid();
    setPid(id);
    setAsset("NONE");
    setSoc(100);
    if (role === "TRADER") setCash(5000);
    if (gun.current && room) {
      const assignedRole = isInstructor ? "instructor" : role;
      gun.current.get(roomKey(room, "players")).get(id).put({
        name: name.trim(), asset: "NONE",
        cash: role === "TRADER" ? 5000 : 0, daCash: 0, soc: 100,
        lastSeen: Date.now(), role: assignedRole,
      });
      gun.current.get(roomKey(room, "meta")).put({ scenarioId });
    }
    setScreen("game");
  }, [screen, gun, room]);

  useEffect(() => {
    if (screen !== "game" || !gun.current || !room || !sp) return;
    setOrderBook({}); setDaOrderBook({}); setIdOrderBook({});
    const daCycle = Math.floor(sp / DA_CYCLE);
    gun.current.get(roomKey(room, `bm_${sp}`)).map().on((data, id) => { if (data && id) setOrderBook(p => ({ ...p, [id]: { ...data, id } })); });
    gun.current.get(roomKey(room, `da_${daCycle}`)).map().on((data, id) => { if (data && id) setDaOrderBook(p => ({ ...p, [id]: { ...data, id } })); });
    gun.current.get(roomKey(room, `id_${sp}`)).map().on((data, id) => { if (data && id) setIdOrderBook(p => ({ ...p, [id]: { ...data, id } })); });
  }, [sp, screen, room, gun]);

  const instructorNextPhase = useCallback(() => {
    if (!gun.current || !room) return;
    const { sp: currentSp, phase: currentPhase } = refs.current;
    const nextPhase = currentPhase === "DA" ? "ID" : currentPhase === "ID" ? "BM" : currentPhase === "BM" ? "SETTLED" : "DA";
    const nextSp = currentPhase === "SETTLED" ? currentSp + 1 : currentSp;
    gun.current.get(roomKey(room, "meta")).put({ phase: nextPhase, sp: nextSp, phaseStartTs: Date.now() });
    addToast({ emoji: "✅", title: "Phase Advanced", body: `Moved to ${nextPhase}`, col: "#b78bfa" });
  }, [gun, room, addToast]);

  // 1. RE-COMPUTE MARKET WHEN SP/PHASE/FORECAST CHANGES
  useEffect(() => {
    if (screen !== "game") return;
    console.log('[App] Phase changed to:', phase, 'SP:', sp);
    const mState = marketForSp(sp, scenarioId, [], publishedForecast, nesoNivOverride);
    setMarket(mState);
    setForecasts(computeForecasts(sp, scenarioId, publishedForecast));

    if (mState.actual?.event && mState.actual.event.id !== lastEventRef.current) {
      lastEventRef.current = mState.actual.event.id;
      if (phase === "ID" || phase === "BM") {
        addToast({ emoji: mState.actual.event.emoji, title: mState.actual.event.name, body: mState.actual.event.desc, col: mState.actual.event.col });
      }
    }
  }, [sp, phase, scenarioId, screen, addToast, nesoNivOverride, publishedForecast]);

  // 2. GLOBAL TIMER (Visual only, Instructor Auto-Advances)
  useEffect(() => {
    if (screen !== "game" || blackout) return;
    const loop = setInterval(() => {
      const { phaseStartTs: pts, tickSpeed: ts, isInstructor, paused: isPaused, gameMode } = refs.current;
      if (isPaused || !pts) return;

      const elapsed = Date.now() - pts;
      const remaining = Math.max(0, ts - elapsed);
      setMsLeft(remaining);

      if (remaining <= 0 && isInstructor) {
        instructorNextPhase();
      }

      // GRID FAILURE CHECK
      const m = refs.current.phase === "DA" ? market?.forecast : market?.actual;
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
    if (phase === prevPhaseRef.current.phase && sp === prevPhaseRef.current.sp) return;
    const old = prevPhaseRef.current;
    prevPhaseRef.current = { phase, sp };
    if (old.phase === "INIT" || !market) return; // Ignore first load

    const { pid: id, name: n, room: rm, asset: ak, orderBookSnap, daOrderBookSnap, soc: s, gameMode } = refs.current;

    // --- DA CLOSED ---
    if (old.phase === "DA") {
      const daArr = Object.values(daOrderBookSnap || {}).filter(b => b && b.mw);
      const daRes = clearDA(daArr, market.forecast);

      setSpContracts(prev => {
        const next = { ...prev };
        if (!next[old.sp]) next[old.sp] = {};
        for (const p of Object.values(players)) {
          const b = daRes.accepted_bids.find(a => a.id === p.id);
          if (!next[old.sp][p.id]) next[old.sp][p.id] = {};
          next[old.sp][p.id].daMw = b ? b.mwAcc : 0;
          next[old.sp][p.id].daPrice = daRes.cp;
          next[old.sp][p.id].daSide = b ? b.side : null;
        }
        return next;
      });

      const myDa = daRes.accepted_bids.find(a => a.id === id);
      if (myDa) {
        const pos = myDa.side === "offer" ? myDa.mwAcc : -myDa.mwAcc;
        setContractPosition(pos);
        const daRev = +(myDa.mwAcc * daRes.cp * SP_DURATION_H).toFixed(2); // Keep existing multiplier
        setDaCash(prev => prev + daRev);
        setDaResult({ accepted: true, revenue: daRev, cp: daRes.cp, mw: myDa.mwAcc });
        addToast({ emoji: "📋", title: "DA Auction Cleared", body: `Position: ${pos > 0 ? "+" : ""}${f0(pos)}MW @ £${f1(daRes.cp)}`, col: "#f5b222" });
      } else {
        setContractPosition(0);
        setDaResult({ accepted: false, revenue: 0, cp: daRes.cp, mw: 0 });
      }
      setDaSubmitted(false);
    }

    // --- ID CLOSED ---
    else if (old.phase === "ID") {
      const idArr = Object.values(refs.current.idOrderBookSnap || {}).filter(b => b && b.mw);
      // Ensure 'buy' and 'sell' are mapped to 'bid' and 'offer' just in case
      const bids = idArr.filter(b => b.side === "buy" || b.side === "bid").map(b => ({ ...b })).sort((a, b) => b.price - a.price);
      const offers = idArr.filter(b => b.side === "sell" || b.side === "offer").map(b => ({ ...b })).sort((a, b) => a.price - b.price);

      const playerTrades = {};

      let bIdx = 0, oIdx = 0;
      while (bIdx < bids.length && oIdx < offers.length) {
        const bid = bids[bIdx];
        const offer = offers[oIdx];
        if (bid.price >= offer.price) {
          const matchMw = Math.min(bid.mw, offer.mw);
          const matchPrice = (bid.price + offer.price) / 2;

          if (!playerTrades[bid.id]) playerTrades[bid.id] = { mw: 0, money: 0, side: "bid" };
          if (!playerTrades[offer.id]) playerTrades[offer.id] = { mw: 0, money: 0, side: "offer" };

          playerTrades[bid.id].mw += matchMw;
          playerTrades[bid.id].money += matchPrice * matchMw;
          playerTrades[offer.id].mw += matchMw;
          playerTrades[offer.id].money += matchPrice * matchMw;

          bid.mw -= matchMw;
          offer.mw -= matchMw;
          if (bid.mw <= 0) bIdx++;
          if (offer.mw <= 0) oIdx++;
        } else {
          break;
        }
      }

      setSpContracts(prev => {
        const next = { ...prev };
        if (!next[old.sp]) next[old.sp] = {};
        for (const [pid, trade] of Object.entries(playerTrades)) {
          if (!next[old.sp][pid]) next[old.sp][pid] = {};
          next[old.sp][pid].idMw = trade.mw;
          next[old.sp][pid].idPrice = trade.mw > 0 ? trade.money / trade.mw : 0;
          next[old.sp][pid].idSide = trade.side;
        }
        return next;
      });

      const myIdTrade = playerTrades[id];
      if (myIdTrade && myIdTrade.mw > 0) {
        const avgPrice = myIdTrade.money / myIdTrade.mw;
        const posChange = myIdTrade.side === "offer" ? myIdTrade.mw : -myIdTrade.mw;
        setContractPosition(prev => prev + posChange);
        addToast({ emoji: "🤝", title: "ID Trade Executed", body: `${myIdTrade.side === "offer" ? "SOLD" : "BOUGHT"} ${f0(myIdTrade.mw)}MW @ £${avgPrice.toFixed(2)}`, col: "#38c0fc" });
      }

      setIdSubmitted(false);
    }

    // --- BM CLOSED (Actual Delivery) ---
    else if (old.phase === "BM") {
      const bmArr = [...Object.values(orderBookSnap || {}).filter(b => b && b.mw), ...market.actual.bots];
      const res = clearBM(bmArr, market.actual);
      setMarket(prev => ({ ...prev, actual: feedbackMarketState(prev.actual, res) })); // Update with post-clearing prices and frequency
      const mine = res.accepted.find(a => a.id === id);

      const myDef = { ...ASSETS[ak], ...(refs.current.assetConfig || {}) };
      const newS = mine ? updateSoF(myDef, s, mine.mwAcc, market.actual.isShort) : s;
      setSoc(newS);

      // Check for startup cost: charge only if asset was OFFLINE before BM cleared
      // Instead of checking if it had a BM bid in previous SP, check if it was actually ONLINE
      let startupDeduction = 0;
      if (mine && myDef.startupCost) {
        const prevSpPhysical = spContracts[old.sp - 1]?.[id]?.physicalAtEndOfSp;
        const wasOnlineBefore = prevSpPhysical?.status === "ONLINE";
        if (!wasOnlineBefore) {
          // Asset was OFFLINE or STARTING in previous SP, now accepted in BM = startup event
          startupDeduction = myDef.startupCost;
        }
      }

      setSpContracts(prev => {
        const next = { ...prev };
        if (!next[old.sp]) next[old.sp] = {};
        for (const b of res.accepted) {
          if (b.isBot && b.id.startsWith("BOT_")) continue; // Skip generic market fillers
          if (!next[old.sp][b.id]) next[old.sp][b.id] = {};
          next[old.sp][b.id].bmAccepted = { mw: b.mwAcc, price: res.cp, rev: b.revenue };
        }
        return next;
      });

      const netRevenue = (mine?.revenue || 0) - startupDeduction + (mine ? myDef.cmPayment || 0 : 0);
      setLastRes({ accepted: !!mine, revenue: netRevenue, cp: res.cp, mw: mine?.mwAcc || 0, sp: market.actual.sp, isShort: market.actual.isShort, myPrice: mine?.price, prevSof: s, newSof: newS, wearCost: mine?.wearCost || 0, startupCost: startupDeduction, cmPayment: mine ? myDef.cmPayment || 0 : 0 });
      setSubmitted(false);
    }

    // --- ENTERING SETTLEMENT (Elexon Calculation) ---
    if (phase === "SETTLED") {
      const settleSp = old.sp; // Use the SP that just completed, NOT the current sp
      // Bug #11 fix: capture the market state NOW before the timeout fires,
      // otherwise at fast tick speeds market.actual may belong to the NEXT SP.
      const settledMarket = market;
      setTimeout(() => {
        // Run global settlement calculations for Elexon & NESO visibility
        setSpContracts(prev => {
          const next = { ...prev };
          if (!next[settleSp]) next[settleSp] = {};

          let totalImbCash = 0;
          let numPlayers = 0;
          const playersArr = Object.values(refs.current.players || {});

          playersArr.forEach(p => {
            const c = next[settleSp][p.id] || {};
            const pDaRev = c.daMw ? (c.daSide === "offer" ? c.daMw * c.daPrice * SP_DURATION_H : -c.daMw * c.daPrice * SP_DURATION_H) : 0;
            const pIdRev = c.idMw ? (c.idSide === "offer" ? c.idMw * c.idPrice * SP_DURATION_H : -c.idMw * c.idPrice * SP_DURATION_H) : 0;
            const pBmRev = c.bmAccepted?.rev || 0;

            const pContractPosMw = (c.daSide === "offer" ? (c.daMw || 0) : -(c.daMw || 0)) + (c.idSide === "offer" ? (c.idMw || 0) : -(c.idMw || 0));
            const pActualPosMw = c.bmAccepted ? (settledMarket.actual.isShort ? c.bmAccepted.mw : -c.bmAccepted.mw) : 0;

            let pActualPhysical = pContractPosMw + pActualPosMw;
            if (settledMarket.actual.trippedAssets?.includes(p.asset)) pActualPhysical = 0;

            const isForgive = gameMode === "TUTORIAL";
            // Core imbalance settlement using explicit SP duration and per-player sign convention
            const baseSettle = computeImbalanceSettlement({
              actualPhysicalMw: pActualPhysical,
              contractedMw: pContractPosMw,
              bmAcceptedMw: pActualPosMw,
              sbp: settledMarket.actual.sbp,
              ssp: settledMarket.actual.ssp,
              spDurationH: SP_DURATION_H,
            });
            // Tutorial forgiveness scales the imbalance cash, but preserves sign
            const imbCash = baseSettle.cash * (isForgive ? (FORGIVENESS.penaltyMultiplier || 0.5) : 1);

            const pDef = { ...ASSETS[p.assetKey || p.asset], ...(p.assetConfig || {}) };
            const varCostMwh = pDef.varCost || pDef.wear || 0;
            const operatingCost = -(Math.abs(pActualPhysical) * varCostMwh * SP_DURATION_H);
            const startupCost = c.startupOccurred ? -(pDef.startupCost || 0) : 0;

            c.physicalMw = pActualPhysical;
            c.settlement = {
              imbMw: baseSettle.imbalanceMw,
              imbCash,
              daCash: pDaRev,
              idCash: pIdRev,
              bmCash: pBmRev,
              operatingCost,
              startupCost,
              totalCash: pDaRev + pIdRev + pBmRev + imbCash + operatingCost + startupCost,
            };
            next[settleSp][p.id] = c;
            totalImbCash += imbCash;
            numPlayers++;
          });

          // Calculate BSUoS socialization and apply in same pass
          const bsuoSCharge = numPlayers > 0 ? -totalImbCash / numPlayers : 0;

          Object.keys(next[settleSp] || {}).forEach(pid => {
            if (next[settleSp][pid]?.settlement) {
              next[settleSp][pid].settlement.bsuoSCharge = bsuoSCharge;
              next[settleSp][pid].settlement.totalCash += bsuoSCharge;
            }
          });

          return next;
        });

        // Apply local results for current user
        const myC = refs.current.spContracts[settleSp]?.[id] || {};
        const daRev = myC.daMw ? (myC.daSide === "offer" ? myC.daMw * myC.daPrice * SP_DURATION_H : -myC.daMw * myC.daPrice * SP_DURATION_H) : 0;
        const idRev = myC.idMw ? (myC.idSide === "offer" ? myC.idMw * myC.idPrice * SP_DURATION_H : -myC.idMw * myC.idPrice * SP_DURATION_H) : 0;
        const bmRev = myC.bmAccepted?.rev || 0;

        const myDef = { ...ASSETS[ak], ...(refs.current.assetConfig || {}) };
        const contractPosMw = refs.current.contractPosition;
        const actualPosMw = myC.bmAccepted ? (settledMarket.actual.isShort ? myC.bmAccepted.mw : -myC.bmAccepted.mw) : 0;

        const intendedPhysical = contractPosMw + actualPosMw;
        let actualPhysical = intendedPhysical;

        // APPLY PHYSICAL CONSTRAINTS
        let pState = { ...refs.current.physicalState };
        const isGenerator = ["fuel", "wind", "solar", "nuclear"].includes(myDef.kind);
        const isStorage = myDef.kind === "soc";

        if (isGenerator) {
          // 1. If Offline or Starting, output is ZERO
          if (pState.status !== "ONLINE") {
            actualPhysical = 0;
            if (pState.status === "STARTING") {
              pState.spUntilOnline -= 1;
              if (pState.spUntilOnline <= 0) pState.status = "ONLINE";
            }
          } else {
            // 2. Enforce Minimum Stable Generation
            if (myDef.minMw && actualPhysical > 0 && actualPhysical < myDef.minMw) {
              actualPhysical = 0; // Trip offline
              pState.status = "OFFLINE";
              addToast({ emoji: "⚠️", title: "Plant Tripped", body: `Dispatched below minimum stable (${myDef.minMw}MW). Plant is now OFFLINE.`, col: "#f0455a" });
            }

            // 3. Enforce Ramp Rates (rampRate is MW per SP)
            const maxRamp = myDef.rampRate || 9999;
            if (actualPhysical > pState.currentMw + maxRamp) {
              actualPhysical = pState.currentMw + maxRamp;
            } else if (actualPhysical < pState.currentMw - maxRamp) {
              // If ramping down too fast, we are forced to generate more (and get penalized if out of balance)
              actualPhysical = pState.currentMw - maxRamp;
            }
          }
          // Save new physical state
          pState.currentMw = actualPhysical;
          setPhysicalState(pState);
        }

        if (market.actual.trippedAssets?.includes(ak)) {
          // BUG FIX: For DSR with pending rebound debt, don't zero out - set forced rebound state
          const isDsr = myDef.kind === "dsr";
          if (isDsr && pState.pendingReboundMwh > 0 && pState.reboundSpsRemaining === 0) {
            // Force rebound mode to continue consuming their debt
            pState.reboundSpsRemaining = pState.reboundDuration || 1;
            // actualPhysical will be recalculated in DSR rebound logic below
          } else {
            // For non-DSR or DSR without rebound obligation, zero output
            actualPhysical = 0;
          }
          if (isGenerator) {
            setPhysicalState(prev => ({ ...prev, status: "OFFLINE", currentMw: 0 }));
          }
        }

        // BESS SPECIFIC CONSTRAINTS
        if (isStorage) {
          const maxDischargeMwh = (refs.current.soc / 100) * myDef.maxMWh; // Available energy to discharge
          const maxChargeMwh = myDef.maxMWh - maxDischargeMwh; // Available headroom

          // actualPhysical > 0 implies Discharge
          // actualPhysical < 0 implies Charge
          // 1 SP is SP_DURATION_H Hours. So MW * SP_DURATION_H = MWh.
          // Discharge requirement: (MW * SP_DURATION_H) / Eff <= maxDischargeMwh
          if (actualPhysical > 0) {
            const requestedMwh = (actualPhysical * SP_DURATION_H) / (myDef.eff || 1);
            if (requestedMwh > maxDischargeMwh) {
              // Crop to what's left
              actualPhysical = (maxDischargeMwh * (myDef.eff || 1)) / SP_DURATION_H;
            }
          }
          // Charge requirement: (Math.abs(MW) * SP_DURATION_H) * Eff <= maxChargeMwh
          else if (actualPhysical < 0) {
            const requestedChargeMwh = (Math.abs(actualPhysical) * SP_DURATION_H) * (myDef.eff || 1);
            if (requestedChargeMwh > maxChargeMwh) {
              // Crop to headroom
              actualPhysical = -(maxChargeMwh / (myDef.eff || 1)) / SP_DURATION_H;
            }
          }
        }

        // DSR SPECIFIC CONSTRAINTS & REBOUND
        if (myDef.kind === "dsr") {
          // A DSR asset 'curtails' by supplying positive MW to the grid (reducing their own consumption).
          // Rebound means they must consume extra (negative MW)
          const isCurtailing = actualPhysical > 0;

          if (pState.reboundSpsRemaining > 0) {
            // FORCED REBOUND STATE: They are forced to consume extra.
            // We override their physical target to match their pending rebound.
            const forcedMw = -(pState.pendingReboundMwh / SP_DURATION_H); // (MW = MWh / hours)
            actualPhysical = forcedMw;

            // Tick down the rebound clock
            pState.reboundSpsRemaining -= 1;
            if (pState.reboundSpsRemaining <= 0) {
              pState.pendingReboundMwh = 0; // Cleared
              pState.curtailSpsRemaining = myDef.maxCurtailDuration || 2; // Reset availability
            }
            setPhysicalState(pState);
          } else if (isCurtailing) {
            // Tick down their available curtailment time.
            pState.curtailSpsRemaining -= 1;
            // Accumulate energy debt for the rebound
            const mwhCurtailed = actualPhysical * SP_DURATION_H;
            const debt = mwhCurtailed * (myDef.reboundMultiplier || 1.2);
            pState.pendingReboundMwh += debt;

            if (pState.curtailSpsRemaining <= 0) {
              // Trigger rebound next SP
              pState.reboundSpsRemaining = myDef.reboundDuration || 1;
              addToast({ emoji: "⚠️", title: "Forced Rebound", body: `DSR max duration reached. Forced to buy back ${f0(pState.pendingReboundMwh)} MWh next SP.`, col: "#f0455a" });
            }
            setPhysicalState(pState);
          } else if (pState.curtailSpsRemaining < (myDef.maxCurtailDuration || 2)) {
            // If they naturally stopped curtailing before hitting the limit, they STILL must pay back the rebound debt they accrued.
            if (actualPhysical < 0) {
              // They are voluntarily rebinding
              const mwhPaid = Math.abs(actualPhysical) * SP_DURATION_H;
              pState.pendingReboundMwh = Math.max(0, pState.pendingReboundMwh - mwhPaid);
              if (pState.pendingReboundMwh === 0) {
                // Debt cleared, reset availability
                pState.curtailSpsRemaining = myDef.maxCurtailDuration || 2;
              }
            } else {
              // Holding steady (0MW). No debt paid back, but no new debt accrued.
            }
            setPhysicalState(pState);
          }
        }

        const deviation = actualPhysical - contractPosMw;
        const imbPrc = market.actual.isShort ? market.actual.sbp * 1.05 : market.actual.ssp * 0.95;
        const isForgive = gameMode === "TUTORIAL";
        // Bug #9 fix: signed deviation — over-delivery (positive into short) should earn, not penalize
        const forgiveMult = isForgive ? (FORGIVENESS.penaltyMultiplier || 0.5) : 1;
        const imbPen = deviation >= 0
          ? (deviation * market.actual.ssp * SP_DURATION_H * forgiveMult)   // Over-delivery: sell excess at SSP
          : (deviation * market.actual.sbp * SP_DURATION_H * forgiveMult);  // Under-delivery: buy shortfall at SBP

        // Deduct Variable Cost (Fuel/Wear) - Note: storage 'wear' is based on throughput (absolute MW)
        const varCostMwh = myDef.varCost || myDef.wear || 0;
        const operatingCost = -(Math.abs(actualPhysical) * varCostMwh * SP_DURATION_H);

        // Interconnector is now a system asset; congestion revenue handled by engine if needed
        let congestionRev = 0;

        const totalSpRev = daRev + idRev + bmRev + imbPen + congestionRev + operatingCost + bsuoSCharge;
        let newC = refs.current.cash + totalSpRev;

        // Margin liquidation for traders
        if (role === "TRADER" && (newC + refs.current.daCash) < ROLES.TRADER.marginFloor) {
          const loss = ROLES.TRADER.marginFloor - (newC + refs.current.daCash);
          newC = ROLES.TRADER.marginFloor - refs.current.daCash;
          setContractPosition(0); // Liquidate position
          addToast({ emoji: "💥", title: "Margin Call", body: `Cash fell below margin floor. Position liquidated. Loss: £${f0(loss)}`, col: "#f0455a" });
        }

        setCash(newC);

        // Store physical state at end of settlement for next SP's startup cost determination
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

        const accepted = !!mine; // Bug #1 fix: track whether player was dispatched
        setSpHistory(prev => [{ sp, niv: market.actual.niv, cp: market.actual.sbp, sbp: market.actual.sbp, ssp: market.actual.ssp, wf: market.actual.wf, revenue: totalSpRev, event: market.actual.event, contractPosMw, actualPhysical, imbPrc, imbPen, daRev, bmRev, idRev, operatingCost, accepted, mw: mine?.mwAcc || 0, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 47)]);

        // ─── SCORING ENGINE: compute scores after each SP ───
        const playerImbalance = deviation; // signed MW deviation
        const systemNIV = market.actual.niv;
        const spImpact = computePlayerSystemImpact(playerImbalance, systemNIV);
        const isStressSP = Math.abs(systemNIV) > (SCORING_CONFIG.stressNIVThreshold || 300);
        const deliveredOk = Math.abs(deviation) < 5; // within 5MW tolerance

        // Update system state
        setSystemState(prev => {
          const balancingCost = Math.abs(market.actual.niv) * (market.actual.sbp || 50) * 0.01;
          const updated = updateSystemState(prev, { sp, niv: systemNIV, balancingCost, freq: market.actual.freq, blackout: false });
          updated.playerImpacts = updatePlayerImpact(prev.playerImpacts, id, spImpact, isStressSP, deliveredOk);
          return updated;
        });

        // Compute role + system + overall scores
        setTimeout(() => {
          const currentRole = refs.current.role;
          const stats = buildPlayerStats(currentRole, {
            spHistory: refs.current.spHistory || [],
            assetKey: ak,
            soc: refs.current.soc,
            cash: newC,
            daCash: refs.current.daCash,
            imbalancePenalty: refs.current.imbalancePenalty,
            systemImpacts: refs.current.systemState?.playerImpacts || {},
            pid: id,
            congestionRevenue: congestionRev,
            systemState: refs.current.systemState,
            spContracts: refs.current.spContracts,
          });

          const roleResult = computeRoleScore(currentRole, stats);
          const sysMetrics = refs.current.systemState?.playerImpacts?.[id] || {};
          const sysScore = computeSystemScore(sysMetrics);
          const overall = computeOverallScore(roleResult.roleScore, sysScore);

          setPlayerScores(prev => ({
            ...prev,
            [id]: { roleScore: roleResult.roleScore, systemScore: sysScore, overallScore: overall, roleDetail: roleResult }
          }));
          setOverallScoreHistory(prev => [...prev, overall]);
        }, 100);

        if (gun.current && rm) {
          const assignedRole = refs.current.isInstructor ? "instructor" : refs.current.role;
          // Compute scores for Gun.js publish
          const quickStats = buildPlayerStats(assignedRole, { spHistory: refs.current.spHistory || [], assetKey: ak, soc: refs.current.soc, cash: newC, daCash: refs.current.daCash, imbalancePenalty: refs.current.imbalancePenalty, systemImpacts: refs.current.systemState?.playerImpacts || {}, pid: id, congestionRevenue: congestionRev });
          const quickRole = computeRoleScore(assignedRole, quickStats);
          const quickSys = computeSystemScore(refs.current.systemState?.playerImpacts?.[id] || {});
          const quickOverall = computeOverallScore(quickRole.roleScore, quickSys);
          gun.current.get(roomKey(rm, "players")).get(id).put({ name: n, asset: ak, cash: newC, soc: refs.current.soc, lastSeen: Date.now(), role: assignedRole, roleScore: quickRole.roleScore, systemScore: quickSys, overallScore: quickOverall });

          // Publish the master settlement record if I am the operator (e.g. Instructor or NESO)
          // Since all clients compute it identically (deterministic), any one can publish it, 
          // but having NESO/Instructor do it ensures exactly one authoritative write.
          if (assignedRole === "instructor" || assignedRole === "NESO") {
            const settleSp = old.sp;
            const contractsForSp = refs.current.spContracts[settleSp];
            if (contractsForSp) {
              gun.current.get(roomKey(rm, "sp_contracts")).put({ json: JSON.stringify({ sp: settleSp, contracts: contractsForSp }) });
            }
          }
        }
        setReplayData(prev => [...prev, { sp, market, orderBook: refs.current.orderBookSnap }].slice(-200));
      }, 300);
    }

    // --- ENTERING NEW SP ---
    if (old.sp !== sp) {
      setContractPosition(0);
      setDaResult(null);
      setLastRes(null);
    }
  }, [phase, sp]);

  // Keep refs in sync for pause, tickSpeed, gameMode, scoring state
  useEffect(() => { refs.current.paused = paused; }, [paused]);
  useEffect(() => { refs.current.tickSpeed = tickSpeed; }, [tickSpeed]);
  useEffect(() => { refs.current.gameMode = gameMode; }, [gameMode]);
  useEffect(() => { refs.current.systemState = systemState; }, [systemState]);
  useEffect(() => { refs.current.imbalancePenalty = imbalancePenalty; }, [imbalancePenalty]);
  useEffect(() => { refs.current.spHistory = spHistory; }, [spHistory]);

  // ─── ACHIEVEMENT CHECKING ───
  useEffect(() => {
    if (screen !== "game" || !asset) return;
    const stats = buildAchievementStats({
      spHistory, cash, daCash, assetKey: asset,
      assetKind: ASSETS[asset]?.kind, scenario: roomScenario,
      soc, freqBreachSec,
    });
    const newlyEarned = checkAchievements(stats, earnedAchievements.map(a => a.id));
    if (newlyEarned.length > 0) {
      setEarnedAchievements(prev => [...prev, ...newlyEarned]);
      for (const a of newlyEarned) {
        addToast({ emoji: a.emoji, title: `🏆 ${a.name}`, body: a.desc, col: a.col });
      }
    }
  }, [spHistory.length]); // check every new SP

  // ─── IMBALANCE SETTLEMENT ───
  // REMOVED: Duplicate imbalance penalty calculation. Imbalance is already handled
  // in the SETTLED phase transition block above (lines ~386-412) which correctly
  // calculates deviation and applies imbPen to the total SP revenue.


  // Instructor speed/pause sync via Gun.js
  const instructorSetSpeed = useCallback((speedId) => {
    const sp = TICK_SPEEDS[speedId];
    if (!sp) return;
    setTickSpeed(sp.ms);
    if (gun.current && room) gun.current.get(roomKey(room, "meta")).put({ tickSpeed: sp.ms });
    addToast({ emoji: sp.emoji, title: "Tick speed changed", body: sp.label, col: "#b78bfa" });
  }, [gun, room, addToast]);

  const instructorTogglePause = useCallback(() => {
    setPaused(p => {
      const next = !p;
      if (gun.current && room) gun.current.get(roomKey(room, "meta")).put({ paused: next });
      addToast({ emoji: next ? "⏸️" : "▶️", title: next ? "GAME PAUSED" : "GAME RESUMED", body: next ? "Instructor has frozen the game for discussion" : "Game is live again", col: next ? "#f5b222" : "#1de98b" });
      return next;
    });
  }, [gun, room, addToast]);

  useEffect(() => { refs.current.orderBookSnap = orderBook; }, [orderBook]);
  useEffect(() => { refs.current.daOrderBookSnap = daOrderBook; }, [daOrderBook]);

  const submitBid = useCallback(() => {
    const { submitted: sub, pid: id, name: n, soc: s, sp: t, room: rm, asset: ak, assetConfig, role, phase: currentPhase, msLeft: remainingMs } = refs.current;
    if (!gun.current || !id) return;
    // Gate closure: BM bids only allowed during BM phase and before timer expiry
    if (!canSubmitBmBid(currentPhase, remainingMs)) {
      addToast({ emoji: "🚫", title: "BM Gate Closed", body: `Gate closed — bids for SP ${t} are no longer accepted.`, col: "#f0455a" });
      return;
    }
    if (sub) return;
    if (!myBid.price || isNaN(+myBid.price) || +myBid.mw <= 0) return;
    const m = marketForSp(t, refs.current.scenarioId, [], publishedForecast);
    const isTraderRole = ROLES[role]?.canOwnAssets === false;
    const def = { ...ASSETS[ak], ...(assetConfig || {}) };
    const avail = isTraderRole ? Infinity : availMW(def, s, m);
    if (!isTraderRole && +myBid.mw > avail + 0.5) { alert(`⚠ Max available: ${f0(avail)} MW`); return; }
    const bidSide = isTraderRole && myBid.side ? myBid.side : (m.actual.isShort ? "offer" : "bid");
    const bid = { id, name: n, asset: ak, mw: +myBid.mw, price: +myBid.price, side: bidSide, col: def.col, isBot: false };
    gun.current.get(roomKey(rm, `bm_${t}`)).get(id).put(bid);
    setSubmitted(true); setOrderBook(p => ({ ...p, [id]: bid }));
    addToast({ emoji: "📤", title: "BM bid submitted", body: `${f0(myBid.mw)}MW @ £${myBid.price}/MWh`, col: "#38c0fc" });
  }, [myBid, gun, addToast]);

  const submitDaBid = useCallback(() => {
    const { pid: id, name: n, room: rm, asset: ak, sp: t, role } = refs.current;
    if (!id || !gun.current || daSubmitted) return;
    if (!daMyBid.price || isNaN(+daMyBid.price) || +daMyBid.mw <= 0) return;
    const m = marketForSp(t, refs.current.scenarioId, [], publishedForecast); const def = ASSETS[ak] || { col: "#ffffff" };
    const daCycle = Math.floor(t / DA_CYCLE);
    const isTraderRole = ROLES[role]?.canOwnAssets === false;
    const bidSide = isTraderRole && daMyBid.side ? daMyBid.side : (m.forecast.isShort ? "offer" : "bid");
    const bid = { id, name: n, asset: ak, mw: +daMyBid.mw, price: +daMyBid.price, side: bidSide, col: def.col, isBot: false };
    gun.current.get(roomKey(rm, `da_${daCycle}`)).get(id).put(bid);
    setDaSubmitted(true); refs.current.daSubmitted = true; setDaOrderBook(p => ({ ...p, [id]: bid }));
    addToast({ emoji: "📋", title: "DA bid submitted", body: `${f0(daMyBid.mw)}MW @ £${daMyBid.price}/MWh`, col: "#f5b222" });
  }, [daMyBid, gun, daSubmitted, addToast]);

  const submitIdOrder = useCallback(() => {
    const { pid: id, name: n, room: rm, asset: ak, sp: t } = refs.current;
    if (!id || !gun.current || phase !== "ID" || idSubmitted) return;
    if (!idMyOrder.price || isNaN(+idMyOrder.price) || +idMyOrder.mw <= 0) return;
    const def = ASSETS[ak] || { col: "#ffffff" };
    const bid = { id, name: n, asset: ak, mw: +idMyOrder.mw, price: +idMyOrder.price, side: idMyOrder.side, col: def.col, isBot: false };
    gun.current.get(roomKey(rm, `id_${t}`)).get(id).put(bid);
    setIdSubmitted(true); setIdOrderBook(p => ({ ...p, [id]: bid }));
    addToast({ emoji: "🤝", title: "ID Order Placed", body: `${idMyOrder.side === "buy" ? "BUY" : "SELL"} ${f0(idMyOrder.mw)}MW @ £${idMyOrder.price}/MWh`, col: "#38c0fc" });
  }, [idMyOrder, phase, gun, idSubmitted, addToast]);

  const instructorTrigger = useCallback((eventId) => {
    if (!gun.current || !room) return;
    gun.current.get(roomKey(room, "instructor")).put({ eventId, ts: Date.now() });
    addToast({ emoji: "🎓", title: "Event triggered", body: EVENTS.find(e => e.id === eventId)?.name || eventId, col: "#b78bfa" });
  }, [gun, room, addToast]);

  const instructorSetScenario = useCallback((scId) => {
    if (!gun.current || !room) return;
    gun.current.get(roomKey(room, "meta")).put({ scenarioId: scId });
    addToast({ emoji: "🌍", title: "Scenario changed", body: SCENARIOS[scId]?.name || scId, col: "#f5b222" });
  }, [gun, room, addToast]);

  // ─── MULTI-DIMENSIONAL LEADERBOARD ───
  const leaderboardData = useMemo(() => {
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
  }, [players, playerScores]);
  const leaderboard = leaderboardData.overall;

  const allBids = [...Object.values(orderBook).filter(b => b && b.mw), ...(market?.actual?.bots || [])];
  const sc = SCENARIOS[roomScenario] || SCENARIOS.NORMAL;

  if (screen === "lobby") return <LobbyScreen name={name} setName={setName} room={room} setRoom={setRoom} gunReady={ready} onNext={() => {
    // When joining from Lobby, go to Waiting Room
    setScreen("waiting_room");
  }} />;
  if (screen === "waiting_room") return <WaitingRoom gun={gun.current} gunReady={ready} room={room} name={name} pid={pid || uid()} setPid={setPid} role={role} setRole={setRole} setScreen={setScreen} isHost={isInstructor} setIsHost={setIsInstructor} gameMode={gameMode} setGameMode={setGameMode} scenarioId={scenarioId} setScenarioId={setScenarioId} players={players} />;
  if (screen === "asset") return <AssetScreen onSelect={handleJoin} playerName={name} room={room} scenario={sc} role={role} />;
  if (screen === "game_no_asset") return (
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
    // Guard against null market - role screens expect market data
    if (!market) {
      return (
        <div style={{ background: "#050e16", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: "#38c0fc" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⚡</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Loading market data...</div>
          <div style={{ fontSize: 11, color: "#4d7a96", marginTop: 8 }}>Initializing game state</div>
        </div>
      );
    }
    const commonProps = {
      market, sp, msLeft, phase, tickSpeed, spContracts, pid, cash, daCash, spHistory, leaderboard, assetKey: asset,
      myBid, setMyBid, submitted, onSubmit: submitBid,
      daMyBid, setDaMyBid, daSubmitted, onDaSubmit: submitDaBid,
      idMyOrder, setIdMyOrder, idSubmitted, onIdSubmit: submitIdOrder,
      idOrderBook: Object.values(idOrderBook).filter(b => b && b.mw),
      daOrderBook: Object.values(daOrderBook).filter(b => b && b.mw),
      daResult, currentSp: sp, simRes: lastRes, bmOrderBook: allBids,
      allBids, lastRes, forecasts, publishedForecast, playerName: name, room, scenario: sc,
      isInstructor, paused, freqBreachSec, contractPosition, imbalancePenalty, earnedAchievements, gameMode, role,
      onTickSpeedChange: instructorSetSpeed, onPauseToggle: instructorTogglePause, onNextPhase: instructorNextPhase,
      onExecuteEvent: instructorTrigger, onScenarioChange: instructorSetScenario, soc, players,
      gun: gun.current, // Pass gun so NESO can publish forecast
      physicalState, setPhysicalState,
      nesoNivOverride,
      onSetManualNiv: (mode, niv) => {
        if (gun.current && room) {
          gun.current.get(roomKey(room, "neso_niv")).put({ mode, niv: mode === "manual" ? niv : null });
        }
        setNesoNivOverride(mode === "manual" ? niv : null);
      },
      // ─── Scoring Engine data ───
      playerScores, leaderboardData, systemState, overallScoreHistory,
      getScoreColor, getRankLabel, generatePlayerNarrative,
    };

    switch (role) {
      case "NESO":
      case "instructor": return <NESOScreen {...commonProps} />;
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
      <div style={{ position: "fixed", top: 12, right: 12, zIndex: 10001 }}>
        <ConnectivityIndicator ready={ready} />
      </div>
      {renderRoleScreen()}
    </>
  );
}

/* ─── PREMIUM LOBBY / LANDING PAGE ─── */
function LobbyScreen({ name, setName, room, setRoom, gunReady, onNext }) {
  const canProceed = name.trim().length > 0 && room.trim().length >= 3;
  const randomRoom = () => setRoom(Math.random().toString(36).slice(2, 7).toUpperCase());

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden", background: "#050e16" }}>
      {/* LEFT: Hero Image Panel */}
      <div style={{ flex: "1 1 55%", position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "40px" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/bg-hero.png)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.8, zIndex: 0 }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, #050e16ee 0%, #050e16aa 50%, #050e1622 100%)", zIndex: 1 }} />

        <div style={{ position: "relative", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 48, filter: "drop-shadow(0 0 12px #1de98b44)" }}>⚡</div>
            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 36, fontWeight: 900, color: "#ffffff", letterSpacing: 4, textShadow: "0 0 20px #1de98baa" }}>GRIDFORGE</div>
          </div>
          <div style={{ fontSize: 13, color: "#1de98b", letterSpacing: 3, fontWeight: 700, textTransform: "uppercase" }}>GB Electricity Market Simulator</div>
        </div>

        <div style={{ position: "relative", zIndex: 2, maxWidth: 480 }}>
          <div style={{ background: "#08141fdd", backdropFilter: "blur(12px)", border: "1px solid #1a3045", borderRadius: 12, padding: "24px", boxShadow: "0 8px 32px #00000088" }}>
            <h3 style={{ margin: "0 0 16px 0", color: "#38c0fc", fontSize: 16, letterSpacing: 1 }}>BECOME A GRID OPERATOR</h3>
            <p style={{ margin: "0 0 12px 0", color: "#cbd5e1", fontSize: 14, lineHeight: 1.6 }}>Experience the intense pressure of the GB Balancing Mechanism. Trade energy, manage physical assets, and keep the frequency stable in a real-time multiplayer simulation.</p>
            <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#1de98b", fontSize: 24, fontWeight: 900, fontFamily: "'JetBrains Mono'" }}>09</div>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>Distinct Roles</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#f5b222", fontSize: 24, fontWeight: 900, fontFamily: "'JetBrains Mono'" }}>3</div>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>Market Phases</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#38bdf8", fontSize: 24, fontWeight: 900, fontFamily: "'JetBrains Mono'" }}>100%</div>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>Real-time Sync</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: Join Form Panel */}
      <div style={{ flex: "0 0 450px", background: "#061019", borderLeft: "1px solid #162c3d", display: "flex", flexDirection: "column", justifyContent: "center", padding: "48px", position: "relative", zIndex: 10, boxShadow: "-10px 0 40px #000000" }}>

        <div style={{ marginBottom: 40 }}>
          <ConnectivityIndicator ready={gunReady} />
        </div>

        <h2 style={{ margin: "0 0 32px 0", color: "#ffffff", fontSize: 28, fontWeight: 800 }}>Join Session</h2>

        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 8, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Trader Name</label>
          <input
            value={name}
            placeholder="e.g. Alice, GridTrader1..."
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && canProceed && onNext()}
            style={{ width: "100%", padding: "14px 16px", background: "#0a1724", border: "1px solid #1e3a5f", borderRadius: 8, color: "#ddeeff", fontSize: 16, outline: "none", transition: "border-color 0.2s", boxSizing: "border-box" }}
            onFocus={e => e.target.style.borderColor = "#38bdf8"}
            onBlur={e => e.target.style.borderColor = "#1e3a5f"}
          />
        </div>

        <div style={{ marginBottom: 32 }}>
          <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 8, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Room Code</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={room}
              placeholder="e.g. ALPHA"
              onChange={e => setRoom(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
              onKeyDown={e => e.key === "Enter" && canProceed && onNext()}
              style={{ flex: 1, padding: "14px 16px", background: "#0a1724", border: "1px solid #1e3a5f", borderRadius: 8, color: "#f5b222", fontSize: 18, fontFamily: "'JetBrains Mono'", fontWeight: 800, letterSpacing: 4, outline: "none", transition: "border-color 0.2s", boxSizing: "border-box" }}
              onFocus={e => e.target.style.borderColor = "#f5b222"}
              onBlur={e => e.target.style.borderColor = "#1e3a5f"}
            />
            <button
              onClick={randomRoom}
              style={{ padding: "0 16px", background: "#0c1c2a", border: "1px solid #1e3a5f", borderRadius: 8, color: "#94a3b8", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
              onMouseOver={e => { e.target.style.background = "#162c3d"; e.target.style.color = "#ffffff"; }}
              onMouseOut={e => { e.target.style.background = "#0c1c2a"; e.target.style.color = "#94a3b8"; }}
            >
              🎲 Auto
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#475569" }}>The first player to join a room becomes the NESO host.</div>
        </div>

        <button
          data-testid="join-waiting-room"
          onClick={onNext}
          disabled={!canProceed}
          style={{
            width: "100%", padding: "16px", borderRadius: 8, border: "none",
            background: canProceed ? "linear-gradient(135deg, #1de98b, #059669)" : "#1a3045",
            color: canProceed ? "#022c22" : "#4d7a96",
            fontSize: 16, fontWeight: 900, cursor: canProceed ? "pointer" : "not-allowed",
            letterSpacing: 1, fontFamily: "'Outfit'", transition: "all 0.3s",
            boxShadow: canProceed ? "0 4px 14px #1de98b44" : "none"
          }}
          onMouseOver={e => { if (canProceed) e.target.style.transform = "translateY(-2px)"; }}
          onMouseOut={e => { if (canProceed) e.target.style.transform = "translateY(0)"; }}
        >
          JOIN WAITING ROOM →
        </button>

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 10, color: "#334155" }}>
          For educational purposes only.<br />Not affiliated with National Energy System Operator.
        </div>

      </div>
    </div>
  );
}

/* ─── ASSET SELECT ─── */
const Spec = ({ label, val, col }) => (<div><div style={{ fontSize: 7, color: "#2a5570", marginBottom: 1 }}>{label}</div><div style={{ fontSize: 11, fontFamily: "'JetBrains Mono'", fontWeight: 700, color: col }}>{val}</div></div>);
function AssetScreen({ onSelect, playerName, room, scenario, role }) {
  const [hov, setHov] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [customVals, setCustomVals] = useState({});

  const handleAction = (def) => {
    if (editingKey === def.key) {
      const config = { ...customVals };
      if (config.eff !== undefined) config.eff = config.eff / 100;
      onSelect(def.key, config);
    } else {
      setEditingKey(def.key);
      setCustomVals({ maxMW: def.maxMW, maxMWh: def.maxMWh, wear: def.wear, eff: def.eff ? def.eff * 100 : undefined });
    }
  };

  const updateVal = (k, v) => setCustomVals(prev => ({ ...prev, [k]: v }));

  return (
    <div style={{ background: "#050e16", minHeight: "100vh", overflowY: "auto", padding: "24px 16px" }}>
      <div style={{ maxWidth: 1060, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 17, fontWeight: 700, color: "#1de98b", letterSpacing: 2 }}>⚡ GRIDFORGE · ROOM <span style={{ color: "#f5b222" }}>{room}</span></div>
          <div style={{ fontSize: 11, color: scenario.col, marginTop: 4 }}>{scenario.emoji} Scenario: <strong>{scenario.name}</strong> — {scenario.desc}</div>
          <div style={{ fontSize: 10, color: "#4d7a96", marginTop: 3 }}><strong style={{ color: "#ddeeff" }}>{playerName}</strong> — choose the asset you'll operate</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 10 }}>
          {Object.values(role === "SUPPLIER" ? SUPPLIERS : ASSETS).filter(a => {
            // INTERCONNECTOR role no longer exists; treated as system asset so filter not needed
            if (role === "BESS") return a.kind === "soc";
            if (role === "GENERATOR") return a.kind !== "interconnector" && a.kind !== "soc" && a.key !== "DSR";
            return true;
          }).map(def => {
            const isEditing = editingKey === def.key;
            return (
              <div key={def.key} onMouseEnter={() => setHov(def.key)} onMouseLeave={() => setHov(null)} style={{ background: hov === def.key ? "#0c1c2a" : "#08141f", border: `1px solid ${hov === def.key ? def.col : "#1a3045"}`, borderRadius: 12, padding: "16px", cursor: "pointer", transition: "all .15s", transform: hov === def.key ? "translateY(-2px)" : "none" }} onClick={(e) => { if (e.target.tagName !== "INPUT" && isEditing) handleAction(def); else if (!isEditing) handleAction(def); }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ fontSize: 32, filter: `drop-shadow(0 0 8px ${def.col}44)` }}>{def.emoji}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#ffffff", letterSpacing: .5 }}>{def.name}</div>
                    <div style={{ fontSize: 10, color: def.col, fontWeight: 700, marginTop: 2 }}>{def.key} TYPE</div>
                  </div>
                  <div style={{ fontSize: 7.5, padding: "2px 7px", borderRadius: 4, background: def.sides === "short" ? "#1f0709" : def.sides === "long" ? "#021520" : "#071f13", color: def.sides === "short" ? "#f0455a" : def.sides === "long" ? "#38c0fc" : "#1de98b", fontWeight: 700 }}>{def.sides === "both" ? "↑↓ BOTH" : def.sides === "short" ? "↑ SELLER" : "↓ BUYER"}</div>
                </div>

                {isEditing ? (
                  <div style={{ background: "#050e16", borderRadius: 8, padding: "10px", marginBottom: 10, border: "1px solid #1a3045" }}>
                    <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 8, fontWeight: 700 }}>🛠️ CUSTOMIZE ASSET RUNTIME RATINGS</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 8, color: "#2a5570", display: "block", marginBottom: 3 }}>Max Power (MW)</label>
                        <input type="number" value={customVals.maxMW ?? ""} onChange={e => updateVal("maxMW", +e.target.value)} style={{ width: "100%", padding: "6px", background: "#0c1c2a", border: "1px solid #1a3045", color: def.col, fontSize: 11, fontFamily: "JetBrains Mono", borderRadius: 4, boxSizing: "border-box" }} />
                      </div>
                      {def.maxMWh !== undefined && (
                        <div>
                          <label style={{ fontSize: 8, color: "#2a5570", display: "block", marginBottom: 3 }}>Storage (MWh)</label>
                          <input type="number" value={customVals.maxMWh ?? ""} onChange={e => updateVal("maxMWh", +e.target.value)} style={{ width: "100%", padding: "6px", background: "#0c1c2a", border: "1px solid #1a3045", color: def.col, fontSize: 11, fontFamily: "JetBrains Mono", borderRadius: 4, boxSizing: "border-box" }} />
                        </div>
                      )}
                      {def.wear !== undefined && (
                        <div>
                          <label style={{ fontSize: 8, color: "#2a5570", display: "block", marginBottom: 3 }}>Wear Cost (£/MWh)</label>
                          <input type="number" value={customVals.wear ?? ""} onChange={e => updateVal("wear", +e.target.value)} style={{ width: "100%", padding: "6px", background: "#0c1c2a", border: "1px solid #1a3045", color: "#f0455a", fontSize: 11, fontFamily: "JetBrains Mono", borderRadius: 4, boxSizing: "border-box" }} />
                        </div>
                      )}
                      {def.eff !== undefined && (
                        <div>
                          <label style={{ fontSize: 8, color: "#2a5570", display: "block", marginBottom: 3 }}>Efficiency (%)</label>
                          <input type="number" value={customVals.eff ?? ""} onChange={e => updateVal("eff", +e.target.value)} style={{ width: "100%", padding: "6px", background: "#0c1c2a", border: "1px solid #1a3045", color: "#f5b222", fontSize: 11, fontFamily: "JetBrains Mono", borderRadius: 4, boxSizing: "border-box" }} />
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ background: "#0c1c2a", borderRadius: 7, padding: "6px 8px", marginBottom: 7, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                      {role === "SUPPLIER" ? (
                        <>
                          <Spec label="Portfolio" val={`${def.portfolioMw} MW`} col={def.col} />
                          <Spec label="Customers" val={def.customers} col={def.col} />
                          <Spec label="Hedge" val={def.hedgeHorizon} col="#f5b222" />
                          <Spec label="Tariff" val={`£${def.retailTariff}`} col="#1de98b" />
                        </>
                      ) : (
                        <>
                          <Spec label="Power" val={`${def.maxMW} MW`} col={def.col} />
                          {def.maxMWh && <Spec label="Energy" val={`${def.maxMWh} MWh`} col={def.col} />}
                          {def.fuelMWh && <Spec label="Fuel" val={`${def.fuelMWh} MWh`} col="#f5b222" />}
                          {def.eff && <Spec label="Efficiency" val={`${(def.eff * 100).toFixed(0)}% η`} col="#f5b222" />}
                          {def.wear > 0 ? <Spec label="Wear" val={`£${def.wear}/MWh`} col="#f0455a" /> : <Spec label="Wear" val="£0/MWh" col="#1de98b" />}
                        </>
                      )}
                    </div>
                    <div style={{ fontSize: 8.5, color: "#4d7a96", lineHeight: 1.6, marginBottom: 8 }}>{def.desc}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 10 }}>
                      <div>{def.pros?.map((p, i) => <div key={i} style={{ fontSize: 7.5, color: "#1de98b", marginBottom: 2 }}>✓ {p}</div>)}</div>
                      <div>{def.cons?.map((c, i) => <div key={i} style={{ fontSize: 7.5, color: "#f0455a", marginBottom: 2 }}>✗ {c}</div>)}</div>
                    </div>
                  </>
                )}
                <button onClick={() => handleAction(def)} style={{ width: "100%", padding: "7px 0", background: hov === def.key || isEditing ? def.col : "#102332", border: `1px solid ${def.col}`, borderRadius: 6, color: hov === def.key || isEditing ? "#050e16" : def.col, fontWeight: 900, fontSize: 10.5, cursor: "pointer", transition: "all .18s", fontFamily: "'Outfit'" }}>
                  {isEditing ? `CONFIRM & JOIN SIMULATION →` : `SELECT OR CONFIGURE ${def.name.toUpperCase()} →`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── FORECAST STRIP ─── */
function ForecastStrip({ forecasts }) {
  if (!forecasts || forecasts.length === 0) return null;
  return (
    <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
        <Tip text="Predicted conditions for the next 4 Settlement Periods. ±22% forecast noise. HIGH confidence = SP 1-2 ahead; MEDIUM = SP 3-4.">
          <span style={{ fontSize: 9, color: "#4d7a96", textTransform: "uppercase", letterSpacing: .8, borderBottom: "1px dashed #2a5570" }}>📈 4-SP Forecast</span>
        </Tip>
        <span style={{ fontSize: 7.5, color: "#2a5570" }}>±22% noise</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5 }}>
        {forecasts.map((f, i) => (
          <div key={i} style={{ background: f.isShort ? "#100508" : "#040f09", border: `1px solid ${f.isShort ? "#f0455a" : "#1de98b"}22`, borderRadius: 5, padding: "5px 6px", opacity: f.confident ? 1 : 0.6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}><span style={{ fontFamily: "'JetBrains Mono'", fontSize: 7.5, color: "#4d7a96" }}>SP{f.sp}</span>{!f.confident && <span style={{ fontSize: 6.5, color: "#2a5570" }}>?</span>}</div>
            <div style={{ fontSize: 9, fontWeight: 800, color: f.isShort ? "#f0455a" : "#1de98b" }}>{f.isShort ? "🔴 SHORT" : "🟢 LONG"}</div>
            <div style={{ fontSize: 7.5, fontFamily: "'JetBrains Mono'", color: "#4d7a96", marginTop: 2 }}>{f0(Math.abs(f.niv))} MW</div>
            <div style={{ fontSize: 7, color: "#f5b222", marginTop: 1 }}>£{f.priceLo}–{f.priceHi}</div>
            <div style={{ fontSize: 7, color: "#a3e635", marginTop: 1 }}>💨 {f.wf}%</div>
            {f.event && <div style={{ fontSize: 7, marginTop: 2 }}>{f.event.emoji} <span style={{ color: f.event.col }}>{f.event.name.slice(0, 10)}</span></div>}
          </div>
        ))}
      </div>
    </div>
  );
}









/* ─── MARKET CENTER ─── */
const BM = ({ label, val, vc, sub, border, tip }) => { const inner = (<div style={{ padding: "9px 11px", borderLeft: border ? "1px solid #1a3045" : "none" }}><div style={{ fontSize: 7.5, color: "#4d7a96", marginBottom: 3, textTransform: "uppercase", letterSpacing: .5 }}>{label}</div><div style={{ fontSize: 18, fontFamily: "'JetBrains Mono'", fontWeight: 900, color: vc || "#ddeeff" }}>{val}</div><div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 1 }}>{sub}</div></div>); return tip ? <Tip text={tip}>{inner}</Tip> : inner; };

function PriceChart({ history }) {
  const prices = history.map(h => h.cp).filter(Boolean);
  if (prices.length < 2) return null;
  const W = 460, H = 38, YPAD = 5;
  const lo = Math.min(...prices) * 0.9, hi = Math.max(...prices) * 1.1, range = hi - lo || 1;
  const pts = prices.map((p, i) => `${((i / (prices.length - 1)) * W).toFixed(1)},${(H - ((p - lo) / range) * (H - YPAD * 2) + YPAD).toFixed(1)}`);
  const path = "M " + pts.join(" L "); const lastY = H - ((prices[prices.length - 1] - lo) / range) * (H - YPAD * 2) + YPAD;
  return (
    <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 6, padding: "4px 9px", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 1 }}>
        <div style={{ fontSize: 7.5, color: "#4d7a96" }}>CLEARING PRICE HISTORY</div>
        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 8.5, fontWeight: 700, color: "#f5b222" }}>£{f1(prices[prices.length - 1])} last</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: "calc(100% - 18px)" }}>
        <defs><linearGradient id="pg5" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f5b222" stopOpacity=".2" /><stop offset="100%" stopColor="#f5b222" stopOpacity=".02" /></linearGradient></defs>
        {[0, .5, 1].map((t, i) => <line key={i} x1={0} y1={YPAD + (1 - t) * (H - YPAD * 2)} x2={W} y2={YPAD + (1 - t) * (H - YPAD * 2)} stroke="#1a3045" strokeWidth="0.5" />)}
        <path d={path + ` L ${W},${H} L 0,${H} Z`} fill="url(#pg5)" />
        <path d={path} fill="none" stroke="#f5b222" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <circle cx={W} cy={lastY} r="3" fill="#f5b222" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function MarketCenter({ market, allBids, simRes, spHistory, pid, assetKey }) {
  const { niv, isShort, sbp, ssp, freq, event } = market;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", borderBottom: "1px solid #1a3045", flexShrink: 0 }}>
        <BM label="NET IMBALANCE" val={`${niv >= 0 ? "+" : ""}${f0(niv)} MW`} vc={isShort ? "#f0455a" : "#1de98b"} sub={isShort ? "SHORT — ESO buys MW" : "LONG — ESO sells MW"} tip="NIV: Negative = SHORT (needs MW). Positive = LONG (surplus MW). ESO procures from cheapest available offers." />
        <BM label="FREQUENCY" val={`${freq.toFixed(3)} Hz`} vc={freq < 49.75 ? "#f0455a" : freq > 50.25 ? "#38c0fc" : "#1de98b"} sub="Target 50.000 Hz" border tip="Grid frequency. 50Hz = balanced. Falls below 50 when SHORT, rises when LONG." />
        <BM label="SYSTEM BUY PRICE" val={`£${f1(sbp)}`} vc="#f5b222" sub="Sellers earn this" border tip="SBP — price ESO pays when SHORT. Ceiling for seller revenue this SP." />
        <BM label="SYSTEM SELL PRICE" val={`£${f1(ssp)}`} vc="#38c0fc" sub="Buyers earn this" border tip="SSP — price ESO receives when LONG. Buyers earn this as revenue." />
      </div>
      {event && (<div className="fadeUp" style={{ padding: "6px 12px", background: isShort ? "#130608" : "#071f13", borderBottom: `1px solid ${event.col}33`, display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>{event.emoji}</span>
        <div style={{ flex: 1 }}><div style={{ fontSize: 10.5, fontWeight: 800, color: event.col }}>{event.name}</div><div style={{ fontSize: 8.5, color: "#4d7a96" }}>{event.desc}</div></div>
        <div style={{ textAlign: "right", flexShrink: 0 }}><div style={{ fontSize: 7, color: "#4d7a96" }}>PRICE IMPACT</div><div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 700, color: event.col }}>{event.pd >= 0 ? "+" : ""}£{Math.abs(event.pd)}/MWh</div></div>
      </div>)}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", padding: "7px 10px", gap: 6 }}>
        <SupplyDemandCurve allBids={allBids} market={market} simRes={simRes} />
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, gap: 8 }}>
          <Tip text="SELLERS submit OFFERS when SHORT. BUYERS submit BIDS when LONG. Only the active side is dispatched each SP."><span style={{ fontSize: 8.5, color: "#4d7a96", textTransform: "uppercase", letterSpacing: .8, borderBottom: "1px dashed #2a5570", cursor: "help" }}>Live Two-Sided Order Book</span></Tip>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, fontSize: 8.5 }}>
            <span style={{ color: isShort ? "#f0455a" : "#2a5570", fontWeight: 700 }}>{allBids.filter(b => b.side === "offer").length} sellers</span>
            <span style={{ color: !isShort ? "#1de98b" : "#2a5570", fontWeight: 700 }}>{allBids.filter(b => b.side === "bid").length} buyers</span>
            <span style={{ color: "#38c0fc", fontWeight: 700 }}>{f0(simRes.cleared)} MW cleared</span>
            {simRes.full && <span style={{ color: "#1de98b", fontWeight: 800 }}>✓ FULL</span>}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <TwoSidedOrderBook allBids={allBids} market={market} simRes={simRes} pid={pid} assetKey={assetKey} />
        </div>
        {spHistory.length > 2 && <div style={{ height: 56, flexShrink: 0 }}><PriceChart history={[...spHistory].reverse()} /></div>}
      </div>
    </div>
  );
}

/* ─── CAPACITY WIDGET ─── */
function CapacityWidget({ def, soc, wf, market, avail, lastRes }) {
  const { isShort } = market;
  const [flowDir, setFlowDir] = useState(null), [flowKey, setFlowKey] = useState(0), [socPulseKey, setSocPulseKey] = useState(0);
  useEffect(() => {
    if (lastRes?.accepted && (def.kind === "soc" || def.kind === "fuel")) {
      const dir = lastRes.isShort ? "discharge" : "charge"; setFlowDir(dir); setFlowKey(k => k + 1); setSocPulseKey(k => k + 1);
      setTimeout(() => setFlowDir(null), 2500);
    }
  }, [lastRes, def.kind]);
  const FlowArrows = ({ dir }) => { const isDis = dir === "discharge", col = isDis ? "#f0455a" : "#1de98b"; return (<div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "3px 0" }}><span style={{ fontSize: 9, color: col, fontWeight: 700 }}>{isDis ? "Discharging →" : "← Charging"}</span>{[0, 1, 2, 3].map(i => (<span key={i} style={{ fontSize: 12, color: col, display: "inline-block", animation: `${isDis ? "flowDown" : "flowUp"} 0.8s ${i * 0.14}s ease-in-out infinite` }}>{isDis ? "↓" : "↑"}</span>))}</div>); };
  if (def.kind === "soc") {
    const barCol = soc < 22 ? "#f0455a" : soc > 78 ? "#38c0fc" : def.col;
    const availDis = clamp(((soc - MIN_SOC) / 100 * def.maxMWh) / 0.5, 0, def.maxMW);
    const availCha = clamp(((MAX_SOC - soc) / 100 * def.maxMWh * def.eff) / 0.5, 0, def.maxMW);
    return (
      <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 9, padding: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 9.5 }}>
          <Tip text="State of Charge — % of energy stored. Below 10% = can't discharge. Above 90% = can't charge. Efficiency loss applies on charging."><span style={{ color: "#4d7a96", borderBottom: "1px dashed #2a5570", cursor: "help" }}>STATE OF CHARGE</span></Tip>
          <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700, color: barCol }}>{f1(soc)}%</span>
        </div>
        <div style={{ height: 17, background: "#162c3d", borderRadius: 4, position: "relative", overflow: "hidden", marginBottom: 6 }} key={socPulseKey}>
          <div style={{ position: "absolute", left: `${MIN_SOC}%`, top: 0, height: "100%", width: 1, background: "#f0455a66" }} />
          <div style={{ position: "absolute", left: `${MAX_SOC}%`, top: 0, height: "100%", width: 1, background: "#38c0fc66" }} />
          <div className={socPulseKey > 0 ? "soc-pulse" : ""} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${soc}%`, background: barCol, transition: "width .8s cubic-bezier(.4,0,.2,1), background .3s", borderRadius: 4, opacity: .9 }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7.5, color: "rgba(255,255,255,.7)", fontWeight: 700, pointerEvents: "none" }}>{f1(soc / 100 * def.maxMWh)} / {def.maxMWh} MWh</div>
          {flowDir && <div style={{ position: "absolute", top: 0, bottom: 0, width: 3, background: `linear-gradient(transparent,${flowDir === "discharge" ? "#f0455a" : "#1de98b"},transparent)`, left: `${soc}%`, transform: "translateX(-50%)", animation: `${flowDir === "discharge" ? "flowDown" : "flowUp"} 0.6s ease-in-out infinite`, opacity: .8 }} />}
        </div>
        {flowDir && <FlowArrows key={flowKey} dir={flowDir} />}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: flowDir ? 0 : 2 }}>
          <div style={{ background: isShort ? "#1f0709" : "#071f13", borderRadius: 5, padding: "4px 7px", border: `1px solid ${isShort ? "#f0455a18" : "#1de98b18"}`, opacity: isShort ? 1 : .5 }}>
            <div style={{ fontSize: 7, color: "#4d7a96" }}>⬆ DISCHARGE (SELL)</div>
            <div style={{ fontFamily: "'JetBrains Mono'", color: isShort ? "#f0455a" : "#4d7a96", fontWeight: 700, fontSize: 11 }}>{f0(availDis)} MW</div>
          </div>
          <div style={{ background: !isShort ? "#021520" : "#071f13", borderRadius: 5, padding: "4px 7px", border: `1px solid ${!isShort ? "#38c0fc18" : "#1a3045"}`, opacity: !isShort ? 1 : .5 }}>
            <div style={{ fontSize: 7, color: "#4d7a96" }}>⬇ CHARGE (BUY)</div>
            <div style={{ fontFamily: "'JetBrains Mono'", color: !isShort ? "#38c0fc" : "#4d7a96", fontWeight: 700, fontSize: 11 }}>{f0(availCha)} MW</div>
          </div>
        </div>
        <div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 5 }}>η={f0(def.eff * 100)}% · wear £{def.wear}/MWh · bounds {MIN_SOC}–{MAX_SOC}%</div>
      </div>
    );
  }
  if (def.kind === "fuel") {
    const pct = (soc / def.fuelMWh) * 100, fCol = pct < 20 ? "#f0455a" : pct < 45 ? "#f5b222" : def.col;
    return (
      <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 9, padding: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 9.5 }}><span style={{ color: "#4d7a96" }}>FUEL TANK</span><span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700, color: fCol }}>{f1(pct)}%</span></div>
        <div style={{ height: 16, background: "#162c3d", borderRadius: 4, overflow: "hidden", marginBottom: 6, position: "relative" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: fCol, transition: "width .8s cubic-bezier(.4,0,.2,1)", borderRadius: 4, opacity: .88 }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7.5, color: "rgba(255,255,255,.65)", fontWeight: 700 }}>{f0(soc)} / {def.fuelMWh} MWh</div>
        </div>
        {flowDir && <FlowArrows key={flowKey} dir={flowDir} />}
        <div style={{ background: "#1f0709", borderRadius: 5, padding: "4px 7px", border: "1px solid #f0455a18" }}>
          <div style={{ fontSize: 7, color: "#4d7a96" }}>⬆ AVAILABLE (SELLER)</div>
          <div style={{ fontFamily: "'JetBrains Mono'", color: def.col, fontWeight: 700, fontSize: 11 }}>{f0(avail)} MW</div>
        </div>
        <div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 5 }}>Fuel: {f0(soc)}/{def.fuelMWh} MWh · ~£90/MWh marginal · SELLER only</div>
      </div>
    );
  }
  if (def.kind === "wind") {
    const pct = (wf || 0) * 100, wCol = pct < 20 ? "#f0455a" : pct < 50 ? "#f5b222" : def.col;
    return (
      <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 9, padding: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 9.5 }}><span style={{ color: "#4d7a96" }}>WIND OUTPUT</span><span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700, color: wCol }}>{f1(pct)}% cap.</span></div>
        <div style={{ height: 16, background: "#162c3d", borderRadius: 4, overflow: "hidden", marginBottom: 6 }}><div style={{ height: "100%", width: `${pct}%`, background: wCol, transition: "width .6s", borderRadius: 4, opacity: .88 }} /></div>
        <div style={{ background: "#071f13", borderRadius: 5, padding: "4px 7px", border: "1px solid #a3e63518" }}>
          <div style={{ fontSize: 7, color: "#4d7a96" }}>⬆ AVAILABLE (SELLER)</div>
          <div style={{ fontFamily: "'JetBrains Mono'", color: def.col, fontWeight: 700, fontSize: 11 }}>{f0(avail)} MW</div>
        </div>
        <div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 5 }}>£0 marginal cost · SELLER only · output varies with weather</div>
      </div>
    );
  }
  return (
    <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 9, padding: 10 }}>
      <div style={{ fontSize: 9.5, color: "#4d7a96", marginBottom: 7 }}>FLEX CAPACITY</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
        <div style={{ background: isShort ? "#1f0709" : "#071f13", borderRadius: 5, padding: "4px 7px", border: `1px solid ${isShort ? "#f0455a18" : "#1de98b18"}`, opacity: isShort ? 1 : .5 }}>
          <div style={{ fontSize: 7, color: "#4d7a96" }}>⬆ TURN DOWN (SELL)</div>
          <div style={{ fontFamily: "'JetBrains Mono'", color: isShort ? "#f0455a" : "#4d7a96", fontWeight: 700, fontSize: 11 }}>{def.maxMW} MW</div>
        </div>
        <div style={{ background: !isShort ? "#021520" : "#071f13", borderRadius: 5, padding: "4px 7px", border: `1px solid ${!isShort ? "#38c0fc18" : "#1a3045"}`, opacity: !isShort ? 1 : .5 }}>
          <div style={{ fontSize: 7, color: "#4d7a96" }}>⬇ TURN UP (BUY)</div>
          <div style={{ fontFamily: "'JetBrains Mono'", color: !isShort ? "#38c0fc" : "#4d7a96", fontWeight: 700, fontSize: 11 }}>{def.maxMW} MW</div>
        </div>
      </div>
      <div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 5 }}>Unlimited energy · £0 wear · SELLER or BUYER</div>
    </div>
  );
}

/* ─── ASSET PANEL ─── */
function AssetPanel({ market, soc, cash, daCash, myBid, setMyBid, submitted, onSubmit, lastRes, phase, playerName, assetKey, allBids, simRes, pid, forecasts }) {
  const { isShort, sbp, ssp, wf } = market;
  const def = ASSETS[assetKey] || {};
  const avail = availMW(def, soc, market);
  const canJoin = def.sides === "both" || (def.sides === "short" && isShort) || (def.sides === "long" && !isShort);
  const ref = isShort ? sbp : ssp, pn = +myBid.price;
  const ok = myBid.price && !isNaN(pn) && (isShort ? pn <= ref * 1.05 : pn >= ref * 0.95);
  const isDaPhase = phase === "DA";
  const canSub = canJoin && !submitted && myBid.price && !isNaN(pn) && +myBid.mw > 0 && +myBid.mw <= avail + 0.5 && phase === "BM";
  const qPrices = isShort ? [{ val: Math.round(sbp * 0.60), label: "Aggressive", sub: "60% SBP" }, { val: Math.round(sbp * 0.82), label: "Moderate", sub: "82% SBP" }, { val: Math.round(sbp * 0.97), label: "At market", sub: "≈SBP" }] : [{ val: Math.round(ssp * 1.38), label: "Aggressive", sub: "138% SSP" }, { val: Math.round(ssp * 1.14), label: "Moderate", sub: "114% SSP" }, { val: Math.round(ssp * 0.97), label: "At market", sub: "≈SSP" }];
  const smartBid = () => { let sp; if (def.key === "WIND") sp = 5; else if (def.key === "DSR") sp = isShort ? Math.round(sbp * 0.45) : Math.round(ssp * 1.45); else if (def.key === "OCGT") sp = Math.round(sbp * 0.85); else if (def.key === "HYDRO") sp = isShort ? Math.round(sbp * 0.70) : Math.round(ssp * 1.22); else sp = isShort ? Math.round(sbp * 0.78) : Math.round(ssp * 1.18); setMyBid(b => ({ ...b, price: String(sp), mw: Math.min(Math.floor(avail), def.maxMW) })); };
  const myBidObj = (myBid.price && !isNaN(+myBid.price) && +myBid.mw > 0) ? { id: pid || "preview", name: "You", asset: assetKey, mw: +myBid.mw, price: +myBid.price, side: isShort ? "offer" : "bid", col: def.col, isBot: false } : null;
  const bidsWithMine = myBidObj ? [...allBids.filter(b => b.id !== pid), myBidObj] : allBids;
  const previewRes = myBidObj ? clearBM(bidsWithMine, market) : null;
  const previewMine = previewRes?.accepted.find(a => a.id === (pid || "preview"));
  const previewRank = myBidObj ? [...bidsWithMine].filter(b => b.side === (isShort ? "offer" : "bid") && +b.mw > 0).sort((a, b) => isShort ? +a.price - +b.price : +b.price - +a.price).findIndex(b => b.id === (pid || "preview")) : -1;
  return (
    <div style={{ padding: 11, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ background: "#0c1c2a", border: `1px solid ${def.col || "#1a3045"}33`, borderRadius: 9, padding: "9px 11px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>{def.emoji}</span>
          <div style={{ flex: 1 }}><div style={{ fontSize: 11.5, fontWeight: 800 }}>{playerName}</div><div style={{ fontSize: 8.5, color: def.col, fontWeight: 700 }}>{def.name} · {def.maxMW}MW</div></div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 7, color: "#4d7a96" }}>BM P&L</div><AnimatedPL value={cash} />{daCash !== 0 && <div style={{ fontSize: 7.5, color: "#f5b222", fontFamily: "'JetBrains Mono'" }}>+£{f0(daCash)} DA</div>}</div>
        </div>
      </div>
      <div style={{ background: isShort ? "#1f0709" : "#071f13", border: `1px solid ${isShort ? "#f0455a" : "#1de98b"}44`, borderRadius: 8, padding: "7px 11px", textAlign: "center" }}>
        <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>GRID SIGNAL</div>
        <div style={{ fontSize: 15, fontWeight: 900, color: isShort ? "#f0455a" : "#1de98b" }}>{isShort ? "🔴 SYSTEM SHORT" : "🟢 SYSTEM LONG"}</div>
        <div style={{ fontSize: 8, color: "#4d7a96", marginTop: 2 }}>{isShort ? `${f0(Math.abs(market.niv))} MW deficit → you are a SELLER` : `${f0(market.niv)} MW surplus → you are a BUYER`}</div>
        <div style={{ marginTop: 5, display: "flex", justifyContent: "center", gap: 7 }}>
          <div style={{ padding: "2px 7px", borderRadius: 4, background: isShort ? "#f0455a22" : "#1a3045", border: `1px solid ${isShort ? "#f0455a44" : "#1a3045"}`, fontSize: 7.5, color: isShort ? "#f0455a" : "#2a5570", fontWeight: isShort ? 700 : 400 }}>⬆ SELLERS</div>
          <div style={{ padding: "2px 7px", borderRadius: 4, background: !isShort ? "#1de98b22" : "#1a3045", border: `1px solid ${!isShort ? "#1de98b44" : "#1a3045"}`, fontSize: 7.5, color: !isShort ? "#1de98b" : "#2a5570", fontWeight: !isShort ? 700 : 400 }}>⬇ BUYERS</div>
        </div>
      </div>
      <CapacityWidget def={def} soc={soc} wf={wf} market={market} avail={avail} lastRes={lastRes} />
      <ForecastStrip forecasts={forecasts} />
      {!isDaPhase && canJoin ? (
        <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 9, padding: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
            <div style={{ fontSize: 8.5, color: "#4d7a96", textTransform: "uppercase", letterSpacing: .8 }}>{isShort ? "You are a SELLER — Submit Offer" : "You are a BUYER — Submit Bid"}</div>
            <button onClick={smartBid} disabled={submitted || phase !== "BM"} style={{ padding: "3px 8px", background: "#102332", border: "1px solid #234159", borderRadius: 4, color: "#38c0fc", fontSize: 8, cursor: "pointer", fontWeight: 700 }}>✦ Smart</button>
          </div>
          <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>VOLUME (MW) — {f0(avail)} MW available</div>
          <div style={{ display: "flex", gap: 5, marginBottom: 7 }}>
            <input type="number" value={myBid.mw} min={1} max={avail} disabled={submitted || phase !== "BM"} onChange={e => setMyBid(b => ({ ...b, mw: Math.max(1, Math.min(+e.target.value || 1, def.maxMW)) }))} style={{ flex: 1, padding: "7px 9px", background: "#102332", border: "1px solid #234159", borderRadius: 5, color: "#ddeeff", fontSize: 13, fontFamily: "'JetBrains Mono'" }} />
            <button onClick={() => setMyBid(b => ({ ...b, mw: Math.floor(avail) }))} disabled={submitted || phase !== "BM"} style={{ padding: "0 9px", background: "#102332", border: "1px solid #234159", borderRadius: 5, color: "#4d7a96", fontSize: 8, cursor: "pointer" }}>MAX</button>
          </div>
          <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>{isShort ? "OFFER PRICE" : "BID PRICE"} (£/MWh) <span style={{ color: "#2a5570" }}>ref {isShort ? `SBP £${f0(sbp)}` : `SSP £${f0(ssp)}`}</span></div>
          <input type="number" value={myBid.price} placeholder={`~£${f0(ref * (isShort ? 0.82 : 1.18))}`} disabled={submitted || phase !== "BM"} onChange={e => setMyBid(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "7px 9px", background: "#102332", border: `1px solid ${myBid.price ? (ok ? "#1de98b44" : "#f0455a44") : "#234159"}`, borderRadius: 5, color: "#ddeeff", fontSize: 13, fontFamily: "'JetBrains Mono'", marginBottom: 3 }} />
          {myBid.price && <div style={{ fontSize: 7.5, color: ok ? "#1de98b" : "#f5b222", marginBottom: 5 }}>{ok ? "✓ Competitive — likely accepted in merit order" : "⚠ Aggressive — risk being out-competed"}</div>}
          {myBidObj && (
            <div className="fadeIn" style={{ background: previewMine ? "#071f13" : "#0c0c18", border: `1px solid ${previewMine ? "#1de98b33" : "#2a5570"}`, borderRadius: 7, padding: "7px 9px", marginBottom: 6 }}>
              <div style={{ fontSize: 7.5, color: "#2a5570", marginBottom: 4, textTransform: "uppercase", letterSpacing: .6 }}>Live Simulation Preview</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                <div><div style={{ fontSize: 7, color: "#2a5570" }}>MERIT RANK</div><div style={{ fontSize: 12, fontFamily: "'JetBrains Mono'", fontWeight: 700, color: previewRank < 3 ? "#1de98b" : "#f5b222" }}>#{previewRank + 1}</div></div>
                <div><div style={{ fontSize: 7, color: "#2a5570" }}>EST. REVENUE</div><div style={{ fontSize: 12, fontFamily: "'JetBrains Mono'", fontWeight: 700, color: previewMine ? "#1de98b" : "#4d7a96" }}>{previewMine ? `+£${f0(previewMine.mwAcc * (previewRes?.cp || 0) * SP_DURATION_H)}` : "—"}</div></div>
                <div><div style={{ fontSize: 7, color: "#2a5570" }}>OUTCOME</div><div style={{ fontSize: 9, fontWeight: 700, color: previewMine ? "#1de98b" : "#f0455a" }}>{previewMine ? "✓ ACCEPT" : "✗ REJECT"}</div></div>
              </div>
              {previewMine && previewRes?.cp > pn && isShort && <div style={{ fontSize: 7.5, color: "#38c0fc", marginTop: 3 }}>↑ Uniform price lifts your £{myBid.price} → £{f1(previewRes.cp)}</div>}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4, marginBottom: 7 }}>
            {qPrices.map((q, i) => (
              <button key={i} onClick={() => setMyBid(b => ({ ...b, price: String(q.val) }))} disabled={submitted || phase !== "BM"} style={{ padding: "5px 0", background: "#102332", border: `1px solid ${myBid.price === String(q.val) ? "#38c0fc44" : "#234159"}`, borderRadius: 4, color: myBid.price === String(q.val) ? "#38c0fc" : "#4d7a96", fontSize: 7.5, cursor: "pointer", fontFamily: "'JetBrains Mono'", transition: "all .12s" }}>
                <div style={{ fontSize: 6.5, color: "#2a5570", marginBottom: 1 }}>{q.label}</div>£{q.val}<div style={{ fontSize: 6, color: "#1e3d54", marginTop: 1 }}>{q.sub}</div>
              </button>
            ))}
          </div>
          <button onClick={onSubmit} disabled={!canSub} style={{ width: "100%", padding: 10, borderRadius: 6, border: "none", background: submitted ? "#102332" : canSub ? (isShort ? "#f0455a" : "#1de98b") : "#1a3045", color: submitted ? "#4d7a96" : canSub ? "#050e16" : "#4d7a96", fontWeight: 900, fontSize: 13, cursor: canSub ? "pointer" : "default", letterSpacing: .4, fontFamily: "'Outfit'", transition: "all .18s" }}>
            {submitted ? "✓ SUBMITTED" : phase !== "BM" ? "AWAITING BM PHASE..." : `${isShort ? "SELL — SUBMIT OFFER" : "BUY — SUBMIT BID"} →`}
          </button>
        </div>
      ) : !isDaPhase && (
        <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 9, padding: "12px 11px", textAlign: "center" }}>
          <div style={{ fontSize: 20, marginBottom: 5 }}>{def.emoji}</div>
          <div style={{ fontSize: 10.5, color: "#f5b222", fontWeight: 700, marginBottom: 4 }}>Sitting out this SP</div>
          <div style={{ fontSize: 8.5, color: "#4d7a96", lineHeight: 1.65 }}>
            {def.key === "OCGT" && "Gas peakers only dispatch when SHORT. Wait for next shortfall."}
            {def.key === "WIND" && "Wind farms only sell when SHORT. No action when LONG."}
          </div>
        </div>
      )}
      {lastRes && (
        <div className={`fadeUp ${lastRes.accepted ? "accepted-glow" : ""}`} style={{ background: lastRes.accepted ? "#071f13" : "#0c0c18", border: `1px solid ${lastRes.accepted ? "#1de98b44" : "#f0455a22"}`, borderRadius: 8, padding: "8px 11px" }}>
          <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 3 }}>LAST SP RESULT</div>
          {lastRes.accepted ? (<>
            <div style={{ fontSize: 9.5, color: "#1de98b", fontWeight: 700 }}>✓ {f0(lastRes.mw)} MW dispatched @ £{f1(lastRes.cp)}/MWh</div>
            {lastRes.isShort && lastRes.myPrice < lastRes.cp && <div style={{ fontSize: 8, color: "#f5b222", marginTop: 2 }}>↑ Uniform price lifted your £{f0(lastRes.myPrice)} offer → £{f1(lastRes.cp)}</div>}
            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 900, color: "#1de98b", marginTop: 3 }}>+£{f0(lastRes.revenue)}</div>
            <div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 2 }}>SoC: {f1(lastRes.prevSof || 0)}% → {f1(lastRes.newSof || 0)}%</div>
          </>) : (<div style={{ fontSize: 9.5, color: "#4d7a96" }}>✗ Out of merit — not dispatched this SP</div>)}
        </div>
      )}
      <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: "8px 10px", fontSize: 8.5, color: "#2a5570", lineHeight: 1.75, marginTop: "auto" }}>
        <strong style={{ color: "#4d7a96" }}>Strategy</strong><br />
        {def.key === "OCGT" && "Bid near £90 when SHORT for near-certain dispatch. In scarcity events, price higher. Save fuel for peak prices."}
        {def.key === "WIND" && "Bid £0–10. Near-zero cost = always near front of merit order. Only fails if no shortfall."}
        {def.key === "DSR" && "No energy limits. Bid very low when SHORT (SELLER), very high when LONG (BUYER). Should never miss."}
        {def.key === "HYDRO" && "Huge capacity, cheap to run. Save SoC for HIGH price SPs — Dunkel, spikes, cold snaps. Use forecast!"}
        {(def.key === "BESS_S" || def.key === "BESS_M" || def.key === "BESS_L") && "SELL (discharge) when SHORT + high price. BUY (charge) when LONG + low price. Use forecast to plan SoC."}
      </div>
    </div>
  );
}

/* ─── RIGHT PANEL ─── */
function RightPanel({ leaderboard, spHistory, pid, room, copyRoom, copied, isInstructor, onInstructorTrigger, onScenarioChange, tickSpeed, paused, freqBreachSec, onTickSpeedChange, onPauseToggle, onNextPhase, gameMode, phase, earnedAchievements }) {
  const [tab, setTab] = useState(isInstructor ? "instructor" : "board");
  const stats = useMemo(() => {
    const total = spHistory.length, accepted = spHistory.filter(h => h.accepted).length;
    const revenues = spHistory.filter(h => h.accepted).map(h => h.revenue);
    const totalRev = revenues.reduce((a, b) => a + b, 0);
    const avgCP = spHistory.filter(h => h.cp).map(h => h.cp);
    const avgClear = avgCP.length ? avgCP.reduce((a, b) => a + b, 0) / avgCP.length : 0;
    const bestSP = spHistory.filter(h => h.accepted).sort((a, b) => b.revenue - a.revenue)[0];
    const streak = (() => { let s = 0; for (const h of spHistory) { if (h.accepted) s++; else break; } return s; })();
    return { total, accepted, winRate: total ? (accepted / total * 100).toFixed(0) : 0, totalRev, avgClear, bestSP, streak };
  }, [spHistory]);
  const tabs = [{ id: "board", label: "🏆 Board" }, { id: "log", label: "📋 Log" }, { id: "stats", label: "📊 Stats" }, { id: "achievements", label: "🎖️ Badges" }, ...(isInstructor ? [{ id: "instructor", label: "🎓 GM" }] : [])];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "7px 12px", borderBottom: "1px solid #1a3045", background: "#08141f", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div><div style={{ fontSize: 7, color: "#4d7a96", letterSpacing: 1.2, marginBottom: 2 }}>ROOM CODE</div><div style={{ fontFamily: "'JetBrains Mono'", fontSize: 17, fontWeight: 900, color: "#f5b222", letterSpacing: 4 }}>{room}</div></div>
          <button onClick={copyRoom} style={{ padding: "5px 9px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: copied ? "#1de98b" : "#4d7a96", fontSize: 8.5, cursor: "pointer", fontWeight: 700, transition: "all .2s" }}>{copied ? "✓ Copied" : "⎘ Copy"}</button>
        </div>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid #1a3045", flexShrink: 0 }}>
        {tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: "6px 4px", background: tab === t.id ? "#0e1e30" : "transparent", border: "none", borderBottom: tab === t.id ? "2px solid #38c0fc" : "2px solid transparent", color: tab === t.id ? "#ddeeff" : "#2a5570", fontSize: 8.5, cursor: "pointer", fontWeight: tab === t.id ? 700 : 400, transition: "all .15s", fontFamily: "'Outfit'" }}>{t.label}</button>)}
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "board" && <LeaderboardTab leaderboard={leaderboard} pid={pid} />}
        {tab === "log" && <LogTab spHistory={spHistory} />}
        {tab === "stats" && <StatsTab stats={stats} spHistory={spHistory} />}
        {tab === "achievements" && <AchievementsTab earned={earnedAchievements} />}
        {tab === "instructor" && isInstructor && <InstructorTab onTrigger={onInstructorTrigger} onScenarioChange={onScenarioChange} tickSpeed={tickSpeed} paused={paused} freqBreachSec={freqBreachSec} onTickSpeedChange={onTickSpeedChange} onPauseToggle={onPauseToggle} onNextPhase={onNextPhase} gameMode={gameMode} phase={phase} />}
      </div>
      <div style={{ padding: "7px 12px", borderTop: "1px solid #1a3045", flexShrink: 0 }}>
        <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4, textTransform: "uppercase", letterSpacing: .8 }}>📖 Key Terms</div>
        {[["NIV", "Net Imbalance Volume — MW the ESO must buy (SHORT) or sell (LONG)"], ["SELLER", "Submits OFFERS to generate or discharge energy when SHORT"], ["BUYER", "Submits BIDS to absorb energy when LONG (e.g. charging battery)"], ["Merit Order", "Cheapest offers dispatched first — last one sets clearing price for ALL"], ["Uniform Price", "All accepted bids earn/pay the same clearing price"], ["DA", "Day-Ahead — forward auction, lock in revenue for next 6 SPs"]].map(([k, v]) => (
          <div key={k} style={{ fontSize: 7.5, color: "#2a5570", marginBottom: 2.5, lineHeight: 1.5 }}><strong style={{ color: "#4d7a96" }}>{k}:</strong> {v}</div>
        ))}
      </div>
    </div>
  );
}

function LeaderboardTab({ leaderboard, pid }) {
  if (leaderboard.length === 0) return <div style={{ padding: 16, fontSize: 9, color: "#2a5570" }}>Waiting for players...</div>;

  // Score color helper
  const sc = (v) => v >= 80 ? '#1de98b' : v >= 60 ? '#38c0fc' : v >= 40 ? '#f5b222' : v >= 20 ? '#f0855a' : '#f0455a';

  return (
    <div style={{ padding: "9px 12px" }}>
      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: 4, marginBottom: 6, padding: '0 8px' }}>
        <span style={{ fontSize: 7, color: '#2a5570', letterSpacing: .5 }}>PLAYER</span>
        <span style={{ fontSize: 7, color: '#38c0fc', letterSpacing: .5, width: 32, textAlign: 'center' }}>ROLE</span>
        <span style={{ fontSize: 7, color: '#f5b222', letterSpacing: .5, width: 32, textAlign: 'center' }}>SYS</span>
        <span style={{ fontSize: 7, color: '#1de98b', letterSpacing: .5, width: 32, textAlign: 'center' }}>ALL</span>
        <span style={{ fontSize: 7, color: '#4d7a96', letterSpacing: .5, width: 44, textAlign: 'right' }}>P&L</span>
      </div>

      {leaderboard.slice(0, 10).map((p, i) => {
        const def = ASSETS[p.asset]; const isMe = p.id === pid; const isGM = p.role === 'instructor';
        const rs = p.roleScore || 0;
        const ss = p.systemScore || 50;
        const os = p.overallScore || 0;
        const total = p.cash || 0;
        const roleDef = ROLES[p.role];
        const rank = p.rank || (i + 1);
        const rankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;

        return (
          <div key={p.id || i} style={{ marginBottom: 5, padding: '6px 8px', borderRadius: 7, background: isMe ? '#0e1e30' : '#08141f', border: `1px solid ${isMe ? def?.col || '#b78bfa' : isGM ? '#b78bfa' : '#1a3045'}22`, transition: 'all .15s' }}>
            {/* Main row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: 4, alignItems: 'center' }}>
              {/* Player info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                <span style={{ fontSize: 10, width: 16, textAlign: 'center', color: rank <= 3 ? '#f5b222' : '#2a5570', flexShrink: 0 }}>{isGM ? '🎓' : rankLabel}</span>
                <span style={{ fontSize: 13, flexShrink: 0 }}>{roleDef?.emoji || def?.emoji || '⚙'}</span>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: 9, color: isMe ? def?.col || '#b78bfa' : '#ddeeff', fontWeight: isMe ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isMe ? '▶ ' : ''}{p.name}</div>
                  <div style={{ fontSize: 7, color: '#2a5570' }}>{roleDef?.name || def?.short || '?'}</div>
                </div>
              </div>
              {/* Role Score */}
              <div style={{ width: 32, textAlign: 'center' }}>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 10, fontWeight: 800, color: sc(rs) }}>{rs}</div>
              </div>
              {/* System Score */}
              <div style={{ width: 32, textAlign: 'center' }}>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 10, fontWeight: 800, color: sc(ss) }}>{ss}</div>
              </div>
              {/* Overall Score */}
              <div style={{ width: 32, textAlign: 'center' }}>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 900, color: sc(os) }}>{os}</div>
              </div>
              {/* P&L */}
              <div style={{ width: 44, textAlign: 'right' }}>
                <AnimatedPL value={total} size={9} />
              </div>
            </div>
            {/* Score bar — shows overall score as a filled bar */}
            <div style={{ height: 2, background: '#1a3045', borderRadius: 1, marginTop: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(3, os)}%`, background: sc(os), borderRadius: 1, opacity: .6, transition: 'width 0.3s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LogTab({ spHistory }) {
  if (spHistory.length === 0) return <div style={{ padding: 16, fontSize: 9, color: "#2a5570" }}>Waiting for first clearing...</div>;
  return (
    <div style={{ padding: "9px 12px" }}>
      {spHistory.map((h, i) => (
        <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid #0c1c2a", display: "grid", gridTemplateColumns: "26px 16px 1fr auto", gap: 4, alignItems: "center" }}>
          <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 7.5, color: "#4d7a96" }}>SP{h.sp}</span>
          <span style={{ fontSize: 9 }}>{h.event?.emoji || ""}</span>
          <div>
            <div style={{ fontSize: 9, color: h.accepted ? "#1de98b" : "#4d7a96" }}>{h.accepted ? `✓ ${f0(h.mw)}MW @ £${f0(h.cp)}` : h.cp ? `✗ CP £${f0(h.cp)}` : "✗ Not dispatched"}</div>
            <div style={{ fontSize: 7.5, color: "#2a5570" }}>{h.time} · NIV {h.niv >= 0 ? "+" : ""}{f0(h.niv)}MW</div>
          </div>
          <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 9.5, fontWeight: 700, color: !h.accepted ? "#2a5570" : h.revenue >= 0 ? "#1de98b" : "#f0455a" }}>{!h.accepted ? "—" : fpp(h.revenue)}</span>
        </div>
      ))}
    </div>
  );
}

function StatsTab({ stats, spHistory }) {
  const { total, accepted, winRate, totalRev, avgClear, bestSP, streak } = stats;
  const StatBox = ({ label, val, sub, col }) => (<div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 7, padding: "7px 9px" }}><div style={{ fontSize: 7.5, color: "#4d7a96", marginBottom: 2 }}>{label}</div><div style={{ fontFamily: "'JetBrains Mono'", fontSize: 15, fontWeight: 900, color: col || "#ddeeff" }}>{val}</div>{sub && <div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 1 }}>{sub}</div>}</div>);
  const revHistory = [...spHistory].reverse().slice(-20).map(h => h.accepted ? h.revenue : 0);
  const sparkMax = Math.max(...revHistory, 1);
  return (
    <div style={{ padding: "9px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
      {total === 0 ? <div style={{ fontSize: 9, color: "#2a5570" }}>No SPs completed yet. Start bidding!</div> : <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <StatBox label="WIN RATE" val={`${winRate}%`} sub={`${accepted}/${total} SPs`} col={+winRate > 60 ? "#1de98b" : +winRate > 30 ? "#f5b222" : "#f0455a"} />
          <StatBox label="TOTAL P&L" val={fpp(totalRev)} sub="BM session" col={totalRev >= 0 ? "#1de98b" : "#f0455a"} />
          <StatBox label="AVG CLR PRICE" val={`£${f1(avgClear)}`} sub="£/MWh" col="#f5b222" />
          <StatBox label="WIN STREAK" val={streak} sub={streak > 2 ? "🔥 on fire" : streak > 0 ? "active" : "—"} col={streak > 3 ? "#f5b222" : streak > 0 ? "#1de98b" : "#2a5570"} />
        </div>
        {bestSP && <div style={{ background: "#071f13", border: "1px solid #1de98b22", borderRadius: 7, padding: "7px 9px" }}>
          <div style={{ fontSize: 7.5, color: "#4d7a96", marginBottom: 3 }}>BEST SETTLEMENT PERIOD</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 16 }}>{bestSP.event?.emoji || "⚡"}</span><div><div style={{ fontSize: 11, fontWeight: 700, color: "#1de98b" }}>+£{f0(bestSP.revenue)}</div><div style={{ fontSize: 8, color: "#2a5570" }}>SP{bestSP.sp} · {bestSP.time} · {f0(bestSP.mw)}MW @ £{f0(bestSP.cp)}</div></div></div>
        </div>}
        {revHistory.length > 3 && <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 7, padding: "7px 9px" }}>
          <div style={{ fontSize: 7.5, color: "#4d7a96", marginBottom: 5 }}>REVENUE PER SP</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 28 }}>
            {revHistory.map((v, i) => <div key={i} style={{ flex: 1, background: v > 0 ? "#1de98b" : "#1a3045", height: `${Math.max(8, (v / sparkMax) * 100)}%`, borderRadius: 2, opacity: .8, transition: "height .3s" }} />)}
          </div>
        </div>}
      </>}
    </div>
  );
}

/* ─── INSTRUCTOR (GAME MASTER) TAB ─── */
function InstructorTab({ onTrigger, onScenarioChange, tickSpeed, paused, freqBreachSec, onTickSpeedChange, onPauseToggle, onNextPhase, gameMode, phase }) {
  const [selScenario, setSelScenario] = useState("NORMAL");
  const urgentEvents = EVENTS.filter(e => ["TRIP", "CASCADE", "SPIKE", "DUNKEL", "COLD"].includes(e.id));
  const benignEvents = EVENTS.filter(e => ["WIND_UP", "DMD_LO", "INTERCON"].includes(e.id));
  const currentSpeedId = Object.values(TICK_SPEEDS).find(s => s.ms === tickSpeed)?.id || "NORMAL";
  return (
    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ background: "#1b0d2a", border: "1px solid #b78bfa44", borderRadius: 8, padding: "8px 10px" }}>
        <div style={{ fontSize: 9, color: "#b78bfa", fontWeight: 700, marginBottom: 6 }}>🎓 GAME MASTER CONTROLS</div>
        <div style={{ fontSize: 8, color: "#4d7a96", lineHeight: 1.65 }}>Trigger market events, change scenario, control game speed, and pause for teaching moments.</div>
      </div>
      {/* MANUAL WORKSHOP PHASE ADVANCEMENT */}
      {gameMode === "WORKSHOP" && (
        <button onClick={onNextPhase} style={{ width: "100%", padding: "12px", background: "#f5b222", border: "none", borderRadius: 8, color: "#050e16", fontSize: 14, fontWeight: 900, cursor: "pointer", fontFamily: "'Outfit'", letterSpacing: 1, boxShadow: "0 0 15px #f5b22244" }}>
          ⏭ ADVANCE TO NEXT PHASE →
          <div style={{ fontSize: 9, color: "#050e1699", marginTop: 2 }}>Current: {phase}</div>
        </button>
      )}
      {/* PAUSE / RESUME */}
      <button onClick={onPauseToggle} style={{ width: "100%", padding: "10px", background: paused ? "#1a0e05" : "#071f13", border: `2px solid ${paused ? "#f5b222" : "#1de98b"}66`, borderRadius: 8, color: paused ? "#f5b222" : "#1de98b", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "'Outfit'", letterSpacing: 1, transition: "all .2s" }}>
        {paused ? "▶ RESUME GAME" : "⏸ PAUSE FOR DISCUSSION"}
      </button>
      {/* TICK SPEED */}
      <div>
        <div style={{ fontSize: 8.5, color: "#b78bfa", marginBottom: 5, textTransform: "uppercase", letterSpacing: .8 }}>⏱ Game Speed</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {Object.values(TICK_SPEEDS).map(s => (
            <button key={s.id} onClick={() => onTickSpeedChange(s.id)} style={{ padding: "6px 6px", background: currentSpeedId === s.id ? `#b78bfa22` : "#0c1c2a", border: `1px solid ${currentSpeedId === s.id ? "#b78bfa" : "#1a3045"}`, borderRadius: 5, color: currentSpeedId === s.id ? "#b78bfa" : "#4d7a96", fontSize: 8.5, cursor: "pointer", fontWeight: currentSpeedId === s.id ? 700 : 400, transition: "all .15s" }}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 7.5, color: "#4d7a96", marginTop: 4, fontStyle: "italic" }}>
          {TICK_SPEEDS[currentSpeedId]?.desc || ""}
        </div>
      </div>
      {/* FREQ BREACH STATUS */}
      {freqBreachSec > 0 && (
        <div style={{ background: "#1f0709", border: "1px solid #f0455a44", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#f0455a", marginBottom: 2 }}>⚠ FREQUENCY BREACH</div>
          <div style={{ fontSize: 8.5, color: "#f0455a88" }}>{FREQ_FAIL_DURATION - freqBreachSec}s to grid failure • Consider pausing to discuss</div>
        </div>
      )}
      {/* Scenario change */}
      <div>
        <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 5, textTransform: "uppercase", letterSpacing: .8 }}>Change Scenario</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 6 }}>
          {Object.values(SCENARIOS).map(s => (
            <button key={s.id} onClick={() => setSelScenario(s.id)} style={{ padding: "5px 6px", background: selScenario === s.id ? `${s.col}22` : "#0c1c2a", border: `1px solid ${selScenario === s.id ? s.col : "#1a3045"}`, borderRadius: 5, color: selScenario === s.id ? s.col : "#4d7a96", fontSize: 8, cursor: "pointer", fontWeight: selScenario === s.id ? 700 : 400 }}>
              {s.emoji} {s.name}
            </button>
          ))}
        </div>
        <button onClick={() => onScenarioChange(selScenario)} style={{ width: "100%", padding: "7px", background: "#1b0d2a", border: "1px solid #b78bfa44", borderRadius: 6, color: "#b78bfa", fontSize: 9, cursor: "pointer", fontWeight: 700, fontFamily: "'Outfit'" }}>🌍 APPLY SCENARIO TO ALL PLAYERS →</button>
      </div>
      {/* Urgent events */}
      <div>
        <div style={{ fontSize: 8.5, color: "#f0455a", marginBottom: 5, textTransform: "uppercase", letterSpacing: .8 }}>⚠ Shortage Events</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {urgentEvents.map(e => (
            <button key={e.id} onClick={() => onTrigger(e.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#1f0709", border: "1px solid #f0455a22", borderRadius: 5, color: "#ddeeff", fontSize: 8.5, cursor: "pointer", textAlign: "left", width: "100%" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{e.emoji}</span>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, color: e.col, fontSize: 9 }}>{e.name}</div><div style={{ fontSize: 7.5, color: "#4d7a96", marginTop: 1 }}>{e.desc}</div></div>
              <div style={{ fontSize: 7.5, color: "#f0455a", fontFamily: "'JetBrains Mono'", flexShrink: 0 }}>{e.pd > 0 ? `+£${e.pd}` : `-£${Math.abs(e.pd)}`}/MWh</div>
            </button>
          ))}
        </div>
      </div>
      {/* Benign events */}
      <div>
        <div style={{ fontSize: 8.5, color: "#1de98b", marginBottom: 5, textTransform: "uppercase", letterSpacing: .8 }}>✓ Surplus Events</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {benignEvents.map(e => (
            <button key={e.id} onClick={() => onTrigger(e.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#071f13", border: "1px solid #1de98b22", borderRadius: 5, color: "#ddeeff", fontSize: 8.5, cursor: "pointer", textAlign: "left", width: "100%" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{e.emoji}</span>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, color: e.col, fontSize: 9 }}>{e.name}</div><div style={{ fontSize: 7.5, color: "#4d7a96", marginTop: 1 }}>{e.desc}</div></div>
              <div style={{ fontSize: 7.5, color: "#1de98b", fontFamily: "'JetBrains Mono'", flexShrink: 0 }}>{e.pd >= 0 ? `+£${e.pd}` : `-£${Math.abs(e.pd)}`}/MWh</div>
            </button>
          ))}
        </div>
      </div>
      {/* Discussion prompts */}
      <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: "8px 10px" }}>
        <div style={{ fontSize: 8.5, color: "#38c0fc", fontWeight: 700, marginBottom: 7 }}>💬 Discussion Prompts</div>
        {["Why did the cheapest seller earn the same as the most expensive dispatched?", "What happens to batteries when the grid flips from SHORT to LONG?", "Why does the OCGT bid much higher than the wind farm?", "How does the Day-Ahead price differ from the Balancing price?", "What would happen if we had no gas plants during Dunkelflaute?"].map((q, i) => (
          <div key={i} style={{ fontSize: 8, color: "#4d7a96", marginBottom: 5, paddingLeft: 8, borderLeft: "2px solid #38c0fc33", lineHeight: 1.55 }}>Q{i + 1}: {q}</div>
        ))}
      </div>
    </div>
  );
}

/* ─── ACHIEVEMENTS TAB ─── */
function AchievementsTab({ earned }) {
  return (
    <div style={{ padding: "10px 12px" }}>
      <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 10, letterSpacing: 1 }}>YOUR TROPHY CABINET ({earned.length}/{ACHIEVEMENTS.length})</div>
      {ACHIEVEMENTS.map(a => {
        const isEarned = earned.some(e => e.id === a.id);
        return (
          <div key={a.id} style={{ display: "flex", gap: 10, padding: 8, background: isEarned ? "#0c1c2a" : "#050e16", border: `1px solid ${isEarned ? a.col : "#1a3045"}`, borderRadius: 8, marginBottom: 6, opacity: isEarned ? 1 : 0.4 }}>
            <div style={{ fontSize: 20 }}>{isEarned ? a.emoji : "🔒"}</div>
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: isEarned ? a.col : "#4d7a96", marginBottom: 2 }}>{a.name}</div>
              <div style={{ fontSize: 8, color: "#2a5570" }}>{a.desc}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}