// 启 11 · 越开越快走了多远：每秒涨 2，一秒一秒走（1、3、5、7 米），竖条削平 → 拼成三角形 → 长方形加三角形 → 中间那个速度
import { $, Fig, T, txt, start, kpis, ctl, seg } from '../ui.js';
import { carAt, vtGrid, vline, ease, clamp, beats, kidGuesses, kidQuiz, kidChrome, dot } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(11);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, text: '8 × 4 = 32 是“一直每秒 8 米”才能走的路。车是慢慢涨上去的，只走了一半：16 米。' },
  g2: { right: 2, text: '甲车线下面是三角形：4 × 8 ÷ 2 = 16。乙车是长方形：4 × 4 = 16。一样远。' },
  g3: { right: 1, text: '踩 8 秒，速度涨到每秒 16 米。三角形底和高都大了一倍：8 × 16 ÷ 2 = 64，是 16 的 4 倍。' },
});
const one = (x) => (Math.round(x * 10) / 10).toString();
const A = 2, N = 4;

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
/** 4 秒 × 每秒 8 米的格子：一格宽 1 秒、高每秒 1 米（画成宽是高的两倍） */
function grid48(g, w, h, top) {
  const c = Math.min((w - 84) / 8, (h - top - 46) / 8);
  const box = { x: 46, y: top, w: c * 8, h: c * 8 };
  return { ...vtGrid(g, box, { t1: 4, v1: 8, vs: 1, note: '↑ 越往上越快（每秒几米）' }), box };
}
const poly = (g, pts, c, alpha) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fillStyle = c; g.globalAlpha = alpha; g.fill(); g.globalAlpha = 1; };

// ---------------------------------------------------------------- 第 2 步：一秒一秒走，竖条削平
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? 1.3 : .62), maxH: 470, minH: 380 });
let n1 = 0, u1 = 1;
const dist = (k) => k * k;                                      // 前 k 秒走的米数：1 + 3 + 5 + …
const show1 = () => kpis('k1', n1
  ? [[`第 ${n1} 秒：速度从`, `${A * (n1 - 1)} 涨到 ${A * n1}`, '', 'v'], ['这一秒走了', `${A * n1 - 1}`, '米', 'v'], ['一共走了', `${dist(n1)}`, '米', 'x']]
  : [['速度每秒涨', `${A}`, '', 'a'], ['走了', '0', '秒'], ['一共走了', '0', '米', 'x']]);
$('go1').addEventListener('click', () => { if (n1 >= N || u1 < 1) return; n1++; u1 = 0; show1(); });
$('again1').addEventListener('click', () => { n1 = 0; u1 = 1; show1(); c1.dirty = true; });
c1.step = (dt) => {
  if (u1 >= 1) return false;
  u1 = Math.min(1, u1 + dt / 1.6);
  if (u1 >= 1 && n1 >= N) B.unlock('b2', '4 秒走完了：1 + 3 + 5 + 7 = 16 米。');
  return true;
};
c1.draw = function (g, w, h) {
  const y = 62, R = mroad(g, w, y, 18, 2);
  const grow = clamp(u1 * 2, 0, 1), flat = ease(clamp(u1 * 2 - 1, 0, 1));    // 先长出来，再削平
  const tt = n1 ? n1 - 1 + grow : 0, xc = tt * tt;                              // 车在第几米（位置 = 时间 × 时间，因为每秒涨 2）
  for (let k = 0; k < n1; k++) {
    const a = dist(k), b = k < n1 - 1 ? dist(k + 1) : xc;
    g.fillStyle = T.x; g.globalAlpha = k % 2 ? .35 : .6; g.fillRect(R.sx(a), y - 8, R.sx(b) - R.sx(a), 7); g.globalAlpha = 1;
    if (k < n1 - 1 || u1 >= 1) txt(g, `${2 * k + 1} 米`, (R.sx(a) + R.sx(dist(k + 1))) / 2, y - 14, { c: T.x, size: 11.5, w: 700, a: 'center' });
  }
  const L = Math.max(30, 2.2 * R.px); carAt(g, R.sx(xc), y - 6 - L * .2, L, {});
  const { X, Y } = grid48(g, w, h, 122);
  for (let k = 0; k < n1; k++) {
    const last = k === n1 - 1, f = last ? flat : 1, gr = last ? grow : 1, v0 = A * k, v1 = A * (k + 1), vm = v0 + 1, col = k % 2 ? .22 : .38;
    // 斜顶的竖条（没削平的部分）渐渐淡掉，平顶的长方形渐渐出来
    if (f < 1) poly(g, [[X(k), Y(0)], [X(k + gr), Y(0)], [X(k + gr), Y(v0 + (v1 - v0) * gr)], [X(k), Y(v0)]], T.v, col * (1 - f));
    if (f > 0) {
      poly(g, [[X(k), Y(0)], [X(k + 1), Y(0)], [X(k + 1), Y(vm)], [X(k), Y(vm)]], T.v, col * f);
      g.strokeStyle = T.v; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.globalAlpha = f; g.beginPath(); g.moveTo(X(k), Y(vm)); g.lineTo(X(k + 1), Y(vm)); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      if (f >= 1) txt(g, `${vm}`, (X(k) + X(k + 1)) / 2, Y(vm / 2) + 5, { c: T.ink, size: 15, w: 700, a: 'center' });
    }
  }
  vline(g, [{ t: 0, v: 0 }, { t: tt, v: A * tt }], X, Y, T.v, 3.5);
  dot(g, X(tt), Y(A * tt), T.v, 5);
};
show1();

