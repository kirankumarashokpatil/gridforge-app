/**
 * Quick 2-player diagnostic test
 */
'use strict';
const puppeteer = require('puppeteer');

const BASE_URL = process.env.GRIDFORGE_URL || 'http://localhost:5173';
const ROOM = 'DG' + Date.now().toString().slice(-5);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fillAndJoin(page, name, room) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);
  
  // Use Puppeteer's native typing which triggers React's onChange properly
  const nameInput = await page.$('input[placeholder*="Alice"]');
  const roomInput = await page.$('input[placeholder*="ALPHA"]');
  
  if (nameInput) {
    await nameInput.click({ clickCount: 3 }); // select all
    await nameInput.type(name, { delay: 20 });
  }
  if (roomInput) {
    await roomInput.click({ clickCount: 3 }); // select all
    await roomInput.type(room, { delay: 20 });
  }
  
  await sleep(500);
  
  // Verify inputs are filled
  const inputState = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    return Array.from(inputs).map(i => ({ placeholder: i.placeholder, value: i.value }));
  });
  console.log('  Input state:', JSON.stringify(inputState));
  
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('JOIN WAITING ROOM'));
    if (btn && !btn.disabled) btn.click();
  });
  await sleep(6000);
}

(async () => {
  console.log('ROOM:', ROOM);

  const B1 = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const B2 = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p1 = await B1.newPage();
  const p2 = await B2.newPage();
  p1.on('pageerror', e => console.log('P1_ERR:', e.message));
  p2.on('pageerror', e => console.log('P2_ERR:', e.message));
  
  // Intercept requests to see what's actually sent AND server responses
  await p1.setRequestInterception(true);
  p1.on('request', req => {
    const url = req.url();
    if (url.includes('/api/rooms/') && req.method() === 'POST') {
      console.log('P1_REQ:', req.method(), url, 'body:', req.postData());
    }
    req.continue();
  });
  p1.on('response', async res => {
    const url = res.url();
    if (url.includes('/api/rooms/') && url.includes('/players/')) {
      try {
        const body = await res.text();
        console.log('P1_RESP:', res.status(), url, 'body:', body.slice(0, 300));
      } catch {}
    }
  });
  
  // Test API reachability from browser
  const apiTest = await p1.evaluate(async () => {
    try {
      const r = await fetch('http://localhost:8000/api/rooms/APITEST/players');
      return { ok: r.ok, status: r.status, body: await r.text() };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('API reachability test:', JSON.stringify(apiTest));

  // Capture WaitingRoom debug logs
  p1.on('console', m => {
    const text = m.text();
    if (text.includes('[WaitingRoom]') || text.includes('[WebSocket]'))
      console.log('P1_LOG:', text);
  });

  try {
    // NESO joins first
    console.log('STEP 1: NESO join');
    await fillAndJoin(p1, 'NESOHost', ROOM);
    const nesoOk = await p1.evaluate(() => document.body.textContent.includes('NESO CONTROL'));
    console.log('  NESO CONTROL:', nesoOk);

    // Check the actual players state inside React
    const playersDbg = await p1.evaluate(() => {
      // Access React fiber to get state
      const root = document.querySelector('#root');
      if (!root?._reactRootContainer) {
        // React 18 approach — can't easily access
      }
      // Try querying the API directly
      return fetch('http://localhost:8000/api/rooms/' + document.body.textContent.match(/Room Code:(\w+)/)?.[1] + '/players')
        .then(r => r.json())
        .then(data => JSON.stringify(data.map(p => ({ id: p.player_id, name: p.name, last_seen: p.last_seen }))))
        .catch(e => 'FETCH_ERR: ' + e.message);
    });
    console.log('  API players:', playersDbg);

    // Wait for NESO to be fully registered in API before Player 2 joins
    console.log('  Waiting for NESO registration to propagate...');
    let nesoRegistered = false;
    for (let i = 0; i < 20; i++) {
      const count = await p1.evaluate(() => {
        const m = document.body.textContent.match(/PLAYERS IN ROOM \((\d+)\)/);
        return m ? parseInt(m[1]) : 0;
      });
      if (count >= 1) { nesoRegistered = true; break; }
      await sleep(500);
    }
    console.log('  NESO self-visible in player list:', nesoRegistered);
    
    // Debug: check React state directly
    const reactDebug = await p1.evaluate(() => {
      // Try to read the [WaitingRoom] debug log from console
      const text = document.body.textContent;
      return {
        hasPlayersInRoom: text.includes('PLAYERS IN ROOM'),
        fullText: text.replace(/\s+/g, ' ').slice(0, 800),
        playerCount: (text.match(/PLAYERS IN ROOM \((\d+)\)/) || ['', '?'])[1],
      };
    });
    console.log('  React state debug:', JSON.stringify(reactDebug, null, 2));

    // Player 2 joins
    console.log('STEP 2: Player join');
    await fillAndJoin(p2, 'TestTrader', ROOM);
    const p2body = await p2.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').slice(0, 300));
    console.log('  P2 body:', p2body);

    await sleep(3000);

    // Check if NESO sees the player
    const nesoBody = await p1.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').slice(0, 500));
    console.log('  NESO body:', nesoBody);

    const playerCount = await p1.evaluate(() => {
      const m = document.body.textContent.match(/PLAYERS IN ROOM \((\d+)\)/);
      return m ? m[1] : 'NO_MATCH';
    });
    console.log('  NESO player count:', playerCount);

    // Check player cards
    const cards = await p1.evaluate(() => {
      const els = document.querySelectorAll('[data-player-name]');
      return Array.from(els).map(e => e.getAttribute('data-player-name'));
    });
    console.log('  Player cards:', JSON.stringify(cards));

    // Try NESO assign TRADER to TestTrader
    if (cards.includes('TestTrader')) {
      const assignResult = await p1.evaluate(() => {
        const card = document.querySelector('[data-player-name="TestTrader"]');
        if (!card) return 'NO_CARD';
        const sel = card.querySelector('[data-testid="role-assign-select"]');
        if (!sel) return 'NO_SELECT';
        const opts = Array.from(sel.options).map(o => o.value + ':' + o.text);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, 'TRADER');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return 'OK (options: ' + opts.join(', ') + ')';
      });
      console.log('  Assign TRADER:', assignResult);
      await sleep(2000);

      // Check if player sees the assignment
      const p2state = await p2.evaluate(() => {
        const body = document.body.textContent;
        return {
          hasNotReady: body.includes('NOT READY (click to ready)'),
          hasWaiting: body.includes('WAITING FOR ASSIGNMENT'),
          hasTrader: body.includes('Trader'),
        };
      });
      console.log('  P2 state:', JSON.stringify(p2state));

      if (p2state.hasNotReady) {
        // Click READY
        await p2.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            b.textContent.includes('NOT READY'));
          if (btn) btn.click();
        });
        await sleep(2000);
        const isReady = await p2.evaluate(() => document.body.textContent.includes('\u2713 READY'));
        console.log('  P2 READY:', isReady);

        // Check if NESO can start
        const canStart = await p1.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            b.textContent.includes('START GAME'));
          return btn ? { text: btn.textContent.trim(), disabled: btn.disabled } : 'NOT_FOUND';
        });
        console.log('  NESO START button:', JSON.stringify(canStart));
      }
    } else {
      console.log('  WARNING: TestTrader not in cards, checking full body...');
    }

    console.log('\nDONE - All steps completed');
  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await B1.close().catch(() => {});
    await B2.close().catch(() => {});
    process.exit(0);
  }
})();
