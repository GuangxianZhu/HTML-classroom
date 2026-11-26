// 启 20 · 上坡：坡的陡度说成“走 10 米升高几米” → 重力里沿坡往下拉的那一份 = 重力的十分之几 → 轮胎抓不抓得住 → 稳稳上坡要多大的力
import { $, Fig, T, txt, start, kpis, ctl, seg } from '../ui.js';
import { carAt, farrow, ease, beats, kidGuesses, kidQuiz, kidChrome } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(20);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, text: '坡越陡，往下拉的力越大。可它只是重力的一部分，另一部分被坡面托住了。' },
  g2: { right: 0, text: '速度不变，说明往前推的和往下拉的正好抵掉：2000 牛。比它大，车会越开越快。' },
  g3: { right: 1, text: '车重了一倍，重力是 20000 牛。还是十分之几的那个比例，往下拉的力也是 2 倍。' },
});
const W = 10000, pull = (hh) => W * hh / 10;

/**
 * 画一个坡和坡上的车。hh = 走 10 米升高几米；at = 车在坡上的位置（0 坡底，1 坡顶）。
 * 返回 { cx, cy, ux, uy }：车的中心、沿坡往上的方向。
 */
function slope(g, w, h, hh, at = .55) {
  const U = Math.min(90, h * .28), yb = h - U - 4, ang = Math.asin(hh / 10), Lp = Math.min(w - 110, 470, (yb - 64) * 2);
  const x0 = (w - Lp * Math.cos(ang)) / 2 - 10, x1 = x0 + Lp * Math.cos(ang), y1 = yb - Lp * Math.sin(ang);
  g.fillStyle = T.road; g.globalAlpha = .16; g.beginPath(); g.moveTo(x0, yb); g.lineTo(x1, yb); g.lineTo(x1, y1); g.closePath(); g.fill(); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 - 40, yb); g.lineTo(x1 + 30, yb); g.moveTo(x0, yb); g.lineTo(x1, y1); g.stroke();
  g.setLineDash([4, 4]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x1, yb); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
  if (hh > 0) txt(g, `升高 ${hh} 米`, x1 + 6, (yb + y1) / 2 + 4, { c: T.ink2, size: 12.5 });
  txt(g, '沿着坡走 10 米', x0 - 36, yb + 20, { c: T.ink2, size: 12.5 });
  const ux = Math.cos(ang), uy = -Math.sin(ang), L = Math.min(92, Lp * .22);
  const px = x0 + Lp * at * ux, py = yb + Lp * at * uy;            // 车轮压着的那一点
  const cx = px + uy * L * .2, cy = py - ux * L * .2;              // 往坡面外抬一点，就是车的中心
  carAt(g, cx, cy, L, { rot: -ang });
  // 车尾、车头两个点（沿坡的力从这两头画，不被车身挡住），nx/ny 是离开坡面的方向
  return { cx, cy, ux, uy, L, U, nx: uy, ny: -ux, rear: [cx - ux * L * .56, cy - uy * L * .56], front: [cx + ux * L * .56, cy + uy * L * .56] };
}
/** 沿坡的力：从车尾往下（dir = -1）或从车头往上（dir = 1）画，字写在箭头上方 */
function along(g, S, dir, len, label) {
  const [x, y] = dir < 0 ? S.rear : S.front;
  farrow(g, x, y, dir * S.ux, dir * S.uy, len, '');
  const tx = x + S.nx * 26, ty = y + S.ny * 26 + 4;
  txt(g, label, dir < 0 ? Math.max(tx, 108) : tx, ty, { c: T.F, size: 12.5, w: 700, a: dir < 0 ? 'right' : 'left' });
}

