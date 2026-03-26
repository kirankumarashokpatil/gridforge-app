import React, { useState, useEffect, useRef } from 'react';
import { TICK_MS, FREQ_FAIL_DURATION, GB_PHASE_TABLE } from '../../shared/constants';
import { Tip } from '../shared/Tip';
import { MarketInfoPanel } from '../shared/MarketInfoPanel';
import ForecastPanel from './ForecastPanel';
import MarketClockBar from '../shared/MarketClockBar';
import SPTimelineStrip from '../shared/SPTimelineStrip';
import SPDetailPanel from '../shared/SPDetailPanel';

/* ─── SHARED STAT CHIP ─── */
const TS = ({ label, val, vc, tip }) => {
    const inner = (
        <div style={{ display: "flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
            <span style={{ fontSize: 7.5, color: "#4d7a96", textTransform: "uppercase" }}>{label}</span>
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono'", fontWeight: 700, color: vc || "#ddeeff" }}>{val}</span>
        </div>
    );
    return tip ? <Tip text={tip}>{inner}</Tip> : inner;
};

// Formatters
const f0 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 0 });
const fpp = v => (v >= 0 ? "+" : "") + "£" + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

const NEXT_PHASE = {
    FORECAST_0: "DA",
    FORECAST: "DA",
    DA: "IDA1",
    FORECAST_1: "IDA1",
    IDA1: "IDA2",
    FORECAST_2: "IDA2",
    IDA2: "ID_ROUNDS",
    ID: "REALTIME",
    ID_ROUNDS: "REALTIME",
    REALTIME: "BM_OPEN",
    BM_OPEN: "BM_CLEAR",
    BM_CLEAR: "SP_SETTLED",
    SP_SETTLED: "BM_OPEN / RESULTS",
    BM_CLOSE: "BM_OPEN / RESULTS",
    RESULTS: "FORECAST_0",
    BM: "BM_CLEAR",
    SETTLED: "RESULTS",
};

