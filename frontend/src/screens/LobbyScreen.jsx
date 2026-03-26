import ConnectivityIndicator from '../components/ui/ConnectivityIndicator';

/* ─── PREMIUM LOBBY / LANDING PAGE ─── */
export default function LobbyScreen({ name, setName, room, setRoom, ready, onNext }) {
  const canProceed = name.trim().length > 0 && room.trim().length >= 3;
  const randomRoom = () => setRoom(Math.random().toString(36).slice(2, 7).toUpperCase());

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden", background: "#050e16" }}>
      {/* LEFT: Hero Image Panel */}
      <div style={{ flex: "1 1 55%", position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "40px" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/bg-hero.png)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.8, zIndex: 0 }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, #050e16ee 0%, #050e16aa 50%, #050e1622 100%)", zIndex: 1 }} />

        <div style={{ position: "relative", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 48, filter: "drop-shadow(0 0 12px #1de98b44)" }}>⚡</div>
            <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 36, fontWeight: 900, color: "#ffffff", letterSpacing: 4, textShadow: "0 0 20px #1de98baa" }}>GRIDFORGE</div>
          </div>
          <div style={{ fontSize: 13, color: "#1de98b", letterSpacing: 3, fontWeight: 700, textTransform: "uppercase" }}>GB Electricity Market Simulator</div>
        </div>

        <div style={{ position: "relative", zIndex: 2, maxWidth: 480 }}>
          <div style={{ background: "#08141fdd", backdropFilter: "blur(12px)", border: "1px solid #1a3045", borderRadius: 12, padding: "24px", boxShadow: "0 8px 32px #00000088" }}>
            <h3 style={{ margin: "0 0 16px 0", color: "#38c0fc", fontSize: 16, letterSpacing: 1 }}>BECOME A GRID OPERATOR</h3>
            <p style={{ margin: "0 0 12px 0", color: "#cbd5e1", fontSize: 14, lineHeight: 1.6 }}>Experience the intense pressure of the GB Balancing Mechanism. Trade energy, manage physical assets, and keep the frequency stable in a real-time multiplayer simulation.</p>
            <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#1de98b", fontSize: 24, fontWeight: 900, fontFamily: "'JetBrains Mono'" }}>08</div>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>Distinct Roles</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#f5b222", fontSize: 24, fontWeight: 900, fontFamily: "'JetBrains Mono'" }}>5</div>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>Market Types</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#38bdf8", fontSize: 24, fontWeight: 900, fontFamily: "'JetBrains Mono'" }}>100%</div>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>Real-time Sync</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: Join Form Panel */}
      <div style={{ flex: "0 0 450px", background: "#061019", borderLeft: "1px solid #162c3d", display: "flex", flexDirection: "column", justifyContent: "center", padding: "48px", position: "relative", zIndex: 10, boxShadow: "-10px 0 40px #000000" }}>

        <div style={{ marginBottom: 40 }}>
          <ConnectivityIndicator ready={ready} />
        </div>

        <h2 style={{ margin: "0 0 32px 0", color: "#ffffff", fontSize: 28, fontWeight: 800 }}>Join Session</h2>

        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 8, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Trader Name</label>
          <input
            data-testid="player-name-input"
            value={name}
            placeholder="e.g. Alice, GridTrader1..."
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && canProceed && onNext()}
            style={{ width: "100%", padding: "14px 16px", background: "#0a1724", border: "1px solid #1e3a5f", borderRadius: 8, color: "#ddeeff", fontSize: 16, outline: "none", transition: "border-color 0.2s", boxSizing: "border-box" }}
            onFocus={e => e.target.style.borderColor = "#38bdf8"}
            onBlur={e => e.target.style.borderColor = "#1e3a5f"}
          />
        </div>

        <div style={{ marginBottom: 32 }}>
          <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 8, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Room Code</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              data-testid="room-code-input"
              value={room}
              placeholder="e.g. ALPHA"
              onChange={e => setRoom(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
              onKeyDown={e => e.key === "Enter" && canProceed && onNext()}
              style={{ flex: 1, padding: "14px 16px", background: "#0a1724", border: "1px solid #1e3a5f", borderRadius: 8, color: "#f5b222", fontSize: 18, fontFamily: "'JetBrains Mono'", fontWeight: 800, letterSpacing: 4, outline: "none", transition: "border-color 0.2s", boxSizing: "border-box" }}
              onFocus={e => e.target.style.borderColor = "#f5b222"}
              onBlur={e => e.target.style.borderColor = "#1e3a5f"}
            />
            <button
              onClick={randomRoom}
              style={{ padding: "0 16px", background: "#0c1c2a", border: "1px solid #1e3a5f", borderRadius: 8, color: "#94a3b8", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
              onMouseOver={e => { e.target.style.background = "#162c3d"; e.target.style.color = "#ffffff"; }}
              onMouseOut={e => { e.target.style.background = "#0c1c2a"; e.target.style.color = "#94a3b8"; }}
            >
              🎲 Auto
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#475569" }}>The first player to join a room becomes the NESO host.</div>
        </div>

        <button
          data-testid="join-waiting-room"
          onClick={onNext}
          disabled={!canProceed}
          style={{
            width: "100%", padding: "16px", borderRadius: 8, border: "none",
            background: canProceed ? "linear-gradient(135deg, #1de98b, #059669)" : "#1a3045",
            color: canProceed ? "#022c22" : "#4d7a96",
            fontSize: 16, fontWeight: 900, cursor: canProceed ? "pointer" : "not-allowed",
            letterSpacing: 1, fontFamily: "'Outfit'", transition: "all 0.3s",
            boxShadow: canProceed ? "0 4px 14px #1de98b44" : "none"
          }}
          onMouseOver={e => { if (canProceed) e.target.style.transform = "translateY(-2px)"; }}
          onMouseOut={e => { if (canProceed) e.target.style.transform = "translateY(0)"; }}
        >
          JOIN WAITING ROOM →
        </button>

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 10, color: "#334155" }}>
          For educational purposes only.<br />Not affiliated with National Energy System Operator.
        </div>

      </div>
    </div>
  );
}
