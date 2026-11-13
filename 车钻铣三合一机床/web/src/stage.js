// three.js 舞台：加载 Blender 导出的机床，按名字找到各运动组，提供姿态、爆炸、透视、高亮和车削 / 螺纹的动态工件。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const MM = 0.001;
/** Blender 坐标（mm）→ three 坐标（m） */
export const B = (x, y, z) => new THREE.Vector3(x * MM, z * MM, -y * MM);

const SHELLS = ['Cabinet', 'Panel', 'Headstock', 'Stepper_Cover', 'Column', 'Head_Box', 'Head_Sleeve', 'Head_Nose', 'Head_TopCap', 'Switch', 'LCD', 'Key_', 'Knob_', 'Cabinet_Vent', 'Panel_Screw'];

export class Stage {
  constructor(canvas, layout) {
    this.canvas = canvas; this.L = layout;
    this.N = {}; this.meshes = []; this.base = new Map();
    this.pose = { spin: 0, ls: 0, car: 0, cross: 0, yaw: 0, headZ: 0, quill: 0, mill: 0, tail: 0, tq: 0, mpul: 0, hwCross: 0, hwTop: 0, hwTail: 0 };
    this.explode = 0; this.xray = false; this.sel = null; this.hidden = new Set();
  }

  async init(glbBytes) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.75;
    const cam = this.camera = new THREE.PerspectiveCamera(34, 1, 0.01, 20);
    const ctl = this.controls = new OrbitControls(cam, this.canvas);
    ctl.enableDamping = true; ctl.dampingFactor = 0.1; ctl.minDistance = 0.12; ctl.maxDistance = 3;
    const key = new THREE.DirectionalLight(0xfff4e6, 2.2); key.position.set(-0.6, 1.4, 0.9); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -0.5, right: 0.5, top: 0.5, bottom: -0.5, near: 0.1, far: 4 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.002;
    scene.add(key, new THREE.HemisphereLight(0xbcd3ff, 0x1a222e, 0.55));
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.6); fill.position.set(1, 0.5, 0.6); scene.add(fill);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 64), new THREE.ShadowMaterial({ opacity: 0.32 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength), '', res, rej));
    const root = this.root = gltf.scene; scene.add(root);
    root.traverse((o) => {
      if (o.name) this.N[o.name] = o;
      this.base.set(o, { p: o.position.clone(), q: o.quaternion.clone(), r: o.rotation.clone() });
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        const m = o.material = o.material.clone();
        m.userData.base = { color: m.color.clone(), emissive: m.emissive.clone(), opacity: m.opacity, transparent: m.transparent };
        if (/LCD$/.test(o.name)) { m.emissive = new THREE.Color(0x2a59ff); m.emissiveIntensity = 1.2; m.userData.base.emissive = m.emissive.clone(); }
        this.meshes.push(o);
      }
    });
    // three 的 GLTFLoader 会把 extras 放进 userData；网格挂在同名节点下时，往上找有 cn 的
    this.info = (o) => { while (o && !o.userData.cn) o = o.parent; return o; };
    for (const m of this.meshes) {
      const holder = this.info(m);
      m.userData.part = holder;
      if (holder && holder.userData.grp === 'inside') m.userData.inside = true;
      m.userData.shell = SHELLS.some((s) => m.name.startsWith(s)) && !/Headstock_Front/.test(m.name) ? true : (m.name === 'Headstock_Front');
    }
    // 动态工件（车削 / 螺纹）
    this._buildWork();
    this.setView('home', true);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.canvas);
  }

  resize() {
    const c = this.canvas, w = c.clientWidth || 1, h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.narrow = w < h * 0.9;
  }

  // ---------------------------------------------------------------- 机位
  VIEWS = {
    home: { pos: B(520, -820, 520), tgt: B(40, 0, 210) },
    lathe: { pos: B(240, -430, 330), tgt: B(90, -10, 150) },
    inside: { pos: B(-420, -520, 420), tgt: B(-90, 0, 140) },
    thread: { pos: B(150, -280, 230), tgt: B(70, -10, 160) },
    mill: { pos: B(470, -760, 600), tgt: B(70, -10, 220) },
    front: { pos: B(60, -900, 260), tgt: B(60, 0, 200) },
  };
  setView(name, instant = false) {
    const v = this.VIEWS[name]; if (!v) return;
    const asp = this.camera.aspect || 1.5; const k = asp < 1.25 ? Math.min(1.9, 1.25 / asp * 1.15) : 1;
    const pos = v.tgt.clone().add(v.pos.clone().sub(v.tgt).multiplyScalar(k));
    if (instant) { this.camera.position.copy(pos); this.controls.target.copy(v.tgt); this.camFly = null; return; }
    this.camFly = { t: 0, p0: this.camera.position.clone(), p1: pos, t0: this.controls.target.clone(), t1: v.tgt.clone() };
  }

  // ---------------------------------------------------------------- 外观
  setXray(on) { this.xray = on; this._applyLook(); }
  setHidden(names) { this.hidden = new Set(names); this._applyLook(); }
  select(part) { this.sel = part; this._applyLook(); }
  _applyLook() {
    for (const m of this.meshes) {
      const b = m.material.userData.base, mat = m.material;
      const hid = [...this.hidden].some((h) => m.name.startsWith(h));
      m.visible = !hid && m !== this.workOrig;
      mat.color.copy(b.color); mat.emissive.copy(b.emissive);
      const ghost = this.xray && m.userData.shell;
      mat.transparent = ghost || b.transparent; mat.opacity = ghost ? 0.14 : b.opacity; mat.depthWrite = !ghost;
      m.castShadow = !ghost;
      if (this.xray && m.userData.inside) mat.emissive.set(0x1d3a5a);
      if (this.sel && m.userData.part === this.sel) { mat.emissive.set(0x3a8cff); mat.emissiveIntensity = 0.55; }
      else mat.emissiveIntensity = /LCD$/.test(m.name) ? 1.2 : 1;
    }
  }

  // ---------------------------------------------------------------- 姿态
  _rot(name, axis, a) {
    const o = this.N[name]; if (!o) return;
    const b = this.base.get(o);
    o.quaternion.copy(b.q).multiply(new THREE.Quaternion().setFromAxisAngle(axis, a));
  }
  _pos(name, d) {
    const o = this.N[name]; if (!o) return;
    o.position.copy(this.base.get(o).p).add(d);
  }
  applyPose() {
    const p = this.pose, X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    this._rot('G_Spin', X, p.spin);
    this._rot('G_LeadScrew', X, p.ls);
    this._rot('G_MotorPulley', X, p.mpul);
    this._pos('G_Carriage', new THREE.Vector3(p.car * MM, 0, 0));
    this._pos('G_Cross', new THREE.Vector3(0, 0, -p.cross * MM));
    // 钻铣头：绕立柱（three Y）转，再升降
    const h = this.N.G_Head;
    if (h) { const b = this.base.get(h); h.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(Y, p.yaw)).multiply(b.q); h.position.copy(b.p).add(new THREE.Vector3(0, p.headZ * MM, 0)); }
    this._pos('G_Quill', new THREE.Vector3(0, -p.quill * MM, 0));
    this._rot('G_MillSpin', Y, p.mill);
    this._pos('G_Tail', new THREE.Vector3(p.tail * MM, 0, 0));
    this._pos('G_TailQuill', new THREE.Vector3(-p.tq * MM, 0, 0));
    this._rot('HW_Cross', Z, -p.hwCross);
    this._rot('HW_Top', X, p.hwTop);
    this._rot('HW_Tail', X, p.hwTail);
    this._explode();
  }
  _explode() {
    const t = this.explode;
    for (const [o, b] of this.base) {
      const ex = o.userData && o.userData.ex;
      if (!ex || o.isMesh === false && !o.userData.cn) continue;
      if (!o.userData.cn || o.name.startsWith('G_')) continue;
      if (!(ex[0] || ex[1] || ex[2])) { if (o.userData._exd) { o.position.copy(b.p); o.userData._exd = false; } continue; }
      const w = B(ex[0], ex[1], ex[2]).multiplyScalar(this._ease(t));
      // 世界方向 → 父空间
      const pq = new THREE.Quaternion(); o.parent.getWorldQuaternion(pq);
      w.applyQuaternion(pq.invert());
      o.position.copy(b.p).add(w); o.userData._exd = t > 0;
    }
  }
  _ease(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  // ---------------------------------------------------------------- 动态工件
  _buildWork() {
    const L = this.L, W = this.N.Workpiece;
    this.workR0 = L.work.r; this.workX0 = L.work.x0; this.workX1 = L.work.x1;
    this.NS = 160;
    this.radii = new Float32Array(this.NS + 1).fill(L.work.r);
    const mat = W ? W.material.clone() : new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.32 });
    this.workMat = mat;
    this.work = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.work.castShadow = true;
    // 放进主轴组：本地坐标以主轴轴线为 X
    const spin = this.N.G_Spin;
    this.workHolder = new THREE.Group();
    spin.add(this.workHolder);
    // G_Spin 的原点就在轴线上（Blender (0,0,AXIS_Z)）
    if (W) W.visible = false;
    this.workOrig = W;
    this.workHolder.add(this.work);
    this._rebuildWork();
    // 螺纹槽：一条深色螺旋带
    this.helixMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.9, roughness: 0.35 });
    this.helix = new THREE.Mesh(new THREE.BufferGeometry(), this.helixMat); this.helix.visible = false;
    this.workHolder.add(this.helix);
  }
  resetWork(r = this.L.work.r) { this.radii.fill(r); this._rebuildWork(); this.helix.visible = false; }
  cutTo(xmm, rmm) {   // 刀尖经过的位置，半径不超过 rmm
    const i = Math.round(((xmm - this.workX0) / (this.workX1 - this.workX0)) * this.NS);
    let ch = false;
    for (let k = Math.max(0, i - 1); k <= Math.min(this.NS, i + 1); k++) if (this.radii[k] > rmm) { this.radii[k] = rmm; ch = true; }
    if (ch) this._rebuildWork();
  }
  _rebuildWork() {
    const pts = [];
    pts.push(new THREE.Vector2(0.0001, this.workX0 * MM));
    for (let k = 0; k <= this.NS; k++) {
      const x = this.workX0 + (this.workX1 - this.workX0) * k / this.NS;
      pts.push(new THREE.Vector2(this.radii[k] * MM, x * MM));
    }
    pts.push(new THREE.Vector2(0.0001, this.workX1 * MM));
    const g = new THREE.LatheGeometry(pts, 40);
    g.rotateZ(-Math.PI / 2);   // LatheGeometry 绕 Y；转成绕 X（Y→X）
    this.work.geometry.dispose(); this.work.geometry = g;
  }
  /** 螺纹螺旋：在 [x0,x1] 上画 pitch 的螺旋槽（只是外观） */
  setHelix(x0, x1, pitch, depth, phaseDeg = 0, visible = true, lefthand = false) {
    const turns = (x1 - x0) / pitch, seg = Math.max(24, Math.round(turns * 28));
    const pts = [];
    const r = (this.workR0 - depth * 0.45) * MM;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, a = (lefthand ? -1 : 1) * t * turns * 2 * Math.PI + phaseDeg * Math.PI / 180;
      pts.push(new THREE.Vector3((x0 + (x1 - x0) * t) * MM, r * Math.cos(a), r * Math.sin(a)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, seg, Math.max(0.12, pitch * 0.28) * MM, 6, false);
    this.helix.geometry.dispose(); this.helix.geometry = g; this.helix.visible = visible;
  }

  /** 零件在屏幕上的位置（给标签用） */
  screenOf(nameOrVec) {
    let v;
    if (nameOrVec instanceof THREE.Vector3) v = nameOrVec.clone();
    else { const o = this.N[nameOrVec]; if (!o) return null; v = new THREE.Vector3(); o.getWorldPosition(v); }
    v.project(this.camera);
    if (v.z > 1) return null;
    const c = this.canvas;
    return { x: (v.x + 1) / 2 * c.clientWidth, y: (1 - v.y) / 2 * c.clientHeight };
  }

  pick(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.camera);
    const hits = rc.intersectObjects(this.meshes.filter((m) => m.visible && !(this.xray && m.userData.shell)), false);
    return hits.length ? hits[0].object.userData.part : null;
  }

  frame(dt) {
    if (this.camFly) {
      const f = this.camFly; f.t = Math.min(1, f.t + dt / 0.9); const e = this._ease(f.t);
      this.camera.position.lerpVectors(f.p0, f.p1, e); this.controls.target.lerpVectors(f.t0, f.t1, e);
      if (f.t >= 1) this.camFly = null;
    }
    this.controls.update();
    this.applyPose();
    this.renderer.render(this.scene, this.camera);
  }
}
