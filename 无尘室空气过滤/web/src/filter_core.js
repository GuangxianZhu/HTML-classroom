// 纤维过滤的物理核心：不依赖页面，node 里也能跑。单位全是 SI。
export const AIR = { mu: 1.82e-5, T: 293.15, kB: 1.380649e-23, rhoP: 1050 };

// 滑移修正：粒子小到接近空气分子平均自由程（0.067 µm）时，空气阻力变小
export function slip(d) {
  const um = d * 1e6;
  return 1 + (0.067 / um) * (2.492 + 0.84 * Math.exp(-6.49 * um));
}
export function diffusivity(d) {
  return AIR.kB * AIR.T * slip(d) / (3 * Math.PI * AIR.mu * d);
}
export function relaxTime(d) {
  return AIR.rhoP * d * d * slip(d) / (18 * AIR.mu);
}
export function kuwabara(a) {
  return -0.5 * Math.log(a) - 0.75 + a - a * a / 4;
}

// 单纤维效率：扩散 / 拦截 / 惯性（Lee & Liu 形式）
export function singleFiber(d, m) {
  const { df, alpha: a, U } = m;
  const Ku = kuwabara(a);
  const D = diffusivity(d);
  const Pe = df * U / D;
  const R = d / df;
  const ED = 1.6 * Math.cbrt((1 - a) / Ku) * Math.pow(Pe, -2 / 3);
  const ER = (1 - a) * R * R / (Ku * (1 + R));
  const J = R < 0.4 ? (29.6 - 28 * Math.pow(a, 0.62)) * R * R - 27.5 * Math.pow(R, 2.8) : 2;
  const Stk = relaxTime(d) * U / df;
  const EI = Math.max(0, Stk * J / (2 * Ku * Ku));
  return { ED, ER, EI, E: ED + ER + EI, Pe, R, Stk, Ku };
}

export function penetration(d, m) {
  const s = singleFiber(d, m);
  const k = 4 * m.alpha / (Math.PI * (1 - m.alpha) * m.df) * m.t;
  return Math.exp(-k * s.E);
}

// Davies 压降式，乘一个纤维滑移的修正（亚微米纤维表面气体不再完全不滑）
export function pressureDrop(m) {
  const { df, alpha: a, U, t } = m;
  const f = 64 * Math.pow(a, 1.5) * (1 + 56 * a * a * a);
  const Knf = 2 * 0.067e-6 / df;
  return AIR.mu * U * t * f / (df * df) / (1 + 1.5 * Knf);
}

// 在 0.01–2 µm 上找穿透率最高的粒径
export function mpps(m) {
  let best = 0, bd = 0;
  for (let i = 0; i <= 400; i++) {
    const d = 1e-8 * Math.pow(200, i / 400);
    const p = penetration(d, m);
    if (p > best) { best = p; bd = d; }
  }
  return { d: bd, P: best };
}
