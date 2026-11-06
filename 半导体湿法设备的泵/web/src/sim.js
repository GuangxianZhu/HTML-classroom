// 本页所有数字模型：纯函数，网页和 test_sim.mjs 共用。
// 数值都是“教学泵”的量级，不对应任何型号；每个模型的假设写在函数上面，失效条件写在页面里。

export const G = 9.81;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ================================================================ 离心泵（磁力泵）
// 扬程曲线 H = H0·(n/n0)² − a·Q²：叶轮“甩”出来的压头随转速平方变，流量越大损失越多。
// 系统曲线 H = Hs + k·Q²：要抬的高度 + 管子、过滤器、加热器的阻力（湍流，阻力和流量平方成正比）。
// 两者都按“米液柱”算，所以和液体密度无关；密度只影响压力（MPa）和功率、扭矩。
export const CF = {
  H0: 18, Qmax: 140, n0: 2900,      // 2900 rpm 时关死扬程 18 m，零扬程时 140 L/min
  etaMax: 0.45,                     // 最高效率；小型树脂磁力泵效率不高（最高效率点在 Qmax 的一半）
  Ploss: 20,                        // 轴承、隔离套里液体搅动等固定损失（W）
};
CF.a = CF.H0 / CF.Qmax ** 2;

export function pumpHead(Q, rpm = CF.n0) {
  const r = rpm / CF.n0;
  return CF.H0 * r * r - CF.a * Q * Q;
}

// 效率在关死点和零扬程点都是零，中间最高。这样轴功率随流量一路增加，和径向叶轮的实际曲线同向：
// 阀门开得越大，电机和磁力联轴器的负担越重。
export function pumpEta(Q, rpm = CF.n0) {
  const q = Q / (CF.Qmax * rpm / CF.n0);
  return clamp(CF.etaMax * 4 * q * (1 - q), 0.02, CF.etaMax);
}

/** 运行点：泵曲线和系统曲线的交点。k 单位 m/(L/min)² */
export function cfOperate({ rpm = CF.n0, Hs = 2, k = 6e-4, sg = 1 } = {}) {
  const r = rpm / CF.n0;
  const H0 = CF.H0 * r * r;
  if (H0 <= Hs) return { Q: 0, H: H0, P: sg * 1000 * G * H0 / 1e6, shaftW: CF.Ploss, eta: 0, dead: true };
  const Q = Math.sqrt((H0 - Hs) / (CF.a + k));
  const H = H0 - CF.a * Q * Q;
  const eta = pumpEta(Q, rpm);
  const hydW = sg * 1000 * G * (Q / 60000) * H;
  const shaftW = hydW / eta + CF.Ploss * r;
  return { Q, H, P: sg * 1000 * G * H / 1e6, hydW, shaftW, eta, dead: false };
}

// ================================================================ 磁力联轴器
// 内外磁铁之间能传的扭矩随错开角 δ 像正弦一样变：T = Tmax·sin(p·δ)，p 是极对数。
// 负载扭矩超过 Tmax，内磁铁就“掉队”（脱耦），之后只会抖动，必须停机重新同步。
// 钕铁硼剩磁温度系数约 −0.12 %/°C，扭矩大致跟剩磁平方走，所以这里取 −0.24 %/°C（本页简化）。
export const MAG = { Tmax20: 2.5, kT: 0.0024, pp: 4 };

export function coupling({ rpm = CF.n0, Hs = 2, k = 6e-4, sg = 1, temp = 25 } = {}) {
  const op = cfOperate({ rpm, Hs, k, sg });
  const w = 2 * Math.PI * rpm / 60;
  const T = op.shaftW / w;
  const Tmax = MAG.Tmax20 * (1 - MAG.kT * (temp - 20));
  const ratio = T / Tmax;
  const slip = ratio >= 1;
  const delta = slip ? Math.PI / (2 * MAG.pp) : Math.asin(ratio) / MAG.pp;     // 机械角（rad）
  return { ...op, T, Tmax, ratio, slip, delta, deg: delta * 180 / Math.PI };
}

// ================================================================ 磁悬浮：一个方向的位置控制
// 永磁转子在定子里天生“往偏的那边被吸”（负刚度 ks），只靠永磁铁不可能每个方向都稳（Earnshaw 定理）。
// 控制器量位置、改线圈电流，产生把它推回中心的力：m·x'' = ks·x + ki·i + F扰动，i = −(Kp·x + Kd·v)。
// 测量和计算有延迟，延迟太大会越扶越晃。数值是本页假设的量级。
export const LEV = { m: 0.25, ks: 3.0e4, ki: 15, Kp: 4050, Kd: 7, imax: 4, gap: 1.5e-3 };

