// 物理核心：八种调压阀的力平衡 + 气路容积 + 控制器。
// 单位：压力 kPa（g = 表压，abs = 绝压），力 N，面积 m²，位移 m，流量 NL/min，容积 L，时间 s。
// 这些数字是教学用的"合理量级"，不对应任何具体产品。

export const PA = 101.325;               // 大气压 kPa
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 可压缩气体过孔流量（ISO 6358 的简化式）：C 是声速流导，单位 NL/min 每 kPa(abs) 上游压力
export function gasQ(C, pu, pd) {
  if (C <= 0) return 0;
  if (pu < pd) return -gasQ(C, pd, pu);
  const r = pd / pu, b = 0.5;
  const phi = r <= b ? 1 : Math.sqrt(Math.max(0, 1 - ((r - b) / (1 - b)) ** 2));
  return C * pu * phi;
}
// 液体过阀：Kv（m³/h @ 1 bar）→ L/min
export const liqQ = (Kv, dp) => (dp <= 0 ? -liqQ(Kv, -dp) : Kv * 16.667 * Math.sqrt(dp / 100));

// ---------- 自力式阀站（膜片 + 阀芯）----------
// 下推为开。F 是"阀芯刚好碰上阀座时"加在膜片上的设定力（弹簧 / 圆顶气 / 电磁铁）。
// 返回 X：>0 是阀芯开度（m），<0 是膜片离开阀杆抬起（溢流口开度）。Fc 是阀芯处的净开启力。
export function stageTarget(p, P1g, P2g, F) {
  const kt = p.ks + p.kp + p.kd;
  const Fc = F - P2g * 1e3 * p.Ad - (P1g - P2g) * 1e3 * p.As - p.Fp0;
  if (Fc >= 0) return { X: Math.min(Fc / kt, p.hmax), Fc };
  const Fd = F - P2g * 1e3 * p.Ad + (p.Fcrack ?? 0);          // 膜片单独的受力（阀芯已坐死）
  if (Fd >= 0) return { X: 0, Fc };
  return { X: Math.max(Fd / (p.ks + p.kd), -(p.emax ?? 3e-4)), Fc };
}
// 软密封：净关闭力不足 Fseal 时还漏一点，这就是"锁定压力比设定高一点"的来历
function leakLift(p, Fc) {
  if (Fc >= 0) return 0;
  return (p.hleak ?? 0) * Math.max(0, 1 + Fc / (p.Fseal ?? 1));
}
export function stageFlows(p, X, Fc, P1abs, P2abs, extraLeak = 0) {
  const h = Math.max(0, X) + leakLift(p, Fc) + extraLeak;
  const qin = gasQ(p.C * clamp(h / p.hmax, 0, 1), P1abs, P2abs);
  const e = Math.max(0, -X);
  const qv = p.Cv ? gasQ(p.Cv * clamp(e / (p.emax ?? 3e-4), 0, 1), P2abs, PA) : 0;
  return { qin, qv, h, e };
}

// 阀站参数（基准：Ø36 膜片、Ø3.2 阀口）
export const ST_A = { Ad: 1.018e-3, As: 8.04e-6, ks: 2.5e4, kp: 1.5e3, kd: 8e3, Fp0: 3, hmax: 4e-4, C: 0.30, hleak: 1.5e-5, Fseal: 3, Fcrack: 0, emax: 3e-4 };

// 稳态求解：给定上游压力、设定力、下游流导，找出口压力（二分）
export function steadyStage(p, P1g, F, Cload, opt = {}) {
  const P1 = P1g + PA;
  let lo = 0, hi = P1g;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    const t = stageTarget(p, P1g, m, opt.F2 ? opt.F2(m) : F);
    const f = stageFlows(p, t.X, t.Fc, P1, m + PA);
    const net = f.qin - f.qv - gasQ(Cload, m + PA, PA) - (opt.qOut ?? 0);
    if (net > 0) lo = m; else hi = m;
  }
  const P2g = (lo + hi) / 2;
  const t = stageTarget(p, P1g, P2g, F);
  const f = stageFlows(p, t.X, t.Fc, P1, P2g + PA);
  return { P2g, X: t.X, Fc: t.Fc, Q: f.qin, h: f.h };
}
// 设定力：让"零流量时出口 = 目标"所需的力
export const forceFor = (p, P1g, P2set) => P2set * 1e3 * p.Ad + (P1g - P2set) * 1e3 * p.As + p.Fp0;

