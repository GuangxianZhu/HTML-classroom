// 启蒙篇共用的东西：一步一步展开、路和路牌、能用手指拖着开的车、位置-时间图的格子、先猜一下、练习、上下导航。
// 启蒙篇的读者只有小学数学基础：页面上的字不用字母和符号（test_mech.mjs 会查），位置一律说成“东 30 米 / 西 10 米 / 家门口”。
import { KIDS, kidFile, lessonFile, loadProgress, saveProgress } from './course.js';
import { $, T, txt, drawCar, rr, dot, arrow, NUM } from './ui.js';
import { rng } from './mech.js';

export const CAR_L = 4.76;
/** 东 30 米 / 西 10 米 / 家门口 */
export const place = (x) => { const r = Math.round(x); return r === 0 ? '家门口' : r > 0 ? `东 ${r} 米` : `西 ${-r} 米`; };
const sign = (X) => (X === 0 ? '家' : X > 0 ? `东${X}` : `西${-X}`);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const ease = (u) => { const s = clamp(u, 0, 1); return s * s * (3 - 2 * s); };

// ------------------------------------------------------------------ 一步一步展开
/** 页面里的 .beat 一个一个出来：每一步末尾一个“继续”按钮；data-gate 的那一步要先做到（unlock）按钮才出来。 */
export function beats() {
  const secs = [...document.querySelectorAll('.beat')], end = $('end');
  const order = end ? [...secs, end] : secs;
  const btn = {};
  const open = (i) => {
    const el = order[i]; if (!el || !el.hidden) return;
    el.hidden = false;
    requestAnimationFrame(() => { dispatchEvent(new Event('resize')); el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); });
  };
  secs.forEach((s, i) => {
    if (i > 0) s.hidden = true;
    const row = document.createElement('div'); row.className = 'go-row';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn primary go';
    b.textContent = i + 1 < secs.length ? '继续 ↓' : '做练习 ↓';
    const wait = document.createElement('span'); wait.className = 'wait'; wait.textContent = s.dataset.gate || '';
    if (s.dataset.gate) b.hidden = true; else wait.hidden = true;
    b.addEventListener('click', () => { row.hidden = true; open(i + 1); });
    row.append(b, wait); s.append(row); btn[s.id] = { b, wait };
  });
  if (end) end.hidden = true;
  if (/[?&]all=1/.test(location.search)) setTimeout(() => $('showall')?.click(), 0);   // 检查页面用：一次全部展开
  const all = $('showall');
  all?.addEventListener('click', (e) => { e.preventDefault(); order.forEach((el) => { el.hidden = false; }); document.querySelectorAll('.go-row').forEach((r) => { r.hidden = true; }); dispatchEvent(new Event('resize')); });
  return {
    /** 这一步做到了：出“继续”按钮 */
    unlock(id, msg) { const x = btn[id]; if (!x) return; x.b.hidden = false; x.wait.hidden = !msg; if (msg) { x.wait.textContent = msg; x.wait.classList.add('done'); } },
  };
}

// ------------------------------------------------------------------ 路
/** 一条东西向的路：每 10 米一块路牌（家、东10、西10），家门口一座小房子。y 是路面（车轮压的那条线）。 */
export function road(g, w, y, x0, x1, { lanes = 1, house = true, label = sign, bold = 0 } = {}) {
  const px = w / (x1 - x0), sx = (X) => (X - x0) * px;
  const bh = 26 * lanes + 6;
  g.fillStyle = T.road; g.globalAlpha = .15; g.fillRect(0, y - bh, w, bh + 2); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y + 1); g.lineTo(w, y + 1); g.stroke();
  const step = px * 10 < 34 ? 20 : 10;
  for (let X = Math.ceil(x0 / step) * step; X <= x1; X += step) {
    const cx = sx(X);
    g.strokeStyle = T.ink3; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, y + 1); g.lineTo(cx, y + 8); g.stroke();
    txt(g, label(X), cx, y + 21, { c: X === bold ? T.ink : T.ink3, size: 11.5, w: X === bold ? 700 : 500, a: 'center' });
  }
  if (house && x0 < 0 && x1 > 0) {
    const cx = sx(0), top = y - bh - 4;
    g.fillStyle = T.panel2; g.strokeStyle = T.ink3; g.lineWidth = 1.2;
    g.fillRect(cx - 11, top - 18, 22, 18); g.strokeRect(cx - 11, top - 18, 22, 18);
    g.beginPath(); g.moveTo(cx - 15, top - 18); g.lineTo(cx, top - 29); g.lineTo(cx + 15, top - 18); g.closePath(); g.fill(); g.stroke();
  }
  txt(g, '东 →', w - 4, y - bh - 6, { c: T.ink3, size: 11.5, a: 'right' });
  return { sx, px, toX: (p) => x0 + p / px };
}
/** 路上车画多长（像素）：按真车长放大一点，太小了手机上看不清 */
export const carPx = (px) => Math.max(30, CAR_L * px * 1.25);

