// 每一课共用的东西：画布图、滑块、先猜一下、练习题、页面上下的课程导航、画车。
import { LESSONS, PARTS, QUANTS, known, lessonFile, loadProgress, saveProgress } from './course.js';
import { rng } from './mech.js';

export const $ = (id) => document.getElementById(id);
export const TAU = Math.PI * 2;
export const T = {};
const NAMES = ['panel', 'panel2', 'ink', 'ink2', 'ink3', 'line', 'x', 'v', 'a', 'F', 'm', 'E', 'p', 'ok', 'no', 'road'];
export const FONT = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
export const NUM = '"Barlow Condensed","Arial Narrow","Helvetica Neue",Arial,sans-serif';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const figs = [];

export function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  for (const n of NAMES) T[n] = cs.getPropertyValue(`--${n}`).trim();
  figs.forEach((f) => { f.dirty = true; });
}

const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { e.target._fig.visible = e.isIntersecting; }), { rootMargin: '60px' }) : null;

/** 一张画布图。draw(g, w, h) 画一帧；step(dt) 返回 true 表示还在动 */
export class Fig {
  constructor(id, { ratio = .62, maxH = 420, minH = 200 } = {}) {
    this.c = $(id); this.g = this.c.getContext('2d'); this.ratio = ratio; this.maxH = maxH; this.minH = minH;
    this.visible = true; this.dirty = true; this.c._fig = this;
    if (io) io.observe(this.c);
    if (window.ResizeObserver) new ResizeObserver(() => { this.dirty = true; }).observe(this.c.parentElement);
    figs.push(this);
  }
  size() {
    const w = this.c.parentElement.clientWidth - 20;
    if (w <= 0) return;
    const r = typeof this.ratio === 'function' ? this.ratio(w) : this.ratio;
    const h = Math.max(this.minH, Math.min(this.maxH, Math.round(w * r)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.w === w && this.h === h) return;
    this.w = w; this.h = h; this.c.style.height = `${h}px`;
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); this.dpr = dpr;
  }
  render() {
    this.size();
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = T.panel; g.fillRect(0, 0, this.w, this.h);
    this.draw(g, this.w, this.h);
  }
  step() { return false; }
}

/** 每帧：屏幕里的图要么在动、要么有改动才重画 */
export function start() {
  readTokens();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', readTokens);
  new MutationObserver(readTokens).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  for (const f of figs) { f.render(); f.dirty = false; }
  // 右边的图比屏幕还高时就不钉住，不然上半截或下面的滑块会看不见
  const pins = [...document.querySelectorAll('.sec>.f')];
  const fit = () => { for (const el of pins) el.style.position = el.offsetHeight > innerHeight - 24 ? 'static' : ''; };
  fit(); addEventListener('resize', fit);
  if (window.ResizeObserver) { const ro = new ResizeObserver(fit); pins.forEach((el) => ro.observe(el)); }
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    for (const f of figs) {
      if (!f.visible) continue;
      const moving = !REDUCED && f.step(dt);
      if (moving || f.dirty) { f.render(); f.dirty = false; }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ 数字和小部件
export const f0 = (x) => (Math.abs(x) < 0.5 ? '0' : Math.round(x).toString());
export const f1 = (x) => (Math.abs(x) < 0.05 ? '0' : (+x).toFixed(1));
export const f2 = (x) => (Math.abs(x) < 0.005 ? '0' : (+x).toFixed(2));
/** 带正负号：+3、−2.5（用真正的减号） */
export const sg = (x, f = f1) => { const s = f(x); return s === '0' ? '0' : x > 0 ? `+${s}` : s.replace('-', '−'); };
export const mi = (s) => String(s).replace(/-/g, '−');
export const Q = (c, s) => `<span class="q${c}">${s}</span>`;
export const calc = (id, lines) => { const h = lines.map((l) => `<div>${l}</div>`).join(''); if ($(id).innerHTML !== h) $(id).innerHTML = h; };
export const kpis = (id, items) => {
  const h = items.map(([k, v, u, c]) => `<div class="kpi"><span>${k}</span><b${c ? ` class="q${c}"` : ''}>${v}</b><small>${u || ''}</small></div>`).join('');
  if ($(id).innerHTML !== h) $(id).innerHTML = h;
};
/** 滑块：id 对应 <input id> 和 <output id="{id}o"> */
export function ctl(id, fmt, cb) {
  const el = $(id), out = $(`${id}o`);
  const upd = () => { out.textContent = fmt(+el.value); cb?.(); };
  el.addEventListener('input', upd);
  out.textContent = fmt(+el.value);
  return { get v() { return +el.value; }, set(v) { el.value = v; upd(); }, el, upd };
}
/** 一组互斥按钮：[data-v] */
export function seg(id, cb) {
  const box = $(id), btns = [...box.querySelectorAll('button')];
  const api = {
    v: btns.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.v ?? btns[0].dataset.v,
    set(v) { api.v = v; btns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v)); cb?.(v); },
  };
  btns.forEach((b) => b.addEventListener('click', () => api.set(b.dataset.v)));
  btns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === api.v));
  return api;
}

