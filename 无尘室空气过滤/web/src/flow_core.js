// 二维不可压 N-S：无尘室的一个横截面。MAC 交错网格 + 半拉格朗日 + 红黑 SOR 投影。
// 网格粗（12.5 cm），等效黏性远大于真实湍流黏性，所以只用来看气流组织的趋势。
export class Flow2D {
  constructor(opt = {}) {
    this.W = 18; this.H = 7.0; this.dx = 0.125;
    this.nx = Math.round(this.W / this.dx); this.ny = Math.round(this.H / this.dx);
    const n = (this.nx + 1) * (this.ny + 1);
    this.u = new Float32Array(n); this.v = new Float32Array(n);
    this.u2 = new Float32Array(n); this.v2 = new Float32Array(n);
    this.p = new Float32Array(n);
    this.solid = new Uint8Array(n);
    this.floorRow = 24;           // 地板所在行（下面 3 m 代表地板下空腔加下技术夹层）
    this.topRow = this.ny - 1;
    this.nffu = 15;
    this.ffu = new Array(this.nffu).fill(1);
    this.vffu = opt.vffu ?? 0.40;
    this.open = opt.open ?? 0.25;
    this.nu = 0.004; this.dt = 0.05;
    this.tools = opt.tools ?? [[3.0, 6.9, 2.6], [11.1, 15.0, 2.6]];  // x0,x1,高
    this.person = opt.person ?? 9.0;
    this.rebuild();
  }

  id(i, j) { return j * (this.nx + 1) + i; }

  rebuild() {
    this.solid.fill(0);
    const { nx, ny, floorRow } = this;
    for (const [x0, x1, h] of this.tools) {
      const i0 = Math.round(x0 / this.dx), i1 = Math.round(x1 / this.dx), j1 = floorRow + Math.round(h / this.dx);
      for (let j = floorRow; j <= j1; j++) for (let i = i0; i < i1; i++) this.solid[this.id(i, j)] = 1;
    }
    if (this.person != null) {
      const i0 = Math.round((this.person - .25) / this.dx), i1 = Math.round((this.person + .25) / this.dx), j1 = floorRow + Math.round(1.75 / this.dx);
      for (let j = floorRow + 1; j <= j1; j++) for (let i = i0; i < i1; i++) this.solid[this.id(i, j)] = 1;
    }
    this.nx1 = nx; this.ny1 = ny;
  }

  // 穿孔板局部阻力系数（Idelchik 薄板式）
  zeta() { const b = this.open; const q = 0.707 * Math.sqrt(1 - b) + 1 - b; return q * q / (b * b); }

