// 飞度 e:HEV 的能量模型。全部是纯函数，网页和自检脚本共用。
// 官方数字：发动机 78 kW / 127 N·m，驱动电机 90 kW / 253 N·m，变速比 2.454（电机）/ 0.805（发动机），减速比 3.423，
// 锂离子 48 个单体。其余系数（风阻、损耗、电池容量、发动机效率图）是按同级车的典型量级取的，只保证量级。

export const PI = Math.PI;
export const G0 = 9.81;
export const rpm2rad = (n) => n * PI / 30;
export const rad2rpm = (w) => w * 30 / PI;
export const kmh = (v) => v * 3.6;

export const CAR = {
  m: 1270,            // kg：车重约 1200 + 1 人
  mEq: 1270 * 1.04,   // 计入车轮、电机转动惯量
  Crr: 0.0095,
  CdA: 0.70,          // m²（Cd ≈ 0.32 × 迎风面积 ≈ 2.2，本页假设）
  rho: 1.2,
  rw: 0.297,          // 轮胎滚动半径 m
  Gm: (65 / 19) * (54 / 22),   // 电机 → 车轮 8.397（官方 2.454 × 3.423 = 8.400）
  Ge: (65 / 19) * (54 / 67),   // 发动机 → 车轮 2.757（官方 0.805 × 3.423 = 2.756）
  Gg: 2.0,            // 发电机 / 发动机（示意）
  etaMesh: 0.985,     // 每级齿轮
  Paux: 300,          // W：12 V 用电（灯、电脑、风扇）
  etaDcdc: 0.92,
};

export const ENG = {
  Vd: 1.496e-3, nMin: 1000, nMax: 6400, Pmax: 78e3, LHV: 43.0e6, rhoF: 0.745,
  tq: [[1000, 92], [1500, 101], [2000, 108], [3000, 117], [4000, 124], [4500, 127], [5000, 127], [5500, 124], [6200, 120], [6400, 116]],
};

// 电机损耗系数：铜损 a·T²、永磁铁损 b·ω^1.5、风摩 c·ω²、逆变器在开关时的谐波损耗 h·ω、杂散 k·|P|
export const MOT = { Pmax: 90e3, Tmax: 253, nMax: 13300, a: 0.070, b: 0.037, c: 0.00010, h: 0.50, k: 0.015, wb: 4000 * Math.PI / 30, fw: 0.0047 };
export const GEN = { Pmax: 78e3, Tmax: 160, nMax: 13000, a: 0.090, b: 0.035, c: 0.00008, h: 0.50, k: 0.015, wb: 9000 * Math.PI / 30, fw: 0.0047 };
export const BAT = { cells: 48, R: 0.065, kWh: 1.0, PdisMax: 30e3, PchgMax: 30e3, socLo: 0.30, socHi: 0.80 };

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerpTab = (tab, x) => {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) {
    const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return tab[tab.length - 1][1];
};

// ---------------------------------------------------------------- 车辆
/** 行驶阻力 N。grade = 坡度（tan），v m/s */
export function roadForce(v, grade = 0) {
  const th = Math.atan(grade);
  return CAR.m * G0 * (CAR.Crr * Math.cos(th) + Math.sin(th)) + 0.5 * CAR.rho * CAR.CdA * v * v;
}
export const wheelW = (v) => v / CAR.rw;
/** 直驱时发动机转速 rpm（只由车速决定） */
export const lockRpm = (v) => rad2rpm(wheelW(v) * CAR.Ge);
export const motorRpm = (v) => rad2rpm(wheelW(v) * CAR.Gm);
export const rpmPerKmh = rad2rpm(CAR.Ge / CAR.rw / 3.6);

