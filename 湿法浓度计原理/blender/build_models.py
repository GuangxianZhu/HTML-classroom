"""
浓度计教学模型 —— Blender 脚本建模（bpy 5.x）
运行：python build_models.py [模型名 ...] [--no-render]        （pip install bpy 后直接跑）
   或：blender -b --factory-startup -P build_models.py -- [模型名 ...] [--no-render]
（不带模型名 = 全部 9 个）
输出：../site/models/<name>.glb   ../site/img/<name>.png
每个零件都带自定义属性 label（中文名）+ desc（一句话说明），导出到 glTF extras，网页里悬停显示。
所有模型都是原理示意，不对应任何厂商的真实产品。
"""
import bpy, math, sys, os
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_GLB = os.path.join(HERE, "..", "site", "models")
OUT_IMG = os.path.join(HERE, "..", "site", "img")
os.makedirs(OUT_GLB, exist_ok=True); os.makedirs(OUT_IMG, exist_ok=True)
RENDER = "--no-render" not in sys.argv
FRAMES = 48

# ---------------------------------------------------------------- 基础工具
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, FRAMES
    sc.render.fps = 24

_mats = {}
def mat(name, color=(0.8, 0.8, 0.8), metal=0.0, rough=0.5, alpha=1.0,
        trans=0.0, emit=None, emit_s=3.0, ior=1.45):
    key = name
    if key in _mats and _mats[key].name in bpy.data.materials:
        return _mats[key]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    b.inputs["Alpha"].default_value = alpha
    b.inputs["IOR"].default_value = ior
    if trans:
        b.inputs["Transmission Weight"].default_value = trans
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_s
    m.diffuse_color = (*color, alpha)
    _mats[key] = m
    return m

def M():
    """常用材质（每个场景重新创建）"""
    _mats.clear()
    return dict(
        pfa=mat("PFA", (0.93, 0.93, 0.9), rough=0.45, alpha=0.32),
        pfa_solid=mat("PFA_solid", (0.92, 0.92, 0.88), rough=0.5),
        liq=mat("药液", (0.25, 0.55, 0.95), rough=0.1, alpha=0.45),
        quartz=mat("石英", (0.85, 0.95, 1.0), rough=0.03, trans=1.0, alpha=0.5, ior=1.46),
        sapphire=mat("蓝宝石", (0.6, 0.8, 1.0), rough=0.02, trans=1.0, alpha=0.6, ior=1.77),
        steel=mat("不锈钢", (0.75, 0.76, 0.78), metal=1.0, rough=0.28),
        shell=mat("外壳(半透明示意)", (0.55, 0.6, 0.65), rough=0.4, alpha=0.18),
        black=mat("黑色树脂", (0.04, 0.04, 0.05), rough=0.5),
        gray=mat("灰色外壳", (0.45, 0.48, 0.52), rough=0.45),
        copper=mat("铜线圈", (0.95, 0.52, 0.28), metal=1.0, rough=0.3),
        ferrite=mat("铁氧体芯", (0.15, 0.15, 0.17), rough=0.6),
        pcb=mat("电路板", (0.05, 0.4, 0.15), rough=0.5),
        piezo=mat("压电陶瓷", (0.9, 0.75, 0.42), metal=0.6, rough=0.3),
        screen=mat("显示屏", (0.05, 0.2, 0.1), emit=(0.2, 1.0, 0.5), emit_s=2.0),
        warm=mat("光(可见/近红外示意)", (1, 0.85, 0.5), emit=(1.0, 0.8, 0.45), emit_s=6, alpha=0.75),
        uv=mat("光(紫外254nm示意)", (0.6, 0.3, 1.0), emit=(0.65, 0.35, 1.0), emit_s=6, alpha=0.75),
        amber=mat("LED光", (1, 0.6, 0.1), emit=(1.0, 0.55, 0.1), emit_s=6),
        cyan=mat("信号(示意)", (0.2, 0.9, 1), emit=(0.2, 0.9, 1.0), emit_s=5),
        red=mat("正离子(示意)", (1, 0.2, 0.2), emit=(1, 0.2, 0.2), emit_s=2),
        blue=mat("负离子(示意)", (0.2, 0.4, 1), emit=(0.2, 0.4, 1), emit_s=2),
        dark=mat("暗区", (0.02, 0.02, 0.03), rough=0.6),
        bright=mat("亮区", (1, 0.9, 0.4), emit=(1, 0.85, 0.3), emit_s=4),
        pink=mat("滴定液", (0.95, 0.35, 0.6), rough=0.1, alpha=0.6),
        membrane=mat("透气膜", (1.0, 0.6, 0.2), rough=0.3, alpha=0.6),
        electrolyte=mat("内部电解液", (0.6, 1.0, 0.7), rough=0.1, alpha=0.3),
        platinum=mat("铂电极", (0.85, 0.85, 0.82), metal=1.0, rough=0.15),
        silver=mat("银电极", (0.95, 0.95, 0.97), metal=1.0, rough=0.2),
        white=mat("气体分子(示意)", (1, 1, 1), emit=(1, 1, 1), emit_s=2),
        peek=mat("PEEK绝缘体", (0.75, 0.6, 0.4), rough=0.5),
        glass=mat("玻璃", (0.9, 0.97, 1.0), rough=0.03, trans=1.0, alpha=0.35),
    )

