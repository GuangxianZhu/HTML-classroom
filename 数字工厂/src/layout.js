// 共享契约：坐标（米，+x 东、+z 南、+y 上）、分区、工位、视角、巡游分镜
export const HALL = { x0: -78, x1: 78, z0: -40, z1: 40, eave: 15.8, highBay: 21.6, west: 7.5, apron: -1.2 };

export const ZONES = [
  { id: 'Z01', cn: '原材料立库', en: 'RAW-MATERIAL AS/RS', rect: [-76, -50, -34, 34], label: [-63, 23, -10],
    view: { tx: -62, ty: 6, tz: 0, azim: -0.72, elev: 0.38, dist: 82, fov: 34 } },
  { id: 'Z02', cn: '冲压线', en: 'PRESS LINE', rect: [-47, -14, -34, -6], label: [-30, 10.5, -24],
    view: { tx: -30, ty: 3.5, tz: -20, azim: 0.36, elev: 0.22, dist: 34, fov: 42 } },
  { id: 'Z03', cn: '焊装车间', en: 'BODY WELDING', rect: [-47, -14, 6, 34], label: [-30, 8, 30],
    view: { tx: -30, ty: 2.5, tz: 20, azim: 1.25, elev: 0.2, dist: 40, fov: 42 } },
  { id: 'Z04', cn: '涂装车间', en: 'PAINT SHOP', rect: [-9, 13, -33, -4], label: [2, 11, -22],
    view: { tx: 2, ty: 3, tz: -18, azim: 0.12, elev: 0.22, dist: 38, fov: 40 } },
  { id: 'Z05', cn: '总装线', en: 'FINAL ASSEMBLY', rect: [17, 62, 6, 34], label: [40, 9, 20],
    view: { tx: 40, ty: 4, tz: 20, azim: -0.8, elev: 0.42, dist: 66, fov: 32 } },
  { id: 'Z06', cn: '检测发运', en: 'EOL & SHIPPING', rect: [62, 76, 4, 36], label: [70, 7.5, 30],
    view: { tx: 68, ty: 3.5, tz: 20, azim: -1.15, elev: 0.18, dist: 38, fov: 42 } },
];
export const AUX = { id: 'Z07', cn: '辅助区', en: 'CONTROL & UTILITIES', rect: [16, 60, -40, -24] };
export const ENERGY = { cn: '能源站', en: 'ENERGY CENTER', rect: [-48, -24, -54, -42] };

export const VIEW_OVERVIEW = { tx: 4, ty: 3, tz: 2, azim: -0.70, elev: 0.44, dist: 300, fov: 29 };

// 21 个工位：beacon = 信标位置；box = 拾取包围盒 [x0,x1,y0,y1,z0,z1]
export const STATIONS = [
  { id: 'ASRS-01', zone: 'Z01', cn: '堆垛机组 A', en: 'STACKER A · AISLE 1-2', beacon: [-68.4, 22.4, -6], box: [-76, -64, 0, 21, -32, 20] },
  { id: 'ASRS-02', zone: 'Z01', cn: '堆垛机组 B', en: 'STACKER B · AISLE 3', beacon: [-61.2, 22.4, -6], box: [-64, -57.5, 0, 21, -32, 20] },
  { id: 'DOCK-IN', zone: 'Z01', cn: '进厂月台', en: 'INBOUND DOCK', beacon: [-74, 6, 28.5], box: [-79, -66, 0, 5, 21, 35] },
  { id: 'AGV-01', zone: 'SP', cn: 'AGV 调度', en: 'AGV FLEET DISPATCH', beacon: [8, 4.2, 0], box: [-49, 63, 0, 2, -3, 3] },
  { id: 'PR-01', zone: 'Z02', cn: '伺服压机 1', en: 'SERVO PRESS 1', beacon: [-39, 9.6, -20], box: [-42, -36, 0, 8, -22.5, -17.5] },
  { id: 'PR-02', zone: 'Z02', cn: '伺服压机 2', en: 'SERVO PRESS 2', beacon: [-31, 9.6, -20], box: [-34, -28, 0, 8, -22.5, -17.5] },
  { id: 'PR-03', zone: 'Z02', cn: '伺服压机 3', en: 'SERVO PRESS 3', beacon: [-23, 9.6, -20], box: [-26, -20, 0, 8, -22.5, -17.5] },
  { id: 'PR-04', zone: 'Z02', cn: '伺服压机 4', en: 'SERVO PRESS 4', beacon: [-15.5, 9.6, -20], box: [-18.5, -14, 0, 8, -22.5, -17.5] },
  { id: 'XF-01', zone: 'Z02', cn: '桁架机械手', en: 'CROSSBAR TRANSFER', beacon: [-44.2, 6.2, -20], box: [-47, -42, 0, 5, -24, -16] },
  { id: 'WB-01', zone: 'Z03', cn: '焊装单元 1', en: 'WELD CELL 1', beacon: [-42, 5.6, 20], box: [-45.5, -38.5, 0, 4, 9.5, 30.5] },
  { id: 'WB-02', zone: 'Z03', cn: '焊装单元 2', en: 'WELD CELL 2', beacon: [-34, 5.6, 20], box: [-37.5, -30.5, 0, 4, 9.5, 30.5] },
  { id: 'WB-03', zone: 'Z03', cn: '焊装单元 3', en: 'WELD CELL 3', beacon: [-26, 5.6, 20], box: [-29.5, -22.5, 0, 4, 9.5, 30.5] },
  { id: 'WB-04', zone: 'Z03', cn: '焊装单元 4', en: 'WELD CELL 4', beacon: [-18, 5.6, 20], box: [-21.5, -14.5, 0, 4, 9.5, 30.5] },
  { id: 'PT-01', zone: 'Z04', cn: '涂装房', en: 'SPRAY BOOTH', beacon: [2, 8, -14.2], box: [-8, 12, 0, 6.5, -21.5, -7] },
  { id: 'OV-01', zone: 'Z04', cn: '烘房', en: 'CURING OVEN', beacon: [2, 7.4, -27.2], box: [-8, 12, 0, 5.5, -31, -23.5] },
  { id: 'AS-01', zone: 'Z05', cn: '总装 1 线', en: 'ASSEMBLY LINE 1', beacon: [40, 6.4, 12], box: [17, 62, 0, 4, 9.5, 14.5] },
  { id: 'AS-02', zone: 'Z05', cn: '总装 2 线', en: 'ASSEMBLY LINE 2', beacon: [40, 6.4, 28], box: [17, 62, 0, 4, 25.5, 30.5] },
  { id: 'OC-01', zone: 'Z05', cn: '空中输送链', en: 'OVERHEAD CONVEYOR', beacon: [15, 8.6, 0], box: [13.5, 16.5, 4.5, 7.5, -27, 29] },
  { id: 'EOL-01', zone: 'Z06', cn: '下线检测', en: 'END-OF-LINE TEST', beacon: [67.2, 5.4, 20], box: [63.5, 74, 0, 4, 8, 32] },
  { id: 'DOCK-OUT', zone: 'Z06', cn: '发运月台', en: 'OUTBOUND DOCK', beacon: [76.4, 5.8, 6], box: [73, 79, 0, 5, 3, 9] },
  { id: 'EN-01', zone: 'EN', cn: '能源站', en: 'ENERGY CENTER', beacon: [-36, 9.5, -48], box: [-48, -24, -1.2, 8, -54, -42] },
];

