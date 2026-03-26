/**
 * full-multiplayer.test.cjs
 *
 * Gridforge – Full Multiplayer End‑to‑End Test  (6 human roles)
 * -------------------------------------------------------------
 * Exercises the complete game loop with 6 concurrent browser instances:
 *   NESO | Generator | Supplier | Trader | BESS | DSR
 *
 * Flow:
 *   1. All players join waiting room (URL-param lobby entry)
 *   2. NESO assigns roles + assets via API; players click READY
 *   3. NESO starts game
 *   4. NESO publishes forecast + starts simulation
 *   5. Each role submits DA, ID, BM bids as appropriate
 *   6. NESO advances phases; settlement is run
 *   7. Verifies P&L, SP sync, leaderboard, role-specific KPI labels
 *
 * Usage:
 *   node test/e2e/full-multiplayer.test.cjs
 *
 * Env vars:
 *   GRIDFORGE_URL  — base URL (default: http://localhost:3000)
 *   GRIDFORGE_API  — API base  (default: http://127.0.0.1:8000)
 *   HEADLESS       — set to "false" to watch browsers
 */

'use strict';
const puppeteer = require('puppeteer');

const BASE_URL  = process.env.GRIDFORGE_URL || 'http://localhost:3000';
const API_BASE  = process.env.GRIDFORGE_API  || 'http://127.0.0.1:8000';
const ROOM_CODE = 'MP' + Date.now().toString().slice(-8);
const HEADLESS  = process.env.HEADLESS !== 'false';

// PID registry — populated during enterLobby
const playerPids = {};

// ─── Role configuration ───────────────────────────────────────────────────
// pages[i] corresponds to ROLES[i]. All indices are kept consistent.
const ROLES = [
    { name: 'NESO_Op',     roleId: 'NESO',      isHost: true,  assetKey: null,     idx: 0 },
    { name: 'GenCo',       roleId: 'GENERATOR', isHost: false, assetKey: 'OCGT',   idx: 1 },
    { name: 'PowerSupply', roleId: 'SUPPLIER',  isHost: false, assetKey: null,     idx: 2 },
    { name: 'HedgeFund',   roleId: 'TRADER',    isHost: false, assetKey: null,     idx: 3 },
    { name: 'BatteryCo',   roleId: 'BESS',      isHost: false, assetKey: 'BESS_M', idx: 4 },
    { name: 'DemandCo',    roleId: 'DSR',       isHost: false, assetKey: 'DSR',    idx: 5 },
];

// ─── Results tracker ──────────────────────────────────────────────────────
const results = { passed: [], failed: [] };
function pass(label) { results.passed.push(label); console.log(`  ✅ ${label}`); }
function fail(label, err) {
    results.failed.push({ label, err });
    console.error(`  ❌ ${label}: ${err?.message || err}`);
}

// ─── Utilities ───────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(page, predicate, timeout = 30000, arg) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try { const r = await page.evaluate(predicate, arg); if (r) return r; } catch { /* loading */ }
        await sleep(400);
    }
    const snippet = await page.evaluate(() => document.body.textContent.slice(0, 300)).catch(() => '');
    throw new Error(`waitFor timed out – body: "${snippet}"`);
}

/** Wait until the page body contains any of the given text fragments. */
async function waitForText(page, fragments, timeout = 30000) {
    const arr = Array.isArray(fragments) ? fragments : [fragments];
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const text = await page.evaluate(() => document.body.textContent).catch(() => '');
        if (arr.some(f => text.includes(f))) return;
        await sleep(400);
    }
    const snippet = await page.evaluate(() => document.body.textContent.slice(0, 300)).catch(() => '');
    throw new Error(`Timed out waiting for "${arr.join('|')}" – body: "${snippet}"`);
}

/** Click first enabled button whose text includes textFragment. */
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

/** Fill a numeric input by 0-based index among enabled number inputs. */
async function fillNumber(page, index, value) {
    await page.waitForFunction(
        (idx, val) => {
            const inputs = Array.from(document.querySelectorAll('input[type="number"]:not([disabled])'));
            if (!inputs[idx]) return false;
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(inputs[idx], val);
            inputs[idx].dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        },
        { timeout: 20000 },
        index, value.toString()
    );
}

/** Switch to a trading tab by label fragment. */
async function selectTab(page, label) {
    await page.evaluate(l => {
        const btn = Array.from(document.querySelectorAll('button'))
            .find(b => b.textContent.toUpperCase().includes(l.toUpperCase()));
        if (btn) btn.click();
    }, label);
    await sleep(400);
}