def _link(o):
    bpy.context.scene.collection.objects.link(o)
    return o

def tag(o, label, desc=""):
    o["label"] = label
    if desc:
        o["desc"] = desc
    return o

def _finish(o, m, label, desc, smooth=True):
    if m is not None:
        o.data.materials.append(m)
    if smooth and o.type == "MESH":
        for p in o.data.polygons:
            p.use_smooth = True
    if label:
        tag(o, label, desc)
    return o

def _rot_axis(axis):
    return {"X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0), "Z": (0, 0, 0)}[axis]

def cyl(name, r, depth, loc=(0, 0, 0), axis="Z", m=None, label="", desc="", verts=48, rot=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc,
                                        rotation=rot if rot else _rot_axis(axis))
    o = bpy.context.active_object; o.name = name
    return _finish(o, m, label, desc)

def box(name, size, loc=(0, 0, 0), m=None, label="", desc="", rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object; o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return _finish(o, m, label, desc, smooth=False)

def sphere(name, r, loc=(0, 0, 0), m=None, label="", desc=""):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=24, ring_count=12)
    o = bpy.context.active_object; o.name = name
    return _finish(o, m, label, desc)

def torus(name, R, r, loc=(0, 0, 0), axis="Z", m=None, label="", desc="", seg=(48, 16)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc,
                                     rotation=_rot_axis(axis), major_segments=seg[0], minor_segments=seg[1])
    o = bpy.context.active_object; o.name = name
    return _finish(o, m, label, desc)

def tube(name, pts, r, m=None, label="", desc="", closed=False, res=4):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"; cu.bevel_depth = r; cu.bevel_resolution = res
    cu.use_fill_caps = not closed
    sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    sp.use_cyclic_u = closed
    o = _link(bpy.data.objects.new(name, cu))
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    return _finish(o, m, label, desc)

def rod(name, a, b, r, m=None, label="", desc="", verts=16):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length, location=(a + b) / 2)
    o = bpy.context.active_object; o.name = name
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return _finish(o, m, label, desc)

def prism(name, tri, z0, z1, m=None, label="", desc=""):
    """XY 平面三角形沿 Z 拉伸"""
    me = bpy.data.meshes.new(name)
    v = [(x, y, z0) for x, y in tri] + [(x, y, z1) for x, y in tri]
    f = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    me.from_pydata(v, [], f); me.update()
    o = _link(bpy.data.objects.new(name, me))
    return _finish(o, m, label, desc, smooth=False)

def empty(name, loc=(0, 0, 0)):
    e = _link(bpy.data.objects.new(name, None))
    e.location = loc
    return e

def parent(child, par):
    mw = child.matrix_world.copy()
    child.parent = par
    child.matrix_world = mw

def pipe_x(name, x0, x1, R, z=0, y=0, k=None, liquid=True, wall=0.025, label="配管（PFA，半透明示意）"):
    L = x1 - x0; c = ((x0 + x1) / 2, y, z)
    p = cyl(name, R, L, c, "X", k["pfa"], label, "耐腐蚀氟树脂配管，药液在里面流动")
    if liquid:
        cyl(name + "_液", R - wall, L - 0.002, c, "X", k["liq"], "药液", "被测的药液（颜色为示意）")
    return p

def transmitter(name, loc, k, w=0.5, h=0.36, d=0.18):
    b = box(name, (w, d, h), loc, k["gray"], "变送器 / 显示单元",
            "把传感器信号换算成浓度并输出 4–20 mA 等信号给设备控制器")
    box(name + "_屏", (w * 0.7, 0.01, h * 0.45), (loc[0], loc[1] - d / 2 - 0.006, loc[2] + h * 0.12),
        k["screen"], "浓度显示", "显示换算后的浓度（如 wt%）")
    return b

def cable(name, pts, k):
    return tube(name, pts, 0.015, k["black"], "信号电缆", "")

