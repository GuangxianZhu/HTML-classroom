// 启 35 · 最高车速：50000 瓦的发动机，推力 = 50000 ÷ 车速；风拖的力 = 0.4 × 车速 × 车速；两个力在每秒 50 米碰头 → 功率加倍或风减半都是每秒 63 米，两样都改是 79
import { $, Fig, T, txt, start, kpis, calc } from '../ui.js';
import { CAR_L, rollRoad, carAt, farrow, vtGrid, vline, beats, kidGuesses, kidQuiz, kidChrome } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(35);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, wait: '记下了。踩到底看看。', text: '往后拖的力追上了往前推的力。发动机一直在全力出力。' },
  g2: { right: 1, text: '变低。上坡时重力有一部分顺着坡往后拉。往后的力多了，和推力碰头的地方就提前了。' },
  g3: { right: 1, text: '改的是风。趴低了，迎着风的面小了，风拖的力就小。推力没变，碰头的车速就高了。' },
});
const P0 = 50000, C0 = .4, M = 1000, push = (v, P = P0) => P / v, drag = (v, c = C0) => c * v * v;

const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .92 : .46), maxH: 380, minH: 320 });
const s = { t: 0, v: 5, x: 0, run: false, done: false, pts: [{ t: 0, v: 5 }] };
const round = (v) => (v > 49.5 ? 50 : Math.round(v));
const show = () => { const v = round(s.v), a = Math.round(push(v) / 10) * 10, b = Math.round(drag(v) / 10) * 10; kpis('k1', [['车速：每秒', `${v}`, '米', 'v'], ['往前推', `${a}`, '牛', 'F'], ['往后拖', `${b}`, '牛', 'F'], ['合力', `${a - b}`, '牛']]); };
$('go1').addEventListener('click', () => Object.assign(s, { t: 0, v: 5, x: 0, run: true, pts: [{ t: 0, v: 5 }] }));
c1.step = (dt) => {
  if (!s.run) return false;
  const n = 6, h = Math.min(dt, .05);
  for (let i = 0; i < n; i++) { s.v += (push(s.v) - drag(s.v)) / M * h; s.x += s.v * h; s.t += h; }
  s.pts.push({ t: s.t, v: s.v });
  if (s.v >= 49.6) { s.run = false; if (!s.done) { s.done = true; B.unlock('b2', '到每秒 50 米，就上不去了。'); G.reveal('g1'); G.echo('g1', 'echo1'); } }
  show(); return true;
};
c1.draw = function (g, w, h) {
  const px = 7, L = CAR_L * px * 1.2, cx = w / 2, y = 78, av = w / 2 - L / 2 - 24, k = av / 2500;
  rollRoad(g, w, y, s.x, px); carAt(g, cx, y - L * .2, L, {});
  const a = push(Math.max(s.v, 10)), b = drag(s.v);
  const la = Math.min(av, a * k), lb = Math.min(av, b * k);
  farrow(g, cx - L / 2 - 6 - la, y - 16, 1, 0, la, ''); txt(g, '往前推', cx - L / 2 - 8, y - 32, { c: T.F, size: 12, w: 700, a: 'right' });
  if (lb >= 2) farrow(g, cx + L / 2 + 6 + lb, y - 16, -1, 0, lb, ''); txt(g, '风往后拖', cx + L / 2 + 8, y - 32, { c: T.F, size: 12, w: 700 });
  const box = { x: 34, y: y + 46, w: w - 60, h: h - y - 96 };
  const { X, Y } = vtGrid(g, box, { t1: 80, v1: 60, vs: 10, ts: 20, note: '↑ 车速，每秒几米' });
  g.strokeStyle = T.ink3; g.lineWidth = 1; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(box.x, Y(50)); g.lineTo(box.x + box.w, Y(50)); g.stroke(); g.setLineDash([]);
  vline(g, s.pts, X, Y, T.v);
};
show();

// ---------------------------------------------------------------- 第 4 步
const CARS = [[P0, C0, '原来的车'], [P0 * 2, C0, '功率加倍'], [P0, C0 / 2, '风的力减半'], [P0 * 2, C0 / 2, '两样都改']];
const seen = new Set(), btn2 = [...$('pick2').querySelectorAll('button')];
btn2.forEach((b) => b.addEventListener('click', () => {
  btn2.forEach((x) => x.setAttribute('aria-pressed', x === b));
  const i = +b.dataset.v, [P, c, name] = CARS[i], v = Math.round(Math.cbrt(P / c)), F = Math.round(P / v);
  seen.add(i); $(`m${i}`).textContent = `${v}`;
  calc('calc2', [`${name}：最高车速每秒 <b>${v} 米</b>`, `这时往前推：${P} ÷ ${v} ≈ ${F} 牛`, `风往后拖：也是 ${F} 牛左右`, '两个力碰头，合力是 0']);
  if (seen.size === 4) B.unlock('b4', '50、63、63、79。');
}));

kidQuiz(35, KGEN[35]);
start();
