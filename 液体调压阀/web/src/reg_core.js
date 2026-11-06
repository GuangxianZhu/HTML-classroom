// 液体调压阀的物理核心：力平衡 + 阀口流量 + 下游负载，外加开环/闭环时域仿真和循环回路背压阀。
// 单位：压力 MPa（表压），面积 mm²，力 N（MPa·mm² = N），阀芯开度 mm，流量 L/min。
// 这是教学用的集总参数模型：忽略流体力、阀芯惯性、液体压缩性和管路水锤。

export const RHO = 1000;          // kg/m³，按水算；很多药液在 1000–1800
export const CD = 0.62;           // 阀口流量系数（锐边孔口的常见值）
const LPM = 6e4;                  // m³/s → L/min
export const area = (d) => Math.PI * d * d / 4;

// 一台调压阀的几何和刚度（数值是本页设定的示意值，量级参照公开资料）
//   Dd 主膜片有效直径  Ds 阀座直径  Db 平衡膜片直径（0 = 不平衡）
//   ks 主弹簧刚度（气控式为 0）  kd 膜片自身刚度  kr 回位弹簧刚度  Fr0 回位弹簧预紧
//   xmax 最大开度  fric 摩擦/迟滞（N）
export function makeReg(o = {}) {
  const r = { Dd: 50, Ds: 6, Db: 0, ks: 55, kd: 3, kr: 1.5, Fr0: 6, xmax: 1.5, load: 'spring', fric: 3, ...o };
  r.Ad = area(r.Dd); r.As = area(r.Ds); r.Ab = area(r.Db);
  r.Ap = r.Ad;                       // 气控式：先导气压直接压在主膜片上，面积 1:1
  r.Aeff = r.Ad - r.As;              // 出口压力向上推的净面积
  r.unbal = r.As - r.Ab;             // 入口压力作用在阀芯上的净面积（向上，关阀方向）
  return r;
}
export const REG = {
  spring: makeReg({ load: 'spring', Db: 0, ks: 55, kd: 3, fric: 3 }),
  springBal: makeReg({ load: 'spring', Db: 6, ks: 55, kd: 3, fric: 3 }),
  dome: makeReg({ load: 'air', Db: 6, ks: 0, kd: 4, fric: 2 }),
  domeUnbal: makeReg({ load: 'air', Db: 0, ks: 0, kd: 4, fric: 2 }),
};

// 固定阀芯双膜片定压阀：气室夹在两张膜片之间。
//   向上（开）：气压 ×(A1−A2) + 入口压力 ×(A2−Ab)；向下（关）：出口压力 ×(A1−Ab) + 膜片刚度
//   A1 上膜片、A2 下膜片、Ab 套筒中心孔。专利没给尺寸，这里取 Ø56 / Ø18 / Ø8 的示意值。
REG.fixed = (() => {
  const r = makeReg({ load: 'air', Dd: 56, Ds: 8, Db: 0, ks: 0, kd: 5, kr: 0, Fr0: 0, xmax: 2.0, fric: 2 });
  const A1 = area(56), A2 = area(18), Ab = area(8);
  r.Ap = A1 - A2; r.Aeff = A1 - Ab; r.unbal = -(A2 - Ab);
  return r;
})();

// 阀口：开度 x 下的流量系数 a，Q = a·√ΔP（L/min, MPa）
export function valveA(r, x) {
  const A = Math.min(Math.PI * r.Ds * Math.max(0, x), r.As) * 1e-6; // 帘面积，最多到阀座面积
  return CD * A * Math.sqrt(2e6 / RHO) * LPM;
}
// 下游负载：喷嘴和过滤器串联，都按孔口处理：Q = K·√P
export const seriesK = (...ks) => { let s = 0; for (const k of ks) { if (k <= 0) return 0; s += 1 / (k * k); } return s ? 1 / Math.sqrt(s) : 0; };

// 加载力（开阀方向）：弹簧式随开度变小，气控式就是先导压力 × 面积
export const loadForce = (r, x, set) => (r.load === 'spring' ? set.F0 - r.ks * x : set.Pp * r.Ap);
// 关阀方向的力（不含出口压力项）
export const closeExtra = (r, x, Pin) => Pin * r.unbal + r.Fr0 + (r.kr + r.kd) * x;
// 力平衡要求的出口压力
export const poutForce = (r, x, Pin, set) => (loadForce(r, x, set) - closeExtra(r, x, Pin)) / r.Aeff;
// 给定开度时，液压平衡给出的出口压力：a²(Pin−P) = K²P
export function poutHyd(r, x, Pin, K) {
  const a = valveA(r, x);
  if (a <= 0) return 0;
  return a * a * Pin / (a * a + K * K);
}
// 某开度下作用在阀芯组件上的净力（正 = 继续开）
export function netForce(r, x, Pin, K, set) {
  const P = poutHyd(r, x, Pin, K);
  return loadForce(r, x, set) - closeExtra(r, x, Pin) - P * r.Aeff;
}
// 设定压力 → 弹簧预紧力 F0（在指定开度下刚好平衡）
export const F0For = (r, Pset, Pin, x = 0) => Pset * r.Aeff + closeExtra(r, x, Pin) + r.ks * x;
// 设定压力 → 先导压力
export const PpFor = (r, Pset, Pin, x = 0) => (Pset * r.Aeff + closeExtra(r, x, Pin)) / r.Ap;