export function levitate({ on = true, delayMs = 0.2, kick = 1, tEnd = 0.06, x0 = 0 } = {}) {
  const { m, ks, ki, Kp, Kd, imax, gap } = LEV;
  const dt = 2e-5, Ts = 1e-4;                       // 积分步长 20 µs；控制器每 0.1 ms 算一次
  const nDelay = Math.max(1, Math.round(delayMs * 1e-3 / Ts));
  const hist = [];
  let x = on ? x0 : (x0 || 2e-5), v = 0, i = 0, tNext = 0, touched = false, tTouch = null;
  const out = { t: [], x: [], i: [] };
  let maxDev = 0, settle = null;
  for (let t = 0; t <= tEnd + 1e-12; t += dt) {
    if (t >= tNext - 1e-12) {
      hist.push([x, v]);
      tNext += Ts;
      const [xm, vm] = hist.length > nDelay ? hist[hist.length - 1 - nDelay] : [0, 0];
      i = on ? clamp(-(Kp * xm + Kd * vm), -imax, imax) : 0;
    }
    const F = kick && t >= 0.005 && t < 0.007 ? 15 * kick : 0;   // 5 ms 时被液体冲一下：15 N，2 ms
    const a = (ks * x + ki * i + F) / m;
    v += a * dt; x += v * dt;
    if (Math.abs(x) >= gap) { x = Math.sign(x) * gap; v = 0; if (!touched) { touched = true; tTouch = t; } }
    maxDev = Math.max(maxDev, Math.abs(x));
    if (Math.round(t / dt) % 10 === 0) { out.t.push(t * 1000); out.x.push(x * 1e6); out.i.push(i); }
  }
  // 回中时间：扰动之后最后一次超出 ±20 µm 的时刻
  if (!touched) {
    let last = null;
    for (let k = 0; k < out.t.length; k++) if (out.t[k] > 5 && Math.abs(out.x[k]) > 20) last = out.t[k];
    settle = last === null ? 0 : last - 5;
    if (last !== null && last > tEnd * 1000 - 2) settle = null;           // 到最后还在晃 = 不稳
  }
  return { ...out, touched, tTouch: tTouch === null ? null : tTouch * 1000, maxDev: maxDev * 1e6, settle,
    tau: Math.sqrt(m / ks) * 1000 };
}

// ================================================================ 往复泵的行程波形（波纹管泵、隔膜泵共用）
// psi ∈ [0,1) 是一个来回（左右各挤一次）。每个行程开头 w 是换向（阀在切换，几乎不动），
// 然后加速 → 匀速 → 减速。返回 s ∈ [−1, 1]（连杆位置）和 |ds/dpsi|（平均值为 4）。
export function stroke(psi, w = 0.06, a = 0.1) {
  psi = ((psi % 1) + 1) % 1;
  const h = psi < 0.5 ? 0 : 1;
  const tau = psi * 2 - h;
  let e = 0, p = 0;
  if (tau >= w) {
    const u = (tau - w) / (1 - w), vm = 1 / (1 - a);
    if (u < a) { e = vm * u * u / (2 * a); p = vm * u / a; }
    else if (u < 1 - a) { e = vm * (a / 2 + (u - a)); p = vm; }
    else { e = 1 - vm * (1 - u) ** 2 / (2 * a); p = vm * (1 - u) / a; }
  }
  const s = h === 0 ? -1 + 2 * e : 1 - 2 * e;
  const sp = 4 * p / (1 - w);
  return { s, dir: h === 0 ? 1 : -1, sp, h, tau, switching: tau < w };
}

/** 出口流量波形：两边轮流挤，所以只有换向那一下掉到零。damperTau=0 表示不装阻尼器 */
export function pulsation({ cpm = 40, w = 0.06, damperTau = 0, cycles = 3, n = 600 } = {}) {
  const T = 60 / cpm;                                // 一个来回的秒数
  const tEnd = cycles * T, dt = tEnd / n;
  const t = [], raw = [], out = [];
  // 先跑 3 个来回让阻尼器进入稳态
  let y = 1;
  const warm = 3 * T;
  for (let tt = -warm; tt < tEnd - 1e-9; tt += dt) {
    const q = stroke(tt / T, w).sp / 4;
    if (damperTau > 0) y += (q - y) * (1 - Math.exp(-dt / damperTau)); else y = q;
    if (tt >= 0) { t.push(tt); raw.push(q); out.push(y); }
  }
  const rng = (a) => Math.max(...a) - Math.min(...a);
  return { t, raw, out, ripple: rng(out), rippleRaw: rng(raw) };
}

