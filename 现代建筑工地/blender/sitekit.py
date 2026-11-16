"""工地建模的共用小工具：把很多方块/圆柱攒成一个网格再一次性生成物体。

一个 Acc（accumulator）对应 Blender 里的一个物体，可以有多种材质。
所有坐标都是世界坐标（米），build() 时可以指定物体原点。
"""
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

# ---------------------------------------------------------------- 材质

MAT_DEF = {
    # name: (base color, roughness, metallic, alpha)
    "concrete": ((0.50, 0.50, 0.48), 0.85, 0.0, 1.0),
    "concrete_dark": ((0.38, 0.38, 0.37), 0.9, 0.0, 1.0),
    "steel": ((0.36, 0.40, 0.45), 0.55, 0.6, 1.0),          # 钢梁：灰色底漆
    "steel_tube": ((0.42, 0.44, 0.47), 0.5, 0.6, 1.0),     # 钢管混凝土柱
    "deck": ((0.72, 0.74, 0.76), 0.35, 0.85, 1.0),         # 压型钢板（镀锌），带条纹贴图
    "glass": ((0.30, 0.47, 0.55), 0.06, 0.6, 0.55),
    "spandrel": ((0.13, 0.16, 0.19), 0.25, 0.4, 1.0),
    "alu": ((0.78, 0.79, 0.80), 0.3, 0.9, 1.0),
    "louver": ((0.55, 0.57, 0.58), 0.45, 0.7, 1.0),
    # 造楼机
    "plat_red": ((0.80, 0.25, 0.08), 0.5, 0.3, 1.0),       # 平台桁架、围护框：橘红（武汉中心实景）
    "mesh_red": ((0.85, 0.30, 0.10), 0.6, 0.3, 0.42),      # 冲孔钢板网：半透明
    "grating": ((0.35, 0.36, 0.37), 0.6, 0.7, 1.0),        # 走道板
    "yellow": ((0.93, 0.66, 0.08), 0.45, 0.2, 1.0),        # 栏杆、踢脚板、附墙支座
    "dark_steel": ((0.20, 0.21, 0.23), 0.55, 0.7, 1.0),    # 吊杆、立柱弦杆
    "form": ((0.30, 0.31, 0.32), 0.45, 0.75, 1.0),         # 大钢模
    "chrome": ((0.85, 0.86, 0.88), 0.12, 1.0, 1.0),        # 油缸活塞杆
    "cyl_yellow": ((0.90, 0.55, 0.05), 0.35, 0.3, 1.0),    # 油缸缸筒
    "white": ((0.86, 0.87, 0.86), 0.5, 0.1, 1.0),
    "blue": ((0.12, 0.30, 0.62), 0.5, 0.2, 1.0),
    "window": ((0.10, 0.14, 0.18), 0.1, 0.5, 1.0),
    "rebar": ((0.36, 0.22, 0.15), 0.8, 0.5, 1.0),
    "black": ((0.05, 0.05, 0.05), 0.5, 0.3, 1.0),
    "rubber": ((0.08, 0.08, 0.08), 0.8, 0.0, 1.0),
    "ground": ((0.42, 0.40, 0.36), 0.95, 0.0, 1.0),
}

# 有贴图的材质：UV 按世界米数除以这个周期
UV_PERIOD = {"deck": 0.30}
_MATS = {}


def _stripe_image(out_dir):
    """压型钢板的凹凸条纹：一个周期 0.3 m，横向 64 像素。"""
    w, h = 64, 8
    img = bpy.data.images.new("deck_stripes", w, h)
    u = (np.arange(w) + 0.5) / w
    # 梯形肋：中间一段亮，两侧斜坡暗
    v = np.where(np.abs(u - 0.5) < 0.17, 1.0, np.where(np.abs(u - 0.5) < 0.27, 0.55, 0.82))
    px = np.zeros((h, w, 4), dtype=np.float32)
    for c, base in enumerate(MAT_DEF["deck"][0]):
        px[..., c] = base * v[None, :]
    px[..., 3] = 1
    img.pixels.foreach_set(px.ravel())
    path = os.path.join(out_dir, "tex_deck.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


def build_materials(out_dir):
    _MATS.clear()
    stripes = _stripe_image(out_dir)
    for name, (col, rough, metal, alpha) in MAT_DEF.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*col, 1)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if alpha < 1:
            bsdf.inputs["Alpha"].default_value = alpha
            for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
                try:
                    setattr(m, attr, val)
                except Exception:
                    pass
        if name == "deck":
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = stripes
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        m.diffuse_color = (*col, alpha)
        _MATS[name] = m
    return _MATS


def mat(name):
    return _MATS[name]


