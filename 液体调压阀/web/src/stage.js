// 三维舞台：加载 GLB，切换五个模型，剖切/外观，阀芯动作，液体按压力着色，流动粒子，标注
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { partInfo } from './data.js';

const V = (x, y, z) => new THREE.Vector3(x, z, -y);       // Blender 坐标（mm）→ three
const ease = (t) => t * t * (3 - 2 * t);

// 压力 → 颜色（MPa）：低压蓝、中压青黄、高压橙红。页面图例用同一张表
export const RAMP = [[0, '#2F6FD6'], [0.12, '#2FA9C2'], [0.24, '#7CC06A'], [0.34, '#E3BB37'], [0.46, '#E2603A']];
const RAMP_C = RAMP.map(([p, h]) => [p, new THREE.Color(h)]);
export function pColor(P, out = new THREE.Color()) {
  if (P <= RAMP_C[0][0]) return out.copy(RAMP_C[0][1]);
  for (let i = 1; i < RAMP_C.length; i++) {
    if (P <= RAMP_C[i][0]) {
      const [p0, c0] = RAMP_C[i - 1], [p1, c1] = RAMP_C[i];
      return out.lerpColors(c0, c1, (P - p0) / (p1 - p0));
    }
  }
  return out.copy(RAMP_C[RAMP_C.length - 1][1]);
}
const AIR0 = new THREE.Color('#BFE8C8'), AIR1 = new THREE.Color('#2E9D58');
const airColor = (P, out = new THREE.Color()) => out.lerpColors(AIR0, AIR1, Math.min(1, Math.max(0, P / 0.5)));

const EXT = new Set(['inlet', 'outlet', 'knob', 'locknut', 'air_port', 'breather', 'discharge', 'bleed', 'vent']);

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 折线按“时间”参数化：每段用时 = 长度 / 平均相对流速，粒子在腔里慢、在阀口快
function prepPath(pts) {
  const P = pts.map((p) => ({ x: p[0], y: p[1], z: p[2], w: p[3] ?? 0, reg: p[4] ?? 0, spd: p[5] ?? 1 }));
  const T = [0];
  for (let k = 1; k < P.length; k++) {
    const a = P[k - 1], b = P[k];
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    T.push(T[k - 1] + L / Math.max(0.05, (a.spd + b.spd) / 2));
  }
  return { P, T, total: T[T.length - 1] };
}
function sampleAt(path, t, o) {
  const { P, T } = path;
  let k = 0;
  while (k < T.length - 2 && T[k + 1] < t) k++;
  const u = Math.min(1, Math.max(0, (t - T[k]) / (T[k + 1] - T[k] || 1)));
  const a = P[k], b = P[k + 1];
  o.x = a.x + (b.x - a.x) * u; o.y = a.y + (b.y - a.y) * u; o.z = a.z + (b.z - a.z) * u;
  o.w = a.w + (b.w - a.w) * u; o.reg = a.reg + (b.reg - a.reg) * u;
  o.tx = b.x - a.x; o.tz = b.z - a.z;
  return o;
}

