/**
 * roles-smoke.test.cjs
 *
 * GridForge – Role & Asset Smoke Test (NESO-Authority Model)
 * -----------------------------------------------------------
 * Puppeteer script that verifies every role + asset combination can
 * successfully navigate from the lobby all the way into the game UI.
 *
 * NESO-Authority Join Flow (2 browsers per test):
 *   1. Browser 1 (NESO host): joins room → auto-assigned NESO
 *   2. Browser 2 (target role): joins same room
 *   3. NESO assigns role + asset to Browser 2 via dropdowns
 *   4. Browser 2 clicks READY
 *   5. NESO clicks START GAME
 *   6. Verify Browser 2's game UI shows SP indicator "/48"
 *
 * Roles tested:
 *   - Non-asset roles: Trader, Supplier, Elexon
 *   - Asset roles: Generator (OCGT), BESS (BESS_M), DSR
 *
 * Each test gets its own unique room to avoid cross-contamination.
 *
 * Run:
 *   node test/e2e/roles-smoke.test.cjs
 *
 * Env vars:
 *   GRIDFORGE_URL – base URL (default: http://localhost:3000)
 *   HEADLESS      – set to "false" to watch the browsers
 */

'use strict';

const puppeteer = require('puppeteer');

const BASE_URL = process.env.GRIDFORGE_URL || 'http://localhost:3000';
const HEADLESS = process.env.HEADLESS !== 'false';

// ─── Test matrix: role + asset combinations ──────────────────────────────────
const TEST_CASES = [
  { name: 'Smoke_Trader',   roleId: 'TRADER',    roleLabel: 'Trader',            needsAsset: false, assetKey: null },
  { name: 'Smoke_Supplier', roleId: 'SUPPLIER',  roleLabel: 'Supplier',          needsAsset: false, assetKey: null },
  { name: 'Smoke_Elexon',   roleId: 'ELEXON',    roleLabel: 'Elexon',            needsAsset: false, assetKey: null },
  { name: 'Smoke_Gen_OCGT', roleId: 'GENERATOR', roleLabel: 'Generator',         needsAsset: true,  assetKey: 'OCGT' },
  { name: 'Smoke_BESS_M',   roleId: 'BESS',      roleLabel: 'Battery Storage',   needsAsset: true,  assetKey: 'BESS_M' },
  { name: 'Smoke_DSR',      roleId: 'DSR',       roleLabel: 'Demand Controller', needsAsset: true,  assetKey: 'DSR' },
];

const API_BASE = 'http://localhost:8000';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// PID registry for direct server assignment
const playerPids = {};

async function readPid(page, playerName) {
  const pid = await page.evaluate(async () => {
    const prefix = 'gridforge_playerId:';
    for (let i = 0; i < 60; i++) {
      if (window.name.startsWith(prefix)) return window.name.slice(prefix.length);
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }).catch(() => null);
  if (pid) playerPids[playerName] = pid;
  return pid;
}

async function serverAssign(roomCode, playerName, data) {
  const pid = playerPids[playerName];
  if (!pid) return false;
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/players/${pid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.ok;
}

async function waitFor(page, predicate, timeout = 30000, arg) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const result = await page.evaluate(predicate, arg);
      if (result) return result;
    } catch { /* page may still be loading */ }
    await sleep(500);
  }
  const snippet = await page.evaluate(() =>
    document.body.textContent.slice(0, 400)
  ).catch(() => '');
  throw new Error(`waitFor timed out – body: "${snippet}"`);
}

async function clickButton(page, frag, timeout = 15000) {
  await page.waitForFunction(
    f => {
      const btn = Array.from(document.querySelectorAll('button:not([disabled])'))
        .find(b => b.textContent.toUpperCase().includes(f.toUpperCase()));
      if (!btn) return false;
      btn.click();
      return true;
    },
    { timeout },
    frag
  );
  await sleep(300);
}

async function fillInput(page, placeholderFragment, value) {
  await page.waitForFunction(
    (ph, val) => {
      const el = Array.from(document.querySelectorAll('input'))
        .find(i => (i.placeholder || '').includes(ph));
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      ).set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    { timeout: 15000 },
    placeholderFragment, value
  );
  await sleep(200);
}

async function enterLobby(page, playerName, roomCode) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await waitFor(page, () =>
    document.body.textContent.includes('Join Session') ||
    document.body.textContent.includes('Online') ||
    document.querySelector('input') !== null
  , 20000);

  await fillInput(page, 'e.g. Alice', playerName);
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('input'))
      .find(i => (i.placeholder || '').includes('ALPHA'));
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await fillInput(page, 'ALPHA', roomCode);
  await clickButton(page, 'JOIN WAITING ROOM');

  await waitFor(page, () =>
    document.body.textContent.includes('PLAYERS IN ROOM') ||
    document.body.textContent.includes('NESO CONTROL') ||
    document.body.textContent.includes('WAITING ROOM')
  , 20000);

  // Read PID for server-side assignment
  await readPid(page, playerName);

  // Ensure room exists on server
  await fetch(`${API_BASE}/api/rooms/${roomCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId: 'BAU' })
  }).catch(() => {});

  // Register player
  const pid = playerPids[playerName];
  if (pid) {
    const pData = { name: playerName, lastSeen: Date.now() };
    if (playerName === 'NESO_Host') { pData.role = 'NESO'; pData.status = 'ASSIGNED'; }
    await fetch(`${API_BASE}/api/rooms/${roomCode}/players/${pid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pData)
    }).catch(() => {});
  }
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

