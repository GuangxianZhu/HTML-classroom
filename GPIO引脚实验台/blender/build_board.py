"""GPIO 教学开发板：纯脚本建模。

虚构的一块小板：一颗 8 引脚端口的教学芯片 T8，P0~P5 各接一个电阻和 LED，
P6 留空（悬空测试点），P7 接一个按键到地。尺寸单位 mm，导出时缩到 0.1。

用法（二选一）：
    blender -b --factory-startup -P blender/build_board.py -- --out blender/out
    pip install bpy && python blender/build_board.py --out blender/out

网页靠物体名字找零件，改名字要同步改 web/src/stage.js：
    TRACE_n  引脚 n 的走线（网页按电平上色）
    LEG_n    芯片上引脚 n 的管脚
    LED_n    LED n 的发光帽
    BTN_cap  按键帽（网页里按下时下沉）
    PAD_6    P6 的悬空测试点
"""
import sys, os, math, argparse
import bpy, bmesh
from mathutils import Matrix, Vector

S = 0.1  # mm -> 场景单位

# ---- 版面参数（mm，板中心为原点，板面 z = 0） ----
PCB_W, PCB_H, PCB_T = 64.0, 40.0, 1.6
CHIP = (-8.0, 2.0)          # 芯片中心
CHIP_SIZE, CHIP_T = 12.0, 1.5
LEG_PITCH = 1.4
LEG_TIP_X = CHIP[0] + CHIP_SIZE / 2 + 1.2
RES_X, LED_X, GND_X = 12.0, 19.0, 25.0
LED_Y = [14.0, 8.8, 3.6, -1.6, -6.8, -12.0]
VIA_X = {0: 1.5, 1: 3.0, 2: 7.0, 3: 5.8, 4: 4.6, 5: 3.4, 6: 2.2, 7: 1.0}   # 每条走线拐弯的 x，错开不交叉
BTN = (-8.0, -13.5)
PAD6 = (2.2, -17.0)
TRACE_W, TRACE_T = 0.55, 0.06


def leg_y(n):
    return CHIP[1] + 4.9 - LEG_PITCH * n


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, metallic=0.0, rough=0.5, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 0.0
    return m


class Builder:
    """往一个 bmesh 里堆基本体，最后变成一个物体。"""

    def __init__(self):
        self.bm = bmesh.new()

    def box(self, cx, cy, cz, sx, sy, sz):
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        bmesh.ops.scale(self.bm, vec=(sx, sy, sz), verts=r["verts"])
        bmesh.ops.translate(self.bm, vec=(cx, cy, cz), verts=r["verts"])
        return self

    def cyl(self, cx, cy, cz, r, h, seg=24):
        g = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=h)
        bmesh.ops.translate(self.bm, vec=(cx, cy, cz), verts=g["verts"])
        return self

    def dome(self, cx, cy, cz, rx, ry, rz):
        g = bmesh.ops.create_uvsphere(self.bm, u_segments=16, v_segments=10, radius=1.0)
        bmesh.ops.scale(self.bm, vec=(rx, ry, rz), verts=g["verts"])
        bmesh.ops.translate(self.bm, vec=(cx, cy, cz), verts=g["verts"])
        return self

    def done(self, name, mat, smooth=False):
        bmesh.ops.scale(self.bm, vec=(S, S, S), verts=self.bm.verts)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        if smooth:
            for p in me.polygons:
                p.use_smooth = True
        ob = bpy.data.objects.new(name, me)
        ob.data.materials.append(mat)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def hseg(b, x0, x1, y, z):
    b.box((x0 + x1) / 2, y, z, abs(x1 - x0) + TRACE_W, TRACE_W, TRACE_T)


def vseg(b, x, y0, y1, z):
    b.box(x, (y0 + y1) / 2, z, TRACE_W, abs(y1 - y0) + TRACE_W, TRACE_T)


