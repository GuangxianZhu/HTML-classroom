# -*- coding: utf-8 -*-
"""
前舱二维布置图：发动机 + CVT 横放在前舱里的位置和间隙。俯视一张、侧视一张。
    python layout2d.py [输出.png]

位置全部来自和三维模型同一份数据：
    车身、纵梁、前围板、减震塔、冷凝器   shape.py
    发动机、CVT 的尺寸和摆放             ../params.json（经 powertrain.py 推出各根轴的位置）
间隙的数字读 out/spec.json 里的 powertrain.fit：那是 build_car.py 建完模型以后从网格顶点量出来的，
不是从参数表推的。还没跑过 build_car.py 的话，图上只画位置、不标间隙。
"""
import json
import math
import os
import sys

import bpy  # noqa: F401  pip 版 bpy 要先导入，bmesh / mathutils 才能用
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Circle, Polygon, Rectangle  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import carkit as CK  # noqa: E402
import powertrain as PT  # noqa: E402
import shape as SH  # noqa: E402

plt.rcParams['font.sans-serif'] = ['Noto Sans CJK SC', 'Microsoft YaHei', 'SimHei', 'WenQuanYi Zen Hei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

E, C, PL = PT.E, PT.C, PT.PL
YC, ZC, XE, XB = PT.YC, PT.ZC, PT.XE, PT.XB
A0, A1, A2, A3 = PT.A0, PT.A1, PT.A2, PT.A3
Y_RAD = SH.Y_CONDENSER - 44.0            # 水箱中面
Y_FAN = Y_RAD - 84.0                     # 风扇电机的后面
RACK = (1232.0, 300.0, 26.0)             # 转向机 (y, z, 半径)，和 build_car.build_chassis 里一致
LOCK_OUT = 32.0                          # 外侧轮最大转角（估）
C_BODY, C_FRAME, C_ENG, C_CVT, C_DIM, C_AUX = '#1f4e79', '#6b7785', '#c0392b', '#d98200', '#333333', '#5a6b7a'


def dim(ax, p, q, txt, off=0.0, color=C_DIM, fs=9, va='bottom'):
    ax.annotate('', xy=q, xytext=p, arrowprops=dict(arrowstyle='<->', color=color, lw=1.0))
    ax.text((p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + off, txt, ha='center', va=va, fontsize=fs, color=color,
            bbox=dict(fc='white', ec='none', alpha=.8, pad=.6))


def box(ax, x0, y0, w, h, color, label=None, alpha=.2, fs=10, ls='-'):
    ax.add_patch(Rectangle((x0, y0), w, h, fc=color, ec='none', alpha=alpha))
    ax.add_patch(Rectangle((x0, y0), w, h, fc='none', ec=color, lw=1.5, ls=ls))
    if label:
        ax.text(x0 + w / 2, y0 + h / 2, label, ha='center', va='center', fontsize=fs, color=color)


def main(out):
    sk = CK.Skin(SH.section_ctrl, SH.NSEG, SH.Y_TAIL, SH.Y_NOSE, smooth_y=30.0, interp=CK.fillet_section)
    fit = None
    sp = os.path.join(HERE, 'out', 'spec.json')
    if os.path.exists(sp):
        with open(sp, encoding='utf-8') as f:
            fit = (json.load(f).get('powertrain') or {}).get('fit')
    fig = plt.figure(figsize=(9, 14.2), dpi=120)
    fig.suptitle('前舱布置：%.1f L 四缸 + CVT 横置（单位 mm）' % (PT.DISP_CC / 1000), fontsize=14, y=.985)
    r0, r1 = SH.RAIL_X - SH.RAIL_W / 2, SH.RAIL_X + SH.RAIL_W / 2
    x_r, x_l = XE + E['x_pulley'], PT.X_COVER

    # ============================================================ 俯视
    ax = fig.add_axes([.07, .535, .88, .42])
    ys = [1080 + (SH.Y_NOSE - 1080) * i / 200 for i in range(201)]
    hw = [CK.half_width(sk, y, 620.0) or 0 for y in ys]
    for sg in (1, -1):
        ax.plot([sg * w for w in hw], ys, color=C_BODY, lw=1.8)
    ax.plot([-hw[-1], hw[-1]], [SH.Y_NOSE] * 2, color=C_BODY, lw=1.8)
    ax.plot([-735, 735], [SH.Y_FIREWALL + 6] * 2, color=C_FRAME, lw=3)
    ax.text(0, SH.Y_FIREWALL - 14, '前围板', ha='center', va='top', fontsize=9, color=C_FRAME)
    for sg in (1, -1):
        ax.add_patch(Rectangle((min(sg * r0, sg * r1), SH.RAIL_YZ[0][0]), SH.RAIL_W, SH.RAIL_YZ[-1][0] - SH.RAIL_YZ[0][0],
                               fc='#c9d1d9', ec=C_FRAME, lw=1))
        tx, ty = SH.TOWER_SIZE[0], SH.TOWER_SIZE[1]
        ax.add_patch(Rectangle((sg * SH.TOWER_X - tx / 2, SH.TOWER_Y - ty / 2), tx, ty, fc='none', ec=C_FRAME, lw=1, ls='--'))
        x0, x1 = SH.TRACK - SH.TYRE_HW, SH.TRACK + SH.TYRE_HW
        rect = [(x0, SH.WB - SH.R_TYRE), (x1, SH.WB - SH.R_TYRE), (x1, SH.WB + SH.R_TYRE), (x0, SH.WB + SH.R_TYRE)]
        ax.add_patch(Polygon([(sg * x, y) for x, y in rect], closed=True, fc='#2b2b2b', ec='k', alpha=.75))
        a = math.radians(LOCK_OUT)
        px, py = SH.TRACK - 60.0, SH.WB
        rot = [(px + (x - px) * math.cos(a) - (y - py) * math.sin(a), py + (x - px) * math.sin(a) + (y - py) * math.cos(a))
               for x, y in rect]
        ax.add_patch(Polygon([(sg * x, y) for x, y in rot], closed=True, fc='none', ec='k', lw=.9, ls=':'))
    ax.text(SH.RAIL_X, SH.RAIL_YZ[-1][0] - 60, '纵梁', ha='center', fontsize=9, color=C_FRAME, rotation=90, va='top')
    ax.add_patch(Rectangle((-560, Y_FAN), 1120, SH.Y_CONDENSER + 22 - Y_FAN, fc='#dfe8ef', ec=C_FRAME, lw=1))
    ax.text(0, (Y_FAN + SH.Y_CONDENSER + 22) / 2, '冷凝器 + 水箱 + 风扇', ha='center', va='center', fontsize=9, color=C_FRAME)
    ax.add_patch(Rectangle((-700, 2175), 1400, 60, fc='none', ec=C_FRAME, lw=1))
    ax.plot([-640, 640], [RACK[0]] * 2, color='#8a6d3b', lw=2)
    ax.text(648, RACK[0], '转向机', fontsize=8, color='#8a6d3b', va='center', bbox=dict(fc='white', ec='none', alpha=.85, pad=.8))
    # 发动机、CVT、半轴
    box(ax, XB, YC - E['y_exhaust'], x_r - XB, E['y_exhaust'] + E['y_intake'], C_ENG, '%.1f L 四缸' % (PT.DISP_CC / 1000))
    ax.text((XB + x_r) / 2, YC + E['y_intake'] - 40, '进气歧管朝前', ha='center', va='center', fontsize=8, color=C_ENG)
    ax.text((XB + x_r) / 2, YC - E['y_exhaust'] + 40, '排气歧管 + 催化器朝后', ha='center', va='center', fontsize=8, color=C_ENG)
    box(ax, x_l, A3[0] - 118, XB - x_l, A0[0] + 94 - (A3[0] - 118), C_CVT, 'CVT')
    ax.plot([x_l, x_r], [YC] * 2, color=C_ENG, lw=.8, ls='-.')
    ax.plot([-(SH.TRACK - 62), PT.X_VAR0 + 14], [SH.WB, A3[0]], color='k', lw=2.2)
    ax.plot([PT.X_GEAR0 + 94, SH.TRACK - 62], [A3[0], SH.WB], color='k', lw=2.2)
    ax.text(585, A3[0] + 22, '半轴', fontsize=8, color='k', ha='center', va='bottom')
    box(ax, -400, 1552, 240, 175, C_AUX, '电瓶', alpha=.12, fs=8, ls='--')
    box(ax, -420, 1740, 240, 190, C_AUX, '空滤', alpha=.12, fs=8, ls='--')
    yd = YC - E['y_exhaust'] - 34
    dim(ax, (x_l, yd), (x_r, yd), '发动机 + CVT %.0f' % (x_r - x_l), color=C_ENG, off=-6, va='top')
    yd2 = SH.RAIL_YZ[-1][0] + 8
    dim(ax, (-r0, yd2), (r0, yd2), '纵梁净宽 %.0f' % (2 * r0), off=5)
    ax.set_xlim(-980, 980)
    ax.set_ylim(1070, SH.Y_NOSE + 40)
    ax.set_aspect('equal')
    ax.set_title('俯视（上面是车头，右边是车右）。虚线框：减震塔；点线：外侧轮打到 %d°（估）' % LOCK_OUT, fontsize=10)
    ax.tick_params(labelsize=8)

    # ============================================================ 侧视
    ax = fig.add_axes([.07, .105, .88, .385])
    yy = [1060 + (SH.Y_NOSE - 1060) * i / 240 for i in range(241)]
    top = [sk.xz(y, 12)[1] for y in yy]
    ax.plot(yy, top, color=C_BODY, lw=1.8)
    ax.plot(yy, [t - PL['hood_thickness'] for t in top], color=C_BODY, lw=.8, ls='--')
    ax.plot([SH.Y_NOSE] * 2, [sk.xz(SH.Y_NOSE, 0)[1], sk.xz(SH.Y_NOSE, 12)[1]], color=C_BODY, lw=1.8)
    ax.plot(yy, [sk.xz(y, 0)[1] for y in yy], color=C_BODY, lw=1.2)
    ax.axhline(0, color='k', lw=1)
    ax.add_patch(Circle((SH.WB, SH.R_TYRE), SH.R_TYRE, fc='none', ec='k', lw=1.3))
    ax.add_patch(Circle((SH.WB, SH.R_TYRE), SH.R_ARCH, fc='none', ec='#999', lw=.8, ls='--'))
    ax.plot([SH.Y_FIREWALL + 6] * 2, [340, 914], color=C_FRAME, lw=3)
    ax.text(SH.Y_FIREWALL - 26, 470, '前围板', rotation=90, ha='center', va='center', fontsize=9, color=C_FRAME)
    rl = SH.RAIL_YZ
    ax.add_patch(Polygon([(y, z - SH.RAIL_H / 2) for y, z in rl] + [(y, z + SH.RAIL_H / 2) for y, z in rl[::-1]], closed=True,
                         fc='#c9d1d9', ec=C_FRAME, lw=1, alpha=.7))
    ax.text(rl[-1][0] - 30, rl[-1][1], '纵梁', ha='right', va='center', fontsize=8, color=C_FRAME)
    ax.add_patch(Rectangle((Y_FAN, 370), SH.Y_CONDENSER + 22 - Y_FAN, 380, fc='#dfe8ef', ec=C_FRAME, lw=1))
    ax.text((Y_FAN + SH.Y_CONDENSER + 22) / 2, 560, '水箱', ha='center', va='center', fontsize=8, color=C_FRAME)
    ax.add_patch(Circle(RACK[:2], RACK[2], fc='none', ec='#8a6d3b', lw=1.5))
    for yc in (1236, 1800):
        ax.add_patch(Rectangle((yc - 45, 203), 90, 64, fc='none', ec='#8a6d3b', lw=1.2))
    ax.text(1150, 150, '转向机、副车架', ha='center', va='center', fontsize=8, color='#8a6d3b')
    # 发动机剖面轮廓：油底壳、曲轴箱、气缸、缸盖、气门室盖 + 线圈、进气稳压腔、催化器
    HWd = E['half_w']
    for (y0, y1, z0, z1) in ((-HWd + 7, HWd - 7, E['pan_bot'], -60), (-HWd, HWd, -60, 70), (-88, 88, 66, E['deck']),
                             (-HWd + 2, HWd - 2, E['deck'], E['head_top']), (-93, 93, E['head_top'], E['cover_top']),
                             (-17, 17, E['cover_top'], E['coil_top']), (-242, -128, -18, 232)):
        box(ax, YC + y0, ZC + z0, y1 - y0, z1 - z0, C_ENG)
    ax.add_patch(Circle((YC + 215, ZC + 250), 52, fc=C_ENG, ec=C_ENG, alpha=.2))
    ax.add_patch(Circle((YC + 215, ZC + 250), 52, fc='none', ec=C_ENG, lw=1.4))
    ax.plot([YC], [ZC], '+', color=C_ENG, ms=12, mew=1.6)
    ax.text(YC, ZC + 352, '发动机', fontsize=10, color=C_ENG, ha='center', va='center')
    for (c, r, n_, dx, dz) in ((A0, C['tc_radius'], '①', 150, -70), (A1, C['sheave_r'], '②', -30, 104), (A2, PT.R_IDL, '③', -86, 30),
                               (A3, PT.R_RING, '④', -130, -30)):
        ax.add_patch(Circle(c, r, fc='none', ec=C_CVT, lw=1.4))
        ax.text(c[0] + dx, c[1] + dz, n_, fontsize=12, color=C_CVT, ha='center', va='center')
    ax.add_patch(Circle(A0, C['sheave_r'], fc='none', ec=C_CVT, lw=1.0, ls='--'))
    for p, q in ((A0, A1), (A1, A2), (A2, A3)):
        ax.plot([p[0], q[0]], [p[1], q[1]], color=C_CVT, lw=1, ls='-.')
    ax.plot([A3[0], SH.WB], [A3[1], SH.R_TYRE], color='k', lw=2)
    if fit:
        z_top = ZC + E['coil_top']
        dim(ax, (YC - 40, z_top), (YC - 40, z_top + fit['hood_engine']), '%.0f' % fit['hood_engine'], off=0, va='center')
        dim(ax, (SH.Y_FIREWALL + 6, 425), (SH.Y_FIREWALL + 6 + fit['firewall'], 425), '%.0f' % fit['firewall'], off=6)
        dim(ax, (Y_FAN - fit['radiator'], 640), (Y_FAN, 640), '%.0f' % fit['radiator'], off=6)
        dim(ax, (YC + 60, 0), (YC + 60, fit['ground_engine']), '%.0f' % fit['ground_engine'], off=0, va='center')
    ax.set_xlim(SH.Y_NOSE + 60, 1040)            # 车头朝左
    ax.set_ylim(-40, 1090)
    ax.set_aspect('equal')
    ax.set_title('侧视（左边是车头）。蓝色虚线：前盖内板下沿；橙色：① 变矩器 / 主动锥轮 ② 从动锥轮 ③ 中间轴 ④ 差速器', fontsize=10)
    ax.tick_params(labelsize=8)

    lines = ['速比：CVT %.2f ~ %.2f（跨度 %.1f），主减速 %.2f；钢带长 %.0f，两根锥轮轴相距 %.0f。'
             % (PT.RATIO_LOW, PT.RATIO_HIGH, PT.RATIO_LOW / PT.RATIO_HIGH, PT.FINAL, PT.BELT_L, C['centre'])]
    if fit:
        lines = [
            '宽度：发动机 + CVT 长 %(total_len).0f，纵梁净宽 %(rail_clear).0f，右边余 %(gap_right).0f、左边余 %(gap_left).0f。' % fit,
            '高度：发动机顶离前盖内板 %(hood_engine).0f，电瓶离前盖内板 %(hood).0f。前后：离前围板 %(firewall).0f，离风扇电机 %(radiator).0f。' % fit,
            '离地：发动机 / CVT 最低点 %(ground_engine).0f，排气管和油箱最低点 %(ground_all).0f（车身最低点 172）。' % fit,
        ] + lines
    else:
        lines.append('还没有间隙数字：先跑一遍 build_car.py，它会把量出来的间隙写进 out/spec.json。')
    for i, t in enumerate(lines):
        fig.text(.07, .066 - i * .0165, t, fontsize=9.2, color='#222')
    fig.savefig(out)
    print('[OK]', out)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out', 'layout_frontbay.png'))
