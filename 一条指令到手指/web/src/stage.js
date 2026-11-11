// 三维舞台：三个 Blender 模型共用一块画布。
//   desk   桌面全景（电脑、M7C、面包板、电源分线板、腱绳手）
//   servo  舵机剖视
//   finger 一根手指（线轴、滑轮、两根腱绳）
// 每一关交给 set() 一个 view，说明看哪个模型、镜头对着哪、哪些零件亮、光点沿哪条路走。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import deskGlb from '../../blender/out/desk.glb';
import servoGlb from '../../blender/out/servo.glb';
import fingerGlb from '../../blender/out/finger.glb';
import LAYOUT from '../../blender/out/layout.json';

// 和页面里的颜色含义一致
export const COL = {
  H: '#ff8a3d',      // 高电平 / 屈线
  L: '#3d86e0',      // 低电平 / 伸线
  Z: '#7d8a90',      // 没人管
  X: '#ff3b30',      // 出错
  A: '#19b3a0',      // 这一站
  G: '#3fbf5f',      // 应答
  P: '#9f7aea', Y: '#e0b020',   // 多条总线时用来区分
};
const c3 = (s) => new THREE.Color(s);
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const DIRS = { desk: [0.05, 0.62, 1], servo: [-0.3, 0.34, 1], finger: [0.18, 0.12, 1] };
const LABELS = {
  desk: { pc: '电脑', m7c: 'M7C', txb: 'TXB0104', g241: '241', phb: '分线板', tower: '17 个舵机', hand: '手指' },
  servo: { motor: '电机', gears: '减速齿轮', out: '输出轴和线轴', enc: '磁铁和编码器', mcu: '控制芯片', conn: '总线接口' },
  finger: { spool: '线轴', joint: '关节滑轮', tip: '手指' },
};

