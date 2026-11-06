// 物理核心校验：node test_core.mjs
import * as C from './src/core.js';
let bad = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) bad++; };
const f1 = (x) => x.toFixed(1);

// 1. 直动弹簧式：零流量 ≈ 设定；流量越大越低（droop）；上游降低出口反而升高（SPE）
const pA = { ...C.ST_A };
const F = C.forceFor(pA, 1000, 300);
const q0 = C.steadyStage(pA, 1000, F, C.demandC(1));
const q1 = C.steadyStage(pA, 1000, F, C.demandC(150));
const q2 = C.steadyStage(pA, 1000, F, C.demandC(300));
console.log('spring P2 @ 1/150/300 NL/min:', f1(q0.P2g), f1(q1.P2g), f1(q2.P2g), 'Q', f1(q1.Q), f1(q2.Q));
ok(Math.abs(q0.P2g - 300) < 4, 'zero-flow outlet near set');
ok(q1.P2g < q0.P2g && q2.P2g < q1.P2g, 'droop: outlet falls with flow');
const s1 = C.steadyStage(pA, 1000, F, C.demandC(20));
const s2 = C.steadyStage(pA, 500, F, C.demandC(20));
console.log('SPE (20 NL/min): P1 1000→500 kPa: P2', f1(s1.P2g), '→', f1(s2.P2g));
ok(s2.P2g > s1.P2g && s2.P2g - s1.P2g < 15, 'supply pressure effect: outlet rises as inlet falls');

// 2. 两级 vs 单级（钢瓶 15 MPa → 1.5 MPa）
const p1 = { ...C.ST_B1 }, p2 = { ...C.ST_A };
const F1 = C.forceFor(p1, 15000, 1000), F2 = C.forceFor(p2, 1000, 300);
const pSingle = { ...C.ST_B1, Ad: C.ST_A.Ad, As: 3.0e-6 * (C.ST_A.Ad / 5e-4), ks: C.ST_A.ks };
const Fs = C.forceFor(pSingle, 15000, 300);
for (const cyl of [15000, 8000, 3000, 1500]) {
  const t = C.steadyTwo(p1, F1, p2, F2, cyl, C.demandC(50));
  const sgl = C.steadyStage(pSingle, cyl, Fs, C.demandC(50));
  console.log(`cyl ${cyl} kPa: two-stage mid ${f1(t.Pm)} out ${f1(t.P2g)} | single out ${f1(sgl.P2g)}`);
}
const tA = C.steadyTwo(p1, F1, p2, F2, 15000, C.demandC(50)), tB = C.steadyTwo(p1, F1, p2, F2, 1500, C.demandC(50));
const sA = C.steadyStage(pSingle, 15000, Fs, C.demandC(50)), sB = C.steadyStage(pSingle, 1500, Fs, C.demandC(50));
ok(Math.abs(tB.P2g - tA.P2g) * 5 < Math.abs(sB.P2g - sA.P2g), 'two-stage drift much smaller than single-stage');

// 3. 圆顶加载：droop 比弹簧式小
const pC = { ...C.ST_C };
const Fd = 300 * 1e3 * pC.Ad + pC.Fbias;
const d0 = C.steadyStage(pC, 1000, Fd, C.demandC(1)), d2 = C.steadyStage(pC, 1000, Fd, C.demandC(250));
const a0 = C.steadyStage(pA, 1000, F, C.demandC(1)), a2 = C.steadyStage(pA, 1000, F, C.demandC(250));
console.log('droop 1→250 NL/min: spring', f1(a0.P2g - a2.P2g), 'dome', f1(d0.P2g - d2.P2g));
ok(d0.P2g - d2.P2g < (a0.P2g - a2.P2g) * 0.6, 'dome-loaded droops less');

// 4. 氟树脂液体调压阀：气压 ≈ 液压
const pD = { ...C.ST_D };
for (const air of [100, 200, 300]) {
  const r = C.steadyPTFE(pD, 400, air, 0.25);
  console.log(`PTFE air ${air} → liquid ${f1(r.P2)} kPa, ${f1(r.Q)} L/min`);
}
const rD = C.steadyPTFE(pD, 400, 200, 0.25);
ok(Math.abs(rD.P2 - 200) < 25, 'liquid outlet tracks air pressure roughly 1:1');

// 5. 竞技场：开环 / 闭环 / 压电 在扰动下
const A = C.makeArena(500);
const run = (sec) => { for (let i = 0; i < sec * 60; i++) A.step(1 / 60); };
const P = () => A.units.map((u) => f1(u.s.P2g)).join(' / ');
run(3); console.log('t=3 set200 q60:        open/closed/piezo', P());
const base = A.units.map((u) => u.s.P2g);
ok(Math.abs(base[1] - 200) < 6 && Math.abs(base[2] - 200) < 4, 'closed loops settle at set');
A.env.q = 200; run(3); console.log('demand 200:            ', P());
ok(Math.abs(A.units[1].s.P2g - 200) < 7 && Math.abs(A.units[2].s.P2g - 200) < 5, 'closed loops reject demand change');
ok(A.units[0].s.P2g < base[0] - 3, 'open loop droops with demand');
A.env.q = 60; A.env.P1g = 350; run(3); console.log('supply 350:            ', P());
A.env.P1g = 700; A.env.sensorOffset = 10; run(3); console.log('sensor +10 kPa:        ', P());
ok(Math.abs(A.units[1].s.P2g - 190) < 7 && Math.abs(A.units[2].s.P2g - 190) < 5, 'closed loops follow drifted sensor');
A.env.sensorOffset = 0; run(2);
A.env.deadEnd = true; run(1); A.env.setP = 120; run(3); console.log('dead-end, set 200→120: ', P());
ok(A.units[2].s.P2g > 180 && A.units[1].s.P2g < 130, 'piezo cannot vent; relieving types can');
A.env.deadEnd = false; A.env.setP = 200; run(3);
A.env.setP = 350; let peak = [0, 0, 0];
for (let i = 0; i < 180; i++) { A.step(1 / 60); A.units.forEach((u, k) => { peak[k] = Math.max(peak[k], u.s.P2g); }); }
console.log('step 200→350 peaks:    ', peak.map(f1).join(' / '), 'final', P());
A.units[2].c.limit = false; A.env.setP = 200; run(3); peak = [0, 0, 0]; A.env.setP = 350;
for (let i = 0; i < 180; i++) { A.step(1 / 60); A.units.forEach((u, k) => { peak[k] = Math.max(peak[k], u.s.P2g); }); }
console.log('no limit: piezo peak   ', f1(peak[2]));
console.log('clicks closed EP:', A.units[1].s.clicks);
console.log(bad ? `${bad} FAILED` : 'all passed');
process.exit(bad ? 1 : 0);
