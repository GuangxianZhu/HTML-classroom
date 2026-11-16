"""造楼机（核心筒顶模集成平台）。

参照中建三局公开资料里的轻量化集成平台（武汉长江中心等）：
  钢平台（200 型贝雷片）+ 12 个支点（附墙支座、油缸支架、液压油缸、格构支撑立柱）
  + 挂架 7 层（每层 2.2 m，覆盖 3.5 个结构层）+ 大钢模 + 布料机 + 附属设施 + 全封闭防护。
外形和布置是按这些参数原创的，不对应某个具体项目。

局部坐标：原点 = 核心筒中心、刚浇完的墙顶（TOC）。网页把整台平台放到 z[n+1]。
"""
import math

import numpy as np

from sitekit import Acc, empty, rot2, rect_minus


class Zaoloji:
    def __init__(self, P, tower):
        self.P = P
        self.Q = P["platform"]
        self.tw = tower
        n = self.Q["ref_floor"]
        zz = tower.zone(n)
        self.to, self.ti = zz["outer_t"], zz["inner_t"]
        self.a = tower.a
        self.c = tower.c
        Q = self.Q
        self.zb = Q["bottom"]                       # 贝雷桁架底
        self.zd = Q["bottom"] + Q["bailey_h"]       # 平台面
        self.hang = [Q["bottom"] - Q["hang_step"] * (i + 1) for i in range(Q["hang_levels"])]
        self.zbot = self.hang[-1]
        self.E = Q["edge"]
        self.objs = []

    # ---------------------------------------------------- 布置
    def cells(self):
        """九个筒格的内净范围 [(x0,x1),(y0,y1)]。"""
        a, c, to, ti = self.a, self.c, self.to, self.ti
        iv = [(-(a - to), -c - ti / 2), (-c + ti / 2, c - ti / 2), (c + ti / 2, a - to)]
        return [(ix, iy) for ix in iv for iy in iv]

    def supports(self):
        """12 个支点：(立柱中心 x, y, 墙面法向 nx, ny, 墙面点 x, y)。外墙 8 个，中心筒格 4 个。"""
        a, c, ti = self.a, self.c, self.ti
        off = self.Q["support_offset"]
        out = []
        for k in range(4):
            for s in (-c, c):
                wall = rot2((s, a), k)
                colp = rot2((s, a + off), k)
                nrm = rot2((0, 1), k)
                out.append(dict(col=colp, n=nrm, wall=wall, kind="outer"))
        f = c - ti / 2
        for k in range(4):
            wall = rot2((0, f), k)
            colp = rot2((0, f - off), k)
            nrm = rot2((0, -1), k)
            out.append(dict(col=colp, n=nrm, wall=wall, kind="inner"))
        return out

    def _add(self, acc, name, parent, origin=(0, 0, 0), **props):
        ob = acc.build(name, origin=origin, parent=parent, props=props)
        if ob is not None:
            self.objs.append(ob)
        return ob

    # ---------------------------------------------------- 钢平台：贝雷片
    def bailey_line(self, acc, axis, pos, L):
        """一条双排贝雷梁。axis='x' 表示沿 x 跑，位于 y=pos。"""
        Q = self.Q
        pl, H = Q["bailey_panel"], Q["bailey_h"]
        n = max(1, int(L // pl))
        x0 = -n * pl / 2
        g = Q["bailey_rows_gap"] / 2
        zb, zt = self.zb + 0.05, self.zb + H - 0.05

        def P(x, y, z):
            return (x, pos + y, z) if axis == "x" else (pos + y, x, z)

        for row in (-g, g):
            acc.bar(P(x0, row, zb), P(-x0, row, zb), 0.12, 0.1, "plat_red")
            acc.bar(P(x0, row, zt), P(-x0, row, zt), 0.12, 0.1, "plat_red")
            for i in range(n):
                xa = x0 + i * pl
                xm, xe = xa + pl / 2, xa + pl
                for xv in (xa, xm, xe):
                    acc.bar(P(xv, row, zb), P(xv, row, zt), 0.08, 0.08, "plat_red")
                acc.bar(P(xa, row, zb), P(xa + pl / 4, row, zt), 0.06, 0.06, "plat_red")
                acc.bar(P(xa + pl / 4, row, zt), P(xm, row, zb), 0.06, 0.06, "plat_red")
                acc.bar(P(xm, row, zb), P(xm + pl / 4, row, zt), 0.06, 0.06, "plat_red")
                acc.bar(P(xm + pl / 4, row, zt), P(xe, row, zb), 0.06, 0.06, "plat_red")
        # 两排之间的支撑架
        for i in range(n + 1):
            xa = x0 + i * pl
            acc.bar(P(xa, -g, zb), P(xa, g, zb), 0.05, 0.05, "plat_red")
            acc.bar(P(xa, -g, zt), P(xa, g, zt), 0.05, 0.05, "plat_red")
            acc.bar(P(xa, -g, zb), P(xa, g, zt), 0.04, 0.04, "plat_red")

    def platform(self, parent):
        Q = self.Q
        E = self.E
        acc = Acc()
        L = 2 * (E - 0.3)
        for p in Q["lines"]:
            self.bailey_line(acc, "x", p, L)
            self.bailey_line(acc, "y", p, L)
        self._add(acc, "ZLJ_Bailey", parent, kind="platform", part="贝雷片钢平台")

        # 外挑：最外一圈贝雷梁到边缘的悬挑梁 + 周边桁架
        acc = Acc()
        lines = Q["lines"]
        outer = max(abs(v) for v in lines)
        for k in range(4):
            for p in lines:
                for z in (self.zb + 0.15, self.zd - 0.15):
                    acc.hbeam(rot2((p, outer, z), k), rot2((p, E, z), k), 0.3, 0.15, 0.012, 0.008, "plat_red")
            for z in (self.zb + 0.1, self.zd - 0.1):
                acc.bar(rot2((-E, E, z), k), rot2((E, E, z), k), 0.16, 0.16, "plat_red")
            x = -E
            while x <= E + 1e-6:
                acc.bar(rot2((x, E, self.zb + 0.1), k), rot2((x, E, self.zd - 0.1), k), 0.12, 0.12, "plat_red")
                x += 3.0
        self._add(acc, "ZLJ_Edge", parent, kind="platform", part="周边悬挑桁架")

        # 平台面：花纹钢板，四个角筒格上开吊装口
        acc = Acc()
        holes = []
        for (x0, x1), (y0, y1) in self.cells():
            if abs((x0 + x1) / 2) > 1 and abs((y0 + y1) / 2) > 1:
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                holes.append((cx - 1.6, cy - 1.6, cx + 1.6, cy + 1.6))
        self.hatches = holes
        for r in rect_minus((-E, -E, E, E), holes):
            acc.box_mm((r[0], r[1], self.zd), (r[2], r[3], self.zd + 0.04), "grating")
        self._add(acc, "ZLJ_Deck", parent, kind="platform", part="平台走道板")

        # 吊装口栏杆
        acc = Acc()
        for x0, y0, x1, y1 in holes:
            for z in (0.6, 1.2):
                for p, q in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
                    acc.bar((p[0], p[1], self.zd + z), (q[0], q[1], self.zd + z), 0.05, 0.05, "yellow")
            for p in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
                acc.bar((p[0], p[1], self.zd), (p[0], p[1], self.zd + 1.2), 0.06, 0.06, "yellow")
            for p, q in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
                acc.bar((p[0], p[1], self.zd + 0.13), (q[0], q[1], self.zd + 0.13), 0.02, 0.18, "yellow")
        self._add(acc, "ZLJ_HatchRails", parent, kind="platform", part="吊装口防护")

    # ---------------------------------------------------- 挂架
    def _ring_rects(self, lo, hi, d0, d1):
        """一圈环形走道（四条矩形），lo/hi 是墙面坐标，d0..d1 是离墙距离（向外为正）。"""
        out = []
        X0, X1 = lo - d1, hi + d1
        out.append((X0, hi + d0, X1, hi + d1))
        out.append((X0, lo - d1, X1, lo - d0))
        out.append((X0, lo - d0, lo - d0, hi + d0))
        out.append((hi + d0, lo - d0, X1, hi + d0))
        return out

    def hanging(self, parent):
        Q = self.Q
        a, E = self.a, self.E
        wi, wo = Q["walk_in"], Q["walk_out"]
        top = self.zb
        bot = self.zbot - 0.15

        hangers = Acc()
        walks = Acc()
        guard = Acc()
        # 外圈：核心筒外侧
        rects = [(r, "outer") for r in self._ring_rects(-a, a, wi, wo)]
        # 九个筒格内圈（向筒格中心为“离墙”方向，所以用负的距离）
        cw = Q["cell_walk"]
        for (x0, x1), (y0, y1) in self.cells():
            d0, d1 = wi, wi + cw
            rr = [(x0 + d0, y1 - d1, x1 - d0, y1 - d0), (x0 + d0, y0 + d0, x1 - d0, y0 + d1),
                  (x0 + d0, y0 + d1, x0 + d1, y1 - d1), (x1 - d1, y0 + d1, x1 - d0, y1 - d1)]
            rects += [(r, "cell") for r in rr]
        for z in self.hang:
            for (x0, y0, x1, y1), kind in rects:
                walks.box_mm((x0, y0, z - 0.05), (x1, y1, z), "grating")
        # 外圈吊杆、踢脚板、栏杆（外侧）
        for k in range(4):
            x = -(a + wo)
            while x <= a + wo + 1e-6:
                for d in (wi + 0.05, wo - 0.05):
                    hangers.bar(rot2((x, a + d, bot), k), rot2((x, a + d, top), k), 0.1, 0.1, "dark_steel")
                x += 2.25
            for z in self.hang:
                p0, p1 = rot2((-(a + wo), a + wo - 0.03), k), rot2((a + wo, a + wo), k)
                guard.box_mm((min(p0[0], p1[0]), min(p0[1], p1[1]), z), (max(p0[0], p1[0]), max(p0[1], p1[1]), z + 0.18), "yellow")
                for h in (0.6, 1.2):
                    guard.bar(rot2((-(a + wo), a + wo - 0.05, z + h), k), rot2((a + wo, a + wo - 0.05, z + h), k), 0.05, 0.05, "yellow")
                # 横向连接（吊杆之间的水平杆，承托走道板）
                hangers.bar(rot2((-(a + wo), a + wi + 0.05, z - 0.1), k), rot2((a + wo, a + wi + 0.05, z - 0.1), k), 0.08, 0.1, "dark_steel")
                hangers.bar(rot2((-(a + wo), a + wo - 0.05, z - 0.1), k), rot2((a + wo, a + wo - 0.05, z - 0.1), k), 0.08, 0.1, "dark_steel")
        # 筒格内圈：吊杆在靠筒格中心一侧，栏杆也在这一侧
        for (x0, x1), (y0, y1) in self.cells():
            d1 = wi + cw
            ix0, ix1, iy0, iy1 = x0 + d1, x1 - d1, y0 + d1, y1 - d1
            corners = [(ix0, iy0), (ix1, iy0), (ix1, iy1), (ix0, iy1)]
            for p in corners:
                hangers.bar((p[0], p[1], bot), (p[0], p[1], top), 0.1, 0.1, "dark_steel")
            for p, q in zip(corners, corners[1:] + corners[:1]):
                L = math.hypot(q[0] - p[0], q[1] - p[1])
                nmid = int(L // 2.4)
                for i in range(1, nmid + 1):
                    t = i / (nmid + 1)
                    m = (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
                    hangers.bar((m[0], m[1], bot), (m[0], m[1], top), 0.08, 0.08, "dark_steel")
                for z in self.hang:
                    for h in (0.6, 1.2):
                        guard.bar((p[0], p[1], z + h), (q[0], q[1], z + h), 0.05, 0.05, "yellow")
                    guard.bar((p[0], p[1], z + 0.09), (q[0], q[1], z + 0.09), 0.02, 0.18, "yellow")
        self._add(hangers, "ZLJ_Hangers", parent, kind="platform", part="挂架吊杆")
        self._add(walks, "ZLJ_Walkways", parent, kind="platform", part="挂架走道板（7层）")
        self._add(guard, "ZLJ_Guard", parent, kind="platform", part="踢脚板和栏杆")

        # 最底层翻板：从走道内边伸到墙面，封住缝
        acc = Acc()
        z = self.zbot
        for k in range(4):
            p0, p1 = rot2((-(a + wo), a + 0.02), k), rot2((a + wo, a + wi), k)
            acc.box_mm((min(p0[0], p1[0]), min(p0[1], p1[1]), z - 0.02), (max(p0[0], p1[0]), max(p0[1], p1[1]), z + 0.01), "yellow")
        for (x0, x1), (y0, y1) in self.cells():
            for r in ((x0 + 0.02, y1 - wi, x1 - 0.02, y1 - 0.02), (x0 + 0.02, y0 + 0.02, x1 - 0.02, y0 + wi),
                      (x0 + 0.02, y0 + wi, x0 + wi, y1 - wi), (x1 - wi, y0 + wi, x1 - 0.02, y1 - wi)):
                acc.box_mm((r[0], r[1], z - 0.02), (r[2], r[3], z + 0.01), "yellow")
        self._add(acc, "ZLJ_FlipPlates", parent, kind="platform", part="底部防坠翻板")

        # 楼梯：东侧外圈，每层一跑
        acc = Acc()
        levels = [self.zb] + self.hang
        x_in, x_out = a + wi + 0.12, a + wi + 0.82
        for i in range(len(levels) - 1):
            zt, zl = levels[i], levels[i + 1]
            y_lo, y_hi = 6.0, 6.0 + (zt - zl)
            nstep = 11
            for s in range(nstep):
                t = (s + 0.5) / nstep
                y = y_lo + (y_hi - y_lo) * t
                zz = zl + (zt - zl) * (s + 1) / nstep
                acc.box((x_in / 2 + x_out / 2, y, zz - 0.02), (x_out - x_in, (y_hi - y_lo) / nstep + 0.02, 0.04), "grating")
            for xx in (x_in, x_out):
                acc.bar((xx, y_lo, zl), (xx, y_hi, zt), 0.04, 0.18, "dark_steel")
                acc.bar((xx, y_lo, zl + 0.9), (xx, y_hi, zt + 0.9), 0.04, 0.04, "yellow")
        self._add(acc, "ZLJ_Stairs", parent, kind="platform", part="挂架爬梯")

    # ---------------------------------------------------- 全封闭防护网
    def enclosure(self, parent):
        E = self.E
        z0, z1 = self.zbot - 0.3, self.zd + self.Q["guard_h"]
        mesh = Acc()
        frame = Acc()
        for k in range(4):
            p0, p1 = rot2((-E, E - 0.01), k), rot2((E, E + 0.01), k)
            mesh.box_mm((min(p0[0], p1[0]), min(p0[1], p1[1]), z0), (max(p0[0], p1[0]), max(p0[1], p1[1]), z1), "mesh_red")
            x = -E
            nx = int(round(2 * E / 1.5))
            for i in range(nx + 1):
                x = -E + i * 2 * E / nx
                frame.bar(rot2((x, E + 0.04, z0), k), rot2((x, E + 0.04, z1), k), 0.06, 0.06, "plat_red")
            z = z0
            while z <= z1 + 1e-6:
                frame.bar(rot2((-E, E + 0.04, z), k), rot2((E, E + 0.04, z), k), 0.06, 0.06, "plat_red")
                z += self.Q["hang_step"]
            frame.bar(rot2((-E, E + 0.04, z1), k), rot2((E, E + 0.04, z1), k), 0.08, 0.08, "plat_red")
            # 白色腰带（实景常见的一圈标识带，这里不写字）
            p0, p1 = rot2((-E, E + 0.02), k), rot2((E, E + 0.05), k)
            frame.box_mm((min(p0[0], p1[0]), min(p0[1], p1[1]), self.zb), (max(p0[0], p1[0]), max(p0[1], p1[1]), self.zd), "white")
        self._add(mesh, "ZLJ_Mesh", parent, kind="platform", part="冲孔钢板网防护")
        self._add(frame, "ZLJ_MeshFrame", parent, kind="platform", part="防护网框架")

    # ---------------------------------------------------- 大钢模（浇筑层）
    def _form_run(self, acc, p0, p1, nrm, z0, z1):
        """一段墙面的钢模板：面板 + 竖肋（每 0.3 m）+ 双槽钢背楞（4 道）。p0/p1 是墙面上的端点，nrm 指向离墙方向。"""
        p0, p1, n = np.array(p0, float), np.array(p1, float), np.array(nrm, float)
        L = np.linalg.norm(p1 - p0)
        if L < 0.3:
            return
        d = (p1 - p0) / L
        zc = (z0 + z1) / 2

        def at(s, off, z):
            q = p0 + d * s + n * off
            return (q[0], q[1], z)

        acc.bar(at(0, 0.012, zc), at(L, 0.012, zc), 0.024, z1 - z0, "form", up=(0, 0, 1))
        s = 0.15
        while s < L:
            acc.bar(at(s, 0.064, z0), at(s, 0.064, z1), 0.008, 0.08, "form", up=(n[0], n[1], 0))
            s += 0.3
        for zz in np.linspace(z0 + 0.45, z1 - 0.35, 4):
            for dz in (-0.06, 0.06):
                acc.bar(at(0, 0.16, zz + dz), at(L, 0.16, zz + dz), 0.1, 0.05, "dark_steel")

    def formwork(self, parent):
        a, to, ti = self.a, self.to, self.ti
        z0, z1 = -self.Q["form_h"] + 0.1, 0.1
        acc = Acc()
        runs = []
        for k in range(4):
            runs.append((rot2((-a, a), k), rot2((a, a), k), rot2((0, 1), k)))
        for (x0, x1), (y0, y1) in self.cells():
            runs += [((x0, y1), (x1, y1), (0, -1)), ((x0, y0), (x1, y0), (0, 1)),
                     ((x0, y0), (x0, y1), (1, 0)), ((x1, y0), (x1, y1), (-1, 0))]
        for p0, p1, n in runs:
            self._form_run(acc, p0, p1, n, z0, z1)
        self._add(acc, "ZLJ_Forms", parent, kind="platform", part="大钢模（浇筑层）", ref_floor=self.Q["ref_floor"],
                  outer_t=self.to, inner_t=self.ti)

        # 模板吊轨 + 吊杆：平台底下沿每个墙面一根工字钢轨道
        acc = Acc()
        zr = self.zb - 0.2
        for p0, p1, n in runs:
            p0, p1, n = np.array(p0, float), np.array(p1, float), np.array(n, float)
            q0, q1 = p0 + n * 0.45, p1 + n * 0.45
            acc.hbeam((q0[0], q0[1], zr), (q1[0], q1[1], zr), 0.28, 0.12, 0.012, 0.008, "dark_steel")
            L = np.linalg.norm(p1 - p0)
            m = max(2, int(L // 2.4) + 1)
            for i in range(m):
                t = (i + 0.5) / m
                q = q0 + (q1 - q0) * t
                acc.box((q[0], q[1], zr - 0.25), (0.25, 0.25, 0.22), "yellow")   # 滑轮小车
                qq = p0 + (p1 - p0) * t + n * 0.2
                acc.bar((q[0], q[1], zr - 0.35), (qq[0], qq[1], z1 + 0.05), 0.04, 0.04, "dark_steel")
        self._add(acc, "ZLJ_FormRails", parent, kind="platform", part="模板吊轨和滑轮")

    # ---------------------------------------------------- 支点：附墙支座 + 油缸 + 支撑立柱
    def supports_build(self, parent):
        Q = self.Q
        cs = Q["col_size"]
        top = self.zb
        bot = self.zb - Q["col_len"]
        cols = Acc()
        seatsU, seatsL = Acc(), Acc()
        frames, rods = Acc(), Acc()
        pumps = Acc()
        cy = Q["cyl"]
        zU, zL = Q["seat_z"]
        for sp in self.supports():
            cx, cyy = sp["col"]
            n = np.array([sp["n"][0], sp["n"][1], 0.0])     # 离墙方向
            t = np.array([-n[1], n[0], 0.0])                # 沿墙方向
            C = np.array([cx, cyy, 0.0])
            W = np.array([sp["wall"][0], sp["wall"][1], 0.0])
            h = cs / 2 - 0.07
            # 立柱：四根弦杆 + 缀条 + 承力棒
            chords = [C + n * i * h + t * j * h for i in (-1, 1) for j in (-1, 1)]
            for p in chords:
                cols.bar((p[0], p[1], bot), (p[0], p[1], top), 0.14, 0.14, "dark_steel")
            z = bot
            face_pairs = [(0, 1), (2, 3), (0, 2), (1, 3)]
            k = 0
            while z < top - 0.79:
                for i, j in face_pairs:
                    pa, pb = (chords[i], chords[j]) if k % 2 == 0 else (chords[j], chords[i])
                    cols.bar((pa[0], pa[1], z), (pb[0], pb[1], z + 0.8), 0.06, 0.02, "dark_steel")
                z += 0.8
                k += 1
            z = bot + 0.3
            while z < top - 0.3:
                pa, pb = chords[0], chords[1]   # 靠墙一侧两根弦杆之间
                cols.cyl((pa[0], pa[1], z), (pb[0], pb[1], z), 0.045, "dark_steel", seg=8)
                z += Q["bar_pitch"]
            cols.box((cx, cyy, top - 0.25), (cs + 0.2, cs + 0.2, 0.5), "yellow")   # 柱顶换向盒
            # 附墙支座：墙面钢板 + 盒体 + 两只钩爪 + 穿墙螺栓头
            for zs, acc in ((zU, seatsU), (zL, seatsL)):
                gap = np.linalg.norm((C - W)[:2]) - cs / 2
                base = W + n * 0.02
                R = np.stack([n, t, np.array([0, 0, 1.0])], axis=1)   # 右手系：n × t = z
                acc.box((base[0], base[1], zs), (0.04, 0.9, 0.9), "yellow", R=R)
                body = W + n * (gap / 2 + 0.02)
                acc.box((body[0], body[1], zs + 0.1), (gap - 0.02, 0.6, 0.5), "yellow", R=R)
                for j in (-0.18, 0.18):
                    claw = W + n * (gap - 0.02) + t * j
                    acc.box((claw[0], claw[1], zs + 0.42), (0.16, 0.08, 0.2), "dark_steel", R=R)
                for i in (-0.33, 0.33):
                    for j in (-0.33, 0.33):
                        bolt = W + t * i
                        acc.cyl((bolt[0], bolt[1], zs + j), (bolt[0] + n[0] * 0.09, bolt[1] + n[1] * 0.09, zs + j), 0.035, "dark_steel", seg=8)
            # 油缸支架（倒三角）挂在下支座上，油缸装在立柱中间
            zf = zL + 0.6
            R = np.stack([n, t, np.array([0, 0, 1.0])], axis=1)
            frames.box((cx, cyy, zf), (cs + 0.3, cs + 0.3, 0.08), "yellow", R=R)
            for j in (-1, 1):
                p_top = C + t * j * (cs / 2 + 0.12)
                p_bot = W + n * 0.3 + t * j * 0.2
                frames.bar((p_top[0], p_top[1], zf), (p_bot[0], p_bot[1], zL + 0.3), 0.1, 0.03, "yellow")
            zc0, zc1 = zf + 0.04, zf + 0.04 + cy["closed"]
            frames.cyl((cx, cyy, zc0), (cx, cyy, zc1), cy["bore"] / 2 + 0.03, "cyl_yellow", seg=20)
            frames.cyl((cx, cyy, zc1 - 0.1), (cx, cyy, zc1 + 0.05), cy["bore"] / 2 + 0.06, "cyl_yellow", seg=20)
            rods.cyl((cx, cyy, zc1 - 0.2), (cx, cyy, zc1 + cy["ext"] + 0.05), cy["rod"] / 2, "chrome", seg=16)
            rods.box((cx, cyy, zc1 + cy["ext"] + 0.12), (0.5, 0.5, 0.14), "dark_steel", R=R)
            # 液压泵站：平台面上，正对立柱
            pumps.box((cx, cyy, self.zd + 0.5), (1.2, 0.8, 0.9), "cyl_yellow")
            pumps.box((cx, cyy, self.zd + 0.98), (1.25, 0.85, 0.06), "dark_steel")
            pumps.cyl((cx + 0.3, cyy, self.zd + 1.0), (cx + 0.3, cyy, self.zd - 0.2), 0.03, "black", seg=8)
        self._add(cols, "ZLJ_Columns", parent, kind="support_column", part="格构支撑立柱（12根）", bar_pitch=Q["bar_pitch"])
        self.seat_objs = (seatsU, seatsL)
        self.cyl_objs = (frames, rods)
        self._add(pumps, "ZLJ_Pumps", parent, kind="platform", part="液压泵站（12台）")

    # ---------------------------------------------------- 布料机
    def boom(self, parent, idx, pos, slew_deg):
        Q = self.Q["boom"]
        x, y = pos
        z = self.zd + 0.04
        acc = Acc()
        # 底座十字梁 + 塔身方管
        for ang in (0, 90):
            d = np.array([math.cos(math.radians(ang)), math.sin(math.radians(ang)), 0])
            acc.bar((x - d[0] * 2.0, y - d[1] * 2.0, z + 0.15), (x + d[0] * 2.0, y + d[1] * 2.0, z + 0.15), 0.3, 0.3, "white")
        acc.box((x, y, z + 1.65), (0.6, 0.6, 2.7), "white")
        for ang in (45, 135, 225, 315):
            d = np.array([math.cos(math.radians(ang)), math.sin(math.radians(ang)), 0])
            acc.bar((x + d[0] * 1.6, y + d[1] * 1.6, z + 0.3), (x + d[0] * 0.3, y + d[1] * 0.3, z + 2.4), 0.1, 0.1, "white")
        # 竖向泵管：从下面的筒格上来
        acc.cyl((x + 0.45, y, self.zbot), (x + 0.45, y, z + 2.9), 0.0665, "dark_steel", seg=12)
        base = self._add(acc, f"ZLJ_Boom{idx}_Base", parent, kind="boom_base")
        zs = z + 3.0
        # 回转台（原点在回转轴上）
        slew = empty(f"ZLJ_Boom{idx}_Slew", loc=(x, y, zs), parent=parent, props=dict(kind="boom_slew", axis="z"))
        slew.rotation_euler = (0, 0, math.radians(slew_deg))
        acc = Acc()
        acc.cyl((x, y, zs), (x, y, zs + 0.35), 0.55, "white", seg=24)
        acc.box((x - 1.6, y, zs + 0.6), (3.6, 0.9, 0.5), "white")
        acc.box((x - 3.3, y, zs + 0.7), (1.2, 1.1, 1.0), "concrete_dark")    # 尾部配重
        acc.box((x + 0.2, y, zs + 1.0), (0.5, 0.7, 1.2), "white")           # 大臂铰座
        ob = acc.build(f"ZLJ_Boom{idx}_SlewBody", origin=(x, y, zs), props=dict(kind="boom_part"))
        ob.parent = slew
        ob.location = (0, 0, 0)
        self.objs.append(ob)
        # 三节臂：每节一个空物体当铰点，局部 x 轴沿臂长
        arms = Q["arms"]
        pose = self.Q["boom"]["pose"]
        secs = [(0.6, 0.45), (0.45, 0.36), (0.34, 0.28)]
        prev = slew
        hinge = (0.2, 0.0, 1.5)
        for j, (L, ang) in enumerate(zip(arms, pose)):
            hj = empty(f"ZLJ_Boom{idx}_Arm{j + 1}", loc=hinge, parent=None, props=dict(kind="boom_arm", axis="y", length=L))
            hj.parent = prev
            hj.location = hinge
            hj.rotation_euler = (0, -math.radians(ang), 0)
            acc = Acc()
            h0, h1 = secs[j]
            acc.bar((0, 0, 0), (L, 0, 0), h0 * 0.75, h0, "white")
            acc.box((L * 0.5, 0, h0 / 2 + 0.01), (L * 0.9, h0 * 0.76, 0.06), "cyl_yellow")
            acc.cyl((0, 0, h0 / 2 + 0.12), (L, 0, h0 / 2 + 0.12), 0.0665, "dark_steel", seg=10)
            acc.cyl((0, 0.35, 0), (0, -0.35, 0), h0 * 0.55, "dark_steel", seg=16)
            if j == 0:
                acc.cyl((-0.1, 0, -1.0), (L * 0.35, 0, -0.1), 0.09, "chrome", seg=10)
            ob = acc.build(f"ZLJ_Boom{idx}_Arm{j + 1}_Body", props=dict(kind="boom_part"))
            ob.parent = hj
            ob.location = (0, 0, 0)
            self.objs.append(ob)
            prev = hj
            hinge = (L, 0.0, 0.0)
        # 末端软管：在末节局部坐标里算出“竖直向下”的方向
        net = sum(pose)
        d = (math.sin(math.radians(net)) * -1, 0, -math.cos(math.radians(net)))
        L3 = arms[-1]
        acc = Acc()
        acc.cyl((L3, 0, 0), (L3 + 3.0 * d[0], 0, 3.0 * d[2]), 0.075, "rubber", seg=12)
        ob = acc.build(f"ZLJ_Boom{idx}_Hose", props=dict(kind="boom_hose", length=3.0))
        ob.parent = prev
        ob.location = (0, 0, 0)
        self.objs.append(ob)

    # ---------------------------------------------------- 附属设施
    def aux(self, parent):
        E, zd = self.E, self.zd + 0.04
        acc = Acc()

        def container(cx, cy, L, W, H, rot, door=True, windows=0):
            R = np.array([[math.cos(rot), -math.sin(rot), 0], [math.sin(rot), math.cos(rot), 0], [0, 0, 1]])
            acc.box((cx, cy, zd + H / 2), (L, W, H), "white", R=R)
            # 波纹：侧面竖条
            n = int(L / 0.3)
            for i in range(n):
                s = -L / 2 + (i + 0.5) * L / n
                for side in (-1, 1):
                    p = np.array([cx, cy, 0]) + R @ np.array([s, side * (W / 2 + 0.01), 0])
                    acc.box((p[0], p[1], zd + H / 2), (0.1, 0.03, H - 0.2), "white", R=R)
            for e in (-1, 1):
                p = np.array([cx, cy, 0]) + R @ np.array([e * L / 2, 0, 0])
                acc.box((p[0], p[1], zd + H / 2), (0.08, W + 0.06, H + 0.04), "blue", R=R)
            for i in range(windows):
                s = -L / 2 + (i + 1) * L / (windows + 1)
                p = np.array([cx, cy, 0]) + R @ np.array([s, -(W / 2 + 0.03), 0])
                acc.box((p[0], p[1], zd + H * 0.6), (0.9, 0.04, 0.8), "window", R=R)
            if door:
                p = np.array([cx, cy, 0]) + R @ np.array([L / 2 - 0.9, -(W / 2 + 0.03), 0])
                acc.box((p[0], p[1], zd + 1.05), (0.9, 0.04, 2.0), "blue", R=R)

        container(-6.0, -12.3, 6.06, 2.44, 2.59, 0.0, windows=1)       # 焊机房
        container(6.5, 12.3, 6.06, 2.44, 2.59, math.pi, windows=1)     # 工具房
        container(12.3, -7.0, 3.0, 2.44, 2.6, math.pi / 2, windows=2)   # 控制室（智能监控）
        # 消防水箱
        acc.box((-12.0, 1.5, zd + 1.05), (2.0, 3.0, 2.0), "blue")
        acc.box((-12.0, 1.5, zd + 0.03), (2.2, 3.2, 0.06), "dark_steel")
        # 钢筋堆
        for i, (cx, cy) in enumerate(((1.5, 9.0), (1.5, 10.2), (-2.5, -9.5))):
            for j in range(3):
                acc.box((cx, cy, zd + 0.12 + j * 0.22), (6.0, 0.9, 0.2), "rebar")
            for j in (-2.5, 0, 2.5):
                acc.box((cx + j, cy, zd + 0.04), (0.12, 1.0, 0.08), "dark_steel")
        # 四角摄像头杆 + 气象站
        for k in range(4):
            px, py = rot2((E - 0.4, E - 0.4), k)
            acc.cyl((px, py, zd), (px, py, zd + 3.5), 0.05, "dark_steel", seg=8)
            acc.box((px, py, zd + 3.55), (0.35, 0.2, 0.18), "white")
        acc.cyl((-E + 0.5, 0, zd), (-E + 0.5, 0, zd + 6.0), 0.06, "dark_steel", seg=8)
        for k in range(3):
            ang = k * 2 * math.pi / 3
            acc.bar((-E + 0.5, 0, zd + 6.0), (-E + 0.5 + 0.35 * math.cos(ang), 0.35 * math.sin(ang), zd + 6.0), 0.02, 0.02, "dark_steel")
            acc.cyl((-E + 0.5 + 0.35 * math.cos(ang), 0.35 * math.sin(ang), zd + 5.95), (-E + 0.5 + 0.35 * math.cos(ang), 0.35 * math.sin(ang), zd + 6.05), 0.07, "white", seg=10)
        # 防护网顶上的喷淋环管
        zt = self.zd + self.Q["guard_h"] - 0.1
        for k in range(4):
            acc.cyl(rot2((-E, E - 0.12, zt), k), rot2((E, E - 0.12, zt), k), 0.03, "white", seg=8)
        self._add(acc, "ZLJ_Aux", parent, kind="platform", part="附属设施（集装箱、水箱、钢筋、监控、喷淋）")

    # ---------------------------------------------------- 总装
    def build(self, loc=(0, 0, 0)):
        root = empty("ZAOLOJI", loc=loc, props=dict(kind="zaoloji_root", ref_floor=self.Q["ref_floor"]))
        self.root = root
        move = empty("ZLJ_Moving", loc=loc, parent=root, props=dict(kind="moving", note="顶升时整体上移的部分"))
        self.platform(move)
        self.hanging(move)
        self.enclosure(move)
        self.formwork(move)
        self.supports_build(move)
        self.aux(move)
        for i, (p, s) in enumerate(zip(self.Q["boom"]["pos"], self.Q["boom"]["slew"])):
            self.boom(move, i + 1, p, s)
        sU, sL = self.seat_objs
        self._add(sU, "ZLJ_SeatsUpper", root, kind="seat", part="上附墙支座（固定在墙上）", z=self.Q["seat_z"][0])
        self._add(sL, "ZLJ_SeatsLower", root, kind="seat", part="下附墙支座（固定在墙上）", z=self.Q["seat_z"][1])
        fr, rd = self.cyl_objs
        self._add(fr, "ZLJ_CylFrames", root, kind="cyl_frame", part="油缸支架 + 缸筒（12套）")
        self._add(rd, "ZLJ_CylRods", root, kind="cyl_rod", part="活塞杆", stroke=self.Q["cyl"]["stroke"], ext=self.Q["cyl"]["ext"])
        # build() 里所有几何按 loc=(0,0,0) 生成，挂到 root 下以后整体跟着 root 走
        return root

    def spec(self):
        return dict(
            ref_floor=self.Q["ref_floor"], outer_t=self.to, inner_t=self.ti,
            bottom=self.zb, deck=self.zd, hang=self.hang, bottom_walk=self.zbot,
            supports=[dict(col=list(s["col"]), n=list(s["n"]), kind=s["kind"]) for s in self.supports()],
            cells=[[list(a), list(b)] for a, b in self.cells()],
            hatches=[list(h) for h in self.hatches],
            stroke=self.Q["cyl"]["stroke"], seat_z=self.Q["seat_z"],
        )
