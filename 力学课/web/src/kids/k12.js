// 启 12 · 刹车要留多远：三种车速各刹一次（10、40、90 米）→ 起名字“刹车距离”，大三角形切成 4 个小的 → 反应距离是长方形 → 60 米外有路障
import { $, Fig, T, txt, start, kpis, ctl, seg } from '../ui.js';
import { CAR_L, carAt, vtGrid, vline, beats, kidGuesses, kidQuiz, kidChrome, dot } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(12);
const B = beats();
const G = kidGuesses({
  g1: { right: 2, later: true, wait: '记下了。三种车速都刹一次，答案就出来了。', text: '每秒 10 米冲出 10 米，每秒 20 米冲出 40 米。是 4 倍，不是 2 倍。' },
  g2: { right: 1, text: '反应距离是长方形：高翻倍，宽还是 1 秒，面积 2 倍。刹车距离是三角形，才是 4 倍。' },
});
const one = (x) => (Math.round(x * 10) / 10).toString();
const poly = (g, pts, c, alpha) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fillStyle = c; g.globalAlpha = alpha; g.fill(); g.globalAlpha = 1; };

/**
 * 一趟刹车：上面是路（车头到哪算哪），下面是速度图。react 秒的反应（长方形）+ 每秒掉 dec（三角形）。
 * wall 是路障在第几米（没有就不画）；撞上就停在路障那儿。
 */
function stopFig(id, { len, t1, react = 0, wall = 0, ghosts = false, onDone }) {
  const f = new Fig(id, { ratio: (w) => (w < 500 ? 1.1 : .6), maxH: 450, minH: 350 });
  const s = { v0: 0, dec: 5, t: 0, run: false, done: false, hit: false, old: [] };
  const tb = () => s.v0 / s.dec;                                              // 刹几秒
  const vAt = (t) => (t < react ? s.v0 : Math.max(0, s.v0 - s.dec * (t - react)));
  const xAt = (t) => { const k = Math.min(Math.max(t - react, 0), tb()); return s.v0 * Math.min(t, react) + s.v0 * k - s.dec * k * k / 2; };
  f.step = (dt) => {
    if (!s.run) return false;
    s.t += dt;
    const end = react + tb();
    if (wall && xAt(s.t) >= wall && vAt(s.t) > 0 && xAt(end) > wall + 1e-9) { s.hit = true; s.run = false; s.done = true; onDone?.(api); return true; }
    if (s.t >= end) { s.t = end; s.run = false; s.done = true; if (ghosts && !s.old.some((o) => o === s.v0)) s.old.push(s.v0); onDone?.(api); }
    return true;
  };
  f.draw = function (g, w, h) {
    const y = 60, px = (w - 44) / len, sx = (m) => 22 + m * px, x = xAt(s.t);
    g.fillStyle = T.road; g.globalAlpha = .15; g.fillRect(0, y - 30, w, 32); g.globalAlpha = 1;
    g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y + 1); g.lineTo(w, y + 1); g.stroke();
    const lab = px * 10 < 44 ? 20 : 10;
    for (let m = 0; m <= len; m += 10) { g.lineWidth = 1.5; g.beginPath(); g.moveTo(sx(m), y + 1); g.lineTo(sx(m), y + 7); g.stroke(); if (m % lab === 0) txt(g, `${m} 米`, sx(m), y + 21, { c: T.ink3, size: 11.5, a: 'center' }); }
    const xr = Math.min(x, s.v0 * react);
    if (xr > 0) { g.fillStyle = T.E; g.globalAlpha = .7; g.fillRect(sx(0), y - 8, sx(xr) - sx(0), 7); g.globalAlpha = 1; }
    if (x > xr) { g.fillStyle = T.F; g.globalAlpha = .65; g.fillRect(sx(xr), y - 8, sx(x) - sx(xr), 7); g.globalAlpha = 1; }
    if (wall) { g.fillStyle = T.F; g.fillRect(sx(wall), y - 30, 5, 31); g.fillStyle = T.panel; for (let k = 0; k < 3; k++) g.fillRect(sx(wall), y - 26 + k * 10, 5, 4); txt(g, '路障', sx(wall) + 9, y - 18, { c: T.F, size: 12, w: 700 }); }
    const L = Math.max(30, CAR_L * px);
    carAt(g, sx(x) - L / 2, y - 9 - L * .2, L, {});
    const box = { x: 44, y: 120, w: w - 62, h: h - 120 - 44 };
    const { X, Y } = vtGrid(g, box, { t1, v1: 30, vs: 5, note: '↑ 越往上越快（每秒几米）' });
    for (const v of s.old) if (v !== s.v0) { vline(g, [{ t: 0, v }, { t: v / 5, v: 0 }], X, Y, T.ink3, 2, .5); if (v > s.v0) txt(g, `${v * v / 10} 米`, X(v / 10) + 6, Y(v / 2) - 6, { c: T.ink3, size: 11.5 }); }
    if (!s.v0) { txt(g, '点下面的按钮开始', box.x + box.w / 2, box.y + box.h / 2, { c: T.ink3, size: 14, a: 'center' }); return; }
    const tr = Math.min(s.t, react), v = vAt(s.t);
    if (tr > 0) poly(g, [[X(0), Y(0)], [X(tr), Y(0)], [X(tr), Y(s.v0)], [X(0), Y(s.v0)]], T.E, .3);
    if (s.t > react) poly(g, [[X(react), Y(0)], [X(s.t), Y(0)], [X(s.t), Y(v)], [X(react), Y(s.v0)]], T.F, .28);
    const pts = [{ t: 0, v: s.v0 }]; if (s.t > react) pts.push({ t: react, v: s.v0 }); pts.push({ t: s.t, v });
    vline(g, pts, X, Y, T.v, 3.5); dot(g, X(s.t), Y(v), T.v, 5);
    if (s.done) {
      if (react) txt(g, `${one(s.v0 * react)} 米`, X(react / 2), Y(s.v0 / 2) + 5, { c: T.ink, size: 14, w: 700, a: 'center' });
      if (!s.hit) txt(g, `${one(s.v0 * tb() / 2)} 米`, X(react + tb() / 3), Y(s.v0 / 3) + 5, { c: T.ink, size: 14, w: 700, a: 'center' });
    }
  };
  const api = {
    f, s, react,
    go(v0, dec = 5) { Object.assign(s, { v0, dec, t: 0, run: true, done: false, hit: false }); },
    set(v0, dec) { Object.assign(s, { v0, dec, t: 0, run: false, done: false, hit: false }); f.dirty = true; },
    brake: () => s.v0 * tb() / 2, reactD: () => s.v0 * react, total: () => s.v0 * react + s.v0 * tb() / 2, secs: tb, vNow: () => vAt(s.t),
  };
  return api;
}

