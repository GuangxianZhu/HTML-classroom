// 施工进度模型：给一个“第几天”，算出工地此刻的样子。
// 纯函数、不碰 three.js，node 里也能跑（test_core.mjs）。坐标用 Blender 的 z 向上（米）。
// 唯一的数字来源：params.json（schedule / tower / platform）和 blender/out/spec.json（各层标高）。

export const TRADES = ['core', 'column', 'steel', 'deck', 'slab', 'curtain'];
export const TRADE_NAME = { core: '核心筒', column: '钢柱', steel: '钢梁', deck: '楼承板', slab: '楼板', curtain: '幕墙' };
export const STEPS = [
  { key: 'rebar', name: '绑钢筋' },
  { key: 'jack', name: '拆模顶升' },
  { key: 'pour', name: '合模浇筑' },
  { key: 'cure', name: '养护' },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);

export function makeSchedule(P, spec) {
  const S = P.schedule;
  const T = P.tower;
  const z = {};
  for (const [k, v] of Object.entries(spec.tower.z)) z[+k] = v;
  const N = T.floors;               // 54
  const topCore = N + 1;            // 55：屋顶机房那一层核心筒
  z[topCore + 1] = z[topCore] + T.typ_height;
  const outrig = new Set(T.outrigger);
  const B = T.basement.heights.length;

  const ph = [];                    // 阶段 [{key,name,t0,t1}]
  let t = 0;
  const add = (key, name, d) => { ph.push({ key, name, t0: t, t1: t + d }); t += d; return ph[ph.length - 1]; };
  add('site', '场地准备', S.site);
  add('dwall', '地下连续墙', S.dwall);
  add('excavate', '基坑开挖', S.excavate);
  add('raft', '筏板浇筑', S.raft);
  const bStart = t;
  add('basement', '地下室结构', S.basement_level * B);
  // 地下室：从 -4 层往上，每层先墙柱、后顶板
  const bVert = {}, bSlab = {};
  for (let i = 0; i < B; i++) {
    const L = -B + i;
    const t0 = bStart + i * S.basement_level;
    bVert[L] = t0 + S.basement_level * S.basement_vert;
    bSlab[L] = t0 + S.basement_level;
  }
  // 核心筒：1..low_floors 常规模板，然后装造楼机，之后每层一个循环
  const cStart = {}, cEnd = {};
  const lowPh = add('low', '低区核心筒', 0);
  for (let n = 1; n <= topCore; n++) {
    if (n === S.low_floors + 1) {
      lowPh.t1 = t;
      add('install', '造楼机安装', S.install);
      ph.push({ key: 'cycle', name: '标准层：核心筒先行', t0: t, t1: 0 });
    }
    const d = n <= S.low_floors ? S.low_cycle : outrig.has(n) ? S.outrigger_cycle : S.cycle;
    cStart[n] = t;
    cEnd[n] = t + d;
    t += d;
  }
  ph[ph.length - 1].t1 = t;
  const coreTop = t;
  add('dismantle', '核心筒封顶 · 造楼机拆除', S.dismantle);
  const roofDay = t;
  // 其他工种：第 f 层在核心筒做完第 f+lag 层时完成；核心筒封顶以后按同样节奏往后排
  const coreEndExt = (k) => (k <= topCore ? cEnd[Math.max(1, k)] : coreTop + (k - topCore) * S.cycle);
  const done = {};
  for (const tr of TRADES.slice(1)) {
    done[tr] = {};
    for (let f = 1; f <= N; f++) done[tr][f] = coreEndExt(f + S.lags[tr]);
  }
  const curtainEnd = done.curtain[N];
  if (curtainEnd > t) {
    ph.push({ key: 'curtain', name: '幕墙收尾', t0: t, t1: curtainEnd });
    t = curtainEnd;
  }
  ph.push({ key: 'finish', name: '竣工验收', t0: t, t1: t + S.finish });
  t += S.finish;

  const pourEnd = (n) => cStart[n] + (cEnd[n] - cStart[n]) * S.split[2];
  return { P, S, z, N, topCore, B, ph, bVert, bSlab, cStart, cEnd, done, coreTop, roofDay, end: t, pourEnd,
    excavate: ph.find((p) => p.key === 'excavate'), dwall: ph.find((p) => p.key === 'dwall'),
    raft: ph.find((p) => p.key === 'raft'), install: ph.find((p) => p.key === 'install'),
    dismantle: ph.find((p) => p.key === 'dismantle'), site: ph.find((p) => p.key === 'site') };
}

export function phaseAt(sch, day) {
  let i = sch.ph.findIndex((p) => day < p.t1);
  if (i < 0) i = sch.ph.length - 1;
  return i;
}

