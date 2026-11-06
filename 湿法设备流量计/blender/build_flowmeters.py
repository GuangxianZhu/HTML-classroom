#!/usr/bin/env python3
"""半导体湿法设备里的流量计：纯脚本建模。

一个 .blend / .glb 里放 10 个独立模型（每个一个 ROOT_ 空物体）：
  ROOT_bench  虚构的湿法清洗台 + 药液调配柜，标出每种流量计装在哪
  ROOT_us     管内式超声波（轴向声路，PFA 机身，两端换能器）
  ROOT_usc    夹装式超声波（夹在 PFA 管外，V 字声路）
  ROOT_vor    卡门涡街（PFA 机身，梯形发生体，下游插一根封着压电片的探头）
  ROOT_pad    叶轮式（切向射流冲叶轮，叶片里嵌磁铁，霍尔元件在壁外数脉冲）
  ROOT_flt    浮子式（锥形 PFA 管，浮子 + 导杆，刻度板，下限报警开关）
  ROOT_dp     差压式（PFA 机身里的孔板 + 两个隔膜压力传感器）
  ROOT_thm    热式质量流量控制器 MFC（N2 用：旁路毛细管 + 两个绕组 + 层流元件 + 压电阀）
  ROOT_cor    科里奥利质量流量计（PFA 双 U 管、驱动器、两个拾振器）
  ROOT_mag    电磁流量计（PFA 内衬、上下励磁线圈、左右电极）

用法（二选一）：
  blender -b --factory-startup -P blender/build_flowmeters.py -- --out blender/out [--render]
  pip install bpy && python blender/build_flowmeters.py --out blender/out [--render]

坐标：流量计里流向 +X，Z 向上，Y 进深；y<0 的一半切掉（剖切面朝向观察者），单位米。
外形参考公开专利和产品资料里的通用结构，尺寸是教学示意，不对应任何一家厂商的产品；
传感毛细管、换能器等小零件为了看得见做了放大。
"""
import argparse
import json
import math
import os
import sys

import bpy
import bmesh  # bpy 之后才能导入
from mathutils import Matrix, Vector

# ---------- 材质 ----------
#  名称            基色(sRGB)  金属  粗糙  不透明度  自发光
MATS = {
    "pfa":        ("#E7E8E0", 0.0, 0.30, 1.0, 0),
    "pfa_clear":  ("#D7EAEE", 0.0, 0.10, 0.34, 0),
    "ptfe":       ("#F5F5F1", 0.0, 0.55, 1.0, 0),
    "pvdf":       ("#E3BE7A", 0.0, 0.42, 1.0, 0),
    "nut":        ("#CDD3CB", 0.0, 0.40, 1.0, 0),
    "case":       ("#A7B1B8", 0.0, 0.45, 1.0, 0),
    "case_dark":  ("#3A434A", 0.1, 0.50, 1.0, 0),
    "paint":      ("#3E6F8E", 0.2, 0.42, 1.0, 0),
    "pcb":        ("#2C6B4B", 0.1, 0.50, 1.0, 0),
    "chip":       ("#1D2125", 0.2, 0.40, 1.0, 0),
    "screen":     ("#0E2A33", 0.0, 0.25, 1.0, 0),
    "led_g":      ("#46E08A", 0.0, 0.50, 1.0, 5),
    "led_a":      ("#FFB23E", 0.0, 0.50, 1.0, 5),
    "piezo":      ("#BDB6A6", 0.6, 0.35, 1.0, 0),
    "backing":    ("#4B4541", 0.1, 0.80, 1.0, 0),
    "wedge":      ("#C99B4F", 0.0, 0.35, 1.0, 0),
    "steel":      ("#B9C0C6", 0.95, 0.30, 1.0, 0),
    "steel_dark": ("#5C656C", 0.85, 0.45, 1.0, 0),
    "copper":     ("#B86B3D", 1.0, 0.35, 1.0, 0),
    "ferrite":    ("#33383D", 0.3, 0.60, 1.0, 0),
    "mag_n":      ("#C9473C", 0.3, 0.40, 1.0, 0),
    "mag_s":      ("#3F6EC4", 0.3, 0.40, 1.0, 0),
    "sapphire":   ("#8DB7E0", 0.0, 0.05, 0.70, 0),
    "ceramic":    ("#E5E1D5", 0.0, 0.50, 1.0, 0),
    "electrode":  ("#DADEE1", 1.0, 0.16, 1.0, 0),
    "wire_r":     ("#C2452F", 0.0, 0.50, 1.0, 0),
    "rubber":     ("#22262A", 0.0, 0.80, 1.0, 0),
    "tick":       ("#20262B", 0.0, 0.60, 1.0, 0),
    "accent":     ("#E8742E", 0.0, 0.45, 1.0, 0),
    "heat":       ("#FF7A3A", 0.0, 0.50, 1.0, 2),
    "quartz":     ("#D3ECF3", 0.0, 0.05, 0.20, 0),
    "water":      ("#4FB4E8", 0.0, 0.08, 0.28, 0),
    "wafer":      ("#6A5C96", 1.0, 0.12, 1.0, 0),
    "panel":      ("#E1E5E7", 0.0, 0.55, 1.0, 0),
    "panel_grey": ("#A6AFB5", 0.0, 0.55, 1.0, 0),
    "plinth":     ("#2F363B", 0.2, 0.60, 1.0, 0),
    "pipe":       ("#E6EAE4", 0.0, 0.30, 1.0, 0),
    "band_diw":   ("#3D8FD6", 0.0, 0.50, 1.0, 0),
    "band_chem":  ("#E0A23A", 0.0, 0.50, 1.0, 0),
    "band_n2":    ("#4CB27F", 0.0, 0.50, 1.0, 0),
    "band_ret":   ("#7E8A94", 0.0, 0.50, 1.0, 0),
    "band_cds":   ("#C9603E", 0.0, 0.50, 1.0, 0),
    "pump":       ("#55788A", 0.2, 0.45, 1.0, 0),
    "valve":      ("#2F5F86", 0.2, 0.45, 1.0, 0),
}

ROOTS = ["bench", "us", "usc", "vor", "pad", "flt", "dp", "thm", "cor", "mag"]
# .blend 里一字排开；网页里各自归零、一次只显示一个
ROOT_POS = {"bench": (0.0, 1.6, 0.0)}
for i, r in enumerate(ROOTS[1:]):
    ROOT_POS[r] = (-1.4 + 0.35 * i, 0.0, 0.25)

SPEC = {}      # 给网页用的尺寸、动画参数
PATHS = {}     # 流体粒子路径：[[x, y, z, 半径], ...]
PINS = {}      # 标注
VIEWS = {}     # 默认机位


def srgb(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c]


def build_materials():
    out = {}
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
        out[name] = m
    return out


# ---------- 基本体：每个都是一个临时物体，坐标就是所属模型的局部坐标 ----------
def link(o):
    bpy.context.scene.collection.objects.link(o)
    return o


def from_bm(bm, name="tmp"):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def orient(p0, p1):
    """局部 Z 轴沿 p0→p1，原点在 p0。"""
    p0, p1 = Vector(p0), Vector(p1)
    z = p1 - p0
    L = z.length
    z.normalize()
    ref = Vector((0, 0, 1)) if abs(z.z) < 0.9 else Vector((1, 0, 0))
    x = ref.cross(z).normalized()
    y = z.cross(x)
    M = Matrix((x, y, z)).transposed().to_4x4()
    M.translation = p0
    return M, L


def ext(p0, p1, e):
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    return tuple(p0 - d * e), tuple(p1 + d * e)


def Box(x0, x1, y0, y1, z0, z1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    M = Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)) @ Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1))
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return from_bm(bm)


def Cyl(p0, p1, r, r2=None, seg=40):
    M, L = orient(p0, p1)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r,
                          radius2=r if r2 is None else r2, depth=L, matrix=M @ Matrix.Translation((0, 0, L / 2)))
    return from_bm(bm)