// ---------------------------------------------------------------- 第 2 步：三种车速各刹一次
const tried = new Set();
const f1 = stopFig('c1', { len: 100, t1: 7, ghosts: true, onDone: (a) => {
  const v = a.s.v0; tried.add(v);
  $(`t${v}`).textContent = `${a.secs()} 秒`; $(`d${v}`).textContent = `${a.brake()} 米`;
  if (tried.size === 3) { B.unlock('b2', '三种都试过了：10 米、40 米、90 米。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
} });
$('sp1').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { f1.go(+b.dataset.v); $('sp1').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));

// ---------------------------------------------------------------- 第 3 步：大三角形切成 4 个小的
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? .8 : .44), maxH: 340, minH: 250 });
c2.draw = function (g, w, h) {
  const box = { x: 44, y: 28, w: w - 62, h: h - 28 - 44 };
  const { X, Y } = vtGrid(g, box, { t1: 5, v1: 25, vs: 5, note: '↑ 越往上越快（每秒几米）' });
  const P = (t, v) => [X(t), Y(v)];
  const parts = [[P(0, 20), P(0, 10), P(2, 10)], [P(0, 10), P(0, 0), P(2, 0)], [P(0, 10), P(2, 10), P(2, 0)], [P(2, 10), P(2, 0), P(4, 0)]];
  parts.forEach((p, i) => { poly(g, p, T.F, [.42, .26, .14, .34][i]); g.strokeStyle = T.panel; g.lineWidth = 2; g.beginPath(); p.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke(); });
  for (const [t, v] of [[.6, 13.5], [.6, 3.5], [1.4, 6.5], [2.6, 3.5]]) txt(g, '10', X(t), Y(v) + 5, { c: T.ink, size: 14, w: 700, a: 'center' });
  vline(g, [{ t: 0, v: 20 }, { t: 4, v: 0 }], X, Y, T.v, 3.5);
  g.strokeStyle = T.F; g.lineWidth = 2.5; g.beginPath(); parts[3].forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
};

// ---------------------------------------------------------------- 第 4 步：反应的那 1 秒
const show3 = (a) => kpis('k3', [['反应距离（长方形）', a ? `${a.reactD()}` : '？', '米', 'E'], ['刹车距离（三角形）', a ? `${a.brake()}` : '？', '米', 'F'], ['一共', a ? `${a.total()}` : '？', '米', 'x']]);
const f3 = stopFig('c3', { len: 130, t1: 8, react: 1, onDone: (a) => { show3(a); B.unlock('b4', '看完了。'); } });
$('sp3').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { show3(null); f3.go(+b.dataset.v); $('sp3').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
show3(null);

// ---------------------------------------------------------------- 第 5 步：60 米外有路障
const WALL = 60, ROADS = { 10: '干路', 5: '湿路', 2: '冰面' };
let ok4 = false;
const f4 = stopFig('c4', { len: 80, t1: 8, react: 1, wall: WALL, onDone: (a) => {
  const { v0, dec, hit } = a.s, tot = a.total(), name = ROADS[dec];
  let m;
  if (hit) m = `撞上了！到路障的时候，速度还有每秒 ${one(a.vNow())} 米。要停住得有 ${one(tot)} 米。`;
  else if (tot === WALL) m = `刚好停在路障前：反应 ${a.reactD()} 米 + 刹车 ${a.brake()} 米 = 60 米。`;
  else m = `停住了：${one(a.reactD())} + ${one(a.brake())} = ${one(tot)} 米，还剩 ${one(WALL - tot)} 米。`;
  if (dec === 5 && !hit && v0 === 20) { m += '湿路上最快就是每秒 20 米，也就是表上的 72。'; if (!ok4) { ok4 = true; B.unlock('b5', '找到了。'); } }
  else if (dec === 5 && !hit) m += '还能再快一点吗？';
  else if (dec === 5) m += '太快了，慢一点。';
  else m += `这是${name}。换成湿路，找最快的车速。`;
  $('cap4').textContent = m;
} });
const tip4 = () => { $('cap4').textContent = `${ROADS[rd.v]}，车速每秒 ${s4.v} 米（表上 ${Math.round(s4.v * 3.6)}）。按“刹车”试试。`; f4.set(s4.v, +rd.v); };
const rd = seg('road4', () => tip4());
const s4 = ctl('s4', (v) => `每秒 ${v} 米`, () => tip4());
$('go4').addEventListener('click', () => f4.go(s4.v, +rd.v));
tip4();

kidQuiz(12, KGEN[12]);
start();
