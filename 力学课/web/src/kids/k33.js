// 启 33 · 安全气囊：50 千克的人从每秒 10 米停下，用 5 / 1 / 0.1 / 0.01 秒，力是 100 / 500 / 5000 / 50000 牛 → 力 × 时间 = 动量变了多少 → 同一个气囊，车速越快力越大
import { $, Fig, T, txt, start, ctl, calc } from '../ui.js';
import { farrow, beats, kidGuesses, kidQuiz, kidChrome, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(33);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, wait: '记下了。四种停法都试试。', text: '差好几百倍。轻踩刹车是 100 牛，撞在硬东西上是 50000 牛。' },
  g2: { right: 1, text: '落地的速度没变，要拿走的动量也没变。屈膝让停下的时间变长，脚受的力就小了。' },
  g3: { right: 0, text: '毛巾软，鸡蛋陷进去才停，用的时间长了好多倍，力就小了好多倍。动量照样变成 0。' },
});
const WAYS = [   // 名字、真的用了几秒、力、屏幕上演几秒、屏幕上滑过画面宽度的几分之几、拦住他的东西
  { n: '轻踩刹车', t: 5, F: 100, show: 2.4, d: .46, by: '安全带轻轻拉着' },
  { n: '急刹车', t: 1, F: 500, show: 1.5, d: .3, by: '安全带勒紧了' },
  { n: '有气囊', t: .1, F: 5000, show: .7, d: .1, by: '脸陷进气囊里' },
  { n: '硬东西', t: .01, F: 50000, show: .14, d: .012, by: '撞在方向盘上' },
];
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .5 : .24), maxH: 200, minH: 170 });
const s = { k: -1, u: 0, run: false, done: new Set() };
const btn1 = [...$('pick1').querySelectorAll('button')];
btn1.forEach((b) => b.addEventListener('click', () => { btn1.forEach((x) => x.setAttribute('aria-pressed', x === b)); Object.assign(s, { k: +b.dataset.v, u: -.5, run: true }); }));
c1.step = (dt) => {
  if (!s.run) return false;
  const W = WAYS[s.k];
  s.u += Math.min(dt, .05) / (s.u < 0 ? 1 : W.show);   // u < 0：还没开始停，匀速滑过来
  if (s.u >= 1) {
    s.u = 1; s.run = false; s.done.add(s.k); $(`f${s.k}`).textContent = `${W.F}`;
    $('cap1').textContent = W.F < 500 ? '100 牛，只有他重力的五分之一。' : W.F === 500 ? '500 牛，和他自己的重力一样大。' : `${W.F} 牛，是他重力的 ${W.F / 500} 倍。`;
    if (s.done.size === 4) { B.unlock('b2', '100、500、5000、50000 牛。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  }
  return true;
};
c1.draw = function (g, w, h) {
  const y = h - 46, x0 = w * .3;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  if (s.k < 0) { txt(g, '选一种停法', w / 2, 30, { c: T.ink3, size: 14, a: 'center' }); man(g, x0, y); return; }
  const W = WAYS[s.k], D = W.d * w, u = Math.max(0, s.u), x = s.u < 0 ? x0 + s.u * 2 * w * .12 : x0 + D * (2 * u - u * u), stop = x0 + D;
  // 开始停和停住的两条线
  g.strokeStyle = T.ink3; g.lineWidth = 1; g.setLineDash([3, 4]); for (const xx of [x0, stop]) { g.beginPath(); g.moveTo(xx, y - 70); g.lineTo(xx, y + 6); g.stroke(); } g.setLineDash([]);
  txt(g, '开始停', x0, y + 20, { c: T.ink3, size: 11.5, a: D < 46 ? 'right' : 'center' }); txt(g, '停住', stop, y + 20, { c: T.ink3, size: 11.5, a: D < 46 ? 'left' : 'center' });
  man(g, x, y);
  if (s.u >= 0 && s.u < 1) { const len = 16 + 22 * Math.log10(W.F / 100); farrow(g, x + 14 + len, y - 38, -1, 0, len, ''); txt(g, `${W.F} 牛`, x + 20 + len, y - 34, { c: T.F, size: 13, w: 700 }); }
  txt(g, s.u < 0 ? '每秒 10 米' : s.u < 1 ? W.by : `${W.n}：${W.t} 秒停住，${W.F} 牛`, w / 2, 24, { c: s.u < 1 ? T.ink2 : T.v, size: 13.5, w: 700, a: 'center' });
  txt(g, W.t > 1 ? '动画放快了' : W.t < 1 ? '动画放慢了很多' : '', w - 8, h - 8, { c: T.ink3, size: 11.5, a: 'right' });
};
function man(g, x, y) {   // 坐着的人：头、身子、腿
  g.fillStyle = T.ink2; g.beginPath(); g.arc(x, y - 52, 9, 0, 6.3); g.fill();
  rr(g, x - 8, y - 42, 16, 26, 5); g.fill(); rr(g, x - 8, y - 20, 24, 9, 4); g.fill(); rr(g, x + 9, y - 20, 8, 20, 3); g.fill();
}

// ---------------------------------------------------------------- 第 4 步
const VS = [5, 10, 20, 30];
let ok2 = false;
const s2 = ctl('s2', (v) => `${VS[v]} 米`, () => {
  const v = VS[s2.v], p = 50 * v, F = p * 10;
  calc('calc2', [`要拿走的动量：50 × ${v} = <b>${p}</b>`, `力 × 0.1 = ${p}`, `力 = <b>${F} 牛</b>`, `是他自己重力的 <b>${F / 500} 倍</b>`]);
  if (v === 30 && !ok2) { ok2 = true; B.unlock('b4', '每秒 30 米，力是重力的 30 倍。'); }
});
s2.upd();

kidQuiz(33, KGEN[33]);
start();
