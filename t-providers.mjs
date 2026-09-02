import { open, report } from './verify.mjs';
import { helpers } from './lib.mjs';
const { browser, page, errs } = await open();
const h = helpers(page);
const N = 'VP' + Date.now();

await page.goto('http://localhost:3000/console/providers', { waitUntil: 'networkidle' });

// createProvider
await page.getByRole('button', { name: /add provider/i }).click();
await page.waitForTimeout(700);
let d = h.dlg();
await d.getByPlaceholder('OpenAI').fill(N);
await d.locator('#apiKey').fill('sk-verify-only');
await d.getByRole('button', { name: 'Create' }).click();
report('createProvider → 列表出现', await h.appear(N), N, errs);

// toggleEnabledProvider（行内开关）
const sw = h.row(N).first().locator('[role="switch"]').first();
const before = await sw.getAttribute('aria-checked').catch(() => null);
await sw.click();
await page.waitForTimeout(2500);
await page.waitForTimeout(1500);
const after = await h.row(N).first().locator('[role="switch"]').first()
  .getAttribute('aria-checked').catch(() => null);
report('toggleEnabledProvider', before !== after && after !== null,
  `aria-checked ${before} → ${after}`, errs);

// updateProvider
await h.row(N).first().locator('button').nth(1).click();
await page.waitForTimeout(700);
d = h.dlg();
await d.getByPlaceholder('OpenAI').fill(N + '-E');
await d.getByRole('button', { name: /save|update/i }).click();
report('updateProvider → 列表刷新', await h.appear(N + '-E'), N + '-E', errs);

// deleteProvider
await h.row(N + '-E').first().locator('button').nth(2).click();
await page.waitForTimeout(700);
await h.confirm();
report('deleteProvider → 列表移除', await h.vanish(N), '已消失', errs);

await browser.close();