export function createStage({ canvas, glb, spec, pinsEl, onPin }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#10171B');
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const cam = new THREE.PerspectiveCamera(30, 1.6, 2, 8000);
  const ctl = new OrbitControls(cam, canvas);
  ctl.enableDamping = true; ctl.dampingFactor = 0.08; ctl.minDistance = 60; ctl.maxDistance = 2600;
  canvas.style.touchAction = 'pan-y';

  scene.add(new THREE.HemisphereLight('#E4EEF3', '#3A434A', 1.0));
  const key = new THREE.DirectionalLight('#FFFFFF', 2.0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.6;
  scene.add(key, key.target);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.32 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(1600, 64, '#2A363D', '#1C252A');
  grid.material.transparent = true; grid.material.opacity = 0.6;
  scene.add(grid);

  const STROKE = spec.stroke;
  const state = { model: 'dome', variant: 'cut', fluid: true, particles: true, ready: false, pins: [], fly: null, vis: {}, flowScale: {}, colors: {}, loop: null, visible: true };
  const M = {};      // 每个模型：根节点、可动零件、液体材质、粒子
  const tex = dotTexture();

  function tune(m) {
    const n = m.name || '';
    if (n === 'screen') return new THREE.MeshBasicMaterial({ color: '#8FF0C0', name: n });
    if (n === 'tube') { m.transparent = true; m.opacity = 0.3; m.depthWrite = false; m.roughness = 0.08; }
    if (n === 'airtube') { m.transparent = true; m.opacity = 0.85; }
    if (n === 'stream') { m.transparent = true; m.opacity = 0.65; m.depthWrite = false; }
    return m;
  }

  const ready = new Promise((resolve, reject) => {
    new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', (g) => {
      const shared = new Map();
      for (const name of Object.keys(spec.models)) {
        const root = g.scene.getObjectByName('ROOT_' + name);
        const S = spec.models[name];
        const rec = { root, nodes: [], fl: { fl_in: null, fl_out: null, fl_air: null }, S };
        // 液体材质每个模型各一份，颜色分开调
        for (const k of Object.keys(rec.fl)) rec.fl[k] = new THREE.MeshStandardMaterial({ name: k, transparent: true, opacity: 0.72, depthWrite: false, roughness: 0.35, metalness: 0, emissiveIntensity: 0.45 });
        for (const child of root.children) {
          const ud = child.userData || {};
          const node = { obj: child, part: ud.part, variant: ud.variant, mov: ud.mov, L0: ud.L0, fixed: ud.fixed, baseY: child.position.y };
          rec.nodes.push(node);
          child.traverse((o) => {
            if (!o.isMesh) return;
            const mn = o.material.name;
            if (/^fl_/.test(mn)) { o.material = rec.fl[mn]; o.renderOrder = 2; node.fluid = true; return; }
            if (!shared.has(o.material)) shared.set(o.material, tune(o.material));
            o.material = shared.get(o.material);
            o.castShadow = !/tube|stream|screen/.test(o.material.name);
            o.receiveShadow = true;
            if (o.material.name === 'tube' || o.material.name === 'stream') o.renderOrder = 3;
          });
        }
        M[name] = rec;
      }
      scene.add(g.scene);
      for (const name of Object.keys(M)) buildParticles(name);
      buildPulses();
      state.ready = true;
      resolve();
    }, reject);
  });

  // ---- 粒子 ----
  function makePoints(n, size) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const m = new THREE.PointsMaterial({ size, map: tex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, alphaTest: 0.05 });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = 4;
    scene.add(p);
    return p;
  }
  function buildParticles(name) {
    const rec = M[name], S = rec.S;
    const loop = S.kind === 'loop';
    const paths = loop ? [prepPath(liquidWithRegions(S))] : S.paths.map(prepPath);
    const n = loop ? 520 : 420;
    const pts = makePoints(n, loop ? 4.2 : 2.3);
    const parts = [];
    for (let i = 0; i < n; i++) {
      const path = paths[i % paths.length];
      parts.push({ path, t: Math.random() * path.total, u: (Math.random() * 2 - 1), v: Math.random(), a: Math.random() * Math.PI * 2, r: Math.sqrt(Math.random()) });
    }
    rec.particles = { pts, parts, loop };
    pts.visible = false;
  }
  function liquidWithRegions(S) {
    const mk = S.liquid_marks;
    return S.liquid.map((p) => {
      let reg = 0;
      if (p[0] >= mk.reg - 0.5 && p[2] > 30) reg = 1;
      if (p[0] >= mk.filter1) reg = 2;
      if (p[0] > 280 && p[2] < mk.nozzle - 0.5) reg = 3;
      const spd = reg === 3 ? 4 : 1;
      return [p[0], p[1], p[2], 3.2, reg, spd];
    });
  }
  const tmp = {}, cA = new THREE.Color(), cB = new THREE.Color(), cC = new THREE.Color(), cD = new THREE.Color(), cT = new THREE.Color();
  function stepParticles(name, dt) {
    const rec = M[name], P = rec.particles;
    if (!P || !P.pts.visible) return;
    const pos = P.pts.geometry.attributes.position.array, col = P.pts.geometry.attributes.color.array;
    const fs = state.flowScale[name] ?? 0;
    const cols = state.colors[name] || {};
    pColor(cols.up ?? 0.4, cA); pColor(cols.down ?? 0.2, cB); pColor(cols.mid ?? 0.1, cC); pColor(0, cD);
    for (let i = 0; i < P.parts.length; i++) {
      const p = P.parts[i];
      p.t = (p.t + dt * fs * (P.loop ? 70 : 22)) % p.path.total;
      sampleAt(p.path, p.t, tmp);
      let x = tmp.x, y = tmp.y, z = tmp.z;
      if (P.loop) {
        const rr = p.r * tmp.w;
        // 管内随机偏移：在垂直于管轴的平面里
        const tl = Math.hypot(tmp.tx, tmp.tz) || 1;
        const nx = -tmp.tz / tl, nz = tmp.tx / tl;
        x += nx * rr * Math.cos(p.a); z += nz * rr * Math.cos(p.a); y += rr * Math.sin(p.a);
      } else {
        const tl = Math.hypot(tmp.tx, tmp.tz) || 1;
        x += (-tmp.tz / tl) * p.u * tmp.w * 0.85; z += (tmp.tx / tl) * p.u * tmp.w * 0.85;
        y = Math.max(0.35, y + p.v * tmp.w);
      }
      pos[3 * i] = x; pos[3 * i + 1] = z; pos[3 * i + 2] = -y;
      const r = tmp.reg, c = cT;
      if (r <= 1) c.copy(cA).lerp(cB, r);
      else if (r <= 2) c.copy(cB).lerp(cC, r - 1);
      else c.copy(cC).lerp(cD, Math.min(1, r - 2));
      col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
    }
    P.pts.geometry.attributes.position.needsUpdate = true;
    P.pts.geometry.attributes.color.needsUpdate = true;
  }

  // ---- 闭环线的信号光点 ----
  let pulses = null;
  function buildPulses() {
    const S = M.loop?.S;
    if (!S) return;
    const lines = {};
    for (const [k, pts] of Object.entries(S.cables)) {
      const path = prepPath(pts.map((p) => [p[0], p[1], p[2], 0, 0, 1]));
      lines[k] = { path, n: k === 'air' ? 10 : 7 };
    }
    let total = 0; for (const l of Object.values(lines)) total += l.n;
    const pts = makePoints(total, 7);
    const list = [];
    for (const [k, l] of Object.entries(lines)) for (let i = 0; i < l.n; i++) list.push({ k, path: l.path, t: (i / l.n) * l.path.total });
    pulses = { pts, list, active: { p: false, q: false, ep: true, air: true } };
    pts.visible = false;
  }
  const SIG = new THREE.Color('#FFC24A'), AIRC = new THREE.Color('#8FD3FF'), OFF = new THREE.Color('#000000');
  function stepPulses(dt) {
    if (!pulses || !pulses.pts.visible) return;
    const pos = pulses.pts.geometry.attributes.position.array, col = pulses.pts.geometry.attributes.color.array;
    pulses.list.forEach((p, i) => {
      const on = pulses.active[p.k];
      p.t = (p.t + dt * 160) % p.path.total;
      sampleAt(p.path, p.t, tmp);
      pos[3 * i] = tmp.x; pos[3 * i + 1] = tmp.z + 0.2; pos[3 * i + 2] = -tmp.y;
      const c = on ? (p.k === 'air' ? AIRC : SIG) : OFF;
      col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
    });
    pulses.pts.geometry.attributes.position.needsUpdate = true;
    pulses.pts.geometry.attributes.color.needsUpdate = true;
  }

  // ---- 模型和显示 ----
  function syncVisibility() {
    for (const [name, rec] of Object.entries(M)) {
      const on = name === state.model;
      rec.root.visible = on;
      const isLoop = rec.S.kind === 'loop';
      for (const n of rec.nodes) {
        if (n.fluid) n.obj.visible = on && state.variant === 'cut' && state.fluid && !isLoop;
        else if (n.mov === 'stream') n.obj.visible = on && (state.flowScale.loop ?? 1) > 0.01;
        else n.obj.visible = isLoop ? true : (n.variant ? n.variant === state.variant : true);
      }
      if (rec.particles) rec.particles.pts.visible = on && state.particles && (isLoop || state.variant === 'cut');
    }
    if (pulses) pulses.pts.visible = state.model === 'loop';
    const isLoop = state.model === 'loop';
    const R = isLoop ? 520 : 170;
    Object.assign(key.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 10, far: 4 * R + 1500 });
    key.shadow.camera.updateProjectionMatrix();
    const c = isLoop ? V(40, 50, 0) : V(0, 0, 40);
    key.target.position.copy(c);
    key.position.copy(c).add(new THREE.Vector3(-0.5, 1.4, 0.9).multiplyScalar(isLoop ? 900 : 360));
    floor.position.y = isLoop ? -8.3 : -0.2;
    grid.position.y = floor.position.y - 0.1;
    grid.scale.setScalar(isLoop ? 2.2 : 0.6);
    setPins(state.model);
  }
  function setModel(name) { state.model = name; syncVisibility(); }
  function setVariant(v) { state.variant = v; syncVisibility(); }
  function setFluid(on) { state.fluid = on; syncVisibility(); }
  function setParticles(on) { state.particles = on; syncVisibility(); }

  // 阀芯动作：vis 是放大后的显示行程（mm），colors 是各区压力（MPa）
  function setMotion(name, { vis, up, down, air, mid, flowScale }) {
    const rec = M[name];
    if (!rec) return;
    const dir = rec.S.dir ?? -1;
    const d = dir * vis;
    for (const n of rec.nodes) {
      if (!n.mov) continue;
      if (n.mov === 'rigid') n.obj.position.y = n.baseY + d;
      else if (n.mov === 'spring') { const L = n.fixed === 'bot' ? n.L0 + d : n.L0 - d; n.obj.scale.y = Math.max(0.2, L / n.L0); }
      else if (n.mov === 'morph') n.obj.traverse((o) => { if (o.morphTargetInfluences) o.morphTargetInfluences[0] = vis / STROKE; });
    }
    pColor(up, rec.fl.fl_in.color); pColor(down, rec.fl.fl_out.color);
    if (air != null) airColor(air, rec.fl.fl_air.color);
    for (const k of Object.keys(rec.fl)) rec.fl[k].emissive.copy(rec.fl[k].color);
    state.colors[name] = { up, down, mid };
    state.flowScale[name] = flowScale;
  }
  // 闭环线：哪几根信号线在用、喷嘴液柱粗细
  function setLoop({ mode, up, down, mid, Q }) {
    const rec = M.loop;
    if (!rec) return;
    if (pulses) pulses.active = { p: mode === 'pfb', q: mode === 'qfb', ep: true, air: true };
    for (const n of rec.nodes) if (n.mov === 'stream') { const s = Math.sqrt(Math.max(0, Q) / 1.5); n.obj.scale.set(s, 1, s); n.obj.visible = Q > 0.02; }
    state.colors.loop = { up, down, mid };
    state.flowScale.loop = Q / 1.5;
  }

  // ---- 标注 ----
  function setPins(name) {
    pinsEl.innerHTML = '';
    const S = M[name]?.S;
    state.pins = [];
    if (!S) return;
    for (const p of S.pins) {
      if (S.kind !== 'loop' && state.variant === 'full' && !EXT.has(p.key)) continue;
      const [nm] = partInfo(name, p.key);
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'pin';
      el.innerHTML = `<b></b><span>${nm}<em></em></span>`;
      el.addEventListener('click', () => { activePin(p.key); onPin && onPin(name, p.key); });
      pinsEl.appendChild(el);
      state.pins.push({ el, key: p.key, v: V(...p.at), val: el.querySelector('em') });
    }
  }
  function activePin(key) { for (const p of state.pins) p.el.classList.toggle('on', p.key === key); }
  function setPinValue(key, txt) { const p = state.pins.find((q) => q.key === key); if (p) p.val.textContent = txt ? ' ' + txt : ''; }
  const pv = new THREE.Vector3();
  function placePins() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const p of state.pins) {
      pv.copy(p.v).project(cam);
      const off = pv.z > 1 || pv.x < -1.1 || pv.x > 1.1 || pv.y < -1.1 || pv.y > 1.1;
      p.el.style.display = off ? 'none' : '';
      p.el.style.transform = `translate(${((pv.x + 1) / 2) * w}px, ${((1 - pv.y) / 2) * h}px)`;
    }
  }

  // ---- 机位 ----
  function jump(c, a) { cam.position.copy(V(...c)); ctl.target.copy(V(...a)); ctl.update(); }
  function fly(c, a, ms = 900) {
    state.fly = { t0: performance.now(), ms, p0: cam.position.clone(), p1: V(...c), a0: ctl.target.clone(), a1: V(...a) };
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    // 窄屏（手机竖屏）拉远一点，免得模型出框
    cam.fov = w / h < 0.9 ? 44 : 30;
    cam.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver((e) => { state.visible = e[0].isIntersecting; }, { threshold: 0.01 }).observe(canvas);

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!state.ready || !state.visible || document.hidden) return;
    if (state.fly) {
      const f = state.fly, u = ease(Math.min(1, (now - f.t0) / f.ms));
      cam.position.lerpVectors(f.p0, f.p1, u);
      ctl.target.lerpVectors(f.a0, f.a1, u);
      if (u >= 1) state.fly = null;
    }
    ctl.update();
    stepParticles(state.model, dt);
    if (state.model === 'loop') stepPulses(dt);
    renderer.render(scene, cam);
    placePins();
  }
  requestAnimationFrame(frame);
  resize();

  return { ready, state, setModel, setVariant, setFluid, setParticles, setMotion, setLoop, fly, jump, activePin, setPinValue, specOf: (n) => M[n]?.S };
}
