// 巡游采样（纯数学，浏览器和 QA 共用）
// 每段：先 easeInOutCubic 缓入抵达 m，再 easeInOutSine 低速漂移到 b；下一段起点 = 上一段终点。
// 有 via（相机途经点）的段，抵达阶段相机沿经过途经点的样条走（目标点照常插值），用来从南侧檐下进出厂房、跨过空中输送轨道，避免穿桁架 / 灯带。
import * as THREE from 'three';
import { TOUR, TOUR_HOME } from './layout.js';

const ease3 = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeS = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const lerp = (a, b, t) => a + (b - a) * t;

export function camPos(a) { const [tx, ty, tz, az, el, d] = a; const ce = Math.cos(el); return [tx + d * ce * Math.sin(az), ty + d * Math.sin(el), tz + d * ce * Math.cos(az)]; }
function fromCam(cam, tgt, fov, azRef) {
  const dx = cam[0] - tgt[0], dy = cam[1] - tgt[1], dz = cam[2] - tgt[2];
  const d = Math.hypot(dx, dy, dz);
  let az = Math.atan2(dx, dz);
  while (az - azRef > Math.PI) az -= Math.PI * 2; while (az - azRef < -Math.PI) az += Math.PI * 2;
  return [tgt[0], tgt[1], tgt[2], az, Math.asin(dy / d), d, fov];
}

export function makeSegs(k = 1) {
  const segs = TOUR.map((s) => ({ ...s, dur: s.dur * k }));
  segs.forEach((s, i) => { s.a = i === 0 ? TOUR_HOME : segs[i - 1].b; if (!s.b) s.b = TOUR_HOME; });
  return segs;
}
const curves = new WeakMap();
function curveFor(s, A) {
  let c = curves.get(s);
  if (!c || c.A !== A) {
    const pts = [camPos(A), ...s.via, camPos(s.m)].map((p) => new THREE.Vector3(...p));
    c = { A, curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal') };
    curves.set(s, c);
  }
  return c.curve;
}
const _v = new THREE.Vector3();
export function sampleSegs(segs, e, first) {
  let t = e, i = 0;
  while (i < segs.length - 1 && t > segs[i].dur) { t -= segs[i].dur; i++; }
  const s = segs[i]; const u = Math.min(1, Math.max(0, t / s.dur));
  const A = i === 0 && first ? first : s.a;
  const out = new Array(7);
  if (u < s.split) {
    const k = ease3(u / s.split);
    if (s.via) {
      curveFor(s, A).getPointAt(k, _v);
      const tgt = [lerp(A[0], s.m[0], k), lerp(A[1], s.m[1], k), lerp(A[2], s.m[2], k)];
      return { arr: fromCam([_v.x, _v.y, _v.z], tgt, lerp(A[6], s.m[6], k), lerp(A[3], s.m[3], k)), i };
    }
    for (let j = 0; j < 7; j++) out[j] = j === 5 ? Math.exp(lerp(Math.log(A[j]), Math.log(s.m[j]), k)) : lerp(A[j], s.m[j], k);
  } else {
    const k = easeS((u - s.split) / (1 - s.split));
    for (let j = 0; j < 7; j++) out[j] = j === 5 ? Math.exp(lerp(Math.log(s.m[j]), Math.log(s.b[j]), k)) : lerp(s.m[j], s.b[j], k);
  }
  return { arr: out, i };
}
