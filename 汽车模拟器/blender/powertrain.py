# -*- coding: utf-8 -*-
"""
汽车模拟器 · 动力系统（发动机 + CVT + 半轴 + 进排气 + 冷却 + 油箱）

虚构的教学用动力总成，不对应任何一款产品。尺寸全部来自 ../params.json：
    发动机   1.5L 自然吸气直列四缸，横放，正时端朝车右，进气朝前、排气朝后
    CVT      液力变矩器 → 前进 / 倒挡行星排 → 主动锥轮 → 钢带 → 从动锥轮 → 两级减速 → 差速器，在车左
    半轴     差速器 → 左右前轮

会动的件每个单独一个物体，原点落在自己的转轴上（或活塞销、气门头上），extras 里写着它跟哪根轴转：
    shaft = crank 曲轴 / cam 凸轮轴（曲轴的一半）/ turbine 涡轮 / primary 主动锥轮 / secondary 从动锥轮
            / inter 中间轴 / diff 差速器 / fan 风扇
网页里的仿真算出每根轴的转角，按 shaft 去转对应的物体；活塞、连杆、气门、锥轮的移动另有 kind 标记。
钢带的形状跟着速比变，这里只按起步速比（最低挡）建了一份，网页里要重新生成（extras: procedural = 1）。

build(M, H) 由 build_car.py 调用。H 是 build_car 里的工具函数（add / rbox / cyl / lathe / grp / skin_top_z）。
"""
import json
import math
import os
from math import asin, cos, pi, radians, sin, sqrt, tan

import bmesh
from mathutils import Matrix, Vector

import carkit as CK
import shape as SH

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, '..', 'params.json'), encoding='utf-8') as _f:
    P = json.load(_f)
E, C, PL = P['engine'], P['cvt'], P['place']

# ---------------------------------------------------------------- 由参数表推出来的量
R_CRANK = E['stroke'] / 2
CYL_X = [1.5 * E['pitch'], .5 * E['pitch'], -.5 * E['pitch'], -1.5 * E['pitch']]      # 1 缸在正时端（+x）
CRANK_UP = (True, False, False, True)                                                  # 1、4 缸在上止点时 2、3 缸在下止点
DISP_CC = pi / 4 * E['bore'] ** 2 * E['stroke'] * 4 / 1000.0
CVT_LEN = C['len_bell'] + C['len_gear'] + C['len_variator'] + C['len_cover']
TOTAL = E['x_pulley'] + E['block_half'] + CVT_LEN            # 皮带轮端 → CVT 端盖
XE = TOTAL / 2 - E['x_pulley']                              # 发动机坐标原点在车里的 x（动力总成整体居中）
YC, ZC = PL['y_crank'], PL['z_crank']
XB = XE - E['block_half']                                   # 缸体后端面 = 变矩器壳的安装面
X_GEAR0 = XB - C['len_bell']                                # 齿轮段从这里开始（往车左）
X_VAR0 = X_GEAR0 - C['len_gear']                            # 锥轮段
X_END = X_VAR0 - C['len_variator']
X_COVER = X_END - C['len_cover']
TAN = tan(radians(C['wedge']))
A0 = (YC, ZC)                                               # 曲轴 / 主动锥轮轴 (y, z)
A1 = (YC + C['centre'] * C['sec_dir'][0], ZC + C['centre'] * C['sec_dir'][1])          # 从动锥轮轴
A3 = tuple(C['diff_yz'])                                    # 差速器 / 半轴
GM = C['gear_m']
R_OUT, R_IDL, R_PIN, R_RING = (C[k] * GM / 2 for k in ('z_out', 'z_idler', 'z_pinion', 'z_ring'))
FINAL = C['z_idler'] / C['z_out'] * C['z_ring'] / C['z_pinion']


def _circle_x(c0, r0, c1, r1, pick_low_y=True):
    """两个圆的交点（中间轴的位置：到从动轴 r0、到差速器 r1）"""
    dx, dy = c1[0] - c0[0], c1[1] - c0[1]
    d = math.hypot(dx, dy)
    a = (r0 * r0 - r1 * r1 + d * d) / (2 * d)
    h = sqrt(max(r0 * r0 - a * a, 0.0))
    px, py = c0[0] + a * dx / d, c0[1] + a * dy / d
    s1 = (px + h * dy / d, py - h * dx / d)
    s2 = (px - h * dy / d, py + h * dx / d)
    return min(s1, s2) if pick_low_y else max(s1, s2)


A2 = _circle_x(A1, R_OUT + R_IDL, A3, R_PIN + R_RING)       # 中间轴：取靠后（y 小）的那个解，躲开变矩器


def belt_len(r1, r2):
    a = C['centre']
    ph = asin((r2 - r1) / a)
    return 2 * a * cos(ph) + (pi + 2 * ph) * r2 + (pi - 2 * ph) * r1


BELT_L = belt_len(C['r_min'], C['r_max'])


def r2_of(r1):
    """钢带长度不变：主动轮半径 r1 → 从动轮半径"""
    lo, hi = 5.0, 200.0
    for _ in range(50):
        m = (lo + hi) / 2
        if belt_len(r1, m) < BELT_L:
            lo = m
        else:
            hi = m
    return (lo + hi) / 2


