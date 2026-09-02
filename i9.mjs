import { open } from './verify.mjs';
const { browser, page } = await open();
await page.goto('http://localhost:3000/console/providers', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /add provider/i }).click();
await page.waitForTimeout(700);
const d = page.locator('[role="dialog"]').last();
await d.getByPlaceholder('OpenAI').fill('VPZ');
const invalid = await page.evaluate(() => {
  const f = document.querySelector('[role="dialog"] form');
  if (!f) return 'no form';
  const bad = [...f.elements].filter(e => e.willValidate && !e.checkValidity())
    .map(e => ({ name: e.name, id: e.id, ph: e.placeholder, msg: e.validationMessage }));
  return { valid: f.checkValidity(), bad };
});
console.log(JSON.stringify(invalid, null, 1));
await browser.close();
