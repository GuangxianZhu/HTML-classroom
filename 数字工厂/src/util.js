// 10-util：参数、随机数、调色板、材质（世界坐标污渍 + 贴地暗角）、静态合并、实例化零件
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const Q = new URLSearchParams(location.search);
export const flag = (k) => Q.has(k) && !['0', 'false', 'off'].includes(Q.get(k));
export const num = (k, d) => (Q.has(k) && Q.get(k) !== '' && !isNaN(+Q.get(k)) ? +Q.get(k) : d);

export const C = {
  void: 0x060708, amber: 0xf2a73b, green: 0x9ed6b4, red: 0xff5638,
  concrete: 0x8c877f, concreteDark: 0x5f5b55, steel: 0x7a7f86, steelDark: 0x383c42,
  graphite: 0x2a2d32, ivory: 0xccc5b6, orange: 0xd2642a, yellow: 0xc9a23c,
  rubber: 0x141516, kraft: 0xa27a51, film: 0xcbc7bd, bin: 0x56687a, binGrey: 0x6d7175,
  glass: 0x8fa6b2, asphalt: 0x2b2c2e,
};

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const R = mulberry32(20261119);
export const rr = (a, b) => a + (b - a) * R();
export const ri = (a, b) => Math.floor(rr(a, b + 1));
export const pick = (arr) => arr[Math.floor(R() * arr.length)];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const damp = (cur, goal, k, dt) => cur + (goal - cur) * (1 - Math.exp(-k * dt));