RATIO_LOW, RATIO_HIGH = C['r_max'] / C['r_min'], r2_of(C['r_max']) / C['r_max']
# 锥轮的轴向位置：主动轮的固定盘在 +x 侧，从动轮的固定盘在 -x 侧，这样变速时两边钢带的中面一起挪、始终对齐
X0P = X_VAR0 - 73.5
X0S = X0P - 3.0
PIN_Z = [E['rod'] + (R_CRANK if up else -R_CRANK) for up in CRANK_UP]


def derived():
    """给布置图和 spec.json 用的一份摘要"""
    return dict(
        disp_cc=round(DISP_CC, 1), total=TOTAL, cvt_len=CVT_LEN, xe=XE, xb=XB, x_gear0=X_GEAR0, x_var0=X_VAR0, x_end=X_END,
        x_cover=X_COVER, x_right=XE + E['x_pulley'], x_left=X_COVER, a0=A0, a1=A1, a2=A2, a3=A3, belt_len=round(BELT_L, 2),
        ratio_low=round(RATIO_LOW, 3), ratio_high=round(RATIO_HIGH, 3), final=round(FINAL, 3), cyl_x=CYL_X,
        crank_up=CRANK_UP, r_crank=R_CRANK, x0p=X0P, x0s=X0S, tan=TAN,
        gears=dict(out=R_OUT, idler=R_IDL, pinion=R_PIN, ring=R_RING),
    )


# ---------------------------------------------------------------- 小工具
BB = {}          # 名字 -> 顶点（车身坐标，毫米），量间隙用


