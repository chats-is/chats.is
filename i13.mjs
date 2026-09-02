import { open } from './verify.mjs';
const { browser, page } = await open();
await page.goto('http://localhost:3000/console/models', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Add Model' }).click();
await page.waitForTimeout(900);
const d = page.locator('[role="dialog"]').last();
const cands = d.locator('button, [role="combobox"]');
for (let i=0;i<await cands.count();i++) {
  const c = cands.nth(i);
  const t = (await c.innerText()).trim();
  if (!t) continue;
  console.log(i, JSON.stringify(t), 'haspopup=', await c.getAttribute('aria-haspopup'), 'role=', await c.getAttribute('role'));
}
const sel = d.getByText('Select provider').first();
await sel.click();
await page.waitForTimeout(1000);
console.log('option:', await page.getByRole('option').count(),
            '| listbox:', await page.locator('[role="listbox"]').count(),
            '| 弹层文本:', (await page.locator('[role="listbox"], [data-slot*="popup"]').last().innerText().catch(()=>'—')).slice(0,120));
await browser.close();