// ------------------------------------------------------------------ 拖着开的车
/**
 * 用手指（鼠标）拖着开的车。车追着手指走，但每秒最多 vmax 米，像真车一样不会瞬移。
 * 按下就开始计时，dur 秒后停；每到整秒“拍一张照片”（photos）。demo(t) 给了就是“看示范”，不用拖。
 */
export class Driver {
  constructor({ dur, x = 0, min = -20, max = 60, vmax = 22, onPhoto, onDone, onTick } = {}) {
    Object.assign(this, { dur, x0: x, min, max, vmax, onPhoto, onDone, onTick });
    this.reset();
  }
  reset() { this.x = this.x0; this.target = this.x0; this.t = 0; this.running = false; this.done = false; this.samples = []; this.photos = []; this.demo = null; this.flash = 0; }
  start(demo = null) {
    this.reset(); this.demo = demo; this.running = true;
    this.samples.push({ t: 0, x: this.x }); this.snap(0);
  }
  snap(k) { this.photos.push({ t: k, x: this.x }); this.flash = 1; this.onPhoto?.(k, this.x); }
  step(dt) {
    this.flash = Math.max(0, this.flash - dt * 3);
    if (!this.running) return this.flash > 0;
    const t1 = Math.min(this.dur, this.t + dt);
    if (this.demo) this.x = this.demo(t1);
    else this.x += clamp(this.target - this.x, -this.vmax * (t1 - this.t), this.vmax * (t1 - this.t));
    this.x = clamp(this.x, this.min, this.max);
    this.t = t1;
    this.samples.push({ t: this.t, x: this.x });
    while (this.photos.length <= Math.floor(this.t + 1e-9) && this.photos.length <= this.dur) this.snap(this.photos.length);
    this.onTick?.(this);
    if (this.t >= this.dur - 1e-9) { this.running = false; this.done = true; this.onDone?.(this); }
    return true;
  }
  /** 把画布上的拖动接到车上。hit(px, py) 判断按在路上没有，toX(px) 把横坐标换成米 */
  bind(canvas, fig) {
    let drag = false;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', (e) => {
      const [px, py] = pos(e);
      if (!fig.hit || !fig.hit(px, py)) return;
      drag = true; canvas.setPointerCapture(e.pointerId);
      if (!this.running) this.start();
      if (!this.demo) this.target = clamp(fig.toX(px), this.min, this.max);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => { if (drag && !this.demo) this.target = clamp(fig.toX(pos(e)[0]), this.min, this.max); });
    const up = () => { drag = false; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  }
}
/** 分段匀速的示范：[[秒, 每秒米数], ...] */
export const segTrip = (segs, x0 = 0) => (t) => {
  let x = x0, left = t;
  for (const [dt, v] of segs) { const d = Math.min(dt, Math.max(left, 0)); x += v * d; left -= dt; if (left <= 0) break; }
  return x;
};

/**
 * 不计时的拖车：手指按在画布上，车就跟到哪（fig.toX 把横坐标换成米）。松手时调 onDrop。
 * state = { x }；step 是吸附的格子（米）。
 */
export function freeDrag(fig, state, { min = -20, max = 60, step = 1, onMove, onDrop } = {}) {
  const c = fig.c; let drag = false;
  const px = (e) => e.clientX - c.getBoundingClientRect().left;
  const set = (e) => { if (!fig.toX) return; state.x = clamp(Math.round(fig.toX(px(e)) / step) * step, min, max); fig.dirty = true; onMove?.(state.x); };
  c.addEventListener('pointerdown', (e) => { drag = true; c.setPointerCapture(e.pointerId); set(e); e.preventDefault(); });
  c.addEventListener('pointermove', (e) => { if (drag) set(e); });
  const up = () => { if (drag) { drag = false; onDrop?.(state.x); } };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
}