def key_path(o, pts_fn, frames=FRAMES, prop="location"):
    """每帧打关键帧（避免依赖插值 API），glTF 导出为动画"""
    for f in range(1, frames + 1):
        t = (f - 1) / frames
        val = pts_fn(t)
        if prop == "location":
            o.location = val
        elif prop == "rotation":
            o.rotation_euler = val
        elif prop == "scale":
            o.scale = val
        o.keyframe_insert(data_path={"location": "location", "rotation": "rotation_euler", "scale": "scale"}[prop], frame=f)

# ---------------------------------------------------------------- 渲染 & 导出
def setup_render(view=(1.0, -1.5, 0.75), lens=50, margin=1.75):
    sc = bpy.context.scene
    objs = [o for o in sc.objects if o.type == "MESH"]
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    ctr = (mn + mx) / 2; size = (mx - mn).length
    tgt = empty("cam_target", ctr)
    cd = bpy.data.cameras.new("cam"); cd.lens = lens
    cam = _link(bpy.data.objects.new("Camera", cd))
    dist = size * margin * (50 / lens) * 1.05
    cam.location = ctr + Vector(view).normalized() * dist
    c = cam.constraints.new("TRACK_TO"); c.target = tgt
    c.track_axis = "TRACK_NEGATIVE_Z"; c.up_axis = "UP_Y"
    sc.camera = cam
    # 迭代调整距离，让包围盒刚好占画面约 88 %
    from bpy_extras.object_utils import world_to_camera_view
    sc.render.resolution_x, sc.render.resolution_y = 1000, 640
    corners = [Vector((x, y, z)) for x in (mn.x, mx.x) for y in (mn.y, mx.y) for z in (mn.z, mx.z)]
    for _ in range(6):
        bpy.context.view_layer.update()
        pts = [world_to_camera_view(sc, cam, c) for c in corners]
        dev = max(max(abs(p.x - 0.5), abs(p.y - 0.5)) for p in pts)
        cam.location = ctr + (cam.location - ctr) * (dev / 0.44)
    for nm, loc, e, s in [("key", (3, -4, 5), 900, 4), ("fill", (-4, -2, 2), 300, 5), ("rim", (0, 5, 3), 400, 4)]:
        ld = bpy.data.lights.new(nm, "AREA"); ld.energy = e * size ** 2 / 30; ld.size = s
        lo = _link(bpy.data.objects.new(nm, ld)); lo.location = ctr + Vector(loc) * size / 2
        cc = lo.constraints.new("TRACK_TO"); cc.target = tgt
    w = bpy.data.worlds.new("w"); sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.85, 0.88, 0.92, 1); bg.inputs[1].default_value = 0.45
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"; sc.cycles.samples = 40; sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8; sc.cycles.transparent_max_bounces = 16
    sc.render.resolution_x, sc.render.resolution_y = 1000, 640
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    return cam, tgt

def export(name, view=(1.0, -1.5, 0.75), frame=1):
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.context.scene.objects:
        if o.type in ("MESH", "EMPTY") and o.name != "cam_target":
            o.select_set(True)
    bpy.context.scene.frame_set(1)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_GLB, name + ".glb"), export_format="GLB",
                              use_selection=True, export_extras=True, export_animations=True,
                              export_yup=True, export_cameras=False, export_lights=False,
                              export_animation_mode="ACTIONS", export_force_sampling=True)
    if RENDER:
        setup_render(view)
        bpy.context.scene.frame_set(frame)
        bpy.context.scene.render.filepath = os.path.join(OUT_IMG, name + ".png")
        bpy.ops.render.render(write_still=True)
    print("OK", name)

