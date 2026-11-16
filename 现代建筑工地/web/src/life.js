// 工地上动的东西：车辆进出大门、挖机挖土装车、成槽机和旋挖钻、泵车和地泵、塔吊吊钢构、施工电梯、工人。
// 哪些在场由施工阶段（day）决定；它们怎么动用真实时间（秒），所以暂停时工地也是活的。
// 坐标一律先用 Blender 的 (x, y, z)（z 向上），最后用 V() 转成 three。
import * as THREE from 'three';

const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, -1), z: new THREE.Vector3(0, 1, 0) };
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const frac = (x) => x - Math.floor(x);
const hash = (i) => frac(Math.sin(i * 127.1 + 311.7) * 43758.5453);

// 绕 Blender 局部轴转（在初始姿态上叠加）
function rot(o, axis, a) {
  if (!o) return;
  if (!o.userData.q0) o.userData.q0 = o.quaternion.clone();
  o.quaternion.copy(o.userData.q0).multiply(_q.setFromAxisAngle(AX[axis], a));
}
function place(o, x, y, z, h = 0) {
  o.position.copy(V(x, y, z));
  o.rotation.set(0, h, 0);
}
function angLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * t;
}

// ------------------------------------------------------------------ 路线：折线 + 圆角，按弧长取点
class Path {
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
class Inst {
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

const mat4 = (x, y, z, h = 0, s = 1) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(AX.z, h), new THREE.Vector3(s, s, s));

// ==================================================================
export class Life {
  constructor(stage, glb) {
    this.stage = stage;
    this.sch = stage.sch;
    this.P = stage.P;
    this.spec = stage.spec;
    this.scene = stage.scene;
    this.mats = stage.mats;
    this.root = new THREE.Group();
    this.root.name = 'life';
    this.scene.add(this.root);
    // 原型：从 MACHINES 下面摘出来，位置归零
    this.proto = {};
    const top = glb.getObjectByName('MACHINES') || glb;
    for (const c of [...top.children]) {
      c.position.set(0, 0, 0);
      this.proto[c.name] = c;
      c.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.transparent) { m.depthWrite = false; m.side = THREE.DoubleSide; } this.mats.add(m); }); });
    }
    this._site();
    this._roads();
    this._props();
    this._vehicles();
    this._machines();
    this._cranes();
    this._hoist();
    this._workers();
  }

  clone(name, paint = null) {
    const o = this.proto[name].clone(true);
    if (paint !== null) o.traverse((m) => {
      if (m.isMesh && m.material.name === 'car_paint') { m.material = m.material.clone(); m.material.color.setHex(paint); this.mats.add(m.material); }
    });
    this.root.add(o);
    return o;
  }
  node(o, suffix) { return o.getObjectByName(o.name + suffix) || o.getObjectByName(this._base(o) + suffix); }
  _base(o) { return o.userData.base || o.name; }

  // ---------------------------------------------------------------- 场地几何（和 stage._buildSite 一致）
  _site() {
    const B = this.P.tower.basement;
    const [cx, cy] = B.center, [sx, sy] = B.size;
    const g = { x0: cx - sx / 2, x1: cx + sx / 2, y0: cy - sy / 2, y1: cy + sy / 2, cx };
    g.hx0 = g.x0 - 1; g.hx1 = g.x1 + 1; g.hy0 = g.y0 - 1; g.hy1 = g.y1 + 1;
    g.fx0 = g.x0 - 26; g.fx1 = g.x1 + 26; g.fy0 = g.y0 - 30; g.fy1 = g.y1 + 24;
    g.rS = (g.fy0 + g.hy0) / 2;     // 场内环路：南
    g.rE = (g.fx1 + g.hx1) / 2;     // 东
    g.rN = (g.fy1 + g.hy1) / 2;     // 北
    g.rW = (g.fx0 + g.hx0) / 2;     // 西
    g.road = g.fy0 - 12;            // 市政路中线
    g.laneW = g.road + 4;           // 向西车道（靠北）
    g.laneE = g.road - 4;           // 向东车道
    this.g = g;
    // 进场车辆统一的一条路线：东边来 → 右转进大门 → 场内逆时针一圈 → 出大门 → 右转往西走
    const gin = cx + 4, gout = cx - 4;
    this.route = new Path([[260, g.laneW], [gin, g.laneW], [gin, g.rS], [g.rE, g.rS], [g.rE, g.rN], [g.rW, g.rN], [g.rW, g.rS], [gout, g.rS], [gout, g.laneW], [-260, g.laneW]], 9);
    this.loopS0 = this.route.nearest(gin, g.rS);
    this.loopS1 = this.route.nearest(gout, g.rS + 0.01, this.loopS0 + 10);
  }

  _roads() {
    const g = this.g;
    const mk = (c, r = 0.9) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: r }); this.mats.add(m); return m; };
    const box = (lo, hi, m) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]), m);
      o.position.copy(V((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2));
      this.root.add(o);
      return o;
    };
    const asphalt = mk(0x3d4045), side = mk(0xb3b0a8), white = mk(0xe8e8e2, 0.6), yellow = mk(0xe2b23a, 0.6);
    box([-300, g.road - 8, -0.02], [300, g.road + 8, 0.012], asphalt);
    box([-300, g.road + 8, -0.02], [300, g.fy0 - 0.2, 0.15], side);
    box([-300, g.road - 12, -0.02], [300, g.road - 8, 0.15], side);
    for (let x = -296; x < 296; x += 9) box([x, g.road - 0.08, 0.012], [x + 4.5, g.road + 0.08, 0.02], yellow);
    for (const yy of [g.road - 7.6, g.road + 7.6]) box([-300, yy - 0.06, 0.012], [300, yy + 0.06, 0.02], white);
    box([g.cx - 7, g.road + 8, 0.0], [g.cx + 7, g.fy0, 0.03], asphalt);            // 大门口坡道
    // 场内环路（压实路面，比硬化地面深一点）
    const rd = mk(0x6f6e6a);
    const w = 3.6;
    box([g.fx0 + 3, g.rS - w, 0.0], [g.fx1 - 3, g.rS + w, 0.015], rd);
    box([g.fx0 + 3, g.rN - w, 0.0], [g.fx1 - 3, g.rN + w, 0.015], rd);
    box([g.rW - w, g.rS - w, 0.0], [g.rW + w, g.rN + w, 0.015], rd);
    box([g.rE - w, g.rS - w, 0.0], [g.rE + w, g.rN + w, 0.015], rd);
    box([g.cx - 7, g.fy0, 0.0], [g.cx + 7, g.rS, 0.015], rd);
    // 项目部门口停车场
    box([-70, g.road - 22, -0.02], [-20, g.road - 12, 0.02], asphalt);
    for (let x = -68; x <= -22; x += 3) box([x - 0.06, g.road - 21.5, 0.02], [x + 0.06, g.road - 16.5, 0.03], white);
  }

  _props() {
    const g = this.g;
    const put = (name, x, y, h = 0) => { const o = this.clone(name); place(o, x, y, 0, h); return o; };
    put('P_Office', -45, g.road - 27, 0);
    put('P_Guard', g.cx + 13, g.fy0 + 4, 0);
    this.wash = put('P_Wash', g.cx + 4, g.fy0 + 6, Math.PI / 2);
    put('P_Board', g.cx - 18, g.fy0 + 1.2, 0);
    put('P_Shed', -36, g.fy0 + 4.6, Math.PI / 2);
    this.stackSW = put('P_SteelStack', -30, g.hy0 - 7, 0);
    this.stackNE = put('P_SteelStack', 22, g.hy1 + 5, 0);
    put('P_Charger', g.rE + 7.5, g.rS + 22, Math.PI / 2);
    put('P_Transformer', g.rE + 8, 10, Math.PI / 2);
    for (const [x, y] of [[g.fx0 + 3, g.fy0 + 3], [g.fx1 - 3, g.fy0 + 3], [g.fx1 - 3, g.fy1 - 3], [g.fx0 + 3, g.fy1 - 3]]) put('P_Light', x, y, Math.atan2(-y, -x));
    // 停着的两辆小车
    const c1 = this.clone('M_SUV', 0x2b2f36); place(c1, -60, g.road - 19, 0, Math.PI / 2);
    const c2 = this.clone('M_Pickup', 0xb8bcc2); place(c2, -54, g.road - 19, 0, Math.PI / 2);
    this.siteProps = [this.stackSW, this.stackNE];
  }

  // ---------------------------------------------------------------- 车辆
  _vehicles() {
    const R = this.route;
    this.fleet = [];
    const add = (proto, n, paint = null) => {
      for (let i = 0; i < n; i++) {
        const o = this.clone(proto, paint ? paint[i % paint.length] : null);
        o.userData.base = proto;
        const wheels = [];
        o.traverse((c) => { if (c.userData && c.userData.kind === 'wheel') wheels.push(c); });
        this.fleet.push({ o, proto, i, wheels, r: wheels.length ? wheels[0].userData.r || 0.5 : 0.5,
          load: this.node(o, '_Load'), cargo: this.node(o, '_Cargo'), drum: this.node(o, '_Drum') });
      }
    };
    add('M_DumpTruck', 5);
    add('M_Mixer', 6);
    add('M_Flatbed', 3);
    add('M_SUV', 3, [0xe6e6e6, 0x9aa3ad, 0x6b1f1f]);
    add('M_Pickup', 2, [0xf2f2f2, 0x2f4f7f]);
    this.speed = 7;
    this.dwell = 20;
    this.traffic = [new Path([[-260, this.g.laneE], [260, this.g.laneE]]), new Path([[260, this.g.laneW], [-260, this.g.laneW]])];
  }

  // 每类车此刻在场几辆、停在哪
  _plan(st) {
    const k = this.sch.ph[st.phase].key, c = st.core, g = this.g;
    const pouring = c.cur && c.step === 2;
    const plan = { M_DumpTruck: [0], M_Mixer: [0], M_Flatbed: [0] };
    const stop = (x, y) => this.route.nearest(x, y, this.loopS0, this.loopS1);
    if (k === 'dwall') {
      const p = this.grabAt;
      plan.M_DumpTruck = [2, stop(p.x, p.y)];
      plan.M_Mixer = [2, stop(p.x + 6, p.y)];
    } else if (k === 'excavate') {
      plan.M_DumpTruck = [5, stop(this.lr.x, g.rN)];
    } else if (k === 'raft') {
      plan.M_Mixer = [6, stop(12, g.rS)];
    } else if (k === 'basement') {
      plan.M_Mixer = [3, stop(12, g.rS)];
      plan.M_Flatbed = [2, null];
    } else if (['low', 'install', 'cycle', 'dismantle'].includes(k)) {
      plan.M_Mixer = [pouring ? 4 : 2, stop(-2, g.rS)];
      plan.M_Flatbed = [k === 'dismantle' ? 2 : 3, null];
    } else if (k === 'curtain') {
      plan.M_Flatbed = [2, null];
      plan.M_Mixer = [1, stop(-2, g.rS)];
    } else if (k === 'site') {
      plan.M_Flatbed = [1, null];
    }
    this.flatStops = [stop(-30, g.rS), stop(22, g.rN)];
    return plan;
  }

  _drive(v, t, n, stopS) {
    const R = this.route;
    const T = R.len / this.speed + this.dwell;
    const tau = frac((t + (v.i * T) / Math.max(1, n) + v.i * 3.7) / T) * T;
    const t1 = stopS / this.speed;
    let s, state;
    if (tau < t1) { s = tau * this.speed; state = 'in'; }
    else if (tau < t1 + this.dwell) { s = stopS; state = 'stop'; }
    else { s = stopS + (tau - t1 - this.dwell) * this.speed; state = 'out'; }
    const p = R.at(s);
    place(v.o, p.x, p.y, 0, p.h);
    v.o.visible = Math.abs(p.x) < 200;
    for (const w of v.wheels) rot(w, 'y', s / v.r);
    return { state, u: (tau - t1) / this.dwell };
  }

  // ---------------------------------------------------------------- 挖机、成槽机、旋挖钻、泵车、地泵
  _machines() {
    const g = this.g;
    this.ex = [this.clone('M_Excavator'), this.clone('M_Excavator')];
    this.ex.forEach((o) => { o.userData.base = 'M_Excavator'; });
    this.lrO = this.clone('M_LongReach');
    this.lrO.userData.base = 'M_LongReach';
    this.lr = { x: g.cx + 4, y: g.hy1 + 2.5 };
    this.grabO = this.clone('M_Grab'); this.grabO.userData.base = 'M_Grab';
    this.ccO = this.clone('M_CrawlerCrane'); this.ccO.userData.base = 'M_CrawlerCrane';
    this.rigO = this.clone('M_Rig'); this.rigO.userData.base = 'M_Rig';
    this.ptO = this.clone('M_PumpTruck'); this.ptO.userData.base = 'M_PumpTruck';
    this.gpO = this.clone('M_GroundPump'); this.gpO.userData.base = 'M_GroundPump';
    place(this.gpO, -7.35, g.hy0 - 6.5, 0, Math.PI / 2);
    place(this.ptO, 2, g.hy0 - 7, 0, Math.PI);
    // 泵管：地泵 → 往北穿过地下室顶板 → 核心筒里竖着上到造楼机
    const pm = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.6 });
    this.mats.add(pm);
    const geo = new THREE.CylinderGeometry(0.07, 0.07, 1, 8);
    geo.translate(0, 0.5, 0);
    this.pipeH = new THREE.Mesh(geo, pm);
    this.pipeV = new THREE.Mesh(geo, pm);
    this.root.add(this.pipeH, this.pipeV);
    this.pipeH.position.copy(V(-7.35, g.hy0 - 2.5, 0.3));
    this.pipeH.rotation.x = -Math.PI / 2;   // 沿 three -z（Blender +y）
    this.pipeH.scale.y = -(g.hy0 - 2.5) + 0.5;
    this.pipeV.position.copy(V(-7.35, 0.4, 0.3));
    // 地连墙钢筋笼、桩：现场生成
    const rebar = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.8, metalness: 0.4, wireframe: true });
    this.mats.add(rebar);
    this.cage = new THREE.Mesh(new THREE.BoxGeometry(2.6, 14, 0.7, 4, 12, 1), rebar);
    this.root.add(this.cage);
    const casing = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.5, metalness: 0.7 });
    const pileHead = new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.9 });
    this.mats.add(casing); this.mats.add(pileHead);
    this.piles = [];
    for (let x = -21; x <= 21.01; x += 6) for (let y = -21; y <= 21.01; y += 6) this.piles.push([x, y]);
    this.piles.sort((a, b) => hash(a[0] * 7 + a[1]) - hash(b[0] * 7 + b[1]));
    this.casings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 0.7, 0.6, 14), casing, this.piles.length);
    this.pileHeads = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.6, 0.6, 0.5, 14), pileHead, this.piles.length);
    this.piles.forEach(([x, y], i) => {
      this.casings.setMatrixAt(i, mat4(x, y, 0.25));
      this.pileHeads.setMatrixAt(i, mat4(x, y, -20.6 + 0.2));
    });
    this.root.add(this.casings, this.pileHeads);
    // 地连墙：沿基坑一圈的中线，按进度取当前那一幅
    const lines = [];
    const m = 0.5;
    lines.push([[g.x0, g.y0 - m], [g.x1, g.y0 - m], [0, -1]], [[g.x1 + m, g.y0], [g.x1 + m, g.y1], [1, 0]], [[g.x1, g.y1 + m], [g.x0, g.y1 + m], [0, 1]], [[g.x0 - m, g.y1], [g.x0 - m, g.y0], [-1, 0]]);
    this.wallLine = lines;
    this.wallLen = lines.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
    this.grabAt = { x: 0, y: g.y0 - m };
  }

  _wallPoint(f) {
    let s = clamp(f, 0, 0.9999) * this.wallLen;
    for (const [a, b, n] of this.wallLine) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (s <= L) { const t = s / L; return { x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t), nx: n[0], ny: n[1] }; }
      s -= L;
    }
    const [a, , n] = this.wallLine[0];
    return { x: a[0], y: a[1], nx: n[0], ny: n[1] };
  }

  // 挖机姿态：[回转, 动臂, 斗杆, 铲斗]（Blender y 轴转角，正 = 往下 / 往里收）
  _exPose(o, p) {
    rot(this.node(o, '_Slew'), 'z', p[0]);
    rot(this.node(o, '_Boom'), 'y', p[1]);
    rot(this.node(o, '_Arm'), 'y', p[2]);
    rot(this.node(o, '_Bucket'), 'y', p[3]);
  }
  _exCycle(o, t, period, keys) {
    const u = frac(t / period) * keys.length;
    const i = Math.floor(u), a = keys[i], b = keys[(i + 1) % keys.length], s = smooth(u - i);
    this._exPose(o, a.map((v, k) => (k === 0 ? angLerp(v, b[k], s) : lerp(v, b[k], s))));
    const ld = this.node(o, '_Load');
    if (ld) ld.visible = (i === 1 || i === 2);
  }

  // ---------------------------------------------------------------- 塔吊
  _cranes() {
    const Q = this.P.platform;
    this.cranes = [];
    const spots = [[7.75, 7.75, 0], [-7.75, -7.75, 1]];
    const lm = new THREE.LineBasicMaterial({ color: 0x1d1f22 });
    for (const [x, y, k] of spots) {
      const top = this.clone('M_TowerCrane');
      top.userData.base = 'M_TowerCrane';
      const hook = this.node(top, '_Hook');
      this.root.attach(hook);
      const mast = new Inst(this.proto.M_TCMast, 26, this.root, this.mats);
      const collar = new Inst(this.proto.M_TCCollar, 2, this.root, this.mats);
      const ropes = new THREE.LineSegments(new THREE.BufferGeometry(), lm);
      ropes.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18), 3));
      ropes.frustumCulled = false;
      this.root.add(ropes);
      const ld = new THREE.Group();
      const beamM = new THREE.MeshStandardMaterial({ color: 0x5f6870, metalness: 0.6, roughness: 0.5 });
      this.mats.add(beamM);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(9, 0.7, 0.3), beamM);
      const colm = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 9, 16), beamM);
      const rebarM = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.9 });
      this.mats.add(rebarM);
      const bundle = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 1.0), rebarM);
      ld.add(beam, colm, bundle);
      this.root.add(ld);
      this.cranes.push({ top, hook, mast, collar, ropes, ld, beam, colm, bundle, x, y, k,
        slew: this.node(top, '_Slew'), jib: this.node(top, '_Jib'), L: this.proto.M_TowerCrane.userData.jib || 55,
        apex: this.proto.M_TowerCrane.userData.apex || [-1.8, 0, 12.5], heel: this.proto.M_TowerCrane.userData.heel || [2.2, 0, 1.6] });
    }
  }

  _craneTip(c, zs, phi, R) {
    const L = c.L + 0.5;
    const xr = clamp((R - c.heel[0]) / L, Math.cos(THREE.MathUtils.degToRad(82)), Math.cos(THREE.MathUtils.degToRad(15)));
    const th = Math.acos(xr);
    const xp = L * Math.cos(th) + 0.3 * Math.sin(th);
    const zp = L * Math.sin(th) - 0.3 * Math.cos(th);
    const rr = c.heel[0] + xp;
    return { th, x: c.x + rr * Math.cos(phi), y: c.y + rr * Math.sin(phi), z: zs + c.heel[2] + zp };
  }

  _craneJobs(st, c) {
    const sch = this.sch, g = this.g, k = sch.ph[st.phase].key;
    const pick = c.k === 0 ? { x: 22, y: g.hy1 + 5, z: 1.6 } : { x: -30, y: g.hy0 - 7, z: 1.6 };
    const jobs = [];
    const pl = st.plat;
    const deck = pl.show ? pl.rootZ + pl.lift + this.spec.zaoloji.deck : null;
    if (k === 'basement' || k === 'raft') {
      const zb = this._pitFloor(st);
      for (let i = 0; i < 4; i++) jobs.push({ from: pick, to: { x: (c.k ? -1 : 1) * (14 + i * 4), y: (c.k ? -1 : 1) * (6 - i * 5), z: zb + 0.5 }, load: i % 2 ? 'colm' : 'bundle' });
    } else if (['low', 'install', 'cycle'].includes(k)) {
      const f = Math.max(1, st.counts.steel);
      const zs = sch.z[Math.min(f + 1, sch.N + 1)];
      const pts = c.k === 0 ? [[24, 12, 'colm'], [12, 24, 'beam'], [24, 0, 'beam'], [0, 24, 'colm']] : [[-24, -12, 'colm'], [-12, -24, 'beam'], [-24, 0, 'beam'], [0, -24, 'colm']];
      for (const [x, y, ld] of pts) jobs.push({ from: pick, to: { x, y, z: zs + (ld === 'colm' ? 4.5 : 0.6) }, load: ld });
      if (deck) jobs.push({ from: pick, to: { x: c.k ? 7.8 : -7.8, y: c.k ? -7.8 : 7.8, z: deck + 0.6 }, load: 'bundle' });
    } else if (k === 'dismantle' && deck) {
      jobs.push({ from: { x: c.k ? -9 : 9, y: c.k ? -4 : 4, z: deck + 0.6 }, to: pick, load: 'beam' });
    } else {
      jobs.push({ from: pick, to: { x: c.k ? -18 : 18, y: c.k ? -18 : 18, z: this.sch.z[Math.max(1, st.counts.slab) + 1] + 0.5 }, load: 'bundle' });
    }
    return jobs;
  }

  _pitFloor(st) {
    const sch = this.sch;
    if (st.day < sch.raft.t1) return -19;
    let z = -19;
    for (const f of [-4, -3, -2, -1]) if (st.day >= sch.bSlab[f]) z = f + 1 < 0 ? sch.z[f + 1] : 0;
    return z;
  }

  _updateCranes(st, t) {
    const sch = this.sch, pl = st.plat;
    const show = st.day >= sch.raft.t1 && st.day < sch.dismantle.t1 + 6;
    this.craneTop = 0;
    for (const c of this.cranes) {
      c.top.visible = c.hook.visible = c.ropes.visible = c.ld.visible = show;
      if (!show) { c.mast.count(0); c.collar.count(0); continue; }
      let zTop;
      const coreTop = st.counts.core > 0 ? sch.z[st.counts.core + 1] : 0;
      if (pl.show) zTop = pl.rootZ + pl.lift + this.spec.zaoloji.deck + 20;
      else zTop = Math.max(32, coreTop + 22);
      if (st.day >= sch.dismantle.t1) zTop = sch.z[sch.topCore + 1] + 4.4 + 18;
      zTop += c.k ? 8 : 0;                     // 两台高低错开，回转时平衡臂不打架
      this.craneTop = Math.max(this.craneTop, zTop);
      const zBot = Math.max(-19, zTop - 72);
      const h = this.proto.M_TCMast.userData.height || 3;
      const n = Math.min(26, Math.ceil((zTop - zBot) / h));
      for (let i = 0; i < n; i++) c.mast.set(i, mat4(c.x, c.y, zTop - (i + 1) * h));
      c.mast.count(n);
      const cz = pl.show ? [pl.rootZ + pl.lift + this.P.platform.bottom + 0.3, pl.rootZ + pl.lift - 8.5] : [coreTop - 2, coreTop - 15];
      cz.forEach((z, i) => c.collar.set(i, mat4(c.x, c.y, Math.max(z, zBot + 1))));
      c.collar.count(2);
      place(c.top, c.x, c.y, zTop, 0);
      const zs = zTop + 0.45;
      // 吊装循环（48 s）：转到取料点 → 落钩 → 起吊 → 转到落点 → 落钩 → 松钩 → 起钩
      const jobs = this._craneJobs(st, c);
      const T = 48, tt = t + c.k * 21;
      const ci = Math.floor(tt / T), u = frac(tt / T) * T;
      const job = jobs[ci % jobs.length], prev = jobs[(ci + jobs.length - 1) % jobs.length];
      const ang = (p) => Math.atan2(p.y - c.y, p.x - c.x), rad = (p) => Math.hypot(p.x - c.x, p.y - c.y);
      const A = job.from, Bp = job.to, P0 = prev.to;
      const tipA = this._craneTip(c, zs, ang(A), rad(A)), tipB = this._craneTip(c, zs, ang(Bp), rad(Bp));
      const travel = Math.min(tipA.z, tipB.z) - 4;
      const hookAt = (p, carrying) => p.z + 2.1 + (carrying ? (job.load === 'colm' ? 4.6 : 0.4) : 0);
      let phi, R, hz, carrying = false, loadOn = false;
      if (u < 8) { const s = smooth(u / 8); phi = angLerp(ang(P0), ang(A), s); R = lerp(rad(P0), rad(A), s); hz = travel; }
      else if (u < 14) { phi = ang(A); R = rad(A); hz = lerp(travel, hookAt(A, false), smooth((u - 8) / 6)); }
      else if (u < 16) { phi = ang(A); R = rad(A); hz = hookAt(A, false); loadOn = u > 15; }
      else if (u < 22) { phi = ang(A); R = rad(A); hz = lerp(hookAt(A, true), travel, smooth((u - 16) / 6)); carrying = loadOn = true; }
      else if (u < 34) { const s = smooth((u - 22) / 12); phi = angLerp(ang(A), ang(Bp), s); R = lerp(rad(A), rad(Bp), s); hz = travel; carrying = loadOn = true; }
      else if (u < 40) { phi = ang(Bp); R = rad(Bp); hz = lerp(travel, hookAt(Bp, true), smooth((u - 34) / 6)); carrying = loadOn = true; }
      else if (u < 42) { phi = ang(Bp); R = rad(Bp); hz = hookAt(Bp, true); loadOn = u < 41; carrying = loadOn; }
      else { phi = ang(Bp); R = rad(Bp); hz = lerp(hookAt(Bp, false), travel, smooth((u - 42) / 6)); }
      const tip = this._craneTip(c, zs, phi, R);
      hz = Math.min(hz, tip.z - 2.5);
      rot(c.slew, 'z', phi);
      rot(c.jib, 'y', -tip.th);
      place(c.hook, tip.x, tip.y, hz, phi);
      // 吊着的构件
      c.beam.visible = loadOn && job.load === 'beam';
      c.colm.visible = loadOn && job.load === 'colm';
      c.bundle.visible = loadOn && job.load === 'bundle';
      const lz = hz - 2.1 - (job.load === 'colm' ? 4.5 : 0.35);
      c.ld.position.copy(V(tip.x, tip.y, lz));
      c.ld.rotation.set(0, phi + 0.6, 0);
      // 钢丝绳：两根起升绳 + 一根变幅绳
      const pa = c.ropes.geometry.attributes.position;
      const ax = c.apex;
      const apx = c.x + (ax[0] * Math.cos(phi)), apy = c.y + (ax[0] * Math.sin(phi)), apz = zs + ax[2] + 0.4;
      const vs = [V(tip.x + 0.15 * Math.sin(phi), tip.y - 0.15 * Math.cos(phi), tip.z), V(tip.x, tip.y, hz), V(tip.x - 0.15 * Math.sin(phi), tip.y + 0.15 * Math.cos(phi), tip.z), V(tip.x, tip.y, hz), V(apx, apy, apz), V(tip.x, tip.y, tip.z + 0.4)];
      vs.forEach((v, i) => pa.setXYZ(i, v.x, v.y, v.z));
      pa.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- 施工电梯（南立面）
  _hoist() {
    const mx = 4, my = -this.P.tower.slab.edge - 3.2;
    this.hs = { x: mx, y: my };
    this.hsMast = new Inst(this.proto.M_HoistMast, 180, this.root, this.mats);
    this.hsTie = new Inst(this.proto.M_HoistTie, 12, this.root, this.mats);
    this.hsBase = this.clone('M_HoistBase');
    place(this.hsBase, mx, my, 0, Math.PI / 2);
    this.hsCages = [this.clone('M_HoistCage'), this.clone('M_HoistCage')];
    this.hsCages[0].scale.set(1, 1, -1);   // 右边那台镜像，导轨那面朝标准节
  }

  _updateHoist(st, t) {
    const sch = this.sch;
    const curtainEnd = sch.done.curtain[sch.N];
    const show = st.counts.slab >= 2 && st.day < curtainEnd - 3;
    this.hsBase.visible = show;
    this.hsCages.forEach((c) => { c.visible = show; });
    if (!show) { this.hsMast.count(0); this.hsTie.count(0); return; }
    const fTop = Math.min(st.counts.slab + 3, sch.N + 1);
    const zTop = sch.z[fTop] + 3;
    const h = 1.508;
    const n = Math.min(180, Math.ceil(zTop / h));
    for (let i = 0; i < n; i++) this.hsMast.set(i, mat4(this.hs.x, this.hs.y, i * h, Math.PI / 2));
    this.hsMast.count(n);
    let k = 0;
    for (let f = 4; f < fTop && k < 12; f += 6) this.hsTie.set(k++, mat4(this.hs.x, this.hs.y, sch.z[f] - 0.5, Math.PI / 2));
    this.hsTie.count(k);
    // 两个吊笼各自上下：地面 ↔ 随机楼层，停 6 s
    this.hsCages.forEach((c, i) => {
      const speed = 2.5, T = (zTop / speed) * 2 + 14;
      const ti = t + i * T * 0.43;
      const trip = Math.floor(ti / T), u = frac(ti / T) * T;
      const zt = sch.z[Math.max(1, Math.floor(1 + hash(trip * 2 + i) * (fTop - 1)))];
      const up = zt / speed;
      let z;
      if (u < 6) z = 0; else if (u < 6 + up) z = (u - 6) * speed; else if (u < 12 + up) z = zt; else z = Math.max(0, zt - (u - 12 - up) * speed);
      const x = this.hs.x + (i === 0 ? 1.175 : -1.175);
      c.position.copy(V(x, this.hs.y, z + 0.15));
      c.rotation.set(0, Math.PI / 2, 0);
    });
  }

  // ---------------------------------------------------------------- 工人
  _workers() {
    const N = 46;
    this.wk = new Inst(this.proto.M_Worker, N, this.root, this.mats, (o) => (o.userData.kind === 'arm' || o.userData.kind === 'leg') ? o.name.slice(-4) : null);
    const cols = [0xf2c21b, 0xf2c21b, 0xf2c21b, 0xf2c21b, 0xf5f5f2, 0x2f6fd6, 0xff7a1a, 0xd83a2a];
    const helm = this.wk.parts.find((p) => (Array.isArray(p.mat) ? p.mat[0] : p.mat).name === 'helmet');
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) helm.im.setColorAt(i, c.setHex(cols[Math.floor(hash(i + 5) * cols.length)]));
    helm.im.instanceColor.needsUpdate = true;
    this.N = N;
    const g = this.g;
    // 地面上走的路线：项目部 → 过马路 → 大门 → 场内几个点
    this.walkPts = [[-45, g.road - 22], [g.cx - 9, g.road - 9], [g.cx - 9, g.road + 9], [g.cx - 2, g.fy0 + 2], [g.cx - 2, g.rS + 6], [-30, g.hy0 - 3], [g.rW + 6, g.rS + 6], [g.rW + 6, 0], [g.rW + 6, g.rN - 6], [22, g.hy1 + 2], [g.rE - 6, g.rN - 6], [g.rE - 6, g.rS + 6], [-7, g.hy0 - 3], [g.cx + 12, g.fy0 + 7]];
  }

  _updateWorkers(st, t) {
    const sch = this.sch, g = this.g, k = sch.ph[st.phase].key, pl = st.plat;
    const M = new THREE.Matrix4();
    let n = 0;
    const put = (x, y, z, h, walk) => {
      if (n >= this.N) return;
      const ph = t * 5.2 + n * 1.7;
      const a = walk ? Math.sin(ph) * 0.45 : Math.sin(t * 0.8 + n) * 0.06;
      M.copy(mat4(x, y, z + (walk ? Math.abs(Math.cos(ph)) * 0.03 : 0), h));
      this.wk.set(n, M, (key) => (key === 'ArmL' || key === 'LegR' ? a : -a) * (key.startsWith('Arm') ? 0.7 : 1));
      n++;
    };
    // 1) 地面：沿路线走（场地阶段到竣工都有）
    const route = this.walkPts;
    const L = route.length;
    const nGround = k === 'finish' ? 6 : 12;
    for (let i = 0; i < nGround; i++) {
      const sp = 1.3, seg = 18;
      const s = (t * sp + i * 37) / seg;
      const j = Math.floor(s + hash(i) * L) % L, u = frac(s);
      const a = route[j], b = route[(j + 1) % L];
      const p = [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
      put(p[0] + (hash(i * 3) - 0.5) * 2, p[1] + (hash(i * 5) - 0.5) * 2, 0.03, Math.atan2(b[1] - a[1], b[0] - a[0]), true);
    }
    // 信号工：站在两个堆场边
    put(-30 + 6, g.hy0 - 2.5, 0.03, Math.PI / 2, false);
    put(22 - 6, g.hy1 + 1.5, 0.03, -Math.PI / 2, false);
    // 2) 坑里：筏板、地下室阶段
    if (['raft', 'basement', 'excavate'].includes(k)) {
      const z = k === 'excavate' ? st.pit.depth : this._pitFloor(st);
      const cnt = k === 'excavate' ? 3 : 10;
      for (let i = 0; i < cnt; i++) {
        const cx = -20 + hash(i * 11) * 70, cy = -25 + hash(i * 13) * 60;
        const w = Math.sin(t * 0.25 + i) * 3;
        put(cx + w, cy, z + 0.03, t * 0 + (Math.cos(t * 0.25 + i) > 0 ? 0 : Math.PI), true);
      }
    }
    // 3) 楼上：钢结构、楼承板、浇楼板的几层 + 造楼机平台
    if (st.counts.core >= 1) {
      const ring = (f, cnt, seed) => {
        if (f < 1) return;
        const z = sch.z[Math.min(f + 1, sch.N + 1)] - (f === st.counts.steel + 0 ? 0.12 : 0);
        for (let i = 0; i < cnt; i++) {
          const side = Math.floor(hash(seed + i) * 4);
          const s = frac(t * 0.03 + hash(seed + i * 7)) * 2 - 1;
          const d = 14 + hash(seed + i * 3) * 8;
          let x = s * d, y = d, h = Math.PI;
          if (Math.floor(t * 0.06 + i) % 2) h = 0;
          for (let r = 0; r < side; r++) { [x, y] = [-y, x]; h += Math.PI / 2; }
          put(x, y, z + 0.03, h, true);
        }
      };
      ring(st.counts.steel, 4, 10);
      ring(st.counts.deck, 4, 20);
      ring(st.counts.slab + 1, 5, 30);
      if (st.counts.curtain > 0 && st.counts.curtain < sch.N) ring(st.counts.curtain + 1, 3, 40);
    }
    if (pl.show && pl.build >= 1) {
      const z = pl.rootZ + pl.lift + this.spec.zaoloji.deck + 0.05;
      for (let i = 0; i < 6; i++) {
        const x = -10 + hash(i * 17) * 20, y = -10 + hash(i * 19) * 20;
        put(x + Math.sin(t * 0.3 + i) * 1.5, y, z, t * 0.2 + i, true);
      }
    }
    this.wk.count(n);
  }

  // ==================================================================
  update(st, t) {
    const sch = this.sch, g = this.g, k = sch.ph[st.phase].key;
    // ---- 车辆
    const plan = this._plan(st);
    const counts = {};
    for (const v of this.fleet) {
      if (v.proto === 'M_Pickup' && v.i === 0 && k !== 'finish') {
        this._drive(v, t * 1.15, 1, this.route.nearest(-36, g.rS, this.loopS0, this.loopS1));
        continue;
      }
      if (v.proto === 'M_SUV' || v.proto === 'M_Pickup') {
        const lane = this.traffic[v.i % 2];
        const T = lane.len / 11;
        const s = frac((t + v.i * 23 + (v.proto === 'M_Pickup' ? 50 : 0)) / T) * lane.len;
        const p = lane.at(s);
        place(v.o, p.x, p.y, 0, p.h);
        for (const w of v.wheels) rot(w, 'y', s / v.r);
        v.o.visible = true;
        continue;
      }
      const [n, stopS0] = plan[v.proto] || [0];
      counts[v.proto] = (counts[v.proto] || 0) + 1;
      if (v.i >= n) { v.o.visible = false; continue; }
      let stopS = stopS0;
      if (v.proto === 'M_Flatbed') stopS = this.flatStops[v.i % 2];
      const r = this._drive(v, t, n, stopS);
      if (v.load) v.load.visible = k === 'excavate' || k === 'dwall' ? (r.state === 'out' || (r.state === 'stop' && r.u > 0.5)) : false;
      if (v.cargo) v.cargo.visible = r.state === 'in' || (r.state === 'stop' && r.u < 0.6);
      if (v.drum) this._spinDrum(v.drum, t * (r.state === 'stop' ? 4 : 1.5));
    }
    // ---- 成槽机 + 履带吊 + 旋挖钻（地连墙阶段）
    const dw = k === 'dwall';
    this.grabO.visible = this.ccO.visible = this.rigO.visible = this.cage.visible = dw;
    if (dw) {
      const f = st.pit.dwall;
      const p = this._wallPoint(f);
      this.grabAt = p;
      const h = Math.atan2(-p.ny, -p.nx);           // 机头朝向基坑
      const off = 6.1;
      place(this.grabO, p.x + p.nx * off, p.y + p.ny * off, 0, h);
      const gr = this.node(this.grabO, '_Grabber');
      if (!gr.userData.p0) gr.userData.p0 = gr.position.clone();
      const u = frac(t / 22);
      const depth = u < 0.5 ? smooth(u * 2) * 22 : (1 - smooth((u - 0.5) * 2)) * 22;
      gr.position.copy(gr.userData.p0).add(new THREE.Vector3(0, -depth, 0));
      // 履带吊在旁边一幅吊钢筋笼
      const q = this._wallPoint(Math.max(0, f - 0.03));
      const hq = Math.atan2(-q.ny, -q.nx);
      const R = 14;
      place(this.ccO, q.x + q.nx * R, q.y + q.ny * R, 0, hq);
      rot(this.node(this.ccO, '_Boom'), 'y', -Math.acos(clamp((R - 1.8) / 42.8, 0.2, 0.95)));
      const hook = this.node(this.ccO, '_Hook');
      const tipz = 2.2 + 42.8 * Math.sin(Math.acos(clamp((R - 1.8) / 42.8, 0.2, 0.95)));
      const v = frac(t / 30);
      const cz = v < 0.7 ? lerp(tipz - 18, -8, smooth(v / 0.7)) : tipz - 18;
      hook.position.set(R, cz - 1.35, 0);
      hook.rotation.set(0, 0, 0);
      this.cage.position.copy(V(q.x, q.y, cz - 8.5 - 2));
      this.cage.rotation.set(0, Math.atan2(q.ny, q.nx) + Math.PI / 2, 0);
      this.cage.visible = cz - 8.5 - 2 + 7 > -6;
      // 旋挖钻：在塔楼底下一个个打桩
      const nDone = Math.floor(f * this.piles.length);
      const pi = Math.min(nDone, this.piles.length - 1);
      const [px, py] = this.piles[pi];
      place(this.rigO, px - 5.25, py, 0, 0);
      const kelly = this.node(this.rigO, '_Kelly');
      if (!kelly.userData.p0) kelly.userData.p0 = kelly.position.clone();
      const w = frac(t / 16);
      kelly.position.copy(kelly.userData.p0).add(new THREE.Vector3(0, w < 0.6 ? -smooth(w / 0.6) * 9 : -(1 - smooth((w - 0.6) / 0.4)) * 9, 0));
      this.casings.count = nDone;
    } else {
      this.casings.count = k === 'site' ? 0 : (st.day < this.sch.excavate.t0 ? this.piles.length : 0);
    }
    this.casings.instanceMatrix.needsUpdate = true;
    this.pileHeads.count = st.pit.depth <= -20 && st.day < sch.raft.t0 + 4 ? this.piles.length : 0;
    // ---- 挖机（开挖阶段）
    const ex = k === 'excavate';
    this.ex.forEach((o) => { o.visible = ex; });
    this.lrO.visible = ex;
    if (ex) {
      const z = st.pit.depth;
      const keys = [[0.0, 0.35, -0.55, -0.6], [0.0, 0.2, 0.55, 1.0], [1.3, -0.25, 0.2, 1.0], [1.3, -0.15, -0.1, -0.7]];
      this.ex.forEach((o, i) => {
        const wx = i ? 25 + Math.sin(t * 0.02) * 6 : -12 + Math.cos(t * 0.02) * 6;
        place(o, wx, i ? 25 : -10, z, i ? -2.4 : 0.6);
        this._exCycle(o, t + i * 5, 14, keys);
      });
      place(this.lrO, this.lr.x, this.lr.y, 0, -Math.PI / 2);
      const lk = [[0.0, 0.75, 0.45, -0.4], [0.0, 0.6, 0.9, 1.0], [Math.PI, -0.2, 0.3, 1.0], [Math.PI, -0.1, 0.1, -0.8]];
      this._exCycle(this.lrO, t, 18, lk);
    }
    // ---- 泵车（筏板、地下室）/ 地泵 + 泵管（地上）
    const pt = k === 'raft' || k === 'basement';
    this.ptO.visible = pt;
    if (pt) {
      for (let i = 0; i < 4; i++) {
        const lg = this.node(this.ptO, `_Leg${i}`);
        rot(lg, 'z', (i % 2 ? -1 : 1) * (i < 2 ? 0.75 : -0.75));
      }
      const a = [Math.PI / 2 * -1 + Math.sin(t * 0.15) * 0.25, -1.0, 1.3, 0.9, 0.5, 0.4];
      rot(this.node(this.ptO, '_Slew'), 'z', a[0]);
      for (let j = 1; j <= 5; j++) rot(this.node(this.ptO, `_Arm${j}`), 'y', a[j] + (j === 1 ? Math.sin(t * 0.2) * 0.04 : 0));
    }
    const gp = st.day >= sch.cStart[1] && st.day < sch.dismantle.t1;
    this.gpO.visible = this.pipeH.visible = this.pipeV.visible = gp;
    if (gp) {
      const zTopPipe = st.plat.show ? st.plat.rootZ + st.plat.lift - 9.8 : (st.counts.core > 0 ? sch.z[st.counts.core + 1] : 1);
      this.pipeV.scale.y = Math.max(0.5, zTopPipe - 0.3);
    }
    // 钢构件堆场：地下室阶段开始有钢柱进场
    this.stackSW.visible = this.stackNE.visible = st.day >= sch.raft.t1 && st.day < sch.dismantle.t1;
    this._updateCranes(st, t);
    this._updateHoist(st, t);
    this._updateWorkers(st, t);
  }

  _spinDrum(drum, a) {
    if (!drum.userData.q0) drum.userData.q0 = drum.quaternion.clone();
    const v = drum.userData.axis_vec || [-1, 0, 0];
    drum.quaternion.copy(drum.userData.q0).multiply(_q.setFromAxisAngle(new THREE.Vector3(v[0], v[2], -v[1]).normalize(), a));
  }
}
