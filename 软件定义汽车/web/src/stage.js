// three.js 舞台：同一辆车，换架构、透视、拆开、走信号、看车队、拆控制器。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const MM = 0.001;
/** Blender 坐标（mm）→ three 坐标（m） */
export const B = (x, y, z) => new THREE.Vector3(x * MM, z * MM, -y * MM);
export const easeIO = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

const GHOST_V = `varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const GHOST_F = `uniform vec3 uC; uniform float uA; uniform float uP; varying vec3 vN; varying vec3 vV;
void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), uP); gl_FragColor = vec4(uC, uA * (.05 + .95 * f)); }`;

const ghostMat = (hex, a, p = 2.2) => new THREE.ShaderMaterial({
  vertexShader: GHOST_V, fragmentShader: GHOST_F, transparent: true, depthWrite: false, side: THREE.FrontSide,
  uniforms: { uC: { value: new THREE.Color(hex).convertLinearToSRGB() }, uA: { value: a }, uP: { value: p } },
});

export const WIRE = { sig: '#ff9d3c', bus: '#ffd166', eth: '#4cc9f0', pwr: '#ff5a5f' };
const OUTSIDE = new Set(['MirL', 'MirR', 'CamSL', 'CamSR']);   // 装在车身外面的外设
const STATE_COL = ['#3a4656', '#4cc9f0', '#ffb347', '#ff4d4f', '#ffffff'];   // 旧版 / 新版 / 已回滚 / 趴窝 / 正在装

export class Stage {
  constructor(canvas, spec) {
    this.canvas = canvas; this.spec = spec;
    this.nodes = new Map(); this.ecus = new Map(); this.eps = new Map();
    this.harness = { A: [], B: [], C: [] }; this.ghosts = [];
    this.arch = 'A'; this.archFade = { A: 1, B: 0, C: 0 };
    this.shellK = 0; this.shellTarget = 0; this.explodeK = 0; this.explodeT = 0;
    this.scene_ = 'car';
    this.classOn = { sig: 1, bus: 1, eth: 1, pwr: 1 };
    this.touch = null; this.colorMode = 'domain'; this.supplierColor = {};
    this.tokensOn = false; this.tokenK = 0;
    this.pulses = [];
    this.VIEWS = {
      home: { pos: B(-4600, 5200, 2150), tgt: B(0, 60, 560) },
      xray: { pos: B(-3900, 4700, 3400), tgt: B(0, 60, 520) },
      top: { pos: B(-420, 0, 9000), tgt: B(0, 0, 420), fov: 30 },
      side: { pos: B(-7300, 120, 1250), tgt: B(0, 0, 640), fov: 30 },
      explode: { pos: B(-6200, 6900, 3300), tgt: B(0, 40, 900) },
      fleet: { pos: B(-3000, -92000, 90000), tgt: B(0, 0, 0), fov: 28 },
      detail: { pos: B(spec.detail_x - 420, -3300, 3300), tgt: B(spec.detail_x - 130, 90, 170), fov: 30 },
    };
    this.view = null;
  }

  async init(glbBytes) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.02;
    const scene = this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = .78;
    const cam = this.camera = new THREE.PerspectiveCamera(32, 1, .05, 260);
    cam.position.copy(this.VIEWS.home.pos);
    const ctl = this.controls = new OrbitControls(cam, this.canvas);
    ctl.enableDamping = true; ctl.dampingFactor = .09; ctl.minDistance = .4; ctl.maxDistance = 90;
    ctl.maxPolarAngle = Math.PI * .495;
    ctl.target.copy(this.VIEWS.home.tgt);
    const key = new THREE.DirectionalLight(0xfff2df, 1.5); key.position.set(-3, 5, 3); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, .9); rim.position.set(4, 2.2, -4); scene.add(rim);

    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength), '', res, rej));
    const root = this.root = gltf.scene; scene.add(root);
    const spec = this.spec;
    root.children.forEach((n) => {
      const name = n.name, g = spec.objects[name] || n.userData.group || '';
      n.userData.g = g; n.userData.base = n.position.clone(); this.nodes.set(name, n);
    });
    // 车身类：准备一份透视用的幽灵网格，和实体叠着，靠 material.visible 切换
    // frame = 白车身骨架（车框），在外板里面：透视时和外板一起变成幽灵，拆开时抬到外板和座舱中间
    const STRUCT = { shell: ['#7fb6e6', .42, 2.0], frame: ['#9fb2c6', .2, 2.2], cabin: ['#6d88a6', .17, 2.6], chassis: ['#6d88a6', .22, 2.4], wheels: ['#7d93ab', .34, 2.0] };
    this.groupNodes = { shell: [], frame: [], cabin: [], chassis: [], wheels: [] };
    this.gm = Object.fromEntries(Object.entries(STRUCT).map(([k, v]) => [k, ghostMat(...v)]));
    root.children.forEach((n) => {
      const g = n.userData.g;
      if (STRUCT[g]) {
        this.groupNodes[g].push(n);
        const ms = [];
        n.traverse((o) => { if (o.isMesh) ms.push(o); });
        ms.forEach((o) => {
          o.material = o.material.clone();
          // 实车时按不透明画：开着 transparent 会被丢进透明队列、关掉面排序，车身和贴在上面的缝线
          // 谁先画谁后画就看物体中心远近，边缘会闪、会互相吃掉。透视渐变时 _applyStruct 再打开。
          // 玻璃例外：要一直半透明才能看到车里，不写深度、最后画（renderOrder 2），盖在车里的东西上面
          o.userData.glass = o.material.name === 'Glass';
          o.userData.alpha = o.userData.glass ? o.material.opacity : 1;
          o.material.transparent = o.userData.glass;
          if (o.userData.glass) { o.material.depthWrite = false; o.renderOrder = 2; }
          o.userData.solid = o.material;
          const gh = new THREE.Mesh(o.geometry, this.gm[g]);
          gh.visible = false; gh.renderOrder = 3;
          o.add(gh); this.ghosts.push({ o, gh });
        });
      }
    });
    // 盒子
    for (const [k, e] of Object.entries(spec.ecus)) {
      const n = this.nodes.get(`ECU_${k}`); if (!n) continue;
      const mats = [];
      n.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; mats.push(o.material); o.userData.ecu = k; o.renderOrder = 4; } });
      this.ecus.set(k, { n, e, mats, k: e.arch.includes('A') ? 1 : 0, pop: 1 });
      n.scale.setScalar(.0001);
    }
    // 外设
    for (const [k, p] of Object.entries(spec.endpoints)) {
      const n = this.nodes.get(`EP_${k}`); if (!n) continue;
      const mats = [];
      n.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); o.userData.ep = k; o.renderOrder = 4; } });
      this.eps.set(k, { n, p, mats });
    }
    this.pdus = ['PDU_PF', 'PDU_PC'].map((k) => this.nodes.get(k)).filter(Boolean);
    // 线束
    root.children.forEach((n) => {
      if (!n.name.startsWith('Harness_')) return;
      const [, arch, cls] = n.name.split('_');
      const mats = [];
      n.traverse((o) => {
        if (!o.isMesh) return;
        o.material = new THREE.MeshStandardMaterial({ color: WIRE[cls], emissive: WIRE[cls], emissiveIntensity: .32, roughness: .5, transparent: true });
        o.renderOrder = 5; mats.push(o.material);
      });
      this.harness[arch].push({ n, cls, mats, base: 1 });
    });
    this.details = [...this.nodes.values()].filter((n) => n.name.startsWith('Det_'));
    this.details.forEach((n) => { n.visible = false; });
    this.fleetProto = this.nodes.get('FleetCar');
    if (this.fleetProto) this.fleetProto.visible = false;

    this._buildGround();
    this._buildTokens();
    this._buildPulses();
    this._buildFleet();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
    this.setArch('A', false);
    this.applyView('home', true);
  }

  // ------------------------------------------------------ 地面
  _buildGround() {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(256, 256, 40, 256, 256, 256);
    gr.addColorStop(0, 'rgba(70,104,150,.5)'); gr.addColorStop(.55, 'rgba(40,66,104,.26)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    const m = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), m);
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -.002; this.floor.renderOrder = -2;
    this.scene.add(this.floor);
    // 接触阴影
    const c2 = document.createElement('canvas'); c2.width = 256; c2.height = 512;
    const h = c2.getContext('2d');
    h.filter = 'blur(26px)'; h.fillStyle = '#000'; h.beginPath(); h.roundRect(64, 54, 128, 404, 44); h.fill();
    const sm = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c2), transparent: true, opacity: .6, depthWrite: false, toneMapped: false });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 6.3), sm);
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0; this.shadow.renderOrder = -1;
    this.scene.add(this.shadow);
  }

  // ------------------------------------------------------ 软件功能小球：软件搬家的动画
  _buildTokens() {
    const F = this.spec.functions, list = [];
    for (const [id, f] of Object.entries(F)) {
      const nA = f.hosts.A.length, nB = f.hosts.B.length, nC = f.hosts.C.length;
      const n = Math.max(nA, nB, nC);
      for (let i = 0; i < n; i++) list.push({ id, i, dom: f.dom });
    }
    this.tokens = list;
    const geo = new THREE.IcosahedronGeometry(.026, 1);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthTest: false });
    const im = this.tokenMesh = new THREE.InstancedMesh(geo, mat, list.length);
    im.frustumCulled = false; im.renderOrder = 8; im.visible = false;
    const col = new THREE.Color();
    list.forEach((t, i) => { col.set(this.spec.domains[t.dom].color); im.setColorAt(i, col); t.from = new THREE.Vector3(); t.to = new THREE.Vector3(); t.p = new THREE.Vector3(); t.d = 0; });
    this.scene.add(im);
    this._slots('A', true);
    this.tokenAnim = 1;
    this._tm = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    this._updateTokens();
  }

  _slots(arch, snap) {
    // 每个盒子上方排一个小方阵，方阵大小就是这个盒子跑着几个功能
    const byHost = new Map();
    for (const t of this.tokens) {
      const hs = this.spec.functions[t.id].hosts[arch];
      const h = hs[t.i % hs.length];
      t.host = h;
      if (!byHost.has(h)) byHost.set(h, []);
      const L = byHost.get(h);
      if (!L.includes(t.id)) L.push(t.id);
    }
    const STEP = 60;
    for (const t of this.tokens) {
      const L = byHost.get(t.host), e = this.spec.ecus[t.host], cols = Math.ceil(Math.sqrt(L.length));
      const i = L.indexOf(t.id), rows = Math.ceil(L.length / cols);
      const cx = (i % cols - (cols - 1) / 2) * STEP, cy = (Math.floor(i / cols) - (rows - 1) / 2) * STEP;
      const h = this.spec.sizes[e.size][2];
      const tgt = B(e.pos[0] + cx, e.pos[1] + cy, e.pos[2] + h / 2 + 58);
      if (snap) { t.from.copy(tgt); t.p.copy(tgt); }
      else { t.from.copy(t.p); t.d = Math.random() * .32; }
      t.to.copy(tgt);
    }
  }

  _updateTokens() {
    const im = this.tokenMesh; if (!im) return;
    const k = this.tokenAnim, vis = this.tokenK;
    im.visible = vis > .01;
    im.material.opacity = vis;
    this.tokens.forEach((t, i) => {
      const u = easeIO((k - t.d) / (1 - t.d));
      t.p.lerpVectors(t.from, t.to, u);
      const lift = Math.sin(u * Math.PI) * Math.min(.5, t.from.distanceTo(t.to) * .22);
      this._s.setScalar(1);
      this._tm.compose(new THREE.Vector3(t.p.x, t.p.y + lift, t.p.z), this._q, this._s);
      im.setMatrixAt(i, this._tm);
    });
    im.instanceMatrix.needsUpdate = true;
  }

  setTokens(on) { this.tokensOn = on; }

  // ------------------------------------------------------ 信号小球
  _buildPulses() {
    const geo = new THREE.IcosahedronGeometry(.026, 1);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false, depthTest: false, transparent: true });
    const im = this.pulseMesh = new THREE.InstancedMesh(geo, mat, 220);
    im.frustumCulled = false; im.renderOrder = 9; im.count = 0;
    im.setColorAt(0, new THREE.Color('#fff'));
    this.scene.add(im);
    this.routeGroup = new THREE.Group(); this.scene.add(this.routeGroup);
  }

  /** flows: [{ pts: Vector3[], order, color }] */
  setFlows(flows) {
    for (const c of [...this.routeGroup.children]) { c.geometry.dispose(); this.routeGroup.remove(c); }
    this.pulses = [];
    const maxOrder = flows.reduce((m, f) => Math.max(m, f.order), 0);
    this.pulseCycle = (maxOrder + 1) * .55 + 1.1;
    this.pulseT = 0;
    flows.forEach((f, idx) => {
      if (f.pts.length < 2) return;
      const lens = [0];
      for (let i = 1; i < f.pts.length; i++) lens.push(lens[i - 1] + f.pts[i].distanceTo(f.pts[i - 1]));
      const L = lens[lens.length - 1];
      if (L < .02) return;
      const curve = new THREE.CurvePath();
      for (let i = 1; i < f.pts.length; i++) if (f.pts[i].distanceTo(f.pts[i - 1]) > 1e-4) curve.add(new THREE.LineCurve3(f.pts[i - 1], f.pts[i]));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, f.pts.length * 4), .0075, 5, false),
        new THREE.MeshBasicMaterial({ color: f.color, toneMapped: false, transparent: true, opacity: .85, depthTest: false }));
      tube.renderOrder = 7;
      this.routeGroup.add(tube);
      this.pulses.push({ pts: f.pts, lens, L, t0: f.order * .55, col: new THREE.Color(f.color), idx });
    });
    this.pulseMesh.count = 0;
  }

  _tickPulses(dt) {
    const im = this.pulseMesh;
    if (!this.pulses.length) { im.count = 0; return; }
    this.pulseT = (this.pulseT + dt) % this.pulseCycle;
    let n = 0;
    const m = this._tm, v = new THREE.Vector3(), s = new THREE.Vector3();
    for (const p of this.pulses) {
      const u = (this.pulseT - p.t0) / .85;
      if (u < 0 || u > 1 || n >= 220) continue;
      const d = easeIO(u) * p.L;
      let i = 1;
      while (i < p.lens.length - 1 && p.lens[i] < d) i++;
      const a = (d - p.lens[i - 1]) / Math.max(p.lens[i] - p.lens[i - 1], 1e-6);
      v.lerpVectors(p.pts[i - 1], p.pts[i], a);
      s.setScalar(1 + .25 * Math.sin(u * Math.PI));
      m.compose(v, this._q, s);
      im.setMatrixAt(n, m); im.setColorAt(n, p.col); n++;
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------ 车队
  _buildFleet() {
    if (!this.fleetProto) return;
    let geo = null;
    this.fleetProto.traverse((o) => { if (o.isMesh && !geo) geo = o.geometry; });
    const cols = 24, rows = 10, N = this.fleetN = cols * rows;
    const mat = new THREE.MeshStandardMaterial({ roughness: .42, metalness: .15 });
    const im = this.fleet = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      m.makeTranslation((c - (cols - 1) / 2) * 2.7, 0, (r - (rows - 1) / 2) * 6.1);
      im.setMatrixAt(i, m); im.setColorAt(i, col.set(STATE_COL[0]));
    }
    im.visible = false; im.frustumCulled = false;
    this.scene.add(im);
    this._colors = STATE_COL.map((c) => new THREE.Color(c));
  }

  setFleet(states) {
    for (let i = 0; i < this.fleetN; i++) this.fleet.setColorAt(i, this._colors[states[i] || 0]);
    this.fleet.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------ 大场景切换
  setScene(mode) {
    this.scene_ = mode;
    const car = mode === 'car';
    for (const n of this.nodes.values()) {
      if (n.name.startsWith('Det_') || n.name === 'FleetCar') continue;
      n.visible = car;
    }
    this.floor.visible = mode !== 'detail'; this.shadow.visible = car;
    this.floor.scale.setScalar(mode === 'fleet' ? 9 : 1);
    this.details.forEach((n) => { n.visible = mode === 'detail'; });
    this.fleet.visible = mode === 'fleet';
    this.tokenMesh.visible = car && this.tokenK > .01;
    this.routeGroup.visible = car;
    this.pulseMesh.visible = car;
    this._applyHarness();
  }

  /** 拆开控制器：盖子和散热器抬起来 */
  setDetailOpen(k) {
    for (const n of this.details) {
      const base = n.userData.base;
      if (n.name === 'Det_sink') n.position.y = base.y + .52 * k;
      if (n.name === 'Det_small_case' || n.name === 'Det_ccc_case') n.position.y = base.y - .14 * k;
    }
  }

  highlightDetail(role) {
    for (const n of this.details) {
      const on = role && n.name === `Det_${role}`;
      n.traverse((o) => {
        if (!o.isMesh) return;
        if (!o.userData.own) { o.material = o.material.clone(); o.userData.own = true; o.userData.em = o.material.emissive.clone(); }
        o.material.emissive.set(on ? '#4cc9f0' : '#000000').multiplyScalar(1);
        o.material.emissiveIntensity = on ? .85 : 0;
      });
    }
  }

  // ------------------------------------------------------ 架构
  setArch(a, animate = true) {
    this.arch = a;
    for (const v of this.ecus.values()) v.tgt = v.e.arch.includes(a) ? 1 : 0;
    if (!animate) {
      for (const v of this.ecus.values()) { v.k = v.tgt; v.n.scale.setScalar(Math.max(v.k, .0001)); v.n.visible = this._ecuVis(v); }
      for (const b of 'ABC') this.archFade[b] = b === a ? 1 : 0;
      this._applyHarness();
      this._slots(a, true); this.tokenAnim = 1; this._updateTokens();
    } else {
      this._slots(a, false); this.tokenAnim = 0;
    }
    this._paintEcus();
  }

  setClass(cls, on) { this.classOn[cls] = on ? 1 : 0; this._applyHarness(); }

  _applyHarness() {
    const shut = this._shut();
    const dim = this.touch ? .16 : 1;
    for (const a of 'ABC') for (const h of this.harness[a]) {
      const op = this.archFade[a] * this.classOn[h.cls] * dim;
      h.n.visible = this.scene_ === 'car' && op > .005 && !shut;
      h.mats.forEach((m) => { m.opacity = op; m.depthWrite = op > .9; });
    }
    // 外设同理：车里的传感器、电机离外皮只有几厘米，实车时会从车身上冒出小白点。后视镜和镜上摄像头本来就在车外，照常画
    for (const [k, v] of this.eps) v.n.visible = this.scene_ === 'car' && (!shut || OUTSIDE.has(k));
    // 盒子和配电盒也一样：真车里它们藏在饰板后面；现在玻璃是透明的，实车时不收起来会隔着玻璃看见
    for (const v of this.ecus.values()) v.n.visible = this._ecuVis(v);
    for (const n of this.pdus) n.visible = this.scene_ === 'car' && !shut;
  }

  _ecuVis(v) { return v.k > .004 && this.scene_ === 'car' && !this._shut(); }

  // ------------------------------------------------------ 透视 / 拆开
  setShell(mode) { this.shellTarget = mode === 'solid' ? 0 : 1; this.shellHidden = mode === 'none'; }

  setExplode(k) { this.explodeT = k; }

  _applyStruct() {
    const k = this.shellK;
    for (const { o, gh } of this.ghosts) {
      const glass = o.userData.glass;
      gh.visible = k > .01 && !glass;
      o.material.visible = k < .99;
      o.material.transparent = glass || k > .001;
      o.material.opacity = o.userData.alpha * (1 - k);
      o.material.depthWrite = !glass && k < .5;
    }
    const a = { shell: .42, frame: .2, cabin: .17, chassis: .22, wheels: .34 };
    for (const g in this.gm) this.gm[g].uniforms.uA.value = a[g] * k * ((g === 'shell' || g === 'frame') && this.shellHidden ? .12 : 1);
    const e = this.explodeK;
    const lift = { shell: 1.55, frame: 1.08, cabin: .62, chassis: -.82, wheels: -.82 };
    for (const g in this.groupNodes) {
      for (const n of this.groupNodes[g]) {
        n.position.y = n.userData.base.y + lift[g] * e;
        if (g === 'wheels') n.position.x = n.userData.base.x + Math.sign(n.userData.base.x) * .55 * e;
      }
    }
    this.floor.material.opacity = 1 - e * .8;
    this.shadow.material.opacity = .6 * (1 - e);
    this._applyHarness();
  }

  /** 实车外观（不透明、没拆开）：线束本来就被车身挡住，只剩贴着外皮的几段会戳出来变成橙色小点，干脆不画 */
  _shut() { return this.shellK < .01 && this.explodeK < .01; }

  // ------------------------------------------------------ 配色 / 高亮
  setColorMode(mode) { this.colorMode = mode; this._paintEcus(); }

  setSupplierColors(map) { this.supplierColor = map; }

  _paintEcus() {
    const t = this.touch;
    for (const [k, v] of this.ecus) {
      const hex = this.colorMode === 'supplier' ? (this.supplierColor[v.e.sup] || '#9fb3c8') : this.spec.domains[v.e.dom].color;
      const on = t && t.hosts.has(k), used = t && t.used.has(k);
      const base = v.mats[0];
      base.color.set(hex);
      base.emissive.set(hex);
      base.metalness = .15; base.roughness = .55;
      base.emissiveIntensity = t ? (on ? 1.1 : used ? .4 : .02) : .22;
      if (t && !on && !used) base.color.multiplyScalar(.28);
      base.opacity = t && !on && !used ? .5 : 1;
      if (v.mats[1]) v.mats[1].opacity = base.opacity;
    }
    for (const [k, v] of this.eps) {
      const on = t && t.eps.has(k);
      const m = v.mats[0];
      m.color.set(on ? '#ffffff' : '#7f8b98');
      m.emissive.set(on ? this.spec.domains[v.p.dom].color : '#000000');
      m.emissiveIntensity = on ? 1.2 : 0;
      if (t && !on) m.color.multiplyScalar(.4);
    }
  }

  /** hosts 要改的盒子，used 只是被调用的盒子，eps 涉及的外设 */
  setTouched(t) {
    this.touch = t ? { hosts: new Set(t.hosts), used: new Set(t.used || []), eps: new Set(t.eps || []) } : null;
    this._paintEcus();
    this._applyHarness();
  }

  selectEcu(k) { this.selEcu = k; }

  // ------------------------------------------------------ 相机
  applyView(name, instant) {
    const v = this.VIEWS[name]; if (!v) return;
    this.view = name;
    const to = { pos: v.pos.clone(), tgt: v.tgt.clone(), fov: v.fov || 32 };
    if (instant) {
      this.camera.position.copy(to.pos); this.controls.target.copy(to.tgt); this.camera.fov = to.fov; this.camera.updateProjectionMatrix(); this.controls.update(); this.fly = null;
      return;
    }
    this.fly = { t: 0, dur: window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches ? .01 : 1.1, from: { pos: this.camera.position.clone(), tgt: this.controls.target.clone(), fov: this.camera.fov }, to };
  }

  resize() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 窄屏时把整车收进画面
    this.camera.zoom = Math.min(1, (w / h) / 1.25);
    this.camera.updateProjectionMatrix();
    this.w = w; this.h = h;
  }

  project(v3) {
    const p = v3.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * this.w, y: (1 - p.y) / 2 * this.h, behind: p.z > 1 };
  }

  pick(clientX, clientY) {
    if (this.scene_ !== 'car') return null;
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.camera);
    const list = [];
    for (const [, e] of this.ecus) if (e.n.visible && e.k > .5) e.n.traverse((o) => { if (o.isMesh) list.push(o); });
    const hits = rc.intersectObjects(list, false);
    return hits.length ? hits[0].object.userData.ecu : null;
  }

  frame(dt) {
    const K = Math.min(1, dt * 6);
    let move = false;
    for (const v of this.ecus.values()) {
      if (Math.abs(v.k - v.tgt) > .002) {
        v.k += (v.tgt - v.k) * K; if (Math.abs(v.k - v.tgt) <= .002) v.k = v.tgt;
        v.n.scale.setScalar(Math.max(easeIO(v.k), .0001));
        v.n.visible = this._ecuVis(v);
      }
    }
    for (const a of 'ABC') {
      const tg = a === this.arch ? 1 : 0;
      if (Math.abs(this.archFade[a] - tg) > .002) { this.archFade[a] += (tg - this.archFade[a]) * K; move = true; if (Math.abs(this.archFade[a] - tg) <= .002) this.archFade[a] = tg; }
    }
    if (move) this._applyHarness();
    if (Math.abs(this.shellK - this.shellTarget) > .002 || Math.abs(this.explodeK - this.explodeT) > .002 || this._dirty !== this.shellHidden) {
      this.shellK += (this.shellTarget - this.shellK) * K;
      this.explodeK += (this.explodeT - this.explodeK) * K;
      if (Math.abs(this.shellK - this.shellTarget) <= .002) this.shellK = this.shellTarget;
      if (Math.abs(this.explodeK - this.explodeT) <= .002) this.explodeK = this.explodeT;
      this._dirty = this.shellHidden;
      this._applyStruct();
    }
    // 软件小球
    const tv = this.tokensOn && this.scene_ === 'car' ? 1 : 0;
    if (Math.abs(this.tokenK - tv) > .004 || this.tokenAnim < 1) {
      this.tokenK += (tv - this.tokenK) * K;
      if (Math.abs(this.tokenK - tv) <= .004) this.tokenK = tv;
      this.tokenAnim = Math.min(1, this.tokenAnim + dt / 1.5);
      this._updateTokens();
    }
    if (this.fly) {
      const f = this.fly; f.t += dt / f.dur;
      const k = easeIO(f.t);
      this.camera.position.lerpVectors(f.from.pos, f.to.pos, k);
      this.controls.target.lerpVectors(f.from.tgt, f.to.tgt, k);
      this.camera.fov = f.from.fov + (f.to.fov - f.from.fov) * k;
      this.camera.updateProjectionMatrix();
      if (f.t >= 1) this.fly = null;
    }
    this.controls.update();
    this._tickPulses(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
