import { open, report } from './verify.mjs';
import { helpers } from './lib.mjs';
const { browser, page, errs } = await open();
const h = helpers(page);
const Q = 'VUQ' + Date.now();

// 先建一个配额，供分配用
await page.goto('http://localhost:3000/console/quotas', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /new quota/i }).click();
await h.dlg().getByPlaceholder(/Free, Pro, Team/).fill(Q);
await h.dlg().locator('input[placeholder="0.00"]:not([readonly])').first().fill('7');
await h.dlg().getByRole('button', { name: 'Create' }).click();
await h.appear(Q);

await page.goto('http://localhost:3000/console/users', { waitUntil: 'networkidle' });
const r = () => h.row('VTest User').first();
await r().waitFor({ timeout: 15000 });
const combos = () => r().locator('[role="combobox"]');

// updateUserRole：user → Admin
const roleBefore = (await combos().nth(0).innerText()).trim();
await combos().nth(0).click();
await page.waitForTimeout(700);
await page.getByRole('option').filter({ hasText: /admin/i }).first().click();
await page.waitForTimeout(2500);
const roleAfter = (await combos().nth(0).innerText()).trim();
report('updateUserRole', roleBefore !== roleAfter, `${roleBefore} → ${roleAfter}`, errs);

// setUserQuota
await combos().nth(1).click();
await page.waitForTimeout(700);
await page.getByRole('option').filter({ hasText: Q }).first().click();
await page.waitForTimeout(2500);
const qAfter = (await combos().nth(1).innerText()).trim();
report('setUserQuota', qAfter.includes(Q), `配额 → ${qAfter}`, errs);

// removeUserQuota
await combos().nth(1).click();
await page.waitForTimeout(700);
await page.getByRole('option').first().click();      // __none__
await page.waitForTimeout(2500);
const qNone = (await combos().nth(1).innerText()).trim();
report('removeUserQuota', !qNone.includes(Q), `配额 → ${qNone}`, errs);

// 清理配额
await page.goto('http://localhost:3000/console/quotas', { waitUntil: 'networkidle' });
await h.row(Q).first().locator('button').last().click();
await page.waitForTimeout(800); await h.confirm(); await h.vanish(Q);

await browser.close();
