# -*- coding: utf-8 -*-
"""
汽车模拟器 · 车身外形（纯 Python，不依赖 Blender；build_car.py、preview2d.py、layout2d.py 都读这一份）

一辆虚构的三厢教学车，走上世纪八十年代的直线造型：平的前盖和尾箱盖、立着的车头车尾、
一条从车头贯穿到车尾的肩线、清楚的棱线。不对应任何一款真车。

外形 = 五条沿车长的线 + 一个横截面配方：
    ZTOP   侧视的顶线（前盖 → 前挡 → 车顶 → 后挡 → 尾箱盖，全是直线段）
    ZBELT  肩线 / 腰线（一条前低后高的直线）
    ZBOT   底线
    HW     俯视的最宽线（半宽）
    HT     车顶边（乘员舱）/ A、C 柱根（前盖、尾箱）离中线多远
横截面用 carkit.fillet_section 的“直线 + 圆角”：控制点之间是直线，每个控制点给一个圆角大小。

坐标：毫米，+X 车右，+Y 车头，+Z 朝上，原点在前后轴中点的地面。
"""
from bisect import bisect_right

# ---- 硬点（和软件定义汽车那辆车共用：轴距、前后悬、座椅和地板的位置都没动）
Y_TAIL, Y_NOSE = -2415.0, 2345.0      # 车长 4760
WB = 1400.0                           # 前后轴到原点（轴距 2800）
R_TYRE = 320.0                        # 195/65 R15 一类：外径约 640
R_ARCH = 362.0
TRACK = 770.0                         # 轮胎中面离中线
TYRE_HW = 100.0                       # 轮胎半宽

# ---- 侧视的几个转折点
Y_COWL = 1165.0       # 前挡下沿
Y_HEAD = 680.0        # 前挡上沿
Y_BACK = -1000.0      # 后挡上沿
Y_DECK = -1480.0      # 后挡下沿 = 尾箱盖前缘

NSEG = 12

# ---- 前舱的硬点（车框按这几个数建，前舱布置图 layout2d.py 也读这一份）
Y_FIREWALL = 1196.0                   # 前围板
RAIL_X, RAIL_W, RAIL_H = 470.0, 80.0, 120.0      # 前纵梁：中心离中线、宽（沿车宽）、高
RAIL_YZ = ((1190.0, 400.0), (1700.0, 420.0), (2130.0, 440.0))   # 前纵梁中心线 (y, z)
TOWER_X, TOWER_Y, TOWER_Z = 500.0, 1410.0, 700.0  # 前减震塔中心
TOWER_SIZE = (170.0, 220.0, 200.0)
Y_CONDENSER = 2070.0                  # 冷凝器


def plin(pairs):
    """分段直线"""
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]

    def f(x):
        x = min(max(x, xs[0]), xs[-1])
        i = min(bisect_right(xs, x) - 1, len(xs) - 2)
        return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i])
    return f


def pchip(pairs):
    """保形三次插值（不会在控制点之间鼓包）"""
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        x = min(max(x, xs[0]), xs[-1])
        i = min(bisect_right(xs, x) - 1, n - 2)
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] +
                (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])
    return f


# 肩线：一条直线，车头 890 → 车尾 1005（前低后高约 1.4°，就是老式三厢车的“楔形”）
ZBELT_b = plin([(Y_TAIL, 1005.0), (Y_NOSE, 890.0)])


def _belt(y):
    return ZBELT_b(y)


# 顶线：前盖比肩线高 28（车头）~ 43（前挡下沿），尾箱盖比肩线高 28；
# 前挡约 44°、后挡约 41°（和水平面的夹角）；车顶中间比前后沿高十几毫米
ZTOP_b = plin([
    (Y_TAIL, _belt(Y_TAIL) + 28), (Y_DECK, _belt(Y_DECK) + 28),
    (Y_BACK, 1430.0), (-600.0, 1447.0), (-200.0, 1452.0), (200.0, 1450.0), (Y_HEAD, 1436.0),
    (Y_COWL, _belt(Y_COWL) + 43), (Y_NOSE, _belt(Y_NOSE) + 28),
])
ZBOT_b = pchip([(Y_TAIL, 300), (-2250, 262), (-2050, 205), (-1850, 178), (-1400, 172), (1400, 172), (1850, 178),
                (2050, 200), (2240, 245), (Y_NOSE, 268)])
# 俯视：中段全宽 1800，往车头车尾各收一点
HW_b = pchip([(Y_TAIL, 874), (-2000, 894), (-1400, 900), (1400, 900), (2000, 890), (Y_NOSE, 868)])
# 车顶半宽 715（侧窗往里倾约 17°）；A 柱根、C 柱根在前盖 / 尾箱盖的边上
HT_b = plin([(Y_TAIL, 792), (Y_DECK, 792), (Y_BACK, 715), (Y_HEAD, 715), (Y_COWL, 800), (Y_NOSE, 792)])

