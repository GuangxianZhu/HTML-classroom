// 启 34 · 一小步一小步算：1000 千克的车每秒 40 米松油门，风拖的力 = 车速 × 100 牛；一步 5 秒算出 40 → 20 → 10 → 5；一步 1 秒、0.1 秒，第 5 秒是 23.6、24.2
import { $, Fig, T, txt, start, calc } from '../ui.js';
import { vtGrid, vline, beats, kidGuesses, kidQuiz, kidChrome } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(34);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, wait: '记下了。先用笨办法算一遍。', text: '比每秒 20 米快。按一开始的 4000 牛算到底，才是 20。可风一路在变小，拖不了那么多。' },
  g2: { right: 1, text: '几乎不变。步子已经够小了，再切，答案只在小数点后面动一动。' },
  g3: { right: 1, text: '每一步只是几次乘除和一次减法，一点都不难，就是步数多。电脑一秒能算上亿步，不嫌烦。' },
});
/** 从每秒 40 米开始，一步 h 秒，算到 t1 秒；返回 {t, v} 一串 */
const run = (h, t1) => { const out = [{ t: 0, v: 40 }]; let v = 40; const n = Math.round(t1 / h); for (let i = 1; i <= n; i++) { v -= v * 100 / 1000 * h; out.push({ t: i * h, v }); } return out; };
const r1 = (x) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------- 第 2 步
let k1 = 0;
$('go1').addEventListener('click', () => {
  if (k1 >= 3) return;
  const v = 40 / 2 ** k1, F = v * 100, a = F / 1000, nv = v - a * 5; k1++;
  calc('calc1', [`第 ${k1} 步，开头的车速：每秒 ${v} 米`, `风拖的力 = ${v} × 100 = <b>${F} 牛</b>`, `每秒慢 ${F} ÷ 1000 = ${a} 米`, `5 秒慢 ${a} × 5 = ${a * 5} 米`, `这一步末的车速：${v} − ${a * 5} = <b>${nv}</b>`]);
  $(`v${k1}`).textContent = `${nv}`;
  if (k1 === 3) { $('go1').disabled = true; B.unlock('b2', '40、20、10、5。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
});

// ---------------------------------------------------------------- 第 4 步
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? .66 : .36), maxH: 300, minH: 230 });
const STEPS = [5, 1, 0.1], seen = new Set(); let cur = null;
const btn2 = [...$('pick2').querySelectorAll('button')];
btn2.forEach((b) => b.addEventListener('click', () => {
  btn2.forEach((x) => x.setAttribute('aria-pressed', x === b)); cur = +b.dataset.v; seen.add(cur); c2.dirty = true;
  $(`r${cur}`).textContent = `${r1(run(cur, 5).at(-1).v)}`;
  if (seen.size === 3) B.unlock('b4', '20、23.6、24.2，越来越稳。');
}));
c2.draw = function (g, w, h) {
  const box = { x: 34, y: 26, w: w - 60, h: h - 76 };
  const { X, Y } = vtGrid(g, box, { t1: 15, v1: 40, vs: 10, ts: 5, note: '↑ 车速，每秒几米' });
  for (const st of STEPS) if (seen.has(st)) {
    const pts = run(st, 15), on = st === cur;
    vline(g, pts, X, Y, on ? T.v : T.ink3, on ? 3 : 1.5, on ? 1 : .6);
    if (st >= 1) for (const p of pts) { g.beginPath(); g.arc(X(p.t), Y(p.v), on ? 3.5 : 2, 0, 6.3); g.fillStyle = on ? T.v : T.ink3; g.fill(); }
  }
  if (cur == null) { txt(g, '选一种步子', box.x + box.w / 2, box.y + box.h / 2, { c: T.ink3, size: 14, a: 'center' }); return; }
  const v5 = run(cur, 5).at(-1).v;
  g.strokeStyle = T.ink3; g.lineWidth = 1; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(X(5), box.y); g.lineTo(X(5), box.y + box.h); g.stroke(); g.setLineDash([]);
  txt(g, `第 5 秒：每秒 ${r1(v5)} 米`, X(5) + 8, Y(v5) - 10, { c: T.v, size: 13, w: 700 });
};

kidQuiz(34, KGEN[34]);
start();
