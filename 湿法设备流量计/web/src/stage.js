// 三维舞台：加载 GLB，一次只显示一个模型。每种流量计有自己的一套动画：
// 液体粒子、超声波脉冲、卡门涡、叶轮、浮子、毛细管温度分布、U 管振动、磁场和离子。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as P from './physics.js';

const V = (x, y, z) => new THREE.Vector3(x, z, -y);      // Blender 坐标 → three
const Va = (a) => V(a[0], a[1], a[2]);
const ease = (t) => t * t * (3 - 2 * t);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// 三维视图里滑块 0–100% 对应的流量（满量程）
export const RANGES = {
  us: [5, 'L/min'], usc: [8, 'L/min'], vor: [20, 'L/min'], pad: [4, 'L/min'], flt: [3.5, 'L/min'],
  dp: [2, 'L/min'], thm: [10, 'SLM'], cor: [1500, 'g/min'], mag: [60, 'L/min'], bench: [1, ''],
};

const fmt = (x, n = 2) => (Math.abs(x) < 1e-12 ? '0' : x.toFixed(n));

/** 三维视图右上角的实时读数：和下面实验用的是同一套物理。 */
export function liveValues(root, u, spec) {
  const w = P.fluid('diw', 25);
  const [fs] = RANGES[root];
  const Q = u * fs * P.LPM;
  switch (root) {
    case 'us': { const r = P.usInline({ Q, f: w }); return [['流量', `${fmt(u * fs)} L/min`], ['顺流传播时间', `${fmt(r.tDown * 1e6, 3)} µs`], ['逆流比顺流慢', `${fmt(r.dt * 1e9, 1)} ns`]]; }
    case 'usc': { const r = P.usClamp({ Q, f: w }); return [['流量', `${fmt(u * fs)} L/min`], ['雷诺数', fmt(r.Re, 0)], ['时间差', `${fmt(r.dt * 1e9, 2)} ns`]]; }
    case 'vor': { const r = P.vortex({ Q, f: w }); return [['流量', `${fmt(u * fs, 1)} L/min`], ['旋涡频率', r.regular > 0.05 ? `${fmt(r.fv, 1)} Hz` : '太慢，涡街不成形'], ['雷诺数', fmt(r.ReD, 0)]]; }
    case 'pad': { const r = P.paddle({ Q, f: w }); return [['流量', `${fmt(u * fs)} L/min`], ['叶轮转速', r.stalled ? '没转起来' : `${fmt(r.rpm, 0)} rpm`], ['霍尔脉冲', `${fmt(r.hz, 1)} Hz`]]; }
    case 'flt': { const r = P.floatMeter({ Q, f: w, geo: spec.SPEC.flt }); return [['流量', `${fmt(u * fs)} L/min`], ['浮子上沿高度', `${fmt((r.z - spec.SPEC.flt.zrest) * 1000, 1)} mm`], ['状态', r.pegged ? '顶到头了' : r.z <= spec.SPEC.flt.zrest + 1e-5 ? '还没浮起来' : '悬着']]; }
    case 'dp': { const r = P.dpMeter({ Q, f: w }); return [['流量', `${fmt(u * fs)} L/min`], ['孔里流速', `${fmt(r.vo, 2)} m/s`], ['前后压差', `${fmt(r.dp / 1000, 2)} kPa`]]; }
    case 'thm': { const r = P.mfc({ frac: u }); return [['N₂ 流量', `${fmt(u * fs, 2)} SLM`], ['上游绕组', `${fmt(r.Tu / 0.0323 * 100, 1)} %`], ['下游 − 上游', `${fmt(r.dT / 0.0323 * 100, 2)} %`]]; }
    case 'cor': { const r = P.coriolis({ mdot: u * fs / 60000, rho: 997 }); return [['质量流量', `${fmt(u * fs, 0)} g/min`], ['振动频率', `${fmt(r.freq, 1)} Hz`], ['两侧时间差', `${fmt(r.dt * 1e6, 2)} µs`]]; }
    case 'mag': { const r = P.magMeter({ Q, sigma: 5000 }); return [['流量（导电药液）', `${fmt(u * fs, 0)} L/min`], ['平均流速', `${fmt(r.v, 2)} m/s`], ['电极电压', `${fmt(r.E * 1e6, 0)} µV`]]; }
    default: return [];
  }
}

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createStage({ canvas, glb, spec, pinsEl, onPin, onValues }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#141B20');
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const cam = new THREE.PerspectiveCamera(30, 1.6, 0.002, 60);
  const ctl = new OrbitControls(cam, canvas);
  ctl.enableDamping = true;
  ctl.dampingFactor = 0.08;
  canvas.style.touchAction = 'pan-y';
  scene.add(new THREE.HemisphereLight('#E4EEF3', '#3A4248', 1.2));
  const key = new THREE.DirectionalLight('#FFFFFF', 1.9);
  key.position.set(-2, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#BFD9FF', 0.7);
  rim.position.set(3, 2, -4);
  scene.add(rim);

  const state = { root: 'bench', u: 0.5, t: 0, fly: null, particles: true, labels: true, ready: false, playing: true };
  const groups = {};
  const parts = {};            // parts[root][partName] = [mesh...]
  const U = { corT: { value: 0 }, corA: { value: 0 }, corB: { value: 0 } };

  // ---------- 材质微调 ----------
  const seen = new Map();
  function tune(m) {
    const n = m.name;
    if (n === 'screen') return new THREE.MeshBasicMaterial({ color: '#19C4C9', name: n });
    if (n === 'led_g' || n === 'led_a') return new THREE.MeshBasicMaterial({ color: n === 'led_g' ? '#5CFF9D' : '#FFB23E', name: n });
    if (n === 'pfa_clear' || n === 'quartz' || n === 'water' || n === 'sapphire') {
      m.transparent = true; m.depthWrite = false;
      m.opacity = { pfa_clear: 0.32, quartz: 0.16, water: 0.30, sapphire: 0.75 }[n];
      m.side = THREE.DoubleSide;
    }
    if (n === 'pipe') { m.transparent = true; m.opacity = 0.42; m.depthWrite = false; }
    return m;
  }

  // ---------- 粒子贴图、脉冲贴图、旋涡贴图 ----------
  const dotTex = canvasTex(64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  const pulseTex = canvasTex(128, (g, s) => {
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = `rgba(255,255,255,${1 - i * 0.22})`; g.lineWidth = 7 - i;
      g.beginPath(); g.arc(s * (0.18 + i * 0.15), s / 2, s * 0.42, -0.9, 0.9); g.stroke();
    }
  });
  const swirlTex = canvasTex(128, (g, s) => {
    g.translate(s / 2, s / 2);
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      for (let a = 0; a < 4.2 * Math.PI; a += 0.08) {
        const r = 4 + a * 3.7;
        const x = Math.cos(a + k * Math.PI) * r, y = Math.sin(a + k * Math.PI) * r;
        a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 4; g.stroke();
    }
  });

  // ---------- 液体粒子 ----------
  const FLUID_COL = { diw: '#5BB8FF', chem: '#FFC04D', ret: '#9FB0BD', n2: '#6BE39A', cds: '#FF8A5C' };
  const flows = {};
  function buildFlow(root) {
    const raw = spec.PATHS[root];
    if (!raw) return;
    const bench = root === 'bench';
    const paths = raw.map((p) => {
      const pts = (bench ? p.pts : p).map((q) => ({ p: Va(q), r: bench ? 0 : q[3] }));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].p.distanceTo(pts[i - 1].p));
      return { pts, cum, L: cum[cum.length - 1], col: new THREE.Color(bench ? FLUID_COL[p.fluid] : '#62C3FF'), rate: bench ? p.rate : 1, r0: bench ? 0 : pts[0].r };
    });
    const per = bench ? 34 : root === 'thm' ? 0 : 260;
    const list = [];
    paths.forEach((pa, pi) => {
      let n = bench ? Math.round(per * pa.L) : per;
      if (root === 'thm') n = pi === 0 ? 220 : 26;
      if (root === 'cor') n = 200;
      for (let i = 0; i < n; i++) {
        let a, b;
        do { a = Math.random(); b = Math.random() * 2 - 1; } while (a * a + b * b > 1);
        list.push({ pi, s: Math.random() * pa.L, a, b, k: 1 - (a * a + b * b) });
      }
    });
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3);
    list.forEach((q, i) => { const c = paths[q.pi].col; col.set([c.r, c.g, c.b], i * 3); });
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: bench ? 0.016 : 0.0011, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    groups[root].add(pts);
    flows[root] = { paths, list, pts, pos };
  }
  const tmpA = new THREE.Vector3(), tmpT = new THREE.Vector3(), tmpE = new THREE.Vector3();
  const DEPTH = new THREE.Vector3(0, 0, -1);                 // Blender +Y（剖切面后方）
  function sample(pa, s, out, tan) {
    let i = 1;
    while (i < pa.cum.length - 1 && pa.cum[i] < s) i++;
    const a = pa.pts[i - 1], b = pa.pts[i];
    const seg = pa.cum[i] - pa.cum[i - 1] || 1e-9;
    const f = clamp((s - pa.cum[i - 1]) / seg, 0, 1);
    out.copy(a.p).lerp(b.p, f);
    tan.copy(b.p).sub(a.p).normalize();
    return a.r + (b.r - a.r) * f;
  }
  function stepFlow(root, dt, speed, disp) {
    const F = flows[root];
    if (!F) return;
    F.pts.visible = state.particles && speed > 1e-4;
    if (!F.pts.visible) return;
    const bench = root === 'bench';
    F.list.forEach((q, i) => {
      const pa = F.paths[q.pi];
      const r = sample(pa, q.s, tmpA, tmpT);
      const area = bench || !r ? 1 : (pa.r0 / r) ** 2;
      const v = speed * pa.rate * (bench ? 1 : 0.35 + 1.3 * q.k) * Math.min(area, 6);
      q.s += v * dt;
      if (q.s > pa.L) q.s -= pa.L;
      if (bench) {
        tmpE.set(q.b, q.a - 0.5, 0).multiplyScalar(0.006);
        tmpA.add(tmpE);
      } else {
        tmpE.crossVectors(tmpT, DEPTH).normalize();
        const rr = r * 0.82;
        tmpA.addScaledVector(DEPTH, q.a * rr).addScaledVector(tmpE, q.b * rr);
        if (disp) disp(tmpA);
      }
      F.pos[i * 3] = tmpA.x; F.pos[i * 3 + 1] = tmpA.y; F.pos[i * 3 + 2] = tmpA.z;
    });
    F.pts.geometry.attributes.position.needsUpdate = true;
  }

  // ---------- 各模型专用的动画对象 ----------
  const fx = {};
  function spriteMesh(tex, color, w, h) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = 3;
    return m;
  }
  function glowClone(root, name, color) {
    const list = [];
    for (const [k, arr] of Object.entries(parts[root] || {})) {
      if (!k.startsWith(name)) continue;
      for (const o of arr) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(color);
        o.material.emissiveIntensity = 0;
        list.push(o);
      }
    }
    return list;
  }
  const setGlow = (list, x) => list.forEach((o) => { o.material.emissiveIntensity = x; });

  function setupFx() {
    const S = spec.SPEC;
    // 超声波：两只换能器同时发，顺流（橙）和逆流（青）两个脉冲对穿
    {
      const g = groups.us;
      const a = Va(S.us.a), b = Va(S.us.b);
      const pd = spriteMesh(pulseTex, '#FFB04A', 0.012, 0.01), pu = spriteMesh(pulseTex, '#55E0FF', 0.012, 0.01);
      pu.rotation.z = Math.PI;
      pd.position.z = pu.position.z = -0.0006;
      g.add(pd, pu);
      fx.us = { a, b, pd, pu, ga: glowClone('us', 'us_pzt_a', '#FFB04A'), gb: glowClone('us', 'us_pzt_b', '#55E0FF') };
    }
    {
      const g = groups.usc;
      const p1 = Va(S.usc.p1), rf = Va(S.usc.refl), p2 = Va(S.usc.p2);
      const pd = spriteMesh(pulseTex, '#FFB04A', 0.006, 0.006), pu = spriteMesh(pulseTex, '#55E0FF', 0.006, 0.006);
      pd.position.z = pu.position.z = -0.0006;
      g.add(pd, pu);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, rf, p2].map((p) => p.clone().setZ(-0.0004))),
        new THREE.LineDashedMaterial({ color: '#9FE7FF', dashSize: 0.0015, gapSize: 0.001, transparent: true, opacity: 0.6 }));
      line.computeLineDistances();
      g.add(line);
      fx.usc = { p1, rf, p2, pd, pu, ga: glowClone('usc', 'usc_pzt_a', '#FFB04A'), gb: glowClone('usc', 'usc_pzt_b', '#55E0FF') };
    }
    // 卡门涡街：发生体后缘上下交替甩出旋涡
    {
      const g = groups.vor;
      const pool = [];
      for (let i = 0; i < 18; i++) {
        const m = spriteMesh(swirlTex, '#8FE0FF', 0.0085, 0.0085);
        m.visible = false;
        m.position.z = -0.0005;
        g.add(m);
        pool.push({ m, x: 0, z: 0, age: 9, side: 1 });
      }
      fx.vor = { pool, next: 0, clock: 0, side: 1, probe: glowClone('vor', 'vor_pzt', '#FF8A3D'), hit: 0 };
    }
    // 叶轮：转子 + 磁铁绕 Blender Y 轴转
    {
      const piv = new THREE.Group();
      groups.pad.add(piv);
      for (const k of ['pad_rotor', 'pad_magnet_0', 'pad_magnet_3']) (parts.pad[k] || []).forEach((o) => piv.add(o));
      fx.pad = { piv, ang: 0, hall: glowClone('pad', 'pad_hall', '#FF5A5A') };
    }
    // 浮子
    fx.flt = { objs: [...(parts.flt.flt_float || []), ...(parts.flt.flt_float_edge || [])], z: S.flt.zrest, bob: 0 };
    // 差压：两只隔膜按压力发光
    fx.dp = { a: glowClone('dp', 'dp_diaphragm_a', '#FF7A3A'), b: glowClone('dp', 'dp_diaphragm_b', '#FF7A3A') };
    // 热式：毛细管里的温度分布贴图
    {
      const N = 128;
      const data = new Uint8Array(N * 4);
      const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
      tex.magFilter = tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      const heat = parts.thm.thm_heat || [];
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: tex } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
        fragmentShader: 'uniform sampler2D uTex; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(uTex, vec2(vUv.x, .5)).rgb, 1.); }',
      });
      heat.forEach((o) => { o.material = mat; });
      fx.thm = { data, tex, N, last: -1, wu: glowClone('thm', 'thm_winding_u', '#FF6A2A'), wd: glowClone('thm', 'thm_winding_d', '#FF6A2A') };
    }
    // 科里奥利：U 管在顶点着色器里振动
    {
      const sides = { A: 1, B: -1 };
      for (const [k, arr] of Object.entries(parts.cor)) {
        let sgn = 0;
        if (k.startsWith('cor_tubeA') || k.startsWith('cor_nodeA') || /coilA$/.test(k)) sgn = sides.A;
        if (k.startsWith('cor_tubeB') || k.startsWith('cor_nodeB') || /magB$/.test(k)) sgn = sides.B;
        if (!sgn) continue;
        arr.forEach((o) => {
          const m = o.material.clone();
          m.onBeforeCompile = (sh) => {
            sh.uniforms.uT = U.corT; sh.uniforms.uA = U.corA; sh.uniforms.uB = U.corB; sh.uniforms.uS = { value: sgn };
            sh.vertexShader = 'uniform float uT, uA, uB, uS;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
              float sd = clamp((-0.0125 - transformed.y) / 0.0835, 0.0, 1.0);
              transformed.z += uS * sd * sd * (uA * sin(uT) + uB * (transformed.x / 0.024) * cos(uT));`);
          };
          o.material = m;
        });
      }
    }
    // 电磁：上下线圈之间的磁力线 + 液体里的正负离子
    {
      const g = groups.mag;
      const lines = new THREE.Group();
      const mat = new THREE.LineBasicMaterial({ color: '#C79BFF', transparent: true, opacity: 0.85 });
      const heads = [];
      for (const x of [-0.02, -0.01, 0, 0.01, 0.02]) for (const y of [-0.005, 0.004]) {
        const p0 = V(x, y, -0.0115), p1 = V(x, y, 0.0115);
        lines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p0, p1]), mat));
        const h = new THREE.Mesh(new THREE.ConeGeometry(0.0011, 0.0028, 10), new THREE.MeshBasicMaterial({ color: '#C79BFF' }));
        h.position.copy(V(x, y, 0.004));
        lines.add(h); heads.push(h);
      }
      g.add(lines);
      const n = 260;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const ions = [];
      for (let i = 0; i < n; i++) {
        let a, b;
        do { a = Math.random() * 2 - 1; b = Math.random() * 2 - 1; } while (a * a + b * b > 1);
        const q = i % 2 ? 1 : -1;
        ions.push({ x: Math.random() * 0.13 - 0.065, a, b, q });
        const c = new THREE.Color(q > 0 ? '#FF6B6B' : '#5FA8FF');
        col.set([c.r, c.g, c.b], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.0016, map: dotTex, vertexColors: true, transparent: true, depthWrite: false }));
      pts.frustumCulled = false;
      g.add(pts);
      fx.mag = { lines, heads, ions, pts, pos, ea: glowClone('mag', 'mag_electrode_a', '#FF6B6B'), eb: glowClone('mag', 'mag_electrode_b', '#5FA8FF') };
    }
  }

  // ---------- 加载 ----------
  const ready = new Promise((resolve, reject) => {
    new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', (g) => {
      for (const r of Object.keys(spec.ROOT_POS)) {
        const root = g.scene.getObjectByName('ROOT_' + r);
        root.position.set(0, 0, 0);
        groups[r] = root;
        parts[r] = {};
        root.visible = r === state.root;
      }
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (!seen.has(o.material)) seen.set(o.material, tune(o.material));
        o.material = seen.get(o.material);
        const nm = o.name.split('__')[0];
        let r = o.parent;
        while (r && !r.name.startsWith('ROOT_')) r = r.parent;
        if (!r) return;
        (parts[r.name.slice(5)][nm] ||= []).push(o);
      });
      scene.add(g.scene);
      for (const r of Object.keys(groups)) buildFlow(r);
      setupFx();
      buildPins();
      state.ready = true;
      setView(state.root, true);
      resolve();
    }, reject);
  });

  // ---------- 标注 ----------
  function buildPins() {
    pinsEl.innerHTML = '';
    state.pins = [];
    for (const [root, list] of Object.entries(spec.PINS)) {
      list.forEach(([id, label, p], i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pin';
        b.innerHTML = `<b>${root === 'bench' ? '' : i + 1}</b><span>${label}</span>`;
        b.setAttribute('aria-label', label);
        b.addEventListener('click', () => onPin && onPin(root, id));
        pinsEl.appendChild(b);
        state.pins.push({ root, id, el: b, p: Va(p) });
      });
    }
  }
  const pv = new THREE.Vector3();
  function placePins() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const pin of state.pins) {
      const on = pin.root === state.root && state.labels && !state.fly;
      pin.el.style.display = on ? '' : 'none';
      if (!on) continue;
      pv.copy(pin.p);
      if (pin.root === 'flt' && pin.id === 'float' && fx.flt) pv.y += fx.flt.dy || 0;   // 标签跟着浮子走
      pv.project(cam);
      if (pv.z > 1) { pin.el.style.display = 'none'; continue; }
      pin.el.style.transform = `translate(${((pv.x + 1) / 2 * w).toFixed(1)}px, ${((1 - pv.y) / 2 * h).toFixed(1)}px)`;
    }
  }

  // ---------- 机位 ----------
  function viewPose(root) {
    const v = spec.VIEWS[root];
    const tgt = Va(v.target);
    const dir = Va(v.dir).normalize();
    const asp = cam.aspect;
    const k = asp < 1.25 ? Math.min(2.1, 1.25 / asp * 1.05) : 1;
    return { tgt, pos: tgt.clone().addScaledVector(dir, v.dist * k), dist: v.dist * k };
  }
  function setView(root, instant = false) {
    state.root = root;
    for (const [r, g] of Object.entries(groups)) g.visible = r === root;
    if (!state.ready) return;
    const pose = viewPose(root);
    cam.near = pose.dist * 0.01;
    cam.far = pose.dist * 30;
    cam.updateProjectionMatrix();
    ctl.minDistance = pose.dist * 0.2;
    ctl.maxDistance = pose.dist * 3;
    if (instant) { cam.position.copy(pose.pos); ctl.target.copy(pose.tgt); ctl.update(); return; }
    state.fly = { t: 0, p0: cam.position.clone(), t0: ctl.target.clone(), p1: pose.pos, t1: pose.tgt };
  }

  // ---------- 每帧 ----------
  let lastVals = 0;
  function animate(dt) {
    const S = spec.SPEC;
    const u = state.u;
    const r = state.root;
    const base = { bench: 0.22, us: 0.05, usc: 0.05, vor: 0.06, pad: 0.05, flt: 0.06, dp: 0.04, thm: 0.05, cor: 0.07, mag: 0.06 }[r] || 0.05;
    let disp = null;
    if (r === 'us') {
      const F = fx.us;
      const T = 1.4, ph = (state.t % T) / T;
      const L = F.b.x - F.a.x;
      const k = 0.4 * u;                               // 把顺逆流的速度差放大到看得见
      const xd = F.a.x + L * clamp(ph / 0.7 * (1 + k), 0, 1);
      const xu = F.b.x - L * clamp(ph / 0.7 * (1 - k), 0, 1);
      F.pd.position.x = xd; F.pu.position.x = xu;
      F.pd.visible = ph * (1 + k) < 0.7; F.pu.visible = ph * (1 - k) < 0.7;
      const flash = (x) => Math.max(0, 1 - x / 0.06);
      setGlow(F.ga, 3 * (flash(ph) + flash(Math.abs(ph - 0.7 / (1 - k)))));
      setGlow(F.gb, 3 * (flash(ph) + flash(Math.abs(ph - 0.7 / (1 + k)))));
    }
    if (r === 'usc') {
      const F = fx.usc;
      const T = 1.6, ph = (state.t % T) / T;
      const k = 0.4 * u;
      const along = (q, rev) => {
        const pts = rev ? [F.p2, F.rf, F.p1] : [F.p1, F.rf, F.p2];
        const s = clamp(q, 0, 1) * 2;
        const i = s < 1 ? 0 : 1;
        return pts[i].clone().lerp(pts[i + 1], s - i);
      };
      const qd = ph / 0.7 * (1 + k), qu = ph / 0.7 * (1 - k);
      F.pd.position.copy(along(qd, false)).setZ(-0.0006); F.pu.position.copy(along(qu, true)).setZ(-0.0006);
      F.pd.visible = qd < 1; F.pu.visible = qu < 1;
      const dirAt = (q, rev) => { const a = along(q, rev), b = along(q + 0.01, rev); return Math.atan2(b.y - a.y, b.x - a.x); };
      F.pd.rotation.z = dirAt(qd, false); F.pu.rotation.z = dirAt(qu, true);
      const flash = (x) => Math.max(0, 1 - x / 0.06);
      setGlow(F.ga, 3 * (flash(ph) + flash(Math.abs(ph - 0.7 / (1 - k)))));
      setGlow(F.gb, 3 * (flash(ph) + flash(Math.abs(ph - 0.7 / (1 + k)))));
    }
    if (r === 'vor') {
      const F = fx.vor, s = S.vor;
      const fvis = u > 0.07 ? 1.0 + 5 * u : 0;
      const vx = base * u * 1.6;
      if (fvis > 0) {
        F.clock += dt * fvis * 2;
        while (F.clock > 1) {
          F.clock -= 1;
          const q = F.pool[F.next++ % F.pool.length];
          F.side = -F.side;
          Object.assign(q, { x: s.xs + 0.0035, z: F.side * s.d * 0.45, age: 0, side: F.side });
        }
      }
      for (const q of F.pool) {
        q.age += dt;
        q.x += vx * dt;
        q.z += (q.side * 0.0027 - q.z) * dt * 1.2;
        const on = q.age < 6 && q.x < 0.05 && fvis > 0;
        q.m.visible = on && state.particles;
        if (!on) continue;
        const sc = 0.55 + Math.min(1.0, q.age * 0.45);
        q.m.scale.setScalar(sc);
        q.m.position.set(q.x, q.z, -0.0005);
        q.m.rotation.z -= q.side * dt * 6 * (0.3 + u);
        q.m.material.opacity = clamp(1.15 - q.age / 5, 0, 1);
        if (q.side > 0 && Math.abs(q.x - s.xsen) < 0.0015) F.hit = 1;
      }
      F.hit = Math.max(0, F.hit - dt * 3);
      setGlow(F.probe, 2.5 * F.hit);
    }
    if (r === 'pad') {
      const F = fx.pad;
      const pr = P.paddle({ Q: u * RANGES.pad[0] * P.LPM, f: P.FLUIDS.diw });
      F.ang += pr.rps * 2 * Math.PI * dt * 0.25;          // 放慢 4 倍，不然看着像不动（频闪）
      F.piv.rotation.z = F.ang;
      const near = Math.cos(F.ang) > 0.96 || Math.cos(F.ang + Math.PI) > 0.96;   // 磁铁转到正上方
      setGlow(F.hall, near && !pr.stalled ? 3 : 0);
    }
    if (r === 'flt') {
      const F = fx.flt, s = S.flt;
      const fr = P.floatMeter({ Q: u * RANGES.flt[0] * P.LPM, f: P.fluid('diw', 20), geo: s });
      F.z += (fr.z - F.z) * Math.min(1, dt * 3);
      F.bob += dt;
      const lift = F.z > s.zrest + 1e-4 ? 0.0004 * Math.sin(F.bob * 9) : 0;
      F.objs.forEach((o) => { o.position.y = F.z - s.zrest + lift; });
      F.dy = F.z - s.zrest;
    }
    if (r === 'dp') {
      const d = P.dpMeter({ Q: u * RANGES.dp[0] * P.LPM, f: P.FLUIDS.diw });
      const k = d.dp / 60000;
      setGlow(fx.dp.a, 0.4 + 2.2 * k); setGlow(fx.dp.b, 0.4);
    }
    if (r === 'thm') {
      const F = fx.thm;
      const key = Math.round(u * 200);
      if (key !== F.last) {
        F.last = key;
        const res = P.capillaryT(u * P.MFC.PeFS);
        const T0 = 0.0345;
        for (let i = 0; i < F.N; i++) {
          const s = 0.0769 + (0.9231 - 0.0769) * i / (F.N - 1);
          const j = clamp(Math.round(s * (res.T.length + 1)) - 1, 0, res.T.length - 1);
          const x = clamp(res.T[j] / T0, 0, 1);
          const c = new THREE.Color().setHSL(0.62 - 0.62 * x, 0.9, 0.35 + 0.3 * x);
          F.data.set([c.r * 255, c.g * 255, c.b * 255, 255], i * 4);
        }
        F.tex.needsUpdate = true;
        setGlow(F.wu, 2.6 * res.Tu / T0); setGlow(F.wd, 2.6 * res.Td / T0);
      }
    }
    if (r === 'cor') {
      U.corT.value += dt * 2 * Math.PI * 1.6;
      U.corA.value = 0.0016;
      U.corB.value = 0.0011 * u;
      const tA = U.corT.value, A = U.corA.value, B = U.corB.value;
      disp = (p) => {
        const sd = clamp((-0.0125 - p.y) / 0.0835, 0, 1);
        const sgn = p.z > 0 ? 1 : -1;                       // three 里 z>0 是 A 管
        p.z += sgn * sd * sd * (A * Math.sin(tA) + B * (p.x / 0.024) * Math.cos(tA));
      };
    }
    if (r === 'mag') {
      const F = fx.mag;
      const per = 2.4, ph = (state.t % per) / per;
      const dir = ph < 0.5 ? 1 : -1;                         // 方波励磁，磁场方向周期翻转
      F.heads.forEach((h) => { h.rotation.z = dir > 0 ? 0 : Math.PI; });
      const drift = clamp(u * 1.4, 0, 1);
      const vx = base * u * 1.5;
      const R = S.mag.Ri * 0.9;
      F.ions.forEach((q, i) => {
        q.x += vx * dt * (0.4 + 0.9 * (1 - q.a * q.a - q.b * q.b));
        if (q.x > 0.065) q.x -= 0.13;
        // 正离子往 Blender −Y（前电极）偏，负离子往 +Y；磁场翻转时反过来
        const ty = -q.q * dir * 0.92;
        const yy = q.a + (ty - q.a) * drift * 0.75;
        const lim = Math.sqrt(Math.max(0, 1 - yy * yy));
        const p = V(q.x, yy * R, clamp(q.b, -lim, lim) * R);
        F.pos[i * 3] = p.x; F.pos[i * 3 + 1] = p.y; F.pos[i * 3 + 2] = p.z;
      });
      F.pts.geometry.attributes.position.needsUpdate = true;
      F.pts.visible = state.particles;
      setGlow(dir > 0 ? F.ea : F.eb, 0.3 + 2.5 * u); setGlow(dir > 0 ? F.eb : F.ea, 0.3 + 2.5 * u);
      F.ea.forEach((o) => o.material.emissive.set(dir > 0 ? '#FF6B6B' : '#5FA8FF'));
      F.eb.forEach((o) => o.material.emissive.set(dir > 0 ? '#5FA8FF' : '#FF6B6B'));
    }
    const sp = r === 'bench' ? base : base * u;
    if (r !== 'mag') stepFlow(r, dt, sp, disp);
    if (onValues && state.t - lastVals > 0.25) { lastVals = state.t; onValues(r, liveValues(r, u, spec)); }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.ready) {
      if (state.fly) {
        const F = state.fly;
        F.t = Math.min(1, F.t + dt / 0.9);
        const k = ease(F.t);
        cam.position.copy(F.p0).lerp(F.p1, k);
        ctl.target.copy(F.t0).lerp(F.t1, k);
        if (F.t >= 1) state.fly = null;
      }
      if (state.playing) { state.t += dt; animate(dt); }
      ctl.update();
      renderer.render(scene, cam);
      placePins();
    }
    requestAnimationFrame(frame);
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  requestAnimationFrame(frame);

  return {
    ready, state, setView,
    setFlow(u) { state.u = u; },
    setOpt(o) { Object.assign(state, o); },
    resetView() { setView(state.root); },
  };
}
