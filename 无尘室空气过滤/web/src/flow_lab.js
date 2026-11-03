// 第三节：二维 CFD，看气流组织
import { Flow2D } from './flow_core.js';
import { css, fit, bind, set, whenVisible, reduced } from './ui.js';

export function setupFlow() {
  const cv = document.getElementById('cvFlow');
  const sim = new Flow2D({});
  const N = 620;
  const tr = [];
  const clean = () => ({ x: Math.random() * sim.W, y: sim.H - .02, a: Math.random() * 40, k: 0, tail: [] });
  for (let i = 0; i < N; i++) { const p = clean(); p.y = sim.floorRow * sim.dx + Math.random() * 4; tr.push(p); }
  const dust = [];
  let reached = 0, emitted = 0, drag = false;
  const wafer = { x0: 7.6, x1: 8.1, y0: 0, y1: 0 };
  const yRoom = () => sim.floorRow * sim.dx;
  function layout() {
    const f = yRoom();
    wafer.y0 = f + 1.0; wafer.y1 = f + 1.5;
    wafer.x0 = 7.05; wafer.x1 = 7.55;
  }
  layout();
  function inSolid(x, y) {
    const i = Math.floor(x / sim.dx), j = Math.floor(y / sim.dx);
    return i < 0 || i >= sim.nx || j < 0 || j >= sim.ny || sim.solid[sim.id(i, j)];
  }
  function moveP(p, dt) {
    const u = sim.sampleU(p.x, p.y), v = sim.sampleV(p.x, p.y);
    const nx = p.x + u * dt, ny = p.y + v * dt;
    if (inSolid(nx, ny)) { p.x += (Math.random() - .5) * .05; p.y += .02; return false; }
    p.x = nx; p.y = ny;
    return true;
  }
  function step() {
    sim.step();
    const dt = sim.dt;
    for (let i = 0; i < tr.length; i++) {
      const p = tr[i];
      moveP(p, dt); p.a += dt;
      p.tail.push(p.x, p.y); if (p.tail.length > 44) p.tail.splice(0, 2);
      if (p.y < yRoom() - .6 || p.a > 45 || p.x < 0 || p.x > sim.W) tr[i] = clean();
    }
    // 人身上掉下来的颗粒
    if (sim.person != null) for (let n = 0; n < 2; n++) {
      emitted++;
      dust.push({ x: sim.person + (Math.random() - .5) * .7, y: yRoom() + .6 + Math.random() * 1.1, a: 0, hit: false });
    }
    for (let i = dust.length - 1; i >= 0; i--) {
      const p = dust[i];
      // 小湍流：只在可视化层面加一点随机扩散
      p.x += (Math.random() - .5) * .03; p.y += (Math.random() - .5) * .03;
      moveP(p, dt); p.a += dt;
      if (!p.hit && p.x > wafer.x0 && p.x < wafer.x1 && p.y > wafer.y0 && p.y < wafer.y1) { p.hit = true; reached++; }
      if (p.y < yRoom() - .4 || p.a > 40 || p.x < 0 || p.x > sim.W) dust.splice(i, 1);
    }
    if (emitted > 4000) { emitted = Math.round(emitted / 2); reached = Math.round(reached / 2); }
  }
  function draw() {
    const { c, w, h } = fit(cv);
    const f = yRoom();
    const viewH = sim.H - f + .55;         // 屋里 + 地板下一截
    const sc = Math.min(w / sim.W, h / viewH);
    const ox = (w - sim.W * sc) / 2;
    const X = (x) => ox + x * sc, Y = (y) => (sim.H - y) * sc + 18;
    c.fillStyle = css('--micro-bg'); c.fillRect(0, 0, w, h);
    // 地板下空腔
    c.fillStyle = 'rgba(255,255,255,.04)'; c.fillRect(X(0), Y(f), sim.W * sc, h - Y(f));
    // 设备和人
    c.fillStyle = '#42505A';
    for (const [x0, x1, hh] of sim.tools) c.fillRect(X(x0), Y(f + hh), (x1 - x0) * sc, hh * sc);
    if (sim.person != null) { c.fillStyle = '#C9D6DC'; c.fillRect(X(sim.person - .25), Y(f + 1.75), .5 * sc, 1.75 * sc); c.beginPath(); c.arc(X(sim.person), Y(f + 1.92), .17 * sc, 0, 7); c.fill(); }
    // 敞开的上料口：要保护的地方
    c.strokeStyle = '#FFC24A'; c.lineWidth = 2; c.strokeRect(X(wafer.x0), Y(wafer.y1), (wafer.x1 - wafer.x0) * sc, (wafer.y1 - wafer.y0) * sc);
    // 洁净气流
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(120,200,235,.5)';
    c.beginPath();
    for (const p of tr) {
      if (p.tail.length < 4) continue;
      c.moveTo(X(p.tail[0]), Y(p.tail[1]));
      for (let i = 2; i < p.tail.length; i += 2) c.lineTo(X(p.tail[i]), Y(p.tail[i + 1]));
    }
    c.stroke();
    // 颗粒
    c.fillStyle = '#FF7E93';
    for (const p of dust) c.fillRect(X(p.x) - 1, Y(p.y) - 1, 2.4, 2.4);
    // 地板
    c.strokeStyle = '#8FA3AE'; c.lineWidth = 3; c.setLineDash([5, 3]); c.beginPath(); c.moveTo(X(0), Y(f)); c.lineTo(X(sim.W), Y(f)); c.stroke(); c.setLineDash([]);
    // FFU
    const fw = sim.W / sim.nffu;
    for (let i = 0; i < sim.nffu; i++) {
      c.fillStyle = sim.ffu[i] ? '#BFE7F3' : '#E0566B';
      c.fillRect(X(i * fw) + 1.5, 4, fw * sc - 3, 10);
    }
    c.fillStyle = '#D6E4EA'; c.font = '500 11px ' + css('--mono'); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillText('点顶上的 FFU 可以停机 · 拖动人换位置', X(0) + 6, Y(f) + 16);
    c.textAlign = 'right';
    c.fillStyle = '#FFC24A'; c.fillText('敞开的上料口', X(wafer.x0) - 6, Y(wafer.y1) + 12);
    cv._m = { X, Y, sc, ox, f, fw };
    set('flTilt', sim.tilt().toFixed(2));
    set('flReach', emitted > 200 ? `${(reached / emitted * 100).toFixed(1)} %` : '统计中');
    const z = sim.zeta(); const dp = z * 0.6 * (sim.vffu * 0.73) ** 2;
    set('flZeta', `ζ = ${z.toFixed(1)} · 约 ${dp.toFixed(1)} Pa`);
  }
  function resetStats() { emitted = 0; reached = 0; }
  bind('sl_fv', (v) => { sim.vffu = v; set('lab_fv', `${v.toFixed(2)} m/s`); resetStats(); });
  bind('sl_open', (v) => { sim.open = v / 100; set('lab_open', `${v} %`); resetStats(); });
  document.getElementById('btnFlowReset').addEventListener('click', () => { sim.ffu.fill(1); sim.person = 9; sim.rebuild(); resetStats(); });
  document.getElementById('btnFlowStop').addEventListener('click', () => { sim.ffu.fill(1); sim.ffu[6] = 0; sim.ffu[7] = 0; resetStats(); });
  document.getElementById('btnFlowHalf').addEventListener('click', () => { sim.ffu.forEach((_, i) => { sim.ffu[i] = i % 2; }); resetStats(); });
  const pick = (e) => {
    const r = cv.getBoundingClientRect(); const m = cv._m;
    return { px: e.clientX - r.left, py: e.clientY - r.top, x: (e.clientX - r.left - m.ox) / m.sc, m };
  };
  cv.addEventListener('pointerdown', (e) => {
    const { px, py, x, m } = pick(e);
    if (py < 20) {
      const i = Math.floor(x / m.fw);
      if (i >= 0 && i < sim.nffu) { sim.ffu[i] = sim.ffu[i] ? 0 : 1; resetStats(); }
      return;
    }
    if (Math.abs(x - sim.person) < .9) { drag = true; cv.setPointerCapture(e.pointerId); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { x } = pick(e);
    const clamped = Math.min(sim.W - .6, Math.max(.6, x));
    if (![...sim.tools].some(([a, b]) => clamped > a - .3 && clamped < b + .3)) { sim.person = clamped; sim.rebuild(); }
  });
  cv.addEventListener('pointerup', () => { if (drag) { drag = false; resetStats(); } });
  window.__flow = sim;
  const vis = whenVisible(cv);
  for (let i = 0; i < 240; i++) sim.step();
  draw();
  const go = !reduced();
  (function loop() {
    requestAnimationFrame(loop);
    if (!vis()) return;
    if (go) step();
    draw();
  })();
}
