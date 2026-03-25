import { useState } from "react";
import { ROLES, GAME_MODES, SCENARIOS, ASSETS, ROOM_STATES } from "../shared/constants.js";

const ROLE_NEEDS_ASSET = (roleId) => {
    const r = ROLES[roleId];
    return r && r.canOwnAssets !== false;
};

const roleAssetOptions = (roleId) => {
    const assets = Object.values(ASSETS);
    if (roleId === "BESS") return assets.filter(a => a.kind === "soc");
    if (roleId === "DSR") return assets.filter(a => a.key === "DSR" || a.kind === "dsr");
    if (roleId === "GENERATOR") return assets.filter(a => a.kind !== "interconnector" && a.kind !== "soc" && a.kind !== "dsr");
    return [];
};

export default function NESOLobby({
    api, room, pid, players, gameMode, setGameMode, scenarioId, setScenarioId
}) {
    const [copied, setCopied] = useState(false);

    const copyRoom = () => {
        navigator.clipboard?.writeText(room);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const activePlayers = Object.values(players).filter(
        p => p && p.name && Date.now() - (p.lastSeen || 0) < 60000
    );

    const assignableRoleOptions = Object.values(ROLES).filter(r => !r.isSystem && r.id !== "INSTRUCTOR");

    // Check if we have the minimum required roles to start
    const hasGenerator = activePlayers.some(p => p.role === "GENERATOR");
    const hasBESS = activePlayers.some(p => p.role === "BESS");
    const hasSupplier = activePlayers.some(p => p.role === "SUPPLIER");
    const hasSupplySide = hasGenerator || hasBESS;
    const hasDemandSide = hasSupplier;

    const canStart = activePlayers.length > 0 && 
        activePlayers.every(p => p.role && p.role !== "UNASSIGNED" && (!ROLE_NEEDS_ASSET(p.role) || !!p.assignedAssetKey)) &&
        hasSupplySide && hasDemandSide;

    const handleStart = () => {
        if (!api || !room || !canStart) return;
        const now = Date.now();
        api.updateRoom(room, {
            roomState: ROOM_STATES.RUNNING,
            phase: "FORECAST_0",
            phaseStartTs: now,
            scenarioId,
            paused: false,
        });
    };

    return (
        <div style={{
            background: "#050e16", minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center",
            fontFamily: "'Outfit', sans-serif", color: "#ddeeff",
            position: "relative", overflowY: "auto", overflowX: "hidden", padding: "24px 0",
        }}>
            {/* Subtle grid background */}
            <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(#38c0fc08 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

            <div style={{ position: "relative", zIndex: 1, maxWidth: 900, width: "100%", padding: "32px 24px" }}>
                {/* Header */}
                <div style={{ textAlign: "center", marginBottom: 32 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 4, color: "#38c0fc", marginBottom: 8 }}>GRIDFORGE</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 28, fontWeight: 900, letterSpacing: 2, marginBottom: 8 }}>NESO CONTROL PANEL</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                        <span style={{ fontSize: 12, color: "#4d7a96" }}>Room Code:</span>
                        <button onClick={copyRoom} style={{
                            background: "#0c1c2a", border: "1px solid #38c0fc44", borderRadius: 6, padding: "4px 14px",
                            fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 900, color: "#38c0fc", letterSpacing: 4, cursor: "pointer",
                        }}>
                            {room}
                        </button>
                        <span style={{ fontSize: 10, color: copied ? "#1de98b" : "#4d7a96" }}>{copied ? "Copied!" : "Click to copy"}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#4d7a96", marginTop: 4 }}>
                        Share this code with other players to join
                    </div>
                </div>

                {/* Room Status */}
                <div style={{
                    background: "#0a1929", border: "1px solid #38c0fc22", borderRadius: 12, padding: 20, marginBottom: 20,
                }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#38c0fc", marginBottom: 12 }}>ROOM STATUS</div>
                    <div style={{ background: "#0c1c2a", border: "1px solid #38c0fc44", borderRadius: 10, padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ fontSize: 22 }}>{ROLES.NESO.emoji}</div>
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 800, color: "#38c0fc" }}>You are the NESO System Operator</div>
                            <div style={{ fontSize: 9, color: "#8ab8d0", marginTop: 2 }}>Monitor players, assign roles, and start the simulation when ready.</div>
                        </div>
                    </div>
                </div>

                {/* Requirements Check */}
                <div style={{
                    background: "#0a1929", border: "1px solid #b78bfa33", borderRadius: 12, padding: 20, marginBottom: 20,
                }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#b78bfa", marginBottom: 12 }}>START REQUIREMENTS</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 12, height: 12, borderRadius: "50%", background: hasSupplySide ? "#1de98b" : "#f0455a" }} />
                            <span style={{ fontSize: 9, color: "#8ab8d0" }}>Supply Side (Generator/BESS)</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 12, height: 12, borderRadius: "50%", background: hasDemandSide ? "#1de98b" : "#f0455a" }} />
                            <span style={{ fontSize: 9, color: "#8ab8d0" }}>Demand Side (Supplier)</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 12, height: 12, borderRadius: "50%", background: activePlayers.length >= 2 ? "#1de98b" : "#f5b222" }} />
                            <span style={{ fontSize: 9, color: "#8ab8d0" }}>Min Players: {activePlayers.length}/2</span>
                        </div>
                    </div>
                    <div style={{ fontSize: 9, color: canStart ? "#1de98b" : "#f5b222", marginTop: 12, fontWeight: 700 }}>
                        {canStart ? "✓ All requirements met - Ready to start!" : "⚠ Waiting for required roles/assets"}
                    </div>
                </div>

                {/* Game Settings */}
                <div style={{
                    background: "#0a1929", border: "1px solid #b78bfa33", borderRadius: 12, padding: 20, marginBottom: 20,
                }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#b78bfa", marginBottom: 12 }}>GAME SETTINGS</div>

                    {/* Game Mode */}
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#8ab8d0", marginBottom: 6 }}>GAME MODE</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {Object.values(GAME_MODES).map(gm => (
                                <button key={gm.id} onClick={() => setGameMode(gm.id)} style={{
                                    background: gameMode === gm.id ? "#b78bfa22" : "#0c1c2a",
                                    border: `1px solid ${gameMode === gm.id ? "#b78bfa" : "#38c0fc22"}`,
                                    borderRadius: 6, padding: "6px 12px", cursor: "pointer",
                                    fontSize: 9, fontWeight: 700, color: gameMode === gm.id ? "#b78bfa" : "#8ab8d0",
                                }}>
                                    {gm.emoji} {gm.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Scenario */}
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#8ab8d0", marginBottom: 6 }}>SCENARIO</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {Object.values(SCENARIOS).filter(s => s.id === "NORMAL").map(s => (
                                <button key={s.id} onClick={() => setScenarioId(s.id)} style={{
                                    background: scenarioId === s.id ? `${s.col}22` : "#0c1c2a",
                                    border: `1px solid ${scenarioId === s.id ? s.col : "#38c0fc22"}`,
                                    borderRadius: 6, padding: "6px 12px", cursor: "pointer",
                                    fontSize: 9, fontWeight: 700, color: scenarioId === s.id ? s.col : "#8ab8d0",
                                }}>
                                    {s.emoji} {s.name}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Players */}
                <div style={{
                    background: "#0a1929", border: "1px solid #38c0fc22", borderRadius: 12, padding: 20, marginBottom: 20,
                }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#38c0fc", marginBottom: 12 }}>
                        CONNECTED PLAYERS ({activePlayers.length})
                    </div>
                    {activePlayers.length === 0 ? (
                        <div style={{ fontSize: 11, color: "#4d7a96", textAlign: "center", padding: 16 }}>
                            Waiting for players to join...
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {activePlayers.map((p, i) => {
                                const r = ROLES[p.role] || { emoji: "⏳", name: "Unassigned" };
                                const preferred = p.preferredRole ? (ROLES[p.preferredRole] || { name: p.preferredRole, emoji: "📝" }) : null;
                                const assetChoices = roleAssetOptions(p.role);
                                return (
                                    <div key={p.id || i} style={{
                                        background: "#0c1c2a", border: "1px solid #38c0fc22", borderRadius: 8, padding: "6px 12px",
                                        display: "flex", alignItems: "flex-start", gap: 12, justifyContent: "space-between", minWidth: 280
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{ fontSize: 14 }}>{r.emoji}</span>
                                            <div>
                                                <div style={{ fontSize: 10, fontWeight: 700, color: "#ddeeff" }}>
                                                    {p.name}
                                                </div>
                                                <div style={{ fontSize: 8, color: "#4d7a96" }}>Final: {r.name}</div>
                                                <div style={{ fontSize: 8, color: "#2a86b8" }}>Preferred: {preferred ? preferred.name : "Not chosen"}</div>
                                                {p.assignedAssetKey && <div style={{ fontSize: 8, color: "#1de98b" }}>Asset: {ASSETS[p.assignedAssetKey]?.name || p.assignedAssetKey}</div>}
                                                {!p.assignedAssetKey && p.preferredAssetKey && <div style={{ fontSize: 8, color: "#f5b222" }}>Preferred asset: {ASSETS[p.preferredAssetKey]?.name || p.preferredAssetKey}</div>}
                                            </div>
                                        </div>

                                        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 132 }}>
                                            <select
                                                value={p.role || "UNASSIGNED"}
                                                onChange={(e) => {
                                                    const newRole = e.target.value;
                                                    if (api && room) {
                                                        api.putPlayer(room, p.id, {
                                                            role: newRole,
                                                            status: newRole === "UNASSIGNED" ? "Waiting" : "RoleAssigned",
                                                            assignedAssetKey: ROLE_NEEDS_ASSET(newRole) ? (p.assignedAssetKey || p.preferredAssetKey || null) : null,
                                                        });
                                                    }
                                                }}
                                                style={{
                                                    background: "#050e16", border: "1px solid #38c0fc44", borderRadius: 4,
                                                    color: "#38c0fc", fontSize: 9, padding: "4px", outline: "none", cursor: "pointer",
                                                    fontWeight: 700, fontFamily: "'Outfit'"
                                                }}
                                            >
                                                <option value="UNASSIGNED">Unassigned</option>
                                                {assignableRoleOptions.map(opt => (
                                                    <option key={opt.id} value={opt.id}>{opt.name}</option>
                                                ))}
                                            </select>
                                            {ROLE_NEEDS_ASSET(p.role) && (
                                                <select
                                                    value={p.assignedAssetKey || ""}
                                                    onChange={(e) => {
                                                        if (api && room) api.putPlayer(room, p.id, { assignedAssetKey: e.target.value || null, status: e.target.value ? "RoleAssigned" : "Waiting" });
                                                    }}
                                                    style={{
                                                        background: "#050e16", border: "1px solid #1de98b44", borderRadius: 4,
                                                        color: "#1de98b", fontSize: 9, padding: "4px", outline: "none", cursor: "pointer",
                                                        fontWeight: 700, fontFamily: "'Outfit'"
                                                    }}
                                                >
                                                    <option value="">Assign asset</option>
                                                    {assetChoices.map(asset => (
                                                        <option key={asset.key} value={asset.key}>{asset.name}</option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                    <button onClick={handleStart} disabled={!canStart} style={{
                        padding: "16px 48px", background: canStart ? "linear-gradient(135deg, #38c0fc22, #b78bfa22)" : "#0c1c2a",
                        border: "1px solid #38c0fc66", borderRadius: 8, color: canStart ? "#38c0fc" : "#4d7a96", fontSize: 14,
                        fontWeight: 800, cursor: canStart ? "pointer" : "not-allowed", fontFamily: "'Outfit'", letterSpacing: 1,
                    }}>
                        {canStart ? "🚀 START SIMULATION" : "⏳ WAITING FOR REQUIREMENTS"}
                    </button>
                </div>
            </div>
        </div>
    );
}
