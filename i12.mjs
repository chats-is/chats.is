import { open } from './verify.mjs';
const { browser, page } = await open();
await page.goto('http://localhost:3000/console/models', { waitUntil: 'networkidle' });
console.log('按钮:', JSON.stringify((await page.locator('button').allInnerTexts()).filter(t=>t.trim())));
const r = page.locator('tbody tr').first();
console.log('首行:', (await r.innerText()).replace(/\n/g,' | '));
console.log('行内按钮:', await r.locator('button').count(), '| switch:', await r.locator('[role="switch"]').count());
await page.getByRole('button', { name: /add model|new model/i }).first().click();
await page.waitForTimeout(1000);
const d = page.locator('[role="dialog"]').last();
console.log('对话框:', (await d.innerText()).replace(/\n/g,' | ').slice(0,240));
const ins = d.locator('input');
for (let i=0;i<Math.min(6,await ins.count());i++)
  console.log('  in',i,'id='+await ins.nth(i).getAttribute('id'),'ph='+await ins.nth(i).getAttribute('placeholder'));
console.log('按钮:', JSON.stringify((await d.locator('button').allInnerTexts()).filter(t=>t.trim())));
await browser.close();