// ---------------------------------------------------------------- 发动机
export const engTmax = (n) => lerpTab(ENG.tq, n);
/** 有效热效率 η_b(n, T)：平均有效压力模型 + 摩擦 + 泵气 + 低速爆震推迟点火 + 高速大负荷加浓 */
export function engEta(n, T) {
  if (T <= 0 || n < 500) return 0;
  const bmep = 4 * PI * T / ENG.Vd;                 // Pa
  const x = clamp(T / engTmax(n), 0, 1.2);
  const k = n / 1000;
  const fmep = (0.80 + 0.12 * k + 0.040 * k * k) * 1e5;
  const pmep = 0.30e5 * Math.pow(1 - Math.min(x, 1), 1.6);
  let ig = 0.455 - 0.035 * Math.pow((n - 2600) / 2400, 2);
  ig -= 0.05 * x * x * x * Math.max(0, (2200 - n) / 1200);            // 低速大负荷：爆震，推迟点火
  if (x > 0.85 && n > 4000) ig -= 0.06 * (x - 0.85) / 0.15 * (n - 4000) / 2400;   // 高速满负荷：加浓护催化器
  return Math.max(0, ig * bmep / (bmep + fmep + pmep));
}
/** 燃油功率 W */
export const fuelPower = (n, T) => { const P = rpm2rad(n) * T; return P <= 0 ? 0 : P / Math.max(engEta(n, T), 0.05); };
/** g/s */
export const fuelRate = (n, T) => fuelPower(n, T) / ENG.LHV * 1000;

/** 最优工作线：给定发动机功率，找效率最高的 (n, T)。串联模式下发动机就跑在这条线上 */
const OOL = [];
for (let P = 500; P <= 78000; P += 250) {
  let best = null;
  for (let n = ENG.nMin; n <= ENG.nMax; n += 25) {
    const T = P / rpm2rad(n);
    if (T > engTmax(n) * 0.97) continue;
    const e = engEta(n, T);
    if (!best || e > best.eta) best = { n, T, eta: e, P };
  }
  if (best) OOL.push(best);
}
export function oolPoint(P, nCap = ENG.nMax) {
  if (P <= 500) return { ...OOL[0], P: Math.max(P, 0) };
  const i = clamp(Math.round((P - 500) / 250), 0, OOL.length - 1);
  const o = OOL[i];
  let n = o.n;
  if (n > nCap) {        // 低速时为了安静，发动机转速有上限：在上限以内重新找最好的点
    let best = null;
    for (let m = ENG.nMin; m <= nCap; m += 25) {
      const T = P / rpm2rad(m);
      if (T > engTmax(m) * 0.97) continue;
      const e = engEta(m, T);
      if (!best || e > best.e) best = { m, e };
    }
    if (best) n = best.m;
  }
  const T = P / rpm2rad(n);
  return { n, T, eta: engEta(n, T), P };
}
/** 低速时允许的发动机转速上限（车外车内噪音要和车速相称）。本页假设，本田的真实标定没有公开 */
export const nvhCap = (v) => 1500 + 28 * v * 3.6;
export const START_PENALTY_J = 30e3;   // 每次起动发动机额外耗的燃油能量（起动、暖催化器、过渡加浓），本页假设
export const BUF_WINDOW = 0.10;        // 间歇模式每个循环用掉的电池电量（占容量）
export const OOL_TABLE = OOL;
/** 发动机最高效率点（全图） */
export const ENG_BEST = OOL.reduce((a, b) => (b.eta > a.eta ? b : a));

// ---------------------------------------------------------------- 电机、逆变器、电池
/** 电机损耗 W。on=false 表示逆变器关断、电机零电流空转：只剩永磁体造成的铁损和风摩（磁铁一直有磁场，躲不掉） */
export const machLoss = (M, w, T, on = true) => {
  const aw = Math.abs(w);
  const base = M.b * Math.pow(aw, 1.5) + M.c * w * w;
  const fw = M.fw * Math.max(0, aw - M.wb) ** 2;     // 高速弱磁：要加负 d 轴电流压住反电动势，即使扭矩很小也有铜损
  return on ? base + M.a * T * T + M.h * aw + M.k * Math.abs(w * T) + fw : base;
};
/** 电机轴功率 P_mech（>0 电动，<0 发电）→ 交流侧电功率 */
export function machElec(M, w, T) {
  const Pm = w * T;
  return Pm + machLoss(M, w, T);
}
export const invLoss = (P, on = true) => (on ? 0.015 * Math.abs(P) + 120 : 15);
export const vcuLoss = (P) => (Math.abs(P) < 1 ? 0 : 0.012 * Math.abs(P) + 40);
export const motTmax = (n) => Math.min(MOT.Tmax, MOT.Pmax / Math.max(rpm2rad(n), 1));