# ================================================================ 1 吸光光度式
def m_absorb():
    reset(); k = M()
    pipe_x("配管L", -1.3, -0.25, 0.1, k=k); pipe_x("配管R", 0.25, 1.3, 0.1, k=k)
    box("流通池", (0.5, 0.5, 0.5), (0, 0, 0), k["pfa"], "流通池（PTFE，半透明示意）",
        "药液从这里流过，光从两侧石英窗穿过液体")
    cyl("流通池_液", 0.085, 0.5, (0, 0, 0), "X", k["liq"], "药液", "光穿过的这一段液体厚度 = 光程长 L")
    for s, nm in [(-1, "入射窗"), (1, "出射窗")]:
        cyl(nm, 0.11, 0.04, (0, s * 0.25, 0), "Y", k["quartz"], f"石英{nm}",
            "石英在紫外–近红外都透明，又耐大多数药液（但不耐 HF，HF 用蓝宝石等）")
    # 光源
    box("光源外壳", (0.36, 0.4, 0.36), (0, -0.72, 0), k["shell"], "光源单元外壳（半透明示意）", "")
    sphere("卤素灯", 0.06, (0, -0.82, 0), k["warm"], "光源（卤素灯）", "发出从可见到近红外的连续光谱")
    cyl("准直透镜", 0.09, 0.03, (0, -0.58, 0), "Y", k["quartz"], "准直透镜", "把光变成平行光束")
    cyl("光束", 0.02, 1.92, (0, 0.14, 0), "Y", k["warm"], "光束", "穿过药液时，特定波长被吸收、变暗")
    # 分光器
    box("分光器外壳", (0.62, 0.66, 0.42), (0, 0.95, 0), k["shell"], "分光器外壳（半透明示意）", "")
    box("狭缝", (0.2, 0.01, 0.2), (0, 0.66, 0), k["black"], "入射狭缝", "只让一条细光进入分光器")
    g = box("光栅", (0.22, 0.02, 0.22), (0.12, 1.1, 0), k["steel"], "衍射光栅",
            "像棱镜一样把光按波长展开成“彩虹”", rot=(0, 0, math.radians(35)))
    box("检测器阵列", (0.035, 0.5, 0.08), (-0.26, 0.98, 0), k["black"], "检测器阵列（InGaAs 等）",
        "很多个小感光元件，同时测每个波长的强度 → 得到吸收光谱")
    cols = [(1, 0.2, 0.2), (1, 0.6, 0.1), (0.9, 0.9, 0.1), (0.2, 0.9, 0.3), (0.3, 0.5, 1)]
    for i, c in enumerate(cols):
        y = 0.8 + i * 0.09
        cm = mat(f"波长{i}", c, emit=c, emit_s=5, alpha=0.8)
        rod(f"分光光线{i}", (0.1, 1.1, 0), (-0.24, y, 0), 0.008, cm, "按波长分开的光（颜色为示意）",
            "实际是看不见的近红外光，这里用彩色代表不同波长")
    cyl("测温元件", 0.02, 0.3, (0.17, 0, 0.35), "Z", k["steel"], "测温元件",
        "吸收光谱也随温度变化，需要同时测温做补偿")
    ph = sphere("光子", 0.035, (0, -0.82, 0), k["warm"], "光（动画示意）", "")
    key_path(ph, lambda t: (0, -0.82 + 1.9 * t, 0))
    export("absorb", view=(1.2, -1.0, 0.9))

# ================================================================ 2 折射率式
def m_refract():
    reset(); k = M()
    pipe_x("配管", -0.9, 0.9, 0.18, k=k)
    cyl("安装口", 0.2, 0.1, (0, -0.17, 0), "Y", k["pfa"], "侧面安装口", "")
    cyl("传感器外壳", 0.16, 0.75, (0, -0.58, 0), "Y", k["shell"], "传感器外壳（半透明示意）",
        "里面装着棱镜、LED、图像传感器和测温元件")
    prism("测量棱镜", [(-0.13, -0.17), (0.13, -0.17), (0, -0.34)], -0.07, 0.07, k["sapphire"],
          "测量棱镜（蓝宝石）", "棱镜的一个面直接贴着药液。光在这个面上发生全反射还是透过去，取决于药液折射率")
    sphere("LED", 0.025, (-0.08, -0.5, 0), k["amber"], "LED 光源（单色）",
           "折射率随波长变化，所以用单一波长（常见钠D线附近 589 nm）")
    box("图像传感器_亮", (0.06, 0.02, 0.06), (0.03, -0.5, 0), k["bright"], "图像传感器 —— 亮区",
        "入射角大于临界角的光被全反射，打到这里很亮")
    box("图像传感器_暗", (0.06, 0.02, 0.06), (0.09, -0.5, 0), k["dark"], "图像传感器 —— 暗区",
        "入射角小于临界角的光大部分折射进药液，这里变暗。明暗分界线的位置 → 临界角 → 折射率 → 浓度")
    for i, hx in enumerate([-0.05, -0.035, -0.02, -0.005, 0.01]):
        h = (hx, -0.17, 0)
        rod(f"入射光{i}", (-0.08, -0.5, 0), h, 0.004, k["amber"], "入射光", "")
        xo = 2 * hx + 0.08
        if hx < -0.015:
            rod(f"全反射光{i}", h, (xo, -0.5, 0), 0.004, k["amber"], "全反射光（亮）", "")
        else:
            dm = mat("透射光", (1, 0.6, 0.2), emit=(1, 0.55, 0.1), emit_s=1.5, alpha=0.4)
            rod(f"透射光{i}", h, (hx + 0.03 * (i - 2), -0.02, 0), 0.003, dm, "折射进药液的光（暗区来源）", "")
    cyl("测温元件", 0.012, 0.12, (0.1, -0.22, 0), "Y", k["steel"], "测温元件（Pt100）",
        "折射率对温度很敏感（水约 −1×10⁻⁴ /°C），必须温度补偿")
    box("电路板", (0.24, 0.02, 0.18), (0, -0.8, 0), k["pcb"], "信号处理电路板", "")
    cable("电缆", [(0, -0.96, 0), (0, -1.1, 0), (0.75, -1.1, 0), (0.75, -1.1, 0.3)], k)
    transmitter("变送器", (0.75, -1.1, 0.5), k)
    export("refract", view=(-1.3, -1.2, 1.0))

