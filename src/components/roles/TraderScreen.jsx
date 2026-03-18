import React, { useState, useMemo } from 'react';
import SharedLayout from './SharedLayout';
import { Tip } from '../shared/Tip';
import { SYSTEM_PARAMS } from '../../shared/constants';
import MarketOverviewPanel from '../shared/MarketOverviewPanel';
import DACurveSubmission from '../DACurveSubmission';

const f0 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 0 });

const getPosColor = pos => pos > 0 ? "#1de98b" : pos < 0 ? "#f0455a" : "#ddeeff";
const getPosText = pos => pos > 0 ? `LONG ${f0(pos)}` : pos < 0 ? `SHORT ${f0(Math.abs(pos))}` : "FLAT";

const Panel = ({ children, borderColor = "#1a3045", bg = "#0c1c2a", style }) => (
    <div style={{ background: bg, border: `1px solid ${borderColor}`, borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", ...style }}>
        {children}
    </div>
);

const DataLabel = ({ label, value, valueColor = "#ddeeff", tooltip }) => {
    const content = (
        <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 7.5, color: "#4d7a96", borderBottom: tooltip ? "1px dashed #4d7a96" : "none", cursor: tooltip ? "help" : "default" }}>{label}</span>
            <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: valueColor }}>{value}</span>
        </div>
    );
    const box = <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", padding: "4px 8px", borderRadius: 4 }}>{content}</div>;
    return tooltip ? <Tip text={tooltip}>{box}</Tip> : box;
};

const ActionButton = ({ onClick, disabled, active, activeBg, activeBorder, activeColor, inactiveBg = "#102332", inactiveBorder = "#1a3045", inactiveColor = "#4d7a96", label, ariaLabel }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel || label}
        style={{
            padding: "10px",
            background: active ? activeBg : inactiveBg,
            border: `1px solid ${active ? activeBorder : inactiveBorder}`,
            borderRadius: 6,
            color: active ? activeColor : inactiveColor,
            fontSize: 12,
            fontWeight: 800,
            cursor: disabled ? "default" : "pointer",
            flex: 1
        }}>
        {label}
    </button>
);

function Sparkline({ data, color = "#38bdf8", fill = false, height = 40, width = 280, maxVal }) {
    if (!data || data.length < 2) return null;
    const min = 0, max = maxVal || Math.max(...data) * 1.1 || 1;
    const range = max - min || 1;
    const pts = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((v - min) / range) * (height - 4) - 2;
        return `${x},${y}`;
    });
    const polyline = pts.join(" ");
    const area = `${pts[0].split(",")[0]},${height} ${polyline} ${pts[pts.length - 1].split(",")[0]},${height}`;
    return (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ overflow: "visible", display: "block", marginTop: 4 }}>
            {fill && <polygon points={area} fill={color} opacity={0.15} />}
            <polyline points={polyline} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
        </svg>
    );
}

