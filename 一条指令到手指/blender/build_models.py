"""一条指令到手指：三个教学模型，纯脚本建模。

    desk.glb    桌面全景：电脑、M7C 板、面包板（TXB0104 和 241）、电源分线板、腱绳手（17 个舵机）
    servo.glb   舵机剖视：电机、齿轮组、输出轴、磁铁和编码器、控制板
    finger.glb  一根手指：舵机线轴、关节滑轮、三节指骨（两根腱绳由网页实时画）
    layout.json 给网页用的坐标：每一站的位置、信号走的路线、手指关节的转轴

外形是为了讲原理自己画的简化版，不是任何产品的图纸；面包板上的器件按信号顺序从左到右排，
和实物的列号不一样（实物接线看 whj_MCU 仓库的 docs/breadboard）。尺寸单位 mm。

用法（二选一）：
    blender -b --factory-startup -P blender/build_models.py -- --out blender/out
    pip install bpy && python blender/build_models.py --out blender/out

网页靠物体名字找零件，改名字要同步改 web/src/stage.js：
    desk   ST_*（各站的外壳，网页用来高亮）  WIRE_*（信号线，按电平上色）
           SERVO_n / SPOOL_n（n = 电机 ID 1~17）  F_<手指>_<1~3>（指骨，父子关系，原点在关节）
    servo  SV_front（前盖，网页里变透明）  SV_g0~SV_g3（齿轮）  SV_out（输出轴整组，带舵盘和磁铁）
    finger FG_spool  FG_pulley  FG_p1（原点在关节）  FG_ball
"""
import sys, os, math, json, argparse
import bpy, bmesh
from mathutils import Matrix, Vector

S = 0.01          # mm -> 场景单位，每个场景开头会改
ORIGIN = {}       # 物体名 -> 原点（mm，世界坐标）
MATS = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ORIGIN.clear()
    MATS.clear()


def mat(name, color, metallic=0.0, rough=0.5, emit=None, alpha=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 1.0
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND"
    MATS[name] = m
    return m


AXIS = {"z": Matrix.Identity(4), "x": Matrix.Rotation(math.pi / 2, 4, "Y"), "y": Matrix.Rotation(-math.pi / 2, 4, "X")}


def smooth_path(pts, n=10):
    """Catmull-Rom：把几个控制点连成一条顺滑的线。"""
    p = [Vector(q) for q in pts]
    if len(p) < 3:
        return p
    ext = [p[0] + (p[0] - p[1])] + p + [p[-1] + (p[-1] - p[-2])]
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(p[-1])
    return out


class B:
    """往一个 bmesh 里堆基本体（坐标 mm），最后变成一个物体。"""

    def __init__(self):
        self.bm = bmesh.new()

    def _place(self, verts, c, m=None):
        if m is not None:
            bmesh.ops.transform(self.bm, matrix=m, verts=verts)
        bmesh.ops.translate(self.bm, vec=c, verts=verts)

    def box(self, c, size, m=None):
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        bmesh.ops.scale(self.bm, vec=size, verts=r["verts"])
        self._place(r["verts"], c, m)
        return self

    def cyl(self, c, r, h, axis="z", seg=24, r2=None, m=None):
        g = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
        mm = AXIS[axis] if m is None else m @ AXIS[axis]
        self._place(g["verts"], c, mm)
        return self

    def ball(self, c, r, scale=(1, 1, 1), seg=16):
        g = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=max(8, seg // 2), radius=r)
        bmesh.ops.scale(self.bm, vec=scale, verts=g["verts"])
        self._place(g["verts"], c)
        return self

    def gear(self, c, r, h, teeth, axis="z", tooth=0.9):
        """带齿的圆盘：外圈在齿顶和齿根之间来回。"""
        vs = []
        n = teeth * 4
        for i in range(n):
            a = 2 * math.pi * i / n
            rr = r if i % 4 in (0, 1) else r - tooth
            vs.append(self.bm.verts.new((rr * math.cos(a), rr * math.sin(a), -h / 2)))
        f = self.bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(self.bm, geom=[f])
        top = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(self.bm, vec=(0, 0, h), verts=top)
        self._place(vs + top, c, AXIS[axis])
        return self

    def tube(self, pts, r, seg=8, smooth=True):
        p = smooth_path(pts) if smooth else [Vector(q) for q in pts]
        rings = []
        up = Vector((0, 0, 1))
        for i, q in enumerate(p):
            t = (p[min(i + 1, len(p) - 1)] - p[max(i - 1, 0)]).normalized()
            a = t.cross(up)
            if a.length < 1e-4:
                a = t.cross(Vector((1, 0, 0)))
            a.normalize()
            b = t.cross(a).normalized()
            rings.append([self.bm.verts.new(q + r * (math.cos(2 * math.pi * k / seg) * a + math.sin(2 * math.pi * k / seg) * b)) for k in range(seg)])
        for i in range(len(rings) - 1):
            for k in range(seg):
                self.bm.faces.new((rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]))
        self.bm.faces.new(rings[0][::-1])
        self.bm.faces.new(rings[-1])
        return self

    def xform(self, m):
        bmesh.ops.transform(self.bm, matrix=m, verts=self.bm.verts)
        return self

    def done(self, name, material, origin=(0, 0, 0), parent=None, smooth=False):
        o = Vector(origin)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        bmesh.ops.translate(self.bm, vec=-o, verts=self.bm.verts)
        bmesh.ops.scale(self.bm, vec=(S, S, S), verts=self.bm.verts)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        if smooth:
            for p in me.polygons:
                p.use_smooth = True
        ob = bpy.data.objects.new(name, me)
        ob.data.materials.append(material)
        bpy.context.scene.collection.objects.link(ob)
        ORIGIN[name] = o
        if parent is not None:
            ob.parent = parent
            ob.location = (o - ORIGIN[parent.name]) * S
        else:
            ob.location = o * S
        return ob


def gl(v):
    """Blender 坐标（mm，Z 朝上）换成网页坐标（glTF，Y 朝上），已乘缩放。"""
    v = Vector(v)
    return [round(v.x * S, 4), round(v.z * S, 4), round(-v.y * S, 4)]


def gl_dir(v):
    v = Vector(v).normalized()
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]


