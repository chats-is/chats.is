import { open } from './verify.mjs';
const { browser, page, errs } = await open();
await page.goto('http://localhost:3000/console/users', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const rows = page.locator('tbody tr');
for (let i=0;i<await rows.count();i++)
  console.log('行', i, ':', (await rows.nth(i).innerText()).replace(/\n/g,' | ').slice(0,120));
console.log('错误:', errs.slice(0,3));
await browser.close();