/** 按住才算数的踏板按钮（油门、刹车）：返回 { down } */
export function hold(id) {
  const b = $(id), st = { down: false };
  const on = (e) => { st.down = true; b.classList.add('held'); e.preventDefault(); }, off = () => { st.down = false; b.classList.remove('held'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') on(e); }); b.addEventListener('keyup', off);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return st;
}

/** 一直往前开的路：车画在固定的地方，路面的线往后退。off 是车已经开出去的米数 */
export function rollRoad(g, w, y, off, px = 6) {
  g.fillStyle = T.road; g.globalAlpha = .15; g.fillRect(0, y - 32, w, 34); g.globalAlpha = 1;
  g.strokeStyle = T.ink3; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y + 1); g.lineTo(w, y + 1); g.stroke();
  const gap = 10 * px, sh = ((off * px) % gap + gap) % gap;
  g.strokeStyle = T.ink3; g.lineWidth = 1.5; g.beginPath();
  for (let x = -sh; x < w + gap; x += gap) { g.moveTo(x, y + 1); g.lineTo(x, y + 8); }
  g.stroke();
}

/** 速度表：v 是千米每小时 */
export function gauge(g, cx, cy, R, v, max = 120) {
  const a0 = Math.PI * .75, sweep = Math.PI * 1.5;
  g.beginPath(); g.arc(cx, cy, R, a0, a0 + sweep); g.strokeStyle = T.line; g.lineWidth = Math.max(4, R * .14); g.stroke();
  for (let k = 0; k <= max; k += 20) {
    const a = a0 + sweep * k / max;
    g.strokeStyle = T.ink3; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx + (R - R * .2) * Math.cos(a), cy + (R - R * .2) * Math.sin(a)); g.lineTo(cx + (R - 2) * Math.cos(a), cy + (R - 2) * Math.sin(a)); g.stroke();
    if (R >= 40) txt(g, `${k}`, cx + (R - R * .38) * Math.cos(a), cy + (R - R * .38) * Math.sin(a) + 4, { c: T.ink3, size: Math.max(9, R * .17), a: 'center', f: NUM });
  }
  const na = a0 + sweep * clamp(v, 0, max) / max;
  arrow(g, cx, cy, cx + (R - R * .25) * Math.cos(na), cy + (R - R * .25) * Math.sin(na), T.v, Math.max(2, R * .06), R * .16);
  g.beginPath(); g.arc(cx, cy, Math.max(2.5, R * .07), 0, Math.PI * 2); g.fillStyle = T.v; g.fill();
  if (R >= 30) { txt(g, `${Math.round(v)}`, cx, cy + R * .62, { c: T.v, size: Math.max(13, R * .36), w: 700, a: 'center', f: NUM }); txt(g, '千米每小时', cx, cy + R * .62 + Math.max(11, R * .22), { c: T.ink3, size: Math.max(9, R * .17), a: 'center' }); }
}

/** 速度-时间图的格子。纵向每 vs 一条线，标 vfmt(v)；note 是左上角那句话 */
export function vtGrid(g, box, { t1, v1, vs = 5, ts = 1, vfmt = (v) => `${v}`, note = '↑ 越往上越快', tl = 1 }) {
  const X = (t) => box.x + t / t1 * box.w, Y = (v) => box.y + box.h - v / v1 * box.h;
  g.lineWidth = 1; g.strokeStyle = T.line; g.beginPath();
  for (let t = 0; t <= t1 + 1e-9; t += ts) { g.moveTo(X(t), box.y); g.lineTo(X(t), box.y + box.h); }
  for (let v = 0; v <= v1 + 1e-9; v += vs) { g.moveTo(box.x, Y(v)); g.lineTo(box.x + box.w, Y(v)); }
  g.stroke();
  g.strokeStyle = T.ink3; g.beginPath(); g.moveTo(box.x, Y(0)); g.lineTo(box.x + box.w, Y(0)); g.stroke();
  for (let t = 0; t <= t1 + 1e-9; t += ts * tl) txt(g, `${t}`, X(t), box.y + box.h + 14, { c: T.ink3, size: 11, a: 'center', f: NUM });
  txt(g, '秒', box.x + box.w + 4, box.y + box.h + 14, { c: T.ink3, size: 11 });
  const every = (box.h / (v1 / vs)) < 15 ? 2 : 1;
  for (let v = 0, k = 0; v <= v1 + 1e-9; v += vs, k++) if (k % every === 0) txt(g, vfmt(v), box.x - 5, Y(v) + 4, { c: T.ink3, size: 11, a: 'right', f: NUM });
  txt(g, '时间往右走 →', box.x + box.w, box.y + box.h + 30, { c: T.ink3, size: 11.5, a: 'right' });
  if (note) txt(g, note, box.x - 4, box.y - 8, { c: T.v, size: 11.5, w: 700 });
  return { X, Y };
}
/** 力的箭头：一律红色，旁边写谁在推（拉、拖）。len 是像素长度，方向用 (dx, dy) 给（不用是单位长度） */
export function farrow(g, x, y, dx, dy, len, label, { side = -1, size = 12.5 } = {}) {
  if (len < 2) return;
  const d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, x1 = x + ux * len, y1 = y + uy * len;
  arrow(g, x, y, x1, y1, T.F, 4, 11);
  if (label) txt(g, label, (x + x1) / 2 - uy * side * -14, (y + y1) / 2 + ux * side * 14 + 4, { c: T.F, size, w: 700, a: 'center' });
}
/** 一串 {t, v} 连成线（速度-时间图用） */
export function vline(g, pts, X, Y, c, lw = 3, alpha = 1) {
  if (pts.length < 2) return;
  g.save(); g.globalAlpha = alpha; g.strokeStyle = c; g.lineWidth = lw; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.v)) : g.moveTo(X(p.t), Y(p.v)))); g.stroke(); g.restore();
}

