// 共用程序化几何：轿车、六轴机器人、操作工、牵引车/挂车、叉车、AGV
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const cache = {};
const once = (k, f) => cache[k] || (cache[k] = f());

export function rbox(w, h, d, r = 0.04, seg = 2) { return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.01, h / 2.01, d / 2.01)); }
function norm(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  return n;
}
export function mergeT(list) { // [geom, matrix]...
  return mergeGeometries(list.map(([g, m]) => { const n = norm(g.clone()); if (m) n.applyMatrix4(m); return n; }), false);
}
const T = (x, y, z, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
export { T as mtx };

// ---------- 轿车（4.6 × 1.86 × 1.46 m，车头 +x，原点 = 地面中心） ----------
export function carGeoms() {
  return once('car', () => {
    const L = 2.24; // 半长（加上倒角外扩约 2.3）
    const s = new THREE.Shape();
    s.moveTo(2.14, 0.30);
    s.quadraticCurveTo(2.27, 0.33, 2.26, 0.5);
    s.quadraticCurveTo(2.25, 0.68, 2.08, 0.77);
    s.quadraticCurveTo(1.6, 0.9, 1.0, 0.95);
    s.lineTo(-1.74, 1.0);
    s.quadraticCurveTo(-2.1, 1.0, -2.2, 0.93);
    s.quadraticCurveTo(-2.29, 0.82, -2.27, 0.5);
    s.quadraticCurveTo(-2.26, 0.33, -2.14, 0.30);
    s.lineTo(-1.84, 0.30);
    s.lineTo(-1.84, 0.36);
    s.absarc(-1.40, 0.36, 0.44, Math.PI, 0, true);
    s.lineTo(-0.96, 0.25);
    s.lineTo(0.96, 0.25);
    s.lineTo(0.96, 0.36);
    s.absarc(1.40, 0.36, 0.44, Math.PI, 0, true);
    s.lineTo(1.84, 0.30);
    s.lineTo(2.14, 0.30);
    const body = new THREE.ExtrudeGeometry(s, { depth: 1.86 - 0.2, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.05, bevelSegments: 2, curveSegments: 6 });
    body.translate(0, 0, -(1.86 - 0.2) / 2);
    // 玻璃舱（略窄，形成侧面收腰）
    const c = new THREE.Shape();
    c.moveTo(1.02, 0.93);
    c.quadraticCurveTo(0.55, 1.2, 0.2, 1.39);
    c.quadraticCurveTo(-0.3, 1.47, -0.9, 1.44);
    c.quadraticCurveTo(-1.45, 1.36, -1.8, 1.0);
    c.lineTo(1.02, 0.93);
    const glass = new THREE.ExtrudeGeometry(c, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.025, bevelSegments: 1, curveSegments: 5 });
    glass.translate(0, 0, -0.75);
    const tire = new THREE.CylinderGeometry(0.36, 0.36, 0.25, 16, 1);
    tire.rotateX(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(0.235, 0.235, 0.262, 14, 1);
    rim.rotateX(Math.PI / 2);
    const wheels = []; const rims = [];
    for (const x of [-1.4, 1.4]) for (const z of [-0.8, 0.8]) { wheels.push([tire, T(x, 0.36, z)]); rims.push([rim, T(x, 0.36, z)]); }
    const lf = new THREE.BoxGeometry(0.06, 0.05, 1.5); lf.translate(2.22, 0.73, 0);
    const lr = new THREE.BoxGeometry(0.06, 0.06, 1.62); lr.translate(-2.26, 0.86, 0);
    return { body, glass, tires: mergeT(wheels), rims: mergeT(rims), lightF: lf, lightR: lr, tire, rim, L };
  });
}

// ---------- 六轴机器人（各段原点在关节上） ----------
export function robotGeoms() {
  return once('robot', () => {
    const base = mergeT([[new THREE.CylinderGeometry(0.42, 0.48, 0.32, 24), T(0, 0.16, 0)], [rbox(1.0, 0.06, 1.0, 0.02), T(0, 0.03, 0)]]);
    const turret = mergeT([[new THREE.CylinderGeometry(0.36, 0.4, 0.34, 24), T(0, 0.17, 0)], [rbox(0.5, 0.42, 0.62, 0.08), T(0.06, 0.48, 0)]]);
    const upper = mergeT([[rbox(0.26, 1.18, 0.3, 0.07), T(0, 0.59, 0.0)], [new THREE.CylinderGeometry(0.2, 0.2, 0.42, 20).rotateX(Math.PI / 2), T(0, 0, 0)], [new THREE.CylinderGeometry(0.17, 0.17, 0.4, 20).rotateX(Math.PI / 2), T(0, 1.15, 0)]]);
    const fore = mergeT([[rbox(1.02, 0.22, 0.24, 0.06), T(0.52, 0, 0)], [rbox(0.34, 0.34, 0.32, 0.08), T(-0.08, 0, 0)]]);
    const wrist = mergeT([[new THREE.CylinderGeometry(0.1, 0.1, 0.24, 16).rotateX(Math.PI / 2), T(0, 0, 0)], [new THREE.CylinderGeometry(0.08, 0.09, 0.16, 14).rotateZ(Math.PI / 2), T(0.12, 0, 0)]]);
    // 焊枪（C 形）
    const gun = mergeT([[rbox(0.16, 0.16, 0.2, 0.03), T(0.08, 0, 0)], [new THREE.BoxGeometry(0.42, 0.06, 0.06), T(0.36, 0.14, 0)], [new THREE.BoxGeometry(0.06, 0.32, 0.06), T(0.55, 0.0, 0)], [new THREE.BoxGeometry(0.3, 0.06, 0.06), T(0.42, -0.14, 0)], [new THREE.CylinderGeometry(0.06, 0.08, 0.22, 10), T(0.16, -0.18, 0)]]);
    // 喷枪（旋杯）
    const bell = mergeT([[new THREE.CylinderGeometry(0.07, 0.07, 0.38, 14).rotateZ(Math.PI / 2), T(0.19, 0, 0)], [new THREE.CylinderGeometry(0.06, 0.11, 0.12, 16).rotateZ(Math.PI / 2), T(0.42, 0, 0)]]);
    // 吸盘端拾器
    const grip = mergeT([[new THREE.BoxGeometry(0.12, 0.08, 0.9), T(0.08, 0, 0)], [new THREE.CylinderGeometry(0.06, 0.06, 0.08, 10), T(0.08, -0.08, -0.38)], [new THREE.CylinderGeometry(0.06, 0.06, 0.08, 10), T(0.08, -0.08, 0.38)]]);
    // 护套（波纹管线缆，石墨色）
    const hose = mergeT([[new THREE.TorusGeometry(0.42, 0.045, 6, 18, Math.PI * 0.9), T(0.0, 0.62, 0.2, 0, 0, Math.PI * 0.55)]]);
    return { base, turret, upper, fore, wrist, gun, bell, grip, hose };
  });
}

// ---------- 操作工（1.75 m） ----------
export function workerGeoms() {
  return once('worker', () => {
    const leg = new THREE.BoxGeometry(0.14, 0.84, 0.17); leg.translate(0, -0.42, 0);
    const shoe = new THREE.BoxGeometry(0.15, 0.08, 0.27); shoe.translate(0.0, -0.8, 0.04);
    const legs = mergeT([[leg, null], [shoe, null]]);
    const torso = rbox(0.4, 0.6, 0.24, 0.08); torso.translate(0, 0.3, 0);
    const arm = new THREE.BoxGeometry(0.1, 0.6, 0.11); arm.translate(0, -0.28, 0);
    const head = new THREE.SphereGeometry(0.105, 14, 10); head.scale(1, 1.12, 1.02);
    const helmet = new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const helmetM = mergeT([[helmet, null], [new THREE.CylinderGeometry(0.15, 0.15, 0.015, 16), T(0, 0.0, 0.02)]]);
    return { legs, torso, arm, head, helmet: helmetM };
  });
}

// ---------- 牵引车 + 13.6 m 厢式挂车（车头 +x） ----------
export function truckGeoms() {
  return once('truck', () => {
    const cab = mergeT([[rbox(2.3, 2.75, 2.45, 0.18, 3), T(0, 2.55, 0)], [rbox(0.4, 0.5, 2.3, 0.08), T(1.2, 1.45, 0)]]);
    const cabGlass = mergeT([[new THREE.BoxGeometry(0.06, 1.0, 2.15), T(1.17, 3.15, 0)], [new THREE.BoxGeometry(1.2, 0.7, 0.04), T(0.35, 3.1, 1.235)], [new THREE.BoxGeometry(1.2, 0.7, 0.04), T(0.35, 3.1, -1.235)]]);
    const chassis = mergeT([[new THREE.BoxGeometry(6.2, 0.32, 0.95), T(-1.6, 0.95, 0)], [rbox(1.8, 0.55, 0.6, 0.15), T(-1.0, 0.85, 1.0)], [rbox(1.8, 0.55, 0.6, 0.15), T(-1.0, 0.85, -1.0)], [new THREE.CylinderGeometry(0.9, 0.9, 0.12, 20), T(-3.4, 1.16, 0)]]);
    const tire = new THREE.CylinderGeometry(0.52, 0.52, 0.36, 18); tire.rotateX(Math.PI / 2);
    const tw = []; for (const x of [0.2, -3.3, -4.65]) for (const z of [-1.04, 1.04]) tw.push([tire, T(x, 0.52, z)]);
    const tractorTires = mergeT(tw);
    const box = boxUVgeo(13.6, 2.75, 2.55); box.translate(-6.8, 1.25 + 1.375, 0);
    const tChassis = mergeT([[new THREE.BoxGeometry(13.2, 0.35, 1.0), T(-6.8, 1.08, 0)], [new THREE.BoxGeometry(0.15, 1.0, 0.15), T(-1.9, 0.5, 0.8)], [new THREE.BoxGeometry(0.15, 1.0, 0.15), T(-1.9, 0.5, -0.8)]]);
    const ttw = []; for (const x of [-9.7, -11.0, -12.3]) for (const z of [-1.0, 1.0]) ttw.push([tire, T(x, 0.52, z)]);
    const trailerTires = mergeT(ttw);
    return { cab, cabGlass, chassis, tractorTires, box, tChassis, trailerTires };
  });
}
function boxUVgeo(w, h, d) { // 挂车箱体：uv 按米
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv; const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]); }
  return g;
}

