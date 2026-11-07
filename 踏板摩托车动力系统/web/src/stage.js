// three.js 舞台：四个模型、剖切（切面上色）、透视外壳、拆开、气流小点、皮带实时生成、
// 以及每个零件怎么动（曲柄连杆、配气、CVT 两个皮带轮、离合块、齿轮、车轮、整个总成上下摆）。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as S from './sim.js';

const MM = 0.001;
/** Blender 坐标（mm）→ three 坐标（m） */
export const B = (x, y, z) => new THREE.Vector3(x * MM, z * MM, -y * MM);
const Bv = (a) => B(a[0], a[1], a[2]);
const Bdir = (a) => new THREE.Vector3(a[0], a[2], -a[1]).normalize();
export const easeIO = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const approach = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
// 所有转动都绕 Blender 的 Y 轴 = three 的 −Z 轴
const AX = new THREE.Vector3(0, 0, -1);
const qY = (a, out = new THREE.Quaternion()) => out.setFromAxisAngle(AX, a);
/** Blender 坐标里：绕 +Y 转 a 时，点 r（相对转轴）的速度方向 = Y × r = (z, 0, −x) */
const yCross = (r) => [r[2], 0, -r[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// 气体颜色
export const GAS = {
  fresh: new THREE.Color('#4cc9f0'), comp: new THREE.Color('#5b7cfa'), burn: new THREE.Color('#ffb547'),
  hot: new THREE.Color('#ff6a3c'), exh: new THREE.Color('#8a7f78'),
};

const GHOST_V = `varying vec3 vN; varying vec3 vV;
#include <clipping_planes_pars_vertex>
void main(){ vec4 mvPosition = modelViewMatrix * vec4(position, 1.); vN = normalMatrix * normal; vV = -mvPosition.xyz; gl_Position = projectionMatrix * mvPosition;
#include <clipping_planes_vertex>
}`;
const GHOST_F = `uniform vec3 uC; uniform float uA; varying vec3 vN; varying vec3 vV;
#include <clipping_planes_pars_fragment>
void main(){
#include <clipping_planes_fragment>
 float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 2.); gl_FragColor = vec4(uC, uA * (.06 + .94 * f)); }`;

const DOT_V = `attribute vec3 aCol; attribute float aA; uniform float uSize; uniform float uPx; varying vec3 vC; varying float vA;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vC = aCol; vA = aA; gl_PointSize = max(2., uSize * uPx / -mv.z); gl_Position = projectionMatrix * mv; }`;
const DOT_F = `uniform float uOp; varying vec3 vC; varying float vA;
void main(){ vec2 d = gl_PointCoord - .5; float r = length(d); if (r > .5) discard;
 float a = smoothstep(.5, .18, r); gl_FragColor = vec4(vC * (1. + .35 * smoothstep(.25, 0., r)), a * uOp * vA); }`;

/** 一组沿折线流动的小点 */
class Flow {
  constructor(stage, paths, { color = '#4cc9f0', speed = 120, spacing = 9, size = 3.4, loop = false } = {}) {
    this.stage = stage; this.speed = speed; this.w = 0; this.target = 1; this.rate = 1; this.loop = loop;
    this.paths = paths.map((pt) => {
      const P = pt.p.map(Bv), L = [0];
      for (let i = 1; i < P.length; i++) L.push(L[i - 1] + P[i].distanceTo(P[i - 1]));
      return { P, L, len: L[L.length - 1] };
    });
    const items = [];
    for (const [k, p] of this.paths.entries()) {
      const n = Math.max(3, Math.round(p.len / (spacing * MM)));
      for (let j = 0; j < n; j++) items.push({ k, u: (j + (loop ? 0 : Math.random() * .6)) / n });
    }
    this.items = items;
    const N = items.length, g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3); this.alpha = new Float32Array(N);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aA', new THREE.BufferAttribute(this.alpha, 1));
    this.color = new THREE.Color(color);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: DOT_V, fragmentShader: DOT_F, transparent: true, depthWrite: false,
      uniforms: { uSize: { value: size * MM }, uPx: { value: 800 }, uOp: { value: 0 } },
    });
    this.pts = new THREE.Points(g, this.mat);
    this.pts.frustumCulled = false; this.pts.renderOrder = 5;
    stage.scene.add(this.pts);
    this._v = new THREE.Vector3();
    this.step(0);
  }
  step(dt) {
    this.w = approach(this.w, this.target, 6, dt);
    this.mat.uniforms.uOp.value = this.w;
    this.mat.uniforms.uPx.value = this.stage.pxScale;
    this.pts.visible = this.w > .01;
    if (!this.pts.visible) return;
    const plane = this.stage.clip[0], cutOn = this.stage.cutOn, v = this._v, c = this.color;
    const sp = this.speed * this.rate * MM;
    this.items.forEach((it, i) => {
      const p = this.paths[it.k];
      it.u = (it.u + sp * dt / p.len) % 1;
      if (it.u < 0) it.u += 1;
      const d = it.u * p.len;
      let lo = 0, hi = p.L.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p.L[m] <= d) lo = m; else hi = m; }
      const f = (d - p.L[lo]) / Math.max(1e-9, p.L[hi] - p.L[lo]);
      v.copy(p.P[lo]).lerp(p.P[hi], f);
      this.pos[i * 3] = v.x; this.pos[i * 3 + 1] = v.y; this.pos[i * 3 + 2] = v.z;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      const fade = this.loop ? 1 : Math.min(1, it.u * 12, (1 - it.u) * 12);
      this.alpha[i] = (cutOn && plane.distanceToPoint(v) < -0.004 ? 0 : 1) * fade;
    });
    const g = this.pts.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aCol.needsUpdate = true; g.attributes.aA.needsUpdate = true;
  }
  dispose() { this.stage.scene.remove(this.pts); this.pts.geometry.dispose(); this.mat.dispose(); }
}

