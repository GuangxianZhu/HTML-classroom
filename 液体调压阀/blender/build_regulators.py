#!/usr/bin/env python3
"""液体调压阀（レギュレータ）：纯脚本建模。

五个模型放在同一个 .blend / .glb 里，每个模型一个根节点：
  ROOT_spring  手动弹簧式减压阀      参照 Surpass US 8,573,247 B2 里手动调压单元的结构
  ROOT_dome    气控式减压阀（带平衡膜片） 参照 旭有机材 US 7,108,241 B2
  ROOT_fixed   固定阀芯双膜片定压阀   参照 旭有机材 US 6,959,725 B2
  ROOT_bpr     气控背压阀（带出口平衡膜片） 参照 Advance 电气 US 6,386,509 B1
  ROOT_loop    闭环供液线：调压阀 + 压力传感器 + 超声波流量计 + 过滤器 + 喷嘴 + 控制器 + 电气比例阀
               参照 旭有机材 US 7,650,903 B2、CKD US 2010/0090137 A1

外形和尺寸都是原创的教学示意，只借专利里“哪些零件、怎么受力”的结构关系，不对应任何真实产品。
每个阀的零件各出两份：__full（完整外观）和 __cut（沿 y=0 剖开，去掉朝向观众的前半）。
液体区（fl_*）只有剖切版，网页里按压力重新着色。

用法（二选一）：
  blender -b -P blender/build_regulators.py -- --out blender/out [--render]
  pip install bpy && python blender/build_regulators.py --out blender/out [--render]

坐标：Z 向上，X 是流动方向（入口在 -X），-Y 朝向观众；单位毫米。
"""
import argparse
import json
import math
import os
import sys

import bpy  # 必须在 bmesh 之前导入（pip 版 bpy 的要求）
import bmesh  # noqa: E402
from mathutils import Matrix, Vector

TAU = 2 * math.pi
SEG = 64
STROKE = 4.0          # 网页里阀芯开度的放大显示行程（mm），真实开度只有零点几毫米

# ---------- 材质 ----------
#            名称       基色(sRGB)  金属 粗糙  透明  自发光
MATS = {
    "pfa":     ("#E6E9E2", 0.0, 0.30, 1.0, 0),   # 阀体 PFA/PTFE，乳白
    "ptfe":    ("#FAFAF5", 0.0, 0.60, 1.0, 0),   # 膜片 PTFE
    "pp":      ("#BFC6CA", 0.0, 0.50, 1.0, 0),   # 阀盖、底板 PP（不接触药液）
    "pvdf":    ("#E3D9BC", 0.0, 0.45, 1.0, 0),   # 活塞、弹簧座
    "sus":     ("#A7AFB5", 0.95, 0.32, 1.0, 0),  # 不锈钢弹簧、螺栓
    "knob":    ("#2E5677", 0.1, 0.45, 1.0, 0),
    "nut":     ("#EEF0EA", 0.0, 0.40, 1.0, 0),   # PFA 扩口螺母
    "tube":    ("#DCE8E6", 0.0, 0.12, 0.32, 0),  # 透明 PFA 管
    "airtube": ("#3D8FD6", 0.0, 0.30, 0.80, 0),  # 先导气管
    "fitting": ("#30363B", 0.2, 0.50, 1.0, 0),   # 快插接头
    "dark":    ("#2B3136", 0.3, 0.50, 1.0, 0),
    "panel":   ("#DDE2E3", 0.0, 0.65, 1.0, 0),   # 设备里的 PP 托盘
    "screen":  ("#7FE3B0", 0.0, 0.50, 1.0, 3),   # 显示屏
    "cable":   ("#1F2427", 0.0, 0.60, 1.0, 0),
    "sensor":  ("#5D6A73", 0.6, 0.40, 1.0, 0),
    "wafer":   ("#7A6FB4", 0.85, 0.22, 1.0, 0),
    "chuck":   ("#7D878E", 0.7, 0.40, 1.0, 0),
    "ring_in": ("#D9822B", 0.0, 0.50, 1.0, 0),   # 入口色环
    "ring_out": ("#2F7FBF", 0.0, 0.50, 1.0, 0),  # 出口色环
    "fl_in":   ("#E2683A", 0.0, 0.30, 0.42, 0),  # 液体区：网页里按压力重新着色
    "fl_out":  ("#3A86D8", 0.0, 0.30, 0.42, 0),
    "fl_air":  ("#7ACB8E", 0.0, 0.30, 0.30, 0),
    "stream":  ("#6FC3E8", 0.0, 0.10, 0.60, 0),
}
NO_CUT_MAT = {"screen", "stream", "fl_in", "fl_out", "fl_air"}
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
            # 剖切面：同色调稍暗，网页里能一眼分出“这是切开的面”
            c = [v * 0.62 for v in srgb(col)]
            M[name + "_cut"] = make_mat(name + "_cut", c, metal * 0.5, min(1, rough + 0.2), 1.0, 0)


# ---------- 几何工具 ----------
def rev_bm(prof, seg=SEG, bm=None):
    """把 (r, z) 闭合轮廓绕 Z 轴转一整圈；r=0 的点收成极点，保证网格封闭（布尔运算要求）。"""
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


def along_x(prof, zc, y=0.0, seg=SEG):
    """轮廓里的 z 当作 X 方向位置，转成沿 X 轴的回转体，放在高度 zc。"""
    return xform(rev_bm(prof, seg), Matrix.Translation((0, y, zc)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))


def cyl_x(r, x0, x1, zc, y=0.0, seg=SEG):
    return along_x([(0, x0), (r, x0), (r, x1), (0, x1)], zc, y, seg)


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


def star(n, r0, r1):
    """滚花旋钮：n 个齿的星形轮廓。"""
    pts = []
    for i in range(2 * n):
        r = r1 if i % 2 == 0 else r0
        a = TAU * i / (2 * n)
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def fillet(pts, rad, nseg=6):
    P = [Vector(p) for p in pts]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d1, d2 = a - b, c - b
        rr = min(rad, d1.length * 0.45, d2.length * 0.45)
        p1, p2 = b + d1.normalized() * rr, b + d2.normalized() * rr
        for k in range(nseg + 1):
            t = k / nseg
            out.append((1 - t) ** 2 * p1 + 2 * (1 - t) * t * b + t * t * p2)
    out.append(P[-1])
    return out


