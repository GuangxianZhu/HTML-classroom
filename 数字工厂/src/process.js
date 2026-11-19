// 40-process：冲压线、焊装机器人单元、涂装房 + 烘房、空中输送
import * as THREE from 'three';
import { C, M, MAT, trs, rr, R, pick, clamp, smooth, textPlate } from './util.js';
import { robotGeoms, carGeoms, rbox, mergeT, mtx } from './geo.js';
import { Path, Flow } from './path.js';
import { SIM } from './sim.js';

export const PAINT_COLORS = ['#c9c4ba', '#2c2f33', '#80858b', '#3b4857', '#6a2e2b', '#b9b4a9', '#4d5a55', '#d0ccc3'];

// ---------- 粒子：焊花 / 喷雾 ----------
function dotTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
}
class Particles {
  constructor(scene, n, size, opt = {}) {
    this.n = n; this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.base = new Float32Array(n * 3);
    this.g = opt.gravity ?? -9.8; this.drag = opt.drag ?? 0.6; this.i = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.PointsMaterial({ size, map: dotTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false });
    this.pts = new THREE.Points(geo, this.mat); this.pts.frustumCulled = false; this.pts.matrixAutoUpdate = false;
    scene.add(this.pts); this.geo = geo;
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -100;
  }
  emit(x, y, z, vx, vy, vz, life, r, g, b) {
    const i = this.i; this.i = (this.i + 1) % this.n;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.base.set([r, g, b], i * 3);
    this.life[i] = life; this.max[i] = life;
  }
  update(dt) {
    const { pos, vel, life, col, base } = this; const dr = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) { if (pos[i * 3 + 1] > -50) { pos[i * 3 + 1] = -100; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; } continue; }
      life[i] -= dt;
      vel[i * 3 + 1] += this.g * dt; vel[i * 3] *= dr; vel[i * 3 + 1] *= dr; vel[i * 3 + 2] *= dr;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < 0.02 && vel[i * 3 + 1] < 0) { pos[i * 3 + 1] = 0.02; vel[i * 3 + 1] *= -0.3; vel[i * 3] *= 0.5; vel[i * 3 + 2] *= 0.5; }
      const k = Math.max(0, life[i] / this.max[i]);
      col[i * 3] = base[i * 3] * k; col[i * 3 + 1] = base[i * 3 + 1] * k * k; col[i * 3 + 2] = base[i * 3 + 2] * k * k * k;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}

// ---------- 六轴机器人 ----------
export function defRobotParts(P) {
  const g = robotGeoms();
  P.def('rb_base', g.base, MAT.graphite);
  for (const [sfx, mat] of [['o', MAT.orange], ['w', MAT.ivory]]) {
    P.def('rb_turret_' + sfx, g.turret, mat); P.def('rb_upper_' + sfx, g.upper, mat); P.def('rb_fore_' + sfx, g.fore, mat);
  }
  P.def('rb_wrist', g.wrist, MAT.graphite); P.def('rb_gun', g.gun, MAT.graphite); P.def('rb_bell', g.bell, MAT.steel); P.def('rb_grip', g.grip, MAT.graphite);
  P.def('rb_hose', g.hose, MAT.rubber);
}
export function makeRobot(P, x, y, z, yaw, style = 'o', tool = 'gun', parent) {
  const root = P.group(parent); root.position.set(x, y, z); root.rotation.y = yaw;
  P.node('rb_base', root);
  const j1 = P.group(root); j1.position.y = 0.32; P.node('rb_turret_' + style, j1);
  const j2 = P.group(j1); j2.position.set(0.06, 0.62, 0); P.node('rb_upper_' + style, j2); P.node('rb_hose', j2);
  const j3 = P.group(j2); j3.position.set(0, 1.15, 0); P.node('rb_fore_' + style, j3);
  const j5 = P.group(j3); j5.position.set(1.02, 0, 0); P.node('rb_wrist', j5);
  const j6 = P.group(j5); j6.position.set(0.12, 0, 0); P.node('rb_' + tool, j6);
  const tip = P.group(j6); tip.position.set(tool === 'gun' ? 0.55 : tool === 'bell' ? 0.48 : 0.1, tool === 'gun' ? -0.1 : 0, 0);
  return { root, j1, j2, j3, j5, j6, tip, ph: R() * 10, t: R() * 10, style };
}