// ================================================================ 气动泵（波纹管泵、隔膜泵）的运行点
// 力平衡：气压 × 面积 = 液压 × 面积 + 摩擦和波纹管自身的弹力，所以出口压力顶多比气压低一点（Pstall）。
// 出口越憋，气推得越慢：Q = Q0·(1 − Pd/Pstall)。Q0 是出口敞开时的流量，随气压升高（本页取 √ 关系）。
// 系统：Pd = Pb + R·Q²（Pb 是背压，R 是管路和过滤器）。单位：MPa、L/min。
export const AIR = {
  bellows: { Q0ref: 40, loss: 0.02, Vstroke: 0.434 },   // Vstroke：单边一次挤出的升数（有效半径 48 mm × 60 mm）
  aodd: { Q0ref: 46, loss: 0.03, Vstroke: 0.26 },
};

export function airPump(kind, { Pa = 0.5, Pb = 0.02, R = 1e-4 } = {}) {
  const c = AIR[kind];
  const Pstall = Math.max(0.001, Pa - c.loss);
  const Q0 = c.Q0ref * Math.sqrt(Pa / 0.5);
  // Pb + R·Q² = Pstall·(1 − Q/Q0)  →  R·Q² + (Pstall/Q0)·Q + (Pb − Pstall) = 0
  let Q = 0;
  if (Pb < Pstall) {
    const A = R, Bq = Pstall / Q0, Cq = Pb - Pstall;
    Q = A > 1e-12 ? (-Bq + Math.sqrt(Bq * Bq - 4 * A * Cq)) / (2 * A) : -Cq / Bq;
  }
  const Pd = Pb + R * Q * Q;
  const cpm = Q / (2 * c.Vstroke);              // 一个来回挤两次
  return { Q, Pd, Pstall, Q0, cpm, stalled: Q < 0.05 };
}

// ================================================================ 电磁计量泵
// 每一下挤出的量 = 最大行程容积 × 行程长度；流量 = 每下的量 × 每分钟次数。
// 最大 3.5 mL/下：按公开资料里“360 下/分时 75 L/h”这一档反推的量级。
export const MET = { Vmax: 3.5, spmMax: 360, Ps: 0.1 };

export function dosing({ spm = 120, L = 1 } = {}) {
  const mlStroke = MET.Vmax * L;
  return { mlStroke, mlMin: mlStroke * spm, Lh: mlStroke * spm * 60 / 1000 };
}

// 气锁：泵头里有气泡时，前一段行程只是在压缩气泡，压力到了出口压力才推开出口阀。
//   每下挤出 = max(0, ΔV − Vg·(1 − Ps/Pd))        （等温压缩，忽略液体可压缩性）
// 双氧水、次氯酸钠会慢慢放气（gen，mL/下）；出口阀打开时，一小部分气泡跟着液体被带走。
// 一旦挤不出去，气泡也走不了，就越积越多 = 气锁。数值是本页假设。
export function gasLock({ L = 0.4, PdG = 0.3, gen = 0.03, vent = false, purgeN = 0, n = 300, carry = 0.15 } = {}) {
  const Pd = PdG + MET.Ps;
  const c = 1 - MET.Ps / Pd;
  let Vg = 0, locked = null, sum = 0;
  const out = [], gas = [];
  for (let k = 0; k < n; k++) {
    const full = purgeN > 0 && k % purgeN === purgeN - 1;
    const dV = MET.Vmax * (full ? 1 : L);
    Vg += gen;
    let d = Math.max(0, dV - Vg * c);
    if (d > 0) Vg *= 1 - carry * Math.min(1, d / dV) * (full ? 3 : 1);
    if (vent) { d = Math.max(0, d - 0.03 * dV); Vg *= 0.55; }   // 自动排气阀：放走一部分气，也回流一点液
    if (d <= 1e-9 && locked === null) locked = k;
    out.push(d / (MET.Vmax * L)); gas.push(Vg);
    sum += d;
  }
  const ideal = MET.Vmax * L * n + (purgeN > 0 ? MET.Vmax * (1 - L) * Math.floor(n / purgeN) : 0);
  return { out, gas, locked, ratio: sum / ideal, threshold: MET.Vmax * L / c };
}

// ================================================================ 第一章：滤芯越堵，两类泵怎么反应
// 同一条管路（背压 + 阻力），阻力随堵塞增加；离心泵用上面的磁力泵，容积泵用 0.5 MPa 的波纹管泵。
export function clogCompare(clog) {
  const k = 3e-4 * (1 + 30 * clog ** 2);                   // 离心：m/(L/min)²
  const cf = cfOperate({ k, Hs: 2 });
  const R = k * 1000 * G / 1e6;                            // 同一个阻力换成 MPa/(L/min)²（按水）
  const pd = airPump('bellows', { Pa: 0.5, Pb: 2 * 1000 * G / 1e6, R });
  return { cf, pd, k, R };
}