def tube_bm(pts, r, n=12, bm=None):
    """沿折线扫圆管，两端封口；用平行移动框架避免扭转。"""
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


def helix_pts(R, z0, z1, turns, wr, nper=28):
    """弹簧中心线：两端各有约 3/4 圈并紧（磨平端），中间等节距。"""
    N = int(turns * nper)
    ends = 0.75
    act = max(0.1, turns - 2 * ends)
    zA, zB = z0 + wr, z1 - wr
    tight = 2.05 * wr * ends
    pitch = max(0.0, (zB - zA - 2 * tight) / act)
    out = []
    for i in range(N + 1):
        t = turns * i / N
        if t < ends:
            z = zA + tight * t / ends
        elif t > turns - ends:
            z = zB - tight * (turns - t) / ends
        else:
            z = zA + tight + pitch * (t - ends)
        a = TAU * t
        out.append((R * math.cos(a), R * math.sin(a), z))
    return out


# ---------- 对象和布尔 ----------
def to_obj(name, bm, mat):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M[mat])
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def remove(o):
    me = o.data
    bpy.data.objects.remove(o, do_unlink=True)
    if me and me.users == 0:
        bpy.data.meshes.remove(me)


def bool_apply(o, cutter, op):
    m = o.modifiers.new("b", "BOOLEAN")
    m.object = cutter
    m.operation = op
    m.solver = "EXACT"
    try:
        m.material_mode = "TRANSFER"
    except (AttributeError, TypeError):
        pass
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=m.name)


def csg(name, base, mat, adds=(), subs=()):
    o = to_obj(name, base, mat)
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
    vs = [v.co for v in o.data.vertices]   # 本地坐标：原件和副本的变换相同
    return [min(v[i] for v in vs) for i in range(3)], [max(v[i] for v in vs) for i in range(3)]


def safe_cut(c, o, mat):
    """沿 y=0 剖开。EXACT 求解器偶尔会在共面处出错（结果把切块也带进来），检测到就微移切块重试，再不行换 FAST。"""
    keep = c.data.copy()
    (a0, a1) = bbox(o)
    for dy, solver in ((0.0, "EXACT"), (-0.013, "EXACT"), (0.011, "EXACT"), (0.0, "MANIFOLD"), (0.0, "FLOAT")):
        cu = cutter(mat)
        cu.location.y = dy
        m = c.modifiers.new("b", "BOOLEAN")
        m.object, m.operation, m.solver = cu, "DIFFERENCE", solver
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
        print("cut retry", c.name, solver, dy, [round(v, 2) for v in a0 + a1], [round(v, 2) for v in b0 + b1])
        old = c.data
        c.data = keep.copy()
        bpy.data.meshes.remove(old)
    raise RuntimeError("cut failed: " + c.name)


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


ROOTS = {}
PARTS = []          # 每个导出的网格对象
SPEC = {}


def root(model):
    if model not in ROOTS:
        e = bpy.data.objects.new("ROOT_" + model, None)
        bpy.context.scene.collection.objects.link(e)
        ROOTS[model] = e
        SPEC[model] = dict(pins=[], paths=[], membranes=[], springs=[])
    return ROOTS[model]


def add_morph(o, r_in, r_out, S):
    o.shape_key_add(name="Basis")
    k = o.shape_key_add(name="open")
    k.value = 0.0
    for i, v in enumerate(o.data.vertices):
        r = math.hypot(v.co.x, v.co.y)
        w = 1.0 if r <= r_in else max(0.0, (r_out - r) / (r_out - r_in))
        k.data[i].co.z = v.co.z + S * w


def part(model, key, src, mat, mov=None, cut=True, full=True, origin=None, morph=None, L0=None, fixed=None):
    """登记一个零件。src 可以是 bmesh 或已建好的对象。
    mov: None 不动 | 'rigid' 跟阀芯一起平移 | 'spring' 一端固定的弹簧（按长度缩放）| 'morph' 膜片（形变）
    """
    r = root(model)
    o = src if isinstance(src, bpy.types.Object) else to_obj("_tmp", src, mat)
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
            c.name = c.data.name = f"{model}__{key}__cut"
            made.append((c, "cut"))
    if full:
        o.name = o.data.name = f"{model}__{key}__full"
        made.append((o, "full"))
    else:
        remove(o)
    for ob, var in made:
        ob.parent = r
        ob["part"] = key
        ob["variant"] = var
        if mov:
            ob["mov"] = mov
        if L0 is not None:
            ob["L0"] = L0
            ob["fixed"] = fixed
        if morph:
            add_morph(ob, *morph)
        PARTS.append(ob)
    return made


def pin(model, key, at):
    SPEC[model]["pins"].append(dict(key=key, at=[round(v, 2) for v in at]))


def path(model, pts):
    """粒子路径：每点 (x, y, z, 散布半径, 区域, 相对流速)。区域 0 = 上游，1 = 下游。"""
    SPEC[model]["paths"].append([[round(v, 3) for v in p] for p in pts])


