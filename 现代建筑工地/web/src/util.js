// life.js / smart.js 共用的小工具：Blender 坐标转 three、绕局部轴转、按弧长走的路线、实例化原型。
import * as THREE from 'three';

export const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
export const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, -1), z: new THREE.Vector3(0, 1, 0) };
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const frac = (x) => x - Math.floor(x);
export const hash = (i) => frac(Math.sin(i * 127.1 + 311.7) * 43758.5453);

// 绕 Blender 局部轴转（在初始姿态上叠加）
export function rot(o, axis, a) {
  if (!o) return;
  if (!o.userData.q0) o.userData.q0 = o.quaternion.clone();
  o.quaternion.copy(o.userData.q0).multiply(_q.setFromAxisAngle(AX[axis], a));
}
export function place(o, x, y, z, h = 0) {
  o.position.copy(V(x, y, z));
  o.rotation.set(0, h, 0);
}
export function angLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * t;
}

// ------------------------------------------------------------------ 路线：折线 + 圆角，按弧长取点
export class Path {
  constructor(pts, r = 9) {
    const raw = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const A = pts[i - 1], B = pts[i], C = pts[i + 1];
      const lab = Math.hypot(A[0] - B[0], A[1] - B[1]), lbc = Math.hypot(C[0] - B[0], C[1] - B[1]);
      const d = Math.min(r, lab / 2, lbc / 2);
      const t1 = [B[0] + (A[0] - B[0]) / lab * d, B[1] + (A[1] - B[1]) / lab * d];
      const t2 = [B[0] + (C[0] - B[0]) / lbc * d, B[1] + (C[1] - B[1]) / lbc * d];
      for (let k = 0; k <= 8; k++) {
        const u = k / 8;
        raw.push([(1 - u) * (1 - u) * t1[0] + 2 * u * (1 - u) * B[0] + u * u * t2[0], (1 - u) * (1 - u) * t1[1] + 2 * u * (1 - u) * B[1] + u * u * t2[1]]);
      }
    }
    raw.push(pts[pts.length - 1]);
    this.x = []; this.y = []; this.s = [];
    let s = 0;
    for (let i = 0; i < raw.length; i++) {
      if (i) s += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
      if (i && Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]) < 1e-6) continue;
      this.x.push(raw[i][0]); this.y.push(raw[i][1]); this.s.push(s);
    }
    this.len = s;
  }
  at(s) {
    s = clamp(s, 0, this.len);
    let lo = 0, hi = this.s.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= s) lo = m; else hi = m; }
    const t = (s - this.s[lo]) / Math.max(1e-6, this.s[hi] - this.s[lo]);
    const x = lerp(this.x[lo], this.x[hi], t), y = lerp(this.y[lo], this.y[hi], t);
    return { x, y, h: Math.atan2(this.y[hi] - this.y[lo], this.x[hi] - this.x[lo]) };
  }
  nearest(px, py, s0 = 0, s1 = this.len) {
    let best = 1e18, bs = 0;
    for (let i = 0; i < this.s.length; i++) {
      if (this.s[i] < s0 || this.s[i] > s1) continue;
      const d = (this.x[i] - px) ** 2 + (this.y[i] - py) ** 2;
      if (d < best) { best = d; bs = this.s[i]; }
    }
    return bs;
  }
}

// ------------------------------------------------------------------ 实例化：一个原型画很多份（工人、标准节、附墙架）
export class Inst {
  constructor(proto, max, parent, mats, anim = null) {
    proto.updateMatrixWorld(true);
    const inv = proto.matrixWorld.clone().invert();
    this.parts = [];
    proto.traverse((o) => {
      if (!o.isMesh) return;
      let node = null;
      if (anim) for (let p = o.parent; p && p !== proto; p = p.parent) if (anim(p)) { node = p; break; }
      const im = new THREE.InstancedMesh(o.geometry, o.material, max);
      im.count = 0;
      im.frustumCulled = false;
      parent.add(im);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
      const part = { im, mat: o.material, key: node ? anim(node) : null };
      if (node) {
        part.pivot = inv.clone().multiply(node.matrixWorld);
        part.rest = node.matrixWorld.clone().invert().multiply(o.matrixWorld);
      } else part.local = inv.clone().multiply(o.matrixWorld);
      this.parts.push(part);
    });
    this.max = max;
  }
  set(i, M, swing = null) {
    for (const p of this.parts) {
      if (p.local) _m.multiplyMatrices(M, p.local);
      else {
        _m.multiplyMatrices(M, p.pivot);
        if (swing) _m.multiply(_m2.makeRotationAxis(AX.y, swing(p.key)));
        _m.multiply(p.rest);
      }
      p.im.setMatrixAt(i, _m);
    }
  }
  count(n) {
    for (const p of this.parts) { p.im.count = n; p.im.instanceMatrix.needsUpdate = true; }
  }
}

export const mat4 = (x, y, z, h = 0, s = 1) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(AX.z, h), new THREE.Vector3(s, s, s));

