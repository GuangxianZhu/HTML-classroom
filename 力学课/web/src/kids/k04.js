// 启 4 · 把一趟车拍成连环画：自己开一趟 → 每秒拍一张 → 照片竖起来排开 → 缩成点 → 连成线 = 位置-时间图
import { $, Fig, T, txt, start, kpis } from '../ui.js';
import { Driver, segTrip, road, carPx, ptGrid, line, flash, carAt, place, clamp, ease, beats, kidGuesses, kidQuiz, kidChrome, rr, dot } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(4);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, text: '每一秒记一次车在哪，就能把整趟车原样讲出来。只记终点，中间停没停、倒没倒车都丢了。' },
  g2: { right: 1, text: '线是平的，说明那几秒车的位置一直没变，就是停着。图上的“平”和路平不平没关系。' },
});
const R0 = -25, R1 = 65;     // 路画多长：西 25 米到东 65 米

// ---------------------------------------------------------------- 第 2 步：开一趟，每秒拍一张
const d1 = new Driver({ dur: 7, min: -20, max: 60, onDone: () => { $('hint1').textContent = '开完了！路上留下了 8 张照片（第 0 秒到第 7 秒）。'; B.unlock('b2', '开完了，可以往下走了。'); c2.dirty = true; } });
const c1 = new Fig('c1', { ratio: .22, maxH: 180, minH: 160 });
d1.bind(c1.c, c1);
$('demo1').addEventListener('click', () => d1.start(segTrip([[4, 10], [1, 0], [2, -5]])));
$('again1').addEventListener('click', () => { d1.reset(); $('hint1').textContent = '按住车，往右拖试试。'; c1.dirty = true; });
c1.step = (dt) => {
  const moving = d1.step(dt);
  if (moving) kpis('k1', [['过了', `${Math.floor(d1.t * 10) / 10}`, '秒'], ['车在', place(d1.x), ''], ['拍了', `${d1.photos.length}`, '张照片']]);
  return moving;
};
kpis('k1', [['过了', '0', '秒'], ['车在', place(0), ''], ['拍了', '0', '张照片']]);
/** 路上的影子：同一个地方停了好几秒，号码往上叠，不然看不清 */
function ghosts(g, ph, sx, y, L, { sel = -1, alpha = .25 } = {}) {
  const seen = {};
  ph.forEach((p, k) => {
    const key = Math.round(sx(p.x) / 8), lvl = (seen[key] = (seen[key] ?? -1) + 1);
    const on = k === sel;
    carAt(g, sx(p.x), y - L * .2, L, { color: on ? T.x : T.ink2, alpha: on ? .95 : alpha });
    txt(g, `${k}`, sx(p.x), y - L * .42 - 6 - lvl * 13, { c: on ? T.x : T.ink3, size: 12, w: 700, a: 'center' });
  });
}
c1.draw = function (g, w, h) {
  const y = h - 34, R = road(g, w, y, R0, R1), L = carPx(R.px);
  this.toX = R.toX; this.hit = () => true;
  ghosts(g, d1.photos, R.sx, y, L);
  carAt(g, R.sx(d1.x), y - L * .2, L, {});
  txt(g, d1.running ? `第 ${Math.floor(d1.t)} 秒` : d1.done ? '开完了' : '按住车开始', 10, 22, { c: T.ink, size: 16, w: 700 });
  txt(g, '数字 = 第几秒的照片', 10, 40, { c: T.ink3, size: 12 });
  flash(g, w, h, d1.flash);
};

