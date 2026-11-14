#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
软件定义汽车 · Blender 纯脚本建模（虚构教学车，不对应任何具体产品）

同一辆车、同一套外设，只换电子电气架构：
    A 分布式 34 个盒子 / B 域集中 25 个 / C 中央+区域 12 个
线束不是画的：每根线都在一张“道路图”上走最短路，经过同一段路的线捆成一束，
束的粗细、总长、估算重量全部由线的条数算出来，写进 spec.json。

运行方式（二选一）:
    blender -b -P build_sdv.py -- --out out [--render]
    python  build_sdv.py --out out [--render]      # 需要 pip install bpy

输出:
    sdv.blend    Blender 工程；按空格播放 = 爆炸动画（第 1 帧装配，第 121 帧拆开）
    sdv.glb      给网页用（零件独立命名，extras 里带分组）
    spec.json    盒子、功能、外设、线束统计、网络路径（网页读这一份）
    view_*.jpg   只有加 --render 时才渲染（Cycles）

坐标约定:
    尺寸按毫米写，建完缩放成米。+X 车右，+Y 车头，+Z 朝上，原点在前后轴中点的地面。
"""
import argparse
import heapq
import json
import math
import os
import sys
from bisect import bisect_right
from math import cos, pi, radians, sin, sqrt

import bpy  # 必须排在 bmesh 前面：pip 版 bpy 导入后才注册 bmesh / mathutils
import bmesh
from mathutils import Matrix, Vector
from mathutils.geometry import delaunay_2d_cdt

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import ee_data as D  # noqa: E402
import carkit as CK  # noqa: E402  汽车建模套件的副本，母版在仓库根目录 汽车建模套件/

_argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
_ap = argparse.ArgumentParser()
_ap.add_argument('--out', default=os.path.join(HERE, 'out'))
_ap.add_argument('--render', action='store_true')
_ap.add_argument('--samples', type=int, default=48)
_ap.add_argument('--res', type=int, default=1400)
_ap.add_argument('--stage', default='', help='只渲一张阶段图：frame / panels / glass / seats / interior')
_ap.add_argument('--check', default='', help='检查用的机位，逗号分隔：side,front,rear,top,q34f,q34r,cabin,dash,rearseat,cut')
_ap.add_argument('--only', default='', help='检查图里只显示名字以这些前缀开头的件，逗号分隔（找问题件时用）')
_ap.add_argument('--noexport', action='store_true', help='只建模渲图，不写 glb / blend / spec（调外形时用）')
ARGS, _ = _ap.parse_known_args(_argv)
OUT = os.path.abspath(ARGS.out)
os.makedirs(OUT, exist_ok=True)

MM = 0.001
FRAMES = 120
WB = 1400.0          # 前后轴到原点
R_TYRE = 345.0
R_ARCH = 378.0
TRACK = 770.0        # 轮胎中面（轮胎外侧面 = TRACK + 118，比轮拱处车身往里收约 20 mm）


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
        tyre=principled('Tyre', '#15171a', rough=.86),
        rim=principled('Rim', '#b9c1ca', metal=.92, rough=.3),
        rimdark=principled('RimDark', '#2b3036', metal=.6, rough=.42),
        disc=principled('Disc', '#8d949c', metal=.9, rough=.42),
        lamp=principled('Lamp', '#eaf3ff', metal=.1, rough=.15, emit=('#dcebff', 3.0)),
        tail=principled('TailLamp', '#a00d18', rough=.2, emit=('#ff1a2c', 2.2)),
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


# ---------------------------------------------------------------- 车身曲面
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


Y_TAIL, Y_NOSE = -2415.0, 2345.0
# ---- 外形：五条沿车长的曲线（侧视的顶线 / 腰线 / 底线，俯视的最宽线 / 车顶宽线）+ 一个横截面配方 ----
# 比例照 2025 年主流的 B/C 级电动轿车定（公开参数，见 README“外形依据”）：
#   长 4760、宽 1864、高 1455、轴距 2800（Model 3：4720 / 1850 / 1441 / 2875；凯美瑞：4920 / 1840 / 1445 / 2825）
#   前悬 945、后悬 1015（Model 3：868 / 977；凯美瑞：975 / 1085）；离地 172（138 ~ 145 是满载到底盘最低点，门槛下沿更高）
#   前盖前缘高约 730、前挡下沿（前围上盖板）高约 1000、前挡倾角约 29°、车顶最高点在 B 柱附近、
#   溜背后挡倾角约 17°、短尾箱盖带一道上翘的小扰流沿、腰线前低后高（B 柱处约 960）
# 车头车尾不是一刀切平，也不靠一串手调的点去凑：五条曲线先按“车身一直延伸到头”画（_b 结尾的那几条），
# 再在最后两三百毫米里乘一个超椭圆收口函数 q(u) = (1 - (1-u)^n)^(1/n)：俯视轮廓往里收成一段大圆弧，
# 顶线往下卷、底线往上收到车头 / 车尾最突出的那个高度（ZMID）。收口是解析函数，曲率连续，车漆反光不起斑；
# 最后只剩车牌大小的一块平面（NoseCap / TailCap，被车牌盖住）
ZTOP_b = _prof([(-2415, 1070), (-2310, 1076), (-2150, 1081), (-1950, 1092), (-1700, 1160), (-1300, 1285), (-900, 1385),
                (-400, 1445), (-100, 1455), (250, 1432), (480, 1362), (820, 1180), (1170, 995), (1450, 948), (1800, 868),
                (2050, 792), (2200, 738), (2345, 672)])
ZBELT_b = _prof([(-2415, 1010), (-2310, 1014), (-2150, 1016), (-1950, 1022), (-1700, 1036), (-1300, 1022), (-600, 990),
                 (60, 962), (600, 942), (1170, 922), (1450, 862), (1800, 786), (2050, 716), (2200, 668), (2345, 610)])
ZBOT_b = _prof([(-2415, 300), (-2250, 245), (-2100, 210), (-1900, 190), (-1400, 172), (1400, 172), (1900, 185), (2100, 210),
                (2240, 250), (2345, 300)])
HW_b = _prof([(-2415, 800), (-2250, 842), (-2100, 885), (-1900, 915), (-1400, 932), (0, 926), (1400, 930), (1800, 905),
              (2000, 868), (2130, 822), (2240, 770), (2345, 715)])
HT_b = _prof([(-2415, 610), (-2250, 635), (-2100, 660), (-1950, 650), (-1700, 625), (-1300, 600), (-400, 596), (300, 596),
              (480, 615), (820, 690), (1170, 770), (1450, 760), (1800, 735), (2000, 700), (2130, 655), (2240, 600),
              (2345, 550)])
# 收口参数：(俯视收口长度, 指数, 端面剩下的宽度比例), (侧视收口长度, 指数, 端面剩下的高度比例), 最突出点的高度
CLOSE_NOSE = ((420.0, 2.6, .50), (230.0, 2.2, .16), 505.0)
CLOSE_TAIL = ((300.0, 2.8, .55), (220.0, 2.6, .22), 660.0)


def _q(u, n):
    return 1.0 if u >= 1 else (1 - (1 - max(u, 0.0)) ** n) ** (1 / n)


def _close(y):
    """(俯视系数, 侧视系数, ZMID)：离车头 / 车尾远的地方两个系数都是 1"""
    d_n, d_t = Y_NOSE - y, y - Y_TAIL
    (pp, pz, zm), d = (CLOSE_NOSE, d_n) if d_n < d_t else (CLOSE_TAIL, d_t)
    return pp[2] + (1 - pp[2]) * _q(d / pp[0], pp[1]), pz[2] + (1 - pz[2]) * _q(d / pz[0], pz[1]), zm


def ZTOP(y):
    _, fz, zm = _close(y)
    return zm + (ZTOP_b(y) - zm) * fz


def ZBELT(y):
    _, fz, zm = _close(y)
    return zm + (ZBELT_b(y) - zm) * fz


def ZBOT(y):
    _, fz, zm = _close(y)
    return zm - (zm - ZBOT_b(y)) * fz


def HW(y):
    return HW_b(y) * _close(y)[0]


def HT(y):
    return HT_b(y) * _close(y)[0]


NSEG = 12


def section_ctrl(y):
    """一个横截面的 13 个控制点（右半边，从底部中线绕到车顶中线）。序号就是曲面参数 s：
        0 底部中线 · 1 ~ 2 底板 · 3 ~ 5 车门下半（5 = 最宽处）· 6 肩部 · 7 腰线 · 8 侧窗中间 · 9 车顶边 · 10 ~ 11 车顶 · 12 车顶中线
    乘员舱一段（腰线到车顶 > 260 mm）：肩部是一道紧的折线，上面侧窗往里倾；
    前盖 / 尾箱盖一段（腰线到顶只有几十毫米）：没有侧窗，7 ~ 12 是一条抛物线拱，肩部倒成大圆角（翼子板上沿），
    两种之间按 t 过渡。车头车尾截面很小，所有“往里收多少毫米”按宽度 k、高度 kv 等比缩小"""
    zt, zb, zbl, hw, ht = ZTOP(y), ZBOT(y), ZBELT(y), HW(y), HT(y)
    k = min(1.0, hw / 420)
    h = max(zbl - zb, 1.0)
    kv = min(1.0, h / 420)
    k = min(k, kv * 1.6)
    ht = min(ht, hw - 40 * k)
    gh = max(zt - zbl, .5)
    t = min(1.0, max(0.0, (gh - 100.0) / 180.0))
    t = t * t * (3 - 2 * t)
    ed = (1 - t) * .56 * gh + t * min(72.0, .22 * gh + 3)
    x10, x11 = .66 + .14 * t, .33 + .09 * t
    f10, f11 = .44 - .14 * t, .11 - .04 * t
    hwb = hw - 135 * k
    # 肩部和腰线：乘员舱是 (hw-13, 腰线下 10) → (hw-42, 腰线上一点)；前盖 / 尾箱是 (hw-6, 腰线下 85) → (hw-80, 腰线)
    p6 = (hw - (13 * t + 6 * (1 - t)) * k, zbl - (10 * t + 85 * (1 - t)) * kv)
    p7 = (hw - (42 * t + 80 * (1 - t)) * k - .02 * gh * t, zbl + (.05 * gh + 4 * k) * t)
    p9 = (ht + 8 * k * t, zt - ed)
    p8 = ((p7[0] + p9[0]) / 2 + (10 * t + 6 * (1 - t)) * k, (p7[1] + p9[1]) / 2 + (1 - t) * .10 * gh)
    z5 = zb + (.72 * t + .60 * (1 - t)) * h
    return [
        (0, zb), (hwb * .55, zb), (hwb, zb + 2 * k), (hw - 34 * k, zb + .18 * h), (hw - 6 * k, zb + .40 * h),
        (hw, z5), p6, p7, p8, p9,
        (ht * x10, zt - ed * f10), (ht * x11, zt - ed * f11), (0, zt),
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


def surf(y, s, side=1):
    x, z = cat(section_ctrl(y), s)
    return Vector((side * x, y, z))


def surf_n(y, s):
    p = surf(y, s)
    dy = surf(y + 6, s) - surf(y - 6, s)
    ds = surf(y, s + .03) - surf(y, s - .03)
    n = dy.cross(ds)
    if n.length < 1e-9:
        return Vector((0, 0, 1))
    n.normalize()
    if n.dot(Vector((p.x + .01, 0, p.z - 620))) < 0:
        n = -n
    return n


def body_mesh(mats_idx):
    ys = [Y_TAIL + (i / 14) ** 1.7 * 120 for i in range(14)]
    ys += [Y_TAIL + 120 + (Y_NOSE - Y_TAIL - 240) * i / 100 for i in range(101)]
    ys += [Y_NOSE - 120 * ((13 - i) / 13) ** 1.7 for i in range(1, 14)]
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
        for j in range(n):
            f = bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
            jj = j if j < half_n else n - j
            sv = (jj + .5) / S
            f.material_index = mats_idx['trim'] if sv < 3.0 and -2240 < ys[i] < 2200 else mats_idx['paint']
            f.smooth = True
    for r in (rings[0], rings[-1]):
        f = bm.faces.new(r)
        f.material_index = mats_idx['paint']
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


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


def chaikin(poly, it=2):
    for _ in range(it):
        q = []
        n = len(poly)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            q.append((.75 * a[0] + .25 * b[0], .75 * a[1] + .25 * b[1]))
            q.append((.25 * a[0] + .75 * b[0], .25 * a[1] + .75 * b[1]))
        poly = q
    return poly


def inside(pt, poly):
    x, y = pt
    c = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            c = not c
    return c


def patch(bm, poly, mi, off=2.5, mirror=True, grid=48, sk=150):
    """在曲面参数空间 (y, s) 里画一个多边形，贴到车身上。边界精确，不受网格影响。"""
    P = densify(poly, step=28)
    P2 = [(a, b * sk) for a, b in P]
    ymin, ymax = min(p[0] for p in P2), max(p[0] for p in P2)
    smin, smax = min(p[1] for p in P2), max(p[1] for p in P2)
    pts = [Vector(p) for p in P2]
    edges = [(i, (i + 1) % len(pts)) for i in range(len(pts))]
    a = ymin + grid / 2
    while a < ymax:
        b = smin + grid / 2
        while b < smax:
            if inside((a, b), P2):
                pts.append(Vector((a, b)))
            b += grid
        a += grid
    vs, _e, faces, _ov, _oe, _of = delaunay_2d_cdt(pts, edges, [], 0, 1e-5)
    keep = []
    for f in faces:
        if len(f) != 3:
            continue
        c = (sum(vs[i].x for i in f) / 3, sum(vs[i].y for i in f) / 3)
        if inside(c, P2):
            keep.append(f)
    for side in ((1, -1) if mirror else (1,)):
        V = {}

        def get(i):
            if i not in V:
                y, s = vs[i].x, vs[i].y / sk
                p = surf(y, s) + surf_n(y, s) * off
                V[i] = bm.verts.new((side * p.x, p.y, p.z))
            return V[i]
        for f in keep:
            try:
                nf = bm.faces.new([get(i) for i in f])
            except ValueError:
                continue
            nf.material_index = mi
            nf.smooth = True


def ribbon(bm, line, w, mi, off=1.2, mirror=True):
    """沿 (y, s) 折线的一条细缝"""
    Ld = densify(line, step=22, closed=False)
    P = [surf(y, s) for y, s in Ld]
    N = [surf_n(y, s) for y, s in Ld]
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


def contour(z, y_from, y_to, end):
    """高度 z 的水平切片，从车身中线（x=0）一路走到 y_to。end 是车尾/车头那一端的 y，用来保证切片从中线起步"""
    n = 90
    ys = [end + (y_to - end) * (i / n) ** 1.8 for i in range(n + 1)]
    pts = []
    for y in ys:
        cp = section_ctrl(y)
        ss = [cat(cp, i / 10) for i in range(NSEG * 10 + 1)]
        x = None
        for a, b in zip(ss, ss[1:]):
            if (a[1] - z) * (b[1] - z) <= 0 and abs(a[1] - b[1]) > 1e-6:
                t = (z - a[1]) / (b[1] - a[1])
                xi = a[0] + (b[0] - a[0]) * t
                x = max(x, xi) if x is not None else xi
        if x is not None:
            pts.append((x, y))
    if pts and pts[0][0] > 1:
        pts.insert(0, (0.0, pts[0][1]))
    return pts


def resample(pts, n):
    d = [0.0]
    for a, b in zip(pts, pts[1:]):
        d.append(d[-1] + math.hypot(a[0] - b[0], a[1] - b[1]))
    out = []
    for i in range(n + 1):
        t = d[-1] * i / n
        k = min(bisect_right(d, t) - 1, len(pts) - 2)
        u = (t - d[k]) / max(d[k + 1] - d[k], 1e-6)
        out.append((pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u))
    return out


def band(bm, z0, z1, end, y_to, mi, push=2.5, rows=1, taper=0):
    """贴着车头/车尾转一圈的灯带或饰板，z0..z1 是上下沿；左右对称。taper>0 时靠外的一段收窄成尖"""
    sgn = 1 if end > 0 else -1
    N = 60
    lines = []
    for r in range(rows + 1):
        z = z0 + (z1 - z0) * r / rows
        lines.append((z, resample(contour(z, end, y_to, end), N)))
    # 沿车身真实法线往外推：只在水平面里推的话，碰上发动机盖前沿这种几乎朝上的面，
    # 推出去的距离接近 0，车身会从灯带底下顶出来，看起来像一圈白色锯齿
    zp = [z0 + (z1 - z0) * r / rows for r in range(rows + 1)]
    dz = max((z1 - z0) / rows, 4.0)
    side_lines = [resample(contour(z, end, y_to, end), N) for z in (zp[0] - dz, zp[-1] + dz)]
    for sx in (1, -1):
        prev = None
        for i in range(N + 1):
            ring = []
            for j, (z, L) in enumerate(lines):
                x, y = L[i]
                a, b = L[max(i - 1, 0)], L[min(i + 1, N)]
                tx, ty = b[0] - a[0], b[1] - a[1]
                nx, ny = -ty * sgn, tx * sgn
                k = math.hypot(nx, ny) or 1
                nx, ny = nx / k, ny / k
                # 上下相邻两条切片在水平法线方向差多少，就是这里车身的上下坡度
                lo = lines[j - 1][1][i] if j > 0 else side_lines[0][i]
                hi = lines[j + 1][1][i] if j < rows else side_lines[1][i]
                zl = lines[j - 1][0] if j > 0 else zp[0] - dz
                zh = lines[j + 1][0] if j < rows else zp[-1] + dz
                dr = (hi[0] - lo[0]) * nx + (hi[1] - lo[1]) * ny
                dzz = zh - zl
                kk = math.hypot(dr, dzz) or 1
                nh, nz = dzz / kk, -dr / kk
                if nh < .2:
                    nh, nz = .2, math.copysign(sqrt(1 - .04), nz)
                zz = z
                if taper:
                    t = i / N
                    if t > 1 - taper:
                        q = (t - (1 - taper)) / taper
                        zz = z + ((z0 + z1) / 2 - z) * q
                ring.append(bm.verts.new((sx * (x + nx * nh * push), y + ny * nh * push, zz + nz * push)))
            if prev:
                for j in range(len(ring) - 1):
                    q = (prev[j], prev[j + 1], ring[j + 1], ring[j])
                    f = bm.faces.new(q if (sx * sgn) > 0 else q[::-1])
                    f.material_index = mi
                    f.smooth = True
            prev = ring


def face_out(bm):
    """贴片（玻璃、缝线）是单层面，三角形绕向随 Delaunay 和左右镜像乱掉，一半朝里一半朝外。
    网页里双面材质按正面算光照，朝里的那一半法线反了，玻璃会把环境光反成一片灰白。统一翻成朝外"""
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot(Vector((c.x, 0, c.z - 620))) < 0:
            f.normal_flip()


M_IDX = dict(paint=0, trim=1, glass=2, seam=3)


def inside_body(p, m=34):
    """把点收进车身里，离外皮至少 m。发动机盖、后备箱一带压低高度，乘员舱一带往里收"""
    x, y, z = p
    y = min(max(y, Y_TAIL + 45), Y_NOSE - 45)
    pts = [cat(section_ctrl(y), i / 6) for i in range(NSEG * 6 + 1)]
    z = min(max(z, ZBOT(y) + m), ZTOP(y) - m)
    flat = ZTOP(y) - ZBELT(y) < 130

    def wide(h):
        xs = [a[0] + (b[0] - a[0]) * (h - a[1]) / (b[1] - a[1]) for a, b in zip(pts, pts[1:]) if (a[1] - h) * (b[1] - h) <= 0 and a[1] != b[1]]
        return max(xs) if xs else 0.0
    if flat:
        while wide(z) - m < abs(x) and z > ZBOT(y) + m:
            z -= 8
    xm = wide(z) - m
    if abs(x) > xm:
        x = math.copysign(max(xm, 0), x)
    return (x, y, z)


def clamp_data():
    for k in list(ROAD):
        ROAD[k] = Vector(inside_body(tuple(ROAD[k]), 40))
    for k, e in D.ECUS.items():
        e['pos'] = [round(c, 1) for c in inside_body(e['pos'], 72)]
    for k, p in D.ENDPOINTS.items():
        if k.startswith(('Mir', 'CamS')):
            continue
        p['pos'] = [round(c, 1) for c in inside_body(p['pos'], 40)]
    for a, b in D.ROAD_LINKS:
        pass
    for k in ADJ:
        ADJ[k] = []
    for a, b in D.ROAD_LINKS:
        w = (ROAD[a] - ROAD[b]).length
        ADJ[a].append((b, w))
        ADJ[b].append((a, w))


# ================================================================ 车身：按造车顺序
# 0 外皮基准面 = section_ctrl 定义的那张曲面（线束、盒子的位置也按它算，所以外形不动）
# 1 布置：缝线、窗洞、柱子、车框走向，全部用曲面参数 (y, s) 写；s 是截面控制点序号
#   s≈1 底板边，3.4 车门下沿，7.05 腰线，7.2~8.9 侧窗，9.6 车顶和侧围分界，12 车顶中线
BELT, RAIL, SILL, UB = 7.05, 9.6, 2.9, 1.0
L_DOOR_F = [(1112, BELT), (1085, 5.4), (1000, SILL)]                       # 前门前缝（上 → 下）
L_DOOR_R = [(-1170, BELT), (-1060, 6.0), (-1010, 5.0), (-1000, SILL)]        # 后门后缝（上 → 下）
# 前盖：后缘在前挡下沿前面，两边的缝走在翼子板拱起的肩上，前缘离车头尖约 200 mm（前面那一截是保险杠蒙皮）
L_HOOD = [(1178, 12), (1178, 9.1), (1172, 7.9), (1600, 7.75), (1980, 7.6), (2118, 7.6), (2146, 8.8), (2150, 12)]
# 尾箱盖：前缘紧贴后挡下沿，盖子往后一直包到车尾立面（尾灯带在盖子上），下缘在尾灯下面
Y_DECK = -1945.0
Y_UNDER = 2150.0      # 黑色底护板的前后边界（±）
L_TRUNK = [(Y_DECK, 12), (Y_DECK + 3, 9.3), (-1968, 8.2), (-2150, 8.0), (-2300, 7.9), (-2380, 7.9), (-2405, 9.0), (-2408, 12)]
L_FASCIA_F = [(2118, 7.6), (2100, 6.5), (2040, 5.0), (1960, 2.8), (1960, UB)]   # 前保险杠蒙皮和翼子板的分缝
L_FASCIA_R = [(-2300, 7.9), (-2292, 6.6), (-2210, 5.0), (-2050, 2.8), (-2050, UB)]
L_WS_SIDE = [(1162, 7.7), (1040, 8.1), (850, 8.55), (600, 8.95), (300, 9.2)]  # 前挡侧边（下 → 上）
# 前挡、后挡外轮廓（两端在车顶中线上）。前挡下角多给两个点，平滑以后角还是紧的，不会被削圆抬高
WS_POLY = [(1166, 12), (1166, 9.0), (1165, 7.9), (1160, 7.73), (1145, 7.75)] + L_WS_SIDE[1:] + [(280, 9.7), (265, 10.8),
                                                                                               (255, 12)]
# 溜背后挡：上沿在后排头顶后面，两边沿车顶边线一路往后，下沿到尾箱盖前缘
BACK_POLY = [(-950, 12), (-960, 10.4), (-1000, 9.5), (-1250, 9.42), (-1640, 9.42), (-1880, 9.4), (-1932, 9.42), (-1938, 10.5),
             (-1936, 12)]
C_LINE = [(-1170, BELT), (-985, RAIL)]        # 后门后缘（腰线 → 车顶），侧围外板的 C 柱从这里往后
B_Y, DIV_Y = 60.0, -850.0                     # 两门分缝；后门玻璃分隔条
ARCH_R, ARCH_X = R_ARCH, 640.0

SKIN = None
CH = {}
PARTS = []
GH = {}


def setup_skin():
    global SKIN
    SKIN = CK.Skin(section_ctrl, NSEG, Y_TAIL, Y_NOSE, smooth_y=40.0)
    C = CK.Chart
    # 按片展开：每片一张局部展开图，误差只在这一片里
    CH.update(
        side=C(SKIN, UB, 9.7, BELT, name='侧围'),
        roof=C(SKIN, 9.0, 12, 12, -1300, 650, name='车顶'),
        hood=C(SKIN, 7.0, 12, 12, 1100, 2200, name='前盖'),
        ws=C(SKIN, 7.4, 12, 12, 200, 1240, name='前挡'),
        back=C(SKIN, 9.0, 12, 12, -2000, -900, name='后挡'),
        trunk=C(SKIN, 7.0, 12, 12, Y_TAIL, -1850, name='尾门'),
        front=C(SKIN, 0, 12, 4.0, 1900, Y_NOSE, name='前保险杠'),
        rear=C(SKIN, 0, 12, 4.0, Y_TAIL, -1900, name='后保险杠'),
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
    车门上半截是黑色窗框饰条，中间挖窗洞（布置方法见 carkit.greenhouse）"""
    ws = smooth_open(WS_POLY)
    k0 = min(range(len(ws)), key=lambda i: ws[i][1])
    side = [ws[k0]]
    for p, q in zip(ws[k0:], ws[k0 + 1:]):
        if q[1] >= RAIL:
            side.append(_cross_s(p, q, RAIL))
            break
        side.append(q)
    back = smooth_open(BACK_POLY)
    y_cut = Y_DECK + 3.0                                     # 尾箱盖前缘那条线
    bs = []
    for p, q in zip(back, back[1:]):
        if p[1] >= RAIL > q[1]:                              # 从车顶下来
            bs.append(_cross_s(p, q, RAIL))
        if q[1] < RAIL and p[1] < RAIL and q[0] < y_cut <= p[0]:
            t = (y_cut - p[0]) / (q[0] - p[0])
            bs.append((y_cut, p[1] + (q[1] - p[1]) * t))
            break
        if q[1] < RAIL:
            bs.append(q)
    a_line = [p for p in side if p[1] <= 9.22]
    lay = CK.greenhouse(CH['side'], BELT, a_line, RAIL, C_LINE, B_Y, div_y=DIV_Y, a_width=(60.0, 70.0))
    GH.update(lay, ws=ws, back=back, ws_side=side, back_side=bs)


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
    ring = [(-955, 2.5), (925, 2.5), (938, 2.9), (948, 3.6), (978, 4.2), (1035, 5.6), (1095, 6.95), (1138, 7.4),
            (1000, 7.97), (800, 8.42), (560, 8.84), (330, 9.27), (0, 9.33), (-600, 9.34), (-1000, 9.31),
            (-1235, 9.2), (-1300, 8.55), (-1420, 7.8), (-1580, 7.1), (-1980, 7.2), (-2280, 7.2)]
    ring_w = [140, 140, 116, 100, 100, 100, 96, 90, 80, 70, 62, 56, 58, 58, 60, 64, 76, 96, 88, 56, 56]
    ring_h = [110, 110, 106, 103, 100, 94, 88, 75, 68, 60, 55, 50, 55, 55, 56, 58, 66, 82, 78, 55, 52]
    mem(ring, ring_w, ring_h, inset=16)                                                     # 门槛 - A 柱 - 车顶边梁 - C 柱 - 后翼子板上沿
    mem([(60, 2.8), (60, 7.05), (60, 9.33)], (130, 70), (110, 58), inset=16)                # B 柱
    mem([(-938, 2.8), (-946, 4.2), (-985, 5.0), (-1045, 6.0), (-1120, 6.6), (-1170, 7.05), (-1110, 7.9), (-1050, 8.7),
         (-1015, 9.2)],
        [104, 100, 96, 92, 88, 84, 78, 70, 64], [96, 94, 90, 88, 86, 84, 72, 62, 58], inset=16)           # 后门锁柱：腰线以下绕开后轮罩（跟着后门的狗腿缝），腰线以上顺着后门后缘往前上方并进车顶边梁
    # 前翼子板上边梁（俗称“枪梁”）：不贴外皮走，从 A 柱根部斜着往前下方落到水箱框架，
    # 在前盖缝的里侧、翼子板下面（这一段外皮是凹的，贴着外皮扫会从翼子板侧面顶出来）
    gun = []
    for y, s_, dx, dz in ((1112, 7.0, 95, 75), (1350, 7.2, 110, 85), (1600, 7.25, 115, 90), (1850, 7.2, 110, 90),
                          (2075, 7.15, 100, 85)):
        q = SKIN.p(y, s_, 1)
        gun.append((q.x - dx, y, q.z - dz))
    CK.beam(bm, gun, 50, 50, up=(0, 0, 1), mi=0, mirror=True, shape='hat', flange=10)
    mem([(312, 9.3), (282, 10.6), (264, 12)], 70, 45)                                        # 前风挡上横梁
    mem([(-1000, 9.3), (-976, 10.6), (-958, 12)], 70, 45)                                    # 后风挡上横梁
    for y in (-180, -590):
        mem([(y, 9.36), (y, 12)], 50, 30, flange=10)                                         # 车顶横梁
    mem([(1140, 7.45), (1160, 9.5), (1166, 12)], 100, 80)                                    # 前围上横梁（雨刮下面）
    mem([(Y_DECK + 8, 9.3), (Y_DECK + 8, 12)], 70, 55)                                                # 后风挡下横梁（衣帽架前沿）
    CK.beam(bm, [(-560, -2366, 842), (0, -2386, 848), (560, -2366, 842)], 60, 50, up=(0, 0, 1), mi=0, shape='hat', flange=12)                                  # 行李箱口下沿（尾板上横梁）
    # 地板、前围板、后排背板（整张钣金）
    rbox(bm, (0, 0, 335), (1500, 2000, 6), 3, 1, 1)             # 地板：前后到轮罩为止全宽，伸进轮罩之间那两截收窄
    for yc in (1095, -1080):
        rbox(bm, (0, yc, 335), (1170, 190 if yc > 0 else 160, 6), 3, 1, 1)
    rbox(bm, (0, 1196, 525), (1170, 12, 370), 3, 1, 1)          # 前围板下半截在两个前轮罩之间，比上半截窄
    rbox(bm, (0, 1196, 822), (1470, 12, 224), 3, 1, 1)
    rbox(bm, (0, -1186, 510), (1170, 12, 320), 3, 1, 1)         # 后排背板：下半截夹在两个后轮罩之间
    rbox(bm, (0, -1186, 850), (1520, 12, 360), 3, 1, 1)
    # 不贴外皮的件：纵梁、地板横梁、中央通道是帽形钣金；前后防撞梁是铝挤出方管
    CK.beam(bm, [(470, 1190, 400), (470, 1700, 420), (470, 2130, 440)], 120, 80, up=(1, 0, 0), mi=0, mirror=True,
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
        rbox(bm, (sx * 500, 1410, 700), (170, 220, 200), 30, 0, 2)   # 在轮罩内衬挡板里面（x < 590），减震从下面伸进来
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
    one('Panel_Hood', CH['hood'], L_HOOD, P, gap=5.0)
    one('Panel_BumperF', CH['front'], [(2150, 12), (2146, 8.8)] + L_FASCIA_F + [(Y_UNDER, UB), (Y_UNDER, 0), (Y_NOSE, 0), (Y_NOSE, 12)], P, gap=2.0)
    one('Panel_Fender', S, [(1172, 7.9), (1600, 7.75), (1980, 7.6)] + L_FASCIA_F + [(1000, UB)] + L_DOOR_F[::-1] + [(1150, 7.5)],
        P, cuts=[archF])
    one('Panel_DoorF', S, L_DOOR_F + [(60, SILL), (60, BELT)], P)
    one('Panel_DoorR', S, [(60, BELT), (60, SILL)] + L_DOOR_R[::-1], P)
    # 侧围外板：A 柱、车顶边梁、C 柱、后翼子板是一整张冲压件（车身色），围着两扇门的上半截
    bso = (L_DOOR_R + [(-1000, UB)] + L_FASCIA_R[::-1] + [(-2150, 8.0), (-1968, 8.2), (Y_DECK + 3, 9.3)] + GH['back_side'][::-1]
           + GH['ws_side'][::-1] + [(1150, 7.5), (1112, BELT)] + GH['door_top'][:-1])
    one('Panel_SideOuter', S, bso, P, cuts=[archR])
    one('Panel_Trunk', CH['trunk'], L_TRUNK, P, gap=5.0)
    one('Panel_BumperR', CH['rear'], [(-2408, 12), (-2405, 9.0), (-2380, 7.9)] + L_FASCIA_R + [(-Y_UNDER, UB), (-Y_UNDER, 0), (Y_TAIL, 0), (Y_TAIL, 12)], P, gap=2.0)
    one('Panel_Roof', CH['roof'], [(280, 12), (285, 10.5), (300, RAIL), (-1000, RAIL), (-990, 10.5), (-985, 12)], P)
    one('Panel_Rocker', S, [(1000, UB), (-1000, UB), (-1000, SILL), (1000, SILL)], T, gap=3.0, hem=0)
    # 车门上半截：窗框外面包黑色饰条（B 柱看到的黑色就是前后门窗框各一半），中间是窗洞
    one('Panel_SashF', S, GH['sash_f'], K, holes=[GH['win_f']])
    one('Panel_SashR', S, GH['sash_r'], K, holes=[GH['win_r'], GH['win_q']])
    # B 柱上的黑色密封条 / 饰板：垫在两扇门中间那条缝下面，缝里看到的是黑的（不然是后面的灰色骨架）
    dt = GH['door_top']

    def s_top(y):
        for p, q in zip(dt, dt[1:]):
            if (p[0] - y) * (q[0] - y) <= 0 and p[0] != q[0]:
                return p[1] + (q[1] - p[1]) * (y - p[0]) / (q[0] - p[0])
        return RAIL
    one('Panel_BPillar', S, [(B_Y + 40, SILL), (B_Y + 40, s_top(B_Y + 40) + .03), (B_Y - 40, s_top(B_Y - 40) + .03),
                             (B_Y - 40, SILL)], K, gap=0, lift=-7, hem=0, measure=False)
    # 车头车尾：外皮在 Y_NOSE / Y_TAIL 处收成一个圆角矩形，用一块平板盖上（保险杠正中间那块平面）
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
    # 黑色底护板只铺到前后保险杠蒙皮为止：再往前 / 往后，底面是跟着收口翘起来的，从正面能看见，应该是车身色的保险杠下沿
    one('Panel_Under', CH['under'], [(-Y_UNDER, 0), (Y_UNDER, 0), (Y_UNDER, UB), (-Y_UNDER, UB)], T, measure=False)
    # 雨刮下面的黑色导流板，垫在前盖后缘和前挡下沿之间
    one('Cowl', CH['hood'], [(1128, 12), (1128, 8.8), (1145, 7.5), (1188, 7.5), (1188, 12)], T, gap=0, lift=-6, measure=False)
    # 轮罩
    bm = bmesh.new()
    for yc in (WB, -WB):
        CK.wheelhouse(bm, SKIN, yc, R_TYRE, ARCH_R, x_in=590, mi=0)
    add('Wheelhouse', bm, [T], 'shell', ang=40)
    # 隐藏式门把手
    sm = bmesh.new()
    for yc in (560, -540):
        ribbon(sm, [(yc + 95, 6.9), (yc - 95, 6.9)], 22, 0, off=1.6)
    # 车头车尾的灯、格栅、车牌：都在正视图 (x, z) 里画轮廓，再投到外皮上（carkit.face_patch）
    FP = CK.face_patch
    # 前下格栅（电动车只留下面一条进气口给冷凝器）+ 两侧的风帘竖槽
    FP(sm, SKIN, [(0, 318), (430, 318), (560, 330), (600, 368), (560, 412), (430, 428), (0, 428)], Y_NOSE, off=2.0)
    FP(sm, SKIN, [(668, 350), (712, 342), (738, 400), (730, 505), (694, 520), (676, 470)], Y_NOSE, off=2.0)
    # 后保险杠下面的黑色扩散器饰板
    FP(sm, SKIN, [(0, 338), (500, 338), (610, 352), (660, 396), (610, 440), (500, 452), (0, 452)], Y_TAIL, off=2.0)
    add('Seams', sm, [M['seam']], 'shell', ang=50)
    lm = bmesh.new()
    # 贯穿式日行灯（细）+ 两边的大灯（矩阵 LED，扁的）
    FP(lm, SKIN, [(0, 664), (430, 664), (430, 676), (0, 676)], Y_NOSE, off=2.6, grid=22)
    FP(lm, SKIN, [(430, 656), (640, 648), (770, 652), (812, 672), (792, 694), (640, 690), (430, 684)], Y_NOSE, off=2.6, grid=22)
    add('Lamp_Head', lm, [M['lamp']], 'shell', ang=70)
    tm = bmesh.new()
    # 贯穿式尾灯：在尾箱盖的立面上，两头绕到侧面收尖；保险杠两角各一个反光片
    FP(tm, SKIN, [(0, 902), (520, 902), (700, 908), (790, 926), (700, 946), (520, 944), (0, 938)], Y_TAIL, off=2.6, grid=22)
    FP(tm, SKIN, [(560, 470), (700, 474), (700, 494), (560, 490)], Y_TAIL, off=2.4, grid=20)
    add('Lamp_Tail', tm, [M['tail']], 'shell', ang=70)
    # 车牌：前后各一块（虚构车，牌面留白），外面一圈黑色牌框
    pm = bmesh.new()
    for end, zc in ((Y_NOSE, 506), (Y_TAIL, 640)):
        FP(pm, SKIN, [(0, zc - 78), (232, zc - 78), (232, zc + 78), (0, zc + 78)], end, mi=1, off=3.0, grid=40)
        FP(pm, SKIN, [(0, zc - 70), (224, zc - 70), (224, zc + 70), (0, zc + 70)], end, mi=0, off=5.0, grid=40)
    # 车标：虚构的一个圆牌，前面在灯带和车牌之间，后面在尾箱盖下缘正中
    for end, zc, r in ((Y_NOSE, 626, 30), (Y_TAIL, 872, 40)):
        arc = [(r * cos(radians(a)), zc + r * sin(radians(a))) for a in range(-90, 91, 15)]
        FP(pm, SKIN, arc, end, mi=2, off=4.0, grid=18)
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
    cy = 940.0
    cx, cz = 1010.0, SKIN.p(965.0, BELT).z + 64.0  # 镜壳内侧中心：x 是宽度中线，cy 是镜面所在的平面；高度跟着腰线走
    W, H, R = 176.0, 106.0, 34.0
    for sx in (1, -1):
        rings = []
        for dy, kw, kh in ((0, 1, 1), (25, .99, .99), (50, .95, .93), (70, .85, .82), (85, .66, .63), (93, .38, .34)):
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
        y0, s0 = 965.0, 6.8
        p0 = SKIN.p(y0, s0, sx) - SKIN.n(y0, s0, sx) * 4
        p1 = Vector((sx * (cx - W / 2 + 30), cy + 40, cz - 18))
        d = (p1 - p0).normalized()
        u = Vector((0, 1, 0))
        u = (u - d * u.dot(d)).normalized()
        v = d.cross(u)
        rings = []
        for t, w_, h_ in ((0, 100, 46), (.25, 86, 40), (.6, 70, 32), (1, 60, 28)):
            c = p0.lerp(p1, t)
            rings.append([c + u * a_ + v * b_ for a_, b_ in CK._rrect(w_, h_, 12, seg=3)])
        CK.loft(mm, rings, mi=1, cap=True)
    add('Mirrors', mm, [M['paint'], M['piano'], M['mirror']], 'shell', ang=45)


# ---------------------------------------------------------------- 4 玻璃
def build_glass(M):
    """玻璃：外表面比外皮低 1 mm，内侧黑釉边；下面是聚氨酯胶条压在车身开口的翻边上（萨博维修手册 / US4650240）。
    侧窗是降下式门玻璃，在窗框饰条里面再往里 5 mm"""
    bm = bmesh.new()
    bond = bmesh.new()
    S = CH['side']
    for ch, poly, mi in ((CH['ws'], GH['ws'], 0), (CH['back'], GH['back'], 2)):
        CK.glass(bm, ch, poly, lift=-1.0, frit=26, mi=mi, mi_frit=1)
        CK.glass_bond(bond, ch, poly, lift=-1.0, inset=12, mi_bead=0, mi_flange=1)
    # 门玻璃比窗洞大一圈，四边插进窗框的导槽里（从外面看不见边）；后门分隔条后面的小三角窗是固定的，也装在门框里
    for k, mi in (('win_f', 0), ('win_r', 2), ('win_q', 2)):
        CK.glass(bm, S, grow(S, GH[k], 16), lift=-6.0, frit=0, mi=mi, mi_frit=1)
    add('Glass', bm, [M['glass'], M['piano'], M['glasstint']], 'shell', ang=40)
    add('GlassBond', bond, [M['urethane'], M['biw']], 'shell', ang=40)


def build_wheels(M):
    grp('wheels', '车轮', (0, 0, 0, 0))
    mats = [M['tyre'], M['rim'], M['disc'], M['rimdark']]
    for tag, y, sx in (('FL', WB, -1), ('FR', WB, 1), ('RL', -WB, -1), ('RR', -WB, 1)):
        bm = bmesh.new()
        W = 118
        tp = [(208, -W * .92), (258, -W), (312, -W), (336, -W * .86), (345, -W * .62), (345, W * .62), (336, W * .86), (312, W), (258, W), (208, W * .92)]
        lathe(bm, tp, (0, 0, 0), 'X', 48, 0, closed=True)
        rp = [(0, W * .62), (46, W * .62), (56, W * .7), (120, W * .78), (205, W * .8), (222, W * .92), (222, W * .98), (210, W * .98), (200, W * .8), (196, -W * .6), (0, -W * .6)]
        fs = lathe(bm, rp, (0, 0, 0), 'X', 48, 3)
        # 五组辐条（外侧）
        for k in range(10):
            a = 2 * pi * (k + (.14 if k % 2 else -.14) + (k // 2)) / 10
            ca, sa = cos(a), sin(a)
            n = 8
            pts = []
            for i in range(n + 1):
                r = 52 + (206 - 52) * i / n
                b = a + .14 * (i / n) * (1 if k % 2 else -1)
                pts.append(Vector((W * .86 - 8 * (i / n), r * cos(b), r * sin(b))))
            for i in range(n):
                cyl(bm, pts[i], pts[i + 1], 9.5, 8.5, 1, seg=6)
        # 外侧朝向：左轮 W 指向 -X
        if sx > 0:
            pass
        else:
            bmesh.ops.scale(bm, vec=(-1, 1, 1), verts=bm.verts)
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        # 各零件建的时候朝向已经对了（回转体按体积、圆柱由 create_cone 给出），这里不再整体重算：
        # 轮胎、轮毂、辐条互相插着，整体重算会把轮毂盘面翻到里面
        add(f'Wheel_{tag}', bm, mats, 'wheels', loc=(sx * TRACK, y, R_TYRE), ang=30, coll='Chassis', extras=dict(ex=sx))
        d = bmesh.new()
        lathe(d, [(0, -13), (168, -13), (168, 13), (0, 13)], (0, 0, 0), 'X', 40, 0)
        rbox(d, (0, 0, 164), (70, 120, 70), 10, 1, 1)
        cyl(d, (-sx * 90, 0, 0), (0, 0, 0), 34, 34, 2, seg=14)
        add(f'Brake_{tag}', d, [M['disc'], principled(f'Caliper{tag}', '#c33b2c', rough=.45), M['steel']], 'wheels',
            loc=(sx * (TRACK - 30), y, R_TYRE), coll='Chassis', extras=dict(ex=sx))


def build_chassis(M):
    grp('chassis', '底盘与电池', (0, 0, -900, 0))
    bm = bmesh.new()
    # 电池包：先外壳，再一排排模组
    rbox(bm, (0, -60, 250), (1440, 2240, 130), 26, 0, 3)
    for ix in range(4):
        for iy in range(6):
            x = -510 + ix * 340
            y = -930 + iy * 345
            rbox(bm, (x, y, 322), (300, 310, 16), 5, 1, 1)
    for x in (-690, 690):
        rbox(bm, (x, -60, 330), (18, 2100, 26), 3, 0, 1)
    add('Battery', bm, [M['pack'], M['cell']], 'chassis', coll='Chassis')
    bm = bmesh.new()
    # 后驱动：电机 + 减速器 + 半轴
    cyl(bm, (-250, -1400, 345), (150, -1400, 345), 135, mi=0, seg=36)
    rbox(bm, (230, -1400, 345), (170, 360, 300), 30, 0, 2)
    cyl(bm, (150, -1400, 345), (690, -1400, 345), 22, mi=1, seg=14)
    cyl(bm, (-250, -1400, 345), (-690, -1400, 345), 22, mi=1, seg=14)
    for x in (-160, -100, -40, 20, 80):
        cyl(bm, (x, -1400, 345), (x + 26, -1400, 345), 142, mi=0, seg=36)
    add('RearDrive', bm, [M['alu'], M['steel']], 'chassis', coll='Chassis')
    bm = bmesh.new()
    # 前后副车架、转向机、悬架摆臂
    for (y0, wy) in ((1400, 1), (-1400, -1)):
        rbox(bm, (0, y0 - wy * 40 + (0 if wy > 0 else -150), 235), (1160, 90, 64), 16, 0, 2)
        for sx in (1, -1):
            cyl(bm, (sx * 560, y0 + 120, 240), (sx * (TRACK - 110), y0, 300), 20, 16, 0, seg=10)
            cyl(bm, (sx * 560, y0 - 120, 240), (sx * (TRACK - 110), y0, 300), 20, 16, 0, seg=10)
            cyl(bm, (sx * 600, y0, 500), (sx * (TRACK - 100), y0, 460), 13, 13, 0, seg=10)
            cyl(bm, (sx * (TRACK - 125), y0 + wy * 10, 330), (sx * 520, y0 + wy * 10, 760), 32, 32, 0, seg=14)   # 减震：上端往里斜，进减震塔
    cyl(bm, (-640, 1335, 320), (640, 1335, 320), 26, mi=0, seg=14)   # 转向机
    cyl(bm, (-370, 1300, 340), (-370, 880, 760), 18, 16, 0, seg=10)  # 转向管柱
    # 前舱：冷凝器、12V、水壶
    rbox(bm, (0, 2070, 560), (1120, 44, 380), 10, 2, 1)
    rbox(bm, (350, 1520, 560), (240, 170, 180), 12, 3, 2)
    cyl(bm, (-260, 1720, 440), (-260, 1720, 540), 60, mi=0, seg=16)
    cyl(bm, (260, 1730, 380), (260, 1730, 500), 74, mi=1, seg=18)
    add('Subframes', bm, [M['susp'], M['alu'], M['pack'], M['conn']], 'chassis', coll='Chassis', ang=40)
    bm = bmesh.new()
    # 高压线：橙色
    path = [(0, -1200, 345), (120, -1260, 420), (160, -1330, 500)]
    for a, b in zip(path, path[1:]):
        cyl(bm, a, b, 13, mi=0, seg=10)
    cyl(bm, (-200, -1050, 340), (-430, -1850, 520), 11, mi=0, seg=10)
    add('HVCable', bm, [M['hv']], 'chassis', coll='Chassis')


def build_cabin(M):
    """座舱：地板 → 座椅 → 仪表台 / 中控 / 方向盘 → 贴在车身上的内饰板（门板、柱子饰板、顶棚、后隔板）。
    布局照 2025 年主流电动轿车：平直的矮仪表台、贯穿的细出风口和氛围灯条、悬浮中控屏 + 方向盘后面的小仪表屏、
    没有换挡杆的中央通道（杯架 + 手机无线充电板 + 扶手箱）。尺寸是按人机布置的常见值估的，见 README“内饰依据”"""
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
    for tag, hx in (('SeatFL', -370), ('SeatFR', 370)):
        pad, frame, rail = bmesh.new(), bmesh.new(), bmesh.new()
        CK.front_seat(pad, frame, rail, (hx, 150, 588), FLOOR_TOP, mi_pad=0, mi_hr=0, mi_insert=1)
        add(tag + '_Pad', pad, seat_m, 'cabin', coll='Cabin', ang=45)
        add(tag + '_Frame', frame, [M['seatframe']], 'cabin', coll='Cabin', ang=40)
        add(tag + '_Rail', rail, [M['seatframe']], 'cabin', coll='Cabin', ang=40)
    pad, frame = bmesh.new(), bmesh.new()
    CK.bench(pad, frame, (0, -760, 596), FLOOR_TOP, w=1240, back_h=560, back_angle=24, mi_pad=0, mi_hr=0, mi_insert=1)
    add('SeatRear_Pad', pad, seat_m, 'cabin', coll='Cabin', ang=45)
    add('SeatRear_Frame', frame, [M['seatframe']], 'cabin', coll='Cabin', ang=40)
    # ---- 仪表台：三段 (y, z) 截面沿车宽拉伸。上面深色软包，中间一条饰板（上沿是贯穿出风口，下沿是氛围灯），下面浅色
    d = bmesh.new()
    xs = [-790 + i * 40 for i in range(40)] + [790]

    def ends(x):
        return 1 - .16 * (abs(x) / 790) ** 6
    CK.xloft(d, [(1165, 930), (1165, 976), (1040, 990), (900, 993), (805, 986), (770, 970), (760, 946), (774, 930),
                 (900, 924)], xs, 0, ends)
    CK.xloft(d, [(900, 930), (776, 930), (756, 926), (746, 906), (746, 868), (758, 852), (790, 848), (900, 848)], xs, 1, ends)
    CK.xloft(d, [(1165, 850), (790, 850), (764, 846), (768, 800), (802, 742), (858, 700), (960, 672), (1165, 660)], xs, 2,
             ends)
    rbox(d, (0, 744, 909), (1440, 6, 13), 2, 3, 1)                # 贯穿出风口
    rbox(d, (0, 744.5, 872), (1490, 4, 4), 1, 5, 1)               # 氛围灯条
    # 中控屏 15.6 吋横屏（约 345 × 195 的显示区）悬浮在仪表台前面，往上仰 10°；后面一个支座
    rbox(d, (0, 722, 1012), (392, 14, 238), 8, 3, 2, rot=(X, -10))
    rbox(d, (0, 722 - 7.9, 1012 + 1.4), (372, 3, 218), 1, 4, 1, rot=(X, -10))
    rbox(d, (0, 742, 915), (80, 30, 70), 8, 3, 1)
    # 仪表屏 10 吋，方向盘后面，仰 14°（从驾驶员眼点看过去正好在方向盘上缘的上面）
    rbox(d, (-370, 800, 1032), (270, 12, 96), 6, 3, 2, rot=(X, -14))
    rbox(d, (-370, 800 - 6.8, 1032 + 1.7), (252, 3, 80), 1, 4, 1, rot=(X, -14))
    rbox(d, (-370, 820, 986), (60, 24, 40), 6, 3, 1)
    add('Dash', d, [M['softdark'], M['woodtrim'], M['softlight'], M['piano'], M['screen'], M['ambient']], 'cabin',
        coll='Cabin', ang=42)
    # 仪表台横梁（Cross Car Beam）：一根钢管横在两根 A 柱之间，仪表台、转向管柱、气囊都挂在它上面
    # （专利 US5934744 / US6554352）。平时被仪表台包着看不见，网页里透视 / 拆开时能看到
    b = bmesh.new()
    CK.tube(b, [(-772, 1010, 885), (772, 1010, 885)], 58, mi=0)
    for sx in (-1, 1):
        rbox(b, (sx * 765, 1010, 885), (14, 110, 150), 4, 0, 1)        # 两端的安装板，拧在 A 柱内板上
    rbox(b, (-370, 950, 880), (150, 150, 14), 4, 0, 1, rot=(X, -22))   # 转向管柱支架
    for x in (-60, 60):
        cyl(b, (x, 1010, 885), (x, 1040, 360), 16, mi=0, seg=10)       # 中间两根落地支撑
    add('IP_Beam', b, [M['steel']], 'cabin', coll='Cabin', ang=40)
    # ---- 中央通道：从后排出风口到仪表台下面，一圈圈截面连起来。扶手箱盖、两个杯架、斜的手机无线充电板
    c = bmesh.new()
    rings = []
    for y, zt_ in ((-330, 640), (-322, 756), (-300, 770), (150, 770), (172, 700), (196, 688), (450, 688), (480, 700),
                   (700, 742), (800, 760)):
        w_ = 250 + 24 * min(1.0, max(0.0, (y - 150) / 500))
        h_ = zt_ - 340
        rings.append([Vector((u, y, 340 + h_ / 2 + v)) for u, v in CK._rrect(w_, h_, 26, seg=3)])
    CK.loft(c, rings, 0)
    rbox(c, (0, -75, 776), (232, 430, 26), 12, 1, 2)
    for sx in (-56, 56):
        cyl(c, (sx, 325, 684), (sx, 325, 690.5), 41, mi=2, seg=24)
    rbox(c, (0, 590, 726), (190, 190, 5), 2, 2, 1, rot=(X, 10.6))
    rbox(c, (0, -332, 600), (150, 6, 56), 3, 2, 1)
    add('Console', c, [M['softdark'], M['leather'], M['piano']], 'cabin', coll='Cabin', ang=45)
    # ---- 方向盘（直径 356）、转向管柱护罩、两根拨杆。盘面往前倒 22°
    w = bmesh.new()
    R_, r_ = 178.0, 15.0
    seg, m_ = 44, 12
    rings = []
    for k in range(seg):
        t = 2 * pi * k / seg
        rings.append([w.verts.new(((R_ + r_ * cos(2 * pi * j / m_)) * cos(t), r_ * sin(2 * pi * j / m_),
                                   (R_ + r_ * cos(2 * pi * j / m_)) * sin(t))) for j in range(m_)])
    tf = []
    for k in range(seg):
        for j in range(m_):
            f = w.faces.new((rings[k][j], rings[k][(j + 1) % m_], rings[(k + 1) % seg][(j + 1) % m_], rings[(k + 1) % seg][j]))
            f.smooth = True
            tf.append(f)
    bmesh.ops.recalc_face_normals(w, faces=tf)
    rbox(w, (0, 36, -8), (150, 48, 104), 22, 0, 2)                              # 气囊盖
    for sx in (-1, 1):
        cyl(w, (sx * 60, 30, 2), (sx * 170, 4, 4), 18, 13, 0, seg=10)            # 左右辐条
        cyl(w, (sx * 24, 34, -46), (sx * 44, 5, -170), 13, 11, 0, seg=10)        # 下面两根
        cyl(w, (sx * 45, 112, 8), (sx * 168, 96, 28), 9, 7, 1, seg=8)            # 拨杆
    cyl(w, (0, 52, 0), (0, 300, 0), 42, 48, 1, seg=20)                          # 管柱护罩
    bmesh.ops.rotate(w, verts=w.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(radians(-22), 3, 'X'))
    add('SteeringWheel', w, [M['softdark'], M['piano']], 'cabin', loc=(-370, 585, 925), coll='Cabin', ang=45)
    # ---- 踏板：右边细长的是电门，左边宽的是刹车
    pd = bmesh.new()
    rbox(pd, (-292, 1085, 440), (48, 16, 120), 5, 0, 1, rot=(X, -28))
    rbox(pd, (-405, 1075, 462), (86, 16, 56), 5, 0, 1, rot=(X, -28))
    cyl(pd, (-405, 1082, 470), (-405, 1150, 640), 7, mi=0, seg=8)
    add('Pedals', pd, [M['piano']], 'cabin', coll='Cabin', ang=40)
    # ================= 贴在车身上的内饰板：和车板用同一块区域，沿法线往车里收（carkit.inner），所以和车身严丝合缝
    # 顶棚：车顶那一片往里 40；前到前挡上沿，后到后挡上沿
    t = bmesh.new()
    CK.inner(t, CH['roof'], [(262, 12), (268, 10.6), (292, RAIL + .02), (-962, RAIL + .02), (-952, 10.5), (-948, 12)],
             depth=40, grid=60)
    add('Trim_Headliner', t, [M['headliner']], 'trim', coll='Cabin', ang=40)
    # 柱子饰板 + 车门窗框内侧：腰线以上、车顶分缝以下整个一圈（A 柱、车顶边梁、B 柱上段、C 柱），挖掉三个窗洞
    t = bmesh.new()
    ws, bs = GH['ws_side'], GH['back_side']
    y_a, y_c = int(ws[-1][0]) - 40, int(bs[0][0]) + 40
    outline = ([(1100, BELT + .03)] + ws + [(y, RAIL) for y in range(y_a, y_c, -100)] + bs + [(bs[-1][0], BELT + .03)])
    CK.inner(t, S, outline, holes=[grow(S, GH[k], 5) for k in ('win_f', 'win_r', 'win_q')], depth=46, grid=50)
    add('Trim_Pillars', t, [M['headliner']], 'trim', coll='Cabin', ang=40)
    # 门板：车门那块区域往里 118（车门厚度），上面压一条腰线窗台，中间一根扶手，下面一个储物槽，前门下角一只喇叭
    def z_belt(y):
        return SKIN.p(y, BELT).z + 3
    for nm, poly, ya, yb in (('Trim_DoorF', L_DOOR_F + [(60, SILL), (60, BELT)], 1050, 100),
                             ('Trim_DoorR', [(60, BELT), (60, SILL)] + L_DOOR_R[::-1], 20, -1100)):
        t = bmesh.new()
        CK.inner(t, S, poly, depth=118, grid=60)
        CK.door_ridge(t, SKIN, ya, yb, z_belt, lambda y: z_belt(y) - 34, 38, 126, mi=1)             # 窗台
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
    for y in (-1110, -1250, -1450, -1650, -1820, Y_DECK + 12):
        hw_ = SKIN.p(y, BELT).x - 72
        z_ = 1002 + (y + 1110) * -.012
        rings.append([Vector((u, y, z_ + v)) for u, v in CK._rrect(2 * hw_, 18, 6, seg=2)])
    CK.loft(t, rings, 0)
    for sx in (-1, 1):
        CK.disc(t, (sx * 430, -1400, 1016), (0, 0, 1), 72, 4, mi=1, seg=28)
    add('Trim_Shelf', t, [M['fabric2'], M['piano']], 'trim', coll='Cabin', ang=40)
    # 车内后视镜：粘在前挡上沿正中
    t = bmesh.new()
    rbox(t, (0, 346, 1338), (232, 22, 64), 12, 0, 2, rot=(X, -12))
    cyl(t, (0, 296, 1404), (0, 340, 1348), 9, mi=0, seg=10)
    add('Trim_RearMirror', t, [M['piano']], 'trim', coll='Cabin', ang=40)


# ---------------------------------------------------------------- 盒子
SIZES = dict(s=(92, 70, 28), m=(136, 104, 38), l=(188, 148, 48), xl=(240, 190, 62), xxl=(320, 240, 84), z=(220, 150, 58))


def ecu_mesh(bm, s, kind='box'):
    x, y, z = s
    rbox(bm, (0, 0, 0), s, 5, 0, 1)
    # 接插件
    n = 1 if x < 120 else 2 if x < 200 else 3
    for i in range(n):
        cx = (i - (n - 1) / 2) * (x / n)
        rbox(bm, (cx, y / 2 + 8, 0), (x / n - 12, 18, z * .62), 2, 1, 1)
    # 大盒子带散热齿
    if kind == 'fin':
        for i in range(int(x / 13)):
            cx = -x / 2 + 10 + i * 13
            rbox(bm, (cx, 0, z / 2 + 7), (4.2, y * .9, 14), 0, 0, 1)


def build_ecus(M):
    grp('ecu', '电子控制盒', (0, 0, 0, 0))
    mats = [M['ecu'], M['conn']]
    for k, e in D.ECUS.items():
        bm = bmesh.new()
        s = SIZES[e['size']]
        ecu_mesh(bm, s, 'fin' if e['size'] in ('xl', 'xxl', 'z') else 'box')
        add(f'ECU_{k}', bm, mats, 'ecu', loc=e['pos'], ang=50, coll='EE', extras=dict(arch=e['arch'], dom=e['dom']))
    for k, p in D.PDU.items():
        bm = bmesh.new()
        ecu_mesh(bm, (170, 120, 60))
        add(f'PDU_{k}', bm, mats, 'ecu', loc=p['pos'], ang=50, coll='EE', extras=dict(arch='ABC', dom='nw'))


def build_endpoints(M):
    grp('endpoint', '传感器和执行器', (0, 0, 0, 0))
    mats = [M['ep'], M['conn']]
    for k, p in D.ENDPOINTS.items():
        bm = bmesh.new()
        kind = p['kind']
        if kind == 'camera':
            cyl(bm, (0, 0, -14), (0, 0, 14), 15, mi=1, seg=12)
            rbox(bm, (0, 0, -6), (42, 42, 22), 4, 0, 1)
        elif kind == 'radar':
            rbox(bm, (0, 0, 0), (84, 26, 84), 7, 0, 1)
        elif kind == 'uss':
            cyl(bm, (0, -9, 0), (0, 9, 0), 13, mi=0, seg=10)
        elif kind == 'lamp':
            rbox(bm, (0, 0, 0), (60, 60, 40), 8, 0, 1)
        elif kind == 'motor':
            cyl(bm, (-26, 0, 0), (26, 0, 0), 22, mi=0, seg=12)
            rbox(bm, (34, 0, 0), (24, 36, 36), 3, 1, 1)
        elif kind == 'speaker':
            lathe(bm, [(0, 0), (66, 0), (72, 10), (40, 30), (22, 34), (0, 34)], (0, -17, 0), 'Y', 16, 1)
        elif kind == 'display':
            rbox(bm, (0, 0, 0), (60, 26, 40), 4, 1, 1)
        else:
            rbox(bm, (0, 0, 0), (36, 28, 24), 4, 0, 1)
        add(f'EP_{k}', bm, mats, 'endpoint', loc=p['pos'], ang=50, coll='EE', extras=dict(dom=p['dom']))


# ---------------------------------------------------------------- 布线
ROAD = {k: Vector(v) for k, v in D.ROAD_NODES.items()}
ADJ = {k: [] for k in ROAD}
for a, b in D.ROAD_LINKS:
    w = (ROAD[a] - ROAD[b]).length
    ADJ[a].append((b, w))
    ADJ[b].append((a, w))


def nearest(p):
    p = Vector(p)
    return min(ROAD, key=lambda k: (ROAD[k] - p).length)


def dijkstra(src, dst):
    dist, prev = {src: 0.0}, {}
    pq = [(0.0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == dst:
            break
        if d > dist[u]:
            continue
        for v, w in ADJ[u]:
            nd = d + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    path = [dst]
    while path[-1] != src:
        path.append(prev[path[-1]])
    return path[::-1], dist[dst]


class Harness:
    """把一张架构里的所有线路走到道路图上，累计每段路上的线数"""

    def __init__(self, arch):
        self.arch = arch
        self.edges = {}     # (cls, a, b) → 线数
        self.stubs = []     # (cls, 外点, 路点, 线数)
        self.len = dict(sig=0.0, bus=0.0, eth=0.0, pwr=0.0)
        self.mass = dict(sig=0.0, bus=0.0, eth=0.0, pwr=0.0)
        self.wires = dict(sig=0, bus=0, eth=0, pwr=0)
        self.conn = 0

    def run(self, cls, p_a, p_b, n, kg_m):
        """从 p_a 到 p_b 走 n 根线"""
        if n <= 0:
            return None
        pa, pb = Vector(p_a), Vector(p_b)
        na, nb = nearest(pa), nearest(pb)
        if (pa - pb).length < (pa - ROAD[na]).length + (pb - ROAD[nb]).length:
            L = (pa - pb).length
            self._acc(cls, L, n, kg_m)
            self.stubs.append((cls, tuple(pa), tuple(pb), n))
            return [tuple(pa), tuple(pb)]
        path, d = dijkstra(na, nb)
        L = d + (pa - ROAD[na]).length + (pb - ROAD[nb]).length
        self._acc(cls, L, n, kg_m)
        self.stubs.append((cls, tuple(pa), tuple(ROAD[na]), n))
        self.stubs.append((cls, tuple(pb), tuple(ROAD[nb]), n))
        for a, b in zip(path, path[1:]):
            k = (cls, *sorted((a, b)))
            self.edges[k] = self.edges.get(k, 0) + n
        return [tuple(pa)] + [tuple(ROAD[k]) for k in path] + [tuple(pb)]

    def _acc(self, cls, L, n, kg_m):
        self.len[cls] += L * n * MM
        self.mass[cls] += L * n * MM * kg_m
        self.wires[cls] += n


def ecu_pos(k):
    return D.ECUS[k]['pos']


def chain_order(ids):
    """总线走线：从头开始每次接最近的下一个（雏菊链）"""
    left = list(ids[1:])
    out = [ids[0]]
    while left:
        cur = Vector(ecu_pos(out[-1]))
        nxt = min(left, key=lambda k: (Vector(ecu_pos(k)) - cur).length)
        out.append(nxt)
        left.remove(nxt)
    return out


def build_harness(arch):
    H = Harness(arch)
    nets = []
    G = D.GAUGE_KG_M
    # C 架构：智能执行器成组串接
    smart = {}
    if arch == 'C':
        for g, ids in D.SMART.items():
            host = D.ENDPOINTS[ids[0]]['hosts']['C']
            left = list(ids)
            cur, order = Vector(ecu_pos(host)), []
            while left:
                nxt = min(left, key=lambda k: (Vector(D.ENDPOINTS[k]['pos']) - cur).length)
                order.append(nxt)
                left.remove(nxt)
                cur = Vector(D.ENDPOINTS[nxt]['pos'])
            prev, prev_id = ecu_pos(host), host
            for k in order:
                pos = D.ENDPOINTS[k]['pos']
                path = H.run('sig', prev, pos, 2, G['s'])
                H.run('pwr', prev, pos, 2, G['m'])
                nets.append(dict(a=k, b=prev_id, kind='io', pts=[[round(c, 1) for c in q] for q in path]))
                prev, prev_id = pos, k
                smart[k] = True
    # 外设 → 宿主
    for k, p in D.ENDPOINTS.items():
        if k in smart:
            continue
        h = p['hosts'][arch]
        hp = ecu_pos(h)
        path = None
        if p['sig']:
            kg = G['c'] if p['gauge'] == 'c' else G['s'] if p['gauge'] in 's' else G['m'] if p['gauge'] == 'm' else G['s']
            cls = 'eth' if p['gauge'] == 'c' else 'sig'
            path = H.run(cls, p['pos'], hp, p['sig'], kg)
        if p['pwr']:
            kg = G['h'] if p['gauge'] == 'h' else G['m']
            path2 = H.run('pwr', p['pos'], hp, p['pwr'], kg)
            path = path or path2
        if path:
            nets.append(dict(a=k, b=h, kind='io', pts=[[round(c, 1) for c in q] for q in path]))
    # CAN：雏菊链，双绞
    for name, ids in D.BUSES[arch].items():
        order = chain_order(ids)
        for a, b in zip(order, order[1:]):
            path = H.run('bus', ecu_pos(a), ecu_pos(b), 2, G['can'])
            nets.append(dict(a=a, b=b, kind='can', bus=name, pts=[[round(c, 1) for c in q] for q in path]))
    # 以太网
    for a, b, n in D.ETH[arch]:
        path = H.run('eth', ecu_pos(a), ecu_pos(b), 2 * n, G['eth'])
        nets.append(dict(a=a, b=b, kind='eth', pts=[[round(c, 1) for c in q] for q in path]))
    # 低压供电：A/B 每个盒子各拉一根保险丝回路（前半车走前配电盒、后半车走舱内配电盒）
    ids = [k for k, e in D.ECUS.items() if arch in e['arch']]
    if arch in 'AB':
        H.run('pwr', D.PDU['PF']['pos'], D.PDU['PC']['pos'], 2, G['bb'])
        for k in ids:
            src = 'PF' if D.ECUS[k]['pos'][1] > 1100 else 'PC'
            H.run('pwr', D.PDU[src]['pos'], ecu_pos(k), 2, G['feed'])
    else:
        # C：一条粗电源环串起四个区控，区控内部用电子保险丝分给负载
        ring = [('ZFL', 'ZFR'), ('ZFL', 'ZRL'), ('ZFR', 'ZRR')]
        H.run('pwr', D.PDU['PF']['pos'], ecu_pos('ZFR'), 2, G['bb'])
        for a, b in ring:
            H.run('pwr', ecu_pos(a), ecu_pos(b), 2, G['bb'])
        for k in ids:
            if k[0] == 'Z':
                continue
            z = ('ZF' if D.ECUS[k]['pos'][1] > 0 else 'ZR') + ('L' if D.ECUS[k]['pos'][0] < 0 else 'R')
            H.run('pwr', ecu_pos(z), ecu_pos(k), 2, G['feed'])
    return H, nets


OFFS = dict(sig=Vector((0, 0, 0)), bus=Vector((0, 0, 15)), eth=Vector((15, 0, 8)), pwr=Vector((-15, 0, 8)))


def tube_r(n, cls):
    base = dict(sig=1.25, bus=1.0, eth=1.5, pwr=1.9)[cls]
    return min(max(base * sqrt(n), 2.4 if cls != 'eth' else 3.4), 26)


def build_harness_mesh(M, H):
    for cls in ('sig', 'bus', 'eth', 'pwr'):
        bm = bmesh.new()
        off = OFFS[cls]
        count = 0
        joint = {}
        for (c, a, b), n in H.edges.items():
            if c != cls:
                continue
            r = tube_r(n, cls)
            pa, pb = ROAD[a] + off, ROAD[b] + off
            cyl(bm, pa, pb, r, mi=0, seg=7)
            joint[a] = max(joint.get(a, 0), r)
            joint[b] = max(joint.get(b, 0), r)
            count += 1
        for k, r in joint.items():
            ball(bm, ROAD[k] + off, r * 1.04, 0, seg=6)
        merged = {}
        for (c, p, q, n) in H.stubs:
            if c == cls:
                merged[(p, q)] = merged.get((p, q), 0) + n
        for (p, q), n in merged.items():
            P, Q = Vector(p), Vector(q)
            if (P - Q).length < 1:
                continue
            r = max(tube_r(n, cls) * .7, 2.0)
            # 分支从路点出来时加一点弧度，别全是直线
            mid = (P + Q) / 2 + Vector((0, 0, -.06 * (P - Q).length))
            cyl(bm, P + off * .4, mid + off * .7, r, mi=0, seg=5, smooth=False)
            cyl(bm, mid + off * .7, Q + off, r, mi=0, seg=5, smooth=False)
            count += 1
        if count:
            add(f'Harness_{H.arch}_{cls}', bm, [M[cls]], f'harness{H.arch}', ang=60, coll='EE', extras=dict(arch=H.arch, cls=cls))
        else:
            bm.free()


# ---------------------------------------------------------------- 车队用的低模
def build_fleet(M):
    grp('fleet', '车队低模', (0, 0, 0, 0))
    bm = bmesh.new()
    ys = [Y_TAIL + 6, -2385, -2340] + [-2340 + i * (2300 + 2340) / 18 for i in range(1, 19)] + [2330]
    ss = [0, 2, 3, 4.5, 6, 7, 8, 9, 10.5, 12]
    rings = []
    for y in ys:
        cp = section_ctrl(y)
        half = [cat(cp, s) for s in ss]
        ring = [bm.verts.new((x, y, z)) for (x, z) in half]
        ring += [bm.verts.new((-x, y, z)) for (x, z) in half[-2:0:-1]]
        rings.append(ring)
    n = len(rings[0])
    for i in range(len(rings) - 1):
        for j in range(n):
            f = bm.faces.new((rings[i][j], rings[i][(j + 1) % n], rings[i + 1][(j + 1) % n], rings[i + 1][j]))
            f.smooth = True
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    add('FleetCar', bm, [M['ep']], 'fleet', coll='Fleet', ang=50)


# ---------------------------------------------------------------- 拆开看：传统 ECU vs 中央计算
DETAIL_X = 8000.0


def build_details(M):
    grp('detail', '拆开的控制器', (0, 0, 0, 0))
    bx = DETAIL_X
    pcb_m = [M['pcb'], M['chip'], M['gold'], M['conn'], M['sink'], M['ecu']]
    # ---- 左：一个传统 ECU（放大 2.4 倍的一块小板）
    ox, oy = bx - 900, 0

    def part(name, build, role):
        bm = bmesh.new()
        build(bm)
        add(name, bm, pcb_m, 'detail', ang=45, coll='Detail', extras=dict(role=role))

    def small_pcb(b):
        rbox(b, (ox, oy, 60), (420, 320, 12), 6, 0, 1)
        rbox(b, (ox, oy + 20, 84), (150, 150, 26), 3, 1, 1)
        for i in range(6):
            rbox(b, (ox - 150, oy - 120 + i * 40, 76), (46, 24, 14), 2, 1, 1)
        for i in range(4):
            cyl(b, (ox + 150, oy - 90 + i * 60, 66), (ox + 150, oy - 90 + i * 60, 110), 22, mi=4, seg=12)
    part('Det_small_pcb', small_pcb, 'smallpcb')

    def small_case(b):
        rbox(b, (ox, oy, 28), (480, 370, 48), 10, 5, 1)
        rbox(b, (ox, oy + 215, 62), (340, 70, 76), 6, 3, 1)
        for i in range(10):
            rbox(b, (ox - 140 + i * 31, oy + 180, 86), (6, 18, 6), 0, 2, 1)
    part('Det_small_case', small_case, 'smallcase')

    # ---- 右：中央计算
    ox2 = bx + 560

    def case(b):
        rbox(b, (ox2, oy, 30), (1120, 860, 52), 12, 5, 1)
        rbox(b, (ox2, oy + 480, 74), (880, 90, 100), 8, 3, 1)
    part('Det_ccc_case', case, 'case')

    def pcb(b):
        rbox(b, (ox2, oy, 66), (1060, 800, 14), 6, 0, 1)
        for i in range(14):
            rbox(b, (ox2 - 360 + i * 56, oy + 360, 80), (30, 34, 16), 2, 2, 1)
    part('Det_ccc_pcb', pcb, 'pcb')

    def soc(b):
        rbox(b, (ox2 - 140, oy - 40, 94), (300, 300, 34), 4, 1, 1)
    part('Det_soc', soc, 'soc')

    def sink(b):
        rbox(b, (ox2 - 140, oy - 40, 122), (380, 380, 18), 4, 4, 1)
        for i in range(16):
            rbox(b, (ox2 - 320 + i * 24, oy - 40, 160), (9, 370, 60), 0, 4, 1)
    part('Det_sink', sink, 'sink')

    def ram(b):
        for (dx, dy) in ((-50, 190), (60, 190), (170, 190), (-340, 170), (-340, 60)):
            rbox(b, (ox2 - 140 + dx + (0 if dy > 180 else 0), oy - 40 + dy, 86), (96, 66, 18), 2, 1, 1)
    part('Det_ram', ram, 'ram')

    def mcu(b):
        rbox(b, (ox2 + 310, oy + 90, 88), (180, 180, 22), 3, 1, 1)
        for i in range(4):
            rbox(b, (ox2 + 310, oy + 200 + 0 * i, 80), (140, 14, 8), 1, 2, 1)
    part('Det_mcu', mcu, 'mcu')

    def sw(b):
        rbox(b, (ox2 + 310, oy - 170, 86), (150, 150, 18), 3, 1, 1)
    part('Det_switch', sw, 'switch')

    def pmic(b):
        for (dx, dy) in ((-430, -300), (-340, -300), (-250, -300), (-160, -300)):
            rbox(b, (ox2 + dx, oy + dy, 82), (66, 66, 14), 2, 1, 1)
        for i in range(6):
            cyl(b, (ox2 + 60 + i * 56, oy - 320, 72), (ox2 + 60 + i * 56, oy - 320, 120), 22, mi=4, seg=12)
    part('Det_pmic', pmic, 'pmic')


# ---------------------------------------------------------------- 导出
def round_stats(H):
    tot_len = sum(H.len.values())
    tot_mass = sum(H.mass.values())
    return dict(len_m=round(tot_len, 1), mass_kg=round(tot_mass, 1), wires=sum(H.wires.values()),
                by_len={k: round(v, 1) for k, v in H.len.items()}, by_mass={k: round(v, 2) for k, v in H.mass.items()})


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


HIDE_EE = ['Harness_', 'ECU_', 'PDU_', 'EP_', 'FleetCar', 'Det_']
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
        if nm not in CHECK_VIEWS:
            print('[check] 没有这个机位:', nm)
            continue
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
    clamp_data()
    M = make_materials()
    setup_skin()
    setup_greenhouse()
    build_frame(M)
    gaps = build_panels(M)
    build_glass(M)
    build_wheels(M)
    build_chassis(M)
    build_cabin(M)
    build_ecus(M)
    build_endpoints(M)
    stats, nets = {}, {}
    for arch in 'ABC':
        grp(f'harness{arch}', f'线束 {arch}', (0, 0, 0, 0))
        H, N = build_harness(arch)
        build_harness_mesh(M, H)
        stats[arch] = round_stats(H)
        stats[arch]['ecu'] = sum(arch in e['arch'] for e in D.ECUS.values())
        nets[arch] = N
        print('[harness]', arch, stats[arch])
    build_fleet(M)
    build_details(M)
    tris = 0
    for o, _ in OBJS:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    spec = dict(
        domains=D.DOMAINS, suppliers=D.SUPPLIERS, ecus=D.ECUS, pdu=D.PDU, buses=D.BUSES, eth=D.ETH,
        functions=D.FUNCTIONS, endpoints=D.ENDPOINTS, features=D.FEATURES, stats=stats, nets=nets,
        groups=GROUPS, explode={k: list(v) for k, v in EX.items()}, objects={o.name: g for o, g in OBJS},
        detail_x=DETAIL_X, sizes=SIZES, tris=tris, gaps=gaps,
    )
    cam = setup_render()
    if not ARGS.noexport:
        with open(os.path.join(OUT, 'spec.json'), 'w', encoding='utf-8') as f:
            json.dump(spec, f, ensure_ascii=False, separators=(',', ':'))
        export_glb(os.path.join(OUT, 'sdv.glb'))
        animate()
        aim(cam, (-5.4, 6.2, 2.1), (0, .1, .62))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'sdv.blend'), compress=True)
        print('[OK] saved sdv.blend')
    if ARGS.check:
        check_views(cam, [v for v in ARGS.check.split(',') if v])
    if ARGS.stage:
        base = ['BIW', 'Wheel_', 'Brake_', 'Battery', 'RearDrive', 'Subframes', 'HVCable']
        steps = dict(frame=base)
        steps['panels'] = steps['frame'] + ['Panel_', 'Lamp', 'Mirrors', 'Seams', 'Wheelhouse', 'Cowl', 'Plates']
        steps['glass'] = steps['panels'] + ['Glass']   # Glass 和 GlassBond
        # 座椅、内饰在车里看不见：把门、车顶、窗框、玻璃拿掉，从斜上方看（剖开的样子）
        cut = base + ['Panel_Hood', 'Panel_BumperF', 'Panel_Fender', 'Panel_SideOuter', 'Panel_Trunk', 'Panel_BumperR',
                      'Panel_Rocker', 'Panel_Under', 'Panel_NoseCap', 'Panel_TailCap', 'Lamp', 'Wheelhouse', 'Cowl']
        steps['seats'] = cut + ['Floor', 'Seat']
        steps['interior'] = steps['seats'] + ['Trim_Shelf', 'Dash', 'SteeringWheel', 'Console', 'Pedals', 'IP_']
        views = dict(seats=((-3.7, 3.3, 3.2), (0, -.2, .55)), interior=((-3.7, 3.3, 3.2), (0, -.2, .55)))
        if ARGS.stage in steps:
            pos, tgt = views.get(ARGS.stage, ((-5.0, 5.5, 2.5), (0, -.05, .62)))
            render(cam, f'stage_{ARGS.stage}.jpg', pos, tgt, show=steps[ARGS.stage])
    if ARGS.render:
        hide_ee = ['Harness_', 'ECU_', 'PDU_', 'EP_', 'FleetCar', 'Det_']
        render(cam, 'view_exterior.jpg', (-5.6, 6.3, 2.0), (0, .05, .6), hide=hide_ee)
        render(cam, 'view_exterior_rear.jpg', (5.2, -6.4, 2.1), (0, -.05, .6), hide=hide_ee)
        render(cam, 'view_side.jpg', (-16, 0, .72), (0, 0, .72), hide=hide_ee, lens=105)
        render(cam, 'view_interior.jpg', (0, -.3, 1.17), (-.12, 1.0, .88), hide=hide_ee, lens=16)
        render(cam, 'view_cabin.jpg', (-3.3, -3.5, 3.4), (0, .25, .6), hide=hide_ee + list(CUT_HIDE))
        shell = ['Panel_', 'Glass', 'Seams', 'Lamp_', 'Mirrors', 'Wheelhouse', 'Cowl', 'BIW', 'FleetCar', 'Det_', 'Floor', 'Seat',
                 'Plates', 'Trim_', 'Dash', 'Console', 'SteeringWheel', 'Pedals', 'IP_']
        offA = [f'ECU_{k}' for k, e in D.ECUS.items() if 'A' not in e['arch']]
        offC = [f'ECU_{k}' for k, e in D.ECUS.items() if 'C' not in e['arch']]
        render(cam, 'view_arch_A.jpg', (-4.3, 4.9, 3.2), (0, .05, .5), hide=shell + offA + ['Harness_B', 'Harness_C'])
        render(cam, 'view_arch_C.jpg', (-4.3, 4.9, 3.2), (0, .05, .5), hide=shell + offC + ['Harness_A', 'Harness_B'])
    print(f'[OK] {len(OBJS)} objects, {tris} triangles')


if __name__ == "__main__":
    main()
