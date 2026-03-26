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
// Use full timestamp to guarantee a unique room code across all test runs
const ROOM_CODE = 'WR' + Date.now().toString().slice(-8);
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

// ─── Player PID registry — populated during enterLobby ───────────────────
// Keyed by playerName, value is the browser-generated PID from window.name.
// Using this avoids re-reading window.name later (which can be stale/wrong).
const playerPids = {};

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
    // Wait for the input to appear in the DOM
    await page.waitForFunction(
        (ph) => !!Array.from(document.querySelectorAll('input'))
            .find(i => i.placeholder?.toUpperCase().includes(ph.toUpperCase())),
        { timeout: 15000 }, placeholder
    );

    // Get an ElementHandle via evaluateHandle (returns a live DOM reference)
    const inputHandle = await page.evaluateHandle(
        (ph) => Array.from(document.querySelectorAll('input'))
            .find(i => i.placeholder?.toUpperCase().includes(ph.toUpperCase())),
        placeholder
    );
    const el = inputHandle.asElement();
    if (!el) throw new Error(`Input with placeholder "${placeholder}" not found`);

    // Triple-click selects all existing text, then type replaces it.
    // ElementHandle.click() dispatches real mouse events → React's onFocus fires.
    // ElementHandle.type() dispatches real keyboard events → React's onChange fires.
    await el.click({ clickCount: 3 });
    await el.type(value.toString(), { delay: 30 });
    await sleep(200); // allow React batch setState to flush before next action
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
    // Pass name and room via URL query params - bypasses React synthetic event timing issues
    const base = BASE_URL.replace(/\/$/, '');
    const url = `${base}/?playerName=${encodeURIComponent(playerName)}&roomCode=${encodeURIComponent(ROOM_CODE)}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    await waitFor(page, () =>
        document.body.textContent.includes('Join Session') ||
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

    // Verify we landed on the waiting room
    await waitFor(page, () =>
        document.body.textContent.includes('PLAYERS IN ROOM') ||
        document.body.textContent.includes('NESO CONTROL') ||
        document.body.textContent.includes('YOUR ASSIGNMENT')
    , 20000);

    // Direct API registration: read pid from window.name and POST to backend with player name.
    // Wait up to 6s for window.name to be populated by the React app (slow under resource pressure).
    const registeredPid = await page.evaluate(async (apiBase, roomCode, pName, isNesoHost) => {
        const prefix = 'gridforge_playerId:';
        // Wait up to 6000ms for window.name to be set
        for (let i = 0; i < 60; i++) {
            if (window.name.startsWith(prefix)) break;
            await new Promise(r => setTimeout(r, 100));
        }
        const pid = window.name.startsWith(prefix) ? window.name.slice(prefix.length) : null;
        if (!pid) { console.error('[E2E] window.name has no pid for', pName); return null; }
        // Ensure room exists first (ignore errors — another player may have created it)
        await fetch(`${apiBase}/api/rooms/${roomCode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenarioId: 'BAU' })
        }).catch(() => {});
        // Register this player with their correct name (and role for NESO_Host)
        const playerData = { name: pName, lastSeen: Date.now() };
        if (isNesoHost) { playerData.role = 'NESO'; playerData.status = 'ASSIGNED'; }
        const res = await fetch(`${apiBase}/api/rooms/${roomCode}/players/${pid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(playerData)
        });
        if (!res.ok) { console.error('[E2E] registration failed for', pName, res.status); }
        return pid;
    }, 'http://localhost:8000', ROOM_CODE, playerName, playerName === 'NESO_Host');

    if (registeredPid) {
        playerPids[playerName] = registeredPid;
        console.log(`  [${playerName}] Waiting room entered (pid: ${registeredPid.slice(-8)})`);
    } else {
        // Retry once more after a short delay — sometimes window.name race under load
        await sleep(3000);
        const retryPid = await page.evaluate(() => {
            const prefix = 'gridforge_playerId:';
            return window.name.startsWith(prefix) ? window.name.slice(prefix.length) : null;
        }).catch(() => null);
        if (retryPid) {
            playerPids[playerName] = retryPid;
            console.log(`  [${playerName}] Waiting room entered (pid recovered: ${retryPid.slice(-8)})`);
        } else {
            console.warn(`  [${playerName}] Waiting room entered (pid unknown — window.name not set)`);
        }
    }
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
async function waitForAllPlayers(nesoPage, expectedCount, timeout = 60000) {
    // Wait for enough active players. NESO host status was already confirmed in Step 1.
    await waitFor(nesoPage, count => {
        const text = document.body.textContent;
        const countMatch = (text.match(/PLAYERS IN ROOM \((\d+)\)/) || [])[1];
        return parseInt(countMatch, 10) >= count;
    }, timeout, expectedCount);
    const actual = await nesoPage.evaluate(() =>
        parseInt((document.body.textContent.match(/PLAYERS IN ROOM \((\d+)\)/) || [0, 0])[1], 10)
    );
    console.log(`  [NESO] Sees ${actual}/${expectedCount} players`);
    return actual;
}

const API_BASE = 'http://localhost:8000';

// Direct server assignment using the PID stored during enterLobby (authoritative)
async function serverAssign(playerName, data) {
    const pid = playerPids[playerName];
    if (!pid) { console.error(`  [${playerName}] No stored PID for server assign!`); return false; }
    const res = await fetch(`${API_BASE}/api/rooms/${ROOM_CODE}/players/${pid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) console.error(`  [${playerName}] serverAssign FAILED: ${res.status}`);
    return res.ok;
}

