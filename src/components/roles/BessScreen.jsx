import React, { useState } from 'react';
import SharedLayout from './SharedLayout';
import { ASSETS, SP_DURATION_H, SYSTEM_PARAMS } from '../../shared/constants';
import { Tip } from '../shared/Tip'; // Added tooltip support

// Formatting
const f0 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 0 });
const f1 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 1 });

export default function BessScreen(props) {
    const {
        market, sp, msLeft, tickSpeed, phase,
        assetKey, soc, myBid, setMyBid, submitted, onSubmit,
        daMyBid, setDaMyBid, daSubmitted, onDaSubmit,
        idMyOrder, setIdMyOrder, idSubmitted, onIdSubmit,
        spContracts, pid, spHistory, contractPosition, cash, daCash,
        physicalState // Added physically simulated state (for cycle counts / temperature future use)
    } = props;

    // Lookup Asset details
    const def = ASSETS[assetKey] || ASSETS.BESS_S;
    const isShort = market?.actual?.isShort || market?.forecast?.isShort;
    const currentMkt = phase === "DA" ? market?.forecast : market?.actual;
    const sbp = currentMkt?.sbp || 50; const ssp = currentMkt?.ssp || 50;

    // Revenue calculations
    // Bug fix: was adding cash + daCash which double-counts DA revenue since cash already includes it.
    const totalRev = Number(cash || 0);
    // Approximate non-DA revenue: total cash minus the DA portion tracked in daCash.
    // Includes ID, BM, imbalance, and operating costs. Display only — not used for scoring.
    const nonDaRev = (cash || 0) - (daCash || 0);
    const cSp = spContracts[sp]?.[pid] || { physicalMw: 0 };
    const risk = { expectedImbMw: Math.abs(contractPosition - (cSp.bmAccepted?.mw || 0)), worstCaseCost: Math.abs(contractPosition - (cSp.bmAccepted?.mw || 0)) * Math.max(sbp, ssp) };

    const currentSoc = props.soc ? Math.round(props.soc) : (def.startSoC || 50);

    // --- BATTERY SPECIFIC ENERGY LIMIT CALCULATIONS ---
    const maxDischargeMwh = (currentSoc / 100) * def.maxMWh; // Available energy to discharge
    const maxChargeMwh = def.maxMWh - maxDischargeMwh; // Available headroom to charge

    // Convert MWh constraints to MW constraints for the current half-hour SP (MW = MWh / 0.5)
    // Factoring in efficiency constraints natively
    const sustainedDischargeMw = Math.min(def.maxMW, (maxDischargeMwh * (def.eff || 1)) / 0.5);
    const sustainedChargeMw = Math.min(def.maxMW, (maxChargeMwh / (def.eff || 1)) / 0.5);

    // Projected SoC preview for current BM bid (use rounded currentSoc for consistency)
    const isDischarging = isShort; // If short, BESS is a SELLER (Discharging)
    const projectedMw = Number(myBid.mw) || 0;
    // Note: SP_DURATION_H is 0.5. MWh = MW * 0.5
    const projectedMwh = projectedMw * SP_DURATION_H;

    let projectedSoc = currentSoc;
    if (isDischarging) {
        // Discharging loses more internal energy due to efficiency
        const internalCostMwh = projectedMwh / (def.eff || 1);
        projectedSoc = Math.max(0, currentSoc - (internalCostMwh / def.maxMWh) * 100);
    } else {
        // Charging gains less internal energy due to efficiency
        const internalGainMwh = projectedMwh * (def.eff || 1);
        projectedSoc = Math.min(100, currentSoc + (internalGainMwh / def.maxMWh) * 100);
    }


    // --- TOP RIGHT (NET POS + SYSTEM STATS) ---
    const systemMarket = market?.actual || market?.forecast || {};
    const sysDemand = systemMarket.system?.demandMw || 0;
    const sysWind = systemMarket.system?.windMw || 0;
    const sysSolar = systemMarket.system?.solarMw || 0;

    const topRight = (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Tip text="Net Position: The total volume you have contracted to deliver or absorb. Positive = you promised to generate. Negative = you promised to consume." align="right">
                <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", padding: "4px 8px", borderRadius: 4, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 7.5, color: "#4d7a96" }}>NET POS (SP{sp})</span>
                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: contractPosition > 0 ? "#1de98b" : contractPosition < 0 ? "#38c0fc" : "#ddeeff" }}>
                        {contractPosition > 0 ? "+" : ""}{f0(contractPosition)} MW
                    </span>
                </div>
            </Tip>
            {/* system-wide metrics */}
            <div style={{ display: "flex", gap: 6 }}>
                <div style={{ fontSize: 10, color: "#4d7a96" }}>SYS DMD</div>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: "#f5b222" }}>{f0(sysDemand)} MW</div>
                <div style={{ fontSize: 10, color: "#4d7a96" }}>WIND</div>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: "#a3e635" }}>{f0(sysWind)} MW</div>
                <div style={{ fontSize: 10, color: "#4d7a96" }}>SOLAR</div>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 800, color: "#fbbf24" }}>{f0(sysSolar)} MW</div>
            </div>
        </div>
    );

    // --- SECTION 1: ASSET CAPABILITIES ---
    const effPct = Math.round(def.eff * 100);

    const sect1AssetInfo = (
        <div style={{ background: "#0c1c2a", border: `1px solid ${def.col}55`, borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: def.col, boxShadow: `0 0 10px ${def.col}` }} />
            <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                <span>1. Asset Profile</span>
                <span style={{ fontSize: 14 }}>{def.emoji} {def.name}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
                    <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>POWER CAPACITY</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: def.col, fontWeight: 800 }}>±{f0(def.maxMW)}<span style={{ fontSize: 9, color: "#2a5570" }}>MW</span></div>
                </div>
                <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
                    <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>ENERGY STORAGE</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#38c0fc", fontWeight: 800 }}>{f0(def.maxMWh)}<span style={{ fontSize: 9, color: "#2a5570" }}>MWh</span></div>
                </div>
                <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
                    <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>EFFICIENCY (RTE)</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#1de98b", fontWeight: 800 }}>{effPct}%</div>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                <div style={{ background: "#050e16", border: "1px solid #1a3045", padding: "6px 8px", borderRadius: 6 }}>
                    <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>CELL DEGRADATION WEAR COST (THROUGHPUT)</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#f0455a", fontWeight: 700 }}>£{f1(def.wear || 0)}/MWh / Cycle</div>
                </div>
            </div>
            <div style={{ fontSize: 8.5, color: "#4d7a96", marginTop: "auto", paddingTop: 12, lineHeight: 1.5 }}>
                {def.desc}
            </div>
        </div>
    );

    // --- SECTION 2: LIVE STATUS & AVAILABILITY ---
    const gradient = currentSoc < 20 ? "linear-gradient(90deg, #f0455a, #f5b222)" : currentSoc > 80 ? "linear-gradient(90deg, #38c0fc, #b78bfa)" : "linear-gradient(90deg, #1de98b, #a3e635)";

    let effectiveSoc = currentSoc;
    if (contractPosition > 0) {
        effectiveSoc -= ((contractPosition * SP_DURATION_H) / (def.eff || 1)) / def.maxMWh * 100;
    } else if (contractPosition < 0) {
        effectiveSoc -= ((contractPosition * SP_DURATION_H) * (def.eff || 1)) / def.maxMWh * 100;
    }
    effectiveSoc = Math.max(0, Math.min(100, effectiveSoc));

    const sect2Availability = (
        <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 12 }}>2. Energetic Autonomy & Limiters</div>

            <div style={{ marginBottom: 16, background: "#050e16", padding: "8px 12px", border: "1px solid #1a3045", borderRadius: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <Tip text="State Of Charge (SoC). The battery's current energy level as a percentage. Controls if you can charge or discharge.">
                        <div style={{ fontSize: 8.5, color: "#4d7a96", borderBottom: "1px dashed #4d7a96", cursor: "help" }}>STATE OF CHARGE (SoC)</div>
                    </Tip>
                    <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 14, fontWeight: 900, color: currentSoc < 20 ? "#f0455a" : currentSoc > 80 ? "#38c0fc" : "#1de98b" }}>{currentSoc}%</div>
                        {contractPosition !== 0 && (
                            <div style={{ fontSize: 9, color: "#4d7a96" }}>Effective: <span style={{ color: effectiveSoc < 20 ? "#f0455a" : effectiveSoc > 80 ? "#38c0fc" : "#1de98b", fontWeight: 700 }}>{f1(effectiveSoc)}%</span></div>
                        )}
                    </div>
                </div>
                <div style={{ background: "#02070b", height: 16, borderRadius: 8, border: "1px solid #1a3045", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${currentSoc}%`, background: gradient, transition: "width 0.3s ease" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 8, color: "#2a5570", fontFamily: "'JetBrains Mono'" }}>
                    <Tip text="Total energy (MWh) currently stored inside the battery cells."><span style={{ borderBottom: "1px dashed #2a5570" }}>{f1((currentSoc / 100) * def.maxMWh)} MWh Saved</span></Tip>
                    <Tip text="Available headroom (MWh) before the battery is completely full."><span style={{ borderBottom: "1px dashed #2a5570" }}>{f1(def.maxMWh - ((currentSoc / 100) * def.maxMWh))} MWh Headroom</span></Tip>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div style={{ borderLeft: "2px solid #38c0fc", paddingLeft: 8 }}>
                    <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 2 }}>AVAILABLE DISCHARGE (MW)</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 900, color: sustainedDischargeMw > 0 ? "#38c0fc" : "#f0455a" }}>{f0(sustainedDischargeMw)}</span>
                        <span style={{ fontSize: 10, color: "#2a5570" }}>MW CAP</span>
                    </div>
                </div>
                <div style={{ borderLeft: "2px solid #1de98b", paddingLeft: 8 }}>
                    <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 2 }}>AVAILABLE CHARGE (MW)</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 900, color: sustainedChargeMw > 0 ? "#1de98b" : "#f0455a" }}>{f0(sustainedChargeMw)}</span>
                        <span style={{ fontSize: 10, color: "#2a5570" }}>MW CAP</span>
                    </div>
                </div>
            </div>

            <div style={{ marginTop: "auto", background: sustainedDischargeMw === 0 ? "#1f0709" : sustainedChargeMw === 0 ? "#1f0709" : "#071f13", border: `1px solid ${sustainedDischargeMw === 0 || sustainedChargeMw === 0 ? "#f0455a" : "#1de98b"}44`, borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 8.5, color: sustainedDischargeMw === 0 || sustainedChargeMw === 0 ? "#f0455a" : "#1de98b", fontWeight: 700 }}>
                    {sustainedDischargeMw === 0 ? "⚠️ Battery is empty. Discharge bids will be rejected." : sustainedChargeMw === 0 ? "⚠️ Battery is full. Charge bids will be rejected." : `✓ Operational autonomy verified. Reserve headroom available.`}
                </div>
            </div>
        </div>
    );

    // --- SECTION 3: MARKET BIDS ---
    const isDa = phase === "DA";
    const isId = phase === "ID";
    const isBm = phase === "BM";

    // Re-calculating the user constraints as they type. DA and ID use simple bid/ask numbers. BM offers direct injection/consumption MW values like generator.
    // Generator positive = discharge (long). BESS is the same. Negative = charge (short)

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
                    <p style={{ fontSize: 9, color: "#4d7a96", marginBottom: 16, lineHeight: 1.5 }}>Forward scheduling. Cannot bid larger volumes than physical {def.maxMW} MW capability.</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <button onClick={() => setDaMyBid(b => ({ ...b, side: "buy" }))} disabled={daSubmitted} style={{ padding: "8px", background: daMyBid.side === "buy" ? "#1de98b22" : "#102332", border: `1px solid ${daMyBid.side === "buy" ? "#1de98b" : "#1a3045"}`, borderRadius: 6, color: daMyBid.side === "buy" ? "#1de98b" : "#4d7a96", fontSize: 10, fontWeight: 800 }}>BUY (Charge Battery)</button>
                        <button onClick={() => setDaMyBid(b => ({ ...b, side: "sell" }))} disabled={daSubmitted} style={{ padding: "8px", background: daMyBid.side === "sell" ? "#38c0fc22" : "#102332", border: `1px solid ${daMyBid.side === "sell" ? "#38c0fc" : "#1a3045"}`, borderRadius: 6, color: daMyBid.side === "sell" ? "#38c0fc" : "#4d7a96", fontSize: 10, fontWeight: 800 }}>SELL (Discharge Battery)</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "auto" }}>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>VOLUME (MW)</label>
                            <input type="number" value={daMyBid.mw} disabled={daSubmitted} onChange={e => setDaMyBid(b => ({ ...b, mw: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#ddeeff", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>PRICE LIMIT £/MWh</label>
                            <input type="number" value={daMyBid.price} disabled={daSubmitted} onChange={e => setDaMyBid(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#f5b222", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                        </div>
                    </div>
                    {((daMyBid.side === "buy" && daMyBid.mw > sustainedChargeMw) || (daMyBid.side === "sell" && daMyBid.mw > sustainedDischargeMw)) && ( // Alert if we breach physics
                        <div style={{ fontSize: 8.5, color: "#f0455a", fontWeight: 700, padding: "6px 0", textAlign: "center" }}>⚠️ Warning: Bid exceeds valid physics envelope. Imbalance may trigger.</div>
                    )}
                    {/* SoC Commitment Warning: DA + ID combined cannot exceed available energy */}
                    {(() => {
                        const daCommitmentMwh = (daMyBid.side === "buy" ? -daMyBid.mw : daMyBid.mw) * SP_DURATION_H; // negative = charging
                        const idCommitmentMwh = (idMyOrder.side === "buy" ? -idMyOrder.mw : idMyOrder.mw) * SP_DURATION_H;
                        const totalMwh = daCommitmentMwh + idCommitmentMwh;
                        const chargeExceeded = daMyBid.side === "buy" && totalMwh < -maxChargeMwh; // Going too negative (charging too much)
                        const dischargeExceeded = daMyBid.side === "sell" && totalMwh > maxDischargeMwh; // Going too positive (discharging too much)
                        return (chargeExceeded || dischargeExceeded) ? (
                            <div style={{ fontSize: 8.5, color: "#f5b222", fontWeight: 700, padding: "6px 8px", textAlign: "center", background: "#1f1009", borderRadius: 4, marginTop: 8 }}>
                                ⚠️ DA+ID Energy Risk: {chargeExceeded ? `Will exceed charge headroom (${f1(maxChargeMwh)} MWh available).` : `Will exceed discharge capacity (${f1(maxDischargeMwh)} MWh available).`}
                            </div>
                        ) : null;
                    })()}
                    <button data-testid="bess-submit-da" onClick={onDaSubmit} disabled={daSubmitted || !daMyBid.price} style={{ marginTop: Math.max(0, 16 - (((daMyBid.side === "buy" && daMyBid.mw > sustainedChargeMw) || (daMyBid.side === "sell" && daMyBid.mw > sustainedDischargeMw)) ? 16 : 0)), width: "100%", padding: "12px", background: daSubmitted ? "#1a3045" : "#f5b222", border: "none", borderRadius: 6, color: daSubmitted ? "#4d7a96" : "#050e16", fontWeight: 800, fontSize: 12, cursor: daSubmitted ? "default" : "pointer" }}>
                        {daSubmitted ? "✓ DA SCHEDULE LOCKED" : "SUBMIT DA SCHEDULE →"}
                    </button>
                </>
            )}

            {isId && (
                <>
                    <p style={{ fontSize: 9, color: "#4d7a96", marginBottom: 16, lineHeight: 1.5 }}>Adjust DA state. Counter-trades will modify net physical notification (PN).</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <button onClick={() => setIdMyOrder(b => ({ ...b, side: "buy" }))} disabled={idSubmitted} style={{ padding: "8px", background: idMyOrder.side === "buy" ? "#1de98b22" : "#102332", border: `1px solid ${idMyOrder.side === "buy" ? "#1de98b" : "#1a3045"}`, borderRadius: 6, color: idMyOrder.side === "buy" ? "#1de98b" : "#4d7a96", fontSize: 10, fontWeight: 800 }}>BUY (Charge Battery)</button>
                        <button onClick={() => setIdMyOrder(b => ({ ...b, side: "sell" }))} disabled={idSubmitted} style={{ padding: "8px", background: idMyOrder.side === "sell" ? "#38c0fc22" : "#102332", border: `1px solid ${idMyOrder.side === "sell" ? "#38c0fc" : "#1a3045"}`, borderRadius: 6, color: idMyOrder.side === "sell" ? "#38c0fc" : "#4d7a96", fontSize: 10, fontWeight: 800 }}>SELL (Discharge Battery)</button>
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
                    {((idMyOrder.side === "buy" && idMyOrder.mw > sustainedChargeMw) || (idMyOrder.side === "sell" && idMyOrder.mw > sustainedDischargeMw)) && (
                        <div style={{ fontSize: 8.5, color: "#f0455a", fontWeight: 700, padding: "6px 0", textAlign: "center" }}>⚠️ Warning: Order breaches real-time limit. Avoid imbalance.</div>
                    )}
                    <button data-testid="bess-submit-id" onClick={onIdSubmit} disabled={idSubmitted || !idMyOrder.price} style={{ marginTop: 16, width: "100%", padding: "12px", background: idSubmitted ? "#1a3045" : "#38c0fc", border: "none", borderRadius: 6, color: idSubmitted ? "#4d7a96" : "#050e16", fontWeight: 800, fontSize: 12, cursor: idSubmitted ? "default" : "pointer" }}>
                        {idSubmitted ? "✓ ID ORDER PUBLISHED" : "SUBMIT ID ORDER →"}
                    </button>
                </>
            )}

            {(isBm || (!isDa && !isId)) && (
                <>
                    <p style={{ fontSize: 9, color: "#4d7a96", marginBottom: 12, lineHeight: 1.5 }}>Balancing Mechanism. Provide final physical action. Bids cannot breach SoC limits.</p>
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
                            <input type="number" max={isShort ? (contractPosition ? Math.min(def.maxMW, sustainedDischargeMw + (contractPosition > 0 ? (def.maxMWh - maxDischargeMwh) / (def.eff || 1) / 0.5 : 0)) : sustainedDischargeMw) : (contractPosition ? Math.min(def.maxMW, sustainedChargeMw + (contractPosition < 0 ? maxDischargeMwh * (def.eff || 1) / 0.5 : 0)) : sustainedChargeMw)} value={myBid.mw} disabled={submitted || phase !== "BM"} onChange={e => setMyBid(b => ({ ...b, mw: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#ddeeff", fontSize: 14, fontFamily: "'JetBrains Mono'", borderColor: (myBid.mw > (isShort ? sustainedDischargeMw : sustainedChargeMw)) ? "#f0455a" : "#234159" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 9, color: "#4d7a96", marginBottom: 6, display: "block" }}>BID PRICE £/MWh</label>
                            <input type="number" value={myBid.price} placeholder={`~£${f0((isShort ? sbp * SYSTEM_PARAMS.bidStrategyMultipliers.bessBM.sbpMultiplier : ssp * SYSTEM_PARAMS.bidStrategyMultipliers.bessBM.sspMultiplier))}`} disabled={submitted || phase !== "BM"} onChange={e => setMyBid(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "10px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: "#1de98b", fontSize: 14, fontFamily: "'JetBrains Mono'" }} />
                        </div>
                    </div>
                    {myBid.mw > 0 && (
                        <div style={{
                            marginTop: 8, padding: "6px 10px", borderRadius: 6,
                            background: "#071f13", border: "1px solid #1de98b44",
                            display: "flex", justifyContent: "space-between", alignItems: "center"
                        }}>
                            <span style={{ fontSize: 9, color: "#4d7a96" }}>Projected Final SoC</span>
                            <span style={{
                                fontFamily: "'JetBrains Mono'", fontSize: 12, fontWeight: 800,
                                color: projectedSoc < 20 ? "#f0455a" : projectedSoc > 80 ? "#f5b222" : "#1de98b"
                            }}>
                                {f1(currentSoc)}% → {f1(projectedSoc)}%
                            </span>
                        </div>
                    )}
                    {myBid.mw > (isShort ? sustainedDischargeMw : sustainedChargeMw) && (
                        <div style={{ fontSize: 8.5, color: "#f0455a", fontWeight: 700, padding: "6px 0", textAlign: "center" }}>⛔ Cannot bid above immediate battery limits. Will be rejected.</div>
                    )}

                    <button data-testid="bess-submit-bm" onClick={onSubmit} disabled={submitted || phase !== "BM" || !myBid.price || (myBid.mw > (isShort ? (contractPosition ? Math.min(def.maxMW, sustainedDischargeMw + (contractPosition > 0 ? (def.maxMWh - maxDischargeMwh) / (def.eff || 1) / 0.5 : 0)) : sustainedDischargeMw) : (contractPosition ? Math.min(def.maxMW, sustainedChargeMw + (contractPosition < 0 ? maxDischargeMwh * (def.eff || 1) / 0.5 : 0)) : sustainedChargeMw)))} style={{ marginTop: 16, width: "100%", padding: "12px", background: submitted || phase !== "BM" || (myBid.mw > (isShort ? (contractPosition ? Math.min(def.maxMW, sustainedDischargeMw + (contractPosition > 0 ? (def.maxMWh - maxDischargeMwh) / (def.eff || 1) / 0.5 : 0)) : sustainedDischargeMw) : (contractPosition ? Math.min(def.maxMW, sustainedChargeMw + (contractPosition < 0 ? maxDischargeMwh * (def.eff || 1) / 0.5 : 0)) : sustainedChargeMw))) ? "#1a3045" : (isShort ? "#38c0fc" : "#1de98b"), border: "none", borderRadius: 6, color: submitted || phase !== "BM" || (myBid.mw > (isShort ? (contractPosition ? Math.min(def.maxMW, sustainedDischargeMw + (contractPosition > 0 ? (def.maxMWh - maxDischargeMwh) / (def.eff || 1) / 0.5 : 0)) : sustainedDischargeMw) : (contractPosition ? Math.min(def.maxMW, sustainedChargeMw + (contractPosition < 0 ? maxDischargeMwh * (def.eff || 1) / 0.5 : 0)) : sustainedChargeMw))) ? "#4d7a96" : "#050e16", fontWeight: 800, fontSize: 12, cursor: submitted || phase !== "BM" || (myBid.mw > (isShort ? (contractPosition ? Math.min(def.maxMW, sustainedDischargeMw + (contractPosition > 0 ? (def.maxMWh - maxDischargeMwh) / (def.eff || 1) / 0.5 : 0)) : sustainedDischargeMw) : (contractPosition ? Math.min(def.maxMW, sustainedChargeMw + (contractPosition < 0 ? maxDischargeMwh * (def.eff || 1) / 0.5 : 0)) : sustainedChargeMw))) ? "default" : "pointer" }}>
                        {phase !== "BM" ? "AWAITING BM PHASE..." : submitted ? "✓ BM BID SUBMITTED" : (isShort ? "OFFER RESERVE & DISCHARGE →" : "BID TO ABSORB & CHARGE →")}
                    </button>
                </>
            )}
        </div>
    );

    // --- SECTION 4: REAL-TIME SETTLEMENT & IMBALANCE ---
    const sect4RealTime = (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", height: "100%", background: "#050e16" }}>
            <h3 style={{ fontSize: 12, color: "#fff", marginBottom: 16, letterSpacing: 1 }}>4. REAL-TIME OPERATIONS & SETTLEMENT</h3>

            <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 8, padding: 16, marginBottom: 20, flex: 1, display: "flex", flexDirection: "column" }}>
                <Tip text="If your battery runs empty while you have promised to discharge, or fills up while you promised to charge, you will suffer a financial imbalance penalty from ELEXON.">
                    <div style={{ fontSize: 10, color: "#4d7a96", fontWeight: 800, textTransform: "uppercase", marginBottom: 8, borderBottom: "1px dashed #4d7a96", display: "inline-block", cursor: "help" }}>Energy Delivery Risk</div>
                </Tip>
                <div style={{ fontSize: 9, color: "#2a5570", marginBottom: 20, lineHeight: 1.5 }}>
                    If you contracted power but your SoC depletes (or exceeds Max), you suffer <b>imbalance exposure</b> equivalent to the energy unfulfilled.
                </div>

                <div style={{ background: "#050e16", border: "1px solid #1a3045", borderRadius: 6, padding: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4 }}>CONTRACTED (PN)</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 16, fontWeight: 800, color: contractPosition > 0 ? "#38c0fc" : contractPosition < 0 ? "#1de98b" : "#4d7a96" }}>{contractPosition > 0 ? "+" : ""}{f0(contractPosition)} <span style={{ fontSize: 10 }}>MW</span></div>
                    </div>
                    <div style={{ fontSize: 14, color: "#2a5570" }}>VS</div>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4 }}>PHYSICAL TARGET</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 16, fontWeight: 800, color: "#ddeeff" }}>
                            {(() => {
                                // Use explicit direction from bmAccepted — not grid isShort inference
                                const bmDir = cSp.bmAccepted?.direction;
                                const bmMw = cSp.bmAccepted?.mw || 0;
                                const bmSigned = bmDir === 'discharge' ? bmMw : bmDir === 'charge' ? -bmMw : 0;
                                const target = contractPosition + bmSigned;
                                return `${target > 0 ? "+" : ""}${f0(target)}`;
                            })()} <span style={{ fontSize: 10 }}>MW</span>
                        </div>
                    </div>
                </div>

                <div style={{ marginTop: "auto", textAlign: "center", paddingTop: 16, borderTop: "1px solid #1a3045" }}>
                    <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4 }}>DANGER TO DELIVERY</div>
                    {(() => {
                        const bmDir = cSp.bmAccepted?.direction;
                        const bmMw = cSp.bmAccepted?.mw || 0;
                        const bmSigned = bmDir === 'discharge' ? bmMw : bmDir === 'charge' ? -bmMw : 0;
                        const target = contractPosition + bmSigned;
                        if (target > sustainedDischargeMw) return (
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#f0455a", fontWeight: 900 }}>EMPTY EVENT IMMINENT<br /><span style={{ fontSize: 9, color: "#f5b222" }}>SHORT EXPOSURE</span></div>
                        );
                        if (target < -sustainedChargeMw) return (
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#f0455a", fontWeight: 900 }}>FULL EVENT IMMINENT<br /><span style={{ fontSize: 9, color: "#f5b222" }}>LONG EXPOSURE</span></div>
                        );
                        return <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#1de98b", fontWeight: 900 }}>SAFE (WITHIN BOUNDS)</div>;
                    })()}
                </div>
            </div>

            {/* Energy flow summary for this SP */}
            {market && (
                <div style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid #1a3045" }}>
                    <Tip text="Net power you are delivering to (discharging) or absorbing from (charging) the grid this Settlement Period, and the energy that represents.">
                        <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px dashed #4d7a96", display: "inline-block", cursor: "help" }}>
                            Energy Flow This SP
                        </div>
                    </Tip>
                    {(() => {
                        // Bug fix: was deriving BM sign from isShort (grid state), which is wrong —
                        // a BESS could charge into a short grid or discharge into a long grid deliberately.
                        // The explicit direction stored on bmAccepted must be the authority.
                        // bmAccepted.direction: 'discharge' = positive (giving), 'charge' = negative (taking)
                        const bmDir = cSp.bmAccepted?.direction;
                        const bmMw = cSp.bmAccepted?.mw || 0;
                        const bmSignedMw = bmDir === 'discharge' ? bmMw : bmDir === 'charge' ? -bmMw : 0;
                        const physicalTargetMw = (contractPosition || 0) + bmSignedMw;
                        const flowMw = physicalTargetMw;
                        const flowMwh = flowMw * SP_DURATION_H;
                        const flowLabel = flowMw > 0 ? "Giving energy to market (discharging)" : flowMw < 0 ? "Taking energy from market (charging)" : "Neutral (no net flow)";
                        return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                    <div style={{ fontSize: 9, color: "#2a5570" }}>{flowLabel}</div>
                                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, fontWeight: 800, color: flowMw >= 0 ? "#38c0fc" : "#1de98b" }}>
                                        {flowMw >= 0 ? "+" : ""}{f0(flowMw)} MW ({(flowMwh >= 0 ? "+" : "") + f1(flowMwh)} MWh)
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}

            <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 9, color: "#4d7a96", fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>REVENUE BREAKDOWN (Profit/Cycle)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div>
                        <div style={{ fontSize: 8, color: "#2a5570", marginBottom: 2 }}>DA REVENUE</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#f5b222", fontWeight: 800 }}>£{f0(daCash || 0)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: 8, color: "#2a5570", marginBottom: 2 }}>ID/BM/IMBAL</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#38c0fc", fontWeight: 800 }}>£{f0(nonDaRev)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: 8, color: "#2a5570", marginBottom: 2 }}>TOTAL</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: totalRev >= 0 ? "#1de98b" : "#f0455a", fontWeight: 800 }}>£{f0(totalRev)}</div>
                    </div>
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
