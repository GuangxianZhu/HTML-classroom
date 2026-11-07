// 数字模型：四冲程循环、二冲程气口、CVT 力平衡、离心离合器、整车加速、电控 CVT、混动助力、电动车。
// 数值是“教学车”的量级（125 cc 风冷单缸、整备 + 骑手约 195 kg），是我设的，不对应任何车型。
// 几何（皮带轮半径、气缸尺寸、齿数）从 Blender 导出的 spec.json 读，和三维模型是同一套数。

export const RPM = Math.PI / 30;          // rpm → rad/s
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// ================================================================ 几何
export const G = {};
export function setGeom(spec) {
  const k = spec.models.U4.kin, t = spec.models.T2.kin, m = spec.models.EM.kin;
  Object.assign(G, {
    r: k.r, L: k.L, bore: k.bore, pinH: k.pinH, deck: k.deck, timing: k.timing,
    tanB: k.tanB, r1lo: k.r1lo, r1hi: k.r1hi, r2lo: k.r2lo, r2hi: k.r2hi, beltL: k.beltL,
    C: Math.hypot(k.drv[0] - k.crank[0], k.drv[2] - k.crank[2]),
    deltaMax: k.deltaMax, epsMax: k.epsMax, rho0: k.rollRho0, rhoMax: k.rollRho0 + k.deltaMax / k.rollKw, rollN: k.rollN,
    zg: k.zg, iF: (k.zg[1] / k.zg[0]) * (k.zg[3] / k.zg[2]), wheelR: k.wheelR / 1000,
    t2: { r: t.r, L: t.L, bore: t.bore, pinH: t.pinH, deck: t.deck, sEx: t.sEx, sTr: t.sTr, sBdc: t.sBdc, eo: t.eo, to: t.to },
    emI: (m.zg[1] / m.zg[0]) * (m.zg[3] / m.zg[2]),
  });
  // 皮带长度不变 → 主动轮半径 r1 定了，从动轮半径 r2 也就定了
  G.r2tab = [];
  for (let j = 0; j <= 100; j++) G.r2tab.push(r2of(G.r1lo + (G.r1hi - G.r1lo) * j / 100));
  G.iMax = G.r2lo / G.r1lo; G.iMin = G.r2tab[100] / G.r1hi;
  G.Vs = Math.PI / 4 * (k.bore / 10) ** 2 * (2 * k.r / 10);          // cc
  G.Vc = G.Vs / (11 - 1);                                              // 压缩比 11
}

