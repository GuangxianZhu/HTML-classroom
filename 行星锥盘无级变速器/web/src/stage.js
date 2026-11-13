// 三维舞台：加载 GLB，按 core.js 算出的状态摆零件（输入转、行星盘自转 + 公转 + 径向移动、行星架转、
// 外环轴向移动、凸轮环和手轮转），四种看法（外观 / 剖开 / 只看内部 / 拆开），接触点，标注，点选零件。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as C from './core.js';

const V = (x, y, z) => new THREE.Vector3(x, z, -y);      // Blender 坐标（mm）→ three
const TAU = Math.PI * 2;
const ease = (t) => t * t * (3 - 2 * t);

const VIEWS = {
  ext: { cam: [-380, -620, 300], at: [60, 0, 10] },
  cut: { cam: [-200, -560, 150], at: [10, 0, 10] },
  core: { cam: [-250, -320, 200], at: [0, 0, 10] },
  explode: { cam: [-240, -1150, 480], at: [10, 0, 95] },
  section: { cam: [0, -270, 46], at: [0, 0, 44] },
};

export function createStage({ canvas, glb, spec, pinsEl, onPick }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#10171B');
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  const cam = new THREE.PerspectiveCamera(30, 1.6, 2, 9000);
  const ctl = new OrbitControls(cam, canvas);
  ctl.enableDamping = true; ctl.dampingFactor = 0.08; ctl.minDistance = 80; ctl.maxDistance = 3200;
  canvas.style.touchAction = 'pan-y';
  scene.add(new THREE.HemisphereLight('#E4EEF3', '#30383E', 1.1));
  const key = new THREE.DirectionalLight('#FFFFFF', 2.2);
  key.position.copy(V(-300, -500, 520));
  scene.add(key);
  const fill = new THREE.DirectionalLight('#CFE3FF', 0.7);
  fill.position.copy(V(500, 300, 200));
  scene.add(fill);

  // 剖切平面：保留 Blender y ≥ 0（three z ≤ 0）的一半
  const clip = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)];

  const parts = {};            // key → { full, cut }
  const root = new THREE.Group();
  scene.add(root);

  new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', (gltf) => {
    // 每个零件是一个带 extras（part / variant / group）的节点；多材质的零件是一个组，里面有几个网格
    const nodes = [];
    gltf.scene.traverse((o) => { if (o.userData && o.userData.part) nodes.push(o); });
    for (const o of nodes) {
      const ud = o.userData;
      const k = ud.part, variant = ud.variant || 'full';
      root.attach(o);
      ud.base = { pos: o.position.clone(), quat: o.quaternion.clone() };
      ud.key = k;
      o.traverse((m) => {
        if (!m.isMesh) return;
        m.userData.key = k;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const cloned = mats.map((mm) => { const c = mm.clone(); c.side = THREE.DoubleSide; return c; });
        m.material = Array.isArray(m.material) ? cloned : cloned[0];
      });
      (parts[k] ||= {})[variant] = o;
    }
    ready = true;
    setView(view, true);
    applyState();
  }, (err) => console.error(err));

  const meshMats = (o) => { const out = []; o.traverse((m) => { if (m.isMesh) out.push(...(Array.isArray(m.material) ? m.material : [m.material])); }); return out; };

  let ready = false;
  let view = 'ext';
  let explodeT = 0, explodeTarget = 0;
  let showContacts = true;
  let selected = null;

  // ---------- 接触点 ----------
  const dotGeo = new THREE.SphereGeometry(1.6, 16, 12);
  const mkDot = (col) => new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.95 }));
  const contacts = [];
  for (let i = 0; i < C.PARAMS.geom.n_planet; i++) {
    const d = { ip: mkDot('#FFB238'), in: mkDot('#FFB238'), op: mkDot('#55D6F2'), on: mkDot('#55D6F2') };
    for (const m of Object.values(d)) { m.renderOrder = 10; scene.add(m); }
    contacts.push(d);
  }

  // ---------- 状态 ----------
  const st = { u: 0.5, angIn: 0, angOut: 0, angSpin: 0, s: C.solve(0.5, 0) };
  const ref = spec.ref;
  const angs = spec.planet_ang;
  const springL0 = spec.anim.spring.L0, seat = spec.spring.seat;
  const W = spec.adjust.worm, H = spec.adjust.handwheel;
  const camDeg = C.PARAMS.handwheel.cam_ring_deg;

  function place(o, k, anim) {
    const b = o.userData.base;
    o.position.copy(b.pos);
    o.quaternion.copy(b.quat);
    o.scale.set(1, 1, 1);
    const s = st.s;
    const dIn = (s.gIn - ref.gIn) / 2, dOut = (s.gOut - ref.gOut) / 2;
    const ex = spec.explode[k] || [0, 0, 0];
    const f = ease(explodeT);
    const t = anim?.type;
    if (t === 'spin_in') {
      o.rotation.x = st.angIn;
      o.position.x += (anim.slide || 0) * dIn;
    } else if (t === 'spring') {
      o.rotation.x = st.angIn;
      o.scale.x = (seat - (s.gIn / 2 + spec.spring.back_local)) / springL0;
    } else if (t === 'planet' || t === 'slider') {
      const a = anim.ang + st.angOut;
      const e = s.e + 52 * f;
      const p = V(ex[0] * f, e * Math.cos(a), e * Math.sin(a));
      o.position.copy(p);
      o.rotation.x = t === 'planet' ? st.angOut + st.angSpin : st.angOut;
      return;
    } else if (t === 'spin_out') {
      o.rotation.x = st.angOut;
    } else if (t === 'ring') {
      o.position.x += anim.slide * dOut;
    } else if (t === 'cam') {
      o.position.x += anim.slide * dOut;
      o.rotation.x = -(st.u - ref.u) * camDeg * Math.PI / 180;
    } else if (t === 'worm') {
      o.rotation.z = -hwAngle();
    } else if (t === 'handwheel') {
      o.rotation.y = hwAngle();
    } else if (t === 'needle') {
      o.rotation.z = (1.5 * st.u - 0.75) * Math.PI;   // 快挡在右下、慢挡在左下
    }
    if (f > 0) o.position.add(V(ex[0] * f, ex[1] * f, ex[2] * f));
  }
  const hwAngle = () => -st.u * C.TURNS * TAU;

  function applyState() {
    if (!ready) return;
    for (const [k, v] of Object.entries(parts)) {
      const anim = spec.anim[k];
      for (const o of Object.values(v)) place(o, k, anim);
    }
    // 接触点
    const s = st.s, f = ease(explodeT);
    const vis = showContacts && f < 0.02 && view !== 'ext';
    contacts.forEach((d, i) => {
      const a = angs[i] + st.angOut;
      const ca = Math.cos(a), sa = Math.sin(a);
      d.ip.position.copy(V(s.gIn / 2, C.PARAMS.geom.r_sun * ca, C.PARAMS.geom.r_sun * sa));
      d.in.position.copy(V(-s.gIn / 2, C.PARAMS.geom.r_sun * ca, C.PARAMS.geom.r_sun * sa));
      d.op.position.copy(V(s.gOut / 2, C.PARAMS.geom.R_ring * ca, C.PARAMS.geom.R_ring * sa));
      d.on.position.copy(V(-s.gOut / 2, C.PARAMS.geom.R_ring * ca, C.PARAMS.geom.R_ring * sa));
      const slipIn = s.slipping && s.critical === 'inner', slipOut = s.slipping && s.critical === 'outer';
      for (const [m, slip] of [[d.ip, slipIn], [d.in, slipIn], [d.op, slipOut], [d.on, slipOut]]) {
        m.visible = vis && (view !== 'cut' || m.position.z <= 0.5);
        m.material.color.set(slip ? '#FF3B2F' : (m === d.ip || m === d.in ? '#FFB238' : '#55D6F2'));
      }
    });
  }

  // ---------- 看法 ----------
  function setView(v, instant) {
    view = v;
    explodeTarget = v === 'explode' ? 1 : 0;
    if (!ready) return;
    const cutMode = v === 'cut' || v === 'section';
    for (const [k, vv] of Object.entries(parts)) {
      const grp = (vv.full || vv.cut).userData.group;
      const hasCut = !!vv.cut;
      let showFull = true, showCut = false;
      if (v === 'cut') { showFull = !hasCut && grp !== 'front'; showCut = hasCut; if (grp === 'motor') showFull = true; }
      if (v === 'section') { showFull = !hasCut && !['front', 'motor', 'adjust'].includes(grp); showCut = hasCut && grp !== 'shell'; }
      if (v === 'core') { showFull = !['shell', 'front', 'motor'].includes(grp); }
      if (vv.full) vv.full.visible = showFull;
      if (vv.cut) vv.cut.visible = showCut;
      // 裁剪只用在“转的件”（没有剖切版的完整件）；电机不剖
      if (vv.full) for (const m of meshMats(vv.full)) { m.clippingPlanes = cutMode && grp !== 'motor' ? clip : null; m.needsUpdate = true; }
    }
    flyTo(VIEWS[v], instant);
    applyState();
  }

  // ---------- 相机 ----------
  let fly = null;
  function flyTo(vw, instant) {
    const c1 = V(...vw.cam), t1 = V(...vw.at);
    if (instant) { cam.position.copy(c1); ctl.target.copy(t1); ctl.update(); return; }
    fly = { c0: cam.position.clone(), t0: ctl.target.clone(), c1, t1, k: 0 };
  }

  // ---------- 标注 ----------
  const pins = spec.pins.map((p) => {
    const el = document.createElement('button');
    el.className = 'pin';
    el.type = 'button';
    el.innerHTML = '<b></b><span></span>';
    el.dataset.key = p.key;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); select(p.key); onPick?.(p.key); });
    pinsEl.appendChild(el);
    return { el, p: V(...p.at), key: p.key };
  });
  let showPins = true;
  function setPinLabels(map) { for (const q of pins) q.el.querySelector('span').textContent = map(q.key); }

  // ---------- 点选 ----------
  const ray = new THREE.Raycaster();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = canvas.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(p, cam);
    const vis = [];
    root.traverse((o) => { if (o.isMesh) { let p = o, v = true; while (p && p !== root) { if (!p.visible) v = false; p = p.parent; } if (v) vis.push(o); } });
    const hits = ray.intersectObjects(vis, false).filter((h) => (view !== 'cut' && view !== 'section') || h.point.z <= 0.5);
    if (hits.length) {
      const k = normKey(hits[0].object.userData.key);
      select(k);
      onPick?.(k);
    }
  });
  const normKey = (k) => k.replace(/^planet\d$/, 'planet').replace(/^slider\d[pn]$/, 'slider').replace(/^tie\d$/, 'tie')
    .replace(/^car_[pn]$/, 'carrier').replace(/^knob_cap$|^hw_shaft$/, 'knob').replace(/^fan_cover$|^tbox_lid$/, 'motor')
    .replace(/^brg_out$/, 'cover').replace(/^adapter$/, 'housing').replace(/^needle$/, 'dial').replace(/^oil_glass$|^feet$/, 'housing');
  function select(k) {
    selected = k;
    for (const [kk, vv] of Object.entries(parts)) {
      const on = normKey(kk) === k;
      for (const o of Object.values(vv)) {
        for (const m of meshMats(o)) { if (m.emissive) { m.emissive.set(on ? '#FFB238' : '#000000'); m.emissiveIntensity = on ? 0.35 : 0; } }
      }
    }
    for (const q of pins) q.el.classList.toggle('on', q.key === k);
  }

  // ---------- 循环 ----------
  let speed = 1 / 100;           // 慢放倍率
  let running = true;
  let last = performance.now();
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    }
  }
  const tmp = new THREE.Vector3();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    resize();
    if (running) {
      const s = st.s;
      const k = TAU / 60 * speed * dt;
      st.angIn += C.N_IN * k;
      st.angOut += s.nOut * k;
      st.angSpin += -s.spinRel * k * (s.slipping ? 0.85 : 1);
    }
    if (explodeT !== explodeTarget) {
      explodeT += Math.sign(explodeTarget - explodeT) * dt * 1.2;
      explodeT = Math.min(1, Math.max(0, explodeT));
    }
    if (fly) {
      fly.k = Math.min(1, fly.k + dt * 1.6);
      const e = ease(fly.k);
      cam.position.lerpVectors(fly.c0, fly.c1, e);
      ctl.target.lerpVectors(fly.t0, fly.t1, e);
      if (fly.k >= 1) fly = null;
    }
    ctl.update();
    applyState();
    renderer.render(scene, cam);
    // 标注位置
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const q of pins) {
      tmp.copy(q.p).project(cam);
      const on = showPins && ready && explodeT < 0.02 && tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05 && pinVisible(q.key);
      q.el.style.display = on ? '' : 'none';
      if (on) q.el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px)`;
    }
    requestAnimationFrame(frame);
  }
  const pinVisible = (k) => {
    const ext = ['housing', 'topbox', 'dial', 'motor', 'knob', 'out_shaft'];
    if (view === 'ext') return ext.includes(k);
    if (view === 'core') return !['housing', 'topbox', 'dial', 'motor'].includes(k);
    if (view === 'section') return !['housing', 'topbox', 'dial', 'motor', 'knob', 'worm', 'cam_teeth'].includes(k);
    return k !== 'dial';
  };
  requestAnimationFrame(frame);

  return {
    setU(u, s) { st.u = u; st.s = s; },
    setView,
    get view() { return view; },
    setSpeed(x) { speed = x; },
    setRunning(r) { running = r; },
    setContacts(b) { showContacts = b; },
    setPins(b) { showPins = b; },
    setPinLabels,
    select,
  };
}
