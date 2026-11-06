#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
半导体湿法设备的泵 · Blender 纯脚本建模（教学示意，不对应任何具体型号）

五台泵，结构参考公开专利（页面最后一章列了编号），尺寸是教学用的量级：
    P1 磁力泵        离心叶轮 + 磁力联轴器 + 隔离套，没有轴封
    P2 磁悬浮泵      叶轮悬在液体里，无轴承电机隔着泵壳又托又转
    P3 波纹管泵      压缩空气交替压左右两只 PTFE 波纹管，连杆让两边一起左右走
    P4 气动隔膜泵    两片隔膜一根轴，空气阀自己换向，四个球阀
    P5 电磁计量泵    电磁铁一下一下推隔膜，每下挤出固定的一小口

运行方式（二选一）:
    blender -b -P build_pumps.py -- --out out [--render]
    python  build_pumps.py --out out [--render]      # 需要 pip install bpy

输出:
    pumps.blend   Blender 工程；按空格播放 = 五台泵一起拆开（第 1 帧装配，第 121 帧拆开）
    pumps.glb     给网页用（零件独立命名，extras 里带泵号、零件名、运动方式、爆炸偏移）
    spec.json     每台泵的位置、剖切面、标注点、流线、运动参数（网页读这一份）
    view_*.jpg    只有加 --render 时才渲染（Cycles）

坐标约定:
    尺寸按毫米写，建完缩放成米。+Z 朝上。每台泵在自己的局部坐标里建，再整体平移到 OFFSET。
    会转的零件，物体原点放在转轴上；会平移/伸缩的零件，原点放在固定端，网页只改 location / scale。