export function createStage(canvas, labelHost) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;
  const sun = new THREE.DirectionalLight(0xffffff, 0.95); sun.position.set(3, 6, 5); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false; controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49;

  const roots = {}, objs = { desk: {}, servo: {}, finger: {} };
  let view = null, active = null, ready = 0, dirty = true, pickCb = null;
  const camGoal = { target: new THREE.Vector3(), dist: 10, dir: new THREE.Vector3(0, 0.5, 1).normalize(), moving: false };

  // ---------- 加载 ----------
  const loader = new GLTFLoader();
  const load = (name, u8) => loader.parse(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), '', (g) => {
    const root = g.scene; root.visible = false; roots[name] = root; scene.add(root);
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.userData.base = { color: o.material.color.clone(), emissive: o.material.emissive.clone(), ei: o.material.emissiveIntensity };
      }
      if (o.name) objs[name][o.name] = o;
    });
    if (name === 'servo') { const f = objs.servo.SV_front; if (f) { f.material.transparent = true; f.material.opacity = 0.1; f.material.depthWrite = false; } }
    if (name === 'finger') buildTendons();
    ready++; apply(true);
  }, (e) => console.error('模型加载失败', name, e));
  load('desk', deskGlb); load('servo', servoGlb); load('finger', fingerGlb);

  // ---------- 标签 ----------
  const labelEls = {};
  function setLabels(sceneName, show, hot) {
    for (const k in labelEls) labelEls[k].el.remove();
    for (const k in labelEls) delete labelEls[k];
    if (!labelHost || !show) return;
    const names = LABELS[sceneName], anchors = LAYOUT[sceneName].anchors;
    for (const k in names) {
      if (!anchors[k]) continue;
      const el = document.createElement('span');
      el.className = 'tag' + (hot && hot.includes(k) ? ' hot' : '');
      el.textContent = names[k];
      labelHost.appendChild(el);
      labelEls[k] = { el, pos: V(anchors[k]) };
    }
  }
  const tmp = new THREE.Vector3();
  function placeLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const k in labelEls) {
      const { el, pos } = labelEls[k];
      tmp.copy(pos).project(camera);
      const on = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
      el.style.display = on ? '' : 'none';
      if (on) el.style.transform = `translate(-50%,-100%) translate(${((tmp.x + 1) / 2 * w).toFixed(1)}px,${((1 - tmp.y) / 2 * h - 6).toFixed(1)}px)`;
    }
  }

  // ---------- 光点 ----------
  const dotGeo = new THREE.SphereGeometry(1, 14, 10);
  const dots = Array.from({ length: 10 }, () => {
    const m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: COL.H })); m.visible = false; scene.add(m); return m;
  });
  let route = null;   // { pts:[Vector3], cum:[len], total }
  function buildRoute(list) {
    const pts = [];
    for (const item of list) {
      const [name, dir] = Array.isArray(item) ? item : [item, 1];
      const p = (LAYOUT.desk.paths[name] || []).map(V);
      if (dir < 0) p.reverse();
      for (const q of p) if (!pts.length || pts[pts.length - 1].distanceTo(q) > 1e-4) pts.push(q);
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    return { pts, cum, total: cum[cum.length - 1] || 1 };
  }
  function routeAt(r, t, out) {
    const d = Math.max(0, Math.min(1, t)) * r.total;
    let i = 1; while (i < r.cum.length - 1 && r.cum[i] < d) i++;
    const a = r.pts[i - 1], b = r.pts[i], seg = r.cum[i] - r.cum[i - 1] || 1;
    return out.copy(a).lerp(b, (d - r.cum[i - 1]) / seg);
  }

  // ---------- 手指模型里的两根腱绳（实时画） ----------
  const F = LAYOUT.finger;
  const tendon = {};
  function buildTendons() {
    for (const k of ['flex', 'ext']) {
      const mat = new THREE.MeshStandardMaterial({ color: k === 'flex' ? COL.H : COL.L, roughness: 0.5 });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      roots.finger.add(mesh); tendon[k] = mesh;
    }
    const cm = new THREE.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.6 });
    tendon.crank = new THREE.Mesh(new THREE.BufferGeometry(), cm); roots.finger.add(tendon.crank);
  }
  function tube(mesh, pts, r) {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, r, 6, false);
  }
  function drawTendons(v) {
    if (!tendon.flex) return;
    const s = F.scale, cs = V(F.spool), cj = V(F.joint);
    const rs = (v.rs || F.rs) * s, rj = (v.rj || F.rj) * s, z = cs.z + 0.0;
    const span = cj.y - cs.y;
    const one = (mesh, side, slackMm, taut) => {
      const a = new THREE.Vector3(cs.x + side * rs, cs.y, z), b = new THREE.Vector3(cj.x + side * rj, cj.y, z);
      const sag = Math.sqrt(Math.max(0, slackMm) * s * span * 3 / 8);         // 多出来的线长换成中间鼓出去多少
      const mid = a.clone().lerp(b, 0.5); mid.x += side * sag;
      tube(mesh, [a, mid, b], 0.022);
      mesh.material.emissive.set(side > 0 ? COL.H : COL.L);
      mesh.material.emissiveIntensity = taut ? 0.55 : 0.08;
      mesh.material.opacity = 1;
    };
    one(tendon.flex, 1, v.slackFlex || 0, v.tautFlex !== false);
    one(tendon.ext, -1, v.slackExt || 0, v.tautExt !== false);
    tendon.flex.visible = tendon.ext.visible = !v.crank;
    tendon.crank.visible = !!v.crank;
    if (v.crank) {                                   // 线绑在舵盘孔上：孔绕中心转，线从孔直接拉到上面
      const a = THREE.MathUtils.degToRad(v.spoolDeg || 0);
      const hole = new THREE.Vector3(cs.x - rs * Math.sin(a), cs.y - rs * Math.cos(a), z + 0.02);
      const top = new THREE.Vector3(cj.x, cj.y - rj, z + 0.02);
      tube(tendon.crank, [hole, hole.clone().lerp(top, 0.5), top], 0.022);
    }
  }

  // ---------- 把 view 应用到模型 ----------
  function tint(o, color, k) {
    if (!o || !o.isMesh) return;
    const b = o.userData.base;
    if (!color) { o.material.color.copy(b.color); o.material.emissive.copy(b.emissive); o.material.emissiveIntensity = b.ei; return; }
    o.material.emissive.set(color); o.material.emissiveIntensity = k;
  }
  let lastKey = '';
  function apply(force) {
    if (!view) return;
    const name = view.scene || 'desk';
    if (!roots[name]) return;
    if (active !== name || force) {
      for (const k in roots) roots[k].visible = k === name;
      active = name;
    }
    const key = name + '|' + (view.focus || 'all') + '|' + (view.zoom || 1) + '|' + (view.dir || '');
    if (key !== lastKey || force) { lastKey = key; aim(name, view.focus, view.zoom, view.dir); setLabels(name, view.labels !== false, view.hot || []); }
    else if (labelHost) for (const k in labelEls) labelEls[k].el.classList.toggle('hot', (view.hot || []).includes(k));
    const O = objs[name];
    if (name === 'desk') {
      const hot = view.hot || [];
      for (const k of ['pc', 'm7c', 'txb', '241', 'phb', 'tower']) {
        const on = hot.includes(k === '241' ? 'g241' : k);
        tint(O['ST_' + k], on && !(k === 'tower' && view.servos && Object.keys(view.servos).length) ? COL.A : null, 0.32);
      }
      tint(O.PC_panel, null); if (O.PC_panel) O.PC_panel.material.emissiveIntensity = hot.includes('pc') ? 1.6 : 0.9;
      const wires = view.wires || {};
      for (const n in O) if (n.startsWith('WIRE_') && n !== 'WIRE_12v') {
        const lv = wires[n];
        if (lv) { O[n].material.color.set(COL[lv]); tint(O[n], COL[lv], lv === 'Z' ? 0.05 : 0.7); } else tint(O[n], null);
      }
      const lit = view.servos || {};
      for (let id = 1; id <= 17; id++) {
        const s = O['SERVO_' + id], st = lit[id];
        if (!s) continue;
        if (st) { s.material.color.set(COL[st]); tint(s, COL[st], st === 'Z' ? 0.15 : 0.75); } else tint(s, null);
        const sp = O['SPOOL_' + id];
        if (sp && view.spools) { const ax = V(LAYOUT.desk.servos[id].spoolAxis); sp.quaternion.setFromAxisAngle(ax, view.spools[id] || 0); }
      }
      tint(O.TENDON_8, view.tendon8 ? COL.H : null, 0.8);
      const fg = view.fingers || {};
      for (const f in LAYOUT.desk.fingers) {
        const a = fg[f] || [0, 0, 0];
        LAYOUT.desk.fingers[f].segs.forEach((sg, i) => { const o = O[sg.name]; if (o) o.quaternion.setFromAxisAngle(V(sg.axis), a[i] || 0); });
      }
      route = view.flow ? buildRoute(view.flow.route) : null;
    } else route = null;
    if (name === 'servo') {
      const R = LAYOUT.servo.ratios, out = THREE.MathUtils.degToRad(view.outDeg || 0);
      const show = [30, 11, 4.6, 2.1];                                   // 画面上的倍数（真实是 288 : 1，照实转会糊成一片）
      for (let i = 0; i < 4; i++) { const g = O['SV_g' + i]; if (g) g.rotation.y = out * show[i] * (i % 2 ? 1 : -1); }
      if (O.SV_out) O.SV_out.rotation.y = out;
      const hot = view.hot || [];
      const map = { motor: ['SV_motor'], gears: ['SV_g0', 'SV_g1', 'SV_g2', 'SV_g3'], out: ['SV_out', 'SV_spool'], enc: ['SV_enc'], mcu: ['SV_mcu'], conn: ['SV_conn'] };
      for (const k in map) for (const n of map[k]) tint(O[n], hot.includes(k) ? COL.A : null, 0.6);
      if (O.SV_motor && view.current) tint(O.SV_motor, COL.H, Math.min(1.4, view.current / 220));
      void R;
    }
    if (name === 'finger') {
      const sr = (view.rs || F.rs) / F.rs, jr = (view.rj || F.rj) / F.rj;
      if (O.FG_spool) { O.FG_spool.rotation.z = -THREE.MathUtils.degToRad(view.spoolDeg || 0); O.FG_spool.scale.set(sr, sr, 1); }
      if (O.FG_p1) O.FG_p1.rotation.z = -THREE.MathUtils.degToRad(view.jointDeg || 0);
      if (O.FG_pulley) O.FG_pulley.scale.set(jr, jr, 1);
      if (O.FG_ball) O.FG_ball.visible = !!view.ball;
      drawTendons(view);
    }
    dirty = true;
  }

  // ---------- 镜头 ----------
  function aim(name, focus, zoom = 1, dir = null) {
    const L = LAYOUT[name], mn = V(L.bounds.min), mx = V(L.bounds.max);
    const lo = mn.clone().min(mx), hi = mn.clone().max(mx);
    const center = lo.clone().add(hi).multiplyScalar(0.5), size = hi.clone().sub(lo);
    let target = center, half = new THREE.Vector2(size.x / 2, Math.max(size.y, size.z * 0.6) / 2);
    const fl = Array.isArray(focus) ? focus : focus && focus !== 'all' ? [focus] : null;
    if (fl) {
      const pts = fl.map((k) => V(L.anchors[k])).filter(Boolean);
      const b = new THREE.Box3().setFromPoints(pts);
      target = b.getCenter(new THREE.Vector3());
      const s = b.getSize(new THREE.Vector3());
      const pad = Math.max(size.x, size.y) * 0.17;
      half = new THREE.Vector2(s.x / 2 + pad, Math.max(s.y, s.z) / 2 + pad * 0.8);
    }
    camGoal.target.copy(target);
    camGoal.half = half; camGoal.zoom = zoom;
    camGoal.dir.set(...(dir || DIRS[name])).normalize();
    fitDist(); camGoal.moving = true;
    controls.minDistance = camGoal.dist * 0.35; controls.maxDistance = camGoal.dist * 2.6;
  }
  function fitDist() {
    if (!camGoal.half) return;
    const v = THREE.MathUtils.degToRad(camera.fov) / 2, hz = Math.atan(Math.tan(v) * camera.aspect);
    camGoal.dist = Math.max(camGoal.half.y / Math.tan(v), camGoal.half.x / Math.tan(hz)) * 1.12 / (camGoal.zoom || 1);
  }
  function fit() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fitDist(); camGoal.moving = true; dirty = true;
  }
  fit();
  new ResizeObserver(fit).observe(canvas);
  controls.addEventListener('change', () => { dirty = true; });
  controls.addEventListener('start', () => { camGoal.moving = false; });

  // ---------- 点选（只是轻点，不是拖） ----------
  const ray = new THREE.Raycaster(); let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || !pickCb || active !== 'desk' || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(roots.desk.children, true)[0];
    if (!hit) return;
    const n = hit.object.name; let k = null;
    if (/^(ST_pc|PC_)/.test(n)) k = 'pc'; else if (/^(ST_m7c|M7C_)/.test(n)) k = 'm7c'; else if (/^(ST_txb|TXB_)/.test(n)) k = 'txb';
    else if (/^(ST_241|G241_)/.test(n)) k = 'g241'; else if (/^(ST_phb|PHB_)/.test(n)) k = 'phb';
    else if (/^(ST_tower|SERVO_|SPOOL_)/.test(n)) k = 'tower'; else if (/^(F_|HAND_)/.test(n)) k = 'hand';
    const m = /^(SERVO|SPOOL)_(\d+)$/.exec(n);
    if (k) pickCb(k, m ? +m[2] : null);
  });

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const p = new THREE.Vector3();
  let last = 0, phase = 0;
  (function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, ((t || 0) - last) / 1000); last = t || 0;
    if (camGoal.moving && active) {
      const k = reduce ? 1 : 1 - Math.pow(0.002, dt);
      controls.target.lerp(camGoal.target, k);
      const want = camGoal.target.clone().addScaledVector(camGoal.dir, camGoal.dist);
      camera.position.lerp(want, k);
      if (camera.position.distanceTo(want) < 0.002) camGoal.moving = false;
      dirty = true;
    }
    // 光点
    let any = false;
    if (route && view && view.flow && active === 'desk') {
      const f = view.flow, size = (f.size || 1) * 0.05;
      if (typeof f.t === 'number') {
        dots.forEach((d, i) => {
          d.visible = i < 5; if (!d.visible) return;
          routeAt(route, f.t - i * 0.012, p); d.position.copy(p); d.scale.setScalar(size * (1 - i * 0.16)); d.material.color.set(f.color || COL.H);
        });
      } else {
        phase = (phase + dt * (f.speed || 0.22)) % 1;
        const n = Math.min(dots.length, f.count || 6);
        dots.forEach((d, i) => {
          d.visible = i < n; if (!d.visible) return;
          routeAt(route, (phase + i / n) % 1, p); d.position.copy(p); d.scale.setScalar(size * 0.8); d.material.color.set(f.color || COL.H);
        });
        if (!reduce) dirty = true;
      }
      any = true;
    }
    if (!any) dots.forEach((d) => { if (d.visible) { d.visible = false; dirty = true; } });
    if (view && view.tick) { if (view.tick(dt) !== false) dirty = true; }
    if (controls.update()) dirty = true;
    if (dirty) { renderer.render(scene, camera); placeLabels(); dirty = false; }
  })();

  return {
    set(v) { view = v; apply(false); },
    refresh() { apply(false); },
    onPick(fn) { pickCb = fn; },
    // 一条路线走到第 n 段结束时，占整条路线的几分之几
    frac(list, n) { const all = buildRoute(list).total; return n <= 0 ? 0 : buildRoute(list.slice(0, n)).total / all; },
    get ready() { return ready === 3; },
  };
}