function getPhaseGuide(roleName, phase) {
    const role = String(roleName || "").toUpperCase();
    const G = {
        FORECAST_0: {
            title: "Plan Your Strategy — Initial Forecast Published",
            body: "NESO has published demand and wind forecasts for all 48 settlement periods. Study the expected system conditions before the Day-Ahead auction opens.",
            steps: {
                GENERATOR: ["Check forecast demand vs your plant capacity for each SP", "Identify high-demand SPs where you can earn a price premium", "Set your minimum DA offer price above your marginal cost"],
                BESS: ["Find SPs with the widest expected price spread (cheap charge → expensive discharge)", "Plan your state-of-charge trajectory across the day", "Set your cycle budget based on battery degradation cost"],
                SUPPLIER: ["Review forecast demand against your total customer obligation", "Decide how much demand to hedge in the DA auction", "Note volatile SPs with high forecast uncertainty"],
                TRADER: ["Scan for price-spread opportunities across all 48 SPs", "Set your speculative entry thresholds for long/short positions", "Identify SPs where supply/demand mismatch looks likely"],
                DSR: ["Map your flexible demand windows across the 48 SPs", "Identify which SPs you can curtail if prices spike", "Set your curtailment cost floor — minimum price to reduce demand"],
                NESO: ["Review demand and wind forecast for each SP", "Flag high-stress SPs (low wind + high demand) to players", "Use the Publish Forecast button to broadcast to all players"],
                ELEXON: ["Confirm all player starting positions are at zero", "Prepare settlement baseline for the delivery day", "Monitor submission completeness when DA opens"],
            },
        },
        FORECAST_1: {
            title: "Revised Forecast — New Met Office Data Arrived",
            body: "The 12Z NWP run has arrived with updated wind and demand data. Check what changed before IDA1 and decide if you need to revise your position.",
            steps: {
                GENERATOR: ["Compare updated wind output vs the opening forecast", "Adjust your IDA1 strategy if system direction changed significantly", "Note which SPs are now tighter (short) or looser (long)"],
                BESS: ["Re-assess peak spread SPs with the revised forecast", "Update your charge/discharge plan for IDA1", "Check if any SPs flipped from long to short or vice versa"],
                SUPPLIER: ["Check if the demand revision changes your hedge requirement", "Flag under-hedged SPs for IDA1 top-up action", "Review your updated procurement cost estimate"],
                TRADER: ["Look for forecast revisions that signal price direction", "Update your IDA1 entry points based on the new data", "Spot any arbitrage between your DA price and the new forecast"],
                DSR: ["Identify SPs where demand rose (more curtailment value)", "Prepare your flexibility windows for the IDA1 auction", "Estimate rebound impact on SPs after curtailment"],
                NESO: ["Review the updated wind and demand numbers", "Broadcast revised forecast summary to players", "Flag SPs where system direction changed materially"],
                ELEXON: ["Confirm DA settlement data is complete", "Update settlement tracker with DA auction results", "Prepare for IDA1 reconciliation"],
            },
        },
        FORECAST_2: {
            title: "Final Forecast — Sharp Short-Range Update",
            body: "The 06Z short-range run gives the most accurate prediction of the day ahead. This is your last forecast update before IDA2 and the start of intraday gate closures.",
            steps: {
                GENERATOR: ["Check if plant availability has changed since DA", "Finalize your IDA2 volume based on this final forecast", "Prepare your BM bid price around expected short/long direction"],
                BESS: ["Lock in your SoC plan for the delivery day", "Identify final charge/discharge SP windows for IDA2", "Set BM bid prices based on expected system direction"],
                SUPPLIER: ["Confirm your hedge coverage for all 48 SPs", "Plan to top up any remaining exposure in IDA2", "Prepare demand-side response plan for BM if needed"],
                TRADER: ["Make your final IDA2 directional decision now", "Size your position against your available margin", "Plan your BM exit strategy if market moves against you"],
                DSR: ["Confirm curtailment capability for high-value SPs", "Review your IDA2 curtailment offer price", "Finalize your rebound schedule to avoid BM imbalance"],
                NESO: ["Publish the final forecast update to players", "Identify SPs where reserve margin looks tight", "Brief players on expected system direction for the day"],
                ELEXON: ["Cross-check IDA1 settlement data", "Monitor contract position completeness across all players", "Flag any data quality issues before gate closure begins"],
            },
        },
        DA: {
            title: "Day-Ahead Auction Open — Submit Your Bid NOW",
            body: "The DA auction is live. Enter your price and volume and click Submit before NESO advances the phase. All 48 SPs clear simultaneously at a single price.",
            steps: {
                GENERATOR: ["Enter offer volume (MW) and minimum price (£/MWh) in Section 3 below", "Switch to EPEX Curve mode to set different prices per SP block", "Click SUBMIT DA OFFER — you can update it until the phase advances"],
                BESS: ["Submit a sell offer for discharge SPs (high price) and buy bid for charge SPs (low price)", "Enter your MW volume and price limit in Section 3 below", "Click SUBMIT DA OFFER to register your curve with the market"],
                SUPPLIER: ["Enter how much power to buy (MW) — aim to cover your forecast demand", "Set the maximum price you'll pay (£/MWh)", "Click SUBMIT DA PURCHASE — under-hedging now means imbalance costs later"],
                TRADER: ["Choose BUY or SELL direction based on your price view", "Enter MW volume — your margin account covers position risk", "Click SUBMIT SPECULATIVE POSITION"],
                DSR: ["Enter your curtailable demand (MW) and minimum curtailment price", "Your price is what you need to be paid to reduce consumption", "Click SUBMIT DA OFFER"],
                NESO: ["Wait for all players to submit bids (check the order book panel)", "Click ADVANCE PHASE to clear the auction when everyone is ready", "DA prices and volumes clear automatically — results shown instantly"],
                ELEXON: ["Monitor bid submission status across all players", "Note any missing submissions before the phase closes", "Prepare settlement baseline from DA auction results"],
            },
        },
        IDA1: {
            title: "Intraday Auction 1 — Revise Your Position",
            body: "The first intraday auction is open. Use the IDA1 form to adjust the volume you bought or sold in DA. The IDA1 clears like a DA auction — batch, simultaneous, for all 48 SPs.",
            steps: {
                GENERATOR: ["Check your DA cleared position vs the revised forecast", "Enter a revised MW offer and price in the IDA1 form below", "Click SUBMIT IDA OFFER — this adjusts your net contracted position"],
                BESS: ["Check if the forecast shift changes your optimal charge/discharge split", "Submit an IDA1 order to revise your net position", "Click SUBMIT IDA OFFER"],
                SUPPLIER: ["Check your DA hedge ratio vs the updated demand forecast", "If under-hedged, buy additional MW in IDA1 at an acceptable price", "Click SUBMIT IDA PURCHASE"],
                TRADER: ["Decide if your DA position still reflects your market view", "Counter-trade in IDA1 to reduce or extend exposure", "Click SUBMIT SPECULATIVE POSITION"],
                DSR: ["Check if any SPs became more attractive for curtailment", "Submit a revised curtailment offer in IDA1", "Click SUBMIT IDA OFFER"],
                NESO: ["Wait for players to revise their positions", "Click ADVANCE PHASE to clear IDA1", "IDA1 results update each player's contract position"],
                ELEXON: ["Monitor IDA1 submission status", "Prepare reconciliation data for post-IDA1", "Track position changes from the DA baseline"],
            },
        },
        IDA2: {
            title: "Intraday Auction 2 — Last Batch Auction Before Gate Closure",
            body: "This is the final batch auction before continuous intraday trading begins and SPs start gate-closing. After IDA2, only the ID continuous market is available.",
            steps: {
                GENERATOR: ["Make your final volume adjustment before continuous ID", "Enter MW and price in the IDA2 form below", "Click SUBMIT IDA OFFER"],
                BESS: ["Finalise your charge/discharge position for the day", "Submit an IDA2 order to close any remaining position gap", "Click SUBMIT IDA OFFER"],
                SUPPLIER: ["Ensure you're fully hedged before SP gate closure begins", "Buy any remaining exposure in IDA2", "Click SUBMIT IDA PURCHASE"],
                TRADER: ["Make your final auction-style directional move", "Adjust size carefully — ID liquidity is thinner after this", "Click SUBMIT SPECULATIVE POSITION"],
                DSR: ["Submit your final curtailment offer for the day", "Confirm your rebound schedule is feasible", "Click SUBMIT IDA OFFER"],
                NESO: ["Wait for IDA2 submissions from all players", "Click ADVANCE PHASE to clear IDA2 and begin ID rounds", "After IDA2, 4 ID gate-closure rounds follow before REALTIME"],
                ELEXON: ["Verify IDA2 position data for all players", "Track cumulative contract position per player", "Flag any anomalies before continuous ID gate closure starts"],
            },
        },
        ID_ROUNDS: {
            title: "Intraday Continuous — SPs Gate-Closing in Batches of 12",
            body: "The continuous ID market closes SPs in 4 batches (1-12, 13-24, 25-36, 37-48). Once a batch closes, those SPs are locked. Submit your ID order before your target SPs gate-close.",
            steps: {
                GENERATOR: ["Choose BUY or SELL to adjust your net contracted position", "Enter MW volume and price limit in Section 3 below", "Click SUBMIT ID ORDER before each batch closes (NESO advances each round)"],
                BESS: ["Submit BUY (charge) or SELL (discharge) for remaining open SPs", "Set a competitive price to improve your fill probability", "Click SUBMIT ID ORDER — use EDIT ORDER if you need to change it"],
                SUPPLIER: ["Buy any last remaining exposure before your target SPs close", "Enter MW and maximum price in Section 3 below", "Click SUBMIT ID ORDER"],
                TRADER: ["Price priority matters here — be competitive", "Submit orders early for SPs in the next closing batch", "Click SUBMIT ID ORDER — use EDIT ORDER to revise"],
                DSR: ["Submit final curtailment offer for still-open SPs", "Check the SP timeline to see which SPs are still open", "Click SUBMIT ID ORDER"],
                NESO: ["Click ADVANCE PHASE to close each batch of 12 SPs", "Watch the SP Timeline — closed SPs are locked in grey", "4 advances needed before REALTIME begins"],
                ELEXON: ["Track gate closure progress per SP batch", "Monitor position freezing as each batch closes", "Prepare BM baseline from the frozen final positions"],
            },
        },
        REALTIME: {
            title: "REALTIME — Delivery Day. BM Opens Each SP.",
            body: "Physical delivery is underway. NESO runs the BM for each SP to correct imbalances. The BM gate opens briefly per SP for final dispatch bids — watch for BM_OPEN.",
            steps: {
                GENERATOR: ["Watch for BM_OPEN — the gate opens for your final dispatch bid", "When BM opens: enter flex volume (MW) and BM bid price (£/MWh)", "Click SUBMIT OFFER TO NESO before the gate closes"],
                BESS: ["Monitor system direction (SHORT = high SBP, LONG = low SSP)", "When BM opens: submit discharge offer (system SHORT) or charge bid (system LONG)", "Click SUBMIT BM BID — your SoC limits what you can offer"],
                SUPPLIER: ["Monitor your residual demand exposure vs contracted position", "Track NIV — a long system means lower imbalance cost for net buyers", "Prepare demand-side actions for high-price SPs"],
                TRADER: ["Read live NIV to judge system direction", "Track your deviation from contract vs imbalance penalty accumulating", "Monitor your P&L in the top bar — deviate = pay SBP or earn SSP"],
                DSR: ["If system is SHORT, this is your highest-value curtailment window", "When BM opens: submit curtailment offer at or above your cost floor", "Click SUBMIT DSR OFFER before BM closes"],
                NESO: ["Click ADVANCE PHASE to open each SP's BM gate", "Accept economic merit-order bids to balance the system", "Monitor NIV and frequency in the centre panel"],
                ELEXON: ["Track each accepted BM action — builds the settlement record", "Monitor SBP/SSP prices for the imbalance settlement", "Prepare SP-level audit trail for post-session review"],
            },
        },
    };
    const guide = G[phase] || G["FORECAST_0"];
    const steps = guide.steps[role] || guide.steps["GENERATOR"] || ["Review market state", "Check your position", "Prepare next action"];
    return { title: guide.title, body: guide.body, steps };
}

