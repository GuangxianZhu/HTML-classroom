import * as M from '../mech.js';
import { $, Fig, T, NUM, ctl, seg, kpis, calc, txt, arrow, dot, axes, curve, vline, fillUnder, drawCar, guesses, quiz, chrome, start, f0, f1, f2, sg, mi, Q } from '../ui.js';
import { GEN } from '../problems.js';

chrome(3);

// ---------------------------------------------------------------- 1 三种起步
const c1 = new Fig('c1', { ratio: .6, maxH: 360, minH: 240 });
const p1 = seg('p1', () => upd1());
const s1 = ctl('c1-t', (v) => `${f1(v)} s`, () => upd1());
function upd1() {
  const a = +p1.v, t = s1.v, v = Math.min(a * t, 100 / 3.6 * 1.5);
  kpis('k1', [['速度', f1(v), `m/s（${f0(v * 3.6)} km/h）`, 'v'], ['加速度', f1(a), 'm/s²', 'a'], ['到 100 km/h 要', f1(100 / 3.6 / a), 's']]);
  calc('m1', [`${Q('a', 'a')} = Δ${Q('v', 'v')} ÷ Δt = (${f1(v)} − 0) ÷ ${f1(t)} = <b class="qa">${t > 0 ? f1(v / t) : '—'} m/s²</b>`,
    `<span class="nt">每过 1 秒，速度涨 ${f1(a)} m/s，也就是 ${f1(a * 3.6)} km/h</span>`]);
  c1.dirty = true;
}
c1.draw = function (g, w, h) {
  const box = { x: 46, y: 24, w: w - 60, h: h - 58 };
  const ax = axes(g, box, { x0: 0, x1: 11, y0: 0, y1: 40, xs: 1, ys: 10, xlab: '时间 t（s）', ylab: '速度 v（m/s）', yc: T.v });
  g.strokeStyle = T.ink3; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(box.x, ax.Y(100 / 3.6)); g.lineTo(box.x + box.w, ax.Y(100 / 3.6)); g.stroke(); g.setLineDash([]);
  txt(g, '100 km/h', box.x + box.w - 4, ax.Y(100 / 3.6) - 5, { c: T.ink3, size: 11, a: 'right' });
  for (const a of [1, 2.5, 4]) {
    const on = a === +p1.v;
    curve(g, (t) => a * t, 0, 11, ax.X, ax.Y, box, { c: T.v, lw: on ? 3.2 : 1.5, alpha: on ? 1 : .35, n: 4 });
  }
  const a = +p1.v, t = s1.v;
  // 每秒一个台阶：横 1 s，竖 a
  if (t >= 1) {
    const t0 = Math.floor(t) - 1;
    g.strokeStyle = T.a; g.lineWidth = 2; g.beginPath(); g.moveTo(ax.X(t0), ax.Y(a * t0)); g.lineTo(ax.X(t0 + 1), ax.Y(a * t0)); g.lineTo(ax.X(t0 + 1), ax.Y(a * (t0 + 1))); g.stroke();
    txt(g, `1 s 涨 ${f1(a)} m/s`, ax.X(t0 + 1) + 6, ax.Y(a * (t0 + .5)) + 4, { c: T.a, size: 12, w: 700 });
  }
  vline(g, ax.X(t), box); dot(g, ax.X(t), ax.Y(a * t), T.v, 6);
};

