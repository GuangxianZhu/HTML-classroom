"""主楼结构：筏板、地下室、核心筒、钢管混凝土柱、钢梁、楼承板、楼板、幕墙、加强层、屋顶。

每层每类构件是一个物体，extras 里写 stage（构件类别）和 floor（楼层号），网页按施工进度显隐。
楼层号约定见 params.json。
"""
import math

import numpy as np

from sitekit import Acc, empty, rot2

STAGES = ["raft", "bwall", "bslab", "core", "column", "steel", "deck", "slab", "curtain", "outrigger", "roof"]


class Tower:
    def __init__(self, P):
        self.P = P
        T = P["tower"]
        self.T = T
        self.N = T["floors"]
        z = {1: 0.0}
        for n in range(2, self.N + 2):
            z[n] = T["f1_height"] + (n - 2) * T["typ_height"]
        acc = 0.0
        for i, h in enumerate(T["basement"]["heights"]):
            acc -= h
            z[-(i + 1)] = acc
        z[0] = 0.0
        self.z = z
        self.a = T["core"]["half"]
        self.c = T["core"]["inner_line"]
        self.F = T["frame"]["half"]
        self.objs = []

    # ---------------------------------------------------- 查表
    def zone(self, n):
        for zz in self.T["core"]["zones"]:
            if zz["from"] <= n <= zz["to"]:
                return zz
        return self.T["core"]["zones"][-1]

    def col_d(self, n):
        for zz in self.T["frame"]["col_d"]:
            if zz["from"] <= n <= zz["to"]:
                return zz["d"]
        return self.T["frame"]["col_d"][-1]["d"]

    def span(self, n):
        """level n 的竖向范围。地下 level -1 从 z[-1] 到 0。"""
        if n < 0:
            return self.z[n], self.z[n + 1] if n + 1 < 0 else 0.0
        return self.z[n], self.z[n + 1]

    def columns(self):
        F, k = self.F, self.T["frame"]["bays"]
        pts = []
        step = 2 * F / k
        for i in range(k + 1):
            x = -F + i * step
            pts += [(x, -F), (x, F)]
        for i in range(1, k):
            y = -F + i * step
            pts += [(-F, y), (F, y)]
        return pts

    def _add(self, acc, name, stage, floor, parent, **extra):
        ob = acc.build(name, parent=parent, props=dict(stage=stage, floor=floor, **extra))
        if ob is not None:
            self.objs.append(ob)
        return ob

    # ---------------------------------------------------- 核心筒
    def core_level(self, acc, n, z0, z1):
        a, c = self.a, self.c
        zz = self.zone(n)
        to, ti = zz["outer_t"], zz["inner_t"]
        dw, dh = self.T["core"]["door_outer"]
        iw, ih = self.T["core"]["door_inner"]
        h = z1 - z0
        if n == 1:
            dh = 3.2
        dh = min(dh, h - 0.8)
        ih = min(ih, h - 0.8)
        # 外墙：北/南墙通长，东/西墙夹在中间
        for k in range(4):
            if k % 2 == 0:   # 北(0) 南(2)
                doors = [(-8.0, dw, dh), (0.0, dw, dh), (8.0, dw, dh)]
                self._wall(acc, k, a - to, a, -a, a, z0, z1, doors, "concrete")
            else:            # 东西墙
                doors = [(-8.0, dw, dh), (8.0, dw, dh)]
                self._wall(acc, k, a - to, a, -(a - to), a - to, z0, z1, doors, "concrete")
        # 内墙：y=±c 两道通长（x 向），x=±c 两道（y 向）
        L = a - to
        for k, side in ((0, 1), (2, 1)):
            # k=0 → y=+c；k=2 → 旋转 180°，即 y=-c
            doors = [(-8.0, iw, ih), (2.2, iw, ih), (8.0, iw, ih)]
            self._wall(acc, k, c - ti / 2, c + ti / 2, -L, L, z0, z1, doors, "concrete")
        for k in (1, 3):
            doors = [(-8.0, iw, ih), (-2.2, iw, ih), (8.0, iw, ih)]
            self._wall(acc, k, c - ti / 2, c + ti / 2, -L, L, z0, z1, doors, "concrete")

    def _wall(self, acc, k, d0, d1, r0, r1, z0, z1, doors, m):
        """北墙为基准（沿 x 跑，厚度在 y 的 d0..d1），再绕 z 转 k×90°。doors=(中心, 宽, 高)。"""
        pieces = []
        cur = r0
        for (cx, w, hh) in sorted(doors):
            lo, hi = cx - w / 2, cx + w / 2
            if lo <= r0 or hi >= r1:
                continue
            pieces.append((cur, lo, z0, z1))
            pieces.append((lo, hi, z0 + hh, z1))
            cur = hi
        pieces.append((cur, r1, z0, z1))
        for x0, x1, za, zb in pieces:
            if x1 - x0 < 1e-4:
                continue
            corners = [rot2((x0, d0), k), rot2((x1, d1), k)]
            lo = (min(corners[0][0], corners[1][0]), min(corners[0][1], corners[1][1]), za)
            hi = (max(corners[0][0], corners[1][0]), max(corners[0][1], corners[1][1]), zb)
            acc.box_mm(lo, hi, m)

    def core_slab(self, acc, n, ztop, t):
        """筒内楼板：中心筒格 + 四个边筒格（四角筒格当井道/楼梯，不铺）。"""
        a, c = self.a, self.c
        zz = self.zone(n)
        to, ti = zz["outer_t"], zz["inner_t"]
        lo_c, hi_c = -c + ti / 2, c - ti / 2
        acc.box_mm((lo_c, lo_c, ztop - t), (hi_c, hi_c, ztop), "concrete")
        for k in range(4):
            p0 = rot2((lo_c, c + ti / 2), k)
            p1 = rot2((hi_c, a - to), k)
            acc.box_mm((min(p0[0], p1[0]), min(p0[1], p1[1]), ztop - t), (max(p0[0], p1[0]), max(p0[1], p1[1]), ztop), "concrete")

    # ---------------------------------------------------- 外框
    def column_level(self, acc, n, z0, z1):
        r = self.col_d(n) / 2
        for x, y in self.columns():
            acc.cyl((x, y, z0), (x, y, z1), r, "steel_tube", seg=16, caps=False)
        # 每三层一个钢柱对接节点（耳板）
        if n % 3 == 1:
            for x, y in self.columns():
                acc.cyl((x, y, z0 + 1.2), (x, y, z0 + 1.32), r + 0.05, "steel_tube", seg=16, smooth=False)

    def steel_level(self, acc, ztop):
        Fr = self.T["frame"]
        a, F = self.a, self.F
        zb = ztop - self.T["slab"]["t"]          # 钢梁顶 = 楼板底
        cols = self.columns()

        def hb(p0, p1, spec):
            H, B, tf, tw = spec
            zc = zb - H / 2
            acc.hbeam((p0[0], p0[1], zc), (p1[0], p1[1], zc), H, B, tf, tw, "steel")

        step = 2 * F / Fr["bays"]
        rr = self.col_d(1) / 2 * 0  # 梁直接打到柱中心线，柱子会盖住接头
        for k in range(4):
            # 边梁：沿北边，柱到柱
            for i in range(Fr["bays"]):
                x0, x1 = -F + i * step, -F + (i + 1) * step
                hb(rot2((x0 + rr, F), k), rot2((x1 - rr, F), k), Fr["edge_beam"])
            # 主梁：中间柱到核心筒外墙
            for i in range(1, Fr["bays"]):
                x = -F + i * step
                hb(rot2((x, F), k), rot2((x, a), k), Fr["main_beam"])
            # 角柱斜梁：角柱到核心筒角
            hb(rot2((F, F), k), rot2((a, a), k), Fr["diag_beam"])
            # 次梁：平行于外墙，两端搭到斜梁上
            for d in Fr["sec_offsets"]:
                y = a + d
                hb(rot2((-y, y), k), rot2((y, y), k), Fr["sec_beam"])

    def floor_polys(self):
        a, E = self.a, self.T["slab"]["edge"]
        out = []
        for k in range(4):
            out.append([rot2(p, k) for p in ((-a, a), (a, a), (E, E), (-E, E))])
        return out

    def deck_level(self, acc, ztop):
        t, dt = self.T["slab"]["t"], self.T["slab"]["deck_t"]
        for poly in self.floor_polys():
            acc.prism(poly, ztop - t, ztop - t + dt, "deck")

    def slab_level(self, acc, ztop):
        t, dt = self.T["slab"]["t"], self.T["slab"]["deck_t"]
        for poly in self.floor_polys():
            acc.prism(poly, ztop - t + dt, ztop, "concrete")

    # ---------------------------------------------------- 幕墙
    def curtain_level(self, acc, n, z0, z1, screen=False):
        C = self.T["curtain"]
        Cp = C["plane"]
        sb, sa = C["spandrel_below"], C["spandrel_above"]
        m = round(2 * Cp / C["module"])
        mw = 2 * Cp / m
        g0 = z0 + (sa if n > 1 else 0.0)
        g1 = z1 - sb
        refuge = n in self.T["refuge"]
        for k in range(4):
            def B(lo, hi, mm):
                p0 = rot2((lo[0], lo[1]), k)
                p1 = rot2((hi[0], hi[1]), k)
                acc.box_mm((min(p0[0], p1[0]), min(p0[1], p1[1]), lo[2]), (max(p0[0], p1[0]), max(p0[1], p1[1]), hi[2]), mm)
            if not screen:
                if n > 1:
                    B((-Cp, Cp - 0.03, z0 - sb), (Cp, Cp + 0.03, z0 + sa), "spandrel")
                if refuge:
                    zz = g0 + 0.15
                    while zz < g1 - 0.1:
                        B((-Cp, Cp - 0.02, zz), (Cp, Cp + 0.12, zz + 0.05), "louver")
                        zz += 0.22
                else:
                    B((-Cp, Cp - 0.012, g0), (Cp, Cp + 0.012, g1), "glass")
                # 横框
                for zz in (g0, g1):
                    B((-Cp, Cp - 0.05, zz - 0.04), (Cp, Cp + 0.10, zz + 0.04), "alu")
            else:
                for zz in (z0 + 0.1, z0 + (z1 - z0) / 2, z1 - 0.15):
                    B((-Cp, Cp - 0.05, zz - 0.08), (Cp, Cp + 0.10, zz + 0.08), "alu")
            # 竖框 + 外挑装饰竖翅
            for i in range(m + 1):
                x = -Cp + i * mw
                depth = 0.10 + (C["fin_depth"] if i % C["fin_every"] == 0 else 0.0)
                B((x - 0.03, Cp - 0.08, z0), (x + 0.03, Cp + depth, z1), "alu")

    # ---------------------------------------------------- 加强层（环带桁架 + 伸臂桁架）
    def outrigger_level(self, acc, z0, z1):
        F, a = self.F, self.a
        cols = sorted({x for x, _ in self.columns()})
        zb, zt = z0 + 0.35, z1 - 0.55
        for k in range(4):
            def bar(p, q, w=0.6, h=0.6):
                acc.bar(rot2(p, k), rot2(q, k), w, h, "steel")
            # 环带桁架：北边四跨，每跨交叉斜杆 + 加粗上下弦
            bar((-F, F, zb), (F, F, zb), 0.7, 0.8)
            bar((-F, F, zt), (F, F, zt), 0.7, 0.8)
            for x0, x1 in zip(cols[:-1], cols[1:]):
                bar((x0, F - 0.06, zb), (x1, F - 0.06, zt))
                bar((x0, F + 0.06, zt), (x1, F + 0.06, zb))   # 两根斜杆错开一点，交叉处不打架
            # 伸臂桁架：x=±a 两榀，从核心筒外墙到外框柱
            for xs in (-a, a):
                bar((xs, a, zb), (xs, F, zb), 0.8, 0.8)
                bar((xs, a, zt), (xs, F, zt), 0.8, 0.8)
                mid = (a + F) / 2
                bar((xs, a, zb), (xs, mid, zt), 0.8, 0.8)
                bar((xs, mid, zt), (xs, F, zb), 0.8, 0.8)
                bar((xs, mid, zb), (xs, mid, zt), 0.6, 0.6)

    # ---------------------------------------------------- 地下室
    def basement(self, root):
        B = self.T["basement"]
        cx, cy = B["center"]
        sx, sy = B["size"]
        x0, x1, y0, y1 = cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2
        wt = B["wall_t"]
        zr = self.z[-len(B["heights"])]
        # 筏板
        acc = Acc()
        acc.box_mm((x0, y0, zr - B["raft_t_outer"]), (x1, y1, zr), "concrete_dark")
        h = B["raft_tower_half"]
        acc.box_mm((-h, -h, zr - B["raft_t"]), (h, h, zr - B["raft_t_outer"]), "concrete_dark")
        self._add(acc, "Raft", "raft", -5, root)
        # 每层：外墙 + 地下室柱 + 核心筒 + 塔楼柱；顶上一块楼板
        g = B["grid"]
        gx = [x for x in np.arange(x0 + g, x1 - 0.5 * g, g)]
        gy = [y for y in np.arange(y0 + g, y1 - 0.5 * g, g)]
        tower_r = self.T["slab"]["edge"] + 1.5
        for lv in range(-len(B["heights"]), 0):
            za, zb = self.span(lv)
            acc = Acc()
            for lo, hi in (((x0, y0), (x1, y0 + wt)), ((x0, y1 - wt), (x1, y1)), ((x0, y0 + wt), (x0 + wt, y1 - wt)), ((x1 - wt, y0 + wt), (x1, y1 - wt))):
                acc.box_mm((lo[0], lo[1], za), (hi[0], hi[1], zb), "concrete_dark")
            cs = B["col"]
            for x in gx:
                for y in gy:
                    if abs(x) < tower_r and abs(y) < tower_r:
                        continue
                    acc.box_mm((x - cs / 2, y - cs / 2, za), (x + cs / 2, y + cs / 2, zb - B["slab_t"]), "concrete")
            self._add(acc, f"BWall_{lv}", "bwall", lv, root)
            acc = Acc()
            self.core_level(acc, lv, za, zb)
            self._add(acc, f"Core_{lv}", "core", lv, root)
            acc = Acc()
            self.column_level(acc, lv, za, zb)
            self._add(acc, f"Column_{lv}", "column", lv, root)
            # 顶板：整块减去核心筒，筒内另铺
            t = B["roof_t"] if lv == -1 else B["slab_t"]
            acc = Acc()
            a = self.a
            for r in ((x0, y0, x1, -a), (x0, a, x1, y1), (x0, -a, -a, a), (a, -a, x1, a)):
                acc.box_mm((r[0], r[1], zb - t), (r[2], r[3], zb), "concrete")
            self.core_slab(acc, lv, zb, t)
            self._add(acc, f"BSlab_{lv}", "bslab", lv, root)

    # ---------------------------------------------------- 总装
    def build(self):
        root = empty("TOWER", props=dict(kind="tower_root"))
        self.root = root
        self.basement(root)
        slab_t = self.T["slab"]["t"]
        for n in range(1, self.N + 1):
            z0, z1 = self.z[n], self.z[n + 1]
            acc = Acc()
            self.core_level(acc, n, z0, z1)
            self._add(acc, f"Core_{n:02d}", "core", n, root)
            acc = Acc()
            self.column_level(acc, n, z0, z1)
            self._add(acc, f"Column_{n:02d}", "column", n, root)
            acc = Acc()
            self.steel_level(acc, z1)
            self._add(acc, f"Steel_{n:02d}", "steel", n, root)
            acc = Acc(uv=True)
            self.deck_level(acc, z1)
            self._add(acc, f"Deck_{n:02d}", "deck", n, root)
            acc = Acc()
            self.slab_level(acc, z1)
            self.core_slab(acc, n, z1, slab_t)
            self._add(acc, f"Slab_{n:02d}", "slab", n, root)
            acc = Acc()
            self.curtain_level(acc, n, z0, z1)
            self._add(acc, f"Curtain_{n:02d}", "curtain", n, root, refuge=int(n in self.T["refuge"]))
            if n in self.T["outrigger"]:
                acc = Acc()
                self.outrigger_level(acc, z0, z1)
                self._add(acc, f"Outrigger_{n:02d}", "outrigger", n, root)
        # 屋顶：核心筒再出一层机房 + 幕墙延伸成屏风 + 设备
        zr = self.z[self.N + 1]
        acc = Acc()
        self.core_level(acc, self.N + 1, zr, zr + self.T["typ_height"])
        acc.box_mm((-self.a, -self.a, zr + self.T["typ_height"] - 0.3), (self.a, self.a, zr + self.T["typ_height"]), "concrete")
        self.curtain_level(acc, self.N + 1, zr, zr + self.T["roof_screen"], screen=True)
        for (x, y, sx, sy, sz) in ((-18, 0, 5, 9, 4.2), (18, 0, 5, 9, 4.2), (0, -18, 9, 5, 3.6), (0, 18, 9, 5, 3.0)):
            acc.box((x, y, zr + sz / 2), (sx, sy, sz), "white")
            acc.cyl((x, y, zr + sz), (x, y, zr + sz + 0.6), min(sx, sy) * 0.3, "dark_steel", seg=20)
        self._add(acc, "Roof", "roof", self.N + 1, root)
        return root

    def spec(self):
        return dict(
            z={str(k): round(v, 3) for k, v in sorted(self.z.items())},
            floors=self.N,
            top=round(self.z[self.N + 1] + self.T["roof_screen"], 3),
            stages=STAGES,
            columns=self.columns(),
            col_d={n: self.col_d(n) for n in range(-4, self.N + 1)},
            core_t={n: [self.zone(n)["outer_t"], self.zone(n)["inner_t"]] for n in range(-4, self.N + 2)},
        )