# =====================================================================
# 桌面全景
# =====================================================================
FINGERS = ["index", "middle", "ring", "pinky"]
# 塔上 16 个手指舵机的位置：正面两排、背面两排，同一根手指的放在一起
TOWER_SLOTS = {"front": [[7, 8, 9, 6], [17, 2, 5, 4]], "back": [[3, 14, 15, 16], [10, 13, 12, 11]]}


def build_desk():
    global S
    S = 0.01
    L = {"scale": S, "anchors": {}, "paths": {}, "servos": {}, "fingers": {}}
    M = {
        "desk": mat("desk", (0.40, 0.31, 0.24), rough=0.85), "alu": mat("alu", (0.55, 0.57, 0.60), 0.6, 0.45),
        "dark": mat("dark", (0.08, 0.09, 0.10), rough=0.5), "screen": mat("screen", (0.04, 0.08, 0.13), rough=0.2, emit=(0.06, 0.20, 0.36)),
        "pcb": mat("pcb", (0.05, 0.22, 0.42), rough=0.55), "pcb_g": mat("pcb_g", (0.04, 0.30, 0.16), rough=0.55),
        "pcb_r": mat("pcb_r", (0.50, 0.08, 0.10), rough=0.55), "chip": mat("chip", (0.06, 0.06, 0.07), rough=0.4),
        "metal": mat("metal", (0.80, 0.80, 0.82), 1.0, 0.3), "gold": mat("gold", (0.85, 0.65, 0.25), 1.0, 0.35),
        "bread": mat("bread", (0.80, 0.80, 0.74), rough=0.7), "hole": mat("hole", (0.22, 0.22, 0.22), rough=0.9),
        "wire": mat("wire", (0.45, 0.50, 0.53), rough=0.5), "wire_blk": mat("wire_blk", (0.05, 0.05, 0.05), rough=0.6),
        "wire_red": mat("wire_red", (0.70, 0.08, 0.06), rough=0.6), "res": mat("res", (0.78, 0.66, 0.45), rough=0.6),
        "servo": mat("servo", (0.16, 0.17, 0.19), rough=0.45), "spool": mat("spool", (0.80, 0.80, 0.76), rough=0.5),
        "frame": mat("frame", (0.50, 0.53, 0.57), rough=0.6), "bone": mat("bone", (0.78, 0.78, 0.75), rough=0.55),
        "joint": mat("joint", (0.25, 0.26, 0.28), rough=0.5), "tendon": mat("tendon", (0.75, 0.70, 0.55), rough=0.7),
        "led": mat("led", (0.15, 0.5, 0.2), rough=0.3, emit=(0.1, 0.9, 0.3)),
    }
    B().box((-40, 20, -6), (760, 380, 12)).done("DESK", M["desk"])

    # ---- 电脑 ----
    px, py = -255, 60
    B().box((px, py, 6), (180, 124, 10)).done("ST_pc", M["alu"])
    b = B()
    for r in range(4):
        b.box((px, py - 34 + r * 15, 11.4), (150, 11, 0.8))
    b.box((px, py - 52, 11.3), (60, 14, 0.5))
    b.done("PC_keys", M["dark"])
    tilt = Matrix.Rotation(math.radians(-14), 4, "X")
    B().box((0, 0, 60), (180, 5, 120), m=None).xform(tilt).xform(Matrix.Translation((px, py + 62, 11))).done("PC_lid", M["alu"])
    B().box((0, -2.8, 61), (166, 0.6, 104)).xform(tilt).xform(Matrix.Translation((px, py + 62, 11))).done("PC_panel", M["screen"])
    L["anchors"]["pc"] = gl((px, py, 70))
    usb_a = (px + 90, py - 30, 6)

    # ---- M7C 板 ----
    mx, my, mz = -105, -10, 8
    b = B().box((mx, my, mz), (70, 52, 1.6))
    b.done("ST_m7c", M["pcb"])
    b = B()
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl((mx + sx * 31, my + sy * 22, mz / 2), 2.2, mz, seg=10)
    b.done("M7C_feet", M["metal"])
    B().box((mx + 2, my, mz + 1.6), (14, 14, 1.6)).done("M7C_chip", M["chip"])
    B().box((mx - 31, my + 6, mz + 3), (9, 9, 4.5)).done("M7C_usb", M["metal"])
    B().box((mx - 14, my - 14, mz + 1.6), (8, 8, 1.4)).box((mx - 16, my + 16, mz + 1.4), (5, 3, 1.2)).done("M7C_parts", M["chip"])
    B().box((mx + 31, my, mz + 5), (2.6, 40, 8.5)).done("M7C_header", M["dark"])
    b = B()
    for i in range(14):
        b.box((mx + 31, my - 18 + i * 2.77, mz + 10.5), (0.7, 0.7, 4))
    b.done("M7C_pins", M["gold"])
    B().box((mx - 4, my + 18, mz + 1.3), (2.2, 1.4, 1.0)).done("M7C_led", M["led"])
    L["anchors"]["m7c"] = gl((mx, my, mz + 14))
    usb_b = (mx - 36, my + 6, mz + 3)
    hdr = lambda k: (mx + 31, my + 6 - k * 6, mz + 12)

    # ---- 面包板 ----
    bx, by, bz = 20, -10, 9
    B().box((bx, by, bz / 2), (132, 56, bz)).done("BREAD", M["bread"])
    b = B()
    for i in range(44):
        for j in (-1, 1):
            b.box((bx - 62 + i * 2.88, by + j * 13, bz + 0.05), (1.3, 17, 0.2))
    for j in (-1, 1):
        b.box((bx, by + j * 25.5, bz + 0.05), (126, 1.2, 0.2))
    b.done("BREAD_holes", M["hole"])
    B().box((bx, by, bz + 0.1), (132, 3.2, 0.3)).done("BREAD_slot", M["hole"])
    # TXB0104 小板
    tx, ty = bx - 30, by
    B().box((tx, ty, bz + 5), (20, 17, 1.4)).done("ST_txb", M["pcb_r"])
    B().box((tx, ty, bz + 6.4), (4.5, 5, 1.2)).done("TXB_chip", M["chip"])
    b = B()
    for i in range(6):
        for j in (-1, 1):
            b.box((tx - 6.35 + i * 2.54, ty + j * 7.2, bz + 3), (0.65, 0.65, 6.5))
    b.done("TXB_pins", M["gold"])
    L["anchors"]["txb"] = gl((tx, ty, bz + 30))
    # 241 转接板
    gx, gy = bx + 30, by
    B().box((gx, gy, bz + 5), (13, 12, 1.4)).done("ST_241", M["pcb_g"])
    B().box((gx, gy, bz + 6.3), (3.2, 2.4, 1.0)).done("G241_chip", M["chip"])
    b = B()
    for i in range(4):
        for j in (-1, 1):
            b.box((gx - 3.8 + i * 2.54, gy + j * 5, bz + 3), (0.65, 0.65, 6.5))
    b.done("G241_pins", M["gold"])
    L["anchors"]["g241"] = gl((gx, gy, bz + 12))
    # 三个电阻
    b = B()
    for (x, y, ln) in [(gx + 14, gy + 9, 9), (tx + 16, ty + 14, 9), (gx - 2, gy - 14, 9)]:
        b.cyl((x, y, bz + 3), 1.2, 6, axis="x", seg=10)
        b.tube([(x - 6, y, bz), (x - 6, y, bz + 3), (x + 6, y, bz + 3), (x + 6, y, bz)], 0.3, seg=6, smooth=False)
    b.done("RES", M["res"])

    # ---- 电源分线板 ----
    hx, hy, hz = 125, -6, 6
    B().box((hx, hy, hz), (40, 34, 1.6)).done("ST_phb", M["pcb_g"])
    B().box((hx - 4, hy + 11, hz + 6), (14, 9, 11)).done("PHB_jack", M["dark"])
    b = B()
    for i in range(3):
        b.box((hx - 12 + i * 12, hy - 11, hz + 3.6), (8, 6, 5.5))
    b.done("PHB_conn", M["bread"])
    B().box((hx + 13, hy + 10, hz + 3), (6, 10, 4.5)).done("PHB_sw", M["dark"])
    L["anchors"]["phb"] = gl((hx, hy, hz + 32))

    # ---- 信号线 ----
    def wire(name, pts, r=1.0, m="wire"):
        B().tube(pts, r).done(name, M[m], smooth=True)
        L["paths"][name] = [gl(q) for q in smooth_path(pts, 8)]

    wire("WIRE_usb", [usb_a, (px + 112, py - 44, 4), (mx - 62, my + 22, 4), usb_b], 1.6, "wire_blk")
    txb_a = lambda k: (tx - 6.35 + k * 2.54 + 2.54, ty - 7.2, bz + 7)       # 3.3 V 一侧的脚
    txb_b = lambda k: (tx - 6.35 + k * 2.54 + 2.54, ty + 7.2, bz + 7)       # 5 V 一侧的脚
    g_in = lambda k: (gx - 3.8 + k * 2.54, gy - 5, bz + 7)
    names = ["dir", "rx", "tx"]
    for k, nm in enumerate(names):
        a, c = hdr(k), txb_a(k)
        wire(f"WIRE_{nm}", [a, (a[0] + 10, a[1] - 4, 30 + k * 5), (c[0] - 12, c[1] - 14 - k * 3, 30 + k * 5), (c[0], c[1] - 9, bz + 14), c], 0.9)
        a, c = txb_b(k), g_in(k)
        wire(f"WIRE_{nm}5", [a, (a[0] + 4, a[1] + 10, bz + 15 + k * 3), ((a[0] + c[0]) / 2, a[1] + 14 + k * 3, bz + 20 + k * 3),
                             (c[0] - 2, c[1] - 12 - k * 3, bz + 16 + k * 3), (c[0], c[1] - 5, bz + 10), c], 0.9)
    d0 = (gx + 3.8, gy + 5, bz + 7)
    d1 = (hx - 12, hy - 11, hz + 6)
    wire("WIRE_data", [d0, (gx + 12, gy + 14, bz + 16), (hx - 26, hy - 4, 18), (hx - 14, hy - 16, 12), d1], 1.0)
    # 12 V 电源线（只是让电源分线板看起来像真的）
    B().tube([(hx - 4, hy + 16, hz + 6), (hx - 2, hy + 60, 6), (hx + 40, hy + 150, 4), (hx + 60, hy + 190, 4)], 1.8).done("WIRE_12v", M["wire_red"], smooth=True)

    # ---- 腱绳手 ----
    ox, oy = 215, 0
    TW, TD, TH = 96, 64, 152                     # 塔的宽、深、高
    b = B().box((ox, oy, 3), (TW + 12, TD + 16, 6))
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((ox + sx * (TW / 2 - 2), oy + sy * (TD / 2 - 2), TH / 2), (4, 4, TH))
    b.box((ox, oy, TH - 2), (TW, TD, 4)).box((ox, oy, 70), (TW - 8, 6, 132))
    b.done("ST_tower", M["frame"])
    sw, sh, sd = 20, 34, 24
    for face, rows in TOWER_SLOTS.items():
        sy = -1 if face == "front" else 1
        for r, ids in enumerate(rows):
            for c, sid in enumerate(ids):
                x = ox - 33 + c * 22
                z = 96 - r * 44
                y = oy + sy * (TD / 2 - sd / 2 - 3)
                B().box((x, y, z), (sw, sd, sh)).done(f"SERVO_{sid}", M["servo"])
                cy = y + sy * (sd / 2 + 3)
                bb = B().cyl((x, cy, z + 6), 7.5, 5, axis="y").cyl((x, cy + sy * 2.8, z + 6), 8.6, 0.8, axis="y").cyl((x, cy - sy * 2.8, z + 6), 8.6, 0.8, axis="y")
                bb.box((x + 4.5, cy + sy * 3.4, z + 6), (2.2, 0.6, 2.2))            # 线轴上的记号，转起来才看得出
                bb.done(f"SPOOL_{sid}", M["spool"], origin=(x, cy, z + 6))
                L["servos"][str(sid)] = {"pos": gl((x, cy + sy * 4, z + 6)), "spoolAxis": gl_dir((0, sy, 0)), "face": face}
    # 手腕舵机（1 号，个头大一点）
    B().box((ox, oy, TH + 17), (30, 34, 30)).done("SERVO_1", M["servo"])
    B().cyl((ox, oy - 20, TH + 17), 9, 5, axis="y").box((ox + 5, oy - 23, TH + 17), (2.4, 0.6, 2.4)).done("SPOOL_1", M["spool"], origin=(ox, oy - 20, TH + 17))
    L["servos"]["1"] = {"pos": gl((ox, oy - 24, TH + 17)), "spoolAxis": gl_dir((0, -1, 0)), "face": "front"}
    L["anchors"]["tower"] = gl((ox, oy - TD / 2 - 8, 80))
    # 手腕和手掌
    wz = TH + 34
    B().cyl((ox, oy, wz + 6), 20, 12, seg=36).done("HAND_wrist", M["joint"])
    pz0 = wz + 12
    PW, PT, PH = 84, 22, 86
    B().box((ox, oy, pz0 + PH / 2), (PW, PT, PH)).box((ox - PW / 2 - 6, oy, pz0 + 30), (16, PT, 44)).done("HAND_palm", M["bone"])
    L["anchors"]["hand"] = gl((ox, oy - 14, pz0 + PH + 40))
    # 四根手指：三节，父子关系，原点在关节上
    lens = {"index": (42, 27, 22), "middle": (46, 30, 23), "ring": (43, 28, 22), "pinky": (34, 22, 19)}
    fz = pz0 + PH + 4
    for i, f in enumerate(FINGERS):
        x = ox - 31.5 + i * 21
        parent, z = None, fz
        segs = []
        for k, ln in enumerate(lens[f]):
            w = 15 - k * 1.5
            b = B().cyl((x, oy, z), w / 2 + 0.6, w + 1.5, axis="x", seg=18)
            b.box((x, oy, z + ln / 2), (w, w - 1, ln - 3))
            if k == 2:
                b.ball((x, oy, z + ln - 4), w / 2, scale=(1, 0.95, 1.1), seg=14)
            ob = b.done(f"F_{f}_{k + 1}", M["bone"], origin=(x, oy, z), parent=parent)
            segs.append({"name": ob.name, "axis": [1, 0, 0]})
            parent, z = ob, z + ln
        L["fingers"][f] = {"segs": segs, "base": gl((x, oy, fz)), "tip": gl((x, oy, z))}
    # 拇指：从手掌侧面斜着伸出去
    a = math.radians(48)
    d = Vector((-math.sin(a), 0, math.cos(a)))                 # 拇指的方向（斜向左上）
    side = Vector((math.cos(a), 0, math.sin(a)))               # 往掌心方向弯时绕的轴
    base = Vector((ox - PW / 2 - 12, oy - 2, pz0 + 46))
    rot = Matrix.Rotation(-a, 4, "Y")
    parent, o = None, base
    segs = []
    for k, ln in enumerate((34, 26, 22)):
        w = 16 - k * 1.5
        b = B().cyl((0, 0, 0), w / 2 + 0.6, w + 1.5, axis="x", seg=18).box((0, 0, ln / 2), (w, w - 1, ln - 3))
        if k == 2:
            b.ball((0, 0, ln - 4), w / 2, scale=(1, 0.95, 1.1), seg=14)
        b.xform(rot).xform(Matrix.Translation(o))
        ob = b.done(f"F_thumb_{k + 1}", M["bone"], origin=tuple(o), parent=parent)
        segs.append({"name": ob.name, "axis": gl_dir(side)})
        parent, o = ob, o + d * ln
    L["fingers"]["thumb"] = {"segs": segs, "base": gl(base), "tip": gl(o)}
    # 腱绳：每个手指舵机到手掌画两根细线（示意）；8 号（食指 MCP）单独一个物体，网页会高亮
    def tendons(ids, name):
        b = B()
        for sid in ids:
            sp = ORIGIN[f"SPOOL_{sid}"]
            j = next(q for q in ("index", "middle", "ring", "pinky", "thumb") if sid in {
                "index": (7, 8, 9), "middle": (6, 17, 2), "ring": (5, 4, 3), "pinky": (14, 15, 16), "thumb": (10, 13, 12, 11)}[q])
            fx = base.x + 6 if j == "thumb" else ox - 31.5 + FINGERS.index(j) * 21
            fzz = base.z - 8 if j == "thumb" else fz - 6
            sy = -1 if sp.y < oy else 1
            for dx in (-3.2, 3.2):
                b.tube([(sp.x + dx * 2, sp.y, sp.z + 4), (sp.x + dx, sp.y + sy * 1, TH - 6), (ox + (sp.x - ox) * 0.25 + dx * 0.5, oy + sy * 9, wz + 4),
                        (ox + (fx - ox) * 0.7 + dx * 0.4, oy + sy * 12, pz0 + 30), (fx + dx * 0.5, oy + sy * 11.6, fzz)], 0.45, seg=5)
        b.done(name, M["tendon"], smooth=True)
    tendons([i for i in range(2, 18) if i != 8], "TENDONS")
    tendons([8], "TENDON_8")
    # 舵机总线：从电源分线板进塔，再到 8 号舵机
    e0 = (hx + 12, hy - 11, hz + 6)
    e1 = (ox - TW / 2 - 4, oy - TD / 2 + 4, 14)
    wire("WIRE_bus", [e0, (hx + 26, hy - 22, 10), (ox - TW / 2 - 14, oy - TD / 2 - 8, 8), e1], 1.4, "wire_blk")
    s8 = ORIGIN["SERVO_8"]
    L["paths"]["chain"] = [gl(q) for q in smooth_path([e1, (ox - TW / 2 + 4, oy - TD / 2 - 2, 40), (s8.x - 12, oy - TD / 2 - 3, s8.z - 10), (s8.x, s8.y - 13, s8.z - 8)], 8)]
    # 板子内部看不见的那几段，给光点走
    L["paths"]["in_m7c"] = [gl(usb_b), gl((mx, my, mz + 3)), gl(hdr(2))]
    L["paths"]["in_txb"] = [gl(txb_a(2)), gl((tx, ty, bz + 8)), gl(txb_b(2))]
    L["paths"]["in_241"] = [gl(g_in(2)), gl((gx, gy, bz + 8)), gl(d0)]
    L["paths"]["in_phb"] = [gl(d1), gl((hx, hy - 8, hz + 4)), gl(e0)]
    L["paths"]["in_pc"] = [gl((px, py, 12)), gl(usb_a)]
    L["bounds"] = {"min": gl((-350, 130, 0)), "max": gl((275, -60, fz + 100))}
    return L


