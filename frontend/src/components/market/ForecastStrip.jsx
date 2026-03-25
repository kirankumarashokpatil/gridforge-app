import { f0 } from "../../shared/utils.js";
import { Tip } from "../shared/Tip";

/* ─── FORECAST STRIP ─── */
export default function ForecastStrip({ forecasts }) {
  if (!forecasts || forecasts.length === 0) return null;
  return (
    <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
        <Tip text="Predicted conditions for the next 4 Settlement Periods. ±22% forecast noise. HIGH confidence = SP 1-2 ahead; MEDIUM = SP 3-4.">
          <span style={{ fontSize: 9, color: "#4d7a96", textTransform: "uppercase", letterSpacing: .8, borderBottom: "1px dashed #2a5570" }}>📈 4-SP Forecast</span>
        </Tip>
        <span style={{ fontSize: 7.5, color: "#2a5570" }}>±22% noise</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5 }}>
        {forecasts.map((f, i) => (
          <div key={i} style={{ background: f.isShort ? "#100508" : "#040f09", border: `1px solid ${f.isShort ? "#f0455a" : "#1de98b"}22`, borderRadius: 5, padding: "5px 6px", opacity: f.confident ? 1 : 0.6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}><span style={{ fontFamily: "'JetBrains Mono'", fontSize: 7.5, color: "#4d7a96" }}>SP{f.sp}</span>{!f.confident && <span style={{ fontSize: 6.5, color: "#2a5570" }}>?</span>}</div>
            <div style={{ fontSize: 9, fontWeight: 800, color: f.isShort ? "#f0455a" : "#1de98b" }}>{f.isShort ? "🔴 SHORT" : "🟢 LONG"}</div>
            <div style={{ fontSize: 7.5, fontFamily: "'JetBrains Mono'", color: "#4d7a96", marginTop: 2 }}>{f0(Math.abs(f.niv))} MW</div>
            <div style={{ fontSize: 7, color: "#f5b222", marginTop: 1 }}>£{f.priceLo}–{f.priceHi}</div>
            <div style={{ fontSize: 7, color: "#a3e635", marginTop: 1 }}>💨 {f.wf}%</div>
            {f.event && <div style={{ fontSize: 7, marginTop: 2 }}>{f.event.emoji} <span style={{ color: f.event.col }}>{f.event.name.slice(0, 10)}</span></div>}
          </div>
        ))}
      </div>
    </div>
  );
}
