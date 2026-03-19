import React, { useState, useMemo } from 'react';
import SharedLayout from './SharedLayout';
import { SUPPLIERS, SP_DURATION_H } from '../../shared/constants';
import { Tip } from '../shared/Tip';
import MarketOverviewPanel from '../shared/MarketOverviewPanel';
import DAResultsTable from '../shared/DAResultsTable';
import DACurveSubmission from '../DACurveSubmission';

const f0 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 0 });
const f1 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 1 });

// --- REUSABLE MICRO-COMPONENTS ---
function MetricCard({ label, value, unit, color, tooltip }) {
    const card = (
        <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
            <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2, cursor: tooltip ? "help" : "default", borderBottom: tooltip ? "1px dashed #4d7a96" : "none", display: "inline-block" }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: color || "#ddeeff", fontWeight: 800 }}>
                {value}<span style={{ fontSize: 9, color: "#2a5570", marginLeft: 2 }}>{unit}</span>
            </div>
        </div>
    );
    return tooltip ? <Tip text={tooltip}>{card}</Tip> : card;
}

function PnlBlock({ label, valueFormat, color }) {
    return (
        <div>
            <div style={{ fontSize: 8, color: "#2a5570", marginBottom: 2 }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: color, fontWeight: 800 }}>{valueFormat}</div>
        </div>
    );
}

