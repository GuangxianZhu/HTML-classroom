// 每张图一个类。图只在屏幕里时才动，离开屏幕就停；加载时全部画一帧，静止时也完整。
// 数字都从 physics.js 来；这里只管画和接滑块。
import * as P from './physics.js';

const { TAU, clamp, rad, kmh, ms } = P;
const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const T = {};
const NAMES = ['panel', 'panel2', 'ink', 'ink2', 'ink3', 'line', 'F', 'T', 'n', 'v', 'P', 'grip', 'drag', 'ok', 'no'];
const figs = [];
const FONT = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
const NUM = '"Barlow Condensed","Arial Narrow",sans-serif';
const AIR = '#79A7CC', FUEL = '#D2742C';

function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  for (const n of NAMES) T[n] = cs.getPropertyValue(`--${n}`).trim();
  figs.forEach((f) => { f.dirty = true; });
}

const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { e.target._fig.visible = e.isIntersecting; }), { rootMargin: '60px' }) : null;

class Fig {
  constructor(id, { ratio = .62, maxH = 420, minH = 200 } = {}) {
    this.c = $(id); this.g = this.c.getContext('2d'); this.ratio = ratio; this.maxH = maxH; this.minH = minH;
    this.visible = true; this.dirty = true; this.c._fig = this;
    if (io) io.observe(this.c);
    if (window.ResizeObserver) new ResizeObserver(() => { if (this.size()) this.dirty = true; }).observe(this.c.parentElement);
    figs.push(this);
  }
  size() {
    const w = this.c.parentElement.clientWidth - 20;
    if (w <= 0) return false;
    const ratio = typeof this.ratio === 'function' ? this.ratio(w) : this.ratio;
    const h = clamp(Math.round(w * ratio), this.minH, this.maxH);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.w === w && this.h === h) return false;
    this.w = w; this.h = h; this.c.style.height = `${h}px`;
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); this.dpr = dpr;
    return true;
  }
  render() {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.fillStyle = T.panel; g.fillRect(0, 0, this.w, this.h);
    this.draw(g, this.w, this.h);
  }
  step() { return false; }
}

