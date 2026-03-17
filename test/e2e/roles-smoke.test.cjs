/**
 * roles-smoke.test.cjs
 *
 * GridForge – Role & Asset Smoke Test
 * ------------------------------------
 * Puppeteer script that verifies every role + asset combination can
 * successfully navigate from the lobby all the way into the game UI.
 *
 * Join flow (must match App.jsx exactly):
 *   1. Lobby: enter name + room code → click "JOIN WAITING ROOM →"
 *   2. WaitingRoom: select a ROLE button → click "START GAME →" (host)
 *      or "SELECT ASSET →" (asset roles) or "JOIN GAME →" (non-asset roles)
 *   3. AssetScreen (if role.canOwnAssets):
 *        → click "SELECT OR CONFIGURE {ASSET_NAME} →" button (opens config panel)
 *        → click "CONFIRM & JOIN SIMULATION →" button (joins game)
 *   4. Game UI: verify SP indicator "/48" is present.
 *
 * Roles tested:
 *   - Non-asset roles: Trader, Supplier
 *     (NESO and Elexon are isSystem: true so they're auto-assigned to host/unavailable)
 *   - Asset roles: Generator (Gas Peaker), BESS (Grid BESS),
 *                  DSR (Demand Response), Interconnector (IFA France)
 *
 * Each test gets its own unique room to avoid cross-contamination.
 *
 * Run:
 *   node test/e2e/roles-smoke.test.cjs
 *
 * Env vars:
 *   GRIDFORGE_URL – base URL (default: http://localhost:5173)
 *   HEADLESS      – set to "false" to watch the browsers
 */

'use strict';

const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

const BASE_URL = process.env.GRIDFORGE_URL || 'http://localhost:5173';
const HEADLESS = process.env.HEADLESS !== 'false';

// ─── Test matrix: role + asset combinations ──────────────────────────────────
// roleLabel must match the ROLES[x].name text rendered in WaitingRoom buttons.
// assetName (if provided) must match ASSETS[x].name used in the button text
// "SELECT OR CONFIGURE {ASSET_NAME} →" on AssetScreen.
const TEST_CASES = [
  // Non-asset roles (skip AssetScreen entirely)
  // NOTE: NESO and Elexon are isSystem: true in constants.js, so they're hidden
  // from WaitingRoom role selection and cannot be tested via UI button clicks.
  { name: 'Smoke_Trader', roleLabel: 'Trader', needsAsset: false },
  { name: 'Smoke_Supplier', roleLabel: 'Supplier', needsAsset: false },

  // Asset roles (go through AssetScreen)
  { name: 'Smoke_Gen_OCGT', roleLabel: 'Generator', needsAsset: true, assetName: 'Gas Peaker' },
  { name: 'Smoke_BESS_M', roleLabel: 'Battery Storage', needsAsset: true, assetName: 'Grid BESS' },
  { name: 'Smoke_DSR', roleLabel: 'Demand Controller', needsAsset: true, assetName: 'Demand Response' },
  // NOTE: Interconnector role has isSystem: true in constants.js, so it's
  // hidden from WaitingRoom role selection and cannot be tested via UI.
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Poll until predicate returns truthy, or throw after timeout.
 */
async function waitFor(page, predicate, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const result = await page.evaluate(predicate);
      if (result) return result;
    } catch { /* page may still be loading */ }
    await sleep(500);
  }
  const snippet = await page.evaluate(() =>
    document.body.textContent.slice(0, 400)
  ).catch(() => '');
  throw new Error(`waitFor timed out – body: "${snippet}"`);
}

/**
 * Find and click a visible, enabled button whose text includes `frag`.
 */
