#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
踏板摩托车的发动机和动力系统 · Blender 纯脚本建模（教学示意，不对应任何具体车型）

四个模型，结构参考公开专利（页面最后一章列了编号），尺寸是 125 cc / 50 cc 级别的量级：
    U4  四冲程单元摆动总成：单缸风冷 SOHC 两气门 + 皮带无级变速（CVT）+ 离心离合器
        + 两级齿轮减速 + 后轮，整个总成绕前端的摆动轴上下摆。
        另有三套“变体”零件，网页按章节显示：
          ecvt  电控 CVT：电机 + 减速齿轮推动主动轮的动盘（取代离心滚子）
          conv  传统起动：单独的起动电机 + 减速齿轮（eSP 之类用发电机兼起动，没有这个）
          hyb   混动：48 V 电池 + 电力控制单元 + 线束（发电机兼做助力电机）
    T2  二冲程 50 cc：曲轴箱扫气、簧片进气阀、排气口 / 扫气口开在缸壁上
    EH  电动 · 轮毂电机：外转子电机就是后轮的轮毂
    EM  电动 · 摆臂电机：电机装在摆臂前端，两级齿轮减速到后轴，两块可换电池

运行方式（二选一）:
    blender -b -P build_scooter.py -- --out out [--render]
    python  build_scooter.py --out out [--render]      # 需要 pip install bpy（Python 3.11）

输出:
    scooter.blend   Blender 工程
    scooter.glb     给网页用（零件独立命名，extras 里带模型号、中文名、角色、变体、爆炸偏移）
    spec.json       每个模型的位置、剖切面、机位、标注点、流线、运动学参数（网页读这一份）
    view_*.jpg      只有加 --render 时才渲染（Cycles）

坐标约定:
    毫米，+X 朝车头，+Y 朝车的左边（CVT 在左边），+Z 朝上。建完缩放成米。
    所有会转的零件都绕 Y 方向的轴转（曲轴、皮带轮、齿轮、车轮、电机、摇臂、离合块、簧片），
    物体原点放在它自己的转轴上；网页只改位置、绕 Y 的角度和沿某一轴的缩放。
"""
import argparse
import json
import math
import os
import sys
from math import cos, pi, radians, sin, sqrt, tan, atan2, asin

import bpy  # 必须排在 bmesh 前面：pip 版 bpy 导入后才注册 bmesh / mathutils
import bmesh
from mathutils import Matrix, Vector, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
_argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
_ap = argparse.ArgumentParser()
_ap.add_argument('--out', default=os.path.join(HERE, 'out'))
_ap.add_argument('--render', action='store_true')
_ap.add_argument('--samples', type=int, default=32)
_ap.add_argument('--res', type=int, default=1300)
_ap.add_argument('--only', default='')
ARGS, _ = _ap.parse_known_args(_argv)
OUT = os.path.abspath(ARGS.out)
os.makedirs(OUT, exist_ok=True)

MM = 0.001
TAU = 2 * pi
SOLVER = os.environ.get('SCOOTER_BOOL', 'MANIFOLD')

# 四个模型在地面上排成一排（mm）
OFFSET = {'EM': (-2150.0, 0.0, 0.0), 'EH': (-1250.0, 0.0, 0.0), 'U4': (0.0, 0.0, 0.0), 'T2': (820.0, 0.0, 0.0)}
GROUND = -242.0          # 后轮半径 242 mm（100/90-12 级别），轴心 Z = 0


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


def principled(name, hexc, metal=0.0, rough=0.5, coat=0.0, emit=None, alpha=None):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
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
    m.diffuse_color = (*col, 1.0)
    return m


MAT = {}


def make_materials():
    # 颜色按“角色”分：
    #   银灰 = 铝合金壳体    深钢 = 曲轴、齿轮、轴      琥珀 = 会动的关键件（活塞、动盘、滚子、离合块）
    #   黑 = 橡胶（皮带、轮胎）  铜 = 线圈   红/蓝 = 磁铁 N/S   青 = 进气   暗橙 = 排气
    MAT.update(
        alu=principled('Aluminium', '#b9c0c8', metal=.85, rough=.38),
        aluD=principled('AluminiumDark', '#7f8a96', metal=.8, rough=.45),
        cast=principled('CastCase', '#9aa3ad', metal=.6, rough=.55),
        cover=principled('CoverPaint', '#4c5562', metal=.3, rough=.45, coat=.3),
        steel=principled('Steel', '#6b7480', metal=.95, rough=.3),
        steelD=principled('SteelDark', '#3d444e', metal=.9, rough=.42),
        chrome=principled('Chrome', '#d9dee4', metal=1.0, rough=.12),
        move=principled('Moving', '#f0a43a', metal=.3, rough=.4),
        moveD=principled('MovingDark', '#c97b1c', metal=.35, rough=.45),
        piston=principled('Piston', '#d8d0c0', metal=.7, rough=.32),
        rubber=principled('Rubber', '#22262c', rough=.82),
        belt=principled('Belt', '#2b2f36', rough=.75),
        tire=principled('Tire', '#1c1f24', rough=.88),
        lining=principled('Lining', '#8a5a3c', rough=.9),
        copper=principled('Copper', '#c8743a', metal=.9, rough=.35),
        magN=principled('MagnetN', '#e5484d', metal=.2, rough=.4),
        magS=principled('MagnetS', '#3e7bfa', metal=.2, rough=.4),
        lam=principled('Lamination', '#59616c', metal=.85, rough=.5),
        spring=principled('Spring', '#9aa8b8', metal=.9, rough=.3),
        ceramic=principled('Ceramic', '#f1eee6', rough=.35),
        exhaust=principled('Exhaust', '#5b5048', metal=.75, rough=.42),
        muffler=principled('Muffler', '#3a3f47', metal=.6, rough=.4, coat=.2),
        intake=principled('Intake', '#2f3a44', rough=.6),
        airbox=principled('Airbox', '#323a44', rough=.55),
        battery=principled('Battery', '#24456e', rough=.5, coat=.3),
        pcu=principled('PCU', '#3b4250', metal=.4, rough=.5),
        frame=principled('Frame', '#56606d', metal=.6, rough=.45),
        charge=principled('Charge', '#4cc9f0', rough=.5, alpha=.55),
        reed=principled('Reed', '#3a3020', rough=.4),
        motor=principled('MotorHousing', '#5b6573', metal=.7, rough=.4),
        green=principled('Signal', '#4fd18b', rough=.5),
    )


def new_obj(name, me, mat, coll):
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if mat is not None:
        ob.data.materials.append(mat)
    return ob


def bm_to_obj(bm, name, mat, coll, smooth=True):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = new_obj(name, me, mat, coll)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
        # 平面和圆柱面之间的锐边保持锐利
        try:
            ob.data.set_sharp_from_angle(angle=radians(35))
        except Exception:
            try:
                mod = ob.modifiers.new('ws', 'WEIGHTED_NORMAL')
            except Exception:
                pass
    return ob


class Frame3:
    """一个局部坐标系：原点 O，轴向 A，径向参考 R1、R2（右手）"""

    def __init__(self, O=(0, 0, 0), A=(0, 1, 0), R1=(1, 0, 0), R2=None):
        self.O = Vector(O)
        self.A = Vector(A).normalized()
        self.R1 = Vector(R1).normalized()
        self.R2 = Vector(R2).normalized() if R2 else self.A.cross(self.R1).normalized()

    def p(self, a, r, phi):
        return self.O + self.A * a + (self.R1 * cos(phi) + self.R2 * sin(phi)) * r


FY = Frame3()        # 绕 Y 轴的默认坐标系（R1=X，R2=Y×X=−Z）


def lathe(name, prof, mat, coll, frame=FY, seg=64, smooth=True, phi0=0.0, arc=TAU):
    """把 (r, a) 闭合轮廓绕 frame 的轴转一圈，得到封闭实体"""
    bm = bmesh.new()
    n = len(prof)
    full = abs(arc - TAU) < 1e-6
    ns = seg if full else seg + 1
    rings = []
    for j in range(ns):
        phi = phi0 + arc * j / seg
        rings.append([bm.verts.new(frame.p(a, r, phi)) for (r, a) in prof])
    for j in range(seg):
        A_, B_ = rings[j], rings[(j + 1) % ns] if full else rings[j + 1]
        for i in range(n):
            i2 = (i + 1) % n
            vs = [A_[i], A_[i2], B_[i2], B_[i]]
            try:
                bm.faces.new(vs)
            except ValueError:
                pass
    if not full:
        for R in (rings[0], rings[-1]):
            try:
                bm.faces.new(R)
            except ValueError:
                pass
    return bm_to_obj(bm, name, mat, coll, smooth)


def box(name, c, s, mat, coll, rot=None, bevel=0.0):
    """中心 c、尺寸 s 的长方体；rot 是 3×3（列 = 局部 xyz 轴的世界方向）"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    M = Matrix.Diagonal((s[0], s[1], s[2], 1.0))
    if rot is not None:
        R = Matrix((rot[0], rot[1], rot[2])).transposed().to_4x4()
        M = R @ M
    M = Matrix.Translation(Vector(c)) @ M
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    ob = bm_to_obj(bm, name, mat, coll, smooth=False)
    if bevel > 0:
        md = ob.modifiers.new('bv', 'BEVEL')
        md.width = bevel
        md.segments = 2
        md.limit_method = 'ANGLE'
        apply_mods(ob)
    return ob


def cyl(name, r, a0, a1, mat, coll, frame=FY, seg=48, r_in=0.0):
    prof = [(r_in, a0), (r, a0), (r, a1), (r_in, a1)] if r_in > 0 else [(0, a0), (r, a0), (r, a1), (0, a1)]
    return lathe(name, prof, mat, coll, frame, seg, smooth=True)


def sphere(name, c, r, mat, coll, seg=32):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(c))
    return bm_to_obj(bm, name, mat, coll)


def tube(name, pts, r, mat, coll, res=6, caps=True, r_in=0.0):
    """沿折线（自动圆滑）的圆管；r_in>0 时做成空心管（两端开口）"""
    cu = bpy.data.curves.new(name + '_c', 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        bp = sp.bezier_points[i]
        bp.co = Vector(p)
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    cu.resolution_u = res
    cu.bevel_depth = r
    cu.bevel_resolution = 4
    cu.use_fill_caps = caps
    ob = bpy.data.objects.new(name, cu)
    coll.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-3)
    bm.to_mesh(me)
    bm.free()
    o2 = new_obj(name, me, mat, coll)
    for p in o2.data.polygons:
        p.use_smooth = True
    if r_in > 0:
        sol = o2.modifiers.new('sol', 'SOLIDIFY')
        sol.thickness = r - r_in
        sol.offset = -1
        apply_mods(o2)
    return o2


def path_pts(pts, n=24):
    """和 tube() 一样的圆滑折线，给流线用（Catmull-Rom 近似）"""
    P = [Vector(p) for p in pts]
    if len(P) < 3:
        return [tuple(P[0].lerp(P[-1], i / n)) for i in range(n + 1)]
    out = []
    for i in range(len(P) - 1):
        p0 = P[i - 1] if i > 0 else P[i]
        p1, p2 = P[i], P[i + 1]
        p3 = P[i + 2] if i + 2 < len(P) else P[i + 1]
        m = max(3, n // (len(P) - 1))
        for k in range(m):
            t = k / m
            t2, t3 = t * t, t * t * t
            v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            out.append(tuple(v))
    out.append(tuple(P[-1]))
    return out


def apply_mods(ob):
    """依次应用修改器；返回失败的个数"""
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bad = 0
    for md in list(ob.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=md.name)
        except Exception as e:
            bad += 1
            ob.modifiers.remove(md)
    return bad


def boolean(ob, cutters, op='DIFFERENCE', keep=False):
    for i, c in enumerate(cutters):
        for solver in (SOLVER, 'EXACT'):
            md = ob.modifiers.new(f'b{i}', 'BOOLEAN')
            md.object = c
            md.operation = op
            try:
                md.solver = solver
            except Exception:
                md.solver = 'EXACT'
            if apply_mods(ob) == 0:
                break
            print('  boolean fallback to EXACT:', ob.name, c.name)
        if not keep:
            bpy.data.objects.remove(c, do_unlink=True)
    return ob


def join(objs, name):
    keep = objs[0]
    bpy.context.view_layer.objects.active = keep
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.ops.object.join()
    keep.name = name
    keep.data.name = name
    return keep


def set_origin(ob, p):
    """把物体原点移到 p（mm），网格不动"""
    p = Vector(p)
    ob.data.transform(Matrix.Translation(-p))
    ob.location = ob.location + p
    return ob


def tag(ob, model, cn, role='static', ghost=False, ex=(0, 0, 0), var='', sel=True):
    ob['m'] = model
    ob['cn'] = cn
    ob['role'] = role
    if ghost:
        ob['ghost'] = 1
    if any(abs(v) > 1e-6 for v in ex):
        ob['ex'] = [float(v) for v in ex]
    if var:
        ob['var'] = var
    if not sel:
        ob['nosel'] = 1
    return ob


def gear(name, z, mod, a0, a1, mat, coll, center=(0, 0, 0), bore=0.0, phase=0.0):
    """直齿轮（梯形齿近似），绕 Y 轴，中心在 center，宽度 a0..a1（Y）"""
    rp = z * mod / 2
    ra, rf = rp + mod, rp - 1.25 * mod
    bm = bmesh.new()
    pts = []
    for k in range(z):
        a = phase + TAU * k / z
        w = TAU / z
        for (f, rr) in ((-0.25, rf), (-0.12, ra), (0.12, ra), (0.25, rf)):
            pts.append((rr * cos(a + f * w), rr * sin(a + f * w)))
    cx, cy, cz = center

    def ring(y):
        return [bm.verts.new((cx + x, y, cz + zz)) for (x, zz) in pts]
    b0, b1 = ring(a0), ring(a1)
    n = len(pts)
    for i in range(n):
        bm.faces.new([b0[i], b0[(i + 1) % n], b1[(i + 1) % n], b1[i]])
    bm.faces.new(b0)
    bm.faces.new(list(reversed(b1)))
    ob = bm_to_obj(bm, name, mat, coll, smooth=False)
    if bore > 0:
        boolean(ob, [cyl(name + '_bore', bore, a0 - 1, a1 + 1, None, coll, frame=Frame3(center))])
    return ob


def stadium_outline(c1, r1, c2, r2, n=40):
    """两个圆（XZ 平面）外公切线围成的轮廓，返回 [(x,z)]"""
    (x1, z1), (x2, z2) = c1, c2
    d = math.hypot(x2 - x1, z2 - z1)
    ang = atan2(z2 - z1, x2 - x1)
    phi = asin((r2 - r1) / d)
    pts = []
    # 圆 1 背离圆 2 的那一大段
    for k in range(n + 1):
        a = ang + pi / 2 + phi + (pi - 2 * phi) * k / n
        pts.append((x1 + r1 * cos(a), z1 + r1 * sin(a)))
    for k in range(n + 1):
        a = ang - pi / 2 - phi + (pi + 2 * phi) * k / n
        pts.append((x2 + r2 * cos(a), z2 + r2 * sin(a)))
    return pts


def extrude_outline(name, pts, y0, y1, mat, coll):
    bm = bmesh.new()
    b0 = [bm.verts.new((x, y0, z)) for (x, z) in pts]
    b1 = [bm.verts.new((x, y1, z)) for (x, z) in pts]
    n = len(pts)
    for i in range(n):
        try:
            bm.faces.new([b0[i], b0[(i + 1) % n], b1[(i + 1) % n], b1[i]])
        except ValueError:
            pass
    bm.faces.new(b0)
    bm.faces.new(list(reversed(b1)))
    return bm_to_obj(bm, name, mat, coll, smooth=False)


def offset_outline(pts, d):
    """把凸轮廓往里（d>0）收 d"""
    cx = sum(p[0] for p in pts) / len(pts)
    cz = sum(p[1] for p in pts) / len(pts)
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        tx, tz = p2[0] - p0[0], p2[1] - p0[1]
        L = math.hypot(tx, tz) or 1
        nx, nz = tz / L, -tx / L
        # 让法线朝里
        if (cx - p1[0]) * nx + (cz - p1[1]) * nz < 0:
            nx, nz = -nx, -nz
        out.append((p1[0] + nx * d, p1[1] + nz * d))
    return out


def coil_spring(name, frame, r, wire, length, turns, mat, coll, seg=10):
    """沿 frame 轴（从 O 开始，长 length）的螺旋弹簧"""
    pts = []
    N = int(turns * 24)
    for i in range(N + 1):
        t = i / N
        phi = TAU * turns * t
        pts.append(tuple(frame.p(length * t, r, phi)))
    return tube(name, pts, wire, mat, coll, res=1, caps=True)


def aligned(ob, base, direction):
    """把沿局部 +Z 建好的物体立到 base，+Z 指向 direction（用于要沿自身轴缩放的零件）"""
    q = Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized())
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = q
    ob.location = Vector(base)
    return ob