// -------------------------------------------------------------- 小工具
const f0 = (x) => Math.round(x).toString(), f1 = (x) => (+x).toFixed(1), f2 = (x) => (+x).toFixed(2);
const Q = (c, s) => `<span class="q${c}">${s}</span>`;
const calc = (id, lines) => { const h = lines.map((l) => `<div>${l}</div>`).join(''); if ($(id).innerHTML !== h) $(id).innerHTML = h; };
const kpis = (id, items) => { $(id).innerHTML = items.map(([k, v, u, c]) => `<div class="kpi"><span>${k}</span><b${c ? ` class="q${c}"` : ''}>${v}</b><small>${u || ''}</small></div>`).join(''); };
function ctl(id, fmt, cb) {
  const el = $(id), out = $(`${id}o`);
  const upd = () => { out.textContent = fmt(+el.value); cb?.(); };
  el.addEventListener('input', upd);
  out.textContent = fmt(+el.value);              // 先把读数写上；回调要等后面的滑块都建好才能跑
  return { get v() { return +el.value; }, set(v) { el.value = v; upd(); }, el, upd };
}
function txt(g, s, x, y, { c = T.ink, size = 13, w = 500, a = 'left', b = 'alphabetic', f = FONT } = {}) {
  if (f === NUM && /[\u4e00-\u9fff]/.test(s)) { f = FONT; size *= .9; }       // 窄体数字字体里没有汉字，换回正文字体
  if (s.includes('·')) f = `"Helvetica Neue",Arial,"Liberation Sans","DejaVu Sans",${f}`;   // 中文字体把“·”画成全角，N·m 会被撑开
  g.fillStyle = c; g.font = `${w} ${size}px ${f}`; g.textAlign = a; g.textBaseline = b; g.fillText(s, x, y);
}
function arrow(g, x0, y0, x1, y1, c, lw = 3, head = 9) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.strokeStyle = c; g.fillStyle = c; g.lineWidth = lw; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 - Math.cos(a) * head * .6, y1 - Math.sin(a) * head * .6); g.stroke();
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - head * Math.cos(a - .45), y1 - head * Math.sin(a - .45)); g.lineTo(x1 - head * Math.cos(a + .45), y1 - head * Math.sin(a + .45)); g.closePath(); g.fill();
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
/** 齿轮：中心、节圆半径、齿数、转角 */
function gear(g, cx, cy, r, z, th, fill, edge) {
  const ad = Math.min(r * .16, 7), p = TAU / z;
  g.beginPath();
  for (let k = 0; k < z; k++) {
    const a = th + k * p;
    const pts = [[a - p * .5, r - ad], [a - p * .28, r - ad], [a - p * .17, r + ad], [a + p * .17, r + ad], [a + p * .28, r - ad], [a + p * .5, r - ad]];
    pts.forEach(([b, R], i) => { const x = cx + R * Math.cos(b), y = cy + R * Math.sin(b); if (k === 0 && i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
  }
  g.closePath(); g.fillStyle = fill; g.fill(); g.strokeStyle = edge; g.lineWidth = 1; g.stroke();
  g.beginPath(); g.arc(cx, cy, Math.max(4, r * .2), 0, TAU); g.fillStyle = T.panel; g.fill(); g.stroke();
  g.strokeStyle = edge; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + r * .25 * Math.cos(th), cy + r * .25 * Math.sin(th)); g.lineTo(cx + r * .8 * Math.cos(th), cy + r * .8 * Math.sin(th)); g.stroke();
}
/** 坐标轴：返回 X(x)、Y(y)，以及 Y2(y) 给右边的第二根轴 */
function axes(g, box, o) {
  const { x, y, w, h } = box, X = (v) => x + (v - (o.x0 || 0)) / (o.xmax - (o.x0 || 0)) * w, Y = (v) => y + h - v / o.ymax * h;
  g.lineWidth = 1; g.strokeStyle = T.line; g.beginPath();
  for (let v = o.x0 || 0; v <= o.xmax + 1e-9; v += o.xstep) { g.moveTo(X(v), y); g.lineTo(X(v), y + h); }
  for (let v = 0; v <= o.ymax + 1e-9; v += o.ystep) { g.moveTo(x, Y(v)); g.lineTo(x + w, Y(v)); }
  g.stroke();
  for (let v = o.x0 || 0; v <= o.xmax + 1e-9; v += o.xstep * (o.xlabEvery || 1)) txt(g, o.xfmt ? o.xfmt(v) : f0(v), X(v), y + h + 14, { c: T.ink3, size: 11, a: 'center', f: NUM });
  for (let v = 0; v <= o.ymax + 1e-9; v += o.ystep) txt(g, o.yfmt ? o.yfmt(v) : f0(v), x - 5, Y(v) + 4, { c: o.yc || T.ink3, size: 11, a: 'right', f: NUM });
  txt(g, o.xlab, x + w, y + h + 28, { c: T.ink3, size: 11.5, a: 'right' });
  txt(g, o.ylab, x - 4, y - 8, { c: o.yc || T.ink3, size: 11.5, a: 'left' });
  let Y2 = null;
  if (o.y2max) {
    Y2 = (v) => y + h - v / o.y2max * h;
    for (let v = 0; v <= o.y2max + 1e-9; v += o.y2step) txt(g, f0(v), x + w + 5, Y2(v) + 4, { c: o.y2c, size: 11, f: NUM });
    txt(g, o.y2lab, x + w + 4, y - 8, { c: o.y2c, size: 11.5, a: 'right' });
  }
  return { X, Y, Y2 };
}
function curve(g, f, x0, x1, X, Y, box, { c, lw = 2.5, dash = null, alpha = 1, n = 160 } = {}) {
  g.save(); g.beginPath(); g.rect(box.x, box.y - 2, box.w, box.h + 2); g.clip();
  g.strokeStyle = c; g.lineWidth = lw; g.globalAlpha = alpha; g.setLineDash(dash || []); g.lineJoin = 'round';
  g.beginPath();
  let pen = false;
  for (let k = 0; k <= n; k++) {
    const xv = x0 + (x1 - x0) * k / n, yv = f(xv);
    if (!Number.isFinite(yv)) { pen = false; continue; }
    const px = X(xv), py = Math.max(box.y - 40, Y(yv));
    if (pen) g.lineTo(px, py); else { g.moveTo(px, py); pen = true; }
  }
  g.stroke(); g.restore();
}
const dot = (g, x, y, c, r = 5) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = c; g.fill(); g.strokeStyle = T.panel; g.lineWidth = 2; g.stroke(); };
const plotBox = (w, h, l = 46, r = 14, t = 26, b = 34) => ({ x: l, y: t, w: w - l - r, h: h - t - b });
function vline(g, x, box, c = T.ink3) { g.strokeStyle = c; g.lineWidth = 1; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(x, box.y); g.lineTo(x, box.y + box.h); g.stroke(); g.setLineDash([]); }
function labelOn(g, s, x, y, c, a = 'left') { txt(g, s, x, y, { c, size: 12, w: 700, a }); }

// ============================================================== 开头：一整串
const CAR = P.CAR, NMAX = 6000, TMAXP = P.tqWot(NMAX), PMAX = TMAXP * rad(NMAX);
const hero = new Fig('h', { ratio: (w) => (w < 560 ? .9 : .4), maxH: 330, minH: 230 });
hero.ang = 0;
const hI = ctl('h-i', (v) => `${f1(v)} 倍`, () => { hero.dirty = true; heroCap(); });
function heroNums() {
  const i = hI.v, Tw = TMAXP * i * CAR.eta, nw = NMAX / i, v = P.wheelSpeed(nw, CAR.r), F = Tw / CAR.r;
  return { i, Tw, nw, v, F, Pw: F * v };
}
function heroCap() {
  const q = heroNums();
  $('h-cap').innerHTML = `发动机守在 ${NMAX} rpm、${f0(TMAXP)} N·m（${f1(PMAX / 1000)} kW）。减速比 ${f1(q.i)}：车轮 ${Q('T', `${f0(q.Tw)} N·m`)}、${Q('n', `${f0(q.nw)} rpm`)}，推地面 ${Q('F', `${f0(q.F)} N`)}，车速 ${Q('v', `${f0(kmh(q.v))} km/h`)}。拖一拖：推力和车速此消彼长，乘起来一直是 ${Q('P', `${f1(q.Pw / 1000)} kW`)}（扣掉一路上 16% 的损失）。车速是“发动机守在 6000 rpm 时车轮对应的速度”，真能不能跑到要看阻力，第 5 步再说。`;
}
hero.step = function (dt) { this.ang += dt * rad(NMAX) / 300; return true; };
hero.draw = function (g, w, h) {
  if (w < 560) { heroNarrow.call(this, g, w, h); return; }
  const q = heroNums(), cy = h * .42, Rw = Math.min(h * .27, w * .1), ground = cy + Rw;
  // 发动机
  const ex = w * .03, ew = w * .17, eh = h * .36;
  rr(g, ex, cy - eh / 2, ew, eh, 6); g.fillStyle = T.panel2; g.fill(); g.strokeStyle = T.line; g.stroke();
  txt(g, '发动机', ex + ew / 2, cy - eh / 2 + 18, { c: T.ink2, size: 13, w: 700, a: 'center' });
  txt(g, `${f0(TMAXP)} N·m`, ex + ew / 2, cy + 4, { c: T.T, size: 15, w: 700, a: 'center', f: NUM });
  txt(g, `${NMAX} rpm`, ex + ew / 2, cy + 22, { c: T.n, size: 15, w: 700, a: 'center', f: NUM });
  // 齿轮：小的不变，大的跟减速比走（太大就按开方缩一点，好画）
  const r1 = Math.min(h * .11, w * .045), r2 = r1 * clamp(Math.sqrt(q.i) * 1.05, 1.4, 3.2);
  const gx1 = w * .3, gx2 = gx1 + r1 + r2;
  g.strokeStyle = T.ink3; g.lineWidth = 4; g.beginPath(); g.moveTo(ex + ew, cy); g.lineTo(gx1, cy); g.stroke();
  const z1 = 12, z2 = Math.round(z1 * r2 / r1);
  gear(g, gx1, cy, r1, z1, this.ang, T.panel2, T.ink3);
  gear(g, gx2, cy, r2, z2, -this.ang * z1 / z2 + Math.PI + Math.PI / z2, T.panel2, T.ink3);
  txt(g, `× ${f1(q.i)}`, (gx1 + gx2) / 2, cy - r2 - 10, { c: T.ink2, size: 14, w: 700, a: 'center', f: NUM });
  // 车轮
  const wx = w * .78;
  g.strokeStyle = T.ink3; g.lineWidth = 4; g.beginPath(); g.moveTo(gx2, cy); g.lineTo(wx, cy); g.stroke();
  txt(g, `${f0(q.Tw)} N·m`, (gx2 + wx) / 2 + 6, cy - 10, { c: T.T, size: 15, w: 700, a: 'center', f: NUM });
  txt(g, `${f0(q.nw)} rpm`, (gx2 + wx) / 2 + 6, cy + 20, { c: T.n, size: 15, w: 700, a: 'center', f: NUM });
  const wa = -this.ang / q.i;
  g.beginPath(); g.arc(wx, cy, Rw, 0, TAU); g.fillStyle = T.ink2; g.fill();
  g.beginPath(); g.arc(wx, cy, Rw * .62, 0, TAU); g.fillStyle = T.panel2; g.fill();
  g.strokeStyle = T.ink3; g.lineWidth = 3;
  for (let k = 0; k < 5; k++) { const a = wa + k * TAU / 5; g.beginPath(); g.moveTo(wx, cy); g.lineTo(wx + Rw * .6 * Math.cos(a), cy + Rw * .6 * Math.sin(a)); g.stroke(); }
  // 路面：往后走
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(w * .52, ground); g.lineTo(w, ground); g.stroke();
  const per = 26, off = ((-wa * Rw) % per + per) % per;
  g.lineWidth = 3; g.strokeStyle = T.line;
  for (let x = w * .52 + per - off; x < w; x += per) { g.beginPath(); g.moveTo(x, ground + 5); g.lineTo(x - 10, ground + 5); g.stroke(); }
  arrow(g, wx - Rw * .1, ground - 2, wx - Rw * .1 - clamp(q.F / 6800, .12, 1) * w * .14, ground - 2, T.F, 4);
  txt(g, `推地面 ${f0(q.F)} N`, wx - Rw * .1 - w * .02, ground - 12, { c: T.F, size: 13, w: 700, a: 'right' });
  arrow(g, wx + Rw + 8, cy - Rw * .55, wx + Rw + 8 + clamp(kmh(q.v) / 290, .12, 1) * w * .12, cy - Rw * .55, T.v, 4);
  txt(g, `${f0(kmh(q.v))} km/h`, wx + Rw + 8, cy - Rw * .55 - 10, { c: T.v, size: 15, w: 700, f: NUM });
  // 功率带：一路上一样宽，只在齿轮那里窄一点（损失）
  const by = h * .86, bh = h * .07, k2 = CAR.eta;
  g.fillStyle = T.P; g.globalAlpha = .9;
  g.beginPath(); g.moveTo(ex, by - bh / 2); g.lineTo(gx2, by - bh / 2); g.lineTo(gx2 + 30, by - bh / 2 * k2); g.lineTo(w - 10, by - bh / 2 * k2);
  g.lineTo(w - 10, by + bh / 2 * k2); g.lineTo(gx2 + 30, by + bh / 2 * k2); g.lineTo(gx2, by + bh / 2); g.lineTo(ex, by + bh / 2); g.closePath(); g.fill(); g.globalAlpha = 1;
  txt(g, `功率 ${f1(PMAX / 1000)} kW`, ex + 6, by + 4, { c: T.panel, size: 12.5, w: 700 });
  txt(g, `到路面 ${f1(q.Pw / 1000)} kW = 力 × 速度`, w - 16, by + 4, { c: T.panel, size: 12.5, w: 700, a: 'right' });
};

/** 手机上：第一行发动机和齿轮，第二行车轮和路面，最下面功率带 */
function heroNarrow(g, w, h) {
  const q = heroNums(), y1 = h * .24, ex = 4, ew = w * .3, eh = h * .26;
  rr(g, ex, y1 - eh / 2, ew, eh, 6); g.fillStyle = T.panel2; g.fill(); g.strokeStyle = T.line; g.stroke();
  txt(g, '发动机', ex + ew / 2, y1 - eh / 2 + 16, { c: T.ink2, size: 12, w: 700, a: 'center' });
  txt(g, `${f0(TMAXP)} N·m`, ex + ew / 2, y1 + 6, { c: T.T, size: 14, w: 700, a: 'center', f: NUM });
  txt(g, `${NMAX} rpm`, ex + ew / 2, y1 + 23, { c: T.n, size: 14, w: 700, a: 'center', f: NUM });
  const r1 = h * .07, r2 = r1 * clamp(Math.sqrt(q.i) * 1.05, 1.4, 2.6), gx1 = ew + 16 + r1, gx2 = gx1 + r1 + r2;
  g.strokeStyle = T.ink3; g.lineWidth = 3; g.beginPath(); g.moveTo(ex + ew, y1); g.lineTo(gx1, y1); g.stroke();
  const z1 = 10, z2 = Math.round(z1 * r2 / r1);
  gear(g, gx1, y1, r1, z1, this.ang, T.panel2, T.ink3);
  gear(g, gx2, y1, r2, z2, -this.ang * z1 / z2 + Math.PI + Math.PI / z2, T.panel2, T.ink3);
  txt(g, `× ${f1(q.i)}`, gx2, y1 - r2 - 6, { c: T.ink2, size: 13, w: 700, a: 'center', f: NUM });
  // 第二行：大齿轮往下一根轴到车轮
  const Rw = h * .13, wx = gx2, cy = h * .6, ground = cy + Rw;
  g.strokeStyle = T.ink3; g.lineWidth = 3; g.beginPath(); g.moveTo(gx2, y1); g.lineTo(wx, cy); g.stroke();
  txt(g, `${f0(q.Tw)} N·m`, wx - Rw - 10, cy - 6, { c: T.T, size: 14, w: 700, a: 'right', f: NUM });
  txt(g, `${f0(q.nw)} rpm`, wx - Rw - 10, cy + 12, { c: T.n, size: 14, w: 700, a: 'right', f: NUM });
  const wa = -this.ang / q.i;
  g.beginPath(); g.arc(wx, cy, Rw, 0, TAU); g.fillStyle = T.ink2; g.fill();
  g.beginPath(); g.arc(wx, cy, Rw * .62, 0, TAU); g.fillStyle = T.panel2; g.fill();
  g.strokeStyle = T.ink3; g.lineWidth = 2.5;
  for (let k = 0; k < 5; k++) { const a = wa + k * TAU / 5; g.beginPath(); g.moveTo(wx, cy); g.lineTo(wx + Rw * .6 * Math.cos(a), cy + Rw * .6 * Math.sin(a)); g.stroke(); }
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, ground); g.lineTo(w, ground); g.stroke();
  const per = 22, off = ((-wa * Rw) % per + per) % per;
  g.lineWidth = 3; g.strokeStyle = T.line;
  for (let x = per - off; x < w; x += per) { g.beginPath(); g.moveTo(x, ground + 5); g.lineTo(x - 9, ground + 5); g.stroke(); }
  arrow(g, wx - 4, ground - 3, wx - 4 - clamp(q.F / 6800, .15, 1) * w * .3, ground - 3, T.F, 4);
  txt(g, `推地面 ${f0(q.F)} N`, 6, ground + 22, { c: T.F, size: 13, w: 700 });
  arrow(g, wx + Rw + 6, cy - Rw * .4, wx + Rw + 6 + clamp(kmh(q.v) / 290, .15, 1) * (w - wx - Rw - 14), cy - Rw * .4, T.v, 4);
  txt(g, `${f0(kmh(q.v))} km/h`, w - 4, cy - Rw * .4 - 8, { c: T.v, size: 14, w: 700, a: 'right', f: NUM });
  const by = h * .93, bh = h * .065;
  rr(g, 4, by - bh / 2, w - 8, bh, 3); g.fillStyle = T.P; g.fill();
  txt(g, `${f1(PMAX / 1000)} kW → 到路面 ${f1(q.Pw / 1000)} kW`, w / 2, by + 4, { c: T.panel, size: 12, w: 700, a: 'center' });
}

