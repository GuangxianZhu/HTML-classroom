# -*- coding: utf-8 -*-
"""
外形的二维预览：侧视、俯视、一排横截面。调外形时先看这张图（几秒钟），对了再跑三维。
    python preview2d.py [输出.png]
用的是和三维同一张外皮（carkit.Skin + shape.section_ctrl），所以图上是什么，三维里就是什么。
"""
import os
import sys

import bpy  # noqa: F401  pip 版 bpy 要先导入，bmesh / mathutils 才能用
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import carkit as CK  # noqa: E402
import shape as SH  # noqa: E402


def main(out):
    sk = CK.Skin(SH.section_ctrl, SH.NSEG, SH.Y_TAIL, SH.Y_NOSE, smooth_y=30.0, interp=CK.fillet_section)
    ys = [SH.Y_TAIL + (SH.Y_NOSE - SH.Y_TAIL) * i / 400 for i in range(401)]
    fig = plt.figure(figsize=(16, 12), dpi=110)
    ax = fig.add_axes([.04, .60, .92, .37])
    for s, c, lw in ((12, '#1f4e79', 1.8), (9, '#1f4e79', 1.0), (7, '#c0504d', 1.0), (6, '#c0504d', 1.6), (5, '#888', .8),
                     (3, '#888', .8), (0, '#1f4e79', 1.8)):
        ax.plot(ys, [sk.xz(y, s)[1] for y in ys], color=c, lw=lw)
    for yc in (SH.WB, -SH.WB):
        ax.add_patch(plt.Circle((yc, SH.R_TYRE), SH.R_TYRE, fill=False, color='k', lw=1.4))
        ax.add_patch(plt.Circle((yc, SH.R_TYRE), SH.R_ARCH, fill=False, color='#999', lw=.8, ls='--'))
    for y, nm in ((SH.Y_COWL, 'cowl'), (SH.Y_HEAD, 'header'), (SH.Y_BACK, 'back top'), (SH.Y_DECK, 'deck')):
        ax.axvline(y, color='#bbb', lw=.6, ls=':')
        ax.text(y, 1500, nm, ha='center', fontsize=8, color='#666')
    ax.axhline(0, color='k', lw=.8)
    ax.set_xlim(SH.Y_NOSE + 150, SH.Y_TAIL - 150)       # 车头朝左
    ax.set_ylim(-60, 1560)
    ax.set_aspect('equal')
    ax.set_title('side: s = 0 / 3 / 5 / 6 (shoulder) / 7 / 9 (roof edge) / 12 (centre)', fontsize=9)
    ax = fig.add_axes([.04, .30, .92, .27])
    for s, c, lw in ((5, '#c0504d', 1.6), (6, '#c0504d', 1.0), (7, '#888', .8), (9, '#1f4e79', 1.2), (3, '#bbb', .8)):
        xs = [sk.xz(y, s)[0] for y in ys]
        ax.plot(ys, xs, color=c, lw=lw)
        ax.plot(ys, [-x for x in xs], color=c, lw=lw)
    for yc in (SH.WB, -SH.WB):
        for sx in (1, -1):
            ax.add_patch(plt.Rectangle((yc - SH.R_TYRE, sx * SH.TRACK - SH.TYRE_HW), 2 * SH.R_TYRE, 2 * SH.TYRE_HW,
                                       fill=False, color='k', lw=1))
    ax.set_xlim(SH.Y_NOSE + 150, SH.Y_TAIL - 150)
    ax.set_ylim(-1000, 1000)
    ax.set_aspect('equal')
    ax.set_title('top: s = 5 (widest) / 6 / 7 / 9 / 3', fontsize=9)
    cuts = [2330, 2250, 1800, 1300, 1140, 1000, 800, 0, -900, -1200, -1420, -1600, -2330]
    for i, y in enumerate(cuts):
        ax = fig.add_axes([.02 + i * .0755, .02, .072, .25])
        pts = [sk.xz(y, k / 40) for k in range(SH.NSEG * 40 + 1)]
        ax.plot([p[0] for p in pts], [p[1] for p in pts], color='#1f4e79', lw=1.2)
        cp = sk.sec(y)
        ax.plot([p[0] for p in cp], [p[1] for p in cp], '.', color='#c0504d', ms=3)
        ax.set_xlim(-30, 960)
        ax.set_ylim(120, 1500)
        ax.set_aspect('equal')
        ax.set_title(f'y={y}', fontsize=8)
        ax.tick_params(labelsize=6)
    fig.savefig(out)
    L = SH.Y_NOSE - SH.Y_TAIL
    W = 2 * max(sk.xz(y, 5)[0] for y in ys)
    H = max(sk.xz(y, 12)[1] for y in ys)
    print(f'[shape] L {L:.0f}  W {W:.0f}  H {H:.0f}  WB {2 * SH.WB:.0f}  front oh {SH.Y_NOSE - SH.WB:.0f}  rear oh {-SH.Y_TAIL - SH.WB:.0f}')
    print('[OK]', out)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out', 'shape2d.png'))
