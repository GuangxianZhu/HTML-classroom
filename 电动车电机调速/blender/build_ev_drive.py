#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
电动车三合一电驱 · Blender 纯脚本建模（教学用虚构机型，不对应任何具体产品）

运行方式（二选一）:
    blender -b -P build_ev_drive.py -- --out out [--render]
    python  build_ev_drive.py --out out [--render]      # 需要 pip install bpy

输出:
    ev_drive.blend   Blender 工程；按空格播放 = 爆炸动画（第 1 帧装配，第 121 帧全拆开）
    ev_drive.glb     给网页用（零件独立命名，extras 里带分组和转动关系）
    spec.json        参数、爆炸路线、零件说明、能量流路径（网页读这一份）
    view_*.jpg       只有加 --render 时才渲染（Cycles）

坐标约定:
    尺寸全部按毫米写，建完缩放成米。半轴轴线 = X 轴（车宽方向），+Y 朝车头，+Z 朝上，轮心在原点。
    机械角 ϑ 的位置 = (y, z) = (-r·cos ϑ, r·sin ϑ)。这样从电机后端（-X）看过去 ϑ 就是
    屏幕上的数学角：0° 在右、逆时针为正，车辆前进时转子正好逆时针转。
    网页里所有转动件都是 node.rotation.x = -角度。
    电角度 α = p·ϑ。U 相轴线在 α = 0，转子第 0 极（N）在 ϑ = 0，所以 θ_e = p·θ_m 时定子 U 相轴线对准转子 N 极。
