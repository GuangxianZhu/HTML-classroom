// 巡游逐段截图（高质量渲染）：node qa/tourshots.mjs outDir [w h] [quality=hq|lq] [times...]
import { open, frames, sleep } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const [dir = 'qa/shots/tour', w = '1280', h = '720', qual = 'hq', ...ts] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const times = ts.length ? ts.map(Number) : [6, 14, 24, 34, 43, 53, 63, 72, 83];
const { browser, page, log } = await open({ w: +w, h: +h, q: `tour=1&tourat=0.5&nolabels=1${qual === 'lq' ? '&lq=1' : ''}` });
for (const t of times) {
  await page.evaluate((t) => { DF.tour.at = t; }, t);
  await frames(page, 2); await sleep(200);
  await page.screenshot({ path: `${dir}/t${String(t).padStart(4, '0')}.png`, timeout: 240000 });
  console.log(t, JSON.stringify(await page.evaluate(() => ({ ch: DF.tour.chapter + 1, cam: DF.camera.position.toArray().map((v) => +v.toFixed(1)), st: DF.stats() }))));
}
console.log('errors', log.errors.length);
await browser.close();
