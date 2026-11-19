// 用法：node shot.mjs out.png "query" [w] [h] [waitMs]
import { open, frames, sleep } from './lib.mjs';
const [out = 'shot.png', q = 'instant=1&lq=1', w = '1440', h = '900', wait = '1500'] = process.argv.slice(2);
const t0 = Date.now();
const { browser, page, log } = await open({ w: +w, h: +h, q });
await sleep(+wait); await frames(page, 4);
await page.screenshot({ path: out });
const st = await page.evaluate(() => DF.stats && DF.stats());
console.log(JSON.stringify({ out, ms: Date.now() - t0, st, errors: log.errors.slice(0, 8), requests: log.requests }));
await browser.close();
