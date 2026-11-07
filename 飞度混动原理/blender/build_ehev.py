#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
飞度 e:HEV 混动 · Blender 纯脚本建模（教学示意，不是本田的设计图）

讲的是本田两电机混动（e:HEV / i-MMD）的结构：发动机、发电机、驱动电机、一个直连离合器、
固定齿比的齿轮、PCU、IPU（电池）。车身是普通紧凑两厢车的示意外形，不是飞度的外观。

运行方式（二选一）:
    blender -b -P build_ehev.py -- --out out [--render]
    python  build_ehev.py --out out [--render]      # 需要 pip install bpy

输出:
    ehev.blend   Blender 工程；按空格播放 = 爆炸动画（第 1 帧装配，第 121 帧拆开）
    ehev.glb     给网页用（零件独立命名，extras 里带分组和转动关系）
    spec.json    参数、轴位置、齿数、能量流路径、零件说明（网页读这一份）
    view_*.jpg   只有加 --render 时才渲染（Cycles）

坐标约定:
    尺寸按毫米写，建完缩放成米。+X 车右，+Y 车头，+Z 朝上。原点在前轴正下方的地面。
    所有轴都平行于 X 轴（发动机横置）。截面角 ϑ 的位置 (y, z) = (-r·cos ϑ, r·sin ϑ)，
    网页里转动件统一写 node.rotation.x = -角度，角度增大时车轮向前滚。

公开数据（本田官方诸元表，2022 年 10 月小改款后）:
    发动机 LEB 1.5 L 阿特金森，78 kW / 127 N·m；驱动电机 H5，90 kW / 253 N·m；
    变速比：电机行驶 2.454、发动机行驶 0.805；减速比 3.423；锂离子电池 48 个单体。
    齿数是按这几个比值凑的（54/22 = 2.4545，54/67 = 0.806，65/19 = 3.421），
    轴的相对位置、尺寸、发电机齿比 2.0 都是示意，不是实测。
