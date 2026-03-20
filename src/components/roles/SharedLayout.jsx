import React, { useState, useEffect } from 'react';
import { TICK_MS, FREQ_FAIL_DURATION } from '../../shared/constants';
import { Tip } from '../shared/Tip';
import { MarketInfoPanel } from '../shared/MarketInfoPanel';
import ForecastPanel from './ForecastPanel';

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
    FORECAST: "DA",
    DA: "IDA1",
    IDA1: "IDA2",
    IDA2: "ID",
    ID: "REALTIME",
    REALTIME: "BM_OPEN",
    BM_OPEN: "BM_CLOSE",
    BM_CLOSE: "BM_OPEN / RESULTS",
    RESULTS: "FORECAST",
    BM: "BM_CLOSE",
    SETTLED: "RESULTS",
};

function roleChecklist(roleName, phase) {
    const role = String(roleName || "").toUpperCase();
    const isAuction = ["DA", "IDA1", "IDA2"].includes(phase);
    const isId = phase === "ID";
    const isBm = ["REALTIME", "BM", "BM_OPEN", "BM_CLOSE"].includes(phase);
    const isResults = ["RESULTS", "SETTLED"].includes(phase);

    if (phase === "FORECAST") {
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

export default function SharedLayout({
    roleName,
    phase,
    sp,
    msLeft,
    tickSpeed,
    market,
    paused,
    freqBreachSec,
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
    hint
}) {
    const [showForecast, setShowForecast] = useState(false);
    
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
    const isPreRealtimePhase = ["FORECAST", "DA", "IDA1", "IDA2", "ID"].includes(phase);
    const currentMkt = isPreRealtimePhase
        ? (market?.forecast || market?.actual || { niv: 0, sbp: 50, ssp: 50, freq: 50 })
        : (market?.actual || market?.forecast || { niv: 0, sbp: 50, ssp: 50, freq: 50 });
    const { niv, freq, sbp, ssp, isShort } = currentMkt;
    const totalPL = (cash || 0) + (daCash || 0);
    const playerCount = leaderboard?.filter(p => p.role !== "instructor")?.length || 0;
    const nextPhase = NEXT_PHASE[phase] || "—";
    const gateOpen = ["REALTIME", "BM", "BM_OPEN"].includes(phase) && msLeft > 0;
    const gateLabel = ["REALTIME", "BM", "BM_OPEN", "BM_CLOSE"].includes(phase)
        ? (gateOpen ? "OPEN" : "CLOSED")
        : "N/A";
    const gateCol = gateLabel === "OPEN" ? "#1de98b" : gateLabel === "CLOSED" ? "#f0455a" : "#4d7a96";

    const gateSeconds = Math.max(0, Math.ceil(msLeft / 1000));
    const gateTimer = gateOpen ? `Closes in ${gateSeconds}s` : `Opens in ${gateSeconds}s`;

    const gateAction = (() => {
        if (phase === "FORECAST") return "Prepare forecast & strategy";
        if (phase === "DA") return "Submit/adjust day-ahead contracts";
        if (phase === "IDA1" || phase === "IDA2") return "Submit intraday offers";
        if (phase === "ID") return "Trade to close position";
        if (phase === "REALTIME") return "Observe system, prepare BM response";
        if (phase === "BM_OPEN") return "Bid/offer in BM";
        if (phase === "BM_CLOSE") return "Await BM results";
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
        FORECAST:  { col: "#a78bfa", text: "FORECAST",       lbl: "🔮 FORECAST" },
        DA:        { col: "#f5b222", text: "DAY-AHEAD",      lbl: "📋 DAY-AHEAD" },
        IDA1:      { col: "#fb923c", text: "INTRADAY AUC 1", lbl: "🔄 IDA1" },
        IDA2:      { col: "#f97316", text: "INTRADAY AUC 2", lbl: "🔄 IDA2" },
        ID:        { col: "#38c0fc", text: "INTRADAY",       lbl: "🤝 INTRADAY" },
        REALTIME:  { col: "#1de98b", text: "REALTIME",       lbl: "⚡ REALTIME" },
        BM_OPEN:   { col: "#1de98b", text: "BM OPEN",        lbl: "⚡ BM OPEN" },
        BM_CLOSE:  { col: "#22d3ee", text: "BM SETTLING",    lbl: "⚡ BM CLOSE" },
        RESULTS:   { col: "#b78bfa", text: "RESULTS",        lbl: "🏁 RESULTS" },
        // Legacy compat
        BM:        { col: "#1de98b", text: "BALANCING",      lbl: "⚡ BALANCING" },
        SETTLED:   { col: "#b78bfa", text: "SETTLED",        lbl: "🏁 SETTLEMENT" },
    };
    const ps = PHASE_STYLES[phase] || PHASE_STYLES.FORECAST;
    const pCol = ps.col;
    const phaseText = ps.text;
    const pLbl = ps.lbl;

    return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#050e16", overflow: "hidden", color: "#ddeeff", fontFamily: "'Outfit', system-ui, sans-serif" }}>

            {/* ─── PAUSE OVERLAY ─── */}
            {paused && (
                <div style={{ position: "absolute", top: 44, left: 0, right: 0, zIndex: 9990, background: "#f5b222", padding: "6px 0", textAlign: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#050e16", letterSpacing: 1 }}>⏸ GAME PAUSED — Host is discussing</span>
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

                {/* Phase Pill */}
                <div style={{ padding: "2px 7px", borderRadius: 4, background: `${pCol}18`, border: `1px solid ${pCol}44`, fontSize: 8, color: pCol, fontWeight: 700, letterSpacing: 0.5 }}>
                    {pLbl}
                    {/* Hidden plain-text phase label so E2E tests can reliably detect the current phase */}
                    <span style={{ fontSize: 0 }}>{phaseText}</span>
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

                <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 8, color: "#4d7a96", letterSpacing: 0.6, fontWeight: 800 }}>ROLE PLAYBOOK</span>
                    <span style={{ fontSize: 9, color: "#ddeeff" }}>• {checklist[0]} • {checklist[1]} • {checklist[2]}</span>
                </div>

                <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 9 }}>
                    <span style={{ fontWeight: 700, color: "#4d7a96" }}>CHECKLIST</span>
                    {checklist.map((item, idx) => (
                        <span key={idx} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 999, background: "#0c1c2a", border: "1px solid #1a3045", color: "#ddeeff" }}>
                            <span style={{ color: "#1de98b" }}>•</span>
                            <span style={{ fontSize: 9 }}>{item}</span>
                        </span>
                    ))}
                </div>
                <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, fontSize: 9, color: "#94a3b8" }}>
                    <span style={{ fontWeight: 700, color: "#4d7a96" }}>ACTIONS</span>
                    <span>{gateAction}</span>
                </div>
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
