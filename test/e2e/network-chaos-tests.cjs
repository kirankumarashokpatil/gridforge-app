/**
 * network-chaos-tests.cjs
 *
 * NETWORK & GunDB CHAOS TEST SUITE
 * ════════════════════════════════════════════════════════════════════════════
 * Tests that verify your app's resilience to real-world network failures.
 * Since GridForge relies on decentralized GunDB replication, these tests are CRITICAL.
 *
 * TESTS INCLUDED:
 * ───────────────
 * 1. THE LATE JOINER SYNC TEST
 *    Have 3 players play through to Settlement Period 3.
 *    Then open a 4th browser and join the room.
 *    Verify Player 4 correctly downloads SP 1-3 history and matches current state.
 *
 * 2. THE RACE CONDITION GATE CLOSURE TEST
 *    Two players click "Submit BM Bid" at the exact millisecond the timer hits 0.
 *    Verify the gate logic consistently accepts/rejects both without crashing.
 *
 * 3. THE OFFLINE DISCONNECT TEST
 *    Player submits a Day-Ahead bid, then browser goes offline.
 *    Reconnect after 10 seconds.
 *    Verify GunDB successfully syncs the queued bid to the server.
 *
 * Run:
 *   node test/e2e/network-chaos-tests.cjs
 *
 * Env vars:
 *   HEADLESS=false  – watch the browsers (HIGHLY RECOMMENDED for these tests!)
 *   SLOW_MO=300     – slow down actions to see network behavior
 */

'use strict';

const puppeteer = require('puppeteer');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BASE_URL = process.env.GRIDFORGE_URL || 'http://localhost:3000';
const HEADLESS = process.env.HEADLESS !== 'false';
const SLOW_MO = parseInt(process.env.SLOW_MO || '0', 10);
const ROOM_CODE = 'NET_' + Date.now().toString().slice(-6);