def text_mesh(items, name, mat):
    """items: (文字, x, y, 字高)。文字转成网格后合并成一个物体。"""
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    for s, x, y, size in items:
        cu = bpy.data.curves.new("t", type="FONT")
        cu.body, cu.size, cu.align_x, cu.align_y = s, size * S, "CENTER", "CENTER"
        ob = bpy.data.objects.new("t", cu)
        bpy.context.scene.collection.objects.link(ob)
        dg.update()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        me.transform(Matrix.Translation(Vector((x * S, y * S, 0.03 * S))))
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build():
    M = dict(
        pcb=material("pcb", (0.006, 0.05, 0.065), 0.0, 0.5),
        copper=material("trace", (0.03, 0.14, 0.17), 0.2, 0.4),
        chip=material("chip", (0.03, 0.03, 0.035), 0.0, 0.55),
        metal=material("metal", (0.75, 0.76, 0.78), 1.0, 0.3),
        gold=material("gold", (0.83, 0.62, 0.22), 1.0, 0.3),
        res=material("resistor", (0.05, 0.05, 0.06), 0.0, 0.6),
        cap=material("capacitor", (0.55, 0.42, 0.28), 0.0, 0.6),
        white=material("led_body", (0.9, 0.9, 0.88), 0.0, 0.6),
        silk=material("silk", (0.92, 0.94, 0.94), 0.0, 0.8),
        btn=material("btn_cap", (0.08, 0.08, 0.09), 0.0, 0.5),
        hole=material("hole", (0.01, 0.01, 0.01), 0.0, 0.9),
    )

    # 板子
    Builder().box(0, 0, -PCB_T / 2, PCB_W, PCB_H, PCB_T).done("PCB", M["pcb"])
    b = Builder()
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl(sx * (PCB_W / 2 - 3.2), sy * (PCB_H / 2 - 3.2), 0.02, 1.6, 0.04)
    b.done("HOLES", M["hole"])
    b = Builder()
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl(sx * (PCB_W / 2 - 3.2), sy * (PCB_H / 2 - 3.2), 0.01, 2.4, 0.04)
    b.done("HOLE_RINGS", M["gold"])

    # 芯片本体 + 三边装饰管脚
    cx, cy = CHIP
    b = Builder().box(cx, cy, CHIP_T / 2 + 0.1, CHIP_SIZE, CHIP_SIZE, CHIP_T)
    b.done("CHIP", M["chip"])
    Builder().cyl(cx - 4.6, cy + 4.6, CHIP_T + 0.12, 0.5, 0.04).done("CHIP_DOT", M["silk"])
    b = Builder()
    for i in range(8):
        o = 4.9 - LEG_PITCH * i
        b.box(cx - CHIP_SIZE / 2 - 0.6, cy + o, 0.25, 1.2, 0.5, 0.3)   # 左
        b.box(cx + o, cy + CHIP_SIZE / 2 + 0.6, 0.25, 0.5, 1.2, 0.3)   # 上
        b.box(cx + o, cy - CHIP_SIZE / 2 - 0.6, 0.25, 0.5, 1.2, 0.3)   # 下
    b.done("LEGS_OTHER", M["metal"])

    # 八个 GPIO 管脚 + 走线
    for n in range(8):
        y = leg_y(n)
        Builder().box(cx + CHIP_SIZE / 2 + 0.6, y, 0.25, 1.2, 0.5, 0.3).done(f"LEG_{n}", M["metal"])
        t = Builder()
        z = TRACE_T / 2
        vx = VIA_X[n]
        hseg(t, LEG_TIP_X - 0.3, vx, y, z)
        if n <= 5:
            ty = LED_Y[n]
            vseg(t, vx, y, ty, z)
            hseg(t, vx, RES_X - 1.4, ty, z)          # 到电阻
            hseg(t, RES_X + 1.4, LED_X - 1.5, ty, z)  # 电阻到 LED
        elif n == 6:
            vseg(t, vx, y, PAD6[1], z)
        else:
            vseg(t, vx, y, BTN[1], z)
            hseg(t, BTN[0] + 3.6, vx, BTN[1], z)
        mat = M["copper"].copy()
        mat.name = f"trace_{n}"
        t.done(f"TRACE_{n}", mat)

    # 电阻、LED、地线
    b_res, b_body, b_pad, b_gnd = Builder(), Builder(), Builder(), Builder()
    for n in range(6):
        y = LED_Y[n]
        b_res.box(RES_X, y, 0.3, 2.0, 1.25, 0.5)
        b_pad.box(RES_X - 1.15, y, 0.3, 0.5, 1.3, 0.55).box(RES_X + 1.15, y, 0.3, 0.5, 1.3, 0.55)
        b_body.box(LED_X, y, 0.3, 2.6, 1.6, 0.6)
        b_pad.box(LED_X - 1.45, y, 0.3, 0.4, 1.6, 0.62).box(LED_X + 1.45, y, 0.3, 0.4, 1.6, 0.62)
        hseg(b_gnd, LED_X + 1.5, GND_X, y, TRACE_T / 2)
        em = (1.0, 0.35, 0.08)
        lm = material(f"led_{n}", (0.55, 0.50, 0.46), 0.0, 0.25, emit=em)
        Builder().dome(LED_X, y, 0.6, 0.95, 0.7, 0.55).done(f"LED_{n}", lm, smooth=True)
    vseg(b_gnd, GND_X, LED_Y[0], -17.0, TRACE_T / 2)
    # 按键另一端到地
    hseg(b_gnd, -20.0, BTN[0] - 3.6, BTN[1], TRACE_T / 2)
    vseg(b_gnd, -20.0, BTN[1], -17.0, TRACE_T / 2)
    hseg(b_gnd, -20.0, GND_X, -17.9, TRACE_T / 2)
    vseg(b_gnd, GND_X, -17.0, -17.9, TRACE_T / 2)
    b_res.done("RESISTORS", M["res"])
    b_body.done("LED_BODIES", M["white"])
    b_pad.done("SMD_PADS", M["metal"])
    gm = M["copper"].copy()
    gm.name = "trace_gnd"
    b_gnd.done("TRACE_GND", gm)

    # P6 悬空测试点
    Builder().cyl(PAD6[0], PAD6[1] + 1.2, 0.05, 1.0, 0.1).done("PAD_6", M["gold"])

    # 按键
    bx, by = BTN
    b = Builder().box(bx, by, 1.0, 6.0, 6.0, 1.8)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(bx + sx * 3.4, by + sy * 2.2, 0.2, 1.0, 0.7, 0.3)
    b.done("BTN_base", M["metal"])
    Builder().cyl(bx, by, 2.5, 1.75, 1.4).done("BTN_cap", M["btn"], smooth=False)

    # USB 口、晶振、电容：只是让板子看起来像真的
    Builder().box(-PCB_W / 2 + 3.2, 4.0, 1.6, 7.4, 9.0, 3.2).done("USB", M["metal"])
    Builder().box(-21.0, -6.0, 0.6, 5.0, 3.2, 1.2).done("XTAL", M["metal"])
    b = Builder()
    for (x, y) in [(-8.0, 12.2), (-11.0, 12.2), (-18.5, 0.0), (-18.5, -2.4)]:
        b.box(x, y, 0.35, 1.6, 0.9, 0.7)
    b.done("CAPS", M["cap"])

    # 丝印
    items = [("GPIO DEMO BOARD", -14.0, 17.2, 2.0), ("USB", -27.0, 10.6, 1.4),
             ("P6", PAD6[0] + 3.2, PAD6[1] + 1.2, 1.6), ("P7  KEY", bx, by + 4.8, 1.5),
             ("GND", GND_X + 3.2, -17.9, 1.3)]
    for n in range(6):
        items.append((f"P{n}", (RES_X + LED_X) / 2, LED_Y[n] + 1.7, 1.5))
    text_mesh(items, "SILK", M["silk"])
    chip_txt = text_mesh([("T8", cx, cy, 3.2)], "CHIP_TXT", M["silk"])
    chip_txt.location.z = (CHIP_T + 0.1) * S


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    reset()
    build()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.abspath(a.out), "board.blend"))
    bpy.ops.export_scene.gltf(filepath=os.path.join(os.path.abspath(a.out), "board.glb"),
                              export_format="GLB", export_apply=True, export_yup=True)
    names = sorted(o.name for o in bpy.data.objects)
    print("objects:", len(names), names)


if __name__ == "__main__":
    main()
