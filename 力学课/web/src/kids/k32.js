// 启 32 · 撞在一起：甲车 1000 千克每秒 20 米撞停着的乙车（1000 / 3000 / 9000 千克），粘在一起每秒 10 / 5 / 2 米 → 起名字“动量” → 迎面撞：往东和往西的动量互相抵
import { $, Fig, T, txt, start, calc, drawCar } from '../ui.js';
import { beats, kidGuesses, kidQuiz, kidChrome } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(32);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, wait: '记下了。撞一次看看。', text: '每秒 10 米。原来一辆车在动，现在要带着两辆车走，速度剩一半。' },
  g2: { right: 1, text: '推之前都不动，动量是 0。小孩得到 40 × 2 = 80。爸爸也得到 80，方向相反：80 ÷ 80 = 每秒 1 米。' },
  g3: { right: 1, text: '火箭把燃气很快地往后喷。燃气得到往后的动量，火箭就得到一样大的、往前的动量。不需要空气。' },
});
const SIZE = { 1000: 34, 3000: 46, 9000: 62 };
/** 一场碰撞：甲从左往右，乙停着或者从右往左；撞上以后粘在一起。速度在这里带正负，页面上只说往东往西。 */
const zoom = (w) => Math.max(1, Math.min(1.7, w / 400));
function crash(id, { W, onEnd }) {
  const fig = new Fig(id, { ratio: (w) => (w < 500 ? .4 : .2), maxH: 170, minH: 140 });
  const s = { on: false, hit: false, after: 0, xa: 6, xb: 34, va: 20, vb: 0, mb: 1000 };
  fig.go = (o) => Object.assign(s, { on: true, hit: false, after: 0, xa: 6, va: 20 }, o);
  fig.step = (dt) => {
    if (!s.on) return false;
    dt = Math.min(dt, .05) * .5;
    const px = fig.w / W, gap = (SIZE[1000] + SIZE[s.mb]) / 2 * zoom(fig.w) / px;
    s.xa += s.va * dt; s.xb += s.vb * dt;
    if (!s.hit && s.xb - s.xa <= gap) { s.hit = true; const v = (1000 * s.va + s.mb * s.vb) / (1000 + s.mb); s.va = s.vb = v; s.xb = s.xa + gap; }
    if (s.hit) { s.after += dt; if (s.after > 1.1) { s.on = false; onEnd(s); } }
    return true;
  };
  fig.draw = function (g, w, h) {
    const px = w / W, y = h - 40;
    g.fillStyle = T.x; g.globalAlpha = .1; g.fillRect(0, y - 2, w, 12); g.globalAlpha = 1;
    g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    txt(g, '冰面，很滑', 8, y + 26, { c: T.ink3, size: 11.5 }); txt(g, '西 ←', 8, 18, { c: T.ink3, size: 11.5 }); txt(g, '→ 东', w - 8, 18, { c: T.ink3, size: 11.5, a: 'right' });
    const xa = s.xa * px, xb = s.xb * px, La = SIZE[1000] * zoom(w), Lb = SIZE[s.mb] * zoom(w);
    drawCar(g, xa, y, La, { color: T.ink2 }); drawCar(g, xb, y, Lb, { dir: s.vb < 0 || fig.face ? -1 : 1, color: T.p });
    txt(g, '甲', xa, y - La * .3 - 6, { c: T.ink2, size: 12.5, w: 700, a: 'center' }); txt(g, '乙', xb, y - Lb * .3 - 6, { c: T.p, size: 12.5, w: 700, a: 'center' });
    if (s.hit) { const v = Math.round(Math.abs(s.va)); txt(g, v === 0 ? '粘在一起，停在原地' : `粘在一起，往${s.va > 0 ? '东' : '西'}每秒 ${v} 米`, w / 2, 38, { c: T.v, size: 13.5, w: 700, a: 'center' }); }
  };
  return fig;
}

// ---------------------------------------------------------------- 第 2 步
const done1 = new Set();
const c1 = crash('c1', { W: 64, onEnd: (s) => {
  done1.add(s.mb); $(`u${s.mb}`).textContent = `${Math.round(s.va)} 米`;
  if (done1.size === 3) { B.unlock('b2', '10 米、5 米、2 米。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
} });
const btn1 = [...$('pick1').querySelectorAll('button')];
btn1.forEach((b) => b.addEventListener('click', () => { btn1.forEach((x) => x.setAttribute('aria-pressed', x === b)); c1.go({ mb: +b.dataset.v, xb: 30, vb: 0 }); }));

// ---------------------------------------------------------------- 第 4 步
const done2 = new Set();
const c2 = crash('c2', { W: 64, onEnd: (s) => {
  done2.add(s.u);
  const east = 20000, west = 1000 * s.u, left = Math.abs(east - west), dir = east > west ? '东' : '西';
  calc('calc2', [`往东的动量：1000 × 20 = <b>20000</b>`, `往西的动量：1000 × ${s.u} = <b>${west}</b>`,
    left === 0 ? '一样大，正好抵完，剩 0' : `抵掉以后，还剩往${dir}的 <b>${left}</b>`,
    left === 0 ? '两辆车粘在一起，<b>停在原地</b>' : `两车一共 2000 千克`, `${left} ÷ 2000 = 往${dir}每秒 <b>${left / 2000} 米</b>`]);
  if (done2.size === 3) B.unlock('b4', '往东 5 米、停住、往西 5 米。');
} });
c2.face = true;
const btn2 = [...$('pick2').querySelectorAll('button')];
btn2.forEach((b) => b.addEventListener('click', () => { btn2.forEach((x) => x.setAttribute('aria-pressed', x === b)); const u = +b.dataset.v; calc('calc2', ['看它们撞完往哪边走。']); c2.go({ mb: 1000, xb: 58, vb: -u, u }); }));

kidQuiz(32, KGEN[32]);
start();
