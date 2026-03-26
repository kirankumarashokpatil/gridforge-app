import { useState, useMemo } from "react";
import { ASSETS, ROLES, EVENTS, SCENARIOS, TICK_SPEEDS, FREQ_FAIL_DURATION } from "../../shared/constants.js";
import { ACHIEVEMENTS } from "../../engine/Achievements.js";
import { f0, f1, fpp } from "../../shared/utils.js";
import AnimatedPL from "../ui/AnimatedPL";

/* ─── LEADERBOARD TAB ─── */
function LeaderboardTab({ leaderboard, pid }) {
  if (leaderboard.length === 0) return <div style={{ padding: 16, fontSize: 9, color: "#2a5570" }}>Waiting for players...</div>;

  // Score color helper
  const sc = (v) => v >= 80 ? '#1de98b' : v >= 60 ? '#38c0fc' : v >= 40 ? '#f5b222' : v >= 20 ? '#f0855a' : '#f0455a';

  return (
    <div style={{ padding: "9px 12px" }}>
      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: 4, marginBottom: 6, padding: '0 8px' }}>
        <span style={{ fontSize: 7, color: '#2a5570', letterSpacing: .5 }}>PLAYER</span>
        <span style={{ fontSize: 7, color: '#38c0fc', letterSpacing: .5, width: 32, textAlign: 'center' }}>ROLE</span>
        <span style={{ fontSize: 7, color: '#f5b222', letterSpacing: .5, width: 32, textAlign: 'center' }}>SYS</span>
        <span style={{ fontSize: 7, color: '#1de98b', letterSpacing: .5, width: 32, textAlign: 'center' }}>ALL</span>
        <span style={{ fontSize: 7, color: '#4d7a96', letterSpacing: .5, width: 44, textAlign: 'right' }}>P&L</span>
      </div>

      {leaderboard.slice(0, 10).map((p, i) => {
        const def = ASSETS[p.asset]; const isMe = p.id === pid; const isGM = p.role === 'instructor';
        const rs = p.roleScore || 0;
        const ss = p.systemScore || 50;
        const os = p.overallScore || 0;
        const total = p.cash || 0;
        const roleDef = ROLES[p.role];
        const rank = p.rank || (i + 1);
        const rankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;

        return (
          <div key={p.id || i} style={{ marginBottom: 5, padding: '6px 8px', borderRadius: 7, background: isMe ? '#0e1e30' : '#08141f', border: `1px solid ${isMe ? def?.col || '#b78bfa' : isGM ? '#b78bfa' : '#1a3045'}22`, transition: 'all .15s' }}>
            {/* Main row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: 4, alignItems: 'center' }}>
              {/* Player info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                <span style={{ fontSize: 10, width: 16, textAlign: 'center', color: rank <= 3 ? '#f5b222' : '#2a5570', flexShrink: 0 }}>{isGM ? '🎓' : rankLabel}</span>
                <span style={{ fontSize: 13, flexShrink: 0 }}>{roleDef?.emoji || def?.emoji || '⚙'}</span>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: 9, color: isMe ? def?.col || '#b78bfa' : '#ddeeff', fontWeight: isMe ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isMe ? '▶ ' : ''}{p.name}</div>
                  <div style={{ fontSize: 7, color: '#2a5570' }}>{roleDef?.name || def?.short || '?'}</div>
                </div>
              </div>
              {/* Role Score */}
              <div style={{ width: 32, textAlign: 'center' }}>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 10, fontWeight: 800, color: sc(rs) }}>{rs}</div>
              </div>
              {/* System Score */}
              <div style={{ width: 32, textAlign: 'center' }}>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 10, fontWeight: 800, color: sc(ss) }}>{ss}</div>
              </div>
              {/* Overall Score */}
              <div style={{ width: 32, textAlign: 'center' }}>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 900, color: sc(os) }}>{os}</div>
              </div>
              {/* P&L */}
              <div style={{ width: 44, textAlign: 'right' }}>
                <AnimatedPL value={total} size={9} />
              </div>
            </div>
            {/* Score bar — shows overall score as a filled bar */}
            <div style={{ height: 2, background: '#1a3045', borderRadius: 1, marginTop: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(3, os)}%`, background: sc(os), borderRadius: 1, opacity: .6, transition: 'width 0.3s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── LOG TAB ─── */
function LogTab({ spHistory }) {
  if (spHistory.length === 0) return <div style={{ padding: 16, fontSize: 9, color: "#2a5570" }}>Waiting for first clearing...</div>;
  return (
    <div style={{ padding: "9px 12px" }}>
      {spHistory.map((h, i) => (
        <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid #0c1c2a", display: "grid", gridTemplateColumns: "26px 16px 1fr auto", gap: 4, alignItems: "center" }}>
          <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 7.5, color: "#4d7a96" }}>SP{h.sp}</span>
          <span style={{ fontSize: 9 }}>{h.event?.emoji || ""}</span>
          <div>
            <div style={{ fontSize: 9, color: h.accepted ? "#1de98b" : "#4d7a96" }}>{h.accepted ? `✓ ${f0(h.mw)}MW @ £${f0(h.cp)}` : h.cp ? `✗ CP £${f0(h.cp)}` : "✗ Not dispatched"}</div>
            <div style={{ fontSize: 7.5, color: "#2a5570" }}>{h.time} · NIV {h.niv >= 0 ? "+" : ""}{f0(h.niv)}MW</div>
          </div>
          <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 9.5, fontWeight: 700, color: !h.accepted ? "#2a5570" : h.revenue >= 0 ? "#1de98b" : "#f0455a" }}>{!h.accepted ? "—" : fpp(h.revenue)}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── STATS TAB ─── */
function StatsTab({ stats, spHistory }) {
  const { total, accepted, winRate, totalRev, avgClear, bestSP, streak } = stats;
  const StatBox = ({ label, val, sub, col }) => (<div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 7, padding: "7px 9px" }}><div style={{ fontSize: 7.5, color: "#4d7a96", marginBottom: 2 }}>{label}</div><div style={{ fontFamily: "'JetBrains Mono'", fontSize: 15, fontWeight: 900, color: col || "#ddeeff" }}>{val}</div>{sub && <div style={{ fontSize: 7.5, color: "#2a5570", marginTop: 1 }}>{sub}</div>}</div>);
  const revHistory = [...spHistory].reverse().slice(-20).map(h => h.accepted ? h.revenue : 0);
  const sparkMax = Math.max(...revHistory, 1);
  return (
    <div style={{ padding: "9px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
      {total === 0 ? <div style={{ fontSize: 9, color: "#2a5570" }}>No SPs completed yet. Start bidding!</div> : <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <StatBox label="WIN RATE" val={`${winRate}%`} sub={`${accepted}/${total} SPs`} col={+winRate > 60 ? "#1de98b" : +winRate > 30 ? "#f5b222" : "#f0455a"} />
          <StatBox label="TOTAL P&L" val={fpp(totalRev)} sub="BM session" col={totalRev >= 0 ? "#1de98b" : "#f0455a"} />
          <StatBox label="AVG CLR PRICE" val={`£${f1(avgClear)}`} sub="£/MWh" col="#f5b222" />
          <StatBox label="WIN STREAK" val={streak} sub={streak > 2 ? "🔥 on fire" : streak > 0 ? "active" : "—"} col={streak > 3 ? "#f5b222" : streak > 0 ? "#1de98b" : "#2a5570"} />
        </div>
        {bestSP && <div style={{ background: "#071f13", border: "1px solid #1de98b22", borderRadius: 7, padding: "7px 9px" }}>
          <div style={{ fontSize: 7.5, color: "#4d7a96", marginBottom: 3 }}>BEST SETTLEMENT PERIOD</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 16 }}>{bestSP.event?.emoji || "⚡"}</span><div><div style={{ fontSize: 11, fontWeight: 700, color: "#1de98b" }}>+£{f0(bestSP.revenue)}</div><div style={{ fontSize: 8, color: "#2a5570" }}>SP{bestSP.sp} · {bestSP.time} · {f0(bestSP.mw)}MW @ £{f0(bestSP.cp)}</div></div></div>
        </div>}
        {revHistory.length > 3 && <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 7, padding: "7px 9px" }}>
          <div style={{ fontSize: 7.5, color: "#4d7a96", marginBottom: 5 }}>REVENUE PER SP</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 28 }}>
            {revHistory.map((v, i) => <div key={i} style={{ flex: 1, background: v > 0 ? "#1de98b" : "#1a3045", height: `${Math.max(8, (v / sparkMax) * 100)}%`, borderRadius: 2, opacity: .8, transition: "height .3s" }} />)}
          </div>
        </div>}
      </>}
    </div>
  );
}

/* ─── INSTRUCTOR (GAME MASTER) TAB ─── */
function InstructorTab({ onTrigger, onScenarioChange, tickSpeed, paused, freqBreachSec, onTickSpeedChange, onPauseToggle, onNextPhase, gameMode, phase }) {
  const [selScenario, setSelScenario] = useState("NORMAL");
  const urgentEvents = EVENTS.filter(e => ["TRIP", "CASCADE", "SPIKE", "DUNKEL", "COLD"].includes(e.id));
  const benignEvents = EVENTS.filter(e => ["WIND_UP", "DMD_LO", "INTERCON"].includes(e.id));
  const currentSpeedId = Object.values(TICK_SPEEDS).find(s => s.ms === tickSpeed)?.id || "NORMAL";
  return (
    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ background: "#1b0d2a", border: "1px solid #b78bfa44", borderRadius: 8, padding: "8px 10px" }}>
        <div style={{ fontSize: 9, color: "#b78bfa", fontWeight: 700, marginBottom: 6 }}>🎓 GAME MASTER CONTROLS</div>
        <div style={{ fontSize: 8, color: "#4d7a96", lineHeight: 1.65 }}>Trigger market events, change scenario, control game speed, and pause for teaching moments.</div>
      </div>
      {/* MANUAL WORKSHOP PHASE ADVANCEMENT */}
      {gameMode === "WORKSHOP" && (
        <button onClick={onNextPhase} style={{ width: "100%", padding: "12px", background: "#f5b222", border: "none", borderRadius: 8, color: "#050e16", fontSize: 14, fontWeight: 900, cursor: "pointer", fontFamily: "'Outfit'", letterSpacing: 1, boxShadow: "0 0 15px #f5b22244" }}>
          ⏭ ADVANCE TO NEXT PHASE →
          <div style={{ fontSize: 9, color: "#050e1699", marginTop: 2 }}>Current: {phase}</div>
        </button>
      )}
      {/* PAUSE / RESUME */}
      <button onClick={onPauseToggle} style={{ width: "100%", padding: "10px", background: paused ? "#1a0e05" : "#071f13", border: `2px solid ${paused ? "#f5b222" : "#1de98b"}66`, borderRadius: 8, color: paused ? "#f5b222" : "#1de98b", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "'Outfit'", letterSpacing: 1, transition: "all .2s" }}>
        {paused ? "▶ RESUME GAME" : "⏸ PAUSE FOR DISCUSSION"}
      </button>
      {/* TICK SPEED */}
      <div>
        <div style={{ fontSize: 8.5, color: "#b78bfa", marginBottom: 5, textTransform: "uppercase", letterSpacing: .8 }}>⏱ Game Speed</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {Object.values(TICK_SPEEDS).map(s => (
            <button key={s.id} onClick={() => onTickSpeedChange(s.id)} style={{ padding: "6px 6px", background: currentSpeedId === s.id ? `#b78bfa22` : "#0c1c2a", border: `1px solid ${currentSpeedId === s.id ? "#b78bfa" : "#1a3045"}`, borderRadius: 5, color: currentSpeedId === s.id ? "#b78bfa" : "#4d7a96", fontSize: 8.5, cursor: "pointer", fontWeight: currentSpeedId === s.id ? 700 : 400, transition: "all .15s" }}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 7.5, color: "#4d7a96", marginTop: 4, fontStyle: "italic" }}>
          {TICK_SPEEDS[currentSpeedId]?.desc || ""}
        </div>
      </div>
      {/* FREQ BREACH STATUS */}
      {freqBreachSec > 0 && (
        <div style={{ background: "#1f0709", border: "1px solid #f0455a44", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#f0455a", marginBottom: 2 }}>⚠ FREQUENCY BREACH</div>
          <div style={{ fontSize: 8.5, color: "#f0455a88" }}>{FREQ_FAIL_DURATION - freqBreachSec}s to grid failure • Consider pausing to discuss</div>
        </div>
      )}
      {/* Scenario change */}
      <div>
        <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 5, textTransform: "uppercase", letterSpacing: .8 }}>Change Scenario</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 6 }}>
          {Object.values(SCENARIOS).map(s => (
            <button key={s.id} onClick={() => setSelScenario(s.id)} style={{ padding: "5px 6px", background: selScenario === s.id ? `${s.col}22` : "#0c1c2a", border: `1px solid ${selScenario === s.id ? s.col : "#1a3045"}`, borderRadius: 5, color: selScenario === s.id ? s.col : "#4d7a96", fontSize: 8, cursor: "pointer", fontWeight: selScenario === s.id ? 700 : 400 }}>
              {s.emoji} {s.name}
            </button>
          ))}
        </div>
        <button onClick={() => onScenarioChange(selScenario)} style={{ width: "100%", padding: "7px", background: "#1b0d2a", border: "1px solid #b78bfa44", borderRadius: 6, color: "#b78bfa", fontSize: 9, cursor: "pointer", fontWeight: 700, fontFamily: "'Outfit'" }}>🌍 APPLY SCENARIO TO ALL PLAYERS →</button>
      </div>
      {/* Urgent events */}
      <div>
        <div style={{ fontSize: 8.5, color: "#f0455a", marginBottom: 5, textTransform: "uppercase", letterSpacing: .8 }}>⚠ Shortage Events</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {urgentEvents.map(e => (
            <button key={e.id} onClick={() => onTrigger(e.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#1f0709", border: "1px solid #f0455a22", borderRadius: 5, color: "#ddeeff", fontSize: 8.5, cursor: "pointer", textAlign: "left", width: "100%" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{e.emoji}</span>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, color: e.col, fontSize: 9 }}>{e.name}</div><div style={{ fontSize: 7.5, color: "#4d7a96", marginTop: 1 }}>{e.desc}</div></div>
              <div style={{ fontSize: 7.5, color: "#f0455a", fontFamily: "'JetBrains Mono'", flexShrink: 0 }}>{e.pd > 0 ? `+£${e.pd}` : `-£${Math.abs(e.pd)}`}/MWh</div>
            </button>
          ))}
        </div>
      </div>
      {/* Benign events */}
      <div>
        <div style={{ fontSize: 8.5, color: "#1de98b", marginBottom: 5, textTransform: "uppercase", letterSpacing: .8 }}>✓ Surplus Events</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {benignEvents.map(e => (
            <button key={e.id} onClick={() => onTrigger(e.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#071f13", border: "1px solid #1de98b22", borderRadius: 5, color: "#ddeeff", fontSize: 8.5, cursor: "pointer", textAlign: "left", width: "100%" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{e.emoji}</span>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, color: e.col, fontSize: 9 }}>{e.name}</div><div style={{ fontSize: 7.5, color: "#4d7a96", marginTop: 1 }}>{e.desc}</div></div>
              <div style={{ fontSize: 7.5, color: "#1de98b", fontFamily: "'JetBrains Mono'", flexShrink: 0 }}>{e.pd >= 0 ? `+£${e.pd}` : `-£${Math.abs(e.pd)}`}/MWh</div>
            </button>
          ))}
        </div>
      </div>
      {/* Discussion prompts */}
      <div style={{ background: "#08141f", border: "1px solid #1a3045", borderRadius: 8, padding: "8px 10px" }}>
        <div style={{ fontSize: 8.5, color: "#38c0fc", fontWeight: 700, marginBottom: 7 }}>💬 Discussion Prompts</div>
        {["Why did the cheapest seller earn the same as the most expensive dispatched?", "What happens to batteries when the grid flips from SHORT to LONG?", "Why does the OCGT bid much higher than the wind farm?", "How does the Day-Ahead price differ from the Balancing price?", "What would happen if we had no gas plants during Dunkelflaute?"].map((q, i) => (
          <div key={i} style={{ fontSize: 8, color: "#4d7a96", marginBottom: 5, paddingLeft: 8, borderLeft: "2px solid #38c0fc33", lineHeight: 1.55 }}>Q{i + 1}: {q}</div>
        ))}
      </div>
    </div>
  );
}

/* ─── ACHIEVEMENTS TAB ─── */
function AchievementsTab({ earned }) {
  return (
    <div style={{ padding: "10px 12px" }}>
      <div style={{ fontSize: 9, color: "#4d7a96", marginBottom: 10, letterSpacing: 1 }}>YOUR TROPHY CABINET ({earned.length}/{ACHIEVEMENTS.length})</div>
      {ACHIEVEMENTS.map(a => {
        const isEarned = earned.some(e => e.id === a.id);
        return (
          <div key={a.id} style={{ display: "flex", gap: 10, padding: 8, background: isEarned ? "#0c1c2a" : "#050e16", border: `1px solid ${isEarned ? a.col : "#1a3045"}`, borderRadius: 8, marginBottom: 6, opacity: isEarned ? 1 : 0.4 }}>
            <div style={{ fontSize: 20 }}>{isEarned ? a.emoji : "🔒"}</div>
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: isEarned ? a.col : "#4d7a96", marginBottom: 2 }}>{a.name}</div>
              <div style={{ fontSize: 8, color: "#2a5570" }}>{a.desc}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── RIGHT PANEL ─── */
export default function RightPanel({ leaderboard, spHistory, pid, room, copyRoom, copied, isInstructor, onInstructorTrigger, onScenarioChange, tickSpeed, paused, freqBreachSec, onTickSpeedChange, onPauseToggle, onNextPhase, gameMode, phase, earnedAchievements }) {
  const [tab, setTab] = useState(isInstructor ? "instructor" : "board");
  const stats = useMemo(() => {
    const total = spHistory.length, accepted = spHistory.filter(h => h.accepted).length;
    const revenues = spHistory.filter(h => h.accepted).map(h => h.revenue);
    const totalRev = revenues.reduce((a, b) => a + b, 0);
    const avgCP = spHistory.filter(h => h.cp).map(h => h.cp);
    const avgClear = avgCP.length ? avgCP.reduce((a, b) => a + b, 0) / avgCP.length : 0;
    const bestSP = spHistory.filter(h => h.accepted).sort((a, b) => b.revenue - a.revenue)[0];
    const streak = (() => { let s = 0; for (const h of spHistory) { if (h.accepted) s++; else break; } return s; })();
    return { total, accepted, winRate: total ? (accepted / total * 100).toFixed(0) : 0, totalRev, avgClear, bestSP, streak };
  }, [spHistory]);
  const tabs = [{ id: "board", label: "🏆 Board" }, { id: "log", label: "📋 Log" }, { id: "stats", label: "📊 Stats" }, { id: "achievements", label: "🎖️ Badges" }, ...(isInstructor ? [{ id: "instructor", label: "🎓 GM" }] : [])];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "7px 12px", borderBottom: "1px solid #1a3045", background: "#08141f", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div><div style={{ fontSize: 7, color: "#4d7a96", letterSpacing: 1.2, marginBottom: 2 }}>ROOM CODE</div><div style={{ fontFamily: "'JetBrains Mono'", fontSize: 17, fontWeight: 900, color: "#f5b222", letterSpacing: 4 }}>{room}</div></div>
          <button onClick={copyRoom} style={{ padding: "5px 9px", background: "#102332", border: "1px solid #234159", borderRadius: 6, color: copied ? "#1de98b" : "#4d7a96", fontSize: 8.5, cursor: "pointer", fontWeight: 700, transition: "all .2s" }}>{copied ? "✓ Copied" : "⎘ Copy"}</button>
        </div>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid #1a3045", flexShrink: 0 }}>
        {tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: "6px 4px", background: tab === t.id ? "#0e1e30" : "transparent", border: "none", borderBottom: tab === t.id ? "2px solid #38c0fc" : "2px solid transparent", color: tab === t.id ? "#ddeeff" : "#2a5570", fontSize: 8.5, cursor: "pointer", fontWeight: tab === t.id ? 700 : 400, transition: "all .15s", fontFamily: "'Outfit'" }}>{t.label}</button>)}
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "board" && <LeaderboardTab leaderboard={leaderboard} pid={pid} />}
        {tab === "log" && <LogTab spHistory={spHistory} />}
        {tab === "stats" && <StatsTab stats={stats} spHistory={spHistory} />}
        {tab === "achievements" && <AchievementsTab earned={earnedAchievements} />}
        {tab === "instructor" && isInstructor && <InstructorTab onTrigger={onInstructorTrigger} onScenarioChange={onScenarioChange} tickSpeed={tickSpeed} paused={paused} freqBreachSec={freqBreachSec} onTickSpeedChange={onTickSpeedChange} onPauseToggle={onPauseToggle} onNextPhase={onNextPhase} gameMode={gameMode} phase={phase} />}
      </div>
      <div style={{ padding: "7px 12px", borderTop: "1px solid #1a3045", flexShrink: 0 }}>
        <div style={{ fontSize: 8.5, color: "#4d7a96", marginBottom: 4, textTransform: "uppercase", letterSpacing: .8 }}>📖 Key Terms</div>
        {[["NIV", "Net Imbalance Volume — MW the ESO must buy (SHORT) or sell (LONG)"], ["SELLER", "Submits OFFERS to generate or discharge energy when SHORT"], ["BUYER", "Submits BIDS to absorb energy when LONG (e.g. charging battery)"], ["Merit Order", "Cheapest offers dispatched first — last one sets clearing price for ALL"], ["Uniform Price", "All accepted bids earn/pay the same clearing price"], ["DA", "Day-Ahead — forward auction, lock in revenue for next 6 SPs"]].map(([k, v]) => (
          <div key={k} style={{ fontSize: 7.5, color: "#2a5570", marginBottom: 2.5, lineHeight: 1.5 }}><strong style={{ color: "#4d7a96" }}>{k}:</strong> {v}</div>
        ))}
      </div>
    </div>
  );
}
