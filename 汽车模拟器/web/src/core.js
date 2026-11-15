// 汽车模拟器的仿真核心：发动机、液力变矩器、钢带 CVT、整车直线行驶。
// 只有数学，不碰页面；所有数字都从 ../../params.json 来（网页和自检用同一份）。
// 单位：内部用 SI（rad/s、N·m、m/s、kg），对外的读数换成 rpm、km/h、L/h。

export const RPM = 30 / Math.PI;                 // rad/s → rpm
const G = 9.81, RHO_AIR = 1.2;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** 分段线性查表，两头不外插 */
export function table(pts) {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    return pts[pts.length - 1][1];
  };
}

export const GEARS = ['P', 'R', 'N', 'D'];

export function makeCar(P) {
  const E = P.engine, C = P.cvt, V = P.vehicle, S = P.sim;

  // ---------------------------------------------------------------- 几何：钢带和锥轮
  const tan = Math.tan(C.wedge * Math.PI / 180);
  const beltLen = (r1, r2) => {
    const a = C.centre, ph = Math.asin((r2 - r1) / a);
    return 2 * a * Math.cos(ph) + (Math.PI + 2 * ph) * r2 + (Math.PI - 2 * ph) * r1;
  };
  const BELT = beltLen(C.r_min, C.r_max);
  /** 钢带长度不变：主动轮半径 → 从动轮半径 */
  const r2Of = (r1) => {
    let lo = 5, hi = 200;
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (beltLen(r1, m) < BELT) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const ratioLow = C.r_max / C.r_min, ratioHigh = r2Of(C.r_max) / C.r_max;
  /** 速比（主动轮转速 / 从动轮转速）→ 两个轮上钢带的半径，mm */
  const radii = (ratio) => {
    let lo = C.r_min, hi = C.r_max;                       // r1 越大速比越小
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (r2Of(m) / m > ratio) lo = m; else hi = m; }
    const r1 = (lo + hi) / 2;
    return { r1, r2: r2Of(r1) };
  };
  /** 可动锥盘离固定锥盘的距离（两个锥面顶点之间），mm */
  const sheaveGap = (r) => C.belt_w - 2 * r * tan;
  const final = (C.z_idler / C.z_out) * (C.z_ring / C.z_pinion);
  const disp = Math.PI / 4 * E.bore ** 2 * E.stroke * 4 / 1000;       // cc
  const rRoll = V.r_roll / 1000;
  /** 车速 1 km/h、速比 1 时主动轮的转速，rpm */
  const rpmPerKmh = (1 / 3.6) / rRoll * final * RPM;

  // ---------------------------------------------------------------- 发动机
  const tqWot = table(S.tq_wot);
  const ool = table(S.ool);
  const dragOf = (n) => S.drag0 + S.drag1 * n + S.acc;                 // 摩擦 + 泵气（全开时）+ 附件
  /** 负荷比例 lam（0…1）时曲轴输出的扭矩 */
  const brakeTq = (n, lam) => lam * (tqWot(n) + dragOf(n)) - dragOf(n) - S.pump_extra * (1 - lam);
  /** 要这么多输出扭矩，负荷比例得是多少 */
  const lamFor = (n, tq) => (tq + dragOf(n) + S.pump_extra) / (tqWot(n) + dragOf(n) + S.pump_extra);
  /** 喷油量 kg/s：缸内做的功（指示功）÷ 指示热效率 ÷ 热值 */
  const fuelRate = (n, lam) => Math.max(0, lam * (tqWot(n) + dragOf(n)) * (n / RPM) / (S.eta_ind * S.lhv));
  const pedalPower = (pedal) => S.p_max_kw * 1000 * Math.pow(clamp(pedal, 0, 1), S.pedal_exp);

  // ---------------------------------------------------------------- 变矩器
  /** 泵轮转速 n（rpm）、涡轮 / 泵轮转速比 sr → 泵轮吃掉的扭矩和扭矩放大倍数 */
  const converter = (n, sr) => {
    const cap = (n / S.tc_k0) ** 2;
    if (sr < 1) {
      const x = Math.max(sr, 0);
      return { tp: cap * (1 - x ** 3), tr: x < S.tc_couple ? S.tc_stall_ratio - (S.tc_stall_ratio - 1) * x / S.tc_couple : 1 };
    }
    return { tp: -0.6 * cap * (Math.min(sr, 2.5) ** 3 - 1), tr: 1 };    // 倒拖：涡轮比泵轮快，反过来带着发动机转
  };

  const mass = V.mass, mEff = mass + 4 * S.j_wheel / rRoll ** 2;
  const fTraction = S.mu * S.front_share * mass * G;
  const eta = S.eta_cvt * S.eta_final;

  function initial() {
    return {
      t: 0, gear: 'P', we: S.idle / RPM, wt: S.idle / RPM * 0.98, v: 0, ratio: ratioLow, lock: 0, lockOn: false,
      idleI: 0, cut: false, teLim: Infinity, fuel: 0, dist: 0,
      out: null,
    };
  }

  /** 换挡杆：车在动的时候不让进 P、不让前进 / 倒车互换。返回 '' 或者不让换的原因 */
  function shift(s, gear) {
    if (gear === s.gear) return '';
    const kmh = Math.abs(s.v) * 3.6;
    if (gear === 'P' && kmh > 2) return '车还在动，先停稳再挂 P';
    if (gear === 'R' && s.v * 3.6 > 4) return '车还在往前走，先停下再挂 R';
    if (gear === 'D' && s.v * 3.6 < -4) return '车还在倒，先停下再挂 D';
    s.gear = gear;
    return '';
  }

  /** 走一小步 dt 秒。inp = { pedal 0…1, brake 0…1, grade 坡度（0.05 = 5% 上坡） } */
  function step(s, inp, dt) {
    const pedal = clamp(inp.pedal || 0, 0, 1), brake = clamp(inp.brake || 0, 0, 1), grade = inp.grade || 0;
    const dir = s.gear === 'D' ? 1 : s.gear === 'R' ? -1 : 0;
    const kw = final / rRoll;                              // 车速 1 m/s 时从动轮的角速度
    const wSec = s.v * kw, wPri = wSec * s.ratio;
    if (dir) s.wt = dir * wPri / (dir < 0 ? S.r_reverse : 1);
    const n = s.we * RPM;

    // ---- 驾驶员要多少功率 → 变速箱电脑挑的目标转速
    const on = pedal > 0.005;
    const pDes = on ? pedalPower(pedal) : 0;
    const nTarget = on ? Math.max(ool(pDes / 1000), S.n_coast) : S.n_coast;

    // ---- 发动机：负荷比例
    let lam = 0, tcs = false;
    if (on) {
      const want = Math.min(pDes / Math.max(nTarget / RPM, s.we), tqWot(n));
      tcs = s.teLim < want;                                // 前轮抓不住了：收油
      lam = lamFor(n, Math.min(want, s.teLim));
    }
    const eIdle = S.idle - n;
    if (!on && Math.abs(eIdle) < 400) s.idleI = clamp(s.idleI + 0.25 * eIdle * dt, -10, 45);
    const lamIdle = clamp(lamFor(n, 0.10 * eIdle + s.idleI), 0, 0.5);
    if (!on && n > S.cut_on) s.cut = true;
    if (on || n < S.cut_off) s.cut = false;
    lam = s.cut ? 0 : clamp(Math.max(lam, lamIdle, S.lam_min), 0, 1);
    const limiter = n > S.limit;
    if (limiter) lam *= clamp((S.limit + 60 - n) / 60, 0, 1);
    const te = brakeTq(n, lam), ti = lam * (tqWot(n) + dragOf(n));
    const mf = fuelRate(n, lam);

    // ---- 变矩器 + 锁止离合器
    const sr = s.we > 1 ? s.wt / s.we : 0;
    const { tp, tr } = converter(n, sr);
    const lk = s.lock * S.lock_k, capC = s.lock * S.lock_cap;
    let weNew = (S.j_engine * s.we + dt * (te - tp) + dt * lk * s.wt) / (S.j_engine + dt * lk);
    let tc = lk * (weNew - s.wt);
    if (Math.abs(tc) > capC) {                             // 离合器压力还不够：按能传的最大扭矩滑着
      tc = Math.sign(tc) * capC;
      weNew = s.we + dt * (te - tp - tc) / S.j_engine;
    }
    weNew = Math.max(weNew, 300 / RPM);
    const tin = tr * tp + tc;                              // 进变速箱（涡轮轴）的扭矩

    // ---- 传到车轮
    const gr = s.ratio * final * (dir < 0 ? S.r_reverse : 1);
    let fDrive = dir * tin * gr * (tin >= 0 ? eta : 1 / eta) / rRoll;
    const fRaw = Math.abs(fDrive);
    // 前轮能传的力有上限。踩着刹车时驱动力是被刹车顶住的，不经过轮胎和地面，所以不算
    const held = brake > 0.05;
    s.teLim = !held && fRaw > 0.9 * fTraction && tin > 0 ? (tp + tc) * fTraction / fRaw : Infinity;
    if (!held && fRaw > fTraction) fDrive = Math.sign(fDrive) * fTraction;

    // ---- 整车
    const fAero = 0.5 * RHO_AIR * V.cd * V.area * s.v * Math.abs(s.v);
    const fGrade = mass * G * grade / Math.sqrt(1 + grade * grade);
    const fRoll = V.crr * mass * G;
    const fBrake = brake * V.brake_g * mass * G + (s.gear === 'P' ? 3 * mass * G : 0);
    const net = fDrive - fAero - fGrade, resist = fRoll + fBrake;
    let a, vNew;
    if (Math.abs(s.v) < 1e-4) {
      a = Math.abs(net) <= resist ? 0 : (net - Math.sign(net) * resist) / mEff;
      vNew = a * dt;
    } else {
      a = (net - Math.sign(s.v) * resist) / mEff;
      vNew = s.v + a * dt;
      if (vNew * s.v < 0) { vNew = 0; a = -s.v / dt; }     // 刹停：不会被刹车推着倒退
    }

    // ---- 涡轮（N / P 时和变速箱断开，自己转）
    if (!dir) s.wt = Math.max(0, s.wt + dt * (tin - 0.01 * s.wt - 0.3) / S.j_turbine);

    // ---- CVT：把主动轮转速往目标转速上靠，速比变化有快慢限制，车不动时变不了
    const vAbs = Math.abs(vNew);
    // 主动轮转速 = 车速 × kw × 速比。想让它在 0.3 s 左右靠到目标上，同时把车在加速这件事提前算进去（前馈），
    // 这样定油门加速时转速能稳稳停在目标上，不会一路拖着一截误差
    let rate;
    if (dir < 0) rate = (ratioLow - s.ratio) / 0.2;
    else if (vAbs > 0.3) rate = ((nTarget / RPM - vAbs * kw * s.ratio) / 0.3 / kw - s.ratio * a * Math.sign(vNew)) / vAbs;
    else rate = (ratioLow - s.ratio) / 0.2;
    rate = clamp(rate, -S.rate_up, S.rate_down) * clamp(vAbs / 0.8, 0, 1);
    const ratioNew = clamp(s.ratio + rate * dt, ratioHigh, ratioLow);

    // ---- 锁止离合器什么时候压紧
    const kmh = vAbs * 3.6;
    s.lockOn = dir === 1 && kmh > (s.lockOn ? S.lock_off_kmh : S.lock_on_kmh);
    s.lock = clamp(s.lock + clamp((s.lockOn ? 1 : 0) - s.lock, -dt / 0.25, dt / 0.7), 0, 1);

    // ---- 功率账（W）
    const pFuel = mf * S.lhv, pInd = ti * s.we, pShaft = te * s.we;
    const pTcLoss = Math.max(0, (tp + tc) * s.we - tin * s.wt);
    const pIn = dir ? tin * s.wt : 0, pWheel = fDrive * s.v;

    s.out = {
      n, nTarget, nTurbine: s.wt * RPM, nPri: wPri * RPM, nSec: wSec * RPM, kmh: s.v * 3.6, a,
      pedal, brake, lam, te, ti, tp, tc, tr, sr, tin, fDrive, fAero, fRoll, fGrade, fBrake: fBrake * (Math.abs(s.v) > 1e-4 ? 1 : 0),
      ratio: s.ratio, lock: s.lock, cut: s.cut, limiter, tcs, fuelRate: mf, lph: mf * 3600 / S.rho_fuel,
      pFuel, pInd, pShaft, pTcLoss, pIn, pWheel, pDes, dir,
      // 给三维用的角速度（rad/s，带方向）
      we: s.we, wt: s.wt, wPri, wSec,
    };
    s.fuel += mf * dt; s.dist += Math.abs(s.v) * dt;
    s.we = weNew; s.v = vNew; s.ratio = ratioNew; s.t += dt;
    return s.out;
  }

  return {
    P, tan, BELT, beltLen, r2Of, radii, sheaveGap, ratioLow, ratioHigh, final, disp, rRoll, rpmPerKmh, mass, mEff, fTraction, eta,
    tqWot, ool, dragOf, brakeTq, lamFor, fuelRate, pedalPower, converter, initial, shift, step,
  };
}

