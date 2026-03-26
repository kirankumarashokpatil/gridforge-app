import React, { useMemo } from 'react';
import { EVENTS } from '../../shared/constants';

export default function EventFeed({ spHistory = [], maxItems = 5, title = "Market Notices" }) {
    const latestSp = (spHistory && spHistory[0] && spHistory[0].sp) || null;
    const events = useMemo(() => {
        return (spHistory || [])
            .filter(h => h && h.event && h.event.id)
            .slice(0, maxItems);
    }, [spHistory, maxItems]);

    return (
        <div style={{ background: "#0c1c2a", border: "1px solid #1a3045", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>{title}</div>
            {events.length === 0 ? (
                <div style={{ fontSize: 10, color: "#4d7a96" }}>No recent events.</div>
            ) : events.map((h) => {
                const ev = h.event || {};
                const evDef = EVENTS.find(e => e.id === ev.id) || ev;
                const color = evDef.col || "#38c0fc";
                const isLatest = latestSp !== null && h.sp === latestSp;
                return (
                    <div
                        key={`${h.sp}-${ev.id}`}
                        style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            padding: "8px 10px",
                            borderRadius: 6,
                            background: isLatest ? "#0b2a4a" : "#051424",
                            border: `1px solid ${color}22`,
                        }}>
                        <div style={{ fontSize: 16 }}>{evDef.emoji || "ℹ️"}</div>
                        <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color }}>{evDef.name || ev.id}</span>
                                <span style={{ fontSize: 9, color: "#4d7a96" }}>
                                    SP{h.sp} {isLatest ? "• NEW" : ""}
                                </span>
                            </div>
                            {evDef.desc ? (
                                <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{evDef.desc}</div>
                            ) : null}
                            {h.time ? (
                                <div style={{ fontSize: 8, color: "#334155", marginTop: 4 }}>{h.time}</div>
                            ) : null}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