# ================================================================ 3 电磁感应式（无电极）电导率
def m_toroid():
    reset(); k = M()
    a, b = 0.55, 0.28
    loop = [(-a, 0, 0), (-a, 0, -b), (a, 0, -b), (a, 0, 0), (a, 0, b), (-a, 0, b)]
    tube("回路配管", loop, 0.1, k["pfa"], "回路配管（PFA，半透明示意）",
         "药液分成上下两路再汇合，形成一个闭合的“液体环”", closed=True)
    tube("液体环", loop, 0.075, k["liq"], "液体环（药液）",
         "这一圈药液就像变压器里的一匝导线：药液导电性越好，感应电流越大", closed=True)
    pipe_x("入口配管", -1.15, -0.55, 0.1, k=k, label="入口配管")
    pipe_x("出口配管", 0.55, 1.15, 0.1, k=k, label="出口配管")
    for x, nm, d in [(-0.17, "励磁线圈（初级）", "通交流电 → 在液体环里感应出交流电流（像变压器初级）"),
                     (0.17, "检测线圈（次级）", "液体环里的电流又在这个线圈里感应出电压，大小 ∝ 药液电导率")]:
        torus(nm + "_芯", 0.16, 0.045, (x, 0, -b), "X", k["ferrite"], nm, d)
        for j in range(18):
            ang = j / 18 * 2 * math.pi
            cy, cz = 0.16 * math.cos(ang), -b + 0.16 * math.sin(ang)
            o = torus(f"{nm}_绕线{j}", 0.058, 0.009, (x, cy, cz), "Z", k["copper"], nm, d, seg=(16, 6))
            o.rotation_euler = (ang, 0, 0)
    box("线圈护套", (0.75, 0.5, 0.5), (0, 0, -b), k["shell"], "传感器本体（PFA 包覆，半透明示意）",
        "线圈完全被氟树脂包住，不接触药液 → 不会被腐蚀、不会污染")
    cyl("测温元件", 0.015, 0.25, (0.42, 0, b + 0.12), "Z", k["steel"], "测温元件",
        "电导率每升 1 °C 大约增大约 1–2 %，要做温度补偿")
    cable("电缆", [(0, 0, -b + 0.25), (0, 0, 0.75)], k)
    transmitter("变送器", (0, 0, 0.95), k)
    # 动画：沿液体环跑的“离子”
    seg = loop + [loop[0]]
    lens_ = [(Vector(seg[i + 1]) - Vector(seg[i])).length for i in range(len(loop))]
    tot = sum(lens_)
    def at(s):
        s = s % tot
        for i, L in enumerate(lens_):
            if s <= L:
                return Vector(seg[i]).lerp(Vector(seg[i + 1]), s / L)
            s -= L
        return Vector(seg[0])
    for n in range(8):
        o = sphere(f"感应电流{n}", 0.028, (0, 0, 0), k["cyan"], "感应电流（动画示意）",
                   "实际是交流电，来回振荡；这里画成单向流动方便看出“闭合回路”")
        key_path(o, lambda t, n=n: tuple(at(tot * (t + n / 8))))
    export("toroid", view=(0.9, -1.6, 0.8))

