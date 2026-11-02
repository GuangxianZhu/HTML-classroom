// 3D 舞台：载入 Blender 导出的 GLB，负责视角切换、剖切封口、爆炸、把仿真数据贴进模型。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { drawSeg } from './seg7.js';

// 各视图下零件的不透明度：缺省 1，0 = 隐藏
const GROUP_HIDE = (names) => Object.fromEntries(names.map(n => [n, 0]));
const SHELL = ['OuterCover', 'BackPanel', 'DoorFrame', 'DoorGlass', 'DoorMesh', 'DoorChoke', 'PanelBody', 'PanelPrint', 'Display', 'ControlBoard'];
const VIEWS = {
  closed: {
    cam: [-0.62, 0.46, 1.5], tgt: [0, 0.165, 0], door: 0, explode: 0, floor: 0, cut: false, food: 0,
    op: { Bento: 0 },
  },
  open: {
    cam: [-0.2, 0.5, 1.72], tgt: [-0.1, 0.16, 0.04], door: 1, explode: 0, floor: 0, cut: false, food: 0,
    op: { Bento: 0 },
  },
  floor: {
    cam: [-0.15, 1.2, 0.76], tgt: [-0.005, 0.1, 0.02], door: 0, explode: 0, floor: 0, cut: 'y', food: 0,
    op: { Bento: 0, GlassFloor: 0.26, Wiring: 0 },
  },
  section: {
    cam: [0.02, 0.19, 1.16], tgt: [0.008, 0.172, 0], door: 0, explode: 0, floor: 0, cut: 'z', food: 1,
    op: { Wiring: 0, FanShroud: 0.0, FanBlade: 0, FanMotor: 0 },
  },
  explode: {
    cam: [-0.5, 0.82, 2.3], tgt: [0.02, 0.3, -0.02], door: 0, explode: 1, floor: 0, cut: false, food: 0,
    op: { Bento: 0, OuterCover: 0.28, FrontFrame: 0.28, Wiring: 0 },
  },
};

const ease = t => t * t * (3 - 2 * t);

export class Stage {
  constructor(canvas, wrap, onPick) {
    this.canvas = canvas; this.wrap = wrap; this.onPick = onPick;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true, preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.02;
    r.localClippingEnabled = true;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1.6, 0.05, 30);
    this.ctl = new OrbitControls(this.camera, canvas);
    this.ctl.enableDamping = true; this.ctl.dampingFactor = 0.09;
    this.ctl.minDistance = 0.45; this.ctl.maxDistance = 4.4;
    this.ctl.maxPolarAngle = Math.PI * 0.72;
    this.ctl.enablePan = false;

    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.62;

