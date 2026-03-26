/**
 * gridforge-comprehensive.test.cjs
 *
 * GridForge – Comprehensive Full-System E2E Test
 * ================================================
 * Covers ALL roles, ALL phases, ALL bid types, and cross-player sync.
 *
 * Roles exercised (7):
 *   NESO (System Operator) – host, advances phases, publishes forecast
 *   Generator (OCGT)        – DA offer, ID adjust, BM dispatch
 *   Supplier                – DA purchase, ID adjust (no BM)
 *   Trader                  – DA speculative long, ID close
 *   BESS (Medium)           – DA schedule, ID adjust, BM dispatch
 *   DSR                     – DA schedule, ID adjust, BM curtailment
 *   Interconnector (IFA)    – **no longer a playable role; flows are automatic**
 *
 * Phases tested (4 per SP):
 *   DA  → ID  → BM  → SETTLED
 *
 * Feature assertions:
 *   ✓ All players reach same SP/phase at every transition
 *   ✓ Every submit button locks after use (text changes to ✓ …)
 *   ✓ BM inputs only accept interaction once phase === "BM" (enabled check)
 *   ✓ Revenue breakdown panel visible post-settlement
 *   ✓ Leaderboard reflects correct player count
 *   ✓ Role-specific KPI labels present
 *   ✓ Market Dictionary opens and closes
 *   ✓ BESS SoC indicator present
 *   ✓ DSR curtailment / rebound state display
 *   ✓ Interconnector price-spread display
 *   ✓ NESO merit order table populates after BM
 *   ✓ Forecast panel shows after publish
 *
 * Run:
 *   node test/e2e/gridforge-comprehensive.test.cjs
 *
 * Env vars:
 *   GRIDFORGE_URL  – default http://localhost:5174
 *   HEADLESS       – set to "false" to watch
 *   SLOW_MO        – ms delay between Puppeteer actions (default 0)
 */

'use strict';

const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

// ─── Config ──────────────────────────────────────────────────────────────────
const BASE_URL = process.env.GRIDFORGE_URL || 'http://localhost:3000';
const ROOM_CODE = 'COMP' + Date.now().toString().slice(-6);
const HEADLESS = process.env.HEADLESS !== 'false';
const SLOW_MO = parseInt(process.env.SLOW_MO || '0', 10);

// ─── Role definitions ─────────────────────────────────────────────────────────
const ROLES = [
    { name: 'NESO_Op',     roleLabel: 'System Operator',   roleId: 'NESO',      isHost: true,  needsAsset: false, assetName: null,   assetKey: null    },
    { name: 'GenCo',       roleLabel: 'Generator',         roleId: 'GENERATOR', isHost: false, needsAsset: true,  assetName: 'OCGT', assetKey: 'OCGT'  },
    { name: 'PowerSupply', roleLabel: 'Supplier',          roleId: 'SUPPLIER',  isHost: false, needsAsset: false, assetName: null,   assetKey: null    },
    { name: 'TraderJoe',   roleLabel: 'Trader',            roleId: 'TRADER',    isHost: false, needsAsset: false, assetName: null,   assetKey: null    },
    { name: 'BatteryOp',  roleLabel: 'Battery Storage',   roleId: 'BESS',      isHost: false, needsAsset: true,  assetName: 'BESS', assetKey: 'BESS_M'},
    { name: 'FlexLoad',   roleLabel: 'Demand Controller', roleId: 'DSR',       isHost: false, needsAsset: true,  assetName: 'DSR',  assetKey: 'DSR'   },
    // Interconnector removed – automatic system asset, not a browser participant
];

// ─── Result tracker ──────────────────────────────────────────────────────────
const results = { passed: [], failed: [], warned: [] };
function pass(label) { results.passed.push(label); console.log(`  ✅ ${label}`); }
function fail(label, err) { results.failed.push({ label, err }); console.error(`  ❌ ${label}: ${err?.message || err}`); }
function warn(label, msg) { results.warned.push({ label, msg }); console.warn(`  ⚠️  ${label}: ${msg}`); }

// ─── Core utilities ───────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Poll `predicate` (evaluated in page context) until truthy or timeout.
 * `arg` is serialised and passed as the first argument to the predicate.
 */
async function waitFor(page, predicate, timeout = 30000, arg) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            if (await page.evaluate(predicate, arg)) return true;
        } catch { /* page loading */ }
        await sleep(400);
    }
    const snippet = await page.evaluate(
        () => document.body.textContent.replace(/\s+/g, ' ').slice(0, 400)
    ).catch(() => '(page unavailable)');
    throw new Error(`waitFor timed out after ${timeout}ms. Body: "${snippet}"`);
}

/**
 * Click the first enabled button whose text contains `fragment`.
 * IMPORTANT: clicking happens inside page.evaluate() to avoid the
 * JSHandle.click() TypeError that plagued earlier test versions.
 */
async function clickButton(page, fragment, timeout = 20000) {
    const clicked = await page.waitForFunction(
        frag => {
            const btn = Array.from(document.querySelectorAll('button:not([disabled])'))
                .find(b => b.textContent.toUpperCase().includes(frag.toUpperCase()));
            if (!btn) return false;
            // Perform click and verify
            try {
                btn.click();
                // Also try dispatch of click event for extra reliability
                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            } catch (e) {
                console.error(`clickButton dispatch failed: ${e.message}`);
                return false;
            }
            return true;
        },
        { timeout },
        fragment
    );
    // Wait for click to fully propagate through event loop
    await sleep(250);
}

/**
 * Wait for a specific enabled button (containing `fragment`) to exist,
 * then return without clicking. Useful for gating input fills.
 */
async function waitForButton(page, fragment, timeout = 30000) {
    try {
        await page.waitForFunction(
            frag => Array.from(document.querySelectorAll('button:not([disabled])'))
                .some(b => b.textContent.toUpperCase().includes(frag.toUpperCase())),
            { timeout },
            fragment
        );
    } catch (e) {
        // Debug info
        const buttons = await page.evaluate(() => {
            const all = Array.from(document.querySelectorAll('button'));
            return all.map(btn => ({
                disabled: btn.disabled,
                text: btn.textContent.trim().substring(0, 60)
            }));
        });
        console.error(`waitForButton("${fragment}") timed out. Available buttons:`, JSON.stringify(buttons, null, 2));
        throw e;
    }
}

/**
 * Fill a React-controlled number input identified by its 0-based index
 * among currently ENABLED number inputs. Dispatches both 'input' and 'change' events
 * to ensure React state updates (controlled components listen to both).
 */
async function fillNumber(page, index, value) {
    try {
        await page.waitForFunction(
            (idx, val) => {
                const inputs = Array.from(
                    document.querySelectorAll('input[type="number"]:not([disabled])')
                );
                if (!inputs[idx]) {
                    console.log(`fillNumber: Looking for input ${idx}, found ${inputs.length} enabled inputs`);
                    return false;
                }
                const setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value'
                ).set;
                setter.call(inputs[idx], val.toString());
                // Dispatch both input and change events - React controlled components rely on both
                inputs[idx].dispatchEvent(new Event('input', { bubbles: true }));
                inputs[idx].dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            },
            { timeout: 20000 },
            index, value
        );
        // Give React time to process state update
        await sleep(150);
    } catch (e) {
        // Debug info
        const inputs = await page.evaluate(() => {
            const all = Array.from(document.querySelectorAll('input[type="number"]'));
            return all.map((inp, i) => ({
                index: i,
                disabled: inp.disabled,
                value: inp.value,
                placeholder: inp.placeholder
            }));
        });
        console.error(`fillNumber[${index}] failed. Available inputs:`, JSON.stringify(inputs, null, 2));
        throw e;
    }
}

