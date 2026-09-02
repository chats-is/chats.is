import { open } from './verify.mjs';
const { browser, page } = await open();
await page.goto('http://localhost:3000' + process.argv[2], { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log('按钮:', JSON.stringify(await page.locator('button').allInnerTexts()));
console.log('表头:', JSON.stringify(await page.locator('thead th').allInnerTexts()));
console.log('行数:', await page.locator('tbody tr').count());
const r = page.locator('tbody tr').first();
if (await r.count()) {
  console.log('首行:', JSON.stringify((await r.innerText()).replace(/\n/g,' | ')));
  console.log('首行按钮:', JSON.stringify(await r.locator('button').allInnerTexts()),
              '数量', await r.locator('button').count());
}
await browser.close();
