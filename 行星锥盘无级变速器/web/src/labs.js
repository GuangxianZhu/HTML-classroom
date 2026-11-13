// 2D 实验：摩擦轮、行星机构、截面、压紧力、输出特性、手轮曲线。数字全部来自 core.js。
import * as C from './core.js';

const TAU = Math.PI * 2;
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COL = () => ({
  ink: css('--ink'), ink2: css('--ink2'), ink3: css('--ink3'), line: css('--line'), panel: css('--panel'),
  in: css('--c-in'), out: css('--c-out'), ring: css('--c-ring'), planet: css('--c-planet'), adj: css('--c-adj'),
  amber: css('--amber'), no: css('--no'), ok: css('--ok'), accent: css('--accent'),
});
const f0 = (x) => x.toFixed(0), f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);

// 画布：按 CSS 尺寸和设备像素比设置，返回 {g, w, h}
export function fit(cv, aspect) {
  const w = cv.clientWidth || 600;
  const h = Math.round(w * aspect);
  const r = Math.min(devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) {
    cv.width = Math.round(w * r); cv.height = Math.round(h * r);
    cv.style.height = h + 'px';
  }
  const g = cv.getContext('2d');
  g.setTransform(r, 0, 0, r, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

// 只在看得见时跑动画
function whenVisible(el, fn) {
  let on = false, raf = 0, last = 0;
  const loop = (t) => { if (!on) return; const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t; fn(dt); raf = requestAnimationFrame(loop); };
  new IntersectionObserver((es) => {
    const v = es[0].isIntersecting;
    if (v && !on) { on = true; last = 0; raf = requestAnimationFrame(loop); }
    if (!v) { on = false; cancelAnimationFrame(raf); }
  }).observe(el);
}

// 折线图
export function plot(g, box, o) {
  const c = COL();
  const { x, y, w, h } = box;
  const X = (v) => x + (v - o.x[0]) / (o.x[1] - o.x[0]) * w;
  const Y = (v) => y + h - (v - o.y[0]) / (o.y[1] - o.y[0]) * h;
  g.font = '12px ' + css('--sans');
  g.strokeStyle = c.line; g.lineWidth = 1; g.fillStyle = c.ink3;
  for (const t of o.xt) { g.beginPath(); g.moveTo(X(t), y); g.lineTo(X(t), y + h); g.stroke(); g.textAlign = 'center'; g.fillText(String(t), X(t), y + h + 15); }
  for (const t of o.yt) { g.beginPath(); g.moveTo(x, Y(t)); g.lineTo(x + w, Y(t)); g.stroke(); g.textAlign = 'right'; g.fillText(String(t), x - 6, Y(t) + 4); }
  g.strokeStyle = c.ink2; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + h); g.lineTo(x + w, y + h); g.stroke();
  g.fillStyle = c.ink2; g.textAlign = 'center'; g.fillText(o.xl, x + w / 2, y + h + 32);
  g.save(); g.translate(x - 38, y + h / 2); g.rotate(-Math.PI / 2); g.fillText(o.yl, 0, 0); g.restore();
  for (const sr of o.series) {
    g.strokeStyle = sr.color; g.lineWidth = sr.width || 2.2; g.setLineDash(sr.dash || []);
    g.beginPath();
    sr.pts.forEach(([a, b], i) => { const px = X(a), py = Y(Math.min(o.y[1] * 1.02, Math.max(o.y[0], b))); i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.stroke(); g.setLineDash([]);
    if (sr.label) {
      const [a, b] = sr.at ?? sr.pts[sr.pts.length - 1];
      g.fillStyle = sr.color; g.textAlign = sr.align || 'left'; g.font = '600 12.5px ' + css('--sans');
      g.fillText(sr.label, X(a) + (sr.dx ?? 6), Y(b) + (sr.dy ?? 4)); g.font = '12px ' + css('--sans');
    }
  }
  for (const m of o.marks || []) {
    g.fillStyle = m.color; g.beginPath(); g.arc(X(m.x), Y(m.y), m.r || 4.5, 0, TAU); g.fill();
    if (m.ring) { g.strokeStyle = m.color; g.lineWidth = 1.5; g.beginPath(); g.arc(X(m.x), Y(m.y), 8, 0, TAU); g.stroke(); }
    if (m.label) { g.font = '600 12px ' + css('--sans'); g.textAlign = m.align || 'left'; g.fillText(m.label, X(m.x) + (m.dx ?? 8), Y(m.y) + (m.dy ?? -8)); g.font = '12px ' + css('--sans'); }
  }
  if (o.vline != null) { g.strokeStyle = c.accent; g.setLineDash([4, 4]); g.lineWidth = 1.4; g.beginPath(); g.moveTo(X(o.vline), y); g.lineTo(X(o.vline), y + h); g.stroke(); g.setLineDash([]); }
  return { X, Y };
}

const bind = (root, sel, fn) => { const el = root.querySelector(sel); el.addEventListener('input', fn); return el; };

// ======================================================================
// 第一章：两个摩擦轮
// ======================================================================
export function setupWheel(root) {
  const cv = root.querySelector('canvas');
  const q = (s) => root.querySelector(s);
  const S = { r2: 60, N: 300, T2: 0.8, mu: 0.07 };
  let a1 = 0, a2 = 0;
  const upd = () => {
    S.r2 = +q('[name=r2]').value; S.N = +q('[name=N]').value; S.T2 = +q('[name=T2]').value;
    S.mu = q('[name=oil]').checked ? 0.07 : 0.04;
    q('[data-o=r2]').textContent = S.r2 + ' mm';
    q('[data-o=N]').textContent = S.N + ' N';
    q('[data-o=T2]').textContent = f2(S.T2) + ' N·m';
  };
  for (const n of ['r2', 'N', 'T2']) bind(root, `[name=${n}]`, upd);
  q('[name=oil]').addEventListener('change', upd);
  upd();
  whenVisible(cv, (dt) => {
    const r1 = 30;
    const w = C.wheelPair({ r1, r2: S.r2, N: S.N, mu: S.mu, T2: S.T2, n1: 1400 });
    a1 += 1400 / 60 * TAU * dt / 60;
    a2 -= w.n2 / 60 * TAU * dt / 60;
    const { g, w: W, h: H } = fit(cv, 0.52);
    const c = COL();
    const sc = Math.min(1.6, (H - 40) / (2 * 90));
    const cx1 = W * 0.30, cx2 = cx1 + (r1 + S.r2) * sc, cy = H / 2 + 6;
    const wheel = (x, r, a, col) => {
      g.fillStyle = col; g.beginPath(); g.arc(x, cy, r * sc, 0, TAU); g.fill();
      g.strokeStyle = c.panel; g.lineWidth = 3;
      for (let k = 0; k < 3; k++) { const b = a + k * TAU / 3; g.beginPath(); g.moveTo(x, cy); g.lineTo(x + Math.cos(b) * r * sc * 0.9, cy + Math.sin(b) * r * sc * 0.9); g.stroke(); }
      g.fillStyle = c.panel; g.beginPath(); g.arc(x, cy, 4, 0, TAU); g.fill();
    };
    wheel(cx1, r1, a1, c.in);
    wheel(cx2, S.r2, a2, c.out);
    // 压紧力箭头
    const px = cx1 + r1 * sc;
    g.strokeStyle = c.ink; g.fillStyle = c.ink; g.lineWidth = 2;
    const arrow = (x0, y0, x1, y1) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); const a = Math.atan2(y1 - y0, x1 - x0); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - 8 * Math.cos(a - 0.4), y1 - 8 * Math.sin(a - 0.4)); g.lineTo(x1 - 8 * Math.cos(a + 0.4), y1 - 8 * Math.sin(a + 0.4)); g.fill(); };
    const nl = 14 + S.N / 600 * 30;
    arrow(cx1 - r1 * sc - nl - 8, cy, cx1 - r1 * sc - 8, cy);
    arrow(cx2 + S.r2 * sc + nl + 8, cy, cx2 + S.r2 * sc + 8, cy);
    g.font = '12px ' + css('--sans'); g.fillStyle = c.ink2; g.textAlign = 'center';
    g.fillText('压紧力 N', cx1 - r1 * sc - nl / 2 - 8, cy - 10);
    // 接触点
    g.fillStyle = w.slipping ? c.no : c.amber;
    g.beginPath(); g.arc(px, cy, w.slipping ? 6 + 2 * Math.sin(performance.now() / 60) : 5, 0, TAU); g.fill();
    g.fillStyle = c.ink2; g.textAlign = 'left';
    g.fillText('主动轮 r = 30 mm，1400 r/min', 10, 18);
    g.textAlign = 'right';
    g.fillText(`从动轮 r = ${S.r2} mm`, W - 10, 18);
    const o = q('[data-o=out]');
    o.className = 'state' + (w.slipping ? ' bad' : w.U > 0.7 ? ' warn' : '');
    o.innerHTML = w.slipping
      ? `打滑了：负载要 ${f0(w.Ft)} N 的切向力，摩擦最多给 μN = ${f0(w.cap)} N。从动轮转速掉到 ${f0(w.n2)} r/min，接触面在磨、在发热。`
      : `从动轮 ${f0(w.n2)} r/min（理想 ${f0(w.n2Ideal)}，差的那一点是蠕滑）。切向力 ${f0(w.Ft)} N，摩擦能给 ${f0(w.cap)} N，用掉 ${f0(w.U * 100)}%。最多能带 ${f2(w.T2max)} N·m。`;
  });
}

