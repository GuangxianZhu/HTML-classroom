#!/usr/bin/env python3
"""把三维 FDTD 的结果压成网页用的一个二进制包（JSON 头 + 数组，整体 gzip）。"""
import gzip
import json
import os
import struct
import sys

import numpy as np

from scipy import ndimage as ndi

from analyze import CX, CY, X0, Y0, food_mask, load, rot_back, stat

OUT = sys.argv[1] if len(sys.argv) > 1 else "../web/src/sim.simz"
RUNS = sys.argv[2] if len(sys.argv) > 2 else "runs"     # 主数据用哪个网格的结果
FOODS = {
    "bento": dict(label="方便当", note="200×140×30 mm，放正中", kind="rect", w=200, h=140, fx=0, fy=0, a="a_rect", t="t_rect"),
    "disc": dict(label="大圆盘", note="Ø240×20 mm，放正中", kind="disc", w=240, h=240, fx=0, fy=0, a="a_disc", t="t_disc"),
    "cup": dict(label="一杯，居中", note="Ø84×70 mm，放正中", kind="disc", w=84, h=84, fx=0, fy=0, a="a_cup", t="t_cup"),
    "cupo": dict(label="一杯，靠边", note="Ø84×70 mm，偏离中心 100 mm", kind="disc", w=84, h=84, fx=80, fy=60, a="a_cupo", t="t_cupo"),
}
arrays, meta = {}, {"foods": {}}


def put(name, arr):
    arrays[name] = arr


def per_angle(fn, kind, w, h, fx, fy, turntable):
    D = load(fn)
    n, P = D["n"], D["P"]
    Q = np.array([rot_back(P[a], 360 * a / n, D["dx"]) for a in range(n)]) if turntable else P.copy()
    Q = Q / Q.reshape(n, -1).sum(1)[:, None, None]  # 恒功率：磁控管近似恒功率源
    return D, Q, food_mask(D, kind, w, h, fx, fy)


def cavity_crop(arr, dx):
    """只留腔体内部（x -226..94, y -178..162），arr 的最后两维是 x、y。"""
    i0, i1, j0, j1 = int(round(4 / dx)), int(round(324 / dx)), int(round(4 / dx)), int(round(340 / dx))
    return arr[..., i0:i1, j0:j1]


def resize(stack, a, b):
    """把 (n, x, y) 重采样到固定尺寸，网页不用关心仿真网格。"""
    n, p, q = stack.shape
    return np.array([ndi.zoom(stack[k], (a / p, b / q), order=1) for k in range(n)])


def field_small(D):
    """腔内食物半高处的 |E|²，开方后存 8 位，40×42。"""
    s = resize(cavity_crop(D["H"], D["dx"]).astype(np.float64), 40, 42)
    s = np.sqrt(np.clip(s, 0, None) / np.percentile(s, 99.7))
    return (np.clip(s, 0, 1) * 255).astype(np.uint8)