// ---------------------------------------------------------------- 2 三张图叠起来
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? 1.45 : 1.02), maxH: 640, minH: 430 });
let play2 = false;
const s2 = ctl('c2-t', (v) => `${f1(v)} s`, () => { c2.dirty = true; });
const s2a = ctl('c2-a', (v) => `${f1(v)} m/s²`, () => { c2.dirty = true; });
const s2b = ctl('c2-b', (v) => `${f1(v)} m/s²`, () => { c2.dirty = true; });
const prof = () => M.profile({ a1: s2a.v, t1: 15 / s2a.v * 1, t2: 5, a2: s2b.v });   // 都加速到 15 m/s（54 km/h）
$('b2').addEventListener('click', () => { const P = prof(); if (s2.v >= P.T - .01) s2.set(0); play2 = !play2; $('b2').textContent = play2 ? '❚❚ 暂停' : '▶ 播放'; });
c2.step = function (dt) {
  if (!play2) return false;
  const P = prof(); let t = s2.v + dt;
  if (t >= P.T) { t = P.T; play2 = false; $('b2').textContent = '▶ 播放'; }
  s2.set(t); return true;
};
c2.draw = function (g, w, h) {
  const P = prof(), t = Math.min(s2.v, P.T + 2), q = P.at(t), Tmax = 20;
  // 路
  const ground = h * .11, xmax = Math.max(P.X, 1) * 1.05, px = (w - 40) / xmax;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, ground + 2); g.lineTo(w, ground + 2); g.stroke();
  const CL = Math.max(46, M.CAR.len * px * 1.4), cx = Math.min(30 + q.x * px, w - CL / 2 - 4);
  drawCar(g, cx, ground, CL, { wheel: q.x / 0.32 });
  const lab = q.a > 0 ? '加速' : q.a < 0 ? '刹车' : (q.v > 0 ? '匀速' : (t > 0 ? '停了' : ''));
  txt(g, lab, cx, ground - 26, { c: T.ink2, size: 12, a: 'center' });
  // 三张图
  const top = h * .19, gap = 36, ph = (h - top - 2 * gap - 34) / 3;
  const panels = [
    { f: (s) => P.at(s).x, y0: 0, y1: Math.ceil(P.X / 50) * 50 + 10, ys: 50, lab: '位置 x（m）', c: T.x },
    { f: (s) => P.at(s).v, y0: 0, y1: 20, ys: 5, lab: '速度 v（m/s）', c: T.v },
    { f: (s) => P.at(s).a, y0: -8, y1: 5, ys: 4, lab: '加速度 a（m/s²）', c: T.a },
  ];
  panels.forEach((pn, i) => {
    const box = { x: 46, y: top + i * (ph + gap), w: w - 60, h: ph };
    const ax = axes(g, box, { x0: 0, x1: Tmax, y0: pn.y0, y1: pn.y1, xs: 2, ys: pn.ys, xlab: i === 2 ? '时间 t（s）' : '', ylab: pn.lab, yc: pn.c, xfmt: i === 2 ? undefined : () => '' });
    curve(g, pn.f, 0, Tmax, ax.X, ax.Y, box, { c: pn.c, lw: 1.5, alpha: .3, n: 400 });
    curve(g, pn.f, 0, Math.min(t, Tmax), ax.X, ax.Y, box, { c: pn.c, lw: 3, n: 400 });
    vline(g, ax.X(t), box);
    dot(g, ax.X(t), ax.Y(pn.f(t)), pn.c, 5);
    txt(g, mi(i === 0 ? f0(q.x) : f1(i === 1 ? q.v : q.a)), ax.X(t) + 8, ax.Y(pn.f(t)) - 6, { c: pn.c, size: 13, w: 700, f: NUM });
  });
};

// ---------------------------------------------------------------- 3 方向
const c3 = new Fig('c3', { ratio: .42, maxH: 250, minH: 190 });
c3.t = 0;
const p3 = seg('p3', () => { c3.t = 0; upd3(); });
const CASE = { '++': [5, 2], '+-': [12, -3], '--': [-5, -2], '-+': [-12, 3] };
function upd3() {
  const [v0, a] = CASE[p3.v], v = v0 + a * Math.min(c3.t, 3);
  const same = Math.sign(v0) === Math.sign(a);
  kpis('k3', [['速度 v', sg(v, f1), 'm/s', 'v'], ['加速度 a', sg(a, f0), 'm/s²', 'a'], ['快慢', same ? '越来越快' : '越来越慢', '']]);
}
c3.step = function (dt) { this.t += dt; if (this.t > 4) this.t = 0; upd3(); return true; };
c3.draw = function (g, w, h) {
  const [v0, a] = CASE[p3.v], tt = Math.min(this.t, 3), v = v0 + a * tt, x = v0 * tt + .5 * a * tt * tt;
  const ground = h * .62, px = w / 60, cx = w / 2 + x * px * .5;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, ground + 2); g.lineTo(w, ground + 2); g.stroke();
  drawCar(g, Math.max(40, Math.min(w - 40, cx)), ground, 74, { dir: v0 > 0 ? 1 : -1, wheel: x / 0.32 });
  const ccx = Math.max(40, Math.min(w - 40, cx));
  arrow(g, ccx, ground - 64, ccx + v * 7, ground - 64, T.v, 4, 11);
  txt(g, `v = ${sg(v, f1)} m/s`, ccx + v * 7 + (v > 0 ? 6 : -6), ground - 60, { c: T.v, size: 13, w: 700, a: v > 0 ? 'left' : 'right' });
  arrow(g, ccx, ground + 22, ccx + a * 16, ground + 22, T.a, 4, 11);
  txt(g, `a = ${sg(a, f0)} m/s²`, ccx + a * 16 + (a > 0 ? 6 : -6), ground + 26, { c: T.a, size: 13, w: 700, a: a > 0 ? 'left' : 'right' });
  txt(g, '东 →', w - 8, 18, { c: T.ink3, size: 12, a: 'right' });
};

guesses({
  g1: { right: 1, text: '约 9 km/h。100 km/h = 27.8 m/s，27.8 ÷ 11 ≈ 2.5 m/s²，每秒涨 2.5 m/s，也就是 9 km/h。', run: () => { p1.set('2.5'); s1.set(11); } },
  g2: { right: 1, text: '不是。那一刻速度是 0，但速度正在往上涨，v-t 图在那里是斜的，斜率就是加速度。图已经拨回起步那一刻了。', run: () => { play2 = false; s2.set(0.05); } },
  g3: { right: 1, text: '减速。速度朝西（负），加速度朝东（正），方向相反，车越来越慢。就像倒车时踩刹车。', run: () => p3.set('-+') },
});
upd1(); upd3();
quiz(3, GEN[3]);
start();