def zcyl_mesh(name, r, h, mat, coll, seg=48, r_top=None, dome=0.0):
    """沿局部 +Z、底面在原点的圆柱（可选顶端穹顶），用 aligned() 立起来"""
    rt = r if r_top is None else r_top
    prof = [(0, 0), (r, 0), (rt, h)]
    if dome > 0:
        for k in range(1, 7):
            a = pi / 2 * k / 6
            prof.append((rt * cos(a), h + dome * sin(a)))
    else:
        prof.append((0, h))
    return lathe(name, prof, mat, coll, frame=Frame3((0, 0, 0), (0, 0, 1), (1, 0, 0)), seg=seg)


# ================================================================ 公共零件
def wheel(M, coll, c, rim_r=152, tire_R=242, width=100, rim_w=70, spokes=5, name='Wheel', hub_r=40, hub_w=60, hub=True):
    """轮辋 + 轮胎，绕 Y；c = 轴心"""
    cx, cy, cz = c
    F = Frame3(c)
    # 轮胎截面：上半是椭圆，下半贴着轮辋
    tw = width / 2
    prof = []
    for k in range(33):
        a = -pi / 2 + pi * k / 32          # -90..90°，在 (r, y) 平面画半个“胖椭圆”
        rr = rim_r + 4 + (tire_R - rim_r - 4) * (cos(a) ** 0.7)
        yy = tw * sin(a) * (1 if abs(sin(a)) < .98 else 1)
        prof.append((rr, yy))
    prof = [(rim_r + 4, -rim_w / 2 + 3)] + [(r, y) for (r, y) in prof if r > rim_r + 8] + [(rim_r + 4, rim_w / 2 - 3)]
    tire = lathe(f'{M}_{name}Tire', prof, MAT['tire'], coll, Frame3(c), seg=96)
    # 轮辋：凹槽截面
    rw = rim_w / 2
    rp = [(rim_r - 8, -rw + 6), (rim_r - 2, -rw), (rim_r + 9, -rw - 1), (rim_r + 10, -rw + 3), (rim_r + 3, -rw + 7),
          (rim_r + 3, rw - 7), (rim_r + 10, rw - 3), (rim_r + 9, rw + 1), (rim_r - 2, rw), (rim_r - 8, rw - 6)]
    rim = lathe(f'{M}_{name}Rim', rp, MAT['alu'], coll, Frame3(c), seg=96)
    parts = [rim]
    if hub:
        parts.append(cyl(f'{M}_{name}Hub', hub_r, -hub_w / 2, hub_w / 2, MAT['alu'], coll, frame=Frame3(c), r_in=10))
    for k in range(spokes):
        a = TAU * k / spokes + .3
        u = Vector((cos(a), 0, sin(a)))
        mid = Vector(c) + u * ((hub_r + rim_r - 6) / 2)
        sp = box(f'{M}_{name}Spoke{k}', mid, (rim_r - 6 - hub_r + 6, 14, 22), MAT['alu'], coll,
                 rot=(tuple(u), (0, 1, 0), tuple(u.cross(Vector((0, 1, 0))))), bevel=2)
        parts.append(sp)
    rim = join(parts, f'{M}_{name}Rim')
    return rim, tire


# ================================================================ U4 四冲程单元摆动总成
U4 = {}
ALPHA = radians(12)                                      # 气缸前倾，离水平 12°
D_CYL = Vector((cos(ALPHA), 0, sin(ALPHA)))              # 气缸轴（从曲轴指向缸盖）
N_UP = Vector((-sin(ALPHA), 0, cos(ALPHA)))              # 垂直气缸轴、朝上（进气那一侧）
YV = Vector((0, 1, 0))
CR, CL = 29.0, 100.0                                     # 曲柄半径（行程 58）、连杆长
BORE = 52.4
PIN_H = 20.0                                              # 活塞销到顶面
DECK = 150.0                                              # 缸体顶面（离曲轴中心）
DOME = 11.0                                               # 燃烧室深度（压缩比约 11）
CAM_S = 212.0                                             # 凸轮轴位置（沿缸轴）
TANB = tan(radians(14))                                   # 皮带轮锥面半角 14°
W_P = 18.0                                                # 皮带节宽
YCD = 108.0                                               # 主动轮低速档时皮带中心面
R1_LO, R1_HI = 27.0, 55.0                                 # 主动轮节圆半径范围
R2_LO = 70.0                                              # 低速档从动轮节圆半径
DRV = Vector((-262.0, 0, 14.0))                           # 从动轮轴（= 离合器 = 减速箱输入轴）
CNT = Vector((-297.733, 0, -25.143))                      # 减速箱中间轴
AXL = Vector((-350.0, 0, 0.0))                            # 后轴
PIVOT = Vector((125.0, 0, 62.0))                          # 摆动轴（和车架连接）
WHEEL_Y = -8.0
Z_G = (13, 40, 14, 44)                                    # 两级齿轮齿数
GEAR_M = 2.0
C_CVT = math.hypot(DRV.x, DRV.z)


def belt_len(r1, r2, C=C_CVT):
    d = r2 - r1
    return 2 * sqrt(C * C - d * d) + pi * (r1 + r2) + 2 * d * asin(d / C)


BELT_L = belt_len(R1_LO, R2_LO)


def r2_of(r1):
    lo, hi = 10.0, 120.0
    for _ in range(70):
        m = (lo + hi) / 2
        if belt_len(r1, m) > BELT_L:
            hi = m
        else:
            lo = m
    return (lo + hi) / 2


R2_HI = r2_of(R1_HI)
YCN = YCD + TANB * ((R1_LO + R1_HI) / 2 - R1_LO) + TANB * (r2_of((R1_LO + R1_HI) / 2) - R2_HI)
GIN1 = W_P - 2 * R1_LO * TANB
GIN2 = W_P - 2 * R2_HI * TANB
DELTA_MAX = 2 * TANB * (R1_HI - R1_LO)
EPS_MAX = 2 * TANB * (R2_LO - R2_HI)
ROLL_N, ROLL_D, ROLL_RHO0 = 6, 16.0, 24.0
ROLL_KW = DELTA_MAX / (47.5 - ROLL_RHO0)                   # 滚子从半径 24 走到 47.5
RAMP_Y = 66.0                                             # 斜坡板贴滚子的那一面


def cylpt(s, u=0.0, y=0.0):
    return D_CYL * s + N_UP * u + YV * y


def piston_s(th, r=CR, L=CL):
    return r * cos(th) + sqrt(L * L - (r * sin(th)) ** 2)


# 配气正时（曲轴角，0 = 压缩上止点）
TIMING = dict(EVO=140, EVC=370, IVO=350, IVC=580, LIFT=7.0)