def hull(pts):
    """二维凸包（逆时针）"""
    pts = sorted(set((round(p[0], 4), round(p[1], 4)) for p in pts))

    def cr(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def hull_circles(circles, n=40):
    """几个圆 (cy, cz, r) 的外包轮廓：皮带、链条、变速箱壳的截面"""
    pts = []
    for cy, cz, r in circles:
        pts += [(cy + r * cos(2 * pi * k / n), cz + r * sin(2 * pi * k / n)) for k in range(n)]
    return hull(pts)


def band(bm, outline, x, w, t, mi, r=1.5):
    """沿 (y, z) 闭合轮廓扫一条扁带（皮带、链条、钢带）：宽 w 沿 x，厚 t 沿轮廓的法向"""
    n = len(outline)
    pts, ups = [], []
    for i in range(n):
        a, b = outline[i - 1], outline[(i + 1) % n]
        ty, tz = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(ty, tz) or 1.0
        pts.append(Vector((x, outline[i][0], outline[i][1])))
        ups.append(Vector((0, tz / ln, -ty / ln)))
    return CK.sweep(bm, pts, ups, w, t, r=r, mi=mi, cap=False, closed=True)


def prism(bm, outline, x0, x1, mi):
    """(y, z) 轮廓沿 x 拉伸成一块实心件（变速箱壳）"""
    rings = [[Vector((x, y, z)) for y, z in outline] for x in (x0, x1)]
    return CK.loft(bm, rings, mi, cap=True, smooth=False)


def gear(bm, x0, x1, n, m, mi=0, cy=0.0, cz=0.0):
    """直齿轮（梯形齿，示意）：齿数 n、模数 m，轴线沿 x，中心 (cy, cz)"""
    rp = n * m / 2
    ra, rf = rp + .9 * m, rp - 1.1 * m
    ri = rf - 1.2 * m
    p = 2 * pi / n
    prof = []
    for k in range(n):
        for fr, r in ((.20, rf), (.34, ra), (.66, ra), (.80, rf)):
            prof.append((k * p + fr * p, r))

    def ring(x, rr=None):
        return [bm.verts.new((x, cy + (rr or r) * cos(a), cz + (rr or r) * sin(a))) for a, r in prof]
    o0, o1, i0, i1 = ring(x0), ring(x1), ring(x0, ri), ring(x1, ri)
    N = len(prof)
    fs = []
    for k in range(N):
        j = (k + 1) % N
        fs.append(bm.faces.new((o0[k], o0[j], o1[j], o1[k])))
        fs.append(bm.faces.new((i0[k], i0[j], o0[j], o0[k])))
        fs.append(bm.faces.new((o1[k], o1[j], i1[j], i1[k])))
    fs.append(bm.faces.new(i0))
    fs.append(bm.faces.new(i1))
    for f in fs:
        f.material_index = mi
        f.smooth = False
    CK.orient_closed(bm, fs)
    return fs


def smooth_path(pts, it=2):
    """折线倒圆（切角法），两端不动"""
    P = [Vector(p) for p in pts]
    for _ in range(it):
        Q = [P[0]]
        for a, b in zip(P, P[1:]):
            Q += [a.lerp(b, .25), a.lerp(b, .75)]
        Q.append(P[-1])
        P = Q
    return P


def pipe(bm, pts, d, mi=0, it=2):
    """圆管：沿折线，拐角倒圆"""
    P = smooth_path(pts, it)
    up = Vector((0, 0, 1))
    if all(abs((b - a).normalized().z) > .9 for a, b in zip(P, P[1:]) if (b - a).length > 1e-6):
        up = Vector((1, 0, 0))
    return CK.sweep(bm, P, [up] * len(P), d, d, d / 2 - .3, mi, cap=True)


def build(M, H):
    """建全部动力系统。返回给 spec.json 的信息（推出来的量 + 间隙报告）"""
    rbox, cyl, lathe = H.rbox, H.cyl, H.lathe
    BB.clear()
    H.grp('powertrain', '发动机与 CVT', (0, 1700, 250))
    H.grp('bay', '冷却、进气、电瓶', (0, 1100, 1100))
    H.grp('under', '排气与油箱', (0, 0, -1300))

    def put(name, bm, mats, group, loc=(0, 0, 0), ang=40, **extras):
        lv = Vector(loc)
        BB[name] = [tuple(v.co + lv) for v in bm.verts]
        return H.add(name, bm, mats, group, loc=loc, ang=ang, coll='Powertrain', extras=extras or None)

    EL = (XE, YC, ZC)                    # 发动机坐标原点
    BH, HW, DECK, HEAD, COVER, COIL, PAN = (E[k] for k in ('block_half', 'half_w', 'deck', 'head_top', 'cover_top', 'coil_top',
                                                           'pan_bot'))
    alu, alu2, iron, steel, blk, rub = M['castalu'], M['castalu2'], M['castiron'], M['steel'], M['plastic'], M['rubber']

    # ================================================================ 发动机：不动的件
    b = bmesh.new()
    rbox(b, (0, 0, 5), (2 * BH, 2 * HW, 130), 14, 0, 2)                              # 曲轴箱（裙部）
    rbox(b, (0, 0, (66 + DECK) / 2), (2 * BH, 176, DECK - 66), 10, 0, 2)             # 气缸部分
    rbox(b, (0, 0, (PAN - 60) / 2), (2 * BH - 14, 2 * HW - 14, -60 - PAN), 18, 1, 2)   # 油底壳
    rbox(b, (BH + 18, 0, 165), (36, 2 * HW + 6, 470), 12, 2, 2)                      # 正时罩盖
    cyl(b, (60, HW - 4, -20), (60, HW + 86, -20), 38, mi=3, seg=20)                  # 机油滤清器
    put('Eng_Block', b, [alu, M['pan'], alu2, M['filter']], 'powertrain', loc=EL, kind='housing')
    b = bmesh.new()
    rbox(b, (0, 0, (DECK + HEAD) / 2), (2 * BH, 2 * HW - 4, HEAD - DECK), 8, 0, 2)   # 缸盖
    rbox(b, (0, 0, (HEAD + COVER) / 2), (2 * BH - 16, 186, COVER - HEAD), 22, 1, 3)  # 气门室盖
    for xc in CYL_X:
        cyl(b, (xc, 0, COVER - 6), (xc, 0, COIL), 17, mi=2, seg=14)                  # 点火线圈
    cyl(b, (-118, 56, COVER - 4), (-118, 56, COVER + 10), 24, mi=2, seg=18)          # 机油加注盖
    put('Eng_Head', b, [alu, blk, M['conn']], 'powertrain', loc=EL, kind='housing')
    b = bmesh.new()
    cyl(b, (-150, 215, 250), (150, 215, 250), 52, mi=0, seg=24)                      # 进气稳压腔
    for xc in CYL_X:
        cyl(b, (xc, 215, 262), (xc, HW - 4, 268), 21, mi=0, seg=14)                  # 进气歧管
        cyl(b, (xc, 118, 296), (xc, 104, 274), 7, mi=2, seg=8)                       # 喷油器
    cyl(b, (-150, 215, 250), (-188, 215, 250), 33, mi=1, seg=20)                     # 节气门体
    cyl(b, (-142, 118, 296), (142, 118, 296), 8, mi=2, seg=10)                       # 油轨
    put('Eng_Intake', b, [blk, alu2, steel], 'powertrain', loc=EL, kind='housing')
    b = bmesh.new()
    for xc in CYL_X:
        pipe(b, [(xc, -HW + 4, 262), (xc * .7, -140, 256), (xc * .25, -180, 240), (xc * .1, -185, 226)], 36, mi=0)
    cyl(b, (0, -185, 232), (0, -185, 204), 30, 56, 0, seg=24)
    cyl(b, (0, -185, 204), (0, -185, 10), 57, mi=1, seg=24)                          # 三元催化器（紧挨着歧管）
    cyl(b, (0, -185, 10), (0, -185, -18), 57, 27, 0, seg=24)
    put('Eng_Exhaust', b, [iron, M['exh']], 'powertrain', loc=EL, kind='housing')
    b = bmesh.new()
    cyl(b, (118, 150, 60), (228, 150, 60), 62, mi=0, seg=22)                         # 发电机
    cyl(b, (230, 150, 60), (250, 150, 60), 30, mi=1, seg=18)
    cyl(b, (112, 156, -88), (226, 156, -88), 55, mi=0, seg=22)                       # 空调压缩机
    cyl(b, (230, 156, -88), (250, 156, -88), 50, mi=1, seg=20)
    cyl(b, (222, -62, 120), (250, -62, 120), 44, mi=1, seg=20)                       # 水泵皮带轮
    cyl(b, (230, 96, -8), (250, 96, -8), 30, mi=1, seg=18)                           # 张紧轮
    band(b, hull_circles([(0, 0, 75), (150, 60, 33), (156, -88, 53), (-62, 120, 47)]), 241, 18, 4, 2)   # 多楔带
    cyl(b, (-172, 150, -52), (-40, 150, -52), 38, mi=0, seg=18)                      # 起动机
    cyl(b, (-150, 150, 0), (-62, 150, 0), 20, mi=1, seg=12)
    put('Eng_Acc', b, [alu2, steel, rub], 'powertrain', loc=EL, kind='housing')
    b = bmesh.new()
    band(b, hull_circles([(0, 0, 31), (E['cam_y'], E['cam_z'], 60), (-E['cam_y'], E['cam_z'], 60)]), 189, 10, 5, 0)
    put('Eng_Chain', b, [steel], 'powertrain', loc=EL, kind='static')

    # ================================================================ 发动机：会动的件
    b = bmesh.new()
    for xm in (-2 * E['pitch'], -E['pitch'], 0, E['pitch'], 2 * E['pitch']):         # 5 道主轴颈
        cyl(b, (xm - 11, 0, 0), (xm + 11, 0, 0), 25, mi=0, seg=24)
    cyl(b, (2 * E['pitch'], 0, 0), (E['x_pulley'], 0, 0), 18, mi=0, seg=16)
    cyl(b, (-BH - 12, 0, 0), (-2 * E['pitch'], 0, 0), 30, mi=0, seg=20)
    for xc, up in zip(CYL_X, CRANK_UP):
        sg = 1 if up else -1
        cyl(b, (xc - 11, 0, sg * R_CRANK), (xc + 11, 0, sg * R_CRANK), 22, mi=0, seg=20)       # 连杆轴颈
        for dx in (-18.5, 18.5):
            rbox(b, (xc + dx, 0, sg * (R_CRANK + 24 - 58) / 2), (12, 74, R_CRANK + 24 + 58), 8, 0, 1)   # 曲柄臂
            rbox(b, (xc + dx, 0, -sg * 50), (12, 108, 46), 12, 0, 2)                           # 平衡块
    gear(b, 182, 196, 20, 2.9, 1)                                                              # 正时链轮
    lathe(b, [(0, 212), (58, 212), (72, 217), (72, 250), (44, 250), (44, 236), (0, 236)], (0, 0, 0), 'X', 36, 1)   # 减振皮带轮
    lathe(b, [(0, -180), (126, -180), (126, -186), (0, -186)], (0, 0, 0), 'X', 48, 1)                              # 挠性盘
    gear(b, -188, -178, 108, 2.5, 1)                                                           # 起动齿圈
    put('Eng_Crank', b, [steel, M['gear']], 'powertrain', loc=EL, kind='rot', shaft='crank')
    rb, ch = E['bore'] / 2 - .4, E['comp_h']
    for i, xc in enumerate(CYL_X):
        b = bmesh.new()
        lathe(b, [(0, ch - 1.5), (30, ch - 1.5), (33.5, ch), (rb, ch), (rb, ch - 6), (rb - 1.4, ch - 6), (rb - 1.4, ch - 8),
                  (rb, ch - 8), (rb, ch - 12), (rb - 1.4, ch - 12), (rb - 1.4, ch - 14), (rb, ch - 14), (rb, -24), (0, -24)],
              (0, 0, 0), 'Z', 28, 0)
        cyl(b, (-30, 0, 0), (30, 0, 0), 9, mi=1, seg=12)                                        # 活塞销
        put(f'Eng_Piston{i + 1}', b, [alu2, steel], 'powertrain', loc=(XE + xc, YC, ZC + PIN_Z[i]), kind='piston', cyl=i + 1,
            phase=0 if CRANK_UP[i] else 180)
        b = bmesh.new()
        cyl(b, (-10, 0, 0), (10, 0, 0), 14, mi=0, seg=16)                                       # 小头
        rbox(b, (0, 0, -E['rod'] / 2), (10, 24, E['rod'] - 40), 4, 0, 1)                        # 杆身
        cyl(b, (-10.5, 0, -E['rod']), (10.5, 0, -E['rod']), 31, mi=0, seg=20)                   # 大头
        put(f'Eng_Rod{i + 1}', b, [steel], 'powertrain', loc=(XE + xc, YC, ZC + PIN_Z[i]), kind='rod', cyl=i + 1,
            phase=0 if CRANK_UP[i] else 180)
    order = {c: k for k, c in enumerate(E['firing'])}                  # 缸号 -> 第几个点火
    va = radians(E['valve_angle'])
    for tag, sy in (('In', 1), ('Ex', -1)):
        b = bmesh.new()
        cyl(b, (-160, 0, 0), (182, 0, 0), 12, mi=0, seg=16)
        for i, xc in enumerate(CYL_X):
            # 凸轮尖的初始朝向：让它在这个缸的气门开到最大时（进气在循环的 470°、排气在 250°）正好压着气门。
            # 凸轮轴转速是曲轴的一半、转向相同，所以初始角 = 气门打开方向的角度 + 那一刻曲轴转角的一半
            ph = radians(90 * order[i + 1] + (127 if sy > 0 else 53))
            for dx in (-17, 17):
                cyl(b, (xc + dx - 6, 5 * cos(ph), 5 * sin(ph)), (xc + dx + 6, 5 * cos(ph), 5 * sin(ph)), 17, mi=0, seg=18)   # 凸轮
        gear(b, 182, 196, 40, 2.9, 1)                                                           # 凸轮轴链轮（齿数是曲轴链轮的两倍）
        put(f'Eng_Cam{tag}', b, [steel, M['gear']], 'powertrain', loc=(XE, YC + sy * E['cam_y'], ZC + E['cam_z']), kind='rot',
            shaft='cam')
        d = Vector((0, sy * sin(va), cos(va)))                         # 气门杆朝上的方向
        rh = 14.5 if sy > 0 else 12.5
        for i, xc in enumerate(CYL_X):
            b = bmesh.new()
            for dx in (-17, 17):
                o = Vector((dx, 0, 0))
                cyl(b, o, o + d * 3, rh, mi=0, seg=16)                 # 气门头
                cyl(b, o + d * 3, o + d * 14, rh, 3, 0, seg=16)
                cyl(b, o + d * 14, o + d * 100, 2.8, mi=0, seg=8)      # 气门杆
                cyl(b, o + d * 62, o + d * 90, 10, mi=1, seg=12)       # 弹簧（画成一个筒）
                cyl(b, o + d * 90, o + d * 102, 14, mi=0, seg=14)      # 挺柱
            put(f'Eng_Valve{tag}{i + 1}', b, [steel, M['spring']], 'powertrain', loc=(XE + xc, YC + sy * 17, ZC + DECK + 3),
                kind='valve', cyl=i + 1, side=tag.lower(), dir=[0, round(-d.y, 4), round(-d.z, 4)], lift=E['valve_lift'])

    # ================================================================ CVT：会动的件（原点在各自的轴上）
    b = bmesh.new()
    lathe(b, [(0, XB - 14), (96, XB - 14), (118, XB - 22), (125, XB - 40), (125, XB - 70), (116, XB - 88), (92, XB - 96),
              (30, XB - 96), (30, X_GEAR0 - 4), (0, X_GEAR0 - 4)], (0, 0, 0), 'X', 40, 0)
    put('Cvt_Impeller', b, [M['gear']], 'powertrain', loc=(0, *A0), kind='rot', shaft='crank', shell=1)
    b = bmesh.new()
    lathe(b, [(0, XB - 30), (60, XB - 30), (106, XB - 38), (106, XB - 50), (60, XB - 54), (0, XB - 54)], (0, 0, 0), 'X', 36, 0)
    for k in range(14):                                               # 涡轮叶片：先建在 +y，再绕 x 转到位
        vs = rbox(b, (XB - 46, 84, 0), (20, 44, 3), 1, 1, 1)
        bmesh.ops.rotate(b, verts=vs, cent=(XB - 46, 0, 0), matrix=Matrix.Rotation(radians(360 * k / 14), 3, 'X'))
    cyl(b, (XB - 54, 0, 0), (X_GEAR0 - 10, 0, 0), 14, mi=0, seg=14)                             # 输入轴
    put('Cvt_Turbine', b, [steel, M['gear']], 'powertrain', loc=(0, *A0), kind='rot', shaft='turbine')
    b = bmesh.new()
    lathe(b, [(0, X_GEAR0 - 8), (56, X_GEAR0 - 8), (62, X_GEAR0 - 14), (62, X_VAR0 + 12), (56, X_VAR0 + 6), (0, X_VAR0 + 6)],
          (0, 0, 0), 'X', 36, 0)
    for k in range(5):                                                                          # 离合器片的槽
        x = X_GEAR0 - 20 - k * 7
        lathe(b, [(62, x), (64.5, x), (64.5, x - 3), (62, x - 3)], (0, 0, 0), 'X', 36, 1, closed=True)
    put('Cvt_FwdRev', b, [M['gear'], steel], 'powertrain', loc=(0, *A0), kind='rot', shaft='primary')
    t24, t82 = 24 * TAN, C['sheave_r'] * TAN
    RS = C['sheave_r']
    s1 = C['belt_w'] - 2 * C['r_min'] * TAN                 # 起步（最低挡）：主动轮半径最小、从动轮最大
    s2 = C['belt_w'] - 2 * C['r_max'] * TAN
    b = bmesh.new()
    lathe(b, [(0, X0P + t24), (24, X0P + t24), (RS, X0P + t82), (RS, X0P + t82 + 8), (45, X0P + t82 + 20), (20, X0P + t82 + 20),
              (20, X_VAR0 + 8), (0, X_VAR0 + 8)], (0, 0, 0), 'X', 44, 0)
    put('Cvt_PriFixed', b, [M['gear']], 'powertrain', loc=(0, *A0), kind='rot', shaft='primary')
    b = bmesh.new()
    lathe(b, [(0, -t24), (24, -t24), (RS, -t82), (RS, -t82 - 8), (70, -t82 - 14), (70, -t82 - 40), (26, -t82 - 40), (26, -76),
              (0, -76)], (0, 0, 0), 'X', 44, 0)
    put('Cvt_PriMove', b, [M['gear']], 'powertrain', loc=(X0P - s1, *A0), kind='sheave', shaft='primary', pulley='primary',
        x_ref=X0P, toward=1)
    b = bmesh.new()
    lathe(b, [(0, X0S - t24), (24, X0S - t24), (RS, X0S - t82), (RS, X0S - t82 - 8), (45, X0S - t82 - 20), (20, X0S - t82 - 20),
              (20, X_END + 6), (0, X_END + 6)], (0, 0, 0), 'X', 44, 0)
    put('Cvt_SecFixed', b, [M['gear']], 'powertrain', loc=(0, *A1), kind='rot', shaft='secondary')
    b = bmesh.new()
    lathe(b, [(0, t24), (24, t24), (RS, t82), (RS, t82 + 8), (70, t82 + 14), (70, t82 + 40), (26, t82 + 40), (26, 60), (0, 60)],
          (0, 0, 0), 'X', 44, 0)
    put('Cvt_SecMove', b, [M['gear']], 'powertrain', loc=(X0S + s2, *A1), kind='sheave', shaft='secondary', pulley='secondary',
        x_ref=X0S, toward=-1)
    XG2 = (X_VAR0 + 6, X_VAR0 + 26)                          # 输出齿轮 + 中间轴大齿轮
    XG1 = (X_VAR0 + 32, X_VAR0 + 54)                         # 主减速小齿轮 + 差速器齿圈
    b = bmesh.new()
    cyl(b, (X0S + s2 + 40, 0, 0), (XG2[1] + 6, 0, 0), 16, mi=0, seg=14)
    gear(b, XG2[0], XG2[1], C['z_out'], GM, 1)
    put('Cvt_OutGear', b, [steel, M['gear']], 'powertrain', loc=(0, *A1), kind='rot', shaft='secondary')
    b = bmesh.new()
    cyl(b, (X_VAR0 + 2, 0, 0), (X_GEAR0 - 2, 0, 0), 14, mi=0, seg=14)
    gear(b, XG2[0], XG2[1], C['z_idler'], GM, 1)
    gear(b, XG1[0], XG1[1], C['z_pinion'], GM, 1)
    put('Cvt_Idler', b, [steel, M['gear']], 'powertrain', loc=(0, *A2), kind='rot', shaft='inter')
    X_DIFF_R = X_GEAR0 + 78
    b = bmesh.new()
    gear(b, XG1[0], XG1[1], C['z_ring'], GM, 1)
    lathe(b, [(0, X_VAR0 + 24), (40, X_VAR0 + 24), (48, X_VAR0 + 32), (48, X_GEAR0 + 60), (30, X_DIFF_R), (0, X_DIFF_R)],
          (0, 0, 0), 'X', 32, 0)
    put('Cvt_Diff', b, [iron, M['gear']], 'powertrain', loc=(0, *A3), kind='rot', shaft='diff')
    xc_belt = X0P - C['belt_w'] / 2 + C['r_min'] * TAN        # 钢带中面（起步速比）
    b = bmesh.new()
    band(b, hull_circles([(A0[0], A0[1], C['r_min']), (A1[0], A1[1], C['r_max'])], 72), xc_belt, C['belt_w'], C['belt_t'], 0,
         r=2.0)
    put('Cvt_Belt', b, [M['belt']], 'powertrain', kind='belt', procedural=1)

    # ================================================================ CVT 壳体
    b = bmesh.new()
    lathe(b, [(150, XB), (150, XB - 34), (138, X_GEAR0)], (0, A0[0], A0[1]), 'X', 44, 0)                       # 变矩器壳
    prism(b, hull_circles([(*A0, 80), (*A1, 52), (*A2, 74), (*A3, 118)]), X_GEAR0, X_VAR0, 0)                  # 齿轮段
    prism(b, hull_circles([(*A0, 94), (*A1, 94)]), X_VAR0, X_END, 0)                                           # 锥轮段
    prism(b, hull_circles([(*A0, 84), (*A1, 84)]), X_END, X_COVER, 1)                                          # 端盖
    lathe(b, [(60, X_GEAR0), (60, X_DIFF_R + 2), (36, X_DIFF_R + 14)], (0, A3[0], A3[1]), 'X', 32, 0)           # 差速器壳（贴着变矩器壳）
    rbox(b, (X_VAR0 - 75, A0[0] - 10, A0[1] - 106), (150, 220, 36), 10, 1, 2)                                  # 阀体 / 油底
    put('Cvt_Case', b, [alu, alu2], 'powertrain', kind='housing')

    # ================================================================ 半轴
    for tag, sx, x_in in (('L', -1, X_VAR0 + 14), ('R', 1, X_DIFF_R + 16)):
        p0 = Vector((x_in, A3[0], A3[1]))
        p1 = Vector((sx * (SH.TRACK - 62), SH.WB, SH.R_TYRE))
        u = (p1 - p0).normalized()
        L = (p1 - p0).length
        b = bmesh.new()
        o = Vector((0, 0, 0))
        cyl(b, o, o + u * 64, 38, mi=0, seg=18)                                  # 内球笼（三球销）
        cyl(b, o + u * 64, o + u * 118, 36, 16, 1, seg=18)                       # 防尘套
        cyl(b, o + u * 118, o + u * (L - 120), 13, mi=0, seg=12)                 # 轴
        cyl(b, o + u * (L - 120), o + u * (L - 66), 16, 40, 1, seg=18)
        cyl(b, o + u * (L - 66), o + u * (L - 8), 42, mi=0, seg=18)              # 外球笼
        cyl(b, o + u * (L - 8), o + u * (L + 30), 15, mi=0, seg=12)
        put(f'Drv_Shaft{tag}', b, [steel, rub], 'powertrain', loc=tuple(p0), kind='rot', shaft='diff', axis=[round(c, 5) for c in u])

    # ================================================================ 悬置
    b = bmesh.new()
    xr = SH.RAIL_X - SH.RAIL_W / 2
    rbox(b, (XE + E['x_pulley'] - 8 + 30, YC - 20, ZC + 130), (90, 110, 70), 12, 0, 2)          # 右悬置：正时端 → 右纵梁
    rbox(b, (xr - 6, YC - 20, ZC + 96), (36, 120, 30), 6, 1, 1)
    rbox(b, (X_COVER - 22, (A0[0] + A1[0]) / 2, ZC + 130), (70, 110, 70), 12, 0, 2)             # 左悬置：CVT 端盖 → 左纵梁
    rbox(b, (-xr + 6, (A0[0] + A1[0]) / 2, ZC + 96), (36, 120, 30), 6, 1, 1)
    cyl(b, (X_VAR0 - 30, A3[0] - 58, A3[1] - 85), (X_VAR0 - 30, 1285, 238), 16, mi=0, seg=12)    # 后抗扭拉杆 → 副车架后横梁的前面
    put('PT_Mounts', b, [rub, steel], 'powertrain', kind='static')

    # ================================================================ 冷却、进气、电瓶（前舱里的其他件）
    yr = SH.Y_CONDENSER - 22 - 22
    b = bmesh.new()
    rbox(b, (0, yr, 560), (700, 34, 400), 6, 0, 1)                                              # 水箱
    rbox(b, (0, yr - 30, 560), (640, 26, 380), 10, 1, 2)                                        # 风扇罩
    cyl(b, (100, yr - 44, 560), (100, yr - 84, 560), 46, mi=1, seg=16)                          # 风扇电机
    # 水管都从发动机靠 CVT 的那一头出来：上水管（节温器 → 水箱上口）在上，下水管（水箱下口 → 水泵进口）在下
    pipe(b, [(XE - 170, YC + 40, ZC + 300), (XE - 198, YC + 140, ZC + 340), (-150, 1900, 745), (-150, yr - 14, 735)], 36, mi=2)
    pipe(b, [(XE - 150, YC - 90, ZC + 180), (-82, 1500, 640), (-112, 1700, 600), (-120, 1900, 420), (-100, yr - 14, 392)], 32, mi=2)
    cyl(b, (330, 1890, 640), (330, 1890, 770), 58, mi=3, seg=18)                                # 膨胀水壶
    cyl(b, (-600, 1900, 400), (-600, 1900, 560), 68, mi=3, seg=18)                              # 玻璃水壶
    put('Bay_Cooling', b, [M['alu'], blk, rub, M['coolant']], 'bay', kind='static')
    b = bmesh.new()
    for k in range(7):                                                # 风扇叶片：先建一片朝上的（带一点扭角），再绕风扇轴转到位
        vs = rbox(b, (0, 0, 92), (34, 3, 150), 2, 0, 1, rot=(Vector((0, 0, 1)), 24))
        bmesh.ops.rotate(b, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(radians(360 * k / 7), 3, 'Y'))
    cyl(b, (0, -8, 0), (0, 8, 0), 34, mi=0, seg=18)
    put('Bay_Fan', b, [blk], 'bay', loc=(100, yr - 36, 560), kind='rot', shaft='fan', axis=[0, 1, 0])
    b = bmesh.new()
    rbox(b, (-300, 1835, 640), (240, 190, 170), 18, 0, 2)                                       # 空气滤清器盒
    pipe(b, [(-180, 1835, 655), (-110, 1810, 660), (XE - 188, YC + 215, ZC + 250)], 62, mi=0)   # → 节气门
    pipe(b, [(-300, 1930, 660), (-320, 2010, 690), (-330, 2090, 700)], 70, mi=0)                # 进气口，伸到水箱框架上面
    rbox(b, (-280, 1640, 750), (240, 175, 190), 8, 1, 1)                                        # 12 V 电瓶（在 CVT 上面）
    rbox(b, (-280, 1640, 648), (260, 195, 12), 4, 0, 1)
    for sx in (-70, 70):
        cyl(b, (-280 + sx, 1640, 845), (-280 + sx, 1640, 862), 9, mi=2, seg=10)
    rbox(b, (300, 1226, 770), (160, 40, 120), 8, 3, 1)                                          # 发动机电脑
    cyl(b, (-340, 1208, 770), (-340, 1286, 770), 98, mi=0, seg=28)                              # 刹车助力器
    cyl(b, (-340, 1286, 770), (-340, 1366, 770), 26, mi=3, seg=12)                              # 总泵
    put('Bay_Intake', b, [blk, M['battery'], M['conn'], M['alu']], 'bay', kind='static')

    # ================================================================ 排气
    xp = XE
    z_low, z_axle = 226.0, 348.0                  # 排气管在地板下面的高度（地板下沿 332，车身最低点 172）
    b = bmesh.new()
    # 前排气管：从催化器下口先往后，绕到右半轴的后面再往下，从转向机下面、副车架后横梁的口子里钻到地板下面
    pipe(b, [(xp, YC - 185, ZC - 18), (xp, 1338, 368), (xp + 6, 1300, 296), (xp + 14, 1262, 240), (xp + 20, 1215, z_low),
             (150, 1000, z_low), (150, 300, z_low)], 52, mi=0, it=3)
    cyl(b, (150, 300, z_low), (150, 260, z_low), 26, 42, 1, seg=18)
    cyl(b, (150, 260, z_low), (150, -160, z_low), 42, mi=1, seg=22)                             # 前消声器
    cyl(b, (150, -160, z_low), (150, -200, z_low), 42, 26, 1, seg=18)
    pipe(b, [(150, -200, z_low), (150, -1080, z_low), (150, -1250, 300), (150, -1420, z_axle), (150, -1640, z_axle),
             (150, -1800, 330)], 52, mi=0, it=3)
    cyl(b, (-200, -1900, 330), (300, -1900, 330), 86, mi=1, seg=24)                             # 后消声器（横放在后轴后面）
    pipe(b, [(150, -1800, 330), (160, -1830, 330)], 52, mi=0, it=0)
    pipe(b, [(300, -1900, 330), (380, -1920, 310), (400, -2100, 285), (400, SH.Y_TAIL + 6, 280)], 50, mi=0, it=2)   # 尾管
    put('Exh_Pipe', b, [M['exh'], M['exh2']], 'under', kind='static')

    # ================================================================ 油箱
    b = bmesh.new()
    rbox(b, (-270, -890, 258), (660, 500, 132), 28, 0, 3)
    pipe(b, [(-520, -1090, 318), (-640, -1160, 420), (-800, -1250, 640), (-852, -1280, 772)], 46, mi=1, it=2)   # 加油管
    pipe(b, [(-60, -650, 300), (-100, -400, 312), (-100, 1150, 312), (-100, 1215, 360), (-60, 1290, 600), (XE - 60, YC + 118, ZC + 296)],
         10, mi=2, it=2)                                                                         # 油管 → 油轨
    put('Fuel_Tank', b, [M['tank'], blk, steel], 'under', kind='static')
    return dict(derived=derived(), fit=fit_report(H))


def fit_report(H):
    """装进车里以后量间隙（都是从网格顶点量的，不是从参数表推的）"""
    rail_in = SH.RAIL_X - SH.RAIL_W / 2
    rz = [z for _, z in SH.RAIL_YZ]
    rz0, rz1 = min(rz) - SH.RAIL_H / 2, max(rz) + SH.RAIL_H / 2
    core = [p for n, v in BB.items() if n.startswith(('Eng_', 'Cvt_')) for p in v]
    bay = [p for n, v in BB.items() if n.startswith(('Eng_', 'Cvt_', 'Bay_', 'PT_')) for p in v]
    low = [p for n, v in BB.items() for p in v]
    at_rail = [p for p in core if rz0 <= p[2] <= rz1 and SH.RAIL_YZ[0][0] < p[1] < SH.RAIL_YZ[-1][0]]
    def hood_gap(pts):
        best, at = 1e9, None
        for x, y, z in pts:
            if z < 600:
                continue
            zs = H.skin_top_z(y, abs(x))
            if zs is None:
                continue
            c = zs - PL['hood_thickness'] - z
            if c < best:
                best, at = c, (x, y, z)
        return best, at
    hood, worst = hood_gap(bay)
    hood_eng, _ = hood_gap(core)
    y_fire = SH.Y_FIREWALL + 6
    rep = dict(
        total_len=round(max(p[0] for p in core) - min(p[0] for p in core), 1),
        rail_clear=round(2 * rail_in, 1),
        gap_right=round(rail_in - max(p[0] for p in at_rail), 1),
        gap_left=round(rail_in + min(p[0] for p in at_rail), 1),
        hood=round(hood, 1), hood_at=[round(c) for c in worst], hood_engine=round(hood_eng, 1),
        firewall=round(min(p[1] for p in core if p[2] > 345) - y_fire, 1),
        radiator=round(SH.Y_CONDENSER - 44 - 84 - max(p[1] for p in core), 1),      # 风扇电机的后面 → 发动机最前面
        ground_engine=round(min(p[2] for p in core), 1),
        ground_all=round(min(p[2] for p in low), 1),
    )
    print('[fit] 动力总成长 %(total_len).0f，纵梁净宽 %(rail_clear).0f：右边余 %(gap_right).0f，左边余 %(gap_left).0f' % rep)
    print('[fit] 发动机顶离前盖内板 %.0f；前舱里离前盖最近的件 %.0f（在 x=%d y=%d z=%d）' % (rep['hood_engine'], rep['hood'], *rep['hood_at']))
    print('[fit] 离前围板 %(firewall).0f，离风扇电机 %(radiator).0f，发动机 / CVT 最低点离地 %(ground_engine).0f，排气和油箱最低点离地 %(ground_all).0f' % rep)
    return rep
