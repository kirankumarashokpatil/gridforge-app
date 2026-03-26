/**
 * roles-functional.test.cjs
 *
 * Gridforge – Role Functional UI Test (NESO-Authority Model)
 * -----------------------------------------------------------
 * For each specialised role:
 *  - NESO host + target role player join room (2 browsers)
 *  - NESO assigns role + asset, player readies, game starts
 *  - Verifies core, role-specific UI elements are visible:
 *      • Elexon: "Imbalance Calculation Engine"
 *      • Trader: "TRADING DESK ANALYSIS"
 *      • DSR: "Live Operational State"
 *      • BESS: "STATE OF CHARGE (SoC)"
 *
 * Run with:
 *   node test/e2e/roles-functional.test.cjs
 *
 * Env vars:
 *   GRIDFORGE_URL – base URL (default: http://localhost:3000)
 *   HEADLESS      – set to "false" to watch the browsers
 */

'use strict';

const puppeteer = require('puppeteer');

const BASE_URL = process.env.GRIDFORGE_URL || 'http://localhost:3000';
const HEADLESS = process.env.HEADLESS !== 'false';

const ROLES = [
  {
    id: 'ELEXON',
    name: 'Elexon',
    roleLabel: 'Elexon',
    needsAsset: false,
    assetKey: null,
    uiSnippet: 'Imbalance Calculation Engine'
  },
  {
    id: 'TRADER',
    name: 'TraderJoe',
    roleLabel: 'Trader',
    needsAsset: false,
    assetKey: null,
    uiSnippet: 'TRADING DESK ANALYSIS'
  },
  {
    id: 'DSR',
    name: 'FlexLoad',
    roleLabel: 'Demand Controller',
    needsAsset: true,
    assetKey: 'DSR',
    uiSnippet: 'Live Operational State'
  },
  {
    id: 'BESS',
    name: 'BatteryOp',
    roleLabel: 'Battery Storage',
    needsAsset: true,
    assetKey: 'BESS_M',
    uiSnippet: 'STATE OF CHARGE (SoC)',
    extraCheck: 'SYS DMD'
  }
];

const API_BASE = 'http://localhost:8000';
const playerPids = {};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function serverAssign(roomCode, playerName, data) {
  const pid = playerPids[playerName];
  if (!pid) { console.error(`  [${playerName}] No stored PID for server assign!`); return false; }
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/players/${pid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) console.error(`  [${playerName}] serverAssign FAILED: ${res.status}`);
  return res.ok;
}

async function waitFor(page, predicate, timeout = 30000, arg) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const result = await page.evaluate(predicate, arg);
      if (result) return result;
    } catch { /* ignore transient */ }
    await sleep(500);
  }
  const snippet = await page.evaluate(() => document.body.textContent.slice(0, 300)).catch(() => '');
  throw new Error(`waitFor timed out – body snippet: "${snippet}"`);
}

async function clickButton(page, textFragment, timeout = 20000) {
  await page.waitForFunction(
    t => {
      const btn = Array.from(document.querySelectorAll('button:not([disabled])'))
        .find(b => b.textContent.toUpperCase().includes(t.toUpperCase()));
      if (!btn) return false;
      btn.click();
      return true;
    },
    { timeout },
    textFragment
  );
  await sleep(200);
}

