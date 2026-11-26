// 启 25 · 弯道为什么限速：半径 100 米的弯用每秒 10 / 20 / 30 米过 → 车速翻倍要 4 倍的力 → 半径 50 米要 2 倍 → 雨天限速
import { $, Fig, T, txt, start, kpis, ctl, seg } from '../ui.js';
import { carTop, farrow, beats, kidGuesses, kidQuiz, kidChrome } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(25);
const B = beats();
const G = kidGuesses({
  g1: { right: 2, later: true, text: '是 4 倍。每秒 10 米要 1000 牛，每秒 20 米要 4000 牛。' },
  g2: { right: 1, text: '每秒 20 米正好要 4000 牛。能抓的力少一半，车速不用减一半，因为车速要乘两次。' },
  g3: { right: 1, text: '转椅上也是在拐弯。速度是 2 倍，拐弯要的力是 4 倍。' },
});
const M = 1000, ROADS = { 8000: '干路', 4000: '湿路', 1000: '冰面' };
const need = (v, r) => M * v * v / r;

/** 一个半圆形弯道（从上往下看）。o = { n, radius, grip()，speed()，onRun(v, ok) } */
function bend(o) {
  const f = new Fig(`c${o.n}`, { ratio: (w) => (w < 500 ? .78 : .4), maxH: 330, minH: 270 });
  const s = { u: 0, run: false, out: false, v: 0, grip: 0, d: 0 };            // u：沿弯道走了多少（0～1）；out：冲出去了
  const show = () => {
    const v = s.run || s.u > 0 ? s.v : o.speed(), gp = s.run || s.u > 0 ? s.grip : o.grip();
    kpis(`k${o.n}`, [['拐弯要的力', `${need(v, o.radius)}`, '牛', 'F'], ['轮胎最多能抓', `${gp}`, '牛', 'F'], ['弯的半径', `${o.radius}`, '米']]);
  };
  const reset = () => { Object.assign(s, { u: 0, run: false, out: false, d: 0 }); show(); f.dirty = true; };
  $(`go${o.n}`).addEventListener('click', () => { Object.assign(s, { u: 0, run: true, out: false, d: 0, v: o.speed(), grip: o.grip() }); show(); });
  f.step = (dt) => {
    if (!s.run) return false;
    const fail = need(s.v, o.radius) > s.grip, rate = .16 + s.v / 60;
    if (s.out) { s.d += dt * rate * 3; if (s.d > 1.3) { s.run = false; o.onRun(s.v, false, s.grip); } return true; }
    s.u += dt * rate;
    if (fail && s.u >= .3) { s.out = true; return true; }
    if (s.u >= 1) { s.u = 1; s.run = false; o.onRun(s.v, true, s.grip); }
    return true;
  };
  f.draw = function (g, w, h) {
    const R = Math.min(w * .3, h - 90) * (o.radius === 50 ? .7 : 1), cx = w / 2, cy = h - 34, tw = 30;
    g.strokeStyle = T.road; g.globalAlpha = .3; g.lineWidth = tw; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(cx - R, cy + 30); g.lineTo(cx - R, cy); g.arc(cx, cy, R, Math.PI, 0); g.lineTo(cx + R, cy + 30); g.stroke(); g.globalAlpha = 1;
    g.fillStyle = T.ink3; g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill();
    g.strokeStyle = T.ink3; g.setLineDash([3, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * .7, cy - R * .7); g.stroke(); g.setLineDash([]);
    txt(g, `半径 ${o.radius} 米`, cx + R * .3, cy - R * .3 + 16, { c: T.ink3, size: 11.5 });
    const a = Math.PI + Math.min(s.u, 1) * Math.PI, px = cx + Math.cos(a) * R, py = cy + Math.sin(a) * R, tx = -Math.sin(a), ty = Math.cos(a);
    const x = px + tx * s.d * R, y = py + ty * s.d * R, L = Math.max(30, R * .3), v = s.run || s.u > 0 ? s.v : o.speed(), gp = s.run || s.u > 0 ? s.grip : o.grip();
    if (s.out) { g.strokeStyle = T.F; g.setLineDash([5, 5]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke(); g.setLineDash([]); }
    carTop(g, x, y, L, Math.atan2(ty, tx));
    if (!s.out) farrow(g, x - Math.cos(a) * 12, y - Math.sin(a) * 12, -Math.cos(a), -Math.sin(a), Math.max(10, Math.min(need(v, o.radius), gp) / 9000 * R * .8), '');
    txt(g, s.out ? '抓不住了，冲出弯道' : `每秒 ${v} 米`, 10, 20, { c: s.out ? T.F : T.v, size: 13, w: 700 });
  };
  show();
  return { reset };
}

// ---------------------------------------------------------------- 第 2 步
const done1 = new Set();
const rd = seg('road1', () => f1.reset()), v1 = ctl('s1', (v) => `${v} 米`, () => f1.reset());
const f1 = bend({ n: 1, radius: 100, grip: () => +rd.v, speed: () => v1.v, onRun(v, ok, grip) {
  done1.add(v); $(`n${v}`).textContent = `${need(v, 100)}`;
  $('cap1').textContent = ok ? `过去了。要 ${need(v, 100)} 牛，${ROADS[grip]}抓得住。` : `冲出去了！要 ${need(v, 100)} 牛，${ROADS[grip]}最多只能抓 ${grip} 牛。`;
  if (done1.size === 3) { B.unlock('b2', '三种车速：1000、4000、9000 牛。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
} });

// ---------------------------------------------------------------- 第 4 步：半径 50 米
let ok2 = false;
const v2 = ctl('s2', (v) => `${v} 米`, () => f2.reset());
const f2 = bend({ n: 2, radius: 50, grip: () => 8000, speed: () => v2.v, onRun(v, ok) {
  const n = need(v, 50);
  if (!ok) $('cap2').textContent = `冲出去了！要 ${n} 牛，干路最多只能抓 8000 牛。`;
  else if (v === 20) { $('cap2').textContent = '过去了，正好 8000 牛。这就是最快的了。半径 100 米的弯，同样的车速只要 4000 牛。'; if (!ok2) { ok2 = true; B.unlock('b4', '找到了：每秒 20 米。'); } }
  else $('cap2').textContent = `过去了，只要 ${n} 牛。还能再快一点吗？`;
} });

kidQuiz(25, KGEN[25]);
start();