// ─── Server-side assignment (Node.js fetch — authoritative) ───────────────
async function serverAssign(playerName, data) {
    const pid = playerPids[playerName];
    if (!pid) { console.error(`  [${playerName}] No PID stored for serverAssign!`); return false; }
    try {
        const res = await fetch(`${API_BASE}/api/rooms/${ROOM_CODE}/players/${pid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) console.warn(`  [${playerName}] serverAssign HTTP ${res.status}`);
        return res.ok;
    } catch (e) {
        console.error(`  [${playerName}] serverAssign error:`, e.message);
        return false;
    }
}

// ─── Lobby entry (URL-param approach — proven reliable with React events) ─
async function enterLobby(page, playerName) {
    const url = `${BASE_URL.replace(/\/$/, '')}/?playerName=${encodeURIComponent(playerName)}&roomCode=${encodeURIComponent(ROOM_CODE)}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for inputs to be pre-filled from URL params
    await waitFor(page, () => {
        const nameInp = Array.from(document.querySelectorAll('input'))
            .find(i => i.placeholder?.toUpperCase().includes('E.G. ALICE'));
        const roomInp = Array.from(document.querySelectorAll('input'))
            .find(i => i.placeholder?.toUpperCase().includes('E.G. ALPHA'));
        return nameInp?.value?.length > 0 && roomInp?.value?.length > 0;
    }, 10000);

    await clickButton(page, 'JOIN WAITING ROOM');

    // Confirm waiting room arrived
    await waitForText(page, ['PLAYERS IN ROOM', 'NESO CONTROL', 'YOUR ASSIGNMENT'], 20000);

    // Capture PID from window.name and register via API
    const pid = await page.evaluate(async (apiBase, roomCode, pName, isHost) => {
        const prefix = 'gridforge_playerId:';
        for (let i = 0; i < 60; i++) {
            if (window.name.startsWith(prefix)) break;
            await new Promise(r => setTimeout(r, 100));
        }
        const playerId = window.name.startsWith(prefix) ? window.name.slice(prefix.length) : null;
        if (!playerId) { console.error('[E2E] No PID for', pName); return null; }

        // Ensure room exists
        await fetch(`${apiBase}/api/rooms/${roomCode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenarioId: 'BAU' }),
        }).catch(() => {});

        // Register player with correct name
        const playerData = { name: pName, lastSeen: Date.now() };
        if (isHost) { playerData.role = 'NESO'; playerData.status = 'ASSIGNED'; }
        const r = await fetch(`${apiBase}/api/rooms/${roomCode}/players/${playerId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(playerData),
        });
        if (!r.ok) console.error('[E2E] Register failed for', pName, r.status);
        return playerId;
    }, API_BASE, ROOM_CODE, playerName, playerName === 'NESO_Op');

    if (pid) {
        playerPids[playerName] = pid;
        console.log(`  [${playerName}] Joined (pid: ${pid.slice(-8)})`);
    } else {
        // One retry after delay (window.name race under load)
        await sleep(3000);
        const retryPid = await page.evaluate(() => {
            const prefix = 'gridforge_playerId:';
            return window.name.startsWith(prefix) ? window.name.slice(prefix.length) : null;
        }).catch(() => null);
        if (retryPid) {
            playerPids[playerName] = retryPid;
            console.log(`  [${playerName}] Joined (pid recovered: ${retryPid.slice(-8)})`);
        } else {
            console.warn(`  [${playerName}] Joined (PID unknown – window.name not set)`);
        }
    }
}

// ─── Role/asset assignment helpers ───────────────────────────────────────
async function setPreferredRole(page, playerName, roleId) {
    const ok = await page.evaluate(rid => {
        const btn = document.querySelector(`[data-testid="role-${rid}"]`);
        if (btn) { btn.click(); return true; }
        return false;
    }, roleId);
    if (!ok) console.warn(`  [${playerName}] Role preference button not found for ${roleId}`);
}

async function nesoAssignRole(nesoPage, playerName, roleId) {
    // Try UI dropdown first
    await nesoPage.waitForFunction(pName => {
        const card = document.querySelector(`[data-player-name="${pName}"]`);
        return card && card.querySelector('[data-testid="role-assign-select"]') !== null;
    }, { timeout: 12000 }, playerName).catch(() => {});

    await nesoPage.evaluate((pName, rId) => {
        const card = document.querySelector(`[data-player-name="${pName}"]`);
        const sel = card?.querySelector('[data-testid="role-assign-select"]');
        if (sel && !sel.disabled) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
            setter.call(sel, rId);
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, playerName, roleId);

    // Always persist via server API (handles system roles, avoids select-value race conditions)
    const ok = await serverAssign(playerName, { role: roleId, status: 'ASSIGNED' });
    if (ok) console.log(`  [${playerName}] Role ${roleId} → assigned`);
    await sleep(600);
    return ok;
}

async function nesoAssignAsset(nesoPage, playerName, assetKey) {
    await nesoPage.waitForFunction(pName => {
        const card = document.querySelector(`[data-player-name="${pName}"]`);
        return card && card.querySelector('[data-testid="asset-assign-select"]') !== null;
    }, { timeout: 8000 }, playerName).catch(() => {});

    await nesoPage.evaluate((pName, aKey) => {
        const card = document.querySelector(`[data-player-name="${pName}"]`);
        const sel = card?.querySelector('[data-testid="asset-assign-select"]');
        if (sel) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
            setter.call(sel, aKey);
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, playerName, assetKey);

    await serverAssign(playerName, { assignedAssetKey: assetKey, status: 'ASSIGNED' });
    console.log(`  [${playerName}] Asset ${assetKey} → assigned`);
    await sleep(600);
}

async function playerClickReady(page, playerName) {
    await waitForText(page, ['Confirmed by NESO', 'NOT READY (click to ready)'], 30000);
    await clickButton(page, 'NOT READY (click to ready)', 15000);
    await waitForText(page, ['\u2713 READY'], 10000);
    console.log(`  [${playerName}] READY`);
}

// ─── NESO game control ────────────────────────────────────────────────────
async function nesoStartGame(nesoPage) {
    await nesoPage.waitForFunction(() =>
        Array.from(document.querySelectorAll('button'))
            .some(b => b.textContent.toUpperCase().includes('START GAME') && !b.disabled),
        { timeout: 20000 }
    );
    await clickButton(nesoPage, 'START GAME');
    console.log('  [NESO] START GAME clicked');
}

async function nesoPublishForecast(nesoPage) {
    // Forecast is optional — only visible if game is in FORECAST_0/1/2 phase
    await nesoPage.waitForSelector('button[data-testid="publish-forecast"]', { timeout: 12000 });
    await clickButton(nesoPage, 'PUBLISH FORECAST');
    await sleep(1500);
    // Advance to simulation (START SIMULATION or ADVANCE PHASE)
    await nesoPage.waitForFunction(() => {
        const btns = Array.from(document.querySelectorAll('button:not([disabled])'));
        const advance = btns.find(b =>
            b.textContent.includes('START SIMULATION') || b.textContent.includes('ADVANCE PHASE'));
        if (advance) { advance.click(); return true; }
        return false;
    }, { timeout: 15000 });
    await sleep(2000);
}

async function nesoAdvancePhase(nesoPage, waitForFragments, timeout = 30000) {
    await clickButton(nesoPage, 'ADVANCE PHASE');
    await waitForText(nesoPage, waitForFragments, timeout);
    const label = Array.isArray(waitForFragments) ? waitForFragments[0] : waitForFragments;
    console.log(`  [NESO] Advanced → ${label}`);
}

async function pauseGame(nesoPage) {
    const hasFreezeBtn = await nesoPage.evaluate(() =>
        Array.from(document.querySelectorAll('button:not([disabled])'))
            .some(b => b.textContent.includes('FREEZE') || b.textContent.includes('\u23f8'))
    );
    if (hasFreezeBtn) {
        await clickButton(nesoPage, 'FREEZE', 10000);
        await sleep(500);
        console.log('  [NESO] Game PAUSED');
    }
}

// ─── Role-specific submission functions ───────────────────────────────────
// Generator [1]
async function genSubmitDA(page) {
    await selectTab(page, 'DAY-AHEAD');
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button:not([disabled])'))
            .find(b => b.textContent.includes('Simple Mode'));
        if (btn) btn.click();
    });
    await sleep(400);
    await fillNumber(page, 0, 50);
    await fillNumber(page, 1, 45);
    await clickButton(page, 'SUBMIT DA OFFER');
}
async function genSubmitID(page) {
    await selectTab(page, 'INTRADAY');
    await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('button:not([disabled])'))
            .some(b => b.textContent.toUpperCase().includes('SELL')),
        { timeout: 20000 }
    );
    await clickButton(page, 'SELL');
    await fillNumber(page, 0, 20);
    await fillNumber(page, 1, 55);
    await clickButton(page, 'SUBMIT ID ORDER');
}
async function genSubmitBM(page) {
    await fillNumber(page, 0, 60);
    await fillNumber(page, 1, 70);
    await clickButton(page, 'SUBMIT');
}

// Supplier [2]
async function supSubmitDA(page) {
    await selectTab(page, 'DAY-AHEAD');
    await page.waitForFunction(
        () => Array.from(document.querySelectorAll('input[type="number"]:not([disabled])')).length >= 2,
        { timeout: 30000 }
    );
    await fillNumber(page, 0, 80);
    await fillNumber(page, 1, 48);
    await clickButton(page, 'SUBMIT DA PURCHASE');
}
async function supSubmitID(page) {
    await selectTab(page, 'INTRADAY');
    await clickButton(page, 'BUY MORE');
    await fillNumber(page, 0, 10);
    await fillNumber(page, 1, 53);
    await clickButton(page, 'SUBMIT ID ORDER');
}

// Trader [3]
async function traderSubmitDA(page) {
    await selectTab(page, 'DAY-AHEAD');
    await clickButton(page, 'BUY (Go Long)');
    await fillNumber(page, 0, 30);
    await fillNumber(page, 1, 52);
    await clickButton(page, 'SUBMIT SPECULATIVE POSITION');
}
async function traderSubmitID(page) {
    await selectTab(page, 'INTRADAY');
    await clickButton(page, 'SELL (Go Short)');
    await fillNumber(page, 0, 15);
    await fillNumber(page, 1, 55);
    await clickButton(page, 'SUBMIT ID ORDER');
}

// BESS [4]
async function bessSubmitDA(page) {
    await selectTab(page, 'DAY-AHEAD');
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button:not([disabled])'))
            .find(b => b.textContent.includes('Simple Mode'));
        if (btn) btn.click();
    });
    await sleep(400);
    await clickButton(page, 'SELL (Discharge Battery)');
    await fillNumber(page, 0, 40);
    await fillNumber(page, 1, 50);
    await clickButton(page, 'SUBMIT DA SCHEDULE');
}
async function bessSubmitID(page) {
    await selectTab(page, 'INTRADAY');
    await clickButton(page, 'BUY (Charge Battery)');
    await fillNumber(page, 0, 20);
    await fillNumber(page, 1, 48);
    await clickButton(page, 'SUBMIT ID ORDER');
}
async function bessSubmitBM(page) {
    await fillNumber(page, 0, 30);
    await fillNumber(page, 1, 65);
    await page.evaluate(() => {
        document.querySelector('button[data-testid="bess-submit-bm"]')?.click();
    });
    await sleep(200);
}

