import { open } from './verify.mjs';
const { browser, page } = await open();
await page.goto('http://localhost:3000/console/providers', { waitUntil: 'networkidle' });
const r = page.locator('tbody tr').first();
console.log('行 HTML 片段:', (await r.innerHTML()).replace(/\s+/g,' ').slice(0, 700));
await browser.close();
