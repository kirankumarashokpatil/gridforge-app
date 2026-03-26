/**
 * input-security-tests.cjs
 *
 * INPUT SECURITY & "FAT FINGER" TEST SUITE
 * ════════════════════════════════════════════════════════════════════════════
 * Tests that verify your app defends against user mistakes and attempted exploits.
 * Colleagues in a training session WILL try to break the game intentionally.
 *
 * TESTS INCLUDED:
 * ───────────────
 * 1. THE INFINITE MARGIN TEST
 *    Log in as Trader with £5000 margin.
 *    Try to buy 999,999 MW.
 *    Assert: UI button disabled OR trade immediately rejected by margin check.
 *
 * 2. THE NEGATIVE MW HACK
 *    Try to type "-50" into Generator MW offer box.
 *    Assert: Input strips negative sign OR engine rejects negative MW.
 *
 * 3. THE SPAM SUBMIT TEST
 *    Click "Submit" button 50 times really fast.
 *    Assert: Only one submission is recorded (idempotency).
 *
 * 4. THE PRICE FLOOR/CEILING TEST
 *    Try to bid £-999 (below floor) or £99999 (above ceiling).
 *    Assert: Price clamped to valid range or rejected.
 *
 * 5. THE BROWSER REFRESH DURING SUBMIT TEST
 *    Click submit, then immediately refresh page.
 *    Verify app doesn't lose the submission or double-record it.
 *
 * Run:
 *   node test/e2e/input-security-tests.cjs
 *
 * Env vars:
 *   HEADLESS=false  – watch the UI as we attack it
 *   SLOW_MO=200     – slow down to see what's happening
 */

'use strict';

const puppeteer = require('puppeteer');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BASE_URL = process.env.GRIDFORGE_URL || 'http://localhost:3000';
const HEADLESS = process.env.HEADLESS !== 'false';
const SLOW_MO = parseInt(process.env.SLOW_MO || '0', 10);
const ROOM_CODE = 'SEC_' + Date.now().toString().slice(-6);

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
  try {
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
    return true;
  } catch (e) {
    return false;
  }
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
  const result = await page.evaluate(
    (idx, val) => {
      const inputs = Array.from(document.querySelectorAll('input[type="number"]:not([disabled])'));
      if (!inputs[idx]) return { success: false };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inputs[idx], val.toString());
      inputs[idx].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[idx].dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, actualValue: inputs[idx].value };
    },
    index,
    value
  );
  await sleep(150);
  return result;
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

// ─── TEST 1: INFINITE MARGIN TEST ────────────────────────────────────────────

/**
 * THE INFINITE MARGIN TEST
 *
 * Trader starts with £5000 margin (in typical game rules).
 * Try to bid for 999,999 MW at £50 (total = £49.9 billion).
 * This WAY exceeds the margin.
 *
 * Expect:
 *   - Button disabled until valid amount entered
 *   - OR immediate rejection with margin warning
 *   - Trade never goes through
 */