// ============================================================== 1 扳手
const fg1 = new Fig('f1', { ratio: .6, maxH: 380 });
fg1.turn = 0;
const s1F = ctl('f1-F', (v) => `${f0(v)} N`, () => upd1());
const s1r = ctl('f1-r', (v) => `${f2(v)} m`, () => upd1());
function upd1() {
  const Tq = P.torque(s1F.v, s1r.v), ok = Tq >= P.BOLT;
  calc('f1-c', [`${Q('T', 'T')} = ${Q('F', 'F')} × 力臂 = ${s1F.v} N × ${f2(s1r.v)} m = <b class="qT">${f0(Tq)} N·m</b>`,
    `<span class="note">${ok ? `够 ${P.BOLT} N·m 了，螺栓拧动了。` : `还差 ${f0(P.BOLT - Tq)} N·m：用更大的力，或者握得更靠外。`}</span>`]);
  fg1.dirty = true;
}
fg1.step = function (dt) {
  const ok = P.torque(s1F.v, s1r.v) >= P.BOLT;
  if (ok) { this.turn += dt * .9; if (this.turn > .75) this.turn = 0; return true; }
  if (this.turn) { this.turn = 0; return true; }
  return false;
};
fg1.draw = function (g, w, h) {
  const F = s1F.v, r = s1r.v, Tq = F * r, cx = w * .14, cy = h * .4, L = .47, s = (w * .8) / L;
  const a = this.turn;                               // 扳手往下转的角度
  g.save(); g.translate(cx, cy); g.rotate(a);
  // 螺栓（六角）
  g.beginPath(); for (let k = 0; k < 6; k++) { const b = k * TAU / 6; g.lineTo(18 * Math.cos(b), 18 * Math.sin(b)); } g.closePath();
  g.fillStyle = T.ink3; g.fill();
  // 扳手
  rr(g, -26, -13, L * s + 26, 26, 13); g.fillStyle = T.panel2; g.fill(); g.strokeStyle = T.ink3; g.lineWidth = 1.5; g.stroke();
  g.beginPath(); g.arc(0, 0, 26, 0, TAU); g.fillStyle = T.panel2; g.fill(); g.stroke();
  g.beginPath(); for (let k = 0; k < 6; k++) { const b = k * TAU / 6; g.lineTo(13 * Math.cos(b), 13 * Math.sin(b)); } g.closePath(); g.fillStyle = T.ink3; g.fill();
  // 手
  const hx = r * s;
  g.beginPath(); g.ellipse(hx, 0, 18, 22, 0, 0, TAU); g.fillStyle = T.ink2; g.globalAlpha = .25; g.fill(); g.globalAlpha = 1;
  // 力：往下压
  const al = clamp(F / 500, .1, 1) * h * .38;
  arrow(g, hx, -al - 6, hx, -6, T.F, 4, 11);
  txt(g, `力 ${F} N`, hx + 10, -al / 2 - 6, { c: T.F, size: 14, w: 700 });
  // 力臂
  g.strokeStyle = T.ink3; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 30); g.lineTo(hx, 30); g.moveTo(0, 24); g.lineTo(0, 36); g.moveTo(hx, 24); g.lineTo(hx, 36); g.stroke();
  txt(g, `力臂 ${f2(r)} m`, hx / 2, 48, { c: T.ink2, size: 13, a: 'center' });
  g.restore();
  // 扭矩：螺栓上一段弧，越长扭矩越大
  const sweep = clamp(Tq / 150, .05, 1) * Math.PI * 1.4;
  g.strokeStyle = T.T; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.arc(cx, cy, 46, Math.PI * .75 - sweep, Math.PI * .75); g.stroke();
  const ea = Math.PI * .75 - sweep;
  arrow(g, cx + 46 * Math.cos(ea + .15), cy + 46 * Math.sin(ea + .15), cx + 46 * Math.cos(ea), cy + 46 * Math.sin(ea), T.T, 5, 12);
  txt(g, `扭矩 ${f0(Tq)} N·m`, cx - 4, cy + 80, { c: T.T, size: 15, w: 700, a: 'left' });
  // 底下一根条：拧动要多少
  const bx = w * .1, bw = w * .8, by = h * .86, sc = bw / 225;
  rr(g, bx, by - 7, bw, 14, 7); g.fillStyle = T.panel2; g.fill();
  rr(g, bx, by - 7, Math.min(Tq, 225) * sc, 14, 7); g.fillStyle = Tq >= P.BOLT ? T.ok : T.T; g.fill();
  g.strokeStyle = T.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(bx + P.BOLT * sc, by - 12); g.lineTo(bx + P.BOLT * sc, by + 12); g.stroke();
  txt(g, `拧动要 ${P.BOLT} N·m`, bx + P.BOLT * sc + 6, by - 12, { c: T.ink2, size: 12 });
  txt(g, Tq >= P.BOLT ? '转了' : '拧不动', bx, by - 12, { c: Tq >= P.BOLT ? T.ok : T.ink3, size: 12, w: 700 });
};

