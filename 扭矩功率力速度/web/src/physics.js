// 这一页所有的数都从这里算出来：纯函数，不碰页面。test_physics.mjs 拿它校验文案里写死的数字。
// 单位：力 N、扭矩 N·m、转速 rpm（转 / 分钟）、角速度 rad/s、速度 m/s、功率 W。

export const TAU = Math.PI * 2;
export const G = 9.81;              // 重力加速度 m/s²
export const RHO = 1.2;             // 空气密度 kg/m³（20 °C 左右，海平面）
export const K9549 = 60000 / TAU;   // kW = 扭矩 × rpm ÷ 9549.3
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const rad = (rpm) => rpm * TAU / 60;          // rpm → rad/s
export const rpm = (w) => w * 60 / TAU;              // rad/s → rpm
export const kmh = (v) => v * 3.6;
export const ms = (k) => k / 3.6;

/** 分段线性查表，两头不外插 */
export function table(pts) {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    }
    return pts[pts.length - 1][1];
  };
}

// ------------------------------------------------------------------ 第 1 步：扳手
export const torque = (F, r) => F * r;
export const BOLT = 110;            // 拧动这颗螺栓要多少 N·m（轿车轮毂螺栓常见的拧紧力矩在 100 N·m 上下）

// ------------------------------------------------------------------ 第 2 步：车轮
/** 转速（rpm）和半径（m）→ 车速 m/s */
export const wheelSpeed = (n, r) => rad(n) * r;

// ------------------------------------------------------------------ 第 3 步：吊东西
/** 吊着质量 m（kg）以速度 v（m/s）匀速往上：拉力、功率；卷筒半径 rd（m）上的扭矩和转速 */
export function hoist(m, v, rd) {
  const F = m * G, P = F * v, T = F * rd, w = v / rd;
  return { F, P, T, w, n: rpm(w), P2: T * w };
}

// ------------------------------------------------------------------ 第 4 步：一对齿轮
export const GEAR_ETA = 0.98;       // 一对齿轮的效率（常见 97%～99%）
export function gearPair(z1, z2, n1, T1, eta = GEAR_ETA) {
  const i = z2 / z1, n2 = n1 / i, T2 = T1 * i * eta;
  return { i, n2, T2, P1: T1 * rad(n1), P2: T2 * rad(n2) };
}

// ------------------------------------------------------------------ 例子车：抄自 汽车模拟器/params.json（vehicle / sim / cvt）
export const CAR = {
  mass: 1325, r: 0.305, cd: 0.40, area: 2.05, crr: 0.012,
  final: 5.895, low: 2.484, high: 0.403, eta: 0.87 * 0.97,
  mu: 0.9, front: 0.58, limit: 6500,
  tq: [[600, 70], [800, 96], [1500, 120], [2500, 133], [3500, 140], [4200, 142], [5000, 138], [6000, 128], [6500, 110], [6800, 60]],
  tcK0: 230, tcStall: 1.9, tcCouple: 0.85,
};
export const tqWot = table(CAR.tq);
/** 风阻 + 滚阻（N），v 是 m/s */
export const resist = (v, c = CAR) => 0.5 * RHO * c.cd * c.area * v * v + c.crr * c.mass * G;
/** 驱动轮能传的最大力（N）：摩擦系数 × 压在驱动轮上的重量 */
export const traction = (c = CAR) => c.mu * c.front * c.mass * G;
/** 发动机全开时，在 n1…n2 这段转速里能拿到的最大功率（W）和那个转速 */
export function bestPower(n1, n2) {
  let best = 0, at = n1;
  for (let k = 0; k <= 200; k++) { const n = n1 + (n2 - n1) * k / 200, p = tqWot(n) * rad(n); if (p > best) { best = p; at = n; } }
  return { P: best, n: at };
}
/** 车速 v（m/s）、速比 ratio 时发动机的转速（CVT 锁止，没有打滑） */
export const engineRpm = (v, ratio, c = CAR) => rpm(v / c.r * ratio * c.final);

/** 第 5 步：发动机停在某个转速上（CVT 帮它守住），车速 v 时车轮推地面的力 */
export function pushAt(v, n, c = CAR) {
  const P = tqWot(n) * rad(n) * c.eta;
  return { P, F: v > 0.3 ? P / v : Infinity };
}

/** 液力变矩器：泵轮转速 n（rpm）、涡轮转速 nt → 泵轮吃掉的扭矩、扭矩放大倍数（和汽车模拟器的 core.js 同一个模型） */
export function converter(n, nt, c = CAR) {
  const sr = clamp(nt / n, 0, 1), cap = (n / c.tcK0) ** 2;
  return { tp: cap * (1 - sr ** 3), tr: sr < c.tcCouple ? c.tcStall - (c.tcStall - 1) * sr / c.tcCouple : 1 };
}

