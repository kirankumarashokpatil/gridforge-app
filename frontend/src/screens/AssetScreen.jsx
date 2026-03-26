import { useState } from "react";
import { ASSETS, SUPPLIERS, SCENARIOS, ROLES } from "../shared/constants.js";

/* ─── ASSET SELECT (Spec helper is local — only used here) ─── */
const Spec = ({ label, val, col }) => (<div><div style={{ fontSize: 7, color: "#2a5570", marginBottom: 1 }}>{label}</div><div style={{ fontSize: 11, fontFamily: "'JetBrains Mono'", fontWeight: 700, color: col }}>{val}</div></div>);

export default function AssetScreen({ onSelect, playerName, room, scenario, role }) {
  const [hov, setHov] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [customVals, setCustomVals] = useState({});

  const handleAction = (def) => {
    if (editingKey === def.key) {
      const config = { ...customVals };
      if (config.eff !== undefined) config.eff = config.eff / 100;
      onSelect(def.key, config);
    } else {
      setEditingKey(def.key);
      setCustomVals({ maxMW: def.maxMW, maxMWh: def.maxMWh, wear: def.wear, eff: def.eff ? def.eff * 100 : undefined });
    }
  };

  const updateVal = (k, v) => setCustomVals(prev => ({ ...prev, [k]: v }));

  return (
    <div style={{ background: "#050e16", minHeight: "100vh", overflowY: "auto", padding: "24px 16px" }}>
      <div style={{ maxWidth: 1060, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 17, fontWeight: 700, color: "#1de98b", letterSpacing: 2 }}>⚡ GRIDFORGE · ROOM <span style={{ color: "#f5b222" }}>{room}</span></div>
          <div style={{ fontSize: 11, color: scenario.col, marginTop: 4 }}>{scenario.emoji} Scenario: <strong>{scenario.name}</strong> — {scenario.desc}</div>
          <div style={{ fontSize: 10, color: "#4d7a96", marginTop: 3 }}><strong style={{ color: "#ddeeff" }}>{playerName}</strong> — choose the asset you'll operate</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 10 }}>
          {Object.values(role === "SUPPLIER" ? SUPPLIERS : ASSETS).filter(a => {
            // INTERCONNECTOR role no longer exists; treated as system asset so filter not needed
            if (role === "BESS") return a.kind === "soc";
            if (role === "GENERATOR") return a.kind !== "interconnector" && a.kind !== "soc" && a.key !== "DSR";
            return true;
          }).map(def => {
            const isEditing = editingKey === def.key;
            return (
              <div key={def.key} onMouseEnter={() => setHov(def.key)} onMouseLeave={() => setHov(null)} style={{ background: hov === def.key ? "#0c1c2a" : "#08141f", border: `1px solid ${hov === def.key ? def.col : "#1a3045"}`, borderRadius: 12, padding: "16px", cursor: "pointer", transition: "all .15s", transform: hov === def.key ? "translateY(-2px)" : "none" }} onClick={(e) => { if (e.target.tagName !== "INPUT" && isEditing) handleAction(def); else if (!isEditing) handleAction(def); }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ fontSize: 32, filter: `drop-shadow(0 0 8px ${def.col}44)` }}>{def.emoji}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#ffffff", letterSpacing: .5 }}>{def.name}</div>
                    <div style={{ fontSize: 10, color: def.col, fontWeight: 700, marginTop: 2 }}>{def.key} TYPE</div>
                  </div>
                  <div style={{ fontSize: 7.5, padding: "2px 7px", borderRadius: 4, background: def.sides === "short" ? "#1f0709" : def.sides === "long" ? "#021520" : "#071f13", color: def.sides === "short" ? "#f0455a" : def.sides === "long" ? "#38c0fc" : "#1de98b", fontWeight: 700 }}>{def.sides === "both" ? "↑↓ BOTH" : def.sides === "short" ? "↑ SELLER" : "↓ BUYER"}</div>
                </div>

                {isEditing ? (
                  <div style={{ background: "#050e16", borderRadius: 8, padding: "10px", marginBottom: 10, border: "1px solid #1a3045" }}>
                    <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 8, fontWeight: 700 }}>🛠️ CUSTOMIZE ASSET RUNTIME RATINGS</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 8, color: "#2a5570", display: "block", marginBottom: 3 }}>Max Power (MW)</label>
                        <input type="number" value={customVals.maxMW ?? ""} onChange={e => updateVal("maxMW", +e.target.value)} style={{ width: "100%", padding: "6px", background: "#0c1c2a", border: "1px solid #1a3045", color: def.col, fontSize: 11, fontFamily: "JetBrains Mono", borderRadius: 4, boxSizing: "border-box" }} />
                      </div>
                      {def.maxMWh !== undefined && (
                        <div>
                          <label style={{ fontSize: 8, color: "#2a5570", display: "block", marginBottom: 3 }}>Storage (MWh)</label>
                          <input type="number" value={customVals.maxMWh ?? ""} onChange={e => updateVal("maxMWh", +e.target.value)} style={{ width: "100%", padding: "6px", background: "#0c1c2a", border: "1px solid #1a3045", color: def.col, fontSize: 11, fontFamily: "JetBrains Mono", borderRadius: 4, boxSizing: "border-box" }} />
                        </div>
                      )}
                      {def.wear !== undefined && (
                        <div>
                          <label style={{ fontSize: 8, color: "#2a5570", display: "block", marginBottom: 3 }}>Wear Cost (£/MWh)</label>
                          <input type="number" value={customVals.wear ?? ""} onChange={e => updateVal("wear", +e.target.value)} style={{ width: "100%", padding: "6px", background: "#0c1c2a", border: "1px solid #1a3045", color: "#f0455a", fontSize: 11, fontFamily: "JetBrains Mono", borderRadius: 4, boxSizing: "border-box" }} />
                        </div>
                      )}
                      {def.eff !== undefined && (
                        <div>
                          <label style={{ fontSize: 8, color: "#2a5570", display: "block", marginBottom: 3 }}>Efficiency (%)</label>
                          <input type="number" value={customVals.eff ?? ""} onChange={e => updateVal("eff", +e.target.value)} style={{ width: "100%", padding: "6px", background: "#0c1c2a", border: "1px solid #1a3045", color: "#f5b222", fontSize: 11, fontFamily: "JetBrains Mono", borderRadius: 4, boxSizing: "border-box" }} />
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ background: "#0c1c2a", borderRadius: 7, padding: "6px 8px", marginBottom: 7, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                      {role === "SUPPLIER" ? (
                        <>
                          <Spec label="Portfolio" val={`${def.portfolioMw} MW`} col={def.col} />
                          <Spec label="Customers" val={def.customers} col={def.col} />
                          <Spec label="Hedge" val={def.hedgeHorizon} col="#f5b222" />
                          <Spec label="Tariff" val={`£${def.retailTariff}`} col="#1de98b" />
                        </>
                      ) : (
                        <>
                          <Spec label="Power" val={`${def.maxMW} MW`} col={def.col} />
                          {def.maxMWh && <Spec label="Energy" val={`${def.maxMWh} MWh`} col={def.col} />}
                          {def.fuelMWh && <Spec label="Fuel" val={`${def.fuelMWh} MWh`} col="#f5b222" />}
                          {def.eff && <Spec label="Efficiency" val={`${(def.eff * 100).toFixed(0)}% η`} col="#f5b222" />}
                          {def.wear > 0 ? <Spec label="Wear" val={`£${def.wear}/MWh`} col="#f0455a" /> : <Spec label="Wear" val="£0/MWh" col="#1de98b" />}
                        </>
                      )}
                    </div>
                    <div style={{ fontSize: 8.5, color: "#4d7a96", lineHeight: 1.6, marginBottom: 8 }}>{def.desc}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 10 }}>
                      <div>{def.pros?.map((p, i) => <div key={i} style={{ fontSize: 7.5, color: "#1de98b", marginBottom: 2 }}>✓ {p}</div>)}</div>
                      <div>{def.cons?.map((c, i) => <div key={i} style={{ fontSize: 7.5, color: "#f0455a", marginBottom: 2 }}>✗ {c}</div>)}</div>
                    </div>
                  </>
                )}
                <button onClick={() => handleAction(def)} style={{ width: "100%", padding: "7px 0", background: hov === def.key || isEditing ? def.col : "#102332", border: `1px solid ${def.col}`, borderRadius: 6, color: hov === def.key || isEditing ? "#050e16" : def.col, fontWeight: 900, fontSize: 10.5, cursor: "pointer", transition: "all .18s", fontFamily: "'Outfit'" }}>
                  {isEditing ? `CONFIRM & JOIN SIMULATION →` : `SELECT OR CONFIGURE ${def.name.toUpperCase()} →`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
