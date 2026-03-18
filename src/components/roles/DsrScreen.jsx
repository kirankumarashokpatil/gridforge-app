import React, { useState, useEffect, useRef } from 'react';
import SharedLayout from './SharedLayout';
import { ASSETS, SYSTEM_PARAMS } from '../../shared/constants';
import { Tip } from '../shared/Tip';
import DAResultsTable from '../shared/DAResultsTable';

// Formatting
const f0 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 0 });
const f1 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 1 });

export default function DsrScreen(props) {
    const {
        market, sp, msLeft, tickSpeed, phase,
        assetKey, cash, daCash, myBid, setMyBid, submitted, onSubmit,
        daMyBid, setDaMyBid, daSubmitted, onDaSubmit,
        idMyOrder, setIdMyOrder, idSubmitted, onIdSubmit,
        spContracts, pid, contractPosition,
        physicalState, // From App.jsx tracking DSR timers
        positions, daPositions, daAuctionResults
    } = props;
    const daAlreadyCleared = daAuctionResults && daAuctionResults.prices && daAuctionResults.prices.length > 0;

    // Lookup Asset details
    const def = ASSETS[assetKey] || ASSETS.DSR;
    const isShort = market?.actual?.isShort || market?.forecast?.isShort;
    const currentMkt = ["FORECAST", "DA", "IDA1", "IDA2", "ID"].includes(phase) ? market?.forecast : market?.actual;
    const sbp = currentMkt?.sbp || 50; const ssp = currentMkt?.ssp || 50;

    // Revenue calculations
    // Bug fix: was adding cash + daCash which double-counts DA revenue since cash already includes it.
    const totalRev = Number(cash || 0);
    const cSp = spContracts[sp]?.[pid] || { physicalMw: 0 };

    // --- DSR SPECIFIC PHYSICAL STATE ---
    // Bug fix: curtailActive was checking `curtailSpsRemaining < maxCurtailDuration`,
    // which was false on the FIRST SP (when remaining === max), so curtailActive showed false
    // exactly when it first became true. Correct check is simply > 0.
    const curtailActive = physicalState?.curtailSpsRemaining > 0;
    const reboundActive = physicalState?.reboundSpsRemaining > 0;
    const pendingReboundMwh = physicalState?.pendingReboundMwh || 0;
    const curtailSpsLeft = physicalState?.curtailSpsRemaining ?? (def.maxCurtailDuration || 2);

    const isAvailableToCurtail = curtailSpsLeft > 0 && !reboundActive;

    // --- TOP RIGHT (NET POS + SYS STATS) ---
    const systemMarket = market?.actual || market?.forecast || {};
    const sysDemand = systemMarket.system?.demandMw || 0;
    const sysWind = systemMarket.system?.windMw || 0;
    const sysSolar = systemMarket.system?.solarMw || 0;

    const topRight = (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", padding: "4px 8px", borderRadius: 4, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 7.5, color: "#4d7a96" }}>NET POS (SP{sp})</span>
                <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: contractPosition > 0 ? "#1de98b" : contractPosition < 0 ? "#38c0fc" : "#ddeeff" }}>
                    {contractPosition > 0 ? "+" : ""}{f0(contractPosition)} MW
                </span>
            </div>
            <div style={{ display: "flex", gap: 6, fontSize: 10, alignItems: "baseline" }}>
                <span style={{ color: "#4d7a96" }}>SYS DMD</span><span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: "#f5b222" }}>{f0(sysDemand)}</span>
                <span style={{ color: "#4d7a96" }}>WIND</span><span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: "#a3e635" }}>{f0(sysWind)}</span>
                <span style={{ color: "#4d7a96" }}>SOLAR</span><span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: "#fbbf24" }}>{f0(sysSolar)}</span>
            </div>
        </div>
    );

    // --- SECTION 1: ASSET CAPABILITIES ---
    const sect1AssetInfo = (
        <div style={{ background: "#0c1c2a", border: `1px solid ${def.col}55`, borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: def.col, boxShadow: `0 0 10px ${def.col}` }} />
            <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                <span>1. Asset Profile</span>
                <span style={{ fontSize: 14 }}>{def.emoji} {def.name}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
                    <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>FLEXIBLE PORTION</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: def.col, fontWeight: 800 }}>{f0(def.maxMW)}<span style={{ fontSize: 9, color: "#2a5570" }}>MW</span></div>
                </div>
                <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
                    <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>MAX CURTAIL DURATION</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#38c0fc", fontWeight: 800 }}>{def.maxCurtailDuration * 30}<span style={{ fontSize: 9, color: "#2a5570" }}>MINS</span></div>
                </div>
                <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
                    <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>REBOUND DEBT RATIO</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#f0455a", fontWeight: 800 }}>x{def.reboundMultiplier}</div>
                </div>
            </div>

            <div style={{ fontSize: 8.5, color: "#4d7a96", marginTop: "auto", paddingTop: 12, lineHeight: 1.5 }}>
                {def.desc} A Demand Side Response (DSR) asset temporarily reduces large industrial load. Any energy saved must be physically "paid back" in the following period at the rebound debt multiplier, representing processes catching up.
            </div>
        </div>
    );

    // --- SECTION 2: LIVE STATUS & AVAILABILITY ---
    const sect2Availability = (
        <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 12 }}>2. Live Operational State</div>

            <div style={{ marginBottom: 16, background: reboundActive ? "#1f0709" : curtailActive ? "#071f13" : "#050e16", padding: "8px 12px", border: `1px solid ${reboundActive ? "#f0455a" : curtailActive ? "#1de98b" : "#1a3045"}`, borderRadius: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <div style={{ fontSize: 8.5, color: reboundActive ? "#f0455a" : curtailActive ? "#1de98b" : "#4d7a96", fontWeight: reboundActive || curtailActive ? 800 : 400 }}>SYSTEM STATUS</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 900, color: reboundActive ? "#f0455a" : curtailActive ? "#1de98b" : "#ddeeff" }}>
                        {reboundActive ? "FORCED REBOUND ACTIVE" : curtailActive ? "CURTAILING LOAD" : "STANDBY (NORMAL CONSUMPTION)"}
                    </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 8, color: "#2a5570", fontFamily: "'JetBrains Mono'" }}>
                    <span>Duration Left: {curtailSpsLeft * 30} mins</span>
                    <span style={{ color: pendingReboundMwh > 0 ? "#f5b222" : "#2a5570" }}>Pending Rebound Debt: {f1(pendingReboundMwh)} MWh</span>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div style={{ borderLeft: `2px solid ${isAvailableToCurtail ? "#1de98b" : "#4d7a96"}`, paddingLeft: 8 }}>
                    <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 2 }}>CURTAILMENT AVAILABILITY</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 900, color: isAvailableToCurtail ? "#1de98b" : "#4d7a96" }}>{isAvailableToCurtail ? f0(def.maxMW) : 0}</span>
                        <span style={{ fontSize: 10, color: "#2a5570" }}>MW</span>
                    </div>
                </div>
                <div style={{ borderLeft: `2px solid ${!reboundActive ? "#38c0fc" : "#f0455a"}`, paddingLeft: 8 }}>
                    <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 2 }}>REBOUND SURGE RISK</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 900, color: reboundActive ? "#f0455a" : pendingReboundMwh > 0 ? "#f5b222" : "#4d7a96" }}>
                            {pendingReboundMwh > 0 ? `+${f0(pendingReboundMwh / 0.5)}` : "0"}
                        </span>
                        <span style={{ fontSize: 10, color: "#2a5570" }}>MW FORCED CONSUMPTION</span>
                    </div>
                </div>
            </div>

            <div style={{ marginTop: "auto", background: reboundActive ? "#1f0709" : "#050e16", border: `1px solid ${reboundActive ? "#f0455a" : "#1a3045"}`, borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 8.5, color: reboundActive ? "#f0455a" : "#4d7a96", fontWeight: reboundActive ? 700 : 400 }}>
                    {reboundActive ? `⚠️ Forced to consume ${f0(pendingReboundMwh / 0.5)} MW right now to pay back deficit.` : pendingReboundMwh > 0 ? "You can voluntarily run negative physical target (consume) to pay back your Rebound Debt early." : "Ready for deployment."}
                </div>
            </div>
        </div>
    );

    // --- SECTION 3: MARKET BIDS ---
    const isDa = ["DA", "IDA1", "IDA2"].includes(phase);
    const isId = phase === "ID";
    const isBm = ["BM", "BM_OPEN", "REALTIME"].includes(phase);

    // Re-calculating the user constraints as they type.
    const sect3Bids = (
        <div style={{ flex: 1, background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h4 style={{ fontSize: 12, color: isDa ? "#f5b222" : isId ? "#38c0fc" : isBm ? "#1de98b" : "#b78bfa", letterSpacing: 1, textTransform: "uppercase" }}>
                    3. {isDa ? "DA Market Submission" : isId ? "Intraday Bilaterals" : isBm ? "Balancing Mechanism" : "Settlement Phase"}
                </h4>
                <div style={{ fontSize: 9, color: "#4d7a96", padding: "2px 6px", border: "1px solid #1a3045", borderRadius: 4 }}>
                    {isDa ? "DA" : isId ? "ID" : isBm ? "BM" : "SETTLED"}
                </div>
            </div>

            {isDa && (
                <>
                    {daAlreadyCleared ? (
                        <DAResultsTable
                            daAuctionResults={daAuctionResults}
                            daPositions={daPositions}
                            positions={positions}
                            pid={pid}
                            currentSp={sp}
                        />
                    ) : (
                        <>
                            <p style={{ fontSize: 9, color: "#4d7a96", marginBottom: 16, lineHeight: 1.5 }}>Schedule future factory demand drops. This creates a virtual generation volume.</p>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                                <button onClick={() => setDaMyBid(b => ({ ...b, side: "buy" }))} disabled={reboundActive} style={{ padding: "8px", background: daMyBid.side === "buy" ? "#38c0fc22" : "#102332", border: `1px solid ${daMyBid.side === "buy" ? "#38c0fc" : "#1a3045"}`, borderRadius: 6, color: daMyBid.side === "buy" ? "#38c0fc" : "#4d7a96", fontSize: 10, fontWeight: 800 }}>BUY (Consume More / Rebound)</button>
                                <button onClick={() => setDaMyBid(b => ({ ...b, side: "sell" }))} disabled={reboundActive} style={{ padding: "8px", background: daMyBid.side === "sell" ? "#1de98b22" : "#102332", border: `1px solid ${daMyBid.side === "sell" ? "#1de98b" : "#1a3045"}`, borderRadius: 6, color: daMyBid.side === "sell" ? "#1de98b" : "#4d7a96", fontSize: 10, fontWeight: 800 }}>SELL (Curtail Demand)</button>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "auto" }}>
                                <div>
                                    <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>VOLUME (MW)</label>
                                    <input type="number" max={def.maxMW} value={daMyBid.mw} disabled={reboundActive} onChange={e => setDaMyBid(b => ({ ...b, mw: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#ddeeff", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>PRICE LIMIT £/MWh</label>
                                    <input type="number" value={daMyBid.price} disabled={reboundActive} onChange={e => setDaMyBid(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#f5b222", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                                </div>
                            </div>
                            {reboundActive && daMyBid.side !== "buy" && (
                                <div style={{ fontSize: 8.5, color: "#f0455a", fontWeight: 700, padding: "6px 0", textAlign: "center" }}>⚠️ Rebound active: You physically MUST consume energy. Bidding to curtail is dangerous.</div>
                            )}
                            <button data-testid="dsr-submit-da" onClick={onDaSubmit} disabled={!daMyBid.price} style={{ marginTop: Math.max(0, 16 - (reboundActive && daMyBid.side !== "buy" ? 16 : 0)), width: "100%", padding: "12px", background: "#f5b222", border: "none", borderRadius: 6, color: "#050e16", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                                {daSubmitted ? "UPDATE DA SCHEDULE →" : "SUBMIT DA SCHEDULE →"}
                            </button>
                        </>
                    )}
                </>
            )}

            {isId && (
                <>
                    <p style={{ fontSize: 9, color: "#4d7a96", marginBottom: 8, lineHeight: 1.5 }}>Adjust factory schedule closer to delivery. Useful for triggering voluntary rebounds before BM.</p>
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
                                    <div style={{ fontSize: 7, color: "#4d7a96" }}>FLEX CAPACITY</div>
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
                        <button onClick={() => setIdMyOrder(b => ({ ...b, side: "buy" }))} disabled={idSubmitted || reboundActive} style={{ padding: "8px", background: idMyOrder.side === "buy" ? "#38c0fc22" : "#102332", border: `1px solid ${idMyOrder.side === "buy" ? "#38c0fc" : "#1a3045"}`, borderRadius: 6, color: idMyOrder.side === "buy" ? "#38c0fc" : "#4d7a96", fontSize: 10, fontWeight: 800 }}>BUY (Consume More / Rebound)</button>
                        <button onClick={() => setIdMyOrder(b => ({ ...b, side: "sell" }))} disabled={idSubmitted || reboundActive} style={{ padding: "8px", background: idMyOrder.side === "sell" ? "#1de98b22" : "#102332", border: `1px solid ${idMyOrder.side === "sell" ? "#1de98b" : "#1a3045"}`, borderRadius: 6, color: idMyOrder.side === "sell" ? "#1de98b" : "#4d7a96", fontSize: 10, fontWeight: 800 }}>SELL (Curtail Demand)</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "auto" }}>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>VOLUME (MW)</label>
                            <input type="number" value={idMyOrder.mw} disabled={idSubmitted || reboundActive} onChange={e => setIdMyOrder(b => ({ ...b, mw: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#ddeeff", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>PRICE LIMIT £/MWh</label>
                            <input type="number" value={idMyOrder.price} disabled={idSubmitted || reboundActive} onChange={e => setIdMyOrder(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#38c0fc", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                        </div>
                    </div>
                    {reboundActive && idMyOrder.side !== "buy" && (
                        <div style={{ fontSize: 8.5, color: "#f0455a", fontWeight: 700, padding: "6px 0", textAlign: "center" }}>⚠️ Rebound active: You physically MUST consume energy. Bidding to curtail is dangerous.</div>
                    )}
                    <button data-testid="dsr-submit-id" onClick={onIdSubmit} disabled={idSubmitted || !idMyOrder.price} style={{ marginTop: 16, width: "100%", padding: "12px", background: idSubmitted ? "#1a3045" : "#38c0fc", border: "none", borderRadius: 6, color: idSubmitted ? "#4d7a96" : "#050e16", fontWeight: 800, fontSize: 12, cursor: idSubmitted ? "default" : "pointer" }}>
                        {idSubmitted ? "✓ ID ORDER PUBLISHED" : "SUBMIT ID ORDER →"}
                    </button>
                </>
            )}

            {(isBm || (!isDa && !isId)) && (
                <>
                    <p style={{ fontSize: 9, color: "#4d7a96", marginBottom: 12, lineHeight: 1.5 }}>Balancing Mechanism. Final real-time flex. Rebound constraints strictly enforced after dispatch.</p>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                        <div style={{ flex: 1, background: isShort ? "#1f0709" : "#071f13", border: `1px solid ${isShort ? "#f0455a" : "#1de98b"}44`, borderRadius: 6, padding: "8px", textAlign: "center" }}>
                            <div style={{ fontSize: 9, color: isShort ? "#f0455a" : "#1de98b", fontWeight: 800 }}>{isShort ? "GRID SHORT: NESO SELLS (Asking you to consume)" : "GRID LONG: NESO BUYS (Asking you to curtail)"}</div>
                        </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "auto" }}>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>FLEX VOLUME (MW)</label>
                            <input data-testid="dsr-bm-mw" type="number" max={def.maxMW} value={myBid.mw} disabled={submitted || !isBm || reboundActive} onChange={e => setMyBid(b => ({ ...b, mw: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#ddeeff", fontSize: 14, fontFamily: "'JetBrains Mono'", borderColor: (myBid.mw > def.maxMW) ? "#f0455a" : "#234159" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>BID PRICE £/MWh</label>
                            <input data-testid="dsr-bm-price" type="number" value={myBid.price} placeholder={`~£${f0((isShort ? ssp * SYSTEM_PARAMS.bidStrategyMultipliers.dsrBM.sspMultiplier : sbp * SYSTEM_PARAMS.bidStrategyMultipliers.dsrBM.sbpMultiplier))}`} disabled={submitted || !isBm || reboundActive} onChange={e => setMyBid(b => ({ ...b, price: e.target.value, side: isShort ? "bid" : "offer" }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#1de98b", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                        </div>
                    </div>
                    {reboundActive && (
                        <div style={{ fontSize: 8.5, color: "#f0455a", fontWeight: 700, padding: "6px 0", textAlign: "center" }}>⛔ Forced Rebound Active ({(physicalState?.reboundSpsRemaining || 1) * 30} mins). All bidding locked until rebound complete.</div>
                    )}
                    {!isAvailableToCurtail && !reboundActive && isBm && !isShort && (
                        <div style={{ fontSize: 8.5, color: "#f0455a", fontWeight: 700, padding: "6px 0", textAlign: "center" }}>⛔ Max Duration Hit. Curtailment bids disabled.</div>
                    )}

                    <button data-testid="dsr-submit-bm" onClick={onSubmit} disabled={submitted || !isBm || reboundActive || (!isAvailableToCurtail && !isShort)} style={{ marginTop: 16, width: "100%", padding: "12px", background: submitted || !isBm || reboundActive || (!isAvailableToCurtail && !isShort) ? "#1a3045" : (isShort ? "#1de98b" : "#f5b222"), border: "none", borderRadius: 6, color: submitted || !isBm || reboundActive || (!isAvailableToCurtail && !isShort) ? "#4d7a96" : "#050e16", fontWeight: 800, fontSize: 12, cursor: submitted || !isBm || reboundActive || (!isAvailableToCurtail && !isShort) ? "default" : "pointer" }}>
                        {!isBm ? "AWAITING BM PHASE..." : submitted ? "✓ BM BID SUBMITTED" : (isShort ? "VOLUNTARY EARLIER PAYBACK →" : "OFFER CURTAILMENT →")}
                    </button>
                </>
            )}
        </div>
    );

    // --- SECTION 4: REAL-TIME SETTLEMENT & IMBALANCE ---
    const revenueRef = useRef(null);

    useEffect(() => {
        // Auto-scroll to revenue section when PID changes
        if (revenueRef.current) {
            revenueRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [pid]);

    const actualPhysical = contractPosition + (cSp.bmAccepted?.mw || 0) * (market?.actual?.isShort ? 1 : -1);

    const sect4RealTime = (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", height: "100%", background: "#050e16" }}>
            <h3 style={{ fontSize: 12, color: "#fff", marginBottom: 16, letterSpacing: 1 }}>4. REAL-TIME OPERATIONS & SETTLEMENT</h3>
            <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 16 }}>
                KPI: <strong style={{ color: "#f5b222" }}>Revenue/MW Curtailed</strong>
            </div>

            <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 8, padding: 16, marginBottom: 20, flex: 1, display: "flex", flexDirection: "column" }}>

                <Tip text="This section shows your contracted Physical Notification (PN) versus what the system enforces due to rebound/curtailment. Differences incur imbalance penalties.">
                    <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 8, borderBottom: "1px dashed #4d7a96", display: "inline-block", cursor: "help" }}>Delivery vs Physics Override</div>
                </Tip>

                <div style={{ fontSize: 9, color: "#2a5570", marginBottom: 20, lineHeight: 1.5 }}>
                    If you contract volume but your factory enters <b>Forced Rebound</b> constraint, the physics engine will override your target and force you to consume, resulting in severe Imbalance Penalties.
                </div>

                <div style={{ background: "#050e16", border: "1px solid #1a3045", borderRadius: 6, padding: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                    <Tip text="The volume you contracted for this period (PN).">
                        <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4 }}>CONTRACTED (PN)</div>
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 16, fontWeight: 800, color: contractPosition > 0 ? "#1de98b" : contractPosition < 0 ? "#38c0fc" : "#4d7a96" }}>
                                {contractPosition > 0 ? "+" : ""}{f0(contractPosition)} <span style={{ fontSize: 10 }}>MW</span>
                            </div>
                        </div>
                    </Tip>

                    <div style={{ fontSize: 14, color: "#2a5570" }}>VS</div>

                    <Tip text="The actual enforced physical target, after rebound or curtailment adjustments.">
                        <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4 }}>PHYSICAL TARGET</div>
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 16, fontWeight: 800, color: reboundActive ? "#f0455a" : "#ddeeff" }}>
                                {reboundActive ? `-${f0(pendingReboundMwh / 0.5)}` : `${actualPhysical > 0 ? "+" : ""}${f0(actualPhysical)}`} <span style={{ fontSize: 10 }}>MW</span>
                            </div>
                        </div>
                    </Tip>
                </div>

                <Tip text="System's physics engine decision: if forced rebound is active, expect imbalance penalties; otherwise safe.">
                    <div style={{ marginTop: "auto", textAlign: "center", paddingTop: 16, borderTop: "1px solid #1a3045" }}>
                        <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4 }}>PHYSICS SYSTEM DECISION</div>
                        {reboundActive ? (
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#f0455a", fontWeight: 900 }}>
                                REBOUND FORCED IMMINENT<br />
                                <span style={{ fontSize: 9, color: "#f5b222" }}>IF PN DIFFERS, EXPECT IMBALANCE ⚠️</span>
                            </div>
                        ) : (
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#1de98b", fontWeight: 900 }}>NO PHYSICAL FORCING (SAFE)</div>
                        )}
                    </div>
                </Tip>
            </div>

            <Tip text="Revenue summary from Day-Ahead market and total pushed to your ledger. Hover for explanations.">
                <div ref={revenueRef} style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 9, color: "#4d7a96", fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>REVENUE BREAKDOWN (Revenue/MW Curtailed)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        <Tip text="Revenue earned from your Day-Ahead bid.">
                            <div>
                                <div style={{ fontSize: 8, color: "#2a5570", marginBottom: 2 }}>DAY-AHEAD</div>
                                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#f5b222", fontWeight: 800 }}>£{f0(daCash || 0)}</div>
                            </div>
                        </Tip>
                        <Tip text="BM dispatch and imbalance settlement revenue.">
                            <div>
                                <div style={{ fontSize: 8, color: "#2a5570", marginBottom: 2 }}>BM / IMBALANCE</div>
                                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#38c0fc", fontWeight: 800 }}>£{f0(cash || 0)}</div>
                            </div>
                        </Tip>
                        <Tip text="Total revenue including Day-Ahead, Intraday, and BM settlements pushed to your ledger.">
                            <div>
                                <div style={{ fontSize: 8, color: "#2a5570", marginBottom: 2 }}>TOTAL LEDGER</div>
                                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: totalRev >= 0 ? "#1de98b" : "#f0455a", fontWeight: 800 }}>£{f0(totalRev)}</div>
                            </div>
                        </Tip>
                    </div>
                </div>
            </Tip>
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