def Lathe(prof, p0, p1, seg=48):
    """把 (r, h) 轮廓绕 p0→p1 轴转一圈。首尾 r=0 时是实心体，否则当闭合环处理。"""
    M, _ = orient(p0, p1)
    bm = bmesh.new()
    n = len(prof)
    open_ = prof[0][0] == 0 and prof[-1][0] == 0
    rings = []
    for (r, h) in prof:
        if r == 0:
            rings.append([bm.verts.new(M @ Vector((0, 0, h)))])
        else:
            rings.append([bm.verts.new(M @ Vector((r * math.cos(2 * math.pi * j / seg), r * math.sin(2 * math.pi * j / seg), h)))
                          for j in range(seg)])
    pairs = [(i, i + 1) for i in range(n - 1)] + ([] if open_ else [(n - 1, 0)])
    for a, b in pairs:
        A, B = rings[a], rings[b]
        for j in range(seg):
            k = (j + 1) % seg
            if len(A) == 1 and len(B) == 1:
                continue
            if len(A) == 1:
                bm.faces.new((A[0], B[k], B[j]))
            elif len(B) == 1:
                bm.faces.new((A[j], A[k], B[0]))
            else:
                bm.faces.new((A[j], A[k], B[k], B[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return from_bm(bm)


def Prism(poly, a0, a1, plane="xz"):
    """平面多边形拉伸。plane='xz'：多边形在 XZ 面内、沿 Y 从 a0 拉到 a1；'xy'：沿 Z。"""
    bm = bmesh.new()
    def P(u, v, w):
        return (u, w, v) if plane == "xz" else (u, v, w)
    lo = [bm.verts.new(P(u, v, a0)) for u, v in poly]
    hi = [bm.verts.new(P(u, v, a1)) for u, v in poly]
    n = len(poly)
    caps = [bm.faces.new(lo), bm.faces.new(hi)]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.triangulate(bm, faces=caps)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return from_bm(bm)


def Tube(p0, p1, ri, ro, seg=40):
    o = Cyl(p0, p1, ro, seg=seg)
    a, b = ext(p0, p1, 0.0005)
    return boolean(o, [Cyl(a, b, ri, seg=seg)])


def Poly(pts, r, seg=20, caps=True, uv=False):
    """沿折线扫圆截面，转角斜接。uv=True 时 u 沿长度 0→1（网页着色器用）。"""
    P_ = [Vector(p) for p in pts]
    rings, prev_u = [], None
    lens = [0.0]
    for i in range(1, len(P_)):
        lens.append(lens[-1] + (P_[i] - P_[i - 1]).length)
    for i, p in enumerate(P_):
        d0 = (P_[i] - P_[i - 1]).normalized() if i else (P_[1] - P_[0]).normalized()
        d1 = (P_[i + 1] - P_[i]).normalized() if i < len(P_) - 1 else d0
        t = (d0 + d1).normalized()
        if prev_u is None:
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            prev_u = ref.cross(t).normalized()
        u = (prev_u - t * prev_u.dot(t)).normalized()
        w = t.cross(u)
        s = 1 / max(0.3, d0.dot(t))
        rings.append([tuple(p + (u * math.cos(2 * math.pi * a / seg) * s + w * math.sin(2 * math.pi * a / seg)) * r) for a in range(seg)])
        prev_u = u
    v = [q for ring in rings for q in ring]
    f = []
    for i in range(len(rings) - 1):
        for a in range(seg):
            b = (a + 1) % seg
            f.append((i * seg + a, i * seg + b, (i + 1) * seg + b, (i + 1) * seg + a))
    if caps:
        f.append(tuple(reversed(range(seg))))
        f.append(tuple((len(rings) - 1) * seg + a for a in range(seg)))
    me = bpy.data.meshes.new("poly")
    me.from_pydata(v, [], f)
    me.update()
    if uv:
        L = lens[-1]
        uvl = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                uvl.data[li].uv = (lens[vi // seg] / L, (vi % seg) / seg)
    return link(bpy.data.objects.new("poly", me))


def arc(c, r, a0, a1, n, plane="xz"):
    out = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        if plane == "xz":
            out.append((c[0] + r * math.cos(a), c[1], c[2] + r * math.sin(a)))
        else:
            out.append((c[0] + r * math.cos(a), c[1] + r * math.sin(a), c[2]))
    return out


def boolean(o, cutters, op="DIFFERENCE"):
    for c in cutters:
        m = o.modifiers.new("b", "BOOLEAN")
        m.operation = op
        m.solver = "EXACT"
        m.object = c
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    old = o.data
    o.modifiers.clear()
    o.data = me
    bpy.data.meshes.remove(old)
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)
    return o


def merge(objs):
    bm = bmesh.new()
    for o in objs:
        bm.from_mesh(o.data)
    for o in objs:
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.meshes.remove(me)
    return from_bm(bm)


def shell(x0, x1, y0, y1, z0, z1, t):
    """空心盒子（外壳）。"""
    return boolean(Box(x0, x1, y0, y1, z0, z1), [Box(x0 + t, x1 - t, y0 + t, y1 - t, z0 + t, z1 - t)])


# ---------- 部件登记 ----------
PARTS = []


def part(root, name, mat, o, cut="half", smooth=38):
    """cut: 'half' 切掉 y<0；('half', y0) 指定剖切面；'quarter' 切掉 y<0 且 z>0；None 不切。"""
    PARTS.append(dict(root=root, name=name, mat=mat, obj=o, cut=cut, smooth=smooth))
    return o


def port(root, name, p0, p1, ri, ro, nut_r, mat="pfa", nut_mat="nut", nut_frac=(0.35, 0.92), seg=6):
    """接管 + 扩口螺母。p0 在机身面上，p1 是管端。"""
    part(root, name + "_tube", mat, Tube(p0, p1, ri, ro))
    a = Vector(p0).lerp(Vector(p1), nut_frac[0])
    b = Vector(p0).lerp(Vector(p1), nut_frac[1])
    nut = Cyl(tuple(a), tuple(b), nut_r, seg=seg)
    aa, bb = ext(tuple(a), tuple(b), 0.001)
    boolean(nut, [Cyl(aa, bb, ro * 1.01)])
    part(root, name + "_nut", nut_mat, nut)


def head(root, x0, x1, y0, y1, z0, z1, t=0.0015, mat="case", screen=True, led=True, pcb=True):
    """电子部分：外壳 + 电路板 + 顶面显示屏 + 指示灯。"""
    part(root, root + "_head", mat, shell(x0, x1, y0, y1, z0, z1, t))
    if pcb:
        zp = z0 + (z1 - z0) * 0.55
        part(root, root + "_pcb", "pcb", Box(x0 + t + 0.002, x1 - t - 0.002, y0 + t + 0.002, y1 - t - 0.002, zp, zp + 0.0016))
        cx = (x0 + x1) / 2
        part(root, root + "_chip", "chip", Box(cx - 0.006, cx + 0.006, -0.004, 0.006, zp + 0.0016, zp + 0.0032))
    if screen:
        w = min(0.026, (x1 - x0) * 0.32)
        part(root, root + "_screen", "screen", Box(-w, w * 0.4, 0.001, y1 - 0.004, z1, z1 + 0.0008), cut=None)
    if led:
        part(root, root + "_led", "led_g", Box(x1 - 0.012, x1 - 0.008, 0.003, 0.007, z1, z1 + 0.0012), cut=None)


# ======================================================================
# 1. 管内式超声波：声音沿管轴走，换能器装在测量管两端
# ======================================================================
def build_us():
    R = "us"
    ri, rb = 0.004, 0.0105
    xe, xb = 0.0555, 0.050      # 测量管内腔半长、支管位置
    zp = -0.030                  # 进出口高度
    body = Cyl((-0.061, 0, 0), (0.061, 0, 0), rb)
    for s in (-1, 1):
        boolean(body, [Cyl((s * xb, 0, 0.0), (s * xb, 0, zp - 0.0085), 0.0085),
                       Cyl((s * xb, 0, zp), (s * 0.072, 0, zp), 0.0085)], "UNION")
    cutters = [Cyl((-xe, 0, 0), (xe, 0, 0), ri)]
    for s in (-1, 1):
        cutters += [Cyl((s * xb, 0, 0.002), (s * xb, 0, zp - ri), ri), Cyl((s * xb, 0, zp), (s * 0.075, 0, zp), ri)]
    part(R, "us_body", "pfa", boolean(body, cutters))
    for s, tag in ((-1, "a"), (1, "b")):
        cup = Tube((s * 0.061, 0, 0), (s * 0.0745, 0, 0), 0.0052, 0.0078)
        cup = boolean(cup, [Cyl((s * 0.0738, 0, 0), (s * 0.0755, 0, 0), 0.0078)], "UNION")
        part(R, f"us_cup_{tag}", "pfa", cup)
        part(R, f"us_pzt_{tag}", "piezo", Cyl((s * 0.0612, 0, 0), (s * 0.0632, 0, 0), 0.0047))
        part(R, f"us_backing_{tag}", "backing", Cyl((s * 0.0632, 0, 0), (s * 0.0722, 0, 0), 0.0047))
        part(R, f"us_wire_{tag}", "wire_r", Poly([(s * 0.0690, 0.0008, 0.003), (s * 0.0690, 0.0008, 0.0115), (s * 0.058, 0.0008, 0.0235)], 0.0006, seg=8), cut=None)
        port(R, f"us_port_{tag}", (s * 0.072, 0, zp), (s * 0.099, 0, zp), ri, 0.0064, 0.0105)
    case = shell(-0.081, 0.081, -0.019, 0.019, -0.045, 0.036, 0.0018)
    case = boolean(case, [Cyl((-0.09, 0, zp), (-0.075, 0, zp), 0.0067), Cyl((0.075, 0, zp), (0.09, 0, zp), 0.0067)])
    part(R, "us_case", "case", case)
    part(R, "us_pcb", "pcb", Box(-0.066, 0.066, -0.015, 0.015, 0.0235, 0.0251))
    part(R, "us_chip", "chip", Box(-0.012, 0.012, -0.004, 0.008, 0.0251, 0.0268))
    part(R, "us_screen", "screen", Box(-0.028, 0.012, 0.001, 0.015, 0.036, 0.0368), cut=None)
    part(R, "us_led", "led_g", Box(0.050, 0.055, 0.004, 0.009, 0.036, 0.0372), cut=None)
    part(R, "us_gland", "case_dark", Cyl((0.064, 0.008, 0.036), (0.064, 0.008, 0.047), 0.0042), cut=None)
    SPEC[R] = dict(a=[-xe, 0, 0], b=[xe, 0, 0], L=2 * xe, ri=ri, label="管内式超声波")
    PATHS[R] = [[[-0.099, 0, zp, ri], [-xb, 0, zp, ri], [-xb, 0, 0, ri], [xb, 0, 0, ri], [xb, 0, zp, ri], [0.099, 0, zp, ri]]]
    PINS[R] = [("pzt_a", "上游换能器", (-0.0622, 0, 0.0)), ("pzt_b", "下游换能器", (0.0622, 0, 0.0)),
               ("tube", "测量管（PFA）", (0.0, 0.004, ri + 0.001)), ("window", "端壁也是声窗", (0.058, 0.004, -0.006)),
               ("pcb", "计时电路", (0.03, 0.006, 0.0255)), ("port", "进口", (-0.09, 0, zp))]
    VIEWS[R] = dict(target=(0, 0.004, -0.004), dir=(0.18, -1, 0.42), dist=0.30)


# ======================================================================
# 2. 夹装式超声波：夹在管外，V 字声路（声波在对面管壁反射一次）
# ======================================================================
def build_usc():
    R = "usc"
    ri, ro = 0.0048, 0.00635
    part(R, "usc_tube", "pfa", Tube((-0.10, 0, 0), (0.10, 0, 0), ri, ro))
    hd = shell(-0.048, 0.048, -0.016, 0.016, 0.0052, 0.033, 0.0016)
    hd = boolean(hd, [Box(-0.045, 0.045, -0.0138, 0.0138, 0.0045, 0.0075), Cyl((-0.06, 0, 0), (0.06, 0, 0), ro + 0.0002)])
    part(R, "usc_head", "case", hd)
    jaw = boolean(Box(-0.034, 0.034, -0.016, 0.016, -0.017, -0.0045), [Cyl((-0.06, 0, 0), (0.06, 0, 0), ro + 0.0002)])
    part(R, "usc_jaw", "case_dark", jaw)
    for sx in (-1, 1):
        part(R, f"usc_screw_{sx}", "steel", Cyl((sx * 0.027, 0.011, -0.019), (sx * 0.027, 0.011, 0.012), 0.0018, seg=16), cut=None)
    # 楔块：声束在楔块和管壁里斜着走，进管后到底部反射，再斜着回到另一只换能器
    a = 0.012
    d = Vector((a, 0, -2 * ri)).normalized()
    tvec = Vector((-d.z, 0, d.x))  # 斜面方向
    for s, tag in ((-1, "a"), (1, "b")):
        ent = Vector((s * a, 0, ro))
        dd = Vector((-s * d.x * -1, 0, d.z)) if s < 0 else Vector((-d.x, 0, d.z))
        # dd：从楔块指向管子的方向（a 侧向右下，b 侧向左下）
        dd = Vector((d.x, 0, d.z)) if s < 0 else Vector((-d.x, 0, d.z))
        P = ent - dd * 0.0145
        tt = Vector((-dd.z, 0, dd.x))
        e1, e2 = P - tt * 0.0072, P + tt * 0.0072
        if s < 0:
            poly = [(-0.035, 0.0066), (-0.0065, 0.0066), (-0.0065, 0.0215), (max(e1.x, e2.x), max(e1.z, e2.z)),
                    (min(e1.x, e2.x), min(e1.z, e2.z)), (-0.035, 0.0098)]
        else:
            poly = [(0.0065, 0.0066), (0.035, 0.0066), (0.035, 0.0098), (max(e1.x, e2.x), min(e1.z, e2.z)),
                    (min(e1.x, e2.x), max(e1.z, e2.z)), (0.0065, 0.0215)]
        part(R, f"usc_wedge_{tag}", "wedge", Prism(poly, -0.0095, 0.0095))
        part(R, f"usc_pzt_{tag}", "piezo", Cyl(tuple(P), tuple(P - dd * 0.0019), 0.0045))
        part(R, f"usc_backing_{tag}", "backing", Cyl(tuple(P - dd * 0.0019), tuple(P - dd * 0.0075), 0.0045))
    part(R, "usc_pcb", "pcb", Box(-0.042, 0.042, -0.012, 0.012, 0.0262, 0.0278))
    part(R, "usc_chip", "chip", Box(-0.008, 0.008, -0.004, 0.006, 0.0278, 0.0292))
    part(R, "usc_cable", "case_dark", Cyl((0.048, 0.006, 0.020), (0.072, 0.006, 0.020), 0.0032), cut=None)
    part(R, "usc_led", "led_g", Box(0.030, 0.035, 0.004, 0.009, 0.033, 0.0342), cut=None)
    SPEC[R] = dict(p1=[-a, 0, ri], refl=[0, 0, -ri], p2=[a, 0, ri], ri=ri, ro=ro, label="夹装式超声波")
    PATHS[R] = [[[-0.10, 0, 0, ri], [0.10, 0, 0, ri]]]
    PINS[R] = [("pzt_a", "换能器 A", (-0.024, 0, 0.016)), ("pzt_b", "换能器 B", (0.024, 0, 0.016)),
               ("wedge", "楔块：让声束斜着进管", (-0.016, 0.004, 0.009)), ("refl", "管底反射点", (0, 0.003, -ri)),
               ("tube", "原有的 PFA 管，不用切开", (-0.075, 0.003, ro)), ("jaw", "夹具", (0.0, 0.004, -0.012))]
    VIEWS[R] = dict(target=(0, 0.004, 0.006), dir=(0.15, -1, 0.35), dist=0.24)


# ======================================================================
# 3. 卡门涡街：梯形发生体后面交替甩出旋涡，薄壁后的压电片数频率
# ======================================================================
def build_vor():
    R = "vor"
    rb = 0.007
    xs, d = -0.0138, 0.0040
    body = Box(-0.05, 0.05, -0.016, 0.016, -0.016, 0.016)
    xsen = 0.009
    boolean(body, [Cyl((-0.06, 0, 0), (0.06, 0, 0), rb), Cyl((xsen, 0, 0.004), (xsen, 0, 0.02), 0.0030)])
    part(R, "vor_body", "pfa", body)
    poly = [(xs - 0.0022, -d / 2), (xs + 0.0028, -0.0008), (xs + 0.0028, 0.0008), (xs - 0.0022, d / 2)]
    part(R, "vor_shedder", "pvdf", Prism(poly, -0.0076, 0.0076))
    # 检测探头：从垂直安装孔插进去，尖端伸进发生体下游的流里，压电片封在 PFA 套里（参考 SMC US9360354）
    probe = Cyl((xsen, 0, 0.0035), (xsen, 0, 0.0175), 0.0026, seg=32)
    probe = boolean(probe, [Cyl((xsen, 0, 0.0158), (xsen, 0, 0.0175), 0.0045, seg=32)], "UNION")
    probe = boolean(probe, [Cyl((xsen, 0, 0.0050), (xsen, 0, 0.019), 0.0015, seg=24)])
    part(R, "vor_probe", "ptfe", probe)
    part(R, "vor_pzt", "piezo", Box(xsen - 0.0011, xsen + 0.0011, -0.0004, 0.0004, 0.0052, 0.0128))
    part(R, "vor_seal", "pvdf", Lathe([(0.0026, 0.0095), (0.0031, 0.0098), (0.0031, 0.0106), (0.0026, 0.0109)], (xsen, 0, 0), (xsen, 0, 1), seg=32))
    part(R, "vor_wire", "wire_r", Poly([(xsen, 0.0002, 0.0128), (xsen, 0.0002, 0.0195), (0.0, 0.0008, 0.026)], 0.0004, seg=8), cut=None)
    head(R, -0.046, 0.046, -0.016, 0.016, 0.016, 0.040)
    for s, tag in ((-1, "a"), (1, "b")):
        port(R, f"vor_port_{tag}", (s * 0.05, 0, 0), (s * 0.076, 0, 0), rb, 0.0095, 0.0145)
    SPEC[R] = dict(xs=xs, d=d, D=2 * rb, xsen=xsen, label="卡门涡街")
    PATHS[R] = [[[-0.076, 0, 0, rb], [0.076, 0, 0, rb]]]
    PINS[R] = [("shedder", "旋涡发生体", (xs, 0.0, d / 2 + 0.001)), ("probe", "检测探头：尖端伸进流里", (xsen, 0.0, 0.0040)), ("pzt", "压电片（封在 PTFE 套里）", (xsen, 0.0, 0.0115)),
               ("bore", "测量通道", (0.036, 0.003, -rb)), ("pcb", "数频率的电路", (0.02, 0.006, 0.030))]
    VIEWS[R] = dict(target=(0, 0.004, 0.006), dir=(0.15, -1, 0.40), dist=0.24)


# ======================================================================
# 4. 叶轮式：切向射流冲叶轮，叶片里嵌磁铁，霍尔元件隔着壁数脉冲
# ======================================================================
def build_pad():
    R = "pad"
    rc, zj, rj = 0.020, -0.0135, 0.0035
    body = Box(-0.034, 0.034, -0.012, 0.012, -0.034, 0.030)
    boolean(body, [Cyl((0, -0.0085, 0), (0, 0.0085, 0), rc), Cyl((-0.06, 0, zj), (-0.008, 0, zj), rj),
                   Cyl((0.008, 0, zj), (0.06, 0, zj), rj), Cyl((0, 0, 0.0215), (0, 0, 0.033), 0.0032),
                   Cyl((0, 0.0085 - 0.001, 0), (0, 0.0108, 0), 0.0029)])
    part(R, "pad_body", "pfa", body)
    # 转子：轮毂 + 6 片叶片，两片叶片里嵌磁铁；整个转子不切，方便看清楚
    hub = Cyl((0, -0.006, 0), (0, 0.006, 0), 0.0042)
    blades = []
    for i in range(6):
        a = 2 * math.pi * i / 6
        ca, sa = math.cos(a), math.sin(a)
        q = [(0.0035, -0.0008), (0.0178, -0.0008), (0.0178, 0.0008), (0.0035, 0.0008)]
        poly = [(x * ca - y * sa, x * sa + y * ca) for x, y in q]
        blades.append(Prism(poly, -0.0058, 0.0058))
    rotor = boolean(hub, blades, "UNION")
    rotor = boolean(rotor, [Cyl((0, -0.01, 0), (0, 0.01, 0), 0.0012)])
    part(R, "pad_rotor", "pvdf", rotor, cut=None)
    for i, mat in ((0, "mag_n"), (3, "mag_s")):
        a = 2 * math.pi * i / 6
        c = (0.0130 * math.cos(a), 0, 0.0130 * math.sin(a))
        part(R, f"pad_magnet_{i}", mat, Cyl((c[0], -0.0024, c[2]), (c[0], 0.0024, c[2]), 0.0016, seg=20), cut=None)
    part(R, "pad_shaft", "ceramic", Cyl((0, -0.0082, 0), (0, 0.0105, 0), 0.0011, seg=16), cut=None)
    part(R, "pad_bearing", "sapphire", Tube((0, 0.0076, 0), (0, 0.0106, 0), 0.00115, 0.0028, seg=24), cut=None)
    part(R, "pad_hall", "chip", Box(-0.0016, 0.0016, -0.0012, 0.0012, 0.0217, 0.0229), cut=None)
    part(R, "pad_hall_leg", "steel", Box(-0.0010, 0.0010, -0.0003, 0.0003, 0.0229, 0.0318), cut=None)
    head(R, -0.034, 0.034, -0.012, 0.012, 0.030, 0.050)
    for s, tag in ((-1, "a"), (1, "b")):
        port(R, f"pad_port_{tag}", (s * 0.034, 0, zj), (s * 0.060, 0, zj), rj, 0.0060, 0.0095)
    SPEC[R] = dict(rc=rc, zj=zj, rj=rj, rtip=0.0178, rmag=0.0130, blades=6, magnets=2, label="叶轮式")
    PATHS[R] = [[[-0.060, 0, zj, rj], [-0.010, 0, zj, rj], [0.010, 0, zj, rj], [0.060, 0, zj, rj]]]
    SPEC[R]["swirl"] = [list(p) + [0.003] for p in arc((0, 0, 0), 0.0105, -90, 270, 36)]
    PINS[R] = [("rotor", "叶轮（PVDF）", (-0.008, -0.004, 0.012)), ("magnet", "嵌在叶片里的磁铁", (0.013, -0.003, 0.0)),
               ("hall", "霍尔元件（壁外）", (0, 0.0, 0.0225)), ("jet", "进口射流冲叶片下沿", (-0.022, 0.0, zj)),
               ("bearing", "蓝宝石轴承", (0, 0.009, 0.0025)), ("chamber", "叶轮室", (0.016, 0.004, 0.012))]
    VIEWS[R] = dict(target=(0, 0.002, 0.008), dir=(0.12, -1, 0.30), dist=0.25)


# ======================================================================
# 5. 浮子式：锥形管里浮子停在力平衡的高度
# ======================================================================
def build_flt():
    R = "flt"
    z0, z1, r0, r1, ro = -0.075, 0.075, 0.0055, 0.0095, 0.0135
    part(R, "flt_tube", "pfa_clear", Lathe([(r0, z0), (ro, z0), (ro, z1), (r1, z1)], (0, 0, 0), (0, 0, 1), seg=56))
    zi, zo = -0.086, 0.086
    blk = Box(-0.017, 0.017, -0.017, 0.017, -0.097, z0)
    boolean(blk, [Cyl((-0.04, 0, zi), (0, 0, zi), 0.004), Cyl((0, 0, zi - 0.004), (0, 0, z0 + 0.001), r0)])
    part(R, "flt_block_lo", "pfa", blk)
    blk = Box(-0.017, 0.017, -0.017, 0.017, z1, 0.097)
    boolean(blk, [Cyl((0, 0, z1 - 0.001), (0, 0, zo + 0.004), r1), Cyl((0, 0, zo), (0.04, 0, zo), 0.004)])
    part(R, "flt_block_hi", "pfa", blk)
    part(R, "flt_rod", "ptfe", Cyl((0, 0, -0.090), (0, 0, 0.090), 0.0010, seg=16), cut=None)
    zr = -0.068
    prof = [(0.0013, -0.007), (0.0030, -0.0075), (0.0046, -0.0025), (0.0050, 0.0012), (0.0050, 0.0022), (0.0032, 0.0040), (0.0013, 0.0040)]
    part(R, "flt_float", "ptfe", Lathe([(r, h + zr) for r, h in prof], (0, 0, 0), (0, 0, 1), seg=40), cut=None)
    part(R, "flt_float_edge", "accent", Lathe([(0.00495, zr + 0.0012), (0.00512, zr + 0.0012), (0.00512, zr + 0.0022), (0.00495, zr + 0.0022)],
                                               (0, 0, 0), (0, 0, 1), seg=40), cut=None)
    part(R, "flt_stop", "ptfe", Tube((0, 0, -0.0765), (0, 0, -0.0748), 0.0011, 0.0034, seg=24), cut=None)
    part(R, "flt_scale", "panel_grey", Box(-0.0135, 0.0135, 0.0172, 0.0192, z0, z1), cut=None)
    for i in range(13):
        z = -0.060 + i * 0.010
        w = 0.0075 if i % 2 == 0 else 0.0045
        part(R, f"flt_tick_{i}", "tick", Box(-w, w, 0.0164, 0.0172, z - 0.0004, z + 0.0004), cut=None)
    part(R, "flt_rail", "case_dark", Box(0.0140, 0.0175, 0.003, 0.016, z0, z1), cut=None)
    part(R, "flt_switch", "case_dark", Box(0.0140, 0.0235, -0.004, 0.010, -0.036, -0.024), cut=None)
    part(R, "flt_switch_led", "led_a", Box(0.0235, 0.0242, -0.002, 0.002, -0.032, -0.028), cut=None)
    port(R, "flt_port_a", (-0.017, 0, zi), (-0.044, 0, zi), 0.004, 0.0064, 0.0105)
    port(R, "flt_port_b", (0.017, 0, zo), (0.044, 0, zo), 0.004, 0.0064, 0.0105)
    # 闭合轮廓绕一圈求体积（含中心导杆孔那条边，孔自动扣掉）
    vol = 0.0
    for (ra, ha), (rb_, hb) in zip(prof, prof[1:] + prof[:1]):
        vol += math.pi * (hb - ha) * (ra * ra + ra * rb_ + rb_ * rb_) / 3
    vol = abs(vol)
    SPEC[R] = dict(z0=z0, z1=z1, r0=r0, r1=r1, rf=0.0050, rrod=0.0010, zrest=zr, zmax=0.062, vol=vol, rho_f=2150,
                   switch_z=-0.030, ticks=[-0.060 + i * 0.010 for i in range(13)], label="浮子式")
    PATHS[R] = [[[-0.044, 0, zi, 0.004], [0, 0, zi, 0.004], [0, 0, z0, r0], [0, 0, z1, r1], [0, 0, zo, 0.004], [0.044, 0, zo, 0.004]]]
    PINS[R] = [("float", "浮子（读上沿）", (0.006, 0, zr + 0.002)), ("tube", "锥形 PFA 管：越往上越粗", (-0.012, 0.0, 0.03)),
               ("rod", "导杆", (0.0, 0.0, 0.045)), ("switch", "下限报警开关", (0.024, 0.004, -0.030)), ("scale", "刻度", (-0.011, 0.0164, 0.06))]
    VIEWS[R] = dict(target=(0, 0.004, 0.0), dir=(0.22, -1, 0.18), dist=0.44)


# ======================================================================
# 6. 差压式：孔板前后两个隔膜压力传感器
# ======================================================================
def build_dp():
    R = "dp"
    rb, ro_ = 0.005, 0.0013
    xt = 0.026
    body = Box(-0.060, 0.060, -0.016, 0.016, -0.016, 0.012)
    cut = [Cyl((-0.07, 0, 0), (0.07, 0, 0), rb), Cyl((-0.0016, 0, 0), (0.0016, 0, 0), 0.0073)]
    for s in (-1, 1):
        cut += [Cyl((s * xt, 0, 0), (s * xt, 0, 0.0095), 0.0022), Cyl((s * xt, 0, 0.0085), (s * xt, 0, 0.02), 0.0086)]
    part(R, "dp_body", "pfa", boolean(body, cut))
    part(R, "dp_orifice", "pvdf", Tube((-0.0015, 0, 0), (0.0015, 0, 0), ro_, 0.0072))
    for s, tag in ((-1, "a"), (1, "b")):
        x = s * xt
        part(R, f"dp_diaphragm_{tag}", "sapphire", Cyl((x, 0, 0.0090), (x, 0, 0.0098), 0.0083))
        sb = boolean(Cyl((x, 0, 0.0098), (x, 0, 0.0262), 0.0083), [Cyl((x, 0, 0.0097), (x, 0, 0.0235), 0.0062)])
        part(R, f"dp_sensor_{tag}", "ceramic", sb)
        part(R, f"dp_gauge_{tag}", "chip", Box(x - 0.003, x + 0.003, -0.002, 0.002, 0.0098, 0.0106))
        part(R, f"dp_seal_{tag}", "rubber", Tube((x, 0, 0.0086), (x, 0, 0.0091), 0.0060, 0.0083))
        port(R, f"dp_port_{tag}", (s * 0.060, 0, 0), (s * 0.086, 0, 0), rb, 0.0075, 0.012)
    head(R, -0.060, 0.060, -0.016, 0.016, 0.012, 0.040)
    D, dd = 2 * rb, 2 * ro_
    SPEC[R] = dict(xt=xt, D=D, d=dd, beta=dd / D, label="差压式")
    PATHS[R] = [[[-0.086, 0, 0, rb], [-0.004, 0, 0, rb], [-0.0015, 0, 0, ro_ * 1.05], [0.0015, 0, 0, ro_ * 1.0],
                 [0.006, 0, 0, ro_ * 1.25], [0.018, 0, 0, rb * 0.85], [0.030, 0, 0, rb], [0.086, 0, 0, rb]]]
    PINS[R] = [("orifice", "孔板（节流）", (0.0, 0.0, ro_ + 0.002)), ("p1", "上游压力传感器", (-xt, 0, 0.0115)),
               ("p2", "下游压力传感器", (xt, 0, 0.0115)), ("diaphragm", "蓝宝石隔膜：只有它碰药液", (-xt + 0.006, 0.002, 0.0094)),
               ("tap", "取压孔", (xt, 0.0, 0.006))]
    VIEWS[R] = dict(target=(0, 0.004, 0.006), dir=(0.15, -1, 0.40), dist=0.27)


# ======================================================================
# 7. 热式质量流量控制器（N2）：旁路毛细管 + 两个绕组 + 层流元件 + 压电阀
# ======================================================================
def build_thm():
    R = "thm"
    zc, rc = -0.011, 0.0038
    xs, xo = 0.039, 0.0445       # 阀座、出口孔
    xi_t, xo_t = -0.040, 0.012   # 毛细管取气点、回气点
    zcap = 0.012
    body = Box(-0.062, 0.062, -0.012, 0.012, -0.022, 0.0)
    cut = [Cyl((-0.075, 0, zc), (xs, 0, zc), rc), Cyl((xs, 0, zc - rc), (xs, 0, 0.001), 0.0012),
           Cyl((xo, 0, zc - rc), (xo, 0, 0.001), 0.0012), Cyl((xo - 0.0012, 0, zc), (0.075, 0, zc), rc),
           Cyl((xs, 0, -0.0012), (xs, 0, 0.002), 0.0080),
           Cyl((xi_t, 0, zc), (xi_t, 0, 0.001), 0.0009), Cyl((xo_t, 0, zc), (xo_t, 0, 0.001), 0.0009)]
    part(R, "thm_body", "steel", boolean(body, cut))
    lfe = Cyl((-0.028, 0, zc), (0.004, 0, zc), rc - 0.0001)
    holes = [Cyl((-0.03, 0, zc), (0.006, 0, zc), 0.0009, seg=16)]
    for i in range(6):
        a = math.pi / 6 + i * math.pi / 3
        holes.append(Cyl((-0.03, 0.0021 * math.cos(a), zc + 0.0021 * math.sin(a)), (0.006, 0.0021 * math.cos(a), zc + 0.0021 * math.sin(a)), 0.0009, seg=16))
    part(R, "thm_lfe", "steel_dark", boolean(lfe, holes))
    # 阀
    vb = boolean(Box(0.026, 0.054, -0.012, 0.012, 0.0, 0.0095), [Cyl((xs, 0, -0.001), (xs, 0, 0.0045), 0.0080), Cyl((xs, 0, 0.004), (xs, 0, 0.01), 0.0030)])
    part(R, "thm_valve_block", "steel", vb)
    part(R, "thm_diaphragm", "steel", Cyl((xs, 0, 0.0040), (xs, 0, 0.0052), 0.0079))
    part(R, "thm_plug", "steel_dark", Cyl((xs, 0, 0.0014), (xs, 0, 0.0040), 0.0021, seg=24))
    part(R, "thm_plunger", "steel_dark", Cyl((xs, 0, 0.0052), (xs, 0, 0.0085), 0.0028, seg=24))
    # 压电叠堆：通电伸长几十微米，隔着金属隔膜把阀芯压向阀座（参考 Horiba US8219329）
    for i in range(14):
        z = 0.0088 + i * 0.00155
        part(R, f"thm_stack_{i}", "piezo" if i % 2 == 0 else "electrode", Cyl((xs, 0, z), (xs, 0, z + 0.00155), 0.0052, seg=32))
    hs = boolean(Cyl((xs, 0, 0.0095), (xs, 0, 0.0335), 0.0090), [Cyl((xs, 0, 0.0094), (xs, 0, 0.0318), 0.0068)])
    part(R, "thm_stack_case", "steel_dark", hs)
    # 传感毛细管（放大画）：取一小股气，绕两组线圈
    cap_pts = [(xi_t, 0, -0.004), (xi_t, 0, zcap), (xo_t, 0, zcap), (xo_t, 0, -0.004)]
    capo = Poly(cap_pts, 0.0008, seg=24)
    capi = Poly([(xi_t, 0, -0.0046), (xi_t, 0, zcap), (xo_t, 0, zcap), (xo_t, 0, -0.0046)], 0.00052, seg=24)
    part(R, "thm_capillary", "steel", boolean(capo, [capi]))
    part(R, "thm_heat", "heat", Poly([(xi_t + 0.004, 0, zcap), (xo_t - 0.004, 0, zcap)], 0.00046, seg=16, uv=True), cut=None)
    xm = -0.014
    coils = [(xm - 0.0085, xm - 0.0012), (xm + 0.0012, xm + 0.0085)]
    for i, (a, b) in enumerate(coils):
        part(R, f"thm_winding_{'ud'[i]}", "copper", Lathe([(0.00082, a), (0.00165, a), (0.00165, b), (0.00082, b)], (0, 0, zcap), (1, 0, zcap), seg=32))
    part(R, "thm_sensor_cover", "steel_dark", shell(-0.050, 0.020, -0.010, 0.010, 0.0, 0.021, 0.0012))
    part(R, "thm_cover", "case", shell(-0.064, 0.064, -0.0135, 0.0135, -0.0005, 0.068, 0.0012))
    part(R, "thm_pcb", "pcb", Box(-0.060, 0.060, -0.011, 0.011, 0.040, 0.0416))
    part(R, "thm_chip", "chip", Box(-0.020, -0.004, -0.004, 0.006, 0.0416, 0.0432))
    part(R, "thm_dsub", "case_dark", Box(-0.022, 0.012, -0.0065, 0.0065, 0.068, 0.0765))
    part(R, "thm_led", "led_g", Box(0.040, 0.045, 0.003, 0.008, 0.068, 0.0692), cut=None)
    for s, tag in ((-1, "a"), (1, "b")):
        port(R, f"thm_port_{tag}", (s * 0.062, 0, zc), (s * 0.090, 0, zc), 0.0030, 0.0048, 0.0098, mat="steel", nut_mat="steel", nut_frac=(0.22, 0.62))
    SPEC[R] = dict(zc=zc, rc=rc, cap=[list(p) for p in cap_pts], zcap=zcap, xm=xm, coils=coils, xs=xs,
                   heat=[xi_t + 0.004, xo_t - 0.004], lfe=[-0.028, 0.004], label="热式 MFC")
    PATHS[R] = [[[-0.090, 0, zc, rc], [-0.030, 0, zc, rc], [0.006, 0, zc, rc], [xs, 0, zc, rc * 0.9], [xs, 0, 0.0005, 0.0011],
                 [xo, 0, 0.0005, 0.0011], [xo, 0, zc, 0.0012], [0.090, 0, zc, rc]],
                [[xi_t, 0, zc, 0.0004], [xi_t, 0, zcap, 0.0004], [xo_t, 0, zcap, 0.0004], [xo_t, 0, zc, 0.0004]]]
    PINS[R] = [("cap", "传感毛细管（放大画）", (xi_t, 0.0, 0.006)), ("coil_u", "上游绕组", (coils[0][0] + 0.003, 0, zcap + 0.0018)),
               ("coil_d", "下游绕组", (coils[1][1] - 0.003, 0, zcap + 0.0018)), ("lfe", "层流元件（主流走这里）", (-0.012, 0.0, zc + rc)),
               ("valve", "压电阀（叠堆推隔膜）", (xs + 0.0055, 0.0, 0.022)), ("seat", "阀座", (xs, 0, 0.0012)), ("pcb", "控制电路", (0.03, 0.006, 0.0418))]
    VIEWS[R] = dict(target=(0, 0.004, 0.018), dir=(0.15, -1, 0.35), dist=0.29)


# ======================================================================
# 8. 科里奥利：双 U 管反相振动，有流量时两条腿的相位错开
# ======================================================================
def build_cor():
    R = "cor"
    xl, yt, za, rr = 0.024, 0.0095, -0.072, 0.024
    zt = 0.012
    man = Box(-0.042, 0.042, -0.020, 0.020, 0.0, 0.026)
    cut = []
    for s in (-1, 1):
        cut += [Cyl((s * 0.07, 0, zt), (s * xl, 0, zt), 0.0040), Cyl((s * xl, -yt - 0.002, zt), (s * xl, yt + 0.002, zt), 0.0032)]
        for ty in (-yt, yt):
            cut.append(Cyl((s * xl, ty, zt), (s * xl, ty, -0.002), 0.0028))
    part(R, "cor_manifold", "pfa", boolean(man, cut))
    U = [(-xl, 0, 0.002)] + arc((0, 0, za), rr, 180, 360, 28) + [(xl, 0, 0.002)]
    U[1] = (-xl, 0, za)
    for tag, ty in (("A", -yt), ("B", yt)):
        pts = [(x, ty, z) for x, _, z in U]
        o = Poly(pts, 0.0031, seg=24)
        if tag == "A":
            boolean(o, [Poly(pts, 0.0021, seg=24)])
            part(R, f"cor_tube{tag}", "pfa", o, cut=("half", ty))
        else:
            part(R, f"cor_tube{tag}", "pfa", o, cut=None)
        for s in (-1, 1):
            part(R, f"cor_node{tag}_{s}", "pvdf", Box(s * xl - 0.006, s * xl + 0.006, ty - 0.0045 if tag == "A" else ty - 0.0045,
                                                         ty + 0.0045, -0.0135, -0.0115), cut=None)
    zap = za - rr
    # 驱动器在 U 管底部；拾振器在两条腿上。线圈装在 A 管，磁铁装在 B 管
    def pair(name, x, z):
        part(R, f"cor_{name}_coilA", "copper", Cyl((x, -yt + 0.0031, z), (x, -0.0004, z), 0.0034, seg=24), cut=None)
        part(R, f"cor_{name}_magB", "mag_n", Cyl((x, 0.0006, z), (x, yt - 0.0029, z), 0.0018, seg=20), cut=None)
    pair("drv", 0.0, zap)
    zpo = -0.052
    pair("poIn", -xl, zpo)
    pair("poOut", xl, zpo)
    part(R, "cor_case", "case", shell(-0.050, 0.050, -0.024, 0.024, -0.112, 0.0005, 0.0015))
    head(R, -0.036, 0.036, -0.020, 0.020, 0.026, 0.056)
    for s, tag in ((-1, "a"), (1, "b")):
        port(R, f"cor_port_{tag}", (s * 0.042, 0, zt), (s * 0.068, 0, zt), 0.0040, 0.0064, 0.0110)
    SPEC[R] = dict(xl=xl, yt=yt, za=za, rr=rr, zap=zap, znode=-0.0125, zpo=zpo, label="科里奥利")
    UA = [[x, -yt, z, 0.0019] for x, _, z in U]
    UB = [[x, yt, z, 0.0019] for x, _, z in U]
    PATHS[R] = [[[-0.068, 0, zt, 0.004], [-xl, -yt, zt, 0.0019]] + UA + [[xl, -yt, zt, 0.0019], [0.068, 0, zt, 0.004]],
                [[-0.068, 0, zt, 0.004], [-xl, yt, zt, 0.0019]] + UB + [[xl, yt, zt, 0.0019], [0.068, 0, zt, 0.004]]]
    PINS[R] = [("drv", "驱动器（让管子振起来）", (0.0, -0.004, zap - 0.004)), ("poIn", "进口侧拾振器", (-xl - 0.004, -0.004, zpo)),
               ("poOut", "出口侧拾振器", (xl + 0.004, -0.004, zpo)), ("tube", "测量管：一对 PFA U 管", (-0.036, -yt, -0.08)),
               ("node", "节点板：振动从这里往下才有", (xl + 0.007, -0.002, -0.0125)), ("manifold", "分流块", (-0.03, 0.0, 0.020))]
    VIEWS[R] = dict(target=(0, 0.0, -0.035), dir=(0.30, -1, 0.30), dist=0.34)


# ======================================================================
# 9. 电磁：上下线圈产生磁场，导电液体切割磁场，左右电极上出电压
# ======================================================================
def build_mag():
    R = "mag"
    Ri = 0.0125
    tube = Tube((-0.050, 0, 0), (0.050, 0, 0), 0.0145, 0.0160)
    liner = Tube((-0.0595, 0, 0), (0.0595, 0, 0), Ri, 0.0145)
    for s in (-1, 1):
        liner = boolean(liner, [Tube((s * 0.058, 0, 0), (s * 0.0595, 0, 0), 0.0130, 0.026)], "UNION")
    ecut = [Cyl((0, -0.03, 0), (0, 0.03, 0), 0.0017, seg=16)]
    part(R, "mag_tube", "steel", boolean(tube, [Cyl((0, -0.03, 0), (0, 0.03, 0), 0.0017, seg=16)]), cut="quarter")
    part(R, "mag_liner", "pfa", boolean(liner, ecut), cut="quarter")
    for s, tag in ((-1, "a"), (1, "b")):
        fl = Tube((s * 0.050, 0, 0), (s * 0.058, 0, 0), 0.0145, 0.036)
        holes = [Cyl((s * 0.045, 0.029 * math.cos(a), 0.029 * math.sin(a)), (s * 0.063, 0.029 * math.cos(a), 0.029 * math.sin(a)), 0.003, seg=16)
                 for a in (math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4)]
        part(R, f"mag_flange_{tag}", "steel", boolean(fl, holes), cut="quarter")
    for s, tag in ((1, "top"), (-1, "bot")):
        sh = Tube((-0.030, 0, 0), (0.030, 0, 0), 0.0166, 0.0226)
        sh = boolean(sh, [Box(-0.04, 0.04, -0.04, 0.04, -0.04 if s > 0 else 0.0, 0.0 if s > 0 else 0.04),
                          Box(-0.04, 0.04, -0.04, -0.0135, -0.04, 0.04), Box(-0.04, 0.04, 0.0135, 0.04, -0.04, 0.04)])
        sh = boolean(sh, [Box(-0.022, 0.022, -0.0068, 0.0068, -0.03, 0.03)])
        part(R, f"mag_coil_{tag}", "copper", sh, cut="quarter")
        core = Tube((-0.020, 0, 0), (0.020, 0, 0), 0.0162, 0.0232)
        core = boolean(core, [Box(-0.03, 0.03, -0.04, 0.04, -0.04 if s > 0 else 0.0, 0.0 if s > 0 else 0.04),
                              Box(-0.03, 0.03, -0.04, -0.0060, -0.04, 0.04), Box(-0.03, 0.03, 0.0060, 0.04, -0.04, 0.04)])
        part(R, f"mag_core_{tag}", "ferrite", core, cut="quarter")
    part(R, "mag_yoke", "steel_dark", Tube((-0.036, 0, 0), (0.036, 0, 0), 0.0262, 0.0290), cut="quarter")
    for s, tag in ((-1, "a"), (1, "b")):
        e = Cyl((0, s * 0.0120, 0), (0, s * 0.0215, 0), 0.0015, seg=20)
        e = boolean(e, [Cyl((0, s * 0.0121, 0), (0, s * 0.0131, 0), 0.0027, seg=24)], "UNION")
        part(R, f"mag_electrode_{tag}", "electrode", e, cut="quarter")
        part(R, f"mag_ewire_{tag}", "wire_r", Poly([(0.0, s * 0.0215, 0), (0.0, s * 0.0245, 0.0), (0.0, s * 0.0245, 0.026), (0.0, s * 0.006, 0.034)], 0.0006, seg=8), cut="quarter")
    part(R, "mag_case", "paint", Tube((-0.040, 0, 0), (0.040, 0, 0), 0.0305, 0.0322), cut="quarter")
    part(R, "mag_neck", "paint", Cyl((0, 0, 0.030), (0, 0, 0.038), 0.010), cut="quarter")
    head(R, -0.026, 0.026, -0.022, 0.022, 0.038, 0.066)
    SPEC[R] = dict(D=2 * Ri, Ri=Ri, coil=[0.0166, 0.0226], ex=0.0, label="电磁式")
    PATHS[R] = [[[-0.075, 0, 0, Ri], [0.075, 0, 0, Ri]]]
    PINS[R] = [("coil", "励磁线圈（上下各一个）", (0.024, -0.010, 0.020)), ("electrode", "电极（左右各一个）", (0.0, -0.0128, -0.0018)),
               ("liner", "PFA 内衬：管子本身不导电", (-0.042, -0.009, -0.0105)), ("yoke", "磁轭：让磁力线回去", (-0.030, -0.018, -0.020)),
               ("flange", "法兰", (0.054, -0.026, -0.010))]
    VIEWS[R] = dict(target=(0, 0.0, 0.004), dir=(0.40, -1, 0.55), dist=0.30)


# ======================================================================
# 10. 虚构的湿法清洗台：标出每种流量计一般装在哪
# ======================================================================
BENCH_METERS = {}


def pipe(name, pts, r, mat="pipe", band=None):
    part("bench", name, mat, Poly(pts, r, seg=16), cut=None, smooth=50)
    if band:
        # 每隔一段画一圈色环，表示这条管里走的是什么
        P_ = [Vector(p) for p in pts]
        acc = 0.0
        for a, b in zip(P_, P_[1:]):
            L = (b - a).length
            n = int(L / 0.22)
            for i in range(n):
                c = a.lerp(b, (i + 0.5) / max(n, 1))
                d = (b - a).normalized()
                part("bench", name + f"_band{len(PARTS)}", band, Cyl(tuple(c - d * 0.008), tuple(c + d * 0.008), r * 1.18, seg=16), cut=None)
            acc += L


def mini(kind, label, c, axis="x", size=1.0, band="band_diw", note=""):
    """机台图里的流量计：一个简化的方块 + 表头。"""
    cx, cy, cz = c
    s = size
    if axis == "x":
        part("bench", f"bm_{kind}_body", "pfa", Box(cx - 0.045 * s, cx + 0.045 * s, cy - 0.028 * s, cy + 0.028 * s, cz - 0.026 * s, cz + 0.026 * s), cut=None)
        part("bench", f"bm_{kind}_head", "case", Box(cx - 0.040 * s, cx + 0.040 * s, cy - 0.028 * s, cy + 0.028 * s, cz + 0.026 * s, cz + 0.060 * s), cut=None)
        part("bench", f"bm_{kind}_screen", "screen", Box(cx - 0.026 * s, cx + 0.010 * s, cy - 0.0285 * s, cy - 0.027 * s, cz + 0.034 * s, cz + 0.054 * s), cut=None)
        part("bench", f"bm_{kind}_tag", band, Box(cx + 0.016 * s, cx + 0.034 * s, cy - 0.0288 * s, cy - 0.027 * s, cz + 0.036 * s, cz + 0.052 * s), cut=None)
        top = (cx, cy, cz + 0.064 * s)
    else:
        part("bench", f"bm_{kind}_body", "pfa", Box(cx - 0.026 * s, cx + 0.026 * s, cy - 0.028 * s, cy + 0.028 * s, cz - 0.045 * s, cz + 0.045 * s), cut=None)
        part("bench", f"bm_{kind}_head", "case", Box(cx + 0.026 * s, cx + 0.060 * s, cy - 0.028 * s, cy + 0.028 * s, cz - 0.040 * s, cz + 0.040 * s), cut=None)
        part("bench", f"bm_{kind}_screen", "screen", Box(cx + 0.032 * s, cx + 0.054 * s, cy - 0.0285 * s, cy - 0.027 * s, cz - 0.010 * s, cz + 0.026 * s), cut=None)
        part("bench", f"bm_{kind}_tag", band, Box(cx + 0.034 * s, cx + 0.052 * s, cy - 0.0288 * s, cy - 0.027 * s, cz - 0.030 * s, cz - 0.016 * s), cut=None)
        top = (cx + 0.043 * s, cy, cz + 0.044 * s)
    BENCH_METERS[kind] = dict(label=label, pos=list(top), note=note)


def build_bench():
    R = "bench"
    # 机柜（前面板拿掉，看得见里面的管路）
    part(R, "b_plinth", "plinth", Box(-0.92, 0.92, 0.0, 0.66, 0.0, 0.05), cut=None)
    part(R, "b_back", "panel", Box(-0.90, 0.90, 0.635, 0.65, 0.05, 1.55), cut=None)
    for x in (-0.90, 0.885):
        part(R, f"b_side{x}", "panel", Box(x, x + 0.015, 0.0, 0.65, 0.05, 0.78), cut=None)
    part(R, "b_floor", "panel_grey", Box(-0.885, 0.885, 0.0, 0.635, 0.05, 0.065), cut=None)
    part(R, "b_deck", "panel", Box(-0.90, 0.90, 0.0, 0.65, 0.765, 0.78), cut=None)
    part(R, "b_hood", "panel", Box(-0.90, 0.90, 0.45, 0.65, 1.50, 1.56), cut=None)
    part(R, "b_exhaust", "panel_grey", Box(-0.90, 0.90, 0.60, 0.635, 0.80, 0.86), cut=None)
    for x in (-0.90, 0.885):
        part(R, f"b_post{x}", "panel", Box(x, x + 0.015, 0.45, 0.65, 0.78, 1.50), cut=None)
    # 槽：内槽石英，外面一圈溢流槽
    part(R, "b_tank_in", "quartz", shell(-0.24, 0.24, 0.12, 0.48, 0.80, 1.22, 0.008), cut=None)
    part(R, "b_tank_out", "pfa_clear", boolean(Box(-0.29, 0.29, 0.07, 0.53, 0.78, 1.16), [Box(-0.282, 0.282, 0.078, 0.522, 0.788, 1.2)]), cut=None)
    part(R, "b_water", "water", Box(-0.232, 0.232, 0.128, 0.472, 0.808, 1.214), cut=None)
    part(R, "b_water_out", "water", Box(-0.282, 0.282, 0.078, 0.522, 0.788, 0.83), cut=None)
    part(R, "b_diffuser", "quartz", Box(-0.232, 0.232, 0.128, 0.472, 0.84, 0.846), cut=None)
    wafers = [Cyl((x - 0.0008, 0.30, 1.0), (x + 0.0008, 0.30, 1.0), 0.15, seg=48) for x in [-0.144 + 0.012 * i for i in range(25)]]
    part(R, "b_wafers", "wafer", merge(wafers), cut=None)
    for y, z in ((0.20, 0.88), (0.40, 0.88), (0.30, 0.855)):
        part(R, f"b_guide{y}{z}", "quartz", Cyl((-0.20, y, z), (0.20, y, z), 0.008, seg=16), cut=None)

    # --- 管路 ---
    # DIW 主供水：左侧进 → 阀 → 过滤器 → 超声波 → 混药三通 → 槽底（上升流）
    diw = [(-0.92, 0.22, 0.58), (0.0, 0.22, 0.58), (0.0, 0.22, 0.70), (0.0, 0.30, 0.70), (0.0, 0.30, 0.842)]
    pipe("b_diw", diw, 0.0095, band="band_diw")
    mini("us", "超声波（DIW 主供水）", (-0.42, 0.22, 0.58), band="band_diw", note="DIW 不导电、要零颗粒：常用超声波或卡门涡街")
    part(R, "b_filter", "pfa", Cyl((-0.62, 0.22, 0.52), (-0.62, 0.22, 0.70), 0.045, seg=32), cut=None)
    part(R, "b_filter_cap", "valve", Cyl((-0.62, 0.22, 0.70), (-0.62, 0.22, 0.725), 0.048, seg=32), cut=None)
    part(R, "b_v1", "valve", Box(-0.79, -0.73, 0.18, 0.26, 0.60, 0.65), cut=None)
    # 药液 A：差压式流量控制器，按比例打进 DIW
    ca = [(-0.92, 0.22, 0.42), (-0.24, 0.22, 0.42), (-0.24, 0.22, 0.58)]
    pipe("b_chemA", ca, 0.006, band="band_chem")
    mini("dp", "差压式流量控制器（药液 A）", (-0.55, 0.22, 0.42), size=0.85, band="band_chem", note="小流量、要能调：孔板 + 两个压力传感器 + 阀")
    # 药液 B：夹装式超声波
    cb = [(-0.92, 0.34, 0.32), (-0.16, 0.34, 0.32), (-0.16, 0.34, 0.50), (-0.16, 0.22, 0.50), (-0.16, 0.22, 0.58)]
    pipe("b_chemB", cb, 0.006, band="band_chem")
    part(R, "bm_usc_body", "case", Box(-0.385, -0.295, 0.315, 0.365, 0.332, 0.362), cut=None)
    part(R, "bm_usc_jaw", "case_dark", Box(-0.370, -0.310, 0.315, 0.365, 0.298, 0.312), cut=None)
    BENCH_METERS["usc"] = dict(label="夹装式超声波（药液 B）", pos=[-0.34, 0.34, 0.366], note="管子不用切开，夹上去就能测")
    # 喷淋支路：叶轮式
    sh = [(-0.80, 0.22, 0.58), (-0.80, 0.12, 0.58), (-0.80, 0.12, 1.32), (-0.30, 0.12, 1.32), (-0.30, 0.30, 1.32), (0.26, 0.30, 1.32)]
    pipe("b_shower", sh, 0.006, band="band_diw")
    for x in [-0.22 + 0.055 * i for i in range(9)]:
        part(R, f"b_nozzle{x:.2f}", "pfa", Cyl((x, 0.30, 1.32), (x, 0.30, 1.29), 0.008, r2=0.004, seg=12), cut=None)
    mini("pad", "叶轮式（喷淋支路）", (-0.80, 0.12, 0.68), axis="z", size=0.8, band="band_diw", note="便宜、读数直观，但有转动件")
    # 常流（防止死水）：浮子式
    bl = [(-0.68, 0.22, 0.58), (-0.68, 0.22, 0.20), (-0.68, 0.10, 0.20), (-0.68, 0.10, 0.52), (-0.56, 0.10, 0.52), (-0.56, 0.10, 0.12),
          (-0.56, 0.45, 0.12), (0.80, 0.45, 0.12), (0.80, 0.45, 0.0)]
    pipe("b_bleed", bl, 0.005, band="band_ret")
    part(R, "bm_flt_tube", "pfa_clear", Cyl((-0.68, 0.10, 0.28), (-0.68, 0.10, 0.46), 0.016, seg=24), cut=None)
    part(R, "bm_flt_float", "accent", Cyl((-0.68, 0.10, 0.33), (-0.68, 0.10, 0.345), 0.011, seg=24), cut=None)
    part(R, "bm_flt_blk", "pfa", Box(-0.70, -0.66, 0.08, 0.12, 0.26, 0.28), cut=None)
    part(R, "bm_flt_blk2", "pfa", Box(-0.70, -0.66, 0.08, 0.12, 0.46, 0.48), cut=None)
    BENCH_METERS["flt"] = dict(label="浮子式（常流排放）", pos=[-0.68, 0.08, 0.25], note="不用电，一眼看出在流")
    # 循环：溢流 → 泵 → 加热器 → 过滤器 → 卡门涡街 → 槽底
    ci = [(0.27, 0.48, 0.79), (0.27, 0.48, 0.55), (0.53, 0.48, 0.55), (0.53, 0.48, 0.24)]
    co = [(0.63, 0.48, 0.16), (0.74, 0.48, 0.16), (0.74, 0.48, 0.40), (0.74, 0.40, 0.40), (0.74, 0.40, 0.66), (0.12, 0.40, 0.66),
          (0.12, 0.30, 0.66), (0.12, 0.30, 0.842)]
    pipe("b_circ_in", ci, 0.0095, band="band_ret")
    pipe("b_circ_out", co, 0.0095, band="band_ret")
    part(R, "b_pump", "pump", Box(0.47, 0.65, 0.40, 0.56, 0.07, 0.24), cut=None)
    part(R, "b_pump_head", "pfa", Cyl((0.56, 0.48, 0.24), (0.56, 0.48, 0.30), 0.05, seg=32), cut=None)
    part(R, "b_heater", "steel", Cyl((0.74, 0.48, 0.20), (0.74, 0.48, 0.36), 0.035, seg=32), cut=None)
    part(R, "b_cfilter", "pfa", Cyl((0.74, 0.40, 0.44), (0.74, 0.40, 0.62), 0.045, seg=32), cut=None)
    mini("vor", "卡门涡街（循环回路）", (0.42, 0.40, 0.66), band="band_ret", note="没有转动件，热液也能用")
    # N2：热式 MFC → 槽底鼓泡管
    n2 = [(0.92, 0.18, 0.42), (0.20, 0.18, 0.42), (0.20, 0.18, 0.835), (-0.20, 0.18, 0.835)]
    pipe("b_n2", n2, 0.004, mat="steel", band="band_n2")
    mini("thm", "热式 MFC（N2 鼓泡）", (0.60, 0.18, 0.42), size=0.75, band="band_n2", note="气体按质量计：热式最常见")
    # 排液
    pipe("b_drain", [(-0.12, 0.40, 0.80), (-0.12, 0.40, 0.25), (-0.12, 0.45, 0.25), (-0.12, 0.45, 0.12)], 0.0095, band="band_ret")
    part(R, "b_drain_valve", "valve", Box(-0.15, -0.09, 0.37, 0.43, 0.46, 0.52), cut=None)
    # 药液调配柜（厂务侧）：科里奥利 + 电磁
    X0 = 1.05
    part(R, "c_plinth", "plinth", Box(X0, X0 + 0.55, 0.0, 0.66, 0.0, 0.05), cut=None)
    part(R, "c_back", "panel", Box(X0, X0 + 0.55, 0.635, 0.65, 0.05, 1.55), cut=None)
    part(R, "c_side", "panel", Box(X0 + 0.535, X0 + 0.55, 0.0, 0.65, 0.05, 1.55), cut=None)
    part(R, "c_top", "panel", Box(X0, X0 + 0.55, 0.0, 0.65, 1.50, 1.56), cut=None)
    part(R, "c_tank", "pfa_clear", Cyl((1.32, 0.38, 0.86), (1.32, 0.38, 1.30), 0.15, seg=48), cut=None)
    part(R, "c_liquid", "water", Cyl((1.32, 0.38, 0.87), (1.32, 0.38, 1.12), 0.145, seg=48), cut=None)
    cc = [(1.62, 0.18, 0.55), (1.20, 0.18, 0.55), (1.20, 0.18, 1.36), (1.32, 0.18, 1.36), (1.32, 0.38, 1.36), (1.32, 0.38, 1.30)]
    pipe("c_conc", cc, 0.006, band="band_cds")
    mini("cor", "科里奥利（原液按质量配）", (1.40, 0.18, 0.55), size=0.85, band="band_cds", note="直接测质量和密度：配比最准")
    cd = [(1.32, 0.38, 0.86), (1.32, 0.38, 0.25), (1.10, 0.38, 0.25), (1.10, 0.66, 0.25)]
    pipe("c_out", cd, 0.0095, band="band_cds")
    mini("mag", "电磁式（稀释后的药液）", (1.22, 0.38, 0.25), size=0.85, band="band_cds", note="导电的药液可以用；纯水不行")
    cw = [(1.62, 0.30, 1.42), (1.42, 0.30, 1.42), (1.42, 0.38, 1.42), (1.42, 0.38, 1.30)]
    pipe("c_diw", cw, 0.0095, band="band_diw")

    SPEC[R] = dict(meters=BENCH_METERS, label="湿法清洗台")
    PATHS[R] = [dict(fluid="diw", pts=diw, rate=1.0), dict(fluid="chem", pts=ca, rate=0.35), dict(fluid="chem", pts=cb, rate=0.35),
                dict(fluid="diw", pts=sh, rate=0.6), dict(fluid="diw", pts=bl[:6], rate=0.2), dict(fluid="ret", pts=ci + co, rate=1.0),
                dict(fluid="n2", pts=n2, rate=1.4), dict(fluid="cds", pts=cc, rate=0.4), dict(fluid="cds", pts=cd, rate=0.6),
                dict(fluid="diw", pts=cw, rate=0.5)]
    PINS[R] = [(k, v["label"], tuple(v["pos"])) for k, v in BENCH_METERS.items()] + [
        ("tank", "处理槽：DIW 从槽底往上涌", (0.0, 0.12, 1.22)), ("pump", "循环泵", (0.56, 0.40, 0.24)), ("filter", "过滤器", (0.74, 0.355, 0.62)),
        ("cds", "药液调配柜（厂务侧）", (1.32, 0.23, 1.30))]
    VIEWS[R] = dict(target=(0.34, 0.30, 0.74), dir=(0.06, -1, 0.40), dist=4.5)


# ---------- 收尾 ----------
def cut_box(mode, y0=0.0):
    if mode == "quarter":
        return Box(-1, 1, -1, y0, 0.0, 1)
    return Box(-1, 1, -1, y0, -1, 1)


def finalize(mats):
    roots = {}
    for r in ROOTS:
        e = bpy.data.objects.new("ROOT_" + r, None)
        link(e)
        e.location = ROOT_POS[r]
        roots[r] = e
    objs = {r: [] for r in ROOTS}
    for p in PARTS:
        o = p["obj"]
        c = p["cut"]
        if c:
            mode, y0 = (c, 0.0) if isinstance(c, str) else c
            boolean(o, [cut_box(mode, y0)])
        me = o.data
        if len(me.polygons) == 0:
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(p["smooth"]))
        me.materials.clear()
        me.materials.append(mats[p["mat"]])
        o.name = f"{p['name']}__{p['mat']}"
        me.name = o.name
        o.parent = roots[p["root"]]
        o["part"] = p["name"]
        objs[p["root"]].append(o)
    return roots, objs


def keyframe_demo(objs):
    """.blend 里留一段动画：叶轮转、浮子升降、U 管振动（放大）。"""
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, 120
    for o in objs["pad"]:
        if o["part"].startswith(("pad_rotor", "pad_magnet")):
            o.rotation_euler = (0, 0, 0)
            o.keyframe_insert("rotation_euler", frame=1)
            o.rotation_euler = (0, -4 * math.pi, 0)
            o.keyframe_insert("rotation_euler", frame=120)
            for fc in (o.animation_data.action.fcurves if hasattr(o.animation_data.action, "fcurves") else []):
                for kp in fc.keyframe_points:
                    kp.interpolation = "LINEAR"
    for o in objs["flt"]:
        if o["part"].startswith("flt_float"):
            base = o.location.copy()
            for f, dz in ((1, 0.0), (60, 0.08), (120, 0.0)):
                o.location = base + Vector((0, 0, dz))
                o.keyframe_insert("location", frame=f)
            o.location = base


def export_glb(path):
    kw = dict(filepath=path, export_format="GLB", use_selection=False, export_apply=False, export_yup=True,
              export_extras=True, export_animations=False, export_cameras=False, export_lights=False,
              export_tangents=False, export_normals=True, export_texcoords=True)
    bpy.ops.export_scene.gltf(**kw)


SAMPLES, RES = 40, (1280, 720)


def add_lights(scale=1.0, center=(0, 0, 0)):
    for o in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o, do_unlink=True)
    c = Vector(center)
    for name, off, en, size in (("key", (-0.6, -1.4, 1.3), 120, 1.2), ("fill", (1.3, -0.9, 0.4), 36, 1.4), ("rim", (0.2, 1.4, 1.0), 45, 1.0)):
        l = bpy.data.lights.new(name, "AREA")
        l.energy, l.size = en * scale * scale, size * scale
        o = bpy.data.objects.new(name, l)
        o.location = c + Vector(off) * scale
        d = c - o.location
        o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.collection.objects.link(o)


def render_all(out_dir, roots, objs):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 88
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (.05, .06, .07, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = .35
    sc.world = w
    cd = bpy.data.cameras.new("cam")
    cd.clip_start = 0.002
    co = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(co)
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = RES
    for r in ROOTS:
        if r in ("bench",) or r in ROOTS:
            pass
    for r in ROOTS:
        for rr, os_ in objs.items():
            for o in os_:
                o.hide_render = rr != r
        v = VIEWS[r]
        t = Vector(ROOT_POS[r]) + Vector(v["target"])
        d = Vector(v["dir"]).normalized()
        cam = t + d * v["dist"]
        co.location = cam
        co.rotation_euler = (t - cam).to_track_quat("-Z", "Y").to_euler()
        cd.lens = {"bench": 40, "flt": 32}.get(r, 50)
        add_lights(scale=v["dist"] * 1.3, center=t)
        sc.render.filepath = os.path.join(out_dir, f"view_{r}.jpg")
        bpy.ops.render.render(write_still=True)
        print("rendered", r, flush=True)


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--only", default="", help="只渲染这些模型，逗号分隔")
    ap.add_argument("--samples", type=int, default=40)
    ap.add_argument("--res", default="1280x720")
    return ap.parse_args(argv)


def main():
    global SAMPLES, RES, ROOTS
    args = parse()
    SAMPLES = args.samples
    RES = tuple(int(v) for v in args.res.split("x"))
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = build_materials()
    for fn in (build_bench, build_us, build_usc, build_vor, build_pad, build_flt, build_dp, build_thm, build_cor, build_mag):
        fn()
        print("built", fn.__name__, len(PARTS), flush=True)
    roots, objs = finalize(mats)
    export_glb(os.path.join(out_dir, "flowmeters.glb"))
    keyframe_demo(objs)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "flowmeters.blend"), compress=True)
    def r4(v):
        if isinstance(v, float):
            return round(v, 5) if abs(v) >= 1e-3 or v == 0 else float(f"{v:.4g}")
        if isinstance(v, (list, tuple)):
            return [r4(x) for x in v]
        if isinstance(v, dict):
            return {k: r4(x) for k, x in v.items()}
        return v
    spec = dict(SPEC=r4(SPEC), PATHS=r4(PATHS), PINS={k: [[a, b, r4(list(c))] for a, b, c in v] for k, v in PINS.items()},
                VIEWS=r4(VIEWS), ROOT_POS=ROOT_POS)
    with open(os.path.join(out_dir, "spec.json"), "w", encoding="utf-8") as fp:
        json.dump(spec, fp, ensure_ascii=False, indent=1)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for os_ in objs.values() for o in os_)
    print(f"objects={sum(len(v) for v in objs.values())} tris={tris}")
    if args.render:
        if args.only:
            keep = args.only.split(",")
            ROOTS = [r for r in ROOTS if r in keep]
        render_all(out_dir, roots, objs)


main()
