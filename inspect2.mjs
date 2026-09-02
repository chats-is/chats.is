import { open } from './verify.mjs';
const { browser, page, errs } = await open();
await page.goto('http://localhost:3000/console/quotas', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /new quota/i }).click();
await page.waitForTimeout(1200);
const dlg = page.locator('[role="dialog"]');
console.log('对话框数:', await dlg.count());
if (await dlg.count()) {
  console.log('文本:', (await dlg.first().innerText()).replace(/\n/g,' | ').slice(0,300));
  const ins = dlg.first().locator('input');
  console.log('输入框:', await ins.count());
  for (let i = 0; i < await ins.count(); i++) {
    const el = ins.nth(i);
    console.log('  ', i, 'type=' + await el.getAttribute('type'),
                'name=' + await el.getAttribute('name'),
                'ph=' + await el.getAttribute('placeholder'));
  }
  console.log('按钮:', JSON.stringify(await dlg.first().locator('button').allInnerTexts()));
}
console.log('错误:', errs.slice(0,3));
await browser.close();
