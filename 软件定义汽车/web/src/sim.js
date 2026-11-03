// 页面里所有算出来的数字都在这里。纯函数，不碰 DOM，test_model.mjs 直接跑。
// 除了 impact() 用的是模型自带的架构数据，其余四个都是教学用的玩具模型：
// 结构是真的，默认参数是我选的，不是任何车企的实测值。

export const ARCH = {
  A: { cn: '分布式', tag: '经典', color: '#ff9d3c' },
  B: { cn: '域集中', tag: '过渡', color: '#ffd166' },
  C: { cn: '中央 + 区域', tag: '软件定义', color: '#4cc9f0' },
};

// ---------------------------------------------------------- 第 3 章：改一个功能要动多少东西
export function busesOf(spec, arch, host) {
  const out = [];
  for (const [name, ids] of Object.entries(spec.buses[arch])) if (ids.includes(host)) out.push(name);
  return out;
}

export function impact(spec, fe, arch) {
  const touched = new Set(), used = new Set();
  for (const id of fe.fns) {
    const F = spec.functions[id];
    for (const h of F.hosts[arch]) touched.add(h);
    if (arch === 'C') for (const h of F.io_c) used.add(h);
  }
  // 信号要跨总线时，网关的路由表也得改。C 架构走服务，不需要改中间节点
  const segs = new Set();
  for (const h of touched) for (const b of busesOf(spec, arch, h)) segs.add(b);
  if (arch !== 'C') {
    const domains = new Set([...touched].map((h) => spec.ecus[h].dom));
    if ((arch === 'A' && segs.size > 1) || (arch === 'B' && domains.size > 1)) touched.add('GW');
  }
  for (const h of touched) used.delete(h);
  // 新增的跨盒子信号：相邻两步的逻辑不在同一个盒子里就要多定义一条
  let signals = 0;
  for (let i = 1; i < fe.steps.length; i++) {
    const a = spec.functions[fe.steps[i - 1].f].hosts[arch][0];
    for (const b of spec.functions[fe.steps[i].f].hosts[arch]) if (a !== b) signals++;
  }
  const sup = new Set([...touched].map((h) => spec.ecus[h].sup).filter((s) => s !== 'OEM'));
  // 同住一个盒子的功能：出问题时可能被连带，回归时都得看一眼
  const shared = new Set();
  for (const [id, F] of Object.entries(spec.functions)) if (F.hosts[arch].some((h) => touched.has(h))) shared.add(id);
  return { touched: [...touched], used: [...used], signals, suppliers: [...sup], parties: sup.size + 1, shared: shared.size };
}

/** 一个架构里，每个盒子跑着哪些功能 */
export function functionsOn(spec, arch, host) {
  return Object.entries(spec.functions).filter(([, F]) => F.hosts[arch].includes(host) || (arch === 'C' && F.io_c.includes(host))).map(([id]) => id);
}

/** 一个架构里，写软件的有几方 */
export function owners(spec, arch) {
  const set = new Set();
  for (const e of Object.values(spec.ecus)) if (e.arch.includes(arch)) set.add(e.sup);
  return [...set];
}

/** 网络图：节点是盒子和外设，边带三维折线。BFS 找两点之间最少跳的路 */
export function netGraph(spec, arch) {
  const adj = new Map();
  const put = (a, b, e) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push({ to: b, e }); };
  for (const e of spec.nets[arch]) { put(e.a, e.b, { pts: e.pts }); put(e.b, e.a, { pts: [...e.pts].reverse() }); }
  return adj;
}

export function route(adj, a, b) {
  if (a === b) return [];
  const prev = new Map([[a, null]]), q = [a];
  while (q.length) {
    const u = q.shift();
    if (u === b) break;
    for (const { to, e } of adj.get(u) || []) if (!prev.has(to)) { prev.set(to, { u, e }); q.push(to); }
  }
  if (!prev.has(b)) return null;
  const legs = [];
  for (let c = b; prev.get(c); c = prev.get(c).u) legs.unshift(prev.get(c).e.pts);
  return legs;
}

