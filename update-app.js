const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'App.jsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Replace import
content = content.replace(
  'import { useGun, useToasts } from "./hooks/useGun.js";',
  'import { useApi, useToasts } from "./hooks/useApi.js";'
);

// 2. Replace hook usage
content = content.replace(
  'const { gun, ready } = useGun();\n  const { toasts, add: addToast } = useToasts();',
  'const { api, ready, connect, subscribe } = useApi();\n  const { toasts, add: addToast } = useToasts();'
);

// 3. Replace handleJoin function
const oldHandleJoin = `const handleJoin = useCallback(async (chosenAsset, customConfig = null) => {
    if (!name.trim() || !room.trim() || !chosenAsset || !gun.current) return;
    const def = { ...ASSETS[chosenAsset], ...(customConfig || {}) };
    const id = uid(); const soc0 = initSoF(def);
    setPid(id); setAsset(chosenAsset); setAssetConfig(customConfig); setSoc(soc0);

    // Initialize physical state based on startup requirements
    const requiresStartup = def.startupTime > 0;
    setPhysicalState({
      status: requiresStartup ? "OFFLINE" : "ONLINE",
      spUntilOnline: 0,
      currentMw: 0,
      curtailSpsRemaining: def.maxCurtailDuration || 2,
      reboundSpsRemaining: 0,
      pendingReboundMwh: 0,
    });

    const assignedRole = isInstructor ? "instructor" : role;
    gun.current.get(roomKey(room, "players")).get(id).put({ name: name.trim(), asset: chosenAsset, customConfig, cash: 0, daCash: 0, soc: soc0, lastSeen: Date.now(), role: assignedRole });
    gun.current.get(roomKey(room, "meta")).put({ scenarioId });
    setScreen("game");
  }, [name, room, gun, isInstructor, scenarioId, role]);`;

const newHandleJoin = `const handleJoin = useCallback(async (chosenAsset, customConfig = null) => {
    if (!name.trim() || !room.trim() || !chosenAsset || !api) return;
    const def = { ...ASSETS[chosenAsset], ...(customConfig || {}) };
    const id = uid(); const soc0 = initSoF(def);
    setPid(id); setAsset(chosenAsset); setAssetConfig(customConfig); setSoc(soc0);

    // Initialize physical state based on startup requirements
    const requiresStartup = def.startupTime > 0;
    setPhysicalState({
      status: requiresStartup ? "OFFLINE" : "ONLINE",
      spUntilOnline: 0,
      currentMw: 0,
      curtailSpsRemaining: def.maxCurtailDuration || 2,
      reboundSpsRemaining: 0,
      pendingReboundMwh: 0,
    });

    const assignedRole = isInstructor ? "instructor" : role;
    
    // Connect to WebSocket for real-time updates
    connect(room);
    
    // Create player via API
    await api.putPlayer(room, id, {
      name: name.trim(),
      asset: chosenAsset,
      custom_config: customConfig,
      cash: 0,
      da_cash: 0,
      sof: soc0,
      role: assignedRole,
      status: 'ACTIVE'
    });
    
    // Create or update room
    await api.createRoom(room, scenarioId);
    
    setScreen("game");
  }, [name, room, api, isInstructor, scenarioId, role, connect]);`;

content = content.replace(oldHandleJoin, newHandleJoin);

// Write back
fs.writeFileSync(filePath, content);
console.log('App.jsx updated successfully');
