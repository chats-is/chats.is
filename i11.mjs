import { open } from './verify.mjs';
const { browser, page } = await open();
await page.goto('http://localhost:3000/console/providers', { waitUntil: 'networkidle' });
const r = page.locator('tbody tr').filter({ hasText: 'VP17883531' }).first();
const btns = r.locator('button');
for (let i=0;i<await btns.count();i++) {
  const b = btns.nth(i);
  console.log(i, 'text=', JSON.stringify(await b.innerText()),
    'aria=', await b.getAttribute('aria-label'),
    'title=', await b.getAttribute('title'),
    'svg=', (await b.innerHTML()).replace(/\s+/g,' ').slice(0,120));
}
await browser.close();
