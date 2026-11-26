// 启 18 · 有多重：弹簧秤称 1 / 2 / 5 / 10 千克 → 起名字“重力”，每千克 10 牛 → 重力 ÷ 质量总是 10，所以掉得一样快 → 月球上质量不变
import { $, Fig, T, txt, start, ctl, calc } from '../ui.js';
import { farrow, beats, kidGuesses, kidQuiz, kidChrome, dot, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(18);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, wait: '记下了。用下面的弹簧秤称一称。', text: '质量是 10 倍，地球拉它的力也是 10 倍。那为什么不是大球先落地？往下看。' },
  g2: { right: 1, text: '人身上的“料”没有少，质量还是 120 千克。变的是拉他的力：1200 ÷ 6 = 200 牛。' },
  g3: { right: 1, text: '重力一直都在。地面往上托你的力正好也是 500 牛，合力是 0，所以你不动。' },
});

// ---------------------------------------------------------------- 第 2 步：弹簧秤
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .92 : .42), maxH: 340, minH: 300 });
const s1 = { m: 0, len: 0, done: new Set() };
const btn1 = [...$('pick1').querySelectorAll('button')];
btn1.forEach((b) => b.addEventListener('click', () => { s1.m = +b.dataset.v; btn1.forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
c1.step = (dt) => {
  const goal = s1.m * 10;
  if (Math.abs(goal - s1.len) < .3) {
    if (s1.m && !s1.done.has(s1.m)) { s1.done.add(s1.m); $(`w${s1.m}`).textContent = `${s1.m * 10}`; if (s1.done.size === 4) { B.unlock('b2', '四个都称过了：10、20、50、100 牛。'); G.reveal('g1'); G.echo('g1', 'echo1'); } }
    return false;
  }
  s1.len += (goal - s1.len) * Math.min(1, dt * 5); return true;
};
c1.draw = function (g, w, h) {
  const cx = w * .4, top = 18, st = (h - 150) / 100, y0 = top + 46, y1 = y0 + 20 + s1.len * st, S = s1.m ? 22 + Math.sqrt(s1.m) * 12 : 0;
  g.strokeStyle = T.ink3; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 60, top); g.lineTo(cx + 60, top); g.stroke();
  g.fillStyle = T.panel2 || T.line; rr(g, cx - 13, top, 26, 46, 4); g.fill(); g.strokeStyle = T.ink2; g.lineWidth = 1.6; g.stroke();
  g.beginPath(); g.moveTo(cx, y0); const n = 12; for (let i = 1; i <= n; i++) g.lineTo(cx + (i === n ? 0 : i % 2 ? -8 : 8), y0 + (y1 - y0) * i / n); g.stroke();
  txt(g, `${Math.round(s1.len)} 牛`, cx + 22, top + 30, { c: T.ink, size: 15, w: 700 });
  txt(g, '秤上的数', cx + 22, top + 12, { c: T.ink3, size: 12 });
  if (!s1.m) { txt(g, '点一个挂上去', cx, y1 + 40, { c: T.ink3, size: 14, a: 'center' }); return; }
  g.fillStyle = T.m; g.globalAlpha = .82; rr(g, cx - S / 2, y1, S, S, 4); g.fill(); g.globalAlpha = 1;
  txt(g, `${s1.m} 千克`, cx - S / 2 - 8, y1 + S / 2 + 4, { c: T.ink2, size: 12.5, w: 700, a: 'right' });
  const U = 12 + s1.len * .5, ax = cx + S / 2 + 26;
  farrow(g, ax, y1 + S / 2 - 3, 0, -1, U, ''); txt(g, `秤往上拉 ${Math.round(s1.len)} 牛`, ax + 9, y1 + S / 2 - U * .6, { c: T.F, size: 12.5, w: 700 });
  farrow(g, ax, y1 + S / 2 + 3, 0, 1, U, ''); txt(g, `地球往下拉 ${Math.round(s1.len)} 牛`, ax + 9, y1 + S / 2 + U * .6 + 8, { c: T.F, size: 12.5, w: 700 });
};

// ---------------------------------------------------------------- 第 4 步：两个球一起掉
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? .9 : .42), maxH: 340, minH: 290 });
const s2 = { t: 0, run: false, tried: new Set(), ok: false };
const show2 = () => calc('calc2', ['左边重力：1 × 10 = 10 牛', '每秒涨：10 ÷ 1 = <b>10</b>', `右边重力：${mm.v} × 10 = ${mm.v * 10} 牛`, `每秒涨：${mm.v * 10} ÷ ${mm.v} = <b>10</b>`]);
const mm = ctl('s2', (v) => `${v} 千克`, () => { if (!s2.run) s2.t = 0; show2(); c2.dirty = true; });
$('go2').addEventListener('click', () => { s2.t = 0; s2.run = true; });
c2.step = (dt) => {
  if (!s2.run) return false;
  s2.t = Math.min(2, s2.t + dt * .6);
  if (s2.t >= 2) { s2.run = false; s2.tried.add(mm.v); if (s2.tried.size >= 3 && !s2.ok) { s2.ok = true; B.unlock('b4', '每次都同时落地。'); } }
  return true;
};
c2.draw = function (g, w, h) {
  const top = 34, bot = h - 26, Y = (d) => top + d / 20 * (bot - top - 20), d = 5 * s2.t * s2.t;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(20, bot); g.lineTo(w - 20, bot); g.stroke();
  for (const [x, m] of [[w * .28, 1], [w * .64, mm.v]]) {
    const R = 7 + Math.sqrt(m) * 5, y = Math.min(Y(d), bot - R);
    g.beginPath(); g.arc(x, y, R, 0, 7); g.fillStyle = T.m; g.fill();
    txt(g, `${m} 千克`, x, top - 14, { c: T.ink2, size: 12.5, w: 700, a: 'center' });
    if (s2.t < 2) { farrow(g, x + R + 12, y, 0, 1, 10 + m * 6, ''); txt(g, `重力 ${m * 10} 牛`, x + R + 20, y + 4, { c: T.F, size: 12.5, w: 700 }); }
  }
  txt(g, s2.t >= 2 ? '同时落地' : `每秒 ${Math.round(10 * s2.t)} 米`, w - 24, bot - 8, { c: T.v, size: 13, w: 700, a: 'right' });
};
show2();

kidQuiz(18, KGEN[18]);
start();
