# -*- coding: utf-8 -*-
"""
汽车模拟器 · 第二套动力：两电机混动（e:HEV 式）

装在同一辆车里，发动机的位置和燃油版一样，所以水箱、排气管、油箱和油管都共用（那几件还是 powertrain.py 建的）。
这里建的件名字都以 H_ 开头，单独导出成 out/pt_ehev.glb：

    发动机    1.5 L 阿特金森循环四缸（缸径 73 × 行程 89.4），没有皮带、没有起动机、没有发电机
    电驱单元  飞轮减振器 → 输入轴（带发电机齿轮和离合器）→ 发电机轴 / 驱动电机空心轴（同轴）→ 中间轴 → 差速器
    电        PCU 坐在电机壳上，三相铜排往下进两台电机；两根橙色高压线从地板下面走到后排座椅后面的电池
    前舱      空滤、12 V 电瓶、电动刹车助力、电动空调压缩机

结构的依据：发电机和驱动电机同轴、发电机轴从驱动电机的空心轴里穿过（本田的公开专利和厂家说明）；驱动电机在里、
发电机在外（媒体拆解）；电机绕组是扁线（拆解报告）。齿数按官方变速比凑。发电机齿轮的速比、槽数极数、各轴的
具体位置没有公开数据，是示意。

会动的件每个单独一个物体，原点在自己的转轴上，extras 里的 shaft 说明它跟谁转：
    crank 曲轴（飞轮、输入轴、离合器内毂）/ cam 凸轮轴 / gen 发电机轴 / motor 驱动电机空心轴
    od 直驱齿轮和离合器外鼓 / counter 中间轴 / diff 差速器和半轴
extras 里的 side 说明它属于哪一边：eng = 跟发动机一起转，wheel = 跟车轮一起转（网页按这个上色）。

build(M, H) 由 build_car.py --pt ehev 调用。
"""
import math
from math import atan2, cos, pi, radians, sin, sqrt, tan

import bmesh
from mathutils import Matrix, Vector

import carkit as CK
import powertrain as PT
import shape as SH

P = PT.P
HV = P['ehev']
E = dict(P['engine'])
E.update({k: v for k, v in HV['engine'].items() if not k.startswith('_')})
T, X, MOT, GEN = HV['teeth'], HV['x'], HV['motor'], HV['gen']

# ---------------------------------------------------------------- 由参数表推出来的量
R_CRANK = E['stroke'] / 2
CYL_X = [1.5 * E['pitch'], .5 * E['pitch'], -.5 * E['pitch'], -1.5 * E['pitch']]
CRANK_UP = (True, False, False, True)
XE, YC, ZC = PT.XE, PT.YC, PT.ZC            # 发动机的位置和燃油版一样
XB = PT.XB                                  # 缸体后端面
PIN_Z = [E['rod'] + (R_CRANK if up else -R_CRANK) for up in CRANK_UP]
DISP_CC = pi / 4 * E['bore'] ** 2 * E['stroke'] * 4 / 1000.0
HELIX = tan(radians(T['helix_deg']))

AX_I = (YC, ZC)                             # 输入轴 = 曲轴
AX_D = tuple(P['cvt']['diff_yz'])           # 差速器：和燃油版同一个位置，半轴不用改
A_IC = T['m1'] * (T['zcd'] + T['zed']) / 2  # 输入轴 ↔ 中间轴（直驱齿轮）
A_CD = T['mf'] * (T['zf'] + T['zr']) / 2    # 中间轴 ↔ 差速器
A_MC = T['m1'] * (T['zcd'] + T['zm']) / 2   # 电机轴 ↔ 中间轴
A_IG = T['mg'] * (T['zig'] + T['zgp']) / 2  # 输入轴 ↔ 电机轴（发电机齿轮）


def _two_circles(c0, r0, c1, r1):
    dx, dy = c1[0] - c0[0], c1[1] - c0[1]
    d = math.hypot(dx, dy)
    a = (r0 * r0 - r1 * r1 + d * d) / (2 * d)
    h = sqrt(max(r0 * r0 - a * a, 0.0))
    px, py = c0[0] + a * dx / d, c0[1] + a * dy / d
    return (px + h * dy / d, py - h * dx / d), (px - h * dy / d, py + h * dx / d)


AX_C = max(_two_circles(AX_I, A_IC, AX_D, A_CD), key=lambda p: p[1])        # 中间轴：取上面那个解
AX_M = max(_two_circles(AX_C, A_MC, AX_I, A_IG), key=lambda p: p[1])        # 电机 / 发电机轴：取上面那个解（躲开半轴）
AXES = dict(I=AX_I, M=AX_M, C=AX_C, D=AX_D)

RATIO_M = T['zr'] / T['zf'] * T['zcd'] / T['zm']      # 电机 → 车轮
RATIO_E = T['zr'] / T['zf'] * T['zcd'] / T['zed']     # 发动机 → 车轮（离合器合上时）
RATIO_G = T['zig'] / T['zgp']                         # 发电机 / 发动机


def derived():
    return dict(disp_cc=round(DISP_CC, 1), axes={k: [round(v[0], 2), round(v[1], 2)] for k, v in AXES.items()},
                ratio=dict(motor=round(RATIO_M, 4), engine=round(RATIO_E, 4), gen=round(RATIO_G, 4)),
                centre=dict(ic=A_IC, cd=A_CD, mc=A_MC, ig=A_IG), xe=XE, xb=XB, cyl_x=CYL_X, crank_up=CRANK_UP,
                r_crank=R_CRANK, rod=E['rod'], bore=E['bore'], stroke=E['stroke'], deck=E['deck'], firing=E['firing'],
                valve=HV['valve'])


# ---------------------------------------------------------------- 小工具
BB = {}


def arc_solid(bm, r0, r1, x0, x1, a0, a1, seg, mi, c=(0.0, 0.0)):
    """一段圆环柱：半径 r0..r1，轴向 x0..x1，角度 a0..a1（弧度）。定子铁芯、齿、槽里的铜都用它"""
    def ring(x, r):
        return [bm.verts.new((x, c[0] + r * cos(a0 + (a1 - a0) * k / seg), c[1] + r * sin(a0 + (a1 - a0) * k / seg)))
                for k in range(seg + 1)]
    A, B_, C_, D_ = ring(x0, r0), ring(x0, r1), ring(x1, r1), ring(x1, r0)
    fs = []
    for k in range(seg):
        fs.append(bm.faces.new((A[k], A[k + 1], B_[k + 1], B_[k])))        # x0 端面
        fs.append(bm.faces.new((B_[k], B_[k + 1], C_[k + 1], C_[k])))      # 外圆
        fs.append(bm.faces.new((C_[k], C_[k + 1], D_[k + 1], D_[k])))      # x1 端面
        fs.append(bm.faces.new((D_[k], D_[k + 1], A[k + 1], A[k])))        # 内圆
    if abs((a1 - a0) - 2 * pi) > 1e-6:
        fs.append(bm.faces.new((A[0], B_[0], C_[0], D_[0])))
        fs.append(bm.faces.new((A[-1], D_[-1], C_[-1], B_[-1])))
    for f in fs:
        f.material_index = mi
        f.smooth = seg > 2
    CK.orient_closed(bm, fs)
    return fs