function beltLen(r1, r2) {
  const d = r2 - r1, C = G.C;
  return 2 * Math.sqrt(C * C - d * d) + Math.PI * (r1 + r2) + 2 * d * Math.asin(d / C);
}
function r2of(r1) {
  let lo = 10, hi = 120;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (beltLen(r1, m) > G.beltL) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

/** 变速进度 x ∈ [0,1]：0 = 最低档（起步），1 = 最高档 */
export function cvtGeom(x) {
  x = clamp(x, 0, 1);
  const r1 = G.r1lo + (G.r1hi - G.r1lo) * x;
  const f = x * 100, j = Math.min(99, Math.floor(f));
  const r2 = lerp(G.r2tab[j], G.r2tab[j + 1], f - j);
  const delta = 2 * G.tanB * (r1 - G.r1lo);          // 主动动盘往定盘那边走了多少（mm）
  const eps = 2 * G.tanB * (r2 - G.r2hi);            // 从动动盘离“最开”还有多少（mm）
  const rho = rhoOf(x);
  return { x, r1, r2, i: r2 / r1, delta, eps, rho };
}

export function xOfRatio(i) {
  let lo = 0, hi = 1;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (cvtGeom(m).i > i) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// 滚子斜坡：做成曲线（外段更陡），让“滚子推力 ÷ 弹簧夹紧力”在整个变速过程里差不多，转速才能稳在一条线上
let RA = 1.6, RB = 0.6;
export function setRamp(a) { RA = a; RB = a - 1; }
export function rhoOf(x) { return G.rho0 + (G.rhoMax - G.rho0) * (RA * x - RB * x * x); }
function dRhoDx(x) { return (G.rhoMax - G.rho0) * (RA - 2 * RB * x); }
/** 斜坡的“杠杆”：滚子往外 1 mm，动盘往里推多少 mm 的倒数 = dρ/dδ */
export function rampGain(x) { return dRhoDx(x) / (2 * G.tanB * (G.r1hi - G.r1lo)); }

// ================================================================ 发动机（125 cc 教学机）
const TQ_N = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 9800, 10500];
const TQ_V = [4.5, 6.2, 8.0, 9.4, 10.4, 11.1, 11.6, 11.7, 11.2, 9.9, 8.6, 0];
export const ENG = { idle: 1700, limit: 9800, J: 0.020 };
export function tqWot(n) {
  n = clamp(n, 0, 10500);
  let j = 0; while (j < TQ_N.length - 2 && TQ_N[j + 1] < n) j++;
  return lerp(TQ_V[j], TQ_V[j + 1], (n - TQ_N[j]) / (TQ_N[j + 1] - TQ_N[j]));
}
export const tFric = (n) => 0.7 + 0.00013 * n;
/** 油门开度 → 能用上多少“满油门扭矩”：低转速时开一点就够，高转速要开大 */
export function thrEff(thr, n) { return thr <= 0 ? 0 : Math.min(1, Math.pow(thr, 0.55 + 0.6 * n / 9000)); }
/** 曲轴净扭矩（N·m）。thr 0..1；on=false 表示熄火（怠速停止） */
export function engTorque(n, thr, on = true) {
  if (!on) return n > 50 ? -tFric(n) - 0.6 : 0;
  if (n > ENG.limit) return -tFric(n);                     // 断油限转
  let T = thrEff(thr, n) * (tqWot(n) + tFric(n)) - tFric(n);
  if (thr < 0.04) T = Math.max(T, (ENG.idle - n) * 0.004 - tFric(n) * 0.2);   // 怠速控制
  return T;
}
export const powerKW = (n, T) => T * n * RPM / 1000;

// ================================================================ 四冲程一个循环（0..720°，0 = 压缩上止点）
/** 活塞销离曲轴中心的距离（mm） */
export function pistonS(th, r = G.r, L = G.L) { return r * Math.cos(th) + Math.sqrt(L * L - (r * Math.sin(th)) ** 2); }
export function lift(thDeg, open, close, Lmax) {
  let d = ((thDeg - open) % 720 + 720) % 720;
  const dur = ((close - open) % 720 + 720) % 720;
  if (d > dur) return 0;
  return Lmax * Math.sin(Math.PI * d / dur) ** 2;
}
export function valveLifts(thDeg) {
  const T = G.timing;
  return { inL: lift(thDeg, T.IVO, T.IVC, T.LIFT), exL: lift(thDeg, T.EVO, T.EVC, T.LIFT) };
}
export function stroke4(thDeg) {
  const d = ((thDeg % 720) + 720) % 720;
  if (d < 180) return { k: 'power', cn: '做功', i: 2 };
  if (d < 360) return { k: 'exhaust', cn: '排气', i: 3 };
  if (d < 540) return { k: 'intake', cn: '进气', i: 0 };
  return { k: 'compress', cn: '压缩', i: 1 };
}
/** 缸内容积（cc） */
export function vol4(thDeg) {
  const th = thDeg * Math.PI / 180;
  const top = G.r + G.L;
  return G.Vc + Math.PI / 4 * (G.bore / 10) ** 2 * (top - pistonS(th)) / 10;
}

/** 0-D 单区模型：p–V 和每度的压力。thr = 油门（进气压力），spark = 点火提前角（上止点前，度） */
export function cycle4(thr = 1, spark = 20) {
  const gam = 1.32, N = 720;
  const pin = lerp(0.32, 0.97, thr), pex = 1.08;          // 进气歧管、排气（bar）
  const p = new Float64Array(N + 1), V = new Float64Array(N + 1);
  const T = G.timing;
  const Qtot = 300 * (pin / 0.97);                        // 每循环放热（J），和吸进去的空气成正比
  const st = -spark, dur = 55;
  const wiebe = (a) => (a < st ? 0 : 1 - Math.exp(-5 * Math.pow(Math.min(1, (a - st) / dur), 3)));
  // 从进气下止点附近开始积分两圈，取第二圈（消掉初值）
  let pp = pin;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k <= N; k++) {
      const a = (540 + k) % 720;
      const a0 = (a + 719) % 720;
      const V1 = vol4(a), V0 = vol4(a0);
      const { inL, exL } = valveLifts(a);
      let dp = -gam * pp * (V1 - V0) / V1;
      // 燃烧放热：以上止点为 0（a 在 680..720 或 0..80）
      const ac = a > 360 ? a - 720 : a;
      if (ac > st - 1 && ac < st + dur + 1) dp += (gam - 1) * Qtot * (wiebe(ac) - wiebe(ac - 1)) / (V1 * 1e-6) / 1e5;
      pp = Math.max(0.05, pp + dp);
      // 气门开着：缸压往歧管压力靠
      if (inL > 0.3) pp += (pin - pp) * Math.min(1, inL / 7 * 0.6);
      if (exL > 0.3) pp += (pex - pp) * Math.min(1, exL / 7 * 0.5);
      if (pass === 1) { p[a] = pp; V[a] = V1; }
    }
  }
  p[720] = p[0]; V[720] = V[0];
  // 指示功 ∮p dV
  let W = 0;
  for (let a = 0; a < 720; a++) W += (p[a] + p[a + 1]) / 2 * 1e5 * (V[a + 1] - V[a]) * 1e-6;
  let pmax = 0, apmax = 0;
  for (let a = 0; a <= 720; a++) if (p[a] > pmax) { pmax = p[a]; apmax = a; }
  return { p, V, W, pmax, apmax: apmax > 360 ? apmax - 720 : apmax, imep: W / (G.Vs * 1e-6) / 1e5 };
}

