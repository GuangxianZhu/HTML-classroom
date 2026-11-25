// 启 6 · 谁更快：两辆车比快慢 → 数每秒挪几米 → 起名字“速度” → 并排不等于一样快 → 调滑块让红车第 3 秒追上 → 照着线开车
import { $, Fig, T, txt, arrow, start, kpis, ctl } from '../ui.js';
import { Driver, segTrip, road, carPx, ptGrid, line, carAt, place, clamp, beats, kidGuesses, kidQuiz, kidChrome, dot } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(6);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, text: '紫车一开始就在前面 20 米，所以前几秒它在前面。可是红车每秒走 15 米，紫车只走 10 米，第 4 秒红车就追上了。' },
  g2: { right: 1, text: '并排只说明这一刻两辆车在同一个地方。红车每秒还是走 15 米，紫车还是 10 米，下一秒红车就到前面去了。' },
  g3: { right: 1, text: '快慢看每秒走几米。在前面、线高，都只说明车在哪。' },
});
const RED = () => T.F, PUR = () => T.p;
const red = (t) => 15 * t, pur = (t) => 20 + 10 * t;

// ---------------------------------------------------------------- 第 2 步：两辆车开 5 秒，数每秒挪几米
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? 1.05 : .72), maxH: 520, minH: 380 });
let t1 = 0, play1 = false, k1 = 0;
const secs = $('sec1');
secs.innerHTML = [1, 2, 3, 4, 5].map((k) => `<button class="btn" type="button" data-v="${k}" disabled>第 ${k} 秒</button>`).join('');
const pickSec = (k) => {
  k1 = k; secs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.v === k));
  kpis('k1', [[`第 ${k} 秒里红车挪了`, `${red(k) - red(k - 1)}`, '米', 'F'], ['紫车挪了', `${pur(k) - pur(k - 1)}`, '米', 'p'], ['红车多走', '5', '米']]);
  c1.dirty = true;
};
secs.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => pickSec(+b.dataset.v)));
$('go1').addEventListener('click', () => { t1 = 0; k1 = 0; play1 = true; secs.querySelectorAll('button').forEach((b) => b.removeAttribute('aria-pressed')); });
kpis('k1', [['红车在', place(0), '', 'F'], ['紫车在', place(20), '', 'p'], ['过了', '0', '秒']]);
c1.step = (dt) => {
  if (!play1) return false;
  t1 = Math.min(5, t1 + dt);
  kpis('k1', [['红车在', place(red(t1)), '', 'F'], ['紫车在', place(pur(t1)), '', 'p'], ['过了', `${Math.floor(t1)}`, '秒']]);
  if (t1 >= 5) {
    play1 = false;
    secs.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    pickSec(1);
    B.unlock('b2', '开完了。点一点“第几秒”，再往下走。');
    G.reveal('g1'); G.echo('g1', 'echo1'); $('echo1').textContent += '。光看谁在前面，看不出谁快。';
  }
  return true;
};
function lanes(g, w, y, x0, x1, at, ghostK) {
  const R = road(g, w, y, x0, x1, { lanes: 2, house: false }), L = carPx(R.px) * .85;
  const yR = y - 4, yP = y - 31;
  if (ghostK > 0) {
    for (const [f, yy, c] of [[red, yR, RED()], [pur, yP, PUR()]]) {
      carAt(g, R.sx(f(ghostK - 1)), yy - L * .2, L, { color: c, alpha: .22 });
      arrow(g, R.sx(f(ghostK - 1)), yy - L * .55, R.sx(f(ghostK)), yy - L * .55, c, 2.5, 8);
      txt(g, `${f(ghostK) - f(ghostK - 1)} 米`, R.sx(f(ghostK)) + L * .6, yy - L * .2 + 4, { c, size: 12.5, w: 700 });
    }
  }
  const tt = ghostK > 0 ? ghostK : at;
  carAt(g, R.sx(red(tt)), yR - L * .2, L, { color: RED() });
  carAt(g, R.sx(pur(tt)), yP - L * .2, L, { color: PUR() });
  txt(g, '红车', 4, yR - 6, { c: RED(), size: 11.5, w: 700 }); txt(g, '紫车', 4, yP - 6, { c: PUR(), size: 11.5, w: 700 });
  return R;
}
c1.draw = function (g, w, h) {
  lanes(g, w, 78, -8, 92, t1, k1);
  const box = { x: 56, y: 132, w: w - 74, h: h - 132 - 44 };
  const { X, Y } = ptGrid(g, box, { t1: 5, x0: 0, x1: 80, xs: 10, ts: 1 });
  const upto = (f) => { const p = []; for (let k = 0; k <= Math.floor(t1); k++) p.push({ t: k, x: f(k) }); if (t1 % 1) p.push({ t: t1, x: f(t1) }); return p; };
  line(g, upto(red), X, Y, RED(), 3); line(g, upto(pur), X, Y, PUR(), 3);
  for (let k = 0; k <= Math.floor(t1); k++) { dot(g, X(k), Y(red(k)), RED(), 4); dot(g, X(k), Y(pur(k)), PUR(), 4); }
  if (k1 > 0) {
    // 这一秒：竖着往上爬了几格
    for (const [f, c, dx] of [[red, RED(), 8], [pur, PUR(), -8]]) {
      g.strokeStyle = c; g.lineWidth = 2; g.setLineDash([4, 3]);
      g.beginPath(); g.moveTo(X(k1 - 1), Y(f(k1 - 1))); g.lineTo(X(k1), Y(f(k1 - 1))); g.stroke(); g.setLineDash([]);
      arrow(g, X(k1) + dx, Y(f(k1 - 1)), X(k1) + dx, Y(f(k1)), c, 2.5, 7);
      txt(g, `${f(k1) - f(k1 - 1)}`, X(k1) + dx * 2.2, (Y(f(k1 - 1)) + Y(f(k1))) / 2 + 4, { c, size: 12.5, w: 700, a: dx > 0 ? 'left' : 'right' });
    }
  }
};

