#!/usr/bin/env python3
"""行星锥盘无级变速器（MB / UDL 型）+ 0.75 kW 电机：纯脚本建模。

结构按 MB 型公开说明和几件公开专利的结构关系（见 README）：
  输入轴 → 主动轮 + 压盘（碟簧夹紧）→ 6 个双锥行星盘的内侧
  定环 + 调速凸轮环（不转）→ 行星盘的外侧
  行星盘的轴 → 行星架滑槽里的滑块 → 行星架 → 输出轴
  手轮 → 锥齿轮 → 蜗杆 → 凸轮环顶部的齿扇 → 凸轮环转一个小角度 → 背面斜坡把它推着轴向移动
尺寸来自 ../params.json（和网页同一份），外形、颜色都是原创示意，不对应任何真实产品。

转动的零件只出完整版（__full），网页里绕轴转；不转的壳体和环各出完整版和沿 y=0 剖开的版本（__cut）。

用法（二选一）：
  blender -b --factory-startup -P blender/build_variator.py -- --out blender/out [--render]
  pip install bpy && python blender/build_variator.py --out blender/out [--render]

坐标：X 是主轴（输出在 -X，电机在 +X），Z 向上，-Y 朝向观众；单位毫米。
"""
import argparse
import json
import math
import os
import sys

import bpy  # 必须在 bmesh 之前导入（pip 版 bpy 的要求）
import bmesh  # noqa: E402
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
PRM = json.load(open(os.path.join(HERE, "..", "params.json"), encoding="utf-8"))
G = PRM["geom"]
TAU = 2 * math.pi
SEG = 64

# ---------- 和 web/src/core.js 同样的几何 ----------
TAN_A = math.tan(math.radians(G["alpha_deg"]))
RS, RR, RHO_P, TC = G["r_sun"], G["R_ring"], G["rho_p"], G["t_center"]
DD, KK = RR - RS, RR / RS


def thick(rho):
    return TC - 2 * rho * TAN_A


def e_of_T(T):
    return RS + DD * T / (KK + T)


E_FAST, E_SLOW = e_of_T(G["T_fast"]), e_of_T(G["T_slow"])
U_REF = 0.5                                   # 建模时的参考挡位（中间挡）
E_REF = E_FAST + (E_SLOW - E_FAST) * U_REF
GIN_REF = thick(E_REF - RS)                   # 内夹缝
GOUT_REF = thick(RR - E_REF)                  # 外夹缝
NP = G["n_planet"]
PLANET_ANG = [TAU * i / NP + math.pi / 2 for i in range(NP)]   # 第一个盘在正上方（+Z）

# ---------- 材质 ----------
#            名称        基色      金属  粗糙  透明  自发光
MATS = {
    "alu":     ("#D3D8DB", 0.55, 0.42, 1.0, 0),   # 铝壳
    "alu_dk":  ("#B4BBC0", 0.55, 0.50, 1.0, 0),   # 端盖、凸台
    "motor":   ("#C2C8CC", 0.45, 0.48, 1.0, 0),   # 电机（银灰漆）
    "fan":     ("#A9B0B5", 0.35, 0.55, 1.0, 0),
    "in":      ("#D2862C", 0.75, 0.32, 1.0, 0),   # 输入件：橙
    "in_mark": ("#7A3E0A", 0.4, 0.45, 1.0, 0),
    "spring":  ("#3A4247", 0.8, 0.40, 1.0, 0),   # 碟簧
    "planet":  ("#D4DADE", 0.95, 0.18, 1.0, 0),  # 行星盘：亮钢
    "p_mark":  ("#E2483A", 0.2, 0.40, 1.0, 0),   # 行星盘上的色块（看自转）
    "out":     ("#2F78C4", 0.55, 0.35, 1.0, 0),   # 输出件：蓝
    "out_mark": ("#0F355E", 0.4, 0.45, 1.0, 0),
    "slider":  ("#B98A3E", 0.8, 0.35, 1.0, 0),   # 滑块（铜）
    "ring":    ("#56616A", 0.85, 0.30, 1.0, 0),  # 不转的环：深灰
    "adj":     ("#7E62B8", 0.45, 0.40, 1.0, 0),  # 调速机构：紫
    "knob":    ("#1F2427", 0.1, 0.45, 1.0, 0),   # 手轮
    "red":     ("#C8322B", 0.1, 0.40, 1.0, 0),
    "dial":    ("#F2F2EA", 0.0, 0.50, 1.0, 0),
    "dark":    ("#2B3136", 0.3, 0.50, 1.0, 0),
    "glass":   ("#9FD3E6", 0.0, 0.08, 0.45, 0),
    "steel":   ("#8E979D", 0.9, 0.30, 1.0, 0),
    "key":     ("#E8C24A", 0.7, 0.30, 1.0, 0),
}
NO_CUT_MAT = {"glass"}
M = {}


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c]


def make_mat(name, col, metal, rough, alpha, emit):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    c = srgb(col) if isinstance(col, str) else col
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
    return m


def build_materials():
    for name, (col, metal, rough, alpha, emit) in MATS.items():
        M[name] = make_mat(name, col, metal, rough, alpha, emit)
        if name not in NO_CUT_MAT:
            c = [v * 0.6 for v in srgb(col)]
            M[name + "_cut"] = make_mat(name + "_cut", c, metal * 0.4, min(1, rough + 0.25), 1.0, 0)