// ============================================================== 2 车轮
const fg2 = new Fig('f2', { ratio: .55, maxH: 340 });
fg2.ang = 0; fg2.road = 0;
const s2n = ctl('f2-n', (v) => `${f0(v)} rpm`, () => upd2());
const s2r = ctl('f2-r', (v) => `${f2v(v)} m`, () => upd2());
function f2v(v) { return (+v).toFixed(3).replace(/0$/, ''); }
function upd2() {
  const v = P.wheelSpeed(s2n.v, s2r.v);
  calc('f2-c', [`${Q('v', 'v')} = ${Q('n', '转速')} ÷ 60 × 2π × r = ${s2n.v} ÷ 60 × 6.283 × ${f2v(s2r.v)} = <b class="qv">${f1(v)} m/s</b>`,
    `<span class="note">× 3.6 =</span> <b class="qv">${f0(kmh(v))} km/h</b><span class="note">　　车轮转一圈走 2πr = ${f2(TAU * s2r.v)} m</span>`]);
  fg2.dirty = true;
}
fg2.step = function (dt) { const w = rad(s2n.v); this.ang += w * dt / 20; this.road += w * s2r.v * dt / 20; return s2n.v > 0; };
fg2.draw = function (g, w, h) {
  const r = s2r.v, ground = h * .82, R = h * .26 * r / .30, s = R / r, cx = w * .42, cy = ground - R;
  // 路
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, ground); g.lineTo(w, ground); g.stroke();
  const per = 0.5 * s, off = ((this.road * s) % per + per) % per;
  g.strokeStyle = T.line; g.lineWidth = 4;
  for (let x = -off; x < w; x += per) { g.beginPath(); g.moveTo(x, ground + 8); g.lineTo(x + per * .45, ground + 8); g.stroke(); }
  // 轮
  g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fillStyle = T.ink2; g.fill();
  g.beginPath(); g.arc(cx, cy, R * .7, 0, TAU); g.fillStyle = T.panel2; g.fill();
  g.strokeStyle = T.ink3; g.lineWidth = 3;
  for (let k = 0; k < 6; k++) { const a = this.ang + k * TAU / 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * .68 * Math.cos(a), cy + R * .68 * Math.sin(a)); g.stroke(); }
  g.strokeStyle = T.F; g.lineWidth = 4; g.beginPath(); g.moveTo(cx + R * .72 * Math.cos(this.ang), cy + R * .72 * Math.sin(this.ang)); g.lineTo(cx + R * Math.cos(this.ang), cy + R * Math.sin(this.ang)); g.stroke();
  g.beginPath(); g.arc(cx, cy, 6, 0, TAU); g.fillStyle = T.ink; g.fill();
  // 半径
  g.strokeStyle = T.ink; g.lineWidth = 1; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, ground); g.stroke(); g.setLineDash([]);
  txt(g, `半径 r = ${f2v(r)} m`, cx, ground + 26, { c: T.ink2, size: 12, a: 'center' });
  // 转速和车速
  g.strokeStyle = T.n; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, R + 12, -Math.PI * .95, -Math.PI * .35); g.stroke();
  const ea = -Math.PI * .35; arrow(g, cx + (R + 12) * Math.cos(ea - .12), cy + (R + 12) * Math.sin(ea - .12), cx + (R + 12) * Math.cos(ea), cy + (R + 12) * Math.sin(ea), T.n, 4, 11);
  txt(g, `${f0(s2n.v)} rpm`, cx - R - 8, cy - R - 2, { c: T.n, size: 16, w: 700, a: 'right', f: NUM });
  const v = P.wheelSpeed(s2n.v, r);
  arrow(g, cx + R + 18, cy, cx + R + 18 + clamp(v / 45, .05, 1) * w * .3, cy, T.v, 5, 13);
  txt(g, `${f0(kmh(v))} km/h`, cx + R + 22, cy - 12, { c: T.v, size: 20, w: 700, f: NUM });
  txt(g, `${f1(v)} m/s`, cx + R + 22, cy + 26, { c: T.v, size: 13 });
  txt(g, '画面放慢 20 倍', w - 8, 16, { c: T.ink3, size: 11.5, a: 'right' });
};

// ============================================================== 3 卷扬机
const f3 = new Fig('f3', { ratio: .62, maxH: 380 });
f3.y = 0; f3.ang = 0;
const RD = 0.10;
const s3m = ctl('f3-m', (v) => `${f0(v)} kg`, () => upd3());
const s3v = ctl('f3-v', (v) => `${f1(v)} m/s`, () => upd3());
function upd3() {
  const q = P.hoist(s3m.v, s3v.v, RD);
  calc('f3-c', [`${Q('P', 'P')} = ${Q('F', 'F')} × ${Q('v', 'v')} = ${f0(q.F)} N × ${f1(s3v.v)} m/s = <b class="qP">${f0(q.P)} W</b>`,
    `${Q('P', 'P')} = ${Q('T', 'T')} × ω = (${f0(q.F)} × ${f2(RD)}) N·m × ${f1(q.w)} rad/s = ${f1(q.T)} × ${f1(q.w)} = <b class="qP">${f0(q.P2)} W</b>`,
    `<span class="note">卷筒 ${f0(q.n)} rpm：</span>${f1(q.T)} × ${f0(q.n)} ÷ 9549 = <b class="qP">${f2(q.T * q.n / P.K9549)} kW</b><span class="note">（拉力 = 质量 × 9.81）</span>`]);
  f3.dirty = true;
}
f3.step = function (dt) { this.y += s3v.v * dt; this.ang += s3v.v / RD * dt; if (this.y > 2.2) this.y = 0; return true; };
f3.draw = function (g, w, h) {
  const q = P.hoist(s3m.v, s3v.v, RD), dx = w * .34, dy = h * .16, dr = Math.min(32, h * .09);
  const top = dy + dr + 20, bottom = h * .9, span = bottom - top, s = span / 2.6;
  // 架子和卷筒
  g.fillStyle = T.panel2; g.fillRect(dx - dr - 30, dy - 8, (dr + 30) * 2, 10);
  g.beginPath(); g.arc(dx, dy + 6, dr, 0, TAU); g.fillStyle = T.panel2; g.fill(); g.strokeStyle = T.ink3; g.lineWidth = 2; g.stroke();
  for (let k = 0; k < 4; k++) { const a = this.ang + k * TAU / 4; g.beginPath(); g.moveTo(dx, dy + 6); g.lineTo(dx + dr * Math.cos(a), dy + 6 + dr * Math.sin(a)); g.stroke(); }
  // 绳子和重物
  const by = bottom - this.y * s, bs = 24 + Math.cbrt(s3m.v) * 7;
  g.strokeStyle = T.ink2; g.lineWidth = 2; g.beginPath(); g.moveTo(dx + dr, dy + 6); g.lineTo(dx + dr, by - bs); g.stroke();
  rr(g, dx + dr - bs / 2, by - bs, bs, bs, 4); g.fillStyle = T.ink3; g.fill();
  txt(g, `${s3m.v} kg`, dx + dr, by - bs / 2 + 5, { c: T.panel, size: 13, w: 700, a: 'center' });
  // 力、速度
  arrow(g, dx + dr + 14, by - bs - 4, dx + dr + 14, by - bs - 4 - clamp(q.F / 2000, .15, 1) * h * .26, T.F, 4);
  txt(g, `拉力 ${f0(q.F)} N`, dx + dr + 22, by - bs - 20, { c: T.F, size: 13.5, w: 700 });
  arrow(g, dx + dr - bs / 2 - 14, by - 4, dx + dr - bs / 2 - 14, by - 4 - clamp(s3v.v / 3, .15, 1) * h * .22, T.v, 4);
  txt(g, `${f1(s3v.v)} m/s`, dx + dr - bs / 2 - 20, by - 10, { c: T.v, size: 13.5, w: 700, a: 'right' });
  // 卷筒上的扭矩和转速
  txt(g, `${f1(q.T)} N·m`, dx - dr - 10, dy + 2, { c: T.T, size: 14, w: 700, a: 'right', f: NUM });
  txt(g, `${f0(q.n)} rpm`, dx - dr - 10, dy + 20, { c: T.n, size: 14, w: 700, a: 'right', f: NUM });
  // 功率表
  const gx = w * .74, gw = w * .12, gy = h * .12, gh = h * .72, fill = clamp(q.P / 6000, 0, 1) * gh;
  rr(g, gx, gy, gw, gh, 5); g.fillStyle = T.panel2; g.fill();
  rr(g, gx, gy + gh - fill, gw, fill, 5); g.fillStyle = T.P; g.fill();
  txt(g, '功率', gx + gw / 2, gy - 6, { c: T.ink2, size: 12, a: 'center' });
  txt(g, `${f0(q.P)} W`, gx + gw / 2, gy + gh + 16, { c: T.P, size: 15, w: 700, a: 'center', f: NUM });
};

// ============================================================== 4 齿轮
const f4 = new Fig('f4', { ratio: .62, maxH: 380 });
f4.ang = 0;
const s4z1 = ctl('f4-z1', (v) => `${v} 齿`, () => upd4());
const s4z2 = ctl('f4-z2', (v) => `${v} 齿`, () => upd4());
const s4n = ctl('f4-n', (v) => `${v} rpm`, () => upd4());
const s4T = ctl('f4-T', (v) => `${v} N·m`, () => upd4());
function upd4() {
  const q = P.gearPair(s4z1.v, s4z2.v, s4n.v, s4T.v);
  calc('f4-c', [`齿比 = ${s4z2.v} ÷ ${s4z1.v} = <b>${f2(q.i)}</b>`,
    `${Q('n', '输出转速')} = ${s4n.v} ÷ ${f2(q.i)} = <b class="qn">${f0(q.n2)} rpm</b>`,
    `${Q('T', '输出扭矩')} = ${s4T.v} × ${f2(q.i)} × 98% = <b class="qT">${f1(q.T2)} N·m</b>`,
    `${Q('P', '功率')}：进去 ${s4T.v} × ${s4n.v} ÷ 9549 = <b class="qP">${f2(q.P1 / 1000)} kW</b>，出来 ${f1(q.T2)} × ${f0(q.n2)} ÷ 9549 = <b class="qP">${f2(q.P2 / 1000)} kW</b>`]);
  f4.dirty = true;
}
f4.step = function (dt) { this.ang += rad(s4n.v) * dt / 100; return true; };
f4.draw = function (g, w, h) {
  const z1 = s4z1.v, z2 = s4z2.v, q = P.gearPair(z1, z2, s4n.v, s4T.v);
  const m = Math.min((w * .74) / (z1 + z2), (h * .56) / z2), r1 = z1 * m / 2, r2 = z2 * m / 2, cy = h * .4;
  const x1 = w / 2 - (r1 + r2) / 2, x2 = x1 + r1 + r2;
  gear(g, x1, cy, r1, z1, this.ang, T.panel2, T.ink3);
  gear(g, x2, cy, r2, z2, -this.ang * z1 / z2 + Math.PI + Math.PI / z2, T.panel2, T.ink3);
  txt(g, `${z1} 齿`, x1, cy - r1 - 12, { c: T.ink2, size: 12, a: 'center' });
  txt(g, `${z2} 齿`, x2, cy - r2 - 12, { c: T.ink2, size: 12, a: 'center' });
  const ly = cy + r2 + 22;
  txt(g, `${s4n.v} rpm`, x1, ly, { c: T.n, size: 16, w: 700, a: 'center', f: NUM });
  txt(g, `${s4T.v} N·m`, x1, ly + 18, { c: T.T, size: 16, w: 700, a: 'center', f: NUM });
  txt(g, `${f0(q.n2)} rpm`, x2, ly, { c: T.n, size: 16, w: 700, a: 'center', f: NUM });
  txt(g, `${f0(q.T2)} N·m`, x2, ly + 18, { c: T.T, size: 16, w: 700, a: 'center', f: NUM });
  // 功率条
  const bx = w * .08, bw = w * .84, by = h * .9, sc = bw / 63000;
  for (const [k, val, lab] of [[0, q.P1, '进'], [1, q.P2, '出']]) {
    const y = by - 16 + k * 14;
    rr(g, bx + 16, y - 5, Math.max(2, val * sc), 10, 5); g.fillStyle = T.P; g.globalAlpha = k ? .75 : 1; g.fill(); g.globalAlpha = 1;
    txt(g, lab, bx, y + 4, { c: T.ink2, size: 11.5 });
    txt(g, `${f2(val / 1000)} kW`, bx + 22 + val * sc, y + 4, { c: T.P, size: 12.5, w: 700, f: NUM });
  }
};

