// three.js 舞台：把 Blender 导出的车摆出来，按仿真给的转速让零件动。
// 坐标：Blender 里 x 向右、y 向车头、z 向上（毫米）；three 里 y 向上（米）。绕 x 轴的转角两边是同一个数。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { beltPath, pistonHeight, rodAngle, valveLift } from './core.js';
import { makeEhevRig } from './ehev_rig.js';
import { makeFlowViz, ehevFlowPaths } from './flowviz.js';

const CVT_ONLY = /^(Eng_|Cvt_|Drv_|PT_Mounts|Bay_Intake)/;       // 燃油版自己的件；换成混动时藏起来

const MM = 0.001, TAU = Math.PI * 2, DEG = Math.PI / 180;
export const B = (x, y, z) => new THREE.Vector3(x * MM, z * MM, -y * MM);
const BD = (v) => new THREE.Vector3(v[0], v[2], -v[1]).normalize();          // Blender 里的方向 → three 里的方向
const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

const GHOST_V = `varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const GHOST_F = `uniform vec3 uC; uniform float uA; uniform float uP; varying vec3 vN; varying vec3 vV;
void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), uP); gl_FragColor = vec4(uC, uA * (.06 + .94 * f)); }`;
const ghostMat = (hex, a, p) => new THREE.ShaderMaterial({
  vertexShader: GHOST_V, fragmentShader: GHOST_F, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uC: { value: new THREE.Color(hex).convertLinearToSRGB() }, uA: { value: a }, uP: { value: p } },
});

const BODY = new Set(['shell', 'frame', 'trim', 'cabin', 'chassis']);
const GHOSTS = {
  shell: ['#9ec8ee', .5, 2.0], frame: ['#a9b9c9', .16, 2.3], trim: ['#8aa0b8', .05, 2.8], cabin: ['#7f97b0', .12, 2.6],
  chassis: ['#8ea3b8', .2, 2.4], wheels: ['#93a7bb', .32, 2.0], housing: ['#ffd29a', .55, 1.7], other: ['#9fb2c6', .2, 2.2],
};
export const MODES = ['car', 'xray', 'pt', 'inside', 'drive'];
const FOV = 32;

export class Stage {
  /** car = core.makeCar(params)，spec = blender/out/spec.json，specE = blender/out/spec_ehev.json（第二套动力：两电机混动） */
  constructor(canvas, car, spec, specE) {
    this.canvas = canvas; this.car = car; this.spec = spec; this.specE = specE; this.D = spec.powertrain.derived;
    this.mode = 'xray'; this.hood = 0; this.hoodTarget = 0; this.pt = 'cvt';
    this.ang = { crank: 0, turbine: 0, pri: 0, sec: 0, inter: 0, wheel: 0, belt: 0, road: 0, crankE: 0 };
    this.items = []; this.byName = new Map();
    this.VIEWS = {
      car: { pos: B(-4500, 5100, 2100), tgt: B(0, 150, 560) },
      xray: { pos: B(-3300, 4700, 2300), tgt: B(0, 800, 520) },
      pt: { pos: B(-1900, 3600, 1500), tgt: B(-20, 1430, 400) },
      inside: { pos: B(-1400, 3000, 1250), tgt: B(-60, 1480, 430) },
      engine: { pos: B(1050, 2900, 1150), tgt: B(128, 1560, 540) },
      cvt: { pos: B(-1300, 2300, 900), tgt: B(-250, 1490, 450) },
      hood: { pos: B(-2300, 5300, 2700), tgt: B(0, 1500, 760) },
    };
    // 驾驶位：机位就在眼点上，target 放在视线方向 1 cm 处，拖动画面就是转头（fp = 第一人称，不按竖屏退远）
    const ck = spec.cockpit, eye = B(...ck.eye);
    const look = (p, fov) => ({ pos: eye.clone(), tgt: eye.clone().add(B(...p).sub(eye).normalize().multiplyScalar(.01)), fov, fp: true });
    this.VIEWS.drive = look(ck.look, null);
    this.VIEWS.gauges = look(ck.cluster.c, 24);
    // 看脚下：从眼点看，踏板被方向盘下面两根辐条挡着（真车也一样），所以把头往左下探，从方向盘左下角下面看进脚坑
    const lean = B(-600, 380, 800);
    this.VIEWS.feet = { pos: lean, tgt: lean.clone().add(B(-360, 1080, 520).sub(lean).normalize().multiplyScalar(.01)), fov: null, fp: true };
    this.tween = null;
  }

  async init(glbBytes, ptBytes) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    const scene = this.scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = .8;
    const cam = this.camera = new THREE.PerspectiveCamera(FOV, 1, .05, 600);
    const ctl = this.controls = new OrbitControls(cam, this.canvas);
    ctl.enableDamping = true; ctl.dampingFactor = .09; ctl.minDistance = .35; ctl.maxDistance = 30; ctl.maxPolarAngle = Math.PI * .497;
    ctl.addEventListener('start', () => { this.tween = null; });
    const key = new THREE.DirectionalLight(0xfff2df, 1.6); key.position.set(-3, 5, -4); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, .9); rim.position.set(4, 2.2, 4); scene.add(rim);

    const parse = (b) => new Promise((res, rej) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej));
    const [gltf, gltfE] = await Promise.all([parse(glbBytes), parse(ptBytes)]);
    const root = this.root = gltf.scene; scene.add(root);
    const hy = new Map();
    for (const n of [...gltfE.scene.children]) { root.add(n); hy.set(n.name, n); }      // 混动的件挂到同一个根上
    root.updateMatrixWorld(true);
    const gm = Object.fromEntries(Object.entries(GHOSTS).map(([k, v]) => [k, ghostMat(...v)]));
    for (const n of [...root.children]) {
      const ex = n.userData || {}, isE = hy.has(n.name);
      // 混动的件归到和燃油版一样的几组里：前舱附件 → bay，电池和高压线 → under，其余 → powertrain
      const group = isE ? (/^H_(Bay|EComp)/.test(n.name) ? 'bay' : /^H_(HV_|IPU)/.test(n.name) ? 'under' : 'powertrain') : this.spec.objects[n.name] || ex.group || '';
      const housing = group === 'powertrain' && (ex.kind === 'housing' || ex.shell === 1 || /^(PT_Mounts|H_Mounts|H_PCU)$/.test(n.name));
      const it = { node: n, name: n.name, group, ex, housing, meshes: [], ghost: housing ? gm.housing : gm[group] || gm.other, state: 'solid',
        pt: isE ? 'ehev' : CVT_ONLY.test(n.name) ? 'cvt' : '', cutQ: /^H_(Mot|Gen)StatorQ$/.test(n.name) };
      n.traverse((o) => {
        if (!o.isMesh) return;
        if (isE) o.material = o.material.clone();            // 混动的轴会按“谁在传力”发光，每个网格要有自己的一份材质
        const glass = /^Glass/.test(o.material.name);
        if (glass) { o.material.transparent = true; o.material.depthWrite = false; }
        o.userData.solid = o.material; o.userData.ro = glass ? 2 : 0; o.userData.item = it;
        it.meshes.push(o);
      });
      this.items.push(it); this.byName.set(n.name, it);
    }
    this._rig();
    this.rigE = makeEhevRig(THREE, hy, this.specE);
    this.flow = makeFlowViz(THREE, scene, ehevFlowPaths(THREE, this.specE, this.spec.dims, (t) => hy.get(`H_Shaft${t}`).position));
    this._rigCockpit();
    this._buildBelt();
    this._buildGround();
    this._buildWorld();
    this.setMode(this.mode, false);
    this.resize();
    this._goto(this.VIEWS[this.mode], 0);
  }

  // ------------------------------------------------------------------ 会动的件
  _rig() {
    const N = (k) => this.byName.get(k)?.node, P = this.car.P, D = this.D;
    const order = Object.fromEntries(P.engine.firing.map((c, k) => [c, k]));       // 缸号 → 第几个点火
    this.m = {
      crank: [N('Eng_Crank'), N('Cvt_Impeller')], cam: [N('Eng_CamIn'), N('Eng_CamEx')],
      turbine: [N('Cvt_Turbine')], pri: [N('Cvt_FwdRev'), N('Cvt_PriFixed'), N('Cvt_PriMove')],
      sec: [N('Cvt_SecFixed'), N('Cvt_SecMove'), N('Cvt_OutGear')], inter: [N('Cvt_Idler')], diff: [N('Cvt_Diff')],
      wheels: ['FL', 'FR', 'RL', 'RR'].map((t) => N(`Wheel_${t}`)),
      shafts: ['L', 'R'].map((t) => { const n = N(`Drv_Shaft${t}`), a = n.userData.axis; return { n, axis: new THREE.Vector3(a[0], a[2], -a[1]).normalize(), sign: Math.sign(a[0]) }; }),
      pistons: [], rods: [], valves: [], priMove: N('Cvt_PriMove'), secMove: N('Cvt_SecMove'),
    };
    for (let c = 1; c <= 4; c++) {
      const ph = N(`Eng_Piston${c}`).userData.phase * Math.PI / 180;
      this.m.pistons.push({ n: N(`Eng_Piston${c}`), ph }); this.m.rods.push({ n: N(`Eng_Rod${c}`), ph });
      for (const side of ['In', 'Ex']) {
        const n = N(`Eng_Valve${side}${c}`), d = n.userData.dir;
        this.m.valves.push({ n, base: n.position.clone(), dir: new THREE.Vector3(d[0], d[2], -d[1]).multiplyScalar(n.userData.lift * MM), side: side.toLowerCase(), k: order[c] });
      }
    }
    this.zCrank = P.place.z_crank; this.rCrank = D.r_crank; this.rod = P.engine.rod;
    // 前盖：绕后缘转
    const hood = N('Panel_Hood');
    const box = new THREE.Box3().setFromObject(hood);
    const pivot = this.hoodPivot = new THREE.Group();
    pivot.position.set(0, box.max.y - .004, box.max.z);          // three 里 z 最大 = 最靠后
    this.root.add(pivot); pivot.updateMatrixWorld(true); pivot.attach(hood);
    this.byName.get('Cvt_Belt').node.visible = false;             // 导出的钢带只是最低挡的样子，网页里按速比重新摆
    this.byName.get('Cvt_Belt').dead = true;
  }

  /** 驾驶位：方向盘、挡杆、两个踏板，仪表盘和挡位面板上的两块画布（main.js 往上画） */
  _rigCockpit() {
    const N = (k) => this.byName.get(k)?.node, P = this.car.P.cockpit, ck = this.spec.cockpit;
    this.cp = {
      wheel: N('SteeringWheel'), shifter: N('Shifter'), acc: N('Pedal_Acc'), brake: N('Pedal_Brake'),
      gate: P.gate, accT: P.acc_travel * DEG, brakeT: P.brake_travel * DEG, lever: P.gate.P * DEG,
    };
    this.cluster = this._canvasPlane(ck.cluster, 1024, 360, N('Dash_Cluster'), false);
    this.gatePlate = this._canvasPlane(ck.gate, 64, 256, N('Console'), true);
  }

  /** 贴在零件表面上的一块画布。sp = { c 中心, u 画布朝上的方向, n 法线, w, h }（mm、Blender 坐标）。挂在 parent 下面，跟着它显示 / 隐藏 */
  _canvasPlane(sp, pw, ph, parent, transparent) {
    const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sp.w * MM, sp.h * MM), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent }));
    const xa = new THREE.Vector3(1, 0, 0), ya = BD(sp.u), za = BD(sp.n);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xa, ya, za));
    mesh.position.copy(B(...sp.c)).addScaledVector(za, .0006);
    mesh.renderOrder = 1;
    (parent || this.root).add(mesh);
    return { canvas: cv, ctx: cv.getContext('2d'), tex, mesh };
  }

  _buildBelt() {
    const C = this.car.P.cvt, n = this.nBelt = 150, pitch = this.car.BELT / n;
    const g = new THREE.BoxGeometry(C.belt_w * MM, C.belt_t * MM, pitch * .78 * MM);
    const p = g.attributes.position, k = this.car.tan / (C.belt_w / 2);
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (1 + p.getY(i) / MM * k));   // 两侧斜面和锥盘贴合
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: .85, roughness: .38 });
    const mesh = this.belt = new THREE.InstancedMesh(g, mat, n);
    const base = new THREE.Color('#8c939b'), mark = new THREE.Color('#ff7a2e');
    for (let i = 0; i < n; i++) mesh.setColorAt(i, i % 15 === 0 ? mark : base);       // 每 15 片涂一片橙色，好看出钢带在走
    mesh.frustumCulled = false; mesh.userData.item = { name: 'Cvt_Belt', group: 'powertrain', state: 'solid' };
    this.root.add(mesh);
    this._mx = new THREE.Matrix4(); this._vx = new THREE.Vector3(1, 0, 0); this._vy = new THREE.Vector3(); this._vz = new THREE.Vector3();
  }

  _placeBelt(r1, r2) {
    const D = this.D, C = this.car.P.cvt, path = beltPath(D.a0, D.a1, r1, r2);
    const xc = ((D.x0p - C.belt_w / 2 + r1 * this.car.tan) + (D.x0s + C.belt_w / 2 - r2 * this.car.tan)) / 2 * MM;
    const n = this.nBelt, m = this._mx;
    for (let i = 0; i < n; i++) {
      const q = path.at(this.ang.belt + path.total * i / n);
      this._vy.set(0, q[3], -q[2]); this._vz.set(0, q[2], q[3]);
      m.makeBasis(this._vx, this._vy, this._vz).setPosition(xc, q[1] * MM, -q[0] * MM);
      this.belt.setMatrixAt(i, m);
    }
    this.belt.instanceMatrix.needsUpdate = true;
  }

  _buildGround() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d'), gr = x.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, 'rgba(120,138,156,.34)'); gr.addColorStop(.55, 'rgba(90,106,122,.14)'); gr.addColorStop(1, 'rgba(90,106,122,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.002; floor.renderOrder = -2; this.scene.add(floor); this.floor = floor;
    const s = document.createElement('canvas'); s.width = 128; s.height = 256;
    const y = s.getContext('2d'); y.filter = 'blur(14px)'; y.fillStyle = 'rgba(0,0,0,.75)'; y.fillRect(26, 30, 76, 196);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 6.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(s), transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(0, -.001, .03); sh.renderOrder = -1; this.scene.add(sh); this.shadow = sh;
    // 路面虚线：车不挪地方，线往后走
    const n = 16, dash = this.dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(.1, 1.4), new THREE.MeshBasicMaterial({ color: '#c9d2da', transparent: true, opacity: .3, depthWrite: false }), n * 2);
    dash.rotation.x = -Math.PI / 2; dash.position.y = 0; dash.renderOrder = -1; dash.frustumCulled = false; this.scene.add(dash);
    this.nDash = n;
  }

  /** 驾驶位才有的路：沥青、车道线、路边的反光柱和路灯，远处起雾。车不动，路往后走 */
  _buildWorld() {
    const w = this.world = new THREE.Group(); w.visible = false; this.scene.add(w);
    const flat = (wd, ln, color, y) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(wd, ln), new THREE.MeshStandardMaterial({ color, roughness: .95 }));
      m.rotation.x = -Math.PI / 2; m.position.set(0, y, -ln / 2 + 60); w.add(m); return m;
    };
    flat(900, 1200, '#262c27', -.012);                 // 路两边的地
    flat(11.6, 1200, '#33373b', -.008);                // 沥青：三条 3.6 m 的车道 + 两边路肩
    for (const x of [-5.45, 5.45]) flat(.15, 1200, '#d9dde0', -.006).position.x = x;     // 路边的实线
    const inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; w.add(m); return m; };
    const white = new THREE.MeshBasicMaterial({ color: '#cfd5da' });
    this.wDash = inst(new THREE.PlaneGeometry(.15, 4), white, 60);                        // 车道虚线：线 4 m、间隔 8 m
    this.wDash.rotation.x = -Math.PI / 2; this.wDash.position.y = -.005;
    const postG = new THREE.CylinderGeometry(.05, .05, 1, 8); postG.translate(0, .5, 0);
    this.wPost = inst(postG, new THREE.MeshStandardMaterial({ color: '#e8eaec', roughness: .6 }), 48);
    const refl = new THREE.BoxGeometry(.07, .12, .02); refl.translate(0, .88, 0);
    this.wRefl = inst(refl, new THREE.MeshBasicMaterial({ color: '#ff9a2e' }), 48);
    const poleG = new THREE.CylinderGeometry(.09, .13, 9, 10); poleG.translate(0, 4.5, 0);
    const armG = new THREE.BoxGeometry(2.2, .1, .14); armG.translate(1.0, 8.9, 0);
    const pole = new THREE.MeshStandardMaterial({ color: '#79828b', roughness: .5, metalness: .6 });
    this.wPole = inst(poleG, pole, 8); this.wArm = inst(armG, pole, 8);
    const headG = new THREE.BoxGeometry(.6, .1, .26); headG.translate(2.0, 8.82, 0);
    this.wHead = inst(headG, new THREE.MeshBasicMaterial({ color: '#fff1cf' }), 8);
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#0f1724'); gr.addColorStop(.42, '#2e3d52'); gr.addColorStop(.5, '#5b6b7e'); gr.addColorStop(1, '#262c27');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    this.sky = new THREE.CanvasTexture(c); this.sky.colorSpace = THREE.SRGBColorSpace;
    this.fog = new THREE.Fog('#4e5d6f', 30, 300);
  }

  /** 车往前开了 road 米：周期为 L 的第 i 个东西现在在车前多远（three 的 z，负的是车头方向）。从车后 back 米到车前 span − back 米循环 */
  static _ahead(i, L, n, road, back) {
    const span = L * n, d = (((i * L - road) % span) + span) % span;
    return -(d - back);
  }

  _placeWorld() {
    const m = this._mx, r = this.ang.road, A = Stage._ahead;
    for (let i = 0; i < 30; i++) for (let k = 0; k < 2; k++) {
      m.makeTranslation(k ? 1.8 : -1.8, -A(i, 12, 30, r, 40), 0);         // 这个网格转过：自己的 y 轴对着车头
      this.wDash.setMatrixAt(i * 2 + k, m);
    }
    for (let i = 0; i < 24; i++) for (let k = 0; k < 2; k++) {
      m.makeTranslation(k ? 6.3 : -6.3, 0, A(i, 16, 24, r, 40));
      this.wPost.setMatrixAt(i * 2 + k, m); this.wRefl.setMatrixAt(i * 2 + k, m);
    }
    for (let i = 0; i < 8; i++) {
      m.makeTranslation(-7.4, 0, A(i, 48, 8, r, 60));
      this.wPole.setMatrixAt(i, m); this.wArm.setMatrixAt(i, m); this.wHead.setMatrixAt(i, m);
    }
    for (const x of [this.wDash, this.wPost, this.wRefl, this.wPole, this.wArm, this.wHead]) x.instanceMatrix.needsUpdate = true;
  }

  _placeRoad() {
    const n = this.nDash, gap = 3.2, m = this._mx, off = ((this.ang.road % gap) + gap) % gap;
    for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) {
      // 这个网格绕 x 转了 -90°：它自己的 y 轴对着世界的 -z（车头方向）
      m.makeTranslation(k ? 2.3 : -2.3, (n / 2 - i) * gap - off, 0);
      this.dash.setMatrixAt(i * 2 + k, m);
    }
    this.dash.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ 看哪些件
  setMode(mode, fly = true) {
    const was = this.mode;
    this.mode = mode;
    const drive = mode === 'drive';
    this.flow.group.visible = mode === 'xray' || mode === 'pt' || mode === 'inside';      // 车身是实心的时候不画能量流
    this.flow.setScope(mode === 'inside' ? ['ac', 'shaft', 'arrow', 'dc', 'heatDrive'] : null, 1);   // 看内部时不画油管和排气，它们会横在镜头前
    for (const it of this.items) {
      if (it.dead) continue;
      if (it.pt && it.pt !== this.pt) { it.state = 'hide'; it.node.visible = false; continue; }   // 另一套动力的件
      if (it.name.startsWith('H_Burn')) { it.state = 'hide'; it.node.userData.hid = mode === 'car' || mode === 'drive'; continue; }   // 燃烧的闪光由 rigE 管
      const g = it.group;
      let st;
      if (drive) st = g === 'powertrain' || g === 'bay' || g === 'under' ? 'hide' : 'solid';   // 坐在车里看不到前舱，不画
      else if (mode === 'car') st = 'solid';
      else if (mode === 'xray') st = BODY.has(g) ? 'ghost' : 'solid';
      else if (mode === 'pt') st = g === 'powertrain' || g === 'under' || g === 'wheels' ? 'solid' : g === 'chassis' ? 'ghost' : 'hide';
      else st = g === 'powertrain' ? (it.cutQ ? 'hide' : it.housing ? 'ghost' : 'solid') : g === 'wheels' ? 'ghost' : 'hide';   // 内部：壳体和车轮都变透明，只留会动的件（定子剖掉四分之一）
      it.state = st; it.node.visible = st !== 'hide';
      for (const o of it.meshes) { o.material = st === 'ghost' ? it.ghost : o.userData.solid; o.renderOrder = st === 'ghost' ? 3 : o.userData.ro; }
    }
    this.world.visible = drive; this.floor.visible = this.shadow.visible = this.dash.visible = !drive;
    this.scene.background = drive ? this.sky : null; this.scene.fog = drive ? this.fog : null;
    const c = this.controls;
    if (drive) Object.assign(c, { minDistance: .01, maxDistance: .01, enableZoom: false, enablePan: false, rotateSpeed: -.32, minPolarAngle: Math.PI * .2, maxPolarAngle: Math.PI * .78 });
    else Object.assign(c, { minDistance: .35, maxDistance: 30, enableZoom: true, enablePan: true, rotateSpeed: 1, minPolarAngle: 0, maxPolarAngle: Math.PI * .497 });
    // 进出驾驶位直接切过去：飞的话机位会从车身里穿过去
    if (fly) this._goto(this.VIEWS[mode === 'car' && this.hoodTarget ? 'hood' : mode], drive || was === 'drive' ? 0 : .8);
  }
  /** 换动力：'cvt' 燃油 + CVT / 'ehev' 两电机混动。另一套的件藏起来，车身和底盘共用 */
  setPowertrain(pt) { this.pt = pt; this.flow.set({}); this.setMode(this.mode, false); }
  /** 能量流（kW，见 flowviz.js）和哪根轴在传力（见 ehev_rig.js 的 setGlow） */
  setFlows(f, glow) { this.flow.set(f); if (this.pt === 'ehev' && glow) this.rigE.setGlow(glow); }
  /** 第一人称的视场角：横着大约看 80°，太宽太窄都夹住 */
  _fpFov() { return Math.max(48, Math.min(76, 2 * Math.atan(Math.tan(40 * DEG) / this.aspect) / DEG)); }
  setHood(open) { this.hoodTarget = open ? 1 : 0; if (this.mode === 'car') this._goto(this.VIEWS[open ? 'hood' : 'car']); }
  lookAt(key) { this._goto(this.VIEWS[key]); }

  _goto(view, dur = .8) {
    const k = !view.fp && this.aspect < 1.25 ? Math.pow(1.25 / this.aspect, .85) : 1;       // 竖屏：退远一点，别把车切掉
    const pos = view.tgt.clone().add(view.pos.clone().sub(view.tgt).multiplyScalar(k));
    const fov = view.fp ? view.fov || this._fpFov() : FOV;
    if (!dur) { this.tween = null; this.camera.position.copy(pos); this.controls.target.copy(view.tgt); this._setFov(fov); this.controls.update(); return; }
    this.tween = { t: 0, dur, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: view.tgt.clone(), f0: this.camera.fov, f1: fov };
  }
  _setFov(f) { if (Math.abs(this.camera.fov - f) > 1e-3) { this.camera.fov = f; this.camera.updateProjectionMatrix(); } }

  resize() {
    const w = this.canvas.clientWidth || 2, h = this.canvas.clientHeight || 2;
    this.aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.aspect; this.camera.updateProjectionMatrix();
    if (this.mode === 'drive' && !this.tween && this.camera.fov > 40) this._setFov(this._fpFov());
  }

  /** 点了哪个件：返回物体名字（透明的壳不算） */
  pick(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1);
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    ray.setFromCamera(ndc, this.camera);
    for (const h of ray.intersectObject(this.root, true)) {
      const it = h.object.userData.item;
      if (!it || it.state !== 'solid' || !h.object.visible) continue;
      let vis = true;
      for (let o = h.object; o; o = o.parent) if (!o.visible) { vis = false; break; }
      if (vis) return it.name;
    }
    return '';
  }

  // ------------------------------------------------------------------ 每一帧
  /** o = core 的 step 输出；slow = 零件动作放慢多少倍；dt = 这一帧过了多少秒；gear = 挡位。坐在驾驶位时不放慢 */
  update(dt, o, slow, gear) {
    if (this.mode === 'drive') slow = 1;
    const a = this.ang, k = dt / slow, car = this.car, m = this.m;
    if (this.pt === 'ehev') this._animEhev(o, k); else this._animCvt(o, k);
    if (this.mode === 'drive') this._placeWorld(); else this._placeRoad();
    this.belt.visible = this.pt === 'cvt' && this.mode !== 'drive' && (this.mode !== 'car' || this.hood > .02);
    this.flow.setK(Math.max(.26, Math.min(1, this.camera.position.distanceTo(this.controls.target) / 6.5)));   // 镜头越近画得越细
    this.flow.tick(dt, { thW: a.wheel, px: this.canvas.clientHeight * this.renderer.getPixelRatio() / (2 * Math.tan(this.camera.fov * Math.PI / 360)) });
    this._tail(dt, o, gear);
  }

  /** 混动：o.kmh 车速、o.n 发动机转速（rpm）、o.clutch、o.eng。别的轴按齿数算（ehev_rig.js） */
  _animEhev(o, k) {
    const a = this.ang, w = (o.kmh / 3.6) / this.car.rRoll;
    a.wheel += w * k; a.crankE += o.n * Math.PI / 30 * k; a.road += (o.kmh / 3.6) * k;
    this.rigE.setEngine(!!o.eng); this.rigE.setClutch(o.clutch || 'open');
    this.rigE.set(a.wheel, a.crankE);
    for (const n of this.m.wheels) n.rotation.x = -a.wheel;
  }

  _animCvt(o, k) {
    const a = this.ang, car = this.car, m = this.m;
    a.crank = (a.crank + o.we * k) % (2 * TAU);
    a.turbine = (a.turbine + o.wt * k) % TAU;
    a.pri = (a.pri + o.wPri * k) % TAU;
    a.sec = (a.sec + o.wSec * k) % TAU;
    a.inter = (a.inter - o.wSec * car.P.cvt.z_out / car.P.cvt.z_idler * k) % TAU;
    a.wheel = (a.wheel + o.wSec / car.final * k) % TAU;
    const { r1, r2 } = car.radii(o.ratio);
    a.belt += o.wPri * r1 * k;                                   // 钢带线速度 = 主动轮角速度 × 半径（mm/s）
    a.road += (o.kmh / 3.6) * k;
    this.r1 = r1; this.r2 = r2;

    for (const n of m.crank) n.rotation.x = -a.crank;
    for (const n of m.cam) n.rotation.x = -a.crank / 2;
    for (const n of m.turbine) n.rotation.x = -a.turbine;
    for (const n of m.pri) n.rotation.x = -a.pri;
    for (const n of m.sec) n.rotation.x = -a.sec;
    for (const n of m.inter) n.rotation.x = -a.inter;
    for (const n of m.diff) n.rotation.x = -a.wheel;
    for (const n of m.wheels) n.rotation.x = -a.wheel;
    for (const s of m.shafts) s.n.quaternion.setFromAxisAngle(s.axis, -a.wheel * s.sign);
    for (let i = 0; i < 4; i++) {
      const al = a.crank + m.pistons[i].ph, y = (this.zCrank + pistonHeight(this.rCrank, this.rod, al)) * MM;
      m.pistons[i].n.position.y = y; m.rods[i].n.position.y = y;
      m.rods[i].n.rotation.x = rodAngle(this.rCrank, this.rod, al);
    }
    const deg = a.crank * 180 / Math.PI;
    for (const v of m.valves) v.n.position.copy(v.base).addScaledVector(v.dir, valveLift(v.side, deg - 180 * v.k));
    m.priMove.position.x = (this.D.x0p - car.sheaveGap(r1)) * MM;
    m.secMove.position.x = (this.D.x0s + car.sheaveGap(r2)) * MM;
    this._placeBelt(r1, r2);
  }

  _tail(dt, o, gear) {
    // 驾驶位的三个件：踏板绕铰链往前转，挡杆往目标挡位摆（方向盘等做转向时再动）
    const cp = this.cp;
    cp.acc.rotation.x = cp.accT * o.pedal; cp.brake.rotation.x = cp.brakeT * o.brake;
    cp.lever += ((cp.gate[gear] ?? 0) * DEG - cp.lever) * Math.min(1, dt * 14);
    cp.shifter.rotation.x = cp.lever;

    this.hood += Math.max(-dt / .7, Math.min(dt / .7, this.hoodTarget - this.hood));
    this.hoodPivot.rotation.x = ease(this.mode === 'car' ? this.hood : 0) * 1.0;

    if (this.tween) {
      const t = this.tween; t.t += dt;
      const e = ease(t.t / t.dur);
      this.camera.position.lerpVectors(t.p0, t.p1, e); this.controls.target.lerpVectors(t.t0, t.t1, e); this._setFov(t.f0 + (t.f1 - t.f0) * e);
      if (t.t >= t.dur) this.tween = null;
    }
    if (this.tween) this.camera.lookAt(this.controls.target);   // 飞的路上不让 OrbitControls 按驾驶位的 1 cm 半径去夹
    else this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
