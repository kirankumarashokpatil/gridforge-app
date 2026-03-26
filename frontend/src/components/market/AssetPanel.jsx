import { ASSETS, ROLES, SP_DURATION_H } from "../../shared/constants.js";
import { f0, f1 } from "../../shared/utils.js";
import { clearBM } from "../../engine/MarketEngine.js";
import { availMW, availMWDirectional } from "../../engine/AssetPhysics.js";
import { canSubmitBmBid } from "../../engine/GateLogic.js";
import AnimatedPL from "../ui/AnimatedPL";
import CapacityWidget from "./CapacityWidget";
import ForecastStrip from "./ForecastStrip";

/* ─── ASSET PANEL ─── */
export default function AssetPanel({ market, soc, cash, daCash, myBid, setMyBid, submitted, onSubmit, lastRes, phase, playerName, assetKey, allBids, simRes, pid, forecasts }) {
  const { isShort, sbp, ssp, wf } = market;
  const def = ASSETS[assetKey] || {};
  const avail = availMW(def, soc, market);
  const canJoin = def.sides === "both" || (def.sides === "short" && isShort) || (def.sides === "long" && !isShort);
  const ref = isShort ? sbp : ssp, pn = +myBid.price;
  const ok = myBid.price && !isNaN(pn) && (isShort ? pn <= ref * 1.05 : pn >= ref * 0.95);
  const isDaPhase = ["FORECAST_0", "FORECAST_1", "FORECAST_2", "FORECAST", "DA", "IDA1", "IDA2", "ID", "ID_ROUNDS"].includes(phase);
  const isBm = ["BM", "BM_OPEN", "BM_CLEAR", "REALTIME"].includes(phase);
  const canSub = canJoin && !submitted && myBid.price && !isNaN(pn) && +myBid.mw > 0 && +myBid.mw <= avail + 0.5 && isBm;
  const qPrices = isShort ? [{ val: Math.round(sbp * 0.60), label: "Aggressive", sub: "60% SBP" }, { val: Math.round(sbp * 0.82), label: "Moderate", sub: "82% SBP" }, { val: Math.round(sbp * 0.97), label: "At market", sub: "≈SBP" }] : [{ val: Math.round(ssp * 1.38), label: "Aggressive", sub: "138% SSP" }, { val: Math.round(ssp * 1.14), label: "Moderate", sub: "114% SSP" }, { val: Math.round(ssp * 0.97), label: "At market", sub: "≈SSP" }];
  const smartBid = () => { let sp; if (def.key === "WIND") sp = 5; else if (def.key === "DSR") sp = isShort ? Math.round(sbp * 0.45) : Math.round(ssp * 1.45); else if (def.key === "OCGT") sp = Math.round(sbp * 0.85); else if (def.key === "HYDRO") sp = isShort ? Math.round(sbp * 0.70) : Math.round(ssp * 1.22); else sp = isShort ? Math.round(sbp * 0.78) : Math.round(ssp * 1.18); setMyBid(b => ({ ...b, price: String(sp), mw: Math.min(Math.floor(avail), def.maxMW) })); };
  const myBidObj = (myBid.price && !isNaN(+myBid.price) && +myBid.mw > 0) ? { id: pid || "preview", name: "You", asset: assetKey, mw: +myBid.mw, price: +myBid.price, side: isShort ? "offer" : "bid", col: def.col, isBot: false } : null;
  const bidsWithMine = myBidObj ? [...allBids.filter(b => b.id !== pid), myBidObj] : allBids;
  const previewRes = myBidObj ? clearBM(bidsWithMine, market) : null;
  const previewMine = previewRes?.accepted.find(a => a.id === (pid || "preview"));
  const previewRank = myBidObj ? [...bidsWithMine].filter(b => b.side === (isShort ? "offer" : "bid") && +b.mw > 0).sort((a, b) => isShort ? +a.price - +b.price : +b.price - +a.price).findIndex(b => b.id === (pid || "preview")) : -1;
  return (
    <div style={{ padding: 11, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ background: "#0c1c2a", border: `1px solid ${def.col || "#1a3045"}33`, borderRadius: 9, padding: "9px 11px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>{def.emoji}</span>
          <div style={{ flex: 1 }}><div style={{ fontSize: 11.5, fontWeight: 800 }}>{playerName}</div><div style={{ fontSize: 8.5, color: def.col, fontWeight: 700 }}>{def.name} · {def.maxMW}MW</div></div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 7, color: "#4d7a96" }}>BM P&L</div><AnimatedPL value={cash} />{daCash !== 0 && <div style={{ fontSize: 7.5, color: "#f5b222", fontFamily: "'JetBrains Mono'" }}>+£{f0(daCash)} DA</div>}</div>
        </div>
      </div>
      <div style={{ background: isShort ? "#1f0709" : "#071f13", border: `1px solid ${isShort ? "#f0455a" : "#1de98b"}44`, borderRadius: 8, padding: "7px 11px", textAlign: "center" }}>
        <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>GRID SIGNAL</div>
        <div style={{ fontSize: 15, fontWeight: 900, color: isShort ? "#f0455a" : "#1de98b" }}>{isShort ? "🔴 SYSTEM SHORT" : "🟢 SYSTEM LONG"}</div>
        <div style={{ fontSize: 8, color: "#4d7a96", marginTop: 2 }}>{isShort ? `${f0(Math.abs(market.niv))} MW deficit → you are a SELLER` : `${f0(market.niv)} MW surplus → you are a BUYER`}</div>
        <div style={{ marginTop: 5, display: "flex", justifyContent: "center", gap: 7 }}>
          <div style={{ padding: "2px 7px", borderRadius: 4, background: isShort ? "#f0455a22" : "#1a3045", border: `1px solid ${isShort ? "#f0455a44" : "#1a3045"}`, fontSize: 7.5, color: isShort ? "#f0455a" : "#2a5570", fontWeight: isShort ? 700 : 400 }}>⬆ SELLERS</div>
          <div style={{ padding: "2px 7px", borderRadius: 4, background: !isShort ? "#1de98b22" : "#1a3045", border: `1px solid ${!isShort ? "#1de98b44" : "#1a3045"}`, fontSize: 7.5, color: !isShort ? "#1de98b" : "#2a5570", fontWeight: !isShort ? 700 : 400 }}>⬇ BUYERS</div>
        </div>
      </div>
      <CapacityWidget def={def} soc={soc} wf={wf} market={market} avail={avail} lastRes={lastRes} />
      <ForecastStrip forecasts={forecasts} />
      {!isDaPhase && canJoin ? (
        <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 9, padding: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
            <div style={{ fontSize: 8.5, color: "#4d7a96", textTransform: "uppercase", letterSpacing: .8 }}>{isShort ? "You are a SELLER — Submit Offer" : "You are a BUYER — Submit Bid"}</div>
            <button onClick={smartBid} disabled={submitted || !isBm} style={{ padding: "3px 8px", background: "#102332", border: "1px solid #234159", borderRadius: 4, color: "#38c0fc", fontSize: 8, cursor: "pointer", fontWeight: 700 }}>✦ Smart</button>
          </div>
          <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>VOLUME (MW) — {f0(avail)} MW available</div>
          <div style={{ display: "flex", gap: 5, marginBottom: 7 }}>
            <input type="number" value={myBid.mw} min={1} max={avail} disabled={submitted || !isBm} onChange={e => setMyBid(b => ({ ...b, mw: Math.max(1, Math.min(+e.target.value || 1, def.maxMW)) }))} style={{ flex: 1, padding: "7px 9px", background: "#102332", border: "1px solid #234159", borderRadius: 5, color: "#ddeeff", fontSize: 13, fontFamily: "'JetBrains Mono'" }} />
            <button onClick={() => setMyBid(b => ({ ...b, mw: Math.floor(avail) }))} disabled={submitted || !isBm} style={{ padding: "0 9px", background: "#102332", border: "1px solid #234159", borderRadius: 5, color: "#4d7a96", fontSize: 8, cursor: "pointer" }}>MAX</button>
          </div>
          <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>{isShort ? "OFFER PRICE" : "BID PRICE"} (£/MWh) <span style={{ color: "#2a5570" }}>ref {isShort ? `SBP £${f0(sbp)}` : `SSP £${f0(ssp)}`}</span></div>
          <input type="number" value={myBid.price} placeholder={`~£${f0(ref * (isShort ? 0.82 : 1.18))}`} disabled={submitted || !isBm} onChange={e => setMyBid(b => ({ ...b, price: e.target.value }))} style={{ width: "100%", padding: "7px 9px", background: "#102332", border: `1px solid ${myBid.price ? (ok ? "#1de98b44" : "#f0455a44") : "#234159"}`, borderRadius: 5, color: "#ddeeff", fontSize: 13, fontFamily: "'JetBrains Mono'", marginBottom: 3 }} />
          {myBid.price && <div style={{ fontSize: 7.5, color: ok ? "#1de98b" : "#f5b222", marginBottom: 5 }}>{ok ? "✓ Competitive — likely accepted in merit order" : "⚠ Aggressive — risk being out-competed"}</div>}
          {myBidObj && (
            <div className="fadeIn" style={{ background: previewMine ? "#071f13" : "#0c0c18", border: `1px solid ${previewMine ? "#1de98b33" : "#2a5570"}`, borderRadius: 7, padding: "7px 9px", marginBottom: 6 }}>
              <div style={{ fontSize: 7.5, color: "#2a5570", marginBottom: 4, textTransform: "uppercase", letterSpacing: .6 }}>Live Simulation Preview</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                <div><div style={{ fontSize: 7, color: "#2a5570" }}>MERIT RANK</div><div style={{ fontSize: 12, fontFamily: "'JetBrains Mono'", fontWeight: 700, color: previewRank < 3 ? "#1de98b" : "#f5b222" }}>#{previewRank + 1}</div></div>
                <div><div style={{ fontSize: 7, color: "#2a5570" }}>EST. REVENUE</div><div style={{ fontSize: 12, fontFamily: "'JetBrains Mono'", fontWeight: 700, color: previewMine ? "#1de98b" : "#4d7a96" }}>{previewMine ? `+£${f0(previewMine.mwAcc * (previewRes?.cp || 0) * SP_DURATION_H)}` : "—"}</div></div>
                <div><div style={{ fontSize: 7, color: "#2a5570" }}>OUTCOME</div><div style={{ fontSize: 9, fontWeight: 700, color: previewMine ? "#1de98b" : "#f0455a" }}>{previewMine ? "✓ ACCEPT" : "✗ REJECT"}</div></div>
              </div>
              {previewMine && previewRes?.cp > pn && isShort && <div style={{ fontSize: 7.5, color: "#38c0fc", marginTop: 3 }}>↑ Uniform price lifts your £{myBid.price} → £{f1(previewRes.cp)}</div>}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4, marginBottom: 7 }}>
            {qPrices.map((q, i) => (
              <button key={i} onClick={() => setMyBid(b => ({ ...b, price: String(q.val) }))} disabled={submitted || !isBm} style={{ padding: "5px 0", background: "#102332", border: `1px solid ${myBid.price === String(q.val) ? "#38c0fc44" : "#234159"}`, borderRadius: 4, color: myBid.price === String(q.val) ? "#38c0fc" : "#4d7a96", fontSize: 7.5, cursor: "pointer", fontFamily: "'JetBrains Mono'", transition: "all .12s" }}>
                <div style={{ fontSize: 6.5, color: "#2a5570", marginBottom: 1 }}>{q.label}</div>£{q.val}<div style={{ fontSize: 6, color: "#1e3d54", marginTop: 1 }}>{q.sub}</div>
              </button>
            ))}
          </div>
          <button onClick={onSubmit} disabled={!canSub} style={{ width: "100%", padding: 10, borderRadius: 6, border: "none", background: submitted ? "#102332" : canSub ? (isShort ? "#f0455a" : "#1de98b") : "#1a3045", color: submitted ? "#4d7a96" : canSub ? "#050e16" : "#4d7a96", fontWeight: 900, fontSize: 13, cursor: canSub ? "pointer" : "default", letterSpacing: .4, fontFamily: "'Outfit'", transition: "all .18s" }}>
            {submitted ? "✓ SUBMITTED" : !isBm ? "AWAITING BM PHASE..." : `${isShort ? "SELL — SUBMIT OFFER" : "BUY — SUBMIT BID"} →`}
          </button>
        </div>
      ) : !isDaPhase && (
        <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 9, padding: "12px 11px", textAlign: "center" }}>
          <div style={{ fontSize: 20, marginBottom: 5 }}>{def.emoji}</div>
          <div style={{ fontSize: 10.5, color: "#f5b222", fontWeight: 700, marginBottom: 4 }}>Sitting out this SP</div>
          <div style={{ fontSize: 8.5, color: "#4d7a96", lineHeight: 1.65 }}>
            {def.key === "OCGT" && "Gas peakers only dispatch when SHORT. Wait for next shortfall."}
            {def.key === "WIND" && "Wind farms only sell when SHORT. No action when LONG."}
          </div>
        </div>
      )}
      {lastRes && (
        <div className={`fadeUp ${lastRes.accepted ? "accepted-glow" : ""}`} style={{ background: lastRes.accepted ? "#071f13" : "#0c0c18", border: `1px solid ${lastRes.accepted ? "#1de98b44" : "#f0455a22"}`, borderRadius: 8, padding: "8px 11px" }}>
          <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 3 }}>LAST SP RESULT</div>
          {lastRes.accepted ? (<>
            <div style={{ fontSize: 9.5, color: "#1de98b", fontWeight: 700 }}>✓ {f0(lastRes.mw)} MW dispatched @ £{f1(lastRes.cp)}/MWh</div>
            {lastRes.isShort && lastRes.myPrice < lastRes.cp && <div style={{ fontSize: 8, color: "#f5b222", marginTop: 2 }}>↑ Uniform price lifted your £{f0(lastRes.myPrice)} offer → £{f1(lastRes.cp)}</div>}
            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 900, color: "#1de98b", marginTop: 3 }}>+£{f0(lastRes.revenue)}</div>
            <div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 2 }}>SoC: {f1(lastRes.prevSof || 0)}% → {f1(lastRes.newSof || 0)}%</div>
          </>) : (<div style={{ fontSize: 9.5, color: "#4d7a96" }}>✗ Out of merit — not dispatched this SP</div>)}
        </div>
      )}
      <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: "8px 10px", fontSize: 8.5, color: "#2a5570", lineHeight: 1.75, marginTop: "auto" }}>
        <strong style={{ color: "#4d7a96" }}>Strategy</strong><br />
        {def.key === "OCGT" && "Bid near £90 when SHORT for near-certain dispatch. In scarcity events, price higher. Save fuel for peak prices."}
        {def.key === "WIND" && "Bid £0–10. Near-zero cost = always near front of merit order. Only fails if no shortfall."}
        {def.key === "DSR" && "No energy limits. Bid very low when SHORT (SELLER), very high when LONG (BUYER). Should never miss."}
        {def.key === "HYDRO" && "Huge capacity, cheap to run. Save SoC for HIGH price SPs — Dunkel, spikes, cold snaps. Use forecast!"}
        {(def.key === "BESS_S" || def.key === "BESS_M" || def.key === "BESS_L") && "SELL (discharge) when SHORT + high price. BUY (charge) when LONG + low price. Use forecast to plan SoC."}
      </div>
    </div>
  );
}