// ======================================================================
// 第二章：行星机构（两级行星轮：内圈 ρa 碰太阳轮，外圈 ρb 碰外环）
// ======================================================================
export function setupPlanet(root) {
  const cv = root.querySelector('canvas');
  const q = (s) => root.querySelector(s);
  let ra = 10, rb = 10, frame = false, a = { s: 0, c: 0, p: 0 };
  const upd = () => {
    ra = +q('[name=ra]').value; rb = 20 - ra;
    frame = q('[name=frame]').checked;
    const T = C.K * ra / rb;
    q('[data-o=ra]').textContent = `ρa ${f1(ra)} : ρb ${f1(rb)}`;
    const nc = C.carrierSpeed(1400, 0, T);
    q('[data-o=out]').innerHTML = `T = (R/r)·(ρa/ρb) = (60/40)·(${f1(ra)}/${f1(rb)}) = <b>${f2(T)}</b>　→　行星架 = 1400 / (1 + T) = <b>${f0(nc)} r/min</b>（速比 1:${f2(1 + T)}）`;
  };
  bind(root, '[name=ra]', upd);
  q('[name=frame]').addEventListener('change', upd);
  upd();
  whenVisible(cv, (dt) => {
    const T = C.K * ra / rb;
    const ws = 1400, wc = C.carrierSpeed(ws, 0, T);
    const slow = 1 / 60;
    a.s += ws / 60 * TAU * dt * slow;
    a.c += wc / 60 * TAU * dt * slow;
    a.p += -(ws - wc) * 40 / ra / 60 * TAU * dt * slow;
    const view = frame ? -a.c : 0;          // 站在行星架上看：整个画面反着转回来
    const { g, w: W, h: H } = fit(cv, 0.62);
    const c = COL();
    const cx = W / 2, cy = H / 2 + 4, sc = Math.min(W, H) / 2 / 72;
    g.save(); g.translate(cx, cy);
    // 外环（不转；在行星架视角里它倒着转）
    const ringA = view;
    g.strokeStyle = c.ring; g.lineWidth = 9 * sc;
    g.beginPath(); g.arc(0, 0, (60 + 4.5) * sc, 0, TAU); g.stroke();
    g.strokeStyle = c.panel; g.lineWidth = 2;
    for (let k = 0; k < 24; k++) { const b = ringA + k * TAU / 24; g.beginPath(); g.moveTo(Math.cos(b) * 61 * sc, Math.sin(b) * 61 * sc); g.lineTo(Math.cos(b) * 68 * sc, Math.sin(b) * 68 * sc); g.stroke(); }
    // 太阳轮
    const sa = a.s + view;
    g.fillStyle = c.in; g.beginPath(); g.arc(0, 0, 40 * sc, 0, TAU); g.fill();
    g.strokeStyle = c.panel; g.lineWidth = 3;
    for (let k = 0; k < 4; k++) { const b = sa + k * TAU / 4; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(b) * 36 * sc, Math.sin(b) * 36 * sc); g.stroke(); }
    // 行星架臂 + 行星轮（两级：浅色大圆 ρb，深一点的小圆 ρa）
    const e = 40 + ra;
    const ca = a.c + view;
    for (let k = 0; k < 3; k++) {
      const b = ca + k * TAU / 3;
      const px = Math.cos(b) * e * sc, py = Math.sin(b) * e * sc;
      g.strokeStyle = c.out; g.lineWidth = 7; g.beginPath(); g.moveTo(0, 0); g.lineTo(px, py); g.stroke();
      g.globalAlpha = 0.55; g.fillStyle = c.planet; g.beginPath(); g.arc(px, py, rb * sc, 0, TAU); g.fill(); g.globalAlpha = 1;
      g.strokeStyle = c.ink3; g.lineWidth = 1; g.beginPath(); g.arc(px, py, rb * sc, 0, TAU); g.stroke();
      g.fillStyle = c.planet; g.beginPath(); g.arc(px, py, ra * sc, 0, TAU); g.fill();
      g.strokeStyle = c.ink3; g.beginPath(); g.arc(px, py, ra * sc, 0, TAU); g.stroke();
      const pa = a.p + ca;
      g.strokeStyle = c.no; g.lineWidth = 2.5; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(pa) * rb * sc, py + Math.sin(pa) * rb * sc); g.stroke();
      // 接触点
      g.fillStyle = c.amber; g.beginPath(); g.arc(Math.cos(b) * 40 * sc, Math.sin(b) * 40 * sc, 4, 0, TAU); g.fill();
      g.fillStyle = '#55D6F2'; g.beginPath(); g.arc(Math.cos(b) * 60 * sc, Math.sin(b) * 60 * sc, 4, 0, TAU); g.fill();
    }
    g.fillStyle = c.out; g.beginPath(); g.arc(0, 0, 9 * sc, 0, TAU); g.fill();
    g.restore();
    g.font = '12.5px ' + css('--sans'); g.fillStyle = c.ink2; g.textAlign = 'left';
    g.fillText(frame ? '站在行星架上看：行星架不动，太阳轮慢了，外环倒着转' : '正常看：外环不动', 10, 18);
    g.fillStyle = c.in; g.fillText('■ 太阳轮（输入）', 10, H - 30);
    g.fillStyle = c.out; g.fillText('■ 行星架（输出）', 10, H - 12);
    g.fillStyle = c.ring; g.textAlign = 'right'; g.fillText('■ 外环（不转）', W - 10, H - 12);
  });
}