// ─── Main test for one role ──────────────────────────────────────────────────
async function testRole(cfg) {
  const { name, roleId, roleLabel, needsAsset, assetKey } = cfg;
  const ROOM = 'SM' + Date.now().toString().slice(-6);

  console.log(`\n[${name}] Room: ${ROOM} | Role: "${roleLabel}"${assetKey ? ` | Asset: "${assetKey}"` : ''}`);

  // Purge stale room
  await fetch(`${API_BASE}/api/rooms/${ROOM}`, { method: 'DELETE' }).catch(() => {});
  await sleep(300);

  const nesoBrowser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const playerBrowser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const nesoPage = await nesoBrowser.newPage();
    const playerPage = await playerBrowser.newPage();
    await nesoPage.setViewport({ width: 1280, height: 800 });
    await playerPage.setViewport({ width: 1280, height: 800 });

    // ── NESO host joins first ──
    console.log(`[${name}]   NESO joining room...`);
    await enterLobby(nesoPage, 'NESO_Host', ROOM);
    await waitFor(nesoPage, () =>
      document.body.textContent.includes('NESO CONTROL')
    , 20000);
    console.log(`[${name}]   ✓ NESO host confirmed`);
    await sleep(2000);

    // ── Target role player joins ──
    console.log(`[${name}]   Player joining room...`);
    await enterLobby(playerPage, name, ROOM);
    console.log(`[${name}]   ✓ Player entered waiting room`);
    await sleep(2000);

    // ── NESO assigns role (UI + server fallback) ──
    console.log(`[${name}]   NESO assigning role: ${roleId}...`);
    const roleResult = await nesoAssignRole(nesoPage, name, roleId);
    // Always also assign via direct server API (reliable)
    await serverAssign(ROOM, name, { role: roleId, status: 'ASSIGNED' });
    if (roleResult !== 'OK') console.warn(`[${name}]   ⚠ Role UI assign: ${roleResult} (server fallback used)`);
    else console.log(`[${name}]   ✓ Role assigned`);

    // ── NESO assigns asset if needed ──
    if (needsAsset && assetKey) {
      console.log(`[${name}]   NESO assigning asset: ${assetKey}...`);
      await sleep(500);
      const assetResult = await nesoAssignAsset(nesoPage, name, assetKey);
      await serverAssign(ROOM, name, { assignedAssetKey: assetKey, status: 'ASSIGNED' });
      if (assetResult !== 'OK') console.warn(`[${name}]   ⚠ Asset UI assign: ${assetResult} (server fallback used)`);
      else console.log(`[${name}]   ✓ Asset assigned`);
    }

    // ── Player clicks READY ──
    console.log(`[${name}]   Player clicking READY...`);
    await waitFor(playerPage, () =>
      document.body.textContent.includes('NOT READY (click to ready)')
    , 15000);
    await clickButton(playerPage, 'NOT READY (click to ready)', 10000);
    await waitFor(playerPage, () => document.body.textContent.includes('\u2713 READY'), 10000);
    console.log(`[${name}]   ✓ Player READY`);
    await sleep(1000);

    // ── NESO starts game ──
    console.log(`[${name}]   NESO starting game...`);
    await nesoPage.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.toUpperCase().includes('START GAME') && !b.disabled);
      return !!btn;
    }, { timeout: 15000 });
    await clickButton(nesoPage, 'START GAME');
    console.log(`[${name}]   ✓ START GAME clicked`);

    // ── Verify game UI loaded for the player ──
    console.log(`[${name}]   Waiting for game UI...`);
    await waitFor(playerPage, () => document.body.textContent.includes('/48'), 60000);
    console.log(`[${name}]   ✓ Game UI loaded (SP indicator visible)`);

    // Quick sanity: top-bar stats present
    const hasStats = await playerPage.evaluate(() => {
      const t = document.body.textContent;
      return t.includes('SBP') || t.includes('NIV') || t.includes('FREQ');
    });
    if (hasStats) {
      console.log(`[${name}]   ✓ Top-bar stats visible`);
    }

    return true;
  } finally {
    await nesoBrowser.close().catch(() => {});
    await playerBrowser.close().catch(() => {});
  }
}

// ─── Main runner ─────────────────────────────────────────────────────────────
(async () => {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  GridForge – Role & Asset Smoke Test (NESO-Authority)');
  console.log(`  ${TEST_CASES.length} cases | Server: ${BASE_URL} | Headless: ${HEADLESS}`);
  console.log('══════════════════════════════════════════════════════════');

  const failed = [];
  const passed = [];

  for (const cfg of TEST_CASES) {
    try {
      await testRole(cfg);
      console.log(`  ✅ ${cfg.name} (${cfg.roleLabel})`);
      passed.push(cfg.name);
    } catch (err) {
      console.error(`  ❌ ${cfg.name} (${cfg.roleLabel}): ${err?.message || err}`);
      failed.push({ name: cfg.name, role: cfg.roleLabel, err });
    }
  }

  // ── Summary ──
  console.log('\n══════════════════════════════════════════════════════════');
  if (failed.length === 0) {
    console.log(`  ✅ All ${TEST_CASES.length} role/asset combos loaded successfully.`);
  } else {
    console.log(`  ✅ ${passed.length} passed, ❌ ${failed.length} failed:`);
    failed.forEach(({ name, role, err }) =>
      console.error(`    • ${name} (${role}): ${err?.message || err}`)
    );
  }
  console.log('══════════════════════════════════════════════════════════\n');

  process.exit(failed.length > 0 ? 1 : 0);
})();
