// 一次打开，依次截总览 + 6 分区 + 细节机位：node qa/views.mjs outDir [w h] [names...]
import { open, frames, sleep } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const [dir = 'qa/shots', w = '1440', h = '900', ...only] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const V = {
  overview: null,
  Z01: 'Z01', Z02: 'Z02', Z03: 'Z03', Z04: 'Z04', Z05: 'Z05', Z06: 'Z06',
  d_press: { tx: -31, ty: 3, tz: -20, azim: 0.5, elev: 0.18, dist: 16, fov: 42 },
  d_weld: { tx: -34, ty: 1.2, tz: 13, azim: 0.35, elev: 0.35, dist: 11, fov: 44 },
  d_paint: { tx: 2, ty: 2, tz: -12, azim: 0.1, elev: 0.3, dist: 16, fov: 44 },
  d_line: { tx: 30, ty: 1.2, tz: 12, azim: 0.7, elev: 0.28, dist: 12, fov: 44 },
  d_eol: { tx: 68, ty: 1.5, tz: 12, azim: -0.6, elev: 0.25, dist: 14, fov: 44 },
  d_asrs: { tx: -66.9, ty: 4, tz: 21, azim: 0.3, elev: 0.25, dist: 18, fov: 44 },
  d_dock: { tx: -88, ty: 1, tz: 27, azim: -0.9, elev: 0.3, dist: 30, fov: 40 },
  d_energy: { tx: -36, ty: 2, tz: -48, azim: 2.6, elev: 0.35, dist: 34, fov: 40 },
  d_ctrl: { tx: 25, ty: 1, tz: -33, azim: 0.2, elev: 0.6, dist: 18, fov: 44 },
  d_east: { tx: 90, ty: 0, tz: 16, azim: -1.0, elev: 0.35, dist: 46, fov: 40 },
  d_paintW: { tx: -10, ty: 2, tz: -15, azim: -0.6, elev: 0.35, dist: 26, fov: 44 },
  d_head: { tx: 18, ty: 3, tz: 12, azim: 0.9, elev: 0.3, dist: 22, fov: 44 },
  d_ovenout: { tx: 14, ty: 3, tz: -25, azim: 1.9, elev: 0.35, dist: 20, fov: 44 },
  d_yard: { tx: 100, ty: 0, tz: 28, azim: 0.5, elev: 0.5, dist: 60, fov: 40 },
};
const { browser, page, log } = await open({ w: +w, h: +h, q: 'instant=1&lq=1&still=1' });
for (const [name, v] of Object.entries(V)) {
  if (only.length && !only.includes(name)) continue;
  await page.evaluate((v) => {
    if (v === null) DF.ctx.goOverview(); else if (typeof v === 'string') DF.ctx.goZone(v); else { DF.ctx.closeInspector(); DF.rig.set(v, true); }
    Object.assign(DF.rig.cur, DF.rig.goal);
  }, v);
  await frames(page, 3); await sleep(300);
  await page.screenshot({ path: `${dir}/${name}.png`, timeout: 240000 });
  console.log(name, JSON.stringify(await page.evaluate(() => DF.stats())));
}
console.log('errors', JSON.stringify(log.errors.slice(0, 10)), 'requests', log.requests.length);
await browser.close();
