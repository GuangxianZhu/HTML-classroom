// 第四节：颗粒账本与热账
import { css, fit, sci, bind, set, logX, tooltip, onTheme } from './ui.js';

const FILTERS = { H13: 5e-4, H14: 5e-5, U15: 5e-6, U16: 5e-7, U17: 5e-8 };
export const BASE = { v: .40, cov: .73, H: 4, f: 10, cls: 'U15', G: 6000, Co: 1e9, Pmau: 1e-4, q0: 700, eta: .25 };

export function solve(s) {
  const q = s.v * s.cov;                 // 单位面积风量 m³/s/m²
  const Pu = FILTERS[s.cls];
  const f = s.f / 100;
  const Cm = s.Co * s.Pmau;              // MAU 出口
  const Cr = (Pu * f * Cm + s.G / q) / (1 - Pu * (1 - f));   // 回风（≈房间下游）
  const Cp = (1 - f) * Cr + f * Cm;      // 上风仓混合
  const Cs = Pu * Cp;                    // FFU 出风口
  const ach = 3600 * q / s.H;
  const tau = s.H / q;
  const dpFilter = 103 * s.v / .45;
  const dpLoop = 30 * (q / .292) ** 2;
  const fanW = q * (dpFilter + dpLoop) / s.eta;
  const rhoCp = 1.2 * 1005;
  const dT = (s.q0 + fanW) / (rhoCp * q);
  return { q, Pu, f, Cm, Cr, Cp, Cs, ach, tau, fanW, dT, dpFilter, dpLoop };
}
const iso = (c) => Math.max(0, Math.log10(Math.max(c, 1e-9)));

export function setupBudget() {
  const s = { ...BASE };
  const cv = document.getElementById('cvBudget');
  const tip = tooltip();
  function draw() {
    const r = solve(s);
    const { c, w, h } = fit(cv);
    c.clearRect(0, 0, w, h);
    const L = 112, R = 18, T = 34, rowH = (h - T - 34) / 5;
    const A = .01, B = 1e10;
    const X = (v) => logX(Math.max(v, A), A, B, L, w - R);
    const mute = css('--ink3'), ink = css('--ink'), ink2 = css('--ink2'), line = css('--line');
    c.font = '500 11px ' + css('--mono'); c.textBaseline = 'middle'; c.textAlign = 'center';
    // ISO 等级刻度：≥0.1 µm 的上限就是 10^N
    for (let n = 1; n <= 6; n++) {
      c.strokeStyle = line; c.lineWidth = 1; c.globalAlpha = .7; c.beginPath(); c.moveTo(X(10 ** n), T - 6); c.lineTo(X(10 ** n), h - 30); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = mute; c.fillText(`ISO ${n}`, X(10 ** n), T - 16);
    }
    c.fillText('≥0.1 µm 颗粒数 /m³（对数）', (L + w - R) / 2, h - 10);
    for (const v of [.01, 1, 1e8, 1e10]) c.fillText(v >= 1e4 ? sci(v, 0).replace('1.×', '').replace('1×', '') : `${v}`, X(v), h - 24);
    const rows = [['室外', s.Co, '--ink3'], ['MAU 出口', r.Cm, '--s3'], ['上风仓', r.Cp, '--s2'], ['FFU 出风口', r.Cs, '--s2'], ['设备下游回风', r.Cr, '--s1']];
    cv._rows = [];
    rows.forEach(([n, v, col], i) => {
      const y = T + rowH * (i + .5);
      c.fillStyle = ink2; c.textAlign = 'right'; c.font = '500 13px ' + css('--sans');
      c.fillText(n, L - 12, y);
      c.fillStyle = css(col);
      const x = X(v);
      c.beginPath(); c.roundRect(L, y - 4, Math.max(2, x - L), 8, [0, 4, 4, 0]); c.fill();
      c.fillStyle = ink; c.textAlign = x > w - 90 ? 'right' : 'left'; c.font = '700 12px ' + css('--mono');
      c.fillText(sci(v), x > w - 90 ? x - 6 : x + 7, y - 13 + (x > w - 90 ? 0 : 13));
      cv._rows.push({ y, n, v });
    });
    set('bAch', `${r.ach.toFixed(0)} 次/时`);
    set('bTau', `${r.tau.toFixed(1)} s`);
    set('bFirst', `ISO ${iso(r.Cs) < 1 ? '1 以上' : iso(r.Cs).toFixed(1)}`);
    set('bRoom', `ISO ${iso(r.Cr).toFixed(1)}`);
    set('bFan', `${r.fanW.toFixed(0)} W/m²`);
    set('bDt', `${r.dT.toFixed(1)} K`);
    const shareG = (s.G / r.q) / r.Cr;
    set('bWhy', `回风里 ${(shareG * 100).toFixed(shareG > .999 ? 2 : 1)}% 的颗粒是房间里新产生的，所以换滤芯几乎不动回风这一行，却能让 FFU 出风口按倍数变。想让回风变干净，要么少产尘，要么多给风。`);
    set('lab_bv', `${s.v.toFixed(2)} m/s`); set('lab_bc', `${(s.cov * 100).toFixed(0)} %`); set('lab_bf', `${s.f.toFixed(0)} %`);
    set('lab_bg', `${sci(s.G)} /s·m²`); set('lab_bq', `${s.q0.toFixed(0)} W/m²`);
    document.querySelectorAll('[data-cls]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cls === s.cls));
  }
  bind('sl_bv', (v) => { s.v = v; draw(); });
  bind('sl_bc', (v) => { s.cov = v / 100; draw(); });
  bind('sl_bf', (v) => { s.f = v; draw(); });
  bind('sl_bg', (v) => { s.G = 10 ** v; draw(); });
  bind('sl_bq', (v) => { s.q0 = v; draw(); });
  document.querySelectorAll('[data-cls]').forEach((b) => b.addEventListener('click', () => { s.cls = b.dataset.cls; draw(); }));
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect(); const y = e.clientY - r.top;
    const row = (cv._rows || []).find((q) => Math.abs(q.y - y) < 22);
    if (row) tip.show(`${row.n}<br><b>${sci(row.v)}</b> 颗/m³`, e.clientX, e.clientY); else tip.hide();
  });
  cv.addEventListener('pointerleave', () => tip.hide());
  draw(); addEventListener('resize', draw); onTheme(draw);
}