def build_U4():
    M = 'U4'
    coll = collection('U4 四冲程单元摆动总成')
    P = {}
    FC = Frame3((0, 0, 0), D_CYL, N_UP, YV)            # 沿气缸轴的坐标系（R1 = 上，R2 = 左）

    # ---------------------------------------------------------- 曲轴箱（左右合起来当一个零件，掏空曲轴室和缸套口）
    cc = box(f'{M}_Crankcase', (-6, 0, -2), (150, 128, 150), MAT['cast'], coll, bevel=14)
    lug = box(f'{M}_Lug', (82, 0, 38), (100, 100, 46), MAT['cast'], coll,
              rot=((cos(radians(25)), 0, sin(radians(25))), (0, 1, 0), (-sin(radians(25)), 0, cos(radians(25)))), bevel=8)
    boss = cyl(f'{M}_PivotBoss', 17, -55, 60, MAT['cast'], coll, frame=Frame3(PIVOT))
    neck = lathe(f'{M}_Neck', [(0, 40), (40, 40), (40, 66), (0, 66)], MAT['cast'], coll, FC, seg=48)
    cc = join([cc, lug, boss, neck], f'{M}_Crankcase')
    cav = cyl('cav', 54, -34, 34, None, coll, frame=FY)
    bore_c = cyl('borec', BORE / 2 + 1, 20, 80, None, coll, frame=FC)
    chain_t = box('chaint', tuple(cylpt(100, 0, -45)), (240, 30, 40), None, coll,
                  rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))
    shaft_h = cyl('shafth', 13, -90, 90, None, coll, frame=FY)
    piv_h = cyl('pivh', 9, -60, 70, None, coll, frame=Frame3(PIVOT))
    boolean(cc, [cav, bore_c, chain_t, shaft_h, piv_h])
    tag(cc, M, '曲轴箱（铝合金）', 'case', ghost=True)
    P['crankcase'] = cc

    # ---------------------------------------------------------- 气缸（风冷，散热片）
    barrel = lathe(f'{M}_Cylinder', [(BORE / 2, 62), (33, 62), (33, DECK), (BORE / 2, DECK)], MAT['alu'], coll, FC, seg=64)
    fins = [barrel]
    s = 72
    k = 0
    while s < DECK - 6:
        fins.append(lathe(f'fin{k}', [(32, s), (47 if k % 2 == 0 else 46, s + .3), (47 if k % 2 == 0 else 46, s + 2.2), (32, s + 2.6)],
                          MAT['alu'], coll, FC, seg=64))
        s += 8.5
        k += 1
    # 正时链通道：贴在气缸右侧（−Y）的一条方管，链条从曲轴走到凸轮轴
    fins.append(box('tun', tuple(cylpt(106, 0, -46)), (88, 52, 26), MAT['alu'], coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)), bevel=4))
    barrel = join(fins, f'{M}_Cylinder')
    boolean(barrel, [box('tunc', tuple(cylpt(106, 0, -46)), (100, 42, 16), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP))),
                     cyl('boreclr', BORE / 2, 50, DECK + 2, None, coll, frame=FC)])
    tag(barrel, M, '气缸（风冷散热片）', 'case', ghost=True, ex=tuple(D_CYL * 60))
    P['cylinder'] = barrel

    # ---------------------------------------------------------- 缸盖：燃烧室、进排气道、气门导管孔、凸轮室、火花塞孔
    head = box(f'{M}_Head', tuple(cylpt(186, 0, -7)), (72, 92, 110), MAT['alu'], coll,
               rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)), bevel=6)
    hf = [head]
    for k in range(4):
        sk = 158 + 9 * k
        hf.append(box(f'hfin{k}', tuple(cylpt(sk, 0, 0)), (2.4, 108, 112), MAT['alu'], coll,
                      rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)), bevel=.8))
    head = join(hf, f'{M}_Head')
    Rs = (DOME * DOME + (BORE / 2) ** 2) / (2 * DOME)
    ch = sphere('chamb', tuple(cylpt(DECK + DOME - Rs)), Rs, None, coll, seg=48)
    clip = box('chclip', tuple(cylpt(DECK - 40)), (80, 120, 120), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))
    boolean(ch, [clip])
    v_in = (D_CYL * cos(radians(22)) + N_UP * sin(radians(22))).normalized()
    v_ex = (D_CYL * cos(radians(22)) - N_UP * sin(radians(22))).normalized()
    seat_in = cylpt(DECK + DOME - 2.5, 12.5)
    seat_ex = cylpt(DECK + DOME - 2.5, -12.5)
    port_in = tube('pin', [tuple(seat_in), tuple(seat_in + v_in * 10), tuple(cylpt(176, 32)), tuple(cylpt(180, 62))], 11, None, coll)
    port_ex = tube('pex', [tuple(seat_ex), tuple(seat_ex + v_ex * 10), tuple(cylpt(174, -32)), tuple(cylpt(178, -62))], 10, None, coll)
    g_in = cyl('gin', 4.2, 0, 90, None, coll, frame=Frame3(seat_in, v_in, YV))
    g_ex = cyl('gex', 4.2, 0, 90, None, coll, frame=Frame3(seat_ex, v_ex, YV))
    camc = cyl('camc', 26, -60, 34, None, coll, frame=Frame3(cylpt(CAM_S)))
    rock = box('rockc', tuple(cylpt(228, 0, -6)), (40, 120, 84), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))
    tunh = box('tunh', tuple(cylpt(186, 0, -46)), (90, 52, 16), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))
    plug_dir = (D_CYL * 0.35 + YV).normalized()
    plug_h = cyl('plugh', 6, 0, 70, None, coll, frame=Frame3(cylpt(DECK + 6, 0, 8), plug_dir, D_CYL))
    boolean(head, [ch, port_in, port_ex, g_in, g_ex, camc, rock, tunh, plug_h])
    tag(head, M, '缸盖（燃烧室、进排气道）', 'case', ghost=True, ex=tuple(D_CYL * 95))
    P['head'] = head
    hc = box(f'{M}_HeadCover', tuple(cylpt(236, 0, -6)), (26, 104, 96), MAT['cover'], coll,
             rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)), bevel=8)
    hci = box('hci', tuple(cylpt(232, 0, -6)), (24, 96, 88), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))
    boolean(hc, [hci])
    tag(hc, M, '缸盖罩', 'case', ghost=True, ex=tuple(D_CYL * 130))
    P['headcover'] = hc

    # ---------------------------------------------------------- 曲轴（两片曲柄带配重 + 曲柄销 + 两头轴）
    parts = []
    for y0, y1 in ((-16, -9), (9, 16)):
        # 曲柄片：大半圆是配重（背对曲柄销），剩下是一个窄臂
        bm = bmesh.new()
        outline = []
        for k in range(64):
            a = TAU * k / 64
            # 角度从气缸方向量起：0 = 指向曲柄销
            rel = (a + pi) % TAU - pi
            rr = 48 if abs(rel) > radians(80) else (CR + 13) / max(.35, cos(rel)) if abs(rel) < radians(60) else 40
            rr = min(rr, 48)
            outline.append((rr * cos(a), rr * sin(a)))
        b0 = [bm.verts.new(tuple(D_CYL * x + N_UP * zz + YV * y0)) for (x, zz) in outline]
        b1 = [bm.verts.new(tuple(D_CYL * x + N_UP * zz + YV * y1)) for (x, zz) in outline]
        n = len(outline)
        for i in range(n):
            bm.faces.new([b0[i], b0[(i + 1) % n], b1[(i + 1) % n], b1[i]])
        bm.faces.new(b0)
        bm.faces.new(list(reversed(b1)))
        parts.append(bm_to_obj(bm, f'web{y0}', MAT['steel'], coll, smooth=False))
    parts.append(cyl('cpin', 11, -9.5, 9.5, MAT['steel'], coll, frame=Frame3(D_CYL * CR)))
    parts.append(cyl('jl', 14, 16, 70, MAT['steel'], coll, frame=FY))
    parts.append(cyl('jl2', 11.5, 70, 147, MAT['steel'], coll, frame=FY))
    parts.append(cyl('jr', 14, -70, -16, MAT['steel'], coll, frame=FY))
    parts.append(cyl('jr2', 11, -112, -70, MAT['steel'], coll, frame=FY))
    parts.append(gear('csp', 18, 1.1, -49, -41, MAT['steelD'], coll))      # 正时链轮
    crank = join(parts, f'{M}_Crank')
    set_origin(crank, (0, 0, 0))
    tag(crank, M, '曲轴（带配重）', 'rot')
    P['crank'] = crank

    # ---------------------------------------------------------- 连杆（上止点姿势建，原点在大头 = 曲柄销）
    pin0 = D_CYL * CR
    small = D_CYL * (CR + CL)
    rod_parts = [
        cyl('big', 19, -8.5, 8.5, MAT['steelD'], coll, frame=Frame3(pin0), r_in=11.2),
        cyl('sml', 11, -7, 7, MAT['steelD'], coll, frame=Frame3(small), r_in=6.5),
        box('beam', tuple((pin0 + small) / 2), (CL - 26, 7, 12), MAT['steelD'], coll,
            rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)), bevel=1.5),
    ]
    rod = join(rod_parts, f'{M}_Rod')
    set_origin(rod, tuple(pin0))
    tag(rod, M, '连杆', 'rod')
    P['rod'] = rod

    # ---------------------------------------------------------- 活塞（上止点）+ 活塞销 + 活塞环
    crown = CR + CL + PIN_H
    pis = lathe(f'{M}_Piston', [(0, crown), (BORE / 2 - .3, crown), (BORE / 2 - .3, crown - 4), (BORE / 2 - 1.2, crown - 4.6),
                                (BORE / 2 - 1.2, crown - 6.2), (BORE / 2 - .3, crown - 6.8), (BORE / 2 - .3, crown - 38),
                                (BORE / 2 - 4, crown - 38), (BORE / 2 - 4, crown - 8), (0, crown - 8)], MAT['piston'], coll, FC, seg=64)
    ring = lathe('ring', [(BORE / 2 - 2.5, crown - 4.6), (BORE / 2 - .1, crown - 4.6), (BORE / 2 - .1, crown - 6.2), (BORE / 2 - 2.5, crown - 6.2)],
                 MAT['chrome'], coll, FC, seg=64)
    boss_l = cyl('pbl', 9, -16, -7.5, MAT['piston'], coll, frame=Frame3(small))
    boss_r = cyl('pbr', 9, 7.5, 16, MAT['piston'], coll, frame=Frame3(small))
    ppin = cyl('ppin', 6.3, -19, 19, MAT['chrome'], coll, frame=Frame3(small))
    pis = join([pis, ring, boss_l, boss_r, ppin], f'{M}_Piston')
    set_origin(pis, tuple(small))
    tag(pis, M, '活塞（铝）', 'piston', ex=tuple(D_CYL * 30))
    P['piston'] = pis

    # ---------------------------------------------------------- 缸内气体（沿缸轴缩放）和燃烧室里那一块
    chg = zcyl_mesh(f'{M}_Charge', BORE / 2 - .6, DECK - (crown - 2 * CR), MAT['charge'], coll, seg=48)
    aligned(chg, tuple(cylpt(DECK)), tuple(-D_CYL))
    tag(chg, M, '缸内气体', 'charge', sel=False)
    P['charge'] = chg
    dome = sphere(f'{M}_ChargeDome', tuple(cylpt(DECK + DOME - Rs)), Rs - .8, MAT['charge'], coll, seg=40)
    boolean(dome, [box('dclip', tuple(cylpt(DECK - 40.6)), (80, 120, 120), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))])
    tag(dome, M, '燃烧室里的气体', 'charge', sel=False)
    P['chargeDome'] = dome

    # ---------------------------------------------------------- 气门（关闭位置，沿各自的轴往燃烧室里开）
    def valve(nm, seat, v, rh, cn):
        stem_len = 86
        prof = [(0, -1.2), (rh, -1.2), (rh, .3), (rh - 2.2, 2.4), (3.0, 9), (3.0, stem_len), (0, stem_len)]
        vo = lathe(nm, prof, MAT['chrome'], coll, Frame3(seat, v, YV), seg=40)
        ret = cyl(nm + 'ret', 8.5, stem_len - 10, stem_len - 7, MAT['steel'], coll, frame=Frame3(seat, v, YV))
        vo = join([vo, ret], nm)
        set_origin(vo, tuple(seat))
        return vo
    vi = valve(f'{M}_ValveIn', seat_in, v_in, 12.0, '进气门')
    tag(vi, M, '进气门', 'valve')
    ve = valve(f'{M}_ValveEx', seat_ex, v_ex, 10.2, '排气门')
    tag(ve, M, '排气门', 'valve')
    P['valveIn'], P['valveEx'] = vi, ve
    springs = {}
    for nm, seat, v in (('SpringIn', seat_in, v_in), ('SpringEx', seat_ex, v_ex)):
        base = seat + v * 52
        sp = coil_spring(f'{M}_{nm}', Frame3((0, 0, 0), (0, 0, 1), (1, 0, 0)), 8.0, 1.3, 24, 5.5, MAT['spring'], coll)
        aligned(sp, tuple(base), tuple(v))
        tag(sp, M, '气门弹簧', 'vspring', sel=True)
        springs[nm] = (sp, base, v)
    P['springs'] = springs

    # ---------------------------------------------------------- 凸轮轴（两个凸轮 + 正时链轮）和两只摇臂
    cam_c = cylpt(CAM_S)
    tip_in = seat_in + v_in * 86
    tip_ex = seat_ex + v_ex * 86
    piv_in = cylpt(244, 22)
    piv_ex = cylpt(244, -22)
    slip_in = cylpt(CAM_S + 11, 5.5)
    slip_ex = cylpt(CAM_S + 11, -5.5)
    # 凸轮最高点的曲轴角 → 凸轮轴角（曲轴的一半），凸轮尖要在那时指向摇臂滑块
    th_ex_max = radians((TIMING['EVO'] + TIMING['EVC']) / 2)
    th_in_max = radians((TIMING['IVO'] + TIMING['IVC']) / 2)

    def rotY(v, a):
        return Vector((v.x * cos(a) + v.z * sin(a), v.y, -v.x * sin(a) + v.z * cos(a)))

    def lobe(nm, y0, y1, nose_dir):
        a0 = atan2(nose_dir.z, nose_dir.x)
        outline = []
        for k in range(72):
            a = TAU * k / 72
            rel = (a - a0 + pi) % TAU - pi
            rr = 11 + 4.6 * max(0, cos(rel * 1.55)) ** 1.6 if abs(rel) < pi / 1.55 else 11
            outline.append((cam_c.x + rr * cos(a), cam_c.z + rr * sin(a)))
        return extrude_outline(nm, outline, y0, y1, MAT['steel'], coll)
    w_ex = (slip_ex - cam_c).normalized()
    w_in = (slip_in - cam_c).normalized()
    n_ex = rotY(w_ex, -th_ex_max / 2)
    n_in = rotY(w_in, -th_in_max / 2)
    cams = [lobe('lobeEx', -12, -2, n_ex), lobe('lobeIn', 2, 12, n_in),
            cyl('camsh', 8, -48, 18, MAT['steel'], coll, frame=Frame3(cam_c)),
            gear('camsp', 36, 1.1, -49, -41, MAT['steelD'], coll, center=tuple(cam_c))]
    cam = join(cams, f'{M}_Camshaft')
    set_origin(cam, tuple(cam_c))
    tag(cam, M, '凸轮轴（曲轴转两圈它转一圈）', 'rot')
    P['cam'] = cam

    def rocker(nm, piv, slip, tip, sgnu):
        pp = [piv, slip, tip]
        segs = [box(nm + 'a', tuple((piv + slip) / 2), ((slip - piv).length + 6, 9, 7), MAT['steelD'], coll,
                    rot=(tuple((slip - piv).normalized()), (0, 1, 0), tuple(YV.cross((slip - piv).normalized()) * -1)), bevel=1.5),
                box(nm + 'b', tuple((piv + tip) / 2), ((tip - piv).length + 4, 9, 7), MAT['steelD'], coll,
                    rot=(tuple((tip - piv).normalized()), (0, 1, 0), tuple(YV.cross((tip - piv).normalized()) * -1)), bevel=1.5),
                cyl(nm + 'p', 5.5, -6, 6, MAT['steel'], coll, frame=Frame3(piv)),
                cyl(nm + 's', 3.2, -5, 5, MAT['chrome'], coll, frame=Frame3(slip))]
        ro = join(segs, nm)
        set_origin(ro, tuple(piv))
        return ro
    ri = rocker(f'{M}_RockerIn', piv_in, slip_in, tip_in, 1)
    tag(ri, M, '进气摇臂', 'rocker')
    re_ = rocker(f'{M}_RockerEx', piv_ex, slip_ex, tip_ex, -1)
    tag(re_, M, '排气摇臂', 'rocker')
    P['rockerIn'], P['rockerEx'] = ri, re_
    rsh = join([cyl('rs1', 4, -40, 40, MAT['steel'], coll, frame=Frame3(piv_in)),
                cyl('rs2', 4, -40, 40, MAT['steel'], coll, frame=Frame3(piv_ex))], f'{M}_RockerShafts')
    tag(rsh, M, '摇臂轴', 'static')

    # ---------------------------------------------------------- 火花塞
    pbase = cylpt(DECK + 6, 0, 8)
    plug = lathe(f'{M}_SparkPlug', [(0, 0), (2.5, 0), (2.5, 4), (6, 5), (6, 18), (10, 19), (10, 28), (5, 29), (5, 52), (2.6, 53), (2.6, 60), (0, 60)],
                 MAT['ceramic'], coll, Frame3(pbase, plug_dir, D_CYL), seg=32)
    tag(plug, M, '火花塞', 'static', ex=tuple(plug_dir * 60))
    P['plug'] = (plug, pbase)

    # ---------------------------------------------------------- 正时链（静态的环，链节用流线小点画）
    chain_path = []
    c1 = Vector((0, -45, 0))
    c2 = Vector((cam_c.x, -45, cam_c.z))
    r1c, r2c = 18 * 1.1 / 2 + .8, 36 * 1.1 / 2 + .8
    dvec = c2 - c1
    dl = dvec.length
    ang = atan2(dvec.z, dvec.x)
    ph = asin((r2c - r1c) / dl)
    for k in range(25):
        a = ang + pi / 2 + ph + (pi - 2 * ph) * k / 24
        chain_path.append(c1 + Vector((cos(a), 0, sin(a))) * r1c)
    for k in range(25):
        a = ang - pi / 2 - ph + (pi + 2 * ph) * k / 24
        chain_path.append(c2 + Vector((cos(a), 0, sin(a))) * r2c)
    chain_path.append(chain_path[0])
    # 方向：曲轴绕 +Y 正转，链在曲轴链轮上和它同向走
    chain = tube(f'{M}_CamChain', [tuple(p) for p in chain_path[::2]] + [tuple(chain_path[0])], 1.6, MAT['steelD'], coll, res=2)
    tag(chain, M, '正时链', 'static', sel=True)
    U4['chain'] = [list(p) for p in chain_path]

    # ---------------------------------------------------------- 进气：空滤箱 → 节气门体 → 进气管 → 缸盖进气道
    ex_in = cylpt(180, 62)
    intake_pts = [(-150, 110, 140), (-40, 70, 142), (70, 30, 128), (140, 8, 108), tuple(ex_in + N_UP * 6 + D_CYL * 2)]
    itk = tube(f'{M}_IntakePipe', intake_pts, 15, MAT['intake'], coll, r_in=12.5)
    tag(itk, M, '进气管', 'pipe')
    tb_c = Vector((70, 30, 128))
    tbd = (Vector((140, 8, 108)) - Vector((-40, 70, 142))).normalized()
    thb = cyl(f'{M}_ThrottleBody', 21, -22, 22, MAT['aluD'], coll, frame=Frame3(tb_c, tbd, YV), r_in=14)
    inj = cyl('inj', 5, 0, 30, MAT['green'], coll, frame=Frame3(Vector((128, 12, 116)), (Vector((0.5, 0, 1))).normalized(), YV))
    thb = join([thb, inj], f'{M}_ThrottleBody')
    tag(thb, M, '节气门体 + 喷油嘴', 'static', ex=(0, 0, 50))
    P['throttle'] = thb
    abx = box(f'{M}_AirBox', (-225, 115, 150), (230, 120, 80), MAT['airbox'], coll, bevel=14)
    tag(abx, M, '空滤箱', 'case', ghost=True, ex=(0, 0, 90))
    U4['intake'] = [list(p) for p in path_pts([(-300, 115, 150), (-160, 112, 142)] + intake_pts[1:] + [tuple(seat_in + v_in * 8), tuple(cylpt(DECK + 4, 9))], 36)]

    # ---------------------------------------------------------- 排气：缸盖排气道 → 排气管 → 消声器（右边）
    ex_ex = cylpt(178, -62)
    exh_pts = [tuple(ex_ex - N_UP * 4), (175, -18, -60), (120, -70, -112), (0, -120, -104), (-110, -132, -64)]
    exh = tube(f'{M}_ExhaustPipe', exh_pts, 14, MAT['exhaust'], coll, r_in=11.5)
    tag(exh, M, '排气管', 'pipe')
    muf = cyl(f'{M}_Muffler', 58, -125, 320, MAT['muffler'], coll,
              frame=Frame3(Vector((-110, -136, -55)), (Vector((-1, 0, .1))).normalized(), YV))
    tail = cyl('tailp', 16, 320, 360, MAT['chrome'], coll,
               frame=Frame3(Vector((-110, -136, -55)), (Vector((-1, 0, .1))).normalized(), YV), r_in=12)
    muf = join([muf, tail], f'{M}_Muffler')
    tag(muf, M, '消声器（排气管）', 'case', ghost=True, ex=(0, -80, 0))
    U4['exhaust'] = [list(p) for p in path_pts([tuple(cylpt(DECK + 4, -9)), tuple(seat_ex + v_ex * 8)] + exh_pts + [(-250, -134, -45), (-470, -137, -26)], 36)]

    # ---------------------------------------------------------- 发电机兼起动机（ACG）：外转子 + 定子 + 风扇
    rot_parts = [lathe('acgcup', [(12, -96), (58, -96), (58, -70), (54, -70), (54, -91), (12, -91)], MAT['steel'], coll, seg=72)]
    for k in range(12):
        a = TAU * k / 12
        m = lathe(f'mag{k}', [(48.5, -88), (53.8, -88), (53.8, -73), (48.5, -73)], MAT['magN'] if k % 2 == 0 else MAT['magS'],
                  coll, seg=6, phi0=a - TAU / 24 * .82, arc=TAU / 12 * .82)
        rot_parts.append(m)
    for k in range(14):
        a = TAU * k / 14
        u = Vector((cos(a), 0, sin(a)))
        rot_parts.append(box(f'fan{k}', tuple(u * 38 + Vector((0, -101, 0))), (38, 10, 2.4), MAT['steelD'], coll,
                             rot=(tuple(u), (0, 1, 0), tuple(u.cross(YV))), bevel=.6))
    acgr = join(rot_parts, f'{M}_ACGRotor')
    set_origin(acgr, (0, 0, 0))
    tag(acgr, M, 'ACG 外转子（磁铁 + 冷却风扇）', 'rot', ex=(0, -70, 0))
    P['acgRotor'] = acgr
    st = [lathe('stcore', [(17, -87), (26, -87), (26, -75), (17, -75)], MAT['lam'], coll, seg=48)]
    coils = []
    for k in range(18):
        a = TAU * k / 18
        u = Vector((cos(a), 0, sin(a)))
        st.append(box(f'tooth{k}', tuple(u * 36 + Vector((0, -81, 0))), (22, 11, 5.5), MAT['lam'], coll,
                      rot=(tuple(u), (0, 1, 0), tuple(u.cross(YV)))))
        st.append(box(f'shoe{k}', tuple(u * 46 + Vector((0, -81, 0))), (2.5, 11, 13), MAT['lam'], coll,
                      rot=(tuple(u), (0, 1, 0), tuple(u.cross(YV)))))
        coils.append(box(f'coil{k}', tuple(u * 36 + Vector((0, -81, 0))), (15, 16, 10.5), MAT['copper'], coll,
                         rot=(tuple(u), (0, 1, 0), tuple(u.cross(YV))), bevel=1.6))
    stator = join(st, f'{M}_ACGStator')
    tag(stator, M, 'ACG 定子铁芯', 'static', ex=(0, -40, 0))
    coil = join(coils, f'{M}_ACGCoils')
    tag(coil, M, 'ACG 线圈（发电 / 起动 / 助力）', 'coil', ex=(0, -40, 0))
    P['acgCoils'] = coil
    shroud = lathe(f'{M}_FanCover', [(14, -62), (66, -62), (70, -66), (70, -110), (30, -114), (14, -114), (14, -110), (62, -108),
                                    (66, -105), (66, -66), (14, -66)], MAT['cover'], coll, seg=72)
    tag(shroud, M, '右侧盖（风扇罩）', 'case', ghost=True, ex=(0, -110, 0))

    # ---------------------------------------------------------- CVT 箱（内半在曲轴箱左边）+ 外盖
    outline = stadium_outline((0, 0), 78, (DRV.x, DRV.z), 96)
    case = extrude_outline(f'{M}_CVTCase', outline, 56, 150, MAT['cast'], coll)
    inner = extrude_outline('cvti', offset_outline(outline, 4.5), 61, 160, None, coll)
    holes = [cyl('h1', 13, 40, 70, None, coll, frame=FY), cyl('h2', 14, 40, 70, None, coll, frame=Frame3(DRV))]
    boolean(case, [inner] + holes)
    tag(case, M, 'CVT 箱（左曲轴箱）', 'case', ghost=True, ex=(0, 30, 0))
    P['cvtCase'] = case
    cov = extrude_outline(f'{M}_CVTCover', outline, 150, 197, MAT['cover'], coll)
    covi = extrude_outline('covi', offset_outline(outline, 4.5), 140, 193, None, coll)
    boolean(cov, [covi])
    tag(cov, M, 'CVT 外盖', 'cover', ghost=True, ex=(0, 220, 0))
    P['cvtCover'] = cov

    # ---------------------------------------------------------- 主动轮：定盘（带风扇叶）、动盘、斜坡板、6 个滚子
    yfc = YCD + GIN1 / 2           # 定盘锥面：y = yfc + r·tanβ
    fx = lathe(f'{M}_DriveFixed', [(12, 112.6), (16, yfc + 16 * TANB), (61, yfc + 61 * TANB), (62, yfc + 61 * TANB + 2),
                                   (62, 130), (12, 130)], MAT['alu'], coll, seg=96)
    fb = [fx]
    for k in range(16):
        a = TAU * k / 16
        u = Vector((cos(a), 0, sin(a)))
        fb.append(box(f'fb{k}', tuple(u * 41 + Vector((0, 135, 0))), (36, 10, 2.6), MAT['alu'], coll,
                      rot=(tuple(u), (0, 1, 0), tuple(u.cross(YV) * cos(.25) + YV * sin(.25)))))
    fb.append(cyl('nut', 15, 129, 142, MAT['steel'], coll, seg=6))
    fx = join(fb, f'{M}_DriveFixed')
    set_origin(fx, (0, 0, 0))
    tag(fx, M, '主动轮定盘（外侧带风扇叶）', 'rot', ex=(0, 150, 0))
    P['driveFixed'] = fx
    ymc = YCD - GIN1 / 2           # 动盘锥面（低速档）：y = ymc − r·tanβ
    # 动盘背面是一圈“屋顶”：越往外越贴近斜坡板，滚子被甩出去时就把动盘往皮带那边挤
    back = lambda r: RAMP_Y + ROLL_D - ROLL_KW * (r - ROLL_RHO0)
    mv_prof = [(16, RAMP_Y + 4), (20, RAMP_Y + 4), (20, back(20) + .2)]
    for r in (24, 30, 36, 42, 47.5, 52):
        mv_prof.append((r, back(r) + .4))
    mv_prof += [(57, back(52) + 2.5), (61, ymc - 61 * TANB - 3), (62, ymc - 61 * TANB - 1.5), (61, ymc - 61 * TANB),
                (22, ymc - 22 * TANB), (16, ymc - 22 * TANB)]
    mv = lathe(f'{M}_DriveMovable', mv_prof, MAT['move'], coll, seg=96)
    set_origin(mv, (0, 0, 0))
    tag(mv, M, '主动轮动盘（背面是滚子斜坡）', 'rot', ex=(0, 90, 0), var='cent')
    P['driveMovable'] = mv
    rp_ = lathe(f'{M}_RampPlate', [(13, RAMP_Y - 6), (50, RAMP_Y - 6), (50, RAMP_Y), (13, RAMP_Y)], MAT['steel'], coll, seg=72)
    rpl = [rp_]
    for k in range(ROLL_N):
        a = TAU * (k + .5) / ROLL_N
        u = Vector((cos(a), 0, sin(a)))
        rpl.append(box(f'rpk{k}', tuple(u * 40 + Vector((0, RAMP_Y + 4, 0))), (24, 8, 5), MAT['steel'], coll,
                       rot=(tuple(u), (0, 1, 0), tuple(u.cross(YV)))))
    rp_ = join(rpl, f'{M}_RampPlate')
    set_origin(rp_, (0, 0, 0))
    tag(rp_, M, '斜坡板（固定在曲轴上）', 'rot', ex=(0, 40, 0), var='cent')
    P['rampPlate'] = rp_
    rollers = []
    for k in range(ROLL_N):
        a = TAU * k / ROLL_N
        u = Vector((cos(a), 0, sin(a)))
        cpos = u * ROLL_RHO0 + YV * (RAMP_Y + ROLL_D / 2)
        tdir = YV.cross(u)
        ro = lathe(f'{M}_Roller{k}', [(0, -6.5), (ROLL_D / 2, -6.5), (ROLL_D / 2, 6.5), (0, 6.5)], MAT['moveD'], coll,
                   Frame3(cpos, tdir, u), seg=28)
        set_origin(ro, tuple(cpos))
        tag(ro, M, '离心滚子（配重）', 'roller', ex=(0, 60, 0), var='cent')
        ro['k'] = k
        rollers.append(ro)
    U4['rollers'] = [[cos(TAU * k / ROLL_N), 0, sin(TAU * k / ROLL_N)] for k in range(ROLL_N)]

    # ---------------------------------------------------------- 从动轮：定盘 + 套筒、动盘（扭力凸轮槽）、弹簧、离合器
    # 从动定盘（内侧）锥面：y = YCN − GIN2/2 − r·tanβ；动盘（外侧）：y = YCN + GIN2/2 + r·tanβ − ε
    F2 = Frame3(DRV)
    df = lathe(f'{M}_DrivenFixed', [(19, YCN - GIN2 / 2 - 19 * TANB), (77, YCN - GIN2 / 2 - 77 * TANB), (78, YCN - GIN2 / 2 - 77 * TANB - 2),
                                    (78, YCN - GIN2 / 2 - 77 * TANB - 5), (30, 84), (19, 84)], MAT['alu'], coll, F2, seg=96)
    sleeve = cyl('slv', 23.5, 82, 160, MAT['steel'], coll, frame=F2, r_in=15)
    pins = [cyl(f'tcp{k}', 3.2, -6, 6, MAT['chrome'], coll,
                frame=Frame3(DRV + Vector((cos(TAU * k / 3) * 26, 128, sin(TAU * k / 3) * 26)), Vector((cos(TAU * k / 3), 0, sin(TAU * k / 3))), YV))
            for k in range(3)]
    df = join([df, sleeve] + pins, f'{M}_DrivenFixed')
    set_origin(df, tuple(DRV))
    tag(df, M, '从动轮定盘 + 套筒（导销）', 'rot2', ex=(0, 40, 0))
    P['drivenFixed'] = df
    eps0 = EPS_MAX                       # 建模姿势 = 低速档（动盘合到最紧）
    ym2 = lambda r: YCN + GIN2 / 2 + r * TANB - eps0
    dm_prof = [(24, ym2(24)), (77, ym2(77)), (78, ym2(77) + 2), (78, ym2(77) + 4.5), (40, ym2(40) + 8), (31, ym2(40) + 8),
               (31, ym2(24) + 30), (24, ym2(24) + 30)]
    dm = lathe(f'{M}_DrivenMovable', dm_prof, MAT['move'], coll, F2, seg=96)
    # 扭力凸轮：动盘套筒上的三条斜槽（导销在里面滑）
    slots = []
    for k in range(3):
        a = TAU * k / 3
        for j in range(5):
            aa = a - j * 0.07
            pos = DRV + Vector((cos(aa) * 28, 0, sin(aa) * 28)) + YV * (ym2(24) + 13 + j * 3.4)
            slots.append(cyl(f'sl{k}{j}', 3.9, -6, 6, None, coll, frame=Frame3(pos, Vector((cos(aa), 0, sin(aa))), YV)))
    boolean(dm, slots)
    set_origin(dm, tuple(DRV))
    tag(dm, M, '从动轮动盘（斜槽 = 扭力凸轮）', 'rot2', ex=(0, 70, 0))
    P['drivenMovable'] = dm
    y_sp0 = ym2(40) + 8                  # 弹簧座（动盘背面）
    CARRIER_Y = 158.0
    sp_len = CARRIER_Y - y_sp0
    spring = coil_spring(f'{M}_TorqueSpring', Frame3((0, 0, 0), (0, -1, 0), (1, 0, 0)), 36, 2.6, sp_len, 4.5, MAT['spring'], coll)
    spring.location = Vector((DRV.x, CARRIER_Y, DRV.z))
    tag(spring, M, '压缩弹簧（把从动轮往紧里推）', 'spring2', ex=(0, 110, 0))
    P['torqueSpring'] = spring
    U4['springY'] = [y_sp0, CARRIER_Y]
    carrier = lathe(f'{M}_ClutchCarrier', [(16, CARRIER_Y), (58, CARRIER_Y), (58, CARRIER_Y + 3.5), (16, CARRIER_Y + 3.5)], MAT['steel'], coll, F2, seg=72)
    nut2 = cyl('nut2', 17, CARRIER_Y - 3, CARRIER_Y + 8, MAT['steel'], coll, frame=F2, seg=6)
    carrier = join([carrier, nut2], f'{M}_ClutchCarrier')
    set_origin(carrier, tuple(DRV))
    tag(carrier, M, '离合器托盘（跟从动轮一起转）', 'rot2', ex=(0, 130, 0))
    P['carrier'] = carrier
    shoes = []
    U4['shoes'] = []
    for k in range(3):
        a0 = TAU * k / 3
        sh = lathe(f'sh{k}', [(52, CARRIER_Y + 4), (60.5, CARRIER_Y + 4), (60.5, CARRIER_Y + 22), (52, CARRIER_Y + 22)], MAT['moveD'], coll,
                   F2, seg=18, phi0=a0 + .12, arc=TAU / 3 - .42)
        ln = lathe(f'ln{k}', [(60.4, CARRIER_Y + 4.5), (63.2, CARRIER_Y + 4.5), (63.2, CARRIER_Y + 21.5), (60.4, CARRIER_Y + 21.5)], MAT['lining'], coll,
                   F2, seg=18, phi0=a0 + .22, arc=TAU / 3 - .6)
        pvt = F2.p(0, 50, a0)
        pvt.y = 0
        pv = cyl(f'pv{k}', 4, CARRIER_Y + 3, CARRIER_Y + 24, MAT['chrome'], coll, frame=Frame3(pvt))
        so = join([sh, ln, pv], f'{M}_Shoe{k}')
        fe = F2.p(0, 57, a0 + .12 + TAU / 3 - .42)
        set_origin(so, (pvt.x, 0, pvt.z))
        so.location = Vector((pvt.x, 0, pvt.z))
        tag(so, M, '离合块（摩擦片）', 'shoe', ex=(0, 150, 0))
        so['k'] = k
        shoes.append(so)
        U4['shoes'].append([pvt.x, 0, pvt.z])
        U4.setdefault('shoeEnds', []).append([fe.x, 0, fe.z])
    bell = lathe(f'{M}_ClutchBell', [(64, CARRIER_Y - 2), (69, CARRIER_Y - 2), (69, CARRIER_Y + 27), (66, CARRIER_Y + 30), (16, CARRIER_Y + 30),
                                     (16, CARRIER_Y + 26), (64, CARRIER_Y + 26)], MAT['steelD'], coll, F2, seg=96)
    shaft = cyl('dshaft', 11, 38, CARRIER_Y + 34, MAT['steel'], coll, frame=F2)
    pin_g = gear('g1', Z_G[0], GEAR_M, 40, 52, MAT['steel'], coll, center=tuple(DRV))
    bell = join([bell, shaft, pin_g], f'{M}_ClutchBell')
    set_origin(bell, tuple(DRV))
    tag(bell, M, '离合器外鼓 + 从动轴 + 第一级小齿轮', 'rotOut', ex=(0, 180, 0))
    P['bell'] = bell

    # ---------------------------------------------------------- 两级减速齿轮 + 齿轮箱
    g2 = gear('g2', Z_G[1], GEAR_M, 40, 52, MAT['steelD'], coll, center=tuple(CNT))
    g3 = gear('g3', Z_G[2], GEAR_M, 26, 39, MAT['steel'], coll, center=tuple(CNT))
    csh = cyl('csh', 9, 24, 60, MAT['steel'], coll, frame=Frame3(CNT))
    cnt = join([g2, g3, csh], f'{M}_CounterShaft')
    set_origin(cnt, tuple(CNT))
    tag(cnt, M, '中间轴（大齿轮 + 小齿轮）', 'rotCnt', ex=(0, 60, 0))
    P['counter'] = cnt
    g4 = gear(f'{M}_AxleGear', Z_G[3], GEAR_M, 26, 39, MAT['steelD'], coll, center=tuple(AXL))
    ax = cyl('axle', 12, -46, 62, MAT['steel'], coll, frame=Frame3(AXL))
    g4 = join([g4, ax], f'{M}_AxleGear')
    set_origin(g4, tuple(AXL))
    tag(g4, M, '后轴大齿轮', 'rotAxle', ex=(0, 60, 0))
    P['axleGear'] = g4
    # 齿轮箱外形：从动轴—后轴的长圆 + 中间轴处鼓出一圈
    gbox = extrude_outline(f'{M}_GearCase', stadium_outline((DRV.x, DRV.z), 30, (AXL.x, AXL.z), 56), 20, 58, MAT['cast'], coll)
    gb2 = cyl('gb2', 50, 20, 58, MAT['cast'], coll, frame=Frame3(CNT))
    gbox = join([gbox, gb2], f'{M}_GearCase')
    gin = extrude_outline('gci', stadium_outline((DRV.x, DRV.z), 26, (AXL.x, AXL.z), 52), 24, 54, None, coll)
    gin2 = cyl('gci2', 46, 24, 54, None, coll, frame=Frame3(CNT))
    gbh = cyl('gbh', 13, 0, 80, None, coll, frame=Frame3(AXL))
    boolean(gbox, [gin, gin2, gbh])
    tag(gbox, M, '齿轮箱（机油润滑）', 'case', ghost=True, ex=(0, 10, 0))

    # ---------------------------------------------------------- 后轮
    rim, tire = wheel(M, coll, (AXL.x, WHEEL_Y, AXL.z))
    for o in (rim, tire):
        set_origin(o, (AXL.x, 0, AXL.z))
    tag(rim, M, '后轮轮辋', 'rotAxle', ex=(0, -60, 0))
    tag(tire, M, '后轮轮胎', 'rotAxle', ex=(0, -60, 0))

    # ---------------------------------------------------------- 车架（不跟着摆）+ 后减震
    fr = [tube('ft', [(70, 0, 160), (140, 0, 120), (200, 0, 120), (360, 0, 140)], 14, MAT['frame'], coll),
          box('fbk', tuple(PIVOT + Vector((15, 0, 25))), (60, 140, 40), MAT['frame'], coll, bevel=6),
          tube('ftr', [(140, 70, 125), (-80, 140, 250), (-300, 160, 340)], 12, MAT['frame'], coll),
          tube('ftl', [(140, -70, 125), (-80, -140, 250), (-300, -160, 340)], 12, MAT['frame'], coll),
          cyl('fpin', 8, -66, 72, MAT['chrome'], coll, frame=Frame3(PIVOT))]
    frm = join(fr, f'{M}_Frame')
    tag(frm, M, '车架（摆动轴固定在这）', 'frame', ghost=True)
    shock_top = Vector((-300, 168, 335))
    shock_bot = Vector((-332, 168, 88))
    U4['shock'] = [list(shock_top), list(shock_bot)]
    mount = cyl(f'{M}_ShockMount', 11, 150, 180, MAT['cast'], coll, frame=Frame3(Vector((shock_bot.x, 0, shock_bot.z))))
    mnt2 = box('smb', (shock_bot.x + 4, 160, shock_bot.z - 8), (26, 22, 22), MAT['cast'], coll, bevel=3)
    mount = join([mount, mnt2], f'{M}_ShockMount')
    tag(mount, M, '后减震下支座', 'static')
    L_sh = (shock_bot - shock_top).length
    sh_body = zcyl_mesh('shb', 17, 120, MAT['steelD'], coll)
    sh_rod = cyl('shr', 6, 110, L_sh, MAT['chrome'], coll, frame=Frame3((0, 0, 0), (0, 0, 1), (1, 0, 0)))
    eye1 = cyl('se1', 10, -8, 8, MAT['steel'], coll, frame=Frame3((0, 0, 0), (0, 1, 0), (1, 0, 0)))
    eye2 = cyl('se2', 10, -8, 8, MAT['steel'], coll, frame=Frame3((0, 0, L_sh), (0, 1, 0), (1, 0, 0)))
    shock = join([sh_body, sh_rod, eye1, eye2], f'{M}_Shock')
    sh_sp = coil_spring(f'{M}_ShockSpring', Frame3((0, 0, 12), (0, 0, 1), (1, 0, 0)), 26, 3.6, L_sh - 34, 7, MAT['move'], coll)
    aligned(shock, tuple(shock_top), tuple(shock_bot - shock_top))
    aligned(sh_sp, tuple(shock_top), tuple(shock_bot - shock_top))
    tag(shock, M, '后减震器', 'shock')
    tag(sh_sp, M, '减震弹簧', 'shockSpring')
    U4['shockL'] = L_sh

    # ---------------------------------------------------------- 变体：电控 CVT 的执行器
    # 电机（装在 CVT 箱上面）→ 小齿轮 12T → 中间齿轮 44T → 滑块齿轮 32T（套在动盘轴套上，带螺纹）
    # 滑块一转，螺纹就把动盘推进 / 拉出一个螺距：电脑想要什么速比就转到什么位置（参考 US7237638B2、US8038557B2）
    a_idl, a_mot = radians(60), radians(84)
    idl = Vector((57 * cos(a_idl), 0, 57 * sin(a_idl)))
    ec_m = idl + Vector((42 * cos(a_mot), 0, 42 * sin(a_mot)))
    em_ = cyl('ecm', 18, 74, 124, MAT['motor'], coll, frame=Frame3(ec_m))
    em2 = cyl('ecm2', 12, 124, 132, MAT['steelD'], coll, frame=Frame3(ec_m))
    ems = cyl('ecms', 3, 60, 74, MAT['steel'], coll, frame=Frame3(ec_m))
    ecvt_static = join([em_, em2, ems], f'{M}_ECVTMotor')
    tag(ecvt_static, M, '电控 CVT 电机（装在 CVT 箱上）', 'static', var='ecvt', ex=(0, 0, 80))
    ec_g1 = gear(f'{M}_ECVTPinion', 12, 1.5, 62, 70, MAT['steel'], coll, center=tuple(ec_m))
    set_origin(ec_g1, tuple(ec_m))
    tag(ec_g1, M, '电机小齿轮', 'ecvtGear', var='ecvt', ex=(0, 0, 80))
    ec_g2 = gear(f'{M}_ECVTIdler', 44, 1.5, 62, 70, MAT['steelD'], coll, center=tuple(idl))
    set_origin(ec_g2, tuple(idl))
    tag(ec_g2, M, '减速齿轮', 'ecvtGear2', var='ecvt', ex=(0, 0, 60))
    sl = lathe(f'{M}_ECVTSlider', [(17, 60), (21, 60), (21, 82), (17, 82)], MAT['chrome'], coll, seg=48)
    slg = gear('slg', 32, 1.5, 62, 70, MAT['steel'], coll)
    sl = join([sl, slg], f'{M}_ECVTSlider')
    set_origin(sl, (0, 0, 0))
    tag(sl, M, '滑块齿轮（螺纹推动盘）', 'ecvtSlider', var='ecvt', ex=(0, 40, 0))
    U4['ecvt'] = dict(motor=list(ec_m), idler=list(idl))
    mv2 = lathe(f'{M}_DriveMovableE', [(22, 96), (30, 80), (61, ymc - 61 * TANB - 4), (62, ymc - 61 * TANB - 1.5), (61, ymc - 61 * TANB),
                                       (22, ymc - 22 * TANB)], MAT['move'], coll, seg=96)
    set_origin(mv2, (0, 0, 0))
    tag(mv2, M, '主动轮动盘（电控版，背面没有斜坡）', 'rot', ex=(0, 90, 0), var='ecvt')
    P['driveMovableE'] = mv2

    # ---------------------------------------------------------- 变体：传统起动电机 + 减速齿轮 + 单向离合
    # 起动电机小齿轮 10T → 减速齿轮 36T → 单向离合器外圈齿 52T（在曲轴上），模数 1.25
    a_g = radians(98)
    stg_c = Vector((cos(a_g) * (32.5 + 22.5), 0, sin(a_g) * (32.5 + 22.5)))
    stm_c = stg_c + Vector((0, 0, 22.5 + 6.25))
    stm = cyl('stm', 19, -60, 30, MAT['motor'], coll, frame=Frame3(stm_c))
    stc = cyl('stc', 9, 30, 40, MAT['steelD'], coll, frame=Frame3(stm_c))
    stp = gear('stp', 10, 1.25, -64, -54, MAT['steel'], coll, center=tuple(stm_c))
    stm = join([stm, stc, stp], f'{M}_StarterMotor')
    tag(stm, M, '起动电机（传统方式才有）', 'static', var='conv', ex=(0, 0, 70))
    stg = gear(f'{M}_StarterGear', 36, 1.25, -64, -54, MAT['steelD'], coll, center=tuple(stg_c))
    set_origin(stg, tuple(stg_c))
    tag(stg, M, '起动减速齿轮', 'starterGear', var='conv', ex=(0, 0, 50))
    owc = gear(f'{M}_OneWayClutch', 52, 1.25, -64, -54, MAT['steel'], coll, bore=13)
    set_origin(owc, (0, 0, 0))
    tag(owc, M, '单向离合器（起动后自动脱开）', 'owc', var='conv')
    U4['starter'] = list(stg_c)
    U4['starterM'] = list(stm_c)

    # ---------------------------------------------------------- 变体：混动的电池和电力控制单元
    bat = box(f'{M}_HybBattery', (-150, 0, 280), (150, 120, 90), MAT['battery'], coll, bevel=8)
    tag(bat, M, '48 V 锂电池（混动）', 'static', var='hyb', ex=(0, 0, 80))
    pcu = box(f'{M}_HybPCU', (20, -40, 220), (90, 70, 40), MAT['pcu'], coll, bevel=5)
    tag(pcu, M, '电力控制单元 PCU（逆变器）', 'static', var='hyb', ex=(0, 0, 60))
    cab_pts = [(-150, -50, 240), (-40, -60, 220), (20, -40, 205), (40, -80, 130), (10, -96, 60), (0, -100, 30)]
    cab = tube(f'{M}_HybCable', cab_pts, 4, MAT['magN'], coll)
    tag(cab, M, '高压线束', 'static', var='hyb')
    U4['hybFlow'] = [list(p) for p in path_pts(cab_pts, 40)]

    # 渲染专用：低速档时的皮带（网页里皮带是实时生成的）
    rb = belt_mesh_blender(f'{M}_BeltRender', R1_LO, R2_LO, coll)
    tag(rb, M, '皮带', 'renderonly')

    U4['P'] = P
    U4['v_in'], U4['v_ex'] = list(v_in), list(v_ex)
    U4['seat_in'], U4['seat_ex'] = list(seat_in), list(seat_ex)
    U4['piv_in'], U4['piv_ex'] = list(piv_in), list(piv_ex)
    U4['tip_in'], U4['tip_ex'] = list(tip_in), list(tip_ex)
    U4['cam_c'] = list(cam_c)
    U4['spring_base'] = {k: list(v[1]) for k, v in springs.items()}
    U4['ymc'] = ymc
    return coll