// ============================================================== 5 车轮推力 = 功率 ÷ 车速
const f5 = new Fig('f5', { ratio: .68, maxH: 430, minH: 260 });
const TRAC = P.traction();
let f5mode = 'p';
const s5v = ctl('f5-v', (v) => `${v} km/h`, () => upd5());
function f5set(m) { f5mode = m; $('f5-p').setAttribute('aria-pressed', m === 'p'); $('f5-t').setAttribute('aria-pressed', m === 't'); upd5(); }
$('f5-p').addEventListener('click', () => f5set('p'));
$('f5-t').addEventListener('click', () => f5set('t'));
const N5 = { p: NMAX, t: 4200 };
function topSpeed(Pw, res) { let a = 1, b = 120; for (let k = 0; k < 60; k++) { const m = (a + b) / 2; if (Pw / m > res(m)) a = m; else b = m; } return a; }
function upd5() {
  const v = ms(s5v.v), n = N5[f5mode], q = P.pushAt(v, n), F = Math.min(q.F, TRAC), R = P.resist(v), a = (F - R) / CAR.mass;
  const need = n / (v / CAR.r * 60 / TAU), lim = CAR.low * CAR.final;
  kpis('f5-k', [['车轮推力', f0(F), 'N', 'F'], ['风阻 + 滚阻', f0(R), 'N'], ['加速度', f2(a), `m/s²（${f2(a / P.G)} g）`]]);
  calc('f5-c', [`发动机 ${n} rpm × ${f0(P.tqWot(n))} N·m ÷ 9549 = ${Q('P', `${f1(q.P / CAR.eta / 1000)} kW`)}，到车轮 × 84% = <b class="qP">${f1(q.P / 1000)} kW</b>`,
    `${Q('F', '推力')} = ${Q('P', '功率')} ÷ ${Q('v', '车速')} = ${f0(q.P)} W ÷ ${f1(v)} m/s = <b class="qF">${f0(q.F)} N</b>${q.F > TRAC ? `<span class="note">　超过抓地力，只能用到 ${f0(TRAC)} N</span>` : ''}`,
    `加速度 = (推力 − 阻力) ÷ 质量 = (${f0(F)} − ${f0(R)}) ÷ ${CAR.mass} = <b>${f2(a)} m/s²</b>`,
    `<span class="note">要守住 ${n} rpm，总减速比得是 ${f1(need)}${need > lim ? `，可这台车最多 ${f1(lim)}：这么低的车速其实守不住，第 9 步看真实的情况` : `（这台车能在 ${f1(CAR.high * CAR.final)}～${f1(lim)} 之间连续变）`}</span>`]);
  f5.dirty = true;
}
f5.draw = function (g, w, h) {
  const box = plotBox(w, h, 48, 14, 28, 36), o = axes(g, box, { xmax: 200, xstep: 20, xlabEvery: 2, ymax: 8000, ystep: 2000, xlab: '车速 km/h', ylab: '车轮推力 N' });
  const { X, Y } = o, R = (k) => P.resist(ms(k));
  g.fillStyle = T.grip; g.globalAlpha = .07; g.fillRect(box.x, box.y, box.w, Y(TRAC) - box.y); g.globalAlpha = 1;
  curve(g, () => TRAC, 0, 200, X, Y, box, { c: T.grip, lw: 1.5, dash: [6, 4], n: 2 });
  txt(g, `抓地力上限 ${f0(TRAC)} N，再往上轮胎打滑`, box.x + box.w - 4, Y(TRAC) - 6, { c: T.grip, size: 11.5, a: 'right' });
  curve(g, R, 0, 200, X, Y, box, { c: T.drag, lw: 2 });
  txt(g, '风阻 + 滚阻', X(118), Y(R(118)) + 16, { c: T.drag, size: 11.5, a: 'center' });
  for (const m of ['t', 'p']) {
    const Pw = P.pushAt(10, N5[m]).P, on = m === f5mode;
    curve(g, (k) => Pw / ms(k), 4, 200, X, Y, box, { c: m === 'p' ? T.P : T.T, lw: on ? 3 : 1.6, dash: on ? null : [5, 4], alpha: on ? 1 : .8 });
    // 两条线的标签都放在 70 km/h：金线的写在线上面，紫线的写在线下面，不会叠在一起
    const lx = 70, ly = Y(Pw / ms(lx)) + (m === 'p' ? -10 : 18);
    if (box.w < 420) continue;                            // 手机上图太窄，不标线名（上面的按钮已经写着是哪条）
    txt(g, `${m === 'p' ? '守在 6000 rpm' : '守在 4200 rpm'}：${f1(Pw / 1000)} kW ÷ 车速`, X(lx) + 4, ly, { c: m === 'p' ? T.P : T.T, size: 11.5, w: on ? 700 : 400 });
  }
  const Pw = P.pushAt(10, N5[f5mode]).P, vt = topSpeed(Pw, P.resist);
  dot(g, X(kmh(vt)), Y(P.resist(vt)), T.ink, 4);
  txt(g, `极速约 ${f0(kmh(vt))} km/h`, X(kmh(vt)) - 6, Y(P.resist(vt)) - 12, { c: T.ink2, size: 11.5, a: 'right' });
  const v = ms(s5v.v), F = Math.min(Pw / v, TRAC);
  vline(g, X(s5v.v), box);
  dot(g, X(s5v.v), Y(F), T.F, 6); dot(g, X(s5v.v), Y(P.resist(v)), T.drag, 4);
  labelOn(g, `${f0(F)} N`, X(s5v.v) + 8, Y(F) - 8, T.F);
};