/** 第 9 步：油车（发动机 + 变矩器 + CVT）在车速 v 时车轮上能拿到的最大推力和是谁在限制它 */
export function engineEnvelope(v, c = CAR) {
  const tr = traction(c);
  // CVT 锁止：速比在 low…high 里随便挑，发动机转速在 1000…断油转速 之间
  const n1 = engineRpm(v, c.high, c), n2 = engineRpm(v, c.low, c);
  const lo = Math.max(n1, 1000), hi = Math.min(n2, c.limit);
  let Flock = 0, why = '';
  if (hi > lo && v > 0.05) {
    const b = bestPower(lo, hi);
    Flock = b.P * c.eta / v;
    why = n2 < 5950 ? '最低挡封顶' : '贴着功率线';
  }
  // 变矩器打滑：速比停在最低挡，发动机转到泵轮吃掉的扭矩 = 发动机扭矩
  const nt = engineRpm(v, c.low, c);
  let Ftc = 0;
  if (nt < c.limit) {
    let a = Math.max(nt, 300) + 1, b = 6800;
    for (let k = 0; k < 60; k++) { const m = (a + b) / 2; if (tqWot(m) > converter(m, nt, c).tp) a = m; else b = m; }
    const n = (a + b) / 2, cv = converter(n, nt, c);
    Ftc = cv.tr * cv.tp * c.low * c.final * c.eta / c.r;
  }
  let F = Math.max(Flock, Ftc);
  if (Ftc > Flock) why = '变矩器在放大扭矩';
  if (F > tr) { F = tr; why = '抓地力封顶'; }
  return { F, Flock, Ftc, why };
}

// ------------------------------------------------------------------ 第 6 步：发动机吸多少空气
export const AFR = 14.7;            // 汽油完全烧干净要的空燃比（kg 空气 : kg 油）
export const LHV = 43e6;            // 汽油热值 J/kg
export const HEAT_PER_AIR = LHV / AFR;   // 每 kg 空气能陪着烧出多少热：约 2.9 MJ
/** 充气效率：缸每次能吸满几成（估算的曲线：低转速气流慢，高转速气门开的时间太短） */
export const VE = [[1000, 0.78], [2000, 0.85], [3000, 0.91], [4000, 0.95], [5000, 0.94], [6000, 0.90], [6500, 0.85], [7000, 0.76]];
export const ve = table(VE);
/** disp 排量 L，n 转速 rpm，thr 节气门（0…1，本页简化成按比例放空气），boost 进气压力是大气压的几倍，eta 热效率 */
export function engineAir({ disp, n, thr = 1, boost = 1, eta = 0.34, vol = ve(n) }) {
  const vs = disp / 1000 * n / 120;            // 每秒扫过的体积 m³/s：四冲程两圈吸一次
  const air = vs * vol * RHO * boost * thr;    // 每秒吸进的空气 kg/s
  const fuel = air / AFR, heat = fuel * LHV, P = heat * eta;
  return { vs, vol, air, fuel, heat, P, T: n > 0 ? P / rad(n) : 0, loss: heat - P };
}

// ------------------------------------------------------------------ 第 7、8 步：电机（理想化：不算损失、不算磁饱和）
/** U 电池电压，I 最大电流，k 扭矩常数（N·m / A，也等于每 rad/s 产生的反电动势 V），n 转速 rpm，weak 有没有弱磁 */
export function motor({ U, I, k, n, weak = true, nMax = 16000 }) {
  const w = rad(n), Tmax = k * I, wb = U / k, nb = rpm(wb), Pmax = U * I;
  let T;
  if (n > nMax) T = 0;
  else if (w <= wb) T = Tmax;
  else if (weak) T = Pmax / w;
  else T = Tmax * Math.max(0, 1 - (w - wb) / (0.12 * wb));    // 不弱磁：反电动势一超过电池电压，电流就压不进去（本页简化成很快掉到零）
  return { T, P: T * w, Tmax, nb, Pmax, emf: k * w, I: T / k };
}
/** 电机经过齿比 gear 带车轮：车速 v 时车轮上的推力 */
export function evPush(v, { U, I, k, gear, r, eta = 1, nMax = 16000 }) {
  const n = rpm(v / r * gear);
  const m = motor({ U, I, k, n, nMax });
  return { F: m.T * gear * eta / r, n, T: m.T };
}

// 第 8 步的电动车（虚构）：1600 kg，后驱
export const EV = { mass: 1600, r: 0.305, cd: 0.28, area: 2.3, crr: 0.010, mu: 0.9, front: 0.5 };

// 第 9 步：和例子车一样重、车轮上最大功率一样的电动版
export const EV9 = { Tmax: 250, nMax: 14000, eta: 0.97 };
export function ev9({ gear, v }) {
  const Pw = bestPower(1000, CAR.limit).P * CAR.eta;      // 油车车轮上的最大功率
  const Pm = Pw / EV9.eta, k = 1, I = EV9.Tmax, U = Pm / I;  // 用 k = 1 只是把“扭矩上限 × 基速 = 功率”凑出来
  return { ...evPush(v, { U, I, k, gear, r: CAR.r, eta: EV9.eta, nMax: EV9.nMax }), Pw, nb: rpm(U / k) };
}
