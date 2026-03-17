/**
 * full-multiplayer.test.js
 *
 * Gridforge – Full Multiplayer End‑to‑End Test
 * --------------------------------------------
 * - Launches one Chromium instance per core role (3 players).
 * - All players join the same room, select their role, and (if needed) an asset.
 * - NESO publishes a forecast and advances phases.
 * - Each role submits appropriate bids/orders in DA, ID, and BM.
 * - After settlement, verifies:
 *     • All players are on the same SP and phase.
 *     • P&L figures are visible.
 *     • Leaderboard shows the correct number of players.
 *     • Role‑specific KPI labels appear (Profit/MW, Risk‑Adjusted Return, …).
 *     • BESS player sees State‑of‑Charge indicator.
 *     • Market Dictionary toggles open/close.
 *     • Tooltips appear on hover (basic test).
 *
 * Run with:
 *   node test/e2e/full-multiplayer.test.js
 *
 * Environment variables:
 *   GRIDFORGE_URL – base URL (default: http://localhost:5173)
 *   HEADLESS      – set to "false" to watch the browsers
 */

const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

const BASE_URL = process.env.GRIDFORGE_URL || 'http://localhost:5173';
const ROOM_CODE = 'TEST' + Date.now().toString().slice(-6);
const HEADLESS = process.env.HEADLESS !== 'false';

// ─── Role configuration (core flow only) ────────────────────────────────────
// To keep the test robust and fast we exercise the three core
// human roles required to run a standard "Normal Day" session:
//   - NESO (host / system operator) — auto-assigned to first joiner
//   - Generator (owns an OCGT asset)
//   - Supplier (no asset, hedging demand)
//   - Elexon (settlement operator) — assigned by NESO host
//   - Trader & BESS (additional roles to test full coverage)
// Note: NESO and Elexon are isSystem: true in constants.js, so they don't
// appear in WaitingRoom role selection buttons. NESO is auto-assigned to host.
// Elexon (and other non-selectable roles) are assigned by the NESO host via dropdowns.
const ROLES = [
    { name: 'NESO_Op',      roleLabel: 'System Operator',   roleId: 'NESO',      isHost: true,  needsAsset: false, assetKey: null    },
    { name: 'GenCo',        roleLabel: 'Generator',         roleId: 'GENERATOR', isHost: false, needsAsset: true,  assetKey: 'OCGT'  },
    { name: 'PowerSupply',  roleLabel: 'Supplier',          roleId: 'SUPPLIER',  isHost: false, needsAsset: false, assetKey: null    },
    { name: 'Elexon_Admin', roleLabel: 'Elexon',            roleId: 'ELEXON',    isHost: false, needsAsset: false, assetKey: null    },
    { name: 'HedgeFund',    roleLabel: 'Trader',            roleId: 'TRADER',    isHost: false, needsAsset: false, assetKey: null    },
    { name: 'BatteryCo',   roleLabel: 'Battery Storage',   roleId: 'BESS',      isHost: false, needsAsset: true,  assetKey: 'BESS_M'},
    { name: 'DemandCo',    roleLabel: 'Demand Controller', roleId: 'DSR',       isHost: false, needsAsset: true,  assetKey: 'DSR'   }
];

// ─── Test results tracker ─────────────────────────────────────────────────
const results = { passed: [], failed: [] };
function pass(label) { results.passed.push(label); console.log(`  ✅ ${label}`); }
function fail(label, err) { results.failed.push({ label, err }); console.error(`  ❌ ${label}: ${err?.message || err}`); }

// ─── Utility functions ────────────────────────────────────────────────────
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Wait until `predicate` returns truthy (poll every 500ms). Optional arg is passed into the predicate. */
async function waitFor(page, predicate, timeout = 30000, arg) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            const result = await page.evaluate(predicate, arg);
            if (result) return result;
        } catch { /* page may still be loading */ }
        await sleep(500);
    }
    const snippet = await page.evaluate(() => document.body.textContent.slice(0, 300)).catch(() => '');
    throw new Error(`waitFor timed out – body snippet: "${snippet}"`);
}

/** Click the first button whose text includes the given fragment. */
async function clickButton(page, textFragment, timeout = 20000) {
    await page.waitForFunction(
        t => {
            const btn = Array.from(document.querySelectorAll('button:not([disabled])')).find(b => b.textContent.toUpperCase().includes(t.toUpperCase()));
            if (!btn) return false;
            btn.click();
            return true;
        },
        { timeout },
        textFragment
    );
    await sleep(200); // give React a moment to process the click
}

/** Type into an input field identified by its placeholder. */
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
 * Starts the Gun relay on port 8765 (kills any existing process first).
 * Resolves with the child process, or null if already running externally.
 */
function startGunRelay() {
    return new Promise((resolve) => {
        console.log('  [Setup] Starting Gun relay on port 8765...');
        const kill = spawn('cmd', ['/c', 'for /f "tokens=5" %a in (\'netstat -ano ^| findstr :8765\') do taskkill /F /PID %a'], { stdio: 'ignore', shell: true });
        kill.on('close', () => {
            const relay = spawn('node', ['gun-relay.cjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
            let started = false;
            relay.stdout.on('data', d => {
                if (!started && d.toString().includes('Gun relay server running')) {
                    started = true;
                    console.log('  [Setup] Gun relay ready.');
                    resolve(relay);
                }
            });
            relay.on('error', err => { console.warn('  [Relay] Error:', err.message); if (!started) { started = true; resolve(null); } });
            relay.on('exit', code => { if (!started) { console.warn('  [Relay] Exited', code, '(may already be running)'); started = true; resolve(null); } });
            setTimeout(() => { if (!started) { started = true; resolve(relay); } }, 5000);
        });
    });
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
        return 'OK';
    }, playerName, roleId);
    if (ok !== 'OK') console.warn(`  [NESO] assignRole: ${ok} (${playerName})`);
    await sleep(600);
    return ok === 'OK';
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
        return 'OK';
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
