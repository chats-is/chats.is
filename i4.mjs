import { open } from './verify.mjs';
const { browser, page } = await open();
await page.goto('http://localhost:3000/console/providers', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /new provider|add provider/i }).first().click();
await page.waitForTimeout(1000);
const d = page.locator('[role="dialog"]').last();
console.log('文本:', (await d.innerText()).replace(/\n/g,' | ').slice(0,260));
const ins = d.locator('input');
for (let i=0;i<await ins.count();i++)
  console.log('  in',i,'type='+await ins.nth(i).getAttribute('type'),'ph='+await ins.nth(i).getAttribute('placeholder'));
console.log('按钮:', JSON.stringify(await d.locator('button').allInnerTexts()));
await browser.close();
