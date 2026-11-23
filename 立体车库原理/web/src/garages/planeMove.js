// 平面移动（3 层，每层一条通道 + 一台台车，左端一台升降机；夹轮式，没有载车板）。
// 升降机只管换层，台车只管本层水平搬运。即使只处理一个请求，两者也能“预定位”并行干活。
import { Garage, move, turn, spawn, remove, tOf, DRIVE_SPEED, DRIVE_DIST, carIdx } from './base.js';

const W = 3.0, H = 2.4;
const LEVELS = 3, COLS = 4;   // 车位列 1..4；第 0 列是升降机
const Z = 5.3;
const LIFT_SPEED = 60;        // 升降机 m/min（示意）
const SHUTTLE_SPEED = 80;     // 台车 m/min（示意）
const CLAMP_SPEED = 15;       // 夹轮搬运器拖车 m/min（示意）
const TURN_TIME = 8;
const SIDES = { 前: 1, 后: -1 };

export class PlaneMove extends Garage {
  static key = 'plane';
  static title = '平面移动（3 层 × 2 排 × 4 列）';
  static intro = '每层中间一条通道，两侧是车位，<b>每层一台台车</b>；左端一台<b>升降机</b>连接各层和地面入口。'
    + '升降机只管换层，台车只管本层的水平搬运，两者能<b>同时干活</b>（预定位）。'
    + '这里用的是<b>夹轮式</b>搬运器：钻到车底夹住轮胎，没有载车板，所以存车不用先取空板。';
  static camera = { center: [5, 3, 2], forward: [-0.45, -0.45, -1], range: 11 };
  static footprint = (COLS + 1) * W * (2 * Z + 5.2);
  static speedNote = `升降机 ${LIFT_SPEED}、台车 ${SHUTTLE_SPEED}、夹轮 ${CLAMP_SPEED} m/min，旋转 ${TURN_TIME} s`;

  reset() {
    this.slotIds = [];
    for (let lv = 0; lv < LEVELS; lv++) for (const s of Object.keys(SIDES)) for (let c = 1; c <= COLS; c++) this.slotIds.push(`${lv + 1}F${s}${c}`);
    this.car = {};
    this.slotIds.forEach((sid, k) => { this.car[sid] = (k % 5 !== 1 && k % 5 !== 3) ? this.newCar()[0] : null; });
    this.liftLv = 0;
    this.shuttle = {};
    for (let lv = 0; lv < LEVELS; lv++) this.shuttle[lv] = 1;   // 台车所在列
  }

  slots() { return [...this.slotIds]; }
  slotLabel(sid) { return `${sid.slice(0, 2)} ${sid[2]}排第${sid[3]}列`; }
  parse(sid) { return [+sid[0] - 1, SIDES[sid[2]], +sid[3]]; }
  hasCar(sid) { return this.car[sid] !== null; }
  carIn(sid) { return this.car[sid]; }
  pos(sid) { const [lv, side, c] = this.parse(sid); return [c * W, lv * H + 0.1, side * Z]; }

  // ---- 设备动作（只生成动作，不加步骤） ----
  lift(lv, payload) {
    if (lv === this.liftLv) return [null, 0];
    const dy = (lv - this.liftLv) * H;
    this.liftLv = lv;
    const t = tOf(dy, LIFT_SPEED);
    return [move(['lift', ...payload], [0, dy, 0], t), t];
  }

  shuttleTo(lv, col, payload) {
    const c0 = this.shuttle[lv];
    if (c0 === col) return [null, 0];
    const dx = (col - c0) * W;
    this.shuttle[lv] = col;
    const t = tOf(dx, SHUTTLE_SPEED);
    return [move([`S${lv}`, ...payload], [dx, 0, 0], t), t];
  }

  prepare(liftLv, lv, col, steps, why) {
    const [a1, t1] = this.lift(liftLv, []);
    const [a2, t2] = this.shuttleTo(lv, col, []);
    if (!a1 && !a2) return;
    const parts = [];
    if (a1) parts.push(`升降机${liftLv === 0 ? '到底层' : `到 ${liftLv + 1}F`}（${t1.toFixed(1)}s）`);
    if (a2) parts.push(`${lv + 1}F 的台车开到第 ${col} 列（${t2.toFixed(1)}s）`);
    let txt = '预定位：' + parts.join('，同时');
    if (a1 && a2) txt += `。两台设备并行，只花较长的 ${Math.max(t1, t2).toFixed(1)}s`;
    steps.add(txt + `，${why}。`, a1, a2);
  }