async function fillInput(page, placeholder, value) {
  await page.waitForFunction(
    (ph, val) => {
      const el = Array.from(document.querySelectorAll('input'))
        .find(i => (i.placeholder || '').includes(ph));
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    { timeout: 15000 },
    placeholder, value
  );
  await sleep(200);
}

async function enterLobby(page, playerName, roomCode) {
  const base = BASE_URL.replace(/\/$/, '');
  const url = `${base}/?playerName=${encodeURIComponent(playerName)}&roomCode=${encodeURIComponent(roomCode)}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  await waitFor(page, () =>
    document.body.textContent.includes('Join Session') ||
    document.body.textContent.includes('Online') ||
    document.querySelector('input') !== null
  , 20000);

  // Verify the inputs are pre-filled from URL params
  await waitFor(page, () => {
    const nameInput = Array.from(document.querySelectorAll('input'))
      .find(i => i.placeholder?.toUpperCase().includes('E.G. ALICE'));
    const roomInput = Array.from(document.querySelectorAll('input'))
      .find(i => i.placeholder?.toUpperCase().includes('E.G. ALPHA'));
    return nameInput && nameInput.value.length > 0 && roomInput && roomInput.value.length > 0;
  }, 10000);

  await clickButton(page, 'JOIN WAITING ROOM');
  await waitFor(page, () =>
    document.body.textContent.includes('PLAYERS IN ROOM') ||
    document.body.textContent.includes('NESO CONTROL') ||
    document.body.textContent.includes('WAITING ROOM')
  , 20000);

  // Read PID from window.name (set by React app)
  const registeredPid = await page.evaluate(async (apiBase, roomCode, pName, isNesoHost) => {
    const prefix = 'gridforge_playerId:';
    for (let i = 0; i < 60; i++) {
      if (window.name.startsWith(prefix)) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const pid = window.name.startsWith(prefix) ? window.name.slice(prefix.length) : null;
    if (!pid) return null;
    await fetch(`${apiBase}/api/rooms/${roomCode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'BAU' })
    }).catch(() => {});
    const playerData = { name: pName, lastSeen: Date.now() };
    if (isNesoHost) { playerData.role = 'NESO'; playerData.status = 'ASSIGNED'; }
    await fetch(`${apiBase}/api/rooms/${roomCode}/players/${pid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(playerData)
    });
    return pid;
  }, API_BASE, roomCode, playerName, playerName === 'NESO_Host');
  if (registeredPid) playerPids[playerName] = registeredPid;
}

async function nesoAssignRole(nesoPage, playerName, roleId) {
  await nesoPage.waitForFunction((pName) => {
    const card = document.querySelector(`[data-player-name="${pName}"]`);
    return card && card.querySelector('[data-testid="role-assign-select"]') !== null;
  }, { timeout: 15000 }, playerName).catch(() => {});

  const ok = await nesoPage.evaluate((pName, rId) => {
    const card = document.querySelector(`[data-player-name="${pName}"]`);
    if (!card) return `NO_CARD:${pName}`;
    const sel = card.querySelector('[data-testid="role-assign-select"]');
    if (!sel) return 'NO_SELECT';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, rId);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'OK';
  }, playerName, roleId);
  await sleep(600);
  return ok;
}

async function nesoAssignAsset(nesoPage, playerName, assetKey) {
  await nesoPage.waitForFunction(pName => {
    const card = document.querySelector(`[data-player-name="${pName}"]`);
    return card && card.querySelector('[data-testid="asset-assign-select"]') !== null;
  }, { timeout: 10000 }, playerName).catch(() => {});

  const ok = await nesoPage.evaluate((pName, aKey) => {
    const card = document.querySelector(`[data-player-name="${pName}"]`);
    if (!card) return `NO_CARD:${pName}`;
    const sel = card.querySelector('[data-testid="asset-assign-select"]');
    if (!sel) return 'NO_ASSET_SELECT';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, aKey);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'OK';
  }, playerName, assetKey);
  await sleep(600);
  return ok;
}

async function joinSingleRole(roleCfg) {
  const ROOM_CODE = 'FUNC' + Date.now().toString().slice(-6);
  const { name, id: roleId, roleLabel, needsAsset, assetKey, uiSnippet, extraCheck } = roleCfg;

  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`  Role Functional Test – ${roleLabel}  (Room ${ROOM_CODE})`);
  console.log(`══════════════════════════════════════════════════════════`);

  const nesoBrowser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const playerBrowser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // Purge stale room data
  await fetch(`${API_BASE}/api/rooms/${ROOM_CODE}`, { method: 'DELETE' }).catch(() => {});
  await sleep(300);

  try {
    const nesoPage = await nesoBrowser.newPage();
    const playerPage = await playerBrowser.newPage();
    await nesoPage.setViewport({ width: 1280, height: 800 });
    await playerPage.setViewport({ width: 1280, height: 800 });

    // Capture browser console output for debugging
    nesoPage.on('console', msg => {
      const text = msg.text();
      if (text.includes('[game_init]') || text.includes('[WaitingRoom]') || text.includes('error') || text.includes('Error') || text.includes('RUNNING'))
        console.log(`  [NESO-console] ${text}`);
    });
    playerPage.on('console', msg => {
      const text = msg.text();
      if (text.includes('[game_init]') || text.includes('[WaitingRoom]') || text.includes('error') || text.includes('Error') || text.includes('RUNNING'))
        console.log(`  [Player-console] ${text}`);
    });

    // ── NESO host joins first ──
    console.log(`[${name}] NESO joining room…`);
    await enterLobby(nesoPage, 'NESO_Host', ROOM_CODE);
    await waitFor(nesoPage, () => document.body.textContent.includes('NESO CONTROL'), 20000);
    console.log(`[${name}] ✓ NESO host confirmed`);
    await sleep(2000);

    // ── Target role player joins ──
    console.log(`[${name}] Player joining room…`);
    await enterLobby(playerPage, name, ROOM_CODE);
    console.log(`[${name}] ✓ Player in waiting room`);
    await sleep(2000);

    // ── NESO assigns role + asset via server API (authoritative) ──
    console.log(`[${name}] NESO assigning role: ${roleId}…`);
    const roleResult = await nesoAssignRole(nesoPage, name, roleId);
    if (roleResult !== 'OK') console.warn(`[${name}] UI role assign: ${roleResult}`);
    await serverAssign(ROOM_CODE, name, { role: roleId, status: 'ASSIGNED' });

    if (needsAsset && assetKey) {
      await sleep(500);
      const assetResult = await nesoAssignAsset(nesoPage, name, assetKey);
      if (assetResult !== 'OK') console.warn(`[${name}] UI asset assign: ${assetResult}`);
      await serverAssign(ROOM_CODE, name, { assignedAssetKey: assetKey, status: 'ASSIGNED' });
    }

    // ── Player readies ──
    console.log(`[${name}] Player clicking READY…`);
    await waitFor(playerPage, () => document.body.textContent.includes('NOT READY (click to ready)'), 15000);
    await clickButton(playerPage, 'NOT READY (click to ready)', 10000);
    await waitFor(playerPage, () => document.body.textContent.includes('\u2713 READY'), 10000);
    await sleep(1000);

    // ── NESO starts game ──
    console.log(`[${name}] NESO starting game…`);
    await nesoPage.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.toUpperCase().includes('START GAME') && !b.disabled);
      return !!btn;
    }, { timeout: 15000 });
    await clickButton(nesoPage, 'START GAME');

    // Debug: Check what NESO page shows after starting
    await sleep(3000);
    const nesoBody = await nesoPage.evaluate(() => document.body.textContent.slice(0, 200)).catch(() => '');
    const playerBody = await playerPage.evaluate(() => document.body.textContent.slice(0, 200)).catch(() => '');
    console.log(`[${name}] After START: NESO body="${nesoBody}"`);
    console.log(`[${name}] After START: Player body="${playerBody}"`);

    // ── Verify game UI loaded ──
    console.log(`[${name}] Waiting for main game UI (SP indicator)…`);
    await waitFor(playerPage, () => document.body.textContent.includes('/48'), 30000);
    console.log(`[${name}] ✓ Game UI loaded`);

    // Give the role UI a moment to render its inner panels
    await sleep(2000);

    // ── Verify role-specific UI snippet ──
    console.log(`[${name}] Verifying role-specific UI snippet: "${uiSnippet}"…`);
    await waitFor(playerPage, (snippet) => document.body.textContent.includes(snippet), 15000, uiSnippet);
    console.log(`[${name}] ✓ Found role UI text: "${uiSnippet}"`);

    if (extraCheck) {
      console.log(`[${name}] Verifying additional snippet "${extraCheck}"…`);
      await waitFor(playerPage, (snippet) => document.body.textContent.includes(snippet), 15000, extraCheck);
      console.log(`[${name}] ✓ Extra UI text present`);
    }
  } finally {
    await nesoBrowser.close().catch(() => {});
    await playerBrowser.close().catch(() => {});
  }
}

(async () => {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  GRIDFORGE – Roles Functional UI Test (NESO-Authority)');
  console.log(`  Server: ${BASE_URL} (HEADLESS=${HEADLESS ? 'true' : 'false'})`);
  console.log('══════════════════════════════════════════════════════════\n');

  const failed = [];
  const passed = [];

  for (const cfg of ROLES) {
    try {
      await joinSingleRole(cfg);
      console.log(`  ✅ ${cfg.name} (${cfg.roleLabel})`);
      passed.push(cfg.name);
    } catch (err) {
      console.error(`  ❌ ${cfg.name} (${cfg.roleLabel}): ${err?.message || err}`);
      failed.push({ name: cfg.name, role: cfg.roleLabel, err });
    }
  }

  console.log('\n══════════════════════════════════════════════════════════');
  if (failed.length === 0) {
    console.log(`  ✅ All ${ROLES.length} roles rendered their core UI panels successfully.`);
  } else {
    console.log(`  ✅ ${passed.length} passed, ❌ ${failed.length} failed:`);
    failed.forEach(({ name, role, err }) =>
      console.error(`    • ${name} (${role}): ${err?.message || err}`)
    );
  }
  console.log('══════════════════════════════════════════════════════════\n');

  process.exit(failed.length > 0 ? 1 : 0);
})();
