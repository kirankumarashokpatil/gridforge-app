export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const f0 = n => Math.round(+n).toString();
export const f1 = n => (+n).toFixed(1);
export const fpp = n => (n >= 0 ? "+" : "-") + "£" + Math.abs(+n).toFixed(0);
export const spTime = sp => {
    const h = Math.floor(((sp - 1) * 30) / 60) % 24;
    const m = ((sp - 1) * 30) % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
export const uid = () => {
    // Generate unique UID per tab instance
    const tabId = "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9) + "_" + Math.random().toString(36).slice(2, 6);
    return tabId;
};
export const roomKey = (room, suffix) => `gf_v4_${room.toUpperCase()}_${suffix}`;