  park(sid, steps) {
    const [lv, side, c] = this.parse(sid);
    this.prepare(0, lv, 1, steps, '准备接车');
    const [car, idx] = this.newCar();
    steps.add('车从正面开上升降机，司机下车离开。',
      spawn(car, [0, 0.1, DRIVE_DIST], idx), move([car], [0, 0, -DRIVE_DIST], tOf(DRIVE_DIST, DRIVE_SPEED)));
    let [a, t] = this.lift(lv, [car]);
    if (a) steps.add(`升降机载着车升到 ${lv + 1}F（${t.toFixed(1)}s）。`, a);
    steps.add(`${lv + 1}F 的台车已经在升降机口等着，夹轮搬运器把车从升降机拖到台车上。`,
      move([car], [W, 0, 0], tOf(W, CLAMP_SPEED)));
    [a, t] = this.shuttleTo(lv, c, [car]);
    if (a) steps.add(`台车载着车沿通道开到第 ${c} 列（${t.toFixed(1)}s）。升降机这时已经空出来，可以去服务别人。`, a);
    this.car[sid] = car;
    steps.add(`夹轮搬运器把车送进${this.slotLabel(sid)}。`, move([car], [0, 0, side * Z], tOf(Z, CLAMP_SPEED)));
  }

  retrieve(sid, steps) {
    const [lv, side, c] = this.parse(sid);
    this.prepare(lv, lv, c, steps, '准备取车');
    const car = this.car[sid];
    this.car[sid] = null;
    steps.add('夹轮搬运器钻到车底，夹住轮胎，把车拖到台车上。', move([car], [0, 0, -side * Z], tOf(Z, CLAMP_SPEED)));
    let [a, t] = this.shuttleTo(lv, 1, [car]);
    if (a) steps.add(`台车载着车开回升降机口（${t.toFixed(1)}s）。`, a);
    steps.add('把车从台车拖上升降机。', move([car], [-W, 0, 0], tOf(W, CLAMP_SPEED)));
    [a, t] = this.lift(0, [car]);
    const acts = a ? [a] : [];
    acts.push(turn([car], 180, TURN_TIME));
    steps.add('升降机降到底层' + (a ? `（${t.toFixed(1)}s）` : '') + `，同时转盘把车转 180°（${TURN_TIME}s），车头朝外。`, ...acts);
    steps.add('车往前开走。', move([car], [0, 0, DRIVE_DIST], tOf(DRIVE_DIST, DRIVE_SPEED)), remove(car));
  }

  ascii() {
    const lines = [];
    for (let lv = LEVELS - 1; lv >= 0; lv--) {
      for (const sname of ['后', '前']) {
        const row = [];
        for (let c = 1; c <= COLS; c++) row.push(this.car[`${lv + 1}F${sname}${c}`] ? '[车]' : '[  ]');
        const lift = sname === '后' ? (this.liftLv === lv ? '升降机' : '  |   ') : '      ';
        lines.push(`${lv + 1}F${sname}排 ${lift} ${row.join(' ')}`);
      }
      lines.push(`     通道   台车在第 ${this.shuttle[lv]} 列`);
    }
    return lines.join('\n');
  }

  poses() {
    const p = {};
    for (const s of this.slotIds) if (this.car[s]) p[this.car[s]] = [this.pos(s), 0];
    p.lift = [[0, this.liftLv * H, 0], 0];
    for (let lv = 0; lv < LEVELS; lv++) p[`S${lv}`] = [[this.shuttle[lv] * W, lv * H + 0.02, 0], 0];
    return p;
  }

  build(ctx) {
    ctx.ground(6, 3, 20, 26);
    ctx.driveway(0, 2.6, DRIVE_DIST + 2);
    const top = LEVELS * H;
    for (let c = 0; c <= COLS + 1; c++) {
      const x = (c - 0.5) * W;
      for (const z of [-Z - 2.6, -2.6, 2.6, Z + 2.6]) {
        if (c === 0 && z > 0) continue;
        ctx.box([x, top / 2, z], [0.14, top, 0.14]);
      }
    }
    for (let lv = 0; lv < LEVELS; lv++) {
      const y = lv * H;
      for (const side of Object.values(SIDES)) {
        for (let c = 1; c <= COLS; c++) ctx.box([c * W, y + 0.03, side * Z], [2.6, 0.06, 4.8], [0.62, 0.62, 0.6]);
      }
      for (const z of [-1.0, 1.0]) ctx.box([(COLS + 1) * W / 2 + W / 2, y + 0.01, z], [COLS * W, 0.04, 0.12], [0.2, 0.2, 0.2]);
      ctx.text([-1.4 * W, y + 0.8, 2.6], `${lv + 1}F`, 15);
      ctx.part(`S${lv}`, [this.shuttle[lv] * W, y + 0.02, 0], [
        ['box', [0, 0, 0], [2.4, 0.1, 4.6], [0.2, 0.7, 0.4]],
        ['label', [0, 0.3, 2.4], `${lv + 1}F台车`]]);
    }
    ctx.part('lift', [0, this.liftLv * H, 0], [
      ['box', [0, 0, 0], [2.8, 0.06, 5.0], [0.9, 0.6, 0.1]],
      ['cyl', [0, 0.03, 0], [0, 0.04, 0], 1.35, [0.5, 0.5, 0.55]],
      ['label', [0, 0.4, 2.6], '升降机']]);
    for (const sid of this.slotIds) if (this.car[sid]) ctx.car(this.car[sid], this.pos(sid), carIdx(this.car[sid]));
  }
}
