import React, { useState, useEffect, useMemo, useRef } from "react";
import SharedLayout from "./SharedLayout";
import { Tip } from '../shared/Tip';

// ── Helpers ────────────────────────────────────────────────────────────────
const f0 = (p) => Number(p).toLocaleString(undefined, { maximumFractionDigits: 0 });

const getProgressColor = (pct) => (pct > 95 ? "#22c55e" : "#3b82f6");

// SP_DURATION_H = 0.5  (each settlement period is a half-hour)
// Correct formula: imbalance (MW) × price (£/MWh) × 0.5h = £
// Previous bug: was dividing by 1000 → all settlement figures were 500× too small
const SP_DURATION_H = 0.5;

const calculateImbalance = (contractMw, actualMw, sbp, ssp, settlement = {}) => {
    const imbalance = settlement.imbMw !== undefined ? settlement.imbMw : actualMw - contractMw;
    const price = imbalance < 0 ? sbp : ssp;
    // Use server-supplied imbCash if available; otherwise calculate correctly
    const charge = settlement.imbCash !== undefined
        ? settlement.imbCash
        : Math.round(imbalance * price * SP_DURATION_H);
    return { imbalance: Math.round(imbalance), charge: Math.round(charge), price };
};

// ── UI Components ──────────────────────────────────────────────────────────
const Spark = ({ data, color = "#3b82f6", h = 28, w = 80 }) => {
    if (!data || data.length < 2) return null;
    const mn = Math.min(...data),
        mx = Math.max(...data),
        rng = mx - mn || 1;
    const pts = data
        .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / rng) * (h - 2) - 1}`)
        .join(" ");
    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
            <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
    );
};

const TimelineRun = ({ label, runs, current, desc }) => (
    <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#ddeeff", fontFamily: "'IBM Plex Sans', sans-serif" }}>{label}</span>
            {desc && <span style={{ fontSize: 10, color: "#4d7a96" }}>{desc}</span>}
        </div>
        <div style={{ position: "relative", height: 6, background: "#1a3045", borderRadius: 3, marginBottom: 8 }}>
            <div style={{ position: "absolute", left: 0, width: `${(current / (runs.length - 1)) * 100}%`, height: "100%", background: "#3b82f6", borderRadius: 3, transition: "width 1s ease" }} />
            {runs.map((r, i) => (
                <div key={i} style={{
                    position: "absolute", top: -3, left: `${(i / (runs.length - 1)) * 100}%`,
                    transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%",
                    background: i <= current ? "#3b82f6" : "#1a3045",
                    border: `2px solid ${i <= current ? "#1d4ed8" : "#2a5570"}`,
                    transition: "all 0.5s ease"
                }} />
            ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
            {runs.map((r, i) => (
                <span key={i} style={{
                    fontSize: 9, color: i <= current ? "#3b82f6" : "#4d7a96",
                    fontFamily: "'JetBrains Mono', monospace", textAlign: "center", flex: 1
                }}>{r}</span>
            ))}
        </div>
    </div>
);

const WaterfallNode = React.forwardRef(({ label, amount, color = "#1e3a5f", highlight, arrow }, ref) => (
    <div ref={ref} style={{
        display: "flex", alignItems: "center", gap: 4,
        background: highlight ? "#1f2937" : "transparent", padding: highlight ? "4px 0" : 0, borderRadius: highlight ? 4 : 0, transition: "background 0.3s"
    }}>
        <div style={{ padding: "6px 10px", background: color, borderRadius: 4, border: highlight ? "1px solid #3b82f6" : "1px solid #334155", minWidth: 90, textAlign: "center", boxShadow: highlight ? "0 0 8px #3b82f6aa" : "none" }}>
            <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "'IBM Plex Sans', sans-serif" }}>{label}</div>
            {amount && <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace" }}>{amount}</div>}
        </div>
        {arrow && <span style={{ color: "#64748b", fontSize: 14 }}>→</span>}
    </div>
));

const SettlementTableRow = ({ row, selected, onClick, S, C, isWorstOffender }) => {
    const rowRef = useRef(null);
    useEffect(() => {
        if (selected && rowRef.current) {
            rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [selected]);

    return (
        <tr ref={rowRef} onClick={onClick} style={{ background: selected ? "#1a3045" : "transparent", cursor: "pointer", transition: "background .15s" }}>
            <td style={S.tdLeft}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ fontWeight: 600, color: C.text }}>{row.playerName}</div>
                    {isWorstOffender && (
                        <Tip text={`Highest Imbalance Penalty this SP: £${f0(Math.abs(row.imbCash || row.charge || 0))}`}>
                            <span style={{
                                fontSize: 14, marginLeft: 2, cursor: "help",
                                animation: "pulse 1.5s infinite"
                            }}>
                                🚨
                            </span>
                        </Tip>
                    )}
                </div>
                <div style={{ fontSize: 10, color: C.faint, ...S.mono }}>{row.role}</div>
            </td>
            <td style={S.td}>{f0(row.contract)}</td>
            <td style={{ ...S.td, color: "#4d7a96", fontSize: 14, padding: "7px 2px" }}>→</td>
            <td style={S.td}>{f0(row.actual)}</td>
            <td style={{ ...S.td, color: "#4d7a96", fontSize: 14, padding: "7px 2px" }}>→</td>
            <td style={{ ...S.td, color: row.imbalance < 0 ? C.red : row.imbalance > 0 ? C.blue : C.sub, fontWeight: 600 }}>
                <Tip text={row.imbalance < 0 ? "Short: Metered < Contracted. Buying at SBP." : row.imbalance > 0 ? "Long: Metered > Contracted. Selling at SSP." : "Perfectly balanced."}>
                    <span style={{ borderBottom: "1px dashed #4d7a96", cursor: "help" }}>
                        {row.imbalance > 0 ? "+" : ""}{f0(row.imbalance)}
                    </span>
                </Tip>
            </td>
            <td style={{ ...S.td, color: C.sub }}>£{row.price.toFixed(2)}</td>
            <td style={{ ...S.td, color: Math.abs(row.charge) > 5 ? C.red : C.sub }}>
                <Tip text={row.charge < 0 ? "Receiving payment for excess energy out" : "Paying charge for shortfall energy in"}>
                    <span style={{ borderBottom: "1px dashed #4d7a96", cursor: "help" }}>
                        {row.charge < 0 ? "+" : "−"}£{f0(Math.abs(row.charge))}k
                    </span>
                </Tip>
            </td>
        </tr>
    );
};

// ── Panels ────────────────────────────────────────────────────────────────
const MarketDataPanel = ({ bmMw, mip, fpnTotal, playerList, settledSps, sp, sbpHistory, sspHistory, mipHistory, sbp, ssp, totalReceivable, totalPayable, C, S }) => {
    const meteringPct = sp > 0 ? Math.min(100, Math.round((settledSps / sp) * 100)) : 0;
    return (
        <div style={{ padding: 12 }}>
            <div style={S.panelTitle}>Market Data Inputs</div>
            {/* BM Actions */}
            <Tip text="Total sum of all accepted Balancing Mechanism actions by NESO for this period.">
                <div style={{ marginBottom: 12, padding: "8px 10px", background: C.navyPanel, borderRadius: 6, border: `1px solid ${C.border}`, cursor: "help" }}>
                    <div style={S.label}>Accepted BM Actions</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: C.blue, ...S.mono }}>{f0(bmMw)} <span style={{ fontSize: 11 }}>MW</span></div>
                        <div style={{ fontSize: 11, color: C.sub, ...S.mono }}>£{mip.toFixed(1)}/MWh</div>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 10, color: bmMw > 0 ? C.green : C.sub }}>{bmMw > 0 ? "✓ Actions accepted from NESO" : "No BM actions yet"}</div>
                </div>
            </Tip>

            {/* FPN */}
            <Tip text="Final Physical Notification (FPN). The sum of all contracted positions.">
                <div style={{ marginBottom: 12, padding: "8px 10px", background: C.navyPanel, borderRadius: 6, border: `1px solid ${C.border}`, cursor: "help" }}>
                    <div style={S.label}>Final Physical Notifications</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.text, ...S.mono }}>{f0(fpnTotal)} <span style={{ fontSize: 11, fontWeight: 400 }}>MW</span></div>
                    <div style={{ fontSize: 10, color: C.sub }}>{playerList.length} parties reporting</div>
                </div>
            </Tip>

            {/* Metering */}
            <div style={{ marginBottom: 12, padding: "8px 10px", background: C.navyPanel, borderRadius: 6, border: `1px solid ${C.border}` }}>
                <div style={S.label}>Metering Data</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: meteringPct > 80 ? C.green : "#f59e0b", ...S.mono }}>{meteringPct}<span style={{ fontSize: 11, fontWeight: 400 }}>%</span></div>
                    <span style={{ fontSize: 10, color: C.sub }}>{settledSps}/{sp} SPs settled</span>
                </div>
                <div style={{ height: 4, background: C.border, borderRadius: 2, marginTop: 4 }}>
                    <div style={{ height: "100%", width: `${meteringPct}%`, background: getProgressColor(meteringPct), borderRadius: 2, transition: "width 1s" }} />
                </div>
            </div>

            {/* MIP */}
            <Tip text="Market Index Price. Used as a baseline flag primarily for reporting in this simulation.">
                <div style={{ marginBottom: 12, padding: "8px 10px", background: C.navyPanel, borderRadius: 6, border: `1px solid ${C.border}`, cursor: "help" }}>
                    <div style={S.label}>Market Index Price</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: C.text, ...S.mono }}>£{mip.toFixed(2)}<span style={{ fontSize: 10, fontWeight: 400 }}>/MWh</span></div>
                        <Spark data={mipHistory.length >= 2 ? mipHistory : [mip]} color={C.blue} h={28} w={60} />
                    </div>
                </div>
            </Tip>

            {/* SBP/SSP */}
            <div style={{ marginBottom: 12, padding: "8px 10px", background: C.navyPanel, borderRadius: 6, border: `1px solid ${C.border}` }}>
                <div style={S.label}>System Buy / Sell Price</div>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <div style={{ flex: 1 }}>
                        <Tip text="System Buy Price (SBP) applies to parties who are SHORT.">
                            <div style={{ fontSize: 9, color: C.red, textTransform: "uppercase", letterSpacing: "0.08em", cursor: "help", borderBottom: "1px dashed" }}>Buy (SBP)</div>
                        </Tip>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.red, ...S.mono }}>£{sbp.toFixed(2)}</div>
                        <Spark data={sbpHistory.length >= 2 ? sbpHistory : [sbp]} color={C.red} h={22} w={90} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <Tip text="System Sell Price (SSP) applies to parties who are LONG.">
                            <div style={{ fontSize: 9, color: C.green, textTransform: "uppercase", letterSpacing: "0.08em", cursor: "help", borderBottom: "1px dashed" }}>Sell (SSP)</div>
                        </Tip>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.green, ...S.mono }}>£{ssp.toFixed(2)}</div>
                        <Spark data={sspHistory.length >= 2 ? sspHistory : [ssp]} color={C.green} h={22} w={90} />
                    </div>
                </div>
            </div>

            {/* EMR Summary */}
            <div style={{ ...S.panel, padding: 12, marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 10 }}>Settlement Summary</div>
                {[
                    { label: "Total Receivable", val: `£${f0(totalReceivable)}k`, color: C.green },
                    { label: "Total Payable", val: `−£${f0(totalPayable)}k`, color: C.red },
                    { label: "Parties Settled", val: `${playerList.length}`, color: C.sub },
                    { label: "SPs Processed", val: `${settledSps} / ${sp}`, color: C.sub },
                ].map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 11, color: C.sub }}>{r.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: r.color, ...S.mono }}>{r.val}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ImbalanceEnginePanel = ({ rowsForSp, playerList, activeRun, selectedPlayerId, setSelectedPlayerId, sp, sbp, ssp, niv, totalImbal, totalCharge, totalCleared, C, S }) => {
    const waterfallRefs = useRef({});

    useEffect(() => {
        if (selectedPlayerId && waterfallRefs.current[selectedPlayerId]) {
            waterfallRefs.current[selectedPlayerId].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, [selectedPlayerId]);

    // Identify the player with the highest absolute imbalance penalty this SP
    const worstPenaltyAmount = Math.max(...rowsForSp.map(r => Math.abs(r.imbCash || r.charge || 0)), 0);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
            {/* Imbalance Calculation Engine */}
            <div style={{ ...S.panel, flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={S.panelTitle}>Imbalance Calculation Engine</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: C.sub }}>Active Run:</span>
                        {["II", "SF", "R1", "R2", "RF"].map(r => (
                            <span key={r} style={{
                                padding: "2px 8px", borderRadius: 3, fontSize: 11, cursor: "default",
                                background: r === activeRun ? C.blue : C.navyPanel,
                                color: r === activeRun ? "#fff" : C.faint,
                                fontWeight: r === activeRun ? 700 : 400, ...S.mono,
                                border: `1px solid ${r === activeRun ? C.blue : C.border}`
                            }}>{r}</span>
                        ))}
                    </div>
                </div>

                <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
                    {rowsForSp.length > 0 && (
                        <>
                            {/* Aggregate System Imbalance Metrics - Elevated to Top */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
                                <div style={{ ...S.panel, padding: "10px 12px" }}>
                                    <div style={{ fontSize: 9, color: C.sub, marginBottom: 4, fontWeight: 600 }}>NET SYSTEM IMBALANCE</div>
                                    <div style={{ fontSize: 18, fontWeight: 900, color: totalImbal > 0 ? C.blue : totalImbal < 0 ? C.red : C.sub, ...S.mono }}>
                                        {totalImbal > 0 ? "+" : ""}{f0(totalImbal)} MW
                                    </div>
                                </div>
                                <div style={{ ...S.panel, padding: "10px 12px", border: `2px solid ${C.blue}`, boxShadow: "0 0 8px #3b82f644" }}>
                                    <div style={{ fontSize: 9, color: C.sub, marginBottom: 4, fontWeight: 600 }}>CLEARING COST (£)</div>
                                    <div style={{ fontSize: 18, fontWeight: 900, color: C.red, ...S.mono }}>
                                        £{f0(totalCharge)}k
                                    </div>
                                </div>
                                <div style={{ ...S.panel, padding: "10px 12px" }}>
                                    <div style={{ fontSize: 9, color: C.sub, marginBottom: 4, fontWeight: 600 }}>TOP ERROR RISK</div>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, ...S.mono }}>
                                        {(() => {
                                            const topError = rowsForSp.reduce((max, r) => Math.abs(r.charge) > Math.abs(max.charge) ? r : max, rowsForSp[0] || {});
                                            return topError.playerName ? `${topError.playerName}: £${f0(Math.abs(topError.charge))}k` : "—";
                                        })()}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                    {rowsForSp.length > 0 ? (
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                                <tr>
                                    <th style={S.thLeft}>Party / Role</th>
                                    <th style={S.th}>Contracted (MWh)</th>
                                    <th style={{ ...S.th, width: 24 }}></th>
                                    <th style={S.th}>Metered (MWh)</th>
                                    <th style={{ ...S.th, width: 24 }}></th>
                                    <th style={S.th}>Imbalance (MWh)</th>
                                    <th style={S.th}>Price (£/MWh)</th>
                                    <th style={S.th}>Charge (£k)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rowsForSp.map((r) => {
                                    const myPenaltyAmount = Math.abs(r.imbCash || r.charge || 0);
                                    const isWorstOffender = myPenaltyAmount > 0 && myPenaltyAmount === worstPenaltyAmount;
                                    return (
                                        <SettlementTableRow
                                            key={r.playerId}
                                            row={r}
                                            selected={selectedPlayerId === r.playerId}
                                            onClick={() => setSelectedPlayerId(r.playerId)}
                                            S={S}
                                            C={C}
                                            isWorstOffender={isWorstOffender}
                                        />
                                    );
                                })}
                                {/* Total row */}
                                <tr style={{ background: C.navyPanel, fontWeight: 700 }}>
                                    <td style={{ ...S.tdLeft, fontWeight: 700, borderTop: `2px solid ${C.border}` }}>
                                        <span style={{ color: C.text }}>Total ({playerList.length} parties)</span>
                                    </td>
                                    <td style={{ ...S.td, borderTop: `2px solid ${C.border}` }}>{f0(rowsForSp.reduce((s, r) => s + r.contract, 0))}</td>
                                    <td style={{ ...S.td, borderTop: `2px solid ${C.border}` }} />
                                    <td style={{ ...S.td, borderTop: `2px solid ${C.border}` }}>{f0(rowsForSp.reduce((s, r) => s + r.actual, 0))}</td>
                                    <td style={{ ...S.td, borderTop: `2px solid ${C.border}` }} />
                                    <td style={{ ...S.td, fontWeight: 700, color: totalImbal < 0 ? C.red : totalImbal > 0 ? C.blue : C.sub, borderTop: `2px solid ${C.border}` }}>
                                        {totalImbal > 0 ? "+" : ""}{f0(totalImbal)}
                                    </td>
                                    <td style={{ ...S.td, borderTop: `2px solid ${C.border}` }} />
                                    <td style={{ ...S.td, fontWeight: 700, color: C.red, borderTop: `2px solid ${C.border}` }}>
                                        £{f0(totalCharge)}k
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    ) : (
                        <div style={{ textAlign: "center", color: C.sub, padding: 40, fontSize: 12 }}>
                            No settlement data yet. Advance phases to generate data.
                        </div>
                    )}
                </div>

                {/* SBP / NIV strip */}
                <div style={{ display: "flex", gap: 16, marginTop: 10, padding: "6px 10px", background: C.navyPanel, borderRadius: 4, border: `1px solid ${C.border}`, fontSize: 11, flexWrap: "wrap" }}>
                    <span style={{ color: C.sub }}>SBP:</span>
                    <span style={{ color: C.red, fontWeight: 700, ...S.mono }}>£{sbp.toFixed(2)}/MWh</span>
                    <span style={{ color: C.border }}>|</span>
                    <span style={{ color: C.sub }}>SSP:</span>
                    <span style={{ color: C.green, fontWeight: 700, ...S.mono }}>£{ssp.toFixed(2)}/MWh</span>
                    <span style={{ color: C.border }}>|</span>
                    <span style={{ color: C.sub }}>System NIV:</span>
                    <span style={{ color: C.blue, fontWeight: 700, ...S.mono }}>{niv > 0 ? "+" : ""}{f0(niv)} MW</span>
                    <span style={{ color: C.border }}>|</span>
                    <span style={{ color: C.sub }}>SP:</span>
                    <span style={{ color: C.text, fontWeight: 700, ...S.mono }}>{sp} / 48</span>
                </div>
            </div>

            {/* Payment Waterfall */}
            <div style={S.panel}>
                <div style={S.panelTitle}>Payment Waterfall (SP {sp})</div>
                <div style={{ padding: "10px 14px", background: "#060d1a", borderRadius: 6, display: "flex", alignItems: "center", gap: 6, overflowX: "auto" }}>

                    {/* Parties Paying ELEXON (Charge > 0) */}
                    {rowsForSp.filter(r => r.charge > 0).map(r => (
                        <WaterfallNode
                            key={r.playerId}
                            ref={el => (waterfallRefs.current[r.playerId] = el)}
                            label={r.playerName}
                            amount={`£${f0(r.charge)}k`}
                            color="linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)"
                            highlight={selectedPlayerId === r.playerId}
                            arrow
                        />
                    ))}

                    <div style={{ padding: "8px 14px", background: "#1d4ed8", borderRadius: 4, textAlign: "center", border: "1px solid #3b82f6", minWidth: 90, flexShrink: 0 }}>
                        <div style={{ fontSize: 10, color: "#93c5fd" }}>ELEXON</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", ...S.mono }}>£{f0(totalCleared)}k</div>
                        <div style={{ fontSize: 9, color: "#60a5fa" }}>Clearing Hub</div>
                    </div>
                    {rowsForSp.filter(r => r.charge < 0).length > 0 && <span style={{ color: "#64748b", fontSize: 14 }}>→</span>}

                    {/* Parties Being Paid by ELEXON (Charge < 0) */}
                    {rowsForSp.filter(r => r.charge < 0).map((r, i, arr) => (
                        <WaterfallNode
                            key={r.playerId}
                            ref={el => (waterfallRefs.current[r.playerId] = el)}
                            label={r.playerName}
                            amount={`£${f0(Math.abs(r.charge))}k`}
                            color="linear-gradient(135deg, #4c0519 0%, #f0455a 100%)"
                            highlight={selectedPlayerId === r.playerId}
                            arrow={i < arr.length - 1} // Only show arrow to next receiving party visually
                        />
                    ))}

                </div>
                {totalCleared === 0 && (
                    <div style={{ textAlign: "center", fontSize: 10, color: C.sub, marginTop: 8 }}>No cash flows yet — advance to BM/Settlement phase</div>
                )}
            </div>
        </div>
    );
};

const SettlementTimelinePanel = ({ phase, activeRun, C, S }) => {
    const dateStr = useMemo(() => {
        return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
    }, []);

    const PHASE_PROGRESS = { FORECAST: 0, DA: 0, IDA1: 0, IDA2: 0, ID: 0, BM: 1, BM_OPEN: 1, BM_CLOSE: 1, REALTIME: 1, SETTLED: 2, RESULTS: 2 };
    const timelineProgress = PHASE_PROGRESS[phase] ?? 0;

    return (
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Settlement Timeline */}
            <div style={S.panel}>
                <div style={S.panelTitle}>Settlement Timeline</div>
                <TimelineRun label="Initial Settlement (II)" runs={["Issue", "D+1", "D+2"]} current={timelineProgress} desc={(phase === "SETTLED" || phase === "RESULTS") ? "Complete" : "Processing"} />
                <TimelineRun label="First Reconciliation (R1)" runs={["D+5", "D+14", "D+28"]} current={0} desc="Scheduled" />
                <TimelineRun label="Final Reconciliation (RF)" runs={["D+14m", "D+17m", "D+28m"]} current={0} desc="Future" />

                {/* Run status table */}
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                    <thead>
                        <tr>
                            <th style={{ ...S.thLeft, fontSize: 10 }}>Run</th>
                            <th style={{ ...S.th, fontSize: 10 }}>Date</th>
                            <th style={{ ...S.th, fontSize: 10 }}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[
                            { run: "II", date: dateStr, status: (phase === "SETTLED" || phase === "RESULTS") ? "Complete" : "Processing", c: (phase === "SETTLED" || phase === "RESULTS") ? "#22c55e" : "#92400e", bg: (phase === "SETTLED" || phase === "RESULTS") ? "#22c55e22" : "#f5b22233" },
                            { run: "R1", date: "+14 days", status: "Scheduled", c: "#3b82f6", bg: "#3b82f622" },
                            { run: "RF", date: "+14 months", status: "Future", c: "#4d7a96", bg: "#1a3045" },
                        ].map(r => (
                            <tr key={r.run} style={{ background: r.run === activeRun ? "#1a3045" : "transparent" }}>
                                <td style={{ ...S.tdLeft, fontSize: 11, fontWeight: r.run === activeRun ? 700 : 400, ...S.mono }}>{r.run}</td>
                                <td style={{ ...S.td, fontSize: 11, color: C.sub }}>{r.date}</td>
                                <td style={{ ...S.td, padding: "5px 10px" }}>
                                    <span style={{ padding: "2px 8px", borderRadius: 3, fontSize: 10, background: r.bg, color: r.c, fontWeight: 600 }}>
                                        {r.status}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* BSC Governance */}
            <div style={S.panel}>
                <div style={S.panelTitle}>BSC Code Governance</div>
                {[
                    { id: "P432", title: "MHHS Go-Live readiness", status: "Approved", votes: "14/14" },
                    { id: "P418", title: "Imbalance Price reform", status: "Voting", votes: "9/14" },
                    { id: "P441", title: "Flexibility market codes", status: "Consultation", votes: "—" },
                    { id: "P438", title: "DSR metering threshold", status: "Drafting", votes: "—" },
                ].map(m => (
                    <div key={m.id} style={{ padding: "7px 0", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
                        <span style={{ fontSize: 10, color: C.blue, fontWeight: 700, ...S.mono, minWidth: 36 }}>{m.id}</span>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: C.text, lineHeight: 1.3 }}>{m.title}</div>
                            <div style={{ fontSize: 10, color: C.faint }}>Votes: {m.votes}</div>
                        </div>
                        <span style={{
                            fontSize: 10, padding: "1px 6px", borderRadius: 3, height: "fit-content",
                            background: m.status === "Approved" ? C.greenBg : m.status === "Voting" ? "#f5b22233" : C.navyPanel,
                            color: m.status === "Approved" ? C.green : m.status === "Voting" ? "#f5b222" : C.sub,
                            fontWeight: 600, whiteSpace: "nowrap"
                        }}>{m.status}</span>
                    </div>
                ))}
            </div>

            {/* MHHS status */}
            <div style={S.panel}>
                <div style={S.panelTitle}>MHHS Pipeline</div>
                <div style={{ fontSize: 11, color: C.sub, marginBottom: 8 }}>Market-wide Half-Hourly Settlement</div>
                {[
                    { label: "Smart meters ingested", val: "18.4m", pct: 72 },
                    { label: "Agents migrated", val: "847 / 1,203", pct: 70 },
                    { label: "Data quality score", val: "99.2%", pct: 99 },
                ].map(r => (
                    <div key={r.label} style={{ marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <span style={{ fontSize: 11, color: C.sub }}>{r.label}</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: C.text, ...S.mono }}>{r.val}</span>
                        </div>
                        <div style={{ height: 5, background: C.border, borderRadius: 3 }}>
                            <div style={{ height: "100%", width: `${r.pct}%`, background: getProgressColor(r.pct), borderRadius: 3, transition: "width 1s" }} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ── Main Component ─────────────────────────────────────────────────────────
export default function ElexonScreen(props) {
    const {
        market, sp, phase, spHistory, spContracts, players,
        allBids,
    } = props;

    const [selectedPlayerId, setSelectedPlayerId] = useState(null);
    const [selectedSp] = useState(sp);
    const activeRun = "II";

    const currentMkt = market?.actual || market?.forecast || { sbp: 50, ssp: 50, niv: 0 };
    const { sbp = 50, ssp = 50, niv = 0 } = currentMkt;

    const sbpHistory = useMemo(() => spHistory.map(h => h.sbp || h.cp || sbp), [spHistory, sbp]);
    const sspHistory = useMemo(() => spHistory.map(h => h.ssp || ssp), [spHistory, ssp]);
    const mipHistory = useMemo(() => spHistory.map(h => ((h.sbp || h.cp || sbp) + (h.ssp || ssp)) / 2), [spHistory, sbp, ssp]);
    const mip = (sbp + ssp) / 2;
    const bmMw = allBids?.reduce((s, b) => s + (+b.mw || 0), 0) || 0;

    const playerList = Object.values(players || {}).filter(p => p?.name && p.role !== "instructor");
    const contractsForSp = spContracts[selectedSp] || {};
    const rowsForSp = playerList.map(p => {
        const c = contractsForSp[p.id] || {};
        const contractMw = (c.daMw || 0) + (c.idMw || 0);
        const actual = c.physicalMw || contractMw;
        const { imbalance, charge, price } = calculateImbalance(contractMw, actual, sbp, ssp, c.settlement);
        return {
            playerId: p.id, playerName: p.name, role: p.role || "Generator",
            contract: Math.round(contractMw), actual: Math.round(actual),
            imbalance, price, charge,
            daCash: c.settlement?.daCash || 0,
            bmCash: c.settlement?.bmCash || 0,
            imbCash: c.settlement?.imbCash || charge,
            total: c.settlement?.totalCash || 0
        };
    });

    const totalImbal = rowsForSp.reduce((s, r) => s + r.imbalance, 0);
    const totalCharge = rowsForSp.reduce((s, r) => s + Math.abs(r.charge), 0);
    const fpnTotal = rowsForSp.reduce((s, r) => s + Math.abs(r.contract), 0);
    const settledSps = Object.keys(spContracts).length;
    const totalReceivable = rowsForSp.reduce((s, r) => s + Math.max(0, -r.charge), 0);
    const totalPayable = rowsForSp.reduce((s, r) => s + Math.max(0, r.charge), 0);
    const totalCleared = totalReceivable + totalPayable;

    // Color palette & styles
    const C = { bg: "#050e16", panel: "#08141f", border: "#1a3045", header: "#ddeeff", text: "#ddeeff", sub: "#4d7a96", faint: "#2a5570", blue: "#3b82f6", green: "#1de98b", red: "#f0455a", greenBg: "#071f13", redBg: "#1f0709", navyPanel: "#0c1c2a" };
    const S = {
        panel: { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 },
        panelTitle: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12, letterSpacing: "-0.01em" },
        th: { padding: "6px 10px", fontSize: 10, fontWeight: 600, color: C.sub, textAlign: "right", letterSpacing: "0.02em", textTransform: "uppercase", borderBottom: `2px solid ${C.border}`, background: C.navyPanel },
        thLeft: { padding: "6px 10px", fontSize: 10, fontWeight: 600, color: C.sub, textAlign: "left", letterSpacing: "0.02em", textTransform: "uppercase", borderBottom: `2px solid ${C.border}`, background: C.navyPanel },
        td: { padding: "7px 10px", fontSize: 11, textAlign: "right", borderBottom: `1px solid ${C.border}`, fontFamily: "'JetBrains Mono', monospace" },
        tdLeft: { padding: "7px 10px", fontSize: 11, textAlign: "left", borderBottom: `1px solid ${C.border}` },
        mono: { fontFamily: "'JetBrains Mono', monospace" },
        label: { fontSize: 9, color: C.faint, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }
    };

    const topRight = (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ padding: "6px 12px", background: (phase === "SETTLED" || phase === "RESULTS") ? "#071f13" : "#0c1c2a", border: `1px solid ${(phase === "SETTLED" || phase === "RESULTS") ? "#1de98b" : "#1a3045"}`, borderRadius: 6, color: (phase === "SETTLED" || phase === "RESULTS") ? "#1de98b" : "#4d7a96", fontWeight: 800, fontSize: 11, fontFamily: "'Outfit'" }}>
                {(phase === "SETTLED" || phase === "RESULTS") ? "✓ SETTLEMENT ACTIVE" : `⏳ AWAITING ${phase} → RESULTS`}
            </div>
        </div>
    );

    const left = (
        <MarketDataPanel
            bmMw={bmMw} mip={mip} fpnTotal={fpnTotal} playerList={playerList}
            settledSps={settledSps} sp={sp} sbpHistory={sbpHistory} sspHistory={sspHistory} mipHistory={mipHistory}
            sbp={sbp} ssp={ssp} totalReceivable={totalReceivable} totalPayable={totalPayable} C={C} S={S}
        />
    );

    const center = (
        <ImbalanceEnginePanel
            rowsForSp={rowsForSp} playerList={playerList} activeRun={activeRun}
            selectedPlayerId={selectedPlayerId} setSelectedPlayerId={setSelectedPlayerId}
            sp={selectedSp} sbp={sbp} ssp={ssp} niv={niv}
            totalImbal={totalImbal} totalCharge={totalCharge} totalCleared={totalCleared}
            C={C} S={S}
        />
    );

    const right = (
        <SettlementTimelinePanel
            phase={phase} activeRun={activeRun} C={C} S={S}
        />
    );

    return (
        <SharedLayout
            {...props}
            roleName="Elexon"
            topRight={topRight}
            left={left}
            center={center}
            right={right}
            hint="Your mission: make every bill so clear that nobody argues with it."
        />
    );
}
