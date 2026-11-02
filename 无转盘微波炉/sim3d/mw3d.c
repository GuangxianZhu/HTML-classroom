// mw3d.c — 三维 Yee FDTD：离线算这台微波炉的真实几何
// 编译: gcc -O3 -march=native -fopenmp mw3d.c -o mw3d -lm
// 用法: ./mw3d <antenna|turntable> <rect|disc> W H fx fy thick nangles settle avg out.bin [--eps e --sig s --freq GHz]
//
// 坐标与 Blender 参数表一致（mm）：x 向右，y 向后，z 向上。所有金属是理想导体（PEC），
// 按 4 mm 网格阶梯近似。门当作一面完整金属壁（扼流结构的作用就是让它接近这个边界）。
#include <math.h>
#include <omp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define C0 299792458.0
#define ETA0 376.730313
static double DX = 4.0;
static const double X0 = -230, Y0_ = -182, Z0_ = 38;
static int Nx = 119, Ny = 87, Nz = 71;
static int SPP = 54;
static double S, FREQ = 2.45e9;
#define ID(i, j, k) (((size_t)(i) * (Ny + 1) + (j)) * (Nz + 1) + (k))

static float *Ex, *Ey, *Ez, *Hx, *Hy, *Hz, *Cax, *Cbx, *Cay, *Cby, *Caz, *Cbz, *eps, *sig;
static unsigned char *metal;
static double sdt;
static const double SIG_BG = 1.0e-4;

// 腔体
static const double CAVX0 = -226, CAVX1 = 94, CAVY0 = -178, CAVY1 = 162, CAVZ1 = 318;
static const double CX = -66, CY = -8;
static const double FLOORZ = 110, GLASSZ = 114;

static int selftest = 0;
static double rodz = 66, feedZ = 256, feedY = 40;
static int plateKind = 0;
static int scenario = 0;  // 0 回转天线, 1 经典转盘
static int foodDisc = 0;
static double foodW = 200, foodH = 140, foodFx = 0, foodFy = 0, foodThick = 30, foodZ0 = 114;
static double foodEps = 35, foodSig = 1.5;  // 含水食物量级：ε′≈35, ε″≈11
static const double TRAY_Z0 = 122, TRAY_Z1 = 126, TRAY_R = 135;

static inline double xc(int i) { return X0 + (i + .5) * DX; }
static inline double yc(int j) { return Y0_ + (j + .5) * DX; }
static inline double zc(int k) { return Z0_ + (k + .5) * DX; }

// 平板天线轮廓：u,v 为天线自身坐标（JP6861397B2 实施例 1 的数字）
static int in_plate(double u, double v) {
  double r = hypot(u, v), a = fabs(atan2(v, u)) * 180 / M_PI;
  int in;
  if (plateKind == 1) {  // 实施例 4：Ø120 圆板 + 一个十字槽（交点在 1/3 半径处，长短槽约 2:1）
    if (r > 60) return 0;
    double du = u - 20, dv = v;
    double p = (du + dv) * M_SQRT1_2, q = (-du + dv) * M_SQRT1_2;
    if ((fabs(p) <= 25 && fabs(q) <= 5) || (fabs(q) <= 12 && fabs(p) <= 5)) return 0;
    return 1;
  }
  if (a <= 50) in = fabs(v) <= 25 && u <= 70;
  else if (a <= 130) in = r <= 60;
  else in = r <= 45;
  if (!in) return 0;
  for (int s = -1; s <= 1; s += 2) {  // 两个十字槽
    double du = u, dv = v - s * 33.0;
    double p = (du + dv) * M_SQRT1_2, q = (-du + dv) * M_SQRT1_2;
    if ((fabs(p) <= 17.5 && fabs(q) <= 5) || (fabs(q) <= 17.5 && fabs(p) <= 5)) return 0;
  }
  if (fabs(u + 24) <= 5 && fabs(v) <= 18) return 0;  // 直槽
  return 1;
}

