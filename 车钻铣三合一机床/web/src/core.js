// 数字都从这里出：参数表、切削速度、挂轮搜索、电子挂轮的整数算法。
// 标 ASSUME 的是 CT125E 没公开、按同类小机床取的假设值，页面上会写明。

export const SPEC = {
  swing: 125, centers: 180, crossSwing: 60, bore: 9, spindleTaper: 'MT1', tailTravel: 18, tailTaper: 'MT1',
  runout: '主轴端 100 mm 处 0.01 ~ 0.02 mm',
  E: { rpm: [50, 2250], power: 200, threads: '程序设定', feed: '程序设定' },
  STD: { rpm: [560, 2500], gears: 5, power: 120, metric: '8 种 0.4 ~ 1.5 mm', inch: '8 种', feed: [0.07, 0.14], millRpm: '500 ~ 2500，10 挡' },
  mill: { drill: 6, spindleToTable: 180, throat: 125, swivel: 360, headTravel: 60, table: [85, 60], tslot: 8, quill: 40 },
};

// 没公开的内部参数（演示用假设）
export const ASSUME = {
  lead: 1.5,          // 丝杠导程 mm
  encCPR: 4000,       // 编码器每转计数（1000 线 × 4 倍频）
  stepsRev: 1600,     // 步进电机每转步数（200 步 × 8 细分）
  stepperMaxRpm: 600, // 开环步进电机能可靠带载的大致上限
};

/** 切削速度 m/min：v = π D n / 1000 */
export const surfaceSpeed = (dMM, rpm) => Math.PI * dMM * rpm / 1000;
/** 由推荐线速度求转速 */
export const rpmFor = (dMM, vMmin) => (1000 * vMmin) / (Math.PI * dMM);

// 推荐线速度（高速钢刀 / 硬质合金刀的保守值，手册常见范围的中间偏下，小机床刚性差再打折）
export const MATERIALS = {
  alu: { name: '铝', v: [60, 150], note: '软、粘刀，转速可以高' },
  brass: { name: '黄铜', v: [40, 100], note: '最好车，屑是碎的' },
  steel: { name: '低碳钢', v: [20, 45], note: '小机床吃刀要浅，转速别太高' },
  pom: { name: '尼龙 / POM', v: [60, 150], note: '会熔，进给别太慢' },
  wood: { name: '木材', v: [100, 300], note: '' },
};

/** 一把挂轮组合：主轴 → A/B → C/D → 丝杠；螺距 = 导程 × (A/B)(C/D)。
 *  搜一套常见挂轮里最接近目标螺距的组合（ASSUME：齿数表是常见迷你车床挂轮） */
export const GEAR_SET = [20, 30, 35, 40, 45, 50, 55, 57, 60, 65, 80];
export function searchGears(pitch, lead = ASSUME.lead, set = GEAR_SET) {
  let best = null;
  const target = pitch / lead;
  for (const A of set) for (const B of set) for (const C of set) for (const D of set) {
    if (new Set([A, B, C, D]).size < 4) continue;   // 每个齿数只有一个
    const r = (A / B) * (C / D);
    const err = Math.abs(r - target) / target;
    if (!best || err < best.err - 1e-12) best = { A, B, C, D, r, err, pitch: r * lead };
  }
  return best;
}

export function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; }

/** 电子挂轮的比例：每来 1 个编码器计数，要给步进电机多少步。
 *  步数/计数 = (P / L) × S / C 。用整数分数 num/den 表示，避免浮点累积误差。
 *  P 用 0.001 mm 为单位转成整数。 */
export function elsRatio(pitch, { lead = ASSUME.lead, cpr = ASSUME.encCPR, steps = ASSUME.stepsRev } = {}) {
  const Pu = Math.round(pitch * 1000), Lu = Math.round(lead * 1000);
  let num = Pu * steps, den = Lu * cpr;
  const g = gcd(num, den); num /= g; den /= g;
  return { num, den, stepsPerRev: (pitch / lead) * steps, perCount: num / den };
}

/** 模拟 n 个编码器计数，返回每个计数后的累加器和是否出一步（Bresenham / DDA） */
export function runDDA(ratio, counts, acc0 = 0) {
  const out = []; let acc = acc0, steps = 0;
  for (let i = 0; i < counts; i++) {
    acc += ratio.num;
    let s = 0;
    while (acc >= ratio.den) { acc -= ratio.den; s++; steps++; }
    out.push({ i, acc, s, steps });
  }
  return { out, acc, steps };
}

/** 一组工况下的极限：编码器计数频率、步进脉冲频率、电机转速 */
export function loads(rpm, pitch, a = ASSUME) {
  const revS = rpm / 60;
  const motorRpm = rpm * pitch / a.lead;
  return {
    encHz: revS * a.encCPR,
    stepHz: revS * (pitch / a.lead) * a.stepsRev,
    motorRpm,
    feedMMs: revS * pitch,
    ok: motorRpm <= a.stepperMaxRpm,
    maxRpm: a.stepperMaxRpm * a.lead / pitch,
    stepRes: a.lead / a.stepsRev,      // 丝杠一步走多少 mm
  };
}

/** 车螺纹的牙深（60° 公制，外螺纹工作高度约 0.613P） */
export const threadDepth = (pitch) => 0.6134 * pitch;

/** 多刀车螺纹：每刀开始时主轴角度。synced=true 等零点脉冲；否则随机 */
export function passPhases(n, synced, seed = 7) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => (synced ? 0 : rnd() * 360));
}

/** 公制标准螺距（粗牙 M1 ~ M10 + 常见细牙） */
export const STD_PITCHES = [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.75, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0];
/** 英制 TPI → mm */
export const tpi2mm = (tpi) => 25.4 / tpi;