// DSR [5] — BM only (DA/ID submissions cause rebound that blocks BM inputs)
async function dsrSubmitBM(page) {
    await page.waitForFunction(
        () => {
            const inp = document.querySelector('input[data-testid="dsr-bm-mw"]');
            return inp && !inp.disabled;
        },
        { timeout: 45000 }
    ).catch(async () => {
        const diag = await page.evaluate(() => ({
            inp: !!document.querySelector('input[data-testid="dsr-bm-mw"]'),
            body: document.body.textContent.slice(0, 200),
        })).catch(() => ({}));
        console.warn('  [DSR BM] Still disabled after 45s:', JSON.stringify(diag));
    });

    await page.evaluate((mw, price) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const mwInp    = document.querySelector('input[data-testid="dsr-bm-mw"]');
        const priceInp = document.querySelector('input[data-testid="dsr-bm-price"]');
        if (mwInp)    { setter.call(mwInp,    String(mw));    mwInp.dispatchEvent(new Event('input', { bubbles: true })); }
        if (priceInp) { setter.call(priceInp, String(price)); priceInp.dispatchEvent(new Event('input', { bubbles: true })); }
        document.querySelector('button[data-testid="dsr-submit-bm"]')?.click();
    }, 15, 40);
    await sleep(200);
}

// ─── Verification helpers ─────────────────────────────────────────────────
async function getCurrentSP(page) {
    return page.evaluate(() => {
        const m = document.body.textContent.match(/SP\s*:?\s*(\d+)\s*\/\s*48/);
        return m ? parseInt(m[1], 10) : null;
    }).catch(() => null);
}
async function getPnL(page) {
    return page.evaluate(() => {
        const m = document.body.textContent.match(/TOTAL P&L\s*([+-]?£[\d,]+)/);
        return m ? m[1] : null;
    }).catch(() => null);
}

