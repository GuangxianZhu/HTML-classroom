// 三维舞台：载入主楼和造楼机模型，按进度显隐；基坑、地连墙、内支撑、围挡在这里现场生成。
// Blender 是 z 向上，glTF 转成 y 向上：Blender (x, y, z) → three (x, z, -y)。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { coreFill, visible } from './core.js';
import { Life } from './life.js';

const V = (x, y, z) => new THREE.Vector3(x, z, -y);   // Blender 坐标 → three

// 造楼机安装 / 拆除的先后：build 进度超过阈值就显示（拆除时反过来）
const BUILD_ORDER = [
  [0.0, ['ZLJ_SeatsUpper', 'ZLJ_SeatsLower', 'ZLJ_CylFrames', 'ZLJ_Columns', '#rods']],
  [0.22, ['ZLJ_Bailey', 'ZLJ_Edge', 'ZLJ_Deck', 'ZLJ_Pumps']],
  [0.42, ['ZLJ_FormRails', 'ZLJ_Forms', 'ZLJ_Hangers']],
  [0.58, ['ZLJ_Walkways', 'ZLJ_Guard', 'ZLJ_FlipPlates', 'ZLJ_Stairs', 'ZLJ_HatchRails']],
  [0.76, ['ZLJ_Mesh', 'ZLJ_MeshFrame', 'ZLJ_Aux']],
  [0.9, ['ZLJ_Boom1', 'ZLJ_Boom2']],
];