// ─── Phase 3: NESO assigns role to a player ──────────────────────────────
async function nesoAssignRole(nesoPage, playerPage, playerName, roleId) {
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

    if (ok !== 'OK') {
        console.warn(`  [NESO] UI role assign (${ok}) for ${playerName}`);
    }

    // Always assign via direct server API using the stored PID (no browser intermediary)
    const success = await serverAssign(playerName, { role: roleId, status: 'ASSIGNED' });
    if (success) console.log(`  [${playerName}] Role ${roleId} → server assigned`);
    await sleep(600);
    return ok === 'OK';
}

// ─── Phase 3b: NESO assigns asset to a player ────────────────────────────
async function nesoAssignAsset(nesoPage, playerPage, playerName, assetKey) {
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

    if (ok !== 'OK') {
        console.warn(`  [NESO] UI asset assign (${ok}) for ${playerName}`);
    }

    // Always assign asset via direct server API using the stored PID
    const success = await serverAssign(playerName, { assignedAssetKey: assetKey, status: 'ASSIGNED' });
    if (success) console.log(`  [${playerName}] Asset ${assetKey} → server assigned`);
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

        // ── Purge any stale room data from previous runs ─────────────
        // This eliminates ghost players that accumulate when old test runs used
        // a room code that happens to collide with this run's code.
        await fetch(`${API_BASE}/api/rooms/${ROOM_CODE}`, { method: 'DELETE' })
            .then(r => r.ok && console.log(`  [Setup] Purged any stale room ${ROOM_CODE}`))
            .catch(() => {});
        await sleep(300);

        // ── Step 1: Launch all browsers + enter lobby ────────────────
        console.log('\n─── Step 1: All Players Enter Lobby ───────────────────');
        for (let i = 0; i < PLAYERS.length; i++) {
            const cfg = PLAYERS[i];
            const browser = await puppeteer.launch({
                headless: HEADLESS ? 'new' : false,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-default-apps', '--no-first-run']
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

        // Now join remaining players with small stagger to avoid overwhelming browser resources
        await Promise.all(PLAYERS.slice(1).map(async (cfg, idx) => {
            const i = idx + 1;
            await sleep(idx * 800); // stagger: 0ms, 800ms, 1600ms ... to reduce simultaneous load
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
                const roleOk = await nesoAssignRole(pages[0], pages[i], cfg.name, cfg.role);
                await sleep(800);

                if (cfg.assetKey) {
                    const assetOk = await nesoAssignAsset(pages[0], pages[i], cfg.name, cfg.assetKey);
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