function bisect(f, a, b, n = 48) {
  let fa = f(a);
  for (let i = 0; i < n; i++) {
    const m = (a + b) / 2, fm = f(m);
    if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

// 稳态解：返回开度、出口压力、流量和状态
//   state: 'reg' 正常调节 | 'lock' 下游关死（锁定压力）| 'sat' 阀已全开，失去调节 | 'closed' 设定太低
export function steady(r, Pin, K, set) {
  const P0 = poutForce(r, 0, Pin, set);
  if (P0 <= 0) return { x: 0, P: 0, Q: 0, state: 'closed', P0 };
  if (K <= 0) return { x: 0, P: Math.min(P0, Pin), Q: 0, state: 'lock', P0 };
  const f = (x) => netForce(r, x, Pin, K, set);
  if (f(r.xmax) > 0) {
    const P = poutHyd(r, r.xmax, Pin, K);
    return { x: r.xmax, P, Q: K * Math.sqrt(P), state: 'sat', P0 };
  }
  const x = bisect(f, 0, r.xmax);
  const P = poutHyd(r, x, Pin, K);
  return { x, P, Q: K * Math.sqrt(P), state: 'reg', P0 };
}

// 流量特性：同一设定下，从关死到全开扫下游开度，出口压力怎么跟着流量掉（下垂）
export function flowCurve(r, Pin, set, Kmax = 12, n = 90) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const K = Kmax * (i / n) ** 1.6;
    const s = steady(r, Pin, K, set);
    out.push({ K, Q: s.Q, P: s.P, state: s.state });
  }
  return out;
}
// 压力特性：同一设定、同一下游，入口压力变化时出口压力怎么变
export function pressureCurve(r, K, set, Pmin = 0.15, Pmax = 0.6, n = 60) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const Pin = Pmin + (Pmax - Pmin) * i / n;
    const s = steady(r, Pin, K, set);
    out.push({ Pin, P: s.P, Q: s.Q, state: s.state });
  }
  return out;
}

// ---------------- 背压阀（保持上游压力） ----------------
// 上游压力从膜片下方往上顶，克服加载力后把阀芯抬离阀座，多出来的液体放回槽里。
export function makeBpr(o = {}) {
  const b = { Dd: 50, Ds: 10, ks: 0, kd: 4, Fr0: 4, xmax: 2.5, ...o };
  b.Ad = area(b.Dd); b.As = area(b.Ds);
  return b;
}
export const BPR = makeBpr();
export function bprA(b, x) { const A = Math.min(Math.PI * b.Ds * Math.max(0, x), b.As) * 1e-6; return CD * A * Math.sqrt(2e6 / RHO) * LPM; }
// 上游压力 Pu 下的开度：Pu·(Ad−As) + Pu·As(阀芯底面) − 加载 = k·x；回流到常压槽
export function bprFlow(b, Pu, Pset) {
  const Fl = Pset * b.Ad + b.Fr0;            // 加载力按“刚开启时的上游压力 = Pset”标定
  const x = Math.min(b.xmax, Math.max(0, (Pu * b.Ad - Fl) / (b.kd + b.ks)));
  return { x, Q: bprA(b, x) * Math.sqrt(Math.max(0, Pu)) };
}

// 给定流进背压阀的流量，求它守住的上游压力
export function bprUpstream(Qin, Pset, b = BPR) {
  const Pc = (Pset * b.Ad + b.Fr0) / b.Ad;           // 开启压力
  if (Qin <= 0) return { Pu: Pc, x: 0, Q: 0, Pc, over: false };
  const g = (Pu) => bprFlow(b, Pu, Pset).Q - Qin;
  if (g(1.5) < 0) return { Pu: 1.5, x: b.xmax, Q: bprFlow(b, 1.5, Pset).Q, Pc, over: true };
  const Pu = bisect(g, Pc, 1.5, 50);
  const r = bprFlow(b, Pu, Pset);
  return { Pu, x: r.x, Q: r.Q, Pc, over: false };
}