// ======================================================================
// 第三章：截面（过最上面那个行星盘的轴线剖开，正对着看）
// ======================================================================
export function setupSection(root, getU, setU) {
  const cv = root.querySelector('canvas');
  const q = (s) => root.querySelector(s);
  const sl = q('[name=u]');
  sl.addEventListener('input', () => setU(+sl.value / 1000));
  function draw() {
    const u = getU();
    sl.value = Math.round(u * 1000);
    const s = C.solve(u, 0);
    const P = C.PARAMS.geom;
    const { g, w: W, h: H } = fit(cv, 0.68);
    const c = COL();
    // 视窗：x ∈ [-30, 30] mm（轴向），r ∈ [18, 82] mm（径向）
    const sc = Math.min(W / 64, H / 70);
    const ox = W / 2, oy = H - 14;
    const X = (x) => ox + x * sc, Y = (r) => oy - (r - 16) * sc;
    const poly = (pts, fill, stroke) => { g.beginPath(); pts.forEach(([x, r], i) => (i ? g.lineTo(X(x), Y(r)) : g.moveTo(X(x), Y(r)))); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } };
    // 主轴
    g.strokeStyle = c.line; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(X(-30), Y(16)); g.lineTo(X(30), Y(16)); g.stroke(); g.setLineDash([]);
    // 行星架槽（示意）+ 心轴 + 滑块
    const e = s.e;
    g.fillStyle = c.out; g.globalAlpha = 0.18; g.fillRect(X(-22), Y(C.E_SLOW + 6.5), (5) * sc, (C.E_SLOW - C.E_FAST + 13) * sc); g.fillRect(X(12), Y(C.E_SLOW + 6.5), 5 * sc, (C.E_SLOW - C.E_FAST + 13) * sc); g.globalAlpha = 1;
    // 行星盘（凸透镜形）
    const sh = P.planet_shaft_r, h = (rho) => C.thick(rho) / 2;
    const pts = [];
    for (let k = 0; k <= 20; k++) { const rho = -P.rho_p + 2 * P.rho_p * k / 20; pts.push([h(Math.abs(rho)), e + rho]); }
    for (let k = 20; k >= 0; k--) { const rho = -P.rho_p + 2 * P.rho_p * k / 20; pts.push([-h(Math.abs(rho)), e + rho]); }
    poly(pts, c.planet, c.ink3);
    g.fillStyle = c.planet; g.fillRect(X(-21.5), Y(e + sh), 38 * sc, 2 * sh * sc);
    g.strokeStyle = c.ink3; g.strokeRect(X(-21.5), Y(e + sh), 38 * sc, 2 * sh * sc);
    g.fillStyle = css('--c-slider'); g.fillRect(X(-22.6), Y(e + 5.5), 7.2 * sc, 11 * sc); g.fillRect(X(11.4), Y(e + 5.5), 7.2 * sc, 11 * sc);
    // 主动轮 / 压盘（刃口在 r = 40）
    const gi = s.gIn / 2;
    const sun = [[gi + 3.2, 16], [gi + 2.3, 30], [gi + 0.5, 38.6], [gi, 40], [gi + 0.35, 40.25], [gi + 4.6, 40.25], [gi + 7.5, 37], [gi + 7.5, 16]];
    poly(sun, c.in); poly(sun.map(([x, r]) => [-x, r]), c.in);
    // 定环 / 凸轮环（刃口在 r = 60）
    const go = s.gOut / 2;
    const rp = [[go + 5, 59.4], [go + 1.5, 59.4], [go + 0.35, 59.7], [go, 60], [go + 0.15, 60.5], [go + 2.05, 66], [go + 6.2, 78], [go + 6.2, 82.5], [go + 12, 82.5], [go + 12, 68], [go + 5, 66.5]];
    poly(rp, c.ring); poly(rp.map(([x, r]) => [-x, r]), c.ring);
    // 碟簧（示意）
    g.strokeStyle = css('--c-spring'); g.lineWidth = 2;
    const xb = gi + 7.5, n = 6, L = 26 - xb;
    g.beginPath();
    for (let k = 0; k <= n; k++) { const x = xb + L * k / n; const r = k % 2 ? 32 : 18; k ? g.lineTo(X(x), Y(r)) : g.moveTo(X(x), Y(r)); }
    g.stroke();
    g.fillStyle = c.in; g.fillRect(X(26), Y(34), 4 * sc, 18 * sc);
    // 接触点 + 尺寸
    const dot = (x, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(X(x), Y(r), 4.5, 0, TAU); g.fill(); };
    dot(gi, 40, c.amber); dot(-gi, 40, c.amber); dot(go, 60, '#55D6F2'); dot(-go, 60, '#55D6F2');
    g.strokeStyle = c.ink; g.lineWidth = 1.2; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(X(-29), Y(e)); g.lineTo(X(29), Y(e)); g.stroke(); g.setLineDash([]);
    const dim = (x, r0, r1, txt, col) => {
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(X(x), Y(r0)); g.lineTo(X(x), Y(r1)); g.stroke();
      for (const r of [r0, r1]) { g.beginPath(); g.moveTo(X(x) - 5, Y(r)); g.lineTo(X(x) + 5, Y(r)); g.stroke(); }
      g.font = '600 12.5px ' + css('--sans'); g.textAlign = 'left'; g.fillText(txt, X(x) + 7, Y((r0 + r1) / 2) + 4);
    };
    dim(22, 40, e, `ρa ${f1(s.ra)}`, c.amber);
    dim(22, e, 60, `ρb ${f1(s.rb)}`, css('--c-ring-dim'));
    g.font = '12px ' + css('--sans'); g.fillStyle = c.ink3; g.textAlign = 'right';
    g.fillText(`盘心到主轴 e = ${f1(e)} mm`, X(-23), Y(e) - 6);
    g.textAlign = 'left'; g.fillStyle = c.ink2;
    g.fillText('← 输出侧', 8, 16); g.textAlign = 'right'; g.fillText('电机侧 →', W - 8, 16);
    g.textAlign = 'center'; g.fillStyle = c.ink3; g.fillText('主轴', X(0), Y(16) - 5);
    q('[data-o=out]').innerHTML =
      `外夹缝 <b>${f2(s.gOut)} mm</b> → 盘心到主轴 <b>${f1(s.e)} mm</b> → ρa ${f1(s.ra)}、ρb ${f1(s.rb)} → T = 1.5 × ${f1(s.ra)}/${f1(s.rb)} = <b>${f2(s.T)}</b> → 输出 <b>${f0(s.nOutIdeal)} r/min</b>。内夹缝被撑到 ${f2(s.gIn)} mm，碟簧 ${f0(s.Fs)} N。`;
  }
  return draw;
}

