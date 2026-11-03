// 纤维旁的颗粒轨迹蒙特卡洛。流场是 Kuwabara 胞模型的解析解，布朗运动和惯性按真实物理量算。
// 长度用 µm，时间用 s。
import { diffusivity, relaxTime, kuwabara } from './filter_core.js';

export class MicroSim {
  constructor(N = 36) { this.N = N; this.parts = []; this.seed = 1; this.stuck = []; this.configure({ d: 0.1e-6, df: 0.65e-6, alpha: 0.05, U: 0.0109 }); }

  configure(m) {
    this.m = m;
    this.a = m.df * 1e6 / 2;
    this.dp = m.d * 1e6;
    this.U = m.U * 1e6;
    this.alpha = m.alpha;
    this.Ku = kuwabara(m.alpha);
    this.b = this.a / Math.sqrt(m.alpha);
    this.D = diffusivity(m.d) * 1e12;
    this.tau = relaxTime(m.d);
    this.passed = 0; this.caught = 0; this.stuck = [];
    this.parts = [];
    for (let i = 0; i < this.N; i++) this.parts.push(this.spawn(Math.random()));
    // 单步不超过 0.02 µm 的布朗位移，也不超过 0.02 µm 的对流位移
    const lim = 0.02;
    this.dt = Math.min(lim * lim / (2 * this.D), lim / this.U);
  }

  g(s) { const a = this.alpha; return 2 * s * Math.log(s) - (1 - a) * s + (1 - a / 2) / s - (a / 2) * s * s * s; }
  dg(s) { const a = this.alpha; return 2 * Math.log(s) + 2 - (1 - a) - (1 - a / 2) / (s * s) - 1.5 * a * s * s; }

  vel(x, y) {
    const r = Math.hypot(x, y), s = r / this.a, c = x / r, sn = y / r;
    const k = this.U / (2 * this.Ku);
    const ur = k * c * this.g(s) / s;
    const ut = -k * sn * this.dg(s);
    return [ur * c - ut * sn, ur * sn + ut * c];
  }

  // 胞边界上半幅的流量（单位进深），用来把捕获概率换算成单纤维效率
  psiB() { return (this.a / (2 * this.Ku)) * this.g(this.b / this.a); }

  spawn(life = 0) {
    const w = 2 * Math.random() - 1;            // sinθ 均匀 = 按流量均匀
    const th = Math.PI - Math.asin(w);
    const r = this.b * 0.999;
    const x = r * Math.cos(th), y = r * Math.sin(th);
    const [vx, vy] = this.vel(x, y);
    return { x, y, vx, vy, trail: [], t: 0, delay: life * 0.0004 };
  }

  gauss() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // 推进 T 秒（物理时间）
  advance(T) {
    const n = Math.max(1, Math.round(T / this.dt));
    const dt = T / n;
    const e = Math.exp(-dt / this.tau), sig = Math.sqrt(2 * this.D * dt);
    const rc = this.a + this.dp / 2;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.delay > 0) { p.delay -= T; continue; }
      for (let k = 0; k < n; k++) {
        const [ux, uy] = this.vel(p.x, p.y);
        p.vx = ux + (p.vx - ux) * e;
        p.vy = uy + (p.vy - uy) * e;
        p.x += p.vx * dt + sig * this.gauss();
        p.y += p.vy * dt + sig * this.gauss();
        const r = Math.hypot(p.x, p.y);
        if (r <= rc) {
          this.caught++;
          if (this.stuck.length > 240) this.stuck.shift();
          this.stuck.push([p.x / r * rc, p.y / r * rc]);
          this.parts[i] = this.spawn();
          break;
        }
        if (r >= this.b) {
          if (p.x > 0) { this.passed++; this.parts[i] = this.spawn(); break; }
          const f = (this.b * 0.998) / r;      // 上游侧扩散出胞：弹回
          p.x *= f; p.y *= f;
        }
      }
      const q = this.parts[i];
      if (q === p) { q.trail.push(q.x, q.y); if (q.trail.length > 60) q.trail.splice(0, 2); }
    }
  }

  // 蒙特卡洛测得的单纤维效率
  etaMC() {
    const tot = this.passed + this.caught;
    if (!tot) return null;
    return (this.caught / tot) * 2 * this.psiB() / (2 * this.a);
  }
}