// ---------------------------------------------------------------- 第 3 步：竖条、三角形、长方形的一半
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? 1.05 : .5), maxH: 400, minH: 320 });
const CAP2 = { bars: '四个削平了的竖条：1 + 3 + 5 + 7 = 16。', tri: '削下来的小角正好补上缺的小角。整块就是斜线下面的三角形。', half: '虚线的长方形是 4 × 8 = 32。斜线把它切成一样的两半，一半是 16。' };
const view = seg('view2', (v) => { $('cap2').textContent = CAP2[v]; c2.dirty = true; });
$('cap2').textContent = CAP2.bars;
c2.draw = function (g, w, h) {
  const { X, Y } = grid48(g, w, h, 30);
  if (view.v === 'bars') {
    for (let k = 0; k < 4; k++) { poly(g, [[X(k), Y(0)], [X(k + 1), Y(0)], [X(k + 1), Y(2 * k + 1)], [X(k), Y(2 * k + 1)]], T.v, k % 2 ? .22 : .38); txt(g, `${2 * k + 1}`, (X(k) + X(k + 1)) / 2, Y(k + .5) + 5, { c: T.ink, size: 15, w: 700, a: 'center' }); }
  } else {
    if (view.v === 'half') { g.strokeStyle = T.ink3; g.lineWidth = 2; g.setLineDash([6, 5]); g.strokeRect(X(0), Y(8), X(4) - X(0), Y(0) - Y(8)); g.setLineDash([]); txt(g, '另一半', X(1.2), Y(6) + 5, { c: T.ink3, size: 13, a: 'center' }); }
    poly(g, [[X(0), Y(0)], [X(4), Y(0)], [X(4), Y(8)]], T.v, .32);
    txt(g, '16', X(2.8), Y(2.4) + 6, { c: T.ink, size: 17, w: 700, a: 'center' });
    txt(g, '底：4 秒', X(2), Y(0) - 8, { c: T.ink2, size: 12.5, a: 'center' });
    txt(g, '高：每秒 8 米', X(4) - 6, Y(1) + 4, { c: T.ink2, size: 12.5, a: 'right' });
  }
  vline(g, [{ t: 0, v: 0 }, { t: 4, v: 8 }], X, Y, T.v, 3.5);
};

// ---------------------------------------------------------------- 第 4 步：长方形加三角形
const c3 = new Fig('c3', { ratio: (w) => (w < 500 ? .95 : .5), maxH: 400, minH: 300 });
let ok3 = false;
const sv = ctl('s-v', (v) => `每秒 ${v} 米`, () => upd3()), sa = ctl('s-a', (v) => `${v}`, () => upd3()), st = ctl('s-t', (v) => `${v} 秒`, () => upd3());
function upd3() {
  const v0 = sv.v, a = sa.v, t = st.v, rect = v0 * t, tri = t * (a * t) / 2, d = rect + tri;
  kpis('k3', [['长方形', `${v0} × ${t} = ${rect}`, '', 'v'], ['三角形', `${t} × ${a * t} ÷ 2 = ${one(tri)}`, '', 'a'], ['路程', one(d), '米', 'x']]);
  $('cap3').textContent = d === 24 && a > 0 ? `做到了！${rect} + ${one(tri)} = 24 米。` : d === 24 ? '是 24 米，可是“每秒涨”是 0。让它涨一点，再凑出 24。' : `现在是 ${one(d)} 米，${d < 24 ? '还不够。' : '超过了。'}`;
  if (!ok3 && d === 24 && a > 0) { ok3 = true; B.unlock('b4', '做到了。'); }
  c3.dirty = true;
}
c3.draw = function (g, w, h) {
  const v0 = sv.v, a = sa.v, t = st.v, v1 = v0 + a * t;
  const box = { x: 44, y: 30, w: w - 62, h: h - 30 - 44 };
  const { X, Y } = vtGrid(g, box, { t1: 6, v1: 18, vs: 2, note: '↑ 越往上越快（每秒几米）' });
  if (v0 > 0) { poly(g, [[X(0), Y(0)], [X(t), Y(0)], [X(t), Y(v0)], [X(0), Y(v0)]], T.v, .3); txt(g, '长方形', X(t / 2), Y(v0 / 2) + 5, { c: T.ink, size: 13, w: 700, a: 'center' }); }
  if (a > 0) { poly(g, [[X(0), Y(v0)], [X(t), Y(v0)], [X(t), Y(v1)]], T.a, .3); if (t > 1) txt(g, '三角形', X(t * .68), Y(v0 + a * t * .3) + 5, { c: T.ink, size: 13, w: 700, a: 'center' }); }
  vline(g, [{ t: 0, v: v0 }, { t, v: v1 }], X, Y, T.v, 3.5);
  dot(g, X(0), Y(v0), T.v, 4); dot(g, X(t), Y(v1), T.v, 4);
  txt(g, `最后每秒 ${v1} 米`, X(t) + 8, Y(v1) + 4, { c: T.v, size: 12, w: 700, a: t > 4 ? 'right' : 'left' });
};
upd3();

kidQuiz(11, KGEN[11]);
start();
