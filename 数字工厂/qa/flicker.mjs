// 远景背景帧间差：相机固定、场景在动，比较连续两帧顶部虚空区域（应 ≈ 0）。node qa/flicker.mjs
import { open, frames, sleep } from './lib.mjs';
import sharp from 'sharp';
async function measure(q) {
  const { browser, page } = await open({ w: 960, h: 600, q });
  await frames(page, 3);
  const shots = [];
  for (let i = 0; i < 3; i++) { await frames(page, 1); shots.push(await page.screenshot()); }
  await browser.close();
  const raw = await Promise.all(shots.map((b) => sharp(b).raw().toBuffer({ resolveWithObject: true })));
  const { width: W, height: H, channels: C } = raw[0].info;
  const region = { y0: 0, y1: Math.round(H * 0.08) }; // 顶部：只有虚空 + 网格
  let sum = 0, n = 0, mx = 0, full = 0, fn = 0, cnt = 0;
  for (let k = 1; k < raw.length; k++) {
    const a = raw[k - 1].data, b = raw[k].data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C; const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
      if (y >= region.y0 && y < region.y1) { sum += d; n++; if (d > mx) mx = d; if (d > 0) cnt++; }
      full += d; fn++;
    }
  }
  return { bgMean: +(sum / n).toFixed(4), bgMax: mx, bgChangedPx: cnt, bgPx: n, fullMean: +(full / fn).toFixed(3) };
}
const base = 'instant=1&still=1&hideui=1&nolabels=1&lq=1&view=overview';
const post = await measure(base);
const raw = await measure(base + '&raw=1');
console.log('后处理（静态颗粒）', JSON.stringify(post));
console.log('raw 基线          ', JSON.stringify(raw));
const pass = post.bgMean < 0.02 && post.bgMax <= 1;
console.log(pass ? '远景背景帧间差 ≈ 0 通过' : '远景闪烁 失败');
process.exit(pass ? 0 : 1);
