#!/usr/bin/env python3
"""气体调压阀（pressure regulator）教学模型：纯脚本建模，八种结构放在同一个 .blend / .glb 里。

  A spring  直动弹簧式单级减压阀（高纯气体用，膜片 + 非平衡阀芯，不溢流）
  B twostg  两级减压阀（一级预设、二级手调，两块压力表）
  C dome    圆顶加载（气控）减压阀：弹簧换成一腔气
  D ptfe    氟树脂气控液体调压阀：用气压设定药液 / 纯水压力
  E bpr     背压阀（圆顶加载、膜片直接密封）：管住上游
  F epopen  开环电气比例阀：比例电磁铁代替弹簧，带溢流
  G epclose 闭环电气比例阀：两只小电磁阀充放先导腔 + 压力传感器 + 控制板
  H piezo   数字式自动压力调节器：压电阀 + 压力传感器 + PID，全金属

结构依据公开专利和产品原理图，尺寸是教学示意值，外形不对应任何具体厂家的产品。
每个零件都先做成完整实体，用布尔运算打孔，再整体切掉 y<0 的一半，剖切面换成浅色"剖面材质"。

用法（二选一）：
  blender -b -P blender/build_regulators.py -- --out blender/out [--render]
  pip install bpy && python blender/build_regulators.py --out blender/out [--render]

坐标：Z 向上是阀轴，y=0 是剖切面（观察者在 -y 一侧），单位 cm。
"""
import argparse
import json
import math
import os
import sys

import bpy  # noqa: I001  bpy 要先导入，bmesh 才能用
import bmesh
from mathutils import Matrix, Vector

TAU = 2 * math.pi
SEG = 56          # 回转体分段
EPS = 1e-4

# ---------- 材质 ----------
#            名称           外表颜色   金属  粗糙  剖面颜色   不透明
MATS = {
    "ss":        ("#B9C0C6", 0.95, 0.30, "#DCE2E6", 1.0),   # 不锈钢本体
    "ss_dark":   ("#7D878E", 0.90, 0.40, "#C3CAD0", 1.0),
    "brass":     ("#C9A35A", 0.95, 0.35, "#E8CF97", 1.0),
    "alu":       ("#6F7F8C", 0.70, 0.45, "#C9D2D9", 1.0),   # 阳极氧化铝块
    "alu_blue":  ("#3F6E93", 0.55, 0.40, "#A9C4D8", 1.0),
    "poppet":    ("#E58A2E", 0.60, 0.35, "#F6C48C", 1.0),   # 动作件一律暖色，方便看
    "stem":      ("#D9772A", 0.70, 0.35, "#F2B47A", 1.0),
    "dia":       ("#E9C649", 0.80, 0.30, "#F5E39A", 1.0),   # 膜片
    "plate":     ("#C78B3B", 0.80, 0.35, "#EBC48A", 1.0),
    "spring":    ("#52A37A", 0.80, 0.35, "#9ED6B7", 1.0),
    "seat":      ("#EDEBDD", 0.00, 0.55, "#FFFDF0", 1.0),   # PCTFE / 软阀座
    "ptfe":      ("#EEEDE6", 0.00, 0.62, "#FFFFFF", 1.0),
    "pvdf":      ("#D8CBB0", 0.00, 0.55, "#F1E8D3", 1.0),
    "pfa":       ("#D9E6E4", 0.00, 0.25, "#F2FAF8", 1.0),
    "knob":      ("#2E3A44", 0.10, 0.55, "#7F8D98", 1.0),
    "plastic":   ("#2B3137", 0.05, 0.60, "#6F7A83", 1.0),
    "cover":     ("#D2D7DA", 0.05, 0.55, "#EEF1F2", 1.0),
    "coil":      ("#B8652F", 0.95, 0.40, "#E3A06F", 1.0),
    "iron":      ("#5D646A", 0.90, 0.45, "#A9B0B5", 1.0),
    "armature":  ("#E58A2E", 0.85, 0.35, "#F6C48C", 1.0),
    "pcb":       ("#1F6B47", 0.10, 0.50, "#5FB088", 1.0),
    "chip":      ("#20252A", 0.20, 0.40, "#5A636B", 1.0),
    "piezo":     ("#D9B88A", 0.10, 0.45, "#F1DDBB", 1.0),
    "piezo_el":  ("#C8CDD1", 0.95, 0.30, "#E9EDF0", 1.0),
    "sensor":    ("#8E9BA6", 0.90, 0.35, "#D0D8DE", 1.0),
    "gauge_face": ("#F4F4EF", 0.00, 0.60, "#FFFFFF", 1.0),
    "needle":    ("#D2382B", 0.20, 0.40, "#F08A80", 1.0),
    "tick":      ("#22282D", 0.00, 0.60, "#22282D", 1.0),
    "glass":     ("#CFE7EF", 0.00, 0.05, "#CFE7EF", 0.18),
    "led_red":   ("#FF4A3A", 0.00, 0.50, "#FF4A3A", 1.0),
    "tube_blue": ("#3D8FD1", 0.00, 0.45, "#9CC9EC", 1.0),
}
EMIT = {"led_red": 6.0}


def srgb(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c]


def principled(name, col, metal, rough, alpha=1.0, emit=0.0):
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
    out = {}
    for name, (col, metal, rough, cut, alpha) in MATS.items():
        out[name] = principled(name, col, metal, rough, alpha, EMIT.get(name, 0))
        out[name + "_cut"] = principled(name + "_cut", cut, 0.0, 0.85, alpha, EMIT.get(name, 0))
    out["gas"] = principled("gas", "#7FA8C8", 0.0, 1.0, 0.85)
    return out


# ---------- 网格生成 ----------
def revolve(prof, n=SEG, axis="z", at=(0, 0, 0)):
    """(r, h) 闭合轮廓绕轴转一整圈。axis 取 z 或 x（x 轴时 h 沿 x）。"""
    ax = {"z": (Vector((0, 0, 1)), Vector((1, 0, 0)), Vector((0, 1, 0))),
          "x": (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))),
          "y": (Vector((0, 1, 0)), Vector((1, 0, 0)), Vector((0, 0, 1)))}[axis]
    a, u, w = ax
    o = Vector(at)
    m = len(prof)
    v, f = [], []
    for j in range(n):
        t = TAU * (j + 0.5) / n       # 错开半格：不让顶点正好落在 y=0 的剖切面上，否则精确布尔会出错
        d = u * math.cos(t) + w * math.sin(t)
        for (r, h) in prof:
            v.append(tuple(o + a * h + d * r))
    for j in range(n):
        j2 = (j + 1) % n
        for i in range(m):
            i2 = (i + 1) % m
            f.append((j * m + i, j * m + i2, j2 * m + i2, j2 * m + i))
    return v, f


def cyl_mesh(r, h0, h1, axis="z", at=(0, 0, 0), n=SEG, r1=None):
    r1 = r if r1 is None else r1
    return revolve([(0, h0), (r, h0), (r1, h1), (0, h1)], n, axis, at)


def box_mesh(x0, x1, y0, y1, z0, z1):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return v, f


def prism_mesh(pts, z0, z1, at=(0, 0)):
    """xy 平面多边形沿 z 拉伸。"""
    n = len(pts)
    v = [(at[0] + x, at[1] + y, z0) for x, y in pts] + [(at[0] + x, at[1] + y, z1) for x, y in pts]
    f = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        f.append((i, j, n + j, n + i))
    return v, f


def hex_x(rf, x0, x1, z, y=0.0):
    """沿 x 轴的六角螺母（对边半径 rf）。"""
    rc = rf / math.cos(math.pi / 6)
    prof = [(rc * math.cos(math.pi / 6 + k * math.pi / 3), rc * math.sin(math.pi / 6 + k * math.pi / 3)) for k in range(6)]
    n = 6
    v = [(x0, y + b, z + a) for a, b in prof] + [(x1, y + b, z + a) for a, b in prof]
    f = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
    for i in range(n):
        j = (i + 1) % n
        f.append((i, n + i, n + j, j))
    return v, f


def hex_z(rf, z0, z1, cx=0.0, cy=0.0):
    rc = rf / math.cos(math.pi / 6)
    pts = [(rc * math.cos(k * math.pi / 3 + 0.3), rc * math.sin(k * math.pi / 3 + 0.3)) for k in range(6)]
    return prism_mesh(pts, z0, z1, (cx, cy))


def helix_mesh(rm, rw, z0, length, turns, at=(0, 0), nseg=None, nw=10, ground=True):
    """压缩弹簧：管状螺旋线；两端各磨平半圈（并紧圈）。"""
    nseg = nseg or int(turns * 40)
    pts = []
    for i in range(nseg + 1):
        t = i / nseg
        a = TAU * turns * t + 0.37
        # 两端并紧：螺距在两端收小
        s = t
        if ground:
            e = 0.5 / turns
            if t < e:
                s = t * 0.35
            elif t > 1 - e:
                s = 1 - (1 - t) * 0.35
            else:
                s = 0.35 * e + (t - e) * (1 - 0.7 * e) / (1 - 2 * e)
        z = z0 + rw + (length - 2 * rw) * s
        pts.append(Vector((at[0] + rm * math.cos(a), at[1] + rm * math.sin(a), z)))
    v, f = [], []
    for i, p in enumerate(pts):
        tan = (pts[min(i + 1, nseg)] - pts[max(i - 1, 0)]).normalized()
        nrm = Vector((p.x - at[0], p.y - at[1], 0)).normalized()
        bin_ = tan.cross(nrm).normalized()
        nrm = bin_.cross(tan).normalized()
        for k in range(nw):
            a = TAU * k / nw
            v.append(tuple(p + (nrm * math.cos(a) + bin_ * math.sin(a)) * rw))
    for i in range(nseg):
        for k in range(nw):
            k2 = (k + 1) % nw
            f.append((i * nw + k, i * nw + k2, (i + 1) * nw + k2, (i + 1) * nw + k))
    f.append(tuple(reversed(range(nw))))
    f.append(tuple(nseg * nw + k for k in range(nw)))
    return v, f


