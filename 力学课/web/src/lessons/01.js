import * as M from '../mech.js';
import { $, Fig, T, NUM, ctl, seg, kpis, calc, txt, arrow, rr, dot, axes, curve, vline, drawCar, guesses, quiz, chrome, start, f0, f1, sg, mi, Q, TAU } from '../ui.js';
import { GEN } from '../problems.js';

chrome(1);
const STORE = M.STORE;

/** 路面 + 尺子：把世界坐标（家 = 0，朝东为正）换成当前选的坐标 */
const toC = (X, origin, dir) => (X - (origin === 'store' ? STORE : 0)) * dir;
function road(g, w, y, x0, x1, px, { origin = 'home', dir = 1, axis = true } = {}) {
  const sx = (X) => (X - x0) * px;
  g.fillStyle = T.road; g.globalAlpha = .18; g.fillRect(0, y - 26, w, 34); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y + 8); g.lineTo(w, y + 8); g.stroke();
  // 家和便利店
  const house = (X, name, roof) => {
    const cx = sx(X); g.fillStyle = T.panel2; g.strokeStyle = T.ink3; g.lineWidth = 1.2;
    g.fillRect(cx - 14, y - 64, 28, 24); g.strokeRect(cx - 14, y - 64, 28, 24);
    g.beginPath(); g.moveTo(cx - 18, y - 64); g.lineTo(cx, y - 64 - roof); g.lineTo(cx + 18, y - 64); g.closePath(); g.fill(); g.stroke();
    txt(g, name, cx, y - 70 - roof, { c: T.ink2, size: 12, a: 'center' });
  };
  house(0, '家', 12); house(STORE, '便利店', 4);
  if (!axis) return sx;
  // 尺子
  const ay = y + 26;
  g.strokeStyle = T.x; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, ay); g.lineTo(w, ay); g.stroke();
  const o = origin === 'store' ? STORE : 0;
  for (let X = Math.ceil(x0 / 10) * 10; X <= x1; X += 10) {
    const c = toC(X, origin, dir), big = c === 0;
    g.beginPath(); g.moveTo(sx(X), ay - (big ? 7 : 4)); g.lineTo(sx(X), ay + (big ? 7 : 4)); g.stroke();
    txt(g, mi(f0(c)), sx(X), ay + 20, { c: big ? T.x : T.ink3, size: big ? 13 : 11, w: big ? 700 : 500, a: 'center', f: NUM });
  }
  arrow(g, sx(o), ay - 14, sx(o) + dir * 34, ay - 14, T.x, 2, 8);
  txt(g, '正', sx(o) + dir * 40, ay - 10, { c: T.x, size: 11.5, a: dir > 0 ? 'left' : 'right' });
  return sx;
}

// ---------------------------------------------------------------- 1 原点和正方向
const c1 = new Fig('c1', { ratio: .33, maxH: 230, minH: 175 });
const o1 = seg('o1', () => upd1()), d1 = seg('d1', () => upd1());
const s1 = ctl('c1-x', (v) => `家东边 ${v} m`.replace('东边 -', '西边 '), () => upd1());
function upd1() {
  const o = o1.v, d = +d1.v, X = s1.v;
  kpis('k1', [['车的位置 x', mi(f0(toC(X, o, d))), 'm', 'x'], ['家的位置', mi(f0(toC(0, o, d))), 'm'], ['便利店的位置', mi(f0(toC(STORE, o, d))), 'm']]);
  c1.dirty = true;
}
c1.draw = function (g, w, h) {
  const x0 = -25, x1 = 65, px = w / (x1 - x0), y = h * .6;
  const sx = road(g, w, y, x0, x1, px, { origin: o1.v, dir: +d1.v });
  drawCar(g, sx(s1.v), y, 4.76 * px * 1.6, {});
  txt(g, `x = ${mi(f0(toC(s1.v, o1.v, +d1.v)))} m`, sx(s1.v), y - 40, { c: T.x, size: 15, w: 700, a: 'center', f: NUM });
};

