#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
汽车模拟器 · 车身（Blender 纯脚本建模，虚构教学车，不对应任何具体产品）

一辆直线造型的老式三厢车：平的前盖和尾箱盖、立着的车头车尾、一条贯穿的肩线。
外形在 shape.py（五条沿车长的线 + “直线 + 圆角”的横截面配方），这个文件按造车顺序把它做成车：
    车框（白车身）→ 车板 → 玻璃 → 车轮 → 底盘 → 座椅和内饰
车身代码是从 软件定义汽车/blender/build_sdv.py 的车身部分起步的（去掉了电动车的盒子和线束），
硬点没动：轴距 2800、前悬 945、后悬 1015、地板和座椅的位置。

运行方式（二选一）:
    blender -b -P build_car.py -- --out out [--render]
    python  build_car.py --out out [--render]      # 需要 pip install bpy

输出:
    car.blend    Blender 工程；按空格播放 = 爆炸动画（第 1 帧装配，第 121 帧拆开）
    car.glb      给网页用（零件独立命名，extras 里带分组）
    spec.json    分组、零件表、实测缝宽
    view_*.jpg   只有加 --render 时才渲染（Cycles）

坐标约定:
    尺寸按毫米写，建完缩放成米。+X 车右，+Y 车头，+Z 朝上，原点在前后轴中点的地面。
