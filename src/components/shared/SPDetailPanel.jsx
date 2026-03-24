import React from 'react';
import { spTimeWindow, formatCountdown } from './MarketClockBar';
import { spStatus, STATUS_COLORS, STATUS_LABELS } from './SPTimelineStrip';

const C = {
  bg:     "#0a1724",
  border: "#1a3045",
  label:  "#4d7a96",
  value:  "#ddeeff",
  accent: "#38c0fc",
};

/**
 * Per‑SP detail panel — shown when a player clicks an SP cell in the timeline strip.
 * Displays gate closure time, current status, and time context.
 */
export default function SPDetailPanel({ selectedSP, currentSp, phase, bmSubPhase, msLeft, tickSpeed, onClose }) {
  if (!selectedSP) return null;

  const status = spStatus(selectedSP, currentSp, phase, bmSubPhase);
  const color = STATUS_COLORS[status];
  const label = STATUS_LABELS[status];
  const timeWindow = spTimeWindow(selectedSP);

  // Gate Closure = 1 hour before SP start (i.e. 2 SPs earlier)
  const gcSp = selectedSP - 2;
  const gcStartMin = Math.max(0, (selectedSP - 1) * 30 - 60);
  const gcH = Math.floor(gcStartMin / 60);
  const gcM = gcStartMin % 60;
  const gcTime = `${String(gcH).padStart(2, '0')}:${String(gcM).padStart(2, '0')}`;

  const gcPassed = status === "frozen" || status === "live" || status === "settled";

  // Time remaining for current live SP
  const isLiveSP = selectedSP === currentSp && status === "live";
  const countdown = isLiveSP ? formatCountdown(msLeft) : null;

  const lbl = { fontSize: 9, color: C.label, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" };
  const val = { fontSize: 12, color: C.value, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" };

  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 6,
      padding: "10px 14px",
      fontFamily: "'Outfit', system-ui, sans-serif",
      position: "relative",
      userSelect: "none",
    }}>
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 6, right: 8,
          background: "none", border: "none", color: C.label,
          fontSize: 14, cursor: "pointer", lineHeight: 1,
        }}
      >✕</button>

      {/* Title */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: C.value, fontFamily: "'JetBrains Mono', monospace" }}>
          SP {selectedSP}
        </span>
        <span style={{ fontSize: 11, color: C.accent, fontWeight: 700 }}>{timeWindow}</span>
        <span style={{ fontSize: 9, color: C.value, fontWeight: 700 }}>(Delivering Day D)</span>
      </div>

      {/* Info grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }}>
        <div>
          <span style={lbl}>Gate Closure:</span>{" "}
          <span style={{ ...val, fontSize: 11, color: gcPassed ? "#f5b222" : C.value }}>
            {gcTime} {gcPassed ? "(passed)" : ""}
          </span>
        </div>
        <div>
          <span style={lbl}>Status:</span>{" "}
          <span style={{
            ...val, fontSize: 11, color,
            animation: status === "live" ? "pulse 1.3s ease-in-out infinite" : "none",
          }}>
            {label.toUpperCase()}
            {countdown && ` (${countdown} remaining)`}
          </span>
        </div>
      </div>
    </div>
  );
}