# ================================================================ 4 超声波声速式
def m_ultra():
    reset(); k = M()
    pipe_x("配管", -1.0, 1.0, 0.2, k=k)
    for s, nm, d in [(1, "发射探头", "压电陶瓷被电脉冲激励，发出超声波"),
                     (-1, "接收探头", "收到超声波后产生电信号。测“飞行时间”→ 声速 = 距离 / 时间")]:
        cyl(nm + "_壳", 0.11, 0.2, (0, 0, s * 0.31), "Z", k["steel"], nm, d)
        cyl(nm + "_压电", 0.08, 0.02, (0, 0, s * 0.205), "Z", k["piezo"], nm + "（压电元件）", d)
    pl = cyl("超声脉冲", 0.09, 0.012, (0, 0, 0.19), "Z", k["cyan"], "超声波脉冲（动画示意）",
             "在药液里传播的速度取决于药液的密度和“压缩难易程度”，所以随浓度变化")
    key_path(pl, lambda t: (0, 0, 0.19 - 0.38 * t))
    cyl("测温元件", 0.015, 0.3, (0.45, 0, 0.27), "Z", k["steel"], "测温元件（Pt100）",
        "声速随温度变化很明显（水约 +2.5 m/s/°C 量级），必须同时测温")
    cable("电缆1", [(0, 0, 0.41), (0, 0, 0.6), (0, 0.3, 0.75)], k)
    cable("电缆2", [(0, 0, -0.41), (0, 0.35, -0.41), (0, 0.35, 0.6)], k)
    transmitter("变送器", (0, 0.35, 0.85), k)
    export("ultra", view=(1.0, -1.6, 0.6))

# ================================================================ 5 振动式密度计
def m_density():
    reset(); k = M()
    box("固定座", (0.25, 0.5, 0.35), (-0.15, 0, 0), k["steel"], "固定座（大质量）",
        "U 形管的根部固定在这里，只让前端振动")
    piv = empty("振动支点", (0, 0, 0))
    pts = [(0, 0.12, 0), (0.9, 0.12, 0)]
    for i in range(1, 16):
        a = math.pi / 2 - math.pi * i / 16
        pts.append((0.9 + 0.12 * math.cos(a), 0.12 * math.sin(a), 0))
    pts += [(0.9, -0.12, 0), (0, -0.12, 0)]
    ut = tube("U形管", pts, 0.035, k["glass"], "U 形振动管（玻璃）",
              "里面充满药液。药液越重（密度越大），整根管振动得越慢")
    ul = tube("U形管_液", pts, 0.025, k["liq"], "管内药液", "")
    mg = box("磁铁", (0.06, 0.06, 0.04), (1.02, 0, -0.05), k["steel"], "磁铁（随管振动）", "")
    for o in (ut, ul, mg):
        parent(o, piv)
    cyl("励振线圈", 0.05, 0.08, (1.02, 0, -0.14), "Z", k["copper"], "励振 / 检测线圈",
        "电磁力让 U 形管以固有频率振动，同时检测振动频率 f。密度 ρ ≈ A/f² − B")
    for s in (1, -1):
        cyl(f"出入口{s}", 0.035, 0.4, (-0.47, s * 0.12, 0), "X", k["pfa_solid"], "药液出入口", "")
    box("恒温块", (1.35, 0.5, 0.04), (0.45, 0, -0.22), k["gray"], "恒温板（帕尔贴）",
        "把 U 形管保持在恒定温度，消除温度对密度的影响")
    box("外壳", (1.5, 0.6, 0.55), (0.45, 0, 0.02), k["shell"], "外壳（半透明示意）", "")
    key_path(piv, lambda t: (0, math.radians(2.5) * math.sin(2 * math.pi * 3 * t), 0), prop="rotation")
    export("density", view=(0.6, -1.5, 0.9))