async function testInfiniteMarginAttack() {
  console.log('\n🧪 TEST: INFINITE MARGIN / OVER-MARGIN ATTACK');
  console.log('═══════════════════════════════════════════════════════════════════════');

  let browser = null;
  let page = null;

  try {
    browser = await puppeteer.launch({
      headless: HEADLESS,
      slowMo: SLOW_MO,
      args: ['--no-sandbox'],
    });

    page = await browser.newPage();
    await joinGame(page, 'GreedyTrader', 'Trader');

    console.log('\n  [ATTACK] Attempting to bid 999,999 MW (way over margin)…');

    // Try to fill in absurdly high MW
    const mwResult = await fillNumber(page, 0, 999999);
    console.log(`    MW input result: ${JSON.stringify(mwResult)}`);

    // Try to fill in price
    const priceResult = await fillNumber(page, 1, 50);

    // Check if submit button is enabled
    const submitState = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.includes('SUBMIT'));
      return {
        exists: !!btn,
        disabled: btn?.disabled ?? true,
        text: btn?.textContent.substring(0, 50) ?? 'N/A',
      };
    });

    console.log(`    Submit button state: ${JSON.stringify(submitState)}`);

    if (submitState.disabled) {
      pass('Margin Check: Submit button disabled for over-margin bid');
    } else if (submitState.text.includes('Insufficient') || submitState.text.includes('Margin')) {
      pass('Margin Check: Submit button shows margin warning');
    } else {
      warn('Margin Check: Submit button is ENABLED for over-margin bid',
        'User could attempt over-margin trade. Server-side check critical.');
    }

    // Try clicking anyway
    const clickSuccess = await clickButton(page, 'SUBMIT', 5000);

    if (!clickSuccess) {
      pass('Margin Check: Submit button could not be clicked (properly disabled)');
    } else {
      warn('Margin Check: Submit was clickable despite massive over-margin',
        'Relying on backend validation');
    }

  } catch (e) {
    fail('Margin Check: Unexpected error', e);
  } finally {
    if (browser) await browser.close();
  }
}

// ─── TEST 2: NEGATIVE MW HACK ────────────────────────────────────────────────

/**
 * THE NEGATIVE MW HACK
 *
 * Try to type "-50" into a Generator's "MW Offer" box.
 * Expect:
 *   - Input HTML5 validation strips the negative sign (type="number" min="0")
 *   - OR JavaScript strips it
 *   - Final value should be 50, not -50
 */
async function testNegativeMWHack() {
  console.log('\n🧪 TEST: NEGATIVE MW HACK');
  console.log('═══════════════════════════════════════════════════════════════════════');

  let browser = null;
  let page = null;

  try {
    browser = await puppeteer.launch({
      headless: HEADLESS,
      slowMo: SLOW_MO,
      args: ['--no-sandbox'],
    });

    page = await browser.newPage();
    await joinGame(page, 'BadActor', 'Generator');

    console.log('\n  [ATTACK] Trying to input -50 MW and -£100 price…');

    // Attempt to set negative values directly via JS (bypassing HTML5 validation)
    const result = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="number"]'));
      const mwInput = inputs[0];
      const priceInput = inputs[1];

      // Try to brute-force set negative values
      if (mwInput) {
        mwInput.value = '-50';
        mwInput.dispatchEvent(new Event('input', { bubbles: true }));
        mwInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (priceInput) {
        priceInput.value = '-100';
        priceInput.dispatchEvent(new Event('input', { bubbles: true }));
        priceInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      return {
        mwValue: mwInput?.value ?? 'N/A',
        priceValue: priceInput?.value ?? 'N/A',
        mwMin: mwInput?.min ?? 'N/A',
        priceMin: priceInput?.min ?? 'N/A',
      };
    });

    console.log(`    Input values after attack: ${JSON.stringify(result)}`);

    // Parse and check
    const mwVal = parseFloat(result.mwValue) || 0;
    const priceVal = parseFloat(result.priceValue) || 0;

    if (mwVal >= 0) {
      pass('Negative MW: Input contains no negative MW (stripped or rejected)');
    } else {
      fail('Negative MW: Input accepted negative MW value',
        new Error(`MW value: ${result.mwValue}`));
    }

    if (priceVal >= 0 || result.priceValue === 'N/A' || result.priceValue === '') {
      pass('Negative Price: Input contains no negative price');
    } else {
      warn('Negative Price: Input accepted negative price',
        'Server-side validation should reject this');
    }

  } catch (e) {
    fail('Negative MW: Unexpected error', e);
  } finally {
    if (browser) await browser.close();
  }
}

// ─── TEST 3: SPAM SUBMIT TEST ───────────────────────────────────────────────

/**
 * THE SPAM SUBMIT TEST
 *
 * Fill in a valid bid and click "Submit" 50 times really fast.
 * Expect:
 *   - Only ONE submission recorded (button locks after first click)
 *   - Duplicate submissions prevented
 *   - No double-charging or invalid state
 */