# ---------- 公共小件 ----------
def flare_fitting(model, key, side, zc, ring):
    """扩口接头：PFA 螺母 + 一段 3/8" PFA 管 + 区分进出口的色环。side=-1 在 -X。"""
    s = side
    x0, x1 = 44, 58
    nut = xform(prism_bm(ngon(6, 12.7, math.pi / 6), x0, x1), Matrix.Translation((0, 0, zc)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
    if s < 0:
        xform(nut, Matrix.Scale(-1, 4, (1, 0, 0)))
    nut_o = csg("_nut", nut, "nut", subs=[cyl_x(4.85, -70 if s < 0 else 40, -40 if s < 0 else 70, zc)])
    part(model, key + "_nut", nut_o, "nut")
    a, b = sorted((s * 38, s * 80))
    tube = along_x([(3.95, a), (4.75, a), (4.75, b), (3.95, b)], zc)
    part(model, key + "_tube", tube, "tube")
    a, b = sorted((s * 66, s * 70))
    part(model, key + "_ring", along_x([(4.75, a), (5.6, a), (5.6, b), (4.75, b)], zc), ring)


def bolts(model, z0, z1, zh):
    for i, (x, y) in enumerate(((24, 24), (-24, 24), (-24, -24), (24, -24))):
        bm = rev_bm([(0, z0), (2.4, z0), (2.4, zh), (4.2, zh), (4.2, zh + 4), (0, zh + 4)], 24)
        xform(bm, Matrix.Translation((x, y, 0)))
        o = csg("_bolt", bm, "sus", subs=[xform(prism_bm(ngon(6, 1.9), zh + 1.5, zh + 4.1), Matrix.Translation((x, y, 0)))])
        part(model, f"bolt{i}", o, "sus")


def push_fitting(model, key, p_base, axis, length_tube=22, cut=True):
    """快插接头 + 一段 6 mm 先导气管。axis 是朝外的单位向量。"""
    p0 = Vector(p_base)
    ax = Vector(axis)
    part(model, key + "_fit", orient(rev_bm([(0, 0), (6.5, 0), (6.5, 9), (5.6, 9), (5.6, 12), (7.4, 12), (7.4, 15), (0, 15)], 32), p0, p0 + ax), "fitting", cut=cut)
    if length_tube > 0:
        part(model, key + "_tube", orient(rev_bm([(0, 8), (3, 8), (3, 15 + length_tube), (0, 15 + length_tube)], 24), p0, p0 + ax), "airtube", cut=cut)


# ======================================================================
# 模型 A：手动弹簧式减压阀（阀芯在入口侧，不平衡）
# ======================================================================
def body_prv(model, z_bot, cavity, ports=((-1, 24), (1, 46))):
    base = prism_bm(rrect(64, 64, 7), z_bot, 58)
    adds = [cyl_x(11, -44, -28, ports[0][1]), cyl_x(11, 28, 44, ports[1][1])]
    subs = [rev_bm(cavity), cyl_x(4, -60, -6, ports[0][1]), cyl_x(4, 4, 60, ports[1][1])]
    return csg("_body", base, "pfa", adds, subs)


PRV_UPPER = [(3, 30), (3, 34), (9, 34), (9, 52), (25, 54), (25, 58.1), (0, 58.1)]


def fluid_prv(model, z_in0, inlet_extra=()):
    fin = rev_bm([(0, z_in0), (11, z_in0), (11, 30), (0, 30)])
    o = csg("_fl", fin, "fl_in", adds=[cyl_x(3.9, -80, -8, 24), *inlet_extra])
    part(model, "fl_in", o, "fl_in", full=False)
    fout = rev_bm([(0, 30)] + PRV_UPPER[:-1] + [(0, 58)])
    o = csg("_fl", fout, "fl_out", adds=[cyl_x(3.9, 4, 80, 46)])
    part(model, "fl_out", o, "fl_out", full=False)


def prv_paths(model):
    # 0=入口区, 1=出口区；相对流速：管内 1，腔里慢，阀口快
    path(model, [(-80, 0.6, 24, 2.6, 0, 1), (-14, 0.6, 24, 2.6, 0, 1), (-10, 1, 25, 1.4, 0, .3), (-9, 1, 28, 1.0, 0, .35),
                 (-6.6, .6, 29.5, .3, 0, 1.4), (-3.3, .4, 30.5, .2, 0.5, 4), (-2.5, .4, 32, .25, 1, 3), (-2.5, .4, 34, .25, 1, 3),
                 (-6, 1, 38, 2.4, 1, .35), (-4, 1, 44, 2.4, 1, .3), (4, .6, 46, 2.6, 1, .6), (14, .6, 46, 2.6, 1, 1), (80, .6, 46, 2.6, 1, 1)])
    path(model, [(-80, 0.6, 24, 2.6, 0, 1), (-14, 1, 24, 2.6, 0, 1), (-8, 8, 25, 1.4, 0, .3), (0, 10, 26, 1.0, 0, .3), (8, 7, 27, 1.0, 0, .35),
                 (8.8, 2.5, 28.5, .6, 0, .5), (6.6, 1.2, 29.5, .3, 0, 1.4), (3.3, .5, 30.5, .2, 0.5, 4), (2.5, .4, 32, .25, 1, 3), (2.5, .4, 34, .25, 1, 3),
                 (6, 1, 38, 2.4, 1, .35), (7, 1.5, 44, 2.4, 1, .3), (12, .6, 46, 2.6, 1, .8), (80, .6, 46, 2.6, 1, 1)])


def build_spring():
    m = "spring"
    root(m)
    cav = [(0, 5.9), (12, 5.9), (12, 16), (11, 16), (11, 30)] + PRV_UPPER
    part(m, "body", body_prv(m, 6, cav), "pfa")
    # 底塞：带导向孔，阀芯下端在里面滑
    part(m, "bottom_plug", rev_bm([(0, 3), (15, 3), (15, 6), (12, 6), (12, 16), (2.6, 16), (2.6, 10), (0, 10)]), "pfa")
    # 阀芯 + 阀杆 + 膜片下托盘：一起动
    part(m, "plug", rev_bm([(0, 11), (2.2, 11), (2.2, 24), (6.5, 25), (6.5, 27), (3.8, 30), (2.0, 30), (2.0, 54), (12, 54), (12, 58), (0, 58)]), "pfa", mov="rigid")
    # 回位弹簧（接液，实物多为氟树脂包覆）：下端坐在底塞上
    part(m, "return_spring", tube_bm(helix_pts(4.6, 16, 25, 4.5, 0.75), 0.75, 8), "sus", mov="spring", origin=(0, 0, 16), L0=9.0, fixed="bot")
    part(m, "membrane", rev_bm([(0, 58), (31, 58), (31, 59.2), (0, 59.2)]), "ptfe", mov="morph", morph=(14, 25, -STROKE))
    part(m, "spring_button", rev_bm([(0, 59.2), (14, 59.2), (14, 63), (5.5, 63), (5.5, 67), (0, 67)]), "pvdf", mov="rigid")
    # 阀盖：方底座 + 圆塔，里面装主弹簧
    bon = csg("_bon", prism_bm(rrect(64, 64, 7), 59.2, 68), "pp",
              adds=[cyl_z(23, 66, 104), cyl_z(13, 103, 110)],
              subs=[rev_bm([(0, 59.1), (19, 59.1), (19, 100), (0, 100)]), cyl_z(5.3, 99, 110.2), cyl_x(1.5, 15, 30, 82)])
    part(m, "bonnet", bon, "pp")
    part(m, "upper_seat", rev_bm([(0, 83), (5.5, 83), (5.5, 86), (15, 86), (15, 89), (0, 89)]), "sus")
    part(m, "screw", rev_bm([(0, 89), (5, 89), (5, 124), (0, 124)], 32), "sus")
    part(m, "main_spring", tube_bm(helix_pts(12, 63, 86, 5.5, 1.25), 1.25, 10), "sus", mov="spring", origin=(0, 0, 86), L0=23.0, fixed="top")
    part(m, "locknut", csg("_ln", prism_bm(ngon(6, 9.5, math.pi / 6), 110, 116), "sus", subs=[cyl_z(5.05, 109, 117, seg=32)]), "sus")
    knob = csg("_kn", prism_bm(star(24, 18.4, 19.6), 116, 131), "knob", adds=[rev_bm([(0, 130), (17.5, 130), (16, 133.5), (9, 135), (0, 135)])])
    part(m, "knob", knob, "knob")
    part(m, "knob_cap", rev_bm([(0, 134.6), (6, 134.6), (6, 135.6), (0, 135.6)], 32), "ring_out")
    bolts(m, 10, 68, 68)
    flare_fitting(m, "in", -1, 24, "ring_in")
    flare_fitting(m, "out", 1, 46, "ring_out")
    fluid_prv(m, 16)
    prv_paths(m)
    S = SPEC[m]
    S.update(dir=-1, kind="prv", view=dict(cam=[175, -390, 200], at=[0, 0, 68]), stroke=STROKE)
    for k, at in (("knob", (0, 0, 135)), ("locknut", (-9.5, 0, 113)), ("main_spring", (-12, 0, 75)), ("breather", (23, 0, 82)),
                  ("membrane", (-29, 0, 58.6)), ("outlet_chamber", (-6.5, 0, 43)), ("seat", (3, 0, 31)), ("plug", (-5.5, 0, 27)),
                  ("inlet_chamber", (-9.5, 0, 19)), ("return_spring", (4.6, 0, 20)), ("bottom_plug", (-13, 0, 4.5)),
                  ("inlet", (-74, 0, 24)), ("outlet", (74, 0, 46))):
        pin(m, k, at)


# ======================================================================
# 模型 B：气控式减压阀（先导气压 + 平衡膜片），闭阀弹簧在气室里，不接液
# ======================================================================
def build_dome(m="dome", offset=None):
    root(m)
    base = csg("_base", prism_bm(rrect(64, 64, 7), 0, 12), "pp",
               subs=[rev_bm([(0, 4), (9, 4), (9, 12.1), (0, 12.1)]), cyl_x(1.4, -34, -6, 8)])
    part(m, "base", base, "pp")
    cav = [(0, 13.1), (8, 13.1), (8, 16), (11, 16), (11, 30)] + PRV_UPPER
    part(m, "body", body_prv(m, 13.2, cav), "pfa")
    part(m, "bal_membrane", rev_bm([(0, 12), (16, 12), (16, 13.2), (0, 13.2)]), "ptfe", mov="morph", morph=(4, 8, -STROKE))
    part(m, "plug", rev_bm([(0, 9.5), (4, 9.5), (4, 12), (2.4, 12), (2.4, 24), (6.5, 25), (6.5, 27), (3.8, 30), (2.0, 30), (2.0, 54), (12, 54), (12, 58), (0, 58)]),
         "pfa", mov="rigid")
    part(m, "membrane", rev_bm([(0, 58), (31, 58), (31, 59.2), (0, 59.2)]), "ptfe", mov="morph", morph=(12, 25, -STROKE))
    recv = csg("_rc", prism_bm(rrect(64, 64, 7), 59.2, 62), "pvdf", subs=[cyl_z(7, 59, 62.2)])
    part(m, "receiver", recv, "pvdf")
    part(m, "piston", rev_bm([(0, 59.2), (5.5, 59.2), (5.5, 70), (18, 70), (18, 73), (0, 73)]), "pvdf", mov="rigid")
    part(m, "close_spring", tube_bm(helix_pts(12.5, 62, 70, 3.0, 0.8), 0.8, 8), "sus", mov="spring", origin=(0, 0, 62), L0=8.0, fixed="bot")
    bon = csg("_bon", prism_bm(rrect(64, 64, 7), 62, 84), "pp",
              subs=[rev_bm([(0, 61.9), (21, 61.9), (21, 78), (0, 78)]), cyl_z(2, 77, 84.2, seg=24), cyl_x(1.5, 18, 34, 75)])
    part(m, "bonnet", bon, "pp")
    push_fitting(m, "air", (0, 0, 84), (0, 0, 1))
    bolts(m, 2, 84, 84)
    flare_fitting(m, "in", -1, 24, "ring_in")
    flare_fitting(m, "out", 1, 46, "ring_out")
    fluid_prv(m, 13.2)
    o = csg("_fl", rev_bm([(0, 59.2), (7, 59.2), (7, 62), (21, 62), (21, 78), (2, 78), (2, 120), (0, 120)]), "fl_air")
    part(m, "fl_air", o, "fl_air", full=False)
    prv_paths(m)
    S = SPEC[m]
    S.update(dir=-1, kind="prv", view=dict(cam=[140, -300, 150], at=[0, 0, 54]), stroke=STROKE)
    for k, at in (("air_port", (0, 0, 104)), ("air_chamber", (-17, 0, 76)), ("piston", (-16, 0, 71.5)), ("close_spring", (12.5, 0, 66)),
                  ("discharge", (26, 0, 75)), ("membrane", (-29, 0, 58.6)), ("outlet_chamber", (-6.5, 0, 43)), ("seat", (3, 0, 31)),
                  ("plug", (-5.5, 0, 27)), ("inlet_chamber", (-9.5, 0, 19)), ("bal_membrane", (-13, 0, 12.6)), ("breather", (-22, 0, 8)),
                  ("inlet", (-74, 0, 24)), ("outlet", (74, 0, 46))):
        pin(m, k, at)


# ======================================================================
# 模型 C：固定阀芯双膜片定压阀（阀芯不动，动的是带中心孔的膜片套筒）
# ======================================================================
def build_fixed():
    m = "fixed"
    root(m)
    part(m, "base", prism_bm(rrect(64, 64, 7), 0, 8), "pp")
    body = csg("_body", prism_bm(rrect(64, 64, 7), 8, 36), "pfa", adds=[cyl_x(11, -44, -28, 20)],
               subs=[rev_bm([(7, 13.9), (16, 13.9), (16, 36.1), (0, 36.1), (0, 28), (7, 28)]), cyl_x(4, -60, -10, 20)])
    part(m, "body", body, "pfa")
    part(m, "lower_membrane", rev_bm([(6, 36), (20, 36), (20, 37.2), (6, 37.2)]), "ptfe", mov="morph", morph=(6, 16, STROKE))
    ring = csg("_ring", prism_bm(rrect(64, 64, 7), 37.2, 50), "pp", adds=[cyl_x(7, -40, -28, 44)],
               subs=[rev_bm([(0, 37.1), (24, 37.1), (24, 50.1), (0, 50.1)]), cyl_x(2, -46, -18, 44, seg=24), cyl_x(0.9, 18, 34, 44, seg=16)])
    part(m, "air_ring", ring, "pp")
    part(m, "sleeve", rev_bm([(4, 28.15), (6, 28.15), (6, 46), (16, 46), (16, 50), (4, 50)]), "ptfe", mov="rigid")
    part(m, "upper_membrane", rev_bm([(4, 50), (31, 50), (31, 51.2), (4, 51.2)]), "ptfe", mov="morph", morph=(16, 24, STROKE))
    cover = csg("_cv", prism_bm(rrect(64, 64, 7), 51.2, 74), "pfa", adds=[cyl_x(11, 28, 44, 62)],
                subs=[rev_bm([(0, 51.1), (24, 51.1), (24, 55), (9, 60), (9, 66), (0, 66)]), cyl_x(4, 4, 60, 62)])
    part(m, "cover", cover, "pfa")
    push_fitting(m, "air", (-40, 0, 44), (-1, 0, 0), 16)
    bolts(m, 2, 74, 74)
    flare_fitting(m, "in", -1, 20, "ring_in")
    flare_fitting(m, "out", 1, 62, "ring_out")
    fin = csg("_fl", rev_bm([(7, 14), (16, 14), (16, 36), (0, 36), (0, 28.2), (7, 28.2)]), "fl_in", adds=[cyl_x(3.9, -80, -12, 20)])
    part(m, "fl_in", fin, "fl_in", full=False)
    fout = csg("_fl", rev_bm([(0, 28.2), (4, 28.2), (4, 51.2), (24, 51.2), (24, 55), (9, 60), (9, 66), (0, 66)]), "fl_out", adds=[cyl_x(3.9, 4, 80, 62)])
    part(m, "fl_out", fout, "fl_out", full=False)
    fair = csg("_fl", rev_bm([(6, 37.2), (24, 37.2), (24, 50), (16, 50), (16, 46), (6, 46)]), "fl_air", adds=[cyl_x(1.9, -62, -20, 44, seg=24)])
    part(m, "fl_air", fair, "fl_air", full=False)
    path(m, [(-80, .6, 20, 2.6, 0, 1), (-16, .6, 20, 2.6, 0, 1), (-12, 1, 23, 1.6, 0, .3), (-10, 1, 27.5, 1.0, 0, .35), (-7.2, .6, 28.6, .2, 0, 1.5),
             (-4.6, .4, 28.6, .15, .5, 4), (-2, .4, 30, 1.2, 1, 1.4), (-2, .4, 50, 1.2, 1, 1.4), (-6, 1, 54, 2.0, 1, .35), (-4, 1, 60, 2.6, 1, .5),
             (6, .6, 62, 2.6, 1, .8), (80, .6, 62, 2.6, 1, 1)])
    path(m, [(-80, .6, 20, 2.6, 0, 1), (-16, 1, 20, 2.6, 0, 1), (-9, 9, 22, 1.6, 0, .3), (0, 11.5, 24, 1.2, 0, .3), (9, 7, 26, 1.0, 0, .35),
             (7.2, .8, 28.6, .2, 0, 1.5), (4.6, .4, 28.6, .15, .5, 4), (2, .4, 30, 1.2, 1, 1.4), (2, .4, 50, 1.2, 1, 1.4), (6, 1, 56, 2.0, 1, .4),
             (8, 1, 61, 2.4, 1, .6), (80, .6, 62, 2.6, 1, 1)])
    S = SPEC[m]
    S.update(dir=1, kind="fixed", view=dict(cam=[130, -280, 130], at=[0, 0, 40]), stroke=STROKE)
    for k, at in (("air_port", (-60, 0, 44)), ("air_chamber", (-20, 0, 41)), ("upper_membrane", (-29, 0, 50.6)), ("lower_membrane", (-14, 0, 36.6)),
                  ("sleeve", (5, 0, 40)), ("fixed_plug", (-3.5, 0, 22)), ("gap", (-5.5, 0, 28.6)), ("outlet_chamber", (-14, 0, 53.2)),
                  ("bleed", (26, 0, 44)), ("inlet", (-74, 0, 20)), ("outlet", (74, 0, 62))):
        pin(m, k, at)


# ======================================================================
# 模型 D：气控背压阀（上游压力把阀芯顶开；阀座下方的第二膜片抵消出口压力）
# ======================================================================
def build_bpr():
    m = "bpr"
    root(m)
    base = csg("_base", prism_bm(rrect(64, 64, 7), 0, 12), "pp",
               subs=[rev_bm([(0, 3), (10, 3), (10, 12.1), (0, 12.1)]), cyl_x(1.4, -34, -8, 7)])
    part(m, "base", base, "pp")
    part(m, "spring2", tube_bm(helix_pts(6, 3, 9.5, 3.0, 0.6), 0.6, 8), "sus", mov="spring", origin=(0, 0, 3), L0=6.5, fixed="bot")
    part(m, "membrane2", rev_bm([(0, 12), (16, 12), (16, 13.2), (0, 13.2)]), "ptfe", mov="morph", morph=(4, 9, STROKE))
    cav = [(0, 13.1), (9, 13.1), (9, 16), (12, 16), (12, 30), (4, 30), (4, 34), (14, 34), (14, 44), (25, 46), (25, 50.1), (0, 50.1)]
    body = csg("_body", prism_bm(rrect(64, 64, 7), 13.2, 50), "pfa", adds=[cyl_x(11, -44, -28, 38), cyl_x(11, 28, 44, 25)],
               subs=[rev_bm(cav), cyl_x(4, -60, -8, 38), cyl_x(4, 6, 60, 25)])
    part(m, "body", body, "pfa")
    part(m, "plug", rev_bm([(0, 9.5), (4, 9.5), (4, 12), (2, 12), (2, 33), (3, 33), (7, 37), (7, 38), (3, 38), (3, 46), (10, 46), (10, 50), (0, 50)]),
         "pfa", mov="rigid")
    part(m, "membrane", rev_bm([(0, 50), (31, 50), (31, 51.2), (0, 51.2)]), "ptfe", mov="morph", morph=(10, 25, STROKE))
    part(m, "upper_plate", rev_bm([(0, 51.2), (12, 51.2), (12, 54), (0, 54)]), "pvdf", mov="rigid")
    bon = csg("_bon", prism_bm(rrect(64, 64, 7), 51.2, 70), "pp",
              subs=[rev_bm([(0, 51.1), (26, 51.1), (26, 58), (0, 58)]), cyl_z(2, 57, 70.2, seg=24), cyl_x(1.4, 20, 34, 55)])
    part(m, "bonnet", bon, "pp")
    push_fitting(m, "air", (0, 0, 70), (0, 0, 1))
    bolts(m, 2, 70, 70)
    flare_fitting(m, "in", -1, 38, "ring_in")
    flare_fitting(m, "out", 1, 25, "ring_out")
    fup = csg("_fl", rev_bm([(0, 34), (14, 34), (14, 44), (25, 46), (25, 50), (0, 50)]), "fl_in", adds=[cyl_x(3.9, -80, -10, 38)])
    part(m, "fl_in", fup, "fl_in", full=False)
    fdn = csg("_fl", rev_bm([(0, 13.2), (9, 13.2), (9, 16), (12, 16), (12, 30), (4, 30), (4, 34), (0, 34)]), "fl_out", adds=[cyl_x(3.9, 6, 80, 25)])
    part(m, "fl_out", fdn, "fl_out", full=False)
    fair = csg("_fl", rev_bm([(0, 54), (12, 54), (12, 51.2), (26, 51.2), (26, 58), (2, 58), (2, 100), (0, 100)]), "fl_air")
    part(m, "fl_air", fair, "fl_air", full=False)
    path(m, [(-80, .6, 38, 2.6, 0, 1), (-14, .6, 38, 2.6, 0, 1), (-11, 1, 37.5, 1.5, 0, .3), (-8.5, .8, 36, .8, 0, .5), (-5.4, .5, 34.8, .25, 0, 1.6),
             (-3.6, .4, 33.2, .2, .5, 4), (-3, .4, 31, .3, 1, 2.5), (-3, .4, 30, .5, 1, 1.2), (-8, 1, 27, 2.0, 1, .35), (-4, 1, 25, 2.0, 1, .4),
             (8, .6, 25, 2.6, 1, .8), (80, .6, 25, 2.6, 1, 1)])
    path(m, [(-80, .6, 38, 2.6, 0, 1), (-14, 1, 38, 2.6, 0, 1), (-7, 10, 38.5, 1.5, 0, .3), (0, 12, 38, 1.2, 0, .3), (8, 8, 37, 1.0, 0, .35),
             (8.5, 2.5, 36, .6, 0, .5), (5.4, .6, 34.8, .25, 0, 1.6), (3.6, .4, 33.2, .2, .5, 4), (3, .4, 31, .3, 1, 2.5), (3, .4, 30, .5, 1, 1.2),
             (8, 1, 26, 2.0, 1, .4), (12, .6, 25, 2.4, 1, .8), (80, .6, 25, 2.6, 1, 1)])
    S = SPEC[m]
    S.update(dir=1, kind="bpr", view=dict(cam=[130, -280, 125], at=[0, 0, 38]), stroke=STROKE)
    for k, at in (("air_port", (0, 0, 88)), ("gas_chamber", (-20, 0, 56)), ("membrane", (-29, 0, 50.6)), ("plug", (-6.5, 0, 37.5)),
                  ("seat", (4.5, 0, 32)), ("up_chamber", (-12, 0, 42)), ("down_chamber", (-10, 0, 20)), ("membrane2", (-13, 0, 12.6)),
                  ("spring2", (6, 0, 6)), ("breather", (-22, 0, 7)), ("vent", (26, 0, 55)), ("inlet", (-74, 0, 38)), ("outlet", (74, 0, 25))):
        pin(m, k, at)


# ======================================================================
# 模型 E：闭环供液线（设备里一条喷嘴支路的示意）
# ======================================================================
def build_loop():
    m = "loop"
    root(m)
    X0 = -200.0     # 调压阀放在这里
    # 托盘
    part(m, "tray", prism_bm(rrect(780, 300, 14, cx=40, cy=50), -8, 0), "panel", cut=False)
    # 调压阀：复用气控式的完整外观网格（链接同一份网格数据）
    for ob in [o for o in PARTS if o.get("variant") == "full" and o.name.startswith("dome__")]:
        if ob.get("part", "").startswith(("in_", "out_", "air_tube")):
            continue
        c = ob.copy()
        bpy.context.scene.collection.objects.link(c)
        c.parent = ROOTS[m]
        c.location = ob.location + Vector((X0, 0, 0))
        c.name = "loop__reg_" + ob["part"] + "__full"
        c["part"] = "reg_" + ob["part"]
        c["variant"] = "full"
        for k in ("mov", "L0", "fixed"):
            if k in c:
                del c[k]
        PARTS.append(c)
    for side, zc, ring in ((-1, 24, "ring_in"), (1, 46, "ring_out")):
        nut = xform(prism_bm(ngon(6, 12.7, math.pi / 6), 44, 58), Matrix.Translation((0, 0, zc)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
        if side < 0:
            xform(nut, Matrix.Scale(-1, 4, (1, 0, 0)))
        xform(nut, Matrix.Translation((X0, 0, 0)))
        part(m, f"reg_nut{side}", nut, "nut", cut=False)
    LIQ = 4.75
    supply = fillet([(-345, 0, -30), (-345, 0, 24), (X0 - 44, 0, 24)], 18)
    part(m, "pipe_supply", tube_bm(supply, LIQ, 16), "tube", cut=False)
    part(m, "pipe_supply_ring", cyl_between(5.6, (-300, 0, 24), (-296, 0, 24)), "ring_in", cut=False)
    # 压力传感器
    PX = -90.0
    part(m, "pt_body", prism_bm(rrect(28, 28, 3, cx=PX), 32, 60), "pfa", cut=False)
    part(m, "pt_head", cyl_z(11, 60, 84, PX, seg=40), "sensor", cut=False)
    part(m, "pt_gland", cyl_z(5, 84, 92, PX, seg=24), "dark", cut=False)
    part(m, "pipe_a", tube_bm([(X0 + 44, 0, 46), (PX - 14, 0, 46)], LIQ, 16), "tube", cut=False)
    # 超声波流量计：直管段 + 两个换能器 + 电子盒
    part(m, "pipe_b", tube_bm([(PX + 14, 0, 46), (-52, 0, 46)], LIQ, 16), "tube", cut=False)
    part(m, "fm_tube", tube_bm([(-52, 0, 46), (52, 0, 46)], 6.2, 24), "tube", cut=False)
    for i, x in enumerate((-34, 34)):
        part(m, f"fm_tx{i}", prism_bm(rrect(22, 26, 3, cx=x), 34, 64), "sensor", cut=False)
    part(m, "fm_box", prism_bm(rrect(96, 26, 4), 64, 86), "dark", cut=False)
    part(m, "fm_screen", prism_bm(rrect(30, 1.2, 0.4, cy=-13.2), 70, 80), "screen", cut=False)
    part(m, "fm_gland", cyl_z(4.5, 86, 93, 36, seg=24), "fitting", cut=False)
    # 过滤器（卧式外壳）
    part(m, "pipe_c", tube_bm([(52, 0, 46), (94, 0, 46)], LIQ, 16), "tube", cut=False)
    part(m, "filter", along_x([(0, 94), (20, 94), (26, 100), (26, 176), (20, 182), (0, 182)], 46), "pfa", cut=False)
    part(m, "filter_bands", along_x([(26.2, 106), (27.2, 106), (27.2, 110), (26.2, 110)], 46), "ring_out", cut=False)
    part(m, "filter_vent", cyl_z(4, 70, 82, 168, seg=24), "nut", cut=False)
    # 去喷嘴
    nz = fillet([(182, 0, 46), (232, 0, 46), (232, 0, 150), (300, 0, 150), (300, 0, 130)], 16)
    part(m, "pipe_d", tube_bm(nz, LIQ, 16), "tube", cut=False)
    part(m, "nozzle", xform(rev_bm([(0, 106), (2.5, 106), (4.5, 112), (7, 112), (7, 131), (0, 131)], 32), Matrix.Translation((300, 0, 0))), "sus", cut=False)
    part(m, "chuck", cyl_z(26, 0, 30, 300, seg=48), "chuck", cut=False)
    part(m, "wafer", cyl_z(70, 30, 31.2, 300, seg=96), "wafer", cut=False)
    part(m, "stream", cyl_z(1.6, 31.2, 106, 300, seg=16), "stream", cut=False, mov="stream")
    # 电气比例阀（E/P）和控制器
    EY = 95.0
    part(m, "ep", prism_bm(rrect(36, 40, 4, cx=X0, cy=EY), 0, 56), "dark", cut=False)
    part(m, "ep_screen", prism_bm(rrect(24, 1.2, 0.4, cx=X0, cy=EY - 20.4), 38, 50), "screen", cut=False)
    push_fitting(m, "ep_out", (X0, EY, 56), (0, 0, 1), 0, cut=False)
    air = fillet([(X0, EY, 66), (X0, EY, 128), (X0, 0, 128), (X0, 0, 99)], 14)
    part(m, "air_line", tube_bm(air, 3.0, 12), "airtube", cut=False)
    air_sup = fillet([(-350, 150, 6), (-262, 150, 6), (-262, EY, 6), (-262, EY, 30), (X0 - 18, EY, 30)], 12)
    part(m, "air_supply", tube_bm(air_sup, 3.0, 12), "airtube", cut=False)
    part(m, "ctl", prism_bm(rrect(120, 50, 5, cx=-10, cy=135), 0, 92), "dark", cut=False)
    part(m, "ctl_screen", prism_bm(rrect(70, 1.2, 0.5, cx=-10, cy=109.4), 58, 82), "screen", cut=False)
    cab_p = fillet([(PX, 0, 92), (PX, 0, 106), (PX, 135, 106), (PX, 135, 40), (-70, 135, 40)], 12)
    cab_q = fillet([(36, 0, 93), (36, 0, 104), (36, 100, 104), (36, 100, 60), (36, 110, 60)], 12)
    cab_e = fillet([(-70, 140, 20), (-150, 140, 20), (-150, EY, 20), (X0 + 18, EY, 20)], 12)
    part(m, "cable_p", tube_bm(cab_p, 2.2, 10), "cable", cut=False)
    part(m, "cable_q", tube_bm(cab_q, 2.2, 10), "cable", cut=False)
    part(m, "cable_ep", tube_bm(cab_e, 2.2, 10), "cable", cut=False)
    S = SPEC[m]
    S["cables"] = {k: [[round(v, 2) for v in p] for p in pts] for k, pts in (("p", cab_p), ("q", cab_q), ("ep", cab_e), ("air", air))}
    # 液体路径：0 供液（入口压力）、1 调压后、2 过滤器后、3 喷出
    liq = [(-345, 0, -30, 0), (-345, 0, 24, 0), (X0, 0, 24, 0), (X0, 0, 46, 1), (PX, 0, 46, 1), (52, 0, 46, 1), (94, 0, 46, 1),
           (182, 0, 46, 2), (232, 0, 46, 2), (232, 0, 150, 2), (300, 0, 150, 2), (300, 0, 106, 2), (300, 0, 32, 3)]
    pts = fillet([p[:3] for p in liq], 14, 4)
    S["liquid"] = [[round(v, 2) for v in p] for p in pts]
    S["liquid_marks"] = dict(reg=X0, filter0=94, filter1=182, nozzle=106)
    S.update(kind="loop", view=dict(cam=[70, -900, 520], at=[10, 40, 40]))
    for k, at in (("supply", (-345, 0, 0)), ("reg", (X0, 0, 112)), ("ep", (X0, EY - 20, 56)), ("air_line", (X0, 50, 128)),
                  ("pt", (PX, 0, 84)), ("fm", (0, -13, 86)), ("filter", (137, 0, 72)), ("nozzle", (300, 0, 131)),
                  ("wafer", (345, -30, 31)), ("ctl", (-10, 110, 92)), ("cable_q", (36, 60, 104))):
        pin(m, k, at)


# ---------- 导出、渲染 ----------
def export_glb(path):
    kw = dict(filepath=path, export_format="GLB", use_selection=False, export_apply=False, export_yup=True,
              export_extras=True, export_animations=False, export_cameras=False, export_lights=False,
              export_tangents=False, export_normals=True, export_texcoords=False, export_morph=True,
              export_morph_normal=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        for k in ("export_morph_normal", "export_texcoords"):
            kw.pop(k, None)
        bpy.ops.export_scene.gltf(**kw)


def smooth_all():
    """回转体按角度自动平滑：圆柱面光滑，棱角保持锐利。"""
    for o in PARTS:
        me = o.data
        try:
            me.set_sharp_from_angle(angle=math.radians(35))
        except AttributeError:
            me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
            try:
                me.use_auto_smooth = True
                me.auto_smooth_angle = math.radians(35)
            except AttributeError:
                pass


def add_lights():
    sc = bpy.context.scene
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (.035, .045, .055, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = .9
    sc.world = w
    for name, loc, en, size in (("key", (-260, -420, 520), 2.6e6, 420), ("fill", (520, -260, 160), 9e5, 360), ("rim", (60, 420, 300), 6e5, 300)):
        lt = bpy.data.lights.new(name, "AREA")
        lt.energy, lt.size = en, size
        o = bpy.data.objects.new(name, lt)
        o.location = loc
        d = Vector((0, 0, 40)) - Vector(loc)
        o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.collection.objects.link(o)


def render_all(out_dir, samples, res, family_only=False):
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
    cd.clip_start, cd.clip_end = 1, 5000
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam

    def show(model, variant):
        for o in PARTS:
            mdl = o.name.split("__")[0]
            o.hide_render = not (mdl == model and o["variant"] == variant)
        for o in _CUTTERS.values():
            o.hide_render = True

    def shot(name, model, variant, lens=60):
        show(model, variant)
        v = SPEC[model]["view"]
        cam.location = v["cam"]
        cam.rotation_euler = (Vector(v["at"]) - Vector(v["cam"])).to_track_quat("-Z", "Y").to_euler()
        cd.lens = lens
        sc.render.filepath = os.path.join(out_dir, name)
        bpy.ops.render.render(write_still=True)
        print("rendered", name)

    if not family_only:
        for mdl in ("spring", "dome", "fixed", "bpr"):
            shot(f"view_{mdl}", mdl, "cut")
        shot("view_dome_full", "dome", "full")
        shot("view_loop", "loop", "full", 50)
    # 全家福：四个剖切模型并排
    offs = dict(spring=(-112, 128), dome=(112, 140), fixed=(-112, 0), bpr=(112, 12))
    for mdl, (dx, dz) in offs.items():
        ROOTS[mdl].location.x, ROOTS[mdl].location.z = dx, dz
    for o in PARTS:
        mdl = o.name.split("__")[0]
        o.hide_render = not (mdl in offs and o["variant"] == "cut")
    cam.location = (60, -860, 210)
    cam.rotation_euler = (Vector((0, 0, 104)) - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
    cd.lens = 50
    sc.render.filepath = os.path.join(out_dir, "view_family")
    bpy.ops.render.render(write_still=True)
    for mdl in offs:
        ROOTS[mdl].location.x = ROOTS[mdl].location.z = 0


def parse():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--samples", type=int, default=40)
    ap.add_argument("--res", default="1280x800")
    ap.add_argument("--family-only", action="store_true", help="只重渲四个阀的合影")
    return ap.parse_known_args(argv)[0]


def main():
    args = parse()
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_materials()
    build_spring()
    build_dome()
    build_fixed()
    build_bpr()
    build_loop()
    smooth_all()
    for o in _CUTTERS.values():
        o.hide_viewport = True
    # 导出前把切块藏起来（它们没有父节点，按名字过滤）
    for o in list(_CUTTERS.values()):
        o.hide_set(True)
    sel_objs = list(_CUTTERS.values())
    for o in sel_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    _CUTTERS.clear()
    export_glb(os.path.join(out_dir, "regulators.glb"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "regulators.blend"), compress=True)
    spec = dict(models=SPEC, stroke=STROKE)
    with open(os.path.join(out_dir, "spec.json"), "w", encoding="utf-8") as fp:
        json.dump(spec, fp, ensure_ascii=False, indent=1)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in PARTS)
    print(f"objects={len(PARTS)} tris={tris}")
    if args.render:
        render_all(out_dir, args.samples, tuple(int(v) for v in args.res.split("x")), args.family_only)


main()
