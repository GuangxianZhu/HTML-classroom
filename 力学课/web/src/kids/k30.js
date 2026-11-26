// 启 30 · 劲去哪了：车从 20 米高的坡顶滑到平地再刹停，一根条分三段（高处存着的劲 → 动能 → 热），总长一直是 200000 焦 → 起名字“能量” → 坡上有摩擦：记账
import { $, Fig, T, txt, start, kpis, ctl, calc } from '../ui.js';
import { carAt, beats, kidGuesses, kidQuiz, kidChrome, rr } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(30);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, wait: '记下了。滑一次，盯着那根条看。', text: '变成了热。刹车片、刹车盘、轮胎和路面都热了一点。加起来正好 200000 焦。' },
  g2: { right: 1, text: '每次落地，球被压扁再弹开，有一部分动能变成热。还有“砰”的一声，也带走一点。球和地面都热了一点点。' },
  g3: { right: 1, text: '不信。机器一转就有摩擦，能量一点点变成热。没人往里补，它迟早停下，更不会多出电来。' },
});
const H = 20, SL = 40, TOT = 200000, BRK = 10000;   // 坡高 20 米、横着 40 米；刹车时往后拖 10000 牛
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .62 : .34), maxH: 300, minH: 220 });
const s = { ph: 0, x: 0, v: 0, heat: 0, auto: false };   // ph：0 坡顶 1 下坡 2 平地滑 3 刹车 4 停住
const yAt = (x) => Math.max(0, H * (1 - x / SL));
const parts = () => { const hi = 10000 * yAt(s.x), heat = s.heat; return [hi, Math.max(0, TOT - hi - heat), heat]; };
const show = () => { const [a, b, c] = parts().map((x) => Math.round(x / 1000) * 1000); kpis('k1', [['高处存着', `${a}`, '焦', 'x'], ['动能', `${TOT - a - c}`, '焦', 'E'], ['热', `${c}`, '焦', 'F'], ['加起来', `${TOT}`, '焦']]); void b; };
const reset = () => { Object.assign(s, { ph: 0, x: 0, v: 0, heat: 0, auto: false }); $('go1').disabled = false; $('br1').disabled = true; $('cap1').textContent = '车停在坡顶，20 米高。'; show(); c1.dirty = true; };
$('go1').addEventListener('click', () => { if (s.ph === 0) { s.ph = 1; $('go1').disabled = true; $('cap1').textContent = '高度在降，动能在涨。'; } });
$('br1').addEventListener('click', () => { if (s.ph === 2) { s.ph = 3; $('br1').disabled = true; $('cap1').textContent = '刹车在把动能变成热。'; } });
$('re1').addEventListener('click', reset);
c1.step = (dt) => {
  if (s.ph === 0 || s.ph === 4) return false;
  dt = Math.min(dt, .05);
  if (s.ph === 1) {
    s.v = Math.max(1.5, Math.sqrt(20 * (H - yAt(s.x)))); s.x += s.v * dt * (SL / Math.hypot(SL, H));
    if (s.x >= SL) { s.x = SL; s.v = 20; s.ph = 2; $('br1').disabled = false; $('cap1').textContent = '到平地了，每秒 20 米。踩刹车吧。'; }
  } else if (s.ph === 2) {
    s.x += s.v * dt * .35;   // 平地上画慢一点，留出点按钮的时间
    if (s.x > 68) { s.ph = 3; s.auto = true; $('br1').disabled = true; $('cap1').textContent = '路快到头了，替你踩了刹车。'; }
  } else {
    const d = s.v * dt; s.x += d; s.heat = Math.min(TOT, s.heat + BRK * d); s.v = Math.sqrt(Math.max(0, 2 * (TOT - s.heat) / 1000));
    if (s.heat >= TOT - 1) { s.heat = TOT; s.v = 0; s.ph = 4; $('cap1').textContent = '车停住了。200000 焦全变成了热。'; B.unlock('b2', '整根条一直一样长。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  }
  show(); return true;
};
c1.draw = function (g, w, h) {
  const k = Math.min((w - 40) / 112, (h - 110) / H), x0 = 20, yb = 36 + H * k, X = (x) => x0 + x * k, Y = (y) => yb - y * k;
  g.fillStyle = T.road; g.globalAlpha = .15; g.beginPath(); g.moveTo(X(0), Y(H)); g.lineTo(X(SL), Y(0)); g.lineTo(X(0), Y(0)); g.fill(); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(X(0), Y(H)); g.lineTo(X(SL), Y(0)); g.lineTo(w, Y(0)); g.stroke();
  txt(g, '20 米高', X(0) + 2, Y(H) - 22, { c: T.ink3, size: 11.5 });
  const on = s.x < SL, ang = on ? Math.atan2(H, SL) : 0, L = 34;
  carAt(g, X(s.x) + (on ? 4 : 0), Y(yAt(s.x)) - 8, L, { rot: ang });
  if (s.ph === 3) { g.fillStyle = T.F; g.globalAlpha = .7; for (const dx of [-10, 10]) { g.beginPath(); g.arc(X(s.x) + dx, Y(0) - 3, 4, 0, 6.3); g.fill(); } g.globalAlpha = 1; txt(g, '刹车发热', X(s.x), Y(0) + 16, { c: T.F, size: 11.5, w: 700, a: 'center' }); }
  // 一根条，三段
  const bx = 14, bw = w - 28, by = h - 40, P = parts(), C = [T.x, T.E, T.F], N = ['高处存着', '动能', '热'];
  g.fillStyle = T.line; rr(g, bx, by, bw, 20, 4); g.fill();
  let x = bx;
  P.forEach((v, i) => { const ww = bw * v / TOT; if (ww > .5) { g.fillStyle = C[i]; g.fillRect(x, by, ww, 20); if (ww > 46) txt(g, N[i], x + ww / 2, by + 14, { c: T.panel, size: 11.5, w: 700, a: 'center' }); } x += ww; });
  txt(g, '整根条：200000 焦', bx, by - 7, { c: T.ink2, size: 12, w: 700 });
  txt(g, `每秒 ${Math.round(s.v)} 米`, w - 10, 20, { c: T.v, size: 13, w: 700, a: 'right' });
};
show();

// ---------------------------------------------------------------- 第 4 步
const NM = ['很滑，没有摩擦', '有一点摩擦', '摩擦很大'], HT = [0, 72000, 150000], VV = [20, 16, 10];
let ok2 = false;
const s2 = ctl('s2', (v) => NM[v], () => {
  const i = s2.v, K = TOT - HT[i];
  calc('calc2', [`坡顶存着：200000 焦`, `路上变成热：<b>${HT[i]} 焦</b>`, `到底的动能 = 200000 − ${HT[i]} = <b>${K} 焦</b>`, `车速：每秒 <b>${VV[i]} 米</b>`, `验算：1000 × ${VV[i]} × ${VV[i]} ÷ 2 = ${K}`]);
  if (i === 2 && !ok2) { ok2 = true; B.unlock('b4', '150000 焦变成了热，到底只有每秒 10 米。'); }
});
s2.upd();

kidQuiz(30, KGEN[30]);
start();