// 巡游分镜：[tx,ty,tz,azim,elev,dist,fov]；via = 抵达阶段相机途经点（从南侧檐下进出、跨过空中输送轨道，避免穿桁架 / 灯带）
export const TOUR = [
  { n: '01', cn: '总览', en: 'OVERVIEW', dur: 10, split: 0.62, m: [3, 4, 3, -0.76, 0.47, 322, 30], b: [6, 3, 0, -0.62, 0.42, 286, 28] },
  { n: '02', cn: '原材料立库', en: 'RAW-MATERIAL AS/RS', dur: 10, split: 0.55, m: [-62, 6, 0, -0.72, 0.38, 82, 34], b: [-58, 5.5, 0, -0.95, 0.33, 66, 36] },
  { n: '03', cn: '冲压线', en: 'PRESS LINE', dur: 10, split: 0.5, m: [-30, 4, -20, 0.44, 0.15, 36, 42], b: [-26, 4.4, -20, 0.30, 0.19, 30, 40], via: [[-40, 11, 56], [-21, 9.6, 33]] },
  { n: '04', cn: '焊装车间', en: 'BODY WELDING', dur: 10, split: 0.5, m: [-30, 3, 20, 1.54, 0.12, 32, 44], b: [-26, 3.2, 22, 1.30, 0.16, 40, 42], via: [[-11.5, 11.0, 12.8]] },
  { n: '05', cn: '涂装车间', en: 'PAINT SHOP', dur: 9.5, split: 0.5, m: [2, 3, -18, 0, 0.12, 31, 42], b: [3, 3.4, -19, 0.30, 0.16, 36, 40] },
  { n: '06', cn: '总装线', en: 'FINAL ASSEMBLY', dur: 10.5, split: 0.55, m: [40, 5, 20, -0.90, 0.30, 70, 30], b: [44, 4.6, 20, -1.10, 0.26, 62, 32], via: [[10, 10.5, 34.6], [4, 12.5, 50]] },
  { n: '07', cn: '检测发运', en: 'EOL & SHIPPING', dur: 9.5, split: 0.5, m: [68, 4, 21, -1.55, 0.11, 30, 42], b: [70, 4.2, 18, -1.55, 0.12, 24, 44], via: [[6, 11.5, 48], [10.5, 10.5, 40], [20, 9.2, 33]] },
  { n: '08', cn: '升空', en: 'ASCENT', dur: 9, split: 0.62, m: [66, 6, 24, -0.35, 0.32, 110, 32], b: [52, 5, 12, -0.52, 0.44, 210, 30], via: [[42, 9.5, 34.6], [38, 12, 52]] },
  { n: '09', cn: '回到总览', en: 'RETURN', dur: 10, split: 0.5, m: [22, 4, 4, -0.70, 0.48, 330, 29], b: null },
];
export const TOUR_HOME = [4, 3, 2, -0.70, 0.44, 300, 29]; // = 默认总览 = 第 01 段起点 = 第 09 段终点

// 总装线
export const LINES = [{ id: 'AS-01', z: 12 }, { id: 'AS-02', z: 28 }];
export const DOOR_RODS = [19, 23.5, 28, 38.5, 48.5, 53, 57.5, 61.5]; // 门线吊杆 x（巡游镜头在 x≈34 / 45 处穿过门线）
export const LINE_X0 = 19, PITCH = 3.4, NST = 13; // 13 工位 × 3.4 m

export function zoneAt(x, z) {
  for (const zn of ZONES) { const [a, b, c, d] = zn.rect; if (x >= a && x <= b && z >= c && z <= d) return zn; }
  return null;
}