// ---------------------------------------------------------------- 第 2 步
const c1 = new Fig('c1', { ratio: (w) => (w < 500 ? .86 : .46), maxH: 360, minH: 290 });
let ok1 = false;
const s1 = ctl('s1', (v) => `${v} 米`, () => {
  const p = pull(s1.v);
  kpis('k1', [['重力', `${W}`, '牛', 'F'], ['沿坡往下拉', `${p}`, '牛', 'F'], ['是重力的', s1.v ? `十分之 ${s1.v}` : '0', '']]);
  if (!ok1 && s1.v === 3) { ok1 = true; B.unlock('b2', '找到了：走 10 米升高 3 米。'); G.reveal('g1'); G.echo('g1', 'echo1'); }
  c1.dirty = true;
});
c1.draw = function (g, w, h) {
  const S = slope(g, w, h, s1.v), U = S.U;
  farrow(g, S.cx, S.cy, 0, 1, U, '');
  txt(g, `重力 ${W} 牛`, S.cx + 9, S.cy + U * .72, { c: T.F, size: 12.5, w: 700 });
  if (s1.v > 0) along(g, S, -1, U * s1.v / 10, `往下拉 ${pull(s1.v)} 牛`);
  else txt(g, '平地：没有往下拉的力', S.cx, S.cy - S.L * .5, { c: T.ink3, size: 12.5, a: 'center' });
};
s1.upd();

// ---------------------------------------------------------------- 第 4 步：轮胎抓不抓得住
const ROADS = { 8000: '干路', 4000: '湿路', 1000: '冰面' };
const c2 = new Fig('c2', { ratio: (w) => (w < 500 ? .86 : .46), maxH: 360, minH: 290 });
const s = { at: .7, v: 0, state: 'idle' };                                    // idle | hold | slide | bottom
let ok2 = false;
const rd = seg('road2', () => reset2()), s2 = ctl('s2', (v) => `${v} 米`, () => reset2());
function reset2() { Object.assign(s, { at: .7, v: 0, state: 'idle' }); $('cap2').textContent = `${ROADS[rd.v]}，走 10 米升高 ${s2.v} 米。往下拉的力是 ${pull(s2.v)} 牛。`; c2.dirty = true; }
$('go2').addEventListener('click', () => {
  const p = pull(s2.v), grip = +rd.v, name = ROADS[rd.v];
  Object.assign(s, { at: .7, v: 0 });
  if (p <= grip) {
    s.state = 'hold';
    let m = p === grip ? `刚好停住：往下拉 ${p} 牛，轮胎最多抓 ${grip} 牛。` : `停住了：往下拉 ${p} 牛，轮胎最多能抓 ${grip} 牛。`;
    if (grip === 1000 && s2.v === 1) { m += '冰面上最陡就是这个坡。'; if (!ok2) { ok2 = true; B.unlock('b4', '找到了。'); } }
    else if (grip === 1000) m += '冰面上还能再陡一点吗？';
    else m += `这是${name}。换成冰面再找。`;
    $('cap2').textContent = m;
  } else { s.state = 'slide'; $('cap2').textContent = `溜下去了！往下拉 ${p} 牛，轮胎最多只能抓 ${grip} 牛。${grip === 1000 ? '坡太陡，调平一点。' : ''}`; }
  c2.dirty = true;
});
c2.step = (dt) => {
  if (s.state !== 'slide') return false;
  s.v += (pull(s2.v) - +rd.v) / 9000 * dt; s.at -= s.v * dt;
  if (s.at <= .12) { s.at = .12; s.state = 'bottom'; }
  return true;
};
c2.draw = function (g, w, h) {
  const S = slope(g, w, h, s2.v, s.at), p = pull(s2.v), k = Math.min(100, w * .19) / 5000;   // 这张图只画沿坡的力，画大一点
  if (p > 0) along(g, S, -1, p * k, `往下拉 ${p} 牛`);
  if (s.state === 'hold' && p > 0) along(g, S, 1, p * k, `轮胎抓住 ${p} 牛`);
  if (s.state === 'slide' || s.state === 'bottom') along(g, S, 1, +rd.v * k, `轮胎只抓 ${rd.v} 牛`);
};
reset2();

kidQuiz(20, KGEN[20]);
start();