export const batOcv = (soc) => BAT.cells * (3.45 + 0.35 * soc);
export const batWh = BAT.kWh * 1000;
/** 电池端功率 P（>0 放电）→ 化学能变化率 W（含内阻损耗） */
export function batChem(P, soc) {
  const V = batOcv(soc), R = BAT.R;
  const disc = V * V - 4 * R * P;
  if (disc <= 0) return P * 2;
  const I = (V - Math.sqrt(disc)) / (2 * R);
  return V * I;
}

// ---------------------------------------------------------------- 稳态：一种速度下三条路各花多少油
/** 车轮功率 → 驱动电机直流侧需求 W（含齿轮、电机、逆变器） */
export function motorDcDemand(v, Fw) {
  const w = wheelW(v) * CAR.Gm;
  const eta2 = CAR.etaMesh * CAR.etaMesh;
  const T = Fw >= 0 ? Fw * CAR.rw / CAR.Gm / eta2 : Fw * CAR.rw / CAR.Gm * eta2;
  const Pac = machElec(MOT, w, T);
  return { Pdc: Pac + invLoss(Pac), w, T, Pac, loss: machLoss(MOT, w, T) };
}
const auxDc = () => CAR.Paux / CAR.etaDcdc;

/** 发动机给发电机输入 P_e，发电机直流侧能送出多少（含齿轮、发电机、逆变器）。n 由最优工作线定 */
export function genChain(Pe, nOverride, nCap) {
  const op = nOverride ? { n: nOverride, T: Pe / rpm2rad(nOverride) } : oolPoint(Pe, nCap);
  const wg = rpm2rad(op.n) * CAR.Gg;
  const Pin = Pe * CAR.etaMesh;
  const Tg = Pin / wg;                       // 发电机吸收的扭矩
  const loss = machLoss(GEN, wg, Tg);
  const Pac = Pin - loss;
  const Pdc = Pac - invLoss(Pac);
  return { Pdc, op, wg, Tg, genLoss: loss };
}
/** 想要直流侧 Pdc，发动机要出多少功率（反解 genChain） */
export function engineForDc(Pdc, nCap) {
  let Pe = Pdc / 0.88 + 300;
  for (let i = 0; i < 8; i++) {
    const g = genChain(Pe, null, nCap);
    Pe += (Pdc - g.Pdc) / 0.92;
    Pe = clamp(Pe, 300, ENG.Pmax);
  }
  return { Pe, ...genChain(Pe, null, nCap) };
}

/** 串联、发动机实时跟随负荷 */
export function seriesFollow(v, grade = 0) {
  const Fw = roadForce(v, grade);
  const m = motorDcDemand(v, Fw);
  const D = m.Pdc + auxDc();
  const g = engineForDc(D, nvhCap(v));
  const fuel = fuelPower(g.op.n, g.op.T);
  return { ok: g.Pe < ENG.Pmax * 0.98, fuel, Pe: g.Pe, n: g.op.n, T: g.op.T, eta: engEta(g.op.n, g.op.T), D, Pw: Fw * v, m, g };
}

/** 直驱：发动机转速锁死在车速上，电机零扭矩空转（还有铁损），发电机只发 12 V 那点电 */
export function direct(v, grade = 0, Pchg = 0) {
  const Fw = roadForce(v, grade);
  const n = lockRpm(v), we = rpm2rad(n);
  const wm = wheelW(v) * CAR.Gm;
  const eta2 = CAR.etaMesh * CAR.etaMesh;
  const Pmot = machLoss(MOT, wm, 0, false);                       // 电机零电流空转的拖累（机械功率，来自车轮侧）
  const Pwheel = Fw * v;
  const Pdrive = (Pwheel + Pmot) / eta2;                          // 发动机 → 车轮这条路要送的功率
  // 发电机：发 12 V 用电 + 充电功率
  const wg = we * CAR.Gg;
  const Pdc = auxDc() + Pchg;
  const Tg = Pdc > 0 ? (Pdc + invLoss(Pdc)) / wg : 0;
  const Pgen = Pdc > 0 ? (Pdc + invLoss(Pdc) + machLoss(GEN, wg, Tg)) / CAR.etaMesh : machLoss(GEN, wg, 0, false) / CAR.etaMesh;
  const Pe = Pdrive + Pgen;
  const T = Pe / we;
  const ok = n >= 1050 && T <= engTmax(n) * 0.97 && Pwheel > 0;
  const fuel = ok ? fuelPower(n, T) : NaN;
  return { ok, fuel, Pe, n, T, eta: ok ? engEta(n, T) : 0, Pw: Pwheel, Pmot, Pgen, Pdrive };
}

