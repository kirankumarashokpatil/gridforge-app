import React from 'react';

/**
 * Simulated GB market‑time offsets (minutes from midnight D‑1) for each phase.
 * Times are calibrated to real EPEX/N2EX GB timings:
 *
 *   FORECAST_0  D‑1 06:00–09:20  Book opens; 06Z NWP run in; players build DA curves
 *   DA          D‑1 09:20–09:30  Gate closure + auction processing (1 batch clear)
 *   FORECAST_1  D‑1 09:30–17:00  12Z weather run in; DA price is new signal; ±40% uncertainty
 *   IDA1        D‑1 17:00–17:30  IDA1 gate closure 17:30 → results ~17:45
 *   FORECAST_2  D   07:00–07:55  06Z short-range run; sharpest pre-delivery update; ±70%
 *   IDA2        D   08:00–08:30  IDA2 gate closure 08:00 → results ~08:15
 *   ID_ROUNDS   D   continuous   Continuous intraday; gate per SP = 1h before delivery
 *   REALTIME/BM D   per-SP       BM_OPEN → BM_CLEAR → SP_SETTLED
 */
const PHASE_TIME_MAP = {
  // D‑1 360 min = 06:00; 560 min = 09:20
  FORECAST_0: { startMin: 360,  endMin: 560,  dateLabel: "D\u20111", phaseLabel: "DA ORDER BOOK OPEN \u2013 06Z Run",         spRange: "All 48 SPs", weatherRun: "06Z"             },
  // DA gate at 09:20 (560), results ~09:30 (570)
  DA:         { startMin: 560,  endMin: 570,  dateLabel: "D\u20111", phaseLabel: "DA GATE CLOSE \u2192 AUCTION RESULTS",      spRange: "All 48 SPs", weatherRun: null              },
  // FORECAST_1: 09:30 (570) to 17:00 (1020) — 12Z run arrives mid‑afternoon
  FORECAST_1: { startMin: 570,  endMin: 1020, dateLabel: "D\u20111", phaseLabel: "FORECAST UPDATE \u2013 12Z Weather Run",     spRange: "All 48 SPs", weatherRun: "12Z"             },
  // IDA1: gate 17:00–17:30 (1020–1050)
  IDA1:       { startMin: 1020, endMin: 1050, dateLabel: "D\u20111", phaseLabel: "IDA1 GATE CLOSE \u2192 RESULTS",            spRange: "All 48 SPs", weatherRun: null              },
  // FORECAST_2: D 07:00 = 1440+420=1860; D 07:55 = 1440+475=1915
  FORECAST_2: { startMin: 1860, endMin: 1915, dateLabel: "D",       phaseLabel: "FORECAST UPDATE \u2013 06Z Short-Range Run", spRange: "All 48 SPs", weatherRun: "06Z (S-R)"       },
  // IDA2: D 08:00(1920) – D 08:30(1950)
  IDA2:       { startMin: 1920, endMin: 1950, dateLabel: "D",       phaseLabel: "IDA2 GATE CLOSE \u2192 RESULTS",            spRange: "All 48 SPs", weatherRun: null              },
  ID_ROUNDS:  { startMin: 1980, endMin: null, dateLabel: "D",       phaseLabel: "INTRADAY CONTINUOUS \u2013 Gate Per SP",     spRange: null,          weatherRun: null              },
  REALTIME:   { startMin: null, endMin: null, dateLabel: "D",       phaseLabel: "BM",                                        spRange: null,          weatherRun: null              },
  BM_OPEN:    { startMin: null, endMin: null, dateLabel: "D",       phaseLabel: "BM",                                        spRange: null,          weatherRun: null              },
  BM_CLEAR:   { startMin: null, endMin: null, dateLabel: "D",       phaseLabel: "BM CLEARING",                               spRange: null,          weatherRun: null              },
  SP_SETTLED: { startMin: null, endMin: null, dateLabel: "D",       phaseLabel: "SP SETTLED",                                spRange: null,          weatherRun: null              },
  RESULTS:    { startMin: 2885, endMin: 2885, dateLabel: "D+1",     phaseLabel: "END\u2011OF\u2011DAY RESULTS",              spRange: "All 48 SPs", weatherRun: null              },

  // Legacy compat
  FORECAST:   { startMin: 360,  endMin: 560,  dateLabel: "D\u20111", phaseLabel: "DA ORDER BOOK OPEN \u2013 06Z Run", spRange: "All 48 SPs", weatherRun: "06Z" },
  ID:         { startMin: 1980, endMin: null, dateLabel: "D",       phaseLabel: "INTRADAY CONTINUOUS",                spRange: null,          weatherRun: null  },
  BM:         { startMin: null, endMin: null, dateLabel: "D",       phaseLabel: "BM",                                 spRange: null,          weatherRun: null  },
  BM_CLOSE:   { startMin: null, endMin: null, dateLabel: "D",       phaseLabel: "BM CLEARING",                        spRange: null,          weatherRun: null  },
  SETTLED:    { startMin: 2885, endMin: 2885, dateLabel: "D+1",     phaseLabel: "RESULTS",                            spRange: "All 48 SPs", weatherRun: null  },
};

