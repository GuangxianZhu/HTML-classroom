// 30-building：地面涂装、剖切厂房、桁架、辅助房、室外硬景、能源站
import * as THREE from 'three';
import { C, M, MAT, canvasTex, boxUV, trs, rr, R, pick, textPlate } from './util.js';
import { HALL, ZONES, LINES, LINE_X0, PITCH, NST } from './layout.js';
import { carGeoms, mtx, mergeT } from './geo.js';

const KX = 4096 / 156, KZ = 2100 / 80;
const fx = (x) => (x + 78) * KX, fz = (z) => (z + 40) * KZ;

function paintFloor() {
  return canvasTex(4096, 2100, (g, W, H) => {
    // 抛光混凝土底色 + 斑驳
    g.fillStyle = '#8a857d'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) {
      const x = R() * W, y = R() * H, r = 20 + R() * 160, l = R() < 0.5 ? 0 : 255;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${l},${l},${l},${0.018 + R() * 0.03})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    // 分区涂层
    const zoneTone = { Z01: 'rgba(40,38,34,0.08)', Z02: 'rgba(28,25,22,0.20)', Z03: 'rgba(78,88,82,0.30)', Z04: 'rgba(200,200,194,0.16)', Z05: 'rgba(86,98,93,0.32)', Z06: 'rgba(78,86,94,0.28)' };
    for (const z of ZONES) { const [a, b, c, d] = z.rect; g.fillStyle = zoneTone[z.id]; g.fillRect(fx(a), fz(c), (b - a) * KX, (d - c) * KZ); }
    g.fillStyle = 'rgba(70,74,78,0.22)'; g.fillRect(fx(16), fz(-40), 44 * KX, 16 * KZ);
    // 锯缝 6 m
    g.strokeStyle = 'rgba(38,34,30,0.32)'; g.lineWidth = 1.2;
    for (let x = -78; x <= 78; x += 6) { g.beginPath(); g.moveTo(fx(x), 0); g.lineTo(fx(x), H); g.stroke(); }
    for (let z = -40; z <= 40; z += 6) { g.beginPath(); g.moveTo(0, fz(z)); g.lineTo(W, fz(z)); g.stroke(); }
    // AGV 中央脊线
    g.fillStyle = 'rgba(30,30,33,0.42)'; g.fillRect(fx(-50), fz(-3), 114 * KX, 6 * KZ);
    const yellow = '#c3a03e';
    const line = (x0, z0, x1, z1, w = 0.12, col = yellow) => { g.strokeStyle = col; g.lineWidth = w * KX; g.beginPath(); g.moveTo(fx(x0), fz(z0)); g.lineTo(fx(x1), fz(z1)); g.stroke(); };
    line(-50, -3, 64, -3); line(-50, 3, 64, 3);
    g.setLineDash([2 * KX, 2 * KX]); line(-48, 0, 62, 0, 0.1, 'rgba(225,222,212,0.55)'); g.setLineDash([]);
    line(-48, -1.5, 61, -1.5, 0.05, 'rgba(40,52,64,0.9)'); line(-48, 1.5, 61, 1.5, 0.05, 'rgba(40,52,64,0.9)');
    g.fillStyle = 'rgba(225,222,212,0.35)';
    for (let x = -44; x < 60; x += 8) for (const [zz, dir] of [[-1.5, 1], [1.5, -1]]) {
      g.beginPath(); const cx = fx(x), cz = fz(zz);
      g.moveTo(cx + dir * 0.5 * KX, cz); g.lineTo(cx - dir * 0.3 * KX, cz - 0.45 * KZ); g.lineTo(cx - dir * 0.1 * KX, cz); g.lineTo(cx - dir * 0.3 * KX, cz + 0.45 * KZ); g.closePath(); g.fill();
    }
    // 横向通道
    for (const [a, b] of [[13, 17], [-50, -47], [60, 64]]) { line(a, -40, a, -3); line(b, -40, b, -3); line(a, 3, a, 40); line(b, 3, b, 40); }
    line(-78, 34, 78, 34);
    // 斑马线
    g.fillStyle = 'rgba(228,225,214,0.6)';
    for (const [a, b] of [[13, 17], [-50, -47], [60, 64]]) for (let z = -2.6; z < 2.6; z += 0.9) g.fillRect(fx(a + 0.3), fz(z), (b - a - 0.6) * KX, 0.45 * KZ);
    // 危险区斜纹（冲压线围栏外沿、焊装单元）
    const hazard = (x0, z0, x1, z1, w = 0.3) => {
      g.save(); g.beginPath();
      g.rect(fx(x0), fz(z0), (x1 - x0) * KX, (z1 - z0) * KZ); g.rect(fx(x0 + w), fz(z0 + w), (x1 - x0 - 2 * w) * KX, (z1 - z0 - 2 * w) * KZ);
      g.clip('evenodd');
      g.fillStyle = '#1d1c1a'; g.fillRect(fx(x0), fz(z0), (x1 - x0) * KX, (z1 - z0) * KZ);
      g.strokeStyle = '#c3a03e'; g.lineWidth = 0.18 * KX;
      for (let s = -200; s < 2000; s += 0.5 * KX * 1.4) { g.beginPath(); g.moveTo(fx(x0) + s, fz(z0)); g.lineTo(fx(x0) + s - 40, fz(z1)); g.stroke(); }
      g.restore();
    };
    hazard(-46.4, -26.6, -13.6, -13.4);
    for (const cx of [-42, -34, -26, -18]) for (const cz of [13, 27]) hazard(cx - 3.3, cz - 2.9, cx + 3.3, cz + 2.9, 0.22);
    // 总装线：工位框 + 编号
    g.font = `600 ${0.55 * KX}px Bahnschrift, "DIN Alternate", sans-serif`; g.textAlign = 'center';
    for (const L of LINES) {
      g.fillStyle = 'rgba(32,34,36,0.55)'; g.fillRect(fx(17), fz(L.z - 1.45), 45 * KX, 2.9 * KZ);
      for (let i = 0; i < NST; i++) {
        const x = LINE_X0 + i * PITCH;
        g.strokeStyle = 'rgba(232,228,216,0.55)'; g.lineWidth = 0.05 * KX;
        g.strokeRect(fx(x - 1.6), fz(L.z - 3.2), 3.2 * KX, 6.4 * KZ);
        g.fillStyle = 'rgba(232,228,216,0.7)'; g.fillText(String(i + 1).padStart(2, '0'), fx(x), fz(L.z + 2.9));
      }
    }
    // 成品车暂存位 / 叉车停车位 / AGV 充电位
    g.strokeStyle = 'rgba(232,228,216,0.6)'; g.lineWidth = 0.08 * KX;
    for (const c of [63.1, 68.1]) for (let i = 0; i < 3; i++) g.strokeRect(fx(c), fz(15.95 + i * 2.6), 5.0 * KX, 2.5 * KZ);
    for (let i = 0; i < 3; i++) g.strokeRect(fx(-56 + i * 2.2), fz(30.5), 2 * KX, 3.2 * KZ);
    for (let i = 0; i < 4; i++) { g.strokeRect(fx(-46 + i * 2.4), fz(4.4), 2.2 * KX, 1.4 * KZ); }
    // 分区编号（地面喷字）
    g.font = `700 ${2.6 * KX}px Bahnschrift, "DIN Alternate", Arial, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    for (const z of ZONES) { const [a, , , d] = z.rect; g.fillStyle = 'rgba(232,226,210,0.42)'; g.fillText(z.id, fx(a + 0.8), fz(d - 0.8)); }
    g.fillStyle = 'rgba(232,226,210,0.35)'; g.fillText('Z07', fx(16.8), fz(-24.8));
    // 进厂 / 出厂方向箭头
    g.font = `600 ${1.0 * KX}px Bahnschrift, Arial, sans-serif`; g.fillStyle = 'rgba(225,220,205,0.5)';
    g.fillText('AGV ▶ LOOP', fx(-44), fz(-0.6) + 0.35 * KZ);
  }, { aniso: 16 });
}

function paintSite() {
  // 场地 300 × 200 m（x -150..150, z -100..100）
  const W = 2400, H = 1600, k = 8; // px/m
  const sx = (x) => (x + 150) * k, sz = (z) => (z + 100) * k;
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#34322f'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1800; i++) { const x = R() * W, y = R() * H, r = 10 + R() * 70; g.fillStyle = `rgba(${R() < 0.5 ? 0 : 255},${R() < 0.5 ? 0 : 255},${R() < 0.5 ? 0 : 255},0.012)`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    const rect = (x0, z0, x1, z1, col) => { g.fillStyle = col; g.fillRect(sx(x0), sz(z0), (x1 - x0) * k, (z1 - z0) * k); };
    // 混凝土 apron
    rect(-128, -70, 112, 64, '#5e5b56');
    rect(-112, 18, -78, 40, '#686560'); // 西月台
    rect(78, 6, 104, 34, '#686560');    // 东发运
    // 沥青环路
    const road = '#262729';
    rect(-142, -86, 142, -74, road); rect(-142, 68, 142, 80, road); rect(-142, -86, -130, 80, road); rect(118, -86, 130, 80, road);
    rect(-130, 22, -112, 36, road); rect(104, 12, 118, 28, road); rect(-40, 64, -26, 100, road); rect(-62, -74, -10, -58, '#4d4b47');
    // 路面标线
    g.strokeStyle = 'rgba(230,226,214,0.55)'; g.lineWidth = 0.15 * k; g.setLineDash([3 * k, 3 * k]);
    const ln = (x0, z0, x1, z1) => { g.beginPath(); g.moveTo(sx(x0), sz(z0)); g.lineTo(sx(x1), sz(z1)); g.stroke(); };
    ln(-136, -80, 124, -80); ln(-136, 74, 124, 74); ln(-136, -80, -136, 74); ln(124, -80, 124, 74); ln(-33, 74, -33, 100);
    g.setLineDash([]); g.strokeStyle = 'rgba(200,170,80,0.5)'; g.lineWidth = 0.12 * k;
    ln(-128, -70, 112, -70); ln(-128, 64, 112, 64);
    // 停车场（员工）与成品车堆场
    rect(-128, 42, -84, 62, '#2d2e30'); rect(84, 40, 116, 62, '#2d2e30');
    g.strokeStyle = 'rgba(230,226,214,0.5)'; g.lineWidth = 0.1 * k;
    for (let x = -127; x < -85; x += 2.6) { g.strokeRect(sx(x), sz(43), 2.6 * k, 5.2 * k); g.strokeRect(sx(x), sz(56), 2.6 * k, 5.2 * k); }
    for (let x = 85; x < 115; x += 2.6) for (const z of [41, 47.5, 54, 56.6]) if (z !== 56.6) g.strokeRect(sx(x), sz(z), 2.6 * k, 5.2 * k);
    // 月台导向线
    g.strokeStyle = 'rgba(200,170,80,0.7)'; g.lineWidth = 0.14 * k;
    for (const z of [24, 28.5, 33]) { ln(-108, z - 1.5, -79, z - 1.5); ln(-108, z + 1.5, -79, z + 1.5); }
    ln(79, 4.5, 102, 4.5); ln(79, 7.5, 102, 7.5);
    // 斑马线
    g.fillStyle = 'rgba(230,226,214,0.55)';
    for (let z = 66; z < 78; z += 1.2) g.fillRect(sx(-40), sz(z), 14 * k, 0.6 * k);
    // 能源站垫层
    rect(-50, -56, -22, -40.4, '#706c66');
  }, { aniso: 16 });
}

function panelTex() {
  return canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#8b8780'; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 32) { g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x, 0, 4, H); g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x + 4, 0, 3, H); g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x + 7, 0, 10, H); }
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, H - 3, W, 3);
  }, { repeat: true });
}

export function buildBuilding(ctx) {
  const { B, scene, P } = ctx;
  const steel = M('structure', { color: 0x3b3f45, roughness: 0.48, metalness: 0.62 });
  const wallMat = M('wallPanel', { color: 0xffffff, map: panelTex(), roughness: 0.62, metalness: 0.25 });
  const glassBand = M('glassBand', { color: 0x1a2127, roughness: 0.12, metalness: 0.5, emissive: 0x0c1218 }, { grime: 0.3 });
  ctx.MAT.structure = steel;

  // ---- 楼板 ----
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(156, 80), new THREE.MeshStandardMaterial({ map: paintFloor(), roughness: 0.52, metalness: 0.0, envMapIntensity: 0.5 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor';
  floor.updateMatrix(); floor.matrixAutoUpdate = false; scene.add(floor);
  ctx.floor = floor;
  B.box(MAT.concreteDark, 156.7, 1.2, 80.7, 0, -0.605, 0);
  // 场地底座（像摄影棚里的实体模型）
  const site = new THREE.Mesh(new THREE.PlaneGeometry(300, 200), new THREE.MeshStandardMaterial({ map: paintSite(), roughness: 0.9, metalness: 0, envMapIntensity: 0.25 }));
  site.rotation.x = -Math.PI / 2; site.position.y = HALL.apron; site.receiveShadow = true; site.updateMatrix(); site.matrixAutoUpdate = false; scene.add(site);
  B.box(M('plinth', { color: 0x1c1d1f, roughness: 0.8 }), 300.6, 0.9, 200.6, 0, HALL.apron - 0.46, 0);

  // ---- 墙 ----
  const wallSeg = (x0, x1, z0, z1, y0, y1) => {
    const w = x1 - x0, d = z1 - z0, h = y1 - y0; if (w <= 0 || d <= 0 || h <= 0) return;
    B.geom(wallMat, boxUV(w, h, d, 2), trs((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  };
  // 一面墙（沿 x 或 z），带门洞 [[c, w, h]] 和窗带
  const wall = (axis, a0, a1, c0, c1, top, holes = [], windows = true) => {
    // 拆成门洞之间的段
    const segs = []; let s = a0;
    const hs = holes.slice().sort((p, q) => p[0] - q[0]);
    for (const [c, w] of hs) { segs.push([s, c - w / 2]); s = c + w / 2; }
    segs.push([s, a1]);
    const put = (p0, p1, y0, y1, mat) => {
      if (p1 <= p0 || y1 <= y0) return;
      if (axis === 'x') { if (mat) B.box(mat, p1 - p0, y1 - y0, c1 - c0, (p0 + p1) / 2, (y0 + y1) / 2, (c0 + c1) / 2); else wallSeg(p0, p1, c0, c1, y0, y1); }
      else { if (mat) B.box(mat, c1 - c0, y1 - y0, p1 - p0, (c0 + c1) / 2, (y0 + y1) / 2, (p0 + p1) / 2); else wallSeg(c0, c1, p0, p1, y0, y1); }
    };
    // 门洞上方
    for (const [c, w, h] of hs) { put(c - w / 2, c + w / 2, h, Math.min(top, 10.6), null); if (h < 1.4) put(c - w / 2, c + w / 2, 0, h, MAT.concrete); }
    for (const [p0, p1] of segs) { put(p0, p1, 0, Math.min(1.4, top), MAT.concrete); put(p0, p1, 1.4, Math.min(10.6, top), null); }
    if (top > 10.6) {
      if (windows) { put(a0, a1, 10.6, 12.4, glassBand); put(a0, a1, 12.4, top, null);
        // 窗框竖梃
        for (let p = a0 + 1.5; p < a1; p += 1.5) { if (axis === 'x') B.box(steel, 0.08, 1.8, (c1 - c0) + 0.06, p, 11.5, (c0 + c1) / 2); else B.box(steel, (c1 - c0) + 0.06, 1.8, 0.08, (c0 + c1) / 2, 11.5, p); }
      } else put(a0, a1, 10.6, top, null);
    }
    // 压顶
    if (axis === 'x') B.box(steel, a1 - a0, 0.18, (c1 - c0) + 0.1, (a0 + a1) / 2, top + 0.09, (c0 + c1) / 2);
    else B.box(steel, (c1 - c0) + 0.1, 0.18, a1 - a0, (c0 + c1) / 2, top + 0.09, (a0 + a1) / 2);
  };
  const T = 0.3;
  wall('x', -50.3, 78.3, -40 - T, -40, HALL.eave);                           // 北墙（低跨）
  wall('x', -78.3, -50.3, -40 - T, -40, HALL.highBay);                       // 北墙（高跨）
  wall('z', -40, 40, 78, 78 + T, HALL.eave, [[12, 5.2, 4.6], [6, 3.4, 3.8], [28, 5.2, 4.6]]); // 东墙
  wall('z', -40, 40, -78 - T, -78, HALL.west, [[24, 3.4, 3.8], [28.5, 3.4, 3.8], [33, 3.4, 3.8]], false); // 西墙剖到 7.5 m
  // 南侧女儿墙 / 板边
  for (const [a, b] of [[-78.3, -60], [-56, 30], [34, 78.3]]) { B.box(MAT.concrete, b - a, 1.1, 0.3, (a + b) / 2, 0.55, 40.15); B.box(steel, b - a, 0.06, 0.36, (a + b) / 2, 1.13, 40.15); }

  // ---- 结构：H 型钢柱 ----
  const column = (x, z, h, rot = 0) => {
    const w = 0.34, d = 0.6;
    if (rot) { B.box(steel, d, h, 0.04, x, h / 2, z - w / 2 + 0.02); B.box(steel, d, h, 0.04, x, h / 2, z + w / 2 - 0.02); B.box(steel, 0.03, h, w, x, h / 2, z); }
    else { B.box(steel, 0.04, h, d, x - w / 2 + 0.02, h / 2, z); B.box(steel, 0.04, h, d, x + w / 2 - 0.02, h / 2, z); B.box(steel, w, h, 0.03, x, h / 2, z); }
    B.box(steel, 0.7, 0.05, 0.8, x, 0.025, z);
  };
  const LBX = [-50.3, -40, -30, -21, -12, -3, 6, 15, 27, 38.5, 50, 62, 70, 78];
  const ICOL = [-50.3, -30, -12, 15, 38.5, 62];
  for (const x of LBX) { if (x < 78) { column(x, -39.75, HALL.eave, 1); column(x, 39.75, HALL.eave, 1); } }
  for (let z = -40; z <= 40; z += 10) column(77.75, Math.max(-39.6, Math.min(39.6, z)), HALL.eave);
  for (const x of ICOL) for (const z of [-4.5, 4.5]) column(x, z, x === -50.3 ? HALL.highBay : 13.6);
  const HBZ = []; for (let z = -40; z <= 40; z += 8) HBZ.push(Math.max(-39.75, Math.min(39.75, z)));
  for (const z of HBZ) { column(-77.75, z, HALL.highBay); column(-50.3, z, HALL.highBay); }

  // ---- 桁架 ----
  const truss = (p0, p1, y0, y1, n, along) => { // along: 'z' 或 'x'；p = [固定坐标]
    const L = Math.abs(along === 'z' ? p1[1] - p0[1] : p1[0] - p0[0]);
    const P = (t, y) => along === 'z' ? [p0[0], y, p0[1] + (p1[1] - p0[1]) * t] : [p0[0] + (p1[0] - p0[0]) * t, y, p0[1]];
    B.beam(steel, P(0, y1), P(1, y1), 0.2, 0.16);
    B.beam(steel, P(0, y0), P(1, y0), 0.17, 0.15);
    for (let i = 0; i <= n; i++) {
      const t = i / n; B.beam(steel, P(t, y0), P(t, y1), 0.065);
      if (i < n) { const t2 = (i + 1) / n; if (i % 2 === 0) B.beam(steel, P(t, y0), P(t2, y1), 0.06); else B.beam(steel, P(t, y1), P(t2, y0), 0.06); }
    }
    return L;
  };
  for (const x of LBX) truss([x, -40], [x, 40], 13.6, HALL.eave, 32, 'z');
  for (const z of [-39.75, -4.5, 4.5, 39.75]) truss([-50.3, z], [78, z], 13.6, HALL.eave, 52, 'x');
  for (const z of HBZ) truss([-78, z], [-50.3, z], 19.4, HALL.highBay, 12, 'x');
  for (const x of [-77.75, -50.3]) truss([x, -40], [x, 40], 19.4, HALL.highBay, 32, 'z');
  // 檩条（部分）与天窗骨架
  for (let z = -38; z <= 38; z += 4) {
    if (Math.abs(z) < 3) continue;
    const segs = (Math.abs(z) % 8 === 2) ? [[-50.3, 78]] : [[-50.3, 15], [38.5, 78]];
    for (const [a, b] of segs) B.box(steel, b - a, 0.16, 0.1, (a + b) / 2, HALL.eave + 0.2, z);
  }
  for (let z = -36; z <= 36; z += 6) B.box(steel, 27.5, 0.14, 0.1, -64.15, HALL.highBay + 0.18, z);
  for (const [x0, x1, z0, z1] of [[-21, 15, -24, -18], [27, 62, -24, -18], [-21, 15, 18, 24], [27, 62, 18, 24]]) {
    const y = HALL.eave + 0.9;
    B.box(steel, x1 - x0, 0.14, 0.14, (x0 + x1) / 2, y, z0); B.box(steel, x1 - x0, 0.14, 0.14, (x0 + x1) / 2, y, z1);
    B.box(steel, x1 - x0, 0.1, 0.1, (x0 + x1) / 2, y + 0.9, (z0 + z1) / 2);
    for (let x = x0; x <= x1 + 0.01; x += 3) { B.beam(steel, [x, y, z0], [x, y + 0.9, (z0 + z1) / 2], 0.08); B.beam(steel, [x, y, z1], [x, y + 0.9, (z0 + z1) / 2], 0.08); B.box(steel, 0.1, 0.8, 0.1, x, HALL.eave + 0.45, z0); B.box(steel, 0.1, 0.8, 0.1, x, HALL.eave + 0.45, z1); }
  }
  // 屋面水平支撑（端跨 X 撑）
  for (const [x0, x1] of [[-50.3, -40], [70, 78]]) for (const [z0, z1] of [[-40, -20], [-20, -4.5], [4.5, 20], [20, 40]]) {
    B.beam(steel, [x0, HALL.eave, z0], [x1, HALL.eave, z1], 0.05); B.beam(steel, [x0, HALL.eave, z1], [x1, HALL.eave, z0], 0.05);
  }

  // ---- 吊挂灯带 ----
  const lampMat = MAT.lampW;
  const lampHousing = M('lampHousing', { color: 0x2c2f33, roughness: 0.5, metalness: 0.5 });
  for (const z of [-34, -26, -18, -10, 10, 18, 26, 34]) {
    for (let x = -46; x < 75; x += 12) {
      if (z < -20 && x > 14 && x < 60) continue; // 中控上方留空
      const len = 9;
      B.box(lampHousing, len, 0.1, 0.26, x + len / 2, 12.85, z);
      B.box(lampMat, len - 0.2, 0.03, 0.16, x + len / 2, 12.79, z);
      B.box(steel, 0.02, 0.75, 0.02, x + 0.6, 13.25, z); B.box(steel, 0.02, 0.75, 0.02, x + len - 0.6, 13.25, z);
    }
  }
  for (const z of [-30, -18, -6, 6, 18, 30]) for (const x of [-70.5, -66.6, -62.7, -58.8]) { B.box(lampHousing, 1.2, 0.12, 2.2, x, 19.0, z); B.box(lampMat, 1.0, 0.03, 2.0, x, 18.93, z); }

  // ---- 墙内侧管廊（能源从北墙进入） ----
  const pipeG = (r) => new THREE.CylinderGeometry(r, r, 1, 14, 1);
  const pipeMats = [M('pipeGreen', { color: 0x5d6b62, roughness: 0.5, metalness: 0.3 }), M('pipeBlue', { color: 0x4f5f6e, roughness: 0.5, metalness: 0.3 }), M('pipeIvory', { color: 0xc9c3b5, roughness: 0.6 })];
  const pipeRun = (mat, r, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]; const L = Math.hypot(dx, dy, dz);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    B.geom(mat, pipeG(r), new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, L, 1)));
  };
  ctx.pipeRun = pipeRun; ctx.pipeMats = pipeMats;
  const pz = [-39.2, -38.7, -38.2];
  pipeMats.forEach((m, i) => {
    pipeRun(m, 0.18, [-36 + i * 0.5, 9.2 + i * 0.45, -54], [-36 + i * 0.5, 9.2 + i * 0.45, pz[i]]);
    pipeRun(m, 0.18, [-36 + i * 0.5, 9.2 + i * 0.45, pz[i]], [72, 9.2 + i * 0.45, pz[i]]);
    pipeRun(m, 0.18, [-36 + i * 0.5, 9.2 + i * 0.45, pz[i]], [-74, 9.2 + i * 0.45, pz[i]]);
  });
  for (let x = -72; x <= 70; x += 6) { B.box(steel, 0.12, 0.12, 1.6, x, 8.95, -39.1); B.box(steel, 0.1, 1.6, 0.1, x, 9.7, -39.95); }

  buildAux(ctx, steel);
  buildEnergy(ctx, steel, pipeRun, pipeMats);
  buildOutdoor(ctx, steel);
}

// ---------- Z07 辅助区：中控室 / 配电 / 维修 ----------
function buildAux(ctx, steel) {
  const { B } = ctx;
  const glass = MAT.glass;
  const frame = M('frameDark', { color: 0x26292d, roughness: 0.45, metalness: 0.5 });
  // 中控室
  const [x0, x1, z0, z1, h] = [17, 33, -39.6, -28, 4.2];
  B.box(M('raisedFloor', { color: 0x4a4d50, roughness: 0.6 }), x1 - x0, 0.15, z1 - z0, (x0 + x1) / 2, 0.075, (z0 + z1) / 2);
  for (const [a, b, c, d] of [[x0, x1, z1, z1], [x0, x0, z0, z1], [x1, x1, z0, z1]]) {
    const L = Math.hypot(b - a, d - c), cx = (a + b) / 2, cz = (c + d) / 2, ry = a === b ? Math.PI / 2 : 0;
    B.box(glass, L, h - 0.9, 0.04, cx, 0.9 + (h - 0.9) / 2, cz, ry);
    B.box(frame, L, 0.9, 0.12, cx, 0.45, cz, ry);
    B.box(frame, L, 0.1, 0.14, cx, h, cz, ry);
    for (let s = 0; s <= L; s += 2) { const t = s / L; B.box(frame, 0.08, h - 0.9, 0.1, a + (b - a) * t, 0.9 + (h - 0.9) / 2, c + (d - c) * t, ry); }
  }
  // 两排控制台
  const desk = M('desk', { color: 0x34373b, roughness: 0.5, metalness: 0.2 });
  for (const zr of [-33.6, -30.8]) for (let i = 0; i < 4; i++) {
    const x = 19.6 + i * 3.4;
    B.box(desk, 3.0, 0.75, 0.9, x, 0.15 + 0.375, zr);
    for (let k = -1; k <= 1; k++) { B.box(frame, 0.85, 0.52, 0.05, x + k * 0.9, 1.25, zr - 0.3, k * -0.18); B.box(MAT.screen, 0.78, 0.45, 0.01, x + k * 0.9 - Math.sin(k * -0.18) * 0.03, 1.25, zr - 0.27, k * -0.18); }
  }
  ctx.videoWall = { x: 25, y: 2.4, z: -39.45 };
  // 低压配电室
  const blk = M('blockWall', { color: 0xbab4a7, roughness: 0.85 });
  for (const [a, b, c, d] of [[34, 46, -30, -30], [34, 34, -39.6, -30], [46, 46, -39.6, -30]]) {
    const L = Math.hypot(b - a, d - c); const ry = a === b ? Math.PI / 2 : 0;
    if (a !== b) { B.box(blk, 4.2, 3.6, 0.24, 36.6, 1.8, c, ry); B.box(blk, 6.2, 3.6, 0.24, 42.9, 1.8, c, ry); B.box(blk, 1.6, 0.9, 0.24, 39.5, 3.15, c); }
    else B.box(blk, L, 3.6, 0.24, a, 1.8, (c + d) / 2, ry);
  }
  const cab = M('cabinet', { color: 0x3d4247, roughness: 0.45, metalness: 0.35 });
  for (const zr of [-38.6, -35.2, -32.4]) for (let i = 0; i < 12; i++) {
    const x = 35.0 + i * 0.85; B.box(cab, 0.8, 2.2, 0.62, x, 1.1, zr);
    B.box(i % 5 === 2 ? MAT.lampAmber : MAT.lampGreen, 0.05, 0.05, 0.01, x - 0.2, 1.9, zr + 0.315);
  }
  // 维修间
  for (const [a, b, c, d] of [[47, 60, -28, -28], [47, 47, -39.6, -28]]) {
    const L = Math.hypot(b - a, d - c), cx = (a + b) / 2, cz = (c + d) / 2, ry = a === b ? Math.PI / 2 : 0;
    B.box(blk, L, 1.2, 0.2, cx, 0.6, cz, ry); B.box(MAT.mesh, L, 1.6, 0.03, cx, 2.0, cz, ry); B.box(frame, L, 0.08, 0.1, cx, 2.8, cz, ry);
  }
  const bench = M('bench', { color: 0x5c6670, roughness: 0.55, metalness: 0.3 });
  for (let i = 0; i < 3; i++) { B.box(bench, 2.4, 0.9, 0.9, 49.8 + i * 3, 0.45, -36.8); B.box(steel, 2.4, 0.04, 0.9, 49.8 + i * 3, 0.92, -36.8); }
  for (let i = 0; i < 4; i++) { B.box(steel, 2.2, 2.4, 0.6, 50 + i * 2.5, 1.2, -39.1); for (let s = 0; s < 4; s++) for (let b = 0; b < 4; b++) B.box(M('binBlue', { color: C.bin, roughness: 0.6 }), 0.42, 0.22, 0.45, 49.3 + i * 2.5 + b * 0.5, 0.35 + s * 0.6, -39.05); }
  B.box(MAT.orange, 0.9, 1.0, 0.7, 57.6, 0.5, -31.5);
}

// ---------- 室外能源站 ----------
function buildEnergy(ctx, steel, pipeRun, pipeMats) {
  const { B, P } = ctx; const y0 = HALL.apron;
  B.box(MAT.concrete, 27, 0.25, 15, -36, y0 + 0.125, -48.2);
  const tf = M('transformer', { color: 0x4b524f, roughness: 0.55, metalness: 0.35 });
  for (const x of [-45, -40.5]) {
    B.box(tf, 2.6, 2.4, 1.9, x, y0 + 0.25 + 1.2, -51.5);
    for (let i = 0; i < 9; i++) { B.box(tf, 0.05, 1.9, 0.5, x - 1.1 + i * 0.275, y0 + 0.25 + 1.15, -50.3); B.box(tf, 0.05, 1.9, 0.5, x - 1.1 + i * 0.275, y0 + 0.25 + 1.15, -52.7); }
    for (let i = 0; i < 3; i++) B.geom(MAT.ivory, new THREE.CylinderGeometry(0.09, 0.12, 0.6, 10), trs(x - 0.8 + i * 0.8, y0 + 0.25 + 2.7, -51.5));
  }
  // 冷水机组 + 风扇
  ctx.fans = [];
  const blade = new THREE.BoxGeometry(1.42, 0.03, 0.26);
  const fanGeo = mergeT([[blade, mtx(0, 0, 0, 0, 0.18, 0)], [blade, mtx(0, 0, 0, Math.PI / 3, 0.18, 0)], [blade, mtx(0, 0, 0, -Math.PI / 3, 0.18, 0)], [new THREE.CylinderGeometry(0.16, 0.16, 0.12, 12), null]]);
  P.def('fan', fanGeo, M('fanBlade', { color: 0x1d1f22, roughness: 0.5, metalness: 0.4 }));
  for (const x of [-33, -26]) {
    B.box(MAT.ivory, 6, 2.3, 2.6, x, y0 + 0.25 + 1.15, -45);
    for (let i = 0; i < 3; i++) {
      B.geom(MAT.graphite, new THREE.CylinderGeometry(0.85, 0.85, 0.3, 24, 1, true), trs(x - 2 + i * 2, y0 + 0.25 + 2.45, -45));
      const f = P.node('fan'); f.position.set(x - 2 + i * 2, y0 + 0.25 + 2.42, -45); ctx.fans.push(f);
    }
    for (let i = 0; i < 10; i++) B.box(MAT.graphite, 0.06, 1.6, 2.4, x - 2.8 + i * 0.62, y0 + 0.25 + 1.0, -45);
  }
  // 储罐
  for (const [x, z] of [[-31, -51.6], [-27.5, -51.6], [-24.5, -51.6]]) {
    B.geom(MAT.steel, new THREE.CylinderGeometry(1.25, 1.25, 6, 28), trs(x, y0 + 0.25 + 3.2, z));
    B.geom(MAT.steel, new THREE.SphereGeometry(1.25, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), trs(x, y0 + 0.25 + 6.2, z, 0, 0, 0, 1, 0.35, 1));
    for (let k = 0; k < 4; k++) B.box(steel, 0.12, 0.6, 0.12, x + Math.cos(k * 1.57) * 0.95, y0 + 0.25 + 0.3, z + Math.sin(k * 1.57) * 0.95);
    B.box(steel, 0.05, 6.4, 0.4, x + 1.32, y0 + 0.25 + 3.4, z);
  }
  // 管桥（室外 → 北墙）
  for (let z = -54; z <= -41; z += 3.2) {
    B.box(steel, 0.25, 10.6 - y0, 0.25, -37.1, (10.6 + y0) / 2, z); B.box(steel, 0.25, 10.6 - y0, 0.25, -34.0, (10.6 + y0) / 2, z);
    B.box(steel, 3.4, 0.3, 0.3, -35.55, 8.9, z); B.box(steel, 3.4, 0.25, 0.25, -35.55, 10.6, z);
  }
  // 围栏
  const fence = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0); const ry = -Math.atan2(z1 - z0, x1 - x0); B.box(MAT.mesh, L, 2.2, 0.03, (x0 + x1) / 2, y0 + 1.1, (z0 + z1) / 2, ry); for (let s = 0; s <= L; s += 2.5) { const t = s / L; B.box(steel, 0.07, 2.3, 0.07, x0 + (x1 - x0) * t, y0 + 1.15, z0 + (z1 - z0) * t); } };
  fence(-49.5, -55.5, -22.5, -55.5); fence(-49.5, -55.5, -49.5, -41.2); fence(-22.5, -55.5, -22.5, -41.2);
}

// ---------- 室外硬景 ----------
function buildOutdoor(ctx, steel) {
  const { B, P } = ctx; const y0 = HALL.apron;
  // 西侧卸货雨棚
  const canopy = M('canopy', { color: 0x6f6c66, roughness: 0.6, metalness: 0.35 });
  B.box(canopy, 12, 0.3, 15.5, -84.3, 5.6, 28.5);
  for (const z of [21.5, 28.5, 35.5]) { B.beam(steel, [-78.4, 5.0, z], [-89.8, 5.45, z], 0.22); B.beam(steel, [-78.4, 3.2, z], [-84, 5.45, z], 0.12); }
  // 月台门框、门封、防撞块、月台灯
  const seal = M('dockSeal', { color: 0x151617, roughness: 0.9 });
  for (const z of [24, 28.5, 33]) {
    B.box(seal, 0.6, 3.9, 0.35, -78.6, 1.95, z - 1.85); B.box(seal, 0.6, 3.9, 0.35, -78.6, 1.95, z + 1.85); B.box(seal, 0.6, 0.6, 4.05, -78.6, 3.9, z);
    B.box(MAT.rubber, 0.25, 0.4, 0.3, -78.5, -0.4, z - 1.3); B.box(MAT.rubber, 0.25, 0.4, 0.3, -78.5, -0.4, z + 1.3);
    B.box(MAT.lampAmber, 0.08, 0.14, 0.14, -78.45, 4.6, z + 2.3);
    B.box(MAT.yellow, 0.18, 1.1, 0.18, -78.8, y0 + 0.55, z - 2.2);
  }
  // 东侧：发运雨棚、成品车坡道、月台门封
  B.box(canopy, 9, 0.3, 7.6, 82.8, 5.4, 5.6);
  for (const z of [2.2, 9.0]) B.beam(steel, [78.4, 4.6, z], [87.2, 5.25, z], 0.2);
  for (const zc of [12, 28]) {
    const ramp = new THREE.BufferGeometry();
    const xa = 78.3, xb = 87, w = 2.8;
    const v = [xa, 0, zc - w, xa, 0, zc + w, xb, y0, zc + w, xb, y0, zc - w, xa, y0, zc - w, xa, y0, zc + w];
    ramp.setAttribute('position', new THREE.Float32BufferAttribute([...v.slice(0, 3), ...v.slice(3, 6), ...v.slice(6, 9), ...v.slice(0, 3), ...v.slice(6, 9), ...v.slice(9, 12),
      ...v.slice(0, 3), ...v.slice(9, 12), ...v.slice(12, 15), ...v.slice(3, 6), ...v.slice(15, 18), ...v.slice(6, 9)], 3));
    ramp.computeVertexNormals();
    B.geom(MAT.concrete, ramp);
    B.box(MAT.yellow, xb - xa, 0.25, 0.2, (xa + xb) / 2, -0.5, zc - w - 0.1, 0, 0, Math.atan2(y0, xb - xa));
    B.box(MAT.yellow, xb - xa, 0.25, 0.2, (xa + xb) / 2, -0.5, zc + w + 0.1, 0, 0, Math.atan2(y0, xb - xa));
  }
  B.box(seal, 0.6, 3.9, 0.35, 78.6, 1.95, 4.15); B.box(seal, 0.6, 3.9, 0.35, 78.6, 1.95, 7.85); B.box(seal, 0.6, 0.6, 4.05, 78.6, 3.9, 6);
  // 场地围栏 + 大门 + 门卫室
  const fz0 = -96, fz1 = 96, fx0 = -146, fx1 = 146;
  const posts = []; const run = (x0, z0, x1, z1, gaps = []) => {
    const L = Math.hypot(x1 - x0, z1 - z0); const ry = -Math.atan2(z1 - z0, x1 - x0);
    let s = 0; const segs = [];
    for (const [g0, g1] of gaps) { segs.push([s, g0]); s = g1; } segs.push([s, L]);
    for (const [a, b] of segs) {
      if (b - a < 0.5) continue;
      const t0 = a / L, t1 = b / L, cx = x0 + (x1 - x0) * (t0 + t1) / 2, cz = z0 + (z1 - z0) * (t0 + t1) / 2;
      B.box(MAT.mesh, b - a, 2.2, 0.03, cx, y0 + 1.1, cz, ry);
      for (let q = a; q <= b; q += 3) { const t = q / L; B.box(steel, 0.08, 2.4, 0.08, x0 + (x1 - x0) * t, y0 + 1.2, z0 + (z1 - z0) * t); }
    }
  };
  run(fx0, fz0, fx1, fz0); run(fx0, fz1, fx1, fz1, [[105, 123]]); run(fx0, fz0, fx0, fz1); run(fx1, fz0, fx1, fz1);
  B.box(MAT.ivory, 5, 3, 4, -48, y0 + 1.5, 88); B.box(MAT.glassDark, 5.05, 1.1, 3.0, -48, y0 + 2.0, 88);
  B.box(steel, 7, 0.2, 5.2, -48, y0 + 3.1, 88);
  B.box(MAT.yellow, 0.3, 1.0, 0.3, -40.4, y0 + 0.5, 86); B.box(M('barrier', { color: 0xd8d2c4, roughness: 0.5 }), 6.6, 0.12, 0.12, -37, y0 + 1.0, 86);
  // 集装箱堆场（西北）
  const cont = ['#7a4a3a', '#3f5566', '#5b6a62', '#c4bdae', '#6d5a46', '#44505c'].map((c, i) => M('cont' + i, { color: c, roughness: 0.6, metalness: 0.35 }));
  let ci = 0;
  for (let i = 0; i < 4; i++) for (let lv = 0; lv < (i % 2 ? 2 : 3); lv++) { const long = (i + lv) % 3 !== 0; B.box(cont[(ci++) % 6], long ? 12.19 : 6.06, 2.59, 2.44, -122 + (long ? 0 : -3), y0 + 1.295 + lv * 2.6, -60 + i * 2.7); }
  for (let i = 0; i < 3; i++) for (let lv = 0; lv < 2; lv++) B.box(cont[(ci++) % 6], 6.06, 2.59, 2.44, -104 + i * 6.4, y0 + 1.295 + lv * 2.6, -60);
  // 钢卷堆场（月台北侧）
  const coilG = new THREE.CylinderGeometry(0.85, 0.85, 1.3, 26, 1); coilG.rotateX(Math.PI / 2);
  const coilHole = new THREE.CylinderGeometry(0.3, 0.3, 1.32, 14, 1); coilHole.rotateX(Math.PI / 2);
  for (let i = 0; i < 7; i++) for (let j = 0; j < 2; j++) {
    const x = -104 + i * 2.1, z = 6 + j * 3.2;
    B.box(MAT.wood, 1.6, 0.25, 1.4, x, y0 + 0.125, z);
    B.geom(MAT.steel, coilG, trs(x, y0 + 1.1, z)); B.geom(MAT.graphite, coilHole, trs(x, y0 + 1.1, z));
  }
  // 托盘堆
  for (let i = 0; i < 6; i++) for (let lv = 0; lv < 6 + (i % 3); lv++) B.box(MAT.wood, 1.2, 0.14, 1.0, -96 + (i % 3) * 1.5, y0 + 0.07 + lv * 0.15, 13.5 + Math.floor(i / 3) * 1.3);
  // 路灯
  const poleG = new THREE.CylinderGeometry(0.08, 0.13, 9, 8); poleG.translate(0, 4.5, 0);
  const lamps = [];
  for (let x = -126; x <= 116; x += 30) { lamps.push([x, -72.5, 0]); lamps.push([x, 66.5, Math.PI]); }
  for (let z = -60; z <= 60; z += 30) { lamps.push([-128, z, Math.PI / 2]); lamps.push([116, z, -Math.PI / 2]); }
  for (const [x, z, r] of lamps) {
    B.geom(steel, poleG, trs(x, y0, z));
    const dx = Math.sin(r) * 1.2, dz = Math.cos(r) * 1.2;
    B.beam(steel, [x, y0 + 8.9, z], [x + dx, y0 + 9.0, z + dz], 0.07);
    B.box(MAT.graphite, 0.6, 0.12, 0.32, x + dx * 1.2, y0 + 8.95, z + dz * 1.2, r);
    B.box(MAT.lampW, 0.5, 0.02, 0.24, x + dx * 1.2, y0 + 8.88, z + dz * 1.2, r);
  }
  // 锥桶 / 防撞柱
  const cone = new THREE.ConeGeometry(0.2, 0.7, 14); cone.translate(0, 0.35, 0);
  const coneMat = M('cone', { color: 0xc8582a, roughness: 0.6 });
  for (const [x, z] of [[-90, 19.6], [-91.2, 19.6], [-92.4, 19.6], [-96, 37.4], [-97.2, 37.4], [90, 1.6], [91.2, 1.6], [88, 10.4], [-30.4, -56.5], [-29.2, -56.5]]) {
    B.geom(coneMat, cone, trs(x, y0, z)); B.box(MAT.white, 0.24, 0.08, 0.24, x, y0 + 0.4, z); B.box(MAT.rubber, 0.42, 0.04, 0.42, x, y0 + 0.02, z);
  }
  const bol = new THREE.CylinderGeometry(0.12, 0.12, 1.1, 10); bol.translate(0, 0.55, 0);
  for (const z of [9, 15, 25, 31]) B.geom(MAT.yellow, bol, trs(87.5, y0, z));
  // 员工停车场 + 成品车堆场（静态实例）
  const cg = carGeoms();
  P.def('parkBody', cg.body, MAT.paint, { color: true, dyn: false });
  P.def('parkGlass', cg.glass, MAT.glassDark, { dyn: false });
  P.def('parkTire', cg.tires, MAT.rubber, { dyn: false });
  const civ = ['#8d9196', '#2e3135', '#c9c6be', '#5a5f66', '#6b2f2c', '#3c4a5a', '#d9d6cf', '#4b4f47'];
  const nev = ['#d9d6cf', '#2e3135', '#8d9196', '#3c4a5a', '#7d8a8f', '#6b2f2c'];
  const park = (x, z, ry, col) => { const g = P.group(); g.position.set(x, y0, z); g.rotation.y = ry; P.node('parkBody', g, col); P.node('parkGlass', g); P.node('parkTire', g); };
  for (let i = 0; i < 16; i++) { if (R() < 0.8) park(-125.7 + i * 2.6, 45.6, Math.PI / 2 + rr(-0.03, 0.03), pick(civ)); if (R() < 0.7) park(-125.7 + i * 2.6, 58.6, -Math.PI / 2 + rr(-0.03, 0.03), pick(civ)); }
  for (let i = 0; i < 11; i++) for (const z of [43.6, 50.1]) if (!((i === 8 || i === 10) && z < 45)) park(86.3 + i * 2.6, z, Math.PI / 2, nev[(i + (z > 45 ? 3 : 0)) % nev.length]);
}
