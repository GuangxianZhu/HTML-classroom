// 三维舞台：载入 GLB，一次显示一种调压阀；按仿真结果移动零件、给各压力区上色、让气流点沿通道走
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const V = (x, y, z) => new THREE.Vector3(x, z, -y);       // Blender 坐标 → three
const ease = (t) => t * t * (3 - 2 * t);
const PA = 101.325;

// 压力色：大气压（蓝灰）→ 青 → 黄 → 红（对数刻度，上限按模型给）
const STOPS = [[0, '#5E7D9A'], [0.18, '#2F8FD0'], [0.42, '#22B39A'], [0.68, '#E3C440'], [1, '#E2502A']];
const LIQ = [[0, '#6B8FB0'], [0.5, '#3A7FD8'], [1, '#1B3FA8']];
const cols = (st) => st.map(([t, c]) => [t, new THREE.Color(c)]);
const CG = cols(STOPS), CL = cols(LIQ);
export function pColor(Pabs, Pmax, liquid = false, out = new THREE.Color()) {
  const t = Math.max(0, Math.min(1, Math.log(Math.max(Pabs, PA) / PA) / Math.log(Pmax / PA)));
  const st = liquid ? CL : CG;
  for (let i = 1; i < st.length; i++) {
    if (t <= st[i][0]) { const u = (t - st[i - 1][0]) / (st[i][0] - st[i - 1][0]); return out.copy(st[i - 1][1]).lerp(st[i][1], u); }
  }
  return out.copy(st[st.length - 1][1]);
}
export const cssColor = (Pabs, Pmax, liquid) => '#' + pColor(Pabs, Pmax, liquid).getHexString();

