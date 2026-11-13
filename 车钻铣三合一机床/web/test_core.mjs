// 校验 core.js 的数字：电子挂轮比例、DDA 不累积误差、挂轮搜索、参数表
import * as K from './src/core.js';
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// 1. 比例：P=1, L=1.5, S=1600, C=4000 → 每圈 1066.67 步
const r = K.elsRatio(1.0);
ok(near(r.stepsPerRev, 1600 / 1.5, 1e-9), `P=1 每圈 ${r.stepsPerRev.toFixed(3)} 步`);
ok(Number.isInteger(r.num) && Number.isInteger(r.den), `N/D=${r.num}/${r.den} 是整数`);
// 2. DDA：跑 100 圈，步数和理论值差不超过 1 步
for (const P of [0.4, 0.7, 1.0, 1.25, 1.5, 1.75, K.tpi2mm(20)]) {
  const rr = K.elsRatio(+P.toFixed(3));
  const { steps } = K.runDDA(rr, 4000 * 100);
  const ideal = rr.stepsPerRev * 100;
  ok(Math.abs(steps - ideal) <= 1, `P=${P.toFixed(3)}：100 圈 ${steps} 步，理论 ${ideal.toFixed(2)}`);
}
// 3. 挂轮搜索：1.0 mm 应能精确凑出（导程 1.5 → 2/3）
const g = K.searchGears(1.0);
ok(g.err < 1e-9, `1.0 mm 挂轮 ${g.A}/${g.B}×${g.C}/${g.D} 误差 ${g.err}`);
ok(new Set([g.A, g.B, g.C, g.D]).size === 4, '挂轮不重复使用同一只');
// 4. 负载：P=1.5、导程 1.5 → 步进电机和主轴同转速
const ld = K.loads(600, 1.5);
ok(near(ld.motorRpm, 600), `P=导程时电机转速 = 主轴转速 (${ld.motorRpm})`);
ok(near(ld.maxRpm, 600), '最高主轴转速 600');
// 5. 切削速度
ok(near(K.surfaceSpeed(20, 1000), Math.PI * 20, 1e-9), 'v = πDn/1000');
ok(near(K.rpmFor(20, K.surfaceSpeed(20, 1234)), 1234, 1e-6), 'rpmFor 是 surfaceSpeed 的反函数');
// 6. 参数表
ok(K.SPEC.E.rpm[0] === 50 && K.SPEC.E.rpm[1] === 2250 && K.SPEC.mill.table[0] === 85 && K.SPEC.mill.tslot === 8, '参数表数字');
console.log(fail ? `${fail} 项失败` : '全部通过');
process.exit(fail ? 1 : 0);