def belt_loop(r1, r2, n=180):
    """皮带节线：XZ 平面里绕主动轮（原点）和从动轮（DRV）的环，返回 [(x,z,side)]"""
    c1 = Vector((0, 0)); c2 = Vector((DRV.x, DRV.z))
    d = c2 - c1
    C = d.length
    ang = atan2(d.y, d.x)
    ph = asin((r2 - r1) / C)
    pts = []
    for k in range(n):
        a = ang + pi / 2 + ph + (pi - 2 * ph) * k / n
        pts.append((c1.x + r1 * cos(a), c1.y + r1 * sin(a), 0))
    for k in range(n):
        a = ang - pi / 2 - ph + (pi + 2 * ph) * k / n
        pts.append((c2.x + r2 * cos(a), c2.y + r2 * sin(a), 1))
    return pts


def belt_mesh_blender(name, r1, r2, coll):
    pts = belt_loop(r1, r2, 90)
    yb1 = YCD + TANB * (r1 - R1_LO)
    yb2 = YCN - TANB * (r2 - R2_HI)
    bm = bmesh.new()
    rings = []
    n = len(pts)
    for i, (x, z, sd) in enumerate(pts):
        c = Vector((0, 0)) if sd == 0 else Vector((DRV.x, DRV.z))
        nrm = Vector((x - c.x, z - c.y)).normalized()
        y = yb1 if sd == 0 else yb2
        sec = [(-6, 7.75), (3, 10), (3, -10), (-6, -7.75)]
        rings.append([bm.verts.new((x + nrm.x * a, y + w, z + nrm.y * a)) for (a, w) in sec])
    for i in range(n):
        A_, B_ = rings[i], rings[(i + 1) % n]
        for j in range(4):
            bm.faces.new([A_[j], A_[(j + 1) % 4], B_[(j + 1) % 4], B_[j]])
    return bm_to_obj(bm, name, MAT['belt'], coll, smooth=True)


