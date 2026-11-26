// 启 23 · 两个方向各管各：两个球同时离开 45 米高台（一个直掉、一个横着飞）→ 竖着一样、横着不变 → 空投包裹要提前 60 米
import { $, Fig, T, txt, start, ctl } from '../ui.js';
import { beats, kidGuesses, kidQuiz, kidChrome, dot, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(23);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, wait: '记下了。按下面的按钮看。', text: '同时落地。横着飞得多快，都不耽误它往下掉。' },
  g2: { right: 1, text: '一样久。在空中待多久只看有多高。使劲扔，只是落得更远。' },
  g3: { right: 1, text: '车一离开桥面就开始往下掉。1 秒掉 5 米，和横着多快没关系。' },
});
const H = 45, TF = 3;                                             // 45 米高，3 秒落地

// ---------------------------------------------------------------- 第 2 步：两个球
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .95 : .5), maxH: 400, minH: 320 });
const s1 = { v: 0, t: 0, run: false, done: new Set() };
const btn1 = [...$('pick1').querySelectorAll('button')];
btn1.forEach((b) => b.addEventListener('click', () => { Object.assign(s1, { v: +b.dataset.v, t: 0, run: true }); btn1.forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
c1.step = (dt) => {
  if (!s1.run) return false;
  s1.t = Math.min(TF, s1.t + dt * .7);
  if (s1.t >= TF) {
    s1.run = false; s1.done.add(s1.v); $(`t${s1.v}`).textContent = '3'; $(`x${s1.v}`).textContent = `${s1.v * 3}`;
    if (s1.done.size === 3) { B.unlock('b2', '三次都是 3 秒落地，和蓝球一起。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  }
  return true;
};
c1.draw = function (g, w, h) {
  const top = 34, bot = h - 30, k = (bot - top) / H, tw = Math.min(70, w * .16), x0 = tw + 14, kx = Math.min(k, (w - x0 - 26) / 48);
  const X = (m) => x0 + m * kx, Y = (m) => top + m * k;
  g.fillStyle = T.road; g.globalAlpha = .18; g.fillRect(0, top, tw, bot - top); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, top); g.lineTo(tw, top); g.lineTo(tw, bot); g.moveTo(0, bot); g.lineTo(w, bot); g.stroke();
  txt(g, '45 米高', tw / 2, (top + bot) / 2, { c: T.ink3, size: 12, a: 'center' });
  for (let m = 0; m <= 45; m += 15) { txt(g, `${m} 米`, X(m), bot + 18, { c: T.ink3, size: 11, a: 'center' }); g.lineWidth = 1.2; g.beginPath(); g.moveTo(X(m), bot); g.lineTo(X(m), bot + 5); g.stroke(); }
  if (!s1.v) { txt(g, '点一个速度开始', (x0 + w) / 2, h / 2, { c: T.ink3, size: 14, a: 'center' }); dot(g, X(0), Y(0), T.x, 7); dot(g, X(0) + 9, Y(0), T.a, 7); return; }
  for (let n = 0; n <= Math.floor(s1.t + 1e-6); n++) {
    const y = Y(5 * n * n);
    g.strokeStyle = T.ink3; g.setLineDash([3, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(X(0), y); g.lineTo(X(s1.v * n), y); g.stroke(); g.setLineDash([]);
    g.globalAlpha = .45; dot(g, X(0), y, T.x, 6); dot(g, X(s1.v * n), y, T.a, 6); g.globalAlpha = 1;
    if (n) txt(g, `第 ${n} 秒`, X(s1.v * n) + 10, y - 6, { c: T.ink3, size: 11.5 });
  }
  dot(g, X(0), Y(5 * s1.t * s1.t), T.x, 7); dot(g, X(s1.v * s1.t), Y(5 * s1.t * s1.t), T.a, 7);
};

// ---------------------------------------------------------------- 第 4 步：空投
const VD = 20, X0 = -100, TG = 0;                                 // 无人机每秒 20 米，从靶子左边 100 米飞来
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? .8 : .4), maxH: 330, minH: 280 });
const s2 = { t: 0, run: false, d: 0, hit: null, ok: false };
const lead = ctl('s2', (v) => `${v} 米`, () => { if (!s2.run) { s2.t = 0; s2.hit = null; s2.d = lead.v; $('cap2').textContent = `离靶子还有 ${lead.v} 米的时候松手。`; } c2.dirty = true; });
$('go2').addEventListener('click', () => { Object.assign(s2, { t: 0, run: true, d: lead.v, hit: null }); });
const relT = () => (TG - s2.d - X0) / VD;                          // 飞到松手的地方要几秒
c2.step = (dt) => {
  if (!s2.run) return false;
  s2.t += dt * .9;
  if (s2.t >= relT() + TF && s2.hit === null) {
    s2.hit = TG - s2.d + VD * TF; const off = s2.hit - TG;
    $('cap2').textContent = off === 0 ? '正中靶子！包裹掉 3 秒，这 3 秒它还往前飞了 20 × 3 = 60 米。' : `落在靶子前面 ${off} 米的地方，飞过头了。包裹松手以后还在往前飞。`;
    if (off === 0 && !s2.ok) { s2.ok = true; B.unlock('b4', '做到了：提前 60 米。'); }
  }
  if (s2.t >= relT() + TF + 1) s2.run = false;
  return true;
};
c2.draw = function (g, w, h) {
  const top = 40, bot = h - 34, k = (bot - top) / H, kx = (w - 30) / 190, X = (m) => 15 + (m + 105) * kx, Y = (m) => top + m * k;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, bot); g.lineTo(w, bot); g.stroke();
  g.fillStyle = T.F; rr(g, X(TG) - 14, bot - 4, 28, 8, 2); g.fill(); txt(g, '靶子', X(TG), bot + 22, { c: T.F, size: 12, w: 700, a: 'center' });
  const xr = TG - s2.d; g.strokeStyle = T.ink3; g.setLineDash([4, 4]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(X(xr), top - 12); g.lineTo(X(xr), bot); g.stroke(); g.setLineDash([]);
  txt(g, '在这里松手', X(xr), bot + 22, { c: T.ink3, size: 11.5, a: s2.d < 30 ? 'right' : 'center' });
  const xd = Math.min(X0 + VD * s2.t, 85), tr = relT(), tt = Math.max(0, Math.min(TF, s2.t - tr));
  g.fillStyle = T.ink2; rr(g, X(xd) - 15, top - 9, 30, 9, 3); g.fill(); g.fillRect(X(xd) - 22, top - 12, 14, 3); g.fillRect(X(xd) + 8, top - 12, 14, 3);
  txt(g, '每秒 20 米 →', X(xd), top - 20, { c: T.ink3, size: 11.5, a: 'center' });
  const px = s2.t < tr ? xd : xr + VD * tt, py = s2.t < tr ? 2 : 5 * tt * tt;
  if (s2.t >= tr) { g.strokeStyle = T.a; g.lineWidth = 2; g.globalAlpha = .5; g.beginPath(); for (let u = 0; u <= tt; u += .1) g.lineTo(X(xr + VD * u), Y(5 * u * u) + 4); g.stroke(); g.globalAlpha = 1; }
  g.fillStyle = T.a; rr(g, X(px) - 6, Y(py) + 1, 12, 10, 2); g.fill();
};
lead.upd();

kidQuiz(23, KGEN[23]);
start();
