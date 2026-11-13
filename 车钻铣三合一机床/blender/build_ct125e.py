# -*- coding: utf-8 -*-
"""
车钻铣三合一微型机床（参照 CT125E 产品图和参数表）—— Blender 脚本建模

用法（Blender 4.2 ~ 5.x）:
    blender -b --factory-startup -P build_ct125e.py -- --out out [--render]

坐标（Blender，单位 mm 写在脚本里，场景里按米存）:
    X 沿床身从主轴箱指向尾座（左 → 右）
    Y 指向机床后面（操作者站在 -Y）
    Z 向上；托盘底面 z = 0
关键尺寸来自参数表：
    床身回转直径 125 → 主轴中心比床面高 62.5
    两顶尖距离 180、尾座套筒行程 18、钻铣头升降 60、主轴套筒行程 40
    主轴中心线至立柱表面 125、钻铣工作台 85 x 60、T 形槽 8 mm x 2
其余尺寸（外壳、手轮、内部电机 / 编码器 / 步进电机的位置）是按产品图比例估的或推测的，
零件的 extras 里 guess=1 的就是推测件。
"""
import bpy, bmesh, math, json, os, sys
from mathutils import Vector, Matrix

MM = 0.001
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = 'out'
RENDER = '--render' in argv
if '--out' in argv:
    OUT = argv[argv.index('--out') + 1]
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- 场景
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
col = bpy.data.collections.new('CT125E')
scene.collection.children.link(col)

# ---------------------------------------------------------------- 关键尺寸
BED_TOP = 100.0
AXIS_Z = BED_TOP + 62.5          # 主轴中心高
AXIS = Vector((0, 0, AXIS_Z))
LS_Y, LS_Z = -60.0, 78.0          # 丝杠位置
COL_C = Vector((-50.0, 48.0, 0))  # 立柱中心（推测：钻铣头绕它转）
COL_HALF = 28.0
THROAT = 125.0                    # 主轴中心线至立柱表面
HEAD_R = COL_HALF + THROAT        # 铣主轴到立柱中心的水平距离
TABLE_TOP = 136.0                 # 钻铣工作台（中拖板）面
HEAD_Z0 = 345.0                   # 钻铣头底面（最高位时主轴端面离台面约 180）
CROSS_Y0 = -20.0                  # 中拖板中心 y
# 默认把钻铣头摆到中拖板正上方
_dy = CROSS_Y0 - COL_C.y
HEAD_YAW = math.atan2(_dy, math.sqrt(HEAD_R ** 2 - _dy ** 2))
MILL_X = COL_C.x + math.sqrt(HEAD_R ** 2 - _dy ** 2)

# ---------------------------------------------------------------- 材质
def mat(name, rgb, metal=0.0, rough=0.5, emit=None, alpha=1.0, bump=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1)
        p.inputs['Emission Strength'].default_value = 2.0
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
    if bump > 0:  # 锤纹漆（只在 Cycles 渲染里有，glTF 不导出）
        tex = nt.nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value = 900.0
        tex.inputs['Detail'].default_value = 4.0
        bn = nt.nodes.new('ShaderNodeBump')
        bn.inputs['Strength'].default_value = bump
        bn.inputs['Distance'].default_value = 0.0004
        nt.links.new(tex.outputs['Fac'], bn.inputs['Height'])
        nt.links.new(bn.outputs['Normal'], p.inputs['Normal'])
    m.diffuse_color = (*rgb, alpha)
    return m

M = dict(
    cast=mat('M_CastBlack', (0.014, 0.015, 0.017), 0.05, 0.5, bump=0.08),
    panel=mat('M_Panel', (0.03, 0.033, 0.036), 0.05, 0.5),
    ground=mat('M_GroundSteel', (0.60, 0.61, 0.63), 1.0, 0.27),
    chrome=mat('M_Chrome', (0.80, 0.80, 0.82), 1.0, 0.12),
    alu=mat('M_Alu', (0.80, 0.81, 0.83), 1.0, 0.33),
    dark=mat('M_DarkSteel', (0.16, 0.16, 0.17), 0.85, 0.38),
    screw=mat('M_ScrewSteel', (0.55, 0.56, 0.58), 1.0, 0.32),
    lcd=mat('M_LCD', (0.10, 0.22, 0.85), 0.0, 0.2, emit=(0.18, 0.35, 1.0)),
    btn=mat('M_BtnGray', (0.55, 0.57, 0.60), 0.0, 0.45),
    btnor=mat('M_BtnOrange', (1.0, 0.55, 0.12), 0.0, 0.45),
    green=mat('M_Green', (0.10, 0.55, 0.22), 0.0, 0.4),
    red=mat('M_Red', (0.72, 0.06, 0.06), 0.0, 0.4),
    yellow=mat('M_Yellow', (0.95, 0.72, 0.04), 0.0, 0.45),
    rubber=mat('M_Rubber', (0.02, 0.02, 0.02), 0.0, 0.9),
    knob=mat('M_Knob', (0.04, 0.04, 0.045), 0.0, 0.35),
    tin=mat('M_TiN', (0.86, 0.64, 0.18), 1.0, 0.3),
    pcb=mat('M_PCB', (0.04, 0.32, 0.14), 0.0, 0.45),
    chip=mat('M_Chip', (0.03, 0.03, 0.03), 0.0, 0.4),
    copper=mat('M_Copper', (0.72, 0.36, 0.18), 1.0, 0.35),
    belt=mat('M_Belt', (0.05, 0.05, 0.05), 0.0, 0.8),
    plate=mat('M_Nameplate', (0.72, 0.73, 0.75), 1.0, 0.4),
    motor=mat('M_MotorBlue', (0.10, 0.17, 0.32), 0.4, 0.45),
    stepper=mat('M_StepperGray', (0.22, 0.22, 0.24), 0.7, 0.4),
    encoder=mat('M_EncoderDisc', (0.12, 0.12, 0.12), 0.3, 0.3),
    label=mat('M_LabelWhite', (0.85, 0.86, 0.88), 0.0, 0.5),
)

# ---------------------------------------------------------------- 工具函数
PARTS = []

def _finish(ob, m, info):
    ob.data.materials.append(m)
    col.objects.link(ob)
    for k, v in (info or {}).items():
        ob[k] = v
    PARTS.append(ob)
    return ob

def _bevel(ob, w, seg=2):
    if w <= 0:
        return
    md = ob.modifiers.new('bev', 'BEVEL')
    md.width = w * MM
    md.segments = seg
    md.limit_method = 'ANGLE'
    md.angle_limit = math.radians(40)