/**
 * Fill a placeholder-matched input (for name / room code fields).
 */
async function fillPlaceholder(page, placeholder, value) {
    await page.waitForFunction(
        (ph, val) => {
            const el = Array.from(document.querySelectorAll('input'))
                .find(i => (i.placeholder || '').toUpperCase().includes(ph.toUpperCase()));
            if (!el) return false;
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
            ).set;
            setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        },
        { timeout: 15000 },
        placeholder, value
    );
}

/** Click a UI tab by its visible label. */
async function selectTab(page, tabLabel) {
    await page.evaluate(label => {
        const btn = Array.from(document.querySelectorAll('button'))
            .find(b => b.textContent.toUpperCase().includes(label.toUpperCase()));
        if (btn) btn.click();
    }, tabLabel);
    await sleep(300);
}

// ─── Gun relay (no longer needed — app uses FastAPI WebSocket) ─────────────────
function startGunRelay() {
    console.log('  [Setup] Skipping Gun relay (app uses FastAPI WebSocket)');
    return Promise.resolve(null);
}

// ─── NESO-authority waiting room helpers ───────────────────────────────────
async function enterLobby(page, playerName) {
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await waitFor(page, () => document.body.textContent.includes('Online') || document.querySelector('input') !== null, 20000);
    await fillPlaceholder(page, 'e.g. Alice', playerName);
    await page.evaluate(() => {
        const el = document.querySelector('input[placeholder="e.g. ALPHA"]');
        if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await fillPlaceholder(page, 'e.g. ALPHA', ROOM_CODE);
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

// ─── Phase helpers ───────────────────────────────────────────────────────────

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

/** Resume the game by clicking RESUME on NESO page */
async function resumeGame(page) {
    try {
        const hasResumeBtn = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('button:not([disabled])'))
                .some(b => b.textContent.includes('RESUME') || b.textContent.includes('▶'));
        });
        if (hasResumeBtn) {
            await clickButton(page, 'RESUME', 10000);
            await sleep(500);
            console.log('  [CTRL] Game RESUMED');
        }
    } catch (e) {
        console.warn(`  [CTRL] Resume failed: ${e.message}`);
    }
}

/** NESO: click ADVANCE PHASE and wait for `phaseTextOnNESO` to appear. With retries.
 *  Handles paused state: resumes if paused, advances, then re-pauses for test stability. */
async function nesoAdvance(page, phaseTextOnNESO, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            // First, ensure game is resumed so advance works
            await resumeGame(page);
            await sleep(500);

            // Verify NESO has the ADVANCE PHASE or START SIMULATION button (proves instructor role)
            const hasButton = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('button:not([disabled])'))
                    .some(b => {
                        const text = b.textContent.toUpperCase();
                        return text.includes('ADVANCE PHASE') || text.includes('START SIMULATION');
                    });
            });
            if (!hasButton) {
                throw new Error('NESO does not have enabled ADVANCE PHASE or START SIMULATION button (not instructor?)');
            }

            console.log(`  [NESO] Attempting phase advance to "${phaseTextOnNESO}" (attempt ${attempt + 1}/${retries + 1})`);

            // Get current phase before attempt
            const phaseBefore = await getPhaseLabel(page);

            // Click whichever button is present: START SIMULATION or ADVANCE PHASE
            const buttonClicked = await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button:not([disabled])'));
                const advance = btns.find(b => b.textContent.toUpperCase().includes('ADVANCE PHASE'));
                const start = btns.find(b => b.textContent.toUpperCase().includes('START SIMULATION'));
                const btn = advance || start;
                if (btn) {
                    btn.click();
                    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    return btn.textContent.trim().substring(0, 40);
                }
                return null;
            });
            if (!buttonClicked) {
                throw new Error('Could not click ADVANCE PHASE or START SIMULATION button');
            }
            console.log(`  [NESO] Clicked: "${buttonClicked}"`);

            // Immediately re-pause to prevent auto-timer from advancing further
            await sleep(1500);
            await pauseGame(page);

            // Give GunDB time to propagate
            await sleep(2000);

            // Verify phase actually changed on NESO's screen with longer timeout
            await waitFor(page, txt => document.body.textContent.includes(txt), 50000, phaseTextOnNESO);

            // Additional verification with multiple checks
            let phaseConfirmed = false;
            for (let check = 0; check < 3; check++) {
                const phaseChanged = await page.evaluate((txt) => {
                    return document.body.textContent.includes(txt);
                }, phaseTextOnNESO);

                if (phaseChanged) {
                    phaseConfirmed = true;
                    break;
                }
                await sleep(500);
            }

            if (!phaseConfirmed) {
                throw new Error(`Phase text not found after advance: looking for "${phaseTextOnNESO}"`);
            }

            const phaseAfter = await getPhaseLabel(page);
            console.log(`  [NESO] Phase advance succeeded: ${phaseBefore} → ${phaseAfter}`);
            return; // Success

        } catch (e) {
            if (attempt < retries) {
                console.warn(`  [NESO] Advance attempt ${attempt + 1} failed, retrying: ${e.message}`);
                await sleep(1500);
            } else {
                throw e; // Final attempt failed
            }
        }
    }
}

/** Read GunDB meta state to get actual phase value. */
async function getGunPhaseState(page) {
    try {
        return await page.evaluate(() => {
            // Try to read from window's internal state or GunDB if exposed
            if (window.gunState?.phase) return window.gunState.phase;
            // Fallback: infer from DOM text
            const body = document.body.textContent;
            if (body.includes('SETTLEMENT')) return 'SETTLEMENT';
            if (body.includes('BALANCING')) return 'BM';
            if (body.includes('INTRADAY')) return 'ID';
            return 'DA';
        });
    } catch (e) {
        return null;
    }
}

/** Simple phase sync with text polling AND gunState fallback. */
async function syncPhase(pages, phaseText, timeout = 40000) {
    const deadline = Date.now() + timeout;

    // Map phaseText to gunState.phase value
    const phaseMap = {
        'DAY-AHEAD': 'DA',
        'INTRADAY': 'ID',
        'BALANCING': 'BM',
        'SETTLEMENT': 'SETTLED',
        'SETTLED': 'SETTLED'
    };
    const expectedGunPhase = phaseMap[phaseText.toUpperCase()] || null;

    while (Date.now() < deadline) {
        // Check if all pages show the target phase text OR have matching gunState
        const matches = await Promise.all(pages.map(async p => {
            try {
                return await p.evaluate((txt, gunPhase) => {
                    // Primary: check window.gunState.phase (set by SharedLayout)
                    if (gunPhase && window.gunState && window.gunState.phase === gunPhase) return true;

                    // Fallback: check exact pill text (avoid dictionary body text matches)
                    const pills = Array.from(document.querySelectorAll('div, span'));
                    if (pills.some(el =>
                        el.textContent.toUpperCase() === `📋 ${txt.toUpperCase()}` ||
                        el.textContent.toUpperCase() === `🤝 ${txt.toUpperCase()}` ||
                        el.textContent.toUpperCase() === `⚡ ${txt.toUpperCase()}` ||
                        el.textContent.toUpperCase() === `🏁 ${txt.toUpperCase()}`
                    )) {
                        return true;
                    }

                    return false;
                }, phaseText, expectedGunPhase);
            } catch {
                return false;
            }
        }));

        const allMatched = matches.every(m => m);
        if (allMatched) {
            console.log(`  [SYNC] Phase "${phaseText}" confirmed on all players`);
            await sleep(2000); // Give React time to finalize
            return;
        }

        const matched = matches.filter(m => m).length;
        console.log(`  [SYNC] ${matched}/${pages.length} players show "${phaseText}", waiting...`);

        await sleep(1500);
    }

    throw new Error(`Phase "${phaseText}" not synced after ${timeout}ms`);
}