# ================================================================ T2 二冲程 50 cc
T2 = {}
T2R, T2L, T2B, T2PH = 19.6, 80.0, 40.0, 18.0
T2_DECK = T2R + T2L + T2PH + 0.6
T2_EO, T2_TO = 90.0, 118.0          # 排气口、扫气口打开的曲轴角（上止点后）


def t2_crown(th):
    return piston_s(th, T2R, T2L) + T2PH


def build_T2():
    M = 'T2'
    coll = collection('T2 二冲程')
    FC = Frame3((0, 0, 0), D_CYL, N_UP, YV)
    cp = lambda s, u=0.0, y=0.0: D_CYL * s + N_UP * u + YV * y
    s_ex = t2_crown(radians(T2_EO))
    s_tr = t2_crown(radians(T2_TO))
    s_bdc = t2_crown(pi)
    T2.update(s_ex=s_ex, s_tr=s_tr, s_bdc=s_bdc)
    # 曲轴箱：紧紧包住整圆曲柄（二冲程靠曲轴箱当“打气筒”）
    cc = box(f'{M}_Crankcase', (0, 0, 0), (110, 92, 110), MAT['cast'], coll, bevel=16)
    neck = lathe('neck', [(0, 30), (34, 30), (34, 52), (0, 52)], MAT['cast'], coll, FC, seg=48)
    reedblk = box('rb', tuple(cp(10, 52)), (46, 50, 26), MAT['cast'], coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)), bevel=4)
    cc = join([cc, neck, reedblk], f'{M}_Crankcase')
    cav = cyl('cav', 42, -16, 16, None, coll, frame=FY)
    bc = cyl('bc', T2B / 2 + .5, 20, 60, None, coll, frame=FC)
    rcav = box('rcv', tuple(cp(10, 42)), (34, 36, 40), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))
    tr_low = [box(f'trl{s}', tuple(cp(42, 0, s * 23)), (60, 12, 26), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP))) for s in (-1, 1)]
    sh = cyl('sh', 10, -70, 70, None, coll, frame=FY)
    boolean(cc, [cav, bc, rcav] + tr_low + [sh])
    tag(cc, M, '曲轴箱（也是扫气泵）', 'case', ghost=True)
    # 气缸：缸套 + 排气口 + 两个扫气道（左右）+ 一个辅助扫气口（上方）
    cyl_o = lathe(f'{M}_Cylinder', [(T2B / 2, 46), (30, 46), (30, T2_DECK), (T2B / 2, T2_DECK)], MAT['alu'], coll, FC, seg=64)
    fins = [cyl_o]
    s = 60
    k = 0
    while s < T2_DECK - 5:
        fins.append(lathe(f'fin{k}', [(29, s), (40, s + .3), (40, s + 2), (29, s + 2.3)], MAT['alu'], coll, FC, seg=64))
        s += 7.5
        k += 1
    cyl_o = join(fins, f'{M}_Cylinder')
    exp = box('export', tuple(cp((s_ex + s_bdc) / 2 - 1, -24)), (s_ex - s_bdc + 2, 26, 22), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))
    exd = tube('exd', [tuple(cp((s_ex + s_bdc) / 2, -18)), tuple(cp((s_ex + s_bdc) / 2 - 2, -32)), tuple(cp((s_ex + s_bdc) / 2 - 6, -52))], 9, None, coll)
    trp = []
    for sgn in (-1, 1):
        trp.append(box(f'tw{sgn}', tuple(cp((s_tr + s_bdc) / 2 - 1, 4, sgn * 20)), (s_tr - s_bdc + 2, 14, 10), None, coll,
                       rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP))))
        trp.append(box(f'td{sgn}', tuple(cp((s_tr + 40) / 2 - 2, 4, sgn * 24.5)), (s_tr - 40, 14, 6), None, coll,
                       rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP))))
    boost = box('boost', tuple(cp((s_tr + s_bdc) / 2 - 1, 20)), (s_tr - s_bdc + 2, 10, 16), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))
    boostd = box('boostd', tuple(cp((s_tr + 40) / 2 - 2, 24.5)), (s_tr - 40, 6, 14), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))
    boolean(cyl_o, [exp, exd] + trp + [boost, boostd])
    tag(cyl_o, M, '气缸（缸壁上开着排气口、扫气口）', 'case', ghost=True, ex=tuple(D_CYL * 50))
    # 缸盖
    hd = lathe(f'{M}_Head', [(0, T2_DECK), (40, T2_DECK), (40, T2_DECK + 18), (14, T2_DECK + 22), (0, T2_DECK + 22)], MAT['alu'], coll, FC, seg=64)
    hf = [hd] + [lathe(f'hf{k}', [(20, T2_DECK + 4 + 5 * k), (46, T2_DECK + 4 + 5 * k), (46, T2_DECK + 6 + 5 * k), (20, T2_DECK + 6 + 5 * k)],
                       MAT['alu'], coll, FC, seg=64) for k in range(3)]
    hd = join(hf, f'{M}_Head')
    Rs = (10 ** 2 + (T2B / 2) ** 2) / 20
    ch = sphere('ch', tuple(cp(T2_DECK + 10 - Rs)), Rs, None, coll, seg=40)
    boolean(ch, [box('chc', tuple(cp(T2_DECK - 40)), (80, 100, 100), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))])
    plg = cyl('plh', 5.5, T2_DECK, T2_DECK + 30, None, coll, frame=FC)
    boolean(hd, [ch, plg])
    tag(hd, M, '缸盖（没有气门）', 'case', ghost=True, ex=tuple(D_CYL * 80))
    plug = lathe(f'{M}_SparkPlug', [(0, 0), (2.4, 0), (2.4, 4), (5.5, 5), (5.5, 16), (9, 17), (9, 25), (4.5, 26), (4.5, 46), (0, 46)], MAT['ceramic'], coll,
                 Frame3(cp(T2_DECK + 8.5), D_CYL, N_UP), seg=28)
    tag(plug, M, '火花塞', 'static', ex=tuple(D_CYL * 110))
    # 曲轴：整圆曲柄片（把曲轴箱的空余体积挤小）
    parts = []
    for y0, y1 in ((-14, -6), (6, 14)):
        parts.append(lathe(f'w{y0}', [(0, y0), (39, y0), (39, y1), (0, y1)], MAT['steel'], coll, FY, seg=64))
    parts.append(cyl('pin', 8, -6.5, 6.5, MAT['steel'], coll, frame=Frame3(D_CYL * T2R)))
    parts.append(cyl('sl', 10, 14, 60, MAT['steel'], coll, frame=FY))
    parts.append(cyl('sr', 10, -60, -14, MAT['steel'], coll, frame=FY))
    # 配重：在曲柄片上挖两个孔，让一边轻一边重（看得出转动）
    crank = join(parts, f'{M}_Crank')
    holes = [cyl(f'hh{y}', 8, y - 5, y + 5, None, coll, frame=Frame3(D_CYL * 22 + N_UP * sgn * 14)) for y in (-10, 10) for sgn in (-1, 1)]
    boolean(crank, holes)
    tag(crank, M, '曲轴（整圆曲柄片）', 'rot')
    pin0, small = D_CYL * T2R, D_CYL * (T2R + T2L)
    rod = join([cyl('big', 14, -6, 6, MAT['steelD'], coll, frame=Frame3(pin0), r_in=8.2),
                cyl('sml', 8, -5.5, 5.5, MAT['steelD'], coll, frame=Frame3(small), r_in=5),
                box('beam', tuple((pin0 + small) / 2), (T2L - 20, 5.5, 9), MAT['steelD'], coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)), bevel=1)],
               f'{M}_Rod')
    set_origin(rod, tuple(pin0))
    tag(rod, M, '连杆', 'rod')
    crown = T2R + T2L + T2PH
    pis = lathe(f'{M}_Piston', [(0, crown), (T2B / 2 - .3, crown - .5), (T2B / 2 - .3, crown - 34), (T2B / 2 - 3.5, crown - 34), (T2B / 2 - 3.5, crown - 6), (0, crown - 6)],
                MAT['piston'], coll, FC, seg=64)
    rg = lathe('rg', [(T2B / 2 - 2, crown - 3), (T2B / 2, crown - 3), (T2B / 2, crown - 4.5), (T2B / 2 - 2, crown - 4.5)], MAT['chrome'], coll, FC, seg=64)
    pp = cyl('pp', 5, -14, 14, MAT['chrome'], coll, frame=Frame3(small))
    pis = join([pis, rg, pp], f'{M}_Piston')
    set_origin(pis, tuple(small))
    tag(pis, M, '活塞（兼做“阀门”开关缸壁上的口）', 'piston', ex=tuple(D_CYL * 30))
    chg = zcyl_mesh(f'{M}_Charge', T2B / 2 - .6, T2_DECK - s_bdc, MAT['charge'], coll, seg=40)
    aligned(chg, tuple(cp(T2_DECK)), tuple(-D_CYL))
    tag(chg, M, '缸内气体', 'charge', sel=False)
    dm = sphere(f'{M}_ChargeDome', tuple(cp(T2_DECK + 10 - Rs)), Rs - .6, MAT['charge'], coll, seg=36)
    boolean(dm, [box('dmc', tuple(cp(T2_DECK - 40.5)), (80, 100, 100), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))])
    tag(dm, M, '燃烧室里的气体', 'charge', sel=False)
    # 簧片阀：两片簧片夹在 V 形阀座上，曲轴箱一吸就张开
    rc = cp(10, 54)
    seat = box(f'{M}_ReedCage', tuple(rc), (30, 32, 14), MAT['steelD'], coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)), bevel=2)
    win = box('rwin', tuple(rc), (20, 24, 20), None, coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))
    boolean(seat, [win])
    tag(seat, M, '簧片阀座', 'static')
    T2['reeds'] = []
    for sgn in (-1, 1):
        hinge = rc + D_CYL * (sgn * 15) - N_UP * 7
        petal = box(f'pt{sgn}', tuple(hinge - D_CYL * (sgn * 10)), (22, 26, .9), MAT['reed'], coll, rot=(tuple(D_CYL), (0, 1, 0), tuple(N_UP)))
        petal = join([petal], f'{M}_Reed{"F" if sgn > 0 else "R"}')
        set_origin(petal, tuple(hinge))
        tag(petal, M, '簧片（单向阀）', 'reed')
        petal['sgn'] = sgn
        T2['reeds'].append(list(hinge))
    carb = cyl(f'{M}_Carb', 15, 0, 34, MAT['aluD'], coll, frame=Frame3(rc + N_UP * 8, N_UP, D_CYL), r_in=9)
    tag(carb, M, '化油器（混合气 + 机油）', 'pipe', ex=(0, 0, 40))
    exp_pts = [tuple(cp((s_ex + s_bdc) / 2 - 6, -48)), tuple(cp(70, -80)), (20, 0, -110), (-90, 0, -120), (-200, 0, -100)]
    exh = tube(f'{M}_Exhaust', exp_pts, 12, MAT['exhaust'], coll, r_in=10)
    tag(exh, M, '排气管（膨胀室的入口段）', 'pipe')
    T2['flows'] = dict(
        intake=path_pts([tuple(cp(10, 92)), tuple(cp(10, 64)), tuple(cp(10, 44)), tuple(cp(-6, 26)), (0, 0, 20), (-20, 0, -10)], 24),
        transfer=path_pts([(0, -28, -30), (20, -26, 0), tuple(cp(40, 2, -24)), tuple(cp(s_tr - 6, 4, -23)), tuple(cp(s_tr - 2, 10, -12)),
                           tuple(cp(T2_DECK - 6, 6, -2))], 24)
        + [],
        transfer2=path_pts([(0, 28, -30), (20, 26, 0), tuple(cp(40, 2, 24)), tuple(cp(s_tr - 6, 4, 23)), tuple(cp(s_tr - 2, 10, 12)),
                            tuple(cp(T2_DECK - 6, 6, 2))], 24),
        exhaust=path_pts([tuple(cp(T2_DECK - 8, 6, 0)), tuple(cp(s_ex - 10, -8)), tuple(cp(s_ex - 8, -22))] + exp_pts[1:], 30),
        short=path_pts([tuple(cp(s_tr - 4, 6, 18)), tuple(cp(s_tr - 6, -4, 6)), tuple(cp(s_ex - 8, -20))] + exp_pts[1:3], 20),
    )
    return coll


