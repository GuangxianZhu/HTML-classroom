// 楼层上的工序一件件推进：楼承板一张张铺、楼板先铺钢筋再浇混凝土、幕墙一块块装、临边防护；
// 地下室：筏板钢筋 + 分段浇筑、每层顶板 满堂支模架 → 模板 → 钢筋 → 浇筑。
//
// 做法：正在做的那一层，把它的模型换成“揭开”材质——着色器按位置算一个坐标 s（沿楼层一圈的周长，或沿 x），
// s 超过当前进度的片元丢掉；浇筑时进度前沿几米颜色压深（湿混凝土）。那层做完（stage.apply 让它正常显示）就换回原材质。
// 进度按天数算；暂停时也按真实时间慢慢往前做（和塔吊一样），换层或往回拖就重来。
import * as THREE from 'three';
import { V, place, clamp, lerp, smooth, frac } from './util.js';

const PERIM = 8;                     // 一圈 = 8E（E 是半边长）

// 沿正方形一圈的坐标 → 点（和着色器里的 s 一一对应）：南边自西向东、东边自南向北、北边自东向西、西边自北向南
export function perimPt(s, E) {
  const L = PERIM * E;
  s = ((s % L) + L) % L;
  const side = Math.floor(s / (2 * E)), u = s - side * 2 * E;
  switch (side) {
    case 0: return { x: -E + u, y: -E, nx: 0, ny: -1, tx: 1, ty: 0 };
    case 1: return { x: E, y: -E + u, nx: 1, ny: 0, tx: 0, ty: 1 };
    case 2: return { x: E - u, y: E, nx: 0, ny: 1, tx: -1, ty: 0 };
    default: return { x: -E, y: E - u, nx: -1, ny: 0, tx: 0, ty: -1 };
  }
}

// 揭开材质：在原材质上打补丁。U 是几块材质共用的 uniform（同一道工序）
function revealMat(src, U) {
  const m = src.clone();
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRvW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 rvw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          rvw = instanceMatrix * rvw;
        #endif
        vRvW = (modelMatrix * rvw).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRvW;
        uniform float uFront, uQuant, uWet, uWetMul, uE, uMode, uX0;
        float rvS() {
          vec2 p = vec2(vRvW.x, -vRvW.z);
          if (uMode > 0.5) return p.x - uX0;
          float ax = abs(p.x), ay = abs(p.y), E = uE;
          if (ay >= ax) return p.y < 0.0 ? p.x + E : 4.0 * E + (E - p.x);
          return p.x > 0.0 ? 2.0 * E + (p.y + E) : 6.0 * E + (E - p.y);
        }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float rvs = rvS();
        float rvq = uQuant > 0.0 ? floor(rvs / uQuant + 1e-4) * uQuant : rvs;
        if (rvq >= uFront) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (rvs > uFront - uWet) diffuseColor.rgb *= vec3(uWetMul * 0.92, uWetMul, uWetMul * 1.1);   // 刚浇的：深一点、偏冷`);
  };
  m.customProgramCacheKey = () => 'reveal-v2';
  return m;
}
const mkU = (E, mode = 0, x0 = 0, quant = 0, wet = 0) => ({
  uFront: { value: 0 }, uQuant: { value: quant }, uWet: { value: wet }, uWetMul: { value: 0.55 }, uE: { value: E }, uMode: { value: mode }, uX0: { value: x0 },
});

// 一片矩形区域里的双向钢筋：[中心 x, 中心 y, x 向长, y 向长, 层]
function gridBars(rects, sp) {
  const out = [];
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0 + sp / 2; y < y1; y += sp) out.push([(x0 + x1) / 2, y, x1 - x0, 0, 0]);
    for (let x = x0 + sp / 2; x < x1; x += sp) out.push([x, (y0 + y1) / 2, 0, y1 - y0, 1]);
  }
  return out;
}

