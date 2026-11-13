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
// 7. 三个例子：快进到最后，量成品
import fs from 'fs';
import { makeJobs, startJob } from './src/jobs.js';
const L = JSON.parse(fs.readFileSync(new URL('../blender/out/layout.json', import.meta.url), 'utf8'));
const J = makeJobs(L);
const range = (f, x) => { let mn = 1e9, mx = -1e9; for (let j = 0; j < 720; j++) { const v = f(x, j * Math.PI / 360); mn = Math.min(mn, v); mx = Math.max(mx, v); } return [mn, mx]; };
const run = (id) => startJob(J.jobs.find((j) => j.id === id), J.jobs.find((j) => j.id === id).steps.length).piece;
ok(Math.abs(J.spPos(J.YAW_HEX)[1]) < 1e-9, `钻铣头转 ${(J.YAW_HEX * 180 / Math.PI).toFixed(2)}° 后铣刀正对主轴中心线（X=${J.XM.toFixed(2)}）`);
const b = run('bolt');
ok(b && Math.abs(b.x1 - b.x0 - 16) < 0.01, `螺栓总长 ${(b.x1 - b.x0).toFixed(2)} = 头 4 + 杆 12`);
let worst = 0; for (let x = J.bolt.HEAD_L + 0.2; x <= J.bolt.HEAD_R - 0.2; x += 0.1) worst = Math.max(worst, range((xx, t) => b.rOut(xx, t), x)[0]);
ok(Math.abs(worst - 5) < 1e-6, '螺栓头六个面全铣到（对边 10，每个截面最小半径都是 5）');
const th = range((x, t) => b.rOut(x, t), 104);
ok(Math.abs(th[1] - 3) < 1e-3 && Math.abs(th[0] - (3 - 0.613)) < 0.01, `M6 螺纹：牙顶 ${th[1].toFixed(3)}，牙底 ${th[0].toFixed(3)}`);
const n = run('nut');
ok(n && Math.abs(n.x1 - n.x0 - 5) < 0.01, `螺母厚 ${(n.x1 - n.x0).toFixed(2)}`);
const mid = (n.x0 + n.x1) / 2, ni = range((x, t) => n.rIn(x, t), mid);
ok(Math.abs(ni[0] - 2.5) < 1e-3 && Math.abs(ni[1] - 3) < 0.01, `螺母底孔 Φ${(2 * ni[0]).toFixed(2)}，内螺纹到 Φ${(2 * ni[1]).toFixed(2)}`);
worst = 0; for (let x = n.x0 + 0.2; x <= n.x1 - 0.2; x += 0.1) worst = Math.max(worst, range((xx, t) => n.rOut(xx, t), x)[0]);
ok(Math.abs(worst - 5) < 1e-6, '螺母六个面（Φ8 刀）全铣到');
const tp = run('tripod');
ok(tp && Math.abs(tp.x1 - tp.x0 - 18) < 0.01, `相机螺丝总长 ${(tp.x1 - tp.x0).toFixed(2)}`);
const tt = range((x, t) => tp.rOut(x, t), 106);
ok(Math.abs(tt[1] - 3.175) < 1e-3 && Math.abs(tt[0] - (3.175 - 0.78)) < 0.01, `1/4-20 螺纹：牙顶 ${tt[1].toFixed(3)}，牙底 ${tt[0].toFixed(3)}`);
const kn = range((x, t) => tp.rOut(x, t), 96);
ok(kn[1] <= 9 + 1e-6 && kn[0] < 8.8, `滚花头：${kn[0].toFixed(2)} ~ ${kn[1].toFixed(2)}`);

console.log(fail ? `${fail} 项失败` : '全部通过');
process.exit(fail ? 1 : 0);