// ---------- 一个通用的"容积 + 阀站"动态模型 ----------
function makeStageSim(p, init) {
  const s = { X: 0, P2g: init.P2g ?? 0, ...init };
  return s;
}
function stepStage(p, s, dt, P1g, F, qOutFn, V, tau = 2e-3, extraLeak = 0) {
  const P1 = P1g + PA;
  const t = stageTarget(p, P1g, s.P2g, F);
  s.X += (t.X - s.X) * Math.min(1, dt / tau);
  s.Fc = t.Fc;
  const f = stageFlows(p, s.X, t.Fc, P1, s.P2g + PA, extraLeak);
  const qo = qOutFn(s.P2g + PA);
  s.P2g += PA * (f.qin - f.qv - qo) / (60 * V) * dt;
  s.P2g = Math.max(0, s.P2g);
  s.qin = f.qin; s.qv = f.qv; s.qo = qo; s.h = f.h; s.e = f.e;
  return s;
}
const SUB = 1e-4;   // 积分步长

// 可视化：把物理开度换成模型里的厘米位移（放大很多倍，模型里才看得见）
const visH = (X, hmax, vmax = 0.3) => (X > 0 ? X / hmax * vmax : 0);
const visE = (X, emax, vmax = 0.14) => (X < 0 ? -X / emax * vmax : 0);

// ======================= A 直动弹簧式 =======================
export function simSpring() {
  const p = { ...ST_A };
  const s = makeStageSim(p, { P2g: 300 });
  const u = { P1g: 1000, set: 300, demand: 120, leak: false, relieving: false };
  let F = forceFor(p, 1000, 300);
  const V = 0.15;
  return {
    p, s, u,
    recalcSet() { F = forceFor(p, 1000, u.set); },
    step(dt) {
      for (let k = 0; k < Math.round(dt / SUB); k++) {
        stepStage(p, s, SUB, u.P1g, F, (P2) => demandQ(u.demand, P2, 300), V, 2e-3, u.leak ? 6e-6 : 0);
      }
    },
    vis() {
      return { ch: { h: visH(s.X, p.hmax), d: s.X > 0 ? -visH(s.X, p.hmax) : visE(s.X, p.emax), adj: (F / p.ks) * 1e3 * 0.03 },
        zones: { hi: u.P1g + PA, lo: s.P2g + PA }, flows: { main: s.qin } };
    },
    read() { return { P1: u.P1g, P2: s.P2g, Q: s.qo, lift: Math.max(0, s.X) * 1e3, F, comp: F / p.ks * 1e3 }; },
  };
}
// 下游"用气量"：用流导表示，标定成在 300 kPa 时的流量
export function demandQ(q300, P2abs, ref = 300) {
  const C = q300 / gasQ(1, ref + PA, PA);
  return gasQ(C, P2abs, PA);
}
export const demandC = (q300, ref = 300) => q300 / gasQ(1, ref + PA, PA);