# ================================================================ EH 轮毂电机
EH = {}


def build_EH():
    M = 'EH'
    coll = collection('EH 轮毂电机')
    C = Vector((0, 0, 0))
    rim, tire = wheel(M, coll, (0, 0, 0), rim_r=150, tire_R=232, width=96, rim_w=70, spokes=0, name='Wheel', hub=False)
    # 轮辋和外转子之间的辐板
    web_ = lathe('rweb', [(112, -6), (146, -6), (146, 6), (112, 6)], MAT['alu'], coll, seg=96)
    rim = join([rim, web_], f'{M}_WheelRim')
    for o in (rim, tire):
        set_origin(o, (0, 0, 0))
    tag(rim, M, '轮辋（和外转子一体）', 'rotW', ex=(0, -40, 0))
    tag(tire, M, '轮胎', 'rotW', ex=(0, -40, 0))
    # 外转子：轭铁圈 + 两侧端盖 + 28 块磁铁
    rot = [lathe('yoke', [(104, -36), (112, -36), (112, 36), (104, 36)], MAT['steel'], coll, seg=112)]
    rot.append(lathe('capR', [(16, -38), (114, -38), (114, -36), (16, -36)], MAT['alu'], coll, seg=112))
    for k in range(28):
        a = TAU * k / 28
        rot.append(lathe(f'm{k}', [(98.5, -32), (104.2, -32), (104.2, 32), (98.5, 32)], MAT['magN'] if k % 2 == 0 else MAT['magS'], coll,
                         seg=4, phi0=a - TAU / 56 * .86, arc=TAU / 28 * .86))
    rotor = join(rot, f'{M}_Rotor')
    set_origin(rotor, (0, 0, 0))
    tag(rotor, M, '外转子（轭铁 + 28 块磁铁）', 'rotW', ex=(0, -30, 0))
    capL = lathe(f'{M}_CapL', [(16, 36), (114, 36), (114, 38.5), (16, 38.5)], MAT['alu'], coll, seg=112)
    disc = lathe('disc', [(70, -48), (112, -48), (112, -44), (70, -44)], MAT['chrome'], coll, seg=96)
    capL = join([capL, disc], f'{M}_CapL')
    set_origin(capL, (0, 0, 0))
    tag(capL, M, '端盖 + 刹车盘', 'rotW', ghost=True, ex=(0, 120, 0))
    # 定子：铁芯 24 齿 + 线圈，固定在轴上
    st = [lathe('core', [(20, -30), (66, -30), (66, 30), (20, 30)], MAT['lam'], coll, seg=72)]
    coils = []
    for k in range(24):
        a = TAU * k / 24
        u = Vector((cos(a), 0, sin(a)))
        t_ = u.cross(YV)
        st.append(box(f't{k}', tuple(u * 80), (30, 60, 9), MAT['lam'], coll, rot=(tuple(u), (0, 1, 0), tuple(t_))))
        st.append(box(f's{k}', tuple(u * 95), (3.5, 60, 21), MAT['lam'], coll, rot=(tuple(u), (0, 1, 0), tuple(t_))))
        coils.append(box(f'c{k}', tuple(u * 80), (22, 66, 15), MAT['copper'], coll, rot=(tuple(u), (0, 1, 0), tuple(t_)), bevel=2.5))
    stator = join(st, f'{M}_Stator')
    tag(stator, M, '定子铁芯（固定在轴上，不转）', 'static', ex=(0, 60, 0))
    coil = join(coils, f'{M}_Coils')
    tag(coil, M, '定子线圈（三相）', 'coil', ex=(0, 60, 0))
    EH['coils'] = 24
    ax = cyl(f'{M}_Axle', 10, -80, 90, MAT['steel'], coll, frame=FY)
    tag(ax, M, '轴（固定，电线从轴里出来）', 'static')
    arm = join([box('arm', (220, 70, 20), (420, 26, 50), MAT['frame'], coll, bevel=8),
                cyl('arme', 24, 56, 84, MAT['frame'], coll, frame=FY),
                tube('cab', [(0, 86, 0), (30, 92, 40), (200, 92, 60), (420, 92, 90)], 5, MAT['magN'], coll)], f'{M}_Arm')
    tag(arm, M, '摆臂 + 电机线（三相线 + 霍尔信号）', 'static', ex=(0, 60, 0))
    ctl = box(f'{M}_Controller', (420, 0, 120), (120, 90, 50), MAT['pcu'], coll, bevel=6)
    tag(ctl, M, '控制器（逆变器）', 'static', ex=(0, 0, 60))
    bat = box(f'{M}_Battery', (430, 0, 260), (230, 150, 120), MAT['battery'], coll, bevel=10)
    tag(bat, M, '电池', 'static', ex=(0, 0, 90))
    EH['flowPw'] = path_pts([(430, 0, 200), (420, 0, 145), (420, 92, 90), (200, 92, 60), (30, 92, 40), (0, 86, 0)], 30)
    return coll


