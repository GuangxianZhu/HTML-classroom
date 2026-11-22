import * as M from '../mech.js';
import { $, Fig, T, NUM, ctl, seg, kpis, calc, txt, arrow, rr, dot, axes, curve, vline, drawCar, guesses, quiz, chrome, start, f0, f1, f2, sg, mi, Q } from '../ui.js';
import { GEN } from '../problems.js';

chrome(5);

// ---------------------------------------------------------------- 1 第三个公式
const c1 = new Fig('c1', { ratio: .58, maxH: 350, minH: 240 });
const s1v = ctl('c1-v', (v) => `${v} km/h`, () => upd1()), s1b = ctl('c1-b', (v) => `${f1(v)} m/s²`, () => upd1());
function upd1() {
  const v = s1v.v / 3.6, b = s1b.v, d = v * v / (2 * b);
  calc('m1', [`${Q('v', 'v₀')} = ${s1v.v} ÷ 3.6 = ${f1(v)} m/s，停下要 ${f1(v)} ÷ ${f1(b)} = ${f1(v / b)} s`,
    `${Q('x', '刹车距离')} = ${Q('v', 'v₀')}² ÷ 2b = ${f1(v)}² ÷ (2 × ${f1(b)}) = <b class="qx">${f1(d)} m</b>`,
    `<span class="nt">车速翻倍（${s1v.v * 2} km/h）：${f1(4 * d)} m，是 4 倍</span>`]);
  c1.dirty = true;
}
c1.draw = function (g, w, h) {
  const box = { x: 46, y: 24, w: w - 60, h: h - 58 }, v = s1v.v / 3.6, b = s1b.v, tmax = Math.max(4, Math.ceil(2 * v / b * 1.1));
  const ax = axes(g, box, { x0: 0, x1: tmax, y0: 0, y1: Math.ceil(2 * v * 1.1 / 10) * 10, xs: tmax > 20 ? 5 : tmax > 10 ? 2 : 1, ys: 10, xlab: '刹车后的时间（s）', ylab: '速度 v（m/s）', yc: T.v });
  const tri = (v0, fill) => {
    g.beginPath(); g.moveTo(ax.X(0), ax.Y(0)); g.lineTo(ax.X(0), ax.Y(v0)); g.lineTo(ax.X(v0 / b), ax.Y(0)); g.closePath();
    if (fill) { g.fillStyle = T.x; g.globalAlpha = .22; g.fill(); g.globalAlpha = 1; g.strokeStyle = T.v; g.lineWidth = 3; g.beginPath(); g.moveTo(ax.X(0), ax.Y(v0)); g.lineTo(ax.X(v0 / b), ax.Y(0)); g.stroke(); }
    else { g.strokeStyle = T.ink3; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]); }
  };
  tri(2 * v, false); tri(v, true);
  txt(g, `面积 = ${f1(v * v / 2 / b)} m`, ax.X(v / b / 2) + 10, ax.Y(v / 2) - 6, { c: T.x, size: 14, w: 700 });
  txt(g, `车速翻倍：${f1(4 * v * v / 2 / b)} m`, ax.X(v / b) + 10, ax.Y(v) - 6, { c: T.ink2, size: 12 });
};