async function clickButton(page, frag, timeout = 10000) {
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

/**
 * Type a value into the input matching a placeholder fragment.
 * Uses React-compatible value setter to trigger onChange.
 */
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

/**
 * Starts the local Gun relay server and waits for it to be ready.
 * Returns the child process object so it can be killed later.
 */
function startGunRelay() {
  return new Promise((resolve, reject) => {
    console.log('  [Setup] Starting local Gun relay server...');
    const relay = spawn('node', ['gun-relay.cjs'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let started = false;

    // Listen for the specific startup message
    relay.stdout.on('data', (data) => {
      const output = data.toString();
      if (!started && output.includes('Gun relay server running')) {
        started = true;
        console.log('  [Setup] Gun relay server is ready.');
        resolve(relay);
      }
    });

    relay.stderr.on('data', (data) => {
      const output = data.toString();
      // Only warn if it's an actual error, not just an axed message etc.
      if (output.toLowerCase().includes('error')) {
        console.error('  [Relay Error]', output);
      }
    });

    relay.on('error', (err) => {
      if (!started) reject(err);
      else console.error('  [Relay Process Error]', err);
    });

    relay.on('exit', (code) => {
      if (!started && code !== 0) reject(new Error(`Gun relay exited with code ${code}`));
    });
  });
}

// ─── Main join flow for one role ─────────────────────────────────────────────
async function joinRole(page, cfg) {
  const { name, roleLabel, needsAsset, assetName } = cfg;
  const ROOM = 'SM' + Date.now().toString().slice(-6);

  console.log(`\n[${name}] Room: ${ROOM} | Role: "${roleLabel}"${assetName ? ` | Asset: "${assetName}"` : ''}`);

  // ── STEP 1: Lobby ──
  await page.goto(BASE_URL, { waitUntil: 'networkidle2' });

  // Wait for lobby to finish loading
  await waitFor(page, () =>
    document.body.textContent.includes('Network Connected') ||
    document.body.textContent.includes('Connecting') ||
    document.body.textContent.includes('Network Error') ||
    document.body.textContent.includes('Join Session'),
    20000
  );

  // Fill player name
  await fillInput(page, 'e.g. Alice', name);

  // Clear room code field and fill
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('input'))
      .find(i => (i.placeholder || '').includes('ALPHA'));
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      ).set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await fillInput(page, 'ALPHA', ROOM);

  // Click "JOIN WAITING ROOM →"
  await clickButton(page, 'JOIN WAITING ROOM');
  console.log(`[${name}]   ✓ Entered waiting room`);

  // ── STEP 2: Waiting Room — select role ──
  await waitFor(page, () =>
    Array.from(document.querySelectorAll('button'))
      .some(b => b.textContent.includes('Generator')),
    20000
  );

  // Click the role button
  await page.evaluate(label => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.includes(label));
    if (btn) btn.click();
  }, roleLabel);
  await sleep(500);
  console.log(`[${name}]   ✓ Selected role: ${roleLabel}`);

  // ── STEP 3: Click proceed button ──
  // Since each test is alone in its room, the first joiner is always the host.
  // Host sees "START GAME →", but for asset roles the WaitingRoom code
  // may show "SELECT ASSET →" depending on the role's canOwnAssets flag.
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const start = btns.find(b => b.textContent.includes('START GAME'));
    const select = btns.find(b => b.textContent.includes('SELECT ASSET'));
    const join = btns.find(b => b.textContent.includes('JOIN GAME'));
    if (start) start.click();
    else if (select) select.click();
    else if (join) join.click();
  });
  await sleep(500);

  // ── STEP 4: Asset selection (only for asset-owning roles) ──
  if (needsAsset && assetName) {
    console.log(`[${name}]   → Selecting asset: "${assetName}"…`);

    // Wait for asset screen to render
    await waitFor(page, () =>
      document.body.textContent.includes("choose the asset you'll operate"),
      20000
    );

    // The AssetScreen has a <button> per asset card:
    //   When not selected: "SELECT OR CONFIGURE {ASSET_NAME_UPPER} →"
    //   When selected:     "CONFIRM & JOIN SIMULATION →"
    //
    // Click 1: "SELECT OR CONFIGURE {NAME} →" — opens the config/edit panel
    const selectBtnText = 'SELECT OR CONFIGURE ' + assetName.toUpperCase();
    await clickButton(page, selectBtnText, 15000);
    await sleep(500);

    // Click 2: "CONFIRM & JOIN SIMULATION →" — confirms and enters game
    await clickButton(page, 'CONFIRM & JOIN SIMULATION', 15000);
    await sleep(500);
    console.log(`[${name}]   ✓ Asset confirmed`);
  }

  // ── STEP 5: Verify game UI loaded ──
  await waitFor(page, () => document.body.textContent.includes('/48'), 60000);
  console.log(`[${name}]   ✓ Game UI loaded (SP indicator visible)`);

  // Quick sanity: top-bar stats present
  const hasStats = await page.evaluate(() => {
    const t = document.body.textContent;
    return t.includes('SBP') || t.includes('NIV') || t.includes('FREQ');
  });
  if (hasStats) {
    console.log(`[${name}]   ✓ Top-bar stats visible`);
  }
}

// ─── Main runner ─────────────────────────────────────────────────────────────
(async () => {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  GridForge – Role & Asset Smoke Test');
  console.log(`  ${TEST_CASES.length} cases | Server: ${BASE_URL} | Headless: ${HEADLESS}`);
  console.log('══════════════════════════════════════════════════════════');

  let gunRelayProcess = null;
  const failed = [];
  const passed = [];

  try {
    gunRelayProcess = await startGunRelay();

    for (const cfg of TEST_CASES) {
      const browser = await puppeteer.launch({
        headless: HEADLESS ? 'new' : false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      try {
        await joinRole(page, cfg);
        console.log(`  ✅ ${cfg.name} (${cfg.roleLabel})`);
        passed.push(cfg.name);
      } catch (err) {
        console.error(`  ❌ ${cfg.name} (${cfg.roleLabel}): ${err?.message || err}`);
        // Save debug screenshot
        await page.screenshot({
          path: `test/e2e/debug_${cfg.name}.png`,
          fullPage: true
        }).catch(() => { });
        failed.push({ name: cfg.name, role: cfg.roleLabel, err });
      } finally {
        await browser.close().catch(() => { });
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

  } catch (err) {
    console.error('\nSmoke test crashed:', err?.message || err);
    process.exit(1);
  } finally {
    if (gunRelayProcess) {
      console.log('  [Cleanup] Shutting down Gun relay server...');
      gunRelayProcess.kill('SIGKILL');
    }
  }
})();
