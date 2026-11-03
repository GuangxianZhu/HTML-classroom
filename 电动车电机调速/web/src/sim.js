// 电机与整车模型。纯函数，不碰 DOM，Node 下可以直接测（test_sim.mjs）。
// 电机：恒参数 dq 模型（等幅值 Clarke/Park），忽略磁饱和、温度、谐波。
// 机型是虚构的教学机型，量级接近主流后驱纯电车。

export const MOTOR = {
  p: 4,            // 极对数（8 极）
  psi: 0.075,      // 永磁磁链 Wb
  Ld: 1.25e-4,     // d 轴电感 H
  Lq: 2.9e-4,      // q 轴电感 H
  Rs: 0.012,       // 定子电阻 Ω
  Imax: 520,       // 相电流峰值上限 A
  Vdc: 400,        // 母线电压 V
  nMax: 16000,     // 机械转速上限 rpm
  margin: 0.95,    // 电压裕量：留给电流环调节和死区
};

export const CAR = {
  m: 1850,         // 整备 + 一名驾驶员 kg
  r: 0.335,        // 车轮滚动半径 m
  G: 9.038,        // 减速比，和 Blender 模型的齿数一致：(65/21)×(73/25)
  eta: 0.97,       // 减速器效率
  CdA: 0.62,       // 风阻面积 m²
  Crr: 0.011,      // 滚阻系数
  rho: 1.2,        // 空气密度
  Jm: 0.045,       // 转子转动惯量 kg·m²
  Jw: 2.4,         // 四个车轮合计 kg·m²
  kWh: 60,         // 电池容量
};

export const G0 = 9.81;
export const rpm2rad = (n) => n * Math.PI / 30;
export const rad2rpm = (w) => w * 30 / Math.PI;
export const wElec = (m, n) => rpm2rad(n) * m.p;
export const fElec = (m, n) => n * m.p / 60;

export const vLimit = (m) => m.Vdc / Math.sqrt(3) * m.margin;   // SVPWM 线性区相电压峰值（dq 幅值）

export function torqueOf(m, id, iq) {
  return 1.5 * m.p * (m.psi + (m.Ld - m.Lq) * id) * iq;
}
export const magTorque = (m, iq) => 1.5 * m.p * m.psi * iq;
export const relTorque = (m, id, iq) => 1.5 * m.p * (m.Ld - m.Lq) * id * iq;

export function fluxOf(m, id, iq) {
  return Math.hypot(m.psi + m.Ld * id, m.Lq * iq);
}

/** 稳态 dq 电压（含电阻） */
export function voltages(m, id, iq, we) {
  const vd = m.Rs * id - we * m.Lq * iq;
  const vq = m.Rs * iq + we * (m.psi + m.Ld * id);
  return { vd, vq, vs: Math.hypot(vd, vq) };
}

/** 这个转速下能出的最大扭矩（正值）。在 id 上扫一遍，iq 取电流圆和电压椭圆里更紧的那个。忽略电阻压降 */
export function maxTorqueAt(m, we, steps = 260) {
  const w = Math.max(Math.abs(we), 1);
  const lim = (vLimit(m) / w) ** 2;
  let best = { T: 0, id: 0, iq: 0 };
  for (let k = 0; k <= steps; k++) {
    const id = -m.Imax * k / steps;
    const iqc = Math.sqrt(Math.max(m.Imax ** 2 - id * id, 0));
    const d = lim - (m.psi + m.Ld * id) ** 2;
    if (d <= 0) continue;
    const iq = Math.min(iqc, Math.sqrt(d) / m.Lq);
    const T = torqueOf(m, id, iq);
    if (T > best.T) best = { T, id, iq };
  }
  return best;
}