# 车头车尾收口：(俯视收口长度, 指数, 端面剩下的宽度比例), (侧视收口长度, 指数, 端面剩下的高度比例), 最突出点的高度
# 直板造型：端面基本是立着的一整块，只在最后一百多毫米把四个角倒圆
CLOSE_NOSE = ((150.0, 2.6, .86), (70.0, 2.4, .90), 520.0)
CLOSE_TAIL = ((140.0, 2.6, .87), (70.0, 2.4, .90), 600.0)


def _q(u, n):
    return 1.0 if u >= 1 else (1 - (1 - max(u, 0.0)) ** n) ** (1 / n)


def _close(y):
    d_n, d_t = Y_NOSE - y, y - Y_TAIL
    (pp, pz, zm), d = (CLOSE_NOSE, d_n) if d_n < d_t else (CLOSE_TAIL, d_t)
    return pp[2] + (1 - pp[2]) * _q(d / pp[0], pp[1]), pz[2] + (1 - pz[2]) * _q(d / pz[0], pz[1]), zm


def ZTOP(y):
    _, fz, zm = _close(y)
    return zm + (ZTOP_b(y) - zm) * fz


def ZBELT(y):
    _, fz, zm = _close(y)
    return zm + (ZBELT_b(y) - zm) * fz


def ZBOT(y):
    _, fz, zm = _close(y)
    return zm - (zm - ZBOT_b(y)) * fz


def HW(y):
    return HW_b(y) * _close(y)[0]


def HT(y):
    return HT_b(y) * _close(y)[0]


ROOF_DROP = 34.0      # 车顶边比车顶中线低多少
SMOOTH = 400.0        # 圆角给这么大 = 这一点不出棱，前后连成光滑曲线


def cabin_t(y):
    """0 = 前盖 / 尾箱盖那种截面，1 = 乘员舱截面。按“顶线比肩线高多少”过渡。
    前挡下沿、后挡下沿那里两种截面本来就几乎重合（前盖的拱高 ≈ 车顶边的落差），所以过渡很短、不起包"""
    gh = ZTOP(y) - ZBELT(y)
    t = min(1.0, max(0.0, (gh - 44.0) / 40.0))
    return t * t * (3 - 2 * t)


def section_ctrl(y):
    """一个横截面的 13 个控制点 (x, z, 圆角)，右半边，从底部中线绕到车顶中线。序号就是曲面参数 s：
        0 底部中线 · 1 ~ 2 底板 · 3 门槛下角 · 4 车门下半 · 5 最宽处（防擦条那道棱）· 6 肩线（棱）
        7 窗台 / 前盖边（棱）· 8 侧窗中间 · 9 车顶边（棱）/ A、C 柱根 · 10 ~ 11 车顶 · 12 车顶中线
    乘员舱：肩线上面一小条窗台，侧窗是一个往里倾的平面，车顶边是一道清楚的棱，车顶微微拱起。
    前盖 / 尾箱盖：肩线上面一小条斜边，再往里是一块微拱的平板（7 ~ 12 在一条抛物线上），没有窗。
    圆角大小全车不变（不跟着截面类型变）：圆角一路变大变小的面是扭的，车漆反光会起皱"""
    zt, zb, zbl, hw, ht = ZTOP(y), ZBOT(y), ZBELT(y), HW(y), HT(y)
    h = max(zbl - zb, 1.0)
    k = min(1.0, hw / 420)
    kv = min(1.0, h / 420)
    k = min(k, kv * 1.6)
    gh = max(zt - zbl, .5)
    t = cabin_t(y)
    hwb = hw - 110 * k
    x7 = hw - 36 * k
    ht = min(ht, x7 - 30 * k)
    z7 = zbl + 4 * kv
    crown = max(gh - 4 * kv, 0.0)                    # 前盖 / 尾箱盖中线比边上高多少
    e9 = min(ROOF_DROP, crown * (ht / x7) ** 2)      # 车顶边（或 A、C 柱根）比中线低多少
    z9 = zt - e9
    x8 = (x7 + ht) / 2
    z8 = t * (z7 + z9) / 2 + (1 - t) * (zt - crown * (x8 / x7) ** 2)
    return [
        (0.0, zb, SMOOTH),
        (hwb * .55, zb, SMOOTH),
        (hwb, zb + 2 * k, 60.0),
        (hw - 30 * k, zb + .075 * h, 30.0 * k),
        (hw - 8 * k, zb + .22 * h, SMOOTH),
        (hw, zb + .46 * h, 14.0 * k),
        (hw - 10 * k, zbl - 10 * kv, 12.0 * k),
        (x7, z7, 10.0 * k),
        (x8, z8, SMOOTH),
        (ht, z9, 26.0),
        (ht * .66, zt - e9 * .66 ** 2, SMOOTH),
        (ht * .33, zt - e9 * .33 ** 2, SMOOTH),
        (0.0, zt, SMOOTH),
    ]


CREASE_NODES = (3, 5, 6, 7, 9)      # 出棱线的控制点（圆角小的地方）
