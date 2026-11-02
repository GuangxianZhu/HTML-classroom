import { Sim, FOODS, LAMBDA_MM, C0 } from './src/fdtd.js';

// ---------- 校验 1：空腔谐振频率对比解析解 ----------
function validateModes() {
  const s = new Sim({ mode: 'fixed', sigmaBg: 0, food: { kind: 'disc', r: 0.01 }, foodSigma: 0 });
  s.src = [];
  const px = Math.round(s.nx * .37), py = Math.round(s.ny * .29), probe = px * s.ny + py;
  const inj = Math.round(s.nx * .61) * s.ny + Math.round(s.ny * .43);
  const NT = 60000, rec = new Float32Array(NT);
  const t0 = 60, sw = 12;
  for (let n = 0; n < NT; n++) {
    s.step(1);
    if (n < 200) s.Ez[inj] += Math.exp(-((n - t0) ** 2) / (2 * sw * sw));
    rec[n] = s.Ez[probe];
  }
  const dt = s.S * (s.dx / 1000) / C0;
  const Hann = i => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NT);
  const spec = (f) => { let re = 0, im = 0; const w = 2 * Math.PI * f * dt;
    for (let i = 0; i < NT; i++) { const g = rec[i] * Hann(i); re += g * Math.cos(w * i); im += g * Math.sin(w * i); } return Math.hypot(re, im); };
  const rows = [];
  for (const [m, n] of [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [2, 3], [4, 3], [3, 4], [5, 1], [1, 5], [2, 5]]) {
    const fa = C0 / 2 * Math.hypot(m / (s.W / 1000), n / (s.D / 1000));
    let best = 0, bf = 0;
    for (let f = fa * .985; f < fa * 1.01; f += 0.00025 * fa) { const a = spec(f); if (a > best) { best = a; bf = f; } }
    rows.push({ mode: `TM${m}${n}`, analytic_GHz: (fa / 1e9).toFixed(4), fdtd_GHz: (bf / 1e9).toFixed(4), err_pct: ((bf / fa - 1) * 100).toFixed(3) });
  }
  console.table(rows);
}

// ---------- 校验 2：加载后 Q 值（决定每个转角要等多久） ----------
function measureQ(opt) {
  const s = new Sim({ mode: 'fixed', ...opt });
  for (let i = 0; i < 60; i++) s.period();
  s.src = [];
  const E = () => { let e = 0; for (let i = 0; i < s.N; i++) e += s.Ez[i] ** 2 + s.Hx[i] ** 2 + s.Hy[i] ** 2; return e; };
  const e0 = E();
  for (let i = 0; i < 20; i++) s.period();
  const e1 = E();
  return 2 * Math.PI * 20 / Math.log(e0 / e1);
}

function run(mode, food, opt = {}) {
  const s = new Sim({ mode, food, ...opt });
  const revs = opt.revs ?? 1;
  const total = s.warmup + (mode === 'fixed' ? s.periodsPerRev : s.periodsPerRev * revs);
  for (let i = 0; i < total; i++) s.period();
  return { s, st: s.stats() };
}

console.log('λ =', LAMBDA_MM.toFixed(1), 'mm');
validateModes();
for (const sig of [0.05, 0.12, 0.25, 0.5]) console.log('σ', sig, 'Q≈', measureQ({ foodSigma: sig }).toFixed(1));
let t0 = Date.now();
const r = run('antenna', FOODS.plate);
console.log('一圈用时 ms', Date.now() - t0, '网格', r.s.nx, r.s.ny, '每周期步数', r.s.spp.toFixed(1));

const fmt = st => `CV ${(st.cv * 100).toFixed(1)}%  冷区<0.5: ${(st.cold * 100).toFixed(1)}%  热区>1.5: ${(st.hot * 100).toFixed(1)}%  min ${st.lo.toFixed(2)} max ${st.hi.toFixed(2)}`;
for (const name of ['plate', 'bento', 'cup']) {
  console.log('---', name);
  for (const th of [0, 1, 2, 3, 4, 5].map(k => k * Math.PI / 3)) console.log('  天线停在', (th * 180 / Math.PI).toFixed(0), '°', fmt(run('fixed', FOODS[name], { theta0: th }).st));
  console.log('  转盘    ', fmt(run('turntable', FOODS[name]).st));
  console.log('  回转天线', fmt(run('antenna', FOODS[name]).st));
}
