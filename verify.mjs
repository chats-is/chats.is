import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const jar = readFileSync('/tmp/jar.txt', 'utf8');
const cookies = jar.split('\n').map(l => l.replace(/^#HttpOnly_/, ''))
  .filter(l => l && !l.startsWith('#'))
  .map(l => { const f = l.split('\t');
    return { name: f[5], value: f[6], url: 'http://localhost:3000', httpOnly: true, sameSite: 'Lax' }; })
  .filter(c => c.name);

export async function open() {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true
  });
  const ctx = await browser.newContext();
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
  page.on('response', r => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url().replace('http://localhost:3000','')}`); });
  return { browser, page, errs };
}

export function report(name, ok, detail, errs) {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name.padEnd(38)} ${detail}`);
  for (const e of errs.slice(0, 3)) console.log('        ' + e);
  errs.length = 0;
}
