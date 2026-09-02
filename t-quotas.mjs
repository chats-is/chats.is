import { open, report } from './verify.mjs';
const { browser, page, errs } = await open();
const NAME = 'VQ' + Date.now();
const row = t => page.locator('tbody tr').filter({ hasText: t });
const appear = async (t, ms = 15000) => {
  try { await row(t).first().waitFor({ state: 'visible', timeout: ms }); return true; }
  catch { return false; }
};
const vanish = async (t, ms = 15000) => {
  try { await row(t).first().waitFor({ state: 'detached', timeout: ms }); return true; }
  catch { return false; }
};

await page.goto('http://localhost:3000/console/quotas', { waitUntil: 'networkidle' });

// createQuota
await page.getByRole('button', { name: /new quota/i }).click();
let dlg = page.locator('[role="dialog"]');
await dlg.getByPlaceholder(/Free, Pro, Team/).fill(NAME);
await dlg.locator('input[placeholder="0.00"]:not([readonly])').first().fill('10');
await dlg.getByRole('button', { name: 'Create' }).click();
report('createQuota → 列表出现', await appear(NAME), NAME, errs);

// updateQuota
await row(NAME).first().locator('button').first().click();
dlg = page.locator('[role="dialog"]');
await dlg.getByPlaceholder(/Free, Pro, Team/).fill(NAME + '-E');
await dlg.getByRole('button', { name: /save|update/i }).click();
report('updateQuota → 列表刷新', await appear(NAME + '-E'), NAME + '-E', errs);

// quota.listForSelect：套餐表单的下拉里应能看到它
await page.goto('http://localhost:3000/console/plans', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /new plan/i }).click();
await page.waitForTimeout(600);
const combo = page.locator('[role="dialog"] [role="combobox"], [role="dialog"] button[aria-haspopup]').first();
let seen = false;
if (await combo.count()) {
  await combo.click();
  await page.waitForTimeout(800);
  seen = (await page.locator('[role="listbox"], [role="option"]').first()
    .textContent().catch(() => '')) !== null &&
    (await page.locator('body').innerText()).includes(NAME + '-E');
}
report('quota.listForSelect 在套餐下拉里', seen, seen ? '新配额可选' : '未出现', errs);
await page.keyboard.press('Escape');

// deleteQuota
await page.goto('http://localhost:3000/console/quotas', { waitUntil: 'networkidle' });
await row(NAME + '-E').first().locator('button').last().click();
const yes = page.locator('[role="alertdialog"], [role="dialog"]').last()
  .getByRole('button', { name: /delete|continue|confirm/i });
if (await yes.count()) await yes.last().click();
report('deleteQuota → 列表移除', await vanish(NAME), '已消失', errs);

await browser.close();