// ================================================================ 二冲程
export function t2Crown(th) { const g = G.t2; return pistonS(th, g.r, g.L) + g.pinH; }
/** 二冲程 0..360°：哪些口开着 */
export function ports2(thDeg) {
  const d = ((thDeg % 360) + 360) % 360, g = G.t2;
  const s = t2Crown(d * Math.PI / 180);
  const exOpen = clamp((g.sEx - s) / (g.sEx - g.sBdc), 0, 1);
  const trOpen = clamp((g.sTr - s) / (g.sTr - g.sBdc), 0, 1);
  // 簧片阀：活塞往上走、曲轴箱变大变成负压时打开（这里按角度给，带一点惯性滞后）
  const reed = (d > 205 || d < 25) ? smooth(Math.min((d > 205 ? d - 205 : d + 155) / 25, (d > 205 ? 385 - d : 25 - d) / 20)) : 0;
  let k, cn;
  if (d < g.eo) { k = 'power'; cn = '做功（同时曲轴箱在压混合气）'; }
  else if (d < g.to) { k = 'blow'; cn = '排气口先开：废气冲出去'; }
  else if (d <= 360 - g.to) { k = 'scav'; cn = '扫气口也开：新气把废气推出去'; }
  else if (d < 360 - g.eo) { k = 'loss'; cn = '扫气口关了、排气口还开着：会跑掉一点新气'; }
  else { k = 'comp'; cn = '压缩（同时曲轴箱在吸新气）'; }
  return { d, s, exOpen, trOpen, reed, k, cn };
}

// ================================================================ CVT 力平衡
// 主动轮：滚子离心力经斜坡变成推动盘的轴向力  F1 = K1 · N · m · ω² · ρ · (dρ/dδ)
// 从动轮：弹簧力 + 扭力凸轮力              F2 = Fs0 + ks·压缩量 + T2 / (r_cam · tanθ)
// 平衡点：F1 = F2。F1 大于 F2，主动轮夹紧 → 皮带往外爬 → 升档；反之降档。
export const CVT = {
  Fs0: 250, ks: 20,                 // 弹簧预紧（N）、刚度（N/mm）
  camK: 40,                         // 扭力凸轮：每 1 N·m 从动轮扭矩产生的轴向力（N）= 1/(r_cam·tanθ)
  K1: 1,                            // 标定系数（setGeom 后算）
  etaB: 0.88, etaG: 0.96,           // 皮带、齿轮效率
};
export function F1(nEng, x, mRoll) {
  const w = nEng * RPM;
  return CVT.K1 * G.rollN * (mRoll / 1000) * w * w * (rhoOf(x) / 1000) * rampGain(x);
}
export function F2(x, T2, p = {}) {
  const g = cvtGeom(x);
  const comp = G.epsMax - g.eps;             // 动盘被撑开了多少 = 弹簧多压了多少
  const Fs0 = p.Fs0 ?? CVT.Fs0, ks = p.ks ?? CVT.ks, cam = p.camK ?? CVT.camK;
  return Fs0 + ks * comp + Math.max(0, T2) * cam;
}
/** 稳态：给定发动机扭矩和变速进度，皮带两边平衡时的发动机转速 */
export function balanceRpm(x, Te, mRoll, p = {}) {
  const g = cvtGeom(x);
  const f2 = F2(x, Math.max(0, Te) * g.i * CVT.etaB, p);
  const per = F1(1000, x, mRoll) / 1e6;
  return Math.sqrt(f2 / per);
}
export function calibrate() {
  // 15 g 滚子、满油门：起步后在 7000 rpm 附近开始升档
  CVT.K1 = 1;
  const want = 7000, x = 0;
  const Te = tqWot(want) * 1;
  const f2 = F2(x, Te * G.iMax * CVT.etaB);
  CVT.K1 = f2 / F1(want, x, 15);
}