export function buildProcess(ctx) {
  const { B, P, scene } = ctx;
  const steel = ctx.MAT.structure;
  defRobotParts(P);
  const fx = { sparks: new Particles(scene, 900, 0.07, { gravity: -9.8, drag: 0.4 }), flash: new Particles(scene, 64, 0.9, { gravity: 0, drag: 0 }), mist: new Particles(scene, 500, 0.55, { gravity: -0.15, drag: 1.4 }) };
  ctx.fx = fx;
  const tmp = new THREE.Vector3();
  const upd = [];

  // =============== 冲压线 Z02 ===============
  const PZ = -20, PX = [-39, -31, -23, -15.5];
  const ivory = MAT.ivory, graphite = MAT.graphite;
  P.def('pr_slide', mergeT([[rbox(3.6, 1.0, 2.7, 0.08), mtx(0, 0, 0)], [new THREE.BoxGeometry(3.2, 0.5, 2.3), mtx(0, -0.72, 0)], ...[-1.2, 0, 1.2].map((x) => [new THREE.BoxGeometry(0.1, 0.9, 2.72), mtx(x, 0.02, 0)])]), MAT.graphite);
  P.def('pr_dieU', new THREE.BoxGeometry(2.9, 0.45, 2.0), MAT.steelDark);
  P.def('pr_panel', mergeT([[new THREE.BoxGeometry(2.4, 0.04, 1.5), null], [new THREE.BoxGeometry(2.4, 0.18, 0.04), mtx(0, 0.08, 0.74)], [new THREE.BoxGeometry(2.4, 0.18, 0.04), mtx(0, 0.08, -0.74)]]), M('panelSteel', { color: 0xb9bec4, roughness: 0.25, metalness: 0.9 }, { grime: 0.3 }));
  P.def('pr_bar', mergeT([[new THREE.BoxGeometry(0.18, 0.18, 3.6), null], ...[-1.2, -0.4, 0.4, 1.2].map((z) => [new THREE.CylinderGeometry(0.08, 0.1, 0.22, 10), mtx(0, -0.18, z)])]), MAT.graphite);
  P.def('pr_arm', (() => { const g = new THREE.BoxGeometry(0.12, 1, 0.14); g.translate(0, 0.5, 0); return g; })(), MAT.orange);
  P.def('pr_coil', (() => { const g = new THREE.CylinderGeometry(1.0, 1.0, 1.5, 32, 1); g.rotateX(Math.PI / 2); return g; })(), MAT.steel);
  const presses = [];
  for (let i = 0; i < 4; i++) {
    const x = PX[i];
    // 地基 + 底座 + 工作台
    B.box(MAT.concrete, 5.6, 0.2, 4.4, x, 0.1, PZ);
    B.box(graphite, 4.6, 1.1, 3.4, x, 0.2 + 0.55, PZ);
    B.box(MAT.steelDark, 3.4, 0.5, 2.5, x, 1.55, PZ); // 下模
    // 立柱
    for (const [dx, dz] of [[-1.95, -1.35], [1.95, -1.35], [-1.95, 1.35], [1.95, 1.35]]) { B.geom(ivory, rbox(0.7, 5.4, 0.7, 0.06), trs(x + dx, 1.3 + 2.7, PZ + dz)); }
    // 上横梁 + 驱动 + 平衡缸
    B.geom(ivory, rbox(4.9, 1.8, 3.6, 0.12), trs(x, 7.5, PZ));
    B.geom(graphite, rbox(2.2, 0.9, 1.6, 0.1), trs(x - 0.6, 8.85, PZ));
    B.geom(MAT.steel, new THREE.CylinderGeometry(0.5, 0.5, 0.7, 20).rotateX(Math.PI / 2), trs(x + 1.3, 8.8, PZ));
    for (const dz of [-1.0, 1.0]) B.geom(MAT.steel, new THREE.CylinderGeometry(0.14, 0.14, 1.4, 12), trs(x + 2.25, 6.1, PZ + dz));
    // 铭牌
    B.box(MAT.orange, 1.2, 0.35, 0.02, x, 7.6, PZ + 1.81);
    // 玻璃上罩（前后）
    for (const dz of [-1.72, 1.72]) { B.box(MAT.glass, 3.2, 2.6, 0.03, x, 3.25, PZ + dz); B.box(graphite, 3.3, 0.07, 0.06, x, 4.55, PZ + dz); B.box(graphite, 3.3, 0.07, 0.06, x, 1.95, PZ + dz); }
    // 液压管线（北侧）
    for (let k = 0; k < 3; k++) {
      const pts = [new THREE.Vector3(x - 1.2 + k * 0.5, 8.3, PZ - 1.8), new THREE.Vector3(x - 1.4 + k * 0.5, 6.5, PZ - 2.25), new THREE.Vector3(x - 1.6 + k * 0.4, 2.0, PZ - 2.4), new THREE.Vector3(x - 1.9 + k * 0.3, 0.12, PZ - 2.9)];
      B.geom(MAT.rubber, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.05, 6, false));
    }
    B.box(graphite, 1.4, 1.6, 0.9, x - 1.8, 0.8, PZ - 3.4); // 液压站
    // 操作台
    B.box(graphite, 0.5, 1.1, 0.4, x + 2.4, 0.55, PZ + 3.2); B.geom(graphite, rbox(0.8, 0.5, 0.5, 0.05), trs(x + 2.4, 1.35, PZ + 3.2, 0, -0.5));
    B.box(MAT.screen, 0.6, 0.32, 0.01, x + 2.4, 1.42, PZ + 3.46, 0, -0.5);
    const slide = P.node('pr_slide'); const dieU = P.node('pr_dieU', slide); dieU.position.y = -1.18;
    const panel = P.node('pr_panel'); panel.position.set(x, 1.83, PZ);
    presses.push({ x, slide, panel, id: 'PR-0' + (i + 1) });
  }
  // 横杆机械手（拆垛 → P1 → P2 → P3 → P4 → 出料）
  const bars = [];
  const XS = [-44.2, ...PX, -11.8];
  for (let i = 0; i < 5; i++) {
    const bar = P.node('pr_bar'); const carry = P.node('pr_panel', bar); carry.position.y = -0.34;
    const arms = [-1.84, 1.84].map((z) => { const a = P.node('pr_arm', bar); a.position.z = z; return a; });
    bars.push({ a: XS[i], b: XS[i + 1], g: (XS[i] + XS[i + 1]) / 2, bar, carry, arms });
  }
  // 桁架（机械手导轨）
  B.box(steel, 34.5, 0.35, 0.35, -28.2, 6.0, PZ - 1.95); B.box(steel, 34.5, 0.35, 0.35, -28.2, 6.0, PZ + 1.95);
  for (const x of [-45.2, -35, -27, -19.2, -11.3]) for (const dz of [-1.95, 1.95]) B.box(steel, 0.28, 6.0, 0.28, x, 3.0, PZ + dz);
  // 拆垛 + 开卷机 + 校平
  B.box(graphite, 2.4, 1.0, 2.4, -44.2, 0.5, PZ);
  for (let k = 0; k < 6; k++) B.box(M('panelSteel'), 2.4, 0.04, 1.5, -44.2, 1.02 + k * 0.05, PZ);
  B.box(graphite, 1.6, 2.6, 2.0, -46.0, 1.3, PZ - 5.0);
  const coil = P.node('pr_coil'); coil.position.set(-46.0, 2.9, PZ - 5.0);
  B.geom(MAT.graphite, new THREE.CylinderGeometry(0.25, 0.25, 2.2, 12).rotateX(Math.PI / 2), trs(-46.0, 2.9, PZ - 5.0));
  B.box(ivory, 2.2, 1.6, 1.8, -43.4, 0.8, PZ - 5.0); B.box(M('panelSteel'), 2.4, 0.02, 1.4, -44.6, 1.9, PZ - 5.0, 0, 0, -0.35);
  // 钢卷库位
  for (let k = 0; k < 4; k++) { B.box(MAT.wood, 1.8, 0.3, 1.8, -45.5 + k * 2.3, 0.15, -31.5); B.geom(MAT.steel, new THREE.CylinderGeometry(0.85, 0.85, 1.4, 26).rotateX(Math.PI / 2), trs(-45.5 + k * 2.3, 1.15, -31.5)); }
  // 废料输送 + 废料箱
  B.box(MAT.graphite, 31, 0.5, 1.0, -29.6, 0.25, -25.0); B.box(MAT.rubber, 30.6, 0.05, 0.8, -29.6, 0.52, -25.0);
  for (const x of [-15.8, -13.4 + 0.0]) { B.box(MAT.steelDark, 2.0, 1.2, 1.6, x, 0.6, -29.6); }
  for (let k = 0; k < 40; k++) B.box(M('panelSteel'), rr(0.1, 0.4), 0.03, rr(0.1, 0.3), rr(-16.6, -12.6), rr(1.15, 1.25), rr(-30.2, -29.0), rr(0, 3));
  // 成品料架
  for (let k = 0; k < 3; k++) { const x = -21 + k * 2.6; B.box(steel, 2.2, 0.08, 1.6, x, 0.4, -30.4); for (const dx of [-1, 1]) for (const dz of [-0.7, 0.7]) B.box(steel, 0.06, 1.6, 0.06, x + dx, 0.8, -30.4 + dz); for (let s = 0; s < 8; s++) B.box(M('panelSteel'), 2.0, 0.03, 1.4, x, 0.5 + s * 0.12, -30.4); }
  // 安全围栏 + 光幕
  const fenceRun = (x0, z0, x1, z1, h = 2.0) => { const L = Math.hypot(x1 - x0, z1 - z0); const ry = -Math.atan2(z1 - z0, x1 - x0); B.box(MAT.mesh, L, h - 0.2, 0.02, (x0 + x1) / 2, 0.15 + (h - 0.2) / 2, (z0 + z1) / 2, ry); B.box(MAT.yellow, L, 0.05, 0.05, (x0 + x1) / 2, h, (z0 + z1) / 2, ry); for (let s = 0; s <= L + 0.01; s += 2) { const t = Math.min(1, s / L); B.box(MAT.yellow, 0.06, h, 0.06, x0 + (x1 - x0) * t, h / 2, z0 + (z1 - z0) * t); } };
  ctx.fenceRun = fenceRun;
  const lc = (x, z, ry, w = 1.6) => { for (const s of [-1, 1]) { const dx = Math.cos(ry) * w / 2 * s, dz = -Math.sin(ry) * w / 2 * s; B.box(MAT.yellow, 0.1, 1.9, 0.1, x + dx, 0.95, z + dz); B.box(MAT.lampRed, 0.02, 1.6, 0.02, x + dx * 0.94, 1.0, z + dz * 0.94); } };
  fenceRun(-46, -26.4, -46, -13.6); fenceRun(-14, -26.4, -14, -13.6); fenceRun(-46, -26.4, -14, -26.4);
  for (const [a, b] of [[-46, -42.6], [-40.6, -34.6], [-32.6, -26.6], [-24.6, -19.2], [-17.2, -14]]) fenceRun(a, -13.6, b, -13.6);
  for (const x of [-41.6, -33.6, -25.6, -18.2]) lc(x, -13.6, 0, 2.0);

  upd.push((dt) => {
    let sp = 1; for (const p of presses) sp = Math.min(sp, SIM.speed(p.id)); sp = Math.min(sp, SIM.speed('XF-01') > 0 ? 1 : 0);
    ctx.pressPhase = (ctx.pressPhase || 0) + dt * SIM.rate * sp / 4.2;
    const p = ctx.pressPhase % 1;
    const d = p < 0.5 ? 0.5 - 0.5 * Math.cos(4 * Math.PI * p) : 0;
    for (const pr of presses) { pr.slide.position.set(pr.x, 5.1 - d * 1.55, PZ); }
    // 机械手
    let u = p >= 0.5 ? (p - 0.5) / 0.5 : -1;
    const carry = u >= 0.1 && u < 0.75;
    for (const pr of presses) pr.panel.visible = !carry;
    for (const b of bars) {
      let x = b.g, y = 4.4, show = false;
      if (u >= 0) {
        if (u < 0.1) { const k = smooth(u / 0.1); x = b.g + (b.a - b.g) * k; y = 4.4 - 2.15 * k; }
        else if (u < 0.75) { const k = smooth((u - 0.1) / 0.65); x = b.a + (b.b - b.a) * k; y = 2.25 + Math.sin(k * Math.PI) * 0.7; show = true; }
        else if (u < 0.95) { const k = smooth((u - 0.75) / 0.2); x = b.b + (b.g - b.b) * k; y = 2.25 + 2.15 * k; }
      }
      b.bar.position.set(x, y, PZ); b.carry.visible = show;
      for (const a of b.arms) a.scale.y = 5.85 - y;
    }
    coil.rotation.z -= dt * SIM.rate * sp * 0.25;
  });

  // =============== 焊装车间 Z03 ===============
  const cg = carGeoms();
  P.def('biw_body', cg.body, MAT.biw); P.def('biw_glass', cg.glass, MAT.biw);
  const weldRobots = [];
  const cells = [];
  const jig = M('jig', { color: 0x30343a, roughness: 0.5, metalness: 0.5 });
  const hood = M('hood', { color: 0x8a8d90, roughness: 0.45, metalness: 0.6 });
  [-42, -34, -26, -18].forEach((cx, ci) => {
    for (const cz of [13, 27]) {
      // 夹具 + 白车身
      B.box(jig, 4.6, 0.32, 1.9, cx, 0.16, cz);
      for (const dx of [-1.9, -0.6, 0.6, 1.9]) for (const dz of [-0.85, 0.85]) { B.box(jig, 0.14, 0.62, 0.14, cx + dx, 0.6, cz + dz); B.box(MAT.orange, 0.2, 0.08, 0.1, cx + dx, 0.95, cz + dz * 0.92); }
      const body = P.group(); body.position.set(cx, 0.58, cz); P.node('biw_body', body); P.node('biw_glass', body);
      // 两台机器人（隔着车身相对）
      const ids = 'WB-0' + (ci + 1);
      const r1 = makeRobot(P, cx - 0.9, 0, cz - 2.25, -Math.PI / 2 + 0.1, 'o', 'gun');
      const r2 = makeRobot(P, cx + 0.9, 0, cz + 2.25, Math.PI / 2 + 0.1, 'o', 'gun');
      for (const r of [r1, r2]) { r.id = ids; r.cz = cz; weldRobots.push(r); B.box(MAT.graphite, 0.5, 1.1, 0.5, r.root.position.x + (r === r1 ? -1.2 : 1.2), 0.55, r.root.position.z); }
      // 围栏（三面）+ 光幕开口
      const open = cz < 20 ? -1 : 1;
      const zf = cz + open * 2.9, zb = cz - open * 2.9;
      fenceRun(cx - 3.3, zb, cx + 3.3, zb, 1.9); fenceRun(cx - 3.3, cz - 2.9, cx - 3.3, cz + 2.9, 1.9); fenceRun(cx + 3.3, cz - 2.9, cx + 3.3, cz + 2.9, 1.9);
      fenceRun(cx - 3.3, zf, cx - 1.2, zf, 1.9); fenceRun(cx + 1.2, zf, cx + 3.3, zf, 1.9);
      lc(cx, zf, 0, 2.2);
      // 抽烟尘罩 + 立管
      B.geom(hood, rbox(3.6, 0.4, 2.6, 0.08), trs(cx, 4.4, cz));
      B.geom(hood, new THREE.CylinderGeometry(0.32, 0.32, 8.6, 14), trs(cx + (cz < 20 ? -1.5 : 1.5), 4.6 + 4.3, cz)); // 立管放在巡游镜头穿行路线的外侧
      for (const dx of [-1.7, 1.7]) for (const dz of [-1.2, 1.2]) B.box(steel, 0.08, 4.2, 0.08, cx + dx, 2.1, cz + dz);
      // 单元标牌
      B.box(steel, 0.08, 2.6, 0.08, cx - 3.3, 1.3, zf);
      cells.push({ cx, cz, id: ids, body });
    }
    const plate = textPlate([{ t: 'WB-0' + (ci + 1), size: 110, x: 30 }, { t: '焊装单元 WELD CELL', size: 44, x: 34, y: 196 }], { w: 512, h: 256, bg: 'rgba(28,30,33,0.95)', border: '#f2a73b' });
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ map: plate, toneMapped: false, color: 0xbbbbbb }));
    pm.position.set(cx - 2.4, 3.0, 17.0); pm.rotation.y = 0.0; pm.updateMatrix(); pm.matrixAutoUpdate = false; scene.add(pm);
    B.box(steel, 0.06, 3.1, 0.06, cx - 2.4, 1.55, 16.96);
  });

  upd.push((dt, time) => {
    for (const r of weldRobots) {
      const sp = SIM.speed(r.id);
      r.t += dt * SIM.rate * sp;
      const t = r.t + r.ph;
      r.j1.rotation.y = 0.55 * Math.sin(t * 0.42) + 0.12 * Math.sin(t * 1.1);
      r.j2.rotation.z = -(0.42 + 0.22 * Math.sin(t * 0.63 + 1.2));
      r.j3.rotation.z = -(0.28 + 0.3 * Math.sin(t * 0.81));
      r.j5.rotation.z = -(0.9 + 0.35 * Math.sin(t * 0.81 + 0.4));
      r.j6.rotation.x = 0.4 * Math.sin(t * 0.5);
      const weld = sp > 0.5 && Math.sin(t * 2.2) > 0.35;
      if (weld && ctx.visibleFx !== false) {
        r.tip.getWorldPosition(tmp);
        const n = Math.random() < 0.6 ? 2 : 1;
        for (let k = 0; k < n; k++) fx.sparks.emit(tmp.x, tmp.y, tmp.z, rr(-1.8, 1.8), rr(0.4, 2.6), rr(-1.8, 1.8), rr(0.35, 0.8), 1.0, 0.72, 0.35);
        if (Math.random() < 0.5) fx.flash.emit(tmp.x, tmp.y, tmp.z, 0, 0, 0, 0.06, 0.9, 0.85, 0.75);
      }
    }
  });

  // =============== 涂装车间 Z04 ===============
  const bx0 = -8.6, bx1 = 12.9, bz0 = -21.5, bz1 = -7.0, bh = 6.0;
  const frame = M('boothFrame', { color: 0x2a2d31, roughness: 0.45, metalness: 0.55 });
  B.box(M('grating', { color: 0x3a3c3e, roughness: 0.7, metalness: 0.5 }), bx1 - bx0, 0.35, bz1 - bz0, (bx0 + bx1) / 2, 0.175, (bz0 + bz1) / 2);
  // 玻璃墙（南 / 东 / 西 / 北）+ 框
  const gwall = (a, b, c, d, hole) => {
    const L = Math.hypot(b - a, d - c), ry = a === b ? Math.PI / 2 : 0, cx = (a + b) / 2, cz = (c + d) / 2;
    const P0 = (t) => [a + (b - a) * t, c + (d - c) * t];
    const spans = hole ? [[0, hole[0] - 1.6], [hole[0] + 1.6, L]] : [[0, L]];
    for (const [s0, s1] of spans) { const [mx, mz] = P0((s0 + s1) / 2 / L); B.box(MAT.glass, s1 - s0, bh - 0.6, 0.04, mx, 0.35 + (bh - 0.6) / 2, mz, ry); B.box(frame, s1 - s0, 0.25, 0.16, mx, 0.35 + 0.12, mz, ry); }
    if (hole) { const [mx, mz] = P0(hole[0] / L); B.box(MAT.glass, 3.2, bh - 3.2, 0.04, mx, 2.9 + (bh - 3.2) / 2, mz, ry); B.box(frame, 3.3, 0.16, 0.18, mx, 2.85, mz, ry); B.box(M('stripCurtain', { color: 0x9aa8b0, roughness: 0.3, transparent: true, opacity: 0.25, depthWrite: false }, { grime: 0, shadow: false }), 3.1, 2.4, 0.02, mx, 1.6, mz, ry); }
    B.box(frame, L, 0.18, 0.18, cx, bh, cz, ry);
    for (let s = 0; s <= L + 0.01; s += 2.4) { if (hole && Math.abs(s - hole[0]) < 1.7) continue; const t = Math.min(1, s / L); B.box(frame, 0.1, bh - 0.35, 0.12, a + (b - a) * t, 0.35 + (bh - 0.35) / 2, c + (d - c) * t, ry); }
  };
  gwall(bx0, bx1, bz1, bz1); gwall(bx0, bx1, bz0, bz0, [-7.9 - bx0]); gwall(bx0, bx0, bz0, bz1, [-11.5 - bz0]); gwall(bx1, bx1, bz0, bz1);
  // 顶棚：过滤格栅（半透明）+ 框
  B.box(M('ceilFilter', { color: 0xd9d6cc, roughness: 0.9, transparent: true, opacity: 0.22, depthWrite: false }, { grime: 0, shadow: false }), bx1 - bx0, 0.06, bz1 - bz0, (bx0 + bx1) / 2, bh + 0.08, (bz0 + bz1) / 2);
  for (let x = bx0; x <= bx1 + 0.01; x += 2.4) B.box(frame, 0.08, 0.14, bz1 - bz0, x, bh + 0.08, (bz0 + bz1) / 2);
  for (let z = bz0; z <= bz1 + 0.01; z += 2.4) B.box(frame, bx1 - bx0, 0.14, 0.08, (bx0 + bx1) / 2, bh + 0.08, z);
  // 室内照明条
  for (const z of [-8.0, -15.0, -20.4]) B.box(MAT.lampW, bx1 - bx0 - 1, 0.04, 0.12, (bx0 + bx1) / 2, bh - 0.12, z);
  // 地面滑橇输送
  const skid = M('skid', { color: 0x55595e, roughness: 0.5, metalness: 0.6 });
  for (const z of [-11.5, -18.5]) for (const dz of [-0.55, 0.55]) B.box(skid, bx1 - bx0 - 1.2, 0.1, 0.12, (bx0 + bx1) / 2, 0.42, z + dz);
  // 涂装机器人（7 轴导轨）
  const paintRobots = [];
  for (const [x, z, yaw] of [[-2.2, -8.35, Math.PI / 2], [5.6, -8.35, Math.PI / 2], [-2.2, -14.65, -Math.PI / 2], [5.6, -14.65, -Math.PI / 2]]) {
    if (x < 0) { B.box(frame, 12.4, 1.0, 0.8, 1.7, 0.85, z); B.box(MAT.yellow, 12.4, 0.04, 0.82, 1.7, 1.37, z); }
    const r = makeRobot(P, x, 1.35, z, yaw, 'w', 'bell'); r.id = 'PT-01'; r.x0 = x; paintRobots.push(r);
  }
  // 烘房（保温板）+ 发光炉口
  const ox0 = -8.0, ox1 = 12.4, oz0 = -31, oz1 = -23.6, oh = 5.0;
  const ovenMat = M('ovenPanel', { color: 0xc6c0b2, roughness: 0.62, metalness: 0.15 });
  B.box(ovenMat, ox1 - ox0, oh, 0.3, (ox0 + ox1) / 2, oh / 2, oz0 + 0.15); B.box(ovenMat, ox1 - ox0, oh, 0.3, (ox0 + ox1) / 2, oh / 2, oz1 - 0.15);
  B.box(ovenMat, ox1 - ox0, 0.4, oz1 - oz0, (ox0 + ox1) / 2, oh - 0.2, (oz0 + oz1) / 2);
  for (let x = ox0; x <= ox1; x += 1.7) { B.box(frame, 0.08, oh, 0.04, x, oh / 2, oz1 + 0.01); B.box(frame, 0.08, oh, 0.04, x, oh / 2, oz0 - 0.01); }
  ctx.ovenMouths = [];
  for (const xe of [ox0, ox1]) {
    const s = xe === ox0 ? -1 : 1;
    B.box(ovenMat, 0.3, oh, 2.0, xe, oh / 2, oz0 + 1.0 + 0.0); B.box(ovenMat, 0.3, oh, 2.0, xe, oh / 2, oz1 - 1.0);
    B.box(ovenMat, 0.3, oh - 2.7, oz1 - oz0, xe, 2.7 + (oh - 2.7) / 2, (oz0 + oz1) / 2);
    const zc = (oz0 + oz1) / 2;
    for (const dz of [-1.72, 1.72]) B.box(MAT.hot, 3.2, 2.6, 0.04, xe - s * 1.75, 1.3, zc + dz);
    B.box(MAT.hot, 3.2, 0.04, 3.4, xe - s * 1.75, 2.66, zc);
    B.box(M('ovenInner', { color: 0x3a2a20, roughness: 0.8, emissive: 0x7a300c, emissiveIntensity: 1.3 }, { grime: 0.2 }), 3.4, 0.04, 3.4, xe - s * 1.75, 0.37, zc);
  }
  // 屋顶 AHU、风管、排烟筒
  B.geom(MAT.ivory, rbox(7, 2.2, 3.4, 0.1), trs(-2.0, oh + 1.1, -27.3)); B.geom(MAT.ivory, rbox(6, 2.0, 3.2, 0.1), trs(7.5, oh + 1.0, -27.3));
  for (let k = 0; k < 4; k++) B.geom(MAT.graphite, new THREE.CylinderGeometry(0.55, 0.55, 0.25, 18), trs(-4.5 + k * 1.7, oh + 2.3, -27.3));
  B.box(MAT.steel, 1.0, 1.0, 5.8, -2.0, oh + 1.8, -22.5); B.box(MAT.steel, 1.0, 1.0, 5.8, 7.5, oh + 1.8, -22.5);
  B.box(MAT.steel, 1.0, 1.6, 1.0, -2.0, bh + 0.9, -19.8); B.box(MAT.steel, 1.0, 1.6, 1.0, 7.5, bh + 0.9, -19.8);
  for (const x of [-6.3, 10.6]) { B.geom(MAT.steel, new THREE.CylinderGeometry(0.42, 0.42, 14.2, 18), trs(x, oh + 7.1, -28.4)); B.geom(MAT.graphite, new THREE.CylinderGeometry(0.5, 0.42, 0.6, 18), trs(x, oh + 14.4, -28.4)); }
  ctx.paintRobots = paintRobots;
  upd.push((dt) => {
    const sp = SIM.speed('PT-01');
    for (const r of paintRobots) {
      r.t += dt * SIM.rate * sp; const t = r.t + r.ph;
      r.j1.rotation.y = 0.6 * Math.sin(t * 0.9);
      r.j2.rotation.z = -(0.3 + 0.2 * Math.sin(t * 0.7));
      r.j3.rotation.z = -(0.2 + 0.35 * Math.sin(t * 1.4 + 0.6));
      r.j5.rotation.z = -(0.8 + 0.3 * Math.sin(t * 1.4));
      r.root.position.x = r.x0 + 1.4 * Math.sin(t * 0.33);
      if (sp > 0.5 && ctx.visibleFx !== false) {
        r.tip.getWorldPosition(tmp);
        for (let k = 0; k < 2; k++) fx.mist.emit(tmp.x, tmp.y, tmp.z, rr(-0.5, 0.5), rr(-1.2, -0.2), rr(-0.5, 0.5), rr(0.6, 1.1), 0.09, 0.085, 0.08);
      }
    }
  });

  // =============== 车身流：焊装 → 涂装 → 烘房 → 空中输送 → 总装 ===============
  P.def('car_body', cg.body, MAT.paint, { color: true });
  P.def('car_glass', cg.glass, MAT.glassDark);
  P.def('hanger', mergeT([[new THREE.BoxGeometry(0.12, 2.0, 0.12), mtx(-1.6, 2.4, 0)], [new THREE.BoxGeometry(0.12, 2.0, 0.12), mtx(1.6, 2.4, 0)], [new THREE.BoxGeometry(3.4, 0.12, 0.12), mtx(0, 3.4, 0)], [new THREE.BoxGeometry(3.6, 0.1, 1.5), mtx(0, 0.18, 0)], [new THREE.BoxGeometry(0.1, 0.1, 1.6), mtx(-1.6, 0.25, 0)], [new THREE.BoxGeometry(0.1, 0.1, 1.6), mtx(1.6, 0.25, 0)], [rbox(0.5, 0.3, 0.3, 0.05), mtx(0, 3.65, 0)]]), MAT.graphite);
  P.def('skidCar', mergeT([[new THREE.BoxGeometry(4.0, 0.12, 0.14), mtx(0, 0.06, 0.55)], [new THREE.BoxGeometry(4.0, 0.12, 0.14), mtx(0, 0.06, -0.55)], [new THREE.BoxGeometry(0.12, 0.3, 1.2), mtx(-1.4, 0.2, 0)], [new THREE.BoxGeometry(0.12, 0.3, 1.2), mtx(1.4, 0.2, 0)]]), MAT.steelDark);
  const OH = 6.0; // 吊具轨道高度上的车身底标高
  const pBW = new Path([[-14.6, OH, 20], [-11.5, OH, 20], [-11.5, OH, -8.2], [-11.5, 0.45, -9.6], [-11.5, 0.45, -11.5], [12.2, 0.45, -11.5], [12.2, 0.45, -18.5], [-7.9, 0.45, -18.5], [-7.9, 0.45, -27.3], [11.0, 0.45, -27.3]], { round: 1.4 });
  let sPaint = 0; { const o = {}; for (let s = 0; s < pBW.L; s += 0.1) { pBW.at(s, o); if (o.y < 1 && o.x > 1 && o.z > -12.5) { sPaint = s; break; } } }
  const fBW = new Flow(pBW, 20, { speed: 0.85, hideEnds: 0.4 });
  const bodyColor = [];
  for (let i = 0; i < 20; i++) {
    const g = P.group(); const b = P.node('car_body', g, '#9aa0a6'); P.node('car_glass', g); const h = P.node('hanger', g); const sk = P.node('skidCar', g);
    g.userData = { b, h, sk, col: PAINT_COLORS[i % PAINT_COLORS.length], painted: null };
    fBW.add(g);
  }
  // 空中输送：烘房出口 → 横向通道 x=15 → 两条总装线线首
  const mkOH = (z) => new Path([[11.0, 0.45, -27.3], [15.0, 0.45, -27.3], [15.0, 0.45, -25.2], [15.0, OH, -24.0], [15.0, OH, z], [17.6, OH, z], [17.6, 0.7, z]], { round: 1.4 });
  const fA = [new Flow(mkOH(12), 7, { speed: 0.9, hideEnds: 0.3 }), new Flow(mkOH(28), 8, { speed: 0.9, hideEnds: 0.3, offset: 2.5 })];
  fA.forEach((f, fi) => { for (let i = 0; i < f.n; i++) { const g = P.group(); const b = P.node('car_body', g, PAINT_COLORS[(i * 3 + fi) % 8]); P.node('car_glass', g); const h = P.node('hanger', g); g.userData = { b, h }; f.add(g); } });
  // 轨道（工字钢）+ 吊杆
  const rail = (a, b) => { B.beam(MAT.steelDark, [a[0], OH + 3.75, a[2]], [b[0], OH + 3.75, b[2]], 0.24, 0.16); };
  const railPts = [[-14.6, 0, 20], [-11.5, 0, 20], [-11.5, 0, -8.6], null, [15, 0, -24.4], [15, 0, 28], [17.6, 0, 28], null, [15, 0, 12], [17.6, 0, 12]];
  for (let i = 0; i < railPts.length - 1; i++) if (railPts[i] && railPts[i + 1]) rail(railPts[i], railPts[i + 1]);
  for (const [x, z0, z1] of [[-11.5, -9, 20], [15, -26, 28]]) for (let z = z0; z <= z1; z += 4) { B.box(steel, 0.06, 13.6 - OH - 3.8, 0.06, x, (13.6 + OH + 3.8) / 2, z); B.box(steel, 0.8, 0.12, 0.12, x, OH + 3.95, z); }
  // 升降机框架（入涂装 / 出烘房 / 线首）
  for (const [x, z, rot] of [[-11.5, -8.9, 1], [15, -24.6, 1], [18.2, 12, 0], [18.2, 28, 0]]) { const a = rot ? 1.35 : 2.7, b = rot ? 2.7 : 1.35; for (const dx of [-a, a]) for (const dz of [-b, b]) B.box(MAT.yellow, 0.16, OH + 3.4, 0.16, x + dx, (OH + 3.4) / 2, z + dz); B.box(MAT.yellow, rot ? 2.9 : 5.6, 0.2, rot ? 5.6 : 2.9, x, OH + 3.4, z); }
  const pc = new THREE.Color();
  upd.push((dt) => {
    const spP = Math.min(SIM.speed('PT-01'), SIM.speed('OV-01') > 0 ? 1 : 0.0) * Math.min(1, SIM.speed('OC-01') + 0.6);
    fBW.update(dt * SIM.rate, spP, (it, s, o) => {
      const u = it.node.userData;
      const overhead = o.y > 2;
      u.h.visible = overhead; u.sk.visible = !overhead;
      // 进喷涂段后变色
      const painted = s >= sPaint;
      if (painted !== u.painted) { u.painted = painted; P.setColor(u.b, painted ? u.col : '#9aa0a6'); }
    });
    const spO = SIM.speed('OC-01');
    for (const f of fA) f.update(dt * SIM.rate, spO, (it, s, o) => { it.node.userData.h.visible = o.y > 1.2; });
  });

  ctx.process = { presses, bars, weldRobots, paintRobots, cells };
  ctx.updaters.push((dt, t) => { for (const f of upd) f(dt, t); fx.sparks.update(dt); fx.flash.update(dt); fx.mist.update(dt); });
}
