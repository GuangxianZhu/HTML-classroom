// 启 9 · 轻踩和重踩：三种踩法各踩 5 秒，看每秒涨多少 → 起名字“加速度” → 刹车是每秒掉多少 → 速度大不等于加速度大
import { $, Fig, T, txt, arrow, start, kpis } from '../ui.js';
import { CAR_L, rollRoad, gauge, carAt, vtGrid, vline, clamp, beats, kidGuesses, kidQuiz, kidChrome, dot } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(9);
const B = beats();
const G = kidGuesses({
  g1: { right: 0, later: true, text: '重踩的时候，速度每秒涨得多，线就陡。三条线都从 0 出发，陡的那条爬得高。' },
  g2: { right: 1, text: '速度一直是每秒 30 米，一点没变。每秒涨 0，加速度就是 0。开得快，说的是速度。' },
  g3: { right: 1, text: '速度是 0，可它马上就要涨。加速度看的是速度变不变，这一刻它正在变。' },
});
const one = (x) => (Math.round(x * 10) / 10).toString();

/** 点一种踩法，播 5 秒：上面速度表 + 路，下面速度-时间图，试过的线都留着 */
function accFig(n, { v0, v1, names, onAll }) {
  const f = new Fig(`c${n}`, { ratio: (w) => (w < 500 ? 1.05 : .62), maxH: 460, minH: 350 });
  const DUR = 5, box0 = $(`pick${n}`), btns = [...box0.querySelectorAll('button')];
  const tried = new Set();
  const s = { a: 0, t: 0, off: 0, run: false };
  const vAt = (a, t) => clamp(v0 + a * t, 0, 99);
  const show = () => {
    const v = vAt(s.a, s.t);
    kpis(`k${n}`, [['速度：每秒', one(v), '米', 'v'], ['速度表', `${Math.round(v * 3.6)}`, '千米每小时'], [s.a < 0 ? '每秒掉' : '每秒涨', s.a ? `${Math.abs(s.a)}` : '？', '', 'a']]);
  };
  btns.forEach((b) => b.addEventListener('click', () => {
    Object.assign(s, { a: +b.dataset.v, t: 0, off: 0, run: true });
    btns.forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
  f.step = (dt) => {
    if (!s.run) return false;
    const t1 = Math.min(DUR, s.t + dt);
    s.off += vAt(s.a, s.t) * (t1 - s.t); s.t = t1; show();
    if (s.t >= DUR) { s.run = false; tried.add(s.a); if (tried.size === btns.length) onAll?.(); }
    return true;
  };
  f.draw = function (g, w, h) {
    const v = vAt(s.a, s.t);
    gauge(g, 50, 46, 36, v * 3.6, 120);
    g.save(); g.beginPath(); g.rect(104, 0, w - 104, 100); g.clip();
    const px = 7, L = CAR_L * px * 1.2;
    rollRoad(g, w, 74, s.off, px);
    carAt(g, 104 + 20 + L / 2, 74 - L * .2, L, {});
    g.restore();
    const box = { x: 44, y: 130, w: w - 62, h: h - 130 - 44 };
    const { X, Y } = vtGrid(g, box, { t1: DUR, v1, vs: 5, note: '↑ 越往上越快（每秒几米）' });
    const pts = (a, t) => { const stop = a < 0 ? v0 / -a : 99, p = [{ t: 0, v: v0 }]; if (t > stop) p.push({ t: stop, v: 0 }); p.push({ t, v: vAt(a, t) }); return p; };
    for (const a of tried) if (a !== s.a) {
      vline(g, pts(a, DUR), X, Y, T.ink3, 3, .5);
      if (a < 0) txt(g, names[a], X(v0 / -a / 2) - 8, Y(v0 / 2) + 14, { c: T.ink3, size: 12, a: 'right' });
      else txt(g, names[a], X(DUR - .08), Y(vAt(a, DUR)) - 9, { c: T.ink3, size: 12, a: 'right' });
    }
    if (s.a) {
      vline(g, pts(s.a, s.t), X, Y, T.a, 3.5);
      const stop = s.a < 0 ? v0 / -s.a : DUR;
      for (let k = 1; k <= Math.floor(Math.min(s.t, stop) + 1e-9); k++) {
        const a0 = vAt(s.a, k - 1), a1 = vAt(s.a, k);
        g.strokeStyle = T.a; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X(k - 1), Y(a0)); g.lineTo(X(k), Y(a0)); g.stroke(); g.setLineDash([]);
        arrow(g, X(k), Y(a0), X(k), Y(a1), T.a, 2, 6);
        if (s.a < 0 || k < DUR) txt(g, `${s.a > 0 ? '涨' : '掉'} ${Math.abs(s.a)}`, s.a > 0 ? X(k) - 6 : X(k) + 5, s.a > 0 ? Y(a1) - 7 : (Y(a0) + Y(a1)) / 2 + 4, { c: T.a, size: 11.5, w: 700, a: s.a > 0 ? 'right' : 'left' });
      }
      for (let k = 0; k <= Math.floor(s.t + 1e-9); k++) dot(g, X(k), Y(vAt(s.a, k)), T.a, 4);
      if (s.t >= DUR) { if (s.a < 0) txt(g, names[s.a], X(stop / 2) - 8, Y(v0 / 2) + 14, { c: T.a, size: 12.5, w: 700, a: 'right' }); else txt(g, names[s.a], X(DUR) - 8, Y(vAt(s.a, DUR)) - 12, { c: T.a, size: 12.5, w: 700, a: 'right' }); }
    } else txt(g, '点下面的按钮开始', box.x + box.w / 2, box.y + box.h / 2, { c: T.ink3, size: 14, a: 'center' });
  };
  show();
}

accFig(1, { v0: 0, v1: 20, names: { 1: '轻轻踩', 2: '平常踩', 3: '重重踩' }, onAll: () => { B.unlock('b2', '三种都试过了。'); G.reveal('g1'); G.echo('g1', 'echo1'); } });
accFig(2, { v0: 20, v1: 25, names: { [-5]: '轻轻刹', [-10]: '急刹' }, onAll: () => B.unlock('b4', '两种都试过了。') });

kidQuiz(9, KGEN[9]);
start();