static void carve(void) {
#pragma omp parallel for
  for (int i = 0; i < Nx; i++)
    for (int j = 0; j < Ny; j++)
      for (int k = 0; k < Nz; k++) {
        double x = xc(i), y = yc(j), z = zc(k);
        int air = 0;
        double e = 1;
        if (scenario == 0) {
          if (x > CAVX0 && x < CAVX1 && y > CAVY0 && y < CAVY1 && z > FLOORZ && z < CAVZ1) {
            air = 1;
            if (z < GLASSZ) e = 6;  // 底板，近乎透明
          }
          if (z > 86 && z < FLOORZ) {  // 馈能室：倒梯形
            double h = 78 + (z - 86) / (FLOORZ - 86) * (118 - 78);
            if (fabs(x - CX) < h && fabs(y - CY) < h) air = 1;
          }
          if (z > 82 && z < 86 && hypot(x - CX, y - CY) < 26) air = 1;  // 同轴孔
          if (fabs(y - CY) < 45 && x > -138 && x < 234) {               // 波导
            double b = x < -8 ? 62 : (x > 28 ? 42 : 62 - 20 * (x + 8) / 36);
            if (z > b && z < 82) air = 1;
          }
          double r = hypot(x - CX, y - CY);
          if (r < 7.5 && z > rodz && z < 98) air = 0;   // 天线轴
          if (r < 15 && z > 72 && z < 80) air = 0;    // 轴上的匹配台阶
        } else {
          if (x > CAVX0 && x < CAVX1 && y > CAVY0 && y < CAVY1 && z > FLOORZ && z < CAVZ1) {
            air = 1;
            if (z > TRAY_Z0 && z < TRAY_Z1 && hypot(x - CX, y - CY) < TRAY_R) e = 6;  // 玻璃转盘
          }
          // 经典右侧壁馈口：短波导直接开在侧壁上
          if (x >= CAVX1 && x < 212 && fabs(y - (CY + feedY)) < 45 && fabs(z - feedZ) < 22) air = 1;
        }
        size_t id = ID(i, j, k);
        metal[id] = air ? 0 : 1;
        eps[id] = e;
        sig[id] = 0;
      }
}

static void set_food(double theta) {
  int k0 = (int)floor((foodZ0 - Z0_) / DX + .5), k1 = (int)floor((foodZ0 + foodThick - Z0_) / DX + .5);
  const int ss = 4;
  double c = cos(theta), s = sin(theta);
#pragma omp parallel for
  for (int i = 0; i < Nx; i++)
    for (int j = 0; j < Ny; j++) {
      int hit = 0;
      for (int a = 0; a < ss; a++)
        for (int b = 0; b < ss; b++) {
          double px = xc(i) + ((a + .5) / ss - .5) * DX - CX, py = yc(j) + ((b + .5) / ss - .5) * DX - CY;
          double u = c * px + s * py - foodFx, v = -s * px + c * py - foodFy;
          int in = foodDisc ? (u * u + v * v <= foodW * foodW / 4) : (fabs(u) <= foodW / 2 && fabs(v) <= foodH / 2);
          hit += in;
        }
      double f = hit / (double)(ss * ss);
      for (int k = k0 - 1; k <= k1; k++) {
        if (k < 0 || k >= Nz) continue;
        size_t id = ID(i, j, k);
        if (metal[id]) continue;
        double z = zc(k);
        int inz = z > foodZ0 && z < foodZ0 + foodThick;
        double base = 1;
        if (scenario == 0 && z < GLASSZ) base = 6;
        if (scenario == 1 && z > TRAY_Z0 && z < TRAY_Z1 && hypot(xc(i) - CX, yc(j) - CY) < TRAY_R) base = 6;
        eps[id] = inz ? base + (foodEps - base) * f : base;
        sig[id] = inz ? foodSig * f : 0;
      }
    }
}

static inline void coef(float *ca, float *cb, size_t id, double e, double s, int pec) {
  if (pec) { ca[id] = 0; cb[id] = 0; return; }
  double sv = sdt * (s + SIG_BG) / e;
  ca[id] = (float)((1 - sv) / (1 + sv));
  cb[id] = (float)((S / e) / (1 + sv));
}

