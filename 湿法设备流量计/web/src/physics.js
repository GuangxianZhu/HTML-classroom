// 各种流量计的物理核心：纯函数，网页和 test_core.mjs 共用。
// 单位一律 SI（m、s、kg、Pa、K），界面上再换成 L/min、mL/min、ns 之类。
// 标了"示意"的参数是本页为了教学选的值，不对应任何一台真实仪表。

export const G = 9.81;
export const LPM = 1 / 60000;            // 1 L/min 换成 m³/s
const PI = Math.PI;

// ---------- 流体物性 ----------
// 纯水随温度变：黏度 Vogel 式，密度 Thiesen 式，声速 Marczak (1997) 多项式（0–95 °C）
export const muWater = (T) => 2.414e-5 * Math.pow(10, 247.8 / (T + 273.15 - 140));
export const rhoWater = (T) => 1000 * (1 - ((T + 288.9414) / (508929.2 * (T + 68.12963))) * (T - 3.9863) ** 2);
export const cWater = (T) => 1402.385 + 5.038813 * T - 5.799136e-2 * T ** 2 + 3.287156e-4 * T ** 3 - 1.398845e-6 * T ** 4 + 2.78786e-9 * T ** 5;

// 25 °C 的值。sigma 单位 µS/cm。est=true 表示是估算或文献范围的中间值
export const FLUIDS = {
  diw:   { name: '超纯水 DIW', short: 'DIW', rho: 997, mu: 0.89e-3, c: 1497, sigma: 0.055, cp: 4180 },
  dhf:   { name: '稀氢氟酸（约 0.5%）', short: 'DHF', rho: 1001, mu: 0.90e-3, c: 1500, sigma: 5000, cp: 4150, est: true },
  h2so4: { name: '浓硫酸 96%', short: 'H₂SO₄', rho: 1830, mu: 22e-3, c: 1450, sigma: 1e5, cp: 1420, est: true },
  ipa:   { name: 'IPA（异丙醇）', short: 'IPA', rho: 781, mu: 2.04e-3, c: 1140, sigma: 0.1, cp: 2600, est: true },
};

/** 取物性；纯水按温度算，其他药液固定在 25 °C。 */
export function fluid(key, T = 25) {
  const f = FLUIDS[key];
  if (key !== 'diw') return { ...f, T: 25 };
  return { ...f, T, rho: rhoWater(T), mu: muWater(T), c: cWater(T) };
}

// ---------- 管流：流速、雷诺数、速度分布 ----------
export function pipeFlow(Q, D, f) {
  const A = PI * D * D / 4;
  const v = Q / A;
  const Re = f.rho * v * D / f.mu;
  return { A, v, Re, regime: Re < 2300 ? 'laminar' : Re < 4000 ? 'transition' : 'turbulent' };
}

/** 幂律指数 n（湍流 u/umax=(1-r)^(1/n)），经验式，Re=1e5 时约 7。 */
export const powerN = (Re) => Math.max(5, Math.min(10, -1.7 + 1.8 * Math.log10(Math.max(Re, 4000))));

/** 归一化速度 u/umean，r 是 0..1 的相对半径。过渡区在层流和湍流之间线性混合。 */
export function profile(r, Re) {
  const lam = 2 * (1 - r * r);
  if (Re < 2300) return lam;
  const n = powerN(Re);
  const turb = Math.pow(Math.max(0, 1 - r), 1 / n) * ((n + 1) * (2 * n + 1)) / (2 * n * n);
  if (Re >= 4000) return turb;
  const w = (Re - 2300) / 1700;
  return lam * (1 - w) + turb * w;
}

/** 沿直径测得的平均流速 / 面平均流速。层流 4/3，湍流约 1.05–1.1。夹装式超声波要除以它。 */
export function lineFactor(Re) {
  let s = 0;
  const N = 400;
  for (let i = 0; i < N; i++) s += profile((i + 0.5) / N, Re);
  return s / N;
}

// ---------- 1. 超声波（时差法） ----------
/**
 * 管内式：声音沿测量管轴向走 L。
 * cMeter：仪表"以为"的声速（只在用 Δt·c²/2L 简化式时起作用）。
 * 两种算法：A = (L/2)(1/t↓ − 1/t↑)，声速自动约掉；B = Δt·c²/(2L)，要假设声速。
 */