// ---------- 叉车（车头 +x，货叉在 +x） ----------
export function forkliftGeoms() {
  return once('fork', () => {
    const body = mergeT([[rbox(1.9, 0.75, 1.1, 0.12), T(-0.1, 0.62, 0)], [rbox(0.7, 0.7, 1.08, 0.18), T(-0.85, 1.2, 0)], [rbox(0.42, 0.3, 0.45, 0.06), T(-0.15, 1.15, 0)]]);
    const guard = mergeT([[new THREE.BoxGeometry(0.06, 1.25, 0.06), T(0.45, 1.6, 0.48)], [new THREE.BoxGeometry(0.06, 1.25, 0.06), T(0.45, 1.6, -0.48)], [new THREE.BoxGeometry(0.06, 1.25, 0.06), T(-0.55, 1.6, 0.48)], [new THREE.BoxGeometry(0.06, 1.25, 0.06), T(-0.55, 1.6, -0.48)], [new THREE.BoxGeometry(1.1, 0.06, 1.02), T(-0.05, 2.22, 0)]]);
    const mast = mergeT([[new THREE.BoxGeometry(0.1, 2.3, 0.12), T(0.92, 1.25, 0.35)], [new THREE.BoxGeometry(0.1, 2.3, 0.12), T(0.92, 1.25, -0.35)], [new THREE.BoxGeometry(0.08, 0.08, 0.82), T(0.92, 2.36, 0)]]);
    const forks = mergeT([[new THREE.BoxGeometry(0.06, 0.6, 0.9), T(1.0, 0.3, 0)], [new THREE.BoxGeometry(1.1, 0.05, 0.12), T(1.55, 0.03, 0.3)], [new THREE.BoxGeometry(1.1, 0.05, 0.12), T(1.55, 0.03, -0.3)]]);
    const tire = new THREE.CylinderGeometry(0.27, 0.27, 0.22, 16); tire.rotateX(Math.PI / 2);
    const tires = mergeT([[tire, T(0.55, 0.27, 0.45)], [tire, T(0.55, 0.27, -0.45)], [tire, T(-0.75, 0.27, 0.45)], [tire, T(-0.75, 0.27, -0.45)]]);
    return { body, guard, mast, forks, tires };
  });
}

