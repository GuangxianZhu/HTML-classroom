// 仿真核心自检：node test_sim.mjs
import * as S from './src/sim.js';
import assert from 'node:assert';
const m = S.MOTOR, car = S.CAR;
const mx = S.maxTorqueAt(m, S.wElec(m, 1000));
console.log('峰值扭矩', mx.T.toFixed(1), 'N·m  id', mx.id.toFixed(0), 'iq', mx.iq.toFixed(0));
const nb = S.baseSpeed(m); console.log('基速', nb, 'rpm');
const cur = S.tnCurve(m); const Pm = Math.max(...cur.map((c) => c.P));
console.log('峰值功率', (Pm / 1000).toFixed(1), 'kW');
console.log('16000 rpm 扭矩', cur.at(-1).T.toFixed(1), 'N·m, 功率', (cur.at(-1).P / 1000).toFixed(1), 'kW');
const nfw = S.tnNoFw(m); const iz = nfw.find((c) => c.n > 500 && c.T < 1);
console.log('不弱磁时扭矩归零的转速', iz?.n.toFixed(0), 'rpm；反电动势 = 电压上限的理论转速', (S.vLimit(m) / m.psi / m.p * 30 / Math.PI).toFixed(0));
console.log('0-100 km/h', S.zeroTo100(m).toFixed(2), 's');
const ts = S.topSpeed(m); console.log('极速', (ts.v * 3.6).toFixed(0), 'km/h  受限于', ts.by, '  16000rpm 对应', (S.vFromRpm(16000) * 3.6).toFixed(0), 'km/h');
console.log('E @16000rpm 相峰值', S.backEmf(m, S.wElec(m, 16000)).toFixed(0), 'V，线电压峰值', (S.backEmf(m, S.wElec(m, 16000)) * Math.sqrt(3)).toFixed(0), 'V');

// 公式自洽：MTPA 解析角和数值搜索一致
for (const I of [100, 300, 520]) {
  const g = S.mtpaAngle(m, I);
  let best = 0, bg = 0;
  for (let a = 1.3; a < 3; a += 1e-4) { const T = S.torqueOf(m, I * Math.cos(a), I * Math.sin(a)); if (T > best) { best = T; bg = a; } }
  assert(Math.abs(g - bg) < 2e-3, 'MTPA 解析式');
  console.log(`MTPA I=${I}: γ=${(g * 180 / Math.PI).toFixed(1)}°  T=${best.toFixed(1)}`);
}
// 工作点不违反两个约束
for (const n of [500, 3000, 6000, 12000, 16000]) for (const T of [20, 100, 200, 319, -100, -250]) {
  const we = S.wElec(m, n), op = S.solveOp(m, T, we);
  assert(Math.hypot(op.id, op.iq) <= m.Imax * 1.001, 'I 超限');
  const lam = S.fluxOf(m, op.id, op.iq);
  assert(lam * we <= S.vLimit(m) * 1.002, `V 超限 n=${n} T=${T}: ${lam * we}`);
  assert(Math.sign(op.T) === Math.sign(T), '符号');
  if (!op.limited) assert(Math.abs(op.T - T) < .01, '扭矩跟随');
}
// 动力学：恒定小扭矩平路，稳态扭矩 = 阻力矩
let s = { v: 0, soc: .8, t: 0 };
for (let i = 0; i < 400000; i++) s = S.stepCar(m, s, .01, 40, 0, 0);
const Tload = s.res * car.r / car.G / car.eta;
console.log(`T=40 平路稳态: ${(s.v * 3.6).toFixed(1)} km/h, 负载矩 ${Tload.toFixed(2)} N·m`);
assert(Math.abs(Tload - 40) < .05, '稳态平衡');
// 电流环：阶跃后 iq 收敛
const r = S.currentLoopStep(m, { n: 3000, fc: 500 });
const iqEnd = r.iq.at(-1), idEnd = r.id.at(-1);
console.log('电流环末值 id/iq', idEnd.toFixed(1), iqEnd.toFixed(1));
assert(Math.abs(iqEnd - 300) < 2 && Math.abs(idEnd + 120) < 2, '电流环');
const t90 = r.t[r.iq.findIndex((x) => x > 60 + .9 * 240)] - .004;
console.log('iq 上升到 90% 用时', (t90 * 1000).toFixed(2), 'ms（一阶理论', (2.3 / (2 * Math.PI * 500) * 1000).toFixed(2), 'ms）');
for (const fc of [200, 500, 1000, 2000, 3000]) { const q = S.currentLoopStep(m, { n: 3000, fc }); console.log(`fc=${fc}: 过冲 ${(Math.max(...q.iq) - 300).toFixed(1)} A`); }
// 三相 → dq 恒等：Park 还原
const pw = S.pwmPeriod({ m, mi: .8, fsw: 5000, fe: 200 });
console.log('PWM 基波峰值', pw.peak.toFixed(1), 'A, 纹波', pw.ripple.toFixed(1), 'A');
const pw2 = S.pwmPeriod({ m, mi: .8, fsw: 20000, fe: 200 });
console.log('20 kHz 纹波', pw2.ripple.toFixed(1), 'A');
// 效率抽查
for (const [n, T] of [[3000, 100], [6000, 60], [12000, 40], [2000, 319], [800, 319]]) {
  const we = S.wElec(m, n), op = S.solveOp(m, T, we), P = S.powerAt(m, op.T, op.id, op.iq, we);
  console.log(`n=${n} T=${T}: η=${(P.eff * 100).toFixed(1)}%  mode=${op.mode} id=${op.id.toFixed(0)} iq=${op.iq.toFixed(0)}`);
}
// 回收：低速净功率翻转点
for (const n of [100, 200, 300, 500, 800, 1500, 3000]) {
  const we = S.wElec(m, n), T = -120, op = S.solveOp(m, T, we), P = S.powerAt(m, op.T, op.id, op.iq, we);
  console.log(`回收 T=-120 n=${n}: Pm=${(P.Pm / 1000).toFixed(2)} kW Pdc=${(P.Pdc / 1000).toFixed(2)} kW`);
}
console.log('全部通过');
// 定速巡航外环：和第 4 章同样的增益，应无明显超调
{
  let st = { v: 10, soc: .8, t: 0 }, xi = 0, peak = 0; const vT = 25;
  for (let i = 0; i < 12000; i++) { const e = vT - st.v, raw = 45 * e + xi; if (raw > -120 && raw < 320) xi = Math.max(-60, Math.min(320, xi + 6 * e * .01)); const cmd = Math.max(-120, Math.min(320, 45 * e + xi)); st = S.stepCar(m, st, .01, cmd, 0, 0); peak = Math.max(peak, st.v); }
  console.log('巡航末速', (st.v * 3.6).toFixed(1), 'km/h，峰值', (peak * 3.6).toFixed(1));
  assert(Math.abs(st.v - vT) < .05 && peak < vT * 1.1, '巡航');
}