/** 串联 + 电池缓冲：发动机在高效功率 Pon 下开一会儿给电池充电，再熄火纯电跑一会儿，循环 */
export function seriesBuffer(v, grade = 0, PonFixed) {
  const Fw = roadForce(v, grade);
  const m = motorDcDemand(v, Fw);
  const D = m.Pdc + auxDc();
  if (D <= 0) return { ok: false };
  const soc = 0.55;
  const cap = nvhCap(v);
  const tryPon = (Pe) => {
    const g = genChain(Pe, null, cap);
    const S = g.Pdc - D;                                    // 富余电力，进电池
    if (S <= 200) return null;
    const Sb = S - vcuLoss(S);
    const stored = -batChem(-Sb, soc);                      // 存进化学能
    const drain = batChem(D + vcuLoss(D), soc);             // 熄火时电池放出的化学能
    const f = drain / (stored + drain);                     // 开机时间占比
    const E = BUF_WINDOW * batWh * 3600;
    const period = E / stored + E / drain;                  // 一个“充—放”循环多少秒
    const fuel = f * fuelPower(g.op.n, g.op.T) + START_PENALTY_J / period;
    return { fuel, f, Pe, n: g.op.n, T: g.op.T, eta: engEta(g.op.n, g.op.T), S, stored, drain, g, period };
  };
  let best = null;
  if (PonFixed) best = tryPon(PonFixed);
  else for (let Pe = 4000; Pe <= 45000; Pe += 500) {
    const r = tryPon(Pe);
    if (r && (!best || r.fuel < best.fuel)) best = r;
  }
  if (!best) return { ok: false };
  return { ok: true, ...best, D, Pw: Fw * v, m };
}

/** 直驱 + 顺便充电：离合器合着，把发动机负荷加到这个转速下更高效的扭矩，多出来的功率让发电机存进电池；
 *  存够了就分开离合器、熄火纯电，电用完再起动、同步、合上。和 seriesBuffer 一样按“开机占比”折算平均油耗 */
export function directBuffer(v, grade = 0) {
  const base = direct(v, grade, 0);
  if (!base.ok) return { ok: false };
  const n = base.n, we = rpm2rad(n);
  const Fw = roadForce(v, grade);
  const m = motorDcDemand(v, Fw);
  const D = m.Pdc + auxDc();
  const soc = 0.55;
  const E = BUF_WINDOW * batWh * 3600;
  let best = null;
  const Tmax = engTmax(n) * 0.95;
  for (let T = base.T + 4; T <= Tmax; T += 2) {
    const Pe = T * we;
    const surplus = Pe - base.Pe;                       // 交给发电机的机械功率
    const wg = we * CAR.Gg;
    const Pin = surplus * CAR.etaMesh, Tg = Pin / wg;
    const Pac = Pin - machLoss(GEN, wg, Tg);
    const Pdc = Pac - invLoss(Pac);
    const Sb = Pdc - vcuLoss(Pdc);
    if (Sb <= 200) continue;
    const stored = -batChem(-Sb, soc);
    const drain = batChem(D + vcuLoss(D), soc);
    const f = drain / (stored + drain);
    const period = E / stored + E / drain;
    const fuel = f * fuelPower(n, T) + START_PENALTY_J / period;
    if (!best || fuel < best.fuel) best = { ok: true, fuel, f, n, T, Pe, eta: engEta(n, T), surplus, stored, drain, period, D, Pw: Fw * v };
  }
  return best || { ok: false };
}