# ---------- 几何工具 ----------
def rev_bm(prof, seg=SEG, bm=None):
    """(r, z) 闭合轮廓绕 Z 轴转一圈；r=0 的点收成极点，网格封闭（布尔运算要求）。"""
    bm = bm or bmesh.new()
    angs = [TAU * i / seg for i in range(seg)]
    V = []
    for r, z in prof:
        if r < 1e-9:
            V.append([bm.verts.new((0, 0, z))] * seg)
        else:
            V.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for a in angs])
    n = len(prof)
    for j in range(n):
        k = (j + 1) % n
        if prof[j][0] < 1e-9 and prof[k][0] < 1e-9:
            continue
        A, B = V[j], V[k]
        for i in range(seg):
            i2 = (i + 1) % seg
            q = []
            for v in (A[i], B[i], B[i2], A[i2]):
                if v not in q:
                    q.append(v)
            if len(q) >= 3:
                bm.faces.new(q)
    return bm


def xform(bm, mat):
    bmesh.ops.transform(bm, matrix=mat, verts=bm.verts[:])
    return bm


ROT_ZX = Matrix.Rotation(math.pi / 2, 4, "Y")       # 把 Z 轴转到 X 轴：(x,y,z) → (z, y, -x)


def rev_x(prof, seg=SEG, y=0.0, z=0.0):
    """(r, x) 轮廓绕 X 轴的回转体，轴线过 (y, z)。"""
    return xform(rev_bm(prof, seg), Matrix.Translation((0, y, z)) @ ROT_ZX)


def ring_x(r0, r1, x0, x1, seg=SEG):
    return rev_x([(r0, x0), (r1, x0), (r1, x1), (r0, x1)], seg)


def cyl_x(r, x0, x1, seg=SEG, y=0.0, z=0.0):
    return rev_x([(0, x0), (r, x0), (r, x1), (0, x1)], seg, y, z)


def cyl_z(r, z0, z1, x=0.0, y=0.0, seg=SEG):
    return xform(rev_bm([(0, z0), (r, z0), (r, z1), (0, z1)], seg), Matrix.Translation((x, y, 0)))


def orient(bm, p0, p1):
    d = Vector(p1) - Vector(p0)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return xform(bm, Matrix.Translation(p0) @ q.to_matrix().to_4x4())


def cyl_between(r, p0, p1, seg=32):
    L = (Vector(p1) - Vector(p0)).length
    return orient(rev_bm([(0, 0), (r, 0), (r, L), (0, L)], seg), p0, p1)


def prism_bm(poly, z0, z1, bm=None):
    bm = bm or bmesh.new()
    bot = [bm.verts.new((x, y, z0)) for x, y in poly]
    top = [bm.verts.new((x, y, z1)) for x, y in poly]
    bm.faces.new(bot[::-1])
    bm.faces.new(top)
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    return bm