# ================================================================ 6 自动滴定
def m_titration():
    reset(); k = M()
    cyl("滴定杯", 0.2, 0.36, (0, 0, 0.18), "Z", k["glass"], "滴定杯",
        "每次从槽里取一小份药液到这里（取样量精确计量）")
    cyl("杯内样品", 0.185, 0.2, (0, 0, 0.11), "Z", k["liq"], "样品 + 稀释用纯水", "")
    sb = box("搅拌子", (0.12, 0.025, 0.025), (0, 0, 0.03), k["pfa_solid"], "磁力搅拌子", "让滴入的试剂快速混匀")
    key_path(sb, lambda t: (0, 0, 2 * math.pi * 2 * t), prop="rotation")
    box("搅拌器底座", (0.55, 0.55, 0.1), (0, 0, -0.06), k["gray"], "磁力搅拌器", "")
    cyl("电极", 0.03, 0.55, (0.09, 0.05, 0.3), "Z", k["glass"], "指示电极（pH / 电位）",
        "滴定时一直监测电位，曲线出现“跳变”处就是终点")
    cyl("电极帽", 0.035, 0.08, (0.09, 0.05, 0.6), "Z", k["black"], "指示电极", "")
    cyl("滴定管", 0.03, 0.75, (-0.08, 0, 0.82), "Z", k["glass"], "滴定管（自动滴定单元）",
        "电机推动活塞，精确地一滴一滴加入已知浓度的试剂（如 NaOH）")
    cyl("滴定管_液", 0.022, 0.6, (-0.08, 0, 0.88), "Z", k["pink"], "标准溶液（已知浓度）", "")
    cyl("滴定管尖", 0.008, 0.15, (-0.08, 0, 0.37), "Z", k["glass"], "滴定尖嘴", "")
    box("活塞泵", (0.22, 0.22, 0.3), (-0.08, 0, 1.33), k["gray"], "活塞泵（步进电机）",
        "记录加了多少体积 → 由化学反应计量关系算出原药液浓度")
    dr = sphere("液滴", 0.018, (-0.08, 0, 0.29), k["pink"], "试剂液滴（动画示意）", "")
    key_path(dr, lambda t: (-0.08, 0, 0.29 - 0.12 * min(1, (t * 1.6) ** 2)))
    tube("取样管", [(-0.9, 0, 0.55), (-0.45, 0, 0.55), (-0.15, 0, 0.45)], 0.015, k["pfa_solid"],
         "取样管（来自处理槽）", "定时从槽或循环管取样")
    box("计量阀", (0.14, 0.12, 0.12), (-0.5, 0, 0.55), k["gray"], "取样计量阀", "")
    tube("排液管", [(0.1, 0, -0.02), (0.1, 0, -0.25), (0.8, 0, -0.25)], 0.015, k["pfa_solid"],
         "排液管", "测完的样品作为废液排出（会消耗药液和试剂）")
    transmitter("控制器", (0.7, 0.2, 0.5), k, w=0.55, h=0.4)
    export("titration", view=(1.1, -1.5, 0.7))

# ================================================================ 7 紫外吸收式溶存臭氧计
def m_ozone():
    reset(); k = M()
    cyl("石英流通池", 0.08, 0.7, (0, 0, 0), "Z", k["quartz"], "石英测量池",
        "臭氧水从下往上流过。紫外光横穿这段水")
    cyl("流通池_液", 0.065, 0.69, (0, 0, 0), "Z", k["liq"], "臭氧水", "")
    cyl("入口", 0.03, 0.3, (0, 0, -0.5), "Z", k["pfa_solid"], "入口（样水）", "")
    cyl("出口", 0.03, 0.3, (0, 0, 0.5), "Z", k["pfa_solid"], "出口", "")
    cyl("低压汞灯", 0.04, 0.4, (-0.55, 0, 0), "Z", k["uv"], "低压汞灯",
        "几乎只发 253.7 nm 这一条强紫外线，正好是臭氧吸收最强的地方")
    box("灯罩", (0.2, 0.25, 0.55), (-0.55, 0, 0), k["shell"], "光源外壳（半透明示意）", "")
    cyl("紫外光束", 0.025, 0.95, (-0.08, 0, 0), "X", k["uv"], "紫外光束（254 nm）",
        "臭氧越多，透过来的紫外光越弱（朗伯–比尔定律）")
    cyl("滤光片", 0.05, 0.015, (0.38, 0, 0), "X", mat("254滤光片", (0.5, 0.2, 0.8), alpha=0.6, rough=0.1),
        "254 nm 带通滤光片", "只让 254 nm 附近的光通过")
    cyl("测量光电二极管", 0.045, 0.06, (0.45, 0, 0), "X", k["black"], "测量用光电二极管", "测透过液体后的光强 I")
    rod("参比光", (-0.5, 0, 0.12), (-0.3, 0, 0.42), 0.012, k["uv"], "参比光路", "")
    cyl("参比光电二极管", 0.04, 0.05, (-0.28, 0, 0.45), "Z", k["black"], "参比光电二极管",
        "直接看灯的亮度 I₀，抵消灯老化、亮度漂移")
    ph = sphere("光子", 0.025, (-0.5, 0, 0), k["uv"], "紫外光（动画示意）", "")
    key_path(ph, lambda t: (-0.5 + 0.95 * t, 0, 0))
    export("ozone", view=(0.9, -1.6, 0.6))