// Format minutes-from-midnight into HH:MM
function minsToHHMM(m) {
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Format SP index (1-48) → time window string, e.g. "09:30–10:00"
function spTimeWindow(spIdx) {
  const startH = Math.floor(((spIdx - 1) * 30) / 60);
  const startM = ((spIdx - 1) * 30) % 60;
  const endH = Math.floor((spIdx * 30) / 60);
  const endM = (spIdx * 30) % 60;
  return `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}\u2013${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

// Format ms into MM:SS
function formatCountdown(ms) {
  if (ms <= 0) return "00:00";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Compute a simulated "market time" interpolated from tick progress.
 * tPct = 0 → phase start time, tPct = 100 → phase end time.
 */
function simMarketTime(phaseInfo, tPct, sp) {
  if (!phaseInfo) return "—";
  // BM/realtime phases: derive from the SP index itself
  if (phaseInfo.startMin === null) {
    const baseMins = (sp - 1) * 30;                       // SP 1 → 00:00, SP 20 → 09:30
    const progressMins = Math.round((1 - tPct / 100) * 30); // 0%→end, 100%→start of SP
    return minsToHHMM(baseMins + progressMins);
  }
  const range = (phaseInfo.endMin || phaseInfo.startMin) - phaseInfo.startMin;
  const currentMin = phaseInfo.startMin + Math.round((1 - tPct / 100) * Math.max(range, 10));
  return minsToHHMM(currentMin);
}

/* ─── colours ─── */
const C = {
  bg:     "#0a1724",
  border: "#1a3045",
  label:  "#4d7a96",
  value:  "#ddeeff",
  accent: "#38c0fc",
  green:  "#1de98b",
  yellow: "#f5b222",
  red:    "#f0455a",
};

export default function MarketClockBar({ phase, sp, msLeft, tickSpeed, bmSubPhase }) {
  const ts = tickSpeed || 15000;
  const tPct = (msLeft / ts) * 100;
  const phaseInfo = PHASE_TIME_MAP[phase] || PHASE_TIME_MAP.FORECAST;

  // Phase-specific display label for bottomRight row
  const isBmLike = ["REALTIME", "BM_OPEN", "BM_CLEAR", "SP_SETTLED", "BM", "BM_CLOSE"].includes(phase);
  const displayPhase = isBmLike
    ? `BM \u2013 SP ${sp} (${spTimeWindow(sp)})`
    : phaseInfo.phaseLabel;

  // SP range display
  const spRangeText = isBmLike
    ? `SP ${sp} (${spTimeWindow(sp)})`
    : (phaseInfo.spRange || `SPs near ${sp}`);

  // Date label
  const dateLabel = phaseInfo.dateLabel;

  // Timer label depends on phase
  let timerLabel;
  if (isBmLike && (phase === "BM_OPEN" || phase === "REALTIME" || phase === "BM")) {
    timerLabel = "Time Left In SP";
  } else if (phase === "DA") {
    timerLabel = "Gate Closes In";
  } else if (phase === "IDA1" || phase === "IDA2") {
    timerLabel = `${phase} Gate Closes In`;
  } else if (phase === "BM_CLEAR" || phase === "BM_CLOSE" || phase === "SP_SETTLED") {
    timerLabel = "Settling";
  } else if (phase === "FORECAST_0") {
    timerLabel = "Book Closes In";
  } else if (phase === "FORECAST_1" || phase === "FORECAST_2" || phase === "FORECAST") {
    timerLabel = "Next Gate In";
  } else {
    timerLabel = "Phase Ends In";
  }

  // Weather run badge shown for forecast phases
  const weatherRun = phaseInfo.weatherRun;

  // Gate time labels matching real EPEX timings
  const GATE_TIMES = {
    FORECAST_0: "Gate: 09:20 D\u20111",
    DA:         "Results: \u223c09:30 D\u20111",
    FORECAST_1: "IDA1 Gate: 17:00 D\u20111",
    IDA1:       "Results: \u223c17:45 D\u20111",
    FORECAST_2: "IDA2 Gate: 08:00 D",
    IDA2:       "Results: \u223c08:15 D",
  };
  const gateTimeText = GATE_TIMES[phase] || null;

  const bottomRightText = isBmLike
    ? `NIV Direction: ${bmSubPhase === "BM_OPEN" ? "PENDING" : "CLEARING"}`
    : (gateTimeText || `Delivering: ${dateLabel === "D\u20111" ? "D (Tomorrow)" : "D (Today)"}`);

  const marketTime = simMarketTime(phaseInfo, tPct, sp);
  const countdown = formatCountdown(msLeft);

  /* ─── Styles ─── */
  const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center" };
  const cellStyle = (align = "left") => ({
    display: "flex", gap: 6, alignItems: "baseline", justifyContent: align === "right" ? "flex-end" : "flex-start", flex: 1,
  });
  const lbl = { fontSize: 9, color: C.label, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", whiteSpace: "nowrap" };
  const val = { fontSize: 12, color: C.value, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" };
  const accentVal = { ...val, color: C.accent };
  const countdownStyle = {
    ...val,
    fontSize: 14,
    color: msLeft < (ts * 0.27) ? C.red : msLeft < (ts * 0.53) ? C.yellow : C.green,
    fontWeight: 900,
  };

  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 6,
      padding: "8px 14px",
      fontFamily: "'Outfit', system-ui, sans-serif",
      userSelect: "none",
    }}>
      {/* Row 1 */}
      <div style={rowStyle}>
        <div style={cellStyle()}>
          <span style={lbl}>Date:</span>
          <span style={val}>{dateLabel} (Simulated)</span>
        </div>
        <div style={{ ...cellStyle("right"), gap: 8 }}>
          {weatherRun && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "1px 5px",
              background: "#1de98b18", border: "1px solid #1de98b55",
              borderRadius: 3, color: "#1de98b", letterSpacing: 0.5,
            }}>
              {weatherRun} RUN
            </span>
          )}
          <span style={lbl}>Phase:</span>
          <span style={accentVal}>{displayPhase}</span>
        </div>
      </div>

      {/* Row 2 */}
      <div style={{ ...rowStyle, marginTop: 4 }}>
        <div style={cellStyle()}>
          <span style={lbl}>Market Time:</span>
          <span style={val}>{marketTime}</span>
        </div>
        <div style={cellStyle("right")}>
          <span style={lbl}>{timerLabel}:</span>
          <span style={countdownStyle}>{countdown}</span>
        </div>
      </div>

      {/* Row 3 */}
      <div style={{ ...rowStyle, marginTop: 4 }}>
        <div style={cellStyle()}>
          <span style={lbl}>{gateTimeText ? "Real Timing:" : "Delivering Day:"}</span>
          <span style={{ ...val, fontSize: 10, color: gateTimeText ? C.yellow : C.value }}>
            {bottomRightText}
          </span>
        </div>
        <div style={cellStyle("right")}>
          <span style={lbl}>SP Scope:</span>
          <span style={val}>{spRangeText}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 6, height: 4, background: "#162c3d", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${tPct}%`,
          background: msLeft < (ts * 0.27) ? C.red : msLeft < (ts * 0.53) ? C.yellow : C.green,
          borderRadius: 2,
          transition: "width 1s linear",
        }} />
      </div>
    </div>
  );
}

export { spTimeWindow, formatCountdown, PHASE_TIME_MAP };
