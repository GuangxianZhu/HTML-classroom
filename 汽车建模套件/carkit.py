# -*- coding: utf-8 -*-
"""
carkit · 脚本化汽车建模套件（Blender bmesh，单位毫米，+X 车右 / +Y 车头 / +Z 朝上）

版本 1.1（2026-11-15）
母版在仓库根目录 汽车建模套件/carkit.py。用到它的项目在自己的 blender/ 里放一份副本，
这样项目文件夹单独拷走也能跑；改了副本记得回写母版，再同步到其他项目。

按真车的造车顺序建：
    0. 外皮基准面 Skin   一圈圈横截面定义整车外形（只给右半边，左边镜像）
    1. 局部展开图 Chart   按片展开（侧围一张、车顶一张、前盖一张……），不把整车摊成一张：
                          整车一张图在车头车尾、车顶转角处拉伸很大，按片展开每片里误差都小。
                          a 沿车长、b 沿截面周长，单位都是毫米。
                          缝线、窗洞、柱子、车框走向的输入一律用曲面参数 (y, s)，
                          s 是截面控制点序号（0 = 底部中线，nseg = 车顶中线），
                          所以相邻两片即使用不同的展开图，共用的那条缝线也是同一条
    2. 车框 member()      沿展开图上一条线，在外皮里面扫一根圆角方管（门槛、A/B/C 柱、边梁、横梁）
       beam()            不贴外皮的梁（纵梁、防撞梁、地板横梁）
    3. 车板 panel()       展开图上一块区域贴回外皮；边缘往里退半个缝宽、再往里折一道边，
                          两块相邻车板之间自然留出缝；可以挖洞（窗洞）、被切（轮拱）。
                          退多少在三维里迭代：量贴回去以后离缝线的真实距离，不信平面图
       measure_gaps()    建完以后沿每条缝在三维里取点实测缝宽，报最小 / 平均 / 最大
       wheelhouse()      轮罩：顺着轮拱圆弧往车里卷的黑色内衬
    4. 玻璃 glass()       窗洞区域贴回外皮外侧一点，边上一圈黑色陶瓷边（frit）
    5. 座椅 seat()        坐垫、靠背、头枕按 H 点摆
    6. 内饰 inner()       同一块区域沿法线往里收：门板、顶棚、柱子饰板和车身严丝合缝

几条踩过的坑（都已经在代码里处理，改的时候别弄回去）：
    - 贴片必须统一朝外。网页里双面材质按正面算光照，朝里的面法线是反的，玻璃会被照成一片灰白。
      panel / glass 在展开图里按逆时针三角化，贴回右半边正好朝外；左半边镜像后翻面。
    - 贴片要比外皮高出一点（lift），而且贴片本身的网格要够密：展开图里两点连成直线，
      贴回曲面后这条弦会钻到曲面下面。弦高 ≈ 边长² / (8 × 曲率半径)。
    - 中线（s = 0 或 nseg）上的边不留缝：左右两半在这里对接，不能退。
    - 封闭体（梁、坐垫）用有向体积定朝向；bmesh 的 recalc_face_normals 碰上贴着轴线的形状会猜反。
"""
import math
from bisect import bisect_right

import bmesh
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

VERSION = '1.1'


# ======================================================================== 外皮
def catmull(cp, s, nseg):
    """半截面上的 Catmull-Rom。两端补镜像点，所以底部中线、车顶中线处左右光滑对接"""
    s = min(max(s, 0.0), float(nseg))
    i = min(int(s), nseg - 1)
    t = s - i
    p1, p2 = cp[i], cp[i + 1]
    p0 = cp[i - 1] if i > 0 else (-cp[1][0], cp[1][1])
    p3 = cp[i + 2] if i + 2 <= nseg else (-cp[nseg - 1][0], cp[nseg - 1][1])
    t2, t3 = t * t, t * t * t
    return tuple(.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 +
                       (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3) for a in range(2))


class Skin:
    """外皮基准面。section(y) 返回 nseg+1 个 (x, z) 控制点，从底部中线绕到车顶中线（x ≥ 0）"""

    def __init__(self, section, nseg, y0, y1, dy=5.0, ns=16, smooth_y=0.0):
        """smooth_y：剖面沿 y 做高斯平滑的 σ（毫米）。剖面参数常用 pchip 之类的分段曲线，只有一阶连续，
        节点处曲率突变，车漆反光会在那里折一下、看着像凹坑；平滑一下就顺了。车头车尾 σ 自动收小，保证能合拢"""
        self._section, self.nseg, self.y0, self.y1 = section, nseg, float(y0), float(y1)
        self.smooth_y = float(smooth_y)
        self._sc = {}
        nrow = max(2, int(round((y1 - y0) / dy)))
        self.dy = (self.y1 - self.y0) / nrow
        self.rows = [self.y0 + i * self.dy for i in range(nrow + 1)]
        self.ns = ns
        self.ss = [k / ns for k in range(nseg * ns + 1)]
        # 每行一张弧长表：L(s)
        self.Ltab = []
        for y in self.rows:
            pts = [self.xz(y, s) for s in self.ss]
            acc = [0.0]
            for a, b in zip(pts, pts[1:]):
                acc.append(acc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
            self.Ltab.append(acc)

    # ---------------------------------------------------------------- 三维
    def sec(self, y):
        k = round(min(max(y, self.y0), self.y1), 2)
        c = self._sc.get(k)
        if c is None:
            sg = min(self.smooth_y, (k - self.y0) / 3.0, (self.y1 - k) / 3.0)
            if sg < .5:
                c = self._section(k)
            else:
                acc, wsum = None, 0.0
                for i in range(-4, 5):
                    w = math.exp(-.5 * (i / 2.0) ** 2)          # 9 个点，覆盖 ±2σ
                    cp = self._section(k + i * sg / 2.0)
                    if acc is None:
                        acc = [[0.0, 0.0] for _ in cp]
                    for a, q in zip(acc, cp):
                        a[0] += w * q[0]
                        a[1] += w * q[1]
                    wsum += w
                c = [(a[0] / wsum, a[1] / wsum) for a in acc]
            self._sc[k] = c
        return c

    def xz(self, y, s):
        return catmull(self.sec(y), s, self.nseg)

    def p(self, y, s, side=1):
        x, z = self.xz(y, s)
        return Vector((side * x, y, z))

    def n(self, y, s, side=1):
        """外法线。右半边上 ∂/∂y × ∂/∂s 正好朝外：侧面朝 +X，底面朝 -Z，车顶朝 +Z"""
        h, e = 4.0, .02
        ya, yb = max(y - h, self.y0), min(y + h, self.y1)
        sa, sb = max(s - e, 0.0), min(s + e, float(self.nseg))
        dy = self.p(yb, s) - self.p(ya, s)
        ds = self.p(y, sb) - self.p(y, sa)
        v = dy.cross(ds)
        if v.length < 1e-9:
            v = Vector((0, 1 if y > (self.y0 + self.y1) / 2 else -1, 0))
        v.normalize()
        v.x *= side
        return v

    def s_at_z(self, y, z, lo, hi):
        """侧面上高度为 z 的 s（假设 [lo, hi] 里 z 随 s 单调增）"""
        if self.xz(y, lo)[1] >= z:
            return lo
        if self.xz(y, hi)[1] <= z:
            return hi
        for _ in range(40):
            m = (lo + hi) / 2
            if self.xz(y, m)[1] < z:
                lo = m
            else:
                hi = m
        return (lo + hi) / 2

    def s_at_x(self, y, x, lo, hi):
        """底面上横坐标为 x 的 s（假设 [lo, hi] 里 x 随 s 单调增）"""
        if self.xz(y, lo)[0] >= x:
            return lo
        if self.xz(y, hi)[0] <= x:
            return hi
        for _ in range(40):
            m = (lo + hi) / 2
            if self.xz(y, m)[0] < x:
                lo = m
            else:
                hi = m
        return (lo + hi) / 2

    # ---------------------------------------------------------------- 展开图
    def _row(self, y):
        f = (min(max(y, self.y0), self.y1) - self.y0) / self.dy
        i = max(0, min(len(self.rows) - 2, int(f)))
        return i, min(max(f - i, 0.0), 1.0)

    def _L_row(self, i, s):
        f = min(max(s, 0.0), float(self.nseg)) * self.ns
        k = max(0, min(len(self.ss) - 2, int(f)))
        r = self.Ltab[i]
        return r[k] + (r[k + 1] - r[k]) * (f - k)

    def _s_row(self, i, L):
        r = self.Ltab[i]
        L = min(max(L, 0.0), r[-1])
        k = max(0, min(len(r) - 2, bisect_right(r, L) - 1))
        return (k + (L - r[k]) / max(r[k + 1] - r[k], 1e-9)) / self.ns

    def Lmax(self, y):
        i, t = self._row(y)
        return self.Ltab[i][-1] * (1 - t) + self.Ltab[i + 1][-1] * t

    def L(self, y, s):
        i, t = self._row(y)
        return self._L_row(i, s) * (1 - t) + self._L_row(i + 1, s) * t


class Chart:
    """一片车身的局部展开图。只覆盖 s ∈ [s_lo, s_hi]、y ∈ [y_lo, y_hi] 这一片：
        a = 沿车长在外皮上实际走过的距离（只按这一片里的点算平均，别的片怎么弯不影响它）
        b = 沿截面周长、从参考线 s_ref 量起的弧长"""

    def __init__(self, skin, s_lo, s_hi, s_ref, y_lo=None, y_hi=None, name=''):
        self.skin, self.s_ref, self.name = skin, s_ref, name
        y_lo = skin.y0 if y_lo is None else max(y_lo, skin.y0)
        y_hi = skin.y1 if y_hi is None else min(y_hi, skin.y1)
        self.i0 = max(0, int((y_lo - skin.y0) / skin.dy))
        self.i1 = min(len(skin.rows) - 1, int(math.ceil((y_hi - skin.y0) / skin.dy)))
        ks = [k for k, s in enumerate(skin.ss) if s_lo - 1e-9 <= s <= s_hi + 1e-9][::2]
        self.atab = [0.0]
        for i in range(self.i0, self.i1):
            y, y2 = skin.rows[i], skin.rows[i + 1]
            d = 0.0
            for k in ks:
                p, q = skin.xz(y, skin.ss[k]), skin.xz(y2, skin.ss[k])
                d += math.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (y2 - y) ** 2)
            self.atab.append(self.atab[-1] + d / len(ks))

    def a(self, y):
        sk = self.skin
        f = (min(max(y, sk.rows[self.i0]), sk.rows[self.i1]) - sk.rows[self.i0]) / sk.dy
        j = max(0, min(len(self.atab) - 2, int(f)))
        return self.atab[j] + (self.atab[j + 1] - self.atab[j]) * min(max(f - j, 0.0), 1.0)

    def y_of_a(self, a):
        r = self.atab
        a = min(max(a, r[0]), r[-1])
        j = max(0, min(len(r) - 2, bisect_right(r, a) - 1))
        return self.skin.rows[self.i0 + j] + self.skin.dy * (a - r[j]) / max(r[j + 1] - r[j], 1e-9)

    def to2(self, y, s):
        return (self.a(y), self.skin.L(y, s) - self.skin.L(y, self.s_ref))

    def from2(self, a, b):
        sk = self.skin
        y = self.y_of_a(a)
        i, t = sk._row(y)
        L = b + sk.L(y, self.s_ref)
        return y, sk._s_row(i, L) * (1 - t) + sk._s_row(i + 1, L) * t