function roleChecklist(roleName, phase) {
    const role = String(roleName || "").toUpperCase();
    const isAuction = ["DA", "IDA1", "IDA2"].includes(phase);
    const isId = phase === "ID" || phase === "ID_ROUNDS";
    const isBm = ["REALTIME", "BM", "BM_OPEN", "BM_CLEAR", "BM_CLOSE", "SP_SETTLED"].includes(phase);
    const isResults = ["RESULTS", "SETTLED"].includes(phase);

    if (phase === "FORECAST" || phase === "FORECAST_0" || phase === "FORECAST_1" || phase === "FORECAST_2") {
        return ["Validate forecast shape", "Check likely stress SPs", "Prepare baseline strategy"];
    }
    if (isResults) {
        return ["Review settlement deltas", "Audit imbalance cashflows", "Adjust next-day approach"];
    }

    if (role === "NESO") {
        if (isBm) return ["Monitor INIV vs final NIV", "Dispatch merit order economically", "Protect frequency and reserve"];
        if (isId) return ["Watch liquidity conditions", "Track emerging system direction", "Prepare BM dispatch plan"];
        return ["Publish credible forecasts", "Flag volatile SPs", "Set system context for market"];
    }

    if (role === "ELEXON") {
        if (isBm) return ["Track accepted BM actions", "Verify imbalance price inputs", "Prepare settlement audit trail"];
        if (isId) return ["Monitor position evolution", "Track contract completeness", "Flag data quality issues"];
        return ["Validate submission completeness", "Monitor contract formation", "Prepare reconciliation checks"];
    }

    if (role === "SUPPLIER") {
        if (isBm) return ["Manage residual load exposure", "Minimize imbalance penalties", "Adjust demand-side actions"];
        if (isId) return ["Re-hedge open exposure", "Optimize volume-price tradeoff", "Protect against forecast error"];
        return ["Build hedge stack", "Control procurement cost", "Set target hedge ratio"];
    }

    if (role === "TRADER") {
        if (isBm) return ["Read final system direction", "Exploit dispatch opportunities", "Control downside risk"];
        if (isId) return ["Work the order book", "Manage queue/price priority", "Rebalance SP-level position"];
        return ["Map auction opportunities", "Set execution thresholds", "Plan intraday pivot levels"];
    }

    if (role === "BESS") {
        if (isBm) return ["Deploy SoC efficiently", "Price both directions rationally", "Preserve later optionality"];
        if (isId) return ["Shape SP position early", "Avoid forced BM exposure", "Protect cycle economics"];
        return ["Plan SoC trajectory", "Choose cycle budget", "Set cost floor by degradation"];
    }

    if (role === "DSR") {
        if (isBm) return ["Curtail only when valuable", "Track rebound obligations", "Avoid compliance breaches"];
        if (isId) return ["Prepare flexibility windows", "Estimate rebound impact", "Choose curtailment trigger points"];
        return ["Map flexible demand blocks", "Set curtailment constraints", "Coordinate rebound strategy"];
    }

    if (isBm) return ["Respect physical constraints", "Bid to marginal cost logic", "Minimize imbalance deviation"];
    if (isId) return ["Adjust contracted position", "Improve expected P&L", "Preserve BM optionality"];
    if (isAuction) return ["Submit disciplined offers", "Avoid over-commitment risk", "Anchor around fundamentals"];
    return ["Track market state", "Check exposure", "Prepare next action"];
}

