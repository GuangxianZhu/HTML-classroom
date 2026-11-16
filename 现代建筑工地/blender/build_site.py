"""现代建筑工地 · 建模总入口。

用法（二选一）：
  blender -b --factory-startup -P blender/build_site.py -- --out blender/out [--render]
  pip install bpy && python blender/build_site.py --out blender/out [--render]

输出：
  tower.glb    主楼全部构件（每层每类一个物体，extras: stage / floor）
  zaoloji.glb  造楼机（原点 = 核心筒中心、墙顶 TOC）
  site.blend   两者合在一起，按 params.json 的 state_preview 摆成“施工到第 30 层”的样子
  spec.json    给网页用的数字（标高、墙厚、支点位置……）
  view_*.jpg   预览图（加 --render）
"""
import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import sitekit  # noqa: E402
from tower import Tower  # noqa: E402
from zaoloji import Zaoloji  # noqa: E402


def parse():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "out"))
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--views", default="", help="只渲这些机位，逗号分隔")
    ap.add_argument("--samples", type=int, default=40)
    ap.add_argument("--res", default="1280x720")
    ap.add_argument("--noexport", action="store_true", help="不写 glb / blend，只渲图")
    return ap.parse_known_args(argv)[0]


# ------------------------------------------------------------ 施工状态
STATE_KEY = {"raft": "core", "bwall": "core", "bslab": "core", "core": "core", "column": "column",
             "steel": "steel", "outrigger": "steel", "deck": "deck", "slab": "slab", "curtain": "curtain"}


def set_state(tower, state, zl_root=None, z=None):
    """state=None 表示竣工。地下室在地上第一层开工前全部完成。"""
    for o in tower.objs:
        st, fl = o["stage"], o["floor"]
        if state is None:
            vis = True
        elif st == "roof":
            vis = False
        elif fl < 1:
            vis = True
        else:
            vis = fl <= state[STATE_KEY[st]]
        o.hide_render = not vis
        o.hide_set(not vis)
    if zl_root is not None:
        show = state is not None
        zl_root.location = (0, 0, tower.z[state["core"] + 1] if show else 0)
        for o in walk(zl_root):
            o.hide_render = not show
            o.hide_set(not show)


def walk(root):
    out, st = [], [root]
    while st:
        o = st.pop()
        out.append(o)
        st.extend(o.children)
    return out


# ------------------------------------------------------------ 渲染
SAMPLES, RES = 40, (1280, 720)


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 88
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.exposure = -0.35
    w = bpy.data.worlds.new("sky")
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    grad = nt.nodes.new("ShaderNodeTexGradient")
    mapn = nt.nodes.new("ShaderNodeMapping")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mapn.inputs["Rotation"].default_value = (0, -math.pi / 2, 0)
    nt.links.new(coord.outputs["Generated"], mapn.inputs["Vector"])
    nt.links.new(mapn.outputs["Vector"], grad.inputs["Vector"])
    nt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].color = (0.80, 0.86, 0.92, 1)
    ramp.color_ramp.elements[1].color = (0.36, 0.55, 0.82, 1)
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    sc.world = w
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.0
    sun.angle = math.radians(1.5)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), math.radians(8), math.radians(35))
    sc.collection.objects.link(so)
    cd = bpy.data.cameras.new("cam")
    cd.clip_end = 5000
    co = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(co)
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = RES
    # 地面（只用于渲染，不导出）
    acc = sitekit.Acc()
    acc.box((0, 0, -0.08), (3000, 3000, 0.1), "ground")
    return acc.build("RenderGround")


def shoot(name, loc, target, lens, out_dir):
    sc = bpy.context.scene
    cam = sc.camera
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    sc.render.filepath = os.path.join(out_dir, name)
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"[render] {name} {time.time() - t:.0f}s", flush=True)


def hide_names(prefixes, flag):
    for o in bpy.data.objects:
        if any(o.name.startswith(p) for p in prefixes):
            o.hide_render = flag


def render_all(out_dir, tower, zl, P, only):
    ground = setup_render()
    st = P["state_preview"]
    toc = tower.z[st["core"] + 1]
    views = []

    def want(n):
        return not only or n in only

    if want("view_done"):
        set_state(tower, None, zl.root)
        shoot("view_done", (250, -320, 110), (0, 0, 122), 32, out_dir)
    set_state(tower, st, zl.root)
    if want("view_construction"):
        shoot("view_construction", (170, -230, 175), (0, 0, 92), 36, out_dir)
    if want("view_floor"):
        zf = tower.z[st["slab"] + 2]
        shoot("view_floor", (44, -40, zf + 6), (14, -14, zf - 3), 30, out_dir)
    if want("view_zaoloji"):
        shoot("view_zaoloji", (44, -58, toc + 26), (0, 0, toc + 3), 28, out_dir)
    hide_names(("ZLJ_Mesh",), True)
    if want("view_zaoloji_open"):
        shoot("view_zaoloji_open", (30, -38, toc + 9), (0, 0, toc - 2), 26, out_dir)
    if want("view_support"):
        # 南侧外墙上 x=-4 的支点，从防护网外面看
        shoot("view_support", (-1.0, -19.5, toc - 7.0), (-4.0, -12.6, toc - 7.8), 32, out_dir)
    if want("view_formwork"):
        shoot("view_formwork", (9.0, -16.5, toc + 3.2), (5.0, -12.0, toc - 2.0), 26, out_dir)
    hide_names(("ZLJ_Mesh",), False)
    if want("view_basement"):
        ground.hide_render = True
        set_state(tower, dict(core=1, column=1, steel=0, deck=0, slab=0, curtain=0), zl.root)
        for o in zl.root.children_recursive:
            o.hide_render = True
        zl.root.hide_render = True
        for o in tower.objs:
            if o["floor"] == -1 and o["stage"] == "bslab":
                o.hide_render = True
        shoot("view_basement", (95, -110, 45), (10, 6, -12), 30, out_dir)


def main():
    global SAMPLES, RES
    args = parse()
    SAMPLES = args.samples
    RES = tuple(int(v) for v in args.res.split("x"))
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(HERE, "..", "params.json"), encoding="utf-8") as fp:
        P = json.load(fp)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sitekit.build_materials(out_dir)
    t0 = time.time()
    tower = Tower(P)
    tower.build()
    zl = Zaoloji(P, tower)
    zl.build()
    bpy.context.view_layer.update()
    print(f"[build] {len(tower.objs)} tower objs, {len(zl.objs)} platform objs, {time.time() - t0:.1f}s", flush=True)

    def tris(objs):
        return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == "MESH")

    print(f"[build] tris tower={tris(tower.objs)} platform={tris(zl.objs)}", flush=True)
    if not args.noexport:
        sitekit.export_glb(os.path.join(out_dir, "tower.glb"), tower.root)
        sitekit.export_glb(os.path.join(out_dir, "zaoloji.glb"), zl.root)
        spec = dict(tower=tower.spec(), zaoloji=zl.spec(), state_preview=P["state_preview"])
        with open(os.path.join(out_dir, "spec.json"), "w", encoding="utf-8") as fp:
            json.dump(spec, fp, ensure_ascii=False, indent=1)
        set_state(tower, P["state_preview"], zl.root)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "site.blend"), compress=True)
        print("[export] done", flush=True)
    if args.render:
        only = [v for v in args.views.split(",") if v]
        render_all(out_dir, tower, zl, P, only)


main()
