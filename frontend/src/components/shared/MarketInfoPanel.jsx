import React, { useState } from 'react';
import { MARKET_COMPARISON, GB_PHASE_TABLE } from '../../shared/constants';

export function MarketInfoPanel() {
    const [show, setShow] = useState(false);
    const [tab, setTab] = useState("terms");

    return (
        <div style={{ position: "relative" }}>
            <button
                onClick={() => setShow(s => !s)}
                style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 10px", background: show ? "#38c0fc" : "#0c1c2a",
                    border: `1px solid ${show ? "#38c0fc" : "#1a3045"}`,
                    borderRadius: 8, color: show ? "#050e16" : "#4d7a96",
                    fontSize: 10, fontWeight: 700, cursor: "pointer",
                    transition: "all 0.2s"
                }}
            >
                <span>{show ? "✕" : "ℹ️"}</span>
                {show ? "Close Dictionary" : "Learn"}
            </button>

            {show && (
                <div className="fadeIn" style={{
                    position: "absolute", top: "calc(100% + 8px)", right: 0,
                    width: 420, background: "#0a1724ee", backdropFilter: "blur(12px)",
                    border: "1px solid #38c0fc", borderRadius: 8, padding: 16,
                    zIndex: 9999, boxShadow: "0 12px 40px #000000aa", color: "#ddeeff"
                }}>
                    {/* Tab switcher */}
                    <div style={{ display: "flex", gap: 8, marginBottom: 12, borderBottom: "1px solid #1a3045", paddingBottom: 8 }}>
                        <button onClick={() => setTab("terms")} style={{
                            background: tab === "terms" ? "#38c0fc18" : "transparent",
                            border: `1px solid ${tab === "terms" ? "#38c0fc" : "#1a3045"}`,
                            borderRadius: 4, padding: "4px 8px", fontSize: 9, fontWeight: 700,
                            color: tab === "terms" ? "#38c0fc" : "#4d7a96", cursor: "pointer"
                        }}>📖 Dictionary</button>
                        <button onClick={() => setTab("guide")} style={{
                            background: tab === "guide" ? "#38c0fc18" : "transparent",
                            border: `1px solid ${tab === "guide" ? "#38c0fc" : "#1a3045"}`,
                            borderRadius: 4, padding: "4px 8px", fontSize: 9, fontWeight: 700,
                            color: tab === "guide" ? "#38c0fc" : "#4d7a96", cursor: "pointer"
                        }}>🎮 How to Play</button>
                        <button onClick={() => setTab("markets")} style={{
                            background: tab === "markets" ? "#38c0fc18" : "transparent",
                            border: `1px solid ${tab === "markets" ? "#38c0fc" : "#1a3045"}`,
                            borderRadius: 4, padding: "4px 8px", fontSize: 9, fontWeight: 700,
                            color: tab === "markets" ? "#38c0fc" : "#4d7a96", cursor: "pointer"
                        }}>⚡ GB Markets</button>
                    </div>

                    {/* TERMS TAB */}
                    {tab === "terms" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 400, overflowY: "auto", paddingRight: 4 }}>

                            <div style={{ fontSize: 11, fontWeight: 800, color: "#38c0fc", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                                GridForge Terminology
                            </div>

                            <div>
                                <span style={{ color: "#f5b222", fontWeight: 800, fontSize: 11 }}>Merit Order</span>
                                <p style={{ margin: "2px 0 0 0", fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
                                    The ranking of all generation offers and demand bids by price, from cheapest to most expensive. Supply stacks from left (lowest cost) to right; demand stacks from right (highest value) to left. The intersection determines the Clearing Price.
                                </p>
                            </div>

                            <div>
                                <span style={{ color: "#f5b222", fontWeight: 800, fontSize: 11 }}>Marginal Pricing (Pay-As-Clear)</span>
                                <p style={{ margin: "2px 0 0 0", fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
                                    All accepted bids and offers receive or pay the Clearing Price, regardless of their actual bid/offer price. A £40 offer pays £90 if clearing price is £90. Encourages honest pricing and efficient markets.
                                </p>
                            </div>

                            <div>
                                <span style={{ color: "#f5b222", fontWeight: 800, fontSize: 11 }}>DA (Day-Ahead)</span>
                                <p style={{ margin: "2px 0 0 0", fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
                                    The forward market. You lock in a contract (price and volume) a day in advance based on forecasted conditions.
                                </p>
                            </div>

                            <div>
                                <span style={{ color: "#38c0fc", fontWeight: 800, fontSize: 11 }}>ID (Intraday)</span>
                                <p style={{ margin: "2px 0 0 0", fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
                                    Continuous trading market near real-time. Adjust your DA position by buying or selling power as conditions change.
                                </p>
                            </div>

                            <div>
                                <span style={{ color: "#1de98b", fontWeight: 800, fontSize: 11 }}>BM (Balancing Mechanism)</span>
                                <p style={{ margin: "2px 0 0 0", fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
                                    National Grid's real-time auction to stabilize the grid. You offer emergency flexibility. Bids are called (accepted) by NESO.
                                </p>
                            </div>

                            <div>
                                <span style={{ color: "#b78bfa", fontWeight: 800, fontSize: 11 }}>PN (Physical Notification)</span>
                                <p style={{ margin: "2px 0 0 0", fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
                                    Your baseline expectation of delivery. Equals your net contract position (DA + ID trades).
                                </p>
                            </div>

                            <div style={{ height: 1, background: "#1a3045", margin: "4px 0" }} />

                            <div>
                                <span style={{ color: "#ffffff", fontWeight: 800, fontSize: 11 }}>NIV (Net Imbalance Volume)</span>
                                <p style={{ margin: "2px 0 0 0", fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
                                    The absolute systemic error of the grid. Positive (Long) = Too much power generating. Negative (Short) = Not enough power generating.
                                </p>
                            </div>

                            <div>
                                <span style={{ color: "#ffffff", fontWeight: 800, fontSize: 11 }}>SoC (State of Charge)</span>
                                <p style={{ margin: "2px 0 0 0", fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
                                    For Batteries: The percentage of total storage currently filled. Determines how much you can physically inject (discharge) or absorb (charge).
                                </p>
                            </div>

                            <div>
                                <span style={{ color: "#ffffff", fontWeight: 800, fontSize: 11 }}>Imbalance Exposure</span>
                                <p style={{ margin: "2px 0 0 0", fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
                                    If your physical real-time output (or limits) break your contracted PN, you pay a penalty to ELEXON based on the System Sell/Buy Price.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* GUIDE TAB */}
                    {tab === "guide" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 400, overflowY: "auto", paddingRight: 4 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: "#38c0fc", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                                Role Strategies
                            </div>

                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                    <span style={{ fontSize: 14 }}>⚡</span>
                                    <span style={{ color: "#f5b222", fontWeight: 800, fontSize: 11 }}>Generator</span>
                                </div>
                                <p style={{ margin: "0", fontSize: 9, color: "#94a3b8", lineHeight: 1.5 }}>
                                    1. <strong>Lock DA</strong> at forecast price<br />
                                    2. <strong>Adjust in ID</strong> if winds change<br />
                                    3. <strong>Bid BM high</strong> if you'll be short<br />
                                    💡 Win by selling when SBP spikes
                                </p>
                            </div>

                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                    <span style={{ fontSize: 14 }}>🔋</span>
                                    <span style={{ color: "#f5b222", fontWeight: 800, fontSize: 11 }}>Battery (BESS)</span>
                                </div>
                                <p style={{ margin: "0", fontSize: 9, color: "#94a3b8", lineHeight: 1.5 }}>
                                    1. <strong>Buy cheap DA</strong> (charge)<br />
                                    2. <strong>Sell expensive BM</strong> (discharge)<br />
                                    3. <strong>Protect SoC</strong>: don't over-discharge<br />
                                    💡 Win by arbitrage: capture spread between offer/buy prices
                                </p>
                            </div>

                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                    <span style={{ fontSize: 14 }}>🏗️</span>
                                    <span style={{ color: "#f5b222", fontWeight: 800, fontSize: 11 }}>Demand Response (DSR)</span>
                                </div>
                                <p style={{ margin: "0", fontSize: 9, color: "#94a3b8", lineHeight: 1.5 }}>
                                    1. <strong>Wait for SBP spike</strong><br />
                                    2. <strong>Curtail when desperate</strong> (high SBP)<br />
                                    3. <strong>Avoid rebound trap</strong>: don't curtail into another spike<br />
                                    💡 Win by timing: sell flexibility only when valued highest
                                </p>
                            </div>

                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                    <span style={{ fontSize: 14 }}>💼</span>
                                    <span style={{ color: "#f5b222", fontWeight: 800, fontSize: 11 }}>Trader</span>
                                </div>
                                <p style={{ margin: "0", fontSize: 9, color: "#94a3b8", lineHeight: 1.5 }}>
                                    1. <strong>No physical assets</strong> = must close position<br />
                                    2. <strong>Close before BM</strong> or pay SBP/SSP<br />
                                    3. <strong>Avoid margin call</strong>: £cash must stay positive<br />
                                    💡 Win by spreads: buy DA cheap, sell ID expensive, close clean
                                </p>
                            </div>

                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                    <span style={{ fontSize: 14 }}>🏢</span>
                                    <span style={{ color: "#f5b222", fontWeight: 800, fontSize: 11 }}>Supplier</span>
                                </div>
                                <p style={{ margin: "0", fontSize: 9, color: "#94a3b8", lineHeight: 1.5 }}>
                                    1. <strong>Must cover demand</strong> every SP<br />
                                    2. <strong>Lock DA</strong> to lock cost base<br />
                                    3. <strong>Over-hedge in ID</strong> when prices jump<br />
                                    💡 Win by margin: buy cheap, sell retail at mark-up, avoid SSP penalties
                                </p>
                            </div>

                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                    <span style={{ fontSize: 14 }}>🎯</span>
                                    <span style={{ color: "#f5b222", fontWeight: 800, fontSize: 11 }}>System Operator (NESO)</span>
                                </div>
                                <p style={{ margin: "0", fontSize: 9, color: "#94a3b8", lineHeight: 1.5 }}>
                                    1. <strong>Keep 50 Hz</strong> or grid fails<br />
                                    2. <strong>Dispatch cheapest bids</strong> first<br />
                                    3. <strong>Minimize total cost</strong> = best score<br />
                                    💡 Win by efficiency: accept bids that solve imbalance at lowest cost
                                </p>
                            </div>
                        </div>
                    )}

                    {/* MARKETS TAB — GB market comparison */}
                    {tab === "markets" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 400, overflowY: "auto", paddingRight: 4 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: "#38c0fc", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                                GB Market Sequence
                            </div>

                            <p style={{ margin: 0, fontSize: 9, color: "#94a3b8", lineHeight: 1.5 }}>
                                <strong style={{ color: "#ddeeff" }}>Day D-1:</strong> FORECAST → DA (09:20) → FORECAST → IDA1 (15:30) → FORECAST → IDA2 (17:30)<br />
                                <strong style={{ color: "#ddeeff" }}>Day D:</strong> Continuous ID → BM (per SP, 00:00–24:00)
                            </p>

                            {/* Phase timeline */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                {Object.entries(GB_PHASE_TABLE).map(([key, info]) => (
                                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 6px", background: "#0c1c2a", borderRadius: 4, border: "1px solid #1a3045" }}>
                                        <span style={{ fontSize: 7, color: info.type === "auction" ? "#f5b222" : info.type === "forecast" ? "#a78bfa" : info.type === "continuous" ? "#38c0fc" : info.type === "bm" ? "#1de98b" : "#b78bfa", fontWeight: 800, width: 52, flexShrink: 0 }}>{key}</span>
                                        <span style={{ fontSize: 8, color: "#ddeeff", fontWeight: 600, flex: 1 }}>{info.label}</span>
                                        <span style={{ fontSize: 7, color: "#4d7a96", fontFamily: "'JetBrains Mono'", flexShrink: 0 }}>{info.realTime}</span>
                                    </div>
                                ))}
                            </div>

                            <div style={{ height: 1, background: "#1a3045", margin: "4px 0" }} />

                            {/* Comparison table */}
                            <div style={{ fontSize: 11, fontWeight: 800, color: "#f5b222", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                                Auction vs Continuous vs BM
                            </div>
                            <table style={{ width: "100%", fontSize: 8, borderCollapse: "collapse" }}>
                                <thead>
                                    <tr>
                                        {MARKET_COMPARISON[0] && Object.values(MARKET_COMPARISON[0]).map((h, i) => (
                                            <th key={i} style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #1a3045", color: "#4d7a96", fontWeight: 700 }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {MARKET_COMPARISON.slice(1).map((row, i) => (
                                        <tr key={i}>
                                            <td style={{ padding: "3px 6px", borderBottom: "1px solid #0c1c2a", color: "#ddeeff", fontWeight: 700 }}>{row.header}</td>
                                            <td style={{ padding: "3px 6px", borderBottom: "1px solid #0c1c2a", color: "#f5b222" }}>{row.auction}</td>
                                            <td style={{ padding: "3px 6px", borderBottom: "1px solid #0c1c2a", color: "#38c0fc" }}>{row.continuous}</td>
                                            <td style={{ padding: "3px 6px", borderBottom: "1px solid #0c1c2a", color: "#1de98b" }}>{row.bm}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