// ======================================================================
// 第四章：压紧力和打滑
// ======================================================================
export function setupForce(root, getState) {
  const cv = root.querySelector('canvas');
  const cv2 = root.querySelectorAll('canvas')[1];
  return function draw() {
    const { u, T, mu } = getState();
    const c = COL();
    {
      const { g, w, h } = fit(cv, 0.62);
      const pts = (fn) => { const a = []; for (let k = 0; k <= 60; k++) { const s = C.solve(k / 60, 0, { mu }); a.push([s.nOutIdeal, fn(s)]); } return a; };
      const s = C.solve(u, T, { mu });
      plot(g, { x: 54, y: 16, w: w - 74, h: h - 62 }, {
        x: [200, 1000], y: [0, 500], xt: [200, 400, 600, 800, 1000], yt: [0, 100, 200, 300, 400, 500],
        xl: '输出转速 r/min', yl: '每个接触点的正压力 N',
        series: [
          { pts: pts((s) => s.Nb), color: '#2BA9C9', label: '外侧 Nb（多了离心力）', at: [330, 330], dy: -26 },
          { pts: pts((s) => s.Na), color: c.amber, label: '内侧 Na', at: [330, 290], dy: 26 },
        ],
        marks: [{ x: s.nOutIdeal, y: s.Na, color: c.amber, ring: true }, { x: s.nOutIdeal, y: s.Nb, color: '#2BA9C9', ring: true }],
      });
    }
    {
      const { g, w, h } = fit(cv2, 0.62);
      const pts = (fn) => { const a = []; for (let k = 0; k <= 80; k++) { const s = C.solve(k / 80, 0, { mu }); a.push([s.nOutIdeal, fn(s)]); } return a; };
      const s = C.solve(u, T, { mu });
      plot(g, { x: 46, y: 16, w: w - 64, h: h - 62 }, {
        x: [200, 1000], y: [0, 30], xt: [200, 400, 600, 800, 1000], yt: [0, 10, 20, 30],
        xl: '输出转速 r/min', yl: '输出扭矩 N·m',
        series: [
          { pts: pts((s) => s.Tcap), color: c.no, label: '摩擦极限（再大就打滑）', at: [600, 28], dy: -4 },
          { pts: pts((s) => s.Tcap / C.PARAMS.load.safety), color: c.ok, label: '÷ 安全系数 1.5', at: [650, 17.5], dy: -6, dash: [5, 3] },
          { pts: [[200, T], [1000, T]], color: c.ink, width: 1.4, dash: [2, 3], label: `负载 ${f1(T)} N·m`, at: [205, T], dy: -6 },
        ],
        marks: [{ x: s.nOutIdeal, y: T, color: s.slipping ? c.no : c.accent, ring: true, label: s.slipping ? '打滑' : '', dx: 10 }],
      });
    }
  };
}