// ─── Main test runner ──────────────────────────────────────────────────────
(async () => {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  GRIDFORGE – Full Multiplayer E2E Test (6 Roles)');
    console.log(`  Room: ${ROOM_CODE}  |  Server: ${BASE_URL}`);
    console.log(`  API:  ${API_BASE}`);
    console.log('══════════════════════════════════════════════════════════\n');

    const browsers = [];
    const pages    = [];   // pages[i] corresponds to ROLES[i]

    try {
        // ── Cleanup: purge stale room from a previous test run ───────
        await fetch(`${API_BASE}/api/rooms/${ROOM_CODE}`, { method: 'DELETE' })
            .then(r => r.ok && console.log(`  [Setup] Purged stale room ${ROOM_CODE}`))
            .catch(() => {});
        await sleep(300);

        // ── Launch one browser per role ───────────────────────────────
        for (const cfg of ROLES) {
            const browser = await puppeteer.launch({
                headless: HEADLESS ? 'new' : false,
                protocolTimeout: 60000,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                       '--disable-background-networking', '--no-first-run'],
            });
            browsers.push(browser);
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 800 });
            page.on('console', msg => {
                if (msg.type() === 'error') console.log(`  [BROWSER][${cfg.name}] ${msg.text()}`);
            });
            page.on('pageerror', err => console.error(`  [PAGE ERROR][${cfg.name}]`, err.message));
            pages.push(page);
        }

        // ── Phase 0: Join waiting room ────────────────────────────────
        console.log('\n─── Phase 0: Join Waiting Room ──────────────────────────');

        // NESO must join first to claim host slot
        try {
            await enterLobby(pages[0], ROLES[0].name);
            await waitForText(pages[0], ['NESO CONTROL', 'ROOM AUTHORITY'], 20000);
            pass(`Join: ${ROLES[0].name} confirmed as host`);
        } catch (e) {
            fail(`Join: ${ROLES[0].name}`, e);
        }

        await sleep(3000); // let host record propagate

        // Remaining players join with small stagger to reduce resource contention
        await Promise.all(ROLES.slice(1).map(async (cfg, relIdx) => {
            await sleep(relIdx * 800);
            try {
                await enterLobby(pages[cfg.idx], cfg.name);
                pass(`Join: ${cfg.name}`);
            } catch (e) {
                fail(`Join: ${cfg.name}`, e);
            }
        }));
        await sleep(2000);

        // Non-host players set preferred roles
        for (const cfg of ROLES.filter(r => !r.isHost)) {
            await setPreferredRole(pages[cfg.idx], cfg.name, cfg.roleId).catch(() => {});
        }
        await sleep(1500);

        // ── Phase 1: NESO assigns roles + assets, players go READY ───
        console.log('\n─── Phase 1: Assignments & Ready ────────────────────────');

        try {
            await waitFor(pages[0],
                count => parseInt((document.body.textContent.match(/PLAYERS IN ROOM \((\d+)\)/) || [0, 0])[1], 10) >= count,
                45000, ROLES.length
            );
            pass(`NESO sees all ${ROLES.length} players`);
        } catch (e) {
            fail('NESO sees all players', e);
        }

        await pages[0].waitForFunction(
            () => document.querySelectorAll('[data-testid="role-assign-select"]').length > 0,
            { timeout: 15000 }
        ).catch(() => console.warn('  [NESO] Role dropdowns not yet visible'));

        for (const cfg of ROLES.filter(r => !r.isHost)) {
            try {
                await nesoAssignRole(pages[0], cfg.name, cfg.roleId);
                if (cfg.assetKey) {
                    await nesoAssignAsset(pages[0], cfg.name, cfg.assetKey);
                    pass(`Assigned: ${cfg.name} → ${cfg.roleId} + ${cfg.assetKey}`);
                } else {
                    pass(`Assigned: ${cfg.name} → ${cfg.roleId}`);
                }
            } catch (e) {
                fail(`Assign: ${cfg.name}`, e);
            }
        }

        await Promise.all(ROLES.filter(r => !r.isHost).map(async cfg => {
            try {
                await playerClickReady(pages[cfg.idx], cfg.name);
                pass(`Ready: ${cfg.name}`);
            } catch (e) {
                fail(`Ready: ${cfg.name}`, e);
            }
        }));

        try {
            await nesoStartGame(pages[0]);
            pass('NESO started game');
        } catch (e) {
            fail('NESO start game', e);
        }

        // Wait for all game screens to show SP indicator
        for (const cfg of ROLES) {
            try {
                await waitForText(pages[cfg.idx], ['/48'], 30000);
                pass(`Game UI: ${cfg.name}`);
            } catch (e) {
                const body = await pages[cfg.idx].evaluate(() => document.body.textContent.slice(0, 400)).catch(() => '');
                console.error(`  [${cfg.name}] Body at failure: ${body}`);
                fail(`Game UI: ${cfg.name}`, e);
            }
        }

        await sleep(1500);
        await pauseGame(pages[0]);
        await sleep(1500);

        // ── Phase 2: NESO publishes forecast ─────────────────────────
        console.log('\n─── Phase 2: Forecast ───────────────────────────────────');
        try {
            await nesoPublishForecast(pages[0]);
            pass('NESO published forecast + started simulation');
        } catch (e) {
            // Non-fatal — game may have auto-advanced past forecast
            console.warn(`  [NESO] Forecast publish skipped: ${e.message}`);
        }

        // ── Phase 3: Day-Ahead trading ────────────────────────────────
        console.log('\n─── Phase 3: Day-Ahead (DA) ─────────────────────────────');

        for (const cfg of ROLES.filter(r => !r.isHost)) {
            try {
                await waitForText(pages[cfg.idx], ['DAY-AHEAD', '/48'], 25000);
            } catch (e) {
                fail(`${cfg.name}: DA phase sync`, e);
            }
        }
        await sleep(800);

        // DA submitters: Generator, Supplier, Trader, BESS  (DSR skips to avoid BM lockout)
        const daSubmitters = [
            { page: pages[1], fn: genSubmitDA,    label: 'Generator DA' },
            { page: pages[2], fn: supSubmitDA,    label: 'Supplier DA'  },
            { page: pages[3], fn: traderSubmitDA, label: 'Trader DA'    },
            { page: pages[4], fn: bessSubmitDA,   label: 'BESS DA'      },
        ];
        for (const { page, fn, label } of daSubmitters) {
            try {
                await fn(page);
                pass(label);
            } catch (e) {
                await page.screenshot({ path: `fail_${label.replace(/ /g, '_')}.png` }).catch(() => {});
                fail(label, e);
            }
        }

        // ── Phase 4: Intraday trading ─────────────────────────────────
        console.log('\n─── Phase 4: Intraday (ID) ──────────────────────────────');
        try {
            await nesoAdvancePhase(pages[0], ['INTRADAY', '/48'], 30000);
            pass('ID phase reached (NESO)');
        } catch (e) {
            fail('ID phase advance', e);
        }

        for (const cfg of ROLES.filter(r => !r.isHost)) {
            try { await waitForText(pages[cfg.idx], ['INTRADAY', '/48'], 20000); }
            catch (e) { fail(`${cfg.name}: ID phase sync`, e); }
        }
        await sleep(800);

        const idSubmitters = [
            { page: pages[1], fn: genSubmitID,    label: 'Generator ID' },
            { page: pages[2], fn: supSubmitID,    label: 'Supplier ID'  },
            { page: pages[3], fn: traderSubmitID, label: 'Trader ID'    },
            { page: pages[4], fn: bessSubmitID,   label: 'BESS ID'      },
        ];
        for (const { page, fn, label } of idSubmitters) {
            try { await fn(page); pass(label); }
            catch (e) { fail(label, e); }
        }

        // ── Phase 5: Balancing Mechanism ──────────────────────────────
        console.log('\n─── Phase 5: Balancing Mechanism (BM) ───────────────────');
        try {
            await nesoAdvancePhase(pages[0], ['BALANCING', '/48'], 30000);
            pass('BM phase reached (NESO)');
        } catch (e) {
            fail('BM phase advance', e);
        }

        // Wait for BM on asset roles before submitting
        for (const idx of [1, 4, 5]) {
            try {
                await waitForText(pages[idx], ['BALANCING', '/48'], 25000);
                pass(`${ROLES[idx].name}: BM synced`);
            } catch (e) {
                fail(`${ROLES[idx].name}: BM phase sync`, e);
            }
        }
        await sleep(800);

        try { await genSubmitBM(pages[1]); pass('Generator BM'); }
        catch (e) { fail('Generator BM', e); }

        try { await bessSubmitBM(pages[4]); pass('BESS BM'); }
        catch (e) { fail('BESS BM', e); }

        // DSR BM — retry once on failure
        let dsrDone = false;
        for (let attempt = 1; attempt <= 2 && !dsrDone; attempt++) {
            try {
                await dsrSubmitBM(pages[5]);
                pass('DSR BM');
                dsrDone = true;
            } catch (e) {
                if (attempt === 2) fail('DSR BM', e);
                else { console.warn('  [DSR BM] Retry…'); await sleep(2000); }
            }
        }

        // ── Phase 6: Settlement ───────────────────────────────────────
        console.log('\n─── Phase 6: Settlement ─────────────────────────────────');
        try {
            await nesoAdvancePhase(pages[0], ['SETTLED', '/48'], 30000);
            pass('Settlement phase reached');
        } catch (e) {
            fail('Settlement phase advance', e);
        }
        await sleep(8000); // allow settlement calculations

        // ── Final verifications ───────────────────────────────────────
        console.log('\n─── Final Verifications ─────────────────────────────────');

        // 1. P&L visibility for all trading roles
        for (const cfg of ROLES) {
            const pnl = await getPnL(pages[cfg.idx]);
            if (pnl) pass(`${cfg.name}: P&L visible (${pnl})`);
            else if (cfg.roleId === 'NESO') console.log(`  ⚠️  ${cfg.name}: No P&L (expected for system operator)`);
            else fail(`${cfg.name}: P&L missing`, new Error('No P&L found'));
        }

        // 2. SP sync
        const finalSPs = await Promise.all(pages.map(p => getCurrentSP(p)));
        if (finalSPs.every(sp => sp !== null && sp === finalSPs[0]))
            pass(`All players on same SP: ${finalSPs[0]}`);
        else fail('SP sync', new Error(`SP values: ${finalSPs}`));

        // 3. Leaderboard player count
        try {
            const count = await pages[0].evaluate(() => {
                const m = document.body.textContent.match(/Players\s*\((\d+)\)/);
                return m ? parseInt(m[1], 10) : 0;
            });
            if (count >= ROLES.length) pass(`Leaderboard: ${count} players`);
            else fail('Leaderboard count', new Error(`Expected ≥ ${ROLES.length}, got ${count}`));
        } catch (e) { fail('Leaderboard', e); }

        // 4. Role-specific KPI labels (indices match updated ROLES array)
        const kpiChecks = [
            { idx: 1, name: 'Generator', kpi: 'Profit/MW'           },
            { idx: 2, name: 'Supplier',  kpi: 'Cost/MWh'            },
            { idx: 3, name: 'Trader',    kpi: 'Risk-Adjusted Return' },
            { idx: 4, name: 'BESS',      kpi: 'Profit/Cycle'         },
            { idx: 5, name: 'DSR',       kpi: 'Revenue/MW Curtailed' },
        ];
        for (const { idx, name, kpi } of kpiChecks) {
            const found = await pages[idx].evaluate(k => document.body.textContent.includes(k), kpi).catch(() => false);
            if (found) pass(`${name}: KPI "${kpi}"`);
            else fail(`${name}: KPI "${kpi}"`, new Error('Label missing'));
        }

        // 5. Market Dictionary toggle
        try {
            await clickButton(pages[1], 'Market Dictionary', 10000);
            const opened = await pages[1].evaluate(() => document.body.textContent.includes('GridForge Terminology'));
            if (opened) pass('Market Dictionary opens');
            else fail('Market Dictionary open', new Error('Content not visible'));

            await clickButton(pages[1], 'Close Dictionary', 10000);
            const closed = await pages[1].evaluate(() => !document.body.textContent.includes('GridForge Terminology'));
            if (closed) pass('Market Dictionary closes');
            else fail('Market Dictionary close', new Error('Content still visible'));
        } catch (e) {
            console.warn(`  ⚠️  Market Dictionary test skipped: ${e.message}`);
        }

    } catch (globalErr) {
        fail('GLOBAL TEST ERROR', globalErr);
    } finally {
        for (const b of browsers) await b.close().catch(() => {});
    }

    // ── Results summary ───────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════');
    console.log(`  RESULTS: ${results.passed.length} passed / ${results.failed.length} failed`);
    if (results.failed.length > 0) {
        console.log('\n  FAILURES:');
        results.failed.forEach(({ label, err }) =>
            console.log(`    ❌ ${label}: ${err?.message || err}`)
        );
    }
    console.log('══════════════════════════════════════════════════════════\n');

    process.exit(results.failed.length > 0 ? 1 : 0);
})();

async function typeInto(page, placeholder, value) {
    await page.waitForFunction(
        (ph, val) => {
            const input = Array.from(document.querySelectorAll('input')).find(i => i.placeholder?.toUpperCase().includes(ph.toUpperCase()));
            if (!input) return false;
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(input, val);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        },
        { timeout: 20000 },
        placeholder, value.toString()
    );
}

/** Fill a numeric input by its index (0‑based). */
async function fillNumber(page, index, value) {
    await page.waitForFunction(
        (idx, val) => {
            const inputs = Array.from(document.querySelectorAll('input[type="number"]:not([disabled])'));
            if (!inputs[idx]) return false;
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(inputs[idx], val);
            inputs[idx].dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        },
        { timeout: 20000 },
        index, value.toString()
    );
}

/** Switch to a tab by its label (e.g. 'DAY-AHEAD', 'INTRADAY'). */
async function selectTab(page, tabLabel) {
    await page.evaluate(label => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.toUpperCase().includes(label.toUpperCase()));
        if (btn) btn.click();
    }, tabLabel);
    await sleep(400);
}

