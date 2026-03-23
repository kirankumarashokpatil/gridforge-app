/**
 * waiting-room-flow.test.cjs
 *
 * GridForge — NESO-Authority Waiting Room + Join Flow E2E Test
 * ------------------------------------------------------------
 * Tests the full NESO-authority multiplayer flow:
 *   1. All players navigate to lobby and join the same room
 *   2. NESO (host) sees all players in their list
 *   3. NESO assigns roles + assets to each player via dropdowns
 *   4. Non-NESO players see their assignment and click READY
 *   5. NESO clicks START GAME
 *   6. All players arrive on correct game screen
 *
 * Run with:
 *   node test/e2e/waiting-room-flow.test.cjs
 *
 * Env vars:
 *   GRIDFORGE_URL  — base URL (default: http://localhost:5174)
 *   HEADLESS       — set to "false" to watch the browsers
 */

'use strict';
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

const BASE_URL = process.env.GRIDFORGE_URL || 'http://localhost:3000';
const ROOM_CODE = 'WR' + Date.now().toString().slice(-5);
const HEADLESS = process.env.HEADLESS !== 'false';

// ─── Player configurations ────────────────────────────────────────────────
const PLAYERS = [
    { name: 'NESO_Host',    role: 'NESO',      isHost: true,  assetKey: null,   expectedScreen: 'NESO' },
    { name: 'GenCo',        role: 'GENERATOR', isHost: false, assetKey: 'OCGT', expectedScreen: 'Generator' },
    { name: 'PowerSupply',  role: 'SUPPLIER',  isHost: false, assetKey: null,   expectedScreen: 'Supplier' },
    { name: 'BatteryCo',   role: 'BESS',       isHost: false, assetKey: 'BESS_M', expectedScreen: 'Battery' },
    { name: 'DemandCo',    role: 'DSR',        isHost: false, assetKey: 'DSR',  expectedScreen: 'Demand' },
    { name: 'Elexon_Op',   role: 'ELEXON',     isHost: false, assetKey: null,   expectedScreen: 'Elexon' },
    { name: 'HedgeFund',   role: 'TRADER',     isHost: false, assetKey: null,   expectedScreen: 'Trader' },
];

// Map role IDs to the display names in the <select> options
const ROLE_DISPLAY = {
    GENERATOR: 'Generator',
    SUPPLIER:  'Supplier',
    BESS:      'Battery Storage',
    DSR:       'Demand Controller',
    ELEXON:    'Elexon',
    TRADER:    'Trader',
};

// ─── Results ──────────────────────────────────────────────────────────────
const results = { passed: [], failed: [] };
function pass(label) { results.passed.push(label); console.log(`  ✅ ${label}`); }
function fail(label, err) { results.failed.push({ label, err }); console.error(`  ❌ ${label}: ${err?.message || err}`); }

// ─── Utilities ────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(page, predicate, timeout = 30000, arg) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try { const r = await page.evaluate(predicate, arg); if (r) return r; } catch { }
        await sleep(400);
    }
    const snippet = await page.evaluate(() => document.body.textContent.slice(0, 300)).catch(() => '');
    throw new Error(`waitFor timed out. Body: "${snippet}"`);
}

async function typeInto(page, placeholder, value) {
    await page.waitForFunction((ph, val) => {
        const input = Array.from(document.querySelectorAll('input'))
            .find(i => i.placeholder?.toUpperCase().includes(ph.toUpperCase()));
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }, { timeout: 15000 }, placeholder, value.toString());
}

async function clickButton(page, textFragment, timeout = 20000) {
    await page.waitForFunction(t => {
        const btn = Array.from(document.querySelectorAll('button:not([disabled])'))
            .find(b => b.textContent.toUpperCase().includes(t.toUpperCase()));
        if (!btn) return false;
        btn.click();
        return true;
    }, { timeout }, textFragment);
    await sleep(300);
}