# =====================================================================
# 舵机剖视（示意，不是实际内部图纸）
# =====================================================================
def build_servo():
    global S
    S = 0.1
    L = {"scale": S, "anchors": {}}
    M = {
        "shell": mat("shell", (0.14, 0.15, 0.17), rough=0.45), "front": mat("front", (0.30, 0.33, 0.37), rough=0.3, alpha=0.25),
        "motor": mat("motor", (0.70, 0.71, 0.73), 0.9, 0.35), "copper": mat("copper", (0.80, 0.45, 0.20), 0.8, 0.4),
        "gear_a": mat("gear_a", (0.90, 0.78, 0.42), 0.6, 0.4), "gear_b": mat("gear_b", (0.82, 0.84, 0.86), 0.7, 0.35),
        "pcb": mat("pcb", (0.05, 0.30, 0.18), rough=0.55), "chip": mat("chip", (0.06, 0.06, 0.07), rough=0.4),
        "enc": mat("enc", (0.10, 0.10, 0.12), rough=0.3, emit=(0.1, 0.6, 0.9)), "horn": mat("horn", (0.20, 0.21, 0.23), rough=0.5),
        "magN": mat("magN", (0.80, 0.15, 0.12), rough=0.4), "magS": mat("magS", (0.15, 0.30, 0.75), rough=0.4),
        "spool": mat("spool", (0.88, 0.88, 0.85), rough=0.5), "conn": mat("conn", (0.90, 0.90, 0.86), rough=0.6),
        "mark": mat("mark", (0.95, 0.55, 0.15), rough=0.5),
    }
    W, D, H, T = 34.0, 20.0, 26.0, 1.2          # 外壳 34 × 20 × 26，壁厚 1.2
    b = B()
    b.box((0, D / 2 - T / 2, H / 2), (W, T, H))                    # 后壁
    b.box((-W / 2 + T / 2, 0, H / 2), (T, D, H)).box((W / 2 - T / 2, 0, H / 2), (T, D, H))
    b.box((0, 0, T / 2), (W, D, T))
    b.box((-W / 2 + 2, 0, H - T / 2), (4, D, T)).box((W / 2 - 1.5, 0, H - T / 2), (3, D, T))      # 顶盖只留两条边，从上面能看到齿轮
    b.box((9.5, D / 2 - 3, H - T / 2), (13, 6, T)).box((9.5, -D / 2 + 3, H - T / 2), (13, 6, T))
    b.done("SV_shell", M["shell"])
    B().box((0, -D / 2 + 0.3, H / 2), (W, 0.6, H)).done("SV_front", M["front"])
    # 控制板在底部
    B().box((0, 0, 2.6), (W - 4, D - 4, 1.0)).done("SV_pcb", M["pcb"])
    B().box((-3, 1, 3.6), (6, 6, 1.0)).done("SV_mcu", M["chip"])
    B().box((-11.5, -3, 3.5), (4, 4, 0.9)).done("SV_drv", M["chip"])
    ax = 9.5                                    # 输出轴的位置
    B().box((ax, 0, 3.6), (4, 4, 0.9)).done("SV_enc", M["enc"])
    B().box((-W / 2 + 0.2, 4, 5.5), (2.4, 6, 4)).box((-W / 2 + 0.2, -4, 5.5), (2.4, 6, 4)).done("SV_conn", M["conn"])
    # 电机
    mxx = -9.0
    B().cyl((mxx, 0, 11.5), 5.0, 13, seg=40).done("SV_motor", M["motor"])
    B().cyl((mxx, 0, 5.2), 4.0, 1.2, seg=32).done("SV_motor_cap", M["copper"])
    zg = 20.0
    B().gear((mxx, 0, zg), 1.9, 3.2, 8, tooth=0.6).cyl((mxx, 0, 18.6), 0.6, 1.6, seg=8).done("SV_g0", M["gear_a"], origin=(mxx, 0, zg))
    # 三级中间齿轮：大齿轮接上一级的小齿轮，同轴的小齿轮带下一级
    stages = [(-4.1, 0.0, 3.6, 1.6, 20.3), (0.4, 0.0, 3.5, 1.6, 21.9), (4.6, 0.0, 3.4, 1.7, 20.3)]
    for i, (x, y, rb, rs, z) in enumerate(stages):
        b = B().gear((x, y, z), rb, 1.4, 16 - i, tooth=0.55).gear((x, y, z + (1.5 if i != 1 else -1.5)), rs, 1.8, 7, tooth=0.5)
        b.cyl((x, y, 20.9), 0.5, 5.2, seg=8)
        b.done(f"SV_g{i + 1}", M["gear_b"] if i % 2 else M["gear_a"], origin=(x, y, z))
    # 输出轴整组：大齿轮 + 轴 + 舵盘 + 线轴 + 磁铁
    out = B().gear((ax, 0, 21.9), 4.6, 1.6, 20, tooth=0.6).cyl((ax, 0, 15.5), 1.5, 22, seg=14).done("SV_out", M["gear_b"], origin=(ax, 0, 21.9))
    B().cyl((ax, 0, H + 1.6), 8.0, 1.8, seg=28).done("SV_horn", M["horn"], origin=(ax, 0, H + 1.6), parent=out)
    b = B().cyl((ax, 0, H + 6), 6.0, 6, seg=28).cyl((ax, 0, H + 3), 7.6, 0.8, seg=28).cyl((ax, 0, H + 9), 7.6, 0.8, seg=28)
    b.done("SV_spool", M["spool"], origin=(ax, 0, H + 6), parent=out, smooth=False)
    B().box((ax + 5.2, 0, H + 9.6), (3.0, 1.2, 0.6)).cyl((ax + 6.2, 0, H + 2.6), 0.8, 0.4, seg=10).done("SV_mark", M["mark"], origin=(ax, 0, H + 6), parent=out)
    B().box((ax - 1.0, 0, 5.3), (2.0, 3.6, 1.6)).done("SV_magN", M["magN"], origin=(ax, 0, 5.3), parent=out)
    B().box((ax + 1.0, 0, 5.3), (2.0, 3.6, 1.6)).done("SV_magS", M["magS"], origin=(ax, 0, 5.3), parent=out)
    L["anchors"] = {"motor": gl((mxx, -6, 12)), "gears": gl((-1, -4, 22)), "out": gl((ax, -3, H + 7)), "enc": gl((ax, -4, 4.5)),
                    "mcu": gl((-3, -4, 4)), "conn": gl((-W / 2 - 1, -4, 6))}
    L["ratios"] = [288.35, 72.0, 17.0, 4.1, 1.0]            # g0~g3 和输出轴相对输出轴的转速倍数（示意）
    L["bounds"] = {"min": gl((-W / 2 - 2, D / 2, 0)), "max": gl((W / 2 + 2, -D / 2, H + 12))}
    return L


