"""
湿法设备液体加热器 / 温调器教学模型 —— Blender 脚本建模（bpy 5.x）
运行：python build_models.py [模型名 ...] [--no-render]        （pip install bpy 后直接跑）
   或：blender -b --factory-startup -P build_models.py -- [模型名 ...] [--no-render]
（不带模型名 = 全部 8 个：immersion wall lamp sheath induction hx peltier system）
输出：../site/models/<name>.glb   ../site/img/<name>.png
每个零件都带自定义属性 label（中文名）+ desc（一句话说明），导出到 glTF extras，网页里悬停显示。
所有模型都是原理示意，尺寸和外形不对应任何厂商的真实产品。
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_GLB = os.path.join(HERE, "..", "site", "models")
OUT_IMG = os.path.join(HERE, "..", "site", "img")
os.makedirs(OUT_GLB, exist_ok=True); os.makedirs(OUT_IMG, exist_ok=True)
RENDER = "--no-render" not in sys.argv
FRAMES = 96          # 24 fps → 4 秒一圈的循环动画
PI = math.pi

# ---------------------------------------------------------------- 基础工具
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, FRAMES
    sc.render.fps = 24

_mats = {}
def mat(name, color=(0.8, 0.8, 0.8), metal=0.0, rough=0.5, alpha=1.0,
        trans=0.0, emit=None, emit_s=3.0, ior=1.45):
    if name in _mats and _mats[name].name in bpy.data.materials:
        return _mats[name]
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
    _mats[name] = m
    return m

def M():
    """常用材质（每个场景重新创建）"""
    _mats.clear()
    return dict(
        quartz=mat("石英", (0.85, 0.95, 1.0), rough=0.03, trans=1.0, alpha=0.35, ior=1.46),
        lampglass=mat("灯管石英", (0.97, 0.96, 0.9), rough=0.05, trans=1.0, alpha=0.4, ior=1.46),
        liq=mat("药液", (0.25, 0.55, 0.95), rough=0.1, alpha=0.32),
        water=mat("纯水", (0.45, 0.78, 1.0), rough=0.1, alpha=0.3),
        pfa=mat("PFA(半透明示意)", (0.93, 0.93, 0.9), rough=0.45, alpha=0.3),
        pfa_solid=mat("PFA实体", (0.92, 0.92, 0.88), rough=0.5),
        pfa_coat=mat("PFA包覆", (0.95, 0.95, 0.92), rough=0.4, alpha=0.55),
        steel=mat("不锈钢", (0.75, 0.76, 0.78), metal=1.0, rough=0.28),
        black=mat("黑色树脂", (0.04, 0.04, 0.05), rough=0.5),
        gray=mat("灰色外壳", (0.45, 0.48, 0.52), rough=0.45),
        copper=mat("铜", (0.95, 0.52, 0.28), metal=1.0, rough=0.3),
        ferrite=mat("铁氧体", (0.15, 0.15, 0.17), rough=0.6),
        screen=mat("显示屏", (0.05, 0.2, 0.1), emit=(0.2, 1.0, 0.5), emit_s=2.0),
        coil=mat("发热丝(发红示意)", (1.0, 0.35, 0.08), emit=(1.0, 0.32, 0.05), emit_s=4),
        glow=mat("钨丝(白炽)", (1, 0.9, 0.6), emit=(1, 0.85, 0.55), emit_s=12),
        ir=mat("红外线(示意)", (1, 0.25, 0.1), emit=(1, 0.2, 0.05), emit_s=5, alpha=0.6),
        gold=mat("镀金反射", (1.0, 0.78, 0.35), metal=1.0, rough=0.15),
        rubber=mat("硅橡胶加热片", (0.85, 0.45, 0.2), rough=0.6, alpha=0.7),
        insul=mat("保温材(半透明示意)", (0.95, 0.95, 0.95), rough=0.9, alpha=0.22),
        mgo=mat("氧化镁", (0.97, 0.97, 0.95), rough=0.95),
        hot=mat("热(示意)", (1, 0.25, 0.15), emit=(1, 0.25, 0.1), emit_s=3),
        cold=mat("冷(示意)", (0.2, 0.5, 1), emit=(0.2, 0.5, 1), emit_s=3),
        field=mat("磁力线(示意)", (0.2, 0.9, 1), emit=(0.2, 0.9, 1), emit_s=3, alpha=0.7),
        eddy=mat("涡电流(示意)", (1, 0.6, 0.1), emit=(1, 0.55, 0.1), emit_s=4),
        cur=mat("电流(示意)", (1, 0.95, 0.3), emit=(1, 0.9, 0.2), emit_s=4),
        ceramic=mat("氧化铝陶瓷", (0.96, 0.96, 0.94), rough=0.5),
        ptype=mat("P型元件", (0.85, 0.35, 0.3), rough=0.4),
        ntype=mat("N型元件", (0.3, 0.45, 0.85), rough=0.4),
        wafer=mat("硅片", (0.42, 0.45, 0.58), metal=0.6, rough=0.2, alpha=0.85),
        tip=mat("测温点", (0.9, 0.15, 0.1), rough=0.4),
        alu=mat("铝", (0.8, 0.82, 0.85), metal=1.0, rough=0.35),
        sic=mat("发热体", (0.2, 0.2, 0.22), metal=0.6, rough=0.4),
        plate=mat("换热板", (0.35, 0.37, 0.4), metal=0.3, rough=0.4),
        shell=mat("壳体(半透明示意)", (0.6, 0.7, 0.8), rough=0.3, alpha=0.18),
        hotpipe=mat("热媒配管", (0.85, 0.4, 0.3), rough=0.4),
        coldpipe=mat("冷却水配管", (0.3, 0.5, 0.85), rough=0.4),
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
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True); bpy.context.view_layer.objects.active = o
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
        except Exception:
            for p in o.data.polygons:
                p.use_smooth = True
    if label:
        tag(o, label, desc)
    return o

def _rot_axis(axis):
    return {"X": (0, PI / 2, 0), "Y": (PI / 2, 0, 0), "Z": (0, 0, 0)}[axis]

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

def sphere(name, r, loc=(0, 0, 0), m=None, label="", desc="", seg=(20, 10)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg[0], ring_count=seg[1])
    o = bpy.context.active_object; o.name = name
    return _finish(o, m, label, desc)

def torus(name, R, r, loc=(0, 0, 0), axis="Z", m=None, label="", desc="", seg=(48, 12)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc,
                                     rotation=_rot_axis(axis), major_segments=seg[0], minor_segments=seg[1])
    o = bpy.context.active_object; o.name = name
    return _finish(o, m, label, desc)

def tube(name, pts, r, m=None, label="", desc="", closed=False, res=3):
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
    if m is not None:
        o.data.materials.append(m)
    for p in o.data.polygons:
        p.use_smooth = True
    if label:
        tag(o, label, desc)
    return o

def rod(name, a, b, r, m=None, label="", desc="", verts=16):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length, location=(a + b) / 2)
    o = bpy.context.active_object; o.name = name
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return _finish(o, m, label, desc)

def _mesh_obj(name, V, F, loc, axis, m, label, desc, smooth=True):
    me = bpy.data.meshes.new(name); me.from_pydata(V, [], F); me.update()
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    o = _link(bpy.data.objects.new(name, me))
    o.location = loc; o.rotation_euler = _rot_axis(axis)
    return _finish(o, m, label, desc, smooth=smooth)

def ring_tube(name, Ro, Ri, L, loc=(0, 0, 0), axis="Z", m=None, label="", desc="",
              a0=0.0, a1=2 * PI, verts=48):
    """空心圆管（可只取一段圆弧）。局部沿 Z，axis 决定朝向。
    axis="X" 时局部角度 φ 对应世界 (y=sinφ, z=-cosφ)。"""
    full = abs((a1 - a0) - 2 * PI) < 1e-6
    n = verts if full else max(3, int(verts * (a1 - a0) / (2 * PI)))
    cnt = n if full else n + 1
    ang = [a0 + (a1 - a0) * i / n for i in range(cnt)]
    V, F = [], []
    def ring(R, z):
        s = len(V)
        V.extend((R * math.cos(a), R * math.sin(a), z) for a in ang)
        return s
    nxt = (lambda i: (i + 1) % cnt) if full else (lambda i: i + 1)
    # 侧面（外 / 内）
    for R in (Ro, Ri):
        b, t = ring(R, -L / 2), ring(R, L / 2)
        for i in range(n):
            F.append((b + i, b + nxt(i), t + nxt(i), t + i))
    # 端面（单独一份顶点，平面不被平滑）
    for z in (-L / 2, L / 2):
        o_, i_ = ring(Ro, z), ring(Ri, z)
        for i in range(n):
            F.append((o_ + i, o_ + nxt(i), i_ + nxt(i), i_ + i))
    if not full:
        for i in (0, n):
            s = len(V); a = ang[i]
            V.extend([(Ro * math.cos(a), Ro * math.sin(a), -L / 2), (Ri * math.cos(a), Ri * math.sin(a), -L / 2),
                      (Ri * math.cos(a), Ri * math.sin(a), L / 2), (Ro * math.cos(a), Ro * math.sin(a), L / 2)])
            F.append((s, s + 1, s + 2, s + 3))
    return _mesh_obj(name, V, F, loc, axis, m, label, desc)

def sector(name, R, thick, a0, a1, loc=(0, 0, 0), axis="Z", m=None, label="", desc="", verts=48):
    """扇形板（折流挡板用）"""
    n = max(3, int(verts * (a1 - a0) / (2 * PI)))
    V, F = [], []
    for z in (-thick / 2, thick / 2):
        V.append((0, 0, z))
        V.extend((R * math.cos(a0 + (a1 - a0) * i / n), R * math.sin(a0 + (a1 - a0) * i / n), z) for i in range(n + 1))
    c0, c1 = 0, n + 2
    for i in range(n):
        F.append((c0, c0 + 1 + i + 1, c0 + 1 + i))
        F.append((c1, c1 + 1 + i, c1 + 1 + i + 1))
        F.append((c0 + 1 + i, c0 + 2 + i, c1 + 2 + i, c1 + 1 + i))
    F.append((c0, c0 + 1, c1 + 1, c1))
    F.append((c0, c1, c1 + 1 + n, c0 + 1 + n))
    return _mesh_obj(name, V, F, loc, axis, m, label, desc)

def boxes_mesh(name, items, m=None, label="", desc=""):
    """很多小方块合成一个网格（珀耳帖元件阵列用）。items = [(center, size), ...]"""
    V, F = [], []
    for (cx, cy, cz), (sx, sy, sz) in items:
        s = len(V)
        for dx in (-1, 1):
            for dy in (-1, 1):
                for dz in (-1, 1):
                    V.append((cx + dx * sx / 2, cy + dy * sy / 2, cz + dz * sz / 2))
        F += [(s, s + 1, s + 3, s + 2), (s + 4, s + 6, s + 7, s + 5), (s, s + 4, s + 5, s + 1),
              (s + 2, s + 3, s + 7, s + 6), (s, s + 2, s + 6, s + 4), (s + 1, s + 5, s + 7, s + 3)]
    return _mesh_obj(name, V, F, (0, 0, 0), "Z", m, label, desc, smooth=False)

def shell_box(name, inner, wall, loc, m, label, desc):
    """开口方槽（底 + 四壁）"""
    sx, sy, sz = inner; x, y, z = loc; t = wall
    box(name + "_底", (sx + 2 * t, sy + 2 * t, t), (x, y, z - sz / 2 - t / 2), m, label, desc)
    box(name + "_左", (t, sy + 2 * t, sz), (x - sx / 2 - t / 2, y, z), m, label, desc)
    box(name + "_右", (t, sy + 2 * t, sz), (x + sx / 2 + t / 2, y, z), m, label, desc)
    box(name + "_前", (sx, t, sz), (x, y - sy / 2 - t / 2, z), m, label, desc)
    box(name + "_后", (sx, t, sz), (x, y + sy / 2 + t / 2, z), m, label, desc)

def helix(name, start, axis, R, turns, length, r_wire, m, label="", desc="", spt=10):
    pts = []
    n = int(turns * spt)
    for i in range(n + 1):
        t = i / n; a = 2 * PI * turns * t; s = length * t
        c, d = R * math.cos(a), R * math.sin(a)
        if axis == "X":
            pts.append((start[0] + s, start[1] + c, start[2] + d))
        elif axis == "Y":
            pts.append((start[0] + c, start[1] + s, start[2] + d))
        else:
            pts.append((start[0] + c, start[1] + d, start[2] + s))
    return tube(name, pts, r_wire, m, label, desc, res=2)

def rounded(pts, r=0.06, n=6):
    """折线拐角改成圆角"""
    P = [Vector(p) for p in pts]; out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d1, d2 = b - a, c - b
        rr = min(r, d1.length / 2, d2.length / 2)
        p0 = b - d1.normalized() * rr; p2 = b + d2.normalized() * rr
        for kk in range(n + 1):
            t = kk / n
            out.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t * t * p2)
    out.append(P[-1])
    return [tuple(v) for v in out]

def empty(name, loc=(0, 0, 0)):
    e = _link(bpy.data.objects.new(name, None))
    e.location = loc
    return e

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

def path_fn(pts, closed=False):
    P = [Vector(p) for p in pts]
    if closed:
        P.append(P[0])
    seg = [(P[i + 1] - P[i]).length for i in range(len(P) - 1)]
    tot = sum(seg)
    def at(s):
        s = (s % 1.0) * tot
        for i, l in enumerate(seg):
            if s <= l or i == len(seg) - 1:
                return tuple(P[i] + (P[i + 1] - P[i]) * (min(s, l) / l if l > 0 else 0))
            s -= l
    return at

def flow(name, pts, n, r, m, label, desc="", closed=False, speed=1):
    """n 个小球沿路径匀速移动（speed 取整数，动画才能无缝循环）"""
    at = path_fn(pts, closed)
    for j in range(n):
        o = sphere(f"{name}{j}", r, (0, 0, 0), m, label, desc, seg=(12, 6))
        key_path(o, lambda t, j=j: at(t * speed + j / n))

def pipe(name, pts, r, k, label="配管（PFA）", desc="", m=None, rr=0.06):
    return tube(name, rounded(pts, rr), r, m or k["pfa_solid"], label, desc)

def sensor(name, top, bottom, k, label, desc, r=0.012):
    rod(name, top, bottom, r, k["pfa_solid"], label, desc)
    sphere(name + "_头", r * 1.25, bottom, k["tip"], label, desc)

# ---------------------------------------------------------------- 渲染 & 导出
def setup_render(view=(1.0, -1.5, 0.75), lens=50):
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
    cam.location = ctr + Vector(view).normalized() * size * 2
    c = cam.constraints.new("TRACK_TO"); c.target = tgt
    c.track_axis = "TRACK_NEGATIVE_Z"; c.up_axis = "UP_Y"
    sc.camera = cam
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
    sc.cycles.device = "CPU"; sc.cycles.samples = 32; sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8; sc.cycles.transparent_max_bounces = 24
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

# ================================================================ 1 槽内浸入式加热器
def m_immersion():
    reset(); k = M()
    W, D, H, t = 1.2, 0.7, 0.9, 0.03
    shell_box("处理槽", (W, D, H), t, (0, 0, H / 2), k["quartz"], "石英处理槽",
              "高纯石英：耐热、几乎不溶出金属；但不耐氢氟酸和热浓碱")
    lv = 0.78
    box("药液", (W - 0.004, D - 0.004, lv), (0, 0, lv / 2), k["liq"], "药液（如热磷酸、SPM）",
        "加热器把热量直接交给它，再靠对流和循环搅匀")
    for i, x in enumerate([-0.18, -0.06, 0.06, 0.18]):
        cyl(f"晶圆{i}", 0.26, 0.006, (x, 0, 0.44), "X", k["wafer"], "晶圆（示意）",
            "批式设备里一整批晶圆竖着泡在药液里")
    for s in (-1, 1):
        cyl(f"晶圆导轨{s}", 0.014, 0.6, (0, s * 0.15, 0.19), "X", k["quartz"], "晶圆导轨（示意）", "")
    zH, yL, xA, xB, top = 0.08, 0.25, -0.5, 0.5, 1.05
    sheath = rounded([(xA, -yL, top), (xA, -yL, zH), (xB, -yL, zH), (xB, yL, zH), (xA, yL, zH), (xA, yL, top)], 0.09)
    tube("石英护套", sheath, 0.036, k["quartz"], "石英护套管",
         "发热丝封在石英管里，药液只碰到石英。石英管是绝缘层，也是防污染层")
    for s in (-1, 1):
        helix(f"发热丝{s}", (-0.42, s * yL, zH), "X", 0.019, 34, 0.84, 0.0035, k["coil"], "发热段（螺旋发热丝）",
              "只有这一段发热。必须整段泡在液面以下——露出液面就会“空烧”，表面温度一下子冲上去")
        tube(f"引线{s}", rounded([(xA, s * yL, top), (xA, s * yL, zH), (-0.42, s * yL, zH)], 0.06), 0.005,
             k["steel"], "引线（非发热段）", "穿过液面的这一段故意不发热，避免液面附近和液面以上局部过热")
    tube("弯头引线", rounded([(0.42, -yL, zH), (xB, -yL, zH), (xB, yL, zH), (0.42, yL, zH)], 0.08), 0.005,
         k["steel"], "引线（非发热段）", "")
    box("端子盒", (0.14, 0.62, 0.1), (xA, 0, top + 0.05), k["gray"], "端子盒（在液面上方）",
        "接电源线的地方，放在槽外上方，远离药液和蒸汽")
    tube("电源线", rounded([(xA, 0, top + 0.1), (xA, 0, top + 0.22), (xA - 0.3, 0, top + 0.3)], 0.06), 0.015,
         k["black"], "电源线", "")
    sphere("过升温热电偶", 0.013, (0.0, -yL, zH + 0.022), k["tip"], "过升温保护用测温点（发热段旁）",
           "测加热器自己的温度。超过上限由独立的保护回路直接断电，不经过控温程序")
    sensor("控温传感器", (0.4, 0.05, 1.02), (0.4, 0.05, 0.25), k, "控温用温度传感器",
           "热电偶或铂电阻装在 PFA / 石英保护管里，把药液温度送给温度调节器")
    rod("液位导杆", (0.4, 0.27, 1.02), (0.4, 0.27, 0.3), 0.009, k["pfa_solid"], "液位传感器（浮子式示意）",
        "液位低于发热段 → 立刻切断加热（防空烧）")
    fl = torus("浮子", 0.032, 0.012, (0.4, 0.27, lv), "Z", k["pfa_solid"], "液位传感器（浮子式示意）",
               "液位低于发热段 → 立刻切断加热（防空烧）")
    key_path(fl, lambda t: (0.4, 0.27, lv + 0.008 * math.sin(2 * PI * 2 * t)))
    for x in (-0.36, 0.33):
        for s in (-1, 1):
            loop = [(x, s * 0.25, 0.13), (x, s * 0.29, 0.7), (x, s * 0.05, 0.74), (x, s * 0.02, 0.2), (x, s * 0.2, 0.11)]
            flow(f"对流{x}{s}", loop, 4, 0.014, k["hot"], "热对流（动画示意）",
                 "被加热的药液变轻上浮，凉的沉下来补位——加上循环泵，槽里温度才会均匀", closed=True)
    export("immersion", view=(1.0, -1.5, 0.95))

# ================================================================ 2 槽外贴壁式（面状加热器）
def m_wall():
    reset(); k = M()
    W, D, H, t = 1.0, 0.6, 0.7, 0.04
    shell_box("石英槽", (W, D, H), t, (0, 0, H / 2), k["quartz"], "石英槽壁（热要先穿过它）",
              "石英导热差（约 1.4 W/m·K，大约是不锈钢的十分之一）。壁越厚，加热器就得比药液热得越多")
    lv = 0.6
    box("药液", (W - 0.004, D - 0.004, lv), (0, 0, lv / 2), k["liq"], "药液", "热量穿过槽壁才进到这里")
    ht = 0.014
    zb = -t - ht / 2
    yb = D / 2 + t + ht / 2
    xl = -(W / 2 + t + ht / 2)
    hh = H * 0.85
    box("底面加热器", (W + 2 * t, D + 2 * t, ht), (0, 0, zb), k["rubber"], "底面加热器（面状）",
        "电阻箔或电阻丝夹在硅橡胶 / 云母 / 聚酰亚胺等绝缘片里，整片贴在槽外")
    box("背面加热器", (W, ht, hh), (0, yb, hh / 2), k["rubber"], "侧面加热器（面状）",
        "和底面一样是薄片状。贴得越紧、空气层越少，传热越好")
    box("左面加热器", (ht, D, hh), (xl, 0, hh / 2), k["rubber"], "侧面加热器（面状）", "")
    pts = []
    for i in range(9):
        x = -0.44 + i * 0.11
        zs = (0.05, hh - 0.05) if i % 2 == 0 else (hh - 0.05, 0.05)
        pts += [(x, yb, zs[0]), (x, yb, zs[1])]
    tube("背面线路", rounded(pts, 0.03), 0.004, k["coil"], "电阻线路（蛇形）",
         "线路排得越均匀，槽壁各处温度越均匀，没有局部热点")
    pts = []
    for i in range(6):
        y = -0.25 + i * 0.1
        zs = (0.05, hh - 0.05) if i % 2 == 0 else (hh - 0.05, 0.05)
        pts += [(xl, y, zs[0]), (xl, y, zs[1])]
    tube("左面线路", rounded(pts, 0.03), 0.004, k["coil"], "电阻线路（蛇形）", "")
    pts = []
    for i in range(7):
        y = -0.3 + i * 0.1
        xs = (-0.48, 0.48) if i % 2 == 0 else (0.48, -0.48)
        pts += [(xs[0], y, zb), (xs[1], y, zb)]
    tube("底面线路", rounded(pts, 0.03), 0.004, k["coil"], "电阻线路（蛇形）", "")
    box("保温层背", (W + 0.12, 0.06, H * 0.92), (0, yb + ht / 2 + 0.03, H * 0.46), k["insul"], "保温层",
        "让热只往槽里走，不往外跑；也让外壳摸起来不烫")
    box("保温层左", (0.06, D + 0.12, H * 0.92), (xl - ht / 2 - 0.03, 0, H * 0.46), k["insul"], "保温层", "")
    box("保温层底", (W + 0.2, D + 0.2, 0.06), (0, 0, zb - ht / 2 - 0.03), k["insul"], "保温层", "")
    sensor("液温传感器", (0.3, -0.12, 0.85), (0.3, -0.12, 0.15), k, "控温用液温传感器", "控的是药液温度，不是加热器温度")
    box("表面传感器", (0.06, 0.016, 0.04), (0.25, yb + ht / 2 + 0.008, 0.3), k["tip"], "加热器表面温度传感器（过热保护）",
        "槽壁导热慢，加热器表面会比药液热很多。这个点超温就切断，防止加热片烧坏、槽壁热应力开裂")
    cyl("温度保险丝", 0.012, 0.07, (-0.25, yb + ht / 2 + 0.014, 0.3), "X", k["black"], "温度保险丝（最后一道保险）",
        "超过额定温度就熔断、永久断开，不会自己恢复——控温和保护回路都失灵时兜底")
    for i, x in enumerate((-0.3, 0.0, 0.3)):
        flow(f"背面热流{i}", [(x, 0.28, 0.2 + 0.1 * i), (x, 0.12, 0.3 + 0.08 * i), (x, 0.0, 0.55)], 3, 0.013,
             k["hot"], "热量从槽壁进入药液（动画示意）", "")
    for i, (x, y) in enumerate(((-0.25, -0.1), (0.15, 0.1), (0.35, -0.2))):
        flow(f"底面热流{i}", [(x, y, 0.02), (x, y, 0.3), (x + 0.05, y, 0.56)], 3, 0.013,
             k["hot"], "热量从槽底进入药液（动画示意）", "")
    export("wall", view=(1.0, -1.35, 0.9))

# ================================================================ 3 管道式：红外灯管加热
def m_lamp():
    reset(); k = M()
    Lo = 1.4
    ring_tube("外石英管", 0.11, 0.1, Lo, (0, 0, 0), "X", k["quartz"], "外石英管",
              "纯水在内外两层石英管之间的环形缝隙里流过")
    ring_tube("内石英管", 0.052, 0.045, 1.62, (0, 0, 0), "X", k["quartz"], "内石英管（灯管套）",
              "把灯和水隔开：灯在干燥空气里，水只碰到石英")
    ring_tube("纯水", 0.1, 0.053, Lo - 0.02, (0, 0, 0), "X", k["water"], "纯水（环形流道）",
              "红外线穿过石英几乎不损失，进了水就被吸收、变成热")
    cyl("灯玻壳", 0.024, 1.8, (0, 0, 0), "X", k["lampglass"], "卤素灯玻壳（石英）",
        "灯管里充卤素气体，让蒸发的钨回到灯丝上，灯丝可以烧得更热、更长寿")
    helix("钨丝", (-0.62, 0, 0), "X", 0.009, 90, 1.24, 0.0022, k["glow"], "钨丝（约 2500–3000 K）",
          "通电热到白炽，主要发出近红外线。灯丝热容量很小，所以开关几乎是瞬时的", spt=7)
    for s in (-1, 1):
        box(f"封接部{s}", (0.1, 0.05, 0.012), (s * 0.95, 0, 0), k["lampglass"], "灯管两端封接部",
            "电流经很薄的钼箔穿出石英。这里太热会氧化损坏，所以灯两端要通风冷却")
        rod(f"灯引线{s}", (s * 0.62, 0, 0), (s * 1.0, 0, 0), 0.003, k["steel"], "灯丝引线", "")
        ring_tube(f"端盖{s}", 0.135, 0.053, 0.08, (s * (Lo / 2 + 0.03), 0, 0), "X", k["pfa_solid"], "端盖（密封水路）",
                  "用 O 形圈 / 氟树脂件把内外两层石英管之间密封起来")
        box(f"冷却风扇{s}", (0.08, 0.22, 0.22), (s * 1.08, 0, 0), k["gray"], "灯管端部冷却风扇", "给两端封接部吹风降温")
    pipe("入口管", [(-0.55, 0, -0.1), (-0.55, 0, -0.32), (-0.85, 0, -0.32)], 0.028, k, "入口（常温纯水）", "")
    pipe("出口管", [(0.55, 0, 0.1), (0.55, 0, 0.32), (0.85, 0, 0.32)], 0.028, k, "出口（热纯水，如 80 °C 左右）",
         "设备要的通常是出口温度稳定，所以控温传感器装在出口")
    sensor("出口温度传感器", (0.72, -0.16, 0.32), (0.72, -0.02, 0.32), k, "出口温度传感器（控温用）",
           "温度调节器根据它调节灯的功率")
    ring_tube("反射罩", 0.17, 0.16, 1.36, (0, 0, 0), "X", k["gold"], "反射罩（镀金示意）",
              "没被水吸收、穿出去的红外线被反射回来再过一次水，提高效率；也挡住热辐射", a0=0, a1=PI)
    for s in (-1, 1):
        box(f"支架{s}", (0.08, 0.36, 0.05), (s * 0.3, 0.02, -0.2), k["steel"], "支架", "")
    for i in range(11):
        x = -0.55 + i * 0.11; a = i * 2.2
        rod(f"红外线{i}", (x, 0.03 * math.cos(a), 0.03 * math.sin(a)), (x, 0.098 * math.cos(a), 0.098 * math.sin(a)),
            0.004, k["ir"], "红外线（示意）", "短波红外在水里要走一段距离才被吃完，所以水层要有一定厚度、外面加反射")
    hp = []
    for i in range(61):
        tt = i / 60; x = -0.55 + 1.1 * tt; a = 8 * PI * tt
        hp.append((x, 0.077 * math.cos(a), 0.077 * math.sin(a)))
    flow("水流", hp, 10, 0.013, k["cold"], "纯水流动（动画示意）", "边流边被加热，出口最热")
    export("lamp", view=(0.55, -1.6, 0.7))

# ================================================================ 4 管道式：氟树脂包覆电阻加热棒
def m_sheath():
    reset(); k = M()
    Hh = 1.0
    ring_tube("容器", 0.3, 0.27, Hh, (0, 0, Hh / 2), "Z", k["pfa"], "加热容器（氟树脂，半透明示意）",
              "药液从下往上流，绕过挡板，和加热棒充分接触")
    cyl("容器底", 0.3, 0.03, (0, 0, -0.015), "Z", k["pfa_solid"], "容器底", "")
    cyl("法兰", 0.33, 0.06, (0, 0, Hh + 0.03), "Z", k["pfa_solid"], "顶部法兰（加热棒从这里插入）", "")
    cyl("药液", 0.268, 0.97, (0, 0, 0.485), "Z", k["liq"], "药液", "")
    for i in range(4):
        a = PI / 4 + i * PI / 2; x, y = 0.15 * math.cos(a), 0.15 * math.sin(a)
        cyl(f"包覆{i}", 0.04, 0.86, (x, y, 0.57), "Z", k["pfa_coat"], "PFA 包覆层（只有它接触药液）",
            "氟树脂几乎什么酸碱都不怕，但导热很差（约 0.2 W/m·K）、耐温上限约 260 °C")
        cyl(f"护套{i}", 0.03, 0.86, (x, y, 0.57), "Z", k["steel"], "金属护套加热棒",
            "里面是发热丝 + 氧化镁绝缘粉，外面套一层氟树脂")
        sphere(f"棒端{i}", 0.04, (x, y, 0.14), k["pfa_coat"], "PFA 包覆层（只有它接触药液）", "")
    for i, z in enumerate((0.3, 0.55, 0.8)):
        a0, a1 = ((PI / 3, 5 * PI / 3) if i % 2 == 0 else (-2 * PI / 3, 2 * PI / 3))
        sector(f"挡板{i}", 0.266, 0.02, a0, a1, (0, 0, z), "Z", k["pfa_solid"], "折流挡板",
               "逼着药液左右来回走，流速更快、和加热棒贴得更近 → 换热更好，也不容易有死区")
    pipe("入口", [(-0.55, 0, 0.1), (-0.27, 0, 0.1)], 0.035, k, "药液入口", "")
    pipe("出口", [(0.27, 0, 0.9), (0.55, 0, 0.9)], 0.035, k, "药液出口", "")
    sensor("出口测温", (0, 0, 1.12), (0, 0, 0.45), k, "温度传感器（保护管内）", "")
    box("端子盒", (0.5, 0.5, 0.14), (0, 0, Hh + 0.13), k["gray"], "端子盒", "")
    tube("电源线", rounded([(0.25, 0, Hh + 0.15), (0.5, 0, Hh + 0.2), (0.7, 0, Hh + 0.35)]), 0.015, k["black"], "电源线", "")
    # 旁边放一根“层层剥开”的放大剖面
    y0, z0, x0 = -0.05, 0.45, 0.48
    cyl("剖_包覆", 0.07, 0.34, (x0 + 0.17, y0, z0), "X", k["pfa_coat"], "① PFA 包覆层（放大剖开示意）",
        "接触药液的唯一一层。太厚 → 隔热，里面更烫；太薄 → 容易有针孔，药液渗进去腐蚀金属")
    cyl("剖_护套", 0.055, 0.5, (x0 + 0.25, y0, z0), "X", k["steel"], "② 金属护套（放大剖开示意）", "不锈钢、钛等，导热好、结实")
    cyl("剖_氧化镁", 0.045, 0.66, (x0 + 0.33, y0, z0), "X", k["mgo"], "③ 氧化镁绝缘粉（放大剖开示意）",
        "导热还行又绝缘，让发热丝和护套不短路")
    helix("剖_发热丝", (x0, y0, z0), "X", 0.022, 26, 0.82, 0.006, k["coil"], "④ 镍铬发热丝（放大剖开示意）",
          "电流流过它，按 P = I²R 发热")
    zig = [(-0.25, 0.0, 0.1), (0.2, 0.0, 0.2), (0.22, 0.0, 0.42), (-0.2, 0.0, 0.45), (-0.22, 0.0, 0.67),
           (0.2, 0.0, 0.7), (0.22, 0.0, 0.88), (0.27, 0.0, 0.9)]
    flow("药液流", zig, 9, 0.014, k["cold"], "药液流向（动画示意）", "")
    export("sheath", view=(0.95, -1.5, 0.65))

# ================================================================ 5 管道式：感应加热（IH）
def m_induction():
    reset(); k = M()
    L = 1.4
    ring_tube("外管", 0.14, 0.125, L, (0, 0, 0), "X", k["pfa"], "氟树脂外管（非磁性、不导电）",
              "交变磁场可以穿过它，它自己不发热——所以外表面温度不会超过管内流体")
    cyl("药液", 0.123, L - 0.02, (0, 0, 0), "X", k["liq"], "药液", "从发热体内外两侧流过")
    ring_tube("发热体", 0.085, 0.07, 1.1, (0, 0, 0), "X", k["sic"], "发热体（导电材料）",
              "交变磁场在它里面感应出涡电流，它自己发热。公开专利里有让流体直接流过不锈钢薄板 / 导电管的，也有把碳发热体包上绝缘层的")
    ring_tube("发热体包覆", 0.093, 0.062, 1.14, (0, 0, 0), "X", k["pfa_coat"], "发热体外的包覆层（有的设计没有）",
              "对腐蚀性药液，包起来可以避免金属溶出；代价是多一层热阻（示意）")
    helix("感应线圈", (-0.55, 0, 0), "X", 0.185, 9, 1.1, 0.02, k["copper"], "感应线圈（铜管）",
          "通几十 kHz 量级的交流电，产生交变磁场。线圈在管外，不接触药液；铜管里一般通冷却水")
    for i in range(4):
        a = i * PI / 2
        box(f"磁芯{i}", (1.24, 0.05, 0.05), (0, 0.26 * math.cos(a), 0.26 * math.sin(a)), k["ferrite"], "铁氧体磁芯",
            "给磁力线一条好走的回路：磁场更集中在发热体上，也不容易漏到外面干扰别的设备")
    box("逆变电源", (0.5, 0.3, 0.3), (0, 0.7, 0.0), k["gray"], "高频逆变电源",
        "把工频交流变成高频交流；调频率或占空比就能调加热功率")
    for i in range(5):
        box(f"散热片{i}", (0.02, 0.3, 0.22), (-0.2 + i * 0.1, 0.7, 0.26), k["alu"], "逆变器散热片", "")
    for s in (-1, 1):
        tube(f"线圈引线{s}", rounded([(s * 0.55, 0.185, 0.0), (s * 0.55, 0.4, 0.0), (s * 0.15, 0.55, 0.0)]), 0.012,
             k["copper"], "线圈引线", "")
        ring_tube(f"端盖{s}", 0.15, 0.03, 0.06, (s * (L / 2 + 0.03), 0, 0), "X", k["pfa_solid"], "端盖", "")
        cyl(f"接口{s}", 0.032, 0.2, (s * (L / 2 + 0.16), 0, 0), "X", k["pfa_solid"], "药液入口" if s < 0 else "药液出口", "")
    for s in (-1, 1):
        tube(f"磁力线{s}", rounded([(-0.66, 0, s * 0.03), (0.66, 0, s * 0.03), (0.66, 0, s * 0.26), (-0.66, 0, s * 0.26)], 0.08),
             0.006, k["field"], "磁力线（示意）", "管内沿轴向穿过发热体，在外面经磁芯绕回来；方向每秒翻转几万次", closed=True)
    for i, x in enumerate((-0.4, -0.13, 0.14, 0.41)):
        torus(f"涡电流{i}", 0.078, 0.005, (x, 0, 0), "X", k["eddy"], "涡电流（示意）",
              "磁场一变，导体里就感应出绕圈的电流，电流 × 电阻 → 热。频率越高，电流越集中在表层（趋肤效应）")
        dot = sphere(f"涡电流点{i}", 0.012, (x, 0.078, 0), k["eddy"], "涡电流（示意）", "")
        key_path(dot, lambda t, x=x: (x, 0.078 * math.cos(2 * PI * 3 * t), 0.078 * math.sin(2 * PI * 3 * t)))
    for j, (r, a) in enumerate(((0.035, 0.3), (0.108, 1.9), (0.108, 4.1), (0.035, 3.5))):
        flow(f"药液流{j}", [(-0.65, r * math.cos(a), r * math.sin(a)), (0.65, r * math.cos(a), r * math.sin(a))], 3,
             0.011, k["cold"], "药液流向（动画示意）", "")
    export("induction", view=(0.7, -1.6, 0.65))

# ================================================================ 6 换热器式（PFA 细管束）
def m_hx():
    reset(); k = M()
    L = 1.4
    ring_tube("壳体", 0.25, 0.235, L, (0, 0, 0), "X", k["shell"], "壳体（热媒走这里）",
              "加热时通温水，冷却时通冷却水——同一台换热器既能加热也能冷却")
    for s in (-1, 1):
        cyl(f"管板{s}", 0.25, 0.03, (s * (L / 2 + 0.015), 0, 0), "X", k["pfa_solid"], "管板",
            "把每根细管两端固定、密封，隔开药液和热媒")
        ring_tube(f"封头{s}", 0.22, 0.2, 0.16, (s * (L / 2 + 0.11), 0, 0), "X", k["pfa"], "封头（药液分配 / 汇集）", "")
        cyl(f"封头盖{s}", 0.22, 0.02, (s * (L / 2 + 0.2), 0, 0), "X", k["pfa_solid"], "封头", "")
        cyl(f"药液口{s}", 0.035, 0.16, (s * (L / 2 + 0.28), 0, 0), "X", k["pfa_solid"],
            "药液入口" if s < 0 else "药液出口", "")
    pos = [(0.0, 0.0)] + [(0.075 * math.cos(i * PI / 3), 0.075 * math.sin(i * PI / 3)) for i in range(6)] + \
          [(0.15 * math.cos(i * PI / 6), 0.15 * math.sin(i * PI / 6)) for i in range(12)]
    for i, (y, z) in enumerate(pos):
        cyl(f"细管{i}", 0.022, L, (0, y, z), "X", k["pfa_coat"], "PFA 细管（药液走管内）",
            "氟树脂导热差，所以用很多根薄壁细管，把换热面积做大来弥补", verts=20)
    for i, x in enumerate((-0.45, -0.15, 0.15, 0.45)):
        a0, a1 = ((PI / 3, 5 * PI / 3) if i % 2 == 0 else (-2 * PI / 3, 2 * PI / 3))
        sector(f"挡板{i}", 0.233, 0.02, a0, a1, (x, 0, 0), "X", k["pfa_solid"], "折流挡板",
               "让热媒走 S 形路线反复横穿管束，流得更快、换热更充分")
    pipe("热媒入口", [(0.55, 0, 0.22), (0.55, 0, 0.42), (0.75, 0, 0.42)], 0.04, k, "热媒入口（温水 / 冷却水）",
         "和药液反方向流（逆流）：药液出口能更接近热媒入口温度", m=k["hotpipe"])
    pipe("热媒出口", [(-0.55, 0, -0.22), (-0.55, 0, -0.42), (-0.75, 0, -0.42)], 0.04, k, "热媒出口", "", m=k["hotpipe"])
    for i in (0, 2, 5, 8, 14):
        y, z = pos[i]
        flow(f"药液{i}", [(-0.7, y, z), (0.7, y, z)], 3, 0.012, k["cold"], "药液（管内，动画示意）", "")
    zz = [(0.55, 0.19, 0.12), (0.3, 0.19, -0.12), (0.0, 0.19, 0.12), (-0.3, 0.19, -0.12), (-0.55, 0.19, -0.12)]
    flow("热媒", zz, 8, 0.014, k["hot"], "热媒（管外，动画示意）", "")
    zz2 = [(0.55, -0.19, 0.12), (0.3, -0.19, -0.12), (0.0, -0.19, 0.12), (-0.3, -0.19, -0.12), (-0.55, -0.19, -0.12)]
    flow("热媒b", zz2, 8, 0.014, k["hot"], "热媒（管外，动画示意）", "")
    export("hx", view=(0.7, -1.6, 0.6))

# ================================================================ 7 热电（珀耳帖）温调器
def m_peltier():
    reset(); k = M()
    box("冷却水板", (1.0, 0.7, 0.1), (0, 0, 0.05), k["alu"], "冷却水板（铝 / 铜）",
        "珀耳帖元件“搬”过来的热，加上元件自己发的热，都从这里被冷却水带走")
    for s in (-1, 1):
        cyl(f"冷却水口{s}", 0.03, 0.18, (s * 0.3, 0.42, 0.05), "Y", k["coldpipe"], "冷却水进 / 出", "")
    ceramic, P, N, tabs = [], [], [], []
    zc0, hp_ = 0.106, 0.05
    for (cx, cy) in ((-0.23, -0.16), (0.23, -0.16), (-0.23, 0.16), (0.23, 0.16)):
        ceramic.append(((cx, cy, zc0), (0.4, 0.29, 0.012)))
        ceramic.append(((cx, cy, zc0 + 0.012 + hp_ + 0.008), (0.4, 0.29, 0.012)))
        for i in range(8):
            for j in range(6):
                x = cx - 0.14 + i * 0.04; y = cy - 0.1 + j * 0.04
                (P if (i + j) % 2 == 0 else N).append(((x, y, zc0 + 0.006 + 0.004 + hp_ / 2), (0.022, 0.022, hp_)))
                if i % 2 == 0:
                    tabs.append(((x + 0.02, y, zc0 + 0.008), (0.062, 0.026, 0.004)))
                else:
                    tabs.append(((x + 0.02 if i < 7 else x - 0.02, y, zc0 + 0.012 + hp_ + 0.001), (0.062, 0.026, 0.004)))
    zt = zc0 + 0.012 + hp_ + 0.008
    boxes_mesh("陶瓷基板", ceramic, k["ceramic"], "陶瓷基板（上下各一块）", "绝缘又导热，把元件阵列夹在中间")
    boxes_mesh("P型元件", P, k["ptype"], "P 型半导体元件（碲化铋）", "电流按特定方向流过时，把热从一面“搬”到另一面")
    boxes_mesh("N型元件", N, k["ntype"], "N 型半导体元件（碲化铋）", "P、N 交替排列，用铜片串联成几十到上百对")
    boxes_mesh("铜电极片", tabs, k["copper"], "铜电极片", "把相邻的 P、N 元件串起来")
    zp = zt + 0.006 + 0.03 + 0.12   # 为了看清元件阵列，上板往上拉开了 0.12（实物是紧贴的）
    box("药液侧换热板", (1.0, 0.7, 0.06), (0, 0, zp), k["plate"], "药液侧换热板（为看清元件，上下拉开了一点）",
        "导热好的金属或碳材料，接液面用氟树脂等耐药品材料做成 / 包覆。实物里它和元件紧紧压在一起，中间涂导热膏")
    zf = zp + 0.03 + 0.03
    sp = []
    for i in range(6):
        y = -0.25 + i * 0.1
        xs = (-0.42, 0.42) if i % 2 == 0 else (0.42, -0.42)
        sp += [(xs[0], y, zf), (xs[1], y, zf)]
    spr = rounded(sp, 0.045)
    tube("药液流道", spr, 0.03, k["pfa"], "药液流道（氟树脂，示意）", "药液在这里蛇形流过，热量隔着换热板被元件抽走或送入")
    tube("流道药液", spr, 0.022, k["liq"], "药液", "")
    flow("流道流", spr, 10, 0.012, k["cold"], "药液流向（动画示意）", "")
    box("直流电源", (0.36, 0.3, 0.3), (0.82, -0.55, 0.15), k["gray"], "直流电源（可正反切换）",
        "电流反向 → 热流反向：同一块元件从“冷却”变成“加热”，这是它最大的特点")
    box("电源屏", (0.22, 0.01, 0.1), (0.82, -0.706, 0.2), k["screen"], "直流电源（可正反切换）", "")
    tube("直流线+", rounded([(0.64, -0.5, 0.2), (0.5, -0.4, 0.12), (0.45, -0.32, 0.13)]), 0.01, k["hot"], "电源线（+）", "")
    tube("直流线-", rounded([(0.64, -0.6, 0.12), (0.5, -0.45, 0.1), (0.45, -0.32, 0.11)]), 0.01, k["black"], "电源线（−）", "")
    sensor("药液测温", (0.48, 0.25, zf + 0.25), (0.42, 0.25, zf), k, "药液温度传感器", "")
    # 放大：一对 P/N 元件
    bx, by, S = -0.95, -0.15, 1.6     # 放大的一对元件：位置和放大倍数
    def P_(x, z):
        return (bx + x * S, by, z * S)
    box("放大_下陶瓷", (0.42 * S, 0.18 * S, 0.03 * S), P_(0, 0.12), k["ceramic"], "放大：下陶瓷板（冷却模式时是热端）", "热从这里排出去")
    box("放大_N", (0.09 * S, 0.09 * S, 0.22 * S), P_(-0.11, 0.26), k["ntype"], "放大：N 型元件",
        "电子从下往上逆着电流方向跑，顺手把热往下带")
    box("放大_P", (0.09 * S, 0.09 * S, 0.22 * S), P_(0.11, 0.26), k["ptype"], "放大：P 型元件",
        "空穴顺着电流方向从上往下跑，也把热往下带")
    box("放大_上铜片", (0.34 * S, 0.12 * S, 0.02 * S), P_(0, 0.38), k["copper"], "放大：上铜片（冷端）",
        "电流从 N 流向 P 的这一侧变冷（吸热）")
    for s in (-1, 1):
        box(f"放大_下铜片{s}", (0.14 * S, 0.12 * S, 0.02 * S), P_(s * 0.13, 0.145), k["copper"], "放大：下铜片", "")
    box("放大_上陶瓷", (0.42 * S, 0.18 * S, 0.03 * S), P_(0, 0.405), k["ceramic"], "放大：上陶瓷板（冷端）", "贴着要冷却的东西")
    cur = [P_(-0.2, 0.145), P_(-0.11, 0.145), P_(-0.11, 0.38), P_(0.11, 0.38), P_(0.11, 0.145), P_(0.2, 0.145)]
    flow("放大_电流", cur, 6, 0.02, k["cur"], "电流方向（动画示意）", "下→N→上→P→下。把电流反过来，上面就变热")
    for i, x in enumerate((-0.11, 0.11)):
        a, b = P_(x, 0.43), P_(x, 0.11)
        flow(f"放大_热{i}", [(a[0], by - 0.07 * S, a[2]), (b[0], by - 0.07 * S, b[2])], 3, 0.018, k["hot"],
             "热量流向（冷却模式，动画示意）", "热被“搬”到下面")
    for i, (x, y) in enumerate(((-0.2, -0.05), (0.25, 0.1), (0.0, 0.22))):
        flow(f"抽热{i}", [(x, y, zf), (x, y, 0.02)], 3, 0.014, k["hot"], "热量流向（冷却模式，动画示意）",
             "药液的热 → 换热板 → 珀耳帖元件 → 冷却水板 → 冷却水")
    export("peltier", view=(0.75, -1.4, 1.1))

# ================================================================ 8 整体：循环槽 + 温调控制
def m_system():
    reset(); k = M()
    # 内槽 + 外槽（溢流槽）
    tx, zb, hi = -0.6, 0.9, 0.5
    shell_box("内槽", (0.8, 0.5, hi), 0.025, (tx, 0, zb + hi / 2), k["quartz"], "内槽（处理槽）",
              "晶圆泡在这里。药液从底部进入，从上沿溢出")
    box("内槽药液", (0.796, 0.496, hi - 0.01), (tx, 0, zb + (hi - 0.01) / 2), k["liq"], "药液", "")
    zo, ho = 1.2, 0.25
    for nm, sz, lc in (("外槽左", (0.025, 0.79, ho), (tx - 0.52, 0, zo + ho / 2)),
                       ("外槽右", (0.025, 0.79, ho), (tx + 0.52, 0, zo + ho / 2)),
                       ("外槽前", (1.065, 0.025, ho), (tx, -0.38, zo + ho / 2)),
                       ("外槽后", (1.065, 0.025, ho), (tx, 0.38, zo + ho / 2)),
                       ("外槽底前", (1.065, 0.1, 0.025), (tx, -0.33, zo)),
                       ("外槽底后", (1.065, 0.1, 0.025), (tx, 0.33, zo)),
                       ("外槽底左", (0.1, 0.56, 0.025), (tx - 0.47, 0, zo)),
                       ("外槽底右", (0.1, 0.56, 0.025), (tx + 0.47, 0, zo))):
        box(nm, sz, lc, k["quartz"], "外槽（溢流槽）", "接住溢出来的药液，再由泵抽走循环")
    # 循环回路
    loop = [(tx, -0.33, 1.2), (tx, -0.33, 0.25), (tx, 0, 0.25), (-0.2, 0, 0.25), (0.15, 0, 0.25), (0.85, 0, 0.25),
            (1.05, 0, 0.25), (1.05, 0, 0.75), (1.05, 0, 0.8), (tx, 0, 0.8), (tx, 0, 0.93)]
    pipe("回路配管", loop, 0.025, k, "循环配管（PFA）", "槽 → 泵 → 加热器 → 过滤器 → 回到槽底，一直转", rr=0.05)
    cyl("泵壳", 0.1, 0.18, (-0.05, 0, 0.25), "X", k["pfa_solid"], "循环泵",
        "让药液不停流动：既把热从加热器带到槽里，也把槽里搅匀")
    box("泵电机", (0.16, 0.2, 0.18), (-0.05, 0.2, 0.25), k["gray"], "循环泵", "")
    cyl("在线加热器", 0.09, 0.5, (0.5, 0, 0.25), "X", k["pfa_solid"], "在线加热器（③④⑤ 任一种）",
        "装在循环管上。也可以不用它，改成槽内浸入式或贴壁式")
    box("加热器端子盒", (0.16, 0.14, 0.08), (0.5, 0, 0.37), k["gray"], "在线加热器（③④⑤ 任一种）", "")
    cyl("过滤器", 0.09, 0.5, (1.05, 0, 0.45), "Z", k["pfa"], "过滤器", "去除颗粒。放在加热器后面，可以把加热器产生的颗粒也拦住")
    cyl("滤芯", 0.06, 0.44, (1.05, 0, 0.45), "Z", k["pfa_solid"], "过滤器", "")
    box("流量计", (0.12, 0.1, 0.1), (0.5, 0, 0.8), k["gray"], "流量计", "流量太低时，在线加热器会局部过热 → 联锁停热")
    rod("分散管", (tx - 0.35, 0, 0.94), (tx + 0.35, 0, 0.94), 0.02, k["pfa_solid"], "分散管（槽底）", "回来的药液从一排小孔均匀喷出")
    sensor("槽温传感器", (tx + 0.3, 0.15, 1.52), (tx + 0.3, 0.15, 1.0), k, "槽内温度传感器（控温用 PV）",
           "温度调节器拿它和设定值 SV 比较")
    # 控制器
    box("温度调节器", (0.3, 0.12, 0.22), (0.55, 0.55, 1.2), k["gray"], "温度调节器（PID）",
        "比较 PV（测量值）和 SV（设定值），算出 0–100 % 的输出，交给 SSR")
    box("温调屏", (0.22, 0.01, 0.12), (0.55, 0.488, 1.22), k["screen"], "温度调节器（PID）", "")
    box("过升温保护器", (0.2, 0.12, 0.16), (0.95, 0.55, 1.2), k["gray"], "独立的过升温保护器",
        "用另一个传感器、另一套回路：超温就断开接触器，不依赖 PID 那一套")
    box("SSR", (0.12, 0.08, 0.16), (0.45, 0.45, 0.55), k["black"], "SSR（固态继电器）",
        "按温度调节器的输出快速通断加热器电源，平均下来就是功率百分比")
    box("接触器", (0.12, 0.1, 0.16), (0.65, 0.45, 0.55), k["gray"], "电磁接触器（安全断路）",
        "SSR 坏了常常是“短路常通”，所以要再串一个能被保护回路断开的机械触点")
    for nm, pts in (("信号线1", [(tx + 0.3, 0.15, 1.52), (tx + 0.3, 0.55, 1.6), (0.45, 0.55, 1.32)]),
                    ("信号线2", [(0.55, 0.55, 1.09), (0.5, 0.5, 0.8), (0.45, 0.45, 0.63)]),
                    ("动力线", [(0.45, 0.45, 0.47), (0.55, 0.3, 0.42), (0.5, 0.08, 0.41)]),
                    ("保护线", [(0.95, 0.55, 1.12), (0.8, 0.5, 0.8), (0.65, 0.45, 0.63)])):
        tube(nm, rounded(pts, 0.08), 0.008, k["black"], "信号 / 动力线", "")
    # 接液盘
    box("接液盘底", (2.6, 1.3, 0.02), (0.05, 0.1, -0.01), k["pfa_solid"], "接液盘", "万一漏液先接在这里，不流到地上")
    for nm, sz, lc in (("盘边前", (2.6, 0.02, 0.08), (0.05, -0.55, 0.03)), ("盘边后", (2.6, 0.02, 0.08), (0.05, 0.75, 0.03)),
                       ("盘边左", (0.02, 1.3, 0.08), (-1.25, 0.1, 0.03)), ("盘边右", (0.02, 1.3, 0.08), (1.35, 0.1, 0.03))):
        box(nm, sz, lc, k["pfa_solid"], "接液盘", "")
    box("漏液传感器", (0.08, 0.06, 0.03), (1.2, -0.45, 0.015), k["tip"], "漏液传感器",
        "检测到液体 → 停泵、停加热、报警")
    flow("循环流", loop, 16, 0.02, k["hot"], "药液循环（动画示意）", "")
    export("system", view=(0.8, -1.6, 0.85))

ALL = dict(immersion=m_immersion, wall=m_wall, lamp=m_lamp, sheath=m_sheath, induction=m_induction,
           hx=m_hx, peltier=m_peltier, system=m_system)

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    names = [a for a in argv if not a.startswith("-")] or list(ALL)
    for n in names:
        ALL[n]()
