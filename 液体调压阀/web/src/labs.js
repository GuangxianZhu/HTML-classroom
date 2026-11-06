// 三个原理实验：力的账本 + 特性曲线、开环/闭环时域仿真、背压阀循环回路
import * as C from './reg_core.js';
import { css, fit, tooltip, onTheme, bind, set } from './ui.js';

const $ = (id) => document.getElementById(id);
const f3 = (v) => v.toFixed(3), f2 = (v) => v.toFixed(2), f1 = (v) => v.toFixed(1);
const kPa = (v) => `${(v * 1000).toFixed(1)} kPa`;
export const K_MAX = 12;
export const kOf = (u) => K_MAX * Math.pow(u, 1.3);

// ---------- 画图小工具 ----------
function ticks(a, b, n = 5) {
  const span = b - a, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || raw;
  const out = [];
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function frame(cv, { xr, yr, xl, yl, xf = (v) => v, yf = (v) => v, L = 52, R = 14, T = 22, B = 32 }) {
  const { c, w, h } = fit(cv);
  c.clearRect(0, 0, w, h);
  const X = (v) => L + (v - xr[0]) / (xr[1] - xr[0]) * (w - L - R);
  const Y = (v) => h - B - (v - yr[0]) / (yr[1] - yr[0]) * (h - T - B);
  c.font = '500 11px ' + css('--mono');
  c.textBaseline = 'middle';
  c.strokeStyle = css('--line'); c.fillStyle = css('--ink3'); c.lineWidth = 1;
  for (const v of ticks(yr[0], yr[1], 4)) {
    c.globalAlpha = 0.7; c.beginPath(); c.moveTo(L, Y(v)); c.lineTo(w - R, Y(v)); c.stroke(); c.globalAlpha = 1;
    c.textAlign = 'right'; c.fillText(yf(v), L - 6, Y(v));
  }
  c.textAlign = 'center';
  for (const v of ticks(xr[0], xr[1], w > 420 ? 6 : 4)) c.fillText(xf(v), X(v), h - B + 13);
  c.fillStyle = css('--ink2'); c.font = '500 11.5px ' + css('--sans');
  c.textAlign = 'left'; c.fillText(yl, 6, 10);
  c.textAlign = 'right'; c.fillText(xl, w - R, h - 6);
  return { c, w, h, X, Y, L, R, T, B };
}
function line(c, pts, X, Y, color, width = 2, dash = null, alpha = 1) {
  c.save(); c.strokeStyle = color; c.lineWidth = width; c.globalAlpha = alpha; c.lineJoin = 'round';
  if (dash) c.setLineDash(dash);
  c.beginPath(); let started = false;
  for (const [x, y] of pts) { if (!isFinite(y)) { started = false; continue; } if (!started) { c.moveTo(X(x), Y(y)); started = true; } else c.lineTo(X(x), Y(y)); }
  c.stroke(); c.restore();
}
function dot(c, x, y, color, r = 5) {
  c.fillStyle = css('--panel'); c.beginPath(); c.arc(x, y, r + 2, 0, 7); c.fill();
  c.fillStyle = color; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
}
function bindBtns(id, fn, multi = false) {
  const g = $(id);
  g.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (multi) b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
    else g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    fn(b.dataset.v, b.getAttribute('aria-pressed') === 'true');
  }));
}

