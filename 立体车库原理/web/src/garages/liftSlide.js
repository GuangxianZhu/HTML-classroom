// 升降横移（3 层 × 3 列）。
// 1F 只能横移，3F 只能升降，2F 两者都能；1F、2F 各留一个空位。
// 上层车板要降到地面，它正下方每一层的同一列都必须是空位，所以要先横移让位。
// n 列的车库有 3n-2 个车板。
import { Garage, move, spawn, remove, tOf, carIdx, padc, DRIVE_SPEED, DRIVE_DIST } from './base.js';

const W = 3.0, H = 2.4, D = 5.2;
const LEVELS = 3;
const LIFT_SPEED = 6;    // 升降 m/min（示意）
const SLIDE_SPEED = 8;   // 横移 m/min（示意）

export class LiftSlide extends Garage {
  static key = 'liftslide';
  static title = '升降横移（3 层 × 3 列）';
  static intro = '1F 只能横移，3F 只能升降，2F 两者都能。1F、2F 各留一个<b>空位</b>。'
    + '上层车板要降到地面，它正下方每一层的同一列都必须是空位，所以要先<b>横移让位</b>。'
    + '注意：没停车的“空车板”不等于“空位”，它照样挡路。';
  static camera = { center: [0, 3.2, 1], forward: [-0.35, -0.3, -1], range: 7 };
  static footprint = 3 * W * D;
  static speedNote = `升降 ${LIFT_SPEED} m/min，横移 ${SLIDE_SPEED} m/min`;

  reset() {
    this.grid = [[1, null, 2], [3, 4, null], [5, 6, 7]];
    this.car = {};
    for (let p = 1; p <= 7; p++) this.car[p] = p !== 4 ? this.newCar()[0] : null;
  }

  slots() { return ['1', '2', '3', '4', '5', '6', '7']; }
  slotLabel(sid) { return `${sid} 号车板`; }
  hasCar(sid) { return this.car[+sid] !== null; }
  carIn(sid) { return this.car[+sid]; }

  locate(pid) {
    for (let lv = 0; lv < this.grid.length; lv++) {
      const c = this.grid[lv].indexOf(pid);
      if (c >= 0) return [lv, c];
    }
    return null;
  }

  static pos(lv, col) { return [(col - 1) * W, lv * H + 0.1, 0]; }
  names(pid) { return [`P${pid}`].concat(this.car[pid] ? [this.car[pid]] : []); }

  shiftGap(lv, target, pid, steps) {
    const row = this.grid[lv];
    const gap = row.indexOf(null);
    if (gap === target) {
      steps.add(`${lv + 1}F 的空位刚好就在第 ${target + 1} 列，这层不用动。`);
      return;
    }
    let movers, dx, direction;
    if (gap < target) {
      movers = []; for (let c = gap + 1; c <= target; c++) movers.push(c);
      dx = -W; direction = '左';
    } else {
      movers = []; for (let c = target; c < gap; c++) movers.push(c);
      dx = W; direction = '右';
    }
    const ids = movers.map((c) => row[c]);
    const newRow = [...row];
    for (const c of movers) newRow[c + (dx < 0 ? -1 : 1)] = row[c];
    newRow[target] = null;
    this.grid[lv] = newRow;
    const who = ids.length > 1 ? `车板 ${ids.join('、')} 一起` : `${ids[0]} 号车板`;
    const names = ids.flatMap((p) => this.names(p));
    steps.add(`${lv + 1}F：空位原来在第 ${gap + 1} 列。${who}向${direction}横移一格，`
      + `把空位让到第 ${target + 1} 列，给 ${pid} 号车板腾出下降通道。`,
    move(names, [dx, 0, 0], tOf(W, SLIDE_SPEED)));
  }

