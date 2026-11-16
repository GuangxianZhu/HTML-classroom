// 工地上动的东西：车辆进出大门、挖机挖土装车、成槽机和旋挖钻、泵车和地泵、塔吊吊钢构、施工电梯、工人。
// 哪些在场由施工阶段（day）决定；它们怎么动用真实时间（秒），所以暂停时工地也是活的。
// 坐标一律先用 Blender 的 (x, y, z)（z 向上），最后用 V() 转成 three。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { V, AX, rot, place, angLerp, Path, Inst, mat4, clamp, lerp, smooth, frac, hash } from './util.js';
import { Smart } from './smart.js';

const _q = new THREE.Quaternion();

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
    this.smart = new Smart(this);
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
    put('P_Guard', g.cx + 17.5, g.fy0 + 4, 0);
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
    this.cranes = [];
    const spots = [[7.75, 7.75, 0], [-7.75, -7.75, 1]];
    const lm = new THREE.LineBasicMaterial({ color: 0x1d1f22 });
    // 吊的东西：H 型钢梁、钢管柱用和主楼同一种材质，原点都放在“吊点”（构件顶面中心）
    const byName = (n) => [...this.mats].find((m) => m.name === n);
    const steelM = byName('steel') || new THREE.MeshStandardMaterial({ color: 0x5f6870, metalness: 0.6, roughness: 0.5 });
    const tubeM = byName('steel_tube') || steelM;
    const tf = 0.04, tw = 0.06;
    const parts = [new THREE.BoxGeometry(1, tf, 1).translate(0, -tf / 2, 0), new THREE.BoxGeometry(1, tf, 1).translate(0, -1 + tf / 2, 0),
      new THREE.BoxGeometry(1, 1 - 2 * tf, tw).translate(0, -0.5, 0)];
    this.hGeo = mergeGeometries(parts);
    this.cGeo = new THREE.CylinderGeometry(1, 1, 1, 16).translate(0, -0.5, 0);
    const rebarM = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.9 });
    this.mats.add(rebarM);
    // 已经落位、但那层的钢结构还没“完成”的构件
    this.placedB = new THREE.InstancedMesh(this.hGeo, steelM, 80);
    this.placedC = new THREE.InstancedMesh(this.cGeo, tubeM, 40);
    for (const im of [this.placedB, this.placedC]) { im.count = 0; im.frustumCulled = false; this.root.add(im); }
    this.placedKey = '';
    for (const [x, y, k] of spots) {
      const top = this.clone('M_TowerCrane');
      top.userData.base = 'M_TowerCrane';
      const hook = this.node(top, '_Hook');
      this.root.attach(hook);
      const mast = new Inst(this.proto.M_TCMast, 26, this.root, this.mats);
      const collar = new Inst(this.proto.M_TCCollar, 2, this.root, this.mats);
      const ropes = new THREE.LineSegments(new THREE.BufferGeometry(), lm);
      ropes.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(30), 3));
      ropes.frustumCulled = false;
      this.root.add(ropes);
      const ld = new THREE.Group();
      ld.rotation.order = 'YZX';               // 先绕竖轴转朝向，再绕水平轴倒（钢柱起吊时从躺着到立起来）
      const beam = new THREE.Mesh(this.hGeo, steelM);
      const colm = new THREE.Mesh(this.cGeo, tubeM);
      const bundle = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 1.0).translate(0, -0.25, 0), rebarM);
      ld.add(beam, colm, bundle);
      this.root.add(ld);
      this.cranes.push({ top, hook, mast, collar, ropes, ld, beam, colm, bundle, x, y, k,
        ci: -1, job: null, nDrop: 0, batch: '', lastTo: null,
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

  // 第 f 层的钢梁、第 f 层的钢柱：坐标和 blender/tower.py 一模一样。返回每台塔吊各自负责的一串（先柱后梁）
  _pieces(fs, fc) {
    const T = this.P.tower, Fr = T.frame, sch = this.sch;
    const F = Fr.half, a = T.core.half, step = 2 * F / Fr.bays;
    const r2 = (p, k) => { let [x, y] = p; for (let i = 0; i < k; i++) [x, y] = [-y, x]; return [x, y]; };
    const out = [[], []];
    const side = (x, y) => (x + y > 1e-6 || (Math.abs(x + y) <= 1e-6 && x > y) ? 0 : 1);
    if (fc >= 1 && fc <= sch.N) {
      const r = (this.spec.tower.col_d[fc] || 1.0) / 2, z1 = sch.z[fc + 1], len = z1 - sch.z[fc];
      for (const [x, y] of this.spec.tower.columns) out[side(x, y)].push({ t: 'colm', x, y, z: z1, r, len, ord: 0, ang: Math.atan2(y, x) });
    }
    if (fs >= 1 && fs <= sch.N) {
      const zt = sch.z[fs + 1] - T.slab.t;
      const add = (p0, p1, spec, ord) => {
        const x = (p0[0] + p1[0]) / 2, y = (p0[1] + p1[1]) / 2;
        out[side(x, y)].push({ t: 'beam', x, y, z: zt, H: spec[0], B: spec[1], L: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
          yaw: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), ord, ang: Math.atan2(y, x) });
      };
      for (let k = 0; k < 4; k++) {
        for (let i = 0; i < Fr.bays; i++) add(r2([-F + i * step, F], k), r2([-F + (i + 1) * step, F], k), Fr.edge_beam, 1);
        for (let i = 1; i < Fr.bays; i++) add(r2([-F + i * step, F], k), r2([-F + i * step, a], k), Fr.main_beam, 1);
        add(r2([F, F], k), r2([a, a], k), Fr.diag_beam, 2);
        for (const d of Fr.sec_offsets) { const y = a + d; add(r2([-y, y], k), r2([y, y], k), Fr.sec_beam, 3); }
      }
    }
    for (const L of out) L.sort((p, q) => p.ord - q.ord || p.ang - q.ang);
    return out;
  }

  // 正在装的那一批：第 counts.steel+1 层的梁 + 第 counts.column+1 层的柱，按天数算已经装了几件
  _steelBatch(st) {
    const sch = this.sch, S = sch.S;
    const fs = st.counts.steel + 1, fc = st.counts.column + 1;
    if (fs > sch.N && fc > sch.N) return null;
    const win = (tr, f) => {
      if (f > sch.N) return null;
      const t1 = sch.done[tr][f], t0 = f > 1 ? sch.done[tr][f - 1] : t1 - S.cycle;
      return [t0, t1];
    };
    const ws = win('steel', fs), wc = win('column', fc);
    const t0 = Math.min(ws ? ws[0] : 1e9, wc ? wc[0] : 1e9);
    if (st.day < t0) return null;
    const key = `${fs}/${fc}`;
    if (this._batchKey !== key) { this._batchKey = key; this._batch = this._pieces(fs, fc); }
    const lists = this._batch;
    const byDay = lists.map((L) => {
      const nc = L.filter((p) => p.t === 'colm').length, nb = L.length - nc;
      let n = 0;
      L.forEach((p, i) => {
        const [w, f] = p.t === 'colm' ? [wc, (i + 1) / (nc + 1) * 0.35] : [ws, 0.35 + (i - nc + 1) / (nb + 1) * 0.65];
        if (w && st.day >= w[0] + (w[1] - w[0]) * f && n === i) n = i + 1;
      });
      return n;
    });
    return { key, lists, byDay };
  }

  // 每个吊装循环开头定这一钩吊什么：钢构件为主，每四钩插一钩钢筋（给造楼机平台）
  _pickJob(st, c, batch, ci) {
    const sch = this.sch, g = this.g, k = sch.ph[st.phase].key;
    const pick = c.k === 0 ? { x: 22, y: g.hy1 + 5, z: 1.65 } : { x: -30, y: g.hy0 - 7, z: 1.65 };
    const pl = st.plat;
    const deck = pl.show ? pl.rootZ + pl.lift + this.spec.zaoloji.deck : null;
    if (batch && ci % 4 !== 3) {
      const L = batch.lists[c.k];
      const n = Math.max(batch.byDay[c.k], c.batch === batch.key ? c.nDrop : 0);
      if (n < L.length) {
        const p = L[n];
        return { from: pick, to: p, load: p.t, piece: p, idx: n, batch: batch.key };
      }
    }
    if (k === 'basement' || k === 'raft') {
      const zb = this._pitFloor(st), i = ci % 4;
      return { from: pick, to: { x: (c.k ? -1 : 1) * (14 + i * 4), y: (c.k ? -1 : 1) * (6 - i * 5), z: zb + 0.5 }, load: 'bundle' };
    }
    if (k === 'dismantle' && deck) return { from: { x: c.k ? -9 : 9, y: c.k ? -4 : 4, z: deck + 0.6 }, to: pick, load: 'bundle' };
    if (deck) return { from: pick, to: { x: c.k ? 7.8 : -7.8, y: c.k ? -7.8 : 7.8, z: deck + 0.6 }, load: 'bundle' };
    const coreTop = st.counts.core > 0 ? sch.z[st.counts.core + 1] : 0;
    if (['low', 'install'].includes(k)) return { from: pick, to: { x: c.k ? -6 : 6, y: c.k ? -2 : 2, z: coreTop + 0.6 }, load: 'bundle' };
    return { from: pick, to: { x: c.k ? -18 : 18, y: c.k ? -18 : 18, z: this.sch.z[Math.max(1, st.counts.slab) + 1] + 0.5 }, load: 'bundle' };
  }

  _pitFloor(st) {
    const sch = this.sch;
    if (st.day < sch.raft.t1) return -19;
    let z = -19;
    for (const f of [-4, -3, -2, -1]) if (st.day >= sch.bSlab[f]) z = f + 1 < 0 ? sch.z[f + 1] : 0;
    return z;
  }

  // 已落位构件：钩子松开以后留在原位，那层的 Steel_NN / Column_NN 一显示就清掉
  _drawPlaced(batch) {
    let nb = 0, nc = 0;
    if (batch) {
      const key = batch.key + '|' + this.cranes.map((c) => Math.max(batch.byDay[c.k], c.batch === batch.key ? c.nDrop : 0)).join(',');
      if (key === this.placedKey) return;
      this.placedKey = key;
      for (const c of this.cranes) {
        const L = batch.lists[c.k];
        const n = Math.max(batch.byDay[c.k], c.batch === batch.key ? c.nDrop : 0);
        for (let i = 0; i < n && i < L.length; i++) {
          const p = L[i];
          if (p.t === 'beam') this.placedB.setMatrixAt(nb++, this._pieceMat(p, p.x, p.y, p.z, p.yaw, 0));
          else this.placedC.setMatrixAt(nc++, this._pieceMat(p, p.x, p.y, p.z, 0, 0));
        }
      }
    } else {
      if (this.placedKey === '') return;
      this.placedKey = '';
    }
    this.placedB.count = nb; this.placedC.count = nc;
    this.placedB.instanceMatrix.needsUpdate = this.placedC.instanceMatrix.needsUpdate = true;
  }

  _pieceMat(p, x, y, z, yaw, tilt) {
    const s = p.t === 'beam' ? new THREE.Vector3(p.L, p.H, p.B) : new THREE.Vector3(p.r, p.len, p.r);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, tilt, 'YZX'));
    return new THREE.Matrix4().compose(V(x, y, z), q, s);
  }

  _updateCranes(st, t) {
    const sch = this.sch, pl = st.plat;
    const show = st.day >= sch.raft.t1 && st.day < sch.dismantle.t1 + 6;
    this.craneTop = 0;
    const batch = show ? this._steelBatch(st) : null;
    for (const c of this.cranes) {
      c.top.visible = c.hook.visible = c.ropes.visible = c.ld.visible = show;
      if (!show) { c.mast.count(0); c.collar.count(0); continue; }
      if (batch && c.batch !== batch.key) { c.batch = batch.key; c.nDrop = 0; }
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
      // 吊装循环（48 s）：转到取料点 → 落钩挂钩 → 起吊 → 转到落点 → 落钩就位 → 松钩 → 起钩
      const T = 48, tt = t + c.k * 21;
      const ci = Math.floor(tt / T), u = frac(tt / T) * T;
      if (ci !== c.ci || !c.job || (c.job.batch && (!batch || c.job.batch !== batch.key))) {
        if (c.job && ci !== c.ci) c.lastTo = c.job.to;
        c.ci = ci;
        c.job = this._pickJob(st, c, batch, ci);
      }
      const job = c.job;
      const ang = (p) => Math.atan2(p.y - c.y, p.x - c.x), rad = (p) => Math.hypot(p.x - c.x, p.y - c.y);
      const A = job.from, Bp = job.to, P0 = c.lastTo || A;
      const tipA = this._craneTip(c, zs, ang(A), rad(A)), tipB = this._craneTip(c, zs, ang(Bp), rad(Bp));
      const pc = job.piece;
      const sling = job.load === 'beam' ? 2.0 : job.load === 'colm' ? 0.6 : 1.5;
      const topOff = !pc ? 0 : pc.t === 'beam' ? pc.H : pc.r;       // 躺在料堆上时吊点离料堆顶面的高度
      const hookA = A.z + topOff + 2.05 + sling, hookB = Bp.z + 2.05 + sling;
      // 转臂时的高度：越过造楼机顶（平台 + 布料机）留点余量，不用升到臂尖
      const clear = pl.show ? pl.rootZ + pl.lift + this.spec.zaoloji.deck + 14 : coreTop + 8;
      const travel = Math.min(Math.min(tipA.z, tipB.z) - 4, Math.max(hookA, hookB, clear) + 6);
      let phi, R, hz, loadOn = false, s = 0;
      if (u < 8) { s = smooth(u / 8); phi = angLerp(ang(P0), ang(A), s); R = lerp(rad(P0), rad(A), s); hz = travel; }
      else if (u < 14) { phi = ang(A); R = rad(A); hz = lerp(travel, hookA, smooth((u - 8) / 6)); }
      else if (u < 16) { phi = ang(A); R = rad(A); hz = hookA; loadOn = u > 15; }
      else if (u < 22) { phi = ang(A); R = rad(A); hz = lerp(hookA, travel, smooth((u - 16) / 6)); loadOn = true; }
      else if (u < 34) { s = smooth((u - 22) / 12); phi = angLerp(ang(A), ang(Bp), s); R = lerp(rad(A), rad(Bp), s); hz = travel; loadOn = true; }
      else if (u < 40) { phi = ang(Bp); R = rad(Bp); hz = lerp(travel, hookB, smooth((u - 34) / 6)); loadOn = true; }
      else if (u < 42) { phi = ang(Bp); R = rad(Bp); hz = hookB; loadOn = u < 41; }
      else { phi = ang(Bp); R = rad(Bp); hz = lerp(hookB, travel, smooth((u - 42) / 6)); }
      // 松钩那一刻记下来：这件已经落位
      if (pc && u >= 41 && job.batch === c.batch && c.nDrop < job.idx + 1) c.nDrop = job.idx + 1;
      const tip = this._craneTip(c, zs, phi, R);
      hz = Math.min(hz, tip.z - 2.5);
      rot(c.slew, 'z', phi);
      rot(c.jib, 'y', -tip.th);
      place(c.hook, tip.x, tip.y, hz, phi);
      // 吊着的构件
      c.beam.visible = loadOn && job.load === 'beam';
      c.colm.visible = loadOn && job.load === 'colm';
      c.bundle.visible = loadOn && job.load === 'bundle';
      const az = hz - 2.05 - sling;                  // 吊点高度
      let yaw = phi + 0.6, tilt = 0, sl = [];
      if (pc && pc.t === 'beam') {
        yaw = u < 22 ? 0 : u < 34 ? angLerp(0, pc.yaw, s) : pc.yaw;   // 料堆上顺着 x 放，转臂途中用溜绳带到梁的方向
        c.beam.scale.set(pc.L, pc.H, pc.B);
        const ex = Math.cos(yaw) * pc.L * 0.3, ey = Math.sin(yaw) * pc.L * 0.3;
        sl = [[tip.x + ex, tip.y + ey, az], [tip.x - ex, tip.y - ey, az]];
      } else if (pc && pc.t === 'colm') {
        yaw = 0;
        if (u < 22) tilt = Math.acos(clamp((az - A.z) / pc.len, 0, 1));   // 柱脚还拖在料堆上：从躺着慢慢立起来
        c.colm.scale.set(pc.r, pc.len, pc.r);
        sl = [[tip.x, tip.y, az], [tip.x, tip.y, az]];
      } else {
        const ex = Math.cos(yaw) * 3, ey = Math.sin(yaw) * 3;
        sl = [[tip.x + ex, tip.y + ey, az], [tip.x - ex, tip.y - ey, az]];
      }
      c.ld.position.copy(V(tip.x, tip.y, az));
      c.ld.rotation.set(0, yaw, tilt);
      // 钢丝绳：两根起升绳 + 一根变幅绳 + 两根吊索
      const pa = c.ropes.geometry.attributes.position;
      const ax = c.apex;
      const apx = c.x + (ax[0] * Math.cos(phi)), apy = c.y + (ax[0] * Math.sin(phi)), apz = zs + ax[2] + 0.4;
      const hb = hz - 2.0;
      const vs = [V(tip.x + 0.15 * Math.sin(phi), tip.y - 0.15 * Math.cos(phi), tip.z), V(tip.x, tip.y, hz), V(tip.x - 0.15 * Math.sin(phi), tip.y + 0.15 * Math.cos(phi), tip.z), V(tip.x, tip.y, hz), V(apx, apy, apz), V(tip.x, tip.y, tip.z + 0.4)];
      if (loadOn) for (const q of sl) vs.push(V(tip.x, tip.y, hb), V(q[0], q[1], q[2]));
      else vs.push(V(tip.x, tip.y, hb), V(tip.x, tip.y, hb), V(tip.x, tip.y, hb), V(tip.x, tip.y, hb));
      vs.forEach((v, i) => pa.setXYZ(i, v.x, v.y, v.z));
      pa.needsUpdate = true;
    }
    this._drawPlaced(batch);
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
    const N = 64;
    this.wk = new Inst(this.proto.M_Worker, N, this.root, this.mats, (o) => (o.userData.kind === 'arm' || o.userData.kind === 'leg') ? o.name.slice(-4) : null);
    const cols = [0xf2c21b, 0xf2c21b, 0xf2c21b, 0xf2c21b, 0xf5f5f2, 0x2f6fd6, 0xff7a1a, 0xd83a2a];
    const helm = this.wk.parts.find((p) => (Array.isArray(p.mat) ? p.mat[0] : p.mat).name === 'helmet');
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) helm.im.setColorAt(i, c.setHex(cols[Math.floor(hash(i + 5) * cols.length)]));
    helm.im.instanceColor.needsUpdate = true;
    this.N = N;
    const g = this.g;
    // 地面上走的路线：项目部 → 过马路 → 大门 → 场内几个点
    // 进出场都走东边的实名制闸机（cx+11），三条通道
    const gx = g.cx + 11;
    this.walkPts = [[-45, g.road - 22], [gx, g.road - 9], [gx, g.road + 9], [gx, g.fy0 + 3.5], [g.cx - 2, g.fy0 + 5], [g.cx - 2, g.rS + 6], [-30, g.hy0 - 3], [g.rW + 6, g.rS + 6], [g.rW + 6, 0], [g.rW + 6, g.rN - 6], [22, g.hy1 + 2], [g.rE - 6, g.rN - 6], [g.rE - 6, g.rS + 6], [-7, g.hy0 - 3], [gx, g.fy0 + 3.5], [gx, g.road + 9], [gx, g.road - 9]];
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
      put(p[0] + [-1.15, 0, 1.15][i % 3] + (hash(i * 3) - 0.5) * 0.25, p[1] + (hash(i * 5) - 0.5) * 0.6, 0.03, Math.atan2(b[1] - a[1], b[0] - a[0]), true);
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
    }
    // 楼承板、钢筋、浇筑、幕墙、地下室工序的人：站在各自的作业面上（works.js 给位置）
    for (const [x, y, z, h, walk] of this.stage.works ? this.stage.works.crew : []) {
      const sway = walk ? Math.sin(t * 0.4 + x) * 0.8 : 0;
      put(x + Math.cos(h) * sway, y + Math.sin(h) * sway, z + 0.03, h + (walk && Math.cos(t * 0.4 + x) < 0 ? Math.PI : 0), walk);
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
      // 有浇筑点就转过去对准（泵车停在南边，车头朝西）
      const pw = this.stage.works && this.stage.works.pour;
      let sl = -Math.PI / 2 + Math.sin(t * 0.15) * 0.25;
      if (pw) sl = clamp(Math.atan2(pw.y - (g.hy0 - 7), pw.x - 2) - Math.PI, -Math.PI / 2 - 1.25, -Math.PI / 2 + 1.25) + Math.sin(t * 0.3) * 0.04;
      const a = [sl, -1.0, 1.3, 0.9, 0.5, 0.4];
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
    this.smart.update(st, t);
  }

  _spinDrum(drum, a) {
    if (!drum.userData.q0) drum.userData.q0 = drum.quaternion.clone();
    const v = drum.userData.axis_vec || [-1, 0, 0];
    drum.quaternion.copy(drum.userData.q0).multiply(_q.setFromAxisAngle(new THREE.Vector3(v[0], v[2], -v[1]).normalize(), a));
  }
}