// ---------------------------------------------------------------- 第 3 步：照片排开 → 缩成点 → 连成线
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? 1.15 : .78), maxH: 560, minH: 380 });
let ph = 0, u = 0, sel = -1;
const LABELS = ['把照片排开 →', '只留下车的位置 →', '把点连起来 →', '完成了 ✓'];
const CAPS = ['按上面的按钮，一步一步看。', '每张照片立起来了：东边朝上，第 0 秒在最左边。', '照片里只留下车在哪那一个点，路变淡了。', '点连起来，就是一条线。点一点线上的点试试。'];
const setPh = (p) => { ph = clamp(p, 0, 3); $('next2').textContent = LABELS[ph]; $('next2').disabled = ph === 3; $('cap2').textContent = CAPS[ph]; c2.dirty = true; };
$('next2').addEventListener('click', () => setPh(ph + 1));
$('back2').addEventListener('click', () => { u = 0; sel = -1; setPh(0); });
c2.step = (dt) => {
  if (u === ph) return false;
  u = u < ph && ph - u > 1e-3 ? Math.min(ph, u + dt * .8) : ph;
  if (u === 3) {
    B.unlock('b3', '做到了。');
    G.reveal('g1');
    G.echo('g1', 'echo1');
    $('echo1').textContent += '。答案是：每一秒记一次车在哪。图上的 8 个点，就是 8 次记录。';
  }
  return true;
};
let geo = null;
c2.c.addEventListener('click', (e) => {
  if (!geo || u < 1.5) return;
  const r = c2.c.getBoundingClientRect(), px = e.clientX - r.left;
  const k = Math.round((px - geo.box.x) / geo.colW - .5);
  if (k >= 0 && k < d1.photos.length) { sel = k; c2.dirty = true; $('cap2').textContent = `第 ${k} 秒：车在${place(d1.photos[k].x)}。路上那张照片亮起来了。`; }
});
c2.draw = function (g, w, h) {
  const P = d1.photos;
  if (!d1.done || P.length < 8) { txt(g, '先在上一步开完一趟。', w / 2, h / 2, { c: T.ink3, size: 15, a: 'center' }); return; }
  const y = 66, R = road(g, w, y, R0, R1, { house: false }), L = carPx(R.px);
  ghosts(g, P, R.sx, y, L, { sel, alpha: .3 });
  const box = { x: 56, y: 118, w: w - 70, h: h - 118 - 46 }, colW = box.w / 8, cx = (k) => box.x + (k + .5) * colW;
  const Y = (x) => box.y + box.h - (x + 20) / 80 * box.h;
  geo = { box, colW };
  const s1 = ease(u), s2 = ease(u - 1), s3 = clamp(u - 2, 0, 1);
  // 照片框：排开时出现，缩成点时变淡
  const fa = s1 * (1 - s2 * .7);
  if (fa > 0) P.forEach((p, k) => {
    g.globalAlpha = fa; rr(g, cx(k) - colW * .42, box.y, colW * .84, box.h, 4); g.fillStyle = T.panel2; g.fill(); g.strokeStyle = T.line; g.lineWidth = 1; g.stroke();
    g.strokeStyle = T.road; g.globalAlpha = fa * .35; g.lineWidth = Math.min(14, colW * .3); g.beginPath(); g.moveTo(cx(k), box.y + 4); g.lineTo(cx(k), box.y + box.h - 4); g.stroke(); g.globalAlpha = 1;
  });
  // 缩成点以后：每 20 米一条淡线和路牌名字
  if (s2 > 0) {
    g.globalAlpha = s2; g.strokeStyle = T.line; g.lineWidth = 1; g.beginPath();
    for (let x = -20; x <= 60; x += 20) { g.moveTo(box.x, Y(x)); g.lineTo(box.x + box.w, Y(x)); }
    g.stroke();
    for (let x = -20; x <= 60; x += 20) txt(g, x === 0 ? '家' : x > 0 ? `东${x}` : `西${-x}`, box.x - 5, Y(x) + 4, { c: x === 0 ? T.ink : T.ink3, size: 11, a: 'right', w: x === 0 ? 700 : 500 });
    g.globalAlpha = 1;
  }
  // 线：从左往右一段一段连
  if (s3 > 0) {
    const K = s3 * 7, pts = P.slice(0, Math.floor(K) + 1).map((p, k) => ({ t: k, x: p.x }));
    if (K < 7) { const k = Math.floor(K), f = K - k; pts.push({ t: k + f, x: P[k].x + (P[k + 1].x - P[k].x) * f }); }
    line(g, pts, (t) => box.x + (t + .5) * colW, Y, T.x, 3);
  }
  // 每张照片里的车：从路上飞下来、转成车头朝上，再缩成一个点
  const Lc = clamp(colW * 1.1, 24, 40);
  P.forEach((p, k) => {
    if (u <= 0) return;
    const x0 = R.sx(p.x), y0 = y - L * .2, x1 = cx(k), y1 = Y(p.x);
    const px = x0 + (x1 - x0) * s1, py = y0 + (y1 - y0) * s1, size = (L + (Lc - L) * s1) * (1 - s2);
    if (size > 2) carAt(g, px, py, size, { rot: -Math.PI / 2 * s1, color: k === sel ? T.x : T.ink2, alpha: .35 + .65 * s1 });
    if (s2 > 0) { dot(g, px, py, T.x, 2 + 4 * s2); if (k === sel) { g.strokeStyle = T.x; g.lineWidth = 2; g.beginPath(); g.arc(px, py, 11, 0, Math.PI * 2); g.stroke(); } }
  });
  // 每张照片下面写第几秒
  if (s1 > 0) {
    g.globalAlpha = s1;
    P.forEach((p, k) => txt(g, colW > 46 ? `第${k}秒` : `${k}`, cx(k), box.y + box.h + 15, { c: T.ink2, size: 11.5, a: 'center', w: 500 }));
    if (colW <= 46) txt(g, '秒', box.x + box.w + 2, box.y + box.h + 15, { c: T.ink3, size: 11 });
    g.globalAlpha = 1;
  }
  if (s3 > .5) {
    g.globalAlpha = (s3 - .5) * 2;
    txt(g, '时间往右走 →', box.x + box.w, box.y + box.h + 34, { c: T.ink2, size: 12.5, w: 700, a: 'right' });
    txt(g, '↑ 越往上越靠东', box.x - 4, box.y - 9, { c: T.x, size: 12.5, w: 700 });
    g.globalAlpha = 1;
  }
};