export function usInline({ Q, L = 0.111, ri = 0.004, f, cMeter = 1497, bubbles = 0 }) {
  const A = PI * ri * ri;
  const v = Q / A;
  const c = f.c;
  const tDown = L / (c + v), tUp = L / (c - v);
  const dt = tUp - tDown;
  const vA = (L / 2) * (1 / tDown - 1 / tUp);
  const vB = dt * cMeter * cMeter / (2 * L);
  const amp = Math.exp(-6 * bubbles);         // 气泡散射，接收幅度下降（示意）
  const lost = amp < 0.12;
  return { v, c, tDown, tUp, dt, QA: vA * A, QB: vB * A, amp, lost };
}

/**
 * 夹装式：V 字声路，声波斜穿管子两次。仪表按 25 °C 水标定：声速、折射角、分布系数都按水定死。
 * cw：楔块声速；thw：楔块里的入射角。折射按斯涅尔定律。
 */
export function usClamp({ Q, D = 0.0096, f, cw = 2400, thw = 38 * PI / 180, bubbles = 0, autoC = false }) {
  const A = PI * D * D / 4;
  const v = Q / A;
  const Re = f.rho * v * D / f.mu;
  const s = f.c / cw * Math.sin(thw);
  const th = Math.asin(Math.min(0.999, s));
  const kl = lineFactor(Re);
  const vl = v * kl;
  const l = 2 * D / Math.cos(th);                         // 两次穿越的总声程
  const vb = vl * Math.sin(th);                            // 流速在声束方向的分量
  const tDown = l / (f.c + vb), tUp = l / (f.c - vb);
  const dt = tUp - tDown;
  // 仪表一侧：不实测声速时按 25 °C 水（1497 m/s）算折射角和声程；分布系数按水的黏度估
  const cm = autoC ? f.c : 1497;
  const thm = Math.asin(Math.min(0.999, cm / cw * Math.sin(thw)));
  const lm = 2 * D / Math.cos(thm);
  const vlm = dt * cm * cm / (2 * lm * Math.sin(thm));
  let vm = vlm / 1.1;
  for (let k = 0; k < 5; k++) vm = vlm / lineFactor(997 * Math.abs(vm) * D / 0.89e-3);
  const Qm = vm * A;
  const amp = Math.exp(-6 * bubbles);
  return { v, Re, th, kl, tDown, tUp, dt, Qm, amp, lost: amp < 0.12 };
}

// ---------- 2. 卡门涡街 ----------
/** 发生体宽 d、管径 D。f = St·v_gap/d，St≈0.2。返回涡街频率和它在探头上的压力脉动幅度。 */
export function vortex({ Q, D = 0.014, d = 0.004, f }) {
  const A = PI * D * D / 4;
  const v = Q / A;
  const vg = v * A / (A - d * D);
  const ReD = f.rho * v * D / f.mu;
  const Red = f.rho * vg * d / f.mu;
  const St = 0.2;
  const fv = Red > 50 ? St * vg / d : 0;
  const amp = 0.5 * 0.5 * f.rho * vg * vg;                // 升力系数取 0.5（示意），单位 Pa
  const regular = ReD > 3000 ? 1 : ReD > 1200 ? (ReD - 1200) / 1800 : 0;
  return { v, vg, ReD, Red, fv, amp, regular };
}

/** K 系数（Hz per m³/s），按 25 °C 水在中段标定。 */
export const vortexK = (D = 0.014, d = 0.004) => {
  const A = PI * D * D / 4;
  return 0.2 * (A / (A - d * D)) / d / A;
};

/**
 * 仿真一段探头信号，用带回差的过零检测数频率，模拟仪表读数。
 * vibAmp：管道振动折算到探头上的压力幅度（Pa），vibF：振动频率。th：检测门限（Pa）。
 */