// 把 k0..k1 平面范围内的 E 系数按当前材料重算
static void coeffs(int k0, int k1) {
  if (k0 < 0) k0 = 0;
  if (k1 > Nz) k1 = Nz;
#pragma omp parallel for
  for (int i = 0; i <= Nx; i++)
    for (int j = 0; j <= Ny; j++)
      for (int k = k0; k <= k1; k++) {
        size_t id = ID(i, j, k);
        // Ex 位于 (i+½,j,k)：周围四个单元 (i,j-1..j,k-1..k)
        if (i < Nx) {
          int pec = (j == 0 || j == Ny || k == 0 || k == Nz);
          double e = 0, s = 0;
          if (!pec) {
            size_t c[4] = {ID(i, j - 1, k - 1), ID(i, j, k - 1), ID(i, j - 1, k), ID(i, j, k)};
            for (int q = 0; q < 4; q++) { pec |= metal[c[q]]; e += eps[c[q]] / 4; s += sig[c[q]] / 4; }
          }
          coef(Cax, Cbx, id, e, s, pec);
        } else { Cax[id] = Cbx[id] = 0; }
        if (j < Ny) {
          int pec = (i == 0 || i == Nx || k == 0 || k == Nz);
          double e = 0, s = 0;
          if (!pec) {
            size_t c[4] = {ID(i - 1, j, k - 1), ID(i, j, k - 1), ID(i - 1, j, k), ID(i, j, k)};
            for (int q = 0; q < 4; q++) { pec |= metal[c[q]]; e += eps[c[q]] / 4; s += sig[c[q]] / 4; }
          }
          coef(Cay, Cby, id, e, s, pec);
        } else { Cay[id] = Cby[id] = 0; }
        if (k < Nz) {
          int pec = (i == 0 || i == Nx || j == 0 || j == Ny);
          double e = 0, s = 0;
          if (!pec) {
            size_t c[4] = {ID(i - 1, j - 1, k), ID(i, j - 1, k), ID(i - 1, j, k), ID(i, j, k)};
            for (int q = 0; q < 4; q++) { pec |= metal[c[q]]; e += eps[c[q]] / 4; s += sig[c[q]] / 4; }
          }
          coef(Caz, Cbz, id, e, s, pec);
        } else { Caz[id] = Cbz[id] = 0; }
      }
}

static void set_plate(double theta) {
  int kp = (int)round((98 - Z0_) / DX);
  coeffs(kp, kp);
  double c = cos(theta), s = sin(theta);
#pragma omp parallel for
  for (int i = 0; i <= Nx; i++)
    for (int j = 0; j <= Ny; j++) {
      size_t id = ID(i, j, kp);
      double x = X0 + (i + .5) * DX - CX, y = Y0_ + j * DX - CY;
      double u = c * x + s * y, v = -s * x + c * y;
      if (in_plate(u, v)) Cax[id] = Cbx[id] = 0;
      x = X0 + i * DX - CX; y = Y0_ + (j + .5) * DX - CY;
      u = c * x + s * y; v = -s * x + c * y;
      if (in_plate(u, v)) Cay[id] = Cby[id] = 0;
    }
}

