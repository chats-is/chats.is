import { open, report } from './verify.mjs';
import { helpers } from './lib.mjs';
const { browser, page, errs } = await open();
const h = helpers(page);
const Q = 'PQ' + Date.now(), P = 'PL' + Date.now();

// 套餐需要先有配额
await page.goto('http://localhost:3000/console/quotas', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /new quota/i }).click();
await h.dlg().getByPlaceholder(/Free, Pro, Team/).fill(Q);
await h.dlg().locator('input[placeholder="0.00"]:not([readonly])').first().fill('9');
await h.dlg().getByRole('button', { name: 'Create' }).click();
await h.appear(Q);

await page.goto('http://localhost:3000/console/plans', { waitUntil: 'networkidle' });

// createPlan
await page.getByRole('button', { name: /new plan/i }).click();
await page.waitForTimeout(600);
await h.dlg().locator('input').first().fill(P);
await h.pickSelect('quota', Q);
await h.dlg().getByRole('button', { name: /create/i }).click();
report('createPlan → 列表出现', await h.appear(P), P, errs);

// updatePlan
await h.row(P).first().locator('button').first().click();
await page.waitForTimeout(600);
await h.dlg().locator('input').first().fill(P + '-E');
await h.dlg().getByRole('button', { name: /save|update/i }).click();
report('updatePlan → 列表刷新', await h.appear(P + '-E'), P + '-E', errs);

// deletePlan
await h.row(P + '-E').first().locator('button').last().click();
await page.waitForTimeout(600);
await h.confirm();
report('deletePlan → 列表移除', await h.vanish(P), '已消失', errs);

// 清理配额
await page.goto('http://localhost:3000/console/quotas', { waitUntil: 'networkidle' });
await h.row(Q).first().locator('button').last().click();
await page.waitForTimeout(600); await h.confirm(); await h.vanish(Q);

await browser.close();