/** L/100km */
export const l100 = (fuelW, v) => (v <= 0.1 || !isFinite(fuelW) ? NaN : fuelW / ENG.LHV / ENG.rhoF / v * 1e5);

/** 一个车速下 ECU 会选哪条路（比较稳态油耗） */
export function bestAt(v, grade = 0) {
  const s = seriesFollow(v, grade), d = direct(v, grade), b = seriesBuffer(v, grade), db = directBuffer(v, grade);
  const c = [['series', s.fuel], ['direct', d.ok ? d.fuel : Infinity], ['buffer', b.ok ? b.fuel : Infinity], ['dbuf', db.ok ? db.fuel : Infinity]];
  c.sort((a, z) => a[1] - z[1]);
  return { pick: c[0][0], s, d, b, db };
}

// ---------------------------------------------------------------- 试驾：带控制逻辑的实时仿真
export const MODE_CN = { EV: 'EV 纯电', HYB: '混动（发动机发电）', ENG: '发动机直驱', REGEN: '能量回收', EBRK: '回收 + 发电机拖发动机' };

export function makeDrive() {
  return {
    t: 0, v: 0, soc: 0.55, mode: 'EV', eng: false, clutch: 'open', nE: 0, nTarget: 0,
    fuelG: 0, distM: 0, Fw: 0, Pw: 0, Pbat: 0, Pe: 0, Pmot: 0, Pgen: 0, Pfr: 0, fuelGs: 0, onT: 0, offT: 99, lockT: 0, iv: 0,
    th: { W: 0, I: 0 }, ecuWhy: '',
  };
}