"""
import argparse
import json
import math
import os
import sys
from math import cos, pi, radians, sin, sqrt

import bpy  # 必须排在 bmesh 前面：pip 版 bpy 导入后才注册 bmesh / mathutils
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import carkit as CK  # noqa: E402  汽车建模套件的副本，母版在仓库根目录 汽车建模套件/
import shape as SH  # noqa: E402   外形：五条线 + 横截面配方（纯 Python）
import powertrain as PT  # noqa: E402  发动机、CVT、半轴、进排气、冷却、油箱（尺寸读 ../params.json）
import powertrain_ehev as PTE  # noqa: E402  第二套动力：两电机混动（--pt ehev 时建，件名以 H_ 开头）

_argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
_ap = argparse.ArgumentParser()
_ap.add_argument('--out', default=os.path.join(HERE, 'out'))
_ap.add_argument('--render', action='store_true')
_ap.add_argument('--samples', type=int, default=48)
_ap.add_argument('--res', type=int, default=1400)
_ap.add_argument('--check', default='', help='检查用的机位，逗号分隔，见 CHECK_VIEWS')
_ap.add_argument('--only', default='', help='检查图里只显示名字以这些前缀开头的件，逗号分隔（找问题件时用）')
_ap.add_argument('--skip', default='', help='跳过哪几步，逗号分隔：frame,chassis,cabin,powertrain（调外形时省时间）')
_ap.add_argument('--views', default='', help='--render 时只渲这几张，逗号分隔：exterior,exterior_rear,side,front,rear,interior,cabin,bay,powertrain,internals,chassis')
_ap.add_argument('--noexport', action='store_true', help='只建模渲图，不写 glb / blend / spec（调外形时用）')
_ap.add_argument('--pt', default='cvt', help='cvt = 燃油 + CVT（默认，导出 car.glb）；ehev = 换成两电机混动（只导出 pt_ehev.glb / spec_ehev.json / car_ehev.blend，car.glb 不动）')
ARGS, _ = _ap.parse_known_args(_argv)
OUT = os.path.abspath(ARGS.out)
os.makedirs(OUT, exist_ok=True)

MM = 0.001
FRAMES = 120
WB, R_TYRE, R_ARCH, TRACK, TYRE_HW = SH.WB, SH.R_TYRE, SH.R_ARCH, SH.TRACK, SH.TYRE_HW
Y_TAIL, Y_NOSE, NSEG = SH.Y_TAIL, SH.Y_NOSE, SH.NSEG

# ---------------------------------------------------------------- 工具
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


def principled(name, hexc, metal=0.0, rough=0.5, coat=0.0, coat_rough=0.03, emit=None, alpha=None):
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
        put(['Coat Roughness', 'Clearcoat Roughness'], coat_rough)
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
    m.metallic = metal
    m.roughness = rough
    return m


def make_materials():
    return dict(
        # 清漆层默认粗糙度 0.03 近乎镜面，会把环境里的灯箱照成一条条刺眼的白线，0.16 让高光柔一点
        paint=principled('Paint', '#26465f', metal=.55, rough=.32, coat=.8, coat_rough=.16),
        trim=principled('Trim', '#14171b', rough=.62),
        # 玻璃要能看清车里：前挡法规透光率 ≥ 70%，颜色只给一点点灰蓝（网页里用 alpha，渲图时换成 thin_glass）
        glass=principled('Glass', '#7d929e', rough=.03, alpha=.26),
        # 后排隐私玻璃（后门、后三角窗、后挡）：颜色深、透光约三成
        glasstint=principled('GlassTint', '#27313a', rough=.03, alpha=.62),
        biw=principled('BIW', '#5d646b', metal=.05, rough=.5),
        biw2=principled('BIW2', '#4a5057', metal=.05, rough=.55),
        piano=principled('PianoBlack', '#050607', rough=.3, coat=.5, coat_rough=.08),
        urethane=principled('Urethane', '#0b0b0c', rough=.7),
        seatframe=principled('SeatFrame', '#30353b', metal=.55, rough=.45),
        seam=principled('Seam', '#050608', rough=.55),
        plate=principled('Plate', '#e9ecef', rough=.5),
        tyre=principled('Tyre', '#0b0c0e', rough=.9),
        rim=principled('Rim', '#b9c1ca', metal=.92, rough=.3),
        rimdark=principled('RimDark', '#2b3036', metal=.6, rough=.42),
        disc=principled('Disc', '#8d949c', metal=.9, rough=.42),
        lamp=principled('Lamp', '#eaf3ff', metal=.1, rough=.15, emit=('#dcebff', 3.0)),
        tail=principled('TailLamp', '#a00d18', rough=.2, emit=('#ff1a2c', 2.2)),
        amber=principled('Amber', '#d9801a', rough=.2, emit=('#ff9a1f', 1.2)),
        # 动力系统
        castalu=principled('CastAlu', '#9aa3ad', metal=.8, rough=.55),
        castalu2=principled('CastAlu2', '#7d858e', metal=.8, rough=.5),
        castiron=principled('CastIron', '#4a4744', metal=.7, rough=.7),
        plastic=principled('PlasticBlack', '#17191c', rough=.6),
        rubber=principled('Rubber', '#0d0e10', rough=.85),
        pan=principled('OilPan', '#1c1e21', metal=.4, rough=.5),
        filter=principled('OilFilter', '#2c5a8a', metal=.3, rough=.45),
        exh=principled('Exhaust', '#8b8378', metal=.85, rough=.5),
        exh2=principled('Muffler', '#6f6a63', metal=.8, rough=.55),
        gear=principled('GearSteel', '#a8adb3', metal=.95, rough=.32),
        belt=principled('SteelBelt', '#3b4046', metal=.9, rough=.38),
        spring=principled('Spring', '#3a6fa8', metal=.6, rough=.4),
        tank=principled('FuelTank', '#23262a', rough=.75),
        coolant=principled('Coolant', '#d9e2e6', rough=.4),
        battery=principled('Battery', '#20242a', rough=.5),
        fabric=principled('Fabric', '#3a4048', rough=.9),
        fabric2=principled('Fabric2', '#2a2f36', rough=.92),
        dash=principled('Dash', '#22262c', rough=.65),
        # 内饰：浅灰皮座椅 + 深浅拼色，仪表台上深下浅，中间一条木纹饰板（2025 年常见的配色）
        leather=principled('Leather', '#8f949b', rough=.55),
        leather2=principled('LeatherInsert', '#5b6169', rough=.75),
        softdark=principled('SoftDark', '#1a1d21', rough=.72),
        softlight=principled('SoftLight', '#a6aaaf', rough=.7),
        woodtrim=principled('WoodTrim', '#7a5a3c', rough=.42, coat=.3, coat_rough=.2),
        carpet=principled('Carpet', '#17191c', rough=.95),
        headliner=principled('Headliner', '#b4b8bc', rough=.92),
        ambient=principled('Ambient', '#9fe8ff', rough=.4, emit=('#7fd8ff', 2.0)),
        screen=principled('Screen', '#0f2233', metal=.1, rough=.2, emit=('#2f7fb0', 1.2)),
        steel=principled('Steel', '#6c7680', metal=.8, rough=.45),
        susp=principled('Suspension', '#24282d', metal=.35, rough=.55),   # 副车架、摆臂、减震：电泳黑
        mirror=principled('MirrorGlass', '#c9d2d8', metal=1.0, rough=.03),
        alu=principled('Alu', '#a3acb6', metal=.85, rough=.38),
        pack=principled('Pack', '#39424c', metal=.5, rough=.52),
        cell=principled('Cell', '#1d6f8c', metal=.3, rough=.45),
        hv=principled('HV', '#ff7a1a', rough=.55),
        ecu=principled('ECU', '#8e99a6', metal=.55, rough=.45),
        conn=principled('Conn', '#1a1d21', rough=.7),
        pcb=principled('PCB', '#135c47', rough=.55),
        chip=principled('Chip', '#1b1e23', rough=.62),
        gold=principled('Gold', '#c9a24a', metal=.9, rough=.35),
        sink=principled('Sink', '#b6bfc9', metal=.85, rough=.4),
        ep=principled('Endpoint', '#7f8b98', metal=.3, rough=.5),
        sig=principled('WireSig', '#ff9d3c', rough=.5),
        bus=principled('WireBus', '#ffd166', rough=.5),
        eth=principled('WireEth', '#4cc9f0', rough=.4, emit=('#4cc9f0', .4)),
        pwr=principled('WirePwr', '#ff5a5f', rough=.5),
    )


def shade(me, ang):
    try:
        me.shade_smooth()
    except AttributeError:
        for p in me.polygons:
            p.use_smooth = True
    if hasattr(me, 'set_sharp_from_angle'):
        me.set_sharp_from_angle(angle=radians(ang))


OBJS = []
GROUPS = {}
EX = {}


def grp(key, cn, ex=(0, 0, 0, 0)):
    GROUPS[key] = dict(cn=cn)
    EX[key] = ex
    return key


def add(name, bm, mats, group, loc=(0, 0, 0), ang=34, coll='Car', extras=None):
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
    cn = me.attributes.get('cn')
    if cn is not None:
        # 车板：carkit 在每个点存了曲面的解析法线，设成自定义法线，三角形再乱也不会花；
        # 面的平滑 / 硬边标记沿用 bmesh 里的（折边是硬边）
        vals = [0.0] * (3 * len(me.vertices))
        cn.data.foreach_get('vector', vals)
        me.attributes.remove(cn)
        if hasattr(me, 'set_sharp_from_angle'):
            me.set_sharp_from_angle(angle=radians(ang))
        me.normals_split_custom_set_from_vertices([vals[i:i + 3] for i in range(0, len(vals), 3)])
    else:
        shade(me, ang)
    ob.location = Vector(loc) * MM
    ob['group'] = group
    for k, v in (extras or {}).items():
        ob[k] = v
    OBJS.append((ob, group))
    return ob


def rbox(bm, c, s, r=8, mi=0, seg=2, rot=None):
    """圆角盒。c 中心，s 全尺寸。rot=(轴, 角度)"""
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
    if rot:
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(radians(rot[1]), 3, rot[0]))
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


def lathe(bm, prof, c, axis='X', seg=48, mi=0, closed=False):
    """绕轴回转。prof = [(半径, 轴向偏移)...]，开口轮廓，两端半径为 0 处自动收口"""
    rings = []
    for (r, a) in prof:
        ring = []
        if r < 1e-6:
            # 半径为 0 的一圈只放一个点、连成三角扇。原来放 seg 个重合点再封一个零面积的盖，
            # recalc_face_normals 判断不了朝向，轮毂盘面整片朝里，网页里会发灰
            p = (c[0] + a, c[1], c[2]) if axis == 'X' else (c[0], c[1] + a, c[2]) if axis == 'Y' else (c[0], c[1], c[2] + a)
            rings.append([bm.verts.new(p)] * seg)
            continue
        for k in range(seg):
            t = 2 * pi * k / seg
            u, v = r * cos(t), r * sin(t)
            if axis == 'X':
                p = (c[0] + a, c[1] + u, c[2] + v)
            elif axis == 'Y':
                p = (c[0] + u, c[1] + a, c[2] + v)
            else:
                p = (c[0] + u, c[1] + v, c[2] + a)
            ring.append(bm.verts.new(p))
        rings.append(ring)
    fs = []
    pairs = [(rings[i], rings[i + 1]) for i in range(len(rings) - 1)]
    if closed:
        pairs.append((rings[-1], rings[0]))
    for a, b in pairs:
        for k in range(seg):
            q = []
            for v in (a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]):
                if v not in q:
                    q.append(v)
            if len(q) < 3:
                continue
            f = bm.faces.new(q)
            f.material_index = mi
            f.smooth = True
            fs.append(f)
    if not closed:
        for ring in (rings[0], rings[-1]):
            if ring[0] is ring[1]:
                continue
            f = bm.faces.new(ring)
            f.material_index = mi
            fs.append(f)
    # 回转体是封闭的：用有向体积判断朝向，体积为负就整体翻面。
    # recalc_face_normals 碰上轮毂这种盘面贴着轴线的形状会猜反，盘面整片朝里
    for f in fs:
        f.normal_update()
    o = sum((f.calc_center_median() for f in fs), Vector()) / len(fs)
    vol = sum((f.calc_center_median() - o).dot(f.normal) * f.calc_area() for f in fs)
    if vol < 0:
        bmesh.ops.reverse_faces(bm, faces=fs)
    return fs


def densify(poly, step=30, closed=True):
    out = []
    n = len(poly)
    for i in range(n if closed else n - 1):
        a, b = poly[i], poly[(i + 1) % n]
        L = math.hypot(a[0] - b[0], (a[1] - b[1]) * 150)
        k = max(1, int(L / step))
        for j in range(k):
            t = j / k
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    if not closed:
        out.append(poly[-1])
    return out



def ribbon(bm, line, w, mi, off=1.2, mirror=True):
    """沿 (y, s) 折线的一条细缝"""
    Ld = densify(line, step=10, closed=False)
    P = [SKIN.p(y, s) for y, s in Ld]
    N = [SKIN.n(y, s) for y, s in Ld]
    for side in ((1, -1) if mirror else (1,)):
        prev = None
        for i, p in enumerate(P):
            t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)])
            if t.length < 1e-6:
                continue
            t.normalize()
            b = t.cross(N[i]).normalized() * (w / 2)
            q = p + N[i] * off
            a1 = Vector((side * (q + b).x, (q + b).y, (q + b).z))
            a2 = Vector((side * (q - b).x, (q - b).y, (q - b).z))
            v = (bm.verts.new(a1), bm.verts.new(a2))
            if prev:
                f = bm.faces.new((prev[0], prev[1], v[1], v[0]))
                f.material_index = mi
            prev = v




# ================================================================ 车身：按造车顺序
# 0 外皮基准面 = shape.section_ctrl 定义的那张曲面（“直线 + 圆角”截面）
# 1 布置：缝线、窗洞、柱子、车框走向，全部用曲面参数 (y, s) 写；s 是截面控制点序号：
#   1 底板边 · 3 门槛下角 · 5 防擦条那道棱 · 6 肩线 · 7 窗台 / 前盖边 · 9 车顶边那道棱（A、C 柱也是它）· 12 中线
BELT, RAIL, SILL, UB = 7.05, 9.30, 3.45, 1.0
W_EDGE = 9.16                 # 前后挡玻璃的侧边：在车顶边那道棱往里约 40 mm（A、C 柱的外表面包着这道棱）
Y_COWL, Y_HEAD, Y_BACK, Y_DECK = SH.Y_COWL, SH.Y_HEAD, SH.Y_BACK, SH.Y_DECK
Y_WS0, Y_WS1 = Y_COWL - 12, Y_HEAD + 22          # 前挡玻璃下沿 / 上沿
Y_BK0, Y_BK1 = Y_DECK + 12, Y_BACK - 22          # 后挡玻璃下沿 / 上沿
Y_HOOD0, Y_HOOD1 = Y_COWL + 25, Y_NOSE - 48      # 前盖后缘 / 前缘（前缘一直到车头立面的上棱）
Y_LID0, Y_LID1 = Y_BK0 - 8, Y_TAIL + 50          # 尾箱盖前缘 / 后缘
S_HOOD = 7.70                                    # 前盖 / 尾箱盖两边的缝：在肩线往里约 50 mm 的翼子板顶面上
Y_FASC_F, Y_FASC_R = 2150.0, -2250.0             # 车头 / 车尾端板和翼子板的分缝
Y_UNDER = 2150.0                                 # 黑色底护板的前边界（后边界是 Y_FASC_R）
# 车门的前后缝（上 → 下）。下半截绕开轮拱：轮拱是以轮心为圆心、半径 R_ARCH 的圆
Y_DF = 1118.0                                    # 前门前缝在腰线上的位置（A 柱根后面一点）
L_DOOR_F = [(Y_DF, BELT), (1106, 6.0), (1070, 5.0), (1002, 4.15), (1000, SILL)]
L_DOOR_R = [(-1170, BELT), (-1165, 6.0), (-1150, 5.62), (-1090, 5.28), (-1022, 4.95), (-1000, 4.5), (-1000, SILL)]
L_HOOD = [(Y_HOOD0, 12), (Y_HOOD0, 8.3), (Y_HOOD0 - 4, S_HOOD + .02), (1600, S_HOOD), (2000, S_HOOD), (2270, S_HOOD),
          (Y_HOOD1 - 3, 8.3), (Y_HOOD1, 12)]
L_TRUNK = [(Y_LID0, 12), (Y_LID0, W_EDGE), (Y_LID0 - 22, S_HOOD + .02), (-2000, S_HOOD), (-2340, S_HOOD), (Y_LID1 + 3, 8.3),
           (Y_LID1, 12)]
L_FASCIA_F = [(2270, S_HOOD), (2262, 6.6), (2200, 6.0), (Y_FASC_F + 10, 5.0), (Y_FASC_F, 4.0), (Y_FASC_F, UB)]
L_FASCIA_R = [(-2340, S_HOOD), (-2332, 6.6), (-2285, 6.0), (Y_FASC_R - 10, 5.0), (Y_FASC_R, 4.0), (Y_FASC_R, UB)]
# 前挡、后挡外轮廓（两端在车顶中线上）。侧边是一条 s = W_EDGE 的线：车顶边那道棱在三维里是直的，它也就是直的
WS_POLY = ([(Y_WS0, 12), (Y_WS0, 9.7), (Y_WS0 - 3, 9.3)] + [(y, W_EDGE) for y in range(int(Y_WS0) - 14, int(Y_WS1) + 20, -40)]
           + [(Y_WS1 + 16, W_EDGE), (Y_WS1 + 3, 9.3), (Y_WS1, 9.7), (Y_WS1, 12)])
BACK_POLY = ([(Y_BK1, 12), (Y_BK1, 9.7), (Y_BK1 - 3, 9.3)] + [(y, W_EDGE) for y in range(int(Y_BK1) - 16, int(Y_BK0) + 20, -40)]
             + [(Y_BK0 + 14, W_EDGE), (Y_BK0 + 3, 9.3), (Y_BK0, 9.7), (Y_BK0, 12)])
C_LINE = [(-1170, BELT), (-860, RAIL)]        # 后门后缘（腰线 → 车顶），它后面到后挡之间是 C 柱
B_Y, DIV_Y = 60.0, -905.0                     # 两门分缝；后门玻璃分隔条（后面是固定的小三角窗）
ARCH_R, ARCH_X = R_ARCH, 640.0

SKIN = None
CH = {}
PARTS = []
GH = {}


def setup_skin():
    global SKIN
    SKIN = CK.Skin(SH.section_ctrl, NSEG, Y_TAIL, Y_NOSE, smooth_y=30.0, interp=CK.fillet_section)
    SKIN.crease_lines(SH.CREASE_NODES)
    C = CK.Chart
    # 按片展开：每片一张局部展开图，误差只在这一片里
    CH.update(
        side=C(SKIN, UB, 9.7, BELT, name='侧围'),
        roof=C(SKIN, 9.0, 12, 12, Y_BACK - 120, Y_HEAD + 120, name='车顶'),
        hood=C(SKIN, 7.0, 12, 12, 1080, Y_NOSE, name='前盖'),
        ws=C(SKIN, 8.6, 12, 12, Y_HEAD - 80, Y_COWL + 80, name='前挡'),
        back=C(SKIN, 8.6, 12, 12, Y_DECK - 80, Y_BACK + 80, name='后挡'),
        trunk=C(SKIN, 7.0, 12, 12, Y_TAIL, Y_DECK + 100, name='尾箱盖'),
        front=C(SKIN, 0, 12, 4.0, 2050, Y_NOSE, name='车头端板'),
        rear=C(SKIN, 0, 12, 4.0, Y_TAIL, -2150, name='车尾端板'),
        under=C(SKIN, 0, 1.6, 0, name='底板'),
    )


def smooth_open(chain, it=2):
    """两端在中线上的折线：只平滑中间，两端点不动（否则中线处会切出一个 V 口）"""
    return CK.chaikin(chain, it, closed=False)


def _cross_s(p, q, s0):
    t = (s0 - p[1]) / (q[1] - p[1])
    return (p[0] + (q[0] - p[0]) * t, s0)


def setup_greenhouse():
    """侧窗区：前挡 / 后挡的真实边（平滑后的那条线）+ 车门上缘 + 窗洞，全部 (y, s)。
    车身色的侧围外板（A 柱、车顶边梁、C 柱、后翼子板一整张）沿前挡边、车顶分缝、后挡边、车门上缘围起来；
    车门上半截是黑色窗框饰条，中间挖窗洞（布置方法见 carkit.greenhouse）。
    车顶边梁包着车顶边那道棱：上到车顶分缝 RAIL（棱往里约 70 mm），下到车门上缘（棱往下约 30 mm）"""
    ws = smooth_open(WS_POLY)
    k0 = min(range(len(ws)), key=lambda i: (ws[i][1], -ws[i][0]))        # 侧边最下面那个点
    side = [ws[k0]]
    for p, q in zip(ws[k0:], ws[k0 + 1:]):
        if q[1] >= RAIL:
            side.append(_cross_s(p, q, RAIL))
            break
        side.append(q)
    back = smooth_open(BACK_POLY)
    k1 = max(i for i in range(len(back)) if back[i][1] <= W_EDGE + 1e-6)  # 侧边最下面那个点
    bs = []
    for p, q in zip(back[:k1 + 1], back[1:k1 + 1]):
        if p[1] >= RAIL > q[1]:                              # 从车顶下来
            bs.append(_cross_s(p, q, RAIL))
        if q[1] < RAIL:
            bs.append(q)
    a_line = [p for p in side if p[1] <= W_EDGE + .03]
    lay = CK.greenhouse(CH['side'], BELT, a_line, RAIL, C_LINE, B_Y, div_y=DIV_Y, a_width=(74.0, 74.0), rail_width=105.0,
                        sash=20.0, bpillar=44.0, sail=110.0, r_top=26.0, r_win=(20.0, 8.0), r_div=10.0)
    # 车门上缘的 A 柱那一段顺着 A 柱往下延长，要到前挡下沿前面才碰到腰线（腰线比前挡下沿低）。
    # 真车的门到 A 柱根就结束了：在 Y_DF 处竖着切一刀，门的前上角是一小段竖边（后视镜就装在这个角上）
    def clip_y(poly, y_lim, closed=True):
        out = []
        n = len(poly)
        for i in range(n if closed else n - 1):
            p, q = poly[i], poly[(i + 1) % n]
            if p[0] <= y_lim:
                out.append(p)
            if (p[0] - y_lim) * (q[0] - y_lim) < 0:
                u = (y_lim - p[0]) / (q[0] - p[0])
                out.append((y_lim, p[1] + (q[1] - p[1]) * u))
        if not closed and poly[-1][0] <= y_lim:
            out.append(poly[-1])
        return out
    dt = clip_y(lay['door_top'], Y_DF, closed=False)
    lay['door_top'] = [(Y_DF, BELT)] + dt
    lay['sash_f'] = clip_y(lay['sash_f'], Y_DF)
    lay['win_f'] = clip_y(lay['win_f'], Y_DF - 24.0)
    GH.update(lay, ws=ws, back=back, ws_side=side, back_side=bs)
    print('[layout] 前门前上角：腰线 y = %.0f，竖边到 s = %.2f；前挡侧边最低点 y = %.0f' % (Y_DF, dt[0][1], side[0][0]))


# ---------------------------------------------------------------- 2 车框（白车身）
def build_frame(M):
    grp('frame', '车身骨架', (0, 0, 1100, 0))
    mats = [M['biw'], M['biw2']]
    bm = bmesh.new()

    def mem(line, w, h, **k):
        CK.member(bm, SKIN, line, w, h, mi=0, **k)
    # 外皮上的件：帽形截面 + 两边点焊翻边。侧围一圈写成一根（真车的侧围外板就是一整张冲出来的），
    # 截面按控制点给：门槛最粗，A 柱往上收细，C 柱往下放宽
    # 前门铰链柱（门槛往上那一段）要躲开前轮罩：轮罩半径 = 轮拱 378 + 间隙 8，柱子前面不能伸进这个圆
    # 门槛 → 前门铰链柱（躲开前轮罩：轮罩半径 = 轮拱 + 间隙 8）→ A 柱（贴着车顶边那道棱的里面）→ 车顶边梁 → C 柱 → 后翼子板上沿
    ring = [(-955, 3.6), (925, 3.6), (940, 3.95), (962, 4.4), (1010, 5.0), (1070, 5.7), (1100, 6.6), (1118, 7.5),
            (1090, 8.55), (1000, 8.9), (860, 8.95), (700, 8.97), (0, 8.97), (-600, 8.97), (-1010, 8.97),
            (-1200, 8.95), (-1380, 8.9), (-1470, 8.4), (-1540, 6.9), (-1640, 5.75), (-2280, 5.75)]
    ring_w = [140, 140, 116, 100, 100, 100, 96, 90, 80, 70, 62, 56, 58, 58, 60, 64, 76, 96, 88, 56, 56]
    ring_h = [110, 110, 106, 103, 100, 94, 88, 75, 68, 60, 55, 50, 55, 55, 56, 58, 66, 82, 78, 55, 52]
    mem(ring, ring_w, ring_h, inset=16)
    mem([(60, 3.6), (60, 7.05), (60, 8.95)], (130, 70), (110, 58), inset=16)                # B 柱
    mem([(-940, 3.6), (-948, 4.2), (-980, 4.7), (-1050, 5.1), (-1120, 5.45), (-1150, 6.0), (-1155, 7.05), (-1030, 8.0),
         (-900, 8.75)],
        [104, 100, 96, 92, 88, 84, 78, 70, 64], [96, 94, 90, 88, 86, 84, 72, 62, 58], inset=16)           # 后门锁柱：腰线以下绕开后轮罩（跟着后门的狗腿缝），腰线以上顺着后门后缘往前上方并进车顶边梁
    # 前翼子板上边梁（俗称“枪梁”）：从 A 柱根部往前到水箱框架，在前盖缝的里侧、翼子板顶面下面
    gun = []
    for y, s_, dx, dz in ((1112, 7.2, 95, 75), (1350, 7.2, 100, 80), (1600, 7.2, 100, 85), (1850, 7.2, 100, 85),
                          (2075, 7.2, 100, 85)):
        q = SKIN.p(y, s_, 1)
        gun.append((q.x - dx, y, q.z - dz))
    CK.beam(bm, gun, 50, 50, up=(0, 0, 1), mi=0, mirror=True, shape='hat', flange=10)
    mem([(Y_WS1 + 6, 9.35), (Y_WS1 - 12, 10.6), (Y_WS1 - 18, 12)], 70, 45)                   # 前风挡上横梁
    mem([(Y_BK1 - 6, 9.35), (Y_BK1 + 12, 10.6), (Y_BK1 + 18, 12)], 70, 45)                   # 后风挡上横梁
    for y in (-180, -590):
        mem([(y, 9.36), (y, 12)], 50, 30, flange=10)                                         # 车顶横梁
    mem([(Y_COWL - 14, 8.0), (Y_COWL - 4, 9.5), (Y_COWL, 12)], 100, 80)                      # 前围上横梁（雨刮下面）
    mem([(Y_DECK + 2, 9.3), (Y_DECK + 2, 12)], 70, 55)                                       # 后风挡下横梁（衣帽架后沿）
    CK.beam(bm, [(-560, -2372, 842), (0, -2378, 848), (560, -2372, 842)], 60, 50, up=(0, 0, 1), mi=0, shape='hat', flange=12)                                  # 行李箱口下沿（尾板上横梁）
    # 地板、前围板、后排背板（整张钣金）
    rbox(bm, (0, 0, 335), (1500, 2000, 6), 3, 1, 1)             # 地板：前后到轮罩为止全宽，伸进轮罩之间那两截收窄
    for yc in (1095, -1080):
        rbox(bm, (0, yc, 335), (1170, 190 if yc > 0 else 160, 6), 3, 1, 1)
    rbox(bm, (0, SH.Y_FIREWALL, 525), (1170, 12, 370), 3, 1, 1)  # 前围板下半截在两个前轮罩之间，比上半截窄
    rbox(bm, (0, SH.Y_FIREWALL, 812), (1470, 12, 204), 3, 1, 1)
    rbox(bm, (0, -1186, 510), (1170, 12, 320), 3, 1, 1)         # 后排背板：下半截夹在两个后轮罩之间
    rbox(bm, (0, -1186, 850), (1520, 12, 360), 3, 1, 1)
    # 不贴外皮的件：纵梁、地板横梁、中央通道是帽形钣金；前后防撞梁是铝挤出方管
    CK.beam(bm, [(SH.RAIL_X, y, z) for y, z in SH.RAIL_YZ], SH.RAIL_H, SH.RAIL_W, up=(1, 0, 0), mi=0, mirror=True,
            shape='hat')
    CK.beam(bm, [(520, -1190, 360), (520, -1700, 390), (520, -2230, 420)], 120, 80, up=(1, 0, 0), mi=0, mirror=True,
            shape='hat')
    CK.beam(bm, [(-660, 2190, 440), (0, 2235, 448), (660, 2190, 440)], 60, 110, up=(0, 0, 1), mi=0)
    CK.beam(bm, [(-660, -2280, 420), (0, -2318, 425), (660, -2280, 420)], 60, 110, up=(0, 0, 1), mi=0)
    for y in (560, -320):
        CK.beam(bm, [(-720, y, 364), (720, y, 364)], 70, 50, mi=0, shape='hat')
    CK.beam(bm, [(0, 1180, 380), (0, 400, 360), (0, -300, 350)], 160, 60, mi=0, shape='hat', flange=20)  # 中央通道
    # 前减震塔
    for sx in (1, -1):
        rbox(bm, (sx * SH.TOWER_X, SH.TOWER_Y, SH.TOWER_Z), SH.TOWER_SIZE, 30, 0, 2)   # 在轮罩内衬挡板里面（x < 590），减震从下面伸进来
    # 水箱框架：上横梁把两根枪梁的前端连起来，两根立柱落到纵梁头上
    CK.beam(bm, [(-700, 2056, 655), (-420, 2096, 668), (0, 2108, 671), (420, 2096, 668), (700, 2056, 655)], 50, 70, mi=0,
            shape='hat', up=(0, 1, 0), flange=12)
    CK.beam(bm, [(470, 2098, 660), (470, 2132, 470)], 60, 45, up=(0, 1, 0), mi=0, mirror=True, shape='hat', flange=12)
    # 尾板：后保险杠里面的一整张钣金，上沿接行李箱口下沿，下沿压在后防撞梁上
    rbox(bm, (0, -2322, 700), (1300, 10, 540), 3, 1, 1)
    # 自检：车框不能顶出外皮（留 3 毫米给车板）
    bad = CK.poke_check(SKIN, [v.co for v in bm.verts], margin=3.0)
    if bad:
        worst = max(bad, key=lambda t: t[1])
        print(f'[poke] 车框有 {len(bad)} 个点离外皮不到 3 mm，最多伸出 {worst[1]:.1f} mm @ '
              f'({worst[0].x:.0f}, {worst[0].y:.0f}, {worst[0].z:.0f})')
        for v, d in sorted(bad, key=lambda t: -t[1])[:12]:
            print(f'   ({v.x:6.0f}, {v.y:6.0f}, {v.z:5.0f})  {d:+.1f}')
    for yc in (WB, -WB):
        bad = CK.arch_check([v.co for v in bm.verts], yc, R_TYRE, ARCH_R, 590)
        if bad:
            worst = max(bad, key=lambda t: t[1])
            print(f'[arch] 车框有 {len(bad)} 个点伸进 y={yc:.0f} 的轮罩，最多 {worst[1]:.1f} mm @ '
                  f'({worst[0].x:.0f}, {worst[0].y:.0f}, {worst[0].z:.0f})')
            seen = []
            for v, d in sorted(bad, key=lambda t: -t[1]):
                if all((v - q).length > 60 for q in seen):
                    seen.append(v)
                    print(f'   ({v.x:6.0f}, {v.y:6.0f}, {v.z:5.0f})  {d:5.1f}')
                if len(seen) >= 8:
                    break
    add('BIW', bm, mats, 'frame', ang=38)


# ---------------------------------------------------------------- 3 车板
def grow(chart, poly, d):
    """在这片的展开图里把多边形外扩 d 毫米（负数内缩）"""
    o2 = [chart.to2(*p) for p in poly]
    g = CK.offset2(o2, d)
    if CK.area2(o2) < 0:
        g = g[::-1]
    return [chart.from2(*q) for q in g]


def plan_path(z, y_from, end, n_side=10, n_corner=18, n_face=8):
    """高度 z 处车身的俯视轮廓（右半边）：从侧面 y_from 开始，绕过车角，到车头 / 车尾立面的中线。
    返回 [(x, y)]。保险杠、防擦条这种“顺着车身外轮廓走一圈”的件用它"""
    sgn = 1.0 if end > 0 else -1.0
    close = 190.0
    ys = [y_from + (end - sgn * close - y_from) * i / n_side for i in range(n_side)]
    ys += [end - sgn * close * (1 - (i / n_corner) ** .6) for i in range(n_corner)]
    pts = []
    for y in ys:
        w = CK.half_width(SKIN, y, z)
        if w is not None:
            pts.append((w, y))
    w_end = CK.half_width(SKIN, end, z) or pts[-1][0]
    pts += [(w_end * (1 - i / n_face), end) for i in range(n_face + 1)]
    return pts


def bumper(bm, z, h, depth, y_from, end, mi=0, out=18.0, r=22.0):
    """保险杠：一根截面 h（高）× depth（厚）的圆角杠，顺着车身在高度 z 处的俯视轮廓绕车头 / 车尾一圈，
    两头收在轮拱前面 / 后面。out 是杠的中面比车身外皮靠外多少"""
    right = plan_path(z, y_from, end)
    P = [Vector((x, y, z)) for x, y in right]
    full = P + [Vector((-q.x, q.y, q.z)) for q in P[-2::-1]]
    ups = []
    for i, q in enumerate(full):
        t = full[min(i + 1, len(full) - 1)] - full[max(i - 1, 0)]
        nrm = Vector((t.y, -t.x, 0.0))
        if nrm.length < 1e-6:
            nrm = Vector((0, 1 if end > 0 else -1, 0))
        nrm.normalize()
        if nrm.dot(Vector((q.x, (q.y - end) * .2 + (1 if end > 0 else -1) * 400, 0))) < 0:
            nrm = -nrm
        ups.append(nrm)
    for _ in range(3):
        ups = [ups[0]] + [(ups[i - 1] + ups[i] * 2 + ups[i + 1]).normalized() for i in range(1, len(ups) - 1)] + [ups[-1]]
    pts = [q + u * out for q, u in zip(full, ups)]
    CK.sweep(bm, pts, ups, h, depth, r=r, mi=mi, cap=True)


def build_panels(M):
    grp('shell', '外板与玻璃', (0, 0, 1900, 0))
    S = CH['side']
    archF = CK.arch_cut(SKIN, WB, R_TYRE, ARCH_R, ARCH_X)
    archR = CK.arch_cut(SKIN, -WB, R_TYRE, ARCH_R, ARCH_X)

    def one(name, chart, poly, mat, holes=(), cuts=(), measure=True, **k):
        bm = bmesh.new()
        part = CK.panel(bm, chart, poly, holes, cuts, mi=0, name=name, **k)
        if measure:
            PARTS.append(part)
        add(name, bm, [mat], 'shell', ang=40)
    P, T, K = M['paint'], M['trim'], M['piano']
    hood_corner = (Y_HOOD0 - 4, S_HOOD + .02)
    a_base = (1150, 7.45)                    # A 柱根：翼子板后上角、侧围外板前下角、前围上盖板外角在这里碰头
    one('Panel_Hood', CH['hood'], L_HOOD, P, gap=5.0)
    one('Panel_BumperF', CH['front'], [(Y_HOOD1, 12), (Y_HOOD1 - 3, 8.3)] + L_FASCIA_F + [(Y_FASC_F, 0), (Y_NOSE, 0), (Y_NOSE, 12)],
        P, gap=2.0)
    one('Panel_Fender', S, [hood_corner, (1600, S_HOOD), (2000, S_HOOD)] + L_FASCIA_F + [(1000, UB)] + L_DOOR_F[::-1] + [a_base],
        P, cuts=[archF])
    one('Panel_DoorF', S, L_DOOR_F + [(60, SILL), (60, BELT)], P)
    one('Panel_DoorR', S, [(60, BELT), (60, SILL)] + L_DOOR_R[::-1], P)
    # 侧围外板：A 柱、车顶边梁、C 柱、后翼子板是一整张冲压件（车身色），围着两扇门的上半截
    bso = (L_DOOR_R + [(-1000, UB)] + L_FASCIA_R[::-1] + [(-2000, S_HOOD), (Y_LID0 - 22, S_HOOD + .02), (Y_LID0, W_EDGE)]
           + GH['back_side'][::-1] + GH['ws_side'][::-1] + [a_base] + GH['door_top'][:-1])
    one('Panel_SideOuter', S, bso, P, cuts=[archR])
    one('Panel_Trunk', CH['trunk'], L_TRUNK, P, gap=5.0)
    one('Panel_BumperR', CH['rear'], [(Y_LID1, 12), (Y_LID1 + 3, 8.3)] + L_FASCIA_R + [(Y_FASC_R, 0), (Y_TAIL, 0), (Y_TAIL, 12)],
        P, gap=2.0)
    one('Panel_Roof', CH['roof'], [(Y_WS1 - 8, 12), (Y_WS1 - 8, 9.9), (Y_WS1 - 18, RAIL), (Y_BK1 + 18, RAIL), (Y_BK1 + 8, 9.9),
                                   (Y_BK1 + 8, 12)], P)
    one('Panel_Rocker', S, [(1000, UB), (-1000, UB), (-1000, SILL), (1000, SILL)], T, gap=3.0, hem=0)
    # 车门上半截：窗框外面包亚光黑饰条（B 柱看到的黑色就是前后门窗框各一半），中间是窗洞。
    # 不用亮面黑：斜着看会映出一片天，窗框看着像浅灰色
    one('Panel_SashF', S, GH['sash_f'], T, holes=[GH['win_f']])
    one('Panel_SashR', S, GH['sash_r'], T, holes=[GH['win_r'], GH['win_q']])
    # B 柱上的黑色密封条 / 饰板：垫在两扇门中间那条缝下面，缝里看到的是黑的（不然是后面的灰色骨架）
    dt = GH['door_top']

    def s_top(y):
        for p, q in zip(dt, dt[1:]):
            if (p[0] - y) * (q[0] - y) <= 0 and p[0] != q[0]:
                return p[1] + (q[1] - p[1]) * (y - p[0]) / (q[0] - p[0])
        return RAIL
    one('Panel_BPillar', S, [(B_Y + 40, SILL), (B_Y + 40, s_top(B_Y + 40) + .03), (B_Y - 40, s_top(B_Y - 40) + .03),
                             (B_Y - 40, SILL)], T, gap=0, lift=-7, hem=0, measure=False)
    # 车头车尾的立面：外皮在 Y_NOSE / Y_TAIL 处是一圈圆角矩形，用一块平板盖上。直板造型的车头车尾就是这块立着的板，
    # 灯、格栅、车牌都画在它上面
    for nm, y, sgn in (('Panel_NoseCap', Y_NOSE, 1), ('Panel_TailCap', Y_TAIL, -1)):
        cm = bmesh.new()
        ss = [k / 16 for k in range(NSEG * 16 + 1)]
        ring = [SKIN.p(y, q, 1) for q in ss] + [SKIN.p(y, q, -1) for q in ss[-2:0:-1]]
        vs = [cm.verts.new(v) for v in ring]
        c = cm.verts.new(sum(ring, Vector()) / len(ring))
        for i in range(len(vs)):
            try:
                f = cm.faces.new([c, vs[i], vs[(i + 1) % len(vs)]])
            except ValueError:
                continue
            f.normal_update()
            if f.normal.y * sgn < 0:
                f.normal_flip()
        bmesh.ops.remove_doubles(cm, verts=cm.verts, dist=.05)
        add(nm, cm, [P], 'shell', ang=20)
    # 黑色底护板只铺到车头 / 车尾端板为止
    one('Panel_Under', CH['under'], [(Y_FASC_R, 0), (Y_UNDER, 0), (Y_UNDER, UB), (Y_FASC_R, UB)], T, measure=False)
    # 雨刮下面的黑色导流板，垫在前盖后缘和前挡下沿之间，两头伸到翼子板后角下面
    one('Cowl', CH['hood'], [(Y_COWL - 60, 12), (Y_COWL - 60, 9.0), (Y_COWL - 50, 7.5), (Y_HOOD0 + 8, 7.5), (Y_HOOD0 + 10, 12)], T,
        gap=0, lift=-2.5, measure=False)
    # 轮罩
    bm = bmesh.new()
    for yc in (WB, -WB):
        CK.wheelhouse(bm, SKIN, yc, R_TYRE, ARCH_R, x_in=590, mi=0)
    add('Wheelhouse', bm, [T], 'shell', ang=40)
    # 板缝底下的黑色密封条：缝只有 3 ~ 5 mm 宽，不垫的话从缝里看到的是后面浅色的白车身和翻边，缝是亮的
    sl = bmesh.new()
    for line in (L_DOOR_F, L_DOOR_R, [(60, SILL), (60, BELT)], [(1000, SILL), (-1000, SILL)], L_HOOD, L_TRUNK, L_FASCIA_F,
                 L_FASCIA_R, [hood_corner, a_base, L_DOOR_F[0]], [L_DOOR_F[0], (-1170, BELT)],
                 [(Y_WS1 - 18, RAIL), (Y_BK1 + 18, RAIL)]):
        ribbon(sl, line, 13, 0, off=-3.0)
    add('Seals', sl, [M['seam']], 'shell', ang=50)
    # ---- 黑色饰件：防擦条、门把手、格栅、保险杠
    sm = bmesh.new()
    # 防擦条：沿着车身最宽的那道棱（s = 5），从车头端板到车尾端板，轮拱处断开
    for y0, y1 in ((Y_FASC_F - 12, WB + ARCH_R + 16), (WB - ARCH_R - 16, -WB + ARCH_R + 16), (-WB - ARCH_R - 16, Y_FASC_R + 12)):
        ribbon(sm, [(y0, 5.0), (y1, 5.0)], 30, 0, off=4.0)
    # 门把手：肩线下面的翻板式把手
    for yc in (190, -1010):
        ribbon(sm, [(yc + 62, 5.80), (yc - 62, 5.80)], 30, 0, off=1.8)
    FP = CK.face_patch
    z_h = SKIN.xz(Y_NOSE, 6.0)[1]            # 车头立面上肩线的高度
    # 格栅：两只大灯之间一块黑色的横条格栅；保险杠下面一条进气口
    FP(sm, SKIN, [(0, z_h - 232), (402, z_h - 232), (402, z_h - 62), (0, z_h - 62)], Y_NOSE, off=2.0)
    # 灯后面垫一圈黑边：大灯 + 转向灯、尾灯四周各露出 7 mm
    FP(sm, SKIN, [(407, z_h - 239), (838, z_h - 239), (838, z_h - 55), (407, z_h - 55)], Y_NOSE, off=1.6, grid=14)
    z_t = SKIN.xz(Y_TAIL, 6.0)[1]
    # 车尾这块黑边一直连到中线：两只尾灯之间是一条黑色饰板，车牌装在它中间
    FP(sm, SKIN, [(0, z_t - 235), (838, z_t - 235), (838, z_t - 63), (0, z_t - 63)], Y_TAIL, off=1.6, grid=14)
    FP(sm, SKIN, [(0, 318), (470, 318), (500, 342), (470, 372), (0, 372)], Y_NOSE, off=2.0)
    add('Seams', sm, [M['seam']], 'shell', ang=50)
    cr = bmesh.new()
    for k in range(5):                       # 格栅横条
        z0 = z_h - 218 + k * 34
        FP(cr, SKIN, [(0, z0), (396, z0), (396, z0 + 9), (0, z0 + 9)], Y_NOSE, off=5.0, grid=40)
    add('Grille_Bars', cr, [M['rim']], 'shell', ang=50)
    # 保险杠：黑色的杠，两头绕到侧面、收在轮拱前后
    bp = bmesh.new()
    z_bf = SKIN.xz(WB + ARCH_R + 34, 5.0)[1] - 34         # 保险杠上沿和防擦条那道棱对齐
    z_br = SKIN.xz(-WB - ARCH_R - 34, 5.0)[1] - 34
    bumper(bp, z_bf, 128, 70, WB + ARCH_R + 34, Y_NOSE, mi=0)
    bumper(bp, z_br, 128, 70, -WB - ARCH_R - 34, Y_TAIL, mi=0)
    add('Bumpers', bp, [M['trim']], 'shell', ang=50)
    lm = bmesh.new()
    # 大灯：两只长方形的灯；外侧绕过车角的是转向灯（琥珀色）
    FP(lm, SKIN, [(414, z_h - 232), (706, z_h - 232), (706, z_h - 62), (414, z_h - 62)], Y_NOSE, off=2.6, grid=22)
    add('Lamp_Head', lm, [M['lamp']], 'shell', ang=70)
    am = bmesh.new()
    FP(am, SKIN, [(716, z_h - 232), (831, z_h - 232), (831, z_h - 62), (716, z_h - 62)], Y_NOSE, off=3.2, grid=12)
    tm = bmesh.new()
    # 尾灯：左右各一块横着的长方形（红），外侧绕过车角的一段是转向灯（琥珀色），靠里一小格是倒车灯（白）
    FP(tm, SKIN, [(416, z_t - 228), (700, z_t - 228), (700, z_t - 70), (416, z_t - 70)], Y_TAIL, off=2.6, grid=22)
    add('Lamp_Tail', tm, [M['tail']], 'shell', ang=70)
    FP(am, SKIN, [(708, z_t - 228), (831, z_t - 228), (831, z_t - 70), (708, z_t - 70)], Y_TAIL, off=3.2, grid=12)
    rv = bmesh.new()
    FP(rv, SKIN, [(330, z_t - 228), (408, z_t - 228), (408, z_t - 70), (330, z_t - 70)], Y_TAIL, off=2.6, grid=22)
    add('Lamp_Reverse', rv, [M['plate']], 'shell', ang=70)
    add('Lamp_Turn', am, [M['amber']], 'shell', ang=70)
    # 车牌：前面装在保险杠正面，后面在两只尾灯之间
    pm = bmesh.new()
    rbox(pm, (0, Y_NOSE + 18 + 35 + 1.5, z_bf), (440, 3, 110), 2, 0, 1)
    rbox(pm, (0, Y_NOSE + 18 + 35 + 0.5, z_bf), (452, 3, 122), 2, 1, 1)
    zc = z_t - 149
    FP(pm, SKIN, [(0, zc - 78), (232, zc - 78), (232, zc + 78), (0, zc + 78)], Y_TAIL, mi=1, off=3.0, grid=40)
    FP(pm, SKIN, [(0, zc - 70), (224, zc - 70), (224, zc + 70), (0, zc + 70)], Y_TAIL, mi=0, off=5.0, grid=40)
    add('Plates', pm, [M['plate'], M['seam'], M['rim']], 'shell', ang=50)
    build_mirrors(M)
    # 在三维里量缝
    gaps = CK.measure_gaps(PARTS)
    rows = []
    for (a, b), (n, lo, avg, hi, p5, p95) in sorted(gaps.items()):
        rows.append(dict(a=a, b=b, n=n, min=round(lo, 2), avg=round(avg, 2), max=round(hi, 2), p5=round(p5, 2),
                         p95=round(p95, 2)))
        print(f'[gap] {a:>14s} | {b:<14s} n={n:4d}  min {lo:5.2f}  p5 {p5:5.2f}  avg {avg:5.2f}  p95 {p95:5.2f}'
              f'  max {hi:5.2f} mm')
    return rows


def build_mirrors(M):
    """门装式后视镜（现在的主流：前挡很斜时窗框前角的三角太窄，镜子装在门皮上、腰线下面）。
    脚座贴在前门肩部，镜臂往外上方伸，镜壳是车身色的“子弹头”（前圆后平），镜面朝后。
    尺寸按常见乘用车估：镜壳宽 190、高 120、深 95 mm，内侧离车门约 40 mm。
    镜壳要包住线束图里的后视镜电机 Mir 和侧环视摄像头 CamS（ee_data 里的坐标）"""
    mm = bmesh.new()
    cy = 1000.0
    W, H, R = 158.0, 100.0, 18.0             # 老式的方镜壳：棱角分明，圆角小
    cx, cz = SKIN.p(cy + 25, 6.0).x + 30.0 + W / 2, SKIN.p(cy + 25, BELT).z + 62.0  # 镜壳中心：内侧离车门约 30；高度跟着腰线走
    for sx in (1, -1):
        rings = []
        for dy, kw, kh in ((0, 1, 1), (30, 1, 1), (56, .97, .96), (72, .88, .86), (80, .72, .68)):
            q = CK._rrect(W * kw, H * kh, R * min(kw, kh), seg=4)
            rings.append([Vector((sx * (cx + u), cy + dy, cz + v)) for u, v in q])
        CK.loft(mm, rings, mi=0, cap=True)
        # 镜面：比镜壳后口小一圈，贴在后面
        q = CK._rrect(W - 16, H - 14, R - 6, seg=4)
        vs = [mm.verts.new((sx * (cx + u), cy - 1.2, cz + v)) for u, v in q]
        f = mm.faces.new(vs)
        f.material_index = 2
        f.normal_update()
        if f.normal.y > 0:
            f.normal_flip()
        # 镜臂：从门肩上的脚座往外上方伸进镜壳内侧下半部
        y0, s0 = cy + 52.0, 7.22           # 镜脚座在前门窗框前下角（腰线上面那块黑色三角）
        p0 = SKIN.p(y0, s0, sx) - SKIN.n(y0, s0, sx) * 4
        p1 = Vector((sx * (cx - W / 2 + 30), cy + 40, cz - 18))
        d = (p1 - p0).normalized()
        u = Vector((0, 1, 0))
        u = (u - d * u.dot(d)).normalized()
        v = d.cross(u)
        rings = []
        for t, w_, h_ in ((0, 96, 58), (.3, 90, 54), (.7, 84, 50), (1, 78, 46)):
            c = p0.lerp(p1, t)
            rings.append([c + u * a_ + v * b_ for a_, b_ in CK._rrect(w_, h_, 12, seg=3)])
        CK.loft(mm, rings, mi=1, cap=True)
    add('Mirrors', mm, [M['trim'], M['piano'], M['mirror']], 'shell', ang=45)


# ---------------------------------------------------------------- 4 玻璃
def build_glass(M):
    """玻璃：外表面比外皮低 1 mm，内侧黑釉边；下面是聚氨酯胶条压在车身开口的翻边上（萨博维修手册 / US4650240）。
    侧窗是降下式门玻璃，在窗框饰条里面再往里 5 mm"""
    bm = bmesh.new()
    bond = bmesh.new()
    S = CH['side']
    for ch, poly, mi in ((CH['ws'], GH['ws'], 0), (CH['back'], GH['back'], 2)):
        CK.glass(bm, ch, poly, lift=-1.0, frit=34, mi=mi, mi_frit=1)
        CK.glass_bond(bond, ch, poly, lift=-1.0, inset=12, mi_bead=0, mi_flange=1)
    # 门玻璃比窗洞大一圈，四边插进窗框的导槽里（从外面看不见边）；后门分隔条后面的小三角窗是固定的，也装在门框里
    for k, mi in (('win_f', 0), ('win_r', 2), ('win_q', 2)):
        CK.glass(bm, S, grow(S, GH[k], 16), lift=-6.0, frit=0, mi=mi, mi_frit=1)
    # 玻璃四周的黑边（陶瓷釉）是哑光的：用亮面钢琴黑的话，斜着看会映出一条灰白的天空，像柱子旁边多了一根浅色的条
    add('Glass', bm, [M['glass'], M['seam'], M['glasstint']], 'shell', ang=40)
    add('GlassBond', bond, [M['urethane'], M['biw']], 'shell', ang=40)


def build_wheels(M):
    """195/65 R15 一类：外径 640、15 吋钢圈（轮辋半径 190）、胎壁约 125，外面扣一个银色的全盖轮罩。
    老式车的车轮：轮子小、胎壁厚、轮盖是一整块盘，上面一圈散热孔"""
    grp('wheels', '车轮', (0, 0, 0, 0))
    mats = [M['tyre'], M['rim'], M['disc'], M['rimdark']]
    R, W = R_TYRE, TYRE_HW
    for tag, y, sx in (('FL', WB, -1), ('FR', WB, 1), ('RL', -WB, -1), ('RR', -WB, 1)):
        bm = bmesh.new()
        tread = [(R, -W * .72)]
        for gc in (-.42, -.14, .14, .42):
            tread += [(R, W * gc - 6), (R - 7, W * gc - 4), (R - 7, W * gc + 4), (R, W * gc + 6)]
        tread.append((R, W * .72))
        tp = ([(194, -W * .86), (210, -W * .99), (252, -W), (292, -W * .96), (R - 5, -W * .85)] + tread
              + [(R - 5, W * .85), (292, W * .96), (252, W), (210, W * .99), (194, W * .86)])
        lathe(bm, tp, (0, 0, 0), 'X', 56, 0, closed=True)
        # 钢圈：一圈桶 + 外沿
        lathe(bm, [(203, W * .95), (203, W * .84), (192, W * .80), (188, -W * .88), (180, -W * .88), (183, W * .70),
                   (193, W * .95)], (0, 0, 0), 'X', 56, 3, closed=True)
        # 轮盖：微微内凹的一整块盘，中间一个凸起的中心盖
        lathe(bm, [(0, W * .52), (0, W * .66), (34, W * .66), (44, W * .60), (120, W * .56), (160, W * .62), (186, W * .80),
                   (192, W * .80), (192, W * .52)], (0, 0, 0), 'X', 48, 1)
        # 一圈 12 个长方形散热孔（深色）
        for k in range(12):
            a_ = 2 * pi * k / 12
            c = Vector((W * .585, 140 * cos(a_), 140 * sin(a_)))
            rbox(bm, c, (5, 16, 34), 2, 3, 1, rot=(Vector((1, 0, 0)), math.degrees(a_) - 90))
        if sx < 0:
            bmesh.ops.scale(bm, vec=(-1, 1, 1), verts=bm.verts)
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        add(f'Wheel_{tag}', bm, mats, 'wheels', loc=(sx * TRACK, y, R), ang=30, coll='Chassis', extras=dict(ex=sx))
        d = bmesh.new()
        lathe(d, [(0, -11), (132, -11), (132, 11), (0, 11)], (0, 0, 0), 'X', 40, 0)
        rbox(d, (0, 0, 126), (64, 110, 60), 10, 1, 1)
        cyl(d, (-sx * 90, 0, 0), (0, 0, 0), 30, 30, 2, seg=14)
        add(f'Brake_{tag}', d, [M['disc'], principled(f'Caliper{tag}', '#3a3d42', rough=.5), M['steel']], 'wheels',
            loc=(sx * (TRACK - 34), y, R), coll='Chassis', extras=dict(ex=sx))


def build_chassis(M):
    grp('chassis', '底盘', (0, 0, -900, 0))
    bm = bmesh.new()
    # 前副车架：后横梁 + 两根边梁 + 前横梁，围着动力总成一圈。后横梁中间留一个口子给排气管，
    # 转向机压在后横梁上面、差速器的后面（原来在轴线后面一点，那里现在是差速器）
    rbox(bm, (-262, 1236, 235), (636, 90, 64), 16, 0, 2)
    rbox(bm, (402, 1236, 235), (356, 90, 64), 16, 0, 2)
    rbox(bm, (0, 1800, 235), (1160, 90, 64), 16, 0, 2)
    for sx in (1, -1):
        rbox(bm, (sx * 560, 1518, 235), (60, 654, 56), 14, 0, 2)
    # 后副车架：一根横梁
    rbox(bm, (0, -1510, 235), (1160, 90, 64), 16, 0, 2)
    for (y0, wy) in ((1400, 1), (-1400, -1)):
        for sx in (1, -1):
            cyl(bm, (sx * 560, y0 + 120, 240), (sx * (TRACK - 110), y0, 300), 20, 16, 0, seg=10)
            cyl(bm, (sx * 560, y0 - 120, 240), (sx * (TRACK - 110), y0, 300), 20, 16, 0, seg=10)
            cyl(bm, (sx * 600, y0, 500), (sx * (TRACK - 100), y0, 460), 13, 13, 0, seg=10)
            # 减震：上端往里斜，进减震塔。前轮的减震下端装在转向节上、半轴的上面
            z_lo = 425 if wy > 0 else 330
            cyl(bm, (sx * (TRACK - 125), y0 + wy * 10, z_lo), (sx * 520, y0 + wy * 10, 760), 32, 32, 0, seg=14)
    cyl(bm, (-640, 1232, 300), (640, 1232, 300), 26, mi=0, seg=14)   # 转向机
    cyl(bm, (-370, 1232, 300), (-370, 880, 760), 18, 16, 0, seg=10)  # 转向管柱
    rbox(bm, (0, SH.Y_CONDENSER, 560), (1120, 44, 380), 10, 2, 1)    # 冷凝器
    add('Subframes', bm, [M['susp'], M['alu'], M['pack'], M['conn']], 'chassis', coll='Chassis', ang=40)


def skin_top_z(y, x):
    """外皮上表面（腰线以上）在 (x, y) 处的高度；x 比这一圈截面的肩部还靠外就返回 None"""
    y = min(max(y, Y_TAIL + 1), Y_NOSE - 1)
    lo, hi = 7.0, float(NSEG)
    if x >= SKIN.xz(y, lo)[0]:
        return None
    for _ in range(26):
        m = (lo + hi) / 2
        if SKIN.xz(y, m)[0] > x:
            lo = m
        else:
            hi = m
    return SKIN.xz(y, (lo + hi) / 2)[1]


def build_cabin(M):
    """座舱：地板 → 座椅 → 仪表台 / 中控 / 方向盘 / 挡杆 / 踏板 → 贴在车身上的内饰板（门板、柱子饰板、顶棚、后隔板）。
    座椅和仪表台的大形是从软件定义汽车那辆车沿用的；仪表、中控、挡杆、踏板按老车的样子重做：
    方向盘后面一个带遮光罩的仪表盒（网页在表盘上实时画转速表和车速表），中间凸出来的中控台上是出风口、收音机、
    三个空调旋钮，中央通道上是 P-R-N-D 挡位面板。方向盘、挡杆、两个踏板各是一个物体，原点在转轴上。
    驾驶员的 H 点、眼点、踏板行程、挡杆倾角都读 params.json 的 cockpit。返回给网页的驾驶位数据（spec.cockpit）"""
    CP = PT.P['cockpit']
    HP = Vector(CP['h_point'])
    EYE = HP + Vector((0, CP['eye_offset'][0], CP['eye_offset'][1]))
    ck = dict(h_point=list(HP), eye=[round(v, 1) for v in EYE])
    grp('cabin', '座舱', (0, 0, 620, 0))
    grp('trim', '内饰板', (0, 0, 1500, 0))
    S = CH['side']
    X = Vector((1, 0, 0))
    bm = bmesh.new()
    # 座舱地板（前围板、后排背板在车框里，这里不再重复）
    rbox(bm, (0, -60, 338), (1540, 2500, 16), 6, 0, 1)
    add('Floor', bm, [M['carpet']], 'cabin', coll='Cabin')
    # ---- 座椅：按专利里的层次，从地板往上搭（carkit.front_seat / bench）
    # H 点离地 588（离地板 242）：电池在地板下面，地板比燃油车高，H 点到地板只能做矮，靠背更躺（电动轿车的通病）
    FLOOR_TOP = 346.0
    seat_m = [M['leather'], M['leather2']]
    for tag, hx in (('SeatFL', HP.x), ('SeatFR', -HP.x)):
        pad, frame, rail = bmesh.new(), bmesh.new(), bmesh.new()
        CK.front_seat(pad, frame, rail, (hx, HP.y, HP.z), FLOOR_TOP, mi_pad=0, mi_hr=0, mi_insert=1)
        add(tag + '_Pad', pad, seat_m, 'cabin', coll='Cabin', ang=45)
        add(tag + '_Frame', frame, [M['seatframe']], 'cabin', coll='Cabin', ang=40)
        add(tag + '_Rail', rail, [M['seatframe']], 'cabin', coll='Cabin', ang=40)
    pad, frame = bmesh.new(), bmesh.new()
    CK.bench(pad, frame, (0, -760, 596), FLOOR_TOP, w=1240, back_h=560, back_angle=24, mi_pad=0, mi_hr=0, mi_insert=1)
    add('SeatRear_Pad', pad, seat_m, 'cabin', coll='Cabin', ang=45)
    add('SeatRear_Frame', frame, [M['seatframe']], 'cabin', coll='Cabin', ang=40)
    # ---- 仪表台：三段 (y, z) 截面沿车宽拉伸。上面深色软包，中间一条饰板（上沿是贯穿出风口，下沿是氛围灯），下面浅色
    d = bmesh.new()
    DW = 756                                  # 仪表台半宽（门板内表面在 x ≈ 770）
    xs = [-DW + i * 36 for i in range(42)] + [DW]

    def ends(x):
        return 1 - .16 * (abs(x) / DW) ** 6
    CK.xloft(d, [(1165, 930), (1165, 976), (1040, 990), (900, 993), (805, 986), (770, 970), (760, 946), (774, 930),
                 (900, 924)], xs, 0, ends)
    CK.xloft(d, [(900, 930), (776, 930), (756, 926), (746, 906), (746, 868), (758, 852), (790, 848), (900, 848)], xs, 1, ends)
    CK.xloft(d, [(1165, 850), (790, 850), (764, 846), (768, 800), (802, 742), (858, 700), (960, 672), (1165, 660)], xs, 2,
             ends)
    # 两头各一个出风口，压在木纹饰板上
    for sx in (-1, 1):
        rbox(d, (sx * 640, 743, 890), (112, 6, 40), 4, 3, 1)
    # 中控台：仪表台中间往后凸出来的一块。上面两个出风口、收音机（带一条小显示窗和两个旋钮）、三个空调旋钮
    rbox(d, (0, 752, 790), (250, 40, 270), 10, 0, 2)
    for sx in (-1, 1):
        rbox(d, (sx * 58, 731, 888), (92, 4, 34), 3, 3, 1)
        for dz in (-8, 0, 8):
            rbox(d, (sx * 58, 729.5, 888 + dz), (86, 2, 2.4), .8, 2, 1)       # 出风口的横叶片
        cyl(d, (sx * 72, 730, 818), (sx * 72, 717, 818), 10, mi=2, seg=16)     # 收音机旋钮
    rbox(d, (0, 730.5, 826), (186, 4, 54), 3, 3, 1)
    rbox(d, (0, 728.6, 838), (100, 1.5, 15), 1, 4, 1)
    rbox(d, (0, 731, 742), (222, 3, 70), 3, 3, 1)
    for x in (-72, 0, 72):
        cyl(d, (x, 730, 742), (x, 711, 742), 21, 19, mi=2, seg=24)            # 空调：风量、温度、出风位置
        rbox(d, (x, 710.6, 752), (3, 1.2, 14), .5, 4, 1)                       # 旋钮上的指示线
    # 仪表台上表面是平的，前挡下沿两头却跟着前盖的拱度往下掉：不压一下的话，仪表台两个角会从玻璃里戳出来
    for v in d.verts:
        if v.co.y > 880:
            zs = skin_top_z(v.co.y, abs(v.co.x))
            if zs is not None and v.co.z > zs - 14:
                v.co.z = zs - 14
    add('Dash', d, [M['softdark'], M['woodtrim'], M['softlight'], M['piano'], M['screen']], 'cabin', coll='Cabin', ang=42)
    # 仪表台横梁（Cross Car Beam）：一根钢管横在两根 A 柱之间，仪表台、转向管柱、气囊都挂在它上面
    # （专利 US5934744 / US6554352）。平时被仪表台包着看不见，网页里透视 / 拆开时能看到
    b = bmesh.new()
    CK.tube(b, [(-742, 1010, 885), (742, 1010, 885)], 58, mi=0)
    for sx in (-1, 1):
        rbox(b, (sx * 738, 1010, 885), (14, 110, 150), 4, 0, 1)        # 两端的安装板，拧在 A 柱内板上
    rbox(b, (-370, 950, 880), (150, 150, 14), 4, 0, 1, rot=(X, -22))   # 转向管柱支架
    for x in (-60, 60):
        cyl(b, (x, 1010, 885), (x, 1040, 360), 16, mi=0, seg=10)       # 中间两根落地支撑
    add('IP_Beam', b, [M['steel']], 'cabin', coll='Cabin', ang=40)
    # ---- 仪表盒。从眼点看仪表，视线要从方向盘的气囊盖和轮圈之间那道缝里穿过去：
    # 先定方向盘（中心、往前倒 22°），再在 y = 735 这个深度上找表盘中心的高度，让视线正好穿过缝的中间，表盘正对眼睛
    WC = Vector((HP.x, 585.0, 925.0))
    T_ = radians(22)
    WN = Vector((0, cos(T_), -sin(T_)))       # 方向盘平面的法线 = 转向管柱的轴线（朝车头）
    WU = Vector((0, sin(T_), cos(T_)))        # 方向盘平面里的“上”
    R_, r_ = 178.0, 15.0                      # 轮圈中心半径、轮圈粗细的一半
    WIN = (50.0, R_ - r_ - 6)                 # 视线能穿过的缝：气囊盖上沿（44）留 6 mm 到轮圈内沿留 6 mm

    def through_wheel(P):
        """从眼点看 P，视线穿过方向盘平面的那一点在方向盘自己坐标里的高度"""
        dv = P - EYE
        t = WN.dot(WC - EYE) / WN.dot(dv)
        return WU.dot(EYE + dv * t - WC)
    lo_, hi_ = 800.0, 1300.0
    for _ in range(60):
        mid = (lo_ + hi_) / 2
        if through_wheel(Vector((HP.x, 735.0, mid))) < sum(WIN) / 2:
            lo_ = mid
        else:
            hi_ = mid
    CC = Vector((HP.x, 735.0, (lo_ + hi_) / 2))
    CN = (EYE - CC)
    CN = Vector((0, CN.y, CN.z)).normalized()            # 表盘法线：朝着眼睛
    CU = Vector((0, CN.z, -CN.y))                        # 表盘里的“上”
    CW, CHT = 330.0, 116.0
    tilt = math.degrees(math.atan2(CN.z, -CN.y))         # 表盘往后仰的角度
    k = bmesh.new()

    def fr(a_, b_, x_=0.0):
        return CC + CU * a_ + CN * b_ + Vector((x_, 0, 0))
    rbox(k, fr(0, -26), (CW + 34, 50, CHT + 34), 8, 0, 2, rot=(X, -tilt))              # 盒子
    rbox(k, fr(0, -1.5), (CW + 4, 3, CHT + 4), 1, 1, 1, rot=(X, -tilt))                # 表盘（网页在上面画表）
    rbox(k, fr(CHT / 2 + 24, 22), (CW + 40, 64, 10), 4, 0, 2, rot=(X, -tilt))          # 遮光罩
    rbox(k, fr(-CHT / 2 - 14, 8), (CW + 36, 22, 12), 3, 0, 1, rot=(X, -tilt))          # 下沿
    for sx in (-1, 1):
        rbox(k, fr(8, 24, sx * (CW / 2 + 15)), (10, 56, CHT + 40), 3, 0, 1, rot=(X, -tilt))
    add('Dash_Cluster', k, [M['softdark'], M['piano']], 'cabin', coll='Cabin', ang=40)
    top_, bot_ = through_wheel(CC + CU * CHT / 2), through_wheel(CC - CU * CHT / 2)
    ck['cluster'] = dict(c=[round(v, 2) for v in CC], n=[round(v, 5) for v in CN], u=[round(v, 5) for v in CU], w=CW, h=CHT,
                         tilt=round(tilt, 2), dist=round((EYE - CC).length, 1))
    ck['sight'] = dict(window=[WIN[0], round(WIN[1], 1)], top=round(top_, 1), bottom=round(bot_, 1))
    print(f'[cockpit] 仪表中心 y{CC.y:.0f} z{CC.z:.0f} 后仰 {tilt:.1f}°，视线穿过方向盘的高度 {bot_:.0f}…{top_:.0f}'
          f'（缝 {WIN[0]:.0f}…{WIN[1]:.0f}）')
    # ---- 中央通道：从后排出风口到仪表台下面，一圈圈截面连起来。扶手箱盖、两个杯架、斜的手机无线充电板
    c = bmesh.new()
    rings = []                                  # （c 是中央通道；仪表盒用的 k 已经交出去了）
    for y, zt_ in ((-330, 640), (-322, 756), (-300, 770), (150, 770), (172, 700), (196, 688), (450, 688), (480, 700),
                   (700, 742), (800, 760)):
        w_ = 250 + 24 * min(1.0, max(0.0, (y - 150) / 500))
        h_ = zt_ - 340
        rings.append([Vector((u, y, 340 + h_ / 2 + v)) for u, v in CK._rrect(w_, h_, 26, seg=3)])
    CK.loft(c, rings, 0)
    rbox(c, (0, -75, 776), (232, 430, 26), 12, 1, 2)
    for sx in (-56, 56):
        cyl(c, (sx, 325, 684), (sx, 325, 690.5), 41, mi=2, seg=24)
    rbox(c, (0, -332, 600), (150, 6, 56), 3, 2, 1)
    # 挡位面板：跟中央通道顶面一样往前抬 10.8°，中间一道槽。挡杆垂直于面板，轴心在面板下面 150 mm
    GY, GZ, GA = 535.0, 711.0, 10.8
    GU = Vector((0, cos(radians(GA)), sin(radians(GA))))      # 面板上朝车头的方向
    GN = Vector((0, -sin(radians(GA)), cos(radians(GA))))     # 面板法线（往后上方）
    rbox(c, (0, GY, GZ), (112, 172, 10), 6, 2, 2, rot=(X, GA))
    rbox(c, Vector((0, GY, GZ)) + GN * 5.2, (15, 106, 2), 2, 3, 1, rot=(X, GA))
    add('Console', c, [M['softdark'], M['leather'], M['piano'], M['rubber']], 'cabin', coll='Cabin', ang=45)
    pivot = Vector((0, GY, GZ)) - GN * 150
    sh = bmesh.new()
    cyl(sh, (0, 0, 40), (0, 0, 268), 6.5, mi=0, seg=12)
    ball(sh, (0, 0, 292), 24, mi=1, seg=20, sc=(1, 1.15, 1.35))
    rbox(sh, (-23, 0, 300), (8, 18, 12), 3, 2, 1)                                  # 解锁按钮（朝驾驶员那边）
    bmesh.ops.rotate(sh, verts=sh.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(radians(GA), 3, 'X'))
    add('Shifter', sh, [M['steel'], M['leather2'], M['piano']], 'cabin', loc=pivot, coll='Cabin', ang=40,
        extras=dict(kind='shifter'))
    hs = 155.0                                    # 轴心到面板上表面的距离：挡杆转 θ，过面板的那一点沿面板挪 −hs·tanθ
    ck['gate'] = dict(c=[round(v, 2) for v in Vector((-38, GY, GZ)) + GN * 5.4], u=[round(v, 5) for v in GU],
                      n=[round(v, 5) for v in GN], w=26, h=104,
                      at={g: round(-hs * math.tan(radians(a_)), 1) for g, a_ in CP['gate'].items()})
    ck['shifter'] = dict(pivot=[round(v, 1) for v in pivot])
    # ---- 方向盘（直径 356）：轮圈、气囊盖、三根辐条一个物体，原点在方向盘中心，绕转向管柱转。
    # 转向管柱护罩和两根拨杆不跟着转，单独一个物体
    w, col = bmesh.new(), bmesh.new()
    seg, m_ = 44, 12
    rings = []
    for kk in range(seg):
        t = 2 * pi * kk / seg
        rings.append([w.verts.new(((R_ + r_ * cos(2 * pi * j / m_)) * cos(t), r_ * sin(2 * pi * j / m_),
                                   (R_ + r_ * cos(2 * pi * j / m_)) * sin(t))) for j in range(m_)])
    tf = []
    for kk in range(seg):
        for j in range(m_):
            f = w.faces.new((rings[kk][j], rings[kk][(j + 1) % m_], rings[(kk + 1) % seg][(j + 1) % m_], rings[(kk + 1) % seg][j]))
            f.smooth = True
            tf.append(f)
    bmesh.ops.recalc_face_normals(w, faces=tf)
    rbox(w, (0, 36, -8), (150, 48, 104), 22, 0, 2)                              # 气囊盖
    for sx in (-1, 1):
        cyl(w, (sx * 60, 30, 2), (sx * 170, 4, 4), 18, 13, 0, seg=10)            # 左右辐条
        cyl(w, (sx * 24, 34, -46), (sx * 44, 5, -170), 13, 11, 0, seg=10)        # 下面两根
        cyl(col, (sx * 45, 112, 8), (sx * 168, 96, 28), 9, 7, 1, seg=8)          # 拨杆
    cyl(col, (0, 60, 0), (0, 300, 0), 42, 48, 1, seg=20)                        # 管柱护罩
    for bm_ in (w, col):
        bmesh.ops.rotate(bm_, verts=bm_.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(radians(-22), 3, 'X'))
    add('SteeringWheel', w, [M['softdark'], M['piano']], 'cabin', loc=WC, coll='Cabin', ang=45,
        extras=dict(kind='steer', axis=[0.0, round(WN.y, 5), round(WN.z, 5)]))
    add('SteeringColumn', col, [M['softdark'], M['piano']], 'cabin', loc=WC, coll='Cabin', ang=45)
    ck['wheel'] = dict(c=list(WC), axis=[0.0, round(WN.y, 5), round(WN.z, 5)], r=R_ + r_)
    # ---- 踏板：吊在仪表台下面，各绕自己的铰链转。右边窄的是油门，左边宽的是刹车（自动挡没有离合）
    ck['pedals'] = {}
    for nm, piv, pad_c, pad_s, arm_r, trav in (('Pedal_Acc', (-292, 1120, 650), (0, -35, -210), (48, 16, 120), 6, CP['acc_travel']),
                                                ('Pedal_Brake', (-412, 1116, 690), (0, -46, -228), (112, 16, 62), 8, CP['brake_travel'])):
        pd = bmesh.new()
        vs = rbox(pd, pad_c, pad_s, 5, 1, 1, rot=(X, -28))
        top = Vector(pad_c) + Matrix.Rotation(radians(-28), 3, 'X') @ Vector((0, 0, pad_s[2] / 2 - 8))
        cyl(pd, (0, 0, 8), top, arm_r, mi=0, seg=10)
        cyl(pd, (-14, 0, 0), (14, 0, 0), 11, mi=0, seg=12)                    # 铰链套
        # 踩到底时踏板最靠前的一点离前围板还有多远；松开时离地板多高
        rot = Matrix.Rotation(radians(trav), 3, 'X')
        y_max = max((rot @ v.co).y for v in vs) + piv[1]
        z_min = min(v.co.z for v in vs) + piv[2]
        ck['pedals'][nm] = dict(pivot=list(piv), travel=trav, firewall=round(SH.Y_FIREWALL - 6 - y_max, 1),
                                floor=round(z_min - FLOOR_TOP, 1))
        add(nm, pd, [M['steel'], M['rubber']], 'cabin', loc=piv, coll='Cabin', ang=40, extras=dict(kind='pedal', travel=trav))
    pb = bmesh.new()
    rbox(pb, (-352, 1150, 672), (176, 66, 74), 6, 0, 1)                         # 踏板支架，挂在前围板上
    add('Pedal_Box', pb, [M['steel']], 'cabin', coll='Cabin', ang=40)
    # ---- 坐在驾驶位能看到什么：头顶离顶棚多远；车头前面多远以内的地面被前盖挡住（沿驾驶员正前方）
    ck['headroom'] = round(skin_top_z(EYE.y, abs(EYE.x)) - 40 - EYE.z, 1)
    best = None
    for yy in range(int(SH.Y_COWL) + 10, int(SH.Y_NOSE) - 4, 10):
        zt = skin_top_z(yy, abs(EYE.x))
        if zt is None:
            continue
        sl = (EYE.z - zt) / (yy - EYE.y)
        if best is None or sl < best[0]:
            best = (sl, yy, zt)
    g_ = EYE.y + EYE.z / best[0]
    ck['blind'] = dict(down_deg=round(math.degrees(math.atan(best[0])), 2), graze=[best[1], round(best[2], 1)],
                       ground=round(g_, 0), ahead_of_nose=round(g_ - SH.Y_NOSE, 0))
    ck['look'] = [EYE.x, EYE.y + 2600, EYE.z - 260]
    print(f"[cockpit] 头顶到顶棚 {ck['headroom']:.0f} mm，车头前 {ck['blind']['ahead_of_nose'] / 1000:.1f} m 以内的地面看不见；"
          f"踏板踩到底离前围板 {ck['pedals']['Pedal_Acc']['firewall']:.0f} / {ck['pedals']['Pedal_Brake']['firewall']:.0f} mm")
    # ================= 贴在车身上的内饰板：和车板用同一块区域，沿法线往车里收（carkit.inner），所以和车身严丝合缝
    # 顶棚：车顶那一片往里 40；前到前挡上沿，后到后挡上沿
    t = bmesh.new()
    CK.inner(t, CH['roof'], [(Y_WS1 - 26, 12), (Y_WS1 - 26, 10.2), (Y_WS1 - 34, RAIL - .05), (Y_BK1 + 34, RAIL - .05),
                             (Y_BK1 + 26, 10.2), (Y_BK1 + 26, 12)], depth=40, grid=60)
    add('Trim_Headliner', t, [M['headliner']], 'trim', coll='Cabin', ang=40)
    # 柱子饰板 + 车门窗框内侧：腰线以上、车顶边那道棱以下的整条侧窗带（A 柱、B 柱上段、C 柱），挖掉三个窗洞。
    # 只做到棱下面约 50 mm：往里收 46 mm 的面跨过一道紧的棱会自己打折
    t = bmesh.new()
    S_TRIM = 8.80
    outline = [(1080, BELT + .03), (1080, S_TRIM), (Y_DECK + 60, S_TRIM), (Y_DECK + 60, BELT + .03)]
    CK.inner(t, S, outline, holes=[grow(S, GH[k], 5) for k in ('win_f', 'win_r', 'win_q')], depth=46, grid=50)
    add('Trim_Pillars', t, [M['headliner']], 'trim', coll='Cabin', ang=40)
    # 门板：车门那块区域往里 118（车门厚度），上面压一条腰线窗台，中间一根扶手，下面一个储物槽，前门下角一只喇叭
    def z_belt(y):
        return SKIN.p(y, BELT).z + 3
    S_DT = 5.90                              # 门板上沿收在肩线那道棱下面（跨过棱往里收 118 mm 会打折），上面压着窗台
    for nm, poly, ya, yb in (('Trim_DoorF', [(1104, S_DT)] + L_DOOR_F[2:] + [(60, SILL), (60, S_DT)], 1050, 100),
                             ('Trim_DoorR', [(60, S_DT), (60, SILL)] + L_DOOR_R[:1:-1] + [(-1163, S_DT)], 20, -1100)):
        t = bmesh.new()
        CK.inner(t, S, poly, depth=118, grid=60)
        CK.door_ridge(t, SKIN, ya, yb, z_belt, lambda y: z_belt(y) - 58, 38, 126, mi=1)             # 窗台
        CK.door_ridge(t, SKIN, ya - 150, yb + 60, 774, 716, 108, 192, mi=1, taper=110)            # 扶手
        CK.door_ridge(t, SKIN, ya - 250, yb + 120, 470, 400, 108, 150, mi=2, taper=60)             # 储物槽
        if nm == 'Trim_DoorF':
            for sx in (1, -1):
                s_ = SKIN.s_at_z(880, 500, 3.0, 7.0)
                q, nn = SKIN.p(880, s_, sx), SKIN.n(880, s_, sx)
                CK.disc(t, q - nn * 121, nn, 82, 6, mi=3, seg=28)
        add(nm, t, [M['softlight'], M['softdark'], M['fabric2'], M['piano']], 'trim', coll='Cabin', ang=40)
    # 后隔板（衣帽架）：后排靠背顶到尾箱盖前缘，溜背后挡玻璃下面看到的就是它；上面两只喇叭罩
    t = bmesh.new()
    rings = []
    for y in (-1110, -1200, -1300, -1400, Y_BK0 - 4):
        hw_ = SKIN.p(y, BELT).x - 72
        z_ = 968 + (y + 1110) * -.02
        rings.append([Vector((u, y, z_ + v)) for u, v in CK._rrect(2 * hw_, 18, 6, seg=2)])
    CK.loft(t, rings, 0)
    for sx in (-1, 1):
        CK.disc(t, (sx * 430, -1290, 981), (0, 0, 1), 72, 4, mi=1, seg=28)
    add('Trim_Shelf', t, [M['fabric2'], M['piano']], 'trim', coll='Cabin', ang=40)
    # 车内后视镜：粘在前挡上沿正中
    t = bmesh.new()
    rbox(t, (0, 742, 1336), (232, 22, 64), 12, 0, 2, rot=(X, -12))
    cyl(t, (0, 706, 1398), (0, 738, 1346), 9, mi=0, seg=10)
    add('Trim_RearMirror', t, [M['piano']], 'trim', coll='Cabin', ang=40)
    return ck


def setup_render():
    sc = bpy.context.scene
    w = bpy.data.worlds.new('World')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = next(n for n in nt.nodes if n.type == 'BACKGROUND')
    # 环境：镜头直接看到的背景是一片深蓝；车漆反射到的是一个上下渐变的“摄影棚”
    # （地平线附近一条亮带、头顶暗、地平线以下更暗），侧面肩线上会有一道柔和的亮带
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    mp = nt.nodes.new('ShaderNodeMapRange')
    mp.inputs['From Min'].default_value, mp.inputs['From Max'].default_value = -1.0, 1.0
    cr = ramp.color_ramp
    cr.elements[0].position, cr.elements[0].color = 0.0, (*hexcol('#05080d'), 1)
    cr.elements[1].position, cr.elements[1].color = 1.0, (*hexcol('#1c2c44'), 1)
    for pos, col in ((.47, '#0a111c'), (.52, '#8ea4bf'), (.62, '#41566f'), (.80, '#22344e')):
        e = cr.elements.new(pos)
        e.color = (*hexcol(col), 1)
    lp = nt.nodes.new('ShaderNodeLightPath')
    mixc = nt.nodes.new('ShaderNodeMixRGB')
    mixc.inputs['Color2'].default_value = (*hexcol('#0b1626'), 1)
    nt.links.new(geo.outputs['Incoming'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mp.inputs['Value'])
    nt.links.new(mp.outputs[0], ramp.inputs[0])
    nt.links.new(lp.outputs['Is Camera Ray'], mixc.inputs['Fac'])
    nt.links.new(ramp.outputs[0], mixc.inputs['Color1'])
    nt.links.new(mixc.outputs[0], bg.inputs[0])
    bg.inputs[1].default_value = 1.3

    def light(name, loc_, energy, size):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.energy = energy
        ld.size = size
        ob = bpy.data.objects.new(name, ld)
        collection('Studio').objects.link(ob)
        ob.location = loc_
        d = Vector((0, .2, .5)) - Vector(loc_)
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

    # 主灯放在镜头这一侧的左前上方。原来它在左后上方、5 米大：左侧窗（往里倾 37°）和前挡左半边（往两边包）
    # 都像镜子一样把它反出来，窗是一片白、看不见车里。从左前方看，玻璃反射的方向全朝后（y < 0），灯在前面就反不进来
    # 灯箱都做得很大（8 米）：同样的照度下灯面亮度低，映在车顶、前盖上是一片柔和的光，不是一块刺眼的白斑
    light('Key', (-3.4, 4.6, 6.0), 1700, 8.0)
    light('Rim', (4.6, 3.6, 2.8), 800, 8.0)
    light('Fill', (-4.6, 2.6, 1.8), 500, 5.0)
    # 车里一盏顶灯：不然隔着玻璃、顶棚往里看是黑的
    ld = bpy.data.lights.new('CabinLamp', 'POINT')
    ld.energy = 8
    ld.shadow_soft_size = .12
    ob = bpy.data.objects.new('CabinLamp', ld)
    collection('Studio').objects.link(ob)
    ob.location = (0, -.15, 1.33)
    # 地面
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30000)
    gm = principled('Ground', '#101a29', rough=.5)
    me = bpy.data.meshes.new('Ground')
    bm.to_mesh(me)
    bm.free()
    me.transform(Matrix.Scale(MM, 4))
    me.materials.append(gm)
    g = bpy.data.objects.new('Ground', me)
    collection('Studio').objects.link(g)
    g.hide_viewport = False
    cam_d = bpy.data.cameras.new('Camera')
    cam_d.lens = 58
    cam_d.clip_start = .05
    cam_d.clip_end = 80
    cam = bpy.data.objects.new('Camera', cam_d)
    collection('Studio').objects.link(cam)
    sc.camera = cam
    return cam


def thin_glass(name='GlassRender', tint='#dbe6e8', refl=.5):
    """渲图用的薄玻璃。车窗是单层面片，用真折射（Transmission）的话：光进了玻璃找不到出口，
    车里一片黑；Cycles 的阴影光线也穿不过折射面，车里照不到灯。所以改成建筑渲染常用的做法：
    透明（tint 决定透光率）+ 菲涅尔反射（IOR 1.52：正着看反射 4%，越斜越亮）。透明部分阴影光线能穿过去。
    refl 把反射再压一压：前后挡很斜，照实算的话仪表台、天空会在玻璃上映成一大片，看不清车里"""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    tr.inputs['Color'].default_value = (*hexcol(tint), 1)
    # 反射不用真的镜面（会把灯箱映成一块块白斑，看着像玻璃破了洞），按反射方向的仰角给一个渐变的“天空色”
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sp = nt.nodes.new('ShaderNodeSeparateXYZ')
    rp = nt.nodes.new('ShaderNodeValToRGB')
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value = -1.0, 1.0
    rp.color_ramp.elements[0].position, rp.color_ramp.elements[0].color = .46, (*hexcol('#0a111c'), 1)
    rp.color_ramp.elements[1].position, rp.color_ramp.elements[1].color = 1.0, (*hexcol('#33475f'), 1)
    e = rp.color_ramp.elements.new(.53)
    e.color = (*hexcol('#a9bdd4'), 1)
    e = rp.color_ramp.elements.new(.68)
    e.color = (*hexcol('#5a7391'), 1)
    gl = nt.nodes.new('ShaderNodeEmission')
    gl.inputs['Strength'].default_value = 1.0
    nt.links.new(tc.outputs['Reflection'], sp.inputs[0])
    nt.links.new(sp.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs[0], rp.inputs[0])
    nt.links.new(rp.outputs[0], gl.inputs['Color'])
    fr = nt.nodes.new('ShaderNodeFresnel')
    fr.inputs['IOR'].default_value = 1.52
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = refl
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(fr.outputs[0], mul.inputs[0])
    nt.links.new(mul.outputs[0], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(gl.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return m


def aim(cam, pos, tgt):
    cam.location = Vector(pos)
    cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()


def render(cam, name, pos, tgt, hide=(), frame=1, show=None, lens=58):
    sc = bpy.context.scene
    # 从车后面拍时把三盏灯绕车转 180°：主灯永远在镜头这一侧，不会正好映在车顶上晃成一片白
    for ob in bpy.data.objects:
        if ob.type == 'LIGHT' and ob.data.type == 'AREA':
            base = ob.get('base_loc')
            if base is None:
                base = ob['base_loc'] = tuple(ob.location)
            k = -1.0 if pos[1] < -1.0 else 1.0
            ob.location = (k * base[0], k * base[1], base[2])
            ob.rotation_euler = (Vector((0, .2 * k, .5)) - ob.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = ARGS.samples
    sc.cycles.use_denoising = True
    sc.cycles.device = 'CPU'
    sc.frame_set(frame)
    sc.render.resolution_x = ARGS.res
    sc.render.resolution_y = int(ARGS.res * .6)
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 84
    items = [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items]
    sc.view_settings.view_transform = 'AgX' if 'AgX' in items else 'Filmic'
    aim(cam, pos, tgt)
    # 网页用 alpha 半透明玻璃；渲图时临时换成 thin_glass（GLB 已经导出了，不受影响）
    pairs = [(bpy.data.materials.get('Glass'), thin_glass()),
             (bpy.data.materials.get('GlassTint'), thin_glass('GlassTintRender', '#6f7c84', .7))]
    swapped = []
    for ob, _ in OBJS:
        for sl in ob.material_slots:
            for gm, tg in pairs:
                if gm is not None and sl.material is gm:
                    sl.material = tg
                    swapped.append((sl, gm))
    for ob, _ in OBJS:
        ob.hide_render = any(ob.name.startswith(h) for h in hide) or (show is not None and not any(ob.name.startswith(h) for h in show))
    sc.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    print('[OK] rendered', name)
    for sl, gm in swapped:
        sl.material = gm
    for ob, _ in OBJS:
        ob.hide_render = False


HIDE_EE = []
PT_SHOW = ('Eng_', 'Cvt_', 'Drv_', 'PT_', 'Bay_', 'Exh_', 'Fuel_')          # 动力系统的全部件
PT_INSIDE = ('Eng_Crank', 'Eng_Piston', 'Eng_Rod', 'Eng_Cam', 'Eng_Valve', 'Eng_Chain', 'Cvt_Turbine', 'Cvt_FwdRev', 'Cvt_Pri',
             'Cvt_Sec', 'Cvt_OutGear', 'Cvt_Idler', 'Cvt_Diff', 'Cvt_Belt', 'Drv_')   # 拿掉壳体以后剩下的：会动的件
# 看座舱时拿掉的件：车顶、车门、窗框、玻璃、顶棚、门板（柱子和后翼子板留着）
CUT_HIDE = ('Panel_Roof', 'Panel_Door', 'Panel_Sash', 'Panel_BPillar', 'Glass', 'Trim_Headliner', 'Trim_Door',
            'Trim_RearMirror', 'Mirrors')
# 检查用的机位：名字 → (相机位置, 目标点, 焦距, 另外要藏的件)。侧 / 前 / 后 / 顶四张用长焦，接近正投影，拿来和真车照片比轮廓
CHECK_VIEWS = dict(
    side=((-16, 0, .72), (0, 0, .72), 105, ()),
    front=((0, 16, .75), (0, 0, .72), 230, ()),
    rear=((0, -16, .75), (0, 0, .72), 230, ()),
    top=((0, 0.001, 18), (0, 0, 0), 125, ()),
    q34f=((-4.3, 5.9, 1.55), (0, .15, .62), 58, ()),
    q34r=((4.4, -5.9, 1.65), (0, -.15, .62), 58, ()),
    lowf=((-2.6, 6.6, .75), (0, .6, .6), 58, ()),
    lowr=((2.6, -6.6, .8), (0, -.6, .62), 58, ()),
    cut=((-3.7, 3.3, 3.2), (0, -.2, .55), 58, CUT_HIDE),
    cutr=((-3.3, -3.5, 3.4), (0, .25, .6), 58, CUT_HIDE),
    cuttop=((0, -.25, 7.5), (0, -.2, 0), 70, CUT_HIDE),
    wheel=((-2.9, 2.5, .62), (-.9, 1.4, .36), 62, ()),
    apillar=((-3.3, 3.9, 1.75), (-.78, .95, 1.08), 230, ()),
    abase=((-2.6, 2.6, 1.5), (-.86, 1.1, .95), 260, ()),
    dash=((0, -.55, 1.13), (0, 1.0, .86), 17, ()),
    driver=((-.37, -.02, 1.14), (-.25, 1.0, .84), 15, ()),
    rearseat=((0, .45, 1.16), (0, -1.0, .72), 17, ()),
    doorview=((.55, .2, 1.05), (-.9, .25, .75), 15, ()),
)


def check_views(cam, names):
    """调外形 / 内饰时的检查图：环境光调亮（不然背光面全黑），其余和正式渲图一样"""
    bg = next(n for n in bpy.context.scene.world.node_tree.nodes if n.type == 'BACKGROUND')
    old = bg.inputs[1].default_value
    bg.inputs[1].default_value = 2.0
    for nm in names:
        if nm.startswith('cam:'):
            # 临时机位：cam:名字:x/y/z:tx/ty/tz:焦距（单位米）
            _, tag, a, b, c = nm.split(':')
            pos, tgt, lens, extra = tuple(float(v) for v in a.split('/')), tuple(float(v) for v in b.split('/')), float(c), ()
            nm = tag
        elif nm not in CHECK_VIEWS:
            print('[check] 没有这个机位:', nm)
            continue
        else:
            pos, tgt, lens, extra = CHECK_VIEWS[nm]
        render(cam, f'check_{nm}.jpg', pos, tgt, hide=HIDE_EE + list(extra), lens=lens,
               show=[v for v in ARGS.only.split(',') if v] or None)
    bg.inputs[1].default_value = old


def animate():
    """爆炸动画：外壳上升、座舱抬起、底盘下沉，线束和盒子留在原地"""
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, FRAMES + 1
    for ob, g in OBJS:
        ex = EX.get(g, (0, 0, 0, 0))
        if not any(ex[:3]) and 'ex' not in ob:
            continue
        base = ob.location.copy()
        ob.keyframe_insert('location', frame=1)
        ob.location = base + Vector(ex[:3]) * MM + Vector((ob.get('ex', 0) * .5, 0, 0))
        ob.keyframe_insert('location', frame=FRAMES + 1)
        ob.location = base


def export_glb(path, prefix=None):
    bpy.context.scene.frame_set(1)
    for ob in bpy.context.scene.objects:
        ob.hide_viewport = False
        ob.hide_set(False)
        ob.select_set(ob.type == 'MESH' and ob.name != 'Ground' and (prefix is None or ob.name.startswith(prefix)))
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_extras=True,
              export_yup=True, export_animations=False, export_cameras=False, export_lights=False)
    bpy.ops.export_scene.gltf(**kw)
    print('[OK] exported', path, os.path.getsize(path) // 1024, 'KB')



def main():
    reset()
    M = make_materials()
    setup_skin()
    setup_greenhouse()
    skip = set(v for v in ARGS.skip.split(',') if v)
    if 'frame' not in skip:
        build_frame(M)
    gaps = build_panels(M)
    build_glass(M)
    build_wheels(M)
    if 'chassis' not in skip:
        build_chassis(M)
    ck = None
    if 'cabin' not in skip:
        ck = build_cabin(M)
    pt = None
    if 'powertrain' not in skip:
        from types import SimpleNamespace
        pt = PT.build(M, SimpleNamespace(add=add, rbox=rbox, cyl=cyl, lathe=lathe, grp=grp, skin_top_z=skin_top_z))
    if ARGS.pt == 'ehev':
        main_ehev(M)
        return
    tris = 0
    for o, _ in OBJS:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    spec = dict(groups=GROUPS, explode={k: list(v) for k, v in EX.items()}, objects={o.name: g for o, g in OBJS}, tris=tris,
                gaps=gaps, dims=dict(L=Y_NOSE - Y_TAIL, WB=2 * WB, track=2 * TRACK, r_tyre=R_TYRE), params=PT.P, powertrain=pt, cockpit=ck)
    cam = setup_render()
    if not ARGS.noexport:
        with open(os.path.join(OUT, 'spec.json'), 'w', encoding='utf-8') as f:
            json.dump(spec, f, ensure_ascii=False, separators=(',', ':'))
        export_glb(os.path.join(OUT, 'car.glb'))
        animate()
        aim(cam, (-5.4, 6.2, 2.1), (0, .1, .62))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'car.blend'), compress=True)
        print('[OK] saved car.blend')
    if ARGS.check:
        check_views(cam, [v for v in ARGS.check.split(',') if v])
    if ARGS.render:
        views = dict(
            exterior=((-5.6, 6.3, 2.0), (0, .05, .6), 58, ()),
            exterior_rear=((5.2, -6.4, 2.1), (0, -.05, .6), 58, ()),
            side=((-16, 0, .72), (0, 0, .72), 105, ()),
            front=((0, 16, .75), (0, 0, .72), 230, ()),
            rear=((0, -16, .75), (0, 0, .72), 230, ()),
            interior=((0, -.3, 1.17), (-.12, 1.0, .88), 16, ()),
            driver=((-.37, -.01, 1.222), (-.37, 2.59, .962), 15, ()),      # 驾驶员的眼点（params.json 的 cockpit）
            cabin=((-3.3, -3.5, 3.4), (0, .25, .6), 58, CUT_HIDE),
            # 动力系统：打开前盖 / 只看动力总成 / 拿掉壳体看里面 / 拿掉车身看底盘
            bay=((-1.5, 4.3, 2.5), (0, 1.62, .62), 58, ('Panel_Hood',)),
            powertrain=((-1.9, 3.3, 1.45), (0, 1.5, .47), 58, None, ('Eng_', 'Cvt_', 'Drv_', 'PT_')),
            internals=((-1.9, 3.3, 1.45), (0, 1.5, .47), 58, None, PT_INSIDE),
            chassis=((-4.4, -3.6, 4.0), (0, -.1, .25), 58, None, ('Wheel_', 'Brake_', 'Subframes') + PT_SHOW),
        )
        want = [v for v in ARGS.views.split(',') if v] or list(views)
        for nm in want:
            pos, tgt, lens, hide = views[nm][:4]
            show = views[nm][4] if len(views[nm]) > 4 else None
            render(cam, f'view_{nm}.jpg', pos, tgt, hide=list(hide or ()), lens=lens, show=list(show) if show else None)
    print(f'[OK] {len(OBJS)} objects, {tris} triangles')


# 混动版里不要的件：燃油机和 CVT 自己的东西。水箱、风扇、排气管、油箱两套动力共用，留着
EHEV_DROP = ('Eng_', 'Cvt_', 'Drv_', 'PT_Mounts', 'Bay_Intake')
EHEV_INSIDE = ('H_Eng_Crank', 'H_Eng_Piston', 'H_Eng_Rod', 'H_Eng_Cam', 'H_Eng_Valve', 'H_Eng_Chain', 'H_Eng_Plugs', 'H_Eng_BlockR',
               'H_Flywheel', 'H_InputShaft', 'H_Clutch', 'H_OdGear', 'H_GenShaft', 'H_MotShaft', 'H_MotStator', 'H_GenStator',
               'H_Counter', 'H_Diff', 'H_Bearings', 'H_Shaft', 'H_Busbars')


def main_ehev(M):
    """--pt ehev：车身照常建，燃油机和 CVT 拿掉，换成 powertrain_ehev.py 的两电机混动。
    只写 pt_ehev.glb（H_ 开头的件）、spec_ehev.json、car_ehev.blend 和 view_ehev_*.jpg；car.glb / spec.json 不动"""
    from types import SimpleNamespace
    for ob, g in list(OBJS):
        if ob.name.startswith(EHEV_DROP) and not ob.name.startswith(('Eng_dummy',)):
            OBJS.remove((ob, g))
            bpy.data.objects.remove(ob, do_unlink=True)
    pt = PTE.build(M, SimpleNamespace(add=add, rbox=rbox, cyl=cyl, ball=ball, lathe=lathe, grp=grp, skin_top_z=skin_top_z,
                                      principled=principled))
    hy = [(o, g) for o, g in OBJS if o.name.startswith('H_')]
    tris = 0
    for o, _ in hy:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    spec = dict(objects={o.name: o.get('g', '') for o, _ in hy}, tris=tris, params=PT.P['ehev'], engine=PT.P['engine'], **pt)
    cam = setup_render()
    if not ARGS.noexport:
        with open(os.path.join(OUT, 'spec_ehev.json'), 'w', encoding='utf-8') as f:
            json.dump(spec, f, ensure_ascii=False, separators=(',', ':'))
        export_glb(os.path.join(OUT, 'pt_ehev.glb'), prefix='H_')
        aim(cam, (-5.4, 6.2, 2.1), (0, .1, .62))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'car_ehev.blend'), compress=True)
        print('[OK] saved car_ehev.blend')
    if ARGS.check:
        check_views(cam, [v for v in ARGS.check.split(',') if v])
    if ARGS.render:
        ax = PTE.AX_M
        my, mz = ax[0] * MM, ax[1] * MM
        ALLPT = ('H_', 'Bay_', 'Exh_', 'Fuel_')
        views = dict(
            ehev_bay=((-1.5, 4.3, 2.5), (0, 1.62, .62), 58, ('Panel_Hood',)),
            ehev_powertrain=((-2.1, 3.5, 1.5), (-.05, 1.52, .5), 62, None, ('H_Eng', 'H_Case', 'H_PCU', 'H_Busbars', 'H_Shaft', 'H_Mounts',
                                                                           'H_Flywheel', 'H_EComp')),
            ehev_internals=((-2.1, 3.5, 1.5), (-.05, 1.52, .5), 62, None, EHEV_INSIDE),
            ehev_ecvt=((-1.35, 2.75, 1.25), (-.24, my, mz - .02), 75, None,
                       tuple(n for n in EHEV_INSIDE if not n.startswith('H_Eng')) + ('H_Flywheel',)),
            ehev_motor=((-1.25, 2.25, .95), (-.3, my, mz), 120, None, ('H_MotShaft', 'H_GenShaft', 'H_MotStator', 'H_GenStator', 'H_Bearings',
                                                                       'H_Busbars')),
            ehev_engine=((1.5, 3.3, 1.2), (.11, 1.56, .52), 70, None, ('H_Eng_BlockR', 'H_Eng_Pan', 'H_Eng_Crank', 'H_Eng_Piston', 'H_Eng_Rod',
                                                                        'H_Eng_Cam', 'H_Eng_Valve', 'H_Eng_Chain', 'H_Eng_Plugs', 'H_Eng_Exhaust',
                                                                        'H_Flywheel')),
            ehev_chassis=((-4.4, -3.6, 4.0), (0, -.1, .25), 58, None, ('Wheel_', 'Brake_', 'Subframes') + ALLPT),
            ehev_battery=((-2.6, -3.9, 2.3), (0, -1.3, .7), 62, ('Panel_Trunk', 'Panel_SideOuter', 'Panel_BumperR', 'Panel_TailCap', 'Glass',
                                                                 'GlassBond', 'Trim_Shelf', 'Panel_Roof', 'Trim_Headliner', 'Trim_Pillars',
                                                                 'Lamp_', 'Seals', 'Seams', 'BIW', 'Bumpers', 'Plates', 'H_IPU_Lid',
                                                                 'Panel_DoorR', 'Panel_SashR', 'Trim_DoorR', 'Wheelhouse')),
        )
        want = [v for v in ARGS.views.split(',') if v] or list(views)
        for nm in want:
            if nm not in views:
                print('[render] 没有这个机位:', nm)
                continue
            pos, tgt, lens, hide = views[nm][:4]
            show = views[nm][4] if len(views[nm]) > 4 else None
            hide = list(hide or ())
            if nm in ('ehev_ecvt', 'ehev_motor'):
                hide += ['H_MotStatorQ', 'H_GenStatorQ']           # 定子剖掉四分之一，看见转子
            render(cam, f'view_{nm}.jpg', pos, tgt, hide=hide, lens=lens, show=list(show) if show else None)
    print(f'[OK] ehev: {len(hy)} objects, {tris} triangles')


if __name__ == "__main__":
    main()
