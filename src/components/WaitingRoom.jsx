import { useState, useEffect, useRef } from "react";
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

/* ─── WAITING ROOM ─── */
export default function WaitingRoom({
    api, room, name, pid, role, setRole, setScreen,
    isHost, setIsHost, gameMode, setGameMode, scenarioId, setScenarioId, players, setPlayers, roomState, connect
}) {
    const [copied, setCopied] = useState(false);
    const joinedRef = useRef(false);

    // Connect to WebSocket on mount
    useEffect(() => {
        if (!room || joinedRef.current) return;
        joinedRef.current = true;
        
        // Connect WebSocket for real-time updates
        connect(room);
        
        // Create room if it doesn't exist, then register player via API
        if (api && pid) {
            api.createRoom(room, scenarioId || "BAU")
                .catch(err => console.warn('[WaitingRoom] createRoom skipped/failed:', err))
                .then(() => api.putPlayer(room, pid, {
                    name: (name || "").trim(),
                    preferredRole: null,
                    preferredAssetKey: null,
                    lastSeen: Date.now(),
                }))
                .then(async () => {
                    console.log('[WaitingRoom] Player registered:', { pid, name });
                    // Fetch full player list to populate state (fixes host detection race)
                    try {
                        const allPlayers = await api.getPlayers(room);
                        if (Array.isArray(allPlayers)) {
                            // Determine host status immediately from the database truth
                            const me = allPlayers.find(p => p.player_id === pid);
                            const otherNamed = allPlayers.filter(p => p.player_id !== pid && p.name);
                            if (!isHost && me?.name && otherNamed.length === 0) {
                                console.log('[WaitingRoom] Detected as first player from API - setting as host');
                                setIsHost(true);
                            }

                            if (allPlayers.length > 0 && setPlayers) {
                                const keyed = {};
                                allPlayers.forEach(p => { if (p.player_id) keyed[p.player_id] = p; });
                                setPlayers(prev => ({ ...prev, ...keyed }));
                            }
                        }
                    } catch (err) {
                        console.warn('[WaitingRoom] Failed to fetch players after register:', err);
                    }
                })
                .catch(err => {
                    console.error('[WaitingRoom] Failed to register player:', err);
                });
        }
    }, [api, room, pid, name, connect]);

    // Keep-alive heartbeat
    useEffect(() => {
        if (!api || !room || !pid) return;
        const interval = setInterval(() => {
            api.putPlayer(room, pid, { lastSeen: Date.now() });
        }, 5000);
        return () => clearInterval(interval);
    }, [api, room, pid]);


    useEffect(() => {
        const dbRole = players[pid]?.role;
        if (dbRole && dbRole !== role) {
            setRole(dbRole);
        }
    }, [players, pid, role, setRole]);

    // When confirmed as host, set NESO role
    useEffect(() => {
        if (!api || !room || !pid || !isHost) return;
        setRole("NESO");
        api.putPlayer(room, pid, {
            role: "NESO",
            preferredRole: "NESO",
            status: "ASSIGNED",
            ready: true,
            lastSeen: Date.now(),
        });
    }, [api, room, pid, isHost, setRole]);

    const copyRoom = () => {
        navigator.clipboard?.writeText(room);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const toggleReady = () => {
        if (!api || !room || !pid) return;
        const me = players[pid];
        const newReady = !me?.ready;
        api.putPlayer(room, pid, { 
            ready: newReady,
            status: newReady ? "READY" : "ASSIGNED"
        });
    };

    const handleStart = () => {
        if (!api || !room || !isHost || !canStart) return;
        const now = Date.now();
        api.updateRoom(room, {
            roomState: ROOM_STATES.RUNNING,
            sp: 1,
            phase: "DA",
            phaseStartTs: now,
            scenarioId,
            paused: false,
            phaseAuthorityPid: pid,
            phaseSeq: 1,
            advancedBy: pid,
            advancedAt: now,
            updatedBy: pid,
            updatedAt: now,
            timerBy: pid,
            timerMsLeft: 0,
            timerPublishedAt: now,
        });
    };

    // Fix for Date.now() staleness - refresh periodically
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 5000);
        return () => clearInterval(interval);
    }, []);

    const activePlayers = Object.values(players).filter(
        p => p && p.name && now - (p.lastSeen || 0) < 120000 // Increased from 60s to 120s
    );

    const roleOptions = Object.values(ROLES).filter(r => !r.isSystem && r.id !== "INSTRUCTOR");
    const assignableRoleOptions = roleOptions; // NESO is now marked as isSystem, so it's automatically excluded
    const myPlayer = pid ? players[pid] : null;

    // Debug: Log player state
    console.log('[WaitingRoom] Players state:', {
        totalPlayers: Object.keys(players).length,
        activePlayers: activePlayers.length,
        allPlayers: Object.entries(players).map(([id, p]) => ({
            id,
            name: p?.name,
            role: p?.role,
            preferredRole: p?.preferredRole,
            assignedAssetKey: p?.assignedAssetKey,
            preferredAssetKey: p?.preferredAssetKey,
            lastSeen: p?.lastSeen,
            ageSec: p?.lastSeen ? Math.floor((now - p.lastSeen) / 1000) : 'unknown'
        })),
        myPid: pid,
        isHost,
        myPlayer: myPlayer
    });

    const myPreferredRole = isHost ? "NESO" : (myPlayer?.preferredRole || "GENERATOR");
    const myPreferredAssetKey = myPlayer?.preferredAssetKey || "";
    const myAssignedRole = myPlayer?.role;
    const myAssignedAsset = myPlayer?.assignedAssetKey;
    const isReady = myPlayer?.ready || false;

    // Ready gate - player can only ready if role assigned (and asset if needed)
    const canPlayerReady = myAssignedRole && myAssignedRole !== "UNASSIGNED" && 
        (!ROLE_NEEDS_ASSET(myAssignedRole) || !!myAssignedAsset);

    // Check requirements
    const hasGenerator = activePlayers.some(p => p.role === "GENERATOR");
    const hasBESS = activePlayers.some(p => p.role === "BESS");
    const hasSupplier = activePlayers.some(p => p.role === "SUPPLIER");
    const hasDSR = activePlayers.some(p => p.role === "DSR");
    const hasSupplySide = hasGenerator || hasBESS;
    const hasDemandSide = hasSupplier || hasDSR;

    const allRolesAssigned = activePlayers.length > 0 && activePlayers.every(p => {
        const effectiveRole = (p.id === pid && isHost) ? "NESO" : p.role;
        return effectiveRole && effectiveRole !== "UNASSIGNED" &&
            (!ROLE_NEEDS_ASSET(effectiveRole) || !!p.assignedAssetKey);
    });

    const allReady = activePlayers.length > 0 && activePlayers.every(p =>
        (p.id === pid && isHost) ? true : !!p.ready
    );

    // Advisory: count player-side generation capacity (informational only, not a start gate)
    const totalGenCapacity = activePlayers
        .filter(p => p.role === "GENERATOR" || p.role === "BESS")
        .reduce((sum, p) => {
            if (p.assignedAssetKey && ASSETS[p.assignedAssetKey]) {
                return sum + (ASSETS[p.assignedAssetKey].maxMW || 0);
            }
            return sum;
        }, 0);

    const canStart = isHost &&
        activePlayers.length >= 2 &&
        allRolesAssigned &&
        allReady;

    return (
        <div style={{
            background: "#050e16", height: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center",
            fontFamily: "'Outfit', sans-serif", color: "#ddeeff",
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0, overflowY: "auto", overflowX: "hidden", padding: "24px 0",
        }}>
            {/* Subtle grid background */}
            <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(#38c0fc08 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

            <div style={{ position: "relative", zIndex: 1, maxWidth: 720, width: "100%", padding: "32px 24px" }}>
                {/* Header */}
                <div style={{ textAlign: "center", marginBottom: 32 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 4, color: "#38c0fc", marginBottom: 8 }}>GRIDFORGE</div>
                    <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 28, fontWeight: 900, letterSpacing: 2, marginBottom: 8 }}>
                        {isHost ? "NESO CONTROL PANEL" : "WAITING ROOM"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                        <span style={{ fontSize: 12, color: "#4d7a96" }}>Room Code:</span>
                        <button data-testid="room-code-button" onClick={copyRoom} style={{
                            background: "#0c1c2a", border: "1px solid #38c0fc44", borderRadius: 6, padding: "4px 14px",
                            fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 900, color: "#38c0fc", letterSpacing: 4, cursor: "pointer",
                        }}>
                            {room}
                        </button>
                        <span style={{ fontSize: 10, color: copied ? "#1de98b" : "#4d7a96" }}>{copied ? "Copied!" : "Click to copy"}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#4d7a96", marginTop: 4 }}>
                        {isHost ? "Share this code with other players to join" : `Waiting for NESO to start the game (${activePlayers.length} players)`}
                    </div>
                </div>

                {/* My Assignment Card (for non-hosts) */}
                {!isHost && (
                    <div style={{
                        background: "#0a1929", border: "1px solid #38c0fc22", borderRadius: 12, padding: 20, marginBottom: 20,
                    }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#38c0fc", marginBottom: 12 }}>YOUR STATUS</div>
                        
                        {/* Clear status indicator */}
                        <div style={{ 
                            background: myPlayer?.role && myPlayer?.role !== "UNASSIGNED" ? "#0c1c2a" : "#1a1f2e", 
                            border: `1px solid ${myPlayer?.role && myPlayer?.role !== "UNASSIGNED" ? "#1de98b44" : "#f5b22244"}`, 
                            borderRadius: 10, padding: 14, marginBottom: 12 
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                                <span style={{ fontSize: 24 }}>
                                    {myPlayer?.role && myPlayer?.role !== "UNASSIGNED" ? ROLES[myPlayer.role]?.emoji : "⏳"}
                                </span>
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 800, color: myPlayer?.role && myPlayer?.role !== "UNASSIGNED" ? "#1de98b" : "#f5b222" }}>
                                        {myPlayer?.role && myPlayer?.role !== "UNASSIGNED" ? "ASSIGNED BY NESO" : "WAITING FOR ASSIGNMENT"}
                                    </div>
                                    <div style={{ fontSize: 10, color: "#8ab8d0" }}>
                                        {myPlayer?.role && myPlayer?.role !== "UNASSIGNED" ? ROLES[myPlayer.role]?.name : "Choose your preference below"}
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        {myPlayer?.role && myPlayer?.role !== "UNASSIGNED" ? (
                            <div style={{ background: "#0c1c2a", border: "1px solid #1de98b44", borderRadius: 10, padding: 14 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                                    <span style={{ fontSize: 24 }}>{ROLES[myPlayer.role]?.emoji}</span>
                                    <div>
                                        <div style={{ fontSize: 14, fontWeight: 800, color: "#1de98b" }}>{ROLES[myPlayer.role]?.name}</div>
                                        {myPlayer?.assignedAssetKey && (
                                            <div style={{ fontSize: 10, color: "#8ab8d0" }}>{ASSETS[myPlayer.assignedAssetKey]?.name}</div>
                                        )}
                                    </div>
                                    <div style={{ marginLeft: "auto", fontSize: 12, color: "#1de98b" }}>✓ Confirmed by NESO</div>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    <button 
                                        onClick={toggleReady}
                                        disabled={!canPlayerReady}
                                        style={{
                                            flex: 1,
                                            padding: "10px 16px",
                                            background: myPlayer?.ready ? "#1de98b22" : "#0c1c2a",
                                            border: `1px solid ${myPlayer?.ready ? "#1de98b" : canPlayerReady ? "#38c0fc44" : "#f5b22244"}`,
                                            borderRadius: 6,
                                            color: myPlayer?.ready ? "#1de98b" : canPlayerReady ? "#38c0fc" : "#4d7a96",
                                            fontSize: 12,
                                            fontWeight: 800,
                                            cursor: canPlayerReady ? "pointer" : "not-allowed",
                                        }}
                                    >
                                        {myPlayer?.ready ? "✓ READY" : canPlayerReady ? "○ NOT READY (click to ready)" : "○ WAITING FOR ASSIGNMENT"}
                                    </button>
                                    {!canPlayerReady && (
                                        <div style={{ fontSize: 9, color: "#f5b222", textAlign: "center" }}>
                                            NESO must assign your role{ROLE_NEEDS_ASSET(myAssignedRole) ? " and asset" : ""} before you can ready
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div style={{ background: "#0c1c2a", border: "1px solid #f5b22244", borderRadius: 10, padding: 14 }}>
                                <div style={{ fontSize: 12, color: "#f5b222", marginBottom: 8 }}>⏳ Waiting for NESO to assign your role...</div>
                                <div style={{ fontSize: 9, color: "#8ab8d0" }}>You can suggest a preference below</div>
                            </div>
                        )}
                    </div>
                )}

                <div style={{
                    background: "#0a1929", border: "1px solid #38c0fc22", borderRadius: 12, padding: 20, marginBottom: 20,
                }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#38c0fc", marginBottom: 12 }}>
                        {isHost ? "ROOM AUTHORITY" : "CHOOSE YOUR ROLE PREFERENCE"}
                    </div>
                    {isHost ? (
                        <div style={{ background: "#0c1c2a", border: "1px solid #38c0fc44", borderRadius: 10, padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ fontSize: 22 }}>{ROLES.NESO.emoji}</div>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 800, color: "#38c0fc" }}>You are the NESO host / authority</div>
                                <div style={{ fontSize: 9, color: "#8ab8d0", marginTop: 2 }}>Assign final roles and assets, then start the game for everyone.</div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div style={{ background: "#0c1c2a", border: "1px solid #f5b22244", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, color: "#f5b222", fontWeight: 700, marginBottom: 4 }}>📋 HOW TO JOIN:</div>
                                <div style={{ fontSize: 8, color: "#8ab8d0", lineHeight: 1.4 }}>
                                    1. Choose your preferred role below<br/>
                                    2. If role needs an asset, select your preferred asset<br/>
                                    3. Wait for NESO to assign you a final role<br/>
                                    4. Click "READY" when assigned
                                </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                                {assignableRoleOptions.map(r => (
                                    <button data-testid={`role-${r.id}`} key={r.id} onClick={() => {
                                        console.log('[WaitingRoom] Role button clicked:', r.id);
                                        if (api && room && pid) api.putPlayer(room, pid, { preferredRole: r.id });
                                    }} style={{
                                        background: myPreferredRole === r.id ? "#38c0fc18" : "#0c1c2a",
                                        border: `1px solid ${myPreferredRole === r.id ? "#38c0fc" : "#38c0fc22"}`,
                                        borderRadius: 8, padding: "10px 8px", cursor: "pointer", textAlign: "center",
                                        transition: "all 0.2s",
                                    }}>
                                        <div style={{ fontSize: 20 }}>{r.emoji}</div>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: myPreferredRole === r.id ? "#38c0fc" : "#8ab8d0", marginTop: 4 }}>{r.name}</div>
                                        <div style={{ fontSize: 7.5, color: "#4d7a96", marginTop: 2, lineHeight: 1.4 }}>{r.desc}</div>
                                    </button>
                                ))}
                            </div>
                            {ROLE_NEEDS_ASSET(myPreferredRole) && (
                                <div style={{ marginTop: 14 }}>
                                    <div style={{ fontSize: 9, color: "#8ab8d0", marginBottom: 6, fontWeight: 700 }}>PREFERRED ASSET</div>
                                    <select
                                        value={myPreferredAssetKey}
                                        onChange={(e) => {
                                            if (api && room && pid) api.putPlayer(room, pid, { preferredAssetKey: e.target.value || null });
                                        }}
                                        style={{ 
                                            width: "100%", 
                                            background: "#050e16", 
                                            border: "2px solid #38c0fc", 
                                            borderRadius: 6, 
                                            color: "#38c0fc", 
                                            fontSize: 12, 
                                            padding: "12px",
                                            cursor: "pointer",
                                            outline: "none",
                                            fontWeight: "600"
                                        }}
                                    >
                                        <option value="" style={{ background: "#050e16", color: "#8ab8d0" }}>No preference</option>
                                        {roleAssetOptions(myPreferredRole).map(asset => (
                                            <option key={asset.key} value={asset.key} style={{ background: "#050e16", color: "#38c0fc" }}>
                                                {asset.emoji} {asset.name} ({asset.tier})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Quick Help Panel */}
                <div style={{
                    background: "#0a1929", border: "1px solid #38c0fc22", borderRadius: 12, padding: 20, marginBottom: 20,
                }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#38c0fc", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                        🎮 QUICK START TIPS
                    </div>
                    <div style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 6 }}>
                        <div><strong style={{ color: "#1de98b" }}>1. Pick a role</strong> that matches your strategy</div>
                        <div><strong style={{ color: "#1de98b" }}>2. Click the "Learn" button</strong> (top-right) to see role strategies and market terminology</div>
                        <div><strong style={{ color: "#1de98b" }}>3. Watch the market phases</strong> unfold: DA ➜ ID ➜ BM ➜ Settlement</div>
                        <div><strong style={{ color: "#1de98b" }}>4. Your score is based on</strong>: profit + contribution to grid stability</div>
                    </div>
                </div>
                {/* Scenario Info - Visible to All */}
                <div style={{
                    background: "#0a1929", border: "1px solid #38c0fc22", borderRadius: 12, padding: 16, marginBottom: 20,
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#8ab8d0", letterSpacing: 1, marginBottom: 4 }}>SCENARIO</div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: SCENARIOS[scenarioId]?.col || "#38c0fc" }}>
                                {SCENARIOS[scenarioId]?.emoji} {SCENARIOS[scenarioId]?.name || "Normal Day"}
                            </div>
                            <div style={{ fontSize: 9, color: "#4d7a96", marginTop: 2 }}>
                                {SCENARIOS[scenarioId]?.desc || "Standard grid conditions"}
                            </div>
                        </div>
                        {isHost && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                                <div style={{ fontSize: 8, color: "#8ab8d0" }}>NESO can change:</div>
                                <div style={{ display: "flex", gap: 4 }}>
                                    {Object.values(SCENARIOS).map(s => (
                                        <button key={s.id} onClick={() => setScenarioId(s.id)} style={{
                                            padding: "4px 8px", background: scenarioId === s.id ? `${s.col}22` : "#0c1c2a",
                                            border: `1px solid ${scenarioId === s.id ? s.col : "#38c0fc22"}`,
                                            borderRadius: 4, fontSize: 8, cursor: "pointer",
                                            color: scenarioId === s.id ? s.col : "#8ab8d0",
                                        }}>
                                            {s.emoji}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Players List - Visible to Everyone */}
                <div style={{
                    background: "#0a1929", border: "1px solid #38c0fc22", borderRadius: 12, padding: 20, marginBottom: 20,
                }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#38c0fc", marginBottom: 12 }}>
                        PLAYERS IN ROOM ({activePlayers.length})
                    </div>
                    {activePlayers.length === 0 ? (
                        <div style={{ fontSize: 11, color: "#4d7a96", textAlign: "center", padding: 16 }}>
                            Waiting for players to join...
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {activePlayers.map((p, i) => {
                                const r = ROLES[p.role] || { emoji: "⏳", name: "Unassigned" };
                                // For NESO, don't show preferred role since it's assigned
                                const preferred = p.role === "NESO" ? null : (p.preferredRole ? (ROLES[p.preferredRole] || { name: p.preferredRole, emoji: "📝" }) : null);
                                const isMe = p.id === pid;
                                const assetChoices = roleAssetOptions(p.role);
                                return (
                                    <div key={p.id || i} data-player-name={p.name} style={{
                                        background: "#0c1c2a", border: "1px solid #38c0fc22", borderRadius: 8, padding: "6px 12px",
                                        display: "flex", alignItems: "flex-start", gap: 12, justifyContent: "space-between", minWidth: 260
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{ fontSize: 14 }}>{r.emoji}</span>
                                            <div>
                                                <div style={{ fontSize: 10, fontWeight: 700, color: "#ddeeff" }}>
                                                    {p.name} {isMe ? "(You)" : ""}
                                                    {p.ready && <span style={{ marginLeft: 6, color: "#1de98b" }}>✓</span>}
                                                </div>
                                                <div style={{ fontSize: 8, color: "#4d7a96" }}>Final: {r.name}</div>
                                                <div style={{ fontSize: 8, color: "#2a86b8" }}>Preferred: {preferred ? preferred.name : "Not chosen"}</div>
                                                {p.assignedAssetKey && <div style={{ fontSize: 8, color: "#1de98b" }}>Asset: {ASSETS[p.assignedAssetKey]?.name || p.assignedAssetKey}</div>}
                                                {!p.assignedAssetKey && p.preferredAssetKey && <div style={{ fontSize: 8, color: "#f5b222" }}>Preferred asset: {ASSETS[p.preferredAssetKey]?.name || p.preferredAssetKey}</div>}
                                            </div>
                                        </div>

                                        {isHost && (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 132 }}>
                                                <select
                                                    data-testid="role-assign-select"
                                                    value={p.role || "UNASSIGNED"}
                                                    disabled={p.id === pid}
                                                    onChange={(e) => {
                                                        const newRole = e.target.value;
                                                        if (api && room) {
                                                            const isHostChange = p.id === pid;
                                                            api.putPlayer(room, p.id, {
                                                                role: newRole,
                                                                status: newRole === "UNASSIGNED" ? "JOINED" : "ASSIGNED",
                                                                assignedAssetKey: ROLE_NEEDS_ASSET(newRole) ? (p.assignedAssetKey || p.preferredAssetKey || null) : null,
                                                                ready: isHostChange ? true : false,
                                                            });
                                                        }
                                                    }}
                                                    style={{
                                                        background: "#050e16", border: "1px solid #38c0fc44", borderRadius: 4,
                                                        color: "#38c0fc", fontSize: 9, padding: "4px", outline: "none", cursor: p.id === pid ? "default" : "pointer",
                                                        fontWeight: 700, fontFamily: "'Outfit'"
                                                    }}
                                                >
                                                    <option value={p.id === pid ? "NESO" : "UNASSIGNED"}>{p.id === pid ? "System Operator" : "Unassigned"}</option>
                                                    {(p.id === pid ? [ROLES.NESO] : assignableRoleOptions).map(opt => (
                                                        <option key={opt.id} value={opt.id}>{opt.name}</option>
                                                    ))}
                                                </select>
                                                {ROLE_NEEDS_ASSET(p.role) && (() => {
                                    // Filter out assets already taken by other players
                                    const takenAssets = activePlayers
                                        .filter(other => other.id !== p.id && other.assignedAssetKey)
                                        .map(other => other.assignedAssetKey);
                                    const availableChoices = assetChoices.filter(a => !takenAssets.includes(a.key));
                                    
                                    return (
                                    <select
                                                        data-testid="asset-assign-select"
                                                        value={p.assignedAssetKey || ""}
                                                        onChange={(e) => {
                                                            if (api && room) {
                                                                const isHostChange = p.id === pid;
                                                                api.putPlayer(room, p.id, { 
                                                                    assignedAssetKey: e.target.value || null, 
                                                                    status: e.target.value ? "ASSIGNED" : "JOINED",
                                                                    ready: isHostChange ? true : false,
                                                                });
                                                            }
                                                        }}
                                                        style={{
                                                            background: "#050e16", border: "1px solid #1de98b44", borderRadius: 4,
                                                            color: "#1de98b", fontSize: 9, padding: "4px", outline: "none", cursor: "pointer",
                                                            fontWeight: 700, fontFamily: "'Outfit'"
                                                        }}
                                                    >
                                                        <option value="">Assign asset</option>
                                                        {availableChoices.map(asset => (
                                                            <option key={asset.key} value={asset.key}>{asset.name}</option>
                                                        ))}
                                                    </select>
                                    );
                                })()}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Host Controls */}
                {isHost && (
                    <div style={{
                        background: "#0a1929", border: "1px solid #b78bfa33", borderRadius: 12, padding: 20, marginBottom: 20,
                    }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#b78bfa", marginBottom: 12 }}>🎓 HOST CONTROLS</div>

                        {/* Readiness Status */}
                        <div style={{ marginBottom: 16, padding: 12, background: "#0c1c2a", borderRadius: 8, border: "1px solid #38c0fc22" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#8ab8d0", marginBottom: 8 }}>START GAME READINESS</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
                                    <span style={{ color: allRolesAssigned ? "#1de98b" : "#f5b222" }}>{allRolesAssigned ? "✓" : "○"}</span>
                                    <span style={{ color: allRolesAssigned ? "#1de98b" : "#ddeeff" }}>All players have roles assigned</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
                                    <span style={{ color: hasSupplySide ? "#1de98b" : "#f5b222" }}>{hasSupplySide ? "✓" : "⚠"}</span>
                                    <span style={{ color: hasSupplySide ? "#1de98b" : "#f5b222" }}>At least 1 Generator or BESS</span>
                                    {!hasSupplySide && <span style={{ color: "#f5b222", fontSize: 8 }}>(Recommended for supply side)</span>}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
                                    <span style={{ color: hasDemandSide ? "#1de98b" : "#f5b222" }}>{hasDemandSide ? "✓" : "⚠"}</span>
                                    <span style={{ color: hasDemandSide ? "#1de98b" : "#f5b222" }}>At least 1 Supplier or DSR</span>
                                    {!hasDemandSide && <span style={{ color: "#f5b222", fontSize: 8 }}>(Recommended for demand side)</span>}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
                                    <span style={{ color: allReady ? "#1de98b" : "#f5b222" }}>{allReady ? "✓" : "○"}</span>
                                    <span style={{ color: allReady ? "#1de98b" : "#ddeeff" }}>All players ready ({activePlayers.filter(p => p.ready).length}/{activePlayers.length})</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
                                    <span style={{ color: totalGenCapacity > 0 ? "#1de98b" : "#4d7a96" }}>{totalGenCapacity > 0 ? "✓" : "○"}</span>
                                    <span style={{ color: "#8ab8d0" }}>Player generation capacity: {totalGenCapacity}MW assigned</span>
                                </div>
                            </div>
                        </div>

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
                    </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                    <button data-testid="waitingroom-back" onClick={() => setScreen("lobby")} style={{
                        padding: "12px 28px", background: "#0c1c2a", border: "1px solid #38c0fc33", borderRadius: 8,
                        color: "#4d7a96", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Outfit'",
                    }}>
                        ← Back
                    </button>
                    <button data-testid="waitingroom-proceed" onClick={handleStart} disabled={!isHost || !canStart} style={{
                        padding: "12px 36px", background: "linear-gradient(135deg, #38c0fc22, #b78bfa22)",
                        border: "1px solid #38c0fc66", borderRadius: 8, color: !isHost || !canStart ? "#4d7a96" : "#38c0fc", fontSize: 13,
                        fontWeight: 800, cursor: !isHost || !canStart ? "not-allowed" : "pointer", fontFamily: "'Outfit'", letterSpacing: 1,
                    }}>
                        {isHost ? (canStart ? "START GAME →" : "NOT READY →") : "WAITING FOR NESO →"}
                    </button>
                </div>
            </div>
        </div>
    );
}