for key, f in FOODS.items():
    DA, QA, m = per_angle(f"{RUNS}/{f['a']}.bin", f["kind"], f["w"], f["h"], f["fx"], f["fy"], False)
    DT, QT, _ = per_angle(f"{RUNS}/{f['t']}.bin", f["kind"], f["w"], f["h"], f["fx"], f["fy"], True)
    dx = DA["dx"]
    meta["N"], meta["dx"] = int(DA["n"]), float(dx)
    ii, jj = np.where(m)
    i0, i1, j0, j1 = ii.min(), ii.max() + 1, jj.min(), jj.max() + 1
    crop = (slice(None), slice(i0, i1), slice(j0, j1))
    cm = m[i0:i1, j0:j1]
    qa, qt = QA[crop], QT[crop]
    scale = float(max(qa.max(), qt.max()))
    put(f"heat.{key}.antenna", np.round(qa / scale * 65535).astype(np.uint16))
    put(f"heat.{key}.turntable", np.round(qt / scale * 65535).astype(np.uint16))
    put(f"mask.{key}", cm.astype(np.uint8))
    put(f"field.{key}.antenna", field_small(DA))
    put(f"field.{key}.turntable", field_small(DT))
    single = [stat(QA[a], m) for a in range(QA.shape[0])]
    cvs = [s["cv"] for s in single]
    order = np.argsort(cvs)
    med = int(order[len(order) // 2])
    ta, tt = stat(QA.sum(0), m), stat(QT.sum(0), m)
    meta["foods"][key] = {
        **{k: f[k] for k in ("label", "note", "kind", "w", "h", "fx", "fy")},
        "nx": int(i1 - i0), "ny": int(j1 - j0), "x0": X0 + float(i0) * dx, "y0": Y0 + float(j0) * dx,
        "stuck": dict(min=min(cvs), med=float(np.median(cvs)), max=max(cvs), medAngle=med * 360 / DA["n"], cvs=[round(c, 4) for c in cvs],
                      cold=float(np.median([s["cold"] for s in single]))),
        "antenna": ta, "turntable": tt,
    }

# ---- 舞台用：水平面（腔内 |E|² + 便当内的吸热功率） ----
DA, QA, m = per_angle(f"{RUNS}/a_rect.bin", "rect", 200, 140, 0, 0, False)
dx = DA["dx"]
H = cavity_crop(DA["H"], dx).astype(np.float64)
mc = cavity_crop(m, dx)
Hn = np.clip(np.sqrt(np.clip(H, 0, None) / np.percentile(H, 99.8)), 0, 1)
Qc = cavity_crop(QA, dx)
Qn = np.clip(np.sqrt(Qc / np.percentile(Qc[:, mc], 99.5)), 0, 1)
comp = np.where(mc[None], Qn, Hn)
put("stage.h", (np.clip(resize(comp, 80, 85), 0, 1) * 255).astype(np.uint8))

# ---- 舞台用：竖切面波形。前 108 帧是开机瞬态，后 18 帧是稳态的一个周期 ----
Nx, Nz = int(DA["Nx"]), int(DA["Nz"])
w = np.fromfile(f"{RUNS}/a_rect.bin.waves", dtype=np.float32).reshape(-1, Nx, Nz)
air = np.abs(w).max(0) > 1e-7
st = np.abs(w[-18:])
k_cav = int((118 - 38) / dx)   # 腔内（平板以上）
k_feed = int((86 - 38) / dx)   # 馈能室以下算波导
ref_c = np.percentile(st[:, :, k_cav:][np.broadcast_to(air[:, k_cav:], st[:, :, k_cav:].shape)], 98.5)
ref_g = np.percentile(st[:, :, :k_feed][np.broadcast_to(air[:, :k_feed], st[:, :, :k_feed].shape)], 98.5)
t_ = np.clip((np.arange(Nz) - k_feed) / (k_cav - k_feed), 0, 1)
t_ = t_ * t_ * (3 - 2 * t_)
ref = np.exp(np.log(ref_g) * (1 - t_) + np.log(ref_c) * t_)
v = np.tanh(w / ref[None, None, :] * 0.9)      # 软饱和，强场不至于一片白
if Nx != 119:
    v = np.array([ndi.zoom(f, (119 / Nx, 71 / Nz), order=1) for f in v])
    air = ndi.zoom(air.astype(np.float32), (119 / Nx, 71 / Nz), order=1) > 0.5
u8 = np.round(v * 126 + 128).astype(np.uint8)  # 1..254，0 留给金属（透明）
u8[:, ~air] = 0
meta["wave"] = dict(frames=int(w.shape[0]), transient=108, stepTrans=9, stepSteady=3, spp=54, periodNs=1 / 2.45, gain=float(ref_g / ref_c))
print("波导/腔内 场强比 %.1f" % (ref_g / ref_c))
put("stage.wave", u8)

# ---- 灵敏度 ----
def cv_of(fn, tt):
    p = f"{fn}.bin"
    if not os.path.exists(p):
        return None
    _, Q, mm = per_angle(p, "rect", 200, 140, 0, 0, tt)
    return dict(cv=float(stat(Q.sum(0), mm)["cv"]), stuck=float(np.median([stat(Q[a], mm)["cv"] for a in range(Q.shape[0])])))


meta["grid"] = [dict(name=n, antenna=cv_of(f"{d}/a_rect", False), turntable=cv_of(f"{d}/t_rect", True))
                for n, d in (("4 mm（36 个角度）", "runs"), ("3 mm", "runs3"), ("2 mm（18 个角度）", "runs2"))]
S = [
    ("频率 2.44 GHz", "a_f244", "t_f244"),
    ("频率 2.46 GHz", "a_f246", "t_f246"),
    ("每个角度多等 2.5 倍建场时间", "a_settle", None),
    ("天线轴短 4 mm", "a_rod70", None),
    ("天线轴短 8 mm", "a_rod74", None),
]
meta["sens"] = [dict(name=n, antenna=cv_of(f"runs/{a}", False) if a else None, turntable=cv_of(f"runs/{t}", True) if t else None) for n, a, t in S]

# ---- 换馈口、换板型：四种食物各算一遍，给图表画范围 ----
VAR = {
    "bento": (["a_rect", "a_rect_p2"], ["t_rect", "t_low", "t_top"]),
    "disc": (["a_disc", "a_disc_p2"], ["t_disc", "t_disc_low", "t_disc_top"]),
    "cup": (["a_cup", "a_cup_p2"], ["t_cup", "t_cup_low", "t_cup_top"]),
    "cupo": (["a_cupo", "a_cupo_p2"], ["t_cupo", "t_cupo_low", "t_cupo_top"]),
}
for key, (al, tl) in VAR.items():
    f = FOODS[key]
    fm = meta["foods"][key]

    def cvs(names, tt):
        r = []
        for n in names:
            if os.path.exists(f"{RUNS}/{n}.done"):
                _, Q, mm = per_angle(f"{RUNS}/{n}.bin", f["kind"], f["w"], f["h"], f["fx"], f["fy"], tt)
                r.append(float(stat(Q.sum(0), mm)["cv"]))
        return r

    fm["antennaAll"], fm["turntableAll"] = cvs(al, False), cvs(tl, True)

# ---- 打包 ----
offs, blobs, pos = {}, [], 0
for name, arr in arrays.items():
    b = arr.tobytes()
    pad = (-pos) % 8
    blobs.append(b"\0" * pad)
    pos += pad
    offs[name] = dict(offset=pos, shape=list(arr.shape), type=str(arr.dtype))
    blobs.append(b)
    pos += len(b)
meta["arrays"] = offs
hdr = json.dumps(meta, ensure_ascii=False, default=float).encode("utf-8")
hdr += b" " * ((-(len(hdr) + 4)) % 8)
raw = struct.pack("<I", len(hdr)) + hdr + b"".join(blobs)
open(OUT, "wb").write(gzip.compress(raw, 9))
json.dump({k: v for k, v in meta.items() if k != "arrays"}, open(os.path.splitext(OUT)[0] + ".meta.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=float)
print("raw %.2f MB  gz %.2f MB" % (len(raw) / 1e6, os.path.getsize(OUT) / 1e6))
for k, v in meta["foods"].items():
    print(k, "卡住 %.0f%%(%.0f–%.0f)  转盘 %.1f%%  回转天线 %.1f%%" % (v["stuck"]["med"] * 100, v["stuck"]["min"] * 100, v["stuck"]["max"] * 100, v["turntable"]["cv"] * 100, v["antenna"]["cv"] * 100),
          "转盘各馈口", [round(x * 100, 1) for x in v["turntableAll"]], "天线各板型", [round(x * 100, 1) for x in v["antennaAll"]])
for s in meta["grid"] + meta["sens"]:
    print(s["name"], {k: (round(v["cv"] * 100, 1), round(v["stuck"] * 100)) if v else None for k, v in s.items() if k != "name"})
