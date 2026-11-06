// 物理核心的校验：力平衡自洽、下垂和入口压力效应的方向、背压阀、四种控制方式的结果
import * as C from './src/reg_core.js';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok  ' : '  FAIL') + ' ' + msg); if (!cond) fails++; };
const f3 = (v) => v.toFixed(3);

console.log('# 稳态：弹簧式，设定 0.20 MPa，入口 0.40 MPa');
const r = C.REG.spring;
const set = { F0: C.F0For(r, 0.2, 0.4, 0) };
const K1 = C.seriesK(C.LINE.Kn, C.LINE.KfClean);
const s = C.steady(r, 0.4, K1, set);
console.log(`  x=${f3(s.x)} mm  P=${f3(s.P)} MPa  Q=${s.Q.toFixed(2)} L/min  state=${s.state}`);
ok(Math.abs(C.netForce(r, s.x, 0.4, K1, set)) < 1e-3, '解出来的开度上净力为零');
ok(s.P < 0.2 && s.P > 0.15, '有流量时出口压力低于关死时的设定（下垂）');
const lock = C.steady(r, 0.4, 0, set);
ok(lock.state === 'lock' && Math.abs(lock.P - 0.2) < 1e-6, '下游关死时停在设定压力');

console.log('# 下垂：弹簧式 vs 气控式，流量从 0.5 到 5 L/min');
const d = C.REG.dome;
const setD = { Pp: C.PpFor(d, 0.2, 0.4, 0) };
const droop = (rr, st) => { const a = C.steady(rr, 0.4, 0.5 / Math.sqrt(0.2), st), b = C.steady(rr, 0.4, 5 / Math.sqrt(0.2), st); return { a, b, dp: (a.P - b.P) * 1000 }; };
const ds = droop(r, set), dd = droop(d, setD);
console.log(`  弹簧式下垂 ${ds.dp.toFixed(1)} kPa（${ds.a.Q.toFixed(2)}→${ds.b.Q.toFixed(2)} L/min）；气控式 ${dd.dp.toFixed(1)} kPa`);
ok(ds.dp > 4 * dd.dp, '气控式（没有主弹簧）下垂明显更小');

console.log('# 入口压力效应（气控式）：入口 0.30 → 0.50 MPa');
const ru = C.REG.domeUnbal, rb = C.REG.dome;
const sb = { Pp: C.PpFor(rb, 0.2, 0.4, 0) }, su = { Pp: C.PpFor(ru, 0.2, 0.4, 0) };
const pe = (rr, st) => { const a = C.steady(rr, 0.3, K1, st), b = C.steady(rr, 0.5, K1, st); return (b.P - a.P) * 1000; };
const eU = pe(ru, su), eB = pe(rb, sb);
console.log(`  不平衡阀芯：出口变化 ${eU.toFixed(2)} kPa；带平衡膜片：${eB.toFixed(2)} kPa`);
ok(eU < 0, '不平衡阀芯：入口升高，出口反而略降（入口压力把阀芯往关的方向推）');
ok(Math.abs(eB) < Math.abs(eU) / 2, '平衡膜片把入口压力效应压到很小');

console.log('# 饱和：入口压力不够');
const sat = C.steady(d, 0.205, 6 / Math.sqrt(0.2), setD);
console.log(`  入口 0.21 MPa、大流量：state=${sat.state} P=${f3(sat.P)}`);
ok(sat.state === 'sat', '入口压力只比设定高一点、流量又大时，阀全开也够不着设定');

console.log('# 背压阀循环回路');
for (const useBpr of [false, true]) {
  const row = [0, 2, 4, 6, 8].map((n) => C.loopSolve({ n, useBpr }));
  console.log(`  ${useBpr ? '背压阀' : '固定节流'}：` + row.map((q, n) => `${[0, 2, 4, 6, 8][n]}台 ${f3(q.P)} MPa 回流 ${q.Qret.toFixed(1)}`).join(' | '));
}
const b0 = C.loopSolve({ n: 0, useBpr: true }), b4 = C.loopSolve({ n: 4, useBpr: true });
const n0 = C.loopSolve({ n: 0, useBpr: false }), n4 = C.loopSolve({ n: 4, useBpr: false });
ok(Math.abs(b0.P - b4.P) < 0.4 * Math.abs(n0.P - n4.P), '背压阀让主管压力随用液台数的变化小得多');
const b6 = C.loopSolve({ n: 8, useBpr: true });
ok(b6.Qret < 0.05 * b0.Qret || b6.P < 0.24, '用液超过泵的余量时，背压阀关死、压力掉下去（失效边界）');

console.log('# 时域仿真：三个扰动全开');
const ev = { recipe: true, dip: true, clog: true };
const res = {};
for (const st of C.STRATS) {
  const t0 = performance.now();
  const sim = C.simulate({ strat: st, ev });
  const e = C.phaseErrors(sim);
  res[st.id] = e;
  console.log(`  ${st.name.padEnd(12)} 配方后 ${e.recipe.toFixed(1)}%  供压下降 ${e.dip.toFixed(1)}%  过滤器堵 ${e.clog.toFixed(1)}%   (${(performance.now() - t0).toFixed(0)} ms)`);
}
ok(res.manual.recipe < -20, '手动式跟不上配方改动');
ok(Math.abs(res.open.recipe) < 6, '开环气控能靠标定表大致跟上配方');
ok(res.open.clog < -8 && res.pfb.clog < -8, '只看压力（开环或压力闭环）挡不住过滤器堵塞');
ok(Math.abs(res.qfb.clog) < 2, '流量闭环把过滤器堵塞补回来');
ok(Math.abs(res.pfb.dip) < 1.5 && Math.abs(res.qfb.dip) < 1.5, '闭环把供压下降补回来');

console.log('# 增益太高会振荡');
const hi = C.simulate({ strat: C.STRATS[3], ev: { recipe: true, dip: false, clog: false }, gain: 4, noise: false });
let mx = 0; for (let k = 0; k < hi.t.length; k++) if (hi.t[k] > 2) mx = Math.max(mx, hi.Q[k]);
const lo = C.simulate({ strat: C.STRATS[3], ev: { recipe: true, dip: false, clog: false }, gain: 1, noise: false });
let ml = 0; for (let k = 0; k < lo.t.length; k++) if (lo.t[k] > 2) ml = Math.max(ml, lo.Q[k]);
console.log(`  流量环 1× 最大超调 ${(100 * (ml / 1.8 - 1)).toFixed(1)}%，4× 最大超调 ${(100 * (mx / 1.8 - 1)).toFixed(1)}%`);
ok(mx / 1.8 - 1 > 3 * Math.max(0.01, ml / 1.8 - 1), '增益调到 4 倍，超调明显变大');

console.log(fails ? `\n${fails} 项没通过` : '\n全部通过');
process.exit(fails ? 1 : 0);
