#!/usr/bin/env python3
"""解一遍厂房剖面的二维势流，把回路流线烘成网页用的二进制路径。

做法：在 x>=0 的半幅上解达西型的流函数方程 ∇·(r∇ψ)=0，r 是当地阻力系数。
  外墙、屋面、地坪、中线 ψ=0；夹道内墙（回路绕着它转）ψ=1；
  其他实体（设备、华夫板肋、FFU 之间的盲板）是“浮动岛”，ψ 待定，附加无环量条件。
  FFU 层、穿孔地板、干盘管是三层高阻力带。没有它们，气流会全挤在内墙边抄近路；
  有了它们，风量才被摊匀，这正是真实系统里阻力的作用。
流线就是 ψ 的等值线，相邻等值线之间的风量相等，所以点的疏密有物理意义。

这是无惯性、二维的近似：看得出绕流和分流，看不出设备后面的涡。
涡和停机扰动在网页的二维 CFD 小节里单独算。

依赖 numpy、scipy、matplotlib，只在改了模型几何时需要重跑：
  python blender/bake_flow.py blender/out
"""
import json
import os
import struct
import sys

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import ndimage, sparse
from scipy.sparse.linalg import spsolve

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "out")
S = json.load(open(os.path.join(out, "spec.json"), encoding="utf-8"))
P = S["P"]
DX = 0.05
nx = int(round(S["X_CHASE"] / DX))
nz = int(round(P["z_roof0"] / DX))
xc = (np.arange(nx) + .5) * DX
zc = (np.arange(nz) + .5) * DX
X, Z = np.meshgrid(xc, zc, indexing="ij")

solid = np.zeros((nx, nz), bool)
HW, XW = P["half_w"], S["X_WALL"]
# 内墙
solid |= (X >= HW) & (X <= XW) & (Z >= P["z_waffle0"]) & (Z <= P["z_ffu_top"])
# 华夫板：一排孔的剖面
waf = (Z >= P["z_waffle0"]) & (Z <= P["z_waffle1"]) & (X < HW)
holes = np.zeros_like(waf)
for i in range(8):
    holes |= np.abs(X - i * P["waffle_pitch"]) <= P["waffle_r"]
solid |= waf & ~holes
# FFU 之间的盲板
for cx, on in zip(S["FFU_COLS"], S["FFU_ON"]):
    if cx > 0 and not on:
        solid |= (np.abs(X - cx) <= .6) & (Z >= P["z_ceil"]) & (Z <= P["z_ffu_top"])
# 设备：连带脚下的实心地板
T = S["TOOL"]
solid |= (X >= T["efem"][0]) & (X <= T["efem"][1]) & (Z >= P["z_tile"] - .05) & (Z <= T["z_efem"])
solid |= (X >= T["body"][0]) & (X <= T["body"][1]) & (Z >= P["z_tile"] - .05) & (Z <= T["z_body"])

# 阻力带（数值是无量纲的相对值，只要远大于 1 就能把风量摊匀）
r = np.ones((nx, nz))
r[(Z >= P["z_ceil"]) & (Z <= P["z_ffu_top"])] = 300
r[(Z >= P["z_tile"] - .1) & (Z <= P["z_tile"])] = 200
r[(X >= XW) & (np.abs(Z - P["z_dcc"]) <= .24)] = 50

labels, n_lab = ndimage.label(solid)
main = labels[int(9.1 / DX), int(8.0 / DX)]
idx = -np.ones((nx, nz), int)
fluid = ~solid
nf = fluid.sum()
idx[fluid] = np.arange(nf)
isl = {l: nf + k for k, l in enumerate(l for l in range(1, n_lab + 1) if l != main)}
N = nf + len(isl)

rows, cols, vals = [], [], []
b = np.zeros(N)
for i, k in zip(*np.nonzero(fluid)):
    me = idx[i, k]
    diag = 0.0
    for ni, nk in ((i - 1, k), (i + 1, k), (i, k - 1), (i, k + 1)):
        if ni < 0 or ni >= nx or nk < 0 or nk >= nz:
            diag += r[i, k]
            continue                        # 边界 ψ=0
        g = .5 * (r[i, k] + r[ni, nk])
        diag += g
        if fluid[ni, nk]:
            rows.append(me); cols.append(idx[ni, nk]); vals.append(-g)
        else:
            lab = labels[ni, nk]
            if lab == main:
                b[me] += g                  # ψ=1
            else:
                j = isl[lab]
                rows += [me, j, j]; cols += [j, me, j]; vals += [-g, -g, g]
    rows.append(me); cols.append(me); vals.append(diag)
