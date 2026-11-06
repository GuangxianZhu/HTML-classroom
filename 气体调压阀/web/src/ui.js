// 页面通用小工具：画布适配、取主题色、坐标轴
export const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export function fit(cv) {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w: r.width, h: r.height };
}
export function bind(id, fn, fmt) {
  const el = document.getElementById(id);
  const out = document.getElementById(id + '_o');
  const go = () => { if (out && fmt) out.textContent = fmt(+el.value); fn(+el.value, el); };
  el.addEventListener('input', go);
  if (out && fmt) out.textContent = fmt(+el.value);
  return el;
}
export function set(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
export const onTheme = (fn) => {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', fn);
  new MutationObserver(fn).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
};
export function whenVisible(el, cb) {
  let vis = false;
  new IntersectionObserver((e) => { vis = e[0].isIntersecting; cb && cb(vis); }, { threshold: 0.02 }).observe(el);
  return () => vis;
}
export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 一张折线图的坐标系：返回 X(v)、Y(v) 换算和画线函数
export function plot(c, w, h, o) {
  const L = o.L ?? 52, R = o.R ?? 14, T = o.T ?? 14, B = o.B ?? 36;
  const [x0, x1] = o.x, [y0, y1] = o.y;
  const X = (v) => L + (v - x0) / (x1 - x0) * (w - L - R);
  const Y = (v) => h - B - (v - y0) / (y1 - y0) * (h - T - B);
  const ink3 = css('--ink3'), line = css('--line');
  c.font = '500 11px ' + css('--mono');
  c.lineWidth = 1;
  c.textBaseline = 'middle';
  for (const t of o.yt || []) {
    c.strokeStyle = line; c.globalAlpha = 0.8; c.beginPath(); c.moveTo(L, Y(t)); c.lineTo(w - R, Y(t)); c.stroke(); c.globalAlpha = 1;
    c.fillStyle = ink3; c.textAlign = 'right'; c.fillText(o.yf ? o.yf(t) : t, L - 6, Y(t));
  }
  c.textAlign = 'center';
  for (const t of o.xt || []) {
    c.strokeStyle = line; c.beginPath(); c.moveTo(X(t), h - B); c.lineTo(X(t), h - B + 4); c.stroke();
    c.fillStyle = ink3; c.fillText(o.xf ? o.xf(t) : t, X(t), h - B + 13);
  }
  c.strokeStyle = css('--ink2'); c.beginPath(); c.moveTo(L, T - 4); c.lineTo(L, h - B); c.lineTo(w - R, h - B); c.stroke();
  c.fillStyle = ink3; c.font = '500 12px ' + css('--sans');
  if (o.xl) { c.textAlign = 'center'; c.fillText(o.xl, (L + w - R) / 2, h - 9); }
  if (o.yl) { c.save(); c.translate(13, (T + h - B) / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillText(o.yl, 0, 0); c.restore(); }
  const ln = (pts, col, lw = 2, dash = null) => {
    c.save(); c.beginPath(); c.rect(L, T - 6, w - L - R + 2, h - T - B + 6); c.clip();
    c.strokeStyle = col; c.lineWidth = lw; c.lineJoin = 'round'; if (dash) c.setLineDash(dash);
    c.beginPath(); pts.forEach(([a, b], i) => (i ? c.lineTo(X(a), Y(b)) : c.moveTo(X(a), Y(b)))); c.stroke(); c.restore();
  };
  const dot = (a, b, col, r = 4.5) => { c.fillStyle = col; c.beginPath(); c.arc(X(a), Y(b), r, 0, 7); c.fill(); c.strokeStyle = css('--panel'); c.lineWidth = 1.5; c.stroke(); };
  const label = (a, b, txt, col, align = 'left', dy = 0) => { c.font = '500 12px ' + css('--sans'); c.fillStyle = col; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(txt, X(a) + (align === 'left' ? 7 : align === 'right' ? -7 : 0), Y(b) + dy); };
  return { X, Y, ln, dot, label, L, R, T, B };
}
