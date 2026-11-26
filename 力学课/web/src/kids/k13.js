// 启 13 · 东西掉下来有多快：楼顶松手每秒拍一张 → 速度每秒涨 10 → 线下面的三角形是掉了多远（井有多深）→ 重的轻的同时落地（留到启 18）
import { $, Fig, T, txt, start, calc, ctl } from '../ui.js';
import { vtGrid, vline, beats, kidGuesses, kidQuiz, kidChrome, dot } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(13);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, wait: '记下了。按下面的“松手”看。', text: '球越掉越快。每过 1 秒，速度都涨 10，涨得一样多。' },
  g2: { right: 1, text: '空气挡得很少的时候，重的和轻的掉得一样快，同时落地。' },
  g3: { right: 1, text: '往上飞的时候，速度每秒掉 10。20 掉到 0 要 2 秒，那就是最高点。然后它每秒涨 10 掉回来。' },
});

// ---------------------------------------------------------------- 第 2 步：楼顶松手
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? 1.05 : .52), maxH: 420, minH: 360 });
const s1 = { t: 0, run: false, n: 0 };
$('go1').addEventListener('click', () => { Object.assign(s1, { t: 0, run: true, n: 0 }); [1, 2, 3].forEach((k) => { $(`v${k}`).textContent = '？'; $(`d${k}`).textContent = '？'; }); });
c1.step = (dt) => {
  if (!s1.run) return false;
  s1.t = Math.min(3, s1.t + dt * .5);
  while (s1.n < Math.floor(s1.t + 1e-6)) { s1.n++; $(`v${s1.n}`).textContent = `${10 * s1.n}`; $(`d${s1.n}`).textContent = `${5 * s1.n * s1.n}`; }
  if (s1.t >= 3) { s1.run = false; B.unlock('b2', '3 秒掉了 45 米，差不多 15 层楼。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  return true;
};
c1.draw = function (g, w, h) {
  const lw = Math.min(190, w * .4), top = 30, bot = h - 30, Y = (m) => top + m / 48 * (bot - top), bx = lw * .62;
  // 楼
  g.fillStyle = T.road; g.globalAlpha = .16; g.fillRect(8, top, lw * .34, bot - top); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.strokeRect(8, top, lw * .34, bot - top); g.beginPath(); g.moveTo(0, bot); g.lineTo(lw, bot); g.stroke();
  for (let m = 0; m <= 45; m += 5) { g.lineWidth = 1.2; g.beginPath(); g.moveTo(8 + lw * .34, Y(m)); g.lineTo(14 + lw * .34, Y(m)); g.stroke(); if (m % 15 === 0) txt(g, `${m} 米`, 8 + lw * .17, Y(m) + (m ? 4 : 14), { c: T.ink3, size: 11, a: 'center' }); }
  for (let k = 0; k <= s1.n; k++) { if (k === 0 && s1.t === 0) break; g.globalAlpha = .4; dot(g, bx, Y(5 * k * k), T.x, 6); g.globalAlpha = 1; txt(g, `第 ${k} 秒`, bx + 11, Y(5 * k * k) + 4, { c: T.ink3, size: 11.5 }); }
  dot(g, bx, Y(5 * s1.t * s1.t), T.x, 7);
  // 速度-时间图
  const box = { x: lw + 36, y: 34, w: w - lw - 56, h: h - 34 - 46 };
  const { X, Y: V } = vtGrid(g, box, { t1: 3, v1: 30, vs: 10, note: w < 500 ? '↑ 每秒几米' : '↑ 越往上越快（每秒几米）' });
  if (s1.t > 0) { vline(g, [{ t: 0, v: 0 }, { t: s1.t, v: 10 * s1.t }], X, V, T.v, 3.5); for (let k = 0; k <= s1.n; k++) dot(g, X(k), V(10 * k), T.v, 5); dot(g, X(s1.t), V(10 * s1.t), T.v, 5); }
  else txt(g, '按“松手”', box.x + box.w / 2, box.y + box.h / 2, { c: T.ink3, size: 14, a: 'center' });
};

// ---------------------------------------------------------------- 第 4 步：井有多深
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? .8 : .42), maxH: 320, minH: 250 });
let ok2 = false;
const s2 = ctl('s2', (v) => `${v} 秒`, () => {
  const t = s2.v;
  calc('calc2', [`三角形的底是 ${t} 秒，高是每秒 ${10 * t} 米`, `${t} × ${10 * t} ÷ 2 = <b>${5 * t * t} 米</b>`]);
  if (!ok2 && t === 3) { ok2 = true; B.unlock('b4', '井深大约 45 米。'); }
  c2.dirty = true;
});
c2.draw = function (g, w, h) {
  const box = { x: 44, y: 30, w: w - 62, h: h - 30 - 46 }, t = s2.v;
  const { X, Y } = vtGrid(g, box, { t1: 4, v1: 40, vs: 10, note: '↑ 越往上越快（每秒几米）' });
  g.fillStyle = T.v; g.globalAlpha = .2; g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(t), Y(10 * t)); g.lineTo(X(t), Y(0)); g.closePath(); g.fill(); g.globalAlpha = 1;
  vline(g, [{ t: 0, v: 0 }, { t: 4, v: 40 }], X, Y, T.v, 2.5, .35); vline(g, [{ t: 0, v: 0 }, { t, v: 10 * t }], X, Y, T.v, 3.5); dot(g, X(t), Y(10 * t), T.v, 5);
  txt(g, `掉了 ${5 * t * t} 米`, X(t * .66), Y(10 * t * .22), { c: T.ink, size: 13, w: 700, a: 'center' });
};
s2.upd();

kidQuiz(13, KGEN[13]);
start();
