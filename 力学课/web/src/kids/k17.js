// 启 17 · 几个力一起推：一边推一边拖，找每秒涨 2 的两种办法 → 起名字“合力” → 合力是 0 速度不变 → 拖的力随车速变，车速最后稳住
import { $, Fig, T, txt, arrow, start, kpis, ctl, seg } from '../ui.js';
import { CAR_L, rollRoad, carAt, vtGrid, vline, farrow, clamp, beats, kidGuesses, kidQuiz, kidChrome, dot } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(17);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, text: '3000 往前，1000 往后，抵掉以后剩 2000 牛往前。2000 ÷ 1000 = 2。' },
  g2: { right: 1, text: '速度不变，合力就是 0。发动机推多少，空气和地面就拖多少，正好抵掉。' },
  g3: { right: 1, text: '掉得越快，空气顶得越厉害。顶的力追上往下拉的力，合力变成 0，速度就不变了。' },
});
const M = 1000, one = (x) => (Math.round(x * 10) / 10).toString();
/** 车 + 往前推、往后拖两个红箭头 + 下面一个深色的“剩下的”箭头；unit = 每 1000 牛画多长 */
function forces(g, w, y, off, push, drag, label) {
  const px = 7, L = CAR_L * px * 1.2, cx = w / 2, unit = Math.min(26, (w / 2 - L / 2 - 16) / 5), net = push - drag;
  rollRoad(g, w, y, off, px); carAt(g, cx, y - L * .2, L, {});
  farrow(g, cx + L / 2 + 2, y - 16, 1, 0, push / 1000 * unit, ''); if (push) txt(g, `推 ${push}`, cx + L / 2 + 6, y - 28, { c: T.F, size: 12.5, w: 700 });
  farrow(g, cx - L / 2 - 2, y - 16, -1, 0, drag / 1000 * unit, ''); if (drag) txt(g, `拖 ${Math.round(drag)}`, cx - L / 2 - 6, y - 28, { c: T.F, size: 12.5, w: 700, a: 'right' });
  const ny = y + 34, len = Math.abs(net) / 1000 * unit;
  if (len >= 14) arrow(g, cx, ny, cx + Math.sign(net) * len, ny, T.ink, 5, 12);
  txt(g, label, cx, ny + 22, { c: T.ink, size: 12.5, w: 700, a: 'center' });
}

