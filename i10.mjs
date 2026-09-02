import { open } from './verify.mjs';
const { browser, page } = await open();
await page.goto('http://localhost:3000/console/providers', { waitUntil: 'networkidle' });
const r = page.locator('tbody tr').filter({ hasText: 'VP17883531' }).first();
console.log('目标行:', await r.count() ? (await r.innerText()).replace(/\n/g,' | ') : '不存在');
const btns = r.locator('button');
console.log('按钮数:', await btns.count());
await btns.first().click();
await page.waitForTimeout(1200);
const d = page.locator('[role="dialog"]').last();
console.log('对话框:', await d.count(), '|', (await d.innerText()).replace(/\n/g,' | ').slice(0,150));
const ins = d.locator('input');
for (let i=0;i<Math.min(4, await ins.count());i++)
  console.log('  in',i,'id='+await ins.nth(i).getAttribute('id'),'ph='+await ins.nth(i).getAttribute('placeholder'),'val='+JSON.stringify(await ins.nth(i).inputValue().catch(()=>'?')));
console.log('按钮:', JSON.stringify((await d.locator('button').allInnerTexts()).filter(t=>t.trim())));
await browser.close();