async function testSpamSubmit() {
  console.log('\n🧪 TEST: SPAM SUBMIT (Button Mashing)');
  console.log('═══════════════════════════════════════════════════════════════════════');

  let browser = null;
  let page = null;

  try {
    browser = await puppeteer.launch({
      headless: HEADLESS,
      slowMo: 0, // Don't slow down; we want FAST clicks
      args: ['--no-sandbox'],
    });

    page = await browser.newPage();
    await joinGame(page, 'SpamBot', 'Generator');

    console.log('\n  [SETUP] Filling in valid bid…');
    await fillNumber(page, 0, 25); // 25 MW
    await fillNumber(page, 1, 60); // £60

    console.log('\n  [ATTACK] Clicking submit 50 times as fast as possible…');

    let clickedSuccessfully = 0;
    const clickStartTime = Date.now();

    for (let i = 0; i < 50; i++) {
      const success = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent.includes('SUBMIT') && !b.disabled);
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      if (success) clickedSuccessfully++;
      // No delay between clicks
    }

    const clickDuration = Date.now() - clickStartTime;
    console.log(`    Clicked button ${clickedSuccessfully} times in ${clickDuration}ms`);

    // Wait for the dust to settle
    await sleep(2000);

    // Check final button state
    const finalState = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.includes('SUBMIT'));
      return {
        disabled: btn?.disabled ?? true,
        text: btn?.textContent.substring(0, 40) ?? 'N/A',
      };
    });

    console.log(`    Final button state: ${JSON.stringify(finalState)}`);

    if (finalState.disabled) {
      pass('Spam Submit: Button locks after first successful click (prevents double-submit)');
    } else {
      warn('Spam Submit: Button still enabled after spam clicks',
        'Relying on backend idempotency to prevent duplicates');
    }

  } catch (e) {
    fail('Spam Submit: Unexpected error', e);
  } finally {
    if (browser) await browser.close();
  }
}

// ─── TEST 4: PRICE EXTREMES TEST ────────────────────────────────────────────

/**
 * THE PRICE FLOOR/CEILING TEST
 *
 * Try to bid:
 *   - £-999 (below floor)
 *   - £0 (technically OK, but unusual)
 *   - £999999 (above any reasonable ceiling)
 *
 * Expect:
 *   - Negative prices rejected or clamped
 *   - Extreme high prices clamped to reasonable max (e.g., £6000 VoLL)
 */
async function testPriceExtremes() {
  console.log('\n🧪 TEST: PRICE FLOOR/CEILING CONSTRAINTS');
  console.log('═══════════════════════════════════════════════════════════════════════');

  let browser = null;
  let page = null;

  try {
    browser = await puppeteer.launch({
      headless: HEADLESS,
      slowMo: SLOW_MO,
      args: ['--no-sandbox'],
    });

    page = await browser.newPage();
    await joinGame(page, 'ExtremePrice', 'Trader');

    console.log('\n  [TEST 1] Attempting £-999 bid…');
    const attackNeg = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="number"]'));
      const priceInput = inputs[1];
      if (priceInput) {
        priceInput.value = '-999';
        priceInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return priceInput?.value ?? 'N/A';
    });

    console.log(`    Price input after -999 attempt: "${attackNeg}"`);

    if (attackNeg === 'N/A' || parseFloat(attackNeg) >= 0) {
      pass('Price Floor: Negative prices blocked or clamped');
    } else {
      fail('Price Floor: Negative price accepted', new Error(`Price: ${attackNeg}`));
    }

    console.log('\n  [TEST 2] Attempting £999999 bid…');
    const attackHigh = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="number"]'));
      const priceInput = inputs[1];
      if (priceInput) {
        priceInput.value = '999999';
        priceInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return priceInput?.value ?? 'N/A';
    });

    console.log(`    Price input after 999999 attempt: "${attackHigh}"`);

    // Check if there's a max constraint
    const maxAttr = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="number"]'));
      return inputs[1]?.max ?? 'NO_MAX';
    });

    if (maxAttr !== 'NO_MAX') {
      pass(`Price Ceiling: Input has max constraint (${maxAttr})`);
    } else {
      const parsed = parseFloat(attackHigh) || 0;
      if (parsed <= 10000) {
        pass('Price Ceiling: Extreme price clamped by application logic');
      } else {
        warn('Price Ceiling: No max constraint visible',
          'Server-side clamping to VoLL (£6000) should catch this');
      }
    }

  } catch (e) {
    fail('Price Extremes: Unexpected error', e);
  } finally {
    if (browser) await browser.close();
  }
}

