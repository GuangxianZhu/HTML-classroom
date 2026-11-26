// 启 24 · 拐弯也算速度在变：圆形弯道上突然结冰，车沿那一刻的方向直走 → 速度有两样（多快、往哪边）→ 横着的力只改方向
import { $, Fig, T, txt, arrow, start } from '../ui.js';
import { carTop, farrow, beats, kidGuesses, kidQuiz, kidChrome } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(24);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, wait: '记下了。把这个力拿走试试，看下面。', text: '不是 0。有一个力一直把车往弯里拉。把它拿走，车就直直走了。' },
  g2: { right: 1, text: '都有。横着的那一份让车拐弯，顺着车头的那一份让车变快。' },
  g3: { right: 1, text: '没有往外甩的力。你照原来的方向直走，车却拐走了。看上去像是你被甩向车门。' },
  g4: { right: 0, text: '链子一松，拉着球拐弯的力就没了。球照着那一刻的方向直直飞。' },
});

const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .95 : .5), maxH: 400, minH: 320 });
const s = { ang: 0, ice: false, d: 0, spots: [] };                  // ang：车在圆上的角度；结冰以后沿直线走了 d
const W1 = .55;                                                    // 每秒转过的角度
const cap = () => { $('cap1').textContent = s.ice ? '摩擦力没了。车照着结冰那一刻的方向，直直滑出去。' : `车在转圈，红箭头一直指着圆心。已经试了 ${s.spots.length} 个地方。`; };
$('ice1').addEventListener('click', () => {
  if (s.ice) return;
  s.ice = true; s.d = 0;
  const q = ((s.ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (!s.spots.some((a) => Math.abs(a - q) < .5 || Math.abs(a - q) > Math.PI * 2 - .5)) s.spots.push(q);
  if (s.spots.length >= 3) { B.unlock('b2', '每次都是照着那一刻的方向直走。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  cap();
});
$('re1').addEventListener('click', () => { s.ice = false; s.d = 0; cap(); });
c1.step = (dt) => { if (s.ice) s.d = Math.min(s.d + dt, 4); else s.ang += W1 * dt; return true; };
c1.draw = function (g, w, h) {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * .3;
  g.strokeStyle = T.road; g.globalAlpha = s.ice ? .12 : .3; g.lineWidth = 30; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke(); g.globalAlpha = 1;
  if (s.ice) { g.strokeStyle = T.x; g.globalAlpha = .25; g.lineWidth = 30; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke(); g.globalAlpha = 1; }
  g.fillStyle = T.ink3; g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill(); txt(g, '圆心', cx + 7, cy + 4, { c: T.ink3, size: 11.5 });
  for (const a of s.spots) { g.fillStyle = T.a; g.beginPath(); g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 4, 0, 7); g.fill(); }
  const px = cx + Math.cos(s.ang) * R, py = cy + Math.sin(s.ang) * R, tx = -Math.sin(s.ang), ty = Math.cos(s.ang);   // 切线方向（往前）
  const x = px + tx * s.d * W1 * R, y = py + ty * s.d * W1 * R, L = Math.max(36, R * .34);
  if (s.ice) { g.strokeStyle = T.ink3; g.setLineDash([5, 5]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke(); g.setLineDash([]); }
  carTop(g, x, y, L, Math.atan2(ty, tx));
  arrow(g, x + tx * L * .6, y + ty * L * .6, x + tx * (L * .6 + 34), y + ty * (L * .6 + 34), T.v, 3, 9);
  if (!s.ice) { farrow(g, x - Math.cos(s.ang) * 14, y - Math.sin(s.ang) * 14, -Math.cos(s.ang), -Math.sin(s.ang), R * .42, ''); }
  txt(g, '绿箭头：这一刻往哪走', 10, 20, { c: T.v, size: 12, w: 700 });
  txt(g, s.ice ? '结冰了：没有摩擦力' : '红箭头：地面的摩擦力', 10, 38, { c: s.ice ? T.x : T.F, size: 12, w: 700 });
};
cap();

kidQuiz(24, KGEN[24]);
start();
