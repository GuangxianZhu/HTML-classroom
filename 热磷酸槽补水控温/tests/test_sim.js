// 自检：node tests/test_sim.js
// 跑页面里「试一下」的几个场景，确认模型表现和页面文案说的一致。
const S = require('../src/sim.js');
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fail++; };
const run = (s, sec, dt = 0.1) => { for (let i = 0; i < Math.round(sec / dt); i++) S.step(s, dt); };
const span = (L, k) => { const a = L.map(r => r[k]); return [Math.min(...a), Math.max(...a)]; };
const tail = (s, n = 600) => s.log.slice(-n);

console.log('沸点曲线');
ok(Math.abs(S.tb(85, S.P0) - 158) < 0.05, '85% 常压沸点 158 ℃');
const dTdP = (S.tb(S.W0, S.P0 + 10) - S.tb(S.W0, S.P0)) / 10;
ok(dTdP > 0.03 && dTdP < 0.037, `每 hPa ${dTdP.toFixed(4)} ℃（约 0.033）`);
ok(Math.abs(S.tb(S.W0, S.P0) - 160) < 0.01, `160 ℃ 对应 ${S.W0.toFixed(2)} %`);

console.log('沸腾耦合');
{ const s = S.create(); run(s, 900); const [lo, hi] = span(tail(s), 'Tm');
  ok(hi - lo < 0.05, `稳态槽温 ${lo.toFixed(3)}~${hi.toFixed(3)}`);
  ok(s.bl > 3.5 && s.bl < 4.5, `默认沸腾度 ${s.bl.toFixed(2)}（4 级附近）`); }
{ const s = S.create(); s.pi = 'band'; run(s, 1200); const [lo, hi] = span(tail(s), 'Tm');
  ok(hi - lo > 0.3, `区间开关有锯齿 ${(hi - lo).toFixed(2)} ℃`); }
{ const s = S.create(); s.pi = 'aggr'; s.dead = 15; run(s, 1200); const [lo, hi] = span(tail(s), 'Tm');
  ok(hi - lo > 0.4, `PI 激进 + 15 s 死区震荡 ${(hi - lo).toFixed(2)} ℃`); }
const drop = ff => { const s = S.create(); s.ff = ff; run(s, 200); const t0 = s.t; S.dropWafers(s); run(s, 580);
  const L = s.log.filter(r => r.t >= t0), rec = L.find(r => r.t > t0 + 20 && r.Tm > 159.7);
  return { min: span(L, 'Tm')[0], max: span(L, 'Tm')[1], wmin: span(L, 'w')[0], wmax: span(L, 'w')[1], rec: rec ? rec.t - t0 : 1e9 }; };
{ const a = drop('none'), b = drop('base'), c = drop('freeze');
  ok(a.min < 158.5 && c.min < 158.5, `投片降温 ${c.min.toFixed(2)} ℃`);
  ok(a.max > 160.8 && a.wmax > 85.9, `照常积分过冲到 ${a.max.toFixed(2)} ℃ / ${a.wmax.toFixed(2)} %`);
  ok(b.wmin < 85.55 && b.rec > c.rec + 60, `维持基础补水：浓度掉到 ${b.wmin.toFixed(2)} %，回温 ${b.rec.toFixed(0)} s`);
  ok(c.rec < 150 && c.max < 160.3, `冻结 + 前馈：${c.rec.toFixed(0)} s 回温，最高 ${c.max.toFixed(2)} ℃`); }
{ const s = S.create(); run(s, 100); s.Ptarget = 975; run(s, 1200); const w = S.wp(s);
  ok(w - S.W0 > 0.3 && Math.abs(s.Tm - 160) < 0.05, `975 hPa：槽温 ${s.Tm.toFixed(2)}，浓度高 ${(w - S.W0).toFixed(2)} %`);
  s.comp = true; run(s, 1800); ok(Math.abs(S.wp(s) - S.W0) < 0.03, `气压补偿后浓度回到 ${S.wp(s).toFixed(2)} %`); }
{ const s5 = S.create(); s5.exh = 5; run(s5, 1200); const s20 = S.create(); s20.exh = 20; run(s20, 1200);
  ok(s5.bl > 4.5, `−5 mmH2O 沸腾度 ${s5.bl.toFixed(2)}`); ok(!s20.boiling, '−20 mmH2O 不沸腾'); }
{ const s = S.create({ fresh: true }); let tB = 0, TB = 0;
  for (let i = 0; i < 60000; i++) { S.step(s, 0.1); if (!tB && s.boiling) { tB = s.t; TB = s.T; } }
  ok(Math.abs(TB - 158) < 0.3, `新液在 ${TB.toFixed(1)} ℃ 开始沸腾`); ok(Math.abs(s.Tm - 160) < 0.05, `新液最后稳在 ${s.Tm.toFixed(2)} ℃`); }

console.log('温浓分离');
{ const s = S.create({ mode: 'split' }); run(s, 1500); const [lo, hi] = span(tail(s), 'Tm');
  ok(!s.boiling && lo > 159.7 && hi < 160.3, `次沸点运行，槽温 ${lo.toFixed(2)}~${hi.toFixed(2)}`);
  ok(Math.abs(S.wp(s) - S.WT) < 0.02, `浓度守在目标 ${S.wp(s).toFixed(3)} %`);
  const t0 = s.t; S.dropWafers(s); let paused = false;
  for (let i = 0; i < 6000; i++) { S.step(s, 0.1); if (s.frozen && s.duty === 0) paused = true; }
  const L = s.log.filter(r => r.t >= t0); ok(paused, '投片后浓度控制暂停过');
  ok(span(L, 'Tm')[1] < 160.3 && Math.abs(s.Tm - 160) < 0.05, `投片后回到 ${s.Tm.toFixed(2)} ℃`); }
{ const s = S.create({ mode: 'split' }); run(s, 300); s.Ptarget = 975; run(s, 1800);
  ok(s.boiling && s.heater > 11000, `975 hPa：槽液沸腾，加热器 ${(s.heater / 1000).toFixed(1)} kW`); }
{ const s = S.create({ mode: 'split' }); s.meterOff = true; run(s, 3600);
  ok(S.wp(s) - S.WT > 0.5 && Math.abs(s.Tm - 160) < 0.05, `只控温 1 小时浓度升 ${(S.wp(s) - S.WT).toFixed(2)} %`); }

console.log(fail ? `\n${fail} 项没通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