export default function TraderScreen(props) {
    const {
        market, sp, msLeft, tickSpeed, phase,
        daMyBid, setDaMyBid, daSubmitted, onDaSubmit,
        idMyOrder, setIdMyOrder, idSubmitted, onIdSubmit,
        spContracts, pid, cash, contractPosition,
        forecasts, publishedForecast, daOrderBook, daResult, idOrderBook, bmOrderBook, simRes, currentSp,
        daCurveSegments, onDaCurveSubmit
    } = props;

    const [tab, setTab] = useState("DA");
    const [useExpertMode, setUseExpertMode] = useState(false); // Expert curve mode for traders

    const currentPos = contractPosition || 0;

    // Margin calculation: Starting cash + P&L + bonus from SYSTEM_PARAMS
    const margin = cash + SYSTEM_PARAMS.traderStartCapitalBonus;
    const marginFloor = 1000;
    const marginHeadroom = Math.max(0, margin - marginFloor);
    const marginPct = Math.min(100, (margin / 5000) * 100);

    const topRight = (
        <div style={{ display: "flex", gap: 12 }}>
            <DataLabel
                label={`NET POS (SP${sp})`}
                value={`${getPosText(currentPos)} MW`}
                valueColor={getPosColor(currentPos)}
                tooltip="LONG = Profits if prices rise. SHORT = Profits if prices fall."
            />
            <DataLabel
                label="AVAILABLE MARGIN"
                value={`£${f0(margin)}`}
                valueColor={margin > SYSTEM_PARAMS.marginWarningThreshold ? "#b78bfa" : "#f0455a"}
                tooltip="Your cash buffer. Running out of margin means liquidation."
            />
        </div>
    );

    const left = (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
            {/* Giant position indicator */}
            <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 8, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#4d7a96", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Net Open Position</div>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 28, fontWeight: 900, color: currentPos > 0 ? "#1de98b" : currentPos < 0 ? "#f0455a" : "#ddeeff" }}>
                    {currentPos > 0 ? `LONG ${f0(currentPos)} MW` : currentPos < 0 ? `SHORT ${f0(Math.abs(currentPos))} MW` : "FLAT"}
                </div>
            </div>

            {/* Existing active position context */}
            <Panel borderColor={currentPos > 0 ? "#1de98b" : currentPos < 0 ? "#f0455a" : "#1a3045"}>
                <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4, letterSpacing: 1, textTransform: "uppercase" }}>Active Position (SP{sp})</div>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 24, fontWeight: 900, color: getPosColor(currentPos) }}>
                    {f0(Math.abs(currentPos))} MW {currentPos > 0 ? "LONG" : currentPos < 0 ? "SHORT" : "FLAT"}
                </div>
                {currentPos !== 0 && (
                    <div style={{ marginTop: 12, fontSize: 9, color: currentPos > 0 ? "#1de98b" : "#f0455a", background: currentPos > 0 ? "#1de98b22" : "#f0455a22", padding: 8, borderRadius: 4 }}>
                        {currentPos > 0
                            ? "You own power. You need the System Sell Price (SSP) to be high to profit."
                            : "You sold power you don't have. You need the System Buy Price (SBP) to be low to profit."}
                    </div>
                )}
            </Panel>

            {/* Margin floor proximity bar */}
            <div style={{ marginTop: 4, padding: "12px", background: "#050e16", borderRadius: 6, border: "1px solid #1a3045" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#2a5570", marginBottom: 6 }}>
                    <span>MARGIN FLOOR (£{marginFloor})</span>
                    <span style={{ color: margin <= marginFloor * 1.5 ? "#f0455a" : "#1de98b", fontWeight: 700 }}>
                        £{f0(marginHeadroom)} HEADROOM
                    </span>
                </div>
                <div style={{ height: 8, background: "#1a3045", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                        height: "100%",
                        width: `${Math.max(5, marginPct)}%`,
                        background: margin <= marginFloor * 1.2 ? "#f0455a" : margin <= marginFloor * 1.5 ? "#f5b222" : "#1de98b",
                        transition: "width 0.3s, background 0.3s"
                    }} />
                </div>
            </div>

            <Panel bg="#08141f" style={{ flex: 1, overflowY: "auto" }}>
                <h3 style={{ fontSize: 10, color: "#4d7a96", marginBottom: 12, letterSpacing: 1 }}>LIVE NESO FORECAST</h3>

                {publishedForecast && publishedForecast.demand ? (
                    <>
                        <Tip text="Predicted system-wide demand curve. High demand may lead to higher prices.">
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 9, color: "#38bdf8", fontWeight: "bold", display: "flex", justifyContent: "space-between", cursor: "help" }}>
                                    <span>DEMAND (48 SP)</span>
                                    <span>Current: {f0(publishedForecast.demand[(sp - 1) % 48])} MW</span>
                                </div>
                                <Sparkline data={publishedForecast.demand} color="#38bdf8" maxVal={60000} fill />
                            </div>
                        </Tip>
                        <Tip text="Predicted wind generation. High wind usually means cheaper prices.">
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 9, color: "#22d3ee", fontWeight: "bold", display: "flex", justifyContent: "space-between", cursor: "help" }}>
                                    <span>WIND OUTPUT</span>
                                    <span>Current: {f0(publishedForecast.wind[(sp - 1) % 48])} MW</span>
                                </div>
                                <Sparkline data={publishedForecast.wind} color="#22d3ee" maxVal={30000} fill />
                            </div>
                        </Tip>
                    </>
                ) : (
                    <div style={{ fontSize: 10, color: "#2a5570", fontStyle: "italic", textAlign: "center", marginTop: 20 }}>Waiting for NESO publication...</div>
                )}

                <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #1a3045" }}>
                    <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 8, fontWeight: "bold" }}>UPCOMING SPREADS</div>
                    {forecasts && forecasts.map((f, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, padding: "4px 8px", background: "#0c1c2a", borderRadius: 4, borderLeft: `2px solid ${f.isShort ? "#f0455a" : "#1de98b"}` }}>
                            <span style={{ fontSize: 9, color: "#ddeeff" }}>SP{f.sp}</span>
                            <span style={{ fontSize: 9, fontWeight: "bold", color: f.isShort ? "#f0455a" : "#1de98b" }}>{f.isShort ? "SHORT" : "LONG"} {f0(Math.abs(f.niv))}</span>
                            <span style={{ fontSize: 9, color: "#f5b222", fontFamily: "'JetBrains Mono'" }}>£{f.priceLo}-{f.priceHi}</span>
                        </div>
                    ))}
                </div>
            </Panel>
        </div>
    );

    const center = (
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexShrink: 0 }}>
                <button onClick={() => setTab("DA")} style={{ flex: 1, padding: "8px", background: tab === "DA" ? "#f5b22222" : "#0c1c2a", border: `1px solid ${tab === "DA" ? "#f5b222" : "#1a3045"}`, borderRadius: 6, color: tab === "DA" ? "#f5b222" : "#4d7a96", fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all .15s" }}>DAY-AHEAD</button>
                <button onClick={() => setTab("ID")} style={{ flex: 1, padding: "8px", background: tab === "ID" ? "#38c0fc22" : "#0c1c2a", border: `1px solid ${tab === "ID" ? "#38c0fc" : "#1a3045"}`, borderRadius: 6, color: tab === "ID" ? "#38c0fc" : "#4d7a96", fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all .15s" }}>INTRADAY</button>
            </div>

            <Panel bg="#08141f" style={{ flex: 1, display: "flex", overflow: "hidden" }}>
                {tab === "DA" && (
                    <>
                        <div style={{ flexShrink: 0 }}>
                            <h4 style={{ fontSize: 12, color: "#f5b222", marginBottom: 4, letterSpacing: 1 }}>📈 INITIAL SPECULATION</h4>
                            <p style={{ fontSize: 9, color: "#4d7a96", marginBottom: 16, lineHeight: 1.4 }}>Take a purely financial view on the market before physical delivery.</p>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                                <ActionButton onClick={() => setDaMyBid(b => ({ ...b, side: "buy" }))} disabled={!["DA","IDA1","IDA2"].includes(phase)} active={daMyBid.side === "buy"} activeBg="#1de98b22" activeBorder="#1de98b" activeColor="#1de98b" label="BUY (Go Long)" />
                                <ActionButton onClick={() => setDaMyBid(b => ({ ...b, side: "sell" }))} disabled={!["DA","IDA1","IDA2"].includes(phase)} active={daMyBid.side === "sell"} activeBg="#f0455a22" activeBorder="#f0455a" activeColor="#f0455a" label="SELL (Go Short)" />
                            </div>

                            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4, display: "block" }}>VOLUME (MW)</label>
                                    {/* Pre-trade margin check: Calculate max safe volume */}
                                    {useMemo(() => {
                                        const priceLimit = parseFloat(daMyBid.price) || 50;
                                        const maxSafeMW = Math.floor(margin / (priceLimit * 0.5));
                                        const currentMW = parseFloat(daMyBid.mw) || 0;
                                        const exceedsMargin = currentMW > maxSafeMW && daMyBid.mw !== "";

                                        return (
                                            <>
                                                <input
                                                    type="number"
                                                    value={daMyBid.mw}
                                                    disabled={!["DA","IDA1","IDA2"].includes(phase)}
                                                    onChange={e => setDaMyBid(b => ({ ...b, mw: e.target.value }))}
                                                    style={{
                                                        width: "100%",
                                                        padding: "8px",
                                                        background: "#102332",
                                                        border: `1px solid ${exceedsMargin ? "#f0455a" : "#234159"}`,
                                                        borderRadius: 6,
                                                        color: "#ddeeff",
                                                        fontSize: 14,
                                                        fontFamily: "'JetBrains Mono'"
                                                    }}
                                                />
                                                {exceedsMargin && (
                                                    <div style={{ fontSize: 8, color: "#f0455a", marginTop: 4, fontWeight: 700 }}>
                                                        ⚠️ Exceeds margin! Max: {f0(maxSafeMW)} MW
                                                    </div>
                                                )}
                                            </>
                                        );
                                    }, [daMyBid.mw, daMyBid.price, margin])}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4, display: "block" }}>PRICE LIMIT £/MWh</label>
                                    <input type="number" value={daMyBid.price} disabled={!["DA","IDA1","IDA2"].includes(phase)} onChange={e => setDaMyBid(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "8px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#f5b222", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                                </div>
                            </div>

                            <button onClick={onDaSubmit} disabled={!["DA","IDA1","IDA2"].includes(phase) || !daMyBid.price || (() => { const priceLimit = parseFloat(daMyBid.price) || 50; const maxSafeMW = Math.floor(margin / (priceLimit * 0.5)); const currentMW = parseFloat(daMyBid.mw) || 0; return currentMW > maxSafeMW && daMyBid.mw !== ""; })()} style={{ width: "100%", padding: "12px", background: !["DA","IDA1","IDA2"].includes(phase) ? "#1a3045" : "#f5b222", border: "none", borderRadius: 8, color: !["DA","IDA1","IDA2"].includes(phase) ? "#4d7a96" : "#050e16", fontWeight: 900, fontSize: 12, cursor: !["DA","IDA1","IDA2"].includes(phase) ? "default" : "pointer", marginBottom: 16 }}>
                                {!["DA","IDA1","IDA2"].includes(phase) ? "AWAITING DA PHASE..." : daSubmitted ? "UPDATE POSITION →" : "SUBMIT SPECULATIVE POSITION →"}
                            </button>
                        </div>

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
                    </>
                )}

                {tab === "ID" && (
                    <>
                        <div style={{ flexShrink: 0 }}>
                            <h4 style={{ fontSize: 12, color: "#38c0fc", marginBottom: 4, letterSpacing: 1 }}>🔄 INTRADAY ADJUSTMENT</h4>
                            <p style={{ fontSize: 9, color: "#4d7a96", marginBottom: 16, lineHeight: 1.4 }}>Adjust or close your DA position based on updated market intel. Counter-trade to lock in profits or cut losses.</p>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                                <ActionButton onClick={() => setIdMyOrder(b => ({ ...b, side: "buy" }))} disabled={idSubmitted || phase !== "ID"} active={idMyOrder.side === "buy"} activeBg="#1de98b22" activeBorder="#1de98b" activeColor="#1de98b" label="BUY (Go Long)" />
                                <ActionButton onClick={() => setIdMyOrder(b => ({ ...b, side: "sell" }))} disabled={idSubmitted || phase !== "ID"} active={idMyOrder.side === "sell"} activeBg="#f0455a22" activeBorder="#f0455a" activeColor="#f0455a" label="SELL (Go Short)" />
                            </div>

                            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4, display: "block" }}>VOLUME (MW)</label>
                                    {useMemo(() => {
                                        const priceLimit = parseFloat(idMyOrder.price) || 50;
                                        const maxSafeMW = Math.floor(margin / (priceLimit * 0.5));
                                        const currentMW = parseFloat(idMyOrder.mw) || 0;
                                        const exceedsMargin = currentMW > maxSafeMW && idMyOrder.mw !== "";

                                        return (
                                            <>
                                                <input
                                                    type="number"
                                                    value={idMyOrder.mw}
                                                    disabled={idSubmitted || phase !== "ID"}
                                                    onChange={e => setIdMyOrder(b => ({ ...b, mw: e.target.value }))}
                                                    style={{
                                                        width: "100%",
                                                        padding: "8px",
                                                        background: "#102332",
                                                        border: `1px solid ${exceedsMargin ? "#f0455a" : "#234159"}`,
                                                        borderRadius: 6,
                                                        color: "#ddeeff",
                                                        fontSize: 14,
                                                        fontFamily: "'JetBrains Mono'"
                                                    }}
                                                />
                                                {exceedsMargin && (
                                                    <div style={{ fontSize: 8, color: "#f0455a", marginTop: 4, fontWeight: 700 }}>
                                                        ⚠️ Exceeds margin! Max: {f0(maxSafeMW)} MW
                                                    </div>
                                                )}
                                            </>
                                        );
                                    }, [idMyOrder.mw, idMyOrder.price, margin])}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4, display: "block" }}>PRICE LIMIT £/MWh</label>
                                    <input type="number" value={idMyOrder.price} disabled={idSubmitted || phase !== "ID"} onChange={e => setIdMyOrder(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "8px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#38c0fc", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                                </div>
                            </div>

                            <button onClick={onIdSubmit} disabled={idSubmitted || phase !== "ID" || !idMyOrder.price || (() => { const priceLimit = parseFloat(idMyOrder.price) || 50; const maxSafeMW = Math.floor(margin / (priceLimit * 0.5)); const currentMW = parseFloat(idMyOrder.mw) || 0; return currentMW > maxSafeMW && idMyOrder.mw !== ""; })()} style={{ width: "100%", padding: "12px", background: idSubmitted || phase !== "ID" ? "#1a3045" : "#38c0fc", border: "none", borderRadius: 8, color: idSubmitted || phase !== "ID" ? "#4d7a96" : "#050e16", fontWeight: 900, fontSize: 12, cursor: idSubmitted || phase !== "ID" ? "default" : "pointer", marginBottom: 16 }}>
                                {phase !== "ID" ? "AWAITING ID PHASE..." : idSubmitted ? "✓ ID ORDER PUBLISHED" : "SUBMIT ID ORDER →"}
                            </button>
                        </div>

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
                    </>
                )}
            </Panel>
        </div>
    );

    // --- TRADER ANALYSIS UI ---
    // Spread calculation (simulated or real depending on what data we have)
    const currentDaPrice = market?.forecast?.sbp || 50;
    const currentIdPrice = market?.actual?.sbp || market?.forecast?.sbp || 60; // Visual indication
    const spread = currentIdPrice - currentDaPrice;

    // Actual cleared positions from contracts
    const myC = spContracts?.[sp]?.[pid] || {};

    // Absolute values of cleared trades
    const absDaMw = myC.daMw || 0;
    const absIdMw = myC.idMw || 0;

    // Entry prices
    const daPrice = myC.daPrice || 0;
    const idPrice = myC.idPrice || 0;

    const totalMw = absDaMw + absIdMw;
    const avgEntry = totalMw > 0 ? ((absDaMw * daPrice) + (absIdMw * idPrice)) / totalMw : 0;

    // MTM Valuation: contractPosition > 0 means we SOLD (we are short power).
    // If we sold at avgEntry, and current price is currentIdPrice in BM:
    // If we sold, we profit if currentIdPrice < avgEntry (we sold high, we buy back low in BM).
    // If contractPosition < 0 means we BOUGHT (we are long power).
    // If we bought, we profit if currentIdPrice > avgEntry (we bought low, we sell high in BM).

    const unrealizedPnl = contractPosition > 0
        ? contractPosition * (avgEntry - currentIdPrice) // We sold. Profit if entry > exit.
        : Math.abs(contractPosition) * (currentIdPrice - avgEntry); // We bought. Profit if exit > entry.

    const right = (
        <div style={{ padding: 16, height: "100%", display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: 12, color: "#fff", marginBottom: 16, letterSpacing: 1 }}>TRADING DESK ANALYSIS</h3>
            <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4 }}>Risk-Adjusted Return</div>
            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, fontWeight: 800, color: unrealizedPnl >= 0 ? "#1de98b" : "#f0455a", marginBottom: 16 }}>
                {unrealizedPnl >= 0 ? "+" : ""}£{f0(unrealizedPnl / Math.max(1, marginPct))}
            </div>

            {/* DA-ID Spread Indicator */}
            <Panel style={{ marginBottom: 16 }}>
                <Tip text="The difference between Intraday (ID) and Day-Ahead (DA) prices. A positive spread means prices rose.">
                    <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, marginBottom: 12, textTransform: "uppercase", cursor: "help", borderBottom: "1px dashed #4d7a96", display: "inline-block" }}>DA / ID Price Spread</div>
                </Tip>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: "#f5b222" }}>DA: £{f0(currentDaPrice)}</div>
                    <div style={{ fontSize: 11, color: "#38c0fc" }}>ID: £{f0(currentIdPrice)}</div>
                </div>

                <div style={{ height: 16, background: "#050e16", borderRadius: 8, position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, background: "#1a3045", zIndex: 2 }} />
                    {/* Visualizing spread direction and magnitude */}
                    {spread > 0 ? (
                        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: `${Math.min(50, (spread / 100) * 50)}%`, background: "#1de98b" }} />
                    ) : (
                        <div style={{ position: "absolute", right: "50%", top: 0, bottom: 0, width: `${Math.min(50, (Math.abs(spread) / 100) * 50)}%`, background: "#f0455a" }} />
                    )}
                </div>

                <div style={{ textAlign: "center", marginTop: 8 }}>
                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 900, color: spread >= 0 ? "#1de98b" : "#f0455a" }}>
                        {spread >= 0 ? "↑ +" : "↓ "}£{f0(Math.abs(spread))} Spread
                    </span>
                    <div style={{ fontSize: 9, color: "#4d7a96", marginTop: 2 }}>{spread >= 0 ? "Prices increased in ID" : "Prices dropped in ID"}</div>
                </div>
            </Panel>

            {/* Position & MTM Log */}
            <Panel style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <Tip text="How much your current position is worth if you closed it right now at ID prices.">
                    <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, marginBottom: 12, textTransform: "uppercase", cursor: "help", borderBottom: "1px dashed #4d7a96", display: "inline-block" }}>Mark-to-Market (Risk-Adjusted Return)</div>
                </Tip>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                    <div style={{ background: "#102332", padding: 8, borderRadius: 6, textAlign: "center", border: "1px solid #1a3045" }}>
                        <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4 }}>Avg Entry Price</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", color: "#ddeeff", fontSize: 14 }}>£{f0(avgEntry)}</div>
                    </div>
                    <div style={{ background: "#102332", padding: 8, borderRadius: 6, textAlign: "center", border: "1px solid #1a3045" }}>
                        <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4 }}>Est. P&L at ID</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", color: unrealizedPnl >= 0 ? "#1de98b" : "#f0455a", fontSize: 14, fontWeight: 800 }}>
                            {unrealizedPnl >= 0 ? "+" : ""}£{f0(unrealizedPnl)}
                        </div>
                    </div>
                </div>

                <div style={{ fontSize: 11, color: "#b78bfa", marginBottom: 8, fontWeight: 700 }}>Cleared Trades (SP{sp})</div>
                <div style={{ flex: 1, overflowY: "auto", fontSize: 10 }}>
                    {absDaMw > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1a3045", color: "#4d7a96" }}>
                            <span>DA {myC.daSide === "offer" ? "SOLD" : "BOUGHT"} @ £{f0(daPrice)}</span>
                            <span style={{ fontFamily: "'JetBrains Mono'", color: "#f5b222" }}>{f0(absDaMw)} MW</span>
                        </div>
                    )}
                    {absIdMw > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1a3045", color: "#4d7a96" }}>
                            <span>ID {myC.idSide === "offer" ? "SOLD" : "BOUGHT"} @ £{f0(idPrice)}</span>
                            <span style={{ fontFamily: "'JetBrains Mono'", color: "#38c0fc" }}>{f0(absIdMw)} MW</span>
                        </div>
                    )}
                    {totalMw === 0 && (
                        <div style={{ textAlign: "center", color: "#2a5570", fontStyle: "italic", marginTop: 20 }}>No settled positions yet.</div>
                    )}
                </div>
            </Panel>
        </div>
    );

    return (
        <SharedLayout
            {...props}
            roleName="Trader"
            topRight={topRight}
            left={left}
            center={center}
            right={right}
            hint="You have no physical assets. If you can't close your position before BM gate closure, you face the System Cashout penalty."
        />
    );
}