// ======================================================================
// 第五章：输出特性
// ======================================================================
export function setupChar(root, getState) {
  const [cv, cv2] = root.querySelectorAll('canvas');
  return function draw() {
    const { u, mu } = getState();
    const c = COL();
    const ch = C.characteristic({ mu });
    const s = C.solve(u, 0, { mu });
    const spec = C.PARAMS.spec_udl010;
    {
      const { g, w, h } = fit(cv, 0.62);
      const Pm = ch[0].Tmotor * ch[0].n * 2 * Math.PI / 60;
      plot(g, { x: 46, y: 16, w: w - 64, h: h - 62 }, {
        x: [200, 1000], y: [0, 30], xt: [200, 400, 600, 800, 1000], yt: [0, 10, 20, 30],
        xl: '输出转速 r/min', yl: '扭矩 N·m',
        series: [
          { pts: ch.map((p) => [p.n, p.Tmotor]), color: c.in, label: '电机卡住（恒功率）', at: [470, 25], dash: [5, 3] },
          { pts: ch.map((p) => [p.n, p.Tfric]), color: c.ring, label: '摩擦卡住', at: [760, 14.2], dash: [5, 3] },
          { pts: ch.map((p) => [p.n, p.Trated]), color: c.accent, width: 3.4, label: '能长期用的扭矩', at: [560, 8.2], dy: 14 },
        ],
        marks: [
          { x: spec.n2_max, y: spec.M2_fast, color: c.ink, r: 4, label: '样本 6', dx: -8, align: 'right', dy: -8 },
          { x: spec.n2_min, y: spec.M2_slow, color: c.ink, r: 4, label: '样本 12', dx: 8, dy: 18 },
          { x: s.nOutIdeal, y: s.Trated, color: c.accent, ring: true },
        ],
      });
      void Pm;
    }
    {
      const { g, w, h } = fit(cv2, 0.62);
      plot(g, { x: 46, y: 16, w: w - 64, h: h - 62 }, {
        x: [200, 1000], y: [0, 800], xt: [200, 400, 600, 800, 1000], yt: [0, 200, 400, 600, 800],
        xl: '输出转速 r/min', yl: '功率 W',
        series: [
          { pts: ch.map((p) => [p.n, p.Tmotor * p.n * 2 * Math.PI / 60]), color: c.in, dash: [5, 3], label: '电机能给的', at: [300, 690], dy: -6 },
          { pts: ch.map((p) => [p.n, p.P]), color: c.accent, width: 3.4, label: '能长期输出的功率', at: [420, 300], dy: 22 },
        ],
        marks: [{ x: s.nOutIdeal, y: s.Trated * s.nOutIdeal * 2 * Math.PI / 60, color: c.accent, ring: true }],
      });
    }
  };
}

