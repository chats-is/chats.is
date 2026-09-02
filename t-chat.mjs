import { open, report } from './verify.mjs';
const { browser, page, errs } = await open();
const CHAT = '0d5c7017-9703-4262-b07f-2f29614a6fbe';
const NEW = 'RENAMED ' + Date.now();

await page.goto(`http://localhost:3000/chat/${CHAT}`, { waitUntil: 'networkidle' });
const before = await page.title();

// 侧栏里这条会话的“更多”菜单
const item = page.locator('[data-sidebar="menu-item"]').filter({ hasText: 'Reply MIGRATION OK' }).first();
await item.hover();
await item.locator('button').last().click();
await page.getByText('Rename', { exact: true }).click();
const input = page.locator('input[type="text"], input:not([type])').last();
await input.fill(NEW);
await page.getByRole('button', { name: /save|rename|confirm/i }).last().click();
await page.waitForTimeout(2500);

const sidebarUpdated = await page.locator('[data-sidebar="menu-item"]').filter({ hasText: NEW }).count();
const headerText = await page.locator('header').first().innerText().catch(() => '');
const titleAfter = await page.title();

report('updateChat 写入 + 侧栏刷新', sidebarUpdated > 0,
  `侧栏="${sidebarUpdated ? NEW : '未更新'}"`, errs);
report('当前会话页标题同步', headerText.includes(NEW) || titleAfter.includes(NEW),
  `header="${headerText.trim().slice(0,40)}" title="${titleAfter}" (原 "${before}")`, errs);

// 刷新后是否落库
await page.reload({ waitUntil: 'networkidle' });
const persisted = await page.locator('[data-sidebar="menu-item"]').filter({ hasText: NEW }).count();
report('刷新后仍是新名字（已落库）', persisted > 0, persisted ? 'ok' : '丢失', errs);

await browser.close();