def beam(bm, p0, p1, w, h, up, mi):
    """一根方条：p0 → p1，截面 w（沿 up）× h。扁线、铜排用"""
    p0, p1, up = Vector(p0), Vector(p1), Vector(up)
    d = (p1 - p0).normalized()
    u = (up - d * up.dot(d))
    u = u.normalized() if u.length > 1e-6 else d.orthogonal().normalized()
    v = d.cross(u)
    q = []
    for p in (p0, p1):
        q.append([bm.verts.new(p + u * (a * w / 2) + v * (b * h / 2)) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    fs = [bm.faces.new(q[0]), bm.faces.new(q[1])]
    for k in range(4):
        fs.append(bm.faces.new((q[0][k], q[0][(k + 1) % 4], q[1][(k + 1) % 4], q[1][k])))
    for f in fs:
        f.material_index = mi
        f.smooth = False
    CK.orient_closed(bm, fs)
    return fs


def gear(bm, x0, x1, n, m, mi=0, phase=0.0, helix=0.0, layers=3, bore=None):
    """斜齿轮（梯形齿，示意）：齿数 n、模数 m，轴线沿 x 过原点。phase = 齿宽中间那个截面上一个齿的中心朝哪个角度。
    helix = tan(螺旋角)，带正负号；一对啮合的齿轮旋向相反"""
    rp = n * m / 2
    ra, rf = rp + .9 * m, rp - 1.1 * m
    ri = bore if bore else max(rf - 1.4 * m, rf * .55)
    p = 2 * pi / n
    prof = []
    for k in range(n):
        for fr, r in ((-.30, rf), (-.15, ra), (.15, ra), (.30, rf)):
            prof.append((k * p + fr * p, r))
    N = len(prof)
    xm = (x0 + x1) / 2

    def ring(x, rr=None):
        tw = phase + helix * (x - xm) / rp
        return [bm.verts.new((x, (rr or r) * cos(a + tw), (rr or r) * sin(a + tw))) for a, r in prof]
    xs = [x0 + (x1 - x0) * i / layers for i in range(layers + 1)]
    outer = [ring(x) for x in xs]
    i0, i1 = ring(x0, ri), ring(x1, ri)
    fs = []
    for a, b in zip(outer, outer[1:]):
        for k in range(N):
            j = (k + 1) % N
            fs.append(bm.faces.new((a[k], a[j], b[j], b[k])))
    for k in range(N):
        j = (k + 1) % N
        fs.append(bm.faces.new((i0[k], i0[j], outer[0][j], outer[0][k])))
        fs.append(bm.faces.new((outer[-1][k], outer[-1][j], i1[j], i1[k])))
    fs.append(bm.faces.new(i0))
    fs.append(bm.faces.new(i1))
    for f in fs:
        f.material_index = mi
        f.smooth = False
    CK.orient_closed(bm, fs)
    return fs


def mesh_phase(ca, za, pha, cb, zb):
    """齿轮 a（中心 ca，相位 pha）已经定了，算和它啮合的齿轮 b 的相位：a 的齿对着 b 的齿槽"""
    al = atan2(cb[1] - ca[1], cb[0] - ca[0])
    fa = ((al - pha) / (2 * pi / za)) % 1.0
    return (al + pi) - ((fa + .5) % 1.0) * (2 * pi / zb)


def prism_z(bm, loop, z0, z1, mi, smooth=False):
    """(x, y) 轮廓沿 z 拉伸（缸体半块：带半圆缸筒的截面）"""
    a = [bm.verts.new((x, y, z0)) for x, y in loop]
    b = [bm.verts.new((x, y, z1)) for x, y in loop]
    fs = [bm.faces.new(a), bm.faces.new(b)]
    n = len(loop)
    for k in range(n):
        fs.append(bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k])))
    for f in fs:
        f.material_index = mi
        f.smooth = smooth
    CK.orient_closed(bm, fs)
    bmesh.ops.triangulate(bm, faces=fs[:2])
    return fs


def ring_x(H, bm, c, r0, r1, x0, x1, mi, seg=28):
    """一个圆环（轴承圈、垫片）"""
    return H.lathe(bm, [(r0, x0), (r1, x0), (r1, x1), (r0, x1)], (0, c[0], c[1]), 'X', seg, mi, closed=True)


def bearing(H, bm, c, x, r_in, r_out, w=14.0):
    """深沟球轴承：内圈、外圈、一圈钢球"""
    t = (r_out - r_in) * .28
    ring_x(H, bm, c, r_out - t, r_out, x - w / 2, x + w / 2, 0)
    ring_x(H, bm, c, r_in, r_in + t, x - w / 2, x + w / 2, 0)
    rb = (r_out - r_in) / 2 - t * .55
    rm = (r_in + r_out) / 2
    n = max(7, int(2 * pi * rm / (2.5 * rb)))
    for k in range(n):
        a = 2 * pi * k / n
        H.ball(bm, (x, c[0] + rm * cos(a), c[1] + rm * sin(a)), rb, 1, 8)


def bolts(H, bm, c, r, n, x0, x1, rb, mi, a0=0.0):
    """一圈螺栓头"""
    for k in range(n):
        a = a0 + 2 * pi * k / n
        H.cyl(bm, (x0, c[0] + r * cos(a), c[1] + r * sin(a)), (x1, c[0] + r * cos(a), c[1] + r * sin(a)), rb, mi=mi, seg=6,
              smooth=False)


# ---------------------------------------------------------------- 零件说明（给网页，写给没学过机械的人看）
GROUPS = {}
EXPL = {}


def grp(key, cn, en, desc, ex=(0, 0, 0, 0)):
    GROUPS[key] = dict(cn=cn, en=en, desc=desc)
    EXPL[key] = list(ex)
    return key


def describe():
    grp('eng_block', '发动机缸体', 'Engine block',
        '一整块铸铝，里面有四个圆筒（气缸）。汽油在气缸里烧，把活塞往下推。这台是 1.5 L 四缸；在混动车里它大部分时间只管发电，'
        '高速巡航时才直接推车。', (420, 260, 0, .30))
    grp('eng_head', '缸盖和气门室盖', 'Cylinder head',
        '盖在气缸上面的“盖子”。每个气缸有四个气门（两进两排）、一个火花塞；上面两根凸轮轴负责按时把气门顶开。', (420, 0, 380, .22))
    grp('valvetrain', '凸轮轴、气门和正时链', 'Camshafts, valves & timing chain',
        '气门是气缸的门：进气门开，空气和汽油进来；排气门开，废气出去。凸轮轴上的“桃尖”转到下面时把气门压开。链条让凸轮轴正好'
        '转曲轴的一半快。这台发动机进气门关得特别晚（阿特金森循环）：压缩行程开头把一部分空气推回去，少压一点、多膨胀一点，更省油。',
        (420, 0, 520, .26))
    grp('intake', '进气歧管和节气门', 'Intake manifold',
        '空气从空滤进来，经节气门（一个电动的阀门，开多大就进多少气）到稳压腔，再分四路进四个气缸。汽油在进气道里喷进去。',
        (420, 420, 240, .18))
    grp('exhaust', '排气歧管和三元催化器', 'Exhaust manifold & catalyst',
        '烧完的废气从这里出去。紧挨着的圆筒是三元催化器，把有害气体变成水、二氧化碳和氮气；它要几百度才起作用，所以冷车时'
        '发动机会特意多转一会儿把它烤热。', (420, -380, 120, .14))
    grp('crank', '曲轴和飞轮减振器', 'Crankshaft & flywheel damper',
        '活塞上下动，曲轴把它变成转动，像脚踩自行车的曲柄。左端的大圆盘是飞轮减振器：里面有一圈弹簧，把发动机一下一下的冲击'
        '缓成平稳的转动，再传给后面的输入轴。混动车没有起动机，起动发动机靠发电机反过来拖。', (420, 0, -160, .40))
    grp('piston', '活塞和连杆', 'Pistons & connecting rods',
        '活塞像打气筒里的塞子，在气缸里上下跑；连杆把它和曲轴连起来。四个活塞轮流做功，顺序是 1-3-4-2。'
        '发动机熄火时它们一动不动，这就是纯电行驶省油的地方。', (420, 0, 460, .48))
    grp('input', '输入轴和发电机大齿轮', 'Input shaft',
        '接在飞轮后面，永远和发动机一样快。轴上固定着一个大齿轮，带着发电机转；再往左是离合器的内毂。', (-60, 260, -200, .44))
    grp('clutch', '直连离合器', 'Lock-up clutch',
        '整套系统里唯一的离合器：一叠交替排列的摩擦片和钢片，泡在油里。油压一推，片子压紧，发动机就和车轮连上了；松开就各转各的。',
        (-60, 300, -60, .50))
    grp('edrive', '直驱齿轮和离合器外鼓', 'Engine-drive gear',
        '空套在输入轴上的大齿轮，和中间轴一直咬着，所以它永远跟着车轮转。离合器压紧以后它才和发动机连成一体，'
        '发动机就通过它直接推车（只有这一个固定的速比）。', (-60, 340, 80, .52))
    grp('gen_rotor', '发电机转子和轴', 'Generator rotor',
        '一根细长的轴，一头是小齿轮（被输入轴的大齿轮带着，转得比发动机快一倍），穿过驱动电机的空心轴，另一头是发电机的转子。'
        '转子里埋着永磁体（红蓝两色表示南北极），它一转，定子线圈里就发出电。', (-560, 0, 0, .34))
    grp('gen_stator', '发电机定子', 'Generator stator',
        '不转的那一圈：一叠硅钢片，槽里嵌着扁铜线。转子的磁铁扫过去，铜线里就感应出三相交流电，由上面的三根铜排送进 PCU。'
        '起动发动机时反过来通电，它就是起动机。', (-440, 0, 0, .30))
    grp('mot_rotor', '驱动电机转子和空心轴', 'Traction motor rotor',
        '真正推车的转子。它的轴是空心的，发电机的轴从中间穿过去，两根轴同心但各转各的。轴的右端是一个小齿轮，'
        '经中间轴和差速器减速 8.4 倍到车轮。它和车轮之间没有离合器，车走它就转。', (-300, 0, 0, .28))
    grp('mot_stator', '驱动电机定子', 'Traction motor stator',
        '不转的那一圈铁芯和扁铜线。PCU 往里通三相交流电，产生一个旋转的磁场，拉着转子转；松油门时反过来，'
        '转子拖着磁场转，铜线里发出电给电池充电（能量回收）。', (-200, 0, 0, .24))
    grp('counter', '中间轴', 'Counter shaft',
        '两条路在这里汇合：驱动电机的小齿轮和发动机的直驱齿轮都咬在它的大齿轮上；轴的另一头是个小齿轮，去带差速器的大齿圈。',
        (-60, -300, 200, .40))
    grp('diff', '差速器和大齿圈', 'Differential',
        '最后一级减速。差速器的本事是转弯时让左右两个轮子转得不一样快。左右各伸出一根半轴到前轮。', (-60, -260, -240, .36))
    grp('halfshaft', '半轴', 'Drive shafts',
        '从差速器到前轮的两根轴。两头的“球笼”是万向节，让车轮上下跳、左右转向时还能传动。', (0, -200, -340, .30))
    grp('bearing', '轴承和旋变', 'Bearings & resolvers',
        '每根轴都靠轴承架在壳体上：两个钢圈中间夹一圈钢球，轴在里面转，摩擦很小。电机轴尾上的小圈是旋转变压器，'
        '告诉 PCU 转子现在转到了哪个角度。', (-120, 0, -420, .46))
    grp('case', '电驱单元壳体', 'Drive unit housing',
        '把齿轮、离合器和两台电机装在一起的铸铝壳。本田叫它电气式无级变速器（e-CVT），但里面没有钢带也没有挡位。'
        '“无级”指的是发动机转速可以由发电机随意调，不用跟着车速。', (-700, 0, 0, .12))
    grp('pcu', 'PCU 和三相铜排', 'Power control unit',
        '电的总调度。电池给的是直流电，电机要的是三相交流电，PCU 里的逆变器负责来回转换，还带一个升压器把电池的一百多伏'
        '升到几百伏。它直接坐在电机壳上，六根铜排（每台电机三根）从底下插进电机。', (-120, 0, 420, .10))
    grp('hv', '高压线', 'High-voltage cable',
        '两根橙色的粗线（正、负），从 PCU 沿地板下面走到车尾的电池。橙色是高压电的统一标记，修车时见到橙色线不能随便碰。',
        (0, 0, -160, .08))
    grp('ipu', '动力电池', 'Battery pack (IPU)',
        '48 个锂电池单体串起来，约 173 V，容量只有 1 度电左右，立在后排座椅靠背后面。它不负责跑长途，只当缓冲：'
        '刹车时把电存进来，起步和加速时放出去，让发动机可以挑省油的时候才工作。', (0, -420, 200, .10))
    grp('bay', '空滤、电瓶和电动附件', 'Air box, 12 V battery & electric auxiliaries',
        '空滤盒在发动机前面。12 V 小电瓶给灯和电脑供电，由高压电池降压充电，所以没有皮带带的发电机。空调压缩机和刹车助力'
        '也都是电动的：发动机熄火时空调照样凉、刹车照样轻。', (0, 520, 300, .06))
    grp('mount', '悬置', 'Mounts', '把动力总成挂在车身纵梁上的橡胶垫，隔开振动。', (0, 0, -300, .30))