# ======================================================================== 二维多边形
def chaikin(poly, it=2, closed=True):
    """切角平滑。closed=False 时保留两端点"""
    for _ in range(it):
        q = [poly[0]] if not closed else []
        n = len(poly)
        for i in range(n if closed else n - 1):
            a, b = poly[i], poly[(i + 1) % n]
            q.append((.75 * a[0] + .25 * b[0], .75 * a[1] + .25 * b[1]))
            q.append((.25 * a[0] + .75 * b[0], .25 * a[1] + .75 * b[1]))
        if not closed:
            q.append(poly[-1])
        poly = q
    return poly


def area2(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
               for i in range(len(poly))) / 2


def inside(pt, poly):
    x, y = pt
    c = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            c = not c
    return c


def offset2(poly, d):
    """闭合多边形整体外扩 d（负数内缩）。逐点沿角平分线挪，尖角限 3 倍"""
    if area2(poly) < 0:
        poly = poly[::-1]
    n = len(poly)
    out = []
    for i in range(n):
        a, p, b = poly[i - 1], poly[i], poly[(i + 1) % n]
        t1 = (p[0] - a[0], p[1] - a[1])
        t2 = (b[0] - p[0], b[1] - p[1])
        l1, l2 = math.hypot(*t1) or 1, math.hypot(*t2) or 1
        n1 = (t1[1] / l1, -t1[0] / l1)        # 逆时针多边形，右手边朝外
        n2 = (t2[1] / l2, -t2[0] / l2)
        m = (n1[0] + n2[0], n1[1] + n2[1])
        lm = math.hypot(*m) or 1
        m = (m[0] / lm, m[1] / lm)
        k = min(3.0, 1 / max(m[0] * n1[0] + m[1] * n1[1], 1 / 3))
        out.append((p[0] + m[0] * d * k, p[1] + m[1] * d * k))
    return out


class Region:
    """展开图上的一块区域。输入的多边形都用 (y, s)；内部转成 (u, L) 毫米坐标。
    outer 外轮廓；holes 挖掉的洞；cuts 切掉的区域（可以和外轮廓相交，比如轮拱）"""

    def __init__(self, chart, outer, holes=(), cuts=(), step=None):
        self.chart = chart
        self.skin = chart.skin
        self.outer, self.holes, self.cuts = outer, list(holes), list(cuts)
        self.step = step

    def loops2(self, step):
        """每个环在 (y, s) 里插值加密，再转成 (u, L)。
        加密的段数按三维长度算、只看这条边的两个端点：相邻两片共用的缝分到的点完全一样，缝宽才匀。
        在 (y, s) 里插值，中线上的点 s 恰好等于 nseg，左右两半能严丝合缝对上"""
        sk = self.chart
        skin = self.skin
        out = []
        for poly in [self.outer] + self.holes + self.cuts:
            pts, ys = [], []
            n = len(poly)
            for i in range(n):
                a, b = poly[i], poly[(i + 1) % n]
                q = [skin.p(a[0] + (b[0] - a[0]) * t / 8, a[1] + (b[1] - a[1]) * t / 8) for t in range(9)]
                d = sum((q[t + 1] - q[t]).length for t in range(8))
                k = max(1, int(math.ceil(d / step)))
                for j in range(k):
                    t = j / k
                    y, s = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                    pts.append(sk.to2(y, s))
                    ys.append((y, s))
            out.append((pts, ys))
        return out


