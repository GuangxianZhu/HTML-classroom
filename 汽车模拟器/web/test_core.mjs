// 自检：node test_core.mjs
// 校验 core.js 的几何和 Blender 那边一致、发动机 / 变矩器 / CVT / 整车的数落在这个级别的车该有的范围里，
// 以及几条“应该发生的事”（蠕行、失速、定油门加速转速不动、松油门断油、能量守恒）。
import fs from 'fs';
import { makeCar, run, RPM, beltPath, pistonHeight, rodAngle, valveLift } from './src/core.js';

const P = JSON.parse(fs.readFileSync(new URL('../params.json', import.meta.url), 'utf8'));
const spec = JSON.parse(fs.readFileSync(new URL('../blender/out/spec.json', import.meta.url), 'utf8'));
const D = spec.powertrain.derived;
const car = makeCar(P), S = P.sim, C = P.cvt, E = P.engine;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? '  ok ' : 'FAIL '} ${name}${detail ? '  ' + detail : ''}`); };
const within = (name, x, lo, hi, unit = '') => ok(name, x >= lo && x <= hi, `${(+x).toFixed(Math.abs(x) < 20 ? 2 : 0)}${unit}（应在 ${lo}–${hi}）`);
const near = (name, x, y, tol) => ok(name, Math.abs(x - y) <= tol, `${(+x).toFixed(3)} ≈ ${(+y).toFixed(3)}`);
const at = (log, t) => log.find((q) => q.t >= t) || log.at(-1);
const cruiseState = (kmh, ratio = 1) => { const s = car.initial(); s.gear = 'D'; s.v = kmh / 3.6; s.lock = 1; s.lockOn = true; s.ratio = ratio; s.we = Math.max(S.idle, kmh * car.rpmPerKmh * ratio) / RPM; return s; };

console.log('— 几何：和 Blender 建的模型是不是同一套数');
ok('三维模型是按现在这份 params.json 建的（改了参数要重新跑 build_car.py）', ['place', 'engine', 'cvt'].every((k) => JSON.stringify(spec.params[k]) === JSON.stringify(P[k])));
near('最低挡速比', car.ratioLow, D.ratio_low, 0.002);
near('最高挡速比', car.ratioHigh, D.ratio_high, 0.002);
near('主减速比', car.final, D.final, 0.002);
near('钢带长度', car.BELT, D.belt_len, 0.1);
near('排量', car.disp, D.disp_cc, 0.2);
near('锥面角的正切', car.tan, D.tan, 1e-6);
{
  let worst = 0, rMax = 0;
  for (let i = 0; i <= 40; i++) {
    const ratio = car.ratioHigh + (car.ratioLow - car.ratioHigh) * i / 40, { r1, r2 } = car.radii(ratio);
    worst = Math.max(worst, Math.abs(car.beltLen(r1, r2) - car.BELT), Math.abs(r2 / r1 - ratio) * 100);
    rMax = Math.max(rMax, r1, r2);
    const path = beltPath(D.a0, D.a1, r1, r2);
    worst = Math.max(worst, Math.abs(path.total - car.BELT));
  }
  ok('整个速比范围里钢带长度不变、半径和速比对得上', worst < 0.01, `最大偏差 ${worst.toExponential(1)}`);
  ok('钢带不会爬出锥盘', rMax + C.belt_t / 2 <= C.sheave_r + 1.01, `最大半径 ${rMax.toFixed(1)} + 半个带厚 ≤ 盘半径 ${C.sheave_r}`);
  const p = beltPath(D.a0, D.a1, C.r_min, C.r_max);
  let gap = 0, prev = p.at(0);
  for (let i = 1; i <= 400; i++) { const q = p.at(p.total * i / 400); gap = Math.max(gap, Math.hypot(q[0] - prev[0], q[1] - prev[1])); prev = q; }
  ok('钢带中心线首尾接得上、没有断点', gap < p.total / 400 * 1.01, `相邻点最远 ${gap.toFixed(3)} mm`);
  const mid = (r1, r2) => [D.x0p - C.belt_w / 2 + r1 * car.tan, D.x0s + C.belt_w / 2 - r2 * car.tan];
  let off = 0;
  for (let i = 0; i <= 20; i++) { const { r1, r2 } = car.radii(car.ratioHigh + (car.ratioLow - car.ratioHigh) * i / 20); const [a, b] = mid(r1, r2); off = Math.max(off, Math.abs(a - b)); }
  ok('两个轮上钢带的中面一直对齐（偏差 < 1.5 mm）', off < 1.5, `最大 ${off.toFixed(2)} mm`);
}
near('活塞销在上止点的高度 = 连杆 + 曲柄半径', pistonHeight(D.r_crank, E.rod, 0), E.rod + D.r_crank, 1e-9);
near('活塞行程', pistonHeight(D.r_crank, E.rod, 0) - pistonHeight(D.r_crank, E.rod, Math.PI), E.stroke, 1e-9);
ok('连杆最大摆角不到 20°', Math.abs(rodAngle(D.r_crank, E.rod, Math.PI / 2)) * 180 / Math.PI < 20);
ok('气门：做功冲程两个都关着，进气冲程中间进气门全开', valveLift('in', 90) === 0 && valveLift('ex', 90) === 0 && valveLift('in', 470) > 0.999 && valveLift('ex', 250) > 0.999);

console.log('— 发动机');
{
  let pk = 0, npk = 0, tk = 0, ntk = 0, best = 0;
  for (let n = 800; n <= 6500; n += 50) {
    const t = car.tqWot(n), p = t * n / RPM / 1000;
    if (p > pk) { pk = p; npk = n; }
    if (t > tk) { tk = t; ntk = n; }
    for (let lam = 0.2; lam <= 1; lam += 0.05) { const te = car.brakeTq(n, lam); if (te > 0) best = Math.max(best, te * n / RPM / (car.fuelRate(n, lam) * S.lhv)); }
  }
  within('最大功率', pk, 76, 84, ' kW'); within('最大功率转速', npk, 5500, 6300, ' rpm');
  within('最大扭矩', tk, 135, 150, ' N·m'); within('最大扭矩转速', ntk, 3500, 4800, ' rpm');
  within('升功率', pk / (car.disp / 1000), 45, 60, ' kW/L');
  within('最好的有效热效率', best * 100, 32, 37, ' %');
  ok('目标转速线上要的扭矩都不超过全开扭矩', S.ool.every(([kw, n]) => kw * 1000 / (n / RPM) <= car.tqWot(n) + 0.5));
  ok('负荷比例和扭矩互相换算得回来', Math.abs(car.brakeTq(3000, car.lamFor(3000, 77)) - 77) < 1e-9);
}
{
  const o = run(car, () => ({ pedal: 0, gear: 'N' }), 20).log.at(-1);
  within('空挡怠速转速', o.n, 740, 760, ' rpm'); within('空挡怠速油耗', o.lph, 0.45, 0.75, ' L/h');
  within('空挡时涡轮跟着泵轮转（转速比）', o.nTurbine / o.n, 0.9, 1.0);
  const q = run(car, () => ({ pedal: 0, brake: 1, gear: 'D' }), 20).log.at(-1);
  within('D 挡踩着刹车的怠速转速', q.n, 735, 765, ' rpm'); within('D 挡踩着刹车的怠速油耗', q.lph, 0.6, 1.0, ' L/h');
  const r = run(car, () => ({ pedal: 1, gear: 'N' }), 8);
  const nMax = Math.max(...r.log.map((x) => x.n));
  within('空挡地板油：断油限速', nMax, S.limit - 50, S.limit + 150, ' rpm');
}

console.log('— 变矩器和起步');
{
  const o = run(car, () => ({ pedal: 0, gear: 'D' }), 40).log.at(-1);
  within('松开刹车不踩油门的蠕行车速', o.kmh, 4, 9, ' km/h');
  const q = run(car, () => ({ pedal: 1, brake: 1, gear: 'D' }), 6).log.at(-1);
  within('失速转速（刹车踩死 + 地板油）', q.n, 2300, 3000, ' rpm');
  ok('失速时车不动', Math.abs(q.kmh) < 0.01);
  near('失速时扭矩放大倍数', q.tr, S.tc_stall_ratio, 1e-6);
  near('失速时发动机的功全变成油的热', q.pTcLoss, q.pShaft, q.pShaft * 0.02);
}

console.log('— 加速和极速');
{
  const r = run(car, () => ({ pedal: 1, gear: 'D' }), 100), log = r.log;
  const t100 = log.find((x) => x.kmh >= 100).t, vmax = log.at(-1).kmh;
  within('0–100 km/h', t100, 9.5, 13.5, ' s');
  within('极速', vmax, 165, 188, ' km/h');
  within('起步最大加速度（前轮抓地力封顶）', Math.max(...log.map((x) => x.a)) / 9.81, 0.35, 0.56, ' g');
  ok('极速时驱动力 = 风阻 + 滚阻', Math.abs(log.at(-1).fDrive - log.at(-1).fAero - log.at(-1).fRoll) < 15);
  ok('全程转速不超过断油转速', Math.max(...log.map((x) => x.n)) < S.limit + 100);
  ok('速比一直在两个极限之间', log.every((x) => x.ratio <= car.ratioLow + 1e-9 && x.ratio >= car.ratioHigh - 1e-9));
  const a = at(log, 6), b = at(log, 14);
  ok('地板油：车速从 ' + a.kmh.toFixed(0) + ' 涨到 ' + b.kmh.toFixed(0) + ' km/h，转速一直守在最大功率点附近', Math.abs(a.n - b.n) < 80 && b.kmh - a.kmh > 30 && Math.abs(a.n - 5950) < 120, `${a.n.toFixed(0)} → ${b.n.toFixed(0)} rpm`);
  ok('锁止离合器在 ' + S.lock_on_kmh + ' km/h 以后压紧', at(log, 0.3).lock === 0 && log.find((x) => x.lock >= 0.999).kmh < 45);
  const s0 = run(car, () => ({ pedal: 1, brake: 1, gear: 'D' }), 3).s;
  const q = run(car, () => ({ pedal: 1, gear: 'D' }), 6, 1 / 240, s0).log;
  ok('先失速再松刹车：驱动力被前轮抓地力封顶', Math.max(...q.map((x) => x.fDrive)) <= car.fTraction + 1 && q.some((x) => x.tcs), `上限 ${car.fTraction.toFixed(0)} N`);
}

console.log('— 定油门：CVT 的看家本领');
{
  const log = run(car, () => ({ pedal: 0.4, gear: 'D' }), 30).log;
  const seg = log.filter((x) => x.kmh >= 30 && x.kmh <= 80);
  const ns = seg.map((x) => x.n), rs = seg.map((x) => x.ratio);
  ok('40% 油门从 30 加速到 80 km/h：转速变化不到 60 rpm，速比从 ' + rs[0].toFixed(2) + ' 降到 ' + rs.at(-1).toFixed(2), Math.max(...ns) - Math.min(...ns) < 60 && rs[0] / rs.at(-1) > 2, `${Math.min(...ns).toFixed(0)}–${Math.max(...ns).toFixed(0)} rpm`);
  ok('这段里发动机在目标转速上（差不到 60 rpm）', seg.every((x) => Math.abs(x.n - x.nTarget) < 60));
}
for (const [kmh, lo, hi] of [[60, 3.3, 5.2], [100, 5.4, 7.4], [120, 6.8, 9.4]]) {
  let a = 0, b = 1, x;
  for (let i = 0; i < 18; i++) { const m = (a + b) / 2; x = run(car, () => ({ pedal: m }), 60, 1 / 240, cruiseState(kmh)).log.at(-1); if (x.kmh < kmh) a = m; else b = m; }
  within(`${kmh} km/h 匀速油耗`, x.lph / x.kmh * 100, lo, hi, ' L/100km');
  if (kmh === 100) within('100 km/h 匀速时的转速（速比已经到最高挡）', x.n, 1900, 2300, ' rpm');
}

console.log('— 松油门、刹车、挡位');
{
  const log = run(car, () => ({ pedal: 0 }), 90, 1 / 240, cruiseState(80, 0.6)).log;
  ok('80 km/h 松油门：断油，喷油量是 0', at(log, 2).cut && at(log, 2).lph === 0 && at(log, 10).lph === 0);
  ok('断油时车轮倒拖发动机（扭矩是负的）', at(log, 5).te < -15 && at(log, 5).tin < 0);
  ok('滑到低速恢复喷油、回到怠速，不熄火', !log.at(-1).cut && Math.abs(log.at(-1).n - S.idle) < 15 && Math.min(...log.map((x) => x.n)) > 600, `最低 ${Math.min(...log.map((x) => x.n)).toFixed(0)} rpm`);
  const b = run(car, () => ({ pedal: 0, brake: 1 }), 12, 1 / 240, cruiseState(100, 0.45));
  const tStop = b.log.find((x) => Math.abs(x.kmh) < 0.01).t;
  within('100 km/h 刹到底的时间', tStop, 2.4, 3.4, ' s');
  ok('刹停以后不会倒退；急刹时速比来不及完全回到最低挡，但已经很接近', Math.abs(b.s.v) < 1e-6 && b.s.ratio > 2.2, `速比 ${b.s.ratio.toFixed(2)}，最低挡 ${car.ratioLow.toFixed(2)}`);
  const rv = run(car, () => ({ pedal: 0.2, gear: 'R' }), 6).log.at(-1);
  ok('R 挡往后走', rv.kmh < -3, `${rv.kmh.toFixed(1)} km/h`);
  const pk = run(car, () => ({ pedal: 0.5, gear: 'P' }), 4).log.at(-1);
  ok('P 挡踩油门车不动、转速上去', pk.kmh === 0 && pk.n > 2000);
  const s = cruiseState(50);
  ok('车在跑的时候挂不进 P 和 R', car.shift(s, 'P') !== '' && car.shift(s, 'R') !== '' && s.gear === 'D' && car.shift(s, 'N') === '' && s.gear === 'N');
  const hill = run(car, () => ({ pedal: 0.4, grade: 0.10, gear: 'D' }), 60).log.at(-1), flat = run(car, () => ({ pedal: 0.4, gear: 'D' }), 60).log.at(-1);
  ok('同样 40% 油门，10% 的坡上跑得慢、速比更低', hill.kmh < flat.kmh - 15 && hill.ratio > flat.ratio, `${hill.kmh.toFixed(0)} 对 ${flat.kmh.toFixed(0)} km/h`);
}

console.log('— 能量守恒');
{
  const dt = 1 / 240, s = car.initial(); car.shift(s, 'D');
  let eWheel = 0, eLoss = 0, eFuel = 0, eShaft = 0, eInd = 0;
  for (let i = 0; i < 240 * 30; i++) {
    const o = car.step(s, { pedal: i < 240 * 18 ? 0.7 : 0.15 }, dt), v = o.kmh / 3.6;
    eWheel += o.fDrive * v * dt; eLoss += (o.fAero + o.fRoll) * v * dt; eFuel += o.pFuel * dt; eShaft += o.pShaft * dt; eInd += o.pInd * dt;
  }
  const ke = 0.5 * car.mEff * s.v ** 2;
  near('30 s 里车轮做的功 = 动能 + 风阻滚阻吃掉的', eWheel / (ke + eLoss), 1, 0.01);
  ok('车轮得到的功比曲轴输出的少（中间有变矩器和变速箱的损失）', eWheel < eShaft && eWheel > 0.7 * eShaft, `${(eWheel / eShaft * 100).toFixed(0)}%`);
  near('缸内做的功 = 油的能量 × 指示热效率', eInd / eFuel, S.eta_ind, 1e-6);
  near('油耗累计 = 喷油量的积分', s.fuel * S.lhv, eFuel, eFuel * 1e-9);
}

console.log(`\n${pass} 项通过，${fail} 项失败`);
process.exit(fail ? 1 : 0);
