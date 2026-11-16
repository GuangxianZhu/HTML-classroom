// 自检：node test_physics.mjs
// 文案（page.html、main.js 里的猜题答案）写死了一些数字，这里用 physics.js 重新算一遍，对不上就报错。
import * as P from './src/physics.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? '  ok ' : 'FAIL '} ${name}${detail ? '  ' + detail : ''}`); };
const near = (name, x, want, tol) => ok(name, Math.abs(x - want) <= tol, `${(+x).toFixed(3)}（文案写 ${want}）`);
const { ms, kmh, rad } = P;

console.log('— 换算');
near('kW = 扭矩 × rpm ÷ 9549 里的 9549', P.K9549, 9549, 0.5);
near('1 马力（PS）= 0.7355 kW', 75 * P.G / 1000, 0.7355, 0.0005);
console.log('— 第 1～4 步的猜题');
near('第 1 步：300 N × 0.30 m = 90 N·m（默认值，拧不动）', P.torque(300, 0.30), 90, 1e-9);
ok('第 1 步：默认值确实拧不动，握到 0.37 m 以外就拧得动', P.torque(300, 0.30) < P.BOLT && P.torque(300, 0.37) >= P.BOLT);
near('第 2 步：800 rpm、半径 0.30 m ≈ 25.1 m/s', P.wheelSpeed(800, 0.30), 25.1, 0.05);
near('第 2 步：≈ 90 km/h', kmh(P.wheelSpeed(800, 0.30)), 90, 1);
near('第 3 步：100 kg × 1 m/s = 981 W', P.hoist(100, 1, 0.1).P, 981, 0.5);
near('第 3 步：50 kg × 2 m/s 也是 981 W', P.hoist(50, 2, 0.1).P, 981, 0.5);
near('第 3 步：50 kg 的拉力约 490 N', P.hoist(50, 2, 0.1).F, 490, 1);
ok('第 3 步：力 × 速度 = 扭矩 × 角速度', Math.abs(P.hoist(137, 1.7, 0.1).P - P.hoist(137, 1.7, 0.1).P2) < 1e-9);
const gp = P.gearPair(20, 60, 3000, 100);
near('第 4 步：输出转速 1000 rpm', gp.n2, 1000, 1e-9);
near('第 4 步：输出扭矩约 294 N·m', gp.T2, 294, 0.5);
near('第 4 步：输入功率 31.4 kW', gp.P1 / 1000, 31.4, 0.05);
near('第 4 步：输出功率 30.8 kW', gp.P2 / 1000, 30.8, 0.05);
console.log('— 第 5 步：例子车');
near('最大功率约 80 kW', P.bestPower(1000, 6500).P / 1000, 80, 1);
ok('最大功率在 6000 rpm 附近、最大扭矩 142 N·m 在 4200 rpm', Math.abs(P.bestPower(1000, 6500).n - 6000) < 100 && P.tqWot(4200) === 142);
near('60 km/h、守在 4200 rpm：推力约 3160 N', P.pushAt(ms(60), 4200).F, 3160, 10);
near('60 km/h、守在 6000 rpm：推力约 4070 N', P.pushAt(ms(60), 6000).F, 4070, 10);
near('抓地力上限约 6785 N', P.traction(), 6785, 1);
near('100 km/h 的阻力约 536 N（前面聊天里说约 540 N）', P.resist(ms(100)), 536, 3);
console.log('— 第 6 步：空气');
near('每 kg 空气约 2.9 MJ', P.HEAT_PER_AIR / 1e6, 2.9, 0.03);
const e = P.engineAir({ disp: 1.5, n: 6000 });
near('1.5 L、6000 rpm 每秒扫过 75 L', e.vs * 1000, 75, 1e-9);
near('6000 rpm 充气效率九成', e.vol, 0.90, 1e-9);
near('每秒吸进约 81 g 空气', e.air * 1000, 81, 0.5);
near('默认 34% 热效率时约 80 kW（和例子车对得上）', e.P / 1000, 80.6, 0.1);
near('6000 rpm 的扭矩约 128 N·m（例子车的扭矩表也是 128）', e.T, P.tqWot(6000), 1);
ok('充气效率的估算曲线写在 lim 里：1000 rpm 78%、4000 rpm 95%、7000 rpm 76%', P.ve(1000) === 0.78 && P.ve(4000) === 0.95 && P.ve(7000) === 0.76);
{
  let best = 0, at = 0; for (let n = 1000; n <= 7000; n += 50) { const p = P.engineAir({ disp: 1.5, n }).P; if (p > best) { best = p; at = n; } }
  ok('这个模型的功率最高点在 6000～6500 rpm（高转速）', at >= 6000 && at <= 6500, `${at} rpm`);
  ok('扭矩最高点在中间（3500～4500 rpm）', [3500, 4000, 4500].some((n) => Math.abs(P.engineAir({ disp: 1.5, n }).T - Math.max(...[1000, 2000, 3000, 4000, 5000, 6000, 7000].map((m) => P.engineAir({ disp: 1.5, n: m }).T))) < 1));
  ok('增压 1.33 倍的 1.5 L ≈ 2.0 L 自吸（“1.5 T 顶 2.0 L”）', Math.abs(P.engineAir({ disp: 1.5, n: 6000, boost: 4 / 3 }).P - P.engineAir({ disp: 2.0, n: 6000 }).P) < 1);
}
console.log('— 第 7、8 步：电机');
const m = P.motor({ U: 400, I: 400, k: 0.75, n: 1000 });
near('扭矩上限 300 N·m', m.Tmax, 300, 1e-9);
near('基速约 5090 rpm', m.nb, 5093, 1);
near('最大功率 160 kW', m.Pmax / 1000, 160, 1e-9);
ok('转速为 0 时扭矩就是最大', P.motor({ U: 400, I: 400, k: 0.75, n: 0 }).T === 300);
ok('过基速以后功率保持 160 kW', Math.abs(P.motor({ U: 400, I: 400, k: 0.75, n: 9000 }).P - 160000) < 1);
ok('关掉弱磁：基速以上很快掉到零', P.motor({ U: 400, I: 400, k: 0.75, n: 6000, weak: false }).T === 0);
{
  const a = P.motor({ U: 400, I: 400, k: 0.6, n: 0 }), b = P.motor({ U: 400, I: 400, k: 1.2, n: 0 });
  ok('k 翻倍：扭矩上限翻倍、基速减半、功率不变', Math.abs(b.Tmax / a.Tmax - 2) < 1e-9 && Math.abs(a.nb / b.nb - 2) < 1e-9 && a.Pmax === b.Pmax);
}
const fa = P.evPush(ms(30), { U: 400, I: 400, k: 0.75, gear: 8.13, r: 0.305 }).F, fb = P.evPush(ms(30), { U: 400, I: 400, k: 0.75, gear: 4.07, r: 0.305 }).F;
near('力优先：车轮最大推力约 8000 N', fa, 8000, 10);
near('力优先：拐点约 72 km/h', kmh(160000 / fa), 72, 0.5);
near('速度优先：车轮最大推力约 4000 N', fb, 4000, 10);
near('速度优先：拐点约 144 km/h', kmh(160000 / fb), 144, 0.5);
ok('力优先的推力比电动车的抓地力大（会打滑）', fa > P.traction(P.EV), `抓地力 ${P.traction(P.EV).toFixed(0)} N`);
console.log('— 第 9 步：油车和电车');
{
  const pw = P.bestPower(1000, P.CAR.limit).P * P.CAR.eta;
  near('两台车车轮上的最大功率约 68 kW', pw / 1000, 68, 0.5);
  ok('停车起步时油车被抓地力封顶（变矩器把扭矩放大了）', P.engineEnvelope(0).why === '抓地力封顶');
  const stall = P.engineEnvelope(0);
  ok('起步时变矩器那一路给的力比抓地力还大', stall.Ftc > P.traction(), `${stall.Ftc.toFixed(0)} N`);
  ok('30～40 km/h 油车被最低挡封顶', P.engineEnvelope(ms(30)).why === '最低挡封顶' && P.engineEnvelope(ms(40)).why === '最低挡封顶');
  let same = true;
  for (let k = 60; k <= 160; k += 10) {
    const a = P.engineEnvelope(ms(k)).F, b = P.ev9({ gear: 8, v: ms(k) }).F;
    if (Math.abs(a - b) / a > 0.01 || Math.abs(a - pw / ms(k)) / a > 0.01) same = false;
  }
  ok('60～160 km/h 两条线和功率线重合（差不到 1%）', same);
  ok('电车 8 的齿比：低速推力平，被电机扭矩上限 × 齿比限制', Math.abs(P.ev9({ gear: 8, v: ms(5) }).F - P.ev9({ gear: 8, v: ms(30) }).F) < 1);
}
console.log(`\n${pass} 项通过，${fail} 项失败`);
process.exit(fail ? 1 : 0);