// ======================= B 两级 =======================
export const ST_B1 = { Ad: 5.0e-4, As: 3.0e-6, ks: 6e4, kp: 2e3, kd: 1e4, Fp0: 4, hmax: 2.5e-4, C: 0.06, hleak: 0, Fseal: 3 };
export function simTwoStage() {
  const p1 = { ...ST_B1 }, p2 = { ...ST_A };
  const u = { cyl: 15000, set: 300, demand: 80, mid: 1000 };
  const F1 = forceFor(p1, 15000, u.mid);
  let F2 = forceFor(p2, 1000, u.set);
  const s1 = makeStageSim(p1, { P2g: 1000 }), s2 = makeStageSim(p2, { P2g: 300 });
  return {
    s1, s2, u,
    recalcSet() { F2 = forceFor(p2, 1000, u.set); },
    step(dt) {
      for (let k = 0; k < Math.round(dt / SUB); k++) {
        // 中间腔：一级出、二级进
        const P1 = u.cyl + PA;
        const t1 = stageTarget(p1, u.cyl, s1.P2g, F1);
        s1.X += (t1.X - s1.X) * Math.min(1, SUB / 2e-3);
        const f1 = stageFlows(p1, s1.X, t1.Fc, P1, s1.P2g + PA);
        const t2 = stageTarget(p2, s1.P2g, s2.P2g, F2);
        s2.X += (t2.X - s2.X) * Math.min(1, SUB / 2e-3);
        const f2 = stageFlows(p2, s2.X, t2.Fc, s1.P2g + PA, s2.P2g + PA);
        const qo = demandQ(u.demand, s2.P2g + PA);
        s1.P2g = Math.max(0, s1.P2g + PA * (f1.qin - f2.qin) / (60 * 0.02) * SUB);
        s2.P2g = Math.max(0, s2.P2g + PA * (f2.qin - qo) / (60 * 0.15) * SUB);
        s1.q = f1.qin; s2.q = f2.qin; s2.qo = qo;
      }
    },
    vis() {
      return { ch: { h1: visH(s1.X, p1.hmax, 0.25), d1: -visH(s1.X, p1.hmax, 0.25), h2: visH(s2.X, p2.hmax), d2: -visH(s2.X, p2.hmax),
        adj: (F2 / p2.ks) * 1e3 * 0.03, g1: u.cyl / 1000, g2: s2.P2g / 1000 },
        zones: { hi: u.cyl + PA, mid: s1.P2g + PA, lo: s2.P2g + PA }, flows: { main: s2.q } };
    },
    read() { return { P1: u.cyl, Pm: s1.P2g, P2: s2.P2g, Q: s2.qo }; },
  };
}
// 两级稳态：嵌套二分
export function steadyTwo(p1, F1, p2, F2, cylG, Cload) {
  // 给定中间压力 Pm，二级稳态出口 → 二级流量；一级在 (cyl, Pm) 下的流量要等于它
  let lo = 0, hi = cylG;
  let r2 = null;
  for (let i = 0; i < 50; i++) {
    const Pm = (lo + hi) / 2;
    r2 = steadyStage(p2, Pm, F2, Cload);
    const t1 = stageTarget(p1, cylG, Pm, F1);
    const q1 = stageFlows(p1, t1.X, t1.Fc, cylG + PA, Pm + PA).qin;
    if (q1 > r2.Q) lo = Pm; else hi = Pm;
  }
  return { Pm: (lo + hi) / 2, P2g: r2.P2g, Q: r2.Q };
}

// ======================= C 圆顶加载 =======================
export const ST_C = { ...ST_A, ks: 2e3, Fbias: 6 };
export function simDome() {
  const p = { ...ST_C };
  const u = { P1g: 1000, dome: 300, demand: 120 };
  const s = makeStageSim(p, { P2g: 300 });
  const F = () => u.dome * 1e3 * p.Ad + p.Fbias;
  return {
    s, u, p,
    step(dt) { for (let k = 0; k < Math.round(dt / SUB); k++) stepStage(p, s, SUB, u.P1g, F(), (P2) => demandQ(u.demand, P2), 0.15); },
    vis() { return { ch: { h: visH(s.X, p.hmax), d: -visH(s.X, p.hmax) }, zones: { hi: u.P1g + PA, lo: s.P2g + PA, dome: u.dome + PA }, flows: { main: s.qin, dome: 0 } }; },
    read() { return { P1: u.P1g, P2: s.P2g, Pd: u.dome, Q: s.qo, lift: Math.max(0, s.X) * 1e3 }; },
  };
}