"""
import argparse
import json
import math
import os
import sys
from math import cos, pi, radians, sin, sqrt, atan2

import bpy  # 必须排在 bmesh 前面：pip 版 bpy 导入后才注册 bmesh / mathutils
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
_argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
_ap = argparse.ArgumentParser()
_ap.add_argument('--out', default=os.path.join(HERE, 'out'))
_ap.add_argument('--render', action='store_true')
_ap.add_argument('--samples', type=int, default=40)
_ap.add_argument('--res', type=int, default=1400)
_ap.add_argument('--only', default='')
ARGS, _ = _ap.parse_known_args(_argv)
OUT = os.path.abspath(ARGS.out)
os.makedirs(OUT, exist_ok=True)

MM = 0.001
FRAMES = 120
TAU = 2 * pi
SOLVER = os.environ.get('PUMP_BOOL', 'MANIFOLD')

# 五台泵在地板上的位置（mm）。网页里一次只看一台，总览时排成一排
OFFSET = {
    'P1': (-1450.0, 0.0, 0.0),
    'P2': (-760.0, 40.0, 0.0),
    'P3': (0.0, 0.0, 0.0),
    'P4': (760.0, 20.0, 0.0),
    'P5': (1350.0, 40.0, 0.0),
}


# ================================================================ 工具
def reset():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.cameras,
                 bpy.data.lights, bpy.data.worlds, bpy.data.images):
        for d in list(coll):
            coll.remove(d)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


def collection(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip('#')
    return tuple(_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def principled(name, hexc, metal=0.0, rough=0.5, coat=0.0, emit=None, alpha=None, trans=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    col = hexcol(hexc)

    def put(names, v):
        for n in names:
            s = b.inputs.get(n)
            if s is not None:
                s.default_value = v
                return

    put(['Base Color'], (*col, 1.0))
    put(['Metallic'], metal)
    put(['Roughness'], rough)
    if coat > 0:
        put(['Coat Weight', 'Clearcoat'], coat)
    if trans > 0:
        put(['Subsurface Weight', 'Subsurface'], trans)
    if emit:
        put(['Emission Color', 'Emission'], (*hexcol(emit[0]), 1))
        put(['Emission Strength'], emit[1])
    if alpha is not None:
        put(['Alpha'], alpha)
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    m.diffuse_color = (*col, 1.0)
    return m


def make_materials():
    # 颜色按“角色”分，五台泵通用：
    #   暖白 = 接液的氟树脂（PTFE/PFA/ETFE）   琥珀 = 会动、接液的零件（叶轮、波纹管、隔膜）
    #   红/蓝 = 磁铁 N/S                        深钢 = 电机、空气侧金属
    return dict(
        ptfe=principled('PTFE', '#ece9e1', rough=.62, trans=.05),
        pfa=principled('PFA', '#dfe6ea', rough=.35, coat=.3),
        move=principled('Moving', '#f0a43a', rough=.45),
        moveD=principled('MovingDark', '#c97b1c', rough=.5),
        magN=principled('MagnetN', '#e5484d', rough=.4, metal=.2),
        magS=principled('MagnetS', '#3e7bfa', rough=.4, metal=.2),
        ceramic=principled('Ceramic', '#f7f7f2', rough=.18, coat=.6),
        carbon=principled('Carbon', '#2b2d31', rough=.55),
        motor=principled('Motor', '#3a4f66', metal=.55, rough=.42),
        motorD=principled('MotorDark', '#253546', metal=.5, rough=.5),
        steel=principled('Steel', '#9aa4ad', metal=.85, rough=.36),
        steelD=principled('SteelDark', '#5d666f', metal=.8, rough=.45),
        alu=principled('Alu', '#b7c0c8', metal=.85, rough=.32),
        iron=principled('Iron', '#59606a', metal=.75, rough=.5),
        copper=principled('Copper', '#c8743a', metal=.9, rough=.33),
        coil=principled('Coil', '#b8652f', metal=.7, rough=.42),
        pp=principled('PP', '#cfd5d9', rough=.6),
        pvdf=principled('PVDF', '#e8e3d6', rough=.5, trans=.08),
        rubber=principled('Rubber', '#1d2025', rough=.85),
        base=principled('Base', '#2a3442', metal=.35, rough=.55),
        housing=principled('Housing', '#d9dde2', rough=.48, coat=.2),
        housingD=principled('HousingDark', '#7d8792', metal=.3, rough=.5),
        panel=principled('Panel', '#1b2430', rough=.4),
        lcd=principled('LCD', '#163b2e', rough=.25, emit=('#4fd18b', 1.6)),
        led=principled('LED', '#4cc9f0', rough=.3, emit=('#4cc9f0', 3.0)),
        tube=principled('Tube', '#d6ebf5', rough=.25, trans=.2),
        airtube=principled('AirTube', '#3c86c9', rough=.45),
        brass=principled('Brass', '#c9a24a', metal=.9, rough=.35),
        sensor=principled('Sensor', '#22303f', rough=.4),
        knob=principled('Knob', '#d9483b', rough=.45),
        label=principled('Label', '#f2f4f7', rough=.6),
    )


def shade(me, ang):
    try:
        me.shade_smooth()
    except AttributeError:
        for p in me.polygons:
            p.use_smooth = True
    if hasattr(me, 'set_sharp_from_angle'):
        me.set_sharp_from_angle(angle=radians(ang))


OBJS = []          # (object, pump)
PARTS = {}         # name -> dict(pump, cn, role, mov, ex)


def _fin_mesh(name, bm, mats, ang):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.validate(clean_customdata=False)
    shade(me, ang)
    return me


def add(name, bm, mats, pump, cn, role='static', pivot=(0, 0, 0), mov='', ex=(0, 0, 0), ang=32, extras=None):
    """bm 用泵的局部坐标（mm）建；pivot 是物体原点（局部 mm）"""
    pv = Vector(pivot)
    bmesh.ops.translate(bm, vec=-pv, verts=list(bm.verts))
    me = _fin_mesh(name, bm, mats, ang)
    me.transform(Matrix.Scale(MM, 4))
    return place(name, me, pump, cn, role, pv, mov, ex, extras)


def place(name, me, pump, cn, role, pv, mov, ex, extras):
    ob = bpy.data.objects.new(name, me)
    collection(pump).objects.link(ob)
    ob.location = (Vector(OFFSET[pump]) + pv) * MM
    ob['pump'] = pump
    ob['cn'] = cn
    ob['role'] = role
    if mov:
        ob['mov'] = mov
    ob['ex'] = [float(v) for v in ex]
    for k, v in (extras or {}).items():
        ob[k] = v
    OBJS.append((ob, pump))
    PARTS[name] = dict(pump=pump, cn=cn, role=role, mov=mov, ex=list(ex), pivot=list(pv))
    return ob


def _axis_pt(axis, c, r, t, a):
    u, v = r * cos(t), r * sin(t)
    if axis == 'X':
        return (c[0] + a, c[1] - v, c[2] + u)
    if axis == 'Y':
        return (c[0] - u, c[1] + a, c[2] + v)
    return (c[0] + u, c[1] + v, c[2] + a)


def revolve(bm, prof, c=(0, 0, 0), axis='Z', seg=48, mi=0, closed=False, t0=0.0, t1=None):
    """回转体。prof=[(半径, 轴向)]；半径为 0 的点收成一个极点。
    closed=True 时首尾相连（用于不碰轴的环形截面）。
    角度约定：axis='Y' 时 t=0 指向 -X、t=90° 指向 +Z（正面看逆时针为正）；
              axis='X' 时 t=0 指向 +Z；axis='Z' 时 t=0 指向 +X。"""
    full = t1 is None
    n = seg if full else seg + 1
    span = TAU if full else (t1 - t0)
    rings = []
    for (r, a) in prof:
        if r < 1e-6:
            rings.append([bm.verts.new(_axis_pt(axis, c, 0, 0, a))])
        else:
            rings.append([bm.verts.new(_axis_pt(axis, c, r, t0 + span * k / seg, a)) for k in range(n)])
    fs = []
    pairs = [(rings[i], rings[i + 1]) for i in range(len(rings) - 1)]
    if closed:
        pairs.append((rings[-1], rings[0]))
    m = seg
    for A, B in pairs:
        for k in range(m):
            k1 = (k + 1) % n if full else k + 1
            if len(A) == 1 and len(B) == 1:
                continue
            if len(A) == 1:
                f = bm.faces.new((A[0], B[k1], B[k]))
            elif len(B) == 1:
                f = bm.faces.new((A[k], A[k1], B[0]))
            else:
                f = bm.faces.new((A[k], A[k1], B[k1], B[k]))
            f.material_index = mi
            f.smooth = True
            fs.append(f)
    if not full:
        # 扇形的两个端面
        for k in (0, seg):
            loop = [rg[0] if len(rg) == 1 else rg[k] for rg in rings]
            uniq = []
            for v in loop:
                if v not in uniq:
                    uniq.append(v)
            if len(uniq) >= 3:
                try:
                    f = bm.faces.new(uniq)
                    f.material_index = mi
                    fs.append(f)
                except ValueError:
                    pass
    if not closed and full:
        for rg in (rings[0], rings[-1]):
            if len(rg) > 2:
                f = bm.faces.new(rg)
                f.material_index = mi
                fs.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def ring(bm, r0, r1, a0, a1, c=(0, 0, 0), axis='Z', seg=48, mi=0):
    return revolve(bm, [(r0, a0), (r1, a0), (r1, a1), (r0, a1)], c, axis, seg, mi, closed=True)


def disc(bm, r, a0, a1, c=(0, 0, 0), axis='Z', seg=48, mi=0):
    return revolve(bm, [(0, a0), (r, a0), (r, a1), (0, a1)], c, axis, seg, mi)


def sector(bm, r0, r1, t0, t1, a0, a1, c=(0, 0, 0), axis='Z', seg=8, mi=0):
    return revolve(bm, [(r0, a0), (r1, a0), (r1, a1), (r0, a1)], c, axis, seg, mi, closed=True, t0=t0, t1=t1)


def box(bm, c, s, mi=0, r=0.0, seg=2, rot=None):
    """盒子。c 中心，s 全尺寸；r>0 倒圆角。rot=[(轴, 角度°), ...]"""
    before = set(bm.verts)
    g = bmesh.ops.create_cube(bm, size=1)
    vs = g['verts']
    bmesh.ops.scale(bm, vec=Vector(s), verts=vs)
    if r > 0:
        es = list({e for v in vs for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=vs + es, offset=r, segments=seg, profile=.5, affect='EDGES', clamp_overlap=True)
    vs = [v for v in bm.verts if v not in before]
    allf = list({f for v in vs for f in v.link_faces})
    for f in allf:
        f.material_index = mi
        f.smooth = r > 0
    for ax, deg in (rot or []):
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(radians(deg), 3, ax))
    bmesh.ops.translate(bm, vec=Vector(c), verts=vs)
    return vs


def cyl(bm, p0, p1, r0, r1=None, mi=0, seg=24, smooth=True):
    p0, p1 = Vector(p0), Vector(p1)
    r1 = r0 if r1 is None else r1
    d = p1 - p0
    g = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=d.length)
    vs = g['verts']
    q = d.to_track_quat('Z', 'Y')
    bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, vec=(p0 + p1) / 2, verts=vs)
    for f in {f for v in vs for f in v.link_faces}:
        f.material_index = mi
        f.smooth = smooth
    return vs


def ball(bm, c, r, mi=0, seg=20):
    g = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(8, seg // 2), radius=r)
    vs = g['verts']
    bmesh.ops.translate(bm, vec=Vector(c), verts=vs)
    for f in {f for v in vs for f in v.link_faces}:
        f.material_index = mi
        f.smooth = True
    return vs


def hexbolt(bm, p, d, s=10.0, h=6.0, mi=0):
    """六角螺栓头。p 底面中心，d 朝外方向"""
    p, d = Vector(p), Vector(d).normalized()
    g = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=6, radius1=s / sqrt(3), radius2=s / sqrt(3), depth=h)
    vs = g['verts']
    q = d.to_track_quat('Z', 'Y')
    bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, vec=p + d * h / 2, verts=vs)
    for f in {f for v in vs for f in v.link_faces}:
        f.material_index = mi
        f.smooth = False
    return vs


def _frames(path):
    """沿折线的平行移动坐标系"""
    P = [Vector(p) for p in path]
    T = []
    for i in range(len(P)):
        a = P[max(i - 1, 0)]
        b = P[min(i + 1, len(P) - 1)]
        T.append((b - a).normalized())
    up = Vector((0, 0, 1)) if abs(T[0].z) < .9 else Vector((1, 0, 0))
    N = [(up - T[0] * up.dot(T[0])).normalized()]
    for i in range(1, len(P)):
        n = N[-1] - T[i] * N[-1].dot(T[i])
        if n.length < 1e-9:
            n = N[-1]
        N.append(n.normalized())
    Bn = [T[i].cross(N[i]) for i in range(len(P))]
    return P, T, N, Bn


def sweep(bm, path, radii, seg=24, mi=0, caps=True):
    """圆截面沿折线扫掠，两端封口。radii 可以是数或与 path 等长的列表"""
    P, T, N, Bn = _frames(path)
    if not isinstance(radii, (list, tuple)):
        radii = [radii] * len(P)
    rings = []
    for i in range(len(P)):
        rings.append([bm.verts.new(P[i] + radii[i] * (cos(TAU * k / seg) * N[i] + sin(TAU * k / seg) * Bn[i]))
                      for k in range(seg)])
    fs = []
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(seg):
            f = bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
            f.material_index = mi
            f.smooth = True
            fs.append(f)
    if caps:
        for rg in (rings[0], rings[-1]):
            f = bm.faces.new(rg)
            f.material_index = mi
            fs.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def helix(bm, c, r_coil, r_wire, a0, a1, turns, axis='X', mi=0, seg=10, k=24):
    pts = []
    n = int(turns * k) + 1
    for i in range(n):
        t = TAU * turns * i / (n - 1)
        a = a0 + (a1 - a0) * i / (n - 1)
        pts.append(_axis_pt(axis, c, r_coil, t, a))
    return sweep(bm, pts, r_wire, seg=seg, mi=mi)


def tmp_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def boolean(base_bm, unions=(), cuts=(), name='bool'):
    """exact 布尔：base ∪ unions − cuts，返回新 bmesh（局部坐标不变）"""
    ob = tmp_obj(name + '_base', base_bm)
    tmps = []
    for i, (op, items) in enumerate((('UNION', unions), ('DIFFERENCE', cuts))):
        for j, bmx in enumerate(items):
            t = tmp_obj(f'{name}_{op}_{j}', bmx)
            t.hide_render = True
            tmps.append(t)
            md = ob.modifiers.new(f'{op}{j}', 'BOOLEAN')
            md.operation = op
            md.object = t
            try:
                md.solver = SOLVER          # MANIFOLD 要 Blender 4.5 以上，旧版退回 EXACT
            except TypeError:
                md.solver = 'EXACT'
            try:
                md.use_self = True
                md.use_hole_tolerant = True
            except AttributeError:
                pass
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    out = bmesh.new()
    out.from_mesh(me)
    bpy.data.meshes.remove(me)
    for t in tmps:
        bpy.data.objects.remove(t, do_unlink=True)
    bpy.data.objects.remove(ob, do_unlink=True)
    return out


def bm_from(*fns):
    bm = bmesh.new()
    for f in fns:
        f(bm)
    return bm


def merge(bm_dst, bm_src):
    me = bpy.data.meshes.new('tmp_merge')
    bm_src.to_mesh(me)
    bm_src.free()
    bm_dst.from_mesh(me)
    bpy.data.meshes.remove(me)
    return bm_dst


def setmat(bm, mi):
    for f in bm.faces:
        f.material_index = mi
    return bm


def L(pump, p):
    """局部 mm → 世界 mm"""
    o = OFFSET[pump]
    return [round(o[0] + p[0], 2), round(o[1] + p[1], 2), round(o[2] + p[2], 2)]


def polyline(pump, pts, pres):
    """流线：世界 mm 坐标 + 每点的相对压力 0..1"""
    return dict(p=[L(pump, q) for q in pts], s=[round(float(s), 3) for s in pres])


SPEC = {}


# ================================================================ P1 磁力泵
# 结构参考：Iwaki US5464333 / US6843645 / US7249939（隔离套做成多层、固定轴前后两端支撑、
# 口环顶在前推力环上、液体从叶轮背后绕过内磁铁、穿过轴承回到吸入口）
def p1_vane_theta(r, th0, r1=22.0, beta=36.0):
    # 后弯叶片：半径越大，角度越往转向的反方向退
    return th0 - math.log(r / r1) / math.tan(radians(beta))


def vane_block(bm, pts_lo, pts_hi, y0, y1_of, axis_fn, mi=0):
    """叶片：两条边线（中心线左右偏移）在两个轴向高度之间拉成实体"""
    vb = []
    for (r, th) in pts_lo + pts_hi[::-1]:
        a0, a1 = y0, y1_of(r)
        vb.append((bm.verts.new(axis_fn(r, th, a0)), bm.verts.new(axis_fn(r, th, a1))))
    n = len(vb)
    fs = [bm.faces.new((vb[i][0], vb[(i + 1) % n][0], vb[(i + 1) % n][1], vb[i][1])) for i in range(n)]
    fs.append(bm.faces.new([v[0] for v in vb][::-1]))
    fs.append(bm.faces.new([v[1] for v in vb]))
    for f in fs:
        f.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=fs)


def build_p1(M):
    P = 'P1'
    ZA = 150.0                       # 轴心高度
    C = (0, 0, ZA)
    S = {}
    # ---- 底座、支脚
    bm = bm_from(lambda b: box(b, (0, -95, 9), (250, 570, 18), r=3))
    add('P1_Base', bm, [M['base']], P, '底座', 'frame')
    bm = bmesh.new()
    for y in (-275, -170):
        box(bm, (0, y, 49), (150, 40, 62), r=3)
    box(bm, (0, -75, 40), (150, 26, 44), r=3)        # 托架脚
    box(bm, (0, -15, 29), (130, 26, 22), r=3)        # 泵壳脚
    add('P1_Feet', bm, [M['motorD']], P, '支脚', 'frame')

    # ---- 电机
    bm = bmesh.new()
    revolve(bm, [(0, -382), (52, -381), (66, -376), (73, -366), (75, -346), (75, -312)], C, 'Y', 48, 1)   # 风扇罩
    revolve(bm, [(0, -312), (71, -312), (71, -122), (0, -122)], C, 'Y', 48, 0)                          # 机座
    revolve(bm, [(0, -122), (80, -122), (82, -118), (82, -114), (40, -112), (0, -112)], C, 'Y', 48, 0)  # 前端盖
    for k in range(22):
        t = radians(-60 + 300 * k / 21)               # 底部留给支脚
        u = Vector((-cos(t), 0, sin(t)))
        box(bm, Vector(C) + u * 75 + Vector((0, -217, 0)), (3.2, 180, 12), mi=0, rot=[('Y', -math.degrees(t) + 90)])
    box(bm, (0, -215, ZA + 92), (86, 96, 44), mi=0, r=4)                    # 接线盒
    box(bm, (0, -215, ZA + 116), (90, 100, 6), mi=1, r=2)
    for k in range(10):                                                     # 风扇罩格栅
        t = TAU * k / 10
        box(bm, Vector(C) + Vector((-cos(t) * 40, -383, sin(t) * 40)), (4, 3, 46), mi=1, rot=[('Y', -math.degrees(t) + 90)])
    add('P1_Motor', bm, [M['motor'], M['motorD']], P, '电机', 'drive', ex=(0, -210, 0))

    # ---- 托架（电机和泵头之间的连接壳，里面转着外磁铁）
    bm = bmesh.new()
    revolve(bm, [(84, -106), (92, -106), (92, -44), (106, -44), (106, -30), (84, -30)], C, 'Y', 64, 0, closed=True)
    ring(bm, 14, 92, -112, -106, C, 'Y', 64, 0)
    add('P1_Bracket', bm, [M['steelD']], P, '托架', 'frame', ex=(0, -60, 0), extras={'ghost': 1})

    # ---- 外磁铁（主动侧，装在电机轴上）
    bm = bmesh.new()
    revolve(bm, [(0, -112), (12, -112), (12, -96), (0, -96)], C, 'Y', 32, 0)      # 电机轴伸
    ring(bm, 12, 64, -102, -96, C, 'Y', 64, 0)                                     # 轮毂
    ring(bm, 56.2, 64, -102, -38, C, 'Y', 64, 0)                                   # 轭铁
    for k in range(8):
        t0 = TAU * k / 8 + radians(1.2)
        sector(bm, 48.5, 56.0, t0, t0 + TAU / 8 - radians(2.4), -84, -40, C, 'Y', 6, 1 + (k % 2))
    add('P1_OuterMagnet', bm, [M['steel'], M['magN'], M['magS']], P, '外磁铁（主动）', 'drive',
        pivot=C, mov='rotO', ex=(0, -140, 0))

    # ---- 隔离套（后壳）：内层氟树脂接液，外层纤维增强壳扛压力
    bm = bmesh.new()
    revolve(bm, [(0, -90), (39.5, -90), (39.5, -30), (84, -30), (84, -36), (42, -36), (42, -93), (0, -93)], C, 'Y', 72, 0)
    revolve(bm, [(0, -90), (11, -90), (11, -87), (0, -87)], C, 'Y', 32, 0)        # 后轴座
    add('P1_Can', bm, [M['ptfe']], P, '隔离套 · 内层（氟树脂）', 'wet', ex=(0, 0, 0))
    bm = bm_from(lambda b: revolve(b, [(0, -93), (42, -93), (42, -36), (44, -36), (44, -95), (0, -95)], C, 'Y', 72, 0))
    add('P1_CanOuter', bm, [M['carbon']], P, '隔离套 · 外层（纤维增强）', 'frame', ex=(0, 0, 0))

    # ---- 固定轴（陶瓷），后端插在隔离套底的轴座里，前端由三爪支架托住
    bm = bmesh.new()
    revolve(bm, [(0, -89), (8, -89), (8, 10), (5, 13), (0, 13)], C, 'Y', 32, 0)
    for k in range(3):
        t = radians(90 + 120 * k)
        u = Vector((-cos(t), 0, sin(t)))
        box(bm, Vector(C) + u * 15.5 + Vector((0, 7, 0)), (3, 8, 18), mi=1, rot=[('Y', -math.degrees(t) + 90)])
    ring(bm, 8, 11, 3, 11, C, 'Y', 32, 1)
    add('P1_Spindle', bm, [M['ceramic'], M['pfa']], P, '固定轴（陶瓷）', 'wet', ex=(0, 40, 0))

    # ---- 内磁铁（从动侧，包在氟树脂里）
    bm = bmesh.new()
    ring(bm, 14, 22, -84, -28, C, 'Y', 48, 0)        # 内套
    ring(bm, 35, 37, -84, -33, C, 'Y', 64, 0)        # 外皮
    ring(bm, 22, 35, -84, -82, C, 'Y', 48, 0)        # 后端
    ring(bm, 22, 37, -33.2, -28, C, 'Y', 64, 0)      # 前端
    for k in range(8):
        t0 = TAU * k / 8 + radians(1.2)
        sector(bm, 23, 34.6, t0, t0 + TAU / 8 - radians(2.4), -81.6, -38, C, 'Y', 6, 1 + ((k + 1) % 2))   # 和外磁铁异极相对
    add('P1_InnerMagnet', bm, [M['moveD'], M['magN'], M['magS']], P, '内磁铁（从动）', 'wet',
        pivot=C, mov='rotI', ex=(0, 130, 0))

    # ---- 滑动轴承：压在内磁铁里跟着转，滑在固定轴上；后推力环顶着轴座
    bm = bmesh.new()
    ring(bm, 8.25, 13.9, -82, -35, C, 'Y', 48, 0)
    ring(bm, 8.25, 16, -87, -84, C, 'Y', 48, 1)
    add('P1_Bearing', bm, [M['carbon'], M['ceramic']], P, '滑动轴承', 'wet', pivot=C, mov='rotI', ex=(0, 130, 0))

    # ---- 叶轮：后盖板 + 轮毂、前盖板 + 口环、6 片后弯叶片
    bm = bmesh.new()
    revolve(bm, [(8.3, -28), (72, -28), (72, -25.2), (21, -25.2), (16.5, -12), (8.3, -12)], C, 'Y', 72, 0, closed=True)
    revolve(bm, [(26, -11.2), (72, -15.2), (72, -12.4), (29, -8.2), (29, -2.5), (26, -2.5)], C, 'Y', 72, 0, closed=True)
    for k in range(6):
        th0 = TAU * k / 6
        rs = [22 + (71.6 - 22) * i / 18 for i in range(19)]
        lo = [(r, p1_vane_theta(r, th0) - 1.6 / r) for r in rs]
        hi = [(r, p1_vane_theta(r, th0) + 1.6 / r) for r in rs]
        vane_block(bm, lo, hi, -25.6,
                   lambda r: min(-11.0, -11.2 - 4.0 * (r - 26) / 46 + .6) if r > 26 else -12.0,
                   lambda r, th, a: _axis_pt('Y', C, r, th, a))
    add('P1_Impeller', bm, [M['move']], P, '叶轮', 'wet', pivot=C, mov='rotI', ex=(0, 130, 0), ang=40)

    # ---- 前推力环（陶瓷，嵌在泵壳里，叶轮口环顶着它转）
    bm = bm_from(lambda b: ring(b, 21.5, 31, -2.2, 1.5, C, 'Y', 48, 0))
    add('P1_Thrust', bm, [M['ceramic']], P, '前推力环', 'wet', ex=(0, 190, 0))

    # ---- 泵壳（蜗壳）：外形 ∪ 出口接管，减去叶轮腔、螺旋流道、进口孔
    YV = -17.0
    TH_T = radians(30)                        # 隔舌位置

    def vol_a(u):
        return 3.2 + 7.2 * u

    def vol_R(u):                             # 流道内侧贴着叶轮外圈，越往后截面越大
        return 75 + vol_a(u)
    body = bm_from(lambda b: revolve(b, [(0, -30), (106, -30), (110, -27), (110, -7), (106, -3), (40, -1.5),
                                         (28, 3), (27, 78), (50, 78), (50, 90), (0, 90)], C, 'Y', 72, 0))
    XD = -vol_R(1.0)
    noz = bm_from(lambda b: cyl(b, (XD, -15, ZA + 20), (XD, -15, ZA + 128), 15, seg=40),
                  lambda b: cyl(b, (XD, -15, ZA + 126), (XD, -15, ZA + 140), 36, seg=40))
    cav = bm_from(lambda b: revolve(b, [(0, -42), (77, -42), (77, -10), (31, -6.2), (31, 1.5), (21.5, 1.5),
                                        (21.5, 100), (0, 100)], C, 'Y', 72, 0))
    spiral, sp_r = [], []
    nS = 64
    for i in range(nS + 1):
        u = i / nS
        p = _axis_pt('Y', C, vol_R(u), TH_T + (TAU - TH_T) * u, 0)
        spiral.append((p[0], YV, p[2]))
        sp_r.append(vol_a(u))
    for j in range(1, 9):                     # 出口段：从螺旋末端沿切线（向上）拉直
        spiral.append((XD, YV, ZA + 16 * j))
        sp_r.append(vol_a(1.0))
    spiral.append((XD, YV, ZA + 150))
    sp_r.append(vol_a(1.0))
    sp = bm_from(lambda b: sweep(b, spiral, sp_r, seg=28))
    bm = boolean(body, unions=[noz], cuts=[cav, sp], name='P1vol')
    setmat(bm, 0)
    for k in range(8):
        t = TAU * k / 8 + radians(22.5)
        p = Vector(_axis_pt('Y', C, 100, t, 0))
        hexbolt(bm, (p.x, -3.6, p.z), (0, 1, 0), s=11, h=6, mi=1)
    add('P1_Casing', bm, [M['ptfe'], M['steel']], P, '泵壳（蜗壳）', 'wet', ex=(0, 260, 0), ang=40)

    # ---- 进出口短管（透明）
    bm = bmesh.new()
    ring(bm, 21.5, 27, 90, 160, C, 'Y', 40, 0)
    ring(bm, 10.5, 15, ZA + 140, ZA + 205, (XD, YV, 0), 'Z', 32, 0)
    add('P1_Pipes', bm, [M['tube']], P, '进出口配管', 'pipe', ex=(0, 260, 0), extras={'ghost': 1})

    # ---- 流线
    flows = []
    jit = [0.15, 0.5, 0.85]
    for i in range(9):
        t_in = TAU * i / 9 + .3
        r_in = 5 + 13 * jit[i % 3]
        pts, pres = [], []
        for y in (175, 130, 80, 40, 12, -1):
            pts.append(_axis_pt('Y', C, r_in, t_in, y)); pres.append(.03)
        for (rr, yy) in ((r_in + 3, -6), (24, -13), (27, -18)):
            pts.append(_axis_pt('Y', C, rr, t_in, yy)); pres.append(.06)
        th = t_in
        for j in range(14):
            r = 27 + (72 - 27) * (j + 1) / 14
            th += radians(6.0)
            pts.append(_axis_pt('Y', C, r, th, -18)); pres.append(.08 + .55 * (j + 1) / 14)
        th = th % TAU
        if th < TH_T + .05:
            th += TAU
        u = (th - TH_T) / (TAU - TH_T)
        while u < 1.0:
            u = min(1.0, u + .035)
            pts.append(_axis_pt('Y', C, vol_R(u) + (jit[i % 3] - .5) * 2 * vol_a(u) * .6, TH_T + (TAU - TH_T) * u, YV))
            pres.append(.66 + .26 * u)
        for z in (24, 60, 100, 140, 190):
            pts.append((XD + (jit[i % 3] - .5) * 9, YV, ZA + z)); pres.append(.96)
        flows.append(polyline(P, pts, pres))
    # 内部循环：叶轮背后（高压）→ 内磁铁外圈缝 → 隔离套底 → 轴承缝 → 叶轮眼（低压）
    circ = []
    for i in range(4):
        t = TAU * i / 4 + .4
        pts = [(70, -29.1), (52, -29.1), (38.4, -31), (38.4, -48), (38.4, -66), (38.4, -86), (26, -88.4),
               (14, -88.6), (8.13, -86), (8.13, -62), (8.13, -38), (8.13, -16), (9.5, -10), (14, -6), (19, -3)]
        q = [_axis_pt('Y', C, r, t + .16 * j, a) for j, (r, a) in enumerate(pts)]
        circ.append(polyline(P, q, [.62 - .04 * j for j in range(len(q))]))
    S['flows'] = {'main': flows, 'circ': circ}
    S['axis'] = dict(p=L(P, C), d=[0, 1, 0])
    S['cuts'] = {
        'long': dict(cn='纵剖', n=[1, 0, 0], p=L(P, C)),
        'front': dict(cn='横剖', n=[0, 1, 0], p=L(P, (0, -16.5, ZA))),
    }
    S['pins'] = [
        dict(t='电机', p=L(P, (0, -250, ZA + 128)), part='P1_Motor'),
        dict(t='外磁铁（主动）', p=L(P, (0, -66, ZA + 76)), part='P1_OuterMagnet'),
        dict(t='内磁铁（从动）', p=L(P, (0, -56, ZA - 30)), part='P1_InnerMagnet'),
        dict(t='隔离套', p=L(P, (0, -64, ZA + 46)), part='P1_Can'),
        dict(t='固定轴 · 轴承', p=L(P, (0, -60, ZA + 4)), part='P1_Spindle'),
        dict(t='叶轮', p=L(P, (0, -20, ZA + 52)), part='P1_Impeller'),
        dict(t='蜗壳', p=L(P, (0, -10, ZA - 96)), part='P1_Casing'),
        dict(t='进口', p=L(P, (0, 140, ZA + 34)), part='P1_Pipes'),
        dict(t='出口', p=L(P, (XD, YV, ZA + 176)), part='P1_Pipes'),
    ]
    S['views'] = {
        'home': dict(pos=L(P, (700, 600, 430)), tgt=L(P, (0, -100, 140))),
        'long': dict(pos=L(P, (780, -40, 250)), tgt=L(P, (0, -80, 150))),
        'front': dict(pos=L(P, (40, 600, 215)), tgt=L(P, (0, -20, 158))),
        'magnet': dict(pos=L(P, (360, 90, 300)), tgt=L(P, (0, -62, 150))),
        'explode': dict(pos=L(P, (1150, 300, 560)), tgt=L(P, (0, -40, 150))),
    }
    S['drive'] = dict(poles=8, rpm=2900, spinSign=1)
    S['cn'] = '磁力泵'
    S['center'] = L(P, (0, -100, 150))
    SPEC[P] = S


# ================================================================ P2 磁悬浮泵（无轴承电机）
# 结构参考：Sulzer/Levitronix US6100618、US6053705、Levitronix US12188475（“庙宇电机”：
# 约 6 个 L 形铁芯，底部软铁回路环；转子 = 包在塑料里的磁铁环 + 叶片；
# x、y 位置和转速主动控制，轴向和两个倾斜方向靠磁阻力被动稳住）
def build_p2(M):
    P = 'P2'
    S = {}
    ZR = 140.0          # 转子磁铁中心高度
    C = (0, 0, 0)
    # ---- 电机外壳：底板、外筒、顶环（给定子竖腿留缺口）、泵头座
    bm = bmesh.new()
    revolve(bm, [(0, 0), (118, 0), (120, 3), (120, 8), (0, 8)], C, 'Z', 72, 1)
    ring(bm, 112, 118, 8, 120, C, 'Z', 72, 0)
    ring(bm, 97, 118, 120, 126, C, 'Z', 72, 0)
    for k in range(6):
        sector(bm, 59, 97, radians(60 * k + 11), radians(60 * k + 49), 120, 126, C, 'Z', 10, 0)
    ring(bm, 56.5, 59, 106, 126, C, 'Z', 72, 1)
    ring(bm, 20, 59, 102, 106, C, 'Z', 72, 1)
    box(bm, (118, 0, 60), (16, 40, 36), mi=1, r=3)
    add('P2_Housing', bm, [M['housing'], M['housingD']], P, '电机外壳', 'frame', ex=(0, 0, -70), extras={'ghost': 1})
    # ---- 定子：六个 L 形爪，竖腿上绕线圈，爪尖伸到泵头杯子周围
    bm_i = bmesh.new()
    ring(bm_i, 62, 100, 14, 34, C, 'Z', 72, 0)
    for k in range(6):
        R = Matrix.Rotation(TAU * k / 6, 3, 'Z')

        def put(b, c, s, R=R):
            vs = box(b, (0, 0, 0), s, mi=0)
            bmesh.ops.rotate(b, verts=vs, cent=(0, 0, 0), matrix=R)
            bmesh.ops.translate(b, vec=R @ Vector(c), verts=vs)
        put(bm_i, (84, 0, 84), (22, 26, 112))                  # 竖腿
        put(bm_i, (78.5, 0, 141), (33, 26, 18))                # 横爪
        put(bm_i, (62.75, 0, 141), (6.5, 34, 28))              # 爪尖
        co = bm_from(lambda b: box(b, (0, 0, 0), (36, 40, 66), mi=0, r=6, seg=3))
        ci = bm_from(lambda b: box(b, (0, 0, 0), (24.5, 28.5, 90), mi=0))
        bc = boolean(co, cuts=[ci], name=f'P2coil{k}')       # 线圈是套在竖腿上的方环
        setmat(bc, 0)
        bmesh.ops.rotate(bc, verts=list(bc.verts), cent=(0, 0, 0), matrix=R)
        bmesh.ops.translate(bc, vec=R @ Vector((84, 0, 80)), verts=list(bc.verts))
        add(f'P2_Coil{k}', bc, [M['coil']], P, '线圈', 'drive', ex=(0, 0, -70), extras={'coil': k})
    add('P2_Stator', bm_i, [M['iron']], P, '定子铁芯（六爪）', 'drive', ex=(0, 0, -70))
    # ---- 位置传感器：插在爪与爪之间
    bm = bmesh.new()
    for t in (30, 150, 270):
        R = Matrix.Rotation(radians(t), 3, 'Z')
        cyl(bm, R @ Vector((62, 0, 141)), R @ Vector((84, 0, 141)), 6, seg=20, mi=0)
        box(bm, R @ Vector((90, 0, 141)), (12, 14, 14), mi=1)
    add('P2_Sensors', bm, [M['sensor'], M['led']], P, '位置传感器', 'drive', ex=(0, 0, -70))

    # ---- 泵头（PFA）：下部杯子伸进定子中间，上部是叶轮腔，顶上进口，侧面切向出口
    body = bm_from(lambda b: revolve(b, [(0, 106), (52, 106), (54, 108), (54, 156), (78, 158), (80, 162),
                                         (80, 200), (74, 206), (18, 208), (18, 262), (30, 262), (30, 272), (0, 272)],
                                     C, 'Z', 72, 0))
    noz = bm_from(lambda b: cyl(b, (40, -60, 182), (150, -60, 182), 15, seg=36),
                  lambda b: cyl(b, (140, -60, 182), (152, -60, 182), 28, seg=36))
    cav = bm_from(lambda b: revolve(b, [(0, 112), (47.5, 112), (47.5, 161), (66, 162), (66, 199), (40, 201),
                                        (11, 202), (11, 280), (0, 280)], C, 'Z', 72, 0))
    outb = bm_from(lambda b: cyl(b, (0, -60, 182), (160, -60, 182), 9.5, seg=28))
    bm = boolean(body, unions=[noz], cuts=[cav, outb], name='P2head')
    setmat(bm, 0)
    add('P2_Head', bm, [M['pfa']], P, '泵头（PFA）', 'wet', ex=(0, 0, 260), ang=40)

    # ---- 转子 = 磁铁环 + 叶轮，一体，悬在液体里
    bm = bmesh.new()
    ring(bm, 28, 30, 124, 162.6, C, 'Z', 64, 0)
    ring(bm, 44, 46, 124, 160, C, 'Z', 72, 0)
    ring(bm, 30, 44, 124, 127, C, 'Z', 64, 0)
    ring(bm, 30, 46, 153, 162.6, C, 'Z', 72, 0)
    ring(bm, 10, 64, 162.5, 165.5, C, 'Z', 72, 0)                          # 叶轮背板
    for half in range(2):
        sector(bm, 30.2, 43.8, pi * half + radians(.6), pi * (half + 1) - radians(.6), 127.2, 152.8, C, 'Z', 24, 1 + half)
    for k in range(6):
        th0 = TAU * k / 6
        rs = [16 + (63 - 16) * i / 14 for i in range(15)]
        f = lambda r, th0=th0: th0 - math.log(r / 16) / math.tan(radians(40))
        vane_block(bm, [(r, f(r) - 1.6 / r) for r in rs], [(r, f(r) + 1.6 / r) for r in rs], 165.2,
                   lambda r: 186.0, lambda r, th, a: (r * cos(th), r * sin(th), a))
    add('P2_Rotor', bm, [M['move'], M['magN'], M['magS']], P, '转子（磁铁环 + 叶轮）', 'wet',
        pivot=(0, 0, ZR), mov='rotL', ex=(0, 0, 120), ang=40)

    # ---- 控制器和线
    bm = bmesh.new()
    box(bm, (0, -250, 45), (150, 110, 90), mi=0, r=5)
    box(bm, (-20, -305.5, 60), (80, 3, 32), mi=1)
    for k in range(3):
        box(bm, (36, -306, 66 - 14 * k), (8, 3, 8), mi=2)
    sweep(bm, [(126, 0, 60), (165, 0, 58), (185, -60, 40), (130, -200, 32), (60, -240, 40)], 7, seg=14, mi=3)
    add('P2_Controller', bm, [M['panel'], M['lcd'], M['led'], M['rubber']], P, '控制器', 'drive', ex=(0, -90, 0))
    bm = bmesh.new()
    ring(bm, 11, 17, 272, 345, C, 'Z', 40, 0)
    ring(bm, 9.5, 14, 152, 235, (0, -60, 182), 'X', 32, 0)
    add('P2_Pipes', bm, [M['tube']], P, '进出口配管', 'pipe', ex=(0, 0, 260), extras={'ghost': 1})

    # ---- 流线（俯视逆时针转）
    flows = []
    for i in range(9):
        t = TAU * i / 9
        rr = 2.5 + 6 * (i % 3) / 2
        pts, pres = [], []
        for z in (345, 300, 255, 222, 204):
            pts.append((rr * cos(t), rr * sin(t), z)); pres.append(.03)
        pts.append(((rr + 5) * cos(t), (rr + 5) * sin(t), 192)); pres.append(.05)
        pts.append((16 * cos(t), 16 * sin(t), 180)); pres.append(.07)
        th = t
        for j in range(12):
            r = 16 + (63 - 16) * (j + 1) / 12
            th += radians(7)
            pts.append((r * cos(th), r * sin(th), 176 + (i % 3) * 2)); pres.append(.08 + .55 * (j + 1) / 12)
        tgt = -pi / 2
        th_end = th + ((tgt - th) % TAU)
        if th_end - th < radians(20):
            th_end += TAU
        while th < th_end - radians(10):
            th += radians(12)
            pts.append((64.5 * cos(th), 64.5 * sin(th), 182 + (i % 3 - 1) * 4)); pres.append(.7 + .1 * (th / th_end))
        pts.append((8, -60, 182)); pres.append(.84)
        for x in (50, 100, 150, 200, 235):
            pts.append((x, -60 + (i % 3 - 1) * 4, 182 + (i % 2 * 2 - 1) * 3)); pres.append(.95)
        flows.append(polyline(P, pts, pres))
    circ = []
    for i in range(5):
        t = TAU * i / 5
        pts = [(63, 161.2), (50, 160.6), (46.75, 150), (46.75, 132), (40, 118), (24, 117), (20, 132), (20, 152),
               (12, 160), (6, 166), (12, 172), (18, 177)]
        q = [(r * cos(t + .2 * j), r * sin(t + .2 * j), a) for j, (r, a) in enumerate(pts)]
        circ.append(polyline(P, q, [.6 - .045 * j for j in range(len(q))]))
    S['flows'] = {'main': flows, 'circ': circ}
    S['axis'] = dict(p=L(P, (0, 0, ZR)), d=[0, 0, 1])
    S['cuts'] = {
        'long': dict(cn='纵剖', n=[0, -1, 0], p=L(P, (0, 0, 150))),
        'top': dict(cn='横剖', n=[0, 0, 1], p=L(P, (0, 0, 141))),
    }
    S['pins'] = [
        dict(t='泵头（PFA）', p=L(P, (-60, 0, 222)), part='P2_Head'),
        dict(t='转子：磁铁环 + 叶轮', p=L(P, (-36, 0, 176)), part='P2_Rotor'),
        dict(t='定子爪', p=L(P, (-92, 0, 156)), part='P2_Stator'),
        dict(t='线圈', p=L(P, (-84, 0, 64)), part='P2_Coil3'),
        dict(t='位置传感器', p=L(P, (-50, 90, 152)), part='P2_Sensors'),
        dict(t='控制器', p=L(P, (0, -250, 106)), part='P2_Controller'),
        dict(t='进口', p=L(P, (0, 0, 334)), part='P2_Pipes'),
        dict(t='出口', p=L(P, (215, -60, 204)), part='P2_Pipes'),
    ]
    S['views'] = {
        'home': dict(pos=L(P, (520, -640, 520)), tgt=L(P, (0, -50, 160))),
        'long': dict(pos=L(P, (40, -640, 250)), tgt=L(P, (10, 0, 160))),
        'top': dict(pos=L(P, (40, -200, 660)), tgt=L(P, (0, 0, 130))),
        'gap': dict(pos=L(P, (-120, -260, 230)), tgt=L(P, (-40, 0, 148))),
        'explode': dict(pos=L(P, (720, -820, 640)), tgt=L(P, (0, -40, 230))),
    }
    S['drive'] = dict(poles=2, rpm=4000, spinSign=1, gap=[46, 47.5])
    S['cn'] = '磁悬浮泵'
    S['center'] = L(P, (0, -60, 170))
    SPEC[P] = S


# ================================================================ P3 波纹管泵
# 结构参考：Iwaki US6874997（两只波纹管的活动端板由一根穿过泵头的轴连在一起，外侧是空气室，
# 4 个球阀，空气换向）；Nippon Pillar US10408207（波纹管法兰被泵壳边缘压在泵头侧面、
# 行程端接近开关、空气室底部漏液传感器、换向瞬间出口压力掉到接近零）；
# 脉动阻尼器参考 Nippon Pillar US6364640 / JPH11270459A（第二只波纹管：里面是液体，外面是空气）
BL_L = 150.0      # 波纹管中间长度
BL_S = 30.0       # 单边行程
BL_X0 = 68.0      # 波纹管起点（法兰外侧）


def bellows_profile(L0, n, r_mid, amp, wall, steps=14):
    xs = [L0 * i / (n * steps) for i in range(n * steps + 1)]
    ro = [r_mid - amp * cos(TAU * n * x / L0) for x in xs]
    outer = [(r, x) for r, x in zip(ro, xs)]
    inner = [(r - wall, x) for r, x in zip(ro, xs)][::-1]
    return outer + inner


def build_p3(M):
    P = 'P3'
    S = {}
    ZA = 200.0
    C = (0, 0, ZA)
    # ---- 底座、泵头脚、泵壳托架
    bm = bmesh.new()
    box(bm, (0, 20, 9), (720, 260, 18), r=3)
    add('P3_Base', bm, [M['base']], P, '底座', 'frame')
    bm = bmesh.new()
    box(bm, (0, 0, 54), (100, 130, 72), r=3)
    for sg in (-1, 1):
        box(bm, (sg * 200, 0, 69), (40, 120, 102), r=3)
    add('P3_Feet', bm, [M['motorD']], P, '支架', 'frame')

    # ---- 中心泵头（PTFE）：进出口歧管、4 个球阀腔、两侧各两个通口、中心轴孔和轴封
    blk = bm_from(lambda b: box(b, (0, 0, 200), (120, 160, 220), r=6, seg=2))
    noz = bm_from(lambda b: cyl(b, (0, -78, 112), (0, -125, 112), 18, seg=36),
                  lambda b: cyl(b, (0, -120, 112), (0, -132, 112), 34, seg=36),
                  lambda b: cyl(b, (0, -78, 288), (0, -125, 288), 18, seg=36),
                  lambda b: cyl(b, (0, -120, 288), (0, -132, 288), 34, seg=36))
    cuts = []
    cuts.append(bm_from(lambda b: cyl(b, (-41, 0, 112), (41, 0, 112), 12, seg=32)))       # 进口歧管
    cuts.append(bm_from(lambda b: cyl(b, (-41, 0, 288), (41, 0, 288), 12, seg=32)))       # 出口歧管
    cuts.append(bm_from(lambda b: cyl(b, (0, 0, 112), (0, -140, 112), 11, seg=28)))
    cuts.append(bm_from(lambda b: cyl(b, (0, 0, 288), (0, -140, 288), 11, seg=28)))
    cuts.append(bm_from(lambda b: cyl(b, (0, 0, 286), (0, 0, 314), 9, seg=24)))          # 通阻尼器
    cuts.append(bm_from(lambda b: cyl(b, (-64, 0, ZA), (64, 0, ZA), 8.6, seg=24)))        # 轴孔
    for sg in (-1, 1):
        x = sg * 32
        cuts.append(bm_from(
            lambda b, x=x: revolve(b, [(0, 118), (7, 118), (7, 136), (13, 136), (13, 160), (9, 160), (9, 174), (0, 174)],
                                   (x, 0, 0), 'Z', 32, 0)))
        cuts.append(bm_from(
            lambda b, x=x: revolve(b, [(0, 224), (9, 224), (9, 248), (7, 248), (7, 254), (13, 254), (13, 280), (9, 280),
                                       (9, 292), (0, 292)], (x, 0, 0), 'Z', 32, 0)))
        cuts.append(bm_from(lambda b, sg=sg: cyl(b, (sg * 24, 0, ZA - 32), (sg * 64, 0, ZA - 32), 9, seg=24)))
        cuts.append(bm_from(lambda b, sg=sg: cyl(b, (sg * 24, 0, ZA + 32), (sg * 64, 0, ZA + 32), 9, seg=24)))
        cuts.append(bm_from(lambda b, sg=sg: cyl(b, (sg * 47, 0, ZA), (sg * 64, 0, ZA), 14, seg=28)))   # 轴封腔
    bm = boolean(blk, unions=[noz], cuts=cuts, name='P3head')
    setmat(bm, 0)
    add('P3_Head', bm, [M['ptfe']], P, '中心泵头（PTFE）', 'wet', ang=40)
    # 轴封
    bm = bmesh.new()
    for sg in (-1, 1):
        ring(bm, 8.3, 14, sg * 48 if sg > 0 else -60, 60 if sg > 0 else -48, C, 'X', 32, 0)
    add('P3_ShaftSeal', bm, [M['carbon']], P, '轴封', 'wet', ex=(0, -90, 0))
    # 球阀（4 个），物体原点 = 关闭时的球心
    balls = {}
    for sg, side in ((-1, 'L'), (1, 'R')):
        for kind, zc in (('In', 136 + sqrt(100 - 49)), ('Out', 254 + sqrt(100 - 49))):
            bm = bm_from(lambda b, sg=sg, zc=zc: ball(b, (sg * 32, 0, zc), 10, seg=24))
            nm = f'P3_Ball{kind}{side}'
            add(nm, bm, [M['pfa']], P, ('进口' if kind == 'In' else '出口') + '球阀', 'wet',
                pivot=(sg * 32, 0, zc), mov=f'ball{kind}{side}', ex=(0, -160, 0))
            balls[nm] = zc
    # ---- 两侧：波纹管法兰、波纹管、端板（含底）、空气室外壳、行程检测、漏液传感器
    for sg, side in ((-1, 'L'), (1, 'R')):
        def mir(prof, sg=sg):
            return [(r, sg * a) for (r, a) in prof]
        bm = bm_from(lambda b: revolve(b, mir([(41.6, 60), (72, 60), (72, 68), (41.6, 68)]), C, 'X', 64, 0, closed=True))
        add(f'P3_BFlange{side}', bm, [M['ptfe']], P, '波纹管法兰', 'wet', ex=(sg * 70, 0, 0))
        prof = [(r, BL_X0 + x) for (r, x) in bellows_profile(BL_L, 8, 51, 7, 2.4)]
        bm = bm_from(lambda b: revolve(b, mir(prof), C, 'X', 72, 0, closed=True))
        add(f'P3_Bellows{side}', bm, [M['move']], P, '波纹管（PTFE）', 'wet', pivot=(sg * BL_X0, 0, ZA),
            mov=f'bellows{side}', ex=(sg * 120, 0, 0), ang=60)
        xb = BL_X0 + BL_L
        bm = bmesh.new()
        revolve(bm, mir([(0, xb - 14), (16, xb - 14), (16, xb - 3), (46, xb - 2), (46, xb + 8), (0, xb + 8)]), C, 'X', 64, 0)
        revolve(bm, mir([(0, xb + 8), (62, xb + 8), (62, xb + 15), (0, xb + 15)]), C, 'X', 64, 1)
        for k in range(6):
            t = TAU * k / 6 + .3
            p = Vector(_axis_pt('X', C, 48, t, sg * (xb + 15)))
            hexbolt(bm, p, (sg, 0, 0), s=9, h=5, mi=1)
        add(f'P3_Plate{side}', bm, [M['move'], M['steel']], P, '波纹管底 + 工作板', 'wet', pivot=(sg * xb, 0, ZA),
            mov='plate', ex=(sg * 170, 0, 0))
        bm = bmesh.new()
        revolve(bm, mir([(0, 300), (80, 300), (80, 72), (92, 70), (92, 60), (72, 60), (72, 68), (62, 68), (62, 72),
                         (74, 74), (74, 290), (0, 290)]), C, 'X', 72, 0)
        cyl(bm, (sg * 270, 0, ZA + 76), (sg * 270, 0, ZA + 98), 7, seg=20, mi=1)
        for k in range(8):
            t = TAU * k / 8 + radians(22.5)
            p = Vector(_axis_pt('X', C, 84, t, sg * 70))
            hexbolt(bm, p, (sg, 0, 0), s=9, h=5, mi=1)
        add(f'P3_Case{side}', bm, [M['pp'], M['steel']], P, '空气室外壳', 'frame', ex=(sg * 230, 0, 0), extras={'ghost': 1})
        bm = bmesh.new()
        cyl(bm, (sg * 300, 0, ZA), (sg * 326, 0, ZA), 12, seg=24, mi=0)
        cyl(bm, (sg * 326, 0, ZA), (sg * 332, 0, ZA), 7, seg=16, mi=1)
        add(f'P3_Detector{side}', bm, [M['sensor'], M['led']], P, '行程端检测', 'drive', ex=(sg * 230, 0, 0))
        bm = bm_from(lambda b: box(b, (sg * 150, 0, ZA - 84), (26, 22, 8), mi=0, r=1.5),
                     lambda b: box(b, (sg * 150, -11.5, ZA - 84), (6, 2, 3), mi=1))
        add(f'P3_Leak{side}', bm, [M['sensor'], M['led']], P, '漏液传感器', 'drive', ex=(sg * 230, 0, 0))
    # ---- 连杆（陶瓷），两头接在两个波纹管底上
    bm = bm_from(lambda b: revolve(b, [(0, -(BL_X0 + BL_L - 13)), (8, -(BL_X0 + BL_L - 13)), (8, BL_X0 + BL_L - 13),
                                       (0, BL_X0 + BL_L - 13)], C, 'X', 32, 0))
    add('P3_Shaft', bm, [M['ceramic']], P, '连杆（陶瓷）', 'wet', pivot=C, mov='plate', ex=(0, 0, 0))
    # ---- 换向阀和空气管
    bm = bmesh.new()
    box(bm, (0, 122, 52), (100, 52, 68), mi=0, r=4)
    cyl(bm, (0, 148, 52), (0, 176, 52), 12, seg=20, mi=1)        # 消音器
    cyl(bm, (0, 96, 30), (0, 72, 30), 6, seg=16, mi=2)           # 气源接口
    add('P3_AirValve', bm, [M['housingD'], M['rubber'], M['brass']], P, '换向阀（电磁阀或空气阀）', 'drive', ex=(0, 80, 0))
    bm = bmesh.new()
    tubes = {}
    for sg, side in ((-1, 'L'), (1, 'R')):
        path = [(sg * 30, 122, 86), (sg * 38, 122, 140), (sg * 90, 96, 300), (sg * 210, 40, 330), (sg * 262, 6, 318),
                (sg * 270, 0, ZA + 98)]
        sweep(bm, path, 4.5, seg=12, mi=0)
        tubes[side] = path
    add('P3_AirTubes', bm, [M['airtube']], P, '空气管', 'frame', ex=(0, 80, 0))
    # ---- 脉动阻尼器（装在泵头顶上，和出口歧管相通）
    bm = bmesh.new()
    revolve(bm, [(9, 310), (60, 310), (60, 476), (0, 476), (0, 470), (54, 470), (54, 316), (9, 316)], C[:2] + (0,), 'Z', 64, 0, closed=True)
    cyl(bm, (0, 0, 476), (0, 0, 498), 9, seg=20, mi=1)
    for k in range(6):
        t = TAU * k / 6
        hexbolt(bm, (57 * cos(t), 57 * sin(t), 476), (0, 0, 1), s=8, h=4, mi=1)
    add('P3_Damper', bm, [M['pp'], M['brass']], P, '脉动阻尼器', 'frame', ex=(0, 0, 180), extras={'ghost': 1})
    bm = bm_from(lambda b: ring(b, 9, 40, 316, 322, (0, 0, 0), 'Z', 48, 0))
    add('P3_DFlange', bm, [M['ptfe']], P, '阻尼波纹管法兰', 'wet', ex=(0, 0, 180))
    prof = [(r, 322 + x) for (r, x) in bellows_profile(84, 6, 30, 5, 2.0)]
    bm = bm_from(lambda b: revolve(b, prof, (0, 0, 0), 'Z', 64, 0, closed=True))
    add('P3_DBellows', bm, [M['moveD']], P, '阻尼波纹管', 'wet', pivot=(0, 0, 322), mov='dbellows', ex=(0, 0, 180), ang=60)
    bm = bm_from(lambda b: disc(b, 27, 406, 412, (0, 0, 0), 'Z', 48, 0))
    add('P3_DTop', bm, [M['moveD']], P, '阻尼波纹管顶', 'wet', pivot=(0, 0, 406), mov='dtop', ex=(0, 0, 180))
    # ---- 配管
    bm = bmesh.new()
    ring(bm, 11, 16, -132, -200, (0, 0, 112), 'Y', 32, 0)
    ring(bm, 11, 16, -132, -200, (0, 0, 288), 'Y', 32, 0)
    add('P3_Pipes', bm, [M['tube']], P, '进出口配管', 'pipe', ex=(0, -60, 0), extras={'ghost': 1})

    # ---- 流线
    def side_paths(sg):
        x = sg * 32
        suct, disch = [], []
        for j in range(6):
            dy = (j % 3 - 1) * 4
            dz = (j // 3) * 3 - 1.5
            pts = [(dy, -200, 112 + dz), (dy, -140, 112 + dz), (dy, -80, 112 + dz), (dy * .5, -20, 112), (sg * 12, dy * .5, 112),
                   (x, dy * .4, 114), (x, dy * .4, 126), (x + sg * 3, dy * .5, 140), (x + sg * 3, dy * .5, 152), (x, 0, 165),
                   (sg * 44, dy * .4, ZA - 32), (sg * 62, dy * .4, ZA - 32)]
            rr = 18 + 9 * (j % 3)
            ang = .7 * j
            for k, xx in enumerate((80, 110, 140, 170, 195)):
                pts.append((sg * xx, rr * sin(ang + k * .5), ZA - 20 + rr * .2 * cos(ang + k * .5) - (k * 2)))
            suct.append(polyline(P, pts, [.05] * len(pts)))
            pts = []
            for k, xx in enumerate((200, 170, 140, 110, 80)):
                pts.append((sg * xx, rr * sin(ang + k * .5), ZA + 20 + rr * .2 * cos(ang + k * .5) + k * 2))
            pts += [(sg * 62, dy * .4, ZA + 32), (sg * 44, dy * .4, ZA + 32), (x, 0, ZA + 34), (x, dy * .4, 246),
                    (x + sg * 3, dy * .5, 258), (x + sg * 3, dy * .5, 270), (x, dy * .4, 284), (sg * 12, dy * .5, 288),
                    (dy * .5, -20, 288 + dz), (dy, -80, 288 + dz), (dy, -140, 288 + dz), (dy, -200, 288 + dz)]
            disch.append(polyline(P, pts, [.9] * len(pts)))
        return suct, disch
    sL, dL = side_paths(-1)
    sR, dR = side_paths(1)

    def air_paths(side, sg):
        out = []
        for j in range(4):
            pts = [(0, 72, 30), (0, 110, 40)] + tubes[side] + [(sg * 270, 0, ZA + 70), (sg * 268, (j - 1.5) * 18, ZA + 40),
                                                                (sg * 262, (j - 1.5) * 26, ZA + (j % 2) * 30 - 10)]
            out.append(polyline(P, pts, [0] * len(pts)))
        return out

    def exh_paths(side, sg):
        out = []
        for j in range(3):
            pts = [(sg * 262, (j - 1) * 24, ZA), (sg * 270, 0, ZA + 70)] + tubes[side][::-1] + [(0, 140, 52), (0, 176, 52), (0, 200, 56)]
            out.append(polyline(P, pts, [0] * len(pts)))
        return out
    S['flows'] = {'suctL': sL, 'dischL': dL, 'suctR': sR, 'dischR': dR,
                  'airL': air_paths('L', -1), 'airR': air_paths('R', 1),
                  'exhL': exh_paths('L', -1), 'exhR': exh_paths('R', 1)}
    S['axis'] = dict(p=L(P, C), d=[1, 0, 0])
    S['cuts'] = {'long': dict(cn='纵剖', n=[0, -1, 0], p=L(P, (0, 0, ZA)))}
    S['pins'] = [
        dict(t='中心泵头（PTFE）', p=L(P, (0, 0, 322)), part='P3_Head'),
        dict(t='左波纹管', p=L(P, (-150, 0, ZA + 70)), part='P3_BellowsL'),
        dict(t='右波纹管', p=L(P, (150, 0, ZA + 70)), part='P3_BellowsR'),
        dict(t='连杆', p=L(P, (-100, 0, ZA + 12)), part='P3_Shaft'),
        dict(t='空气室', p=L(P, (250, 0, ZA - 60)), part='P3_CaseR'),
        dict(t='进口球阀', p=L(P, (-32, 0, 138)), part='P3_BallInL'),
        dict(t='出口球阀', p=L(P, (32, 0, 264)), part='P3_BallOutR'),
        dict(t='脉动阻尼器', p=L(P, (0, 0, 500)), part='P3_Damper'),
        dict(t='换向阀', p=L(P, (0, 122, 100)), part='P3_AirValve'),
        dict(t='进口', p=L(P, (0, -190, 132)), part='P3_Pipes'),
        dict(t='出口', p=L(P, (0, -190, 308)), part='P3_Pipes'),
        dict(t='漏液传感器', p=L(P, (-150, 0, ZA - 100)), part='P3_LeakL'),
        dict(t='行程端检测', p=L(P, (330, 0, ZA + 22)), part='P3_DetectorR'),
    ]
    S['views'] = {
        'home': dict(pos=L(P, (560, -1050, 620)), tgt=L(P, (0, 0, 230))),
        'long': dict(pos=L(P, (0, -1320, 330)), tgt=L(P, (0, 0, 255))),
        'valves': dict(pos=L(P, (60, -440, 230)), tgt=L(P, (0, 0, 200))),
        'damper': dict(pos=L(P, (180, -520, 470)), tgt=L(P, (0, 0, 360))),
        'explode': dict(pos=L(P, (700, -1500, 820)), tgt=L(P, (0, -30, 250))),
    }
    S['motion'] = dict(L=BL_L, stroke=BL_S, x0=BL_X0, ballLift=6.5, dL=84)
    S['cn'] = '波纹管泵'
    S['center'] = L(P, (0, 0, 250))
    SPEC[P] = S


# ================================================================ P4 气动隔膜泵
# 结构参考：Wilden US6142749（中间体里两个空气室、中间夹空气阀；PTFE 隔膜用嵌件螺柱接中心轴；
# 进口歧管在下、出口歧管在上，四个带笼子的 PTFE 球阀）；Yamada US11448204（三段阀芯的滑阀换向）
D4 = 9.0          # 单边行程
DM4 = 12.0        # 形态键满幅


def diaphragm_keys(ob, dmax, r_full, r_fix):
    """给隔膜加 pos / neg 两个形态键：中心整块平移，外圈固定，中间余弦过渡"""
    ob.shape_key_add(name='Basis')
    for nm, sg in (('pos', 1), ('neg', -1)):
        k = ob.shape_key_add(name=nm, from_mix=False)
        for i, v in enumerate(ob.data.vertices):
            r = sqrt(v.co.y ** 2 + v.co.z ** 2) / MM
            if r <= r_full:
                f = 1.0
            elif r >= r_fix:
                f = 0.0
            else:
                f = .5 + .5 * cos(pi * (r - r_full) / (r_fix - r_full))
            k.data[i].co = v.co + Vector((sg * dmax * f * MM, 0, 0))


def build_p4(M):
    P = 'P4'
    S = {}
    ZA = 190.0
    C = (0, 0, ZA)
    # ---- 中间体（空气侧），两面是碟形空气室
    bm = bm_from(lambda b: revolve(b, [(11, -26.6), (20, -27.5), (40, -31), (58, -46), (86, -46), (86, -38), (62, -36),
                                       (62, 36), (86, 38), (86, 46), (58, 46), (40, 31), (20, 27.5), (11, 26.6)],
                                   C, 'X', 72, 0, closed=True))
    add('P4_Center', bm, [M['alu']], P, '中间体（空气侧）', 'frame', ex=(0, 0, 0), extras={'ghost': 1})
    # ---- 空气阀（滑阀）
    blk = bm_from(lambda b: box(b, (0, 0, ZA + 84), (84, 72, 44), r=4))
    bore = bm_from(lambda b: cyl(b, (-34, 0, ZA + 84), (34, 0, ZA + 84), 9.5, seg=24))
    bm = boolean(blk, cuts=[bore], name='P4valve')
    setmat(bm, 0)
    cyl(bm, (0, -36, ZA + 84), (0, -58, ZA + 84), 7, seg=16, mi=2)      # 气源接口
    cyl(bm, (0, 36, ZA + 84), (0, 80, ZA + 84), 14, seg=20, mi=1)       # 消音器
    add('P4_AirValve', bm, [M['housingD'], M['rubber'], M['brass']], P, '空气阀', 'frame', ex=(0, 0, 70), extras={'ghost': 1})
    bm = bmesh.new()
    for x0, x1, r in ((-24, -16, 9), (-16, -6, 5), (-6, 6, 9), (6, 16, 5), (16, 24, 9)):
        revolve(bm, [(0, x0), (r, x0), (r, x1), (0, x1)], (0, 0, ZA + 84), 'X', 24, 0)
    add('P4_Spool', bm, [M['steel']], P, '阀芯（滑阀）', 'drive', pivot=(0, 0, ZA + 84), mov='spool', ex=(0, 0, 70))
    # ---- 中心轴 + 两块内侧活塞板
    bm = bmesh.new()
    revolve(bm, [(0, -42), (10, -42), (10, 42), (0, 42)], C, 'X', 32, 0)
    for sg in (-1, 1):
        revolve(bm, [(0, sg * 40), (34, sg * 40), (34, sg * 45.8), (0, sg * 45.8)], C, 'X', 48, 1)
    add('P4_Shaft', bm, [M['steel'], M['alu']], P, '中心轴 + 活塞板', 'drive', pivot=C, mov='shaft', ex=(0, 0, 0))
    # ---- 隔膜（PTFE），带形态键
    for sg, side in ((-1, 'L'), (1, 'R')):
        bm = bm_from(lambda b, sg=sg: revolve(b, [(0, sg * 46), (86, sg * 46), (86, sg * 50), (0, sg * 50)], C, 'X', 72, 0))
        ob = add(f'P4_Diaphragm{side}', bm, [M['move']], P, '隔膜（PTFE）', 'wet', pivot=(sg * 48, 0, ZA),
                 mov='diaphragm', ex=(sg * 90, 0, 0), ang=70)
        diaphragm_keys(ob, DM4, 34, 58)
    # ---- 两侧液室盖（PTFE），上下各开一个通口
    for sg, side in ((-1, 'L'), (1, 'R')):
        def mir(prof, sg=sg):
            return [(r, sg * a) for (r, a) in prof]
        cap = bm_from(lambda b: revolve(b, mir([(0, 74), (20, 72.5), (40, 67), (58, 50), (92, 50), (92, 62), (80, 74),
                                                (50, 86), (0, 90)]), C, 'X', 72, 0))
        ports = [bm_from(lambda b: cyl(b, (sg * 64, 0, ZA + 30), (sg * 64, 0, ZA + 104), 8, seg=24)),
                 bm_from(lambda b: cyl(b, (sg * 64, 0, ZA - 104), (sg * 64, 0, ZA - 30), 8, seg=24))]
        bm = boolean(cap, cuts=ports, name=f'P4cap{side}')
        setmat(bm, 0)
        for k in range(10):
            t = TAU * k / 10 + .2
            p = Vector(_axis_pt('X', C, 86, t, sg * 62))
            hexbolt(bm, p, (sg, 0, 0), s=9, h=5, mi=1)
        add(f'P4_Cap{side}', bm, [M['ptfe'], M['steel']], P, '液室盖（PTFE）', 'wet', ex=(sg * 160, 0, 0), ang=40)
    # ---- 上下歧管（含球阀腔）
    ZT, ZB = ZA + 130, ZA - 130
    top = bm_from(lambda b: cyl(b, (-84, 0, ZT), (84, 0, ZT), 20, seg=36),
                  lambda b: cyl(b, (0, 0, ZT), (0, 0, ZT + 50), 18, seg=36),
                  lambda b: cyl(b, (0, 0, ZT + 42), (0, 0, ZT + 54), 34, seg=36))
    tunions = [bm_from(lambda b, sg=sg: cyl(b, (sg * 64, 0, ZA + 86), (sg * 64, 0, ZT), 18, seg=36)) for sg in (-1, 1)]
    tcuts = [bm_from(lambda b: cyl(b, (-64, 0, ZT), (64, 0, ZT), 13, seg=32)),
             bm_from(lambda b: cyl(b, (0, 0, ZT), (0, 0, ZT + 60), 12, seg=28))]
    for sg in (-1, 1):
        tcuts.append(bm_from(lambda b, sg=sg: revolve(b, [(0, ZA + 84), (7, ZA + 84), (7, ZA + 96), (13, ZA + 96),
                                                          (13, ZA + 124), (9, ZA + 124), (9, ZT + 2), (0, ZT + 2)],
                                                      (sg * 64, 0, 0), 'Z', 32, 0)))
    bm = boolean(top, unions=tunions, cuts=tcuts, name='P4top')
    setmat(bm, 0)
    add('P4_ManifoldTop', bm, [M['ptfe']], P, '出口歧管 + 出口球阀座', 'wet', ex=(0, 0, 140), ang=40)
    bot = bm_from(lambda b: cyl(b, (-84, 0, ZB), (84, 0, ZB), 20, seg=36),
                  lambda b: cyl(b, (0, 0, ZB), (0, -60, ZB), 18, seg=36),
                  lambda b: cyl(b, (0, -52, ZB), (0, -64, ZB), 34, seg=36))
    bunions = [bm_from(lambda b, sg=sg: cyl(b, (sg * 64, 0, ZB), (sg * 64, 0, ZA - 86), 18, seg=36)) for sg in (-1, 1)]
    bcuts = [bm_from(lambda b: cyl(b, (-64, 0, ZB), (64, 0, ZB), 13, seg=32)),
             bm_from(lambda b: cyl(b, (0, 0, ZB), (0, -70, ZB), 12, seg=28))]
    for sg in (-1, 1):
        bcuts.append(bm_from(lambda b, sg=sg: revolve(b, [(0, ZB - 2), (9, ZB - 2), (9, ZA - 120), (7, ZA - 120),
                                                          (7, ZA - 114), (13, ZA - 114), (13, ZA - 88), (0, ZA - 84)],
                                                      (sg * 64, 0, 0), 'Z', 32, 0)))
    bm = boolean(bot, unions=bunions, cuts=bcuts, name='P4bot')
    setmat(bm, 0)
    add('P4_ManifoldBot', bm, [M['ptfe']], P, '进口歧管 + 进口球阀座', 'wet', ex=(0, -170, 0), ang=40)
    for sg, side in ((-1, 'L'), (1, 'R')):
        for kind, zc, exv in (('Out', ZA + 96 + sqrt(10.5 ** 2 - 49), (0, 0, 140)),
                              ('In', ZA - 114 + sqrt(10.5 ** 2 - 49), (0, -170, 0))):
            bm = bm_from(lambda b, sg=sg, zc=zc: ball(b, (sg * 64, 0, zc), 10.5, seg=24))
            add(f'P4_Ball{kind}{side}', bm, [M['pfa']], P, ('进口' if kind == 'In' else '出口') + '球阀', 'wet',
                pivot=(sg * 64, 0, zc), mov=f'ball{kind}{side}', ex=exv)
    # ---- 支脚、配管
    bm = bmesh.new()
    for sg in (-1, 1):
        box(bm, (sg * 70, 0, 21), (30, 120, 42), r=3)
    box(bm, (0, 0, 2), (260, 160, 4), r=1)
    add('P4_Feet', bm, [M['motorD']], P, '支脚', 'frame')
    bm = bmesh.new()
    ring(bm, 12, 17, ZT + 54, ZT + 110, (0, 0, 0), 'Z', 32, 0)
    ring(bm, 12, 17, -64, -130, (0, 0, ZB), 'Y', 32, 0)
    add('P4_Pipes', bm, [M['tube']], P, '进出口配管', 'pipe', ex=(0, 0, 0), extras={'ghost': 1})
    bm = bm_from(lambda b: sweep(b, [(0, -58, ZA + 84), (0, -90, ZA + 84), (0, -130, ZA + 60), (0, -150, 20)], 4.5, seg=12))
    add('P4_AirTube', bm, [M['airtube']], P, '气源管', 'frame', ex=(0, 0, 70))

    # ---- 流线
    def side_paths(sg):
        x = sg * 64
        suct, disch = [], []
        for j in range(6):
            dy = (j % 3 - 1) * 4
            pts = [(dy, -130, ZB), (dy, -80, ZB), (dy * .5, -20, ZB), (sg * 20, dy * .5, ZB), (sg * 44, dy * .5, ZB),
                   (x, dy * .4, ZB + 4), (x, dy * .4, ZA - 120), (x + sg * 3, dy * .5, ZA - 108), (x + sg * 3, dy * .5, ZA - 96),
                   (x, dy * .4, ZA - 84), (x, dy * .4, ZA - 60), (x, dy * .4, ZA - 40)]
            zz = (j - 2.5) * 10
            pts += [(sg * 62, dy, ZA - 30 + j * 2), (sg * 60, dy * 3, ZA + zz)]
            suct.append(polyline(P, pts, [.05] * len(pts)))
            pts = [(sg * 60, dy * 3, ZA + zz * .7), (sg * 62, dy, ZA + 30 - j * 2), (x, dy * .4, ZA + 40), (x, dy * .4, ZA + 70),
                   (x, dy * .4, ZA + 92), (x + sg * 3, dy * .5, ZA + 104), (x + sg * 3, dy * .5, ZA + 116), (x, dy * .4, ZT - 2),
                   (sg * 40, dy * .5, ZT), (sg * 14, dy * .5, ZT), (dy * .5, dy * .5, ZT + 20), (dy, 0, ZT + 60), (dy, 0, ZT + 110)]
            disch.append(polyline(P, pts, [.9] * len(pts)))
        return suct, disch
    sL, dL = side_paths(-1)
    sR, dR = side_paths(1)

    def air(sg):
        out = []
        for j in range(4):
            dz = (j - 1.5) * 14
            out.append(polyline(P, [(0, -150, 20), (0, -130, ZA + 60), (0, -90, ZA + 84), (0, -40, ZA + 84),
                                    (sg * 12, 0, ZA + 84), (sg * 18, 0, ZA + 60), (sg * 24, 0, ZA + 30 + dz * .3),
                                    (sg * 34, (j - 1.5) * 12, ZA + dz)], [0] * 8))
        return out

    def exh(sg):
        out = []
        for j in range(3):
            out.append(polyline(P, [(sg * 34, (j - 1) * 14, ZA + (j - 1) * 14), (sg * 24, 0, ZA + 30), (sg * 18, 0, ZA + 60),
                                    (sg * 8, 6, ZA + 84), (0, 40, ZA + 84), (0, 80, ZA + 84), (0, 110, ZA + 90)], [0] * 7))
        return out
    S['flows'] = {'suctL': sL, 'dischL': dL, 'suctR': sR, 'dischR': dR, 'airL': air(-1), 'airR': air(1),
                  'exhL': exh(-1), 'exhR': exh(1)}
    S['axis'] = dict(p=L(P, C), d=[1, 0, 0])
    S['cuts'] = {'long': dict(cn='纵剖', n=[0, -1, 0], p=L(P, (0, 0, ZA)))}
    S['pins'] = [
        dict(t='空气阀（滑阀）', p=L(P, (0, 0, ZA + 112)), part='P4_AirValve'),
        dict(t='中间体', p=L(P, (0, 0, ZA - 74)), part='P4_Center'),
        dict(t='左隔膜', p=L(P, (-48, 0, ZA + 98)), part='P4_DiaphragmL'),
        dict(t='右隔膜', p=L(P, (48, 0, ZA + 98)), part='P4_DiaphragmR'),
        dict(t='液室', p=L(P, (-78, 0, ZA + 10)), part='P4_CapL'),
        dict(t='中心轴', p=L(P, (0, 0, ZA + 16)), part='P4_Shaft'),
        dict(t='出口球阀', p=L(P, (64, 0, ZA + 108)), part='P4_BallOutR'),
        dict(t='进口球阀', p=L(P, (-64, 0, ZA - 104)), part='P4_BallInL'),
        dict(t='出口', p=L(P, (0, 0, ZT + 112)), part='P4_Pipes'),
        dict(t='进口', p=L(P, (0, -122, ZB + 22)), part='P4_Pipes'),
    ]
    S['views'] = {
        'home': dict(pos=L(P, (420, -720, 520)), tgt=L(P, (0, 0, 200))),
        'long': dict(pos=L(P, (0, -780, 230)), tgt=L(P, (0, 0, 205))),
        'valve': dict(pos=L(P, (40, -300, 330)), tgt=L(P, (0, 0, 260))),
        'explode': dict(pos=L(P, (640, -1000, 700)), tgt=L(P, (0, -40, 220))),
    }
    S['motion'] = dict(stroke=D4, dmax=DM4, ballLift=7, spool=6)
    S['cn'] = '气动隔膜泵'
    S['center'] = L(P, (0, 0, 200))
    SPEC[P] = S


# ================================================================ P5 电磁计量泵
# 结构参考：Iwaki US5330330（线圈、柱塞 + 衔铁、复位弹簧、柱塞头上装隔膜、后部旋钮调行程挡块）；
# Liquid Metronics US6280147（衔铁回程落在挡块上，挡块决定行程长度）；
# ProMinent US10677243 / US2015-0159639（吸入、排出各两个球阀串联；次氯酸钠放气导致气锁）
S5 = 10.0         # 最大行程（教学放大）
DM5 = 6.0


def build_p5(M):
    P = 'P5'
    S = {}
    ZA = 125.0
    C = (0, 0, ZA)
    # ---- 底座
    bm = bm_from(lambda b: box(b, (-25, 0, 20), (220, 160, 40), r=4))
    add('P5_Base', bm, [M['base']], P, '底座', 'frame')
    # ---- 机壳（空心）：后面开孔给行程旋钮，前面开孔给推杆
    outer = bm_from(lambda b: box(b, (-20, 0, ZA), (200, 150, 170), r=12, seg=3))
    inner = bm_from(lambda b: box(b, (-20, 0, ZA), (192, 142, 162), r=8, seg=2))
    holes = [bm_from(lambda b: cyl(b, (-130, 0, ZA), (-110, 0, ZA), 8.5, seg=24)),
             bm_from(lambda b: cyl(b, (70, 0, ZA), (90, 0, ZA), 7.5, seg=24))]
    bm = boolean(outer, cuts=[inner] + holes, name='P5case')
    setmat(bm, 0)
    add('P5_Housing', bm, [M['housing']], P, '机壳', 'frame', ex=(0, 0, 0), extras={'ghost': 1})
    # ---- 前面板：显示屏、按键、频率旋钮
    bm = bmesh.new()
    box(bm, (-30, -76, 162), (110, 3, 60), mi=0, r=2)
    box(bm, (-40, -78, 172), (62, 2, 24), mi=1)
    for k in range(4):
        box(bm, (-66 + 17 * k, -78.5, 146), (11, 3, 8), mi=2, r=1)
    cyl(bm, (35, -76, 155), (35, -88, 155), 13, seg=28, mi=3)
    box(bm, (35, -88.5, 162), (2.5, 1.5, 10), mi=4)
    add('P5_Panel', bm, [M['panel'], M['lcd'], M['housingD'], M['knob'], M['label']], P, '控制面板', 'frame', ex=(0, -60, 0))
    # ---- 电磁铁：线圈 + 轭铁 + 极靴
    bm = bm_from(lambda b: ring(b, 26, 50, -62, 6, C, 'X', 64, 0))
    add('P5_Coil', bm, [M['coil']], P, '电磁线圈', 'drive', ex=(0, 0, 0))
    bm = bmesh.new()
    ring(bm, 50, 56, -66, 16, C, 'X', 64, 0)
    ring(bm, 23, 56, -66, -62, C, 'X', 64, 0)
    ring(bm, 7, 56, 10, 16, C, 'X', 64, 0)
    ring(bm, 7, 25, -4, 10, C, 'X', 48, 0)
    box(bm, (-25, 0, ZA - 62), (90, 60, 12), mi=0)
    add('P5_Yoke', bm, [M['iron']], P, '轭铁 · 极靴', 'drive', ex=(0, 0, 0))
    # ---- 衔铁 + 推杆 + 弹簧座（一起前后动），原点 = 静止位置（最大行程时）
    bm = bmesh.new()
    revolve(bm, [(0, -80), (22, -80), (22, -14), (0, -14)], C, 'X', 48, 0)
    revolve(bm, [(0, -14), (5.5, -14), (5.5, 84.5), (0, 84.5)], C, 'X', 24, 1)
    ring(bm, 5.5, 13, 46, 50, C, 'X', 32, 1)
    add('P5_Armature', bm, [M['steel'], M['steelD']], P, '衔铁 · 推杆', 'drive', pivot=C, mov='armature', ex=(0, 0, 0))
    # ---- 复位弹簧：一头顶着弹簧座，一头顶着机壳前壁；原点在前壁
    bm = bmesh.new()
    helix(bm, C, 11, 1.4, 50, 76, 6, 'X', 0, seg=8, k=28)
    add('P5_Spring', bm, [M['steelD']], P, '复位弹簧', 'drive', pivot=(76, 0, ZA), mov='spring', ex=(0, 0, 0))
    # ---- 行程挡块 + 后旋钮
    bm = bmesh.new()
    revolve(bm, [(0, -134), (7, -134), (7, -80), (0, -80)], C, 'X', 24, 0)
    add('P5_Stop', bm, [M['brass']], P, '行程挡块（螺杆）', 'drive', pivot=(-80, 0, ZA), mov='stop', ex=(0, 0, 0))
    bm = bmesh.new()
    revolve(bm, [(0, -152), (20, -152), (22, -148), (22, -128), (14, -124), (0, -124)], C, 'X', 40, 0)
    box(bm, (-150, 0, ZA + 18), (3, 3, 8), mi=1)
    ring(bm, 26, 34, -122, -120, C, 'X', 48, 1)
    add('P5_Knob', bm, [M['knob'], M['label']], P, '行程长度旋钮', 'drive', ex=(-40, 0, 0))
    # ---- 电路板
    bm = bmesh.new()
    box(bm, (-40, -62, 160), (120, 3, 64), mi=0)
    for (x, z, w, h) in ((-70, 175, 18, 18), (-40, 168, 24, 14), (-10, 180, 14, 10), (-52, 145, 10, 12), (5, 150, 16, 16)):
        box(bm, (x, -59.5, z), (w, 3, h), mi=1)
    add('P5_PCB', bm, [principled('PCB', '#135c47', rough=.55), M['carbon']], P, '驱动电路', 'drive', ex=(0, -40, 0))
    # ---- 隔膜（PTFE，带形态键）和夹环
    bm = bm_from(lambda b: ring(b, 30, 46, 80, 84, C, 'X', 64, 0))
    add('P5_Adapter', bm, [M['steelD']], P, '隔膜夹环', 'frame', ex=(0, 0, 0))
    bm = bm_from(lambda b: revolve(b, [(0, 84), (44, 84), (44, 87), (0, 87)], C, 'X', 64, 0))
    ob = add('P5_Diaphragm', bm, [M['move']], P, '隔膜（PTFE）', 'wet', pivot=(85.5, 0, ZA), mov='diaphragm',
             ex=(60, 0, 0), ang=70)
    diaphragm_keys(ob, DM5, 8, 34)
    # ---- 泵头（PVDF）：液室 + 上下各两个串联球阀 + 接头
    head = bm_from(lambda b: revolve(b, [(0, 87), (46, 87), (48, 89), (48, 118), (44, 122), (0, 122)], C, 'X', 64, 0))
    hun = [bm_from(lambda b: cyl(b, (104, 0, ZA + 20), (104, 0, ZA + 86), 13, seg=36)),
           bm_from(lambda b: cyl(b, (104, 0, ZA + 84), (104, 0, ZA + 100), 9, seg=24)),
           bm_from(lambda b: cyl(b, (104, 0, ZA - 86), (104, 0, ZA - 20), 13, seg=36)),
           bm_from(lambda b: cyl(b, (104, 0, ZA - 100), (104, 0, ZA - 84), 9, seg=24))]
    hcut = [bm_from(lambda b: revolve(b, [(0, 86), (36, 86), (36, 87.5), (24, 93), (0, 97)], C, 'X', 64, 0)),
            bm_from(lambda b: cyl(b, (89, 0, ZA + 28), (104, 0, ZA + 28), 3.5, seg=16)),
            bm_from(lambda b: cyl(b, (89, 0, ZA - 28), (104, 0, ZA - 28), 3.5, seg=16)),
            bm_from(lambda b: revolve(b, [(0, ZA + 24.5), (3.5, ZA + 24.5), (3.5, ZA + 38), (7.5, ZA + 38), (7.5, ZA + 54),
                                          (3.5, ZA + 54), (3.5, ZA + 58), (7.5, ZA + 58), (7.5, ZA + 74), (3.5, ZA + 74),
                                          (3.5, ZA + 104), (0, ZA + 104)], (104, 0, 0), 'Z', 24, 0)),
            bm_from(lambda b: revolve(b, [(0, ZA - 104), (3.5, ZA - 104), (3.5, ZA - 80), (7.5, ZA - 80), (7.5, ZA - 64),
                                          (3.5, ZA - 64), (3.5, ZA - 60), (7.5, ZA - 60), (7.5, ZA - 44), (3.5, ZA - 44),
                                          (3.5, ZA - 24.5), (0, ZA - 24.5)], (104, 0, 0), 'Z', 24, 0))]
    bm = boolean(head, unions=hun, cuts=hcut, name='P5head')
    setmat(bm, 0)
    for k in range(6):
        t = TAU * k / 6 + .52
        p = Vector(_axis_pt('X', C, 40, t, 122))
        hexbolt(bm, p, (1, 0, 0), s=8, h=4, mi=1)
    add('P5_Head', bm, [M['pvdf'], M['steel']], P, '泵头（PVDF）', 'wet', ex=(130, 0, 0), ang=40)
    bm = bmesh.new()
    cyl(bm, (104, 13, ZA + 46), (104, 26, ZA + 46), 5, seg=16, mi=0)
    cyl(bm, (104, 26, ZA + 46), (104, 34, ZA + 46), 8, seg=20, mi=1)
    add('P5_Vent', bm, [M['pvdf'], M['knob']], P, '排气阀', 'wet', ex=(130, 0, 0))
    for kind, seats in (('Out', (ZA + 38, ZA + 58)), ('In', (ZA - 80, ZA - 60))):
        for j, z0 in enumerate(seats):
            zc = z0 + sqrt(36 - 12.25)
            bm = bm_from(lambda b, zc=zc: ball(b, (104, 0, zc), 6, seg=20))
            add(f'P5_Ball{kind}{j}', bm, [M['ceramic']], P, ('进口' if kind == 'In' else '出口') + '球阀', 'wet',
                pivot=(104, 0, zc), mov=f'ball{kind}', ex=(130, -50, 0))
    # ---- 配管
    bm = bmesh.new()
    sweep(bm, [(104, 0, ZA + 100), (104, 0, ZA + 140), (112, 0, ZA + 158), (140, 0, ZA + 164), (210, 0, ZA + 164)], 5, seg=16)
    sweep(bm, [(104, 0, ZA - 100), (104, 0, ZA - 112), (104, 0, 0)], 5, seg=16)
    add('P5_Pipes', bm, [M['tube']], P, '进出口软管', 'pipe', ex=(130, 0, 0), extras={'ghost': 1})
    bm = bm_from(lambda b: sweep(b, [(-120, 50, 70), (-150, 50, 60), (-175, 40, 30), (-200, 20, 8)], 4, seg=10))
    add('P5_Cable', bm, [M['rubber']], P, '电源线', 'frame')

    # ---- 流线
    suct, disch = [], []
    for j in range(5):
        dx = (j - 2) * 1.0
        pts = [(104 + dx, 0, 2), (104 + dx, 0, 40), (104 + dx * .5, 0, ZA - 90), (104, 0, ZA - 78), (104 + dx * .8, 2, ZA - 70),
               (104, 0, ZA - 58), (104 + dx * .8, 2, ZA - 50), (104, 0, ZA - 36), (100, 0, ZA - 28), (92, 0, ZA - 26),
               (91, (j - 2) * 5, ZA - 10 + j * 4)]
        suct.append(polyline(P, pts, [.05] * len(pts)))
        pts = [(91, (j - 2) * 5, ZA + 10 - j * 4), (92, 0, ZA + 26), (100, 0, ZA + 28), (104, 0, ZA + 36), (104 + dx * .8, 2, ZA + 46),
               (104, 0, ZA + 56), (104 + dx * .8, 2, ZA + 66), (104, 0, ZA + 78), (104, 0, ZA + 110), (104, 0, ZA + 140),
               (114, 0, ZA + 158), (150, 0, ZA + 164 + dx), (210, 0, ZA + 164 + dx)]
        disch.append(polyline(P, pts, [.9] * len(pts)))
    S['flows'] = {'suct': suct, 'disch': disch}
    S['axis'] = dict(p=L(P, C), d=[1, 0, 0])
    S['cuts'] = {'long': dict(cn='纵剖', n=[0, -1, 0], p=L(P, (0, 0, ZA)))}
    S['pins'] = [
        dict(t='电磁线圈', p=L(P, (-28, 0, ZA + 60)), part='P5_Coil'),
        dict(t='衔铁', p=L(P, (-48, 0, ZA + 32)), part='P5_Armature'),
        dict(t='复位弹簧', p=L(P, (63, 0, ZA + 24)), part='P5_Spring'),
        dict(t='行程长度旋钮', p=L(P, (-140, 0, ZA + 40)), part='P5_Knob'),
        dict(t='隔膜', p=L(P, (86, 0, ZA + 56)), part='P5_Diaphragm'),
        dict(t='泵头', p=L(P, (122, 0, ZA - 52)), part='P5_Head'),
        dict(t='出口双球阀', p=L(P, (126, 0, ZA + 64)), part='P5_BallOut0'),
        dict(t='进口双球阀', p=L(P, (126, 0, ZA - 64)), part='P5_BallIn0'),
        dict(t='排气阀', p=L(P, (104, 44, ZA + 58)), part='P5_Vent'),
        dict(t='控制面板', p=L(P, (-30, -82, 202)), part='P5_Panel'),
    ]
    S['views'] = {
        'home': dict(pos=L(P, (420, -620, 400)), tgt=L(P, (0, 0, 120))),
        'long': dict(pos=L(P, (0, -620, 170)), tgt=L(P, (0, 0, 125))),
        'head': dict(pos=L(P, (150, -270, 165)), tgt=L(P, (100, 0, 125))),
        'explode': dict(pos=L(P, (560, -820, 500)), tgt=L(P, (40, -20, 130))),
    }
    S['motion'] = dict(stroke=S5, dmax=DM5, ballLift=3, springL=26, mid=S5 / 2)
    S['cn'] = '电磁计量泵'
    S['center'] = L(P, (0, 0, 125))
    SPEC[P] = S


# ================================================================ 场景、导出、渲染
def setup_render():
    sc = bpy.context.scene
    w = bpy.data.worlds.new('World')
    sc.world = w
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs[0].default_value = (*hexcol('#0b1626'), 1)
    bg.inputs[1].default_value = .6

    def light(name, loc_, energy, size, tgt=(0, 0, .2)):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.energy = energy
        ld.size = size
        ob = bpy.data.objects.new(name, ld)
        collection('Studio').objects.link(ob)
        ob.location = loc_
        d = Vector(tgt) - Vector(loc_)
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        return ob

    S = [light('Key', (-1.6, -2.6, 2.6), 700, 2.6), light('Rim', (2.6, 2.0, 1.6), 420, 2.6),
         light('Fill', (-2.8, 1.6, 1.2), 240, 2.6)]
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=12000)
    gm = principled('Ground', '#101a29', rough=.55)
    me = bpy.data.meshes.new('Ground')
    bm.to_mesh(me)
    bm.free()
    me.transform(Matrix.Scale(MM, 4))
    me.materials.append(gm)
    g = bpy.data.objects.new('Ground', me)
    collection('Studio').objects.link(g)
    cam_d = bpy.data.cameras.new('Camera')
    cam_d.lens = 55
    cam_d.clip_start = .02
    cam_d.clip_end = 40
    cam = bpy.data.objects.new('Camera', cam_d)
    collection('Studio').objects.link(cam)
    sc.camera = cam
    return cam, S


def aim(cam, pos, tgt):
    cam.location = Vector(pos)
    cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()


def render(cam, name, pos, tgt, hide=(), only=None, frame=1, lens=55, res=None, aspect=.62):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = ARGS.samples
    sc.cycles.use_denoising = True
    sc.cycles.device = 'CPU'
    sc.frame_set(frame)
    r = res or ARGS.res
    sc.render.resolution_x = r
    sc.render.resolution_y = int(r * aspect)
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 86
    items = [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items]
    sc.view_settings.view_transform = 'AgX' if 'AgX' in items else 'Filmic'
    cam.data.lens = lens
    aim(cam, Vector(pos) * MM, Vector(tgt) * MM)
    for ob, p in OBJS:
        ob.hide_render = any(ob.name.startswith(h) for h in hide) or (only is not None and p not in only)
    sc.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    print('[OK] rendered', name)
    for ob, _ in OBJS:
        ob.hide_render = False


def animate():
    """爆炸动画：每个零件沿 ex 平移"""
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, FRAMES + 1
    for ob, _ in OBJS:
        ex = Vector(ob.get('ex', (0, 0, 0)))
        if ex.length < 1e-6:
            continue
        base = ob.location.copy()
        ob.keyframe_insert('location', frame=1)
        ob.location = base + ex * MM
        ob.keyframe_insert('location', frame=FRAMES + 1)
        ob.location = base


def export_glb(path):
    bpy.context.scene.frame_set(1)
    for ob in bpy.context.scene.objects:
        ob.hide_viewport = False
        ob.hide_set(False)
        ob.select_set(ob.type == 'MESH' and ob.name != 'Ground')
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_extras=True,
              export_yup=True, export_animations=False, export_cameras=False, export_lights=False,
              export_morph=True, export_morph_normal=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop('export_morph_normal')
        bpy.ops.export_scene.gltf(**kw)
    print('[OK] exported', path, os.path.getsize(path) // 1024, 'KB')


BUILDERS = [('P1', build_p1), ('P2', build_p2), ('P3', build_p3), ('P4', build_p4), ('P5', build_p5)]


def main():
    reset()
    M = make_materials()
    only = set(ARGS.only.split(',')) if ARGS.only else None
    for key, fn in BUILDERS:
        if only and key not in only:
            continue
        fn(M)
        print('[OK] built', key)
    tris = 0
    for o, _ in OBJS:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    spec = dict(offset=OFFSET, pumps=SPEC, parts=PARTS, tris=tris)
    with open(os.path.join(OUT, 'spec.json'), 'w', encoding='utf-8') as f:
        json.dump(spec, f, ensure_ascii=False, separators=(',', ':'))
    cam, _ = setup_render()
    export_glb(os.path.join(OUT, 'pumps.glb'))
    animate()
    aim(cam, (-1.2, -3.2, 1.4), (0, 0, .2))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'pumps.blend'), compress=True)
    print('[OK] saved pumps.blend')
    if ARGS.render:
        render_all(cam)
    print(f'[OK] {len(OBJS)} objects, {tris} triangles')


def cut_copies(pump, n, p):
    """渲染用：复制这台泵的零件，用布尔减掉朝向镜头的一半；切面用该零件主材质的深色版"""
    made = []
    n = Vector(n).normalized()
    for ob, pp in OBJS:
        if pp != pump or ob.get('role') == 'pipe':
            continue
        me = ob.data.copy()
        c = bpy.data.objects.new(ob.name + '_cut', me)
        collection('Cut').objects.link(c)
        c.matrix_world = ob.matrix_world.copy()
        m0 = me.materials[0]
        key = m0.name + '_cap'
        cm = bpy.data.materials.get(key)
        if cm is None:
            col = m0.diffuse_color
            cm = principled(key, '#%02x%02x%02x' % tuple(int(255 * (max(0, min(1, x)) ** (1 / 2.2)) * .72) for x in col[:3]),
                            rough=.8)
        cb = bmesh.new()
        bmesh.ops.create_cube(cb, size=6.0)
        bmesh.ops.translate(cb, vec=n * 3.0 + Vector(p) * MM, verts=list(cb.verts))
        cme = bpy.data.meshes.new(ob.name + '_cutter')
        cb.to_mesh(cme)
        cb.free()
        cme.materials.append(cm)
        cutter = bpy.data.objects.new(ob.name + '_cutter', cme)
        bpy.context.scene.collection.objects.link(cutter)
        cutter.hide_render = True
        md = c.modifiers.new('cut', 'BOOLEAN')
        md.operation = 'DIFFERENCE'
        md.object = cutter
        md.solver = 'EXACT'
        try:
            md.material_mode = 'TRANSFER'
            md.use_self = True
        except (AttributeError, TypeError):
            pass
        made += [c, cutter]
    return made


CUTMAT = []


def render_all(cam):
    allv = dict(pos=(0, -4100, 1550), tgt=(20, 0, 190))
    render(cam, 'view_family.jpg', allv['pos'], allv['tgt'], lens=40, aspect=.5)
    for key, S in SPEC.items():
        v = S['views']['home']
        render(cam, f'view_{key}.jpg', v['pos'], v['tgt'], only={key}, res=1000)
        cname = 'long'
        cut = S['cuts'][cname]
        made = cut_copies(key, cut['n'], cut['p'])
        vv = S['views'][cname]
        for ob, p in OBJS:
            ob.hide_render = True
        sc = bpy.context.scene
        sc.render.filepath = os.path.join(OUT, f'view_{key}_cut.jpg')
        cam.data.lens = 55
        aim(cam, Vector(vv['pos']) * MM, Vector(vv['tgt']) * MM)
        sc.render.resolution_x = 1000
        sc.render.resolution_y = 620
        bpy.ops.render.render(write_still=True)
        print('[OK] rendered cut', key)
        for c in made:
            bpy.data.objects.remove(c, do_unlink=True)
        for ob, _ in OBJS:
            ob.hide_render = False


main()
