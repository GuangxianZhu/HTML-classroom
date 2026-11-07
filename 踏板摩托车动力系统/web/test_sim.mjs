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

// ---- 发动机：第 7 章写“峰值约 11.7 N·m / 7000 rpm，最大约 9 kW”
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

// ---- CVT：第 5 章“15 g、满油门在 7000 rpm 左右开始升档”
const b15 = S.balanceRpm(0, S.tqWot(7000), 15);
ok(near(b15, 7000, 150), '15 g 满油门起始升档转速 ≈ 7000', b15.toFixed(0));
ok(S.balanceRpm(0.5, 5, 15) < S.balanceRpm(0.5, 11.5, 15), '油门小 → 平衡转速低（扭力凸轮）');
const flat = [0, .25, .5, .75, 1].map((x) => S.balanceRpm(x, 11.5, 15));
ok(Math.max(...flat) - Math.min(...flat) < 2200, '曲线斜坡让满油门平衡转速变化不超过 2200 rpm', flat.map((v) => v.toFixed(0)).join(' '));

// 第 5 章：给定车速求平衡（离合器咬住），30 → 90 km/h 速比单调往高档走、转速只涨两三成
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

// ---- 整车：第 7 章
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

// ---- 混动：第 10 章“约为 4000 rpm 扭矩的 1/3”，起步更快
ok(near(3.6 / S.tqWot(4000), 1 / 3, 0.04), '助力 ≈ 4000 rpm 扭矩的 1/3', (3.6 / S.tqWot(4000)).toFixed(3));
const h1 = S.launch({ hybrid: true }, 1, 8), h0 = S.launch({ hybrid: false }, 1, 8);
ok(h1.t30 < h0.t30 - 0.3, '有助力 0–30 更快', `${h1.t30.toFixed(2)} vs ${h0.t30.toFixed(2)}`);

// ---- 电动
const ev = S.launch({ mode: 'ev', evT: 26, evP: 6, evMax: 11000, evI: S.G.emI }, 1, 12);
ok(ev.t30 < r15.t30, '摆臂电机 0–30 比 125 cc 快', `${ev.t30.toFixed(2)} vs ${r15.t30.toFixed(2)}`);

console.log(bad ? `\n${bad} 项不通过` : '\n全部通过');
process.exit(bad ? 1 : 0);