// ------------------------------------------------------------------ 画图的小工具
export function txt(g, s, x, y, { c = T.ink, size = 13, w = 500, a = 'left', b = 'alphabetic', f = FONT } = {}) {
  if (f === NUM && /[一-鿿]/.test(s)) { f = FONT; size *= .9; }
  if (/[·²]/.test(s)) f = `"Helvetica Neue",Arial,"Liberation Sans","DejaVu Sans",${f}`;
  g.fillStyle = c; g.font = `${w} ${size}px ${f}`; g.textAlign = a; g.textBaseline = b; g.fillText(s, x, y);
}
export function arrow(g, x0, y0, x1, y1, c, lw = 3, head = 9) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return;
  const a = Math.atan2(y1 - y0, x1 - x0), hd = Math.min(head, len * .6);
  g.strokeStyle = c; g.fillStyle = c; g.lineWidth = lw; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 - Math.cos(a) * hd * .6, y1 - Math.sin(a) * hd * .6); g.stroke();
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - hd * Math.cos(a - .45), y1 - hd * Math.sin(a - .45)); g.lineTo(x1 - hd * Math.cos(a + .45), y1 - hd * Math.sin(a + .45)); g.closePath(); g.fill();
}
export function rr(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
export const dot = (g, x, y, c, r = 5) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = c; g.fill(); g.strokeStyle = T.panel; g.lineWidth = 2; g.stroke(); };
export function vline(g, x, box, c = T.ink3) { g.strokeStyle = c; g.lineWidth = 1; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(x, box.y); g.lineTo(x, box.y + box.h); g.stroke(); g.setLineDash([]); }
export const plotBox = (x, y, w, h) => ({ x, y, w, h });
/** 坐标轴。o: { x0, x1, y0, y1, xs, ys（刻度间隔）, xlab, ylab, yc（y 轴文字颜色）, xfmt, yfmt } */
export function axes(g, box, o) {
  const { x, y, w, h } = box;
  const X = (v) => x + (v - o.x0) / (o.x1 - o.x0) * w, Y = (v) => y + h - (v - o.y0) / (o.y1 - o.y0) * h;
  g.lineWidth = 1; g.strokeStyle = T.line; g.beginPath();
  for (let v = Math.ceil(o.x0 / o.xs) * o.xs; v <= o.x1 + 1e-9; v += o.xs) { g.moveTo(X(v), y); g.lineTo(X(v), y + h); }
  for (let v = Math.ceil(o.y0 / o.ys) * o.ys; v <= o.y1 + 1e-9; v += o.ys) { g.moveTo(x, Y(v)); g.lineTo(x + w, Y(v)); }
  g.stroke();
  if (o.y0 < 0 && o.y1 > 0) { g.strokeStyle = T.ink3; g.beginPath(); g.moveTo(x, Y(0)); g.lineTo(x + w, Y(0)); g.stroke(); }
  const xl = o.xlabEvery || 1;
  let k = 0;
  for (let v = Math.ceil(o.x0 / o.xs) * o.xs; v <= o.x1 + 1e-9; v += o.xs, k++) if (k % xl === 0) txt(g, o.xfmt ? o.xfmt(v) : mi(f0(v)), X(v), y + h + 13, { c: T.ink3, size: 11, a: 'center', f: NUM });
  for (let v = Math.ceil(o.y0 / o.ys) * o.ys; v <= o.y1 + 1e-9; v += o.ys) txt(g, o.yfmt ? o.yfmt(v) : mi(f0(v)), x - 5, Y(v) + 4, { c: o.yc || T.ink3, size: 11, a: 'right', f: NUM });
  if (o.xlab) txt(g, o.xlab, x + w, y + h + 27, { c: T.ink3, size: 11.5, a: 'right' });
  if (o.ylab) txt(g, o.ylab, x - 4, y - 7, { c: o.yc || T.ink3, size: 11.5, w: 700 });
  return { X, Y };
}
export function curve(g, f, t0, t1, X, Y, box, { c, lw = 2.5, dash = null, n = 200, alpha = 1 } = {}) {
  g.save(); g.beginPath(); g.rect(box.x - 1, box.y - 2, box.w + 2, box.h + 4); g.clip();
  g.strokeStyle = c; g.lineWidth = lw; g.globalAlpha = alpha; g.setLineDash(dash || []); g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  let pen = false;
  for (let k = 0; k <= n; k++) {
    const t = t0 + (t1 - t0) * k / n, v = f(t);
    if (!Number.isFinite(v)) { pen = false; continue; }
    if (pen) g.lineTo(X(t), Y(v)); else { g.moveTo(X(t), Y(v)); pen = true; }
  }
  g.stroke(); g.restore();
}
/** 曲线和 y = 0 之间涂色（v-t 图的面积） */
export function fillUnder(g, f, t0, t1, X, Y, c, alpha = .22, n = 120) {
  if (t1 <= t0) return;
  g.beginPath(); g.moveTo(X(t0), Y(0));
  for (let k = 0; k <= n; k++) { const t = t0 + (t1 - t0) * k / n; g.lineTo(X(t), Y(f(t))); }
  g.lineTo(X(t1), Y(0)); g.closePath(); g.fillStyle = c; g.globalAlpha = alpha; g.fill(); g.globalAlpha = 1;
}

