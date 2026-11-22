// 力学课所有的数：纯函数，不碰页面。test_mech.mjs 用它校验文案、猜题和练习题。
// 单位：位置 m、时间 s、速度 m/s、加速度 m/s²。

export const G = 9.8;                // 高中课本取 9.8 m/s²
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const kmh = (v) => v * 3.6;
export const ms = (k) => k / 3.6;

// ------------------------------------------------------------------ 第 1 课：一段走走停停、还会倒回来的行程
/** 分段匀速的行程：[[时长 s, 速度 m/s], ...]，从 x0 出发。返回 t 时刻的位置、走过的路程 */
export function trip(segs, t, x0 = 0) {
  let x = x0, path = 0, left = t;
  for (const [dt, v] of segs) {
    const d = Math.min(dt, Math.max(left, 0));
    x += v * d; path += Math.abs(v) * d; left -= dt;
    if (left <= 0) break;
  }
  return { x, path };
}
export const tripTime = (segs) => segs.reduce((s, [dt]) => s + dt, 0);
/** 第 1、2 课的例子：从家门口出发往东开 40 m（开过了便利店），停 1 s，倒回 10 m 停进便利店门口（东边 30 m） */
export const TRIP1 = [[4, 10], [1, 0], [2, -5]];
export const STORE = 30;

/** 一辆匀加速起步的车：x = ½ a t²；第 2 课用它讲瞬时速度 */
export const accelX = (a, t) => 0.5 * a * t * t;
/** t 到 t + dt 的平均速度 */
export const avgV = (f, t, dt) => (f(t + dt) - f(t)) / dt;

/** v-t 曲线下面切成 n 条长方形（每条取左端的高度）加起来；第 4 课用 */
export function strips(f, t0, t1, n) {
  const w = (t1 - t0) / n; let s = 0;
  for (let i = 0; i < n; i++) s += f(t0 + i * w) * w;
  return s;
}

// 例子车：汽车模拟器那台，0→100 km/h 约 11 s，平均加速度约 2.5 m/s²
export const CAR = { len: 4.76, a: 2.5 };

// ------------------------------------------------------------------ 第 3 课：加速度和 v-t 图
/** 三段：加速 a1 用 t1 秒，匀速 t2 秒，减速 a2（正数）直到停下。返回 t 时刻的 v、x，和整段的关键数 */
export function profile({ a1, t1, t2, a2 }) {
  const vmax = a1 * t1, t3 = vmax / a2, T = t1 + t2 + t3;
  const at = (t) => {
    if (t <= 0) return { v: 0, x: 0, a: 0 };
    if (t <= t1) return { v: a1 * t, x: 0.5 * a1 * t * t, a: a1 };
    const x1 = 0.5 * a1 * t1 * t1;
    if (t <= t1 + t2) return { v: vmax, x: x1 + vmax * (t - t1), a: 0 };
    const x2 = x1 + vmax * t2, s = Math.min(t - t1 - t2, t3);
    return { v: vmax - a2 * s, x: x2 + vmax * s - 0.5 * a2 * s * s, a: t < T ? -a2 : 0 };
  };
  return { vmax, t3, T, at, X: at(T).x };
}

// ------------------------------------------------------------------ 第 4、5 课：匀变速的公式和刹车
export const vAt = (v0, a, t) => v0 + a * t;
export const xAt = (v0, a, t) => v0 * t + 0.5 * a * t * t;
/** v² − v0² = 2ax → x */
export const xByV = (v0, v, a) => (v * v - v0 * v0) / (2 * a);
/** 刹车：车速 v0、反应时间 tr、减速度 b（正数）。返回反应距离、刹车距离、总距离、总时间 */
export function stopping(v0, tr, b) {
  const dr = v0 * tr, db = v0 * v0 / (2 * b);
  return { dr, db, d: dr + db, t: tr + v0 / b };
}
/** 刹车 t 秒以后走了多远：车停了就不再动（这是一个常见的坑） */
export const brakeDist = (v0, b, t) => (t >= v0 / b ? v0 * v0 / (2 * b) : v0 * t - 0.5 * b * t * t);
export const ROAD = { dry: 7.0, wet: 4.5, ice: 1.5 };   // 急刹的减速度 m/s²：干沥青、湿路、结冰

// ------------------------------------------------------------------ 第 6 课：自由落体（先放着，后面的课用）
export const fallH = (t, g = G) => 0.5 * g * t * t;
export const fallT = (h, g = G) => Math.sqrt(2 * h / g);
export const fallV = (h, g = G) => Math.sqrt(2 * g * h);
/** 第 n 秒内下落的距离 */
export const nthSecond = (n, g = G) => g * (2 * n - 1) / 2;
/** 接尺子测反应时间：尺子掉了 d 米 → 反应时间 */
export const rulerTime = (d, g = G) => Math.sqrt(2 * d / g);

// ------------------------------------------------------------------ 第 7 课：平抛（先放着）
export function projectile(v0, h, g = G) {
  const T = fallT(h, g), R = v0 * T, vy = g * T, v = Math.hypot(v0, vy);
  return { T, R, vy, v, theta: Math.atan2(vy, v0), alpha: Math.atan2(h, R) };
}
export const projAt = (v0, t, g = G) => ({ x: v0 * t, y: 0.5 * g * t * t, vx: v0, vy: g * t });

// ------------------------------------------------------------------ 随机数（练习题用）：可以给种子，自检时就能复现
export function rng(seed = Math.random() * 1e9) {
  let s = seed >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return {
    next,
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    step: (a, b, st) => a + st * Math.floor(next() * (Math.round((b - a) / st) + 1)),
    shuffle: (arr) => { const r = arr.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; },
  };
}