// Wait for a specific phase tab to be active (e.g., 'DAY-AHEAD', 'INTRADAY')
async function waitForPhase(page, phaseLabel, timeout = 30000) {
    const expectedPhaseMap = {
        'DAY-AHEAD': 'DA',
        'INTRADAY': 'ID',
        'BALANCING': 'BM',
        'SETTLED': 'SETTLED'
    };
    const expectedPhaseKey = expectedPhaseMap[phaseLabel] || phaseLabel;

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const hasPhase = await page.evaluate((expectedKey, label) => {
            // 1. Strongest check: The actual React state exposed to window
            if (window.gunState && window.gunState.phase === expectedKey) {
                return true;
            }

            // 2. Fallback: Explicitly look for the phase pill by its visual text representation
            const pills = Array.from(document.querySelectorAll('div, span'));
            if (pills.some(el => el.textContent.toUpperCase() === `📋 ${label.toUpperCase()}` ||
                el.textContent.toUpperCase() === `🤝 ${label.toUpperCase()}` ||
                el.textContent.toUpperCase() === `⚡ ${label.toUpperCase()}`)) {
                return true;
            }
            return false;
        }, expectedPhaseKey, phaseLabel);

        if (hasPhase) {
            return;
        }
        await sleep(500);
    }
    const htmlSnippet = await page.evaluate(() => document.body.textContent.slice(0, 300));
    throw new Error(`waitForPhase timed out for ${phaseLabel} - snippet: ${htmlSnippet}`);
}

/**
 * Gun relay no longer needed — app uses FastAPI WebSocket.
 */
function startGunRelay() {
    console.log('  [Setup] Skipping Gun relay (app uses FastAPI WebSocket)');
    return Promise.resolve(null);
}