def box(name, x0, x1, y0, y1, z0, z1, m, bev=1.0, info=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = (x1 - x0), (y1 - y0), (z1 - z0)
    bmesh.ops.scale(bm, vec=(sx * MM, sy * MM, sz * MM), verts=bm.verts)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = (((x0 + x1) / 2) * MM, ((y0 + y1) / 2) * MM, ((z0 + z1) / 2) * MM)
    _bevel(ob, min(bev, 0.3 * min(sx, sy, sz)))
    return _finish(ob, m, info)

def _axis_rot(axis):
    if axis == 'x':
        return Matrix.Rotation(math.radians(90), 4, 'Y')
    if axis == 'y':
        return Matrix.Rotation(math.radians(-90), 4, 'X')
    return Matrix.Identity(4)

def cyl(name, axis, c, r, a0, a1, m, n=36, r2=None, bev=0.4, info=None):
    """沿 axis 的圆柱/圆台，c 是轴线上一点（另外两个坐标用它），a0..a1 是沿轴范围"""
    r2 = r if r2 is None else r2
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    L = a1 - a0
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=n,
                          radius1=r * MM, radius2=r2 * MM, depth=L * MM)
    bmesh.ops.transform(bm, matrix=_axis_rot(axis), verts=bm.verts)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    mid = (a0 + a1) / 2
    p = Vector(c)
    if axis == 'x': p.x = mid
    elif axis == 'y': p.y = mid
    else: p.z = mid
    ob.location = p * MM
    _bevel(ob, min(bev, 0.25 * min(r, r2 if r2 > 0 else r, abs(L))))
    return _finish(ob, m, info)

def ring(name, axis, c, r_out, r_in, a0, a1, m, n=40, info=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    L = (a1 - a0) * MM
    vs = []
    for z in (-L / 2, L / 2):
        for rr in (r_out * MM, r_in * MM):
            vs.append([bm.verts.new((rr * math.cos(2 * math.pi * i / n), rr * math.sin(2 * math.pi * i / n), z)) for i in range(n)])
    bo, bi, to, ti = vs
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bo[i], bo[j], to[j], to[i]))
        bm.faces.new((bi[j], bi[i], ti[i], ti[j]))
        bm.faces.new((to[i], to[j], ti[j], ti[i]))
        bm.faces.new((bo[j], bo[i], bi[i], bi[j]))
    bmesh.ops.transform(bm, matrix=_axis_rot(axis), verts=bm.verts)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    p = Vector(c)
    mid = (a0 + a1) / 2
    if axis == 'x': p.x = mid
    elif axis == 'y': p.y = mid
    else: p.z = mid
    ob.location = p * MM
    return _finish(ob, m, info)

