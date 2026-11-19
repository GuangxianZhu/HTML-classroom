// 折线路径（拐角倒圆）+ 沿路径的物流队列
import * as THREE from 'three';

// 在水平拐角处插入圆弧（竖直段保持直角，用于升降）
export function roundPath(pts, r = 1.5, seg = 8) {
  if (pts.length < 3) return pts.map((p) => p.slice());
  const out = [pts[0].slice()];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const d1 = [b[0] - a[0], b[2] - a[2]], d2 = [c[0] - b[0], c[2] - b[2]];
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    if (l1 < 1e-3 || l2 < 1e-3 || Math.abs(a[1] - b[1]) > 1e-3 || Math.abs(c[1] - b[1]) > 1e-3) { out.push(b.slice()); continue; }
    const u1 = [d1[0] / l1, d1[1] / l1], u2 = [d2[0] / l2, d2[1] / l2];
    const cross = u1[0] * u2[1] - u1[1] * u2[0];
    if (Math.abs(cross) < 1e-3) { out.push(b.slice()); continue; }
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p0 = [b[0] - u1[0] * rr, b[1], b[2] - u1[1] * rr], p2 = [b[0] + u2[0] * rr, b[1], b[2] + u2[1] * rr];
    for (let k = 0; k <= seg; k++) { // 二次贝塞尔近似圆角
      const t = k / seg, m = 1 - t;
      out.push([m * m * p0[0] + 2 * m * t * b[0] + t * t * p2[0], b[1], m * m * p0[2] + 2 * m * t * b[2] + t * t * p2[2]]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

export class Path {
  constructor(pts, opt = {}) {
    this.pts = opt.round ? roundPath(pts, opt.round) : pts.map((p) => p.slice());
    this.closed = !!opt.closed;
    if (this.closed) this.pts.push(this.pts[0].slice());
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) { const a = this.pts[i - 1], b = this.pts[i]; this.cum.push(this.cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])); }
    this.L = this.cum[this.cum.length - 1];
    // 每段的水平朝向（竖直段沿用上一段）
    this.yaw = []; let last = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i], dx = b[0] - a[0], dz = b[2] - a[2];
      if (Math.hypot(dx, dz) > 1e-4) last = Math.atan2(-dz, dx);
      this.yaw.push(last);
    }
    for (let i = this.yaw.length - 2; i >= 0; i--) { const a = this.pts[i], b = this.pts[i + 1]; if (Math.hypot(b[0] - a[0], b[2] - a[2]) <= 1e-4) this.yaw[i] = this.yaw[i + 1] ?? this.yaw[i]; }
    this._i = 1;
  }
  seg(s) {
    let i = this._i; const c = this.cum;
    if (s < c[i - 1] || s > c[i]) { let lo = 1, hi = c.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < s) lo = m + 1; else hi = m; } i = lo; }
    this._i = i; return i;
  }
  // 返回 {x,y,z,yaw}
  at(s, out = {}) {
    if (this.closed) s = ((s % this.L) + this.L) % this.L; else s = Math.max(0, Math.min(this.L, s));
    const i = this.seg(s), a = this.pts[i - 1], b = this.pts[i];
    const t = (s - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1]);
    out.x = a[0] + (b[0] - a[0]) * t; out.y = a[1] + (b[1] - a[1]) * t; out.z = a[2] + (b[2] - a[2]) * t;
    // 朝向在段间做短平滑
    let yaw = this.yaw[i - 1];
    out.yaw = yaw; out.i = i;
    return out;
  }
  points() { return this.pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])); }
}

// 沿路径等间距移动的一串物件
export class Flow {
  constructor(path, n, opt = {}) {
    this.path = path; this.n = n; this.speed = opt.speed ?? 1; this.s0 = opt.offset ?? 0;
    this.spacing = opt.spacing ?? path.L / n; this.items = []; this.hideEnds = opt.hideEnds ?? 0.6; this.t = 0;
  }
  add(node) { this.items.push({ node, k: this.items.length }); }
  update(dt, speedK = 1, cb) {
    this.t += dt * this.speed * speedK;
    const o = {}; const L = this.path.L, span = this.spacing * this.n;
    for (const it of this.items) {
      let s = (this.s0 + this.t + it.k * this.spacing) % span;
      if (span > L) { if (s > L) { it.node.visible = false; continue; } }
      else s = s % L;
      this.path.at(s, o);
      const nd = it.node; nd.visible = !(s < this.hideEnds || s > L - this.hideEnds);
      nd.position.set(o.x, o.y, o.z); nd.rotation.y = o.yaw;
      if (cb) cb(it, s, o);
    }
  }
}