def fill(region, grid=34.0):
    """把区域三角化。返回 verts2（(u, L)）、exact（顶点 -> 精确 (y, s)，没有就是 None）、tris（逆时针）"""
    loops = region.loops2(min(grid * .5, 20.0))
    nloop = len(loops)
    pts, exact, edges, edge_loop = [], [], [], []
    for li, (P, YS) in enumerate(loops):
        base = len(pts)
        for p, e in zip(P, YS):
            pts.append(Vector(p))
            exact.append(e)
        m = len(P)
        for j in range(m):
            edges.append((base + j, base + (j + 1) % m))
            edge_loop.append(li)
    # 内部格点（三角形格子），离边界太近的不要，免得出细长三角形
    outer = loops[0][0]
    us = [p[0] for p in outer]
    Ls = [p[1] for p in outer]
    cell = grid
    bucket = {}
    for P, _ in loops:
        for p in P:
            bucket.setdefault((int(p[0] // cell), int(p[1] // cell)), []).append(p)
    rmin2 = (grid * .45) ** 2
    L = min(Ls) + grid * .5
    row = 0
    while L < max(Ls):
        xs = []
        m = len(outer)
        for i in range(m):
            a, b = outer[i], outer[(i + 1) % m]
            if (a[1] > L) != (b[1] > L):
                xs.append(a[0] + (L - a[1]) * (b[0] - a[0]) / (b[1] - a[1]))
        xs.sort()
        for k in range(0, len(xs) - 1, 2):
            u = xs[k] + ((row % 2) * .5 + .25) * grid
            while u < xs[k + 1]:
                ci, cj = int(u // cell), int(L // cell)
                ok = True
                for di in (-1, 0, 1):
                    for dj in (-1, 0, 1):
                        for q in bucket.get((ci + di, cj + dj), ()):
                            if (q[0] - u) ** 2 + (q[1] - L) ** 2 < rmin2:
                                ok = False
                                break
                        if not ok:
                            break
                    if not ok:
                        break
                if ok:
                    pts.append(Vector((u, L)))
                    exact.append(None)
                u += grid
        L += grid * .866
        row += 1
    vs, oe, faces, ov, oedge, _of = delaunay_2d_cdt(pts, edges, [], 0, 1e-4)
    ex = [None] * len(vs)
    for i, srcs in enumerate(ov):
        for s in srcs:
            if s < len(exact) and exact[s] is not None:
                ex[i] = exact[s]
                break
    # 哪条输出边是哪个环的约束边
    emap = {}
    for i, (a, b) in enumerate(oe):
        ls = {edge_loop[s] for s in oedge[i] if s < len(edge_loop)}
        if ls:
            emap[(min(a, b), max(a, b))] = ls
    tris = []
    for f in faces:
        if len(f) != 3:
            continue
        a, b, c = f
        if (vs[b] - vs[a]).cross(vs[c] - vs[a]) < 0:
            b, c = c, b
        tris.append((a, b, c))
    # 按“穿过哪个环的约束边就翻转那个环的标记”做洪水填充，判断每个三角形在哪些环里面
    adj = {}
    for ti, (a, b, c) in enumerate(tris):
        for e in ((a, b), (b, c), (c, a)):
            adj.setdefault((min(e), max(e)), []).append(ti)
    mask = [None] * len(tris)
    loops_raw = [P for P, _ in loops]
    for start in range(len(tris)):
        if mask[start] is not None:
            continue
        a, b, c = tris[start]
        cen = ((vs[a][0] + vs[b][0] + vs[c][0]) / 3, (vs[a][1] + vs[b][1] + vs[c][1]) / 3)
        m0 = 0
        for li in range(nloop):
            if inside(cen, loops_raw[li]):
                m0 |= 1 << li
        mask[start] = m0
        stack = [start]
        while stack:
            ti = stack.pop()
            a, b, c = tris[ti]
            for e in ((a, b), (b, c), (c, a)):
                key = (min(e), max(e))
                flip = 0
                for li in emap.get(key, ()):
                    flip ^= 1 << li
                for tj in adj[key]:
                    if tj != ti and mask[tj] is None:
                        mask[tj] = mask[ti] ^ flip
                        stack.append(tj)
    nh = 1 + len(region.holes)
    keep = []
    for ti, t in enumerate(tris):
        m = mask[ti]
        if m & 1 and not any(m & (1 << li) for li in range(1, nloop)):
            keep.append(t)
    verts2 = [(v[0], v[1]) for v in vs]
    keep = _refine(region.chart, verts2, ex, keep, grid * 1.35)
    return verts2, ex, keep, nh


def _refine(chart, verts2, ex, tris, maxlen, passes=4):
    """展开图在曲率大、拉伸大的地方（车头车尾的圆角）一个格子在三维里会很长：
    三维边长超过 maxlen 的内部边从中点劈开，几轮下来三角形贴住曲面。边界边不动（和相邻那片对得上）"""
    skin = chart.skin
    P3 = {}

    def p3(i):
        if i not in P3:
            ys = ex[i] if ex[i] is not None else chart.from2(*verts2[i])
            P3[i] = skin.p(*ys)
        return P3[i]
    for _ in range(passes):
        cnt = {}
        for a, b, c in tris:
            for e in ((a, b), (b, c), (c, a)):
                k = (min(e), max(e))
                cnt[k] = cnt.get(k, 0) + 1
        mid = {}
        for k, c in cnt.items():
            if c == 2 and (p3(k[0]) - p3(k[1])).length > maxlen:
                a, b = verts2[k[0]], verts2[k[1]]
                verts2.append(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
                ex.append(None)
                mid[k] = len(verts2) - 1
        if not mid:
            break
        out = []
        for a, b, c in tris:
            m = [mid.get((min(e), max(e))) for e in ((a, b), (b, c), (c, a))]
            n = sum(x is not None for x in m)
            if n == 0:
                out.append((a, b, c))
                continue
            # 旋转到标准位置：v0 v1 v2，m01 m12 m20
            v, mm = [a, b, c], m
            if n == 1:
                r = mm.index(next(x for x in mm if x is not None))
            elif n == 2:
                r = (mm.index(None) + 1) % 3          # 让没劈的那条边是 m20
            else:
                r = 0
            v = v[r:] + v[:r]
            mm = mm[r:] + mm[:r]
            v0, v1, v2 = v
            m01, m12, m20 = mm
            if n == 1:
                out += [(v0, m01, v2), (m01, v1, v2)]
            elif n == 2:
                out += [(v0, m01, v2), (m01, v1, m12), (m01, m12, v2)]
            else:
                out += [(v0, m01, m20), (m01, v1, m12), (m20, m12, v2), (m01, m12, m20)]
        tris = out
    return tris


def _seg_dist(q, a, b):
    ab = b - a
    t = 0.0 if ab.length_squared < 1e-12 else min(max((q - a).dot(ab) / ab.length_squared, 0.0), 1.0)
    return (q - (a + ab * t)).length


def _boundary(tris):
    cnt = {}
    for a, b, c in tris:
        for e in ((a, b), (b, c), (c, a)):
            k = (min(e), max(e))
            cnt[k] = cnt.get(k, 0) + 1
    out = []
    for a, b, c in tris:
        for e in ((a, b), (b, c), (c, a)):
            if cnt[(min(e), max(e))] == 1:
                out.append(e)            # 方向：区域在边的左手边
    return out


# ======================================================================== 二维折线（展开图里布置窗区用）
def _d2(p, q):
    return math.hypot(q[0] - p[0], q[1] - p[1])


def _lerp2(p, q, t):
    return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)


def seg_x2(p, q, a, b):
    """线段 pq 和 ab 的交点参数 (t, u)，都在 [0, 1] 里才算相交；平行返回 None"""
    r = (q[0] - p[0], q[1] - p[1])
    s = (b[0] - a[0], b[1] - a[1])
    den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-12:
        return None
    w = (a[0] - p[0], a[1] - p[1])
    return (w[0] * s[1] - w[1] * s[0]) / den, (w[0] * r[1] - w[1] * r[0]) / den


def poly_x2(P, Q):
    """两条开口折线的第一个交点：返回 (i, t, j, u, 点)，交点在 P[i]→P[i+1] 的 t 处、Q[j]→Q[j+1] 的 u 处"""
    for i in range(len(P) - 1):
        for j in range(len(Q) - 1):
            r = seg_x2(P[i], P[i + 1], Q[j], Q[j + 1])
            if r and -1e-9 <= r[0] <= 1 + 1e-9 and -1e-9 <= r[1] <= 1 + 1e-9:
                return i, r[0], j, r[1], _lerp2(P[i], P[i + 1], r[0])
    return None


def extend2(line, d0, d1):
    """开口折线两端沿端头方向各延长 d0 / d1（好让它和别的线一定相交）"""
    a, b = line[0], line[1]
    l = _d2(a, b) or 1
    head = (a[0] + (a[0] - b[0]) / l * d0, a[1] + (a[1] - b[1]) / l * d0)
    a, b = line[-1], line[-2]
    l = _d2(a, b) or 1
    tail = (a[0] + (a[0] - b[0]) / l * d1, a[1] + (a[1] - b[1]) / l * d1)
    return [head] + list(line) + [tail]


def line_offset2(line, d):
    """开口折线整体平移 d：正数挪到前进方向的左手边。逐点沿角平分线挪"""
    n = len(line)
    out = []
    for i in range(n):
        a, p, b = line[max(i - 1, 0)], line[i], line[min(i + 1, n - 1)]
        if i == 0:
            a = p
        if i == n - 1:
            b = p
        t = (b[0] - a[0], b[1] - a[1])
        l = math.hypot(*t) or 1
        nrm = (-t[1] / l, t[0] / l)
        k = 1.0
        if 0 < i < n - 1:                                  # 拐角处按角平分线放大，保证两边都离 d
            t1 = (p[0] - a[0], p[1] - a[1])
            l1 = math.hypot(*t1) or 1
            c = (nrm[0] * -t1[1] / l1 + nrm[1] * t1[0] / l1)
            k = min(3.0, 1 / max(c, 1 / 3))
        out.append((p[0] + nrm[0] * d * k, p[1] + nrm[1] * d * k))
    return out


def cut2(line, i0, t0, i1, t1):
    """折线上从 (i0, t0) 到 (i1, t1) 那一段（含两端的插值点）"""
    a = _lerp2(line[i0], line[i0 + 1], t0)
    b = _lerp2(line[i1], line[i1 + 1], t1)
    return [a] + list(line[i0 + 1:i1 + 1]) + [b]


def split_a2(line, a):
    """折线和竖线 x = a 的第一个交点：返回 (i, t, 点)"""
    for i in range(len(line) - 1):
        p, q = line[i], line[i + 1]
        if (p[0] - a) * (q[0] - a) <= 0 and p[0] != q[0]:
            t = (a - p[0]) / (q[0] - p[0])
            return i, t, (a, p[1] + (q[1] - p[1]) * t)
    return None


def offset_edges2(poly, dist):
    """闭合多边形每条边各自往里收 dist[i]（边 i = poly[i]→poly[i+1]）。
    新顶点 = 相邻两条平移后的边所在直线的交点；两条边几乎共线时退回角平分线。顶点数、顺序不变"""
    rev = area2(poly) < 0
    if rev:                                                # 统一成逆时针：左手边是里面
        poly = poly[::-1]
        dist = list(dist[::-1])
        dist = dist[1:] + dist[:1]
    n = len(poly)
    lines = []
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        l = _d2(p, q) or 1
        nrm = (-(q[1] - p[1]) / l, (q[0] - p[0]) / l)      # 逆时针多边形，左手边朝里
        d = dist[i]
        lines.append(((p[0] + nrm[0] * d, p[1] + nrm[1] * d), (q[0] + nrm[0] * d, q[1] + nrm[1] * d), nrm, d))
    out = []
    for i in range(n):
        a0, a1, na, da = lines[i - 1]
        b0, b1, nb, db = lines[i]
        r = seg_x2(a0, a1, b0, b1)
        cross = na[0] * nb[1] - na[1] * nb[0]
        if r is None or abs(cross) < .05:
            m = ((na[0] * da + nb[0] * db) / 2, (na[1] * da + nb[1] * db) / 2)
            out.append((poly[i][0] + m[0], poly[i][1] + m[1]))
        else:
            out.append(_lerp2(a0, a1, r[0]))
    return out[::-1] if rev else out                       # 顶点顺序和输入一致


def clip_half2(poly, a, b):
    """闭合多边形只留有向直线 a→b 左手边的部分（Sutherland–Hodgman，切一刀）"""
    def side(p):
        return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        sp, sq = side(p), side(q)
        if sp >= 0:
            out.append(p)
        if (sp >= 0) != (sq >= 0):
            out.append(_lerp2(p, q, sp / (sp - sq)))
    return out


def round_corners2(poly, radius, min_turn=18.0, closed=True, n=8):
    """把折线 / 多边形上的尖角倒圆。radius 是数或者函数 f(顶点) -> 半径（0 = 不倒）。
    尖角 = 前后两条边夹的转角大于 min_turn 度；顺着曲线一点点拐的（已经是圆角的）不动。
    切点离角点 r·tan(θ/2)，最多到相邻尖角距离的 45%。圆角用二次贝塞尔（控制点 = 原角点）"""
    m = len(poly)
    if m < 3:
        return list(poly)
    acc = [0.0]
    for i in range(m - 1 + (1 if closed else 0)):
        acc.append(acc[-1] + _d2(poly[i], poly[(i + 1) % m]))
    per = acc[-1]

    def at(sv):
        if closed:
            sv %= per
        sv = min(max(sv, 0.0), per)
        k = max(0, min(len(acc) - 2, bisect_right(acc, sv) - 1))
        seg = acc[k + 1] - acc[k]
        return _lerp2(poly[k], poly[(k + 1) % m], (sv - acc[k]) / seg if seg > 1e-12 else 0.0)
    corners = []
    for i in range(m) if closed else range(1, m - 1):
        a, p, b = poly[i - 1], poly[i], poly[(i + 1) % m]
        u = (p[0] - a[0], p[1] - a[1])
        v = (b[0] - p[0], b[1] - p[1])
        lu, lv = math.hypot(*u), math.hypot(*v)
        if lu < 1e-9 or lv < 1e-9:
            continue
        c = max(-1.0, min(1.0, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)))
        th = math.degrees(math.acos(c))
        r = radius(p) if callable(radius) else radius
        if th > min_turn and r > 0:
            corners.append([i, r * math.tan(math.radians(th) / 2)])
    if not corners:
        return list(poly)
    for k, cr in enumerate(corners):                       # 不许和相邻尖角的圆角重叠
        i = cr[0]
        prv = corners[k - 1][0] if (closed or k > 0) else None
        nxt = corners[(k + 1) % len(corners)][0] if (closed or k < len(corners) - 1) else None
        lims = []
        for j in (prv, nxt):
            if j is None or j == i:
                lims.append(per if closed else acc[-1])
                continue
            dd = abs(acc[j] - acc[i])
            if closed:
                dd = min(dd, per - dd)
            lims.append(dd)
        if not closed:
            lims += [acc[i], acc[-1] - acc[i]]
        cr[1] = min(cr[1], .45 * min(lims))
    out = []
    ci = 0
    skip_until = -1.0
    # 从 0 号点开始走一圈：圆角区间里的原顶点丢掉，换成贝塞尔点
    spans = [(acc[i] - t, acc[i] + t, i) for i, t in corners]
    pre = []
    if closed:                                             # 跨过起点的圆角：起点附近的原顶点也要丢
        for s0, s1, i in spans:
            if s0 < 0:
                pre.append((s0 + per, per))
            if s1 > per:
                pre.append((0.0, s1 - per))

    def dropped(sv):
        for s0, s1, _ in spans:
            if s0 < sv < s1:
                return True
        for s0, s1 in pre:
            if s0 < sv < s1:
                return True
        return False
    for i in range(m):
        while ci < len(spans) and spans[ci][2] == i:
            s0, s1, _ = spans[ci]
            p0, p2, p1 = at(s0), at(s1), poly[i]
            for k in range(n + 1):
                t = k / n
                out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                            (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
            ci += 1
            break
        else:
            if not dropped(acc[i]):
                out.append(poly[i])
    return out


# ======================================================================== 侧窗区布置
def greenhouse(chart, belt, ws_edge, rail, c_line, b_y, div_y=None, a_width=70.0, rail_width=36.0, sash=22.0,
               belt_strip=14.0, bpillar=48.0, divbar=24.0, sail=170.0, r_top=60.0, r_win=(45.0, 10.0),
               r_div=14.0, step=40.0):
    """有框车门的侧窗区（三厢 / 两厢 / SUV 通用）。在侧围展开图里用偏移和求交画线，再转回 (y, s)：
        车门上缘 = 侧围外板（车身色 A 柱、车顶边梁、C 柱）和车门窗框的分缝：
                   A 柱段 = 前挡侧边往车门那边平移 a_width；车顶段 = 车顶分缝 rail 往下 rail_width；
                   C 柱段 = c_line 两点连成的直线（腰线上那点 → 车顶那点）。A/车顶、车顶/C 两个角倒 r_top
        窗洞 = 车门窗框区域往里收：上、前、后各 sash（黑色窗框饰条），下沿 belt_strip（腰线上的密封条），
               B 柱两边各 bpillar；后门在 div_y 处有分隔条（宽 divbar），后面是固定小三角窗；
               前窗前下角让出 sail 长的后视镜底座三角
    输入：ws_edge 前挡侧边 (y, s) 从下往上（a_width 可以给 (下, 上) 两个数，A 柱从下往上变宽 / 变窄）；rail 车顶分缝的 s（常数）；c_line [(y, belt), (y, s)]；b_y 两门分缝的 y。
    返回 dict，全部是 (y, s)：door_top（从前往后的开口折线）、sash_f、sash_r（两扇门窗框外轮廓，闭合）、
        win_f、win_r、win_q（窗洞，闭合；没有 div_y 时 win_q 为 None）"""
    C = chart

    def to2(p):
        return C.to2(*p)

    def back(poly):
        return [C.from2(*q) for q in poly]
    ys_all = [C.skin.rows[i] for i in range(C.i0, C.i1 + 1)]
    y_lo, y_hi = ys_all[0], ys_all[-1]

    def line_s(s_of_y, off, y1, y0):                       # 从前往后（a 递减）
        y1, y0 = min(y1, y_hi), max(y0, y_lo)
        ys = []
        y = y1
        while y > y0:
            ys.append(y)
            y -= step
        ys.append(y0)
        return [(C.a(y), C.to2(y, s_of_y(y))[1] + off) for y in ys]
    # 车顶段只在前挡上角和 C 柱之间取：再往前 rail 那条线已经落到前盖 / 翼子板上了，会和 A 柱线乱交
    y_front = max(p[0] for p in ws_edge)
    belt2 = line_s(lambda y: belt, 0.0, y_front + 600, c_line[0][0] - 300)
    top2 = line_s(lambda y: rail, -rail_width, ws_edge[-1][0] + 300, c_line[1][0] - 300)
    ws2 = [to2(p) for p in ws_edge]
    aw = a_width if isinstance(a_width, (tuple, list)) else (a_width, a_width)
    acc = [0.0]
    for p, q in zip(ws2, ws2[1:]):
        acc.append(acc[-1] + _d2(p, q))

    def off_line(sgn):                                     # A 柱宽度从下往上线性过渡（下宽 aw[0]、上宽 aw[1]）
        out = []
        for k in range(len(ws2)):
            w = aw[0] + (aw[1] - aw[0]) * acc[k] / (acc[-1] or 1)
            out.append(line_offset2(ws2, sgn * w)[k])
        return out
    aseam = off_line(1)
    if sum(q[1] for q in aseam) > sum(q[1] for q in ws2):  # 要往车门那边（下方）挪
        aseam = off_line(-1)
    aseam = extend2(aseam, 600, 600)
    c2 = extend2([to2(c_line[0]), to2(c_line[1])], 300, 600)
    x0 = poly_x2(aseam, belt2)
    x1 = poly_x2(aseam, top2)
    x2 = poly_x2(top2, c2)
    if not (x0 and x1 and x2):
        raise ValueError('greenhouse: 车门上缘的三段线没交上，检查 ws_edge / c_line')
    pc0 = to2(c_line[0])
    a_part = cut2(aseam, x0[0], x0[1], x1[0], x1[1])
    t_part = cut2(top2, x1[2], x1[3], x2[0], x2[1])
    c_part = [x2[4], pc0]
    if t_part[0][0] < t_part[-1][0]:                       # 车顶段要从前往后（a 递减）
        raise ValueError('greenhouse: 车顶段方向不对')
    door = a_part[:-1] + t_part[:-1] + c_part
    door = round_corners2(door, r_top, min_turn=12.0, closed=False)
    ab = C.a(b_y)
    sb = split_a2(door, ab)
    front = door[:sb[0] + 1] + [sb[2]]
    rear = [sb[2]] + door[sb[0] + 1:]
    bb = (ab, C.to2(b_y, belt)[1])
    sash_f = front + [bb]
    sash_r = [bb] + rear
    res = dict(door_top=back(door), sash_f=back(sash_f), sash_r=back(sash_r))

    mid_b = .5 * (max(q[1] for q in door))
    # 前窗：前门窗框区域往里收。边顺序：A 柱、车顶……（都收 sash）、B 柱边（倒数第二条）、腰线边（最后一条）
    wf = offset_edges2(sash_f, [sash] * (len(sash_f) - 2) + [bpillar, belt_strip])
    # 前挡斜得厉害时 A 柱在侧面很平，窗洞前下角是一个很长的尖楔。在尖楔变得太细的地方竖着切一刀，
    # 切下来的三角留给窗框饰条（后视镜底座）。wf[0] 就是尖楔的尖
    sa = (wf[0][0] - sail, wf[0][1])
    wf = clip_half2(wf, sa, (sa[0] + 40, sa[1] + 200))

    def rfun(rr):
        return lambda p: rr[0] if p[1] > mid_b else rr[1]
    wf = round_corners2(wf, rfun(r_win))
    res['win_f'] = back(wf)
    if div_y is None:
        wr = offset_edges2(sash_r, [bpillar] + [sash] * (len(sash_r) - 2) + [belt_strip])
        res['win_r'] = back(round_corners2(wr, rfun(r_win)))
        res['win_q'] = None
        return res
    ad = C.a(div_y)
    sd = split_a2(rear, ad)
    bd = (ad, C.to2(div_y, belt)[1])
    r_part = [bb] + rear[:sd[0] + 1] + [sd[2], bd]
    q_part = [bd, sd[2]] + rear[sd[0] + 1:]
    wr = offset_edges2(r_part, [bpillar] + [sash] * (len(r_part) - 3) + [divbar / 2, belt_strip])
    wq = offset_edges2(q_part, [divbar / 2] + [sash] * (len(q_part) - 2) + [belt_strip])
    res['win_r'] = back(round_corners2(wr, lambda p: (r_win[0] if p[0] > ad + 50 else r_div) if p[1] > mid_b else r_win[1]))
    res['win_q'] = back(round_corners2(wq, lambda p: r_div if p[1] > mid_b else r_win[1]))
    return res


# ======================================================================== 内饰：沿车门走的凸条、沿车宽拉伸的型材
def door_ridge(bm, skin, y0, y1, z_top, z_bot, d0, d1, mi=0, step=40.0, mirror=True, s_lo=3.0, s_hi=7.3, taper=60.0):
    """沿车门内侧走的一根横条（扶手、腰线上的窗台盖板）：在高度 z_bot ~ z_top 之间，
    离外皮（水平方向）d0 ~ d1 毫米（z_top / z_bot 可以给函数 z(y)，比如跟着腰线走）。跟着外皮的弯度走，所以和 inner() 做的门板贴得上。两头在 taper 毫米里收进门板"""
    n = max(2, int(abs(y1 - y0) / step))
    for side in ((1, -1) if mirror else (1,)):
        rings = []
        for i in range(n + 1):
            y = y0 + (y1 - y0) * i / n
            e = min(1.0, (min(abs(y - y0), abs(y - y1)) + 1.0) / max(taper, 1.0))
            e = .12 + .88 * (e * e * (3 - 2 * e))
            ring = []
            zt = z_top(y) if callable(z_top) else z_top
            zb = z_bot(y) if callable(z_bot) else z_bot
            for z, d in ((zt, d0), (zt, d0 + (d1 - d0) * e), (zb, d0 + (d1 - d0) * e), (zb, d0)):
                s = skin.s_at_z(y, z, s_lo, s_hi)
                q = skin.p(y, s, side)
                nn = skin.n(y, s, side)
                nh = Vector((nn.x, nn.y, 0.0))
                if nh.length < 1e-6:
                    nh = Vector((side, 0, 0))
                nh.normalize()
                ring.append(q - nh * d)
            rings.append(ring)
        loft(bm, rings, mi, smooth=False)


def xloft(bm, prof, xs, mi=0, scale=None, smooth=True):
    """沿车宽 X 拉伸一个 (y, z) 闭合截面（仪表台、后隔板）。scale(x) 给每个站位的缩放（绕截面中心），两头封口"""
    cy = sum(q[0] for q in prof) / len(prof)
    cz = sum(q[1] for q in prof) / len(prof)
    rings = []
    for x in xs:
        k = scale(x) if scale else 1.0
        rings.append([Vector((x, cy + (y - cy) * k, cz + (z - cz) * k)) for y, z in prof])
    return loft(bm, rings, mi, smooth=smooth)


# ======================================================================== 正视投影：灯、格栅、车牌
def half_width(skin, y, z, ns=4):
    """截面在高度 z 处最外侧的 x；这个高度上没有截面（比车顶高、比底板低）返回 None"""
    x = None
    a = skin.xz(y, 0.0)
    for k in range(1, skin.nseg * ns + 1):
        b = skin.xz(y, k / ns)
        if (a[1] - z) * (b[1] - z) <= 0 and a[1] != b[1]:
            xi = a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1])
            x = xi if x is None else max(x, xi)
        a = b
    return x


def face_y(skin, x, z, end, depth=900.0, tol=.4):
    """正对着车头（end = skin.y1）或车尾（end = skin.y0）看过去，视线 (x, z) 碰到外皮那一点的 y。
    车头车尾的截面是一圈套一圈往里收的，所以“这一圈包不包得住 (x, z)”沿 y 单调，二分就行。碰不到返回 None"""
    sgn = 1.0 if end > (skin.y0 + skin.y1) / 2 else -1.0
    lo, hi = end - sgn * depth, end

    def inside(y):
        w = half_width(skin, round(y, 1), z)
        return w is not None and abs(x) <= w
    if not inside(lo):
        return None
    if inside(hi):
        return hi
    while abs(hi - lo) > tol:
        m = (lo + hi) / 2
        if inside(m):
            lo = m
        else:
            hi = m
    return (lo + hi) / 2


def face_patch(bm, skin, outline, end, mi=0, off=2.0, grid=30.0, mirror=True, depth=900.0):
    """在正视图 (x, z) 里画一个闭合多边形（毫米，x ≥ 0 的右半边；跨中线的件把一条边放在 x = 0 上），
    沿车长方向投到车头 / 车尾的外皮上，再沿外法线抬高 off。大灯、尾灯、格栅、车牌这类
    “从正面看是什么形状”的件用它：在 (y, s) 展开图里画的话，车头车尾那一段截面挤在一起，形状不好控制"""
    sgn = 1.0 if end > (skin.y0 + skin.y1) / 2 else -1.0
    P = []
    n = len(outline)
    for i in range(n):
        a, b = outline[i], outline[(i + 1) % n]
        k = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / grid))
        for j in range(k):
            P.append((a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k))
    pts = [Vector(q) for q in P]
    edges = [(i, (i + 1) % len(pts)) for i in range(len(pts))]
    x0, x1 = min(q[0] for q in P), max(q[0] for q in P)
    z0, z1 = min(q[1] for q in P), max(q[1] for q in P)
    u = x0 + grid / 2
    while u < x1:
        v = z0 + grid / 2
        while v < z1:
            if inside((u, v), P) and min(_seg_dist(Vector((u, v)), pts[i], pts[(i + 1) % len(P)]) for i in range(len(P))) > grid * .35:
                pts.append(Vector((u, v)))
            v += grid
        u += grid
    vs, _e, faces, _a, _b, _c = delaunay_2d_cdt(pts, edges, [], 0, 1e-5)
    keep = [f for f in faces if len(f) == 3 and inside((sum(vs[i].x for i in f) / 3, sum(vs[i].y for i in f) / 3), P)]
    P3 = {}
    h = 5.0

    def p3(i):
        if i not in P3:
            x, z = max(vs[i].x, 0.0), vs[i].y
            y = face_y(skin, x, z, end, depth)
            if y is None:
                P3[i] = None
            else:
                ya, yb = face_y(skin, x + h, z, end, depth), face_y(skin, max(x - h, 0.0), z, end, depth)
                yc, yd = face_y(skin, x, z + h, end, depth), face_y(skin, x, z - h, end, depth)
                fx = ((ya if ya is not None else y) - (yb if yb is not None else y)) / (h + min(x, h))
                fz = ((yc if yc is not None else y) - (yd if yd is not None else y)) / (2 * h)
                nrm = Vector((-fx * sgn, 1.0, -fz * sgn)) * sgn
                if x < 1e-6:
                    nrm.x = 0.0
                nrm.normalize()
                P3[i] = (Vector((x, y, z)) + nrm * off, nrm)
        return P3[i]
    for side in ((1, -1) if mirror else (1,)):
        V = {}
        for f in keep:
            q = [p3(i) for i in f]
            if any(t is None for t in q):
                continue
            fv = []
            for i, t in zip(f, q):
                if i not in V:
                    V[i] = bm.verts.new((side * t[0].x, t[0].y, t[0].z))
                fv.append(V[i])
            try:
                nf = bm.faces.new(fv)
            except ValueError:
                continue
            nf.material_index = mi
            nf.smooth = True
            nf.normal_update()
            nn = sum((t[1] for t in q), Vector()) / 3
            if nf.normal.dot(Vector((side * nn.x, nn.y, nn.z))) < 0:
                nf.normal_flip()


