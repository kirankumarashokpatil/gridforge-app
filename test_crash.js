import puppeteer from 'puppeteer';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    try {
        const browser = await puppeteer.launch({ headless: 'new' });
        const page = await browser.newPage();

        page.on('pageerror', err => {
            console.log('PAGE ERROR STR:', err.toString());
        });
        page.on('console', msg => {
            if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
        });

        console.log("Navigating...");
        await page.goto('http://localhost:5173');
        await sleep(1000);

        console.log("Clicking a role card (Generator by default)...");
        // simply pick the first visible role card (usually Generator)
        const roleBtns = await page.$$('button');
        for (const b of roleBtns) {
            const text = await page.evaluate(el => el.textContent, b);
            if (text.match(/Generator|System Operator|Supplier/)) {
                await b.click();
                break;
            }
        }
        await sleep(500);

        console.log("Entering name and room...");
        const inputs = await page.$$('input');
        await inputs[0].type('Puppeteer');
        await inputs[1].type('PUP');

        console.log("Clicking PICK YOUR ASSET...");
        const btns = await page.$$('button');
        for (const b of btns) {
            const text = await page.evaluate(el => el.textContent, b);
            if (text.includes('PICK YOUR ASSET')) {
                await b.click();
                break;
            }
        }
        await sleep(1000);

        // optionally pick an asset if one appears (e.g. OCGT generator)
        const assetCards = await page.$$('button');
        for (const a of assetCards) {
            const txt = await page.evaluate(el => el.textContent, a);
            if (txt.match(/OCGT|BESS|Battery/)) {
                await a.click();
                break;
            }
        }

        console.log("Waiting for dashboard crash...");
        await sleep(2000);
        await browser.close();
        console.log("Done");
    } catch (e) {
        console.error(e);
    }
})();
