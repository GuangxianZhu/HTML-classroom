// three.js 舞台：加载 Blender 导出的模型，提供转动、线圈发光、磁场环、能量流、机位切换。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const MM = 0.001;
/** Blender 坐标（mm）→ three 坐标（m） */
export const B = (x, y, z) => new THREE.Vector3(x * MM, z * MM, -y * MM);

const COL = {
  out: new THREE.Color('#ff9f43'), in: new THREE.Color('#3fc5ff'),
  U: new THREE.Color('#f2c230'), V: new THREE.Color('#48d6b0'), W: new THREE.Color('#e5484d'),
  on: new THREE.Color('#ffd166'), hl: new THREE.Color('#ffb547'), hot: new THREE.Color('#ff5a1f'),
};

const QUARTER = ['Stator_q', 'Case_q', 'Water_q', 'Bar_U_p_q', 'Bar_U_n_q', 'Bar_V_p_q', 'Bar_V_n_q', 'Bar_W_p_q', 'Bar_W_n_q', 'End_U_q', 'End_V_q', 'End_W_q'];
const LEFT_W = ['Tyre_L', 'Rim_L', 'Disc_L', 'Caliper_L', 'HS_L'];
const RIGHT_W = ['Tyre_R', 'Rim_R', 'Disc_R', 'Caliper_R', 'HS_R'];
const BATT = ['Batt_', 'HV_'];
const INV_ALL = ['Inv_'];
const REDUCER = ['Reducer', 'Gear_', 'IShaft', 'Diff'];

export const easeIO = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