# ======================================================================== 车板 / 玻璃 / 内饰
class Part:
    """一次 panel / glass / inner 的结果：faces 是生成的面，edges 是外露边（三维，毫米），量缝用"""

    def __init__(self, name=''):
        self.name, self.faces, self.edges = name, [], []


def _emit(bm, chart, verts2, ex, tris, lift, mi, mirror, gap=0.0, flange=0.0, roll=2.0, inward=False,
          smooth=True, part=None, hem=0.0):
    """把三角化结果贴回三维。gap>0 时边界往里退，再沿法线往里折 flange 毫米。
    hem>0：板边做成半径 hem 的圆角包边（真车外板边缘往里折 180° 包住内板，专利 US6528176）。
    缝宽 gap 按两边圆角最外点之间算，所以板面边缘要多退 hem"""
    skin = chart.skin
    nseg = skin.nseg
    tol = 1e-3
    part = part or Part()

    def ys_of(i):
        return ex[i] if ex[i] is not None else chart.from2(*verts2[i])

    def on_seam(i):
        """中线（左右对接处）和车头车尾端点上的边不留缝"""
        y, s = ys_of(i)
        return s < tol or s > nseg - tol or y < skin.y0 + 1 or y > skin.y1 - 1

    bnd = _boundary(tris)
    pos2 = list(verts2)
    seam_v = set(i for e in bnd for i in e if on_seam(i))
    disp = {}

    def where(i, p2):
        """展开图上挪过的点 → (y, s)。中线上的点只沿车长方向挪，s 钉在中线上"""
        if p2 == verts2[i]:
            return ys_of(i)
        y, s = chart.from2(*p2)
        if i in seam_v:
            s = ys_of(i)[1]
        return y, s

    nbr = {}
    for a, b in bnd:
        nbr.setdefault(a, []).append(b)
        nbr.setdefault(b, []).append(a)
    if gap > 0:
        acc = {}
        for a, b in bnd:
            if on_seam(a) and on_seam(b):
                continue
            du, dL = verts2[b][0] - verts2[a][0], verts2[b][1] - verts2[a][1]
            ln = math.hypot(du, dL) or 1
            nin = (-dL / ln, du / ln)          # 区域在边的左手边，往左就是往板里退
            for v in (a, b):
                acc.setdefault(v, []).append(nin)
        for v, ns in acc.items():
            m = (sum(q[0] for q in ns), sum(q[1] for q in ns))
            lm = math.hypot(*m) or 1
            m = (m[0] / lm, m[1] / lm)
            k = min(2.0, 1 / max(min(m[0] * q[0] + m[1] * q[1] for q in ns), .5))
            disp[v] = (m[0] * k, m[1] * k)
            # 先按平面图退 gap/2，再在三维里量“离原缝线的垂直距离”，按比例修正，迭代三次。
            # 不量到原顶点的直线距离：展开图有剪切时，退的方向会斜着偏向缝的走向
            want = gap / 2 + (hem if flange > 0 else 0.0)
            p0 = skin.p(*ys_of(v))
            segs = [(p0, skin.p(*ys_of(w))) for w in nbr.get(v, ()) if not (on_seam(v) and on_seam(w))]
            d2 = want * k
            for _ in range(4):
                p2 = (verts2[v][0] + m[0] * d2, verts2[v][1] + m[1] * d2)
                q = skin.p(*where(v, p2))
                got = min((_seg_dist(q, c, d) for c, d in segs), default=(q - p0).length)
                if got < 1e-6:
                    break
                d2 *= want / got
            pos2[v] = (verts2[v][0] + m[0] * d2, verts2[v][1] + m[1] * d2)
            disp[v] = (m[0] * d2 / want, m[1] * d2 / want)     # 展开图上“往板里 1 毫米”
    edge_set = set()
    for a, b in bnd:
        if not (on_seam(a) and on_seam(b)):
            edge_set.add((a, b))
    cn = bm.verts.layers.float_vector.get('cn') or bm.verts.layers.float_vector.new('cn')
    for side in ((1, -1) if mirror else (1,)):
        V = {}

        def vert(i):
            if i not in V:
                y, s = where(i, pos2[i])
                nn = skin.n(y, s, side)
                v = bm.verts.new(skin.p(y, s, side) + nn * lift)
                v[cn] = -nn if inward else nn          # 曲面的解析法线，导出成自定义法线，三角形再乱也光顺
                V[i] = v
            return V[i]
        for a, b, c in tris:
            vv = [vert(a), vert(b), vert(c)]
            if (side < 0) != inward:
                vv.reverse()
            try:
                f = bm.faces.new(vv)
            except ValueError:
                continue
            f.material_index = mi
            f.smooth = smooth
            part.faces.append(f)
        use_hem = gap > 0 and flange > 0 and hem > 0
        if not use_hem:
            for a, b in edge_set:
                part.edges.append((vert(a).co.copy(), vert(b).co.copy()))
        if gap > 0 and flange > 0:
            R = {}

            def ring(i, k):
                """板边第 k 圈点。k=0 板面边缘；hem>0 时 k=1、2 是圆角（45°、90°，90° 那圈是最外点）；
                最后一圈是折边底。圆角那几圈带自定义法线，和板面连成一体"""
                key = (i, k)
                if key in R:
                    return R[key]
                d = disp.get(i, (0, 0))
                y0, s0 = where(i, pos2[i])
                n0 = skin.n(y0, s0, side)
                if k == 0:
                    v = bm.verts.new(vert(i).co)
                    v[cn] = n0
                elif use_hem and k in (1, 2):
                    th = math.radians(45 if k == 1 else 90)
                    out = hem * math.sin(th)                     # 往缝里伸
                    dep = hem * (1 - math.cos(th))               # 往下卷
                    p2 = (pos2[i][0] - d[0] * out, pos2[i][1] - d[1] * out)
                    y, s = where(i, p2)
                    nn = skin.n(y, s, side)
                    q = skin.p(y, s, side) + nn * (lift - dep)
                    v = bm.verts.new(q)
                    o = (q - vert(i).co)
                    o = o - nn * o.dot(nn)
                    o = o.normalized() if o.length > 1e-6 else nn
                    v[cn] = (nn * math.cos(th) + o * math.sin(th)).normalized()
                else:
                    back = -hem + roll if use_hem else roll   # 折边底：从最外点往板里收 roll，留一点拔模
                    p2 = (pos2[i][0] + d[0] * back, pos2[i][1] + d[1] * back)
                    y, s = where(i, p2)
                    nn = skin.n(y, s, side)
                    v = bm.verts.new(skin.p(y, s, side) + nn * (lift - flange))
                R[key] = v
                return v
            ks = [0, 1, 2, 3] if use_hem else [0, 3]
            for a, b in edge_set:
                if a not in disp or b not in disp:
                    continue
                if use_hem:
                    part.edges.append((ring(a, 2).co.copy(), ring(b, 2).co.copy()))
                for k0, k1 in zip(ks, ks[1:]):
                    quad = [ring(a, k0), ring(a, k1), ring(b, k1), ring(b, k0)]
                    if side < 0:
                        quad.reverse()
                    try:
                        f = bm.faces.new(quad)
                    except ValueError:
                        continue
                    f.material_index = mi
                    f.smooth = k1 <= 2 and use_hem               # 圆角光滑，直的折边是硬边
                    part.faces.append(f)
    if mirror:
        cen = [v for v in bm.verts if abs(v.co.x) < .02]
        bmesh.ops.remove_doubles(bm, verts=cen, dist=.05)
        part.faces = [f for f in part.faces if f.is_valid]
    return part