// ============================================================== 6 发动机：空气
const f6a = new Fig('f6a', { ratio: .42, maxH: 260, minH: 190 });
const f6b = new Fig('f6b', { ratio: .5, maxH: 300, minH: 200 });
f6a.dots = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() }));
f6a.drops = Array.from({ length: 14 }, () => ({ y: Math.random() }));
f6a.t = 0;
const s6d = ctl('f6-d', (v) => `${f2(v)} L`, () => upd6());
const s6n = ctl('f6-n', (v) => `${v} rpm`, () => upd6());
const s6t = ctl('f6-t', (v) => `${f0(v * 100)}%`, () => upd6());
const s6b = ctl('f6-b', (v) => (v > 1.001 ? `${f2(v)} 倍大气压` : '没有增压'), () => upd6());
const s6e = ctl('f6-e', (v) => `${f0(v * 100)}%`, () => upd6());
const eng6 = (n = s6n.v, thr = s6t.v) => P.engineAir({ disp: s6d.v, n, thr, boost: s6b.v, eta: s6e.v });
function upd6() {
  const q = eng6();
  kpis('f6-k', [['每秒吸进空气', f0(q.air * 1000), 'g'], ['功率', f1(q.P / 1000), 'kW', 'P'], ['扭矩', f0(q.T), 'N·m', 'T']]);
  const ex = [], mul = [];
  if (s6t.v < 1) { ex.push(`节气门 ${f0(s6t.v * 100)}%`); mul.push(f2(s6t.v)); }
  if (s6b.v > 1.001) { ex.push(`增压 ${f2(s6b.v)} 倍`); mul.push(f2(s6b.v)); }
  calc('f6-c', [`① 每秒扫过的体积 = ${f2(s6d.v)} L × ${s6n.v} ÷ 2 ÷ 60 = <b>${f1(q.vs * 1000)} L/s</b><span class="note">（两圈吸一次）</span>`,
    `② 吸进的空气 = ${f1(q.vs * 1000)} × 充气效率 ${f0(q.vol * 100)}% × 1.2 g/L${mul.length ? ` × ${mul.join(' × ')}` : ''} = <b>${f1(q.air * 1000)} g/s</b>${ex.length ? `<span class="note">（${ex.join('，')}）</span>` : ''}`,
    `③ 能烧的油 = ${f1(q.air * 1000)} ÷ 14.7 = <b>${f2(q.fuel * 1000)} g/s</b>`,
    `④ 放出的热 = ${f2(q.fuel * 1000)} g/s × 43 kJ/g = <b>${f0(q.heat / 1000)} kW</b>`,
    `⑤ ${Q('P', '功率')} = ${f0(q.heat / 1000)} × ${f0(s6e.v * 100)}% = <b class="qP">${f1(q.P / 1000)} kW</b>，${Q('T', '扭矩')} = ${f1(q.P / 1000)} × 9549 ÷ ${s6n.v} = <b class="qT">${f0(q.T)} N·m</b>`]);
  f6a.dirty = f6b.dirty = true;
}
f6a.step = function (dt) {
  const q = eng6(), sp = clamp(q.air / 0.08, .05, 3.5);
  for (const d of this.dots) { d.x += dt * .35 * sp; if (d.x > 1) { d.x -= 1; d.y = Math.random(); } }
  for (const d of this.drops) { d.y += dt * .9 * clamp(q.fuel / 0.0055, .1, 3.5); if (d.y > 1) d.y -= 1; }
  this.t += dt * s6n.v / 60 / 8;
  return true;
};
f6a.draw = function (g, w, h) {
  const q = eng6(), mid = h * .48, scH = h * .7 / 300000;          // 300 kW 的热画满 70% 高
  const air = clamp(q.air / 0.3, .04, 1) * h * .55, x0 = 0, x1 = w * .36, cx0 = w * .36, cx1 = w * .56;
  // 进气管 + 空气
  g.fillStyle = AIR; g.globalAlpha = .18; g.fillRect(x0, mid - air / 2, x1 - x0, air); g.globalAlpha = 1;
  g.fillStyle = AIR;
  for (const d of this.dots) { const x = x0 + d.x * (x1 - x0), y = mid - air / 2 + d.y * air; g.beginPath(); g.arc(x, y, 2.4, 0, TAU); g.fill(); }
  txt(g, `空气 ${f0(q.air * 1000)} g/s`, 6, mid - air / 2 - 8, { c: T.ink2, size: 12.5, w: 700 });
  // 喷油
  const ix = (cx0 + cx1) / 2;
  g.fillStyle = T.ink3; g.fillRect(ix - 4, 4, 8, mid - h * .2 - 4);
  g.fillStyle = FUEL;
  for (const d of this.drops) { const y = 6 + d.y * (mid - h * .2 - 8); g.beginPath(); g.arc(ix + 10, y, 2.6, 0, TAU); g.fill(); }
  txt(g, `油 ${f2(q.fuel * 1000)} g/s`, ix + 18, 18, { c: FUEL, size: 12.5, w: 700 });
  // 气缸：一明一暗地在烧
  const glow = .35 + .3 * Math.max(0, Math.sin(this.t * TAU));
  rr(g, cx0, mid - h * .2, cx1 - cx0, h * .4, 8); g.fillStyle = T.panel2; g.fill(); g.strokeStyle = T.ink3; g.lineWidth = 1.5; g.stroke();
  rr(g, cx0 + 6, mid - h * .2 + 6, cx1 - cx0 - 12, h * .4 - 12, 6); g.fillStyle = FUEL; g.globalAlpha = glow * clamp(q.heat / 150000, .15, 1); g.fill(); g.globalAlpha = 1;
  txt(g, '气缸', (cx0 + cx1) / 2, mid + 5, { c: T.ink, size: 13, w: 700, a: 'center' });
  txt(g, `热 ${f0(q.heat / 1000)} kW`, (cx0 + cx1) / 2, mid + h * .2 + 16, { c: T.ink2, size: 12, a: 'center' });
  // 出来分两股：功率和损失
  const hp = Math.max(2, q.P * scH), hl = Math.max(2, q.loss * scH), ox = cx1, ox2 = w * .72;
  g.fillStyle = T.P; g.beginPath(); g.moveTo(ox, mid - hp - 2); g.lineTo(w - 10, mid - hp - 2); g.lineTo(w - 10, mid - 2); g.lineTo(ox, mid - 2); g.closePath(); g.fill();
  txt(g, `功率 ${f1(q.P / 1000)} kW`, w - 12, mid - hp - 8, { c: T.P, size: 13, w: 700, a: 'right' });
  g.fillStyle = T.drag; g.globalAlpha = .45;
  g.beginPath(); g.moveTo(ox, mid + 2); g.lineTo(ox2, mid + 2); g.quadraticCurveTo(ox2 + 30, mid + 2, ox2 + 30, mid + 30); g.lineTo(ox2 + 30, h); g.lineTo(ox2 + 30 - hl, h);
  g.lineTo(ox2 + 30 - hl, mid + 30 + hl * .3); g.lineTo(ox, mid + 2 + hl); g.closePath(); g.fill(); g.globalAlpha = 1;
  txt(g, `排气和冷却 ${f0(q.loss / 1000)} kW`, ox2 + 36, h - 10, { c: T.ink2, size: 12 });
};
f6b.draw = function (g, w, h) {
  const curveT = (n) => eng6(n).T, curveP = (n) => eng6(n).P / 1000;
  let tm = 0, pm = 0; for (let n = 1000; n <= 7000; n += 100) { tm = Math.max(tm, curveT(n)); pm = Math.max(pm, curveP(n)); }
  const ymax = Math.max(100, Math.ceil(tm * 1.15 / 50) * 50), y2max = Math.max(50, Math.ceil(pm * 1.15 / 25) * 25);
  const box = plotBox(w, h, 44, 44, 26, 34);
  const o = axes(g, box, { x0: 1000, xmax: 7000, xstep: 1000, ymax, ystep: ymax / 4, y2max, y2step: y2max / 4, xlab: '转速 rpm', ylab: '扭矩 N·m', yc: T.T, y2lab: '功率 kW', y2c: T.P, xfmt: (v) => `${v / 1000}k` });
  curve(g, curveT, 1000, 7000, o.X, o.Y, box, { c: T.T, lw: 2.5 });
  curve(g, curveP, 1000, 7000, o.X, o.Y2, box, { c: T.P, lw: 2.5 });
  let np = 1000, best = 0; for (let n = 1000; n <= 7000; n += 50) if (curveP(n) > best) { best = curveP(n); np = n; }
  txt(g, `功率最大在 ${np} rpm`, o.X(np), o.Y2(best) - 8, { c: T.P, size: 11.5, a: 'center' });
  const n = s6n.v;
  vline(g, o.X(n), box);
  dot(g, o.X(n), o.Y(curveT(n)), T.T); dot(g, o.X(n), o.Y2(curveP(n)), T.P);
};

