import { open, report } from './verify.mjs';
const { browser, page, errs } = await open();
for (const { path, wait, label } of JSON.parse(process.argv[2])) {
  await page.goto('http://localhost:3000' + path, { waitUntil: 'networkidle', timeout: 60000 });
  let found = '—';
  if (wait) {
    try { await page.waitForSelector(wait, { timeout: 15000 });
          found = String(await page.locator(wait).count()); }
    catch { found = 'TIMEOUT'; }
  }
  report(label, errs.length === 0 && found !== 'TIMEOUT', `${path}  命中 ${found}`, errs);
}
await browser.close();
