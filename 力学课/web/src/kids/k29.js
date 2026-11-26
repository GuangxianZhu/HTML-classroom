// 启 29 · 坡顶到坡底：三个一样高（20 米）的坡，到底都是每秒 20 米 → 重力做的功 = 重力 × 落下的高度 = 动能 → 高度 5 / 20 / 45 米对应每秒 10 / 20 / 30 米
import { $, Fig, T, txt, start, ctl, calc } from '../ui.js';
import { carAt, beats, kidGuesses, kidQuiz, kidChrome } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(29);
const B = beats();
const G = kidGuesses({
  g1: { right: 2, later: true, wait: '记下了。三个坡都滑一次看看。', text: '一样快，都是每秒 20 米。只是用的时间不一样。' },
  g2: { right: 0, text: '20 米，和坡陡不陡没关系。它带着 200000 焦的动能，正好够把自己送高 20 米。' },
  g3: { right: 1, text: '不能。它的劲是在第一个坡顶存下的。路上还有摩擦拿走一些，所以后面的坡只会越来越矮。' },
});
const H = 20, NAMES = ['陡坡', '缓坡', '弯坡'];
// 三条路：x 是横着走了多少米，返回高度（米）
const PATHS = [(x) => Math.max(0, H - x), (x) => Math.max(0, H - x / 3), (x) => (x >= 60 ? 0 : H * Math.pow(1 - x / 60, 3))], ENDX = [20, 60, 60];
// 先算好每条路：沿路每一小段用“落下多少就有多快”算时间
const RUN = PATHS.map((f, k) => {
  const pts = [[0, H, 0]]; let t = 0;
  const N = 600;
  for (let i = 1; i <= N; i++) {
    const x0 = ENDX[k] * (i - 1) / N, x1 = ENDX[k] * i / N, y0 = f(x0), y1 = f(x1), ds = Math.hypot(x1 - x0, y1 - y0);
    const va = Math.sqrt(20 * (H - y0)), vb = Math.sqrt(20 * (H - y1)); t += ds / Math.max(.4, (va + vb) / 2); pts.push([x1, y1, t]);
  }
  return { pts, T: t };
});
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .62 : .34), maxH: 300, minH: 220 });
const s = { k: -1, t: 0, run: false, done: new Set() };
const btn1 = [...$('pick1').querySelectorAll('button')];
btn1.forEach((b) => b.addEventListener('click', () => { Object.assign(s, { k: +b.dataset.v, t: 0, run: true }); btn1.forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
c1.step = (dt) => {
  if (!s.run) return false;
  s.t += dt * 1.5;
  if (s.t >= RUN[s.k].T) {
    s.t = RUN[s.k].T; s.run = false; s.done.add(s.k); $(`v${s.k}`).textContent = '每秒 20 米'; $(`t${s.k}`).textContent = `${Math.round(RUN[s.k].T * 10) / 10}`;
    if (s.done.size === 3) { B.unlock('b2', '三个坡，到底都是每秒 20 米。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  }
  return true;
};
c1.draw = function (g, w, h) {
  const k = Math.min((w - 60) / 66, (h - 70) / H), x0 = 30, yb = h - 30, X = (x) => x0 + x * k, Y = (y) => yb - y * k;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, yb); g.lineTo(w, yb); g.stroke();
  g.setLineDash([3, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(X(0), Y(H)); g.lineTo(X(62), Y(H)); g.stroke(); g.setLineDash([]);
  txt(g, '20 米高', X(62) + 4, Y(H) + 4, { c: T.ink3, size: 11.5 });
  PATHS.forEach((f, i) => {
    g.strokeStyle = i === s.k ? T.ink : T.ink3; g.lineWidth = i === s.k ? 3 : 1.5; g.globalAlpha = i === s.k || s.k < 0 ? 1 : .5; g.beginPath();
    for (let x = 0; x <= ENDX[i]; x += .5) g.lineTo(X(x), Y(f(x)));
    g.stroke(); g.globalAlpha = 1;
  });
  txt(g, '陡坡', X(1), Y(3), { c: T.ink3, size: 11.5 }); txt(g, '缓坡', X(34), Y(12), { c: T.ink3, size: 11.5 }); txt(g, '弯坡', X(24), Y(1.5), { c: T.ink3, size: 11.5 });
  if (s.k < 0) { txt(g, '点一个坡开始', w / 2, 22, { c: T.ink3, size: 14, a: 'center' }); return; }
  const P = RUN[s.k].pts; let i = 1; while (i < P.length - 1 && P[i][2] < s.t) i++;
  const [x, y] = P[i], [xp, yp] = P[i - 1], ang = Math.atan2(-(y - yp) * k, (x - xp) * k), v = Math.sqrt(20 * (H - y));
  carAt(g, X(x) + Math.sin(ang) * -6, Y(y) - Math.cos(ang) * 6 - 2, 34, { rot: ang });
  txt(g, `${NAMES[s.k]}：每秒 ${Math.round(v)} 米，${(Math.round(s.t * 10) / 10).toFixed(1)} 秒`, w - 10, 22, { c: T.v, size: 13, w: 700, a: 'right' });
};

// ---------------------------------------------------------------- 第 4 步
const HS = [5, 20, 45];
let ok2 = false;
const hs = ctl('s2', (v) => `${HS[v]} 米`, () => {
  const hh = HS[hs.v], W = 10000 * hh, v = Math.sqrt(2 * W / 1000);
  calc('calc2', [`重力做的功 = 10000 × ${hh} = <b>${W} 焦</b>`, `动能是 ${W} 焦的时候，车速是每秒 <b>${v} 米</b>`, `验算：1000 × ${v} × ${v} ÷ 2 = ${W}`]);
  if (hh === 45 && !ok2) { ok2 = true; B.unlock('b4', '45 米高，到底是每秒 30 米。'); }
});
hs.upd();

kidQuiz(29, KGEN[29]);
start();