def helix_half(rm, rw, z0, length, turns, at=(0, 0), nw=10, per=40):
    """只建 y>=0 那半边的螺旋弹簧：每半圈一段管子，两端封口（封口面算剖面）。返回 (v, f, cap_face_ids)。"""
    def zat(t):
        e = 0.5 / turns
        if t < e:
            s_ = t * 0.35
        elif t > 1 - e:
            s_ = 1 - (1 - t) * 0.35
        else:
            s_ = 0.35 * e + (t - e) * (1 - 0.7 * e) / (1 - 2 * e)
        return z0 + rw + (length - 2 * rw) * s_
    v, f, caps = [], [], []
    nh = int(round(turns * 2))
    for k in range(nh):
        if k % 2:
            continue                     # 奇数半圈在 y<0 一侧，被切掉
        a0, a1 = k * math.pi, (k + 1) * math.pi
        a0 = max(a0, 0.0)
        a1 = min(a1, TAU * turns)
        if a1 - a0 < 1e-3:
            continue
        ns = max(4, int(per * (a1 - a0) / TAU))
        base = len(v)
        ring = []
        for i in range(ns + 1):
            a = a0 + (a1 - a0) * i / ns
            t = a / (TAU * turns)
            p = Vector((at[0] + rm * math.cos(a), at[1] + rm * math.sin(a), zat(t)))
            ta = Vector((-rm * math.sin(a), rm * math.cos(a), (length - 2 * rw) / (TAU * turns))).normalized()
            nrm = Vector((math.cos(a), math.sin(a), 0))
            bn = ta.cross(nrm).normalized()
            nrm = bn.cross(ta).normalized()
            for j in range(nw):
                b = TAU * j / nw
                v.append(tuple(p + (nrm * math.cos(b) + bn * math.sin(b)) * rw))
        for i in range(ns):
            for j in range(nw):
                j2 = (j + 1) % nw
                f.append((base + i * nw + j, base + i * nw + j2, base + (i + 1) * nw + j2, base + (i + 1) * nw + j))
        caps.append(len(f))
        f.append(tuple(base + j for j in reversed(range(nw))))
        caps.append(len(f))
        f.append(tuple(base + ns * nw + j for j in range(nw)))
    return v, f, caps


def bellows_prof(r_in, r_out, z0, z1, conv, t=0.05):
    """波纹管的 (r,z) 轮廓：锯齿形薄壁。"""
    outer, inner = [], []
    for i in range(conv * 2 + 1):
        z = z0 + (z1 - z0) * i / (conv * 2)
        r = r_out if i % 2 else r_in
        outer.append((r, z))
        inner.append((r - t, z))
    return [(r_in - t, z0)] + outer + [(r_in - t, z1)] + list(reversed(inner[1:-1]))


# ---------- 对象 ----------
MODELS = ["spring", "twostg", "dome", "ptfe", "bpr", "epopen", "epclose", "piezo"]
ROOTS = {}
PARTS = []          # [obj]
SPEC = {m: dict(movers=[], paths=[], pins=[], zones=[], gas=[]) for m in MODELS}
MATSET = {}


