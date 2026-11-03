// 第二节：纤维旁的颗粒（蒙特卡洛）+ 穿透率曲线 + 三种机理
import { singleFiber, penetration, pressureDrop, mpps, slip, diffusivity } from './filter_core.js';
import { MicroSim } from './micro_core.js';
import { css, fit, sci, bind, set, logX, invLog, tooltip, whenVisible, onTheme, reduced } from './ui.js';

const DEF = { d: 0.2, df: 0.65, t: 0.47, alpha: 5, area: 41.4 };
const CLASSES = [['H13', 5e-4], ['H14', 5e-5], ['U15', 5e-6], ['U16', 5e-7], ['U17', 5e-8]];
const FACE = 0.45;     // 滤芯正面风速 m/s，对应产品目录的额定工况
export function setupFilter() {
  const s = { ...DEF };
  const sim = new MicroSim(30);
  const micro = document.getElementById('cvMicro');
  const pen = document.getElementById('cvPen');
  const mech = document.getElementById('cvMech');
  const tip = tooltip();
  const medium = () => ({ df: s.df * 1e-6, alpha: s.alpha / 100, t: s.t * 1e-3, U: FACE / s.area });
  let stream = [];
  function config() { sim.configure({ d: s.d * 1e-6, df: s.df * 1e-6, alpha: s.alpha / 100, U: FACE / s.area }); buildStreams(); }
  function buildStreams() {
    stream = [];
    for (let k = -4; k <= 4; k++) {
      if (!k) continue;
      const y0 = k / 4.6 * sim.b;
      let x = -Math.sqrt(Math.max(0, sim.b * sim.b - y0 * y0)) * .995, y = y0;
      const pts = [];
      for (let i = 0; i < 600; i++) {
        const [u, v] = sim.vel(x, y);
        const sp = Math.hypot(u, v) || 1;
        const h = .012;
        x += u / sp * h; y += v / sp * h;
        if (Math.hypot(x, y) > sim.b || Math.hypot(x, y) < sim.a * 1.01) break;
        pts.push(x, y);
      }
      stream.push(pts);
    }
  }
  function readout() {
    const m = medium();
    const r = mpps(m);
    const dp = pressureDrop(m);
    const sf = singleFiber(s.d * 1e-6, m);
    const P = penetration(s.d * 1e-6, m);
    let cls = '低于 H13';
    for (const [n, lim] of CLASSES) if (r.P <= lim) cls = n;
    set('fU', `${(m.U * 100).toFixed(2)} cm/s`);
    set('fDp', `${dp < 1000 ? dp.toFixed(0) : (dp / 1000).toFixed(1) + ' k'} Pa`);
    set('fMpps', `${(r.d * 1e6).toFixed(2)} µm`);
    set('fPm', sci(r.P));
    set('fCls', cls);
    set('fP', sci(P));
    const parts = [['扩散', sf.ED], ['拦截', sf.ER], ['惯性', sf.EI]].sort((a, b) => b[1] - a[1]);
    set('fDom', `${parts[0][0]}（占 ${(parts[0][1] / sf.E * 100).toFixed(0)}%）`);
    const brown = Math.sqrt(2 * diffusivity(s.d * 1e-6) * (m.df / m.U)) * 1e6;
    set('fNote', `这个粒径扫过一根纤维只要 ${(m.df / m.U * 1e6).toFixed(0)} µs，这段时间里布朗运动能偏离 ${brown.toFixed(2)} µm，粒径本身是纤维的 ${(sf.R * 100).toFixed(0)}%。滑移修正 Cc = ${slip(s.d * 1e-6).toFixed(2)}。`);
    set('lab_d', `${s.d < .1 ? s.d.toFixed(3) : s.d.toFixed(2)} µm`);
    set('lab_area', `${s.area.toFixed(1)} 倍`);
    set('lab_df', `${s.df.toFixed(2)} µm`);
    set('lab_t', `${s.t.toFixed(2)} mm`);
    set('lab_alpha', `${s.alpha.toFixed(1)} %`);
  }
  function drawPen() {
    const { c, w, h } = fit(pen);
    const m = medium();
    const ink = css('--ink2'), line = css('--line'), mute = css('--ink3'), acc = css('--s1');
    const L = 54, R = 12, T = 12, B = 34;
    const X0 = .01, X1 = 5, Y0 = 1e-10, Y1 = 1;
    const X = (v) => logX(v, X0, X1, L, w - R);
    const Y = (v) => T + (Math.log10(Y1) - Math.log10(v)) / (Math.log10(Y1) - Math.log10(Y0)) * (h - T - B);
    c.clearRect(0, 0, w, h);
    c.font = '500 11px ' + css('--mono');
    c.textBaseline = 'middle';
    c.lineWidth = 1;
    for (let e = 0; e >= -10; e -= 2) {
      c.strokeStyle = line; c.globalAlpha = .6;
      c.beginPath(); c.moveTo(L, Y(10 ** e)); c.lineTo(w - R, Y(10 ** e)); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = mute; c.textAlign = 'right';
      c.fillText(e === 0 ? '1' : `10${'⁻'}${'⁰¹²³⁴⁵⁶⁷⁸⁹'[-e] ?? '¹⁰'}`.replace('⁻⁰', '⁻¹⁰'), L - 6, Y(10 ** e));
    }
    c.textAlign = 'center';
    for (const v of [.01, .1, 1]) { c.fillStyle = mute; c.fillText(`${v}`, X(v), h - B + 14); }
    c.fillText('粒径 µm（对数）', (L + w - R) / 2, h - 8);
    // 等级线
    c.textAlign = 'right';
    for (const [n, lim] of CLASSES) {
      c.strokeStyle = mute; c.setLineDash([3, 4]);
      c.beginPath(); c.moveTo(L, Y(lim)); c.lineTo(w - R, Y(lim)); c.stroke(); c.setLineDash([]);
      c.fillStyle = mute; c.fillText(n, w - R - 2, Y(lim) - 7);
    }
    // 曲线
    c.strokeStyle = acc; c.lineWidth = 2; c.lineJoin = 'round'; c.lineCap = 'round';
    c.save(); c.beginPath(); c.rect(L, T, w - L - R, h - T - B); c.clip();
    c.beginPath();
    for (let i = 0; i <= 240; i++) {
      const d = X0 * (X1 / X0) ** (i / 240);
      const y = Y(Math.max(penetration(d * 1e-6, m), 1e-12));
      if (i === 0) c.moveTo(X(d), y); else c.lineTo(X(d), y);
    }
    c.stroke(); c.restore();
    // MPPS
    const r = mpps(m);
    c.fillStyle = css('--panel'); c.beginPath(); c.arc(X(r.d * 1e6), Y(r.P), 6, 0, 7); c.fill();
    c.fillStyle = acc; c.beginPath(); c.arc(X(r.d * 1e6), Y(r.P), 4, 0, 7); c.fill();
    c.fillStyle = ink; c.textAlign = 'center'; c.font = '700 12px ' + css('--sans');
    c.fillText(`最易穿透 ${(r.d * 1e6).toFixed(2)} µm`, Math.min(w - 90, Math.max(100, X(r.d * 1e6))), Math.max(T + 8, Y(r.P) - 14));
    // 当前粒径
    const px = X(s.d);
    c.strokeStyle = ink; c.lineWidth = 1;
    c.beginPath(); c.moveTo(px, T); c.lineTo(px, h - B); c.stroke();
    pen._map = { X0, X1, L, R, m, w };
  }
  function drawMech() {
    const { c, w, h } = fit(mech);
    const m = medium();
    const L = 44, R = 12, T = 12, B = 34;
    const X0 = .01, X1 = 5, Y0 = 1e-3, Y1 = 30;
    const X = (v) => logX(v, X0, X1, L, w - R);
    const Y = (v) => T + (Math.log10(Y1) - Math.log10(Math.max(v, 1e-6))) / (Math.log10(Y1) - Math.log10(Y0)) * (h - T - B);
    const mute = css('--ink3'), line = css('--line');
    c.clearRect(0, 0, w, h);
    c.font = '500 11px ' + css('--mono'); c.textBaseline = 'middle';
    for (const v of [.001, .01, .1, 1, 10]) {
      c.strokeStyle = line; c.globalAlpha = .6; c.lineWidth = 1; c.beginPath(); c.moveTo(L, Y(v)); c.lineTo(w - R, Y(v)); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = mute; c.textAlign = 'right'; c.fillText(`${v}`, L - 6, Y(v));
    }
    c.textAlign = 'center';
    for (const v of [.01, .1, 1]) c.fillText(`${v}`, X(v), h - B + 14);
    c.fillText('粒径 µm（对数）', (L + w - R) / 2, h - 8);
    const series = [['ED', '扩散', css('--s2')], ['ER', '拦截', css('--s1')], ['EI', '惯性', css('--s3')]];
    c.save(); c.beginPath(); c.rect(L, T, w - L - R, h - T - B); c.clip();
    for (const [k, , col] of series) {
      c.strokeStyle = col; c.lineWidth = 2; c.beginPath();
      let st = false;
      for (let i = 0; i <= 160; i++) {
        const d = X0 * (X1 / X0) ** (i / 160);
        const v = singleFiber(d * 1e-6, m)[k];
        if (v < Y0 / 3) continue;
        if (!st) { c.moveTo(X(d), Y(v)); st = true; } else c.lineTo(X(d), Y(v));
      }
      c.stroke();
    }
    c.setLineDash([2, 3]); c.strokeStyle = css('--ink2'); c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i <= 160; i++) {
      const d = X0 * (X1 / X0) ** (i / 160);
      const v = singleFiber(d * 1e-6, m).E;
      if (i === 0) c.moveTo(X(d), Y(v)); else c.lineTo(X(d), Y(v));
    }
    c.stroke(); c.setLineDash([]); c.restore();
    // 直接标注
    c.font = '700 12px ' + css('--sans'); c.textAlign = 'left'; c.fillStyle = css('--ink2');
    const lab = (t, d, k) => { const v = singleFiber(d * 1e-6, m)[k]; if (v > Y0 && v < Y1) c.fillText(t, X(d) + 4, Y(v) - 9); };
    lab('扩散', .025, 'ED'); lab('拦截', .45, 'ER'); lab('惯性', 1.1, 'EI');
    const px = X(s.d);
    c.strokeStyle = css('--ink'); c.lineWidth = 1; c.beginPath(); c.moveTo(px, T); c.lineTo(px, h - B); c.stroke();
  }
  function drawMicro(dtReal) {
    const { c, w, h } = fit(micro);
    const stage = css('--micro-bg');
    c.fillStyle = stage; c.fillRect(0, 0, w, h);
    const sc = Math.min(w, h) / (sim.b * 2.25);
    const cx = w / 2, cy = h / 2;
    const P = (x, y) => [cx + x * sc, cy - y * sc];
    // 胞边界
    c.strokeStyle = 'rgba(160,190,205,.22)'; c.setLineDash([3, 5]); c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, sim.b * sc, 0, 7); c.stroke(); c.setLineDash([]);
    // 流线
    c.strokeStyle = 'rgba(120,180,210,.34)'; c.lineWidth = 1;
    for (const p of stream) {
      c.beginPath();
      for (let i = 0; i < p.length; i += 8) {
        const [x, y] = P(p[i], p[i + 1]);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    // 粘住的颗粒
    const pr = Math.max(1.6, sim.dp / 2 * sc);
    c.fillStyle = '#E86A7E';
    for (const [x, y] of sim.stuck) { const [a, b] = P(x, y); c.beginPath(); c.arc(a, b, pr, 0, 7); c.fill(); }
    // 纤维
    const g = c.createRadialGradient(cx - sim.a * sc * .3, cy - sim.a * sc * .3, 2, cx, cy, sim.a * sc);
    g.addColorStop(0, '#DDEAEE'); g.addColorStop(1, '#7E98A5');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, sim.a * sc, 0, 7); c.fill();
    // 在途颗粒
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(255,190,120,.35)';
    c.beginPath();
    for (const p of sim.parts) {
      if (p.delay > 0) continue;
      for (let i = 0; i < p.trail.length; i += 2) {
        const [a, b] = P(p.trail[i], p.trail[i + 1]);
        if (i === 0) c.moveTo(a, b); else c.lineTo(a, b);
      }
    }
    c.stroke();
    c.fillStyle = '#FFC27A';
    for (const p of sim.parts) {
      if (p.delay > 0) continue;
      const [a, b] = P(p.x, p.y);
      c.beginPath(); c.arc(a, b, pr, 0, 7); c.fill();
    }
    // 比例尺
    const bar = 0.5 * sc;
    c.strokeStyle = '#D6E4EA'; c.lineWidth = 2; c.beginPath(); c.moveTo(14, h - 16); c.lineTo(14 + bar, h - 16); c.stroke();
    c.fillStyle = '#D6E4EA'; c.font = '500 11px ' + css('--mono'); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillText('0.5 µm', 14, h - 24);
    c.fillText('气流 →', 14, 20);
    const tot = sim.passed + sim.caught;
    const eta = sim.etaMC();
    set('mcCount', `穿过 ${sim.passed} · 撞上 ${sim.caught}`);
    set('mcEta', tot > 30 ? `${eta.toFixed(2)}（公式 ${singleFiber(s.d * 1e-6, medium()).E.toFixed(2)}）` : '统计中');
  }
  const redraw = () => { readout(); drawPen(); drawMech(); };
  bind('sl_d', (v) => { s.d = 10 ** v; config(); redraw(); });
  bind('sl_area', (v) => { s.area = v; config(); redraw(); });
  bind('sl_df', (v) => { s.df = v; config(); redraw(); });
  bind('sl_t', (v) => { s.t = v; redraw(); });
  bind('sl_alpha', (v) => { s.alpha = v; config(); redraw(); });
  document.querySelectorAll('[data-fp]').forEach((b) => b.addEventListener('click', () => {
    const p = JSON.parse(b.dataset.fp);
    Object.assign(s, p);
    document.getElementById('sl_area').value = s.area;
    document.getElementById('sl_df').value = s.df;
    document.getElementById('sl_t').value = s.t;
    document.getElementById('sl_alpha').value = s.alpha;
    if (p.d) document.getElementById('sl_d').value = Math.log10(p.d);
    config(); redraw();
  }));
  pen.addEventListener('pointermove', (e) => {
    const map = pen._map; if (!map) return;
    const r = pen.getBoundingClientRect();
    const d = invLog(e.clientX - r.left, map.X0, map.X1, map.L, map.w - map.R);
    if (d < map.X0 || d > map.X1) return tip.hide();
    tip.show(`粒径 <b>${d.toFixed(d < .1 ? 3 : 2)} µm</b><br>穿透率 <b>${sci(penetration(d * 1e-6, map.m))}</b>`, e.clientX, e.clientY);
  });
  pen.addEventListener('pointerleave', () => tip.hide());
  const vis = whenVisible(micro);
  config(); redraw();
  addEventListener('resize', redraw); onTheme(redraw);
  let last = 0;
  const slow = reduced() ? 0 : 1;
  (function loop(t) {
    requestAnimationFrame(loop);
    if (!vis()) return;
    const dt = Math.min(.05, (t - last) / 1000); last = t;
    // 一次穿胞按 4 秒慢放
    const physical = dt * slow * (2 * sim.b * 1e-6) / (FACE / s.area) / 4;
    if (physical > 0) sim.advance(physical);
    drawMicro(dt);
  })(0);
}