# ---------------------------------------------------------------- 建模
def build(M, H):
    """建混动的全部件。H 是 build_car 里的工具函数（add / rbox / cyl / ball / lathe / grp / skin_top_z / principled）"""
    rbox, cyl, lathe, ball = H.rbox, H.cyl, H.lathe, H.ball
    BB.clear()
    GROUPS.clear()
    EXPL.clear()
    describe()
    H.grp('ehev', '混动动力总成', (0, 1700, 250))
    pr = H.principled
    alu, alu2, iron, steel, blk, rub = M['castalu'], M['castalu2'], M['castiron'], M['steel'], M['plastic'], M['rubber']
    X_ = dict(
        copper=pr('H_Copper', '#c8793a', metal=.95, rough=.32),
        lam=pr('H_Lamination', '#4c5560', metal=.85, rough=.42),
        magn=pr('H_MagnetN', '#d2463c', metal=.3, rough=.4),
        mags=pr('H_MagnetS', '#3a78d2', metal=.3, rough=.4),
        fric=pr('H_Friction', '#8a5a2c', rough=.8),
        plate=pr('H_ClutchSteel', '#b9c0c7', metal=.9, rough=.35),
        brg=pr('H_Bearing', '#c9cfd6', metal=.95, rough=.2),
        burn=pr('H_Burn', '#ffb05a', rough=.4, emit=('#ff7a1a', 2.0), alpha=.85),
        pcu=pr('H_PcuCase', '#8f99a4', metal=.8, rough=.42),
        cell=pr('H_Cell', '#2f6f95', metal=.3, rough=.45),
        tray=pr('H_Tray', '#2a2f36', metal=.5, rough=.5),
        resin=pr('H_Resin', '#22262b', rough=.55),
        shield=pr('H_HeatShield', '#b3b1aa', metal=.9, rough=.5),
        plug=pr('H_Ceramic', '#e7e3d8', rough=.4),
    )
    hv = M['hv']

    def put(name, bm, mats, group, loc=(0, 0, 0), ang=40, **extras):
        lv = Vector(loc)
        BB[name] = [tuple(v.co + lv) for v in bm.verts]
        extras['g'] = group
        return H.add('H_' + name, bm, mats, 'ehev', loc=loc, ang=ang, coll='PowertrainE', extras=extras)

    EL = (XE, YC, ZC)
    BH, HW, DECK, HEAD, COVER, COIL, PAN = (E[k] for k in ('block_half', 'half_w', 'deck', 'head_top', 'cover_top', 'coil_top',
                                                           'pan_bot'))
    rbore = E['bore'] / 2

    # ================================================================ 发动机：不动的件
    # 缸体沿曲轴中心线所在的竖直面切成前后两半：网页里藏掉前半块，就能看见活塞在半个缸筒里上下跑
    for tag, sy in (('F', 1), ('R', -1)):
        pts = [(-BH, 0.0)] if sy > 0 else [(BH, 0.0)]
        for xc in (sorted(CYL_X) if sy > 0 else sorted(CYL_X, reverse=True)):
            for k in range(13):
                a = pi - pi * k / 12 if sy > 0 else -pi * k / 12
                pts.append((xc + (rbore + .6) * cos(a), (rbore + .6) * sin(a)))
        pts += [(BH, 0.0), (BH, 88.0), (-BH, 88.0)] if sy > 0 else [(-BH, 0.0), (-BH, -88.0), (BH, -88.0)]
        b = bmesh.new()
        prism_z(b, pts, 70.0, DECK, 0)                                               # 气缸部分（带半个缸筒）
        rbox(b, (0, sy * (HW - 8), 4), (2 * BH, 16, 132), 5, 0, 1)                   # 曲轴箱侧墙
        for sx in (-1, 1):
            rbox(b, (sx * (BH - 6), sy * (HW - 8) / 2 + sy * 3, 4), (12, HW - 14, 132), 3, 0, 1)   # 两端的墙
        for xr in (-123, -41, 41, 123):                                              # 外面的加强筋
            rbox(b, (xr, sy * 91, (70 + DECK) / 2), (10, 8, DECK - 76), 3, 0, 1)
        rbox(b, (0, sy * 92, 150), (2 * BH - 30, 8, 12), 3, 0, 1)
        put(f'Eng_Block{tag}', b, [alu], 'eng_block', loc=EL, kind='housing', half=tag)
    b = bmesh.new()
    rbox(b, (0, 0, (PAN - 62) / 2), (2 * BH - 14, 2 * HW - 14, -62 - PAN), 18, 0, 2)   # 油底壳
    for k in range(5):
        rbox(b, (-120 + k * 60, 0, PAN - 2), (8, 2 * HW - 50, 8), 2, 0, 1)             # 底下的散热筋
    cyl(b, (60, HW - 4, -20), (60, HW + 86, -20), 38, mi=1, seg=20)                    # 机油滤清器
    put('Eng_Pan', b, [M['pan'], M['filter']], 'eng_block', loc=EL, kind='housing')
    b = bmesh.new()
    rbox(b, (BH + 16, 0, 165), (32, 2 * HW + 6, 470), 12, 0, 2)                        # 正时罩盖
    for k in range(4):
        rbox(b, (BH + 33, 0, 20 + k * 100), (4, 2 * HW - 30, 10), 2, 0, 1)
    cyl(b, (BH + 30, -62, 10), (BH + 74, -62, 10), 34, mi=1, seg=20)                   # 电动水泵（没有皮带，自己带电机）
    cyl(b, (BH + 74, -62, 10), (BH + 88, -62, 10), 20, mi=2, seg=14)
    cyl(b, (BH + 30, 0, 0), (BH + 46, 0, 0), 40, mi=0, seg=24)                         # 曲轴前油封座
    put('Eng_Front', b, [alu2, blk, M['conn']], 'eng_block', loc=EL, kind='housing')

    b = bmesh.new()
    rbox(b, (0, 0, (DECK + HEAD) / 2), (2 * BH, 2 * HW - 4, HEAD - DECK), 8, 0, 2)     # 缸盖
    for xc in CYL_X:
        cyl(b, (xc, HW - 2, 262), (xc, HW + 12, 264), 23, mi=0, seg=14)                # 进气道法兰
    put('Eng_Head', b, [alu], 'eng_head', loc=EL, kind='housing')
    b = bmesh.new()
    rbox(b, (0, 0, (HEAD + COVER) / 2), (2 * BH - 16, 186, COVER - HEAD), 22, 0, 3)    # 气门室盖
    for xc in CYL_X:
        cyl(b, (xc, 0, COVER - 6), (xc, 0, COIL), 17, mi=1, seg=14)                    # 点火线圈
        rbox(b, (xc, 20, COIL - 6), (22, 26, 12), 3, 1, 1)
    cyl(b, (-118, 56, COVER - 4), (-118, 56, COVER + 10), 24, mi=1, seg=18)            # 机油加注盖
    cyl(b, (BH - 6, E['cam_y'], E['cam_z']), (BH + 44, E['cam_y'], E['cam_z']), 46, mi=2, seg=22)   # 进气凸轮轴上的电动可变正时（VTC）
    cyl(b, (BH + 44, E['cam_y'], E['cam_z']), (BH + 64, E['cam_y'], E['cam_z']), 30, mi=1, seg=16)
    put('Eng_Cover', b, [blk, M['conn'], alu2], 'eng_head', loc=EL, kind='housing')
    b = bmesh.new()
    for xc in CYL_X:                                                                   # 火花塞（缸盖藏起来以后看得见）
        cyl(b, (xc, 0, DECK + 6), (xc, 0, DECK + 22), 6, mi=0, seg=10)
        cyl(b, (xc, 0, DECK + 22), (xc, 0, DECK + 70), 8, mi=1, seg=10)
        cyl(b, (xc, 0, DECK + 2), (xc, 0, DECK + 6), 2, mi=0, seg=6)
    put('Eng_Plugs', b, [steel, X_['plug']], 'valvetrain', loc=EL, kind='static')

    b = bmesh.new()
    cyl(b, (-150, 215, 250), (150, 215, 250), 52, mi=0, seg=24)                        # 进气稳压腔
    for sx in (-150, 150):
        ball(b, (sx, 215, 250), 52, 0, 16, sc=(.45, 1, 1))
    for xc in CYL_X:
        PT.pipe(b, [(xc, 215, 296), (xc, 190, 318), (xc, 140, 300), (xc, HW + 8, 266)], 42, mi=0)   # 四根弯的进气管
        cyl(b, (xc, 118, 296), (xc, 104, 274), 7, mi=2, seg=8)                         # 喷油器
    cyl(b, (-150, 215, 250), (-188, 215, 250), 33, mi=1, seg=20)                       # 电子节气门
    rbox(b, (-172, 215, 296), (30, 44, 34), 5, 3, 1)
    cyl(b, (-142, 118, 296), (142, 118, 296), 8, mi=2, seg=10)                         # 油轨
    put('Eng_Intake', b, [X_['resin'], alu2, steel, M['conn']], 'intake', loc=EL, kind='housing')
    b = bmesh.new()
    for xc in CYL_X:
        PT.pipe(b, [(xc, -HW + 4, 262), (xc * .7, -140, 256), (xc * .25, -180, 240), (xc * .1, -185, 226)], 36, mi=0)
    cyl(b, (0, -185, 232), (0, -185, 204), 30, 56, 0, seg=24)
    cyl(b, (0, -185, 204), (0, -185, 10), 57, mi=1, seg=24)                            # 三元催化器
    cyl(b, (0, -185, 10), (0, -185, -18), 57, 27, 0, seg=24)
    rbox(b, (0, -150, 284), (300, 70, 6), 3, 2, 1, rot=(Vector((1, 0, 0)), -18))       # 歧管上的隔热罩
    cyl(b, (40, -246, 150), (40, -226, 150), 8, mi=3, seg=8)                           # 氧传感器
    put('Eng_Exhaust', b, [iron, M['exh'], X_['shield'], steel], 'exhaust', loc=EL, kind='housing')
    b = bmesh.new()
    PT.band(b, PT.hull_circles([(0, 0, 31), (E['cam_y'], E['cam_z'], 60), (-E['cam_y'], E['cam_z'], 60)]), 189, 10, 5, 0)
    put('Eng_Chain', b, [steel], 'valvetrain', loc=EL, kind='static')

    # ================================================================ 发动机：会动的件
    b = bmesh.new()
    for xm in (-2 * E['pitch'], -E['pitch'], 0, E['pitch'], 2 * E['pitch']):           # 5 道主轴颈
        cyl(b, (xm - 11, 0, 0), (xm + 11, 0, 0), 25, mi=0, seg=24)
    cyl(b, (2 * E['pitch'], 0, 0), (BH + 40, 0, 0), 18, mi=0, seg=16)
    cyl(b, (-BH - 10, 0, 0), (-2 * E['pitch'], 0, 0), 30, mi=0, seg=20)
    for xc, up in zip(CYL_X, CRANK_UP):
        sg = 1 if up else -1
        cyl(b, (xc - 11, 0, sg * R_CRANK), (xc + 11, 0, sg * R_CRANK), 22, mi=0, seg=20)        # 连杆轴颈
        for dx in (-18.5, 18.5):
            rbox(b, (xc + dx, 0, sg * (R_CRANK + 24 - 58) / 2), (12, 74, R_CRANK + 24 + 58), 8, 0, 1)   # 曲柄臂
            arc_solid(b, 30, 68, xc + dx - 6, xc + dx + 6, -sg * pi / 2 - 1.05, -sg * pi / 2 + 1.05, 10, 0)   # 扇形平衡块
    gear(b, 182, 196, 20, 2.9, 1)                                                               # 正时链轮
    put('Eng_Crank', b, [steel, M['gear']], 'crank', loc=EL, kind='rot', shaft='crank', side='eng')
    rb, ch = rbore - .4, E['comp_h']
    for i, xc in enumerate(CYL_X):
        b = bmesh.new()
        lathe(b, [(0, ch - 3.5), (20, ch - 3.5), (26, ch), (rb, ch), (rb, ch - 6), (rb - 1.4, ch - 6), (rb - 1.4, ch - 8),
                  (rb, ch - 8), (rb, ch - 12), (rb - 1.4, ch - 12), (rb - 1.4, ch - 14), (rb, ch - 14), (rb, -22), (rb - 5, -24),
                  (0, -24)], (0, 0, 0), 'Z', 28, 0)
        cyl(b, (-28, 0, 0), (28, 0, 0), 9, mi=1, seg=12)                                        # 活塞销
        put(f'Eng_Piston{i + 1}', b, [alu2, steel], 'piston', loc=(XE + xc, YC, ZC + PIN_Z[i]), kind='piston', cyl=i + 1,
            phase=0 if CRANK_UP[i] else 180, side='eng')
        b = bmesh.new()
        L = E['rod']
        cyl(b, (-10, 0, 0), (10, 0, 0), 14, mi=0, seg=16)                                       # 小头
        rbox(b, (0, 0, -L / 2), (4, 22, L - 44), 1.5, 0, 1)                                     # 工字形杆身：中间的腹板
        for sy in (-1, 1):
            rbox(b, (0, sy * 11, -L / 2), (12, 4, L - 50), 1.5, 0, 1)                           # 两边的翼缘
        cyl(b, (-10.5, 0, -L), (10.5, 0, -L), 31, mi=0, seg=20)                                 # 大头
        for sy in (-1, 1):
            cyl(b, (0, sy * 27, -L - 22), (0, sy * 27, -L + 20), 5, mi=0, seg=8)                # 大头盖螺栓
        put(f'Eng_Rod{i + 1}', b, [steel], 'piston', loc=(XE + xc, YC, ZC + PIN_Z[i]), kind='rod', cyl=i + 1,
            phase=0 if CRANK_UP[i] else 180, side='eng')
        b = bmesh.new()
        lathe(b, [(0, 0), (rbore - 1, 0), (rbore - 1, 3), (0, 3)], (0, 0, 0), 'Z', 24, 0)       # 燃烧的闪光（网页里按点火时刻亮）
        put(f'Burn{i + 1}', b, [X_['burn']], 'piston', loc=(XE + xc, YC, ZC + DECK), kind='burn', cyl=i + 1)
    order = {c: k for k, c in enumerate(E['firing'])}
    va = radians(E['valve_angle'])
    VAL = HV['valve']
    for tag, sy in (('In', 1), ('Ex', -1)):
        b = bmesh.new()
        cyl(b, (-160, 0, 0), (182, 0, 0), 12, mi=0, seg=16)
        o_, c_ = VAL['in'] if sy > 0 else VAL['ex']
        mid = (o_ + c_) / 2                                         # 气门开到最大时的曲轴转角
        for i, xc in enumerate(CYL_X):
            # 凸轮尖的初始朝向：凸轮轴转速是曲轴的一半，所以初始角 = 气门杆方向的角度 + 那一刻曲轴转角的一半
            ph = radians(90 * order[i + 1] + (90 - sy * E['valve_angle']) + mid / 2 - 180)
            for dx in (-17, 17):
                cyl(b, (xc + dx - 6, 5 * cos(ph), 5 * sin(ph)), (xc + dx + 6, 5 * cos(ph), 5 * sin(ph)), 17, mi=0, seg=18)
        gear(b, 182, 196, 40, 2.9, 1)
        put(f'Eng_Cam{tag}', b, [steel, M['gear']], 'valvetrain', loc=(XE, YC + sy * E['cam_y'], ZC + E['cam_z']), kind='rot',
            shaft='cam', side='eng')
        d = Vector((0, sy * sin(va), cos(va)))
        rh = 14.5 if sy > 0 else 12.5
        for i, xc in enumerate(CYL_X):
            b = bmesh.new()
            for dx in (-17, 17):
                o = Vector((dx, 0, 0))
                cyl(b, o, o + d * 3, rh, mi=0, seg=16)
                cyl(b, o + d * 3, o + d * 14, rh, 3, 0, seg=16)
                cyl(b, o + d * 14, o + d * 100, 2.8, mi=0, seg=8)
                cyl(b, o + d * 62, o + d * 90, 10, mi=1, seg=12)
                cyl(b, o + d * 90, o + d * 102, 14, mi=0, seg=14)
            put(f'Eng_Valve{tag}{i + 1}', b, [steel, M['spring']], 'valvetrain', loc=(XE + xc, YC + sy * 17, ZC + DECK + 3),
                kind='valve', cyl=i + 1, vside=tag.lower(), dir=[0, round(-d.y, 4), round(-d.z, 4)], lift=E['valve_lift'], side='eng')

    # ================================================================ 电驱单元：齿轮的相位（让齿对上齿槽）
    hx = HELIX
    ph_ig = 0.0
    ph_gp = mesh_phase(AX_I, T['zig'], ph_ig, AX_M, T['zgp'])
    ph_cd = 0.0
    ph_ed = mesh_phase(AX_C, T['zcd'], ph_cd, AX_I, T['zed'])
    ph_m = mesh_phase(AX_C, T['zcd'], ph_cd, AX_M, T['zm'])
    ph_f = 0.0
    ph_r = mesh_phase(AX_C, T['zf'], ph_f, AX_D, T['zr'])
    XG, XF, XCL, XP, XW, XM, XMID, XGN, XCV = (X[k] for k in ('gen_gear', 'final', 'clutch', 'p1', 'wall', 'mot', 'mid', 'gen', 'cover'))
    CW = X['coil']                                                    # 绕组端部伸出铁芯多长
    xbell0, xbell1 = X['bell']

    # ---- 飞轮减振器 + 输入轴（跟曲轴转）
    b = bmesh.new()
    lathe(b, [(0, xbell0 - 10), (40, xbell0 - 10), (118, xbell0 - 14), (126, xbell0 - 20), (126, xbell0 - 34), (118, xbell0 - 38),
              (40, xbell0 - 40), (0, xbell0 - 40)], (0, 0, 0), 'X', 44, 0)                    # 飞轮盘
    for k in range(6):                                                                         # 减振弹簧：沿圆周躺着的六个
        a = 2 * pi * k / 6
        c0 = Vector((xbell0 - 43, 84 * cos(a - .2), 84 * sin(a - .2)))
        c1 = Vector((xbell0 - 43, 84 * cos(a + .2), 84 * sin(a + .2)))
        cyl(b, c0, c1, 9, mi=1, seg=10)
    lathe(b, [(20, xbell0 - 40), (60, xbell0 - 40), (60, xbell0 - 47), (20, xbell0 - 47)], (0, 0, 0), 'X', 28, 0, closed=True)   # 从动盘毂
    bolts(H, b, (0, 0), 30, 8, xbell0 - 10, xbell0 - 4, 6, 0)
    put('Flywheel', b, [steel, M['spring']], 'crank', loc=(0, *AX_I), kind='rot', shaft='crank', side='eng')
    b = bmesh.new()
    cyl(b, (xbell0 - 40, 0, 0), (XP[1] - 2, 0, 0), 15, mi=0, seg=20)                           # 输入轴
    gear(b, XG[0], XG[1], T['zig'], T['mg'], 1, ph_ig, hx, bore=24)                            # 带发电机的大齿轮
    lathe(b, [(15, XG[0] + 2), (30, XG[0] + 2), (30, XG[1] - 2), (15, XG[1] - 2)], (0, 0, 0), 'X', 20, 0, closed=True)
    lathe(b, [(15, XCL[0]), (34, XCL[0]), (34, XCL[1]), (30, XCL[1]), (30, XCL[0] - 4), (15, XCL[0] - 4)], (0, 0, 0), 'X', 28, 0,
          closed=True)                                                                         # 离合器内毂
    put('InputShaft', b, [steel, M['gear']], 'input', loc=(0, *AX_I), kind='rot', shaft='crank', side='eng')
    # ---- 离合器：摩擦片跟输入轴，钢片跟外鼓
    n_disc = 4
    step = (XCL[0] - XCL[1] - 6) / n_disc
    b = bmesh.new()
    for k in range(n_disc):
        x = XCL[0] - 3 - k * step
        ring_x(H, b, (0, 0), 34, 54, x - 2.4, x, 0, 36)
    put('ClutchInner', b, [X_['fric']], 'clutch', loc=(0, *AX_I), kind='rot', shaft='crank', side='eng', clutch='inner')
    b = bmesh.new()
    for k in range(n_disc):
        x = XCL[0] - 3 - k * step - step / 2
        ring_x(H, b, (0, 0), 40, 60, x - 2.0, x, 0, 36)
    put('ClutchOuter', b, [X_['plate']], 'clutch', loc=(0, *AX_I), kind='rot', shaft='od', side='wheel', clutch='outer')
    b = bmesh.new()
    ring_x(H, b, (0, 0), 36, 58, XCL[1] + 1.5, XCL[1] - 1.5, 0, 36)                            # 油压活塞（在外鼓的底上，往发动机那边推）
    put('ClutchPiston', b, [alu2], 'clutch', loc=(0, *AX_I), kind='rot', shaft='od', side='wheel', clutch='piston')
    # ---- 直驱齿轮 + 离合器外鼓（空套在输入轴上，跟车轮转）
    b = bmesh.new()
    gear(b, XP[0], XP[1], T['zed'], T['m1'], 0, ph_ed, hx, bore=20)
    lathe(b, [(20, XP[0] + 2), (64, XP[0] + 2), (64, XCL[0] + 1), (61, XCL[0] + 1), (61, XP[0] - 2), (20, XP[0] - 2)], (0, 0, 0),
          'X', 44, 1, closed=True)                                                             # 外鼓：一个朝发动机开口的杯子
    put('OdGear', b, [M['gear'], alu2], 'edrive', loc=(0, *AX_I), kind='rot', shaft='od', side='wheel')

    # ---- 发电机轴（细长，穿过空心轴）+ 发电机转子
    def rotor(bm, o, x0, x1, r_in):
        """内置式永磁转子：硅钢片叠成的圆柱，每个磁极埋两块排成 V 形的磁钢。磁钢两头比铁芯长出 0.8，端面上看得见"""
        rr = o['rr']
        lathe(bm, [(r_in, x0), (rr, x0), (rr, x1), (r_in, x1)], (0, 0, 0), 'X', 56, 0, closed=True)
        ring_x(H, bm, (0, 0), r_in + 2, rr - 16, min(x0, x1) - 3, max(x0, x1) + 3, 3, 40)      # 两头的端板
        npole = o['poles']
        pp = 2 * pi / npole
        for k in range(npole):
            a = k * pp
            for sgn in (-1, 1):
                am = a + sgn * .26 * pp
                rc = rr - 9.5
                c = Vector((0, rc * cos(am), rc * sin(am)))
                tang = Vector((0, -sin(am), cos(am)))
                rad = Vector((0, cos(am), sin(am)))
                # 磁钢的宽边：从切向往里转 26°，两块凑成一个开口朝外的 V
                wdir = (tang * cos(radians(26)) - rad * sgn * sin(radians(26))).normalized()
                beam(bm, c + Vector((min(x0, x1) - .8, 0, 0)), c + Vector((max(x0, x1) + .8, 0, 0)), rr * .2, 4.2, wdir,
                     1 if k % 2 == 0 else 2)

    b = bmesh.new()
    cyl(b, (XG[0] + 6, 0, 0), (XCV[0] + 4, 0, 0), 9.5, mi=4, seg=16)                           # 细长的发电机轴
    gear(b, XG[0], XG[1], T['zgp'], T['mg'], 5, ph_gp, -hx, bore=9.5)
    lathe(b, [(9.5, XGN[0] + 10), (30, XGN[0] + 6), (30, XGN[1] - 6), (9.5, XGN[1] - 10)], (0, 0, 0), 'X', 24, 4, closed=True)   # 转子毂
    rotor(b, GEN, XGN[0], XGN[1], 30)
    put('GenShaft', b, [X_['lam'], X_['magn'], X_['mags'], alu2, steel, M['gear']], 'gen_rotor', loc=(0, *AX_M), kind='rot',
        shaft='gen', side='eng')
    # ---- 驱动电机的空心轴 + 小齿轮 + 转子
    b = bmesh.new()
    lathe(b, [(12, XP[0] + 6), (18, XP[0] + 6), (18, XMID[0] + 2), (12, XMID[0] + 2)], (0, 0, 0), 'X', 24, 4, closed=True)   # 空心轴
    gear(b, XP[0], XP[1], T['zm'], T['m1'], 5, ph_m, hx, bore=12)
    lathe(b, [(18, XM[0] + 10), (36, XM[0] + 6), (36, XM[1] - 6), (18, XM[1] - 10)], (0, 0, 0), 'X', 24, 4, closed=True)
    rotor(b, MOT, XM[0], XM[1], 36)
    put('MotShaft', b, [X_['lam'], X_['magn'], X_['mags'], alu2, steel, M['gear']], 'mot_rotor', loc=(0, *AX_M), kind='rot',
        shaft='motor', side='wheel')

    # ---- 定子：硅钢片铁芯（齿 + 轭）+ 槽里的扁铜线 + 两头编成篮子一样的端部。剖掉前上方四分之一，好看见里面的转子
    def stator(o, x0, x1):
        ns, ri, ro, dp = o['slots'], o['ri'], o['ro'], o['depth']
        p = 2 * pi / ns
        xa, xb_ = max(x0, x1), min(x0, x1)
        out = {'': bmesh.new(), 'Q': bmesh.new()}

        def which(a):
            return 'Q' if 0 <= (a % (2 * pi)) < pi / 2 else ''
        for key, a0, a1, seg in (('', pi / 2, 2 * pi, 54), ('Q', 0.0, pi / 2, 18)):
            arc_solid(out[key], ri + dp, ro, xb_, xa, a0, a1, seg, 0)                            # 轭
        for k in range(ns):
            at = k * p                                                                         # 齿的中心
            asl = (k + .5) * p                                                                  # 槽的中心
            arc_solid(out[which(at + 1e-4)], ri, ri + dp + .5, xb_, xa, at - .22 * p, at + .22 * p, 1, 0)
            bm = out[which(asl)]
            arc_solid(bm, ri + 1.6, ri + dp + .5, xb_ - .6, xa + .6, asl - .27 * p, asl + .27 * p, 1, 1)   # 槽里的铜
            for li, sg in ((0, 1), (1, -1)):                                                    # 端部：两层扁线一层往左斜、一层往右斜
                r = ri + 5 + li * (dp - 9)
                a2 = asl + sg * 3 * p
                for xe, dx in ((xa, CW), (xb_, -CW)):
                    p0 = (xe, r * cos(asl), r * sin(asl))
                    p1 = (xe + dx, r * cos((asl + a2) / 2), r * sin((asl + a2) / 2))
                    rad = (0, cos(asl), sin(asl))
                    beam(bm, p0, p1, (dp - 9) * .8, 3.2, rad, 1)
        return out

    for tag, o, xr, gk in (('Mot', MOT, XM, 'mot_stator'), ('Gen', GEN, XGN, 'gen_stator')):
        st = stator(o, xr[0], xr[1])
        for key, bm in st.items():
            put(f'{tag}Stator{key}', bm, [X_['lam'], X_['copper']], gk, loc=(0, *AX_M), kind='static', cut=1 if key else 0)

    # ---- 中间轴、差速器
    b = bmesh.new()
    cyl(b, (xbell1 - 4, 0, 0), (XW[0], 0, 0), 15, mi=0, seg=18)
    gear(b, XP[0], XP[1], T['zcd'], T['m1'], 1, ph_cd, -hx, bore=20)
    gear(b, XF[0], XF[1], T['zf'], T['mf'], 1, ph_f, hx, bore=15)
    put('Counter', b, [steel, M['gear']], 'counter', loc=(0, *AX_C), kind='rot', shaft='counter', side='wheel')
    X_DL, X_DR = XW[0] - 6, xbell1 + 44
    b = bmesh.new()
    gear(b, XF[0], XF[1], T['zr'], T['mf'], 1, ph_r, -hx, bore=56)
    lathe(b, [(0, X_DL), (30, X_DL), (38, X_DL + 10), (50, XF[1] - 6), (58, XF[1] + 2), (58, XF[0] + 6), (44, X_DR - 24), (30, X_DR), (0, X_DR)],
          (0, 0, 0), 'X', 32, 0)
    bolts(H, b, (0, 0), 64, 10, XF[0], XF[0] + 6, 5, 2)
    put('Diff', b, [iron, M['gear'], steel], 'diff', loc=(0, *AX_D), kind='rot', shaft='diff', side='wheel')

    # ---- 轴承和旋变（不转，画出来是为了说明轴是怎么架在壳体上的）
    b = bmesh.new()
    bearing(H, b, AX_I, xbell1 - 2, 15, 30, 12)
    bearing(H, b, AX_I, XW[0] + 2, 12, 26, 10)
    bearing(H, b, AX_M, XG[0] + 12, 9.5, 22, 10)
    bearing(H, b, AX_M, XCV[0] + 2, 9.5, 22, 10)
    bearing(H, b, AX_M, (XW[0] + XW[1]) / 2, 18, 34, 10)
    bearing(H, b, AX_M, (XMID[0] + XMID[1]) / 2, 18, 34, 10)
    bearing(H, b, AX_C, xbell1 - 2, 15, 30, 12)
    bearing(H, b, AX_C, XW[0] + 2, 15, 30, 10)
    bearing(H, b, AX_D, X_DL + 4, 30, 46, 12)
    bearing(H, b, AX_D, X_DR - 4, 30, 46, 12)
    ring_x(H, b, AX_M, 22, 34, XCV[0] + 2, XCV[0] + 8, 2, 24)                                   # 发电机的旋变（轴尾，端盖里面）
    ring_x(H, b, AX_M, 40, 52, XW[1] - 2, XW[1] - 9, 2, 24)                                     # 驱动电机的旋变（靠齿轮腔的隔板）
    put('Bearings', b, [X_['brg'], steel, X_['copper']], 'bearing', kind='static')

    # ---- 壳体
    x_m0 = XW[1]                       # 电机腔从隔板后面开始
    x_g0 = XMID[1]
    x_end = XCV[1]
    b = bmesh.new()
    lathe(b, [(150, xbell0), (150, xbell0 - 30), (136, xbell1)], (0, AX_I[0], AX_I[1]), 'X', 44, 0)            # 飞轮壳
    bolts(H, b, AX_I, 143, 10, xbell0, xbell0 - 10, 7, 2, .2)
    PT.prism(b, PT.hull_circles([(*AX_I, 92), (*AX_M, 56), (*AX_C, 76), (*AX_D, 106)]), xbell1, XW[1], 0)       # 齿轮腔
    lathe(b, [(0, x_m0), (MOT['ro'] + 12, x_m0), (MOT['ro'] + 12, x_g0), (GEN['ro'] + 12, x_g0 - 8), (GEN['ro'] + 12, XCV[0]),
              (GEN['ro'] + 4, x_end), (0, x_end)], (0, AX_M[0], AX_M[1]), 'X', 48, 0)                           # 两台电机的筒
    for xf in (x_m0 - 4, x_g0 + 2):                                                                             # 法兰
        ring_x(H, b, AX_M, MOT['ro'] + 6, MOT['ro'] + 20, xf - 5, xf + 5, 0, 48)
        bolts(H, b, AX_M, MOT['ro'] + 14, 12, xf - 9, xf + 9, 5, 2)
    for k in range(9):                                                                                          # 电机筒外面的散热筋
        a = radians(200 + k * 18)
        y, z = AX_M[0] + (MOT['ro'] + 14) * cos(a), AX_M[1] + (MOT['ro'] + 14) * sin(a)
        beam(b, (x_m0 - 10, y, z), (x_g0 + 8, y, z), 7, 5, (0, cos(a), sin(a)), 0)
    lathe(b, [(60, xbell1), (60, X_DR - 6), (40, X_DR + 8)], (0, AX_D[0], AX_D[1]), 'X', 32, 0)                 # 差速器右边的鼻子
    lathe(b, [(56, XW[1]), (56, X_DL - 2), (40, X_DL - 12)], (0, AX_D[0], AX_D[1]), 'X', 32, 0)                 # 左边的
    rbox(b, ((xbell1 + XW[1]) / 2, AX_D[0] + 30, AX_D[1] - 112), (xbell1 - XW[0] - 8, 210, 26), 8, 1, 2)        # 底下的油底
    put('Case', b, [alu, alu2, steel], 'case', kind='housing')

    # ================================================================ 半轴（和燃油版一样的做法）
    for tag, sx, x_in in (('L', -1, X_DL - 8), ('R', 1, X_DR + 10)):
        p0 = Vector((x_in, AX_D[0], AX_D[1]))
        p1 = Vector((sx * (SH.TRACK - 62), SH.WB, SH.R_TYRE))
        u = (p1 - p0).normalized()
        L = (p1 - p0).length
        b = bmesh.new()
        o = Vector((0, 0, 0))
        cyl(b, o, o + u * 64, 38, mi=0, seg=18)
        cyl(b, o + u * 64, o + u * 118, 36, 16, 1, seg=18)
        cyl(b, o + u * 118, o + u * (L - 120), 13, mi=0, seg=12)
        cyl(b, o + u * (L - 120), o + u * (L - 66), 16, 40, 1, seg=18)
        cyl(b, o + u * (L - 66), o + u * (L - 8), 42, mi=0, seg=18)
        cyl(b, o + u * (L - 8), o + u * (L + 30), 15, mi=0, seg=12)
        put(f'Shaft{tag}', b, [steel, rub], 'halfshaft', loc=tuple(p0), kind='rot', shaft='diff', side='wheel',
            axis=[round(c, 5) for c in u], end=tag)

    # ================================================================ PCU + 三相铜排
    PC = HV['pcu']
    px0, px1, py0, py1, pz0, pz1 = *PC['x'], *PC['y'], *PC['z']
    b = bmesh.new()
    rbox(b, ((px0 + px1) / 2, (py0 + py1) / 2, (pz0 + pz1) / 2), (px1 - px0, py1 - py0, pz1 - pz0), 10, 0, 2)
    for k in range(9):
        y = py0 + 24 + k * (py1 - py0 - 48) / 8
        rbox(b, ((px0 + px1) / 2, y, pz1 + 5), (px1 - px0 - 40, 5, 12), 1.5, 0, 1)             # 顶上的散热筋
    for dx, dy in ((14, 14), (-14, 14), (14, -14), (-14, -14)):
        cyl(b, ((px0 if dx > 0 else px1) + dx, (py0 if dy > 0 else py1) + dy, pz0), ((px0 if dx > 0 else px1) + dx,
            (py0 if dy > 0 else py1) + dy, pz0 - 12), 9, mi=2, seg=10)                          # 四只脚，落在电机壳上
    rbox(b, ((px0 + px1) / 2, py0 - 8, pz0 + 58), (70, 16, 40), 4, 1, 1)                        # 高压直流插座（朝后）
    for yv in (py0 + 60, py0 + 110):
        cyl(b, (px1, yv, pz0 + 78), (px1 + 26, yv, pz0 + 78), 11, mi=2, seg=12)                 # 冷却水进出口
    put('PCU', b, [X_['pcu'], hv, steel], 'pcu', kind='static')
    # 三相铜排：每台电机三根，从绕组端部的顶上竖直伸进 PCU 的底面
    bus = {}
    b = bmesh.new()
    for key, o, xt, dys in (('mot', MOT, XM[1] - CW + 3, (-62, -40, -18)), ('gen', GEN, XGN[0] + CW - 3, (18, 40, 62))):
        rw = o['ri'] + o['depth'] - 2
        paths = []
        for dy in dys:
            z0 = AX_M[1] + sqrt(rw * rw - dy * dy)
            p0 = (xt, AX_M[0] + dy, z0)
            p1 = (xt, AX_M[0] + dy, pz0 + 6)
            beam(b, p0, p1, 14, 4, (0, 1, 0), 0)
            cyl(b, (xt - 6, AX_M[0] + dy, pz0 - 14), (xt + 6, AX_M[0] + dy, pz0 - 14), 10, mi=1, seg=10)   # 橙色护套
            paths.append([list(p0), list(p1)])
        bus[key] = paths
    put('Busbars', b, [X_['copper'], hv], 'pcu', kind='static')

    # ================================================================ 高压线：PCU → 地板下面 → 后排座椅后面的电池
    IP = HV['ipu']
    ix0, ix1, iy0, iy1, iz0, iz1 = *IP['x'], *IP['y'], *IP['z']
    xc_p = (px0 + px1) / 2
    hv_path = [(xc_p, py0 - 18, pz0 + 58), (-320, 1330, 560), (-320, 1262, 380), (-320, 1204, 322), (-330, 1150, 306),
               (-480, 1050, 306), (-650, 950, 306), (-650, -1215, 306), (-480, -1250, 330), (-360, -1290, 440),
               (ix0 + 70, iy1 - 30, iz0 + 6)]
    b = bmesh.new()
    for off in (-13, 13):
        pts = [(x + off, y, z) for x, y, z in hv_path]
        PT.pipe(b, pts, 20, mi=0, it=3)
    for (x, y, z) in ((-650, 600, 306), (-650, 0, 306), (-650, -600, 306)):
        rbox(b, (x, y, z + 4), (60, 24, 30), 4, 1, 1)                                           # 固定卡子
    put('HV_Cable', b, [hv, blk], 'hv', kind='static')

    # ================================================================ 电池（IPU）
    b = bmesh.new()
    rbox(b, ((ix0 + ix1) / 2, (iy0 + iy1) / 2, iz0 + 14), (ix1 - ix0, iy1 - iy0, 28), 6, 0, 1)   # 托盘
    for sx in (-1, 1):
        rbox(b, (sx * (ix1 - 10), (iy0 + iy1) / 2, iz0 - 20), (40, 120, 50), 6, 0, 1)            # 两边的支脚
    n_mod, n_cell = 4, IP['cells'] // 4
    mod_w = (ix1 - ix0 - 150) / n_mod
    for m_ in range(n_mod):
        xm0 = ix0 + 20 + m_ * (mod_w + 4)
        cw = (mod_w - 8) / n_cell
        for c_ in range(n_cell):
            rbox(b, (xm0 + 4 + cw * (c_ + .5), (iy0 + iy1) / 2, iz0 + 28 + 75), (cw - 1.2, 120, 150), 1.5, 1, 1)    # 单体
            rbox(b, (xm0 + 4 + cw * (c_ + .5), (iy0 + iy1) / 2, iz0 + 28 + 153), (cw * .5, 60, 6), 1, 2, 1)          # 极柱上的汇流排
        for dy in (-64, 64):
            rbox(b, (xm0 + mod_w / 2, (iy0 + iy1) / 2 + dy, iz0 + 28 + 75), (mod_w, 6, 150), 2, 0, 1)                # 模组的端板
    rbox(b, (ix1 - 62, (iy0 + iy1) / 2, iz0 + 28 + 70), (100, 150, 140), 6, 3, 1)                # 接线盒（继电器、电流传感器、电池电脑）
    cyl(b, (ix0 + 70, iy1 - 30, iz0 + 6), (ix0 + 70, iy1 - 30, iz0 + 40), 16, mi=4, seg=12)      # 高压线接头
    put('IPU', b, [X_['tray'], X_['cell'], X_['copper'], M['ecu'], hv], 'ipu', kind='static')
    b = bmesh.new()
    rbox(b, ((ix0 + ix1) / 2, (iy0 + iy1) / 2, (iz0 + 30 + iz1) / 2 + 2), (ix1 - ix0 + 8, iy1 - iy0 + 8, iz1 - iz0 - 26), 14, 0, 2)
    for k in range(6):
        rbox(b, (ix0 + 60 + k * 26, iy1 + 5, iz1 - 60), (14, 4, 60), 1, 1, 1)                    # 进风格栅（朝着车厢，吸车里的凉风）
    cyl(b, (ix1 - 40, iy0 + 40, iz1 - 6), (ix1 - 40, iy0 + 40, iz1 + 26), 44, mi=1, seg=18)      # 冷却风扇
    put('IPU_Lid', b, [X_['pcu'], blk], 'ipu', kind='static', lid=1)

    # ================================================================ 前舱：空滤、电瓶、电动附件
    b = bmesh.new()
    rbox(b, (60, 1885, 680), (340, 90, 160), 14, 0, 2)                                           # 空滤盒：发动机前面、水箱后面
    rbox(b, (60, 1885, 690), (346, 96, 8), 3, 3, 1)
    PT.pipe(b, [(-110, 1885, 668), (-150, 1850, 660), (-128, 1790, 655), (XE - 188, YC + 215, ZC + 250)], 60, mi=0)   # → 节气门
    PT.pipe(b, [(200, 1930, 700), (215, 2005, 716), (220, 2090, 716)], 66, mi=0)                 # 进气口
    rbox(b, (-300, 1850, 650), (240, 175, 190), 8, 1, 1)                                         # 12 V 电瓶
    rbox(b, (-300, 1850, 548), (260, 195, 12), 4, 0, 1)
    for sx in (-70, 70):
        cyl(b, (-300 + sx, 1850, 745), (-300 + sx, 1850, 762), 9, mi=2, seg=10)
    rbox(b, (300, 1226, 770), (160, 40, 120), 8, 3, 1)                                           # 发动机电脑
    rbox(b, (-340, 1252, 770), (150, 90, 130), 10, 3, 2)                                         # 电动刹车助力（没有真空助力器那个大圆盘）
    cyl(b, (-340, 1297, 770), (-340, 1366, 770), 26, mi=3, seg=12)
    cyl(b, (-340, 1262, 835), (-340, 1262, 880), 34, mi=4, seg=14)                               # 刹车油壶
    put('Bay', b, [blk, M['battery'], M['conn'], M['alu'], M['coolant']], 'bay', kind='static')
    b = bmesh.new()
    cyl(b, (XE + 112, YC + 156, ZC - 88), (XE + 236, YC + 156, ZC - 88), 55, mi=0, seg=22)       # 电动空调压缩机
    cyl(b, (XE + 236, YC + 156, ZC - 88), (XE + 252, YC + 156, ZC - 88), 40, mi=1, seg=18)
    rbox(b, (XE + 150, YC + 156, ZC - 28), (60, 50, 26), 5, 2, 1)
    PT.pipe(b, [(XE + 150, YC + 156, ZC - 14), (XE + 150, YC + 240, ZC + 40), (XE - 150, YC + 260, ZC + 60),
                (-230, 1700, 600), (-250, py1 + 10, pz0 + 40)], 14, mi=2, it=2)                  # 它的橙色高压线 → PCU
    put('EComp', b, [alu2, blk, hv], 'bay', kind='static')

    # ================================================================ 悬置
    b = bmesh.new()
    xr = SH.RAIL_X - SH.RAIL_W / 2
    rbox(b, (XE + BH + 62, YC - 20, ZC + 130), (70, 110, 70), 12, 0, 2)                          # 右悬置：正时端 → 右纵梁
    rbox(b, (xr - 6, YC - 20, ZC + 96), (36, 120, 30), 6, 1, 1)
    rbox(b, (XE + BH + 100, YC - 20, ZC + 112), (60, 60, 24), 4, 1, 1)
    rbox(b, (x_end - 6, AX_M[0] + 60, AX_M[1] - 20), (24, 110, 80), 10, 0, 2)                    # 左悬置：发电机端盖 → 左纵梁
    rbox(b, (-xr + 6, AX_M[0] + 60, AX_M[1] - 44), (36, 120, 30), 6, 1, 1)
    cyl(b, (XW[0] - 30, AX_D[0] - 58, AX_D[1] - 85), (XW[0] - 30, 1285, 238), 16, mi=0, seg=12)  # 后抗扭拉杆
    put('Mounts', b, [rub, steel], 'mount', kind='static')

    # ================================================================ 给网页的：能量流走哪、标签贴哪
    fuel = [(-60, -650, 300), (-100, -400, 312), (-100, 1150, 312), (-100, 1215, 360), (-60, 1290, 600), (XE - 60, YC + 118, ZC + 296)]
    exh = [(XE, YC - 185, ZC + 200), (XE, YC - 185, ZC - 18), (XE, 1338, 368), (XE + 14, 1262, 240), (XE + 20, 1215, 226),
           (150, 1000, 226), (150, 260, 226), (150, -200, 226), (150, -1080, 226), (150, -1250, 300), (150, -1420, 348),
           (150, -1640, 348), (150, -1800, 330), (300, -1900, 330), (400, -2100, 285), (400, SH.Y_TAIL + 6, 280)]
    flows = dict(fuel=fuel, exhaust=exh, dc=[list(p) for p in hv_path], ac_mot=bus['mot'], ac_gen=bus['gen'])
    anchors = dict(
        eng_block=[XE + 40, YC + 130, ZC + 120], eng_head=[XE, YC, ZC + COVER + 30], gen_stator=[XGN[1] - 60, AX_M[0] - 40, AX_M[1] + GEN['ro'] + 70],
        mot_stator=[(XM[0] + XM[1]) / 2, AX_M[0] + 150, AX_M[1] - 30], clutch=[(XCL[0] + XCL[1]) / 2, AX_I[0] + 70, AX_I[1] + 40],
        edrive=[(XP[0] + XP[1]) / 2, AX_I[0] + 60, AX_I[1] - 60], input=[XG[0], AX_I[0] + 40, AX_I[1] + 70],
        counter=[(XP[0] + XP[1]) / 2, AX_C[0] - 20, AX_C[1] + 70], diff=[(XF[0] + XF[1]) / 2, AX_D[0] - 60, AX_D[1] - 60],
        pcu=[(px0 + px1) / 2, (py0 + py1) / 2, pz1 + 40], ipu=[0, (iy0 + iy1) / 2, iz1 + 60], tank=[-270, -890, 330],
        wheel_FL=[-SH.TRACK - 120, SH.WB, SH.R_TYRE], wheel_FR=[SH.TRACK + 120, SH.WB, SH.R_TYRE], hv=[-650, 0, 250],
        gen_rotor=[XGN[1] - 30, AX_M[0], AX_M[1]], mot_rotor=[XM[0], AX_M[0] - 40, AX_M[1]],
    )
    return dict(derived=derived(), fit=fit_report(H), groups=dict(GROUPS), explode=dict(EXPL), flows=flows, anchors=anchors,
                teeth={k: v for k, v in T.items() if not k.startswith('_')},
                x={k: v for k, v in X.items() if not k.startswith('_')},
                motor={k: v for k, v in MOT.items() if not k.startswith('_')},
                gen={k: v for k, v in GEN.items() if not k.startswith('_')},
                pcu={k: v for k, v in HV['pcu'].items() if not k.startswith('_')},
                ipu={k: v for k, v in HV['ipu'].items() if not k.startswith('_')})


