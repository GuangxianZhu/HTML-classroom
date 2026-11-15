# -*- coding: utf-8 -*-
"""
前舱二维布置图：发动机 + CVT 横放在前舱里放不放得下。俯视一张、侧视一张。
    python layout2d.py [输出.png]

车身、纵梁、前围板、减震塔、冷凝器的位置读 shape.py（和三维模型是同一份数）。
发动机的外廓是把 四缸发动机爆炸图/build_engine.py 生成的模型量出来的（实测）；
CVT 的外廓、几根轴的位置、紧凑型发动机的尺寸是估算，图上都标了“估”。
"""
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
import shape as SH  # noqa: E402

plt.rcParams['font.sans-serif'] = ['Noto Sans CJK SC', 'Microsoft YaHei', 'SimHei', 'WenQuanYi Zen Hei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# ---- 现成的 2.0L 四缸（缸径 86 × 行程 86、缸心距 93）：模型实测，原点在曲轴中心线、缸体中间
ENG = dict(
    x_pulley=312.0,      # 曲轴中心往皮带轮端（正时端）伸出多少
    x_fly=259.0,         # 往飞轮端伸出多少
    y_in=291.0,          # 进气歧管一侧
    y_ex=266.0,          # 排气歧管一侧（含隔热罩）
    z_top=451.0,         # 点火线圈顶（气门室盖顶 441）
    z_pan=220.0,         # 油底壳底
    tris=169004,
)
# ---- CVT（估算）：液力变矩器 + 前进 / 倒挡行星排 + 两个锥轮 + 主减速 + 差速器
CVT_LEN = 360.0          # 沿曲轴方向，从飞轮端面算起
# ---- 紧凑的 1.5L 四缸（估算）：缸心距 82，比 2.0L 短约 60 mm；配一台窄一点的 CVT
ENG_S = dict(x_pulley=280.0, x_fly=232.0, y_in=270.0, y_ex=250.0, z_top=440.0, z_pan=205.0)
CVT_S_LEN = 345.0

# ---- 摆放（估算）：曲轴在前轴前面 160 mm、离地 405 mm；进气朝前、排气朝后
Y_C, Z_C = SH.WB + 160.0, 405.0
P2 = (SH.WB + 45.0, 565.0)        # 从动锥轮轴 (y, z)
DIFF = (SH.WB - 12.0, 335.0)      # 差速器 (y, z)
HOOD_T = 25.0                     # 前盖外表面到内板下沿
Y_RAD_BACK = SH.Y_CONDENSER - 22 - 100.0   # 冷凝器 + 水箱 + 风扇的后面（估）
LOCK_OUT = 32.0                   # 外侧轮最大转角（估）

C_BODY, C_FRAME, C_ENG, C_CVT, C_ALT, C_DIM = '#1f4e79', '#6b7785', '#c0392b', '#d98200', '#2e8b57', '#333333'


def dim(ax, p, q, txt, off=0.0, color=C_DIM, fs=9, va='bottom'):
    ax.annotate('', xy=q, xytext=p, arrowprops=dict(arrowstyle='<->', color=color, lw=1.0))
    mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
    ax.text(mx, my + off, txt, ha='center', va=va, fontsize=fs, color=color,
            bbox=dict(fc='white', ec='none', alpha=.8, pad=.6))


def main(out):
    sk = CK.Skin(SH.section_ctrl, SH.NSEG, SH.Y_TAIL, SH.Y_NOSE, smooth_y=30.0, interp=CK.fillet_section)
    fig = plt.figure(figsize=(9, 14.2), dpi=120)
    fig.suptitle('前舱布置：发动机 + CVT 横置（单位 mm）', fontsize=14, y=.985)

    # ============================================================ 俯视
    ax = fig.add_axes([.07, .535, .88, .42])
    ys = [1080 + (SH.Y_NOSE - 1080) * i / 200 for i in range(201)]
    hw = [CK.half_width(sk, y, 620.0) or 0 for y in ys]
    for sg in (1, -1):
        ax.plot([sg * w for w in hw], ys, color=C_BODY, lw=1.8)
    ax.plot([-hw[-1], hw[-1]], [SH.Y_NOSE] * 2, color=C_BODY, lw=1.8)
    # 前围板、纵梁、减震塔、冷凝器 / 水箱、防撞梁
    ax.plot([-735, 735], [SH.Y_FIREWALL + 6] * 2, color=C_FRAME, lw=3)
    ax.text(0, SH.Y_FIREWALL - 14, '前围板', ha='center', va='top', fontsize=9, color=C_FRAME)
    r0, r1 = SH.RAIL_X - SH.RAIL_W / 2, SH.RAIL_X + SH.RAIL_W / 2
    for sg in (1, -1):
        ax.add_patch(Rectangle((min(sg * r0, sg * r1), SH.RAIL_YZ[0][0]), SH.RAIL_W, SH.RAIL_YZ[-1][0] - SH.RAIL_YZ[0][0],
                               fc='#c9d1d9', ec=C_FRAME, lw=1))
        tx, ty = SH.TOWER_SIZE[0], SH.TOWER_SIZE[1]
        ax.add_patch(Rectangle((sg * SH.TOWER_X - tx / 2, SH.TOWER_Y - ty / 2), tx, ty, fc='none', ec=C_FRAME, lw=1, ls='--'))
        # 轮胎：直行 + 外侧轮打到最大转角（绕主销转；主销在轮胎中面往里 60 mm，估）
        x0, x1 = SH.TRACK - SH.TYRE_HW, SH.TRACK + SH.TYRE_HW
        rect = [(x0, SH.WB - SH.R_TYRE), (x1, SH.WB - SH.R_TYRE), (x1, SH.WB + SH.R_TYRE), (x0, SH.WB + SH.R_TYRE)]
        ax.add_patch(Polygon([(sg * x, y) for x, y in rect], closed=True, fc='#2b2b2b', ec='k', alpha=.75))
        a = math.radians(LOCK_OUT)
        px, py = SH.TRACK - 60.0, SH.WB
        rot = [(px + (x - px) * math.cos(a) - (y - py) * math.sin(a), py + (x - px) * math.sin(a) + (y - py) * math.cos(a))
               for x, y in rect]
        ax.add_patch(Polygon([(sg * x, y) for x, y in rot], closed=True, fc='none', ec='k', lw=.9, ls=':'))
    ax.text(SH.RAIL_X, SH.RAIL_YZ[-1][0] - 60, '纵梁', ha='center', fontsize=9, color=C_FRAME, rotation=90, va='top')
    ax.text(-SH.TOWER_X - 8, SH.TOWER_Y + 78, '减震塔', ha='center', va='center', fontsize=8, color=C_FRAME)
    ax.add_patch(Rectangle((-560, Y_RAD_BACK), 1120, SH.Y_CONDENSER + 22 - Y_RAD_BACK, fc='#dfe8ef', ec=C_FRAME, lw=1))
    ax.text(0, (Y_RAD_BACK + SH.Y_CONDENSER + 22) / 2, '冷凝器 + 水箱 + 风扇（估）', ha='center', va='center', fontsize=9,
            color=C_FRAME)
    ax.add_patch(Rectangle((-700, 2175), 1400, 60, fc='none', ec=C_FRAME, lw=1))
    ax.plot([-640, 640], [1335] * 2, color='#8a6d3b', lw=2)
    ax.text(648, 1335, '转向机', fontsize=8, color='#8a6d3b', va='center', bbox=dict(fc='white', ec='none', alpha=.85, pad=.8))
    # 动力总成：发动机在右、CVT 在左，整体居中
    tot = ENG['x_pulley'] + ENG['x_fly'] + CVT_LEN
    xr = tot / 2                                   # 皮带轮端
    xf = xr - ENG['x_pulley'] - ENG['x_fly']       # 飞轮端面
    ax.add_patch(Rectangle((xf, Y_C - ENG['y_ex']), xr - xf, ENG['y_ex'] + ENG['y_in'], fc=C_ENG, ec=C_ENG, alpha=.22, lw=1.5))
    ax.add_patch(Rectangle((xf, Y_C - ENG['y_ex']), xr - xf, ENG['y_ex'] + ENG['y_in'], fc='none', ec=C_ENG, lw=1.6))
    ax.add_patch(Rectangle((-tot / 2, DIFF[0] - 120), CVT_LEN, Y_C + 150 - (DIFF[0] - 120), fc=C_CVT, ec=C_CVT, alpha=.22))
    ax.add_patch(Rectangle((-tot / 2, DIFF[0] - 120), CVT_LEN, Y_C + 150 - (DIFF[0] - 120), fc='none', ec=C_CVT, lw=1.6))
    ax.plot([-tot / 2, xr], [Y_C] * 2, color=C_ENG, lw=.8, ls='-.')
    ax.text((xf + xr) / 2, Y_C + 60, '现成的 2.0L 四缸\n（模型实测）', ha='center', va='center', fontsize=10, color=C_ENG)
    ax.text((xf + xr) / 2, Y_C + ENG['y_in'] - 62, '进气歧管朝前', ha='center', va='center', fontsize=8, color=C_ENG)
    ax.text((xf + xr) / 2, Y_C - ENG['y_ex'] + 84, '排气歧管朝后', ha='center', va='center', fontsize=8, color=C_ENG)
    ax.text(-tot / 2 + CVT_LEN / 2, Y_C + 60, 'CVT\n（估）', ha='center', va='center', fontsize=10, color=C_CVT)
    # 紧凑方案
    tot_s = ENG_S['x_pulley'] + ENG_S['x_fly'] + CVT_S_LEN
    ax.add_patch(Rectangle((-tot_s / 2, Y_C - ENG_S['y_ex']), tot_s, ENG_S['y_ex'] + ENG_S['y_in'], fc='none', ec=C_ALT, lw=1.6,
                           ls='--'))
    # 尺寸
    yd = Y_C - ENG['y_ex'] - 55
    dim(ax, (-tot / 2, yd), (tot / 2, yd), f'2.0L + CVT ≈ {tot:.0f}', color=C_ENG, off=-6, va='top')
    yd2 = SH.RAIL_YZ[-1][0] + 8
    clear = 2 * r0
    dim(ax, (-r0, yd2), (r0, yd2), f'纵梁净宽 {clear:.0f}', off=5)
    yd3 = Y_C + ENG['y_in'] + 44
    dim(ax, (-tot_s / 2, yd3), (tot_s / 2, yd3), f'紧凑 1.5L + CVT ≈ {tot_s:.0f}（估）', color=C_ALT, off=5)
    ax.set_xlim(-980, 980)
    ax.set_ylim(1070, SH.Y_NOSE + 40)
    ax.set_aspect('equal')
    ax.set_title('俯视（上面是车头）。虚线框：减震塔；点线：外侧轮打到 %d°（估）' % LOCK_OUT, fontsize=10)
    ax.tick_params(labelsize=8)

    # ============================================================ 侧视
    ax = fig.add_axes([.07, .105, .88, .385])
    yy = [1060 + (SH.Y_NOSE - 1060) * i / 240 for i in range(241)]
    top = [sk.xz(y, 12)[1] for y in yy]
    ax.plot(yy, top, color=C_BODY, lw=1.8)
    ax.plot(yy, [t - HOOD_T for t in top], color=C_BODY, lw=.8, ls='--')
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
    ax.add_patch(Rectangle((Y_RAD_BACK, 370), SH.Y_CONDENSER + 22 - Y_RAD_BACK, 380, fc='#dfe8ef', ec=C_FRAME, lw=1))
    ax.text((Y_RAD_BACK + SH.Y_CONDENSER + 22) / 2, 560, '水箱\n（估）', ha='center', va='center', fontsize=8, color=C_FRAME)
    ax.add_patch(Circle((1335, 320), 26, fc='none', ec='#8a6d3b', lw=1.5))
    ax.add_patch(Rectangle((1315, 203), 90, 64, fc='none', ec='#8a6d3b', lw=1.2))
    ax.text(1296, 140, '转向机、副车架横梁\n（现在的位置）', ha='left', va='center', fontsize=8, color='#8a6d3b')
    # 发动机剖面轮廓（几个矩形拼的）：油底壳、缸体 + 缸盖、气门室盖 + 线圈、进气歧管（朝前）、排气歧管（朝后）
    for (y0, y1, z0, z1) in ((-126, 126, -220, -70), (-125, 125, -70, 390), (-113, 113, 390, 451), (107, 291, 125, 343),
                             (-266, -115, 66, 327)):
        ax.add_patch(Rectangle((Y_C + y0, Z_C + z0), y1 - y0, z1 - z0, fc=C_ENG, ec=C_ENG, alpha=.20, lw=1.2))
        ax.add_patch(Rectangle((Y_C + y0, Z_C + z0), y1 - y0, z1 - z0, fc='none', ec=C_ENG, lw=1.3))
    ax.plot([Y_C], [Z_C], '+', color=C_ENG, ms=12, mew=1.6)
    ax.text(Y_C, Z_C + 345, '2.0L 四缸', fontsize=10, color=C_ENG, ha='center', va='center')
    # CVT 的三根轴
    ax.add_patch(Circle((Y_C, Z_C), 142, fc='none', ec=C_CVT, lw=1.4))            # 液力变矩器
    ax.add_patch(Circle(P2, 98, fc='none', ec=C_CVT, lw=1.4))
    ax.add_patch(Circle(DIFF, 105, fc='none', ec=C_CVT, lw=1.4))
    ax.plot([Y_C, P2[0]], [Z_C, P2[1]], color=C_CVT, lw=1, ls='-.')
    ax.plot([P2[0], DIFF[0]], [P2[1], DIFF[1]], color=C_CVT, lw=1, ls='-.')
    for (cy_, cz_), n_ in (((Y_C + 96, Z_C - 96), '①'), ((P2[0], P2[1] + 60), '②'), ((DIFF[0] - 60, DIFF[1] + 55), '③')):
        ax.text(cy_, cz_, n_, fontsize=12, color=C_CVT, ha='center', va='center')
    ax.plot([DIFF[0], SH.WB], [DIFF[1], SH.R_TYRE], color='k', lw=1.6)
    # 间隙
    z_top = Z_C + ENG['z_top']
    z_hood = sk.xz(Y_C, 12)[1] - HOOD_T
    dim(ax, (Y_C - 40, z_top), (Y_C - 40, z_hood), f'{z_hood - z_top:.0f}', fs=9, off=0, va='center')
    y_ex, y_in = Y_C - ENG['y_ex'], Y_C + ENG['y_in']
    dim(ax, (SH.Y_FIREWALL + 6, 700), (y_ex, 700), f'{y_ex - SH.Y_FIREWALL - 6:.0f}', off=6)
    dim(ax, (y_in, 640), (Y_RAD_BACK, 640), f'{Y_RAD_BACK - y_in:.0f}', off=6)
    dim(ax, (Y_C + 60, 0), (Y_C + 60, Z_C - ENG['z_pan']), f'{Z_C - ENG["z_pan"]:.0f}', off=0, va='center')
    ax.set_xlim(SH.Y_NOSE + 60, 1040)            # 车头朝左
    ax.set_ylim(-40, 1090)
    ax.set_aspect('equal')
    ax.set_title('侧视（左边是车头）。蓝色虚线：前盖内板下沿；橙色圆（估）：① 变矩器 ② 从动锥轮 ③ 差速器', fontsize=10)
    ax.tick_params(labelsize=8)

    need = tot - clear
    lines = [
        f'宽度：现成的 2.0L + CVT ≈ {tot:.0f}，纵梁净宽 {clear:.0f}，差 {need:.0f}。纵梁不好再外移：外侧轮打到 {LOCK_OUT:.0f}° 时胎角离纵梁只剩几毫米（估）。',
        f'　　　紧凑的 1.5L + CVT ≈ {tot_s:.0f}（估）刚好放下；纵梁再做窄一点（{SH.RAIL_W:.0f} → 60），每边还能多出 10。',
        f'高度：发动机顶离前盖内板 {z_hood - z_top:.0f}。前后：排气歧管离前围板 {y_ex - SH.Y_FIREWALL - 6:.0f}，进气歧管离水箱 {Y_RAD_BACK - y_in:.0f}。油底壳离地 {Z_C - ENG["z_pan"]:.0f}。',
        '要改：差速器和转向机、副车架横梁现在的位置重叠，这两件要往后、往下让。',
    ]
    for i, t in enumerate(lines):
        fig.text(.07, .066 - i * .0165, t, fontsize=9.2, color='#222')
    fig.savefig(out)
    print(f'[layout] 2.0L + CVT {tot:.0f} / 纵梁净宽 {clear:.0f} / 差 {need:.0f}；紧凑方案 {tot_s:.0f}')
    print(f'[layout] 顶部间隙 {z_hood - z_top:.0f}  前围板 {y_ex - SH.Y_FIREWALL - 6:.0f}  水箱 {Y_RAD_BACK - y_in:.0f}  离地 {Z_C - ENG["z_pan"]:.0f}')
    print('[OK]', out)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out', 'layout_frontbay.png'))
