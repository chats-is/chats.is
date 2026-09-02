import { open } from './verify.mjs';
const { browser, page } = await open();
const pages = process.argv.slice(2);
for (const p of pages) {
  await page.goto('http://localhost:3000' + p, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const vals = await page.locator('[data-slot="select-value"], [role="combobox"]').allInnerTexts();
  const suspicious = vals.map(v => v.trim()).filter(v =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v) || /^__/.test(v) || /^\d+$/.test(v));
  console.log(p.padEnd(26), '触发器文本:', JSON.stringify(vals.map(v=>v.trim()).slice(0,6)),
              suspicious.length ? ' ← 疑似原始值: ' + JSON.stringify(suspicious) : '');
}
await browser.close();