// ================================================================ 离心离合器
export const CLUTCH = { nEng: 3200, K: 0.0028 };        // nEng = 在最低档时、发动机多少转开始咬合
export function clutchCap(w2, nEng = CLUTCH.nEng) {
  const w0 = nEng * RPM / G.iMax;
  return w2 > w0 ? CLUTCH.K * (w2 * w2 - w0 * w0) : 0;
}

// ================================================================ 整车
export const CAR = { M: 130, rider: 65, Crr: 0.015, CdA: 0.56, rho: 1.2, g: 9.81 };
/**
 * 一辆车的状态机。mode:
 *   'cent'  离心滚子 CVT（默认）
 *   'ecvtD' / 'ecvtS' 电控 CVT 的 D、S 模式；'ecvtM' 手动 6 档
 *   'ev'    摆臂电机（固定减速比）
 * 选项：hybrid（ACG 助力）、idleStop
 */
export class Ride {
  constructor(o = {}) {
    this.o = Object.assign({ mode: 'cent', roll: 15, Fs0: CVT.Fs0, ks: CVT.ks, camK: CVT.camK, slope: 0, rider: 65, hybrid: false,
      clutchN: CLUTCH.nEng, mgear: 1 }, o);
    this.reset();
  }
  reset() {
    Object.assign(this, { t: 0, n: ENG.idle, v: 0, x: 0, lock: false, Tc: 0, T2: 0, Te: 0, Ta: 0, dist: 0, fuel: 0, on: true,
      thrPrev: 0, tOpen: -9, soc: 0.8, slip: 0, trace: [] });
    if (this.o.mode === 'ev') this.n = 0;
  }
  get M() { return CAR.M + this.o.rider; }
  geom() { return cvtGeom(this.x); }
  /** 推进 dt 秒（内部 1 ms 小步） */
  step(dt, thr) {
    const h = 0.001;
    for (let k = 0; k < Math.round(dt / h); k++) this._step(h, thr);
  }
  _step(h, thr) {
    const o = this.o, M = this.M, R = G.wheelR;
    const slope = o.slope;
    if (o.mode === 'ev') return this._stepEV(h, thr);
    if (thr > 0.15 && this.thrPrev <= 0.15) this.tOpen = this.t;
    this.thrPrev = thr;
    const g = cvtGeom(this.x), i = g.i, iF = G.iF;
    const kV = iF * CVT.etaG / R;                        // 离合器扭矩 → 驱动力
    let Te = engTorque(this.n, thr, this.on);
    // 混动：拧油门后 3 秒内，ACG 当电机往曲轴上加扭矩（转速不高、电量够时）
    let Ta = 0;
    if (o.hybrid && this.on && thr > 0.3 && this.t - this.tOpen < 3 && this.n < 6500 && this.soc > 0.2) {
      Ta = 3.6 * smooth((this.t - this.tOpen) / 0.15) * smooth((3 - (this.t - this.tOpen)) / 0.4);
      this.soc -= Ta * this.n * RPM * h / (0.18 * 3.6e6 * 0.05);
    }
    this.Ta = Ta; Te += Ta; this.Te = Te;
    const w = this.n * RPM, w2 = w / i, wb = this.v * iF / R;
    const cap = clutchCap(w2, o.clutchN);
    const Fres = this._res();
    const Je = ENG.J;
    // 离合器：锁住时算需要多大的扭矩才能保持锁住，超过能力就打滑
    if (this.lock) {
      const di = 0;   // 换档带来的转速变化项影响小，忽略
      const Tc = (Te + Je * i * (iF / R) * Fres / M - Je * wb * di) / (Je * i * (iF / R) * kV / M + 1 / (i * CVT.etaB));
      if (Math.abs(Tc) > cap || cap <= 0) this.lock = false;
      else {
        this.Tc = Tc;
        let a = (Tc * kV - Fres) / M;
        if (this.v <= 0 && a < 0) a = 0;
        this.v = Math.max(0, this.v + a * h);
        this.n = i * this.v * iF / R / RPM;
      }
    }
    if (!this.lock) {
      const slip = w2 - wb;
      const Tc = cap * Math.sign(slip);
      this.Tc = Tc;
      const dw = (Te - Tc / (i * CVT.etaB)) / Je;
      let a = (Tc * kV - Fres) / M;
      if (this.v <= 0 && a < 0) a = 0;
      const w2n = (w + dw * h) / i, wbn = (this.v + a * h) * iF / R;
      this.v = Math.max(0, this.v + a * h);
      this.n = Math.max(0, (w + dw * h) / RPM);
      if (cap > 0 && Math.sign(w2n - wbn) !== Math.sign(slip) && this.v > 0) this.lock = true;
      this.slip = slip;
    } else this.slip = 0;
    if (!this.on) this.n = Math.max(0, this.n);
    this.T2 = Math.abs(this.Tc);
    // 变速
    if (o.mode === 'cent') {
      const f1 = F1(this.n, this.x, o.roll), f2 = F2(this.x, this.T2, o);
      this.f1 = f1; this.f2 = f2;
      this.x = clamp(this.x + 3.2 * (f1 - f2) / 1000 * h, 0, 1);
    } else {
      // 电控：电脑算出目标转速，电机去推动盘（推得有多快有上限）
      let xd = this.x;
      const vk = this.v * 3.6;
      if (o.mode === 'ecvtM') {
        const gears = [0, .3, .5, .66, .8, .91, 1];
        xd = gears[clamp(o.mgear, 1, 6)];
      } else {
        const nt = o.mode === 'ecvtS' ? 5200 + 2600 * thr : 3000 + 3800 * thr;
        this.nt = nt;
        if (this.lock && wb > 1) xd = xOfRatio(clamp(nt * RPM / wb, G.iMin, G.iMax));
        else xd = 0;
      }
      this.x = clamp(this.x + clamp(xd - this.x, -1.6 * h, 1.6 * h), 0, 1);
      this.f1 = this.f2 = 0;
    }
    this.t += h; this.dist += this.v * h;
    if (this.on) this.fuel += Math.max(0.08, powerKW(this.n, Math.max(0, Te - Ta)) / 0.27 / 43000) * h;   // g/s 近似：油耗率 ≈ 功率 / (效率 · 热值)
  }
  _res() {
    const v = this.v, M = this.M, a = Math.atan(this.o.slope);
    return M * CAR.g * (CAR.Crr * Math.cos(a) + Math.sin(a)) + 0.5 * CAR.rho * CAR.CdA * v * v;
  }
  _stepEV(h, thr) {
    const M = this.M, R = G.wheelR, i = this.o.evI || G.emI;
    const wm = this.v / R * i;
    const P = (this.o.evP || 6.0) * 1000, Tmax = this.o.evT || 26;
    let Tm = thr * Math.min(Tmax, P / Math.max(wm, 1));
    if (wm > (this.o.evMax || 11000) * RPM) Tm = 0;
    const F = Tm * i * 0.95 / R;
    let a = (F - this._res()) / M;
    if (this.v <= 0 && a < 0) a = 0;
    this.v = Math.max(0, this.v + a * h);
    this.n = wm / RPM; this.Te = Tm; this.t += h; this.dist += this.v * h; this.lock = true;
  }
  record() { this.trace.push([this.t, this.v * 3.6, this.n, this.x, this.lock ? 1 : 0]); }
}