export function vortexMeter({ Q, f, vibAmp = 0, vibF = 50, th = 6, T = 1.2, fs = 6000, seed = 1 }) {
  const r = vortex({ Q, f });
  let rnd = seed;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const N = Math.round(T * fs);
  let ph = 0, state = 0, count = 0, first = -1, last = -1;
  const sig = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / fs;
    const jitter = (1 - r.regular) * 0.9;
    ph += 2 * PI * r.fv / fs * (1 + jitter * (rand() - 0.5) * 2);
    const a = r.amp * (0.55 + 0.45 * r.regular) * (1 + jitter * (rand() - 0.5));
    const s = a * Math.sin(ph) + vibAmp * Math.sin(2 * PI * vibF * t) + (rand() - 0.5) * 1.2;
    sig[i] = s;
    if (state <= 0 && s > th) { state = 1; count++; if (first < 0) first = i; last = i; }
    else if (state >= 0 && s < -th) state = -1;
  }
  const fm = count > 2 ? (count - 1) / ((last - first) / fs) : 0;
  return { ...r, sig, fs, fm, Qm: fm / vortexK() };
}

// ---------- 3. 叶轮式 ----------
/**
 * 切向射流冲叶轮：叶尖线速度 ≈ η·(射流速度 − 起转门槛)。门槛来自轴承摩擦，磨损越大门槛越高。
 * 两块磁铁，每转 2 个脉冲。K 按"新轴承、水、2 L/min"标定，并假设读数和流量成正比。
 */
export function paddle({ Q, rj = 0.0035, rtip = 0.0178, wear = 0, gvf = 0, f }) {
  const vj = Q / (PI * rj * rj);
  const mu = f ? f.mu : 0.89e-3;
  const vth = 0.06 + 0.35 * wear + 0.02 * (mu / 0.89e-3 - 1);
  const eta = 0.62 * (1 - 0.9 * gvf);
  const ut = Math.max(0, eta * (vj - vth));
  const rps = ut / (2 * PI * rtip);
  const hz = 2 * rps;
  const Qc = 2 * LPM, vjc = Qc / (PI * rj * rj);
  const K = 2 * (0.62 * (vjc - 0.06)) / (2 * PI * rtip) / Qc;   // Hz per m³/s
  return { vj, vth, rps, rpm: rps * 60, hz, Qm: hz / K, stalled: ut === 0 };
}

// ---------- 4. 浮子式 ----------
/**
 * 锥形管 + 浮子。力平衡：浮子重量 − 浮力 = 绕流阻力，得
 *   Q = α·A_ann(h)·√(2gV(ρf−ρ)/(ρA_f))
 * α 随环隙雷诺数变（黏度大 α 小）。geo 来自 Blender 的 spec.json。
 */
export function floatMeter({ Q, f, geo, bubble = 0 }) {
  const { z0, z1, r0, r1, rf, zrest, zmax, vol, rho_f } = geo;
  const Af = PI * rf * rf;
  const rhoF = rho_f * (1 - bubble) + 1.2 * bubble;            // 挂了气泡：等效密度变小
  const R = (z) => r0 + (r1 - r0) * (z - z0) / (z1 - z0);
  const Aann = (z) => PI * (R(z) ** 2 - rf * rf);
  const net = (rhoF - f.rho);
  if (net <= 0) return { z: zmax, sunk: false, floats: true, net };
  const vc = Math.sqrt(2 * G * vol * net / (f.rho * Af));
  const Qof = (z) => {
    let a = 0.68;
    for (let k = 0; k < 4; k++) {
      const va = a * vc;
      const gap = 2 * (R(z) - rf);
      const Re = f.rho * va * gap / f.mu;
      a = 0.68 * (1 - Math.exp(-Re / 60));
    }
    return a * Aann(z) * vc;
  };
  const Qlo = Qof(zrest), Qhi = Qof(zmax);
  let z;
  if (Q <= Qlo) z = zrest;
  else if (Q >= Qhi) z = zmax;
  else {
    let lo = zrest, hi = zmax;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (Qof(m) < Q) lo = m; else hi = m; }
    z = (lo + hi) / 2;
  }
  return { z, Qlo, Qhi, vc, net, pegged: Q >= Qhi };
}