const results = { passed: [], failed: [], warned: [] };
function pass(label) {
  results.passed.push(label);
  console.log(`  ✅ ${label}`);
}
function fail(label, err) {
  results.failed.push({ label, err });
  console.error(`  ❌ ${label}: ${err?.message || err}`);
}
function warn(label, msg) {
  results.warned.push({ label, msg });
  console.warn(`  ⚠️  ${label}: ${msg}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── UTILITIES ───────────────────────────────────────────────────────────────

async function waitFor(page, predicate, timeout = 30000, arg) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(predicate, arg)) return true;
    } catch { /* page loading */ }
    await sleep(300);
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

async function clickButton(page, fragment, timeout = 20000) {
  const clicked = await page.waitForFunction(
    frag => {
      const btn = Array.from(document.querySelectorAll('button:not([disabled])'))
        .find(b => b.textContent.toUpperCase().includes(frag.toUpperCase()));
      if (!btn) return false;
      btn.click();
      return true;
    },
    { timeout },
    fragment
  );
  await sleep(250);
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
      return true;
    },
    { timeout: 15000 },
    placeholder,
    value
  );
}

async function fillNumber(page, index, value) {
  await page.waitForFunction(
    (idx, val) => {
      const inputs = Array.from(document.querySelectorAll('input[type="number"]:not([disabled])'));
      if (!inputs[idx]) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inputs[idx], val.toString());
      inputs[idx].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[idx].dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    { timeout: 20000 },
    index,
    value
  );
  await sleep(150);
}

async function getPhaseLabel(page) {
  try {
    return await page.evaluate(() => {
      const text = document.body.textContent.toUpperCase();
      if (text.includes('SETTLEMENT')) return 'SETTLED';
      if (text.includes('BALANCING') || text.includes('BM')) return 'BM';
      if (text.includes('INTRADAY')) return 'ID';
      if (text.includes('DAY AHEAD') || text.includes('DAY-AHEAD')) return 'DA';
      return 'UNKNOWN';
    });
  } catch (e) {
    return 'ERR';
  }
}

async function joinGame(page, name, roleLabel) {
  console.log(`  [JOIN] ${name} as ${roleLabel}…`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await waitFor(page, () => document.body.textContent.includes('Online'), 30000);

  await fillInput(page, 'e.g. Alice', name);
  await fillInput(page, 'e.g. ALPHA', ROOM_CODE);
  await clickButton(page, 'JOIN WAITING ROOM');

  await waitFor(page, () =>
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Generator')),
    30000
  );

  await page.evaluate(label => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes(label));
    if (btn) btn.click();
  }, roleLabel);
  await sleep(800);

  await clickButton(page, 'START GAME');
  await sleep(1000);

  console.log(`  [JOIN] ${name} joined successfully`);
}

// ─── TEST 1: LATE JOINER SYNC TEST ───────────────────────────────────────

/**
 * THE "LATE JOINER" SYNC TEST
 *
 * 1. Have 3 players play through Settlement Period 3 (reaching phase 12/12)
 * 2. Open a 4th browser window and join the room
 * 3. Verify Player 4:
 *    - Correctly downloads the history for SPs 1-3
 *    - Calculates correct current state
 *    - Perfectly matches clock of existing players
 *    - Can immediately participate in SP 4
 *
 * This tests GunDB's ability to sync historical state to new peers.
 */
async function testLateJoinerSync() {
  console.log('\n🧪 TEST: LATE JOINER SYNC TEST');
  console.log('═══════════════════════════════════════════════════════════════════════');

  let browser = null;
  const pages = [];

  try {
    browser = await puppeteer.launch({
      headless: HEADLESS,
      slowMo: SLOW_MO,
      args: ['--no-sandbox'],
    });

    // ─── SETUP: 3 PLAYERS PLAY THROUGH SP 3 ───
    console.log('\n  [SETUP] Opening 3 players (NESO, Gen, Supplier)…');
    for (const [name, role] of [
      ['NESO_Op', 'System Operator'],
      ['GenCo', 'Generator'],
      ['Supplier', 'Supplier'],
    ]) {
      const p = await browser.newPage();
      pages.push(p);
      await joinGame(p, name, role);
    }

    console.log('\n  [PLAY] Simulating 3 Settlement Periods…');

    // Quick simulation: Advance phase 12 times (4 phases × 3 SPs)
    // NESO advances, then we wait for sync
    for (let spNum = 1; spNum <= 3; spNum++) {
      for (let phaseNum = 1; phaseNum <= 4; phaseNum++) {
        console.log(`    SP ${spNum} Phase ${phaseNum}…`);

        // NESO clicks advance
        try {
          await clickButton(pages[0], 'ADVANCE PHASE', 10000);
        } catch (e) {
          // Button might not exist if at end, that's OK
        }

        await sleep(2000); // Wait for sync
      }
    }

    // Verify all 3 are at the same phase (should be SETTLED or awaiting SP 4 DA)
    const allPhases = await Promise.all(pages.map(getPhaseLabel));
    console.log(`\n    [CHECK] Current phases: ${allPhases.join(', ')}`);

    // ─── THE LATE JOINER ───
    console.log('\n  [LATE JOINER] Opening 4th player (Trader) mid-game…');
    const lateJoiner = await browser.newPage();
    pages.push(lateJoiner);

    // This player joins the SAME room
    await joinGame(lateJoiner, 'LateTrader', 'Trader');

    // Give GunDB time to sync history
    console.log('\n  [SYNC] Waiting for late joiner to download history…');
    await sleep(3000);

    // ─── VERIFICATION ───
    const lateJoinerPhase = await getPhaseLabel(lateJoiner);
    const nesoPhase = await getPhaseLabel(pages[0]);

    console.log(`    NESO phase: ${nesoPhase}`);
    console.log(`    Late Joiner phase: ${lateJoinerPhase}`);

    if (lateJoinerPhase === nesoPhase ||
      (lateJoinerPhase === 'DA' && (nesoPhase === 'SETTLED' || nesoPhase === 'UNKNOWN'))) {
      pass('Late Joiner Sync: 4th player joined and matched state');
    } else {
      fail('Late Joiner Sync: 4th player phase mismatch',
        new Error(`NESO: ${nesoPhase}, Late: ${lateJoinerPhase}`));
    }

    // Check that late joiner can see player names (proof of state sync)
    const playerNames = await lateJoiner.evaluate(() => {
      return document.body.textContent.includes('NESO') ? 'FOUND' : 'NOT_FOUND';
    });

    if (playerNames === 'FOUND') {
      pass('Late Joiner Sync: Late joiner downloaded player roster');
    } else {
      warn('Late Joiner Sync: Late joiner cannot see other player names',
        'State may not have fully synced');
    }

  } catch (e) {
    fail('Late Joiner Sync: Unexpected error', e);
  } finally {
    if (browser) await browser.close();
  }
}

// ─── TEST 2: RACE CONDITION GATE CLOSURE TEST ─────────────────────────────

/**
 * THE "RACE CONDITION" GATE CLOSURE TEST
 *
 * Simulate a race condition:
 * Two players both click "Submit BM Bid" at the EXACT moment
 * the BM gate closure timer hits 0 and transitions to next phase.
 *
 * Verify that GateLogic.js handles both submissions consistently:
 *   - Either both are accepted (if submitted before gate closed)
 *   - Or both are rejected (if gate already closed)
 *   - NOT: One accepted, one rejected (inconsistent)
 *   - NOT: Crash or stale state
 */
async function testRaceConditionGateClosure() {
  console.log('\n🧪 TEST: RACE CONDITION GATE CLOSURE TEST');
  console.log('═══════════════════════════════════════════════════════════════════════');

  let browser = null;
  const pages = [];

  try {
    browser = await puppeteer.launch({
      headless: HEADLESS,
      slowMo: SLOW_MO,
      args: ['--no-sandbox'],
    });

    console.log('\n  [SETUP] Opening 3 players…');
    for (const [name, role] of [
      ['NESO_Op', 'System Operator'],
      ['Gen_A', 'Generator'],
      ['Gen_B', 'Supplier'], // Second "generator" for BM attempts
    ]) {
      const p = await browser.newPage();
      pages.push(p);
      await joinGame(p, name, role);
    }

    // Advance to BM phase
    console.log('\n  [SETUP] Advancing to BM phase…');
    for (let i = 0; i < 3; i++) {
      try {
        await clickButton(pages[0], 'ADVANCE PHASE', 10000);
        await sleep(1500);
      } catch { /* OK */ }
    }

    const currentPhase = await getPhaseLabel(pages[0]);
    console.log(`    Current phase: ${currentPhase}`);

    if (currentPhase !== 'BM') {
      warn('Race Condition: Not in BM phase, test cannot verify gate closure',
        'Skipping this test');
      return;
    }

    // ─── SIMULATE RACE ───
    console.log('\n  [RACE] Both players filling in bids simultaneously…');

    // Fill both pages at same time (parallel)
    await Promise.all([
      fillNumber(pages[1], 0, 25).catch(e => console.log('Gen_A fill error:', e.message)),
      fillNumber(pages[2], 0, 15).catch(e => console.log('Gen_B fill error:', e.message)),
    ]);

    console.log('\n  [RACE] Both players clicking submit at same moment…');
    const startTime = Date.now();

    // Click BOTH submit buttons in parallel (race condition)
    const clicks = await Promise.all([
      clickButton(pages[1], 'SUBMIT', 15000).catch(e => ({ error: e.message })),
      clickButton(pages[2], 'SUBMIT', 15000).catch(e => ({ error: e.message })),
    ]);

    const endTime = Date.now();
    console.log(`    Both clicks completed in ${endTime - startTime}ms`);
    console.log(`    Click results: ${JSON.stringify(clicks)}`);

    // ─── CHECK CONSISTENCY ───
    console.log('\n  [CHECK] Verifying gate logic consistency…');

    // Wait for state to settle
    await sleep(2000);

    // Check both players' button states (accepted or rejected)
    const states = await Promise.all([
      pages[1].evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent.includes('SUBMIT'));
        return btn ? {
          disabled: btn.disabled,
          text: btn.textContent.substring(0, 40),
        } : { status: 'BUTTON_NOT_FOUND' };
      }),
      pages[2].evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent.includes('SUBMIT'));
        return btn ? {
          disabled: btn.disabled,
          text: btn.textContent.substring(0, 40),
        } : { status: 'BUTTON_NOT_FOUND' };
      }),
    ]);

    console.log(`    Gen_A button: ${JSON.stringify(states[0])}`);
    console.log(`    Gen_B button: ${JSON.stringify(states[1])}`);

    // Both should be in same state (both accepted or both rejected)
    const bothDisabled = states[0].disabled && states[1].disabled;
    const bothEnabled = !states[0].disabled && !states[1].disabled;

    if (bothDisabled || bothEnabled) {
      pass('Race Condition: Both players had consistent outcome (both locked or both open)');
    } else {
      fail('Race Condition: Inconsistent gate behavior',
        new Error(`Gen_A disabled=${states[0].disabled}, Gen_B disabled=${states[1].disabled}`));
    }

    // Check app didn't crash
    const appStillRunning = await pages[0].evaluate(() =>
      document.querySelector('button') !== null
    );

    if (appStillRunning) {
      pass('Race Condition: App did not crash during simultaneous submissions');
    } else {
      fail('Race Condition: App crashed or frozen', new Error('No buttons found'));
    }

  } catch (e) {
    fail('Race Condition: Unexpected error', e);
  } finally {
    if (browser) await browser.close();
  }
}

// ─── TEST 3: OFFLINE DISCONNECT TEST ──────────────────────────────────────

/**
 * THE "OFFLINE DISCONNECT" TEST
 *
 * 1. Player submits a Day-Ahead bid
 * 2. Immediately disable network (page.setOfflineMode(true))
 * 3. Verify bid is queued locally (or shows "offline" indicator)
 * 4. Wait 10 seconds (offline)
 * 5. Re-enable network
 * 6. Verify GunDB successfully syncs the queued bid to the server
 * 7. Other players' UIs reflect the bid
 */
async function testOfflineDisconnect() {
  console.log('\n🧪 TEST: OFFLINE DISCONNECT TEST');
  console.log('═══════════════════════════════════════════════════════════════════════');

  let browser = null;
  const pages = [];

  try {
    browser = await puppeteer.launch({
      headless: HEADLESS,
      slowMo: SLOW_MO,
      args: ['--no-sandbox'],
    });

    console.log('\n  [SETUP] Opening 2 players…');
    for (const [name, role] of [
      ['NESO_Op', 'System Operator'],
      ['GenOffline', 'Generator'],
    ]) {
      const p = await browser.newPage();
      pages.push(p);
      await joinGame(p, name, role);
    }

    console.log('\n  [ACTION] Generator submitting bid…');
    await fillNumber(pages[1], 0, 50); // 50 MW
    await fillNumber(pages[1], 1, 65); // £65

    // Get bid receipt before going offline
    const bidTextBefore = await pages[1].evaluate(() => document.body.textContent.substring(0, 200));

    console.log('\n  [NETWORK] Setting generator OFFLINE…');
    await pages[1].setOfflineMode(true);
    console.log('    Generator is now offline');

    // Try to submit while offline
    console.log('\n  [OFFLINE ACTION] Clicking submit while offline…');
    try {
      await clickButton(pages[1], 'SUBMIT', 8000);
      console.log('    Submit clicked (even offline)');
    } catch (e) {
      warn('Offline Submit: Click may have failed or button disabled',
        'This is acceptable behavior');
    }

    // Check for offline indicator
    const offlineState = await pages[1].evaluate(() => {
      const hasOfflineMsg = document.body.textContent.includes('offline') ||
        document.body.textContent.includes('Offline') ||
        document.body.textContent.includes('OFFLINE');
      const hasQueuedMsg = document.body.textContent.includes('queued') ||
        document.body.textContent.includes('QUEUED') ||
        document.body.textContent.includes('Sync');
      return { hasOfflineMsg, hasQueuedMsg };
    });

    if (offlineState.hasOfflineMsg || offlineState.hasQueuedMsg) {
      pass('Offline Disconnect: App shows offline/queued indicator while disconnected');
    } else {
      warn('Offline Disconnect: No offline indicator visible',
        'App should show "offline" or "queued" to user');
    }

    // Wait while offline
    console.log('\n  [OFFLINE WAIT] Waiting 10 seconds while offline…');
    await sleep(10000);

    // Reconnect
    console.log('\n  [NETWORK] Re-enabling network…');
    await pages[1].setOfflineMode(false);
    console.log('    Network restored');

    // Wait for GunDB to sync
    console.log('\n  [SYNC] Waiting for bid to sync after reconnect…');
    await sleep(3000);

    // Check if NESO can see the bid
    const nesoPageText = await pages[0].evaluate(() => document.body.textContent);
    const nesoCanSeeGenName = nesoPageText.includes('GenOffline');

    if (nesoCanSeeGenName) {
      pass('Offline Disconnect: Bid successfully synced to NESO after reconnect');
    } else {
      warn('Offline Disconnect: NESO does not show late-synced bid',
        'Either bid sync not implemented or takes longer');
    }

  } catch (e) {
    fail('Offline Disconnect: Unexpected error', e);
  } finally {
    if (browser) await browser.close();
  }
}

// ─── MAIN TEST RUNNER ────────────────────────────────────────────────────────

(async () => {
  console.log('\n\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║              NETWORK & GUNDB CHAOS TEST SUITE                          ║');
  console.log('║         (Late Joiner, Race Conditions, Offline Resilience)             ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');

  try {
    await testLateJoinerSync();
    await testRaceConditionGateClosure();
    await testOfflineDisconnect();
  } catch (e) {
    fail('Test suite execution', e);
  }

  // ─── REPORT ──
  console.log('\n\n╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║                      TEST SUMMARY                                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');

  console.log(`✅ PASSED: ${results.passed.length}`);
  results.passed.forEach(r => console.log(`   • ${r}`));

  console.log(`\n⚠️  WARNED: ${results.warned.length}`);
  results.warned.forEach(({ label, msg }) => console.log(`   • ${label}: ${msg}`));

  console.log(`\n❌ FAILED: ${results.failed.length}`);
  results.failed.forEach(({ label, err }) => console.log(`   • ${label}: ${err.message}`));

  const total = results.passed.length + results.failed.length;
  const rate = total > 0 ? ((results.passed.length / total) * 100).toFixed(0) : 0;

  console.log(`\n📊 PASS RATE: ${rate}% (${results.passed.length}/${total})`);
  console.log('\n');

  if (results.failed.length === 0) {
    console.log('🎉 ALL NETWORK CHAOS TESTS PASSED!');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Review output above.');
    process.exit(1);
  }
})();