"""
import argparse
import json
import math
import os
import sys
from bisect import bisect_right
from math import atan2, cos, pi, radians, sin, sqrt, tan, asin

import bpy  # 必须排在 bmesh 前面：pip 版 bpy 导入后才注册 bmesh / mathutils
import bmesh
from mathutils import Matrix, Vector
from mathutils.geometry import delaunay_2d_cdt

HERE = os.path.dirname(os.path.abspath(__file__))
_argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
_ap = argparse.ArgumentParser()
_ap.add_argument('--out', default=os.path.join(HERE, 'out'))
_ap.add_argument('--render', action='store_true')
_ap.add_argument('--samples', type=int, default=40)
_ap.add_argument('--res', type=int, default=1400)
ARGS, _ = _ap.parse_known_args(_argv)
OUT = os.path.abspath(ARGS.out)
os.makedirs(OUT, exist_ok=True)

MM = 0.001
FRAMES = 120

# ---------------------------------------------------------------- 参数表 (mm)
Z_AX = 301.0                    # 轮心高度 = 185/60R15 轮胎半径
R_TYRE, W_TYRE, R_RIM = 301.0, 185.0, 190.0
TRACK_F, TRACK_R = 742.5, 737.5  # 轮距 1485 / 1475 的一半
WB = 2530.0                     # 轴距
R_ARCH = 345.0

# 齿数（按官方变速比凑）
ZM, ZCD, ZED = 22, 54, 67       # 电机小齿轮 / 中间轴大齿轮 / 发动机直驱齿轮
ZF, ZR = 19, 65                 # 主减速小齿轮 / 差速器齿圈
ZIG, ZGP = 60, 30               # 输入轴上的发电机驱动齿轮 / 发电机小齿轮（示意 2.0）
MOD1, MODF, MODG = 2.0, 2.5, 2.0
RATIO_M = ZR / ZF * ZCD / ZM    # 电机 → 车轮 8.40
RATIO_E = ZR / ZF * ZCD / ZED   # 发动机 → 车轮 2.757
RATIO_G = ZIG / ZGP             # 发电机 / 发动机 2.0
HELIX = radians(16)

X_P1 = -150.0                   # 电机小齿轮 / 中间轴大齿轮 / 直驱齿轮所在平面
X_FD = -95.0                    # 主减速平面
X_GG = -40.0                    # 发电机齿轮平面


def _dir(a_deg):
    a = radians(a_deg)
    return (cos(a), sin(a))


def _off(p, d, a):
    u = _dir(a)
    return (p[0] + d * u[0], p[1] + d * u[1])


AX_D = (0.0, Z_AX)
AX_C = _off(AX_D, MODF * (ZR + ZF) / 2, 60)
AX_I = _off(AX_C, MOD1 * (ZCD + ZED) / 2, 20)
AX_M = _off(AX_C, MOD1 * (ZCD + ZM) / 2, 150)
AX_G = _off(AX_I, MODG * (ZIG + ZGP) / 2, 70)
AXES = dict(I=AX_I, G=AX_G, M=AX_M, C=AX_C, D=AX_D)

# 发动机：LEB 缸径 73.0 × 行程 89.4
BORE, STROKE = 73.0, 89.4
CR = STROKE / 2                 # 曲柄半径
ROD = 140.0                     # 连杆中心距（示意）
PIN_H = 28.0                    # 活塞销到顶面
CYL_X = [103.5, 184.5, 265.5, 346.5]
CYL_PH = [0.0, pi, pi, 0.0]     # 1、4 缸同相，2、3 缸差 180°
FIRING = [1, 3, 4, 2]
CY, CZ = AX_I                   # 曲轴中心
DECK = CZ + CR + ROD + PIN_H + 1.0
Z_BORE0 = CZ + 64              # 缸筒段下沿：高于曲柄和平衡块扫过的范围

# 电机 / 发电机
MOT = dict(ro=115.0, ri=74.0, rr=72.0, x0=-330.0, x1=-230.0, slots=48, depth=24.0, poles=8)
GEN = dict(ro=100.0, ri=64.0, rr=62.0, x0=-320.0, x1=-245.0, slots=36, depth=21.0, poles=8)

# 车身外廓
Y_NOSE, Y_TAIL = 795.0, -3200.0

# 其他总成位置
TANK = dict(x0=-430, x1=430, y0=-1350, y1=-830, z0=150, z1=240)
IPU = dict(x0=-420, x1=420, y0=-3010, y1=-2660, z0=172, z1=330)
PCU = dict(x0=-390, x1=-70, y0=-90, y1=290, z0=646, z1=760)
PCU_C = [-230.0, 100.0, (PCU['z0'] + PCU['z1']) / 2]
Y_CAT = CY - 175                # 三元催化器（缸盖后方）
FLOOR_Z = 262.0                 # 乘员舱地板（下面走油箱、排气、高压线）
FIREWALL = (-260.0, -180.0)
# 管路走向：油管走右侧、排气管绕过油箱右边、高压线走左侧（都避开中置油箱）
FUEL_PATH = [(120, TANK['y1'] - 20, 232), (120, -500, 206), (120, 200, 206), (120, CY + 160, 270), (120, CY + 170, DECK - 40),
             (120, CY + 134, DECK + 50)]
EXH_PATH = [(225, CY - 112, DECK + 40), (225, Y_CAT, DECK - 10), (225, Y_CAT, DECK - 190), (225, Y_CAT - 30, DECK - 240),
            (225, -70, 250), (330, -420, 196), (480, -820, 192), (480, -1450, 192), (400, -2010, 200),
            (400, -2300, 205), (470, -2420, 205), (480, -2600, 205), (480, -3000, 210), (480, -3225, 220)]
HV_PATH = [(-200, IPU['y1'] + 10, 262), (-220, IPU['y1'] + 60, 232), (-560, -2350, 230), (-560, -1500, 228), (-560, -600, 228),
           (-260, -330, 232), (-200, -160, 250), (-200, -160, 420), (-200, -158, 600), (-180, -60, PCU['z0'] - 10)]


def pm(r, th):
    """截面角 ϑ → (y, z)，以轴为原点"""
    return (-r * cos(th), r * sin(th))


def th_of(dy, dz):
    return atan2(dz, -dy)


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


def principled(name, hexc, metal=0.0, rough=0.5, coat=0.0, alpha=None, emit=None, trans=0.0):
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
    if trans > 0:
        put(['Transmission Weight', 'Transmission'], trans)
        put(['IOR'], 1.45)
    if alpha is not None:
        put(['Alpha'], alpha)
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    m.diffuse_color = (*col, 1.0)
    m.metallic = metal
    m.roughness = rough
    return m


def make_materials():
    return dict(
        paint=principled('M_Paint', '#c8d3de', .55, .28, coat=1.0),
        glass=principled('M_Glass', '#1d2a36', 0, .05, alpha=.42),
        trim=principled('M_Trim_Black', '#17191c', 0, .5),
        lamp=principled('M_Lamp', '#e9eef4', 0, .1, emit=('#fff6e0', .4)),
        tail=principled('M_Tail_Lamp', '#b3131b', 0, .2, emit=('#ff2a2a', .25)),
        alu=principled('M_Cast_Alu', '#b9bfc7', .85, .45),
        alu_dark=principled('M_Cast_Alu_Dark', '#757d88', .8, .5),
        block=principled('M_Engine_Block', '#9aa1aa', .8, .5),
        head=principled('M_Cyl_Head', '#aeb4bc', .85, .42),
        cover=principled('M_Cam_Cover', '#2a2e34', .2, .45),
        steel=principled('M_Shaft_Steel', '#c9cdd2', 1, .22),
        forged=principled('M_Forged_Steel', '#8d939b', 1, .35),
        gear=principled('M_Gear_Steel', '#a9b0b9', 1, .28),
        piston=principled('M_Piston', '#d3d7dc', .9, .3),
        burn=principled('M_Combustion', '#3a1a08', 0, .5, emit=('#ff8a2a', 0.0)),
        copper=principled('M_Copper', '#c8743a', 1, .3),
        lam=principled('M_Lamination', '#8e98a5', .8, .4),
        mag_n=principled('M_Magnet_N', '#d8383f', .35, .34),
        mag_s=principled('M_Magnet_S', '#2f6fdf', .35, .34),
        clutch_f=principled('M_Clutch_Friction', '#8a5a34', .1, .7),
        clutch_s=principled('M_Clutch_Steel', '#c5ccd4', 1, .25),
        hv=principled('M_HV_Orange', '#f07a12', 0, .4),
        pcu=principled('M_PCU', '#9aa3ae', .8, .4),
        batt=principled('M_Batt_Case', '#39424e', .55, .5),
        cell=principled('M_Cell', '#5b6675', .6, .4),
        busbar=principled('M_Busbar', '#d48a52', 1, .28),
        black=principled('M_Plastic_Black', '#22262b', 0, .55),
        tank=principled('M_Fuel_Tank', '#2b2f35', 0, .6),
        fuel=principled('M_Fuel_Line', '#d64545', .2, .4),
        exhaust=principled('M_Exhaust', '#8d8378', .9, .45),
        cat=principled('M_Catalyst', '#b7b1a6', .9, .35),
        rad=principled('M_Radiator', '#3f4650', .6, .5),
        tyre=principled('M_Tyre', '#1c1e21', 0, .86),
        rim=principled('M_Rim', '#c7ccd3', 1, .3),
        disc=principled('M_Brake_Disc', '#8b9099', 1, .38),
        caliper=principled('M_Caliper', '#3c4048', .3, .45),
        rubber=principled('M_Rubber', '#16181b', 0, .78),
        seat=principled('M_Seat', '#3b3f46', 0, .85),
        interior=principled('M_Interior', '#2a2d32', 0, .7),
        floor=principled('M_Floor', '#4a5059', .5, .55),
        batt12=principled('M_Batt12', '#1f2937', 0, .5),
    )


# ---------------------------------------------------------------- 几何工具（单位 mm）
def tri2d(loops):
    """带孔多边形三角化（约束 Delaunay + 奇偶规则留内部三角形）"""
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


def tube(bm, r0, r1, x0, x1, mi, seg=48):
    """空心圆筒（内外径），沿 X"""
    return revolve(bm, [(r0, x0), (r1, x0), (r1, x1), (r0, x1)], mi, seg)


def rod_x(bm, r, x0, x1, mi, seg=24):
    return revolve(bm, [(0, x0), (r, x0), (r, x1), (0, x1)], mi, seg)


def revolve_sector(bm, loops, a0, a1, seg, mi):
    """(r, x) 平面的多边形绕 X 轴转过 a0..a1，两端封口"""
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


def rbox(bm, c, s, r=8, mi=0, seg=2):
    """圆角盒。c 中心，s 全尺寸"""
    g = bmesh.ops.create_cube(bm, size=1)
    vs = g['verts']
    bmesh.ops.scale(bm, vec=Vector(s), verts=vs)
    es = list({e for v in vs for e in v.link_edges})
    if r > 0:
        res = bmesh.ops.bevel(bm, geom=vs + es, offset=r, segments=seg, profile=.5, affect='EDGES', clamp_overlap=True)
        fs = res['faces']
        vs2 = list({v for f in fs for v in f.verts})
        allf = list({f for v in vs2 for f in v.link_faces})
        vs = list({v for f in allf for v in f.verts})
    else:
        allf = list({f for v in vs for f in v.link_faces})
    for f in allf:
        f.material_index = mi
        f.smooth = True
    bmesh.ops.translate(bm, vec=Vector(c), verts=vs)
    return vs


def cyl(bm, p0, p1, r0, r1=None, mi=0, seg=16, smooth=True):
    p0, p1 = Vector(p0), Vector(p1)
    r1 = r0 if r1 is None else r1
    d = p1 - p0
    L = d.length
    g = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=L)
    vs = g['verts']
    q = d.to_track_quat('Z', 'Y')
    bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, vec=(p0 + p1) / 2, verts=vs)
    for f in {f for v in vs for f in v.link_faces}:
        f.material_index = mi
        f.smooth = smooth
    return vs


def ball(bm, c, r, mi=0, seg=12, sc=(1, 1, 1)):
    g = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=r)
    vs = g['verts']
    bmesh.ops.scale(bm, vec=Vector(sc), verts=vs)
    bmesh.ops.translate(bm, vec=Vector(c), verts=vs)
    for f in {f for v in vs for f in v.link_faces}:
        f.material_index = mi
        f.smooth = True
    return vs


def lathe_z(bm, prof, c, seg=40, mi=0):
    """绕竖直轴回转。prof = [(r, dz), ...]，首尾 r=0 自动收口"""
    rings = []
    for (r, a) in prof:
        if r < 1e-6:
            rings.append([bm.verts.new((c[0], c[1], c[2] + a))])
        else:
            rings.append([bm.verts.new((c[0] + r * cos(2 * pi * k / seg), c[1] + r * sin(2 * pi * k / seg), c[2] + a)) for k in range(seg)])
    fs = []
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for i in range(seg):
                fs.append(bm.faces.new((a[0], b[(i + 1) % seg], b[i])))
        elif len(b) == 1:
            for i in range(seg):
                fs.append(bm.faces.new((a[i], a[(i + 1) % seg], b[0])))
        else:
            for i in range(seg):
                fs.append(bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i])))
    for f in fs:
        f.material_index = mi
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


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
    Bn = [T[i].cross(N[i]) for i in range(n)]
    rings = [[bm.verts.new(path[i] + radius * (cos(2 * pi * k / sides) * N[i] + sin(2 * pi * k / sides) * Bn[i]))
              for k in range(sides)] for i in range(n)]
    fs = []
    for i in range(n - 1):
        fs += _bridge(bm, rings[i], rings[i + 1])
    fs.append(bm.faces.new(rings[0][::-1]))
    fs.append(bm.faces.new(rings[-1]))
    for f in fs:
        f.material_index = mi
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def catmull(ctrl, per=8):
    ctrl = [Vector(c) for c in ctrl]
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


def pipe(bm, ctrl, r, mi, sides=12, per=8):
    return sweep_round(bm, catmull(ctrl, per), r, mi, sides)


def shade(me, ang):
    try:
        me.shade_smooth()
    except AttributeError:
        for p in me.polygons:
            p.use_smooth = True
    if hasattr(me, 'set_sharp_from_angle'):
        me.set_sharp_from_angle(angle=radians(ang))


def hull(points):
    pts = sorted(set((round(p[0], 4), round(p[1], 4)) for p in points))
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


def gear_bm(z, m, width, xc, phase, helix_sign, bore, holes=0, hole_r=0, hole_c=0, layers=4, bm=None, mi=0):
    """斜齿轮，轴线 = X，中心在 (xc, 0, 0)。第 0 个齿中心在截面角 phase"""
    bm = bm or bmesh.new()
    rp, ra, rf = m * z / 2, m * z / 2 + m, m * z / 2 - 1.25 * m
    p = 2 * pi / z
    prof = []
    for k in range(z):
        a = k * p
        prof += [(rf, a - .5 * p), (rf, a - .30 * p), (rp, a - .25 * p), (ra, a - .13 * p), (ra, a + .13 * p),
                 (rp, a + .25 * p), (rf, a + .30 * p)]
    twist = width * tan(HELIX) / rp * helix_sign

    def ring(pts, dth):
        return [Vector((0, *pm(r, a + phase + dth))) for r, a in pts]
    rings = []
    for li in range(layers + 1):
        t = li / layers
        x = xc - width / 2 + width * t
        dth = twist * (t - .5)
        rings.append([bm.verts.new(Vector((x, 0, 0)) + v) for v in ring(prof, dth)])
    fs = []
    for li in range(layers):
        fs += _bridge(bm, rings[li], rings[li + 1])
    loops2d = [[pm(r, a + phase) for r, a in prof]]
    hole_xy = []
    if bore:
        hole_xy.append([pm(bore, 2 * pi * k / 40) for k in range(40)])
    for i in range(holes):
        c = 2 * pi * (i + .5) / holes + phase
        cy, cz = pm(hole_c, c)
        hole_xy.append(circle(cy, cz, hole_r, 20))
    tris = tri2d(loops2d + hole_xy)
    h0 = None
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
        if end == 0:
            h0 = hv
        else:
            for A, C in zip(h0, hv):
                fs += _bridge(bm, A, C)
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    for f in fs:
        f.material_index = mi
    return bm


# ---------------------------------------------------------------- 零件登记
OBJS = []       # (object, 分组)
GROUPS = {}     # 分组 → 中文名、说明
EX = {}         # 分组 → 爆炸位移 (dx, dy, dz, 出场时刻)


def grp(key, cn, en, desc, ex=None):
    GROUPS[key] = dict(cn=cn, en=en, desc=desc)
    EX[key] = ex or (0, 0, 0, 0)
    return key


def add(name, bm, mats, group, loc=(0, 0, 0), spin='', ang=34, coll='Car', extras=None):
    """bmesh → 物体。loc 单位 mm（转动件的原点放在转轴上）"""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
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
    for k, v in (extras or {}).items():
        ob[k] = v
    OBJS.append((ob, group))
    return ob


def at_axis(ax):
    """轴 (y, z) → 物体原点"""
    return (0.0, AXES[ax][0], AXES[ax][1])


# ---------------------------------------------------------------- 齿轮相位
def mesh_phase(ax_a, za, phase_a, ax_b, zb):
    """已知 A 齿轮相位，求和它啮合的 B 齿轮相位（A 的齿对准 B 的齿槽）"""
    ya, za_ = AXES[ax_a]
    yb, zb_ = AXES[ax_b]
    th_ab = th_of(yb - ya, zb_ - za_)
    th_ba = th_of(ya - yb, za_ - zb_)
    pa, pb = 2 * pi / za, 2 * pi / zb
    d = (th_ab - phase_a) % pa
    return th_ba - pb / 2 + d * za / zb


PH = {}
PH['ring'] = 0.0
PH['final'] = mesh_phase('D', ZR, PH['ring'], 'C', ZF)
PH['cd'] = 0.0
PH['mot'] = mesh_phase('C', ZCD, PH['cd'], 'M', ZM)
PH['ed'] = mesh_phase('C', ZCD, PH['cd'], 'I', ZED)
PH['ig'] = 0.0
PH['gp'] = mesh_phase('I', ZIG, PH['ig'], 'G', ZGP)


# ---------------------------------------------------------------- 发动机
def block_half(front):
    """缸体半块：在曲轴中心线所在的竖直面（y = CY）切开，好看见活塞。
    缸筒段从曲轴扫过的范围之上开始；下面的曲轴箱只做四周的墙，曲柄和平衡块转起来不会穿模。"""
    y0, y1 = (CY, CY + 112) if front else (CY - 112, CY)
    xa, xb = 52.0, 398.0
    r = BORE / 2 + .6
    pts = []
    ys = CY
    if front:
        pts.append((xa, ys))
        for xc in CYL_X:
            for k in range(17):
                a = pi - pi * k / 16
                pts.append((xc + r * cos(a), ys + r * sin(a)))
        pts += [(xb, ys), (xb, y1), (xa, y1)]
    else:
        pts.append((xb, ys))
        for xc in reversed(CYL_X):
            for k in range(17):
                a = -pi * k / 16
                pts.append((xc + r * cos(a), ys + r * sin(a)))
        pts += [(xa, ys), (xa, y0), (xb, y0)]
    bm = bmesh.new()
    extrude(bm, [pts], Z_BORE0, DECK, 0, 'Z')
    yA, yB = (CY + 80, CY + 112) if front else (CY - 112, CY - 80)
    box(bm, xa, xb, yA, yB, CZ - 100, Z_BORE0, 0)
    yA, yB = (CY, CY + 80) if front else (CY - 80, CY)
    box(bm, xa, xa + 12, yA, yB, CZ - 100, Z_BORE0, 0)
    box(bm, xb - 12, xb, yA, yB, CZ - 100, Z_BORE0, 0)
    return bm


def build_engine(M):
    g = grp('eng_block', '发动机缸体', 'Engine block (LEB 1.5 L)',
            '1.5 L 直列四缸，阿特金森循环（进气门晚关，膨胀比大于压缩比）。在 e:HEV 里它大部分时间只负责发电，只有高速巡航时才通过离合器直接推车。',
            (380, 0, 120, .30))
    add('Eng_block_f', block_half(True), [M['block']], g, ang=30)
    add('Eng_block_r', block_half(False), [M['block']], g, ang=30)
    bm = bmesh.new()
    rbox(bm, (225, CY, CZ - 160), (330, 196, 116), 18, 0, 2)
    add('Eng_oilpan', bm, [M['alu_dark']], g, ang=30)
    bm = bmesh.new()
    rbox(bm, (412, CY + 10, CZ + 150), (26, 230, 430), 10, 0, 2)
    add('Eng_chain_cover', bm, [M['alu_dark']], g, ang=30)

    g = grp('eng_head', '缸盖和气门室盖', 'Cylinder head',
            '每缸 4 个气门（进 2 排 2），双顶置凸轮轴，链条驱动。进气门晚关就是阿特金森循环的做法：压缩行程开头把一部分空气推回去，换来更大的膨胀比。',
            (380, 0, 300, .22))
    bm = bmesh.new()
    rbox(bm, (225, CY, DECK + 55), (350, 228, 110), 8, 0, 1)
    add('Eng_head', bm, [M['head']], g, ang=30)
    bm = bmesh.new()
    rbox(bm, (225, CY - 6, DECK + 135), (330, 196, 52), 20, 0, 3)
    for xc in CYL_X:
        cyl(bm, (xc, CY - 6, DECK + 150), (xc, CY - 6, DECK + 168), 15, 13, 1, seg=16)
    add('Eng_camcover', bm, [M['cover'], M['black']], g, ang=30)

    g = grp('intake', '进气歧管', 'Intake manifold', '空气经节气门进稳压腔，再分到四个进气道。喷油器装在进气道上（进气道喷射 PFI）。', (380, 260, 240, .18))
    bm = bmesh.new()
    rbox(bm, (225, CY + 230, DECK - 40), (290, 80, 120), 24, 0, 3)
    for xc in CYL_X:
        pipe(bm, [(xc, CY + 108, DECK + 70), (xc, CY + 160, DECK + 62), (xc, CY + 200, DECK + 20), (xc, CY + 212, DECK - 20)], 19, 0, sides=14)
    cyl(bm, (60, CY + 230, DECK - 40), (90, CY + 230, DECK - 40), 36, 36, 1, seg=24)
    add('Eng_intake', bm, [M['black'], M['alu']], g, ang=40)
    bm = bmesh.new()
    cyl(bm, (80, CY + 128, DECK + 56), (375, CY + 128, DECK + 56), 8, 8, 0, seg=10)
    for xc in CYL_X:
        cyl(bm, (xc, CY + 128, DECK + 56), (xc, CY + 112, DECK + 30), 6, 5, 1, seg=10)
    add('Eng_fuelrail', bm, [M['fuel'], M['black']], 'intake', ang=40)

    g = grp('exhaust', '排气系统（三元催化 + 消音器）', 'Exhaust',
            '燃烧后的废气从缸盖后侧出来，先进三元催化器（要几百度才起作用，所以冷车时发动机会为了暖催化器先运转一会），再经底盘下的管子和消音器排出。',
            (0, 0, -260, .12))
    bm = bmesh.new()
    pipe(bm, [(225, CY - 112, DECK + 40), (225, CY - 140, DECK + 30), (225, Y_CAT, DECK - 10)], 24, 0)
    cyl(bm, (225, Y_CAT, DECK - 10), (225, Y_CAT, DECK - 190), 56, 56, 1, seg=24)
    pipe(bm, EXH_PATH[2:9], 24, 0, per=10)
    rbox(bm, (355, -2150, 205), (230, 300, 100), 40, 1, 3)
    pipe(bm, EXH_PATH[9:], 22, 0, per=8)
    add('Exhaust', bm, [M['exhaust'], M['cat']], g, ang=40)

    # 曲轴（转动件，原点在曲轴中心）
    g = grp('crank', '曲轴、飞轮减振器', 'Crankshaft & flywheel damper',
            '活塞的上下运动在这里变成转动。曲轴另一端直接连着 e-CVT 的输入轴，中间只有一个减振的飞轮盘（没有起动机：发电机兼任起动机）。',
            (380, 0, -120, .40))
    bm = bmesh.new()
    xs = [60.0] + [(CYL_X[i] + CYL_X[i + 1]) / 2 for i in range(3)] + [392.0]
    for i in range(len(xs)):
        rod_x(bm, 25, xs[i] - 12, xs[i] + 12, 0, 24)
    for i, xc in enumerate(CYL_X):
        ph = CYL_PH[i]
        py, pz = (0.0, CR) if ph == 0 else (0.0, -CR)
        for side in (-1, 1):
            xw = xc + side * 21
            pts = circle(py, pz, 30, 16) + [pm(60, th_of(-py, -pz) + radians(t)) for t in range(-60, 61, 12)] + circle(0, 0, 30, 16)
            extrude(bm, [hull(pts)], xw - 7, xw + 7, 1, 'X')
        cyl(bm, (xc - 15, py, pz), (xc + 15, py, pz), 21, 21, 0, seg=20)
    rod_x(bm, 17, 20, 60, 0, 20)
    add('Crank', bm, [M['steel'], M['forged']], g, loc=at_axis('I'), spin='I', ang=30)
    bm = bmesh.new()
    revolve(bm, [(18, 8), (128, 8), (128, 18), (100, 22), (100, 30), (60, 34), (18, 34)], 0, 72)
    for k in range(8):
        a = 2 * pi * (k + .5) / 8
        y, z = pm(84, a)
        cyl(bm, (6, y, z), (36, y, z), 9, 9, 1, seg=10)
    add('Flywheel', bm, [M['steel'], M['rubber']], g, loc=at_axis('I'), spin='I', ang=30)

    g = grp('piston', '活塞和连杆', 'Pistons & connecting rods',
            '缸径 73.0 mm、行程 89.4 mm 的长行程设计，适合中低转速出扭矩、省油。点火顺序 1-3-4-2。发动机停着的时候它们一动不动，这正是 EV 模式省油的地方。',
            (380, 0, 420, .48))
    for i, xc in enumerate(CYL_X):
        ph = CYL_PH[i]
        zp = CZ + CR * cos(ph) + sqrt(ROD ** 2 - (CR * sin(ph)) ** 2)
        bm = bmesh.new()
        r = BORE / 2 - .4
        lathe_z(bm, [(0, PIN_H), (r - 3, PIN_H), (r, PIN_H - 3), (r, PIN_H - 18), (r - .8, PIN_H - 19), (r - .8, PIN_H - 22),
                     (r, PIN_H - 23), (r, -24), (r - 4, -26), (0, -26)], (0, 0, 0), 36, 0)
        rod_x(bm, 9.5, -27, 27, 1, 14)
        add(f'Piston_{i + 1}', bm, [M['piston'], M['steel']], g, loc=(xc, CY, zp), extras=dict(cyl=i + 1, ph=ph))
        bm = bmesh.new()
        loop = hull(circle(0, 0, 13, 16) + circle(0, -ROD, 30, 20))
        extrude(bm, [loop], -9, 9, 0, 'X')
        add(f'Rod_{i + 1}', bm, [M['forged']], g, loc=(xc, CY, zp), extras=dict(cyl=i + 1, ph=ph))
        bm = bmesh.new()
        lathe_z(bm, [(0, 0), (BORE / 2 - 1, 0), (BORE / 2 - 1, 3), (0, 3)], (0, 0, 0), 32, 0)
        add(f'Burn_{i + 1}', bm, [M['burn']], g, loc=(xc, CY, DECK), extras=dict(cyl=i + 1))

    g = grp('radiator', '散热器', 'Radiator', '发动机和电机、PCU 的冷却液都要在这里散热。电驱部分走另一条低温回路。', (0, 420, 0, .05))
    bm = bmesh.new()
    rbox(bm, (0, 640, 520), (640, 30, 400), 6, 0, 1)
    for k in range(13):
        z = 340 + k * 30
        box(bm, -318, 318, 626, 654, z - 1.5, z + 1.5, 1)
    add('Radiator', bm, [M['rad'], M['alu_dark']], g, ang=30)

    g = grp('batt12', '12 V 蓄电池', '12 V battery', '给灯、仪表、电脑供电的普通小电瓶。它由高压电池经 DC-DC 降压充电，所以混动车不需要传统的发电机皮带。', (-200, 300, 300, .06))
    bm = bmesh.new()
    rbox(bm, (-520, 340, 650), (170, 140, 175), 6, 0, 1)
    cyl(bm, (-570, 300, 737), (-570, 300, 752), 9, 9, 1, seg=10)
    cyl(bm, (-470, 300, 737), (-470, 300, 752), 9, 9, 1, seg=10)
    add('Batt12', bm, [M['batt12'], M['busbar']], g, ang=30)


# ---------------------------------------------------------------- 电机 / 发电机
def stator_sector(o, a0, a1):
    """定子叠片截面：外圆弧 + 内侧齿槽，a0..a1 扇形。切口落在齿中心，切面是实心的。"""
    ro, ri, ns, dp = o['ro'], o['ri'], o['slots'], o['depth']
    p = 2 * pi / ns
    sw = .42 * p
    inner = []
    for m in (0, 1):
        for k in range(ns):
            a = k * p + 2 * pi * m
            inner += [(ri, a - sw / 2), (ri + dp, a - sw / 2), (ri + dp, a + sw / 2), (ri, a + sw / 2)]
    sel = sorted([(r, a) for r, a in inner if a0 + 1e-4 < a < a1 - 1e-4], key=lambda t: t[1])
    nseg = max(6, int(48 * (a1 - a0) / (2 * pi)))
    loop = [pm(ro, a0 + (a1 - a0) * k / nseg) for k in range(nseg + 1)]
    loop.append(pm(ri, a1))
    loop += [pm(r, a) for r, a in reversed(sel)]
    loop.append(pm(ri, a0))
    return [loop]


def build_machine(M, key, tag, o, ax, x_pin, z_pin, pin_phase, shaft_r, shaft_x, helix, cn, en, desc, ex, desc_rot):
    g = grp(f'{key}_stator', cn + '定子', en + ' stator', desc, ex)
    hp = pi / o['slots']          # 半个齿距：切口放在齿中心
    for part, a0, a1 in (('', pi / 2 + hp, 2 * pi + hp), ('_q', hp, pi / 2 + hp)):
        bm = bmesh.new()
        loops = stator_sector(o, a0, a1)
        extrude(bm, loops, o['x0'], o['x1'], 0, 'X')
        # 端部绕组
        r0, r1 = o['ri'] + 2, o['ri'] + o['depth'] + 2
        for xe0, xe1 in ((o['x0'] - 20, o['x0']), (o['x1'], o['x1'] + 20)):
            prof = [(r0, xe0), (r1, xe0), (r1, xe1), (r0, xe1)]
            revolve_sector(bm, [prof], a0, a1, 24 if part else 72, 1)
        add(f'{tag}_stator{part}', bm, [M['lam'], M['copper']], g, loc=at_axis(ax), ang=30)
    g2 = grp(f'{key}_rotor', cn + '转子', en + ' rotor', desc_rot, (ex[0] * 1.6, ex[1] * 1.6, ex[2] * 1.6, ex[3] + .08))
    bm = bmesh.new()
    rr = o['rr']
    revolve(bm, [(shaft_r + 2, o['x0']), (rr - 6, o['x0']), (rr - 6, o['x1']), (shaft_r + 2, o['x1'])], 0, 64)
    npole = o['poles']
    for k in range(npole):
        a = 2 * pi * k / npole
        prof = [(rr - 6, o['x0'] + 1), (rr, o['x0'] + 1), (rr, o['x1'] - 1), (rr - 6, o['x1'] - 1)]
        revolve_sector(bm, [prof], a - .36 * 2 * pi / npole, a + .36 * 2 * pi / npole, 8, 1 if k % 2 == 0 else 2)
    rod_x(bm, shaft_r, shaft_x[0], shaft_x[1], 3, 28)
    gear_bm(z_pin, MOD1 if key == 'mot' else MODG, 24 if key == 'mot' else 20, x_pin, pin_phase, helix, None, bm=bm, mi=4)
    add(f'{tag}_rotor', bm, [M['lam'], M['mag_n'], M['mag_s'], M['steel'], M['gear']], g2, loc=at_axis(ax), spin=ax, ang=30)


def build_ecvt(M):
    build_machine(M, 'mot', 'Mot', MOT, 'M', X_P1, ZM, PH['mot'], 18, (-358, -136), -1,
                  '驱动电机', 'Traction motor',
                  '真正推车的是它：最大 90 kW、253 N·m（2022 年 10 月小改款后），起步一瞬间就有最大扭矩。它和车轮之间没有离合器，所以它永远跟着车轮转，减速时反过来发电（能量回收）。',
                  (-420, -80, 0, .30),
                  '永磁转子，最高约 13300 rpm。经 22→54 和 19→65 两级齿轮减速 8.4 倍到车轮。')
    build_machine(M, 'gen', 'Gen', GEN, 'G', X_GG, ZGP, PH['gp'], 14, (-348, -30), -1,
                  '发电机', 'Generator motor',
                  '发动机的力先到这里变成电。它和发动机之间也没有离合器，发动机一转它就跟着转（示意齿比 2.0）。它还兼任起动机：要起动发动机时，它反过来当电动机把曲轴转起来。',
                  (-420, 120, 260, .34),
                  '永磁转子。发动机停机时它也停着；直驱模式下它跟着空转、基本不出力。')
    # 输入轴：曲轴 → 发电机驱动齿轮（固定）→ 离合器内毂
    g = grp('input', '输入轴（连着发动机）', 'Input shaft',
            '和曲轴直连，转速 = 发动机转速。轴上固定着驱动发电机的大齿轮，以及离合器的内毂。',
            (-60, 0, 120, .44))
    bm = bmesh.new()
    rod_x(bm, 16, -172, 22, 0, 24)
    gear_bm(ZIG, MODG, 20, X_GG, PH['ig'], 1, 22, holes=6, hole_r=9, hole_c=40, bm=bm, mi=1)
    tube(bm, 18, 34, -126, -76, 2, 36)
    add('Input_shaft', bm, [M['steel'], M['gear'], M['steel']], g, loc=at_axis('I'), spin='I', ang=30)
    # 离合器
    g = grp('clutch', '直连离合器（锁止离合器）', 'Lock-up clutch',
            '整套 e-CVT 里唯一的离合器，湿式多片。分开时：发动机和车轮之间断开，发动机只发电。接合时：发动机经 67→54、19→65 两级固定齿轮直接推车，总传动比 2.757，没有别的挡位。',
            (-60, 0, 260, .50))
    bm = bmesh.new()
    for k in range(5):
        x = -116 + k * 7.6
        tube(bm, 34, 52, x, x + 2.6, 0, 48)
    add('Clutch_inner', bm, [M['clutch_f']], g, loc=at_axis('I'), spin='I', ang=30, extras=dict(clutch='inner'))
    bm = bmesh.new()
    for k in range(5):
        x = -112.2 + k * 7.6
        tube(bm, 42, 60, x, x + 2.2, 0, 48)
    add('Clutch_outer', bm, [M['clutch_s']], g, loc=at_axis('I'), spin='E', ang=30, extras=dict(clutch='outer'))
    bm = bmesh.new()
    tube(bm, 26, 58, -76, -70, 0, 48)
    add('Clutch_piston', bm, [M['alu']], g, loc=at_axis('I'), spin='I', ang=30, extras=dict(clutch='piston'))
    # 离合器外鼓 + 直驱齿轮（空套在输入轴上，和中间轴常啮合）
    g = grp('edrive', '发动机直驱齿轮 + 离合器外鼓', 'Engine-drive gear',
            '空套在输入轴上，和中间轴大齿轮一直啮合，所以它永远跟着车轮转。离合器分开时它和输入轴各转各的；接合的前一刻，发电机先把发动机转速调到和它一样（同步），再合上，几乎没有冲击。',
            (-60, 0, 330, .52))
    bm = bmesh.new()
    gear_bm(ZED, MOD1, 24, X_P1, PH['ed'], -1, 18, holes=6, hole_r=10, hole_c=46, bm=bm, mi=0)
    revolve(bm, [(19, -162), (19, -130), (62, -130), (62, -70), (66, -70), (66, -134), (24, -134), (24, -162)], 1, 64)
    add('Edrive_gear', bm, [M['gear'], M['alu']], g, loc=at_axis('I'), spin='E', ang=30)
    # 中间轴
    g = grp('counter', '中间轴', 'Counter shaft',
            '两条动力在这里汇合：电机小齿轮和发动机直驱齿轮都啮合在同一个 54 齿大齿轮上。轴的另一头是 19 齿主减速齿轮。',
            (0, 260, 180, .40))
    bm = bmesh.new()
    rod_x(bm, 16, -176, -66, 0, 24)
    gear_bm(ZCD, MOD1, 24, X_P1, PH['cd'], 1, 18, holes=5, hole_r=8, hole_c=36, bm=bm, mi=1)
    gear_bm(ZF, MODF, 30, X_FD, PH['final'], 1, None, bm=bm, mi=1)
    add('Counter_shaft', bm, [M['steel'], M['gear']], g, loc=at_axis('C'), spin='C', ang=30)
    # 差速器
    g = grp('diff', '差速器和主减速齿圈', 'Differential',
            '65 齿齿圈。转弯时让左右轮转速不同。到这里为止，电机到车轮总减速 8.40，发动机到车轮 2.757。',
            (0, 0, -200, .36))
    bm = bmesh.new()
    gear_bm(ZR, MODF, 28, X_FD, PH['ring'], -1, 52, bm=bm, mi=0)
    revolve(bm, [(18, -132), (34, -132), (52, -116), (62, -95), (52, -66), (34, -52), (18, -52)], 1, 48)
    add('Diff', bm, [M['gear'], M['alu']], g, loc=at_axis('D'), spin='D', ang=30)
    # 外壳
    g = grp('case', 'e-CVT 外壳', 'e-CVT housing',
            '本田叫它“电气式无段变速机”（e-CVT），但里面没有钢带也没有挡位：两个电机、几对固定齿轮和一个离合器。所谓“无段”，是因为发动机转速可以由发电机自由调节。',
            (-260, 0, 0, .14))
    pts = []
    for ax, r in (('M', 128), ('G', 112), ('I', 138), ('C', 66), ('D', 104)):
        y, z = AXES[ax]
        pts += circle(y, z, r, 48)
    outline = hull(pts)
    bm = bmesh.new()
    extrude(bm, [outline], -342, 40, 0, 'X')
    add('Case_main', bm, [M['alu']], g, ang=30)
    bm = bmesh.new()
    extrude(bm, [outline], -392, -342, 0, 'X')
    for ax in ('M', 'G'):
        y, z = AXES[ax]
        cyl(bm, (-398, y, z), (-392, y, z), 40, 40, 0, seg=24)
    add('Case_cover', bm, [M['alu']], 'case', ang=30)

    # PCU
    g = grp('pcu', 'PCU（功率控制单元）', 'Power control unit',
            '电的总调度：两套逆变器（一套给驱动电机、一套给发电机）加升压器 VCU。电池只有约 173 V，VCU 把它升到最高约 570 V，小电池才能带动 90 kW 的电机。',
            (0, 0, 520, .10))
    P = PCU
    bm = bmesh.new()
    rbox(bm, ((P['x0'] + P['x1']) / 2, (P['y0'] + P['y1']) / 2, (P['z0'] + P['z1']) / 2),
         (P['x1'] - P['x0'], P['y1'] - P['y0'], P['z1'] - P['z0']), 10, 0, 2)
    for k in range(7):
        x = P['x0'] + 30 + k * 43
        box(bm, x - 3, x + 3, P['y0'] + 20, P['y1'] - 20, P['z1'] - 2, P['z1'] + 5, 0)
    for xc, yc in ((-300, -60), (-240, -60), (-300, 260), (-240, 260)):
        cyl(bm, (xc, yc, P['z0'] + 6), (xc, yc, P['z0'] - 18), 13, 13, 1, seg=12)
    add('PCU', bm, [M['pcu'], M['hv']], g, ang=30)


# ---------------------------------------------------------------- 半轴 / 车轮 / 底盘
def halfshaft_bm(x0, x1):
    bm = bmesh.new()
    s = 1 if x1 > x0 else -1
    prof = [(0, x0), (24, x0), (38, x0 + s * 16), (38, x0 + s * 56), (24, x0 + s * 74), (16, x0 + s * 86), (15, x0 + s * 96),
            (15, x1 - s * 96), (17, x1 - s * 84), (28, x1 - s * 72), (44, x1 - s * 42), (44, x1 - s * 8), (0, x1)]
    if s < 0:
        prof = prof[::-1]
    revolve(bm, prof, 0, seg=32)
    return bm


def wheel_parts(M, tag, xc, y, sx, key, spin, front):
    def X(v):
        return xc + sx * v
    w = W_TYRE / 2
    bm = bmesh.new()
    tp = [(R_RIM + 6, X(-w + 12)), (R_RIM + 30, X(-w + 2)), (R_TYRE - 22, X(-w)), (R_TYRE - 6, X(-w + 12)), (R_TYRE, X(-w + 30)),
          (R_TYRE, X(w - 30)), (R_TYRE - 6, X(w - 12)), (R_TYRE - 22, X(w)), (R_RIM + 30, X(w - 2)), (R_RIM + 6, X(w - 12))]
    if sx < 0:
        tp = tp[::-1]
    revolve(bm, tp, 0, seg=72)
    add(f'Tyre_{tag}', bm, [M['tyre']], key, loc=(0, y, Z_AX), spin=spin, ang=38)
    bm = bmesh.new()
    rp = [(R_RIM - 8, X(-w + 4)), (R_RIM + 6, X(-w + 4)), (R_RIM + 6, X(-w + 14)), (R_RIM - 14, X(-w + 22)), (R_RIM - 18, X(-20)),
          (R_RIM - 14, X(w - 22)), (R_RIM + 6, X(w - 14)), (R_RIM + 6, X(w - 4)), (R_RIM - 8, X(w - 4)), (R_RIM - 26, X(w - 22)),
          (R_RIM - 30, X(-20)), (R_RIM - 26, X(-w + 24))]
    if sx < 0:
        rp = rp[::-1]
    revolve(bm, rp, 0, seg=72)
    for i in range(5):
        a = 2 * pi * i / 5
        ca, sa = cos(a), sin(a)
        pts = [(46, -17), (110, -12), (R_RIM - 26, -19), (R_RIM - 26, 19), (110, 12), (46, 17)]
        loop = [(-(u * ca - v * sa), u * sa + v * ca) for u, v in pts]
        xa, xb = X(w - 40), X(w - 22)
        extrude(bm, [loop], min(xa, xb), max(xa, xb), 0, 'X')
    hub = [(0, X(w - 20)), (50, X(w - 20)), (62, X(w - 28)), (62, X(w - 46)), (0, X(w - 46))]
    if sx < 0:
        hub = hub[::-1]
    revolve(bm, hub, 0, seg=40)
    add(f'Rim_{tag}', bm, [M['rim']], key, loc=(0, y, Z_AX), spin=spin, ang=34)
    bm = bmesh.new()
    dp = [(60, X(-w + 30)), (128 if front else 112, X(-w + 30)), (128 if front else 112, X(-w + 52)), (60, X(-w + 52))]
    revolve(bm, dp if sx > 0 else dp[::-1], 0, seg=56)
    add(f'Disc_{tag}', bm, [M['disc']], key, loc=(0, y, Z_AX), spin=spin, ang=30)
    bm = bmesh.new()
    th = radians(150)
    loop = [pm(r, a) for r, a in ((100, th - .5), (142, th - .58), (142, th + .58), (100, th + .5))]
    xa, xb = X(-w + 18), X(-w + 64)
    extrude(bm, [loop], min(xa, xb), max(xa, xb), 0, 'X')
    add(f'Caliper_{tag}', bm, [M['caliper']], key, loc=(0, y, Z_AX), ang=30)


def build_chassis(M):
    for tag, x0, x1, ex in (('L', -132, -TRACK_F + 70, -340), ('R', -52, TRACK_F - 70, 340)):
        key = grp(f'halfshaft_{tag}', '前半轴', 'Front half shaft', '差速器到前轮。两头是等速万向节，悬架上下跳也能传扭矩。右侧那根从发动机油底壳下面穿过去。', (ex, 0, 0, .10))
        add(f'HS_{tag}', halfshaft_bm(x0, x1), [M['steel']], key, loc=(0, 0, Z_AX), spin='D', ang=30)
    for tag, sx in (('FL', -1), ('FR', 1)):
        key = grp(f'wheel_{tag}', '前轮（驱动轮）', 'Front wheel', '185/60R15 轮胎，半径约 0.30 m。所有动力最后都从这两个前轮落到地面。', (sx * 520, 0, 0, .04))
        wheel_parts(M, tag, sx * TRACK_F, 0.0, sx, key, 'D', True)
    for tag, sx in (('RL', -1), ('RR', 1)):
        key = grp(f'wheel_{tag}', '后轮', 'Rear wheel', '两驱车型后轮不出力，只跟着滚。', (sx * 520, 0, 0, .04))
        wheel_parts(M, tag, sx * TRACK_R, -WB, sx, key, 'D', False)
    g = grp('rear_axle', '后扭力梁', 'Torsion beam', '后悬架。和动力无关，放在这里是为了看清电池和油箱的位置。', (0, 0, -300, .06))
    bm = bmesh.new()
    cyl(bm, (-640, -WB + 60, Z_AX), (640, -WB + 60, Z_AX), 38, 38, 0, seg=20)
    for sx in (-1, 1):
        cyl(bm, (sx * 640, -WB + 60, Z_AX), (sx * 650, -WB + 480, Z_AX + 40), 32, 26, 0, seg=14)
        cyl(bm, (sx * 600, -WB - 60, Z_AX + 10), (sx * 600, -WB - 60, Z_AX + 300), 34, 34, 0, seg=14)
    add('Rear_axle', bm, [M['forged']], g, ang=30)

    g = grp('tank', '燃油箱（40 L，中置）', 'Fuel tank',
            '飞度的招牌布局：油箱压扁了放在前排座椅下面，后排和后备箱的地板才能做低。燃油从这里送到发动机进气道上的喷油器。',
            (0, 0, -420, .08))
    T = TANK
    bm = bmesh.new()
    rbox(bm, ((T['x0'] + T['x1']) / 2, (T['y0'] + T['y1']) / 2, (T['z0'] + T['z1']) / 2),
         (T['x1'] - T['x0'], T['y1'] - T['y0'], T['z1'] - T['z0']), 26, 0, 3)
    add('Tank', bm, [M['tank']], g, ang=30)
    bm = bmesh.new()
    pipe(bm, FUEL_PATH, 5, 0, sides=8, per=8)
    add('Fuel_line', bm, [M['fuel']], g, ang=40)

    g = grp('ipu', 'IPU（高压电池包）', 'Intelligent power unit',
            '锂离子电池 48 个单体串联，标称约 173 V，放在后备箱地板下。容量本田没公布，混动车一般 1 kWh 左右（我的估计）——只够纯电跑几公里，它的作用是“缓冲”，不是“续航”。',
            (0, -200, -460, .12))
    I = IPU
    bm = bmesh.new()
    rbox(bm, ((I['x0'] + I['x1']) / 2, (I['y0'] + I['y1']) / 2, I['z0'] + 10), (I['x1'] - I['x0'], I['y1'] - I['y0'], 20), 10, 0, 2)
    for x0, x1, y0, y1 in ((I['x0'], I['x0'] + 6, I['y0'], I['y1']), (I['x1'] - 6, I['x1'], I['y0'], I['y1']),
                           (I['x0'], I['x1'], I['y0'], I['y0'] + 6), (I['x0'], I['x1'], I['y1'] - 6, I['y1'])):
        box(bm, x0, x1, y0, y1, I['z0'] + 20, I['z1'] - 40, 0)
    add('IPU_case', bm, [M['batt']], g, ang=30)
    bm = bmesh.new()
    for m in range(4):
        y0 = I['y0'] + 24 + m * 78
        for c in range(12):
            x = I['x0'] + 30 + c * 30
            rbox(bm, (x + 12, y0 + 33, I['z0'] + 75), (24, 66, 104), 2, 0, 1)
        box(bm, I['x0'] + 28, I['x1'] - 46, y0 + 6, y0 + 14, I['z0'] + 128, I['z0'] + 133, 1)
    add('IPU_cells', bm, [M['cell'], M['busbar']], g, ang=30)
    g = grp('ipu_lid', 'IPU 上盖和 DC-DC', 'IPU cover', '上盖下面还有电池管理（监控每个单体的电压和温度）、继电器和 DC-DC（给 12 V 系统充电）。', (0, -200, -260, .06))
    bm = bmesh.new()
    rbox(bm, ((I['x0'] + I['x1']) / 2, (I['y0'] + I['y1']) / 2, I['z1'] - 20), (I['x1'] - I['x0'], I['y1'] - I['y0'], 40), 12, 0, 2)
    add('IPU_lid', bm, [M['batt']], g, ang=30)

    g = grp('hv', '高压线（橙色）', 'High-voltage cables',
            '直流线从后面的电池沿地板下走到车头的 PCU；三相交流线从 PCU 分别接到驱动电机和发电机。',
            (0, 0, 0, 0))
    bm = bmesh.new()
    for dx in (-14, 14):
        pipe(bm, [(p[0] + dx, p[1], p[2]) for p in HV_PATH], 9, 0, sides=8, per=8)
    yg, zg = AXES['G']
    ym, zm = AXES['M']
    for k in range(3):
        x = -300 + k * 26
        pipe(bm, [(x, 230, PCU['z0'] - 4), (x, yg + 20, zg + 120), (x, yg, zg + GEN['ro'] - 2)], 7, 0, sides=8, per=6)
        pipe(bm, [(x, -60, PCU['z0'] - 4), (x, -80, zm + 150), (x, ym - 30, zm + MOT['ro'] - 6)], 7, 0, sides=8, per=6)
    add('HV_cables', bm, [M['hv']], g, ang=40)




# ---------------------------------------------------------------- 车身（示意外形，不是飞度的外观）
def pchip(xs, ys):
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        x = min(max(x, xs[0]), xs[-1])
        i = min(bisect_right(xs, x) - 1, n - 2)
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] +
                (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])
    return f


def _prof(pairs):
    return pchip([p[0] for p in pairs], [p[1] for p in pairs])


ZTOP = _prof([(-3200, 560), (-3194, 760), (-3182, 960), (-3155, 1120), (-3100, 1290), (-3010, 1420), (-2880, 1495), (-2600, 1528),
              (-2000, 1540), (-1300, 1540), (-900, 1526), (-660, 1480), (-470, 1330), (-280, 1140), (-160, 1015), (60, 930),
              (330, 878), (560, 826), (700, 766), (765, 700), (788, 625), (795, 540)])
ZBELT = _prof([(-3200, 560), (-3194, 760), (-3182, 930), (-3155, 985), (-3100, 1000), (-2880, 1004), (-2000, 990), (-1300, 976),
               (-660, 962), (-280, 958), (-160, 950), (60, 902), (330, 850), (560, 800), (700, 745), (765, 680), (788, 610), (795, 540)])
ZBOT = _prof([(-3200, 560), (-3194, 420), (-3165, 330), (-3080, 268), (-2900, 205), (-2600, 172), (-1500, 162), (300, 162),
              (520, 190), (680, 240), (760, 300), (788, 400), (795, 540)])
HW = _prof([(-3200, 60), (-3194, 420), (-3172, 640), (-3120, 760), (-3000, 820), (-2700, 845), (-1500, 848), (0, 846), (300, 840),
            (500, 820), (650, 772), (740, 692), (780, 560), (795, 150)])
HT = _prof([(-3200, 30), (-3194, 360), (-3162, 560), (-3092, 610), (-2880, 640), (-1500, 650), (-660, 650), (-280, 700),
            (-160, 720), (60, 700), (330, 680), (560, 622), (700, 530), (770, 390), (795, 80)])
NSEG = 12


def section_ctrl(y):
    zt, zb, zbl, hw, ht = ZTOP(y), ZBOT(y), ZBELT(y), HW(y), HT(y)
    k = min(1.0, hw / 420)
    ht = min(ht, hw - 40 * k)
    h = max(zbl - zb, 1.0)
    gh = max(zt - zbl, .5)
    ed = min(72.0, .22 * gh + 3 * k)
    hwb = hw - 120 * k
    p7 = (hw - 30 * k - .02 * gh, zbl + .05 * gh + 4 * k)
    p9 = (ht + 8 * k, zt - ed)
    return [
        (0, zb), (hwb * .55, zb), (hwb, zb + 2 * k), (hw - 30 * k, zb + .18 * h), (hw - 5 * k, zb + .42 * h),
        (hw, zb + .72 * h), (hw - 11 * k, zbl - 10 * k), p7,
        ((p7[0] + p9[0]) / 2 + 14 * k, (p7[1] + p9[1]) / 2), p9,
        (ht * .80, zt - ed * .30), (ht * .42, zt - ed * .07), (0, zt),
    ]


def cat(cp, s):
    s = min(max(s, 0.0), float(NSEG))
    i = min(int(s), NSEG - 1)
    t = s - i
    p1, p2 = cp[i], cp[i + 1]
    p0 = cp[i - 1] if i > 0 else (-cp[1][0], cp[1][1])
    p3 = cp[i + 2] if i + 2 <= NSEG else (-cp[NSEG - 1][0], cp[NSEG - 1][1])
    t2, t3 = t * t, t * t * t
    out = []
    for a in range(2):
        out.append(.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 +
                         (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3))
    return out


def body_mesh():
    ys = [Y_TAIL + (i / 12) ** 1.7 * 110 for i in range(12)]
    ys += [Y_TAIL + 110 + (Y_NOSE - Y_TAIL - 220) * i / 110 for i in range(111)]
    ys += [Y_NOSE - 110 * ((11 - i) / 11) ** 1.7 for i in range(1, 12)]
    S = 4
    ss = [i / S for i in range(NSEG * S + 1)]
    bm = bmesh.new()
    rings = []
    for y in ys:
        cp = section_ctrl(y)
        half = [cat(cp, s) for s in ss]
        ring = [bm.verts.new((x, y, z)) for (x, z) in half]
        ring += [bm.verts.new((-x, y, z)) for (x, z) in half[-2:0:-1]]
        rings.append(ring)
    n = len(rings[0])
    half_n = len(ss)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        yc = (ys[i] + ys[i + 1]) / 2
        for j in range(n):
            f = bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
            jj = j if j < half_n else n - j
            sv = (jj + .5) / S
            zc = f.calc_center_median().z
            glass = zc > ZBELT(yc) + 22 and yc < -170 and (sv < 9.3 or -650 < yc or yc < -3000)
            lower = sv < 2.6 and -3100 < yc < 700
            f.material_index = 1 if glass else (2 if lower else 0)
            f.smooth = True
    for r in (rings[0], rings[-1]):
        f = bm.faces.new(r)
        f.material_index = 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def build_body(M):
    g = grp('body', '车身（示意外形）', 'Body shell',
            '一辆普通紧凑两厢车的示意外形：车长约 4.0 m、轴距 2530 mm、轮胎 185/60R15 这些尺寸按飞度取，外观不是飞度的。',
            (0, 0, 1700, 0))
    mats = [M['paint'], M['glass'], M['trim']]
    bm = body_mesh()
    me = bpy.data.meshes.new('BodyTmp')
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new('BodyTmp', me)
    collection('Car').objects.link(ob)
    cut = bmesh.new()
    for y in (0.0, -WB):
        for sx in (1, -1):
            cyl(cut, (sx * 600, y, Z_AX), (sx * 1000, y, Z_AX), R_ARCH, mi=2, seg=64, smooth=True)
    cme = bpy.data.meshes.new('Cutter')
    cut.to_mesh(cme)
    cut.free()
    cob = bpy.data.objects.new('Cutter', cme)
    collection('Car').objects.link(cob)
    bm2 = bmesh.new()
    bm2.from_mesh(me)
    bmesh.ops.remove_doubles(bm2, verts=bm2.verts, dist=.01)
    bm2.to_mesh(me)
    bm2.free()
    mod = ob.modifiers.new('arch', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cob
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cob, do_unlink=True)
    bpy.data.meshes.remove(cme)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        c = f.calc_center_median()
        for y in (0.0, -WB):
            if math.hypot(c.y - y, c.z - Z_AX) < R_ARCH + 3 and abs(c.x) > 595:
                f.material_index = 2
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    add('Body_shell', bm, mats, g, ang=40, coll='Body')
    bm = bmesh.new()
    for sx in (1, -1):
        ball(bm, (sx * 590, 728, 742), 74, 0, seg=20, sc=(1.25, .32, .7))
        ball(bm, (sx * 690, -3168, 1010), 60, 1, seg=16, sc=(1.1, .35, 1.6))
    add('Body_lamps', bm, [M['lamp'], M['tail']], g, ang=50, coll='Body')

    g = grp('cabin', '车厢（座椅、方向盘）', 'Cabin', '右舵。前排座椅下面就是中置油箱，后备箱地板下面是电池。', (0, 0, 1100, .02))
    bm = bmesh.new()
    box(bm, -760, 760, -2600, FIREWALL[1], FLOOR_Z, FLOOR_Z + 14, 0)
    box(bm, -760, 760, -3080, -2600, IPU['z1'] + 6, IPU['z1'] + 20, 0)
    box(bm, -760, 760, -2620, -2600, FLOOR_Z, IPU['z1'] + 20, 0)
    box(bm, -760, 760, FIREWALL[0], FIREWALL[1], FLOOR_Z, 780, 0)
    add('Cabin_floor', bm, [M['floor']], g, ang=30, coll='Body')
    bm = bmesh.new()
    for sx in (1, -1):
        x = sx * 370
        rbox(bm, (x, -1090, 470), (500, 520, 110), 30, 0, 2)
        rbox(bm, (x, -1170, 350), (360, 380, 170), 20, 0, 1)
        vs = rbox(bm, (0, 0, 290), (480, 110, 600), 36, 0, 2)
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(radians(14), 3, 'X'))
        bmesh.ops.translate(bm, vec=(x, -1350, 490), verts=vs)
        rbox(bm, (x, -1530, 1120), (260, 90, 170), 30, 0, 2)
    add('Seats_front', bm, [M['seat']], g, ang=30, coll='Body')
    bm = bmesh.new()
    rbox(bm, (0, -2060, 470), (1300, 520, 130), 30, 0, 2)
    vs = rbox(bm, (0, 0, 290), (1300, 110, 600), 36, 0, 2)
    bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(radians(12), 3, 'X'))
    bmesh.ops.translate(bm, vec=(0, -2330, 510), verts=vs)
    add('Seats_rear', bm, [M['seat']], g, ang=30, coll='Body')
    bm = bmesh.new()
    rbox(bm, (0, -420, 900), (1500, 300, 160), 50, 0, 2)
    vs = []
    tor = []
    for k in range(40):
        a = 2 * pi * k / 40
        tor.append(Vector((370 + 185 * cos(a), -700 + 185 * sin(a) * sin(radians(24)), 1020 + 185 * sin(a) * cos(radians(24)))))
    sweep_round(bm, tor + [tor[0]], 16, 0, sides=10)
    cyl(bm, (370, -700, 1020), (370, -420, 900), 22, 22, 0, seg=12)
    add('Dash', bm, [M['interior']], g, ang=40, coll='Body')


# ---------------------------------------------------------------- 能量流路径和标签位置
def flows():
    I, G, Mx, C, D = (AXES[k] for k in 'IGMCD')

    def P(x, a, dz=0.0):
        return [x, a[0], a[1] + dz]
    return dict(
        fuel=[list(p) for p in FUEL_PATH],
        eng_gen=[P(392, I), P(X_GG, I), P(X_GG, G), P(-285, G)],
        eng_wheel=[P(392, I), P(-100, I), P(X_P1, I), P(X_P1, C), P(X_FD, C), P(X_FD, D)],
        mot_wheel=[P(-285, Mx), P(X_P1, Mx), P(X_P1, C), P(X_FD, C), P(X_FD, D)],
        axle_L=[P(X_FD, D), P(-TRACK_F, D)],
        axle_R=[P(X_FD, D), P(TRACK_F, D)],
        gen_pcu=[P(-285, G), [-285, G[0], G[1] + 110], [-270, 230, PCU['z0'] - 8], PCU_C],
        pcu_mot=[PCU_C, [-270, -60, PCU['z0'] - 8], [-285, Mx[0] - 40, Mx[1] + 120], P(-285, Mx)],
        batt_pcu=[[(IPU['x0'] + IPU['x1']) / 2 - 200, (IPU['y0'] + IPU['y1']) / 2, IPU['z0'] + 90]] + [list(p) for p in HV_PATH] + [PCU_C],
        exhaust=[list(p) for p in EXH_PATH],
    )


def anchors():
    I, G, Mx, C, D = (AXES[k] for k in 'IGMCD')
    return dict(
        eng_block=[225, CY, DECK + 200], gen_stator=[-290, G[0] + 40, G[1] + 120], mot_stator=[-290, Mx[0] - 120, Mx[1] - 40],
        clutch=[-100, I[0] + 40, I[1] + 70], pcu=[-230, 100, PCU['z1'] + 60], ipu=[0, (IPU['y0'] + IPU['y1']) / 2, IPU['z1'] + 80],
        tank=[0, (TANK['y0'] + TANK['y1']) / 2, TANK['z1'] + 60], wheel_FL=[-TRACK_F - 110, 0, Z_AX + 200],
        counter=[X_P1, C[0], C[1] - 70], diff=[X_FD, D[0], D[1] - 120],
    )


# ---------------------------------------------------------------- 动画 / 导出 / 渲染
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
    for ob, g in OBJS:
        if g in ('hv',):
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
        d = Vector((0, -1.2, .5)) - Vector(loc_)
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

    light('Key', (-3.0, 2.5, 4.2), 2600, 3.5)
    light('Rim', (3.5, -4.5, 2.6), 1500, 3.5)
    light('Fill', (-4.5, -1.5, 1.4), 700, 3.0)
    # 地面
    bm = bmesh.new()
    box(bm, -6000, 6000, -9000, 6000, -2, 0, 0)
    me = bpy.data.meshes.new('Ground')
    bm.to_mesh(me)
    bm.free()
    me.transform(Matrix.Scale(MM, 4))
    me.materials.append(principled('M_Ground', '#1a2433', 0, .9))
    gob = bpy.data.objects.new('Ground', me)
    collection('Studio').objects.link(gob)
    cam_d = bpy.data.cameras.new('Camera')
    cam_d.lens = 50
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


def render(cam, name, frame, pos, tgt, hide=(), xray=False, lens=50):
    sc = bpy.context.scene
    sc.frame_set(frame)
    sc.render.resolution_x, sc.render.resolution_y = ARGS.res, int(ARGS.res * .62)
    cam.data.lens = lens
    aim(cam, pos, tgt)
    body = bpy.data.objects.get('Body_shell')
    saved = None
    if xray and body:
        saved = [s.material for s in body.material_slots]
        ghost = bpy.data.materials.get('M_Ghost') or principled('M_Ghost', '#9fc4ff', 0, .1, alpha=.08)
        for s in body.material_slots:
            s.material = ghost
    for ob, _ in OBJS:
        ob.hide_render = any(ob.name.startswith(h) for h in hide) or ob.name.startswith('Burn_')
    sc.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    print('[OK] rendered', name)
    for ob, _ in OBJS:
        ob.hide_render = False
    if saved:
        for s, m in zip(body.material_slots, saved):
            s.material = m


def export_glb(path):
    bpy.context.scene.frame_set(1)
    for ob in bpy.context.scene.objects:
        ob.hide_viewport = False
        ob.hide_set(False)
        ob.select_set(ob.type == 'MESH' and ob.name != 'Ground')
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_extras=True,
              export_yup=True, export_animations=False, export_cameras=False, export_lights=False)
    bpy.ops.export_scene.gltf(**kw)
    print('[OK] exported', path, os.path.getsize(path) // 1024, 'KB')


def main():
    reset()
    M = make_materials()
    build_engine(M)
    build_ecvt(M)
    build_chassis(M)
    build_body(M)
    tris = 0
    for o, _ in OBJS:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    spec = dict(
        axes={k: list(v) for k, v in AXES.items()},
        teeth=dict(M=ZM, CD=ZCD, ED=ZED, F=ZF, R=ZR, IG=ZIG, GP=ZGP),
        ratio=dict(motor=RATIO_M, engine=RATIO_E, gen=RATIO_G, official=dict(motor=2.454, engine=0.805, final=3.423)),
        x=dict(p1=X_P1, fd=X_FD, gg=X_GG),
        engine=dict(cr=CR, rod=ROD, cyl_x=CYL_X, cyl_ph=CYL_PH, firing=FIRING, cy=CY, cz=CZ, deck=DECK, bore=BORE, stroke=STROKE),
        wheel=dict(r=R_TYRE, z=Z_AX, track_f=TRACK_F, track_r=TRACK_R, wb=WB),
        mot=MOT, gen=GEN, pcu=PCU, ipu=IPU, tank=TANK,
        flows=flows(), anchors=anchors(),
        groups=GROUPS, explode={k: list(v) for k, v in EX.items()},
        objects={o.name: g for o, g in OBJS}, tris=tris,
    )
    with open(os.path.join(OUT, 'spec.json'), 'w', encoding='utf-8') as f:
        json.dump(spec, f, ensure_ascii=False, indent=1)
    cam = setup_render()
    glb = os.path.join(OUT, 'ehev.glb')
    export_glb(glb)
    animate()
    aim(cam, (-3.6, 3.4, 2.4), (0, -1.1, .6))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'ehev.blend'), compress=True)
    print('[OK] saved ehev.blend')
    if ARGS.render:
        render(cam, 'view_exterior.jpg', 1, (-4.6, 3.7, 2.0), (0, -1.2, .62), lens=45)
        render(cam, 'view_xray.jpg', 1, (-4.3, 3.3, 3.0), (0, -1.15, .45), xray=True, lens=42)
        render(cam, 'view_ecvt.jpg', 1, (-1.55, .95, 1.25), (-.12, .14, .44), hide=('Body', 'Cabin', 'Seats', 'Dash', 'Case', 'PCU', 'HV', 'Mot_stator_q', 'Gen_stator_q', 'Batt12', 'Radiator', 'Eng_block_f', 'Eng_head', 'Eng_camcover', 'Eng_intake', 'Eng_fuelrail', 'Eng_chain'), lens=50)
        render(cam, 'view_exploded.jpg', FRAMES + 1, (-6.5, 4.2, 4.6), (0, -1.1, .9), lens=40)
    print(f'[OK] {len(OBJS)} objects, {tris} triangles, ratio motor {RATIO_M:.3f} engine {RATIO_E:.3f}')


main()