/** 刻度：按 20 °C 水把浮子高度换成流量（仪表出厂刻度）。 */
export function floatScale(geo) {
  const w = fluid('diw', 20);
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const Q = i / 60 * 4 * LPM;
    pts.push([floatMeter({ Q, f: w, geo }).z, Q]);
  }
  return (z) => {
    if (z <= pts[0][0] + 1e-6) return 0;
    for (let i = 1; i < pts.length; i++) {
      const [za, qa] = pts[i - 1], [zb, qb] = pts[i];
      if (z <= zb) return zb > za ? qa + (qb - qa) * (z - za) / (zb - za) : qb;
    }
    return pts[pts.length - 1][1];
  };
}

// ---------- 5. 差压式 ----------
/**
 * 孔板：Δp = (ρ/2)(1−β⁴)(v₀/C)² + 32μL₀v₀/d²（第二项是孔里的黏性损失，药液黏的时候不能忽略）。
 * 仪表按"水、只用平方根式"换算；两个压力传感器各有噪声和零点漂移。
 */
export function dpMeter({ Q, f, D = 0.010, d = 0.0026, Lo = 0.003, drift = 0, setRho = false }) {
  const beta = d / D;
  const Ao = PI * d * d / 4;
  const vo = Q / Ao;
  const C = 0.607;
  const dpQ = 0.5 * f.rho * (1 - beta ** 4) * (vo / C) ** 2;
  const dpV = 32 * f.mu * Lo * vo / (d * d);
  const dp = dpQ + dpV;
  const meas = dp + drift;
  const rhoM = setRho ? f.rho : 997;
  const Qm = meas > 0 ? C * Ao * Math.sqrt(2 * meas / (rhoM * (1 - beta ** 4))) : 0;
  return { vo, dp, dpQ, dpV, Qm, beta };
}

/** 压力传感器噪声（每只 σ，Pa）折算到流量上的相对误差：dQ/Q = ½·dΔp/Δp。 */
export const dpRelErr = (dp, sigma = 60) => 0.5 * (Math.SQRT2 * sigma) / Math.max(dp, 1e-9);

// ---------- 6. 热式（MFC 传感毛细管） ----------
/**
 * 一维稳态对流扩散：−T'' + Pe·T' + h·T = q(s)，s∈[0,1]，两端 T=0。
 * q 是两组绕组的发热，Pe 正比于"质量流量 × 比热"。返回温度分布和两组绕组的平均温度。
 */
export const COILS = [[0.3365, 0.4769], [0.5231, 0.6635]];   // 和 Blender 模型里两组绕组的位置一致
export function capillaryT(Pe, { N = 160, h = 8, coils = COILS } = {}) {
  const dx = 1 / (N + 1);
  const a = new Float64Array(N), b = new Float64Array(N), c = new Float64Array(N), d = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const s = (i + 1) * dx;
    // 迎风格式处理对流项，大 Pe 时也稳定
    a[i] = -1 / dx ** 2 - Pe / dx;
    b[i] = 2 / dx ** 2 + Pe / dx + h;
    c[i] = -1 / dx ** 2;
    d[i] = coils.some(([u, w]) => s >= u && s <= w) ? 1 : 0;
  }
  for (let i = 1; i < N; i++) { const m = a[i] / b[i - 1]; b[i] -= m * c[i - 1]; d[i] -= m * d[i - 1]; }
  const T = new Float64Array(N);
  T[N - 1] = d[N - 1] / b[N - 1];
  for (let i = N - 2; i >= 0; i--) T[i] = (d[i] - c[i] * T[i + 1]) / b[i];
  const avg = ([u, w]) => { let s = 0, n = 0; for (let i = 0; i < N; i++) { const x = (i + 1) * dx; if (x >= u && x <= w) { s += T[i]; n++; } } return s / n; };
  const Tu = avg(coils[0]), Td = avg(coils[1]);
  return { T, dx, Tu, Td, dT: Td - Tu };
}

// 摩尔定压热容 J/(mol·K)（25 °C 理想气体）。同样的 sccm 就是同样的摩尔流量，所以带走的热正比于它。
export const GASES = {
  N2: { name: '氮气 N₂', cpm: 29.12 }, Ar: { name: '氩气 Ar', cpm: 20.79 }, He: { name: '氦气 He', cpm: 20.79 },
  O2: { name: '氧气 O₂', cpm: 29.38 }, CO2: { name: '二氧化碳 CO₂', cpm: 37.13 },
};