def panel(bm, chart, outer, holes=(), cuts=(), gap=4.0, flange=14.0, lift=0.0, mi=0, mirror=True, grid=34.0, name='',
          hem=1.5):
    """一块车板：区域贴回外皮，四周留缝、圆角包边、往里折边。返回 Part（edges 给 measure_gaps 用）。
    gap 是这块板自己让出的缝（两块板之间的缝 = 两边 gap 各一半之和），hem 是包边圆角半径"""
    v2, ex, tris, _ = fill(Region(chart, outer, holes, cuts), grid)
    return _emit(bm, chart, v2, ex, tris, lift, mi, mirror, gap=gap, flange=flange, part=Part(name), hem=hem)


def _inset_poly(chart, outer, d):
    """展开图里把 (y, s) 多边形往里收 d 毫米；中线上的点 s 钉在中线上"""
    nseg = chart.skin.nseg
    o2 = [chart.to2(*p) for p in outer]
    inner2 = offset2(o2, -d)
    if area2(o2) < 0:
        inner2 = offset2(o2, d)
    out = []
    for p, q in zip(outer, inner2):
        y, s = chart.from2(*q)
        if p[1] > nseg - 1e-3 or p[1] < 1e-3:
            s = p[1]
        out.append((y, s))
    return out


def glass(bm, chart, outer, lift=-1.0, frit=18.0, mi=0, mi_frit=1, mirror=True, grid=40.0, name=''):
    """一块玻璃：外表面在外皮下 1 毫米（维修手册：玻璃面比周围钣金低 1 mm），
    内侧一圈 frit 宽的黑色陶瓷釉边，挡住下面的胶条、也挡紫外线。中线上不画釉边（左右两半是一整块玻璃）"""
    v2, ex, tris, _ = fill(Region(chart, outer), grid)
    part = _emit(bm, chart, v2, ex, tris, lift, mi, mirror, part=Part(name))
    if frit > 0:
        hole = _inset_poly(chart, outer, frit)
        v2, ex, tris, _ = fill(Region(chart, outer, [hole]), min(grid, frit))
        _emit(bm, chart, v2, ex, tris, lift - .8, mi_frit, mirror, part=part)
    return part


