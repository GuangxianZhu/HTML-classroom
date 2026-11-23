// 垂直循环（10 个吊篮）。
// 吊篮挂在一条竖着的跑道形链条上，靠重力始终保持水平。出入口只有最底部一个。
// 存/取车 = 把目标吊篮转到最底部；系统会比较顺时针和逆时针哪边更近。
import { stadiumPoint } from '../motion.js';
import { Garage, move, spawn, remove, loop, tOf, carIdx, DRIVE_SPEED, DRIVE_DIST } from './base.js';

const N = 10;
const R = 1.6, HANG = 1.6;
const SP = 2.0;                                   // 相邻吊篮在链条上的间距
const P_LEN = N * SP;
const STRAIGHT = (P_LEN - 2 * Math.PI * R) / 2;
export const PATH = { r: R, h: STRAIGHT, cx: 0, cy: 0.1 + HANG + R + STRAIGHT / 2, z: 0, hang: HANG };
const CHAIN_SPEED = 10;   // 链条 m/min（示意）

export class VerticalCirc extends Garage {
  static key = 'circ';
  static title = '垂直循环（10 个吊篮）';
  static intro = '吊篮挂在一条竖着的环形链条上，像竖起来的摩天轮，靠重力保持水平。出入口只有<b>最底部</b>一个。'
    + '存/取车就是把目标吊篮转到底部，系统会算<b>顺时针和逆时针哪边更近</b>。'
    + '代价是：每次<b>所有吊篮都要跟着转</b>。';
  static camera = { center: [0, 4.5, 1], forward: [-0.3, -0.2, -1], range: 8 };
  static footprint = (2 * R + 2.6) * 6.0;
  static speedNote = `链条 ${CHAIN_SPEED} m/min`;

  reset() {
    this.offset = 0;
    this.car = {};
    for (let i = 1; i <= N; i++) this.car[i] = null;
    for (let i = 1; i <= N; i++) if (![1, 4, 7].includes(i)) this.car[i] = this.newCar()[0];
  }

  slots() { return Array.from({ length: N }, (_, i) => String(i + 1)); }
  slotLabel(sid) { return `${sid} 号吊篮`; }
  hasCar(sid) { return this.car[+sid] !== null; }
  carIn(sid) { return this.car[+sid]; }

  sOf(i) { return ((((i - 1) * SP + this.offset) % P_LEN) + P_LEN) % P_LEN; }
  names(i) { return [`C${i}`].concat(this.car[i] ? [this.car[i]] : []); }

  bringDown(i, steps) {
    const s = this.sOf(i);
    if (s < 1e-6 || P_LEN - s < 1e-6) {
      steps.add(`${i} 号吊篮正好就在底部入口，链条不用转。`);
      return;
    }
    const cw = -s, ccw = P_LEN - s;              // s 减小 = 从正面看顺时针
    const ds = Math.abs(cw) <= Math.abs(ccw) ? cw : ccw;
    const k = Math.round(Math.abs(ds) / SP);
    const other = Math.round(Math.abs(ds === cw ? ccw : cw) / SP);
    const direction = ds < 0 ? '顺时针' : '逆时针';
    const items = [];
    for (let j = 1; j <= N; j++) items.push([this.names(j), this.sOf(j)]);
    this.offset = (((this.offset + ds) % P_LEN) + P_LEN) % P_LEN;
    steps.add(`${i} 号吊篮离底部：${direction}要转 ${k} 格，反方向要转 ${other} 格。选近的，${direction}转 ${k} 格。`
      + `注意全部 ${N} 个吊篮都跟着一起转。`,
    loop(items, PATH, ds, tOf(ds, CHAIN_SPEED)));
  }

  retrieve(sid, steps) {
    const i = +sid;
    this.bringDown(i, steps);
    const car = this.car[i];
    this.car[i] = null;
    steps.add('车从底部吊篮倒车开出。吊篮不需要转回原位。',
      move([car], [0, 0, DRIVE_DIST], tOf(DRIVE_DIST, DRIVE_SPEED)), remove(car));
  }

  park(sid, steps) {
    const i = +sid;
    this.bringDown(i, steps);
    const [car, idx] = this.newCar();
    this.car[i] = car;
    steps.add('车开进底部的吊篮。', spawn(car, [0, 0.1, DRIVE_DIST], idx),
      move([car], [0, 0, -DRIVE_DIST], tOf(DRIVE_DIST, DRIVE_SPEED)));
  }

  ascii() {
    const order = this.slots().map(Number).sort((a, b) => this.sOf(a) - this.sOf(b));
    const cells = order.map((i) => `${i}${this.car[i] ? '车' : '空'}`);
    return '从底部入口开始，逆时针方向依次是：\n' + cells.join(' → ') + `\n底部入口现在是 ${order[0]} 号吊篮`;
  }

  poses() {
    const p = {};
    for (let i = 1; i <= N; i++) {
      const [x, y, z] = stadiumPoint(PATH, this.sOf(i));
      for (const n of this.names(i)) p[n] = [[x, y - HANG, z], 0];
    }
    return p;
  }

  build(ctx) {
    ctx.ground(0, 4, 12, 16);
    ctx.driveway(0, 2.4, DRIVE_DIST + 2);
    // 两侧的链条（小方块画出路径）、链轮和立柱
    const n = 80;
    for (const zc of [-2.7, 2.7]) {
      for (let k = 0; k < n; k++) {
        const [x, y] = stadiumPoint(PATH, k * P_LEN / n);
        ctx.box([x, y, zc], [0.12, 0.12, 0.08], [0.2, 0.2, 0.2]);
      }
      for (const yc of [PATH.cy - PATH.h / 2, PATH.cy + PATH.h / 2]) {     // 上下两个链轮的轮毂
        ctx.cyl([0, yc, zc - 0.1], [0, 0, 0.2], 0.32, [0.42, 0.44, 0.48]);
      }
      for (const sx of [-1, 1]) ctx.box([sx * (R + 1.5), PATH.cy, zc], [0.2, 2 * PATH.cy, 0.2]);
      ctx.box([0, 2 * PATH.cy, zc], [2 * (R + 1.5), 0.2, 0.2]);
    }
    const steel = [0.25, 0.35, 0.55];
    for (let i = 1; i <= N; i++) {
      const [x, y, z] = stadiumPoint(PATH, this.sOf(i));
      const pos = [x, y - HANG, z];
      const shapes = [['box', [0, 0, 0], [2.4, 0.1, 4.8], [0.72, 0.72, 0.68]]];
      for (const zz of [-2.55, 2.55]) {             // 两端各一个门形吊架，车从中间穿过
        for (const xx of [-1.15, 1.15]) shapes.push(['box', [xx, HANG / 2, zz], [0.08, HANG, 0.08], steel]);
        shapes.push(['box', [0, HANG, zz], [2.38, 0.1, 0.1], steel]);
      }
      shapes.push(['box', [0, HANG, 0], [0.1, 0.1, 5.4], steel]);
      shapes.push(['label', [0, 0.15, 2.3], String(i)]);
      ctx.part(`C${i}`, pos, shapes);
      if (this.car[i]) ctx.car(this.car[i], pos, carIdx(this.car[i]));
    }
  }
}