// ======================================================================
// 实验一：力的账本 + 流量特性 + 压力特性
// ======================================================================
export function setupLab1() {
  const st = { load: 'spring', bal: 0, set: 0.2, Pin: 0.4, u: 0.35 };
  const regOf = (load, bal) => (load === 'spring' ? (bal ? C.REG.springBal : C.REG.spring) : (bal ? C.REG.dome : C.REG.domeUnbal));
  const setOf = (r, load, Pset) => (load === 'spring' ? { F0: C.F0For(r, Pset, 0.4, 0) } : { Pp: C.PpFor(r, Pset, 0.4, 0) });
  const tip = tooltip();
  let cache = null;

  function compute() {
    const r = regOf(st.load, st.bal), sv = setOf(r, st.load, st.set);
    const K = kOf(st.u);
    const s = C.steady(r, st.Pin, K, sv);
    // 对照：另一种加载方式（同平衡）和另一种平衡（同加载）
    const rAlt = regOf(st.load === 'spring' ? 'air' : 'spring', st.bal), svAlt = setOf(rAlt, st.load === 'spring' ? 'air' : 'spring', st.set);
    const rBal = regOf(st.load, st.bal ? 0 : 1), svBal = setOf(rBal, st.load, st.set);
    const fc = C.flowCurve(r, st.Pin, sv, K_MAX), fcAlt = C.flowCurve(rAlt, st.Pin, svAlt, K_MAX);
    const pc = C.pressureCurve(r, K, sv), pcBal = C.pressureCurve(rBal, K, svBal);
    // 下垂：0.5 → 5 L/min；入口压力效应：每 +0.1 MPa
    const at = (Q, rr, ss) => { let a = 0, b = K_MAX * 3; for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (C.steady(rr, st.Pin, m, ss).Q < Q) a = m; else b = m; } return C.steady(rr, st.Pin, (a + b) / 2, ss); };
    const d0 = at(0.5, r, sv), d1 = at(5, r, sv);
    const droop = d1.state === 'sat' ? null : d0.P - d1.P;
    const e0 = C.steady(r, st.Pin, K, sv), e1 = C.steady(r, st.Pin + 0.1, K, sv);
    const spe = e1.P - e0.P;
    cache = { r, sv, K, s, fc, fcAlt, pc, pcBal, droop, spe };
    return cache;
  }

  function drawForce() {
    const { r, sv, s } = cache;
    const cv = $('cvForce'), { c, w, h } = fit(cv);
    c.clearRect(0, 0, w, h);
    const Fl = C.loadForce(r, s.x, sv), FP = s.P * r.Aeff, FI = st.Pin * r.unbal, FS = r.Fr0 + (r.kr + r.kd) * s.x;
    const tot = Math.max(1, FP + Math.max(0, FI) + FS, Fl);
    const L = 150, R = 70, x0 = L, W = w - L - R;
    const sc = (v) => Math.max(0, v) / tot * W;
    const rows = [
      { y: 34, label: st.load === 'spring' ? '主弹簧（开）' : '先导气压（开）', segs: [[Fl, css('--c-pfb')]] },
      { y: 92, label: '关的方向合计', segs: [[FP, css('--c-qfb')], [Math.max(0, FI), css('--c-open')], [FS, css('--c-manual')]] },
    ];
    c.font = '500 12.5px ' + css('--sans'); c.textBaseline = 'middle';
    for (const row of rows) {
      c.fillStyle = css('--ink2'); c.textAlign = 'right'; c.fillText(row.label, L - 10, row.y + 12);
      let x = x0;
      for (const [v, col] of row.segs) { const ww = sc(v); c.fillStyle = col; c.fillRect(x, row.y, ww, 24); x += ww; }
      c.fillStyle = css('--ink'); c.textAlign = 'left'; c.font = '700 12px ' + css('--mono');
      c.fillText(`${f1(row.segs.reduce((a, b) => a + Math.max(0, b[0]), 0))} N`, x + 8, row.y + 12);
      c.font = '500 12.5px ' + css('--sans');
    }
    // 关方向的分项说明
    const parts = [[`出口压力 × 膜片净面积 ${f1(FP)} N`, css('--c-qfb')], [FI >= 0 ? `入口压力 × 阀座净面积 ${f1(FI)} N` : `入口压力反推 ${f1(FI)} N`, css('--c-open')], [`回位弹簧和膜片 ${f1(FS)} N`, css('--c-manual')]];
    let xx = 12, yy = 140;
    c.font = '500 12px ' + css('--sans'); c.textAlign = 'left';
    for (const [t, col] of parts) {
      const tw = c.measureText(t).width;
      if (xx > 12 && xx + tw + 20 > w) { xx = 12; yy += 20; }
      c.fillStyle = col; c.fillRect(xx, yy - 5, 10, 10);
      c.fillStyle = css('--ink2'); c.fillText(t, xx + 15, yy);
      xx += tw + 34;
    }
  }

  function yRange(curves, extra) {
    let lo = Infinity, hi = -Infinity;
    for (const cu of curves) for (const p of cu) { if (p.P > 0) { lo = Math.min(lo, p.P); hi = Math.max(hi, p.P); } }
    for (const v of extra) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const pad = Math.max(0.004, (hi - lo) * 0.15);
    return [Math.max(0, lo - pad), hi + pad];
  }
  function drawCurves() {
    const { s, fc, fcAlt, pc, pcBal } = cache;
    const mainC = css('--c-pfb'), altC = css('--ink3');
    // 流量特性
    const okF = (cu) => cu.filter((p) => p.Q > 0.02);
    const qmax = Math.min(10, Math.max(4, ...okF(fc).map((p) => p.Q), ...okF(fcAlt).map((p) => p.Q)));
    const yr = yRange([okF(fc).filter((p) => p.Q <= qmax), okF(fcAlt).filter((p) => p.Q <= qmax)], [st.set + 0.004, Math.max(0, st.set - 0.03)]);
    let F = frame($('cvFlowCurve'), { xr: [0, qmax], yr, xl: '流量 L/min', yl: '出口压力 MPa', yf: (v) => v.toFixed(2) });
    line(F.c, okF(fcAlt).map((p) => [p.Q, p.P]), F.X, F.Y, altC, 1.6, [5, 4]);
    line(F.c, okF(fc).map((p) => [p.Q, p.P]), F.X, F.Y, mainC, 2.4);
    line(F.c, [[0, st.set], [qmax, st.set]], F.X, F.Y, css('--ink3'), 1, [2, 3], 0.7);
    if (s.Q > 0) dot(F.c, F.X(Math.min(qmax, s.Q)), F.Y(s.P), mainC);
    $('cvFlowCurve')._m = { F, kind: 'flow' };
    // 压力特性
    const yr2 = yRange([pc, pcBal], [st.set]);
    let G = frame($('cvPresCurve'), { xr: [0.15, 0.6], yr: yr2, xl: '供液压力 MPa', yl: '出口压力 MPa', xf: (v) => v.toFixed(1), yf: (v) => v.toFixed(3) });
    line(G.c, pcBal.map((p) => [p.Pin, p.P]), G.X, G.Y, altC, 1.6, [5, 4]);
    line(G.c, pc.map((p) => [p.Pin, p.P]), G.X, G.Y, mainC, 2.4);
    dot(G.c, G.X(st.Pin), G.Y(s.P), mainC);
    $('cvPresCurve')._m = { F: G, kind: 'pres' };
  }

  function render() {
    compute();
    const { s, droop, spe, r } = cache;
    set('l1SetV', `${f3(st.set)} MPa`); set('l1PinV', `${f2(st.Pin)} MPa`); set('l1KV', `${Math.round(st.u * 100)}%`);
    set('l1Read', [
      ['出口压力', `${f3(s.P)} MPa`], ['流量', `${f2(s.Q)} L/min`], ['阀芯开度', `${s.x.toFixed(3)} mm`], ['阀口压降', `${f3(Math.max(0, st.Pin - s.P))} MPa`],
      ['下垂 0.5→5 L/min', droop == null ? '够不着' : kPa(droop)], ['供压 +0.1 MPa 时', `${spe >= 0 ? '+' : ''}${kPa(spe)}`],
    ].map(([a, b]) => `<div>${a}<b>${b}</b></div>`).join(''));
    const el = $('l1State');
    const msg = {
      reg: ['', '正常调节：三股力在这个开度上打平。'],
      lock: ['warn', '下游全关：阀芯压在阀座上，出口压力停在设定值（锁定压力）。'],
      sat: ['bad', '阀已经全开还是不够：供压太低或者流量太大，出口压力掉到设定以下，调压失效了。'],
      closed: ['warn', '设定太低：阀一直关着。'],
    }[s.state];
    el.className = 'state ' + msg[0]; el.textContent = msg[1];
    const k = r.ks + r.kr + r.kd;
    const perTenth = 0.1 * k / r.Aeff;
    $('l1Note').innerHTML = st.load === 'spring'
      ? `弹簧加上膜片的刚度合计 ${f1(k)} N/mm。阀芯每多开 0.1 mm，向下的弹簧力就少 ${f1(0.1 * r.ks)} N，出口压力得低 ${kPa(perTenth)} 才能重新打平——这就是下垂的来源。`
      : `气压加载没有主弹簧，只剩膜片和回位弹簧的 ${f1(k)} N/mm。阀芯每多开 0.1 mm，出口压力只需低 ${kPa(perTenth)}，所以曲线平得多。`;
    $('l1Note').innerHTML += st.bal ? ' 平衡膜片抵消了入口压力的推力，压力特性几乎是平的；剩下的一点斜率来自开度变化。' : ` 阀芯不平衡：入口压力乘以阀座面积（${f1(r.As)} mm²）往关的方向推，供压一升，出口压力反而略降。`;
    drawForce(); drawCurves();
  }

  bindBtns('l1Load', (v) => { st.load = v; render(); });
  bindBtns('l1Bal', (v) => { st.bal = +v; render(); });
  bind('l1Set', (v) => { st.set = v; render(); });
  bind('l1Pin', (v) => { st.Pin = v; render(); });
  bind('l1K', (v) => { st.u = v; render(); });
  for (const id of ['cvFlowCurve', 'cvPresCurve']) {
    const cv = $(id);
    cv.addEventListener('pointermove', (e) => {
      const m = cv._m; if (!m) return;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left;
      if (m.kind === 'flow') {
        let best = null, bd = 1e9; for (const p of cache.fc) { if (p.Q < 0.02) continue; const d = Math.abs(m.F.X(p.Q) - x); if (d < bd) { bd = d; best = p; } }
        if (best) tip.show(`流量 ${f2(best.Q)} L/min<br>出口压力 <b>${f3(best.P)} MPa</b>${best.state === 'sat' ? '<br>阀已全开' : ''}`, e.clientX, e.clientY);
      } else {
        let best = null, bd = 1e9; for (const p of cache.pc) { const d = Math.abs(m.F.X(p.Pin) - x); if (d < bd) { bd = d; best = p; } }
        if (best) tip.show(`供液 ${f2(best.Pin)} MPa<br>出口压力 <b>${f3(best.P)} MPa</b>${best.state === 'sat' ? '<br>阀已全开' : ''}`, e.clientX, e.clientY);
      }
    });
    cv.addEventListener('pointerleave', () => tip.hide());
  }
  addEventListener('resize', render); onTheme(render);
  render();
}

