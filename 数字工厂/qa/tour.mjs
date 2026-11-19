// 巡游章节覆盖：?tourfast=1（时长 ×0.16）跑完一整圈，按顺序记录章节；并检查第 09 段终点 = 第 01 段起点（无缝）
import { open, sleep } from './lib.mjs';
const { browser, page, log } = await open({ w: 480, h: 300, q: 'tour=1&tourfast=1&lq=1&pr=0.35&nolabels=1' });
const seen = []; const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  const s = await page.evaluate(() => ({ c: DF.tour.chapter, loops: DF.tour.loops, cap: document.getElementById('capN').textContent, btn: document.getElementById('tourS').textContent }));
  if (seen[seen.length - 1] !== s.c) { seen.push(s.c); console.log('chapter', s.c + 1, s.cap, s.btn); }
  if (s.loops >= 1 && seen.length > 9) break;
  await sleep(120);
}
const seam = await page.evaluate(() => {
  const T = DF.tour; const a = T.sample(1e-6, false).arr, b = T.sample(T.total - 1e-6, false).arr;
  const j = T.segs.map((s, i) => i ? Math.max(...T.sample(T.segs.slice(0, i).reduce((x, q) => x + q.dur, 0) - 1e-4, false).arr.map((v, k) => Math.abs(v - T.sample(T.segs.slice(0, i).reduce((x, q) => x + q.dur, 0) + 1e-4, false).arr[k]))) : 0);
  return { start: a, end: b, maxJump: Math.max(...j), total: T.total / T.k };
});
const order = seen.filter((c, i) => c >= 0 && c !== seen[i - 1]);
const firstLoop = order.slice(0, 9).map((c) => c + 1).join('→');
const pass = firstLoop === '1→2→3→4→5→6→7→8→9' && seam.start.every((v, k) => Math.abs(v - seam.end[k]) < 1e-3) && seam.maxJump < 0.05;
console.log('顺序', firstLoop, '| 循环回到', order[9] != null ? order[9] + 1 : '-', '| 首尾差', Math.max(...seam.start.map((v, k) => Math.abs(v - seam.end[k]))).toExponential(1), '| 段间最大跳变', seam.maxJump.toExponential(1), '| 总时长', seam.total, 's');
console.log(pass ? `巡游覆盖 9/9 通过` : '巡游覆盖 失败', 'errors', log.errors.length);
await browser.close(); process.exit(pass ? 0 : 1);