// ---------------------------------------------------------------- 第 5 步：再开一趟，图跟着画；找一段平的线
let flat = null;
const d3 = new Driver({
  dur: 10, min: -20, max: 60,
  onTick: (d) => {
    if (flat) return;
    const S = d.samples, now = S[S.length - 1];
    if (Math.max(...S.map((s) => Math.abs(s.x - S[0].x))) < 5) return;      // 先要开动过
    let lo = Infinity, hi = -Infinity;
    for (let i = S.length - 1; i >= 0 && now.t - S[i].t <= 1.5; i--) { lo = Math.min(lo, S[i].x); hi = Math.max(hi, S[i].x); if (now.t - S[i].t >= 1.45 && hi - lo < .6) { flat = [S[i].t, now.t, (hi + lo) / 2]; break; } }
    if (flat) { $('hint3').textContent = '看！车停着不动，线就是平的。'; B.unlock('b5', '做到了。'); }
  },
  onDone: () => { if (!flat) $('hint3').textContent = '还没有平的线。先开动，再松手停 2 秒试试。'; },
});
const c3 = new Fig('c3', { ratio: (w) => (w < 500 ? 1 : .7), maxH: 480, minH: 340 });
d3.bind(c3.c, c3);
$('demo3').addEventListener('click', () => { flat = null; d3.start(segTrip([[3, 12], [3, 0], [2, -8], [2, 0]])); });
$('again3').addEventListener('click', () => { flat = null; d3.reset(); $('hint3').textContent = '按住车开始，一共 10 秒。'; c3.dirty = true; });
c3.step = (dt) => d3.step(dt);
c3.draw = function (g, w, h) {
  const y = 66, R = road(g, w, y, R0, R1, { house: false }), L = carPx(R.px);
  this.toX = R.toX; this.hit = (px, py) => py < y + 26;
  carAt(g, R.sx(d3.x), y - L * .2, L, {});
  const box = { x: 56, y: 118, w: w - 74, h: h - 118 - 44 };
  const { X, Y } = ptGrid(g, box, { t1: 10, x0: -20, x1: 60, xs: 10, ts: 1 });
  if (flat) {
    g.fillStyle = T.ok; g.globalAlpha = .16; g.fillRect(X(flat[0]), box.y, X(flat[1]) - X(flat[0]), box.h); g.globalAlpha = 1;
    txt(g, '停着', (X(flat[0]) + X(flat[1])) / 2, Math.max(box.y + 14, Y(flat[2]) - 12), { c: T.ok, size: 13, w: 700, a: 'center' });
  }
  line(g, d3.samples, X, Y, T.x, 3);
  if (d3.samples.length) { const s = d3.samples[d3.samples.length - 1]; dot(g, X(s.t), Y(s.x), T.x, 5); }
  if (!d3.running && !d3.done) txt(g, '按住上面的车开始', box.x + box.w / 2, box.y + box.h / 2, { c: T.ink3, size: 14, a: 'center' });
};

kidQuiz(4, KGEN[4]);
start();