// ============================================================== 7 电机的曲线
const M7 = { U: 400, I: 400, k: 0.75 };
const f7 = new Fig('f7', { ratio: .62, maxH: 400, minH: 250 });
let f7weak = true, f7run = null;
const s7n = ctl('f7-n', (v) => `${v} rpm`, () => upd7());
$('f7-w').addEventListener('click', () => { f7weak = !f7weak; $('f7-w').setAttribute('aria-pressed', f7weak); $('f7-w').textContent = `弱磁：${f7weak ? '开' : '关'}`; upd7(); });
$('f7-run').addEventListener('click', () => { f7run = 0; });
function upd7() {
  const q = P.motor({ ...M7, n: s7n.v, weak: f7weak }), w = rad(s7n.v), below = s7n.v <= q.nb;
  kpis('f7-k', [['扭矩', f0(q.T), 'N·m', 'T'], ['功率', f1(q.P / 1000), 'kW', 'P'], ['反电动势', f0(q.emf), `V（电池 ${M7.U} V）`]]);
  calc('f7-c', [`${Q('T', '扭矩上限')} = k × 电流 = ${M7.k} × ${M7.I} A = <b class="qT">${f0(q.Tmax)} N·m</b>`,
    `反电动势 = k × ω = ${M7.k} × ${f0(w)} rad/s = <b>${f0(q.emf)} V</b>${below ? '<span class="note">　还没到电池电压，电流能开满</span>' : (f7weak ? '<span class="note">　超过电池电压了，靠弱磁压回来</span>' : '<span class="note">　超过电池电压，电流推不进去了</span>')}`,
    `基速 = 电压 ÷ k = ${M7.U} ÷ ${M7.k} = ${f0(M7.U / M7.k)} rad/s ≈ <b class="qn">${f0(q.nb)} rpm</b>`,
    below ? `${Q('P', '功率')} = ${Q('T', 'T')} × ω = ${f0(q.T)} × ${f0(w)} = <b class="qP">${f1(q.P / 1000)} kW</b><span class="note">（基速以下，转得越快功率越大）</span>`
      : (f7weak ? `${Q('P', '功率')} 保持 ${M7.U} V × ${M7.I} A = <b class="qP">${f0(q.Pmax / 1000)} kW</b>，${Q('T', '扭矩')} = ${f0(q.Pmax)} ÷ ${f0(w)} = <b class="qT">${f0(q.T)} N·m</b>` : `<span class="note">没有弱磁：过了基速一点点，扭矩就掉到零</span>`)]);
  f7.dirty = true;
}
f7.step = function (dt) {
  if (f7run === null) return false;
  f7run += dt; s7n.set(Math.min(16000, Math.round(f7run / 5 * 16000 / 100) * 100));
  if (f7run >= 5) f7run = null;
  return true;
};
f7.draw = function (g, w, h) {
  const bw = Math.max(54, w * .13), box = plotBox(w - bw - 10, h, 46, 44, 26, 34);
  const o = axes(g, box, { xmax: 16000, xstep: 2000, xlabEvery: 2, ymax: 400, ystep: 100, y2max: 200, y2step: 50, xlab: '电机转速 rpm', ylab: '扭矩 N·m', yc: T.T, y2lab: '功率 kW', y2c: T.P, xfmt: (v) => `${v / 1000}k` });
  const mq = (n) => P.motor({ ...M7, n, weak: f7weak });
  curve(g, (n) => mq(n).T, 0, 16000, o.X, o.Y, box, { c: T.T, lw: 2.8, n: 320 });
  curve(g, (n) => mq(n).P / 1000, 0, 16000, o.X, o.Y2, box, { c: T.P, lw: 2.8, n: 320 });
  const nb = mq(0).nb;
  vline(g, o.X(nb), box, T.n);
  txt(g, `基速 ${f0(nb)} rpm`, o.X(nb) + 4, box.y + 12, { c: T.n, size: 11.5, w: 700 });
  txt(g, '恒扭矩', o.X(nb / 2), o.Y(300) - 8, { c: T.T, size: 12, w: 700, a: 'center' });
  if (f7weak) txt(g, '恒功率（弱磁）', o.X(11000), o.Y2(160) - 8, { c: T.P, size: 12, w: 700, a: 'center' });
  const n = s7n.v, q = mq(n);
  vline(g, o.X(n), box);
  dot(g, o.X(n), o.Y(q.T), T.T); dot(g, o.X(n), o.Y2(q.P / 1000), T.P);
  // 电压条
  const x = w - bw, y0 = box.y, hh = box.h, vmax = 800, Yv = (v) => y0 + hh - v / vmax * hh;
  rr(g, x + 8, y0, bw - 16, hh, 5); g.fillStyle = T.panel2; g.fill();
  const emf = q.emf, shown = Math.min(emf, vmax);
  rr(g, x + 8, Yv(shown), bw - 16, y0 + hh - Yv(shown), 5); g.fillStyle = T.n; g.globalAlpha = emf > M7.U ? .3 : .85; g.fill(); g.globalAlpha = 1;
  if (emf > M7.U && f7weak) { rr(g, x + 8, Yv(M7.U), bw - 16, y0 + hh - Yv(M7.U), 5); g.fillStyle = T.n; g.globalAlpha = .85; g.fill(); g.globalAlpha = 1; }
  g.strokeStyle = T.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 2, Yv(M7.U)); g.lineTo(w - 2, Yv(M7.U)); g.stroke();
  txt(g, `电池 ${M7.U} V`, x + bw / 2, Yv(M7.U) - 6, { c: T.ink, size: 11, w: 700, a: 'center' });
  txt(g, '反电动势', x + bw / 2, y0 - 8, { c: T.n, size: 11.5, a: 'center' });
  txt(g, `${f0(emf)} V`, x + bw / 2, y0 + hh + 16, { c: T.n, size: 13, w: 700, a: 'center', f: NUM });
  if (emf > M7.U) txt(g, f7weak ? '弱磁压回' : '顶住了', x + bw / 2, Yv(Math.min(emf, vmax)) + (emf > vmax ? 14 : -6), { c: T.ink2, size: 10.5, a: 'center' });
};

// ============================================================== 8 电机的功率 ≈ 电压 × 电流
const f8 = new Fig('f8', { ratio: .7, maxH: 440, minH: 270 });
const EV = P.EV, TRAC8 = P.traction(EV), NMAX8 = 16000;
const PRE = { a: { U: 400, I: 400, k: 0.75, g: 8.13 }, b: { U: 400, I: 400, k: 0.75, g: 4.07 } };
let f8pre = 'a';
const s8U = ctl('f8-U', (v) => `${v} V`, () => upd8());
const s8I = ctl('f8-I', (v) => `${v} A`, () => upd8());
const s8k = ctl('f8-k', (v) => `${f2(v)} N·m/A`, () => upd8());
const s8g = ctl('f8-g', (v) => `${f2(v)}`, () => upd8());
function f8apply(id) { const p = PRE[id]; f8pre = id; s8U.el.value = p.U; s8I.el.value = p.I; s8k.el.value = p.k; s8g.el.value = p.g; [s8U, s8I, s8k, s8g].forEach((s) => s.upd()); }
$('f8-a').addEventListener('click', () => f8apply('a'));
$('f8-b').addEventListener('click', () => f8apply('b'));
const ev8 = (v, d) => P.evPush(v, { U: d.U, I: d.I, k: d.k, gear: d.g, r: EV.r, nMax: NMAX8 });
const cur8 = () => ({ U: s8U.v, I: s8I.v, k: s8k.v, g: s8g.v });
function info8(d) {
  const Fm = d.k * d.I * d.g / EV.r, Pm = d.U * d.I, knee = Pm / Fm, vRpm = rad(NMAX8) / d.g * EV.r;
  const res = (v) => P.resist(v, EV), vDrag = topSpeed(Pm, res);
  return { Fm, Pm, knee, vRpm, vTop: Math.min(vRpm, vDrag), why: vRpm < vDrag ? '电机转速到顶' : '被风阻挡住' };
}
function upd8() {
  const d = cur8(), q = info8(d);
  const same = (p) => Object.keys(p).every((k) => Math.abs(p[k] - d[k]) < 1e-6);
  f8pre = same(PRE.a) ? 'a' : same(PRE.b) ? 'b' : '';
  $('f8-a').setAttribute('aria-pressed', f8pre === 'a'); $('f8-b').setAttribute('aria-pressed', f8pre === 'b');
  kpis('f8-k2', [['电功率 U × I', f0(q.Pm / 1000), 'kW', 'P'], ['车轮最大推力', f0(q.Fm), q.Fm > TRAC8 ? 'N 会打滑' : 'N', 'F'], ['拐点车速', f0(kmh(q.knee)), 'km/h', 'v']]);
  calc('f8-c', [`${Q('P', '功率')} = 电压 × 电流 = ${d.U} V × ${d.I} A = <b class="qP">${f0(q.Pm / 1000)} kW</b>`,
    `${Q('T', '电机最大扭矩')} = k × 电流 = ${f2(d.k)} × ${d.I} = <b class="qT">${f0(d.k * d.I)} N·m</b>；基速 = ${d.U} ÷ ${f2(d.k)} = ${f0(d.U / d.k)} rad/s ≈ ${Q('n', `${f0(P.rpm(d.U / d.k))} rpm`)}`,
    `${Q('F', '车轮最大推力')} = ${f0(d.k * d.I)} × 齿比 ${f2(d.g)} ÷ ${EV.r} m = <b class="qF">${f0(q.Fm)} N</b>${q.Fm > TRAC8 ? `<span class="note">　比抓地力 ${f0(TRAC8)} N 大，起步会打滑</span>` : ''}`,
    `${Q('v', '拐点车速')} = ${f0(q.Pm / 1000)} kW ÷ ${f0(q.Fm)} N = ${f1(q.knee)} m/s = <b class="qv">${f0(kmh(q.knee))} km/h</b>`,
    `<span class="note">最高车速约 ${f0(kmh(q.vTop))} km/h（${q.why}；电机 ${NMAX8} rpm 对应 ${f0(kmh(q.vRpm))} km/h）</span>`]);
  f8.dirty = true;
}
f8.draw = function (g, w, h) {
  const box = plotBox(w, h, 50, 14, 28, 36), ymax = 12000;
  const o = axes(g, box, { xmax: 250, xstep: 25, xlabEvery: 2, ymax, ystep: 2000, xlab: '车速 km/h', ylab: '车轮推力 N' });
  const { X, Y } = o, d = cur8(), q = info8(d);
  g.fillStyle = T.grip; g.globalAlpha = .07; g.fillRect(box.x, box.y, box.w, Y(TRAC8) - box.y); g.globalAlpha = 1;
  curve(g, () => TRAC8, 0, 250, X, Y, box, { c: T.grip, lw: 1.5, dash: [6, 4], n: 2 });
  txt(g, `抓地力上限 ${f0(TRAC8)} N`, box.x + box.w - 4, Y(TRAC8) - 6, { c: T.grip, size: 11.5, a: 'right' });
  curve(g, (k) => P.resist(ms(k), EV), 0, 250, X, Y, box, { c: T.drag, lw: 2 });
  curve(g, (k) => q.Pm / ms(k), 5, 250, X, Y, box, { c: T.P, lw: 1.5, dash: [2, 4] });
  txt(g, `${f0(q.Pm / 1000)} kW ÷ 车速`, X(235), Y(q.Pm / ms(235)) - 8, { c: T.P, size: 11.5, a: 'right' });
  const ghost = f8pre === 'a' ? PRE.b : PRE.a;
  curve(g, (k) => ev8(ms(k), ghost).F || NaN, 0, 250, X, Y, box, { c: T.ink3, lw: 1.8, dash: [6, 4], n: 400 });
  curve(g, (k) => ev8(ms(k), d).F || NaN, 0, 250, X, Y, box, { c: T.ink, lw: 3, n: 400 });
  const kx = Math.min(kmh(q.knee), 250);
  dot(g, X(kx), Y(Math.min(q.Fm, ymax)), T.v, 5);
  txt(g, `拐点 ${f0(kmh(q.knee))} km/h`, X(kx) + 8, Y(Math.min(q.Fm, ymax)) - 8, { c: T.v, size: 12, w: 700 });
  txt(g, f8pre === 'a' ? '虚线：速度优先' : '虚线：力优先', box.x + 6, box.y + 14, { c: T.ink3, size: 11.5 });
  if (q.vRpm < ms(250)) { vline(g, X(kmh(q.vRpm)), box, T.n); txt(g, '电机转速到顶', X(kmh(q.vRpm)) - 4, box.y + box.h - 6, { c: T.n, size: 11, a: 'right' }); }
};