/** 把一个需求按信号走向展开成一段段路径，返回 [{ legs, t0 }]，t0 是这一跳开始的先后序号 */
export function featureFlows(spec, fe, arch, adj) {
  const flows = [];
  let order = 0;
  const hostsOf = (f) => spec.functions[f].hosts[arch];
  let prev = null;
  for (const st of fe.steps) {
    const hs = hostsOf(st.f);
    for (const e of st.inp || []) {
      const legs = route(adj, e, hs[0]);
      if (legs) flows.push({ legs, order, cross: true });
    }
    if (prev) {
      for (const h of hs) {
        const legs = route(adj, prev, h);
        if (legs && legs.length) flows.push({ legs, order, cross: true });
      }
    }
    order++;
    for (const e of st.out || []) {
      for (const h of hs) {
        const target = spec.endpoints[e].hosts[arch];
        if (h !== target && hs.includes(target)) continue;
        const legs = route(adj, h, e);
        if (legs) flows.push({ legs, order, cross: false });
        break;
      }
    }
    prev = hs[0];
    order++;
  }
  return flows;
}

// ---------------------------------------------------------- 第 4 章：需求出现到车上用到，隔多久
export const KINDS = {
  comfort: { cn: '舒适功能', crew: 9, vmin: .5, vman: 3 },
  adas: { cn: '智驾功能', crew: 14, vmin: 1.5, vman: 6 },
  safety: { cn: '安全相关', crew: 18, vmin: 4, vman: 8 },
  hw: { cn: '要新硬件', crew: 24, vmin: 4, vman: 8 },
};

/** 经典：改动先过供应商变更流程（crew 个月），赶得上软件冻结就进 SOP，赶不上就等下一次年改 */
export function classicDelivery(t, kind, { freeze = 6, cycle = 12 } = {}) {
  const ready = t + KINDS[kind].crew;
  if (ready <= -freeze && t < 0) return { at: 0, sold: false };
  const k = Math.max(1, Math.ceil((ready + freeze) / cycle));
  return { at: k * cycle, sold: false };
}

/** 软件定义：验证时间 = 必做的 + 手工部分 ×（1 − 自动化率），等下一班发布，再灰度一个月。
 *  要新硬件时软件快也没用，走和经典一样的路；除非硬件已经预埋 */
export function sdvDelivery(t, kind, { freeze = 6, cycle = 12, cadence = 1, auto = .7, preinstalled = false } = {}) {
  if (kind === 'hw' && !preinstalled) {
    const c = classicDelivery(t, kind, { freeze, cycle });
    return { at: c.at, sold: false };
  }
  const K = KINDS[kind];
  const ready = t + K.vmin + K.vman * (1 - auto);
  if (ready <= -1) return { at: 0, sold: true };
  const train = Math.ceil(ready / cadence - 1e-9) * cadence;
  return { at: Math.max(train, 0) + 1, sold: true };
}

export function deliveryCurve(kind, opt, t0 = -36, t1 = 36, dt = .25) {
  const x = [], classic = [], sdv = [];
  for (let t = t0; t <= t1 + 1e-9; t += dt) {
    x.push(t);
    classic.push(classicDelivery(t, kind, opt).at - t);
    sdv.push(sdvDelivery(t, kind, opt).at - t);
  }
  return { x, classic, sdv };
}

// ---------------------------------------------------------- 第 5 章：一次推送，出问题时伤到多少车
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const CAR = { OLD: 0, DONE: 1, ROLLED: 2, DEAD: 3, FAILING: 4 };

/** 车队里每辆车什么时候装、装完怎样。时间单位：小时
 *  mode: 'bigbang' 一次全推 | 'staged' 分批 1%/10%/50%/100%，每批观察 hold 小时
 *  装失败的车被统计到 notice 辆，再过 detect 小时，后面的批次停推 */
export function rollout({ N = 240, mode = 'staged', pFail = .02, hold = 24, detect = 12, notice = 2, ab = true, meanInstall = 8, seed = 7 } = {}) {
  const r = rng(seed);
  const order = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const stages = mode === 'bigbang' ? [1] : [.01, .1, .5, 1];
  const cars = Array.from({ length: N }, () => ({ start: Infinity, fail: false }));
  order.forEach((id, k) => {
    const frac = (k + 1) / N;
    const st = stages.findIndex((s) => frac <= s + 1e-9);
    cars[id].start = st * hold + -Math.log(1 - r() * .999) * meanInstall;
    cars[id].fail = r() < pFail;
  });
  const fails = cars.filter((c) => c.fail).map((c) => c.start).sort((a, b) => a - b);
  const haltAt = pFail > 0 && fails.length >= notice ? fails[notice - 1] + detect : Infinity;
  let done = 0, rolled = 0, dead = 0, untouched = 0, tEnd = 0;
  for (const c of cars) {
    if (c.start >= haltAt) { c.start = Infinity; untouched++; continue; }
    if (c.fail) { if (ab) rolled++; else dead++; } else done++;
    tEnd = Math.max(tEnd, c.start + 1);
  }
  return { cars, haltAt, done, rolled, dead, untouched, tEnd, N, ab };
}