/** 那辆车的侧影：直板三厢，车头朝右（dir = -1 朝左）。x 是车中心，ground 是地面的 y，L 是车长（像素） */
export function drawCar(g, x, ground, L, { dir = 1, wheel = 0, color = T.ink2, alpha = 1 } = {}) {
  const s = L / 4.76, R = 0.32 * s;
  g.save(); g.globalAlpha = alpha; g.translate(x, ground); g.scale(dir, 1);
  const P = (pts) => { g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a * s, -b * s) : g.moveTo(a * s, -b * s))); g.closePath(); };
  P([[-2.38, 0.33], [2.36, 0.33], [2.38, 0.62], [2.30, 0.92], [1.15, 0.97], [0.62, 1.42], [-0.95, 1.44], [-1.55, 1.0], [-2.36, 0.98], [-2.4, 0.62]]);
  g.fillStyle = color; g.fill();
  P([[0.56, 1.0], [0.14, 1.0], [0.14, 1.33], [0.5, 1.33]]); g.fillStyle = T.panel2; g.globalAlpha = alpha * .85; g.fill();
  P([[0.04, 1.0], [-0.95, 1.0], [-0.92, 1.35], [0.04, 1.35]]); g.fill();
  P([[-1.05, 1.0], [-1.45, 1.0], [-1.0, 1.34]]); g.fill();
  g.globalAlpha = alpha;
  g.fillStyle = '#F2C14E'; g.fillRect(2.28 * s, -0.84 * s, 0.1 * s, 0.14 * s);
  g.fillStyle = '#D94A3A'; g.fillRect(-2.42 * s, -0.86 * s, 0.08 * s, 0.14 * s);
  for (const wx of [1.4, -1.4]) {
    g.beginPath(); g.arc(wx * s, -R, R, 0, TAU); g.fillStyle = '#20262c'; g.fill();
    g.beginPath(); g.arc(wx * s, -R, R * .55, 0, TAU); g.fillStyle = '#9aa4ad'; g.fill();
    g.strokeStyle = '#20262c'; g.lineWidth = Math.max(1, R * .12);
    for (let k = 0; k < 4; k++) { const a = wheel + k * Math.PI / 2; g.beginPath(); g.moveTo(wx * s, -R); g.lineTo(wx * s + R * .5 * Math.cos(a), -R + R * .5 * Math.sin(a)); g.stroke(); }
  }
  g.restore();
}

