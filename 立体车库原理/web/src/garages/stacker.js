// 巷道堆垛（巷道两侧各 4 列 × 3 层，载车板式）。
// 一台堆垛机在中间巷道里行走（X）和升降（Y），再向前或向后伸出取放车板。
// 入口是巷道左端前侧地面层的“交接区”，带旋转盘。
import { Garage, move, turn, spawn, remove, tOf, carIdx, DRIVE_SPEED, DRIVE_DIST } from './base.js';

const W = 3.0, H = 2.4;
const COLS = 4, LEVELS = 3;
const Z = 5.3;               // 车位中心离巷道中心的距离
const TRAVEL_SPEED = 100;    // 行走 m/min（示意）
const LIFT_SPEED = 40;       // 升降 m/min（示意）
const FORK_SPEED = 30;       // 伸叉/拉板 m/min（示意）
const TURN_TIME = 8;         // 旋转盘转 180° 的时间 s（示意）
const BAY = 'BAY';
const sideName = (side) => (side > 0 ? '前' : '后');

export class Stacker extends Garage {
  static key = 'stacker';
  static title = '巷道堆垛（2 × 4 列 × 3 层）';
  static intro = '中间巷道里有一台<b>堆垛机</b>：沿轨道行走（X）、载车台升降（Y），再向前/向后伸出取放车板。'
    + '<b>行走和升降同时进行</b>，所以一次搬运的时间 = max(行走, 升降)。'
    + '这是载车板式：交接区必须先有一块空板，车才能开进来。按钮编号 = 前/后排 + 列-层。';
  static camera = { center: [4, 2.5, 2], forward: [-0.45, -0.45, -1], range: 11 };
  static footprint = (COLS + 1) * W * (2 * Z + 5.2);
  static speedNote = `行走 ${TRAVEL_SPEED}、升降 ${LIFT_SPEED}、伸叉 ${FORK_SPEED} m/min，旋转 ${TURN_TIME} s`;

  reset() {
    this.slotIds = [];
    this.loc = {};
    for (const side of [1, -1]) {
      for (let lv = 0; lv < LEVELS; lv++) {
        for (let c = 0; c < COLS; c++) {
          const sid = `${sideName(side)}${c + 1}-${lv + 1}`;
          this.slotIds.push(sid);
          this.loc[sid] = [side, c, lv];
        }
      }
    }
    this.loc[BAY] = [1, -1, 0];
    this.slotPallet = {}; this.home = {}; this.car = {}; this.heading = {};
    this.slotIds.forEach((sid, i) => {
      const k = i + 1;
      this.slotPallet[sid] = k;
      this.home[k] = sid;
      this.heading[k] = 0;
      this.car[k] = (k % 5 !== 0 && k % 5 !== 3) ? this.newCar()[0] : null;
    });
    this.slotPallet[BAY] = null;
    this.crane = [0, 0];       // [列, 层]
  }

  slots() { return [...this.slotIds]; }
  slotLabel(sid) { const [side, c, lv] = this.loc[sid]; return `${sideName(side)}排第${c + 1}列第${lv + 1}层`; }
  hasCar(sid) { const p = this.slotPallet[sid]; return p !== null && this.car[p] !== null; }
  carIn(sid) { const p = this.slotPallet[sid]; return p !== null ? this.car[p] : null; }

  pos(sid) { const [side, c, lv] = this.loc[sid]; return [c * W, lv * H + 0.1, side * Z]; }
  names(pid) { return [`P${pid}`].concat(this.car[pid] ? [this.car[pid]] : []); }
  where(sid) { return sid === BAY ? '交接区' : this.slotLabel(sid); }

  // ---- 堆垛机动作 ----
  travel(sid, payload, steps, why) {
    const [, c, lv] = this.loc[sid];
    const [c0, lv0] = this.crane;
    if (c === c0 && lv === lv0) return;
    const dx = (c - c0) * W, dy = (lv - lv0) * H;
    const tx = tOf(dx, TRAVEL_SPEED), ty = tOf(dy, LIFT_SPEED);
    this.crane = [c, lv];
    const acts = [];
    if (dx) acts.push(move(['mast', 'carriage', ...payload], [dx, 0, 0], tx));
    if (dy) acts.push(move(['carriage', ...payload], [0, dy, 0], ty));
    const timing = dx && dy
      ? `行走 ${tx.toFixed(1)}s、升降 ${ty.toFixed(1)}s 同时进行，用时取大的 ${Math.max(tx, ty).toFixed(1)}s`
      : (dx ? `只需行走 ${tx.toFixed(1)}s` : `只需升降 ${ty.toFixed(1)}s`);
    steps.add(`堆垛机${why}，开到${this.where(sid)}：${timing}。`, ...acts);
  }