export { Tip, TS, f0, fpp };

// ID gate-closure batch schedule (must match backend _ID_GC_BATCHES)
const _ID_GC_BATCHES = [
    [1, 12],    // round 0 → close SPs 1-12
    [13, 24],   // round 1 → close SPs 13-24
    [25, 36],   // round 2 → close SPs 25-36
    [37, 48],   // round 3 → close SPs 37-48
];

export default function SharedLayout({
    roleName,
    phase,
    sp,
    msLeft,
    tickSpeed,
    market,
    paused,
    freqBreachSec,
    bmSubPhase,
    scenario,
    room,
    cash,
    daCash,
    leaderboard,
    publishedForecast,
    topRight,
    left,
    center,
    right,
    bottom,
    hint,
    idRound = 0,
    spTimeline = {},
}) {
    const [showForecast, setShowForecast] = useState(false);
    const [selectedSP, setSelectedSP] = useState(null);
    const [showGuide, setShowGuide] = useState(true);
    const prevPhaseRef = useRef(phase);

    useEffect(() => {
        if (phase !== prevPhaseRef.current) {
            setShowGuide(true);
            prevPhaseRef.current = phase;
        }
    }, [phase]);

    // Expose phase state for E2E test diagnostics
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.gunState = window.gunState || {};
            window.gunState.phase = phase;
        }
    }, [phase]);
    
    const ts = tickSpeed || TICK_MS;
    const tPct = (msLeft / ts) * 100;
    const tCol = msLeft < (ts * 0.27) ? "#f0455a" : msLeft < (ts * 0.53) ? "#f5b222" : "#1de98b";

    // Market state: forecast for pre-realtime phases, actual for realtime/bm/results.
    const isPreRealtimePhase = ["FORECAST", "FORECAST_0", "FORECAST_1", "FORECAST_2", "DA", "IDA1", "IDA2", "ID", "ID_ROUNDS"].includes(phase);
    const currentMkt = isPreRealtimePhase
        ? (market?.forecast || market?.actual || { niv: 0, sbp: 50, ssp: 50, freq: 50 })
        : (market?.actual || market?.forecast || { niv: 0, sbp: 50, ssp: 50, freq: 50 });
    const { niv = 0, freq = 50, sbp = 50, ssp = 50, isShort = false } = currentMkt || {};
    // Bug fix: cash already includes daCash (settled DA revenue is accumulated into cash)
    const totalPL = cash || 0;
    const playerCount = leaderboard?.filter(p => p.role !== "instructor")?.length || 0;
    const nextPhase = (() => {
        if (phase === "ID_ROUNDS") {
            const batchIdx = Math.min(idRound, _ID_GC_BATCHES.length - 1);
            const [lo, hi] = _ID_GC_BATCHES[batchIdx] || [1, 12];
            const isLast = idRound >= _ID_GC_BATCHES.length - 1;
            return isLast
                ? `Close SPs ${lo}-${hi} → REALTIME`
                : `ID ${idRound + 1}/${_ID_GC_BATCHES.length}: Close SPs ${lo}-${hi}`;
        }
        return NEXT_PHASE[phase] || "—";
    })();
    const gateOpen = ["REALTIME", "BM", "BM_OPEN"].includes(phase) && msLeft > 0;
    const gateLabel = ["REALTIME", "BM", "BM_OPEN", "BM_CLEAR", "BM_CLOSE", "SP_SETTLED"].includes(phase)
        ? (gateOpen ? "OPEN" : "CLOSED")
        : "N/A";
    const gateCol = gateLabel === "OPEN" ? "#1de98b" : gateLabel === "CLOSED" ? "#f0455a" : "#4d7a96";

    const gateSeconds = Math.max(0, Math.ceil(msLeft / 1000));
    const gateTimer = gateOpen ? `Closes in ${gateSeconds}s` : `Opens in ${gateSeconds}s`;

    const gateAction = (() => {
        if (phase === "FORECAST" || phase === "FORECAST_0" || phase === "FORECAST_1" || phase === "FORECAST_2") return "Prepare forecast & strategy";
        if (phase === "DA") return "Submit/adjust day-ahead contracts";
        if (phase === "IDA1" || phase === "IDA2") return "Submit intraday offers";
        if (phase === "ID" || phase === "ID_ROUNDS") return "Trade to close position";
        if (phase === "REALTIME") return "Observe system, prepare BM response";
        if (phase === "BM_OPEN") return "Bid/offer in BM";
        if (phase === "BM_CLOSE" || phase === "BM_CLEAR") return "Await BM results";
        if (phase === "SP_SETTLED") return "Review SP settlement";
        if (phase === "RESULTS") return "Review settlement & performance";
        return "Monitor market state";
    })();

    const iniv = market?.forecast?.indicativeNiv;
    const inSbp = market?.forecast?.sbp;
    const inSsp = market?.forecast?.ssp;

    const finalNiv = market?.actual?.niv;
    const finalSbp = market?.actual?.sbp;
    const finalSsp = market?.actual?.ssp;

    const checklist = roleChecklist(roleName, phase);

    // Phase colour + accessible text label (used by automated tests)
    const PHASE_STYLES = {
        FORECAST_0:  { col: "#a78bfa", text: "FORECAST (Planning)",  lbl: "🔮 FORECAST" },
        FORECAST_1:  { col: "#c084fc", text: "FORECAST (Revised)",   lbl: "🔮 FORECAST 2" },
        FORECAST_2:  { col: "#d8b4fe", text: "FORECAST (Final)",     lbl: "🔮 FORECAST 3" },
        FORECAST:    { col: "#a78bfa", text: "FORECAST",             lbl: "🔮 FORECAST" },
        DA:          { col: "#f5b222", text: "DAY-AHEAD",            lbl: "📋 DAY-AHEAD" },
        IDA1:        { col: "#fb923c", text: "INTRADAY AUC 1",      lbl: "🔄 IDA1" },
        IDA2:        { col: "#f97316", text: "INTRADAY AUC 2",      lbl: "🔄 IDA2" },
        ID_ROUNDS:   { col: "#38c0fc", text: "INTRADAY CONTINUOUS",  lbl: "🤝 ID ROUNDS" },
        ID:          { col: "#38c0fc", text: "INTRADAY",             lbl: "🤝 INTRADAY" },
        REALTIME:    { col: "#1de98b", text: "REALTIME",             lbl: "⚡ REALTIME" },
        BM_OPEN:     { col: "#1de98b", text: "BM OPEN",             lbl: "⚡ BM OPEN" },
        BM_CLEAR:    { col: "#22d3ee", text: "BM CLEARING",         lbl: "⚡ BM CLEAR" },
        SP_SETTLED:  { col: "#94a3b8", text: "SP SETTLED",           lbl: "✅ SP SETTLED" },
        BM_CLOSE:    { col: "#22d3ee", text: "BM SETTLING",         lbl: "⚡ BM CLOSE" },
        RESULTS:     { col: "#b78bfa", text: "RESULTS",              lbl: "🏁 RESULTS" },
        // Legacy compat
        BM:          { col: "#1de98b", text: "BALANCING",            lbl: "⚡ BALANCING" },
        SETTLED:     { col: "#b78bfa", text: "SETTLED",              lbl: "🏁 SETTLEMENT" },
    };
    const ps = PHASE_STYLES[phase] || PHASE_STYLES.FORECAST;
    const pCol = ps.col;
    const phaseText = ps.text;
    const pLbl = ps.lbl;

    // GB market context for current phase
    const gbInfo = GB_PHASE_TABLE[phase];
    const gbLabel = gbInfo?.label;
    const gbRealTime = gbInfo?.realTime;

    return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#050e16", overflow: "hidden", color: "#ddeeff", fontFamily: "'Outfit', system-ui, sans-serif" }}>

            {/* ─── PAUSE OVERLAY ─── */}
            {paused && (
                <div style={{ position: "absolute", top: 44, left: 0, right: 0, zIndex: 9990, background: "#f5b222", padding: "6px 0", textAlign: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#050e16", letterSpacing: 1 }}>⏸ GAME PAUSED — Instructor is discussing</span>
                </div>
            )}

            {/* ─── FREQ BREACH WARNING ─── */}
            {freqBreachSec > 0 && !paused && (
                <div style={{ position: "absolute", top: paused ? 74 : 44, left: 0, right: 0, zIndex: 9989, background: freqBreachSec >= 3 ? "#f0455a" : "#f0455a88", padding: "4px 0", textAlign: "center", animation: "pulse 0.5s ease-in-out infinite" }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", letterSpacing: 1 }}>⚠ FREQUENCY BREACH — {FREQ_FAIL_DURATION - freqBreachSec}s to GRID FAILURE</span>
                </div>
            )}

            {/* ─── TOP BAR ─── */}
            <header style={{ height: 44, background: "#08141f", borderBottom: "1px solid #1a3045", display: "flex", alignItems: "center", padding: "0 10px", gap: 10, flexShrink: 0, position: "relative", zIndex: 10 }}>

                {/* Logo + Role + Phase */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, borderRight: "1px solid #1a3045", paddingRight: 10 }}>
                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 700, color: "#1de98b", letterSpacing: 1 }}>⚡ GRIDFORGE</span>
                    <div style={{ padding: "2px 6px", background: "#1a3045", borderRadius: 4, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 8, color: "#4d7a96", fontWeight: 800, letterSpacing: 1 }}>{roleName.toUpperCase()}</span>
                    </div>
                </div>

                {/* Phase Pill + GB Market Label */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ padding: "2px 7px", borderRadius: 4, background: `${pCol}18`, border: `1px solid ${pCol}44`, fontSize: 8, color: pCol, fontWeight: 700, letterSpacing: 0.5 }}>
                        {pLbl}
                        <span style={{ fontSize: 0 }}>{phaseText}</span>
                    </div>
                    {gbLabel && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontSize: 8, color: "#94a3b8", fontWeight: 600 }}>{gbLabel}</span>
                            {gbRealTime && <span style={{ fontSize: 7, color: "#4d7a96", fontFamily: "'JetBrains Mono'" }}>({gbRealTime})</span>}
                        </div>
                    )}
                </div>

                {/* Scenario badge */}
                {scenario && (
                    <div style={{ padding: "2px 6px", borderRadius: 4, background: `${scenario.col}18`, border: `1px solid ${scenario.col}44`, fontSize: 7.5, color: scenario.col, fontWeight: 700 }}>{scenario.emoji} {scenario.name}</div>
                )}

                {/* Room code */}
                {room && (
                    <div style={{ padding: "2px 6px", background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 4, fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#f5b222", fontWeight: 700, letterSpacing: 1 }}>{room}</div>
                )}

                {/* SP + Timer */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <TS label="SP" val={`${sp}/48`} vc="#fff" tip="Current Settlement Period (30 mins real time)" />
                    <div style={{ width: 50, height: 4, background: "#1a3045", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${tPct}%`, background: tCol, transition: "width 1s linear", borderRadius: 2 }} />
                    </div>
                    <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono'", color: tCol, fontWeight: 700, width: 18 }}>{Math.ceil(msLeft / 1000)}</div>
                </div>

                {/* System Health (center) */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto", marginRight: "auto" }}>

                    {/* Frequency Gauge */}
                    <Tip text="System Frequency. Must stay near 50.00 Hz">
                        <div style={{ display: "flex", alignItems: "center", gap: 5, background: "#0c1c2a", padding: "3px 7px", borderRadius: 4, border: `1px solid ${freq < 49.8 || freq > 50.2 ? "#f0455a" : "#1a3045"}` }}>
                            <span style={{ fontSize: 7, color: "#4d7a96", fontWeight: 700 }}>FREQ</span>
                            <div style={{ width: 50, height: 4, background: "#162c3d", position: "relative" }}>
                                <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "#2a5570" }} />
                                <div style={{ position: "absolute", left: `${Math.max(0, Math.min(100, (freq - 49.5) * 100))}%`, top: -3, width: 3, height: 10, background: freq < 49.8 || freq > 50.2 ? "#f0455a" : "#1de98b", borderRadius: 2, transform: "translateX(-1px)", transition: "left 0.2s" }} />
                            </div>
                            <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, fontWeight: 700, color: freq < 49.8 || freq > 50.2 ? "#f0455a" : "#1de98b" }}>{freq.toFixed(2)}</span>
                        </div>
                    </Tip>

                    {/* NIV */}
                    <Tip text="Net Imbalance Volume. Negative = GRID SHORT (needs power)">
                        <div style={{ display: "flex", alignItems: "baseline", gap: 4, background: isShort ? "#1f0709" : "#071f13", border: `1px solid ${isShort ? "#f0455a" : "#1de98b"}44`, padding: "3px 7px", borderRadius: 4 }}>
                            <span style={{ fontSize: 7, color: isShort ? "#f0455a" : "#1de98b", fontWeight: 800 }}>NIV {f0(Math.abs(niv))}MW</span>
                            <span style={{ fontSize: 9, fontWeight: 900, color: isShort ? "#f0455a" : "#1de98b" }}>{isShort ? "SHORT" : "LONG"}</span>
                        </div>
                    </Tip>

                    {/* Prices */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, borderLeft: "1px solid #1a3045", paddingLeft: 8 }}>
                        <TS label="SBP" val={`£${f0(sbp)}`} vc="#f0455a" tip="System Buy Price — penalty for being short" />
                        <TS label="SSP" val={`£${f0(ssp)}`} vc="#38c0fc" tip="System Sell Price — reward for being long" />
                    </div>
                </div>

                {/* P&L + Players */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", borderLeft: "1px solid #1a3045", paddingLeft: 8 }}>
                    <div>
                        <div style={{ fontSize: 6.5, color: "#4d7a96", lineHeight: 1 }}>TOTAL P&L</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, fontWeight: 900, color: totalPL >= 0 ? "#1de98b" : "#f0455a" }}>{fpp(totalPL)}</div>
                    </div>
                    <TS label="👥" val={playerCount} vc="#4d7a96" />

                    <div style={{ paddingLeft: 8, borderLeft: "1px solid #1a3045", display: "flex", gap: 8 }}>
                        <div style={{ position: "relative" }}>
                            <button
                                onClick={() => setShowForecast(s => !s)}
                                style={{
                                    display: "flex", alignItems: "center", gap: 6,
                                    padding: "6px 10px", background: showForecast ? "#38c0fc" : "#0c1c2a",
                                    border: `1px solid ${showForecast ? "#38c0fc" : "#1a3045"}`,
                                    borderRadius: 8, color: showForecast ? "#050e16" : "#4d7a96",
                                    fontSize: 10, fontWeight: 700, cursor: "pointer",
                                    transition: "all 0.2s"
                                }}
                            >
                                <span>{showForecast ? "✕" : "📈"}</span>
                                {showForecast ? "Close Forecast" : "View Forecast"}
                            </button>
                            {showForecast && (
                                <div className="fadeIn" style={{
                                    position: "absolute", top: "calc(100% + 8px)", right: 0,
                                    width: 450, background: "#0a1724ee", backdropFilter: "blur(12px)",
                                    border: "1px solid #38c0fc", borderRadius: 8, padding: 16,
                                    zIndex: 9999, boxShadow: "0 12px 40px #000000aa",
                                    display: "flex", flexDirection: "column", minHeight: 250
                                }}>
                                    {publishedForecast ? (
                                        <ForecastPanel sp={sp} publishedForecast={publishedForecast} canEdit={false} />
                                    ) : (
                                        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed #1a3045", borderRadius: 8, flexDirection: "column", gap: 10 }}>
                                            <span style={{ fontSize: 24 }}>⏳</span>
                                            <span style={{ color: "#4d7a96", fontSize: 11, fontWeight: 700 }}>AWAITING NESO FORECAST PUBLICATION</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <MarketInfoPanel />
                    </div>

                    {/* Top Right Inject */}
                    {topRight}
                </div>
            </header>

            {/* ─── GB PHASE CONTEXT STRIP ─── */}
            {gbInfo && (
                <div style={{ padding: "3px 10px", background: "#0a1724", borderBottom: "1px solid #1a3045", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                    <span style={{ fontSize: 7.5, color: pCol, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        {gbInfo.type === "auction" ? "⚡ AUCTION" : gbInfo.type === "forecast" ? "🔮 FORECAST" : gbInfo.type === "continuous" ? "🤝 CONTINUOUS" : gbInfo.type === "bm" ? "⚡ BM" : "📊 RESULTS"}
                    </span>
                    <span style={{ fontSize: 8, color: "#94a3b8" }}>{gbInfo.description}</span>
                    {gbInfo.spRange?.length === 2 && (
                        <span style={{ fontSize: 7, color: "#4d7a96", fontFamily: "'JetBrains Mono'", marginLeft: "auto" }}>SPs {gbInfo.spRange[0]}–{gbInfo.spRange[1]}</span>
                    )}
                </div>
            )}

            {/* ─── GLOBAL MARKET CLOCK BAR ─── */}
            <div style={{ padding: "6px 10px 0", flexShrink: 0 }}>
                <MarketClockBar phase={phase} sp={sp} msLeft={msLeft} tickSpeed={ts} bmSubPhase={phase} />
            </div>

            {/* ─── SP TIMELINE STRIP ─── */}
            <div style={{ padding: "4px 10px 0", flexShrink: 0 }}>
                <SPTimelineStrip sp={sp} phase={phase} bmSubPhase={phase} onSelectSP={setSelectedSP} selectedSP={selectedSP} />
            </div>

            {/* ─── PER-SP DETAIL PANEL (click to open) ─── */}
            {selectedSP && (
                <div style={{ padding: "4px 10px 0", flexShrink: 0 }}>
                    <SPDetailPanel
                        selectedSP={selectedSP}
                        currentSp={sp}
                        phase={phase}
                        bmSubPhase={phase}
                        msLeft={msLeft}
                        tickSpeed={ts}
                        onClose={() => setSelectedSP(null)}
                    />
                </div>
            )}

            {/* ─── OPERATOR STRIP: NOW / NEXT / GATE / PLAYBOOK ─── */}
            <div style={{ borderBottom: "1px solid #1a3045", background: "#06111b", padding: "6px 10px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ padding: "3px 7px", borderRadius: 5, border: `1px solid ${pCol}55`, background: `${pCol}1a`, fontSize: 9, color: pCol, fontWeight: 800 }}>NOW: {phaseText}</div>
                    <div style={{ padding: "3px 7px", borderRadius: 5, border: "1px solid #2a5570", background: "#0c1c2a", fontSize: 9, color: "#9bc2dd", fontWeight: 700 }}>NEXT: {nextPhase}</div>
                    <div style={{ padding: "3px 7px", borderRadius: 5, border: `1px solid ${gateCol}55`, background: `${gateCol}1a`, fontSize: 9, color: gateCol, fontWeight: 800 }} title={`${gateAction} (${gateTimer})`}>GATE: {gateLabel} · {gateTimer}</div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                    <div style={{ padding: "3px 7px", borderRadius: 5, border: "1px solid #234159", background: "#0c1c2a", fontSize: 9, color: "#4d7a96", display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 700, color: "#38c0fc" }}>INDICATIVE</span>
                        <span style={{ fontWeight: 700, color: "#38c0fc" }}>NIV {iniv === undefined ? "—" : `${f0(iniv)} MW`}</span>
                        <span style={{ fontWeight: 700, color: "#f5b222" }}>SBP {inSbp === undefined ? "—" : `£${f0(inSbp)}`}</span>
                        <span style={{ fontWeight: 700, color: "#38c0fc" }}>SSP {inSsp === undefined ? "—" : `£${f0(inSsp)}`}</span>
                    </div>
                    <div style={{ padding: "3px 7px", borderRadius: 5, border: "1px solid #234159", background: "#0c1c2a", fontSize: 9, color: "#4d7a96", display: "flex", alignItems: "center", gap: 6 }} title="Live / final values once BM closes">
                        <span style={{ fontWeight: 700, color: "#ddeeff" }}>LIVE</span>
                        <span style={{ fontWeight: 700, color: "#ddeeff" }}>NIV {finalNiv === undefined ? "—" : `${f0(finalNiv)} MW`}</span>
                        <span style={{ fontWeight: 700, color: "#f0455a" }}>SBP {finalSbp === undefined ? "—" : `£${f0(finalSbp)}`}</span>
                        <span style={{ fontWeight: 700, color: "#1de98b" }}>SSP {finalSsp === undefined ? "—" : `£${f0(finalSsp)}`}</span>
                    </div>
                </div>

                {/* ─── PHASE GUIDE (expandable) ─── */}
                {(() => {
                    const guide = getPhaseGuide(roleName, phase);
                    return (
                        <div style={{ width: "100%", borderTop: "1px solid #1a3045", paddingTop: 4, marginTop: 2 }}>
                            <button
                                onClick={() => setShowGuide(s => !s)}
                                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left" }}
                            >
                                <span style={{ fontSize: 8, color: "#f5b222", fontWeight: 800, letterSpacing: 0.6 }}>PHASE GUIDE</span>
                                <span style={{ fontSize: 9, color: "#ddeeff", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{guide.title}</span>
                                <span style={{ fontSize: 9, color: "#4d7a96", flexShrink: 0 }}>{showGuide ? "▲ hide" : "▼ show"}</span>
                            </button>
                            {showGuide && (
                                <div style={{ marginTop: 6, padding: "10px 12px", background: "#061018", border: "1px solid #f5b22233", borderRadius: 6 }}>
                                    <p style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.5, margin: "0 0 8px" }}>{guide.body}</p>
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                        {guide.steps.map((step, i) => (
                                            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 5, padding: "6px 10px", flex: "1 1 200px" }}>
                                                <span style={{ color: "#f5b222", fontWeight: 800, fontSize: 10, flexShrink: 0 }}>{i + 1}.</span>
                                                <span style={{ fontSize: 9, color: "#ddeeff", lineHeight: 1.4 }}>{step}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>

            {/* ─── MAIN GRID ─── */}
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

                {/* Left Column */}
                {left && (
                    <aside style={{ width: 280, borderRight: "1px solid #1a3045", background: "#050e16", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                        <div style={{ flex: 1, overflowY: "auto" }}>{left}</div>
                    </aside>
                )}

                {/* Center Main */}
                <main style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", overflow: "hidden", background: "#02070b" }}>
                    <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
                        {center}
                    </div>

                    {/* Hint Bar */}
                    {hint && (
                        <div style={{ padding: "6px 12px", background: "#102332", borderTop: "1px solid #234159", display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12 }}>💡</span>
                            <span style={{ fontSize: 9, color: "#4d7a96" }}>WHY THIS MATTERS: <strong style={{ color: "#ddeeff" }}>{hint}</strong></span>
                        </div>
                    )}
                </main>

                {/* Right Column */}
                {right && (
                    <aside style={{ width: 300, borderLeft: "1px solid #1a3045", background: "#050e16", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                        <div style={{ flex: 1, overflowY: "auto" }}>{right}</div>
                    </aside>
                )}
            </div>

            {/* ─── BOTTOM BAR ─── */}
            {bottom && (
                <footer style={{ borderTop: "1px solid #1a3045", background: "#08141f" }}>
                    {bottom}
                </footer>
            )}

        </div>
    );
}
