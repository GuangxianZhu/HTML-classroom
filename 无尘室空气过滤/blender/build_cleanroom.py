#!/usr/bin/env python3
"""半导体无尘室空气过滤系统：纯脚本建模。

三个独立模型放在同一个 .blend / .glb 里：
  ROOT_fab  一段虚构晶圆厂的剖面（下技术夹层 → 华夫板 → 高架地板 → 无尘室 → FFU → 上风仓 → 屋面）
  ROOT_ffu  一台 FFU 的爆炸图（风机 + ULPA，折叠滤纸按真实 3 mm 节距建）
  ROOT_mau  一台 MAU 的剖切模型（新风处理各功能段）

用法（二选一）：
  blender -b -P blender/build_cleanroom.py -- --out blender/out [--render]
  pip install bpy && python blender/build_cleanroom.py --out blender/out [--render]

坐标：X 横跨厂房，Y 进深（y=0 是剖切面，朝向观察者），Z 向上，单位米。
尺寸是教学用的示意值，不对应任何一座真实工厂或产品。
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

# ---------- 参数表 ----------
P = dict(
    half_w=9.0,      # 洁净区半宽
    wall_in=0.3,     # 内墙厚
    chase=2.1,       # 回风夹道净宽
    wall_out=0.3,    # 外墙厚
    depth=7.2,       # 进深
    z_waffle0=5.0, z_waffle1=5.9,     # 华夫板
    z_tile=6.5,                       # 高架地板面
    z_ceil=10.5,                      # FFU 出风面（吊顶）
    z_ffu_top=10.95,                  # FFU 层顶，也是上风仓底
    z_roof0=14.0, z_roof1=14.35,      # 屋面板
    z_dcc=7.9,                        # 干盘管中心高度
    waffle_pitch=1.2, waffle_r=0.35,
    tile=0.6,
    ffu_w=1.2, ffu_d=0.6,
)
HW, D = P["half_w"], P["depth"]
X_WALL = HW + P["wall_in"]
X_CHASE = X_WALL + P["chase"]
X_OUT = X_CHASE + P["wall_out"]

# 工具外形（x 用绝对值，左右镜像）
TOOL = dict(efem=(1.2, 2.4), body=(2.4, 6.2), z_efem=9.2, z_body=9.4)
FFU_COLS = [-8.4 + 1.2 * i for i in range(15)]


def ffu_on(col_x):
    """中间过道和设备前端满铺，外侧隔列布置：整体覆盖率 2/3。"""
    i = round((col_x + 8.4) / 1.2)
    return abs(col_x) < 3.0 or i % 2 == 0


COVERAGE = sum(ffu_on(x) for x in FFU_COLS) / len(FFU_COLS)

# 爆炸图里各层沿 Z 的位移
LAYERS = dict(L_sub=-2.6, L_waffle=-1.3, L_floor=0.0, L_room=1.3, L_ffu=2.9, L_plenum=4.5, L_roof=6.1)

# ---------- 材质 ----------
#        名称          基色(sRGB hex)  金属 粗糙  透明   自发光强度
MATS = {
    "concrete":     ("#8C9094", 0.0, 0.9, 1.0, 0),
    "poche":        ("#2B3036", 0.0, 1.0, 1.0, 0),
    "wall_white":   ("#DDE3E6", 0.0, 0.55, 1.0, 0),
    "wall_grey":    ("#9BA5AB", 0.1, 0.6, 1.0, 0),
    "steel":        ("#AEB6BC", 0.9, 0.38, 1.0, 0),
    "steel_dark":   ("#5A646B", 0.8, 0.5, 1.0, 0),
    "alu":          ("#CDD3D7", 0.9, 0.3, 1.0, 0),
    "paint_blue":   ("#3E6F8E", 0.2, 0.45, 1.0, 0),
    "paint_grey":   ("#6E7A82", 0.2, 0.5, 1.0, 0),
    "ffu_body":     ("#C4CCD1", 0.7, 0.42, 1.0, 0),
    "ffu_face":     ("#F2F5F6", 0.0, 0.7, 1.0, 0),
    "media":        ("#EEF0E9", 0.0, 0.85, 1.0, 0),
    "hotmelt":      ("#D9C48A", 0.0, 0.5, 1.0, 0),
    "gel":          ("#5AA6C8", 0.0, 0.3, 1.0, 0),
    "tile":         ("#B9C2C7", 0.6, 0.45, 1.0, 0),
    "tool_white":   ("#E6EAEC", 0.05, 0.4, 1.0, 0),
    "tool_grey":    ("#A7B1B7", 0.2, 0.45, 1.0, 0),
    "tool_dark":    ("#3C444A", 0.3, 0.5, 1.0, 0),
    "glass":        ("#BFE3EE", 0.0, 0.08, 0.22, 0),
    "foup":         ("#7FA3B5", 0.0, 0.25, 0.65, 0),
    "wafer":        ("#6A5C96", 1.0, 0.12, 1.0, 0),
    "amber":        ("#FFB23E", 0.0, 0.5, 1.0, 6),
    "led":          ("#F4FBFF", 0.0, 0.5, 1.0, 7),
    "led_cyan":     ("#5FD8F0", 0.0, 0.5, 1.0, 4),
    "fin":          ("#B98F6A", 0.9, 0.4, 1.0, 0),
    "copper":       ("#B5673A", 1.0, 0.32, 1.0, 0),
    "pipe_cold":    ("#2F7FBF", 0.2, 0.4, 1.0, 0),
    "pipe_warm":    ("#C3512F", 0.2, 0.4, 1.0, 0),
    "duct":         ("#B4BCC2", 0.95, 0.3, 1.0, 0),
    "suit":         ("#EFF2F4", 0.0, 0.65, 1.0, 0),
    "suit_blue":    ("#2F5F86", 0.0, 0.5, 1.0, 0),
    "pump":         ("#4C7A63", 0.2, 0.45, 1.0, 0),
    "carbon":       ("#23272B", 0.1, 0.8, 1.0, 0),
    "prefilter":    ("#D8D2C0", 0.0, 0.9, 1.0, 0),
    "bag":          ("#DDBE54", 0.0, 0.85, 1.0, 0),
    "water":        ("#6FC3E8", 0.0, 0.1, 0.8, 0),
    "fan_black":    ("#2A2F33", 0.5, 0.4, 1.0, 0),
    "impeller":     ("#7E8B93", 0.8, 0.35, 1.0, 0),
    "fresh":        ("#7FB89A", 0.3, 0.4, 1.0, 0),
    "grate":        ("#7A848A", 0.8, 0.5, 1.0, 0),
}


def srgb(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c]


def make_tile_image(out_dir):
    """穿孔地板：RGBA 贴图，孔处 alpha=0，开孔率约 25%。"""
    n = 192
    img = bpy.data.images.new("tex_tile", n, n, alpha=True)
    holes = 10
    pitch = n / holes
    r = pitch * math.sqrt(0.25 / math.pi)
    px = [0.0] * (n * n * 4)
    for j in range(n):
        for i in range(n):
            cx = (math.floor(i / pitch) + 0.5) * pitch
            cy = (math.floor(j / pitch) + 0.5) * pitch
            d = math.hypot(i + 0.5 - cx, j + 0.5 - cy)
            a = min(1.0, max(0.0, d - r + 0.5))
            edge = min(i, j, n - 1 - i, n - 1 - j)
            k = (j * n + i) * 4
            if edge < 3:
                px[k:k + 4] = [0.30, 0.34, 0.37, 1.0]
            else:
                px[k:k + 4] = [0.75, 0.78, 0.80, a]
    img.pixels.foreach_set(px)
    img.filepath_raw = os.path.join(out_dir, "tex_tile.png")
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


def build_materials(out_dir):
    out = {}
    tile_img = make_tile_image(out_dir)
    for name, (col, metal, rough, alpha, emit) in MATS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        c = srgb(col)
        b.inputs["Base Color"].default_value = (*c, 1)
        b.inputs["Metallic"].default_value = metal
        b.inputs["Roughness"].default_value = rough
        b.inputs["Alpha"].default_value = alpha
        if emit:
            key = "Emission Color" if "Emission Color" in b.inputs else "Emission"
            b.inputs[key].default_value = (*c, 1)
            if "Emission Strength" in b.inputs:
                b.inputs["Emission Strength"].default_value = emit
        if alpha < 1:
            for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
                if hasattr(m, attr):
                    try:
                        setattr(m, attr, val)
                    except (TypeError, ValueError):
                        pass
        if name == "tile":
            tex = m.node_tree.nodes.new("ShaderNodeTexImage")
            tex.image = tile_img
            m.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
            m.node_tree.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
            for attr, val in (("surface_render_method", "DITHERED"), ("blend_method", "CLIP")):
                if hasattr(m, attr):
                    try:
                        setattr(m, attr, val)
                    except (TypeError, ValueError):
                        pass
        out[name] = m
    return out


# ---------- 几何累加器：同一 (根, 部件, 材质) 的几何合成一个网格，控制 draw call ----------
class Acc:
    def __init__(self):
        self.v, self.f, self.sm, self.uv = [], [], [], []

    def add(self, verts, faces, smooth=False, uv=None):
        base = len(self.v)
        self.v.extend(tuple(p) for p in verts)
        self.uv.extend(uv if uv is not None else [(0.0, 0.0)] * len(verts))
        for i, fa in enumerate(faces):
            self.f.append(tuple(k + base for k in fa))
            self.sm.append(smooth[i] if isinstance(smooth, (list, tuple)) else smooth)


GEO = {}


def acc(k):
    return GEO.setdefault(k, Acc())


def box(k, x0, x1, y0, y1, z0, z1, skip=""):
    """轴对齐盒子。skip 里的字母表示不要该面：b t f(y0) r(y1) l(x0) e(x1)。"""
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = {"b": (3, 2, 1, 0), "t": (4, 5, 6, 7), "f": (0, 1, 5, 4), "e": (1, 2, 6, 5),
             "r": (2, 3, 7, 6), "l": (3, 0, 4, 7)}
    acc(k).add(v, [f for c, f in faces.items() if c not in skip])


def cbox(k, cx, cy, cz, sx, sy, sz):
    box(k, cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2)


def cap(root, layer, x0, x1, z0, z1, y=0.0):
    """剖切面上的实心填充（poche），网页里用无光照材质画，读起来像工程剖面图。"""
    acc((root, layer, "poche")).add([(x0, y - 0.004, z0), (x1, y - 0.004, z0), (x1, y - 0.004, z1), (x0, y - 0.004, z1)], [(0, 1, 2, 3)])


def basis(d):
    d = Vector(d).normalized()
    a = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0))
    u = d.cross(a).normalized()
    return u, d.cross(u).normalized(), d


def cyl(k, p0, p1, r, n=16, caps=True, r1=None, smooth=True):
    p0, p1 = Vector(p0), Vector(p1)
    u, w, _ = basis(p1 - p0)
    r1 = r if r1 is None else r1
    v, f = [], []
    for i in range(n):
        a = 2 * math.pi * i / n
        rad = u * math.cos(a) + w * math.sin(a)
        v.append(tuple(p0 + rad * r))
        v.append(tuple(p1 + rad * r1))
    sm = []
    for i in range(n):
        j = (i + 1) % n
        f.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
        sm.append(smooth)
    if caps:
        f.append(tuple(2 * i + 1 for i in range(n)))
        f.append(tuple(2 * i for i in reversed(range(n))))
        sm += [False, False]
    acc(k).add(v, f, sm)


def sphere(k, c, r, nu=14, nv=8, sz=1.0):
    c = Vector(c)
    v, f = [], []
    for j in range(nv + 1):
        t = math.pi * j / nv
        for i in range(nu):
            a = 2 * math.pi * i / nu
            v.append(tuple(c + Vector((r * math.sin(t) * math.cos(a), r * math.sin(t) * math.sin(a), sz * r * math.cos(t)))))
    for j in range(nv):
        for i in range(nu):
            a, b = j * nu + i, j * nu + (i + 1) % nu
            f.append((a + nu, b + nu, b, a))
    acc(k).add(v, f, True)


def roundrect(w, d, r, seg=4):
    pts = []
    for (cx, cy, a0) in ((w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, 90), (-w / 2 + r, -d / 2 + r, 180), (w / 2 - r, -d / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def prism(k, pts, z0, z1, off=(0, 0), smooth=True, mat=None):
    """沿 Z 拉伸二维轮廓；mat 可把它转到别的方向。"""
    n = len(pts)
    v = [(x + off[0], y + off[1], z0) for x, y in pts] + [(x + off[0], y + off[1], z1) for x, y in pts]
    if mat is not None:
        v = [tuple(mat @ Vector(p)) for p in v]
    f, sm = [], []
    for i in range(n):
        j = (i + 1) % n
        f.append((i, j, j + n, i + n))
        sm.append(smooth)
    f.append(tuple(range(n, 2 * n)))
    f.append(tuple(reversed(range(n))))
    sm += [False, False]
    acc(k).add(v, f, sm)


def tube(k, pts, r, n=12):
    """折线管道，转角处斜接。"""
    P_ = [Vector(p) for p in pts]
    rings = []
    prev_u = None
    for i, p in enumerate(P_):
        d0 = (P_[i] - P_[i - 1]).normalized() if i else (P_[1] - P_[0]).normalized()
        d1 = (P_[i + 1] - P_[i]).normalized() if i < len(P_) - 1 else d0
        t = (d0 + d1).normalized()
        if prev_u is None:
            prev_u = basis(t)[0]
        u = (prev_u - t * prev_u.dot(t)).normalized()
        w = t.cross(u)
        s = 1 / max(0.3, d0.dot(t))
        ring = []
        for a in range(n):
            ang = 2 * math.pi * a / n
            ring.append(tuple(p + (u * math.cos(ang) * s + w * math.sin(ang)) * r))
        rings.append(ring)
        prev_u = u
    v = [q for ring in rings for q in ring]
    f = []
    for i in range(len(rings) - 1):
        for a in range(n):
            b = (a + 1) % n
            f.append((i * n + a, i * n + b, (i + 1) * n + b, (i + 1) * n + a))
    acc(k).add(v, f, True)


def plate_with_hole(k, cx, cy, hx, hy, r, z0, z1, phi0=0.0, phi1=2 * math.pi, n=24, y_cut_face=None):
    """方板开圆孔。phi 区间用于做被剖切面切开的半格。"""
    steps = max(4, round(n * (phi1 - phi0) / (2 * math.pi)))
    v, f = [], []
    sm = []
    for i in range(steps + 1):
        a = phi0 + (phi1 - phi0) * i / steps
        ca, sa = math.cos(a), math.sin(a)
        t = min(hx / max(abs(ca), 1e-6), hy / max(abs(sa), 1e-6))
        ox, oy = cx + ca * t, cy + sa * t
        ix, iy = cx + ca * r, cy + sa * r
        v += [(ix, iy, z1), (ox, oy, z1), (ix, iy, z0), (ox, oy, z0)]
    for i in range(steps):
        a, b = 4 * i, 4 * (i + 1)
        f.append((a, a + 1, b + 1, b)); sm.append(False)       # 顶面
        f.append((b + 2, b + 3, a + 3, a + 2)); sm.append(False)  # 底面
        f.append((a + 2, a, b, b + 2)); sm.append(True)        # 孔壁
    acc(k).add(v, f, sm)


class Xf:
    """把局部坐标映射到世界：工具沿 X 镜像时用。"""
    def __init__(self, sx=1.0):
        self.s = sx

    def x(self, a, b=None):
        if b is None:
            return a * self.s
        lo, hi = sorted((a * self.s, b * self.s))
        return lo, hi


# ---------- 厂房 ----------
def k_(layer, mat, root="fab"):
    return (root, layer, mat)


def build_structure():
    # 地坪
    box(k_("L_sub", "concrete"), -X_OUT, X_OUT, 0, D, -0.4, 0)
    cap("fab", "L_sub", -X_OUT, X_OUT, -0.4, 0)
    # 后墙：每层用不同饰面
    for layer, mat, z0, z1, x in (
        ("L_sub", "wall_grey", 0, P["z_waffle0"], X_CHASE),
        ("L_room", "wall_white", P["z_waffle1"], P["z_ffu_top"], HW),
        ("L_plenum", "wall_grey", P["z_ffu_top"], P["z_roof0"], X_CHASE),
    ):
        box(k_(layer, mat), -x, x, D, D + 0.25, z0, z1, skip="b t")
    # 夹道后墙（无尘室高度段）
    for s in (-1, 1):
        lo, hi = sorted((s * X_WALL, s * X_CHASE))
        box(k_("L_room", "wall_grey"), lo, hi, D, D + 0.25, P["z_waffle1"], P["z_ffu_top"], skip="b t")
        # 外墙按层切开，爆炸时跟着各层走
        for layer, z0, z1 in (("L_sub", 0, P["z_waffle0"]), ("L_waffle", P["z_waffle0"], P["z_waffle1"]),
                              ("L_room", P["z_waffle1"], P["z_ffu_top"]), ("L_plenum", P["z_ffu_top"], P["z_roof0"])):
            lo, hi = sorted((s * X_CHASE, s * X_OUT))
            box(k_(layer, "concrete"), lo, hi, 0, D + 0.25, z0, z1)
            cap("fab", layer, lo, hi, z0, z1)
        # 无尘室侧墙（内墙）
        lo, hi = sorted((s * HW, s * X_WALL))
        box(k_("L_room", "wall_white"), lo, hi, 0, D, P["z_waffle1"], P["z_ffu_top"])
        cap("fab", "L_room", lo, hi, P["z_waffle1"], P["z_ffu_top"])
    # 屋面板
    box(k_("L_roof", "concrete"), -X_OUT, X_OUT, 0, D + 0.25, P["z_roof0"], P["z_roof1"])
    cap("fab", "L_roof", -X_OUT, X_OUT, P["z_roof0"], P["z_roof1"])
    # 下技术夹层立柱
    for x in (-7.2, -2.4, 2.4, 7.2):
        for y in (1.8, 5.4):
            cbox(k_("L_sub", "concrete"), x, y, P["z_waffle0"] / 2, 0.7, 0.7, P["z_waffle0"])


def build_waffle():
    """华夫板：孔中心落在 y=0 上，这样剖切面正好切开一排孔。"""
    z0, z1 = P["z_waffle0"], P["z_waffle1"]
    p, r = P["waffle_pitch"], P["waffle_r"]
    k = k_("L_waffle", "concrete")
    xs = [-8.4 + p * i for i in range(15)]
    ys = [p * j for j in range(7)]
    for x in xs:
        for y in ys:
            if y == 0:
                plate_with_hole(k, x, y, p / 2, p / 2, r, z0, z1, 0, math.pi)
                cap("fab", "L_waffle", x - p / 2, x - r, z0, z1)
                cap("fab", "L_waffle", x + r, x + p / 2, z0, z1)
            elif abs(y - D) < 1e-6:
                plate_with_hole(k, x, y, p / 2, p / 2, r, z0, z1, math.pi, 2 * math.pi)
            else:
                plate_with_hole(k, x, y, p / 2, p / 2, r, z0, z1)
    for s in (-1, 1):       # 两侧实心边
        lo, hi = sorted((s * HW, s * X_WALL))
        box(k, lo, hi, 0, D, z0, z1)
        cap("fab", "L_waffle", lo, hi, z0, z1)


def build_raised_floor():
    z = P["z_tile"]
    t = P["tile"]
    k = k_("L_floor", "tile")
    nx, ny = round(2 * HW / t), round(D / t)
    acc(k).add([(-HW, 0, z), (HW, 0, z), (HW, D, z), (-HW, D, z)], [(0, 1, 2, 3)],
               uv=[(0, 0), (nx, 0), (nx, ny), (0, ny)])
    acc(k).add([(-HW, 0, z - .005), (-HW, D, z - .005), (HW, D, z - .005), (HW, 0, z - .005)], [(0, 1, 2, 3)],
               uv=[(0, 0), (0, ny), (nx, ny), (nx, 0)])
    ks = k_("L_floor", "steel_dark")
    for i in range(16):
        x = -HW + 1.2 * i
        box(ks, x - .025, x + .025, 0, D, z - .09, z - .03, skip="b")
    for j in range(7):
        y = 1.2 * j
        box(ks, -HW, HW, y - .02 if j else 0, y + .02, z - .09, z - .03, skip="b")
    for i in range(16):
        for j in range(7):
            cyl(k_("L_floor", "steel"), (-HW + 1.2 * i, max(1.2 * j, .03), P["z_waffle1"]), (-HW + 1.2 * i, max(1.2 * j, .03), z - .09), .022, n=6, caps=False)
    cap("fab", "L_floor", -HW, HW, z - .05, z)


def low_ffu(x, y):
    w, d = P["ffu_w"] - .03, P["ffu_d"] - .03
    z = P["z_ceil"]
    cbox(k_("L_ffu", "ffu_body"), x, y, z + .2, w * .96, d * .96, .32)
    cbox(k_("L_ffu", "ffu_face"), x, y, z + .02, w, d, .05)
    cyl(k_("L_ffu", "steel_dark"), (x, y, z + .36), (x, y, z + .46), .17, n=10, r1=.13)


def build_ffu_layer():
    z = P["z_ceil"]
    rows = [0.3 + .6 * j for j in range(12)]
    for cx in FFU_COLS:
        for cy in rows:
            if ffu_on(cx):
                low_ffu(cx, cy)
            else:
                box(k_("L_ffu", "wall_white"), cx - .6, cx + .6, cy - .3, cy + .3, z, z + .04)
                if int(round((cy - .3) / .6)) % 2 == 0:
                    box(k_("L_ffu", "led"), cx - .5, cx + .5, cy - .04, cy + .04, z - .012, z)
    tg = k_("L_ffu", "alu")
    for i in range(16):
        x = -HW + 1.2 * i
        box(tg, x - .022, x + .022, 0, D, z - .018, z + .06)
    for j in range(13):
        y = .6 * j
        box(tg, -HW, HW, max(y - .022, 0), min(y + .022, D), z - .018, z + .06)
    cap("fab", "L_ffu", -HW, HW, z - .018, z + .06)
    # 天车轨道（在两侧上下料口上方）
    for s in (-1, 1):
        x = s * 1.02
        for y in (1.2, 3.6, 6.0):
            cyl(k_("L_ffu", "steel"), (x, y, z), (x, y, 9.86), .018, n=6, caps=False)
        box(k_("L_ffu", "alu"), x - .13, x + .13, 0, D, 9.74, 9.86)
    # 天车小车 + 正在下放的 FOUP
    x, y = 1.02, 2.1
    cbox(k_("L_ffu", "tool_white"), x, y, 9.56, .5, .78, .34)
    box(k_("L_ffu", "amber"), x - .26, x - .25, y - .2, y + .2, 9.5, 9.54)
    for dy in (-.12, .12):
        cyl(k_("L_ffu", "fan_black"), (x, y + dy, 9.39), (x, y + dy, 8.96), .006, n=5, caps=False)


def efem(s, y0):
    """设备前端模块：自带小 FFU 的微环境。"""
    x = Xf(s)
    ex0, ex1 = TOOL["efem"]
    y1 = y0 + 2.4
    lo, hi = x.x(ex0, ex1)
    zt = P["z_tile"]
    box(k_("L_room", "tool_grey"), lo, hi, y0, y1, zt, zt + .9)           # 下半机柜
    # 玻璃外壳
    box(k_("L_room", "glass"), lo, hi, y0, y1, zt + .9, 8.85)
    for gx in (lo, hi):
        for gy in (y0, y1):
            cbox(k_("L_room", "alu"), gx, gy, (zt + .9 + 8.85) / 2, .05, .05, 8.85 - zt - .9)
    cbox(k_("L_room", "tool_grey"), (lo + hi) / 2, (y0 + y1) / 2, 8.87, hi - lo, y1 - y0, .05)
    # 自带 FFU
    box(k_("L_room", "ffu_body"), lo + .05, hi - .05, y0 + .05, y1 - .05, 8.9, 9.14)
    box(k_("L_room", "led_cyan"), lo + .05, hi - .05, y0 + .05, y1 - .05, 8.84, 8.86)
    # 机器人
    rx, ry = x.x(1.8), (y0 + y1) / 2
    cyl(k_("L_room", "tool_white"), (rx, ry, zt + .9), (rx, ry, zt + 1.4), .11, n=14)
    tube(k_("L_room", "tool_white"), [(rx, ry, zt + 1.45), (rx + s * .05, ry + .3, zt + 1.45)], .05, n=8)
    tube(k_("L_room", "tool_white"), [(rx + s * .05, ry + .3, zt + 1.5), (rx - s * .25, ry + .45, zt + 1.5)], .04, n=8)
    box(k_("L_room", "steel_dark"), *sorted((rx - s * .25, rx - s * .52)), ry + .38, ry + .52, zt + 1.53, zt + 1.545)
    # 三个上料口 + FOUP
    for i, dy in enumerate((-.7, 0, .7)):
        py = (y0 + y1) / 2 + dy
        px0, px1 = x.x(ex0 - .4, ex0)
        box(k_("L_room", "tool_grey"), px0, px1, py - .25, py + .25, zt + .55, zt + .9)
        box(k_("L_room", "tool_grey"), *x.x(ex0 - .02, ex0 + .02), py - .25, py + .25, zt + .9, zt + 1.3)
        foup(x.x(ex0 - .2), py, zt + .92)


def foup(cx, cy, z):
    w = .36
    prism(k_("L_room", "foup"), roundrect(w, w, .05), z, z + .32, off=(cx, cy))
    box(k_("L_room", "tool_dark"), cx - .05, cx + .05, cy - .05, cy + .05, z + .32, z + .36)
    for i in range(5):
        cyl(k_("L_room", "wafer"), (cx, cy, z + .06 + i * .05), (cx, cy, z + .063 + i * .05), .15, n=20)


def tool_litho_like(s, y0):
    """左侧：大体量、黄光灯条。外形虚构。"""
    x = Xf(s)
    bx0, bx1 = TOOL["body"]
    lo, hi = x.x(bx0, bx1)
    y1 = y0 + 2.4
    zt = P["z_tile"]
    cx, cy = (lo + hi) / 2, (y0 + y1) / 2
    prism(k_("L_room", "tool_white"), roundrect(hi - lo, y1 - y0, .12), zt, TOOL["z_body"] - .35, off=(cx, cy))
    prism(k_("L_room", "tool_grey"), roundrect(hi - lo - .4, y1 - y0 - .4, .1), TOOL["z_body"] - .35, TOOL["z_body"] - .28, off=(cx, cy))
    # 顶上的化学过滤箱：设备自己的 AMC 防线
    box(k_("L_room", "carbon"), cx - 1.1, cx + 1.1, cy - .75, cy + .75, TOOL["z_body"] - .28, TOOL["z_body"] + .1)
    box(k_("L_room", "steel_dark"), cx - 1.15, cx + 1.15, cy - .8, cy + .8, TOOL["z_body"] + .1, TOOL["z_body"] + .13)
    # 黄光灯条与检修门分缝
    box(k_("L_room", "amber"), lo + .2, hi - .2, y0 - .006, y0, zt + 2.05, zt + 2.09)
    for t in (.25, .5, .75):
        gx = lo + (hi - lo) * t
        box(k_("L_room", "tool_grey"), gx - .006, gx + .006, y0 - .004, y0, zt + .1, zt + 2.0)
    box(k_("L_room", "tool_dark"), lo + .3, lo + .95, y0 - .012, y0, zt + 1.3, zt + 1.75)


def tool_cluster(s, y0):
    """右侧：传送腔加三个圆腔。外形虚构。"""
    x = Xf(s)
    bx0, bx1 = TOOL["body"]
    lo, hi = x.x(bx0, bx1)
    y1 = y0 + 2.4
    zt = P["z_tile"]
    cy = (y0 + y1) / 2
    box(k_("L_room", "tool_grey"), lo, hi, y0 + .05, y1 - .05, zt, zt + 1.05)
    tx = x.x(3.6)
    hexa = [(0.85 * math.cos(math.radians(a)), .85 * math.sin(math.radians(a))) for a in range(0, 360, 60)]
    prism(k_("L_room", "steel"), hexa, zt + 1.05, zt + 1.5, off=(tx, cy), smooth=False)
    for dx, dy in ((1.5, 0), (.75, .72), (.75, -.72)):
        cx_, cy_ = x.x(3.6 + dx), cy + dy * .95
        cyl(k_("L_room", "alu"), (cx_, cy_, zt + 1.05), (cx_, cy_, zt + 1.75), .52, n=28)
        cyl(k_("L_room", "copper"), (cx_, cy_, zt + 1.75), (cx_, cy_, zt + 1.95), .3, n=20, r1=.27)
        cyl(k_("L_room", "tool_dark"), (cx_, cy_, zt + 1.95), (cx_, cy_, zt + 2.28), .14, n=12)
    # 机柜后段（电气柜）
    box(k_("L_room", "tool_white"), *x.x(5.3, 6.2), y0 + .05, y1 - .05, zt, TOOL["z_body"] - .4)
    box(k_("L_room", "led_cyan"), *x.x(5.32, 5.9), y0 + .04, y0 + .05, zt + 2.2, zt + 2.23)


def worker(x, y):
    """穿连体无尘服的人：颗粒的主要来源之一。"""
    z = P["z_tile"]
    k = k_("L_room", "suit")
    for dx in (-.09, .09):
        cyl(k, (x + dx, y, z + .03), (x + dx * .9, y, z + .86), .085, n=10, r1=.1)
        cyl(k_("L_room", "suit_blue"), (x + dx, y - .03, z), (x + dx, y - .03, z + .14), .095, n=10, r1=.085)
    cyl(k, (x, y, z + .82), (x, y, z + 1.42), .17, n=12, r1=.19)
    for sx in (-1, 1):
        tube(k, [(x + sx * .2, y, z + 1.38), (x + sx * .27, y - .08, z + 1.08), (x + sx * .2, y - .3, z + 1.02)], .055, n=8)
    sphere(k, (x, y, z + 1.6), .135, sz=1.15)
    sphere(k_("L_room", "suit_blue"), (x, y - .05, z + 1.61), .1, sz=.7)


def build_room():
    for y0 in (0.95, 4.05):
        for s, fn in ((-1, tool_litho_like), (1, tool_cluster)):
            efem(s, y0)
            fn(s, y0)
    worker(-.3, 3.5)
    # 悬在半空、正被天车下放的 FOUP
    foup(1.02, 2.1, 8.6)


def coil_bank(root, layer, x0, x1, y0, y1, z0, z1, mat_fin="fin", pitch=.06, tubes=5, along_y=True):
    """翅片盘管：翅片是沿 y 排的薄片，铜管沿 y 穿过。"""
    k = (root, layer, mat_fin)
    y = y0
    while y < y1:
        box(k, x0, x1, y, y + .004, z0, z1, skip="b t")
        y += pitch
    for i in range(tubes):
        tx = x0 + (x1 - x0) * (i + .5) / tubes
        for tz in (z0 + (z1 - z0) * .28, z0 + (z1 - z0) * .72):
            cyl((root, layer, "copper"), (tx, y0 - .03, tz), (tx, y1 + .03, tz), .018, n=8)


def build_chase():
    for s in (-1, 1):
        x0, x1 = sorted((s * X_WALL, s * X_CHASE))
        z = P["z_dcc"]
        k = k_("L_room", "steel_dark")
        coil_bank("fab", "L_room", x0 + .04, x1 - .04, .1, D - .1, z - .24, z + .24, tubes=6)
        for bx in (x0, x1 - .04):
            box(k, bx, bx + .04, 0, D, z - .28, z + .28)
        for by in (0.0, 2.4, 4.8, 7.16):
            box(k, x0, x1, by, by + .04, z - .28, z - .24)
        # 中温冷冻水总管
        cyl(k_("L_room", "pipe_cold"), (x0 + .25, .02, z + .5), (x0 + .25, D, z + .5), .07, n=12)
        cyl(k_("L_room", "pipe_warm"), (x1 - .25, .02, z + .5), (x1 - .25, D, z + .5), .07, n=12)
    # 夹道入口格栅（下技术夹层到夹道）
    for s in (-1, 1):
        x0, x1 = sorted((s * X_WALL, s * X_CHASE))
        for i in range(8):
            gx = x0 + (x1 - x0) * (i + .5) / 8
            box(k_("L_sub", "grate"), gx - .012, gx + .012, 0, D, 4.82, 4.98)


def build_plenum():
    zb, zt = 11.55, 13.75
    for y in (1.8, 5.4):
        k = k_("L_plenum", "paint_blue")
        box(k, -X_CHASE, X_CHASE, y - .1, y + .1, zt - .1, zt + .1)
        box(k, -X_CHASE, X_CHASE, y - .08, y + .08, zb - .06, zb + .06)
        n = 12
        for i in range(n):
            x0 = -X_CHASE + 2 * X_CHASE * i / n
            x1 = -X_CHASE + 2 * X_CHASE * (i + 1) / n
            a, b = (zb, zt) if i % 2 == 0 else (zt, zb)
            cyl(k, (x0, y, a), (x1, y, b), .05, n=6, caps=False)
    # 检修走道
    for i in range(30):
        x = -8.5 + .58 * i
        box(k_("L_plenum", "grate"), x, x + .5, 3.2, 4.0, 11.68, 11.71)
    box(k_("L_plenum", "paint_grey"), -8.6, 8.6, 3.18, 3.22, 11.61, 11.68)
    box(k_("L_plenum", "paint_grey"), -8.6, 8.6, 3.98, 4.02, 11.61, 11.68)
    for y in (3.2, 4.0):
        for i in range(10):
            x = -8.4 + 1.87 * i
            cyl(k_("L_plenum", "steel"), (x, y, 11.7), (x, y, 12.75), .016, n=6, caps=False)
        cyl(k_("L_plenum", "steel"), (-8.4, y, 12.75), (8.43, y, 12.75), .02, n=6, caps=False)
    # MAU 下送风管：穿屋面进上风仓
    x0, x1 = -6.0, -5.0
    box(k_("L_plenum", "duct"), x0, x1, 3.0, 4.2, 12.6, P["z_roof0"], skip="b t")
    for dz in (0, .5, 1.0):
        box(k_("L_plenum", "steel"), x0 - .03, x1 + .03, 2.97, 4.23, 12.75 + dz, 12.8 + dz)


def build_subfab():
    zt = P["z_waffle0"]
    # 真空泵组
    for s in (-1, 1):
        for y in (2.15, 5.3):
            x = s * 3.6
            box(k_("L_sub", "pump"), x - .8, x + .8, y - .55, y + .55, 0, 1.35)
            box(k_("L_sub", "tool_dark"), x - .8, x + .8, y - .56, y - .55, .3, 1.1)
            cyl(k_("L_sub", "steel"), (x + .4, y, 1.35), (x + .4, y, 1.55), .09, n=10)
            tube(k_("L_sub", "steel"), [(x + .4, y, 1.55), (x + .4, y, 2.4), (x, y + .25, 3.2), (x, 2.4 if y < 3 else 4.8, 4.2), (x, 2.4 if y < 3 else 4.8, P["z_tile"] + .3)], .075, n=10)
    # 工艺排风总管
    y = 6.3
    tube(k_("L_sub", "duct"), [(-8, y, 4.05), (X_OUT + .6, y, 4.05)], .34, n=18)
    for s in (-1, 1):
        cyl(k_("L_sub", "duct"), (s * 3.6, 6.0, 4.05), (s * 3.6, 6.0, P["z_tile"] + .3), .12, n=12, caps=False)
    # 冷却水 / 工艺冷却水总管
    tube(k_("L_sub", "pipe_cold"), [(-8.4, 6.85, 3.1), (9.0, 6.85, 3.1)], .11, n=12)
    tube(k_("L_sub", "pipe_warm"), [(-8.4, 6.5, 3.1), (9.0, 6.5, 3.1)], .11, n=12)
    # 桥架
    for yy in (.9,):
        box(k_("L_sub", "paint_grey"), -8.2, 8.2, yy - .25, yy + .25, 3.9, 3.95)
        box(k_("L_sub", "fan_black"), -8.2, 8.2, yy - .2, yy + .2, 3.95, 4.02)
        for i in range(8):
            x = -8 + 2.3 * i
            cyl(k_("L_sub", "steel"), (x, yy - .2, 3.9), (x, yy - .2, zt), .012, n=5, caps=False)
            cyl(k_("L_sub", "steel"), (x, yy + .2, 3.9), (x, yy + .2, zt), .012, n=5, caps=False)


def build_roof():
    z = P["z_roof1"]
    # 工艺排风立管（外墙外）与洗涤塔
    rx = X_OUT + .6
    y = 6.3
    for layer, z0, z1 in (("L_sub", 4.05, P["z_waffle0"]), ("L_waffle", P["z_waffle0"], P["z_waffle1"]),
                          ("L_room", P["z_waffle1"], P["z_ffu_top"]), ("L_plenum", P["z_ffu_top"], P["z_roof0"])):
        cyl(k_(layer, "duct"), (rx, y, z0), (rx, y, z1), .34, n=18, caps=False)
    tube(k_("L_roof", "duct"), [(rx, y, P["z_roof0"]), (rx, y, z + 1.0), (9.0, y, z + 1.0), (9.0, 4.2, z + 1.0)], .34, n=18)
    cyl(k_("L_roof", "paint_grey"), (9.0, 3.6, z), (9.0, 3.6, z + 3.4), .95, n=28)
    cyl(k_("L_roof", "paint_grey"), (9.0, 3.6, z + 3.4), (9.0, 3.6, z + 3.9), .95, n=28, r1=.42)
    cyl(k_("L_roof", "duct"), (9.0, 3.6, z + 3.9), (9.0, 3.6, z + 5.1), .36, n=18)
    # MAU 外形（内部见 ROOT_mau 细节模型）
    x0, x1 = -6.2, 5.0
    y0, y1 = 2.4, 4.8
    z0, z1 = z + .55, z + 3.15
    for x in (-5.4, -2.4, .6, 3.6):
        box(k_("L_roof", "steel_dark"), x - .08, x + .08, y0, y1, z, z0)
    # 分段涂装：每段对应一个功能段
    seg = [(.11, "paint_grey"), (.14, "wall_grey"), (.12, "paint_grey"), (.16, "wall_grey"), (.08, "paint_grey"), (.11, "wall_grey"), (.2, "paint_grey"), (.08, "wall_grey")]
    x = x1
    for frac, mat in seg:
        nx = x - (x1 - x0) * frac
        box(k_("L_roof", mat), nx + .01, x - .01, y0, y1, z0, z1)
        x = nx
    box(k_("L_roof", "steel_dark"), x0 - .05, x1 + .05, y0 - .05, y1 + .05, z1, z1 + .04)
    # 进风百叶
    for i in range(9):
        zz = z0 + (z1 - z0) * (i + .5) / 9
        box(k_("L_roof", "alu"), x1, x1 + .5, y0, y1, zz - .012, zz + .012)
    box(k_("L_roof", "steel_dark"), x1, x1 + .5, y0 - .04, y0, z0, z1)
    box(k_("L_roof", "steel_dark"), x1, x1 + .5, y1, y1 + .04, z0, z1)
    box(k_("L_roof", "steel_dark"), x1, x1 + .55, y0 - .04, y1 + .04, z1, z1 + .04)
    # MAU 到屋面的接管
    box(k_("L_roof", "duct"), -6.0, -5.0, 3.0, 4.2, z - .35, z0, skip="b t")


# ---------- FFU 细节模型 ----------
EXPLODE = {}


def part(root, name, mat):
    return (root, name, mat)


def build_ffu_detail():
    R = "ffu"
    W, Dp = 1.17, .57
    # 防护网
    k = part(R, "FFU_grille", "tile")
    acc(k).add([(-W/2, -Dp/2, 0), (W/2, -Dp/2, 0), (W/2, Dp/2, 0), (-W/2, Dp/2, 0)], [(0, 1, 2, 3)], uv=[(0, 0), (6, 0), (6, 3), (0, 3)])
    acc(k).add([(-W/2, -Dp/2, -.001), (-W/2, Dp/2, -.001), (W/2, Dp/2, -.001), (W/2, -Dp/2, -.001)], [(0, 1, 2, 3)], uv=[(0, 0), (0, 3), (6, 3), (6, 0)])
    EXPLODE["FFU_grille"] = -.38
    # 滤芯框
    k = part(R, "FFU_filter", "alu")
    ft = .012
    for (a, b, c, d) in ((-W/2, W/2, -Dp/2, -Dp/2+ft), (-W/2, W/2, Dp/2-ft, Dp/2), (-W/2, -W/2+ft, -Dp/2, Dp/2), (W/2-ft, W/2, -Dp/2, Dp/2)):
        box(k, a, b, c, d, .004, .082)
    # 折叠滤纸：3 mm 节距的真实褶数
    pitch = .003
    n = int((W - 2 * ft) / pitch)
    x0 = -W/2 + ft
    y0, y1 = -Dp/2 + ft, Dp/2 - ft
    v, f = [], []
    for i in range(n * 2 + 1):
        x = x0 + i * pitch / 2
        zz = .012 if i % 2 == 0 else .074
        v += [(x, y0, zz), (x, y1, zz)]
    for i in range(n * 2):
        a = 2 * i
        f.append((a, a + 2, a + 3, a + 1))
    acc(part(R, "FFU_filter", "media")).add(v, f)
    # 热熔胶分隔线
    for j in range(14):
        y = y0 + (y1 - y0) * (j + .5) / 14
        box(part(R, "FFU_filter", "hotmelt"), x0, -x0, y - .0012, y + .0012, .0735, .0755)
        box(part(R, "FFU_filter", "hotmelt"), x0, -x0, y - .0012, y + .0012, .0105, .0125)
    EXPLODE["FFU_filter"] = -.24
    # 液槽密封
    k = part(R, "FFU_gel", "gel")
    t = .014
    for (a, b, c, d) in ((-W/2, W/2, -Dp/2, -Dp/2+t), (-W/2, W/2, Dp/2-t, Dp/2), (-W/2, -W/2+t, -Dp/2, Dp/2), (W/2-t, W/2, -Dp/2, Dp/2)):
        box(k, a, b, c, d, .086, .096)
    EXPLODE["FFU_gel"] = -.12
    # 均流板
    k = part(R, "FFU_diffuser", "tile")
    acc(k).add([(-W/2+.02, -Dp/2+.02, .135), (W/2-.02, -Dp/2+.02, .135), (W/2-.02, Dp/2-.02, .135), (-W/2+.02, Dp/2-.02, .135)], [(0, 1, 2, 3)], uv=[(0, 0), (6, 0), (6, 3), (0, 3)])
    acc(k).add([(-W/2+.02, -Dp/2+.02, .134), (-W/2+.02, Dp/2-.02, .134), (W/2-.02, Dp/2-.02, .134), (W/2-.02, -Dp/2+.02, .134)], [(0, 1, 2, 3)], uv=[(0, 0), (0, 3), (6, 3), (6, 0)])
    EXPLODE["FFU_diffuser"] = 0.0
    # 箱体
    k = part(R, "FFU_box", "ffu_body")
    wall = .004
    for (a, b, c, d) in ((-W/2, W/2, -Dp/2, -Dp/2+wall), (-W/2, W/2, Dp/2-wall, Dp/2), (-W/2, -W/2+wall, -Dp/2, Dp/2), (W/2-wall, W/2, -Dp/2, Dp/2)):
        box(k, a, b, c, d, .1, .34)
    box(part(R, "FFU_box", "steel_dark"), -W/2-.012, W/2+.012, -Dp/2-.012, Dp/2+.012, .096, .104)
    EXPLODE["FFU_box"] = .12
    # 风机：后倾叶轮 + 外转子 EC 电机
    cz = .255
    rim = .185
    k_imp = part(R, "FFU_impeller", "impeller")
    cyl(k_imp, (0, 0, cz - .05), (0, 0, cz - .044), rim, n=40)
    # 前盘（环）
    ring = []
    for i in range(40):
        a = 2 * math.pi * i / 40
        ring.append(((rim * math.cos(a), rim * math.sin(a), cz + .04), (.105 * math.cos(a), .105 * math.sin(a), cz + .07)))
    v = [p for q in ring for p in q]
    f = [(2*i, 2*((i+1) % 40), 2*((i+1) % 40)+1, 2*i+1) for i in range(40)]
    acc(k_imp).add(v, f, True)
    nb = 7
    for b in range(nb):
        a0 = 2 * math.pi * b / nb
        pts = []
        for t in range(9):
            u = t / 8
            r = .09 + (rim - .005 - .09) * u
            ang = a0 + 1.05 * u
            pts.append((r * math.cos(ang), r * math.sin(ang)))
        outline = pts + [(p[0] + .004 * math.cos(a0 + 1.05 * j / 8 + 1.57), p[1] + .004 * math.sin(a0 + 1.05 * j / 8 + 1.57)) for j, p in reversed(list(enumerate(pts)))]
        prism(k_imp, outline, cz - .044, cz + .052, smooth=False)
    EXPLODE["FFU_impeller"] = .32
    k_mot = part(R, "FFU_motor", "fan_black")
    cyl(k_mot, (0, 0, cz - .058), (0, 0, cz + .03), .082, n=24)
    cyl(part(R, "FFU_motor", "copper"), (0, 0, cz + .03), (0, 0, cz + .036), .06, n=20)
    cyl(part(R, "FFU_motor", "steel"), (0, 0, cz - .1), (0, 0, cz - .058), .012, n=10)
    for a in (.4, 2.5, 4.6):
        cyl(part(R, "FFU_motor", "steel_dark"), (0, 0, cz - .1), (.5 * math.cos(a), .25 * math.sin(a), cz - .1), .006, n=6)
    EXPLODE["FFU_motor"] = .22
    # 顶板（带进风圈）
    k_top = part(R, "FFU_top", "ffu_body")
    plate_with_hole(k_top, 0, 0, W/2, Dp/2, .125, .34, .346, n=40)
    rr = []
    for i in range(32):
        a = 2 * math.pi * i / 32
        rr.append(((.125 * math.cos(a), .125 * math.sin(a), .34), (.105 * math.cos(a), .105 * math.sin(a), .30), (.16 * math.cos(a), .16 * math.sin(a), .39)))
    v = [p for q in rr for p in q]
    f = []
    for i in range(32):
        j = (i + 1) % 32
        f.append((3*i, 3*j, 3*j+1, 3*i+1))
        f.append((3*i+2, 3*j+2, 3*j, 3*i))
    acc(part(R, "FFU_top", "steel")).add(v, f, True)
    EXPLODE["FFU_top"] = .5
    # 控制盒
    box(part(R, "FFU_ctrl", "tool_dark"), .36, .54, -.12, .12, .346, .39)
    box(part(R, "FFU_ctrl", "led_cyan"), .44, .46, -.126, -.12, .372, .38)
    EXPLODE["FFU_ctrl"] = .56


# ---------- MAU 细节模型 ----------
def mau_coil(name, x0, x1, mat="fin"):
    coil_bank("mau", name, x0, x1, .16, 2.24, .25, 2.35, mat_fin=mat, pitch=.07, tubes=4)
    box(("mau", name, "steel_dark"), x0 - .03, x1 + .03, .1, .16, .2, 2.4)
    box(("mau", name, "steel_dark"), x0 - .03, x1 + .03, 2.24, 2.3, .2, 2.4)


def build_mau_detail():
    R = "mau"
    H, Y = 2.6, 2.4
    L = 11.0
    # 底板、后壁、顶板，前壁整个切掉
    box((R, "MAU_shell", "paint_grey"), 0, L, 0, Y, -.06, 0)
    box((R, "MAU_shell", "wall_grey"), 0, L, Y, Y + .05, 0, H)
    box((R, "MAU_shell", "paint_grey"), 0, L, 0, Y + .05, H, H + .05)
    for x in range(0, 12):
        box((R, "MAU_shell", "steel_dark"), x - .02, x + .02, Y - .03, Y, 0, H)
    stages = []

    def stage(n, name_cn, x0, x1):
        stages.append(dict(id=n, name=name_cn, x0=x0, x1=x1))

    # 1 百叶
    x = .05
    name = "MAU_01"
    for i in range(10):
        z = .15 + 2.3 * i / 9
        box((R, name, "alu"), x, x + .35, .05, Y - .05, z - .012, z + .012)
    box((R, name, "fan_black"), x + .38, x + .4, .05, Y - .05, .1, 2.5)
    stage(1, "进风百叶", .05, .45)
    # 2 初效
    x = .8
    name = "MAU_02"
    for j in range(4):
        y0 = .1 + j * .56
        for i in range(2):
            z0 = .15 + i * 1.18
            box((R, name, "steel_dark"), x, x + .1, y0, y0 + .54, z0, z0 + 1.14)
            for w in range(12):
                wz = z0 + (w + .5) * 1.14 / 12
                box((R, name, "prefilter"), x + .02, x + .08, y0 + .02, y0 + .52, wz - .03, wz + .03)
    stage(2, "初效过滤 G4", .8, .9)
    # 3 中效袋式
    x = 1.25
    name = "MAU_03"
    for j in range(4):
        y0 = .1 + j * .56
        for i in range(2):
            z0 = .15 + i * 1.18
            box((R, name, "steel_dark"), x, x + .06, y0, y0 + .54, z0, z0 + 1.14)
            for b in range(4):
                bz = z0 + .04 + (b + .5) * 1.06 / 4
                prof = [(0, -.1), (.8, -.03), (.82, .03), (0, .1)]
                prism((R, name, "bag"), [(p[0], p[1]) for p in prof], y0 + .04, y0 + .5, off=(0, 0), smooth=False,
                      mat=Matrix.Translation((x + .06, 0, bz)) @ Matrix.Rotation(-math.pi / 2, 4, "X"))
    # 袋子的朝向由上面的旋转决定（y 向拉伸）
    stage(3, "中效袋式 F7", 1.25, 2.15)
    # 4 化学过滤
    x = 2.5
    name = "MAU_04"
    for bank in range(3):
        bx = x + bank * .28
        mats = ("carbon", "tool_dark", "fan_black")
        box((R, name, mats[bank]), bx, bx + .2, .1, Y - .1, .15, 2.45)
        for j in range(6):
            yy = .1 + j * 2.2 / 6
            box((R, name, "steel_dark"), bx - .005, bx + .205, yy - .008, yy + .008, .15, 2.45)
        for z in range(9):
            zz = .15 + z * 2.3 / 8
            box((R, name, "steel_dark"), bx - .005, bx + .205, .1, Y - .1, zz - .008, zz + .008)
    stage(4, "化学过滤 AMC", 2.5, 3.26)
    # 5 预热
    mau_coil("MAU_05", 3.65, 3.85, "copper")
    stage(5, "预热盘管", 3.65, 3.85)
    # 6 低温表冷（除湿）
    mau_coil("MAU_06", 4.2, 4.65)
    box((R, "MAU_06", "steel_dark"), 4.05, 4.85, .1, 2.3, .02, .1, skip="t")
    box((R, "MAU_06", "water"), 4.07, 4.83, .12, 2.28, .08, .095)
    for i in range(14):
        cx, cy = 4.28 + (i * 37 % 10) * .03, .25 + (i * 53 % 19) * .1
        sphere((R, "MAU_06", "water"), (cx, cy, .18 + (i % 3) * .02), .012, nu=6, nv=4, sz=1.4)
    stage(6, "低温表冷 · 除湿", 4.05, 4.85)
    # 7 再热
    mau_coil("MAU_07", 5.2, 5.4, "copper")
    stage(7, "再热盘管", 5.2, 5.4)
    # 8 加湿
    x = 5.85
    name = "MAU_08"
    for z in (.7, 1.3, 1.9):
        cyl((R, name, "steel"), (x, .15, z), (x, Y - .15, z), .035, n=10)
        for j in range(16):
            y = .25 + j * 1.9 / 15
            cyl((R, name, "steel_dark"), (x + .03, y, z), (x + .07, y, z), .006, n=5, caps=False)
    tube((R, name, "steel"), [(x, Y - .15, .7), (x, Y - .12, 1.9)], .03, n=8)
    stage(8, "加湿", 5.8, 6.1)
    # 9 风机段
    x = 7.05
    name = "MAU_09"
    z = 1.25
    cyl((R, "MAU_09fan", "impeller"), (x - .3, 1.2, z), (x - .26, 1.2, z), .85, n=44)
    cyl((R, "MAU_09fan", "impeller"), (x + .24, 1.2, z), (x + .3, 1.2, z), .85, n=44, r1=.85)
    for b in range(12):
        a = 2 * math.pi * b / 12
        pts = []
        for t in range(6):
            u = t / 5
            r = .42 + .4 * u
            ang = a + .8 * u
            pts.append((r * math.cos(ang), r * math.sin(ang)))
        outline = pts + [(p[0] + .012 * math.cos(a), p[1] + .012 * math.sin(a)) for p in reversed(pts)]
        prism((R, "MAU_09fan", "impeller"), outline, -.26, .24, smooth=False,
              mat=Matrix.Translation((x, 1.2, z)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
    box((R, name, "steel"), x - .75, x - .7, .1, Y - .1, .1, 2.5, skip="b t")
    cyl((R, name, "alu"), (x - .72, 1.2, z), (x - .34, 1.2, z), .62, n=36, r1=.48, caps=False)
    box((R, name, "steel_dark"), x + .55, x + 1.05, .85, 1.55, .05, .7)
    cyl((R, name, "paint_blue"), (x + .6, 1.2, z), (x + 1.0, 1.2, z), .24, n=20)
    cyl((R, name, "steel"), (x + .3, 1.2, z), (x + .6, 1.2, z), .035, n=10)
    box((R, name, "steel_dark"), x - .6, x + 1.05, .35, 2.05, .02, .05)
    stage(9, "风机", 6.3, 8.1)
    # 10 高效
    x = 8.7
    name = "MAU_10"
    for j in range(4):
        y0 = .1 + j * .56
        for i in range(2):
            z0 = .15 + i * 1.18
            box((R, name, "alu"), x, x + .3, y0, y0 + .54, z0, z0 + .03)
            box((R, name, "alu"), x, x + .3, y0, y0 + .54, z0 + 1.11, z0 + 1.14)
            n = 34
            v, f = [], []
            for w in range(n + 1):
                wz = z0 + .03 + w * 1.08 / n
                xx = x + (.02 if w % 2 else .28)
                v += [(xx, y0 + .01, wz), (xx, y0 + .53, wz)]
            for w in range(n):
                f.append((2 * w, 2 * w + 2, 2 * w + 3, 2 * w + 1))
            acc((R, name, "media")).add(v, f)
    stage(10, "高效过滤 H13", 8.7, 9.0)
    # 11 出风
    stage(11, "送往上风仓", 9.4, 11.0)
    box((R, "MAU_11", "duct"), 9.9, 10.9, .7, 1.7, -.8, -.06, skip="t b")
    box((R, "MAU_11", "steel"), 9.86, 10.94, .66, 1.74, -.1, -.06)
    return stages


# ---------- 把累加的几何变成对象 ----------
ROOT_POS = dict(fab=(0, 0, 0), ffu=(0, -16, 16), mau=(-5.5, -22, 0))


def finalize(mats):
    roots = {}
    for name, pos in ROOT_POS.items():
        e = bpy.data.objects.new("ROOT_" + name, None)
        bpy.context.scene.collection.objects.link(e)
        e.location = pos
        roots[name] = e
    objs = {}
    for (root, label, mname), a in GEO.items():
        name = f"{label}__{mname}"
        me = bpy.data.meshes.new(name)
        me.from_pydata(a.v, [], a.f)
        me.update()
        if any(a.sm):
            me.polygons.foreach_set("use_smooth", a.sm)
            me.update()
        if any(u != (0.0, 0.0) for u in a.uv):
            uvl = me.uv_layers.new(name="UVMap")
            for poly in me.polygons:
                for li in poly.loop_indices:
                    uvl.data[li].uv = a.uv[me.loops[li].vertex_index]
        me.materials.append(mats[mname])
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        o.parent = roots[root]
        o["part"] = label
        objs.setdefault(root, []).append(o)
    return roots, objs


def keyframe_explode(objs):
    """.blend 里留一段动画：1–60 帧分层炸开，61–120 帧 FFU 和 MAU 也炸开；风机一直转。"""
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, 120
    for o in objs["fab"]:
        dz = LAYERS.get(o["part"], 0)
        base = o.location.copy()
        o.keyframe_insert("location", frame=1)
        o.location = base + Vector((0, 0, dz))
        o.keyframe_insert("location", frame=60)
        o.location = base
    for o in objs["ffu"]:
        dz = EXPLODE.get(o["part"], 0)
        o["explode"] = dz
        base = o.location.copy()
        o.keyframe_insert("location", frame=1)
        o.location = base + Vector((0, 0, dz))
        o.keyframe_insert("location", frame=60)
        o.location = base


def export_glb(path):
    kw = dict(filepath=path, export_format="GLB", use_selection=False, export_apply=False, export_yup=True,
              export_extras=True, export_animations=False, export_cameras=False, export_lights=False,
              export_tangents=False, export_normals=True, export_texcoords=True, export_image_format="AUTO")
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop("export_image_format")
        bpy.ops.export_scene.gltf(**kw)


def add_lights():
    sc = bpy.context.scene
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (.03, .04, .05, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = .6
    sc.world = w
    for name, loc, rot, en, size in (
        ("key", (-6, -30, 26), (1.05, 0, -.2), 26000, 26),
        ("fill", (22, -16, 8), (1.3, 0, .9), 7000, 20),
    ):
        l = bpy.data.lights.new(name, "AREA")
        l.energy, l.size = en, size
        o = bpy.data.objects.new(name, l)
        o.location, o.rotation_euler = loc, rot
        sc.collection.objects.link(o)
    # 无尘室内部、下技术夹层、上风仓各补一盏，否则剖面里是黑的
    for name, loc, en, size in (("room", (0, 1.5, 9.8), 380, 14), ("sub", (0, 1.5, 4.5), 500, 14), ("ple", (0, 1.5, 13.4), 420, 14)):
        l = bpy.data.lights.new(name, "AREA")
        l.energy, l.size = en, size
        o = bpy.data.objects.new(name, l)
        o.location = loc
        sc.collection.objects.link(o)


SAMPLES, RES = 48, (1280, 720)


def render_view(name, loc, target, lens, out_dir, hide_roots=()):
    sc = bpy.context.scene
    cam = sc.camera
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    sc.render.resolution_x, sc.render.resolution_y = RES
    sc.render.filepath = os.path.join(out_dir, name)
    bpy.ops.render.render(write_still=True)


def render_all(out_dir, roots, objs):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 88
    sc.view_settings.view_transform = "Standard"
    add_lights()
    cd = bpy.data.cameras.new("cam")
    co = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(co)
    sc.camera = co

    def hide(names):
        for r, os_ in objs.items():
            for o in os_:
                v = r in names
                o.hide_render = v

    hide(("ffu", "mau"))
    sc.frame_set(1)
    render_view("view_section", (0, -42, 13), (0, 3, 9.2), 42, out_dir)
    sc.frame_set(60)
    render_view("view_layers", (17, -46, 22), (0, 3, 9.6), 40, out_dir)
    hide(("fab", "mau"))
    sc.frame_set(60)
    p = Vector(ROOT_POS["ffu"])
    render_view("view_ffu", tuple(p + Vector((1.7, -3.2, 1.5))), tuple(p + Vector((0, 0, .22))), 50, out_dir)
    hide(("fab", "ffu"))
    p = Vector(ROOT_POS["mau"])
    for name, loc, en in (("mau_a", (2.5, -2, 3.2), 300), ("mau_b", (8, -2, 3.2), 300)):
        l = bpy.data.lights.new(name, "AREA")
        l.energy, l.size = en, 6
        o = bpy.data.objects.new(name, l)
        o.location = tuple(p + Vector(loc))
        o.rotation_euler = (1.0, 0, 0)
        sc.collection.objects.link(o)
    render_view("view_mau", tuple(p + Vector((5.5, -15, 3.4))), tuple(p + Vector((5.5, 1.2, 1.0))), 40, out_dir)


def parse():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--samples", type=int, default=48)
    ap.add_argument("--res", default="1280x720")
    return ap.parse_known_args(argv)[0]


def main():
    global SAMPLES, RES
    args = parse()
    SAMPLES = args.samples
    RES = tuple(int(v) for v in args.res.split("x"))
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = build_materials(out_dir)
    build_structure()
    build_waffle()
    build_raised_floor()
    build_ffu_layer()
    build_room()
    build_chase()
    build_plenum()
    build_subfab()
    build_roof()
    build_ffu_detail()
    stages = build_mau_detail()
    roots, objs = finalize(mats)
    export_glb(os.path.join(out_dir, "cleanroom.glb"))
    keyframe_explode(objs)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "cleanroom.blend"), compress=True)
    spec = dict(P=P, X_WALL=X_WALL, X_CHASE=X_CHASE, X_OUT=X_OUT, TOOL=TOOL, FFU_COLS=FFU_COLS,
                FFU_ON=[bool(ffu_on(x)) for x in FFU_COLS], COVERAGE=COVERAGE,
                LAYERS=LAYERS, EXPLODE=EXPLODE, MAU_STAGES=stages, ROOT_POS=ROOT_POS)
    with open(os.path.join(out_dir, "spec.json"), "w", encoding="utf-8") as fp:
        json.dump(spec, fp, ensure_ascii=False, indent=1)
    tris = sum(sum(len(f) - 2 for f in a.f) for a in GEO.values())
    print(f"objects={sum(len(v) for v in objs.values())} tris={tris} coverage={COVERAGE:.3f}")
    if args.render:
        render_all(out_dir, roots, objs)


main()
