// 工件模型：外表面半径 r(x, θ)、内孔半径 ri(x, θ)，全部由“切削记录”算出来。
// 所有切削都是“取最小 / 取最大”，所以同一刀重复算多少次结果都一样——跳步时直接把前面的步骤快进一遍即可。
// 坐标：x 沿主轴（mm，Blender 的 X），θ 是工件自己的角度（随主轴转）；θ=0 指向工件本地 +Y（three），
// 主轴转角 φ 时，本地 θ 在世界里的角度是 θ+φ（0 = 正上方）。

const DX = 0.1;                       // 轴向网格 0.1 mm
const COT30 = 1 / Math.tan(Math.PI / 6);   // 60° 牙型：离牙槽中心每 1 mm，半径多 1.732 mm
const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

export class WorkModel {
  constructor({ R, x0 = 14, x1, xMax = 130 }) {
    this.R = R; this.x0 = x0; this.x1 = x1; this.xMax = xMax;
    this.b0 = x0;                                   // 数组起点（切断后 x0 会变，b0 不变）
    this.n = Math.round((xMax - x0) / DX) + 1;
    this.prof = new Float32Array(this.n).fill(R);   // 回转外形
    this.bore = new Float32Array(this.n).fill(0);   // 回转内孔（0 = 实心）
    this.threads = [];    // 外螺纹 {a,b,P,hand,Rmaj,xref,depth,cur:{d,from}}
    this.ithreads = [];   // 内螺纹 {a,b,P,hand,Rt,xref,to}
    this.flats = [];      // 铣平面 {phi,apo,toolR,segs:[[x0,y0,x1,y1],..]}
    this.knurls = [];     // 滚花 {a,b,R,n,lam,depth,from}
    this.ver = 0;
  }
  i(x) { return Math.max(0, Math.min(this.n - 1, Math.round((x - this.b0) / DX))); }
  xi(i) { return this.b0 + i * DX; }
  touch() { this.ver++; }

  /** 车刀刀尖在 (x, r)，刀尖宽 ±w：把这一段外形削到 r */
  cutAt(x, r, w = 0.15) {
    const a = this.i(x - w), b = this.i(x + w);
    let ch = false;
    for (let k = a; k <= b; k++) if (this.prof[k] > r) { this.prof[k] = Math.max(0, r); ch = true; }
    if (ch) this.touch();
  }
  /** 沿一条线段走刀（每 0.05 mm 切一次） */
  cutLine(xa, ra, xb, rb, w = 0.15) {
    const n = Math.max(1, Math.ceil(Math.hypot(xb - xa, rb - ra) / 0.05));
    for (let k = 0; k <= n; k++) this.cutAt(xa + (xb - xa) * k / n, ra + (rb - ra) * k / n, w);
  }
  /** 端面：刀尖已经过了 x 处整个截面后，右端就是 x */
  setEnd(x) { if (x < this.x1) { this.x1 = x; this.touch(); } }
  /** 尾座上的刀具：刀尖在 xTip，半径函数 rOf(离刀尖的距离 mm) */
  drillTo(xTip, rOf) {
    for (let k = this.i(xTip); k < this.n; k++) {
      const r = rOf(this.xi(k) - xTip);
      if (r > this.bore[k]) { this.bore[k] = r; this.ver++; }
    }
  }

  /** 外半径 */
  rOut(x, th) {
    let r = this.prof[this.i(x)];
    for (const t of this.threads) {
      if (x < t.a || x > t.b) continue;
      const d = Math.max(t.depth, x >= t.cur.from ? t.cur.d : 0);
      if (d <= 0) continue;
      const ph = (x - t.xref) / t.P - t.hand * th / TAU;
      const u = (ph - Math.round(ph)) * t.P;               // 到最近牙槽中心的轴向距离
      r = Math.min(r, t.Rmaj - d + Math.abs(u) * COT30);
    }
    for (const k of this.knurls) {
      if (x < k.a || x > k.b || x < k.from) continue;
      const g = (v) => Math.max(0, 1 - 4 * Math.abs(v - Math.floor(v) - 0.5));
      const u1 = k.n * th / TAU + (x - k.a) / k.lam, u2 = k.n * th / TAU - (x - k.a) / k.lam;
      r = Math.min(r, k.R - k.depth * Math.max(g(u1), g(u2)));
    }
    for (const f of this.flats) {
      if (!f.segs.length) continue;
      const al = wrap(th + f.phi);                        // 这一面朝上时，该点在世界里的角度
      if (Math.abs(al) >= Math.PI / 2 - 0.02) continue;
      const rc = f.apo / Math.cos(al);
      if (rc >= r) continue;
      const s = -f.apo * Math.tan(al);                    // 该点在平面上的横向坐标（Blender Y）
      if (segDist(f.segs, x, s) <= f.toolR) r = rc;
    }
    return r;
  }
  /** 内半径（0 = 实心） */
  rIn(x, th) {
    let r = this.bore[this.i(x)];
    if (r <= 0) return 0;
    for (const t of this.ithreads) {
      if (x < t.a || x > t.b || x < t.to) continue;
      const ph = (x - t.xref) / t.P - t.hand * th / TAU;
      const u = (ph - Math.round(ph)) * t.P;
      r = Math.max(r, t.Rt - Math.abs(u) * COT30);
    }
    return r;
  }