"""
import argparse
import json
import math
import os
import sys
from math import atan2, cos, pi, radians, sin, sqrt, tan

import bpy  # 必须排在 bmesh 前面：pip 版 bpy 导入后才注册 bmesh / mathutils
import bmesh
from mathutils import Matrix, Vector
from mathutils.geometry import delaunay_2d_cdt

HERE = os.path.dirname(os.path.abspath(__file__))
_argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
_ap = argparse.ArgumentParser()
_ap.add_argument('--out', default=os.path.join(HERE, 'out'))
_ap.add_argument('--render', action='store_true')
_ap.add_argument('--samples', type=int, default=48)
ARGS, _ = _ap.parse_known_args(_argv)
OUT = os.path.abspath(ARGS.out)
os.makedirs(OUT, exist_ok=True)

MM = 0.001
FRAMES = 120

# ---------------------------------------------------------------- 参数表 (mm)
P_POLE = 4                    # 极对数（8 极）
NS = 48                       # 定子槽数
LAYERS = 4                    # 每槽 4 层发卡导体
R_SO, R_SI = 110.0, 75.0      # 定子外径 Φ220 / 内径 Φ150
R_RO = 74.0                   # 转子外径（气隙 1 mm）
R_BORE = 22.0                 # 转子内孔 / 轴径
X_L, X_R = -225.0, -75.0      # 铁芯轴向范围（叠厚 150）
SLOT_W, SLOT_R0, SLOT_R1 = 2.7, 78.0, 98.0   # 槽半宽 / 槽底起止半径
BAR_W, BAR_H = 4.2, 4.3       # 发卡导体截面（切向 × 径向）
R_CASE_I, R_CASE_O = 110.0, 126.0            # 机壳内外半径
X_CASE0, X_CASE1 = -286.0, -8.0              # 机壳轴向范围
Z1, Z2, Z3, Z4 = 21, 65, 25, 73              # 两级减速齿数
M1, M2 = 2.0, 2.5                            # 模数
RATIO = (Z2 / Z1) * (Z4 / Z3)
A1 = M1 * (Z1 + Z2) / 2       # 第一级中心距
A2 = M2 * (Z3 + Z4) / 2       # 第二级中心距
X_G1, X_G2 = 32.0, 74.0       # 两级齿轮中面
GW1, GW2 = 26.0, 30.0         # 齿宽
HELIX = radians(18)           # 螺旋角
R_WHEEL = 335.0
X_WHEEL = 780.0

# 三根轴在 (y, z) 平面的位置
INT = (A2 * cos(radians(20)), A2 * sin(radians(20)))
MOT = (INT[0] + A1 * cos(radians(25)), INT[1] + A1 * sin(radians(25)))
MY, MZ = MOT

QS0, QS1 = 0, 12              # 剖开的四分之一：ϑ ∈ [0°, 90°]，对应槽号 0..11


def pm(r, th):
    """机械角 ϑ → (y, z)"""
    return (-r * cos(th), r * sin(th))


def slot_angle(k):
    return (k + .5) * 2 * pi / NS


def slot_phase(k):
    """第 k 槽属于哪一相、电流正方向的符号。8 极 48 槽、每极每相 2 槽的整距分布绕组。"""
    a = (15 + 30 * k) % 360
    return [('V', -1), ('U', 1), ('W', -1), ('V', 1), ('U', -1), ('W', 1)][int(a // 60)]


def layer_r(l):
    return SLOT_R0 + (SLOT_R1 - SLOT_R0) * (l + .5) / LAYERS


# ---------------------------------------------------------------- 场景 / 材质
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


def srgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def make_tex(name, w, h, fn):
    img = bpy.data.images.new(name, w, h, alpha=False)
    px = []
    for j in range(h):
        for i in range(w):
            r, g, b = fn((i + .5) / w, (j + .5) / h)
            px += [r, g, b, 1.0]
    img.pixels[:] = px
    try:
        img.pack()
    except Exception as e:
        print('[WARN] pack image failed', name, e)
    return img


def principled(name, hexc, metal=0.0, rough=0.5, coat=0.0, tex=None, alpha=None, emit=None):
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
    if emit:
        put(['Emission Color', 'Emission'], (*hexcol(emit[0]), 1))
        put(['Emission Strength'], emit[1])
    if alpha is not None:
        put(['Alpha'], alpha)
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    if tex is not None:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = tex
        t.extension = 'REPEAT'
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    m.diffuse_color = (*col, 1.0)
    m.metallic = metal
    m.roughness = rough
    return m


def make_materials():
    hi, lo = srgb('#aab2bd'), srgb('#59616c')
    tex_lam = make_tex('T_Lamination', 32, 2, lambda u, v: lo if u > .8 else hi)
    return dict(
        lam=principled('M_Lamination', '#aab2bd', .75, .4, tex=tex_lam),
        lam_face=principled('M_Lamination_Face', '#7f8a97', .8, .42),
        copper=principled('M_Copper', '#c8743a', 1, .3),
        weld=principled('M_Copper_Weld', '#e0a062', 1, .4),
        mag_n=principled('M_Magnet_N', '#d8383f', .35, .34),
        mag_s=principled('M_Magnet_S', '#2f6fdf', .35, .34),
        steel=principled('M_Shaft_Steel', '#c9cdd2', 1, .22),
        bearing=principled('M_Bearing_Steel', '#d7dadf', 1, .14),
        alu=principled('M_Cast_Alu', '#b6bcc4', .85, .46),
        alu_dark=principled('M_Cast_Alu_Dark', '#7b838e', .8, .5),
        gear=principled('M_Gear_Steel', '#a7adb6', 1, .28),
        water=principled('M_Coolant', '#29a8d8', 0, .2),
        black=principled('M_Plastic_Black', '#22262b', 0, .55),
        pcb=principled('M_PCB', '#17643f', 0, .42),
        chip=principled('M_Chip', '#14161a', .1, .4),
        film=principled('M_Film_Cap', '#59606b', .1, .5),
        switch=principled('M_Switch_Die', '#3a4250', .3, .35),
        sw_base=principled('M_DBC_Substrate', '#d9d4c7', 0, .55),
        gold=principled('M_Gold', '#d9b65c', 1, .3),
        hv=principled('M_HV_Orange', '#f07a12', 0, .4),
        rubber=principled('M_Rubber', '#16181b', 0, .78),
        tyre=principled('M_Tyre', '#1c1e21', 0, .86),
        rim=principled('M_Rim', '#c7ccd3', 1, .3),
        disc=principled('M_Brake_Disc', '#8b9099', 1, .38),
        caliper=principled('M_Caliper', '#c7302a', .1, .35),
        batt=principled('M_Batt_Case', '#39424e', .55, .5),
        cell=principled('M_Cell_Module', '#5b6675', .6, .4),
        busbar=principled('M_Busbar', '#d48a52', 1, .28),
        lid=principled('M_Inverter_Lid', '#8c95a1', .85, .42),
    )


# ---------------------------------------------------------------- 几何工具（单位 mm）
def tri2d(loops):
    """带孔多边形三角化，返回按“所有环首尾相接”编号的三角形。
    做法：先做全平面的约束 Delaunay，再用奇偶规则留下多边形内部的三角形。
    tessellate_polygon 碰到几十个孔会漏面，所以不用它。"""
    co, edges, base = [], [], 0
    for L in loops:
        n = len(L)
        co += [Vector((u, v)) for (u, v) in L]
        edges += [(base + i, base + (i + 1) % n) for i in range(n)]
        base += n
    vs, _e, faces, ov, _oe, _of = delaunay_2d_cdt(co, edges, [], 0, 1e-6)
    segs = [(co[a].x, co[a].y, co[b].x, co[b].y) for a, b in edges]
    out = []
    for f in faces:
        ids = [ov[i][0] if ov[i] else -1 for i in f]
        if min(ids) < 0 or len(ids) != 3:
            raise RuntimeError('cdt 产生了新顶点，轮廓可能自相交')
        cx = sum(co[i].x for i in ids) / 3
        cy = sum(co[i].y for i in ids) / 3
        inside = False
        for x0, y0, x1, y1 in segs:
            if (y0 > cy) != (y1 > cy) and cx < x0 + (cy - y0) * (x1 - x0) / (y1 - y0):
                inside = not inside
        if inside:
            out.append(tuple(ids))
    return out


def _bridge(bm, a, c):
    fs = []
    n = len(a)
    for i in range(n):
        fs.append(bm.faces.new((a[i], a[(i + 1) % n], c[(i + 1) % n], c[i])))
    return fs


def revolve(bm, prof, mi, seg=64, closed=True):
    """绕 X 轴回转。prof = [(r, x), ...]；r=0 时收成一点"""
    rings = []
    for (r, h) in prof:
        if r < 1e-6:
            rings.append([bm.verts.new((h, 0, 0))])
        else:
            rings.append([bm.verts.new((h, *pm(r, 2 * pi * k / seg))) for k in range(seg)])
    fs = []
    for k in range(len(rings) - (0 if closed else 1)):
        a, c = rings[k], rings[(k + 1) % len(rings)]
        if len(a) == 1 and len(c) == 1:
            continue
        if len(a) == 1:
            for i in range(seg):
                fs.append(bm.faces.new((a[0], c[i], c[(i + 1) % seg])))
        elif len(c) == 1:
            for i in range(seg):
                fs.append(bm.faces.new((a[i], a[(i + 1) % seg], c[0])))
        else:
            fs += _bridge(bm, a, c)
    for f in fs:
        f.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def revolve_sector(bm, loops, a0, a1, seg, mi):
    """(r, x) 平面的多边形（第 1 个外轮廓，其余为孔）绕 X 轴转过 a0..a1，两端封口"""
    steps = max(2, seg)
    grid = []
    for k in range(steps + 1):
        a = a0 + (a1 - a0) * k / steps
        grid.append([[bm.verts.new((x, *pm(r, a))) for (r, x) in L] for L in loops])
    fs = []
    for k in range(steps):
        for La, Lc in zip(grid[k], grid[k + 1]):
            fs += _bridge(bm, La, Lc)
    tris = tri2d(loops)
    f0 = [v for L in grid[0] for v in L]
    f1 = [v for L in grid[-1] for v in L]
    for t in tris:
        fs.append(bm.faces.new((f0[t[0]], f0[t[1]], f0[t[2]])))
        fs.append(bm.faces.new((f1[t[0]], f1[t[2]], f1[t[1]])))
    for f in fs:
        f.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def prism(bm, loops, w0, w1, mi, mapf):
    """2D 轮廓（第 1 个外轮廓，其余为孔）在 w0..w1 之间拉伸，mapf(u, v, w) -> (x, y, z)"""
    L0 = [[bm.verts.new(mapf(u, v, w0)) for (u, v) in L] for L in loops]
    L1 = [[bm.verts.new(mapf(u, v, w1)) for (u, v) in L] for L in loops]
    tris = tri2d(loops)
    f0 = [v for L in L0 for v in L]
    f1 = [v for L in L1 for v in L]
    fs = []
    for t in tris:
        fs.append(bm.faces.new((f0[t[0]], f0[t[1]], f0[t[2]])))
        fs.append(bm.faces.new((f1[t[0]], f1[t[2]], f1[t[1]])))
    for A, C in zip(L0, L1):
        fs += _bridge(bm, A, C)
    for f in fs:
        f.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def extrude(bm, loops, a0, a1, mi, axis='X'):
    """axis='X': (u,v)→(y,z)；'Z': (u,v)→(x,y)；'Y': (u,v)→(x,z)"""
    if axis == 'X':
        return prism(bm, loops, a0, a1, mi, lambda u, v, w: (w, u, v))
    if axis == 'Z':
        return prism(bm, loops, a0, a1, mi, lambda u, v, w: (u, v, w))
    return prism(bm, loops, a0, a1, mi, lambda u, v, w: (u, w, v))


def box(bm, x0, x1, y0, y1, z0, z1, mi):
    return extrude(bm, [[(y0, z0), (y1, z0), (y1, z1), (y0, z1)]], x0, x1, mi, 'X')


def circle(cx, cy, r, n=32):
    return [(cx + r * cos(2 * pi * k / n), cy + r * sin(2 * pi * k / n)) for k in range(n)]


def rrect(cx, cy, hw, hh, r, ns=4):
    pts = []
    for (ux, uy, a0) in ((hw - r, hh - r, 0), (-(hw - r), hh - r, pi / 2),
                         (-(hw - r), -(hh - r), pi), (hw - r, -(hh - r), 1.5 * pi)):
        for k in range(ns + 1):
            a = a0 + pi / 2 * k / ns
            pts.append((cx + ux + r * cos(a), cy + uy + r * sin(a)))
    return pts


def sweep_round(bm, path, radius, mi, sides=10):
    n = len(path)
    T = [(path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized() for i in range(n)]
    ref = Vector((0, 0, 1)) if abs(T[0].z) < .9 else Vector((0, 1, 0))
    N = [T[0].cross(ref).normalized()]
    for i in range(1, n):
        ax = T[i - 1].cross(T[i])
        v = N[-1].copy()
        if ax.length > 1e-9:
            v = Matrix.Rotation(T[i - 1].angle(T[i]), 3, ax.normalized()) @ v
        N.append(v)
    B = [T[i].cross(N[i]) for i in range(n)]
    rings = [[bm.verts.new(path[i] + radius * (cos(2 * pi * k / sides) * N[i] + sin(2 * pi * k / sides) * B[i]))
              for k in range(sides)] for i in range(n)]
    fs = []
    for i in range(n - 1):
        fs += _bridge(bm, rings[i], rings[i + 1])
    fs.append(bm.faces.new(rings[0][::-1]))
    fs.append(bm.faces.new(rings[-1]))
    for f in fs:
        f.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def sweep_rect(bm, path, rad, wt, wr, mi, cap=True):
    """矩形截面扫掠（发卡导体）。rad[i] = 该点的径向参考方向"""
    n = len(path)
    rings = []
    for i in range(n):
        t = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized()
        nr = (rad[i] - t * rad[i].dot(t)).normalized()
        b = t.cross(nr)
        rings.append([bm.verts.new(path[i] + nr * (s * wr / 2) + b * (q * wt / 2))
                      for (s, q) in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
    fs = []
    for i in range(n - 1):
        fs += _bridge(bm, rings[i], rings[i + 1])
    if cap:
        fs.append(bm.faces.new(rings[0][::-1]))
        fs.append(bm.faces.new(rings[-1]))
    for f in fs:
        f.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def catmull(ctrl, per=8):
    Pp = [ctrl[0]] + ctrl + [ctrl[-1]]
    out = []
    for i in range(1, len(Pp) - 2):
        p0, p1, p2, p3 = Pp[i - 1], Pp[i], Pp[i + 1], Pp[i + 2]
        for k in range(per):
            t = k / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(ctrl[-1])
    return out


def uv_x(bm, faces, period):
    uv = bm.loops.layers.uv.verify()
    for f in faces:
        for l in f.loops:
            l[uv].uv = (l.vert.co.x / period, .5)


def shade(me, ang):
    try:
        me.shade_smooth()
    except AttributeError:
        for p in me.polygons:
            p.use_smooth = True
    if hasattr(me, 'set_sharp_from_angle'):
        me.set_sharp_from_angle(angle=radians(ang))


def hull(points):
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def half(ps):
        h = []
        for p in ps:
            while len(h) >= 2 and ((h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) -
                                   (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0])) <= 0:
                h.pop()
            h.append(p)
        return h
    a, b = half(pts), half(pts[::-1])
    return a[:-1] + b[:-1]


# ---------------------------------------------------------------- 零件登记
OBJS = []       # (object, 分组)
GROUPS = {}     # 分组 → 中文名、说明
EX = {}         # 分组 → 爆炸位移 (dx, dy, dz, 出场时刻)


def grp(key, cn, en, desc, ex=None):
    GROUPS[key] = dict(cn=cn, en=en, desc=desc)
    EX[key] = ex or (0, 0, 0, 0)
    return key


def add(name, bm, mats, group, loc=(0, 0, 0), spin='', ang=34, coll='Drive'):
    """bmesh → 物体。loc 单位 mm（转动件的原点放在转轴上）"""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    textured = any(m.node_tree is not None and any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes) for m in mats)
    if textured and not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    elif not textured:
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
    me.validate(clean_customdata=False)
    me.transform(Matrix.Scale(MM, 4))
    ob = bpy.data.objects.new(name, me)
    collection(coll).objects.link(ob)
    shade(me, ang)
    ob.location = Vector(loc) * MM
    ob['group'] = group
    ob['spin'] = spin
    OBJS.append((ob, group))
    return ob


# ---------------------------------------------------------------- 定子
def stator_poly(k0, k1):
    """第 k0 个齿中心 → 第 k1 个齿中心的 C 形截面（切面正好落在齿中心线上，是实心的矩形）"""
    pitch = 2 * pi / NS
    a0, a1 = k0 * pitch, k1 * pitch
    n = max(8, int((k1 - k0) * 3))
    pts = [pm(R_SO, a0 + (a1 - a0) * i / n) for i in range(n + 1)]
    for k in range(k1 - 1, k0 - 1, -1):      # 内圈倒着走回来
        c = slot_angle(k)
        pts.append(pm(R_SI, (k + 1) * pitch))

        def loc(rho, tau):
            # 槽局部坐标 → (y, z)：ρ 沿径向，τ 沿 ϑ 增加方向
            return (-(rho * cos(c) - tau * sin(c)), rho * sin(c) + tau * cos(c))
        for rho, tau in ((R_SI, 1.3), (76.3, 1.3), (SLOT_R0 - .4, SLOT_W), (SLOT_R1 + .6, SLOT_W),
                         (SLOT_R1 + .6, -SLOT_W), (SLOT_R0 - .4, -SLOT_W), (76.3, -1.3), (R_SI, -1.3)):
            pts.append(loc(rho, tau))
    pts.append(pm(R_SI, a0))
    return pts


def build_stator(M):
    g = grp('stator', '定子铁芯', 'Stator core',
            '0.2~0.3 mm 硅钢片叠成，槽里放绕组。铁芯把线圈产生的磁通集中到气隙，让同样的电流得到大得多的磁场。',
            (-300, 0, 0, .46))
    for suffix, k0, k1 in (('main', QS1, NS), ('q', QS0, QS1)):
        bm = bmesh.new()
        fs = extrude(bm, [stator_poly(k0, k1)], X_L, X_R, 0, 'X')
        side = [f for f in fs if abs(f.normal.x) < .5]
        uv_x(bm, fs, 1.6)
        add(f'Stator_{suffix}', bm, [M['lam']], g, loc=(0, MY, MZ), ang=28)


def bar_mesh(bm, k, l, mi):
    th = slot_angle(k)
    r = layer_r(l)
    cy, cz = pm(1, th)
    rd = Vector((0, cy, cz))
    td = Vector((0, -sin(-th) * 0 + sin(th), cos(th)))   # ϑ 增加方向
    a = Vector((X_L - 3, 0, 0)) + rd * r
    b = Vector((X_R + 3, 0, 0)) + rd * r
    sweep_rect(bm, [a, b], [rd, rd], BAR_W, BAR_H, mi)


def crown(bm, k, l, mi):
    """后端（-X）发卡的 U 形弯：从槽 k 第 l 层到槽 k+6 第 l+1 层"""
    p = 2 * pi / NS
    a0, a1 = slot_angle(k), slot_angle(k) + 6 * p
    r0, r1 = layer_r(l), layer_r(l + 1)
    H = 24 + 3 * (l // 2)
    N = 12
    path, rad = [], []
    for i in range(N + 1):
        t = i / N
        s = t * t * (3 - 2 * t)
        a = a0 + (a1 - a0) * s
        r = r0 + (r1 - r0) * s
        x = X_L - 3 - H * sin(pi * t) ** .62
        y, z = pm(r, a)
        path.append(Vector((x, y, z)))
        cy, cz = pm(1, a)
        rad.append(Vector((0, cy, cz)))
    sweep_rect(bm, path, rad, BAR_W * .92, BAR_H * .92, mi)


def twist_leg(bm, k, l, sgn, mi):
    """前端（+X）焊接端：导体扭过半个节距再竖直伸出，末端和相邻层焊在一起"""
    p = 2 * pi / NS
    a0 = slot_angle(k)
    r = layer_r(l)
    N = 6
    path, rad = [], []
    for i in range(N + 1):
        t = i / N
        a = a0 + sgn * 3 * p * (t * t * (3 - 2 * t))
        x = X_R + 3 + 19 * t
        y, z = pm(r, a)
        path.append(Vector((x, y, z)))
        cy, cz = pm(1, a)
        rad.append(Vector((0, cy, cz)))
    end = pm(r, a0 + sgn * 3 * p)
    path.append(Vector((X_R + 29, *end)))
    rad.append(rad[-1].copy())
    sweep_rect(bm, path, rad, BAR_W * .92, BAR_H * .92, mi)


def weld(bm, k, l0, mi):
    """焊点：把相邻两层的端头连起来（k 是汇合处的槽号）"""
    a = slot_angle(k) + 3 * 2 * pi / NS
    r = (layer_r(l0) + layer_r(l0 + 1)) / 2
    c = Vector((X_R + 29.8, *pm(r, a)))
    cy, cz = pm(1, a)
    rd = Vector((0, cy, cz))
    sweep_rect(bm, [c - Vector((2.2, 0, 0)), c + Vector((1.2, 0, 0))], [rd, rd], BAR_W * 1.02, BAR_H * 2.2, mi)


def build_windings(M):
    g = grp('winding', '发卡绕组（U/V/W 三相）', 'Hairpin winding',
            '扁铜线弯成发卡插进定子槽，另一头焊在一起。比圆线绕组槽满率高、端部短，是目前的主流工艺。三相在空间上互差 120° 电角度。',
            (-300, 0, 0, .46))
    bars = {}
    ends = {}
    for k in range(NS):
        ph, sg = slot_phase(k)
        q = QS0 <= k < QS1
        key = (ph, 'p' if sg > 0 else 'n', q)
        bars.setdefault(key, bmesh.new())
        ek = (ph, q)
        ends.setdefault(ek, [bmesh.new(), bmesh.new()])   # 铜 / 焊点
        for l in range(LAYERS):
            bar_mesh(bars[key], k, l, 0)
        for l in (0, 2):
            crown(ends[ek][0], k, l, 0)
            twist_leg(ends[ek][0], k, l, 1, 0)
            twist_leg(ends[(ph, q)][0], (k + 6) % NS if False else k, l + 1, -1, 0)
            weld(ends[ek][0], k, l, 1)
    for (ph, sg, q), bm in bars.items():
        add(f"Bar_{ph}_{sg}{'_q' if q else ''}", bm, [M['copper']], g, loc=(0, MY, MZ), ang=20)
    for (ph, q), (bm, unused) in ends.items():
        unused.free()
        add(f"End_{ph}{'_q' if q else ''}", bm, [M['copper'], M['weld']], g, loc=(0, MY, MZ), ang=30)
    # 三相引出线：从焊接端沿径向穿出机壳，到顶部接线座
    for i, ph in enumerate('UVW'):
        bm = bmesh.new()
        x = -36.0 - i * 14
        rad = [Vector((0, 0, 1))] * 2
        y0 = 0.0
        a = Vector((x, y0, 96.0))
        b = Vector((x, y0, 142.0))
        sweep_rect(bm, [b, a], [Vector((1, 0, 0))] * 2, 8, 4, 0)
        add(f'Lead_{ph}', bm, [M['busbar']], g, loc=(0, MY, MZ), ang=20)


# ---------------------------------------------------------------- 转子
def pocket_pts(j, sgn):
    """第 j 极的一个 V 形磁钢槽。pole-local: u 沿极中心向外，v 沿切向。sgn = ±1 左右两片"""
    c = j * 2 * pi / (2 * P_POLE)
    P0 = (47.6, 4.4)
    P1 = (65.6, 22.0)
    dx, dy = P1[0] - P0[0], P1[1] - P0[1]
    L = sqrt(dx * dx + dy * dy)
    d = (dx / L, dy / L)
    n = (-d[1], d[0])
    t = 2.9
    corners = [(P0[0] - n[0] * t - d[0] * 1.2, P0[1] - n[1] * t - d[1] * 1.2),
               (P1[0] - n[0] * t, P1[1] - n[1] * t),
               (69.4, 19.0), (68.8, 22.0), (67.2, 24.6),
               (P1[0] + n[0] * t, P1[1] + n[1] * t),
               (P0[0] + n[0] * t - d[0] * 1.2, P0[1] + n[1] * t - d[1] * 1.2)]

    def to(u, v):
        return (-(u * cos(c) - sgn * v * sin(c)), u * sin(c) + sgn * v * cos(c))
    return [to(u, v) for u, v in corners]


def magnet_pts(j, sgn):
    c = j * 2 * pi / (2 * P_POLE)
    P0 = (48.2, 5.0)
    P1 = (64.6, 21.0)
    dx, dy = P1[0] - P0[0], P1[1] - P0[1]
    L = sqrt(dx * dx + dy * dy)
    d = (dx / L, dy / L)
    n = (-d[1], d[0])
    t = 2.75

    def to(u, v):
        return (-(u * cos(c) - sgn * v * sin(c)), u * sin(c) + sgn * v * cos(c))
    pts = [(P0[0] - n[0] * t, P0[1] - n[1] * t), (P1[0] - n[0] * t, P1[1] - n[1] * t),
           (P1[0] + n[0] * t, P1[1] + n[1] * t), (P0[0] + n[0] * t, P0[1] + n[1] * t)]
    return [to(u, v) for u, v in pts]


def build_rotor(M):
    g = grp('rotor', '转子（内嵌 V 形永磁体）', 'IPM rotor',
            '硅钢叠片里埋着 8 极钕铁硼磁钢，红 N 蓝 S。V 形布置把磁通聚到气隙，也让 q 轴电感大于 d 轴，于是多出一份磁阻转矩。',
            (-120, 0, 0, .34))
    outer = [pm(R_RO, 2 * pi * k / 192) for k in range(192)]
    holes = [[pm(R_BORE, 2 * pi * k / 48) for k in range(48)]]
    for j in range(2 * P_POLE):
        holes.append(pocket_pts(j, 1))
        holes.append(pocket_pts(j, -1))
        c = (j + .5) * 2 * pi / (2 * P_POLE)
        cy, cz = pm(37, c)
        holes.append(circle(cy, cz, 6.2, 24))
    bm = bmesh.new()
    fs = extrude(bm, [outer] + holes, X_L, X_R, 0, 'X')
    uv_x(bm, fs, 1.6)
    add('Rotor_core', bm, [M['lam']], g, loc=(0, MY, MZ), spin='m', ang=28)
    for pol, mat in (('N', 'mag_n'), ('S', 'mag_s')):
        bm = bmesh.new()
        for j in range(2 * P_POLE):
            if (j % 2 == 0) == (pol == 'N'):
                extrude(bm, [magnet_pts(j, 1)], X_L + .6, X_R - .6, 0, 'X')
                extrude(bm, [magnet_pts(j, -1)], X_L + .6, X_R - .6, 0, 'X')
        add(f'Rotor_mag_{pol}', bm, [M[mat]], g, loc=(0, MY, MZ), spin='m', ang=20)
    for tag, x0, x1 in (('L', X_L - 5, X_L), ('R', X_R, X_R + 5)):
        bm = bmesh.new()
        revolve(bm, [(R_BORE, x0), (R_RO - .4, x0), (R_RO - .4, x1), (R_BORE, x1)], 0, seg=96)
        for k in range(10):
            pass
        add(f'Rotor_plate_{tag}', bm, [M['alu']], g, loc=(0, MY, MZ), spin='m', ang=30)
    # 轴
    bm = bmesh.new()
    prof = [(0, -294), (11, -294), (12, -292), (12, -272), (15, -272), (15, -262), (18, -262), (18, -240),
            (R_BORE, -238), (R_BORE, -40), (18, -38), (18, -14), (15, -12), (15, 14), (13, 18), (13, 62), (12, 64), (0, 64)]
    revolve(bm, prof, 0, seg=48)
    add('Shaft', bm, [M['steel']], g, loc=(0, MY, MZ), spin='m', ang=30)


def bearing_bm(xc, ri, ro, b, nb=9):
    bm = bmesh.new()
    rm = (ri + ro) / 2
    t = (ro - ri) * .24
    revolve(bm, [(ri, xc - b / 2), (rm - t, xc - b / 2), (rm - t, xc + b / 2), (ri, xc + b / 2)], 0, seg=40)
    revolve(bm, [(rm + t, xc - b / 2), (ro, xc - b / 2), (ro, xc + b / 2), (rm + t, xc + b / 2)], 0, seg=48)
    rb = (ro - ri) * .24
    for i in range(nb):
        a = 2 * pi * i / nb
        c = Vector((xc, *pm(rm, a)))
        res = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=rb,
                                        matrix=Matrix.Translation(c))
        for v in res['verts']:
            pass
    return bm


def build_bearings_resolver(M):
    g = grp('bearing', '轴承', 'Bearings', '两端各一只深沟球轴承。转子每分钟上万转，电机轴承要耐高速，还要防轴电流电蚀。', (-200, 0, 0, .30))
    add('Bearing_R', bearing_bm(-267, 15, 32, 10), [M['bearing']], g, loc=(0, MY, MZ), ang=40)
    add('Bearing_F', bearing_bm(-20, 15, 32, 10), [M['bearing']], g, loc=(0, MY, MZ), ang=40)
    g = grp('resolver', '旋转变压器（测转子角度）', 'Resolver',
            '无接触地测转子绝对角度。控制器每 100 μs 左右要知道一次转子转到哪，才知道该把磁场放在哪。', (-120, 0, 0, .28))
    bm = bmesh.new()         # 凸极转子
    pts = []
    for k in range(120):
        a = 2 * pi * k / 120
        pts.append(pm(22 + 2.4 * cos(3 * a), a))
    extrude(bm, [pts, [pm(18, 2 * pi * k / 32) for k in range(32)]], -258, -248, 0, 'X')
    add('Resolver_rotor', bm, [M['lam_face']], g, loc=(0, MY, MZ), spin='m', ang=30)
    bm = bmesh.new()         # 定子环 + 小线圈
    revolve(bm, [(27, -259), (38, -259), (38, -247), (27, -247)], 0, seg=64)
    for k in range(12):
        a = 2 * pi * k / 12 + .1
        cy, cz = pm(31, a)
        cdx = rrect(cy, cz, 3.0, 3.0, 1.0, 2)
        extrude(bm, [cdx], -261, -245, 1, 'X')
    add('Resolver_stator', bm, [M['lam_face'], M['copper']], grp('resolver_s', '旋转变压器定子', 'Resolver stator', '固定在后端盖上的线圈环，由控制器注入约 10 kHz 的激励，读回 sin / cos 两路信号解算角度。', (-560, 0, 0, .10)), loc=(0, MY, MZ), ang=30)


# ---------------------------------------------------------------- 机壳 + 水道
def case_loops():
    ribs = []
    x = X_CASE0
    outer = [(R_CASE_I + 2, X_CASE0), (R_CASE_O + 8, X_CASE0), (R_CASE_O + 8, X_CASE0 + 14), (R_CASE_O, X_CASE0 + 16)]
    n = 8
    xr0, xr1 = X_CASE0 + 34, X_CASE1 - 34
    for i in range(n):
        xc = xr0 + (xr1 - xr0) * i / (n - 1)
        outer += [(R_CASE_O, xc - 5), (R_CASE_O + 3.5, xc - 3.5), (R_CASE_O + 3.5, xc + 3.5), (R_CASE_O, xc + 5)]
    outer += [(R_CASE_O, X_CASE1 - 16), (R_CASE_O + 8, X_CASE1 - 14), (R_CASE_O + 8, X_CASE1), (R_CASE_I + 2, X_CASE1)]
    outer += [(R_CASE_I, X_R + 40), (R_CASE_I, X_L - 34)]
    return outer


def channels():
    out = []
    n = 7
    x0, x1 = X_L + 8, X_R - 8
    w = (x1 - x0) / n * .62
    for i in range(n):
        xc = x0 + (x1 - x0) * (i + .5) / n
        out.append([(113.5, xc - w / 2), (123, xc - w / 2), (123, xc + w / 2), (113.5, xc + w / 2)])
    return out


def build_case(M):
    g = grp('case', '电机壳体（带冷却水道）', 'Motor housing',
            '铸铝壳体里有水道。电机发热主要在定子铜线和铁芯，靠壳体水冷带走。连续功率常常不是电磁设计决定的，是散热决定的。',
            (-470, 0, 0, .40))
    q_a = radians(90)
    hub = case_loops()
    for suffix, a0, a1, seg in (('main', q_a, 2 * pi, 84), ('q', 0, q_a, 28)):
        bm = bmesh.new()
        revolve_sector(bm, [hub] + channels(), a0, a1, seg, 0)
        add(f'Case_{suffix}', bm, [M['alu']], g, loc=(0, MY, MZ), ang=30)
        bm = bmesh.new()
        for ch in channels():
            revolve_sector(bm, [ch], a0, a1, seg, 0)
        add(f'Water_{suffix}', bm, [M['water']], g, loc=(0, MY, MZ), ang=30)
    # 顶部接线座
    bm = bmesh.new()
    box(bm, -74, -24, -34, 34, 128, 150, 0)
    add('Terminal_base', bm, [M['alu']], g, loc=(0, MY, MZ), ang=30)
    # 后端盖
    g2 = grp('cap_rear', '后端盖', 'Rear end cover', '封住电机后端，里面装后轴承和旋转变压器定子。', (-640, 0, 0, .06))
    bm = bmesh.new()
    prof = [(0, -304), (46, -304), (50, -300), (58, -296), (R_CASE_O + 8, -296), (R_CASE_O + 8, X_CASE0 - 1),
            (R_CASE_O - 18, X_CASE0 - 1), (36, -274), (34, -262), (32, -262), (32, -272), (0, -278)]
    revolve(bm, prof, 0, seg=84)
    for i in range(12):
        a = (i + .5) * 2 * pi / 12
        cy, cz = pm(R_CASE_O + 1, a)
        pts = [(cy + 6 * cos(k * pi / 3), cz + 6 * sin(k * pi / 3)) for k in range(6)]
        extrude(bm, [pts], -301, -296, 0, 'X')
    add('Cap_rear', bm, [M['alu_dark']], g2, loc=(0, MY, MZ), ang=30)


# ---------------------------------------------------------------- 减速器
def gear_bm(z, m, width, xc, phase, helix_sign, bore, holes=0, hole_r=0, hole_c=0, layers=4, bm=None):
    bm = bm or bmesh.new()
    rp, ra, rf = m * z / 2, m * z / 2 + m, m * z / 2 - 1.25 * m
    p = 2 * pi / z
    prof = []
    for k in range(z):
        a = k * p
        prof += [(rf, a - .5 * p), (rf, a - .30 * p), (rp, a - .25 * p), (ra, a - .13 * p), (ra, a + .13 * p),
                 (rp, a + .25 * p), (rf, a + .30 * p)]
    twist = width * tan(HELIX) / rp * helix_sign
    loops_rot = []

    def ring(pts, dth):
        return [Vector((0, *pm(r, a + phase + dth))) for r, a in pts]
    hole_loops = []
    if bore:
        hole_loops.append([(bore, 2 * pi * k / 40) for k in range(40)])
    rings = []
    for li in range(layers + 1):
        t = li / layers
        x = xc - width / 2 + width * t
        dth = twist * (t - .5)
        rings.append([bm.verts.new(Vector((x, 0, 0)) + v) for v in ring(prof, dth)])
    fs = []
    for li in range(layers):
        fs += _bridge(bm, rings[li], rings[li + 1])
    # 端面 + 孔
    loops2d = [[pm(r, a + phase) for r, a in prof]]
    hole_xy = []
    if bore:
        hole_xy.append([pm(bore, 2 * pi * k / 40) for k in range(40)])
    for i in range(holes):
        c = 2 * pi * (i + .5) / holes + phase
        cy, cz = pm(hole_c, c)
        hole_xy.append(circle(cy, cz, hole_r, 20))
    tris = tri2d(loops2d + hole_xy)
    for end, sgn in ((0, -1), (layers, 1)):
        x = xc - width / 2 + width * end / layers
        dth = twist * (end / layers - .5)
        rot = Matrix.Rotation(-dth, 3, 'X')
        vs = list(rings[end])
        hv = []
        for H in hole_xy:
            hv.append([bm.verts.new(Vector((x, 0, 0)) + rot @ Vector((0, u, v))) for u, v in H])
        allv = vs + [v for L in hv for v in L]
        for t in tris:
            tri = (allv[t[0]], allv[t[1]], allv[t[2]]) if sgn > 0 else (allv[t[0]], allv[t[2]], allv[t[1]])
            fs.append(bm.faces.new(tri))
        hole_rings = hv
        if end == 0:
            h0 = hv
        else:
            for A, C in zip(h0, hv):
                fs += _bridge(bm, A, C)
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    for f in fs:
        f.material_index = 0
    return bm


def reducer_outline(off):
    pts = []
    for (c, r) in ((MOT, 62 - off), (INT, 84 - off), ((0, 0), 112 - off)):
        pts += [(round(c[0] + r * cos(2 * pi * k / 64), 3), round(c[1] + r * sin(2 * pi * k / 64), 3)) for k in range(64)]
    return hull(pts)


def build_reducer(M):
    th12 = atan2(INT[1] - MOT[1], -(INT[0] - MOT[0]))     # 从电机轴指向中间轴的 ϑ 角
    th34 = atan2(-INT[1], INT[0])                          # 从中间轴指向差速器的 ϑ 角
    h1 = th12
    h2 = th12 + pi + pi / Z2
    h3 = th34
    h4 = th34 + pi + pi / Z4
    g = grp('gear1', '一级主动齿轮', 'Input pinion', '和转子同轴。电机转一圈它转一圈，是整个减速比的起点。', (-120, 0, 0, .34))
    add('Gear_1', gear_bm(Z1, M1, GW1, X_G1, h1, 1, 11.5), [M['gear']], g, loc=(0, MY, MZ), spin='m', ang=24)
    g = grp('gear23', '中间轴双联齿轮', 'Intermediate gears', '大齿轮接电机小齿轮，小齿轮带差速器。两级相乘得到约 9 倍减速比。', (0, 0, -40, .26))
    add('Gear_2', gear_bm(Z2, M1, GW1, X_G1, h2, -1, 14, 6, 11, 42), [M['gear']], g, loc=(0, INT[0], INT[1]), spin='i', ang=24)
    add('Gear_3', gear_bm(Z3, M2, GW2, X_G2, h3, 1, 14), [M['gear']], g, loc=(0, INT[0], INT[1]), spin='i', ang=24)
    bm = bmesh.new()
    revolve(bm, [(0, 6), (10, 6), (14, 8), (14, 92), (10, 94), (0, 94)], 0, seg=32)
    add('IShaft', bm, [M['steel']], g, loc=(0, INT[0], INT[1]), spin='i', ang=30)
    g = grp('diff', '主减速大齿轮 + 差速器', 'Final gear & differential',
            '扭矩到这里已放大约 9 倍，再由差速器分给左右半轴，转弯时允许两轮转速不同。', (220, 0, 0, .22))
    add('Gear_4', gear_bm(Z4, M2, GW2, X_G2, h4, -1, 46, 8, 7.5, 62), [M['gear']], g, spin='w', ang=24)
    bm = bmesh.new()
    prof = [(0, 28), (14, 28), (20, 30), (24, 40), (46, 52), (47, 62), (47, 90), (42, 96), (24, 104), (18, 108), (0, 108)]
    revolve(bm, prof, 0, seg=56)
    add('Diff_cage', bm, [M['alu_dark']], g, spin='w', ang=30)
    # 减速器壳
    g = grp('reducer_case', '减速器壳体', 'Gearbox case', '和电机壳做成一体，这就是三合一电驱的“合”。', (0, 0, 0, 0))
    out = reducer_outline(0)
    inner = reducer_outline(7)
    bm = bmesh.new()
    extrude(bm, [out], -8, 0, 0, 'X')
    extrude(bm, [out, inner], 0, 52, 0, 'X')
    extrude(bm, [[(y + 0, z) for y, z in out], [(y, z) for y, z in inner]], 52, 58, 0, 'X')
    add('Reducer_case', bm, [M['alu']], g, ang=30)
    g = grp('reducer_cover', '减速器后盖', 'Gearbox cover', '拆开就能看到两级斜齿轮。斜齿比直齿啮合更平顺、噪声更低，这在电动车上很要紧，因为没有发动机声盖住它。', (260, 0, 0, .16))
    bm = bmesh.new()
    extrude(bm, [out, inner], 58, 98, 0, 'X')
    extrude(bm, [out], 98, 106, 0, 'X')
    for (c, r) in (((0, 0), 34),):
        cc = circle(c[0], c[1], r, 40)
        extrude(bm, [cc], 106, 112, 0, 'X')
    add('Reducer_cover', bm, [M['alu']], g, ang=30)


# ---------------------------------------------------------------- 半轴 / 车轮
def halfshaft(tag, x0, x1, sgn):
    bm = bmesh.new()
    prof = [(0, x0), (22, x0), (34, x0 + sgn * 18), (34, x0 + sgn * 52), (22, x0 + sgn * 70),
            (17, x0 + sgn * 80), (15, x0 + sgn * 92), (15, x1 - sgn * 92), (17, x1 - sgn * 80),
            (26, x1 - sgn * 70), (40, x1 - sgn * 40), (40, x1 - sgn * 10), (0, x1)]
    if sgn < 0:
        prof = prof[::-1]
        prof = [(r, x) for r, x in prof]
    revolve(bm, prof, 0, seg=36)
    return bm


def build_wheels(M):
    gl = grp('halfshaft', '半轴', 'Half shafts', '把减速后的扭矩送到车轮。两端是等速万向节，允许悬架上下跳动。', (0, 0, 0, 0))
    for tag, x0, x1, sgn, ex in (('L', -640, 0, 1, -300), ('R', 110, 660, 1, 300)):
        key = grp(f'halfshaft_{tag}', '半轴', 'Half shaft', '把减速后的扭矩送到车轮。两端是等速万向节，允许悬架上下跳动。', (ex, 0, 0, .10))
        add(f'HS_{tag}', halfshaft(tag, x0, x1, sgn), [M['steel']], key, spin='w', ang=30)
    for tag, sx in (('L', -1), ('R', 1)):
        key = grp(f'wheel_{tag}', '车轮与制动盘', 'Wheel & brake',
                  '扭矩最后在这里变成推力：F = T / r。制动盘只在回收不够用时才出力。', (sx * 480, 0, 0, .04))
        xc = sx * X_WHEEL

        def X(v):
            return xc + sx * v
        # 外侧朝 ±X
        bm = bmesh.new()
        w = 117
        tp = [(208, X(-w + 14)), (240, X(-w + 2)), (300, X(-w)), (322, X(-w + 12)), (333, X(-w + 30)), (335, X(-w + 34))]
        for g_c in (-66, -22, 22, 66):
            tp += [(335, X(g_c - 8)), (328, X(g_c - 6)), (328, X(g_c + 6)), (335, X(g_c + 8))]
        tp += [(335, X(w - 34)), (333, X(w - 30)), (322, X(w - 12)), (300, X(w)), (240, X(w - 2)), (208, X(w - 14))]
        revolve(bm, tp, 0, seg=96)
        add(f'Tyre_{tag}', bm, [M['tyre']], key, spin='w', ang=38)
        bm = bmesh.new()
        rp = [(212, X(-w + 2)), (222, X(-w + 2)), (222, X(-w + 16)), (196, X(-w + 24)), (190, X(-30)), (196, X(w - 24)),
              (222, X(w - 16)), (222, X(w - 2)), (212, X(w - 2)), (186, X(w - 22)), (182, X(-30)), (186, X(-w + 26))]
        revolve(bm, rp, 0, seg=96)
        rx0, rx1 = X(46), X(66)
        for i in range(5):
            a = 2 * pi * i / 5
            ca, sa = cos(a), sin(a)
            pts = [(54, -19), (120, -13), (188, -17), (188, 17), (120, 13), (54, 19)]
            loop = []
            for u, v in pts:
                loop.append(pm(u, a))
                loop[-1] = (-(u * ca - v * sa), u * sa + v * ca)
            extrude(bm, [loop], min(rx0, rx1), max(rx0, rx1), 0, 'X')
        hub = [(0, X(70)), (52, X(70)), (66, X(62)), (66, X(44)), (56, X(30)), (0, X(30))]
        if sx < 0:
            hub = hub[::-1]
        revolve(bm, hub, 0, seg=48)
        add(f'Rim_{tag}', bm, [M['rim']], key, spin='w', ang=34)
        bm = bmesh.new()
        dp = [(62, X(-44)), (152, X(-44)), (152, X(-28)), (62, X(-28))]
        revolve(bm, dp if sx > 0 else dp[::-1], 0, seg=72)
        add(f'Disc_{tag}', bm, [M['disc']], key, spin='w', ang=30)
        bm = bmesh.new()
        th = radians(35)
        loop = [pm(r, a) for r, a in ((118, th - .55), (166, th - .62), (166, th + .62), (118, th + .55))]
        extrude(bm, [loop], min(X(-64), X(-8)), max(X(-64), X(-8)), 0, 'X')
        add(f'Caliper_{tag}', bm, [M['caliper']], key, ang=30)


# ---------------------------------------------------------------- 逆变器
INV = dict(x0=-300, x1=-14, y0=MY - 112, y1=MY + 112, z0=MZ + 136, z1=MZ + 232)


def build_inverter(M):
    I = INV
    g = grp('inv_base', '逆变器底座（水冷板）', 'Inverter base', '功率模块贴在水冷板上。逆变器效率 97%~99%，但 150 kW 下那 1%~3% 也是几千瓦的热。', (0, 0, 300, .20))
    bm = bmesh.new()
    box(bm, I['x0'], I['x1'], I['y0'], I['y1'], I['z0'], I['z0'] + 12, 0)
    w = 5
    for x0, x1, y0, y1 in ((I['x0'], I['x1'], I['y0'], I['y0'] + w), (I['x0'], I['x1'], I['y1'] - w, I['y1']),
                           (I['x0'], I['x0'] + w, I['y0'] + w, I['y1'] - w), (I['x1'] - w, I['x1'], I['y0'] + w, I['y1'] - w)):
        box(bm, x0, x1, y0, y1, I['z0'] + 12, I['z1'] - 6, 0)
    add('Inv_base', bm, [M['alu_dark']], g, ang=30)
    g = grp('inv_lid', '逆变器上盖', 'Inverter cover', '铝盖兼做电磁屏蔽。', (0, 0, 620, .08))
    bm = bmesh.new()
    box(bm, I['x0'], I['x1'], I['y0'], I['y1'], I['z1'] - 6, I['z1'], 0)
    # 加强筋
    for i in range(6):
        x = I['x0'] + 30 + i * 45
        box(bm, x - 3, x + 3, I['y0'] + 18, I['y1'] - 18, I['z1'], I['z1'] + 4, 0)
    add('Inv_lid', bm, [M['lid']], g, ang=30)

    g = grp('igbt', '功率模块（6 个开关，SiC / IGBT）', 'Power module',
            '三相半桥共 6 个开关，每相上下各一个。它们每秒通断上万次，用脉冲宽度拼出正弦电压。同一相的上下管绝不能同时导通。',
            (0, 0, 380, .16))
    xs = {'U': -240.0, 'V': -160.0, 'W': -80.0}
    z_top = I['z0'] + 12
    ym = MY - 36
    for ph, xc in xs.items():
        bm = bmesh.new()
        box(bm, xc - 33, xc + 33, ym - 48, ym + 48, z_top, z_top + 5, 0)
        box(bm, xc - 29, xc + 29, ym - 44, ym + 44, z_top + 5, z_top + 7, 1)
        add(f'Inv_mod_{ph}', bm, [M['black'], M['sw_base']], g, ang=30)
        for tag, dy in (('H', 21), ('L', -21)):
            bm = bmesh.new()
            for dx in (-14, 14):
                box(bm, xc + dx - 10, xc + dx + 10, ym + dy - 14, ym + dy + 14, z_top + 7, z_top + 10, 0)
            add(f'Inv_sw_{ph}{tag}', bm, [M['switch']], g, ang=30)
    g = grp('bus', '叠层母排与相线', 'Busbars', '正负母排上下叠在一起抵消寄生电感。开关越快，这里的电感引起的电压尖峰越要命。', (0, 0, 440, .14))
    bm = bmesh.new()
    for ph, xc in xs.items():                      # 上管进线 / 下管进线
        box(bm, xc - 24, xc + 24, ym + 44, ym + 66, z_top + 16, z_top + 18, 0)
    box(bm, -280, -44, ym + 66, ym + 80, z_top + 16, z_top + 18, 0)
    box(bm, -280, -44, ym + 66, ym + 80, z_top + 19.5, z_top + 21.5, 0)
    add('Inv_bus', bm, [M['busbar']], g, ang=30)
    g = grp('cs', '相电流传感器', 'Current sensors', '测三相电流，是电流环的反馈。没有它，控制器只知道想要多少扭矩，不知道实际给了多少。', (0, 0, 480, .12))
    for i, ph in enumerate('UVW'):
        xc = xs[ph]
        tx = -36.0 - i * 14
        bm = bmesh.new()
        path = [Vector((xc, ym - 44, z_top + 12)), Vector((xc, ym - 58, z_top + 12)), Vector((tx, ym - 58, z_top + 12)),
                Vector((tx, MY, z_top + 12)), Vector((tx, MY, MZ + 150))]
        for a, b in zip(path, path[1:]):
            d = b - a
            lo = Vector((min(a.x, b.x) - 4, min(a.y, b.y) - 4, min(a.z, b.z) - 1.2))
            hi = Vector((max(a.x, b.x) + 4, max(a.y, b.y) + 4, max(a.z, b.z) + 1.2))
            box(bm, lo.x, hi.x, lo.y, hi.y, lo.z, hi.z, 0)
        add(f'Inv_out_{ph}', bm, [M['busbar']], g, ang=30)
        bm = bmesh.new()
        prof = rrect(tx, 0, 11, 7, 3)
        hole = rrect(tx, 0, 6.5, 3, 1.2)
        extrude(bm, [prof, hole], MY - 7, MY + 7, 0, 'Y') if False else None
        pts = [(tx + u, z_top + 12 + v) for u, v in rrect(0, 0, 13, 9, 3)]
        hole = [(tx + u, z_top + 12 + v) for u, v in rrect(0, 0, 7, 3.4, 1.2)]
        prism(bm, [pts, hole], MY - 22, MY - 10, 0, lambda u, v, w: (u, w, v))
        add(f'Inv_cs_{ph}', bm, [M['black']], g, ang=30)
    g = grp('cap', '直流母线电容', 'DC-link capacitor', '开关一通一断，电流是一串脉冲。电容就近补足这些脉冲，让电池和高压线上只流平滑的直流。', (0, 180, 380, .16))
    bm = bmesh.new()
    box(bm, -282, -42, ym + 82, I['y1'] - 7, z_top, z_top + 58, 0)
    add('Inv_cap', bm, [M['film']], g, ang=30)
    g = grp('pcb', '驱动板 + 控制板', 'Gate driver & control board',
            '控制板的 MCU 每 100 μs 左右跑一遍 FOC：读电流和转角 → 算电压 → 改 PWM。驱动板把弱电信号隔离放大去开关功率管。', (0, 0, 530, .12))
    bm = bmesh.new()
    box(bm, -288, -26, I['y0'] + 9, ym + 60, z_top + 34, z_top + 36, 0)
    bm_ch = 1
    for (x, y, sx, sy) in ((-230, ym + 10, 18, 18), (-180, ym - 20, 10, 10), (-120, ym + 20, 10, 10), (-90, ym - 40, 14, 8),
                           (-260, ym - 40, 14, 8), (-160, ym + 30, 14, 8), (-60, ym + 10, 10, 14)):
        box(bm, x - sx / 2, x + sx / 2, y - sy / 2, y + sy / 2, z_top + 36, z_top + 38.5, bm_ch)
    add('Inv_pcb', bm, [M['pcb'], M['chip']], g, ang=30)


# ---------------------------------------------------------------- 电池 + 高压线
BAT = dict(x0=-640, x1=640, y0=470, y1=1320, z0=-205, z1=-70)


def build_battery(M):
    B = BAT
    g = grp('batt_tray', '动力电池包', 'Battery pack', '给逆变器提供 400 V 直流。能放多大功率不只看电机，也看电池：冷、电量低、快满时都会限功率。', (0, 560, -40, .02))
    bm = bmesh.new()
    box(bm, B['x0'], B['x1'], B['y0'], B['y1'], B['z0'], B['z0'] + 8, 0)
    for x0, x1, y0, y1 in ((B['x0'], B['x1'], B['y0'], B['y0'] + 8), (B['x0'], B['x1'], B['y1'] - 8, B['y1']),
                           (B['x0'], B['x0'] + 8, B['y0'], B['y1']), (B['x1'] - 8, B['x1'], B['y0'], B['y1'])):
        box(bm, x0, x1, y0, y1, B['z0'] + 8, B['z1'], 0)
    add('Batt_tray', bm, [M['batt']], g, ang=30)
    key = grp('batt_mod', '电芯模组', 'Battery modules', '几百节电芯串并联成约 400 V。踩下踏板时这里放电，松开踏板回收时这里充电。', (0, 560, 50, .02))
    bm = bmesh.new()
    nx, ny = 6, 3
    for i in range(nx):
        for j in range(ny):
            x0 = B['x0'] + 26 + i * 202
            y0 = B['y0'] + 26 + j * 266
            box(bm, x0, x0 + 186, y0, y0 + 250, B['z0'] + 12, B['z1'] - 16, 0)
            box(bm, x0 + 8, x0 + 28, y0 + 10, y0 + 240, B['z1'] - 16, B['z1'] - 13, 1)
            box(bm, x0 + 158, x0 + 178, y0 + 10, y0 + 240, B['z1'] - 16, B['z1'] - 13, 1)
    add('Batt_mod', bm, [M['cell'], M['busbar']], key, ang=30)
    key = grp('batt_lid', '电池包上盖', 'Battery lid', '密封防水，隔开高压。', (0, 560, 190, .01))
    bm = bmesh.new()
    box(bm, B['x0'] - 6, B['x1'] + 6, B['y0'] - 6, B['y1'] + 6, B['z1'], B['z1'] + 4, 0)
    add('Batt_lid', bm, [M['batt']], key, ang=30)
    key = grp('hv', '高压直流线', 'HV cable', '橙色是高压线的统一颜色。', (0, 0, 0, 0))
    y1 = INV['y1']
    z = INV['z0'] + 44
    path_ret = []
    for tag, x in (('P', -150.0), ('N', -190.0)):
        ctrl = [Vector((x, 560, BAT['z1'] + 4)), Vector((x, 560, -20)), Vector((x, 520, 90)), Vector((x, 440, 200)),
                Vector((x, y1 + 40, z)), Vector((x, y1, z))]
        path = catmull(ctrl, 8)
        bm = bmesh.new()
        sweep_round(bm, path, 11, 0, sides=10)
        c = circle(x, z, 19, 20)
        prism(bm, [c], y1 - 4, y1 + 32, 1, lambda u, v, w: (u, w, v))
        add(f'HV_{tag}', bm, [M['hv'], M['black']], key, ang=40)
        if tag == 'P':
            path_ret = path
    return path_ret


# ---------------------------------------------------------------- 动画 / 导出
def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def animate():
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, FRAMES + 1
    for ob, g in OBJS:
        ex = EX.get(g, (0, 0, 0, 0))
        base = ob.location.copy()
        if not any(ex[:3]):
            continue
        d = Vector(ex[:3]) * MM
        for f in range(1, FRAMES + 2, 6):
            t = (f - 1) / FRAMES
            s = ease((t - ex[3]) / (1 - ex[3]))
            ob.location = base + d * s
            ob.keyframe_insert('location', frame=f)
        ob.location = base
    # 拆开时高压线先收起来，不然它会悬在半空
    for ob, g in OBJS:
        if g == 'hv':
            for attr in ('hide_viewport', 'hide_render'):
                setattr(ob, attr, False)
                ob.keyframe_insert(attr, frame=1)
                setattr(ob, attr, True)
                ob.keyframe_insert(attr, frame=6)
                setattr(ob, attr, False)


def setup_render():
    sc = bpy.context.scene
    w = bpy.data.worlds.new('World')
    w.use_nodes = True
    sc.world = w
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (*hexcol('#16233a'), 1)
    bg.inputs['Strength'].default_value = 1.0
    nt.links.new(bg.outputs[0], out.inputs[0])

    def light(name, loc_, energy, size):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.energy = energy
        ld.size = size
        ob = bpy.data.objects.new(name, ld)
        collection('Studio').objects.link(ob)
        ob.location = loc_
        d = Vector((0, .2, 0)) - Vector(loc_)
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

    light('Key', (-1.4, -1.6, 2.2), 520, 2.0)
    light('Rim', (1.8, 1.8, 1.2), 300, 2.0)
    light('Fill', (-2.6, .6, .8), 160, 2.0)
    cam_d = bpy.data.cameras.new('Camera')
    cam_d.lens = 55
    cam_d.clip_start = .01
    cam = bpy.data.objects.new('Camera', cam_d)
    collection('Studio').objects.link(cam)
    sc.camera = cam
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = ARGS.samples
    try:
        sc.cycles.use_denoising = True
    except Exception:
        pass
    items = [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items]
    sc.view_settings.view_transform = 'AgX' if 'AgX' in items else 'Filmic'
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 84
    return cam


def aim(cam, pos, tgt):
    cam.location = Vector(pos)
    cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()


def render(cam, name, frame, pos, tgt, hide=()):
    sc = bpy.context.scene
    sc.frame_set(frame)
    sc.render.resolution_x, sc.render.resolution_y = 1400, 880
    aim(cam, pos, tgt)
    for ob, _ in OBJS:
        ob.hide_render = any(ob.name.startswith(h) for h in hide)
    sc.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    print('[OK] rendered', name)
    for ob, _ in OBJS:
        ob.hide_render = False


def export_glb(path):
    bpy.context.scene.frame_set(1)
    for ob in bpy.context.scene.objects:
        ob.hide_viewport = False
        ob.hide_set(False)
        ob.select_set(ob.type == 'MESH')
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_extras=True,
              export_yup=True, export_animations=False, export_cameras=False, export_lights=False)
    bpy.ops.export_scene.gltf(**kw)
    print('[OK] exported', path, os.path.getsize(path) // 1024, 'KB')


def main():
    reset()
    M = make_materials()
    build_stator(M)
    build_windings(M)
    build_rotor(M)
    build_bearings_resolver(M)
    build_case(M)
    build_reducer(M)
    build_wheels(M)
    build_inverter(M)
    cable = build_battery(M)
    tris = 0
    for o, _ in OBJS:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    spec = dict(
        pole_pairs=P_POLE, slots=NS, ratio=RATIO, teeth=[Z1, Z2, Z3, Z4], wheel_radius=R_WHEEL * MM,
        motor_axis=[MY, MZ], int_axis=list(INT), x_stack=[X_L, X_R], r=dict(so=R_SO, si=R_SI, ro=R_RO),
        inverter=INV, battery=BAT, groups=GROUPS, explode={k: list(v) for k, v in EX.items()},
        cable=[list(v) for v in cable], objects={o.name: g for o, g in OBJS}, tris=tris,
    )
    with open(os.path.join(OUT, 'spec.json'), 'w', encoding='utf-8') as f:
        json.dump(spec, f, ensure_ascii=False, indent=1)
    cam = setup_render()
    glb = os.path.join(OUT, 'ev_drive.glb')
    export_glb(glb)
    animate()
    aim(cam, (-1.7, -2.2, 1.5), (0, .2, 0))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'ev_drive.blend'), compress=True)
    print('[OK] saved ev_drive.blend')
    if ARGS.render:
        render(cam, 'view_assembled.jpg', 1, (-2.0, -2.9, 1.75), (.02, .26, -.08))
        render(cam, 'view_exploded.jpg', FRAMES + 1, (-3.0, -4.5, 2.5), (-.05, .42, .22))
    print(f'[OK] {len(OBJS)} objects, {tris} triangles, ratio {RATIO:.3f}')


main()
