// 启 22 · 电梯里的秤：上楼下楼各三段看秤 → 秤上的数是地板托你的力 → 往下每秒涨 10 时秤是 0 → 太空站、被按在座椅上
import { $, Fig, T, txt, start, ctl, calc } from '../ui.js';
import { farrow, beats, kidGuesses, kidQuiz, kidChrome, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(22);
const B = beats();
const G = kidGuesses({
  g1: { right: 0, later: true, wait: '记下了。按下面的“上楼”看。', text: '起步那一下，秤上是 600 牛，变大了。人的重力还是 500 牛，变的是秤托他的力。' },
  g2: { right: 1, text: '重力还在。太空站和里面的人一起往下掉。就像每秒涨 10 的电梯，地板不用托人。' },
  g3: { right: 1, text: '你要跟着车变快，得有往前的力。这个力是靠背给的。“被往后按”只是感觉。' },
});
const MASS = 50, W = 500;

/** 放大的人和秤：cx 是人中间，y 是秤面，N 是秤往上托的力 */
function stand(g, cx, y, N, U) {
  g.fillStyle = T.line; rr(g, cx - 46, y, 92, 14, 3); g.fill(); g.strokeStyle = T.ink2; g.lineWidth = 1.6; g.stroke();
  txt(g, `秤：${N} 牛`, cx, y + 34, { c: T.ink, size: 15, w: 700, a: 'center' });
  g.fillStyle = T.ink2; rr(g, cx - 15, y - 74, 30, 72, 7); g.fill(); g.beginPath(); g.arc(cx, y - 88, 13, 0, 7); g.fill();
  farrow(g, cx + 30, y - 6 - W * U, 0, 1, W * U, ''); txt(g, `重力 ${W} 牛`, cx + 39, y - 6 - W * U * .5, { c: T.F, size: 12.5, w: 700 });
  if (N > 0) { farrow(g, cx - 30, y - 6, 0, -1, Math.max(12, N * U), ''); txt(g, `秤往上托 ${N} 牛`, cx - 39, y - 6 - Math.max(12, N * U) * .6, { c: T.F, size: 12.5, w: 700, a: 'right' }); }
  else txt(g, '秤不托人了', cx - 30, y - 30, { c: T.F, size: 12.5, w: 700, a: 'right' });
}

// ---------------------------------------------------------------- 第 2 步：坐一趟
// 一趟 7 秒：2 秒起步（每秒涨 2）→ 3 秒稳稳走（每秒 4 米）→ 2 秒慢下来。一共走 20 米
const SEG = ['起步', '稳稳走', '快到了'];
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .86 : .4), maxH: 330, minH: 290 });
const s1 = { dir: 0, t: 0, run: false, pos: 0, done: new Set() };
const stage = (t) => (t < 2 ? 0 : t < 5 ? 1 : 2);
const moved = (t) => (t < 2 ? t * t : t < 5 ? 4 + 4 * (t - 2) : 16 + 4 * (t - 5) - (t - 5) * (t - 5));
const speed = (t) => (t < 2 ? 2 * t : t < 5 ? 4 : 4 - 2 * (t - 5));
const read = (dir, st) => W + dir * [100, 0, -100][st];
const go = (dir) => { if (s1.run || (dir > 0 && s1.pos > 0) || (dir < 0 && s1.pos === 0)) return; Object.assign(s1, { dir, t: 0, run: true }); };
$('up1').addEventListener('click', () => go(1)); $('dn1').addEventListener('click', () => go(-1));
const btns = () => { $('up1').disabled = s1.run || s1.pos > 0; $('dn1').disabled = s1.run || s1.pos === 0; };
c1.step = (dt) => {
  if (!s1.run) return false;
  const st0 = stage(s1.t); s1.t = Math.min(7, s1.t + dt * .8);
  $(`${s1.dir > 0 ? 'u' : 'd'}${st0}`).textContent = `${read(s1.dir, st0)} 牛`;
  if (s1.t >= 7) { s1.run = false; s1.pos = s1.dir > 0 ? 20 : 0; s1.done.add(s1.dir); if (s1.done.size === 2) { B.unlock('b2', '上下都坐过了。'); G.reveal('g1'); G.echo('g1', 'echo1'); } }
  btns(); return true;
};
c1.draw = function (g, w, h) {
  const top = 22, bot = h - 20, sw = Math.min(70, w * .16), sx = 16, ch = 46;
  const p = s1.run ? (s1.dir > 0 ? moved(s1.t) : 20 - moved(s1.t)) : s1.pos, cy = bot - ch - p / 20 * (bot - top - ch);
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.strokeRect(sx, top, sw, bot - top);
  g.fillStyle = T.road; g.globalAlpha = .12; g.fillRect(sx, top, sw, bot - top); g.globalAlpha = 1;
  g.fillStyle = T.panel; rr(g, sx + 5, cy, sw - 10, ch, 3); g.fill(); g.strokeStyle = T.ink2; g.lineWidth = 2; g.stroke();
  g.fillStyle = T.ink2; rr(g, sx + sw / 2 - 5, cy + 16, 10, 24, 3); g.fill(); g.beginPath(); g.arc(sx + sw / 2, cy + 11, 5, 0, 7); g.fill();
  g.strokeStyle = T.ink3; g.lineWidth = 1.5; g.beginPath(); g.moveTo(sx + sw / 2, top); g.lineTo(sx + sw / 2, cy); g.stroke();
  const st = stage(s1.t), N = s1.run ? read(s1.dir, st) : W, v = s1.run ? speed(s1.t) : 0;
  const how = !s1.run ? '停着' : `${s1.dir > 0 ? '往上' : '往下'}，${['越来越快', '速度不变', '越来越慢'][st]}`;
  const cx = sx + sw + (w - sx - sw) / 2;
  txt(g, how, cx, top + 6, { c: T.ink, size: 14, w: 700, a: 'center' });
  txt(g, `电梯的速度：每秒 ${Math.round(v * 10) / 10} 米`, cx, top + 26, { c: T.v, size: 12.5, w: 700, a: 'center' });
  stand(g, cx, bot - 44, N, Math.min(.2, (bot - top - 150) / 600));
};
btns();

// ---------------------------------------------------------------- 第 4 步：往下，越来越快
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? .74 : .34), maxH: 290, minH: 260 });
let ok2 = false;
const acc = ctl('s2', (v) => `${v}`, () => {
  const a = acc.v, net = MASS * a, N = W - net;
  calc('calc2', [`往下的合力 = 50 × ${a} = ${net} 牛`, `秤往上托 = 500 − ${net} = <b>${N} 牛</b>`]);
  $('cap2').textContent = N === 0 ? '秤上是 0。每秒涨 10，就是自己往下掉的快慢。人和电梯一起掉，秤不用托他。' : a === 0 ? '速度不变，秤上是 500 牛。' : `秤上只有 ${N} 牛。人觉得变轻了。`;
  if (N === 0 && !ok2) { ok2 = true; B.unlock('b4', '找到了。重力还是 500 牛，一点没少。'); }
  c2.dirty = true;
});
c2.draw = function (g, w, h) {
  txt(g, acc.v ? `电梯往下，速度每秒涨 ${acc.v}` : '电梯往下，速度不变', w / 2, 26, { c: T.ink, size: 14, w: 700, a: 'center' });
  stand(g, w / 2, h - 46, W - MASS * acc.v, Math.min(.2, (h - 170) / 600));
};
acc.upd();

kidQuiz(22, KGEN[22]);
start();