/** t 时刻第 i 辆车的状态 */
export function carState(c, t, ab) {
  if (t < c.start) return CAR.OLD;
  if (!c.fail) return CAR.DONE;
  if (t < c.start + .6) return CAR.FAILING;
  return ab ? CAR.ROLLED : CAR.DEAD;
}

/** 经典召回：车主自己回店，每月有 rate 比例的剩余车到店。时间单位：月 */
export function recall(N, rate, seed = 3) {
  const r = rng(seed);
  return Array.from({ length: N }, () => -Math.log(1 - r() * .999) / -Math.log(1 - rate));
}

// ---------------------------------------------------------- 第 6 章：控制环和大负载同住一颗芯片
export const SCHED = {
  shared: { cn: '同一系统共享核' },
  part: { cn: '虚拟化时间分区' },
  mcu: { cn: '独立安全 MCU' },
};

/** 控制任务周期 T、计算量 C（ms）。负载的不可抢占段按泊松到达，长度指数分布，封顶 maxL。
 *  shared：撞上不可抢占段就得等它结束
 *  part  ：时间片保证轮到控制分区，但缓存和内存总线还共享，C 随负载变长
 *  mcu   ：完全隔开，只剩很小的固定抖动 */
export function schedule({ strategy = 'shared', load = .6, T = 5, C = 1, slot = 1.8, meanL = 1.2, maxL = 14, jobs = 600, seed = 11 } = {}) {
  const r = rng(seed);
  const horizon = T * jobs + 20;
  const secs = [];
  if (strategy === 'shared' && load > 0) {
    const gap = meanL * (1 - load) / load;
    let t = 0;
    while (t < horizon) {
      t += -Math.log(1 - r() * .9999) * gap;
      const L = Math.min(-Math.log(1 - r() * .9999) * meanL, maxL);
      secs.push([t, t + L]);
      t += L;
    }
  }
  const res = [];
  let k = 0, free = 0, miss = 0, maxR = 0, sum = 0;
  for (let j = 0; j < jobs; j++) {
    const rel = j * T;
    let start = Math.max(rel, free), c = C;
    if (strategy === 'shared') {
      while (k < secs.length && secs[k][1] <= start) k++;
      if (k < secs.length && secs[k][0] <= start) start = secs[k][1];
    } else if (strategy === 'part') {
      c = C * (1 + .55 * load);
      if (c > slot) { c = slot + (c - slot) + (T - slot); }   // 一个时间片做不完，只能等下一帧接着做
    } else {
      c = C + .02;
    }
    const end = start + c;
    free = end;
    const R = end - rel;
    res.push(R);
    if (R > T) miss++;
    maxR = Math.max(maxR, R); sum += R;
  }
  return { res, miss, missPct: miss / jobs * 100, maxR, avg: sum / jobs, secs, T, C };
}

// ---------------------------------------------------------- 第 7 章：这笔账什么时候回本
/** 相对经典模式的增量现金流（亿元）。第 0..2 年开发，第 3 年开始卖车
 *  invest 平台一次性投入，team 软件团队年成本，vol 年销量（万辆），
 *  bom 单车硬件成本变化（元，正数更贵），save 单车质保/物流/装配省下的钱（元），arpu 每辆在役车每年软件净收入（元） */
export function cash({ invest = 60, team = 12, vol = 100, bom = 300, save = 400, arpu = 200, years = 12, life = 10 } = {}) {
  const x = [], cum = [], fleet = [];
  let c = 0, payback = null, f = 0;
  for (let y = 0; y <= years; y++) {
    const selling = y >= 3;
    if (selling) f = Math.min(f + vol, vol * life);
    const flow = (y < 3 ? -invest / 3 : 0) - team + (selling ? vol * (save - bom) / 1e4 : 0) + f * arpu / 1e4;
    c += flow;
    x.push(y); cum.push(c); fleet.push(f);
    if (payback === null && c >= 0 && y >= 3) payback = y;
  }
  return { x, cum, fleet, payback, end: c };
}
