import * as M from '../mech.js';
import { $, Fig, T, NUM, ctl, kpis, calc, txt, arrow, rr, dot, axes, curve, vline, drawCar, guesses, quiz, chrome, start, f0, f1, f2, sg, mi, Q, TAU } from '../ui.js';
import { GEN } from '../problems.js';

chrome(2);
const TT = M.tripTime(M.TRIP1), X = (t) => M.trip(M.TRIP1, t).x, S = (t) => M.trip(M.TRIP1, t).path;

// ---------------------------------------------------------------- 1 平均速度
const c1 = new Fig('c1', { ratio: .62, maxH: 380, minH: 250 });
const sa = ctl('c1-a', (v) => `${f2(v)} s`, () => upd1()), sb = ctl('c1-b', (v) => `${f2(v)} s`, () => upd1());
function upd1() {
  const a = Math.min(sa.v, sb.v), b = Math.max(sa.v, sb.v), dt = b - a, dx = X(b) - X(a), ds = S(b) - S(a);
  kpis('k1', [['位移 Δx', sg(dx, f0), 'm', 'x'], ['平均速度', dt > 0 ? sg(dx / dt, f1) : '—', 'm/s', 'v'], ['平均速率', dt > 0 ? f1(ds / dt) : '—', 'm/s']]);
  calc('m1', dt > 0 ? [`${Q('v', '平均速度')} = ${Q('x', 'Δx')} ÷ Δt = (${mi(f0(X(b)))} − ${mi(f0(X(a)))}) ÷ (${f2(b)} − ${f2(a)}) = ${mi(f0(dx))} ÷ ${f2(dt)} = <b class="qv">${mi(f1(dx / dt))} m/s</b>`,
    `平均速率 = 路程 ÷ Δt = ${f0(ds)} ÷ ${f2(dt)} = <b>${f1(ds / dt)} m/s</b>`] : ['<span class="nt">把两个时刻拉开一点</span>']);
  c1.dirty = true;
}
c1.draw = function (g, w, h) {
  const box = { x: 46, y: 24, w: w - 60, h: h - 58 };
  const ax = axes(g, box, { x0: 0, x1: TT, y0: -10, y1: 50, xs: 1, ys: 10, xlab: '时间 t（s）', ylab: '位置 x（m）', yc: T.x });
  curve(g, X, 0, TT, ax.X, ax.Y, box, { c: T.x, lw: 3, n: 140 });
  const a = Math.min(sa.v, sb.v), b = Math.max(sa.v, sb.v);
  if (b - a > 0.01) {
    const pa = [ax.X(a), ax.Y(X(a))], pb = [ax.X(b), ax.Y(X(b))];
    // 斜率三角形：横着 Δt，竖着 Δx
    g.strokeStyle = T.ink3; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pa[1]); g.lineTo(pb[0], pb[1]); g.stroke(); g.setLineDash([]);
    txt(g, `Δt = ${f2(b - a)} s`, (pa[0] + pb[0]) / 2, pa[1] + (X(b) >= X(a) ? 16 : -8), { c: T.ink2, size: 12, a: 'center' });
    const nearR = pb[0] > w - 90; txt(g, `Δx = ${sg(X(b) - X(a), f0)} m`, pb[0] + (nearR ? -6 : 6), (pa[1] + pb[1]) / 2 + 4, { c: T.x, size: 12, w: 700, a: nearR ? 'right' : 'left' });
    g.strokeStyle = T.v; g.lineWidth = 3; g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.stroke();
  }
  dot(g, ax.X(a), ax.Y(X(a)), T.v); dot(g, ax.X(b), ax.Y(X(b)), T.v);
  txt(g, '青线的斜率 = 平均速度', box.x + 6, box.y + 14, { c: T.v, size: 12, w: 700 });
};