def glass_bond(bm, chart, outer, lift=-1.0, thick=4.8, inset=11.0, bead=(14.0, 14.0), flange=(26.0, 1.6), mi_bead=0,
               mi_flange=1, mirror=True, step=25.0):
    """玻璃下面的粘接：一圈聚氨酯胶条（维修手册要求至少 14×14 mm）压在车身开口的点焊翻边上。
    胶条中心离玻璃边 inset 毫米（在釉边下面，从外面看不见）。翻边比胶条宽，钣金色。
    多边形碰到中线时只扫一半（开口链），镜像那一半在中线上接上"""
    skin = chart.skin
    nseg = skin.nseg
    path = _inset_poly(chart, outer, inset)
    on_c = [p[1] > nseg - 1e-3 or p[1] < 1e-3 for p in outer]
    closed = not any(on_c)
    if not closed:                                    # 从中线后面那个点开始，到中线前面那个点结束
        n = len(path)
        k = next(i for i in range(n) if on_c[i] and on_c[(i + 1) % n])
        path = [path[(k + 1 + j) % n] for j in range(n)]
    dense = []
    m = len(path)
    for i in range(m if closed else m - 1):
        a, b = path[i], path[(i + 1) % m]
        d = (skin.p(*b) - skin.p(*a)).length
        k = max(1, int(math.ceil(d / step)))
        for j in range(k):
            t = j / k
            dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    if not closed:
        dense.append(path[-1])
    bw, bh = bead
    fw, ft = flange
    for side in ((1, -1) if mirror else (1,)):
        P, U = [], []
        for y, s in dense:
            P.append(skin.p(y, s, side))
            U.append(skin.n(y, s, side))
        sweep(bm, [p + u * (lift - thick - bh / 2) for p, u in zip(P, U)], U, bw, bh, r=4.0, mi=mi_bead, cap=False,
              closed=closed)
        sweep(bm, [p + u * (lift - thick - bh - ft / 2) for p, u in zip(P, U)], U, fw, ft, r=.6, mi=mi_flange,
              cap=not closed, closed=closed)


def inner(bm, chart, outer, holes=(), cuts=(), depth=60.0, mi=0, mirror=True, grid=40.0, name=''):
    """内饰板：同一块区域沿法线往车里收 depth 毫米，面朝车里"""
    v2, ex, tris, _ = fill(Region(chart, outer, holes, cuts), grid)
    return _emit(bm, chart, v2, ex, tris, -depth, mi, mirror, inward=True, part=Part(name))


