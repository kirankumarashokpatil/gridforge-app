/* ─── CONNECTIVITY INDICATOR ─── */
export default function ConnectivityIndicator({ ready }) {
  const status = ready === true ? "Online" : ready === "error" ? "Error" : "Connecting";
  const col = ready === true ? "#1de98b" : ready === "error" ? "#f0455a" : "#f5b222";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: `${col}15`, border: `1px solid ${col}44`, padding: "4px 10px", borderRadius: 20 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: col, boxShadow: `0 0 10px ${col}aa` }} className={ready === true ? "" : "pulse"} />
      <span style={{ fontSize: 10, fontWeight: 800, color: col, textTransform: "uppercase", letterSpacing: 0.5 }}>{status}</span>
    </div>
  );
}