/**
 * 照着线开车的一关：上面是路和车，下面是位置-时间图，虚线是目标。开完按贴合程度给一到三颗星。
 * o = { canvas, again, hint, target(t), dur, lo, hi（图上从哪到哪，米）, vmax, notes: [[t, x, 字]], onDone(stars) }
 */
export function matchFig(Fig, o) {
  const { dur, lo = -10, hi = 70 } = o;
  let stars = 0;
  const tip = `按住车开始，一共 ${dur} 秒。`;
  const d = new Driver({
    dur, x: o.target(0), min: lo, max: hi, vmax: o.vmax || 30,
    onDone: (dd) => {
      const err = dd.samples.reduce((s, p) => s + Math.abs(p.x - o.target(p.t)), 0) / dd.samples.length;
      stars = err < 3 ? 3 : err < 6 ? 2 : 1;
      $(o.hint).textContent = `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}　${stars === 3 ? '贴得很紧！' : stars === 2 ? '不错。还能贴得更紧。' : '差得有点多，再来一次？'}`;
      o.onDone?.(stars);
    },
  });
  const f = new Fig(o.canvas, { ratio: (w) => (w < 500 ? 1 : .68), maxH: 470, minH: 340 });
  d.bind(f.c, f);
  $(o.again).addEventListener('click', () => { d.reset(); stars = 0; $(o.hint).textContent = tip; f.dirty = true; });
  $(o.hint).textContent = tip;
  f.step = (dt) => d.step(dt);
  f.draw = function (g, w, h) {
    const y = 66, R = road(g, w, y, lo - 4, hi + 4), L = carPx(R.px);
    this.toX = R.toX; this.hit = (px, py) => py < y + 26;
    carAt(g, R.sx(d.x), y - L * .2, L, {});
    const box = { x: 56, y: 118, w: w - 74, h: h - 118 - 44 };
    const { X, Y } = ptGrid(g, box, { t1: dur, x0: lo, x1: hi, xs: 10, ts: 1 });
    const tg = []; for (let k = 0; k <= dur * 10; k++) tg.push({ t: k / 10, x: o.target(k / 10) });
    g.save(); g.setLineDash([7, 6]); line(g, tg, X, Y, T.ink3, 5, .55); g.restore();
    for (const [t, x, s, a] of o.notes || []) txt(g, s, X(t), Y(x), { c: T.ink3, size: 12, a: a || 'center' });
    line(g, d.samples, X, Y, T.x, 3);
    if (d.samples.length) { const s = d.samples[d.samples.length - 1]; dot(g, X(s.t), Y(s.x), T.x, 5); }
  };
  return { fig: f, driver: d };
}

