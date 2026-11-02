#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
无转盘（平板式）微波炉 · Blender 纯脚本建模

运行方式（二选一）:
    blender -b -P build_microwave.py -- --out out
    python  build_microwave.py --out out          # 需要 pip install bpy

思路：参数表 P → 零件树（每个零件一个函数）→ 导出 GLB / .blend / 预览图。
所有尺寸单位 mm，坐标系：x 向右，y 向机身后方，z 向上；机器正面朝 -y。
底部馈能结构参考公开专利 JP6861397B2（平板状旋转天线），不是任何一款具体产品。
"""
import argparse
import json
import math
import os
import sys

import bpy  # 必须排在 bmesh 前面：pip 版 bpy 导入后才注册 bmesh / mathutils
import bmesh
from mathutils import Matrix, Vector, geometry

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # Blender 自带的 Python 没有 PIL 时，只是少了面板文字贴图
    Image = None

# ---------------------------------------------------------------- 参数表 ----
P = dict(
    # 外壳
    X0=-250, X1=250, Y0=-190, Y1=205, Z0=14, Z1=336, FOOT=14, SHELL_T=1.5,
    # 加热腔：内尺寸 320×340×205 mm（约 22 L）
    CW=320, CD=340, CH=205, CX=-66, CY=-8, FLOOR_Z=110, GLASS_T=4,
    # 门
    DOOR_T=26, DOOR_X0=-249, DOOR_X1=98,
    # 馈能室：地板下的金属凹槽，只朝上开口
    FEED_TOP=236, FEED_BOT=156, FEED_Z=84,
    # 波导：顶面平齐，磁控管一侧高 H1，天线（电机）一侧矮 H2
    WG_W=90, WG_TOP=84, WG_H1=42, WG_H2=22, WG_X0=-136, WG_X1=236, WG_T=1.5,
    # 磁控管（输出端从波导顶壁向下插入）
    MAG_X=170,
    # 平板天线（JP6861397B2 实施例 1 的轮廓数字）
    ANT_Z=98, ANT_T=1.0, ANT_R1=60, ANT_R2=45, ANT_TIP=70, ANT_TIP_W=50,
    SLOT_L=35, SLOT_L3=45, SLOT_W=10,
)
U = 0.001  # mm → m

# 爆炸图位移（mm）。沿腔体轴线上下码放，机械室往右，门去左前，面板去右前。
# .blend 里的动画和网页都读这一张表。
EXPLODE = {
    "OuterCover": (0, 0, 560), "BackPanel": (0, 420, 60), "FrontFrame": (0, -150, 300),
    "CavityBox": (0, 0, 300), "CavityLamp": (150, 0, 300), "IRSensor": (0, 0, 500),
    "GlassFloor": (0, 0, 175), "WeightSensors": (0, 0, 120), "AntennaPlate": (0, 0, 72), "AntennaShaft": (0, 0, 36),
    "AntennaBearing": (0, 0, 14), "FeedChamber": (0, 0, 0), "Waveguide": (0, 0, -70), "ResinShaft": (0, 0, -100),
    "AntennaMotor": (0, 0, -170), "BasePlate": (0, 0, -270),
    "Magnetron": (240, 0, 90), "FanShroud": (240, 200, 90), "FanBlade": (240, 175, 90), "FanMotor": (240, 240, 90),
    "InverterBoard": (240, -40, 250), "Wiring": (240, 0, 170),
    "DoorChoke": (-420, -60, 40), "DoorMesh": (-420, -130, 40), "DoorFrame": (-420, -200, 40), "DoorGlass": (-420, -270, 40),
    "ControlBoard": (420, -130, -30), "PanelBody": (420, -240, -30), "Display": (420, -240, -30), "PanelPrint": (420, -240, -30),
}


def out_dir_from_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out")
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--samples", type=int, default=48)
    return ap.parse_known_args(argv)[0]


# ---------------------------------------------------------------- 材质 ----
def principled(name, color, metal=0.0, rough=0.5, alpha=1.0, emit=None, emit_s=1.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    b.inputs["Alpha"].default_value = alpha
    if coat and "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_s
    if alpha < 1:
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    return m


def textured(name, img, rough=0.5, metal=0.0, emit=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
    if emit:
        nt.links.new(t.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 1.0
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if hasattr(m, "blend_method"):
        m.blend_method = "BLEND"
    return m


def make_materials():
    c = {}
    c["shell"] = principled("外壳烤漆", (0.80, 0.81, 0.82), rough=0.42, coat=0.3)
    c["black_gloss"] = principled("钢琴黑", (0.016, 0.017, 0.02), rough=0.32, coat=0.2)
    c["black"] = principled("黑色塑料", (0.022, 0.023, 0.026), rough=0.55)
    c["gray"] = principled("灰色塑料", (0.20, 0.21, 0.22), rough=0.5)
    c["key"] = principled("按键", (0.075, 0.08, 0.09), rough=0.42)
    c["rubber"] = principled("橡胶", (0.03, 0.03, 0.03), rough=0.85)
    c["steel"] = principled("镀锌钢板", (0.66, 0.68, 0.70), metal=1.0, rough=0.42)
    c["enamel"] = principled("腔体涂层", (0.72, 0.71, 0.66), rough=0.38, coat=0.25)
    c["feed"] = principled("馈能室钢板", (0.10, 0.11, 0.13), metal=0.6, rough=0.55)
    c["ceramic"] = principled("耐热底板", (0.84, 0.82, 0.77), rough=0.25, coat=0.5)
    c["antenna"] = principled("镀铝钢板", (0.88, 0.89, 0.92), metal=1.0, rough=0.24)
    c["copper"] = principled("无氧铜", (0.89, 0.48, 0.28), metal=1.0, rough=0.3)
    c["alu"] = principled("铝散热片", (0.82, 0.83, 0.85), metal=1.0, rough=0.34)
    c["ferrite"] = principled("铁氧体", (0.045, 0.045, 0.05), rough=0.72)
    c["cer_white"] = principled("绝缘陶瓷", (0.86, 0.86, 0.84), rough=0.3)
    c["pcb"] = principled("电路板", (0.015, 0.14, 0.075), rough=0.4)
    c["cap"] = principled("电解电容", (0.03, 0.04, 0.12), rough=0.35)
    c["coil"] = principled("漆包线", (0.62, 0.28, 0.09), metal=1.0, rough=0.35)
    c["resin"] = principled("耐热树脂", (0.78, 0.72, 0.58), rough=0.5)
    c["wire_r"] = principled("线-红", (0.55, 0.03, 0.02), rough=0.5)
    c["wire_w"] = principled("线-白", (0.8, 0.8, 0.78), rough=0.5)
    c["wire_y"] = principled("线-黄", (0.8, 0.55, 0.03), rough=0.5)
    c["led"] = principled("LED灯", (0.95, 0.9, 0.75), rough=0.3, emit=(1, 0.92, 0.75), emit_s=1.2)
    c["sensor"] = principled("传感器", (0.1, 0.1, 0.14), rough=0.25)
    c["display"] = principled("显示屏", (0.02, 0.012, 0.004), rough=0.2, emit=(1.0, 0.45, 0.06), emit_s=0.05)
    c["glass"] = principled("门玻璃", (0.03, 0.035, 0.04), rough=0.06, alpha=0.34)
    c["bento"] = principled("便当盒", (0.02, 0.018, 0.016), rough=0.28)
    c["rice"] = principled("米饭", (0.86, 0.85, 0.80), rough=0.7)
    c["salmon"] = principled("烤鲑鱼", (0.82, 0.32, 0.16), rough=0.5)
    c["green"] = principled("西兰花", (0.08, 0.28, 0.05), rough=0.75)
    c["egg"] = principled("玉子烧", (0.88, 0.62, 0.12), rough=0.5)
    c["lid"] = principled("透明盖", (0.8, 0.85, 0.9), rough=0.08, alpha=0.18)
    return c


# ---------------------------------------------------------------- 零件 ----
PARTS = []
GROUP_NAMES = {
    "shell": "外壳",
    "cavity": "加热腔",
    "door": "门",
    "panel": "操作面板",
    "feed": "馈能系统",
    "power": "电源与散热",
    "sensor": "传感器",
    "food": "食物",
}


class Part:
    """一个零件 = 一个 Mesh 物体。几何先攒进 bmesh，最后一次写出。"""

    def __init__(self, name, group, label, desc="", origin=(0, 0, 0), explode=(0, 0, 0), cap=True):
        self.name, self.group, self.label, self.desc = name, group, label, desc
        self.origin, self.explode, self.cap = Vector(origin), explode, cap
        self.bm = bmesh.new()
        self.mats = []
        PARTS.append(self)

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _take(self, tmp, mat):
        for f in tmp.faces:
            f.material_index = self.mi(mat)
        me = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    # ---------- 基本体（全部是闭合流形，HTML 里的剖切封口依赖这一点） ----------
    def box(self, mat, x0, x1, y0, y1, z0, z1, bevel=0.0, seg=2):
        t = bmesh.new()
        r = bmesh.ops.create_cube(t, size=1.0)
        for v in r["verts"]:
            v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0), (z0 + z1) / 2 + v.co.z * (z1 - z0)))
        if bevel > 0:
            bmesh.ops.bevel(t, geom=list(t.edges) + list(t.verts), offset=bevel, offset_type="OFFSET",
                            segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
        self._take(t, mat)

    def cyl(self, mat, p0, p1, r, r2=None, seg=32, bevel=0.0):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        M = Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4()
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=True, cap_tris=False, segments=seg, radius1=r,
                              radius2=r if r2 is None else r2, depth=d.length, matrix=M)
        if bevel > 0:
            edges = [e for e in t.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.6]
            bmesh.ops.bevel(t, geom=edges, offset=bevel, offset_type="OFFSET", segments=2, profile=0.5,
                            affect="EDGES", clamp_overlap=True)
        self._take(t, mat)

    def lathe(self, mat, prof, center, axis="z", seg=48):
        """闭合截面 prof=[(r,h),...] 绕轴旋转。"""
        t = bmesh.new()
        n = len(prof)
        cx, cy, cz = center
        rings = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ca, sa = math.cos(a), math.sin(a)
            ring = []
            for r, h in prof:
                if axis == "z":
                    co = (cx + r * ca, cy + r * sa, cz + h)
                elif axis == "y":
                    co = (cx + r * ca, cy + h, cz + r * sa)
                else:
                    co = (cx + h, cy + r * ca, cz + r * sa)
                ring.append(t.verts.new(co))
            rings.append(ring)
        for i in range(seg):
            a, b = rings[i], rings[(i + 1) % seg]
            for j in range(n):
                k = (j + 1) % n
                t.faces.new((a[j], b[j], b[k], a[k]))
        bmesh.ops.recalc_face_normals(t, faces=list(t.faces))
        self._take(t, mat)

    def hexa(self, mat, c):
        """任意六面体：c = 底面四点 + 顶面四点（同一旋向）。"""
        t = bmesh.new()
        v = [t.verts.new(p) for p in c]
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            t.faces.new([v[i] for i in f])
        bmesh.ops.recalc_face_normals(t, faces=list(t.faces))
        self._take(t, mat)

    def prism(self, mat, outer, holes, z0, z1):
        """带孔的 2D 轮廓拉伸（天线板用）。"""
        vs, es, off = [], [], 0
        loops = [outer] + list(holes)
        for lp in loops:
            n = len(lp)
            vs += [Vector(p) for p in lp]
            es += [(off + i, off + (i + 1) % n) for i in range(n)]
            off += n
        # output_type=1: 只保留约束内部；孔再用奇偶规则剔除
        vo, _, fo, *_ = geometry.delaunay_2d_cdt(vs, es, [], 1, 1e-6)
        t = bmesh.new()

        def inside(pt, poly):
            x, y = pt
            c = False
            for i in range(len(poly)):
                x1, y1 = poly[i]
                x2, y2 = poly[(i + 1) % len(poly)]
                if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                    c = not c
            return c

        bot = [t.verts.new((p.x, p.y, z0)) for p in vo]
        top = [t.verts.new((p.x, p.y, z1)) for p in vo]
        keep = []
        for f in fo:
            cen = sum((vo[i] for i in f), Vector((0, 0))) / len(f)
            if any(inside((cen.x, cen.y), h) for h in holes):
                continue
            keep.append(f)
        edge_count = {}
        for f in keep:
            t.faces.new([top[i] for i in f])
            t.faces.new([bot[i] for i in reversed(f)])
            for i in range(len(f)):
                a, b = f[i], f[(i + 1) % len(f)]
                edge_count.setdefault((min(a, b), max(a, b)), []).append((a, b))
        for pairs in edge_count.values():
            if len(pairs) == 1:
                a, b = pairs[0]
                t.faces.new((top[b], top[a], bot[a], bot[b]))
        bmesh.ops.remove_doubles(t, verts=list(t.verts), dist=1e-6)
        bmesh.ops.recalc_face_normals(t, faces=list(t.faces))
        self._take(t, mat)

    def tube(self, mat, pts, r, seg=8, smooth=8):
        """走线：折线圆角后扫掠。"""
        pts = [Vector(p) for p in pts]
        path = [pts[0]]
        for i in range(1, len(pts) - 1):
            a, b, c = pts[i - 1], pts[i], pts[i + 1]
            ra = min(14, (b - a).length / 2)
            rc = min(14, (c - b).length / 2)
            p0 = b + (a - b).normalized() * ra
            p2 = b + (c - b).normalized() * rc
            for k in range(smooth + 1):
                s = k / smooth
                path.append((1 - s) ** 2 * p0 + 2 * s * (1 - s) * b + s * s * p2)
        path.append(pts[-1])
        t = bmesh.new()
        rings = []
        up = Vector((0.3, 0.2, 1)).normalized()
        for i, p in enumerate(path):
            d = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
            n = d.cross(up)
            if n.length < 1e-4:
                n = d.cross(Vector((1, 0, 0)))
            n.normalize()
            b = d.cross(n)
            rings.append([t.verts.new(p + (n * math.cos(2 * math.pi * k / seg) + b * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)])
        for a, b in zip(rings[:-1], rings[1:]):
            for k in range(seg):
                t.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
        t.faces.new(rings[0])
        t.faces.new(list(reversed(rings[-1])))
        bmesh.ops.recalc_face_normals(t, faces=list(t.faces))
        self._take(t, mat)

    def quad(self, mat, a, b, c, d, uvs=((0, 0), (1, 0), (1, 1), (0, 1))):
        idx = self.mi(mat)
        vs = [self.bm.verts.new(p) for p in (a, b, c, d)]
        f = self.bm.faces.new(vs)
        f.material_index = idx
        uv = self.bm.loops.layers.uv.verify()
        for l, st in zip(f.loops, uvs):
            l[uv].uv = st

    def finish(self, groups):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.transform(self.bm, matrix=Matrix.Scale(U, 4) @ Matrix.Translation(-self.origin), verts=self.bm.verts)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        me.shade_smooth()
        if hasattr(me, "set_sharp_from_angle"):
            me.set_sharp_from_angle(angle=math.radians(38))
        ob = bpy.data.objects.new(self.name, me)
        ob.location = self.origin * U
        ob.parent = groups[self.group]
        ob["label"] = self.label
        ob["desc"] = self.desc
        ob["group"] = self.group
        ob["explode"] = [e * U for e in EXPLODE.get(self.name, (0, 0, 0))]
        ob["cap"] = 1 if self.cap else 0
        bpy.context.scene.collection.children[GROUP_NAMES[self.group]].objects.link(ob)
        return ob


# ---------------------------------------------------------------- 贴图 ----
def tex_door_mesh(path):
    """门上的冲孔金属网：孔径远小于 12.2 cm 波长，微波过不去，可见光能过。"""
    n, pitch, r = 128, 32, 11
    if Image is None:
        return None
    im = Image.new("RGBA", (n, n), (26, 28, 32, 255))
    d = ImageDraw.Draw(im)
    for j in range(-1, 5):
        for i in range(-1, 5):
            cx = i * pitch + (pitch / 2 if j % 2 else 0) + pitch / 4
            cy = j * pitch + pitch / 4
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(10, 12, 14, 30))
    im.save(path)
    return path


def tex_panel(path):
    """操作面板丝印。"""
    if Image is None:
        return None
    W, H = 300, 640
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    font_path = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
    try:
        f1 = ImageFont.truetype(font_path, 22, index=0)
        f2 = ImageFont.truetype(font_path, 16, index=0)
    except OSError:
        f1 = f2 = ImageFont.load_default()
    col = (232, 234, 238, 255)
    for label, x, y in (("あたため", 80, 214), ("解凍", 220, 214), ("お弁当", 80, 286), ("のみもの", 220, 286)):
        d.text((x, y), label, font=f2, fill=col, anchor="mm")
    for label, x, y in (("とりけし", 74, 551), ("スタート", 226, 551)):
        d.text((x, y), label, font=f2, fill=col, anchor="mm")
    d.text((150, 338), "時間 / 出力", font=f2, fill=col, anchor="mm")
    d.text((150, 612), "ドアを開ける", font=f2, fill=(20, 22, 26, 255), anchor="mm")
    im.save(path)
    return path


# ---------------------------------------------------------------- 零件树 ----
def build_shell(M):
    p = P
    a = Part("OuterCover", "shell", "外壳罩", "一整块 U 形钢板折成顶和两侧，管防护和风道。挡微波的是里面的加热腔。",
             explode=(0, 0, 330))
    x0, x1, y0, y1, z1, t = p["X0"], p["X1"], p["Y0"], p["Y1"], p["Z1"], p["SHELL_T"]
    a.box(M["shell"], x0, x1, y0, y1, z1 - t, z1, bevel=0.8)
    a.box(M["shell"], x0, x0 + t, y0, y1, p["Z0"], z1, bevel=0.5)
    a.box(M["shell"], x1 - t, x1, y0, y1, p["Z0"], z1, bevel=0.5)
    # 右侧与顶部散热百叶
    for i in range(10):
        y = 40 + i * 13
        a.box(M["black"], x1 - 0.2, x1 + 0.2, y, y + 7, 150, 290)
    for i in range(14):
        y = 30 + i * 11
        a.box(M["black"], 120, 225, y, y + 6, z1 - 0.1, z1 + 0.2)

    fr = Part("FrontFrame", "shell", "前脸框", "挡住腔体四周的缝隙。腔体法兰就贴在它后面。", explode=(0, 0, 0))
    yf0, yf1 = y0, y0 + 2
    fr.box(M["shell"], x0 + t, p["DOOR_X1"] + 2, yf0, yf1, p["Z0"] + 2, p["FLOOR_Z"] - 24)
    fr.box(M["shell"], x0 + t, p["DOOR_X1"] + 2, yf0, yf1, p["FLOOR_Z"] + p["GLASS_T"] + p["CH"] + 24, z1 - t)
    fr.box(M["shell"], x0 + t, p["CX"] - p["CW"] / 2 - 23.2, yf0, yf1, p["FLOOR_Z"] - 24, p["FLOOR_Z"] + p["GLASS_T"] + p["CH"] + 24)
    fr.box(M["shell"], p["CX"] + p["CW"] / 2 + 23.2, p["DOOR_X1"] + 2, yf0, yf1, p["FLOOR_Z"] - 24, p["FLOOR_Z"] + p["GLASS_T"] + p["CH"] + 24)

    b = Part("BasePlate", "shell", "底板", "承托所有部件，电机、波导都吊装在这一层上方。", explode=(0, 0, -300))
    b.box(M["steel"], x0, x1, y0, y1, p["Z0"], p["Z0"] + 2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * 205, 8 + sy * 165
            b.cyl(M["rubber"], (cx, cy, 0), (cx, cy, p["Z0"]), 19, r2=21, seg=28, bevel=1.5)

    c = Part("BackPanel", "shell", "后板", "后面留出排风缝和电源线。", explode=(0, 300, 0))
    c.box(M["steel"], x0 + 2, x1 - 2, y1 - 1.5, y1, p["Z0"] + 2, z1 - 1.5)
    for r_ in range(5):
        for i in range(10):
            z = 150 + r_ * 20
            x = 60 + i * 16
            c.box(M["black"], x, x + 11, y1 - 0.2, y1 + 0.2, z, z + 7)
    c.tube(M["black"], [(200, y1, 60), (200, y1 + 34, 60), (140, y1 + 60, 32), (40, y1 + 58, 16.5)], 3.5, seg=10)


def build_cavity(M):
    p = P
    x0, x1 = p["CX"] - p["CW"] / 2, p["CX"] + p["CW"] / 2
    y0, y1 = p["CY"] - p["CD"] / 2, p["CY"] + p["CD"] / 2
    zf, zt = p["FLOOR_Z"], p["FLOOR_Z"] + p["GLASS_T"] + p["CH"]
    t = 1.2
    c = Part("CavityBox", "cavity", "加热腔",
             "六面都是金属的盒子。微波打到壁上被反射回来，来回叠加形成驻波，这就是热点的根源。",
             explode=(0, 0, 0))
    M_ = M["enamel"]
    c.box(M_, x0 - t, x1 + t, y0, y1 + t, zt, zt + t)                # 顶
    c.box(M_, x0 - t, x0, y0, y1 + t, zf, zt)                        # 左
    c.box(M_, x1, x1 + t, y0, y1 + t, zf, zt)                        # 右
    c.box(M_, x0, x1, y1, y1 + t, zf, zt)                            # 后
    # 地板：中间开方孔，下面接馈能室
    ht = p["FEED_TOP"] / 2
    cx, cy = p["CX"], p["CY"]
    c.box(M_, x0 - t, cx - ht, y0, y1 + t, zf - t, zf)
    c.box(M_, cx + ht, x1 + t, y0, y1 + t, zf - t, zf)
    c.box(M_, cx - ht, cx + ht, y0, cy - ht, zf - t, zf)
    c.box(M_, cx - ht, cx + ht, cy + ht, y1 + t, zf - t, zf)
    # 前法兰
    fl = 22
    for a in ((x0 - t - fl, x0 - t, y0 - 2, y0, zf - 24, zt + 24), (x1 + t, x1 + t + fl, y0 - 2, y0, zf - 24, zt + 24),
              (x0 - t, x1 + t, y0 - 2, y0, zt + t, zt + 24), (x0 - t, x1 + t, y0 - 2, y0, zf - 24, zf - t)):
        c.box(M["steel"], *a)
    # 右壁冲孔（通风和照明，孔同样远小于波长）
    for j in range(9):
        for i in range(7):
            z = zf + 80 + j * 11
            y = y0 + 60 + i * 11 + (5 if j % 2 else 0)
            c.cyl(M["black"], (x1 - 0.2, y, z), (x1 + 0.1, y, z), 3.0, seg=8)

    lamp = Part("CavityLamp", "cavity", "腔内 LED 灯", "从冲孔背后照亮腔体。", explode=(170, 0, 40))
    lamp.box(M["gray"], x1 + 2, x1 + 26, y0 + 70, y0 + 120, zf + 110, zf + 160, bevel=2)
    lamp.box(M["led"], x1 + 1.2, x1 + 3, y0 + 75, y0 + 115, zf + 115, zf + 155, bevel=0.5)


def build_floor(M):
    p = P
    x0, x1 = p["CX"] - p["CW"] / 2, p["CX"] + p["CW"] / 2
    y0, y1 = p["CY"] - p["CD"] / 2, p["CY"] + p["CD"] / 2
    f = Part("GlassFloor", "cavity", "平板底板",
             "耐热玻璃或陶瓷，平整好擦。对微波近乎透明，所以能盖住下面的天线而不挡波。没有转盘，方形便当也不会卡住。",
             explode=(0, 0, 140))
    f.box(M["ceramic"], x0 + 0.5, x1 - 0.5, y0 + 0.5, y1 - 0.5, p["FLOOR_Z"], p["FLOOR_Z"] + p["GLASS_T"], bevel=1.2)


def antenna_outline():
    """JP6861397B2 实施例 1：80°+80° 的 R60 圆弧、100° 的 R45 圆弧、100° 的矩形突出。"""
    p = P
    r1, r2, tip, w = p["ANT_R1"], p["ANT_R2"], p["ANT_TIP"], p["ANT_TIP_W"] / 2
    pts = []

    def arc(r, a0, a1, n):
        for i in range(n + 1):
            a = math.radians(a0 + (a1 - a0) * i / n)
            pts.append((r * math.cos(a), r * math.sin(a)))

    pts += [(tip, -w), (tip, w)]
    pts.append((w / math.tan(math.radians(50)), w))  # 内折角
    arc(r1, 50, 130, 22)
    pts.append((r2 * math.cos(math.radians(130)), r2 * math.sin(math.radians(130))))
    arc(r2, 130, 230, 22)
    arc(r1, 230, 310, 22)
    pts.append((w / math.tan(math.radians(50)), -w))
    # 去重
    out = []
    for q in pts:
        if not out or (Vector(q) - Vector(out[-1])).length > 0.05:
            out.append(q)
    return out


def slot_rect(cx, cy, length, width, ang):
    c, s = math.cos(ang), math.sin(ang)
    return [(cx + c * a - s * b, cy + s * a + c * b)
            for a, b in ((-length / 2, -width / 2), (length / 2, -width / 2), (length / 2, width / 2), (-length / 2, width / 2))]


def cross_outline(cx, cy, length, width, ang):
    """十字槽外轮廓（12 个顶点）。"""
    l_, w_ = length / 2, width / 2
    raw = [(-l_, -w_), (-w_, -w_), (-w_, -l_), (w_, -l_), (w_, -w_), (l_, -w_),
           (l_, w_), (w_, w_), (w_, l_), (-w_, l_), (-w_, w_), (-l_, w_)]
    c, s = math.cos(ang), math.sin(ang)
    return [(cx + c * a - s * b, cy + s * a + c * b) for a, b in raw]


ANT_SLOTS = [  # 相对天线中心的槽口位置，供仿真共用
    ("cross", 0.0, 33.0),
    ("cross", 0.0, -33.0),
    ("line", -24.0, 0.0),
]


def build_feed(M):
    p = P
    cx, cy = p["CX"], p["CY"]
    ytop, ybot = p["FEED_TOP"] / 2, p["FEED_BOT"] / 2
    zb, zt = p["FEED_Z"], p["FLOOR_Z"] - 1.2
    t = 1.5

    # ---- 馈能室 ----
    f = Part("FeedChamber", "feed", "馈能室",
             "地板下方的金属凹槽，只朝上开口。天线在这里转，波只能朝上穿过底板进入加热腔。",
             explode=(0, 0, -85))
    c = (cx, cy)

    def wall(a0, b0, a1, b1):
        # a0,b0: 底部两点；a1,b1: 顶部两点；沿外法线加厚
        out = Vector((a0[0] + b0[0] - 2 * c[0], a0[1] + b0[1] - 2 * c[1], 0)).normalized() * t
        v = [Vector((*a0, zb)), Vector((*b0, zb)), Vector((*b0, zb)) + out, Vector((*a0, zb)) + out,
             Vector((*a1, zt)), Vector((*b1, zt)), Vector((*b1, zt)) + out, Vector((*a1, zt)) + out]
        f.hexa(M["feed"], v)

    B = [(cx - ybot, cy - ybot), (cx + ybot, cy - ybot), (cx + ybot, cy + ybot), (cx - ybot, cy + ybot)]
    T = [(cx - ytop, cy - ytop), (cx + ytop, cy - ytop), (cx + ytop, cy + ytop), (cx - ytop, cy + ytop)]
    for i in range(4):
        wall(B[i], B[(i + 1) % 4], T[i], T[(i + 1) % 4])
    # 底：中央留出给天线轴穿过的开孔（做成四块拼板）
    hole = 26
    f.box(M["feed"], cx - ybot, cx - hole, cy - ybot, cy + ybot, zb + 0.05, zb + t)
    f.box(M["feed"], cx + hole, cx + ybot, cy - ybot, cy + ybot, zb + 0.05, zb + t)
    f.box(M["feed"], cx - hole, cx + hole, cy - ybot, cy - hole, zb + 0.05, zb + t)
    f.box(M["feed"], cx - hole, cx + hole, cy + hole, cy + ybot, zb + 0.05, zb + t)

    # ---- 波导 ----
    g = Part("Waveguide", "feed", "波导",
             "矩形金属管，相当于微波的水管。磁控管从右端把微波送进来，沿地板下方走到中央的天线轴。",
             explode=(0, 0, -150))
    x0, x1, y0, y1 = p["WG_X0"], p["WG_X1"], cy - p["WG_W"] / 2, cy + p["WG_W"] / 2
    top, h1, h2, w = p["WG_TOP"], p["WG_H1"], p["WG_H2"], p["WG_T"]
    xs1, xs2 = -8, 28  # 台阶过渡段：电机一侧压低，给电机让高度
    g.box(M["steel"], x0, x1, y0, y1, top - w, top)  # 顶壁
    g.box(M["steel"], x0 - w, x0, y0 - w, y1 + w, top - h2 - w, top)
    g.box(M["steel"], x1, x1 + w, y0 - w, y1 + w, top - h1 - w, top)

    def bottom(xa, xb, za, zb_):
        g.hexa(M["steel"], [Vector((xa, y0, za - w)), Vector((xb, y0, zb_ - w)), Vector((xb, y1, zb_ - w)), Vector((xa, y1, za - w)),
                            Vector((xa, y0, za)), Vector((xb, y0, zb_)), Vector((xb, y1, zb_)), Vector((xa, y1, za))])

    def side(y_a, y_b):
        for (xa, xb, za, zb_) in ((x0, xs1, top - h2, top - h2), (xs1, xs2, top - h2, top - h1), (xs2, x1, top - h1, top - h1)):
            g.hexa(M["steel"], [Vector((xa, y_a, za - w)), Vector((xb, y_a, zb_ - w)), Vector((xb, y_b, zb_ - w)), Vector((xa, y_b, za - w)),
                                Vector((xa, y_a, top)), Vector((xb, y_a, top)), Vector((xb, y_b, top)), Vector((xa, y_b, top))])

    # 底壁分三段；中段上开孔处由树脂轴穿过（孔太小，略去）
    bottom(x0, xs1, top - h2, top - h2)
    bottom(xs1, xs2, top - h2, top - h1)
    bottom(xs2, x1, top - h1, top - h1)
    side(y0 - w, y0)
    side(y1, y1 + w)

    # ---- 天线轴 ----
    s = Part("AntennaShaft", "feed", "天线金属轴",
             "把波导里的微波耦合到天线板上，它既传动也传波。", origin=(cx, cy, 0), explode=(0, 0, 60))
    s.cyl(M["antenna"], (cx, cy, 66), (cx, cy, p["ANT_Z"]), 7, seg=24)
    s.cyl(M["antenna"], (cx, cy, p["ANT_Z"] - 3), (cx, cy, p["ANT_Z"] + 3), 12, seg=24)
    s.cyl(M["antenna"], (cx, cy, 74), (cx, cy, 80), 15, seg=24, bevel=0.6)

    # ---- 平板天线 ----
    a = Part("AntennaPlate", "feed", "回转天线",
             "全机主角：0.5 mm 镀铝钢板，轮廓故意不对称，还开了十字槽。微波从边缘向四周、从槽口向上辐射，一转起来，激发出来的腔内驻波图样就跟着变。",
             origin=(cx, cy, 0), explode=(0, 0, 110))
    holes = []
    for kind, x, y in ANT_SLOTS:
        if kind == "cross":
            holes.append([(cx + q[0], cy + q[1]) for q in cross_outline(x, y, p["SLOT_L"], p["SLOT_W"], math.radians(45))])
        else:
            holes.append([(cx + q[0], cy + q[1]) for q in slot_rect(x, y, p["SLOT_W"], p["SLOT_L3"] * 0.8, 0)])
    outer = [(cx + q[0], cy + q[1]) for q in antenna_outline()]
    a.prism(M["antenna"], outer, holes, p["ANT_Z"], p["ANT_Z"] + p["ANT_T"])

    # ---- 支撑环 ----
    h = Part("AntennaBearing", "feed", "天线支撑座",
             "树脂托架，让板子保持水平转动，不碰到上面的底板。", explode=(0, 0, 30))
    h.lathe(M["resin"], [(10, 0), (20, 0), (20, 2.5), (10, 2.5)], (cx, cy, zb + 1.6), seg=32)
    for i in range(3):
        an = i * 2 * math.pi / 3 + 0.5
        hx, hy = cx + 16 * math.cos(an), cy + 16 * math.sin(an)
        h.cyl(M["resin"], (hx, hy, zb), (hx, hy, p["ANT_Z"] - 0.2), 2.6, seg=12)

    # ---- 树脂轴 + 电机 ----
    r = Part("ResinShaft", "feed", "树脂传动轴",
             "绝缘材料，把动力传上去，但不会把微波漏到波导外面。", origin=(cx, cy, 0), explode=(0, 0, -215))
    r.cyl(M["resin"], (cx, cy, 44), (cx, cy, 66), 5, seg=20)

    m = Part("AntennaMotor", "feed", "天线电机",
             "低转速小电机，装在波导下方。电机一停，天线就不转，热点也就固定了。",
             explode=(0, 0, -265))
    m.cyl(M["steel"], (cx, cy, 20), (cx, cy, 36), 26, seg=36, bevel=0.8)
    m.cyl(M["alu"], (cx, cy, 36), (cx, cy, 45), 22, seg=36, bevel=0.6)
    m.box(M["steel"], cx - 34, cx + 34, cy - 7, cy + 7, 34, 36)
    m.box(M["resin"], cx + 22, cx + 34, cy - 13, cy + 13, 22, 32, bevel=1)

    # ---- 磁控管 ----
    mx, my = p["MAG_X"], cy
    z = top
    k = Part("Magnetron", "feed", "磁控管",
             "把高压直流电变成 2.45 GHz 微波的真空管。阴极电子在磁场里打转，经过谐振腔时把能量交给电磁波，再从下端的小天线送进波导。",
             explode=(150, 0, 150))
    k.box(M["steel"], mx - 50, mx + 50, my - 45, my + 45, z, z + 3, bevel=0.5)              # 法兰
    k.lathe(M["ferrite"], [(14, 0), (30, 0), (30, 11), (14, 11)], (mx, my, z + 4), seg=40)  # 下磁铁
    for i in range(9):
        zz = z + 17 + i * 5.2
        k.box(M["alu"], mx - 48, mx + 48, my - 44, my + 44, zz, zz + 0.9)
    k.cyl(M["copper"], (mx, my, z + 15), (mx, my, z + 64), 25, seg=40)                      # 阳极铜筒
    k.lathe(M["ferrite"], [(14, 0), (30, 0), (30, 11), (14, 11)], (mx, my, z + 65), seg=40)  # 上磁铁
    k.box(M["steel"], mx - 52, mx + 52, my - 47, my - 44, z, z + 80, bevel=0.5)              # 轭铁
    k.box(M["steel"], mx - 52, mx + 52, my + 44, my + 47, z, z + 80, bevel=0.5)
    k.box(M["steel"], mx - 52, mx + 52, my - 47, my + 47, z + 78, z + 81, bevel=0.5)
    k.box(M["steel"], mx - 37, mx + 37, my - 37, my + 37, z + 81, z + 118, bevel=1)          # 滤波盒
    k.cyl(M["cer_white"], (mx - 12, my, z + 118), (mx - 12, my, z + 128), 7, seg=20)
    k.cyl(M["cer_white"], (mx + 12, my, z + 118), (mx + 12, my, z + 128), 7, seg=20)
    k.box(M["steel"], mx - 15, mx - 9, my - 1, my + 1, z + 128, z + 138)
    k.box(M["steel"], mx + 9, mx + 15, my - 1, my + 1, z + 128, z + 138)
    # 输出端：向下伸进波导
    k.cyl(M["steel"], (mx, my, z - 2), (mx, my, z - 12), 15, r2=13, seg=28)
    k.cyl(M["cer_white"], (mx, my, z - 12), (mx, my, z - 22), 11, seg=28)
    k.cyl(M["steel"], (mx, my, z - 22), (mx, my, z - 32), 9, r2=6, seg=28)


def build_power(M):
    p = P
    cy = p["CY"]
    z = p["WG_TOP"]
    mx = p["MAG_X"]

    # 风扇
    fx, fy, fz = mx, 110, z + 58
    d = Part("FanShroud", "power", "风道罩", "把风集中吹过磁控管散热片，再引向腔体冲孔和后板。", explode=(90, 150, 40))
    t_ = 58
    d.box(M["black"], fx - t_ - 5, fx - t_, 72, 98, fz - t_ - 5, fz + t_ + 5)
    d.box(M["black"], fx + t_, fx + t_ + 5, 72, 98, fz - t_ - 5, fz + t_ + 5)
    d.box(M["black"], fx - t_, fx + t_, 72, 98, fz + t_, fz + t_ + 5)
    d.box(M["black"], fx - t_, fx + t_, 72, 98, fz - t_ - 5, fz - t_)
    for ang in (45, 135):
        c, s_ = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        d.cyl(M["black"], (fx - c * 66, 95, fz - s_ * 66), (fx + c * 66, 95, fz + s_ * 66), 2.2, seg=8)
    d.cyl(M["black"], (fx, 96, fz), (fx, 112, fz), 21, seg=28)

    b = Part("FanBlade", "power", "冷却风扇", "磁控管效率约七成（经验值，随机型变化），剩下的变成废热，必须吹走。",
             origin=(fx, 86, fz), explode=(90, 110, 40))
    b.cyl(M["gray"], (fx, 78, fz), (fx, 95, fz), 15, seg=24, bevel=1)
    for i in range(5):
        a = 2 * math.pi * i / 5
        c0, s0 = math.cos(a), math.sin(a)
        rin, rout, tw = 13, 52, 0.52

        def pt(r, ao, y):
            ca, sa = math.cos(a + ao), math.sin(a + ao)
            return Vector((fx + r * ca, y, fz + r * sa))

        th = 1.2
        b.hexa(M["gray"], [pt(rin, -0.28, 84), pt(rout, -tw, 80), pt(rout, tw, 92), pt(rin, 0.28, 90),
                           pt(rin, -0.28, 84 + th), pt(rout, -tw, 80 + th), pt(rout, tw, 92 + th), pt(rin, 0.28, 90 + th)])

    m = Part("FanMotor", "power", "风扇电机", "罩极电机或直流风扇，开机就转。", explode=(90, 190, 40))
    m.cyl(M["steel"], (fx, 112, fz), (fx, 132, fz), 22, seg=28, bevel=0.8)
    m.box(M["coil"], fx - 26, fx - 20, 114, 130, fz - 14, fz + 14)

    # 变频电源板
    x0, x1, y0, y1, zb = 104, 243, -168, 62, 240
    q = Part("InverterBoard", "power", "变频电源板",
             "把 100 V 市电整流、逆变再升到约 4 kV 给磁控管。比起老式工频变压器又轻又小，还能连续调功率，不用靠开关循环。",
             explode=(200, -30, 200))
    q.box(M["pcb"], x0, x1, y0, y1, zb, zb + 1.6)
    # 散热器
    q.box(M["alu"], 112, 168, -150, -60, zb + 1.6, zb + 6)
    for i in range(11):
        xx = 113 + i * 5.2
        q.box(M["alu"], xx, xx + 1.4, -150, -60, zb + 6, zb + 34)
    # 铁氧体高频变压器
    q.box(M["ferrite"], 186, 232, -130, -82, zb + 1.6, zb + 40, bevel=1.5)
    q.box(M["coil"], 180, 238, -118, -94, zb + 6, zb + 34, bevel=3)
    # 电解电容
    for i, (xx, yy) in enumerate(((122, -36), (150, -36), (122, -6), (150, -6))):
        q.cyl(M["cap"], (xx, yy, zb + 1.6), (xx, yy, zb + 40), 11, seg=22, bevel=0.7)
        q.cyl(M["alu"], (xx, yy, zb + 40), (xx, yy, zb + 41), 9.5, seg=22)
    # 高压薄膜电容
    q.box(M["wire_y"], 186, 234, -60, -34, zb + 1.6, zb + 28, bevel=2)
    q.box(M["wire_y"], 186, 234, -26, 0, zb + 1.6, zb + 28, bevel=2)
    # 共模电感 + 继电器
    q.lathe(M["coil"], [(8, -7), (17, -7), (17, 7), (8, 7)], (130, 30, zb + 12), seg=22)
    q.box(M["black"], 170, 200, 18, 44, zb + 1.6, zb + 24, bevel=1)
    q.box(M["wire_w"], 214, 238, 16, 46, zb + 1.6, zb + 12, bevel=1)
    # 支柱
    for xx, yy in ((108, -164), (239, -164), (108, 58), (239, 58)):
        q.cyl(M["black"], (xx, yy, 215), (xx, yy, zb), 3.2, seg=10)

    w = Part("Wiring", "power", "高压线束", "红线是高压，黄白线是灯丝和控制信号。", explode=(120, -10, 120))
    w.tube(M["wire_r"], [(mx - 12, cy, z + 137), (mx - 12, cy - 30, z + 150), (140, -92, 232), (150, -100, 243)], 2.4)
    w.tube(M["wire_w"], [(mx + 12, cy, z + 137), (mx + 12, cy - 24, z + 148), (205, -70, 232), (210, -100, 243)], 2.0)
    w.tube(M["wire_y"], [(205, -160, 243), (235, -165, 210), (235, -160, 90), (238, 40, 34), (100, 60, 32), (-40, 40, 38), (cx_(), 2, 30)], 1.6)
    w.tube(M["wire_w"], [(225, -160, 243), (240, -163, 205), (242, -158, 82), (241, 50, 28), (100, 66, 26), (-30, 46, 28), (-44, 6, 28)], 1.6)


def cx_():
    return P["CX"] + 32


def build_door(M):
    p = P
    hx, hy = p["DOOR_X0"] + 2, p["Y0"]
    x0, x1, yb, yf = p["DOOR_X0"], p["DOOR_X1"], p["Y0"], p["Y0"] - p["DOOR_T"]
    z0, z1 = p["Z0"] + 4, p["Z1"] - 2
    o = (hx, hy, 0)
    W = 34  # 边框宽
    ex = (0, -170, 0)

    a = Part("DoorFrame", "door", "门框", "门的骨架。左侧铰链，右侧两个门钩插进机身触发联锁开关。", origin=o, explode=ex)
    a.box(M["black_gloss"], x0, x1, yf, yf + 16, z0, z0 + W, bevel=2)
    a.box(M["black_gloss"], x0, x1, yf, yf + 16, z1 - W, z1, bevel=2)
    a.box(M["black_gloss"], x0, x0 + W, yf, yf + 16, z0 + W + 0.1, z1 - W - 0.1, bevel=1)
    a.box(M["black_gloss"], x1 - W, x1, yf, yf + 16, z0 + W + 0.1, z1 - W - 0.1, bevel=1)
    # 把手
    hz0, hz1 = z0 + 50, z1 - 50
    a.box(M["steel"], x1 - 26, x1 - 12, yf - 22, yf - 12, hz0, hz1, bevel=3)
    a.box(M["steel"], x1 - 25, x1 - 13, yf - 14, yf + 1, hz0 + 6, hz0 + 22, bevel=2)
    a.box(M["steel"], x1 - 25, x1 - 13, yf - 14, yf + 1, hz1 - 22, hz1 - 6, bevel=2)
    # 门钩
    for zc in (z0 + 62, z1 - 62):
        a.box(M["gray"], x1 - 8, x1 + 20, yb - 3, yb + 8, zc - 8, zc + 8, bevel=1)

    g = Part("DoorGlass", "door", "门玻璃", "外层只是装饰和隔热，挡微波的是后面那层金属网。", origin=o, explode=(0, -240, 0), cap=False)
    g.box(M["glass"], x0 + W - 2, x1 - W + 2, yf + 2, yf + 5, z0 + W - 2, z1 - W + 2)

    s = Part("DoorMesh", "door", "门上金属网",
             "孔径约 2 mm，比 122 mm 的波长小得多：微波过不去，可见光能过，所以能看里面又不漏波。",
             origin=o, explode=(0, -125, 0), cap=False)
    wx, wz = (x1 - W) - (x0 + W), (z1 - W) - (z0 + W)
    rep = 9.0
    v = rep * wz / wx
    s.quad(M["mesh"], (x0 + W, yf + 10, z0 + W), (x1 - W, yf + 10, z0 + W), (x1 - W, yf + 10, z1 - W), (x0 + W, yf + 10, z1 - W),
           ((0, 0), (rep, 0), (rep, v), (0, v)))

    c = Part("DoorChoke", "door", "扼流槽",
             "门缝处的四分之一波长沟槽（λ/4 ≈ 30 mm）。缝里的波走一个来回相位翻转，把自己抵消掉，所以门不用压得很紧也不漏波。",
             origin=o, explode=(0, -55, 0))
    t0, t1 = yf + 16, yb - 0.6
    i_ = 30
    xa, xb = x0 + 16, x1 - 16
    za, zb = z0 + 8, z1 - 8
    c.box(M["steel"], xa, xb, t0, t1, za, za + i_)
    c.box(M["steel"], xa, xb, t0, t1, zb - i_, zb)
    c.box(M["steel"], xa, xa + i_, t0, t1, za + i_ + 0.1, zb - i_ - 0.1)
    c.box(M["steel"], xb - i_, xb, t0, t1, za + i_ + 0.1, zb - i_ - 0.1)


def build_panel(M):
    p = P
    x0, x1 = p["DOOR_X1"] + 2, p["X1"]
    yf = p["Y0"] - p["DOOR_T"]
    yb = p["Y0"]
    z0, z1 = p["Z0"] + 4, p["Z1"] - 2
    e = (0, -240, 0)
    a = Part("PanelBody", "panel", "操作面板", "右侧竖条，后面就是电源板和磁控管所在的机械室。", explode=e)
    a.box(M["black_gloss"], x0, x1, yf, yb, z0, z1, bevel=2.5)
    # 按键
    cx = (x0 + x1) / 2
    rows = [(z1 - 110, x0 + 42), (z1 - 110, x1 - 42), (z1 - 146, x0 + 42), (z1 - 146, x1 - 42),
            (z0 + 48, x0 + 42), (z0 + 48, x1 - 42)]
    for zc, xc in rows:
        a.box(M["key"], xc - 34, xc + 34, yf - 2.4, yf + 1, zc - 13, zc + 13, bevel=1.4)
    dz = z0 + 104
    a.cyl(M["steel"], (cx, yf - 15, dz), (cx, yf + 1, dz), 34, r2=36, seg=48, bevel=1.5)
    a.cyl(M["black"], (cx, yf - 15.5, dz), (cx, yf - 14.9, dz), 30, seg=48)
    a.cyl(M["alu"], (cx + 19, yf - 16, dz + 14), (cx + 19, yf - 15, dz + 14), 2.4, seg=10)
    # 开门键
    a.box(M["steel"], x0 + 16, x1 - 16, yf - 3, yf + 1, z0 + 6, z0 + 26, bevel=2)

    d = Part("Display", "panel", "显示屏", "倒计时和功率。", explode=e, cap=False)
    dx0, dx1, dz0, dz1 = x0 + 14, x1 - 14, z1 - 72, z1 - 18
    d.quad(M["display"], (dx0, yf - 0.4, dz0), (dx1, yf - 0.4, dz0), (dx1, yf - 0.4, dz1), (dx0, yf - 0.4, dz1))

    if "panel_print" in M:
        s = Part("PanelPrint", "panel", "面板丝印", "按键文字。", explode=e, cap=False)
        s.quad(M["panel_print"], (x0, yf - 2.8, z0), (x1, yf - 2.8, z0), (x1, yf - 2.8, z1), (x0, yf - 2.8, z1))

    c = Part("ControlBoard", "panel", "控制板",
             "单片机所在。读按键和传感器，决定功率、时长，也负责让天线电机、风扇一起转。",
             explode=(0, -120, 0))
    c.box(M["pcb"], x0 + 8, x1 - 8, yb + 2, yb + 3.6, z0 + 14, z1 - 14)
    c.box(M["black"], x0 + 34, x0 + 62, yb - 0.5 + 4, yb + 7, z1 - 120, z1 - 92)
    for i in range(6):
        c.box(M["black"], x0 + 22 + i * 18, x0 + 34 + i * 18, yb + 3.6, yb + 7, z0 + 30, z0 + 42)


def build_sensors(M):
    p = P
    x0, x1 = p["CX"] - p["CW"] / 2, p["CX"] + p["CW"] / 2
    y0, y1 = p["CY"] - p["CD"] / 2, p["CY"] + p["CD"] / 2
    zt = p["FLOOR_Z"] + p["GLASS_T"] + p["CH"]
    a = Part("IRSensor", "sensor", "红外传感器",
             "隔着腔顶小孔看食物表面温度。机型不同，也可能换成湿度或多点扫描传感器。",
             explode=(0, 0, 200))
    a.box(M["sensor"], x1 - 62, x1 - 28, y0 + 40, y0 + 74, zt + 1.2, zt + 13, bevel=1.5)
    a.cyl(M["alu"], (x1 - 45, y0 + 57, zt + 12), (x1 - 45, y0 + 57, zt + 15), 7, seg=16)
    w = Part("WeightSensors", "sensor", "重量传感器",
             "部分机型在底面放的称重点。自动模式用重量推算时长，容器太重时可能加热过头。",
             explode=(0, 0, 75))
    for sx in (-1, 1):
        for sy in (-1, 1):
            xx, yy = p["CX"] + sx * 136, p["CY"] + sy * 146
            w.cyl(M["sensor"], (xx, yy, p["FLOOR_Z"] - 16), (xx, yy, p["FLOOR_Z"] - 1.2), 7, seg=16)
            w.box(M["alu"], xx - 9, xx + 9, yy - 9, yy + 9, p["FLOOR_Z"] - 18, p["FLOOR_Z"] - 16)


def build_food(M):
    p = P
    cx, cy, z = p["CX"], p["CY"], p["FLOOR_Z"] + p["GLASS_T"]
    W, D, H = 200, 140, 44
    a = Part("Bento", "food", "便当",
             "长方形便当是平板式的主场：不用转，也不怕卡住，放哪里都行。", explode=(0, 0, 260))
    x0, x1, y0, y1 = cx - W / 2, cx + W / 2, cy - D / 2, cy + D / 2
    a.box(M["bento"], x0, x1, y0, y1, z, z + 3, bevel=1.0)
    a.box(M["bento"], x0, x0 + 3, y0, y1, z, z + H, bevel=0.8)
    a.box(M["bento"], x1 - 3, x1, y0, y1, z, z + H, bevel=0.8)
    a.box(M["bento"], x0, x1, y0, y0 + 3, z, z + H, bevel=0.8)
    a.box(M["bento"], x0, x1, y1 - 3, y1, z, z + H, bevel=0.8)
    a.box(M["bento"], cx + 2, cx + 5, y0, y1, z, z + H - 10)
    a.box(M["rice"], x0 + 3, cx + 2, y0 + 3, y1 - 3, z + 3, z + 32, bevel=4, seg=3)
    a.box(M["salmon"], cx + 12, cx + 86, y0 + 12, y0 + 62, z + 3, z + 28, bevel=6, seg=3)
    for i in range(3):
        a.box(M["egg"], cx + 14 + i * 25, cx + 36 + i * 25, y1 - 56, y1 - 14, z + 3, z + 26, bevel=3, seg=2)
    for (xx, yy, r) in ((-60, -20, 11), (-44, 18, 13)):
        a.lathe(M["green"], [(0.1, 0), (r, 0), (r * 1.0, r * 0.7), (r * 0.5, r * 1.1), (0.1, r * 1.2)],
                (cx + xx, cy + yy, z + 30), seg=14)


# ---------------------------------------------------------------- 组装 ----
def prepare_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    for g, label in GROUP_NAMES.items():
        col = bpy.data.collections.new(label)
        sc.collection.children.link(col)
    return sc


def load_image(path):
    if not path:
        return None
    im = bpy.data.images.load(path)
    im.pack()
    return im


def build_all(out):
    sc = prepare_scene()
    M = make_materials()
    pm = tex_door_mesh(os.path.join(out, "tex_door_mesh.png"))
    if pm:
        M["mesh"] = textured("冲孔金属网", load_image(pm), rough=0.4, metal=0.8)
    else:
        M["mesh"] = principled("冲孔金属网", (0.05, 0.055, 0.06), metal=0.8, rough=0.4, alpha=0.6)
    pp = tex_panel(os.path.join(out, "tex_panel.png"))
    if pp:
        M["panel_print"] = textured("面板丝印", load_image(pp), rough=0.6)

    root = bpy.data.objects.new("Microwave", None)
    sc.collection.objects.link(root)
    groups = {}
    for g in GROUP_NAMES:
        e = bpy.data.objects.new("G_" + g, None)
        e.parent = root
        e["label"] = GROUP_NAMES[g]
        sc.collection.objects.link(e)
        groups[g] = e

    build_shell(M)
    build_cavity(M)
    build_floor(M)
    build_feed(M)
    build_power(M)
    build_door(M)
    build_panel(M)
    build_sensors(M)
    build_food(M)
    return sc, [p.finish(groups) for p in PARTS], root


def setup_render(sc, samples):
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1400, 900
    sc.render.image_settings.file_format = "PNG"
    sc.render.film_transparent = False
    w = bpy.data.worlds.new("studio")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.74, 0.76, 0.79, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.55
    sc.world = w
    # 主光 + 辅光
    for name, loc, en, size in (("key", (-0.7, -1.2, 1.4), 34, 1.2), ("fill", (1.3, -0.5, 0.6), 10, 1.5), ("rim", (0.2, 1.3, 1.1), 16, 1.0)):
        l = bpy.data.lights.new(name, "AREA")
        l.energy, l.size = en, size
        o = bpy.data.objects.new(name, l)
        o.location = loc
        d = Vector((0, 0, 0.15)) - Vector(loc)
        o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.collection.objects.link(o)
    cam = bpy.data.cameras.new("cam")
    cam.lens = 55
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    gnd = bpy.data.meshes.new("ground")
    s = 6
    gnd.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    gm = bpy.data.objects.new("_ground", gnd)
    gmat = principled("地面", (0.62, 0.64, 0.67), rough=0.6)
    gnd.materials.append(gmat)
    sc.collection.objects.link(gm)
    return co


def aim(co, loc, tgt=(0, 0, 0.17)):
    co.location = loc
    d = Vector(tgt) - Vector(loc)
    co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def set_visible(obs, fn):
    for o in obs:
        h = not fn(o)
        o.hide_render = h
        o.hide_viewport = h


def explode(obs, k=1.0, inv=False):
    for o in obs:
        e = Vector(o["explode"]) * k
        base = Vector(o.get("_base", o.location))
        o["_base"] = list(base)
        o.location = base + e


def export_all(sc, obs, root, out):
    bpy.ops.object.select_all(action="DESELECT")
    path = os.path.join(out, "microwave.glb")
    kw = dict(filepath=path, export_format="GLB", use_selection=False, export_extras=True,
              export_yup=True, export_apply=False, export_cameras=False, export_lights=False,
              export_animations=False, export_materials="EXPORT", export_image_format="AUTO")
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop("export_image_format")
        bpy.ops.export_scene.gltf(**kw)
    return path


def keyframe_exploded(sc, obs):
    """.blend 里留一段动画：1–60 帧炸开，天线和风扇一直转。"""
    sc.frame_start, sc.frame_end = 1, 120
    for o in obs:
        base = o.location.copy()
        e = Vector(o["explode"])
        o.keyframe_insert("location", frame=1)
        o.location = base + e
        o.keyframe_insert("location", frame=60)
        o.keyframe_insert("location", frame=120)
        o.location = base
        if o.name in ("AntennaPlate", "AntennaShaft", "ResinShaft"):
            o.rotation_mode = "XYZ"
            o.rotation_euler = (0, 0, 0)
            o.keyframe_insert("rotation_euler", frame=1)
            o.rotation_euler = (0, 0, math.radians(360))
            o.keyframe_insert("rotation_euler", frame=120)
            o.rotation_euler = (0, 0, 0)


def main():
    args = out_dir_from_args()
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    sc, obs, root = build_all(out)
    glb = export_all(sc, obs, root, out)

    # 给 HTML 共用的几何参数
    spec = dict(P)
    spec["slots"] = ANT_SLOTS
    spec["parts"] = [dict(name=p.name, label=p.label, group=p.group, desc=p.desc) for p in PARTS]
    json.dump(spec, open(os.path.join(out, "spec.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    tris = sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in obs)
    print(f"[ok] 零件 {len(obs)} 个, 三角面 {tris}, GLB {os.path.getsize(glb) / 1e6:.2f} MB")

    if not args.no_render:
        co = setup_render(sc, args.samples)
        base = {o.name: o.location.copy() for o in obs}

        def shot(name, loc, tgt=(0, 0, 0.17), lens=55):
            co.data.lens = lens
            aim(co, loc, tgt)
            sc.render.filepath = os.path.join(out, name + ".png")
            bpy.ops.render.render(write_still=True)

        # 1 外观
        set_visible(obs, lambda o: o["group"] != "food")
        shot("view_front", (-0.62, -1.35, 0.62))
        # 2 去外壳看内部
        hide = {"OuterCover", "BackPanel", "PanelBody", "PanelPrint", "Display", "ControlBoard", "CavityBox", "DoorFrame", "DoorGlass", "DoorMesh", "DoorChoke", "CavityLamp", "GlassFloor", "IRSensor"}
        set_visible(obs, lambda o: o.name not in hide and o["group"] != "food")
        shot("view_inside", (0.25, -1.25, 0.95), lens=60)
        # 3 爆炸
        set_visible(obs, lambda o: o["group"] != "food")
        for o in obs:
            o.location = base[o.name] + Vector(o["explode"])
        shot("view_exploded", (-1.25, -2.3, 1.35), tgt=(0, 0, 0.2), lens=50)
        for o in obs:
            o.location = base[o.name]

    set_visible(obs, lambda o: True)
    keyframe_exploded(sc, obs)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "microwave.blend"), compress=True)
    print("[ok] 输出目录", out)


if __name__ == "__main__":
    main()
