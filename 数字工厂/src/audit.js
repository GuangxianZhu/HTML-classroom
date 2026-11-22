// 穿模审计（QA 用）：把仿真快进一段时间，凡是在动的零件，把它的包围盒（略缩小）当成有向盒，
// 和静态几何（Builder 的盒子 / 合并几何、静态实例）以及别的装配体的零件做分离轴相交测试。
// 返回按“动件 × 障碍物”汇总的命中表，由 qa/clearance.mjs 过滤掉本来就该接触的组合。
import * as THREE from 'three';

const CELL = 2;
const key = (ix, iz) => (ix + 2048) * 4096 + (iz + 2048);
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _v = new THREE.Vector3();

// 单位盒矩阵 → 有向盒 {c, a[3]（单位轴）, h[3]（半长）, bb}
function obbFrom(mat, shrink = 1, out = {}) {
  mat.extractBasis(_x, _y, _z);
  const c = (out.c ||= new THREE.Vector3()).setFromMatrixPosition(mat);
  const a = (out.a ||= [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), h = (out.h ||= [0, 0, 0]);
  [_x, _y, _z].forEach((u, i) => { const L = u.length(); h[i] = L * 0.5 * shrink; a[i].copy(u).multiplyScalar(L > 1e-9 ? 1 / L : 0); });
  const bb = (out.bb ||= new THREE.Box3());
  const ex = Math.abs(a[0].x) * h[0] + Math.abs(a[1].x) * h[1] + Math.abs(a[2].x) * h[2], ey = Math.abs(a[0].y) * h[0] + Math.abs(a[1].y) * h[1] + Math.abs(a[2].y) * h[2], ez = Math.abs(a[0].z) * h[0] + Math.abs(a[1].z) * h[1] + Math.abs(a[2].z) * h[2];
  bb.min.set(c.x - ex, c.y - ey, c.z - ez); bb.max.set(c.x + ex, c.y + ey, c.z + ez);
  return out;
}
function obbFromBox(bb) { const c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3()); return { c, a: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)], h: [s.x / 2, s.y / 2, s.z / 2], bb: bb.clone() }; }
const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], AR = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], T = [0, 0, 0];
function sat(A, B) {
  const a = A.bb, b = B.bb;
  if (a.max.x < b.min.x || a.min.x > b.max.x || a.max.y < b.min.y || a.min.y > b.max.y || a.max.z < b.min.z || a.min.z > b.max.z) return false;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { R[i][j] = A.a[i].dot(B.a[j]); AR[i][j] = Math.abs(R[i][j]) + 1e-6; }
  _v.subVectors(B.c, A.c); for (let i = 0; i < 3; i++) T[i] = _v.dot(A.a[i]);
  for (let i = 0; i < 3; i++) if (Math.abs(T[i]) > A.h[i] + B.h[0] * AR[i][0] + B.h[1] * AR[i][1] + B.h[2] * AR[i][2]) return false;
  for (let j = 0; j < 3; j++) if (Math.abs(T[0] * R[0][j] + T[1] * R[1][j] + T[2] * R[2][j]) > A.h[0] * AR[0][j] + A.h[1] * AR[1][j] + A.h[2] * AR[2][j] + B.h[j]) return false;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const i1 = (i + 1) % 3, i2 = (i + 2) % 3, j1 = (j + 1) % 3, j2 = (j + 2) % 3;
    if (Math.abs(T[i2] * R[i1][j] - T[i1] * R[i2][j]) > A.h[i1] * AR[i2][j] + A.h[i2] * AR[i1][j] + B.h[j1] * AR[i][j2] + B.h[j2] * AR[i][j1]) return false;
  }
  return true;
}