    const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
    key.position.set(-0.9, 1.6, 1.2); key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    Object.assign(key.shadow.camera, { left: -1.1, right: 1.1, top: 1.1, bottom: -1.1, near: .2, far: 5 });
    key.shadow.radius = 5; key.shadow.bias = -0.0004;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.5);
    fill.position.set(1.4, 0.5, 0.8);
    this.scene.add(fill);

    const g = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.ShadowMaterial({ opacity: 0.2 }));
    g.rotation.x = -Math.PI / 2; g.position.y = -0.001; g.receiveShadow = true;
    this.ground = g; this.scene.add(g);

    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 20);
    this.cutTarget = 0.0075;
    this.parts = {};
    this.view = 'closed';
    this.state = { door: 0, explode: 0, floor: 0, cut: 0, food: 0 };
    this.target = { ...this.state };
    this.camFrom = null; this.camT = 1;
    this.spin = 0;              // 天线转速 rad/s
    this.antennaAngle = 0;
    this.run = false;
    this.clock = new THREE.Clock();
    this.visible = true;
    this.pointer = new THREE.Vector2();
    this.ray = new THREE.Raycaster();
    this.listeners = [];

    canvas.addEventListener('pointerdown', e => { this._down = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', e => {
      if (this._down && Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) < 6) this.pick(e);
    });
    canvas.addEventListener('pointermove', e => this.hover(e));
    canvas.addEventListener('pointerleave', () => { if (this.hoverCb) this.hoverCb(null); });

    new ResizeObserver(() => this.resize()).observe(wrap);
    new IntersectionObserver(es => { this.visible = es[0].isIntersecting; }).observe(wrap);
    this.resize();
    this.loop = this.loop.bind(this);
  }

  async load(bytes) {
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', res, rej));
    this.root = gltf.scene;
    this.scene.add(this.root);
    this.meshes = [];
    this.root.traverse(o => {
      const ex = o.userData;
      if (ex && ex.label && ex.group && o.parent && o.parent.name.startsWith('G_')) {
        const e = ex.explode || [0, 0, 0];     // Blender 坐标（m），Blender 脚本里的同一张表
        this.parts[o.name] = {
          node: o, base: o.position.clone(), label: ex.label, desc: ex.desc, group: ex.group, cap: ex.cap,
          exp: new THREE.Vector3(e[0], e[2], -e[1]), op: 1, opT: 1, mats: [], meshes: [],
        };
      }
    });
    for (const p of Object.values(this.parts)) {
      p.node.traverse(m => {
        if (!m.isMesh) return;
        const mat = m.material.clone();
        mat.userData.op0 = mat.opacity; mat.userData.tr0 = mat.transparent; mat.userData.dw0 = mat.depthWrite;
        mat.clippingPlanes = [this.plane];
        mat.clipShadows = true;
        if (mat.transparent) mat.side = THREE.DoubleSide;
        m.material = mat;
        m.castShadow = !mat.transparent && p.group !== 'food';
        m.receiveShadow = !mat.transparent;
        m.userData.part = p;
        p.mats.push(mat); p.meshes.push(m);
        this.meshes.push(m);
      });
    }
    // 显示屏用 Canvas 贴图，这样模型上的数码管能走动
    const dc = this.dispCanvas = document.createElement('canvas');
    dc.width = 256; dc.height = 96;
    this.dispTex = new THREE.CanvasTexture(dc);
    this.dispTex.colorSpace = THREE.SRGBColorSpace;
    this.dispTex.flipY = true;
    const dp = this.parts.Display;
    if (dp) {
      const mat = new THREE.MeshBasicMaterial({ map: this.dispTex, toneMapped: false, clippingPlanes: [this.plane] });
      mat.userData.op0 = 1; mat.userData.tr0 = false; mat.userData.dw0 = true;
      dp.meshes[0].material = mat; dp.mats = [mat];
    }
    this.setDisplay('0:30');
    this.parts.Bento && this.setPartVisible('Bento', false);

    this.buildCaps();
    this.buildOverlays();
    this.setView('closed', true);
    requestAnimationFrame(this.loop);
  }

  setDisplay(text) {
    const c = this.dispCanvas.getContext('2d');
    c.fillStyle = '#120a04'; c.fillRect(0, 0, 256, 96);
    drawSeg(c, text, 40, 16, 40, 64, '#ffa533', 'rgba(255,165,51,.07)');
    this.dispTex.needsUpdate = true;
  }

  setPartVisible(n, v) { this.parts[n].node.visible = v; }

  // ---- 剖切封口：three.js 经典的模板缓冲法，要求网格闭合，所以 Blender 里全部用闭合体 ----
  buildCaps() {
    const base = new THREE.MeshBasicMaterial({ depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc });
    const back = base.clone(); back.side = THREE.BackSide; back.clippingPlanes = [this.plane];
    back.stencilFail = back.stencilZFail = back.stencilZPass = THREE.IncrementWrapStencilOp;
    const front = base.clone(); front.side = THREE.FrontSide; front.clippingPlanes = [this.plane];
    front.stencilFail = front.stencilZFail = front.stencilZPass = THREE.DecrementWrapStencilOp;
    this.capMeshes = [];
    for (const [name, p] of Object.entries(this.parts)) {
      if (!p.cap) continue;
      for (const m of p.meshes) {
        if (m.material.transparent) continue;
        for (const mat of [back, front]) {
          const s = new THREE.Mesh(m.geometry, mat);
          s.renderOrder = 1; s.visible = false; s.userData.isCap = true; s.userData.part = p;
          m.add(s); this.capMeshes.push(s);
        }
      }
    }
    const capMat = this.capMat = new THREE.MeshStandardMaterial({
      color: 0xb2582a, metalness: 0.15, roughness: 0.6, stencilWrite: true, stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
    });
    const cap = this.cap = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), capMat);
    cap.position.set(0, 0.25, 0); cap.renderOrder = 2; cap.visible = false;
    cap.onAfterRender = rr => rr.clearStencil();
    this.scene.add(cap);
    for (const p of Object.values(this.parts)) for (const m of p.meshes) m.renderOrder = 3;
  }

  // ---- 把三维仿真结果贴回模型：竖切面（波）和水平面（热点） ----
  buildOverlays() {
    const mk = (w, h) => {
      const tex = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat);
      tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    // 竖切面：x -230..246, z 38..322（与 mw3d.c 的网格一致）
    this.vTex = mk(119, 71);
    const vm = new THREE.Mesh(new THREE.PlaneGeometry(0.476, 0.284),
      new THREE.MeshBasicMaterial({ map: this.vTex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    vm.position.set(0.008, 0.18, 0.0072); vm.renderOrder = 5; vm.visible = false;
    this.vPlane = vm; this.scene.add(vm);
    // 水平面：腔体内 x -226..94, y -178..162，放在食物半高
    this.hTex = mk(80, 85);
    const hm = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.34),
      new THREE.MeshBasicMaterial({ map: this.hTex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, opacity: 0.96 }));
    hm.rotation.x = -Math.PI / 2;
    hm.position.set(-0.066, 0.129, 0.008); hm.renderOrder = 5; hm.visible = false;
    this.hPlane = hm; this.scene.add(hm);
  }

  writeTex(tex, src, w, h, lut, alphaFn, flipY) {
    const d = tex.image.data;
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
      const v = src[i * h + j];                    // 仿真存的是 [i][k] 列优先
      const jj = flipY ? h - 1 - j : j;
      const o = (jj * w + i) * 4;
      d[o] = lut[v * 3]; d[o + 1] = lut[v * 3 + 1]; d[o + 2] = lut[v * 3 + 2]; d[o + 3] = alphaFn[v];
    }
    tex.needsUpdate = true;
  }

  setView(name, instant) {
    const v = VIEWS[name];
    this.view = name;
    this.target = { door: v.door, explode: v.explode, floor: v.floor, cut: v.cut ? 1 : 0, food: v.food };
    if (v.cut && v.cut !== this.cutAxis) {            // 换剖切方向时先从"未切"重新扫过来
      this.cutAxis = v.cut;
      this.state.cut = 0;
      if (v.cut === 'z') { this.plane.normal.set(0, 0, -1); this.cutTarget = 0.0075; this.cap.rotation.set(0, 0, 0); this.cap.position.set(0, 0.25, 0); }
      else { this.plane.normal.set(0, -1, 0); this.cutTarget = 0.152; this.cap.rotation.set(Math.PI / 2, 0, 0); this.cap.position.set(0, 0, 0); }
    }
    for (const [n, p] of Object.entries(this.parts)) p.opT = v.op[n] ?? 1;
    const cp = new THREE.Vector3(...v.cam), ct = new THREE.Vector3(...v.tgt);
    if (instant) {
      this.state = { ...this.target };
      this.camera.position.copy(cp); this.ctl.target.copy(ct);
      for (const p of Object.values(this.parts)) p.op = p.opT;
      this.applyState();
    } else {
      this.camFrom = { p: this.camera.position.clone(), t: this.ctl.target.clone() };
      this.camTo = { p: cp, t: ct };
      this.camT = 0;
    }
    this.vPlane.visible = false; this.hPlane.visible = false;
    this.ground.visible = name !== 'explode';
    if (this.onView) this.onView(name);
  }

  applyState() {
    const s = this.state, P = this.parts;
    // 门绕铰链转
    const dn = ['DoorFrame', 'DoorGlass', 'DoorMesh', 'DoorChoke'];
    for (const n of dn) if (P[n]) P[n].node.rotation.y = -s.door * 1.85;
    for (const [n, p] of Object.entries(P)) {
      p.node.position.copy(p.base).addScaledVector(p.exp, s.explode);
    }
    if (P.GlassFloor) P.GlassFloor.node.position.y += s.floor * 0.125;
    for (const p of Object.values(P)) {
      const on = p.op > 0.005;
      p.node.visible = p.node.name === 'Bento' ? (s.food > 0.01) : on;
      for (const m of p.mats) {
        const o = m.userData.op0 * p.op;
        const ghost = p.op < 0.995;
        m.opacity = o;
        m.transparent = m.userData.tr0 || ghost;
        m.depthWrite = ghost ? false : m.userData.dw0;
      }
    }
    // 剖切
    const cutOn = s.cut > 0.001;
    this.plane.constant = cutOn ? this.cutTarget + (1 - ease(s.cut)) * 0.5 : 20;
    if (this.capMeshes) for (const c of this.capMeshes) c.visible = cutOn && c.userData.part.op > 0.5;
    if (this.cap) {
      this.cap.visible = cutOn;
      if (this.cutAxis === 'y') this.cap.position.y = this.plane.constant; else this.cap.position.z = this.plane.constant;
    }
  }

  resize() {
    const w = this.wrap.clientWidth || 800, h = this.wrap.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 窄屏时把视野放宽，机器不被裁掉
    this.camera.fov = w / h < 1.15 ? 42 : 30;
    this.camera.updateProjectionMatrix();
  }

  loop() {
    requestAnimationFrame(this.loop);
    if (!this.visible || !this.root) { this.clock.getDelta(); return; }
    const dt = Math.min(this.clock.getDelta(), 0.12);
    let dirty = false;
    const k = 1 - Math.exp(-dt * 4.2);
    for (const key of Object.keys(this.state)) {
      const d = this.target[key] - this.state[key];
      if (Math.abs(d) > 1e-4) { this.state[key] += d * k; dirty = true; }
      else this.state[key] = this.target[key];
    }
    for (const p of Object.values(this.parts)) {
      const d = p.opT - p.op;
      if (Math.abs(d) > 1e-3) { p.op += d * k; dirty = true; } else p.op = p.opT;
    }
    if (dirty) this.applyState();
    if (this.camT < 1) {
      this.camT = Math.min(1, this.camT + dt / 1.05);
      const e = ease(this.camT);
      this.camera.position.lerpVectors(this.camFrom.p, this.camTo.p, e);
      this.ctl.target.lerpVectors(this.camFrom.t, this.camTo.t, e);
    }
    this.ctl.update();
    if (this.spin) {
      this.antennaAngle = (this.antennaAngle + this.spin * dt) % (Math.PI * 2);
    }
    for (const n of ['AntennaPlate', 'AntennaShaft', 'ResinShaft']) if (this.parts[n]) this.parts[n].node.rotation.y = this.antennaAngle;
    if (this.parts.FanBlade && this.run) this.parts.FanBlade.node.rotation.z += dt * 24;
    for (const f of this.listeners) f(dt);
    this.renderer.render(this.scene, this.camera);
  }

  hit(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObjects(this.meshes.filter(m => {
      const p = m.userData.part;
      return p.op > 0.25 && p.node.visible;
    }), false);
    for (const h of hits) {
      if (this.plane.distanceToPoint(h.point) < 0) continue;
      return h.object.userData.part;
    }
    return null;
  }

  hover(e) {
    if (!this.hoverCb || e.buttons) return;
    const now = performance.now();
    if (this._ht && now - this._ht < 50) return;
    this._ht = now;
    const p = this.hit(e);
    this.canvas.style.cursor = p ? 'pointer' : 'grab';
    this.hoverCb(p, e);
  }

  pick(e) {
    const p = this.hit(e);
    this.highlight(p);
    if (p && this.onPick) this.onPick(p);
  }

  highlight(p) {
    if (this._hl) for (const m of this._hl.mats) if (m.emissive) m.emissive.setHex(0x000000);
    this._hl = p;
    if (p) for (const m of p.mats) if (m.emissive) { m.emissive.setHex(0xb85c2e); m.emissiveIntensity = 0.42; }
  }

  focusPart(name) {
    const p = this.parts[name];
    if (p) { this.highlight(p); if (this.onPick) this.onPick(p); }
  }
}