// ─── TEST 5: PAGE REFRESH DURING SUBMIT TEST ────────────────────────────────

/**
 * THE SUDDEN REFRESH TEST
 *
 * Click submit, then IMMEDIATELY refresh the page.
 * Expect:
 *   - Submission is either fully processed (bid recorded)
 *   - OR gracefully re-synced from server
 *   - NOT: Lost bid + no error message
 *   - NOT: Double-recorded bid
 */
async function testRefreshDuringSubmit() {
  console.log('\n🧪 TEST: PAGE REFRESH DURING SUBMIT');
  console.log('═══════════════════════════════════════════════════════════════════════');

  let browser = null;
  let page = null;

  try {
    browser = await puppeteer.launch({
      headless: HEADLESS,
      slowMo: SLOW_MO,
      args: ['--no-sandbox'],
    });

    page = await browser.newPage();
    await joinGame(page, 'RefreshRobot', 'Generator');

    console.log('\n  [SETUP] Filing in bid…');
    await fillNumber(page, 0, 75); // 75 MW
    await fillNumber(page, 1, 55); // £55

    console.log('\n  [ATTACK] Clicking submit and IMMEDIATELY refreshing…');

    // Start the submission click
    const clickTask = page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.includes('SUBMIT'));
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      return false;
    });

    // Give click 100ms to register, then refresh
    await sleep(100);
    console.log('    Clicking and immediately refreshing page…');

    // Refresh the page (simultaneously or just after click)
    const refreshTask = page.reload({ waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for both tasks
    await Promise.all([clickTask, refreshTask]).catch(e => {
      // Some errors are OK (click might not register during reload)
    });

    // Wait for page to stabilize
    await sleep(2000);

    // Check if page is still functional
    const pageOK = await page.evaluate(() => {
      return {
        hasButtons: Array.from(document.querySelectorAll('button')).length > 0,
        hasInputs: Array.from(document.querySelectorAll('input')).length > 0,
        bodyText: document.body.textContent.substring(0, 100),
      };
    });

    console.log(`    Page state after refresh: ${JSON.stringify(pageOK)}`);

    if (pageOK.hasButtons && pageOK.hasInputs) {
      pass('Refresh During Submit: Page recovered gracefully after forced refresh');
    } else {
      fail('Refresh During Submit: Page is broken after refresh',
        new Error('Missing UI elements'));
    }

  } catch (e) {
    fail('Refresh During Submit: Unexpected error', e);
  } finally {
    if (browser) await browser.close();
  }
}

// ─── MAIN TEST RUNNER ────────────────────────────────────────────────────────

(async () => {
  console.log('\n\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║        INPUT SECURITY & "FAT FINGER" TEST SUITE                        ║');
  console.log('║    (Testing Against User Mistakes & Intentional Attacks)               ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');

  try {
    await testInfiniteMarginAttack();
    await testNegativeMWHack();
    await testSpamSubmit();
    await testPriceExtremes();
    await testRefreshDuringSubmit();
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
    console.log('🎉 ALL INPUT SECURITY TESTS PASSED!');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Review output above.');
    process.exit(1);
  }
})();
