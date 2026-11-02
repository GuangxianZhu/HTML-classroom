// 二维活体实验：俯视一层切片，点一下换馈电点，看驻波图样怎么变。
import { Sim, LAMBDA_MM } from './fdtd.js';
import { FIELD_LUT, WAVE_LUT } from './color.js';

export function initToy(cv, ui) {
  const sim = new Sim({ mode: 'fixed', food: { kind: 'disc', r: 0.01 }, foodSigma: 0, sigmaBg: 0.011, source: 'point', heatEvery: 4, warmup: 0 });
  const { nx, ny, W, D, dx } = sim;
  let feed = [60, 40], view = 'avg', on = false, dragging = false;

  sim.placeSource = function placeSource() {
    const fx = (feed[0] + W / 2) / dx, fy = (feed[1] + D / 2) / dx;
    const i = Math.max(1, Math.min(nx - 3, Math.floor(fx))), j = Math.max(1, Math.min(ny - 3, Math.floor(fy)));
    const u = fx - i, v = fy - j;
    this.src = [i * ny + j, (1 - u) * (1 - v), 0, (i + 1) * ny + j, u * (1 - v), 0, i * ny + j + 1, (1 - u) * v, 0, (i + 1) * ny + j + 1, u * v, 0];
  };
  sim.placeSource();

  const off = document.createElement('canvas');
  off.width = nx; off.height = ny;
  const oc = off.getContext('2d'), im = oc.createImageData(nx, ny);
  const ctx = cv.getContext('2d');

  function paint() {
    const d = im.data;
    if (view === 'avg') {
      let m = 1e-9;
      for (let i = 0; i < sim.N; i++) if (sim.avg[i] > m) m = sim.avg[i];
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const v = Math.min(255, Math.sqrt(sim.avg[i * ny + j] / m) * 255) | 0, o = ((ny - 1 - j) * nx + i) * 4;
        d[o] = FIELD_LUT[v * 3]; d[o + 1] = FIELD_LUT[v * 3 + 1]; d[o + 2] = FIELD_LUT[v * 3 + 2]; d[o + 3] = 255;
      }
    } else {
      let m = 1e-9;
      for (let i = 0; i < sim.N; i++) { const a = Math.abs(sim.Ez[i]); if (a > m) m = a; }
      sim._vm = Math.max(m, (sim._vm || 0) * .995);
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const x = sim.Ez[i * ny + j] / sim._vm, s = Math.sign(x) * Math.pow(Math.abs(x), .6);
        const v = Math.max(0, Math.min(255, Math.round(s * 127 + 128))), o = ((ny - 1 - j) * nx + i) * 4, a = Math.abs(s);
        d[o] = WAVE_LUT[v * 3] * a + 10 * (1 - a); d[o + 1] = WAVE_LUT[v * 3 + 1] * a + 11 * (1 - a); d[o + 2] = WAVE_LUT[v * 3 + 2] * a + 22 * (1 - a); d[o + 3] = 255;
      }
    }
    oc.putImageData(im, 0, 0);
    const w = cv.width, h = cv.height, k = w / W;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, w, h);
    // 馈电点
    const px = (feed[0] + W / 2) * k, py = h - (feed[1] + D / 2) * k;
    ctx.beginPath(); ctx.arc(px, py, 10, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#120a04'; ctx.stroke();
    // λ/2 标尺
    const L = LAMBDA_MM / 2 * k, x0 = 18, y0 = h - 22;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, y0 - 8); ctx.lineTo(x0, y0 + 8); ctx.moveTo(x0, y0); ctx.lineTo(x0 + L, y0); ctx.moveTo(x0 + L, y0 - 8); ctx.lineTo(x0 + L, y0 + 8); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '600 20px ui-monospace, Consolas, monospace';
    ctx.fillText('λ/2 = 61 mm', x0 + L + 12, y0 + 7);
  }

  function frame() {
    if (!on) return;
    requestAnimationFrame(frame);
    if (view === 'avg') {
      const t0 = performance.now();
      while (performance.now() - t0 < 7) sim.period();
    } else {
      sim.step(1); sim.periods = Math.floor(sim.t / sim.spp);
      sim.step(1);
    }
    paint();
  }

  function setFeed(e) {
    const r = cv.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W - W / 2, y = (1 - (e.clientY - r.top) / r.height) * D - D / 2;
    feed = [Math.max(-W / 2 + 10, Math.min(W / 2 - 10, x)), Math.max(-D / 2 + 10, Math.min(D / 2 - 10, y))];
    sim.placeSource();
    ui.pos.textContent = `馈电点 x=${feed[0].toFixed(0)} mm，y=${feed[1].toFixed(0)} mm`;
  }
  cv.addEventListener('pointerdown', e => { dragging = true; cv.setPointerCapture(e.pointerId); setFeed(e); });
  cv.addEventListener('pointermove', e => { if (dragging) setFeed(e); });
  cv.addEventListener('pointerup', () => { dragging = false; });
  ui.views.forEach(b => b.addEventListener('click', () => {
    ui.views.forEach(x => x.setAttribute('aria-pressed', x === b));
    view = b.dataset.view;
  }));
  new IntersectionObserver(es => {
    const was = on;
    on = es[0].isIntersecting;
    if (on && !was) requestAnimationFrame(frame);
  }, { threshold: 0.1 }).observe(cv);
  for (let i = 0; i < 40; i++) sim.period();
  paint();
  ui.pos.textContent = `馈电点 x=${feed[0]} mm，y=${feed[1]} mm`;
  return { sim };
}
