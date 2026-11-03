// 物理核心的校验：node test_core.mjs
import { penetration, pressureDrop, mpps, singleFiber, slip, diffusivity } from './src/filter_core.js';
import { MicroSim } from './src/micro_core.js';
import { Flow2D } from './src/flow_core.js';
const m = { df: .65e-6, alpha: .05, t: .47e-3, U: .0109 };
const r = mpps(m);
console.log('Cc(0.1µm)', slip(1e-7).toFixed(2), 'D(0.1µm)', diffusivity(1e-7).toExponential(2));
console.log('U15 默认介质 MPPS', (r.d * 1e6).toFixed(3), 'µm  P', r.P.toExponential(2), ' Δp', pressureDrop(m).toFixed(0), 'Pa');
console.log('--- 蒙特卡洛 vs 理论（单纤维效率）');
for (const d of [0.02, 0.05, 0.1, 0.2, 0.5, 1.0]) {
  const s = new MicroSim(40);
  s.configure({ d: d * 1e-6, ...m });
  const T = 4e-4;
  const t0 = Date.now();
  for (let i = 0; i < 400 && Date.now() - t0 < 1500; i++) s.advance(T / 10);
  const th = singleFiber(d * 1e-6, m);
  console.log(d, 'µm  MC η=', (s.etaMC() ?? 0).toFixed(3), ' 理论 η=', th.E.toFixed(3), ` (D ${th.ED.toFixed(3)} R ${th.ER.toFixed(3)} I ${th.EI.toFixed(4)})`, 'n=', s.passed + s.caught);
}
console.log('--- CFD');
for (const open of [1.0, 0.5, 0.25, 0.15]) {
  const f = new Flow2D({ open, tools: [], person: null });
  const t0 = Date.now();
  for (let i = 0; i < 1200; i++) f.step();
  const e = f.massError();
  console.log('开孔率', open, 'ζ', f.zeta().toFixed(1), '偏斜', f.tilt().toFixed(3), '进', e.inflow.toFixed(3), '出', e.out.toFixed(3), `${((Date.now() - t0) / 1200).toFixed(2)} ms/步`);
}
const f = new Flow2D({});
for (let i = 0; i < 1200; i++) f.step();
const e = f.massError();
console.log('含设备 偏斜', f.tilt().toFixed(3), '进', e.inflow.toFixed(3), '出', e.out.toFixed(3));
let mx = 0; for (let i = 0; i < f.u.length; i++) mx = Math.max(mx, Math.abs(f.u[i]), Math.abs(f.v[i]));
console.log('最大速度', mx.toFixed(2));
