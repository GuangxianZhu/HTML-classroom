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

_argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
_ap = argparse.ArgumentParser()
_ap.add_argument('--out', default=os.path.join(HERE, 'out'))
_ap.add_argument('--render', action='store_true')
_ap.add_argument('--samples', type=int, default=48)
_ap.add_argument('--res', type=int, default=1400)
ARGS, _ = _ap.parse_known_args(_argv)
OUT = os.path.abspath(ARGS.out)
os.makedirs(OUT, exist_ok=True)

MM = 0.001
FRAMES = 120
WB = 1400.0          # 前后轴到原点
R_TYRE = 345.0
R_ARCH = 378.0
TRACK = 800.0        # 轮胎中面


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


def principled(name, hexc, metal=0.0, rough=0.5, coat=0.0, emit=None, alpha=None):
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
    m.diffuse_color = (*col, 1.0)
    m.metallic = metal
    m.roughness = rough
    return m


def make_materials():
    return dict(
        paint=principled('Paint', '#26465f', metal=.55, rough=.32, coat=1.0),
        trim=principled('Trim', '#14171b', rough=.62),
        glass=principled('Glass', '#090e13', rough=.14),
        seam=principled('Seam', '#050608', rough=.55),
        tyre=principled('Tyre', '#15171a', rough=.86),
        rim=principled('Rim', '#b9c1ca', metal=.92, rough=.3),
        rimdark=principled('RimDark', '#2b3036', metal=.6, rough=.42),
        disc=principled('Disc', '#8d949c', metal=.9, rough=.42),
        lamp=principled('Lamp', '#eaf3ff', metal=.1, rough=.15, emit=('#dcebff', 3.0)),
        tail=principled('TailLamp', '#a00d18', rough=.2, emit=('#ff1a2c', 2.2)),
        fabric=principled('Fabric', '#3a4048', rough=.9),
        fabric2=principled('Fabric2', '#2a2f36', rough=.92),
        dash=principled('Dash', '#22262c', rough=.65),
        screen=principled('Screen', '#0f2233', metal=.1, rough=.2, emit=('#2f7fb0', 1.2)),
        steel=principled('Steel', '#6c7680', metal=.8, rough=.45),
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
            f = bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
            f.material_index = mi
            f.smooth = True
            fs.append(f)
    if not closed:
        for ring in (rings[0], rings[-1]):
            f = bm.faces.new(ring)
            f.material_index = mi
            fs.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=fs)
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
ZTOP = _prof([(-2415, 640), (-2402, 840), (-2372, 985), (-2330, 1052), (-2240, 1086), (-1950, 1092), (-1700, 1124),
              (-1300, 1262), (-900, 1380), (-400, 1452), (-100, 1468), (250, 1440), (480, 1368), (820, 1180), (1170, 985),
              (1450, 908), (1900, 812), (2160, 728), (2290, 640), (2330, 560), (2345, 470)])
ZBELT = _prof([(-2415, 640), (-2402, 840), (-2372, 972), (-2330, 1030), (-2240, 1058), (-1950, 1070), (-1700, 1086),
               (-1300, 1076), (-400, 1032), (400, 988), (1170, 940), (1450, 880), (1900, 788), (2160, 708), (2290, 622),
               (2330, 545), (2345, 470)])
ZBOT = _prof([(-2415, 640), (-2402, 430), (-2360, 300), (-2250, 245), (-1900, 188), (-1400, 172), (1400, 172), (2000, 188),
              (2250, 235), (2330, 330), (2345, 470)])
HW = _prof([(-2415, 40), (-2405, 430), (-2380, 640), (-2330, 765), (-2200, 858), (-1900, 912), (-1400, 934), (0, 925),
            (1400, 930), (1900, 892), (2150, 790), (2280, 640), (2330, 460), (2345, 120)])
HT = _prof([(-2415, 20), (-2400, 340), (-2330, 610), (-2200, 690), (-1950, 690), (-1700, 650), (-1300, 610), (-400, 600),
            (300, 600), (480, 620), (820, 700), (1170, 780), (1450, 760), (1900, 700), (2150, 610), (2290, 480), (2345, 80)])

