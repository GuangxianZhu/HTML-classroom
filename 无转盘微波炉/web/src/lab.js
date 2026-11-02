// 对比实验：把三维仿真每个角度的吸热图累加起来。数字全部现场算，不写死。
import { drawSeg } from './seg7.js';
import { HEAT_LUT, FIELD_LUT } from './color.js';

const MODES = ['stuck', 'turntable', 'antenna'];
const ANT = [[70, -25], [70, 25], [21, 25], [38.6, 46], [20.5, 56.4], [0, 60], [-20.5, 56.4], [-38.6, 46], [-28.9, 34.5], [-39, 22.5], [-45, 0], [-39, -22.5], [-28.9, -34.5], [-38.6, -46], [-20.5, -56.4], [0, -60], [20.5, -56.4], [38.6, -46], [21, -25]];

export function initLab(sim, ui) {
  const { meta } = sim;
  const st = { food: 'bento', angle: 0, playing: false, done: 0, stuckAt: 0, acc: {} };
  const N = meta.N, STEP = 360 / N;
  const box = {};
  for (const m of MODES) {
    const el = document.querySelector(`[data-lab="${m}"]`);
    box[m] = {
      el, field: el.querySelector('canvas.field'), heat: el.querySelector('canvas.heat'),
      cv: el.querySelector('[data-v=cv]'), cold: el.querySelector('[data-v=cold]'), span: el.querySelector('[data-v=span]'),
    };
  }
  const seg = document.getElementById('labSeg');

  ui.stuckRange.step = STEP; ui.stuckRange.max = 360 - STEP;

  function data() {
    const f = meta.foods[st.food];
    return { f, mask: sim.get(`mask.${st.food}`), a: sim.get(`heat.${st.food}.antenna`), t: sim.get(`heat.${st.food}.turntable`),
      fa: sim.get(`field.${st.food}.antenna`), ft: sim.get(`field.${st.food}.turntable`) };
  }

  function reset() {
    const { f } = data();
    st.angle = 0; st.done = 0; st.playing = false;
    st.stuckAt = Math.round(f.stuck.medAngle / STEP) % N;
    const n = f.nx * f.ny;
    for (const m of MODES) st.acc[m] = new Float64Array(n);
    ui.stuckRange.value = st.stuckAt * STEP;
    ui.stuckLabel.textContent = `${st.stuckAt * STEP}°`;
    ui.run.textContent = '开始加热一圈';
    draw();
  }

  function addFrame(a) {
    const { f, a: A, t: T } = data();
    const n = f.nx * f.ny;
    const add = (acc, src, k) => { const o = k * n; for (let i = 0; i < n; i++) acc[i] += src[o + i]; };
    add(st.acc.antenna, A, a); add(st.acc.turntable, T, a); add(st.acc.stuck, A, st.stuckAt);
  }

  function stats(acc, mask) {
    let n = 0, s = 0, s2 = 0;
    for (let i = 0; i < acc.length; i++) if (mask[i]) { n++; s += acc[i]; s2 += acc[i] * acc[i]; }
    const mean = s / n, cv = mean ? Math.sqrt(Math.max(s2 / n - mean * mean, 0)) / mean : 0;
    let cold = 0, lo = Infinity, hi = 0;
    for (let i = 0; i < acc.length; i++) if (mask[i]) { const r = acc[i] / (mean || 1); if (r < .5) cold++; if (r < lo) lo = r; if (r > hi) hi = r; }
    return { cv, cold: cold / n, lo, hi, mean };
  }

  function paintHeat(cv, acc, f, mask, mean) {
    const off = cv._off || (cv._off = document.createElement('canvas'));
    off.width = f.nx; off.height = f.ny;
    const c = off.getContext('2d'), im = c.createImageData(f.nx, f.ny), d = im.data;
    for (let i = 0; i < f.nx; i++) for (let j = 0; j < f.ny; j++) {
      const id = i * f.ny + j, o = ((f.ny - 1 - j) * f.nx + i) * 4;
      if (!mask[id]) { d[o + 3] = 0; continue; }
      const v = mean ? Math.min(255, Math.round(acc[id] / mean * 127)) : 0;
      d[o] = HEAT_LUT[v * 3]; d[o + 1] = HEAT_LUT[v * 3 + 1]; d[o + 2] = HEAT_LUT[v * 3 + 2]; d[o + 3] = 255;
    }
    c.putImageData(im, 0, 0);
    const out = cv.getContext('2d'), W = cv.width, H = cv.height;
    out.clearRect(0, 0, W, H);
    const k = Math.min(W / f.nx, H / f.ny) * .96, w = f.nx * k, h = f.ny * k;
    out.imageSmoothingEnabled = true; out.imageSmoothingQuality = 'high';
    out.drawImage(off, (W - w) / 2, (H - h) / 2, w, h);
  }

  function paintField(cv, frames, a, mode, f) {
    const nx = 40, ny = 42;
    const off = cv._off || (cv._off = document.createElement('canvas'));
    off.width = nx; off.height = ny;
    const c = off.getContext('2d'), im = c.createImageData(nx, ny), d = im.data, o0 = a * nx * ny;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const v = frames[o0 + i * ny + j], o = ((ny - 1 - j) * nx + i) * 4;
      d[o] = FIELD_LUT[v * 3]; d[o + 1] = FIELD_LUT[v * 3 + 1]; d[o + 2] = FIELD_LUT[v * 3 + 2]; d[o + 3] = 255;
    }
    c.putImageData(im, 0, 0);
    const out = cv.getContext('2d'), W = cv.width, H = cv.height;
    out.imageSmoothingEnabled = true; out.imageSmoothingQuality = 'high';
    out.drawImage(off, 0, 0, W, H);
    // 坐标：腔体 320×336 mm，中心在画布中心
    const s = W / 320, th = (a / N) * 2 * Math.PI;
    out.save(); out.translate(W / 2, H / 2); out.scale(s, -s);
    if (mode !== 'turntable') {
      const t = mode === 'antenna' ? th : (st.stuckAt / N) * 2 * Math.PI;
      out.save(); out.rotate(t); out.beginPath();
      ANT.forEach((p, i) => (i ? out.lineTo(p[0], p[1]) : out.moveTo(p[0], p[1])));
      out.closePath(); out.fillStyle = 'rgba(255,255,255,.26)'; out.fill();
      out.lineWidth = 1.6 / s; out.strokeStyle = 'rgba(255,255,255,.9)'; out.stroke(); out.restore();
    } else {
      out.beginPath(); out.arc(0, 0, 135, 0, 7); out.setLineDash([9, 7]); out.lineWidth = 1.4 / s; out.strokeStyle = 'rgba(255,255,255,.55)'; out.stroke(); out.setLineDash([]);
    }
    out.save();
    if (mode === 'turntable') out.rotate(th);
    out.translate(f.fx, f.fy); out.beginPath();
    if (f.kind === 'disc') out.arc(0, 0, f.w / 2, 0, 7); else out.rect(-f.w / 2, -f.h / 2, f.w, f.h);
    out.lineWidth = 2 / s; out.strokeStyle = '#fff'; out.stroke(); out.restore();
    out.restore();
  }

  function draw() {
    const { f, mask, fa, ft } = data();
    const a = st.angle % N;
    const res = {};
    for (const m of MODES) {
      const b = box[m], s = stats(st.acc[m], mask);
      res[m] = s;
      paintHeat(b.heat, st.acc[m], f, mask, s.mean);
      paintField(b.field, m === 'turntable' ? ft : fa, m === 'stuck' ? st.stuckAt : a, m, f);
      const has = st.done > 0;
      b.cv.textContent = has ? `${(s.cv * 100).toFixed(0)}%` : '—';
      b.cold.textContent = has ? `${(s.cold * 100).toFixed(0)}%` : '—';
      b.span.textContent = has ? `${s.lo.toFixed(2)} – ${s.hi.toFixed(2)}` : '—';
    }
    const c = seg.getContext('2d');
    c.fillStyle = '#120a04'; c.fillRect(0, 0, seg.width, seg.height);
    const deg = String(Math.round(Math.min(st.done, N) * STEP)).padStart(3, ' ');
    drawSeg(c, deg, 14, 9, 21, 38, '#ffa533', 'rgba(255,165,51,.08)');
    if (st.done >= N) ui.onDone && ui.onDone(res);
  }

  let last = 0;
  function tick(t) {
    if (!st.playing) return;
    requestAnimationFrame(tick);
    if (t - last < 4700 / N) return;
    last = t;
    addFrame(st.angle % N);
    st.angle++; st.done++;
    if (st.done >= N) { st.playing = false; ui.run.textContent = '再加热一次'; }
    draw();
  }

  ui.run.addEventListener('click', () => {
    if (st.done >= N) reset();
    st.playing = !st.playing;
    ui.run.textContent = st.playing ? '暂停' : '继续加热';
    if (st.playing) requestAnimationFrame(tick);
  });
  ui.reset.addEventListener('click', reset);
  ui.foods.forEach(b => b.addEventListener('click', () => {
    ui.foods.forEach(x => x.setAttribute('aria-pressed', x === b));
    st.food = b.dataset.food;
    ui.note.textContent = meta.foods[st.food].note;
    reset();
  }));
  ui.stuckRange.addEventListener('input', () => {
    st.stuckAt = Math.round(+ui.stuckRange.value / STEP) % N;
    ui.stuckLabel.textContent = `${st.stuckAt * STEP}°`;
    // 卡住的角度换了：把这一路的累计按同样的已走帧数重算
    const { f, a: A } = data();
    const n = f.nx * f.ny, acc = st.acc.stuck;
    acc.fill(0);
    const o = st.stuckAt * n;
    for (let i = 0; i < n; i++) acc[i] = A[o + i] * st.done;
    draw();
  });
  ui.note.textContent = meta.foods[st.food].note;
  reset();
  return {
    runAll() {           // 给自动测试和"直接看结果"用
      reset();
      for (let a = 0; a < N; a++) { addFrame(a); st.angle = a + 1; st.done = a + 1; }
      ui.run.textContent = '再加热一次';
      draw();
    },
    state: st,
  };
}
