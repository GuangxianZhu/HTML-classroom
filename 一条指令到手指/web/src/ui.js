// 各关共用的小部件
import * as C from './core.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const fmt = (x, d = 1) => Number(x).toFixed(d);

export const takeaway = (t) => `<p class="take"><b>记住</b>${t}</p>`;
// 依据：每条前面标上这句话有多可靠
export const basis = (items) => `<div class="basis">${items.map(([k, t]) => `<p><span class="k">${k}</span>${t}</p>`).join('')}</div>`;
export const where = (t) => `<p class="where"><b>这一站</b>　${t}</p>`;

// 先猜：点一个选项，立刻给反馈；可以改主意重选
export function quiz(host, { q, options, onAnswer }) {
  const box = el(`<div class="quiz"><p class="q">${q}</p><div class="opts"></div><p class="fb" hidden></p></div>`);
  const fb = $('.fb', box);
  options.forEach((o) => {
    const b = el(`<button type="button">${o.t}</button>`);
    b.addEventListener('click', () => {
      $$('button', box).forEach((x) => x.classList.remove('right', 'wrong'));
      b.classList.add(o.ok ? 'right' : 'wrong');
      fb.hidden = false; fb.className = 'fb ' + (o.ok ? 'right' : 'wrong');
      fb.innerHTML = (o.ok ? '<b class="good">对。</b>' : '<b class="bad">不是这个。</b>') + o.why;
      if (onAnswer) onAnswer(o.ok);
    });
    $('.opts', box).append(b);
  });
  host.append(box);
  return box;
}

// 任务清单。返回 done(i)
export function tasks(host, items) {
  const ul = el(`<ul class="tasks">${items.map((t) => `<li>${t}</li>`).join('')}</ul>`);
  host.append(ul);
  return (i) => { const li = ul.children[i]; if (li) li.classList.add('done'); };
}

// 滑块
export function slider(host, { label, min, max, step = 1, value, show = (v) => v, onInput }) {
  const id = 's' + Math.random().toString(36).slice(2, 8);
  const box = el(`<label class="slider" for="${id}"><span class="row"><span>${label}</span><span class="val"></span></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`);
  const inp = $('input', box), val = $('.val', box);
  const paint = () => { val.textContent = show(+inp.value); };
  inp.addEventListener('input', () => { paint(); onInput(+inp.value); });
  paint(); host.append(box);
  return { get value() { return +inp.value; }, set(v) { inp.value = v; paint(); }, el: box, input: inp };
}

// 一排互斥的按钮
export function seg(host, { label, options, value, onChange }) {
  const box = el(`<div class="seg">${label ? `<span class="lab">${label}</span>` : ''}</div>`);
  let cur = value;
  const paint = () => $$('button', box).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(cur))));
  options.forEach(([v, t]) => {
    const b = el(`<button type="button" data-v="${v}">${t}</button>`);
    b.addEventListener('click', () => { cur = v; paint(); onChange(v); });
    box.append(b);
  });
  paint(); host.append(box);
  return { get value() { return cur; }, set(v) { cur = v; paint(); } };
}

// 一组读数格子：[{k, v, cls}]
export function stats(host) {
  const box = el('<div class="stats"></div>'); host.append(box);
  return (items) => { box.innerHTML = items.map((s) => `<div class="stat ${s.cls || ''}"><span class="k">${s.k}</span><span class="v">${s.v}</span></div>`).join(''); };
}

// 数据包：一串按字段上色的字节。onByte(i) 点字节；sel = 选中的字段 key；broken = 被弄坏的下标
const FIELD_KEYS = [['head', '包头'], ['id', 'ID'], ['len', '长度'], ['inst', '指令'], ['addr', '地址'], ['data', '数值'], ['crc', '校验']];
export function bytesView(host, { onByte } = {}) {
  const box = el('<div class="bytes"></div>'); host.append(box);
  return (bytes, { sel = null, broken = [], selByte = -1 } = {}) => {
    const f = C.fields(bytes);
    box.innerHTML = '';
    bytes.forEach((b, i) => {
      const fld = f.find((x) => i >= x.from && i < x.to);
      const e = el(`<${onByte ? 'button type="button"' : 'span'} class="f-${fld ? fld.key : 'data'}">${C.hex2(b)}</${onByte ? 'button' : 'span'}>`);
      if (fld && fld.key === sel) e.classList.add('sel');
      if (i === selByte) e.classList.add('sel');
      if (broken.includes(i)) e.classList.add('broken');
      if (onByte) e.addEventListener('click', () => onByte(i, fld));
      box.append(e);
    });
    return f;
  };
}
export const fieldKey = () => `<div class="keyline">${FIELD_KEYS.map(([k, n]) => `<span><i class="bytes f-${k}" style="display:inline-block"></i>${n}</span>`).join('')}</div>`;

// 电压条：门限随电源电压变
export function vbar(host) {
  const box = el('<div><div class="vbar" aria-hidden="true"><div class="zone z0">读成 0</div><div class="zone zx">说不准</div><div class="zone z1">读成 1</div><div class="thumb"></div></div><div class="sub mono" style="display:flex;justify-content:space-between;margin-top:4px"><span>0 V</span><span class="t0"></span><span class="t1"></span><span class="tv"></span></div></div>');
  host.append(box);
  return (v, vcc, vmax = 5) => {
    const lo = 0.3 * vcc / vmax * 100, hi = 0.7 * vcc / vmax * 100, top = vcc / vmax * 100;
    $('.vbar', box).style.gridTemplateColumns = `${lo}% ${hi - lo}% ${top - hi}%`;
    $('.vbar', box).style.width = top + '%';
    $('.thumb', box).style.left = (Math.min(v, vmax) / vcc * 100) + '%';
    $('.t0', box).textContent = (0.3 * vcc).toFixed(2) + ' V';
    $('.t1', box).textContent = (0.7 * vcc).toFixed(2) + ' V';
    $('.tv', box).textContent = vcc.toFixed(1) + ' V';
  };
}

// SVG 小工具
export const svg = (w, h, inner, label = '') => `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${inner}</svg>`;
// 一串电平画成方波。levels: 0/1/null(不画)；每格宽 bw
export function wavePath(levels, x0, yHi, yLo, bw) {
  let d = '', prev = null;
  levels.forEach((lv, i) => {
    if (lv === null) { prev = null; return; }
    const y = lv ? yHi : yLo, x = x0 + i * bw;
    d += prev === null ? `M${x} ${y}` : (prev !== lv ? `L${x} ${y}` : '');
    d += `L${x + bw} ${y}`;
    prev = lv;
  });
  return d;
}

// 一个数从 from 变到 to，每帧回调。返回取消函数
export function tween(from, to, ms, fn, done) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || ms <= 0) { fn(to); if (done) done(); return () => {}; }
  let raf = 0; const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    fn(from + (to - from) * e);
    if (k < 1) raf = requestAnimationFrame(step); else if (done) done();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
export const rad = (d) => d * Math.PI / 180;
// 桌面上信号去和回的路线（名字对应 blender/build_models.py 里的 paths）
export const OUT = ['in_pc', 'WIRE_usb', 'in_m7c', 'WIRE_tx', 'in_txb', 'WIRE_tx5', 'in_241', 'WIRE_data', 'in_phb', 'WIRE_bus', 'chain'];
export const BACK = [['chain', -1], ['WIRE_bus', -1], ['in_phb', -1], ['WIRE_data', -1], ['in_241', -1], ['WIRE_rx5', -1], ['in_txb', -1], ['WIRE_rx', -1], ['in_m7c', -1], ['WIRE_usb', -1], ['in_pc', -1]];