// ---------------------------------------------------------------- 2 位移和路程
const TT = M.tripTime(M.TRIP1);
const c2 = new Fig('c2', { ratio: .78, maxH: 470, minH: 330 });
let play2 = false;
const o2 = seg('o2', () => upd2());
const s2 = ctl('c2-t', (v) => `${f1(v)} s`, () => upd2());
$('p2').addEventListener('click', () => { if (s2.v >= TT - 0.01) s2.set(0); play2 = !play2; $('p2').textContent = play2 ? '❚❚ 暂停' : '▶ 播放'; });
/** 到 t 为止每一段开过的距离（停着的那段不算） */
function legs(t) { let tt = 0; const out = []; for (const [dt, v] of M.TRIP1) { const d = Math.min(dt, Math.max(0, t - tt)); if (v && d > 0) out.push(Math.abs(v * d)); tt += dt; } return out; }
function upd2() {
  const t = s2.v, q = M.trip(M.TRIP1, t), o = o2.v;
  const xs = toC(0, o, 1), xn = toC(q.x, o, 1);
  kpis('k2', [['现在的位置 x', mi(f0(xn)), 'm', 'x'], ['位移 Δx', sg(q.x, f0), 'm', 'x'], ['路程', f0(q.path), 'm']]);
  calc('m2', [`${Q('x', 'Δx')} = 末位置 − 初位置 = ${mi(f0(xn))} − (${mi(f0(xs))}) = <b class="qx">${sg(q.x, f0).replace('+', '')} m</b>`,
    `路程 = ${legs(t).length ? legs(t).map(f0).join(' + ') : '0'} = <b>${f0(q.path)} m</b><span class="nt">　（每一段都按正数加）</span>`]);
  c2.dirty = true;
}
c2.step = function (dt) {
  if (!play2) return false;
  let t = s2.v + dt;
  if (t >= TT) { t = TT; play2 = false; $('p2').textContent = '▶ 播放'; }
  s2.set(t);
  return true;
};
c2.draw = function (g, w, h) {
  const t = s2.v, q = M.trip(M.TRIP1, t), o = o2.v;
  const x0 = -15, x1 = 55, px = w / (x1 - x0), y = h * .2;
  const sx = road(g, w, y, x0, x1, px, { origin: o, dir: 1 });
  // 走过的路：一段一段画在路面上方
  let tt = 0, X = 0, lane = 0;
  for (const [dt, v] of M.TRIP1) {
    const d = Math.min(dt, Math.max(0, t - tt)); if (d > 0 && v !== 0) {
      const X2 = X + v * d, yy = y + 62 + lane * 9; arrow(g, sx(X), yy, sx(X2), yy, T.ink3, 2, 7); lane++;
      X = X2;
    }
    tt += dt;
  }
  if (Math.abs(q.x) > 0.3) arrow(g, sx(0), y + 2, sx(q.x), y + 2, T.x, 4, 10);
  const mv = M.trip(M.TRIP1, Math.min(t + 0.01, TT)).x - q.x;
  drawCar(g, sx(q.x), y, 4.76 * px * 1.5, { wheel: q.path / 0.32, dir: 1 });
  if (Math.abs(mv) > 1e-6 && t < TT) txt(g, mv > 0 ? '往东开' : '倒车', sx(q.x), y - 34, { c: T.ink2, size: 11.5, a: 'center' });
  // x-t 图
  const box = { x: 46, y: h * .52, w: w - 60, h: h * .48 - 34 };
  const ys = (X) => toC(X, o, 1);
  const lo = o === 'store' ? -40 : -10, hi = o === 'store' ? 20 : 50;
  const ax = axes(g, box, { x0: 0, x1: TT, y0: lo, y1: hi, xs: 1, ys: 10, xlab: '时间 t（s）', ylab: '位置 x（m）', yc: T.x });
  curve(g, (s) => ys(M.trip(M.TRIP1, s).x), 0, TT, ax.X, ax.Y, box, { c: T.x, lw: 1.5, alpha: .3, n: 140 });
  curve(g, (s) => ys(M.trip(M.TRIP1, s).x), 0, t, ax.X, ax.Y, box, { c: T.x, lw: 3, n: 140 });
  vline(g, ax.X(t), box);
  dot(g, ax.X(t), ax.Y(ys(q.x)), T.x, 6);
};

// ---------------------------------------------------------------- 3 位移是一个箭头
const R3 = 40;
const c3 = new Fig('c3', { ratio: .7, maxH: 400, minH: 260 });
const s3 = ctl('c3-f', (v) => `${Math.round(v * 100)}% 圈`, () => upd3());
function upd3() {
  const th = s3.v * TAU, arc = R3 * th, chord = 2 * R3 * Math.sin(th / 2);
  kpis('k3', [['路程（弧长）', f0(arc), 'm'], ['位移的大小（直线）', f0(chord), 'm', 'x'], ['差了', f0(arc - chord), 'm']]);
  c3.dirty = true;
}
c3.draw = function (g, w, h) {
  const r = Math.min(w, h) * .36, cx = w / 2, cy = h * .5, th = s3.v * TAU;
  const P = (a) => [cx + r * Math.sin(a), cy + r * Math.cos(a)];         // 从最下面出发，逆时针
  g.strokeStyle = T.line; g.lineWidth = 14; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
  g.strokeStyle = T.ink3; g.lineWidth = 4; g.beginPath();
  for (let k = 0; k <= 120; k++) { const [x, y] = P(th * k / 120); if (k) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  const [sx, sy] = P(0), [ex, ey] = P(th);
  if (Math.hypot(ex - sx, ey - sy) > 4) arrow(g, sx, sy, ex, ey, T.x, 4, 12);
  dot(g, sx, sy, T.ink, 6); txt(g, '起点', sx, sy + 24, { c: T.ink2, size: 12, a: 'center' });
  dot(g, ex, ey, T.x, 7);
  txt(g, `半径 ${R3} m`, cx, cy + 4, { c: T.ink3, size: 12, a: 'center' });
  txt(g, '灰线：路程　蓝箭头：位移', 8, 18, { c: T.ink2, size: 12 });
};

guesses({
  g1: { right: 1, text: '−30 m。家在便利店西边 30 m，朝东为正，西边就是负的。', run: () => { o1.set('store'); d1.set('1'); s1.set(0); } },
  g2: { right: 0, text: '位移只看起点（家门口）和终点（便利店门口）：30 m。路程是 40 + 10 = 50 m。', run: () => { s2.set(TT); } },
  g3: { right: 0, text: '0。回到了起点，起点指向终点的箭头长度是零。路程是一整圈 2π × 40 ≈ 251 m。', run: () => s3.set(1) },
});
upd1(); upd2(); upd3();
quiz(1, GEN[1]);
start();