// ------------------------------------------------------------------ 先猜一下
/** 页面里每个 .guess[data-guess]：GUESS[key] = { right, text, run? } */
export function guesses(GUESS) {
  document.querySelectorAll('.guess').forEach((el) => {
    const gq = GUESS[el.dataset.guess], btns = [...el.querySelectorAll('.btn')], r = el.querySelector('.r');
    btns.forEach((b, i) => b.addEventListener('click', () => {
      btns.forEach((x, j) => { x.classList.toggle('right', j === gq.right); x.classList.toggle('wrong', j === i && i !== gq.right); });
      r.hidden = false; r.textContent = (i === gq.right ? '猜对了。' : '不对。') + gq.text;
      gq.run?.();
    }));
  });
}

// ------------------------------------------------------------------ 练习题：每组 5 道，数字随机，答完一道马上讲解
export function quiz(n, gens) {
  const box = $('quiz');
  let qs = [], i = 0, right = 0, picked = false;
  const fresh = () => {
    const r = rng();
    qs = gens.map((gen) => { const q = gen(r); const order = r.shuffle(q.opts.map((_, k) => k)); return { ...q, opts: order.map((k) => q.opts[k]), ans: order.indexOf(q.ans) }; });
    i = 0; right = 0; show();
  };
  const show = () => {
    picked = false;
    if (i >= qs.length) {
      const best = Math.max(right, loadProgress()[n]?.best || 0);
      saveProgress(n, { done: true, best });
      box.innerHTML = `<div class="qhead"><span>练习</span><b>${right} / ${qs.length}</b></div>
        <p class="qtext">${right === qs.length ? '全对。' : right >= qs.length - 1 ? '差一点就全对了。' : '错的那几道，回到上面对应的图里再拖一拖。'}这一课最好成绩 ${best} / ${qs.length}。</p>
        <div class="row"><button class="btn primary" type="button" id="qagain">再来一组（数字会变）</button>${n < LESSONS.length && LESSONS[n].ready ? `<a class="btn" href="${lessonFile(n + 1)}">下一课 →</a>` : ''}</div>`;
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

// ------------------------------------------------------------------ 每课页面上下的课程导航
export function chrome(n) {
  const L = LESSONS.find((l) => l.n === n), prev = LESSONS.find((l) => l.n === n - 1), next = LESSONS.find((l) => l.n === n + 1);
  const part = PARTS.find((p) => p.id === L.part);
  $('top').innerHTML = `<a href="../index.html">← 力学课目录</a><span class="where">${part.level} · ${part.name} · 第 ${n} 课 / 共 ${LESSONS.length} 课</span>
    <span class="pn">${prev ? `<a href="${lessonFile(n - 1)}" title="${prev.title}">← 上一课</a>` : ''}${next?.ready ? `<a href="${lessonFile(n + 1)}" title="${next.title}">下一课 →</a>` : ''}</span>`;
  $('recap').innerHTML = prev
    ? `<span class="tag">上一课</span><a href="${lessonFile(n - 1)}">第 ${prev.n} 课 · ${prev.title}</a><p>${prev.got}</p>`
    : '<span class="tag">从这里开始</span><p>不用任何基础。每一课先猜一题，再拖一拖图，最后做 5 道练习题，数字每次都会变。</p>';
  $('ask').textContent = L.ask;
  const kn = known(n);
  $('quants').innerHTML = QUANTS.map((q) => {
    const st = (L.adds || []).includes(q.k) ? 'new' : kn.has(q.k) ? 'on' : 'off';
    return `<li class="${st}" title="${q.name}（${q.unit}）"><i style="background:var(--${q.c})"></i><b>${q.k}</b><span>${q.name}</span>${st === 'new' ? '<em>这一课新认识</em>' : ''}</li>`;
  }).join('');
  $('got').textContent = L.got;
  $('next').innerHTML = next
    ? `<span class="tag">留一个问题给下一课</span><p class="big">${next.ask}</p><p>第 ${next.n} 课 · ${next.title}${next.ready ? `　<a class="btn primary" href="${lessonFile(n + 1)}">去下一课 →</a>` : '（还在做）'}</p>`
    : '';
}
