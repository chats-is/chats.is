import { open } from './verify.mjs';
const { browser, page, errs } = await open();
await page.goto('http://localhost:3000/console/providers', { waitUntil: 'networkidle' });
const rows = page.locator('tbody tr');
console.log('提供方:', (await rows.allInnerTexts()).map(t=>t.replace(/\n/g,'/').slice(0,40)));
await rows.first().locator('button').nth(0).click();   // 同步模型
await page.waitForTimeout(6000);
const d = page.locator('[role="dialog"]').last();
const txt = (await d.innerText()).replace(/\n/g,' | ');
console.log('对话框:', txt.slice(0, 400));
console.log('复选框数:', await d.locator('input[type="checkbox"]').count());
console.log('错误:', errs.slice(0,3));
await browser.close();
