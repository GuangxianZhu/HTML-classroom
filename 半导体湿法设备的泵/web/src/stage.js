// three.js 舞台：五台泵、剖切（切面上色）、透视外壳、拆开、液体和空气小点、各泵的运动。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { stroke } from './sim.js';

const MM = 0.001;
/** Blender 坐标（mm）→ three 坐标（m） */
export const B = (x, y, z) => new THREE.Vector3(x * MM, z * MM, -y * MM);
const Bv = (a) => B(a[0], a[1], a[2]);
const Bdir = (a) => new THREE.Vector3(a[0], a[2], -a[1]).normalize();
export const easeIO = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const approach = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

// 压力色带：低压蓝 → 高压红（液体小点用）
const RAMP = ['#3e7bfa', '#2fc4d6', '#7fdc8a', '#f2c230', '#ff8a3c', '#e5484d'].map((h) => new THREE.Color(h));
export const RAMP_CSS = 'linear-gradient(90deg,#3e7bfa,#2fc4d6,#7fdc8a,#f2c230,#ff8a3c,#e5484d)';
function ramp(s, out) {
  const x = Math.max(0, Math.min(.9999, s)) * (RAMP.length - 1), i = Math.floor(x), f = x - i;
  return out.copy(RAMP[i]).lerp(RAMP[i + 1], f);
}

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
  constructor(stage, paths, { color = null, speed = 120, spacing = 9, size = 3.4, group = '' } = {}) {
    this.stage = stage; this.group = group; this.speed = speed; this.w = 0; this.target = 1; this.rate = 1;
    this.paths = paths.map((pt) => {
      const P = pt.p.map(Bv), L = [0];
      for (let i = 1; i < P.length; i++) L.push(L[i - 1] + P[i].distanceTo(P[i - 1]));
      return { P, S: pt.s, L, len: L[L.length - 1] };
    });
    const items = [];
    for (const [k, p] of this.paths.entries()) {
      const n = Math.max(3, Math.round(p.len / (spacing * MM)));
      for (let j = 0; j < n; j++) items.push({ k, u: (j + Math.random() * .6) / n });
    }
    this.items = items;
    const N = items.length;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3); this.alpha = new Float32Array(N);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aA', new THREE.BufferAttribute(this.alpha, 1));
    this.fixed = color ? new THREE.Color(color) : null;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: DOT_V, fragmentShader: DOT_F, transparent: true, depthWrite: false,
      uniforms: { uSize: { value: size * MM }, uPx: { value: 800 }, uOp: { value: 0 } },
    });
    this.pts = new THREE.Points(g, this.mat);
    this.pts.frustumCulled = false; this.pts.renderOrder = 5;
    stage.scene.add(this.pts);
    this._c = new THREE.Color(); this._v = new THREE.Vector3();
    this.step(0);
  }

  step(dt) {
    this.w = approach(this.w, this.target, 6, dt);
    this.mat.uniforms.uOp.value = this.w;
    this.mat.uniforms.uPx.value = this.stage.pxScale;
    this.pts.visible = this.w > .01;
    if (!this.pts.visible) return;
    const plane = this.stage.clip[0], cutOn = this.stage.cutOn, v = this._v, c = this._c;
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
      if (this.fixed) c.copy(this.fixed); else ramp(p.S[lo] + (p.S[hi] - p.S[lo]) * f, c);
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      // 剖开时，被切掉那一半里的点也藏起来（留 4 mm 余量，贴着切面的还看得见）
      const fadeEnds = Math.min(1, it.u * 12, (1 - it.u) * 12);
      this.alpha[i] = (cutOn && plane.distanceToPoint(v) < -0.004 ? 0 : 1) * fadeEnds;
    });
    const g = this.pts.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aCol.needsUpdate = true; g.attributes.aA.needsUpdate = true;
  }

  dispose() { this.stage.scene.remove(this.pts); this.pts.geometry.dispose(); this.mat.dispose(); }
}

