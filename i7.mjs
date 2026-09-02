import { open } from './verify.mjs';
const { browser, page } = await open();
const calls = [];
page.on('request', r => { if (r.url().includes('_serverFn')) calls.push(['REQ', r.method(), r.url().split('/_serverFn/')[1]?.slice(0,70)]); });
page.on('response', async r => {
  if (r.url().includes('_serverFn')) {
    let body = '';
    try { body = (await r.text()).slice(0, 200); } catch {}
    calls.push(['RES', r.status(), r.url().split('/_serverFn/')[1]?.slice(0,50), body]);
  }
});
await page.goto('http://localhost:3000/console/providers', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /add provider/i }).click();
await page.waitForTimeout(700);
const d = page.locator('[role="dialog"]').last();
await d.getByPlaceholder('OpenAI').fill('VPY' + Date.now());
await d.locator('input').nth(1).fill('sk-verify-only');
calls.length = 0;
await d.getByRole('button', { name: 'Create' }).click();
await page.waitForTimeout(4000);
console.log('请求:'); for (const c of calls) console.log(' ', c.join(' | '));
console.log('全部 toast:', JSON.stringify(await page.locator('[data-sonner-toast], [role="status"]').allInnerTexts()));
await browser.close();
