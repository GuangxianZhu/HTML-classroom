// three.js 舞台：加载 Blender 导出的整车模型；按轴角度转动齿轮、活塞，画能量流，切机位，车身半透明。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const MM = 0.001;
/** Blender 坐标（mm）→ three 坐标（m） */
export const B = (x, y, z) => new THREE.Vector3(x * MM, z * MM, -y * MM);
export const easeIO = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

export const FLOW_COL = { fuel: '#ff5a5a', exhaust: '#a7b0bb', mech: '#58e0a0', ac: '#c78bff', dc: '#ffb547' };
const FLOW_KIND = { fuel: 'fuel', exhaust: 'exhaust', eng_gen: 'mech', eng_wheel: 'mech', mot_wheel: 'mech', axle_L: 'mech', axle_R: 'mech', gen_pcu: 'ac', pcu_mot: 'ac', batt_pcu: 'dc' };

const BODY = ['Body_', 'Cabin_', 'Seats_', 'Dash'];
const ENG_COVER = ['Eng_block_f', 'Eng_head', 'Eng_camcover', 'Eng_intake', 'Eng_fuelrail', 'Eng_chain'];
const WHEEL_FL = ['Tyre_FL', 'Rim_FL', 'Disc_FL', 'Caliper_FL'];
const WHEEL_FR = ['Tyre_FR', 'Rim_FR', 'Disc_FR', 'Caliper_FR'];

export class Stage {
  constructor(canvas, spec) {
    this.canvas = canvas; this.spec = spec;
    this.nodes = new Map(); this.meshes = []; this.byGroup = new Map();
    this.explodeT = 0; this.roadOffset = 0; this.bodyMode = 'ghost';
    const t = spec.teeth;
    this.k = { C: -t.R / t.F, M: (t.R / t.F) * (t.CD / t.M), E: (t.R / t.F) * (t.CD / t.ED), G: -t.IG / t.GP };
    this.VIEWS = {
      home: { pos: B(-4300, 3400, 2200), tgt: B(0, -1150, 560), hide: [] },
      ptrain: { pos: B(-2300, 2350, 2050), tgt: B(-60, 20, 420), hide: ['Radiator', 'Batt12', 'Seats_', 'Dash', 'Cabin_'], flowK: .8 },
      ecvt: { pos: B(-980, 1180, 1080), tgt: B(-110, 140, 420), hide: ['Case_', 'PCU', 'HV_', 'Mot_stator_q', 'Gen_stator_q', ...BODY, 'Batt12', 'Radiator', ...ENG_COVER, ...WHEEL_FL, 'Exhaust', 'Fuel_line'], fov: 30, flowK: .42,
        xray: [['Edrive_gear', 'M_Cast_Alu', .16]] },
      engine: { pos: B(520, 1350, 980), tgt: B(220, 160, 560), hide: [...ENG_COVER, 'Radiator', ...BODY, 'Batt12', 'Case_', 'PCU', 'HV_', 'Fuel_line'], fov: 30, flowK: .5 },
      drive: { pos: B(-4400, 1300, 1500), tgt: B(0, -1250, 520), hide: [], road: true },
      under: { pos: B(-3300, 2600, 900), tgt: B(0, -1300, 250), hide: [...BODY], ghost: true },
    };
    this.view = null; this.hiddenExtra = [];
    this.th = { W: 0, I: 0 };
    this.clutch = 'open'; this.engOn = false; this.burnK = 1; this.flowK = 1; this._burnOK = false;
  }