export class Stage {
  constructor(canvas, spec) {
    this.canvas = canvas; this.spec = spec;
    this.parts = new Map();
    this.pump = 'all';
    this.clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e4)];
    this.cutOn = false; this.cutKey = null; this.cutK = 0;
    this.ghost = false; this.ghostK = 0;
    this.explodeT = 0; this.explodeK = 0;
    this.speed = 1; this.paused = false;
    this.flows = [];
    this.D = {
      P1: { rpm: 30, lag: 8.8, slip: false, flow: 1, circ: 1, theta: 0, thetaI: 0, slipPhase: 0 },
      P2: { rpm: 24, on: true, x: 0, y: 0, theta: 0, drop: 0, flow: 1, exag: 6 },
      P3: { cpm: 18, psi: .25, damper: true, hold: null },
      P4: { cpm: 24, psi: .25, hold: null, stall: 0 },
      P5: { spm: 36, L: 1, psi: 0, gas: 0, locked: false },
    };
    this.pxScale = 800;
    this.capEps = { value: 0 };
    this.highlight = null; this.hlT = 0;
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
    const cam = this.camera = new THREE.PerspectiveCamera(32, 1, .01, 60);
    const ctl = this.controls = new OrbitControls(cam, this.canvas);
    ctl.enableDamping = true; ctl.dampingFactor = .09; ctl.minDistance = .12; ctl.maxDistance = 9;
    ctl.maxPolarAngle = Math.PI * .495;
    ctl.addEventListener('start', () => { this.fly = null; });
    this._ground();
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength), '', res, rej));
    scene.add(gltf.scene);
    gltf.scene.traverse((o) => {
      const ud = o.userData || {};
      if (!ud.pump || this.parts.has(o.name)) return;
      this._register(o, ud);
    });
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshPhysicalMaterial({ color: '#dff4ff', roughness: .05, transmission: .6, transparent: true, opacity: .55, clippingPlanes: this.clip }));
    this.bubble.visible = false; this.bubble.renderOrder = 4;
    scene.add(this.bubble);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.applyView({ pump: 'all', view: 'all' }, true);
  }

  _ground() {
    const g = new THREE.CircleGeometry(6, 64); g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `varying vec2 vP; void main(){ float r = length(vP); vec2 q = abs(fract(vP * 10.) - .5); float l = 1. - smoothstep(0., .02, min(q.x, q.y));
        float a = smoothstep(4.5, .2, r); gl_FragColor = vec4(mix(vec3(.06,.1,.17), vec3(.16,.24,.36), l * .55), .92 * a); }`,
    });
    const mesh = new THREE.Mesh(g, m); mesh.position.y = -0.0005; mesh.renderOrder = -1;
    this.scene.add(mesh);
  }

  _register(o, ud) {
    const part = {
      name: o.name, obj: o, pump: ud.pump, role: ud.role, mov: ud.mov || '', cn: ud.cn, ghostable: !!ud.ghost,
      base: o.position.clone(), ex: Bv(ud.ex || [0, 0, 0]),
      dpos: new THREE.Vector3(), rot: 0, axis: null, scl: new THREE.Vector3(1, 1, 1),
      meshes: [], morph: { pos: 0, neg: 0 }, coil: ud.coil,
    };
    const S = this.spec.pumps[ud.pump];
    if (part.mov.startsWith('rot')) part.axis = Bdir(S.axis.d);
    o.traverse((m) => {
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mt) => {
        const c = mt.clone();
        c.clippingPlanes = this.clip;
        c.side = THREE.DoubleSide;
        if (part.role === 'pipe') { c.transparent = true; c.opacity = .3; c.depthWrite = false; }
        // 切面上色：背面（只有剖开时才看得到）画成本身颜色的深色 + 斜线
        // 两个零件面贴面时（比如泵壳后端面贴着托架法兰），切面会和对方的表面抢深度、出现条纹，
        // 所以剖开时让背面往镜头方向挪一点点，平局时切面赢。
        c.onBeforeCompile = (sh) => {
          sh.uniforms.uCapEps = this.capEps;
          sh.fragmentShader = 'uniform float uCapEps;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
            if (!gl_FrontFacing) { vec3 cc = diffuseColor.rgb * .74; float h = step(.6, fract((gl_FragCoord.x + gl_FragCoord.y) * .07));
              cc *= mix(1., .82, h); gl_FragColor = linearToOutputTexel(vec4(cc, 1.)); gl_FragDepth = gl_FragCoord.z - uCapEps; }
            else gl_FragDepth = gl_FragCoord.z;`);
        };
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
      if (m.morphTargetDictionary) part.morphMesh = m;
      part.meshes.push(m);
    });
    this.parts.set(o.name, part);
  }

  resize() {
    const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.pxScale = h / (2 * Math.tan(this.camera.fov * Math.PI / 360));
  }

  // ---------------------------------------------------------------- 视角
  /** v = { pump, view, cut, ghost, explode, fov } */
  applyView(v, instant = false) {
    this.setPump(v.pump || 'all');
    const S = this.spec.pumps[this.pump];
    let pos, tgt;
    if (this.pump === 'all') {
      tgt = B(-60, 0, 120);
      const k = Math.max(1, 1.3 / (this.camera.aspect || 1.2));     // 窄屏再退远一点，五台都放得下
      pos = tgt.clone().add(B(-60, -4900, 1800).multiplyScalar(k));
    }
    else {
      const vw = S.views[v.view || 'home'] || S.views.home;
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

  setPump(p) {
    this.pump = p;
    for (const part of this.parts.values()) part.obj.visible = p === 'all' || part.pump === p;
  }

  setCut(key) {
    this.cutKey = key;
    this.cutOn = !!key;
    this.cutK = 0;
    if (key && this.pump !== 'all') {
      const c = this.spec.pumps[this.pump].cuts[key];
      const N = Bdir(c.n), P = Bv(c.p);
      this._cut = { N, P };
    } else this._cut = null;
  }

  setGhost(on) { this.ghost = on; }

  /** 测试用：把镜头、剖切、拆开的过渡动画一下走完 */
  settle() {
    if (this.fly) this.fly.k = .9999;
    this.cutK = .9999; this.explodeK = this.explodeT; this.ghostK = this.ghost ? 1 : 0;
  }
  setExplode(on) { this.explodeT = on ? 1 : 0; }

  // ---------------------------------------------------------------- 流动小点
  setFlows(list) {
    for (const f of this.flows) f.dispose();
    this.flows = [];
    for (const it of list) {
      const S = this.spec.pumps[it.pump];
      const paths = it.key.split('+').flatMap((k) => S.flows[k] || []);
      if (!paths.length) continue;
      const f = new Flow(this, paths, it);
      f.key = it.key; f.pump = it.pump; f.target = it.on === false ? 0 : 1;
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
    for (const p of this.parts.values()) if (p.obj.visible && !(this.ghost && p.ghostable) && p.role !== 'pipe') objs.push(p.obj);
    const hits = rc.intersectObjects(objs, true);
    for (const h of hits) {
      if (this.cutOn && this.clip[0].distanceToPoint(h.point) < 0) continue;
      let o = h.object;
      while (o && !this.parts.has(o.name)) o = o.parent;
      if (o) return this.parts.get(o.name);
    }
    return null;
  }

  // ---------------------------------------------------------------- 每台泵的运动
  _drive(dt) {
    const D = this.D, sp = this.paused ? 0 : this.speed;
    const P = (n) => this.parts.get(n);
    const vis = (p) => this.pump === 'all' || this.pump === p;
    // P1 磁力泵：外磁铁跟电机转，内磁铁落后 lag 度；脱耦时内磁铁只会抖
    if (vis('P1')) {
      const d = D.P1, w = 2 * Math.PI * d.rpm / 60;
      d.theta += w * dt * sp;
      if (d.slip) {
        d.slipPhase += dt * sp * 9;
        d.thetaI += w * .04 * dt * sp;
        P('P1_OuterMagnet').rot = d.theta;
        const jit = Math.sin(d.slipPhase) * .14 + Math.sin(d.slipPhase * 2.3) * .05;
        for (const n of ['P1_InnerMagnet', 'P1_Bearing', 'P1_Impeller']) P(n).rot = d.thetaI + jit;
      } else {
        d.thetaI = d.theta - d.lag * Math.PI / 180;
        P('P1_OuterMagnet').rot = d.theta;
        for (const n of ['P1_InnerMagnet', 'P1_Bearing', 'P1_Impeller']) P(n).rot = d.thetaI;
      }
      const fm = this.flow('main'), fc = this.flow('circ');
      if (fm && fm.pump === 'P1') fm.rate = sp * d.flow * (d.slip ? 0 : 1);
      if (fc && fc.pump === 'P1') fc.rate = sp * d.circ * (d.slip ? 0 : 1);
    }
    // P2 磁悬浮泵：转子转、偏移（放大显示）、线圈电流图案跟着转
    if (vis('P2')) {
      const d = D.P2, rot = P('P2_Rotor');
      const wr = 2 * Math.PI * d.rpm / 60 * (d.on ? 1 : 0);
      d.spin = approach(d.spin || 0, wr, d.on ? 3 : 1.2, dt);
      d.theta += d.spin * dt * sp;
      d.dropK = approach(d.dropK || 0, d.on ? 0 : 1, 7, dt);
      rot.rot = d.theta;
      const ex = d.exag;
      rot.dpos.copy(B((d.x * ex) + d.dropK * 1.2, d.y * ex, -d.dropK * 11.5));
      for (let k = 0; k < 6; k++) {
        const c = P(`P2_Coil${k}`);
        const cur = d.on ? Math.cos(d.theta - k * Math.PI / 3) : 0;
        for (const m of c.meshes) {
          const mt = m.material;
          mt.emissive.set(cur > 0 ? '#ff5a3c' : '#3c8cff');
          mt.emissiveIntensity = Math.abs(cur) * .9;
        }
      }
      const fm = this.flow('main'), fc = this.flow('circ');
      if (fm && fm.pump === 'P2') fm.rate = sp * d.flow * (d.spin / (2 * Math.PI * d.rpm / 60 || 1));
      if (fc && fc.pump === 'P2') fc.rate = sp * (d.spin / (2 * Math.PI * d.rpm / 60 || 1));
    }
    // P3 波纹管泵
    if (vis('P3')) {
      const d = D.P3, M = this.spec.pumps.P3.motion;
      if (d.hold === null) d.psi += d.cpm / 60 * dt * sp;
      else d.psi = approach(d.psi, d.hold, 4, dt);
      const st = stroke(d.psi);
      const s = st.s * M.stroke;
      d.st = st;
      P('P3_BellowsL').scl.set((M.L - s) / M.L, 1, 1);
      P('P3_BellowsR').scl.set((M.L + s) / M.L, 1, 1);
      for (const n of ['P3_PlateL', 'P3_PlateR', 'P3_Shaft']) P(n).dpos.copy(B(s, 0, 0));
      const moving = d.hold === null ? (st.switching ? 0 : 1) : 0;
      const leftOut = st.dir > 0;      // 连杆往 +X 走 = 左边被压扁、往外挤
      this._ball('P3_BallOutL', leftOut ? moving : 0, M.ballLift, dt);
      this._ball('P3_BallInL', !leftOut ? moving : 0, M.ballLift, dt);
      this._ball('P3_BallOutR', !leftOut ? moving : 0, M.ballLift, dt);
      this._ball('P3_BallInR', leftOut ? moving : 0, M.ballLift, dt);
      const q = moving * st.sp / 4;
      const amp = d.damper ? .06 : .0;
      d.dp = approach(d.dp || 0, (q - 1) * amp, 3, dt);
      P('P3_DBellows').scl.set(1, 1, 1 + d.dp * 2.2);
      P('P3_DTop').dpos.copy(B(0, 0, 84 * d.dp * 2.2));
      const set = (k, on) => { const f = this.flow(k); if (f) { f.target = on ? 1 : 0; f.rate = sp * (d.hold === null ? .4 + .6 * q : 0); } };
      set('dischL', leftOut && moving); set('suctR', leftOut && moving); set('airL', leftOut); set('exhR', leftOut);
      set('dischR', !leftOut && moving); set('suctL', !leftOut && moving); set('airR', !leftOut); set('exhL', !leftOut);
    }
    // P4 气动隔膜泵
    if (vis('P4')) {
      const d = D.P4, M = this.spec.pumps.P4.motion;
      if (d.hold === null) d.psi += d.cpm / 60 * dt * sp * (1 - d.stall);
      else d.psi = approach(d.psi, d.hold, 4, dt);
      const st = stroke(d.psi);
      const s = st.s * M.stroke;
      d.st = st;
      P('P4_Shaft').dpos.copy(B(s, 0, 0));
      for (const n of ['P4_DiaphragmL', 'P4_DiaphragmR']) {
        const pt = P(n); pt.morph.pos = Math.max(0, s) / M.dmax; pt.morph.neg = Math.max(0, -s) / M.dmax;
      }
      // 阀芯：每次换向时整段滑过去（st.dir<0 时空气送左边，阀芯在右）
      d.spool = approach(d.spool || 0, st.dir < 0 ? 1 : -1, 14, dt);
      P('P4_Spool').dpos.copy(B(d.spool * M.spool, 0, 0));
      const moving = (d.hold === null ? (st.switching ? 0 : 1) : 0) * (1 - d.stall);
      const leftOut = st.dir < 0;      // 连杆往 −X 走 = 左隔膜被空气推向外、左液室往外挤
      this._ball('P4_BallOutL', leftOut ? moving : 0, M.ballLift, dt);
      this._ball('P4_BallInL', !leftOut ? moving : 0, M.ballLift, dt);
      this._ball('P4_BallOutR', !leftOut ? moving : 0, M.ballLift, dt);
      this._ball('P4_BallInR', leftOut ? moving : 0, M.ballLift, dt);
      const q = moving * st.sp / 4;
      const set = (k, on) => { const f = this.flow(k); if (f) { f.target = on ? 1 : 0; f.rate = sp * (d.hold === null ? .4 + .6 * q : 0); } };
      set('dischL', leftOut && moving); set('suctR', leftOut && moving); set('airL', leftOut && d.stall < 1); set('exhR', leftOut && moving);
      set('dischR', !leftOut && moving); set('suctL', !leftOut && moving); set('airR', !leftOut && d.stall < 1); set('exhL', !leftOut && moving);
    }
    // P5 电磁计量泵：一个周期 = 快速前推（排出）→ 弹簧拉回（吸入）→ 停一下
    if (vis('P5')) {
      const d = D.P5, M = this.spec.pumps.P5.motion;
      d.psi = (d.psi + d.spm / 60 * dt * sp) % 1;
      const ph = d.psi;
      let prof, phase;
      if (ph < .22) { prof = easeIO(ph / .22); phase = 'out'; }
      else if (ph < .62) { prof = 1 - easeIO((ph - .22) / .4); phase = 'in'; }
      else { prof = 0; phase = 'rest'; }
      d.phase = phase;
      const rest = (1 - d.L) * M.stroke;
      const x = rest + d.L * M.stroke * prof;
      d.x = x;
      P('P5_Armature').dpos.copy(B(x, 0, 0));
      P('P5_Spring').scl.set((M.springL - x) / M.springL, 1, 1);
      P('P5_Stop').dpos.copy(B(rest, 0, 0));
      const dd = x - M.mid;
      const dph = P('P5_Diaphragm'); dph.morph.pos = Math.max(0, dd) / M.dmax; dph.morph.neg = Math.max(0, -dd) / M.dmax;
      const go = d.locked ? 0 : 1;
      for (const n of ['P5_BallOut0', 'P5_BallOut1']) this._ball(n, phase === 'out' ? go : 0, M.ballLift, dt, 18);
      for (const n of ['P5_BallIn0', 'P5_BallIn1']) this._ball(n, phase === 'in' ? go : 0, M.ballLift, dt, 18);
      const coil = P('P5_Coil');
      for (const m of coil.meshes) { m.material.emissive.set('#ff7a3c'); m.material.emissiveIntensity = phase === 'out' && prof < .95 ? .9 : approach(m.material.emissiveIntensity, 0, 10, dt); }
      const set = (k, on) => { const f = this.flow(k); if (f) { f.target = on ? 1 : 0; f.rate = sp * (on ? 1 : .2); } };
      set('disch', phase === 'out' && go); set('suct', phase === 'in' && go);
      // 泵头液室顶上的气泡
      const g = d.gas;
      this.bubble.visible = g > 0.02 && this.pump === 'P5';
      if (this.bubble.visible) {
        const r = 2.5 + 9 * Math.sqrt(g);
        const squeeze = 1 - .25 * prof * d.L;
        this.bubble.scale.setScalar(r * MM * squeeze);
        this.bubble.position.copy(Bv([this.spec.offset.P5[0] + 90.5, this.spec.offset.P5[1], this.spec.offset.P5[2] + 125 + 22 - r * .3]));
      }
    }
  }

  _ball(name, open, lift, dt, rate = 10) {
    const p = this.parts.get(name);
    p._o = approach(p._o || 0, open, rate, dt);
    p.dpos.copy(B(0, 0, p._o * lift));
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
    // 剖切面：从镜头那边滑进来
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
    this._drive(dt);
    const ek = easeIO(this.explodeK);
    if (this.hlT > 0) this.hlT -= dt;
    for (const p of this.parts.values()) {
      if (!p.obj.visible) continue;
      p.obj.position.copy(p.base).addScaledVector(p.ex, ek).add(p.dpos);
      if (p.axis) p.obj.quaternion.setFromAxisAngle(p.axis, p.rot);
      p.obj.scale.copy(p.scl);
      if (p.morphMesh) {
        const md = p.morphMesh.morphTargetDictionary, mi = p.morphMesh.morphTargetInfluences;
        if (md.pos !== undefined) mi[md.pos] = p.morph.pos;
        if (md.neg !== undefined) mi[md.neg] = p.morph.neg;
      }
      const useGhost = p.ghostable && this.ghostK > .02;
      const hl = this.highlight === p.name && this.hlT > 0 ? .5 + .5 * Math.sin(this.hlT * 9) : 0;
      for (const m of p.meshes) {
        if (useGhost) { m.material = m.userData.ghost; m.material.uniforms.uA.value = .55 * this.ghostK; m.renderOrder = 3; }
        else { m.material = m.userData.solid; m.renderOrder = 0; }
        if (p.coil === undefined && p.name !== 'P5_Coil') {
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
