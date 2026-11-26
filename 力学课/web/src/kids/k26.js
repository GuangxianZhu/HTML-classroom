// 启 26 · 卫星为什么掉不下来：山顶大炮，每秒 2 / 4 / 6 / 8 千米 → 8 千米时绕一整圈 → 1 秒掉 5 米，地面 8 千米也弯下去 5 米
import { $, Fig, T, txt, start, ctl } from '../ui.js';
import { beats, kidGuesses, kidQuiz, kidChrome, dot } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(26);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, wait: '记下了。用下面的大炮试试。', text: '够快的话，它就绕着地球转，再也落不到地上。这个速度大约是每秒 8 千米。' },
  g2: { right: 1, text: '什么都不用。天上几乎没有空气，没有东西拖慢它。重力横着拉它，只改方向，不改快慢。' },
  g3: { right: 1, text: '拉着它拐弯的力没了，它就照着那一刻的方向直直飞走。和冰面上的车一样。' },
  g4: { right: 1, text: '月亮也是地球的卫星。地球的重力一直拉着它拐弯。它一直在掉，一直掉不到。' },
});

// 地球半径当 1，重力按“离得越远越小”算；炮口在 1.3 的高度。正好转圆圈的速度当成每秒 8 千米
const R0 = 1.3, VC = Math.sqrt(1 / R0);
function fly(kms) {
  const pts = []; let x = 0, y = R0, vx = VC * kms / 8, vy = 0, ang = 0, landed = false;
  const h = .004;
  for (let i = 0; i < 6000 && ang < Math.PI * 2; i++) {
    const r3 = Math.pow(x * x + y * y, 1.5); vx -= x / r3 * h; vy -= y / r3 * h;
    const a0 = Math.atan2(x, y); x += vx * h; y += vy * h; let da = Math.atan2(x, y) - a0; if (da < -3) da += Math.PI * 2; ang += da;
    if (x * x + y * y < 1) { landed = true; break; }
    if (i % 4 === 0) pts.push([x, y]);
  }
  pts.push([x, y]);
  return { pts, landed, ang };
}
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .98 : .5), maxH: 400, minH: 330 });
const s = { cur: null, n: 0, old: [], run: false, ok: false };
const sp = ctl('s1', (v) => `${v} 千米`, () => { if (!s.run) $('cap1').textContent = `炮弹的速度是每秒 ${sp.v} 千米。`; });
$('go1').addEventListener('click', () => { if (s.cur && !s.run) s.old.push(s.cur); s.cur = { ...fly(sp.v), v: sp.v }; s.n = 0; s.run = true; if (s.old.length > 4) s.old.shift(); });
c1.step = (dt) => {
  if (!s.run) return false;
  s.n = Math.min(s.cur.pts.length, s.n + dt * 75);
  if (s.n >= s.cur.pts.length) {
    s.run = false;
    if (s.cur.landed) $('cap1').textContent = `每秒 ${s.cur.v} 千米：落地了，绕过了地球的${s.cur.ang < .9 ? '一小段' : s.cur.ang < 1.8 ? '四分之一左右' : '一大段'}。再快一点呢？`;
    else { $('cap1').textContent = '每秒 8 千米：绕了一整圈，回到山顶，速度一点没少。它会一直转下去。'; if (!s.ok) { s.ok = true; B.unlock('b2', '找到了：每秒 8 千米左右。'); G.reveal('g1'); G.echo('g1', 'echo1'); } }
  }
  return true;
};
c1.draw = function (g, w, h) {
  const R = Math.min(w, h) * .3, cx = w / 2, cy = h / 2 + 12, X = (x) => cx + x * R, Y = (y) => cy - y * R;
  g.fillStyle = T.x; g.globalAlpha = .16; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill(); g.globalAlpha = 1;
  g.strokeStyle = T.x; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  txt(g, '地球', cx, cy + 5, { c: T.ink3, size: 13, a: 'center' });
  g.fillStyle = T.ink2; g.beginPath(); g.moveTo(cx - 9, Y(1) + 2); g.lineTo(cx, Y(R0) + 2); g.lineTo(cx + 9, Y(1) + 2); g.closePath(); g.fill();
  const path = (pts, n, c, lw, al) => { g.strokeStyle = c; g.lineWidth = lw; g.globalAlpha = al; g.beginPath(); for (let i = 0; i < n; i++) g.lineTo(X(pts[i][0]), Y(pts[i][1])); g.stroke(); g.globalAlpha = 1; };
  for (const o of s.old) path(o.pts, o.pts.length, T.ink3, 1.5, .6);
  if (s.cur) { const n = Math.floor(s.n); path(s.cur.pts, n, T.a, 2.5, 1); const p = s.cur.pts[Math.max(0, n - 1)]; dot(g, X(p[0]), Y(p[1]), T.a, 5); }
  else dot(g, X(0), Y(R0), T.a, 5);
  txt(g, '平着开炮 →', cx + 12, Y(R0) - 8, { c: T.ink3, size: 11.5 });
};
sp.upd();

kidQuiz(26, KGEN[26]);
start();