def measure_gaps(parts, near=8.0):
    """在三维里实测缝宽：拿每块板外露边上的点（每条边取中点），找另一块板最近的外露边，算点到线段的距离。
    只统计 near 毫米以内的（更远的说明这一段两块板不挨着，比如三块板交汇的角）。
    返回 {(甲, 乙): (样本数, 最小, 平均, 最大, 5% 分位, 95% 分位)}"""
    from mathutils.kdtree import KDTree
    from mathutils.geometry import intersect_point_line

    trees = []
    for p in parts:
        mids = [(a + b) / 2 for a, b in p.edges]
        t = KDTree(len(mids))
        for i, m in enumerate(mids):
            t.insert(m, i)
        t.balance()
        trees.append(t)
    out = {}
    for ia, pa in enumerate(parts):
        for ib, pb in enumerate(parts):
            if ib <= ia or not pa.edges or not pb.edges:
                continue
            ds = []
            for a, b in pa.edges:
                q = (a + b) / 2
                best = 1e9
                for _co, j, _d in trees[ib].find_n(q, 4):
                    c, d = pb.edges[j]
                    h, t = intersect_point_line(q, c, d)
                    t = min(max(t, 0.0), 1.0)
                    best = min(best, (q - (c + (d - c) * t)).length)
                if best < near:
                    ds.append(best)
            if len(ds) >= 5:
                ds.sort()
                out[(pa.name, pb.name)] = (len(ds), ds[0], sum(ds) / len(ds), ds[-1], ds[len(ds) // 20],
                                           ds[min(len(ds) - 1, len(ds) * 19 // 20)])
    return out


def strip(line, w_s):
    """沿 (y, s) 折线左右各展宽 w_s（单位 s）的带状多边形，给饰条、柱子用"""
    a = [(y, s + w_s) for y, s in line]
    b = [(y, s - w_s) for y, s in line[::-1]]
    return a + b


def poke_check(skin, verts, margin=3.0, ds=.02):
    """检查一堆三维点（车框、内饰）有没有顶出外皮：每个点找同一 y 剖面上最近的外皮点，
    沿外法线量有多远。返回 [(点, 伸出量毫米)]，伸出量 > -margin 的才列出来（margin 留给车板厚度和折边）。
    只看 y 在外皮范围内、离车头车尾 30 毫米以上的点"""
    cache = {}
    out = []
    for v in verts:
        y = v.y
        if y < skin.y0 + 30 or y > skin.y1 - 30:
            continue
        key = round(y / 5.0) * 5.0
        tab = cache.get(key)
        if tab is None:
            n = int(skin.nseg / ds)
            tab = cache[key] = [(k * ds, skin.xz(key, k * ds)) for k in range(n + 1)]
        ax = abs(v.x)
        best = min(tab, key=lambda t: (t[1][0] - ax) ** 2 + (t[1][1] - v.z) ** 2)
        s_ = best[0]
        side = 1 if v.x >= 0 else -1
        p = skin.p(key, s_, side)
        nn = skin.n(key, s_, side)
        d = (Vector((v.x, key, v.z)) - p).dot(nn)
        if d > -margin:
            out.append((v.copy(), d))
    return out


# ======================================================================== 车框
def _rrect(w, h, r, seg=2):
    r = min(r, w / 2 - .1, h / 2 - .1)
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180),
                       (w / 2 - r, -h / 2 + r, 270)):
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def _hat(w, h, flange=14.0, t=1.8):
    """车框件的截面：外板冲成“几”字形（帽形），内板是浅一些的反向帽形，两张板在两边的翻边上点焊，
    中间围成空腔。up 方向（第二个坐标）朝车外。截面总深 h、腔宽 w，翻边各宽 flange"""
    top = h * .7                                  # 外板帽深
    bot = max(h - top - t, 2.0)                   # 内板帽深
    d, d2 = min(w * .12, top * .35), min(w * .1, bot * .8)   # 帽壁拔模
    P = [(-w / 2 - flange, 0), (-w / 2, 0), (-w / 2 + d, top), (w / 2 - d, top), (w / 2, 0), (w / 2 + flange, 0),
         (w / 2 + flange, -t), (w / 2, -t), (w / 2 - d2, -t - bot), (-w / 2 + d2, -t - bot), (-w / 2, -t),
         (-w / 2 - flange, -t)]
    c = (top - t - bot) / 2                       # 让截面在 h 方向居中
    return [(x, y - c) for x, y in P]


def orient_closed(bm, faces):
    """封闭体按有向体积定朝向，体积为负就整体翻面"""
    faces = [f for f in faces if f.is_valid]
    if not faces:
        return
    for f in faces:
        f.normal_update()
    o = sum((f.calc_center_median() for f in faces), Vector()) / len(faces)
    vol = sum((f.calc_center_median() - o).dot(f.normal) * f.calc_area() for f in faces)
    if vol < 0:
        bmesh.ops.reverse_faces(bm, faces=faces)


def _lerp_list(v, n):
    """v 是一个数、(起, 止)、或者正好 n 个数的列表：返回 n 个值"""
    if isinstance(v, (int, float)):
        return [float(v)] * n
    if len(v) == n:
        return [float(x) for x in v]
    a, b = v
    return [a + (b - a) * i / max(n - 1, 1) for i in range(n)]


def _per_point(v, idx):
    """member 用：v 是一个数、(起, 止)，或者每个控制点一个值的列表；idx[k] = (控制段号, 段内比例)"""
    if isinstance(v, (int, float)):
        return [float(v)] * len(idx)
    nseg = idx[-1][0] + 1
    if len(v) == nseg + 1:                       # 每个控制点一个值
        return [v[i] + (v[min(i + 1, nseg)] - v[i]) * t for i, t in idx]
    a, b = v                                     # (起, 止)：按长度比例线性过渡
    return [a + (b - a) * (i + t) / nseg for i, t in idx]


def sweep(bm, pts, ups, w, h, r=6.0, mi=0, cap=True, shape='rect', flange=14.0, closed=False):
    """沿三维折线扫一根梁。ups[i] 是第 i 点的“上”方向（截面的 h 方向）。
    w、h 可以是 (起, 止)，沿长度变截面。shape='rect' 圆角方管（铝挤出件、防撞梁），
    'hat' 帽形截面带焊接翻边（冲压钣金件：柱子、边梁、门槛、纵梁、横梁）"""
    n = len(pts)
    W, H = _lerp_list(w, n), _lerp_list(h, n)
    rings = []
    m = None
    for i in range(n):
        prof = _rrect(W[i], H[i], r) if shape == 'rect' else _hat(W[i], H[i], flange)
        if closed:
            t = pts[(i + 1) % n] - pts[(i - 1) % n]
        else:
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        if t.length < 1e-6:
            t = Vector((0, 1, 0))
        t.normalize()
        up = ups[i] - t * ups[i].dot(t)
        if up.length < 1e-6:
            up = Vector((0, 0, 1)) if abs(t.z) < .9 else Vector((1, 0, 0))
        up.normalize()
        bx = t.cross(up)
        rings.append([bm.verts.new(pts[i] + bx * px + up * py) for px, py in prof])
        m = len(prof)
    fs = []
    for i in range(n if closed else n - 1):
        i2 = (i + 1) % n
        for j in range(m):
            f = bm.faces.new((rings[i][j], rings[i][(j + 1) % m], rings[i2][(j + 1) % m], rings[i2][j]))
            f.material_index = mi
            f.smooth = shape == 'rect'
            fs.append(f)
    if cap and not closed:
        for ring in (rings[0], rings[-1]):
            f = bm.faces.new(ring)
            f.material_index = mi
            fs.append(f)
    orient_closed(bm, fs)
    return fs


def member(bm, skin, line, w, h, inset=14.0, r=8.0, mi=0, mirror=True, step=40.0, shape='hat', flange=14.0, smooth=4,
           clear=3.0):
    """车框件：沿 (y, s) 折线，在外皮里面 inset 毫米处扫一根截面 w×h 的梁（默认帽形截面带翻边）。
    h 方向和外皮法线一致。w、h 可以是一个数、(起, 止)，或者每个控制点一个值的列表（变截面）。
    一圈连着的件（门槛 → A 柱 → 边梁 → C 柱）尽量写成一根：真车的侧围外板就是一整张冲出来的，
    分几根扫的话接头处截面对不上，会冒出楔形的尖。
    inset 要比车板折边（默认 14）深，不然从缝里能看见车框。
    smooth：折线拐角处把点和法线做几轮 1-2-1 平均，拐角变成圆弧（不然截面在拐角处互相穿插，冒出折痕）。
    clear：截面四个角离外皮至少这么多毫米，顶出来的地方自动往里推（None 不查）"""
    ys, idx = [], []
    for i in range(len(line) - 1):
        a, b = line[i], line[i + 1]
        d = (skin.p(*b) - skin.p(*a)).length
        k = max(1, int(d / step))
        for j in range(k):
            t = j / k
            ys.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            idx.append((i, t))
    ys.append(line[-1])
    idx.append((len(line) - 2, 1.0))
    W, H = _per_point(w, idx), _per_point(h, idx)
    out = []
    for side in ((1, -1) if mirror else (1,)):
        pts, ups = [], []
        for (y, s), hh in zip(ys, H):
            nn = skin.n(y, s, side)
            pts.append(skin.p(y, s, side) - nn * (inset + hh / 2))
            ups.append(nn)
        for _ in range(smooth):
            pts = [pts[0]] + [(pts[i - 1] + pts[i] * 2 + pts[i + 1]) / 4 for i in range(1, len(pts) - 1)] + [pts[-1]]
            ups = [ups[0]] + [(ups[i - 1] + ups[i] * 2 + ups[i + 1]).normalized() for i in range(1, len(ups) - 1)] + [ups[-1]]
        if clear is not None:
            pts = _clearance(skin, pts, ups, W, H, shape, flange, clear)
        out += sweep(bm, pts, ups, W, H, r, mi, shape=shape, flange=flange)
    return out


def _clearance(skin, pts, ups, W, H, shape, flange, clear, it=3):
    """外皮凹进去的地方（肩线下面、后翼子板上沿），截面的翻边会从侧面顶出外皮。
    逐个截面查四个角，顶出来就整圈沿法线往里推，推完再顺一顺，免得一节一节的"""
    n = len(pts)
    pts = list(pts)
    for _ in range(it):
        push = [0.0] * n
        for i in range(n):
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            if t.length < 1e-6:
                continue
            t.normalize()
            up = (ups[i] - t * ups[i].dot(t)).normalized()
            bx = t.cross(up)
            prof = _hat(W[i], H[i], flange) if shape == 'hat' else _rrect(W[i], H[i], 1.0)
            xs = [q[0] for q in prof]
            ys_ = [q[1] for q in prof]
            corners = [(min(xs), max(ys_)), (max(xs), max(ys_)), (min(xs), 0), (max(xs), 0)]
            hits = poke_check(skin, [pts[i] + bx * a + up * b for a, b in corners], margin=clear)
            if hits:
                push[i] = max(d for _, d in hits) + clear
        if not any(push):
            break
        for _ in range(3):
            push = [max(push[i], (push[max(i - 1, 0)] + push[min(i + 1, n - 1)]) / 2) for i in range(n)]
        pts = [p - u * d for p, u, d in zip(pts, ups, push)]
    return pts


def beam(bm, pts, w, h, up=(0, 0, 1), r=6.0, mi=0, mirror=False, shape='rect', flange=14.0):
    """不贴外皮的梁：三维折线 + 固定“上”方向。mirror=True 时再做一根 x 取反的"""
    out = []
    for side in ((1, -1) if mirror else (1,)):
        P = [Vector((side * p[0], p[1], p[2])) for p in pts]
        U = [Vector((side * up[0], up[1], up[2]))] * len(P)
        out += sweep(bm, P, U, w, h, r, mi, shape=shape, flange=flange)
    return out


# ======================================================================== 轮拱
def arch_cut(skin, yc, zc, r, xmin, smax=7.0, n=48):
    """轮拱切口：以 (yc, zc) 为圆心、r 为半径的圆，只切外侧 x > xmin 的部分。返回 (y, s) 多边形"""
    up, lo = [], []
    for i in range(n + 1):
        y = yc - r + 2 * r * i / n
        dz = math.sqrt(max(r * r - (y - yc) ** 2, 0.0))
        s_hi = skin.s_at_z(y, zc + dz, 1.0, smax)
        s_x = skin.s_at_x(y, xmin, 0.0, 3.0)
        s_lo = max(s_x, skin.s_at_z(y, zc - dz, s_x, smax))
        up.append((y, s_hi))
        lo.append((y, min(s_lo, s_hi)))
    return up + lo[::-1]


def wheelhouse(bm, skin, yc, zc, r, x_in, mi=0, clear=8.0, smax=7.0, n=40, mirror=True, zfloor=None):
    """轮罩内衬：顺着轮拱圆弧，从车身外皮一直卷到 x = x_in，再封一块内侧挡板"""
    R = r + clear
    zf = zfloor if zfloor is not None else zc - R * .45
    a0 = math.asin(max(-1.0, min(1.0, (zf - zc) / R)))
    angs = [a0 + (math.pi - 2 * a0) * k / n for k in range(n + 1)]   # 从前下方绕过顶到后下方
    out = []
    for side in ((1, -1) if mirror else (1,)):
        rows = []
        for a in angs:
            y, z = yc + R * math.cos(a), zc + R * math.sin(a)
            s = skin.s_at_z(y, z, 1.0, smax)
            xo = max(skin.xz(y, s)[0] + 4, x_in + 10)
            rows.append([bm.verts.new((side * (x_in + (xo - x_in) * k / 5), y, z)) for k in range(6)])
        for i in range(n):
            for k in range(5):
                q = [rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]]
                f = bm.faces.new(q if side > 0 else q[::-1])
                f.material_index = mi
                out.append(f)
        c = bm.verts.new((side * x_in, yc, zc))
        for i in range(n):
            q = [c, rows[i + 1][0], rows[i][0]]
            f = bm.faces.new(q if side > 0 else q[::-1])
            f.material_index = mi
            out.append(f)
        f = bm.faces.new([c, rows[0][0], rows[-1][0]] if side > 0 else [c, rows[-1][0], rows[0][0]])
        f.material_index = mi
    # 法线朝轮子：外层朝圆心，内侧挡板朝车外
    for f in out:
        f.normal_update()
        cen = f.calc_center_median()
        if abs(cen.x) - x_in > 1:
            to_axis = Vector((0, yc - cen.y, zc - cen.z))
            if f.normal.dot(to_axis) < 0:
                f.normal_flip()
        elif f.normal.x * (1 if cen.x > 0 else -1) < 0:
            f.normal_flip()
    return out


def arch_check(verts, yc, zc, r, x_in, clear=8.0, zfloor=None):
    """轮罩里不该有车身件：x 在内衬挡板外侧、离轮心（y-z 平面）不到 r + clear 的点都会捅穿黑色内衬，
    从轮拱里看就是一块灰色骨架。返回 [(点, 伸进去多少毫米)]"""
    R = r + clear
    zf = zfloor if zfloor is not None else zc - R * .45
    bad = []
    for v in verts:
        if abs(v.x) <= x_in + .5 or v.z < zf:
            continue
        d = math.hypot(v.y - yc, v.z - zc)
        if d < R:
            bad.append((v.copy(), R - d))
    return bad


# ======================================================================== 座椅
def loft(bm, rings, mi=0, cap=True, smooth=True):
    """把一串同样点数的闭合环连起来，两头封口"""
    V = [[bm.verts.new(p) for p in ring] for ring in rings]
    m = len(rings[0])
    fs = []
    for i in range(len(V) - 1):
        for j in range(m):
            f = bm.faces.new((V[i][j], V[i][(j + 1) % m], V[i + 1][(j + 1) % m], V[i + 1][j]))
            f.material_index = mi
            f.smooth = smooth
            fs.append(f)
    if cap:
        for ring in (V[0], V[-1]):
            f = bm.faces.new(ring)
            f.material_index = mi
            f.smooth = smooth
            fs.append(f)
    orient_closed(bm, fs)
    return fs


def _cushion_profile(w, h, bolster, bw):
    """坐垫 / 靠背截面：中间平、两边鼓起的侧翼。返回闭合 (横向, 厚度) 环"""
    hw = w / 2
    p = [(-hw, 0), (hw, 0), (hw, h + bolster * .6), (hw - bw * .35, h + bolster), (hw - bw, h + bolster * .55),
         (hw - bw - 18, h), (-hw + bw + 18, h), (-hw + bw, h + bolster * .55), (-hw + bw * .35, h + bolster),
         (-hw, h + bolster * .6)]
    return chaikin(p, 2)


def disc(bm, c, axis, r, t, mi=0, seg=20):
    """圆盘（调角器、转轴）：中心 c，轴向 axis，半径 r，厚 t"""
    a = Vector(axis).normalized()
    u = a.orthogonal().normalized()
    v = a.cross(u)
    rings = []
    for k in (-.5, .5):
        o = Vector(c) + a * (t * k)
        rings.append([o + (u * math.cos(2 * math.pi * j / seg) + v * math.sin(2 * math.pi * j / seg)) * r for j in range(seg)])
    return loft(bm, rings, mi, smooth=False)


def tube(bm, pts, d, up=(0, 0, 1), mi=0, cap=True):
    """圆管（座椅骨架、头枕杆）：沿三维折线，外径 d"""
    P = [Vector(p) for p in pts]
    U = [Vector(up)] * len(P)
    return sweep(bm, P, U, d, d, d / 2 - .3, mi, cap=cap)


def _paint_insert(fs, hx, half, axis, mi):
    """坐垫 / 靠背正面中间那一块换一种面料（打孔皮 / 织物拼色）：法线朝 axis、横向在 ±half 以内的面"""
    for f in fs:
        if not f.is_valid:
            continue
        f.normal_update()
        if f.normal.dot(axis) > .55 and all(abs(v.co.x - hx) < half for v in f.verts):
            f.material_index = mi


def _seat_pads(pad, hp, w, cushion_len, back_h, back_angle, cushion_angle, bolster, mi, headrests, hr_mi, mi_insert=None):
    """泡沫 + 面套：坐垫、靠背、头枕（只是外形，里面的骨架另外做）。返回靠背坐标系 (base, up, fwd)"""
    hx, hy, hz = hp
    prof = _cushion_profile(w, 95, bolster * .7, min(105, w * .2))
    rings = []
    ca = math.radians(cushion_angle)
    n = 9
    for k in range(n + 1):
        t = k / n
        sc = .82 + .18 * math.sin(math.pi * min(t * 1.2, 1.0)) if t < .5 else .9 + .1 * math.cos(math.pi * (t - .5))
        dy = -120 + (cushion_len + 60) * t
        z0 = hz - 125 + dy * math.tan(ca)
        rings.append([Vector((hx + x * (sc if w < 700 else (1 - (1 - sc) * .3)), hy + dy, z0 + z * (.75 + .25 * sc)))
                      for x, z in prof])
    fs = loft(pad, rings, mi)
    if mi_insert is not None:
        _paint_insert(fs, hx, w / 2 - min(105, w * .2) - 6, Vector((0, 0, 1)), mi_insert)
    prof = _cushion_profile(w * .96, 90, bolster, min(110, w * .2))
    ba = math.radians(back_angle)
    up = Vector((0, -math.sin(ba), math.cos(ba)))
    fwd = Vector((0, math.cos(ba), math.sin(ba)))
    base = Vector((hx, hy - 150, hz - 75))
    rings = []
    for k in range(11):
        t = k / 10
        sc = .9 + .1 * math.sin(math.pi * t) if t < .85 else .95 - (t - .85) * 1.4
        if w >= 700:
            sc = 1 - (1 - sc) * .3
        o = base + up * (back_h * t)
        rings.append([o + Vector((x * sc, 0, 0)) + fwd * z for x, z in prof])
    fs = loft(pad, rings, mi)
    if mi_insert is not None:
        _paint_insert(fs, hx, w * .48 - min(110, w * .2) - 6, fwd, mi_insert)
    top = base + up * (back_h + 125)
    for hx_ in headrests:
        hr = []
        for k in range(6):
            t = k / 5
            sc = math.sin(math.pi * (.15 + .7 * t))
            o = top + up * (-70 + 150 * t) + Vector((hx_ - hx, 0, 0))
            hr.append([o + Vector((x * sc, 0, 0)) + fwd * (z * sc)
                       for x, z in chaikin([(-125, 20), (125, 20), (125, 105), (-125, 105)], 2)])
        loft(pad, hr, hr_mi)
    return base, up, fwd, top


def front_seat(pad, frame, rail, hp, floor_z, w=520, cushion_len=500, back_h=640, back_angle=24, cushion_angle=12,
               bolster=55, mi_pad=0, mi_hr=1, mi_frame=0, mi_rail=0, mi_insert=None):
    """一把前排座椅，按专利 US5439271 / US4509796 的层次从地板往上搭：
    地板支脚 → 固定滑轨（下轨）→ 滑动滑轨（上轨）→ 坐垫骨架（两块 U 形冲压侧板 + 前后横管 + 中间钣金座盆）
    → 坐垫泡沫和面套；靠背骨架（倒 U 形圆管 + 下横梁）靠两侧调角器和坐垫骨架铰接，顶上两根头枕杆插头枕。
    hp 是 H 点（胯点），floor_z 是地板上表面。pad / frame / rail 是三个 bmesh（材质分开）"""
    hx, hy, hz = hp
    base, up, fwd, top = _seat_pads(pad, hp, w, cushion_len, back_h, back_angle, cushion_angle, bolster, mi_pad, [hx],
                                    mi_hr, mi_insert)
    ca = math.tan(math.radians(cushion_angle))
    # 滑轨：支脚 → 下轨 → 上轨
    zr = floor_z + 22
    for sx in (-1, 1):
        x = hx + sx * (w / 2 - 75)
        for y in (hy - 300, hy + 230):
            rail.verts.ensure_lookup_table()
            sweep(rail, [Vector((x, y - 18, floor_z + 11)), Vector((x, y + 18, floor_z + 11))], [Vector((0, 0, 1))] * 2,
                  46, 22, 3, mi_rail)
        sweep(rail, [Vector((x, hy - 320, zr + 9)), Vector((x, hy + 250, zr + 9))], [Vector((0, 0, 1))] * 2, 42, 18, 3,
              mi_rail, shape='hat', flange=6)
        sweep(rail, [Vector((x, hy - 270, zr + 27)), Vector((x, hy + 180, zr + 27))], [Vector((0, 0, 1))] * 2, 30, 18, 3,
              mi_rail)
    # 坐垫骨架：两块侧板（从上轨立起来，前高后低）
    zt = zr + 36                                       # 上轨顶面
    for sx in (-1, 1):
        x = hx + sx * (w / 2 - 75)
        P = [Vector((x, hy - 200, zt + 45)), Vector((x, hy + 60, zt + 45 + 260 * ca)), Vector((x, hy + 270, zt + 60 + 470 * ca))]
        sweep(frame, P, [Vector((sx, 0, 0))] * 3, (90, 70), 24, 3, mi_frame, shape='hat', flange=8)
    zf, zb = zt + 70 + 470 * ca, zt + 60                 # 前横管、后横管高度
    tube(frame, [(hx - w / 2 + 62, hy + 255, zf), (hx + w / 2 - 62, hy + 255, zf)], 28, mi=mi_frame)
    tube(frame, [(hx - w / 2 + 62, hy - 185, zb), (hx + w / 2 - 62, hy - 185, zb)], 28, mi=mi_frame)
    # 座盆：中间一张冲压钣金，前沿下翻
    pan = []
    for y, z in ((hy - 170, zb + 18), (hy + 200, zf + 4), (hy + 245, zf - 20)):
        pan.append(Vector((hx, y, z)))
    sweep(frame, pan, [Vector((0, 0, 1))] * 3, w - 175, 4, 1.5, mi_frame)
    # 调角器 + 靠背骨架
    piv = Vector((0, hy - 150, hz - 70))
    for sx in (-1, 1):
        disc(frame, Vector((hx + sx * (w / 2 - 50), piv.y, piv.z)), (1, 0, 0), 42, 22, mi_frame)
    bw = w / 2 - 62
    b0 = base + up * 15
    loop = [b0 + Vector((-bw, 0, 0)), b0 + up * (back_h - 90) + Vector((-bw, 0, 0)),
            b0 + up * (back_h - 25) + Vector((-bw + 60, 0, 0)), b0 + up * (back_h - 25) + Vector((bw - 60, 0, 0)),
            b0 + up * (back_h - 90) + Vector((bw, 0, 0)), b0 + Vector((bw, 0, 0))]
    sweep(frame, loop, [fwd] * len(loop), 26, 26, 12, mi_frame)
    sweep(frame, [b0 + Vector((-bw, 0, 0)) + up * 60, b0 + Vector((bw, 0, 0)) + up * 60], [fwd] * 2, 70, 14, 3, mi_frame,
          shape='hat', flange=6)
    # 头枕杆：从靠背骨架顶上插进头枕
    for sx in (-55, 55):
        a = b0 + up * (back_h - 40) + Vector((sx, 0, 0)) + fwd * 30
        b = top + up * -40 + Vector((sx, 0, 0)) + fwd * 30
        tube(frame, [a, b], 13, up=tuple(fwd), mi=mi_frame)


def bench(pad, frame, hp, floor_z, w=1360, cushion_len=480, back_h=600, back_angle=26, cushion_angle=13, seats=3,
          mi_pad=0, mi_hr=1, mi_frame=0, mi_insert=None):
    """后排长座椅：没有滑轨。坐垫骨架是一圈钢丝框 + 座盆，前沿两个挂钩挂在地板上，后面压在座盆支架上；
    靠背骨架是一圈管子 + 中间一根竖管，上沿挂在后排背板上。seats 个头枕"""
    hx, hy, hz = hp
    hrs = [hx + (k - (seats - 1) / 2) * (w / seats) for k in range(seats)]
    base, up, fwd, top = _seat_pads(pad, hp, w, cushion_len, back_h, back_angle, cushion_angle, 30, mi_pad, hrs, mi_hr, mi_insert)
    ca = math.tan(math.radians(cushion_angle))
    zb = hz - 150
    # 座盆支架（地板上冲起来的台）+ 钢丝框
    sweep(frame, [Vector((hx, hy - 160, (floor_z + zb) / 2)), Vector((hx, hy + 140, (floor_z + zb) / 2))],
          [Vector((0, 0, 1))] * 2, w - 120, zb - floor_z, 20, mi_frame)
    hw = w / 2 - 50
    y0, y1 = hy - 120, hy + cushion_len - 120
    loop = [(hx - hw, y0, zb + 10), (hx - hw, y1, zb + 10 + (y1 - y0) * ca), (hx + hw, y1, zb + 10 + (y1 - y0) * ca),
            (hx + hw, y0, zb + 10), (hx - hw, y0, zb + 10)]
    tube(frame, loop, 10, mi=mi_frame)
    for sx in (-1, 1):                                  # 前沿挂钩
        tube(frame, [(hx + sx * hw * .6, y1 - 20, zb + (y1 - y0) * ca), (hx + sx * hw * .6, y1 + 10, floor_z + 30),
                     (hx + sx * hw * .6, y1 - 30, floor_z + 8)], 10, mi=mi_frame)
    b0 = base + up * 20
    bw = w / 2 - 70
    loop = [b0 + Vector((-bw, 0, 0)), b0 + up * (back_h - 40) + Vector((-bw, 0, 0)),
            b0 + up * (back_h - 40) + Vector((bw, 0, 0)), b0 + Vector((bw, 0, 0)), b0 + Vector((-bw, 0, 0))]
    sweep(frame, loop, [fwd] * len(loop), 22, 22, 10, mi_frame)
    xs = b0.x + w * (.6 - .5)                           # 60/40 分开的竖管
    tube(frame, [Vector((xs, b0.y, b0.z)), b0 + up * (back_h - 40) + Vector((xs - b0.x, 0, 0))], 22, up=tuple(fwd),
         mi=mi_frame)
    for x in hrs:
        for sx in (-55, 55):
            a = b0 + up * (back_h - 40) + Vector((x - hx + sx, 0, 0)) + fwd * 25
            b = top + up * -40 + Vector((x - hx + sx, 0, 0)) + fwd * 25
            tube(frame, [a, b], 12, up=tuple(fwd), mi=mi_frame)
