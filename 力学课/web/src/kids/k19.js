// 启 19 · 轮胎怎么推车：冰面起步找最快的一档 → 起名字“摩擦力”（有上限）→ 刹车也靠它 → 没有摩擦力起不了步
import { $, Fig, T, txt, start, kpis, ctl, seg, drawCar } from '../ui.js';
import { CAR_L, rollRoad, farrow, beats, kidGuesses, kidQuiz, kidChrome } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(19);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, text: '是地面。发动机只管让车轮转。轮胎往后蹬地，地面往前推车。' },
  g2: { right: 2, text: '冰面上每秒只能掉 1，干路能掉 8。同样的车速，停下来要 8 倍的时间，也要 8 倍的距离。' },
  g3: { right: 1, text: '轮胎蹬不住地，地面也就推不了车。车轮空转，车不动。' },
  g4: { right: 1, text: '脚往后蹬地，地面不让脚往后滑，就往前推脚。人是被地面推着走的。' },
});
const M = 1000, ROADS = { 8000: '干路', 4000: '湿路', 1000: '冰面' }, DUR = 4;
const one = (x) => (Math.round(x * 10) / 10).toString();

const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .6 : .26), maxH: 215, minH: 200 });
const s = { t: 0, v: 0, off: 0, spin: 0, run: false, kick: 4000, grip: 1000, slip: false };
let best = false;
const force = () => (s.kick <= s.grip ? s.kick : s.grip * .6);          // 打滑以后，地面推车的力比上限还小（不写具体数）
const tip = () => { $('cap1').textContent = `${ROADS[rd.v]}最多能抓 ${rd.v} 牛。现在轮胎往后蹬 ${kick.v} 牛。`; kpis('k1', [['轮胎往后蹬', `${kick.v}`, '牛', 'F'], ['地面往前推', '？', '牛', 'F'], ['速度每秒涨', '？', '', 'a']]); };
const reset = () => { Object.assign(s, { t: 0, v: 0, run: false, kick: kick.v, grip: +rd.v, slip: false }); tip(); c1.dirty = true; };
const rd = seg('road1', () => reset()), kick = ctl('s1', (v) => `${v} 牛`, () => reset());
$('go1').addEventListener('click', () => {
  Object.assign(s, { t: 0, v: 0, run: true, kick: kick.v, grip: +rd.v }); s.slip = s.kick > s.grip;
  kpis('k1', [['轮胎往后蹬', `${s.kick}`, '牛', 'F'], ['地面往前推', s.slip ? '很小' : `${s.kick}`, s.slip ? '' : '牛', 'F'], ['速度每秒涨', s.slip ? '不到 1' : `${s.kick / M}`, '', 'a']]);
});
c1.step = (dt) => {
  if (!s.run) return false;
  const t1 = Math.min(DUR, s.t + dt), a = force() / M;
  s.v += a * (t1 - s.t); s.off += s.v * (t1 - s.t); s.spin += (s.slip ? 26 : s.v * .5 + 1) * (t1 - s.t); s.t = t1;
  if (s.t >= DUR) {
    s.run = false; const name = ROADS[s.grip];
    if (s.slip) $('cap1').textContent = `打滑了！${name}最多抓 ${s.grip} 牛，蹬 ${s.kick} 牛太大。车轮空转，车几乎不走。`;
    else if (s.grip === 1000) { $('cap1').textContent = '没打滑。蹬 1000 牛，地面就推 1000 牛，每秒涨 1。冰面上这就是最快的了。'; if (!best) { best = true; B.unlock('b2', '找到了。'); G.reveal('g1'); G.echo('g1', 'echo1'); } }
    else $('cap1').textContent = `没打滑。蹬 ${s.kick} 牛，地面就推 ${s.kick} 牛，每秒涨 ${one(s.kick / M)}。换成冰面再试。`;
  }
  return true;
};
c1.draw = function (g, w, h) {
  const L = Math.min(w * .4, 210), px = L / CAR_L, cx = w * .46, y = h - 84, kickN = s.run || s.t > 0 ? s.kick : kick.v, U = Math.min(26, w * .058);
  rollRoad(g, w, y, s.off, px); drawCar(g, cx, y, L, { wheel: s.spin });        // 车轮的辐条会转，看得出空转
  const wx = cx - 1.4 * px;
  farrow(g, wx - 3, y + 18, -1, 0, kickN / 1000 * U, ''); txt(g, `轮胎往后蹬地 ${kickN} 牛`, 12, y + 42, { c: T.F, size: 12.5, w: 700 });
  if (s.t > 0) {
    const f = force(); farrow(g, wx + 3, y + 18, 1, 0, Math.max(14, f / 1000 * U), '');
    txt(g, s.slip ? '地面推车：很小（打滑）' : `地面往前推车 ${f} 牛`, 12, y + 62, { c: T.F, size: 12.5, w: 700 });
  }
  txt(g, `车速：每秒 ${one(s.v)} 米`, w - 12, 20, { c: T.v, size: 13, w: 700, a: 'right' });
};
reset();

kidQuiz(19, KGEN[19]);
start();