export class Works {
  constructor(stage) {
    this.st = stage;
    this.sch = stage.sch;
    this.P = stage.P;
    this.spec = stage.spec;
    const T = this.P.tower, B = T.basement;
    this.root = new THREE.Group();
    this.root.name = 'works';
    stage.scene.add(this.root);
    // 主楼构件按 工种 / 层 索引
    this.it = {};
    for (const it of stage.items) (this.it[it.stage] ||= {})[it.floor] = it;
    const [cx, cy] = B.center, [sx, sy] = B.size;
    this.bx = { x0: cx - sx / 2, x1: cx + sx / 2, y0: cy - sy / 2, y1: cy + sy / 2 };
    const bx = this.bx;
    this.E = { slab: T.slab.edge, curtain: T.curtain.plane };
    const C = T.curtain;
    this.nMod = Math.round((2 * C.plane) / C.module);
    this.mw = (2 * C.plane) / this.nMod;
    this.nPanel = 4 * this.nMod;
    this.sheet = 0.6;
    this.nSheet = Math.round((PERIM * this.E.slab) / this.sheet);
    // 每道工序一组 uniform
    this.U = {
      deck: mkU(this.E.slab, 0, 0, this.sheet),
      rebar: mkU(this.E.slab),
      slab: mkU(this.E.slab, 0, 0, 0, 3.5),
      curtain: mkU(this.E.curtain, 0, 0, this.mw),
      raft: mkU(0, 1, bx.x0, 0, 5),
      rebarB: mkU(0, 1, bx.x0),
      shore: mkU(0, 1, bx.x0),
      ply: mkU(0, 1, bx.x0),
      bslab: mkU(0, 1, bx.x0, 0, 4),
    };
    this.cache = new Map();
    this.swapped = {};
    this.rt = {};
    this.crew = [];
    this.stat = [];
    this.pour = null;
    const mat = (c, o = {}) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.2, ...o }); return m; };
    const byName = (n) => [...stage.mats].find((m) => m.name === n);
    this.rebarMat = mat(0x8a5a3a, { metalness: 0.4 });
    const box = new THREE.BoxGeometry(1, 1, 1);

    // ---- 楼板钢筋网（核心筒外面一圈，0.25 m 双向）
    const E = this.E.slab - 0.15, a = T.core.half + 0.2;
    this.rebarF = this._bars(gridBars([[-E, -E, E, -a], [-E, a, E, E], [-E, -a, -a, a], [a, -a, E, a]], 0.25), 0.014, this.rebarMat, this.U.rebar);
    // ---- 筏板钢筋、地下室顶板钢筋（0.3 m 双向）
    this.rebarR = this._bars(gridBars([[bx.x0 + 0.5, bx.y0 + 0.5, bx.x1 - 0.5, bx.y1 - 0.5]], 0.3), 0.02, this.rebarMat, this.U.rebarB);
    const ac = T.core.half + 0.3;
    this.rebarS = this._bars(gridBars([[bx.x0 + 0.9, bx.y0 + 0.9, bx.x1 - 0.9, -ac], [bx.x0 + 0.9, ac, bx.x1 - 0.9, bx.y1 - 0.9], [bx.x0 + 0.9, -ac, -ac, ac], [ac, -ac, bx.x1 - 0.9, ac]], 0.3), 0.016, this.rebarMat, this.U.rebarB);

    // ---- 满堂支模架（盘扣架，立杆 1.5 m 见方）+ 模板
    const pts = [];
    for (let x = bx.x0 + 1.2; x < bx.x1 - 1.0; x += 1.5) for (let y = bx.y0 + 1.2; y < bx.y1 - 1.0; y += 1.5) if (!(Math.abs(x) < ac && Math.abs(y) < ac)) pts.push([x, y]);
    this.shorePts = pts;
    const shoreM = this._reveal(mat(0xa9b2ba, { metalness: 0.6, roughness: 0.45 }), 'shore');
    const pole = new THREE.CylinderGeometry(0.024, 0.024, 1, 5).translate(0, 0.5, 0);
    this.poles = new THREE.InstancedMesh(pole, shoreM, pts.length);
    const rows = [];
    for (let y = bx.y0 + 1.2; y < bx.y1 - 1.0; y += 1.5) {
      if (Math.abs(y) < ac) rows.push([bx.x0 + 1.2, -ac, y, 0], [ac, bx.x1 - 1.0, y, 0]); else rows.push([bx.x0 + 1.2, bx.x1 - 1.0, y, 0]);
    }
    for (let x = bx.x0 + 1.2; x < bx.x1 - 1.0; x += 1.5) {
      if (Math.abs(x) < ac) rows.push([bx.y0 + 1.2, -ac, x, 1], [ac, bx.y1 - 1.0, x, 1]); else rows.push([bx.y0 + 1.2, bx.y1 - 1.0, x, 1]);
    }
    this.ledgerRows = rows;
    this.ledgers = new THREE.InstancedMesh(box, shoreM, rows.length * 2);
    const plyM = this._reveal(mat(0xc49a5c, { roughness: 0.7, metalness: 0.0 }), 'ply');   // 竹胶板模板
    this.ply = new THREE.Group();
    for (const [x0, y0, x1, y1] of [[bx.x0 + 0.8, bx.y0 + 0.8, bx.x1 - 0.8, -ac], [bx.x0 + 0.8, ac, bx.x1 - 0.8, bx.y1 - 0.8], [bx.x0 + 0.8, -ac, -ac, ac], [ac, -ac, bx.x1 - 0.8, ac]]) {
      const o = new THREE.Mesh(box, plyM);
      o.scale.set(x1 - x0, 0.04, y1 - y0);
      o.position.copy(V((x0 + x1) / 2, (y0 + y1) / 2, -0.02));
      this.ply.add(o);
    }
    this.root.add(this.poles, this.ledgers, this.ply);
    this.shoreLv = null;

    // ---- 临边防护：立杆每 2 m、两道横杆 + 踢脚板；每 3 层一道外挑安全网
    const yel = mat(0xe5b21a, { roughness: 0.5 }), red = mat(0xc9372b, { roughness: 0.6 });
    const netM = new THREE.MeshStandardMaterial({ color: 0x2f7d45, roughness: 0.9, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
    this.guardN = 16;                                // 最多同时几层
    this.gStep = 2.0;
    this.gPer = Math.round((PERIM * this.E.slab) / this.gStep);
    this.posts = new THREE.InstancedMesh(box, yel, this.guardN * this.gPer);
    this.rails = new THREE.InstancedMesh(box, yel, this.guardN * this.gPer * 2);
    this.toes = new THREE.InstancedMesh(box, red, this.guardN * this.gPer);
    this.nets = new THREE.InstancedMesh(box, netM, 4 * 8);
    for (const im of [this.posts, this.rails, this.toes, this.nets, this.poles, this.ledgers]) { im.count = 0; im.frustumCulled = false; }
    this.root.add(this.posts, this.rails, this.toes, this.nets);
    this.guardKey = '';

    // ---- 浇楼板的泵管软管
    const hoseM = mat(0x1d1f22, { roughness: 0.6 });
    this.hose = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1, 8).translate(0, 0.5, 0), hoseM);
    this.hose.frustumCulled = false;
    this.root.add(this.hose);

    // ---- 幕墙单轨吊：吊轨挂在上两层楼板边，一台电动葫芦小车 + 吊着的一块单元板
    const tr = mat(0x3b4148, { metalness: 0.7, roughness: 0.4 });
    this.rail = new THREE.Group();
    const Et = this.E.curtain + 0.75;
    for (let k = 0; k < 4; k++) {
      const p = perimPt(k * 2 * Et + Et, Et);
      const o = new THREE.Mesh(box, tr);
      o.scale.set(p.tx ? 2 * Et + 0.2 : 0.14, 0.24, p.ty ? 2 * Et + 0.2 : 0.14);
      o.position.copy(V(p.x, p.y, 0));
      this.rail.add(o);
      for (let s = 1.5; s < 2 * Et; s += 6) {
        const q = perimPt(k * 2 * Et + s, Et);
        const b = new THREE.Mesh(box, tr);
        const L = Et - this.E.slab + 0.3;
        b.scale.set(q.nx ? L : 0.12, 0.12, q.ny ? L : 0.12);
        b.position.copy(V(q.x - q.nx * L / 2, q.y - q.ny * L / 2, 0.3));
        this.rail.add(b);
      }
    }
    this.trolley = new THREE.Mesh(box, mat(0xe0662a));
    this.trolley.scale.set(0.5, 0.45, 0.4);
    this.panel = new THREE.Group();
    const glass = byName('glass') || mat(0x4d7a8c, { transparent: true, opacity: 0.55 });
    const alu = byName('alu') || mat(0xc8cacc, { metalness: 0.9 });
    this.panelGlass = new THREE.Mesh(box, glass);
    this.panelFrame = [0, 1, 2, 3].map(() => new THREE.Mesh(box, alu));
    this.panel.add(this.panelGlass, ...this.panelFrame);
    this.chain = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x222222 }));
    this.chain.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    this.chain.frustumCulled = false;
    this.root.add(this.rail, this.trolley, this.panel, this.chain);
    this.cw = { f: 0, nRt: 0, ci: -1, j: 0 };

    // 新做的材质也要能剖切、能被统一管理
    for (const m of [this.rebarMat, shoreM, plyM, yel, red, netM, hoseM, tr, this.trolley.material]) stage.mats.add(m);
  }

  _bars(list, d, m, U) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this._reveal(m, null, U), list.length);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion();
    list.forEach(([x, y, lx, ly, layer], i) => im.setMatrixAt(i, M.compose(V(x, y, layer * d), q, new THREE.Vector3(lx || d, d, ly || d))));
    im.frustumCulled = false;
    im.visible = false;
    this.root.add(im);
    return im;
  }

  _reveal(m, key, U = null) {
    const r = revealMat(m, U || this.U[key]);
    r.clippingPlanes = this.st.opts.cut ? [this.st.clip] : null;
    this.st.mats.add(r);
    return r;
  }

  // 正在做的那层：模型换成揭开材质；上一层换回来
  _swap(key, item) {
    const prev = this.swapped[key];
    if (prev === item) return;
    if (prev) prev.obj.traverse((o) => { if (o.isMesh && o.userData.m0) { o.material = o.userData.m0; delete o.userData.m0; } });
    this.swapped[key] = item || null;
    if (!item) return;
    item.obj.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.m0 = o.material;
      const one = (m) => {
        const ck = key + m.uuid;
        if (!this.cache.has(ck)) this.cache.set(ck, this._reveal(m, key));
        return this.cache.get(ck);
      };
      o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
    });
  }

  // 天数给的进度 vs 真实时间往前做的进度，取大的；换了 key 或往回拖就重来
  _prog(trade, key, pDay, t, rate) {
    let r = this.rt[trade];
    if (!r || r.key !== key || pDay < r.pDay - 1e-6) r = this.rt[trade] = { key, t0: t, base: pDay, pDay };
    r.pDay = pDay;
    if (pDay >= r.base + (t - r.t0) * rate) { r.base = pDay; r.t0 = t; }
    return clamp(Math.max(pDay, r.base + (t - r.t0) * rate), 0, 1);
  }

  _win(tr, f) {
    const sch = this.sch, t1 = sch.done[tr][f];
    const t0 = f > 1 ? sch.done[tr][f - 1] : t1 - sch.S.cycle;
    return [t0, t1];
  }

  _u(tr, f, day) {
    const [t0, t1] = this._win(tr, f);
    return clamp((day - t0) / Math.max(1e-6, t1 - t0), 0, 1.0001);
  }

  // ================================================================== 每帧
  update(st, t) {
    const sch = this.sch, day = st.day, N = sch.N, z = sch.z;
    this.crew = [];
    this.stat = [];
    this.pour = null;
    const crew = (x, y, zz, h, walk = false) => this.crew.push([x, y, zz, h, walk]);
    const ES = this.E.slab, PL = PERIM * ES;

    // ---------------- 楼承板：counts.deck + 1 层
    {
      const f = st.counts.deck + 1;
      const item = f <= N && day >= this._win('deck', f)[0] ? this.it.deck[f] : null;
      let p = 0;
      if (item) {
        p = this._prog('deck', f, clamp((this._u('deck', f, day) - 0.08) / 0.8, 0, 1), t, 1 / (3.5 * this.nSheet));
        if (p >= 1) item.obj.visible = true;
      }
      this._swap('deck', item && p > 0 && p < 1 ? item : null);
      if (item && p > 0 && p < 1) {
        item.obj.visible = true;
        const n = Math.floor(p * this.nSheet);
        this.U.deck.uFront.value = n * this.sheet;
        const q = perimPt((n + 0.5) * this.sheet, ES);
        const h = Math.atan2(q.ty, q.tx);
        for (const r of [15.5, 21]) crew(q.x * r / ES - q.tx * 0.6, q.y * r / ES - q.ty * 0.6, z[f + 1] - 0.1, h);
        this.stat.push({ key: 'deck', name: '铺楼承板', text: `第 ${f} 层 · ${n} / ${this.nSheet} 张`, p });
      }
    }

    // ---------------- 楼板：counts.slab + 1 层，先钢筋后浇筑
    {
      const f = st.counts.slab + 1;
      const ok = f <= N && st.counts.deck >= f && day >= this._win('slab', f)[0];
      const item = ok ? this.it.slab[f] : null;
      let pr = 0, pp = 0;
      if (ok) {
        const u = this._u('slab', f, day);
        pr = this._prog('rebar', f, clamp(u / 0.5, 0, 1), t, 1 / 480);
        const ppDay = clamp((u - 0.55) / 0.4, 0, 1);
        pp = pr >= 1 ? this._prog('pour', f, ppDay, t, 1 / 600) : ppDay;
      }
      this.rebarF.visible = ok && pr > 0 && pp < 1;
      if (this.rebarF.visible) {
        this.rebarF.position.y = z[f + 1] - 0.065;
        this.U.rebar.uFront.value = pr * PL;
      }
      this._swap('slab', item && pp > 0 && pp < 1 ? item : null);
      if (item && pp > 0) {
        item.obj.visible = true;
        this.U.slab.uFront.value = pp * PL;
      }
      this.hose.visible = !!(item && pp > 0 && pp < 1);
      if (ok && pr > 0 && pr < 1) {
        const q = perimPt(pr * PL, ES), h = Math.atan2(q.ty, q.tx);
        for (const r of [14, 18.5, 23]) crew(q.x * r / ES - q.tx * 0.8, q.y * r / ES - q.ty * 0.8, z[f + 1] - 0.03, h);
        this.stat.push({ key: 'rebar', name: '绑楼板钢筋', text: `第 ${f} 层 · ${Math.round(pr * 100)}%`, p: pr });
      }
      if (this.hose.visible) {
        const q = perimPt(pp * PL, ES), r = 18.5;
        const fx = q.x * r / ES, fy = q.y * r / ES;
        const m = Math.max(Math.abs(fx), Math.abs(fy));
        const cxp = (fx / m) * (this.P.tower.core.half + 0.3), cyp = (fy / m) * (this.P.tower.core.half + 0.3);
        const zz = z[f + 1] + 0.07;
        const A = V(cxp, cyp, zz), Bv = V(fx - q.tx * 0.6, fy - q.ty * 0.6, zz);
        const d = Bv.clone().sub(A);
        this.hose.position.copy(A);
        this.hose.scale.set(1, d.length(), 1);
        this.hose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        const h = Math.atan2(q.ty, q.tx);
        for (const [r2, back] of [[15, 1.2], [18.5, 1.6], [22, 1.2]]) crew(q.x * r2 / ES - q.tx * back, q.y * r2 / ES - q.ty * back, z[f + 1], h + Math.PI);
        this.stat.push({ key: 'pour', name: '浇楼板', text: `第 ${f} 层 · ${Math.round(pp * 100)}%`, p: pp });
      }
    }

    // ---------------- 幕墙：counts.curtain + 1 层，一块块装
    this._curtain(st, t, crew);

    // ---------------- 临边防护：楼面（第 h 层的地面 = z[h]）已经有楼板、但第 h 层幕墙还没装完
    this._guard(st);

    // ---------------- 地下室
    this._basement(st, t, crew);
  }

  _curtain(st, t, crew) {
    const sch = this.sch, N = sch.N, z = sch.z, day = st.day, EC = this.E.curtain;
    const f = st.counts.curtain + 1;
    const ok = f <= N && day >= this._win('curtain', f)[0] && st.counts.slab >= f;
    const item = ok ? this.it.curtain[f] : null;
    let n = 0;
    if (ok) {
      const nDay = Math.floor(clamp((this._u('curtain', f, day) - 0.05) / 0.9, 0, 1) * this.nPanel);
      if (this.cw.f !== f || nDay < this.cw.nDay - 0) this.cw = { f, nRt: 0, ci: -1, j: 0, nDay };
      this.cw.nDay = nDay;
      n = Math.min(this.nPanel, Math.max(nDay, this.cw.nRt));
    }
    const busy = !!item && n < this.nPanel;
    this._swap('curtain', busy && n > 0 ? item : null);
    if (item && busy && n > 0) item.obj.visible = true;
    if (item && n >= this.nPanel) item.obj.visible = true;
    this.U.curtain.uFront.value = n * this.mw;
    this.rail.visible = this.trolley.visible = this.panel.visible = this.chain.visible = busy;
    this.curtainFront = ok ? { f, n } : null;
    if (!busy) return;
    // 吊装循环 20 s：放下来 → 对位 → 挂好（这块算装上）→ 小车挪到下一块
    const T = 20, ci = Math.floor(t / T), u = frac(t / T) * T;
    if (ci !== this.cw.ci) { this.cw.ci = ci; this.cw.j = n; }
    let j = this.cw.j;
    if (j < n) j = this.cw.j = n;                        // 天数已经超过了：直接吊下一块
    if (u >= 14 && this.cw.nRt < j + 1) this.cw.nRt = j + 1;
    const hang = u < 14;
    const sc = (j + 0.5) * this.mw;
    const q = perimPt(sc, EC);
    const zr = z[Math.min(f + 3, N + 1)] - 0.45;
    this.rail.position.y = zr;
    const qt = perimPt(sc, EC);
    const tx = qt.x + qt.nx * 0.75, ty = qt.y + qt.ny * 0.75;
    this.trolley.position.copy(V(tx, ty, zr - 0.35));
    this.trolley.rotation.set(0, Math.atan2(q.ty, q.tx), 0);
    const H = z[f + 1] - z[f] - 0.12;
    const zb = hang ? lerp(zr - 1.0 - H, z[f] + 0.06, smooth(u / 11)) : z[f] + 0.06;
    const out = hang ? lerp(0.75, 0.05, smooth((u - 8) / 4)) : 0.05;   // 最后几秒往里推到挂件上
    this.panel.visible = hang;
    this.panel.position.copy(V(q.x + q.nx * out, q.y + q.ny * out, zb));
    this.panel.rotation.set(0, Math.atan2(q.ty, q.tx), 0);
    const w = this.mw - 0.04;
    this.panelGlass.scale.set(w - 0.08, H - 0.12, 0.03); this.panelGlass.position.set(0, H / 2, 0);
    const [fa, fb, fc, fd] = this.panelFrame;
    fa.scale.set(0.06, H, 0.1); fa.position.set(-w / 2, H / 2, 0);
    fb.scale.set(0.06, H, 0.1); fb.position.set(w / 2, H / 2, 0);
    fc.scale.set(w, 0.07, 0.12); fc.position.set(0, 0.035, 0);
    fd.scale.set(w, 0.07, 0.12); fd.position.set(0, H - 0.035, 0);
    const pa = this.chain.geometry.attributes.position;
    const top = V(tx, ty, zr - 0.55), bot = V(q.x + q.nx * out, q.y + q.ny * out, zb + H);
    const vs = hang ? [top, bot, bot, bot] : [top, V(tx, ty, zr - 1.2), top, top];
    vs.forEach((v, i) => pa.setXYZ(i, v.x, v.y, v.z));
    pa.needsUpdate = true;
    const h = Math.atan2(-q.ny, -q.nx);
    for (const s of [-0.9, 0.9]) crew(q.x - q.nx * 1.1 + q.tx * s, q.y - q.ny * 1.1 + q.ty * s, z[f], h + Math.PI);
    this.stat.push({ key: 'curtain', name: '装幕墙', text: `第 ${f} 层 · ${n} / ${this.nPanel} 块`, p: n / this.nPanel });
  }

  _guard(st) {
    const sch = this.sch, N = sch.N, z = sch.z;
    const h0 = Math.max(2, st.counts.curtain + 1), h1 = Math.min(N, st.counts.slab + 1);
    const cf = this.curtainFront;
    const key = `${h0}-${h1}-${cf ? cf.f + ':' + cf.n : ''}`;
    if (key === this.guardKey) return;
    this.guardKey = key;
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3();
    const ES = this.E.slab - 0.12, step = this.gStep;
    let np = 0, nr = 0, nt = 0, nn = 0;
    let levels = 0;
    for (let h = h1; h >= h0 && levels < this.guardN; h--, levels++) {
      const zf = z[h];
      const cut = cf && cf.f === h ? cf.n * this.mw * (ES / this.E.curtain) : 0;   // 这层幕墙装到哪，栏杆拆到哪
      for (let i = 0; i < this.gPer; i++) {
        const s = i * step;
        if (s + step <= cut) continue;
        const p = perimPt(s, ES), pm = perimPt(s + step / 2, ES);
        this.posts.setMatrixAt(np++, M.compose(V(p.x, p.y, zf + 0.6), q, sv.set(0.05, 1.2, 0.05)));
        const along = (lx) => (pm.tx ? sv.set(lx, 0, 0) : sv.set(0, 0, lx));
        for (const zz of [0.6, 1.2]) {
          const s3 = along(step); s3.y = 0.045; if (!s3.x) s3.x = 0.045; else s3.z = 0.045;
          this.rails.setMatrixAt(nr++, M.compose(V(pm.x, pm.y, zf + zz), q, s3));
        }
        const s4 = along(step); s4.y = 0.18; if (!s4.x) s4.x = 0.02; else s4.z = 0.02;
        this.toes.setMatrixAt(nt++, M.compose(V(pm.x, pm.y, zf + 0.09), q, s4));
      }
      // 外挑安全网：每 3 层一道，往外 3 m、外沿抬高 1 m
      if (h % 3 === 0 && nn < 32) {
        for (let k = 0; k < 4; k++) {
          const c = perimPt(k * 2 * ES + ES, ES);
          const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(c.tx ? 1 : 0, 0, c.ty ? 1 : 0), (c.ny ? -c.ny : c.nx) * 0.32 * (c.ny ? -1 : 1));   // 绕楼边（切线）转，外沿抬高
          this.nets.setMatrixAt(nn++, M.compose(V(c.x + c.nx * 1.55, c.y + c.ny * 1.55, zf - 0.05), rq, c.tx ? sv.set(2 * ES + 6, 0.02, 3.1) : sv.set(3.1, 0.02, 2 * ES + 6)));
        }
      }
    }
    this.posts.count = np; this.rails.count = nr; this.toes.count = nt; this.nets.count = nn;
    for (const im of [this.posts, this.rails, this.toes, this.nets]) im.instanceMatrix.needsUpdate = true;
    this.guardRange = np ? [Math.max(h0, h1 - this.guardN + 1), h1] : null;
  }

  _basement(st, t, crew) {
    const sch = this.sch, z = sch.z, day = st.day, bx = this.bx, B = this.P.tower.basement;
    const W = bx.x1 - bx.x0;
    // ---- 筏板：钢筋 [0, 0.35]，浇筑 [0.4, 0.95]，从西往东
    const r = sch.raft;
    const inRaft = day >= r.t0 && day < r.t1;
    let rp = 0, pp = 0;
    if (inRaft) {
      const u = (day - r.t0) / (r.t1 - r.t0);
      rp = this._prog('raftReb', 'raft', clamp(u / 0.35, 0, 1), t, 1 / 300);
      const ppDay = clamp((u - 0.4) / 0.55, 0, 1);
      pp = rp >= 1 ? this._prog('raftPour', 'raft', ppDay, t, 1 / 900) : ppDay;
    }
    const raftIt = this.it.raft && this.it.raft[-5];
    this.rebarR.visible = inRaft && rp > 0 && pp < 1;
    if (this.rebarR.visible) { this.rebarR.position.y = z[-4] - 0.08; this.U.rebarB.uFront.value = rp * W; }
    this._swap('raft', raftIt && inRaft && pp < 1 ? raftIt : null);
    if (raftIt && inRaft) {
      raftIt.obj.visible = pp > 0;
      this.U.raft.uFront.value = pp * W;
    }
    if (inRaft) {
      if (pp > 0 && pp < 1) {
        const fx = bx.x0 + pp * W;
        this.pour = { x: fx - 3, y: (bx.y0 + bx.y1) / 2 - 12 };
        for (let i = 0; i < 4; i++) crew(fx - 1.5, bx.y0 + 12 + i * 14, z[-4], 0);
        this.stat.push({ key: 'raft', name: '浇筑板', text: `从西往东 · ${Math.round(pp * 100)}%`, p: pp });
      } else if (rp < 1) {
        const fx = bx.x0 + rp * W;
        for (let i = 0; i < 5; i++) crew(fx - 1, bx.y0 + 8 + i * 15, z[-4] - 0.05, Math.PI / 2, true);
        this.stat.push({ key: 'raftReb', name: '绑筏板钢筋', text: `${Math.round(rp * 100)}%`, p: rp });
      }
    }

    // ---- 地下室顶板：支模架 [0, 0.4]、模板 [0.3, 0.6]、钢筋 [0.55, 0.78]、浇筑 [0.8, 1]
    let L = null;
    for (const lv of [-4, -3, -2, -1]) if (day >= sch.bVert[lv]) L = lv;
    let shoreShow = false;
    if (L != null) {
      const until = L < -1 ? sch.bVert[L + 1] : sch.bSlab[L] + 8;
      shoreShow = day < until;
    }
    if (!shoreShow) {
      this.poles.count = this.ledgers.count = 0;
      this.ply.visible = this.rebarS.visible = false;
      this._swap('bslab', null);
      this.shoreLv = null;
      return;
    }
    const zt = L + 1 < 0 ? z[L + 1] : 0;
    const tSlab = L === -1 ? B.roof_t : B.slab_t;
    const zb = z[L], H = zt - tSlab - 0.04 - zb;
    if (this.shoreLv !== L) {
      this.shoreLv = L;
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3();
      this.shorePts.forEach(([x, y], i) => this.poles.setMatrixAt(i, M.compose(V(x, y, zb), q, sv.set(1, H, 1))));
      this.poles.count = this.shorePts.length;
      let k = 0;
      for (const [a0, a1, c, ax] of this.ledgerRows) {
        for (const zz of [zb + 1.6, zb + H - 0.35]) {
          const m = (a0 + a1) / 2, len = a1 - a0;
          this.ledgers.setMatrixAt(k++, ax === 0 ? M.compose(V(m, c, zz), q, sv.set(len, 0.045, 0.045)) : M.compose(V(c, m, zz), q, sv.set(0.045, 0.045, len)));
        }
      }
      this.ledgers.count = k;
      this.poles.instanceMatrix.needsUpdate = this.ledgers.instanceMatrix.needsUpdate = true;
      this.ply.position.y = zt - tSlab;
    }
    const w = clamp((day - sch.bVert[L]) / (sch.bSlab[L] - sch.bVert[L]), 0, 1);
    const key = 'L' + L;
    const ps = this._prog('shore', key, clamp(w / 0.4, 0, 1), t, 1 / 400);
    const pf = this._prog('ply', key, clamp((w - 0.3) / 0.3, 0, 1), t, 1 / 400);
    const pr = this._prog('bReb', key, clamp((w - 0.55) / 0.23, 0, 1), t, 1 / 400);
    const ppDay = clamp((w - 0.8) / 0.2, 0, 1);
    const pq = pr >= 1 ? this._prog('bPour', key, ppDay, t, 1 / 700) : ppDay;
    this.U.shore.uFront.value = ps * W + 2;
    this.U.ply.uFront.value = pf * W + 1;
    this.ply.visible = pf > 0;
    this.rebarS.visible = pr > 0 && day < sch.bSlab[L];
    if (this.rebarS.visible) { this.rebarS.position.y = zt - 0.12; this.U.rebarB.uFront.value = pr * W + 1; }
    const it = this.it.bslab && this.it.bslab[L];
    const pouring = day < sch.bSlab[L] && pq > 0;
    this._swap('bslab', it && pouring && pq < 1 ? it : null);
    if (it && pouring) { it.obj.visible = true; this.U.bslab.uFront.value = pq * W; }
    const lvName = `地下 ${-L} 层顶板`;
    if (day < sch.bSlab[L]) {
      const zc = zt - tSlab + 0.02;
      if (pq > 0) {
        const fx = bx.x0 + pq * W;
        this.pour = { x: fx - 3, y: (bx.y0 + bx.y1) / 2 - 12 };
        for (let i = 0; i < 4; i++) crew(fx - 1.5, bx.y0 + 12 + i * 14, zt, 0);
        this.stat.push({ key: 'bslab', name: lvName, text: `浇筑 ${Math.round(pq * 100)}%`, p: pq });
      } else if (pr > 0) {
        const fx = bx.x0 + pr * W;
        for (let i = 0; i < 4; i++) crew(fx - 1, bx.y0 + 10 + i * 17, zc + 0.05, Math.PI / 2, true);
        this.stat.push({ key: 'bslab', name: lvName, text: `绑钢筋 ${Math.round(pr * 100)}%`, p: pr });
      } else if (pf > 0) {
        const fx = bx.x0 + pf * W;
        for (let i = 0; i < 3; i++) crew(fx - 1, bx.y0 + 14 + i * 20, zc, Math.PI / 2, true);
        this.stat.push({ key: 'bslab', name: lvName, text: `铺模板 ${Math.round(pf * 100)}%`, p: pf });
      } else {
        const fx = bx.x0 + ps * W;
        for (let i = 0; i < 3; i++) crew(fx - 1, bx.y0 + 14 + i * 20, zb, Math.PI / 2, true);
        this.stat.push({ key: 'bslab', name: lvName, text: `搭支模架 ${Math.round(ps * 100)}%`, p: ps });
      }
    } else {
      this.stat.push({ key: 'bslab', name: lvName, text: '养护中，过几天拆支模架', p: 1 });
    }
  }
}
