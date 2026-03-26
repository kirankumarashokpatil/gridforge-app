import { useState, useEffect } from "react";
import { MIN_SOC, MAX_SOC, SP_DURATION_H } from "../../shared/constants.js";
import { clamp, f0, f1 } from "../../shared/utils.js";
import { Tip } from "../shared/Tip";

/* ─── CAPACITY WIDGET ─── */
export default function CapacityWidget({ def, soc, wf, market, avail, lastRes }) {
  const { isShort } = market;
  const [flowDir, setFlowDir] = useState(null), [flowKey, setFlowKey] = useState(0), [socPulseKey, setSocPulseKey] = useState(0);
  useEffect(() => {
    if (lastRes?.accepted && (def.kind === "soc" || def.kind === "fuel")) {
      const dir = lastRes.isShort ? "discharge" : "charge"; setFlowDir(dir); setFlowKey(k => k + 1); setSocPulseKey(k => k + 1);
      setTimeout(() => setFlowDir(null), 2500);
    }
  }, [lastRes, def.kind]);
  const FlowArrows = ({ dir }) => { const isDis = dir === "discharge", col = isDis ? "#f0455a" : "#1de98b"; return (<div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "3px 0" }}><span style={{ fontSize: 9, color: col, fontWeight: 700 }}>{isDis ? "Discharging →" : "← Charging"}</span>{[0, 1, 2, 3].map(i => (<span key={i} style={{ fontSize: 12, color: col, display: "inline-block", animation: `${isDis ? "flowDown" : "flowUp"} 0.8s ${i * 0.14}s ease-in-out infinite` }}>{isDis ? "↓" : "↑"}</span>))}</div>); };
  if (def.kind === "soc") {
    const barCol = soc < 22 ? "#f0455a" : soc > 78 ? "#38c0fc" : def.col;
    const availDis = clamp(((soc - MIN_SOC) / 100 * def.maxMWh) / 0.5, 0, def.maxMW);
    const availCha = clamp(((MAX_SOC - soc) / 100 * def.maxMWh * def.eff) / 0.5, 0, def.maxMW);
    return (
      <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 9, padding: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 9.5 }}>
          <Tip text="State of Charge — % of energy stored. Below 10% = can't discharge. Above 90% = can't charge. Efficiency loss applies on charging."><span style={{ color: "#4d7a96", borderBottom: "1px dashed #2a5570", cursor: "help" }}>STATE OF CHARGE</span></Tip>
          <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700, color: barCol }}>{f1(soc)}%</span>
        </div>
        <div style={{ height: 17, background: "#162c3d", borderRadius: 4, position: "relative", overflow: "hidden", marginBottom: 6 }} key={socPulseKey}>
          <div style={{ position: "absolute", left: `${MIN_SOC}%`, top: 0, height: "100%", width: 1, background: "#f0455a66" }} />
          <div style={{ position: "absolute", left: `${MAX_SOC}%`, top: 0, height: "100%", width: 1, background: "#38c0fc66" }} />
          <div className={socPulseKey > 0 ? "soc-pulse" : ""} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${soc}%`, background: barCol, transition: "width .8s cubic-bezier(.4,0,.2,1), background .3s", borderRadius: 4, opacity: .9 }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7.5, color: "rgba(255,255,255,.7)", fontWeight: 700, pointerEvents: "none" }}>{f1(soc / 100 * def.maxMWh)} / {def.maxMWh} MWh</div>
          {flowDir && <div style={{ position: "absolute", top: 0, bottom: 0, width: 3, background: `linear-gradient(transparent,${flowDir === "discharge" ? "#f0455a" : "#1de98b"},transparent)`, left: `${soc}%`, transform: "translateX(-50%)", animation: `${flowDir === "discharge" ? "flowDown" : "flowUp"} 0.6s ease-in-out infinite`, opacity: .8 }} />}
        </div>
        {flowDir && <FlowArrows key={flowKey} dir={flowDir} />}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: flowDir ? 0 : 2 }}>
          <div style={{ background: isShort ? "#1f0709" : "#071f13", borderRadius: 5, padding: "4px 7px", border: `1px solid ${isShort ? "#f0455a18" : "#1de98b18"}`, opacity: isShort ? 1 : .5 }}>
            <div style={{ fontSize: 7, color: "#4d7a96" }}>⬆ DISCHARGE (SELL)</div>
            <div style={{ fontFamily: "'JetBrains Mono'", color: isShort ? "#f0455a" : "#4d7a96", fontWeight: 700, fontSize: 11 }}>{f0(availDis)} MW</div>
          </div>
          <div style={{ background: !isShort ? "#021520" : "#071f13", borderRadius: 5, padding: "4px 7px", border: `1px solid ${!isShort ? "#38c0fc18" : "#1a3045"}`, opacity: !isShort ? 1 : .5 }}>
            <div style={{ fontSize: 7, color: "#4d7a96" }}>⬇ CHARGE (BUY)</div>
            <div style={{ fontFamily: "'JetBrains Mono'", color: !isShort ? "#38c0fc" : "#4d7a96", fontWeight: 700, fontSize: 11 }}>{f0(availCha)} MW</div>
          </div>
        </div>
        <div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 5 }}>η={f0(def.eff * 100)}% · wear £{def.wear}/MWh · bounds {MIN_SOC}–{MAX_SOC}%</div>
      </div>
    );
  }
  if (def.kind === "fuel") {
    const pct = (soc / def.fuelMWh) * 100, fCol = pct < 20 ? "#f0455a" : pct < 45 ? "#f5b222" : def.col;
    return (
      <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 9, padding: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 9.5 }}><span style={{ color: "#4d7a96" }}>FUEL TANK</span><span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700, color: fCol }}>{f1(pct)}%</span></div>
        <div style={{ height: 16, background: "#162c3d", borderRadius: 4, overflow: "hidden", marginBottom: 6, position: "relative" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: fCol, transition: "width .8s cubic-bezier(.4,0,.2,1)", borderRadius: 4, opacity: .88 }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7.5, color: "rgba(255,255,255,.65)", fontWeight: 700 }}>{f0(soc)} / {def.fuelMWh} MWh</div>
        </div>
        {flowDir && <FlowArrows key={flowKey} dir={flowDir} />}
        <div style={{ background: "#1f0709", borderRadius: 5, padding: "4px 7px", border: "1px solid #f0455a18" }}>
          <div style={{ fontSize: 7, color: "#4d7a96" }}>⬆ AVAILABLE (SELLER)</div>
          <div style={{ fontFamily: "'JetBrains Mono'", color: def.col, fontWeight: 700, fontSize: 11 }}>{f0(avail)} MW</div>
        </div>
        <div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 5 }}>Fuel: {f0(soc)}/{def.fuelMWh} MWh · ~£90/MWh marginal · SELLER only</div>
      </div>
    );
  }
  if (def.kind === "wind") {
    const pct = (wf || 0) * 100, wCol = pct < 20 ? "#f0455a" : pct < 50 ? "#f5b222" : def.col;
    return (
      <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 9, padding: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 9.5 }}><span style={{ color: "#4d7a96" }}>WIND OUTPUT</span><span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700, color: wCol }}>{f1(pct)}% cap.</span></div>
        <div style={{ height: 16, background: "#162c3d", borderRadius: 4, overflow: "hidden", marginBottom: 6 }}><div style={{ height: "100%", width: `${pct}%`, background: wCol, transition: "width .6s", borderRadius: 4, opacity: .88 }} /></div>
        <div style={{ background: "#071f13", borderRadius: 5, padding: "4px 7px", border: "1px solid #a3e63518" }}>
          <div style={{ fontSize: 7, color: "#4d7a96" }}>⬆ AVAILABLE (SELLER)</div>
          <div style={{ fontFamily: "'JetBrains Mono'", color: def.col, fontWeight: 700, fontSize: 11 }}>{f0(avail)} MW</div>
        </div>
        <div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 5 }}>£0 marginal cost · SELLER only · output varies with weather</div>
      </div>
    );
  }
  return (
    <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 9, padding: 10 }}>
      <div style={{ fontSize: 9.5, color: "#4d7a96", marginBottom: 7 }}>FLEX CAPACITY</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
        <div style={{ background: isShort ? "#1f0709" : "#071f13", borderRadius: 5, padding: "4px 7px", border: `1px solid ${isShort ? "#f0455a18" : "#1de98b18"}`, opacity: isShort ? 1 : .5 }}>
          <div style={{ fontSize: 7, color: "#4d7a96" }}>⬆ TURN DOWN (SELL)</div>
          <div style={{ fontFamily: "'JetBrains Mono'", color: isShort ? "#f0455a" : "#4d7a96", fontWeight: 700, fontSize: 11 }}>{def.maxMW} MW</div>
        </div>
        <div style={{ background: !isShort ? "#021520" : "#071f13", borderRadius: 5, padding: "4px 7px", border: `1px solid ${!isShort ? "#38c0fc18" : "#1a3045"}`, opacity: !isShort ? 1 : .5 }}>
          <div style={{ fontSize: 7, color: "#4d7a96" }}>⬇ TURN UP (BUY)</div>
          <div style={{ fontFamily: "'JetBrains Mono'", color: !isShort ? "#38c0fc" : "#4d7a96", fontWeight: 700, fontSize: 11 }}>{def.maxMW} MW</div>
        </div>
      </div>
      <div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 5 }}>Unlimited energy · £0 wear · SELLER or BUYER</div>
    </div>
  );
}
