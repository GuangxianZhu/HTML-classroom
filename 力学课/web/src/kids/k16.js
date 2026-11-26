// 启 16 · 一牛有多大：约定 1 牛 → 冰面上用弹簧秤拉木块，找 3 种都要 4 牛的办法 → 力 = 质量 × 每秒涨多少 → 推 1000 千克的车
import { $, Fig, T, txt, start, kpis, ctl, seg, calc } from '../ui.js';
import { CAR_L, rollRoad, carAt, vtGrid, vline, farrow, beats, kidGuesses, kidQuiz, kidChrome, dot, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(16);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, text: '1 千克每秒涨 3 要 3 牛。2 千克是它的 2 倍，要 6 牛。是乘，不是加。' },
  g2: { right: 2, text: '1000 千克，每秒掉 5：1000 × 5 = 5000 牛。这个力是往后的。' },
  g3: { right: 1, text: '3000 ÷ 6000 = 0.5。轿车是 3000 ÷ 1000 = 3。同样的力，货车涨得只有六分之一。' },
});

// ---------------------------------------------------------------- 第 2 步：弹簧秤拉木块
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .5 : .26), maxH: 210, minH: 170 });
const found = new Set();
let u1 = 0;                                                         // 动画时间：木块从左边起步，2.4 秒一轮
const upd1 = () => {
  const m = +ms.v, a = +as.v, F = m * a;
  kpis('k1', [['质量', `${m}`, '千克', 'm'], ['速度每秒涨', `${a}`, '', 'a'], ['秤上的拉力', `${F}`, '牛', 'F']]);
  if (F === 4) found.add(`${m} 千克，每秒涨 ${a}`);
  $('cap1').textContent = found.size ? `要 4 牛的办法，找到 ${found.size} 种：${[...found].join('；')}。` : '还没有找到要 4 牛的办法。';
  if (found.size >= 3) { B.unlock('b2', '3 种都找到了。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  u1 = 0; c1.dirty = true;
};
const ms = seg('m1', () => upd1()), as = seg('a1', () => upd1());
c1.step = (dt) => { u1 = (u1 + dt) % 2.9; return true; };
c1.draw = function (g, w, h) {
  const y = h - 46, m = +ms.v, a = +as.v, F = m * a, t = Math.min(u1, 2.4), S = 26 + m * 9;
  g.fillStyle = T.x; g.globalAlpha = .1; g.fillRect(0, y, w, 12); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  txt(g, '冰面', 8, y + 28, { c: T.ink3, size: 12 });
  const k = (w - 250) / (4 * 2.4 * 2.4 / 2), x = 14 + a * t * t / 2 * Math.max(k, 4);
  g.fillStyle = T.m; g.globalAlpha = .8; rr(g, x, y - S, S, S, 3); g.fill(); g.globalAlpha = 1;
  txt(g, `${m} 千克`, x + S / 2, y - S - 7, { c: T.ink2, size: 12, w: 700, a: 'center' });
  // 弹簧秤：一段锯齿（拉力越大拉得越长）+ 箭头
  const sx = x + S, sy = y - S / 2, L = 16 + F * 3;
  g.strokeStyle = T.ink2; g.lineWidth = 1.6; g.beginPath(); g.moveTo(sx, sy);
  for (let i = 1; i <= 8; i++) g.lineTo(sx + L * i / 8, sy + (i % 2 ? -5 : 5) * (i < 8 ? 1 : 0));
  g.stroke();
  farrow(g, sx + L + 2, sy, 1, 0, 14 + F * 5, '');
  txt(g, `拉力 ${F} 牛`, sx + L + 6, sy - 12, { c: T.F, size: 13, w: 700 });
};

// ---------------------------------------------------------------- 第 4 步：推 1000 千克的车
const DUR = 5, M = 1000;
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? 1.05 : .56), maxH: 430, minH: 340 });
const s2 = { t: 0, off: 0, run: false, F: 1000, ok: false };
const show2 = () => calc('calc2', [`每秒涨多少 = 力 ÷ 质量`, `${push.v} ÷ ${M} = <b>${push.v / M}</b>`]);
const push = ctl('s2', (v) => `${v} 牛`, () => { if (!s2.run) { s2.t = 0; s2.F = push.v; } show2(); c2.dirty = true; });
$('go2').addEventListener('click', () => { Object.assign(s2, { t: 0, off: 0, run: true, F: push.v }); });
c2.step = (dt) => {
  if (!s2.run) return false;
  const a = s2.F / M, t1 = Math.min(DUR, s2.t + dt);
  s2.off += a * (s2.t + t1) / 2 * (t1 - s2.t); s2.t = t1;
  if (s2.t >= DUR) {
    s2.run = false; const v = a * DUR;
    if (v === 20) { $('cap2').textContent = '做到了！每秒涨 4，要 1000 × 4 = 4000 牛。'; if (!s2.ok) { s2.ok = true; B.unlock('b4', '做到了。'); } }
    else $('cap2').textContent = `5 秒到了每秒 ${v} 米。${v < 20 ? '还不够快。' : '太快了。'}想一想：5 秒涨到 20，每秒要涨多少？`;
  }
  return true;
};
c2.draw = function (g, w, h) {
  const px = 7, L = CAR_L * px * 1.2, cx = w * .3, y = 70, F = s2.run ? s2.F : push.v;
  rollRoad(g, w, y, s2.off, px); carAt(g, cx, y - L * .2, L, {});
  farrow(g, cx + L / 2 + 2, y - 16, 1, 0, F / 6000 * Math.min(150, w * .4), '');
  txt(g, `往前推 ${F} 牛`, cx + L / 2 + 6, y - 28, { c: T.F, size: 12.5, w: 700 });
  const box = { x: 44, y: 128, w: w - 62, h: h - 128 - 44 };
  const { X, Y } = vtGrid(g, box, { t1: DUR, v1: 30, vs: 5, note: '↑ 越往上越快（每秒几米）' });
  g.strokeStyle = T.a; g.lineWidth = 2; g.beginPath(); g.arc(X(5), Y(20), 8, 0, 7); g.stroke();
  txt(g, '目标', X(5) - 12, Y(20) + 4, { c: T.a, size: 12, w: 700, a: 'right' });
  if (s2.t > 0) { const v = s2.F / M * s2.t; vline(g, [{ t: 0, v: 0 }, { t: s2.t, v }], X, Y, T.v, 3.5); dot(g, X(s2.t), Y(v), T.v, 5); }
};
upd1(); show2();

kidQuiz(16, KGEN[16]);
start();