static long tstep = 0;
static void step(void) {
  const int ny1 = Ny + 1, nz1 = Nz + 1;
  const size_t sx = (size_t)ny1 * nz1, sy = nz1, sz = 1;
  const float Sf = (float)S;
#pragma omp parallel for schedule(static)
  for (int i = 0; i < Nx; i++)
    for (int j = 0; j < Ny; j++) {
      size_t b = ID(i, j, 0);
      float *restrict hx = Hx + b, *restrict hy = Hy + b, *restrict hz = Hz + b;
      const float *ex = Ex + b, *ey = Ey + b, *ez = Ez + b;
#pragma omp simd
      for (int k = 0; k < Nz; k++) {
        hx[k] -= Sf * ((ez[k + sy] - ez[k]) - (ey[k + sz] - ey[k]));
        hy[k] -= Sf * ((ex[k + sz] - ex[k]) - (ez[k + sx] - ez[k]));
        hz[k] -= Sf * ((ey[k + sx] - ey[k]) - (ex[k + sy] - ex[k]));
      }
    }
#pragma omp parallel for schedule(static)
  for (int i = 1; i < Nx; i++)
    for (int j = 1; j < Ny; j++) {
      size_t b = ID(i, j, 0);
      float *restrict ex = Ex + b, *restrict ey = Ey + b, *restrict ez = Ez + b;
      const float *hx = Hx + b, *hy = Hy + b, *hz = Hz + b;
      const float *cax = Cax + b, *cbx = Cbx + b, *cay = Cay + b, *cby = Cby + b, *caz = Caz + b, *cbz = Cbz + b;
#pragma omp simd
      for (int k = 1; k < Nz; k++) {
        ex[k] = cax[k] * ex[k] + cbx[k] * ((hz[k] - hz[(ptrdiff_t)k - (ptrdiff_t)sy]) - (hy[k] - hy[k - 1]));
        ey[k] = cay[k] * ey[k] + cby[k] * ((hx[k] - hx[k - 1]) - (hz[k] - hz[(ptrdiff_t)k - (ptrdiff_t)sx]));
        ez[k] = caz[k] * ez[k] + cbz[k] * ((hy[k] - hy[(ptrdiff_t)k - (ptrdiff_t)sx]) - (hx[k] - hx[(ptrdiff_t)k - (ptrdiff_t)sy]));
      }
    }
  // 软源：磁控管输出端，一列竖直 Ez
  double ramp = tstep < SPP ? (double)tstep / SPP : 1.0;
  float a = (float)(ramp * sin(2 * M_PI * tstep / (double)SPP));
  int is, js, k0, k1;
  if (scenario == 0) {
    is = (int)round((170 - X0) / DX); js = (int)round((CY - Y0_) / DX);
    k0 = (int)round((46 - Z0_) / DX); k1 = (int)round((78 - Z0_) / DX);
  } else {
    is = (int)round((160 - X0) / DX); js = (int)round((CY + feedY - Y0_) / DX);
    k0 = (int)round((feedZ - 18 - Z0_) / DX); k1 = (int)round((feedZ + 18 - Z0_) / DX);
  }
  if (!selftest) for (int k = k0; k <= k1; k++) Ez[ID(is, js, k)] += a;
  tstep++;
}

static inline double e2cell(int i, int j, int k) {
  double s = 0, t;
#define A(F, a, b, c) t = F[ID(a, b, c)]; s += t * t
  A(Ex, i, j, k); A(Ex, i, j + 1, k); A(Ex, i, j, k + 1); A(Ex, i, j + 1, k + 1);
  A(Ey, i, j, k); A(Ey, i + 1, j, k); A(Ey, i, j, k + 1); A(Ey, i + 1, j, k + 1);
  A(Ez, i, j, k); A(Ez, i + 1, j, k); A(Ez, i, j + 1, k); A(Ez, i + 1, j + 1, k);
  return s * .25;
}

static float *P2D, *HS, *VS;
static int kf0, kf1, kh, jv;
static void accumulate(void) {
#pragma omp parallel for
  for (int i = 0; i < Nx; i++) {
    for (int j = 0; j < Ny; j++) {
      double p = 0;
      for (int k = kf0; k < kf1; k++) {
        size_t id = ID(i, j, k);
        if (sig[id] > 0) p += sig[id] * e2cell(i, j, k);
      }
      P2D[i * Ny + j] += (float)p;
      if (!metal[ID(i, j, kh)]) HS[i * Ny + j] += (float)e2cell(i, j, kh);
    }
    for (int k = 0; k < Nz; k++)
      if (!metal[ID(i, jv, k)]) VS[i * Nz + k] += (float)e2cell(i, jv, k);
  }
}

static float *alloc(size_t n) {
  float *p = aligned_alloc(64, ((n * sizeof(float)) / 64 + 1) * 64);
  if (!p) { fprintf(stderr, "oom\n"); exit(1); }
  memset(p, 0, n * sizeof(float));
  return p;
}

