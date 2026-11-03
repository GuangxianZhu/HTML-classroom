// node test_model.mjs —— 校验架构数据和五个模型。没通过就退出码 1
import fs from 'fs';
import * as S from './src/sim.js';

const spec = JSON.parse(fs.readFileSync('../blender/out/spec.json', 'utf8'));
let bad = 0;
const ok = (c, msg) => { if (!c) { bad++; console.log('FAIL', msg); } };
const near = (a, b, e, msg) => ok(Math.abs(a - b) <= e, `${msg}: ${a} vs ${b}`);

// 数据完整性
for (const a of 'ABC') {
  const ids = Object.entries(spec.ecus).filter(([, e]) => e.arch.includes(a)).map(([k]) => k);
  const g = S.netGraph(spec, a);
  // 所有盒子和外设都连通
  for (const k of ids) for (const j of ids) if (k < j) ok(S.route(g, k, j), `arch ${a}: ${k} 到 ${j} 不通`);
  for (const k of Object.keys(spec.endpoints)) ok(S.route(g, k, ids[0]), `arch ${a}: 外设 ${k} 不通`);
  ok(spec.stats[a].ecu === ids.length, `arch ${a}: 盒子数`);
}
ok(spec.stats.A.ecu === 34 && spec.stats.B.ecu === 25 && spec.stats.C.ecu === 12, '盒子数 34/25/12');
ok(spec.stats.C.len_m < spec.stats.A.len_m, 'C 线束比 A 短');

// 需求影响
const F = Object.fromEntries(spec.features.map((f) => [f.id, f]));
for (const fe of spec.features) for (const a of 'ABC') {
  const r = S.impact(spec, fe, a);
  ok(r.touched.length > 0, `${fe.id}/${a}: 没有动到盒子`);
  const fl = S.featureFlows(spec, fe, a, S.netGraph(spec, a));
  ok(Array.isArray(fl), `${fe.id}/${a}: 路径`);
}
const w = (a) => S.impact(spec, F.welcome, a);
ok(w('A').touched.length > w('B').touched.length, '迎宾 A > B');
ok(w('C').touched.length === 1 && w('C').touched[0] === 'CCC', '迎宾 C 只改中央');
ok(w('C').shared > w('A').shared, '共享宿主数反过来：C 更多');
for (const a of 'ABC') ok(S.impact(spec, F.abs, a).touched.join() === 'ESC', `ABS 在 ${a} 都只动 ESC`);
ok(S.impact(spec, F.ui, 'A').touched.length === 1, 'UI 改版经典也只动车机');

// 交付时间
ok(S.classicDelivery(-36, 'comfort').at === 0, '赶得上冻结就进 SOP');
ok(S.classicDelivery(-10, 'comfort').at === 12, '赶不上等年改');
ok(S.classicDelivery(1, 'comfort').at === 24, 'SOP 后第 1 月提出、第 10 月就绪，赶不上第 12 月年改的第 6 月冻结线，只能等第 24 月');
ok(S.sdvDelivery(5, 'comfort', { cadence: 1, auto: .7 }).sold, 'OTA 能给已售车');
ok(S.sdvDelivery(5, 'hw').at === S.classicDelivery(5, 'hw').at, '要硬件时两条路一样');
ok(S.sdvDelivery(5, 'hw', { preinstalled: true }).sold, '预埋硬件走 OTA');
ok(S.sdvDelivery(5, 'safety', { auto: 0 }).at > S.sdvDelivery(5, 'safety', { auto: 1 }).at, '自动化率越低越慢');
for (const k of Object.keys(S.KINDS)) for (const t of [-36, -8, 0, 7, 30]) {
  ok(S.classicDelivery(t, k).at >= t, `classic 不能早于提出 ${k} ${t}`);
  ok(S.sdvDelivery(t, k).at >= t, `sdv 不能早于提出 ${k} ${t}`);
}