  /** 切断：刀宽 w，刀心在 xp，半径切到 r。切透返回右边那一段（新的模型），左边留在卡盘上 */
  partAt(xp, r, w = 1.5) {
    this.cutAt(xp, r, w / 2);
    const k = this.i(xp);
    if (r <= this.bore[k] + 0.02 || r <= 0.02) {
      const piece = this.clone();
      piece.x0 = xp + w / 2;
      this.x1 = xp - w / 2; this.touch();
      return piece;
    }
    return null;
  }
  clone() {
    const m = new WorkModel({ R: this.R, x0: this.b0, x1: this.x1, xMax: this.xMax });
    m.x0 = this.x0; m.prof.set(this.prof); m.bore.set(this.bore);
    m.threads = this.threads.map((t) => ({ ...t, cur: { ...t.cur } }));
    m.ithreads = this.ithreads.map((t) => ({ ...t }));
    m.flats = this.flats.map((f) => ({ ...f, segs: f.segs.map((s) => s.slice()) }));
    m.knurls = this.knurls.map((k) => ({ ...k }));
    return m;
  }
  /** 轴向采样点：细节区 0.1 mm，其余 0.5 mm，外形 / 内孔有台阶的地方也取 */
  samples(xa, xb) {
    const zones = [...this.threads, ...this.ithreads, ...this.knurls].map((z) => [z.a - 0.2, z.b + 0.2]);
    for (const f of this.flats) for (const s of f.segs) zones.push([Math.min(s[0], s[2]) - f.toolR - 0.3, Math.max(s[0], s[2]) + f.toolR + 0.3]);
    const ia = Math.ceil((xa - this.b0) / DX - 1e-6), ib = Math.floor((xb - this.b0) / DX + 1e-6);
    const xs = [xa];
    for (let k = ia; k <= ib; k++) {
      const x = this.xi(k);
      if (x <= xa + 1e-6 || x >= xb - 1e-6) continue;
      const step = Math.abs(this.prof[k] - this.prof[k - 1] || 0) > 1e-4 || Math.abs(this.prof[k + 1] - this.prof[k] || 0) > 1e-4
        || this.bore[k] !== this.bore[k - 1] || this.bore[k + 1] !== this.bore[k];
      if (step || k % 5 === 0 || zones.some(([a, b]) => x >= a && x <= b)) xs.push(x);
    }
    xs.push(xb);
    return xs;
  }
}

function segDist(segs, x, y) {
  let best = 1e9;
  for (const [x0, y0, x1, y1] of segs) {
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = x0 + dx * t - x, ey = y0 + dy * t - y;
    best = Math.min(best, Math.hypot(ex, ey));
  }
  return best;
}

/** 生成 three 几何：x∈[xa,xb] 这一段（单位 m，绕 X 轴），外表面 + 两端面 + 内孔 */
export function buildGeometry(THREE, m, xa = m.x0, xb = m.x1, NT = 96, shift = 0) {
  const xs = m.samples(xa, xb), nx = xs.length;
  const S = 0.001, pos = [], idx = [];
  const P = (x, r, th) => pos.push((x + shift) * S, r * Math.cos(th) * S, r * Math.sin(th) * S);
  const ro = [], ri = [];
  for (let i = 0; i < nx; i++) {
    const a = new Float32Array(NT), b = new Float32Array(NT);
    for (let j = 0; j < NT; j++) { const th = TAU * j / NT; a[j] = Math.max(0.0001, m.rOut(xs[i], th)); b[j] = m.rIn(xs[i], th); }
    ro.push(a); ri.push(b);
  }
  // 外表面
  let base = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < NT; j++) P(xs[i], ro[i][j], TAU * j / NT);
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < NT; j++) {
    const j1 = (j + 1) % NT, a = i * NT + j, b = i * NT + j1, c = (i + 1) * NT + j, d = (i + 1) * NT + j1;
    idx.push(a, b, c, b, d, c);      // 法线朝外
  }
  base = pos.length / 3;
  // 内孔（只在有孔的连续区段）
  const hasBore = ri.map((r) => r.some((v) => v > 0));
  let s0 = -1;
  const innerRuns = [];
  for (let i = 0; i <= nx; i++) {
    if (i < nx && hasBore[i]) { if (s0 < 0) s0 = i; }
    else if (s0 >= 0) { innerRuns.push([s0, i - 1]); s0 = -1; }
  }
  for (const [i0, i1] of innerRuns) {
    const b0 = pos.length / 3;
    for (let i = i0; i <= i1; i++) for (let j = 0; j < NT; j++) P(xs[i], Math.max(0.0001, ri[i][j]), TAU * j / NT);
    for (let i = 0; i < i1 - i0; i++) for (let j = 0; j < NT; j++) {
      const j1 = (j + 1) % NT, a = b0 + i * NT + j, b = b0 + i * NT + j1, c = b0 + (i + 1) * NT + j, d = b0 + (i + 1) * NT + j1;
      idx.push(a, c, b, b, c, d);      // 法线朝轴线（孔里）
    }
    // 盲孔底
    if (i0 > 0) { const c = pos.length / 3; P(xs[i0], 0, 0); for (let j = 0; j < NT; j++) idx.push(c, b0 + j, b0 + (j + 1) % NT); }
  }
  // 两个端面（外圈到内圈的环）
  const cap = (i, right) => {
    const c0 = pos.length / 3;
    for (let j = 0; j < NT; j++) { const th = TAU * j / NT; P(xs[i], ro[i][j], th); P(xs[i], ri[i][j], th); }
    for (let j = 0; j < NT; j++) {
      const j1 = (j + 1) % NT, o0 = c0 + 2 * j, i0 = o0 + 1, o1 = c0 + 2 * j1, i1 = o1 + 1;
      if (right) idx.push(o0, o1, i0, o1, i1, i0); else idx.push(o0, i0, o1, o1, i0, i1);
    }
  };
  cap(0, false); cap(nx - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