export function dateOf(sch, day) {
  const d = new Date(sch.S.start + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Math.floor(day));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// 某一时刻正在做的核心筒层和它的工序
export function coreAt(sch, day) {
  for (let n = 1; n <= sch.topCore; n++) {
    if (day < sch.cEnd[n]) {
      if (day < sch.cStart[n]) return { floor: n - 1, cur: null };
      const f = (day - sch.cStart[n]) / (sch.cEnd[n] - sch.cStart[n]);
      const sp = sch.S.split;
      const step = f < sp[0] ? 0 : f < sp[1] ? 1 : f < sp[2] ? 2 : 3;
      const a = [0, ...sp, 1][step], b = [0, ...sp, 1][step + 1];
      return { floor: n - 1, cur: n, step, stepFrac: (f - a) / (b - a), frac: f };
    }
  }
  return { floor: sch.topCore, cur: null };
}

// 竖向构件（核心筒 n 层）的显示程度 0..1：浇筑时从下往上“长”出来
export function coreFill(sch, n, day) {
  if (n < 1) return day >= sch.bVert[n] ? 1 : 0;
  const s = sch.cStart[n], e = sch.cEnd[n], sp = sch.S.split;
  const p0 = s + (e - s) * sp[1], p1 = s + (e - s) * sp[2];
  return clamp((day - p0) / (p1 - p0), 0, 1);
}

export function visible(sch, stage, floor, day) {
  switch (stage) {
    case 'raft': return day >= (sch.raft.t0 + sch.raft.t1) / 2;
    case 'bwall': return day >= sch.bVert[floor];
    case 'bslab': return day >= sch.bSlab[floor];
    case 'core': return floor < 1 ? day >= sch.bVert[floor] : coreFill(sch, floor, day) > 0;
    case 'column': return floor < 1 ? day >= sch.bVert[floor] : day >= sch.done.column[floor];
    case 'steel': case 'outrigger': return day >= sch.done.steel[floor];
    case 'deck': return day >= sch.done.deck[floor];
    case 'slab': return day >= sch.done.slab[floor];
    case 'curtain': return day >= sch.done.curtain[floor];
    case 'roof': return day >= sch.roofDay;
    default: return true;
  }
}

export function countDone(sch, trade, day) {
  if (trade === 'core') {
    let c = 0;
    for (let n = 1; n <= sch.N; n++) if (coreFill(sch, n, day) >= 1) c = n;
    return c;
  }
  let c = 0;
  for (let f = 1; f <= sch.N; f++) if (day >= sch.done[trade][f]) c = f;
  return c;
}

// 造楼机：在哪、顶到哪、油缸伸多少
export function platformAt(sch, day) {
  const S = sch.S, Q = sch.P.platform;
  const ins = sch.install, dis = sch.dismantle;
  if (day < ins.t0 || day >= dis.t1) return { show: false };
  const out = { show: true, build: 1, rodExt: Q.cyl.ext, lift: 0, slew: 0 };
  if (day < ins.t1) {
    out.build = (day - ins.t0) / (ins.t1 - ins.t0);
    out.rootZ = sch.z[S.low_floors + 1];
    return out;
  }
  if (day >= dis.t0) {
    out.build = 1 - (day - dis.t0) / (dis.t1 - dis.t0);
    out.rootZ = sch.z[sch.topCore + 1];
    return out;
  }
  const c = coreAt(sch, day);
  const n = c.cur;
  if (n == null) { out.rootZ = sch.z[c.floor + 1]; return out; }
  const h = sch.z[n + 1] - sch.z[n];
  if (c.step === 0) {
    out.rootZ = sch.z[n];
  } else if (c.step === 1) {
    // 分 strokes 次顶：每次先伸缸把平台顶起 h/strokes，再缩缸把油缸支架提上来
    out.rootZ = sch.z[n];
    const s = c.stepFrac * S.strokes;
    const k = Math.min(Math.floor(s), S.strokes - 1);
    const u = s - k;
    const up = clamp(u / 0.75, 0, 1);
    out.lift = (h / S.strokes) * (k + smooth(up));
    const ext = h / S.strokes;
    out.rodExt = Q.cyl.ext + (u < 0.75 ? ext * smooth(up) : ext * (1 - smooth((u - 0.75) / 0.25)));
    out.jacking = true;
  } else {
    out.rootZ = sch.z[n + 1];
    if (c.step === 2) out.slew = Math.sin(c.stepFrac * Math.PI * 4) * 0.5;
  }
  return out;
}

// 基坑：开挖深度（负数）、内支撑在不在
export function pitAt(sch, day) {
  const B = sch.P.tower.basement;
  const bottom = sch.z[-sch.B] - B.raft_t_outer;
  const ex = sch.excavate;
  const depth = day < ex.t0 ? 0 : day >= ex.t1 ? bottom : bottom * smooth((day - ex.t0) / (ex.t1 - ex.t0));
  const dw = sch.dwall;
  return {
    depth,
    dwall: clamp((day - dw.t0) / (dw.t1 - dw.t0), 0, 1),
    struts: depth < -3 && day < sch.bSlab[-1],
    fence: day >= sch.site.t0 + (sch.site.t1 - sch.site.t0) * 0.3,
  };
}

export function stateAt(sch, day) {
  day = clamp(day, 0, sch.end);
  const counts = {};
  for (const tr of TRADES) counts[tr] = countDone(sch, tr, day);
  return {
    day, date: dateOf(sch, day), phase: phaseAt(sch, day),
    core: coreAt(sch, day), plat: platformAt(sch, day), pit: pitAt(sch, day), counts,
  };
}
