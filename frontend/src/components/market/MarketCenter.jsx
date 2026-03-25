import { f0, f1 } from "../../shared/utils.js";
import { Tip } from "../shared/Tip";
import SupplyDemandCurve from "../shared/SupplyDemandCurve";
import TwoSidedOrderBook from "../shared/TwoSidedOrderBook";

/* ─── MARKET CENTER (BM sub-components kept here — only used within MarketCenter) ─── */

const BM = ({ label, val, vc, sub, border, tip }) => { const inner = (<div style={{ padding: "9px 11px", borderLeft: border ? "1px solid #1a3045" : "none" }}><div style={{ fontSize: 7.5, color: "#4d7a96", marginBottom: 3, textTransform: "uppercase", letterSpacing: .5 }}>{label}</div><div style={{ fontSize: 18, fontFamily: "'JetBrains Mono'", fontWeight: 900, color: vc || "#ddeeff" }}>{val}</div><div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 1 }}>{sub}</div></div>); return tip ? <Tip text={tip}>{inner}</Tip> : inner; };

function PriceChart({ history }) {
  const prices = history.map(h => h.cp).filter(Boolean);
  if (prices.length < 2) return null;
  const W = 460, H = 38, YPAD = 5;
  const lo = Math.min(...prices) * 0.9, hi = Math.max(...prices) * 1.1, range = hi - lo || 1;
  const pts = prices.map((p, i) => `${((i / (prices.length - 1)) * W).toFixed(1)},${(H - ((p - lo) / range) * (H - YPAD * 2) + YPAD).toFixed(1)}`);
  const path = "M " + pts.join(" L "); const lastY = H - ((prices[prices.length - 1] - lo) / range) * (H - YPAD * 2) + YPAD;
  return (
    <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 6, padding: "4px 9px", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 1 }}>
        <div style={{ fontSize: 7.5, color: "#4d7a96" }}>CLEARING PRICE HISTORY</div>
        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 8.5, fontWeight: 700, color: "#f5b222" }}>£{f1(prices[prices.length - 1])} last</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: "calc(100% - 18px)" }}>
        <defs><linearGradient id="pg5" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f5b222" stopOpacity=".2" /><stop offset="100%" stopColor="#f5b222" stopOpacity=".02" /></linearGradient></defs>
        {[0, .5, 1].map((t, i) => <line key={i} x1={0} y1={YPAD + (1 - t) * (H - YPAD * 2)} x2={W} y2={YPAD + (1 - t) * (H - YPAD * 2)} stroke="#1a3045" strokeWidth="0.5" />)}
        <path d={path + ` L ${W},${H} L 0,${H} Z`} fill="url(#pg5)" />
        <path d={path} fill="none" stroke="#f5b222" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <circle cx={W} cy={lastY} r="3" fill="#f5b222" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export default function MarketCenter({ market, allBids, simRes, spHistory, pid, assetKey }) {
  const { niv, isShort, sbp, ssp, freq, event } = market;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", borderBottom: "1px solid #1a3045", flexShrink: 0 }}>
        <BM label="NET IMBALANCE" val={`${niv >= 0 ? "+" : ""}${f0(niv)} MW`} vc={isShort ? "#f0455a" : "#1de98b"} sub={isShort ? "SHORT — ESO buys MW" : "LONG — ESO sells MW"} tip="NIV: Negative = SHORT (needs MW). Positive = LONG (surplus MW). ESO balances through accepted BM actions." />
        <BM label="FREQUENCY" val={`${freq.toFixed(3)} Hz`} vc={freq < 49.75 ? "#f0455a" : freq > 50.25 ? "#38c0fc" : "#1de98b"} sub="Target 50.000 Hz" border tip="Grid frequency. 50Hz = balanced. Falls below 50 when SHORT, rises when LONG." />
        <BM label="SYSTEM BUY PRICE" val={`£${f1(sbp)}`} vc="#f5b222" sub="Sellers earn this" border tip="SBP — price ESO pays when SHORT. Ceiling for seller revenue this SP." />
        <BM label="SYSTEM SELL PRICE" val={`£${f1(ssp)}`} vc="#38c0fc" sub="Buyers earn this" border tip="SSP — price ESO receives when LONG. Buyers earn this as revenue." />
      </div>
      {event && (<div className="fadeUp" style={{ padding: "6px 12px", background: isShort ? "#130608" : "#071f13", borderBottom: `1px solid ${event.col}33`, display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>{event.emoji}</span>
        <div style={{ flex: 1 }}><div style={{ fontSize: 10.5, fontWeight: 800, color: event.col }}>{event.name}</div><div style={{ fontSize: 8.5, color: "#4d7a96" }}>{event.desc}</div></div>
        <div style={{ textAlign: "right", flexShrink: 0 }}><div style={{ fontSize: 7, color: "#4d7a96" }}>PRICE IMPACT</div><div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 700, color: event.col }}>{event.pd >= 0 ? "+" : ""}£{Math.abs(event.pd)}/MWh</div></div>
      </div>)}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", padding: "7px 10px", gap: 6 }}>
        <SupplyDemandCurve allBids={allBids} market={market} simRes={simRes} />
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, gap: 8 }}>
          <Tip text="SELLERS submit OFFERS when SHORT. BUYERS submit BIDS when LONG. Only the active side is dispatched each SP."><span style={{ fontSize: 8.5, color: "#4d7a96", textTransform: "uppercase", letterSpacing: .8, borderBottom: "1px dashed #2a5570", cursor: "help" }}>Live Two-Sided Order Book</span></Tip>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, fontSize: 8.5 }}>
            <span style={{ color: isShort ? "#f0455a" : "#2a5570", fontWeight: 700 }}>{allBids.filter(b => b.side === "offer").length} sellers</span>
            <span style={{ color: !isShort ? "#1de98b" : "#2a5570", fontWeight: 700 }}>{allBids.filter(b => b.side === "bid").length} buyers</span>
            <span style={{ color: "#38c0fc", fontWeight: 700 }}>{f0(simRes.cleared)} MW cleared</span>
            {simRes.full && <span style={{ color: "#1de98b", fontWeight: 800 }}>✓ FULL</span>}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <TwoSidedOrderBook allBids={allBids} market={market} simRes={simRes} pid={pid} assetKey={assetKey} />
        </div>
        {spHistory.length > 2 && <div style={{ height: 56, flexShrink: 0 }}><PriceChart history={[...spHistory].reverse()} /></div>}
      </div>
    </div>
  );
}
