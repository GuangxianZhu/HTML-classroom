// 物理核心：行星锥盘无级变速器（MB / UDL 型）的几何、转速、受力、打滑和输出特性。
// 页面里所有数字都从这里算；Blender 脚本读同一份 params.json。
//
// 结构（按 MB 型公开说明）：
//   主动轮 + 压盘（跟输入轴一起转，被碟簧夹紧）夹住行星锥盘的内侧；
//   定环 + 调速凸轮环（都不转）夹住行星锥盘的外侧；
//   行星锥盘的轴装在行星架的径向滑槽里（滑块轴承），行星架就是输出。
// 行星锥盘 = 两个圆锥底对底，“中间厚、边上薄”：厚度 t(ρ) = t_center − 2ρ·tanα（ρ 是离盘心的距离）。
// 只有这种凸的盘，主动轮和外环的圆形刃口才能各在一个点上贴住它（凹的盘会在刃口圆上到处干涉）。
//
// 调速链：凸轮环把外夹缝收窄 → 外侧只能夹在盘更薄（离盘心更远）的地方 → 盘被挤向内（偏心 e 变小）
//        → 内侧接触点离盘心更近（ρa 变小），外侧更远（ρb 变大）→ 输出变快；
//        内侧接触点挪到盘更厚的地方，把主动轮和压盘撑开，碟簧压得更紧。
// 反过来松开外夹缝，碟簧通过楔面把盘推向外 → 变慢。

import P from '../../params.json' with { type: 'json' };

const g = P.geom;
export const PARAMS = P;
export const DEG = Math.PI / 180;
export const ALPHA = g.alpha_deg * DEG;
export const TAN_A = Math.tan(ALPHA);
export const N_IN = P.motor.n_in;
export const D = g.R_ring - g.r_sun;                 // 两个接触圆之间的径向距离
export const K = g.R_ring / g.r_sun;

// 盘厚：离盘心 ρ 处的厚度（mm）
export const thick = (rho) => g.t_center - 2 * rho * TAN_A;

// Willis 项 T = (R/r)·(ρa/ρb)；速比 i = n_in / n_out = 1 + T
export const willis = (e) => K * (e - g.r_sun) / (g.R_ring - e);
// 反过来：给定 T 求偏心 e
export const eOfT = (T) => g.r_sun + D * T / (K + T);

export const E_FAST = eOfT(g.T_fast);                // 手轮 0：最快
export const E_SLOW = eOfT(g.T_slow);                // 手轮 1：最慢
export const GIN_MIN = thick(E_SLOW - g.r_sun);      // 内夹缝最窄（最慢挡，碟簧最松）
export const GOUT_MIN = thick(g.R_ring - E_FAST);    // 外夹缝最窄（最快挡）

// u ∈ [0,1]：手轮位置（0 = 最快，1 = 最慢）。凸轮升程和手轮转角成正比，外夹缝线性变化，所以 e 和 u 成线性
export function geomAt(u) {
  const uu = Math.min(1, Math.max(0, u));
  const e = E_FAST + (E_SLOW - E_FAST) * uu;
  const ra = e - g.r_sun, rb = g.R_ring - e;
  const T = willis(e);
  const gIn = thick(ra), gOut = thick(rb);
  const nOutIdeal = N_IN / (1 + T);
  return {
    u: uu, e, ra, rb, T, i: 1 + T,
    gIn, gOut,
    springComp: gIn - GIN_MIN,                       // 碟簧比最松（最慢挡）时多压的量（mm）
    camOpen: gOut - GOUT_MIN,                        // 外夹缝比最快挡宽了多少（mm）
    nOutIdeal,
    spinRel: (N_IN - nOutIdeal) * g.r_sun / ra,      // 行星盘相对行星架的自转（r/min）
  };
}

// 手轮位置 ↔ 输出转速（理想、不计蠕滑）
export function uOfN(nOut) {
  const T = N_IN / nOut - 1;
  return (eOfT(T) - E_FAST) / (E_SLOW - E_FAST);
}

const L = P.load;
// 碟簧力（N）
export const springForce = (gm) => L.spring_F0_N + L.spring_k_N_per_mm * gm.springComp;

// 离心力（N）：每个行星盘随行星架公转
export function centrifugal(e_mm, nOut) {
  const w = nOut * 2 * Math.PI / 60;
  return L.planet_mass_kg * (e_mm / 1000) * w * w;
}

// 电机能给的最大输出扭矩（N·m）：输入扭矩到额定为止
export const motorLimit = (gm, eta = L.eta_other) => P.motor.T_rated_Nm * (1 + gm.T) * eta;