export function createStage({ canvas, glb, spec, pinsEl, onPin }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#141A1F');
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  const cam = new THREE.PerspectiveCamera(30, 1.6, 0.1, 400);
  const ctl = new OrbitControls(cam, canvas);
  ctl.enableDamping = true; ctl.dampingFactor = 0.08; ctl.minDistance = 4; ctl.maxDistance = 90;
  canvas.style.touchAction = 'pan-y';
  scene.add(new THREE.HemisphereLight('#E6EEF3', '#3A424A', 1.0));
  const key = new THREE.DirectionalLight('#FFFFFF', 1.7); key.position.set(-14, 22, 26); scene.add(key);
  const fill = new THREE.DirectionalLight('#CFE2F0', 0.6); fill.position.set(18, 6, 12); scene.add(fill);

  const state = { model: null, ready: false, fly: null, showGas: true, showFlow: true, pins: [] };
  const roots = {}, rig = {};

  function tune(m) {
    const n = m.name || '';
    if (n === 'glass') { m.transparent = true; m.opacity = 0.18; m.depthWrite = false; }
    if (n === 'led_red') return new THREE.MeshBasicMaterial({ color: '#FF5A48', name: n });
    if (n.endsWith('_cut')) { m.metalness = 0; m.roughness = 0.85; m.envMapIntensity = 0.25; m.color.multiplyScalar(0.84); }
    return m;
  }

  const ready = new Promise((resolve, reject) => {
    new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', (g) => {
      const seen = new Map();
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const ud = o.userData;
        if (ud.kind === 'gas') {
          o.material = new THREE.MeshBasicMaterial({ color: '#888', transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });
          o.renderOrder = 2;
          return;
        }
        const arr = Array.isArray(o.material) ? o.material : [o.material];
        const tuned = arr.map((m) => { if (!seen.has(m)) seen.set(m, tune(m)); return seen.get(m); });
        o.material = Array.isArray(o.material) ? tuned : tuned[0];
      });
      for (const name of Object.keys(spec.models)) {
        const r = g.scene.getObjectByName('ROOT_' + name);
        roots[name] = r;
        r.visible = false;
        buildRig(name, r);
      }
      scene.add(g.scene);
      state.ready = true;
      resolve();
    }, reject);
  });

  // ---- 每个模型：动件、压力区、气流点 ----
  function buildRig(name, root) {
    const sp = spec.models[name];
    const R = { movers: [], zones: {}, parts: {}, paths: [], ch: {}, flows: {}, box: new THREE.Box3() };
    root.updateMatrixWorld(true);
    // 注意：剖切过的零件有两种材质（外表面 + 切面），GLTFLoader 会把它变成一个 Group 下挂两个 Mesh，
    // 零件信息（extras → userData）只在 Group 上。所以这里按"带 part 的节点"收集，而不是只看 Mesh；
    // 以前只看 Mesh，结果所有剖切零件（手轮、弹簧、膜片、阀芯）都找不到，整台阀一动不动。
    root.traverse((o) => {
      const ud = o.userData;
      if (!ud || !ud.part) return;
      if (ud.kind === 'gas') { if (o.isMesh) (R.zones[ud.zone] ||= []).push(o); return; }
      (R.parts[ud.part] ||= []).push(o);
      if (!/glass/.test(ud.part)) R.box.expandByObject(o);
    });
    for (const m of sp.movers) {
      for (const node of R.parts[m.part] || []) {
        if (m.kind === 'dia') {
          // 膜片：按半径给每个顶点一个权重，中间跟着走、边缘夹住不动
          const meshes = [];
          node.traverse((o) => { if (o.isMesh) meshes.push(o); });
          for (const o of meshes) {
            const pos = o.geometry.attributes.position;
            const w = new Float32Array(pos.count);
            for (let i = 0; i < pos.count; i++) {
              const r = Math.hypot(pos.getX(i) - m.cx, pos.getZ(i));
              w[i] = r <= m.r_in ? 1 : r >= m.r_out ? 0 : ease(1 - (r - m.r_in) / (m.r_out - m.r_in));
            }
            R.movers.push({ m, o, base: Float32Array.from(pos.array), w, last: 0 });
          }
          continue;
        }
        R.movers.push({ m, o: node, y0: node.position.y, s0: node.scale.y, r0: node.rotation.z });
      }
    }
    // 气流点
    const pts = [];
    for (const p of sp.paths) {
      const n = p.n ?? 150;
      const seg = [];
      let L = 0;
      for (let k = 1; k < p.pts.length; k++) {
        const a = p.pts[k - 1], b = p.pts[k];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        seg.push([a, b, L, l]); L += l;
      }
      R.paths.push({ ch: p.ch, seg, L, n, w: p.w, off: pts.length });
      for (let i = 0; i < n; i++) pts.push({ path: R.paths.length - 1, ph: Math.random(), j: (Math.random() - 0.5) * 2, sp: 0.85 + Math.random() * 0.3 });
    }
    const pos = new Float32Array(pts.length * 3), col = new Float32Array(pts.length * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.075, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true });
    const P = new THREE.Points(g, mat);
    P.frustumCulled = false; P.renderOrder = 3;
    root.add(P);
    R.pts = pts; R.pg = g; R.pos = pos; R.col = col; R.P = P;
    rig[name] = R;
  }

  const tmpC = new THREE.Color();
  function applyState(name, vis, meta) {
    const R = rig[name];
    if (!R) return;
    Object.assign(R.ch, vis.ch || {});
    R.flows = vis.flows || {};
    for (const rec of R.movers) {
      const { m, o } = rec;
      const v = (c) => (c ? (R.ch[c] ?? 0) : 0);
      if (m.kind === 'tz') o.position.y = rec.y0 + v(m.ch) * m.k;
      else if (m.kind === 'spring') {
        const bot = m.bot ? v(m.bot) * m.kb : 0, top = m.top ? v(m.top) * m.kt : 0;
        o.position.y = rec.y0 + bot;
        o.scale.y = rec.s0 * Math.max(0.2, (m.L + top - bot) / m.L);
      } else if (m.kind === 'ry') {
        const t = Math.max(0, Math.min(1.04, v(m.ch) / m.rng));
        o.rotation.z = -(m.a0 + (m.a1 - m.a0) * t);
      } else if (m.kind === 'dia') {
        const d = v(m.ch) * m.k;
        if (Math.abs(d - rec.last) > 1e-5) {
          const pos = o.geometry.attributes.position, b = rec.base, w = rec.w;
          for (let i = 0; i < pos.count; i++) pos.array[3 * i + 1] = b[3 * i + 1] + d * w[i];
          pos.needsUpdate = true; rec.last = d;
          o.geometry.computeBoundingSphere();
        }
      }
    }
    const zm = meta.zones || {};
    for (const z in R.zones) {
      const P = vis.zones?.[z];
      const info = zm[z] || {};
      for (const o of R.zones[z]) {
        o.visible = state.showGas && P != null;
        if (P != null) o.material.color.copy(pColor(P, meta.pmax, info.liquid, tmpC));
      }
    }
  }

  function stepFlow(name, dt, meta) {
    const R = rig[name];
    if (!R) return;
    R.P.visible = state.showFlow;
    if (!state.showFlow) return;
    const pos = R.pos, col = R.col;
    const fc = meta.flowColor || {};
    for (let i = 0; i < R.pts.length; i++) {
      const q = R.pts[i], p = R.paths[q.path];
      const f = Math.max(0, R.flows[p.ch] ?? 0);
      const ref = meta.qref?.[p.ch] ?? meta.qref?.main ?? 200;
      const rate = Math.min(2.2, f / ref);
      q.ph = (q.ph + dt * q.sp * rate * 2.2 / Math.max(1, p.L) * 3) % 1;
      const d = q.ph * p.L;
      let s = p.seg[0];
      for (const sg of p.seg) { if (d >= sg[2]) s = sg; else break; }
      const u = Math.min(1, (d - s[2]) / Math.max(1e-6, s[3]));
      const [a, b] = s;
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const x = a[0] + dx * u + nx * q.j * p.w, z = a[1] + dz * u + nz * q.j * p.w;
      const on = rate > 0.004 ? Math.min(1, 0.35 + rate) : 0;
      // 没有流量的通道：把点挪走（以前是涂成黑色，落在浅色压力区上会变成一片黑点）
      pos[3 * i] = x; pos[3 * i + 1] = on ? z : -999; pos[3 * i + 2] = 0.06;
      const c = fc[p.ch] || [0.92, 0.97, 1];
      col[3 * i] = c[0] * on; col[3 * i + 1] = c[1] * on; col[3 * i + 2] = c[2] * on;
    }
    R.pg.attributes.position.needsUpdate = true;
    R.pg.attributes.color.needsUpdate = true;
  }

  // ---- 视图 ----
  function viewFor(name) {
    const b = rig[name].box, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    const fov = cam.fov * Math.PI / 180;
    const need = Math.max(s.y * 1.42, s.x * 1.12 / Math.max(0.55, cam.aspect));
    const dist = need / 2 / Math.tan(fov / 2) + s.z * 0.5;
    const dir = new THREE.Vector3(0.22, 0.2, 1).normalize();
    return { pos: c.clone().addScaledVector(dir, dist), at: c };
  }
  function setModel(name, instant) {
    state.model = name;
    for (const k in roots) roots[k].visible = k === name;
    const v = viewFor(name);
    if (instant) { cam.position.copy(v.pos); ctl.target.copy(v.at); ctl.update(); } else fly(v.pos, v.at);
  }
  function reframe() { if (state.model) { const v = viewFor(state.model); fly(v.pos, v.at, 600); } }
  function fly(p, t, ms = 900) { state.fly = { p0: cam.position.clone(), p1: p.clone(), t0: ctl.target.clone(), t1: t.clone(), s: performance.now(), ms }; }
  // 镜头对准某个零件：目标点往零件那边挪一大半，但距离只拉近到整台视图的 0.72 倍，
  // 这样零件在画面中间、周围的弹簧 / 膜片 / 阀芯也还看得见（以前拉得太近，只剩一个零件）
  function focus(at, dist) {
    const v = viewFor(state.model);
    const t = v.at.clone().lerp(V(...at), 0.65);
    const d = dist ?? v.pos.distanceTo(v.at) * 0.72;
    const dir = cam.position.clone().sub(ctl.target).normalize();
    fly(t.clone().addScaledVector(dir, d), t, 700);
  }

  // ---- 标注针 ----
  function setPins(list) {
    pinsEl.textContent = '';
    state.pins = list.map((p, i) => {
      const b = document.createElement('button');
      b.className = 'pin'; b.type = 'button';
      b.innerHTML = `<b>${i + 1}</b><span>${p.name}</span>`;
      b.addEventListener('click', () => onPin(p, i));
      pinsEl.append(b);
      return { el: b, at: V(...p.at), p };
    });
  }
  function activePin(i) { state.pins.forEach((q, k) => q.el.classList.toggle('on', k === i)); }
  const tmp = new THREE.Vector3();
  function layoutPins() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const q of state.pins) {
      tmp.copy(q.at).project(cam);
      const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.02 && Math.abs(tmp.y) < 1.02;
      q.el.style.display = vis ? '' : 'none';
      q.el.style.transform = `translate(${((tmp.x + 1) / 2 * w).toFixed(1)}px, ${((1 - tmp.y) / 2 * h).toFixed(1)}px)`;
    }
  }

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    cam.aspect = r.width / Math.max(1, r.height); cam.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas.parentElement);
  let vis = true;
  new IntersectionObserver((e) => { vis = e[0].isIntersecting; }, { threshold: 0.01 }).observe(canvas);

  let tick = null;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (tick) tick(dt, vis);
    if (!vis || !state.ready) return;
    if (state.fly) {
      const u = Math.min(1, (now - state.fly.s) / state.fly.ms), e = ease(u);
      cam.position.lerpVectors(state.fly.p0, state.fly.p1, e);
      ctl.target.lerpVectors(state.fly.t0, state.fly.t1, e);
      if (u >= 1) state.fly = null;
    }
    ctl.update();
    renderer.render(scene, cam);
    layoutPins();
  }
  ready.then(() => { resize(); requestAnimationFrame(frame); });
  return {
    ready, state, setModel, reframe, setPins, activePin, applyState, stepFlow, focus, resize,
    onTick(fn) { tick = fn; },
    setGas(on) { state.showGas = on; }, setFlow(on) { state.showFlow = on; },
    renderer, scene, cam, ctl,
  };
}