// ---------------------------------------------------------------- 2 瞬时速度
const A = M.CAR.a, XA = (t) => M.accelX(A, t);
const c2 = new Fig('c2', { ratio: .66, maxH: 400, minH: 260 });
const st = ctl('c2-t', (v) => `${f1(v)} s`, () => upd2());
const DTS = (u) => 3 * Math.pow(0.003 / 3, u);     // 滑块 0→1：Δt 从 3 s 缩到 0.003 s
const sd = ctl('c2-d', (u) => `${DTS(u) < 0.1 ? DTS(u).toFixed(3) : f2(DTS(u))} s`, () => upd2());
function upd2() {
  const t = st.v, dt = DTS(sd.v), sec = M.avgV(XA, t, dt), v = A * t;
  kpis('k2', [['两点连线的斜率', f2(sec), 'm/s', 'v'], ['速度表的读数', f2(v), `m/s（${f0(v * 3.6)} km/h）`, 'v'], ['还差', f2(sec - v), 'm/s']]);
  c2.dirty = true;
}
c2.draw = function (g, w, h) {
  const box = { x: 46, y: 24, w: w - 60, h: h - 58 }, t = st.v, dt = DTS(sd.v);
  const ax = axes(g, box, { x0: 0, x1: 10, y0: 0, y1: 125, xs: 1, ys: 25, xlab: '时间 t（s）', ylab: '位置 x（m）', yc: T.x });
  curve(g, XA, 0, 10, ax.X, ax.Y, box, { c: T.x, lw: 3 });
  const v = A * t, tan = (s) => XA(t) + v * (s - t);
  curve(g, tan, t - 3, t + 3, ax.X, ax.Y, box, { c: T.ink3, lw: 1.5, dash: [5, 4] });
  const sec = M.avgV(XA, t, dt), sl = (s) => XA(t) + sec * (s - t);
  curve(g, sl, t - 1, t + dt + 1, ax.X, ax.Y, box, { c: T.v, lw: 2.5 });
  dot(g, ax.X(t), ax.Y(XA(t)), T.v); dot(g, ax.X(t + dt), ax.Y(XA(t + dt)), T.v, 4);
  txt(g, '青线：t 到 t+Δt 的连线　虚线：切线', box.x + 6, box.y + 14, { c: T.ink2, size: 12 });
  // 速度表
  const cx = box.x + 64, cy = box.y + 86, R = 44;
  g.beginPath(); g.arc(cx, cy, R, Math.PI * .75, Math.PI * 2.25); g.strokeStyle = T.line; g.lineWidth = 7; g.stroke();
  for (let k = 0; k <= 8; k++) { const a = Math.PI * .75 + Math.PI * 1.5 * k / 8; g.strokeStyle = T.ink3; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx + (R - 9) * Math.cos(a), cy + (R - 9) * Math.sin(a)); g.lineTo(cx + (R - 3) * Math.cos(a), cy + (R - 3) * Math.sin(a)); g.stroke(); }
  const na = Math.PI * .75 + Math.PI * 1.5 * Math.min(v * 3.6, 120) / 120;
  arrow(g, cx, cy, cx + (R - 8) * Math.cos(na), cy + (R - 8) * Math.sin(na), T.v, 3, 8);
  txt(g, `${f0(v * 3.6)}`, cx, cy + 26, { c: T.v, size: 18, w: 700, a: 'center', f: NUM });
  txt(g, 'km/h', cx, cy + 40, { c: T.ink3, size: 10.5, a: 'center' });
};

// ---------------------------------------------------------------- 3 单位
const c3 = new Fig('c3', { ratio: .34, maxH: 220, minH: 160 });
c3.t = 0;
const sv = ctl('c3-v', (v) => `${v} km/h`, () => upd3());
function upd3() {
  const v = sv.v / 3.6;
  kpis('k3', [['换成 m/s', f1(v), 'm/s', 'v'], ['每秒走过', f1(v / M.CAR.len), '个车身'], ['一小时走', f0(sv.v), 'km']]);
  c3.dirty = true;
}
c3.step = function (dt) { this.t = (this.t + dt) % 1.6; return true; };
c3.draw = function (g, w, h) {
  const v = sv.v / 3.6, ground = h * .62, px = (w - 30) / 43, n = v / M.CAR.len;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, ground); g.lineTo(w, ground); g.stroke();
  for (let k = 0; k < Math.ceil(n); k++) drawCar(g, 15 + (k + .5) * M.CAR.len * px, ground, M.CAR.len * px * .94, { alpha: k + 1 <= n ? .28 : .12 });
  const u = Math.min(1, this.t), xc = 15 + M.CAR.len * px / 2 + u * v * px;
  drawCar(g, Math.min(xc, w - 10), ground, M.CAR.len * px * .94, { wheel: u * v / 0.32 });
  g.strokeStyle = T.v; g.lineWidth = 2; g.beginPath(); g.moveTo(15, ground + 16); g.lineTo(15 + v * px, ground + 16); g.stroke();
  for (const x of [15, 15 + v * px]) { g.beginPath(); g.moveTo(x, ground + 10); g.lineTo(x, ground + 22); g.stroke(); }
  txt(g, `1 秒走 ${f1(v)} m`, 15 + v * px / 2, ground + 36, { c: T.v, size: 13, w: 700, a: 'center' });
  txt(g, `浅色的车身：一秒钟能排下 ${f1(n)} 辆`, 8, 18, { c: T.ink2, size: 12 });
};

guesses({
  g1: { right: 1, text: '平均速率大。平均速度 = 位移 30 m ÷ 7 s ≈ 4.3 m/s；平均速率 = 路程 50 m ÷ 7 s ≈ 7.1 m/s。来回跑的时候，位移比路程小。', run: () => { sa.set(0); sb.set(7); } },
  g2: { right: 0, text: '越来越接近速度表的读数。Δt 缩到 0.003 s，连线和切线已经分不出来了。', run: () => sd.set(1) },
  g3: { right: 1, text: '约 6 个。100 ÷ 3.6 ≈ 27.8 m/s，27.8 ÷ 4.76 ≈ 5.8 个车身。', run: () => sv.set(100) },
});
upd1(); upd2(); upd3();
quiz(2, GEN[2]);
start();
