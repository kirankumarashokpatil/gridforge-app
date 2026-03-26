import React, { useState, useEffect } from "react";
import { f0, f1 } from "../../shared/utils";
import { Tip } from "./Tip";

/* ─── DAY-AHEAD MARKET CURVE ─── */
export default function DayAheadCurve({ bids, marketForecast, daResult }) {
    const offers = [...bids.filter(b => b.side === "offer" && +b.mw > 0 && !isNaN(+b.price))].sort((a, b) => +a.price - +b.price);
    const demandBids = [...bids.filter(b => b.side === "bid" && +b.mw > 0 && !isNaN(+b.price))].sort((a, b) => +b.price - +a.price);

    const buildSteps = items => {
        const steps = [];
        let cum = 0;
        for (const o of items) {
            steps.push([cum, +o.price]);
            cum += +o.mw;
            steps.push([cum, +o.price]);
        }
        if (steps.length) steps.push([cum + 20, steps[steps.length - 1][1]]);
        return steps;
    };

    const supplySteps = buildSteps(offers);
    const demandSteps = buildSteps(demandBids);
    const allPrices = [...offers, ...demandBids].map(b => +b.price);

    if (allPrices.length === 0) {
        return <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: 24, textAlign: "center", color: "#2a5570", fontSize: 10 }}>Waiting for DA bids to build the auction curve…</div>;
    }

    const W = 460, H = 148, PAD = { top: 12, bottom: 22, left: 36, right: 12 };
    const CW = W - PAD.left - PAD.right, CH = H - PAD.top - PAD.bottom;
    const allMW = [...supplySteps, ...demandSteps].map(([mw]) => mw);

    // Auto-scale with some padding
    // FIX: Use percentile-based scaling to prevent outliers from squashing normal bids
    const sortedPrices = [...allPrices].sort((a, b) => a - b);
    const p10 = sortedPrices[Math.floor(sortedPrices.length * 0.1)] || sortedPrices[0];
    const p90 = sortedPrices[Math.floor(sortedPrices.length * 0.9)] || sortedPrices[sortedPrices.length - 1];
    
    // Ensure clearing price is included if it's an outlier
    const cp = daResult?.cp || 0;
    const effectiveMin = Math.min(p10, cp);
    const effectiveMax = Math.max(p90, cp);
    
    const rawMin = effectiveMin;
    const minP = rawMin < 0 ? rawMin * 1.2 : rawMin * 0.8;
    const maxP = effectiveMax * 1.2;
    const pRange = maxP - minP || 1;
    const maxMW = Math.max(...allMW, daResult?.volume ? daResult.volume * 1.3 : 60);

    const xS = mw => PAD.left + (mw / maxMW) * CW;
    const yS = p => PAD.top + (1 - (p - minP) / pRange) * CH;
    const mkPath = steps => steps.length > 1 ? "M " + steps.map(([mw, p]) => `${xS(mw).toFixed(1)},${yS(p).toFixed(1)}`).join(" L ") : "";

    const supPath = mkPath(supplySteps);
    const demPath = mkPath(demandSteps);

    const clMW = daResult?.volume || 0;
    const clPrice = daResult?.cp || 0;

    // Accepted highlight paths (up to clearing volume)
    const accSupPts = supplySteps.filter(([mw]) => mw <= clMW);
    const lastAccSupPt = supplySteps.find(([mw]) => mw > clMW);
    let accSupPath = "";
    if (accSupPts.length > 0) {
        const pts = [...accSupPts];
        if (lastAccSupPt) pts.push([clMW, lastAccSupPt[1]]);
        accSupPath = `M ${xS(0).toFixed(1)},${yS(minP).toFixed(1)} ` + pts.map(([mw, p]) => `L ${xS(mw).toFixed(1)},${yS(p).toFixed(1)}`).join(" ") + ` L ${xS(clMW).toFixed(1)},${yS(minP).toFixed(1)} Z`;
    }

    const accDemPts = demandSteps.filter(([mw]) => mw <= clMW);
    const lastAccDemPt = demandSteps.find(([mw]) => mw > clMW);
    let accDemPath = "";
    if (accDemPts.length > 0) {
        const pts = [...accDemPts];
        if (lastAccDemPt) pts.push([clMW, lastAccDemPt[1]]);
        accDemPath = `M ${xS(0).toFixed(1)},${yS(maxP).toFixed(1)} ` + pts.map(([mw, p]) => `L ${xS(mw).toFixed(1)},${yS(p).toFixed(1)}`).join(" ") + ` L ${xS(clMW).toFixed(1)},${yS(maxP).toFixed(1)} Z`;
    }


    const clearX = xS(clMW);
    const clearY = clPrice ? yS(clPrice) : null;
    const gridPs = [0, 0.25, 0.5, 0.75, 1].map(t => minP + t * pRange);
    const gridMWs = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(maxMW * t));

    return (
        <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: "5px 0 2px", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 10px", marginBottom: 1 }}>
                <Tip text="Day-Ahead Pay-As-Clear Auction. Supply (red) = offers sorted cheapest first. Demand (green) = bids sorted highest first. Intersection sets the Market Clearing Price (MCP) for all accepted volume.">
                    <span style={{ fontSize: 8.5, color: "#4d7a96", textTransform: "uppercase", letterSpacing: .8, borderBottom: "1px dashed #2a5570", cursor: "help" }}>⚡ DA Auction Crossing</span>
                </Tip>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 7.5, color: "#f0455a" }}>▬ Offers (Sell)</span>
                    <span style={{ fontSize: 7.5, color: "#1de98b" }}>▬ Bids (Buy)</span>
                    {clPrice > 0 && <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, fontWeight: 800, color: "#38c0fc" }}>MCP £{f1(clPrice)}</span>}
                </div>
            </div>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
                {gridPs.map((p, i) => (<g key={i}><line x1={PAD.left} y1={yS(p)} x2={W - PAD.right} y2={yS(p)} stroke="#1a3045" strokeWidth="0.5" /><text x={PAD.left - 3} y={yS(p) + 3} fontSize="6.5" fill="#2a5570" textAnchor="end" fontFamily="JetBrains Mono">£{Math.round(p)}</text></g>))}
                {gridMWs.filter((_, i) => i % 2 === 0).map((mw, i) => (<g key={i}><line x1={xS(mw)} y1={PAD.top} x2={xS(mw)} y2={H - PAD.bottom} stroke="#1a3045" strokeWidth="0.5" /><text x={xS(mw)} y={H - PAD.bottom + 9} fontSize="6.5" fill="#2a5570" textAnchor="middle">{mw}MW</text></g>))}

                {/* Accepted Volume Shading */}
                {accSupPath && <path d={accSupPath} fill="#f0455a" opacity="0.10" />}
                {accDemPath && <path d={accDemPath} fill="#1de98b" opacity="0.10" />}

                {/* Base curve shading */}
                {supPath && <path d={supPath + " L " + xS(supplySteps[supplySteps.length - 1]?.[0] || 0) + "," + yS(minP) + " L " + xS(0) + "," + yS(minP) + " Z"} fill="#f0455a" opacity="0.04" />}
                {demPath && <path d={demPath + " L " + xS(demandSteps[demandSteps.length - 1]?.[0] || 0) + "," + yS(minP) + " L " + xS(0) + "," + yS(minP) + " Z"} fill="#1de98b" opacity="0.04" />}

                {/* Lines */}
                {supPath && <path d={supPath} fill="none" stroke="#f0455a" strokeWidth="2.2" strokeLinejoin="round" />}
                {demPath && <path d={demPath} fill="none" stroke="#1de98b" strokeWidth="2.2" strokeLinejoin="round" />}

                {/* Intersection Marker */}
                {clearY && clMW > 0 && (
                    <g className="clear-pop" style={{ transformOrigin: `${clearX}px ${clearY}px` }}>
                        <line x1={clearX} y1={PAD.top} x2={clearX} y2={H - PAD.bottom} stroke="#38c0fc" strokeWidth="1.2" strokeDasharray="4,3" />
                        <line x1={PAD.left} y1={clearY} x2={clearX} y2={clearY} stroke="#38c0fc" strokeWidth="1.2" strokeDasharray="4,3" />
                        <circle cx={clearX} cy={clearY} r="6" fill="#050e16" stroke="#38c0fc" strokeWidth="2" />
                        <circle cx={clearX} cy={clearY} r="2.5" fill="#38c0fc" />
                        <text x={clearX + 8} y={clearY - 4} fontSize="7" fill="#38c0fc" fontWeight="800" fontFamily="JetBrains Mono">£{f1(clPrice)}</text>
                        <text x={clearX + 8} y={clearY + 6} fontSize="6" fill="#2a5570">{f0(clMW)}MW</text>
                    </g>
                )}
                <text x={10} y={PAD.top + CH / 2} fontSize="7" fill="#4d7a96" transform={`rotate(-90,10,${PAD.top + CH / 2})`} textAnchor="middle">£/MWh</text>
            </svg>
        </div>
    );
}
