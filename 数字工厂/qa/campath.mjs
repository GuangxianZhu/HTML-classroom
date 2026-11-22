// 运镜穿模检查：按巡游公式逐 0.05 s 采样相机位置，检查与桁架层、灯带、墙、柱、设备包络的距离
import { STATIONS, LINES, DOOR_RODS, LBX, ICOL, LAMP_Z, HALL, OC_W, OC_E, OC_Y, OC_RODS_W, OC_RODS_E, OC_RODS_Z20 } from '../src/layout.js';
import { makeSegs, sampleSegs, camPos } from '../src/tourmath.js';
const segs = makeSegs(1); const total = segs.reduce((a, s) => a + s.dur, 0);
function sample(e) { const { arr, i } = sampleSegs(segs, e, null); return { i, p: camPos(arr), o: arr }; }
// 障碍物 AABB [x0,x1,y0,y1,z0,z1]（位置都取自 src/layout.js，和场景同源）
const B = [];
for (const x of LBX) B.push(['truss-z', [x - 0.3, x + 0.3, 13.4, 16.0, -40, 40]]);
for (const z of [-39.75, -4.5, 4.5, 39.75]) B.push(['truss-x', [-50.3, 78, 13.4, 16.0, z - 0.3, z + 0.3]]);
B.push(['highbay-truss', [-78, -50.3, HALL.highBay - 2.4, HALL.highBay + 0.2, -40, 40]]);
for (const z of LAMP_Z) B.push(['lamp', [-46, 75, 12.6, 13.7, z - 0.3, z + 0.3]]);
B.push(['wall-N', [-78.3, 78.3, 0, 15.9, -40.4, -39.9]], ['wall-E', [77.9, 78.4, 0, 15.9, -40, 40]], ['wall-W', [-78.4, -77.9, 0, 7.6, -40, 40]], ['parapet-S', [-78.3, 78.3, 0, 1.3, 39.9, 40.4]]);
for (const x of LBX) for (const z of [-39.75, 39.75]) B.push(['col', [x - 0.4, x + 0.4, 0, 15.8, z - 0.4, z + 0.4]]);
for (const x of ICOL) for (const z of [-4.5, 4.5]) B.push(['col', [x - 0.4, x + 0.4, 0, 13.6, z - 0.4, z + 0.4]]);
for (const cx of [-42, -34, -26, -18]) for (const cz of [13, 27]) { const rx = cx + (cz < 20 ? -1.5 : 1.5), rz = cz + (cz < 20 ? -0.6 : 0.6); B.push(['weldcell', [cx - 3.4, cx + 3.4, 0, 5.0, cz - 3.0, cz + 3.0]], ['riser', [rx - 0.3, rx + 0.3, 4.5, 13.3, rz - 0.3, rz + 0.3]]); }
for (const L of LINES) { for (const x of DOOR_RODS) B.push(['door-rod', [x - 0.05, x + 0.05, 5.2, 13.6, L.z - 3.65, L.z - 3.55]]); B.push(['line', [17, 62.2, 0, 3.6, L.z - 4.9, L.z + 4.1]]); for (const x of [17.4, 61.9]) B.push(['sign-rod', [x - 0.06, x + 0.06, 3.8, 13.6, L.z + 2.69, L.z + 2.81]]); B.push(['head-lift', [15.8, 20.6, 0, 10.3, L.z - 1.5, L.z + 1.5]]); }
// 空中输送：轨道、吊杆、车身通过的包络、升降机门架
for (const z of OC_RODS_W) B.push(['oc-rod', [OC_W - 0.05, OC_W + 0.05, 9.8, 13.6, z - 0.05, z + 0.05]]);
for (const z of OC_RODS_E) B.push(['oc-rod', [OC_E - 0.05, OC_E + 0.05, 9.8, 13.6, z - 0.05, z + 0.05]]);
for (const x of OC_RODS_Z20) B.push(['oc-rod', [x - 0.05, x + 0.05, 9.8, 13.6, 19.95, 20.05]]);
// 吊着的车身（宽 1.86、顶 7.5）和它上面的吊具 + 轨道（很窄，到 9.9）
B.push(['oc-W-body', [OC_W - 0.93, OC_W + 0.93, OC_Y, 7.5, -5.6, 21]], ['oc-W-rail', [OC_W - 0.15, OC_W + 0.15, 7.5, 9.9, -5.6, 21]], ['oc-z20-body', [-44.5, OC_W, OC_Y, 7.5, 19.07, 20.93]], ['oc-z20-rail', [-44.5, OC_W, 7.5, 9.9, 19.85, 20.15]], ['oc-E-body', [OC_E - 0.93, OC_E + 0.93, OC_Y, 7.5, -22, 29]], ['oc-E-rail', [OC_E - 0.15, OC_E + 0.15, 7.5, 9.9, -22, 29]]);
B.push(['lift-in', [OC_W - 1.5, OC_W + 1.5, 0, 10.3, -8.7, -4.3]], ['lift-out', [OC_E - 1.5, OC_E + 1.5, 0, 10.3, -24.5, -20.7]]);
B.push(['ctrl', [17, 33, 0, 4.4, -39.6, -28]], ['lv', [34, 46, 0, 3.7, -39.6, -30]]);
B.push(['rack', [-76, -58, 0, 21, -32.5, 20.5]], ['press', [-46.2, -14.6, 0, 9.5, -22.8, -17.2]], ['booth', [-8.6, 12.9, 0, 6.4, -21.5, -7]], ['oven+ahu', [-8, 12.4, 0, 7.4, -31, -23.6]], ['stacks', [-7, 11.2, 0, 19.5, -29, -27.8]]);
for (const s of STATIONS) if (!['ASRS-01', 'ASRS-02', 'AGV-01', 'OC-01', 'EN-01'].includes(s.id)) B.push(['st:' + s.id, [s.box[0], s.box[1], s.box[2], s.box[3] + 0.6, s.box[4], s.box[5]]]);
const dist = (p, b) => { const dx = Math.max(b[0] - p[0], 0, p[0] - b[1]), dy = Math.max(b[2] - p[1], 0, p[1] - b[3]), dz = Math.max(b[4] - p[2], 0, p[2] - b[5]); return Math.hypot(dx, dy, dz); };
const viol = []; let minAll = 1e9;
for (let e = 0; e < total; e += 0.05) {
  const { i, p } = sample(e);
  for (const [n, b] of B) { const d = dist(p, b); if (d < minAll) minAll = d; if (d < 0.9) viol.push({ t: +e.toFixed(2), ch: i + 1, n, d: +d.toFixed(2), p: p.map((v) => +v.toFixed(1)) }); }
}
const byCh = {}; for (const v of viol) (byCh[v.ch + ' ' + v.n] ||= []).push(v);
for (const [k, arr] of Object.entries(byCh)) console.log('CLOSE', k, 't', arr[0].t, '→', arr[arr.length - 1].t, 'min', Math.min(...arr.map((a) => a.d)), JSON.stringify(arr[0].p));
console.log(viol.length ? `运镜检查：${Object.keys(byCh).length} 处过近` : '运镜检查通过：全程与桁架 / 灯带 / 墙 / 柱 / 设备保持 ≥ 0.9 m');
process.exit(viol.length ? 1 : 0);