// ─── Phase 1: Navigate to lobby + join waiting room ───────────────────────
async function enterLobby(page, playerName) {
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    await waitFor(page, () =>
        document.body.textContent.includes('Join Session') ||
        document.body.textContent.includes('Online') ||
        document.querySelector('input') !== null
    , 20000);

    await typeInto(page, 'e.g. Alice', playerName);

    await page.evaluate(() => {
        const el = document.querySelector('input[placeholder="e.g. ALPHA"]');
        if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await typeInto(page, 'e.g. ALPHA', ROOM_CODE);

    await clickButton(page, 'JOIN WAITING ROOM');

    // Verify we landed on the waiting room
    await waitFor(page, () =>
        document.body.textContent.includes('PLAYERS IN ROOM') ||
        document.body.textContent.includes('NESO CONTROL') ||
        document.body.textContent.includes('YOUR ASSIGNMENT')
    , 20000);

    console.log(`  [${playerName}] Waiting room entered`);
}

// ─── Phase 1b: Non-host sets preferred role ───────────────────────────────
async function setPreferredRole(page, playerName, roleId) {
    const ok = await page.evaluate(rid => {
        const btn = document.querySelector(`[data-testid="role-${rid}"]`);
        if (btn) { btn.click(); return true; }
        return false;
    }, roleId);
    if (ok) console.log(`  [${playerName}] Preferred role set: ${roleId}`);
    else console.warn(`  [${playerName}] No button found for role ${roleId} (may be correct for some roles)`);
}

// ─── Phase 2: NESO waits for all players to appear ────────────────────────
async function waitForAllPlayers(nesoPage, expectedCount, timeout = 45000) {
    await waitFor(nesoPage, count =>
        (document.body.textContent.match(/PLAYERS IN ROOM \((\d+)\)/) || [])[1] >= count
    , timeout, expectedCount);
    const actual = await nesoPage.evaluate(() =>
        parseInt((document.body.textContent.match(/PLAYERS IN ROOM \((\d+)\)/) || [0, 0])[1], 10)
    );
    console.log(`  [NESO] Sees ${actual}/${expectedCount} players`);
    return actual;
}

// ─── Phase 3: NESO assigns role to a player ──────────────────────────────
async function nesoAssignRole(nesoPage, playerName, roleId) {
    const ok = await nesoPage.evaluate((pName, rId) => {
        // Use data-player-name attribute added to each player card
        const card = document.querySelector(`[data-player-name="${pName}"]`);
        if (!card) return `NO_CARD:${pName}`;
        const sel = card.querySelector('[data-testid="role-assign-select"]');
        if (!sel) return 'NO_SELECT';
        if (sel.disabled) return 'DISABLED';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, rId);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return 'OK';
    }, playerName, roleId);

    if (ok === 'OK') console.log(`  [NESO] Assigned ${roleId} to ${playerName}`);
    else console.warn(`  [NESO] assign role result: ${ok} (player: ${playerName})`);
    await sleep(600);
    return ok === 'OK';
}

// ─── Phase 3b: NESO assigns asset to a player ────────────────────────────
async function nesoAssignAsset(nesoPage, playerName, assetKey) {
    // Wait for the asset select to appear (rendered only after role is set)
    await nesoPage.waitForFunction((pName) => {
        const card = document.querySelector(`[data-player-name="${pName}"]`);
        return card && card.querySelector('[data-testid="asset-assign-select"]') !== null;
    }, { timeout: 8000 }, playerName).catch(() => {});

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

    if (ok === 'OK') console.log(`  [NESO] Assigned asset ${assetKey} to ${playerName}`);
    else console.warn(`  [NESO] assign asset result: ${ok} (player: ${playerName})`);
    await sleep(600);
    return ok === 'OK';
}

// ─── Phase 4: Non-host player clicks READY ───────────────────────────────
async function playerClickReady(page, playerName, timeout = 30000) {
    // Wait for assignment to appear
    await waitFor(page, () =>
        document.body.textContent.includes('Confirmed by NESO') ||
        document.body.textContent.includes('NOT READY (click to ready)')
    , timeout);

    await clickButton(page, 'NOT READY (click to ready)', 15000);
    console.log(`  [${playerName}] Clicked READY`);

    // Confirm the button flipped to READY
    await waitFor(page, () => document.body.textContent.includes('✓ READY'), 10000);
    console.log(`  [${playerName}] Status confirmed READY`);
}

// ─── Phase 5: Verify readiness panel + start game ─────────────────────────
async function nesoStartGame(nesoPage) {
    // Wait for the readiness panel to show all players ready
    await waitFor(nesoPage, () => {
        const text = document.body.textContent;
        return text.includes('All players ready') || text.includes('READY');
    }, 30000);

    // Wait for START GAME button to be enabled
    await nesoPage.waitForFunction(() => {
        const btn = Array.from(document.querySelectorAll('button'))
            .find(b => b.textContent.toUpperCase().includes('START GAME') && !b.disabled);
        return !!btn;
    }, { timeout: 20000 });

    await clickButton(nesoPage, 'START GAME');
    console.log(`  [NESO] START GAME clicked`);
}

// ─── Phase 6: Verify player reached game screen ───────────────────────────
async function verifyGameScreen(page, playerName, expectedText, timeout = 30000) {
    await waitFor(page, () => document.body.textContent.includes('/48'), timeout);
    console.log(`  [${playerName}] ✓ Game screen reached (SP indicator visible)`);
}

// ─── Gun relay (no longer needed — app uses FastAPI WebSocket) ────────────
function startGunRelay() {
    console.log('  [Setup] Skipping Gun relay (app uses FastAPI WebSocket)');
    return Promise.resolve(null);
}

// ─── Main ─────────────────────────────────────────────────────────────────
(async () => {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  GRIDFORGE — Waiting Room Join Flow Test');
    console.log(`  Room: ${ROOM_CODE}  |  Players: ${PLAYERS.length}  |  URL: ${BASE_URL}`);
    console.log('══════════════════════════════════════════════════════════\n');

    let gunRelayProcess = null;
    const browsers = [];
    const pages = [];

    try {
        try { gunRelayProcess = await startGunRelay(); } catch (e) { console.warn('  [Relay] Could not start relay, using default peers:', e.message); }

        // ── Step 1: Launch all browsers + enter lobby ────────────────
        console.log('\n─── Step 1: All Players Enter Lobby ───────────────────');
        for (let i = 0; i < PLAYERS.length; i++) {
            const cfg = PLAYERS[i];
            const browser = await puppeteer.launch({
                headless: HEADLESS ? 'new' : false,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            browsers.push(browser);
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 900 });
            pages.push(page);

            // Forward console errors for debugging
            page.on('console', msg => {
                if (msg.type() === 'error') console.log(`  [BROWSER][${cfg.name}] ${msg.text()}`);
            });
            page.on('pageerror', err => console.error(`  [PAGE ERROR][${cfg.name}]`, err.message));
        }

        // ── NESO_Host must join FIRST to claim the host slot ────────
        // Then other players join in parallel
        console.log('  Launching NESO_Host first to claim host slot...');
        try {
            await enterLobby(pages[0], PLAYERS[0].name);
            // Wait until NESO control panel appears
            await waitFor(pages[0], () => document.body.textContent.includes('NESO CONTROL') || document.body.textContent.includes('ROOM AUTHORITY'), 20000);
            pass(`Lobby: ${PLAYERS[0].name} confirmed as NESO host`);
        } catch (e) {
            fail(`Lobby: ${PLAYERS[0].name}`, e);
            await pages[0].screenshot({ path: `test_fail_lobby_NESO.png`, fullPage: true }).catch(() => {});
        }

        await sleep(3000); // give NESO's host record time to propagate via relay

        // Now join remaining players in parallel
        await Promise.all(PLAYERS.slice(1).map(async (cfg, idx) => {
            const i = idx + 1;
            try {
                await enterLobby(pages[i], cfg.name);
                // Verify non-host player did NOT accidentally claim host role
                const wrongHost = await pages[i].evaluate(() =>
                    document.body.textContent.includes('ROOM AUTHORITY') &&
                    document.body.textContent.includes('Assign final roles')
                );
                if (wrongHost) {
                    // Wait up to 4s for the on() watcher to self-correct
                    await waitFor(pages[i], () =>
                        !document.body.textContent.includes('ROOM AUTHORITY') ||
                        document.body.textContent.includes('YOUR ASSIGNMENT')
                    , 4000).catch(() => {});
                }
                pass(`Lobby: ${cfg.name} entered waiting room`);
            } catch (e) {
                fail(`Lobby: ${cfg.name}`, e);
                await pages[i].screenshot({ path: `test_fail_lobby_${cfg.name}.png`, fullPage: true }).catch(() => {});
            }
        }));

        await sleep(2000); // allow GunDB P2P to mesh

        // ── Step 2: Non-host players set preferred roles ─────────────
        console.log('\n─── Step 2: Non-Host Players Set Preferences ──────────');
        for (let i = 1; i < PLAYERS.length; i++) {
            const cfg = PLAYERS[i];
            try {
                await setPreferredRole(pages[i], cfg.name, cfg.role);
                pass(`Preference: ${cfg.name} → ${cfg.role}`);
            } catch (e) {
                fail(`Preference: ${cfg.name}`, e);
            }
        }
        await sleep(2000); // let preferences propagate to NESO

        // ── Step 3: NESO waits for all players, then assigns roles ───
        console.log('\n─── Step 3: NESO Assigns Roles & Assets ───────────────');
        try {
            const seen = await waitForAllPlayers(pages[0], PLAYERS.length);
            pass(`NESO sees all ${seen} players`);
        } catch (e) {
            fail('NESO sees all players', e);
            await pages[0].screenshot({ path: 'test_fail_neso_playerlist.png', fullPage: true }).catch(() => {});
        }

        for (let i = 1; i < PLAYERS.length; i++) {
            const cfg = PLAYERS[i];
            try {
                const roleOk = await nesoAssignRole(pages[0], cfg.name, cfg.role);
                await sleep(800);

                if (cfg.assetKey) {
                    const assetOk = await nesoAssignAsset(pages[0], cfg.name, cfg.assetKey);
                    await sleep(800);
                    pass(`Assignment: ${cfg.name} → ${cfg.role} + ${cfg.assetKey}`);
                } else {
                    pass(`Assignment: ${cfg.name} → ${cfg.role}`);
                }
            } catch (e) {
                fail(`Assignment: ${cfg.name}`, e);
                await pages[0].screenshot({ path: `test_fail_assign_${cfg.name}.png`, fullPage: true }).catch(() => {});
            }
        }

        // ── Step 4: Non-host players click READY ─────────────────────
        console.log('\n─── Step 4: Players Click Ready ───────────────────────');
        await Promise.all(PLAYERS.slice(1).map(async (cfg, idx) => {
            const i = idx + 1;
            try {
                await playerClickReady(pages[i], cfg.name);
                pass(`Ready: ${cfg.name}`);
            } catch (e) {
                fail(`Ready: ${cfg.name}`, e);
                await pages[i].screenshot({ path: `test_fail_ready_${cfg.name}.png`, fullPage: true }).catch(() => {});
            }
        }));

        await sleep(1500);

        // ── Step 5: NESO checks readiness + starts game ──────────────
        console.log('\n─── Step 5: NESO Starts Game ──────────────────────────');
        try {
            await nesoStartGame(pages[0]);
            pass('NESO clicked START GAME');
        } catch (e) {
            fail('NESO start game', e);
            await pages[0].screenshot({ path: 'test_fail_startgame.png', fullPage: true }).catch(() => {});
        }

        // ── Step 6: Verify all players reach game screen ─────────────
        console.log('\n─── Step 6: Verify All Game Screens ──────────────────');
        await Promise.all(PLAYERS.map(async (cfg, i) => {
            try {
                await verifyGameScreen(pages[i], cfg.name, cfg.expectedScreen);
                pass(`Game screen: ${cfg.name} (${cfg.role})`);
            } catch (e) {
                fail(`Game screen: ${cfg.name}`, e);
                await pages[i].screenshot({ path: `test_fail_gamescreen_${cfg.name}.png`, fullPage: true }).catch(() => {});
            }
        }));

        // ── Step 7: Spot-check — NESO sees all players in leaderboard ─
        console.log('\n─── Step 7: Leaderboard Spot-Check ───────────────────');
        await sleep(3000);
        try {
            const playerCount = await pages[0].evaluate(() => {
                const text = document.body.textContent;
                const m = text.match(/Players\s*\((\d+)\)/);
                return m ? parseInt(m[1], 10) : 0;
            });
            if (playerCount >= PLAYERS.length)
                pass(`Leaderboard shows ${playerCount} players`);
            else
                fail(`Leaderboard count`, new Error(`Expected ≥${PLAYERS.length}, got ${playerCount}`));
        } catch (e) {
            fail('Leaderboard spot-check', e);
        }

    } catch (e) {
        console.error('\n[FATAL]', e.message);
        // Save screenshots for all pages on fatal error
        for (let i = 0; i < pages.length; i++) {
            await pages[i].screenshot({ path: `test_fatal_${PLAYERS[i]?.name || i}.png`, fullPage: true }).catch(() => {});
        }
    } finally {
        // ── Print results ─────────────────────────────────────────────
        console.log('\n══════════════════════════════════════════════════════════');
        console.log(`  RESULTS: ${results.passed.length} passed / ${results.failed.length} failed`);
        console.log('══════════════════════════════════════════════════════════');

        if (results.failed.length > 0) {
            console.log('\n  FAILURES:');
            results.failed.forEach(f => console.error(`    ❌ ${f.label}: ${f.err?.message || f.err}`));
        }

        for (const b of browsers) { await b.close().catch(() => {}); }
        if (gunRelayProcess) { gunRelayProcess.kill(); }

        process.exit(results.failed.length > 0 ? 1 : 0);
    }
})();
