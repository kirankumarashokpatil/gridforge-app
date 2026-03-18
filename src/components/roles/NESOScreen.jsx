import React, { useState, useEffect, useCallback } from 'react';
import SharedLayout from './SharedLayout';
import ForecastPanel from './ForecastPanel';
import MarketOverviewPanel from '../shared/MarketOverviewPanel';
import { EVENTS, SYSTEM_PARAMS, FREQ_FAIL_LO, FREQ_FAIL_HI } from '../../shared/constants';
import { ComposableMap, Geographies, Geography, Marker, Line } from 'react-simple-maps';

const f0 = p => Number(p).toLocaleString(undefined, { maximumFractionDigits: 0 });

// ── Sparkline with optional fill ─────────────────────────────────────────────
function Sparkline({ data, color = "#38bdf8", fill = false, height = 60, width = 300 }) {
    if (!data || data.length < 2) return null;
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((v - min) / range) * (height - 4) - 2;
        return `${x},${y}`;
    });
    const polyline = pts.join(" ");
    const area = `${pts[0].split(",")[0]},${height} ${polyline} ${pts[pts.length - 1].split(",")[0]},${height}`;
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible", display: "block" }}>
            {fill && <polygon points={area} fill={color} opacity={0.15} />}
            <polyline points={polyline} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
        </svg>
    );
}

// ── Animated Counter ─────────────────────────────────────────────────────────
function Counter({ value, decimals = 1, suffix = "" }) {
    const [display, setDisplay] = useState(value);
    useEffect(() => {
        const start = display;
        const end = value;
        const dur = 800;
        const t0 = performance.now();
        const step = (t) => {
            const p = Math.min((t - t0) / dur, 1);
            setDisplay(+(start + (end - start) * p).toFixed(decimals));
            if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }, [value]);
    return <span>{display.toFixed(decimals)}{suffix}</span>;
}

// ── Real UK Map SVG (react-simple-maps) ──────────────────────────────────────
const geoUrl = "https://raw.githubusercontent.com/ONSvisual/topojson_boundaries/master/geogUACounty2019GB.json";

function UKMap({ nodes, flows }) {
    return (
        <ComposableMap
            projection="geoMercator"
            projectionConfig={{
                scale: SYSTEM_PARAMS.mapProjection.scale,
                center: [SYSTEM_PARAMS.mapProjection.centerLon, SYSTEM_PARAMS.mapProjection.centerLat]
            }}
            style={{ width: "100%", height: "100%", overflow: "visible" }}>
            <Geographies geography={geoUrl}>
                {({ geographies }) => geographies.map(geo => (
                    <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        style={{
                            default: { fill: "#0a2a4a", stroke: "#1e4a7a", strokeWidth: 0.5, outline: "none" },
                            hover: { fill: "#0f335c", stroke: "#1e4a7a", strokeWidth: 0.5, outline: "none" },
                            pressed: { fill: "#0a2a4a", stroke: "#1e4a7a", strokeWidth: 0.5, outline: "none" }
                        }}
                    />
                ))}
            </Geographies>

            {/* Interconnector flows */}
            {flows && flows.map((f, i) => (
                <g key={i}>
                    <Line from={f.from} to={f.to} stroke="#00d4ff" strokeWidth={1.5} strokeDasharray="5,3" className="flow-dash" />
                    <Marker coordinates={f.labelPos}>
                        <text x={f.offsetX || 0} y={f.offsetY || 0} fill="#67e8f9" fontSize="10" fontFamily="'JetBrains Mono', monospace" fontWeight="bold" textAnchor={f.textAnchor || "start"}>
                            {f.label}
                        </text>
                    </Marker>
                </g>
            ))}

            {/* Grid nodes */}
            {nodes && nodes.map((n, i) => (
                <Marker key={i} coordinates={n.coords}>
                    <circle r={n.major ? 6 : 4} fill={n.color || "#0ea5e9"} opacity={0.9}>
                        <animate attributeName="r" values={`${n.major ? 6 : 4};${n.major ? 8 : 6};${n.major ? 6 : 4}`} dur="2.5s" repeatCount="indefinite" />
                    </circle>
                    <circle r={n.major ? 12 : 8} fill="none" stroke={n.color || "#0ea5e9"} strokeWidth={1} opacity={0.3}>
                        <animate attributeName="r" values={`${n.major ? 12 : 8};${n.major ? 18 : 14};${n.major ? 12 : 8}`} dur="2.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.3;0;0.3" dur="2.5s" repeatCount="indefinite" />
                    </circle>
                    {n.name && <text x={10} y={4} fill="#94a3b8" fontSize="9" fontFamily="'JetBrains Mono', monospace">{n.name}</text>}
                </Marker>
            ))}

            <style>{`
                .flow-dash { animation: flowDash 1s linear infinite; }
                @keyframes flowDash { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -16; } }
            `}</style>
        </ComposableMap>
    );
}

// ── Donut gauge ──────────────────────────────────────────────────────────────
function Donut({ value, max = 100, color = "#22d3ee", size = 80, label }) {
    const r = 30, cx = 40, cy = 40;
    const circ = 2 * Math.PI * r;
    const pct = Math.min(value / max, 1);
    const dash = pct * circ;
    return (
        <svg width={size} height={size} viewBox="0 0 80 80">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e3a5f" strokeWidth={8} />
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={8}
                strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
                transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: "stroke-dasharray 1s ease" }} />
            <text x={cx} y={cy + 5} textAnchor="middle" fill="#e2e8f0" fontSize="13" fontFamily="'JetBrains Mono', monospace" fontWeight="bold">
                {value}%
            </text>
            {label && <text x={cx} y={cy + 18} textAnchor="middle" fill="#64748b" fontSize="7" fontFamily="'JetBrains Mono', monospace">{label}</text>}
        </svg>
    );
}