# ================================================================ EM 摆臂电机 + 齿轮减速
EM = {}
EM_AXL = Vector((-340.0, 0, 0))
EM_CNT = Vector((-170.0, 0, -30.0))
EM_ZG = (14, 52, 13, 40)


def build_EM():
    M = 'EM'
    coll = collection('EM 摆臂电机')
    # 电机（内转子永磁）在摆臂前端，轴线 Y
    hous = lathe(f'{M}_MotorHousing', [(20, -50), (92, -50), (96, -46), (96, 40), (20, 40)], MAT['motor'], coll, seg=96)
    boolean(hous, [cyl('hi', 88, -44, 46, None, coll, frame=FY), cyl('hs', 12, -60, 60, None, coll, frame=FY)])
    tag(hous, M, '电机壳（水冷 / 风冷看车型）', 'case', ghost=True, ex=(0, -100, 0))
    st = [lathe('st', [(66, -36), (86, -36), (86, 36), (66, 36)], MAT['lam'], coll, seg=96)]
    coils = []
    for k in range(18):
        a = TAU * k / 18
        u = Vector((cos(a), 0, sin(a)))
        t_ = u.cross(YV)
        st.append(box(f't{k}', tuple(u * 57), (20, 72, 7), MAT['lam'], coll, rot=(tuple(u), (0, 1, 0), tuple(t_))))
        st.append(box(f's{k}', tuple(u * 47.5), (3, 72, 15), MAT['lam'], coll, rot=(tuple(u), (0, 1, 0), tuple(t_))))
        coils.append(box(f'c{k}', tuple(u * 58), (15, 80, 12), MAT['copper'], coll, rot=(tuple(u), (0, 1, 0), tuple(t_)), bevel=2))
    stator = join(st, f'{M}_Stator')
    tag(stator, M, '定子（外圈，固定）', 'static', ex=(0, -60, 0))
    coil = join(coils, f'{M}_Coils')
    tag(coil, M, '定子线圈（三相）', 'coil', ex=(0, -60, 0))
    rr = [lathe('rc', [(12, -34), (44, -34), (44, 34), (12, 34)], MAT['lam'], coll, seg=72)]
    for k in range(8):
        a = TAU * k / 8
        rr.append(lathe(f'rm{k}', [(39, -32), (44.5, -32), (44.5, 32), (39, 32)], MAT['magN'] if k % 2 == 0 else MAT['magS'], coll, seg=6,
                        phi0=a - TAU / 16 * .84, arc=TAU / 8 * .84))
    rr.append(cyl('rs', 12, -46, 70, MAT['steel'], coll, frame=FY))
    rr.append(gear('p1', EM_ZG[0], 2.0, 50, 62, MAT['steel'], coll))
    rotor = join(rr, f'{M}_Rotor')
    set_origin(rotor, (0, 0, 0))
    tag(rotor, M, '转子（内转子，8 极磁铁）+ 第一级小齿轮', 'rotM', ex=(0, -30, 0))
    g2 = gear('g2', EM_ZG[1], 2.0, 50, 62, MAT['steelD'], coll, center=tuple(EM_CNT))
    g3 = gear('g3', EM_ZG[2], 2.4, 36, 49, MAT['steel'], coll, center=tuple(EM_CNT))
    cs = cyl('cs', 9, 30, 68, MAT['steel'], coll, frame=Frame3(EM_CNT))
    cnt = join([g2, g3, cs], f'{M}_Counter')
    set_origin(cnt, tuple(EM_CNT))
    tag(cnt, M, '中间轴', 'rotCnt', ex=(0, 70, 0))
    g4 = gear('g4', EM_ZG[3], 2.4, 36, 49, MAT['steelD'], coll, center=tuple(EM_AXL))
    ax = cyl('ax', 12, -46, 60, MAT['steel'], coll, frame=Frame3(EM_AXL))
    g4 = join([g4, ax], f'{M}_AxleGear')
    set_origin(g4, tuple(EM_AXL))
    tag(g4, M, '后轴大齿轮', 'rotW', ex=(0, 70, 0))
    # 摆臂齿轮箱（左边），把电机和后轴连成一个摆动单元
    out = stadium_outline((0, 0), 100, (EM_AXL.x, EM_AXL.z), 62)
    case = extrude_outline(f'{M}_GearCase', out, 26, 74, MAT['cast'], coll)
    inn = extrude_outline('gi', offset_outline(out, 5), 31, 69, None, coll)
    boolean(case, [inn, cyl('gh', 12, 0, 100, None, coll, frame=FY)])
    tag(case, M, '摆臂兼齿轮箱', 'case', ghost=True, ex=(0, 120, 0))
    piv = Vector((150, 0, 40))
    lug = join([box('lg', (100, 0, 30), (100, 80, 40), MAT['cast'], coll, bevel=6), cyl('pv', 16, -45, 45, MAT['cast'], coll, frame=Frame3(piv))], f'{M}_Lug')
    tag(lug, M, '摆动轴支座', 'static')
    rim, tire = wheel(M, coll, (EM_AXL.x, -8, EM_AXL.z))
    for o in (rim, tire):
        set_origin(o, (EM_AXL.x, 0, EM_AXL.z))
    tag(rim, M, '后轮轮辋', 'rotW', ex=(0, -60, 0))
    tag(tire, M, '后轮轮胎', 'rotW', ex=(0, -60, 0))
    pcu = box(f'{M}_PCU', (40, -20, 170), (110, 80, 44), MAT['pcu'], coll, bevel=6)
    tag(pcu, M, '电力控制单元 PCU', 'static', ex=(0, 0, 50))
    bats = []
    for k, x in enumerate((-190, -40)):
        b = box(f'{M}_Battery{k}', (x, 0, 300), (120, 175, 165), MAT['battery'], coll, bevel=10)
        hd = box(f'bh{k}', (x, 0, 392), (60, 24, 20), MAT['steelD'], coll, bevel=4)
        b = join([b, hd], f'{M}_Battery{k}')
        tag(b, M, f'可换电池 {k + 1}（拎走充电）', 'battery', ex=(0, 0, 160))
        bats.append(b)
    cab = tube(f'{M}_Cable', [(-190, 60, 220), (-40, 60, 220), (40, 30, 170), (60, 40, 110), (20, -60, 40)], 4, MAT['magN'], coll)
    tag(cab, M, '高压线束', 'static')
    EM['flowPw'] = path_pts([(-190, 0, 220), (-190, 60, 220), (-40, 60, 220), (40, 30, 170), (60, 40, 110), (20, -60, 40)], 34)
    return coll


# ================================================================ 汇总 / 导出
def shift_model(coll, off):
    o = Vector(off)
    for ob in coll.objects:
        ob.location = ob.location + o


def scale_all():
    for ob in bpy.data.objects:
        if ob.type == 'MESH':
            ob.data.transform(Matrix.Scale(MM, 4))
        ob.location = ob.location * MM


def V(p, off=(0, 0, 0)):
    return [round(float(p[0]) + off[0], 3), round(float(p[1]) + off[1], 3), round(float(p[2]) + off[2], 3)]