  go(pid, steps, retrieving) {
    const [lv, col] = this.locate(pid);
    const tdrive = tOf(DRIVE_DIST, DRIVE_SPEED);
    if (lv === 0) {
      steps.add(`${pid} 号车板就在 1F，车可以直接开出/开进，不需要任何车板让位。`);
    } else {
      const below = lv === 1 ? '1F' : `1F 到 ${lv}F`;
      steps.add(`${pid} 号车板在 ${lv + 1}F 第 ${col + 1} 列。要让它降到地面，它下面${below}的第 ${col + 1} 列`
        + '都必须是空位。每层只有一个空位，所以逐层检查，必要时横移让位。');
      for (let k = 0; k < lv; k++) this.shiftGap(k, col, pid, steps);
      this.grid[lv][col] = null;
      steps.add(`下降通道已打通，${pid} 号车板从 ${lv + 1}F 降到地面。`,
        move(this.names(pid), [0, -lv * H, 0], tOf(lv * H, LIFT_SPEED)));
    }
    const [x, y] = LiftSlide.pos(0, col);
    if (retrieving) {
      const car = this.car[pid];
      this.car[pid] = null;
      steps.add(`车从 ${pid} 号车板倒车开出。`, move([car], [0, 0, DRIVE_DIST], tdrive), remove(car));
    } else {
      const [car, idx] = this.newCar();
      this.car[pid] = car;
      steps.add(`车开上 ${pid} 号车板。`, spawn(car, [x, y, DRIVE_DIST], idx), move([car], [0, 0, -DRIVE_DIST], tdrive));
    }
    if (lv > 0) {
      this.grid[lv][col] = pid;
      steps.add(`${pid} 号车板升回 ${lv + 1}F。下层被横移的车板不用复位，空位留在哪都行。`,
        move(this.names(pid), [0, lv * H, 0], tOf(lv * H, LIFT_SPEED)));
    }
  }

  retrieve(sid, steps) { this.go(+sid, steps, true); }
  park(sid, steps) { this.go(+sid, steps, false); }

  ascii() {
    const lines = [];
    for (let lv = LEVELS - 1; lv >= 0; lv--) {
      const cells = this.grid[lv].map((p) => (p === null ? '空位' : `[${p}${this.car[p] ? '车' : '空'}]`));
      lines.push(`${lv + 1}F  ` + cells.map((c) => padc(c, 6)).join(' '));
    }
    return lines.join('\n');
  }

  poses() {
    const p = {};
    for (let lv = 0; lv < LEVELS; lv++) {
      this.grid[lv].forEach((pid, col) => {
        if (pid) for (const n of this.names(pid)) p[n] = [LiftSlide.pos(lv, col), 0];
      });
    }
    return p;
  }

  check() {
    const nulls = (r) => r.filter((v) => v === null).length;
    if (nulls(this.grid[0]) !== 1 || nulls(this.grid[1]) !== 1) throw new Error('每层空位数不对');
    if (this.grid[2].includes(null)) throw new Error('3F 不该有空位');
  }

  build(ctx) {
    ctx.ground(0, 4, 16, 18);
    ctx.driveway(0, 2, 11, 3 * W * 0.95);
    for (const x of [-1.5 * W, -0.5 * W, 0.5 * W, 1.5 * W]) {
      for (const z of [-D / 2, D / 2]) ctx.box([x, LEVELS * H / 2, z], [0.15, LEVELS * H, 0.15]);
    }
    for (let lv = 1; lv <= LEVELS; lv++) {
      for (const z of [-D / 2, D / 2]) ctx.box([0, lv * H - 0.05, z], [3 * W, 0.12, 0.12]);
      ctx.text([-1.5 * W - 1.0, (lv - 1) * H + 0.6, D / 2], `${lv}F`, 16);
    }
    for (let lv = 0; lv < LEVELS; lv++) {
      this.grid[lv].forEach((pid, col) => {
        if (!pid) return;
        ctx.pallet(`P${pid}`, LiftSlide.pos(lv, col), { tag: String(pid) });
        if (this.car[pid]) ctx.car(this.car[pid], LiftSlide.pos(lv, col), carIdx(this.car[pid]));
      });
    }
  }
}
