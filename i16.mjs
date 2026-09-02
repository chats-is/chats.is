import { open } from './verify.mjs';
const { browser, page } = await open();
await page.goto('http://localhost:3000' + process.argv[2], { waitUntil: 'networkidle' });
console.log('按钮:', JSON.stringify((await page.locator('button').allInnerTexts()).filter(t=>t.trim()).slice(0,10)));
const r = page.locator('tbody tr').first();
if (await r.count()) {
  console.log('首行:', (await r.innerText()).replace(/\n/g,' | ').slice(0,140));
  console.log('行内按钮:', await r.locator('button').count(), '| switch:', await r.locator('[role="switch"]').count(),
              '| combobox:', await r.locator('[role="combobox"]').count());
}
const add = page.getByRole('button', { name: /new|add|create/i }).first();
if (await add.count()) {
  await add.click(); await page.waitForTimeout(1000);
  const d = page.locator('[role="dialog"]').last();
  console.log('对话框:', (await d.innerText()).replace(/\n/g,' | ').slice(0,220));
  const ins = d.locator('input, textarea');
  for (let i=0;i<Math.min(5,await ins.count());i++)
    console.log('  in',i,'id='+await ins.nth(i).getAttribute('id'),'ph='+await ins.nth(i).getAttribute('placeholder'));
  console.log('按钮:', JSON.stringify((await d.locator('button').allInnerTexts()).filter(t=>t.trim()).slice(0,8)));
}
await browser.close();