export function runAudit(ctx, SIM, { seconds = 150, step = 0.12, shrink = 0.86 } = {}) {
  const P = ctx.P, B = ctx.B;
  const m4 = new THREE.Matrix4(), one = new THREE.Vector3(1e-3, 1e-3, 1e-3);
  const put = (g, o) => {
    const bb = o.bb;
    for (let ix = Math.floor(bb.min.x / CELL); ix <= Math.floor(bb.max.x / CELL); ix++) for (let iz = Math.floor(bb.min.z / CELL); iz <= Math.floor(bb.max.z / CELL); iz++) {
      const k = key(ix, iz); let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(o);
    }
  };
  // 地面上的薄东西（板、标线、垫层）不算障碍
  const floorish = (bb) => bb.max.y <= 0.2 || (bb.max.y <= -0.9 && bb.max.x - bb.min.x > 20) || (bb.max.x - bb.min.x > 100 && bb.max.z - bb.min.z > 60);
  const grid = new Map(); let nStatic = 0;
  for (const r of B.rec) {
    const o = r.m ? obbFrom(r.m) : obbFromBox(r.bb); if (floorish(o.bb)) continue;
    o.name = r.m ? r.name : r.name + '*'; put(grid, o); nStatic++;
  }
  const defBox = new Map();
  for (const d of P.defs.values()) { d.geometry.computeBoundingBox(); const b = d.geometry.boundingBox; defBox.set(d, { c: b.getCenter(new THREE.Vector3()), s: b.getSize(new THREE.Vector3()).max(one) }); }
  const unitMat = (o, out) => { const db = defBox.get(o.userData.def); return out.copy(o.matrixWorld).multiply(m4.makeTranslation(db.c.x, db.c.y, db.c.z)).scale(db.s); };
  const rootOf = (o) => { while (o.parent && o.parent !== P.root) o = o.parent; return o; };
  P.root.updateMatrixWorld(true);
  const nodes = []; const tmp = new THREE.Matrix4();
  for (const d of P.defs.values()) for (const o of d.nodes) {
    const root = rootOf(o);
    if (!d.dyn) { const ob = obbFrom(unitMat(o, tmp)); if (floorish(ob.bb)) continue; ob.name = '#' + d.key; ob.root = root; put(grid, ob); nStatic++; continue; }
    nodes.push({ o, key: d.key, root, prev: new Float32Array(o.matrixWorld.elements), full: {}, small: {}, moved: false, visible: true });
  }

  const hits = new Map();
  const savedFault = SIM._nextFault, savedFx = ctx.visibleFx;
  SIM._nextFault = Infinity; SIM._nextIdle = Infinity; ctx.visibleFx = false;
  let t = 0, nSteps = 0; const seen = new Set();
  for (; t < seconds; t += step, nSteps++) {
    SIM.update(step);
    for (const u of ctx.updaters) u(step, 1000 + t);
    P.root.updateMatrixWorld(true);
    const dgrid = new Map();
    for (const n of nodes) {
      n.visible = P.vis(n.o); if (!n.visible) { n.moved = false; continue; }
      const e = n.o.matrixWorld.elements; let d = 0; for (let i = 0; i < 16; i++) d += Math.abs(e[i] - n.prev[i]);
      n.moved = d > 1e-4; n.prev.set(e);
      unitMat(n.o, tmp); obbFrom(tmp, 1, n.full); n.bb = n.full.bb; if (n.moved) obbFrom(tmp, shrink, n.small);
      put(dgrid, n);
    }
    for (const n of nodes) {
      if (!n.moved) continue;
      seen.clear(); const bb = n.small.bb;
      for (let ix = Math.floor(bb.min.x / CELL); ix <= Math.floor(bb.max.x / CELL); ix++) for (let iz = Math.floor(bb.min.z / CELL); iz <= Math.floor(bb.max.z / CELL); iz++) {
        const k = key(ix, iz);
        const A = grid.get(k); if (A) for (const ob of A) { if (ob.root === n.root || seen.has(ob)) continue; seen.add(ob); if (sat(n.small, ob)) hit(n, ob.name, t); }
        const D = dgrid.get(k); if (D) for (const ob of D) { if (ob.root === n.root || seen.has(ob)) continue; seen.add(ob); if (sat(n.small, ob.full)) hit(n, '~' + ob.key, t); }
      }
    }
  }
  function hit(n, name, time) {
    const k = n.key + ' × ' + name; let h = hits.get(k); const c = n.small.c;
    if (!h) hits.set(k, (h = { pair: k, n: 0, at: [+c.x.toFixed(1), +c.y.toFixed(1), +c.z.toFixed(1)], t: +time.toFixed(1), spots: new Set() }));
    h.n++; if (h.spots.size < 8) h.spots.add(`${Math.round(c.x / 2) * 2},${Math.round(c.z / 2) * 2}`);
  }
  SIM._nextFault = SIM.time + (savedFault === Infinity ? 1e9 : 14); SIM._nextIdle = SIM.time + 6; ctx.visibleFx = savedFx;
  return { nStatic, nDynamic: nodes.length, nSteps, hits: [...hits.values()].map((h) => ({ ...h, spots: [...h.spots].join(' | ') })).sort((a, b) => b.n - a.n) };
}