// 循环回路：泵 → 主管 → n 台设备取液 → 回流（背压阀或固定节流阀）→ 槽
export const LOOP = { P0: 0.46, Qmax: 42, Kt: 8, Kr: 30, N: 8 };
export function loopSolve({ n, useBpr, Pset = 0.25, tools = LOOP.Kt, Kr = LOOP.Kr }) {
  const L = LOOP;
  const pump = (P) => L.Qmax * Math.sqrt(Math.max(0, 1 - P / L.P0));
  const ret = (P) => (useBpr ? bprFlow(BPR, P, Pset).Q : Kr * Math.sqrt(P));
  const g = (P) => pump(P) - n * tools * Math.sqrt(P) - ret(P);
  const P = bisect(g, 1e-6, L.P0 - 1e-6, 60);
  const r = useBpr ? bprFlow(BPR, P, Pset) : { x: null, Q: Kr * Math.sqrt(P) };
  return { P, Qpump: pump(P), Qtool: tools * Math.sqrt(P), Qtools: n * tools * Math.sqrt(P), Qret: r.Q, x: r.x };
}

// ---------------- 开环 / 闭环时域仿真 ----------------
// 一条供液线：厂务供液 → 调压阀 → 流量计 → 过滤器 → 喷嘴。
// 四种做法用同一套扰动跑 20 秒，比谁把喷嘴流量稳住。
export const LINE = {
  Kn: 1.5 / Math.sqrt(0.18),        // 喷嘴：0.18 MPa 时 1.5 L/min
  KfClean: 1.5 / Math.sqrt(0.02),    // 干净过滤器：1.5 L/min 时压降 0.02 MPa
  KfDirty: 1.5 / Math.sqrt(0.10),    // 堵了以后：同流量压降 0.10 MPa
  PinNom: 0.45, PinDip: 0.33,
  Q0: 1.2, Q1: 1.8,                  // 配方流量：先 1.2，2 秒时改成 1.8 L/min
  tauEP: 0.12,                        // 电气比例阀（E/P）把先导气压调到位的时间常数
  PpMax: 0.5,                         // 先导气源 0.5 MPa
  tauP: 0.02, tauQ: 0.25,             // 压力传感器、超声波流量计的响应时间常数
  noiseP: 0.0006, noiseQ: 0.006,      // 噪声：0.6 kPa、0.006 L/min
  tauMech: 0.008,                     // 膜片组件跟上力变化的时间常数（液体里很快）
  deadP: 0.01, deadQ: 0.10, deadEP: 0.03, // 纯滞后：传感器计算/通信、E/P 内部动作
};
export const STRATS = [
  { id: 'manual', name: '手动弹簧式', loop: '开环', reg: 'spring' },
  { id: 'open', name: '气控 + 固定指令', loop: '开环', reg: 'dome' },
  { id: 'pfb', name: '气控 + 压力反馈', loop: '闭环', reg: 'dome' },
  { id: 'qfb', name: '气控 + 流量反馈', loop: '闭环', reg: 'dome' },
];

// 电气比例阀的静态误差：指令和实际输出之间的非线性（量级参照常见规格 ±1% F.S.）
export const epErr = (c) => 0.004 * Math.sin(2 * Math.PI * c / LINE.PpMax);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; }; }
const smooth = (t, t0, t1) => (t <= t0 ? 0 : t >= t1 ? 1 : ((u) => u * u * (3 - 2 * u))((t - t0) / (t1 - t0)));

// 扰动时间表；ev 里三个开关决定开不开
export function scenario(t, ev) {
  const L = LINE;
  const Qsp = ev.recipe && t >= 2 ? L.Q1 : L.Q0;
  const dip = ev.dip ? smooth(t, 6, 6.4) - smooth(t, 10, 10.4) : 0;
  const Pin = L.PinNom + ((ev.dipTo ?? L.PinDip) - L.PinNom) * dip;
  const clog = ev.clog ? smooth(t, 12, 20) : 0;
  // 过滤器按压降线性插值（1/K² 正比于压降）
  const inv = 1 / (L.KfClean ** 2) + (1 / (L.KfDirty ** 2) - 1 / (L.KfClean ** 2)) * clog;
  const Kf = 1 / Math.sqrt(inv);
  return { Qsp, Pin, Kf, K: seriesK(L.Kn, Kf) };
}

// 名义标定：控制器以为的“流量 → 压力 → 先导压力”换算（在干净过滤器、名义供压下标出来）
const Knom = seriesK(LINE.Kn, LINE.KfClean);
export const PforQ = (Q) => (Q / Knom) ** 2;

