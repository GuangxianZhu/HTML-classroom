// 每张互动图一个类。图只在屏幕内时才动，离开屏幕就停；加载时全部画一帧，保证静止时也完整。
import * as P from './physics.js';

const { TAU, clamp, wrap } = P;
const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const T = {};
const NAMES = ['panel', 'panel2', 'ink', 'ink2', 'ink3', 'line', 'copper', 'n', 's', 'tail', 'ph-u', 'ph-v', 'ph-w', 'wire', 'wire-back', 'no', 'ok'];
const figs = [];

function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  for (const n of NAMES) T[n] = cs.getPropertyValue(`--${n}`).trim();
  figs.forEach((f) => { f.dirty = true; });
}

const FONT = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
const NUM = '"Barlow Condensed","Arial Narrow",sans-serif';
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { e.target._fig.visible = e.isIntersecting; }), { rootMargin: '60px' }) : null;

class Fig {
  constructor(id, { ratio = .68, maxH = 430, minH = 220 } = {}) {
    this.c = $(id); this.g = this.c.getContext('2d'); this.ratio = ratio; this.maxH = maxH; this.minH = minH;
    this.visible = true; this.dirty = true; this.c._fig = this;
    if (io) io.observe(this.c);
    if (window.ResizeObserver) new ResizeObserver(() => { if (this.size()) this.dirty = true; }).observe(this.c.parentElement);
    figs.push(this);
  }

  size() {
    const w = this.c.parentElement.clientWidth - 20;
    if (w <= 0) return false;
    const h = clamp(Math.round(w * this.ratio), this.minH, this.maxH);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.w === w && this.h === h) return false;
    this.w = w; this.h = h; this.c.style.height = `${h}px`;
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
    this.dpr = dpr; this.layout?.();
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

// -------------------------------------------------------------- 绘图小件
function needle(g, x, y, a, L, alpha = 1) {
  const c = Math.cos(a), s = -Math.sin(a), w = L * .24;
  g.globalAlpha = alpha;
  g.fillStyle = T.n;
  g.beginPath(); g.moveTo(x + c * L, y + s * L); g.lineTo(x - s * w, y + c * w); g.lineTo(x + s * w, y - c * w); g.closePath(); g.fill();
  g.fillStyle = T.tail;
  g.beginPath(); g.moveTo(x - c * L, y - s * L); g.lineTo(x - s * w, y + c * w); g.lineTo(x + s * w, y - c * w); g.closePath(); g.fill();
  g.globalAlpha = 1;
}

function text(g, s, x, y, { size = 13, color = T.ink2, align = 'center', base = 'middle', weight = 400, font = FONT } = {}) {
  g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = base;
  g.fillText(s, x, y);
}

function pole(g, s, x, y, size = 34, alpha = 1) {
  g.globalAlpha = alpha;
  text(g, s, x, y, { size, color: s === 'N' ? T.n : T.s, weight: 700, font: NUM });
  g.globalAlpha = 1;
}

function badge(g, s, x, y, size) {
  g.globalAlpha = .92; g.fillStyle = T.panel; g.beginPath(); g.arc(x, y, size * .62, 0, TAU); g.fill(); g.globalAlpha = 1;
  pole(g, s, x, y, size);
}

function arrow(g, x0, y0, x1, y1, color, w = 3, head = 10) {
  const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
  if (L < 1) return;
  const h = Math.min(head, L * .6);
  g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 - Math.cos(a) * h * .7, y1 - Math.sin(a) * h * .7); g.stroke();
  g.fillStyle = color; g.beginPath(); g.moveTo(x1, y1);
  g.lineTo(x1 - h * Math.cos(a - .42), y1 - h * Math.sin(a - .42));
  g.lineTo(x1 - h * Math.cos(a + .42), y1 - h * Math.sin(a + .42)); g.closePath(); g.fill();
}

/** 导线截面：out = 朝你 ⊙，否则离开你 ⊗ */
function wireDot(g, x, y, r, out) {
  g.fillStyle = T.panel; g.strokeStyle = T.wire; g.lineWidth = Math.max(1.6, r * .22);
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.stroke();
  if (out) { g.fillStyle = T.wire; g.beginPath(); g.arc(x, y, r * .3, 0, TAU); g.fill(); } else {
    const d = r * .55; g.beginPath(); g.moveTo(x - d, y - d); g.lineTo(x + d, y + d); g.moveTo(x + d, y - d); g.lineTo(x - d, y + d); g.stroke();
  }
}

/** 一根可转的大磁铁（转子）。th 是 N 端的指向 */
function rotor(g, x, y, R, th) {
  g.strokeStyle = T.line; g.lineWidth = 1.5; g.fillStyle = T.panel2;
  g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill(); g.stroke();
  const c = Math.cos(th), s = -Math.sin(th), w = R * .3, L = R * .86, px = -s * w, py = c * w;
  g.fillStyle = T.n; g.beginPath(); g.moveTo(x + px, y + py); g.lineTo(x + c * L + px * .55, y + s * L + py * .55); g.lineTo(x + c * L - px * .55, y + s * L - py * .55); g.lineTo(x - px, y - py); g.closePath(); g.fill();
  g.fillStyle = T.s; g.beginPath(); g.moveTo(x + px, y + py); g.lineTo(x - c * L + px * .55, y - s * L + py * .55); g.lineTo(x - c * L - px * .55, y - s * L - py * .55); g.lineTo(x - px, y - py); g.closePath(); g.fill();
  text(g, 'N', x + c * L * .6, y + s * L * .6, { size: Math.max(13, R * .3), color: '#fff', weight: 700, font: NUM });
  text(g, 'S', x - c * L * .6, y - s * L * .6, { size: Math.max(13, R * .3), color: '#fff', weight: 700, font: NUM });
  g.fillStyle = T.ink; g.beginPath(); g.arc(x, y, Math.max(2.5, R * .07), 0, TAU); g.fill();
}

/** 一块线圈：画成铜色绕组块，axis 是线圈轴线方向（屏幕角度），dist 到中心的距离 */
function coilBlock(g, cx, cy, ang, dist, len, thick, color, glow) {
  g.save(); g.translate(cx + Math.cos(ang) * dist, cy - Math.sin(ang) * dist); g.rotate(-ang);
  g.fillStyle = T.panel2; g.strokeStyle = T.line; g.lineWidth = 1;
  g.beginPath(); g.rect(-len / 2, -thick / 2, len, thick); g.fill(); g.stroke();
  const n = Math.max(3, Math.floor(len / 6));
  g.strokeStyle = color; g.lineWidth = 2.2; g.globalAlpha = .3 + .7 * clamp(glow, 0, 1);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + .5) * len / n;
    g.beginPath(); g.moveTo(x - 1.5, -thick / 2 - 3); g.lineTo(x + 1.5, thick / 2 + 3); g.stroke();
  }
  g.globalAlpha = 1; g.restore();
}

