import React, { useState } from "react";
import { f0, f1 } from "../../shared/utils";
import { Tip } from "./Tip";

/* ─── INTRADAY DEPTH CHART / EXECUTIONS ─── */
export default function IntradayDepthChart({ idOrderBook, spContracts, currentSp, msLeft, tickSpeed }) {
    const [view, setView] = useState("depth"); // "depth" | "executions"

    // Convert orderbook object to arrays
    const rawOrders = Object.values(idOrderBook || {}).filter(b => b && b.mw);
    const bids = rawOrders.filter(b => b.side === "buy" || b.side === "bid").map(b => ({ ...b })).sort((a, b) => b.price - a.price); // Highest first
    const offers = rawOrders.filter(b => b.side === "sell" || b.side === "offer").map(b => ({ ...b })).sort((a, b) => a.price - b.price); // Lowest first

    // Execution data processing
    // spContracts contains executed trades for the previous phases
    const idTrades = [];
    const contracts = spContracts[currentSp] || {};
    Object.values(contracts).forEach(c => {
        if (c.idMw && c.idMw > 0) {
            idTrades.push({
                mw: c.idMw,
                price: c.idPrice,
                side: c.idSide // "offer" or "bid" - though executions are matches
            });
        }
    });

    // Build cumulative depth
    const buildDepth = items => {
        const steps = [];
        let cum = 0;
        for (const o of items) {
            steps.push([cum, +o.price]);
            cum += +o.mw;
            steps.push([cum, +o.price]);
        }
        return { steps, totalMw: cum };
    };

    const { steps: bidSteps, totalMw: totalBidMw } = buildDepth(bids);
    const { steps: offerSteps, totalMw: totalOfferMw } = buildDepth(offers);

    const allPrices = [...bids, ...offers].map(b => +b.price);
    const hasData = bids.length > 0 || offers.length > 0;

    const W = 460, H = 148, PAD = { top: 12, bottom: 22, left: 36, right: 12 };
    const CW = W - PAD.left - PAD.right, CH = H - PAD.top - PAD.bottom;

    const renderChart = () => {
        if (!hasData && view === "depth") {
            return <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "#2a5570", fontSize: 10 }}>No resting orders in ID book...</div>;
        }
        if (idTrades.length === 0 && view === "executions") {
            return <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "#2a5570", fontSize: 10 }}>Waiting for ID phase to close / no matches found...</div>;
        }

        if (view === "depth") {
            const rawMin = allPrices.length > 0 ? Math.min(...allPrices) : 0;
            const minP = rawMin < 0 ? rawMin * 1.2 : rawMin * 0.78;
            const maxP = allPrices.length > 0 ? Math.max(...allPrices) * 1.18 : 100;
            const pRange = maxP - minP || 1;

            // Total cumulative MW is sum of both sides for the X axis, meeting in middle
            const maxMW = Math.max(totalBidMw, totalOfferMw, 50);

            // X scale: Bid comes from left (max to 0), Offer from 0 to right
            const center = PAD.left + CW / 2;
            const xSBid = mw => center - (mw / maxMW) * (CW / 2);
            const xSOffer = mw => center + (mw / maxMW) * (CW / 2);
            const yS = p => PAD.top + (1 - (p - minP) / pRange) * CH;

            const mkBidPath = steps => steps.length > 1 ? "M " + steps.map(([mw, p]) => `${xSBid(mw).toFixed(1)},${yS(p).toFixed(1)}`).join(" L ") : "";
            const mkOfferPath = steps => steps.length > 1 ? "M " + steps.map(([mw, p]) => `${xSOffer(mw).toFixed(1)},${yS(p).toFixed(1)}`).join(" L ") : "";

            const bidPath = mkBidPath(bidSteps);
            const offerPath = mkOfferPath(offerSteps);

            const gridPs = [0, 0.25, 0.5, 0.75, 1].map(t => minP + t * pRange);

            return (
                <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
                    {/* Grid lines */}
                    {gridPs.map((p, i) => (<g key={i}><line x1={PAD.left} y1={yS(p)} x2={W - PAD.right} y2={yS(p)} stroke="#1a3045" strokeWidth="0.5" /><text x={PAD.left - 3} y={yS(p) + 3} fontSize="6.5" fill="#2a5570" textAnchor="end" fontFamily="JetBrains Mono">£{Math.round(p)}</text></g>))}

                    {/* Center Line (Spread) */}
                    <line x1={center} y1={PAD.top} x2={center} y2={H - PAD.bottom} stroke="#1a3045" strokeWidth="1" strokeDasharray="2,2" />

                    <text x={center - 10} y={H - PAD.bottom + 12} fontSize="7" fill="#1de98b" textAnchor="end">← Bids (Buy)</text>
                    <text x={center + 10} y={H - PAD.bottom + 12} fontSize="7" fill="#f0455a" textAnchor="start">Offers (Sell) →</text>

                    {/* Depth Shading */}
                    {bidPath && <path d={bidPath + " L " + xSBid(bidSteps[bidSteps.length - 1]?.[0] || 0) + "," + yS(minP) + " L " + center + "," + yS(minP) + " Z"} fill="#1de98b" opacity="0.15" />}
                    {offerPath && <path d={offerPath + " L " + xSOffer(offerSteps[offerSteps.length - 1]?.[0] || 0) + "," + yS(maxP) + " L " + center + "," + yS(maxP) + " Z"} fill="#f0455a" opacity="0.15" />}

                    {/* Depth Lines */}
                    {bidPath && <path d={bidPath} fill="none" stroke="#1de98b" strokeWidth="2" strokeLinejoin="round" />}
                    {offerPath && <path d={offerPath} fill="none" stroke="#f0455a" strokeWidth="2" strokeLinejoin="round" />}

                    {/* Spread indicator if both exist */}
                    {bids.length > 0 && offers.length > 0 && bids[0].price < offers[0].price && (
                        <g>
                            <line x1={center} y1={yS(offers[0].price)} x2={center} y2={yS(bids[0].price)} stroke="#38c0fc" strokeWidth="2" />
                            <text x={center + 4} y={yS((offers[0].price + bids[0].price) / 2) + 3} fontSize="6.5" fill="#38c0fc" fontFamily="JetBrains Mono">Spread: £{f1(offers[0].price - bids[0].price)}</text>
                        </g>
                    )}

                    <text x={10} y={PAD.top + CH / 2} fontSize="7" fill="#4d7a96" transform={`rotate(-90,10,${PAD.top + CH / 2})`} textAnchor="middle">£/MWh</text>
                </svg>
            );
        } else {
            // Executions timeline view (simplified to just show the matched dots)
            const tradePrices = idTrades.map(t => t.price);
            const rawMin = tradePrices.length > 0 ? Math.min(...tradePrices) : 0;
            const minP = rawMin < 0 ? rawMin * 1.2 : rawMin * 0.8;
            const maxP = tradePrices.length > 0 ? Math.max(...tradePrices) * 1.2 : 100;
            const pRange = maxP - minP || 1;

            // FIX: Set min floor for maxVol so tiny trades don't appear maximum-sized
            const maxVol = Math.max(...idTrades.map(t => t.mw), 50);

            const yS = p => PAD.top + (1 - (p - minP) / pRange) * CH;
            const gridPs = [0, 0.25, 0.5, 0.75, 1].map(t => minP + t * pRange);

            return (
                <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
                    {gridPs.map((p, i) => (<g key={i}><line x1={PAD.left} y1={yS(p)} x2={W - PAD.right} y2={yS(p)} stroke="#1a3045" strokeWidth="0.5" /><text x={PAD.left - 3} y={yS(p) + 3} fontSize="6.5" fill="#2a5570" textAnchor="end" fontFamily="JetBrains Mono">£{Math.round(p)}</text></g>))}
                    <text x={PAD.left + CW / 2} y={H - PAD.bottom + 12} fontSize="7" fill="#4d7a96" textAnchor="middle">ID Phase Trades</text>

                    {idTrades.map((t, i) => {
                        // Distribute trades evenly across the X‑axis (index-based) so they no longer stack
                        // Regardless of msLeft this gives every execution its own horizontal position.
                        const x = PAD.left + (CW * 0.1) + ((CW * 0.8) * (i / Math.max(1, idTrades.length - 1)));
                        const y = yS(t.price);
                        // Size relative to volume
                        const r = 2 + (t.mw / maxVol) * 6;
                        const color = t.side === "offer" ? "#f0455a" : "#1de98b"; // Not perfect since trades involve both, but colors give texture

                        return (
                            <g key={i} className="trade-bubble">
                                <circle cx={x} cy={y} r={r} fill={color} opacity="0.6" stroke={color} strokeWidth="1" />
                                <text x={x} y={y - r - 4} fontSize="6" fill="#ddeeff" textAnchor="middle">{t.mw}MW</text>
                            </g>
                        );
                    })}

                    <text x={10} y={PAD.top + CH / 2} fontSize="7" fill="#4d7a96" transform={`rotate(-90,10,${PAD.top + CH / 2})`} textAnchor="middle">Exec Price</text>
                </svg>
            );
        }
    };

    return (
        <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: "5px 0 2px", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 10px", marginBottom: 1 }}>
                <Tip text="Intraday Market. Depth view shows resting liquidity (bids to buy vs offers to sell). Executions view shows historical matched trades at midpoint prices.">
                    <span style={{ fontSize: 8.5, color: "#4d7a96", textTransform: "uppercase", letterSpacing: .8, borderBottom: "1px dashed #2a5570", cursor: "help" }}>⚡ ID Continuous Trading</span>
                </Tip>
                <div style={{ display: "flex", gap: 4, alignItems: "center", border: "1px solid #1a3045", borderRadius: 4, padding: 2 }}>
                    <button
                        onClick={() => setView("depth")}
                        style={{
                            background: view === "depth" ? "#1a3045" : "transparent",
                            border: "none", color: view === "depth" ? "#ddeeff" : "#4d7a96",
                            padding: "2px 8px", fontSize: 8, borderRadius: 2, cursor: "pointer", fontWeight: 700
                        }}>DEPTH</button>
                    <button
                        onClick={() => setView("executions")}
                        style={{
                            background: view === "executions" ? "#1a3045" : "transparent",
                            border: "none", color: view === "executions" ? "#ddeeff" : "#4d7a96",
                            padding: "2px 8px", fontSize: 8, borderRadius: 2, cursor: "pointer", fontWeight: 700
                        }}>EXECS</button>
                </div>
            </div>
            {renderChart()}
        </div>
    );
}