export class Stage {
  constructor(canvas, spec) {
    this.canvas = canvas; this.spec = spec;
    this.nodes = new Map(); this.meshes = []; this.byGroup = new Map();
    this.explodeT = 0; this.roadOffset = 0;
    const [MY, MZ] = spec.motor_axis; this.MY = MY; this.MZ = MZ;
    this.VIEWS = {
      home: { pos: B(-1500, -2150, 1320), tgt: B(0, 330, -40), hide: [], road: true },
      exploded: { pos: B(-2450, -3500, 2050), tgt: B(-60, 330, 230), hide: [], road: false },
      cut: { pos: B(-1010, MY - 880, MZ + 640), tgt: B(-110, MY, MZ - 6), hide: [...QUARTER, ...INV_ALL, ...BATT, 'Cap_rear', ...LEFT_W, ...RIGHT_W, 'Lead_', 'Terminal'], road: false },
      axial: { pos: B(-1120, MY, MZ), tgt: B(-200, MY, MZ), hide: [...INV_ALL, ...BATT, ...LEFT_W, ...RIGHT_W, ...REDUCER, 'End_', 'Cap_rear', 'Rotor_plate', 'Resolver', 'Bearing_R', 'Lead_', 'Terminal'], road: false, ring: true, fov: 26 },
      gear: { pos: B(1120, MY * .42 - 260, 560), tgt: B(40, MY * .55, 60), hide: ['Reducer_cover', ...RIGHT_W, ...BATT], road: false },
      inverter: { pos: B(-470, MY - 420, MZ + 760), tgt: B(-150, MY, MZ + 170), hide: ['Inv_lid', 'Inv_pcb', ...BATT, ...LEFT_W, ...RIGHT_W], road: false },
      road: { pos: B(-1900, -1500, 620), tgt: B(0, 240, -60), hide: [], road: true },
    };
    this.view = null;
    this.hiddenExtra = [];
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
    const cam = this.camera = new THREE.PerspectiveCamera(32, 1, .02, 60);
    cam.position.copy(this.VIEWS.home.pos);
    const ctl = this.controls = new OrbitControls(cam, this.canvas);
    ctl.enableDamping = true; ctl.dampingFactor = .09; ctl.minDistance = .25; ctl.maxDistance = 9;
    ctl.target.copy(this.VIEWS.home.tgt);
    const key = new THREE.DirectionalLight(0xfff2df, 1.9);
    key.position.set(-1.8, 3.4, 2.4); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: .5, far: 9 });
    key.shadow.bias = -.0006; key.shadow.normalBias = .004;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, .7); rim.position.set(2.5, 1.2, -2.5); scene.add(rim);

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
      n.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        o.material = o.material.clone();
        o.userData.node = n;
        o.material.userData.baseEm = o.material.emissive.clone();
        o.material.userData.baseEI = o.material.emissiveIntensity;
        this.meshes.push(o);
      });
    });
    this.spinM = []; this.spinI = []; this.spinW = [];
    root.children.forEach((n) => {
      const s = n.userData.spin;
      if (s === 'm') this.spinM.push(n); else if (s === 'i') this.spinI.push(n); else if (s === 'w') this.spinW.push(n);
    });
    const t = this.spec.teeth;
    this.kI = t[0] / t[1];
    this.G = this.spec.ratio;
    this.coils = [];
    for (const ph of 'UVW') {
      for (const sg of ['p', 'n']) for (const q of ['', '_q']) {
        const n = this.nodes.get(`Bar_${ph}_${sg}${q}`);
        if (n) this.coils.push({ n, ph, s: sg === 'p' ? 1 : -1, kind: 'bar' });
      }
      for (const q of ['', '_q']) {
        const n = this.nodes.get(`End_${ph}${q}`);
        if (n) this.coils.push({ n, ph, s: 1, kind: 'end' });
      }
    }
    this.switches = {};
    for (const ph of 'UVW') for (const hl of 'HL') {
      const n = this.nodes.get(`Inv_sw_${ph}${hl}`);
      if (n) this.switches[ph + hl] = n;
    }
    this.discs = ['Disc_L', 'Disc_R'].map((k) => this.nodes.get(k)).filter(Boolean);
    this._buildRoad();
    this._buildRing();
    this._buildFlow();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
    this.applyView('home', true);
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
    this._roadCtx = g;
    g.fillStyle = '#1b2433'; g.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < 2600; i++) {
      const v = 30 + Math.random() * 36;
      g.fillStyle = `rgba(${v},${v + 6},${v + 16},.5)`;
      g.fillRect(Math.random() * 512, Math.random() * 1024, 2, 2);
    }
    // 车道宽约 3.3 m：左边虚线、右边实线，车在两线中间
    g.fillStyle = '#dfe6ef';
    const X = (m) => (m + 2.1) / 4.2 * 512;
    g.fillRect(X(1.62), 0, 11, 1024);
    for (const y of [40, 540]) g.fillRect(X(-1.72), y, 11, 240);
    g.fillStyle = 'rgba(255,255,255,.06)';
    for (let y = 0; y < 1024; y += 170) g.fillRect(0, y, 512, 3);
    const tex = this.roadTex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 1.6);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const a = document.createElement('canvas'); a.width = 16; a.height = 256;
    const ga = a.getContext('2d'), gr = ga.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#000'); gr.addColorStop(.22, '#fff'); gr.addColorStop(.78, '#fff'); gr.addColorStop(1, '#000');
    ga.fillStyle = gr; ga.fillRect(0, 0, 16, 256);
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: .92, metalness: 0, alphaMap: new THREE.CanvasTexture(a), transparent: true });
    const road = this.road = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 9), m);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, -.3352, .1);
    road.receiveShadow = true;
    this.scene.add(road);
  }

  _buildRing() {
    // 定子磁场环：贴在定子端面的半透明环，蓝 = 定子 S（吸引转子 N），红 = 定子 N
    const [MY, MZ] = this.spec.motor_axis;
    const N = 240, r0 = 99.5, r1 = 109, x = this.spec.x_stack[0] - 1.2;
    const pos = [], th = [], rad = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = 2 * Math.PI * i / N;
      for (const r of [r0, r1]) {
        const v = B(x, MY - r * Math.cos(a), MZ + r * Math.sin(a));
        pos.push(v.x, v.y, v.z); th.push(a); rad.push(r === r0 ? 0 : 1);
      }
      if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aTh', new THREE.Float32BufferAttribute(th, 1));
    g.setIndex(idx);
    const m = this.ringMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTh: { value: 0 }, uAmp: { value: 1 }, uP: { value: this.spec.pole_pairs } },
      vertexShader: 'attribute float aTh; varying float vTh; void main(){ vTh=aTh; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying float vTh; uniform float uTh,uAmp,uP;
        void main(){ float c=cos(uP*vTh-uTh)*uAmp;
          vec3 s=vec3(.25,.55,1.0), n=vec3(1.0,.26,.3);
          vec3 col=c>0.0?s:n; float a=smoothstep(.04,.75,abs(c))*.86;
          gl_FragColor=vec4(col,a); }`,
    });
    const ring = this.ring = new THREE.Mesh(g, m);
    ring.visible = false; ring.renderOrder = 5;
    this.scene.add(ring);
  }

  _buildFlow() {
    const [MY, MZ] = this.spec.motor_axis, [Iy, Iz] = this.spec.int_axis;
    const I = this.spec.inverter;
    const dc = this.spec.cable.map((p) => B(p[0], p[1], p[2]));
    dc.push(B(-150, I.y1 - 40, I.z0 + 44), B(-160, this.MY, I.z0 + 40));
    const ac = [B(-160, this.MY, I.z0 + 40), B(-50, this.MY, I.z0 + 20), B(-50, this.MY, MZ + 120), B(-150, this.MY, MZ + 88), B(-150, this.MY, MZ)];
    const mechL = [B(-150, MY, MZ), B(32, MY, MZ), B(32, Iy, Iz), B(74, Iy, Iz), B(74, 0, 0), B(-780, 0, 0)];
    const mechR = [B(74, 0, 0), B(780, 0, 0)];
    const mk = (pts, color, n, size) => {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', .1);
      const geo = new THREE.SphereGeometry(size, 10, 8);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .95, depthTest: false });
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.renderOrder = 8; im.frustumCulled = false; im.visible = false;
      this.scene.add(im);
      return { curve, im, n, s: 0, rate: 0, len: curve.getLength() };
    };
    this.flows = { dc: mk(dc, '#ffb547', 24, .0095), ac: mk(ac, '#c78bff', 12, .0085), mechL: mk(mechL, '#58e0a0', 30, .009), mechR: mk(mechR, '#58e0a0', 12, .009) };
    this._m4 = new THREE.Matrix4();
  }

  /** 能量流。power 单位 kW，正 = 电池到车轮，负 = 回收 */
  setFlow(kw, on = true) {
    const mag = Math.min(1, Math.abs(kw) / 170);
    for (const f of Object.values(this.flows)) {
      f.im.visible = on && Math.abs(kw) > .15;
      f.rate = Math.sign(kw) * (.18 + .9 * Math.sqrt(mag));
      f.scale = .6 + .9 * Math.sqrt(mag);
    }
  }

  _tickFlow(dt) {
    const v = new THREE.Vector3(), m = this._m4;
    for (const f of Object.values(this.flows)) {
      if (!f.im.visible) continue;
      f.s = (f.s + dt * f.rate / Math.max(f.len, .5) * 1.1 + 10) % 1;
      for (let i = 0; i < f.n; i++) {
        const u = (f.s + i / f.n) % 1;
        f.curve.getPointAt(u, v);
        const fade = Math.min(u * 10, (1 - u) * 10, 1) * f.scale;
        m.makeScale(fade, fade, fade); m.setPosition(v);
        f.im.setMatrixAt(i, m);
      }
      f.im.instanceMatrix.needsUpdate = true;
    }
  }

  isHidden(name) {
    const v = this.VIEWS[this.view] || { hide: [] };
    return [...v.hide, ...this.hiddenExtra].some((h) => name.startsWith(h));
  }

  refreshVisibility() {
    const explodedOn = this.explodeT > .015;
    for (const [name, n] of this.nodes) {
      let hid = this.isHidden(name);
      if (explodedOn && name.startsWith('HV_')) hid = true;
      n.visible = !hid;
    }
    this.refreshShadow();
  }

  applyView(name, instant = false, dur = 1.1) {
    const v = this.VIEWS[name];
    this.view = name;
    this.refreshVisibility();
    this.road.visible = !!v.road;
    this.ring.visible = false;
    const fov = v.fov || 32;
    const from = { pos: this.camera.position.clone(), tgt: this.controls.target.clone(), fov: this.camera.fov };
    const fit = this._fitPos(v);
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera.position.copy(fit); this.controls.target.copy(v.tgt); this.camera.fov = fov; this.camera.updateProjectionMatrix();
      this.fly = null; return;
    }
    this.fly = { from, to: { pos: fit, tgt: v.tgt.clone(), fov }, t: 0, dur };
  }

  /** 窄屏时把相机往后拉，保证主体不被裁掉 */
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
      n.position.copy(n.userData.base).add(B(e[0], e[1], e[2]).multiplyScalar(s));
    }
    this.refreshVisibility();
  }

  setAngles(thM) {
    for (const n of this.spinM) n.rotation.x = -thM;
    for (const n of this.spinI) n.rotation.x = thM * this.kI;
    for (const n of this.spinW) n.rotation.x = -thM / this.G;
  }

  /** 三相电流 → 槽内导体和端部发光。mode: 'dir' 按电流方向上色；'phase' 按相色 */
  setCoils(iu, iv, iw, Imax = 520, mode = 'dir') {
    const I = { U: iu, V: iv, W: iw };
    for (const c of this.coils) {
      const x = I[c.ph] / Imax * c.s;
      const a = Math.abs(x);
      c.n.traverse((o) => {
        if (!o.isMesh) return;
        const em = o.material.emissive;
        if (c.kind === 'end' || mode === 'phase') { em.copy(COL[c.ph]); o.material.emissiveIntensity = a * (c.kind === 'end' ? .55 : 1.2); } else { em.copy(x >= 0 ? COL.out : COL.in); o.material.emissiveIntensity = Math.pow(a, .8) * 2.4; }
      });
    }
  }

  clearCoils() {
    for (const c of this.coils) c.n.traverse((o) => { if (o.isMesh) o.material.emissiveIntensity = 0; });
  }

  setSwitches(state) {
    for (const k in this.switches) {
      const on = state ? state[k] : 0;
      this.switches[k].traverse((o) => { if (o.isMesh) { o.material.emissive.copy(COL.on); o.material.emissiveIntensity = on ? 1.8 : 0; } });
    }
  }

  setBrakeGlow(x) {
    for (const d of this.discs) d.traverse((o) => { if (o.isMesh) { o.material.emissive.copy(COL.hot); o.material.emissiveIntensity = x * 1.5; } });
  }

  setField(thE, amp = 1, on = true) {
    this.ring.visible = on;
    this.ringMat.uniforms.uTh.value = thE;
    this.ringMat.uniforms.uAmp.value = amp;
  }

  scrollRoad(dist) {
    this.roadOffset = (this.roadOffset + dist / (9 / 1.6)) % 1;   // 一张贴图铺 5.625 m
    this.roadTex.offset.y = this.roadOffset;
  }

  /** 把 Blender 坐标投到屏幕（CSS 像素）。behind=true 表示在相机背后 */
  project(v3) {
    const p = v3.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * this.w, y: (1 - p.y) / 2 * this.h, behind: p.z > 1 };
  }

  /** 定子截面上机械角 ϑ、半径 r 处的屏幕坐标 */
  projectAxial(th, r) {
    const x = this.spec.x_stack[0];
    return this.project(B(x, this.MY - r * Math.cos(th), this.MZ + r * Math.sin(th)));
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.camera);
    const hits = rc.intersectObjects(this.meshes.filter((m) => m.userData.node.visible), false);
    return hits.length ? hits[0].object.userData.node.userData.g : null;
  }

  highlight(g) {
    for (const m of this.meshes) {
      const on = g && m.userData.node.userData.g === g;
      if (m.userData.node.name.startsWith('Inv_sw') || m.userData.node.name.startsWith('Bar_') || m.userData.node.name.startsWith('End_') || m.userData.node.name.startsWith('Disc')) {
        if (on) { m.material.emissive.copy(COL.hl); m.material.emissiveIntensity = .5; } else if (this._hl === m.userData.node.userData.g) m.material.emissiveIntensity = 0;
        continue;
      }
      m.material.emissive.copy(on ? COL.hl : m.material.userData.baseEm);
      m.material.emissiveIntensity = on ? .34 : m.material.userData.baseEI;
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
      if (f.t >= 1) { this.fly = null; }
    }
    this.controls.update();
    this._tickFlow(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