/** 小磁针阵列：目标方向由 field 给出，当前方向带弹簧，翻转时能看到一波扫过去 */
class Needles {
  constructor() { this.p = []; }

  grid(w, h, step, keep) {
    this.p = [];
    const nx = Math.floor(w / step), ny = Math.floor(h / step), ox = (w - (nx - 1) * step) / 2, oy = (h - (ny - 1) * step) / 2;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = ox + i * step, y = oy + j * step;
      if (keep && !keep(x, y)) continue;
      this.p.push({ x, y, a: null, t: 0, m: 1 });
    }
    this.L = step * .36;
  }

  aim(field, ref) {
    for (const p of this.p) {
      const [bx, by] = field(p.x, p.y), m = Math.hypot(bx, by);
      p.t = Math.atan2(by, bx); p.m = clamp(m / ref, 0, 1);
      if (p.a === null) p.a = p.t;
    }
  }

  step(dt) {
    let moving = false;
    const k = REDUCED ? 1 : Math.min(1, dt * 7);
    for (const p of this.p) {
      const d = wrap(p.t - p.a);
      if (Math.abs(d) > .004) { p.a += d * k; moving = true; } else p.a = p.t;
    }
    return moving;
  }

  draw(g) {
    for (const p of this.p) needle(g, p.x, p.y, p.a, this.L, .28 + .72 * Math.pow(p.m, .55));
  }
}

function drag(c, fn, end) {
  let on = false;
  const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.addEventListener('pointerdown', (e) => { on = true; c.setPointerCapture(e.pointerId); fn(...pos(e), true); });
  c.addEventListener('pointermove', (e) => { if (on) fn(...pos(e), false); });
  const up = () => { on = false; end?.(); };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
}

function press(ids, id) { ids.forEach((k) => $(k).setAttribute('aria-pressed', k === id)); }

/** 滚动示波图：每帧写一个点 */
class Scope extends Fig {
  constructor(id, n, lo, hi, opts) { super(id, { ratio: .26, maxH: 128, minH: 92, ...opts }); this.buf = []; this.n = n; this.lo = lo; this.hi = hi; }

  push(v) { this.buf.push(v); if (this.buf.length > this.n) this.buf.shift(); this.dirty = true; }

