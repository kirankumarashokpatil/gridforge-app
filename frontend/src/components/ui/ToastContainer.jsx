/* ─── TOAST CONTAINER ─── */
export default function ToastContainer({ toasts }) {
  return (
    <div style={{ position: "fixed", top: 52, right: 12, zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id} className={t.exiting ? "toast-exit" : "toast-enter"}
          style={{ background: "#0e1e30", border: `1px solid ${t.col}55`, borderRadius: 8, padding: "8px 12px", minWidth: 220, maxWidth: 300, boxShadow: "0 4px 24px #00000066" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 16 }}>{t.emoji}</span>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: t.col }}>{t.title}</div>
              <div style={{ fontSize: 8.5, color: "#4d7a96", lineHeight: 1.5, marginTop: 1 }}>{t.body}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
