// 启 28 · 车带着的劲：2000 牛把 1000 千克的车推到每秒 10 / 20 / 30 米，功是 5 万 / 20 万 / 45 万焦 → 起名字“动能” → 刹车距离 = 动能 ÷ 刹车的力
import { $, Fig, T, txt, start, kpis, ctl, calc } from '../ui.js';
import { CAR_L, rollRoad, carAt, farrow, beats, kidGuesses, kidQuiz, kidChrome, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(28);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, text: '是 4 倍。推到每秒 10 米要 50000 焦，推到每秒 20 米要 200000 焦。' },
  g2: { right: 2, text: '货车：2000 × 10 × 10 ÷ 2 = 100000 焦。轿车：1000 × 20 × 20 ÷ 2 = 200000 焦。速度要乘两次。' },
  g3: { right: 1, text: '每秒 20 米是 200000 焦。每秒 30 米是 450000 焦，2 倍还多。刹车距离也是 2 倍还多。' },
});
const M = 1000, F = 2000, ke = (v) => M * v * v / 2;

// ---------------------------------------------------------------- 第 2 步
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .52 : .24), maxH: 200, minH: 180 });
const s = { goal: 0, t: 0, x: 0, v: 0, run: false, done: new Set() };
const btn1 = [...$('pick1').querySelectorAll('button')];
const show = () => kpis('k1', [['车速：每秒', `${Math.round(s.v)}`, '米', 'v'], ['推了', `${Math.round(s.x)}`, '米', 'x'], ['做的功', `${Math.round(F * s.x)}`, '焦', 'E']]);
btn1.forEach((b) => b.addEventListener('click', () => { Object.assign(s, { goal: +b.dataset.v, t: 0, x: 0, v: 0, run: true }); btn1.forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
c1.step = (dt) => {
  if (!s.run) return false;
  const a = F / M; s.t += dt * 3; s.v = Math.min(s.goal, a * s.t); s.x = s.v * s.v / (2 * a);
  if (s.v >= s.goal) {
    s.run = false; s.done.add(s.goal); $(`d${s.goal}`).textContent = `${s.x}`; $(`w${s.goal}`).textContent = `${F * s.x}`;
    if (s.done.size === 3) { B.unlock('b2', '5 万、20 万、45 万焦。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  }
  show(); return true;
};
c1.draw = function (g, w, h) {
  const px = 7, L = CAR_L * px * 1.2, cx = w * .4, y = 70;
  rollRoad(g, w, y, s.x, px); carAt(g, cx, y - L * .2, L, {});
  if (s.run || !s.goal) { farrow(g, cx - L / 2 - 52, y - 16, 1, 0, 48, ''); txt(g, '2000 牛', cx - L / 2 - 28, y - 28, { c: T.F, size: 12.5, w: 700, a: 'center' }); }
  const bx = 14, bw = w - 28, by = y + 34;
  g.fillStyle = T.line; rr(g, bx, by, bw, 18, 4); g.fill();
  g.fillStyle = T.E; rr(g, bx, by, Math.max(2, bw * F * s.x / 450000), 18, 4); g.fill();
  for (const v of [10, 20, 30]) { const x = bx + bw * ke(v) / 450000; g.strokeStyle = T.ink2; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, by - 4); g.lineTo(x, by + 22); g.stroke(); txt(g, `${v}`, v === 30 ? x - 8 : x, by + 38, { c: T.ink3, size: 12, w: 700, a: 'center' }); }
  txt(g, '已经做的功', bx, by - 8, { c: T.E, size: 12, w: 700 });
  txt(g, '下面的数：车速每秒几米', bx + bw, by - 8, { c: T.ink3, size: 11.5, a: 'right' });
};
show();

// ---------------------------------------------------------------- 第 4 步
let ok2 = false;
const BR = 5000;
const v2 = ctl('s2', (v) => `${v} 米`, () => {
  const v = v2.v, k = ke(v);
  calc('calc2', [`动能 = 1000 × ${v} × ${v} ÷ 2 = <b>${k} 焦</b>`, `刹车距离 = 动能 ÷ 往后拖的力`, `${k} ÷ ${BR} = <b>${k / BR} 米</b>`]);
  if (v === 30 && !ok2) { ok2 = true; B.unlock('b4', '90 米，和第 12 小课一样。'); }
});
v2.upd();

kidQuiz(28, KGEN[28]);
start();