  draw(g, w, h) {
    const Y = (v) => h - 6 - (v - this.lo) / (this.hi - this.lo) * (h - 12);
    g.strokeStyle = T.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke();
    if (this.buf.length < 2) return;
    const cols = this.colors(), X = (i) => w - (this.buf.length - 1 - i) / (this.n - 1) * (w - 2) - 1;
    cols.forEach((col, k) => {
      g.strokeStyle = col; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
      this.buf.forEach((v, i) => { const x = X(i), y = Y(v[k]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    });
  }
}

// -------------------------------------------------------------- 开场：通电线圈 + 小磁针阵列
class Hero extends Fig {
  constructor() { super('h', { ratio: .34, maxH: 340, minH: 260 }); this.I = 1; this.flow = 0; this.flip = 1; this.nf = new Needles(); this.auto = !REDUCED; this.tAuto = 0; }

  layout() {
    const { w, h } = this;
    this.cx = w / 2; this.cy = h * .44; this.hl = Math.min(w * .15, 170); this.rd = Math.min(h * .19, 58);
    const wires = P.coilWires(9, this.hl, this.rd);
    this.field = (x, y) => P.coilField(x - this.cx, this.cy - y, wires, this.I, 60);
    this.nf.grid(w, h - 40, Math.max(30, Math.min(38, w / 26)), (x, y) => !(Math.abs(y - this.cy) > this.rd - 9 && Math.abs(y - this.cy) < this.rd + 9 && Math.abs(x - this.cx) < this.hl + 12));
    this.nf.aim(this.field, .09); this.dirty = true;
  }

  toggle() { this.I = -this.I; this.nf.aim(this.field, .09); this.dirty = true; this.note(); }

  note() { $('h-cap').textContent = this.I > 0 ? '现在右端是 N。线圈里的磁场向右。' : '现在左端是 N。线圈里的磁场向左。线圈和小磁针的位置都没变。'; }

  step(dt) {
    this.flow += dt * this.I;
    if (this.auto) { this.tAuto += dt; if (this.tAuto > 3.4) { this.tAuto = 0; this.toggle(); } }
    this.nf.step(dt);
    return true;
  }

  draw(g, w, h) {
    const { cx, cy, hl, rd } = this, n = 9, p = 2 * hl / (n - 1);
    const by = h - 22;                   // 电池和引线
    g.strokeStyle = T.wire; g.lineWidth = 2.5; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(cx - hl - 2, cy + rd); g.lineTo(cx - hl - 34, cy + rd + 10); g.lineTo(cx - hl - 34, by); g.lineTo(cx - 34, by); g.moveTo(cx + 34, by); g.lineTo(cx + hl + 34, by); g.lineTo(cx + hl + 34, cy + rd + 10); g.lineTo(cx + hl + p / 2, cy + rd); g.stroke();
    g.fillStyle = T.panel2; g.strokeStyle = T.line; g.lineWidth = 1.2; g.beginPath(); g.rect(cx - 34, by - 13, 68, 26); g.fill(); g.stroke();
    text(g, this.I > 0 ? '+' : '−', cx - 22, by, { size: 18, color: T.ink, weight: 700 });
    text(g, this.I > 0 ? '−' : '+', cx + 22, by, { size: 18, color: T.ink, weight: 700 });
    text(g, '电池', cx, by, { size: 11.5, color: T.ink3 });
    g.strokeStyle = T['wire-back']; g.lineWidth = 3;
    for (let i = 0; i < n; i++) { const x = cx - hl + i * p; g.beginPath(); g.moveTo(x + p / 2, cy + rd); g.lineTo(x + p, cy - rd); g.stroke(); }
    this.nf.draw(g);
    g.strokeStyle = T.wire; g.lineWidth = 4; g.lineCap = 'round';
    for (let i = 0; i < n; i++) { const x = cx - hl + i * p; g.beginPath(); g.moveTo(x, cy - rd); g.lineTo(x + p / 2, cy + rd); g.stroke(); }
    // 流动的电荷：I > 0 时，电流从左端进，前面这一面向下走
    g.fillStyle = T.panel;
    for (let i = 0; i < n; i++) {
      const u = ((this.flow * 1.4 + i * .13) % 1 + 1) % 1, x = cx - hl + i * p + u * p / 2, y = cy - rd + u * 2 * rd;
      g.beginPath(); g.arc(x, y, 2.3, 0, TAU); g.fill();
    }
    const R = cx + hl + Math.min(72, w * .1), L = cx - hl - Math.min(72, w * .1);
    badge(g, this.I > 0 ? 'N' : 'S', R, cy, 50); badge(g, this.I > 0 ? 'S' : 'N', L, cy, 50);
  }
}

// -------------------------------------------------------------- 第 1 步
class Fig1 extends Fig {
  constructor() { super('f1', { ratio: .66, maxH: 420 }); this.dir = 1; this.nf = new Needles(); this.a = 0; drag(this.c, (x, y) => { this.px = clamp(x, 26, this.w - 26); this.py = clamp(y, 26, this.h - 26); this.dirty = true; this.moved = true; }); }

  layout() {
    const { w, h } = this;
    this.cx = w / 2; this.cy = h / 2; this.hl = w * .15; this.hh = Math.max(16, h * .07);
    this.field = (x, y) => P.barField((x - this.cx) / w, (this.cy - y) / w, this.hl / w * .86, this.dir, 2e-4);
    this.nf.grid(w, h, Math.max(28, w / 21), (x, y) => !(Math.abs(x - this.cx) < this.hl + 14 && Math.abs(y - this.cy) < this.hh + 12));
    this.nf.aim(this.field, 40);
    if (!this.moved) { this.px = w * .78; this.py = h * .27; }
  }

  flip() { this.dir = -this.dir; this.nf.aim(this.field, 40); this.dirty = true; }

  step(dt) {
    const [bx, by] = this.field(this.px, this.py), t = Math.atan2(by, bx);
    const d = wrap(t - this.a), moving = Math.abs(d) > .004;
    this.a += REDUCED ? d : d * Math.min(1, dt * 9);
    return this.nf.step(dt) || moving;
  }

  draw(g, w, h) {
    this.nf.draw(g);
    const { cx, cy, hl, hh } = this, nr = this.dir > 0;
    g.fillStyle = nr ? T.s : T.n; g.fillRect(cx - hl, cy - hh, hl, 2 * hh);
    g.fillStyle = nr ? T.n : T.s; g.fillRect(cx, cy - hh, hl, 2 * hh);
    text(g, nr ? 'S' : 'N', cx - hl * .5, cy, { size: 26, color: '#fff', weight: 700, font: NUM });
    text(g, nr ? 'N' : 'S', cx + hl * .5, cy, { size: 26, color: '#fff', weight: 700, font: NUM });
    const R = Math.max(26, w * .05), { px, py } = this;
    g.fillStyle = T.panel; g.strokeStyle = T.ink; g.lineWidth = 2;
    g.beginPath(); g.arc(px, py, R, 0, TAU); g.fill(); g.stroke();
    needle(g, px, py, this.a, R * .84);
    g.fillStyle = T.ink; g.beginPath(); g.arc(px, py, 2.6, 0, TAU); g.fill();
    text(g, '拖我', px, py + R + 11, { size: 12, color: T.ink3 });
  }
}

// -------------------------------------------------------------- 第 2 步
class Fig2 extends Fig {
  constructor() {
    super('f2', { ratio: .72, maxH: 420 }); this.I = 12; this.t = 0;
    this.pts = [];
    for (const [r, n] of [[1.5, 8], [3, 14]]) for (let i = 0; i < n; i++) this.pts.push({ r, a: i / n * TAU + .2, n: null });
  }

  field(p) {   // 单位 μT。地磁朝北（屏幕上方）
    const k = 20 * this.I / p.r;          // μ0 I / (2π r)：I 单位 A、r 单位 cm 时是 20·I/r μT
    return [-Math.sin(p.a) * k, 40 + Math.cos(p.a) * k];
  }

  step(dt) {
    let m = false;
    for (const p of this.pts) {
      const [x, y] = this.field(p), t = Math.atan2(y, x);
      if (p.n === null) p.n = t;
      const d = wrap(t - p.n);
      if (Math.abs(d) > .003) m = true;
      p.n += REDUCED ? d : d * Math.min(1, dt * 7);
    }
    if (this.I !== 0) { this.t += dt * Math.sign(this.I); m = true; }
    return m;
  }

  draw(g, w, h) {
    const cx = w * .46, cy = h * .53, S = Math.min(cx, h * .47) / 3.55;
    g.strokeStyle = T.line; g.lineWidth = 1; g.setLineDash([3, 5]);
    for (const r of [1.5, 3]) { g.beginPath(); g.arc(cx, cy, r * S, 0, TAU); g.stroke(); }
    g.setLineDash([]);
    const L = Math.max(11, S * .36);
    for (const p of this.pts) {
      const x = cx + Math.cos(p.a) * p.r * S, y = cy - Math.sin(p.a) * p.r * S;
      g.fillStyle = T.panel2; g.beginPath(); g.arc(x, y, L * 1.12, 0, TAU); g.fill();
      needle(g, x, y, p.n ?? Math.PI / 2, L);
    }
    if (this.I === 0) { g.fillStyle = T.panel; g.strokeStyle = T.wire; g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy, 11, 0, TAU); g.fill(); g.stroke(); } else wireDot(g, cx, cy, 11, this.I > 0);
    // 北向标记
    arrow(g, 18, 56, 18, 22, T.ink3, 2, 8); text(g, '北', 18, 66, { size: 12, color: T.ink3 });
    // 瓶盖：俯视，电流朝你 = 瓶盖朝你出来 = 逆时针拧
    const bx = w - 50, by = 52, R = 30;
    g.strokeStyle = T.ink3; g.lineWidth = 2; g.fillStyle = T.panel2;
    g.beginPath(); g.arc(bx, by, R, 0, TAU); g.fill(); g.stroke();
    g.lineWidth = 1.6;
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU + this.t * 1.4, c = Math.cos(a), s = -Math.sin(a); g.beginPath(); g.moveTo(bx + c * (R - 5), by + s * (R - 5)); g.lineTo(bx + c * R, by + s * R); g.stroke(); }
    if (this.I !== 0) {
      const ccw = this.I > 0, a0 = .7, a1 = 5.4;
      g.strokeStyle = T.copper; g.lineWidth = 2.2; g.beginPath(); g.arc(bx, by, R - 11, -a0, -a1, true); g.stroke();
      const e = ccw ? -a1 : -a0, dir = ccw ? -1 : 1, ex = bx + Math.cos(e) * (R - 11), ey = by + Math.sin(e) * (R - 11), ta = e + dir * Math.PI / 2;
      arrow(g, ex - Math.cos(ta) * 3, ey - Math.sin(ta) * 3, ex + Math.cos(ta) * 4, ey + Math.sin(ta) * 4, T.copper, 2, 8);
      wireDot(g, bx, by, 8, ccw);
    }
    text(g, this.I === 0 ? '瓶盖不动' : this.I > 0 ? '逆时针拧，朝你出来' : '顺时针拧，往里走', bx + 42, by + R + 13, { size: 11.5, color: T.ink3, align: 'right' });
  }
}

// -------------------------------------------------------------- 第 3 步
class Fig3 extends Fig {
  constructor() { super('f3', { ratio: .52, maxH: 320 }); this.n = 6; this.dir = 1; this.fe = false; this.nf = new Needles(); }