/** 驾驶员力需求 → 选模式 → 分配功率 → 积分。cmd = { pedal 0..1, brake 0..1, cruise null|km/h, grade, forceMode } */
export function driveStep(S, cmd, dt) {
  const v = S.v, grade = cmd.grade || 0;
  const Fres = roadForce(v, grade);
  const nm = motorRpm(v);
  const FmotMax = motTmax(nm) * CAR.Gm * CAR.etaMesh ** 2 / CAR.rw;
  // 驾驶员
  let Freq;
  if (cmd.cruise != null) {
    const e = cmd.cruise / 3.6 - v;
    S.iv = clamp(S.iv + e * dt, -30, 30);
    Freq = Fres + CAR.mEq * (0.9 * e + 0.08 * S.iv);
    Freq = clamp(Freq, -0.35 * CAR.m * G0, FmotMax);
  } else {
    Freq = cmd.pedal * FmotMax - cmd.brake * 0.8 * CAR.m * G0;
    if (cmd.pedal < 0.01 && cmd.brake < 0.01 && v > 0.5) Freq = -0.035 * CAR.m * G0;   // 松油门的拖拽感（来自回收）
  }
  if (v < 0.05 && Freq < 0) Freq = 0;
  const Pw = Freq * v;
  // ---- 选模式
  const soc = S.soc;
  const D = motorDcDemand(v, Math.max(Freq, 0)).Pdc + CAR.Paux / CAR.etaDcdc;
  const nLock = lockRpm(v);
  let mode = S.mode, why = '';
  const forced = cmd.forceMode;
  if (Freq < 0) {
    mode = soc > BAT.socHi - 0.02 && grade < -0.03 ? 'EBRK' : 'REGEN';
    why = mode === 'EBRK' ? '电池快满了，回收的电让发电机去拖着熄火的发动机空转，把能量变成发动机的摩擦热' : '松油门或踩刹车：驱动电机反过来发电，往电池里充';
  } else {
    const dir = direct(v, grade, 0);
    const dirOK = v * 3.6 >= 62 && nLock >= 1300 && Freq * v < (engTmax(nLock) * 0.9 * rpm2rad(nLock)) * 0.95 && Freq > 0;
    const steady = Math.abs(Freq - Fres) < 0.06 * CAR.m * G0;
    const sf = seriesFollow(Math.max(v, 1), grade);
    const pOn = 16e3 + 40e3 * (soc - 0.55), pOff = 9e3 + 40e3 * (soc - 0.55);
    const wantEng = soc < 0.42 || D > pOn || (S.eng && (D > pOff || soc < 0.5 || S.onT < 4));
    const dirBetter = !cmd.noDirect && dirOK && steady && dir.fuel < sf.fuel * 0.97;
    const stayDir = S.mode === 'ENG' && !cmd.noDirect && dirOK && steady && !(soc > 0.63 && D < 14e3);
    if (stayDir || (dirBetter && (wantEng || S.mode === 'SYNC'))) {
      mode = 'ENG';
      why = soc < 0.6 && v * 3.6 < 98 ? `车速 ${Math.round(v * 3.6)} km/h、匀速：合上离合器直驱，顺便多带一点负荷给电池充电，充满了再熄火纯电跑一段`
        : `车速 ${Math.round(v * 3.6)} km/h、匀速：直接用发动机推车比“发电再驱动”少绕一道弯，油耗低约 ${Math.round((1 - dir.fuel / sf.fuel) * 100)}%`;
    } else if (wantEng) {
      mode = 'HYB';
      why = soc < 0.42 ? '电池电量偏低：起动发动机发电，一边驱动一边充电' : D > pOn ? `需要 ${(D / 1000).toFixed(0)} kW，超过纯电门槛：发动机起动发电` : '发动机已经在转：按负荷和电量继续发电';
    } else {
      mode = 'EV'; why = S.mode === 'ENG' ? '直驱时顺便充的电够了：分开离合器、熄火，先用电池跑' : '需求不大、电池够用：发动机熄火，电池单独驱动';
    }
  }
  if (forced) { mode = forced; why = '手动指定的模式（真车由电脑自动选）'; }
  // ---- 离合器同步：从混动切直驱前，先让发电机把发动机转速拉到 nLock
  if (mode === 'ENG' && S.clutch !== 'locked') {
    if (S.clutch === 'open') S.clutch = 'sync';
    if (!S.eng) { S.eng = true; S.nE = Math.max(S.nE, 1000); }
    const dn = nLock - S.nE;
    S.nE += clamp(dn, -2500 * dt, 2500 * dt);
    if (Math.abs(dn) < 25) { S.clutch = 'locked'; S.lockT = 0; }
    else mode = 'SYNC';
  } else if (mode !== 'ENG') {
    S.clutch = 'open';
  }
  // ---- 功率分配
  let Fdrive = 0, Pbat = 0, Pe = 0, Pmot = 0, Pgen = 0, nE_target = 0, Ffric = 0;
  const md = motorDcDemand(v, Math.max(Freq, 0));
  if (mode === 'REGEN' || mode === 'EBRK') {
    const wm = wheelW(v) * CAR.Gm;
    const TmMin = -motTmax(nm);
    const Fregen = Math.max(Freq, TmMin * CAR.Gm / CAR.etaMesh ** 2 / CAR.rw);
    const r = motorDcDemand(v, Fregen);
    let Pin = -(r.Pdc);                                          // 电机送回直流侧
    const chgMax = soc < BAT.socHi ? BAT.PchgMax : 0;
    let Pb = -Math.min(Math.max(Pin - CAR.Paux / CAR.etaDcdc, 0), chgMax);
    if (mode === 'EBRK') {
      const burn = Math.max(Pin - CAR.Paux / CAR.etaDcdc - Math.max(0, chgMax * 0.1), 0);
      Pgen = -burn; Pb = Math.max(Pb, -chgMax * 0.1); nE_target = clamp(1500 + burn / 18, 1500, 4000);
    }
    const used = -Pb + (mode === 'EBRK' ? -Pgen : 0) + CAR.Paux / CAR.etaDcdc;
    const frac = Pin > 1 ? clamp(used / Pin, 0, 1) : 1;
    Fdrive = Fregen * frac;
    Ffric = Freq - Fdrive;
    Pbat = Pb; Pmot = r.Pac * frac;
    S.eng = mode === 'EBRK'; Pe = 0;
  } else if (mode === 'EV') {
    Fdrive = Math.min(Freq, FmotMax);
    const r = motorDcDemand(v, Fdrive);
    Pbat = r.Pdc + CAR.Paux / CAR.etaDcdc; Pmot = r.Pac;
    if (Pbat > BAT.PdisMax) { const k = BAT.PdisMax / Pbat; Fdrive *= k; Pbat = BAT.PdisMax; }
    S.eng = false;
  } else if (mode === 'HYB' || mode === 'SYNC') {
    Fdrive = Math.min(Freq, FmotMax);
    const r = motorDcDemand(v, Fdrive);
    const need = r.Pdc + CAR.Paux / CAR.etaDcdc;
    const chg = clamp((0.58 - soc) * 120e3, -8e3, 12e3);
    let gen = clamp(need + chg, 3e3, 62e3);
    if (mode === 'SYNC') gen = Math.min(gen, need + 2e3);
    const g = engineForDc(gen, nvhCap(Math.max(v, 4)));
    Pe = g.Pe; Pgen = g.Pdc; nE_target = mode === 'SYNC' ? nLock : g.op.n;
    Pbat = need - g.Pdc; Pmot = r.Pac;
    if (Pbat > BAT.PdisMax) {
      // 发电机 + 电池都到顶了：按能拿到的直流功率把驱动力缩回去
      const avail = g.Pdc + BAT.PdisMax - CAR.Paux / CAR.etaDcdc;
      let F = Fdrive * clamp(avail / Math.max(r.Pdc, 1), 0, 1);
      for (let i = 0; i < 3; i++) { const q = motorDcDemand(v, F); F *= clamp(avail / Math.max(q.Pdc, 1), 0, 1.2); }
      Fdrive = Math.min(F, Fdrive);
      const r2 = motorDcDemand(v, Fdrive);
      Pmot = r2.Pac; Pbat = r2.Pdc + CAR.Paux / CAR.etaDcdc - g.Pdc;
    }
    S.eng = true;
  } else if (mode === 'ENG') {
    const nE = nLock, we = rpm2rad(nE);
    const TeMax = engTmax(nE) * 0.97;
    const chg = clamp((0.58 - soc) * 80e3, -6e3, 8e3);
    const d = direct(v, grade, Math.max(chg, 0));
    // 需求比稳态多出来的部分：电机从电池补（boost）；少的部分：电机发电
    const Pneed = Freq * v;
    const PeWant = (Pneed + d.Pmot) / CAR.etaMesh ** 2 + d.Pgen;
    Pe = Math.min(PeWant, TeMax * we);
    const extra = PeWant - Pe;                                   // 缺口，交给电机
    const rm = motorDcDemand(v, extra > 0 ? extra * CAR.etaMesh ** 2 / Math.max(v, 1) : 0);
    Pmot = extra > 0 ? rm.Pac : 0;
    Pbat = (extra > 0 ? rm.Pdc : 0) - Math.max(chg, 0);
    Pgen = CAR.Paux / CAR.etaDcdc + Math.max(chg, 0);
    Fdrive = Freq; nE_target = nE; S.nE = nE; S.eng = true;
  }
  // ---- 积分
  const Fnet = Fdrive + Math.min(Ffric, 0) - Fres;
  let vN = v + Fnet / CAR.mEq * dt;
  if (vN < 0) vN = 0;
  S.v = vN;
  S.distM += v * dt;
  S.soc = clamp(S.soc - batChem(Pbat, soc) / (batWh * 3600) * dt, 0.05, 0.95);
  // 发动机转速：直驱时锁死，其余时候追踪目标（熄火时降到 0）
  if (S.clutch === 'locked') S.nE = nLock;
  else if (S.eng) S.nE += clamp(nE_target - S.nE, -3000 * dt, 2500 * dt);
  else S.nE = Math.max(0, S.nE - 3000 * dt);
  const fuelW = S.eng && Pe > 0 && S.nE > 600 ? fuelPower(S.nE, Pe / rpm2rad(S.nE)) : 0;
  S.fuelGs = fuelW / ENG.LHV * 1000;
  S.fuelG += S.fuelGs * dt;
  if (S.eng) { S.onT += dt; S.offT = 0; } else { S.offT += dt; S.onT = 0; }
  Object.assign(S, { mode, ecuWhy: why, Fw: Fdrive, Freq, Pw: Fdrive * v, Pbat, Pe, Pmot, Pgen, Pfr: Ffric * v, Fres, D });
  S.t += dt;
  return S;
}
