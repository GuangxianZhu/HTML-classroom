// 2D FDTD（TMz：Ez, Hx, Hy）：俯视看腔体的一层薄切片，四壁是理想金属。
// 这是页面里"真的在解麦克斯韦方程"的部分。Worker 和 Node 测试共用这一份代码。
export const C0 = 299792458, ETA0 = 376.73, F0 = 2.45e9, LAMBDA_MM = C0 / F0 * 1000;

export const DEFAULTS = {
  W: 320, D: 340,      // 腔体内尺寸 mm（与 Blender 参数表一致）
  dx: 4,               // 网格 mm，约 λ/30
  S: 0.7,              // Courant 数，2D 稳定上限 0.707
  sigmaBg: 4.5e-4,     // 用很小的背景损耗代替壁面损耗，对应空腔 Q≈300
  periodsPerRev: 900,  // 转一圈经过多少个射频周期（远慢于腔体建场时间即可）
  warmup: 40,          // 先建场，这段不计热
  heatEvery: 6,        // 每隔几个周期结算一次热量
};

// 平板天线上的辐射点：位置取自专利实施例的两个十字槽、一个直槽和矩形突出端。
// 相位按"从中心沿板传过去"近似，幅度是唯象假设，不是测量值。
const k0 = 2 * Math.PI / LAMBDA_MM;
export const ANTENNA = [
  { x: 0, y: 33, a: 1.0 }, { x: 0, y: -33, a: 1.0 }, { x: -24, y: 0, a: 0.8 }, { x: 70, y: 0, a: 1.3 },
].map(e => ({ ...e, ph: -k0 * Math.hypot(e.x, e.y) }));

export const FOODS = {
  plate:  { kind: 'disc', r: 120, label: '一大盘（Ø240）' },
  bento:  { kind: 'rect', w: 200, h: 140, label: '方便当（200×140）' },
  cup:    { kind: 'disc', r: 42, label: '一杯（Ø84）' },
};

export class Sim {
  constructor(opt = {}) {
    Object.assign(this, DEFAULTS, opt);
    const { W, D, dx } = this;
    this.nx = Math.round(W / dx) + 1; this.ny = Math.round(D / dx) + 1;
    const N = this.N = this.nx * this.ny;
    this.Ez = new Float32Array(N); this.Hx = new Float32Array(N); this.Hy = new Float32Array(N);
    this.Ca = new Float32Array(N); this.Cb = new Float32Array(N); this.acc = new Float32Array(N);
    this.avg = new Float32Array(N);
    this.mode = opt.mode || 'antenna';           // fixed | turntable | antenna
    this.foodEps = opt.foodEps ?? 3.0;           // 等效薄层食物
    this.foodSigma = opt.foodSigma ?? 0.12;      // S/m
    this.food = opt.food || FOODS.plate;
    this.foodX = opt.foodX ?? 0; this.foodY = opt.foodY ?? 0;  // 相对腔体中心 mm
    this.theta = opt.theta0 ?? 0;                // 天线或转盘转角 rad
    this.t = 0; this.acount = 0; this.periods = 0; this.rev = 0;
    this.spp = LAMBDA_MM / (this.S * dx);        // 每周期步数
    this.w = 2 * Math.PI / this.spp;
    this.sdt = this.S * (dx / 1000) * ETA0 / 2;  // σ·dt/(2ε0)
    this.src = []; this.source = opt.source || (this.mode === 'turntable' ? 'side' : 'antenna');
    this._matTheta = NaN;
    this.initHeat();
    this.rasterize();
    this.placeSource();
  }

  // 食物坐标系里的热量网格：转盘模式下它跟着食物转
  initHeat() {
    const R = Math.ceil(Math.max(this.food.r || 0, Math.hypot(this.food.w || 0, this.food.h || 0) / 2) / this.dx) + 2;
    this.fR = R; this.fn = 2 * R + 1;
    this.heat = new Float32Array(this.fn * this.fn);
    this.fmask = new Float32Array(this.fn * this.fn);
    for (let j = 0; j < this.fn; j++) for (let i = 0; i < this.fn; i++) {
      this.fmask[j * this.fn + i] = this.inFood((i - R) * this.dx, (j - R) * this.dx) ? 1 : 0;
    }
  }

  inFood(u, v) {   // u,v：食物自身坐标 mm
    const f = this.food;
    if (f.kind === 'disc') return u * u + v * v <= f.r * f.r;
    return Math.abs(u) <= f.w / 2 && Math.abs(v) <= f.h / 2;
  }

  toFood(xc, yc) { // 腔体中心坐标 → 食物坐标
    const dx0 = xc - this.foodX, dy0 = yc - this.foodY;
    if (this.mode !== 'turntable') return [dx0, dy0];
    const th = this.theta, c = Math.cos(th), s = Math.sin(th);
    // 转盘绕腔体中心转：食物中心也跟着公转
    const u = c * xc + s * yc - this.foodX, v = -s * xc + c * yc - this.foodY;
    return [u, v];
  }

