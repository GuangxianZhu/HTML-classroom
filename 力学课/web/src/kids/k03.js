// 启 3 · 走了多远：开一趟，轮子滚过的（路程）和离出发点挪了多少（位移）是两个数
import { $, Fig, T, txt, arrow, start, kpis } from '../ui.js';
import { Driver, segTrip, road, carPx, carAt, place, beats, kidGuesses, kidQuiz, kidChrome } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(3);
const B = beats();
const G = kidGuesses({
  g1: { right: 2, later: true, text: '轮子一共滚了 50 米。可是车只从家门口挪到了东 30 米。两个数说的不是一回事。' },
  g2: { right: 1, text: '车来回都在烧油，轮子滚了多少就收多少。位移是 0，路程可不是 0。' },
});
const R0 = -25, R1 = 65;
const pathOf = (S) => { let p = 0; for (let i = 1; i < S.length; i++) p += Math.abs(S[i].x - S[i - 1].x); return p; };
const disp = (d) => { const r = Math.round(d); return r === 0 ? '0' : r > 0 ? `往东 ${r} 米` : `往西 ${-r} 米`; };

/** 一张“开一趟”的图：走过的路画成来回折的线，位移画成箭头 */
function tripFig(id, kid, d) {
  const f = new Fig(id, { ratio: .3, maxH: 220, minH: 190 });
  d.bind(f.c, f);
  const show = () => { const p = pathOf(d.samples); kpis(kid, [['轮子滚了', `${Math.round(p)}`, '米'], ['离出发的地方', disp(d.x - d.x0), '', 'x'], ['过了', `${Math.floor(d.t)}`, '秒']]); return p; };
  f.step = (dt) => { const m = d.step(dt); if (m) show(); return m; };
  f.draw = function (g, w, h) {
    const y = h - 34, R = road(g, w, y, R0, R1), L = carPx(R.px);
    this.toX = R.toX; this.hit = () => true;
    // 走过的路：每掉一次头，线往上挪一层，来回的两段就不会叠在一起
    const S = d.samples; let lvl = 0, dir = 0, yy = y - 62;
    g.strokeStyle = T.ink2; g.lineWidth = 3; g.lineJoin = 'round'; g.beginPath();
    S.forEach((s, i) => {
      if (i) { const dd = Math.sign(s.x - S[i - 1].x); if (dd && dir && dd !== dir) { lvl++; yy = y - 62 - lvl * 9; } if (dd) dir = dd; g.lineTo(R.sx(s.x), yy); } else g.moveTo(R.sx(s.x), yy);
    });
    g.stroke();
    if (S.length > 1 && Math.abs(d.x - d.x0) > 1) arrow(g, R.sx(d.x0), y - 46, R.sx(d.x), y - 46, T.x, 3.5, 10);
    carAt(g, R.sx(d.x), y - L * .2, L, {});
    txt(g, '灰线：轮子滚过的路　蓝箭头：从出发点挪到了哪', 8, 16, { c: T.ink3, size: 12 });
  };
  show();
  return { f, show };
}

// ---------------------------------------------------------------- 第 2 步
const d1 = new Driver({ dur: 8, min: -20, max: 60, onDone: (d) => {
  const p = pathOf(d.samples), diff = p - Math.abs(d.x - d.x0);
  if (diff >= 8) { $('hint1').textContent = `不一样了！轮子滚了 ${Math.round(p)} 米，车只挪了 ${Math.round(Math.abs(d.x - d.x0))} 米。`; B.unlock('b2', '做到了。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  else $('hint1').textContent = '两个数还一样。提示：往东开一段，再倒回来一点。';
} });
const t1 = tripFig('c1', 'k1', d1);
$('demo1').addEventListener('click', () => d1.start(segTrip([[4, 10], [1, 0], [2, -5], [1, 0]])));
$('again1').addEventListener('click', () => { d1.reset(); t1.show(); $('hint1').textContent = '按住车开始。'; t1.f.dirty = true; });

// ---------------------------------------------------------------- 第 4 步：路程 60 米以上，位移 0
const d2 = new Driver({ dur: 10, min: -20, max: 60, onDone: (d) => {
  const p = pathOf(d.samples), back = Math.abs(d.x - d.x0);
  if (p >= 60 && back <= 3) { $('hint2').textContent = `做到了！轮子滚了 ${Math.round(p)} 米，车回到了出发的地方，位移是 0。`; B.unlock('b4', '做到了。'); }
  else if (back > 3) $('hint2').textContent = `车停在${place(d.x)}，没回到家门口。位移是 0，头和尾要在同一个地方。`;
  else $('hint2').textContent = `回到家了，可轮子只滚了 ${Math.round(p)} 米。开远一点再回来。`;
} });
const t2 = tripFig('c2', 'k2', d2);
$('again2').addEventListener('click', () => { d2.reset(); t2.show(); $('hint2').textContent = '按住车开始。'; t2.f.dirty = true; });

kidQuiz(3, KGEN[3]);
start();
