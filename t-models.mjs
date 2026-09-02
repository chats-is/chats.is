import { open, report } from './verify.mjs';
import { helpers } from './lib.mjs';
const { browser, page, errs } = await open();
const h = helpers(page);
const M = 'deepseek-v4-flash-vision-exp';   // 刚同步进来的真模型，可丢弃

await page.goto('http://localhost:3000/console/models', { waitUntil: 'networkidle' });
await h.appear(M);

// toggleEnabledModel
const sw = () => h.row(M).first().locator('[role="switch"]').first();
const b1 = await sw().getAttribute('aria-checked');
await sw().click();
await page.waitForTimeout(2500);
const a1 = await sw().getAttribute('aria-checked');
report('toggleEnabledModel', b1 !== a1, `${b1} → ${a1}`, errs);

// updateModel（改显示名）
await h.row(M).first().locator('button').nth(0).click();
await page.waitForTimeout(900);
let d = h.dlg();
await d.locator('#name').fill('VM-EDITED');
await d.getByRole('button', { name: /save|update/i }).click();
report('updateModel → 列表刷新', await h.appear('VM-EDITED'), 'VM-EDITED', errs);

// deleteModel
await h.row('VM-EDITED').first().locator('button').nth(1).click();
await page.waitForTimeout(900);
await h.confirm();
report('deleteModel → 列表移除', await h.vanish(M), '已消失', errs);

// createModel（用真实且被提供方支持的 modelId，下拉才会有候选）
await page.getByRole('button', { name: 'Add Model' }).click();
await page.waitForTimeout(800);
d = h.dlg();
await d.locator('#name').fill('VM-NEW');
await d.locator('#modelId').fill(M);
await page.waitForTimeout(2500);                 // 等去抖 + 兼容性查询
await d.getByText('Select provider').first().click();
await page.waitForTimeout(1200);
const opts = await page.getByRole('option').count();
if (opts) await page.getByRole('option').first().click();
await page.waitForTimeout(500);
await d.getByRole('button', { name: 'Create' }).click();
report('createModel → 列表出现', await h.appear('VM-NEW'), `候选提供方 ${opts} 个`, errs);

// 清理
if (await h.row('VM-NEW').count()) {
  await h.row('VM-NEW').first().locator('button').nth(1).click();
  await page.waitForTimeout(900); await h.confirm(); await h.vanish('VM-NEW');
}
await browser.close();