export function simulate({ strat, ev, gain = 1, T = 20, dt = 0.002, noise = true, antiWindup = true }) {
  const L = LINE, r = strat.reg === 'spring' ? REG.spring : REG.dome;
  const rnd = rng(7 + STRATS.indexOf(strat) * 101);
  const s0 = scenario(0, ev);
  const Psp0 = PforQ(s0.Qsp);
  // 开机时按名义工况把设定调准：手动式拧旋钮看压力表，气控式写入标定表
  const st0 = (set) => steady(r, s0.Pin, s0.K, set);
  let set;
  if (strat.reg === 'spring') {
    // 在名义开度下标定，然后迭代修正到正好
    let F0 = F0For(r, Psp0, s0.Pin, 0.3);
    for (let i = 0; i < 30; i++) { const s = st0({ F0 }); F0 += (Psp0 - s.P) * r.Aeff; }
    set = { F0 };
  } else set = { Pp: PpFor(r, Psp0, s0.Pin, 0.3) };
  // 标定表：指令 = cmd0 + (P − P0)·Aeff/Ap，只在开机这一个点上标准
  // E/P 自己有非线性（这里取满量程 ±0.8%），所以离开标定点越远，开环误差越大
  let cmd0 = 0;
  if (strat.reg === 'dome') {
    for (let i = 0; i < 30; i++) { const s = st0(set); set.Pp += (Psp0 - s.P) * r.Aeff / r.Ap; }
    cmd0 = set.Pp; for (let i = 0; i < 20; i++) cmd0 = set.Pp - epErr(cmd0);
  }
  const ppFromP = (P) => cmd0 + (P - Psp0) * r.Aeff / r.Ap;
  let x = steady(r, s0.Pin, s0.K, set).x;
  let Pp = set.Pp ?? 0, Pmeas = PforQ(s0.Qsp), Qmeas = s0.Qsp, integ = 0, refP = Pmeas, refQ = Qmeas;
  let ctlTimer = 0;
  // 增益：压力环和流量环各自整定到“刚好不怎么超调”，gain 是整体倍数
  const KpP = 0.55 * gain, KiP = 5.0 * gain;
  const KpQ = 0.11 * gain, KiQ = 0.42 * gain;
  const N = Math.round(T / dt), every = Math.max(1, Math.round(0.02 / dt));
  const out = { t: [], P: [], Q: [], Qsp: [], Psp: [], Pp: [], Pin: [], x: [], sat: [] };
  let cmd = strat.reg === 'dome' ? cmd0 : 0, Pf = Pmeas, Qf = Qmeas, bi = 0;
  const nP = Math.max(1, Math.round(L.deadP / dt)), nQ = Math.max(1, Math.round(L.deadQ / dt)), nEP = Math.max(1, Math.round(L.deadEP / dt));
  const pBuf = new Float64Array(nP).fill(Pmeas), qBuf = new Float64Array(nQ).fill(Qmeas), cmdBuf = new Float64Array(nEP).fill(cmd);
  for (let i = 0; i <= N; i++) {
    const t = i * dt;
    const sc = scenario(t, ev);
    const Psp = PforQ(sc.Qsp);
    // ---- 控制器（10 ms 一拍）----
    ctlTimer -= dt;
    if (ctlTimer <= 0) {
      ctlTimer += 0.01;
      const ff = ppFromP(Psp);
      // 参考模型：设定值经过和“执行器 + 传感器”差不多快的一阶滤波再去比较，
      // 前馈负责立刻动作，反馈只修残差，配方一改就不会被比例项多踢一脚
      const tr = strat.id === 'pfb' ? L.tauP + L.deadP + L.tauEP + L.deadEP : L.tauQ + L.deadQ + L.tauEP + L.deadEP;
      refP += (Psp - refP) * (1 - Math.exp(-0.01 / tr));
      refQ += (sc.Qsp - refQ) * (1 - Math.exp(-0.01 / tr));
      if (strat.id === 'open') cmd = ff;
      else if (strat.id === 'pfb' || strat.id === 'qfb') {
        const e = strat.id === 'pfb' ? refP - Pmeas : refQ - Qmeas;
        const Kp = strat.id === 'pfb' ? KpP : KpQ, Ki = strat.id === 'pfb' ? KiP : KiQ;
        const raw = ff + Kp * e + integ + Ki * e * 0.01;
        const satHi = raw > L.PpMax, satLo = raw < 0;
        // 抗积分饱和：指令顶到头时，积分不再往同一个方向累
        if (!antiWindup || !((satHi && e > 0) || (satLo && e < 0))) integ += Ki * e * 0.01;
        cmd = Math.min(L.PpMax, Math.max(0, ff + Kp * e + integ));
      }
    }
    // ---- 执行器：E/P 把先导压力调到指令值（先有一小段纯滞后）----
    cmdBuf[bi % nEP] = cmd; const cmdD = cmdBuf[(bi + 1) % nEP];
    if (strat.reg === 'dome') { const tgt = cmdD + epErr(cmdD); Pp += (tgt - Pp) * (1 - Math.exp(-dt / L.tauEP)); set.Pp = Pp; }
    // ---- 调压阀本体：带摩擦的准静态力平衡 ----
    const f = (xx) => netForce(r, xx, sc.Pin, sc.K, set);
    const Ff = r.fric;
    const fx = f(x);
    let target = x;
    if (fx > Ff) target = f(r.xmax) - Ff > 0 ? r.xmax : bisect((xx) => f(xx) - Ff, x, r.xmax, 40);
    else if (fx < -Ff) target = f(0) + Ff < 0 ? 0 : bisect((xx) => f(xx) + Ff, 0, x, 40);
    x += (target - x) * (1 - Math.exp(-dt / L.tauMech));
    const P = poutHyd(r, x, sc.Pin, sc.K);
    const Q = sc.K * Math.sqrt(P);
    // ---- 传感器：一阶滞后 + 纯滞后 + 噪声 ----
    Pf += (P - Pf) * (1 - Math.exp(-dt / L.tauP));
    Qf += (Q - Qf) * (1 - Math.exp(-dt / L.tauQ));
    if (noise && i % every === 0) { Pf += rnd() * L.noiseP * 0.3; Qf += rnd() * L.noiseQ * 0.3; }
    pBuf[bi % nP] = Pf; qBuf[bi % nQ] = Qf;
    Pmeas = pBuf[(bi + 1) % nP]; Qmeas = qBuf[(bi + 1) % nQ];
    bi++;
    if (i % every === 0) {
      out.t.push(t); out.P.push(P); out.Q.push(Q); out.Qsp.push(sc.Qsp); out.Psp.push(Psp); out.Pp.push(Pp); out.Pin.push(sc.Pin); out.x.push(x);
      out.sat.push(x >= r.xmax * 0.999 || cmd >= L.PpMax * 0.999 ? 1 : 0);
    }
  }
  return out;
}