export default function SupplierScreen(props) {
    const {
        market, sp, msLeft, tickSpeed, phase, cash, assetKey,
        daMyBid, setDaMyBid, daSubmitted, onDaSubmit,
        idMyOrder, setIdMyOrder, idSubmitted, onIdSubmit,
        spContracts, pid, contractPosition,
        daOrderBook, daResult, idOrderBook, bmOrderBook, simRes, currentSp,
        positions, daPositions, daAuctionResults, daCurveSegments, onDaCurveSubmit, forecasts
    } = props;
    const daAlreadyCleared = daAuctionResults && daAuctionResults.prices && daAuctionResults.prices.length > 0;
    const [useAdvancedMode, setUseAdvancedMode] = useState(false); // Advanced curve mode for suppliers

    // Allow player to pick a supplier profile (defaults to BRITISH_GAS)
    const [supplierKey, setSupplierKey] = useState(assetKey && SUPPLIERS[assetKey] ? assetKey : "BRITISH_GAS");
    const sup = SUPPLIERS[supplierKey] || SUPPLIERS.BRITISH_GAS;

    const currentMkt = ["FORECAST", "DA", "IDA1", "IDA2", "ID"].includes(phase) ? market?.forecast : market?.actual;
    const sbp = currentMkt?.sbp || 50;
    const ssp = currentMkt?.ssp || 50;
    const hr = currentMkt?.hr ?? Math.floor((sp - 1) / 2);

    // --- DEMAND FORECAST with error ---
    // Prefer system-level demand (MW) when available; otherwise fall back
    // to the previous daily-curve approach. We allocate system demand to each
    // supplier proportional to its portfolio size.
    const baseDemandMw = useMemo(() => {
        const sysDemand = market?.forecast?.system?.demandMw || null;
        if (sysDemand !== null) {
            // compute total portfolio across all suppliers
            const totalPort = Object.values(SUPPLIERS).reduce((sum, s) => sum + (s.portfolioMw || 0), 0);
            const share = totalPort > 0 ? (sup.portfolioMw / totalPort) : 0;
            return Math.round(sysDemand * share);
        }
        // fallback: supplier-specific daily curve
        const peakFactor = 0.72 + 0.28 * (0.5 - 0.5 * Math.cos(((hr - 5) / 24) * 2 * Math.PI));
        return Math.round(sup.portfolioMw * peakFactor);
    }, [hr, sup.portfolioMw, market?.forecast?.system?.demandMw]);

    // Actual demand = base + random error (seeded on SP for determinism)
    const actualDemandMw = useMemo(() => {
        const seed = sp * 4321 + supplierKey.length * 17;
        const pseudoRand = (Math.sin(seed) * 10000) % 1;
        const errorMw = baseDemandMw * sup.forecastErrorPct * (pseudoRand * 2 - 1);
        return Math.round(baseDemandMw + errorMw);
    }, [sp, baseDemandMw, sup.forecastErrorPct, supplierKey]);

    // Hedging calculations
    const hedgeRatio = baseDemandMw > 0 ? Math.min(100, (contractPosition / baseDemandMw) * 100) : 0;
    const shortfall = Math.max(0, actualDemandMw - contractPosition);
    const surplus = Math.max(0, contractPosition - actualDemandMw);
    const imbalanceCost = shortfall > 0 ? shortfall * sbp * SP_DURATION_H : -(surplus * ssp * SP_DURATION_H);
    const retailRevenue = actualDemandMw * sup.retailTariff * SP_DURATION_H;
    const wholesaleCost = contractPosition * (daMyBid.price || sbp) * SP_DURATION_H;
    const estimatedMargin = retailRevenue - wholesaleCost - Math.abs(imbalanceCost);

    // Position Balance Scale (Retail Demand vs Contracted Supply)
    const retailDemandMw = baseDemandMw || 0;
    const contractedMw = Math.abs(contractPosition || 0);
    const exposureMw = retailDemandMw - contractedMw;
    const isBalanced = exposureMw === 0;

    // --- TOP RIGHT ---
    const systemMarket = market?.actual || market?.forecast || {};
    const sysWind = systemMarket.system?.windMw || 0;
    const sysSolar = systemMarket.system?.solarMw || 0;

    const topRight = (
        <div style={{ display: "flex", gap: 12 }}>
            <MetricCard
                label="FORECAST DEMAND"
                value={f0(baseDemandMw)}
                unit="MW"
                color="#f0455a"
                tooltip="The total power your retail customers are expected to consume based on the daily curve."
            />
            <MetricCard
                label="HEDGE %"
                value={f1(hedgeRatio)}
                unit="%"
                color={hedgeRatio >= 95 ? "#1de98b" : hedgeRatio >= 70 ? "#f5b222" : "#f0455a"}
                tooltip="How much of your Forecast Demand is currently covered by wholesale electricity contracts (DA + ID purchases)."
            />
            <MetricCard
                label="SYS WIND"
                value={f0(sysWind)}
                unit="MW"
                color="#a3e635"
                tooltip="Total system wind generation currently expected. Helps you anticipate merit order shifts."
            />
            <MetricCard
                label="SYS SOLAR"
                value={f0(sysSolar)}
                unit="MW"
                color="#fbbf24"
                tooltip="Total system solar generation currently expected. Useful for judging near term price direction."
            />
        </div>
    );

    // --- SECTION 1: SUPPLIER PROFILE ---
    const sect1Profile = (
        <div style={{ background: "#0c1c2a", border: `1px solid ${sup.col}55`, borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: sup.col, boxShadow: `0 0 10px ${sup.col}` }} />
            <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                <span>1. Supplier Profile</span>
                <span style={{ fontSize: 14 }}>{sup.emoji} {sup.name}</span>
            </div>

            {/* Supplier selector */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                {Object.values(SUPPLIERS).map(s => (
                    <button key={s.key} onClick={() => setSupplierKey(s.key)} style={{ padding: "4px 8px", background: supplierKey === s.key ? `${s.col}22` : "#050e16", border: `1px solid ${supplierKey === s.key ? s.col : "#1a3045"}`, borderRadius: 4, color: supplierKey === s.key ? s.col : "#4d7a96", fontSize: 8, fontWeight: 700, cursor: "pointer" }}>{s.short}</button>
                ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                <MetricCard label="PORTFOLIO SIZE" value={f0(sup.portfolioMw)} unit="MW" color={sup.col} />
                <MetricCard label="RETAIL TARIFF" value={`£${sup.retailTariff}`} unit="/MWh" color="#f5b222" />
                <MetricCard label="FORECAST ERROR" value={`±${f1(sup.forecastErrorPct * 100)}`} unit="%" color="#f0455a" />
            </div>
            <div style={{ fontSize: 8.5, color: "#4d7a96", marginTop: "auto", paddingTop: 8, lineHeight: 1.5 }}>{sup.desc}</div>
        </div>
    );

    // --- SECTION 2: DEMAND FORECASTING & LIVE STATUS ---
    const sect2Demand = (
        <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase" }}>2. Customer Demand & Hedging</div>

            {/* Existing demand / hedge insight */}
            <div style={{ marginBottom: 4, background: "#050e16", padding: "8px 12px", border: `1px solid #1a3045`, borderRadius: 6 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1px 1fr", gap: 12 }}>
                    <div>
                        <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>FORECAST DEMAND</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 14, color: "#ddeeff", fontWeight: 800 }}>{f0(baseDemandMw)} MW</div>
                        <div style={{ fontSize: 8, color: "#2a5570" }}>Based on day profile</div>
                    </div>
                    <div style={{ background: "#1a3045" }} />
                    <div>
                        <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>ACTUAL DEMAND (REVEALED)</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 14, color: ["SETTLED","RESULTS","BM","BM_OPEN","BM_CLOSE","REALTIME"].includes(phase) ? (actualDemandMw > baseDemandMw ? "#f0455a" : "#1de98b") : "#4d7a96", fontWeight: 800 }}>
                            {["SETTLED","RESULTS","BM","BM_OPEN","BM_CLOSE","REALTIME"].includes(phase) ? `${f0(actualDemandMw)} MW` : "? ? ?"}
                        </div>
                        <div style={{ fontSize: 8, color: "#2a5570" }}>{["FORECAST","DA","IDA1","IDA2","ID"].includes(phase) ? "Revealed at BM phase" : `Error: ${actualDemandMw > baseDemandMw ? "+" : ""}${f0(actualDemandMw - baseDemandMw)}MW`}</div>
                    </div>
                </div>
            </div>

            {/* New visual Position Balance Scale */}
            <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 9, color: "#4d7a96", textTransform: "uppercase", marginBottom: 12, letterSpacing: 1 }}>
                    Position Balance Scale
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                    {/* Retail Demand Bar */}
                    <div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#2a5570", marginBottom: 4 }}>
                            <span>RETAIL DEMAND</span>
                            <span style={{ fontFamily: "'JetBrains Mono'", color: "#ddeeff" }}>{f0(retailDemandMw)} MW</span>
                        </div>
                        <div style={{ height: 12, background: "#1a3045", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: "100%", background: "#4d7a96" }} />
                        </div>
                    </div>

                    {/* Contracted Supply Bar */}
                    <div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#2a5570", marginBottom: 4 }}>
                            <span>CONTRACTED SUPPLY (DA + ID)</span>
                            <span style={{ fontFamily: "'JetBrains Mono'", color: "#ddeeff" }}>{f0(contractedMw)} MW</span>
                        </div>
                        <div style={{ height: 12, background: "#1a3045", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{
                                height: "100%",
                                width: `${retailDemandMw > 0 ? Math.min(100, (contractedMw / retailDemandMw) * 100) : 0}%`,
                                background: contractedMw >= retailDemandMw ? "#1de98b" : "#f5b222",
                                transition: "width 0.3s ease-in-out"
                            }} />
                        </div>
                    </div>
                </div>

                {/* Exposure Warning Banner */}
                <div style={{
                    background: isBalanced ? "#071f13" : "#1f0709",
                    border: `1px solid ${isBalanced ? "#1de98b44" : "#f0455a44"}`,
                    borderRadius: 6, padding: "8px 12px", textAlign: "center"
                }}>
                    <div style={{ fontSize: 8, color: isBalanced ? "#1de98b" : "#f0455a", marginBottom: 2 }}>
                        {isBalanced ? "✓ PERFECTLY HEDGED" : "⚠ IMBALANCE EXPOSURE"}
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 16, fontWeight: 900, color: isBalanced ? "#1de98b" : "#f0455a" }}>
                        {isBalanced ? "0 MW" : `${exposureMw > 0 ? "SHORT" : "LONG"} ${f0(Math.abs(exposureMw))} MW`}
                    </div>
                    {!isBalanced && (
                        <div style={{ fontSize: 8, color: "#f0455a88", marginTop: 4 }}>
                            You will be forced to {exposureMw > 0 ? "buy shortfall at SBP" : "sell excess at SSP"}
                        </div>
                    )}
                </div>
            </div>

            {/* Hedge ratio + exposure metrics */}
            <Tip text="Strive for 100% hedge to minimize imbalance risk. Being under-hedged forces you to buy missing power at real-time System Buy Prices (often very high).">
                <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#4d7a96", marginBottom: 4, cursor: "help" }}>
                        <span style={{ borderBottom: "1px dashed #4d7a96" }}>HEDGE RATIO</span>
                        <span style={{ color: hedgeRatio >= 95 ? "#1de98b" : hedgeRatio >= 70 ? "#f5b222" : "#f0455a", fontWeight: 800 }}>{f1(hedgeRatio)}%</span>
                    </div>
                    <div style={{ height: 12, background: "#1f0709", borderRadius: 6, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, hedgeRatio))}%`, background: hedgeRatio >= 95 ? "#1de98b" : hedgeRatio >= 70 ? "#f5b222" : "#f0455a", transition: "width 0.3s", borderRadius: 6 }} />
                    </div>
                </div>
            </Tip>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: "auto" }}>
                <MetricCard
                    label="UNDER-HEDGED EXPOSURE"
                    value={f0(shortfall)}
                    unit="MW"
                    color={shortfall > 0 ? "#f0455a" : "#4d7a96"}
                    tooltip="Missing energy volume you must buy from NESO during settlement. Highly penalized if SBP is elevated."
                />
                <MetricCard
                    label="OVER-HEDGED SURPLUS"
                    value={f0(surplus)}
                    unit="MW"
                    color={surplus > 0 ? "#38c0fc" : "#4d7a96"}
                />
            </div>
        </div>
    );

    // --- SECTION 3: PROCUREMENT ---
    const isDa = ["DA", "IDA1", "IDA2"].includes(phase);
    const isId = phase === "ID";

    const sect3Procurement = (
        <div style={{ flex: 1, background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h4 style={{ fontSize: 12, color: isDa ? "#f5b222" : isId ? "#38c0fc" : "#b78bfa", letterSpacing: 1, textTransform: "uppercase" }}>
                    3. {isDa ? "Day-Ahead Baseload Purchase" : isId ? "Intraday Adjustment" : "Settlement Phase"}
                </h4>
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <p style={{ fontSize: 9, color: "#4d7a96", lineHeight: 1.5, margin: 0, flex: 1 }}>Buy baseload to cover your forecast demand of <b>{f0(baseDemandMw)} MW</b>. Actual demand will deviate by ±{f1(sup.forecastErrorPct * 100)}%. Under-hedging is extremely risky if SBP spikes.</p>
                                <button onClick={() => setUseAdvancedMode(m => !m)} style={{ padding: '3px 8px', background: '#0c1c2a', border: '1px solid #1a3045', borderRadius: 4, color: '#4d7a96', fontSize: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                    {useAdvancedMode ? 'Simple Mode' : 'Advanced Mode'}
                                </button>
                            </div>
                            {useAdvancedMode ? (
                                <DACurveSubmission
                                    onSubmit={onDaCurveSubmit}
                                    forecastPrices={(forecasts || []).map(f => f?.price || 55)}
                                    initialSegments={daCurveSegments || undefined}
                                    assetMaxMW={sup.portfolioMw || 1000}
                                    daSubmitted={daSubmitted}
                                />
                            ) : (
                                <>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "auto" }}>
                                        <div>
                                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>BUY VOLUME (MW)</label>
                                            <input type="number" placeholder={f0(baseDemandMw)} value={daMyBid.mw} disabled={!isDa} onChange={e => setDaMyBid(b => ({ ...b, mw: e.target.value, side: "buy" }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#ddeeff", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>MAX PRICE £/MWh</label>
                                            <input type="number" value={daMyBid.price} disabled={!isDa} onChange={e => setDaMyBid(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#f5b222", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                                        </div>
                                    </div>
                                    {daMyBid.mw && daMyBid.mw < baseDemandMw * 0.9 && (
                                        <div style={{ fontSize: 8.5, color: "#f0455a", fontWeight: 700, padding: "6px 0", textAlign: "center" }}>⚠️ Under-hedging! You're only buying {f1((daMyBid.mw / baseDemandMw) * 100)}% of your forecast demand.</div>
                                    )}
                                    <button data-testid="sup-submit-da" onClick={() => { setDaMyBid(b => ({ ...b, side: "buy" })); onDaSubmit(); }} disabled={!isDa || !daMyBid.price} style={{ marginTop: 16, width: "100%", padding: "12px", background: !isDa ? "#1a3045" : "#f5b222", border: "none", borderRadius: 6, color: !isDa ? "#4d7a96" : "#050e16", fontWeight: 800, fontSize: 12, cursor: !isDa ? "default" : "pointer" }}>
                                        {!isDa ? "AWAITING DA PHASE..." : daSubmitted ? "UPDATE DA PURCHASE →" : "SUBMIT DA PURCHASE →"}
                                    </button>
                                </>
                            )}
                        </>
                    )}
                </>
            )}

            {isId && (
                <>
                    <p style={{ fontSize: 9, color: "#4d7a96", marginBottom: 8, lineHeight: 1.5 }}>Adjust your position closer to delivery. Weather changed? Hedge gap discovered? Fix it now before BM.</p>
                    {/* Position & hedge banner */}
                    {(() => {
                        const daPurchase = Math.abs(daPositions?.[sp - 1] || 0);
                        const hedgeGap = Math.max(0, baseDemandMw - Math.abs(contractPosition));
                        return (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
                                <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 5, padding: "6px 8px", textAlign: "center" }}>
                                    <div style={{ fontSize: 7, color: "#4d7a96" }}>DA PURCHASE</div>
                                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, fontWeight: 800, color: "#f5b222" }}>{f0(daPurchase)}MW</div>
                                </div>
                                <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 5, padding: "6px 8px", textAlign: "center" }}>
                                    <div style={{ fontSize: 7, color: "#4d7a96" }}>FORECAST DEMAND</div>
                                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, fontWeight: 800, color: "#ddeeff" }}>{f0(baseDemandMw)}MW</div>
                                </div>
                                <div style={{ background: hedgeGap > 0 ? "#f0455a11" : "#1de98b11", border: `1px solid ${hedgeGap > 0 ? "#f0455a33" : "#1de98b33"}`, borderRadius: 5, padding: "6px 8px", textAlign: "center" }}>
                                    <div style={{ fontSize: 7, color: "#4d7a96" }}>HEDGE GAP</div>
                                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, fontWeight: 800, color: hedgeGap > 0 ? "#f0455a" : "#1de98b" }}>{hedgeGap > 0 ? `${f0(hedgeGap)}MW` : "HEDGED"}</div>
                                </div>
                            </div>
                        );
                    })()}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <button onClick={() => setIdMyOrder(b => ({ ...b, side: "buy" }))} disabled={idSubmitted} style={{ padding: "8px", background: idMyOrder.side === "buy" ? "#38c0fc22" : "#102332", border: `1px solid ${idMyOrder.side === "buy" ? "#38c0fc" : "#1a3045"}`, borderRadius: 6, color: idMyOrder.side === "buy" ? "#38c0fc" : "#4d7a96", fontSize: 10, fontWeight: 800 }}>BUY MORE (Under-hedged)</button>
                        <button onClick={() => setIdMyOrder(b => ({ ...b, side: "sell" }))} disabled={idSubmitted} style={{ padding: "8px", background: idMyOrder.side === "sell" ? "#f0455a22" : "#102332", border: `1px solid ${idMyOrder.side === "sell" ? "#f0455a" : "#1a3045"}`, borderRadius: 6, color: idMyOrder.side === "sell" ? "#f0455a" : "#4d7a96", fontSize: 10, fontWeight: 800 }}>SELL EXCESS (Over-hedged)</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "auto" }}>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>VOLUME (MW)</label>
                            <input type="number" value={idMyOrder.mw} disabled={idSubmitted || !isId} onChange={e => setIdMyOrder(b => ({ ...b, mw: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#ddeeff", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>PRICE LIMIT £/MWh</label>
                            <input type="number" value={idMyOrder.price} disabled={idSubmitted || !isId} onChange={e => setIdMyOrder(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#38c0fc", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                        </div>
                    </div>
                    <button data-testid="sup-submit-id" onClick={onIdSubmit} disabled={idSubmitted || !isId || !idMyOrder.price} style={{ marginTop: 16, width: "100%", padding: "12px", background: idSubmitted || !isId ? "#1a3045" : "#38c0fc", border: "none", borderRadius: 6, color: idSubmitted || !isId ? "#4d7a96" : "#050e16", fontWeight: 800, fontSize: 12, cursor: idSubmitted || !isId ? "default" : "pointer" }}>
                        {!isId ? "AWAITING ID PHASE..." : idSubmitted ? "✓ ORDER PUBLISHED" : "SUBMIT ID ORDER →"}
                    </button>
                </>
            )}

            {!isDa && !isId && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 24 }}>⏳</div>
                    <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 700 }}>GATE CLOSED — Awaiting Settlement</div>
                    <div style={{ fontSize: 9, color: "#2a5570" }}>Any unhedged demand will be settled at SBP/SSP.</div>
                </div>
            )}
        </div>
    );

    // --- MARKET OVERVIEW ---
    const sectMarket = (
        <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", minHeight: 250 }}>
            <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 12 }}>Market Overview ({phase})</div>
            <div style={{ flex: 1, position: "relative" }}>
                <MarketOverviewPanel
                    phase={phase}
                    daOrderBook={daOrderBook}
                    daResult={daResult}
                    idOrderBook={idOrderBook}
                    spContracts={spContracts}
                    currentSp={currentSp}
                    msLeft={msLeft}
                    tickSpeed={tickSpeed}
                    bmOrderBook={bmOrderBook}
                    market={market}
                    simRes={simRes}
                />
            </div>
        </div>
    );

    // --- SECTION 4: REAL-TIME SETTLEMENT ---
    const sect4Settlement = (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", height: "100%", background: "#050e16" }}>
            <h3 style={{ fontSize: 12, color: "#fff", marginBottom: 8, letterSpacing: 1 }}>4. P&L & IMBALANCE</h3>
            <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 16 }}>
                KPI: <strong style={{ color: "#38c0fc" }}>Cost/MWh</strong>
            </div>

            <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>Retail Revenue vs Wholesale Cost</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <PnlBlock label="RETAIL REVENUE (TARIFF)" valueFormat={`+£${f0(retailRevenue)}`} color="#1de98b" />
                    <PnlBlock label="WHOLESALE COST" valueFormat={`-£${f0(wholesaleCost)}`} color="#f0455a" />
                </div>
            </div>

            <div style={{ background: shortfall > 0 ? "#2a0f12" : surplus > 0 ? "#0f1f2a" : "#0f2018", border: `1px solid ${shortfall > 0 ? "#f0455a" : surplus > 0 ? "#38c0fc" : "#1de98b"}`, borderRadius: 8, padding: 16, flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 10, color: shortfall > 0 ? "#f0455a" : "#1de98b", fontWeight: 800, marginBottom: 12 }}>
                    {shortfall > 0 ? "⚠ IMBALANCE: SHORT POSITION" : surplus > 0 ? "📊 OVER-HEDGED (SELLING SURPLUS)" : "✓ PERFECTLY HEDGED"}
                </div>

                {shortfall > 0 && (
                    <div style={{ fontSize: 9, color: "#f0455a99", lineHeight: 1.5, marginBottom: 12 }}>
                        Your customers consumed <b>{f0(actualDemandMw)} MW</b> but you only purchased <b>{f0(contractPosition)} MW</b>.
                        The shortfall of <b>{f0(shortfall)} MW</b> is settled at System Buy Price (£{f0(sbp)}/MWh).
                    </div>
                )}
                {surplus > 0 && (
                    <div style={{ fontSize: 9, color: "#38c0fc99", lineHeight: 1.5, marginBottom: 12 }}>
                        You purchased <b>{f0(contractPosition)} MW</b> but customers only consumed <b>{f0(actualDemandMw)} MW</b>.
                        Your excess <b>{f0(surplus)} MW</b> is sold back at System Sell Price (£{f0(ssp)}/MWh).
                    </div>
                )}

                <div style={{ marginTop: "auto", borderTop: "1px solid #1a3045", paddingTop: 12 }}>
                    <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4 }}>IMBALANCE COST</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 16, color: imbalanceCost > 0 ? "#1de98b" : "#f0455a", fontWeight: 900 }}>
                        {imbalanceCost >= 0 ? "+" : ""}£{f0(imbalanceCost)}
                    </div>
                </div>
            </div>

            <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: 12, marginTop: 16 }}>
                <div style={{ fontSize: 9, color: "#4d7a96", fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>ESTIMATED GROSS MARGIN</div>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, color: estimatedMargin >= 0 ? "#1de98b" : "#f0455a", fontWeight: 900 }}>
                    {estimatedMargin >= 0 ? "+" : ""}£{f0(estimatedMargin)}
                </div>
                <div style={{ fontSize: 8, color: "#2a5570", marginTop: 4 }}>= Retail Revenue – Wholesale Cost – Imbalance</div>
            </div>

            {spHistory && spHistory.length > 0 && (() => {
                const last = spHistory[0];
                const demandError = actualDemandMw - baseDemandMw;
                const demandErrorLabel = demandError === 0 ? "On target" : demandError > 0 ? `Higher by ${f0(demandError)} MW` : `Lower by ${f0(Math.abs(demandError))} MW`;

                return (
                    <div style={{ marginTop: 20, padding: 12, background: "#071926", border: "1px solid #1a3045", borderRadius: 8 }}>
                        <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, marginBottom: 8 }}>POST-SP REVIEW</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 10, color: "#ddeeff" }}>
                            <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 4, padding: 10 }}>
                                <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4 }}>DEMAND vs PURCHASE</div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                                    <span>Forecast demand</span>
                                    <span>{f0(baseDemandMw)} MW</span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: 4 }}>
                                    <span>Actual demand</span>
                                    <span>{f0(actualDemandMw)} MW</span>
                                </div>
                                <div style={{ marginTop: 8, fontSize: 9, color: demandError === 0 ? "#1de98b" : "#f5b222" }}>{demandErrorLabel}</div>
                            </div>

                            <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 4, padding: 10 }}>
                                <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4 }}>SETTLEMENT</div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                                    <span>Imbalance cost</span>
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
        </div>
    );

    const centerCol = (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", paddingBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {sect1Profile}
                {sect2Demand}
            </div>
            {sectMarket}
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                {sect3Procurement}
            </div>
        </div>
    );

    return (
        <SharedLayout
            {...props}
            roleName={sup.name}
            topRight={topRight}
            center={<div style={{ height: "100%", paddingRight: 16 }}>{centerCol}</div>}
            right={sect4Settlement}
        />
    );
}