// ======================================================================
// 第六章：手轮圈数 → 输出转速
// ======================================================================
export function setupAdjust(root, getU) {
  const cv = root.querySelector('canvas');
  return function draw() {
    const u = getU();
    const c = COL();
    const { g, w, h } = fit(cv, 0.6);
    const pts = [];
    for (let k = 0; k <= 80; k++) pts.push([k / 80 * C.TURNS, C.geomAt(k / 80).nOutIdeal]);
    const lin = [[0, 1000], [C.TURNS, 200]];
    plot(g, { x: 50, y: 16, w: w - 70, h: h - 62 }, {
      x: [0, C.TURNS], y: [0, 1100], xt: [0, 2, 4, 6, 8, 10, 12], yt: [0, 200, 400, 600, 800, 1000],
      xl: '手轮从最快挡拧了几圈', yl: '输出 r/min',
      series: [
        { pts: lin, color: c.ink3, width: 1.2, dash: [3, 3], label: '如果是直线', at: [8.8, 470], dy: -10 },
        { pts, color: c.adj, width: 3, label: '本页模型', at: [4.0, 640], dy: -10 },
      ],
      marks: [{ x: u * C.TURNS, y: C.geomAt(u).nOutIdeal, color: c.adj, ring: true }],
    });
  };
}