  layout() {
    const { w, h } = this;
    this.cx = w / 2; this.cy = h / 2; this.hl = Math.min(w * .26, 190); this.rd = Math.min(h * .2, 54); this.nf.grid(w, h, Math.max(24, w / 25), null);
    this.nf.p = this.nf.p.filter((p) => !(Math.abs(Math.abs(p.y - this.cy) - this.rd) < 12 && Math.abs(p.x - this.cx) < this.hl + 12));
    this.aim();
  }

  aim() {
    const hl = this.n === 1 ? 0 : this.hl * this.n / 10 + 16;
    this.wires = P.coilWires(this.n, hl, this.rd); this.len = hl;
    this.nf.aim((x, y) => P.coilField(x - this.cx, this.cy - y, this.wires, this.dir, 60), .05);
    this.dirty = true;
  }

  step(dt) { return this.nf.step(dt); }

  draw(g, w, h) {
    const { cx, cy, rd, len } = this;
    if (this.fe) { g.fillStyle = T.panel2; g.strokeStyle = T.ink3; g.lineWidth = 1.2; g.beginPath(); g.rect(cx - len - 16, cy - rd * .62, 2 * len + 32, rd * 1.24); g.fill(); g.stroke(); }
    this.nf.draw(g);
    for (const wr of this.wires) wireDot(g, cx + wr.x, cy - wr.y, 8.5, wr.s * this.dir > 0);
    const dx = len + Math.max(58, w * .13);
    badge(g, this.dir > 0 ? 'N' : 'S', Math.min(cx + dx, w - 26), cy, 40); badge(g, this.dir > 0 ? 'S' : 'N', Math.max(cx - dx, 26), cy, 40);
    if (this.fe) text(g, '铁芯', cx, cy - rd * .62 + 12, { size: 11.5, color: T.ink3 });
  }
}

class Fig3b extends Fig {
  constructor() { super('f3b', { ratio: .34, maxH: 170, minH: 150 }); this.spin = 1; this.t = 0; this.quiz = true; }

  step(dt) { this.t += dt * this.spin * .9; return !REDUCED; }

  draw(g, w, h) {
    const cx = w * .3, cy = h / 2, R = h * .39;
    g.strokeStyle = T.wire; g.lineWidth = 7; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
    g.fillStyle = T.panel;
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + this.t; g.beginPath(); g.arc(cx + Math.cos(a) * R, cy - Math.sin(a) * R, 2.4, 0, TAU); g.fill(); }
    const ccw = this.spin > 0, a = 1.1;
    arrow(g, cx + Math.cos(a) * (R - 14) * (ccw ? 1 : -1), cy - Math.sin(a) * (R - 14), cx + Math.cos(a + .55) * (R - 14) * (ccw ? 1 : -1), cy - Math.sin(a + .55) * (R - 14), T.copper, 2.4, 9);
    const face = P.faceOf(ccw ? 'ccw' : 'cw'), x = w * .53;
    text(g, ccw ? '电流逆时针绕' : '电流顺时针绕', x, cy - 36, { size: 15, color: T.ink, align: 'left', weight: 700 });
    if (this.quiz) {
      text(g, '?', cx, cy, { size: 46, color: T.ink3, weight: 700, font: NUM });
      text(g, '朝你这面是什么？', x, cy - 10, { size: 13, align: 'left' });
      text(g, '先猜一下，或按下面的按钮', x, cy + 12, { size: 13, align: 'left' });
      return;
    }
    pole(g, face, cx, cy, 46);
    text(g, ccw ? '瓶盖朝你出来' : '瓶盖往里走', x, cy - 11, { size: 13, align: 'left' });
    text(g, ccw ? '磁场也朝你出来' : '磁场也往里走', x, cy + 11, { size: 13, align: 'left' });
    text(g, `朝你这面是 ${face}`, x, cy + 34, { size: 13, color: T.ink, weight: 700, align: 'left' });
  }
}

// -------------------------------------------------------------- 第 4 步
class Fig4 extends Fig {
  constructor() { super('f4', { ratio: .6, maxH: 340 }); this.cur = 0; this.s = { th: 1.05, w: 0 }; }

  step(dt) {
    const h = dt / 4;
    for (let i = 0; i < 4; i++) {
      if (this.cur) {
        if (Math.abs(Math.sin(this.s.th)) < .02 && Math.abs(this.s.w) < .02) this.s.w += (Math.random() - .5) * .07;
        this.s = P.rotorStep(this.s, h, { fieldAngle: this.cur > 0 ? 0 : Math.PI, strength: 14, J: 1, damp: 3.2 });
      } else this.s = P.rotorStep(this.s, h, { strength: 0, J: 1, damp: 3.2 });
    }
    const f = this.cur > 0 ? 0 : Math.PI, d = Math.abs(wrap(f - this.s.th));
    let msg = '断电时没有磁场，转子停在原地。';
    if (this.cur) msg = d < .04 ? '转子和磁场对齐，停住了。再按另一个方向试试。' : d > 3.1 ? '死点：拉力穿过转轴，转子卡着不动，得等一点晃动。' : '转子被拉向磁场方向。';
    if ($('f4-cap').textContent !== msg) $('f4-cap').textContent = msg;
    return true;
  }