// 各阶段末尾的流量误差（%），给表格用
export function phaseErrors(sim) {
  const at = (tt) => { let k = 0; while (k < sim.t.length - 1 && sim.t[k] < tt) k++; return k; };
  const avg = (t0, t1) => { const a = at(t0), b = at(t1); let s = 0, n = 0; for (let k = a; k <= b; k++) { s += (sim.Q[k] - sim.Qsp[k]) / sim.Qsp[k]; n++; } return 100 * s / n; };
  return { recipe: avg(4.5, 5.9), dip: avg(8.5, 9.9), clog: avg(19, 20) };
}

// 闭环供液线的稳态：给定控制方式、配方流量、供压、过滤器堵塞程度（0–1），
// 求先导压力、出口压力、喷嘴流量。开环用开机时的标定，闭环用反馈把测量值拉到目标。
export function lineSteady({ mode, Qsp, Pin, clog }) {
  const L = LINE, r = REG.dome;
  const inv = 1 / (L.KfClean ** 2) + (1 / (L.KfDirty ** 2) - 1 / (L.KfClean ** 2)) * clog;
  const K = seriesK(L.Kn, 1 / Math.sqrt(inv));
  const Psp = PforQ(Qsp);
  const solveFor = (f, target, Kx, Pinx) => {   // 找先导压力，使 f(steady) = target
    const at = (Pp) => f(steady(r, Pinx, Kx, { Pp }));
    if (at(L.PpMax) < target) return { Pp: L.PpMax, sat: true };
    let a = 0, b = L.PpMax;
    for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (at(m) < target) a = m; else b = m; }
    return { Pp: (a + b) / 2, sat: false };
  };
  let Pp, sat = false;
  if (mode === 'open') ({ Pp } = solveFor((s) => s.P, Psp, seriesK(L.Kn, L.KfClean), L.PinNom));
  else if (mode === 'pfb') ({ Pp, sat } = solveFor((s) => s.P, Psp, K, Pin));
  else ({ Pp, sat } = solveFor((s) => s.Q, Qsp, K, Pin));
  const s = steady(r, Pin, K, { Pp });
  return { Pp, P: s.P, Q: s.Q, x: s.x, state: s.state, sat: sat || s.state === 'sat', Psp, K };
}
