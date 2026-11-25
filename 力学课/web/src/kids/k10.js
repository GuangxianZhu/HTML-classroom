// 启 10 · 数格子算路程：每秒 3 米一秒一秒走，线下面一竖条一竖条亮 → 一个格子是 1 米 → 面积就是路程 → 两种办法走出 12 米
import { $, Fig, T, txt, start, kpis, ctl } from '../ui.js';
import { carAt, vtGrid, vline, ease, beats, kidGuesses, kidQuiz, kidChrome, dot } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(10);
const B = beats();
const G = kidGuesses({
  g1: { right: 2, later: true, text: '线下面那一块有多少个格子，车就走了多少米。' },
  g2: { right: 1, text: '6 × 4 = 24 米，正好是 12 米的 2 倍。' },
  g3: { right: 1, text: '面积 20 是说车走了 20 米。它从东 20 米出发，再往东 20 米，到了东 40 米。' },
});

/** 一条按米画的路：0 到 len 米，每 every 米一个数；返回 sx */
function mroad(g, w, y, len, every) {
  const px = (w - 44) / len, sx = (m) => 22 + m * px;
  g.fillStyle = T.road; g.globalAlpha = .15; g.fillRect(0, y - 30, w, 32); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y + 1); g.lineTo(w, y + 1); g.stroke();
  for (let m = 0; m <= len; m++) {
    const big = m % every === 0;
    g.lineWidth = 1.5; g.beginPath(); g.moveTo(sx(m), y + 1); g.lineTo(sx(m), y + (big ? 8 : 5)); g.stroke();
    if (big) txt(g, `${m} 米`, sx(m), y + 21, { c: T.ink3, size: 11.5, a: 'center' });
  }
  return { sx, px };
}
/** 方格子的速度图：横竖都是 n 格，格子是正方形 */
function cells(g, w, h, top, n) {
  const c = Math.min((w - 84) / n, (h - top - 46) / n);
  const box = { x: 46, y: top, w: c * n, h: c * n };
  return { ...vtGrid(g, box, { t1: n, v1: n, vs: 1, note: '↑ 越往上越快（每秒几米）' }), box, c };
}
const fillCell = (g, X, Y, t, v, c, alpha) => { g.fillStyle = c; g.globalAlpha = alpha; g.fillRect(X(t) + 1, Y(v + 1) + 1, X(t + 1) - X(t) - 2, Y(v) - Y(v + 1) - 2); g.globalAlpha = 1; };
const smallCar = (g, x, y, px) => { const L = Math.max(30, 2.2 * px); carAt(g, x, y - L * .2, L, {}); };

// ---------------------------------------------------------------- 第 2 步：一秒一秒走
const V1 = 3, N1 = 4;
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? 1.3 : .62), maxH: 470, minH: 380 });
let n1 = 0, u1 = 1;
const show1 = () => kpis('k1', [['走了', `${n1}`, '秒'], ['亮了', `${n1 * V1}`, '个格子', 'v'], ['车走了', `${n1 * V1}`, '米', 'x']]);
$('go1').addEventListener('click', () => { if (n1 >= N1 || u1 < 1) return; n1++; u1 = 0; });
$('again1').addEventListener('click', () => { n1 = 0; u1 = 1; show1(); c1.dirty = true; });
c1.step = (dt) => {
  if (u1 >= 1) return false;
  u1 = Math.min(1, u1 + dt / .9);
  if (u1 >= 1) { show1(); if (n1 >= N1) B.unlock('b2', '4 秒走完了：12 个格子，12 米。'); }
  return true;
};
c1.draw = function (g, w, h) {
  const done = n1 - 1 + ease(u1), y = 62;                       // 走完了几秒（带小数）
  const R = mroad(g, w, y, 14, 3);
  for (let k = 0; k < n1; k++) {
    const a = k * V1, b = Math.min(done, k + 1) * V1;
    g.fillStyle = T.x; g.globalAlpha = k % 2 ? .35 : .6; g.fillRect(R.sx(a), y - 8, R.sx(b) - R.sx(a), 7); g.globalAlpha = 1;
  }
  smallCar(g, R.sx(Math.max(0, done) * V1), y - 6, R.px);
  const { X, Y } = cells(g, w, h, 122, 6);
  for (let k = 0; k < n1; k++) {
    const part = k < n1 - 1 ? 1 : ease(u1);
    for (let v = 0; v < V1; v++) {
      fillCell(g, X, Y, k, v, T.v, (k % 2 ? .22 : .38) * part);
      if (part >= 1) txt(g, `${k * V1 + v + 1}`, (X(k) + X(k + 1)) / 2, (Y(v) + Y(v + 1)) / 2 + 5, { c: T.ink2, size: 13, a: 'center' });
    }
  }
  vline(g, [{ t: 0, v: V1 }, { t: Math.max(0, done), v: V1 }], X, Y, T.v, 3.5);
  dot(g, X(Math.max(0, done)), Y(V1), T.v, 5);
  txt(g, '线：一直每秒 3 米', X(6) - 4, Y(V1) - 10, { c: T.v, size: 12.5, w: 700, a: 'right' });
};
show1();

