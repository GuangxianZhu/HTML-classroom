// 启 8 · 把速度表也拍成照片：踩油门 / 刹车，每秒记一个速度 → 起名字“速度-时间图” → 开出一段平线 → 同一趟车两张图（平线不是停着）
import { $, Fig, T, txt, start, kpis } from '../ui.js';
import { CAR_L, rollRoad, gauge, carAt, hold, vtGrid, vline, ptGrid, line, road, carPx, clamp, beats, kidGuesses, kidQuiz, kidChrome, dot } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(8);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, wait: '记下了。到第 4 步自己开出来看。', text: '5 张速度表都指着同一个数，点一样高，连起来是一条平线。' },
  g2: { right: 1, text: '这是速度图，高度是速度。一直在 10，就是一直每秒 10 米。停着的话，线要贴在最下面。' },
  g3: { right: 1, text: '速度图上往下，是速度变小，车越开越慢。往回开，是位置图上线往下。' },
});
const DUR = 10, UP = 3, DOWN = 6, VMAX = 30;
const one = (x) => (Math.round(x * 10) / 10).toString();

/** 踩踏板开 10 秒：上面速度表 + 路，下面速度-时间图 */
function pedalFig(n, { tip, onTick, onDone }) {
  const f = new Fig(`c${n}`, { ratio: (w) => (w < 500 ? 1.05 : .62), maxH: 460, minH: 350 });
  const gas = hold(`gas${n}`), brk = hold(`brk${n}`);
  const s = { v: 0, t: 0, off: 0, run: false, done: false, pts: [] };
  const show = () => kpis(`k${n}`, [['速度表', `${Math.round(s.v * 3.6)}`, '千米每小时', 'v'], ['也就是每秒', one(s.v), '米', 'v'], ['过了', `${Math.floor(s.t)}`, '秒']]);
  const reset = () => { Object.assign(s, { v: 0, t: 0, off: 0, run: false, done: false, pts: [] }); $(`hint${n}`).textContent = tip; show(); f.dirty = true; };
  $(`again${n}`).addEventListener('click', reset);
  f.step = (dt) => {
    if (!s.run && !s.done && gas.down) { s.run = true; s.pts = [{ t: 0, v: 0 }]; }
    if (!s.run) return false;
    const a = gas.down ? UP : brk.down ? -DOWN : 0, t1 = Math.min(DUR, s.t + dt);
    s.v = clamp(s.v + a * (t1 - s.t), 0, VMAX); s.off += s.v * (t1 - s.t); s.t = t1;
    s.pts.push({ t: s.t, v: s.v });
    show(); onTick?.(s);
    if (s.t >= DUR - 1e-9) { s.run = false; s.done = true; onDone?.(s); }
    return true;
  };
  f.draw = function (g, w, h) {
    gauge(g, 50, 46, 36, s.v * 3.6, 120);
    g.save(); g.beginPath(); g.rect(104, 0, w - 104, 100); g.clip();
    const px = 7, L = CAR_L * px * 1.2;
    rollRoad(g, w, 74, s.off, px);
    carAt(g, 104 + 20 + L / 2, 74 - L * .2, L, {});
    g.restore();
    const box = { x: 44, y: 130, w: w - 62, h: h - 130 - 44 };
    const { X, Y } = vtGrid(g, box, { t1: DUR, v1: VMAX, vs: 5, note: '↑ 越往上越快（每秒几米）' });
    vline(g, s.pts, X, Y, T.v, 3);
    for (let k = 0; k <= Math.floor(s.t + 1e-9) && s.pts.length; k++) { const p = s.pts.find((q) => q.t >= k - 1e-9); if (p) dot(g, X(k), Y(p.v), T.v, 4); }
    if (!s.pts.length) txt(g, '按住“油门”就开始', box.x + box.w / 2, box.y + box.h / 2, { c: T.ink3, size: 14, a: 'center' });
  };
  reset();
  return { f, s };
}

pedalFig(1, { tip: '按住“油门”，计时就开始。', onDone: () => { $('hint1').textContent = '10 秒到了。看看你的线：哪段往上，哪段平，哪段往下？'; B.unlock('b2', '开完了。'); } });

// ---------------------------------------------------------------- 第 4 步：开出一段平线
let flat0 = -1, okFlat = false;
pedalFig(2, {
  tip: '先踩油门到每秒 10 米以上，再松开保持 3 秒。',
  onTick: (s) => {
    const n = s.pts.length, moved = n > 1 && s.pts[n - 1].v !== s.pts[n - 2].v;
    if (s.pts.length <= 2) { flat0 = -1; }
    if (moved || s.v < 10) flat0 = -1; else if (flat0 < 0) flat0 = s.t;
    if (!okFlat && flat0 >= 0 && s.t - flat0 >= 3) {
      okFlat = true; B.unlock('b4', '做到了。');
      $('hint2').textContent = `做到了！线是平的，车可没停：它一直在每秒 ${one(s.v)} 米往前开。`;
      G.reveal('g1'); G.echo('g1', 'echo1');
    }
  },
  onDone: () => { if (!okFlat) $('hint2').textContent = '还没有 3 秒的平线。按“重来”，踩到 10 以上就松开。'; },
});

// ---------------------------------------------------------------- 第 5 步：同一趟车，两张图
const c3 = new Fig('c3', { ratio: (w) => (w < 560 ? 1.45 : .56), maxH: 560, minH: 330 });
let t3 = 0, play3 = false;
$('go3').addEventListener('click', () => { t3 = 0; play3 = true; });
c3.step = (dt) => { if (!play3) return false; t3 = Math.min(5, t3 + dt); if (t3 >= 5) { play3 = false; B.unlock('b5', '看完了。'); } return true; };
c3.draw = function (g, w, h) {
  const y = 62, R = road(g, w, y, -6, 62), L = carPx(R.px);
  carAt(g, R.sx(10 * t3), y - L * .2, L, {});
  const top = 116, narrow = w < 560;
  const b1 = narrow ? { x: 56, y: top, w: w - 74, h: (h - top - 44) / 2 - 36 } : { x: 56, y: top, w: w / 2 - 78, h: h - top - 44 };
  const b2 = narrow ? { x: 56, y: b1.y + b1.h + 72, w: w - 74, h: b1.h } : { x: w / 2 + 44, y: top, w: w / 2 - 62, h: h - top - 44 };
  const P = ptGrid(g, b1, { t1: 5, x0: 0, x1: 60, xs: 10 });
  const V = vtGrid(g, b2, { t1: 5, v1: 20, vs: 5, note: '↑ 越往上越快（每秒几米）' });
  line(g, [{ t: 0, x: 0 }, { t: t3, x: 10 * t3 }], P.X, P.Y, T.x, 3);
  vline(g, [{ t: 0, v: 10 }, { t: t3, v: 10 }], V.X, V.Y, T.v, 3);
  for (let k = 0; k <= Math.floor(t3); k++) { dot(g, P.X(k), P.Y(10 * k), T.x, 4); dot(g, V.X(k), V.Y(10), T.v, 4); }
  txt(g, '位置图：斜线', b1.x + b1.w - 4, b1.y + 16, { c: T.x, size: 12.5, w: 700, a: 'right' });
  txt(g, '速度图：平线', b2.x + b2.w - 4, b2.y + 16, { c: T.v, size: 12.5, w: 700, a: 'right' });
};

kidQuiz(8, KGEN[8]);
start();