// ======================================================================
// 实验二：开环 / 闭环
// ======================================================================
export function setupSim() {
  const st = { ev: { recipe: true, dip: true, clog: true }, dipTo: 0.33, g: 0, noise: true, aw: true, show: { manual: true, open: true, pfb: true, qfb: true } };
  const colors = () => ({ manual: css('--c-manual'), open: css('--c-open'), pfb: css('--c-pfb'), qfb: css('--c-qfb') });
  const tip = tooltip();
  let sims = null, pending = false;

  $('simKeys').innerHTML = C.STRATS.map((s) => `<label><input type="checkbox" data-k="${s.id}" checked><i style="background:var(--c-${s.id})"></i>${s.name}<span style="color:var(--ink3)">（${s.loop}）</span></label>`).join('');
  $('simKeys').querySelectorAll('input').forEach((el) => el.addEventListener('change', () => { st.show[el.dataset.k] = el.checked; draw(); }));

  function run() {
    const ev = { ...st.ev, dipTo: st.dipTo };
    const gain = 2 ** st.g;
    sims = C.STRATS.map((s) => ({ s, sim: C.simulate({ strat: s, ev, gain, noise: st.noise, antiWindup: st.aw }) }));
    sims.forEach((x) => { x.err = C.phaseErrors(x.sim); });
  }
  function bands(F) {
    const c = F.c;
    c.fillStyle = css('--ink'); c.globalAlpha = 0.06;
    if (st.ev.dip) c.fillRect(F.X(6), F.T, F.X(10.4) - F.X(6), F.h - F.T - F.B);
    if (st.ev.clog) c.fillRect(F.X(12), F.T, F.X(20) - F.X(12), F.h - F.T - F.B);
    c.globalAlpha = 1;
    if (st.ev.recipe) { c.strokeStyle = css('--ink3'); c.setLineDash([2, 3]); c.beginPath(); c.moveTo(F.X(2), F.T); c.lineTo(F.X(2), F.h - F.B); c.stroke(); c.setLineDash([]); }
  }
  function draw() {
    if (!sims) return;
    const col = colors();
    const vis = sims.filter((x) => st.show[x.s.id]);
    // 流量
    let qlo = Infinity, qhi = -Infinity;
    for (const x of vis) for (const q of x.sim.Q) { qlo = Math.min(qlo, q); qhi = Math.max(qhi, q); }
    qlo = Math.min(qlo, 1.1); qhi = Math.max(qhi, 1.9);
    const F = frame($('cvSimQ'), { xr: [0, 20], yr: [Math.max(0, qlo - 0.05), qhi + 0.05], xl: '时间 s', yl: '喷嘴流量 L/min', yf: (v) => v.toFixed(2) });
    bands(F);
    const t = sims[0].sim.t;
    line(F.c, t.map((tt, i) => [tt, sims[0].sim.Qsp[i]]), F.X, F.Y, css('--c-sp'), 1.4, [5, 4]);
    for (const x of vis) line(F.c, t.map((tt, i) => [tt, x.sim.Q[i]]), F.X, F.Y, col[x.s.id], x.s.id === 'qfb' ? 2.4 : 1.9);
    F.c.fillStyle = css('--ink3'); F.c.font = '500 11px ' + css('--sans'); F.c.textAlign = 'left';
    if (st.ev.recipe) F.c.fillText('配方改', F.X(2) + 4, F.T + 8);
    if (st.ev.dip) F.c.fillText('供压下降', F.X(6) + 4, F.T + 8);
    if (st.ev.clog) F.c.fillText('过滤器变堵', F.X(12) + 4, F.T + 8);
    $('cvSimQ')._m = F;
    // 压力
    let plo = Infinity, phi = -Infinity;
    for (const x of vis) for (const p of x.sim.P) { plo = Math.min(plo, p); phi = Math.max(phi, p); }
    if (!isFinite(plo)) { plo = 0.1; phi = 0.3; }
    const G = frame($('cvSimP'), { xr: [0, 20], yr: [Math.max(0, plo - 0.01), phi + 0.01], xl: '时间 s', yl: '出口压力 MPa', yf: (v) => v.toFixed(2) });
    bands(G);
    if (st.ev.dip) line(G.c, t.map((tt, i) => [tt, sims[0].sim.Pin[i]]).filter((p) => p[1] < phi + 0.01), G.X, G.Y, css('--ink3'), 1.2, [1, 3]);
    for (const x of vis) line(G.c, t.map((tt, i) => [tt, x.sim.P[i]]), G.X, G.Y, col[x.s.id], 1.8);
    $('cvSimP')._m = G;
    // 表格
    const cell = (v) => { const a = Math.abs(v); const cls = a < 2 ? 'good' : a < 8 ? '' : 'bad'; return `<td class="num ${cls}" style="color:${a < 2 ? 'var(--ok)' : a < 8 ? 'var(--amber)' : 'var(--no)'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</td>`; };
    $('simTable').innerHTML = sims.map((x) => `<tr><th scope="row" style="font-weight:500"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${col[x.s.id]};margin-right:6px"></i>${x.s.name}</th>${cell(x.err.recipe)}${cell(x.err.dip)}${cell(x.err.clog)}</tr>`).join('');
    // 动态说明
    const q = sims.find((x) => x.s.id === 'qfb');
    const satT = q.sim.t.find((tt, i) => q.sim.sat[i]);
    let ring = 0; { let prev = 0; for (let i = 0; i < q.sim.t.length; i++) { if (q.sim.t[i] < 2.5 || q.sim.t[i] > 6) continue; const e = q.sim.Q[i] - q.sim.Qsp[i]; const sg = Math.sign(e); if (Math.abs(e) > 0.01 && sg !== prev) { ring++; prev = sg; } } }
    const notes = [];
    if (satT != null) notes.push(`流量闭环在 ${satT.toFixed(1)} s 顶到了头（电气比例阀给满 0.5 MPa 或调压阀全开），这段时间它也补不回来。${st.aw ? '' : '关掉抗积分饱和后，恢复时会冲过头。'}`);
    if (ring >= 4) notes.push('增益调高了：配方一改，流量来回振荡。流量计慢、电气比例阀也有滞后，控制器拿到的是“过去”的读数，改得太猛就会过头。');
    if (!notes.length) notes.push('看表格最后一列：只有流量反馈把过滤器堵塞补了回来；压力反馈那条线的出口压力一直很准，流量却和开环一起往下掉。');
    $('simNote').innerHTML = notes.join(' ');
  }
  function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; run(); draw(); }); }
  bindBtns('simEv', (v, on) => { st.ev[v] = on; schedule(); }, true);
  bindBtns('simOpt', (v, on) => { if (v === 'noise') st.noise = on; else st.aw = on; schedule(); }, true);
  bind('simDip', (v) => { st.dipTo = v; set('simDipV', `${f2(v)} MPa`); schedule(); });
  bind('simGain', (v) => { st.g = v; set('simGainV', `${(2 ** v).toFixed(2)}×`); schedule(); });
  set('simDipV', `${f2(st.dipTo)} MPa`); set('simGainV', '1.00×');
  for (const id of ['cvSimQ', 'cvSimP']) {
    const cv = $(id);
    cv.addEventListener('pointermove', (e) => {
      const F = cv._m; if (!F || !sims) return;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left;
      const tt = (x - F.L) / (F.w - F.L - F.R) * 20;
      if (tt < 0 || tt > 20) return tip.hide();
      const i = Math.min(sims[0].sim.t.length - 1, Math.max(0, Math.round(tt / 20 * (sims[0].sim.t.length - 1))));
      const col = colors();
      tip.show(`<b>${sims[0].sim.t[i].toFixed(1)} s</b>　配方 ${f2(sims[0].sim.Qsp[i])} L/min<br>` + sims.filter((s) => st.show[s.s.id]).map((s) => `<span style="color:${col[s.s.id]}">■</span> ${s.s.name}：${f2(s.sim.Q[i])} L/min，${f3(s.sim.P[i])} MPa`).join('<br>'), e.clientX, e.clientY);
    });
    cv.addEventListener('pointerleave', () => tip.hide());
  }
  addEventListener('resize', draw); onTheme(draw);
  schedule();
}

