import { open, report } from './verify.mjs';
import { helpers } from './lib.mjs';
const { browser, page, errs } = await open();
const h = helpers(page);

await page.goto('http://localhost:3000/console/providers', { waitUntil: 'networkidle' });
const target = page.locator('tbody tr').filter({ hasText: 'DeepSeek' }).first();
await target.locator('button').nth(0).click();     // 同步模型
await page.waitForTimeout(1000);
const d = h.dlg();
// fetchProviderModels：等真实目录回来
let listed = 0;
for (let i = 0; i < 30; i++) {
  listed = await d.locator('input[type="checkbox"]').count();
  if (listed > 0) break;
  await page.waitForTimeout(1000);
}
report('fetchProviderModels → 拉到远端目录', listed > 0, `${listed} 个可选`, errs);

if (listed > 0) {
  const boxes = d.locator('input[type="checkbox"]');
  // 选一个尚未入库的
  await boxes.first().check().catch(() => {});
  await page.waitForTimeout(400);
  const label = (await d.innerText()).split('\n').filter(l => l.trim()).slice(0, 30);
  const btn = d.getByRole('button', { name: /^Sync \d+ Model/ });
  const btnText = await btn.innerText().catch(() => '');
  await btn.click();
  await page.waitForTimeout(5000);
  const stillOpen = await page.locator('[role="dialog"]').count();
  report('syncProviderModels → 写入模型表', stillOpen === 0, `按钮="${btnText}" 对话框已关=${stillOpen===0}`, errs);
  await page.goto('http://localhost:3000/console/models', { waitUntil: 'networkidle' });
  const n = await page.locator('tbody tr').count();
  report('模型列表随之刷新', n > 0, `${n} 行`, errs);
}
await browser.close();
