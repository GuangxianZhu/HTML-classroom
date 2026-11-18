# -*- coding: utf-8 -*-
"""
超声波流量计教学模型（原创通用造型，不对应任何厂家具体产品）
- U 形 PFA 检测器：直测量管 + 两端压电换能器（同轴 Z 形声路）
- 变换器：DIN 导轨盒，正面 LCD + 4 个 LED + 按键
- 配管：3/8" PFA 管进出
运行：blender -b -P build_flowmeter.py   或   python build_flowmeter.py（需 pip install bpy）
输出：../model/flowmeter.glb  与  ../model/preview.png
单位：米，Blender Z 轴朝上，测量管沿 X 轴，流向 +X
"""
import bpy, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "model")
os.makedirs(OUT_DIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------- 材质 ----------------
def mat(name, color, rough=0.5, metal=0.0, alpha=1.0, emit=None, trans=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if "Transmission Weight" in b.inputs:
        b.inputs["Transmission Weight"].default_value = trans
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 1.0
    return m

M_PFA   = mat("PFA_Milky",   (0.90, 0.91, 0.90), rough=0.35, trans=0.15)
M_TUBE  = mat("PFA_Clear",   (0.85, 0.92, 0.95), rough=0.08, alpha=0.35)
M_CAP   = mat("Transducer_Cap", (0.16, 0.17, 0.19), rough=0.45)
M_PZT   = mat("PZT_Ceramic", (0.85, 0.45, 0.12), rough=0.4)
M_NUT   = mat("PFA_Nut",     (0.80, 0.82, 0.80), rough=0.5)
M_STEEL = mat("SUS304",      (0.75, 0.76, 0.78), rough=0.28, metal=1.0)
M_CASE  = mat("Case_Gray",   (0.78, 0.79, 0.80), rough=0.55)
M_PANEL = mat("Panel_Dark",  (0.10, 0.11, 0.12), rough=0.4)
M_LCD   = mat("LCD",         (0.55, 0.66, 0.50), rough=0.3, emit=(0.10, 0.14, 0.09))
M_LEDR  = mat("LED_Red",     (0.45, 0.05, 0.05), rough=0.2)
M_LEDG  = mat("LED_Green",   (0.05, 0.40, 0.08), rough=0.2)
M_LEDY  = mat("LED_Amber",   (0.50, 0.32, 0.03), rough=0.2)
M_BTN   = mat("Button",      (0.30, 0.31, 0.33), rough=0.6)
M_CABLE = mat("Cable",       (0.12, 0.12, 0.13), rough=0.6)
M_RAIL  = mat("DIN_Rail",    (0.70, 0.71, 0.72), rough=0.3, metal=1.0)

def assign(obj, m):
    obj.data.materials.clear()
    obj.data.materials.append(m)
    return obj

def smooth(obj, angle=35):
    for p in obj.data.polygons:
        p.use_smooth = True
    try:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
    except Exception:
        pass

def cyl(name, r, depth, loc, axis='Z', verts=48, m=None):
    rot = {'X': (0, math.pi/2, 0), 'Y': (math.pi/2, 0, 0), 'Z': (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object; o.name = name
    if m: assign(o, m)
    if verts > 8: smooth(o)
    return o

def box(name, size, loc, m=None, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        mod = o.modifiers.new("bev", 'BEVEL'); mod.width = bevel; mod.segments = 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if m: assign(o, m)
    return o

def tube_hollow(name, r_out, r_in, length, loc, axis='X', m=None):
    outer = cyl(name, r_out, length, loc, axis, m=m)
    inner = cyl(name + "_cut", r_in, length * 1.2, loc, axis)
    mod = outer.modifiers.new("hole", 'BOOLEAN'); mod.operation = 'DIFFERENCE'; mod.object = inner
    bpy.context.view_layer.objects.active = outer
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(inner, do_unlink=True)
    return outer

def pipe(name, pts, r, m):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = r; cu.bevel_resolution = 6; cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    o = bpy.data.objects.new(name, cu); scene.collection.objects.link(o)
    o.data.materials.append(m)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    smooth(o, 60)
    return o

# ---------------- 检测器（PFA 一体成型） ----------------
L = 0.100           # 测量管直段长度（声程）
R_IN = 0.004        # 测量管内径 8 mm → 半径 4 mm
R_OUT = 0.0072

# 测量管（透明显示，方便看流动和声波）
tube = tube_hollow("MeasureTube", R_OUT, R_IN, L, (0, 0, 0), 'X', M_TUBE)

# 两端端块：圆柱 + 向下的出入口凸台，合成一个 PFA 本体
parts = []
for side, x in (("A", -0.062), ("B", 0.062)):
    blk = cyl(f"Block_{side}", 0.017, 0.026, (x, 0, 0), 'X', m=M_PFA)
    port = cyl(f"Port_{side}", 0.0085, 0.040, (x, 0, -0.030), 'Z', m=M_PFA)
    parts += [blk, port]
bpy.ops.object.select_all(action='DESELECT')
for p in parts: p.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
body = bpy.context.active_object; body.name = "PFABody"
smooth(body)

# 压电换能器（藏在端块里，正对测量管两端）
for side, x, sgn in (("A", -0.0515, -1), ("B", 0.0515, 1)):
    pz = cyl(f"Piezo_{side}", 0.0039, 0.0016, (x, 0, 0), 'X', m=M_PZT)
    cap = cyl(f"Transducer_{side}", 0.0125, 0.024, (sgn * 0.087, 0, 0), 'X', m=M_CAP)
    ring = cyl(f"CapRing_{side}", 0.0135, 0.004, (sgn * 0.076, 0, 0), 'X', m=M_STEEL)
    gland = cyl(f"Gland_{side}", 0.006, 0.010, (sgn * 0.104, 0, 0), 'X', verts=6, m=M_CAP)

# 接头螺母（扩口接头）
for side, x in (("In", -0.062), ("Out", 0.062)):
    cyl(f"Nut_{side}", 0.0115, 0.016, (x, 0, -0.058), 'Z', verts=6, m=M_NUT)

# 进出 PFA 管（3/8"）
R_PIPE = 0.00476
pipe("Pipe_In",  [(-0.062, 0, -0.066), (-0.062, 0, -0.095), (-0.090, 0, -0.112), (-0.24, 0, -0.112)], R_PIPE, M_TUBE)
pipe("Pipe_Out", [( 0.062, 0, -0.066), ( 0.062, 0, -0.095), ( 0.090, 0, -0.112), ( 0.32, 0, -0.112)], R_PIPE, M_TUBE)

# 手动隔膜阀（装在进口管上，网页里转手轮 = 改流量）
VX, VZ = -0.170, -0.112
box("ValveBody", (0.032, 0.022, 0.026), (VX, 0, VZ), M_PFA, bevel=0.003)
cyl("ValveBonnet", 0.010, 0.020, (VX, 0, VZ + 0.022), 'Z', m=M_PFA)
hub = cyl("ValveHandle", 0.004, 0.012, (VX, 0, VZ + 0.037), 'Z', m=M_CAP)
bpy.ops.mesh.primitive_torus_add(major_radius=0.013, minor_radius=0.0022, location=(VX, 0, VZ + 0.040))
wheel = bpy.context.active_object; assign(wheel, M_CAP); smooth(wheel)
spokes = []
for i in range(3):
    s = box(f"Spoke{i}", (0.026, 0.0025, 0.0025), (VX, 0, VZ + 0.040), M_CAP)
    s.rotation_euler = (0, 0, i * math.pi / 3); spokes.append(s)
grip = cyl("Grip", 0.0022, 0.010, (VX + 0.013, 0, VZ + 0.046), 'Z', m=M_RAIL)   # 手柄，方便看出转了多少
bpy.ops.object.select_all(action='DESELECT')
for o in [wheel, grip] + spokes: o.select_set(True)
hub.select_set(True); bpy.context.view_layer.objects.active = hub
bpy.ops.object.join()

# 不锈钢安装板 + 支架
box("BasePlate", (0.24, 0.003, 0.15), (0.0, 0.030, -0.030), M_STEEL, bevel=0.002)
for side, x in (("A", -0.062), ("B", 0.062)):
    box(f"Bracket_{side}", (0.020, 0.012, 0.004), (x, 0.022, -0.019), M_STEEL)

# ---------------- 变换器 ----------------
CX, CZ = 0.205, 0.0
box("DINRail", (0.10, 0.008, 0.035), (CX, 0.032, CZ), M_RAIL)
box("Converter", (0.056, 0.050, 0.096), (CX, 0.0, CZ), M_CASE, bevel=0.003)
box("FrontPanel", (0.050, 0.002, 0.088), (CX, -0.0255, CZ), M_PANEL, bevel=0.001)
# LCD：web 端会把它换成 canvas 动态贴图
bpy.ops.mesh.primitive_plane_add(size=1, location=(CX, -0.0268, CZ + 0.020), rotation=(math.pi/2, 0, 0))
lcd = bpy.context.active_object; lcd.name = "LCD"; lcd.scale = (0.044, 0.028, 1)
bpy.ops.object.transform_apply(scale=True); assign(lcd, M_LCD)
# 4 个 LED：上限报警 / 下限报警 / 错误 / 脉冲
for i, (nm, m) in enumerate((("LED_H", M_LEDR), ("LED_L", M_LEDY), ("LED_ERR", M_LEDR), ("LED_PULSE", M_LEDG))):
    cyl(nm, 0.0022, 0.003, (CX - 0.0165 + i * 0.011, -0.0272, CZ - 0.008), 'Y', verts=24, m=m)
for i in range(3):
    box(f"Button_{i}", (0.009, 0.003, 0.006), (CX - 0.012 + i * 0.012, -0.0272, CZ - 0.026), M_BTN, bevel=0.001)
# 端子排
box("Terminal", (0.048, 0.010, 0.010), (CX, -0.010, CZ - 0.053), M_PANEL)

# 电缆：换能器 → 变换器；输出线 → PLC
pipe("Cable_A", [(-0.110, 0, 0), (-0.135, -0.004, 0.030), (-0.07, -0.006, 0.072), (0.12, -0.006, 0.075), (0.190, -0.004, 0.048)], 0.0026, M_CABLE)
pipe("Cable_B", [( 0.110, 0, 0), ( 0.135, -0.004, 0.028), ( 0.170, -0.004, 0.058), (0.198, -0.003, 0.048)], 0.0026, M_CABLE)
pipe("Cable_Out", [(CX, -0.012, -0.058), (CX, -0.014, -0.080), (CX + 0.04, -0.014, -0.095), (CX + 0.11, -0.014, -0.095)], 0.0030, M_CABLE)

# ---------------- 导出 GLB ----------------
glb = os.path.join(OUT_DIR, "flowmeter.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=True, export_yup=True)
print("GLB:", glb, os.path.getsize(glb), "bytes")

# ---------------- 预览渲染 ----------------
if "--no-render" not in sys.argv:
    world = bpy.data.worlds.new("W"); scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.92, 0.93, 0.95, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
    bpy.ops.object.light_add(type='AREA', location=(-0.2, -0.45, 0.45))
    lt = bpy.context.active_object; lt.data.energy = 60; lt.data.size = 0.5
    lt.rotation_euler = (math.radians(50), 0, math.radians(-20))
    bpy.ops.object.camera_add(location=(0.02, -0.66, 0.24))
    cam = bpy.context.active_object; scene.camera = cam
    target = Vector((0.02, 0, -0.03))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.render.resolution_x, scene.render.resolution_y = 1000, 620
    scene.render.filepath = os.path.join(OUT_DIR, "preview.png")
    bpy.ops.render.render(write_still=True)
    print("PNG:", scene.render.filepath)