// ---------------------------------------------------------------- 第 4 步：拖滑块，两种办法走出 12 米
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? 1.3 : .62), maxH: 470, minH: 380 });
const found = new Set();
const sv = ctl('s-v', (v) => `每秒 ${v} 米`, () => upd2()), st = ctl('s-t', (v) => `${v} 秒`, () => upd2());
function upd2() {
  const d = sv.v * st.v;
  if (d === 12) found.add(`${sv.v}×${st.v}`);
  const how = `每秒 ${sv.v} 米 × ${st.v} 秒 = ${d} 米。`;
  $('cap2').textContent = d !== 12 ? `${how}${found.size ? `已经找到 ${found.size} 种办法。` : (d < 12 ? '还不够 12 米。' : '超过 12 米了。')}`
    : found.size >= 2 ? `${how}两种办法都找到了！长方形的样子不同，面积一样。` : `${how}找到一种了。换一个速度，再凑出 12 米。`;
  if (found.size >= 2) B.unlock('b4', '做到了。');
  c2.dirty = true;
}
c2.draw = function (g, w, h) {
  const d = sv.v * st.v, y = 62;
  const R = mroad(g, w, y, 36, 6);
  g.fillStyle = T.x; g.globalAlpha = .55; g.fillRect(R.sx(0), y - 8, R.sx(d) - R.sx(0), 7); g.globalAlpha = 1;
  smallCar(g, R.sx(d), y - 6, R.px * 2.4);
  if (d !== 12) { g.strokeStyle = T.ink3; g.setLineDash([4, 4]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(R.sx(12), y - 30); g.lineTo(R.sx(12), y + 1); g.stroke(); g.setLineDash([]); }
  const { X, Y } = cells(g, w, h, 122, 6);
  for (let t = 0; t < st.v; t++) for (let v = 0; v < sv.v; v++) fillCell(g, X, Y, t, v, d === 12 ? T.ok : T.v, .32);
  vline(g, [{ t: 0, v: sv.v }, { t: st.v, v: sv.v }], X, Y, T.v, 3.5);
  txt(g, `${sv.v} × ${st.v} = ${d} 格`, (X(0) + X(st.v)) / 2, (Y(0) + Y(sv.v)) / 2 + 5, { c: T.ink, size: 14, w: 700, a: 'center' });
  txt(g, `宽 ${st.v} 秒`, (X(0) + X(st.v)) / 2, Y(sv.v) - 9, { c: T.ink3, size: 12, a: 'center' });
  txt(g, `高：每秒 ${sv.v} 米`, X(st.v) + 6, (Y(0) + Y(sv.v)) / 2 + 4, { c: T.ink3, size: 12 });
};
upd2();

kidQuiz(10, KGEN[10]);
start();
