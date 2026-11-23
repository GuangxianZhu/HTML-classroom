// three.js 这一层：把车库模块描述的物体画出来，并按动作原语播放动画。
// 车库模块不直接 import three，而是通过这里的 Ctx 搭场景，所以调度逻辑能在 node 里单独自检。
// 坐标约定和车库模块一样：x 右、y 上、z 朝向观众；朝向角绕 +y 转。
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { posesAt, stepDuration } from './motion.js';
import { carIdx } from './garages/base.js';

export const CAR_COLORS = [[0.9, 0.15, 0.15], [1.0, 0.55, 0.0], [0.0, 0.75, 0.85], [0.2, 0.75, 0.2],
  [0.85, 0.2, 0.85], [0.95, 0.85, 0.1], [0.55, 0.4, 1.0], [0.3, 0.5, 0.95]];
const PALLET = [0.72, 0.72, 0.68];
const STEEL = [0.25, 0.35, 0.55];

// ---- 轿车外形（车头朝 -z）。侧面轮廓 (z, y)：下车身和车舱各是一个凸多边形 ----
const CAR_BODY = [[-1.90, 0.18], [1.90, 0.18], [2.04, 0.26], [2.05, 0.62], [1.95, 0.76], [1.40, 0.82],
  [-0.60, 0.82], [-1.85, 0.72], [-2.05, 0.60], [-2.06, 0.28]];
const CAR_CABIN = [[-0.62, 0.81], [1.42, 0.81], [0.95, 1.27], [-0.10, 1.27]];
const CAR_ROOF = [[-0.12, 1.25], [0.97, 1.25], [0.93, 1.31], [-0.08, 1.31]];
const GLASS = [0.16, 0.22, 0.30];
const TIRE = [0.07, 0.07, 0.08];
const RIM = [0.78, 0.79, 0.82];
const WHEEL_R = 0.31, WHEEL_Z = 1.32, WHEEL_X = 0.70;

function carShapes(color) {
  const dark = color.map((c) => c * 0.55);
  const s = [
    ['prism', CAR_BODY, [-0.86, 0.86], color],
    ['prism', CAR_CABIN, [-0.72, 0.72], GLASS],        // 整个车舱是玻璃色，看起来就是车窗
    ['prism', CAR_ROOF, [-0.70, 0.70], color],
    ['box', [-0.725, 1.04, 0.42], [0.02, 0.46, 0.12], color],   // B 柱
    ['box', [0.725, 1.04, 0.42], [0.02, 0.46, 0.12], color],
    ['box', [-0.865, 0.62, 0], [0.02, 0.05, 3.7], dark],        // 腰线
    ['box', [0.865, 0.62, 0], [0.02, 0.05, 3.7], dark],
    ['box', [-0.58, 0.56, -2.06], [0.38, 0.12, 0.04], [1, 0.97, 0.8]],   // 前大灯
    ['box', [0.58, 0.56, -2.06], [0.38, 0.12, 0.04], [1, 0.97, 0.8]],
    ['box', [0, 0.47, -2.075], [0.62, 0.16, 0.03], [0.12, 0.12, 0.14]],  // 格栅
    ['box', [0, 0.30, -2.08], [0.44, 0.12, 0.02], [0.95, 0.95, 0.95]],   // 前车牌
    ['box', [-0.60, 0.62, 2.05], [0.36, 0.11, 0.04], [0.85, 0.08, 0.08]], // 尾灯
    ['box', [0.60, 0.62, 2.05], [0.36, 0.11, 0.04], [0.85, 0.08, 0.08]],
    ['box', [0, 0.40, 2.06], [0.44, 0.12, 0.02], [0.95, 0.95, 0.95]],    // 后车牌
    ['box', [-0.93, 0.92, -0.48], [0.14, 0.09, 0.14], color],            // 后视镜
    ['box', [0.93, 0.92, -0.48], [0.14, 0.09, 0.14], color],
  ];
  for (const z of [-WHEEL_Z, WHEEL_Z]) {
    for (const side of [-1, 1]) {
      const xin = side * WHEEL_X;
      s.push(['cyl', [xin, WHEEL_R, z], [side * 0.22, 0, 0], WHEEL_R, TIRE]);
      s.push(['cyl', [xin + side * 0.2, WHEEL_R, z], [side * 0.035, 0, 0], WHEEL_R * 0.58, RIM]);
    }
  }
  return s;
}

