#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把“电动车电机调速”那台电机渲染成一张横截面图：三相线圈用 U/V/W 三色，转子磁钢红蓝。
    python render_section.py  /  blender -b -P render_section.py
输入 ../../电动车电机调速/blender/out/ev_drive.blend，输出 ../web/src/section.jpg
"""
import json
import os

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', '电动车电机调速', 'blender', 'out')
bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, 'ev_drive.blend'))
spec = json.load(open(os.path.join(SRC, 'spec.json'), encoding='utf-8'))
MY, MZ = [v / 1000 for v in spec['motor_axis']]
sc = bpy.context.scene
sc.frame_set(1)
KEEP = ('Stator', 'Bar_', 'Rotor_core', 'Rotor_mag')


def mat(name, hexc):
    h = hexc.lstrip('#')
    lin = [(lambda c: c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4)(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*lin, 1)
    b.inputs['Metallic'].default_value = .1
    b.inputs['Roughness'].default_value = .45
    return m


PH = {'U': mat('U', '#f0b429'), 'V': mat('V', '#3ed6b4'), 'W': mat('W', '#b78cff')}
for ob in sc.objects:
    if ob.type != 'MESH':
        continue
    ob.hide_render = not ob.name.startswith(KEEP)
    if ob.name.startswith('Bar_'):
        ob.data.materials[0] = PH[ob.name[4]]

sc.render.engine = 'CYCLES'
sc.cycles.samples = 24
sc.cycles.device = 'CPU'
try:
    sc.cycles.use_denoising = True
except Exception:
    pass
sc.render.resolution_x = sc.render.resolution_y = 900
sc.render.film_transparent = False
sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.008, .014, .03, 1)
sc.view_settings.look = 'None'
cam = sc.camera
cam.data.type = 'ORTHO'
cam.data.ortho_scale = .236
cam.location = Vector((-1.2, MY, MZ))
cam.rotation_euler = (Vector((0, MY, MZ)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
for ob in sc.objects:
    if ob.type == 'LIGHT':
        ob.hide_render = True
ld = bpy.data.lights.new('Front', 'SUN')
ld.energy = 2.3
ob = bpy.data.objects.new('Front', ld)
sc.collection.objects.link(ob)
ob.rotation_euler = (Vector((1, .15, -.2))).to_track_quat('-Z', 'Y').to_euler()
sc.render.image_settings.file_format = 'JPEG'
sc.render.image_settings.quality = 80
sc.render.filepath = os.path.join(HERE, '..', 'web', 'src', 'section.jpg')
bpy.ops.render.render(write_still=True)
print('[OK] section.jpg')
