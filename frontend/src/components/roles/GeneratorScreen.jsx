import React, { useState, useEffect, useRef } from 'react';
import SharedLayout from './SharedLayout';
import { ASSETS, SP_DURATION_H, SYSTEM_PARAMS } from '../../shared/constants';
import { Tip } from '../shared/Tip'; // Added tooltips
import DACurveSubmission from '../DACurveSubmission';
import DAResultsTable from '../shared/DAResultsTable';
import DAClearingChart from '../shared/DAClearingChart';
import ForecastUpdateBanner from '../shared/ForecastUpdateBanner';

// Formatting
const f0 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 0 });
const f1 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 1 });

export default function GeneratorScreen(props) {
    const {
        market, sp, msLeft, tickSpeed, phase,
        assetKey, soc, myBid, setMyBid, submitted, onSubmit,
        daMyBid, setDaMyBid, daSubmitted, onDaSubmit,
        idMyOrder, setIdMyOrder, idSubmitted, onIdSubmit,
        spContracts, pid, spHistory, allBids, contractPosition, cash, daCash,
        physicalState, setPhysicalState, // New
        daCurveSegments, onDaCurveSubmit, daAuctionResults, forecasts,
        positions, daPositions
    } = props;
    const [useCurveMode, setUseCurveMode] = useState(true); // Default to EPEX curve mode
    const daAlreadyCleared = daAuctionResults && daAuctionResults.prices && daAuctionResults.prices.length > 0;

    // Lookup Asset details
    const def = ASSETS[assetKey] || ASSETS.BESS_S;
    const isShort = market?.actual?.isShort || market?.forecast?.isShort;
    const currentMkt = ["FORECAST_0", "FORECAST_1", "FORECAST_2", "FORECAST", "DA", "IDA1", "IDA2", "ID", "ID_ROUNDS"].includes(phase) ? market?.forecast : market?.actual;
    const sbp = currentMkt?.sbp || 50; const ssp = currentMkt?.ssp || 50;

    // Revenue calculations
    // Bug fix: totalRev was adding cash + daCash which double-counts DA revenue since cash already includes it.
    const totalRev = Number(cash || 0);
    const cSp = spContracts[sp]?.[pid] || { physicalMw: 0 };
    const risk = { expectedImbMw: Math.abs(contractPosition - (cSp.bmAccepted?.mw || 0)), worstCaseCost: Math.abs(contractPosition - (cSp.bmAccepted?.mw || 0)) * Math.max(sbp, ssp) };

    // Physics state fallbacks
    const pState = physicalState || { status: "ONLINE", currentMw: 0, spUntilOnline: 0 };

    // --- TOP RIGHT (NET POS + SYSTEM STATS) ---
    const systemMarket = market?.actual || market?.forecast || {};
    const sysDemand = systemMarket.system?.demandMw || 0;
    const sysWind = systemMarket.system?.windMw || 0;
    const sysSolar = systemMarket.system?.solarMw || 0;

    const topRight = (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Tip text="Net Position: The total volume you have contracted to deliver. This is your Physical Notification (PN)." align="right">
                <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", padding: "4px 8px", borderRadius: 4, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 7.5, color: "#4d7a96", borderBottom: "1px dashed #4d7a96", cursor: "help" }}>NET POS (SP{sp})</span>
                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: "#ddeeff" }}>{f0(contractPosition)} MW</span>
                </div>
            </Tip>
            <div style={{ display: "flex", gap: 6, fontSize: 10, alignItems: "baseline" }}>
                <span style={{ color: "#4d7a96" }}>SYS DMD</span><span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: "#f5b222" }}>{f0(sysDemand)}</span>
                <span style={{ color: "#4d7a96" }}>WIND</span><span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: "#a3e635" }}>{f0(sysWind)}</span>
                <span style={{ color: "#4d7a96" }}>SOLAR</span><span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: "#fbbf24" }}>{f0(sysSolar)}</span>
            </div>
        </div>
    );

    // --- SECTION 1: ASSET CAPABILITIES ---
    let theoreticalMaxMw = def.maxMW;
    if (def.kind === "soc") {
        const availableMwh = (soc / 100) * def.maxMWh;
        theoreticalMaxMw = Math.min(def.maxMW, (availableMwh * (def.eff || 1)) / 0.5);
    }
    if (def.kind === "fuel") theoreticalMaxMw = Math.min(def.maxMW, soc / 0.5);
    if (def.kind === "wind" || def.kind === "solar") theoreticalMaxMw = Math.round((currentMkt?.wf || 1) * def.maxMW);

    const sect1AssetInfo = (
        <div style={{ background: "#0c1c2a", border: `1px solid ${def.col}55`, borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: def.col, boxShadow: `0 0 10px ${def.col}` }} />
            <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                <span>1. Asset Profile</span>
                <span style={{ fontSize: 14 }}>{def.emoji} {def.name}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
                    <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>MAX CAPACITY</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: def.col, fontWeight: 800 }}>{f0(def.maxMW)}<span style={{ fontSize: 9, color: "#2a5570" }}>MW</span></div>
                </div>
                <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
                    <Tip text="The lowest MW output the generator can safely hold without tripping offline.">
                        <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2, borderBottom: "1px dashed #4d7a96", display: "inline-block", cursor: "help" }}>MIN STABLE</div>
                    </Tip>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#f5b222", fontWeight: 800 }}>{def.minMw || 0}<span style={{ fontSize: 9, color: "#2a5570" }}>MW</span></div>
                </div>
                <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
                    <Tip text="How fast the generator can increase or decrease MW output per Settlement Period.">
                        <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2, borderBottom: "1px dashed #4d7a96", display: "inline-block", cursor: "help" }}>RAMP RATE</div>
                    </Tip>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#38c0fc", fontWeight: 800 }}>{def.rampRate || 'Max'}<span style={{ fontSize: 9, color: "#2a5570" }}>MW/SP</span></div>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
                    <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>STARTUP TIME</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#ddeeff", fontWeight: 700 }}>{def.startupTime ? `${def.startupTime} SPs` : 'Instant'}</div>
                </div>
                <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
                    <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>VAR. COST (FUEL/WEAR)</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#f0455a", fontWeight: 700 }}>£{f1(def.varCost || def.wear || 0)}/MWh</div>
                </div>
            </div>
            <div style={{ fontSize: 8.5, color: "#4d7a96", marginTop: "auto", paddingTop: 12, lineHeight: 1.5 }}>
                {def.desc}
            </div>
        </div>
    );

    // --- SECTION 2: LIVE AVAILABILITY ---
    // Calculate what the generator can ACTUALLY reach this SP.
    // Ramp rate is MW per SP — so for one upcoming SP the ceiling is currentMw + rampRate * 1.
    // Bug fix: was * 5 (gave 5 SPs of headroom in a single step, making ramp constraints meaningless).
    let maxReachableMw = pState.status === "ONLINE" ? Math.min(theoreticalMaxMw, pState.currentMw + (def.rampRate ? def.rampRate : 9999)) : 0;

    const sect2Availability = (
        <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 12 }}>2. {(def.kind === "wind" || def.kind === "solar") ? "Weather Conditions" : "Live Status"}</div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, background: "#050e16", padding: "8px 12px", border: "1px solid #1a3045", borderRadius: 6 }}>
                <div>
                    <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 2 }}>PHYSICAL STATE</div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: pState.status === "ONLINE" ? "#1de98b" : pState.status === "STARTING" ? "#f5b222" : "#f0455a", letterSpacing: 1 }}>{pState.status}</div>
                </div>
                {pState.status === "STARTING" && (
                    <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 8, color: "#4d7a96" }}>ONLINE IN</div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#f5b222" }}>{pState.spUntilOnline} SPs</div>
                    </div>
                )}
            </div>

            {def.kind === "wind" ? (
                (() => {
                    const windPct = currentMkt?.wf ? Math.round(currentMkt.wf * 100) : 0;
                    const windColor = windPct < 30 ? "#f0455a" : windPct < 60 ? "#f5b222" : "#1de98b";
                    const expectedMw = (windPct / 100) * (def.maxMW || 0);
                    return (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                            <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "8px 12px", borderRadius: 6 }}>
                                <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4 }}>WIND STRENGTH</div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 28, fontWeight: 900, color: windColor }}>{windPct}</span>
                                    <span style={{ fontSize: 12, color: windColor, fontWeight: 700 }}>%</span>
                                </div>
                            </div>
                            <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "8px 12px", borderRadius: 6 }}>
                                <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4 }}>EXPECTED OUTPUT</div>
                                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 20, fontWeight: 900, color: "#ddeeff" }}>{f0(expectedMw)}</span>
                                    <span style={{ fontSize: 12, color: "#2a5570" }}>MW</span>
                                </div>
                            </div>
                        </div>
                    );
                })()
            ) : def.kind === "solar" ? (
                (() => {
                    const solarPct = currentMkt?.sf ? Math.round(currentMkt.sf * 100) : 0;
                    const solarColor = solarPct < 15 ? "#f0455a" : solarPct < 50 ? "#f5b222" : "#fde047";
                    const expectedMw = (solarPct / 100) * (def.maxMW || 0);
                    return (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                            <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "8px 12px", borderRadius: 6 }}>
                                <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4 }}>SOLAR IRRADIANCE</div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 28, fontWeight: 900, color: solarColor }}>{solarPct}</span>
                                    <span style={{ fontSize: 12, color: solarColor, fontWeight: 700 }}>%</span>
                                </div>
                            </div>
                            <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "8px 12px", borderRadius: 6 }}>
                                <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4 }}>EXPECTED OUTPUT</div>
                                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 20, fontWeight: 900, color: "#ddeeff" }}>{f0(expectedMw)}</span>
                                    <span style={{ fontSize: 12, color: "#2a5570" }}>MW</span>
                                </div>
                            </div>
                        </div>
                    );
                })()
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                    <div>
                        <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4 }}>CURRENT OUTPUT</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 24, fontWeight: 900, color: "#ddeeff" }}>{f0(pState.currentMw)}</span>
                            <span style={{ fontSize: 12, color: "#2a5570" }}>MW</span>
                        </div>
                    </div>
                    <div>
                        <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4 }}>THEORETICAL LIMIT</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 24, fontWeight: 900, color: def.col }}>{f0(theoreticalMaxMw)}</span>
                            <span style={{ fontSize: 12, color: "#2a5570" }}>MW</span>
                        </div>
                    </div>
                </div>
            )}

            <div style={{ marginTop: "auto", background: maxReachableMw === 0 && def.startupTime > 0 && pState.status === "OFFLINE" ? "#1f0709" : "#071f13", border: `1px solid ${maxReachableMw === 0 && def.startupTime > 0 && pState.status === "OFFLINE" ? "#f0455a" : "#1de98b"}44`, borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 8.5, color: maxReachableMw === 0 && def.startupTime > 0 && pState.status === "OFFLINE" ? "#f0455a" : "#1de98b", fontWeight: 700 }}>
                    {pState.status === "OFFLINE" && def.startupTime > 0 ? "⚠️ Plant is OFFLINE. Submitting a bid will incur imbalance penalties unless resolved before SP closes." : `✓ Available to generate up to ${f0(maxReachableMw)} MW this period.`}
                </div>
                {pState.status === "OFFLINE" && def.startupTime > 0 && (
                    <button
                        onClick={() => setPhysicalState(prev => ({ ...prev, status: "STARTING", spUntilOnline: def.startupTime }))}
                        style={{ marginTop: 6, padding: "4px 10px", background: "#f5b22222", border: "1px solid #f5b222", borderRadius: 4, color: "#f5b222", fontSize: 9, fontWeight: 800, cursor: "pointer", fontFamily: "'Outfit'" }}>
                        🔌 REQUEST COLD START ({def.startupTime} SP{def.startupTime > 1 ? "s" : ""} to online)
                    </button>
                )}
            </div>
        </div>
    );

    // --- SECTION 3: MARKET BIDS ---
    const isForecast = ["FORECAST_0", "FORECAST_1", "FORECAST_2"].includes(phase);
    const isDa = ["DA", "IDA1", "IDA2"].includes(phase);
    const isIda = ["IDA1", "IDA2"].includes(phase);
    const isId = phase === "ID" || phase === "ID_ROUNDS";
    const isBm = ["BM", "BM_OPEN", "REALTIME"].includes(phase);

    const sect3Bids = (
        <div style={{ flex: 1, background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h4 style={{ fontSize: 12, color: isForecast ? "#38c0fc" : isDa ? "#f5b222" : isId ? "#38c0fc" : isBm ? "#1de98b" : "#b78bfa", letterSpacing: 1, textTransform: "uppercase" }}>
                    3. {isForecast ? "Forecast Phase" : isDa ? "DA Market Submission" : isId ? "Intraday Bilaterals" : isBm ? "Balancing Mechanism" : "Settlement Phase"}
                </h4>
                <div style={{ fontSize: 9, color: "#4d7a96", padding: "2px 6px", border: "1px solid #1a3045", borderRadius: 4 }}>
                    {isForecast ? phase : isDa ? "DA" : isId ? "ID" : isBm ? "BM" : "SETTLED"}
                </div>
            </div>

            {isForecast && (
                <div style={{ textAlign: "center", padding: "32px 16px", color: "#4d7a96" }}>
                    <div style={{ fontSize: 28, marginBottom: 12 }}>📡</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#38c0fc", marginBottom: 8 }}>NESO is preparing market forecasts</div>
                    <div style={{ fontSize: 11, lineHeight: 1.6, color: "#64748b", maxWidth: 320, margin: "0 auto" }}>
                        The system operator is publishing demand, wind, and solar forecasts for all 48 settlement periods.
                        Once published, the <b style={{ color: "#f5b222" }}>Day-Ahead auction</b> will open and you can submit your EPEX curve or simple bid.
                    </div>
                    {props.forecastUpdateSummary && (
                        <div style={{ marginTop: 16, background: "#061018", border: "1px solid #1de98b33", borderRadius: 6, padding: "10px 14px", fontSize: 10, color: "#1de98b", textAlign: "left" }}>
                            📋 {props.forecastUpdateSummary.trigger}
                        </div>
                    )}
                </div>
            )}

            {isDa && (
                <>
                    <ForecastUpdateBanner forecastUpdateSummary={props.forecastUpdateSummary} compact />
                    {daAlreadyCleared && isIda ? (
                        /* IDA1/IDA2 — show re-bid form prominently, DA results below */
                        <>
                            <div style={{ background: "#061018", border: "1px solid #fb923c55", borderRadius: 8, padding: 14, marginBottom: 12 }}>
                                <div style={{ fontSize: 10, color: "#fb923c", fontWeight: 800, letterSpacing: 1, marginBottom: 4 }}>{phase} — REVISE YOUR POSITION</div>
                                <p style={{ fontSize: 9, color: "#4d7a96", lineHeight: 1.5, margin: "0 0 12px" }}>Your DA contracted position: <strong style={{ color: "#f5b222" }}>{f0(contractPosition)} MW</strong>. Enter an additional volume to buy or sell in this intraday auction to adjust your net position.</p>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                                    <div>
                                        <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>ADJUST VOLUME (MW)</label>
                                        <input type="number" value={daMyBid.mw} onChange={e => setDaMyBid(b => ({ ...b, mw: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#ddeeff", fontSize: 14, fontFamily: "'JetBrains Mono'", boxSizing: "border-box" }} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>PRICE LIMIT £/MWh</label>
                                        <input type="number" value={daMyBid.price} onChange={e => setDaMyBid(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#f5b222", fontSize: 14, fontFamily: "'JetBrains Mono'", boxSizing: "border-box" }} />
                                    </div>
                                </div>
                                <button onClick={onDaSubmit} disabled={!daMyBid.price} style={{ width: "100%", padding: "12px", background: "#fb923c", border: "none", borderRadius: 6, color: "#050e16", fontWeight: 800, fontSize: 12, cursor: daMyBid.price ? "pointer" : "default", opacity: daMyBid.price ? 1 : 0.5 }}>
                                    {daSubmitted ? `UPDATE ${phase} OFFER →` : `SUBMIT ${phase} OFFER →`}
                                </button>
                            </div>
                            <details style={{ fontSize: 9 }}>
                                <summary style={{ color: "#4d7a96", cursor: "pointer", marginBottom: 6 }}>View DA Clearing Results ▼</summary>
                                <DAClearingChart daAuctionResults={daAuctionResults} pid={pid} currentSp={sp} />
                                <DAResultsTable daAuctionResults={daAuctionResults} daPositions={daPositions} positions={positions} pid={pid} currentSp={sp} />
                            </details>
                        </>
                    ) : daAlreadyCleared ? (
                        /* DA already cleared, not in IDA — show chart + per-SP results */
                        <>
                            <DAClearingChart
                                daAuctionResults={daAuctionResults}
                                pid={pid}
                                currentSp={sp}
                            />
                            <div style={{ height: 8 }} />
                            <DAResultsTable
                                daAuctionResults={daAuctionResults}
                                daPositions={daPositions}
                                positions={positions}
                                pid={pid}
                                currentSp={sp}
                            />
                        </>
                    ) : (
                        /* DA not yet cleared — show submission UI */
                        <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <p style={{ fontSize: 9, color: "#4d7a96", lineHeight: 1.5, margin: 0, flex: 1 }}>Forward market. Secure baseload ahead of time to lock in price certainty.</p>
                                <button onClick={() => setUseCurveMode(m => !m)} style={{ padding: '3px 8px', background: '#0c1c2a', border: '1px solid #1a3045', borderRadius: 4, color: '#4d7a96', fontSize: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                    {useCurveMode ? 'Simple Mode' : 'EPEX Curve Mode'}
                                </button>
                            </div>
                            {useCurveMode ? (
                                <DACurveSubmission
                                    onSubmit={onDaCurveSubmit}
                                    forecastPrices={(forecasts || []).map(f => f?.price || 55)}
                                    initialSegments={daCurveSegments || undefined}
                                    assetMaxMW={def.maxMW || 100}
                                    daSubmitted={daSubmitted}
                                />
                            ) : (
                                <>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "auto" }}>
                                        <div>
                                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>OFFER VOLUME (MW)</label>
                                            <input type="number" value={daMyBid.mw} onChange={e => setDaMyBid(b => ({ ...b, mw: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#ddeeff", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>PRICE LIMIT £/MWh</label>
                                            <input type="number" value={daMyBid.price} onChange={e => setDaMyBid(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#f5b222", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                                        </div>
                                    </div>
                                    {daMyBid.mw > 0 && daMyBid.mw < (def?.minMw || 0) && (
                                        <div style={{ fontSize: 8.5, color: "#f5b222", fontWeight: 700, padding: "6px 0", textAlign: "center" }}>⚠️ Bidding below Min Stable ({def.minMw}MW) will trip the plant offline.</div>
                                    )}
                                    <button data-testid="gen-submit-da-offer" onClick={onDaSubmit} disabled={!daMyBid.price} style={{ marginTop: 16, width: "100%", padding: "12px", background: "#f5b222", border: "none", borderRadius: 6, color: "#050e16", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                                        {daSubmitted ? "UPDATE DA OFFER →" : "SUBMIT DA OFFER →"}
                                    </button>
                                </>
                            )}
                        </>
                    )}
                </>
            )}

            {isId && (
                <>
                    <p style={{ fontSize: 9, color: "#4d7a96", marginBottom: 8, lineHeight: 1.5 }}>Adjust your DA position to reflect updated wind forecasts & plant availability.</p>
                    {/* Remaining capacity banner */}
                    {(() => {
                        const daVol = Math.abs(daPositions?.[sp - 1] || 0);
                        const pm = daAuctionResults?.pmax?.[pid]?.[sp - 1] || def.maxMW || 0;
                        const remaining = Math.max(0, pm - daVol);
                        const currentPos = contractPosition;
                        return (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
                                <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 5, padding: "6px 8px", textAlign: "center" }}>
                                    <div style={{ fontSize: 7, color: "#4d7a96" }}>DA CONTRACT</div>
                                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, fontWeight: 800, color: "#f5b222" }}>{currentPos >= 0 ? "+" : ""}{f0(currentPos)}MW</div>
                                </div>
                                <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 5, padding: "6px 8px", textAlign: "center" }}>
                                    <div style={{ fontSize: 7, color: "#4d7a96" }}>PHYSICAL MAX</div>
                                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, fontWeight: 800, color: "#ddeeff" }}>{f0(pm)}MW</div>
                                </div>
                                <div style={{ background: remaining > 0 ? "#38c0fc11" : "#0c1c2a", border: `1px solid ${remaining > 0 ? "#38c0fc33" : "#1a3045"}`, borderRadius: 5, padding: "6px 8px", textAlign: "center" }}>
                                    <div style={{ fontSize: 7, color: "#4d7a96" }}>REMAINING CAP</div>
                                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, fontWeight: 800, color: remaining > 0 ? "#38c0fc" : "#2a5570" }}>{f0(remaining)}MW</div>
                                </div>
                            </div>
                        );
                    })()}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <button onClick={() => setIdMyOrder(b => ({ ...b, side: "buy" }))} disabled={idSubmitted} style={{ padding: "8px", background: idMyOrder.side === "buy" ? "#38c0fc22" : "#102332", border: `1px solid ${idMyOrder.side === "buy" ? "#38c0fc" : "#1a3045"}`, borderRadius: 6, color: idMyOrder.side === "buy" ? "#38c0fc" : "#4d7a96", fontSize: 10, fontWeight: 800 }}>BUY (Go Long)</button>
                        <button onClick={() => setIdMyOrder(b => ({ ...b, side: "sell" }))} disabled={idSubmitted} style={{ padding: "8px", background: idMyOrder.side === "sell" ? "#f0455a22" : "#102332", border: `1px solid ${idMyOrder.side === "sell" ? "#f0455a" : "#1a3045"}`, borderRadius: 6, color: idMyOrder.side === "sell" ? "#f0455a" : "#4d7a96", fontSize: 10, fontWeight: 800 }}>SELL (Go Short)</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "auto" }}>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>VOLUME (MW)</label>
                            <input type="number" value={idMyOrder.mw} disabled={idSubmitted} onChange={e => setIdMyOrder(b => ({ ...b, mw: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#ddeeff", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>PRICE LIMIT £/MWh</label>
                            <input type="number" value={idMyOrder.price} disabled={idSubmitted} onChange={e => setIdMyOrder(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#38c0fc", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                        </div>
                    </div>
                    {idMyOrder.mw > 0 && idMyOrder.mw < (def?.minMw || 0) && (
                        <div style={{ fontSize: 8.5, color: "#f5b222", fontWeight: 700, padding: "6px 0", textAlign: "center" }}>⚠️ Warning: Output below Min Stable ({def.minMw}MW) will trip the plant.</div>
                    )}
                    {idSubmitted ? (
                        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
                            <div style={{ flex: 1, padding: "12px", background: "#061018", border: "1px solid #1de98b44", borderRadius: 6, color: "#1de98b", fontSize: 10, fontWeight: 800, textAlign: "center" }}>✓ ID ORDER PUBLISHED</div>
                            {props.onEditIdOrder && <button onClick={props.onEditIdOrder} style={{ padding: "12px 14px", background: "#102332", border: "1px solid #f5b22266", borderRadius: 6, color: "#f5b222", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>EDIT ORDER</button>}
                        </div>
                    ) : (
                        <button data-testid="gen-submit-id-order" onClick={onIdSubmit} disabled={!idMyOrder.price} style={{ marginTop: 16, width: "100%", padding: "12px", background: "#38c0fc", border: "none", borderRadius: 6, color: "#050e16", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                            SUBMIT ID ORDER →
                        </button>
                    )}
                </>
            )}

            {(isBm || (!isDa && !isId)) && (
                <>
                    <p style={{ fontSize: 9, color: "#4d7a96", marginBottom: 12, lineHeight: 1.5 }}>Final physical dispatch. Bids must respect ramp rates and min stable generation.</p>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                        <div style={{ flex: 1, background: isShort ? "#1f0709" : "#071f13", border: `1px solid ${isShort ? "#f0455a" : "#1de98b"}44`, borderRadius: 6, padding: "8px", textAlign: "center" }}>
                            <div style={{ fontSize: 9, color: isShort ? "#f0455a" : "#1de98b", fontWeight: 800 }}>{isShort ? "GRID SHORT: NESO BUYING" : "GRID LONG: NESO SELLING"}</div>
                        </div>
                        <div style={{ flex: 1, background: "#102332", border: "1px solid #1a3045", borderRadius: 6, padding: "8px", textAlign: "center" }}>
                            <div style={{ fontSize: 9, color: "#4d7a96", fontWeight: 800 }}>CONTRACT: {f0(contractPosition)} MW</div>
                        </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "auto" }}>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>FLEX VOLUME (MW)</label>
                            <input type="number" value={myBid.mw} disabled={submitted || !isBm} onChange={e => setMyBid(b => ({ ...b, mw: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#ddeeff", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>BID PRICE £/MWh</label>
                            <input type="number" value={myBid.price} placeholder={`~£${f0((isShort ? sbp * SYSTEM_PARAMS.bidStrategyMultipliers.genBM.sbpMultiplier : ssp * SYSTEM_PARAMS.bidStrategyMultipliers.genBM.sspMultiplier))}`} disabled={submitted || !isBm} onChange={e => setMyBid(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#1de98b", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                        </div>
                    </div>
                    {!!def.minMw && Number(myBid.mw) > 0 && Number(myBid.mw) < def.minMw && (
                        <div style={{
                            marginTop: 8, marginBottom: 8, padding: "8px 12px", borderRadius: 6,
                            background: "#1f0709", border: "1px solid #f0455a88",
                            color: "#f0455a", fontSize: 10, fontWeight: 700, textAlign: "center",
                            lineHeight: 1.5
                        }}>
                            ⚠ Bid is below Minimum Stable Generation ({def.minMw} MW).<br />
                            Risk of plant trip if only partially cleared!
                        </div>
                    )}
                    <button data-testid="gen-submit-bm" onClick={onSubmit} disabled={submitted || !isBm || !myBid.price} style={{ marginTop: 16, width: "100%", padding: "12px", background: submitted || !isBm ? "#1a3045" : (isShort ? "#f0455a" : "#1de98b"), border: "none", borderRadius: 6, color: submitted || !isBm ? "#4d7a96" : "#050e16", fontWeight: 800, fontSize: 12, cursor: submitted || !isBm ? "default" : "pointer" }}>
                        {!isBm ? "AWAITING BM PHASE..." : submitted ? "✓ BM BID SUBMITTED" : `SUBMIT ${isShort ? "OFFER" : "BID"} TO NESO →`}
                    </button>
                </>
            )}
        </div>
    );

    const revenueRef = useRef(null);

    useEffect(() => {
        if (revenueRef.current) {
            revenueRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [pid]);

    const expectedImbMw = (pState.currentMw || 0) - (contractPosition || 0);
    const expectedCost = expectedImbMw !== 0 ? expectedImbMw * (expectedImbMw > 0 ? ssp : sbp) : 0;

    const expectedImbMaxMw = (maxReachableMw || 0) - (contractPosition || 0);
    const expectedCostMaxMw = expectedImbMaxMw !== 0 ? expectedImbMaxMw * (expectedImbMaxMw > 0 ? ssp : sbp) : 0;

    // Energy flow summary for this SP (physical layer)
    const actualMw = pState.currentMw || 0;
    const actualMwh = actualMw * SP_DURATION_H;
    const capacityUsedPct = def.maxMW ? Math.min(100, Math.abs(actualMw) / def.maxMW * 100) : 0;
    const flowLabel = actualMw > 0 ? "Giving energy to market" : actualMw < 0 ? "Taking energy from market" : "Neutral (no net flow)";

    // --- SECTION 4: REAL-TIME SETTLEMENT & IMBALANCE ---
    const sect4RealTime = (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", height: "100%", background: "#050e16" }}>
            <h3 style={{ fontSize: 12, color: "#fff", marginBottom: 8, letterSpacing: 1 }}>4. REAL-TIME OPERATIONS & SETTLEMENT</h3>
            <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 16 }}>
                KPI: <strong style={{ color: "#1de98b" }}>Profit/MW</strong>
            </div>

            <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 8, padding: 16, marginBottom: 20, flex: 1, display: "flex", flexDirection: "column" }}>
                <Tip text="Imbalance happens when your Physical Notification (Contracts) doesn't equal your Actual Metered Output.">
                    <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 8, borderBottom: "1px dashed #4d7a96", display: "inline-block", cursor: "help" }}>Imbalance Exposure</div>
                </Tip>
                <div style={{ fontSize: 9, color: "#2a5570", marginBottom: 20, lineHeight: 1.5 }}>
                    Mismatch between your Physical Notification (PN) and Actual Physical Output triggers imbalance penalties.
                </div>

                <div style={{ background: "#050e16", border: "1px solid #1a3045", borderRadius: 6, padding: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                    <Tip text="The volume you committed to deliver in this Settlement Period (PN).">
                        <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4 }}>CONTRACTED (PN)</div>
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 16, fontWeight: 800, color: "#38c0fc" }}>{f0(contractPosition)} <span style={{ fontSize: 10 }}>MW</span></div>
                        </div>
                    </Tip>
                    <div style={{ fontSize: 14, color: "#2a5570" }}>VS</div>
                    <Tip text="Your actual output this Settlement Period. Differences trigger imbalance costs.">
                        <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4 }}>ACTUAL OUTPUT</div>
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 16, fontWeight: 800, color: "#f0455a" }}>{f0(pState.currentMw)} <span style={{ fontSize: 10 }}>MW</span></div>
                        </div>
                    </Tip>
                </div>

                <Tip text={`Difference between your contracted and actual output. ${expectedImbMw > 0 ? "Surplus: Selling at SSP (+£" + ssp.toFixed(2) + "/MWh)." : expectedImbMw < 0 ? "Shortfall: Buying at SBP (-£" + sbp.toFixed(2) + "/MWh)." : "Perfectly balanced."}`}>
                    <div style={{ marginTop: "auto", textAlign: "center", paddingTop: 16, borderTop: "1px solid #1a3045", display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontSize: 9, color: "#4d7a96" }}>EXPECTED IMBALANCE VOLUME</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, color: expectedImbMw === 0 ? "#1de98b" : (expectedImbMw > 0 ? "#3b82f6" : "#f0455a"), fontWeight: 900 }}>
                            {expectedImbMw > 0 ? "+" : ""}{f0(expectedImbMw)} MW
                        </div>
                        {expectedImbMw !== 0 && (
                            <div style={{ fontSize: 11, color: expectedCost >= 0 ? "#1de98b" : "#f0455a", fontWeight: 700 }}>
                                {expectedCost > 0 ? "+" : "−"}£{f0(Math.abs(expectedCost))} (Estimated Cost)
                            </div>
                        )}

                        <div style={{ marginTop: 10, padding: "10px", borderRadius: 6, background: "#061b2b", border: "1px solid #1a3045" }}>
                            <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6 }}>IF OUTPUT = MAX AVAILABLE ({f0(maxReachableMw)} MW)</div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#ddeeff" }}>
                                <span>Imbalance</span>
                                <span style={{ color: expectedImbMaxMw === 0 ? "#1de98b" : (expectedImbMaxMw > 0 ? "#3b82f6" : "#f0455a"), fontWeight: 700 }}>{expectedImbMaxMw > 0 ? "+" : ""}{f0(expectedImbMaxMw)} MW</span>
                            </div>
                            {expectedImbMaxMw !== 0 && (
                                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: expectedCostMaxMw >= 0 ? "#1de98b" : "#f0455a", fontWeight: 700 }}>
                                    <span>Cost</span>
                                    <span>{expectedCostMaxMw > 0 ? "+" : "−"}£{f0(Math.abs(expectedCostMaxMw))}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </Tip>

                {/* Energy flow & capacity usage this SP */}
                <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid #1a3045" }}>
                    <Tip text="How much power you are physically delivering or absorbing this Settlement Period, and how much of your nameplate capacity that uses.">
                        <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 6, borderBottom: "1px dashed #4d7a96", display: "inline-block", cursor: "help" }}>
                            Energy Flow This SP
                        </div>
                    </Tip>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <div style={{ fontSize: 9, color: "#2a5570" }}>{flowLabel}</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, fontWeight: 800, color: actualMw >= 0 ? "#1de98b" : "#38c0fc" }}>
                            {actualMw >= 0 ? "+" : ""}{f0(actualMw)} MW ({(actualMwh >= 0 ? "+" : "") + f1(actualMwh)} MWh)
                        </div>
                    </div>
                    <div style={{ height: 10, background: "#02070b", borderRadius: 5, border: "1px solid #1a3045", overflow: "hidden", position: "relative" }}>
                        <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: `${capacityUsedPct}%`, background: "#1de98b", opacity: 0.8, transition: "width 0.3s" }} />
                    </div>
                    <div style={{ marginTop: 4, fontSize: 8, color: "#2a5570", fontFamily: "'JetBrains Mono'" }}>
                        Capacity used: {f1(capacityUsedPct)}% of {f0(def.maxMW)} MW
                    </div>
                </div>
            </div>

            {spHistory.length > 0 && (() => {
                const last = spHistory[0];
                const contractMw = last.contractPosMw ?? contractPosition;
                const actualMw = last.actualPhysical ?? pState.currentMw;
                const deviation = actualMw - contractMw;
                const deviationLabel = deviation === 0 ? "Balanced" : deviation > 0 ? `Over-delivered +${f0(deviation)} MW` : `Under-delivered ${f0(Math.abs(deviation))} MW`;

                return (
                    <div style={{ marginTop: 20, padding: 12, background: "#071926", border: "1px solid #1a3045", borderRadius: 8 }}>
                        <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, marginBottom: 8 }}>POST-SP REVIEW</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 10, color: "#ddeeff" }}>
                            <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 4, padding: 10 }}>
                                <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4 }}>CONTRACT VS DELIVERY</div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                                    <span>Contract</span>
                                    <span>{f0(contractMw)} MW</span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: 4 }}>
                                    <span>Delivered</span>
                                    <span>{f0(actualMw)} MW</span>
                                </div>
                                <div style={{ marginTop: 8, fontSize: 9, color: deviation === 0 ? "#1de98b" : "#f5b222" }}>{deviationLabel}</div>
                            </div>

                            <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 4, padding: 10 }}>
                                <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4 }}>SETTLEMENT</div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                                    <span>Imbalance</span>
                                    <span style={{ color: (last.imbPen || 0) >= 0 ? "#1de98b" : "#f0455a" }}>£{f0(last.imbPen || 0)}</span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: 4 }}>
                                    <span>Imbalance price</span>
                                    <span>£{f0(last.imbPrc || 0)}</span>
                                </div>
                                <div style={{ marginTop: 8, fontSize: 9, color: last.accepted ? "#1de98b" : "#94a3b8" }}>
                                    BM action accepted: {last.accepted ? "Yes" : "No"}
                                </div>
                                <div style={{ marginTop: 4, fontSize: 9, color: "#4d7a96" }}>
                                    BM volume: {last.mw !== undefined ? `${f0(last.mw)} MW` : "—"}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            <div ref={revenueRef} style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 9, color: "#4d7a96", fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>REVENUE BREAKDOWN</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <Tip text="Revenue from your Day-Ahead market offers.">
                        <div>
                            <div style={{ fontSize: 8, color: "#2a5570", marginBottom: 2 }}>DAY-AHEAD</div>
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#f5b222", fontWeight: 800 }}>£{f0(daCash || 0)}</div>
                        </div>
                    </Tip>
                    <Tip text="Revenue from BM dispatch and imbalance settlements.">
                        <div>
                            <div style={{ fontSize: 8, color: "#2a5570", marginBottom: 2 }}>BM / IMBALANCE</div>
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#38c0fc", fontWeight: 800 }}>£{f0(cash || 0)}</div>
                        </div>
                    </Tip>
                    <Tip text="Total revenue across all windows pushed to your ledger.">
                        <div>
                            <div style={{ fontSize: 8, color: "#2a5570", marginBottom: 2 }}>TOTAL LEDGER</div>
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: totalRev >= 0 ? "#1de98b" : "#f0455a", fontWeight: 800 }}>£{f0(totalRev)}</div>
                        </div>
                    </Tip>
                </div>
            </div>
        </div>
    );

    const centerCol = (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", paddingBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {sect1AssetInfo}
                {sect2Availability}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                {sect3Bids}
            </div>
        </div>
    );

    return (
        <SharedLayout
            {...props}
            roleName={def.name}
            topRight={topRight}
            center={<div style={{ height: "100%", paddingRight: 16 }}>{centerCol}</div>}
            right={sect4RealTime}
        />
    );
}