/** 钢带中心线（开口传动的外公切线）：按弧长取点。A0 / A1 是两根轴在 (y, z) 平面里的位置 */
export function beltPath(A0, A1, r1, r2) {
  const dy = A1[0] - A0[0], dz = A1[1] - A0[1], a = Math.hypot(dy, dz);
  const beta = Math.atan2(dz, dy), ph = Math.asin((r2 - r1) / a);
  const up = beta + Math.PI / 2 + ph, dn = beta - Math.PI / 2 - ph;     // 两条切线的法向
  const lStraight = a * Math.cos(ph), arc1 = (Math.PI + 2 * ph) * r2, arc0 = (Math.PI - 2 * ph) * r1;
  const total = 2 * lStraight + arc1 + arc0;
  const P0u = [A0[0] + r1 * Math.cos(up), A0[1] + r1 * Math.sin(up)], P1d = [A1[0] + r2 * Math.cos(dn), A1[1] + r2 * Math.sin(dn)];
  const tu = [Math.cos(up - Math.PI / 2), Math.sin(up - Math.PI / 2)];   // 上边直线段的走向（从主动轮到从动轮）
  const td = [-Math.cos(dn + Math.PI / 2), -Math.sin(dn + Math.PI / 2)]; // 下边直线段的走向（回主动轮）
  /** 弧长 s（mm）处的点：[y, z, 法向 y, 法向 z]，法向朝钢带外侧 */
  const at = (s) => {
    s = ((s % total) + total) % total;
    if (s < lStraight) return [P0u[0] + tu[0] * s, P0u[1] + tu[1] * s, Math.cos(up), Math.sin(up)];
    s -= lStraight;
    if (s < arc1) { const th = up - s / r2; return [A1[0] + r2 * Math.cos(th), A1[1] + r2 * Math.sin(th), Math.cos(th), Math.sin(th)]; }
    s -= arc1;
    if (s < lStraight) return [P1d[0] + td[0] * s, P1d[1] + td[1] * s, Math.cos(dn), Math.sin(dn)];
    s -= lStraight;
    const th = dn - s / r1;
    return [A0[0] + r1 * Math.cos(th), A0[1] + r1 * Math.sin(th), Math.cos(th), Math.sin(th)];
  };
  return { total, at };
}

