// 启 14 · 不踩油门，车为什么会停：三种地面各滑一次 → 一点都不拖会怎样 → 起名字“力” → 推和拖一样大时速度不变
import { $, Fig, T, txt, start, kpis, ctl } from '../ui.js';
import { CAR_L, rollRoad, carAt, vtGrid, vline, farrow, clamp, beats, kidGuesses, kidQuiz, kidChrome, dot } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(14);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, text: '地面和空气一直在往后拖车。拖得越少，车滑得越远。不是“不推就会停”。' },
  g2: { right: 1, later: true, wait: '记下了。按下面的按钮看。', text: '没有东西拖它，速度就一点不掉。它会一直每秒 10 米滑下去。' },
  g3: { right: 1, text: '松手以后，手就碰不到冰壶了，没有东西在推。冰很滑，拖得很少，所以它滑得远。' },
});
const one = (x) => (Math.round(x * 10) / 10).toString();
const V0 = 10;

// ---------------------------------------------------------------- 第 2 步：三种地面
const NAMES = { 5: '沙地', 2: '柏油路', 0.5: '冰面' };
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? 1.1 : .6), maxH: 450, minH: 350 });
const s1 = { dec: 0, t: 0, run: false, done: new Set() };
const btn1 = [...$('pick1').querySelectorAll('button')];
btn1.forEach((b) => b.addEventListener('click', () => { Object.assign(s1, { dec: +b.dataset.v, t: 0, run: true }); btn1.forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
const vAt = (dec, t) => Math.max(0, V0 - dec * t), xAt = (dec, t) => { const k = Math.min(t, V0 / dec); return V0 * k - dec * k * k / 2; };
c1.step = (dt) => {
  if (!s1.run) return false;
  const end = V0 / s1.dec;
  s1.t = Math.min(end, s1.t + dt * (s1.dec < 1 ? 4 : 1));
  if (s1.t >= end) {
    s1.run = false; s1.done.add(s1.dec);
    $(`a${s1.dec}`).textContent = `${s1.dec}`; $(`d${s1.dec}`).textContent = `${xAt(s1.dec, end)} 米`;
    if (s1.done.size === 3) { B.unlock('b2', '三种都滑过了：10 米、25 米、100 米。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  }
  return true;
};
// 线的名字：冰面那条写在线中间，另外两条写在线落到 0 的地方，免得挤在一起
const lab1 = (g, X, Y, d, c, w) => (d < 1 ? txt(g, NAMES[d], X(V0 / d / 2) + 6, Y(V0 / 2) - 5, { c, size: 12, w }) : txt(g, NAMES[d], X(V0 / d) + 5, Y(0) - 8, { c, size: 12, w }));
c1.draw = function (g, w, h) {
  const y = 64, len = 112, px = (w - 44) / len, sx = (m) => 22 + m * px;
  g.fillStyle = T.road; g.globalAlpha = .15; g.fillRect(0, y - 30, w, 32); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y + 1); g.lineTo(w, y + 1); g.stroke();
  const lab = px * 10 < 44 ? 20 : 10;
  for (let m = 0; m <= len; m += 10) { g.lineWidth = 1.5; g.beginPath(); g.moveTo(sx(m), y + 1); g.lineTo(sx(m), y + 7); g.stroke(); if (m % lab === 0) txt(g, `${m} 米`, sx(m), y + 21, { c: T.ink3, size: 11.5, a: 'center' }); }
  for (const d of s1.done) if (d !== s1.dec) { const x = sx(xAt(d, 99)); g.strokeStyle = T.ink3; g.setLineDash([3, 3]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y - 30); g.lineTo(x, y); g.stroke(); g.setLineDash([]); txt(g, NAMES[d], x - 3, y - 34, { c: T.ink3, size: 11.5, a: 'right' }); }
  const L = Math.max(30, CAR_L * px), x = s1.dec ? xAt(s1.dec, s1.t) : 0, cx = sx(x) - L / 2;
  carAt(g, cx, y - 6 - L * .2, L, {});
  if (s1.dec && vAt(s1.dec, s1.t) > 0) farrow(g, cx - L / 2 - 2, y - 14, -1, 0, 10 + s1.dec * 9, s1.dec >= 2 ? '地面往后拖' : '', { side: 1 });
  const box = { x: 44, y: 124, w: w - 62, h: h - 124 - 44 };
  const { X, Y } = vtGrid(g, box, { t1: 20, v1: 12, vs: 2, ts: 2, note: '↑ 越往上越快（每秒几米）' });
  for (const d of s1.done) if (d !== s1.dec) { vline(g, [{ t: 0, v: V0 }, { t: V0 / d, v: 0 }], X, Y, T.ink3, 2.5, .5); lab1(g, X, Y, d, T.ink3, 500); }
  if (!s1.dec) { txt(g, '点一种地面开始', box.x + box.w / 2, box.y + box.h / 2, { c: T.ink3, size: 14, a: 'center' }); return; }
  vline(g, [{ t: 0, v: V0 }, { t: s1.t, v: vAt(s1.dec, s1.t) }], X, Y, T.v, 3.5); dot(g, X(s1.t), Y(vAt(s1.dec, s1.t)), T.v, 5);
  if (s1.run) txt(g, NAMES[s1.dec], X(s1.t) + 9, Y(vAt(s1.dec, s1.t)) - 7, { c: T.v, size: 12.5, w: 700 }); else lab1(g, X, Y, s1.dec, T.v, 700);
};

// ---------------------------------------------------------------- 第 3 步：一点都不拖
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? .9 : .46), maxH: 340, minH: 270 });
const s2 = { t: 0, run: false, off: 0 };
const show2 = () => kpis('k2', [['速度：每秒', `${V0}`, '米', 'v'], ['过了', `${Math.floor(s2.t)}`, '秒'], ['已经滑了', `${Math.round(s2.t * V0)}`, '米', 'x']]);
$('go2').addEventListener('click', () => { s2.t = 0; s2.run = true; G.reveal('g2'); });
c2.step = (dt) => {
  if (!s2.run) return false;
  s2.t += dt; s2.off += V0 * dt; show2();
  if (s2.t >= 10) B.unlock('b3', '10 秒了，速度一点没掉。它还会一直滑下去。');
  if (s2.t >= 20) s2.run = false;
  return true;
};
c2.draw = function (g, w, h) {
  const px = 7, L = CAR_L * px * 1.2;
  rollRoad(g, w, 58, s2.off, px); carAt(g, 30 + L / 2, 58 - L * .2, L, {});
  txt(g, s2.t > 0 ? '没有往后拖的箭头' : '按下面的按钮', 30 + L + 14, 40, { c: T.ink3, size: 12.5 });
  const box = { x: 44, y: 112, w: w - 62, h: h - 112 - 44 };
  const { X, Y } = vtGrid(g, box, { t1: 20, v1: 12, vs: 2, ts: 2, note: '↑ 越往上越快（每秒几米）' });
  if (s2.t > 0) { vline(g, [{ t: 0, v: V0 }, { t: Math.min(20, s2.t), v: V0 }], X, Y, T.v, 3.5); dot(g, X(Math.min(20, s2.t)), Y(V0), T.v, 5); }
};
show2();

// ---------------------------------------------------------------- 第 5 步：往前推和往后拖
const DRAG = 3, DUR = 8;
const c3 = new Fig('c3', { ratio: (w) => (w < 500 ? 1.05 : .58), maxH: 430, minH: 340 });
const s3 = { v: 20, t: 0, off: 0, run: false, pts: [{ t: 0, v: 20 }], flat0: 0, ok: false };
const push = ctl('s3', (v) => `${v} 格`, () => { c3.dirty = true; });
const tip3 = () => { $('cap3').textContent = `往前推 ${push.v} 格，往后拖 ${DRAG} 格。${push.v > DRAG ? '推的大，速度会涨。' : push.v < DRAG ? '拖的大，速度会掉。' : '一样大，速度不变。'}`; };
push.el.addEventListener('input', tip3); tip3();
$('go3').addEventListener('click', () => { Object.assign(s3, { v: 20, t: 0, run: true, pts: [{ t: 0, v: 20 }], flat0: 0 }); });
c3.step = (dt) => {
  if (!s3.run) return false;
  const t1 = Math.min(DUR, s3.t + dt), v0 = s3.v;
  s3.v = clamp(s3.v + (push.v - DRAG) * 2 * (t1 - s3.t), 0, 30); s3.off += s3.v * (t1 - s3.t); s3.t = t1;
  s3.pts.push({ t: s3.t, v: s3.v });
  if (s3.v !== v0 || s3.v <= 0) s3.flat0 = s3.t;
  if (!s3.ok && s3.t - s3.flat0 >= 3) { s3.ok = true; B.unlock('b5', '做到了。'); $('cap3').textContent = `做到了！推 3 格，拖 3 格，正好抵掉。速度一直是每秒 ${one(s3.v)} 米。`; }
  if (s3.t >= DUR) { s3.run = false; if (!s3.ok) $('cap3').textContent = '还没有连着 3 秒不变。想一想：往前推几格，才能正好抵掉往后拖的 3 格？'; }
  return true;
};
c3.draw = function (g, w, h) {
  const px = 7, L = CAR_L * px * 1.2, cx = w / 2, y = 70, u = Math.min(22, (w / 2 - L / 2 - 20) / 6);
  rollRoad(g, w, y, s3.off, px); carAt(g, cx, y - L * .2, L, {});
  farrow(g, cx + L / 2 + 2, y - 16, 1, 0, push.v * u, push.v ? `发动机往前推 ${push.v} 格` : '', { side: -1 });
  if (s3.v > 0 || !s3.run) farrow(g, cx - L / 2 - 2, y - 16, -1, 0, DRAG * u, `往后拖 ${DRAG} 格`, { side: 1 });
  const box = { x: 44, y: 128, w: w - 62, h: h - 128 - 44 };
  const { X, Y } = vtGrid(g, box, { t1: DUR, v1: 30, vs: 5, note: '↑ 越往上越快（每秒几米）' });
  vline(g, s3.pts, X, Y, T.v, 3.5); const p = s3.pts[s3.pts.length - 1]; dot(g, X(p.t), Y(p.v), T.v, 5);
};

kidQuiz(14, KGEN[14]);
start();