// ------------------------------------------------------------------ 位置-时间图（启蒙篇的写法：没有“横轴、坐标”，只有“时间往右走、越往上越靠东”）
export function ptGrid(g, box, { t1, x0, x1, xs = 10, ts = 1, labels = true }) {
  const X = (t) => box.x + t / t1 * box.w, Y = (x) => box.y + box.h - (x - x0) / (x1 - x0) * box.h;
  g.lineWidth = 1; g.strokeStyle = T.line; g.beginPath();
  for (let t = 0; t <= t1 + 1e-9; t += ts) { g.moveTo(X(t), box.y); g.lineTo(X(t), box.y + box.h); }
  for (let x = Math.ceil(x0 / xs) * xs; x <= x1 + 1e-9; x += xs) { g.moveTo(box.x, Y(x)); g.lineTo(box.x + box.w, Y(x)); }
  g.stroke();
  if (x0 < 0) { g.strokeStyle = T.ink3; g.beginPath(); g.moveTo(box.x, Y(0)); g.lineTo(box.x + box.w, Y(0)); g.stroke(); }
  if (labels) {
    for (let t = 0; t <= t1 + 1e-9; t += ts) txt(g, `${t}`, X(t), box.y + box.h + 14, { c: T.ink3, size: 11, a: 'center', f: NUM });
    txt(g, '秒', box.x + box.w + 4, box.y + box.h + 14, { c: T.ink3, size: 11 });
    const yl = (box.h / ((x1 - x0) / xs)) < 16 ? xs * 2 : xs;
    for (let x = Math.ceil(x0 / yl) * yl; x <= x1 + 1e-9; x += yl) txt(g, sign(x), box.x - 5, Y(x) + 4, { c: x === 0 ? T.ink : T.ink3, size: 11, a: 'right', w: x === 0 ? 700 : 500 });
    txt(g, '时间往右走 →', box.x + box.w, box.y + box.h + 30, { c: T.ink3, size: 11.5, a: 'right' });
    txt(g, '↑ 越往上越靠东', box.x - 4, box.y - 8, { c: T.x, size: 11.5, w: 700 });
  }
  return { X, Y };
}
/** 一串 {t, x} 连成线 */
export function line(g, pts, X, Y, c, lw = 3, alpha = 1) {
  if (pts.length < 2) return;
  g.save(); g.globalAlpha = alpha; g.strokeStyle = c; g.lineWidth = lw; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.x)) : g.moveTo(X(p.t), Y(p.x)))); g.stroke(); g.restore();
}
/** 照相的闪光 */
export function flash(g, w, h, a) { if (a <= 0) return; g.fillStyle = '#fff'; g.globalAlpha = a * .45; g.fillRect(0, 0, w, h); g.globalAlpha = 1; }
/** 画一辆转了角度的车（rot = -π/2 是车头朝上），cx, cy 是车的中心 */
export function carAt(g, cx, cy, L, { rot = 0, color, alpha = 1 } = {}) {
  g.save(); g.translate(cx, cy); g.rotate(rot); drawCar(g, 0, L * .15, L, { color, alpha }); g.restore();
}
export { rr, dot };

// ------------------------------------------------------------------ 先猜一下
/**
 * GUESS[key] = { right, text, later?, run? }。later 的题先不说对错（“玩完就知道”），等 reveal(key) 再亮答案。
 */
export function kidGuesses(GUESS) {
  const box = {};
  document.querySelectorAll('.guess').forEach((el) => {
    const key = el.dataset.guess, gq = GUESS[key], btns = [...el.querySelectorAll('.btn')], r = el.querySelector('.r');
    box[key] = { el, btns, r, gq, pick: -1 };
    btns.forEach((b, i) => b.addEventListener('click', () => {
      box[key].pick = i;
      if (gq.later && !box[key].shown) {
        btns.forEach((x, j) => x.setAttribute('aria-pressed', j === i));
        r.hidden = false; r.textContent = gq.wait || '记下了。往下玩一玩，答案自己会出来。';
      } else show(key);
      gq.run?.(i);
    }));
  });
  const show = (key) => {
    const x = box[key]; x.shown = true;
    x.btns.forEach((b, j) => { b.removeAttribute('aria-pressed'); b.classList.toggle('right', j === x.gq.right); b.classList.toggle('wrong', j === x.pick && x.pick !== x.gq.right); });
    x.r.hidden = false; x.r.textContent = (x.pick < 0 ? '' : x.pick === x.gq.right ? '你猜对了。' : '你一开始猜的不对，没关系。') + x.gq.text;
  };
  return {
    reveal(key) { if (box[key]) show(key); },
    picked: (key) => box[key]?.pick ?? -1,
    /** 把“你一开始猜的是……”写进某个元素 */
    echo(key, id) { const x = box[key], el = $(id); if (!x || !el) return; el.textContent = x.pick < 0 ? '你刚才没猜。' : `你一开始猜的是：“${x.btns[x.pick].textContent}”`; },
  };
}

