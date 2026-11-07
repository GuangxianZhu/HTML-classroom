// 自检：齿比和官方一致、效率在合理量级、各策略的分工、试驾仿真的模式切换和能量守恒。
import * as S from './src/sim.js';
let fail = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fail++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

ok(near(S.CAR.Gm, 2.454 * 3.423, 0.01), `电机总减速比 ${S.CAR.Gm.toFixed(3)} ≈ 官方 2.454×3.423 = ${(2.454 * 3.423).toFixed(3)}`);
ok(near(S.CAR.Ge, 0.805 * 3.423, 0.01), `发动机总传动比 ${S.CAR.Ge.toFixed(3)} ≈ 官方 0.805×3.423 = ${(0.805 * 3.423).toFixed(3)}`);
ok(near(S.lockRpm(100 / 3.6), 2460, 40), `直驱 100 km/h 发动机 ${S.lockRpm(100 / 3.6).toFixed(0)} rpm`);
ok(near(S.motorRpm(175 / 3.6), 13300, 700), `175 km/h 时驱动电机 ${S.motorRpm(175 / 3.6).toFixed(0)} rpm（官方资料最高约 13,300）`);
ok(S.ENG_BEST.eta > 0.38 && S.ENG_BEST.eta < 0.41, `发动机最高效率 ${(S.ENG_BEST.eta * 100).toFixed(1)}% 在 38–41%`);
ok(S.engTmax(4750) === 127 && near(S.engTmax(6200) * S.rpm2rad(6200) / 1000, 78, 1.5), '外特性：127 N·m、约 78 kW');
let mono = true; for (let i = 1; i < S.OOL_TABLE.length; i++) if (S.OOL_TABLE[i].n < S.OOL_TABLE[i - 1].n - 200) mono = false;
ok(mono, '最优工作线的转速随功率大体单调');

const v100 = 100 / 3.6, s100 = S.seriesFollow(v100), d100 = S.direct(v100);
const chS = s100.Pw / s100.Pe, chD = d100.Pw / d100.Pe;
ok(chS > 0.65 && chS < 0.8, `100 km/h 串联链路效率 ${(chS * 100).toFixed(1)}%（65–80%）`);
ok(chD > 0.78 && chD < 0.92, `100 km/h 直驱链路效率 ${(chD * 100).toFixed(1)}%（78–92%）`);
ok(d100.fuel < s100.fuel, `100 km/h 直驱比串联省 ${((1 - d100.fuel / s100.fuel) * 100).toFixed(1)}%`);
ok(S.bestAt(40 / 3.6).pick === 'buffer', '40 km/h：串联发电 + 纯电交替最省');
ok(S.bestAt(120 / 3.6).pick === 'direct', '120 km/h：一直直驱最省');
let first = null; for (let k = 40; k <= 140; k += 2) { const p = S.bestAt(k / 3.6).pick; if (p === 'dbuf' || p === 'direct') { first = k; break; } }
ok(first >= 60 && first <= 85, `开始用直驱的车速 ${first} km/h（车主观察约 70 km/h）`);
ok(!S.direct(40 / 3.6).ok, '40 km/h 直驱不可行（发动机转速太低）');

// 试驾仿真
const run = (st, cmd, T, dt = 0.02) => { const log = []; for (let t = 0; t < T; t += dt) { S.driveStep(st, cmd, dt); log.push({ m: st.mode, v: st.v * 3.6, soc: st.soc, n: st.nE }); } return log; };
{
  const st = S.makeDrive(); st.v = 100 / 3.6; st.soc = 0.55;
  const log = run(st, { pedal: 0, brake: 0, cruise: 100, grade: 0 }, 120);
  const eng = log.filter((x) => x.m === 'ENG').length / log.length;
  ok(eng > 0.8, `100 km/h 定速 120 s：直驱占 ${(eng * 100).toFixed(0)}%`);
  ok(log.slice(-500).every((x) => Math.abs(x.v - 100) < 2), '定速巡航稳在 ±2 km/h');
  const l = st.fuelG / S.ENG.rhoF / 1000 / (st.distM / 1e5);
  ok(l > 3 && l < 7, `100 km/h 平均油耗 ${l.toFixed(2)} L/100km`);
}
{
  const st = S.makeDrive(); st.v = 40 / 3.6; st.soc = 0.55;
  const log = run(st, { pedal: 0, brake: 0, cruise: 40, grade: 0 }, 600);
  const modes = new Set(log.map((x) => x.m));
  let sw = 0; for (let i = 1; i < log.length; i++) if (log[i].m !== log[i - 1].m) sw++;
  ok(modes.has('EV') && modes.has('HYB'), `40 km/h 定速 600 s：EV 和混动交替（切换 ${sw} 次）`);
  ok(sw < 60, '切换不过于频繁');
  const socs = log.map((x) => x.soc);
  ok(Math.min(...socs) > 0.35 && Math.max(...socs) < 0.7, `电量保持在 ${(Math.min(...socs) * 100).toFixed(0)}–${(Math.max(...socs) * 100).toFixed(0)}%`);
  const l = st.fuelG / S.ENG.rhoF / 1000 / (st.distM / 1e5);
  ok(l > 1.5 && l < 4.5, `40 km/h 平均油耗 ${l.toFixed(2)} L/100km`);
}
{
  const st = S.makeDrive(); st.v = 80 / 3.6; st.soc = 0.5;
  const s0 = st.soc;
  run(st, { pedal: 0, brake: 0.5, cruise: null, grade: 0 }, 12);
  ok(st.v < 1 && st.soc > s0 + 0.03, `80 → 0 km/h 刹车回收：电量 +${((st.soc - s0) * 100).toFixed(1)}%`);
}
{
  const st = S.makeDrive(); st.v = 70 / 3.6; st.soc = 0.79;
  const log = run(st, { pedal: 0, brake: 0, cruise: 70, grade: -0.06 }, 60);
  ok(log.some((x) => x.m === 'EBRK'), '长下坡、电池快满：出现“发电机拖发动机”');
  ok(Math.max(...log.map((x) => x.soc)) < 0.83, '电量不超过上限太多');
}
{
  const st = S.makeDrive(); st.v = 0; st.soc = 0.55;
  const log = run(st, { pedal: 1, brake: 0, cruise: null, grade: 0 }, 9.4);
  ok(st.v * 3.6 > 85 && st.v * 3.6 < 115, `全油门 9.4 s 到 ${(st.v * 3.6).toFixed(0)} km/h（欧洲版 0–100 km/h 官方 9.4 s）`);
  ok(log.some((x) => x.m === 'HYB'), '全油门时发动机起动发电');
}
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
