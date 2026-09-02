import { open } from './verify.mjs';
const { browser, page } = await open();
await page.goto('http://localhost:3000/console/providers', { waitUntil: 'networkidle' });
await page.locator('tbody tr').filter({ hasText: 'DeepSeek' }).first().locator('button').nth(0).click();
for (let i=0;i<30;i++){ if (await page.locator('[role="dialog"] input[type="checkbox"]').count()) break; await page.waitForTimeout(1000);}
const d = page.locator('[role="dialog"]').last();
console.log('候选:', (await d.innerText()).replace(/\n/g,' | ').slice(0,400));
await browser.close();