int main(int argc, char **argv) {
  if (argc < 12) { fprintf(stderr, "usage\n"); return 1; }
  scenario = !strcmp(argv[1], "turntable");
  foodDisc = !strcmp(argv[2], "disc");
  foodW = atof(argv[3]); foodH = atof(argv[4]); foodFx = atof(argv[5]); foodFy = atof(argv[6]); foodThick = atof(argv[7]);
  int nang = atoi(argv[8]), settle = atoi(argv[9]), navg = atoi(argv[10]);
  const char *out = argv[11];
  int rec = 0;
  for (int a = 12; a < argc; a++) {
    if (!strcmp(argv[a], "--eps")) foodEps = atof(argv[++a]);
    else if (!strcmp(argv[a], "--sig")) foodSig = atof(argv[++a]);
    else if (!strcmp(argv[a], "--freq")) FREQ = atof(argv[++a]) * 1e9;
    else if (!strcmp(argv[a], "--record")) rec = 1;
    else if (!strcmp(argv[a], "--dx")) { double d = atof(argv[++a]); double r = DX / d; Nx = (int)round(Nx * r); Ny = (int)round(Ny * r); Nz = (int)round(Nz * r); SPP = (int)round(SPP * r); DX = d; }
    else if (!strcmp(argv[a], "--selftest")) selftest = 1;
    else if (!strcmp(argv[a], "--rodz")) rodz = atof(argv[++a]);
    else if (!strcmp(argv[a], "--feedz")) feedZ = atof(argv[++a]);
    else if (!strcmp(argv[a], "--feedy")) feedY = atof(argv[++a]);
    else if (!strcmp(argv[a], "--plate")) plateKind = atoi(argv[++a]);
  }
  foodZ0 = scenario ? TRAY_Z1 : GLASSZ;
  double lam = C0 / FREQ * 1000;
  S = lam / (SPP * DX);
  if (S > 0.57735) { fprintf(stderr, "Courant violated %f\n", S); return 1; }
  sdt = S * (DX / 1000) * ETA0 / 2;
  fprintf(stderr, "grid %dx%dx%d = %.2fM cells, S=%.4f, threads=%d\n", Nx, Ny, Nz, Nx * Ny * Nz / 1e6, S, omp_get_max_threads());

  size_t N = ID(Nx, Ny, Nz) + 1;
  Ex = alloc(N); Ey = alloc(N); Ez = alloc(N); Hx = alloc(N); Hy = alloc(N); Hz = alloc(N);
  Cax = alloc(N); Cbx = alloc(N); Cay = alloc(N); Cby = alloc(N); Caz = alloc(N); Cbz = alloc(N);
  eps = alloc(N); sig = alloc(N);
  metal = malloc(N); memset(metal, 1, N);
  for (size_t i = 0; i < N; i++) eps[i] = 1;

  carve();
  if (selftest) {  // 空腔谐振校验：只留主腔，脉冲激励，记录探针时间序列
#pragma omp parallel for
    for (size_t i = 0; i < N; i++) metal[i] = 1;
#pragma omp parallel for
    for (int i = 0; i < Nx; i++) for (int j = 0; j < Ny; j++) for (int k = 0; k < Nz; k++) {
      double x = xc(i), y = yc(j), z = zc(k);
      size_t id = ID(i, j, k);
      metal[id] = !(x > CAVX0 && x < CAVX1 && y > CAVY0 && y < CAVY1 && z > GLASSZ && z < CAVZ1);
      eps[id] = 1; sig[id] = 0;
    }
    coeffs(0, Nz);
    int nt = 60000;
    float *rec_ = alloc(nt * 3);
    int pi_ = 37, pj = 29, pk = 31, qi = 71, qj = 47, qk = 41;
    for (int n = 0; n < nt; n++) {
      for (int z = 0; z < 0; z++) {}
      double g = exp(-pow(n - 60.0, 2) / (2 * 12.0 * 12.0));
      Ex[ID(qi, qj, qk)] += g; Ey[ID(qi, qj, qk)] += g; Ez[ID(qi, qj, qk)] += g;
      step();
      rec_[3 * n] = Ex[ID(pi_, pj, pk)]; rec_[3 * n + 1] = Ey[ID(pi_, pj, pk)]; rec_[3 * n + 2] = Ez[ID(pi_, pj, pk)];
    }
    FILE *f = fopen(out, "wb"); fwrite(rec_, sizeof(float), nt * 3, f); fclose(f);
    fprintf(stderr, "selftest done S=%.4f\n", S);
    return 0;
  }
  P2D = alloc(Nx * Ny); HS = alloc(Nx * Ny); VS = alloc(Nx * Nz);
  kf0 = (int)floor((foodZ0 - Z0_) / DX + .5) - 1; kf1 = (int)floor((foodZ0 + foodThick - Z0_) / DX + .5) + 1;
  kh = (int)floor((foodZ0 + foodThick / 2 - Z0_) / DX);
  jv = (int)round((CY - Y0_) / DX);

  set_food(0);
  coeffs(0, Nz);
  if (scenario == 0) set_plate(0);

  FILE *fo = fopen(out, "wb");
  int hdr[8] = {Nx, Ny, Nz, nang, kf0, kf1, kh, jv};
  fwrite(hdr, sizeof(int), 8, fo);

  FILE *fw = NULL;
  if (rec) {
    char nm[512];
    snprintf(nm, sizeof nm, "%s.waves", out);
    fw = fopen(nm, "wb");
  }
  float *snap = alloc((size_t)Nx * Nz);
  double t0 = omp_get_wtime();
  int every = SPP / 18;
  for (int a = 0; a < nang; a++) {
    double th = 2 * M_PI * a / nang;
    if (a > 0) {
      if (scenario == 0) set_plate(th);
      else { set_food(th); coeffs(kf0 - 2, kf1 + 2); }
    }
    int sett = a == 0 ? settle * 3 : settle;
    // 第一个角度：记录从零开始的瞬态（Ez 在 y=CY 竖直切面）
    for (long n = 0; n < (long)sett * SPP; n++) {
      step();
      if (fw && a == 0 && n % (SPP / 6) == 0 && n < 18L * SPP) {
        for (int i = 0; i < Nx; i++) for (int k = 0; k < Nz; k++) snap[i * Nz + k] = Ez[ID(i, jv, k)];
        fwrite(snap, sizeof(float), (size_t)Nx * Nz, fw);
      }
    }
    memset(P2D, 0, sizeof(float) * Nx * Ny);
    memset(HS, 0, sizeof(float) * Nx * Ny);
    memset(VS, 0, sizeof(float) * Nx * Nz);
    int cnt = 0;
    for (long n = 0; n < (long)navg * SPP; n++) {
      step();
      if (n % every == 0) { accumulate(); cnt++; }
      if (fw && a == 0 && n < SPP) {  // 稳态的一个周期
        if (n % (SPP / 18) == 0) {
          for (int i = 0; i < Nx; i++) for (int k = 0; k < Nz; k++) snap[i * Nz + k] = Ez[ID(i, jv, k)];
          fwrite(snap, sizeof(float), (size_t)Nx * Nz, fw);
        }
      }
    }
    double tot = 0;
    for (int i = 0; i < Nx * Ny; i++) { P2D[i] /= cnt; HS[i] /= cnt; tot += P2D[i]; }
    for (int i = 0; i < Nx * Nz; i++) VS[i] /= cnt;
    fwrite(P2D, sizeof(float), Nx * Ny, fo);
    fwrite(HS, sizeof(float), Nx * Ny, fo);
    fwrite(VS, sizeof(float), Nx * Nz, fo);
    fflush(fo);
    if (a < 3 || a % 6 == 0) fprintf(stderr, "ang %3d/%d  P=%.4g  t=%.0fs\n", a, nang, tot, omp_get_wtime() - t0);
  }
  fclose(fo);
  if (fw) fclose(fw);
  fprintf(stderr, "done %.0fs\n", omp_get_wtime() - t0);
  return 0;
}
