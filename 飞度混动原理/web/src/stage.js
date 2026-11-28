// three.js 舞台。车和动力总成都来自“汽车模拟器”：
//   car.glb      那辆直线造型的三厢车（车身、内饰、底盘、车轮，还有两套动力共用的水箱、排气管、油箱）
//   pt_ehev.glb  两电机混动的动力总成（名字以 H_ 开头）
// car.glb 里燃油机和 CVT 自己的件（Eng_ / Cvt_ / Drv_ …）在这里不用，载入后直接拿掉。
// 零件怎么转、能量流怎么画，用的是模拟器那边的两个共用模块。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { makeEhevRig } from '../../../汽车模拟器/web/src/ehev_rig.js';
import { makeFlowViz, FLOW_COL as FC } from '../../../汽车模拟器/web/src/flowviz.js';

const MM = 0.001;
/** Blender 坐标（mm）→ three 坐标（m） */
export const B = (x, y, z) => new THREE.Vector3(x * MM, z * MM, -y * MM);
export const easeIO = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
export const FLOW_COL = { fuel: FC.fuel, exhaust: FC.exhaust, mech: FC.mech, ac: FC.ac, dc: FC.dc, heat: FC.heat, regen: FC.regen };

const DROP = /^(Eng_|Cvt_|Drv_|PT_Mounts|Bay_Intake)/;         // 燃油版自己的件
const BODY = new Set(['shell', 'frame', 'trim', 'cabin']);
// car.glb 里的件 → 这一页的零件组（点零件、高亮、标签用）
const CAR_G = [[/^Wheel_(\w\w)|^Brake_(\w\w)/, (m) => `wheel_${m[1] || m[2]}`], [/^Fuel_Tank/, () => 'tank'], [/^Exh_Pipe/, () => 'exhaust'],
  [/^Bay_/, () => 'radiator'], [/^Subframes/, () => 'chassis']];
const EX_CAR = { shell: [0, 0, 1500, 0], frame: [0, 0, 950, .04], trim: [0, 0, 1250, .04], cabin: [0, 0, 650, .08], chassis: [0, 0, -260, .2], bay: [0, 520, 260, .1], under: [0, 0, -480, .15] };

