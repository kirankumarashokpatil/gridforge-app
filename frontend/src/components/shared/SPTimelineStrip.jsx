import React, { useRef, useEffect, useState } from 'react';
import { spTimeWindow } from './MarketClockBar';

/* ─── Colour palette ─── */
const COL = {
  green:  "#1de98b",   // Tradable in ID
  yellow: "#f5b222",   // Frozen (post Gate Closure)
  red:    "#f0455a",   // Live BM
  grey:   "#3a4f5f",   // Settled
  bg:     "#0a1724",
  border: "#1a3045",
  label:  "#4d7a96",
  text:   "#ddeeff",
  activeBg: "#162c3d",
};

/**
 * Determine SP status based on game phase + current SP.
 *
 *   Green  = tradable in ID (SP > current + some lookahead, depending on phase)
 *   Yellow = frozen (Gate Closure passed, not yet in BM)
 *   Red    = live BM
 *   Grey   = settled
 */
function spStatus(spIdx, currentSp, phase, bmSubPhase) {
  const isBm = ["REALTIME", "BM", "BM_OPEN", "BM_CLEAR", "BM_CLOSE", "SP_SETTLED"].includes(phase);
  const isPreBm = ["FORECAST_0", "FORECAST_1", "FORECAST_2", "FORECAST",
                   "DA", "IDA1", "IDA2", "ID", "ID_ROUNDS"].includes(phase);
  const isResults = ["RESULTS", "SETTLED"].includes(phase);

  if (isResults) return "settled";
  if (isPreBm) return "tradable";        // All SPs tradable during auction/ID phases

  // During BM / REALTIME
  if (isBm) {
    if (spIdx < currentSp) return "settled";
    if (spIdx === currentSp) {
      if (bmSubPhase === "SP_SETTLED" || bmSubPhase === "BM_CLEAR" || bmSubPhase === "BM_CLOSE") return "settled";
      return "live";
    }
    // Gate closure = 1 hour before SP start ≈ 2 SPs ahead
    if (spIdx <= currentSp + 2) return "frozen";
    return "tradable";
  }

  return "tradable";
}

const STATUS_COLORS = {
  tradable: COL.green,
  frozen:   COL.yellow,
  live:     COL.red,
  settled:  COL.grey,
};

const STATUS_LABELS = {
  tradable: "Tradable",
  frozen:   "Frozen (GC)",
  live:     "Live BM",
  settled:  "Settled",
};

/**
 * SPTimelineStrip — horizontal scrollable bar of 48 SPs
 * with colour-coded status and click-to-select.
 */
export default function SPTimelineStrip({ sp, phase, bmSubPhase, onSelectSP, selectedSP }) {
  const scrollRef = useRef(null);

  // Auto-scroll to keep current SP visible
  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current.children[sp - 1];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [sp]);

  const spArr = Array.from({ length: 48 }, (_, i) => i + 1);

  return (
    <div style={{
      background: COL.bg,
      border: `1px solid ${COL.border}`,
      borderRadius: 6,
      padding: "6px 10px",
      fontFamily: "'Outfit', system-ui, sans-serif",
      userSelect: "none",
    }}>
      {/* Header row: title + legend */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: COL.label, fontWeight: 800, letterSpacing: 0.5 }}>
          SP TIMELINE (Delivering Day D)
        </span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {Object.entries(STATUS_COLORS).map(([key, color]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
              <span style={{ fontSize: 7.5, color: COL.label, fontWeight: 700 }}>{STATUS_LABELS[key]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Scrollable SP cells */}
      <div
        ref={scrollRef}
        style={{
          display: "flex",
          gap: 2,
          overflowX: "auto",
          paddingBottom: 4,
          scrollbarWidth: "thin",
          scrollbarColor: `${COL.border} transparent`,
        }}
      >
        {spArr.map(spIdx => {
          const status = spStatus(spIdx, sp, phase, bmSubPhase);
          const color = STATUS_COLORS[status];
          const isCurrent = spIdx === sp;
          const isSelected = spIdx === selectedSP;

          return (
            <div
              key={spIdx}
              onClick={() => onSelectSP?.(spIdx === selectedSP ? null : spIdx)}
              title={`SP ${spIdx} (${spTimeWindow(spIdx)}) — ${STATUS_LABELS[status]}`}
              style={{
                minWidth: 38,
                height: 30,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                cursor: "pointer",
                border: isSelected
                  ? `2px solid ${COL.text}`
                  : isCurrent
                    ? `2px solid ${color}`
                    : `1px solid ${color}44`,
                background: isCurrent
                  ? `${color}22`
                  : isSelected
                    ? `${COL.activeBg}`
                    : `${color}0a`,
                transition: "all 0.15s",
                position: "relative",
              }}
            >
              <span style={{
                fontSize: 9,
                fontWeight: isCurrent ? 900 : 700,
                fontFamily: "'JetBrains Mono', monospace",
                color: isCurrent ? color : `${color}cc`,
              }}>
                {spIdx}
              </span>
              {/* Tiny status dot */}
              <div style={{
                width: 4, height: 4,
                borderRadius: "50%",
                background: color,
                marginTop: 1,
                opacity: status === "live" ? 1 : 0.6,
                animation: status === "live" ? "pulse 1.3s ease-in-out infinite" : "none",
              }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { spStatus, STATUS_COLORS, STATUS_LABELS };
