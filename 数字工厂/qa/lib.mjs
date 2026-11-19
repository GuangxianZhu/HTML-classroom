// QA 公共：启动带 WebGL（SwiftShader）的无头浏览器，记录控制台和外部请求
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
export const PAGE = pathToFileURL(resolve(here, '../index.html')).href;
export async function open({ w = 1440, h = 900, q = 'instant=1&lq=1', exe } = {}) {
  const path = exe || process.env.CHROME || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
  const browser = await chromium.launch({
    ...(path ? { executablePath: path } : { channel: 'chrome' }), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const log = { errors: [], warnings: [], requests: [] };
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); else if (m.type() === 'warning') log.warnings.push(m.text()); });
  page.on('pageerror', (e) => log.errors.push('PAGEERROR ' + e.message));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) log.requests.push(u); });
  await page.goto(PAGE + (q ? '?' + q : ''));
  await page.waitForFunction(() => window.DF && window.DF.ready, null, { timeout: 120000 });
  return { browser, page, log };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function frames(page, n = 3) { const f0 = await page.evaluate(() => DF.frames); await page.waitForFunction((f) => DF.frames >= f, f0 + n, { timeout: 120000 }); }
