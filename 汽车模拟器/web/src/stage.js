// three.js 舞台：把 Blender 导出的车摆出来，按仿真给的转速让零件动。
// 坐标：Blender 里 x 向右、y 向车头、z 向上（毫米）；three 里 y 向上（米）。绕 x 轴的转角两边是同一个数。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { beltPath, pistonHeight, rodAngle, valveLift } from './core.js';

const MM = 0.001, TAU = Math.PI * 2;
export const B = (x, y, z) => new THREE.Vector3(x * MM, z * MM, -y * MM);
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
export const MODES = ['car', 'xray', 'pt', 'inside'];

export class Stage {
  /** car = core.makeCar(params)，spec = blender/out/spec.json */
  constructor(canvas, car, spec) {
    this.canvas = canvas; this.car = car; this.spec = spec; this.D = spec.powertrain.derived;
    this.mode = 'xray'; this.hood = 0; this.hoodTarget = 0;
    this.ang = { crank: 0, turbine: 0, pri: 0, sec: 0, inter: 0, wheel: 0, belt: 0, road: 0 };
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
    this.tween = null;
  }

  async init(glbBytes) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    const scene = this.scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = .8;
    const cam = this.camera = new THREE.PerspectiveCamera(32, 1, .05, 200);
    const ctl = this.controls = new OrbitControls(cam, this.canvas);
    ctl.enableDamping = true; ctl.dampingFactor = .09; ctl.minDistance = .35; ctl.maxDistance = 30; ctl.maxPolarAngle = Math.PI * .497;
    ctl.addEventListener('start', () => { this.tween = null; });
    const key = new THREE.DirectionalLight(0xfff2df, 1.6); key.position.set(-3, 5, -4); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, .9); rim.position.set(4, 2.2, 4); scene.add(rim);

    const buf = glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength);
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
    const root = this.root = gltf.scene; scene.add(root); root.updateMatrixWorld(true);
    const gm = Object.fromEntries(Object.entries(GHOSTS).map(([k, v]) => [k, ghostMat(...v)]));
    for (const n of [...root.children]) {
      const ex = n.userData || {}, group = this.spec.objects[n.name] || ex.group || '';
      const housing = group === 'powertrain' && (ex.kind === 'housing' || ex.shell === 1 || n.name === 'PT_Mounts');
      const it = { node: n, name: n.name, group, ex, housing, meshes: [], ghost: housing ? gm.housing : gm[group] || gm.other, state: 'solid' };
      n.traverse((o) => {
        if (!o.isMesh) return;
        const glass = /^Glass/.test(o.material.name);
        if (glass) { o.material.transparent = true; o.material.depthWrite = false; }
        o.userData.solid = o.material; o.userData.ro = glass ? 2 : 0; o.userData.item = it;
        it.meshes.push(o);
      });
      this.items.push(it); this.byName.set(n.name, it);
    }
    this._rig();
    this._buildBelt();
    this._buildGround();
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
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.002; floor.renderOrder = -2; this.scene.add(floor);
    const s = document.createElement('canvas'); s.width = 128; s.height = 256;
    const y = s.getContext('2d'); y.filter = 'blur(14px)'; y.fillStyle = 'rgba(0,0,0,.75)'; y.fillRect(26, 30, 76, 196);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 6.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(s), transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(0, -.001, .03); sh.renderOrder = -1; this.scene.add(sh);
    // 路面虚线：车不挪地方，线往后走
    const n = 16, dash = this.dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(.1, 1.4), new THREE.MeshBasicMaterial({ color: '#c9d2da', transparent: true, opacity: .3, depthWrite: false }), n * 2);
    dash.rotation.x = -Math.PI / 2; dash.position.y = 0; dash.renderOrder = -1; dash.frustumCulled = false; this.scene.add(dash);
    this.nDash = n;
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
    this.mode = mode;
    for (const it of this.items) {
      if (it.dead) continue;
      const g = it.group;
      let st;
      if (mode === 'car') st = 'solid';
      else if (mode === 'xray') st = BODY.has(g) ? 'ghost' : 'solid';
      else if (mode === 'pt') st = g === 'powertrain' || g === 'under' || g === 'wheels' ? 'solid' : g === 'chassis' ? 'ghost' : 'hide';
      else st = g === 'powertrain' ? (it.housing ? 'ghost' : 'solid') : g === 'wheels' ? 'ghost' : 'hide';   // 内部：壳体和车轮都变透明，只留会动的件
      it.state = st; it.node.visible = st !== 'hide';
      for (const o of it.meshes) { o.material = st === 'ghost' ? it.ghost : o.userData.solid; o.renderOrder = st === 'ghost' ? 3 : o.userData.ro; }
    }
    if (fly) this._goto(this.VIEWS[mode === 'car' && this.hoodTarget ? 'hood' : mode]);
  }
  setHood(open) { this.hoodTarget = open ? 1 : 0; if (this.mode === 'car') this._goto(this.VIEWS[open ? 'hood' : 'car']); }
  lookAt(key) { this._goto(this.VIEWS[key]); }

  _goto(view, dur = .8) {
    const k = this.aspect < 1.25 ? Math.pow(1.25 / this.aspect, .85) : 1;       // 竖屏：退远一点，别把车切掉
    const pos = view.tgt.clone().add(view.pos.clone().sub(view.tgt).multiplyScalar(k));
    if (!dur) { this.camera.position.copy(pos); this.controls.target.copy(view.tgt); this.controls.update(); return; }
    this.tween = { t: 0, dur, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: view.tgt.clone() };
  }

  resize() {
    const w = this.canvas.clientWidth || 2, h = this.canvas.clientHeight || 2;
    this.aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.aspect; this.camera.updateProjectionMatrix();
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
  /** o = core 的 step 输出；slow = 零件动作放慢多少倍；dt = 这一帧过了多少秒 */
  update(dt, o, slow) {
    const a = this.ang, k = dt / slow, car = this.car, m = this.m;
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
    this._placeRoad();
    this.belt.visible = this.mode !== 'car' || this.hood > .02;

    this.hood += Math.max(-dt / .7, Math.min(dt / .7, this.hoodTarget - this.hood));
    this.hoodPivot.rotation.x = ease(this.mode === 'car' ? this.hood : 0) * 1.0;

    if (this.tween) {
      const t = this.tween; t.t += dt;
      const e = ease(t.t / t.dur);
      this.camera.position.lerpVectors(t.p0, t.p1, e); this.controls.target.lerpVectors(t.t0, t.t1, e);
      if (t.t >= t.dur) this.tween = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