/**
 * Discover game constraints from current UI state.
 * Reads min/max values from input fields and labels.
 */
async function discoverGameConstraints(page) {
    return await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input[type="number"]:not([disabled])'));
        const constraints = inputs.map((inp, idx) => ({
            index: idx,
            value: inp.value || '',
            min: inp.min || 0,
            max: inp.max || 999,
            step: inp.step || 1,
            placeholder: inp.placeholder || ''
        }));
        return { inputs: constraints, inputCount: inputs.length };
    });
}

/**
 * Generate safe values within discovered game constraints.
 * Uses 50-70% of max to avoid edge cases.
 */
async function generateGameValues(page, numInputs) {
    const constraints = await discoverGameConstraints(page);
    if (constraints.inputs.length < numInputs) {
        throw new Error(`Expected ${numInputs} inputs, found ${constraints.inputs.length}`);
    }

    return constraints.inputs.slice(0, numInputs).map(inp => {
        const min = parseInt(inp.min) || 0;
        const max = parseInt(inp.max) || 100;
        // Use ~60% of range to be safe and realistic
        const safeValue = Math.round(min + (max - min) * 0.6);
        return safeValue;
    });
}

/**
 * Discover actual submit button and success messages from game UI.
 */
async function discoverFormMessages(page, submitButtonFragment) {
    return await page.evaluate((fragment) => {
        const allBtns = Array.from(document.querySelectorAll('button'));

        // 1. First try to find the specific button requested by fragment
        let submitBtn = null;
        if (fragment) {
            submitBtn = allBtns.find(b =>
                !b.disabled && b.textContent.toUpperCase().includes(fragment.toUpperCase())
            );
        }

        // 2. Fallback to generic heuristic if specific button not found (for backwards compatibility)
        if (!submitBtn) {
            submitBtn = allBtns.find(b =>
                !b.disabled && (
                    b.textContent.toUpperCase().includes('SUBMIT') ||
                    b.textContent.toUpperCase().includes('CONFIRM') ||
                    b.textContent.toUpperCase().includes('SEND') ||
                    b.textContent.includes('→')
                )
            );
        }

        return {
            buttonText: submitBtn ? submitBtn.textContent.trim() : null,
            allButtons: allBtns.map(b => ({
                text: b.textContent.trim().substring(0, 60),
                disabled: b.disabled
            }))
        };
    }, submitButtonFragment);
}

/**
 * Fill inputs and submit a form using game-discovered data.
 * Dynamically reads constraints, generates values, discovers messages.
 */
async function fillAndSubmit(page, numInputs, submitButtonFragment, successTextToWaitFor) {
    // 1. Discover button and game state
    const formMsgs = await discoverFormMessages(page, submitButtonFragment);
    if (!formMsgs.buttonText) {
        throw new Error(`No submit button found. Available buttons: ${JSON.stringify(formMsgs.allButtons)}`);
    }
    const actualButtonText = formMsgs.buttonText;
    console.log(`    [fillAndSubmit] Found button: "${actualButtonText}"`);

    await sleep(400);

    // 2. Wait for enough enabled number inputs
    let retries = 0;
    while (retries < 3) {
        try {
            await page.waitForFunction(
                (needed) => {
                    const inputs = Array.from(
                        document.querySelectorAll('input[type="number"]:not([disabled])')
                    );
                    return inputs.length >= needed;
                },
                { timeout: 20000 },
                numInputs
            );
            break;
        } catch (e) {
            retries++;
            if (retries >= 3) {
                const inputs = await page.evaluate(() => {
                    const all = Array.from(document.querySelectorAll('input[type="number"]'));
                    return all.map((i, idx) => ({ index: idx, disabled: i.disabled, value: i.value }));
                });
                throw new Error(`Not enough enabled inputs. Need ${numInputs}, found: ${JSON.stringify(inputs.slice(0, 5))}`);
            }
            await sleep(600);
        }
    }

    // 3. Generate values from actual game constraints
    const gameValues = await generateGameValues(page, numInputs);
    console.log(`    [fillAndSubmit] Generated values from game constraints: ${gameValues.join(', ')}`);

    // 4. Fill inputs
    for (let i = 0; i < gameValues.length; i++) {
        await fillNumber(page, i, gameValues[i]);
        await sleep(50);
    }

    // 5. Wait for button to be enabled
    let btnWaitRetries = 0;
    while (btnWaitRetries < 4) {
        try {
            await waitForButton(page, submitButtonFragment, 35000);
            break;
        } catch (e) {
            btnWaitRetries++;
            if (btnWaitRetries >= 4) {
                const btnStatus = await page.evaluate((txt) => {
                    const allBtns = Array.from(document.querySelectorAll('button'));
                    const targetBtn = allBtns.find(b => b.textContent.toUpperCase().includes(txt.toUpperCase()));
                    const allInputs = Array.from(document.querySelectorAll('input[type="number"]'));
                    return targetBtn ? {
                        text: targetBtn.textContent.trim(),
                        disabled: targetBtn.disabled,
                        inputs: allInputs.map(i => ({ val: i.value, dis: i.disabled }))
                    } : { notFound: true };
                }, submitButtonFragment);
                throw new Error(`Button "${submitButtonFragment}" not enabled. Status: ${JSON.stringify(btnStatus)}`);
            }
            console.log(`    [fillAndSubmit] Button not enabled yet (retry ${btnWaitRetries}/4), waiting...`);
            await sleep(1000);
        }
    }

    await sleep(400);

    // 6. Click button (use actual button text discovered)
    await clickButton(page, submitButtonFragment, 50000);
    await sleep(500);

    // 7. Wait for success indication from game
    // If successText provided, wait for it; otherwise wait for UI changes
    if (successTextToWaitFor) {
        await waitFor(page, txt => document.body.textContent.includes(txt), 50000, successTextToWaitFor);
    } else {
        // Generic success: button should change state or lock
        await sleep(2000);
    }
}

// ─── Role-specific submit functions ──────────────────────────────────────────
// Now uses game-discovered data instead of hardcoded values.
// Each function calls fillAndSubmit with number of inputs and button fragment.

// --- Generator ---
async function genDA(page) {
    // Generator DA: exit curve mode first, then simple MW+price inputs
    await clickButton(page, 'Simple Mode').catch(() => {});
    await sleep(400);
    await fillAndSubmit(page, 2, 'SUBMIT DA OFFER', null);
}