// ======================= D 氟树脂气控液体调压阀 =======================
// 液体不可压缩：每一帧直接解力平衡 + 流量平衡
export const ST_D = { Ad: 1.96e-3, As: 3.85e-5, kp: 4e3, kd: 4e4, Fp0: 6, hmax: 8e-4, Kv: 1.2 };
export function steadyPTFE(p, P1g, Pair, KvL) {
  let lo = 0, hi = P1g, h = 0;
  for (let i = 0; i < 60; i++) {
    const P2 = (lo + hi) / 2;
    const Fc = Pair * 1e3 * p.Ad - P2 * 1e3 * p.Ad - (P1g - P2) * 1e3 * p.As - p.Fp0;
    h = clamp(Fc / (p.kp + p.kd), 0, p.hmax);
    const qv = liqQ(p.Kv * h / p.hmax, P1g - P2);
    const ql = liqQ(KvL, P2);
    if (qv > ql) lo = P2; else hi = P2;
  }
  const P2 = (lo + hi) / 2;
  return { P2, h, Q: liqQ(KvL, P2) };
}
export function simPTFE() {
  const p = { ...ST_D };
  const u = { P1g: 400, air: 200, KvL: 0.25 };
  const s = { P2: 0, h: 0, Q: 0, hv: 0 };
  return {
    s, u, p,
    step(dt) {
      const r = steadyPTFE(p, u.P1g, u.air, u.KvL);
      const a = Math.min(1, dt / 0.04);
      s.P2 += (r.P2 - s.P2) * a; s.h += (r.h - s.h) * a; s.Q += (r.Q - s.Q) * a;
    },
    vis() { return { ch: { h: s.h / p.hmax * 0.28, d: -s.h / p.hmax * 0.28 }, zones: { lin: u.P1g + PA, lout: s.P2 + PA, air: u.air + PA }, flows: { main: s.Q * 4, air: 0 } }; },
    read() { return { P1: u.P1g, P2: s.P2, Pa: u.air, Q: s.Q, lift: s.h * 1e3 }; },
  };
}

// ======================= E 背压阀 =======================
export function simBPR() {
  const u = { dome: 250, src: 150 };
  const p = { A: 3.5e-4, k: 6e3, F0: 1.0, emax: 3e-4, C: 0.35 };
  const s = { P1g: 250, e: 0, q: 0 };
  return {
    s, u,
    step(dt) {
      for (let k = 0; k < Math.round(dt / SUB); k++) {
        const et = clamp(((s.P1g - u.dome) * 1e3 * p.A - p.F0) / p.k, 0, p.emax);
        s.e += (et - s.e) * Math.min(1, SUB / 2e-3);
        s.q = gasQ(p.C * s.e / p.emax, s.P1g + PA, PA * 1.02);
        s.P1g = Math.max(0, s.P1g + PA * (u.src - s.q) / (60 * 0.3) * SUB);
      }
    },
    vis() { return { ch: { d: s.e / p.emax * 0.12 }, zones: { up: s.P1g + PA, dn: PA * 1.02, dome: u.dome + PA }, flows: { main: s.q } }; },
    read() { return { P1: s.P1g, Pd: u.dome, Q: s.q, lift: s.e * 1e3 }; },
  };
}

// ======================= F 开环电气比例阀 =======================
// 比例电磁铁的力 ≈ 电流 × 常数（行程内近似不变），代替弹簧。带溢流。没有压力传感器。
export const ST_F = { Ad: 3.14e-4, As: 3.14e-6, ks: 0, kp: 1.5e3, kd: 4e3, Fp0: 2, hmax: 4e-4, C: 0.30, Cv: 0.10, emax: 3e-4, hleak: 0, Fseal: 1, Fcrack: 1.0 };
export function makeOpenEP(FS = 500) {
  const p = { ...ST_F };
  // 出厂标定：上游 700 kPa、零流量时，信号 0–100% 对应 0–FS
  const s = { X: 0, P2g: 0, Fm: 0, hyst: 2.0, temp: 0 };
  return {
    p, s, kind: 'open',
    step(dt, env) {
      // 磁滞 + 摩擦：力只有在偏离超过 hyst 时才跟着变（齿隙模型）
      const nom = env.sig / 100 * FS;
      const want = (nom * 1e3 * p.Ad + (700 - nom) * 1e3 * p.As + p.Fp0) * (env.sig > 0 ? 1 : 0) * (1 - 0.002 * s.temp);
      if (want - s.Fm > s.hyst) s.Fm = want - s.hyst; else if (s.Fm - want > s.hyst) s.Fm = want + s.hyst;
      const F = env.power ? Math.max(0, s.Fm) : 0;
      for (let k = 0; k < Math.round(dt / SUB); k++) stepStage(p, s, SUB, env.P1g, F, env.qOut, env.V, 1.5e-3);
    },
    vis() { return { ch: { h: visH(s.X, p.hmax), d: s.X > 0 ? -visH(s.X, p.hmax) : visE(s.X, p.emax) } }; },
  };
}

