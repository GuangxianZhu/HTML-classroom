// 启 1 · 车停在哪：只说“离家 30 米”有两个地方 → 听口令停车 → 换一个地方量起 → 位置要三样（从哪量起、往哪边、多少米）
import { $, Fig, T, txt, start, kpis, seg } from '../ui.js';
import { road, carPx, carAt, place, freeDrag, beats, kidGuesses, kidQuiz, kidChrome, dot } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(1);
const B = beats();
const G = kidGuesses({
  g1: { right: 2, later: true, text: '“我家东边 30 米”说了三样：从我家量起、往东、30 米。少一样，司机就得猜。' },
  g2: { right: 1, text: '从讲台量起、往左、3 米，三样都有。“旁边 3 米”没说哪边；“教室左边”没说从哪量、多少米。' },
});
const R0 = -45, R1 = 45;

// ---------------------------------------------------------------- 第 2 步：离家 30 米有两个地方
const c1 = new Fig('c1', { ratio: .22, maxH: 170, minH: 150 });
const hits = new Set(); let miss = null;
c1.c.addEventListener('click', (e) => {
  if (!c1.toX) return;
  const X = Math.round(c1.toX(e.clientX - c1.c.getBoundingClientRect().left) / 10) * 10;
  if (Math.abs(X) === 30) { hits.add(X); miss = null; } else miss = X;
  const n = hits.size;
  $('cap1').textContent = miss !== null ? `${place(miss)}：这里离你家不是 30 米。` : n === 1 ? '对，这里离你家 30 米。还有别的地方吗？' : '东边 30 米、西边 30 米，都离你家 30 米。司机不知道去哪个。';
  if (n === 2) B.unlock('b2', '一句话，两个地方。');
  c1.dirty = true;
});
c1.draw = function (g, w, h) {
  const y = h - 34, R = road(g, w, y, R0, R1), L = carPx(R.px);
  this.toX = R.toX;
  for (const X of hits) { carAt(g, R.sx(X), y - L * .2, L, { color: T.x, alpha: .9 }); txt(g, '？', R.sx(X), y - L * .55, { c: T.x, size: 15, w: 700, a: 'center' }); }
  if (miss !== null) { dot(g, R.sx(miss), y - 8, T.no, 5); }
  if (hits.size === 2) {
    g.strokeStyle = T.x; g.lineWidth = 1.5; g.setLineDash([4, 3]);
    for (const X of [-30, 30]) { g.beginPath(); g.moveTo(R.sx(0), y - 46); g.lineTo(R.sx(X), y - 46); g.stroke(); txt(g, '30 米', R.sx(X / 2), y - 51, { c: T.x, size: 12, w: 700, a: 'center' }); }
    g.setLineDash([]);
  }
};

// ---------------------------------------------------------------- 第 3 步：听口令停车
const ORDERS = [30, -10, 20, -40]; let oi = 0, okFlash = 0;
const st2 = { x: 0 };
const c2 = new Fig('c2', { ratio: .22, maxH: 170, minH: 150 });
const say = () => { $('cap2').textContent = oi < ORDERS.length ? `口令 ${oi + 1}（共 ${ORDERS.length} 个）：把车停到我家${ORDERS[oi] > 0 ? '东' : '西'}边 ${Math.abs(ORDERS[oi])} 米。` : '四个口令都停对了！'; };
say();
freeDrag(c2, st2, { min: -40, max: 40, step: 1, onDrop: (x) => {
  if (oi >= ORDERS.length) return;
  if (Math.abs(x - ORDERS[oi]) <= 1) { st2.x = ORDERS[oi]; oi++; okFlash = 1; say(); if (oi === ORDERS.length) B.unlock('b3', '都停对了。'); } else $('cap2').textContent = `现在车在${place(x)}。口令是：我家${ORDERS[oi] > 0 ? '东' : '西'}边 ${Math.abs(ORDERS[oi])} 米。再拖一拖。`;
  c2.dirty = true;
} });
c2.step = (dt) => { if (okFlash <= 0) return false; okFlash = Math.max(0, okFlash - dt * 1.5); return true; };
c2.draw = function (g, w, h) {
  const y = h - 34, R = road(g, w, y, R0, R1), L = carPx(R.px);
  this.toX = R.toX;
  carAt(g, R.sx(st2.x), y - L * .2, L, { color: okFlash > 0 ? T.ok : T.ink2 });
  txt(g, place(st2.x), R.sx(st2.x), y - L * .5 - 4, { c: okFlash > 0 ? T.ok : T.x, size: 14, w: 700, a: 'center' });
};

// ---------------------------------------------------------------- 第 4 步：换一个地方量起
const st3 = { x: 40 }; const seen = new Set(['0']);
const c3 = new Fig('c3', { ratio: .24, maxH: 180, minH: 160 });
const rel = (x, o, name) => { const d = Math.round(x - o); return d === 0 ? `${name}门口` : `${name}${d > 0 ? '东' : '西'}边 ${Math.abs(d)} 米`; };
const upd3 = () => {
  kpis('k3', [['从我家量起', rel(st3.x, 0, '我家'), '', o3.v === '0' ? 'x' : ''], ['从便利店量起', rel(st3.x, 30, '便利店'), '', o3.v === '30' ? 'x' : ''], ['车动了吗', '没动', '']]);
  c3.dirty = true;
};
const o3 = seg('o3', (v) => { seen.add(v); if (seen.size === 2) B.unlock('b4', '同一辆车，两种说法。'); upd3(); });
freeDrag(c3, st3, { min: -20, max: 60, step: 5, onMove: () => kpis('k3', [['从我家量起', rel(st3.x, 0, '我家'), '', o3.v === '0' ? 'x' : ''], ['从便利店量起', rel(st3.x, 30, '便利店'), '', o3.v === '30' ? 'x' : ''], ['车动了吗', '你在拖', '']]) });
upd3();
c3.draw = function (g, w, h) {
  const o = +o3.v, y = h - 34;
  const lab = (X) => { const d = X - o; return d === 0 ? (o ? '店' : '家') : d > 0 ? `东${d}` : `西${-d}`; };
  const R = road(g, w, y, -25, 65, { label: lab, bold: o, house: false }), L = carPx(R.px);
  this.toX = R.toX;
  for (const [X, name] of [[0, '我家'], [30, '便利店']]) {
    const cx = R.sx(X), top = y - 36, on = X === o;
    g.fillStyle = on ? T.x : T.panel2; g.strokeStyle = on ? T.x : T.ink3; g.lineWidth = 1.2; g.globalAlpha = on ? .85 : 1;
    g.fillRect(cx - 11, top - 18, 22, 18); g.strokeRect(cx - 11, top - 18, 22, 18);
    g.beginPath(); g.moveTo(cx - 15, top - 18); g.lineTo(cx, top - (X ? 24 : 29)); g.lineTo(cx + 15, top - 18); g.closePath(); g.fill(); g.stroke(); g.globalAlpha = 1;
    txt(g, name, cx, top - 34, { c: on ? T.x : T.ink2, size: 12, w: on ? 700 : 500, a: 'center' });
  }
  carAt(g, R.sx(st3.x), y - L * .2, L, {});
  txt(g, '这辆车也可以拖', 8, 16, { c: T.ink3, size: 12 });
};

kidQuiz(1, KGEN[1]);
start();
document.querySelector('#b4 .go')?.addEventListener('click', () => { G.reveal('g1'); G.echo('g1', 'echo1'); });