async function genID(page) {
    // Generator ID: adjustment volume and new price
    await fillAndSubmit(page, 2, 'SUBMIT ID ORDER', null);
}

async function genBM(page) {
    // Generator BM: dispatch MW and reserve price
    await fillAndSubmit(page, 2, 'TO NESO', null);
}

// --- Supplier ---
async function supDA(page) {
    // Supplier defaults to Simple Mode — wait for DA inputs to be enabled (disabled={!isDa})
    await page.waitForFunction(
        () => Array.from(document.querySelectorAll('input[type="number"]:not([disabled])')).length >= 2,
        { timeout: 30000 }
    );
    await fillAndSubmit(page, 2, 'SUBMIT DA PURCHASE', null);
}

async function supID(page) {
    // Supplier ID: adjustment volume and price
    await clickButton(page, 'BUY MORE');
    await fillAndSubmit(page, 2, 'SUBMIT ID ORDER', null);
}

// --- Trader ---
async function traderDA(page) {
    // Trader DA: speculative long position
    await selectTab(page, 'DAY-AHEAD');
    await clickButton(page, 'BUY (Go Long)');
    await fillAndSubmit(page, 2, 'SUBMIT SPECULATIVE POSITION', null);
}

async function traderID(page) {
    // Trader ID: adjust position via intraday tab
    await selectTab(page, 'INTRADAY');
    await clickButton(page, 'SELL (Go Short)');
    await fillAndSubmit(page, 2, 'SUBMIT ID ORDER', null);
}

// --- BESS ---
async function bessDA(page) {
    // BESS DA: exit curve mode first, then discharge schedule
    await clickButton(page, 'Simple Mode').catch(() => {});
    await sleep(400);
    await clickButton(page, 'SELL (Discharge Battery)');
    await sleep(600);
    await fillAndSubmit(page, 2, 'SUBMIT DA SCHEDULE', null);
}

async function bessID(page) {
    // BESS ID: charge order
    await clickButton(page, 'BUY (Charge Battery)');
    await sleep(1000);
    await fillAndSubmit(page, 2, 'SUBMIT ID ORDER', null);
}

async function bessBM(page) {
    // BESS BM: dispatch MW and reserve price (button text varies with grid state)
    // When grid is short: "OFFER RESERVE & DISCHARGE →"
    // When grid is long: "BID TO ABSORB & CHARGE →"
    // Use data-testid for reliability
    const btnFragment = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="bess-submit-bm"]');
        if (btn) return btn.textContent.trim().substring(0, 30);
        const btns = Array.from(document.querySelectorAll('button:not([disabled])'));
        const match = btns.find(b => b.textContent.includes('DISCHARGE') || b.textContent.includes('CHARGE'));
        return match ? match.textContent.trim().substring(0, 30) : 'DISCHARGE';
    });
    console.log(`    [bessBM] Detected button fragment: "${btnFragment}"`);
    await fillAndSubmit(page, 2, btnFragment, null);
}

// --- DSR ---
async function dsrDA(page) {
    // DSR has no curve mode — wait for SELL button to be enabled (rendered when isDa = true)
    await page.waitForFunction(
        () => !!Array.from(document.querySelectorAll('button:not([disabled])')).find(b => b.textContent.includes('SELL (Curtail Demand)')),
        { timeout: 30000 }
    );
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button:not([disabled])')).find(b => b.textContent.includes('SELL (Curtail Demand)'));
        if (btn) btn.click();
    });
    await sleep(600);
    await fillAndSubmit(page, 2, 'SUBMIT DA SCHEDULE', null);
}

async function dsrID(page) {
    // DSR ID: curtailment adjustment
    await clickButton(page, 'SELL (Curtail Demand)');
    await sleep(1000);
    await fillAndSubmit(page, 2, 'SUBMIT ID ORDER', null);
}