// ---------- 材质 ----------
const MATS = {};
const NOISE_GLSL = `
varying vec3 vWP; uniform float uGrime; uniform float uAO;
float dfH(vec3 p){ p = fract(p*0.3183099 + vec3(0.71,0.113,0.419)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float dfN(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(dfH(i),dfH(i+vec3(1,0,0)),f.x),mix(dfH(i+vec3(0,1,0)),dfH(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(dfH(i+vec3(0,0,1)),dfH(i+vec3(1,0,1)),f.x),mix(dfH(i+vec3(0,1,1)),dfH(i+vec3(1,1,1)),f.x),f.y),f.z); }
`;
function addGrime(m, grime, ao) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrime = { value: grime };
    sh.uniforms.uAO = { value: ao };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 dfw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          dfw = instanceMatrix * dfw;
        #endif
        vWP = (modelMatrix * dfw).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dfg = dfN(vWP*0.85)*0.55 + dfN(vWP*3.3)*0.3 + dfN(vWP*11.0)*0.15;
        diffuseColor.rgb *= 1.0 - uGrime*0.16*(dfg-0.4);
        diffuseColor.rgb *= mix(1.0 - 0.32*uAO, 1.0, smoothstep(0.0, 0.85, vWP.y));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + uGrime*0.14*(dfg-0.45), 0.05, 1.0);`);
  };
  m.customProgramCacheKey = () => 'dfg' + grime + '_' + ao;
}

// M(key, params, {grime, ao, shadow})：按 key 缓存的统一 PBR 材质
export function M(key, params = {}, opt = {}) {
  if (MATS[key]) return MATS[key];
  const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.7, metalness: 0, envMapIntensity: 0.55 }, params));
  m.name = key;
  if (opt.grime !== 0) addGrime(m, opt.grime ?? 1, opt.ao ?? 1);
  m.userData.shadow = opt.shadow !== false;
  MATS[key] = m;
  return m;
}
export function basic(key, params) {
  if (MATS[key]) return MATS[key];
  const m = new THREE.MeshBasicMaterial(params);
  m.name = key; m.userData.shadow = false;
  MATS[key] = m; return m;
}

// 常用材质
export const MAT = {};
export function initMaterials() {
  MAT.concrete = M('concrete', { color: C.concrete, roughness: 0.9 });
  MAT.concreteDark = M('concreteDark', { color: C.concreteDark, roughness: 0.92 });
  MAT.steel = M('steel', { color: C.steel, roughness: 0.38, metalness: 0.75 });
  MAT.steelDark = M('steelDark', { color: C.steelDark, roughness: 0.5, metalness: 0.6 });
  MAT.graphite = M('graphite', { color: C.graphite, roughness: 0.55, metalness: 0.25 });
  MAT.ivory = M('ivory', { color: C.ivory, roughness: 0.42, metalness: 0.05 });
  MAT.orange = M('orange', { color: C.orange, roughness: 0.42, metalness: 0.08 });
  MAT.yellow = M('yellow', { color: C.yellow, roughness: 0.5, metalness: 0.05 });
  MAT.rubber = M('rubber', { color: C.rubber, roughness: 0.85 }, { grime: 0.5 });
  MAT.white = M('white', { color: 0xffffff, roughness: 0.5 }, { grime: 0.6 });
  MAT.paint = M('paint', { color: 0xffffff, roughness: 0.32, metalness: 0.2, envMapIntensity: 0.45 }, { grime: 0.15, ao: 0.6 });
  MAT.biw = M('biw', { color: 0x9aa0a6, roughness: 0.35, metalness: 0.85 }, { grime: 0.5 });
  MAT.glassDark = M('glassDark', { color: 0x0d1114, roughness: 0.08, metalness: 0.4, envMapIntensity: 1.0 }, { grime: 0 });
  MAT.glass = M('glass', { color: C.glass, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.2 }, { grime: 0, shadow: false });
  MAT.mesh = M('meshFence', { color: 0x3d4146, roughness: 0.6, metalness: 0.4, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }, { grime: 0, shadow: false });
  MAT.wood = M('wood', { color: 0x8a6b4a, roughness: 0.9 });
  MAT.kraft = M('kraft', { color: 0xffffff, roughness: 0.85 }, { grime: 0.5 });
  MAT.lampW = basic('lampW', { color: 0xfff1d8 });
  MAT.lampAmber = basic('lampAmber', { color: 0xf2a73b });
  MAT.lampRed = basic('lampRed', { color: 0xff4a32 });
  MAT.lampGreen = basic('lampGreen', { color: 0x9ed6b4 });
  MAT.screen = basic('screen', { color: 0x1d2a33 });
  MAT.hot = basic('hot', { color: 0xff7a2a });
  return MAT;
}

// ---------- 几何 ----------
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
export function boxUV(w, h, d, s = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0] / s, uv.getY(k) * dims[f][1] / s);
  }
  return g;
}
function normGeom(g) {
  let n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  n.clearGroups();
  return n;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function trs(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// 静态场景构建器：同材质的单位盒全部实例化、任意几何按材质合并
export class Builder {
  constructor(scene) { this.scene = scene; this.boxes = new Map(); this.geoms = new Map(); this.meshes = []; }
  // 中心 (x,y,z)，尺寸 w h d，绕 y 旋转 ry
  box(mat, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) {
    if (w <= 0 || h <= 0 || d <= 0) return;
    let a = this.boxes.get(mat); if (!a) this.boxes.set(mat, (a = []));
    a.push(trs(x, y, z, rx, ry, rz, w, h, d));
  }
  // 底面中心落地
  boxB(mat, w, h, d, x, y0, z, ry = 0) { this.box(mat, w, h, d, x, y0 + h / 2, z, ry); }
  // 两点之间的杆件（方截面 t）
  beam(mat, a, b, t = 0.15, t2 = t) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz); if (L < 1e-4) return;
    const mid = new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(t, L, t2));
    let arr = this.boxes.get(mat); if (!arr) this.boxes.set(mat, (arr = []));
    arr.push(m);
  }
  geom(mat, g, matrix) {
    const n = normGeom(g);
    if (matrix) n.applyMatrix4(matrix);
    let a = this.geoms.get(mat); if (!a) this.geoms.set(mat, (a = []));
    a.push(n);
  }
  finalize() {
    for (const [mat, arr] of this.boxes) {
      const im = new THREE.InstancedMesh(UNIT_BOX, mat, arr.length);
      arr.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = mat.userData.shadow !== false; im.receiveShadow = true;
      im.name = 'box:' + mat.name; im.matrixAutoUpdate = false;
      this.scene.add(im); this.meshes.push(im);
    }
    for (const [mat, arr] of this.geoms) {
      for (let i = 0; i < arr.length; i += 400) {
        const g = mergeGeometries(arr.slice(i, i + 400), false);
        const mesh = new THREE.Mesh(g, mat);
        mesh.castShadow = mat.userData.shadow !== false; mesh.receiveShadow = true;
        mesh.name = 'geo:' + mat.name; mesh.matrixAutoUpdate = false;
        this.scene.add(mesh); this.meshes.push(mesh);
      }
    }
    this.boxes.clear(); this.geoms.clear();
  }
}

// 动态零件：节点是看不见的 Object3D（可层级驱动），每帧把世界矩阵写进 InstancedMesh
export class Parts {
  constructor(scene) {
    this.defs = new Map();
    this.root = new THREE.Group(); this.root.name = 'proxies'; // 不加入场景：每帧只更新一次世界矩阵
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }
  def(key, geometry, material, opt = {}) {
    if (this.defs.has(key)) return this.defs.get(key);
    const d = { key, geometry, material, nodes: [], color: !!opt.color, dyn: opt.dyn !== false, shadow: opt.shadow ?? material.userData.shadow !== false, im: null, cdirty: true };
    this.defs.set(key, d); return d;
  }
  has(key) { return this.defs.has(key); }
  node(key, parent, color) {
    const d = this.defs.get(key); if (!d) throw new Error('part ' + key);
    const o = new THREE.Object3D(); (parent || this.root).add(o);
    o.userData.def = d; o.userData.idx = d.nodes.length; o.userData.color = color != null ? new THREE.Color(color) : new THREE.Color(1, 1, 1);
    d.nodes.push(o); return o;
  }
  group(parent) { const g = new THREE.Object3D(); (parent || this.root).add(g); return g; }
  setColor(o, c) { o.userData.color.set(c); o.userData.def.cdirty = true; }
  finalize(scene) {
    this.root.updateMatrixWorld(true);
    for (const d of this.defs.values()) {
      if (!d.nodes.length) continue;
      const im = new THREE.InstancedMesh(d.geometry, d.material, d.nodes.length);
      im.castShadow = d.shadow; im.receiveShadow = true; im.name = 'part:' + d.key;
      im.matrixAutoUpdate = false;
      if (d.dyn) { im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
      if (d.color) d.nodes.forEach((o, i) => im.setColorAt(i, o.userData.color));
      d.im = im; scene.add(im);
      this.write(d);
      if (!d.dyn) im.computeBoundingSphere();
    }
  }
  vis(o) { while (o && o !== this.root) { if (!o.visible) return false; o = o.parent; } return true; }
  write(d) {
    const im = d.im;
    for (let i = 0; i < d.nodes.length; i++) {
      const o = d.nodes[i];
      im.setMatrixAt(i, this.vis(o) ? o.matrixWorld : this.zero);
    }
    im.instanceMatrix.needsUpdate = true;
    if (d.color && d.cdirty) { d.nodes.forEach((o, i) => im.setColorAt(i, o.userData.color)); im.instanceColor.needsUpdate = true; d.cdirty = false; }
  }
  sync() {
    this.root.updateMatrixWorld(true);
    for (const d of this.defs.values()) if (d.im && (d.dyn || d.cdirty)) this.write(d);
  }
}

// 画布纹理
export function canvasTex(w, h, draw, opt = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opt.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opt.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = opt.aniso ?? 8;
  t.needsUpdate = true;
  return t;
}

// 文字贴片（地面编号、标牌）
export function textPlate(lines, opt = {}) {
  const W = opt.w ?? 512, H = opt.h ?? 256;
  return canvasTex(W, H, (g) => {
    g.fillStyle = opt.bg ?? 'rgba(0,0,0,0)'; g.fillRect(0, 0, W, H);
    if (opt.border) { g.strokeStyle = opt.border; g.lineWidth = 4; g.strokeRect(6, 6, W - 12, H - 12); }
    g.fillStyle = opt.color ?? '#e9e2d0'; g.textBaseline = 'middle';
    lines.forEach((l, i) => {
      g.font = l.font ?? `600 ${l.size ?? 96}px Bahnschrift, "DIN Alternate", "Microsoft YaHei", sans-serif`;
      g.fillStyle = l.color ?? opt.color ?? '#e9e2d0';
      g.textAlign = l.align ?? 'left';
      g.fillText(l.t, l.x ?? 24, l.y ?? H / 2);
    });
  });
}