// ---------- AGV（潜伏顶升式 + 料架） ----------
export function agvGeoms() {
  return once('agv', () => {
    const chassis = rbox(1.8, 0.3, 1.0, 0.08); chassis.translate(0, 0.18, 0);
    const deck = rbox(1.6, 0.06, 0.86, 0.02); deck.translate(0, 0.36, 0);
    const strip = mergeT([[new THREE.BoxGeometry(0.03, 0.05, 0.8), T(0.91, 0.22, 0)], [new THREE.BoxGeometry(0.03, 0.05, 0.8), T(-0.91, 0.22, 0)]]);
    const lidar = new THREE.CylinderGeometry(0.07, 0.07, 0.08, 12); lidar.translate(0.78, 0.43, 0);
    const cart = mergeT([[new THREE.BoxGeometry(1.5, 0.05, 0.8), T(0, 0.45, 0)], [new THREE.BoxGeometry(1.5, 0.04, 0.8), T(0, 0.98, 0)], ...[[-0.72, -0.37], [-0.72, 0.37], [0.72, -0.37], [0.72, 0.37]].map(([x, z]) => [new THREE.BoxGeometry(0.05, 0.95, 0.05), T(x, 0.92, z)])]);
    const bins = mergeT([[rbox(0.62, 0.32, 0.38, 0.03), T(-0.36, 0.64, -0.2)], [rbox(0.62, 0.32, 0.38, 0.03), T(0.36, 0.64, -0.2)], [rbox(0.62, 0.32, 0.38, 0.03), T(-0.36, 0.64, 0.2)], [rbox(0.62, 0.32, 0.38, 0.03), T(0.36, 0.64, 0.2)], [rbox(0.62, 0.3, 0.38, 0.03), T(-0.36, 1.16, 0)], [rbox(0.62, 0.3, 0.38, 0.03), T(0.36, 1.16, 0)]]);
    return { chassis, deck, strip, lidar, cart, bins };
  });
}
