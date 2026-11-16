// 施工进度模型自检：node test_core.mjs
import fs from 'fs';
import { makeSchedule, stateAt, visible, coreFill, platformAt, TRADES } from './src/core.js';

const P = JSON.parse(fs.readFileSync('../params.json', 'utf8'));
const spec = JSON.parse(fs.readFileSync('../blender/out/spec.json', 'utf8'));
const sch = makeSchedule(P, spec);
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('FAIL', msg); } };

// 1. 阶段首尾相接、单调
for (let i = 1; i < sch.ph.length; i++) ok(Math.abs(sch.ph[i].t0 - sch.ph[i - 1].t1) < 1e-9, `阶段 ${sch.ph[i].key} 接不上`);
ok(sch.ph.every((p) => p.t1 > p.t0), '有零长度阶段');

// 2. 任何时刻：核心筒 ≥ 钢柱 ≥ 钢梁 ≥ 楼承板 ≥ 楼板 ≥ 幕墙
let prevCounts = null, maxLead = 0;
for (let d = 0; d <= sch.end; d += 0.25) {
  const s = stateAt(sch, d);
  const c = s.counts;
  for (let i = 1; i < TRADES.length; i++) ok(c[TRADES[i - 1]] >= c[TRADES[i]], `第 ${d} 天 ${TRADES[i - 1]}=${c[TRADES[i - 1]]} < ${TRADES[i]}=${c[TRADES[i]]}`);
  if (prevCounts) for (const t of TRADES) ok(c[t] >= prevCounts[t], `第 ${d} 天 ${t} 倒退`);
  prevCounts = c;
  maxLead = Math.max(maxLead, c.core - c.slab);
  // 造楼机在墙顶以上：平台根 = 已浇完的墙顶（顶升时根在旧墙顶，平台整体加 lift）
  const pl = s.plat;
  if (pl.show && s.core.cur && s.core.cur > P.schedule.low_floors) {
    const n = s.core.cur;
    const expect = s.core.step === 0 || s.core.step === 1 ? sch.z[n] : sch.z[n + 1];
    ok(Math.abs(pl.rootZ - expect) < 1e-9, `第 ${d} 天 平台位置不对`);
    ok(pl.lift >= 0 && pl.lift <= sch.z[n + 1] - sch.z[n] + 1e-9, `第 ${d} 天 顶升量越界 ${pl.lift}`);
    ok(pl.rodExt >= P.platform.cyl.ext - 1e-9 && pl.rodExt <= P.platform.cyl.ext + P.platform.cyl.stroke + 1e-9, `第 ${d} 天 油缸伸出 ${pl.rodExt} 超过行程`);
  }
}
// 3. 顶升结束那一刻，平台从 z[n]+h 平滑接到 z[n+1]+0
const n = 20;
const tA = sch.cStart[n] + (sch.cEnd[n] - sch.cStart[n]) * P.schedule.split[1];
const a = platformAt(sch, tA - 1e-6), b = platformAt(sch, tA + 1e-6);
ok(Math.abs(a.rootZ + a.lift - (b.rootZ + b.lift)) < 1e-3, `顶升结束跳变 ${a.rootZ + a.lift} -> ${b.rootZ + b.lift}`);
// 4. 浇筑：墙从 0 长到 1
ok(coreFill(sch, n, sch.cStart[n]) === 0 && coreFill(sch, n, sch.cEnd[n]) === 1, '核心筒浇筑进度');
// 5. 竣工那天全部可见
for (const st of ['raft', 'core', 'column', 'steel', 'deck', 'slab', 'curtain', 'roof']) ok(visible(sch, st, 30, sch.end), `竣工时 ${st} 不可见`);
// 6. 核心筒每层 4 天（标准层）
ok(Math.abs(sch.cEnd[30] - sch.cStart[30] - 4) < 1e-9, '标准层不是 4 天');
// 7. 地下室在地上开工前全部完成
ok(sch.bSlab[-1] <= sch.cStart[1] + 1e-9, '地下室没做完就开始地上');

const fin = stateAt(sch, sch.end);
console.log(`总工期 ${sch.end} 天（${fin.date}），核心筒封顶第 ${sch.coreTop} 天，核心筒最多领先楼板 ${maxLead} 层`);
console.log(sch.ph.map((p) => `${p.name} ${p.t0}-${p.t1}`).join(' | '));
console.log(fail ? `${fail} 项失败` : '全部通过');
process.exit(fail ? 1 : 0);