/** 皮带：节线绕主动轮、从动轮一圈，截面是梯形；每帧按当前速比重新生成 */
class Belt {
  constructor(stage, kin, parent) {
    this.k = kin; this.N1 = 90; this.N2 = 90;
    const n = this.N1 + this.N2, g = new THREE.BufferGeometry();
    this.n = n;
    this.pos = new Float32Array(n * 4 * 3 * 2);
    // 每个截面 4 条边，每条边 2 个顶点（不共享，好让法线是平的）→ 每段 4 个四边形
    const idx = [], uv = new Float32Array(n * 8 * 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      for (let e = 0; e < 4; e++) {
        const a = i * 8 + e * 2, b = a + 1, c = j * 8 + e * 2, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.uv = uv;
    // 齿形带的花纹：一格深一格浅
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#2b3038'; cx.fillRect(0, 0, 64, 8);
    cx.fillStyle = '#3d444f'; cx.fillRect(0, 0, 30, 8);
    cx.fillStyle = '#e8a23c'; cx.fillRect(30, 3, 4, 2);
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    this.tex = tex;
    this.mat = new THREE.MeshStandardMaterial({ map: tex, roughness: .8, metalness: 0, side: THREE.DoubleSide, clippingPlanes: stage.clip });
    // 剖开时皮带的截面也涂成实心（和其他零件一样）
    this.mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
        if (!gl_FrontFacing) gl_FragColor = linearToOutputTexel(vec4(.09, .1, .12, 1.));`);
    };
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'U4_Belt';
    parent.add(this.mesh);
    this.offset = 0;
    this.lastX = -1;
  }
  update(x) {
    if (Math.abs(x - this.lastX) < 1e-4) return;
    this.lastX = x;
    const k = this.k, g = S.cvtGeom(x);
    const c1 = [k.crank[0], k.crank[2]], c2 = [k.drv[0], k.drv[2]];
    const dx = c2[0] - c1[0], dz = c2[1] - c1[1], C = Math.hypot(dx, dz), ang = Math.atan2(dz, dx);
    const ph = Math.asin((g.r2 - g.r1) / C);
    const yb1 = k.ycd + k.tanB * (g.r1 - k.r1lo), yb2 = k.ycn - k.tanB * (g.r2 - k.r2hi);
    const pts = [];
    // 方向：曲轴绕 +Y 正转，皮带在主动轮上跟着走；按这个方向排点，纹理才往对的方向流
    for (let i = 0; i < this.N1; i++) {
      const a = ang + Math.PI / 2 + ph + (Math.PI - 2 * ph) * i / this.N1;
      pts.push([c1[0] + g.r1 * Math.cos(a), c1[1] + g.r1 * Math.sin(a), Math.cos(a), Math.sin(a), yb1]);
    }
    for (let i = 0; i < this.N2; i++) {
      const a = ang - Math.PI / 2 - ph + (Math.PI + 2 * ph) * i / this.N2;
      pts.push([c2[0] + g.r2 * Math.cos(a), c2[1] + g.r2 * Math.sin(a), Math.cos(a), Math.sin(a), yb2]);
    }
    const sec = [[-6, 7.75], [3, 10], [3, -10], [-6, -7.75]];
    let s = 0;
    for (let i = 0; i < this.n; i++) {
      const [x0, z0, nx, nz, y] = pts[i];
      if (i > 0) s += Math.hypot(x0 - pts[i - 1][0], z0 - pts[i - 1][1]);
      for (let e = 0; e < 4; e++) {
        for (let q = 0; q < 2; q++) {
          const [a, w] = sec[(e + q) % 4];
          const v = B(x0 + nx * a, y + w, z0 + nz * a);
          const o = (i * 8 + e * 2 + q) * 3;
          this.pos[o] = v.x; this.pos[o + 1] = v.y; this.pos[o + 2] = v.z;
          const ou = (i * 8 + e * 2 + q) * 2;
          this.uv[ou] = s / 16; this.uv[ou + 1] = (e + q) / 4;
        }
      }
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true; geo.attributes.uv.needsUpdate = true;
    geo.computeVertexNormals();
  }
  /** 皮带线速度（mm/s）→ 纹理往前流 */
  scroll(dmm) { this.offset -= dmm / 16; this.tex.offset.x = this.offset; }
}

export class Stage {
  constructor(canvas, spec) {
    this.canvas = canvas; this.spec = spec;
    this.parts = new Map();
    this.model = 'all';
    this.clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e4)];
    this.cutOn = false; this.cutKey = null; this.cutK = 0;
    this.ghost = false; this.ghostK = 0;
    this.explodeT = 0; this.explodeK = 0;
    this.speed = 1; this.paused = false;
    this.flows = [];
    this.vars = { cent: true, ecvt: false, conv: false, hyb: false };
    this.hidden = new Set();
    this.pxScale = 800;
    this.capEps = { value: 0 };
    this.highlight = null; this.hlT = 0;
    // 每个模型的“机械状态”，章节逻辑每帧改它，舞台据此摆零件
    this.U4 = { th: 0, x: 0, phi2: 0, phiB: 0, clutch: 0, swing: 0, starter: 0, acg: 0, acgPhase: 0, gas: null, spark: 0, slider: 0 };
    this.T2 = { th: 0, gas: null, spark: 0, reed: 0, cc: 0 };
    this.EH = { phi: 0, phase: 0, amp: 0 };
    this.EM = { phi: 0, phase: 0, amp: 0 };
  }

  async init(glbBytes) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.localClippingEnabled = true;
    const scene = this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = .85;
    const key = new THREE.DirectionalLight('#ffffff', 1.5); key.position.set(-2, 4, 3); scene.add(key);
    scene.add(new THREE.HemisphereLight('#bcd4ff', '#1a2433', .45));
    const cam = this.camera = new THREE.PerspectiveCamera(32, 1, .01, 80);
    const ctl = this.controls = new OrbitControls(cam, this.canvas);
    ctl.enableDamping = true; ctl.dampingFactor = .09; ctl.minDistance = .12; ctl.maxDistance = 12;
    ctl.addEventListener('start', () => { this.fly = null; });
    this._ground();
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength), '', res, rej));
    // 摆动组：U4 总成（除了车架、减震、混动电池这些装在车架上的）整体绕摆动轴转
    this.swing = new THREE.Group(); this.swing.matrixAutoUpdate = false; scene.add(this.swing);
    scene.add(gltf.scene);
    const regs = [];
    gltf.scene.traverse((o) => { const ud = o.userData || {}; if (ud.m && !this.parts.has(o.name)) regs.push(o); });
    for (const o of regs) this._register(o, o.userData);
    for (const p of this.parts.values()) {
      if (p.model === 'U4' && !['frame', 'shock', 'shockSpring'].includes(p.role) && !/HybBattery|HybPCU|HybCable/.test(p.name)) this.swing.attach(p.obj);
    }
    this._prep();
    this.belt = new Belt(this, this.spec.models.U4.kin, this.swing);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.applyView({ model: 'all' }, true);
  }

  _ground() {
    const g = new THREE.CircleGeometry(8, 64); g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `varying vec2 vP; void main(){ float r = length(vP); vec2 q = abs(fract(vP * 10.) - .5); float l = 1. - smoothstep(0., .02, min(q.x, q.y));
        float a = smoothstep(5.5, .2, r); gl_FragColor = vec4(mix(vec3(.06,.1,.17), vec3(.16,.24,.36), l * .55), .92 * a); }`,
    });
    const mesh = new THREE.Mesh(g, m); mesh.position.y = this.spec.ground * MM - 0.0005; mesh.renderOrder = -1;
    this.scene.add(mesh);
  }

  _register(o, ud) {
    const part = {
      name: o.name, obj: o, model: ud.m, role: ud.role, cn: ud.cn, ghostable: !!ud.ghost, v: ud.var || '', nosel: !!ud.nosel,
      base: o.position.clone(), q0: o.quaternion.clone(), ex: Bv(ud.ex || [0, 0, 0]), k: ud.k, sgn: ud.sgn,
      dl: new THREE.Vector3(), orbit: null, rot: 0, own: 0, scl: new THREE.Vector3(1, 1, 1), extra: null,
      meshes: [],
    };
    o.traverse((m) => {
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mt) => {
        const c = mt.clone();
        c.clippingPlanes = this.clip;
        c.side = THREE.DoubleSide;
        if (part.role === 'pipe') { c.transparent = true; c.opacity = .32; c.depthWrite = false; }
        if (part.role === 'charge') { c.transparent = true; c.opacity = .5; c.depthWrite = false; c.emissive = new THREE.Color('#000'); }
        if (part.role !== 'charge' && part.role !== 'pipe') {
          // 切面上色：背面（只有剖开时才看得到）画成本身颜色的深色 + 斜线
          c.onBeforeCompile = (sh) => {
            sh.uniforms.uCapEps = this.capEps;
            sh.fragmentShader = 'uniform float uCapEps;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
              if (!gl_FrontFacing) { vec3 cc = diffuseColor.rgb * .74; float h = step(.6, fract((gl_FragCoord.x + gl_FragCoord.y) * .07));
                cc *= mix(1., .82, h); gl_FragColor = linearToOutputTexel(vec4(cc, 1.)); gl_FragDepth = gl_FragCoord.z - uCapEps; }
              else gl_FragDepth = gl_FragCoord.z;`);
          };
        }
        c.userData.baseEmissive = c.emissive ? c.emissive.clone() : null;
        c.userData.baseEI = c.emissiveIntensity;
        return c;
      });
      m.material = Array.isArray(m.material) ? mats : mats[0];
      m.userData.solid = m.material;
      if (part.ghostable) {
        const col = (mats[0].color || new THREE.Color('#ccd')).clone().convertLinearToSRGB();
        m.userData.ghost = new THREE.ShaderMaterial({
          vertexShader: GHOST_V, fragmentShader: GHOST_F, transparent: true, depthWrite: false, side: THREE.FrontSide,
          clipping: true, clippingPlanes: this.clip, uniforms: { uC: { value: col }, uA: { value: .5 } },
        });
      }
      part.meshes.push(m);
    });
    if (part.role === 'renderonly') o.visible = false;
    this.parts.set(o.name, part);
  }

  /** 线圈：按角度上色的着色器（旋转磁场看得见：红 = 一个方向的电流，蓝 = 反方向） */
  _coilShader(part, centerB, npp) {
    const u = { uC: { value: Bv(centerB) }, uPh: { value: 0 }, uAmp: { value: 0 }, uNpp: { value: npp } };
    for (const m of part.meshes) {
      const mt = m.userData.solid;
      const prev = mt.onBeforeCompile;
      mt.onBeforeCompile = (sh) => {
        prev && prev(sh);
        Object.assign(sh.uniforms, u);
        sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.)).xyz;');
        sh.fragmentShader = 'uniform vec3 uC; uniform float uPh; uniform float uAmp; uniform float uNpp; varying vec3 vWp;\n' +
          sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            { float an = atan(vWp.y - uC.y, vWp.x - uC.x); float s = cos(uNpp * an - uPh);
              totalEmissiveRadiance += uAmp * (s > 0. ? vec3(1., .32, .2) : vec3(.25, .5, 1.)) * pow(abs(s), 1.5) * 1.4; }`);
      };
      mt.needsUpdate = true;
    }
    part.coilU = u;
  }

  _prep() {
    const sp = this.spec.models, k = sp.U4.kin;
    const P = (n) => this.parts.get(n);
    const orbit = (n, c) => { const p = P(n); if (p) p.orbit = Bv(c); return p; };
    // U4：曲轴系
    ['U4_Crank', 'U4_ACGRotor', 'U4_DriveFixed', 'U4_DriveMovable', 'U4_DriveMovableE', 'U4_RampPlate', 'U4_OneWayClutch'].forEach((n) => orbit(n, k.crank));
    for (let i = 0; i < k.rollN; i++) orbit(`U4_Roller${i}`, k.crank);
    ['U4_DrivenFixed', 'U4_DrivenMovable', 'U4_ClutchCarrier', 'U4_ClutchBell'].forEach((n) => orbit(n, k.drv));
    for (let i = 0; i < 3; i++) orbit(`U4_Shoe${i}`, k.drv);
    orbit('U4_CounterShaft', k.cnt);
    ['U4_AxleGear', 'U4_WheelRim', 'U4_WheelTire'].forEach((n) => orbit(n, k.axl));
    orbit('U4_Camshaft', k.camC);
    orbit('U4_ECVTSlider', k.crank); orbit('U4_ECVTIdler', k.ecvtIdler); orbit('U4_ECVTPinion', k.ecvtMotor);
    orbit('U4_StarterGear', k.starterGear);
    // 离合块：绕自己的销往外摆，算出“往外”是正角还是负角
    this.shoeSgn = k.shoes.map((pv, i) => {
      const r = sub3(k.shoeEnds[i], pv), out = sub3(k.shoeEnds[i], k.drv);
      return Math.sign(dot3(yCross(r), out)) || 1;
    });
    // 摇臂：凸轮把一头顶起来，另一头往下压气门。算出“气门开 1 mm 摇臂转几度”
    this.rockK = {};
    for (const [nm, piv, tip, v] of [['In', k.pivIn, k.tipIn, k.vIn], ['Ex', k.pivEx, k.tipEx, k.vEx]]) {
      const r = sub3(tip, piv), vc = yCross(r);
      this.rockK[nm] = 1 / dot3(vc, v.map((q) => -q));
    }
    this.U4k = k;
    // 线圈着色
    if (P('U4_ACGCoils')) this._coilShader(P('U4_ACGCoils'), k.crank, 6);
    if (P('EH_Coils')) this._coilShader(P('EH_Coils'), sp.EH.kin.axle, 14);
    if (P('EM_Coils')) this._coilShader(P('EM_Coils'), sp.EM.kin.motor, 4);
    // T2
    const t = sp.T2.kin;
    orbit('T2_Crank', t.crank);
    // EH / EM
    ['EH_WheelRim', 'EH_WheelTire', 'EH_Rotor', 'EH_CapL'].forEach((n) => orbit(n, sp.EH.kin.axle));
    orbit('EM_Rotor', sp.EM.kin.motor); orbit('EM_Counter', sp.EM.kin.cnt);
    ['EM_AxleGear', 'EM_WheelRim', 'EM_WheelTire'].forEach((n) => orbit(n, sp.EM.kin.axl));
  }

  resize() {
    const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.pxScale = h / (2 * Math.tan(this.camera.fov * Math.PI / 360));
  }

  // ---------------------------------------------------------------- 视角
  /** v = { model, view, cut, ghost, explode, fov, vars, hide } */
  applyView(v, instant = false) {
    this.vars = Object.assign({ cent: true, ecvt: false, conv: false, hyb: false }, v.vars || {});
    this.hidden = new Set(v.hide || []);
    this.setModel(v.model || 'all');
    let pos, tgt;
    if (this.model === 'all') {
      tgt = B(-700, 0, 40);
      const kk = Math.max(1, 1.45 / (this.camera.aspect || 1.2));
      pos = tgt.clone().add(B(300, 5200, 1700).multiplyScalar(kk));
    } else {
      const S_ = this.spec.models[this.model];
      const vw = S_.views[v.view || 'home'] || S_.views.home;
      pos = Bv(vw.pos); tgt = Bv(vw.tgt);
    }
    this.flyTo(pos, tgt, v.fov || 32, instant);
    this.setCut(v.cut || null);
    this.setGhost(!!v.ghost);
    this.setExplode(v.explode ? 1 : 0);
  }

  flyTo(pos, tgt, fov = 32, instant = false) {
    if (instant) {
      this.camera.position.copy(pos); this.controls.target.copy(tgt); this.camera.fov = fov; this.camera.updateProjectionMatrix();
      this.fly = null; this.controls.update(); this.resize(); return;
    }
    this.fly = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), f0: this.camera.fov, p1: pos, t1: tgt, f1: fov, k: 0 };
  }

  setModel(m) { this.model = m; this._vis(); }
  setVars(vs) { Object.assign(this.vars, vs); this._vis(); }
  setHidden(list) { this.hidden = new Set(list); this._vis(); }
  toggleHidden(n) { if (this.hidden.has(n)) this.hidden.delete(n); else this.hidden.add(n); this._vis(); }
  _vis() {
    for (const p of this.parts.values()) {
      p.obj.visible = p.role !== 'renderonly' && (this.model === 'all' || p.model === this.model) && (!p.v || this.vars[p.v]) && !this.hidden.has(p.name);
    }
    if (this.belt) this.belt.mesh.visible = this.model === 'all' || this.model === 'U4';
  }

  setCut(key) {
    this.cutKey = key; this.cutOn = !!key; this.cutK = 0;
    if (key && this.model !== 'all') {
      const c = this.spec.models[this.model].cuts[key];
      this._cut = { N: Bdir(c.n), P: Bv(c.p) };
    } else this._cut = null;
  }
  setGhost(on) { this.ghost = on; }
  setExplode(on) { this.explodeT = on ? 1 : 0; }
  settle() {
    if (this.fly) this.fly.k = .9999;
    this.cutK = .9999; this.explodeK = this.explodeT; this.ghostK = this.ghost ? 1 : 0;
  }

  // ---------------------------------------------------------------- 流动小点
  setFlows(list) {
    for (const f of this.flows) f.dispose();
    this.flows = [];
    for (const it of list) {
      const S_ = this.spec.models[it.model];
      const paths = it.key.split('+').flatMap((k) => S_.flows[k] || []);
      if (!paths.length) continue;
      const f = new Flow(this, paths, it);
      f.key = it.key; f.target = it.on === false ? 0 : 1;
      this.flows.push(f);
    }
  }
  flow(key) { return this.flows.find((f) => f.key === key); }

  // ---------------------------------------------------------------- 工具
  part(n) { return this.parts.get(n); }
  flash(name) { this.highlight = name; this.hlT = 1.6; }
  project(v) {
    const p = v.clone().project(this.camera);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { x: (p.x * .5 + .5) * w, y: (-p.y * .5 + .5) * h, behind: p.z > 1 };
  }
  pick(cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.camera);
    const objs = [];
    for (const p of this.parts.values()) if (p.obj.visible && !(this.ghost && p.ghostable) && p.role !== 'pipe' && !p.nosel) objs.push(p.obj);
    if (this.belt.mesh.visible) objs.push(this.belt.mesh);
    const hits = rc.intersectObjects(objs, true);
    for (const h of hits) {
      if (this.cutOn && this.clip[0].distanceToPoint(h.point) < 0) continue;
      if (h.object === this.belt.mesh) return { name: 'U4_Belt', cn: '橡胶 V 带（内侧有齿，好弯）', model: 'U4' };
      let o = h.object;
      while (o && !this.parts.has(o.name)) o = o.parent;
      if (o) return this.parts.get(o.name);
    }
    return null;
  }
  /** 标签的世界坐标：U4 的标签跟着总成一起摆 */
  pinWorld(v, model) {
    if (model === 'U4' && this.U4.swing) return v.clone().applyMatrix4(this.swing.matrix);
    return v;
  }

  // ---------------------------------------------------------------- 运动学
  _gasColor(part, st) {
    if (!part) return;
    for (const m of part.meshes) {
      const mt = m.userData.solid;
      if (!st) { mt.opacity = 0; continue; }
      mt.color.copy(st.c); mt.emissive.copy(st.c); mt.emissiveIntensity = st.e || 0; mt.opacity = st.a ?? .5;
    }
  }

  _driveU4(dt) {
    const k = this.U4k, U = this.U4, P = (n) => this.parts.get(n);
    // 摆动组矩阵
    const pv = Bv(k.pivot);
    const m = new THREE.Matrix4().makeTranslation(pv.x, pv.y, pv.z).multiply(new THREE.Matrix4().makeRotationAxis(AX, U.swing)).multiply(new THREE.Matrix4().makeTranslation(-pv.x, -pv.y, -pv.z));
    this.swing.matrix.copy(m); this.swing.matrixWorldNeedsUpdate = true;
    // 曲轴、活塞、连杆
    const th = U.th, thD = th * 180 / Math.PI;
    for (const n of ['U4_Crank', 'U4_ACGRotor', 'U4_DriveFixed', 'U4_RampPlate', 'U4_OneWayClutch']) { const p = P(n); if (p) p.rot = th; }
    const s = S.pistonS(th, k.r, k.L);
    const dC = Bdir(k.dCyl);
    P('U4_Piston').dl.copy(dC).multiplyScalar((s - (k.r + k.L)) * MM);
    const rod = P('U4_Rod');
    const pin = Bv([k.crank[0] + k.dCyl[0] * k.r, k.crank[1], k.crank[2] + k.dCyl[2] * k.r]);
    // 曲柄销绕曲轴转 th 后的位置
    const c = Bv(k.crank);
    const pinNow = pin.clone().sub(c).applyQuaternion(qY(th)).add(c);
    rod.dl.copy(pinNow).sub(rod.base);
    rod.own = Math.asin(-k.r * Math.sin(th) / k.L);
    // 配气
    const { inL, exL } = S.valveLifts(thD);
    P('U4_ValveIn').dl.copy(Bdir(k.vIn)).multiplyScalar(-inL * MM);
    P('U4_ValveEx').dl.copy(Bdir(k.vEx)).multiplyScalar(-exL * MM);
    P('U4_RockerIn').own = inL * this.rockK.In;
    P('U4_RockerEx').own = exL * this.rockK.Ex;
    P('U4_SpringIn').scl.set(1, (k.springLen - inL) / k.springLen, 1);
    P('U4_SpringEx').scl.set(1, (k.springLen - exL) / k.springLen, 1);
    P('U4_Camshaft').rot = th / 2;
    // 缸内气体
    const crown = s + k.pinH;
    const ch = P('U4_Charge');
    ch.scl.set(1, Math.max(.02, (k.deck - crown) / k.chargeLen), 1);
    this._gasColor(ch, U.gas); this._gasColor(P('U4_ChargeDome'), U.gas);
    // CVT
    const g = S.cvtGeom(U.x);
    for (const n of ['U4_DriveMovable', 'U4_DriveMovableE']) { const p = P(n); if (p) { p.rot = th; p.dl.copy(B(0, g.delta, 0)); } }
    for (let i = 0; i < k.rollN; i++) {
      const p = P(`U4_Roller${i}`), u = k.rollers[i];
      p.rot = th; p.dl.copy(B(u[0], u[1], u[2]).multiplyScalar(1).multiplyScalar(g.rho - k.rollRho0));
    }
    const open = k.epsMax - g.eps;
    for (const n of ['U4_DrivenFixed', 'U4_ClutchCarrier']) P(n).rot = U.phi2;
    const dm = P('U4_DrivenMovable'); dm.rot = U.phi2; dm.own = -open / 28 * .55; dm.dl.copy(B(0, open, 0));
    const spr = P('U4_TorqueSpring'), L0 = k.springY[1] - k.springY[0];
    spr.scl.set(1, 1, (L0 - open) / L0);
    for (let i = 0; i < 3; i++) { const p = P(`U4_Shoe${i}`); p.rot = U.phi2; p.own = this.shoeSgn[i] * U.clutch * 0.045; }
    P('U4_ClutchBell').rot = U.phiB;
    const z = k.zg;
    P('U4_CounterShaft').rot = -U.phiB * z[0] / z[1];
    const wA = U.phiB * (z[0] / z[1]) * (z[2] / z[3]);
    for (const n of ['U4_AxleGear', 'U4_WheelRim', 'U4_WheelTire']) P(n).rot = wA;
    // 电控 CVT：滑块转一圈，螺纹把动盘推 1.5 mm
    if (this.vars.ecvt) {
      const aS = -g.delta / 1.5 * 2 * Math.PI;
      P('U4_ECVTSlider').rot = aS;
      P('U4_ECVTIdler').rot = -aS * 32 / 44;
      P('U4_ECVTPinion').rot = aS * 32 / 12;
    }
    if (this.vars.conv) { const sg = P('U4_StarterGear'); if (sg) sg.rot = -U.starter; }
    // ACG 线圈：发电（蓝红交替很淡）/ 起动、助力（亮）
    const ac = P('U4_ACGCoils');
    if (ac && ac.coilU) { ac.coilU.uPh.value = -6 * th + U.acgPhase; ac.coilU.uAmp.value = U.acg; }
    // 火花塞闪一下
    const pl = P('U4_SparkPlug');
    for (const mm of pl.meshes) { const mt = mm.userData.solid; mt.emissive.set('#9fd8ff'); mt.emissiveIntensity = U.spark * 2.5; }
    // 皮带
    this.belt.update(U.x);
    // 减震器：上端在车架上，下端跟着总成摆
    const top = Bv(k.shock[0]), bot = Bv(k.shock[1]).applyMatrix4(m);
    const dir = bot.clone().sub(top), len = dir.length() / MM;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    for (const n of ['U4_Shock', 'U4_ShockSpring']) {
      const p = P(n); p.extra = { q, scl: len / k.shockL };
    }
  }

  _driveT2() {
    const k = this.spec.models.T2.kin, U = this.T2, P = (n) => this.parts.get(n);
    const th = U.th;
    P('T2_Crank').rot = th;
    const s = S.pistonS(th, k.r, k.L);
    P('T2_Piston').dl.copy(Bdir(k.dCyl)).multiplyScalar((s - (k.r + k.L)) * MM);
    const rod = P('T2_Rod');
    const c = Bv(k.crank), pin = Bv([k.crank[0] + k.dCyl[0] * k.r, k.crank[1], k.crank[2] + k.dCyl[2] * k.r]);
    rod.dl.copy(pin.clone().sub(c).applyQuaternion(qY(th)).add(c)).sub(rod.base);
    rod.own = Math.asin(-k.r * Math.sin(th) / k.L);
    const ch = P('T2_Charge');
    ch.scl.set(1, Math.max(.02, (k.deck - (s + k.pinH)) / k.chargeLen), 1);
    this._gasColor(ch, U.gas); this._gasColor(P('T2_ChargeDome'), U.gas);
    for (const n of ['T2_ReedF', 'T2_ReedR']) { const p = P(n); if (p) p.own = -p.sgn * U.reed * 0.42; }
    const pl = P('T2_SparkPlug');
    for (const mm of pl.meshes) { const mt = mm.userData.solid; mt.emissive.set('#9fd8ff'); mt.emissiveIntensity = U.spark * 2.5; }
  }

  _driveE() {
    const P = (n) => this.parts.get(n);
    const h = this.EH;
    for (const n of ['EH_WheelRim', 'EH_WheelTire', 'EH_Rotor', 'EH_CapL']) P(n).rot = h.phi;
    const ch = P('EH_Coils'); if (ch.coilU) { ch.coilU.uPh.value = -14 * h.phi + h.phase; ch.coilU.uAmp.value = h.amp; }
    const e = this.EM, z = this.spec.models.EM.kin.zg;
    P('EM_Rotor').rot = e.phi;
    P('EM_Counter').rot = -e.phi * z[0] / z[1];
    const wA = e.phi * (z[0] / z[1]) * (z[2] / z[3]);
    for (const n of ['EM_AxleGear', 'EM_WheelRim', 'EM_WheelTire']) P(n).rot = wA;
    const cm = P('EM_Coils'); if (cm.coilU) { cm.coilU.uPh.value = -4 * e.phi + e.phase; cm.coilU.uAmp.value = e.amp; }
  }

  frame(dt) {
    if (this.fly) {
      const f = this.fly; f.k = Math.min(1, f.k + dt / 1.1);
      const e = easeIO(f.k);
      this.camera.position.lerpVectors(f.p0, f.p1, e);
      this.controls.target.lerpVectors(f.t0, f.t1, e);
      this.camera.fov = f.f0 + (f.f1 - f.f0) * e; this.camera.updateProjectionMatrix();
      if (f.k >= 1) { this.fly = null; this.resize(); }
    }
    this.controls.update();
    if (this._cut) {
      this.cutK = Math.min(1, this.cutK + dt / .7);
      const off = (1 - easeIO(this.cutK)) * .5;
      const n = this._cut.N.clone().negate();
      this.clip[0].set(n, this._cut.N.dot(this._cut.P) + off);
    } else this.clip[0].set(new THREE.Vector3(0, 1, 0), 1e4);
    {
      const d = this.camera.position.distanceTo(this.controls.target), n = this.camera.near, f = this.camera.far;
      this.capEps.value = this._cut ? 0.6 * MM * n * f / ((f - n) * d * d) : 0;
    }
    this.ghostK = approach(this.ghostK, this.ghost ? 1 : 0, 8, dt);
    this.explodeK = approach(this.explodeK, this.explodeT, 3.2, dt);
    const vis = (m) => this.model === 'all' || this.model === m;
    if (vis('U4')) this._driveU4(dt);
    if (vis('T2')) this._driveT2(dt);
    if (vis('EH') || vis('EM')) this._driveE(dt);
    const ek = easeIO(this.explodeK);
    if (this.hlT > 0) this.hlT -= dt;
    const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), tmp = new THREE.Vector3();
    for (const p of this.parts.values()) {
      if (!p.obj.visible) continue;
      if (p.extra) {
        p.obj.position.copy(p.base);
        p.obj.quaternion.copy(p.extra.q);
        p.obj.scale.set(1, p.extra.scl, 1);
      } else if (p.orbit) {
        qY(p.rot, q);
        tmp.copy(p.base).sub(p.orbit).add(p.dl).applyQuaternion(q).add(p.orbit);
        p.obj.position.copy(tmp).addScaledVector(p.ex, ek);
        p.obj.quaternion.copy(q).multiply(p.q0).multiply(qY(p.own, q2));
        p.obj.scale.copy(p.scl);
      } else {
        p.obj.position.copy(p.base).add(p.dl).addScaledVector(p.ex, ek);
        p.obj.quaternion.copy(p.q0).multiply(qY(p.own, q2));
        p.obj.scale.copy(p.scl);
      }
      const useGhost = p.ghostable && this.ghostK > .02;
      const hl = this.highlight === p.name && this.hlT > 0 ? .5 + .5 * Math.sin(this.hlT * 9) : 0;
      for (const m of p.meshes) {
        if (useGhost) { m.material = m.userData.ghost; m.material.uniforms.uA.value = .55 * this.ghostK; m.renderOrder = 3; }
        else { m.material = m.userData.solid; m.renderOrder = p.role === 'charge' ? 2 : 0; }
        if (!p.coilU && p.role !== 'charge' && !/SparkPlug/.test(p.name)) {
          for (const mt of Array.isArray(m.userData.solid) ? m.userData.solid : [m.userData.solid]) {
            if (!mt.emissive) continue;
            if (hl > 0) { mt.emissive.set('#4cc9f0'); mt.emissiveIntensity = hl * .8; }
            else if (mt.userData.baseEmissive) { mt.emissive.copy(mt.userData.baseEmissive); mt.emissiveIntensity = mt.userData.baseEI; }
          }
        }
      }
    }
    for (const f of this.flows) f.step(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