NSEG = 12


def section_ctrl(y):
    zt, zb, zbl, hw, ht = ZTOP(y), ZBOT(y), ZBELT(y), HW(y), HT(y)
    k = min(1.0, hw / 420)
    ht = min(ht, hw - 40 * k)
    h = max(zbl - zb, 1.0)
    gh = max(zt - zbl, .5)
    ed = min(72.0, .22 * gh + 3 * k)
    hwb = hw - 135 * k
    p7 = (hw - 42 * k - .02 * gh, zbl + .05 * gh + 4 * k)
    p9 = (ht + 8 * k, zt - ed)
    return [
        (0, zb), (hwb * .55, zb), (hwb, zb + 2 * k), (hw - 34 * k, zb + .18 * h), (hw - 6 * k, zb + .42 * h),
        (hw, zb + .72 * h), (hw - 13 * k, zbl - 10 * k), p7,
        ((p7[0] + p9[0]) / 2 + 10 * k, (p7[1] + p9[1]) / 2), p9,
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
    for sx in (1, -1):
        prev = None
        for i in range(N + 1):
            ring = []
            for (z, L) in lines:
                x, y = L[i]
                a, b = L[max(i - 1, 0)], L[min(i + 1, N)]
                tx, ty = b[0] - a[0], b[1] - a[1]
                nx, ny = -ty * sgn, tx * sgn
                k = math.hypot(nx, ny) or 1
                nx, ny = nx / k, ny / k
                zz = z
                if taper:
                    t = i / N
                    if t > 1 - taper:
                        q = (t - (1 - taper)) / taper
                        zz = z + ((z0 + z1) / 2 - z) * q
                ring.append(bm.verts.new((sx * (x + nx * push), y + ny * push, zz)))
            if prev:
                for j in range(len(ring) - 1):
                    q = (prev[j], prev[j + 1], ring[j + 1], ring[j])
                    f = bm.faces.new(q if (sx * sgn) > 0 else q[::-1])
                    f.material_index = mi
                    f.smooth = True
            prev = ring


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


def build_body(M):
    grp('shell', '车身外壳', (0, 0, 1500, 0))
    mats = [M['paint'], M['trim']]
    bm = body_mesh(M_IDX)
    # 轮拱：车身是封闭实体，圆柱切进去，留下的内壁就是轮罩
    me = bpy.data.meshes.new('Body')
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new('Body', me)
    collection('Car').objects.link(ob)
    cut = bmesh.new()
    for y in (WB, -WB):
        for sx in (1, -1):
            x0, x1 = 610 * sx, 1120 * sx
            cyl(cut, (x0, y, R_TYRE), (x1, y, R_TYRE), R_ARCH, mi=1, seg=64, smooth=True)
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
    # 切出来的面全部算轮罩（黑）：落在任一圆柱内的面
    for f in bm.faces:
        c = f.calc_center_median()
        for y in (WB, -WB):
            if math.hypot(c.y - y, c.z - R_TYRE) < R_ARCH + 3 and abs(c.x) > 605:
                f.material_index = 1
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    add('Body', bm, mats, 'shell', ang=38)

    # 玻璃：一整块玻璃顶 + 侧窗
    gm = bmesh.new()
    canopy = [(1135, 9.28), (1090, 9.6), (1000, 12), (-1690, 12), (-1720, 10.2), (-1640, 9.52), (-1250, 9.3), (-800, 9.25), (-100, 9.22), (400, 9.25), (800, 9.3)]
    canopy = chaikin(canopy, 2)
    patch(gm, canopy, 0, off=2.5)
    bmesh.ops.remove_doubles(gm, verts=gm.verts, dist=.8)
    side = chaikin([(1060, 7.2), (720, 8.2), (400, 8.82), (-320, 8.9), (-880, 8.82), (-1200, 8.25), (-1500, 7.25), (-300, 7.22)], 2)
    patch(gm, side, 0, off=2.0)
    add('Glass', gm, [M['glass']], 'shell', ang=40)
    # 缝、把手、B 柱
    sm = bmesh.new()
    ribbon(sm, [(60, 7.1), (60, 8.86)], 62, 0, off=3.0)       # B 柱（亮黑）
    for line in (
        [(1110, 7.0), (1085, 5.4), (1000, 3.5)],                # 前门前缝
        [(60, 7.0), (60, 3.3)],                                 # 前后门之间
        [(-1170, 7.1), (-1060, 6.0), (-1010, 5.0), (-1000, 3.3)],   # 后门后缝
        [(1000, 3.32), (-1000, 3.32)],                          # 门槛
        [(1178, 12), (1178, 9.1), (1172, 7.9), (1600, 7.45), (1980, 7.1), (2130, 7.1), (2150, 8.5), (2152, 12)],  # 前舱盖
        [(-1735, 12), (-1730, 9.0), (-1760, 7.6), (-2100, 7.3), (-2300, 7.2), (-2330, 8.2), (-2333, 12)],   # 尾门
    ):
        ribbon(sm, line, 4.5, 0)
    for yc in (560, -540):                                      # 隐藏式门把手
        ribbon(sm, [(yc + 95, 6.98), (yc - 95, 6.98)], 22, 0, off=1.6)
    band(sm, 290, 412, Y_NOSE, 1990, 0, push=2.0)               # 前下进气口
    band(sm, 250, 440, Y_TAIL, -2120, 0, push=2.0)              # 后扩散器
    add('Seams', sm, [M['seam']], 'shell', ang=50)
    lm = bmesh.new()
    band(lm, 646, 668, Y_NOSE, 1960, 0, push=2.4, taper=.28)    # 贯穿头灯
    add('HeadLamps', lm, [M['lamp']], 'shell', ang=70)
    tm = bmesh.new()
    band(tm, 962, 1000, Y_TAIL, -2130, 0, push=2.4, taper=.25)  # 贯穿尾灯
    add('TailLamps', tm, [M['tail']], 'shell', ang=70)
    # 后视镜
    mm = bmesh.new()
    for sx in (1, -1):
        ball(mm, (sx * 985, 955, 1022), 70, 0, seg=14, sc=(1.25, .6, .66))
        cyl(mm, (sx * 880, 972, 992), (sx * 950, 960, 1012), 12, 10, 1, seg=8)
    add('Mirrors', mm, [M['paint'], M['trim']], 'shell', ang=45)


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
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
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
            cyl(bm, (sx * 650, y0 + wy * 10, 330), (sx * 640, y0 + wy * 10, 760), 32, 32, 1, seg=14)   # 减震
    cyl(bm, (-640, 1335, 320), (640, 1335, 320), 26, mi=0, seg=14)   # 转向机
    cyl(bm, (-370, 1300, 340), (-370, 880, 760), 18, 16, 0, seg=10)  # 转向管柱
    # 前舱：冷凝器、12V、水壶
    rbox(bm, (0, 2070, 560), (1120, 44, 380), 10, 2, 1)
    rbox(bm, (350, 1520, 560), (240, 170, 180), 12, 3, 2)
    cyl(bm, (-260, 1720, 440), (-260, 1720, 540), 60, mi=0, seg=16)
    cyl(bm, (260, 1730, 380), (260, 1730, 500), 74, mi=1, seg=18)
    add('Subframes', bm, [M['steel'], M['alu'], M['pack'], M['conn']], 'chassis', coll='Chassis', ang=40)
    bm = bmesh.new()
    # 高压线：橙色
    path = [(0, -1200, 345), (120, -1260, 420), (160, -1330, 500)]
    for a, b in zip(path, path[1:]):
        cyl(bm, a, b, 13, mi=0, seg=10)
    cyl(bm, (-200, -1050, 340), (-430, -1850, 520), 11, mi=0, seg=10)
    add('HVCable', bm, [M['hv']], 'chassis', coll='Chassis')


def build_cabin(M):
    grp('cabin', '座舱', (0, 0, 620, 0))
    bm = bmesh.new()
    # 地板和防火墙
    rbox(bm, (0, -60, 338), (1540, 2500, 16), 6, 0, 1)
    rbox(bm, (0, 1190, 620), (1560, 22, 560), 6, 0, 1)
    rbox(bm, (0, -1180, 700), (1560, 22, 700), 6, 0, 1, rot=None)
    add('Floor', bm, [M['dash']], 'cabin', coll='Cabin')

    def seat(c, w=500):
        cx, cy, cz = c
        s = bmesh.new()
        rbox(s, (0, 40, 40), (w, 500, 110), 44, 0, 3, rot=(Vector((1, 0, 0)), 6))
        rbox(s, (0, -210, 330), (w * .98, 120, 620), 46, 0, 3, rot=(Vector((1, 0, 0)), -16))
        rbox(s, (0, -300, 700), (240, 100, 170), 40, 1, 3, rot=(Vector((1, 0, 0)), -12))
        rbox(s, (0, 20, -50), (w * .8, 420, 60), 14, 1, 1)
        for sx in (1, -1):
            rbox(s, (sx * (w / 2 - 34), 60, 66), (56, 460, 90), 26, 1, 2, rot=(Vector((1, 0, 0)), 6))
            rbox(s, (sx * (w / 2 - 30), -190, 300), (58, 110, 520), 26, 1, 2, rot=(Vector((1, 0, 0)), -16))
        return s, c

    for tag, c in (('SeatFL', (-370, 200, 480)), ('SeatFR', (370, 200, 480))):
        s, loc = seat(c)
        add(tag, s, [M['fabric'], M['fabric2']], 'cabin', loc=loc, coll='Cabin', ang=45)
    s = bmesh.new()
    rbox(s, (0, -740, 470), (1400, 500, 120), 46, 0, 3, rot=(Vector((1, 0, 0)), 8))
    rbox(s, (0, -1010, 770), (1400, 120, 560), 44, 0, 3, rot=(Vector((1, 0, 0)), -18))
    for x in (-460, 0, 460):
        rbox(s, (x, -1110, 1060), (230, 90, 140), 36, 1, 3, rot=(Vector((1, 0, 0)), -14))
    add('SeatRear', s, [M['fabric'], M['fabric2']], 'cabin', coll='Cabin', ang=45)
    # 仪表台：沿 X 的截面拉伸，再收两端
    d = bmesh.new()
    prof = [(1170, 620), (1170, 940), (980, 980), (760, 945), (620, 860), (640, 760), (780, 700), (900, 620)]
    xs = [-800 + i * 40 for i in range(41)]
    rings = []
    for x in xs:
        ring = []
        for (y, z) in prof:
            k = 1 - .10 * (abs(x) / 800) ** 3
            ring.append(d.verts.new((x, y, z * k + 40 * (1 - k))))
        rings.append(ring)
    n = len(prof)
    for i in range(len(rings) - 1):
        for j in range(n):
            f = d.faces.new((rings[i][j], rings[i][(j + 1) % n], rings[i + 1][(j + 1) % n], rings[i + 1][j]))
            f.material_index = 0
            f.smooth = True
    d.faces.new(rings[0]).material_index = 0
    d.faces.new(rings[-1]).material_index = 0
    bmesh.ops.recalc_face_normals(d, faces=d.faces)
    # 中控屏 + 仪表 + 方向盘 + 中央通道
    rbox(d, (0, 700, 925), (400, 16, 240), 10, 1, 2, rot=(Vector((1, 0, 0)), 10))
    rbox(d, (-370, 835, 912), (240, 12, 86), 6, 1, 1, rot=(Vector((1, 0, 0)), 10))
    rbox(d, (0, 180, 480), (220, 1000, 240), 24, 0, 2)
    add('Dash', d, [M['dash'], M['screen']], 'cabin', coll='Cabin', ang=42)
    w = bmesh.new()
    prof = []
    for k in range(13):
        a = 2 * pi * k / 12
        prof.append((172 + 15 * cos(a), 15 * sin(a)))
    fs = []
    rings = []
    seg = 40
    for k in range(seg):
        t = 2 * pi * k / seg
        ring = []
        for (r, a) in prof[:-1]:
            ring.append(w.verts.new((r * cos(t), a, r * sin(t))))
        rings.append(ring)
    n = len(prof) - 1
    for k in range(seg):
        for j in range(n):
            f = w.faces.new((rings[k][j], rings[k][(j + 1) % n], rings[(k + 1) % seg][(j + 1) % n], rings[(k + 1) % seg][j]))
            f.smooth = True
    rbox(w, (0, 18, 0), (120, 60, 90), 22, 0, 2)
    for a in (0, 180, 270):
        p = Vector((165 * cos(radians(a)), 0, 165 * sin(radians(a))))
        cyl(w, (0, 12, 0), p, 18, 14, 0, seg=8)
    bmesh.ops.recalc_face_normals(w, faces=w.faces)
    bmesh.ops.rotate(w, verts=w.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(radians(-24), 3, 'X'))
    add('SteeringWheel', w, [M['fabric2']], 'cabin', loc=(-370, 700, 780), coll='Cabin', ang=45)


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
    bg.inputs[0].default_value = (*hexcol('#0b1626'), 1)
    bg.inputs[1].default_value = .55

    def light(name, loc_, energy, size):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.energy = energy
        ld.size = size
        ob = bpy.data.objects.new(name, ld)
        collection('Studio').objects.link(ob)
        ob.location = loc_
        d = Vector((0, .2, .5)) - Vector(loc_)
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

    light('Key', (-2.6, -3.6, 4.2), 1500, 5.0)
    light('Rim', (3.8, 3.2, 2.2), 900, 5.0)
    light('Fill', (-4.6, 2.6, 1.8), 500, 5.0)
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


def aim(cam, pos, tgt):
    cam.location = Vector(pos)
    cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()


def render(cam, name, pos, tgt, hide=(), frame=1):
    sc = bpy.context.scene
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
    for ob, _ in OBJS:
        ob.hide_render = any(ob.name.startswith(h) for h in hide)
    sc.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    print('[OK] rendered', name)
    for ob, _ in OBJS:
        ob.hide_render = False


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
    build_body(M)
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
        detail_x=DETAIL_X, sizes=SIZES, tris=tris,
    )
    with open(os.path.join(OUT, 'spec.json'), 'w', encoding='utf-8') as f:
        json.dump(spec, f, ensure_ascii=False, separators=(',', ':'))
    cam = setup_render()
    export_glb(os.path.join(OUT, 'sdv.glb'))
    animate()
    aim(cam, (-5.4, 6.2, 2.1), (0, .1, .62))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'sdv.blend'), compress=True)
    print('[OK] saved sdv.blend')
    if ARGS.render:
        hide_ee = ['Harness_', 'ECU_', 'PDU_', 'EP_', 'FleetCar', 'Det_']
        render(cam, 'view_exterior.jpg', (-5.6, 6.3, 2.0), (0, .05, .6), hide=hide_ee)
        render(cam, 'view_exterior_rear.jpg', (5.2, -6.4, 2.1), (0, -.05, .6), hide=hide_ee)
        shell = ['Body', 'Glass', 'Seams', 'HeadLamps', 'TailLamps', 'Mirrors', 'FleetCar', 'Det_', 'Floor', 'SeatFL', 'SeatFR', 'SeatRear']
        offA = [f'ECU_{k}' for k, e in D.ECUS.items() if 'A' not in e['arch']]
        offC = [f'ECU_{k}' for k, e in D.ECUS.items() if 'C' not in e['arch']]
        render(cam, 'view_arch_A.jpg', (-4.3, 4.9, 3.2), (0, .05, .5), hide=shell + offA + ['Harness_B', 'Harness_C'])
        render(cam, 'view_arch_C.jpg', (-4.3, 4.9, 3.2), (0, .05, .5), hide=shell + offC + ['Harness_A', 'Harness_B'])
    print(f'[OK] {len(OBJS)} objects, {tris} triangles')


main()