// ---------------------------------------------------------------- 第 2 步
const DUR = 5, V0 = 10;
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? 1.12 : .6), maxH: 450, minH: 370 });
const s = { t: 0, v: V0, off: 0, run: false, pts: [{ t: 0, v: V0 }], p: 3000, d: 3000 };
const ways = new Set();
const left = (p, d) => (p === d ? '抵掉以后剩 0' : `抵掉以后剩 ${Math.abs(p - d)} 牛，往${p > d ? '前' : '后'}`);
const tip1 = () => { $('cap1').textContent = `往前推 ${sp.v} 牛，往后拖 ${sd.v} 牛。按“开 5 秒”看速度怎么变。`; };
const sp = ctl('s1', (v) => `${v} 牛`, () => { if (!s.run) tip1(); c1.dirty = true; }), sd = ctl('s2', (v) => `${v} 牛`, () => { if (!s.run) tip1(); c1.dirty = true; });
$('go1').addEventListener('click', () => { Object.assign(s, { t: 0, v: V0, run: true, pts: [{ t: 0, v: V0 }], p: sp.v, d: sd.v }); });
c1.step = (dt) => {
  if (!s.run) return false;
  const t1 = Math.min(DUR, s.t + dt), a = (s.p - s.d) / M;
  s.v = clamp(s.v + a * (t1 - s.t), 0, 40); s.off += s.v * (t1 - s.t); s.t = t1; s.pts.push({ t: s.t, v: s.v });
  if (s.t >= DUR) {
    s.run = false;
    const how = a > 0 ? `速度每秒涨 ${a}` : a < 0 ? `速度每秒掉 ${-a}` : '速度不变';
    if (a === 2) ways.add(`${s.p}-${s.d}`);
    $('cap1').textContent = `${left(s.p, s.d)}。${how}。${a === 2 ? `每秒涨 2 的办法，找到 ${ways.size} 种。` : ''}`;
    if (ways.size >= 2) { B.unlock('b2', '2 种都找到了。抵掉以后，剩下的都是 2000 牛。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  }
  return true;
};
c1.draw = function (g, w, h) {
  const p = s.run ? s.p : sp.v, d = s.run ? s.d : sd.v;
  forces(g, w, 70, s.off, p, d, left(p, d));
  const box = { x: 44, y: 166, w: w - 62, h: h - 166 - 44 };
  const { X, Y } = vtGrid(g, box, { t1: DUR, v1: 40, vs: 10, note: '↑ 越往上越快（每秒几米）' });
  vline(g, s.pts, X, Y, T.v, 3.5); const q = s.pts[s.pts.length - 1]; dot(g, X(q.t), Y(q.v), T.v, 5);
};
tip1();

// ---------------------------------------------------------------- 第 5 步：拖的力随车速变
const TAB = [[0, 0], [10, 500], [20, 1000], [30, 2000], [40, 3500], [50, 5500]];
const dragAt = (v) => { for (let i = 1; i < TAB.length; i++) if (v <= TAB[i][0]) { const [v0, d0] = TAB[i - 1], [v1, d1] = TAB[i]; return d0 + (d1 - d0) * (v - v0) / (v1 - v0); } return 5500; };
const END = { 500: 10, 1000: 20, 2000: 30, 3500: 40 }, T2 = 80;
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? 1.12 : .6), maxH: 450, minH: 370 });
const r = { t: 0, v: 0, off: 0, run: false, pts: [{ t: 0, v: 0 }], p: 0, ok: false };
const show2 = () => { const d = Math.round(dragAt(r.v) / 10) * 10; kpis('k2', [['往前推', `${r.p}`, '牛', 'F'], ['往后拖', `${r.p && Math.abs(r.p - d) < 30 ? r.p : d}`, '牛', 'F'], ['车速：每秒', one(r.v), '米', 'v']]); };
const pick = seg('pick2', (v) => { Object.assign(r, { t: 0, v: 0, off: 0, run: true, pts: [{ t: 0, v: 0 }], p: +v }); $('cap2').textContent = '开着呢……'; });
[...$('pick2').querySelectorAll('button')].forEach((b) => b.setAttribute('aria-pressed', 'false'));
c2.step = (dt) => {
  if (!r.run) return false;
  for (let k = 0; k < 10; k++) { const h = Math.min(dt, .05); r.v += (r.p - dragAt(r.v)) / M * h; r.off += r.v * h * .12; r.t += h; }
  r.pts.push({ t: r.t, v: r.v });
  if (r.t >= T2) {
    r.run = false; r.v = END[r.p]; r.pts.push({ t: T2, v: r.v });
    $('cap2').textContent = `推 ${r.p} 牛，车速稳在每秒 ${r.v} 米。这时候往后拖的也是 ${r.p} 牛，合力是 0。${r.p === 1000 ? '' : '任务是稳在每秒 20 米。'}`;
    if (r.p === 1000 && !r.ok) { r.ok = true; B.unlock('b5', '找到了：推 1000 牛。'); }
  }
  show2(); return true;
};
c2.draw = function (g, w, h) {
  const d = dragAt(r.v), net = r.p - d;
  forces(g, w, 70, r.off, r.p, r.p && Math.abs(net) < 30 ? r.p : Math.round(d / 10) * 10, !r.p ? '选一个推力开始' : Math.abs(net) < 30 ? '合力 0，车速不再变' : `合力 ${Math.round(net / 10) * 10} 牛，还在变快`);
  const box = { x: 44, y: 166, w: w - 62, h: h - 166 - 44 };
  const { X, Y } = vtGrid(g, box, { t1: T2, v1: 40, vs: 10, ts: 10, tl: 2, note: '↑ 越往上越快（每秒几米）' });
  vline(g, r.pts, X, Y, T.v, 3.5); const q = r.pts[r.pts.length - 1]; dot(g, X(q.t), Y(q.v), T.v, 5);
};
show2(); $('cap2').textContent = '点一个推力开始。';

kidQuiz(17, KGEN[17]);
start();
