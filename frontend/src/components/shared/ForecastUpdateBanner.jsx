import React from 'react';

/**
 * ForecastUpdateBanner — shown to ALL roles when a new forecast phase begins.
 *
 * Real GB context: between each auction gate, a new NWP weather model run
 * (06Z, 12Z) arrives and forecast providers push revised demand/wind/solar
 * curves. Traders use this to decide whether to adjust positions before the
 * next auction or intraday gate.
 *
 * Trigger map (mirrors EPEX/N2EX GB workflow):
 *   FORECAST_0  →  06Z initial run (D-1 06:00) — full uncertainty, DA book open
 *   FORECAST_1  →  12Z run (D-1 ~15:00) — post-DA signal + wind revision
 *   FORECAST_2  →  06Z short-range (D 07:00) — sharp pre-IDA2 update
 *
 * Props:
 *   forecastUpdateSummary  { stage, weatherRun, trigger, windDeltaGW,
 *                            demandDeltaMW, daAvgPrice, daPriceSignal,
 *                            confidenceGain, spTightest }
 *   compact  boolean — if true renders a single-row banner (for sidebars)
 */
export default function ForecastUpdateBanner({ forecastUpdateSummary, compact = false }) {
    if (!forecastUpdateSummary || forecastUpdateSummary.stage === "FORECAST_0") return null;

    const s = forecastUpdateSummary;
    const windDown = s.windDeltaGW < 0;
    const windUp = s.windDeltaGW > 0;
    const windColor = windDown ? "#f0455a" : windUp ? "#1de98b" : "#94a3b8";
    const demandUp = s.demandDeltaMW > 0;
    const demandColor = demandUp ? "#f5b222" : "#1de98b";

    const NEXT_GATE = {
        FORECAST_1: "IDA1 gate: 17:00 D\u20111",
        FORECAST_2: "IDA2 gate: 08:00 D",
    };
    const nextGate = NEXT_GATE[s.stage] || null;

    const SIGNAL_COLOR = {
        TIGHTER: "#f0455a",
        LOOSER: "#1de98b",
        "AS EXPECTED": "#94a3b8",
    };

    /* ── Compact single-row mode ── */
    if (compact) {
        return (
            <div style={{
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                background: "#061a10", border: "1px solid #1de98b33",
                borderLeft: "3px solid #1de98b", borderRadius: 4,
                padding: "5px 10px", fontSize: 10,
            }}>
                <span style={{
                    fontSize: 8, fontWeight: 700, padding: "1px 5px",
                    background: "#1de98b18", border: "1px solid #1de98b55",
                    borderRadius: 3, color: "#1de98b", letterSpacing: 0.5, whiteSpace: "nowrap",
                }}>
                    {s.weatherRun} RUN
                </span>
                <span style={{ color: "#c8e6f0", fontWeight: 600 }}>
                    {s.trigger}
                </span>
                {nextGate && (
                    <span style={{ marginLeft: "auto", color: "#f5b222", whiteSpace: "nowrap" }}>
                        ▶ {nextGate}
                    </span>
                )}
            </div>
        );
    }

    /* ── Full card mode ── */
    return (
        <div style={{
            background: "#061a10",
            border: "1px solid #1de98b44",
            borderLeft: "3px solid #1de98b",
            borderRadius: 6,
            padding: "10px 14px",
            marginBottom: 10,
        }}>
            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                        fontSize: 9, fontWeight: 700, padding: "2px 6px",
                        background: "#1de98b22", border: "1px solid #1de98b55",
                        borderRadius: 3, color: "#1de98b", letterSpacing: 0.5,
                    }}>
                        {s.weatherRun} RUN
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#1de98b" }}>
                        FORECAST UPDATE — {s.stage}
                    </span>
                </div>
                {s.confidenceGain > 0 && (
                    <span style={{ fontSize: 9, color: "#64748b" }}>
                        ±Uncertainty -{s.confidenceGain}%
                    </span>
                )}
            </div>

            {/* Trigger text */}
            <div style={{ fontSize: 11, color: "#c8e6f0", marginBottom: 8, lineHeight: 1.5 }}>
                {s.trigger}
            </div>

            {/* Stats chips */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                {s.windDeltaGW !== undefined && s.windDeltaGW !== 0 && (
                    <div style={{ minWidth: 80 }}>
                        <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Wind Revised</div>
                        <div style={{ fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: windColor }}>
                            {s.windDeltaGW > 0 ? "+" : ""}{s.windDeltaGW.toFixed(1)} GW
                        </div>
                        <div style={{ fontSize: 8, color: "#475569" }}>
                            {windDown ? "→ less supply → tighter" : "→ more supply → looser"}
                        </div>
                    </div>
                )}
                {s.demandDeltaMW !== undefined && s.demandDeltaMW !== 0 && (
                    <div style={{ minWidth: 80 }}>
                        <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Demand Revised</div>
                        <div style={{ fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: demandColor }}>
                            {s.demandDeltaMW > 0 ? "+" : ""}{s.demandDeltaMW} MW
                        </div>
                    </div>
                )}
                {s.daAvgPrice != null && (
                    <div style={{ minWidth: 80 }}>
                        <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>DA Avg. Cleared</div>
                        <div style={{ fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: "#f5b222" }}>
                            £{s.daAvgPrice}/MWh
                        </div>
                        {s.daPriceSignal && (
                            <div style={{ fontSize: 8, fontWeight: 700, color: SIGNAL_COLOR[s.daPriceSignal] || "#94a3b8" }}>
                                {s.daPriceSignal}
                            </div>
                        )}
                    </div>
                )}
                {s.spTightest != null && (
                    <div style={{ minWidth: 80 }}>
                        <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Tightest SP</div>
                        <div style={{ fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: "#f0455a" }}>
                            SP {s.spTightest}
                        </div>
                        <div style={{ fontSize: 8, color: "#475569" }}>after revision</div>
                    </div>
                )}
            </div>

            {/* Action hint */}
            {nextGate && (
                <div style={{ fontSize: 9, color: "#94a3b8", borderTop: "1px solid #1a3045", paddingTop: 5 }}>
                    ▶ Next gate — {nextGate} — adjust your positions before it closes.
                </div>
            )}
        </div>
    );
}
