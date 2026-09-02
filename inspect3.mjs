import { open } from './verify.mjs';
const { browser, page, errs } = await open();
await page.goto('http://localhost:3000/console/quotas', { waitUntil: 'networkidle' });
const rows = page.locator('tbody tr');
console.log('行数:', await rows.count());
const r = rows.first();
console.log('首行:', (await r.innerText()).replace(/\n/g,' | '));
const btns = r.locator('button');
console.log('行内按钮数:', await btns.count());
for (let i=0;i<await btns.count();i++)
  console.log('  ',i, JSON.stringify(await btns.nth(i).innerText()), 'aria=', await btns.nth(i).getAttribute('aria-label'));
await btns.last().click();
await page.waitForTimeout(1200);
console.log('alertdialog:', await page.getByRole('alertdialog').count(), '| dialog:', await page.locator('[role="dialog"]').count());
const any = page.locator('[role="alertdialog"], [role="dialog"]').last();
if (await any.count()) {
  console.log('弹窗文本:', (await any.innerText()).replace(/\n/g,' | ').slice(0,200));
  console.log('弹窗按钮:', JSON.stringify(await any.locator('button').allInnerTexts()));
}
console.log('错误:', errs.slice(0,3));
await browser.close();