  bc() {
    const { nx, ny, u, v, solid } = this;
    // 顶部 FFU 送风
    for (let i = 0; i < nx; i++) {
      const k = Math.min(this.nffu - 1, Math.floor(i / nx * this.nffu));
      v[this.id(i, ny)] = -this.vffu * this.ffu[k];
      v[this.id(i, 0)] = 0;
    }
    // 两侧：回风空腔开口（压力出口，法向速度自由），其余为墙
    for (let j = 0; j < ny; j++) {
      if (j >= this.floorRow - 0) { u[this.id(0, j)] = 0; u[this.id(nx, j)] = 0; }
    }
    // 实体面
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (solid[this.id(i, j)]) {
        u[this.id(i, j)] = 0; u[this.id(i + 1, j)] = 0; v[this.id(i, j)] = 0; v[this.id(i, j + 1)] = 0;
      }
    }
  }

  sampleU(x, y) {  // 物理坐标
    const gx = x / this.dx, gy = y / this.dx - .5;
    return this.bilinear(this.u, gx, gy, this.nx, this.ny - 1);
  }
  sampleV(x, y) {
    const gx = x / this.dx - .5, gy = y / this.dx;
    return this.bilinear(this.v, gx, gy, this.nx - 1, this.ny);
  }
  bilinear(f, gx, gy, mi, mj) {
    gx = Math.max(0, Math.min(mi - 0.001, gx)); gy = Math.max(0, Math.min(mj - 0.001, gy));
    const i = gx | 0, j = gy | 0, a = gx - i, b = gy - j;
    const w = this.nx + 1;
    const k = j * w + i;
    return (1 - a) * (1 - b) * f[k] + a * (1 - b) * f[k + 1] + (1 - a) * b * f[k + w] + a * b * f[k + w + 1];
  }

  advect(dt) {
    const { nx, ny, dx, u, v, u2, v2 } = this;
    for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) {
      const x = i * dx, y = (j + .5) * dx;
      const ux = u[this.id(i, j)], vy = this.sampleV(x, y);
      u2[this.id(i, j)] = this.sampleU(x - dt * ux, y - dt * vy);
    }
    for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = (i + .5) * dx, y = j * dx;
      const vy = v[this.id(i, j)], ux = this.sampleU(x, y);
      v2[this.id(i, j)] = this.sampleV(x - dt * ux, y - dt * vy);
    }
    for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) u[this.id(i, j)] = u2[this.id(i, j)];
    for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) v[this.id(i, j)] = v2[this.id(i, j)];
  }

  diffuse(dt) {
    const { nx, ny, dx, u, v, u2, v2 } = this;
    const c = this.nu * dt / (dx * dx);
    const w = nx + 1;
    u2.set(u); v2.set(v);
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx; i++) {
      const k = this.id(i, j);
      u[k] = u2[k] + c * (u2[k - 1] + u2[k + 1] + u2[k - w] + u2[k + w] - 4 * u2[k]);
    }
    for (let j = 1; j < ny; j++) for (let i = 1; i < nx - 1; i++) {
      const k = this.id(i, j);
      v[k] = v2[k] + c * (v2[k - 1] + v2[k + 1] + v2[k - w] + v2[k + w] - 4 * v2[k]);
    }
  }

  floorDrag(dt) {
    // 穿孔地板：只在地板那一行的水平面上加二次阻力，横向流动几乎被挡死
    const z = this.zeta() / (2 * this.dx);
    const j = this.floorRow;
    for (let i = 0; i < this.nx; i++) {
      const k = this.id(i, j);
      this.v[k] /= 1 + dt * z * Math.abs(this.v[k]);
    }
    // 地板层内不让横向走
    for (let i = 1; i < this.nx; i++) this.u[this.id(i, j)] = 0;
  }

  project(iters = 50) {
    const { nx, ny, dx, u, v, p, solid } = this;
    const scale = dx / this.dt;
    const omega = 1.86;
    const w = nx + 1;
    const fr = this.floorRow;
    for (let it = 0; it < iters; it++) {
      for (let color = 0; color < 2; color++) {
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          if ((i + j) % 2 !== color) continue;
          const k = j * w + i;
          if (solid[k]) continue;
          const openL = i > 0 ? !solid[k - 1] : j < fr;     // 空腔两端开口
          const openR = i < nx - 1 ? !solid[k + 1] : j < fr;
          const openD = j > 0 && !solid[k - w];
          const openU = j < ny - 1 && !solid[k + w];
          const nb = (openL ? 1 : 0) + (openR ? 1 : 0) + (openD ? 1 : 0) + (openU ? 1 : 0);
          if (!nb) continue;
          const div = (u[k + 1] - u[k]) + (v[k + w] - v[k]);
          const pL = i > 0 && openL ? p[k - 1] : 0, pR = i < nx - 1 && openR ? p[k + 1] : 0;
          const pD = openD ? p[k - w] : 0, pU = openU ? p[k + w] : 0;
          const np = (pL + pR + pD + pU - scale * div) / nb;
          p[k] += omega * (np - p[k]);
        }
      }
    }
    // 速度修正
    const c = 1 / scale;
    for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) {
      const k = j * w + i;
      if (solid[k] || solid[k - 1]) continue;
      u[k] -= c * (p[k] - p[k - 1]);
    }
    for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * w + i;
      if (solid[k] || solid[k - w]) continue;
      v[k] -= c * (p[k] - p[k - w]);
    }
    // 开口边界
    for (let j = 0; j < fr; j++) {
      u[this.id(0, j)] -= c * (p[this.id(0, j)] - 0);
      u[this.id(nx, j)] -= c * (0 - p[this.id(nx - 1, j)]);
    }
  }

  step() {
    this.bc();
    this.advect(this.dt);
    this.diffuse(this.dt);
    this.bc();
    this.floorDrag(this.dt);
    this.bc();
    this.project();
    this.bc();
  }

  // 工作面（地板上方 1.0 m）的平均偏斜：|u|/|v|，越小越接近单向流
  tilt() {
    const j = this.floorRow + Math.round(1.0 / this.dx);
    let a = 0, b = 0;
    for (let i = 0; i < this.nx; i++) {
      if (this.solid[this.id(i, j)]) continue;
      a += Math.abs(this.u[this.id(i, j)]); b += Math.abs(this.v[this.id(i, j)]);
    }
    return b > 1e-6 ? a / b : 0;
  }

  massError() {
    const { nx, ny } = this;
    let inflow = 0, out = 0;
    for (let i = 0; i < nx; i++) inflow += -this.v[this.id(i, ny)];
    for (let j = 0; j < ny; j++) out += -this.u[this.id(0, j)] + this.u[this.id(nx, j)];
    return { inflow: inflow * this.dx, out: out * this.dx };
  }
}
