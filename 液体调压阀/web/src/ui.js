// 页面通用小工具：画布适配、取主题色、数字格式
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
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export const sup = (n) => String(n).split('').map((c) => SUP[c] ?? c).join('');
export function sci(x, dig = 1) {
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e < 4) return x.toLocaleString('en-US', { maximumFractionDigits: x < 1 ? 3 : x < 100 ? 1 : 0 });
  const m = x / 10 ** e;
  return `${m.toFixed(dig)}×10${sup(e)}`;
}
export function bind(id, fn) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => fn(+el.value, el));
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
// 悬停提示：图表共用一个
export function tooltip() {
  const t = document.getElementById('charttip');
  return {
    show(html, x, y) {
      t.innerHTML = html; t.hidden = false;
      const r = t.getBoundingClientRect();
      const px = Math.min(window.innerWidth - r.width - 8, x + 14);
      t.style.left = `${Math.max(8, px)}px`;
      t.style.top = `${Math.max(8, y - r.height - 12)}px`;
    },
    hide() { t.hidden = true; },
  };
}
export const logX = (v, a, b, x0, x1) => x0 + (Math.log10(v) - Math.log10(a)) / (Math.log10(b) - Math.log10(a)) * (x1 - x0);
export const invLog = (px, a, b, x0, x1) => 10 ** (Math.log10(a) + (px - x0) / (x1 - x0) * (Math.log10(b) - Math.log10(a)));
export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