/** MTPA：给定电流幅值，让扭矩最大的电流角 γ（id = I cosγ, iq = I sinγ）。解析式 */
export function mtpaAngle(m, I) {
  const dL = m.Ld - m.Lq;
  if (I < 1e-6) return Math.PI / 2;
  const a = m.psi;
  const c = (-a + Math.sqrt(a * a + 8 * (dL * I) ** 2)) / (4 * dL * I);   // cosγ
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** 给定扭矩指令和电转速，求工作点：电流最小、且不超电流圆和电压椭圆。达不到就给这个转速的上限 */
export function solveOp(m, Tcmd, we, steps = 180) {
  const sign = Tcmd >= 0 ? 1 : -1;
  const T = Math.abs(Tcmd);
  const w = Math.max(Math.abs(we), 1);
  const lim = (vLimit(m) / w) ** 2;
  if (T < 1e-3) {
    // 零扭矩：转速高到反电动势超过电压上限时，也要拉 id 把电压压回去
    const need = Math.sqrt(lim);
    const id = m.psi > need ? Math.max((need - m.psi) / m.Ld, -m.Imax) : 0;
    return { id, iq: 0, T: 0, mode: id < -1 ? 'fw' : 'idle', limited: false };
  }
  let best = null;
  for (let k = 0; k <= steps; k++) {
    const id = -m.Imax * k / steps;
    const iq = T / (1.5 * m.p * (m.psi + (m.Ld - m.Lq) * id));
    const I2 = id * id + iq * iq;
    if (I2 > m.Imax ** 2) continue;
    if ((m.psi + m.Ld * id) ** 2 + (m.Lq * iq) ** 2 > lim) continue;
    if (!best || I2 < best.I2) best = { id, iq, I2 };
  }
  if (best) {
    const mtpaI = Math.hypot(best.id, best.iq);
    const g = mtpaAngle(m, mtpaI);
    const onMtpa = Math.abs(best.id - mtpaI * Math.cos(g)) < 2.5 * m.Imax / steps + 1;
    return { id: best.id, iq: sign * best.iq, T: sign * T, mode: onMtpa ? 'mtpa' : 'fw', limited: false };
  }
  const mx = maxTorqueAt(m, w);
  return { id: mx.id, iq: sign * mx.iq, T: sign * mx.T, mode: Math.hypot(mx.id, mx.iq) > m.Imax * .995 && (m.psi + m.Ld * mx.id) ** 2 + (m.Lq * mx.iq) ** 2 < lim * .995 ? 'mtpa' : 'fw', limited: true };
}

/** 损耗模型：系数按量级标定，只用来画趋势 */
export function losses(m, id, iq, we, fsw = 10000) {
  const I = Math.hypot(id, iq);
  const f = Math.abs(we) / (2 * Math.PI);
  const lam = fluxOf(m, id, iq);
  const wm = Math.abs(we) / m.p;
  const cu = 1.5 * m.Rs * I * I;
  const fe = (200 * f + 0.25 * f * f) * lam * lam;
  const mech = 0.012 * wm + 3e-7 * wm ** 3;
  const cond = 2.1 * I;
  const sw = 2.9e-4 * fsw * I * (m.Vdc / 400);
  return { cu, fe, mech, inv: cond + sw, cond, sw, total: cu + fe + mech + cond + sw };
}

/** 工作点的功率流。Pm > 0 表示驱动；Pdc > 0 表示电池放电 */
export function powerAt(m, T, id, iq, we, fsw) {
  const wm = we / m.p;
  const Pm = T * wm;
  const L = losses(m, id, iq, we, fsw);
  const Pdc = Pm + L.total;
  const eff = Pm > 1 ? Pm / Pdc : Pm < -1 ? (Pdc < 0 ? Pdc / Pm : 0) : 0;
  return { Pm, Pdc, eff, L };
}

/** 反电动势峰值（相）：id = iq = 0 时 */
export const backEmf = (m, we) => Math.abs(we) * m.psi;

/** 扭矩—转速外特性 */
export function tnCurve(m, N = 96, nTop = m.nMax) {
  const out = [];
  for (let i = 0; i <= N; i++) {
    const n = nTop * i / N;
    const mx = maxTorqueAt(m, wElec(m, Math.max(n, 30)));
    out.push({ n, T: mx.T, P: mx.T * rpm2rad(n) });
  }
  return out;
}

/** 不弱磁（id 固定 0）时的外特性，用来和弱磁对比 */
export function tnNoFw(m, N = 96, nTop = m.nMax) {
  const out = [];
  for (let i = 0; i <= N; i++) {
    const n = nTop * i / N;
    const w = wElec(m, Math.max(n, 30));
    const lim = (vLimit(m) / w) ** 2 - m.psi ** 2;
    const iq = lim <= 0 ? 0 : Math.min(m.Imax, Math.sqrt(lim) / m.Lq);
    out.push({ n, T: torqueOf(m, 0, iq) });
  }
  return out;
}

/** 基速：外特性开始从恒扭矩往下掉的转速 */
export function baseSpeed(m) {
  const T0 = maxTorqueAt(m, wElec(m, 100)).T;
  for (let n = 200; n < m.nMax; n += 20) {
    if (maxTorqueAt(m, wElec(m, n)).T < T0 * .995) return n;
  }
  return m.nMax;
}

// ------------------------------------------------------------------ 整车
export const motorRpmFromV = (v, car = CAR) => rad2rpm(v * car.G / car.r);
export const vFromRpm = (n, car = CAR) => rpm2rad(n) * car.r / car.G;

export function resistForce(v, gradePct, car = CAR) {
  const th = Math.atan(gradePct / 100);
  return {
    roll: v > .01 ? car.m * G0 * car.Crr * Math.cos(th) : 0,
    aero: 0.5 * car.rho * car.CdA * v * v,
    grade: car.m * G0 * Math.sin(th),
  };
}

export const mEquivalent = (car = CAR) => car.m + car.Jw / car.r ** 2 + car.Jm * car.G ** 2 / car.r ** 2;

/** 把电机扭矩和制动力合到车上，走一步。Tcmd 为电机轴扭矩，Fbrake ≥ 0 为机械制动力 */
export function stepCar(m, s, dt, Tcmd, Fbrake, gradePct, car = CAR) {
  const n = motorRpmFromV(s.v, car);
  let cmd = Tcmd;
  if (n > m.nMax && cmd > 0) cmd = 0;
  if (s.v <= 0.02 && cmd < 0) cmd = 0;
  const we = wElec(m, n);
  const op = solveOp(m, cmd, we);
  const F = op.T * car.G * (op.T >= 0 ? car.eta : 1 / car.eta) / car.r;
  const R = resistForce(s.v, gradePct, car);
  const res = R.roll + R.aero + R.grade;
  const net = F - res - Fbrake * (s.v > 0.02 ? 1 : 0);
  let a = net / mEquivalent(car);
  let v = s.v + a * dt;
  if (v < 0) { v = 0; a = 0; }
  const P = powerAt(m, op.T, op.id, op.iq, we);
  const soc = s.soc - P.Pdc * dt / 3600 / (car.kWh * 1000);
  return { v, a, soc, t: (s.t || 0) + dt, n: motorRpmFromV(v, car), op, P, F, R, res, we };
}

/** 零至百公里 */
export function zeroTo100(m, car = CAR) {
  let s = { v: 0, soc: .8, t: 0 };
  const dt = 0.01;
  while (s.v < 100 / 3.6 && s.t < 40) {
    const n = motorRpmFromV(s.v, car);
    s = stepCar(m, s, dt, maxTorqueAt(m, wElec(m, Math.max(n, 30))).T, 0, 0, car);
  }
  return s.t;
}

/** 平路极速：牵引力和阻力平衡的车速，或被转速上限卡住 */
export function topSpeed(m, car = CAR) {
  for (let v = 10; v < 120; v += .1) {
    const n = motorRpmFromV(v, car);
    if (n > m.nMax) return { v: v - .1, by: 'rpm' };
    const T = maxTorqueAt(m, wElec(m, n)).T;
    const F = T * car.G * car.eta / car.r;
    const R = resistForce(v, 0, car);
    if (F < R.roll + R.aero) return { v, by: 'power' };
  }
  return { v: 120, by: 'none' };
}

// ------------------------------------------------------------------ 电流环阶跃（第 6 章）
/** dq 电流环：离散 PI + 交叉解耦 + 一拍计算延迟。Ts 控制周期，返回逐点记录 */
export function currentLoopStep(m, { n = 3000, id0 = 0, iq0 = 60, id1 = -120, iq1 = 300, fc = 500, Ts = 1e-4, tEnd = 0.02, tStep = 0.004 }) {
  const we = wElec(m, n);
  const wc = 2 * Math.PI * fc;
  const kpd = m.Ld * wc, kid = m.Rs * wc;
  const kpq = m.Lq * wc, kiq = m.Rs * wc;
  const Vl = vLimit(m) / m.margin;
  const sub = 10;
  const h = Ts / sub;
  let id = id0, iq = iq0, xd = 0, xq = 0, vd = 0, vq = 0, vdNext = 0, vqNext = 0;
  // 从稳态开始：积分项和当前电压吻合
  const v0 = voltages(m, id0, iq0, we);
  xd = v0.vd + we * m.Lq * iq0; xq = v0.vq - we * (m.Ld * id0 + m.psi);
  vd = vdNext = v0.vd; vq = vqNext = v0.vq;
  const out = { t: [], id: [], iq: [], idr: [], iqr: [], ia: [], ib: [], ic: [], vs: [] };
  let th = 0;
  const steps = Math.round(tEnd / Ts);
  for (let k = 0; k < steps; k++) {
    const t = k * Ts;
    const idr = t >= tStep ? id1 : id0, iqr = t >= tStep ? iq1 : iq0;
    const ed = idr - id, eq = iqr - iq;
    // 上一拍算出来的电压这一拍才生效
    vd = vdNext; vq = vqNext;
    xd += kid * Ts * ed; xq += kiq * Ts * eq;
    let ud = kpd * ed + xd - we * m.Lq * iq;
    let uq = kpq * eq + xq + we * (m.Ld * id + m.psi);
    const mag = Math.hypot(ud, uq);
    if (mag > Vl) {          // 电压饱和时限幅，并回退积分防止饱和累积
      ud *= Vl / mag; uq *= Vl / mag;
      xd -= kid * Ts * ed; xq -= kiq * Ts * eq;
    }
    vdNext = ud; vqNext = uq;
    for (let j = 0; j < sub; j++) {
      const did = (vd - m.Rs * id + we * m.Lq * iq) / m.Ld;
      const diq = (vq - m.Rs * iq - we * (m.Ld * id + m.psi)) / m.Lq;
      id += did * h; iq += diq * h; th += we * h;
      if (j % 2 === 0) {
        out.t.push(t + j * h); out.id.push(id); out.iq.push(iq); out.idr.push(idr); out.iqr.push(iqr);
        const c = Math.cos(th), s = Math.sin(th);
        const ia = id * c - iq * s;
        const ib = id * Math.cos(th - 2.0944) - iq * Math.sin(th - 2.0944);
        out.ia.push(ia); out.ib.push(ib); out.ic.push(-ia - ib);
        out.vs.push(Math.hypot(vd, vq));
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ PWM（第 5 章）
/** 一个电周期的 PWM 波形。三角载波 + 三相调制波（注入零序等效 SVPWM）。
 *  反电动势按“基波电流 = Iset、滞后电压 phi”反推，这样改频率和调制比时基波电流不变，只有纹波变 */
export function pwmPeriod({ m, mi = .8, fsw = 5000, fe = 200, Vdc = 400, Iset = 200, phi = .35, thirdHarm = true }) {
  const N = Math.max(3000, Math.ceil(40 * fsw / fe));
  const T = 1 / fe, dt = T / N, L = (m.Ld + m.Lq) / 2, R = m.Rs, w = 2 * Math.PI * fe;
  const V1 = Vdc / 2 * mi;
  // E = V - (R + jwL)·I∠-phi
  const Ire = Iset * Math.cos(-phi), Iim = Iset * Math.sin(-phi);
  const Ere = V1 - (R * Ire - w * L * Iim), Eim = -(R * Iim + w * L * Ire);
  const Eamp = Math.hypot(Ere, Eim), Eang = Math.atan2(Eim, Ere);
  const carrier = (t) => {
    const x = (t * fsw + .25) % 1;
    return x < .5 ? 1 - 4 * x : -3 + 4 * x;
  };
  const out = { t: new Float32Array(N), car: new Float32Array(N), ra: new Float32Array(N), rb: new Float32Array(N), rc: new Float32Array(N), ga: new Uint8Array(N), gb: new Uint8Array(N), gc: new Uint8Array(N), vun: new Float32Array(N), iu: new Float32Array(N), ifund: new Float32Array(N), vfund: new Float32Array(N) };
  const i = [0, 1, 2].map((p) => Iset * Math.cos(-phi - p * 2.0943951));
  const rs = [0, 0, 0], g = [0, 0, 0], v = [0, 0, 0];
  for (let cyc = 0; cyc < 2; cyc++) {
    for (let k = 0; k < N; k++) {
      const t = k * dt + cyc * T, th = w * t;
      for (let p = 0; p < 3; p++) rs[p] = mi * Math.cos(th - p * 2.0943951);
      const z = thirdHarm ? -(Math.max(rs[0], rs[1], rs[2]) + Math.min(rs[0], rs[1], rs[2])) / 2 : 0;
      const c = carrier(t);
      for (let p = 0; p < 3; p++) { rs[p] += z; g[p] = rs[p] > c ? 1 : 0; }
      const vm = (g[0] + g[1] + g[2]) / 3;
      for (let p = 0; p < 3; p++) {
        v[p] = (g[p] - vm) * Vdc;
        const e = Eamp * Math.cos(th + Eang - p * 2.0943951);
        i[p] += (v[p] - R * i[p] - e) / L * dt;
      }
      if (cyc === 1) {
        out.t[k] = k * dt; out.car[k] = c; out.ra[k] = rs[0]; out.rb[k] = rs[1]; out.rc[k] = rs[2];
        out.ga[k] = g[0]; out.gb[k] = g[1]; out.gc[k] = g[2]; out.vun[k] = v[0]; out.iu[k] = i[0];
        out.vfund[k] = V1 * Math.cos(th); out.ifund[k] = Iset * Math.cos(th - phi);
      }
    }
  }
  let mean = 0;
  for (let k = 0; k < N; k++) mean += out.iu[k] - out.ifund[k];
  mean /= N;
  let rip = 0;
  for (let k = 0; k < N; k++) { out.iu[k] -= mean; rip = Math.max(rip, Math.abs(out.iu[k] - out.ifund[k])); }
  out.ripple = rip; out.peak = Iset; out.N = N; out.V1 = V1;
  return out;
}

// ------------------------------------------------------------------ 三相 / Clarke / Park
export function abc(I, th) {
  return [I * Math.cos(th), I * Math.cos(th - 2 * Math.PI / 3), I * Math.cos(th + 2 * Math.PI / 3)];
}
