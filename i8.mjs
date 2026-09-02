import { open } from './verify.mjs';
const { browser, page } = await open();
await page.goto('http://localhost:3000/console/providers', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /add provider/i }).click();
await page.waitForTimeout(700);
const d = page.locator('[role="dialog"]').last();
const btn = d.getByRole('button', { name: 'Create' });
console.log('Create 按钮数:', await btn.count(), '| disabled:', await btn.first().isDisabled(),
            '| type:', await btn.first().getAttribute('type'));
console.log('表单存在:', await d.locator('form').count());
await d.getByPlaceholder('OpenAI').fill('VPZ');
await d.locator('input').nth(1).fill('sk-test');
for (let i=0;i<4;i++) {
  const el = d.locator('input').nth(i);
  console.log('  in',i,'value=',JSON.stringify(await el.inputValue().catch(()=>'?')),
              'required=', await el.getAttribute('required'));
}
console.log('点击后 disabled:', await btn.first().isDisabled());
await btn.first().click();
await page.waitForTimeout(1500);
console.log('对话框仍在:', await page.locator('[role="dialog"]').count());
console.log('页面里的校验提示:', JSON.stringify((await d.innerText()).split('\n').filter(l=>l.trim()).slice(-8)));
await browser.close();