// 灰度
const bb = S.rollout({ mode: 'bigbang', pFail: .03, ab: false, detect: 12 });
const st = S.rollout({ mode: 'staged', pFail: .03, ab: false, detect: 12 });
ok(st.dead < bb.dead, `灰度伤得更少 ${st.dead} vs ${bb.dead}`);
ok(st.done + st.rolled + st.dead + st.untouched === st.N, '账对得上');
const clean = S.rollout({ mode: 'staged', pFail: 0 });
ok(clean.done === 240 && clean.haltAt === Infinity, '没 bug 时全量完成');
ok(S.rollout({ mode: 'staged', pFail: .03, ab: true }).dead === 0, 'A/B 分区不趴窝');
const rc = S.recall(240, .1);
near(rc.filter((t) => t <= 12).length / 240, 1 - .9 ** 12, .08, '召回到店率');

// 调度
const a0 = S.schedule({ strategy: 'shared', load: 0 });
ok(a0.maxR === 1 && a0.miss === 0, '没负载时响应就是 C');
const a1 = S.schedule({ strategy: 'shared', load: .8 });
ok(a1.miss > 0, '共享核高负载会超时');
ok(S.schedule({ strategy: 'part', load: .8 }).miss === 0, '分区不超时');
near(S.schedule({ strategy: 'part', load: 1 }).maxR, 1.55, 1e-9, '分区 C 随负载变长');
ok(S.schedule({ strategy: 'mcu', load: 1 }).maxR < 1.03, 'MCU 基本不抖');
ok(S.schedule({ strategy: 'shared', load: .2 }).maxR < a1.maxR, '负载越高越抖');

// 现金流
const c0 = S.cash({});
near(c0.cum[0], -32, 1e-9, '第 0 年 = -20 -12');
ok(S.cash({ vol: 300 }).payback !== null && (S.cash({ vol: 300 }).payback < (S.cash({ vol: 100 }).payback ?? 99)), '量大回本快');
ok(S.cash({ vol: 10, arpu: 0 }).payback === null, '量小又没收入就回不了本');

// 页面文案里写死的判断，也要和模型对得上
const lenA = spec.stats.A.len_m, lenB = spec.stats.B.len_m, lenC = spec.stats.C.len_m;
ok(lenB > lenA, '文案：域集中的线比分布式长');
near(1 - lenC / lenA, 1 / 3, .03, '文案：中央+区域的线少约三分之一');
ok(S.cash({ vol: 500, years: 15 }).payback !== null, '文案：年销 500 万辆摊得开');
ok(S.cash({ vol: 30, years: 15 }).payback === null, '文案：年销 30 万辆摊不开');
ok(S.sdvDelivery(5, 'comfort', { auto: 0 }).at - 5 > S.sdvDelivery(5, 'comfort', { auto: 1 }).at - 5, '文案：自动化率拉到 0 会变慢');
ok(S.deliveryCurve('hw', {}).classic.join() === S.deliveryCurve('hw', {}).sdv.join(), '文案：要新硬件时两条线重合');

if (bad) { console.log(bad, 'failed'); process.exit(1); }
console.log('all model checks passed');
for (const a of 'ABC') console.log(a, spec.stats[a].ecu, '盒子', spec.stats[a].len_m, 'm', S.owners(spec, a).length, '方');
for (const fe of spec.features) console.log(fe.id.padEnd(8), 'ABC'.split('').map((a) => { const r = S.impact(spec, fe, a); return `${a}:${r.touched.length}盒/${r.parties}方/${r.signals}信号/${r.shared}同住`; }).join('  '));
console.log('schedule shared load .6', S.schedule({ strategy: 'shared', load: .6 }).missPct.toFixed(1), '% miss, max', S.schedule({ strategy: 'shared', load: .6 }).maxR.toFixed(1));
console.log('cash default', c0.payback, c0.end.toFixed(1), 'vol300', S.cash({ vol: 300 }).payback);
console.log('rollout bigbang', bb.dead, bb.untouched, 'staged', st.dead, st.untouched, st.tEnd.toFixed(0));
