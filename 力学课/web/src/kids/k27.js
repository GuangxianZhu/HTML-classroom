// 启 27 · 推了多远：100 千克雪橇，选力和推多远，找 3 种推完都是每秒 4 米的推法 → 力 × 距离叫功（焦）→ 推不动是 0 → 斜坡省力不省功
import { $, Fig, T, txt, start, seg } from '../ui.js';
import { farrow, beats, kidGuesses, kidQuiz, kidChrome, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(27);
const B = beats();
const G = kidGuesses({
  g1: { right: 2, later: true, text: '一样快。100 × 8 和 400 × 2 都是 800。力和距离乘起来一样，结果就一样。' },
  g2: { right: 2, text: '墙没动，距离是 0，功就是 0。你累，是因为肌肉一直绷着在消耗。' },
  g3: { right: 1, text: '直接抬：500 × 1 = 500 焦。沿坡推：50 × 10 = 500 焦。一样多。' },
  g4: { right: 2, text: '手的力朝上，书包是横着走的。顺着力的方向一点没动，功是 0。提高那 1 米才做了 50 焦。' },
});
const M = 100;
const one = (x) => (Math.round(x * 10) / 10).toString();

const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .52 : .26), maxH: 215, minH: 185 });
const s = { t: 0, run: false, F: 100, d: 2, x: 0, v: 0 };
const ways = new Set(), log = [];
const fs = seg('f1', () => reset()), ds = seg('d1', () => reset());
function reset() { Object.assign(s, { t: 0, run: false, F: +fs.v, d: +ds.v, x: 0, v: 0 }); $('cap1').textContent = `用 ${fs.v} 牛推 ${ds.v} 米。`; c1.dirty = true; }
$('go1').addEventListener('click', () => { Object.assign(s, { t: 0, run: true, F: +fs.v, d: +ds.v, x: 0, v: 0 }); });
c1.step = (dt) => {
  if (!s.run) return false;
  const a = s.F / M, tp = Math.sqrt(2 * s.d / a), vEnd = a * tp;
  s.t += dt;
  if (s.t < tp) { s.x = a * s.t * s.t / 2; s.v = a * s.t; } else { s.x = s.d + vEnd * (s.t - tp); s.v = vEnd; }
  if (s.x >= 11.5) {
    s.run = false; const work = s.F * s.d, exact = Number.isInteger(vEnd), sp = `每秒${exact ? '' : '大约'} ${one(vEnd)} 米`;
    $('cap1').textContent = `${s.F} 牛推 ${s.d} 米，推完是${sp}。`;
    const line = `${s.F} 牛 × ${s.d} 米：${sp}`; if (!log.includes(line)) log.push(line);
    $('log1').textContent = `试过的：${log.slice(-5).join('；')}。`;
    if (work === 800) ways.add(`${s.F}-${s.d}`);
    if (ways.size >= 3) { B.unlock('b2', '3 种都找到了。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  }
  return true;
};
c1.draw = function (g, w, h) {
  const y = h - 54, px = (w - 70) / 12, X = (m) => 46 + m * px, pushing = s.run && s.x < s.d, d = s.run || s.x > 0 ? s.d : +ds.v, F = s.run || s.x > 0 ? s.F : +fs.v;
  g.fillStyle = T.x; g.globalAlpha = .1; g.fillRect(0, y, w, 10); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  for (let m = 0; m <= 12; m += 2) { g.lineWidth = 1.2; g.beginPath(); g.moveTo(X(m), y); g.lineTo(X(m), y + 6); g.stroke(); txt(g, `${m}`, X(m), y + 20, { c: T.ink3, size: 11, a: 'center' }); }
  txt(g, '米', X(12) + 10, y + 20, { c: T.ink3, size: 11 });
  g.fillStyle = T.F; g.globalAlpha = .18; g.fillRect(X(0), y + 26, X(d) - X(0), 8); g.globalAlpha = 1;
  txt(g, `手推这一段：${d} 米`, X(0), y + 48, { c: T.F, size: 12, w: 700 });
  const x = X(Math.min(s.x, 12.4));
  g.fillStyle = T.m; rr(g, x - 30, y - 24, 34, 20, 4); g.fill(); g.strokeStyle = T.ink2; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x - 34, y - 2); g.lineTo(x + 8, y - 2); g.stroke();
  if (pushing || !s.run && s.x === 0) { const U = 16 + F / 400 * Math.min(60, w * .14); farrow(g, x - 34 - U, y - 14, 1, 0, U, ''); txt(g, `${F} 牛`, x - 36 - U / 2, y - 26, { c: T.F, size: 12.5, w: 700, a: 'center' }); }
  txt(g, `速度：每秒 ${one(s.v)} 米`, w - 10, 20, { c: T.v, size: 13, w: 700, a: 'right' });
};
reset();

kidQuiz(27, KGEN[27]);
start();
