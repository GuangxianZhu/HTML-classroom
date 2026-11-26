// 启 15 · 推空车和推满车：同一个人推 20 / 40 / 80 千克 → 起名字“质量” → 质量几倍，力也要几倍 → 停下来也一样
import { $, Fig, T, txt, start, ctl } from '../ui.js';
import { rollRoad, vtGrid, vline, farrow, beats, kidGuesses, kidQuiz, kidChrome, dot, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(15);
const B = beats();
const G = kidGuesses({
  g1: { right: 2, later: true, text: '质量是 4 倍，速度就只涨到四分之一。力一样大，可是要带动的东西多了。' },
  g2: { right: 1, text: '满车质量大，同样的力拖它，速度每秒掉得少。它要滑更远才停。' },
  g3: { right: 1, text: '称不出轻重，可是铁箱里的“料”一点没少。质量大，就难推动。' },
});
const PUSH = 80;                                     // 一个人推的力（下一小课才说它是 80 牛）
const one = (x) => (Math.round(x * 10) / 10).toString();

/** 手推车：x 是车筐左下角，y 是地面，m 是连车带货的千克数（货画多少） */
function cart(g, x, y, m, s = 1) {
  const W = 78 * s, H = 44 * s, by = y - 14 * s - H;
  g.fillStyle = T.m; g.globalAlpha = .75;
  const n = m <= 20 ? 0 : m <= 40 ? 3 : 8;
  for (let k = 0; k < n; k++) { const col = k % 4, row = Math.floor(k / 4); rr(g, x + 5 * s + col * 17.5 * s, by + H - 19 * s - row * 19 * s, 15 * s, 16 * s, 2); g.fill(); }
  g.globalAlpha = 1; g.strokeStyle = T.ink2; g.lineWidth = 2.5; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(x - 16 * s, by - 8 * s); g.lineTo(x - 4 * s, by); g.lineTo(x + W, by); g.lineTo(x + W - 8 * s, by + H); g.lineTo(x + 2 * s, by + H); g.lineTo(x - 4 * s, by); g.stroke();
  for (const wx of [x + 12 * s, x + W - 18 * s]) { g.beginPath(); g.arc(wx, y - 7 * s, 6 * s, 0, 7); g.fillStyle = T.ink2; g.fill(); }
  txt(g, `${m} 千克`, x + W / 2, by - 8 * s, { c: T.ink2, size: 12.5, w: 700, a: 'center' });
  return { hx: x - 18 * s, hy: by + 6 * s, W };
}

// ---------------------------------------------------------------- 第 2 步：一个人推三辆车
const DUR = 4, MS = [20, 40, 80];
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? 1.08 : .58), maxH: 440, minH: 350 });
const s1 = { m: 0, t: 0, off: 0, run: false, done: new Set() };
const btn1 = [...$('pick1').querySelectorAll('button')];
btn1.forEach((b) => b.addEventListener('click', () => { Object.assign(s1, { m: +b.dataset.v, t: 0, off: 0, run: true }); btn1.forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
c1.step = (dt) => {
  if (!s1.run) return false;
  const a = PUSH / s1.m, t1 = Math.min(DUR, s1.t + dt);
  s1.off += a * (s1.t + t1) / 2 * (t1 - s1.t); s1.t = t1;
  if (s1.t >= DUR) {
    s1.run = false; s1.done.add(s1.m); $(`a${s1.m}`).textContent = `${a}`;
    if (s1.done.size === 3) { B.unlock('b2', '三辆都推过了：每秒涨 4、2、1。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  }
  return true;
};
c1.draw = function (g, w, h) {
  const y = 104, cx = w / 2 - 30;
  rollRoad(g, w, y, s1.off, 14);
  const C = cart(g, cx, y, s1.m || 20);
  farrow(g, C.hx - 62, C.hy, 1, 0, 56, '一个人推', { side: -1 });
  const box = { x: 44, y: 150, w: w - 62, h: h - 150 - 44 };
  const { X, Y } = vtGrid(g, box, { t1: DUR, v1: 16, vs: 4, note: '↑ 越往上越快（每秒几米）' });
  for (const m of s1.done) if (m !== s1.m || !s1.run) { const on = m === s1.m; vline(g, [{ t: 0, v: 0 }, { t: DUR, v: PUSH / m * DUR }], X, Y, on ? T.v : T.ink3, on ? 3.5 : 2.5, on ? 1 : .55); txt(g, `${m} 千克`, X(DUR) - 6, Y(PUSH / m * DUR) - 8, { c: on ? T.v : T.ink3, size: 12, w: on ? 700 : 500, a: 'right' }); }
  if (!s1.m) { txt(g, '点一辆车开始', box.x + box.w / 2, box.y + box.h / 2, { c: T.ink3, size: 14, a: 'center' }); return; }
  if (s1.run) { const v = PUSH / s1.m * s1.t; vline(g, [{ t: 0, v: 0 }, { t: s1.t, v }], X, Y, T.v, 3.5); dot(g, X(s1.t), Y(v), T.v, 5); }
};

// ---------------------------------------------------------------- 第 4 步：几个人推满车
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? 1.08 : .58), maxH: 440, minH: 350 });
const s2 = { t: 0, off: 0, run: false, n: 1, ok: false };
const men = ctl('s2', (v) => `${v} 个人`, () => { if (!s2.run) { s2.t = 0; s2.n = men.v; } c2.dirty = true; });
$('go2').addEventListener('click', () => { Object.assign(s2, { t: 0, off: 0, run: true, n: men.v }); });
c2.step = (dt) => {
  if (!s2.run) return false;
  const a = s2.n, t1 = Math.min(DUR, s2.t + dt);
  s2.off += a * (s2.t + t1) / 2 * (t1 - s2.t); s2.t = t1;
  if (s2.t >= DUR) {
    s2.run = false;
    if (s2.n === 4) { $('cap2').textContent = '做到了！质量是 4 倍，4 个人推，每秒也涨 4。'; if (!s2.ok) { s2.ok = true; B.unlock('b4', '做到了。'); } }
    else $('cap2').textContent = `${s2.n} 个人推，每秒涨 ${s2.n}。${s2.n < 4 ? '还不够快。' : '比空车还快了，少一个人试试。'}`;
  }
  return true;
};
c2.draw = function (g, w, h) {
  const y = 104, cx = w / 2 - 10;
  rollRoad(g, w, y, s2.off, 14);
  const C = cart(g, cx, y, 80), n = s2.run ? s2.n : men.v;
  for (let k = 0; k < n; k++) farrow(g, C.hx - 46, C.hy - 12 + k * 11 - (n - 1) * 3, 1, 0, 40, '');
  txt(g, `${n} 个人推`, C.hx - 52, C.hy + 4, { c: T.F, size: 12.5, w: 700, a: 'right' });
  const box = { x: 44, y: 150, w: w - 62, h: h - 150 - 44 };
  const { X, Y } = vtGrid(g, box, { t1: DUR, v1: 20, vs: 4, note: '↑ 越往上越快（每秒几米）' });
  g.save(); g.setLineDash([6, 5]); vline(g, [{ t: 0, v: 0 }, { t: DUR, v: 16 }], X, Y, T.ink3, 2); g.restore();
  txt(g, '空车的线', X(DUR) - 6, Y(16) - 8, { c: T.ink3, size: 12, a: 'right' });
  if (s2.t > 0) { vline(g, [{ t: 0, v: 0 }, { t: s2.t, v: s2.n * s2.t }], X, Y, T.v, 3.5); dot(g, X(s2.t), Y(s2.n * s2.t), T.v, 5); }
};

kidQuiz(15, KGEN[15]);
start();
