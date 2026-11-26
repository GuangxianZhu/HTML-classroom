// 启 31 · 每秒能给多少劲：发动机每秒做 50000 焦的功，到每秒 10 / 20 / 30 米分别是第 1 / 4 / 9 秒（三段用 1 / 3 / 5 秒）→ 起名字“功率”，单位瓦 → 推力 = 功率 ÷ 车速
import { $, Fig, T, txt, start, kpis, ctl, calc } from '../ui.js';
import { CAR_L, rollRoad, carAt, beats, kidGuesses, kidQuiz, kidChrome, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(31);
const B = beats();
const G = kidGuesses({
  g1: { right: 2, later: true, wait: '记下了。踩到底，掐表看看。', text: '最后一段。三段分别用了 1 秒、3 秒、5 秒。' },
  g2: { right: 1, text: '书一样重，楼一样高，做的功一样。小东用的时间是三分之一，功率是 3 倍。' },
  g3: { right: 2, text: '1500 瓦是 10 瓦的 150 倍。水壶 1 分钟用掉的能量，台灯要用 150 分钟。' },
});
const P = 50000, M = 1000, ke = (v) => M * v * v / 2;

const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .52 : .24), maxH: 200, minH: 180 });
const s = { t: 0, v: 0, x: 0, run: false, hit: 0 };
const show = () => kpis('k1', [['表上', (Math.round(s.t * 10) / 10).toFixed(1), '秒'], ['车速：每秒', `${Math.round(s.v)}`, '米', 'v'], ['动能', `${Math.round(P * s.t / 1000) * 1000}`, '焦', 'E']]);
$('go1').addEventListener('click', () => { Object.assign(s, { t: 0, v: 0, x: 0, run: true, hit: 0 }); for (const v of [10, 20, 30]) { $(`t${v}`).textContent = '？'; $(`d${v}`).textContent = '？'; } });
c1.step = (dt) => {
  if (!s.run) return false;
  s.t = Math.min(9, s.t + Math.min(dt, .05) * 1.5); s.v = 10 * Math.sqrt(s.t); s.x = 20 / 3 * Math.pow(s.t, 1.5);
  [[10, 1, 1], [20, 4, 3], [30, 9, 5]].forEach(([v, t, d], i) => { if (s.hit === i && s.t >= t) { s.hit = i + 1; $(`t${v}`).textContent = `${t} 秒`; $(`d${v}`).textContent = `${d} 秒`; } });
  if (s.t >= 9) { s.run = false; B.unlock('b2', '三段：1 秒、3 秒、5 秒。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  show(); return true;
};
c1.draw = function (g, w, h) {
  const px = 7, L = CAR_L * px * 1.2, cx = w * .4, y = 70;
  rollRoad(g, w, y, s.x, px); carAt(g, cx, y - L * .2, L, {});
  const bx = 14, bw = w - 28, by = y + 34;
  g.fillStyle = T.line; rr(g, bx, by, bw, 18, 4); g.fill();
  g.fillStyle = T.E; rr(g, bx, by, Math.max(2, bw * P * s.t / 450000), 18, 4); g.fill();
  for (const v of [10, 20, 30]) { const x = bx + bw * ke(v) / 450000; g.strokeStyle = T.ink2; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, by - 4); g.lineTo(x, by + 22); g.stroke(); txt(g, `${v}`, v === 30 ? x - 8 : x, by + 38, { c: T.ink3, size: 12, w: 700, a: 'center' }); }
  txt(g, '动能：每秒多 50000 焦', bx, by - 8, { c: T.E, size: 12, w: 700 });
  txt(g, '下面的数：车速每秒几米', bx + bw, by + 56, { c: T.ink3, size: 11.5, a: 'right' });
};
show();

// ---------------------------------------------------------------- 第 4 步
const VS = [5, 10, 25, 50];
let ok2 = false;
const s2 = ctl('s2', (v) => `${VS[v]} 米`, () => {
  const v = VS[s2.v], F = P / v;
  calc('calc2', [`1 秒里车走了 ${v} 米`, `这 1 秒做的功：推力 × ${v} = 50000 焦`, `推力 = 50000 ÷ ${v} = <b>${F} 牛</b>`]);
  if (v === 50 && !ok2) { ok2 = true; B.unlock('b4', '每秒 50 米时，推力只剩 1000 牛。'); }
});
s2.upd();

kidQuiz(31, KGEN[31]);
start();
