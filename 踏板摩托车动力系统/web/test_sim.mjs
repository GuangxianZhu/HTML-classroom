// 校验数字模型，以及页面文案里写死的判断（改了 sim.js 或 Blender 尺寸后跑一遍：node test_sim.mjs）
import fs from 'fs';
import * as S from './src/sim.js';

const spec = JSON.parse(fs.readFileSync(new URL('../blender/out/spec.json', import.meta.url), 'utf8'));
S.setGeom(spec);
S.calibrate();

let bad = 0;
const ok = (cond, msg, val) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}${val !== undefined ? `  (${val})` : ''}`); if (!cond) bad++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- 几何：皮带长度不变，速比范围和 Blender 一致
const g0 = S.cvtGeom(0), g1 = S.cvtGeom(1);
ok(near(g0.i, 70 / 27, 0.01), '最低档速比 = 70/27', g0.i.toFixed(3));
ok(near(g1.i, 0.80, 0.02), '最高档速比约 0.80', g1.i.toFixed(3));
ok(near(g1.delta, spec.models.U4.kin.deltaMax, 0.05), '主动动盘行程和 Blender 一致', g1.delta.toFixed(2));
ok(near(g0.eps, spec.models.U4.kin.epsMax, 0.05), '从动动盘行程和 Blender 一致', g0.eps.toFixed(2));
ok(near(S.G.Vs, 125, 1), '排量约 125 cc', S.G.Vs.toFixed(1));
ok(near(S.G.iF, 9.67, 0.01), '两级减速比 40/13 × 44/14', S.G.iF.toFixed(3));

// ---- 发动机：“开起来”一章写“峰值约 11.7 N·m / 7000 rpm，最大约 9 kW”
let pmax = 0;
for (let n = 3000; n <= 9800; n += 50) pmax = Math.max(pmax, S.powerKW(n, S.tqWot(n)));
ok(near(S.tqWot(7000), 11.7, 0.05), '峰值扭矩 11.7 N·m @ 7000', S.tqWot(7000));
ok(pmax > 8.8 && pmax < 9.6, '最大功率约 9 kW', pmax.toFixed(2));

// ---- 四冲程循环：做功 ÷ 4π 和扭矩曲线同一量级
const cyc = S.cycle4(1, 20);
ok(cyc.W / (4 * Math.PI) > 10.5 && cyc.W / (4 * Math.PI) < 13.5, '每循环做功换算扭矩 11~13 N·m（没扣摩擦）', (cyc.W / 4 / Math.PI).toFixed(2));
ok(cyc.apmax > 0 && cyc.apmax < 25, '最高缸压在上止点后不远', cyc.apmax);
ok(S.cycle4(0.3, 30).W < cyc.W * 0.6, '油门小 → 每循环做功明显少');

// ---- 二冲程气口：文案里的角度
ok(S.ports2(100).k === 'blow' && S.ports2(180).k === 'scav' && S.ports2(255).k === 'loss' && S.ports2(300).k === 'comp', '二冲程五段的划分');
ok(S.ports2(100).trOpen === 0 && S.ports2(100).exOpen > 0, '90~118° 只有排气口开');
ok(S.ports2(255).trOpen === 0 && S.ports2(255).exOpen > 0, '242~270° 扫气口关、排气口开');

// ---- CVT 一章：“15 g、满油门在 7000 rpm 左右开始升档”
const b15 = S.balanceRpm(0, S.tqWot(7000), 15);
ok(near(b15, 7000, 150), '15 g 满油门起始升档转速 ≈ 7000', b15.toFixed(0));
ok(S.balanceRpm(0.5, 5, 15) < S.balanceRpm(0.5, 11.5, 15), '油门小 → 平衡转速低（扭力凸轮）');
const flat = [0, .25, .5, .75, 1].map((x) => S.balanceRpm(x, 11.5, 15));
ok(Math.max(...flat) - Math.min(...flat) < 2200, '曲线斜坡让满油门平衡转速变化不超过 2200 rpm', flat.map((v) => v.toFixed(0)).join(' '));

// CVT 一章：给定车速求平衡（离合器咬住），30 → 90 km/h 速比单调往高档走、转速只涨两三成
const eq = (v, q = 1, m = 15) => {
  const nOf = (x) => S.cvtGeom(x).i * (v / 3.6) / S.G.wheelR * S.G.iF / S.RPM;
  const f = (x) => S.F1(nOf(x), x, m) - S.F2(x, Math.max(0, S.engTorque(nOf(x), q)) * S.cvtGeom(x).i * S.CVT.etaB);
  let x; if (f(0) <= 0) x = 0; else if (f(1) >= 0) x = 1; else { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; } x = (lo + hi) / 2; }
  return { i: S.cvtGeom(x).i, n: nOf(x) };
};
const E = [30, 40, 50, 60, 70, 80, 90].map((v) => eq(v));
ok(E.every((e, k) => k === 0 || e.i <= E[k - 1].i + 1e-9), '车速越高速比越低（单调）', E.map((e) => e.i.toFixed(2)).join(' '));
const rise = E[6].n / E[0].n - 1;
ok(rise > 0.15 && rise < 0.35, '30 → 90 km/h 转速只涨两三成', `${E[0].n.toFixed(0)} → ${E[6].n.toFixed(0)} rpm`);

// 总览、单元摆动两章的舞台：匀速巡航时速比随车速变高档，发动机转速只是慢慢涨（S.steadyAt 和上面手写的 eq 应一致）
ok(Math.abs(S.steadyAt(60, 1).n - eq(60).n) < 1, 'steadyAt 和 CVT 一章的解一致');
const CR = [20, 40, 60, 80].map((v) => S.cruiseAt(v));
ok(CR.every((c, k) => k === 0 || (c.i < CR[k - 1].i && c.n > CR[k - 1].n)), '巡航：车速越高速比越低、转速慢慢涨', CR.map((c) => `${c.i.toFixed(2)}/${c.n.toFixed(0)}`).join(' '));
ok(CR[3].n / CR[0].n < 2.2, '巡航 20 → 80 km/h（后轮转速 ×4）发动机转速涨不到 2.2 倍', `${CR[0].n.toFixed(0)} → ${CR[3].n.toFixed(0)}`);

// ---- 整车：“开起来”一章
const r12 = S.launch({ roll: 12 }, 1, 30), r15 = S.launch({ roll: 15 }, 1, 30), r18 = S.launch({ roll: 18 }, 1, 30);
const at = (r, t) => r.tr.find((q) => q[0] >= t);
const d = at(r12, 5)[2] - at(r18, 5)[2];
ok(d > 800 && d < 1600, '12 g 和 18 g 在升档段相差大约 1000 rpm', d.toFixed(0));
ok(r15.t60 > 6 && r15.t60 < 10, '0–60 km/h 在 6~10 s', r15.t60.toFixed(2));
ok(r12.t60 < r18.t60, '滚子轻 → 加速快');
const vmax = S.topSpeed({});
ok(vmax > 90 && vmax < 105, '最高速 90~105 km/h', vmax.toFixed(1));
// 上坡自己降档：定速 50 km/h，坡上要开大油门 → 扭矩大 → 扭力凸轮夹紧 → 速比更低、转速更高
const cruise = (slope) => {
  const r = new S.Ride({ slope }); let qc = 0.3;
  for (let k = 0; k < 2400; k++) {      // 48 s，每步 20 ms
    const e = 50 - r.v * 3.6; qc = Math.max(0, Math.min(1, qc + 0.02 * e * 0.08));
    r.step(0.02, Math.max(0, Math.min(1, qc + 0.06 * e)));
  }
  return r;
};
const cf = cruise(0), cs = cruise(0.08);
ok(Math.abs(cf.v * 3.6 - 50) < 2 && Math.abs(cs.v * 3.6 - 50) < 2, '定速 50 km/h 稳住了', `${(cf.v * 3.6).toFixed(1)} / ${(cs.v * 3.6).toFixed(1)}`);
ok(cs.x < cf.x - 0.04 && cs.n > cf.n + 250, '上坡 8 %：速比更低、转速更高', `x ${cs.x.toFixed(2)} vs ${cf.x.toFixed(2)}, ${cs.n.toFixed(0)} vs ${cf.n.toFixed(0)} rpm`);

// ---- 离合器
ok(S.clutchCap(3000 * S.RPM / S.G.iMax) === 0 && S.clutchCap(3600 * S.RPM / S.G.iMax) > 0, '3200 rpm 以下不咬合');

// ---- 电控 CVT：S 模式转速比 D 高
const eD = S.launch({ mode: 'ecvtD' }, 1, 15), eS = S.launch({ mode: 'ecvtS' }, 0.6, 15), eD6 = S.launch({ mode: 'ecvtD' }, 0.6, 15);
ok(at(eS, 10)[2] > at(eD6, 10)[2] + 800, '同样油门 S 模式转速明显高于 D', `${at(eS, 10)[2].toFixed(0)} vs ${at(eD6, 10)[2].toFixed(0)}`);

// ---- 混动一章：“约为 4000 rpm 扭矩的 1/3”，起步更快
ok(near(3.6 / S.tqWot(4000), 1 / 3, 0.04), '助力 ≈ 4000 rpm 扭矩的 1/3', (3.6 / S.tqWot(4000)).toFixed(3));
const h1 = S.launch({ hybrid: true }, 1, 8), h0 = S.launch({ hybrid: false }, 1, 8);
ok(h1.t30 < h0.t30 - 0.3, '有助力 0–30 更快', `${h1.t30.toFixed(2)} vs ${h0.t30.toFixed(2)}`);

// ---- 电动
const ev = S.launch({ mode: 'ev', evT: 26, evP: 6, evMax: 11000, evI: S.G.emI }, 1, 12);
ok(ev.t30 < r15.t30, '摆臂电机 0–30 比 125 cc 快', `${ev.t30.toFixed(2)} vs ${r15.t30.toFixed(2)}`);

// ---- 空气、燃油和能量：“油门”“转速和功率”“热值和油耗”三章
const F = S.FUEL;
ok(near(F.LHV * F.rho, 32.0, 0.3), '汽油热值换成每升约 32 MJ（资料范围 31.2 ~ 32.4）', (F.LHV * F.rho).toFixed(2));
const wot = S.engineFlows(7000, S.tqWot(7000));
ok(near(wot.x, F.xWot, 0.01), '满油门时进气管压力反推回 0.97 个大气压（充气效率自洽）', wot.x.toFixed(3));
ok(S.etaVol(7000) > 0.9 && S.etaVol(7000) < 1.05 && S.etaVol(3000) < S.etaVol(7000), '充气效率在扭矩峰值附近最高、不超过 1.05', `${S.etaVol(3000).toFixed(2)} / ${S.etaVol(7000).toFixed(2)}`);
ok(wot.eff > 0.28 && wot.eff < 0.36 && wot.bsfc > 235 && wot.bsfc < 300, '满油门热效率三成左右', `${(wot.eff * 100).toFixed(1)} %, ${wot.bsfc.toFixed(0)} g/kWh`);
ok(near(wot.lambda, 0.9, 0.01) && near(S.engineFlows(5000, S.engTorque(5000, 0.4)).lambda, 1, 1e-6), '大油门加浓到 λ 0.9，中小油门 λ = 1');
for (const [n, q] of [[1700, 0], [5000, 0.35], [7000, 1], [8500, 0.7]]) {
  const e = S.engineFlows(n, S.engTorque(n, q));
  const sum = e.Pe + e.Pfric + e.Ppump + e.Pcool + e.Pexh;
  ok(Math.abs(sum - e.Q) < 1e-6 * Math.max(1, e.Q), `能量守恒：曲轴 + 摩擦 + 泵气 + 缸壁 + 排气 = 烧油的热（${n} rpm，油门 ${q}）`, `${sum.toFixed(3)} = ${e.Q.toFixed(3)} kW`);
}
ok(S.engineFlows(5000, S.engTorque(5000, 0)).cut && S.engineFlows(5000, S.engTorque(5000, 0)).fuel === 0, '油门一章第 5 步：5000 rpm 松油门断油');
ok(!S.engineFlows(1700, S.engTorque(1700, 0)).cut, '1700 rpm 松油门是怠速，还在喷油');
const idle = S.idleFuel();
ok(idle > 0.015 && idle < 0.045, '怠速每秒烧 0.015 ~ 0.045 g', `${idle.toFixed(4)} g/s = ${(idle / F.rho * 3.6).toFixed(3)} L/h`);
const p35 = S.engineFlows(5000, S.engTorque(5000, 0.35)), p70 = S.engineFlows(5000, S.engTorque(5000, 0.7));
ok(p35.pMan < p70.pMan && p35.mFuel < p70.mFuel && p35.eff < p70.eff, '油门开大：进气管压力、喷油量、热效率都变大', `${p35.pMan.toFixed(0)} → ${p70.pMan.toFixed(0)} kPa`);
ok(near(S.throttlePlate(0).open, 0, 1e-9) && S.throttlePlate(1).open > 0.9, '节气门圆盘：全关开口为 0，全开 > 0.9');
// 转速和功率一章：数字链自己对得上
const dc = S.driveChain(40, 1);
ok(near(dc.n / dc.i / S.G.iF, dc.wheelRpm, 0.5), '转速 ÷ 速比 ÷ 齿轮比 = 后轮转速', `${dc.wheelRpm.toFixed(0)} rpm`);
ok(near(dc.wheelRpm * 2 * Math.PI * S.G.wheelR * 60 / 1000, 40, 0.05), '后轮转速 × 轮周长 = 车速');
ok(near(dc.P, dc.Te * dc.n / 9549, 0.01), '功率 = 扭矩 × 转速 ÷ 9549', dc.P.toFixed(2));
ok(dc.acc > 1.5 && dc.acc < 3.5, '40 km/h 满油门还能以 2 m/s² 上下加速', dc.acc.toFixed(2));
let ptop = 0, ntop = 0;
for (let n = 3000; n <= 9800; n += 100) { const pw = S.powerKW(n, S.tqWot(n)); if (pw > ptop) { ptop = pw; ntop = n; } }
ok(ntop >= 8000 && ntop <= 9000, '文案：扭矩 7000 rpm 最大，功率要到 8500 rpm 附近才最大', `${ntop} rpm`);
// 热值和油耗一章
const c60 = S.cruiseEnergy(60), c20 = S.cruiseEnergy(20), c35 = S.cruiseEnergy(35), c90 = S.cruiseEnergy(90);
ok(near(c60.Pwheel, c60.Pneed, 0.03), '匀速 60 km/h：到后轮的功率 = 阻力功率', `${c60.Pwheel.toFixed(2)} / ${c60.Pneed.toFixed(2)} kW`);
const t2w = c60.Pwheel / c60.e.Q;
ok(t2w > 0.16 && t2w < 0.23, '小题答案：60 km/h 油箱到车轮两成左右', `${(t2w * 100).toFixed(1)} %`);
ok((c60.e.Pcool + c60.e.Pexh) / c60.e.Q > 0.6 && (c60.e.Pcool + c60.e.Pexh) / c60.e.Q < 0.72, '文案：排气和缸壁带走六七成', ((c60.e.Pcool + c60.e.Pexh) / c60.e.Q * 100).toFixed(0));
ok(c60.kmL > 44 && c60.kmL < 58, '60 km/h 每升 44 ~ 58 km（一人）', c60.kmL.toFixed(1));
const c60x2 = S.cruiseEnergy(60, 0, 260);
ok(c60x2.kmL > 44 && c60x2.kmL < 55 && c60x2.kmL < c60.kmL, '文案：两人 260 kg 时约 49 km/L，比厂家的 55 略差', c60x2.kmL.toFixed(1));
ok(c35.kmL > c20.kmL && c35.kmL > c60.kmL && c60.kmL > c90.kmL, '文案：30 ~ 40 km/h 最省油，再快再慢都更费', [c20, c35, c60, c90].map((c) => c.kmL.toFixed(0)).join(' '));
ok(c20.Pwheel / c20.e.Q < 0.1, '文案：小负荷效率特别低（20 km/h 不到一成）', (c20.Pwheel / c20.e.Q * 100).toFixed(1));
ok(near(c60.co2, c60.lPer100 * 23.5, 0.01) && near(c60.kWhWheel, c60.Pneed / 60 * 100, 0.02), '二氧化碳和每百公里能量的换算');
const up = S.cruiseEnergy(50, 0.08);
ok(up.enough && up.kmL < S.cruiseEnergy(50).kmL * 0.7, '上 8 % 的坡油耗明显变高', up.kmL.toFixed(1));
ok(!S.cruiseEnergy(90, 0.12).enough, '90 km/h 上 12 % 的坡：满油门也不够（页面会提示）');
// Ride 累计油耗用的是同一套模型
const rf = S.launch({}, 1, 30);
ok(rf.ride.fuel > 12 && rf.ride.fuel < 24, '满油门跑 30 秒烧 12 ~ 24 g 油', rf.ride.fuel.toFixed(1));

console.log(bad ? `\n${bad} 项不通过` : '\n全部通过');
process.exit(bad ? 1 : 0);