// ---- 几何体和材质缓存 ----
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 28).translate(0, 0.5, 0);   // 沿 +y 从 0 到 1
const prismCache = new Map();
const matCache = new Map();

function mat(color, opacity = 1) {
  const key = color.join(',') + '|' + opacity;
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace),
      roughness: 0.62, metalness: 0.08,
    });
    if (opacity < 1) Object.assign(m, { transparent: true, opacity, depthWrite: false });
    matCache.set(key, m);
  }
  return matCache.get(key);
}

// 侧面轮廓（(z, y) 点，凸多边形）沿 x 从 x0 拉伸到 x1 得到的柱体，每个面单独法线，棱角分明
function prismGeometry(profile, x0, x1) {
  const key = JSON.stringify([profile, x0, x1]);
  if (prismCache.has(key)) return prismCache.get(key);
  const pos = [];
  const tri = (a, b, c, n) => {
    const ab = new THREE.Vector3().subVectors(b, a), ac = new THREE.Vector3().subVectors(c, a);
    if (ab.cross(ac).dot(n) < 0) [b, c] = [c, b];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const face = (pts, n) => { for (let i = 1; i < pts.length - 1; i++) tri(pts[0], pts[i], pts[i + 1], n); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  face(profile.map(([z, y]) => V(x0, y, z)), V(-1, 0, 0));
  face(profile.map(([z, y]) => V(x1, y, z)), V(1, 0, 0));
  const cz = profile.reduce((s, p) => s + p[0], 0) / profile.length;
  const cy = profile.reduce((s, p) => s + p[1], 0) / profile.length;
  profile.forEach(([z0, y0], i) => {
    const [z1, y1] = profile[(i + 1) % profile.length];
    let nz = y1 - y0, ny = -(z1 - z0);
    if (nz * ((z0 + z1) / 2 - cz) + ny * ((y0 + y1) / 2 - cy) < 0) { nz = -nz; ny = -ny; }
    face([V(x0, y0, z0), V(x1, y0, z0), V(x1, y1, z1), V(x0, y1, z1)], V(0, ny, nz));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  prismCache.set(key, g);
  return g;
}

function boxMesh(pos, size, color, opacity = 1) {
  const m = new THREE.Mesh(BOX, mat(color, opacity));
  m.position.set(...pos);
  m.scale.set(Math.max(size[0], 1e-4), Math.max(size[1], 1e-4), Math.max(size[2], 1e-4));
  return m;
}

function cylMesh(pos, axis, radius, color) {
  const a = new THREE.Vector3(...axis);
  const len = a.length();
  const m = new THREE.Mesh(CYL, mat(color));
  m.position.set(...pos);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.clone().normalize());
  m.scale.set(radius, len, radius);
  return m;
}

function labelEl(text, cls) {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  return el;
}

// 一辆车只建一次模板（每种颜色一个），之后克隆，几何体和材质共享
const carTemplates = new Map();
function carTemplate(idx) {
  const k = (idx - 1) % CAR_COLORS.length;
  if (!carTemplates.has(k)) {
    const g = new THREE.Group();
    addShapes(g, carShapes(CAR_COLORS[k]));
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    carTemplates.set(k, g);
  }
  return carTemplates.get(k);
}

function addShapes(group, shapes) {
  for (const s of shapes) {
    if (s[0] === 'box') group.add(boxMesh(s[1], s[2], s[3]));
    else if (s[0] === 'cyl') group.add(cylMesh(s[1], s[2], s[3], s[4]));
    else if (s[0] === 'prism') group.add(new THREE.Mesh(prismGeometry(s[1], s[2][0], s[2][1]), mat(s[3])));
    else if (s[0] === 'label') {
      const l = new CSS2DObject(labelEl(s[2], 'lbl boxed'));
      l.position.set(...s[1]);
      group.add(l);
    }
  }
}

// 移除节点时把 CSS2D 标签的 DOM 也删掉（CSS2DRenderer 只在直接移除标签本身时才会删）
function dropNode(o) {
  o.traverse((c) => { if (c.element && c.element.parentNode) c.element.parentNode.removeChild(c.element); });
  o.removeFromParent();
}

class Part {
  constructor(node, anchor, heading = 0) {
    this.node = node;
    this.setPose(anchor, heading);
  }
  setPose(anchor, heading) {
    this.anchor = [...anchor];
    this.heading = heading;
    this.node.position.set(...anchor);
    this.node.rotation.y = THREE.MathUtils.degToRad(heading);
  }
}

export class Ctx {
  constructor(scene) {
    this.scene = scene;
    this.newRoot();
  }

  newRoot() {
    this.root = new THREE.Group();
    this.staticRoot = new THREE.Group();
    this.root.add(this.staticRoot);
    this.scene.add(this.root);
    this.parts = {};
    this.tags = {};
    this.hl = null;
  }

  // ---- 静态物体 ----
  box(pos, size, color = STEEL, opacity = 1) { const m = boxMesh(pos, size, color, opacity); this.staticRoot.add(m); return m; }
  cyl(pos, axis, radius, color = STEEL) { const m = cylMesh(pos, axis, radius, color); this.staticRoot.add(m); return m; }
  text(pos, txt, height = 13) {
    const el = labelEl(txt, 'lbl plain');
    el.style.fontSize = `${height + 1}px`;
    const l = new CSS2DObject(el);
    l.position.set(...pos);
    this.root.add(l);
    return l;
  }
  ground(cx, cz, sx, sz) { this.box([cx, -0.06, cz], [sx, 0.1, sz], [0.55, 0.55, 0.55]).userData.ground = true; }
  driveway(x, z0, z1, w = 2.6) {
    this.box([x, -0.005, (z0 + z1) / 2], [w, 0.02, Math.abs(z1 - z0)], [0.33, 0.33, 0.36]).userData.ground = true;
    // 车道中间的虚线
    for (let z = Math.min(z0, z1) + 0.6; z < Math.max(z0, z1) - 0.4; z += 1.6) {
      this.box([x, 0.008, z], [0.12, 0.004, 0.8], [0.92, 0.88, 0.6]).userData.ground = true;
    }
  }

  // ---- 可动物体 ----
  part(name, pos, shapes, heading = 0) {
    const node = new THREE.Group();
    node.name = name;
    addShapes(node, shapes);
    node.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.root.add(node);
    this.parts[name] = new Part(node, pos, heading);
    return this.parts[name];
  }

  pallet(name, pos, { w = 2.5, d = 4.8, tag = null, heading = 0 } = {}) {
    const shapes = [['box', [0, 0, 0], [w, 0.1, d], PALLET],
      ['box', [-w / 2 + 0.06, 0.08, 0], [0.08, 0.08, d], [0.5, 0.5, 0.48]],
      ['box', [w / 2 - 0.06, 0.08, 0], [0.08, 0.08, d], [0.5, 0.5, 0.48]]];
    if (tag) shapes.push(['label', [0, 0.15, d / 2 - 0.2], tag]);
    return this.part(name, pos, shapes, heading);
  }

  car(name, pos, idx, heading = 0) {
    const node = carTemplate(idx).clone();
    node.name = name;
    this.root.add(node);
    this.parts[name] = new Part(node, pos, heading);
    return this.parts[name];
  }

  spawnCar(a) {
    if (this.parts[a.name]) {          // 司机视角下车已经提前开到入口等着了，这里只校正位置
      this.parts[a.name].setPose(a.pos, a.heading || 0);
      return;
    }
    this.car(a.name, a.pos, carIdx(a.name), a.heading || 0);
  }

  // ---- 司机视角用：车牌标签、高亮框 ----
  tag(name, text, replace = true) {
    const old = this.tags[name];
    if (old && old.parent) {
      if (!replace) return old;
      dropNode(old);
    }
    if (!this.parts[name]) return null;
    const l = new CSS2DObject(labelEl(text, 'lbl tag'));
    l.position.set(0, 2.0, 0);
    this.parts[name].node.add(l);
    this.tags[name] = l;
    return l;
  }

  highlight({ pos = null, follow = null, size = [2.9, 2.0, 5.4] } = {}) {
    this.clearHighlight();
    const m = new THREE.MeshBasicMaterial({ color: 0xffcc1a, transparent: true, opacity: 0.35, depthWrite: false });
    const hl = new THREE.Mesh(BOX, m);
    hl.scale.set(...size);
    if (follow && this.parts[follow]) {
      hl.position.set(0, size[1] / 2, 0);
      this.parts[follow].node.add(hl);
    } else {
      hl.position.set(pos[0], pos[1] + size[1] / 2, pos[2]);
      this.root.add(hl);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(BOX), new THREE.LineBasicMaterial({ color: 0xe0a000 }));
    hl.add(edges);
    this.hl = hl;
  }

  clearHighlight() {
    if (this.hl) { this.hl.material.dispose(); dropNode(this.hl); }
    this.hl = null;
  }

  pulse(t) {
    if (this.hl) this.hl.material.opacity = 0.25 + 0.2 * Math.sin(t * 5);
  }

  remove(name) {
    delete this.tags[name];
    const p = this.parts[name];
    delete this.parts[name];
    if (p) dropNode(p.node);
  }

  // 场景搭完后调用：把几百个静止的柱子、横梁按材质合并成少数几块，渲染更快
  finish() {
    const groups = new Map();
    for (const m of [...this.staticRoot.children]) {
      if (!m.isMesh) continue;
      const k = m.material.uuid + (m.userData.ground ? 'g' : '');
      if (!groups.has(k)) groups.set(k, { mat: m.material, ground: !!m.userData.ground, geos: [] });
      m.updateMatrix();
      groups.get(k).geos.push(m.geometry.index ? m.geometry.toNonIndexed().applyMatrix4(m.matrix) : m.geometry.clone().applyMatrix4(m.matrix));
      m.removeFromParent();
    }
    for (const g of groups.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(g.geos), g.mat);
      if (g.ground) mesh.receiveShadow = true;
      else { mesh.castShadow = true; mesh.receiveShadow = true; }
      this.staticRoot.add(mesh);
    }
  }

  clear() {
    this.clearHighlight();
    this.root.traverse((o) => { if (o.isMesh && o.parent === this.staticRoot) o.geometry.dispose(); });
    dropNode(this.root);
    this.newRoot();
  }

  // 场景的包围盒（定阴影范围用）
  bounds() {
    return new THREE.Box3().setFromObject(this.root);
  }

  // 播放一步：tick() 每帧调用一次，返回 true 表示这一步放完了
  play(step) {
    for (const a of step.actions) if (a.op === 'spawn') this.spawnCar(a);
    const names = new Set();
    for (const a of step.actions) {
      for (const n of a.names || []) names.add(n);
      for (const [ns] of a.items || []) for (const n of ns) names.add(n);
    }
    const start = {};
    for (const n of names) if (this.parts[n]) start[n] = [this.parts[n].anchor, this.parts[n].heading];
    const T = stepDuration(step);
    let tau = 0;
    const done = () => { for (const a of step.actions) if (a.op === 'remove') this.remove(a.name); };
    if (T <= 0) { done(); return { tick: () => true, get tau() { return 0; } }; }
    const self = this;
    return {
      get tau() { return tau; },
      tick(simDt) {
        tau = Math.min(T, tau + simDt);
        const p = posesAt(start, step, tau);
        for (const n of Object.keys(p)) if (self.parts[n]) self.parts[n].setPose(p[n][0], p[n][1]);
        if (tau >= T) { done(); return true; }
        return false;
      },
    };
  }
}