def write_spec():
    o4, o2, oh, om = OFFSET['U4'], OFFSET['T2'], OFFSET['EH'], OFFSET['EM']
    spec = {'offset': OFFSET, 'ground': GROUND, 'models': {}}
    # ---- U4
    seat_in, seat_ex = Vector(U4['seat_in']), Vector(U4['seat_ex'])
    v_in, v_ex = Vector(U4['v_in']), Vector(U4['v_ex'])
    pins = [
        ['气缸', cylpt(110, 52)], ['缸盖', cylpt(195, 50)], ['曲轴箱', (-20, -40, -80)], ['火花塞', cylpt(DECK + 6, 0, 8) + (D_CYL * .35 + YV).normalized() * 64],
        ['节气门体', (70, 30, 160)], ['空滤箱', (-225, 115, 195)], ['排气管', (120, -70, -130)], ['消声器', (-300, -140, 15)],
        ['ACG（发电兼起动）', (0, -116, 60)], ['CVT 箱', (-130, 200, 60)], ['后轮', (-350, -8, 255)], ['摆动轴', tuple(PIVOT + Vector((0, 70, 0)))],
        ['后减震', (-305, 175, 220)], ['齿轮箱', (-300, 40, -70)],
    ]
    pins_eng = [
        ['活塞', cylpt(118, 0, 0)], ['连杆', cylpt(70, 0, 0)], ['曲轴', (0, 0, -40)], ['进气门', seat_in + v_in * 40],
        ['排气门', seat_ex + v_ex * 40], ['凸轮轴', cylpt(CAM_S, 0, 0)], ['摇臂', cylpt(244, 32, 0)], ['燃烧室', cylpt(DECK + 6, 0, 0)],
        ['进气道', cylpt(178, 50)], ['排气道', cylpt(176, -50)], ['火花塞', cylpt(DECK + 26, 0, 30)], ['正时链', (40, -45, -18)],
    ]
    pins_cvt = [
        ['主动轮定盘', (0, 140, 66)], ['动盘', (0, 98, -66)], ['离心滚子', (34, 74, 0)], ['斜坡板', (0, 62, 50)], ['皮带', (-130, 112, 76)],
        ['从动轮', (DRV.x, 108, DRV.z + 84)], ['扭力凸轮', (DRV.x + 28, 136, DRV.z)], ['弹簧', (DRV.x - 40, 150, DRV.z - 22)],
        ['离合块', (DRV.x, 176, DRV.z - 56)], ['离合器外鼓', (DRV.x - 72, 182, DRV.z + 10)],
    ]
    views = {
        'home': dict(pos=V((420, 1500, 420)), tgt=V((-120, 30, 20))),
        'side': dict(pos=V((-80, 1650, 120)), tgt=V((-120, 30, 20))),
        'eng': dict(pos=V((240, 640, 150)), tgt=V((110, 0, 40))),
        'head': dict(pos=V((330, 420, 150)), tgt=V((190, 0, 40))),
        'cvt': dict(pos=V((-90, 760, 120)), tgt=V((-130, 120, 6))),
        'clutch': dict(pos=V((-150, 640, 150)), tgt=V((-262, 160, 14))),
        'pulley': dict(pos=V((-120, 300, 820)), tgt=V((-130, 112, 0))),
        'ecvt': dict(pos=V((330, 430, 360)), tgt=V((30, 90, 50))),
        'drive': dict(pos=V((140, 420, 120)), tgt=V((0, 100, 0))),
        'gear': dict(pos=V((-220, -560, 120)), tgt=V((-300, 30, -10))),
        'acg': dict(pos=V((180, -560, 140)), tgt=V((0, -80, 0))),
        'swing': dict(pos=V((-40, 1700, 260)), tgt=V((-100, 30, 0))),
        'hyb': dict(pos=V((420, -1100, 620)), tgt=V((-80, -20, 80))),
    }
    nrm = Vector((DRV.z, 0, -DRV.x)).normalized()       # 同时含两根皮带轮轴的平面的法线（朝上）
    cuts = {'eng': dict(cn='沿气缸中心剖开', p=V((0, 0, 0)), n=[0, 1, 0]),
            'pulley': dict(cn='沿两根皮带轮轴剖开', p=V((0, 0, 0)), n=[round(nrm.x, 4), 0, round(nrm.z, 4)]),
            'clutch': dict(cn='剖开离合器外鼓', p=V((DRV.x, 171, DRV.z)), n=[0, 1, 0]),
            'acg': dict(cn='剖开发电机', p=V((0, -80, 0)), n=[0, -1, 0])}
    hybp = U4['hybFlow']
    spec['models']['U4'] = dict(
        offset=o4, views=views, cuts=cuts,
        pins=[dict(t=t, p=V(p, o4)) for t, p in pins], pinsEng=[dict(t=t, p=V(p, o4)) for t, p in pins_eng],
        pinsCvt=[dict(t=t, p=V(p, o4)) for t, p in pins_cvt],
        flows=dict(intake=[dict(p=[V(p, o4) for p in U4['intake']])], exhaust=[dict(p=[V(p, o4) for p in U4['exhaust']])],
                   chain=[dict(p=[V(p, o4) for p in U4['chain']])], hyb=[dict(p=[V(p, o4) for p in hybp])]),
        kin=dict(
            crank=V((0, 0, 0), o4), dCyl=list(D_CYL), nUp=list(N_UP), r=CR, L=CL, bore=BORE, pinH=PIN_H, deck=DECK, dome=DOME,
            chargeLen=DECK - (CR + CL + PIN_H - 2 * CR), camC=V(U4['cam_c'], o4), timing=TIMING,
            vIn=U4['v_in'], vEx=U4['v_ex'], pivIn=V(U4['piv_in'], o4), pivEx=V(U4['piv_ex'], o4), tipIn=V(U4['tip_in'], o4), tipEx=V(U4['tip_ex'], o4),
            springBase=U4['spring_base'], springLen=24.0,
            tanB=TANB, wP=W_P, ycd=YCD, ycn=YCN, r1lo=R1_LO, r1hi=R1_HI, r2lo=R2_LO, r2hi=R2_HI, beltL=BELT_L,
            drv=V(DRV, o4), cnt=V(CNT, o4), axl=V(AXL, o4), pivot=V(PIVOT, o4), zg=list(Z_G), deltaMax=DELTA_MAX, epsMax=EPS_MAX,
            rollers=U4['rollers'], rollRho0=ROLL_RHO0, rollKw=ROLL_KW, rollN=ROLL_N, shoes=[V(p, o4) for p in U4['shoes']], shoeEnds=[V(p, o4) for p in U4['shoeEnds']],
            springY=U4['springY'], shock=[V(p, o4) for p in U4['shock']], shockL=U4['shockL'], wheelR=242.0,
            ecvtMotor=V(U4['ecvt']['motor'], o4), ecvtIdler=V(U4['ecvt']['idler'], o4), starterGear=V(U4['starter'], o4), starterMotor=V(U4['starterM'], o4),
            plugBase=V(cylpt(DECK + 6, 0, 8), o4),
        ),
    )
    # ---- T2
    cp = lambda s, u=0.0, y=0.0: D_CYL * s + N_UP * u + YV * y
    spec['models']['T2'] = dict(
        offset=o2,
        views={'home': dict(pos=V((260, 620, 140), o2), tgt=V((40, 0, 10), o2)), 'cut': dict(pos=V((150, 470, 60), o2), tgt=V((50, 0, 10), o2)),
               'ports': dict(pos=V((300, 300, -60), o2), tgt=V((80, 0, 0), o2))},
        cuts={'mid': dict(cn='沿气缸中心剖开', p=V((0, 0, 0), o2), n=[0, 1, 0])},
        pins=[dict(t=t, p=V(p, o2)) for t, p in [
            ['活塞', cp(84, 0, 0)], ['曲轴箱', (0, 0, -52)], ['簧片阀', cp(10, 60)], ['化油器', cp(10, 86)], ['排气口', cp(T2['s_ex'] - 6, -30)],
            ['扫气口', cp(T2['s_tr'] - 4, 12)], ['火花塞', cp(T2_DECK + 40)], ['排气管', (-90, 0, -138)], ['曲轴', (0, 0, 28)], ['燃烧室', cp(T2_DECK + 4)]]],
        flows={k: [dict(p=[V(p, o2) for p in v])] for k, v in T2['flows'].items()},
        kin=dict(crank=V((0, 0, 0), o2), dCyl=list(D_CYL), nUp=list(N_UP), r=T2R, L=T2L, bore=T2B, pinH=T2PH, deck=T2_DECK,
                 chargeLen=T2_DECK - T2['s_bdc'], sEx=T2['s_ex'], sTr=T2['s_tr'], sBdc=T2['s_bdc'], eo=T2_EO, to=T2_TO,
                 reeds=[V(p, o2) for p in T2['reeds']]),
    )
    # ---- EH
    spec['models']['EH'] = dict(
        offset=oh,
        views={'home': dict(pos=V((520, 900, 260), oh), tgt=V((80, 0, 40), oh)), 'cut': dict(pos=V((90, 560, 80), oh), tgt=V((0, 0, 0), oh))},
        cuts={'mid': dict(cn='垂直车轴剖开', p=V((0, 6, 0), oh), n=[0, 1, 0])},
        pins=[dict(t=t, p=V(p, oh)) for t, p in [
            ['外转子 + 磁铁', (0, 0, 108)], ['定子线圈', (-70, 0, 26)], ['轴（不转）', (0, 0, -14)], ['轮胎', (160, 0, 175)],
            ['控制器', (420, 0, 152)], ['电池', (430, 0, 330)], ['摆臂', (300, 70, 52)]]],
        flows={'pw': [dict(p=[V(p, oh) for p in EH['flowPw']])]},
        kin=dict(axle=V((0, 0, 0), oh), coils=24, poles=28, wheelR=232.0),
    )
    # ---- EM
    spec['models']['EM'] = dict(
        offset=om,
        views={'home': dict(pos=V((300, 1350, 420), om), tgt=V((-120, 20, 80), om)), 'cut': dict(pos=V((80, -560, 90), om), tgt=V((-40, 0, 0), om)),
               'gear': dict(pos=V((-140, 720, 120), om), tgt=V((-170, 40, -10), om))},
        cuts={'mid': dict(cn='垂直电机轴剖开', p=V((0, -4, 0), om), n=[0, -1, 0])},
        pins=[dict(t=t, p=V(p, om)) for t, p in [
            ['电机', (0, -60, 100)], ['齿轮减速', (-170, 80, 40)], ['可换电池', (-115, 0, 410)], ['PCU', (40, -20, 200)], ['后轮', (-340, -8, 255)]]],
        flows={'pw': [dict(p=[V(p, om) for p in EM['flowPw']])]},
        kin=dict(motor=V((0, 0, 0), om), cnt=V(EM_CNT, om), axl=V(EM_AXL, om), zg=list(EM_ZG), coils=18, poles=8, wheelR=242.0),
    )
    with open(os.path.join(OUT, 'spec.json'), 'w', encoding='utf-8') as f:
        json.dump(spec, f, ensure_ascii=False, indent=1)
    print('spec ok')


def export():
    # 渲染专用的物体不导出；没打标签的网格（建模时的残留）报出来、也不导出
    stray = [ob.name for ob in bpy.data.objects if ob.type == 'MESH' and not ob.get('m') and ob.name != 'Ground']
    if stray:
        print('WARNING untagged meshes (not exported):', stray)
    for ob in bpy.data.objects:
        ob.select_set(ob.type in ('MESH', 'EMPTY') and ob.get('role') != 'renderonly' and bool(ob.get('m')))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'scooter.glb'), export_format='GLB', use_selection=True,
                              export_extras=True, export_apply=False, export_yup=True, export_cameras=False, export_lights=False,
                              export_animations=False, export_draco_mesh_compression_enable=False)
    print('glb', os.path.getsize(os.path.join(OUT, 'scooter.glb')) / 1e6, 'MB')


# ================================================================ 渲染（Cycles）
def setup_render():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = ARGS.samples
    try:
        sc.cycles.use_denoising = True
    except Exception:
        pass
    sc.render.resolution_x = ARGS.res
    sc.render.resolution_y = int(ARGS.res * 0.62)
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 88
    w = bpy.data.worlds.new('W')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (*hexcol('#0d1a2e'), 1)
    bg.inputs[1].default_value = 0.9
    for nm, loc, en, sz in (('key', (-1.6, 2.2, 2.6), 900, 2.5), ('fill', (2.2, -1.5, 1.4), 380, 3.0), ('rim', (0.5, -2.5, 2.2), 420, 2.0)):
        ld = bpy.data.lights.new(nm, 'AREA')
        ld.energy = en
        ld.size = sz
        lo = bpy.data.objects.new(nm, ld)
        sc.collection.objects.link(lo)
        lo.location = loc
        d = Vector((0, 0, 0)) - Vector(loc)
        lo.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    gm = principled('Ground', '#14243a', rough=.9)
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, GROUND * MM))
    g = bpy.context.object
    g.data.materials.append(gm)
    g.name = 'Ground'
    g['role'] = 'renderonly'


def render_view(name, pos, tgt, hide=(), show_only=None, lens=50):
    sc = bpy.context.scene
    cam = bpy.data.objects.get('Cam')
    if cam is None:
        cd = bpy.data.cameras.new('Cam')
        cam = bpy.data.objects.new('Cam', cd)
        sc.collection.objects.link(cam)
        sc.camera = cam
    cam.data.lens = lens
    cam.location = Vector(pos) * MM
    d = Vector(tgt) * MM - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    for ob in bpy.data.objects:
        if ob.type != 'MESH':
            continue
        h = False
        if show_only and ob.get('m') not in show_only and ob.name != 'Ground':
            h = True
        if any(ob.name.startswith(p) or ob.get('var') == p for p in hide):
            h = True
        if ob.get('var') in ('ecvt', 'conv', 'hyb') and ob.get('var') not in show_only_vars:
            h = True
        ob.hide_render = h
    sc.render.filepath = os.path.join(OUT, f'view_{name}.jpg')
    bpy.ops.render.render(write_still=True)
    print('rendered', name)


show_only_vars = ()


def main():
    global show_only_vars
    reset()
    make_materials()
    cU = build_U4()
    c2 = build_T2()
    shift_model(c2, OFFSET['T2'])
    ch = build_EH()
    shift_model(ch, OFFSET['EH'])
    cm = build_EM()
    shift_model(cm, OFFSET['EM'])
    # 变体零件和渲染专用零件默认在视图里藏起来
    for ob in bpy.data.objects:
        if ob.get('var') in ('ecvt', 'conv', 'hyb'):
            ob.hide_viewport = False
    write_spec()
    scale_all()
    export()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'scooter.blend'))
    if ARGS.render:
        setup_render()
        only = ARGS.only.split(',') if ARGS.only else None
        jobs = [
            ('U4', dict(pos=(520, 1500, 520), tgt=(-120, 30, 0), show_only=('U4',), hide=('U4_Frame',), lens=45)),
            ('U4_open', dict(pos=(-60, 1100, 260), tgt=(-130, 100, 0), show_only=('U4',), hide=('U4_CVTCover', 'U4_Frame', 'U4_AirBox'), lens=45)),
            ('U4_engine', dict(pos=(330, -760, 260), tgt=(80, 0, 30), show_only=('U4',), hide=('U4_FanCover', 'U4_Frame', 'U4_Muffler'), lens=50)),
            ('T2', dict(pos=(260 + 820, 620, 140), tgt=(40 + 820, 0, 10), show_only=('T2',), lens=50)),
            ('EH', dict(pos=(-1250 + 700, 1250, 420), tgt=(-1250 + 160, 0, 60), show_only=('EH',), hide=('EH_CapL',), lens=45)),
            ('EM', dict(pos=(-2150 + 300, 1350, 420), tgt=(-2150 - 120, 20, 80), show_only=('EM',), hide=('EM_GearCase',), lens=45)),
        ]
        for nm, kw in jobs:
            if only and nm not in only:
                continue
            render_view(nm, **kw)


main()
