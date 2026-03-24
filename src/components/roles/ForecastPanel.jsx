import React, { useState, useEffect, useRef, useMemo } from 'react';
import ForecastEngine from '../../engine/ForecastEngine';
import { roomKey } from '../../shared/utils';

const f0 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function ForecastPanel({ sp, tickSpeed, publishedForecast, isInstructor, canEdit = false, onPublish, gun, room, forecastUpdateSummary, phase }) {
    const [engine] = useState(() => new ForecastEngine());
    const [mode, setMode] = useState('manual');
    const [skill, setSkill] = useState(0.8);
    const canvasRef = useRef(null);
    const [activeTab, setActiveTab] = useState('demand'); // demand, wind, solar
    const [isPublishing, setIsPublishing] = useState(false);

    // The working draft we are editing
    const [draft, setDraft] = useState(() => engine.generateInitialDraft(sp));

    // If read-only and we receive a published forecast, sync the draft to it
    useEffect(() => {
        if (!canEdit && publishedForecast) {
            setDraft(publishedForecast);
        }
    }, [canEdit, publishedForecast]);

    // Draw the canvas
    useEffect(() => {
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;
        const w = 400, h = 200;
        ctx.clearRect(0, 0, w, h);

        // Safety: check if draft and activeTab exist, with fallback rendering
        const data = draft?.[activeTab];
        if (!data || !Array.isArray(data) || data.length === 0) {
            ctx.fillStyle = '#2a5570';
            ctx.font = '12px Arial';
            ctx.fillText('Waiting for forecast data...', 20, 100);
            return;
        }

        // Draw grid
        ctx.strokeStyle = '#1e3a5f';
        ctx.lineWidth = 1;
        for (let i = 0; i < 48; i += 4) {
            const x = (i / 47) * w;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }

        // Draw line
        const maxVals = { demand: 60000, wind: 30000, solar: 20000 };
        const max = maxVals[activeTab] || 60000;

        ctx.strokeStyle = activeTab === 'demand' ? '#38bdf8' : activeTab === 'wind' ? '#22d3ee' : '#f5b222';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 48; i++) {
            const x = (i / 47) * w;
            const val = data?.[i] ?? 0; // Safe access with fallback
            const y = h - (val / max) * h;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw actuals or published if exists, with safety check
        if (canEdit && publishedForecast && publishedForecast[activeTab] && Array.isArray(publishedForecast[activeTab])) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1.5;
            ctx.lineDashOffset = 5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            for (let i = 0; i < 48; i++) {
                const x = (i / 47) * w;
                const val = publishedForecast[activeTab]?.[i] ?? 0; // Safe access
                const y = h - (val / max) * h;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

    }, [draft, activeTab, publishedForecast, canEdit]);

    // Handle drawing
    const [isDrawing, setIsDrawing] = useState(false);
    const handleMouse = (e) => {
        if (!canEdit || mode === 'automatic') return; // Can't draw in pure auto
        if (e.type === 'mousedown') setIsDrawing(true);
        if (e.type === 'mouseup' || e.type === 'mouseleave') setIsDrawing(false);
        if ((e.type === 'mousemove' && isDrawing) || e.type === 'mousedown') {
            const rect = canvasRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const w = 400, h = 200;
            const maxVals = { demand: 60000, wind: 30000, solar: 20000 };
            const max = maxVals[activeTab] || 60000;

            const idx = Math.max(0, Math.min(47, Math.round((x / w) * 47)));
            const val = Math.max(0, Math.min(max, ((h - y) / h) * max));

            setDraft(d => {
                const nd = { ...d };
                nd[activeTab] = [...nd[activeTab]];
                nd[activeTab][idx] = val;
                // Smoothing adjacent slightly to make drawing easier
                if (idx > 0) nd[activeTab][idx - 1] = nd[activeTab][idx - 1] * 0.4 + val * 0.6;
                if (idx < 47) nd[activeTab][idx + 1] = nd[activeTab][idx + 1] * 0.4 + val * 0.6;
                return nd;
            });
        }
    };

    const handlePublish = async () => {
        if (isPublishing) return;
        try {
            setIsPublishing(true);
            engine.setMode(mode);
            engine.skill_level = skill; // ForecastEngine has no setSkillLevel() method — assign directly
            const v = engine.createManual(
                canEdit ? "NESO" : "System",
                draft.demand,
                draft.wind,
                draft.solar
            );
            if (onPublish) {
                await onPublish(v);
            }
            // Optional local mirror for legacy/dev realtime relay.
            if (gun && room) {
                const key = roomKey(room, 'forecast');
                console.log('[ForecastPanel] Publishing to GunDB key:', key);
                gun.get(key).put({ json: JSON.stringify(v) });
            }
        } catch (err) {
            console.error('[ForecastPanel] handlePublish error:', err);
        } finally {
            setIsPublishing(false);
        }
    };

    const handleAutoGenerate = () => {
        engine.setMode(mode);
        engine.skill_level = skill;
        const autoDraft = engine.generateInitialDraft(sp);
        setDraft(autoDraft);
    };

    const s = {
        panel: { border: "1px solid #1a3045", background: "#08141f", borderRadius: 6, padding: 14, margin: 4 },
        title: { fontSize: 10, letterSpacing: "0.15em", color: "#475569", textTransform: "uppercase", marginBottom: 10, fontWeight: "bold" },
        btn: (active) => ({ padding: "4px 10px", background: active ? "#38bdf822" : "#0c1c2a", border: `1px solid ${active ? "#38bdf8" : "#1a3045"}`, color: active ? "#38bdf8" : "#4d7a96", borderRadius: 4, fontSize: 10, cursor: "pointer", fontWeight: active ? "bold" : "normal" })
    };

    return (
        <div style={{ ...s.panel, flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={s.title}>NESO Forecast Engine</div>
                <div style={{ fontSize: 10, color: "#22d3ee" }}>v{engine.history.length}</div>
            </div>

            {/* Top Toolbar */}
            {canEdit && (
                <div style={{ display: "flex", gap: 8, marginBottom: 12, background: "#0c1c2a", padding: 8, borderRadius: 6 }}>
                    <div>
                        <div style={{ fontSize: 8, color: "#475569", marginBottom: 4 }}>MODE</div>
                        <div style={{ display: "flex", gap: 4 }}>
                            <button style={s.btn(mode === 'manual')} onClick={() => setMode('manual')}>Manual</button>
                            <button style={s.btn(mode === 'automatic')} onClick={() => setMode('automatic')}>Auto</button>
                            <button style={s.btn(mode === 'mixed')} onClick={() => setMode('mixed')}>Mixed</button>
                        </div>
                    </div>
                    {mode !== 'manual' && (
                        <div style={{ marginLeft: "auto" }}>
                            <div style={{ fontSize: 8, color: "#475569", marginBottom: 4 }}>AUTO SKILL ({skill.toFixed(2)})</div>
                            <input type="range" min="0" max="1" step="0.05" value={skill} onChange={e => setSkill(+e.target.value)} style={{ width: 80 }} />
                        </div>
                    )}
                    <button
                        onClick={mode === 'manual'
                            ? () => setDraft({ demand: new Array(48).fill(0), wind: new Array(48).fill(0), solar: new Array(48).fill(0) })
                            : handleAutoGenerate}
                        disabled={false}
                        style={{ ...s.btn(false), marginLeft: mode === 'manual' ? "auto" : 8, alignSelf: "flex-end" }}>
                        {mode === 'manual' ? "Clear" : "Generate Auto"}
                    </button>
                </div>
            )}

            {/* Canvas Editor */}
            <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                <button style={s.btn(activeTab === 'demand')} onClick={() => setActiveTab('demand')}>Demand</button>
                <button style={s.btn(activeTab === 'wind')} onClick={() => setActiveTab('wind')}>Wind</button>
                <button style={s.btn(activeTab === 'solar')} onClick={() => setActiveTab('solar')}>Solar</button>
            </div>

            <div style={{ background: "#061018", border: "1px solid #1a3045", borderRadius: 6, position: "relative" }}>
                <div style={{ position: "absolute", top: 8, left: 8, fontSize: 10, color: "#475569", pointerEvents: "none" }}>{activeTab.toUpperCase()} MW (48 SP)</div>
                <canvas
                    ref={canvasRef}
                    width={400}
                    height={200}
                    style={{ width: "100%", height: 160, display: "block", cursor: canEdit && mode !== 'automatic' ? "crosshair" : "default" }}
                    onMouseDown={handleMouse}
                    onMouseMove={handleMouse}
                    onMouseUp={handleMouse}
                    onMouseLeave={handleMouse}
                />
            </div>

            {/* Bottom/Metadata */}
            <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>Current Value (SP{sp})</div>
                    <div style={{ fontSize: 18, fontFamily: "'JetBrains Mono'", color: "#e2e8f0" }}>
                        {f0(draft?.[activeTab]?.[Math.max(0, sp - 1) % 48] ?? 0)} MW
                    </div>
                </div>
                {canEdit && (
                    <button data-testid="publish-forecast" disabled={isPublishing} onClick={handlePublish} style={{ padding: "8px 16px", background: isPublishing ? "#7c2d12" : "#f97316", border: "none", borderRadius: 4, color: "#fff", fontWeight: "bold", cursor: isPublishing ? "not-allowed" : "pointer", alignSelf: "flex-end", opacity: isPublishing ? 0.8 : 1 }}>
                        {isPublishing ? "PUBLISHING..." : "PUBLISH FORECAST"}
                    </button>
                )}
            </div>

            {!canEdit && (
                <div style={{ marginTop: 16, fontSize: 10, color: "#4d7a96", background: "#0c1c2a", padding: 8, borderRadius: 4 }}>
                    NESO Operator: You are viewing the live published forecast. The Instructor controls the generation mode.
                </div>
            )}

            {/* ── Forecast Update Bulletin ── */}
            {/* Shown whenever a new forecast phase has produced a weather-run update.
                Mirrors the real GB trader experience: each forecast phase is triggered
                by a new NWP model run (06Z / 12Z / 06Z short-range) and gives players
                information to revise their DA/IDA/ID positions before the next gate. */}
            {forecastUpdateSummary && forecastUpdateSummary.stage !== "FORECAST_0" && (
                <div style={{
                    marginTop: 12,
                    background: "#061a10",
                    border: "1px solid #1de98b44",
                    borderLeft: "3px solid #1de98b",
                    borderRadius: 6,
                    padding: "10px 12px",
                }}>
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{
                                fontSize: 9, fontWeight: 700, padding: "2px 6px",
                                background: "#1de98b22", border: "1px solid #1de98b55",
                                borderRadius: 3, color: "#1de98b", letterSpacing: 0.5,
                            }}>
                                {forecastUpdateSummary.weatherRun} RUN
                            </span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#1de98b", letterSpacing: 0.08 }}>
                                FORECAST UPDATE — {forecastUpdateSummary.stage}
                            </span>
                        </div>
                        {forecastUpdateSummary.confidenceGain > 0 && (
                            <span style={{ fontSize: 9, color: "#94a3b8" }}>
                                Uncertainty reduced by {forecastUpdateSummary.confidenceGain}%
                            </span>
                        )}
                    </div>

                    {/* Trigger narrative */}
                    <div style={{ fontSize: 11, color: "#c8e6f0", marginBottom: 8, lineHeight: 1.5 }}>
                        {forecastUpdateSummary.trigger}
                    </div>

                    {/* Key stats row */}
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                        {forecastUpdateSummary.windDeltaGW !== undefined && forecastUpdateSummary.windDeltaGW !== 0 && (
                            <div>
                                <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Wind Revised</div>
                                <div style={{
                                    fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800,
                                    color: forecastUpdateSummary.windDeltaGW < 0 ? "#f0455a" : "#1de98b",
                                }}>
                                    {forecastUpdateSummary.windDeltaGW > 0 ? "+" : ""}{forecastUpdateSummary.windDeltaGW.toFixed(1)} GW
                                </div>
                                <div style={{ fontSize: 8, color: "#475569" }}>
                                    {forecastUpdateSummary.windDeltaGW < 0 ? "→ system tighter" : "→ system looser"}
                                </div>
                            </div>
                        )}
                        {forecastUpdateSummary.demandDeltaMW !== undefined && forecastUpdateSummary.demandDeltaMW !== 0 && (
                            <div>
                                <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Demand Revised</div>
                                <div style={{
                                    fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800,
                                    color: forecastUpdateSummary.demandDeltaMW > 0 ? "#f5b222" : "#1de98b",
                                }}>
                                    {forecastUpdateSummary.demandDeltaMW > 0 ? "+" : ""}{forecastUpdateSummary.demandDeltaMW} MW
                                </div>
                            </div>
                        )}
                        {forecastUpdateSummary.daAvgPrice != null && (
                            <div>
                                <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>DA Avg Cleared</div>
                                <div style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: "#f5b222" }}>
                                    £{forecastUpdateSummary.daAvgPrice}/MWh
                                </div>
                                {forecastUpdateSummary.daPriceSignal && (
                                    <div style={{
                                        fontSize: 8,
                                        color: forecastUpdateSummary.daPriceSignal === "TIGHTER" ? "#f0455a"
                                            : forecastUpdateSummary.daPriceSignal === "LOOSER" ? "#1de98b"
                                            : "#94a3b8",
                                    }}>
                                        {forecastUpdateSummary.daPriceSignal}
                                    </div>
                                )}
                            </div>
                        )}
                        {forecastUpdateSummary.spTightest != null && (
                            <div>
                                <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Tightest SP</div>
                                <div style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: "#f0455a" }}>
                                    SP {forecastUpdateSummary.spTightest}
                                </div>
                                <div style={{ fontSize: 8, color: "#475569" }}>after revision</div>
                            </div>
                        )}
                    </div>

                    {/* Action hint */}
                    <div style={{ marginTop: 8, fontSize: 9, color: "#64748b", borderTop: "1px solid #1a3045", paddingTop: 6 }}>
                        {forecastUpdateSummary.stage === "FORECAST_1"
                            ? "▶ IDA1 gate opens at 17:00 D\u20111 — use this update to refine your positions for all 48 SPs before 17:30."
                            : "▶ IDA2 gate opens at 08:00 D — use this sharp update to make final position adjustments for remaining SPs."}
                    </div>
                </div>
            )}
        </div>
    );
}
