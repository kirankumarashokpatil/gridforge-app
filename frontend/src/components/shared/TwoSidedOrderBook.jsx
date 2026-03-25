import React from 'react';
import { f0, f1 } from '../../shared/utils';
import { ASSETS } from '../../shared/constants';

export default function TwoSidedOrderBook({ allBids, market, simRes, pid, assetKey }) {
  const { isShort } = market || {};
  const cp = simRes?.cp || 0;
  const acceptedIds = new Set((simRes?.accepted || []).map(a => a.id));

  const offers = [...allBids.filter(b => b.side === "offer" && +b.mw > 0)].sort((a, b) => +a.price - +b.price);
  const bids = [...allBids.filter(b => b.side === "bid" && +b.mw > 0)].sort((a, b) => +b.price - +a.price);

  const maxMW = Math.max(...[...offers, ...bids].map(b => +b.mw), 1);

  const Row = ({ b, side }) => {
    const isMe = b.id === pid;
    const accepted = acceptedIds.has(b.id);
    const def = ASSETS[b.asset] || {};
    const col = isMe ? (def.col || "#38c0fc") : (accepted ? (side === "offer" ? "#f0455a" : "#1de98b") : "#2a5570");
    const barPct = Math.min(100, (+b.mw / maxMW) * 100);

    return (
      <div style={{
        display: "grid", gridTemplateColumns: "14px 1fr 50px 50px",
        gap: 4, alignItems: "center", padding: "2px 6px",
        background: isMe ? "#0e1e3088" : "transparent",
        borderLeft: isMe ? `2px solid ${def.col || "#38c0fc"}` : "2px solid transparent",
        fontSize: 8.5, position: "relative",
      }}>
        <span style={{ fontSize: 10 }}>{def.emoji || (b.isBot ? "🤖" : "👤")}</span>
        <div style={{ position: "relative", height: 12, borderRadius: 2, overflow: "hidden", background: "#0a1724" }}>
          <div style={{
            position: "absolute", top: 0, bottom: 0,
            [side === "offer" ? "left" : "right"]: 0,
            width: `${barPct}%`,
            background: `${col}33`, borderRadius: 2,
            transition: "width 0.3s",
          }} />
          <span style={{
            position: "relative", zIndex: 1, fontSize: 7.5, color: col,
            fontWeight: isMe ? 800 : 400, padding: "0 4px", lineHeight: "12px",
            display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {isMe ? "▶ YOU" : (b.name || b.id?.slice(0, 6))}
          </span>
        </div>
        <span style={{ fontFamily: "'JetBrains Mono'", color: col, fontWeight: 700, textAlign: "right" }}>
          {f0(b.mw)}
        </span>
        <span style={{ fontFamily: "'JetBrains Mono'", color: accepted ? "#f5b222" : "#4d7a96", fontWeight: accepted ? 800 : 400, textAlign: "right" }}>
          £{f0(b.price)}
        </span>
      </div>
    );
  };

  if (offers.length === 0 && bids.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#2a5570", fontSize: 9 }}>
        No orders yet — submit a bid or offer
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", gap: 2 }}>
      {/* OFFERS (Sellers) */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "grid", gridTemplateColumns: "14px 1fr 50px 50px", gap: 4, padding: "2px 6px", marginBottom: 2 }}>
          <span />
          <span style={{ fontSize: 7, color: isShort ? "#f0455a" : "#2a5570", fontWeight: 700, letterSpacing: 0.5 }}>
            {isShort ? "⬆ OFFERS (ACTIVE)" : "⬆ OFFERS"}
          </span>
          <span style={{ fontSize: 7, color: "#2a5570", textAlign: "right" }}>MW</span>
          <span style={{ fontSize: 7, color: "#2a5570", textAlign: "right" }}>£/MWh</span>
        </div>
        {offers.map((b, i) => <Row key={b.id || i} b={b} side="offer" />)}
        {offers.length === 0 && <div style={{ padding: 4, fontSize: 7.5, color: "#1a3045", textAlign: "center" }}>No offers</div>}
      </div>

      {/* CLEARING PRICE LINE */}
      {cp > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, padding: "3px 6px",
          background: "#f5b22215", borderTop: "1px dashed #f5b22255", borderBottom: "1px dashed #f5b22255",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 7.5, color: "#f5b222", fontWeight: 700 }}>CP</span>
          <div style={{ flex: 1, height: 1, background: "#f5b22244" }} />
          <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 10, fontWeight: 900, color: "#f5b222" }}>
            £{f1(cp)}/MWh
          </span>
          <div style={{ flex: 1, height: 1, background: "#f5b22244" }} />
          <span style={{ fontSize: 7.5, color: "#f5b222" }}>{f0(simRes?.cleared || 0)} MW</span>
        </div>
      )}

      {/* BIDS (Buyers) */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "grid", gridTemplateColumns: "14px 1fr 50px 50px", gap: 4, padding: "2px 6px", marginBottom: 2 }}>
          <span />
          <span style={{ fontSize: 7, color: !isShort ? "#1de98b" : "#2a5570", fontWeight: 700, letterSpacing: 0.5 }}>
            {!isShort ? "⬇ BIDS (ACTIVE)" : "⬇ BIDS"}
          </span>
          <span style={{ fontSize: 7, color: "#2a5570", textAlign: "right" }}>MW</span>
          <span style={{ fontSize: 7, color: "#2a5570", textAlign: "right" }}>£/MWh</span>
        </div>
        {bids.map((b, i) => <Row key={b.id || i} b={b} side="bid" />)}
        {bids.length === 0 && <div style={{ padding: 4, fontSize: 7.5, color: "#1a3045", textAlign: "center" }}>No bids</div>}
      </div>
    </div>
  );
}