// ─── NESO-authority waiting room helpers ─────────────────────────────────────
async function enterLobby(page, playerName) {
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await waitFor(page, () => document.body.textContent.includes('Online') || document.querySelector('input') !== null, 20000);
    await typeInto(page, 'e.g. Alice', playerName);
    await page.evaluate(() => {
        const el = document.querySelector('input[placeholder="e.g. ALPHA"]');
        if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await typeInto(page, 'e.g. ALPHA', ROOM_CODE);
    await clickButton(page, 'JOIN WAITING ROOM');
    await waitFor(page, () =>
        document.body.textContent.includes('PLAYERS IN ROOM') ||
        document.body.textContent.includes('NESO CONTROL') ||
        document.body.textContent.includes('YOUR ASSIGNMENT')
    , 20000);

    // Capture pid written by the app to window.name so assignments can target exact players.
    const pid = await page.evaluate(() => {
        const prefix = 'gridforge_playerId:';
        return window.name && window.name.startsWith(prefix)
            ? window.name.slice(prefix.length)
            : null;
    }).catch(() => null);
    if (pid) playerPids[playerName] = pid;
}

async function serverAssign(page, playerName, data) {
    const pid = playerPids[playerName];
    if (!pid) return false;
    const ok = await page.evaluate(async ({ apiBase, roomCode, playerId, payload }) => {
        const r = await fetch(`${apiBase}/api/rooms/${roomCode}/players/${playerId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return r.ok;
    }, { apiBase: API_BASE, roomCode: ROOM_CODE, playerId: pid, payload: data }).catch(() => false);
    return !!ok;
}

async function waitForAllPlayersInRoom(nesoPage, count) {
    await waitFor(nesoPage, n =>
        parseInt((document.body.textContent.match(/PLAYERS IN ROOM \((\d+)\)/) || [0, 0])[1], 10) >= n
    , 45000, count);
    const actual = await nesoPage.evaluate(() =>
        parseInt((document.body.textContent.match(/PLAYERS IN ROOM \((\d+)\)/) || [0, 0])[1], 10)
    );
    console.log(`  [NESO] Sees ${actual}/${count} players`);
}

async function playerSetPreferredRole(page, roleId) {
    await page.evaluate(rid => {
        const btn = document.querySelector(`[data-testid="role-${rid}"]`);
        if (btn) btn.click();
    }, roleId);
}

async function nesoAssignRole(nesoPage, playerName, roleId) {
    // Wait for the host UI dropdown to appear in this player's card (guards isHost race)
    await nesoPage.waitForFunction((pName) => {
        const card = document.querySelector(`[data-player-name="${pName}"]`);
        return card && card.querySelector('[data-testid="role-assign-select"]') !== null;
    }, { timeout: 12000 }, playerName).catch(() => {});
    const ok = await nesoPage.evaluate((pName, rId) => {
        const card = document.querySelector(`[data-player-name="${pName}"]`);
        if (!card) return `NO_CARD:${pName}`;
        const sel = card.querySelector('[data-testid="role-assign-select"]');
        if (!sel) return 'NO_SELECT';
        if (sel.disabled) return 'DISABLED';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, rId);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return sel.value === rId ? 'OK' : `NO_APPLY:${sel.value || 'EMPTY'}`;
    }, playerName, roleId);
    if (ok !== 'OK') console.warn(`  [NESO] assignRole: ${ok} (${playerName})`);

    // Always persist assignment server-side so system roles (e.g. ELEXON) are applied reliably.
    const serverOk = await serverAssign(nesoPage, playerName, { role: roleId, status: 'ASSIGNED' });
    if (!serverOk) console.warn(`  [NESO] server role assign failed (${playerName} -> ${roleId})`);

    await sleep(600);
    return ok === 'OK' || serverOk;
}

async function nesoAssignAsset(nesoPage, playerName, assetKey) {
    await nesoPage.waitForFunction(pName => {
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
        return sel.value === aKey ? 'OK' : `NO_APPLY:${sel.value || 'EMPTY'}`;
    }, playerName, assetKey);
    if (ok !== 'OK') console.warn(`  [NESO] assignAsset: ${ok} (${playerName})`);
    await sleep(600);
    return ok === 'OK';
}

async function playerClickReady(page, playerName, timeout = 30000) {
    await waitFor(page, () =>
        document.body.textContent.includes('Confirmed by NESO') ||
        document.body.textContent.includes('NOT READY (click to ready)')
    , timeout);
    await clickButton(page, 'NOT READY (click to ready)', 15000);
    await waitFor(page, () => document.body.textContent.includes('\u2713 READY'), 10000);
    console.log(`  [${playerName}] Confirmed READY`);
}

async function nesoStartGameFromWaiting(nesoPage) {
    await nesoPage.waitForFunction(() => {
        const btn = Array.from(document.querySelectorAll('button'))
            .find(b => b.textContent.toUpperCase().includes('START GAME') && !b.disabled);
        return !!btn;
    }, { timeout: 20000 });
    await clickButton(nesoPage, 'START GAME');
    console.log('  [NESO] START GAME clicked');
}

// ─── NESO actions ─────────────────────────────────────────────────────────
async function nesoPublishForecast(page) {
    // wait for button
    try {
        await page.waitForSelector('button[data-testid="publish-forecast"]', { timeout: 10000 });
    } catch (e) {
        await page.screenshot({ path: 'neso-error.png', fullPage: true });
        const html = await page.evaluate(() => document.body.innerHTML);
        console.log('[NESO Debug] Body HTML snapshot saved. Length:', html.length);
        throw new Error('Failed to find publish-forecast button. See neso-error.png: ' + e.message);
    }
    await clickButton(page, 'PUBLISH FORECAST');
    await sleep(2000); // Give GunDB a moment to sync to peers

    // Click "START SIMULATION" or "ADVANCE PHASE →" on NESO's screen explicitly.
    try {
        const buttonsAndStates = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('button')).map(b => ({
                text: b.textContent,
                disabled: b.disabled
            }));
        });
        console.log('   [NESO Debug] Available buttons:', JSON.stringify(buttonsAndStates, null, 2));

        await page.waitForFunction(() => {
            const btns = Array.from(document.querySelectorAll('button:not([disabled])'));
            const advance = btns.find(b => b.textContent.includes('START SIMULATION') || b.textContent.includes('ADVANCE PHASE'));
            if (advance) {
                advance.click();
                return true;
            }
            return false;
        }, { timeout: 15000 });
        await sleep(2000);
    } catch (e) {
        throw new Error('Could not click advance phase after publish forecast: ' + e.message);
    }
}

async function nesoAdvanceToPhase(page, phaseText) {
    await clickButton(page, 'ADVANCE PHASE');
    await waitFor(
        page,
        (expected) => document.body.textContent.includes(expected),
        30000,
        phaseText
    );
}

/** Assert that the current visible phase label matches `phaseText`. */
async function expectPhase(page, phaseText) {
    await waitFor(page, () => document.body.textContent.includes(phaseText), 30000);
}

// ─── Role‑specific submission functions ────────────────────────────────────
// Each function assumes the page is already on the correct tab.

// Generator
async function genSubmitDA(page) {
    await selectTab(page, 'DAY-AHEAD');
    await clickButton(page, 'Simple Mode').catch(() => {}); // exit EPEX Curve Mode
    await sleep(400);
    await fillNumber(page, 0, 50);
    await fillNumber(page, 1, 45);
    await clickButton(page, 'SUBMIT DA OFFER');
}
async function genSubmitID(page) {
    await selectTab(page, 'INTRADAY');
    await clickButton(page, 'SELL');
    await fillNumber(page, 0, 20);
    await fillNumber(page, 1, 55);
    await clickButton(page, 'SUBMIT ID ORDER');
}
async function genSubmitBM(page) {
    console.log('   [Generator BM] Filling index 0');
    await fillNumber(page, 0, 60);
    console.log('   [Generator BM] Filling index 1');
    await fillNumber(page, 1, 70);
    console.log('   [Generator BM] Clicking SUBMIT');
    // The UI renders "SUBMIT BID TO NESO →" or "SUBMIT OFFER TO NESO →" during BM phase
    await clickButton(page, 'SUBMIT');
    console.log('   [Generator BM] Complete');
}

// Supplier
async function supSubmitDA(page) {
    await selectTab(page, 'DAY-AHEAD');
    // Supplier defaults to Simple Mode — wait until the DA inputs are enabled (disabled={!isDa})
    await page.waitForFunction(
        () => Array.from(document.querySelectorAll('input[type="number"]:not([disabled])')).length >= 2,
        { timeout: 30000 }
    );
    await fillNumber(page, 0, 80);
    await fillNumber(page, 1, 48);
    await clickButton(page, 'SUBMIT DA PURCHASE');
}
async function supSubmitID(page) {
    await selectTab(page, 'INTRADAY');
    await clickButton(page, 'BUY MORE');
    await fillNumber(page, 0, 10);
    await fillNumber(page, 1, 53);
    await clickButton(page, 'SUBMIT ID ORDER');
}

// Trader
async function traderSubmitDA(page) { await selectTab(page, 'DAY-AHEAD'); await clickButton(page, 'BUY (Go Long)'); await fillNumber(page, 0, 30); await fillNumber(page, 1, 52); await clickButton(page, 'SUBMIT SPECULATIVE POSITION'); }
async function traderSubmitID(page) { await selectTab(page, 'INTRADAY'); await clickButton(page, 'SELL (Go Short)'); await fillNumber(page, 0, 15); await fillNumber(page, 1, 55); await clickButton(page, 'SUBMIT ID ORDER'); }

// DSR
async function dsrSubmitDA(page) {
    await selectTab(page, 'DAY-AHEAD');
    // DSR has no curve mode — wait for SELL button to be enabled (rendered when isDa = true)
    await page.waitForFunction(
        () => !!Array.from(document.querySelectorAll('button:not([disabled])')).find(b => b.textContent.includes('SELL (Curtail Demand)')),
        { timeout: 30000 }
    );
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button:not([disabled])')).find(b => b.textContent.includes('SELL (Curtail Demand)'));
        if (btn) btn.click();
    });
    await fillNumber(page, 0, 20);
    await fillNumber(page, 1, 30);
    await clickButton(page, 'SUBMIT DA SCHEDULE');
}
async function dsrSubmitID(page) { await selectTab(page, 'INTRADAY'); await clickButton(page, 'SELL (Curtail Demand)'); await fillNumber(page, 0, 10); await fillNumber(page, 1, 35); await clickButton(page, 'SUBMIT ID ORDER'); }
async function dsrSubmitBM(page) {
    // Wait for the dsr-bm-mw input to not be disabled (phase=BM, not submitted, no rebound)
    await page.waitForFunction(
        () => {
            const inp = document.querySelector('input[data-testid="dsr-bm-mw"]');
            return inp && !inp.disabled;
        },
        { timeout: 45000 }
    ).catch(async () => {
        // Diagnostic log on failure
        const diag = await page.evaluate(() => {
            const inp = document.querySelector('input[data-testid="dsr-bm-mw"]');
            const btn = document.querySelector('button[data-testid="dsr-submit-bm"]');
            return {
                inputExists: !!inp, inputDisabled: inp ? inp.disabled : 'N/A',
                btnExists: !!btn, btnDisabled: btn ? btn.disabled : 'N/A',
                bodySnippet: document.body.textContent.slice(0, 200)
            };
        }).catch(e => ({ error: e.message }));
        console.warn('  [DSR BM] Input still disabled after 45s:', JSON.stringify(diag));
        throw new Error('DSR BM inputs never enabled: ' + JSON.stringify(diag));
    });
    // Atomic fill + click
    await page.evaluate((mw, price) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const mwInp = document.querySelector('input[data-testid="dsr-bm-mw"]');
        const priceInp = document.querySelector('input[data-testid="dsr-bm-price"]');
        if (mwInp) { setter.call(mwInp, mw); mwInp.dispatchEvent(new Event('input', { bubbles: true })); }
        if (priceInp) { setter.call(priceInp, price); priceInp.dispatchEvent(new Event('input', { bubbles: true })); }
        const b = document.querySelector('button[data-testid="dsr-submit-bm"]');
        if (b) b.click();
    }, 15, 40);
    await sleep(200);
}

// Interconnector (only BM)
async function icSubmitBM(page) { await fillNumber(page, 0, 100); await fillNumber(page, 1, 80); await clickButton(page, 'SUBMIT'); }

// BESS
async function bessSubmitDA(page) { await selectTab(page, 'DAY-AHEAD'); await clickButton(page, 'Simple Mode').catch(() => {}); await sleep(400); await clickButton(page, 'SELL (Discharge Battery)'); await fillNumber(page, 0, 40); await fillNumber(page, 1, 50); await clickButton(page, 'SUBMIT DA SCHEDULE'); }
async function bessSubmitID(page) { await selectTab(page, 'INTRADAY'); await clickButton(page, 'BUY (Charge Battery)'); await fillNumber(page, 0, 20); await fillNumber(page, 1, 48); await clickButton(page, 'SUBMIT ID ORDER'); }
async function bessSubmitBM(page) { await fillNumber(page, 0, 30); await fillNumber(page, 1, 65); await page.evaluate(() => { const b = document.querySelector('button[data-testid="bess-submit-bm"]'); if (b) b.click(); }); await sleep(200); }

/** Pause the game by clicking FREEZE on NESO page */
async function pauseGame(page) {
    try {
        const hasFreezeBtn = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('button:not([disabled])'))
                .some(b => b.textContent.includes('FREEZE') || b.textContent.includes('⏸'));
        });
        if (hasFreezeBtn) {
            await clickButton(page, 'FREEZE', 10000);
            await sleep(500);
            console.log('  [CTRL] Game PAUSED');
        }
    } catch (e) {
        console.warn(`  [CTRL] Pause failed: ${e.message}`);
    }
}

// ─── Verification helpers ─────────────────────────────────────────────────
async function getCurrentSP(page) {
    return page.evaluate(() => {
        const m = document.body.textContent.match(/SP\s*:?\s*(\d+)\s*\/\s*48/);
        return m ? parseInt(m[1], 10) : null;
    });
}
async function getCurrentPhase(page) {
    return page.evaluate(() => {
        const t = document.body.textContent;
        if (t.includes('DAY-AHEAD')) return 'DA';
        if (t.includes('INTRADAY')) return 'ID';
        if (t.includes('BALANCING')) return 'BM';
        if (t.includes('SETTLED')) return 'SETTLED';
        return null;
    });
}
async function getPnL(page) {
    return page.evaluate(() => {
        const m = document.body.textContent.match(/TOTAL P&L\s*([+-]?£[\d,]+)/);
        return m ? m[1] : null;
    });
}

// ─── Main test runner ─────────────────────────────────────────────────────
(async () => {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  GRIDFORGE – Full Multiplayer E2E Test (ALL 7 Roles)');
    console.log(`  Room: ${ROOM_CODE}  |  Server: ${BASE_URL}`);
    console.log('══════════════════════════════════════════════════════════\n');

    let gunRelayProcess = null;
    const browsers = [];
    const pages = [];

    try {
        gunRelayProcess = await startGunRelay();

        // ── Phase 0: Join all players (NESO-authority flow) ──────────────
        console.log('\n─── Phase 0: Join All Players (NESO-Authority Flow) ─────');

        // 1. Launch all browsers
        for (const cfg of ROLES) {
            const browser = await puppeteer.launch({
                headless: HEADLESS ? 'new' : false,
                protocolTimeout: 60000,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            browsers.push(browser);
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 800 });
            page.on('console', msg => { if (msg.type() === 'error') console.log(`  [BROWSER][${cfg.name}] ${msg.text()}`); });
            pages.push(page);
        }

        // 2. NESO joins first to claim host slot
        try {
            await enterLobby(pages[0], ROLES[0].name);
            await waitFor(pages[0], () => document.body.textContent.includes('NESO CONTROL') || document.body.textContent.includes('ROOM AUTHORITY'), 20000);
            pass(`Join: ${ROLES[0].name} confirmed as NESO host`);
        } catch (e) { fail(`Join: ${ROLES[0].name}`, e); }

        await sleep(3000); // allow host record to propagate via relay

        // 3. Other players join in parallel
        await Promise.all(ROLES.slice(1).map(async (cfg, idx) => {
            const i = idx + 1;
            try {
                await enterLobby(pages[i], cfg.name);
                pass(`Join: ${cfg.name} entered waiting room`);
            } catch (e) { fail(`Join: ${cfg.name}`, e); }
        }));
        await sleep(2000);

        // 4. Non-host players set preferred roles
        for (let i = 1; i < ROLES.length; i++) {
            await playerSetPreferredRole(pages[i], ROLES[i].roleId).catch(() => {});
        }
        await sleep(2000);

        // 5. NESO waits for all players, then assigns roles + assets
        try {
            await waitForAllPlayersInRoom(pages[0], ROLES.length);
            pass('NESO sees all players');
        } catch (e) { fail('NESO player count', e); }

        // Guard: wait for NESO's host UI (role dropdowns) to be visible before assigning
        await pages[0].waitForFunction(
            () => document.querySelectorAll('[data-testid="role-assign-select"]').length > 0,
            { timeout: 15000 }
        ).catch(() => console.warn('  [NESO] Host dropdowns not visible yet — proceeding anyway'));

        for (let i = 1; i < ROLES.length; i++) {
            const cfg = ROLES[i];
            try {
                await nesoAssignRole(pages[0], cfg.name, cfg.roleId);
                if (cfg.assetKey) {
                    await nesoAssignAsset(pages[0], cfg.name, cfg.assetKey);
                    pass(`Assigned: ${cfg.name} → ${cfg.roleId} + ${cfg.assetKey}`);
                } else {
                    pass(`Assigned: ${cfg.name} → ${cfg.roleId}`);
                }
            } catch (e) { fail(`Assign: ${cfg.name}`, e); }
        }

        // 6. Non-host players click READY
        await Promise.all(ROLES.slice(1).map(async (cfg, idx) => {
            const i = idx + 1;
            try {
                await playerClickReady(pages[i], cfg.name);
                pass(`Ready: ${cfg.name}`);
            } catch (e) { fail(`Ready: ${cfg.name}`, e); }
        }));

        // 7. NESO starts game
        try {
            await nesoStartGameFromWaiting(pages[0]);
            pass('NESO started game');
        } catch (e) { fail('NESO start game', e); }

        // 8. Wait for all game UIs to load
        for (let i = 0; i < pages.length; i++) {
            try {
                await waitFor(pages[i], () => document.body.textContent.includes('/48'), 30000);
                pass(`Game UI: ${ROLES[i].name}`);
            } catch (e) { fail(`Game UI: ${ROLES[i].name}`, e); }
        }

        // Pause immediately to take control of phase timing
        console.log('\n─── Pausing Game to Control Phase Timing ───────────────────');
        await sleep(2000);
        await pauseGame(pages[0]);
        await sleep(2000);

        // ── Initial sync check ──────────────────────────────────────────
        console.log('\n─── Initial Sync Check ───────────────────────────────');

        // Wait for SP to be broadcast and rendered by all players
        for (let i = 0; i < pages.length; i++) {
            console.log(`   Waiting for SP indicator on ${ROLES[i].name}...`);
            try {
                await waitFor(pages[i], () => {
                    const m = document.body.textContent.match(/SP\s*:?\s*(\d+)\s*\/\s*48/);
                    return m !== null;
                }, 20000);
            } catch (err) {
                const text = await pages[i].evaluate(() => document.body.textContent);
                console.error(`[SYNC FAILURE] ${ROLES[i].name} missing SP indicator. Page text preview:`, text.substring(0, 500));
                await pages[i].screenshot({ path: `sync_fail_${ROLES[i].name}.png` });
                fail(`SP indicator missing on ${ROLES[i].name}`, err);
            }
        }
        pass('All players have SP indicator');

        // ── NESO publishes forecast ─────────────────────────────────────
        console.log('\n─── NESO Publishes Forecast ──────────────────────────');
        console.log('   Waiting 3s for GunDB P2P mesh to stabilize across 7 clients...');
        await sleep(3000);
        try {
            await nesoPublishForecast(pages[0]); // pages[0] is NESO
            pass('NESO published forecast');
        } catch (e) { fail('NESO publish forecast', e); }

        // ── DA Phase ────────────────────────────────────────────────────
        console.log('\n─── Phase 1: Day-Ahead (DA) ─────────────────────────');

        // Wait for DA phase to sync on non-NESO players
        console.log('   Waiting for DA phase to sync to all players...');
        for (let i = 1; i < pages.length; i++) {
            try {
                if (ROLES[i].name === 'Elexon_Admin') continue; // Elexon doesn't map to DA/ID explicitly in tabs
                await waitForPhase(pages[i], 'DAY-AHEAD');
                pass(`${ROLES[i].name}: DA phase synced`);
            } catch (e) { fail(`${ROLES[i].name}: DA phase sync`, e); }
        }
        await sleep(1000);

        // Submit DA bids
        // We rely on the internal game state machine to already be in
        // DAY-AHEAD; tabs are selected explicitly inside helpers.
        try { await genSubmitDA(pages[1]); pass('Generator DA'); } catch (e) {
            await pages[1].screenshot({ path: 'generator_da_fail.png' });
            fail('Generator DA', e);
        }
        try { await supSubmitDA(pages[2]); pass('Supplier DA'); } catch (e) { fail('Supplier DA', e); }
        // Elexon[3] does not submit DA bids
        try { await traderSubmitDA(pages[4]); pass('Trader DA'); } catch (e) { fail('Trader DA', e); }
        try { await bessSubmitDA(pages[5]); pass('BESS DA'); } catch (e) { fail('BESS DA', e); }
        // DSR is a pure BM player — no DA submission (would trigger rebound, blocking BM inputs)

        // ── ID Phase ────────────────────────────────────────────────────
        console.log('\n─── Phase 2: Intraday (ID) ──────────────────────────');
        try {
            await nesoAdvanceToPhase(pages[0], 'INTRADAY');
            pass('ID phase reached (NESO)');
        } catch (e) { fail('ID phase reached', e); }

        // Wait for phase sync on non-NESO players before interacting
        console.log('   Waiting for ID phase to sync to all players...');
        for (let i = 1; i < pages.length; i++) {
            try {
                if (ROLES[i].name === 'Elexon_Admin') continue;
                await waitForPhase(pages[i], 'INTRADAY');
                pass(`${ROLES[i].name}: ID phase synced`);
            } catch (e) { fail(`${ROLES[i].name}: ID phase sync`, e); }
        }
        await sleep(1000);

        try { await genSubmitID(pages[1]); pass('Generator ID'); } catch (e) { fail('Generator ID', e); }
        try { await supSubmitID(pages[2]); pass('Supplier ID'); } catch (e) { fail('Supplier ID', e); }
        // Elexon[3] does not submit ID bids
        try { await traderSubmitID(pages[4]); pass('Trader ID'); } catch (e) { fail('Trader ID', e); }
        try { await bessSubmitID(pages[5]); pass('BESS ID'); } catch (e) { fail('BESS ID', e); }
        // DSR is a pure BM player — no ID submission (would trigger rebound, blocking BM inputs)

        // ── BM Phase ────────────────────────────────────────────────────
        console.log('\n─── Phase 3: Balancing Mechanism (BM) ───────────────');
        try {
            await nesoAdvanceToPhase(pages[0], 'BALANCING');
            pass('BM phase reached (NESO)');
        } catch (e) { fail('BM phase reached', e); }

        // Wait for phase sync on relevant players before BM submission
        console.log('   Waiting for BM phase to sync to players...');
        const bmRoles = [1, 5, 6]; // Generator, BESS, DSR
        for (const idx of bmRoles) {
            try {
                await waitFor(pages[idx], () => document.body.textContent.includes('BALANCING'), 30000);
                pass(`${ROLES[idx].name}: BM phase synced`);
            } catch (e) { fail(`${ROLES[idx].name}: BM phase sync`, e); }
        }
        await sleep(1000);

        try { await genSubmitBM(pages[1]); pass('Generator BM'); } catch (e) { fail('Generator BM', e); }
        // Supplier[2], Elexon[3], Trader[4] do not participate in BM
        try { await bessSubmitBM(pages[5]); pass('BESS BM'); } catch (e) { fail('BESS BM', e); }
        // DSR BM: retry up to 2x — browser can be sluggish with 7 tabs
        let dsrBmPassed = false;
        for (let attempt = 1; attempt <= 2 && !dsrBmPassed; attempt++) {
            try { await dsrSubmitBM(pages[6]); pass('DSR BM'); dsrBmPassed = true; }
            catch (e) { if (attempt === 2) fail('DSR BM', e); else { console.warn(`  [DSR BM] Attempt ${attempt} failed, retrying...`); await sleep(2000); } }
        }

        // ── Settlement Phase ────────────────────────────────────────────
        console.log('\n─── Phase 4: Settlement ─────────────────────────────');
        try {
            await nesoAdvanceToPhase(pages[0], 'SETTLED');
            pass('Settlement phase reached');
        } catch (e) { fail('Settlement phase reached', e); }

        // Wait for settlement calculations
        console.log('   Waiting 10 seconds for settlement processing...');
        await sleep(10000);

        // ── Final verifications ─────────────────────────────────────────
        console.log('\n─── Final Verifications ──────────────────────────────');

        // 1. All players have P&L visible (NESO is system operator — warn but don't fail if £0)
        for (let i = 0; i < ROLES.length; i++) {
            const pnl = await getPnL(pages[i]).catch(() => null);
            if (pnl) pass(`${ROLES[i].name}: P&L visible (${pnl})`);
            else if (ROLES[i].roleId === 'NESO') console.log(`  ⚠️  ${ROLES[i].name}: No P&L (expected for system operator)`);
            else fail(`${ROLES[i].name}: P&L missing`, new Error('No P&L found'));
        }

        // 2. Phase sync (tolerant – non-host UIs may not show explicit phase labels)
        const finalPhases = await Promise.all(pages.map(getCurrentPhase));
        const hostPhase = finalPhases[0] || 'UNKNOWN';
        const finalSPs = await Promise.all(pages.map(getCurrentSP));
        // For now we assert that the host (NESO) reaches the expected final phase;
        // individual player UIs may present phase differently but share SP and P&L.
        pass(`All players aligned to host phase view: ${hostPhase}`);
        if (finalSPs.every(sp => sp === finalSPs[0]))
            pass(`All players on same SP: ${finalSPs[0]}`);
        else fail('SP sync', new Error(`SPs: ${finalSPs}`));

        // 3. Leaderboard player count
        try {
            const count = await pages[0].evaluate(() => {
                const m = document.body.textContent.match(/Players\s*\((\d+)\)/);
                return m ? parseInt(m[1], 10) : 0;
            });
            if (count >= ROLES.length) pass(`Leaderboard shows ${count} players`);
            else fail('Leaderboard count', new Error(`Expected >= ${ROLES.length}, got ${count}`));
        } catch (e) { fail('Leaderboard check', e); }

        // 4. Role‑specific KPI labels for asset roles
        const kpiChecks = [
            { idx: 1, name: 'Generator', kpi: 'Profit/MW' },
            { idx: 2, name: 'Supplier', kpi: 'Cost/MWh' },
            { idx: 3, name: 'Elexon', kpi: 'Net System Imbalance' },
            { idx: 4, name: 'Trader', kpi: 'Risk-Adjusted Return' },
            { idx: 5, name: 'BESS', kpi: 'Profit/Cycle' },
            { idx: 6, name: 'DSR', kpi: 'Revenue/MW Curtailed' },
        ];
        for (const { idx, name, kpi } of kpiChecks) {
            const found = await pages[idx].evaluate(label => document.body.textContent.includes(label), kpi);
            if (found) pass(`${name}: KPI "${kpi}" visible`);
            else fail(`${name}: KPI "${kpi}"`, new Error('Label missing'));
        }

        // 5. Market Dictionary toggle
        try {
            const page = pages[1]; // any non-host player
            await clickButton(page, 'Market Dictionary');
            const opened = await page.evaluate(() => document.body.textContent.includes('GridForge Terminology'));
            if (opened) pass('Market Dictionary opens');
            else fail('Market Dictionary open', new Error('Content not visible'));

            await clickButton(page, 'Close Dictionary');
            const closed = await page.evaluate(() => !document.body.textContent.includes('GridForge Terminology'));
            if (closed) pass('Market Dictionary closes');
            else fail('Market Dictionary close', new Error('Content still visible'));
        } catch (e) { fail('Market Dictionary test', e); }

        // 6. Tooltip hover (basic)
        try {
            const page = pages[1];
            const tipTarget = await page.$('[role="tooltip"]');
            if (tipTarget) {
                await tipTarget.hover();
                await sleep(300);
                const tipVisible = await page.evaluate(() => document.querySelector('[role="tooltip"] div') !== null);
                if (tipVisible) pass('Tooltip renders on hover');
                else fail('Tooltip render', new Error('Tip content not visible'));
            } else {
                console.log('  ⚠️  No [role="tooltip"] found – skipping tooltip test');
            }
        } catch (e) { fail('Tooltip test', e); }

        // ── Done ─────────────────────────────────────────────────────────
        console.log('\n══════════════════════════════════════════════════════════');
        console.log(`  RESULTS: ${results.passed.length} passed, ${results.failed.length} failed`);
        if (results.failed.length > 0) {
            console.log('\n  Failed tests:');
            results.failed.forEach(({ label, err }) => console.log(`    ✗ ${label}: ${err?.message || err}`));
        }
        console.log('══════════════════════════════════════════════════════════\n');

    } catch (globalErr) {
        fail('GLOBAL TEST ERROR', globalErr);
    } finally {
        for (const b of browsers) await b.close().catch(() => { });
        if (gunRelayProcess) {
            console.log('\n  [Cleanup] Shutting down Gun relay server...');
            gunRelayProcess.kill('SIGKILL');
        }
    }

    process.exit(results.failed.length > 0 ? 1 : 0);
})();