// ============================================================== 9 油车和电车
const f9 = new Fig('f9', { ratio: .7, maxH: 440, minH: 270 });
const s9v = ctl('f9-v', (v) => `${v} km/h`, () => upd9());
const s9g = ctl('f9-g', (v) => f1(v), () => { env9 = null; upd9(); });
let env9 = null;
const PW9 = P.bestPower(1000, CAR.limit).P * CAR.eta;
const engF = (k) => P.engineEnvelope(ms(k));
const evF = (k) => { const q = P.ev9({ gear: s9g.v, v: ms(k) }); return Math.min(q.F, TRAC); };
function evWhy(k) {
  const q = P.ev9({ gear: s9g.v, v: ms(k) });
  if (q.n > P.EV9.nMax) return '电机转速到顶';
  if (q.F >= TRAC) return '抓地力封顶';
  return q.n <= q.nb ? '电机扭矩上限 × 齿比' : '贴着功率线';
}
function upd9() {
  const k = s9v.v, e = engF(k), ef = evF(k), pl = k > 0 ? PW9 / ms(k) : Infinity;
  kpis('f9-k', [['油车推力', f0(e.F), 'N', 'P'], ['电车推力', f0(ef), 'N', 'n'], [`功率线 ${f0(PW9 / 1000)} kW ÷ 车速`, k > 0 ? f0(Math.min(pl, 99999)) : '∞', 'N']]);
  $('f9-cap').innerHTML = `${k} km/h：油车被「${e.why}」限制，电车被「${evWhy(k)}」限制。${k >= 55 && k <= 170 ? '这一段两条线都贴着同一条功率线。' : ''}`;
  f9.dirty = true;
}
f9.draw = function (g, w, h) {
  const box = plotBox(w, h, 48, 14, 28, 36), o = axes(g, box, { xmax: 200, xstep: 20, xlabEvery: 2, ymax: 8000, ystep: 2000, xlab: '车速 km/h', ylab: '车轮推力 N' });
  const { X, Y } = o;
  if (!env9) { env9 = []; for (let k = 0; k <= 200; k += 1) env9.push([k, engF(k).F, evF(k)]); }
  g.fillStyle = T.grip; g.globalAlpha = .07; g.fillRect(box.x, box.y, box.w, Y(TRAC) - box.y); g.globalAlpha = 1;
  curve(g, () => TRAC, 0, 200, X, Y, box, { c: T.grip, lw: 1.5, dash: [6, 4], n: 2 });
  txt(g, `抓地力上限 ${f0(TRAC)} N`, box.x + box.w - 4, Y(TRAC) - 6, { c: T.grip, size: 11.5, a: 'right' });
  curve(g, (k) => P.resist(ms(k)), 0, 200, X, Y, box, { c: T.drag, lw: 2 });
  curve(g, (k) => PW9 / ms(k), 3, 200, X, Y, box, { c: T.ink3, lw: 1.5, dash: [2, 4] });
  txt(g, `功率线：${f0(PW9 / 1000)} kW ÷ 车速`, X(190), Y(PW9 / ms(190)) - 10, { c: T.ink3, size: 11.5, a: 'right' });
  const at = (k, i) => env9[Math.round(clamp(k, 0, 200))][i];
  curve(g, (k) => at(k, 2), 0, 200, X, Y, box, { c: T.n, lw: 3, n: 200 });
  curve(g, (k) => at(k, 1), 0, 200, X, Y, box, { c: T.P, lw: 3, n: 200 });
  txt(g, '油车（发动机 + 变矩器 + CVT）', box.x + 6, Y(1700), { c: T.P, size: 12, w: 700 });
  txt(g, `电车（一个齿比 ${f1(s9g.v)}）`, box.x + 6, Y(1700) + 17, { c: T.n, size: 12, w: 700 });
  const k = s9v.v;
  vline(g, X(k), box);
  dot(g, X(k), Y(at(k, 1)), T.P, 6); dot(g, X(k), Y(at(k, 2)), T.n, 5);
};

// ============================================================== 先猜一下
const GUESS = {
  g1: { right: 1, text: '两倍。扭矩 = 力 × 力臂，力臂翻倍，扭矩就翻倍。拧不动的时候在扳手上套一根长管子，就是这个道理。' },
  g2: { right: 1, text: '约 90 km/h。800 ÷ 60 × 2π × 0.30 ≈ 25.1 m/s，再 × 3.6 ≈ 90 km/h。', run: () => { s2n.set(800); s2r.set(0.30); } },
  g3: { right: 2, text: '一样大。A：981 N × 1 m/s = 981 W；B：490 N × 2 m/s = 981 W。力大速度慢、力小速度快，可以是同一个功率。', run: () => { s3m.set(50); s3v.set(2); } },
  g4: { right: 0, text: '齿比 60 ÷ 20 = 3：转速降到三分之一（1000 rpm），扭矩涨到 3 倍（300 N·m，扣掉 2% 的摩擦约 294 N·m）。功率进去 31.4 kW，出来 30.8 kW。', run: () => { s4z1.set(20); s4z2.set(60); s4n.set(3000); s4T.set(100); } },
  g5: { right: 1, text: '最大功率那个。60 km/h 时：守在 4200 rpm，车轮推力约 3160 N；守在 6000 rpm，约 4070 N。扭矩小了一点，可转速高得多，CVT 再多减一点速，到车轮上反而更大。图已经切到 60 km/h，点上面两个按钮对比。', run: () => { s5v.set(60); } },
  g6: { right: 1, text: '约 80 g。1.5 L × 6000 ÷ 2 ÷ 60 = 75 L/s，6000 rpm 时缸吸满约九成，就是 67.5 L；每升空气约 1.2 g，合 81 g。', run: () => { s6d.set(1.5); s6n.set(6000); s6t.set(1); s6b.set(1); s6e.set(0.34); } },
  g7: { right: 1, text: '最大。只要电流推得进去，扭矩就有，转速是零也一样。发动机做不到：怠速以下它根本转不起来，起步得靠离合器或者变矩器。', run: () => { s7n.set(0); } },
  g8: { right: 1, text: '不变。k 翻倍，扭矩上限翻倍，基速减半，乘起来还是电压 × 电流。拖一下 k 滑块试试：拐点往左挪、最大推力往上涨，“电功率”那一格一直没变。' },
  g9: { right: 0, text: '电机过了基速，一直到最高转速都是最大功率，覆盖了大半个车速范围；发动机只在 6000 rpm 附近才出最大功率，车速一变就得换齿比把它拉回去。扭矩大小和重量都不是原因：发动机配上变速箱，车轮上的扭矩一样能很大。' },
};
document.querySelectorAll('.guess').forEach((el) => {
  const gq = GUESS[el.dataset.guess], btns = [...el.querySelectorAll('.btn')], r = el.querySelector('.r');
  btns.forEach((b, i) => b.addEventListener('click', () => {
    btns.forEach((x, j) => { x.classList.toggle('right', j === gq.right); x.classList.toggle('wrong', j === i && i !== gq.right); });
    r.hidden = false; r.textContent = (i === gq.right ? '猜对了。' : '不对。') + gq.text;
    gq.run?.();
  }));
});

// ============================================================== 启动
readTokens();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', readTokens);
new MutationObserver(readTokens).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
heroCap(); upd1(); upd2(); upd3(); upd4(); upd5(); upd6(); upd7(); upd8(); upd9();
for (const f of figs) { f.size(); f.render(); f.dirty = false; }
let last = performance.now();
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  for (const f of figs) {
    if (!f.visible) continue;
    const moving = !REDUCED && f.step(dt);
    if (moving || f.dirty) { f.size(); f.render(); f.dirty = false; }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__lesson = { P, figs, s1F, s1r, s2n, s5v, s6n, s7n, s8k, s8g, s9v, s9g, f8apply };
