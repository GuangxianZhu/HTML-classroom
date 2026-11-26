// 启 36 · 过减速带：车的一个角（车轮、弹簧、车身），压低 6 厘米松开；只有弹簧就一直晃（弹簧里存着的劲 ↔ 动能），装上减震器把晃的劲变成热
import { $, Fig, T, txt, start } from '../ui.js';
import { beats, kidGuesses, kidQuiz, kidChrome, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(36);
const B = beats();
const G = kidGuesses({
  g1: { right: 2, later: true, wait: '记下了。过一次减速带看看。', text: '一直晃。只有弹簧的话，没有谁把晃的劲拿走。' },
  g2: { right: 1, text: '像坐船。弹簧还在，减震器不干活了。晃的劲没人拿走，只能靠一点点摩擦慢慢磨掉。' },
  g3: { right: 1, text: '空气和轴上的摩擦。它们一点一点把秋千的能量变成热。没有它们，秋千能一直荡下去。' },
});
const W0 = 2 * Math.PI, ZETA = [0, .08, .35], LAST = [9, 9, 4];   // 一秒晃一个来回；三种减震器
/** 车的一个角。state：y 是车身比平时高几厘米（低了就是负的，页面上只说高了低了） */
function corner(id, onTick) {
  const fig = new Fig(id, { ratio: (w) => (w < 500 ? .8 : .4), maxH: 330, minH: 280 });
  const s = { z: 0, y: 0, v: 0, t: 0, run: false, heat: 0, pts: [], damper: false };
  fig.go = (z, damper) => Object.assign(s, { z, damper, y: -6, v: 0, t: 0, run: true, pts: [{ t: 0, v: -6 }] });
  fig.s = s;
  fig.step = (dt) => {
    if (!s.run) return false;
    const h = Math.min(dt, .05) / 8;
    for (let i = 0; i < 8; i++) { s.v += (-W0 * W0 * s.y - 2 * ZETA[s.z] * W0 * s.v) * h; s.y += s.v * h; s.t += h; }
    s.pts.push({ t: s.t, v: s.y });
    if (s.t >= LAST[s.z]) s.run = false;
    onTick(s); return true;
  };
  fig.draw = function (g, w, h) {
    const gx = Math.min(86, w * .2), gy = h - 78, sc = 3.2, top = gy - 120 - s.y * sc;   // top：车身底边
    // 车轮、地面
    g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(8, gy); g.lineTo(gx * 2 - 8, gy); g.stroke();
    g.fillStyle = '#20262c'; g.beginPath(); g.arc(gx, gy - 22, 22, 0, 6.3); g.fill(); g.fillStyle = '#9aa4ad'; g.beginPath(); g.arc(gx, gy - 22, 11, 0, 6.3); g.fill();
    // 弹簧：锯齿线，从轮轴到车身
    const y0 = gy - 44, n = 7; g.strokeStyle = T.ink2; g.lineWidth = 2.5; g.lineJoin = 'round'; g.beginPath(); g.moveTo(gx - (s.damper ? 12 : 0), y0);
    for (let i = 1; i < n * 2; i++) g.lineTo(gx - (s.damper ? 12 : 0) + (i % 2 ? 9 : -9), y0 + (top - y0) * i / (n * 2));
    g.lineTo(gx - (s.damper ? 12 : 0), top); g.stroke();
    if (s.damper) { g.strokeStyle = T.E; g.lineWidth = 3; g.beginPath(); g.moveTo(gx + 16, y0); g.lineTo(gx + 16, top); g.stroke(); g.fillStyle = T.E; rr(g, gx + 10, y0 - 30, 12, 26, 3); g.fill(); }
    g.fillStyle = T.ink2; rr(g, gx - 40, top - 30, 80, 30, 6); g.fill(); txt(g, '车身', gx, top - 10, { c: T.panel, size: 12.5, w: 700, a: 'center' });
    // 右边：车身高低记下来
    const bx = gx * 2 + 16, bw = w - bx - 30, mid = gy - 120 - 15, X = (t) => bx + bw * t / 9, Y = (y) => mid - y * 6.5;
    g.strokeStyle = T.line; g.lineWidth = 1; g.beginPath(); for (const yy of [-6, 6]) { g.moveTo(bx, Y(yy)); g.lineTo(bx + bw, Y(yy)); } g.stroke();
    g.strokeStyle = T.ink3; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(bx, Y(0)); g.lineTo(bx + bw, Y(0)); g.stroke(); g.setLineDash([]);
    txt(g, '高 6 厘米', bx + bw, Y(6) - 4, { c: T.ink3, size: 11, a: 'right' }); txt(g, '平时', bx + bw + 3, Y(0) + 4, { c: T.ink3, size: 11 }); txt(g, '低 6 厘米', bx + bw, Y(-6) + 14, { c: T.ink3, size: 11, a: 'right' });
    if (s.pts.length > 1) { g.strokeStyle = T.x; g.lineWidth = 2.5; g.beginPath(); s.pts.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.v)) : g.moveTo(X(p.t), Y(p.v)))); g.stroke(); }
    txt(g, '时间往右走 →', bx + bw, gy - 22, { c: T.ink3, size: 11.5, a: 'right' });
    // 一根条：弹簧里存着的、动能、热
    const E0 = W0 * W0 * 36, sp = W0 * W0 * s.y * s.y / E0, ke = s.v * s.v / E0, on = s.pts.length > 0, P = on ? [sp, ke, Math.max(0, 1 - sp - ke)] : [0, 0, 0];
    const ax = 14, aw = w - 28, ay = h - 34, C = [T.x, T.E, T.F], N = ['弹簧存着', '动能', '热'];
    g.fillStyle = T.line; rr(g, ax, ay, aw, 20, 4); g.fill();
    let x = ax; P.forEach((v, i) => { const ww = aw * v; if (ww > .5) { g.fillStyle = C[i]; g.fillRect(x, ay, ww, 20); if (ww > 56) txt(g, N[i], x + ww / 2, ay + 14, { c: T.panel, size: 11.5, w: 700, a: 'center' }); } x += ww; });
    txt(g, '整根条：压那一下给的能量', ax, ay - 7, { c: T.ink2, size: 12, w: 700 });
  };
  return fig;
}

// ---------------------------------------------------------------- 第 2 步
let ok1 = false;
const c1 = corner('c1', (s) => {
  $('cap1').textContent = s.run ? '压低了，弹簧往上推。冲高了，弹簧往下拉。' : '9 秒过去了，它还是晃得一样高。';
  if (s.t > 4 && !ok1) { ok1 = true; B.unlock('b2', '晃了好几秒，一点没变小。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
});
$('go1').addEventListener('click', () => c1.go(0, false));

// ---------------------------------------------------------------- 第 4 步
const seen = new Set(), SAY = ['不停', '好几下', '一下'];
const c2 = corner('c2', (s) => { if (!s.run) { seen.add(s.z); $(`n${s.z}`).textContent = SAY[s.z]; if (seen.size === 3) B.unlock('b4', '好的减震器，一下就稳住。'); } });
const btn2 = [...$('pick2').querySelectorAll('button')];
btn2.forEach((b) => b.addEventListener('click', () => { btn2.forEach((x) => x.setAttribute('aria-pressed', x === b)); c2.go(+b.dataset.v, +b.dataset.v > 0); }));

kidQuiz(36, KGEN[36]);
start();