// ---------------------------------------------------------------- 2 反应 + 刹车
const OB = 45;
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? .95 : .66), maxH: 440, minH: 330 });
let run2 = false; c2.t = 0;
const s2v = ctl('c2-v', (v) => `${v} km/h`, () => reset2()), s2r = ctl('c2-r', (v) => `${f1(v)} s`, () => reset2());
const r2 = seg('r2', () => reset2());
const cur = () => { const v = s2v.v / 3.6, b = M.ROAD[r2.v], tr = s2r.v; return { v, b, tr, ...M.stopping(v, tr, b) }; };
function reset2() { run2 = false; c2.t = 0; upd2(); }
$('b2').addEventListener('click', () => { c2.t = 0; run2 = true; });
const posAt = (q, t) => (t <= q.tr ? q.v * t : q.dr + M.brakeDist(q.v, q.b, t - q.tr));
const vAt2 = (q, t) => (t <= q.tr ? q.v : Math.max(0, q.v - q.b * (t - q.tr)));
function upd2() {
  const q = cur(), hit = q.d > OB;
  kpis('k2', [['反应距离', f1(q.dr), 'm'], ['刹车距离', f1(q.db), 'm'], ['一共', f1(q.d), hit ? `m，撞上了` : `m，停住了`, hit ? 'F' : 'x']]);
  c2.dirty = true;
}
c2.step = function (dt) {
  if (!run2) return false;
  const q = cur(); this.t += dt;
  const xx = posAt(q, this.t);
  if (this.t >= q.t || xx >= OB) run2 = false;
  return true;
};
c2.draw = function (g, w, h) {
  const q = cur(), t = Math.min(this.t, q.t), x = Math.min(posAt(q, t), OB);
  // 路：0 到 max(总距离, 障碍) 
  const L = Math.max(q.d, OB) + 8, ground = h * .24, px = (w - 40) / L, X = (m) => 30 + m * px;
  g.fillStyle = T.road; g.globalAlpha = .16; g.fillRect(0, ground - 22, w, 30); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, ground + 8); g.lineTo(w, ground + 8); g.stroke();
  // 两段距离的尺子
  const ry = ground + 26;
  g.lineWidth = 6; g.strokeStyle = T.ink3; g.globalAlpha = .6; g.beginPath(); g.moveTo(X(0), ry); g.lineTo(X(q.dr), ry); g.stroke();
  g.strokeStyle = T.x; g.globalAlpha = .7; g.beginPath(); g.moveTo(X(q.dr), ry); g.lineTo(X(q.d), ry); g.stroke(); g.globalAlpha = 1;
  txt(g, `反应 ${f0(q.dr)} m`, X(q.dr / 2), ry + 18, { c: T.ink2, size: 12, a: 'center' });
  txt(g, `刹车 ${f0(q.db)} m`, X(q.dr + q.db / 2), ry + 18, { c: T.x, size: 12, w: 700, a: 'center' });
  // 障碍
  g.fillStyle = T.F; g.beginPath(); g.moveTo(X(OB), ground + 8); g.lineTo(X(OB) - 9, ground + 8); g.lineTo(X(OB) - 4, ground - 16); g.lineTo(X(OB) + 4, ground - 16); g.lineTo(X(OB) + 9, ground + 8); g.closePath(); g.fill();
  txt(g, `${OB} m`, X(OB), ground - 22, { c: T.F, size: 12, w: 700, a: 'center' });
  const CL = Math.max(34, M.CAR.len * px); drawCar(g, X(x) - CL / 2, ground + 8, CL, { wheel: x / 0.32 });
  if (this.t > 0 && t >= q.tr) txt(g, '踩下刹车', X(q.dr), ground - 30, { c: T.ink2, size: 11.5, a: 'center' });
  if (!run2 && this.t > 0) txt(g, q.d > OB ? '撞上了' : `停住了，离障碍还有 ${f1(OB - q.d)} m`, w / 2, 16, { c: q.d > OB ? T.F : T.ok, size: 14, w: 700, a: 'center' });
  // v-t 图
  const by = Math.max(h * .43, ground + 84), box = { x: 46, y: by, w: w - 60, h: h - by - 34 }, tmax = Math.max(6, q.t * 1.1);
  const ax = axes(g, box, { x0: 0, x1: tmax, y0: 0, y1: 35, xs: tmax > 12 ? 2 : 1, ys: 10, xlab: '看见以后的时间（s）', ylab: '速度 v（m/s）', yc: T.v });
  g.fillStyle = T.ink3; g.globalAlpha = .22; g.fillRect(ax.X(0), ax.Y(q.v), ax.X(q.tr) - ax.X(0), ax.Y(0) - ax.Y(q.v)); g.globalAlpha = 1;
  g.beginPath(); g.moveTo(ax.X(q.tr), ax.Y(0)); g.lineTo(ax.X(q.tr), ax.Y(q.v)); g.lineTo(ax.X(q.t), ax.Y(0)); g.closePath(); g.fillStyle = T.x; g.globalAlpha = .22; g.fill(); g.globalAlpha = 1;
  curve(g, (s) => vAt2(q, s), 0, tmax, ax.X, ax.Y, box, { c: T.v, lw: 3, n: 300 });
  if (this.t > 0) { vline(g, ax.X(t), box); dot(g, ax.X(t), ax.Y(vAt2(q, t)), T.v); }
  txt(g, '灰：反应　蓝：刹车　面积就是距离', box.x + box.w - 4, box.y + 12, { c: T.ink2, size: 11.5, a: 'right' });
};

// ---------------------------------------------------------------- 3 车停了，公式不知道
const V3 = 20, B3 = 5;
const c3 = new Fig('c3', { ratio: .58, maxH: 350, minH: 240 });
const s3 = ctl('c3-t', (v) => `${f1(v)} s`, () => upd3());
function upd3() {
  const t = s3.v;
  kpis('k3', [['公式硬算', f1(M.xAt(V3, -B3, t)), 'm', 'F'], ['实际走了', f1(M.brakeDist(V3, B3, t)), 'm', 'x'], ['几秒停下', f1(V3 / B3), 's']]);
  c3.dirty = true;
}
c3.draw = function (g, w, h) {
  const box = { x: 46, y: 24, w: w - 60, h: h - 58 }, t = s3.v;
  const ax = axes(g, box, { x0: 0, x1: 8, y0: 0, y1: 50, xs: 1, ys: 10, xlab: '刹车后的时间（s）', ylab: '位置 x（m）', yc: T.x });
  curve(g, (s) => M.xAt(V3, -B3, s), V3 / B3, 8, ax.X, ax.Y, box, { c: T.F, lw: 2, dash: [6, 4] });
  curve(g, (s) => M.brakeDist(V3, B3, s), 0, 8, ax.X, ax.Y, box, { c: T.x, lw: 3 });
  vline(g, ax.X(V3 / B3), box, T.ink3);
  txt(g, '4 s 车停了', ax.X(V3 / B3) + 4, box.y + 14, { c: T.ink2, size: 12 });
  txt(g, '虚线：公式以为车还会倒回去', ax.X(6.3), ax.Y(18), { c: T.F, size: 12, a: 'right' });
  vline(g, ax.X(t), box);
  dot(g, ax.X(t), ax.Y(M.brakeDist(V3, B3, t)), T.x, 6);
  if (t > V3 / B3) dot(g, ax.X(t), ax.Y(M.xAt(V3, -B3, t)), T.F, 5);
};

guesses({
  g1: { right: 1, text: '4 倍。刹车距离 = v₀² ÷ 2b，跟着车速的平方走。', run: () => { s1v.set(50); } },
  g2: { right: 1, text: '约 13 m。60 km/h = 16.7 m/s，16.7 × 0.8 ≈ 13 m，三四个车身，这时脚还没碰到刹车。', run: () => { s2v.set(60); s2r.set(0.8); r2.set('dry'); } },
  g3: { right: 1, text: '40 m。20 ÷ 5 = 4 s 就停了，之后不动：20² ÷ (2 × 5) = 40 m。30 m 是把 6 s 硬代进公式。', run: () => s3.set(6) },
});
upd1(); upd2(); upd3();
quiz(5, GEN[5]);
start();