# ================================================================ 8 隔膜电极式溶存气体（H2 / O2）
def m_membrane():
    reset(); k = M()
    box("流通池", (0.7, 0.4, 0.3), (0, 0, -0.15), k["pfa"], "流通池（半透明示意）", "样水在探头下方流过")
    cyl("流通池_液", 0.12, 0.7, (0, 0, -0.15), "X", k["liq"], "样水（纯水 / 氢水 等）", "")
    cyl("探头外壳", 0.1, 0.6, (0, 0, 0.3), "Z", k["shell"], "探头外壳（半透明示意）", "")
    cyl("内部电解液", 0.085, 0.4, (0, 0, 0.2), "Z", k["electrolyte"], "内部电解液", "")
    cyl("透气膜", 0.1, 0.008, (0, 0, -0.004), "Z", k["membrane"], "透气隔膜",
        "只让溶解的气体分子透过，水和离子过不去")
    cyl("工作电极", 0.04, 0.02, (0, 0, 0.02), "Z", k["platinum"], "工作电极（铂）",
        "透过来的气体在这里被氧化（H₂）或还原（O₂），产生电流。电流 ∝ 气体浓度")
    cyl("对电极", 0.07, 0.25, (0, 0, 0.25), "Z", mat("对电极外", (0.95, 0.95, 0.97), metal=1, rough=0.2, alpha=0.5),
        "对电极 / 参比电极（银等）", "")
    cyl("探头顶", 0.1, 0.12, (0, 0, 0.66), "Z", k["black"], "探头接头", "")
    cyl("测温元件", 0.012, 0.3, (0.25, 0, 0.1), "Z", k["steel"], "测温元件", "膜的透气速度随温度变化，需要补偿")
    for n in range(5):
        o = sphere(f"气体分子{n}", 0.014, (0, 0, 0), k["white"], "溶解的气体分子（动画示意）", "")
        x0 = -0.06 + n * 0.03
        key_path(o, lambda t, n=n, x0=x0: (x0, 0, -0.2 + 0.23 * ((t + n / 5) % 1)))
    cable("电缆", [(0, 0, 0.72), (0, 0, 0.9), (0.4, 0, 1.0)], k)
    transmitter("变送器", (0.6, 0, 1.0), k, w=0.4, h=0.3)
    export("membrane", view=(1.0, -1.6, 0.6))

# ================================================================ 9 电极式电导率 / 比电阻计
def m_resist():
    reset(); k = M()
    pipe_x("配管", -0.8, 0.8, 0.16, k=k)
    cyl("三通", 0.17, 0.4, (0, 0, 0.2), "Z", k["pfa"], "三通接头", "")
    cyl("外电极", 0.1, 0.42, (0, 0, -0.02), "Z", mat("外电极", (0.75, 0.76, 0.78), metal=1, rough=0.3, alpha=0.45),
        "外电极（筒形，钛/不锈钢）", "和内电极之间加交流电压，测流过多少电流")
    cyl("内电极", 0.03, 0.42, (0, 0, -0.02), "Z", k["steel"], "内电极（棒）",
        "两电极间的几何形状决定“电池常数”K。电导率 = K × 电导")
    cyl("绝缘体", 0.11, 0.15, (0, 0, 0.27), "Z", k["peek"], "绝缘体（PEEK 等）", "")
    cyl("接头", 0.08, 0.2, (0, 0, 0.45), "Z", k["black"], "接头", "")
    cyl("内置测温", 0.012, 0.06, (0, 0, -0.25), "Z", mat("测温头", (0.9, 0.3, 0.2)), "内置测温元件",
        "超纯水 25 °C 时 18.2 MΩ·cm，温度变 1 °C 读数变化约 5 %，必须补偿到 25 °C")
    for n in range(6):
        ang = n / 6 * 2 * math.pi
        m_ = k["red"] if n % 2 == 0 else k["blue"]
        o = sphere(f"离子{n}", 0.014, (0, 0, 0), m_, "离子（动画示意）",
                   "交流电让离子来回移动 —— 离子越多（越不纯），电流越大、电阻率越低")
        zz = -0.15 + 0.05 * n
        sgn = 1 if n % 2 == 0 else -1
        key_path(o, lambda t, a=ang, zz=zz, s=sgn: (
            (0.065 + 0.025 * s * math.sin(2 * math.pi * 2 * t)) * math.cos(a),
            (0.065 + 0.025 * s * math.sin(2 * math.pi * 2 * t)) * math.sin(a), zz))
    cable("电缆", [(0, 0, 0.55), (0, 0, 0.75), (0.4, 0, 0.85)], k)
    transmitter("变送器", (0.6, 0, 0.9), k, w=0.4, h=0.3)
    export("resist", view=(1.0, -1.6, 0.8))

ALL = dict(absorb=m_absorb, refract=m_refract, toroid=m_toroid, ultra=m_ultra, density=m_density,
           titration=m_titration, ozone=m_ozone, membrane=m_membrane, resist=m_resist)

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    names = [a for a in argv if not a.startswith("-")] or list(ALL)
    for n in names:
        ALL[n]()