// ======================= G 闭环电气比例阀（ITV 型原理） =======================
// 主级：双膜片 + 溢流，P2 跟着先导腔压力 Pp 走；先导腔由供气 / 排气两只开关电磁阀按 PWM 充放。
// 控制器：每个周期比较"传感器读数"和设定，偏差超出保持带才开阀，开阀时间与偏差成正比。
export const ST_G = { Ad: 8.0e-4, As: 8.04e-6, ks: 0, kp: 1.5e3, kd: 6e3, Fp0: 2, hmax: 4e-4, C: 0.30, Cv: 0.22, emax: 3e-4, hleak: 0, Fseal: 1, Fcrack: 0.5 };
export function makeClosedEP(FS = 500) {
  const p = { ...ST_G };
  const c = { T: 0.02, band: 0.005 * FS, wide: 0.05 * FS, kp: 0.004, tmin: 0.0004, Vp: 0.003, Cs: 0.008, Ce: 0.008 };
  const s = { X: 0, P2g: 0, Pp: 0, t: 0, ton1: 0, ton2: 0, on1: false, on2: false, clicks: 0, both: false, sensorOffset: 0, sensor: 0 };
  return {
    p, s, c, kind: 'closed',
    step(dt, env) {
      const n = Math.round(dt / SUB);
      for (let k = 0; k < n; k++) {
        // 控制周期开始：决定这一周期两只阀各开多久
        if (s.t <= 0) {
          s.t = c.T;
          s.sensor = env.sensorStuck != null ? env.sensorStuck : s.P2g + s.sensorOffset;
          const e = env.setP - s.sensor;
          s.ton1 = 0; s.ton2 = 0; s.both = false;
          if (env.power) {
            if (e > c.band) s.ton1 = clamp(c.kp * e * c.T, c.tmin, c.T);
            else if (e < -c.band) { s.ton2 = clamp(c.kp * -e * c.T, c.tmin, c.T); s.both = -e > c.wide; }
          }
        }
        const el = c.T - s.t;
        const on1 = el < s.ton1, on2 = el < s.ton2;
        if (on1 && !s.on1) s.clicks++;
        if (on2 && !s.on2) s.clicks++;
        s.on1 = on1; s.on2 = on2;
        if (on1) s.acc1 = (s.acc1 || 0) + SUB;
        if (on2) s.acc2 = (s.acc2 || 0) + SUB;
        s.t -= SUB;
        const qs = on1 ? gasQ(c.Cs, env.P1g + PA, s.Pp + PA) : 0;
        const qe = on2 ? gasQ(c.Ce * (s.both ? 2 : 1), s.Pp + PA, PA) : 0;
        s.Pp = Math.max(0, s.Pp + PA * (qs - qe) / (60 * c.Vp) * SUB);
        s.qs = qs; s.qe = qe;
        // 主级：先导压力代替弹簧
        stepStage(p, s, SUB, env.P1g, s.Pp * 1e3 * p.Ad + 0.0, env.qOut, env.V, 1.5e-3);
      }
    },
    vis() { return { ch: { h: visH(s.X, p.hmax), d: s.X > 0 ? -visH(s.X, p.hmax) : visE(s.X, p.emax), s1: s.on1 ? 0.13 : 0, s2: s.on2 ? 0.13 : 0 } }; },
  };
}