def screw_thread(name, axis_c, x0, x1, r_root, r_major, pitch, m, seg=14, info=None):
    """沿 X 的螺纹杆（真的螺旋，转起来看得出牙在走）"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    turns = (x1 - x0) / pitch
    steps = int(turns * seg)
    prof = [(r_root, 0.0), (r_major, 0.30), (r_major, 0.55), (r_root, 0.85)]  # (半径, 沿轴相位)
    rings = []
    for k in range(steps + 1):
        th = 2 * math.pi * k / seg
        xs = x0 + pitch * k / seg
        row = []
        for (rr, ph) in prof:
            x = xs + ph * pitch
            row.append(bm.verts.new(((x - (x0 + x1) / 2) * MM, rr * math.cos(th) * MM, rr * math.sin(th) * MM)))
        rings.append(row)
    for k in range(steps):
        a, b = rings[k], rings[k + 1]
        for i in range(len(prof) - 1):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    # 牙底：一根细芯棒把螺旋之间的缝补上
    core = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg + 4, radius1=(r_root + 0.05) * MM,
                                 radius2=(r_root + 0.05) * MM, depth=(x1 - x0 + pitch) * MM)
    bmesh.ops.transform(bm, matrix=_axis_rot('x'), verts=core['verts'])
    bm.normal_update()
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = Vector(((x0 + x1) / 2, axis_c[1], axis_c[2])) * MM
    return _finish(ob, m, info)

def handwheel(name, axis, c, r, m=M['chrome'], info=None, handle_dir=1):
    """手轮 = 轮缘 + 辐板 + 毂 + 摇把；返回一个父空物体，原点在轮心"""
    t = 9.0
    a = {'x': 0, 'y': 1, 'z': 2}[axis]
    def along(v):
        p = Vector(c); p[a] = c[a] + v; return p
    hub = cyl(name + '_Hub', axis, c, r * 0.30, c[a] - t * 0.9, c[a] + t * 0.9, m, n=28, info=info)
    rim = ring(name + '_Rim', axis, c, r, r - 5.5, c[a] - t / 2, c[a] + t / 2, m, n=48, info=info)
    web = cyl(name + '_Web', axis, c, r - 4.0, c[a] - 1.6, c[a] + 1.6, m, n=48, info=info)
    dial = ring(name + '_Dial', axis, c, r * 0.45, r * 0.30, c[a] - t * 0.9 * handle_dir - 1.5 * handle_dir, c[a] - t * 0.9 * handle_dir + 1.5 * handle_dir, M['ground'], n=40, info=info)
    # 摇把：装在轮缘附近，平行轴线，向外
    off = Vector((0, 0, 0));
    radial = {'x': Vector((0, 0, 1)), 'y': Vector((0, 0, 1)), 'z': Vector((1, 0, 0))}[axis]
    hp = Vector(c) + radial * (r - 8)
    h0, h1 = c[a] + t / 2 * handle_dir, c[a] + (t / 2 + 26) * handle_dir
    hdl = cyl(name + '_Handle', axis, hp, 3.6, min(h0, h1), max(h0, h1), M['knob'], n=20, info=info)
    knobp = cyl(name + '_Grip', axis, hp, 5.0, min(h0, h1) + (8 if handle_dir > 0 else 0), max(h0, h1) - (0 if handle_dir > 0 else 8), M['knob'], n=20, info=info)
    emp = bpy.data.objects.new(name, None)
    emp.empty_display_size = 0.02
    emp.location = Vector(c) * MM
    col.objects.link(emp)
    for o in (hub, rim, web, dial, hdl, knobp):
        parent(o, emp)
    return emp

def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.03
    e.location = Vector(loc) * MM
    col.objects.link(e)
    return e

def parent(ob, par):
    bpy.context.view_layer.update()
    ob.parent = par
    ob.matrix_parent_inverse = par.matrix_world.inverted()
    return ob

def meta(ob, cn, info, grp, ex=(0, 0, 0), guess=0):
    ob['cn'] = cn
    ob['info'] = info
    ob['grp'] = grp
    ob['ex'] = list(ex)
    ob['guess'] = guess
    return ob

def tag_all(objs, cn, info, grp, ex=(0, 0, 0), guess=0):
    for o in objs:
        meta(o, cn, info, grp, ex, guess)

def children_meshes(e):
    return [c for c in e.children_recursive if c.type == 'MESH']

# 修正：handwheel 里第一次调 cyl 建了个零长度的毂，删掉
def _cleanup_zero():
    for o in list(PARTS):
        if o.type == 'MESH' and o.dimensions.length < 1e-6:
            PARTS.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)

# ================================================================= 底座
I = {}
tray = [
    box('Tray_Base', -215, 335, -130, 125, 8, 14, M['cast'], 1.5),
    box('Tray_LipF', -215, 335, -130, -124, 14, 30, M['cast'], 1.0),
    box('Tray_LipB', -215, 335, 119, 125, 14, 30, M['cast'], 1.0),
    box('Tray_LipR', 329, 335, -124, 119, 14, 30, M['cast'], 1.0),
]
for i, (x, y) in enumerate([(-200, -115), (320, -115), (-200, 110), (320, 110)]):
    tray.append(cyl(f'Foot_{i}', 'z', (x, y, 0), 10, 0, 8, M['rubber'], n=24))
tag_all(tray, '接屑托盘和脚垫', '铸铁托盘接住切屑和冷却液；四个橡胶脚垫减振、防滑。', 'base')

# ================================================================= 床身
bed = [
    box('Bed', -80, 325, -50, 50, 14, BED_TOP - 3, M['cast'], 1.5),
    box('Bed_WayF', -22, 325, -50, -36, BED_TOP - 3, BED_TOP, M['ground'], 0.4),
    box('Bed_WayB', -22, 325, 36, 50, BED_TOP - 3, BED_TOP, M['ground'], 0.4),
    box('Bed_Mid', -22, 325, -36, 36, BED_TOP - 4, BED_TOP - 2, M['cast'], 0.3),
    box('Bed_Rack', -22, 325, -52, -50, 60, 92, M['dark'], 0.2),
]
tag_all(bed, '床身和导轨', '铸铁床身是整台机床的“脊梁”。上面两条磨过的平导轨给大拖板和尾座导向；导轨直不直、床身刚不刚，决定车出来的工件圆不圆、直不直。', 'base')

# ================================================================= 控制箱
cab = [
    box('Cabinet', -210, -80, -95, 95, 14, 205, M['cast'], 2.0),
    box('Panel', -202, -88, -99, -95, 22, 198, M['panel'], 0.8),
]
for i, (x, z) in enumerate([(-197, 27), (-93, 27), (-197, 193), (-93, 193)]):
    cab.append(cyl(f'Panel_Screw{i}', 'y', (x, 0, z), 2.6, -101, -99, M['screw'], n=12, bev=0.3))
cyl_vent = cyl('Cabinet_Vent', 'x', (0, 20, 120), 9, -212, -210, M['rubber'], n=24)
cab.append(cyl_vent)
tag_all(cab, '控制箱', '左边的箱子：里面是主电机、调速驱动和电子挂轮的控制板（内部布置是推测）。前面板是数显屏、功能键和两个旋钮。', 'base', ex=(-170, -40, 0))
lcd = [box('LCD_Bezel', -190, -120, -101, -99, 158, 188, M['knob'], 0.5), box('LCD', -186, -124, -102, -101, 162, 184, M['lcd'], 0.2)]
tag_all(lcd, '数显屏', '显示主轴转速、进给量（mm/转）或螺距。电子挂轮的“挂轮比”就是在这里用按键设定的，不再换齿轮。', 'ctrl', ex=(-170, -40, 0))
btns = []
for i in range(5):
    x = -188 + i * 16
    btns.append(cyl(f'Key_{i}', 'y', (x, 0, 140), 4.4, -104, -99, M['btnor'] if i == 4 else M['btn'], n=20, bev=0.8))
tag_all(btns, '功能键', '选模式（进给 / 车螺纹）、调数值、确认。橙色键常用作确认或启动进给（各键的具体定义以说明书为准）。', 'ctrl', ex=(-170, -40, 0))
knob_speed = [cyl('Knob_Speed', 'y', (-178, 0, 92), 11, -108, -99, M['knob'], n=32, bev=1.5),
              box('Knob_Speed_Mark', -179, -177, -109, -107.5, 92, 101, M['label'], 0.1)]
tag_all(knob_speed, '调速旋钮', '无级调速 50 ~ 2250 转/分。直流（或无刷）电机靠改电压 / 频率调速，所以不用拨皮带、不用换挡。', 'ctrl', ex=(-170, -40, 0))
knob_mode = [cyl('Knob_Dir', 'y', (-112, 0, 92), 9, -106, -99, M['chrome'], n=28, bev=1.0),
             box('Knob_Dir_Bar', -121, -103, -108, -106, 89.5, 94.5, M['knob'], 0.5)]
tag_all(knob_mode, '进给方向 / 启停开关', '拨杆式旋钮：控制丝杠（大拖板）往左、停、往右。电子挂轮让“反转退刀”变成拨一下开关。（具体功能以说明书为准）', 'ctrl', ex=(-170, -40, 0))

# ================================================================= 主轴箱
head = [
    box('Headstock', -80, -22, -50, 72, BED_TOP - 3, 228, M['cast'], 2.0),
    box('Headstock_Front', -78, -24, -54, -50, 108, 220, M['cast'], 1.0),
]
tag_all(head, '主轴箱', '里面两只轴承撑着主轴。主轴箱顶上直接长出立柱，所以车削和钻铣共用一个铸铁“躯干”。', 'lathe', ex=(0, 0, 150))
sw = [
    box('Switch_Upper', -74, -28, -62, -54, 176, 206, M['panel'], 0.8),
    box('Switch_Up_G', -71, -54, -64, -62, 180, 200, M['green'], 0.6),
    box('Switch_Up_R', -48, -31, -64, -62, 180, 200, M['red'], 0.6),
    box('Switch_FR', -74, -60, -62, -54, 208, 220, M['label'], 0.5),
    box('Switch_Lower', -76, -26, -66, -54, 118, 162, M['yellow'], 1.2),
    box('Switch_Lo_G', -72, -53, -68, -66, 126, 152, M['green'], 0.6),
    box('Switch_Lo_R', -49, -30, -68, -66, 126, 152, M['red'], 0.6),
    box('Switch_Guard', -78, -64, -70, -54, 156, 166, M['yellow'], 0.8),
]
tag_all(sw, '开关组', '下面黄框是总电源开关（带防误触罩），上面一组是主轴启动 / 停止，旁边标着正反转和“主 / 铣切换”。一台机器车和铣不能同时开。', 'ctrl', ex=(0, -40, 150))

# ---- 主轴 + 卡盘 + 工件（一起转）
G_SPIN = empty('G_Spin', (0, 0, AXIS_Z))
spin = []
spin.append(cyl('Spindle', 'x', AXIS, 11, -100, -20, M['ground'], n=36))
spin.append(cyl('Spindle_Nose', 'x', AXIS, 24, -28, -20, M['ground'], n=40))
spin.append(cyl('Chuck_Back', 'x', AXIS, 38, -20, -10, M['ground'], n=48, bev=1.0))
spin.append(cyl('Chuck_Body', 'x', AXIS, 40, -10, 14, M['ground'], n=56, bev=1.5))
spin.append(ring('Chuck_FaceRing', 'x', AXIS, 34, 31, 14, 14.6, M['dark'], n=48))
spin.append(cyl('Chuck_Bore', 'x', AXIS, 9.5, 14, 14.8, M['rubber'], n=24, bev=0))
for k in range(3):
    th = math.radians(90 + k * 120)
    pos = AXIS + Vector((0, math.cos(th), math.sin(th))) * 30
    spin.append(cyl(f'Chuck_KeyHole{k}', 'x', pos, 2.8, 13.5, 14.8, M['rubber'], n=12, bev=0))
tag_all(spin[:2], '主轴', '车床的心脏：一根中空的钢轴，前端装卡盘，转起来带着工件转。通孔 9 mm，细长棒料可以从里面穿过去；前端锥孔 MT1 可以插顶尖。', 'lathe')
tag_all(spin[2:], '三爪卡盘', '扳手拧一个孔，里面的平面螺纹盘同时推三个卡爪向心，所以夹圆棒自动对中。', 'lathe', ex=(0, -80, 0))
jaws = []
for k in range(3):
    th = math.radians(90 + k * 120)
    d = Vector((0, math.cos(th), math.sin(th)))
    side = Vector((0, -math.sin(th), math.cos(th)))
    # 阶梯爪：内高外低
    for j, (r0, r1, x1) in enumerate([(10.2, 22, 30), (22, 36, 23)]):
        c = AXIS + d * ((r0 + r1) / 2)
        me = bpy.data.meshes.new(f'Jaw{k}_{j}')
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=((x1 - 14) * MM, 10 * MM, (r1 - r0) * MM), verts=bm.verts)
        bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(f'Chuck_Jaw{k}_{j}', me)
        rot = Matrix.Rotation(th - math.pi / 2, 4, 'X')
        ob.matrix_world = Matrix.Translation(Vector((((14 + x1) / 2), c.y, c.z)) * MM) @ rot
        _bevel(ob, 0.8)
        _finish(ob, M['ground'], None)
        meta(ob, '卡爪', '三个卡爪同时进退。阶梯形：内侧台阶夹小件，外侧台阶夹大件。', 'lathe', ex=(0, -80 + d.y * 28, d.z * 28))
        jaws.append(ob)
spin += jaws
work = cyl('Workpiece', 'x', AXIS, 10, 14, 112, M['alu'], n=48, bev=0.6)
meta(work, '工件（铝棒 Φ20）', '被夹住一起转的料。车刀不转，只是沿着工件走，就把它车圆、车细、车出螺纹。', 'lathe', ex=(30, -150, 50))
spin.append(work)
# 主轴尾部：皮带轮 + 编码器码盘（推测位置）
pul = cyl('Spindle_Pulley', 'x', AXIS, 26, -96, -84, M['alu'], n=48, bev=0.8)
meta(pul, '主轴皮带轮（推测）', '电机通过同步带带动主轴。CT125E 内部结构没有公开，这里按常见微型车床的做法画。', 'inside', ex=(0, 0, 0), guess=1)
spin.append(pul)
enc = cyl('Encoder_Disc', 'x', AXIS, 21, -101, -100, M['encoder'], n=60, bev=0)
encr = ring('Encoder_Slots', 'x', AXIS, 20, 16, -101.4, -99.6, M['label'], n=60)
tag_all([enc, encr], '主轴编码器码盘（推测）', '电子挂轮的“眼睛”：主轴每转一圈，码盘让传感器发出固定数目的脉冲（比如 1000 个），另有一个“零点”脉冲。控制板数这些脉冲就知道主轴转了多少度。', 'inside', ex=(-30, 0, 0), guess=1)
spin += [enc, encr]
for o in spin:
    parent(o, G_SPIN)
enc_sensor = box('Encoder_Sensor', -106, -95, -6, 6, AXIS_Z + 15, AXIS_Z + 30, M['chip'], 0.6)
meta(enc_sensor, '编码器读头（推测）', '槽型光电开关：码盘上的缝挡光 / 透光，就变成方波。两路相差 90° 的方波（A、B 相）还能分出正转反转。', 'inside', ex=(-30, 0, 40), guess=1)
bear = [ring('Bearing_F', 'x', AXIS, 19, 11, -36, -26, M['chrome'], n=40), ring('Bearing_R', 'x', AXIS, 17, 11, -78, -70, M['chrome'], n=40)]
tag_all(bear, '主轴轴承', '前后两只轴承决定主轴转起来晃不晃。参数表里“主轴端 100 mm 处跳动 0.01 ~ 0.02 mm”就是它们的功劳。', 'inside', ex=(0, 0, 45))

# ---- 主电机 + 同步带（推测）
MOT_C = Vector((0, 22, 72))
motor = [cyl('Motor_Body', 'x', MOT_C, 30, -190, -118, M['motor'], n=40, bev=2.0),
         cyl('Motor_Cap', 'x', MOT_C, 26, -118, -110, M['dark'], n=36, bev=1.0),
         cyl('Motor_Shaft', 'x', MOT_C, 4, -110, -82, M['ground'], n=16)]
tag_all(motor, '主电机 200 W（推测位置）', '车和铣共用的动力（CT125 的厂家说明里写的是一台电机同时带车和铣，E 版没写，图上有“主/铣切换”开关）。调速板改电机的电压或换相频率，实现 50 ~ 2250 转/分无级调速。', 'inside', ex=(0, 0, 0), guess=1)
G_MPUL = empty('G_MotorPulley', (-88, MOT_C.y, MOT_C.z))
mp = cyl('Motor_Pulley', 'x', MOT_C, 10, -94, -82, M['alu'], n=28)
meta(mp, '电机带轮（推测）', '小带轮带大带轮：转速降下来、扭矩放大约 2.6 倍。', 'inside', ex=(0, 0, 0), guess=1)
parent(mp, G_MPUL)

def belt_loop(name, c1, r1, c2, r2, x0, x1, th=2.4):
    """两个带轮之间的同步带（在 YZ 平面里取凸包）"""
    pts = []
    for (c, r) in ((c1, r1 + th / 2), (c2, r2 + th / 2)):
        for i in range(64):
            a = 2 * math.pi * i / 64
            pts.append((c[0] + r * math.cos(a), c[1] + r * math.sin(a)))
    # 凸包
    pts = sorted(set(pts))
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    hull = lo[:-1] + up[:-1]
    # 均匀重采样
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    n = len(hull)
    def off(i, d):
        p0, p1, pm = hull[i], hull[(i + 1) % n], hull[(i - 1) % n]
        tx, ty = p1[0] - pm[0], p1[1] - pm[1]; L = math.hypot(tx, ty) or 1
        nx, ny = ty / L, -tx / L
        return (p0[0] + nx * d, p0[1] + ny * d)
    rows = []
    for i in range(n):
        o_ = off(i, th / 2); i_ = off(i, -th / 2)
        rows.append([bm.verts.new((x * MM, p[0] * MM, p[1] * MM)) for x in (x0, x1) for p in (o_, i_)])
    for i in range(n):
        a, b = rows[i], rows[(i + 1) % n]
        # 顺序: (x0,out),(x0,in),(x1,out),(x1,in)
        bm.faces.new((a[0], b[0], b[2], a[2]))
        bm.faces.new((a[1], a[3], b[3], b[1]))
        bm.faces.new((a[0], a[1], b[1], b[0]))
        bm.faces.new((a[2], b[2], b[3], a[3]))
    bm.normal_update(); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    return _finish(ob, M['belt'], None)

belt = belt_loop('Belt', (MOT_C.y, MOT_C.z), 10, (0, AXIS_Z), 26, -95, -85)
meta(belt, '同步带（推测）', '带齿的皮带不打滑，主轴和电机的转角关系是固定的。不过电子挂轮测的是主轴本身，打不打滑都不影响螺距。', 'inside', ex=(0, 0, 0), guess=1)

# ---- 控制板（推测）
board = [box('Board_PCB', -206, -203, -70, 70, 40, 180, M['pcb'], 0.3)]
for i, (y, z, w, h) in enumerate([(-40, 150, 20, 20), (0, 150, 14, 14), (35, 140, 26, 18), (-30, 90, 30, 30), (30, 80, 34, 40)]):
    board.append(box(f'Board_Chip{i}', -203, -199 if i < 3 else -190, y - w / 2, y + w / 2, z - h / 2, z + h / 2, M['chip'] if i < 3 else M['alu'], 0.4))
tag_all(board, '控制板（推测）', '一块单片机板干三件事：读编码器、按设定的比例给步进电机发脉冲、驱动主电机调速。大块铝的是功率器件的散热片。', 'inside', ex=(-60, 0, 0), guess=1)

# ================================================================= 丝杠 + 步进电机
G_LS = empty('G_LeadScrew', (130, LS_Y, LS_Z))
ls = screw_thread('LeadScrew', (0, LS_Y, LS_Z), -40, 328, 5.0, 6.0, 1.5, M['ground'], seg=12)
meta(ls, '丝杠', '一根长螺杆：转一圈，大拖板就走一个导程。电子挂轮版本里它由步进电机直接带，转多快由控制板根据主轴转速实时算。（导程没公开，演示里按 1.5 mm 算）', 'lathe', ex=(0, -95, 0))
parent(ls, G_LS)
cpl = cyl('Coupling', 'x', (0, LS_Y, LS_Z), 8, -50, -36, M['alu'], n=24, bev=0.8)
meta(cpl, '联轴器（推测）', '把步进电机轴和丝杠连起来，允许一点点不同心。', 'inside', ex=(0, -95, 0), guess=1)
parent(cpl, G_LS)
step = [box('Stepper', -78, -54, LS_Y - 18, LS_Y + 18, LS_Z - 18, LS_Z + 18, M['stepper'], 1.5),
        box('Stepper_Cap', -80, -78, LS_Y - 16, LS_Y + 16, LS_Z - 16, LS_Z + 16, M['dark'], 0.8),
        cyl('Stepper_Shaft', 'x', (0, LS_Y, LS_Z), 2.5, -54, -48, M['ground'], n=12)]
tag_all(step, '步进电机（推测）', '收到一个脉冲就转一小格（常见 200 格一圈，再细分 8 ~ 16 倍）。电子挂轮 = 控制板按“主轴转了多少”去决定“给它发几个脉冲”。', 'inside', ex=(0, 0, 0), guess=1)
cover = [box('Stepper_Cover', -80, -38, -92, -40, 50, 104, M['cast'], 1.5)]
tag_all(cover, '步进电机罩', '主轴箱左下角这个小黑盒子，丝杠从它里面伸出来——步进电机多半就在里面（推测）。', 'lathe', ex=(0, -90, 40), guess=1)
ls_br = [box('LS_Bracket', 326, 340, -74, -44, 56, 100, M['cast'], 1.2)]
tag_all(ls_br, '丝杠尾座', '丝杠右端的轴承座。', 'lathe')
hw_long = handwheel('HW_Long', 'x', (352, LS_Y, LS_Z), 26, info=None, handle_dir=1)
tag_all(children_meshes(hw_long), '纵向手轮', '直接摇丝杠，手动让大拖板左右走。步进电机断电时才好摇。', 'lathe', ex=(50, -95, 0))
parent(hw_long, G_LS)

# ================================================================= 大拖板 / 中拖板 / 小刀架
CAR_X = 100.0
G_CAR = empty('G_Carriage', (CAR_X, 0, 110))
# 大拖板以 CAR_X 为中心（以前写死成 95..190，和中拖板错开了）
car = [box('Saddle', CAR_X - 47, CAR_X + 48, -62, 52, BED_TOP, 118, M['cast'], 1.2),
       box('Apron', CAR_X - 24, CAR_X + 26, -74, -62, 58, 118, M['cast'], 1.2),
       box('HalfNut', CAR_X - 12, CAR_X + 14, -70, -50, 66, 90, M['dark'], 0.6),
       box('Saddle_Lock', CAR_X + 38, CAR_X + 46, 30, 40, 118, 126, M['screw'], 0.4)]
tag_all(car[:2] + car[3:], '大拖板（床鞍）', '骑在床身导轨上，左右走（纵向，X）。车外圆、车螺纹时刀具的“走”全靠它。', 'lathe', ex=(0, 0, 60))
meta(car[2], '丝杠螺母', '丝杠转动 → 螺母带着大拖板走。电子挂轮机型一般一直啮合，退刀靠电机反转（推测）。', 'lathe', ex=(0, -40, 30), guess=1)
for o in car:
    parent(o, G_CAR)
G_CROSS = empty('G_Cross', (CAR_X, CROSS_Y0, 127))
parent(G_CROSS, G_CAR)
cross = []
# 中拖板 = 85 x 60 钻铣工作台，两条 8 mm T 形槽沿 X
cy0, cy1 = CROSS_Y0 - 30, CROSS_Y0 + 30
cross.append(box('Cross_Base', CAR_X - 42.5, CAR_X + 42.5, cy0, cy1, 118, 130, M['ground'], 0.6))
for i, (a, b) in enumerate([(cy0, CROSS_Y0 - 17), (CROSS_Y0 - 9, CROSS_Y0 + 9), (CROSS_Y0 + 17, cy1)]):
    cross.append(box(f'Cross_Top{i}', CAR_X - 42.5, CAR_X + 42.5, a, b, 130, TABLE_TOP, M['ground'], 0.3))
for i, yc in enumerate((CROSS_Y0 - 13, CROSS_Y0 + 13)):
    cross.append(box(f'Cross_Slot{i}', CAR_X - 42.5, CAR_X + 42.5, yc - 4, yc + 4, 129, 131, M['dark'], 0.1))
tag_all(cross, '中拖板 = 钻铣工作台', '前后走（横向，Y），控制吃刀深度。台面 85 × 60 mm，两条 8 mm T 形槽：钻铣时卸掉刀架，平口钳就压在这里，大拖板 + 中拖板就成了一张 XY 工作台。', 'lathe', ex=(0, 0, 110))
TOP_Y = CROSS_Y0 - 8
top = [box('TopSlide_Base', CAR_X - 32, CAR_X + 32, TOP_Y - 22, TOP_Y + 18, TABLE_TOP, TABLE_TOP + 8, M['ground'], 0.5),
       box('TopSlide', CAR_X - 36, CAR_X + 36, TOP_Y - 20, TOP_Y + 16, TABLE_TOP + 8, TABLE_TOP + 16, M['ground'], 0.5),
       box('TopSlide_Screw', CAR_X + 36, CAR_X + 50, TOP_Y - 4, TOP_Y + 2, TABLE_TOP + 9, TABLE_TOP + 14, M['ground'], 0.3)]
tag_all(top, '小拖板', '刀架下面再一层小滑板，可以单独微调刀的左右位置（车台阶、车锥度时用）。', 'lathe', ex=(0, 0, 150))
POST_Y0, POST_Y1 = -52, -22
post = [box('ToolPost', CAR_X - 15, CAR_X + 15, POST_Y0, POST_Y1, TABLE_TOP + 16, TABLE_TOP + 44, M['cast'], 1.0)]
for i, (dx, dy) in enumerate([(-8, -6), (8, -6), (-8, 6), (8, 6)]):
    post.append(cyl(f'ToolPost_Bolt{i}', 'z', (CAR_X + dx, (POST_Y0 + POST_Y1) / 2 + dy, 0), 3.2, TABLE_TOP + 44, TABLE_TOP + 52, M['screw'], n=12, bev=0.5))
post.append(cyl('ToolPost_Stud', 'z', (CAR_X, (POST_Y0 + POST_Y1) / 2, 0), 4, TABLE_TOP + 44, TABLE_TOP + 58, M['screw'], n=16))
tag_all(post, '四方刀架', '一次能装四把刀，松开中间螺母转 90° 就换刀。', 'lathe', ex=(0, 0, 190))
TIP_Y = -10.0
tool = [box('Tool_Shank', CAR_X - 4, CAR_X + 4, POST_Y0 + 2, TIP_Y - 3, AXIS_Z - 6, AXIS_Z + 2, M['dark'], 0.3)]
me = bpy.data.meshes.new('Tool_Tip'); bm = bmesh.new()
v = [bm.verts.new(Vector(p) * MM) for p in [(-4, -3, -6), (4, -3, -6), (4, -3, 0), (-4, -3, 0), (0, 0.5, -6), (0, 0.5, 0)]]
bm.faces.new((v[0], v[1], v[2], v[3])); bm.faces.new((v[0], v[4], v[5], v[3])); bm.faces.new((v[1], v[2], v[5], v[4]))
bm.faces.new((v[0], v[1], v[4])); bm.faces.new((v[3], v[5], v[2]))
bm.normal_update(); bm.to_mesh(me); bm.free()
tip = bpy.data.objects.new('Tool_Tip', me); tip.location = Vector((CAR_X, TIP_Y - 0.5, AXIS_Z + 0.0)) * MM
_finish(tip, M['tin'], None)
tool.append(tip)
tag_all(tool, '车刀', '刀尖高度要正好对准主轴中心。车刀本身不转，靠工件转起来“削”。金色的是涂层硬质合金刀片。', 'lathe', ex=(0, -60, 210))
for o in cross + top + post + tool:
    parent(o, G_CROSS)
hw_cross = handwheel('HW_Cross', 'y', (CAR_X, -86, 124), 24, handle_dir=-1)
tag_all(children_meshes(hw_cross), '中拖板手轮', '摇它，中拖板前后走，控制吃刀。刻度环一格通常是 0.02 ~ 0.05 mm（看说明书）；吃 0.1 mm，直径少 0.2 mm。', 'lathe', ex=(0, -70, 60))
parent(hw_cross, G_CAR)
hw_top = handwheel('HW_Top', 'x', (CAR_X + 58, TOP_Y - 1, TABLE_TOP + 12), 14, handle_dir=1)
tag_all(children_meshes(hw_top), '小拖板手轮', '小拖板的微调手轮。', 'lathe', ex=(40, 0, 150))
parent(hw_top, G_CROSS)

# ================================================================= 尾座
TS_X = 262.0
G_TAIL = empty('G_Tail', (TS_X, 0, AXIS_Z))
tail = [box('Tail_Base', 236, 292, -38, 38, BED_TOP, 112, M['cast'], 1.0),
        box('Tail_Body', 240, 290, -26, 26, 112, AXIS_Z + 4, M['cast'], 1.5),
        cyl('Tail_Barrel', 'x', AXIS, 18, 232, 292, M['cast'], n=40, bev=1.5),
        cyl('Tail_Lock', 'z', (270, 0, 0), 3, AXIS_Z + 18, AXIS_Z + 34, M['screw'], n=12),
        cyl('Tail_LockBall', 'z', (270, 0, 0), 5, AXIS_Z + 32, AXIS_Z + 40, M['knob'], n=16),
        box('Tail_Clamp', 280, 290, -48, -38, BED_TOP - 4, BED_TOP + 12, M['dark'], 0.6)]
tag_all(tail, '尾座', '在右边顶住长工件，或者装钻夹头在工件端面打孔。可以沿导轨滑动后锁死。', 'lathe', ex=(80, 0, 0))
G_TQ = empty('G_TailQuill', (232, 0, AXIS_Z))
tq = [cyl('Tail_Quill', 'x', AXIS, 11, 206, 238, M['ground'], n=32),
      cyl('Tail_Center', 'x', AXIS, 0.6, 186, 206, M['ground'], n=24, r2=8.5, bev=0)]
tag_all(tq, '尾座套筒和顶尖', '摇右边的手轮，套筒伸出最多 18 mm。锥孔 MT1，可以换钻夹头。', 'lathe', ex=(40, 0, 45))
for o in tq:
    parent(o, G_TQ)
parent(G_TQ, G_TAIL)
hw_tail = handwheel('HW_Tail', 'x', (302, 0, AXIS_Z), 22, handle_dir=1)
tag_all(children_meshes(hw_tail), '尾座手轮', '摇它，尾座套筒进退。', 'lathe', ex=(120, 0, 0))
for o in tail:
    parent(o, G_TAIL)
parent(hw_tail, G_TAIL)

# ================================================================= 挡屑板
guard = [box('Guard_Back', -20, 330, 60, 64, BED_TOP, 236, M['cast'], 0.6),
         cyl('Guard_Roll', 'x', (0, 58, 236), 6, -20, 330, M['cast'], n=24),
         box('Guard_Right', 326, 330, 30, 64, BED_TOP, 200, M['cast'], 0.4)]
tag_all(guard, '挡屑板', '挡住往后飞的切屑和冷却液。', 'base', ex=(0, 80, 0))

# ================================================================= 立柱 + 钻铣头
colm = [box('Column', COL_C.x - COL_HALF, COL_C.x + COL_HALF, COL_C.y - COL_HALF, COL_C.y + COL_HALF, 226, 440, M['cast'], 2.0),
        cyl('Column_Lock', 'x', (0, COL_C.y - 10, 300), 3, COL_C.x - COL_HALF - 22, COL_C.x - COL_HALF, M['screw'], n=12),
        cyl('Column_LockGrip', 'x', (0, COL_C.y - 10, 300), 5, COL_C.x - COL_HALF - 34, COL_C.x - COL_HALF - 18, M['knob'], n=16)]
tag_all(colm, '立柱', '从主轴箱上长出来的方立柱。钻铣头套在上面：能上下移 60 mm，也能绕它转一整圈（360°）。', 'mill', ex=(0, 0, 150))

G_HEAD = empty('G_Head', (COL_C.x, COL_C.y, HEAD_Z0))
hd = []
def hbox(name, x0, x1, y0, y1, z0, z1, m, bev=1.5):
    return box(name, COL_C.x + x0, COL_C.x + x1, COL_C.y + y0, COL_C.y + y1, HEAD_Z0 + z0, HEAD_Z0 + z1, m, bev)
def hcyl(name, x, y, r, z0, z1, m, n=32, r2=None, bev=0.5):
    return cyl(name, 'z', (COL_C.x + x, COL_C.y + y, 0), r, HEAD_Z0 + z0, HEAD_Z0 + z1, m, n=n, r2=r2, bev=bev)
hd.append(hbox('Head_Sleeve', -COL_HALF - 6, COL_HALF + 6, -COL_HALF - 6, COL_HALF + 6, -8, 80, M['cast'], 2.0))
hd.append(hbox('Head_Box', COL_HALF, HEAD_R + 30, -40, 40, 0, 96, M['cast'], 3.0))
hd.append(hcyl('Head_Nose', HEAD_R, 0, 24, -14, 0, M['cast'], n=40, bev=1.0))
hd.append(hcyl('Head_TopCap', HEAD_R, 0, 15, 96, 140, M['cast'], n=32, bev=1.5))
hd.append(hcyl('Head_TopKnob', HEAD_R - 70, 0, 6, 96, 106, M['knob'], n=16))
hd.append(hbox('Head_Plate', 40, 100, -41.5, -40, 42, 74, M['plate'], 0.3))
hd.append(hbox('Head_Lock', -COL_HALF - 6, -COL_HALF + 4, -COL_HALF - 18, -COL_HALF - 6, 10, 40, M['dark'], 0.6))
tag_all(hd, '钻铣头', '钻铣主轴装在这个铸铁头里。主轴中心离立柱表面 125 mm。头可以升降、可以绕立柱转，所以既能对准中拖板上的工件，也能转到一边让开车削。', 'mill', ex=(0, 0, 260))
# 进给手柄 + 微调手轮（在头的 -Y 面）
hub = cyl('Quill_Hub', 'y', (COL_C.x + HEAD_R - 40, 0, HEAD_Z0 + 52), 13, COL_C.y - 54, COL_C.y - 40, M['ground'], n=32)
lev = cyl('Quill_Lever', 'x', (0, COL_C.y - 50, HEAD_Z0 + 52), 3.4, 0, 70, M['ground'], n=12)
lev.matrix_world = Matrix.Translation(Vector((COL_C.x + HEAD_R - 40, COL_C.y - 50, HEAD_Z0 + 52)) * MM) @ Matrix.Rotation(math.radians(-50), 4, 'Y') @ Matrix.Translation(Vector((35, 0, 0)) * MM)
ball = cyl('Quill_LeverBall', 'x', (0, COL_C.y - 50, HEAD_Z0 + 52), 7, 66, 80, M['knob'], n=20)
ball.matrix_world = Matrix.Translation(Vector((COL_C.x + HEAD_R - 40, COL_C.y - 50, HEAD_Z0 + 52)) * MM) @ Matrix.Rotation(math.radians(-50), 4, 'Y') @ Matrix.Translation(Vector((73, 0, 0)) * MM)
fine = cyl('Quill_FineDial', 'y', (COL_C.x + HEAD_R + 12, 0, HEAD_Z0 + 30), 11, COL_C.y - 50, COL_C.y - 40, M['chrome'], n=32)
fine_k = cyl('Quill_FineKnob', 'y', (COL_C.x + HEAD_R + 12, 0, HEAD_Z0 + 30), 4, COL_C.y - 60, COL_C.y - 50, M['knob'], n=16)
tag_all([hub, lev, ball, fine, fine_k], '主轴套筒进给手柄', '扳手柄，齿轮带齿条，主轴套筒往下伸（最多 40 mm）——这就是钻孔的进给。旁边的小手轮是微调，铣削时用它定深度。', 'mill', ex=(0, -50, 260))
hd += [hub, lev, ball, fine, fine_k]
for o in hd:
    parent(o, G_HEAD)
G_QUILL = empty('G_Quill', (COL_C.x + HEAD_R, COL_C.y, HEAD_Z0))
parent(G_QUILL, G_HEAD)
G_MSPIN = empty('G_MillSpin', (COL_C.x + HEAD_R, COL_C.y, HEAD_Z0 - 40))
parent(G_MSPIN, G_QUILL)
qu = [hcyl('Quill', HEAD_R, 0, 13, -30, 2, M['ground'], n=32)]
tag_all(qu, '主轴套筒', '套在铣主轴外面，只上下动不转。', 'mill', ex=(0, 0, 200))
for o in qu:
    parent(o, G_QUILL)
ms = [hcyl('Mill_Spindle', HEAD_R, 0, 8, -36, -30, M['ground'], n=24),
      hcyl('Collet_Nut', HEAD_R, 0, 12, -50, -36, M['chrome'], n=6, bev=0.8),
      hcyl('EndMill_Shank', HEAD_R, 0, 3, -70, -50, M['ground'], n=16),
      hcyl('EndMill_Flute', HEAD_R, 0, 3, -84, -70, M['tin'], n=8, bev=0.2)]
tag_all(ms, '铣主轴 + 弹簧夹头 + 立铣刀', '铣刀自己转，工件不转，靠拖板移动工件去“啃”。最大钻孔直径 6 mm；夹头螺母一拧，弹簧夹头收紧夹住刀柄。', 'mill', ex=(0, 0, 150))
for o in ms:
    parent(o, G_MSPIN)
G_HEAD.rotation_euler = (0, 0, HEAD_YAW)
bpy.context.view_layer.update()

_cleanup_zero()

# ================================================================= 爆炸方向修正（组里的零件按世界坐标给）
# 内部件一开始就“藏”在壳里：网页里用透视模式看；爆炸时外壳先走开
for o in PARTS:
    if 'ex' not in o.keys():
        meta(o, o.name, '', 'base')

# ================================================================= 输出
def layout():
    return dict(
        unit='mm', axis_z=AXIS_Z, bed_top=BED_TOP, leadscrew=[LS_Y, LS_Z], lead_mm=1.5,
        column=[COL_C.x, COL_C.y], head_r=HEAD_R, head_z0=HEAD_Z0, head_yaw_deg=math.degrees(HEAD_YAW),
        mill_x=MILL_X, cross_y0=CROSS_Y0, table_top=TABLE_TOP, carriage_x=CAR_X, tip_y=TIP_Y,
        work=dict(r=10, x0=14, x1=112), tail_x=TS_X, chuck_face_x=14,
        travel=dict(head_up=60, quill=40, tail_quill=18),
    )
json.dump(layout(), open(os.path.join(OUT, 'layout.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
parts_tbl = [dict(name=o.name, cn=o.get('cn', ''), grp=o.get('grp', ''), guess=int(o.get('guess', 0))) for o in PARTS]
json.dump(parts_tbl, open(os.path.join(OUT, 'parts.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('parts:', len(PARTS))

# 爆炸动画（.blend 里 1 ~ 90 帧拆开）
for o in PARTS:
    ex = Vector(o.get('ex', (0, 0, 0))) * MM
    if ex.length == 0:
        continue
    o.keyframe_insert('location', frame=1)
    base = o.location.copy()
    if o.parent:
        inv = (o.parent.matrix_world @ o.matrix_parent_inverse).to_3x3().inverted()
        o.location = base + inv @ ex
    else:
        o.location = base + ex
    o.keyframe_insert('location', frame=90)
    o.location = base
scene.frame_start, scene.frame_end = 1, 120
scene.frame_set(1)

bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, 'ct125e.blend')))
# glTF：关掉动画（网页自己算），带 extras
scene.frame_set(1)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(os.path.join(OUT, 'ct125e.glb')), export_format='GLB',
                          export_apply=True, export_extras=True, export_yup=True, export_animations=False,
                          export_cameras=False, export_lights=False)
print('GLB written')

# ================================================================= 渲染
if RENDER:
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = int(os.environ.get('SAMPLES', '40'))
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = int(os.environ.get('RESX', '1400')), int(os.environ.get('RESY', '1000'))
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 90
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('W'); scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.92, 0.93, 0.95, 1)
    bg.inputs['Strength'].default_value = 0.25
    def light(name, loc, energy, size, rot):
        L = bpy.data.lights.new(name, 'AREA'); L.energy = energy; L.size = size
        o = bpy.data.objects.new(name, L); o.location = loc; o.rotation_euler = rot
        scene.collection.objects.link(o)
    light('Key', (-0.4, -0.9, 1.0), 110, 0.9, (math.radians(45), 0, math.radians(-20)))
    light('Fill', (0.9, -0.6, 0.5), 40, 1.2, (math.radians(60), 0, math.radians(55)))
    light('Rim', (0.2, 0.9, 0.9), 70, 1.0, (math.radians(-40), 0, math.radians(180)))
    # 地面
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.data.materials.append(mat('M_Floor', (0.55, 0.56, 0.58), 0, 0.7))
    cam_d = bpy.data.cameras.new('Cam'); cam_d.lens = 60
    cam = bpy.data.objects.new('Cam', cam_d); scene.collection.objects.link(cam); scene.camera = cam
    def look(pos, tgt):
        cam.location = Vector(pos)
        d = Vector(tgt) - Vector(pos)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    def shot(fname, frame, pos, tgt):
        scene.frame_set(frame)
        look(pos, tgt)
        scene.render.filepath = os.path.abspath(os.path.join(OUT, fname))
        bpy.ops.render.render(write_still=True)
        print('rendered', fname)
    shot('render_assembled.jpg', 1, (0.78, -1.22, 0.70), (0.05, 0.0, 0.225))
    shot('render_exploded.jpg', 90, (0.95, -1.55, 0.95), (0.0, -0.03, 0.27))
print('done')