  pull(sid, steps) {
    const pid = this.slotPallet[sid];
    this.slotPallet[sid] = null;
    const side = this.loc[sid][0];
    steps.add(`货叉伸${side > 0 ? '前' : '后'}，把 ${pid} 号车板${this.car[pid] ? '（连车）' : ''}拉到载车台上。`,
      move(this.names(pid), [0, 0, -side * Z], tOf(Z, FORK_SPEED)));
    return pid;
  }

  push(pid, sid, steps) {
    this.slotPallet[sid] = pid;
    const side = this.loc[sid][0];
    steps.add(`把 ${pid} 号车板推进${this.where(sid)}。`, move(this.names(pid), [0, 0, side * Z], tOf(Z, FORK_SPEED)));
  }

  returnBayPallet(steps) {
    const pid = this.slotPallet[BAY];
    const h = this.home[pid];
    steps.add(`交接区里停着 ${pid} 号空板，它的家在${this.slotLabel(h)}。它占着交接区，得先送回去。`);
    this.travel(BAY, [], steps, '去交接区');
    this.pull(BAY, steps);
    this.travel(h, this.names(pid), steps, '带着空板');
    this.push(pid, h, steps);
  }

  park(sid, steps) {
    let bay = this.slotPallet[BAY];
    if (bay !== null && this.home[bay] !== sid) {
      this.returnBayPallet(steps);
      bay = null;
    }
    if (bay === null) {
      steps.add(`交接区没有空板。载车板式的代价：存车前要先把 ${this.slotLabel(sid)} 的空板取出来送到交接区。`);
      this.travel(sid, [], steps, '去取空板');
      const pid = this.pull(sid, steps);
      this.travel(BAY, this.names(pid), steps, '带着空板');
      this.push(pid, BAY, steps);
    } else {
      steps.add(`交接区里刚好是 ${this.slotLabel(sid)} 的空板，车可以直接开进来，省掉一趟。`);
    }
    const pid = this.slotPallet[BAY];
    const [car, idx] = this.newCar();
    this.car[pid] = car;
    const [x, y, z] = this.pos(BAY);
    steps.add('车开进交接区，停在空板上，司机下车离开。',
      spawn(car, [x, y, z + DRIVE_DIST], idx), move([car], [0, 0, -DRIVE_DIST], tOf(DRIVE_DIST, DRIVE_SPEED)));
    this.travel(BAY, [], steps, '回到交接区');
    this.pull(BAY, steps);
    this.travel(sid, this.names(pid), steps, '载着车');
    this.push(pid, sid, steps);
  }

  retrieve(sid, steps) {
    if (this.slotPallet[BAY] !== null) this.returnBayPallet(steps);
    this.travel(sid, [], steps, '去取车');
    const pid = this.pull(sid, steps);
    this.travel(BAY, this.names(pid), steps, '载着车');
    this.push(pid, BAY, steps);
    this.heading[pid] = (this.heading[pid] + 180) % 360;
    steps.add('交接区的旋转盘把车板转 180°，车头朝外，司机可以直接往前开走。',
      turn(this.names(pid), 180, TURN_TIME));
    const car = this.car[pid];
    this.car[pid] = null;
    steps.add(`车开走。${pid} 号空板留在交接区，下一个来存车的人如果正好分到它的车位，就能省一趟。`,
      move([car], [0, 0, DRIVE_DIST], tOf(DRIVE_DIST, DRIVE_SPEED)), remove(car));
  }

