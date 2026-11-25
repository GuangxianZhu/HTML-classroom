import * as M from '../mech.js';
import { $, Fig, T, NUM, ctl, kpis, calc, txt, arrow, dot, axes, curve, vline, fillUnder, guesses, quiz, chrome, start, f0, f1, f2, sg, mi, Q } from '../ui.js';
import { GEN } from '../problems.js';

chrome(4);

// ---------------------------------------------------------------- 1 匀速：长方形
const c1 = new Fig('c1', { ratio: .55, maxH: 330, minH: 230 });
const sv = ctl('c1-v', (v) => `${v} km/h`, () => upd1()), st = ctl('c1-t', (v) => `${v} s`, () => upd1());
function upd1() {
  const v = sv.v / 3.6;
  calc('m1', [`先换单位：${sv.v} ÷ 3.6 = ${f1(v)} m/s`, `${Q('x', '距离')} = ${Q('v', 'v')} × t = ${f1(v)} × ${st.v} = <b class="qx">${f0(v * st.v)} m</b>`]);
  c1.dirty = true;
}
c1.draw = function (g, w, h) {
  const box = { x: 46, y: 24, w: w - 60, h: h - 58 }, v = sv.v / 3.6, t = st.v;
  const ax = axes(g, box, { x0: 0, x1: 60, y0: 0, y1: 35, xs: 10, ys: 10, xlab: '时间 t（s）', ylab: '速度 v（m/s）', yc: T.v });
  g.fillStyle = T.x; g.globalAlpha = .2; g.fillRect(ax.X(0), ax.Y(v), ax.X(t) - ax.X(0), ax.Y(0) - ax.Y(v)); g.globalAlpha = 1;
  curve(g, () => v, 0, 60, ax.X, ax.Y, box, { c: T.v, lw: 3, n: 2 });
  txt(g, `面积 = ${f0(v * t)} m`, (ax.X(0) + ax.X(t)) / 2, (ax.Y(v) + ax.Y(0)) / 2 + 5, { c: T.x, size: 15, w: 700, a: 'center' });
  txt(g, `高 ${f1(v)} m/s`, ax.X(t) + 6, ax.Y(v) + 16, { c: T.v, size: 12 });
};

// ---------------------------------------------------------------- 2 切细条
const VM = 40, TAUc = 12, TMAX = 16;
const VF = (t) => VM * (1 - Math.exp(-t / TAUc)), XEX = (t) => VM * (t - TAUc * (1 - Math.exp(-t / TAUc)));
const c2 = new Fig('c2', { ratio: .58, maxH: 350, minH: 240 });
const sn = ctl('c2-n', (v) => `${v} 条`, () => upd2());
function upd2() {
  const s = M.strips(VF, 0, TMAX, sn.v), ex = XEX(TMAX);
  kpis('k2', [['细条加起来', f1(s), 'm', 'x'], ['真正走过的', f1(ex), 'm', 'x'], ['差了', `${f1(ex - s)}`, `m（${f1((ex - s) / ex * 100)}%）`]]);
  c2.dirty = true;
}
c2.draw = function (g, w, h) {
  const box = { x: 46, y: 24, w: w - 60, h: h - 58 }, n = sn.v, dw = TMAX / n;
  const ax = axes(g, box, { x0: 0, x1: TMAX, y0: 0, y1: 30, xs: 2, ys: 10, xlab: '时间 t（s）', ylab: '速度 v（m/s）', yc: T.v });
  for (let i = 0; i < n; i++) {
    const t0 = i * dw, v = VF(t0);
    g.fillStyle = T.x; g.globalAlpha = .22; g.fillRect(ax.X(t0), ax.Y(v), ax.X(t0 + dw) - ax.X(t0), ax.Y(0) - ax.Y(v)); g.globalAlpha = 1;
    if (n <= 40) { g.strokeStyle = T.x; g.lineWidth = 1; g.globalAlpha = .6; g.strokeRect(ax.X(t0), ax.Y(v), ax.X(t0 + dw) - ax.X(t0), ax.Y(0) - ax.Y(v)); g.globalAlpha = 1; }
  }
  curve(g, VF, 0, TMAX, ax.X, ax.Y, box, { c: T.v, lw: 3 });
  txt(g, '每条细长方形：当它是匀速，面积 = 那一刻的速度 × 一小段时间', box.x + 6, box.y + 14, { c: T.ink2, size: 12 });
};