// ======================= H 数字式压电阀 + 传感器 + PID =======================
// 一只压电阀只管"进气"，没有排气口：出口要降压，只能靠下游用掉。
export function makePiezo(FS = 500) {
  const c = { Cmax: 0.30, tau: 0.003, kp: 0.004, ki: 0.08, limit: true, slow: 0.1, Ts: 0.001, no: true };
  const s = { P2g: 0, u: 0, cmd: 0, I: 0, t: 0, sensor: 0, sensorOffset: 0, q: 0 };
  return {
    s, c, kind: 'piezo',
    step(dt, env) {
      const n = Math.round(dt / SUB);
      for (let k = 0; k < n; k++) {
        s.t -= SUB;
        if (s.t <= 0) {
          s.t = c.Ts;
          s.sensor = env.sensorStuck != null ? env.sensorStuck : s.P2g + s.sensorOffset;
          const e = env.setP - s.sensor;
          const raw = c.kp * e + s.I;
          if (c.limit) {
            // 防冲过头（简化版）：偏差大的过渡阶段把积分放慢到 1/10；输出顶到 0 或 100% 时停止积分（抗饱和）
            const transient = Math.abs(e) > 0.04 * FS;
            const sat = (raw > 1 && e > 0) || (raw < 0 && e < 0);
            if (!sat) s.I = clamp(s.I + c.ki * (transient ? c.slow : 1) * e * c.Ts, 0, 1);
          } else {
            s.I = clamp(s.I + c.ki * e * c.Ts, -1, 3);       // 朴素 PI：积分一直累加
          }
          if (!env.power) s.I = 0;
          s.cmd = env.power ? clamp(c.kp * e + s.I, 0, 1) : (c.no ? 1 : 0);
        }
        // 模型里的压电阀是"加电压伸长 → 压住膜片 → 关"的常开型：断电时阀全开。常闭型断电即关，选型时要看清。
        s.u += (s.cmd - s.u) * Math.min(1, SUB / c.tau);
        s.q = gasQ(c.Cmax * s.u, env.P1g + PA, s.P2g + PA);
        const qo = env.qOut(s.P2g + PA);
        s.P2g = Math.max(0, s.P2g + PA * (s.q - qo) / (60 * env.V) * SUB);
      }
    },
    vis() { return { ch: { d: -(1 - s.u) * 0.12 } }; },
  };
}

// ======================= 场景：同一组扰动加在三种"自动"调压阀上 =======================
export const SCEN = {
  base: { setP: 200, P1g: 700, q: 60, sensorOffset: 0, power: true, deadEnd: false, temp: 0, stuck: null },
};
export function makeArena(FS = 500) {
  const units = [makeOpenEP(FS), makeClosedEP(FS), makePiezo(FS)];
  const env = { ...SCEN.base, V: 0.08 };
  const st = { t: 0, hist: [], lim: 12 };
  for (const u of units) { u.s.P2g = 0; }
  function qOutFor(P2abs) {
    if (env.deadEnd) return 0;
    return demandQ(env.q, P2abs, 200);
  }
  return {
    units, env, st,
    step(dt) {
      const sig = env.setP / FS * 100;
      for (const u of units) {
        const e = { ...env, sig, qOut: qOutFor, sensorStuck: env.stuck };
        if (u.kind === 'open') { u.s.temp = env.temp; }
        else { u.s.sensorOffset = env.sensorOffset; }
        u.step(dt, e);
      }
      st.t += dt;
      const cl = units[1].s;
      st.hist.push([st.t, env.setP, ...units.map((u) => u.s.P2g), (cl.acc1 || 0) / dt, (cl.acc2 || 0) / dt]);
      cl.acc1 = 0; cl.acc2 = 0;
      while (st.hist.length && st.hist[0][0] < st.t - st.lim) st.hist.shift();
    },
  };
}

// 闭环 / 开环各自的"一次性稳态误差"表（给文字结论用）
export function openLoopSteady(FS, setP, P1g, q) {
  const p = { ...ST_F };
  const F = (setP * 1e3 * p.Ad + p.Fp0);
  return steadyStage(p, P1g, F, demandC(q, 200));
}