  // ---- 显示与核对 ----
  ascii() {
    const cell = (sid) => {
      const p = this.slotPallet[sid];
      return p === null ? '  --  ' : (this.car[p] ? '[有车]' : '[空板]');
    };
    const lines = [];
    for (const side of [-1, 1]) {
      lines.push(`${sideName(side)}排：`);
      for (let lv = LEVELS - 1; lv >= 0; lv--) {
        const row = [];
        for (let c = 0; c < COLS; c++) row.push(cell(`${sideName(side)}${c + 1}-${lv + 1}`));
        lines.push(`  ${lv + 1}层 ` + row.join(' '));
      }
    }
    const b = this.slotPallet[BAY];
    lines.push('交接区：' + (b === null ? '空（没有车板）' : `${b} 号空板（家在 ${this.home[b]}）`));
    lines.push(`堆垛机：第${this.crane[0] >= 0 ? this.crane[0] + 1 : '交接'}列 第${this.crane[1] + 1}层`);
    lines.push('（-- 表示车板不在，被拿到交接区了）');
    return lines.join('\n');
  }

  poses() {
    const p = {};
    for (const [sid, pid] of Object.entries(this.slotPallet)) {
      if (pid === null) continue;
      p[`P${pid}`] = [this.pos(sid), this.heading[pid]];
      if (this.car[pid]) p[this.car[pid]] = [this.pos(sid), 0];
    }
    const [c, lv] = this.crane;
    p.mast = [[c * W, 0, 0], 0];
    p.carriage = [[c * W, lv * H + 0.02, 0], 0];
    return p;
  }

  check() {
    const b = this.slotPallet[BAY];
    const missing = this.slotIds.filter((s) => this.slotPallet[s] === null);
    if (b === null) {
      if (missing.length) throw new Error('交接区没板，却有车位缺板');
    } else if (!(missing.length === 1 && missing[0] === this.home[b] && this.car[b] === null)) {
      throw new Error('交接区的空板和缺板车位对不上');
    }
  }

  build(ctx) {
    ctx.ground(4, 3, 20, 26);
    const [bx, , bz] = this.pos(BAY);
    ctx.driveway(bx, bz + 2.5, bz + DRIVE_DIST + 2);
    ctx.cyl([bx, 0.01, bz], [0, 0.04, 0], 1.45, [0.4, 0.4, 0.45]);       // 旋转盘
    ctx.text([bx, 1.6, bz + 2.2], '交接区', 14);
    ctx.box([4.5, 0.02, 0], [(COLS + 1.5) * W, 0.04, 0.3], [0.2, 0.2, 0.2]);   // 地轨
    const top = LEVELS * H;
    for (const side of [1, -1]) {
      const zf = side * (Z - 2.6), zb = side * (Z + 2.6);
      for (let c = side > 0 ? -1 : 0; c <= COLS; c++) {
        const x = (c - 0.5) * W;
        for (const z of [zf, zb]) ctx.box([x, top / 2, z], [0.14, top, 0.14]);
      }
      for (let lv = 1; lv <= LEVELS; lv++) {
        for (const z of [zf, zb]) ctx.box([(COLS - 1) * W / 2, lv * H - 0.05, z], [COLS * W, 0.1, 0.1]);
      }
      ctx.text([-1.2 * W, top + 0.4, side * Z], `${sideName(side)}排`, 16);
    }
    const [c, lv] = this.crane;
    const Y = [0.9, 0.6, 0.1];
    ctx.part('mast', [c * W, 0, 0], [
      ['box', [-1.4, top / 2 + 0.3, 0], [0.18, top + 0.6, 0.4], Y],
      ['box', [1.4, top / 2 + 0.3, 0], [0.18, top + 0.6, 0.4], Y],
      ['box', [0, top + 0.6, 0], [3.0, 0.2, 0.4], Y],
      ['box', [0, 0.1, 0], [3.0, 0.2, 0.6], Y]]);
    ctx.part('carriage', [c * W, lv * H + 0.02, 0], [
      ['box', [0, -0.05, 0], [2.6, 0.08, 5.0], [0.95, 0.75, 0.2]],
      ['label', [0, 0.3, 2.6], '堆垛机']]);
    for (const [sid, pid] of Object.entries(this.slotPallet)) {
      if (pid === null) continue;
      ctx.pallet(`P${pid}`, this.pos(sid), { tag: this.home[pid].replace(BAY, ''), heading: this.heading[pid] });
      if (this.car[pid]) ctx.car(this.car[pid], this.pos(sid), carIdx(this.car[pid]));
    }
  }
}