/** 从静止满油门跑 T 秒，返回轨迹和 0–60 用时 */
export function launch(o, thr = 1, T = 16, dt = 0.02) {
  const r = new Ride(o);
  let t60 = null, t30 = null;
  r.record();
  for (let k = 0; k < T / dt; k++) {
    r.step(dt, thr);
    r.record();
    if (t30 === null && r.v * 3.6 >= 30) t30 = r.t;
    if (t60 === null && r.v * 3.6 >= 60) t60 = r.t;
  }
  return { tr: r.trace, t60, t30, vmax: r.v * 3.6, ride: r };
}

/** 稳态最高速：功率 = 阻力功率 */
export function topSpeed(o = {}) {
  const r = launch(o, 1, 60, 0.05);
  return r.vmax;
}

// ================================================================ 怠速停止
// 每等一次红灯，怠速每秒烧掉 qIdle 克油；重新起动多烧一点（ACG 直接带曲轴，起动很快）
export function idleStop({ stops = 12, wait = 30, qIdle = 0.075, restart = 0.25, minWait = 3 }) {
  const burned = stops * wait * qIdle;
  const saved = wait > minWait ? stops * (wait - minWait) * qIdle - stops * restart : 0;
  return { burned, saved: Math.max(0, saved), mlBurned: burned / 0.745, mlSaved: Math.max(0, saved) / 0.745 };
}

// ================================================================ 电动：扭矩—车速
export function evCurve(i, Tmax, PkW, nMax) {
  const out = [];
  for (let v = 0; v <= 110; v += 1) {
    const wm = v / 3.6 / G.wheelR * i;
    let T = Math.min(Tmax, PkW * 1000 / Math.max(wm, 1));
    if (wm > nMax * RPM) T = 0;
    out.push(T * i * 0.95 / G.wheelR);
  }
  return out;
}
