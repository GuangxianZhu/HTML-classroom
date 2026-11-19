// 50-assembly：两条总装线（13 工位 × 3.4 m）、车辆、操作工、EOL 光廊、四轮定位、滚台、暂存、发运
import * as THREE from 'three';
import { C, M, MAT, trs, rr, R, ri, pick, clamp, smooth, textPlate } from './util.js';
import { carGeoms, rbox, mergeT, mtx } from './geo.js';
import { makeRobot } from './process.js';
import { PAINT_COLORS } from './process.js';
import { Path } from './path.js';
import { SIM } from './sim.js';
import { LINES, LINE_X0, PITCH, NST, HALL, DOOR_RODS } from './layout.js';

export function buildAssembly(ctx) {
  const { B, P, scene } = ctx;
  const steel = ctx.MAT.structure;
  const upd = [];
  const cg = carGeoms();
  P.def('car_body', cg.body, MAT.paint, { color: true });
  P.def('car_glass', cg.glass, MAT.glassDark);
  P.def('car_tires', cg.tires, MAT.rubber);
  P.def('car_rims', cg.rims, M('rim', { color: 0xa9aeb3, roughness: 0.28, metalness: 0.9 }, { grime: 0.2 }));
  P.def('car_lf', cg.lightF, MAT.lampW, { shadow: false });
  P.def('car_lr', cg.lightR, MAT.lampRed, { shadow: false });
  P.def('battery', mergeT([[rbox(2.7, 0.16, 1.5, 0.03), mtx(0, 0.18, 0)], [new THREE.BoxGeometry(2.5, 0.03, 1.3), mtx(0, 0.27, 0)]]), M('battery', { color: 0x2c3036, roughness: 0.5, metalness: 0.45 }));
  P.def('carrier', mergeT([[new THREE.BoxGeometry(3.4, 0.16, 2.2), mtx(0, 0.08, 0)], [new THREE.BoxGeometry(0.2, 0.7, 0.2), mtx(-0.75, 0.51, -0.7)], [new THREE.BoxGeometry(0.2, 0.7, 0.2), mtx(-0.75, 0.51, 0.7)], [new THREE.BoxGeometry(0.2, 0.7, 0.2), mtx(0.75, 0.51, -0.7)], [new THREE.BoxGeometry(0.2, 0.7, 0.2), mtx(0.75, 0.51, 0.7)]]), MAT.steelDark);

  const makeCar = (parent, col, full = true) => {
    const g = P.group(parent);
    const body = P.node('car_body', g, col); P.node('car_glass', g);
    const tires = P.node('car_tires', g), rims = P.node('car_rims', g);
    const lf = P.node('car_lf', g), lr = P.node('car_lr', g);
    if (!full) { tires.visible = rims.visible = lf.visible = lr.visible = false; }
    return { g, body, tires, rims, lf, lr };
  };
  ctx.makeCar = makeCar;

  // =============== 两条总装线 ===============
  const slat = M('slat', { color: 0x4a4e53, roughness: 0.55, metalness: 0.5 });
  const station = M('stationFrame', { color: 0x2e3238, roughness: 0.5, metalness: 0.45 });
  const binMat = M('binLine', { color: 0xffffff, roughness: 0.6 }, { grime: 0.5 });
  P.def('binS', rbox(0.5, 0.26, 0.36, 0.03), binMat, { color: true, dyn: false });
  const binCols = ['#56687a', '#6d7175', '#4d5a55', '#7a6a55', '#8a8f95', '#5b6470'];
  P.def('balancer', mergeT([[new THREE.CylinderGeometry(0.12, 0.12, 0.3, 12), mtx(0, 0, 0)], [new THREE.BoxGeometry(0.012, 1.2, 0.012), mtx(0, -0.75, 0)], [rbox(0.12, 0.34, 0.12, 0.03), mtx(0, -1.5, 0)]]), MAT.graphite);
  const lines = [];
  LINES.forEach((L, li) => {
    const z = L.z;
    // 板链输送（略高于地面）+ 板条
    B.box(slat, 45.2, 0.12, 2.6, 39.6, 0.06, z);
    for (let x = 17.2; x < 62; x += 0.6) B.box(MAT.steelDark, 0.04, 0.02, 2.5, x, 0.125, z);
    B.box(MAT.yellow, 45.2, 0.03, 0.08, 39.6, 0.135, z - 1.34); B.box(MAT.yellow, 45.2, 0.03, 0.08, 39.6, 0.135, z + 1.34);
    for (let k = 0; k < NST; k++) {
      const x = LINE_X0 + k * PITCH;
      // 工具平衡器门架
      B.box(station, 0.14, 3.4, 0.14, x - 1.55, 1.7, z - 2.7); B.box(station, 0.14, 3.4, 0.14, x - 1.55, 1.7, z + 2.7);
      B.box(station, 0.16, 0.18, 5.6, x - 1.55, 3.4, z);
      B.box(station, 3.2, 0.12, 0.12, x, 3.4, z - 2.7); B.box(station, 3.2, 0.12, 0.12, x, 3.4, z + 2.7);
      for (const dz of [-1.3, 1.3]) { const b = P.node('balancer'); b.position.set(x + (dz > 0 ? 0.4 : -0.4), 3.25, z + dz); b.userData.k = k; }
      // 工位号牌
      B.box(MAT.graphite, 0.5, 0.26, 0.04, x - 1.55, 3.0, z + 2.78);
      // 线边零件超市（流利架）
      if (k % 2 === 0 && k !== 6) {
        const zs = z - 4.1;
        B.box(station, 2.6, 0.06, 0.9, x, 0.06 + 0.4, zs); B.box(station, 0.06, 1.9, 0.06, x - 1.25, 0.95, zs - 0.42); B.box(station, 0.06, 1.9, 0.06, x + 1.25, 0.95, zs - 0.42); B.box(station, 0.06, 1.6, 0.06, x - 1.25, 0.8, zs + 0.42); B.box(station, 0.06, 1.6, 0.06, x + 1.25, 0.8, zs + 0.42);
        for (let s = 0; s < 3; s++) { const y = 0.55 + s * 0.48; B.box(MAT.steel, 2.5, 0.03, 0.9, x, y, zs, 0, 0.16); for (let b = 0; b < 4; b++) { const n = P.node('binS', P.root, pick(binCols)); n.position.set(x - 0.93 + b * 0.62, y + 0.17, zs); n.rotation.x = 0.16; } }
      }
    }
    // 电池合装升降台（第 3 工位）
    const xb = LINE_X0 + 2 * PITCH;
    B.box(MAT.graphite, 3.0, 0.2, 1.8, xb, 0.1, z);
    const liftNode = P.group(); liftNode.position.set(xb, 0, z);
    P.def('battLift', mergeT([[new THREE.BoxGeometry(2.8, 0.1, 1.6), mtx(0, 0, 0)], [new THREE.BoxGeometry(0.08, 0.6, 1.5), mtx(-0.9, -0.3, 0, 0, 0, 0.6)], [new THREE.BoxGeometry(0.08, 0.6, 1.5), mtx(0.9, -0.3, 0, 0, 0, -0.6)]]), MAT.yellow);
    const lift = P.node('battLift', liftNode);
    const liftBatt = P.node('battery', liftNode);
    // 拧紧站（第 5 工位，多轴拧紧机）
    const xt = LINE_X0 + 4 * PITCH;
    B.box(MAT.graphite, 0.4, 2.6, 0.4, xt, 1.3, z + 3.3); B.box(MAT.graphite, 2.2, 0.2, 0.25, xt, 2.5, z + 2.3); B.geom(MAT.steel, new THREE.CylinderGeometry(0.1, 0.1, 0.9, 12), trs(xt, 1.95, z + 1.3));
    B.box(MAT.screen, 0.5, 0.35, 0.02, xt + 0.3, 1.6, z + 3.08);
    // 加注机（第 10 工位）
    const xf = LINE_X0 + 9 * PITCH;
    B.geom(MAT.ivory, rbox(1.4, 2.3, 0.9, 0.08), trs(xf, 1.15, z + 3.6)); B.box(MAT.screen, 0.6, 0.4, 0.02, xf, 1.75, z + 3.14);
    for (let h = 0; h < 3; h++) B.geom(MAT.rubber, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(xf - 0.4 + h * 0.4, 2.2, z + 3.2), new THREE.Vector3(xf - 0.3 + h * 0.3, 3.0, z + 2.2), new THREE.Vector3(xf - 0.2 + h * 0.2, 2.4, z + 1.4)]), 10, 0.03, 5, false));
    // 轮胎排序架（第 11 工位）
    const xw = LINE_X0 + 10 * PITCH;
    for (let s = 0; s < 2; s++) for (let i = 0; i < 5; i++) { B.geom(MAT.rubber, cg.tire, trs(xw - 1.2 + i * 0.6, 0.65 + s * 0.85, z + 3.6, Math.PI / 2)); B.geom(M('rim'), cg.rim, trs(xw - 1.2 + i * 0.6, 0.65 + s * 0.85, z + 3.6, Math.PI / 2)); }
    B.box(station, 3.4, 0.06, 0.8, xw, 0.3, z + 3.6); B.box(station, 3.4, 0.06, 0.8, xw, 1.15, z + 3.6);
    // 座椅 / 玻璃机器人（第 7、8 工位，北侧）
    const robots = [];
    for (const [k, tool] of [[6, 'grip'], [7, 'grip']]) {
      const x = LINE_X0 + k * PITCH;
      B.box(MAT.graphite, 1.0, 0.5, 1.0, x, 0.25, z - 2.55);
      const r = makeRobot(P, x, 0.5, z - 2.55, -Math.PI / 2, 'o', tool); r.id = L.id; robots.push(r);
      // 物料架（玻璃 / 座椅）
      B.box(station, 1.6, 1.0, 0.8, x, 0.5, z - 4.45);
      if (k === 6) for (let g = 0; g < 4; g++) B.box(M('glassStack', { color: 0x30404a, roughness: 0.1, metalness: 0.5 }), 1.5, 0.03, 0.75, x, 1.05 + g * 0.06, z - 4.45);
      else for (let g = 0; g < 2; g++) B.geom(M('seat', { color: 0x2b2b2e, roughness: 0.8 }), rbox(0.55, 0.6, 0.55, 0.1), trs(x - 0.35 + g * 0.7, 1.3, z - 4.45));
    }
    // 门线（空中输送链，北侧回送车门）
    const zc = z - 3.6;
    B.box(MAT.steelDark, 45, 0.22, 0.14, 39.6, 5.2, zc);
    for (const x of DOOR_RODS) B.box(steel, 0.05, 13.6 - 5.3, 0.05, x, 5.3 + (13.6 - 5.3) / 2, zc); // 吊杆避开巡游镜头穿过的位置
    // 线首 / 线尾标牌
    for (const [x, t, e] of [[17.4, '线首', 'LINE HEAD'], [61.9, '线尾', 'LINE END']]) {
      const tex = textPlate([{ t: L.id, size: 120, x: 36, y: 86 }, { t: t + '  ' + e, size: 50, x: 40, y: 186 }], { w: 512, h: 256, bg: 'rgba(26,28,31,0.96)', border: '#f2a73b' });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ map: tex, color: 0xc2c2c2 }));
      m.position.set(x - 0.03, 4.4, z + 2.75); m.rotation.y = -Math.PI / 2; m.updateMatrix(); m.matrixAutoUpdate = false; scene.add(m);
      B.box(steel, 0.05, 13.6 - 5, 0.05, x, 5 + (13.6 - 5) / 2, z + 2.75);
    }
    lines.push({ L, z, robots, lift, liftBatt, xb, cars: [], doors: [] });
  });
  // 门线吊具 + 车门
  P.def('doorHook', mergeT([[new THREE.BoxGeometry(0.08, 1.0, 0.08), mtx(0, -0.5, 0)], [new THREE.BoxGeometry(0.4, 0.08, 0.08), mtx(0, -1.0, 0)]]), MAT.graphite);
  P.def('door', mergeT([[rbox(1.15, 0.95, 0.08, 0.03), mtx(0, -1.55, 0)], [new THREE.BoxGeometry(0.9, 0.4, 0.04), mtx(0.05, -0.9, 0)]]), MAT.paint, { color: true });

  // 车辆：每线 8 台，节拍 58 s（仿真）→ 实时 58/8 s 走一个车距
  const SP = 45 / 8; // 车距 5.625 m
  for (const ln of lines) {
    for (let i = 0; i < 8; i++) {
      const col = pick(PAINT_COLORS);
      const c = makeCar(null, col, false);
      const carrier = P.node('carrier', c.g); carrier.position.y = -0.62;
      const batt = P.node('battery', c.g); batt.position.y = 0.02;
      c.g.position.set(17.6 + i * SP, 0.62, ln.z);
      ln.cars.push({ ...c, carrier, batt, x: 17.6 + i * SP, col });
    }
    for (let i = 0; i < 9; i++) { const h = P.node('doorHook'); const d = P.node('door', h, pick(PAINT_COLORS)); ln.doors.push({ h, d, x: 18 + i * 5 }); }
  }

  // =============== 操作工 ===============
  const vests = ['#c27a3a', '#b8a456', '#3e5a78', '#c27a3a', '#9aa0a6'];
  const workers = [];
  const wpos = [[0, 1], [2, -1], [3, 1], [5, -1], [8, 1], [9, -1], [11, 1], [12, -1]];
  let wn = 0;
  for (const ln of lines) for (const [k, side] of wpos) {
    if (wn >= 15) break;
    const w = ctx.makeWorker(null, { vest: vests[wn % vests.length], helmet: wn % 4 === 0 ? '#c9a23c' : '#e2ddd0' });
    const x = LINE_X0 + k * PITCH + rr(-0.6, 0.6);
    w.root.position.set(x, 0, ln.z + side * 1.95); w.root.rotation.y = side > 0 ? Math.PI : 0; w.x0 = x; w.ln = ln; w.mode = 'work';
    workers.push(w); wn++;
  }
  // 巡检 / 走动人员
  const walkers = [];
  const walkPaths = [new Path([[20, 0, 20], [60, 0, 20]], {}), new Path([[-44, 0, 4.2], [8, 0, 4.2]], {}), new Path([[64.5, 0, 33.5], [64.5, 0, 6.5]], {}), new Path([[-46, 0, -11], [-14.5, 0, -11]], {})];
  walkPaths.forEach((p, i) => { const w = ctx.makeWorker(null, { vest: i % 2 ? '#3e5a78' : '#b8a456', helmet: '#e2ddd0' }); w.path = p; w.s = rr(0, p.L); w.dir = 1; walkers.push(w); });
  // 中控室 + 维修间 + 冲压操作台
  const seated = [];
  for (const [x, z] of [[19.6, -33.0], [23.0, -33.0], [26.4, -30.2]]) { const w = ctx.makeWorker(null, { vest: '#3e5a78', helmet: '#3e5a78' }); w.root.position.set(x, 0.15, z); w.root.rotation.y = Math.PI; w.hel = true; seated.push(w); }
  { const w = ctx.makeWorker(null, { vest: '#3e5a78' }); w.root.position.set(50.8, 0, -35.9); w.root.rotation.y = Math.PI; w.mode = 'work'; workers.push(w); }
  { const w = ctx.makeWorker(null, { vest: '#c27a3a' }); w.root.position.set(-36.6, 0, -16.2); w.root.rotation.y = Math.PI * 0.85; w.mode = 'idle'; workers.push(w); }
  { const w = ctx.makeWorker(null, { vest: '#b8a456' }); w.root.position.set(73.8, 0, 31.6); w.root.rotation.y = Math.PI / 2; w.mode = 'work'; workers.push(w); }
  // 中控室里坐着的人不戴安全帽
  for (const w of seated) w.hip.children.forEach((c) => { if (c.userData.def && c.userData.def.key === 'w_helmet') c.visible = false; });

  // =============== EOL 光廊 / 四轮定位 / 滚台 / 暂存 ===============
  const tunnelLight = new THREE.MeshBasicMaterial({ color: 0xfff6e6 }); tunnelLight.userData.shadow = false; tunnelLight.name = 'tunnelLight';
  const housing = M('tunnelHousing', { color: 0x2b2e33, roughness: 0.45, metalness: 0.5 });
  for (const L of LINES) {
    const z = L.z, x0 = 63.4, x1 = 69.8;
    B.box(housing, x1 - x0, 3.4, 0.25, (x0 + x1) / 2, 1.7, z - 2.1); B.box(housing, x1 - x0, 3.4, 0.25, (x0 + x1) / 2, 1.7, z + 2.1);
    B.box(housing, x1 - x0, 0.25, 4.45, (x0 + x1) / 2, 3.45, z);
    for (let x = x0 + 0.3; x < x1; x += 0.45) {
      B.box(tunnelLight, 0.06, 2.9, 0.02, x, 1.7, z - 1.96); B.box(tunnelLight, 0.06, 2.9, 0.02, x, 1.7, z + 1.96); B.box(tunnelLight, 0.06, 0.02, 3.9, x, 3.31, z);
    }
    B.box(M('pitFloor', { color: 0x1f2124, roughness: 0.4, metalness: 0.3 }), x1 - x0, 0.02, 3.9, (x0 + x1) / 2, 0.012, z);
    // 四轮定位
    for (const dx of [-1.4, 1.4]) for (const dz of [-0.8, 0.8]) B.box(MAT.steel, 0.7, 0.04, 0.6, 72.0 + dx, 0.03, z + dz);
    for (const dz of [-2.4, 2.4]) { B.geom(MAT.ivory, rbox(0.4, 1.8, 0.4, 0.05), trs(70.6, 0.9, z + dz)); B.geom(MAT.ivory, rbox(0.4, 1.8, 0.4, 0.05), trs(73.4, 0.9, z + dz)); B.box(MAT.screen, 0.3, 0.2, 0.01, 70.6, 1.5, z + dz - Math.sign(dz) * 0.21); }
    // 检测滚台
    B.box(MAT.graphite, 1.6, 0.05, 2.6, 75.2, 0.03, z);
    for (const dx of [-0.35, 0.35]) B.geom(MAT.steel, new THREE.CylinderGeometry(0.18, 0.18, 2.4, 16).rotateX(Math.PI / 2), trs(75.2 + dx, 0.05, z));
    B.box(MAT.graphite, 0.6, 1.3, 0.5, 75.2, 0.65, z + 2.4); B.box(MAT.screen, 0.45, 0.3, 0.01, 75.2, 1.0, z + 2.14);
  }
  // 暂存 6 台
  for (const [x, zz] of [[65.6, 17.2], [65.6, 19.8], [65.6, 22.4], [70.6, 17.2], [70.6, 19.8], [70.6, 22.4]]) { const c = makeCar(null, pick(PAINT_COLORS)); c.g.position.set(x, 0, zz); c.lf.visible = c.lr.visible = false; }
  // 发运区周转架
  for (let i = 0; i < 3; i++) { const x = 75.2, z = 31.0 + i * 1.6; B.box(steel, 1.2, 0.08, 1.4, x, 0.12, z); for (const dx of [-0.55, 0.55]) for (const dz of [-0.65, 0.65]) B.box(steel, 0.05, 1.5, 0.05, x + dx, 0.75, z + dz); B.box(MAT.kraft, 1.0, 0.8, 1.2, x, 0.6, z); }

  // =============== 下线车辆 → EOL → 坡道 → 成品车堆场 ===============
  const A = HALL.apron;
  const finPaths = [
    new Path([[62.6, 0, 12], [79.0, 0, 12], [87.0, A, 12], [91, A, 12], [91, A, 37], [107.1, A, 37], [107.1, A, 43.6]], { round: 3.0 }),
    new Path([[62.6, 0, 28], [79.0, 0, 28], [87.0, A, 28], [98, A, 28], [98, A, 35], [112.3, A, 35], [112.3, A, 43.6]], { round: 3.0 }),
  ];
  const fin = LINES.map(() => []);
  const finPool = LINES.map(() => Array.from({ length: 6 }, () => { const c = makeCar(null, '#888888'); c.g.visible = false; c.active = false; return c; }));
  const STOP = [{ s: 9.4, t: 2.0 }, { s: 12.6, t: 2.4 }]; // 四轮定位 / 滚台（相对线尾的弧长）
  const spawnFinished = (li, col) => {
    const c = finPool[li].find((q) => !q.active); if (!c) return;
    c.active = true; c.s = 0; c.wait = 0; c.stopIdx = 0; c.g.visible = true; P.setColor(c.body, col);
    fin[li].push(c);
  };

  const tmpo = {};
  upd.push((dt) => {
    const simDt = dt * SIM.rate;
    lines.forEach((ln, li) => {
      const sp = SIM.speed(ln.L.id);
      const v = (SP / (SIM.takt / SIM.simX)) * sp;
      for (const c of ln.cars) {
        c.x += v * simDt;
        if (c.x > 62.6) {
          c.x -= 45; SIM.completeUnit('Z06'); spawnFinished(li, c.col);
          c.col = pick(PAINT_COLORS); P.setColor(c.body, c.col);
        }
        c.g.position.set(c.x, 0.62, ln.z);
        const k = (c.x - LINE_X0) / PITCH; // 所在工位
        c.batt.visible = k > 2.1;
        c.tires.visible = c.rims.visible = k > 9.6;
        c.lf.visible = c.lr.visible = k > 11.2;
      }
      // 电池升降台：车经过第 3 工位时顶升
      let near = 9; for (const c of ln.cars) near = Math.min(near, Math.abs(c.x - ln.xb));
      const up = near < 1.4 ? smooth(1 - near / 1.4) : 0;
      ln.lift.position.y = 0.2 + up * 0.32; ln.liftBatt.position.y = 0.07 + up * 0.32; ln.liftBatt.visible = ln.cars.some((c) => c.x < ln.xb && c.x > ln.xb - 2.6);
      // 机器人（取玻璃 / 座椅 → 放到车上）
      for (const r of ln.robots) {
        r.t += simDt * sp; const t = r.t + r.ph; const ph = (t * 0.32) % 1;
        const swing = ph < 0.5 ? smooth(ph / 0.5) : smooth(1 - (ph - 0.5) / 0.5);
        r.j1.rotation.y = Math.PI * (1 - swing);
        r.j2.rotation.z = -(0.35 + 0.25 * Math.sin(ph * Math.PI * 2));
        r.j3.rotation.z = -(0.15 + 0.35 * Math.sin(ph * Math.PI * 4 + 0.5) * 0.5 + 0.2);
        r.j5.rotation.z = -(0.9 + 0.2 * Math.sin(ph * Math.PI * 2));
      }
      // 门线
      for (const d of ln.doors) { d.x -= simDt * sp * 0.55; if (d.x < 17.8) d.x += 45; d.h.position.set(d.x, 5.1, ln.z - 3.6); d.h.visible = d.x > 18 && d.x < 61.6; }
    });
    // 下线车辆
    fin.forEach((arr, li) => {
      const p = finPaths[li]; const spE = SIM.speed('EOL-01');
      for (let i = arr.length - 1; i >= 0; i--) {
        const c = arr[i];
        if (c.wait > 0) { c.wait -= simDt * spE; }
        else {
          const lead = arr[i - 1];
          let v = c.s < 7.5 ? 0.9 : c.s < 13 ? 1.2 : 3.2;
          if (lead && lead.s - c.s < 6.2) v = 0;
          c.s += v * simDt * (c.s < 13 ? spE : 1);
          const st = STOP[c.stopIdx]; if (st && c.s >= st.s) { c.s = st.s; c.wait = st.t; c.stopIdx++; }
        }
        p.at(c.s, tmpo);
        c.g.position.set(tmpo.x, tmpo.y, tmpo.z); c.g.rotation.y = tmpo.yaw;
        // 坡道俯仰
        c.g.rotation.z = tmpo.x > 79 && tmpo.x < 87 && Math.abs(tmpo.z - LINES[li].z) < 0.5 ? -Math.atan2(-HALL.apron, 8) : 0;
        if (c.s >= p.L - 0.05) { c.active = false; c.g.visible = false; arr.splice(i, 1); }
      }
    });
    // 操作工
    for (const w of workers) {
      if (w.ln) {
        // 跟着车走一小段再回位
        const sp = SIM.speed(w.ln.L.id);
        w.root.position.x = w.x0 + Math.sin((w.t * 0.25) % (Math.PI)) * 0.6 * sp;
        ctx.animWorker(w, dt * SIM.rate, sp > 0.5 ? 'work' : 'idle', sp);
      } else ctx.animWorker(w, dt * SIM.rate, w.mode);
    }
    for (const w of walkers) {
      w.s += dt * SIM.rate * 1.1 * w.dir;
      if (w.s > w.path.L) { w.s = w.path.L; w.dir = -1; } if (w.s < 0) { w.s = 0; w.dir = 1; }
      w.path.at(w.s, tmpo); w.root.position.set(tmpo.x, 0, tmpo.z);
      w.root.rotation.y = tmpo.yaw + (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      ctx.animWorker(w, dt * SIM.rate, 'walk');
    }
    for (const w of seated) ctx.animWorker(w, dt, 'sit');
    // EOL 光廊亮度
    const eol = SIM.state('EOL-01');
    const target = eol === 'down' ? 0.25 : eol === 'idle' ? 0.6 : 1;
    ctx._tl = (ctx._tl ?? 1) + (target - (ctx._tl ?? 1)) * Math.min(1, dt * 4);
    tunnelLight.color.setRGB(1.0 * ctx._tl * 1.25, 0.96 * ctx._tl * 1.25, 0.9 * ctx._tl * 1.25);
  });

  ctx.assembly = { lines, workers, walkers, fin };
  ctx.updaters.push((dt, t) => { for (const f of upd) f(dt, t); });
}
