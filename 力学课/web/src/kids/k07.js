// 启 7 · 速度表上的 60：拨速度表看车一秒走几米 → 36 千米每小时 = 每秒 10 米 → 表上的数不是走了多远 → 反过来换
import { $, Fig, T, txt, arrow, start, kpis, ctl } from '../ui.js';
import { CAR_L, rollRoad, gauge, carAt, beats, kidGuesses, kidQuiz, kidChrome } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(7);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, text: '表上的数说的是“照这样开一小时，走多少千米”。60 就是一小时走 60 千米。' },
  g2: { right: 1, text: '一小时是 60 分钟，走 60 千米，正好一分钟 1 千米。10 分钟就是 10 千米。' },
  g3: { right: 0, text: '先换成同一种说法。表上的 36 是每秒 10 米，比每秒 15 米慢。' },
});
const one = (x) => (Math.round(x * 10) / 10).toString();

// ---------------------------------------------------------------- 第 2 步：拨速度表
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .95 : .5), maxH: 360, minH: 290 });
let off = 0, solved = false;
const s1 = ctl('s1', (v) => `${v}`, () => {
  const m = s1.v / 3.6;
  kpis('k1', [['表上指着', `${s1.v}`, '千米每小时', 'v'], ['一秒走', `${one(m)}`, '米', 'v'], ['差不多', `${one(m / 5)}`, '个车长']]);
  if (!solved && s1.v === 36) { solved = true; B.unlock('b2', '找到了：表上指着 36。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  c1.dirty = true;
});
c1.step = (dt) => { const m = s1.v / 3.6; off += m * dt; return m > 0; };
c1.draw = function (g, w, h) {
  const v = s1.v, m = v / 3.6;
  const R = Math.min(80, w * .21);
  gauge(g, w / 2, R + 12, R, v, 120);
  const y = h - 28, px = (w - 30) / 44, L = CAR_L * px, x0 = 14, xf = x0 + L;
  rollRoad(g, w, y, off, px);
  for (let k = 0; k < Math.round(m / 5); k++) carAt(g, xf + (k + .5) * 5 * px, y - L * .2, L * .95, { alpha: .2 });
  carAt(g, x0 + L / 2, y - L * .2, L, {});
  if (m > 0) {
    arrow(g, xf, y - 44, xf + m * px, y - 44, T.v, 3, 9);
    txt(g, `一秒走 ${one(m)} 米`, xf + 2, y - 54, { c: T.v, size: 13, w: 700 });
  } else txt(g, '车停着', xf + 8, y - 40, { c: T.ink3, size: 13 });
};
s1.upd();

// ---------------------------------------------------------------- 第 5 步：反过来
const WHO = [[2, '差不多是人走路。'], [4, '差不多是人跑步。'], [7, '差不多是骑自行车。'], [11, '差不多是短跑运动员冲刺。'], [17, '差不多是城里路上的车。'], [25, '差不多是郊外公路上的车。'], [99, '差不多是高速公路上的车。']];
const s2 = ctl('s2', (v) => `${v} 米`, () => {
  const m = s2.v;
  kpis('k2', [['每秒走', `${m}`, '米', 'v'], ['一小时走', `${m * 3600}`, '米'], ['表上的数', `${one(m * 3.6)}`, '千米每小时', 'v']]);
  $('cap2').textContent = `每秒 ${m} 米：${WHO.find(([lim]) => m < lim)[1]}`;
});
s2.upd();

kidQuiz(7, KGEN[7]);
start();