// ---------------------------------------------------------------- 第 5 步：调滑块，让红车第 3 秒追上
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? 1 : .66), maxH: 480, minH: 340 });
let t2 = 0, play2 = false, solved = false;
const sr = ctl('c2-r', (v) => `每秒 ${v} 米`, () => upd2()), sp = ctl('c2-b', (v) => `每秒 ${v} 米`, () => upd2()), sh = ctl('c2-h', (v) => `${v} 米`, () => upd2());
const meet = () => { const d = sr.v - sp.v; if (sh.v === 0) return 0; return d > 0 ? sh.v / d : Infinity; };
const fmtT = (t) => (Math.abs(t - Math.round(t)) < 1e-9 ? `${Math.round(t)}` : `${(Math.round(t * 10) / 10).toFixed(1)}`);
function upd2() {
  const tm = meet(), d = sr.v - sp.v;
  let s;
  if (sh.v === 0) s = '紫车不在前面，一出发就并排了。把“紫车在前面”调大一点。';
  else if (d <= 0) s = `红车每秒不比紫车多走，永远追不上。`;
  else if (Math.abs(tm - 3) < 1e-9) s = `做到了！红车每秒多走 ${d} 米，3 秒正好多走 ${d * 3} 米，等于紫车在前面的 ${sh.v} 米。`;
  else s = `红车每秒多走 ${d} 米，第 ${fmtT(tm)} 秒追上。${tm < 3 ? '太早了。' : '太晚了。'}`;
  $('cap2').textContent = s;
  if (!solved && sh.v > 0 && d > 0 && Math.abs(tm - 3) < 1e-9) { solved = true; B.unlock('b5', '做到了。'); }
  c2.dirty = true;
}
$('go2').addEventListener('click', () => { t2 = 0; play2 = true; });
$('tip2').addEventListener('click', () => { $('cap2').textContent = '提示：红车每秒比紫车多走几米？3 秒能多走几米？让它正好等于紫车在前面的米数。'; });
c2.step = (dt) => { if (!play2) return false; t2 = Math.min(6, t2 + dt); if (t2 >= 6) play2 = false; return true; };
c2.draw = function (g, w, h) {
  const box = { x: 56, y: 26, w: w - 74, h: h - 26 - 144 };
  const { X, Y } = ptGrid(g, box, { t1: 6, x0: 0, x1: 120, xs: 20, ts: 1 });
  const R = (t) => sr.v * t, P = (t) => sh.v + sp.v * t;
  line(g, [{ t: 0, x: R(0) }, { t: 6, x: R(6) }], X, Y, RED(), 3);
  line(g, [{ t: 0, x: P(0) }, { t: 6, x: P(6) }], X, Y, PUR(), 3);
  txt(g, '红车', X(6) - 4, Y(Math.min(118, R(6))) + (R(6) >= P(6) ? -8 : 16), { c: RED(), size: 12, w: 700, a: 'right' });
  txt(g, '紫车', X(6) - 4, Y(Math.min(118, P(6))) + (P(6) > R(6) ? -8 : 16), { c: PUR(), size: 12, w: 700, a: 'right' });
  const tm = meet();
  if (tm <= 6) {
    const ok = Math.abs(tm - 3) < 1e-9 && sh.v > 0;
    g.strokeStyle = ok ? T.ok : T.ink; g.lineWidth = 2.5; g.beginPath(); g.arc(X(tm), Y(R(tm)), 9, 0, Math.PI * 2); g.stroke();
    txt(g, `第 ${fmtT(tm)} 秒追上`, X(tm) + 12, Y(R(tm)) + 18, { c: ok ? T.ok : T.ink, size: 13, w: 700 });
  }
  if (play2 || t2 > 0) { g.strokeStyle = T.ink3; g.setLineDash([3, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(X(t2), box.y); g.lineTo(X(t2), box.y + box.h); g.stroke(); g.setLineDash([]); }
  // 下面的两条车道：按“开”看车怎么跑
  const Rd = road(g, w, h - 30, -5, 125, { lanes: 2, house: false }), L = carPx(Rd.px) * .8;
  carAt(g, Rd.sx(Math.min(125, R(t2))), h - 34 - L * .2, L, { color: RED() });
  carAt(g, Rd.sx(Math.min(125, P(t2))), h - 61 - L * .2, L, { color: PUR() });
};
upd2();

// ---------------------------------------------------------------- 第 6 步：照着线开车
const TARGET = segTrip([[2, 10], [1, 0], [2, 20]]);
let stars = 0;
const d3 = new Driver({
  dur: 5, min: -10, max: 70, vmax: 32,
  onDone: (d) => {
    const err = d.samples.reduce((s, p) => s + Math.abs(p.x - TARGET(p.t)), 0) / d.samples.length;
    stars = err < 3 ? 3 : err < 6 ? 2 : 1;
    $('hint3').textContent = `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}　${stars === 3 ? '贴得很紧！' : '陡的那段要开得快：每秒 20 米。再来一次？'}`;
    B.unlock('b6', '开完了。');
  },
});
const c3 = new Fig('c3', { ratio: (w) => (w < 500 ? 1 : .68), maxH: 470, minH: 340 });
d3.bind(c3.c, c3);
$('again3').addEventListener('click', () => { d3.reset(); stars = 0; $('hint3').textContent = '按住车开始，一共 5 秒。'; c3.dirty = true; });
c3.step = (dt) => d3.step(dt);
c3.draw = function (g, w, h) {
  const y = 66, R = road(g, w, y, -14, 74), L = carPx(R.px);
  this.toX = R.toX; this.hit = (px, py) => py < y + 26;
  carAt(g, R.sx(d3.x), y - L * .2, L, {});
  const box = { x: 56, y: 118, w: w - 74, h: h - 118 - 44 };
  const { X, Y } = ptGrid(g, box, { t1: 5, x0: -10, x1: 70, xs: 10, ts: 1 });
  const tg = []; for (let k = 0; k <= 50; k++) tg.push({ t: k / 10, x: TARGET(k / 10) });
  g.save(); g.setLineDash([7, 6]); line(g, tg, X, Y, T.ink3, 5, .55); g.restore();
  txt(g, '陡：要开得快', X(4) - 6, Y(50), { c: T.ink3, size: 12, a: 'right' });
  txt(g, '平：停住', X(2.5), Y(20) - 10, { c: T.ink3, size: 12, a: 'center' });
  line(g, d3.samples, X, Y, T.x, 3);
  if (d3.samples.length) { const s = d3.samples[d3.samples.length - 1]; dot(g, X(s.t), Y(s.x), T.x, 5); }
};

// ---------------------------------------------------------------- 离开屏幕：自己走 10 米
ctl('me', (v) => `${v} 秒`, () => {
  const s = +$('me').value, v = 10 / s, n = Math.round(15 / v);
  $('me-r').textContent = `你的速度：10 ÷ ${s} ≈ 每秒 ${(Math.round(v * 10) / 10).toFixed(1)} 米。红车每秒 15 米，差不多是你的 ${n} 倍。`;
}).upd();

kidQuiz(6, KGEN[6]);
start();