  draw(g, w, h) {
    const cx = w * .64, cy = h * .47, R = Math.min(h * .34, w * .2), hl = Math.min(w * .1, 44), X = cx - R - hl - 32, on = this.cur !== 0;
    g.strokeStyle = T.line; g.lineWidth = 1; g.setLineDash([3, 5]); g.beginPath(); g.moveTo(X + hl, cy); g.lineTo(cx - R, cy); g.stroke(); g.setLineDash([]);
    coilBlock(g, X, cy, 0, 0, 2 * hl, h * .42, T.wire, on ? 1 : .22);
    text(g, on ? '线圈（通电）' : '线圈（断电）', X, cy + h * .21 + 15, { size: 12.5, color: T.ink3 });
    if (on) {
      const d = this.cur, y = cy + R + 20;
      arrow(g, cx - d * 44, y, cx + d * 44, y, T.copper, 3, 11);
      text(g, '磁场方向', cx + 54, y, { size: 12.5, color: T.ink2, align: 'left' });
      pole(g, d > 0 ? 'S' : 'N', X - hl - 15, cy, 28);
      pole(g, d > 0 ? 'N' : 'S', X + hl + 15, cy, 28);
    }
    rotor(g, cx, cy, R, this.s.th);
  }
}

// -------------------------------------------------------------- 第 5 步
class Fig5 extends Fig {
  constructor() { super('f5', { ratio: .68, maxH: 400 }); this.a = .8; this.b = .3; this.s = { th: .3, w: 0 }; this.auto = false; this.ph = 0; }

  step(dt) {
    if (this.auto) {
      this.ph += dt * 1.5;
      this.a = Math.cos(this.ph); this.b = Math.sin(this.ph);
      this.sync?.();
    }
    const c = P.combine2(this.a, this.b);
    const h = dt / 4;
    for (let i = 0; i < 4; i++) this.s = P.rotorStep(this.s, h, { fieldAngle: c.angle, strength: 26 * c.size, J: 1, damp: 6 });
    return true;
  }

  draw(g, w, h) {
    const cx = w / 2, cy = h / 2, R = Math.min(h, w) * .2, D = Math.min(h, w) * .335, L = R * 1.1, K = R * 1.62;
    for (const a of [0, Math.PI]) coilBlock(g, cx, cy, a, D, L * .86, L * 1.2, T['ph-u'], Math.abs(this.a));
    for (const a of [Math.PI / 2, -Math.PI / 2]) coilBlock(g, cx, cy, a, D, L * .86, L * 1.2, T['ph-v'], Math.abs(this.b));
    text(g, 'A', cx + D + L * .7, cy - L * .78, { size: 16, color: T['ph-u'], weight: 700, font: NUM });
    text(g, 'B', cx + L * .78, cy - D - L * .55, { size: 16, color: T['ph-v'], weight: 700, font: NUM });
    rotor(g, cx, cy, R, this.s.th);
    const ax = cx + this.a * K, by = cy - this.b * K;
    if (Math.abs(this.a) > .03) arrow(g, cx, cy, ax, cy, T['ph-u'], 3.5);
    if (Math.abs(this.b) > .03) arrow(g, cx, cy, cx, by, T['ph-v'], 3.5);
    g.setLineDash([3, 4]); g.strokeStyle = T.ink3; g.lineWidth = 1;
    g.beginPath(); g.moveTo(ax, cy); g.lineTo(ax, by); g.lineTo(cx, by); g.stroke(); g.setLineDash([]);
    if (Math.hypot(this.a, this.b) > .03) arrow(g, cx, cy, ax, by, T.ink, 4.5, 14);
    text(g, '最粗的箭头 = 总磁场', 10, h - 12, { size: 12, color: T.ink3, align: 'left' });
  }
}

// -------------------------------------------------------------- 第 6 步
class Scope3 extends Scope { colors() { return [T['ph-u'], T['ph-v'], T['ph-w']]; } }

class Fig6 extends Fig {
  constructor(scope) {
    super('f6', { ratio: .62, maxH: 380 }); this.th = .6; this.auto = false; this.dir = 1; this.scope = scope; this.s = { th: .6, w: 0 };
    drag(this.c, (x, y) => {
      this.th = Math.atan2(this.cy - y, x - this.cx); this.dirty = true;
      if (this.auto) this.setAuto(false);
    });
  }

  layout() { this.cx = this.w * .33; this.cy = this.h / 2; this.R = Math.min(this.h, this.w * .66) * .35; }

  setAuto(v) { this.auto = v; $('f6-auto').setAttribute('aria-pressed', v); }

  step(dt) {
    if (this.auto) this.th += dt * 1.4 * this.dir;
    const i = P.threePhase(this.th), s = P.combine3(...i);
    this.i = i;
    const h = dt / 4;
    for (let k = 0; k < 4; k++) this.s = P.rotorStep(this.s, h, { fieldAngle: s.angle, strength: 40, J: 1, damp: 8 });
    this.scope.push(i);
    return true;
  }