# =====================================================================
# 一根手指（单关节试验台）
# =====================================================================
def build_finger():
    global S
    S = 0.03
    RS, RJ = 10.0, 5.0                          # 线轴半径、关节滑轮半径（模型里的基准值，网页可以缩放）
    SZ, JZ = 26.0, 118.0                        # 线轴、关节的高度
    M = {
        "plate": mat("plate", (0.42, 0.47, 0.53), rough=0.7), "servo": mat("servo", (0.16, 0.17, 0.19), rough=0.45),
        "spool": mat("spool", (0.82, 0.82, 0.78), rough=0.5), "mark": mat("mark", (0.95, 0.55, 0.15), rough=0.5),
        "bone": mat("bone", (0.80, 0.80, 0.77), rough=0.55), "joint": mat("joint", (0.24, 0.25, 0.27), rough=0.5),
        "frame": mat("frame", (0.62, 0.64, 0.66), rough=0.6), "ball": mat("ball", (0.95, 0.75, 0.25), rough=0.8),
        "base": mat("base", (0.40, 0.31, 0.24), rough=0.85),
    }
    B().box((10, 6, -4), (150, 70, 8)).done("FG_desk", M["base"])
    B().box((0, 16, 70), (56, 3, 132)).done("FG_plate", M["plate"])
    B().box((0, 6, SZ), (34, 18, 26)).done("FG_servo", M["servo"])
    b = B().cyl((0, -6, SZ), RS, 5, axis="y", seg=36).cyl((0, -3.2, SZ), RS + 1.6, 0.8, axis="y", seg=36).cyl((0, -8.8, SZ), RS + 1.6, 0.8, axis="y", seg=36)
    sp = b.done("FG_spool", M["spool"], origin=(0, -6, SZ))
    B().box((RS - 3.5, -9.5, SZ), (4.0, 0.7, 2.4)).done("FG_spool_mark", M["mark"], origin=(0, -6, SZ), parent=sp)
    # 手掌一侧的两根立柱，顶上是关节轴
    B().box((-11, 6, 84), (4, 16, 62)).box((11, 6, 84), (4, 16, 62)).box((0, 12, 60), (26, 4, 10)).done("FG_frame", M["frame"])
    B().cyl((0, 2, JZ), 1.6, 26, axis="y", seg=12).done("FG_axle", M["joint"])
    p1 = B().box((0, 4, JZ + 26), (13, 12, 44)).cyl((0, 4, JZ + 48), 6.5, 13.5, axis="y", seg=18).done("FG_p1", M["bone"], origin=(0, -6, JZ))
    b = B().cyl((0, -6, JZ), RJ, 5, axis="y", seg=30).cyl((0, -3.2, JZ), RJ + 1.4, 0.8, axis="y", seg=30).cyl((0, -8.8, JZ), RJ + 1.4, 0.8, axis="y", seg=30)
    pl = b.done("FG_pulley", M["joint"], origin=(0, -6, JZ), parent=p1)
    B().box((RJ - 2.2, -9.5, JZ), (2.6, 0.7, 1.8)).done("FG_pulley_mark", M["mark"], origin=(0, -6, JZ), parent=pl)
    bend = Matrix.Rotation(math.radians(12), 4, "Y")
    b = B().box((0, 0, 15), (11.5, 11, 28)).cyl((0, 0, 30), 5.6, 12, axis="y", seg=18)
    b.box((0, 0, 30 + 11), (10, 10, 20)).ball((0, 0, 30 + 21), 5.0, scale=(1, 1, 1.1), seg=14)
    b.xform(bend).xform(Matrix.Translation((0, 4, JZ + 48)))
    b.done("FG_p2", M["bone"], origin=(0, -6, JZ + 48), parent=p1)
    B().ball((52, 2, JZ + 30), 15, seg=20).done("FG_ball", M["ball"], smooth=True)
    L = {"scale": S, "rs": RS, "rj": RJ, "spool": gl((0, -6, SZ)), "joint": gl((0, -6, JZ)), "tendonZ": round(6 * S, 4),
         "axis": gl_dir((0, -1, 0)), "p1len": round(48 * S, 4), "ball": gl((52, 2, JZ + 30)),
         "anchors": {"spool": gl((0, -12, SZ)), "joint": gl((0, -12, JZ)), "tip": gl((0, -8, JZ + 96))},
         "bounds": {"min": gl((-62, 20, 0)), "max": gl((82, -12, JZ + 106))}}
    return L


def export(out, name, also_blend=True):
    if also_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, name + ".blend"))
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, name + ".glb"), export_format="GLB", export_apply=True, export_yup=True)
    print(name, "objects:", len(bpy.data.objects))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
    a = ap.parse_args(argv)
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    layout = {}
    for name, fn in (("desk", build_desk), ("servo", build_servo), ("finger", build_finger)):
        reset()
        layout[name] = fn()
        export(out, name)
    with open(os.path.join(out, "layout.json"), "w", encoding="utf-8") as f:
        json.dump(layout, f, ensure_ascii=False, separators=(",", ":"))
    print("layout.json written")


if __name__ == "__main__":
    main()