A = sparse.csr_matrix((vals, (rows, cols)), shape=(N, N))
sol = spsolve(A.tocsc(), b)
psi = np.zeros((nx, nz))
psi[fluid] = sol[:nf]
psi[labels == main] = 1.0
for lab, j in isl.items():
    psi[labels == lab] = sol[j]

w = -np.gradient(psi, DX, axis=0)
u = np.gradient(psi, DX, axis=1)
speed = np.hypot(u, w)
print("psi", psi.min(), psi.max(), "islands", len(isl))
# ψ 总差对应半幅单位进深风量：出风面风速 0.4 m/s × 覆盖率 × 半宽
Q2D = .4 * S["COVERAGE"] * HW

levels = np.linspace(.05, .95, 24)
cs = plt.contour(xc, zc, psi.T, levels=levels)
segs = cs.allsegs
paths = []
M = 256


def speed_at(p):
    i = np.clip((p[:, 0] / DX - .5).astype(int), 0, nx - 1)
    k = np.clip((p[:, 1] / DX - .5).astype(int), 0, nz - 1)
    return speed[i, k]


med = np.median(speed[fluid & (speed > 0)])
for lev, lst in zip(levels, segs):
    if not len(lst):
        continue
    p = max(lst, key=len)
    if np.linalg.norm(p[0] - p[-1]) > .3:
        print("open contour at", lev)
        continue
    p = p[:-1]
    d = np.linalg.norm(np.roll(p, -1, 0) - p, axis=1)
    v = np.maximum(speed_at(p), .55 * med)   # 限制最慢速度，否则点全堆在上风仓
    dt = d / v
    t = np.concatenate(([0], np.cumsum(dt)))
    period = t[-1]
    # 找 FFU 出风面下穿点，作为相位 0
    cross = [i for i in range(len(p)) if p[i, 1] >= P["z_ceil"] > p[(i + 1) % len(p), 1]]
    i0 = cross[0]
    p = np.roll(p, -i0, 0)
    d = np.roll(d, -i0)
    v = np.roll(v, -i0)
    dt = d / v
    t = np.concatenate(([0], np.cumsum(dt)))
    ts = np.linspace(0, t[-1], M, endpoint=False)
    q = np.stack([np.interp(ts, t, np.append(p[:, a], p[0, a])) for a in (0, 1)], 1)
    # 关键点相位：过地板、过干盘管
    phase = ts / t[-1]
    below_floor = np.nonzero(q[:, 1] < P["z_tile"])[0]
    p_floor = phase[below_floor[0]]
    up_dcc = [i for i in range(M - 1) if q[i, 1] < P["z_dcc"] <= q[i + 1, 1] and q[i, 0] > XW]
    p_dcc = phase[up_dcc[0]]
    T01 = np.where(phase < p_floor, phase / p_floor, np.where(phase < p_dcc, 1.0, 0.0))
    # dust：地板到 FFU 这一段有颗粒，FFU 处归零
    paths.append(dict(q=q, T=T01, period=float(t[-1]), p_floor=float(p_floor), p_dcc=float(p_dcc), lev=float(lev)))

print("paths", len(paths), "period s", paths[0]["period"] / Q2D, paths[12]["period"] / Q2D, paths[-1]["period"] / Q2D)

# 二进制：u32 N, u32 M, f32 period[N], f32 p_floor[N], 然后 N*M*3 个 i16（x,z 以 1/1000 m，T 以 1/32767）
with open(os.path.join(out, "flow_paths.dat"), "wb") as fp:
    fp.write(struct.pack("<II", len(paths), M))
    fp.write((np.array([p["period"] for p in paths]) / Q2D).astype("<f4").tobytes())
    fp.write(np.array([p["p_floor"] for p in paths], "<f4").tobytes())
    for p in paths:
        a = np.zeros((M, 3), "<i2")
        a[:, 0] = np.round(p["q"][:, 0] * 1000)
        a[:, 1] = np.round(p["q"][:, 1] * 1000)
        a[:, 2] = np.round(p["T"] * 32767)
        fp.write(a.tobytes())

fig, ax = plt.subplots(figsize=(7, 8))
ax.imshow(solid.T, origin="lower", extent=[0, S["X_CHASE"], 0, P["z_roof0"]], cmap="Greys", alpha=.5)
for p in paths:
    ax.plot(p["q"][:, 0], p["q"][:, 1], lw=.6)
fig.savefig(os.path.join(out, "flow_check.png"), dpi=90)
print("size", os.path.getsize(os.path.join(out, "flow_paths.dat")))