// ------------------------------------------------------------------ 练习：数字每次都变，答完一道马上讲
export function kidQuiz(n, gens) {
  const box = $('quiz'), key = `k${n}`, nx = KIDS.find((k) => k.n === n + 1);
  let qs = [], i = 0, right = 0, picked = false;
  const fresh = () => {
    const r = rng();
    qs = gens.map((gen) => { const q = gen(r); const order = r.shuffle(q.opts.map((_, k) => k)); return { ...q, opts: order.map((k) => q.opts[k]), ans: order.indexOf(q.ans) }; });
    i = 0; right = 0; show();
  };
  const show = () => {
    picked = false;
    if (i >= qs.length) {
      const best = Math.max(right, loadProgress()[key]?.best || 0);
      saveProgress(key, { done: true, best });
      box.innerHTML = `<div class="qhead"><span>练习</span><b>${right} / ${qs.length}</b></div>
        <p class="qtext">${right === qs.length ? '全对！' : '错的那几道，回到上面再玩一遍。'}这一课最好成绩 ${best} / ${qs.length}。</p>
        <div class="row"><button class="btn primary" type="button" id="qagain">再来一组（数字会变）</button>${nx?.ready ? `<a class="btn" href="${kidFile(n + 1)}">下一小课 →</a>` : ''}</div>`;
      $('qagain').addEventListener('click', fresh);
      return;
    }
    const q = qs[i];
    box.innerHTML = `<div class="qhead"><span>练习 ${i + 1} / ${qs.length}</span><b>${right} 对</b></div>
      <p class="qtext">${q.q}</p>
      <div class="qopts">${q.opts.map((o, k) => `<button class="btn" type="button" data-k="${k}">${o}</button>`).join('')}</div>
      <p class="qwhy" hidden></p>
      <div class="row" hidden id="qnextrow"><button class="btn primary" type="button" id="qnext">${i + 1 < qs.length ? '下一题' : '看成绩'}</button></div>`;
    box.querySelectorAll('.qopts .btn').forEach((b) => b.addEventListener('click', () => {
      if (picked) return;
      picked = true;
      const k = +b.dataset.k, ok = k === q.ans;
      if (ok) right++;
      box.querySelectorAll('.qopts .btn').forEach((x, j) => { x.classList.toggle('right', j === q.ans); x.classList.toggle('wrong', j === k && !ok); });
      const why = box.querySelector('.qwhy'); why.hidden = false; why.innerHTML = `<b>${ok ? '对。' : '不对。'}</b>${q.why}`;
      $('qnextrow').hidden = false;
      $('qnext').addEventListener('click', () => { i++; show(); });
    }));
  };
  fresh();
}

// ------------------------------------------------------------------ 上下导航
export function kidChrome(n) {
  const L = KIDS.find((k) => k.n === n), prev = KIDS.find((k) => k.n === n - 1), next = KIDS.find((k) => k.n === n + 1);
  $('top').innerHTML = `<a href="../index.html">← 力学课目录</a><span class="where">启蒙 · 第 ${n} 小课 / 共 ${KIDS.length} 小课</span>
    <span class="pn">${prev?.ready ? `<a href="${kidFile(n - 1)}">← 上一小课</a>` : ''}${next?.ready ? `<a href="${kidFile(n + 1)}">下一小课 →</a>` : ''}</span>`;
  $('recap').innerHTML = prev
    ? `<span class="tag">上一小课${prev.ready ? '' : '（还在做）'}</span>${prev.ready ? `<a href="${kidFile(n - 1)}">${prev.title}</a>` : `<b>${prev.title}</b>`}<p>${prev.got}</p>`
    : '<span class="tag">从这里开始</span><p>只要会小学数学。</p>';
  $('ask').textContent = L.ask;
  $('got').textContent = L.got;
  $('backlink').innerHTML = `<a href="${lessonFile(L.back)}">高中第 ${L.back} 课</a>`;
  $('next').innerHTML = next
    ? `<span class="tag">留一个问题给下一小课</span><p class="big">${next.ask}</p><p>第 ${next.n} 小课 · ${next.title}${next.ready ? `　<a class="btn primary" href="${kidFile(n + 1)}">去下一小课 →</a>` : '（还在做）'}</p>`
    : '';
}