/** 活塞销离曲轴中心的高度：曲柄半径 r、连杆长 l、曲柄离上止点的转角 a（弧度） */
export const pistonHeight = (r, l, a) => r * Math.cos(a) + Math.sqrt(l * l - (r * Math.sin(a)) ** 2);
/** 连杆摆角 */
export const rodAngle = (r, l, a) => Math.asin(r * Math.sin(a) / l);
/** 气门升程（0…1）：c 是这个缸在 720° 循环里的角度，0 = 压缩上止点（开始做功） */
export const VALVE = { ex: [130, 370], in: [350, 590] };
export function valveLift(side, c) {
  c = ((c % 720) + 720) % 720;
  const [a, b] = VALVE[side];
  if (c <= a || c >= b) return 0;
  return Math.sin(Math.PI * (c - a) / (b - a)) ** 2;
}
/** 这个缸现在在哪个冲程 */
export function stroke(c) {
  c = ((c % 720) + 720) % 720;
  return c < 180 ? '做功' : c < 360 ? '排气' : c < 540 ? '进气' : '压缩';
}

/** 一段自动驾驶：按脚本踩，返回每一步的记录。script(t, s) → { pedal, brake, gear?, grade? }，返回 null 就停 */
export function run(car, script, tMax, dt = 1 / 240, s = car.initial()) {
  const log = [];
  for (let i = 0; s.t < tMax; i++) {
    const inp = script(s.t, s);
    if (!inp) break;
    if (inp.gear) car.shift(s, inp.gear);
    const o = car.step(s, inp, dt);
    if (i % 12 === 0) log.push({ t: s.t, ...o });
  }
  return { s, log };
}
