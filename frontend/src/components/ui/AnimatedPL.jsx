import { useState, useEffect, useRef } from "react";
import { fpp } from "../../shared/utils.js";

/* ─── ANIMATED P&L ─── */
export default function AnimatedPL({ value, size = 15 }) {
  const [bump, setBump] = useState(false); const prevRef = useRef(value);
  useEffect(() => { if (value !== prevRef.current) { setBump(true); setTimeout(() => setBump(false), 400); prevRef.current = value; } }, [value]);
  return <span className={bump ? "pl-bump" : ""} style={{ fontFamily: "'JetBrains Mono'", fontSize: size, fontWeight: 900, color: value >= 0 ? "#1de98b" : "#f0455a", display: "inline-block" }}>{fpp(value)}</span>;
}