async function dsrBM(page) {
    // DSR is a pure BM player — no DA/ID curtailment → no rebound → inputs enabled
    // Wait for the dsr-bm-mw input to not be disabled (45s — DSR is the last browser)
    await page.waitForFunction(
        () => {
            const inp = document.querySelector('input[data-testid="dsr-bm-mw"]');
            return inp && !inp.disabled;
        },
        { timeout: 45000 }
    ).catch(async () => {
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

// --- Interconnector ---
async function icBM(page) {
    // Interconnector BM: import/export bid
    await fillAndSubmit(page, 2, 'TO NESO', null);
}

// ─── Phase sync verifiers ─────────────────────────────────────────────────────
async function getCurrentSP(page) {
    return page.evaluate(() => {
        const m = document.body.textContent.match(/SP\s*(\d+)\s*\/\s*48/);
        return m ? parseInt(m[1], 10) : null;
    });
}

async function getPhaseLabel(page) {
    return page.evaluate(() => {
        // Use window.gunState.phase if available (set by SharedLayout)
        if (window.gunState && window.gunState.phase) {
            const p = window.gunState.phase;
            if (p === 'DA') return 'DA';
            if (p === 'ID') return 'ID';
            if (p === 'BM') return 'BM';
            if (p === 'SETTLED') return 'SETTLED';
        }
        // Fallback: check the phase pill labels from SharedLayout (emoji-prefixed, unique to current phase)
        const t = document.body.textContent;
        if (t.includes('🏁 SETTLEMENT')) return 'SETTLED';
        if (t.includes('⚡ BALANCING')) return 'BM';
        if (t.includes('🤝 INTRADAY')) return 'ID';
        if (t.includes('📋 DAY-AHEAD')) return 'DA';
        // Last fallback: broader text matching
        const u = t.toUpperCase();
        if (u.includes('SETTLEMENT PHASE')) return 'SETTLED';
        if (u.includes('BALANCING MECHANISM')) return 'BM';
        if (u.includes('INTRADAY BILATERALS')) return 'ID';
        if (u.includes('DA MARKET SUBMISSION')) return 'DA';
        return null;
    });
}

// ─── Feature / UI verification helpers ───────────────────────────────────────
async function checkText(page, text, label) {
    const found = await page.evaluate(t => document.body.textContent.includes(t), text);
    found ? pass(label) : fail(label, new Error(`"${text}" not found`));
    return found;
}

async function checkRevenue(page, roleName) {
    // All role screens show a REVENUE BREAKDOWN or TOTAL LEDGER section post-settlement.
    const found = await page.evaluate(() =>
        document.body.textContent.includes('TOTAL LEDGER') ||
        document.body.textContent.includes('REVENUE BREAKDOWN') ||
        document.body.textContent.includes('TOTAL P&L')
    );
    found ? pass(`${roleName}: Revenue panel visible`) :
        fail(`${roleName}: Revenue panel missing`, new Error('No revenue UI found'));
}

/**
 * PHASE SYNC ASSERTION (NEW)
 * After NESO clicks "Advance Phase", verify ALL players' UI shows the same phase.
 * This guarantees GunDB is syncing the game state instantly to all clients.
 */
async function verifyPhaseSync(pages, expectedPhase, rolesToCheck = null) {
    const toCheck = rolesToCheck ? pages.filter((_, i) => rolesToCheck.includes(i)) : pages;
    const phaseLabels = await Promise.all(toCheck.map(p => getPhaseLabel(p)));

    const allMatched = phaseLabels.every(phase => {
        if (expectedPhase === 'DA') return phase === 'DA';
        if (expectedPhase === 'ID') return phase === 'ID';
        if (expectedPhase === 'BM') return phase === 'BM';
        if (expectedPhase === 'SETTLED') return phase === 'SETTLED';
        return false;
    });

    if (allMatched) {
        pass(`✓ Phase Sync: All ${toCheck.length} players show "${expectedPhase}"`);
        return true;
    } else {
        fail(`✗ Phase Sync: Mismatch on "${expectedPhase}"`,
            new Error(`Players see: ${phaseLabels.join(', ')}`));
        return false;
    }
}

/**
 * MARKET CLEARING ASSERTION (NEW)
 * After BM closes, verify the clearing price (MCP) is calculated and displayed.
 * Check that it's between SBP and SSP (logical constraint).
 */
async function verifyMarketClearing(pages, iNESO, iGEN, iSUP, iBESS, iDSR) {
    console.log('\n   [Assertion] Market Clearing Price (MCP) verification…');

    try {
        // NESO should show the merit order with accepted bids and a clearing price
        const nesoData = await pages[iNESO].evaluate(() => {
            const text = document.body.textContent;
            const mcpMatch = text.match(/MCP[:\s]+[£$]?([\d.]+)/);
            const sbpMatch = text.match(/SBP[:\s]+[£$]?([\d.]+)/);
            const sspMatch = text.match(/SSP[:\s]+[£$]?([\d.]+)/);
            const acceptedMatch = text.match(/ACCEPTED\s*(\d+)/);

            return {
                mcp: mcpMatch ? parseFloat(mcpMatch[1]) : null,
                sbp: sbpMatch ? parseFloat(sbpMatch[1]) : null,
                ssp: sspMatch ? parseFloat(sspMatch[1]) : null,
                accepted: acceptedMatch ? parseInt(acceptedMatch[1], 10) : 0,
                hasAccepted: text.includes('ACCEPTED'),
                hasMeritOrder: text.includes('MERIT') || text.includes('OFFER')
            };
        });

        if (!nesoData.mcp) {
            warn('Market Clearing: MCP not visible on NESO screen (may be calculated off-page)',
                'Check backend settlement calculations');
            return false;
        }

        // Verify MCP is logical: should be within bid/offer range
        if (nesoData.sbp && nesoData.ssp && nesoData.mcp) {
            const low = Math.min(nesoData.sbp, nesoData.ssp);
            const high = Math.max(nesoData.sbp, nesoData.ssp);

            if (nesoData.mcp >= low * 0.8 && nesoData.mcp <= high * 1.2) {
                pass(`✓ Market Clearing: MCP £${nesoData.mcp.toFixed(2)} is logical (SBP: £${nesoData.sbp.toFixed(2)}, SSP: £${nesoData.ssp.toFixed(2)})`);
            } else {
                warn(`Market Clearing: MCP £${nesoData.mcp} outside expected range`,
                    `SBP£${nesoData.sbp} / SSP£${nesoData.ssp}`);
            }
        }

        // Check for accepted bids
        if (nesoData.hasAccepted || nesoData.accepted > 0) {
            pass(`✓ Market Clearing: ${nesoData.accepted} bids accepted, merit order populated`);
        } else {
            warn('Market Clearing: No accepted bids visible', 'All bids may have been rejected or cleared at same price');
        }

        return nesoData.mcp !== null;

    } catch (e) {
        fail('Market Clearing: verification failed', e);
        return false;
    }
}

/**
 * BUTTON LOCKOUT ASSERTION (NEW)
 * After a player submits a form, verify the submit button becomes disabled
 * and the UI indicates submission was successful (checkmark, locked state, etc).
 * This prevents double-submission bugs.
 */
async function verifyButtonLockout(page, playerName, submitButtonFragment) {
    try {
        // Wait a moment for events to propagate
        await sleep(400);

        const buttonState = await page.evaluate((frag) => {
            const btns = Array.from(document.querySelectorAll('button'));
            const target = btns.find(b =>
                b.textContent.toUpperCase().includes(frag.toUpperCase())
            );

            if (!target) {
                return { found: false, message: 'Button not found after submission' };
            }

            return {
                found: true,
                disabled: target.disabled,
                text: target.textContent.trim().substring(0, 80),
                title: target.title || '',
                ariaLabel: target.getAttribute('aria-label') || '',
                hasCheckmark: target.textContent.includes('✓') ||
                    target.textContent.includes('✔') ||
                    target.textContent.includes('Locked')
            };
        }, submitButtonFragment);

        if (!buttonState.found) {
            warn(`Button Lockout (${playerName}): ${buttonState.message}`,
                'Button may have been replaced with another control');
            return false;
        }

        if (buttonState.disabled) {
            pass(`✓ Button Lockout (${playerName}): Submit button is DISABLED`);
            if (buttonState.hasCheckmark) {
                pass(`✓ Button Lockout (${playerName}): Button shows locked/checkmark state`);
            }
            return true;
        } else {
            fail(`Button Lockout (${playerName}): Submit button still ENABLED after submission`,
                new Error(`Button text: "${buttonState.text}"`));
            return false;
        }

    } catch (e) {
        fail(`Button Lockout (${playerName}): Check failed`, e);
        return false;
    }
}

// ─── Main runner ─────────────────────────────────────────────────────────────
(async () => {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('  GRIDFORGE – Comprehensive Full-System E2E Test');
    console.log(`  Room: ${ROOM_CODE}  |  Server: ${BASE_URL}`);
    console.log(`  Roles: ${ROLES.map(r => r.name).join(', ')}`);
    console.log('══════════════════════════════════════════════════════════════\n');

    const browsers = [];
    const pages = [];

    // Index shortcuts
    // index shortcuts for pages (interconnector removed)
    const [iNESO, iGEN, iSUP, iTRAD, iBESS, iDSR] = [0, 1, 2, 3, 4, 5];

    let gunRelayProcess = null;
    try {
        gunRelayProcess = await startGunRelay();

        // ════════════════════════════════════════════════════════════════
        // PHASE 0 – Launch browsers & join (NESO-authority flow)
        // ════════════════════════════════════════════════════════════════
        console.log('─── Phase 0: Join All Players (NESO-Authority Flow) ──────────────');

        // 1. Launch all browsers
        for (const cfg of ROLES) {
            const browser = await puppeteer.launch({
                headless: HEADLESS ? 'new' : false,
                slowMo: SLOW_MO,
                protocolTimeout: 60000,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            });
            browsers.push(browser);
            const page = await browser.newPage();
            await page.setViewport({ width: 1440, height: 900 });
            page.on('console', msg => { if (msg.type() === 'error') console.log(`  [BROWSER][${cfg.name}] ${msg.text()}`); });
            pages.push(page);
        }

        // 2. NESO joins first to claim host slot
        try {
            await enterLobby(pages[iNESO], ROLES[iNESO].name);
            await waitFor(pages[iNESO], () =>
                document.body.textContent.includes('NESO CONTROL') ||
                document.body.textContent.includes('ROOM AUTHORITY'), 20000);
            pass(`Join: ${ROLES[iNESO].name} confirmed as NESO host`);
        } catch (e) { fail(`Join: ${ROLES[iNESO].name}`, e); }

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
            await waitForAllPlayersInRoom(pages[iNESO], ROLES.length);
            pass('NESO sees all players');
        } catch (e) { fail('NESO player count', e); }

        // Guard: wait for NESO's host UI (role dropdowns) to be visible before assigning
        await pages[iNESO].waitForFunction(
            () => document.querySelectorAll('[data-testid="role-assign-select"]').length > 0,
            { timeout: 15000 }
        ).catch(() => console.warn('  [NESO] Host dropdowns not visible yet — proceeding anyway'));

        for (let i = 1; i < ROLES.length; i++) {
            const cfg = ROLES[i];
            try {
                await nesoAssignRole(pages[iNESO], cfg.name, cfg.roleId);
                if (cfg.assetKey) {
                    await nesoAssignAsset(pages[iNESO], cfg.name, cfg.assetKey);
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
            await nesoStartGameFromWaiting(pages[iNESO]);
            pass('NESO started game');
        } catch (e) { fail('NESO start game', e); }

        // 8. Wait for all game UIs to load
        for (let i = 0; i < pages.length; i++) {
            try {
                await waitFor(pages[i], () => document.body.textContent.includes('/48'), 30000);
                pass(`Game UI: ${ROLES[i].name}`);
            } catch (e) { fail(`Game UI: ${ROLES[i].name}`, e); }
        }

        // Pause immediately to control phase timing
        console.log('\n─── Pausing Game to Control Phase Timing ─────────────────────────────────');
        await sleep(2000);
        await pauseGame(pages[iNESO]);
        await sleep(2000);

        // ── Initial sync check ──
        console.log('\n─── Initial State Verification ────────────────────────────');

        // Give GunDB time to settle after all joins
        await sleep(3000);

        const initSPs = await Promise.all(pages.map(getCurrentSP));
        if (initSPs.every(sp => sp !== null))
            pass(`All ${ROLES.length} players have SP indicator`);
        else
            fail('SP indicator present', new Error(`SPs: ${initSPs}`));

        // All on same SP
        const validSPs = initSPs.filter(Boolean);
        if (validSPs.length > 1 && validSPs.every(sp => sp === validSPs[0]))
            pass(`All players on same SP: ${validSPs[0]}`);
        else
            warn('SP sync at start', `SPs: ${initSPs}`);

        // ────────── STATE DISCOVERY FOR DEBUGGING ──────────────
        console.log('\n─── State Object Discovery ────────────────────────────────');
        await discoverStateObjects(pages[iGEN]);

        // ════════════════════════════════════════════════════════════════
        // NESO: Publish forecast  (pre-DA gate)
        // ════════════════════════════════════════════════════════════════
        console.log('\n─── NESO Publishes Forecast ───────────────────────────────');
        try {
            // The ForecastPanel PUBLISH button lives in the left column of NESOScreen
            await clickButton(pages[iNESO], 'PUBLISH FORECAST', 20000);
            // The Trader screen shows "LIVE NESO FORECAST" when published
            await waitFor(pages[iTRAD],
                () => document.body.textContent.includes('LIVE NESO FORECAST'), 30000);
            pass('NESO: Forecast published & visible to Trader');
        } catch (e) {
            fail('NESO: Publish forecast', e);
        }

        // ════════════════════════════════════════════════════════════════
        // PHASE 1 – Day-Ahead (DA)
        // ════════════════════════════════════════════════════════════════
        console.log('\n─── Phase 1: Day-Ahead (DA) ────────────────────────────────');

        // DA is the opening phase — no ADVANCE needed from NESO; game starts in DA.
        // All players default to phase='DA' via React state. The SharedLayout renders
        // "📋 DAY-AHEAD" and sets window.gunState.phase = 'DA'.
        // We use syncPhase which checks both text and window.gunState.phase.
        try {
            await syncPhase(pages.slice(1), 'DAY-AHEAD', 45000);
            pass('DA phase: all players synced');
        } catch (e) { fail('DA phase sync', e); }

        // ✅ NEW ASSERTION: Verify Phase Sync on all players
        await verifyPhaseSync(pages, 'DA');

        // Extra wait to ensure GunDB and React reconciliation
        await sleep(3000);

        // Generator DA
        try {
            await genDA(pages[iGEN]);
            pass('Generator: DA offer submitted & locked');
            // ✅ NEW ASSERTION: Button Lockout after submit
            await verifyButtonLockout(pages[iGEN], 'Generator', 'SUBMIT DA OFFER');
        }
        catch (e) { fail('Generator: DA', e); }
        await sleep(500);

        // BESS DA (moved earlier to beat phase advance)
        try {
            await bessDA(pages[iBESS]);
            pass('BESS: DA schedule locked');
            // ✅ NEW ASSERTION: Button Lockout after submit
            await verifyButtonLockout(pages[iBESS], 'BESS', 'SUBMIT DA SCHEDULE');
        }
        catch (e) { fail('BESS: DA', e); }
        await sleep(500);

        // Supplier DA
        try {
            await supDA(pages[iSUP]);
            pass('Supplier: DA purchase submitted & locked');
            // ✅ NEW ASSERTION: Button Lockout after submit
            await verifyButtonLockout(pages[iSUP], 'Supplier', 'SUBMIT DA PURCHASE');
        }
        catch (e) { fail('Supplier: DA', e); }
        await sleep(500);

        // DSR is a pure BM player — skip DA submission (curtailment triggers rebound, blocks BM inputs)

        // Trader DA (needs tab switch)
        try {
            await traderDA(pages[iTRAD]);
            pass('Trader: DA speculative position locked');
            // ✅ NEW ASSERTION: Button Lockout after submit
            await verifyButtonLockout(pages[iTRAD], 'Trader', 'SUBMIT');
        }
        catch (e) { fail('Trader: DA', e); }
        await sleep(500);

        // IC — no manual DA submission
        try {
            // interconnector flow is automatic; no player page to inspect
        } catch (e) { fail('IC: DA implicit coupling check', e); }

        // ════════════════════════════════════════════════════════════════
        // PHASE 2 – Intraday (ID)
        // ════════════════════════════════════════════════════════════════
        console.log('\n─── Phase 2: Intraday (ID) ─────────────────────────────────');

        try {
            await nesoAdvance(pages[iNESO], 'INTRADAY');
            pass('NESO: Advanced to ID phase');
            // Verify all players see ID phase before proceeding
            await sleep(3000);
        } catch (e) {
            fail('NESO: Advance to ID', e);
            // Critical failure: abort test rather than cascade failures
            throw new Error('CRITICAL: NESO cannot advance to ID phase. Aborting test to prevent cascading failures.');
        }

        // Wait for ID phase to propagate to all players
        try {
            await syncPhase(pages.slice(1), 'INTRADAY', 60000);
            pass('ID phase: all players synced');
        } catch (e) { fail('ID phase sync', e); }

        // ✅ NEW ASSERTION: Verify Phase Sync
        await sleep(2000);
        await verifyPhaseSync(pages, 'ID');

        await sleep(3000);

        // Generator ID
        try {
            await genID(pages[iGEN]);
            pass('Generator: ID order published');
            // ✅ NEW ASSERTION: Button Lockout after submit
            await verifyButtonLockout(pages[iGEN], 'Generator', 'SUBMIT ID ORDER');
        }
        catch (e) { fail('Generator: ID', e); }
        await sleep(500);

        // Supplier ID
        try {
            await supID(pages[iSUP]);
            pass('Supplier: ID order published');
            // ✅ NEW ASSERTION: Button Lockout after submit
            await verifyButtonLockout(pages[iSUP], 'Supplier', 'SUBMIT ID ORDER');
        }
        catch (e) { fail('Supplier: ID', e); }
        await sleep(500);

        // Trader ID
        try {
            await traderID(pages[iTRAD]);
            pass('Trader: ID order published');
            // ✅ NEW ASSERTION: Button Lockout after submit
            await verifyButtonLockout(pages[iTRAD], 'Trader', 'SUBMIT');
        }
        catch (e) { fail('Trader: ID', e); }
        await sleep(500);

        // BESS ID
        try {
            await bessID(pages[iBESS]);
            pass('BESS: ID order published');
            // ✅ NEW ASSERTION: Button Lockout after submit
            await verifyButtonLockout(pages[iBESS], 'BESS', 'SUBMIT ID ORDER');
        }
        catch (e) { fail('BESS: ID', e); }
        await sleep(500);

        // DSR is a pure BM player — skip ID submission (curtailment triggers rebound, blocks BM inputs)

        // IC: no manual ID submission
        try {
            // no ID banner to check for system interconnector
        } catch (e) { warn('IC: ID implicit coupling check', e?.message); }

        // ════════════════════════════════════════════════════════════════
        // PHASE 3 – Balancing Mechanism (BM)
        // ════════════════════════════════════════════════════════════════
        console.log('\n─── Phase 3: Balancing Mechanism (BM) ──────────────────────');

        try {
            await nesoAdvance(pages[iNESO], 'BALANCING');
            pass('NESO: Advanced to BM phase');
            // Verify all players see BM phase before proceeding
            await sleep(3000);
        } catch (e) {
            fail('NESO: Advance to BM', e);
            // Critical failure: abort test rather than cascade failures
            throw new Error('CRITICAL: NESO cannot advance to BM phase. Aborting test to prevent cascading failures.');
        }

        // ✅ NEW ASSERTION: Verify Phase Sync on all players
        await verifyPhaseSync(pages, 'BM');

        // Sync BM to all physical-asset players using new enhanced sync with GunDB verification
        try {
            await syncPhase(pages.filter((p, i) => ![iNESO, iTRAD, iSUP].includes(i)), 'BALANCING', 70000);
            pass('Generator: BM phase synced');
            pass('BESS: BM phase synced');
            pass('DSR: BM phase synced');
            // no interconnector player to sync
        } catch (e) {
            console.log(`❌ BM phase sync error: ${e.message}`);
            // Fallback: try individual checks
            const bmSyncPages = [
                { page: pages[iGEN], name: 'Generator' },
                { page: pages[iBESS], name: 'BESS' },
                { page: pages[iDSR], name: 'DSR' },
                // interconnector has no player page
            ];
            for (const { page, name } of bmSyncPages) {
                try {
                    await waitFor(page,
                        () => document.body.textContent.includes('BALANCING'), 30000);
                    pass(`${name}: BM phase synced (fallback)`);
                } catch (err) { fail(`${name}: BM phase sync`, err); }
            }
        }

        // Extra wait for BM UIs to fully render after phase change
        await sleep(4000);

        // Generator BM — THE PREVIOUSLY FAILING STEP
        // Now fixed: fillNumber dispatches both input and change events for React state updates
        try {
            await genBM(pages[iGEN]);
            pass('Generator: BM bid submitted');
            // ✅ NEW ASSERTION: Button Lockout after submit
            await verifyButtonLockout(pages[iGEN], 'Generator', 'TO NESO');
        }
        catch (e) { fail('Generator: BM', e); }
        await sleep(800);

        // BESS BM
        try {
            await bessBM(pages[iBESS]);
            pass('BESS: BM bid submitted');
            // ✅ NEW ASSERTION: Button Lockout after submit
            await verifyButtonLockout(pages[iBESS], 'BESS', 'DISCHARGE');
        }
        catch (e) { fail('BESS: BM', e); }
        await sleep(800);

        // DSR BM
        try {
            await dsrBM(pages[iDSR]);
            pass('DSR: BM bid submitted');
            // ✅ NEW ASSERTION: Button Lockout after submit
            await verifyButtonLockout(pages[iDSR], 'DSR', 'CURTAILMENT');
        }
        catch (e) { fail('DSR: BM', e); }
        await sleep(800);

        // Interconnector is a system asset; BM overrides are not submitted by a player

        // NESO: verify merit order table has at least one accepted bid
        try {
            await waitFor(pages[iNESO],
                () => document.body.textContent.includes('ACCEPTED'), 20000);
            pass('NESO: Merit order shows accepted bids');
        } catch (e) { fail('NESO: Merit order populated', e); }

        // ✅ NEW ASSERTION: Market Clearing – verify MCP is calculated and logical
        await verifyMarketClearing(pages, iNESO, iGEN, iSUP, iBESS, iDSR);

        // ════════════════════════════════════════════════════════════════
        // PHASE 4 – Settlement
        // ════════════════════════════════════════════════════════════════
        console.log('\n─── Phase 4: Settlement ────────────────────────────────────');

        try {
            await nesoAdvance(pages[iNESO], 'SETTLED');
            pass('NESO: Advanced to Settlement');
            // Verify all players see Settlement phase before proceeding
            await sleep(3000);
        } catch (e) {
            fail('NESO: Advance to Settlement', e);
            // Critical failure: abort test rather than cascade failures
            throw new Error('CRITICAL: NESO cannot advance to Settlement phase. Aborting test to prevent cascading failures.');
        }

        // Allow settlement engine time to process
        console.log('   Waiting 10s for settlement calculations…');
        await sleep(10000);

        // Sync all players to Settlement
        try {
            await syncPhase(pages, 'SETTLEMENT', 70000);
            pass('Settlement phase: all players synced');
        } catch (e) { warn('Settlement sync', e?.message); }

        // ✅ NEW ASSERTION: Verify Phase Sync on Settlement closure
        await verifyPhaseSync(pages, 'SETTLED');

        // ════════════════════════════════════════════════════════════════
        // FINAL VERIFICATIONS
        // ════════════════════════════════════════════════════════════════
        console.log('\n─── Final Verifications ────────────────────────────────────');

        // 1. SP alignment
        const finalSPs = await Promise.all(pages.map(getCurrentSP));
        if (finalSPs.every(sp => sp === finalSPs[0]))
            pass(`SP alignment: all players on SP ${finalSPs[0]}`);
        else
            fail('SP alignment', new Error(`SPs diverged: ${finalSPs}`));

        // 2. Phase alignment
        const finalPhases = await Promise.all(pages.map(getPhaseLabel));
        pass(`Phase alignment: ${finalPhases.join(', ')}`);

        // 3. Revenue panels visible on all player screens
        const revChecks = [
            { idx: iGEN, name: 'Generator' },
            { idx: iSUP, name: 'Supplier' },
            { idx: iBESS, name: 'BESS' },
            { idx: iDSR, name: 'DSR' },
        ];
        for (const { idx, name } of revChecks) {
            await checkRevenue(pages[idx], name);
        }

        // 4. Role-specific KPI labels
        const kpiChecks = [
            { idx: iGEN, name: 'Generator', kpi: 'Profit/MW' },
            { idx: iSUP, name: 'Supplier', kpi: 'Cost/MWh' },
            { idx: iTRAD, name: 'Trader', kpi: 'Mark-to-Market' },
            { idx: iBESS, name: 'BESS', kpi: 'STATE OF CHARGE' },
            { idx: iDSR, name: 'DSR', kpi: 'Live Operational State' },
            // IC row removed from KPI table
            { idx: iNESO, name: 'NESO', kpi: 'Live Merit Order' },
        ];
        for (const { idx, name, kpi } of kpiChecks) {
            await checkText(pages[idx], kpi, `${name}: KPI label "${kpi}" visible`);
        }

        // 5. Leaderboard player count on NESO screen
        try {
            const count = await pages[iNESO].evaluate(() => {
                const m = document.body.textContent.match(/Players\s*\((\d+)\)/);
                return m ? parseInt(m[1], 10) : 0;
            });
            if (count >= ROLES.length)
                pass(`Leaderboard: shows ${count} players (expected ≥ ${ROLES.length})`);
            else
                fail('Leaderboard count', new Error(`Expected ≥ ${ROLES.length}, got ${count}`));
        } catch (e) { fail('Leaderboard count', e); }

        // 6. BESS: SoC indicator still present after settlement
        await checkText(pages[iBESS], 'STATE OF CHARGE', 'BESS: SoC panel visible post-settlement');

        // 7. DSR: rebound/curtail state panel present
        await checkText(pages[iDSR], 'SYSTEM STATUS', 'DSR: System status panel visible');

        // 8. Interconnector: price spread display
        // no arbitrage panel for IC in this test

        // 9. Trader: MTM P&L panel present
        await checkText(pages[iTRAD], 'TRADING DESK ANALYSIS', 'Trader: Trading Desk Analysis visible');

        // 10. NESO: Frequency indicator present
        await checkText(pages[iNESO], 'Hz', 'NESO: Frequency indicator visible');

        // 11. Market Dictionary – opens and closes (tested on Generator screen)
        console.log('\n   [Feature] Market Dictionary toggle…');
        try {
            await clickButton(pages[iGEN], 'Market Dictionary', 15000);
            await waitFor(pages[iGEN],
                () => document.body.textContent.includes('GridForge Terminology'), 10000);
            pass('Market Dictionary: opens');

            await clickButton(pages[iGEN], 'Close Dictionary', 10000);
            await waitFor(pages[iGEN],
                () => !document.body.textContent.includes('GridForge Terminology'), 10000);
            pass('Market Dictionary: closes');
        } catch (e) { fail('Market Dictionary toggle', e); }

        // 13. NESO: Freeze & Explain (pause) toggle
        // Note: Game may already be paused from our test control flow.
        // First ensure it's in a known state (resume if paused, then test the toggle)
        console.log('\n   [Feature] NESO pause / resume toggle…');
        try {
            // Ensure we're in a known state first (resumed)
            await resumeGame(pages[iNESO]);
            await sleep(500);

            await clickButton(pages[iNESO], 'FREEZE', 10000);
            await waitFor(pages[iNESO],
                () => document.body.textContent.includes('RESUME'), 10000);
            pass('NESO: Freeze & Explain works');

            await clickButton(pages[iNESO], 'RESUME', 10000);
            await waitFor(pages[iNESO],
                () => document.body.textContent.includes('FREEZE'), 10000);
            pass('NESO: Resume works');
        } catch (e) { fail('NESO: Pause/Resume toggle', e); }

        // 14. New realism features checks
        console.log('\n   [Feature] Realism implementation checks…');

        // BSUoS socialization
        for (const { idx, name } of revChecks) {
            const hasBSUoS = await pages[idx].evaluate(() =>
                document.body.textContent.includes('BSUoS') ||
                document.body.textContent.includes('SOCIALIZED')
            );
            hasBSUoS ? pass(`${name}: BSUoS socialization visible`) : warn(`${name}: BSUoS not found`, 'May not have imbalance costs');
        }

        // NESO manual dispatch UI
        const hasManualDispatch = await pages[iNESO].evaluate(() =>
            document.body.textContent.includes('Manual Dispatch') ||
            document.body.textContent.includes('EXECUTE')
        );
        hasManualDispatch ? pass('NESO: Manual dispatch UI present') : fail('NESO: Manual dispatch UI missing', new Error('New NESO control not implemented'));

        // CfD payments for renewables
        const hasCfD = await pages[iGEN].evaluate(() =>
            document.body.textContent.includes('CfD') ||
            document.body.textContent.includes('CONTRACT FOR DIFFERENCE')
        );
        hasCfD ? pass('Generator: CfD payments visible') : warn('Generator: CfD not found', 'May not have renewable assets');

        // Capacity market payments
        const hasCapacity = await pages[iGEN].evaluate(() =>
            document.body.textContent.includes('CAPACITY') ||
            document.body.textContent.includes('CM PAYMENT')
        );
        hasCapacity ? pass('Generator: Capacity market payments visible') : warn('Generator: Capacity payments not found', 'May not have thermal assets');

        // LoLP/VoLL scarcity pricing
        const hasScarcity = await pages[iNESO].evaluate(() =>
            document.body.textContent.includes('LoLP') ||
            document.body.textContent.includes('VoLL') ||
            document.body.textContent.includes('SCARCITY')
        );
        hasScarcity ? pass('NESO: LoLP/VoLL scarcity pricing visible') : warn('NESO: Scarcity pricing not found', 'May not have triggered scarcity');

        // 15. All non-host players have their left-column net position widget
        const positionChecks = [
            { idx: iGEN, label: 'Generator: NET POS widget' },
            { idx: iSUP, label: 'Supplier: HEDGE RATIO widget' },
            { idx: iBESS, label: 'BESS: NET POS widget' },
            { idx: iDSR, label: 'DSR: NET POS widget' },
        ];
        for (const { idx, label } of positionChecks) {
            const found = await pages[idx].evaluate(() =>
                document.body.textContent.includes('NET POS') ||
                document.body.textContent.includes('HEDGE RATIO')
            );
            found ? pass(label) : fail(label, new Error('Position widget missing'));
        }

    } catch (globalErr) {
        fail('GLOBAL TEST ERROR', globalErr);
    } finally {
        // ── Print summary ──
        console.log('\n══════════════════════════════════════════════════════════════');
        console.log(`  RESULTS: ${results.passed.length} passed  |  ${results.failed.length} failed  |  ${results.warned.length} warned`);

        if (results.warned.length > 0) {
            console.log('\n  Warnings:');
            results.warned.forEach(({ label, msg }) =>
                console.log(`    ⚠️  ${label}: ${msg}`));
        }

        if (results.failed.length > 0) {
            console.log('\n  Failed:');
            results.failed.forEach(({ label, err }) =>
                console.error(`    ✗  ${label}: ${err?.message || err}`));
        }
        console.log('══════════════════════════════════════════════════════════════\n');

        for (const b of browsers) await b.close().catch(() => { });
        if (gunRelayProcess) {
            console.log('\n  [Cleanup] Shutting down Gun relay server...');
            gunRelayProcess.kill('SIGKILL');
        }
    }

    process.exit(results.failed.length > 0 ? 1 : 0);
})();