// ---------------------------------------------------------------- 3 梯形
const c3 = new Fig('c3', { ratio: .62, maxH: 370, minH: 250 });
const s3v = ctl('c3-v', (v) => `${f1(v)} m/s`, () => upd3()), s3a = ctl('c3-a', (v) => `${f1(v)} m/s²`, () => upd3()), s3t = ctl('c3-t', (v) => `${f1(v)} s`, () => upd3());
$('b3').addEventListener('click', () => { s3v.set(0); s3a.set(2.5); s3t.set(11.1); });
function upd3() {
  const v0 = s3v.v, a = s3a.v, t = s3t.v, v = M.vAt(v0, a, t), x = M.xAt(v0, a, t);
  calc('m3', [`${Q('v', 'v')} = ${Q('v', 'v₀')} + ${Q('a', 'a')}t = ${f1(v0)} + ${f1(a)} × ${f1(t)} = <b class="qv">${f1(v)} m/s</b><span class="nt">（${f0(v * 3.6)} km/h）</span>`,
    `${Q('x', 'x')} = ${Q('v', 'v₀')}t + ½${Q('a', 'a')}t² = ${f1(v0)} × ${f1(t)} + ½ × ${f1(a)} × ${f1(t)}² = ${f1(v0 * t)} + ${f1(.5 * a * t * t)} = <b class="qx">${f1(x)} m</b>`,
    `<span class="nt">验算：平均速度 (${f1(v0)} + ${f1(v)}) ÷ 2 × ${f1(t)} = ${f1((v0 + v) / 2 * t)} m</span>`]);
  c3.dirty = true;
}
c3.draw = function (g, w, h) {
  const box = { x: 46, y: 24, w: w - 60, h: h - 58 }, v0 = s3v.v, a = s3a.v, t = s3t.v, v = v0 + a * t;
  const ax = axes(g, box, { x0: 0, x1: 12, y0: 0, y1: 50, xs: 1, ys: 10, xlab: '时间 t（s）', ylab: '速度 v（m/s）', yc: T.v });
  g.fillStyle = T.x; g.globalAlpha = .16; g.fillRect(ax.X(0), ax.Y(v0), ax.X(t) - ax.X(0), ax.Y(0) - ax.Y(v0)); g.globalAlpha = 1;
  g.beginPath(); g.moveTo(ax.X(0), ax.Y(v0)); g.lineTo(ax.X(t), ax.Y(v)); g.lineTo(ax.X(t), ax.Y(v0)); g.closePath(); g.fillStyle = T.a; g.globalAlpha = .25; g.fill(); g.globalAlpha = 1;
  curve(g, (s) => v0 + a * s, 0, 12, ax.X, ax.Y, box, { c: T.v, lw: 1.5, alpha: .35, n: 2 });
  curve(g, (s) => v0 + a * s, 0, t, ax.X, ax.Y, box, { c: T.v, lw: 3, n: 2 });
  if (v0 > 1) txt(g, `v₀t = ${f1(v0 * t)} m`, (ax.X(0) + ax.X(t)) / 2, (ax.Y(v0) + ax.Y(0)) / 2 + 5, { c: T.x, size: 13, w: 700, a: 'center' });
  if (a * t > 2) txt(g, `½at² = ${f1(.5 * a * t * t)} m`, ax.X(t) - 6, ax.Y(v0) - 8, { c: T.a, size: 13, w: 700, a: 'right' });
  dot(g, ax.X(t), ax.Y(v), T.v, 5);
  txt(g, `v = ${f1(v)}`, ax.X(t) + 6, ax.Y(v) + 4, { c: T.v, size: 12, w: 700 });
};

guesses({
  g1: { right: 1, text: '约 500 m。60 km/h = 16.7 m/s，16.7 × 30 ≈ 500 m。直接 60 × 30 = 1800 是忘了换单位。', run: () => { sv.set(60); st.set(30); } },
  g2: { right: 0, text: '越来越接近真正走过的距离。切成 80 条时，差距只剩 1% 左右。', run: () => sn.set(80) },
  g3: { right: 1, text: '约 154 m。从静止起步 v₀ = 0，只剩三角形：½ × 2.5 × 11.1² ≈ 154 m。或者用平均速度：(0 + 27.8) ÷ 2 × 11.1 ≈ 154 m。', run: () => { s3v.set(0); s3a.set(2.5); s3t.set(11.1); } },
});
upd1(); upd2(); upd3();
quiz(4, GEN[4]);
start();