def fit_report(H):
    """装进车里以后量间隙（从网格顶点量）"""
    rail_in = SH.RAIL_X - SH.RAIL_W / 2
    rz = [z for _, z in SH.RAIL_YZ]
    rz0, rz1 = min(rz) - SH.RAIL_H / 2, max(rz) + SH.RAIL_H / 2
    core_names = ('Eng_', 'Case', 'Flywheel', 'PCU', 'Busbars')
    core = [p for n, v in BB.items() if n.startswith(core_names) for p in v]
    bay = [p for n, v in BB.items() if n.startswith(core_names + ('Bay', 'EComp', 'Mounts')) for p in v]
    at_rail = [p for p in core if rz0 <= p[2] <= rz1 and SH.RAIL_YZ[0][0] < p[1] < SH.RAIL_YZ[-1][0]]

    def hood_gap(pts):
        best, at = 1e9, None
        for x, y, z in pts:
            if z < 600 or y < SH.Y_FIREWALL:
                continue
            zs = H.skin_top_z(y, abs(x))
            if zs is None:
                continue
            c = zs - P['place']['hood_thickness'] - z
            if c < best:
                best, at = c, (x, y, z)
        return best, at
    hood, worst = hood_gap(bay)
    hood_pcu, _ = hood_gap([p for p in BB['PCU']])
    low = [p for n, v in BB.items() if not n.startswith(('IPU', 'HV_')) for p in v]
    md = math.hypot(AX_M[0] - AX_D[0], AX_M[1] - AX_D[1])
    rep = dict(
        total_len=round(max(p[0] for p in core) - min(p[0] for p in core), 1),
        rail_clear=round(2 * rail_in, 1),
        gap_right=round(rail_in - max(p[0] for p in at_rail), 1),
        gap_left=round(rail_in + min(p[0] for p in at_rail), 1),
        hood=round(hood, 1), hood_at=[round(c) for c in worst], hood_pcu=round(hood_pcu, 1),
        firewall=round(min(p[1] for p in core if p[2] > 345) - (SH.Y_FIREWALL + 6), 1),
        ground=round(min(p[2] for p in low), 1),
        ground_cable=round(min(p[2] for p in BB['HV_Cable']), 1),
        motor_to_halfshaft=round(md - (MOT['ro'] + 12) - 42, 1),
    )
    print('[fit-ehev] 动力总成长 %(total_len).0f，纵梁净宽 %(rail_clear).0f：右边余 %(gap_right).0f，左边余 %(gap_left).0f' % rep)
    print('[fit-ehev] 前舱里离前盖内板最近的件 %.0f（在 x=%d y=%d z=%d），PCU 离前盖内板 %.0f' % (rep['hood'], *rep['hood_at'], rep['hood_pcu']))
    print('[fit-ehev] 离前围板 %(firewall).0f，最低点离地 %(ground).0f，高压线最低点离地 %(ground_cable).0f，电机壳离左半轴球笼 %(motor_to_halfshaft).0f' % rep)
    return rep
