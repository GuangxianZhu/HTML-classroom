// 启 21 · 拖车：冰上两个人互推（三种推法结果一样）→ 力总是成对的 → 一对力在两辆车上，不能互相抵掉 → 推墙、撞车
import { $, Fig, T, txt, start, ctl, calc, drawCar } from '../ui.js';
import { CAR_L, rollRoad, farrow, beats, kidGuesses, kidQuiz, kidChrome, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(21);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, text: '一样大。绳子拉后车多少牛，后车就往回拉前车多少牛。那前车怎么还能走？往下看。' },
  g2: { right: 1, text: '是墙。你推墙多大，墙就推你多大。墙连着大地，推不动；你在冰上，一推就走。' },
  g3: { right: 1, text: '一样大。可是小轿车质量小，同样的力，它的速度变得多得多，所以更惨。' },
});

// ---------------------------------------------------------------- 第 2 步：冰上互推
const F = 120, PUSH_T = 1, HOW = ['小孩推大人', '大人推小孩', '两个人一起推'];
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .62 : .3), maxH: 250, minH: 215 });
const s1 = { how: -1, t: 0, run: false, done: new Set() };
const btn1 = [...$('pick1').querySelectorAll('button')];
btn1.forEach((b) => b.addEventListener('click', () => { Object.assign(s1, { how: +b.dataset.v, t: 0, run: true }); btn1.forEach((x) => x.setAttribute('aria-pressed', x === b)); ['f0', 'f1', 'u0', 'u1'].forEach((id) => { $(id).textContent = '？'; }); $('cap1').textContent = ''; }));
const dist = (a, t) => (t < PUSH_T ? a * t * t / 2 : a * PUSH_T * PUSH_T / 2 + a * PUSH_T * (t - PUSH_T));   // 推 1 秒，然后一直滑
c1.step = (dt) => {
  if (!s1.run) return false;
  s1.t = Math.min(3, s1.t + dt * .8);
  if (s1.t >= PUSH_T && $('f0').textContent === '？') { $('f0').textContent = `${F} 牛，往左`; $('f1').textContent = `${F} 牛，往右`; }
  if (s1.t >= 3) {
    s1.run = false; s1.done.add(s1.how); $('u0').textContent = '往左，每秒 4 米'; $('u1').textContent = '往右，每秒 2 米';
    $('cap1').textContent = `${HOW[s1.how]}：两个人受到的力都是 ${F} 牛。${s1.done.size > 1 ? '和上一次一模一样。' : ''}`;
    if (s1.done.size === 3) { B.unlock('b2', '三种推法，结果一模一样。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  }
  return true;
};
/** 一个穿冰鞋的人：x 是身体中间，y 是冰面，k 是个头（1 是大人） */
function person(g, x, y, k, name) {
  const H = 92 * k, bw = 26 * k;
  g.fillStyle = T.ink2; rr(g, x - bw / 2, y - H * .72 - 6, bw, H * .72, 6); g.fill();
  g.beginPath(); g.arc(x, y - H * .72 - 6 - 13 * k, 12 * k, 0, 7); g.fill();
  g.strokeStyle = T.ink3; g.lineWidth = 3; g.beginPath(); g.moveTo(x - bw * .7, y - 3); g.lineTo(x + bw * .7, y - 3); g.stroke();
  txt(g, name, x, y + 20, { c: T.ink2, size: 12.5, w: 700, a: 'center' });
  return y - H * .5;
}
c1.draw = function (g, w, h) {
  const y = h - 44, mid = w * .52, px = Math.min(22, (w - 60) / 16), t = s1.how < 0 ? 0 : s1.t;
  g.fillStyle = T.x; g.globalAlpha = .1; g.fillRect(0, y, w, 10); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  const xk = mid - 16 - dist(4, t) * px, xa = mid + 20 + dist(2, t) * px;
  const yk = person(g, xk, y, .72, '小孩 30 千克'), ya = person(g, xa, y, 1, '大人 60 千克');
  if (s1.how >= 0 && t < PUSH_T + .5) {
    const U = Math.min(54, w * .13);
    farrow(g, xk - 12, yk - 6, -1, 0, U, ''); txt(g, `${F} 牛`, xk - 16, yk - 16, { c: T.F, size: 12.5, w: 700, a: 'right' });
    farrow(g, xa + 16, ya - 10, 1, 0, U, ''); txt(g, `${F} 牛`, xa + 20, ya - 20, { c: T.F, size: 12.5, w: 700 });
  }
  if (s1.how < 0) txt(g, '点一种推法', w / 2, 26, { c: T.ink3, size: 14, a: 'center' });
};

// ---------------------------------------------------------------- 第 4 步：拖车
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? .56 : .26), maxH: 215, minH: 195 });
const s2 = { off: 0, v: 0, ok: false };
const push = ctl('s2', (v) => `${v} 牛`, () => {
  const P = push.v, a = P / 2000, R = 1000 * a;
  calc('calc2', [`两辆车一起 2000 千克：${P} ÷ 2000 = 每秒涨 <b>${a}</b>`, `后车：绳子往前拉 1000 × ${a} = <b>${R} 牛</b>`, `前车：绳子往后拉，也是 <b>${R} 牛</b>`, `前车的合力：${P} − ${R} = ${P - R} 牛，每秒涨 <b>${a}</b>`]);
  if (a === 2 && !s2.ok) { s2.ok = true; B.unlock('b4', '做到了：地面推 4000 牛，绳子两头都是 2000 牛。'); }
  s2.v = 0; c2.dirty = true;
});
c2.step = (dt) => { s2.v = Math.min(30, s2.v + push.v / 2000 * dt); s2.off += s2.v * dt; return true; };
c2.draw = function (g, w, h) {
  const L = Math.min(w * .27, 150), px = L / CAR_L, y = h - 92, xf = w * .68, xr = w * .26, P = push.v, R = P / 2, U = Math.min(15, w * .034);
  rollRoad(g, w, y, s2.off, px);
  drawCar(g, xr, y, L, { wheel: s2.off * .5 }); drawCar(g, xf, y, L, { wheel: s2.off * .5 });
  g.strokeStyle = T.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(xr + L / 2, y - L * .14); g.lineTo(xf - L / 2, y - L * .14); g.stroke();
  txt(g, '后车', xr, y - L * .36, { c: T.ink3, size: 12, a: 'center' }); txt(g, '前车', xf, y - L * .36, { c: T.ink3, size: 12, a: 'center' });
  farrow(g, xr + L / 2 + 3, y - L * .14, 1, 0, R / 1000 * U, ''); farrow(g, xf - L / 2 - 3, y - L * .14, -1, 0, R / 1000 * U, '');
  txt(g, `绳子两头各 ${R} 牛`, (xr + xf) / 2, y - L * .36 - 22, { c: T.F, size: 12.5, w: 700, a: 'center' });
  farrow(g, xf - 1.4 * px, y + 18, 1, 0, P / 1000 * U, ''); txt(g, `地面往前推前车 ${P} 牛`, w - 10, y + 44, { c: T.F, size: 12.5, w: 700, a: 'right' });
};
push.upd();

kidQuiz(21, KGEN[21]);
start();
