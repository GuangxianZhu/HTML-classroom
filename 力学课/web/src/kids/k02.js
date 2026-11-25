// 启 2 · 家西边怎么编号：电梯的 −1 层 → 把电梯放倒就是路 → 负号只说明“在另一边”
import { $, Fig, T, txt, start, seg } from '../ui.js';
import { road, carPx, carAt, place, freeDrag, beats, kidGuesses, kidQuiz, kidChrome, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(2);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, text: '数还是 10，前面加一个小记号，说明它在另一边。这个记号就是负号。' },
  g2: { right: 1, text: '红车在西边 30 米，紫车在东边 10 米。30 米比 10 米远。' },
  g3: { right: 0, text: '负号说明在西边，40 是离家 40 米。' },
});
const num = (X) => (X === 0 ? '0' : X > 0 ? `${X}` : `−${-X}`);

// ---------------------------------------------------------------- 第 2 步：电梯
const c1 = new Fig('c1', { ratio: .5, maxH: 300, minH: 250 });
let fl = 1, pos = 1;
const idx = (f) => (f > 0 ? f - 1 : f);            // 1 层 → 0，−1 层 → −1：没有 0 层
const nameOf = (f) => (f > 0 ? `地上 ${f} 层` : `地下 ${-f} 层`);
const lift = seg('lift', (v) => { fl = +v; $('cap1').textContent = `电梯去${nameOf(fl)}……`; });
c1.step = (dt) => {
  const to = idx(fl); if (Math.abs(pos - 1 - to) < 1e-3) return false;
  const cur = pos - 1, d = to - cur, s = Math.sign(d) * Math.min(Math.abs(d), dt * 2.2);
  pos += s;
  if (Math.abs(pos - 1 - to) < 1e-3) { pos = to + 1; $('cap1').textContent = `到了：${nameOf(fl)}。${fl < 0 ? '按钮上的 −' + (-fl) + '，就是地面往下第 ' + (-fl) + ' 层。' : ''}`; if (fl === -2) B.unlock('b2', '到地下 2 层了。'); }
  return true;
};
c1.draw = function (g, w, h) {
  const fh = (h - 30) / 5, x0 = w * .28, bw = Math.min(260, w * .5), top = 14;
  const yOf = (i) => top + (2 - i) * fh;             // i = 2,1,0,−1,−2 → 从上到下
  const ground = yOf(0) + fh;
  g.fillStyle = T.road; g.globalAlpha = .13; g.fillRect(0, ground, w, h - ground); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, ground); g.lineTo(w, ground); g.stroke();
  txt(g, '地面', 8, ground - 6, { c: T.ink2, size: 12, w: 700 });
  for (const f of [3, 2, 1, -1, -2]) {
    const i = idx(f), y = yOf(i);
    g.strokeStyle = T.ink3; g.lineWidth = 1.2; g.strokeRect(x0, y, bw, fh);
    txt(g, num(f), x0 - 10, y + fh / 2 + 6, { c: f < 0 ? T.x : T.ink, size: 18, w: 700, a: 'right' });
    txt(g, nameOf(f), x0 + bw + 10, y + fh / 2 + 5, { c: T.ink3, size: 12 });
  }
  const cy = yOf(pos - 1);
  rr(g, x0 + bw * .36, cy + 4, bw * .28, fh - 8, 4); g.fillStyle = T.acc || T.v; g.globalAlpha = .85; g.fill(); g.globalAlpha = 1;
  txt(g, '电梯', x0 + bw * .5, cy + fh / 2 + 5, { c: T.panel, size: 12, w: 700, a: 'center' });
};

// ---------------------------------------------------------------- 第 3 步：路牌的两种写法
const st2 = { x: 30 };
const c2 = new Fig('c2', { ratio: .22, maxH: 170, minH: 150 });
const w2 = seg('w2', () => { say2(); c2.dirty = true; });
const say2 = () => { $('cap2').textContent = `车在${place(st2.x)}，路牌上写 ${num(st2.x)}。`; };
freeDrag(c2, st2, { min: -40, max: 40, step: 10, onMove: say2, onDrop: (x) => { if (x === -20) B.unlock('b3', '停对了：−20 就是西 20 米。'); } });
say2();
c2.draw = function (g, w, h) {
  const y = h - 34, R = road(g, w, y, -45, 45, { label: w2.v === 'num' ? num : undefined }), L = carPx(R.px);
  this.toX = R.toX;
  carAt(g, R.sx(st2.x), y - L * .2, L, {});
  txt(g, w2.v === 'num' ? num(st2.x) : place(st2.x), R.sx(st2.x), y - L * .5 - 4, { c: T.x, size: 15, w: 700, a: 'center' });
};

// ---------------------------------------------------------------- 第 5 步：谁离家远
const c3 = new Fig('c3', { ratio: .2, maxH: 150, minH: 135 });
c3.draw = function (g, w, h) {
  const y = h - 34, R = road(g, w, y, -45, 45, { label: num }), L = carPx(R.px);
  carAt(g, R.sx(-30), y - L * .2, L, { color: T.F }); carAt(g, R.sx(10), y - L * .2, L, { color: T.p });
  for (const [X, c] of [[-30, T.F], [10, T.p]]) {
    g.strokeStyle = c; g.lineWidth = 2.5; g.beginPath(); g.moveTo(R.sx(0), y - 44); g.lineTo(R.sx(X), y - 44); g.stroke();
    txt(g, `${Math.abs(X)} 米`, R.sx(X / 2), y - 50, { c, size: 13, w: 700, a: 'center' });
  }
};

document.querySelector('#b3 .go')?.addEventListener('click', () => { G.reveal('g1'); G.echo('g1', 'echo1'); });
kidQuiz(2, KGEN[2]);
start();