def box(x0, x1, y0, y1, z0, z1):
    return prism_bm([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1)


def rrect(w, d, r, seg=6, cx=0.0, cy=0.0):
    pts = []
    for sx, sy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oy = cx + sx * (w / 2 - r), cy + sy * (d / 2 - r)
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


def ngon(n, r, rot=0.0):
    return [(r * math.cos(rot + TAU * i / n), r * math.sin(rot + TAU * i / n)) for i in range(n)]


def star(n, r0, r1, sub=3):
    """星形手轮轮廓：n 个圆鼓鼓的瓣。"""
    pts = []
    N = n * 8
    for i in range(N):
        a = TAU * i / N
        w = 0.5 + 0.5 * math.cos(n * a)
        r = r0 + (r1 - r0) * (w ** 0.6)
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def tube_bm(pts, r, n=12, bm=None, closed=False):
    """沿折线扫圆管；用平行移动框架避免扭转。"""
    bm = bm or bmesh.new()
    P = [Vector(p) for p in pts]
    T = []
    for i in range(len(P)):
        if i == 0:
            t = P[1] - P[0]
        elif i == len(P) - 1:
            t = P[-1] - P[-2]
        else:
            t = (P[i + 1] - P[i]).normalized() + (P[i] - P[i - 1]).normalized()
        T.append(t.normalized())
    up = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    Nn = T[0].cross(up).normalized()
    rings = []
    for i, p in enumerate(P):
        if i:
            Nn = (Nn - T[i] * Nn.dot(T[i])).normalized()
        B = T[i].cross(Nn)
        rings.append([bm.verts.new(p + r * (math.cos(TAU * k / n) * Nn + math.sin(TAU * k / n) * B)) for k in range(n)])
    for i in range(len(rings) - 1):
        A, Bv = rings[i], rings[i + 1]
        for k in range(n):
            bm.faces.new((A[k], A[(k + 1) % n], Bv[(k + 1) % n], Bv[k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    return bm


def merge(dst, src):
    """把 bmesh src 并进 dst（src 用完释放）。"""
    tmp = bpy.data.meshes.new("_t")
    src.to_mesh(tmp)
    src.free()
    dst.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)
    return dst


def mark_sector(bm, a0, a1, axis="x", idx=1, rmin=0.0):
    """把绕轴角度落在 [a0, a1) 的面换成第二个材质（转动时看得见在转）。"""
    for f in bm.faces:
        c = f.calc_center_median()
        if axis == "x":
            a, r = math.atan2(c.z, c.y), math.hypot(c.y, c.z)
        else:
            a, r = math.atan2(c.y, c.x), math.hypot(c.x, c.y)
        a %= TAU
        if a0 <= a < a1 and r >= rmin:
            f.material_index = idx
    return bm


def to_obj(name, bm, mat, mat2=None):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M[mat])
    if mat2:
        me.materials.append(M[mat2])
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def remove(o):
    me = o.data
    bpy.data.objects.remove(o, do_unlink=True)
    if me and me.users == 0:
        bpy.data.meshes.remove(me)


def bool_apply(o, cutter_obj, op):
    m = o.modifiers.new("b", "BOOLEAN")
    m.object = cutter_obj
    m.operation = op
    m.solver = "EXACT"
    try:
        m.material_mode = "TRANSFER"
    except (AttributeError, TypeError):
        pass
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=m.name)


def csg(name, base, mat, adds=(), subs=(), mat2=None):
    o = to_obj(name, base, mat, mat2)
    for bm in adds:
        c = to_obj("_c", bm, mat)
        bool_apply(o, c, "UNION")
        remove(c)
    for bm in subs:
        c = to_obj("_c", bm, mat)
        bool_apply(o, c, "DIFFERENCE")
        remove(c)
    return o


_CUTTERS = {}


def bbox(o):
    vs = [v.co for v in o.data.vertices]
    return [min(v[i] for v in vs) for i in range(3)], [max(v[i] for v in vs) for i in range(3)]


def cutter(mat):
    """y<0 半空间的切块；它的材质就是剖切面的材质。"""
    cm = mat if mat in NO_CUT_MAT else mat + "_cut"
    if cm not in _CUTTERS:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        xform(bm, Matrix.Translation((0, -0.5, 0)))
        xform(bm, Matrix.Scale(3000, 4))
        _CUTTERS[cm] = to_obj("_cut_" + cm, bm, cm)
        _CUTTERS[cm].hide_render = True
    return _CUTTERS[cm]


def safe_cut(c, o, mat):
    """沿 y=0 剖开；EXACT 偶尔在共面处出错，检测到就微移切块重试。"""
    keep = c.data.copy()
    (a0, a1) = bbox(o)
    for dy, solver in ((0.0, "EXACT"), (-0.013, "EXACT"), (0.011, "EXACT"), (0.0, "MANIFOLD"), (0.0, "FLOAT")):
        cu = cutter(mat)
        cu.location.y = dy
        m = c.modifiers.new("b", "BOOLEAN")
        try:
            m.object, m.operation, m.solver = cu, "DIFFERENCE", solver
        except TypeError:
            c.modifiers.remove(m)
            continue
        try:
            m.material_mode = "TRANSFER"
        except (AttributeError, TypeError):
            pass
        bpy.context.view_layer.objects.active = c
        bpy.ops.object.modifier_apply(modifier=m.name)
        cu.location.y = 0
        if not c.data.vertices:
            return
        b0, b1 = bbox(c)
        if all(b0[i] >= a0[i] - 0.05 and b1[i] <= a1[i] + 0.05 for i in range(3)):
            return
        print("cut retry", c.name, solver, dy)
        old = c.data
        c.data = keep.copy()
        bpy.data.meshes.remove(old)
    raise RuntimeError("cut failed: " + c.name)


ROOT = None
PARTS = []
SPEC = dict(pins=[], explode={}, anim={})


def part(key, src, mat, anim=None, cut=False, full=True, origin=None, explode=None, mat2=None, group=None):
    """登记一个零件。anim 描述网页里怎么动（见 SPEC['anim'] 的说明）；cut=True 时额外出剖切版。"""
    o = src if isinstance(src, bpy.types.Object) else to_obj("_tmp", src, mat, mat2)
    if origin is not None:
        o.data.transform(Matrix.Translation(-Vector(origin)))
        o.location = origin
    made = []
    if cut:
        c = o.copy()
        c.data = o.data.copy()
        bpy.context.scene.collection.objects.link(c)
        safe_cut(c, o, mat)
        if len(c.data.polygons) == 0:
            remove(c)
        else:
            c.name = c.data.name = f"{key}__cut"
            made.append((c, "cut"))
    if full:
        o.name = o.data.name = f"{key}__full"
        made.append((o, "full"))
    else:
        remove(o)
    for ob, var in made:
        ob.parent = ROOT
        ob["part"] = key
        ob["variant"] = var
        if group:
            ob["group"] = group
        PARTS.append(ob)
    if anim:
        SPEC["anim"][key] = anim
    SPEC["explode"][key] = explode_for(key, (anim or {}).get("ang"))
    return made


# 拆开图：沿主轴一字排开，壳体往上抬，行星盘沿半径往外推
EXPLODE_X = dict(out_shaft=-250, brg_out=-215, cover=-185, cam_seat=-150, car_n=-118, ring_cam=-84, cam_teeth=-84,
                 press=-44, tie=-12, sun=46, spring=80, seat=104, car_p=24, ring_fixed=132, adapter=168, in_shaft=210,
                 motor=270, fan_cover=270, tbox_lid=270)


def explode_for(key, ang=None):
    base = key.rstrip("0123456789pn") if key.startswith(("planet", "slider", "tie")) else key
    if key.startswith("planet"):
        return [0, 52 * math.cos(ang), 52 * math.sin(ang)]
    if key.startswith("slider"):
        dx = EXPLODE_X["car_p"] if key.endswith("p") else EXPLODE_X["car_n"]
        return [dx, 52 * math.cos(ang), 52 * math.sin(ang)]
    if base in EXPLODE_X:
        return [EXPLODE_X[base], 0, 0]
    if key in ("housing", "oil_glass"):
        return [0, 0, 175]
    if key in ("topbox", "dial", "needle"):
        return [0, 0, 235]
    if key == "worm":
        return [-84, 0, 70]
    if key in ("hw_shaft", "knob", "knob_cap"):
        return [-84, 0, 150]
    if key == "feet":
        return [0, 0, -70]
    return [0, 0, 0]


def pin(key, at):
    SPEC["pins"].append(dict(key=key, at=[round(v, 2) for v in at]))


# ======================================================================
# 零件
# ======================================================================
XS_SEAT = 26.0          # 碟簧座（输入轴上的锁紧环）
X_CAR_P, X_CAR_N = (12.0, 17.0), (-22.0, -17.0)   # 两块行星架板的轴向范围


def sun_profile():
    """主动轮（局部坐标：刃口在 x=0，盘身往 +x）。刃口是一个半径 40 的窄圆。"""
    return [(9.6, 16.0), (9.6, 3.2), (30.0, 2.3), (38.6, 0.5), (39.6, 0.07), (40.0, 0.0), (40.25, 0.35), (40.25, 4.6),
            (37.0, 7.5), (14.0, 7.5), (14.0, 16.0)]


def build_input():
    gi = GIN_REF / 2
    # 主动轮（+x 侧，跟输入轴用键连接）
    bm = rev_x([(r, gi + x) for r, x in sun_profile()], 96)
    mark_sector(bm, 0.0, 0.45, rmin=20)
    part("sun", bm, "in", mat2="in_mark", anim=dict(type="spin_in", slide=+1), group="input",
         explode=[70, 0, 0])
    # 压盘（-x 侧，花键套在输入轴上，和主动轮对称）
    prof = [(9.6, -12.0), (9.6, -(gi + 3.2)), (30.0, -(gi + 2.3)), (38.6, -(gi + 0.5)), (39.6, -(gi + 0.07)), (40.0, -gi),
            (40.25, -(gi + 0.35)), (40.25, -(gi + 4.6)), (37.0, -(gi + 7.5)), (14.0, -(gi + 7.5)), (14.0, -12.0)]
    bm = rev_x(prof[::-1], 96)
    mark_sector(bm, 0.0, 0.45, rmin=20)
    part("press", bm, "in", mat2="in_mark", anim=dict(type="spin_in", slide=-1), group="input", explode=[-40, 0, 0])
    # 输入轴：从电机里伸出来，-x 端细颈插在行星架中心的导向轴承里
    bm = rev_x([(0, -24.0), (6.0, -24.0), (6.0, -16.5), (9.5, -16.5), (9.5, 60.0), (0, 60.0)], 48)
    mark_sector(bm, 0.0, 0.5, rmin=9)
    part("in_shaft", bm, "in", mat2="in_mark", anim=dict(type="spin_in"), group="input", explode=[150, 0, 0])
    # 碟簧座（锁紧环）
    bm = ring_x(9.5, 34.0, XS_SEAT, XS_SEAT + 4.0, 64)
    part("seat", bm, "in", anim=dict(type="spin_in"), group="input", explode=[150, 0, 0])
    # 碟簧：6 片对合，固定端在碟簧座，另一端顶住主动轮背面
    x_back = gi + 7.5
    L = XS_SEAT - x_back
    bm = bmesh.new()
    n = 6
    pitch = L / n
    for k in range(n):
        x0 = x_back + k * pitch
        h = pitch * 0.62
        th = 0.9
        if k % 2 == 0:
            prof = [(15.0, x0 + pitch * 0.12), (32.0, x0 + pitch * 0.12 + h), (32.0, x0 + pitch * 0.12 + h - th), (15.0, x0 + pitch * 0.12 - th)]
        else:
            prof = [(15.0, x0 + pitch * 0.12 + h - th), (32.0, x0 + pitch * 0.12 - th), (32.0, x0 + pitch * 0.12), (15.0, x0 + pitch * 0.12 + h)]
        merge(bm, rev_x(prof, 64))
    part("spring", bm, "spring", anim=dict(type="spring", fixed=XS_SEAT, L0=L), origin=(XS_SEAT, 0, 0), group="input",
         explode=[110, 0, 0])
    SPEC["spring"] = dict(seat=XS_SEAT, back_local=7.5)
    pin("sun", (gi + 6, 0, 30))
    pin("press", (-gi - 6, 0, 30))
    pin("spring", (XS_SEAT - 6, 0, 26))
    pin("in_shaft", (40, 0, 9.5))


def planet_profile():
    """行星盘（局部：盘心在原点，轴沿 x）。两面是锥面：中间厚、边上薄；带一根贯通的心轴。"""
    h = lambda rho: thick(rho) / 2
    sh = G["planet_shaft_r"]
    return [(0, X_CAR_N[0] + 0.5), (sh, X_CAR_N[0] + 0.5), (sh, -h(sh)), (RHO_P - 0.6, -h(RHO_P - 0.6)),
            (RHO_P + 0.15, -0.45), (RHO_P + 0.35, 0.0), (RHO_P + 0.15, 0.45), (RHO_P - 0.6, h(RHO_P - 0.6)),
            (sh, h(sh)), (sh, X_CAR_P[1] - 0.5), (0, X_CAR_P[1] - 0.5)]


def build_planets():
    for i, a in enumerate(PLANET_ANG):
        c = Vector((0, E_REF * math.cos(a), E_REF * math.sin(a)))
        bm = rev_x(planet_profile(), 72)
        mark_sector(bm, 0.0, 0.6, rmin=6)
        xform(bm, Matrix.Translation(c))
        part(f"planet{i}", bm, "planet", mat2="p_mark", origin=c,
             anim=dict(type="planet", idx=i, ang=a), group="planet",
             explode=[0, 55 * math.cos(a), 55 * math.sin(a)])
        # 滑块：两块行星架板各一块，带着心轴在径向槽里滑
        for side, (x0, x1) in (("p", X_CAR_P), ("n", X_CAR_N)):
            bm = box(x0 - 0.6, x1 + 0.6, -4.2, 4.2, -5.5, 5.5)
            xform(bm, Matrix.Rotation(a - math.pi / 2, 4, "X"))
            xform(bm, Matrix.Translation(c))
            part(f"slider{i}{side}", bm, "slider", origin=c, anim=dict(type="slider", idx=i, ang=a), group="carrier",
                 explode=[30 if side == "p" else -60, 55 * math.cos(a), 55 * math.sin(a)])
    pin("planet", (0, E_REF * math.cos(PLANET_ANG[0]) * 0, E_REF + 12))


def slot_cuts(x0, x1):
    out = []
    for a in PLANET_ANG:
        bm = box(x0 - 1, x1 + 1, -4.3, 4.3, E_FAST - 6.5, E_SLOW + 6.5)
        xform(bm, Matrix.Rotation(a - math.pi / 2, 4, "X"))
        out.append(bm)
    return out


def build_carrier():
    # +x 板：环形，内径让开主动轮和碟簧
    o = csg("_car", ring_x(42.0, 66.0, *X_CAR_P, 96), "out", subs=slot_cuts(*X_CAR_P), mat2="out_mark")
    part("car_p", o, "out", anim=dict(type="spin_out"), group="carrier", explode=[30, 0, 0])
    # -x 板：整盘 + 轮毂，中心有导向轴承孔
    base = rev_x([(6.2, X_CAR_N[0]), (66.0, X_CAR_N[0]), (66.0, X_CAR_N[1]), (6.2, X_CAR_N[1])], 96)
    o = csg("_car", base, "out", adds=[ring_x(6.2, 18.0, -40.0, X_CAR_N[0] + 0.5, 64)], subs=slot_cuts(*X_CAR_N),
            mat2="out_mark")
    part("car_n", o, "out", anim=dict(type="spin_out"), group="carrier", explode=[-60, 0, 0])
    # 拉杆：在两个行星盘之间穿过，连起两块板
    for i, a in enumerate(PLANET_ANG):
        b = a + math.pi / NP
        y, z = 50.5 * math.cos(b), 50.5 * math.sin(b)
        bm = cyl_x(3.4, X_CAR_N[1] - 0.5, X_CAR_P[0] + 0.5, 24, y, z)
        part(f"tie{i}", bm, "out", anim=dict(type="spin_out"), group="carrier", explode=[-15, 0, 0])
    # 输出轴 Ø19 + 键
    bm = rev_x([(0, -98.0), (9.5, -98.0), (9.5, -40.0), (12.0, -40.0), (12.0, -36.0), (0, -36.0)], 48)
    o = csg("_os", bm, "out", adds=[box(-94, -62, -3.0, 3.0, 6.0, 11.0)])
    part("out_shaft", o, "out", anim=dict(type="spin_out"), group="carrier", explode=[-150, 0, 0])
    pin("carrier", (X_CAR_N[0] - 2, 0, 64))
    pin("out_shaft", (-80, 0, 9.5))
    pin("slider", (X_CAR_P[1], 0, E_REF + 5))


def ring_profile():
    """外环（局部：刃口在 x=0，环身往 +x）。刃口半径 60；里圈薄、外圈厚，让开行星架板。"""
    return [(59.4, 5.0), (59.4, 1.5), (59.7, 0.35), (60.0, 0.0), (60.5, 0.15), (66.0, 2.05), (78.0, 6.2),
            (82.5, 6.2), (82.5, 12.0), (68.0, 12.0), (66.5, 5.0)]


def build_rings():
    go = GOUT_REF / 2
    # 定环：+x 侧，不转
    bm = rev_x([(r, go + x) for r, x in ring_profile()][::-1], 128)
    part("ring_fixed", bm, "ring", cut=True, anim=dict(type="ring", slide=+1), group="ring", explode=[45, 0, 0])
    # 调速凸轮环：-x 侧，不转（只转一个小角度），轴向移动
    bm = rev_x([(r, -(go + x)) for r, x in ring_profile()], 128)
    part("ring_cam", bm, "ring", cut=True, anim=dict(type="ring", slide=-1), group="ring", explode=[-95, 0, 0])
    # 凸轮环背面的三段斜坡 + 顶部齿扇（一起转一个小角度）
    xb = -(go + 12.0)
    bm = bmesh.new()
    for k in range(3):
        a0 = TAU * k / 3 + math.radians(20)
        for j in range(10):
            t0, t1 = j / 10, (j + 1) / 10
            aa, ab = a0 + math.radians(70) * t0, a0 + math.radians(70) * t1
            h0, h1 = 1.0 + 3.0 * t0, 1.0 + 3.0 * t1
            wedge = prism_bm([(70.0 * math.cos(aa), 70.0 * math.sin(aa)), (81.0 * math.cos(aa), 81.0 * math.sin(aa)),
                              (81.0 * math.cos(ab), 81.0 * math.sin(ab)), (70.0 * math.cos(ab), 70.0 * math.sin(ab))],
                             0, (h0 + h1) / 2)
            # prism 在 xy 平面、厚度沿 z：转到“绕 X 轴的角度 + 沿 -x 的高度”
            xform(wedge, Matrix(((0, 0, -1, xb), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
            merge(bm, wedge)
    # 齿扇：顶部 ±32°，齿沿 x 方向
    nt = 22
    for k in range(nt):
        a = math.pi / 2 + math.radians(-32 + 64 * k / (nt - 1))
        t = prism_bm([(-1.0, 0), (1.0, 0), (0.6, 3.0), (-0.6, 3.0)], 0, 1)
        # 局部：x 方向是切向，y 方向是径向，z 是轴向厚度
        xform(t, Matrix.Scale(9.0, 4, (0, 0, 1)))
        xform(t, Matrix.Translation((0, 82.5, -4.5)))
        xform(t, Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))))   # (tx, r, ax) → (ax, tx, r)
        xform(t, Matrix.Rotation(a - math.pi / 2, 4, "X"))
        xform(t, Matrix.Translation((-(go + 6.5), 0, 0)))
        merge(bm, t)
    # 齿扇的底座（一段弧板）
    arc = []
    for k in range(17):
        a = math.pi / 2 + math.radians(-34 + 68 * k / 16)
        arc.append((80.5 * math.cos(a), 80.5 * math.sin(a)))
    for k in range(16, -1, -1):
        a = math.pi / 2 + math.radians(-34 + 68 * k / 16)
        arc.append((82.6 * math.cos(a), 82.6 * math.sin(a)))
    base = prism_bm(arc, 0, 9.0)
    xform(base, Matrix(((0, 0, 1, -(go + 11.0)), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    merge(bm, base)
    part("cam_teeth", bm, "adj", anim=dict(type="cam", slide=-1), group="adjust", explode=[-95, 0, 0])
    # 壳体上的斜坡座（不转）：和凸轮环的斜坡对顶
    bm = ring_x(70.0, 85.0, -27.0, -21.5, 128)
    part("cam_seat", bm, "ring", cut=True, group="shell", explode=[-120, 0, 0])
    pin("ring_fixed", (go + 8, 0, -72))
    pin("ring_cam", (-(go + 8), 0, -72))
    pin("cam_teeth", (-(go + 6), 0, 88))


def build_adjust():
    """手轮 → 锥齿轮 → 蜗杆（轴沿 Y）→ 凸轮环顶部齿扇。"""
    go = GOUT_REF / 2
    xw = -(go + 6.5)            # 蜗杆在齿扇正上方
    zw = 82.5 + 3.0 + 4.2       # 蜗杆轴心高度
    rw = 4.2
    # 蜗杆：芯轴 + 螺旋齿
    bm = cyl_between(2.4, (xw, -20, zw), (xw, 22, zw), 24)
    pts = []
    turns = 5
    for k in range(turns * 24 + 1):
        t = k / 24
        a = TAU * t
        pts.append((xw + rw * math.cos(a), -14 + 28 * t / turns, zw + rw * math.sin(a)))
    tube_bm(pts, 1.2, 8, bm)
    merge(bm, cyl_between(rw - 0.6, (xw, -15, zw), (xw, 15, zw), 24))
    # 蜗杆轴上的锥齿轮（y=+19）
    merge(bm, orient(rev_bm([(0, 0), (8.0, 0), (5.0, 4.0), (0, 4.0)], 24), (xw, 17.0, zw), (xw, 22.0, zw)))
    part("worm", bm, "adj", origin=(xw, 0, zw), anim=dict(type="worm", axis="y"), group="adjust", explode=[-95, 0, 40])
    # 手轮轴（竖直）+ 下端锥齿轮
    xh, yh = xw, 26.0
    bm = cyl_z(3.2, zw + 2.0, 150.0, xh, yh, 24)
    cone = rev_bm([(0, 0), (8.0, 0), (5.0, 4.0), (0, 4.0)], 24)
    xform(cone, Matrix.Translation((xh, yh, zw + 9.0)) @ Matrix.Rotation(math.pi, 4, "X"))
    merge(bm, cone)
    part("hw_shaft", bm, "adj", origin=(xh, yh, 0), anim=dict(type="handwheel"), group="adjust", explode=[-95, 0, 80])
    # 手轮：星形黑色旋钮 + 红色盖
    knob = prism_bm(star(5, 17.0, 30.0), 132.0, 142.0)
    o = csg("_knob", knob, "knob", adds=[cyl_z(12.0, 128.0, 146.0, 0, 0, 48)], subs=[cyl_z(3.3, 120, 150, 0, 0, 16)])
    o.data.transform(Matrix.Translation((xh, yh, 0)))
    part("knob", o, "knob", origin=(xh, yh, 0), anim=dict(type="handwheel"), group="adjust", explode=[-95, 0, 80])
    bm = cyl_z(8.0, 146.0, 148.0, xh, yh, 48)
    mark_sector(bm, 0.0, 0.8, axis="z", rmin=2)
    part("knob_cap", bm, "red", mat2="dial", origin=(xh, yh, 0), anim=dict(type="handwheel"), group="adjust",
         explode=[-95, 0, 80])
    SPEC["adjust"] = dict(worm=[xw, 0, zw], handwheel=[xh, yh])
    pin("worm", (xw, -10, zw + 6))
    pin("knob", (xh, yh, 146))


def build_shell():
    """铝壳（带散热筋）、输出端盖、顶部调速箱、底脚、油标。都不转，出剖切版。"""
    x0, x1 = -27.0, 36.0
    # 壳体主筒
    base = rev_x([(86.0, x0), (93.0, x0), (93.0, x1), (86.0, x1)], 128)
    adds = []
    for k in range(18):
        a = TAU * k / 18 + TAU / 36
        if abs(math.sin(a) - 1) < 0.15:
            continue                  # 顶上让给调速箱
        fin = box(x0 + 4, x1 - 4, -1.3, 1.3, 92.0, 99.0)
        xform(fin, Matrix.Rotation(a - math.pi / 2, 4, "X"))
        adds.append(fin)
    # 定环的座（+x 内侧台阶）
    adds.append(ring_x(82.4, 86.5, 15.5, x1, 128))
    subs = [box(-26, 4, -22, 26, 80, 100)]            # 顶部开窗：齿扇伸进调速箱
    o = csg("_hous", base, "alu", adds=adds, subs=subs)
    part("housing", o, "alu", cut=True, group="shell", explode=[0, 0, 0])
    # -x 端盖：法兰 + 轴承凸台 + 4 个螺栓孔
    cov = rev_x([(19.0, x0 - 9.0), (93.0, x0 - 9.0), (93.0, x0), (19.0, x0)], 128)
    adds = [rev_x([(19.0, -52.0), (31.0, -52.0), (34.0, x0 - 9.0), (19.0, x0 - 9.0)], 96)]
    for k in range(6):
        a = TAU * k / 6
        rib = box(-52.0, x0 - 9.0, -2.2, 2.2, 31.0, 80.0)
        xform(rib, Matrix.Rotation(a, 4, "X"))
        # 筋：高度沿径向逐渐降低（用楔形近似：截掉外上角）
        adds.append(rib)
    subs = []
    for k in range(4):
        a = TAU * k / 4 + TAU / 8
        subs.append(cyl_x(4.5, -60, x0 + 1, 24, 80 * math.cos(a), 80 * math.sin(a)))
    o = csg("_cov", cov, "alu_dk", adds=adds, subs=subs)
    # 把筋的外端削成斜的
    slope = rev_x([(34.0, -53.0), (120.0, -53.0), (120.0, x0 - 9.0 - 0.01), (90.0, x0 - 9.0 - 0.01)], 96)
    co = to_obj("_c", slope, "alu_dk")
    bool_apply(o, co, "DIFFERENCE")
    remove(co)
    part("cover", o, "alu_dk", cut=True, group="shell", explode=[-130, 0, 0])
    # 输出端的轴承（示意）
    bm = ring_x(9.6, 19.0, -50.0, -42.0, 48)
    part("brg_out", bm, "steel", cut=True, group="shell", explode=[-160, 0, 0])
    # +x 端：电机法兰过渡盘
    bm = rev_x([(20.0, x1), (93.0, x1), (93.0, x1 + 6.0), (20.0, x1 + 6.0)], 128)
    part("adapter", bm, "alu_dk", cut=True, group="shell", explode=[60, 0, 0])
    # 顶部调速箱（盖住蜗杆、锥齿轮）
    go = GOUT_REF / 2
    xw = -(go + 6.5)
    tb = prism_bm(rrect(40, 64, 6, cx=xw, cy=6), 84.0, 120.0)
    o = csg("_tb", tb, "alu", subs=[prism_bm(rrect(32, 56, 4, cx=xw, cy=6), 80.0, 116.0), cyl_z(3.4, 110, 130, xw, 26.0, 24)])
    part("topbox", o, "alu", cut=True, group="shell", explode=[0, 0, 90])
    # 指示盘：顶箱 -y 面，刻度 0~1 对应 1000~200 r/min
    dial = cyl_between(13.0, (xw, -26.2, 103.0), (xw, -27.4, 103.0), 48)
    part("dial", dial, "dial", group="front", explode=[0, 0, 90])
    needle = box(-0.8, 0.8, -28.2, -27.4, 0, 10.5)
    xform(needle, Matrix.Translation((xw, 0, 103.0)))
    part("needle", needle, "red", origin=(xw, 0, 103.0), anim=dict(type="needle"), group="front", explode=[0, 0, 90])
    SPEC["dial"] = dict(center=[xw, -27.4, 103.0], r=13.0)
    # 底脚
    feet = prism_bm(rrect(54, 150, 4, cx=4.5), -106.0, -96.0)
    o = csg("_ft", feet, "alu_dk", adds=[box(-18, 27, -40, 40, -98, -84)],
            subs=[cyl_z(5.0, -120, -80, x, y, 16) for x in (-14, 23) for y in (-62, 62)])
    part("feet", o, "alu_dk", cut=True, group="shell", explode=[0, 0, -40])
    # 油标（-y 面）
    bm = cyl_between(7.0, (8.0, -92.0, 0.0), (8.0, -98.5, 0.0), 32)
    part("oil_glass", bm, "red", group="front", explode=[0, -30, 0])
    pin("housing", (0, 0, -93))
    pin("topbox", (xw, 0, 120))
    pin("dial", (xw, -27.4, 116))


def build_motor():
    """0.75 kW 4 极电机外壳（不剖）：机座带散热筋、风罩、接线盒。"""
    x0, x1 = 42.0, 225.0
    body = rev_x([(20.0, x0), (93.0, x0), (93.0, x0 + 8.0), (76.0, x0 + 12.0), (76.0, x1), (20.0, x1)], 96)
    adds = []
    for k in range(20):
        a = TAU * k / 20
        if abs(math.sin(a) - 1) < 0.25:
            continue
        fin = box(x0 + 16, x1 - 4, -1.2, 1.2, 74.0, 84.0)
        xform(fin, Matrix.Rotation(a - math.pi / 2, 4, "X"))
        adds.append(fin)
    adds.append(box(80, 160, -38, 38, 70, 106))        # 接线盒
    o = csg("_mot", body, "motor", adds=adds)
    part("motor", o, "motor", group="motor", explode=[170, 0, 0])
    bm = rev_x([(0, x1), (79.0, x1), (79.0, x1 + 46.0), (70.0, x1 + 56.0), (0, x1 + 56.0)], 96)
    o = csg("_fan", bm, "fan", subs=[ring_x(r, r + 3.2, x1 + 50, x1 + 60, 64) for r in (14, 26, 38, 50)])
    part("fan_cover", o, "fan", group="motor", explode=[170, 0, 0])
    bm = box(120, 158, -30, 30, 106, 110)
    part("tbox_lid", bm, "motor", group="motor", explode=[170, 0, 0])
    pin("motor", (150, 0, 84))


def export_glb(path):
    kw = dict(filepath=path, export_format="GLB", use_selection=False, export_apply=False, export_yup=True,
              export_extras=True, export_animations=False, export_cameras=False, export_lights=False,
              export_tangents=False, export_normals=True, export_texcoords=False, export_morph=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop("export_texcoords", None)
        bpy.ops.export_scene.gltf(**kw)


def smooth_all():
    for o in PARTS:
        me = o.data
        try:
            me.set_sharp_from_angle(angle=math.radians(32))
        except AttributeError:
            me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))


def add_lights():
    sc = bpy.context.scene
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (.035, .045, .055, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = .8
    sc.world = w
    for name, loc, en, size in (("key", (-300, -520, 520), 3.4e6, 480), ("fill", (560, -300, 160), 1.2e6, 380),
                                ("rim", (60, 480, 320), 8e5, 320)):
        lt = bpy.data.lights.new(name, "AREA")
        lt.energy, lt.size = en, size
        o = bpy.data.objects.new(name, lt)
        o.location = loc
        d = Vector((0, 0, 0)) - Vector(loc)
        o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.collection.objects.link(o)


def render_all(out_dir, samples, res):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 88
    sc.view_settings.view_transform = "Standard"
    add_lights()
    cd = bpy.data.cameras.new("cam")
    cd.clip_start, cd.clip_end = 1, 6000
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam

    def show(rule):
        for o in PARTS:
            o.hide_render = not rule(o)

    def shot(name, loc, at, lens):
        cam.location = loc
        cam.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        cd.lens = lens
        sc.render.filepath = os.path.join(out_dir, name)
        bpy.ops.render.render(write_still=True)
        print("rendered", name)

    full = lambda o: o["variant"] == "full"
    show(full)
    shot("view_exterior", (-360, -600, 280), (60, 0, 10), 50)
    # 剖开：不转的件用 Blender 剖切版；转的件在网页里用裁剪平面切，这里渲染时临时切一份
    cutkeys = {o["part"] for o in PARTS if o["variant"] == "cut"}
    for o in list(PARTS):
        if o["variant"] == "full" and o["part"] not in cutkeys and o.get("group") not in ("motor", "front"):
            c = o.copy()
            c.data = o.data.copy()
            sc.collection.objects.link(c)
            safe_cut(c, o, o.data.materials[0].name)
            c["variant"] = "rcut"
            PARTS.append(c)
    for o in list(_CUTTERS.values()):
        o.hide_render = True
    sec = lambda o: o["variant"] in ("cut", "rcut")
    show(lambda o: sec(o) or (o["variant"] == "full" and o.get("group") == "motor"))
    shot("view_cut", (-200, -560, 150), (20, 0, 10), 50)
    show(lambda o: sec(o) and o.get("group") not in ("shell",) or (o["variant"] == "full" and o.get("group") == "planet"))
    shot("view_core", (-230, -330, 170), (0, 0, 15), 55)
    show(lambda o: sec(o) and o.get("group") not in ("shell", "adjust"))
    shot("view_section", (0, -300, 52), (0, 0, 52), 90)
    # 全貌 + 拆开
    for o in PARTS:
        ex = SPEC["explode"].get(o["part"])
        if ex:
            o.location = Vector(o.location) + Vector(ex)
    show(lambda o: o["variant"] == "full")
    shot("view_exploded", (-300, -1150, 420), (20, 0, 60), 40)


def parse():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "out"))
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--samples", type=int, default=40)
    ap.add_argument("--res", default="1280x800")
    return ap.parse_known_args(argv)[0]


def main():
    global ROOT
    args = parse()
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_materials()
    ROOT = bpy.data.objects.new("ROOT_variator", None)
    bpy.context.scene.collection.objects.link(ROOT)
    build_input()
    build_planets()
    build_carrier()
    build_rings()
    build_adjust()
    build_shell()
    build_motor()
    smooth_all()
    for o in list(_CUTTERS.values()):
        bpy.data.objects.remove(o, do_unlink=True)
    _CUTTERS.clear()
    export_glb(os.path.join(out_dir, "variator.glb"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "variator.blend"), compress=True)
    spec = dict(SPEC, ref=dict(u=U_REF, e=E_REF, gIn=GIN_REF, gOut=GOUT_REF), planet_ang=PLANET_ANG,
                carrier=dict(xp=X_CAR_P, xn=X_CAR_N))
    with open(os.path.join(out_dir, "spec.json"), "w", encoding="utf-8") as fp:
        json.dump(spec, fp, ensure_ascii=False, indent=1)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in PARTS)
    print(f"objects={len(PARTS)} tris={tris}")
    if args.render:
        render_all(out_dir, args.samples, tuple(int(v) for v in args.res.split("x")))


main()