  draw(g, w, h) {
    const { cx, cy, R } = this, i = this.i || P.threePhase(this.th), cols = [T['ph-u'], T['ph-v'], T['ph-w']], names = ['U', 'V', 'W'], Ro = R * .46;
    g.strokeStyle = T.line; g.lineWidth = 1; g.setLineDash([3, 5]); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke(); g.setLineDash([]);
    [0, 1, 2].forEach((k) => {
      const a = k * TAU / 3;
      coilBlock(g, cx, cy, a, R * 1.0, R * .36, R * .5, cols[k], Math.abs(i[k]));
      text(g, names[k], cx + Math.cos(a) * R * 1.32, cy - Math.sin(a) * R * 1.32, { size: 16, color: cols[k], weight: 700, font: NUM });
    });
    rotor(g, cx, cy, Ro, this.s.th);
    const K = R * .46;
    [0, 1, 2].forEach((k) => {
      const a = k * TAU / 3;
      if (Math.abs(i[k]) > .04) arrow(g, cx, cy, cx + Math.cos(a) * i[k] * K, cy - Math.sin(a) * i[k] * K, cols[k], 3);
    });
    const hx = cx + Math.cos(this.th) * R * .86, hy = cy - Math.sin(this.th) * R * .86;
    arrow(g, cx, cy, hx, hy, T.ink, 4.5, 14);
    g.fillStyle = T.copper; g.strokeStyle = T.panel; g.lineWidth = 2.5; g.beginPath(); g.arc(hx, hy, 11, 0, TAU); g.fill(); g.stroke();
    // 三根柱子
    const bw = Math.min(28, w * .055), gap = bw * 1.5, bx = w - 2 * gap - bw - 8, y0 = h / 2, H = h * .34;
    text(g, '三组电流', bx + gap, 16, { size: 12.5, color: T.ink3 });
    g.strokeStyle = T.ink3; g.lineWidth = 1; g.beginPath(); g.moveTo(bx - bw * .8, y0); g.lineTo(bx + 2 * gap + bw * .8, y0); g.stroke();
    [0, 1, 2].forEach((k) => {
      const x = bx + k * gap, v = i[k] * H;
      g.fillStyle = cols[k]; g.fillRect(x - bw / 2, Math.min(y0, y0 - v), bw, Math.abs(v));
      text(g, names[k], x, h - 18, { size: 15, color: cols[k], weight: 700, font: NUM });
      text(g, `${i[k] >= 0 ? '+' : '−'}${Math.abs(Math.round(i[k] * 100))}`, x, i[k] >= 0 ? y0 + 12 : y0 - 12, { size: 12, color: T.ink2, font: '"IBM Plex Mono",monospace' });
    });
    text(g, `三组合计 ${Math.abs(Math.round((i[0] + i[1] + i[2]) * 100))}`, bx + gap, 34, { size: 12.5, color: T.ink3 });
  }
}

// -------------------------------------------------------------- 第 7 步
class Scope2 extends Scope { colors() { return [T.copper, T.s]; } }

class Fig7 extends Fig {
  constructor(scope) { super('f7', { ratio: .56, maxH: 300 }); this.s = { th: 0, w: 0, f: 0, delta: 0, pull: 0 }; this.mode = 'open'; this.fs = .8; this.cur = .7; this.load = .2; this.fsNow = 0; this.scope = scope; this.tk = 0; }

  step(dt) {
    const h = dt / 8;
    // 开环时，磁场速度直接跟滑杆走：拖太快就会失步
    this.fsNow += clamp(this.fs - this.fsNow, -3 * dt, 3 * dt);
    for (let i = 0; i < 8; i++) this.s = P.dogStep(this.s, h, { mode: this.mode, fieldSpeed: this.fsNow * TAU, current: this.mode === 'open' ? 1 : this.cur, load: this.load });
    const rps = this.s.w / TAU;
    this.lost = this.mode === 'open' && Math.abs(rps - this.fsNow) > .25 && this.fsNow > .1;
    this.scope.push([rps, this.mode === 'open' ? this.fsNow : rps]);
    this.tk += dt;
    if (this.tk > .1) {
      this.tk = 0;
      $('f7-k1').innerHTML = `${rps.toFixed(2)}<small>转/秒</small>`;
      $('f7-k2').innerHTML = `${Math.round(Math.abs(this.s.delta) * 180 / Math.PI)}<small>°</small>`;
      $('f7-k3').innerHTML = `${Math.round(this.s.pull * 100)}<small>%</small>`;
      let msg = '';
      if (this.mode === 'open') msg = this.lost ? '失步了：磁场转得太快，转子甩掉了，拉力一会儿正一会儿负，平均下来是零。把设定转速拖回 0 再慢慢加。' : this.load > .92 ? '负载接近最大拉力，绳子快绷断了。' : '转子转速等于磁场转速。负载越重，超前角越大。';
      else msg = rps < .01 ? '拉力小于阻力，转不起来。把电流加大。' : Math.abs(this.s.w * P.DOG.c + this.load - this.cur) < .02 ? '拉力和阻力平衡，转速稳定下来了。' : '拉力大于阻力，正在加速；反过来就减速。';
      if ($('f7-cap').textContent !== msg) $('f7-cap').textContent = msg;
    }
    return true;
  }

  draw(g, w, h) {
    const cx = w / 2, cy = h / 2, R = Math.min(h, w) * .3, O = R * 1.42, { th, f } = this.s;
    g.strokeStyle = T.line; g.lineWidth = 1; g.setLineDash([3, 5]); g.beginPath(); g.arc(cx, cy, O, 0, TAU); g.stroke(); g.setLineDash([]);
    rotor(g, cx, cy, R, th);
    const hx = cx + Math.cos(f) * O, hy = cy - Math.sin(f) * O, nx = cx + Math.cos(th) * R * .86, ny = cy - Math.sin(th) * R * .86;
    const taut = clamp(Math.abs(this.s.pull), 0, 1);
    g.strokeStyle = T.copper; g.lineWidth = 1.5 + taut * 2.5; g.globalAlpha = .45 + taut * .55;
    g.beginPath(); g.moveTo(nx, ny); g.quadraticCurveTo((nx + hx) / 2 + (cy - (ny + hy) / 2) * .12 * (1 - taut), (ny + hy) / 2, hx, hy); g.stroke(); g.globalAlpha = 1;
    g.fillStyle = T.s; g.strokeStyle = T.panel; g.lineWidth = 2.5; g.beginPath(); g.arc(hx, hy, 14, 0, TAU); g.fill(); g.stroke();
    text(g, '磁场', hx, hy, { size: 11, color: T.panel, weight: 700 });
  }
}

// -------------------------------------------------------------- 第 8 步
class Fig8 extends Fig {
  constructor() { super('f8', { ratio: .5, maxH: 280, minH: 210 }); this.st = 'a'; this.t = 0; }

  step(dt) { if (this.st === 'a' || this.st === 'b') this.t += dt * (this.st === 'a' ? 1 : -1); return !REDUCED && this.st !== '0'; }