// 车身变成“只留轮廓”：越是侧对着镜头的面越亮，正对着的面几乎看不见，所以不会像雾一样蒙住里面的零件
const GHOST_V = `varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const GHOST_F = `uniform vec3 uC; uniform float uA; uniform float uP; varying vec3 vN; varying vec3 vV;
void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), uP); gl_FragColor = vec4(uC, uA * (.025 + .975 * f)); }`;
const ghostMat = (hex, a, p) => new THREE.ShaderMaterial({
  vertexShader: GHOST_V, fragmentShader: GHOST_F, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uC: { value: new THREE.Color(hex).convertLinearToSRGB() }, uA: { value: a }, uP: { value: p } },
});

const ENGINE_ONLY = ['H_Eng_BlockR', 'H_Eng_Pan', 'H_Eng_Crank', 'H_Eng_Piston', 'H_Eng_Rod', 'H_Eng_Cam', 'H_Eng_Valve', 'H_Eng_Chain', 'H_Eng_Plugs',
  'H_Eng_Exhaust', 'H_Burn', 'H_Flywheel', 'Exh_Pipe'];
const ECVT_HIDE = ['H_Case', 'H_PCU', 'H_MotStatorQ', 'H_GenStatorQ', 'H_Bay', 'H_EComp', 'H_Mounts', 'H_Eng_BlockF', 'H_Eng_Head', 'H_Eng_Cover', 'H_Eng_Intake',
  'H_Eng_Front', 'H_Eng_Pan', 'H_Eng_Exhaust', 'H_HV_Cable', 'H_IPU', 'Bay_', 'Wheel_FL', 'Brake_FL', 'Wheel_R', 'Brake_R', 'Subframes', 'Exh_Pipe', 'Fuel_Tank'];

export class Stage {
  /** spec = spec_ehev.json（混动的轴、齿数、零件说明、能量流路径），car = 模拟器的 spec.json（车身分组和尺寸） */
  constructor(canvas, spec, car) {
    this.canvas = canvas; this.spec = spec; this.car = car;
    this.items = []; this.nodes = new Map(); this.meshes = [];
    this.explodeT = 0; this.roadOffset = 0; this.bodyMode = 'ghost';
    this.VIEWS = {
      home: { pos: B(-4500, 5000, 2400), tgt: B(0, 150, 560) },
      // 动力总成：壳体和缸体变成透明的轮廓，里面哪根轴在转、哪个活塞在动都看得见；挡在前面的水箱、空滤、电瓶藏掉
      ptrain: { pos: B(-2700, 4500, 2250), tgt: B(-120, 1380, 470), hide: ['Bay_', 'H_Bay', 'H_EComp', 'H_Eng_Intake', 'H_MotStatorQ', 'H_GenStatorQ'],
        ghost: ['H_Case', 'H_Eng_Block', 'H_Eng_Head', 'H_Eng_Cover', 'H_Eng_Front', 'H_Eng_Pan'] },
      ecvt: { pos: B(-1500, 2900, 1300), tgt: B(-230, 1500, 465), hide: ECVT_HIDE, body: 'hidden', fov: 30, xray: [['H_OdGear', 'CastAlu2', .16]],
        flow: [['ac', 'shaft'], .55] },
      engine: { pos: B(1550, 3350, 1250), tgt: B(110, 1560, 540), only: ENGINE_ONLY, body: 'hidden', fov: 30, flow: [['exhaust', 'heatEng'], .6] },
      drive: { pos: B(-5600, 3300, 1900), tgt: B(0, 0, 560), road: true },
      under: { pos: B(-4300, 3900, 2700), tgt: B(0, 0, 300), body: 'hidden' },
    };
    this.view = null; this.hiddenExtra = [];
    this.th = { W: 0, I: 0 };
    this.clutch = 'open'; this.engOn = false; this._flows = {}; this._hl = null;
  }

  async init(carGlb, ptGlb) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = .92;
    const scene = this.scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = .7;
    const cam = this.camera = new THREE.PerspectiveCamera(32, 1, .03, 120);
    cam.position.copy(this.VIEWS.home.pos);
    const ctl = this.controls = new OrbitControls(cam, this.canvas);
    ctl.enableDamping = true; ctl.dampingFactor = .09; ctl.minDistance = .2; ctl.maxDistance = 18; ctl.maxPolarAngle = Math.PI * .497;
    ctl.target.copy(this.VIEWS.home.tgt);
    ctl.addEventListener('start', () => { this.fly = null; });
    const key = new THREE.DirectionalLight(0xfff2df, 1.5); key.position.set(-3, 5, -4); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, .8); rim.position.set(4, 2.2, 4); scene.add(rim);

    const load = (bytes) => new Promise((res, rej) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', res, rej));
    const [gCar, gPt] = await Promise.all([load(carGlb), load(ptGlb)]);
    const root = this.root = new THREE.Group(); scene.add(root);
    const ghosts = { shell: ghostMat('#a8d2f5', .62, 2.4), cabin: ghostMat('#8fa6be', .16, 2.6), other: ghostMat('#9fb2c6', .22, 2.4), ehev: ghostMat('#ffd9a8', .5, 1.9) };
    const hy = new Map();
    for (const [gl, isPt] of [[gCar, false], [gPt, true]]) {
      for (const n of [...gl.scene.children]) {
        if (!isPt && DROP.test(n.name)) continue;
        root.add(n);
        const ex = n.userData || {};
        const group = isPt ? 'ehev' : (this.car.objects[n.name] || ex.group || '');
        let g = ex.g || '';
        if (!isPt) { for (const [re, f] of CAR_G) { const m = re.exec(n.name); if (m) { g = f(m); break; } } if (!g) g = BODY.has(group) ? 'body' : group; }
        const it = { node: n, name: n.name, group, g, body: BODY.has(group), meshes: [], ghost: ghosts[group] || ghosts.other, hid: false };
        n.userData.base = n.position.clone();
        n.traverse((o) => {
          if (!o.isMesh) return;
          o.material = o.material.clone();
          const m = o.material;
          if (/^Glass/.test(m.name)) { m.transparent = true; m.depthWrite = false; }
          m.userData.em0 = m.emissive.clone(); m.userData.ei0 = m.emissiveIntensity; m.userData.op = m.opacity; m.userData.tr = m.transparent;
          o.userData.solid = m; o.userData.item = it; o.userData.ro = /^Glass/.test(m.name) ? 2 : 0;
          it.meshes.push(o); this.meshes.push(o);
        });
        this.items.push(it); this.nodes.set(n.name, n);
        if (isPt) hy.set(n.name, n);
      }
    }
    root.updateMatrixWorld(true);
    this.rig = makeEhevRig(THREE, hy, this.spec);
    this.wheels = ['FL', 'FR', 'RL', 'RR'].map((t) => this.nodes.get(`Wheel_${t}`)).filter(Boolean);
    this._buildRoad();
    this._buildFlow();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
    this.applyView('home', true);
    this.setAngles(0, 0);
  }

  refreshShadow() {}

  resize() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.w = w; this.h = h;
  }

  _buildRoad() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = '#1b2433'; g.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < 2600; i++) {
      const v = 30 + Math.random() * 36;
      g.fillStyle = `rgba(${v},${v + 6},${v + 16},.5)`;
      g.fillRect(Math.random() * 512, Math.random() * 1024, 2, 2);
    }
    g.fillStyle = '#dfe6ef';
    const X = (m) => (m + 2.6) / 5.2 * 512;
    g.fillRect(X(1.85), 0, 10, 1024);
    for (const y of [40, 540]) g.fillRect(X(-1.9), y, 10, 260);
    const tex = this.roadTex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 2);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const a = document.createElement('canvas'); a.width = 16; a.height = 256;
    const ga = a.getContext('2d'), gr = ga.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#000'); gr.addColorStop(.2, '#fff'); gr.addColorStop(.8, '#fff'); gr.addColorStop(1, '#000');
    ga.fillStyle = gr; ga.fillRect(0, 0, 16, 256);
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: .92, metalness: 0, alphaMap: new THREE.CanvasTexture(a), transparent: true });
    const road = this.road = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 16), m);
    road.rotation.x = -Math.PI / 2; road.position.set(0, -.002, 0);
    this.scene.add(road);
    // 车底下一块柔和的影子（不开实时阴影，手机上省很多）
    const s = document.createElement('canvas'); s.width = s.height = 128;
    const gs = s.getContext('2d'), rg = gs.createRadialGradient(64, 64, 8, 64, 64, 64);
    rg.addColorStop(0, 'rgba(0,0,0,.55)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    gs.fillStyle = rg; gs.fillRect(0, 0, 128, 128);
    const sh = this.floor = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(s), transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(0, .001, 0);
    this.scene.add(sh);
  }

  _buildFlow() {
    const F = this.spec.flows, D = this.car.dims, P = (p) => B(p[0], p[1], p[2]);
    const half = D.track / 2, wb = D.WB / 2;
    const sh = (tag, sx) => ({ a: this.nodes.get(`H_Shaft${tag}`).position.clone(), b: B(sx * (half - 62), wb, D.r_tyre), sign: sx });
    const exh = F.exhaust.map(P);
    this.flow = makeFlowViz(THREE, this.scene, {
      dc: F.dc.map(P).reverse(),                                   // 电池 → PCU
      acMot: F.ac_mot.map((p) => [P(p[1]), P(p[0])]),              // PCU → 驱动电机
      acGen: F.ac_gen.map((p) => [P(p[0]), P(p[1])]),              // 发电机 → PCU
      fuel: F.fuel.map(P), exhaust: exh,
      shafts: [sh('L', -1), sh('R', 1)],
      contact: [B(-(half + 175), wb, 6), B(half + 175, wb, 6)],
      heat: { eng: B(128, 1560, 850), drive: B(-285, 1520, 770), tail: exh[exh.length - 1].clone().add(new THREE.Vector3(0, 0, .12)) },
      label: { dc: B(-650, 100, 420), acMot: B(-430, 1440, 880), acGen: B(-430, 1640, 780), fuel: B(-100, 520, 200), heatEng: B(128, 1560, 1180),
        heatDrive: B(-285, 1500, 1020), axle: B(-720, 1400, 120) },
    });
  }

  /**
   * 能量流，单位 kW（force 是牛顿）。正方向：fuel 油箱 → 发动机；eng_gen 发动机 → 发电机；eng_wheel 发动机 → 车轮；
   * mot_wheel 驱动电机 → 车轮；gen_pcu 发电机 → PCU；pcu_mot PCU → 驱动电机；batt_pcu 电池放电；axle_L / axle_R 到车轮
   */
  setFlows(o) {
    this._flows = o || {};
    this.flow.set(this._flows);
    this._glow();
  }
  _glow() { const o = this._flows; this.rig.setGlow({ eng_gen: o.eng_gen, eng_wheel: o.eng_wheel, mot_wheel: o.mot_wheel, ac_mot: o.pcu_mot, ac_gen: o.gen_pcu }); }
  /** 只看哪几种：{ elec, mech, fuel, heat } */
  setFlowFilter(f) { this.flow.setFilter(f); }
  flowLabels() { return this.flow.labels(); }
  /** 按“跟谁一起转”上色（发动机这边橙、车轮这边绿） */
  setTint(on) { this.rig.setTint(on); if (!on) { this._glow(); this.rig.setClutch(this.clutch); } }

  _state(it) {
    const v = this.VIEWS[this.view] || {};
    const pre = (list) => list.some((h) => it.name.startsWith(h));
    if (v.only && !pre(v.only)) return 'hide';
    if (pre([...(v.hide || []), ...this.hiddenExtra])) return 'hide';
    if (v.ghost && pre(v.ghost)) return 'ghost';
    if (it.body) {
      const mode = v.body || this.bodyMode;
      if (mode === 'hidden') return 'hide';
      if (mode === 'ghost') return it.group === 'shell' || it.group === 'cabin' ? 'ghost' : 'hide';
    }
    return 'solid';
  }

  refreshVisibility() {
    for (const it of this.items) {
      const st = this._state(it);
      it.state = st; it.node.visible = st !== 'hide';
      if (it.name.startsWith('H_Burn')) { it.node.userData.hid = st === 'hide'; if (st === 'hide') it.node.visible = false; continue; }
      if (it.body || it.wasGhost || st === 'ghost') for (const o of it.meshes) { o.material = st === 'ghost' ? it.ghost : o.userData.solid; o.renderOrder = st === 'ghost' ? 3 : o.userData.ro; }
      it.wasGhost = st === 'ghost';
    }
    this.rig.set(this.th.W, this.th.I);
  }

  /** 车身：solid 实体 / ghost 只留轮廓 / hidden 隐藏 */
  setBody(mode) { this.bodyMode = mode; this.refreshVisibility(); }

  applyView(name, instant = false, dur = 1.1) {
    const v = this.VIEWS[name];
    this.view = name;
    this.refreshVisibility();
    this._xray(v.xray || []);
    this.road.visible = !!v.road;
    this.floor.visible = !v.road;
    this.flow.setScope(v.flow ? v.flow[0] : null, v.flow ? v.flow[1] : 1);
    const fov = v.fov || 32;
    const from = { pos: this.camera.position.clone(), tgt: this.controls.target.clone(), fov: this.camera.fov };
    const fit = this._fitPos(v);
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera.position.copy(fit); this.controls.target.copy(v.tgt); this.camera.fov = fov; this.camera.updateProjectionMatrix();
      this.fly = null; return;
    }
    this.fly = { from, to: { pos: fit, tgt: v.tgt.clone(), fov }, t: 0, dur };
  }

  /** 某些零件的某种材质在这个机位下变透明（离合器外鼓，好看见里面的摩擦片） */
  _xray(list) {
    for (const o of this.meshes) {
      const m = o.userData.solid;
      const hit = list.find(([n, mn]) => o.userData.item.name === n && m.name === mn);
      if (hit) { m.transparent = true; m.opacity = hit[2]; m.depthWrite = false; m.needsUpdate = true; m.userData.xr = true; }
      else if (m.userData.xr) { m.transparent = m.userData.tr; m.opacity = m.userData.op; m.depthWrite = true; m.needsUpdate = true; m.userData.xr = false; }
    }
  }

  _fitPos(v) {
    const asp = (this.w || 1) / (this.h || 1);
    const k = asp < 1.25 ? 1.25 / Math.max(asp, .55) : 1;
    return v.tgt.clone().add(v.pos.clone().sub(v.tgt).multiplyScalar(k));
  }

  /** 拆开：0…1。混动的件按 spec.explode（毫米），车身往上抬，车轮往两边 */
  setExplode(t) {
    this.explodeT = t;
    const ex = this.spec.explode;
    for (const it of this.items) {
      let e = it.group === 'ehev' ? ex[it.g] : EX_CAR[it.group];
      if (it.group === 'wheels') e = [(/L$/.test(it.name) ? -1 : 1) * 380, 0, 0, .1];
      const n = it.node;
      if (!e) { n.userData.exOff = null; n.position.copy(n.userData.base); continue; }
      const s = easeIO((t - e[3]) / Math.max(1 - e[3], .01));
      n.userData.exOff = B(e[0], e[1], e[2]).multiplyScalar(s);
      n.position.copy(n.userData.base).add(n.userData.exOff);
    }
    this.setAngles(this.th.W, this.th.I);
    this.setClutch(this.clutch);
    const apart = t > .015;
    if (apart !== this._apart) { this._apart = apart; this.flow.group.visible = !apart; }
  }

  /** 车轮转角 thW、曲轴转角 thI（弧度，增大 = 向前）。其余轴按齿数算出来 */
  setAngles(thW, thI) {
    this.th.W = thW; this.th.I = thI;
    this.rig.set(thW, thI);
    for (const n of this.wheels) n.rotation.x = -thW;
  }

  setEngine(on) { if (this.engOn === on) return; this.engOn = on; this.rig.setEngine(on); }

  /** 离合器：open 分开 / sync 同步中 / locked 接合 */
  setClutch(state) { this.clutch = state; if (!this.rig.isTint()) this.rig.setClutch(state); }

  scrollRoad(dist) {
    this.roadOffset = (this.roadOffset + dist / (16 / 2)) % 1;
    this.roadTex.offset.y = this.roadOffset;
  }

  project(v3) {
    const p = v3.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * this.w, y: (1 - p.y) / 2 * this.h, behind: p.z > 1 || p.z < -1 };
  }

  /** 点了哪个件：返回零件组的名字（只剩轮廓的车身不算） */
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    const rc = this._ray || (this._ray = new THREE.Raycaster());
    rc.setFromCamera(v, this.camera);
    const vis = this.meshes.filter((m) => m.userData.item.state === 'solid' && m.userData.item.node.visible && !m.userData.item.name.startsWith('H_Burn'));
    const hits = rc.intersectObjects(vis, false);
    return hits.length ? hits[0].object.userData.item.g : null;
  }

  /** 高亮一个零件组（或一组零件组）；null = 取消 */
  highlight(g) {
    const amber = new THREE.Color('#ffb547');
    for (const o of this.meshes) {
      const it = o.userData.item;
      if (it.name.startsWith('H_Burn')) continue;
      const on = !!g && (Array.isArray(g) ? g.includes(it.g) : it.g === g);
      const m = o.userData.solid;
      if (on) { m.userData.hl = true; m.emissive.copy(amber); m.emissiveIntensity = .36; }
      else if (m.userData.hl) { m.userData.hl = false; m.emissive.copy(m.userData.em0); m.emissiveIntensity = m.userData.ei0; }
    }
    this._hl = g;
    if (this.rig.isTint()) this.rig.setTint(true); else { this._glow(); this.rig.setClutch(this.clutch); }
  }

  frame(dt) {
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
    this.flow.tick(dt, { thW: this.th.W, px: this.h * this.renderer.getPixelRatio() / (2 * Math.tan(this.camera.fov * Math.PI / 360)) });
    this.renderer.render(this.scene, this.camera);
  }
}