# ---------------------------------------------------------------- 几何累加器

def _frame(d, up=(0, 0, 1)):
    """以 d 为 x 轴的右手正交基（3x3，列向量）。"""
    d = np.asarray(d, float)
    d = d / np.linalg.norm(d)
    up = np.asarray(up, float)
    if abs(np.dot(d, up)) > 0.999:
        up = np.array([0.0, 1.0, 0.0]) if abs(d[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    y = np.cross(up, d)
    y /= np.linalg.norm(y)
    z = np.cross(d, y)
    return np.stack([d, y, z], axis=1)


_BOX_FACES = ((1, 3, 7, 5), (0, 4, 6, 2), (2, 6, 7, 3), (0, 1, 5, 4), (4, 5, 7, 6), (0, 2, 3, 1))
_BOX_UVAX = ((1, 2), (1, 2), (0, 2), (0, 2), (0, 1), (0, 1))


class Acc:
    def __init__(self, uv=False):
        self.V = []      # list of (n,3) arrays
        self.nv = 0
        self.F = []      # list of tuples of vertex indices
        self.M = []      # material name per face
        self.S = []      # smooth flag per face
        self.UV = []     # per face list of (u,v)
        self.uv = uv

    # -- 底层
    def _verts(self, pts):
        pts = np.asarray(pts, float).reshape(-1, 3)
        base = self.nv
        self.V.append(pts)
        self.nv += len(pts)
        return base

    def _face(self, idx, m, smooth=False, uvs=None):
        self.F.append(tuple(idx))
        self.M.append(m)
        self.S.append(smooth)
        if self.uv:
            self.UV.append(uvs if uvs is not None else [(0.0, 0.0)] * len(idx))

    def empty(self):
        return self.nv == 0

    # -- 方块
    def box(self, center, size, m, R=None):
        c = np.asarray(center, float)
        h = np.asarray(size, float) / 2
        R = np.eye(3) if R is None else np.asarray(R, float)
        sg = np.array([[(i & 1) * 2 - 1, ((i >> 1) & 1) * 2 - 1, ((i >> 2) & 1) * 2 - 1] for i in range(8)], float)
        pts = c + (sg * h) @ R.T
        b = self._verts(pts)
        per = UV_PERIOD.get(m, 1.0)
        for f, (a1, a2) in zip(_BOX_FACES, _BOX_UVAX):
            uvs = None
            if self.uv:
                uvs = [(float(pts[i] @ R[:, a1]) / per, float(pts[i] @ R[:, a2]) / per) for i in f]
            self._face([b + i for i in f], m, uvs=uvs)

    def box_mm(self, lo, hi, m):
        lo = np.asarray(lo, float)
        hi = np.asarray(hi, float)
        self.box((lo + hi) / 2, np.abs(hi - lo), m)

    def bar(self, p0, p1, w, h, m, up=(0, 0, 1)):
        """沿 p0→p1 的方钢/杆件，截面 w（侧向）× h（上方向）。"""
        p0 = np.asarray(p0, float)
        p1 = np.asarray(p1, float)
        L = np.linalg.norm(p1 - p0)
        if L < 1e-6:
            return
        R = _frame(p1 - p0, up)
        self.box((p0 + p1) / 2, (L, w, h), m, R)

    def hbeam(self, p0, p1, H, B, tf, tw, m, up=(0, 0, 1)):
        """H 型钢：上下翼缘 + 腹板，腹板在 up 方向。p0/p1 是截面中心线。"""
        p0 = np.asarray(p0, float)
        p1 = np.asarray(p1, float)
        L = np.linalg.norm(p1 - p0)
        if L < 1e-6:
            return
        R = _frame(p1 - p0, up)
        c = (p0 + p1) / 2
        z = R[:, 2]
        self.box(c + z * (H / 2 - tf / 2), (L, B, tf), m, R)
        self.box(c - z * (H / 2 - tf / 2), (L, B, tf), m, R)
        self.box(c, (L, tw, H - 2 * tf), m, R)

    # -- 棱柱（任意凸/凹多边形，逆时针）
    def prism(self, poly, z0, z1, m):
        poly = [(float(x), float(y)) for x, y in poly]
        n = len(poly)
        bot = [(x, y, z0) for x, y in poly]
        top = [(x, y, z1) for x, y in poly]
        b = self._verts(bot)
        t = self._verts(top)
        per = UV_PERIOD.get(m, 1.0)
        uv_top = [(x / per, y / per) for x, y in poly]
        self._face([t + i for i in range(n)], m, uvs=uv_top if self.uv else None)
        self._face([b + i for i in reversed(range(n))], m, uvs=list(reversed(uv_top)) if self.uv else None)
        for i in range(n):
            j = (i + 1) % n
            self._face([b + i, b + j, t + j, t + i], m)

    # -- 圆柱
    def cyl(self, p0, p1, r, m, seg=16, caps=True, smooth=True, r1=None):
        p0 = np.asarray(p0, float)
        p1 = np.asarray(p1, float)
        if np.linalg.norm(p1 - p0) < 1e-6:
            return
        r1 = r if r1 is None else r1
        R = _frame(p1 - p0)
        a = np.linspace(0, 2 * math.pi, seg, endpoint=False)
        ring = np.stack([np.zeros(seg), np.cos(a), np.sin(a)], axis=1) @ R.T
        b = self._verts(p0 + ring * r)
        t = self._verts(p1 + ring * r1)
        for i in range(seg):
            j = (i + 1) % seg
            self._face([b + i, b + j, t + j, t + i], m, smooth=smooth)
        if caps:
            cb = self._verts(p0 + ring * r)
            ct = self._verts(p1 + ring * r1)
            self._face([cb + i for i in reversed(range(seg))], m)
            self._face([ct + i for i in range(seg)], m)

    # -- 生成物体
    def build(self, name, origin=(0, 0, 0), parent=None, props=None, coll=None):
        if self.empty():
            return None
        V = np.concatenate(self.V) - np.asarray(origin, float)
        me = bpy.data.meshes.new(name)
        me.from_pydata(V.tolist(), [], self.F)
        names = []
        for mm in self.M:
            if mm not in names:
                names.append(mm)
        for nm in names:
            me.materials.append(mat(nm))
        lut = {nm: i for i, nm in enumerate(names)}
        me.polygons.foreach_set("material_index", [lut[mm] for mm in self.M])
        me.polygons.foreach_set("use_smooth", self.S)
        if self.uv:
            uvl = me.uv_layers.new(name="UVMap")
            flat = [c for f in self.UV for uvp in f for c in uvp]
            uvl.data.foreach_set("uv", flat)
        me.validate(clean_customdata=False)
        me.update()
        ob = bpy.data.objects.new(name, me)
        ob.location = origin
        (coll or bpy.context.scene.collection).objects.link(ob)
        if parent is not None:
            ob.parent = parent
            ob.matrix_parent_inverse = parent.matrix_world.inverted()
        for k, v in (props or {}).items():
            ob[k] = v
        return ob


def empty(name, loc=(0, 0, 0), parent=None, props=None, coll=None):
    ob = bpy.data.objects.new(name, None)
    ob.location = loc
    ob.empty_display_size = 2
    (coll or bpy.context.scene.collection).objects.link(ob)
    if parent is not None:
        ob.parent = parent
        ob.matrix_parent_inverse = parent.matrix_world.inverted()
    for k, v in (props or {}).items():
        ob[k] = v
    return ob


def rot2(p, k):
    """绕 z 轴转 k×90°（二维）。"""
    x, y = p[0], p[1]
    for _ in range(k % 4):
        x, y = -y, x
    return (x, y) if len(p) == 2 else (x, y, p[2])


def rect_minus(outer, holes):
    """矩形减去若干矩形孔，返回不重叠的矩形列表（按行合并）。矩形 = (x0, y0, x1, y1)。"""
    xs = sorted({outer[0], outer[2], *[h[0] for h in holes], *[h[2] for h in holes]})
    ys = sorted({outer[1], outer[3], *[h[1] for h in holes], *[h[3] for h in holes]})
    xs = [x for x in xs if outer[0] <= x <= outer[2]]
    ys = [y for y in ys if outer[1] <= y <= outer[3]]
    out = []
    for j in range(len(ys) - 1):
        y0, y1 = ys[j], ys[j + 1]
        run = None
        for i in range(len(xs) - 1):
            x0, x1 = xs[i], xs[i + 1]
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            inside = any(h[0] < cx < h[2] and h[1] < cy < h[3] for h in holes)
            if not inside:
                run = [run[0], x1] if run else [x0, x1]
            elif run:
                out.append((run[0], y0, run[1], y1))
                run = None
        if run:
            out.append((run[0], y0, run[1], y1))
    return out


def select_tree(root):
    bpy.ops.object.select_all(action="DESELECT")
    stack = [root]
    while stack:
        o = stack.pop()
        o.select_set(True)
        stack.extend(o.children)


def export_glb(path, root):
    """只导出 root 这棵树。"""
    select_tree(root)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
              export_extras=True, export_animations=False, export_cameras=False, export_lights=False,
              export_tangents=False, export_normals=True, export_texcoords=True, export_image_format="AUTO")
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop("export_image_format")
        bpy.ops.export_scene.gltf(**kw)