  async init(glbBytes) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false;
    const scene = this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = .62;
    const cam = this.camera = new THREE.PerspectiveCamera(32, 1, .02, 80);
    cam.position.copy(this.VIEWS.home.pos);
    const ctl = this.controls = new OrbitControls(cam, this.canvas);
    ctl.enableDamping = true; ctl.dampingFactor = .09; ctl.minDistance = .25; ctl.maxDistance = 14;
    ctl.target.copy(this.VIEWS.home.tgt);
    const key = new THREE.DirectionalLight(0xfff2df, 1.9);
    key.position.set(-2.6, 4.6, 1.2); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: .5, far: 12 });
    key.shadow.bias = -.0006; key.shadow.normalBias = .004;
    key.target.position.set(0, 0, 1.2); scene.add(key.target);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, .7); rim.position.set(3, 1.6, 4); scene.add(rim);

    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength), '', res, rej));
    const root = this.root = gltf.scene; scene.add(root);
    const groups = this.spec.objects;
    root.children.forEach((n) => {
      const name = n.name;
      const g = n.userData.group || groups[name] || '';
      n.userData.base = n.position.clone();
      n.userData.g = g;
      this.nodes.set(name, n);
      if (!this.byGroup.has(g)) this.byGroup.set(g, []);
      this.byGroup.get(g).push(n);
      const isBody = BODY.some((p) => name.startsWith(p));
      n.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = !isBody; o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const cl = mats.map((m) => { const c = m.clone(); c.userData.baseEm = c.emissive.clone(); c.userData.baseEI = c.emissiveIntensity; c.userData.op = c.opacity; c.userData.tr = c.transparent; return c; });
        o.material = Array.isArray(o.material) ? cl : cl[0];
        o.userData.node = n; o.userData.body = isBody;
        this.meshes.push(o);
      });
    });
    this.spins = [];
    root.children.forEach((n) => { const s = n.userData.spin; if (s) this.spins.push([n, s]); });
    const E = this.spec.engine;
    this.pistons = []; this.rods = []; this.burns = [];
    for (let i = 1; i <= 4; i++) {
      this.pistons.push(this.nodes.get(`Piston_${i}`)); this.rods.push(this.nodes.get(`Rod_${i}`)); this.burns.push(this.nodes.get(`Burn_${i}`));
    }
    this.E = E;
    for (const b of this.burns) b && b.traverse((o) => { if (o.isMesh) { o.material.emissive.set('#ff7a1a'); o.material.color.set('#ffb05a'); o.material.transparent = true; o.material.opacity = .85; o.material.depthWrite = false; o.material.userData.tr = true; o.material.userData.op = .85; } });
    this.clutchNodes = ['Clutch_inner', 'Clutch_outer', 'Clutch_piston'].map((k) => this.nodes.get(k));
    this._buildRoad();
    this._buildFlow();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
    this.applyView('home', true);
    this.setBody('ghost');
    this.setAngles(0, 0);
    this.refreshShadow();
  }

  refreshShadow() { this.renderer.shadowMap.needsUpdate = true; }

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
    const X = (m) => (m + 2.4) / 4.8 * 512;
    g.fillRect(X(1.65), 0, 10, 1024);
    for (const y of [40, 540]) g.fillRect(X(-1.75), y, 10, 260);
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let y = 0; y < 1024; y += 170) g.fillRect(0, y, 512, 3);
    const tex = this.roadTex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 2);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const a = document.createElement('canvas'); a.width = 16; a.height = 256;
    const ga = a.getContext('2d'), gr = ga.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#000'); gr.addColorStop(.2, '#fff'); gr.addColorStop(.8, '#fff'); gr.addColorStop(1, '#000');
    ga.fillStyle = gr; ga.fillRect(0, 0, 16, 256);
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: .92, metalness: 0, alphaMap: new THREE.CanvasTexture(a), transparent: true });
    const road = this.road = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 13), m);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, -.001, 1.25);
    road.receiveShadow = true;
    this.scene.add(road);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 6.2), new THREE.ShadowMaterial({ opacity: .32 }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0, 1.25); sh.receiveShadow = true;
    this.floor = sh; this.scene.add(sh);
  }

  _buildFlow() {
    this.flows = {};
    this._m4 = new THREE.Matrix4();
    for (const [k, pts] of Object.entries(this.spec.flows)) {
      const kind = FLOW_KIND[k] || 'mech';
      const P = pts.map((p) => B(p[0], p[1], p[2]));
      const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal', .1);
      const len = curve.getLength();
      const n = Math.max(6, Math.min(70, Math.round(len / .045)));
      const size = kind === 'fuel' || kind === 'exhaust' ? .0085 : .0105;
      const geo = new THREE.SphereGeometry(size, 10, 8);
      const mat = new THREE.MeshBasicMaterial({ color: FLOW_COL[kind], transparent: true, opacity: .95, depthTest: false });
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.renderOrder = 8; im.frustumCulled = false; im.visible = false;
      this.scene.add(im);
      this.flows[k] = { curve, im, n, s: 0, rate: 0, len, scale: 1 };
    }
  }

  /** 能量流。val 单位 kW，正 = 沿路径正方向（从源头到车轮），负 = 反方向；0 = 不显示 */
  setFlows(o) {
    for (const [k, f] of Object.entries(this.flows)) {
      const kw = o[k] || 0;
      const mag = Math.min(1, Math.abs(kw) / 40);
      f.im.visible = Math.abs(kw) > .05;
      f.rate = Math.sign(kw) * (.25 + .9 * Math.sqrt(mag));
      f.scale = .55 + .85 * Math.sqrt(mag);
    }
  }

  _tickFlow(dt) {
    const v = new THREE.Vector3(), m = this._m4;
    for (const f of Object.values(this.flows)) {
      if (!f.im.visible) continue;
      f.s = (f.s + dt * f.rate * .9 / Math.max(f.len, .4) + 10) % 1;
      for (let i = 0; i < f.n; i++) {
        const u = (f.s + i / f.n) % 1;
        f.curve.getPointAt(u, v);
        const fade = Math.min(u * 12, (1 - u) * 12, 1) * f.scale * this.flowK;
        m.makeScale(fade, fade, fade); m.setPosition(v);
        f.im.setMatrixAt(i, m);
      }
      f.im.instanceMatrix.needsUpdate = true;
    }
  }

  isHidden(name) {
    const v = this.VIEWS[this.view] || { hide: [] };
    if (this.bodyMode === 'hidden' && BODY.some((p) => name.startsWith(p))) return true;
    return [...v.hide, ...this.hiddenExtra].some((h) => name.startsWith(h));
  }

  refreshVisibility() {
    for (const [name, n] of this.nodes) {
      let hid = this.isHidden(name);
      if (this.explodeT > .015 && name.startsWith('HV_')) hid = true;
      if (name.startsWith('Burn_')) { this._burnOK = !hid && this.engOn; hid = true; }
      n.visible = !hid;
    }
    this.refreshShadow();
  }

  /** 车身：solid 实体 / ghost 半透明 / hidden 隐藏 */
  setBody(mode) {
    this.bodyMode = mode;
    for (const o of this.meshes) {
      if (!o.userData.body) continue;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const shell = o.userData.node.name.startsWith('Body_');
      for (const m of mats) {
        if (mode === 'ghost') {
          m.transparent = true; m.opacity = shell ? .1 : .32; m.depthWrite = false;
        } else {
          m.transparent = m.userData.tr; m.opacity = m.userData.op; m.depthWrite = true;
        }
        m.needsUpdate = true;
      }
      o.castShadow = mode === 'solid' && shell;
    }
    this.refreshVisibility();
  }

  applyView(name, instant = false, dur = 1.1) {
    const v = this.VIEWS[name];
    this.view = name;
    this.flowK = v.flowK || 1;
    this.refreshVisibility();
    this._xray(v.xray || []);
    this.road.visible = !!v.road;
    this.floor.visible = !v.road;
    const fov = v.fov || 32;
    const from = { pos: this.camera.position.clone(), tgt: this.controls.target.clone(), fov: this.camera.fov };
    const fit = this._fitPos(v);
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera.position.copy(fit); this.controls.target.copy(v.tgt); this.camera.fov = fov; this.camera.updateProjectionMatrix();
      this.fly = null; return;
    }
    this.fly = { from, to: { pos: fit, tgt: v.tgt.clone(), fov }, t: 0, dur };
  }

  /** 某些零件的某种材质在这个机位下变透明（比如离合器外鼓，好看见里面的摩擦片） */
  _xray(list) {
    for (const o of this.meshes) {
      if (o.userData.body) continue;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const hit = list.find(([n, mn]) => o.userData.node.name === n && m.name === mn);
        if (hit) { m.transparent = true; m.opacity = hit[2]; m.depthWrite = false; m.needsUpdate = true; m.userData.xr = true; }
        else if (m.userData.xr) { m.transparent = m.userData.tr; m.opacity = m.userData.op; m.depthWrite = true; m.needsUpdate = true; m.userData.xr = false; }
      }
    }
  }

  _fitPos(v) {
    const asp = (this.w || 1) / (this.h || 1);
    const k = asp < 1.25 ? 1.25 / Math.max(asp, .55) : 1;
    return v.tgt.clone().add(v.pos.clone().sub(v.tgt).multiplyScalar(k));
  }

  setExplode(t) {
    this.explodeT = t;
    const ex = this.spec.explode;
    for (const n of this.root.children) {
      const e = ex[n.userData.g];
      if (!e) continue;
      const s = easeIO((t - e[3]) / Math.max(1 - e[3], .01));
      n.userData.exOff = B(e[0], e[1], e[2]).multiplyScalar(s);
      n.position.copy(n.userData.base).add(n.userData.exOff);
    }
    this.setAngles(this.th.W, this.th.I);
    this.setClutch(this.clutch);
    this.refreshVisibility();
  }

  /** 车轮转角 thW、曲轴转角 thI（弧度，增大 = 向前）。其余轴按齿数算出来 */
  setAngles(thW, thI) {
    this.th.W = thW; this.th.I = thI;
    const k = this.k;
    const thC = k.C * thW, ang = { D: thW, C: thC, M: thW * k.M, E: thW * k.E, I: thI, G: thI * k.G };
    for (const [n, s] of this.spins) n.rotation.x = -(ang[s] || 0);
    // 活塞、连杆
    const E = this.E, r = E.cr, L = E.rod;
    for (let i = 0; i < 4; i++) {
      const p = this.pistons[i], rod = this.rods[i];
      if (!p) continue;
      const ph = thI + E.cyl_ph[i];
      const z = E.cz + r * Math.cos(ph) + Math.sqrt(L * L - (r * Math.sin(ph)) ** 2);
      const z0 = E.cz + r * Math.cos(E.cyl_ph[i]) + Math.sqrt(L * L - (r * Math.sin(E.cyl_ph[i])) ** 2);
      const dz = (z - z0) * MM;
      for (const n of [p, rod]) {
        n.position.copy(n.userData.base);
        if (n.userData.exOff) n.position.add(n.userData.exOff);
        n.position.y += dz;
      }
      rod.rotation.x = Math.asin(r * Math.sin(ph) / L);
    }
    // 点火：1-3-4-2，做功行程里燃烧室发光
    const psi = ((thI % (4 * Math.PI)) + 4 * Math.PI) % (4 * Math.PI);
    const fire = [0, 3 * Math.PI, Math.PI, 2 * Math.PI];    // 1、2、3、4 缸的点火时刻
    for (let i = 0; i < 4; i++) {
      const b = this.burns[i];
      if (!b) continue;
      const d = ((psi - fire[i]) % (4 * Math.PI) + 4 * Math.PI) % (4 * Math.PI);
      const x = this.engOn && d < Math.PI ? Math.pow(1 - d / Math.PI, 1.4) * this.burnK : 0;
      b.visible = this._burnOK && x > .03;
      b.traverse((o) => { if (o.isMesh) { o.material.emissiveIntensity = x * 6; } });
    }
  }

  setEngine(on) {
    if (this.engOn === on) return;
    this.engOn = on; this.refreshVisibility();
  }

  /** 离合器：open 分开 / sync 同步中 / locked 接合 */
  setClutch(state) {
    this.clutch = state;
    const [inner, outer, piston] = this.clutchNodes;
    const shift = state === 'locked' ? -.004 : 0;
    for (const [n, k] of [[piston, 1], [outer, .5]]) {
      if (!n) continue;
      n.position.copy(n.userData.base);
      if (n.userData.exOff) n.position.add(n.userData.exOff);
      n.position.x += shift * k;
    }
    const col = new THREE.Color(state === 'locked' ? '#4fd18b' : state === 'sync' ? '#ffb547' : '#000000');
    for (const n of [inner, outer]) n && n.traverse((o) => {
      if (!o.isMesh) return;
      o.material.emissive.copy(col); o.material.emissiveIntensity = state === 'open' ? 0 : .55;
    });
  }

  scrollRoad(dist) {
    this.roadOffset = (this.roadOffset + dist / (13 / 2)) % 1;
    this.roadTex.offset.y = this.roadOffset;
  }

  project(v3) {
    const p = v3.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * this.w, y: (1 - p.y) / 2 * this.h, behind: p.z > 1 || p.z < -1 };
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.camera);
    const vis = this.meshes.filter((m) => m.userData.node.visible && !(this.bodyMode === 'ghost' && m.userData.body));
    const hits = rc.intersectObjects(vis, false);
    return hits.length ? hits[0].object.userData.node.userData.g : null;
  }

  highlight(g) {
    for (const m of this.meshes) {
      const nm = m.userData.node.name;
      if (nm.startsWith('Burn_') || nm.startsWith('Clutch_')) continue;
      const on = g && m.userData.node.userData.g === g;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mt of mats) {
        mt.emissive.copy(on ? new THREE.Color('#ffb547') : mt.userData.baseEm);
        mt.emissiveIntensity = on ? .34 : mt.userData.baseEI;
      }
    }
    this._hl = g;
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
    this._tickFlow(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