/**
 * MFC：满量程 FS（m³/s 标准状态），旁路比 n（主流 : 传感流）。
 * 满量程时 N₂ 的 Pe 取 PeFS，落在 ΔT–Pe 曲线的直线段。仪表按 N₂ 标定，用查表把 ΔT 反算成流量。
 */
export const MFC = { PeFS: 1.2 };
let _cal = null;
function mfcCal() {
  if (_cal) return _cal;
  const xs = [], ys = [];
  for (let i = 0; i <= 80; i++) { const Pe = i / 80 * MFC.PeFS * 1.6; xs.push(Pe); ys.push(capillaryT(Pe).dT); }
  return (_cal = { xs, ys });
}
export function mfc({ frac, gas = 'N2' }) {
  const g = GASES[gas];
  const Pe = frac * MFC.PeFS * g.cpm / GASES.N2.cpm;
  const r = capillaryT(Pe);
  const { xs, ys } = mfcCal();
  let PeR = xs[xs.length - 1];
  for (let i = 1; i < xs.length; i++) {
    if (ys[i] >= r.dT && ys[i - 1] <= r.dT) { PeR = xs[i - 1] + (xs[i] - xs[i - 1]) * (r.dT - ys[i - 1]) / ((ys[i] - ys[i - 1]) || 1); break; }
    if (ys[i] < ys[i - 1]) { PeR = xs[i - 1]; break; }
  }
  return { ...r, Pe, read: PeR / MFC.PeFS, cf: GASES.N2.cpm / g.cpm };
}

// ---------- 7. 科里奥利 ----------
/**
 * PFA 双 U 管（示意参数）：每根管内容积 V，管自身等效质量 mt。
 * 频率 f = f_air·√((mt+ρ_air V)/(mt+ρV))；时间差 Δt = ṁ/K。仪表用两点（空气、水）标定密度。
 */
export const COR = { V: 2.6e-6, mt: 6.0e-3, fAir: 168, dtFS: 3e-6, mFS: 1500 / 60000 };   // mFS: 1500 g/min → kg/s
export function coriolis({ mdot, rho, gvf = 0, vib = 0, seed = 1 }) {
  const rhoMix = rho * (1 - gvf) + 1.2 * gvf;
  const fr = (r) => COR.fAir * Math.sqrt((COR.mt + 1.2 * COR.V) / (COR.mt + r * COR.V));
  const freq = fr(rhoMix);
  const fa = fr(1.2), fw = fr(997);
  const K1 = (997 - 1.2) / (1 / fw ** 2 - 1 / fa ** 2);
  const rhoM = 1.2 + K1 * (1 / freq ** 2 - 1 / fa ** 2);
  const dt = mdot / COR.mFS * COR.dtFS;
  let rnd = seed;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647) - 0.5;
  const zero = 2 / 60000;                        // 零点稳定性约 2 g/min
  const noise = zero * (1 + 60 * gvf + 8 * vib) * rand() * 2;
  const bias = -mdot * 3 * gvf;                  // 两相流：气泡和液体"脱耦"，读数偏低（示意）
  return { freq, rhoMix, rhoM, dt, phase: 2 * PI * freq * dt, mread: mdot + bias + noise, damp: 1 + 40 * gvf };
}

// ---------- 8. 电磁 ----------
/**
 * 法拉第定律 E = B·v·D。电极接触液体的普通型：液体电导率越低，电极源阻抗越高，噪声越大。
 * 电容式（非接触）型对电导率的要求低得多。噪声系数都是示意值。
 */
export function magMeter({ Q, sigma, D = 0.025, B = 0.005, capacitive = false, bubble = false }) {
  const A = PI * D * D / 4;
  const v = Q / A;
  const E = B * v * D;
  const s0 = capacitive ? 0.01 : 5;               // 产品资料里各自的最低电导率（µS/cm）
  const noise = 0.4e-6 * Math.pow(s0 / Math.max(sigma, 1e-6), 0.75) + 0.05e-6;
  return { v, E, noise, ok: sigma >= s0, spikes: bubble };
}
