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

    // Market state safe fallback
    const currentMkt = market?.actual || market?.forecast || { niv: 0, sbp: 50, ssp: 50, freq: 50 };
    const { niv, freq, sbp, ssp, isShort } = currentMkt;
    const totalPL = (cash || 0);
    const playerCount = leaderboard?.filter(p => p.role !== "instructor")?.length || 0;

    // Phase colour + accessible text label (used by automated tests)
    const pCol = phase === "DA" ? "#f5b222" : phase === "ID" ? "#38c0fc" : phase === "BM" ? "#1de98b" : "#b78bfa";
    const phaseText = phase === "DA" ? "DAY-AHEAD" : phase === "ID" ? "INTRADAY" : phase === "BM" ? "BALANCING" : "SETTLED";
    const pLbl = phase === "DA" ? "📋 DAY-AHEAD" : phase === "ID" ? "🤝 INTRADAY" : phase === "BM" ? "⚡ BALANCING" : "🏁 SETTLEMENT";

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