  draw(g, w, h) {
    const L = w * .2, Rr = w * .8, T0 = 40, B0 = h - 26, mid = (T0 + B0) / 2, st = this.st;
    const on = { s1: st === 'a' || st === 'x', s4: st === 'a', s2: st === 'b', s3: st === 'b' || st === 'x' };
    g.strokeStyle = T.line; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(L, T0); g.lineTo(Rr, T0); g.moveTo(L, B0); g.lineTo(Rr, B0); g.stroke();
    text(g, '电池 +', w / 2, T0 - 14, { size: 13, color: T.ink2 }); text(g, '电池 −', w / 2, B0 + 14, { size: 13, color: T.ink2 });
    const sw = (x, y0, y1, a, name) => {
      const c = a ? T.copper : T.ink3;
      g.strokeStyle = T.line; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + 9); g.moveTo(x, y1 - 9); g.lineTo(x, y1); g.stroke();
      g.strokeStyle = c; g.lineWidth = 3.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y0 + 9); g.lineTo(a ? x : x + 15, a ? y1 - 9 : y1 - 15); g.stroke();
      g.fillStyle = c; for (const yy of [y0 + 9, y1 - 9]) { g.beginPath(); g.arc(x, yy, 3, 0, TAU); g.fill(); }
      text(g, name, x + (x < w / 2 ? -14 : 24), (y0 + y1) / 2, { size: 12, color: T.ink3, align: x < w / 2 ? 'right' : 'left' });
    };
    sw(L, T0, mid, on.s1, '左上'); sw(Rr, T0, mid, on.s2, '右上'); sw(L, mid, B0, on.s3, '左下'); sw(Rr, mid, B0, on.s4, '右下');
    const cw = (Rr - L) * .42, cl = w / 2 - cw / 2, cr = w / 2 + cw / 2;
    g.strokeStyle = T.line; g.lineWidth = 2.5; g.beginPath(); g.moveTo(L, mid); g.lineTo(cl, mid); g.moveTo(cr, mid); g.lineTo(Rr, mid); g.stroke();
    const n = 6, p = cw / n;
    g.strokeStyle = T.wire; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cl, mid);
    for (let i = 0; i < n; i++) g.arc(cl + (i + .5) * p, mid, p / 2, Math.PI, 0, false);
    g.stroke();
    if (st === 'x') {
      g.strokeStyle = T.no; g.lineWidth = 4;
      g.beginPath(); g.moveTo(L, T0); g.lineTo(L, B0); g.stroke();
      text(g, '短路！', L + 12, mid + 26, { size: 15, color: T.no, weight: 700, align: 'left' });
      return;
    }
    if (st === '0') return;
    const d = st === 'a' ? 1 : -1;
    const path = st === 'a' ? [[Rr * .5 + L * .5, T0], [L, T0], [L, mid], [Rr, mid], [Rr, B0], [w / 2, B0]] : [[w / 2, T0], [Rr, T0], [Rr, mid], [L, mid], [L, B0], [w / 2, B0]];
    const lens = []; let tot = 0;
    for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); lens.push(l); tot += l; }
    g.fillStyle = T.copper;
    for (let k = 0; k < 12; k++) {
      let u = ((Math.abs(this.t) * .32 + k / 12) % 1) * tot, i = 0;
      while (i < lens.length - 1 && u > lens[i]) { u -= lens[i]; i++; }
      const r = u / lens[i], x = path[i][0] + (path[i + 1][0] - path[i][0]) * r, y = path[i][1] + (path[i + 1][1] - path[i][1]) * r;
      g.beginPath(); g.arc(x, y, 3.6, 0, TAU); g.fill();
    }
    pole(g, d > 0 ? 'N' : 'S', cr + 16, mid - 20, 22); pole(g, d > 0 ? 'S' : 'N', cl - 16, mid - 20, 22);
  }
}

class Fig8t extends Fig {
  constructor() { super('f8t', { ratio: .24, maxH: 120, minH: 96 }); this.d = .6; }

  draw(g, w, h) {
    const tr = P.pwmTrace(this.d, 1, 3.2, 10), N = tr.i.length, gh = h * .3;
    const X = (i) => 1 + i / (N - 1) * (w - 2);
    g.fillStyle = T.tail;
    for (let i = 0, st = -1; i <= N; i++) {
      const on = i < N && tr.gate[i];
      if (on && st < 0) st = i;
      if (!on && st >= 0) { g.fillRect(Math.round(X(st)), 2, Math.round(X(i - 1) - X(st)) + 1, gh); st = -1; }
    }
    const Y = (v) => h - 5 - v * (h - gh - 14);
    g.strokeStyle = T.line; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, Y(this.d)); g.lineTo(w, Y(this.d)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = T.copper; g.lineWidth = 2; g.beginPath();
    tr.i.forEach((v, i) => { if (i) g.lineTo(X(i), Y(v)); else g.moveTo(X(i), Y(v)); }); g.stroke();
    text(g, `平均 ${Math.round(this.d * 100)}%`, w - 6, Y(this.d) - 9, { size: 12, color: T.ink2, align: 'right' });
  }
}

// -------------------------------------------------------------- 组装
function initGuess(handlers) {
  document.querySelectorAll('.guess').forEach((el) => {
    const id = el.dataset.guess, { right, run } = handlers[id], btns = [...el.querySelectorAll('.btn')], r = el.querySelector('.r');
    btns.forEach((b) => {
      b.addEventListener('click', () => {
        btns.forEach((x) => x.classList.remove('right', 'wrong'));
        btns[right].classList.add('right');
        if (+b.dataset.a !== right) b.classList.add('wrong');
        r.hidden = false; run?.();
      });
    });
  });
}