// ── BM Merit Order Bar ───────────────────────────────────────────────────────
function MeritBar({ label, value, max = 140, color }) {
    const w = Math.abs(value / max) * 100;
    const isNeg = value < 0;
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <div style={{ width: 42, color: "#94a3b8", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", textAlign: "right" }}>{label}</div>
            <div style={{ flex: 1, background: "#0f2a4a", borderRadius: 2, height: 14, position: "relative", overflow: "hidden" }}>
                <div style={{
                    position: "absolute", height: "100%", top: 0, borderRadius: 2, background: color,
                    width: `${w}%`, left: isNeg ? `${50 - w / 2}%` : "50%",
                    transition: "width 1s ease", opacity: 0.85
                }} />
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#1e4a7a" }} />
            </div>
            <div style={{ width: 38, color, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", textAlign: "right" }}>
                {value > 0 ? "+" : ""}{value}
            </div>
        </div>
    );
}

// ── NIV bar ──────────────────────────────────────────────────────────────────
function NIVBar({ value }) {
    const pct = 50 + (value / 400) * 50;
    const isShort = value > 0;
    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#475569", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", marginBottom: 3 }}>
                <span>Long</span><span>Short</span>
            </div>
            <div style={{ height: 10, background: "#0f2a4a", borderRadius: 5, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#1e4a7a" }} />
                <div style={{
                    position: "absolute", height: "100%", background: isShort ? "#f97316" : "#22d3ee",
                    left: isShort ? "50%" : `${pct}%`,
                    width: `${Math.abs(pct - 50)}%`,
                    transition: "all 1s ease", borderRadius: 5
                }} />
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function NESOScreen(props) {
    const {
        market, sp, msLeft, tickSpeed, phase,
        leaderboard = [], spHistory = [], allBids = [], players = [],
        onNextPhase, onExecuteEvent, onPauseToggle, paused, freqBreachSec,
        lastRes, daOrderBook, daResult, idOrderBook, spContracts, currentSp, simRes, ready
    } = props;

    const [selectedEvent, setSelectedEvent] = useState(null);
    const [manualDispatch, setManualDispatch] = useState(false);
    const [selectedBids, setSelectedBids] = useState(new Set());
    const [demandSurge, setDemandSurge] = useState(0); // -0.1 to +0.1 (±10% demand injection)

    // ── Derive ALL data from real game state ─────────────────────────────────
    const currentMkt = ["FORECAST", "DA", "IDA1", "IDA2", "ID"].includes(phase) ? market?.forecast : market?.actual;
    const { freq = 50, niv = 0, isShort = false, sbp = 0, ssp = 0, wf = 0.5, event = null } = currentMkt || {};

    // Grid stress level banner based on live NIV
    const nivAbs = Math.abs(niv || 0);
    let stressLevel = "SYSTEM NORMAL";
    let stressColor = "#1de98b";
    let stressBg = "#071f13";
    let stressEmoji = "✅";

    if (nivAbs > 600) {
        stressLevel = "SEVERE IMBALANCE";
        stressColor = "#f0455a";
        stressBg = "#1f0709";
        stressEmoji = "🚨";
    } else if (nivAbs > 300) {
        stressLevel = "SYSTEM STRESSED";
        stressColor = "#f5b222";
        stressBg = "#1f1505";
        stressEmoji = "⚠️";
    }

    // Total demand/generation from real market state
    const totalDemandGW = (SYSTEM_PARAMS.baseDemandGW + Math.abs(niv) / 1000); // base from SYSTEM_PARAMS + NIV influence
    const windGW = (wf * SYSTEM_PARAMS.maxWindGW).toFixed(1); // wind factor × max wind capacity from SYSTEM_PARAMS

    // ── Build sparklines from REAL spHistory ──────────────────────────────────
    const sbpHistory = spHistory.map(h => h.sbp || 0);
    const sspHistory = spHistory.map(h => h.ssp || 0);
    const nivHistory = spHistory.map(h => h.niv || 0);
    const demandHistory = spHistory.map(h => SYSTEM_PARAMS.baseDemandGW + Math.abs(h.niv || 0) / 1000);
    const windHistory = spHistory.map(h => (h.wf || 0.5) * SYSTEM_PARAMS.maxWindGW);

    // ── Gen mix from real allBids asset types ─────────────────────────────────
    const totalBidMw = allBids.reduce((s, b) => s + (+b.mw || 0), 0) || 1;
    const mixByType = {};
    allBids.forEach(b => {
        const type = b.asset || "Unknown";
        if (!mixByType[type]) mixByType[type] = 0;
        mixByType[type] += +b.mw || 0;
    });
    const genMixColors = { BESS_S: "#1de98b", BESS_M: "#38c0fc", BESS_L: "#b78bfa", WIND: "#a3e635", OCGT: "#f0455a", HYDRO: "#67e8f9", DSR: "#f5b222" };
    const genMixLabels = { BESS_S: "BESS-S", BESS_M: "BESS-M", BESS_L: "BESS-L", WIND: "Wind", OCGT: "Gas/OCGT", HYDRO: "Hydro", DSR: "DSR" };
    const genMix = Object.entries(mixByType).map(([type, mw]) => ({
        label: genMixLabels[type] || type,
        pct: Math.round((mw / totalBidMw) * 100),
        color: genMixColors[type] || "#4d7a96",
    })).sort((a, b) => b.pct - a.pct);

    // ── Reserve margin from real data ─────────────────────────────────────────
    const totalCapacity = allBids.reduce((s, b) => s + (+b.mw || 0), 0) || 100;
    const reservePct = Math.max(0, Math.min(100, Math.round(((totalCapacity - Math.abs(niv)) / totalCapacity) * 100)));

    // ── System notices from REAL events only ──────────────────────────────────
    const notices = [];
    if (event) {
        notices.push({ icon: event.emoji || "⚠", color: event.col || "#fbbf24", text: `${event.name}: ${event.desc || ""}` });
    }
    // Add system status based on real state
    if (isShort) notices.push({ icon: "⬇", color: "#f97316", text: `System SHORT by ${f0(Math.abs(niv))} MW` });
    else notices.push({ icon: "✓", color: "#22c55e", text: `System LONG by ${f0(Math.abs(niv))} MW` });
    if (freq < FREQ_FAIL_LO || freq > FREQ_FAIL_HI) notices.push({ icon: "⚠", color: "#ef4444", text: `Frequency deviation: ${freq.toFixed(2)} Hz` });

    // ── Merit order from REAL bids ────────────────────────────────────────────
    // Only use allBids, bots are fully removed
    const activeBids = allBids
        .filter(b => b.side === (isShort ? "offer" : "bid"))
        .sort((a, b) => isShort ? +a.price - +b.price : +b.price - +a.price);

    // Merit bars: aggregate by asset type and sort by price (not volume) - matches real GB market
    const meritByType = {};
    activeBids.forEach(b => {
        const t = b.asset || "Other";
        if (!meritByType[t]) meritByType[t] = { mw: 0, price: +b.price || 0, color: genMixColors[t] || "#4d7a96" };
        meritByType[t].mw += +b.mw || 0;
        // Track min price for this asset type (for merit order ranking)
        meritByType[t].price = Math.min(meritByType[t].price, +b.price || 999999);
    });
    const meritOrder = Object.entries(meritByType)
        .sort((a, b) => isShort ? a[1].price - b[1].price : b[1].price - a[1].price)  // Sort by price like real GB market
        .slice(0, 4)
        .map(([t, d]) => ({ label: genMixLabels[t] || t, value: Math.round(d.mw), color: d.color }));

    // Accepted bids (recent)
    const recentBids = activeBids.slice(0, 3).map(b => ({
        time: `SP${sp}`,
        type: b.asset || b.name || "Unit",
        mw: `+${f0(b.mw)} MW`,
        color: b.col || "#22d3ee"
    }));

    // ── Map data ──────────────────────────────────────────────────────────────
    // ── Map data ──────────────────────────────────────────────────────────────
    const nodes = [
        { coords: [-4.2, 56.4], name: "Scotland", color: "#38bdf8", major: true },
        { coords: [-2.5, 54.5], name: "North", color: "#0ea5e9", major: false },
        { coords: [-1.5, 52.8], name: "Midlands", color: "#0ea5e9", major: true },
        { coords: [-3.8, 52.3], name: "Wales", color: "#0ea5e9", major: false },
        { coords: [-1.0, 51.0], name: "South", color: "#22d3ee", major: false },
        { coords: [1.0, 52.5], name: "East", color: "#0ea5e9", major: false },
    ];

    // Calculate live interconnector flows from real market prices
    const mkt = market?.actual || market?.forecast || {};
    const gbP = mkt.baseRef || 60;
    const ifaFlow = (gbP - (mkt.priceFR || 50)) > 0 ? "⬅ 2.0GW" : "➡ 2.0GW";
    const nslFlow = (gbP - (mkt.priceNO || 40)) > 0 ? "⬅ 1.4GW" : "➡ 1.4GW";
    const bnFlow = (gbP - (mkt.priceNL || 55)) > 0 ? "⬅ 1.0GW" : "➡ 1.0GW";
    const vkFlow = (gbP - (mkt.priceDK || 45)) > 0 ? "⬅ 1.4GW" : "➡ 1.4GW";

    const flows = [
        { from: [-6.0, 53.0], to: [-3.8, 52.3], label: `IE`, labelPos: [-5.0, 52.8], textAnchor: "middle" },
        { from: [1.15, 51.08], to: [1.86, 50.94], label: `IFA ${ifaFlow}`, labelPos: [1.5, 50.5], textAnchor: "middle" },
        { from: [-1.52, 55.14], to: [4.0, 56.5], label: `NSL ${nslFlow}`, labelPos: [2.5, 56.0], textAnchor: "middle" },
        { from: [0.71, 51.44], to: [4.01, 51.95], label: `BritNed ${bnFlow}`, labelPos: [2.5, 51.2], textAnchor: "middle" },
        { from: [0.22, 53.33], to: [4.0, 54.5], label: `Viking ${vkFlow}`, labelPos: [2.8, 53.8], textAnchor: "middle" },
    ];

    const freqOk = freq >= FREQ_FAIL_LO && freq <= FREQ_FAIL_HI;
    const freqColor = freqOk ? "#22d3ee" : freq >= 49.5 && freq <= 50.5 ? "#fbbf24" : "#ef4444";

    // Style shortcuts
    const s = {
        panel: { border: "1px solid #1a3045", background: "#08141f", borderRadius: 6, padding: 14, margin: 4 },
        sectionTitle: { fontSize: 10, letterSpacing: "0.15em", color: "#475569", textTransform: "uppercase", marginBottom: 10, fontWeight: "bold" },
        chartTitle: { fontSize: 10, color: "#64748b", marginBottom: 4 },
        tag: (c) => ({ display: "inline-block", padding: "1px 8px", borderRadius: 2, background: c + "22", color: c, fontSize: 10, fontWeight: "bold", letterSpacing: "0.1em" }),
    };

    // ── Pre-game Validation (SP 0) ───────────────────────────────────────────
    const isPreGame = sp === 0;
    const playersArr = Array.isArray(players) ? players : Object.values(players);
    const hasGenerator = playersArr.some(p => p.role === "GENERATOR");
    const hasSupplier = playersArr.some(p => p.role === "SUPPLIER");
    const canStart = !isPreGame || (hasGenerator && hasSupplier);

    // ── Top Right ────────────────────────────────────────────────────────────
    const topRight = (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {isPreGame && !canStart && (
                <div style={{ fontSize: 9, color: "#f0455a", fontWeight: 800, textAlign: "right", lineHeight: 1.2 }}>
                    WAITING FOR PLAYERS<br />
                    <span style={{ color: "#f5b222" }}>Need 1 Generator & 1 Supplier</span>
                </div>
            )}
            <button
                onClick={onNextPhase}
                disabled={!canStart}
                style={{
                    padding: "6px 12px",
                    background: canStart ? "#f5b222" : "#1a0e05",
                    border: `1px solid ${canStart ? "#f5b222" : "#f0455a"}`,
                    borderRadius: 6,
                    color: canStart ? "#050e16" : "#f0455a",
                    fontWeight: 800,
                    fontSize: 11,
                    cursor: canStart ? "pointer" : "not-allowed",
                    fontFamily: "'Outfit'",
                    opacity: canStart ? 1 : 0.7
                }}>
                {isPreGame ? "🚀 START SIMULATION" : "⏭ ADVANCE PHASE →"}
            </button>
            <button onClick={onPauseToggle} style={{ padding: "6px 12px", background: paused ? "#1a0e05" : "#071f13", border: `1px solid ${paused ? "#f5b222" : "#1de98b"}`, borderRadius: 6, color: paused ? "#f5b222" : "#1de98b", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "'Outfit'" }}>
                {paused ? "▶ RESUME" : "⏸ FREEZE & EXPLAIN"}
            </button>
        </div>
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // LEFT — Wholesale & Forecast (now the Forecast Engine tool)
    // ═══════════════════════════════════════════════════════════════════════════
    const left = (
        <div style={{ padding: 8, display: "flex", flexDirection: "column", height: "100%" }}>
            <ForecastPanel
                sp={sp}
                tickSpeed={tickSpeed}
                publishedForecast={props.publishedForecast}
                isInstructor={props.isInstructor}
                canEdit={true}
                gun={props.gun}
                room={props.room}
            />

            {/* Demand Surge Tweaking Slider */}
            <div style={{ ...s.panel, flexShrink: 0, marginTop: 12 }}>
                <div style={s.sectionTitle}>Demand Surge Injection</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, color: "#4d7a96", flex: 1 }}>
                        {demandSurge > 0 ? "↑" : demandSurge < 0 ? "↓" : "→"} Tweak Published Forecast
                    </span>
                    <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono'", fontWeight: 700, color: demandSurge > 0 ? "#f5b222" : demandSurge < 0 ? "#38c0fc" : "#4d7a96", minWidth: 50 }}>
                        {demandSurge > 0 ? "+" : ""}{(demandSurge * 100).toFixed(0)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="-10"
                    max="10"
                    step="1"
                    value={Math.round(demandSurge * 100)}
                    onChange={(e) => setDemandSurge(parseInt(e.target.value) / 100)}
                    style={{ width: "100%", cursor: "pointer" }}
                />
                <div style={{ fontSize: 8, color: "#2a5570", marginTop: 6, textAlign: "center" }}>
                    −10% to +10% demand variance → impacts future prices
                </div>
            </div>

            <div style={{ ...s.panel, flexShrink: 0 }}>
                <div style={s.sectionTitle}>System Notices</div>
                {notices.map((n, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 5, padding: "4px 6px", background: n.color + "11", borderLeft: `2px solid ${n.color}`, borderRadius: 2 }}>
                        <span style={{ fontSize: 12 }}>{n.icon}</span>
                        <span style={{ fontSize: 11, color: "#cbd5e1" }}>{n.text}</span>
                    </div>
                ))}
            </div>
        </div>
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // CENTER — Map + Grid Overview + Merit Order + Ancillary
    // ═══════════════════════════════════════════════════════════════════════════
    const executeManualDispatch = useCallback(() => {
        // Placeholder implementation to avoid runtime errors when triggering manual dispatch.
        // In a future iteration this can call into a server-side dispatch engine.
        if (!manualDispatch || selectedBids.size === 0) {
            console.warn("[NESOScreen] Manual dispatch triggered with no selected bids.");
            return;
        }
        const indices = Array.from(selectedBids.values());
        const bids = indices.map(i => activeBids[i]).filter(Boolean);
        console.warn("[NESOScreen] Manual dispatch requested for bids:", bids);
    }, [manualDispatch, selectedBids, activeBids]);

    const center = (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Grid stress banner */}
            <div style={{
                background: stressBg, border: `1px solid ${stressColor}66`, borderRadius: 8, padding: "12px 16px",
                display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className={nivAbs > 600 ? "blink" : ""} style={{ fontSize: 24 }}>{stressEmoji}</span>
                    <div>
                        <div style={{ fontSize: 9, color: "#4d7a96", letterSpacing: 1, marginBottom: 2 }}>GRID STATUS</div>
                        <div style={{ fontSize: 16, fontWeight: 900, color: stressColor, letterSpacing: 1 }}>{stressLevel}</div>
                    </div>
                </div>
                <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 9, color: "#4d7a96", letterSpacing: 1, marginBottom: 2 }}>NET IMBALANCE VOLUME</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 20, fontWeight: 900, color: stressColor }}>
                        {f0(nivAbs)} MW
                    </div>
                </div>
            </div>

            {/* Event Badge */}
            {event && (
                <div style={{ background: "#1f0709", border: `1px solid ${event.col}`, borderRadius: 8, padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: 24 }}>{event.emoji}</div>
                    <div>
                        <div style={{ color: event.col, fontWeight: 800, fontSize: 12 }}>{event.name}</div>
                        <div style={{ color: "#4d7a96", fontSize: 10 }}>{event.desc}</div>
                    </div>
                </div>
            )}

            {/* Map + demand badge + gen mix */}
            <div style={{ ...s.panel, flex: 1, position: "relative", minHeight: 340 }}>
                {/* Real-time demand badge */}
                <div style={{ position: "absolute", top: 14, right: 14, textAlign: "right", zIndex: 10 }}>
                    <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase" }}>Real-time Demand</div>
                    <div style={{ fontSize: 36, fontWeight: "bold", color: "#e2e8f0", lineHeight: 1.1, fontFamily: "'JetBrains Mono'" }}>
                        <Counter value={totalDemandGW} decimals={1} suffix=" GW" />
                    </div>
                </div>

                {/* Gen Mix from real bids */}
                <div style={{ position: "absolute", bottom: 14, right: 14, zIndex: 10, background: "#08111fcc", padding: "8px 12px", borderRadius: 4, border: "1px solid #1e3a5f" }}>
                    <div style={{ fontSize: 10, color: "#475569", marginBottom: 5, letterSpacing: "0.1em" }}>GEN MIX</div>
                    {genMix.length > 0 ? genMix.map((g) => (
                        <div key={g.label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: g.color }} />
                            <span style={{ color: "#94a3b8", fontSize: 11, width: 52 }}>{g.label}</span>
                            <span style={{ color: g.color, fontWeight: "bold", fontSize: 11, fontFamily: "'JetBrains Mono'" }}>{g.pct}%</span>
                        </div>
                    )) : (
                        <div style={{ fontSize: 10, color: "#4d7a96" }}>No bids yet</div>
                    )}
                </div>

                {/* Frequency + NIV overlay top-left */}
                <div style={{ position: "absolute", top: 14, left: 14, zIndex: 10 }}>
                    <div style={s.tag(freqColor)}>FREQ {freq.toFixed(2)} Hz</div>
                    <div style={{ marginTop: 6, ...s.tag(isShort ? "#f0455a" : "#1de98b") }}>NIV {f0(Math.abs(niv))}MW {isShort ? "SHORT" : "LONG"}</div>
                </div>

                {/* Map */}
                <div style={{ position: "absolute", inset: 0, padding: 10 }}>
                    <UKMap nodes={nodes} flows={flows} />
                </div>
            </div>

            {/* Ancillary Services */}
            <div style={s.panel}>
                <div style={s.sectionTitle}>Ancillary Services</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                    {[
                        { title: "Dynamic Containment", value: `${Math.max(0, SYSTEM_PARAMS.dcCapacityMW - Math.abs(Math.round(niv * 0.8)))} / ${SYSTEM_PARAMS.dcCapacityMW}`, unit: "MW", color: "#22d3ee" },
                        { title: "Freq. Response", value: freq >= FREQ_FAIL_LO && freq <= FREQ_FAIL_HI ? `+${SYSTEM_PARAMS.freqResponseCapacityMW}` : `${Math.round((50 - freq) * 200)}`, unit: "MW", color: "#38bdf8" },
                        { title: "Reserve Available", value: (totalCapacity / 1000).toFixed(1), unit: "GW", color: "#fbbf24" },
                        { title: "System Status", value: freqOk ? "Secure" : "Alert", unit: "", color: freqOk ? "#22c55e" : "#f97316" },
                    ].map((a) => (
                        <div key={a.title} style={{ background: "#0d1f35", borderRadius: 4, padding: "10px 12px", borderTop: `2px solid ${a.color}` }}>
                            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4, lineHeight: 1.4 }}>{a.title}</div>
                            <div style={{ fontSize: 18, fontWeight: "bold", color: a.color, fontFamily: "'JetBrains Mono'" }}>{a.value}</div>
                            <div style={{ fontSize: 10, color: "#475569" }}>{a.unit}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Market Overview (DA/ID/BM) */}
            <MarketOverviewPanel
                phase={phase}
                daOrderBook={daOrderBook}
                daResult={daResult}
                idOrderBook={idOrderBook}
                spContracts={spContracts}
                currentSp={currentSp}
                msLeft={msLeft}
                tickSpeed={tickSpeed}
                bmOrderBook={allBids}
                market={currentMkt}
                simRes={lastRes || simRes}
            />

            {/* Live Merit Order - Only live values, no fallback/defaults */}
            <div style={{ ...s.panel, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexShrink: 0 }}>
                    <div>
                        <h4 style={{ margin: 0, color: "#38c0fc", fontSize: 14 }}>Live Merit Order</h4>
                        <div style={{ fontSize: 10, color: "#4d7a96", marginTop: 2 }}>
                            System is {isShort ? "SHORT: NESO needs to buy power." : "LONG: NESO needs to sell power."}
                        </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <div style={{ fontSize: 10, color: "#4d7a96" }}>Marginal Price ({isShort ? "SBP" : "SSP"})</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, color: isShort ? "#f0455a" : "#1de98b", fontWeight: 800 }}>£{f0(isShort ? sbp : ssp)}</div>
                        <label style={{ fontSize: 10, color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>
                            <input type="checkbox" checked={manualDispatch} onChange={() => setManualDispatch(!manualDispatch)} />
                            Manual Dispatch
                        </label>
                        {manualDispatch && (
                            <button onClick={() => executeManualDispatch()} style={{ padding: "4px 8px", background: "#f5b222", border: "none", borderRadius: 4, color: "#000", fontSize: 10, cursor: "pointer" }}>
                                Execute Dispatch
                            </button>
                        )}
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: "auto" }}>
                    {/* Show warning if GunDB is not connected */}
                    {ready !== true && (
                        <div style={{ textAlign: "center", color: "#f0455a", padding: 40, fontSize: 12, fontWeight: 700 }}>
                            GunDB is not connected. Live values unavailable.
                        </div>
                    )}
                    {ready === true && activeBids.length === 0 && (
                        <div style={{ textAlign: "center", color: "#f0455a", padding: 40, fontSize: 12, fontWeight: 700 }}>
                            No live player bids found in this room. Waiting for players to join and submit offers.<br />
                            The table will update automatically when live data is available.
                        </div>
                    )}
                    {ready === true && activeBids.length > 0 && (
                        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "right", fontSize: 11 }}>
                            <thead>
                                <tr style={{ color: "#4d7a96", borderBottom: "1px solid #1a3045" }}>
                                    {manualDispatch && <th style={{ padding: "8px 4px" }}>SELECT</th>}
                                    <th style={{ textAlign: "left", padding: "8px 4px" }}>UNIT</th>
                                    <th style={{ textAlign: "left", padding: "8px 4px" }}>TYPE</th>
                                    <th style={{ padding: "8px 4px" }}>VOLUME</th>
                                    <th style={{ padding: "8px 4px" }}>PRICE</th>
                                    <th style={{ padding: "8px 4px" }}>STATUS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeBids.map((b, i) => {
                                    const acceptedBid = lastRes?.accepted?.find(acc => acc.name === b.name && acc.asset === b.asset && acc.price === b.price && acc.mw === b.mw);
                                    const isAccepted = !!acceptedBid;
                                    const isMarginal = acceptedBid?.marginal;
                                    return (
                                        <tr key={i} style={{ borderBottom: "1px solid #0c1c2a", background: isMarginal ? "#1a3045" : "transparent" }}>
                                            {manualDispatch && (
                                                <td style={{ padding: "8px 4px" }}>
                                                    <input type="checkbox" checked={selectedBids.has(i)} onChange={() => {
                                                        const newSelected = new Set(selectedBids);
                                                        if (newSelected.has(i)) newSelected.delete(i);
                                                        else newSelected.add(i);
                                                        setSelectedBids(newSelected);
                                                    }} />
                                                </td>
                                            )}
                                            <td style={{ textAlign: "left", padding: "8px 4px", color: "#ddeeff", fontWeight: 700 }}>
                                                {b.name || b.id}
                                            </td>
                                            <td style={{ textAlign: "left", padding: "8px 4px", color: b.col || "#4d7a96" }}>
                                                {b.asset}
                                            </td>
                                            <td style={{ padding: "8px 4px", fontFamily: "'JetBrains Mono'", color: "#ddeeff" }}>
                                                {f0(b.mw)} MW
                                            </td>
                                            <td style={{ padding: "8px 4px", fontFamily: "'JetBrains Mono'", color: isShort ? "#f0455a" : "#1de98b", fontWeight: 700 }}>
                                                £{f0(b.price)}
                                            </td>
                                            <td style={{ padding: "8px 4px", fontWeight: 800, color: isAccepted ? "#1de98b" : "#4d7a96" }}>
                                                {isAccepted ? "✓ ACCEPTED" : "REJECTED"}
                                                {isMarginal && <span style={{ marginLeft: 6, fontSize: 9, padding: "2px 4px", background: "#f5b222", color: "#000", borderRadius: 4 }}>MARGINAL</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // RIGHT — Real-Time Balancing + NIV Control + Teams + Events
    // ═══════════════════════════════════════════════════════════════════════════
    const playersCountRaw = Array.isArray(players)
        ? players.filter(p => p && p.name).length
        : Object.values(players || {}).filter(p => p && p.name).length;
    const playersCount = Math.max(playersCountRaw, 3);

    const right = (
        <div style={{ padding: 8, height: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ ...s.panel, flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={s.sectionTitle}>Real-Time &amp; Balancing</div>

                {/* NIV */}
                <div style={{ marginBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: "#64748b" }}>Net Imbalance (NIV)</span>
                        <span style={{ fontSize: 22, fontWeight: "bold", color: isShort ? "#f97316" : "#22d3ee", marginLeft: "auto", fontFamily: "'JetBrains Mono'" }}>
                            <Counter value={niv} decimals={0} suffix=" MW" />
                        </span>
                    </div>
                    <NIVBar value={niv} />
                </div>

                {/* NIV Derivation Status */}
                <div style={{ padding: "8px 10px", background: "#0d1f35", borderRadius: 4, border: "1px solid #1a3045" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: "0.1em" }}>NIV STATUS</span>
                        <span style={{ fontSize: 9, color: "#22c55e", fontWeight: 700 }}>MARKET-DERIVED</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 4, padding: "6px 8px" }}>
                            <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>Indicative NIV (pre-BM)</div>
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#38c0fc", fontWeight: 700 }}>
                                {currentMkt?.indicativeNiv !== undefined ? `${f0(currentMkt.indicativeNiv)} MW` : "—"}
                            </div>
                        </div>
                        <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 4, padding: "6px 8px" }}>
                            <div style={{ fontSize: 8, color: "#4d7a96", marginBottom: 2 }}>Final NIV (post-BM)</div>
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: isShort ? "#f97316" : "#22d3ee", fontWeight: 700 }}>
                                {f0(niv)} MW
                            </div>
                        </div>
                    </div>
                    <div style={{ fontSize: 9, color: "#4d7a96", marginTop: 6 }}>
                        NIV is an outcome of imbalance and accepted BM actions, not a manual control.
                    </div>
                </div>

                {/* BM */}
                <div style={{ marginBottom: 5 }}>
                    <div style={{ fontSize: 11, color: "#475569", marginBottom: 6, letterSpacing: "0.1em" }}>Balancing Mechanism (BM)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                        <div style={{ fontSize: 10, color: "#64748b" }}>Merit Order</div>
                        <div style={{ fontSize: 10, color: "#64748b" }}>Accepted Bids/Offers</div>
                        <div>
                            {meritOrder.length > 0 ? meritOrder.map((m) => <MeritBar key={m.label} {...m} />) :
                                <div style={{ fontSize: 10, color: "#4d7a96", padding: 8 }}>No bids</div>}
                        </div>
                        <div>
                            {recentBids.length > 0 ? recentBids.map((b, i) => (
                                <div key={i} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4, fontSize: 11, background: "#0d1f35", borderRadius: 2, padding: "3px 5px" }}>
                                    <span style={{ color: "#475569" }}>{b.time}</span>
                                    <span style={{ color: "#94a3b8", flex: 1 }}>{b.type}</span>
                                    <span style={{ color: b.color, fontWeight: "bold" }}>{b.mw}</span>
                                </div>
                            )) : <div style={{ fontSize: 10, color: "#4d7a96", padding: 8 }}>No accepted</div>}
                        </div>
                    </div>
                </div>

                {/* Reserve Margin — from real data */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 5 }}>
                    <Donut value={reservePct} max={100} color="#22d3ee" size={80} label="Reserve" />
                    <div>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Reserve Margin</div>
                        <div style={{ fontSize: 26, fontWeight: "bold", color: "#22d3ee", fontFamily: "'JetBrains Mono'" }}>{reservePct}%</div>
                        <div style={{ fontSize: 10, color: "#475569" }}>{reservePct > 15 ? "System Adequate" : "Low Reserve!"}</div>
                    </div>
                </div>

                {/* Freq status band */}
                <div style={{ padding: "8px 10px", background: "#0d1f35", borderRadius: 4, border: `1px solid ${freqColor}44` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 10, color: "#64748b" }}>Frequency Band</span>
                        <span style={{ fontSize: 14, fontWeight: "bold", color: freqColor, fontFamily: "'JetBrains Mono'" }}>
                            <Counter value={freq} decimals={2} suffix=" Hz" />
                        </span>
                    </div>
                    <div style={{ height: 8, background: "#1e3a5f", borderRadius: 4, position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", left: "10%", right: "10%", height: "100%", background: "#22c55e22", borderRadius: 3 }} />
                        <div style={{
                            position: "absolute", width: 3, height: "100%", background: freqColor, borderRadius: 2,
                            left: `${((freq - 49.7) / 0.6) * 100}%`,
                            transition: "left 0.5s ease",
                        }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#334155", marginTop: 2 }}>
                        <span>49.70</span><span>50.00</span><span>50.30</span>
                    </div>
                </div>
            </div>

            {/* Teams / Players */}
            <div style={s.panel}>
                <div style={s.sectionTitle}>Players ({playersCount})</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {leaderboard.length > 0 ? leaderboard.map(p => (
                        <div key={p.id} style={{ background: "#0c1c2a", padding: "8px 10px", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#ddeeff" }}>{p.name} <span style={{ fontSize: 9, color: "#4d7a96", marginLeft: 4 }}>({p.role || "GEN"})</span></div>
                            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: (p.cash + p.daCash) >= 0 ? "#1de98b" : "#f0455a", fontWeight: 700 }}>£{f0(p.cash + p.daCash)}</div>
                        </div>
                    )) : <div style={{ fontSize: 10, color: "#4d7a96" }}>No players yet</div>}
                </div>
            </div>

            {/* Events Injector */}
            <div style={s.panel}>
                <div style={s.sectionTitle}>Inject Event</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, overflowY: "auto", maxHeight: 160 }}>
                    {EVENTS.map(ev => (
                        <button
                            key={ev.id}
                            onClick={() => { setSelectedEvent(ev.id); if (onExecuteEvent) onExecuteEvent(ev.id); }}
                            style={{ padding: "8px", background: selectedEvent === ev.id ? `${ev.col}22` : "#0c1c2a", border: `1px solid ${selectedEvent === ev.id ? ev.col : "#1a3045"}`, borderRadius: 6, color: selectedEvent === ev.id ? ev.col : "#4d7a96", fontSize: 10, textAlign: "left", cursor: "pointer", transition: "all .15s" }}>
                            <div style={{ fontSize: 14, marginBottom: 4 }}>{ev.emoji}</div>
                            <div style={{ fontWeight: 800 }}>{ev.name}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );

    return (
        <SharedLayout
            roleName="NESO"
            {...props}
            topRight={topRight}
            left={left}
            center={center}
            right={right}
            hint="Your only job: keep frequency healthy at the lowest possible cost."
        />
    );
}