// ======================================================================
// 实验三：背压阀和循环回路
// ======================================================================
export function setupLoopLab(pColorHex) {
  const st = { n: 3, bpr: true, set: 0.25 };
  const N = C.LOOP.N;
  let t0 = performance.now(), anim = 0;
  const tip = tooltip();
  const solve = (n, bpr) => C.loopSolve({ n, useBpr: bpr, Pset: st.set });

  function drawSchematic(now) {
    const cv = $('cvLoop'), { c, w, h } = fit(cv);
    c.clearRect(0, 0, w, h);
    const r = solve(st.n, st.bpr);
    const pc = pColorHex(r.P);
    const tank = { x: 22, y: h - 66, w: 70, h: 52 };
    const yTop = 52, yRet = h - 40, xL = 130, xR = w - 60;
    // 槽
    c.strokeStyle = css('--ink2'); c.lineWidth = 2; c.strokeRect(tank.x, tank.y, tank.w, tank.h);
    c.fillStyle = '#6FA8D8'; c.globalAlpha = 0.35; c.fillRect(tank.x + 2, tank.y + 14, tank.w - 4, tank.h - 16); c.globalAlpha = 1;
    c.fillStyle = css('--ink2'); c.font = '500 12px ' + css('--sans'); c.textAlign = 'center'; c.fillText('药液槽', tank.x + tank.w / 2, tank.y + tank.h + 14);
    // 管路：槽 → 泵 → 上主管 → 右 → 下回流 → 阀 → 槽
    const pipe = (pts, col, wd = 7) => { c.strokeStyle = col; c.lineWidth = wd; c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); };
    pipe([[tank.x + tank.w / 2, tank.y], [tank.x + tank.w / 2, yTop + 40], [xL - 30, yTop + 40]], '#7F8C94', 6);
    pipe([[xL - 30, yTop + 40], [xL, yTop + 40], [xL, yTop], [xR, yTop], [xR, yRet]], pc, 8);
    const xv = xR - 90;
    pipe([[xR, yRet], [xv, yRet]], pc, 8);
    pipe([[xv - 26, yRet], [tank.x + tank.w - 6, yRet]], '#7F8C94', 6);
    // 泵
    c.fillStyle = css('--panel'); c.strokeStyle = css('--ink'); c.lineWidth = 2;
    c.beginPath(); c.arc(xL - 30, yTop + 40, 16, 0, 7); c.fill(); c.stroke();
    c.save(); c.translate(xL - 30, yTop + 40); c.rotate(now / 300 * Math.min(1, r.Qpump / 20));
    c.beginPath(); for (let k = 0; k < 3; k++) { c.moveTo(0, 0); c.lineTo(11 * Math.cos(k * 2.09), 11 * Math.sin(k * 2.09)); } c.stroke(); c.restore();
    c.fillStyle = css('--ink2'); c.textAlign = 'center'; c.fillText('泵', xL - 30, yTop + 70);
    // 设备取液口
    const span = xR - xL - 40, bw = Math.min(26, span / N - 5);
    for (let i = 0; i < N; i++) {
      const x = xL + 30 + span * (i + 0.5) / N;
      const on = i < st.n;
      c.strokeStyle = on ? pc : css('--line'); c.lineWidth = 4;
      c.beginPath(); c.moveTo(x, yTop); c.lineTo(x, yTop + 34); c.stroke();
      c.fillStyle = on ? css('--accent') : css('--panel'); c.strokeStyle = on ? css('--accent') : css('--line'); c.lineWidth = 1.5;
      c.beginPath(); c.roundRect ? c.roundRect(x - bw / 2, yTop + 34, bw, 30, 3) : c.rect(x - bw / 2, yTop + 34, bw, 30); c.fill(); c.stroke();
      c.fillStyle = on ? css('--panel') : css('--ink3'); c.font = '700 10.5px ' + css('--mono'); c.fillText(String(i + 1), x, yTop + 50);
      if (on && bw >= 22) { c.fillStyle = css('--ink2'); c.font = '500 10.5px ' + css('--mono'); c.fillText(f1(r.Qtool), x, yTop + 76); }
    }
    c.fillStyle = css('--ink3'); c.font = '500 11px ' + css('--sans'); c.textAlign = 'left';
    c.fillText(bw >= 22 ? '设备（下面的数字是各自的用液量 L/min）' : `设备，每台用液 ${f1(r.Qtool)} L/min`, xL + 30, yTop + (bw >= 22 ? 94 : 80));
    // 回流阀
    c.fillStyle = st.bpr ? '#E5973A' : '#8A949A';
    c.beginPath(); c.moveTo(xv, yRet - 12); c.lineTo(xv - 26, yRet + 12); c.lineTo(xv - 26, yRet - 12); c.lineTo(xv, yRet + 12); c.closePath(); c.fill();
    if (st.bpr) { c.fillRect(xv - 17, yRet - 30, 8, 18); c.strokeStyle = '#E5973A'; c.lineWidth = 2; c.strokeRect(xv - 23, yRet - 40, 20, 10); }
    c.fillStyle = css('--ink2'); c.font = '500 12px ' + css('--sans'); c.textAlign = 'center';
    const lx = Math.min(xv - 13, w - 74);
    c.fillText(st.bpr ? `背压阀 开度 ${(r.x ?? 0).toFixed(2)} mm` : '固定节流阀', lx, yRet - 50);
    c.fillText(`回流 ${f1(r.Qret)} L/min`, lx, yRet + 24);
    // 主管压力表
    c.textAlign = 'right'; c.font = '700 15px ' + css('--mono'); c.fillStyle = css('--ink');
    c.fillText(`主管 ${f3(r.P)} MPa`, w - 14, 22);
    // 流动的小点
    c.fillStyle = '#FFFFFF'; c.globalAlpha = 0.85;
    const path = [[xL, yTop + 40], [xL, yTop], [xR, yTop], [xR, yRet], [xv, yRet]];
    let Lp = 0; const segs = []; for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); segs.push(l); Lp += l; }
    const speedTop = r.Qpump / 25, nDots = 26;
    for (let k = 0; k < nDots; k++) {
      let d = ((now / 1000) * 60 * speedTop + (k / nDots) * Lp) % Lp, i = 0;
      // 回流段按回流量放慢
      while (d > segs[i] && i < segs.length - 1) { d -= segs[i]; i++; }
      if (i === segs.length - 1 && r.Qret < 0.2) continue;
      const u = d / segs[i], x = path[i][0] + (path[i + 1][0] - path[i][0]) * u, y = path[i][1] + (path[i + 1][1] - path[i][1]) * u;
      c.beginPath(); c.arc(x, y, 2.2, 0, 7); c.fill();
    }
    c.globalAlpha = 1;
    return r;
  }
  function drawCurve() {
    const rowB = [], rowF = [];
    for (let n = 0; n <= N; n++) { rowB.push([n, solve(n, true).P]); rowF.push([n, solve(n, false).P]); }
    const all = [...rowB, ...rowF].map((p) => p[1]);
    const F = frame($('cvLoopCurve'), { xr: [0, N], yr: [Math.max(0, Math.min(...all) - 0.02), Math.max(...all) + 0.02], xl: '用液的设备台数', yl: '主管压力 MPa', yf: (v) => v.toFixed(2) });
    line(F.c, rowF, F.X, F.Y, '#8A949A', 2.2);
    line(F.c, rowB, F.X, F.Y, '#E5973A', 2.6);
    line(F.c, [[0, st.set], [N, st.set]], F.X, F.Y, css('--ink3'), 1, [2, 3]);
    dot(F.c, F.X(st.n), F.Y(solve(st.n, true).P), '#E5973A', st.bpr ? 6 : 4);
    dot(F.c, F.X(st.n), F.Y(solve(st.n, false).P), '#8A949A', st.bpr ? 4 : 6);
    $('cvLoopCurve')._m = { F, rowB, rowF };
  }
  function readout() {
    const r = solve(st.n, st.bpr);
    set('lpNV', `${st.n} 台`); set('lpSetV', `${f3(st.set)} MPa`);
    set('lpRead', [['主管压力', `${f3(r.P)} MPa`], ['泵出流量', `${f1(r.Qpump)} L/min`], ['设备用液合计', `${f1(r.Qtools)} L/min`], ['回流', `${f1(r.Qret)} L/min`]].map(([a, b]) => `<div>${a}<b>${b}</b></div>`).join(''));
    const el = $('lpState');
    if (st.bpr && r.Qret < 0.05) { el.className = 'state bad'; el.textContent = '回流已经是零：背压阀关死了，泵给的全被设备用掉，主管压力守不住，开始往下掉。'; }
    else if (st.bpr) { el.className = 'state'; el.textContent = `背压阀还在放回流（${f1(r.Qret)} L/min），主管压力守在设定附近。`; }
    else { el.className = 'state warn'; el.textContent = '固定节流阀不会自己调：用液的设备一多，主管压力就跟着往下掉。'; }
  }
  function all() { readout(); drawCurve(); }
  bind('lpN', (v) => { st.n = v; all(); });
  bind('lpSet', (v) => { st.set = v; all(); });
  bindBtns('lpMode', (v) => { st.bpr = v === 'bpr'; $('lpSet').disabled = !st.bpr; all(); });
  const cvc = $('cvLoopCurve');
  cvc.addEventListener('pointermove', (e) => {
    const m = cvc._m; if (!m) return;
    const r = cvc.getBoundingClientRect(), n = Math.round((e.clientX - r.left - m.F.L) / (m.F.w - m.F.L - m.F.R) * N);
    if (n < 0 || n > N) return tip.hide();
    tip.show(`${n} 台用液<br><span style="color:#E5973A">■</span> 背压阀 <b>${f3(m.rowB[n][1])} MPa</b><br><span style="color:#8A949A">■</span> 固定节流 <b>${f3(m.rowF[n][1])} MPa</b>`, e.clientX, e.clientY);
  });
  cvc.addEventListener('pointerleave', () => tip.hide());
  addEventListener('resize', all); onTheme(all);
  all();
  // 示意图一直动（只在看得见时）
  let vis = false;
  new IntersectionObserver((e) => { vis = e[0].isIntersecting; }, { threshold: 0.01 }).observe($('cvLoop'));
  const tick = (now) => { requestAnimationFrame(tick); if (vis && !document.hidden) drawSchematic(now); };
  requestAnimationFrame(tick);
  drawSchematic(t0 + anim);
}