def mesh_obj(name, vf, mat):
    v, f = vf
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    # 轮廓贴着轴线时，轴上会留下一条没有面的"线"，它会让布尔运算误判成非流形
    loose = [e for e in bm.edges if not e.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="EDGES")
    lv = [v for v in bm.verts if not v.link_edges]
    if lv:
        bmesh.ops.delete(bm, geom=lv, context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if mat:
        me.materials.append(MATSET[mat])
        me.materials.append(MATSET[mat + "_cut"])
    return o


def join_vf(*vfs):
    v, f = [], []
    for vv, ff in vfs:
        b = len(v)
        v.extend(vv)
        f.extend(tuple(i + b for i in fa) for fa in ff)
    return v, f


def boolean(o, cutters, op="DIFFERENCE"):
    """精确布尔。多个刀具放进一个临时集合一次减掉（求并更稳）。"""
    if not cutters:
        return o
    md = o.modifiers.new("b", "BOOLEAN")
    md.operation = op
    md.solver = "EXACT"
    coll = None
    if len(cutters) == 1:
        md.object = cutters[0]
    else:
        coll = bpy.data.collections.new("_cut")
        for c in cutters:
            coll.objects.link(c)
        md.operand_type = "COLLECTION"
        md.collection = coll
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    o.modifiers.remove(md)
    if coll:
        bpy.data.collections.remove(coll)
    old = o.data
    mats = list(old.materials)
    o.data = me
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    bpy.data.meshes.remove(old)
    return o


def tmp(vf):
    return mesh_obj("_tmp", vf, None)


def drop(objs):
    for c in objs:
        bpy.data.objects.remove(c, do_unlink=True)


HALF = None


def cutaway(o):
    """切掉 y<0 的一半，把落在剖切面上的面换成剖面材质。"""
    boolean(o, [HALF])
    me = o.data
    for p in me.polygons:
        c = p.center
        n = p.normal
        p.material_index = 1 if (abs(c.y) < 2e-3 and n.y < -0.98) else 0
    return o


def part(model, name, vf, mat, holes=(), cut=True, origin=None, smooth=40, kind="solid", extra=None, capfaces=None):
    o = mesh_obj(f"{model}__{name}__{len(PARTS)}", vf, mat)
    if capfaces is not None:
        for p in o.data.polygons:
            c = p.center
            p.material_index = 1 if (abs(c.y) < 0.02 and abs(p.normal.y) > 0.95) else 0
    if holes:
        hs = [tmp(h) for h in holes]
        boolean(o, hs)
        drop(hs)
    if cut:
        cutaway(o)
    o["cut"] = 1 if cut else 0
    me = o.data
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
        me.set_sharp_from_angle(angle=math.radians(smooth))
    if origin is not None:
        ov = Vector(origin)
        me.transform(Matrix.Translation(-ov))
        o.location = ov
    o.parent = ROOTS[model]
    o["part"] = name
    o["model"] = model
    o["kind"] = kind
    if extra:
        for k, val in extra.items():
            o[k] = val
    PARTS.append(o)
    return o


def mover(model, name, **kw):
    SPEC[model]["movers"].append(dict(part=name, **kw))


def pin(model, key, x, z, y=0.0):
    SPEC[model]["pins"].append(dict(key=key, at=[round(x, 3), round(y, 3), round(z, 3)]))


def path(model, ch, pts, w=0.0, n=None):
    SPEC[model]["paths"].append(dict(ch=ch, pts=[[round(a, 3), round(b, 3)] for a, b in pts], w=w, n=n))


GAS_Y0, GAS_Y1 = 0.012, 0.03


def gas(model, zone, polys, solids):
    """一个压力区：在剖切面后面一点放一层薄片，再减去静止零件，剩下的就是这一区气体的剖面形状。"""
    vf = join_vf(*[prism_xz(p) for p in polys])
    o = mesh_obj(f"{model}__gas_{zone}", vf, None)
    o.data.materials.append(MATSET["gas"])
    boolean(o, solids)
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    kill = [f for f in bm.faces if f.normal.y > -0.98]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(me)
    bm.free()
    o.parent = ROOTS[model]
    o["part"] = "gas_" + zone
    o["model"] = model
    o["kind"] = "gas"
    o["zone"] = zone
    SPEC[model]["zones"].append(zone)
    PARTS.append(o)
    return o


def prism_xz(pts):
    """xz 平面多边形沿 y 拉成薄片（GAS_Y0..GAS_Y1）。"""
    n = len(pts)
    v = [(x, GAS_Y0, z) for x, z in pts] + [(x, GAS_Y1, z) for x, z in pts]
    f = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
    for i in range(n):
        j = (i + 1) % n
        f.append((i, n + i, n + j, j))
    return v, f


def rect(x0, x1, z0, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


# ---------- 公共件 ----------
def fitting_x(model, side, z, x_body, bore=0.18, name="port", mat_nut="ss", tube_mat="ss", length=2.2):
    """面密封接头（示意）：凸台 + 六角螺母 + 管子，全部沿 x，带通孔。side=-1 左，+1 右。"""
    s = side
    xa = x_body - 0.05 * s
    xb = x_body + 0.65 * s
    xc = xb + 0.85 * s
    xd = xb + length * s
    lo, hi = sorted((xa, xb))
    boss = cyl_mesh(0.42, lo, hi, "x", (0, 0, z))
    lo2, hi2 = sorted((xb, xc))
    nut = hex_x(0.6, lo2, hi2, z)
    lo3, hi3 = sorted((xb - 0.05 * s, xd))
    tube = cyl_mesh(0.3, lo3, hi3, "x", (0, 0, z))
    bh = [cyl_mesh(bore, min(xa, xd) - 0.1, max(xa, xd) + 0.1, "x", (0, 0, z), 24)]
    part(model, name, boss, "ss", holes=bh)
    part(model, name + "_nut", nut, mat_nut, holes=[cyl_mesh(0.31, lo2 - 0.01, hi2 + 0.01, "x", (0, 0, z), 32)], smooth=0)
    part(model, name + "_tube", tube, tube_mat, holes=bh)
    return min(xa, xd), max(xa, xd)


def fitting_z(model, x, z_base, length=2.0, bore=0.14, name="pport", tube_mat="ss"):
    """向上的接头（先导口 / 表口）。"""
    zb = z_base + 0.5
    boss = cyl_mesh(0.38, z_base - 0.05, zb, "z", (x, 0, 0))
    nut = hex_z(0.52, zb, zb + 0.7, x)
    tube = cyl_mesh(0.26, zb - 0.05, z_base + length, "z", (x, 0, 0))
    bh = [cyl_mesh(bore, z_base - 0.2, z_base + length + 0.1, "z", (x, 0, 0), 24)]
    part(model, name, boss, "ss", holes=bh)
    part(model, name + "_nut", nut, "ss", holes=[cyl_mesh(0.27, zb - 0.01, zb + 0.71, "z", (x, 0, 0), 32)], smooth=0)
    part(model, name + "_tube", tube, tube_mat, holes=bh)


def knob_mesh(r, z0, z1, cx=0.0, flutes=18):
    """带滚花槽的手轮。"""
    pts = []
    n = flutes * 4
    for k in range(n):
        a = TAU * (k + 0.5) / n
        rr = r * (0.93 if (k % 4) in (1, 2) else 1.0)
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    body = prism_mesh(pts, z0, z1 - 0.15, (cx, 0))
    top = cyl_mesh(r * 0.97, z1 - 0.15, z1, "z", (cx, 0, 0), 48, r1=r * 0.8)
    return join_vf(body, top)


# ---------- 一个"阀站"：进口腔 + 阀座 + 阀芯 + 出口腔 + 膜片 ----------
ST = dict(z_floor=0.45, r_ch=0.62, z_sb=1.42, z_st=1.62, r_orf=0.16, r_pass=0.30, z_rec=2.6, z_top=3.0,
          r_rec=1.80, r_dia=2.10, t_dia=0.05, z_in=0.85, z_out=2.15, r_bore=0.18, r_plate=1.25)


def station_cutters(cx, s=ST, in_side=-1, out_side=+1, in_len=6.0, out_len=6.0, out_bore=True):
    """本体上要挖掉的空腔（回转件 + 横孔），返回网格列表。"""
    c = []
    c.append(cyl_mesh(s["r_ch"], s["z_floor"], s["z_sb"] + 0.01, "z", (cx, 0, 0)))
    c.append(cyl_mesh(0.45, s["z_sb"] - 0.02, s["z_st"], "z", (cx, 0, 0)))              # 阀座沉孔
    c.append(cyl_mesh(s["r_pass"], s["z_st"] - 0.01, s["z_rec"] + 0.01, "z", (cx, 0, 0)))
    c.append(cyl_mesh(s["r_rec"], s["z_rec"], s["z_top"] + 0.5, "z", (cx, 0, 0)))
    if in_side:
        x0 = cx
        x1 = cx + in_side * in_len
        c.append(cyl_mesh(s["r_bore"], min(x0, x1), max(x0, x1), "x", (0, 0, s["z_in"]), 24))
    if out_side and out_bore:
        x0 = cx
        x1 = cx + out_side * out_len
        c.append(cyl_mesh(s["r_bore"], min(x0, x1), max(x0, x1), "x", (0, 0, s["z_out"]), 24))
    return c


def station_parts(model, cx, tag="", s=ST, relieving=False, gain_name="h", dname="d", spring_k=None):
    """阀座、阀芯（含阀杆）、阀芯弹簧、膜片。返回 (z_dia_top)."""
    zsb, zst, ro = s["z_sb"], s["z_st"], s["r_orf"]
    seat = revolve([(ro, zsb), (0.45, zsb), (0.45, zst), (ro + 0.04, zst)], 48, "z", (cx, 0, 0))
    part(model, "seat" + tag, seat, "seat")
    # 阀芯：锥面在阀座孔边缘 z_sb 处接触
    z_head0 = 0.95
    z_cone0 = zsb - 0.14
    top = s["z_top"]
    prof = [(0, z_head0), (0.30, z_head0), (0.30, z_cone0), (0.08, zsb + 0.08), (0.08, top - (0.06 if relieving else 0))]
    if relieving:
        prof += [(0.24, top - 0.06), (0.24, top), (0, top)]
    else:
        prof += [(0.05, top), (0, top)]
    part(model, "poppet" + tag, revolve(prof, 40, "z", (cx, 0, 0)), "poppet")
    mover(model, "poppet" + tag, kind="tz", ch=gain_name, k=-1.0)
    # 阀芯弹簧（底座在腔底，顶端随阀芯下移被压短）
    L = z_head0 - s["z_floor"]
    sp = helix_half(0.30, 0.05, s["z_floor"], L, 3.5, (cx, 0))
    part(model, "pspring" + tag, sp[:2], "spring", origin=(cx, 0, s["z_floor"]), smooth=0, cut=False, capfaces=sp[2])
    mover(model, "pspring" + tag, kind="spring", L=L, bot=None, top=gain_name, kb=0, kt=-1.0)
    # 膜片：外缘夹紧，中间随阀杆移动（网页里按半径插值变形）
    zd0, zd1 = s["z_top"], s["z_top"] + s["t_dia"]
    pr = [(0, zd0), (s["r_dia"], zd0), (s["r_dia"], zd1), (0, zd1)]
    holes = [cyl_mesh(0.11, zd0 - 0.1, zd1 + 0.1, "z", (cx, 0, 0), 24)] if relieving else []
    part(model, "dia" + tag, revolve(pr, 64, "z", (cx, 0, 0)), "dia", holes=holes, kind="dia",
         extra=dict(cx=cx, r_in=s["r_plate"], r_out=s["r_rec"]))
    mover(model, "dia" + tag, kind="dia", ch=dname, k=1.0, cx=cx, r_in=s["r_plate"], r_out=s["r_rec"])
    return zd1


def station_gas_polys(cx, s=ST, in_x=None, out_x=None, in_side=-1, out_side=+1):
    """进口高压区 / 出口低压区的覆盖多边形（会被静止零件裁掉）。分界线在阀座底面 z_sb。"""
    zsb = s["z_sb"]
    hi = []
    lo = []
    hi.append(rect(cx - s["r_ch"] - 0.05, cx + s["r_ch"] + 0.05, s["z_floor"] - 0.05, zsb))
    if in_x is not None:
        a, b = sorted((cx, in_x))
        hi.append(rect(a if in_side > 0 else a, b, s["z_in"] - 0.25, s["z_in"] + 0.25))
    lo.append(rect(cx - 0.5, cx + 0.5, zsb, s["z_rec"]))
    lo.append(rect(cx - s["r_rec"] - 0.05, cx + s["r_rec"] + 0.05, s["z_rec"], s["z_top"]))
    if out_x is not None:
        a, b = sorted((cx, out_x))
        lo.append(rect(a, b, s["z_out"] - 0.25, s["z_out"] + 0.25))
    return hi, lo


def merge_rects(rs):
    """把可能重叠的矩形并成互不重叠的矩形集合（扫描线切条）。"""
    xs = sorted({x for r in rs for x in (r[0][0], r[1][0])})
    out = []
    for i in range(len(xs) - 1):
        a, b = xs[i], xs[i + 1]
        iv = []
        for r in rs:
            if r[0][0] <= a + EPS and r[1][0] >= b - EPS:
                iv.append((r[0][1], r[2][1]))
        iv.sort()
        cur = None
        for z0, z1 in iv:
            if cur and z0 <= cur[1] + EPS:
                cur[1] = max(cur[1], z1)
            else:
                if cur:
                    out.append(rect(a, b, *cur))
                cur = [z0, z1]
        if cur:
            out.append(rect(a, b, *cur))
    return out


def station_paths(model, cx, s=ST, x_in=-5.0, x_out=5.0, ch="main", in_side=-1, out_side=1):
    zi, zo, zsb = s["z_in"], s["z_out"], s["z_sb"]
    for sg in (-1, 1):
        p = [(x_in, zi)]
        p += [(cx + 0.47 * sg, zi), (cx + 0.46 * sg, zsb - 0.12), (cx + 0.2 * sg, zsb - 0.02), (cx + 0.12 * sg, s["z_st"]),
              (cx + 0.2 * sg, zo)]
        p += [(x_out, zo)]
        path(model, ch, p, w=0.09)


# ---------- 弹簧阀帽（A 与 B 共用） ----------
def spring_bonnet(model, cx, tag="", knob=True, z_btn=5.0, adj="adj", d="d", spring_turns=5.5, rm=0.95, rw=0.12):
    s = ST
    zt = s["z_top"] + s["t_dia"]               # 3.05
    top = z_btn + 0.55
    prof = [(1.9, zt), (2.4, zt), (2.4, zt + 0.35), (1.7, zt + 0.35), (1.7, top - 0.1), (1.5, top + 0.2),
            (0.62, top + 0.2), (0.62, top + 0.5), (0.32, top + 0.5), (0.32, top), (1.45, top),
            (1.45, zt + 0.15), (1.9, zt + 0.15)]
    vent = [cyl_mesh(0.07, cx - 2.0, cx - 1.2, "x", (0, 0, zt + 1.2), 16)]
    part(model, "bonnet" + tag, revolve(prof, SEG, "z", (cx, 0, 0)), "ss", holes=vent)
    # 压板
    plate = revolve([(0, zt), (s["r_plate"], zt), (s["r_plate"], zt + 0.15), (0.72, zt + 0.15), (0.72, zt + 0.3), (0, zt + 0.3)], 48, "z", (cx, 0, 0))
    part(model, "plate" + tag, plate, "plate")
    mover(model, "plate" + tag, kind="tz", ch=d, k=1.0)
    # 调压弹簧：下端坐在压板上（随膜片动），上端顶着弹簧座（随手轮动）
    z0 = zt + 0.15
    L = z_btn - z0
    hs = helix_half(rm, rw, z0, L, spring_turns, (cx, 0))
    part(model, "spring" + tag, hs[:2], "spring", origin=(cx, 0, z0), smooth=0, cut=False, capfaces=hs[2])
    mover(model, "spring" + tag, kind="spring", L=L, bot=d, top=adj if knob else None, kb=1.0, kt=-1.0)
    # 弹簧座 + 调节螺杆 + 手轮
    btn = revolve([(0, z_btn - 0.2), (0.68, z_btn - 0.2), (0.68, z_btn), (1.12, z_btn), (1.12, z_btn + 0.15), (0, z_btn + 0.15)], 48, "z", (cx, 0, 0))
    part(model, "button" + tag, btn, "ss_dark")
    if knob:
        mover(model, "button" + tag, kind="tz", ch=adj, k=-1.0)
        scr = cyl_mesh(0.3, z_btn + 0.15, top + 1.6, "z", (cx, 0, 0), 32)
        part(model, "screw" + tag, scr, "ss_dark")
        mover(model, "screw" + tag, kind="tz", ch=adj, k=-1.0)
        part(model, "locknut" + tag, hex_z(0.6, top + 0.5, top + 0.78, cx), "ss_dark",
             holes=[cyl_mesh(0.31, top + 0.4, top + 0.9, "z", (cx, 0, 0), 32)], smooth=0)
        part(model, "knob" + tag, knob_mesh(1.25, top + 1.0, top + 1.95, cx), "knob",
             holes=[cyl_mesh(0.3, top + 0.9, top + 1.6, "z", (cx, 0, 0), 32)], smooth=30)
        mover(model, "knob" + tag, kind="tz", ch=adj, k=-1.0)
    else:
        cap = revolve([(0, top + 0.5), (0.62, top + 0.5), (0.62, top + 0.85), (0.5, top + 0.95), (0, top + 0.95)], 40, "z", (cx, 0, 0))
        part(model, "cap" + tag, cap, "ss_dark")
        scr = cyl_mesh(0.3, z_btn + 0.15, top + 0.5, "z", (cx, 0, 0), 32)
        part(model, "screw" + tag, scr, "ss_dark")
    return top


# ======================================================================
# A 直动弹簧式单级减压阀
# ======================================================================
def model_spring():
    M = "spring"
    s = ST
    body = revolve([(0, 0), (2.25, 0), (2.4, 0.15), (2.4, s["z_top"] - 0.1), (2.3, s["z_top"]), (0, s["z_top"])], SEG)
    cut = station_cutters(0.0)
    part(M, "body", body, "ss", holes=cut)
    xl0, _ = fitting_x(M, -1, s["z_in"], -2.4, name="inlet")
    _, xr1 = fitting_x(M, +1, s["z_out"], 2.4, name="outlet")
    station_parts(M, 0.0)
    spring_bonnet(M, 0.0)
    statics = [o for o in PARTS if o["model"] == M and o["part"] in ("body", "seat", "inlet", "inlet_nut", "inlet_tube", "outlet", "outlet_nut", "outlet_tube")]
    hi, lo = station_gas_polys(0.0, in_x=xl0, out_x=xr1)
    gas(M, "hi", merge_rects(hi), statics)
    gas(M, "lo", merge_rects(lo), statics)
    station_paths(M, 0.0, x_in=xl0 + 0.2, x_out=xr1 - 0.2)
    for k, x, z in (("knob", -1.25, 7.4), ("spring", -0.95, 4.2), ("bonnet", -1.95, 5.0), ("plate", 0.9, 3.27),
                    ("dia", -1.55, 3.03), ("seat", -0.4, 1.52), ("poppet", 0.28, 1.15), ("pspring", -0.3, 0.6),
                    ("inlet", -4.0, 0.85), ("outlet", 4.0, 2.15), ("vent", -1.7, 4.25), ("lochamber", 1.4, 2.8)):
        pin(M, k, x, z)


# ======================================================================
# B 两级减压阀
# ======================================================================
def gauge(model, name, x, z_tap_top, z_c, ch, rng):
    """压力表：表杆在剖切面上，表盘放在剖切面后面朝向观察者，指针绕 y 轴转。"""
    stem = cyl_mesh(0.26, z_tap_top - 0.05, z_c - 1.05, "z", (x, 0, 0), 32)
    part(model, name + "_stem", stem, "brass", holes=[cyl_mesh(0.1, z_tap_top - 0.2, z_c - 0.9, "z", (x, 0, 0), 16)])
    case = revolve([(0, 0.06), (1.2, 0.06), (1.2, 0.75), (0, 0.75)], 64, "y", (x, 0, z_c))
    part(model, name + "_case", case, "ss_dark", cut=False)
    neck = cyl_mesh(0.28, z_c - 1.3, z_c - 1.0, "z", (x, 0.4, 0), 24)
    part(model, name + "_neck", neck, "brass", cut=False)
    face = revolve([(0, 0.035), (1.08, 0.035), (1.08, 0.07), (0, 0.07)], 64, "y", (x, 0, z_c))
    part(model, name + "_face", face, "gauge_face", cut=False, smooth=0)
    ticks = []
    for i in range(11):
        a = math.radians(225 - 27 * i)
        r0, r1 = (0.78 if i % 5 else 0.7), 0.98
        c, sn = math.cos(a), math.sin(a)
        w = 0.035 if i % 5 else 0.06
        px, pz = -sn * w, c * w
        p = [(x + c * r0 + px, z_c + sn * r0 + pz), (x + c * r1 + px, z_c + sn * r1 + pz), (x + c * r1 - px, z_c + sn * r1 - pz), (x + c * r0 - px, z_c + sn * r0 - pz)]
        vv = [(a_, 0.03, b_) for a_, b_ in p] + [(a_, 0.034, b_) for a_, b_ in p]
        ff = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        ticks.append((vv, ff))
    part(model, name + "_ticks", join_vf(*ticks), "tick", cut=False, smooth=0)
    nd = [(-0.04, -0.2), (0.04, -0.2), (0.012, 0.92), (-0.012, 0.92)]
    vv = [(x + a_, 0.0, z_c + b_) for a_, b_ in nd] + [(x + a_, 0.02, z_c + b_) for a_, b_ in nd]
    ff = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    hub = cyl_mesh(0.09, -0.01, 0.03, "y", (x, 0, z_c), 20)
    part(model, name + "_needle", join_vf((vv, ff), hub), "needle", cut=False, origin=(x, 0, z_c), smooth=0)
    mover(model, name + "_needle", kind="ry", ch=ch, a0=math.radians(-135), a1=math.radians(135), rng=rng)
    glass = revolve([(0, -0.02), (1.15, -0.02), (1.15, 0.0), (0, 0.0)], 64, "y", (x, 0, z_c))
    part(model, name + "_glass", glass, "glass", cut=False, smooth=0)


def model_twostg():
    M = "twostg"
    s = ST
    X1, X2 = -3.0, 3.0
    XB, XG = 6.6, 5.95
    body = box_mesh(-XB, XB, -2.45, 2.45, 0.0, s["z_top"])
    cut = station_cutters(X1, in_side=-1, out_side=0, in_len=4.0)
    cut += station_cutters(X2, in_side=0, out_side=+1, out_len=4.0)
    zi, zo = s["z_in"], s["z_out"]
    cut.append(cyl_mesh(s["r_bore"], X1, 0.0, "x", (0, 0, zo), 24))             # 一级出口 → 中间
    cut.append(cyl_mesh(s["r_bore"], zi, zo, "z", (0, 0, 0), 24))               # 竖孔
    cut.append(cyl_mesh(s["r_bore"], 0.0, X2, "x", (0, 0, zi), 24))             # → 二级进口
    cut.append(cyl_mesh(0.1, zi, s["z_top"] + 0.1, "z", (-XG, 0, 0), 16))       # 进口表孔
    cut.append(cyl_mesh(0.1, zo, s["z_top"] + 0.1, "z", (XG, 0, 0), 16))        # 出口表孔
    part(M, "body", body, "brass", holes=cut, smooth=0)
    xl0, _ = fitting_x(M, -1, zi, -XB, name="inlet")
    _, xr1 = fitting_x(M, +1, zo, XB, name="outlet")
    station_parts(M, X1, tag="1", gain_name="h1", dname="d1")
    station_parts(M, X2, tag="2", gain_name="h2", dname="d2")
    spring_bonnet(M, X1, tag="1", knob=False, z_btn=4.6, adj=None, d="d1", spring_turns=5, rm=0.95, rw=0.15)
    spring_bonnet(M, X2, tag="2", knob=True, z_btn=5.0, adj="adj", d="d2")
    gauge(M, "g_in", -XG, s["z_top"], 5.6, "g1", 25.0)
    gauge(M, "g_out", XG, s["z_top"], 5.6, "g2", 1.0)
    statics = [o for o in PARTS if o["model"] == M and o["part"] in ("body", "seat1", "seat2", "inlet", "inlet_nut", "inlet_tube", "outlet", "outlet_nut", "outlet_tube", "g_in_stem", "g_out_stem")]
    hi1, lo1 = station_gas_polys(X1, in_x=xl0)
    hi2, lo2 = station_gas_polys(X2, out_x=xr1)
    hi1.append(rect(-XG - 0.15, -XG + 0.15, zi, s["z_top"] + 0.1))
    lo2.append(rect(XG - 0.15, XG + 0.15, zo, s["z_top"] + 0.1))
    mid = lo1 + [rect(X1, 0.3, zo - 0.25, zo + 0.25), rect(-0.3, 0.3, zi + 0.25, zo - 0.25), rect(-0.3, X2 - s["r_ch"] - 0.05, zi - 0.25, zi + 0.25)] + hi2
    gas(M, "hi", merge_rects(hi1), statics)
    gas(M, "mid", merge_rects(mid), statics)
    gas(M, "lo", merge_rects(lo2), statics)
    for sg in (-1, 1):
        p = [(xl0 + 0.2, zi), (X1 + 0.47 * sg, zi), (X1 + 0.46 * sg, s["z_sb"] - 0.12), (X1 + 0.2 * sg, s["z_sb"] - 0.02),
             (X1 + 0.12 * sg, s["z_st"]), (X1 + 0.2 * sg, zo), (0.0, zo), (0.0, zi), (X2 + 0.47 * sg, zi),
             (X2 + 0.46 * sg, s["z_sb"] - 0.12), (X2 + 0.2 * sg, s["z_sb"] - 0.02), (X2 + 0.12 * sg, s["z_st"]), (X2 + 0.2 * sg, zo), (xr1 - 0.2, zo)]
        path(M, "main", p, w=0.08)
    for k, x, z in (("stage1", X1 - 1.9, 4.6), ("stage2", X2 + 1.9, 4.9), ("knob", X2 - 1.25, 7.4), ("interstage", 0.0, 1.5),
                    ("g_in", -XG, 6.9), ("g_out", XG, 6.9), ("inlet", -8.0, zi), ("outlet", 8.0, zo), ("poppet1", X1 + 0.28, 1.15), ("poppet2", X2 + 0.28, 1.15)):
        pin(M, k, x, z)


# ======================================================================
# C 圆顶加载减压阀
# ======================================================================
def model_dome():
    M = "dome"
    s = ST
    body = revolve([(0, 0), (2.25, 0), (2.4, 0.15), (2.4, s["z_top"] - 0.1), (2.3, s["z_top"]), (0, s["z_top"])], SEG)
    part(M, "body", body, "ss", holes=station_cutters(0.0))
    xl0, _ = fitting_x(M, -1, s["z_in"], -2.4, name="inlet")
    _, xr1 = fitting_x(M, +1, s["z_out"], 2.4, name="outlet")
    station_parts(M, 0.0)
    zt = s["z_top"] + s["t_dia"]
    zc = zt + 0.32
    dome = revolve([(1.9, zt), (2.4, zt), (2.4, zt + 0.45), (2.1, zt + 0.75), (0.55, zt + 0.95), (0.55, zt + 1.0),
                    (0, zt + 1.0), (0, zc), (1.9, zc)], SEG)
    part(M, "domecap", dome, "ss", holes=[cyl_mesh(0.14, zc - 0.1, zt + 1.2, "z", (0, 0, 0), 24)])
    plate = revolve([(0, zt), (s["r_plate"], zt), (s["r_plate"], zt + 0.12), (0, zt + 0.12)], 48)
    part(M, "plate", plate, "plate")
    mover(M, "plate", kind="tz", ch="d", k=1.0)
    fitting_z(M, 0.0, zt + 1.0, length=2.3, name="pilot", tube_mat="ss")
    statics = [o for o in PARTS if o["model"] == M and o["part"] in ("body", "seat", "inlet", "inlet_nut", "inlet_tube", "outlet", "outlet_nut", "outlet_tube", "domecap", "pilot", "pilot_nut", "pilot_tube")]
    hi, lo = station_gas_polys(0.0, in_x=xl0, out_x=xr1)
    gas(M, "hi", merge_rects(hi), statics)
    gas(M, "lo", merge_rects(lo), statics)
    gas(M, "dome", merge_rects([rect(-1.95, 1.95, s["z_top"] + 0.06, zc), rect(-0.2, 0.2, zc, zt + 3.4)]), statics)
    station_paths(M, 0.0, x_in=xl0 + 0.2, x_out=xr1 - 0.2)
    path(M, "dome", [(0.0, zt + 3.2), (0.0, zc - 0.05), (1.2, zc - 0.08)], w=0.05, n=40)
    path(M, "dome", [(0.0, zt + 3.2), (0.0, zc - 0.05), (-1.2, zc - 0.08)], w=0.05, n=40)
    for k, x, z in (("pilot", 0.0, 5.9), ("dome", -1.5, 3.27), ("plate", 0.95, 3.12), ("dia", -1.55, 3.03), ("seat", -0.4, 1.52),
                    ("poppet", 0.28, 1.15), ("inlet", -4.0, 0.85), ("outlet", 4.0, 2.15), ("lochamber", 1.4, 2.8)):
        pin(M, k, x, z)


# ======================================================================
# D 氟树脂气控液体调压阀
# ======================================================================
def model_ptfe():
    M = "ptfe"
    zf, zch1 = 0.95, 1.95            # 进口腔
    zs = 1.95                        # 阀座面（阀芯从下面顶上来）
    ro = 0.35
    zr0, zr1 = 2.75, 3.4             # 出口腔（膜片下方）
    zi, zo = 1.45, 3.0
    R = 3.0
    rd = 2.8
    body = revolve([(0, 0), (R - 0.15, 0), (R, 0.15), (R, zr1), (0, zr1)], SEG)
    cut = [cyl_mesh(0.95, zf - 0.6, zs, "z"),
           cyl_mesh(ro, zs - 0.01, 2.3, "z"),
           cyl_mesh(0.6, 2.3, zr0 + 0.01, "z"),
           cyl_mesh(2.5, zr0, zr1 + 0.3, "z"),
           cyl_mesh(1.32, -0.1, 0.35, "z"),
           cyl_mesh(0.34, -6, 0, "x", (0, 0, zi), 24),
           cyl_mesh(0.34, 0, 6, "x", (0, 0, zo), 24)]
    bolts = []
    for a in range(6):
        t = TAU * (a + 0.5) / 6 if a % 3 else TAU * a / 6
        t = TAU * a / 6
        bolts.append((2.72 * math.cos(t), 2.72 * math.sin(t)))
    bolt_holes = [cyl_mesh(0.17, -1.0, 6.0, "z", (bx, by, 0), 20) for bx, by in bolts]
    part(M, "body", body, "ptfe", holes=cut + bolt_holes)
    # 下盖（PVDF）+ 回位弹簧
    cap = revolve([(0, -0.45), (1.6, -0.45), (1.6, 0.0), (1.3, 0.0), (1.3, 0.35), (0.52, 0.35), (0.52, -0.2), (0, -0.2)], SEG)
    part(M, "bottomcap", cap, "pvdf")
    # 阀芯（PTFE）：锥面顶住阀座孔下缘
    prof = [(0, 0.45), (0.28, 0.45), (0.28, 1.25), (0.62, 1.25), (0.62, zs - 0.17), (0.2, zs + 0.09), (0.2, zr1 - 0.12), (0, zr1 - 0.12)]
    part(M, "poppet", revolve(prof, 48), "ptfe")
    mover(M, "poppet", kind="tz", ch="h", k=-1.0)
    # 波纹管：把弹簧和药液隔开（PTFE），上端跟阀芯一起下移
    bel = revolve(bellows_prof(0.42, 0.85, 0.35, 1.25, 4, 0.06), 48)
    part(M, "bellows", bel, "ptfe", origin=(0, 0, 0.35))
    mover(M, "bellows", kind="spring", L=0.9, bot=None, top="h", kb=0, kt=-1.0)
    sp = helix_half(0.38, 0.06, -0.2, 0.65, 3.0)
    part(M, "pspring", sp[:2], "spring", origin=(0, 0, -0.2), smooth=0, cut=False, capfaces=sp[2])
    mover(M, "pspring", kind="spring", L=0.65, bot=None, top="h", kb=0, kt=-1.0)
    # 膜片（PTFE，中间厚、外圈薄）
    dz0 = zr1
    dprof = [(0, dz0 - 0.12), (0.95, dz0 - 0.12), (0.95, dz0), (rd, dz0), (rd, dz0 + 0.1), (0.95, dz0 + 0.1), (0.95, dz0 + 0.3), (0, dz0 + 0.3)]
    part(M, "dia", revolve(dprof, 64), "ptfe", holes=bolt_holes, kind="dia", extra=dict(cx=0.0, r_in=0.95, r_out=2.5))
    mover(M, "dia", kind="dia", ch="d", k=1.0, cx=0.0, r_in=0.95, r_out=2.5)
    # 上盖（PVDF）：气室 + 气口
    zc0 = dz0 + 0.1
    za = zc0 + 0.4
    cover = revolve([(2.55, zc0), (R, zc0), (R, zc0 + 0.55), (2.3, zc0 + 0.55), (2.1, zc0 + 0.85), (1.0, za + 0.75), (1.0, za + 0.95), (0, za + 0.95), (0, za), (2.55, za)], SEG)
    part(M, "cover", cover, "pvdf", holes=bolt_holes + [cyl_mesh(0.16, za - 0.1, za + 1.2, "z", (0, 0, 0), 24)])
    # 穿心螺栓（剖切面上只能看到左右两根）
    for i, (bx, by) in enumerate(bolts):
        if by < -0.01:
            continue
        bolt = revolve([(0, -0.28), (0.3, -0.28), (0.3, 0.0), (0.16, 0.0), (0.16, zc0 + 0.55), (0.3, zc0 + 0.55), (0.3, zc0 + 0.83),
                        (0.16, zc0 + 0.83), (0.16, zc0 + 0.9), (0, zc0 + 0.9)], 24, "z", (bx, by, 0))
        part(M, f"bolt{i}", bolt, "ss", smooth=30)
    # 管接头：PFA 管 + PVDF 螺母（左右液体）；气口用蓝色 PU 管
    for side, z, nm in ((-1, zi, "inlet"), (1, zo, "outlet")):
        x0 = side * (R - 0.05)
        x1 = side * (R + 1.0)
        x2 = side * (R + 3.0)
        a, b = sorted((x0, x1))
        nut = hex_x(0.85, a, b, z)
        part(M, nm + "_nut", nut, "pvdf", holes=[cyl_mesh(0.48, a - 0.1, b + 0.1, "x", (0, 0, z), 32)], smooth=0)
        a2, b2 = sorted((side * (R + 0.1), x2))
        tube = cyl_mesh(0.48, a2, b2, "x", (0, 0, z))
        part(M, nm + "_tube", tube, "pfa", holes=[cyl_mesh(0.34, a2 - 0.1, b2 + 0.1, "x", (0, 0, z), 32)])
    zt0 = za + 0.95
    part(M, "air_fit", cyl_mesh(0.38, zt0 - 0.05, zt0 + 0.5, "z"), "ss", holes=[cyl_mesh(0.16, zt0 - 0.2, zt0 + 1.2, "z", (0, 0, 0), 24)])
    part(M, "air_nut", hex_z(0.5, zt0 + 0.5, zt0 + 1.1), "ss", holes=[cyl_mesh(0.31, zt0 + 0.4, zt0 + 1.2, "z", (0, 0, 0), 24)], smooth=0)
    part(M, "air_tube", cyl_mesh(0.3, zt0 + 1.0, zt0 + 3.0, "z"), "tube_blue", holes=[cyl_mesh(0.2, zt0 + 0.9, zt0 + 3.1, "z", (0, 0, 0), 24)])
    statics = [o for o in PARTS if o["model"] == M and o["kind"] == "solid" and o["part"] not in ("poppet", "bellows", "pspring", "dia")]
    gas(M, "lin", merge_rects([rect(-R - 3.0, -0.0, zi - 0.4, zi + 0.4), rect(-1.0, 1.0, 0.3, zs)]), statics)
    gas(M, "lout", merge_rects([rect(-0.62, 0.62, zs, zr0), rect(-2.55, 2.55, zr0, dz0), rect(0, R + 3.0, zo - 0.4, zo + 0.4)]), statics)
    gas(M, "air", merge_rects([rect(-2.6, 2.6, zc0, za), rect(-0.22, 0.22, za, zt0 + 3.0)]), statics)
    for sg in (-1, 1):
        path(M, "main", [(-R - 2.8, zi), (0.75 * sg, zi), (0.75 * sg, zs - 0.3), (0.4 * sg, zs - 0.05), (0.28 * sg, 2.3), (0.4 * sg, zo), (R + 2.8, zo)], w=0.2)
    path(M, "air", [(0, zt0 + 2.8), (0, za - 0.1), (1.6, za - 0.2)], w=0.08, n=40)
    path(M, "air", [(0, zt0 + 2.8), (0, za - 0.1), (-1.6, za - 0.2)], w=0.08, n=40)
    for k, x, z in (("air_fit", 0.0, zt0 + 2.3), ("airchamber", -1.8, zc0 + 0.3), ("dia", 1.8, dz0 + 0.05), ("seat", -0.4, zs + 0.05),
                    ("poppet", 0.5, 1.55), ("bellows", -0.85, 0.85), ("pspring", 0.4, 0.0), ("bolt", 2.72, 4.0), ("inlet", -4.5, zi), ("outlet", 4.5, zo),
                    ("bottomcap", -1.4, -0.25), ("lochamber", -1.5, 3.05)):
        pin(M, k, x, z)


# ======================================================================
# E 圆顶加载背压阀（膜片直接密封）
# ======================================================================
def model_bpr():
    M = "bpr"
    zp = 2.0
    zi, zo = 0.75, 1.35
    R = 2.6
    body = revolve([(0, 0), (R - 0.15, 0), (R, 0.15), (R, zp), (0, zp)], SEG)
    cut = [cyl_mesh(0.18, -6, 0.18, "x", (0, 0, zi), 24),
           cyl_mesh(0.18, zi - 0.1, zp + 0.1, "z"),
           revolve([(0.66, zo - 0.13), (0.94, zo - 0.13), (0.94, zo + 0.13), (0.66, zo + 0.13)], 48),
           cyl_mesh(0.15, 0.7, 6, "x", (0, 0, zo), 24)]
    for k in range(8):
        t = TAU * k / 8
        cut.append(cyl_mesh(0.1, zo, zp + 0.1, "z", (0.8 * math.cos(t), 0.8 * math.sin(t), 0), 16))
    part(M, "body", body, "ss", holes=cut)
    xl0, _ = fitting_x(M, -1, zi, -R, name="inlet")
    _, xr1 = fitting_x(M, +1, zo, R, name="outlet")
    dia = revolve([(0, zp), (2.1, zp), (2.1, zp + 0.06), (0, zp + 0.06)], 64)
    part(M, "dia", dia, "ptfe", kind="dia", extra=dict(cx=0.0, r_in=0.95, r_out=1.65))
    mover(M, "dia", kind="dia", ch="d", k=1.0, cx=0.0, r_in=0.95, r_out=1.65)
    zh = zp + 0.06
    zd = zh + 0.32
    ref = revolve([(1.7, zh), (R, zh), (R, zh + 0.5), (2.2, zh + 0.85), (0.55, zh + 1.0), (0.55, zh + 1.05), (0, zh + 1.05), (0, zd), (1.7, zd)], SEG)
    part(M, "refhousing", ref, "ss", holes=[cyl_mesh(0.14, zd - 0.1, zh + 1.3, "z", (0, 0, 0), 24)])
    fitting_z(M, 0.0, zh + 1.05, length=2.0, name="ref")
    statics = [o for o in PARTS if o["model"] == M and o["kind"] == "solid" and o["part"] != "dia"]
    gas(M, "up", merge_rects([rect(xl0, 0.3, zi - 0.25, zi + 0.25), rect(-0.3, 0.3, zi, zp)]), statics)
    gas(M, "dn", merge_rects([rect(-1.0, -0.3, zo - 0.2, zp), rect(0.3, 1.0, zo - 0.2, zp), rect(0.9, xr1, zo - 0.25, zo + 0.25)]), statics)
    gas(M, "dome", merge_rects([rect(-1.75, 1.75, zh, zd), rect(-0.2, 0.2, zd, zh + 3.2)]), statics)
    for sg in (-1, 1):
        path(M, "main", [(xl0 + 0.2, zi), (0.0, zi), (0.0, zp + 0.03), (0.8 * sg, zp + 0.03), (0.8 * sg, zo), (1.6, zo), (xr1 - 0.2, zo)], w=0.05)
    for k, x, z in (("ref", 0.0, 5.3), ("dome", -1.3, zh + 0.18), ("dia", 1.6, zp + 0.03), ("orifice", 0.0, 1.6),
                    ("vents", -0.8, 1.7), ("inlet", -4.0, zi), ("outlet", 4.0, zo)):
        pin(M, k, x, z)


# ======================================================================
# F 开环电气比例阀（比例电磁铁 + 溢流）
# ======================================================================
def model_epopen():
    M = "epopen"
    s = ST
    body = revolve([(0, 0), (2.25, 0), (2.4, 0.15), (2.4, s["z_top"] - 0.1), (2.3, s["z_top"]), (0, s["z_top"])], SEG)
    part(M, "body", body, "alu", holes=station_cutters(0.0))
    xl0, _ = fitting_x(M, -1, s["z_in"], -2.4, name="inlet")
    _, xr1 = fitting_x(M, +1, s["z_out"], 2.4, name="outlet")
    station_parts(M, 0.0, relieving=True)
    zt = s["z_top"] + s["t_dia"]
    # 压板（中心有溢流孔）
    plate = revolve([(0.11, zt), (s["r_plate"], zt), (s["r_plate"], zt + 0.15), (0.4, zt + 0.15), (0.4, zt + 0.35), (0.11, zt + 0.35)], 48)
    part(M, "plate", plate, "plate", holes=[cyl_mesh(0.07, zt + 0.2, zt + 0.3, "x", (0, 0, 0), 12)])
    mover(M, "plate", kind="tz", ch="d", k=1.0)
    # 电磁铁外壳（软铁）
    zb = zt + 0.35
    can = revolve([(1.9, zt), (2.4, zt), (2.4, zt + 0.35), (2.05, zt + 0.35), (2.05, zb + 3.2), (0.32, zb + 3.2), (0.32, zb + 2.95),
                   (1.8, zb + 2.95), (1.8, zt + 0.15), (1.9, zt + 0.15)], SEG)
    part(M, "can", can, "iron", holes=[cyl_mesh(0.09, 1.4, 2.6, "x", (0, 0, zt + 0.25), 16)])
    bob = revolve([(0.62, zb + 0.2), (1.75, zb + 0.2), (1.75, zb + 0.32), (0.75, zb + 0.32), (0.75, zb + 2.6), (1.75, zb + 2.6), (1.75, zb + 2.72), (0.62, zb + 2.72)], 48)
    part(M, "bobbin", bob, "plastic")
    coil = revolve([(0.78, zb + 0.34), (1.7, zb + 0.34), (1.7, zb + 2.58), (0.78, zb + 2.58)], 48)
    part(M, "coil", coil, "coil")
    # 推式比例电磁铁：固定铁芯在下、衔铁在上，通电时衔铁被吸向下方铁芯，推杆穿过铁芯往下推压板
    core = revolve([(0.15, zb + 0.05), (1.8, zb + 0.05), (1.8, zb + 0.2), (0.58, zb + 0.2), (0.58, zb + 1.25), (0.15, zb + 1.25)], 48)
    part(M, "core", core, "iron")
    arm = revolve([(0, zt + 0.35), (0.12, zt + 0.35), (0.12, zb + 1.45), (0.56, zb + 1.45), (0.56, zb + 2.75), (0, zb + 2.75)], 40)
    part(M, "armature", arm, "armature")
    mover(M, "armature", kind="tz", ch="d", k=1.0)
    conn = revolve([(0, zb + 3.2), (0.75, zb + 3.2), (0.75, zb + 3.9), (0.45, zb + 3.9), (0.45, zb + 4.4), (0, zb + 4.4)], 40)
    part(M, "connector", conn, "plastic", smooth=30)
    statics = [o for o in PARTS if o["model"] == M and o["part"] in ("body", "seat", "inlet", "inlet_nut", "inlet_tube", "outlet", "outlet_nut", "outlet_tube", "can")]
    hi, lo = station_gas_polys(0.0, in_x=xl0, out_x=xr1)
    gas(M, "hi", merge_rects(hi), statics)
    gas(M, "lo", merge_rects(lo), statics)
    station_paths(M, 0.0, x_in=xl0 + 0.2, x_out=xr1 - 0.2)
    path(M, "vent", [(0.6, 2.9), (0.0, 2.93), (0.0, zt + 0.25), (1.2, zt + 0.25), (2.6, zt + 0.25)], w=0.03, n=50)
    for k, x, z in (("connector", 0.0, zb + 4.2), ("coil", -1.25, zb + 1.4), ("core", 0.38, zb + 0.75), ("armature", -0.3, zb + 2.1),
                    ("gap", 0.0, zb + 1.35), ("relief", 0.0, 2.95), ("ventport", 2.2, zt + 0.25), ("dia", -1.55, 3.03),
                    ("poppet", 0.28, 1.15), ("inlet", -4.0, 0.85), ("outlet", 4.0, 2.15)):
        pin(M, k, x, z)


# ======================================================================
# G 闭环电气比例阀（两只小电磁阀 + 传感器 + 控制板）
# ======================================================================
def model_epclose():
    M = "epclose"
    s = ST
    W = 2.6
    zt = s["z_top"]
    SG = dict(ST, r_rec=1.6, r_dia=1.75, r_plate=1.0)
    cut = station_cutters(0.0, s=SG, in_len=4.0, out_len=4.0)
    cut.append(cyl_mesh(0.1, s["z_in"], 6.0, "z", (-2.05, 0, 0), 16))           # 供气支路竖孔
    cut.append(cyl_mesh(0.08, s["z_out"], 6.0, "z", (1.95, 0, 0), 16))          # 传感器取压孔
    part(M, "body", box_mesh(-W, W, -W, W, 0, zt), "alu_blue", holes=cut, smooth=0)
    xl0, _ = fitting_x(M, -1, s["z_in"], -W, name="inlet")
    _, xr1 = fitting_x(M, +1, s["z_out"], W, name="outlet")
    station_parts(M, 0.0, relieving=True, s=SG)
    # 中间块：排气腔（通大气）
    z1 = zt + 0.05
    z2 = z1 + 0.7
    mid_cut = [cyl_mesh(1.6, z1 - 0.1, z2 + 0.1, "z"), cyl_mesh(0.22, -W - 1, 0, "x", (0, 0, z1 + 0.35), 24),
               cyl_mesh(0.1, z1 - 1, z2 + 1, "z", (-2.05, 0, 0), 16), cyl_mesh(0.08, z1 - 1, z2 + 1, "z", (1.95, 0, 0), 16)]
    part(M, "midblock", box_mesh(-W, W, -W, W, z1, z2), "alu_blue", holes=mid_cut, smooth=0)
    # 双膜片组件：下膜片感受出口压，上膜片感受先导压，中间隔套有径向孔
    stack = revolve([(0.11, z1), (1.0, z1), (1.0, z1 + 0.12), (0.55, z1 + 0.12), (0.55, z2 - 0.12), (1.0, z2 - 0.12), (1.0, z2),
                     (0, z2), (0, z2 - 0.12), (0.11, z2 - 0.12)], 48)
    part(M, "stack", stack, "plate", holes=[cyl_mesh(0.08, -1, 1, "x", (0, 0, z1 + 0.35), 16)])
    mover(M, "stack", kind="tz", ch="d", k=1.0)
    udia = revolve([(0, z2), (1.75, z2), (1.75, z2 + 0.05), (0, z2 + 0.05)], 64)
    part(M, "udia", udia, "dia", kind="dia", extra=dict(cx=0.0, r_in=1.0, r_out=1.6))
    mover(M, "udia", kind="dia", ch="d", k=1.0, cx=0.0, r_in=1.0, r_out=1.6)
    # 上块：先导腔 + 两个阀口
    z3 = z2 + 0.05
    z4 = z3 + 0.75
    top_cut = [cyl_mesh(1.6, z3 - 0.1, z3 + 0.25, "z"),
               cyl_mesh(0.07, z3 + 0.2, z4 + 0.05, "z", (-1.15, 0, 0), 16), cyl_mesh(0.07, z3 + 0.2, z4 + 0.05, "z", (1.15, 0, 0), 16),
               cyl_mesh(0.1, z3 - 1, z4 + 1, "z", (-2.05, 0, 0), 16), cyl_mesh(0.08, z3 - 1, z4 + 1, "z", (1.95, 0, 0), 16)]
    part(M, "topblock", box_mesh(-W, W, -W, W, z3, z4), "alu_blue", holes=top_cut, smooth=0)
    # 电磁阀座板：内含两个小阀腔、供气横孔、排气横孔
    z5 = z4 + 0.45
    zc = z4 + 0.18
    sv_cut = [cyl_mesh(0.28, z4 - 0.01, z4 + 0.3, "z", (-1.15, 0, 0), 24), cyl_mesh(0.28, z4 - 0.01, z4 + 0.3, "z", (1.15, 0, 0), 24),
              cyl_mesh(0.07, -2.05, -1.15, "x", (0, 0, zc), 16), cyl_mesh(0.1, z4 - 1, zc + 0.08, "z", (-2.05, 0, 0), 16),
              cyl_mesh(0.07, 1.15, W + 0.1, "x", (0, 0, zc), 16), cyl_mesh(0.08, z4 - 1, z5 + 0.1, "z", (1.95, 0, 0), 16),
              cyl_mesh(0.18, z4 + 0.25, z5 + 0.1, "z", (-1.15, 0, 0), 24), cyl_mesh(0.18, z4 + 0.25, z5 + 0.1, "z", (1.15, 0, 0), 24)]
    part(M, "valveplate", box_mesh(-W, W, -1.2, 1.2, z4, z5), "alu", holes=sv_cut, smooth=0)
    for tag, x, ch in (("sv_sup", -1.15, "s1"), ("sv_exh", 1.15, "s2")):
        can = revolve([(0.2, z5), (0.6, z5), (0.6, z5 + 1.5), (0, z5 + 1.5), (0, z5 + 1.3), (0.48, z5 + 1.3), (0.48, z5 + 0.15), (0.2, z5 + 0.15)], 40, "z", (x, 0, 0))
        part(M, tag + "_can", can, "iron")
        coil = revolve([(0.24, z5 + 0.2), (0.46, z5 + 0.2), (0.46, z5 + 1.25), (0.24, z5 + 1.25)], 40, "z", (x, 0, 0))
        part(M, tag + "_coil", coil, "coil")
        plg = revolve([(0, z4), (0.13, z4), (0.13, z4 + 0.07), (0.12, z4 + 0.07), (0.12, z4 + 0.15), (0.16, z4 + 0.15), (0.16, z5 + 0.9), (0, z5 + 0.9)], 32, "z", (x, 0, 0))
        part(M, tag + "_plunger", plg, "armature")
        mover(M, tag + "_plunger", kind="tz", ch=ch, k=1.0)
    # 压力传感器 + 控制板 + 外壳
    sen = revolve([(0.12, z5), (0.42, z5), (0.42, z5 + 0.7), (0, z5 + 0.7), (0, z5 + 0.25), (0.12, z5 + 0.25)], 40, "z", (1.95, 0, 0))
    part(M, "sensor", sen, "sensor")
    die = box_mesh(1.75, 2.15, -0.2, 0.2, z5 + 0.7, z5 + 0.82)
    part(M, "sensor_die", die, "chip", smooth=0)
    zp = z5 + 1.75
    part(M, "pcb", box_mesh(-2.35, 2.35, -1.9, 1.9, zp, zp + 0.1), "pcb", smooth=0)
    chips = join_vf(box_mesh(-1.6, -0.4, -0.8, 0.8, zp + 0.1, zp + 0.3), box_mesh(0.3, 1.0, -0.5, 0.5, zp + 0.1, zp + 0.22), box_mesh(1.3, 1.8, -0.9, 0.9, zp + 0.1, zp + 0.5))
    part(M, "chips", chips, "chip", smooth=0)
    cover = box_mesh(-W, W, -W, W, z5, zp + 1.25)
    part(M, "cover", cover, "plastic", holes=[box_mesh(-W + 0.12, W - 0.12, -W + 0.12, W - 0.12, z5 - 0.1, zp + 1.13)], smooth=0)
    disp = box_mesh(-1.2, 1.2, -0.8, 0.8, zp + 1.25, zp + 1.35)
    part(M, "display", disp, "chip", smooth=0)
    leds = join_vf(*[box_mesh(-1.0 + 0.55 * i, -0.62 + 0.55 * i, -0.45, 0.45, zp + 1.35, zp + 1.37) for i in range(4)])
    part(M, "digits", leds, "led_red", smooth=0)
    m12 = cyl_mesh(0.45, W - 0.1, W + 1.0, "x", (0, 0, zp + 0.5), 32)
    part(M, "connector", m12, "ss_dark")
    exh = cyl_mesh(0.4, -W - 1.1, -W + 0.05, "x", (0, 0, z1 + 0.35), 32)
    part(M, "silencer", exh, "plastic", holes=[cyl_mesh(0.22, -W - 1.2, -W + 0.1, "x", (0, 0, z1 + 0.35), 24)])
    statics = [o for o in PARTS if o["model"] == M and o["kind"] == "solid" and o["part"] in
               ("body", "seat", "inlet", "inlet_nut", "inlet_tube", "outlet", "outlet_nut", "outlet_tube", "midblock", "topblock", "valveplate", "sensor", "silencer")]
    hi, lo = station_gas_polys(0.0, s=dict(ST, r_rec=1.6), in_x=xl0, out_x=xr1)
    hi += [rect(-2.2, -1.9, s["z_in"], zc + 0.1), rect(-2.2, -1.43, zc - 0.1, zc + 0.1), rect(-1.43, -0.87, z4, z4 + 0.33)]
    lo += [rect(1.8, 2.1, s["z_out"], z5 + 0.25)]
    gas(M, "hi", merge_rects(hi), statics)
    gas(M, "lo", merge_rects(lo), statics)
    gas(M, "pilot", merge_rects([rect(-1.62, 1.62, z3, z3 + 0.25), rect(-1.25, -1.05, z3 + 0.25, z4), rect(1.05, 1.25, z3 + 0.25, z4)]), statics)
    gas(M, "exh", merge_rects([rect(-1.62, 1.62, z1, z2), rect(-W - 1.2, -1.62, z1 + 0.1, z1 + 0.6)]), statics)
    gas(M, "pex", merge_rects([rect(0.87, 1.43, z4, z4 + 0.33), rect(1.43, W + 0.2, zc - 0.1, zc + 0.1)]), statics)
    station_paths(M, 0.0, x_in=xl0 + 0.2, x_out=xr1 - 0.2)
    path(M, "sup", [(-2.05, s["z_in"] + 0.1), (-2.05, zc), (-1.15, zc), (-1.15, z3 + 0.12), (-0.3, z3 + 0.12)], w=0.03, n=60)
    path(M, "exs", [(0.3, z3 + 0.12), (1.15, z3 + 0.12), (1.15, zc), (W + 0.2, zc)], w=0.03, n=60)
    path(M, "vent", [(0.5, 2.92), (0.0, 2.93), (0.0, z1 + 0.35), (-1.0, z1 + 0.35), (-W - 1.0, z1 + 0.35)], w=0.04, n=60)
    SPEC[M]["z"] = dict(z1=z1, z2=z2, z3=z3, z4=z4, z5=z5, zp=zp)
    for k, x, z in (("sv_sup", -1.15, z5 + 1.0), ("sv_exh", 1.15, z5 + 1.0), ("pilotch", -0.6, z3 + 0.12), ("udia", 1.3, z2 + 0.02),
                    ("exhch", 0.9, z1 + 0.5), ("silencer", -W - 0.6, z1 + 0.35), ("relief", 0.0, 2.95), ("sensor", 1.95, z5 + 0.5),
                    ("pcb", -1.0, zp + 0.2), ("display", 0.0, zp + 1.36), ("poppet", 0.28, 1.15), ("inlet", -4.2, 0.85), ("outlet", 4.2, 2.15),
                    ("supline", -2.05, 2.5)):
        pin(M, k, x, z)


# ======================================================================
# H 数字式自动压力调节器（压电阀 + 传感器）
# ======================================================================
def model_piezo():
    M = "piezo"
    zb = 2.0
    zf = 0.8
    W = 3.0
    cut = [cyl_mesh(0.15, -W - 1, 0.0, "x", (0, 0, zf), 24),
           cyl_mesh(0.15, zf - 0.15, zb + 0.1, "z"),
           cyl_mesh(0.95, zb - 0.25, zb + 0.2, "z"),
           cyl_mesh(0.12, zf, zb - 0.2, "z", (0.62, 0, 0), 16),
           cyl_mesh(0.15, 0.5, W + 1, "x", (0, 0, zf), 24),
           cyl_mesh(0.1, zf, zb + 0.1, "z", (1.95, 0, 0), 16)]
    part(M, "block", box_mesh(-W, W, -1.4, 1.4, 0, zb), "ss", holes=cut, smooth=0)
    seat = revolve([(0.15, zb - 0.26), (0.32, zb - 0.26), (0.32, zb - 0.12), (0.15, zb - 0.12)], 40)
    # 阀座凸台和本体一体，单独上色方便看
    part(M, "seat", seat, "ss_dark")
    # 金属膜片（夹在本体和阀盖之间）
    dia = revolve([(0, zb), (1.15, zb), (1.15, zb + 0.04), (0, zb + 0.04)], 64)
    part(M, "dia", dia, "dia", kind="dia", extra=dict(cx=0.0, r_in=0.35, r_out=0.95))
    mover(M, "dia", kind="dia", ch="d", k=1.0, cx=0.0, r_in=0.35, r_out=0.95)
    bon = revolve([(0.95, zb + 0.04), (1.35, zb + 0.04), (1.35, zb + 0.9), (0.62, zb + 0.9), (0.62, zb + 3.4), (0.45, zb + 3.4), (0.45, zb + 0.7), (0.95, zb + 0.7)], SEG)
    part(M, "bonnet", bon, "ss")
    plg = revolve([(0, zb + 0.04), (0.3, zb + 0.04), (0.42, zb + 0.15), (0.42, zb + 0.5), (0.3, zb + 0.5), (0.3, zb + 0.62), (0, zb + 0.62)], 40)
    part(M, "plunger", plg, "armature")
    mover(M, "plunger", kind="tz", ch="d", k=1.0)
    # 压电叠堆：几十层陶瓷片 + 电极，通电伸长
    z0 = zb + 0.62
    L = 2.4
    layers = []
    nl = 24
    for i in range(nl):
        a = z0 + L * i / nl
        b = z0 + L * (i + 1) / nl
        layers.append(cyl_mesh(0.3, a, b - 0.025, "z", (0, 0, 0), 32))
    part(M, "piezo", join_vf(*layers), "piezo", origin=(0, 0, z0))
    els = join_vf(*[cyl_mesh(0.31, z0 + L * (i + 1) / nl - 0.025, z0 + L * (i + 1) / nl, "z", (0, 0, 0), 32) for i in range(nl)])
    part(M, "piezo_el", els, "piezo_el", origin=(0, 0, z0), smooth=0)
    mover(M, "piezo", kind="spring", L=L, bot="d", top=None, kb=1.0, kt=0)
    mover(M, "piezo_el", kind="spring", L=L, bot="d", top=None, kb=1.0, kt=0)
    capz = z0 + L
    part(M, "topcap", revolve([(0, capz - 0.02), (0.18, capz - 0.02), (0.18, zb + 3.4), (0.62, zb + 3.4), (0.62, zb + 3.7), (0, zb + 3.7)], 40), "ss_dark")
    # 传感器（电容式，下游取压）
    sen = revolve([(0.1, zb), (0.6, zb), (0.6, zb + 0.95), (0, zb + 0.95), (0, zb + 0.3), (0.45, zb + 0.3), (0.45, zb + 0.18), (0.1, zb + 0.18)], 48, "z", (1.95, 0, 0))
    part(M, "sensor", sen, "sensor")
    sdia = revolve([(0, zb + 0.18), (0.45, zb + 0.18), (0.45, zb + 0.21), (0, zb + 0.21)], 48, "z", (1.95, 0, 0))
    part(M, "sensor_dia", sdia, "dia", smooth=0)
    elec = revolve([(0, zb + 0.26), (0.35, zb + 0.26), (0.35, zb + 0.3), (0, zb + 0.3)], 48, "z", (1.95, 0, 0))
    part(M, "sensor_el", elec, "piezo_el", smooth=0)
    # 外罩 + 控制板 + 接口
    zc1 = zb + 4.4
    part(M, "cover", box_mesh(-W, W, -1.4, 1.4, zb, zc1), "cover", holes=[box_mesh(-W + 0.1, W - 0.1, -1.3, 1.3, zb - 0.1, zc1 - 0.1)], smooth=0)
    part(M, "pcb", box_mesh(0.9, 2.8, -1.1, 1.1, zb + 1.6, zb + 1.7), "pcb", smooth=0)
    part(M, "chips", join_vf(box_mesh(1.2, 2.0, -0.6, 0.6, zb + 1.7, zb + 1.85), box_mesh(2.2, 2.6, -0.4, 0.4, zb + 1.7, zb + 1.8)), "chip", smooth=0)
    part(M, "dsub", box_mesh(-0.9, 0.9, -0.5, 0.5, zc1, zc1 + 0.45), "ss_dark", smooth=0)
    for side, nm in ((-1, "inlet"), (1, "outlet")):
        fitting_x(M, side, zf, side * W, bore=0.15, name=nm)
    statics = [o for o in PARTS if o["model"] == M and o["kind"] == "solid" and o["part"] in
               ("block", "seat", "bonnet", "sensor", "inlet", "inlet_nut", "inlet_tube", "outlet", "outlet_nut", "outlet_tube")]
    gas(M, "hi", merge_rects([rect(-W - 2.4, 0.2, zf - 0.2, zf + 0.2), rect(-0.2, 0.2, zf, zb - 0.12)]), statics)
    gas(M, "lo", merge_rects([rect(-1.0, -0.2, zb - 0.26, zb), rect(0.2, 1.0, zb - 0.26, zb), rect(-0.2, 0.2, zb - 0.12, zb), rect(0.5, W + 2.4, zf - 0.2, zf + 0.2), rect(0.5, 0.75, zf, zb - 0.26), rect(1.85, 2.05, zf, zb + 0.18)]), statics)
    for sg in (1,):
        path(M, "main", [(-W - 2.2, zf), (0.0, zf), (0.0, zb + 0.02), (0.62, zb - 0.1), (0.62, zf), (W + 2.2, zf)], w=0.04)
    path(M, "main", [(-W - 2.2, zf), (0.0, zf), (0.0, zb + 0.02), (-0.62, zb - 0.1), (0.62, zb - 0.12), (0.62, zf), (W + 2.2, zf)], w=0.04)
    for k, x, z in (("piezo", -0.32, zb + 1.8), ("plunger", 0.42, zb + 0.4), ("dia", -0.9, zb + 0.02), ("seat", 0.25, zb - 0.1),
                    ("sensor", 1.95, zb + 0.75), ("pcb", 1.6, zb + 1.9), ("dsub", 0.0, zc1 + 0.3), ("inlet", -4.4, zf), ("outlet", 4.4, zf)):
        pin(M, k, x, z)


# ======================================================================
def finalize():
    pass


def export_glb(path_):
    kw = dict(filepath=path_, export_format="GLB", use_selection=False, export_apply=False, export_yup=True,
              export_extras=True, export_animations=False, export_cameras=False, export_lights=False,
              export_tangents=False, export_normals=True, export_texcoords=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop("export_texcoords")
        bpy.ops.export_scene.gltf(**kw)


# ---------- 渲染预览 ----------
def add_lights(sc):
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (.035, .04, .05, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    sc.world = w
    for name, loc, rot, en, size in (("key", (-14, -26, 22), (1.0, 0, -.45), 5200, 14),
                                     ("fill", (18, -14, 6), (1.35, 0, .95), 2400, 14),
                                     ("rim", (0, 20, 16), (-1.0, 0, 3.14), 1500, 12)):
        l = bpy.data.lights.new(name, "AREA")
        l.energy, l.size = en, size
        o = bpy.data.objects.new(name, l)
        o.location, o.rotation_euler = loc, rot
        sc.collection.objects.link(o)


def frame_model(m, aspect, lens):
    """按包围盒自动取景：从正前方偏右上一点看剖切面。"""
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for o in PARTS:
        if o["model"] != m or o["kind"] == "gas" or "glass" in o["part"]:
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    ctr = (lo + hi) / 2
    size = hi - lo
    hf = 2 * math.atan(18 / lens)
    vf = 2 * math.atan(math.tan(hf / 2) / aspect)
    dist = max(size.x * 1.12 / (2 * math.tan(hf / 2)), size.z * 1.18 / (2 * math.tan(vf / 2))) + size.y * 0.5
    d = Vector((0.24, -1.0, 0.22)).normalized()
    return ctr + d * dist, ctr


def render_all(out_dir, samples, res):
    import numpy as np
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 88
    sc.view_settings.view_transform = "Standard"
    sc.render.resolution_x, sc.render.resolution_y = res
    add_lights(sc)
    cd = bpy.data.cameras.new("cam")
    co = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(co)
    sc.camera = co
    lens = 50
    cd.lens = lens
    files = []
    for m in MODELS:
        for o in PARTS:
            o.hide_render = o["model"] != m or o["kind"] == "gas"
        loc, at = frame_model(m, res[0] / res[1], lens)
        co.location = loc
        co.rotation_euler = (at - loc).to_track_quat("-Z", "Y").to_euler()
        f = os.path.join(out_dir, f"view_{m}.jpg")
        sc.render.filepath = f
        bpy.ops.render.render(write_still=True)
        files.append(f)
        print("rendered", m, flush=True)
    # 八张拼成一张总览（4 列 × 2 行）
    W, H = res
    sheet = np.zeros((H * 2, W * 4, 4), dtype=np.float32)
    for i, f in enumerate(files):
        img = bpy.data.images.load(f)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
        r, c = 1 - i // 4, i % 4                     # Blender 图像原点在左下
        sheet[r * H:(r + 1) * H, c * W:(c + 1) * W] = px
        bpy.data.images.remove(img)
    out = bpy.data.images.new("sheet", W * 4, H * 2)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = os.path.join(out_dir, "view_all.jpg")
    out.file_format = "JPEG"
    out.save()


def parse():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--samples", type=int, default=40)
    ap.add_argument("--res", default="960x640")
    return ap.parse_known_args(argv)[0]


def main():
    global HALF
    args = parse()
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATSET.update(build_materials())
    HALF = mesh_obj("_half", box_mesh(-50, 50, -50, 0.0, -50, 50), None)
    for m in MODELS:
        e = bpy.data.objects.new("ROOT_" + m, None)
        bpy.context.scene.collection.objects.link(e)
        ROOTS[m] = e
    builders = dict(spring=model_spring, twostg=model_twostg, dome=model_dome, ptfe=model_ptfe, bpr=model_bpr,
                    epopen=model_epopen, epclose=model_epclose, piezo=model_piezo)
    only = [x for x in args.only.split(",") if x]
    for m in MODELS:
        if only and m not in only:
            continue
        builders[m]()
        print("built", m, sum(1 for o in PARTS if o["model"] == m), flush=True)
    drop([HALF])
    export_glb(os.path.join(out_dir, "regulators.glb"))
    with open(os.path.join(out_dir, "spec.json"), "w", encoding="utf-8") as fp:
        json.dump(dict(models=SPEC, ST=ST), fp, ensure_ascii=False, indent=1)
    tris = 0
    for o in PARTS:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    print(f"objects={len(PARTS)} tris={tris}")
    for o in PARTS:
        if o["kind"] == "gas":
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        nm = sum(1 for e in bm.edges if not e.is_manifold)
        bm.free()
        ncut = sum(1 for p in o.data.polygons if p.material_index == 1)
        ymin = min((v.co.y for v in o.data.vertices), default=0)
        if nm or (ncut == 0 and o.get("cut", 1)) or ymin < -0.01 and o["part"].find("_case") < 0:
            print("CHECK", o.name, "nonmanifold", nm, "cutfaces", ncut, "ymin", round(ymin, 3))
    if args.render:
        render_all(out_dir, args.samples, tuple(int(v) for v in args.res.split("x")))
    # .blend 里把八台阀沿 x 排开（GLB 里它们都在原点，网页一次只显示一台）；压力区薄片只给网页用，这里藏起来
    for i, m in enumerate(MODELS):
        ROOTS[m].location.x = (i % 4) * 18.0
        ROOTS[m].location.z = -(i // 4) * 14.0
    for o in PARTS:
        o.hide_render = o["kind"] == "gas"
        o.hide_set(o["kind"] == "gas")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "regulators.blend"), compress=True)


main()