function main() {
  readTokens();
  const hero = new Hero(), f1 = new Fig1(), f2 = new Fig2(), f3 = new Fig3(), f3b = new Fig3b(), f4 = new Fig4(), f5 = new Fig5();
  const s6 = new Scope3('f6t', 320, -1.1, 1.1), f6 = new Fig6(s6);
  const s7 = new Scope2('f7t', 480, -.1, 2.6), f7 = new Fig7(s7);
  const f8 = new Fig8(), f8t = new Fig8t();

  figs.forEach((f) => f.size());     // 子类字段都就位后再量尺寸

  hero.note();
  $('h-flip').onclick = () => { hero.auto = false; hero.toggle(); };
  $('f1-flip').onclick = () => f1.flip();

  const f2i = $('f2-i');
  const upd2 = () => {
    const v = +f2i.value; f2.I = v; f2.dirty = true;
    $('f2-o').textContent = v === 0 ? '0 A' : `${Math.abs(v)} A ${v > 0 ? '⊙' : '⊗'}`;
    const B = Math.abs(v) * 20 / 1.5;
    $('f2-cap').textContent = v === 0 ? '没有电流：所有指南针都指北，只受地磁场影响。' : `里圈的磁场约是地磁的 ${(B / 40).toFixed(1)} 倍。${v > 0 ? '电流朝你，磁场逆时针绕。' : '电流离开你，磁场顺时针绕。'}`;
  };
  f2i.addEventListener('input', upd2); upd2();

  const f3n = $('f3-n');
  const upd3 = () => {
    f3.n = +f3n.value; f3.aim();
    $('f3-no').textContent = `${f3.n} 圈`;
    $('f3-cap').textContent = `${f3.dir > 0 ? '右端是 N，线圈里的磁场向右' : '左端是 N，线圈里的磁场向左'}。${f3.fe ? '铁芯让磁场强了几百倍以上，方向不变。' : ''}`;
  };
  f3n.addEventListener('input', upd3);
  $('f3-rev').onclick = () => { f3.dir = -f3.dir; upd3(); };
  $('f3-fe').onclick = () => { f3.fe = !f3.fe; $('f3-fe').setAttribute('aria-pressed', f3.fe); upd3(); };
  upd3();
  const setSpin = (s) => { f3b.spin = s; f3b.quiz = false; press(['f3-ccw', 'f3-cw'], s > 0 ? 'f3-ccw' : 'f3-cw'); f3b.dirty = true; };
  $('f3-ccw').onclick = () => setSpin(1); $('f3-cw').onclick = () => setSpin(-1);

  const set4 = (c, id) => { f4.cur = c; press(['f4-p', 'f4-0', 'f4-n'], id); };
  $('f4-p').onclick = () => set4(1, 'f4-p'); $('f4-n').onclick = () => set4(-1, 'f4-n'); $('f4-0').onclick = () => set4(0, 'f4-0');

  const a5 = $('f5-a'), b5 = $('f5-b');
  const out5 = () => { $('f5-ao').textContent = `${Math.round(f5.a * 100)}%`; $('f5-bo').textContent = `${Math.round(f5.b * 100)}%`; };
  f5.sync = () => { a5.value = Math.round(f5.a * 100); b5.value = Math.round(f5.b * 100); out5(); };
  const stop5 = () => { f5.auto = false; $('f5-auto').setAttribute('aria-pressed', 'false'); };
  const from5 = () => { stop5(); f5.a = a5.value / 100; f5.b = b5.value / 100; out5(); };
  a5.addEventListener('input', from5); b5.addEventListener('input', from5);
  const put5 = (a, b) => { stop5(); f5.a = a; f5.b = b; f5.sync(); };
  [[1, 0], [0, 1], [-1, 0], [0, -1]].forEach(([a, b], i) => { $(`f5-${i + 1}`).onclick = () => put5(a, b); });
  $('f5-auto').onclick = () => { f5.auto = !f5.auto; $('f5-auto').setAttribute('aria-pressed', f5.auto); if (f5.auto) f5.ph = Math.atan2(f5.b, f5.a); };
  out5();

  $('f6-auto').onclick = () => f6.setAuto(!f6.auto);
  $('f6-rev').onclick = () => { f6.dir = -f6.dir; f6.setAuto(true); };

  const c7 = $('f7-c'), s7i = $('f7-s'), l7 = $('f7-l');
  const up7 = () => {
    f7.fs = +s7i.value; f7.cur = c7.value / 100; f7.load = l7.value / 100;
    $('f7-so').textContent = `${f7.fs.toFixed(2)} 转/秒`; $('f7-co').textContent = `${c7.value}%`; $('f7-lo').textContent = `${l7.value}%`;
  };
  [c7, s7i, l7].forEach((e) => e.addEventListener('input', up7)); up7();
  const mode7 = (m) => {
    f7.mode = m; press(['f7-open', 'f7-closed'], m === 'open' ? 'f7-open' : 'f7-closed');
    $('f7-sl').hidden = m !== 'open'; $('f7-cl').hidden = m === 'open';
    if (m === 'open') { f7.s = { ...f7.s, f: f7.s.th }; f7.fsNow = f7.s.w / TAU; }
  };
  $('f7-open').onclick = () => mode7('open'); $('f7-closed').onclick = () => mode7('closed'); mode7('open');

  const cap8 = { a: '左上和右下闭合：电流从左往右穿过线圈，线圈右端是 N。', b: '右上和左下闭合：电流从右往左，线圈左端是 N。不用碰电池，电流就反了。', 0: '全断开：线圈里没有电流。', x: '同一侧上下一起闭合，电池正负极直接短路，电流极大，开关会烧毁。真实控制器会在硬件上禁止这种组合，还会留一小段死区时间。' };
  const set8 = (k) => { f8.st = k; press(['f8-a', 'f8-b', 'f8-0', 'f8-x'], `f8-${k}`); $('f8-cap').textContent = cap8[k]; f8.dirty = true; };
  ['a', 'b', '0', 'x'].forEach((k) => { $(`f8-${k}`).onclick = () => set8(k); }); set8('a');
  const d8 = $('f8-d'), upd8 = () => { f8t.d = d8.value / 100; f8t.dirty = true; $('f8-do').textContent = `${d8.value}%`; };
  d8.addEventListener('input', upd8); upd8();

  initGuess({
    g1: { right: 1, run: () => { f2i.value = -Math.abs(+f2i.value || 12); upd2(); } },
    g2: { right: 0, run: () => setSpin(1) },
    g3: { right: 2, run: () => put5(.7, .7) },
  });

  new MutationObserver(readTokens).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTokens);

  // 字体载入后重绘一次
  document.fonts?.ready.then(() => { figs.forEach((f) => { f.dirty = true; }); });

  let last = performance.now();
  const loop = (t) => {
    const dt = Math.min((t - last) / 1000, .05); last = t;
    if (!document.hidden) {
      for (const f of figs) {
        const moving = (f.visible && !(f instanceof Scope)) ? f.step(dt) : false;
        if (moving || f.dirty) { f.dirty = false; f.render(); }
      }
    }
    requestAnimationFrame(loop);
  };
  // 所有图先走一小步，把状态算出来，保证第一帧完整
  figs.forEach((f) => { if (!(f instanceof Scope)) f.step(.016); f.render(); });
  // 示波图预先填一段，打开时就有波形
  for (let i = 0; i < 300; i++) { f6.auto = true; f6.step(.016); }
  f6.setAuto(false);
  const fsGoal = f7.fs;                 // 预热时慢慢升速，打开页面时是同步状态
  for (let i = 0; i < 700; i++) { f7.fs = Math.min(fsGoal, i * .0012); f7.step(.016); }
  f7.fs = fsGoal;
  s6.render(); s7.render(); f6.render(); f7.render();
  window.__ready = true;
  requestAnimationFrame(loop);
}

main();