export class Stage {
  constructor(canvas, sch, spec, P) {
    this.canvas = canvas;
    this.sch = sch;
    this.spec = spec;
    this.P = P;
    this.opts = { mesh: true, cut: false, follow: true };
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.localClippingEnabled = true;
    this.renderer = r;
    const sc = new THREE.Scene();
    this.scene = sc;
    const pm = new THREE.PMREMGenerator(r);
    sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    sc.environmentIntensity = 0.5;
    sc.add(new THREE.HemisphereLight(0xe4ecf7, 0x6d675a, 0.85));
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.9);
    sun.position.set(260, 380, 180);
    sc.add(sun);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 8000);
    this.camera.position.set(260, 160, 300);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 1600;
    this.controls.target.set(10, 0, -6);
    this.clip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    this.view = 'all';
    this.tween = null;
    this.lastFocus = null;
    this.labels = [];
    this.mats = new Set();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async load(towerBuf, zljBuf, machBuf) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const parse = (u8) => new Promise((res, rej) => loader.parse(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), '', res, rej));
    const [tg, zg, mg] = await Promise.all([parse(towerBuf), parse(zljBuf), parse(machBuf)]);
    this.tower = tg.scene;
    this.zlj = zg.scene;
    this.scene.add(this.tower, this.zlj);
    // 主楼：每个带 stage/floor 的节点
    this.items = [];
    this.cores = {};
    this.tower.traverse((o) => {
      const u = o.userData;
      if (u && u.stage !== undefined && u.floor !== undefined) {
        const it = { obj: o, stage: u.stage, floor: u.floor, py: o.position.y, sy: o.scale.y };
        this.items.push(it);
        if (u.stage === 'core') this.cores[u.floor] = it;
      }
    });
    // 造楼机
    this.zRoot = this.zlj.getObjectByName('ZAOLOJI');
    this.zMove = this.zlj.getObjectByName('ZLJ_Moving');
    this.zMoveY = this.zMove.position.y;
    this.zRootY = this.zRoot.position.y;
    this.slews = ['ZLJ_Boom1_Slew', 'ZLJ_Boom2_Slew'].map((n) => {
      const o = this.zlj.getObjectByName(n);
      return { o, q: o.quaternion.clone() };
    });
    const rodsGlb = this.zlj.getObjectByName('ZLJ_CylRods');
    if (rodsGlb) rodsGlb.visible = false;
    this._buildRods();
    this.groups = BUILD_ORDER.map(([th, names]) => [th, names.flatMap((nm) => this._find(nm))]);
    this.meshObjs = ['ZLJ_Mesh', 'ZLJ_MeshFrame'].flatMap((nm) => this._find(nm));
    // 材质：半透明的别写深度，统一收集起来做剖切
    for (const root of [this.tower, this.zlj]) root.traverse((o) => {
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (m.transparent) { m.depthWrite = false; m.side = THREE.DoubleSide; }
        this.mats.add(m);
      }
    });
    this._buildSite();
    this._buildLabels();
    this.cages = {};
    this.cageMat = new THREE.MeshBasicMaterial({ color: 0xb4602a, wireframe: true, transparent: true, opacity: 0.85 });
    this.mats.add(this.cageMat);
    this.life = new Life(this, mg.scene);
    this.setCut(this.opts.cut);
  }

  _find(name) {
    if (name === '#rods') return [this.rodGroup];
    const out = [];
    for (const parent of [this.zRoot, this.zMove]) for (const c of parent.children) if (c.name.startsWith(name)) out.push(c);
    return out;
  }

  // 活塞杆：每个支点一根，自己画，长度随行程变
  _buildRods() {
    const Q = this.P.platform;
    const zc1 = Q.seat_z[1] + 0.6 + 0.04 + Q.cyl.closed;
    this.rodZ0 = zc1 - 0.2;
    const g = new THREE.Group();
    g.name = 'rods';
    const geo = new THREE.CylinderGeometry(Q.cyl.rod / 2, Q.cyl.rod / 2, 1, 16);
    geo.translate(0, 0.5, 0);
    const head = new THREE.BoxGeometry(0.5, 0.14, 0.5);
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x34363a, metalness: 0.6, roughness: 0.5 });
    this.rods = [];
    for (const s of this.spec.zaoloji.supports) {
      const p = V(s.col[0], s.col[1], this.rodZ0);
      const rod = new THREE.Mesh(geo, chrome);
      rod.position.copy(p);
      const hd = new THREE.Mesh(head, dark);
      hd.position.copy(p);
      g.add(rod, hd);
      this.rods.push({ rod, hd });
    }
    this.mats.add(chrome);
    this.mats.add(dark);
    this.zRoot.add(g);
    this.rodGroup = g;
  }

  _buildSite() {
    const B = this.P.tower.basement;
    const [cx, cy] = B.center, [sx, sy] = B.size;
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2;
    const dw = 1.0;
    const site = new THREE.Group();
    this.scene.add(site);
    const mat = (c, rough = 0.95, extra = {}) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0, ...extra });
      this.mats.add(m);
      return m;
    };
    // Blender 包围盒 → three 的方块
    const boxB = (lo, hi, m, parent = site) => {
      const g = new THREE.BoxGeometry(hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]);
      const o = new THREE.Mesh(g, m);
      o.position.copy(V((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2));
      parent.add(o);
      return o;
    };
    // 地面：大方块挖掉基坑
    const G = 1500, hx0 = x0 - dw, hx1 = x1 + dw, hy0 = y0 - dw, hy1 = y1 + dw;
    const ground = mat(0x77746b);
    for (const [a, b] of [[[-G, -G], [G, hy0]], [[-G, hy1], [G, G]], [[-G, hy0], [hx0, hy1]], [[hx1, hy0], [G, hy1]]]) boxB([a[0], a[1], -2], [b[0], b[1], -0.02], ground);
    // 围挡里面的硬化地面
    const fx0 = x0 - 26, fx1 = x1 + 26, fy0 = y0 - 30, fy1 = y1 + 24;
    const pave = mat(0x8f8d86);
    for (const [a, b] of [[[fx0, fy0], [fx1, hy0]], [[fx0, hy1], [fx1, fy1]], [[fx0, hy0], [hx0, hy1]], [[hx1, hy0], [fx1, hy1]]]) boxB([a[0], a[1], -0.02], [b[0], b[1], 0.0], pave);
    // 围挡：蓝色板 + 白色压顶，南边留大门
    this.fence = new THREE.Group();
    site.add(this.fence);
    const blue = mat(0x2d66b0, 0.6), white = mat(0xe8eaec, 0.6);
    const gate = [cx - 7, cx + 7];
    const fenceRuns = [[[fx0, fy1], [fx1, fy1]], [[fx0, fy0], [fx0, fy1]], [[fx1, fy0], [fx1, fy1]], [[fx0, fy0], [gate[0], fy0]], [[gate[1], fy0], [fx1, fy0]]];
    for (const [a, b] of fenceRuns) {
      const lo = [Math.min(a[0], b[0]) - 0.08, Math.min(a[1], b[1]) - 0.08], hi = [Math.max(a[0], b[0]) + 0.08, Math.max(a[1], b[1]) + 0.08];
      boxB([lo[0], lo[1], 0], [hi[0], hi[1], 2.2], blue, this.fence);
      boxB([lo[0] - 0.03, lo[1] - 0.03, 2.2], [hi[0] + 0.03, hi[1] + 0.03, 2.5], white, this.fence);
    }
    for (const gx of gate) boxB([gx - 0.4, fy0 - 0.4, 0], [gx + 0.4, fy0 + 0.4, 4.2], white, this.fence);
    boxB([gate[0] - 0.4, fy0 - 0.4, 4.2], [gate[1] + 0.4, fy0 + 0.4, 5.0], blue, this.fence);
    // 地下连续墙：沿基坑一圈，一幅 6 m，按进度一幅幅出现
    const panels = [];
    const ring = [[[hx0, hy0], [hx1, hy0], 'x', [y0 - dw, y0]], [[hx1, hy0], [hx1, hy1], 'y', [x1, x1 + dw]],
      [[hx1, hy1], [hx0, hy1], 'x', [y1, y1 + dw]], [[hx0, hy1], [hx0, hy0], 'y', [x0 - dw, x0]]];
    for (const [a, b, ax, th] of ring) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.round(L / 6);
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const pa = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], pb = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        const lo = ax === 'x' ? [Math.min(pa[0], pb[0]) + 0.03, th[0]] : [th[0], Math.min(pa[1], pb[1]) + 0.03];
        const hi = ax === 'x' ? [Math.max(pa[0], pb[0]) - 0.03, th[1]] : [th[1], Math.max(pa[1], pb[1]) - 0.03];
        panels.push([lo, hi]);
      }
    }
    const dwMat = mat(0x8f8e88, 0.9);
    this.dwPanels = panels.map(([lo, hi]) => boxB([lo[0], lo[1], -36], [hi[0], hi[1], 0.15], dwMat));
    this.capBeam = new THREE.Group();
    site.add(this.capBeam);
    const capM = mat(0x9c9b95, 0.9);
    for (const [lo, hi] of [[[hx0, hy0], [hx1, y0]], [[hx0, y1], [hx1, hy1]], [[hx0, y0], [x0, y1]], [[x1, y0], [hx1, y1]]]) boxB([lo[0] - 0.2, lo[1] - 0.2, -1.0], [hi[0] + 0.2, hi[1] + 0.2, 0.25], capM, this.capBeam);
    // 基坑里的土：顶面就是当前开挖面
    this.dirt = boxB([x0, y0, -60], [x1, y1, 0], mat(0x7a6650));
    this.dirtBottom = -60;
    // 内支撑：围檩 + 四角斜撑（地下室顶板做完后拆掉，叫“换撑”）
    this.struts = new THREE.Group();
    site.add(this.struts);
    const sm = mat(0xb8b6ae, 0.85);
    const zs = -2.0;
    for (const [lo, hi] of [[[x0, y0], [x1, y0 + 1.0]], [[x0, y1 - 1.0], [x1, y1]], [[x0, y0], [x0 + 1.0, y1]], [[x1 - 1.0, y0], [x1, y1]]]) boxB([lo[0], lo[1], zs - 0.5], [hi[0], hi[1], zs + 0.5], sm, this.struts);
    for (const [px, py, ex, ey] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]]) {
      for (const a of [12, 22, 32]) {
        const p = V(px + ex * a, py + ey * 0.8, zs), q = V(px + ex * 0.8, py + ey * a, zs);
        const len = p.distanceTo(q);
        const o = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 1.0), sm);
        o.position.copy(p).add(q).multiplyScalar(0.5);
        o.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
        this.struts.add(o);
      }
    }
    this.site = site;
    this.pitBox = { x0, x1, y0, y1 };
  }

  _buildLabels() {
    const wrap = this.canvas.parentElement;
    const mk = (cls, text) => {
      const d = document.createElement('div');
      d.className = 'tag ' + cls;
      d.innerHTML = text;
      wrap.appendChild(d);
      return d;
    };
    this.labels = [
      { key: 'core', el: mk('t-core', '') },
      { key: 'steel', el: mk('t-steel', '') },
      { key: 'slab', el: mk('t-slab', '') },
      { key: 'curtain', el: mk('t-curtain', '') },
    ];
  }

  setCut(on) {
    this.opts.cut = on;
    for (const m of this.mats) { m.clippingPlanes = on ? [this.clip] : null; m.needsUpdate = true; }
  }

  // ---------------------------------------------------------------- 按进度摆
  apply(st) {
    const sch = this.sch, day = st.day;
    this.state = st;
    for (const it of this.items) {
      if (it.stage === 'core' && it.floor >= 1) {
        const f = coreFill(sch, it.floor, day);
        it.obj.visible = f > 0;
        if (f > 0) {
          const z0 = sch.z[it.floor];
          it.obj.position.y = z0 + (it.py - z0) * f;
          it.obj.scale.y = it.sy * f;
        }
      } else {
        it.obj.visible = visible(sch, it.stage, it.floor, day);
      }
    }
    // 钢筋笼：当前层从绑钢筋到浇完
    for (const k in this.cages) this.cages[k].visible = false;
    const c = st.core;
    if (c.cur && c.cur <= sch.N && c.step <= 2) {
      const cage = this._cage(c.cur);
      if (cage) cage.visible = true;
    }
    // 造楼机
    const pl = st.plat;
    this.zRoot.visible = pl.show;
    if (pl.show) {
      this.zRoot.position.y = this.zRootY + pl.rootZ;
      this.zMove.position.y = this.zMoveY + pl.lift;
      for (const [th, objs] of this.groups) for (const o of objs) o.visible = pl.build > th || pl.build >= 1;
      if (!this.opts.mesh && pl.build >= 1) for (const o of this.meshObjs) o.visible = false;
      const zc1 = this.rodZ0 + 0.2;
      const len = zc1 + pl.rodExt + 0.05 - this.rodZ0;
      for (const r of this.rods) {
        r.rod.scale.y = len;
        r.hd.position.y = this.rodZ0 + len + 0.07;
      }
      const ax = new THREE.Vector3(0, 1, 0);
      this.slews.forEach((s, i) => {
        s.o.quaternion.copy(s.q).multiply(new THREE.Quaternion().setFromAxisAngle(ax, (i ? -1 : 1) * pl.slew));
      });
    }
    // 基坑
    const pit = st.pit;
    this.fence.visible = pit.fence;
    const nPanel = Math.round(pit.dwall * this.dwPanels.length);
    this.dwPanels.forEach((o, i) => { o.visible = i < nPanel; });
    this.capBeam.visible = pit.dwall >= 1;
    const top = pit.depth;
    this.dirt.scale.y = Math.max(0.001, (top - this.dirtBottom) / 60);
    this.dirt.position.y = (top + this.dirtBottom) / 2;
    this.struts.visible = pit.struts;
  }

  _cage(n) {
    if (this.cages[n]) return this.cages[n];
    const it = this.cores[n];
    if (!it) return null;
    const g = it.obj.clone(true);
    g.position.y = it.py;
    g.scale.y = it.sy;
    g.traverse((o) => { if (o.isMesh) o.material = this.cageMat; });
    it.obj.parent.add(g);
    this.cages[n] = g;
    return g;
  }

  // ---------------------------------------------------------------- 机位
  topZ() {
    const st = this.state;
    if (!st) return 0;
    const pl = st.plat;
    let z = st.counts.core > 0 ? this.sch.z[st.counts.core + 1] : 0;
    if (pl.show) z = Math.max(z, pl.rootZ + pl.lift + this.spec.zaoloji.deck + 2);
    if (st.day >= this.sch.roofDay) z = this.spec.tower.top;
    if (this.life && this.life.craneTop) z = Math.max(z, this.life.craneTop + 13);
    return z;
  }

  focus(view) {
    const st = this.state, sch = this.sch;
    const top = this.topZ();
    const pl = st ? st.plat : { show: false };
    switch (view) {
      case 'zlj':
        if (pl.show) {
          const y = pl.rootZ + pl.lift + 2;
          return { t: new THREE.Vector3(0, y, 0), off: new THREE.Vector3(44, 24, 54) };
        }
        return this.focus('all');
      case 'support':
        if (pl.show) {
          const y = pl.rootZ + pl.lift - 6.5;
          return { t: V(-4, -12.6, y), off: new THREE.Vector3(6.5, 1.2, 10.5) };
        }
        return this.focus('all');
      case 'floor': {
        const f = Math.max(1, st ? st.counts.steel : 1);
        const z = sch.z[Math.min(f + 1, sch.N + 1)];
        return { t: V(14, -14, z - 4), off: new THREE.Vector3(34, 12, 30) };
      }
      case 'pit':
        return { t: V(10, 6, -10), off: new THREE.Vector3(112, 88, 138) };
      default: {
        const h = Math.max(top, 20);
        const d = Math.min(Math.max(h * 2.0, 200), 700);
        return { t: V(6, 2, h * 0.5), off: new THREE.Vector3(0.62, 0.30, 0.72).multiplyScalar(d) };
      }
    }
  }

  // 调试 / 截图：直接给机位（Blender 坐标）
  setCam(x, y, z, tx, ty, tz) {
    this.view = 'free';
    this.tween = null;
    this.camera.position.copy(V(x, y, z));
    this.controls.target.copy(V(tx, ty, tz));
    this.lastFocus = null;
  }

  setView(view, instant = false) {
    this.view = view;
    const f = this.focus(view);
    const auto = view === 'support';
    this.autoMeshOff = auto;
    const from = { t: this.controls.target.clone(), p: this.camera.position.clone() };
    const to = { t: f.t, p: f.t.clone().add(f.off) };
    if (instant) {
      this.controls.target.copy(to.t);
      this.camera.position.copy(to.p);
    } else this.tween = { from, to, t0: performance.now(), dur: 900 };
    this.lastFocus = f.t.clone();
  }

  frame(now) {
    if (this.tween) {
      const k = Math.min(1, (now - this.tween.t0) / this.tween.dur);
      const e = k * k * (3 - 2 * k);
      this.controls.target.lerpVectors(this.tween.from.t, this.tween.to.t, e);
      this.camera.position.lerpVectors(this.tween.from.p, this.tween.to.p, e);
      if (k >= 1) this.tween = null;
    } else if (this.opts.follow && this.lastFocus && this.view !== 'pit') {
      // 跟随：目标点跟着工地高度走，保持当前的视角和距离
      const f = this.focus(this.view);
      const d = f.t.clone().sub(this.lastFocus);
      if (d.lengthSq() > 1e-6) {
        const step = d.multiplyScalar(0.12);
        this.controls.target.add(step);
        this.camera.position.add(step);
        this.lastFocus.add(step);
      }
      if (this.view === 'all') {
        // 全景：楼长高了，镜头也慢慢拉远，保持整栋楼在画面里
        const off = this.camera.position.clone().sub(this.controls.target);
        const len = off.length(), want = f.off.length();
        if (Math.abs(want - len) > 0.5) {
          off.setLength(len + (want - len) * 0.04);
          this.camera.position.copy(this.controls.target).add(off);
        }
      }
    }
    // 支点机位自动拿掉防护网
    if (this.state && this.state.plat.show && this.state.plat.build >= 1) {
      const meshOn = this.opts.mesh && !this.autoMeshOff;
      for (const o of this.meshObjs) o.visible = meshOn;
    }
    if (this.life) {
      this.life.root.visible = this.opts.life !== false;
      if (this.state && this.opts.life !== false) this.life.update(this.state, now / 1000);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._labels();
  }

  _labels() {
    const st = this.state;
    if (!st) return;
    const el = this.canvas;
    const w = el.clientWidth, h = el.clientHeight;
    const names = { core: '核心筒', steel: '钢梁', slab: '楼板', curtain: '幕墙' };
    const off = { core: [12.5, -12.5], steel: [24, -24], slab: [24.9, -24.9], curtain: [25.6, -25.6] };
    for (const L of this.labels) {
      const n = st.counts[L.key];
      if (n < 1 || n >= this.sch.N) { L.el.hidden = true; continue; }
      const z = this.sch.z[n + 1];
      const p = V(off[L.key][0], off[L.key][1], z).project(this.camera);
      const vis = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      L.el.hidden = !vis;
      if (!vis) continue;
      L.el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`;
      L.el.innerHTML = `${names[L.key]} <b>${n}F</b>`;
    }
  }
}
