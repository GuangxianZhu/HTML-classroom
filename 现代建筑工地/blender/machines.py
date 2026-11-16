"""工程机械、车辆、工人、临建的“原型”。网页里按需复制、摆位置、让会动的件动起来。

约定（每台机器一样）：
  - 根节点 M_xxx，原点在地面、机器中心；车头 / 机头朝 +X，左边 +Y，上 +Z
  - 会动的件是一个空物体（节点），原点放在转轴上，extras 里写 kind / axis（Blender 局部轴）
  - 尺寸参照公开产品参数，出处写在 参考资料.md；外形是按这些尺寸原创的，不对应具体品牌
"""
import math

import numpy as np

from sitekit import Acc, empty


def arc(cx, cz, r, a0, a1, n=8):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cz + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


class Kit:
    def __init__(self):
        self.objs = []
        self.roots = {}
        self.PW = {}

    # ---------------------------------------------------- 节点和网格
    def root(self, name, props=None):
        e = empty(name, props=dict(kind="machine", **(props or {})))
        self.PW[name] = np.zeros(3)
        self.roots[name] = e
        return e

    def node(self, name, parent, pw, props=None):
        pw = np.asarray(pw, float)
        e = empty(name, props=props or {})
        e.empty_display_size = 0.4
        e.parent = parent
        e.location = tuple(pw - self.PW[parent.name])
        self.PW[name] = pw
        return e

    def mesh(self, acc, name, node, props=None):
        ob = acc.build(name, origin=tuple(self.PW[node.name]), props=props)
        if ob is None:
            return None
        ob.parent = node
        ob.location = (0, 0, 0)
        self.objs.append(ob)
        return ob

    # ---------------------------------------------------- 常用零件
    def wheel(self, parent, name, c, r, w, dual=False, rim="rim"):
        n = self.node(name, parent, c, dict(kind="wheel", axis="y", r=r))
        a = Acc()
        cx, cy, cz = c
        offs = [-w * 0.55, w * 0.55] if dual else [0.0]
        for o in offs:
            y = cy + o
            a.cyl((cx, y - w / 2, cz), (cx, y + w / 2, cz), r, "tire", seg=20)
            for s in (-1, 1):
                a.cyl((cx, y + s * (w / 2 - 0.01), cz), (cx, y + s * (w / 2 + 0.006), cz), r * 0.62, rim, seg=16, smooth=False)
        out = 1 if cy > 0 else -1
        a.cyl((cx, cy + out * (w * (1.1 if dual else 0.5)), cz), (cx, cy + out * (w * (1.1 if dual else 0.5) + 0.05), cz), r * 0.22, "dark_steel", seg=10)
        self.mesh(a, name + "_m", n)
        return n

    def track(self, a, L, contact, h, y0, y1, r=None):
        """履带：侧面轮廓（两端圆、底边是接地长度）沿 y 拉伸，加上下两面的履带板齿。"""
        r = r or h * 0.45
        cxr = L / 2 - r
        poly = [(-contact / 2, 0.0), (contact / 2, 0.0)]
        poly += arc(cxr, h - r, r, -55, 90, 7)
        poly += arc(-cxr, h - r, r, 90, 235, 7)
        a.prism_xz(poly, y0, y1, "tire")
        x = -contact / 2 + 0.1
        while x < contact / 2:
            a.box((x, (y0 + y1) / 2, 0.025), (0.07, abs(y1 - y0) + 0.02, 0.05), "dark_steel")
            x += 0.2
        x = -cxr
        while x < cxr:
            a.box((x, (y0 + y1) / 2, h - 0.02), (0.07, abs(y1 - y0) + 0.02, 0.04), "dark_steel")
            x += 0.2
        side = y1 if abs(y1) > abs(y0) else y0
        sgn = 1 if side > 0 else -1
        for xx in (-cxr, cxr):
            a.cyl((xx, side, h - r), (xx, side + sgn * 0.04, h - r), r * 0.8, "dark_steel", seg=14, smooth=False)
        a.box((0, side + sgn * 0.02, h * 0.55), (2 * cxr - 0.4, 0.04, h * 0.3), "dark_steel")

    def glass_box(self, a, lo, hi, m="glass_dark"):
        a.box_mm(lo, hi, m)

    # ---------------------------------------------------- 挖掘机（30 t 级，电动）
    def excavator(self, name="M_Excavator", boom=6.45, arm=3.2, bucket_w=1.45, long_reach=False):
        R = self.root(name, dict(model="excavator", long=int(long_reach)))
        a = Acc()
        # 履带：长 4.785，接地 3.91，轨距 2.59，板宽 0.6（SY300H-S 参数）
        for s in (-1, 1):
            yc = s * 2.59 / 2
            self.track(a, 4.785, 3.91, 1.0, yc - 0.3, yc + 0.3)
        a.box_mm((-1.3, -1.0, 0.45), (1.3, 1.0, 1.0), "dark_steel")
        a.cyl((0, 0, 1.0), (0, 0, 1.18), 1.0, "dark_steel", seg=24)
        self.mesh(a, name + "_Under", R)
        sl = self.node(name + "_Slew", R, (0, 0, 1.18), dict(kind="slew", axis="z"))
        a = Acc()
        W = 2.995 / 2
        tail = 3.14
        a.box_mm((-tail + 0.4, -W, 1.18), (1.35, W, 1.32), "dark_steel")
        # 电池仓（取代发动机罩）+ 配重（圆尾）
        a.box_mm((-tail + 0.55, -W, 1.32), (-0.55, W, 2.55), "mach_yellow")
        for i in range(5):
            a.box_mm((-2.3 + i * 0.32, -W - 0.01, 1.7), (-2.1 + i * 0.32, W + 0.01, 2.35), "dark_steel")   # 散热格栅
        a.prism_xz(arc(-tail + 0.55, 1.86, 0.54, 90, 270, 8), -W, W, "mach_yellow")
        a.box_mm((-tail + 0.5, -W, 1.32), (-tail + 0.62, W, 2.4), "dark_steel")
        # 驾驶室（左前）
        cab = [(-0.65, 1.32), (1.3, 1.32), (1.3, 2.25), (1.12, 3.12), (-0.55, 3.12), (-0.65, 2.95)]
        a.prism_xz(cab, 0.42, W, "mach_yellow")
        a.box_mm((1.305, 0.5, 2.25), (1.33, W - 0.08, 2.95), "glass_dark")
        a.box_mm((-0.45, W, 1.75), (1.0, W + 0.02, 2.95), "glass_dark")
        a.box_mm((-0.45, 0.40, 1.75), (1.0, 0.42, 2.95), "glass_dark")
        a.box_mm((-0.6, 0.45, 3.12), (1.1, W - 0.03, 3.18), "dark_steel")
        # 右前液压油箱 / 工具箱
        a.box_mm((0.0, -W, 1.32), (1.35, -0.42, 2.15), "mach_yellow")
        a.box_mm((0.6, -0.42, 1.32), (1.35, 0.42, 1.75), "dark_steel")
        # 扶手、后视镜
        a.bar((-0.5, -W - 0.05, 2.62), (-2.6, -W - 0.05, 2.62), 0.04, 0.04, "dark_steel")
        a.bar((1.2, W + 0.05, 3.0), (1.2, W + 0.3, 3.15), 0.03, 0.03, "dark_steel")
        a.box((1.2, W + 0.32, 3.12), (0.05, 0.18, 0.25), "dark_steel")
        self.mesh(a, name + "_Body", sl)
        # 动臂：铰点 (0.75, 0, 1.85)，静止姿态先往上再往前下（“香蕉”形）
        foot = np.array([0.75, 0.0, 1.85])
        bm = self.node(name + "_Boom", sl, foot, dict(kind="boom", axis="y", length=boom))
        a = Acc()
        k = boom / 6.45
        knee = foot + np.array([3.2, 0, 2.3]) * k
        tip = foot + np.array([boom * 0.96, 0, 1.4 * k])
        hb = 0.75 if not long_reach else 0.6
        a.bar(foot, knee, 0.55, hb, "mach_yellow", up=(0, 0, 1))
        a.bar(knee, tip, 0.5, hb * 0.75, "mach_yellow")
        a.cyl(foot + (0, -0.35, 0), foot + (0, 0.35, 0), 0.22, "dark_steel", seg=12)
        for s in (-1, 1):   # 动臂油缸（简化：跟着动臂一起转）
            p0 = foot + np.array([0.1, s * 0.33, -0.65])
            p1 = foot + np.array([2.2, s * 0.33, 0.95]) * np.array([k, 1, k])
            a.cyl(p0, p0 + (p1 - p0) * 0.55, 0.11, "dark_steel", seg=10)
            a.cyl(p0 + (p1 - p0) * 0.5, p1, 0.07, "chrome", seg=10)
        p0 = knee + np.array([-0.3, 0, 0.5])   # 斗杆油缸
        a.cyl(p0, p0 + (tip + np.array([0.0, 0, 0.6]) - p0) * 0.6, 0.11, "dark_steel", seg=10)
        a.cyl(p0 + (tip + np.array([0.0, 0, 0.6]) - p0) * 0.55, tip + np.array([0.0, 0, 0.6]), 0.07, "chrome", seg=10)
        self.mesh(a, name + "_Boom_m", bm)
        # 斗杆：静止时朝下略向前
        am = self.node(name + "_Arm", bm, tip, dict(kind="arm", axis="y", length=arm))
        a = Acc()
        atip = tip + np.array([arm * 0.7, 0, -arm * 0.71])
        a.bar(tip + np.array([-0.3, 0, 0.55]), atip, 0.42, 0.55 if not long_reach else 0.42, "mach_yellow")
        a.cyl(tip + (0, -0.3, 0), tip + (0, 0.3, 0), 0.18, "dark_steel", seg=12)
        p0 = tip + np.array([0.15, 0, -0.5])
        a.cyl(p0, p0 + (atip - p0) * 0.55, 0.09, "dark_steel", seg=10)
        self.mesh(a, name + "_Arm_m", am)
        # 铲斗：侧板轮廓沿宽度拉伸 + 斗齿；斗里的土单独一个物体
        bk = self.node(name + "_Bucket", am, atip, dict(kind="bucket", axis="y"))
        a = Acc()
        s = 1.0 if not long_reach else 0.72
        prof = [(0.0, 0.0), (0.35 * s, 0.12 * s), (1.15 * s, -0.35 * s), (1.35 * s, -0.95 * s), (1.1 * s, -1.25 * s), (0.45 * s, -1.2 * s), (0.05 * s, -0.75 * s)]
        bw = bucket_w * s
        a.prism_xz([(x + atip[0], z + atip[2]) for x, z in prof], -bw / 2, bw / 2, "mach_yellow")
        for i in range(5):
            y = -bw / 2 + (i + 0.5) * bw / 5
            a.bar(atip + np.array([1.12 * s, y, -1.22 * s]), atip + np.array([1.45 * s, y, -1.38 * s]), 0.09, 0.08, "dark_steel")
        a.cyl(atip + (0, -0.3, 0), atip + (0, 0.3, 0), 0.12, "dark_steel", seg=10)
        self.mesh(a, name + "_Bucket_m", bk)
        a = Acc()
        a.prism_xz([(x + atip[0], z + atip[2]) for x, z in [(0.3 * s, -0.05 * s), (1.05 * s, -0.42 * s), (1.2 * s, -0.95 * s), (0.5 * s, -0.75 * s)]], -bw / 2 + 0.06, bw / 2 - 0.06, "dirt")
        self.mesh(a, name + "_Load", bk, dict(kind="load"))
        R["tip"] = list(map(float, atip))
        return R

    # ---------------------------------------------------- 卡车底盘（8×4）共用：驾驶室、车架、换电电池仓、车轮
    def truck_base(self, R, name, L_front=4.8, L_rear=-4.85, axles=(3.85, 2.05, -2.2, -3.55), cab_col="mach_white", stripe="truck_green"):
        a = Acc()
        a.box_mm((L_rear + 0.15, -0.48, 0.82), (L_front - 0.4, 0.48, 1.12), "dark_steel")        # 车架
        x0 = L_front - 2.2
        cab = [(x0, 1.05), (L_front, 1.05), (L_front, 2.1), (L_front - 0.12, 2.95), (L_front - 0.45, 3.25), (x0, 3.25)]
        a.prism_xz(cab, -1.25, 1.25, cab_col)
        a.box_mm((L_front - 0.2, -1.1, 2.15), (L_front - 0.08, 1.1, 2.9), "glass_dark")          # 前挡风
        for s in (-1, 1):
            a.box_mm((L_front - 1.15, s * 1.25 - 0.01, 2.0), (L_front - 0.25, s * 1.25 + 0.01, 2.85), "glass_dark")
            a.box_mm((L_front - 2.15, s * 1.25 - 0.012, 1.45), (L_front - 0.02, s * 1.25 + 0.012, 1.62), stripe)
            a.bar((L_front - 0.1, s * 1.27, 2.7), (L_front + 0.2, s * 1.42, 2.75), 0.03, 0.03, "dark_steel")
            a.box((L_front + 0.22, s * 1.44, 2.45), (0.06, 0.12, 0.5), "dark_steel")            # 后视镜
            a.box((L_front + 0.005, s * 0.9, 1.35), (0.04, 0.35, 0.16), "lamp")                 # 大灯
            a.box_mm((L_front - 0.95, s * 1.25 - 0.02, 1.05), (L_front - 0.55, s * 1.25 + 0.02, 1.95), "dark_steel")   # 上车踏板
        a.box_mm((L_front - 0.05, -1.25, 0.55), (L_front + 0.08, 1.25, 1.05), "truck_gray")       # 保险杠
        a.box_mm((x0 + 0.1, -1.2, 3.25), (L_front - 0.6, 1.2, 3.38), cab_col)                    # 顶部导流
        a.box_mm((L_front - 0.09, -0.6, 1.62), (L_front + 0.005, 0.6, 2.05), "dark_steel")         # 前格栅
        # 换电电池仓（驾驶室后面）
        a.box_mm((x0 - 1.0, -1.15, 1.12), (x0 - 0.08, 1.15, 2.95), "truck_gray")
        a.box_mm((x0 - 1.02, -1.16, 2.25), (x0 - 0.06, 1.16, 2.45), stripe)
        a.box_mm((x0 - 0.9, -1.0, 2.95), (x0 - 0.18, 1.0, 3.05), "dark_steel")
        # 挡泥板、侧防护
        for x in axles:                       # 挡泥板：轮子正上方一块板
            for s in (-1, 1):
                ya, yb = sorted((s * 0.72, s * 1.28))
                a.box_mm((x - 0.62, ya, 1.12), (x + 0.62, yb, 1.16), "dark_steel")
        for s in (-1, 1):                     # 侧防护栏：第二前桥和第一后桥之间
            for zz in (0.62, 0.92):
                a.box_mm((axles[2] + 0.7, s * 1.2 - 0.03, zz), (axles[1] - 0.7, s * 1.2 + 0.03, zz + 0.08), "mach_yellow")
        self.mesh(a, name + "_Base", R)
        for i, x in enumerate(axles):
            dual = i >= 2
            for s in (-1, 1):
                self.wheel(R, f"{name}_W{i}{'L' if s > 0 else 'R'}", (x, s * (0.95 if dual else 1.03), 0.53), 0.53, 0.32, dual=dual)
        return x0

    # ---------------------------------------------------- 纯电渣土车（换电式 8×4，约 9.65 × 2.55 × 3.6）
    def dump_truck(self, name="M_DumpTruck"):
        R = self.root(name, dict(model="dump_truck"))
        x0 = self.truck_base(R, name)
        hinge = np.array([-4.6, 0, 1.35])
        bd = self.node(name + "_Body", R, hinge, dict(kind="tip", axis="y"))
        a = Acc()
        xb0, xb1 = -4.85, x0 - 1.2
        a.box_mm((xb0, -1.2, 1.35), (xb1, 1.2, 1.5), "truck_gray")                    # 底板
        for s in (-1, 1):
            a.box_mm((xb0, s * 1.2 - (0.06 if s > 0 else 0), 1.5), (xb1, s * 1.2 + (0 if s > 0 else 0.06), 2.95), "truck_gray")
            x = xb0 + 0.4
            while x < xb1:
                a.box_mm((x - 0.05, s * 1.24 - 0.04, 1.5), (x + 0.05, s * 1.24 + 0.04, 2.95), "dark_steel")
                x += 0.8
            a.box_mm((xb0, s * 1.24 - 0.05, 2.85), (xb1, s * 1.24 + 0.05, 2.97), "truck_green")
        a.box_mm((xb1 - 0.08, -1.26, 1.5), (xb1, 1.26, 3.35), "truck_gray")               # 前挡板（高出一截）
        a.box_mm((xb0, -1.2, 1.5), (xb0 + 0.08, 1.2, 2.95), "truck_gray")                 # 后门
        a.box((xb0 - 0.02, -0.9, 1.65), (0.04, 0.25, 0.12), "lamp_red")
        a.box((xb0 - 0.02, 0.9, 1.65), (0.04, 0.25, 0.12), "lamp_red")
        for i in range(3):                                                             # 密闭顶盖（三块）
            xa = xb0 + 0.05 + i * (xb1 - xb0 - 0.1) / 3
            a.box_mm((xa + 0.02, -1.23, 2.97), (xa + (xb1 - xb0 - 0.1) / 3 - 0.02, 1.23, 3.05), "truck_gray")
        a.cyl((xb1 - 0.3, 0, 1.0), (xb1 - 0.5, 0, 1.6), 0.12, "chrome", seg=10)       # 举升油缸
        self.mesh(a, name + "_Body_m", bd)
        a = Acc()
        a.box_mm((xb0 + 0.12, -1.12, 1.5), (xb1 - 0.12, 1.12, 2.55), "dirt")
        a.prism_xz([(xb0 + 0.3, 2.55), (xb1 - 0.3, 2.55), (xb1 - 1.2, 2.9), (xb0 + 1.2, 2.9)], -1.05, 1.05, "dirt")
        self.mesh(a, name + "_Load", bd, dict(kind="load"))
        return R

    # ---------------------------------------------------- 纯电搅拌车（8×4，10 m³）
    def mixer(self, name="M_Mixer"):
        R = self.root(name, dict(model="mixer"))
        x0 = self.truck_base(R, name, L_front=4.95, L_rear=-5.05, axles=(4.0, 2.2, -2.3, -3.65), stripe="truck_green")
        a = Acc()
        # 罐体支架、水箱、进料斗、出料槽、爬梯
        a.box_mm((x0 - 1.45, -0.8, 1.12), (x0 - 1.15, 0.8, 2.3), "dark_steel")
        for s in (-1, 1):
            a.bar((-3.6, s * 0.7, 1.12), (-3.9, s * 0.45, 2.9), 0.18, 0.18, "dark_steel")
        a.prism_xz([(-4.75, 3.75), (-3.95, 3.75), (-4.1, 3.15), (-4.6, 3.15)], -0.6, 0.6, "truck_gray")   # 进料斗
        a.bar((-4.45, 0, 2.85), (-5.3, 0, 2.15), 0.45, 0.12, "truck_gray")                   # 出料槽
        a.bar((-4.2, 0.9, 1.15), (-4.5, 0.9, 3.0), 0.35, 0.04, "dark_steel")                # 爬梯
        self.mesh(a, name + "_Frame", R)
        # 罐：轴线从前下到后上，约 11°
        p0 = np.array([x0 - 1.15, 0, 2.0])
        tilt = math.radians(11)
        d = np.array([-math.cos(tilt), 0, math.sin(tilt)])
        dr = self.node(name + "_Drum", R, p0, dict(kind="drum", axis_vec=[float(v) for v in d]))
        a = Acc()
        prof = [(0.0, 0.35), (0.25, 0.75), (1.1, 1.2), (3.6, 1.2), (4.9, 0.85), (5.5, 0.55)]
        for (s0, r0), (s1, r1) in zip(prof[:-1], prof[1:]):
            a.cyl(p0 + d * s0, p0 + d * s1, r0, "mach_white", seg=24, r1=r1, caps=False)
        a.cyl(p0 - d * 0.05, p0 + d * 0.01, 0.35, "mach_white", seg=24)
        a.cyl(p0 + d * 5.5, p0 + d * 5.65, 0.55, "truck_gray", seg=20, r1=0.45)
        for sx in (1.6, 2.6):      # 两圈色带（看得出罐在转）
            a.cyl(p0 + d * sx, p0 + d * (sx + 0.35), 1.215, "truck_green", seg=24, caps=False)
        for i in range(6):         # 斜条纹：一条螺旋色带拆成几段
            ang = i * math.pi / 3
            s0 = 1.2 + i * 0.35
            n = np.array([0, math.cos(ang), math.sin(ang)])
            q0 = p0 + d * s0 + n * 1.205
            q1 = p0 + d * (s0 + 0.9) + np.array([0, math.cos(ang + 0.9), math.sin(ang + 0.9)]) * 1.205
            a.bar(q0, q1, 0.25, 0.02, "truck_green", up=tuple(n))
        self.mesh(a, name + "_Drum_m", dr)
        return R

    # ---------------------------------------------------- 混凝土泵车（5 节臂，约 43 m）
    def pump_truck(self, name="M_PumpTruck"):
        R = self.root(name, dict(model="pump_truck"))
        x0 = self.truck_base(R, name, L_front=6.1, L_rear=-6.2, axles=(5.1, 3.3, -2.4, -3.8), cab_col="mach_white", stripe="pump_red")
        a = Acc()
        a.box_mm((-6.2, -1.25, 1.1), (x0 - 1.0, 1.25, 1.55), "pump_red")          # 副车架 / 工具箱
        a.box_mm((-6.2, -0.9, 1.55), (-4.6, 0.9, 2.3), "truck_gray")               # 料斗
        a.prism_xz([(-6.3, 2.5), (-4.5, 2.5), (-4.7, 1.9), (-6.1, 1.9)], -1.0, 1.0, "truck_gray")
        a.box_mm((-4.6, -0.4, 1.55), (-1.5, 0.4, 2.0), "dark_steel")               # 泵送缸
        self.mesh(a, name + "_Frame", R)
        # 支腿：前两条向前外摆，后两条向后外摆，原点在根部
        for i, (x, s, fwd) in enumerate(((x0 - 1.2, 1, 1), (x0 - 1.2, -1, 1), (-4.0, 1, -1), (-4.0, -1, -1))):
            lg = self.node(f"{name}_Leg{i}", R, (x, s * 1.1, 1.3), dict(kind="outrigger", axis="z", side=s, fwd=fwd))
            a = Acc()
            a.box_mm((x - fwd * 0.0 - (4.2 if fwd < 0 else 0), s * 1.0 - 0.15, 1.15), (x + (4.2 if fwd > 0 else 0), s * 1.0 + 0.15, 1.45), "pump_red")
            tipx = x + fwd * 4.0
            a.box((tipx, s * 1.0, 0.75), (0.25, 0.25, 0.9), "dark_steel")
            a.box((tipx, s * 1.0, 0.05), (0.6, 0.6, 0.1), "dark_steel")
            self.mesh(a, f"{name}_Leg{i}_m", lg)
        # 转台 + 5 节臂（静止姿态：全部沿 +X 伸直；网页里给每节角度）
        tz = 2.2
        sl = self.node(name + "_Slew", R, (x0 - 0.6, 0, tz), dict(kind="slew", axis="z"))
        a = Acc()
        a.cyl((x0 - 0.6, 0, tz), (x0 - 0.6, 0, tz + 0.6), 0.75, "pump_red", seg=20)
        a.box_mm((x0 - 1.3, -0.55, tz + 0.6), (x0 + 0.1, 0.55, tz + 1.5), "pump_red")
        self.mesh(a, name + "_Slew_m", sl)
        lens = [10.0, 9.0, 9.0, 8.0, 7.0]
        secs = [(0.7, 0.55), (0.6, 0.45), (0.5, 0.38), (0.42, 0.3), (0.34, 0.24)]
        parent, p = sl, np.array([x0 - 0.6, 0, tz + 1.3])
        for j, (L, (h0, w0)) in enumerate(zip(lens, secs)):
            nd = self.node(f"{name}_Arm{j + 1}", parent, p, dict(kind="boom_arm", axis="y", length=L))
            a = Acc()
            a.bar(p, p + (L, 0, 0), w0, h0, "pump_red" if j % 2 == 0 else "mach_white")
            a.cyl(p + (0, -w0 * 0.7, 0), p + (0, w0 * 0.7, 0), h0 * 0.4, "dark_steel", seg=12)
            a.cyl(p + (0.2, 0, h0 / 2 + 0.1), p + (L, 0, h0 / 2 + 0.1), 0.0665, "dark_steel", seg=8)
            if j == len(lens) - 1:
                a.cyl(p + (L, 0, 0), p + (L, 0, -3.0), 0.075, "rubber", seg=10)   # 末端软管（静止姿态下竖直）
            self.mesh(a, f"{name}_Arm{j + 1}_m", nd)
            parent, p = nd, p + np.array([L, 0, 0])
        return R

    # ---------------------------------------------------- 超高压拖泵（地泵）
    def ground_pump(self, name="M_GroundPump"):
        R = self.root(name, dict(model="ground_pump"))
        a = Acc()
        a.box_mm((-3.0, -1.05, 0.65), (3.0, 1.05, 2.25), "mach_yellow")
        a.box_mm((-3.02, -1.07, 1.7), (3.02, 1.07, 1.85), "dark_steel")
        for i in range(6):
            a.box_mm((-2.2 + i * 0.5, 1.05, 0.9), (-2.0 + i * 0.5, 1.08, 1.5), "dark_steel")
        a.prism_xz([(-4.3, 1.55), (-3.0, 1.55), (-3.1, 0.75), (-4.1, 0.75)], -0.75, 0.75, "truck_gray")   # 料斗
        a.bar((3.0, 0, 1.0), (4.6, 0, 0.55), 0.12, 0.12, "dark_steel")                                   # 拖杆
        a.cyl((3.0, 0.6, 1.6), (3.8, 0.6, 1.6), 0.07, "dark_steel", seg=10)                             # 出口管
        for x in (-2.5, 2.5):
            a.box((x, 0, 0.3), (0.3, 1.8, 0.6), "dark_steel")
        self.mesh(a, name + "_m", R)
        for s in (-1, 1):
            self.wheel(R, f"{name}_W{'L' if s > 0 else 'R'}", (-0.6, s * 1.2, 0.45), 0.45, 0.28)
        return R

    # ---------------------------------------------------- 平板半挂（运钢构件）
    def flatbed(self, name="M_Flatbed"):
        R = self.root(name, dict(model="flatbed"))
        a = Acc()
        # 牵引车
        fx = 8.4
        a.box_mm((3.6, -0.48, 0.85), (fx - 0.3, 0.48, 1.15), "dark_steel")
        cab = [(fx - 2.3, 1.1), (fx, 1.1), (fx, 2.2), (fx - 0.15, 3.1), (fx - 0.5, 3.6), (fx - 2.3, 3.6)]
        a.prism_xz(cab, -1.25, 1.25, "blue")
        a.box_mm((fx - 0.2, -1.1, 2.2), (fx - 0.06, 1.1, 3.0), "glass_dark")
        for s in (-1, 1):
            a.box_mm((fx - 1.2, s * 1.25 - 0.01, 2.1), (fx - 0.3, s * 1.25 + 0.01, 2.95), "glass_dark")
            a.box((fx + 0.2, s * 1.42, 2.5), (0.06, 0.12, 0.5), "dark_steel")
            a.box((fx + 0.005, s * 0.9, 1.35), (0.04, 0.35, 0.16), "lamp")
        a.box_mm((fx - 0.05, -1.25, 0.55), (fx + 0.08, 1.25, 1.05), "truck_gray")
        a.box_mm((fx - 3.1, -1.1, 1.15), (fx - 2.35, 1.1, 2.9), "truck_gray")            # 换电电池仓
        a.cyl((4.6, 0, 1.15), (4.6, 0, 1.3), 0.6, "dark_steel", seg=16)                   # 鞍座
        # 挂车：鹅颈 + 平台
        a.box_mm((-8.6, -1.25, 1.3), (3.4, 1.25, 1.5), "truck_gray")
        a.box_mm((3.0, -1.25, 1.5), (5.4, 1.25, 1.85), "truck_gray")
        for s in (-1, 1):
            a.box_mm((-8.6, s * 1.25 - 0.04, 1.2), (5.4, s * 1.25 + 0.04, 1.3), "dark_steel")
        a.box((-8.62, -0.9, 1.25), (0.04, 0.3, 0.12), "lamp_red")
        a.box((-8.62, 0.9, 1.25), (0.04, 0.3, 0.12), "lamp_red")
        self.mesh(a, name + "_m", R)
        for i, x in enumerate((7.3, 5.0, 3.9)):
            for s in (-1, 1):
                self.wheel(R, f"{name}_T{i}{'L' if s > 0 else 'R'}", (x, s * (0.95 if i else 1.03), 0.53), 0.53, 0.32, dual=i > 0)
        for i, x in enumerate((-5.0, -6.3, -7.6)):
            for s in (-1, 1):
                self.wheel(R, f"{name}_A{i}{'L' if s > 0 else 'R'}", (x, s * 0.95, 0.45), 0.45, 0.3, dual=True)
        # 货：两根钢管柱 + 一捆 H 型钢（卸货后隐藏）
        cg = self.node(name + "_Cargo", R, (0, 0, 1.5), dict(kind="cargo"))
        a = Acc()
        for x in (-6.5, -1.5, 2.0):
            a.box((x, 0, 1.6), (0.25, 2.4, 0.2), "timber")
        for y in (-0.6, 0.6):
            a.cyl((-7.8, y, 2.25), (2.6, y, 2.25), 0.55, "steel_tube", seg=20)
        self.mesh(a, name + "_Cargo_m", cg)
        return R

    # ---------------------------------------------------- 履带底座 + 上车（成槽机 / 旋挖钻 / 履带吊共用）
    def crawler_upper(self, R, name, L=6.0, contact=5.0, gauge=4.2, shoe=0.8, W=3.4, tail=4.2, front=2.6, col="mach_yellow"):
        a = Acc()
        for s in (-1, 1):
            yc = s * gauge / 2
            self.track(a, L, contact, 1.15, yc - shoe / 2, yc + shoe / 2)
        a.box_mm((-1.5, -gauge / 2 + 0.3, 0.5), (1.5, gauge / 2 - 0.3, 1.15), "dark_steel")
        a.cyl((0, 0, 1.15), (0, 0, 1.35), 1.2, "dark_steel", seg=24)
        self.mesh(a, name + "_Under", R)
        sl = self.node(name + "_Slew", R, (0, 0, 1.35), dict(kind="slew", axis="z"))
        a = Acc()
        a.box_mm((-tail, -W / 2, 1.35), (front, W / 2, 1.55), "dark_steel")
        a.box_mm((-tail, -W / 2, 1.55), (-0.6, W / 2, 3.0), col)
        a.box_mm((-tail - 0.05, -W / 2 + 0.1, 1.6), (-tail + 0.9, W / 2 - 0.1, 3.3), "concrete_dark")   # 配重
        cab = [(-0.4, 1.55), (front, 1.55), (front, 2.5), (front - 0.15, 3.45), (-0.3, 3.45)]
        a.prism_xz(cab, W / 2 - 1.05, W / 2, col)
        a.box_mm((front + 0.005, W / 2 - 0.95, 2.5), (front + 0.03, W / 2 - 0.1, 3.3), "glass_dark")
        a.box_mm((-0.2, W / 2, 2.1), (front - 0.3, W / 2 + 0.02, 3.3), "glass_dark")
        self.mesh(a, name + "_Body", sl)
        return sl

    # ---------------------------------------------------- 液压抓斗成槽机
    def grab(self, name="M_Grab"):
        R = self.root(name, dict(model="grab"))
        sl = self.crawler_upper(R, name, L=6.0, contact=5.0, gauge=4.2, shoe=0.8, W=3.4, tail=4.0, front=2.4)
        a = Acc()
        foot = np.array([1.8, 0, 2.0])
        top = foot + np.array([4.0, 0, 15.0])
        for s in (-1, 1):   # 箱形主臂（两片）+ 横撑
            a.bar(foot + (0, s * 0.45, 0), top + (0, s * 0.45, 0), 0.25, 0.55, "mach_yellow", up=(1, 0, 0))
        for t in np.linspace(0.1, 0.95, 6):
            p = foot + (top - foot) * t
            a.bar(p + (0, -0.45, 0), p + (0, 0.45, 0), 0.15, 0.15, "mach_yellow")
        a.box(top + (0.3, 0, 0.3), (0.9, 1.1, 0.7), "dark_steel")       # 顶部滑轮组
        for s in (-1, 1):   # 变幅油缸
            a.cyl(np.array([-0.4, s * 0.8, 2.2]), foot + (top - foot) * 0.35 + (0, s * 0.8, 0), 0.13, "chrome", seg=10)
        self.mesh(a, name + "_Boom_m", sl)
        g = self.node(name + "_Grabber", R, top + np.array([0.3, 0, -3.0]), dict(kind="grab"))
        a = Acc()
        gx, gz = top[0] + 0.3, top[2] - 3.0
        a.box((gx, 0, gz - 3.2), (0.8, 2.8, 5.8), "mach_yellow")           # 斗体：宽 2.8 m（一幅槽长），厚 0.8 m（墙厚）
        for s in (-1, 1):
            a.prism_xz([(gx - 0.45, gz - 6.1), (gx + 0.45, gz - 6.1), (gx + 0.2, gz - 7.0), (gx - 0.2, gz - 7.0)], s * 0.1, s * 1.35, "dark_steel")
        a.cyl((gx, 0, gz), (gx, 0, gz - 0.3), 0.3, "dark_steel", seg=10)
        self.mesh(a, name + "_Grabber_m", g)
        R["sheave"] = list(map(float, top + np.array([0.3, 0, 0.0])))
        return R

    # ---------------------------------------------------- 旋挖钻机
    def rig(self, name="M_Rig"):
        R = self.root(name, dict(model="rig"))
        sl = self.crawler_upper(R, name, L=5.6, contact=4.7, gauge=3.9, shoe=0.8, W=3.3, tail=3.8, front=2.2)
        a = Acc()
        mx = 4.4
        a.box_mm((mx - 0.4, -0.4, 1.0), (mx + 0.4, 0.4, 25.0), "mach_yellow")            # 桅杆
        a.box_mm((mx - 0.6, -0.6, 25.0), (mx + 0.6, 0.6, 25.8), "dark_steel")            # 顶部滑轮
        a.bar((1.8, 0.0, 2.6), (mx - 0.4, 0.0, 6.5), 0.5, 0.5, "mach_yellow")             # 变幅三角架
        a.bar((1.8, 0.0, 2.6), (mx - 0.4, 0.0, 2.2), 0.5, 0.5, "mach_yellow")
        a.cyl((0.8, 0, 2.9), (mx - 0.4, 0, 12.0), 0.13, "chrome", seg=10)                # 桅杆油缸
        a.box_mm((mx + 0.4, -0.8, 7.0), (mx + 1.3, 0.8, 8.4), "dark_steel")               # 动力头
        self.mesh(a, name + "_Mast_m", sl)
        k = self.node(name + "_Kelly", R, (mx + 0.85, 0, 2.0), dict(kind="kelly"))
        a = Acc()
        a.box_mm((mx + 0.65, -0.2, 2.0), (mx + 1.05, 0.2, 18.0), "dark_steel")
        a.cyl((mx + 0.85, 0, 0.2), (mx + 0.85, 0, 2.0), 0.6, "truck_gray", seg=20)       # 钻斗 Ø1.2
        self.mesh(a, name + "_Kelly_m", k)
        return R

    # ---------------------------------------------------- 履带吊（约 150 t，桁架臂 42 m）
    def crawler_crane(self, name="M_CrawlerCrane"):
        R = self.root(name, dict(model="crawler_crane"))
        sl = self.crawler_upper(R, name, L=7.6, contact=6.5, gauge=5.4, shoe=1.0, W=3.4, tail=5.0, front=2.6, col="mach_white")
        a = Acc()
        a.box_mm((-5.3, -1.6, 3.3), (-3.6, 1.6, 4.9), "concrete_dark")                  # 加高配重
        for s in (-1, 1):
            a.bar((-1.6, s * 1.2, 3.0), (-3.0, s * 0.3, 7.5), 0.18, 0.18, "mach_white")   # 人字架
            a.bar((0.2, s * 1.2, 3.0), (-3.0, s * 0.3, 7.5), 0.18, 0.18, "mach_white")
        self.mesh(a, name + "_Gantry", sl)
        foot = np.array([1.8, 0, 2.2])
        bn = self.node(name + "_Boom", sl, foot, dict(kind="boom", axis="y", length=42.0))
        a = Acc()
        L, w0, w1 = 42.0, 1.8, 1.0
        nseg = 14
        for i in range(nseg):
            t0, t1 = i / nseg, (i + 1) / nseg
            def P(t, sy, sz):
                w = w0 + (w1 - w0) * t
                return foot + np.array([L * t, sy * w / 2, sz * w / 2])
            for sy in (-1, 1):
                for sz in (-1, 1):
                    a.bar(P(t0, sy, sz), P(t1, sy, sz), 0.12, 0.12, "mach_white")
            for sy in (-1, 1):
                a.bar(P(t0, sy, -1), P(t1, sy, 1), 0.06, 0.06, "red_white" if i % 2 else "mach_white")
            for sz in (-1, 1):
                a.bar(P(t0, -1, sz), P(t1, 1, sz), 0.06, 0.06, "mach_white")
        a.box(foot + np.array([L + 0.4, 0, 0]), (1.0, 1.0, 1.0), "dark_steel")
        self.mesh(a, name + "_Boom_m", bn)
        self.hook(R, name + "_Hook", (0, 0, 6), scale=0.8)
        R["boom_tip"] = [float(L + 0.8), 0.0, 0.0]
        return R

    def hook(self, parent, name, c, scale=1.0):
        n = self.node(name, parent, c, dict(kind="hook"))
        a = Acc()
        cx, cy, cz = c
        s = scale
        a.box((cx, cy, cz - 0.5 * s), (1.0 * s, 0.5 * s, 1.0 * s), "crane_yellow")
        for y in (-0.15, 0.15):
            a.cyl((cx, cy + y * s - 0.04, cz - 0.3 * s), (cx, cy + y * s + 0.04, cz - 0.3 * s), 0.38 * s, "dark_steel", seg=14)
        a.bar((cx, cy, cz - 1.0 * s), (cx, cy, cz - 1.45 * s), 0.14 * s, 0.14 * s, "dark_steel")
        a.prism_xz([(cx + x * s, cz + z * s) for x, z in [(-0.08, -1.45), (0.08, -1.45), (0.1, -1.75), (0.32, -1.85), (0.3, -1.6), (0.42, -1.6), (0.38, -1.98), (0.0, -2.05), (-0.12, -1.9)]], cy - 0.07 * s, cy + 0.07 * s, "dark_steel")
        self.mesh(a, name + "_m", n)
        return n

    # ---------------------------------------------------- 动臂塔吊（内爬、和造楼机一体化顶升）
    def tc_mast(self, name="M_TCMast", w=2.2, h=3.0):
        """一节标准节：网页里按高度一节节叠。原点在这节的底面中心。"""
        R = self.root(name, dict(model="tc_mast", height=h, width=w))
        a = Acc()
        c = w / 2 - 0.09
        P = [(sx * c, sy * c) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        for x, y in P:
            a.box((x, y, h / 2), (0.18, 0.18, h), "crane_yellow")
        for i in range(4):
            (x0, y0), (x1, y1) = P[i], P[(i + 1) % 4]
            for z in (0.1, h - 0.1):
                a.bar((x0, y0, z), (x1, y1, z), 0.1, 0.1, "crane_yellow")
            a.bar((x0, y0, 0.15), (x1, y1, h - 0.15), 0.08, 0.08, "crane_yellow")
        for y in (-0.25, 0.25):                                  # 内部爬梯
            a.box((c - 0.2, y, h / 2), (0.04, 0.04, h), "dark_steel")
        for k in range(10):
            a.box((c - 0.2, 0, 0.15 + k * 0.3), (0.03, 0.5, 0.03), "dark_steel")
        self.mesh(a, name + "_m", R)
        return R

    def tc_collar(self, name="M_TCCollar", w=2.2):
        """爬升框 / 附着框：套在标准节外面，固定到造楼机的钢平台上。"""
        R = self.root(name, dict(model="tc_collar"))
        a = Acc()
        o = w / 2 + 0.35
        for k in range(4):
            x0, y0 = [(-o, -o), (o, -o), (o, o), (-o, o)][k]
            x1, y1 = [(-o, -o), (o, -o), (o, o), (-o, o)][(k + 1) % 4]
            a.bar((x0, y0, 0), (x1, y1, 0), 0.35, 0.5, "dark_steel")
        for s in (-1, 1):
            a.bar((s * o, 0, 0), (s * (o + 1.6), 0, 0), 0.3, 0.4, "dark_steel")
            a.bar((0, s * o, 0), (0, s * (o + 1.6), 0), 0.3, 0.4, "dark_steel")
        self.mesh(a, name + "_m", R)
        return R

    def tower_crane(self, name="M_TowerCrane", L=55.0):
        """塔顶部分：原点在回转支承下面（标准节最上面）。动臂静止时水平，网页里给仰角。"""
        R = self.root(name, dict(model="tower_crane", jib=L))
        a = Acc()
        a.cyl((0, 0, 0), (0, 0, 0.45), 1.35, "dark_steel", seg=24)
        self.mesh(a, name + "_Seat", R)
        sl = self.node(name + "_Slew", R, (0, 0, 0.45), dict(kind="slew", axis="z"))
        a = Acc()
        a.cyl((0, 0, 0.45), (0, 0, 0.95), 1.45, "crane_yellow", seg=24)
        a.box_mm((-6.8, -1.6, 0.95), (2.6, 1.6, 1.3), "crane_yellow")                 # 回转平台
        # 平衡臂（两片桁架）+ 配重 + 起升 / 变幅卷扬 + 电控柜
        for s in (-1, 1):
            y = s * 1.3
            a.bar((-2.0, y, 1.3), (-16.5, y, 1.3), 0.16, 0.2, "crane_yellow")
            a.bar((-2.0, y, 2.7), (-16.5, y, 2.7), 0.14, 0.14, "crane_yellow")
            x = -2.0
            while x > -16.4:
                a.bar((x, y, 1.3), (x, y, 2.7), 0.08, 0.08, "crane_yellow")
                a.bar((x, y, 1.3), (x - 2.0, y, 2.7), 0.06, 0.06, "crane_yellow")
                x -= 2.0
            a.bar((-2.0, s * 1.45, 2.4), (-16.5, s * 1.45, 2.4), 0.04, 0.04, "red_white")   # 栏杆
        a.box_mm((-16.5, -1.3, 1.2), (-2.0, 1.3, 1.3), "grating")
        for i in range(4):
            x = -16.3 + i * 0.6
            a.box_mm((x, -1.25, 1.3), (x + 0.55, 1.25, 4.2), "concrete_dark")
        a.cyl((-9.0, -0.8, 2.0), (-9.0, 0.8, 2.0), 0.6, "dark_steel", seg=16)          # 起升卷筒
        a.box((-9.0, 1.15, 2.0), (0.9, 0.6, 0.9), "crane_yellow")
        a.cyl((-6.0, -0.9, 2.1), (-6.0, 0.9, 2.1), 0.75, "dark_steel", seg=16)         # 变幅卷筒
        a.box((-6.0, 1.25, 2.1), (1.0, 0.6, 1.0), "crane_yellow")
        a.box_mm((-12.0, -1.2, 1.3), (-10.5, 1.2, 3.4), "mach_white")                  # 电控房
        # 人字架
        apex = np.array([-1.8, 0, 12.5])
        for s in (-1, 1):
            a.bar((1.2, s * 1.3, 1.3), apex + (0, s * 0.35, 0), 0.32, 0.32, "crane_yellow")
            a.bar((-7.0, s * 1.3, 1.3), apex + (0, s * 0.35, 0), 0.22, 0.22, "crane_yellow")
        a.box(apex + (0, 0, 0.4), (1.1, 1.4, 0.9), "crane_yellow")
        a.box(apex + (0, 0, 0.95), (0.25, 0.25, 0.2), "lamp_red")
        # 司机室（右前，2.28 × 1.41 × 2.18）
        cab = [(0.6, 1.0), (2.88, 1.0), (2.95, 2.6), (2.7, 3.18), (0.6, 3.18)]
        a.prism_xz(cab, -2.36 - 0.7, -2.36 + 0.7, "mach_white")
        a.box_mm((2.9, -3.0, 1.8), (2.97, -1.72, 2.95), "glass_dark")
        a.box_mm((0.9, -3.08, 1.8), (2.6, -3.06, 2.95), "glass_dark")
        a.box_mm((0.4, -3.1, 0.95), (3.1, -1.6, 1.0), "grating")
        self.mesh(a, name + "_Body", sl)
        # 动臂（桁架，根部 1.8 × 1.8 收到端部 1.0 × 0.9）
        heel = np.array([2.2, 0, 1.6])
        jb = self.node(name + "_Jib", sl, heel, dict(kind="jib", axis="y", length=L))
        a = Acc()
        n = int(L / 2.5)
        def P(t, sy, sz):
            w = 1.8 + (1.0 - 1.8) * t
            hh = 1.8 + (0.9 - 1.8) * t
            return heel + np.array([L * t, sy * w / 2, sz * hh / 2])
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            for sy in (-1, 1):
                for sz in (-1, 1):
                    a.bar(P(t0, sy, sz), P(t1, sy, sz), 0.13, 0.13, "crane_yellow")
            for sy in (-1, 1):
                a.bar(P(t0, sy, -1) if i % 2 == 0 else P(t0, sy, 1), P(t1, sy, 1) if i % 2 == 0 else P(t1, sy, -1), 0.07, 0.07, "crane_yellow")
            for sz in (-1, 1):
                a.bar(P(t0, -1, sz) if i % 2 == 0 else P(t0, 1, sz), P(t1, 1, sz) if i % 2 == 0 else P(t1, -1, sz), 0.07, 0.07, "crane_yellow")
        a.box(heel + np.array([L + 0.3, 0, 0]), (1.0, 1.0, 1.1), "crane_yellow")        # 臂头滑轮
        a.cyl(heel + np.array([L + 0.5, -0.35, -0.3]), heel + np.array([L + 0.5, 0.35, -0.3]), 0.45, "dark_steel", seg=14)
        a.box(heel + np.array([L + 0.3, 0, 0.65]), (0.2, 0.2, 0.2), "lamp_red")
        a.cyl(heel + (0, -1.1, 0), heel + (0, 1.1, 0), 0.2, "dark_steel", seg=12)
        self.mesh(a, name + "_Jib_m", jb)
        self.hook(R, name + "_Hook", (0, 0, -6.0), scale=1.0)
        R["apex"] = list(map(float, apex))
        R["heel"] = list(map(float, heel))
        R["tip"] = [float(heel[0] + L + 0.5), 0.0, float(heel[2] - 0.3)]
        return R

    # ---------------------------------------------------- 施工升降机 SC200/200
    def hoist_parts(self):
        # 标准节 650 × 650 × 1508，主弦 Ø76
        R = self.root("M_HoistMast", dict(model="hoist_mast", height=1.508))
        a = Acc()
        c, h = 0.29, 1.508
        P = [(-c, -c), (c, -c), (c, c), (-c, c)]
        for x, y in P:
            a.cyl((x, y, 0), (x, y, h), 0.038, "truck_gray", seg=10, caps=False)
        for i in range(4):
            (x0, y0), (x1, y1) = P[i], P[(i + 1) % 4]
            for z in (0.06, h - 0.06):
                a.bar((x0, y0, z), (x1, y1, z), 0.035, 0.035, "truck_gray")
            a.bar((x0, y0, 0.08), (x1, y1, h - 0.08), 0.03, 0.03, "truck_gray")
        for s in (-1, 1):
            a.box((0, s * 0.36, h / 2), (0.06, 0.05, h), "dark_steel")                 # 齿条（两侧各一根，对着两个吊笼）
        self.mesh(a, "M_HoistMast_m", R)
        # 吊笼：长 3.2（垂直于楼面，+X 是进楼的门）× 宽 1.5 × 高 2.5；靠标准节的一边是 -Y
        R = self.root("M_HoistCage", dict(model="hoist_cage"))
        a, mesh = Acc(), Acc()
        L, W, H = 3.2, 1.5, 2.5
        x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
        for x in (x0, x1):
            for y in (y0, y1):
                a.box((x, y, H / 2 + 0.1), (0.08, 0.08, H), "blue")
        for z in (0.1, H + 0.1):
            for (p, q) in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
                a.bar((p[0], p[1], z), (q[0], q[1], z), 0.08, 0.08, "blue")
        a.box_mm((x0, y0, 0.0), (x1, y1, 0.12), "truck_gray")                             # 底板
        a.box_mm((x0, y0, H + 0.1), (x1, y1, H + 0.16), "truck_gray")                     # 顶板
        mesh.box_mm((x0, y1 - 0.01, 0.12), (x1, y1 + 0.01, H + 0.1), "hoist_mesh")      # 外侧网
        mesh.box_mm((x0, y0 - 0.01, 0.12), (x1, y0 + 0.01, H + 0.1), "hoist_mesh")      # 靠标准节一侧网
        for x in (x0, x1):                                                              # 两端门：下半实板、上半网
            a.box_mm((x - 0.02, y0 + 0.05, 0.12), (x + 0.02, y1 - 0.05, 1.1), "blue")
            mesh.box_mm((x - 0.01, y0 + 0.05, 1.1), (x + 0.01, y1 - 0.05, H + 0.1), "hoist_mesh")
        for z in (0.55, 1.1):                                                           # 顶上护栏
            for (p, q) in (((x0, y1), (x1, y1)), ((x0, y0), (x0, y1)), ((x1, y0), (x1, y1))):
                a.bar((p[0], p[1], H + 0.16 + z), (q[0], q[1], H + 0.16 + z), 0.04, 0.04, "mach_yellow")
        for x, y in ((x0, y1), (x1, y1), (x0, y0), (x1, y0)):
            a.box((x, y, H + 0.16 + 0.55), (0.04, 0.04, 1.1), "mach_yellow")
        for i, x in enumerate((-0.7, 0.0, 0.7)):                                        # 驱动：三台电机 + 减速机
            a.cyl((x, y0 + 0.35, H + 0.16), (x, y0 + 0.35, H + 0.75), 0.17, "blue", seg=12)
            a.box((x, y0 + 0.12, H - 0.1), (0.3, 0.24, 0.5), "dark_steel")
        a.box_mm((-1.0, y0 - 0.32, 0.4), (1.0, y0 - 0.02, H), "dark_steel")              # 导向滚轮架
        self.mesh(a, "M_HoistCage_m", R)
        self.mesh(mesh, "M_HoistCage_mesh", R)
        # 底笼围栏 3.6 × 4.6 × 2.0
        R = self.root("M_HoistBase", dict(model="hoist_base"))
        a, mesh = Acc(), Acc()
        X, Y, H = 1.8, 2.3, 2.0
        a.box_mm((-X, -Y, 0), (X, Y, 0.15), "concrete")
        for x in (-X, X):
            for y in (-Y, 0, Y):
                a.box((x, y, H / 2), (0.08, 0.08, H), "blue")
        for x in (-X, X):
            a.bar((x, -Y, H), (x, Y, H), 0.08, 0.08, "blue")
        for y in (-Y, Y):
            a.bar((-X, y, H), (X, y, H), 0.08, 0.08, "blue")
            mesh.box_mm((-X, y - 0.01, 0.15), (X, y + 0.01, H), "hoist_mesh")
        mesh.box_mm((-X - 0.01, -Y, 0.15), (-X + 0.01, Y, H), "hoist_mesh")            # 外端（-X）是进人的门，用网
        for y in (-1.1, 1.1):
            a.cyl((0, y, 0.15), (0, y, 0.75), 0.18, "mach_yellow", seg=12)              # 缓冲弹簧
        self.mesh(a, "M_HoistBase_m", R)
        self.mesh(mesh, "M_HoistBase_mesh", R)
        # 附墙架：从标准节伸到楼板边
        R = self.root("M_HoistTie", dict(model="hoist_tie"))
        a = Acc()
        for s in (-1, 1):
            a.bar((0.33, s * 0.3, 0), (2.4, s * 0.45, 0), 0.1, 0.1, "truck_gray")
            a.bar((0.33, s * 0.3, 0.5), (2.4, s * 0.45, 0), 0.06, 0.06, "truck_gray")
            a.box((2.45, s * 0.45, 0), (0.1, 0.35, 0.5), "dark_steel")
        a.bar((1.2, -0.38, 0), (1.2, 0.38, 0), 0.08, 0.08, "truck_gray")
        self.mesh(a, "M_HoistTie_m", R)

    # ---------------------------------------------------- 小车：SUV、皮卡
    def car(self, name="M_SUV", pickup=False):
        R = self.root(name, dict(model="pickup" if pickup else "suv"))
        a = Acc()
        if not pickup:
            L2, W2 = 2.32, 0.93
            prof = [(-2.32, 0.35), (2.3, 0.35), (2.33, 0.75), (2.2, 0.98), (0.9, 1.08), (0.15, 1.62), (-1.65, 1.68), (-2.25, 1.3), (-2.33, 0.85)]
            a.prism_xz(prof, -W2, W2, "car_paint")
            a.bar((0.93, 0, 1.11), (0.17, 0, 1.63), 1.72, 0.02, "glass_dark", up=(0.57, 0, 0.82))
            a.bar((-1.68, 0, 1.66), (-2.27, 0, 1.3), 1.6, 0.02, "glass_dark", up=(-0.52, 0, 0.85))
            for s in (-1, 1):
                a.box_mm((-1.95, s * W2 - 0.012, 1.12), (0.62, s * W2 + 0.012, 1.55), "glass_dark")
            xa = (1.42, -1.42)
        else:
            L2, W2 = 2.65, 0.95
            prof = [(-0.4, 0.4), (2.62, 0.4), (2.65, 0.8), (2.5, 1.02), (1.25, 1.1), (0.55, 1.78), (-0.75, 1.8), (-0.85, 1.05), (-0.4, 1.05)]
            a.prism_xz(prof, -W2, W2, "car_paint")
            a.box_mm((-2.65, -W2, 0.45), (-0.4, W2, 0.75), "car_paint")                  # 货箱底
            for s in (-1, 1):
                a.box_mm((-2.65, s * W2 - (0.06 if s > 0 else 0), 0.75), (-0.82, s * W2 + (0 if s > 0 else 0.06), 1.1), "car_paint")
                a.box_mm((-0.55, s * W2 - 0.012, 1.15), (0.95, s * W2 + 0.012, 1.68), "glass_dark")
            a.box_mm((-2.65, -W2, 0.75), (-2.59, W2, 1.1), "car_paint")
            a.bar((1.28, 0, 1.12), (0.57, 0, 1.75), 1.75, 0.02, "glass_dark", up=(0.66, 0, 0.75))
            a.box_mm((-0.9, -0.85, 1.25), (-0.86, 0.85, 1.7), "glass_dark")
            xa = (1.75, -1.6)
        for s in (-1, 1):
            a.box((L2 + 0.01, s * (W2 - 0.25), 0.82), (0.04, 0.32, 0.1), "lamp")
            a.box((-L2 - 0.01, s * (W2 - 0.2), 0.95), (0.04, 0.25, 0.12), "lamp_red")
        a.box_mm((L2 - 0.05, -W2 + 0.05, 0.3), (L2 + 0.05, W2 - 0.05, 0.55), "dark_steel")
        self.mesh(a, name + "_m", R)
        for i, x in enumerate(xa):
            for s in (-1, 1):
                self.wheel(R, f"{name}_W{i}{'L' if s > 0 else 'R'}", (x, s * (W2 - 0.13), 0.36), 0.36, 0.24)
        return R

    # ---------------------------------------------------- 工人（1.72 m，朝 +X）
    def worker(self, name="M_Worker"):
        R = self.root(name, dict(model="worker"))
        a = Acc()
        a.box_mm((-0.1, -0.17, 0.86), (0.1, 0.17, 1.0), "workwear")                 # 胯
        a.box_mm((-0.11, -0.19, 1.0), (0.11, 0.19, 1.45), "workwear")               # 上身
        a.box_mm((-0.125, -0.2, 1.02), (0.125, 0.2, 1.42), "vest")                  # 反光背心
        for z in (1.13, 1.27):
            a.box_mm((-0.128, -0.202, z), (0.128, 0.202, z + 0.035), "reflect")
        for s in (-1, 1):
            a.box_mm((-0.128, s * 0.1 - 0.02, 1.27), (0.128, s * 0.1 + 0.02, 1.42), "reflect")
        a.cyl((0, 0, 1.45), (0, 0, 1.52), 0.05, "skin", seg=8)
        a.cyl((0, 0, 1.52), (0, 0, 1.7), 0.1, "skin", seg=10)
        a.cyl((0, 0, 1.7), (0, 0, 1.73), 0.1, "skin", seg=10, r1=0.07)
        self.mesh(a, name + "_Body", R, dict(part="body"))
        a = Acc()
        a.cyl((0, 0, 1.655), (0, 0, 1.672), 0.15, "helmet", seg=14)
        a.cyl((0, 0, 1.672), (0, 0, 1.79), 0.128, "helmet", seg=14, r1=0.07)
        a.box((0.14, 0, 1.665), (0.08, 0.16, 0.015), "helmet")
        self.mesh(a, name + "_Helmet", R, dict(part="helmet"))
        for s, nm in ((1, "L"), (-1, "R")):
            sh = self.node(f"{name}_Arm{nm}", R, (0, s * 0.235, 1.42), dict(kind="arm", axis="y", part="arm"))
            a = Acc()
            a.bar((0, s * 0.235, 1.43), (0.03, s * 0.25, 0.88), 0.085, 0.085, "workwear")
            a.box((0.035, s * 0.25, 0.84), (0.07, 0.06, 0.09), "skin")
            self.mesh(a, f"{name}_Arm{nm}_m", sh)
            hp = self.node(f"{name}_Leg{nm}", R, (0, s * 0.095, 0.9), dict(kind="leg", axis="y", part="leg"))
            a = Acc()
            a.bar((0, s * 0.095, 0.92), (0, s * 0.095, 0.09), 0.13, 0.13, "workwear")
            a.box_mm((-0.06, s * 0.095 - 0.065, 0.0), (0.17, s * 0.095 + 0.065, 0.11), "boots")
            self.mesh(a, f"{name}_Leg{nm}_m", hp)
        return R

    # ---------------------------------------------------- 临建、道具
    def props(self):
        out = {}
        # 项目部板房：两层，每层 8 个箱（2.44 宽 × 6.06 深 × 2.9 高），走廊朝 +Y
        R = self.root("P_Office", dict(model="office"))
        a = Acc()
        n, cw, cd, ch = 8, 2.44, 6.06, 2.9
        X0 = -n * cw / 2
        for f in range(2):
            z0 = f * ch
            for i in range(n):
                x = X0 + i * cw
                a.box_mm((x + 0.02, -cd / 2, z0), (x + cw - 0.02, cd / 2, z0 + ch - 0.02), "mach_white")
                a.box_mm((x, -cd / 2 - 0.02, z0 + ch - 0.18), (x + cw, cd / 2 + 0.02, z0 + ch), "roof_blue")
                a.box_mm((x, -cd / 2 - 0.02, z0), (x + cw, cd / 2 + 0.02, z0 + 0.15), "roof_blue")
                a.box_mm((x + 0.3, cd / 2, z0 + 0.95), (x + 1.4, cd / 2 + 0.03, z0 + 2.1), "glass_dark")
                a.box_mm((x + 1.6, cd / 2, z0 + 0.15), (x + 2.2, cd / 2 + 0.03, z0 + 2.15), "blue")
                a.box_mm((x + 0.5, -cd / 2 - 0.03, z0 + 1.2), (x + 1.9, -cd / 2, z0 + 2.1), "glass_dark")
        a.box_mm((X0, cd / 2, ch - 0.1), (-X0, cd / 2 + 1.4, ch + 0.05), "grating")       # 二层走廊
        for z in (ch + 0.55, ch + 1.1):
            a.bar((X0, cd / 2 + 1.38, z), (-X0, cd / 2 + 1.38, z), 0.05, 0.05, "roof_blue")
        x = X0
        while x <= -X0 + 0.01:
            a.box((x, cd / 2 + 1.38, ch * 0.5 + 0.55), (0.08, 0.08, ch + 1.1), "roof_blue")
            x += cw
        for k in range(16):                                                              # 端头楼梯
            a.box((-X0 + 0.7, cd / 2 + 1.2 - k * 0.28, 0.09 + k * 0.18), (1.1, 0.3, 0.05), "grating")
        a.bar((-X0 + 1.25, cd / 2 + 1.2, 1.0), (-X0 + 1.25, cd / 2 + 1.2 - 15 * 0.28, 1.0 + 15 * 0.18), 0.05, 0.05, "roof_blue")
        self.mesh(a, "P_Office_m", R)
        # 门卫室
        R = self.root("P_Guard", dict(model="guard"))
        a = Acc()
        a.box_mm((-1.5, -1.2, 0), (1.5, 1.2, 2.6), "mach_white")
        a.box_mm((-1.6, -1.3, 2.6), (1.6, 1.3, 2.75), "roof_blue")
        a.box_mm((-1.1, -1.21, 1.0), (1.1, -1.18, 2.0), "glass_dark")
        a.box_mm((1.5, -0.7, 1.0), (1.53, 0.7, 2.0), "glass_dark")
        self.mesh(a, "P_Guard_m", R)
        # 钢筋加工棚：跨度 8（x 向）× 长 30（y 向），檐高 5、脊高 6
        R = self.root("P_Shed", dict(model="shed"))
        a = Acc()
        for y in np.arange(-15, 15.01, 5):
            for s in (-1, 1):
                a.box((s * 4, y, 2.5), (0.3, 0.3, 5.0), "roof_blue")
                a.bar((s * 4, y, 5.0), (0, y, 6.0), 0.25, 0.4, "roof_blue")
        a.prism_xz([(-4.4, 4.95), (0, 6.05), (4.4, 4.95), (4.4, 5.08), (0, 6.18), (-4.4, 5.08)], -15.3, 15.3, "roof_blue")
        for x in (-2.5, 0.5):
            a.box((x, -6, 0.45), (1.2, 2.2, 0.9), "mach_white")       # 弯曲机 / 切断机
            a.box((x, 6, 0.45), (1.2, 2.2, 0.9), "mach_white")
        for i in range(5):
            a.box((2.7, -2.0, 0.18 + i * 0.3), (0.9, 12.0, 0.3), "rebar")
        a.box_mm((-4.3, -15.3, 0), (4.3, 15.3, 0.05), "concrete")
        self.mesh(a, "P_Shed_m", R)
        # 灯塔
        R = self.root("P_Light", dict(model="light"))
        a = Acc()
        a.box((0, 0, 0.15), (1.2, 1.2, 0.3), "concrete")
        a.cyl((0, 0, 0.3), (0, 0, 22.0), 0.22, "truck_gray", seg=12, r1=0.12)
        a.box((0.3, 0, 22.4), (0.25, 2.6, 1.2), "dark_steel")
        for y in (-0.9, 0, 0.9):
            for z in (22.1, 22.7):
                a.box((0.45, y, z), (0.08, 0.7, 0.45), "lamp")
        self.mesh(a, "P_Light_m", R)
        # 洗车台（大门口）
        R = self.root("P_Wash", dict(model="wash"))
        a = Acc()
        a.box_mm((-5, -2.4, -0.05), (5, 2.4, 0.08), "concrete")
        a.box_mm((-3.5, -1.4, 0.06), (3.5, 1.4, 0.1), "dark_steel")
        for x in (-2.5, 2.5):
            for s in (-1, 1):
                a.cyl((x, s * 2.1, 0.08), (x, s * 2.1, 1.6), 0.05, "white", seg=8)
            a.bar((x, -2.1, 1.6), (x, 2.1, 1.6), 0.08, 0.08, "white")
        a.box_mm((5.2, -2.4, -0.05), (7.2, 2.4, 0.6), "concrete_dark")                   # 沉淀池
        self.mesh(a, "P_Wash_m", R)
        # 五牌一图
        R = self.root("P_Board", dict(model="board"))
        a = Acc()
        for i in range(6):
            x = -4.5 + i * 1.8
            a.box_mm((x - 0.75, -0.05, 0.9), (x + 0.75, 0.05, 3.0), "mach_white")
            a.box_mm((x - 0.75, -0.06, 2.7), (x + 0.75, 0.06, 3.0), "blue")
        a.box_mm((-5.5, -0.3, 3.0), (5.5, 0.3, 3.15), "roof_blue")
        for x in (-5.4, 5.4):
            a.box((x, 0, 1.55), (0.12, 0.12, 3.1), "truck_gray")
        self.mesh(a, "P_Board_m", R)
        # 充电站（电动渣土车、搅拌车、挖机充电）
        R = self.root("P_Charger", dict(model="charger"))
        a = Acc()
        a.box_mm((-6, -3, -0.05), (6, 3, 0.1), "concrete")
        for x in (-6, 6):
            for y in (-2.8, 2.8):
                a.box((x, y, 2.6), (0.2, 0.2, 5.2), "truck_gray")
        a.box_mm((-6.3, -3.2, 5.2), (6.3, 3.2, 5.45), "mach_white")
        for x in (-3, 0, 3):
            a.box((x, 0, 0.95), (0.6, 0.4, 1.8), "mach_white")
            a.box_mm((x - 0.31, -0.21, 1.2), (x + 0.31, 0.21, 1.35), "truck_green")
            a.cyl((x + 0.3, 0.2, 1.5), (x + 0.6, 0.6, 0.3), 0.03, "black", seg=6)
        self.mesh(a, "P_Charger_m", R)
        # 钢构件堆场：H 型钢两层、垫木
        R = self.root("P_SteelStack", dict(model="steel_stack"))
        a = Acc()
        for x in (-3.5, 0, 3.5):
            a.box((x, 0, 0.1), (0.25, 3.4, 0.2), "timber")
        for layer in range(2):
            for i in range(4):
                y = -1.2 + i * 0.8
                z = 0.2 + layer * 0.75 + 0.35
                a.hbeam((-4.5, y, z), (4.5, y, z), 0.7, 0.3, 0.028, 0.016, "steel")
            if layer == 0:
                for x in (-3.5, 0, 3.5):
                    a.box((x, 0, 0.92), (0.2, 3.2, 0.06), "timber")
        self.mesh(a, "P_SteelStack_m", R)
        # 箱变（临时用电）
        R = self.root("P_Transformer", dict(model="transformer"))
        a = Acc()
        a.box_mm((-1.5, -1.0, 0), (1.5, 1.0, 2.3), "truck_gray")
        a.box_mm((-1.6, -1.1, 2.3), (1.6, 1.1, 2.4), "dark_steel")
        for i in range(3):
            a.box_mm((-1.2 + i * 0.9, -1.01, 0.4), (-0.5 + i * 0.9, -0.99, 1.9), "dark_steel")
        self.mesh(a, "P_Transformer_m", R)

    # ---------------------------------------------------- 全部排一排（.blend 里看用；网页会自己摆位置）
    def build_all(self, origin=(320.0, 0.0)):
        order = []
        order.append(self.excavator())
        order.append(self.excavator("M_LongReach", boom=11.0, arm=9.0, bucket_w=1.2, long_reach=True))
        order.append(self.dump_truck())
        order.append(self.mixer())
        order.append(self.pump_truck())
        order.append(self.ground_pump())
        order.append(self.flatbed())
        order.append(self.grab())
        order.append(self.rig())
        order.append(self.crawler_crane())
        order.append(self.tower_crane())
        order.append(self.tc_mast())
        order.append(self.tc_collar())
        self.hoist_parts()
        order += [self.roots[k] for k in ("M_HoistMast", "M_HoistCage", "M_HoistBase", "M_HoistTie")]
        order.append(self.car())
        order.append(self.car("M_Pickup", pickup=True))
        order.append(self.worker())
        self.props()
        order += [self.roots[k] for k in ("P_Office", "P_Guard", "P_Shed", "P_Light", "P_Wash", "P_Board", "P_Charger", "P_SteelStack", "P_Transformer")]
        ox, oy = origin
        x = ox
        for r in order:
            r.location = (x, oy, 0)
            x += 22.0
        return order
