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

const WINDOW_NAME_PREFIX = "gridforge_playerId:";

const getWindowNamePlayerId = () => {
    if (typeof window === "undefined") return null;
    return window.name.startsWith(WINDOW_NAME_PREFIX)
        ? window.name.slice(WINDOW_NAME_PREFIX.length)
        : null;
};

const setWindowNamePlayerId = (playerId) => {
    if (typeof window === "undefined") return;
    window.name = `${WINDOW_NAME_PREFIX}${playerId}`;
};

const getPlayerIdentityContext = () => {
    if (typeof window === "undefined") {
        return {
            key: "gridforge_playerId:default",
            storage: null,
            mode: "storage",
        };
    }

    const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

    // Local development: each browser tab/window is a different player automatically.
    // Refresh in the same tab keeps the same player via window.name.
    if (isLocalhost) {
        return {
            key: null,
            storage: null,
            mode: "window-name",
        };
    }

    return {
        key: "gridforge_playerId:default",
        storage: window.localStorage,
        mode: "storage",
    };
};

export const getOrCreatePlayerId = () => {
    const { key, storage, mode } = getPlayerIdentityContext();

    if (mode === "window-name") {
        const existingId = getWindowNamePlayerId();

        // Reuse the id already stored in window.name for this tab session.
        // window.name persists across same-tab navigations but is blank in a new tab/window,
        // so this correctly gives every tab a unique, stable identity.
        if (existingId) {
            return existingId;
        }

        const playerId = uid();
        setWindowNamePlayerId(playerId);
        return playerId;
    }

    const safeStorage = storage || localStorage;
    let playerId = safeStorage.getItem(key);
    if (!playerId) {
        playerId = uid();
        safeStorage.setItem(key, playerId);
    }
    return playerId;
};

export const setPlayerId = (playerId) => {
    const { key, storage, mode } = getPlayerIdentityContext();

    if (mode === "window-name") {
        setWindowNamePlayerId(playerId);
        return;
    }

    const safeStorage = storage || localStorage;
    safeStorage.setItem(key, playerId);
};

export const clearPlayerId = () => {
    const { key, storage, mode } = getPlayerIdentityContext();

    if (mode === "window-name") {
        if (typeof window !== "undefined") window.name = "";
        return;
    }

    const safeStorage = storage || localStorage;
    safeStorage.removeItem(key);
};

/**
 * Normalize a player object from server/DB into a consistent shape.
 * Handles field-name mismatches: player_id↔id, asset↔assignedAssetKey,
 * last_seen↔lastSeen, created_at↔createdAt.
 *
 * @param {Object} p    - Raw player object (may use snake_case or camelCase)
 * @param {Object} prev - Previous player state to merge with (optional)
 * @returns {Object} Normalized player object
 */
export const normalizePlayer = (p, prev) => {
    const id = p.id || p.player_id;
    const normalized = {
        ...prev,
        ...p,
        id,
        lastSeen: p.lastSeen || p.last_seen || 0,
        assignedAssetKey: p.assignedAssetKey || p.asset || null,
        createdAt: p.createdAt || p.created_at || prev?.createdAt || prev?.created_at || null,
    };
    if (prev) {
        if (!normalized.preferredRole && prev.preferredRole) normalized.preferredRole = prev.preferredRole;
        if (!normalized.preferredAssetKey && prev.preferredAssetKey) normalized.preferredAssetKey = prev.preferredAssetKey;
    }
    return normalized;
};
