import { open, report } from './verify.mjs';
import { helpers } from './lib.mjs';
const { browser, page, errs } = await open();
const h = helpers(page);
const N = 'VCP' + Date.now();

await page.goto('http://localhost:3000/console/prompts', { waitUntil: 'networkidle' });

// adminCreatePrompt
await page.getByRole('button', { name: 'Add Prompt' }).click();
await page.waitForTimeout(800);
let d = h.dlg();
await d.locator('#name').fill(N);
await d.locator('#content').fill('verification content');
await d.getByRole('button', { name: 'Create' }).click();
report('adminCreatePrompt → 列表出现', await h.appear(N), N, errs);

// adminUpdatePrompt
await h.row(N).first().locator('button').nth(0).click();
await page.waitForTimeout(900);
d = h.dlg();
await d.locator('#name').fill(N + '-E');
await d.getByRole('button', { name: /save|update/i }).click();
report('adminUpdatePrompt → 列表刷新', await h.appear(N + '-E'), N + '-E', errs);

// adminDeletePrompt
await h.row(N + '-E').first().locator('button').nth(1).click();
await page.waitForTimeout(900);
await h.confirm();
report('adminDeletePrompt → 列表移除', await h.vanish(N), '已消失', errs);

await browser.close();