  rasterize() {
    const { nx, ny, dx, W, D, Ca, Cb, S, sdt, sigmaBg, foodEps, foodSigma } = this;
    const sub = 3;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = i * dx - W / 2, y = j * dx - D / 2;
      let cover = 0;
      for (let a = 0; a < sub; a++) for (let b = 0; b < sub; b++) {
        const [u, v] = this.toFood(x + ((a + .5) / sub - .5) * dx, y + ((b + .5) / sub - .5) * dx);
        if (this.inFood(u, v)) cover++;
      }
      cover /= sub * sub;
      const eps = 1 + (foodEps - 1) * cover, sig = sigmaBg + foodSigma * cover;
      const s = sdt * sig / eps, id = i * ny + j;
      Ca[id] = (1 - s) / (1 + s);
      Cb[id] = (S / eps) / (1 + s);
    }
    this._matTheta = this.theta;
  }

  placeSource() {
    const { W, D, dx, ny, nx } = this;
    const list = [];
    const add = (x, y, a, ph) => {   // x,y：腔体中心坐标 mm，双线性分配到四个节点
      const fx = (x + W / 2) / dx, fy = (y + D / 2) / dx;
      const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
      for (const [ii, jj, w] of [[i, j, (1 - u) * (1 - v)], [i + 1, j, u * (1 - v)], [i, j + 1, (1 - u) * v], [i + 1, j + 1, u * v]]) {
        if (ii > 0 && jj > 0 && ii < nx - 1 && jj < ny - 1 && w > 1e-4) list.push(ii * ny + jj, w * a, ph);
      }
    };
    if (this.source === 'side') {
      // 经典机型：右侧壁馈口。距壁 λ/4 放一条短线源
      for (let k = -2; k <= 2; k++) add(W / 2 - 30, k * 12 + 30, 1.0, 0);
    } else {
      const c = Math.cos(this.mode === 'turntable' ? 0 : this.theta), s = Math.sin(this.mode === 'turntable' ? 0 : this.theta);
      for (const e of ANTENNA) add(c * e.x - s * e.y, s * e.x + c * e.y, e.a, e.ph);
    }
    this.src = list;
  }

  step(n) {
    const { Ez, Hx, Hy, Ca, Cb, S, nx, ny, acc, src, w } = this;
    const srcn = src.length;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < nx; i++) {
        const b = i * ny;
        for (let j = 0; j < ny - 1; j++) Hx[b + j] -= S * (Ez[b + j + 1] - Ez[b + j]);
      }
      for (let i = 0; i < nx - 1; i++) {
        const b = i * ny;
        for (let j = 0; j < ny; j++) Hy[b + j] += S * (Ez[b + ny + j] - Ez[b + j]);
      }
      for (let i = 1; i < nx - 1; i++) {
        const b = i * ny;
        for (let j = 1; j < ny - 1; j++) {
          const id = b + j;
          Ez[id] = Ca[id] * Ez[id] + Cb[id] * (Hy[id] - Hy[id - ny] - Hx[id] + Hx[id - 1]);
        }
      }
      const tw = this.t * w;
      for (let q = 0; q < srcn; q += 3) Ez[src[q]] += src[q + 1] * Math.sin(tw + src[q + 2]);
      this.t++;
      if (this.t % 3 === 0) {
        for (let id = 0; id < this.N; id++) { const e = Ez[id]; acc[id] += e * e; }
        this.acount++;
      }
    }
  }

  // 跑一个射频周期，并推进转角
  period(stepsOverride) {
    const target = Math.round((this.periods + 1) * this.spp) - Math.round(this.periods * this.spp);
    this.step(stepsOverride ?? target);
    this.periods++;
    if (this.periods > this.warmup && this.mode !== 'fixed') {
      this.theta += 2 * Math.PI / this.periodsPerRev;
      if (this.mode === 'antenna') this.placeSource();
      if (this.mode === 'turntable' && Math.abs(this.theta - this._matTheta) > 2.5 * Math.PI / 180) this.rasterize();
    }
    if (this.periods % this.heatEvery === 0) this.settle();
  }

  settle() {
    const { acc, acount, avg, N } = this;
    if (!acount) return;
    for (let i = 0; i < N; i++) { avg[i] = acc[i] / acount; acc[i] = 0; }
    this.acount = 0;
    if (this.periods <= this.warmup) return;
    this.rev = (this.periods - this.warmup) / this.periodsPerRev;
    const { fn, fR, heat, fmask, dx, W, D, nx, ny, theta } = this;
    const c = this.mode === 'turntable' ? Math.cos(theta) : 1, s = this.mode === 'turntable' ? Math.sin(theta) : 0;
    for (let j = 0; j < fn; j++) for (let i = 0; i < fn; i++) {
      const f = j * fn + i;
      if (!fmask[f]) continue;
      const u = (i - fR) * dx + this.foodX, v = (j - fR) * dx + this.foodY;   // 食物系（相对腔体中心）
      const x = c * u - s * v, y = s * u + c * v;                               // 转回腔体系
      const gx = (x + W / 2) / dx, gy = (y + D / 2) / dx;
      const a = Math.floor(gx), b = Math.floor(gy);
      if (a < 0 || b < 0 || a >= nx - 1 || b >= ny - 1) continue;
      const p = gx - a, q = gy - b, id = a * ny + b;
      heat[f] += (1 - p) * (1 - q) * avg[id] + p * (1 - q) * avg[id + ny] + (1 - p) * q * avg[id + 1] + p * q * avg[id + ny + 1];
    }
  }

  stats() {
    const { heat, fmask } = this;
    let n = 0, m = 0, m2 = 0;
    for (let i = 0; i < heat.length; i++) if (fmask[i]) { n++; m += heat[i]; m2 += heat[i] * heat[i]; }
    m /= n; m2 /= n;
    let cold = 0, hot = 0, lo = Infinity, hi = 0;
    for (let i = 0; i < heat.length; i++) if (fmask[i]) {
      const h = heat[i] / (m || 1);
      if (h < .5) cold++; if (h > 1.5) hot++;
      if (h < lo) lo = h; if (h > hi) hi = h;
    }
    return { cv: m ? Math.sqrt(Math.max(m2 - m * m, 0)) / m : 0, cold: cold / n, hot: hot / n, lo, hi, mean: m };
  }
}