// 受力：Tout 为输出端负载扭矩（N·m）。opts 可以覆盖 mu、碟簧力、是否计离心力
export function solve(u, Tout = 0, opts = {}) {
  const gm = geomAt(u);
  const mu = opts.mu ?? L.mu;
  const n = g.n_planet;
  const Fs = opts.springOverride ?? springForce(gm);
  const Na = Fs / (n * Math.cos(ALPHA));             // 内侧每个接触点的正压力（每个盘两面各一个）
  const Fcf = opts.noCentrifugal ? 0 : centrifugal(gm.e, gm.nOutIdeal);
  // 盘的径向力平衡：内夹把盘往外推、外夹往里推、离心力往外 → 外侧正压力 = 内侧 + 离心那份
  const Nb = Na + Fcf / (2 * Math.sin(ALPHA));
  const eM = gm.e / 1000, raM = gm.ra / 1000, rbM = gm.rb / 1000, DM = D / 1000;
  // 每个盘：内外切向力之和 × e = 输出扭矩 / n；盘自转平衡 Fta·ρa = Ftb·ρb
  const T = Math.max(0, Tout);
  const Fsum = T / (n * eM);
  const Fta = Fsum * rbM / DM, Ftb = Fsum * raM / DM;
  const capA = 2 * mu * Na, capB = 2 * mu * Nb;      // 两个面各给 μN
  const ua = Fta / capA, ub = Ftb / capB;
  const U = Math.max(ua, ub);
  const TcapA = capA * n * eM * DM / rbM, TcapB = capB * n * eM * DM / raM;
  const Tcap = Math.min(TcapA, TcapB);
  const critical = TcapA <= TcapB ? 'inner' : 'outer';
  const Tmotor = motorLimit(gm);
  const Trated = Math.min(Tcap / L.safety, Tmotor);
  // 蠕滑：牵引力用得越满滑得越多（弹性蠕滑，几个百分点）；超过 1 就是整体打滑
  const creep = L.creep_at_limit * Math.min(1, U);
  const slipping = U > 1;
  const gross = slipping ? Math.min(0.85, 0.15 + 0.5 * (U - 1)) : 0;
  const nOut = gm.nOutIdeal * (1 - creep) * (1 - gross);
  const eta = (1 - creep) * L.eta_other;
  const Tin = T / (1 + gm.T) / L.eta_other;          // 输入轴要出的扭矩（打滑时没有意义）
  const Pout = T * nOut * 2 * Math.PI / 60;
  const Pin = Tin * N_IN * 2 * Math.PI / 60;
  return {
    ...gm, mu, Fs, Na, Nb, Fcf, Fta, Ftb, ua, ub, U, critical, Tcap, Tmotor, Trated,
    limitBy: Tcap / L.safety < Tmotor ? 'friction' : 'motor',
    creep, slipping, nOut, eta, Pout, Pin, Tin,
    motorLoad: Tin / P.motor.T_rated_Nm,
    camAxial: n * Nb * Math.cos(ALPHA),             // 外侧两个环被撑开的轴向力（N），凸轮要顶住它
  };
}

// 输出特性曲线：扫手轮
export function characteristic(opts = {}, N = 80) {
  const out = [];
  for (let k = 0; k <= N; k++) {
    const s = solve(k / N, 0, opts);
    const w = s.nOutIdeal * 2 * Math.PI / 60;
    out.push({ u: k / N, n: s.nOutIdeal, Tfric: s.Tcap / L.safety, Tmotor: s.Tmotor, Trated: s.Trated, Tcap: s.Tcap,
      P: s.Trated * w, Fs: s.Fs, limitBy: s.limitBy });
  }
  return out;
}

// 两个摩擦轮（第一章）：主动轮半径 r1、从动轮 r2（mm）、压紧力 N、负载扭矩 T2
export function wheelPair({ r1, r2, N, mu, T2, n1 }) {
  const Ft = T2 / (r2 / 1000);
  const cap = mu * N;
  const U = Ft / cap;
  const slip = U > 1 ? Math.min(0.9, 0.2 + 0.6 * (U - 1)) : 0.03 * U;
  return { Ft, cap, U, n2: n1 * r1 / r2 * (1 - slip), n2Ideal: n1 * r1 / r2, slipping: U > 1, T2max: cap * r2 / 1000 };
}

// 行星机构（第二章）：(ωs − ωc)·r·ρb = −(ωr − ωc)·R·ρa  →  ωc = (ωs + T·ωr)/(1 + T)
export const carrierSpeed = (ws, wr, T) => (ws + T * wr) / (1 + T);

export const TURNS = P.handwheel.turns;
