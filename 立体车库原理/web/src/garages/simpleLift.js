// 简易升降（两层，2 列）。
// 每列一块上层车板，由立柱带动升降；下层就是普通地面车位。
// 上层车板降下来时会占住下层车位，所以：下层停着车，上层的车就下不来。
import { Garage, move, spawn, remove, tOf, carIdx, DRIVE_SPEED, DRIVE_DIST } from './base.js';

const W = 3.0, H = 2.1, D = 5.2;
const LIFT_SPEED = 6;          // 升降 m/min（示意）
const COLS = 2;
const AWAY = DRIVE_DIST + 5;   // 下层车临时让开时停的位置（比新车出现的地方更远，免得重叠）

export class SimpleLift extends Garage {
  static key = 'simple';
  static title = '简易升降（两层）';
  static intro = '每列只有一块能升降的上层车板，下层是普通车位。上层车板要降到地面，就会占住下层车位，'
    + '所以<b>下层停着车时，上层的车取不出来</b>，必须先让下层车开走。升降横移正是为了解决这个问题。';
  static camera = { center: [0, 1.6, 2], forward: [-0.4, -0.35, -1], range: 6 };
  static footprint = COLS * W * D;
  static speedNote = `升降 ${LIFT_SPEED} m/min`;

  reset() {
    this.upper = {}; this.lower = {};
    for (let c = 0; c < COLS; c++) { this.upper[c] = null; this.lower[c] = null; }
    for (let c = 0; c < COLS; c++) this.upper[c] = this.newCar()[0];
    this.lower[0] = this.newCar()[0];
  }

  slots() {
    const out = [];
    for (let c = 0; c < COLS; c++) for (const lv of ['上', '下']) out.push(`${c}${lv}`);
    return out;
  }
  slotLabel(sid) { return `第${+sid[0] + 1}列${sid[1]}层`; }
  slotShort(sid) { return `${+sid[0] + 1}${sid[1]}`; }
  where(sid) { return [+sid[0], sid[1] === '上' ? this.upper : this.lower]; }
  hasCar(sid) { const [c, d] = this.where(sid); return d[c] !== null; }
  carIn(sid) { const [c, d] = this.where(sid); return d[c]; }

  static x(c) { return (c - (COLS - 1) / 2) * W; }

  moveLowerAway(c, steps) {
    const car = this.lower[c];
    steps.add(`第${c + 1}列下层停着车。上层车板一降下来就会压到它，所以必须先把下层的车开走`
      + '（真实情况下要等下层车主来挪车，这正是简易升降最大的缺点）。',
    move([car], [0, 0, AWAY], tOf(AWAY, DRIVE_SPEED)));
    return car;
  }

  moveLowerBack(c, car, steps) {
    steps.add('上层的事办完了，下层的车再开回原位。', move([car], [0, 0, -AWAY], tOf(AWAY, DRIVE_SPEED)));
  }

  lowerUpper(c, steps, down) {
    const names = [`P${c}`].concat(this.upper[c] ? [this.upper[c]] : []);
    const t = tOf(H, LIFT_SPEED);
    if (down) steps.add(`第${c + 1}列上层车板降到地面。`, move(names, [0, -H, 0], t));
    else steps.add('车板升回上层。', move(names, [0, H, 0], t));
  }

  retrieve(sid, steps) {
    const [c, d] = this.where(sid);
    const car = d[c];
    const tdrive = tOf(DRIVE_DIST, DRIVE_SPEED);
    if (d === this.lower) {
      d[c] = null;
      steps.add('下层车位就在地面上，车直接开走。', move([car], [0, 0, DRIVE_DIST], tdrive), remove(car));
      return;
    }
    const moved = this.lower[c] ? this.moveLowerAway(c, steps) : null;
    this.lowerUpper(c, steps, true);
    this.upper[c] = null;
    steps.add('车从上层车板上开走。', move([car], [0, 0, DRIVE_DIST], tdrive), remove(car));
    this.lowerUpper(c, steps, false);
    if (moved) this.moveLowerBack(c, moved, steps);
  }

  park(sid, steps) {
    const [c, d] = this.where(sid);
    const [car] = this.newCar();
    const tdrive = tOf(DRIVE_DIST, DRIVE_SPEED);
    const X = SimpleLift.x(c);
    if (d === this.lower) {
      d[c] = car;
      steps.add('车直接开进下层车位。',
        spawn(car, [X, 0, DRIVE_DIST], carIdx(car)), move([car], [0, 0, -DRIVE_DIST], tdrive));
      return;
    }
    const moved = this.lower[c] ? this.moveLowerAway(c, steps) : null;
    this.lowerUpper(c, steps, true);
    this.upper[c] = car;
    steps.add('车开上降到地面的上层车板。',
      spawn(car, [X, 0.1, DRIVE_DIST], carIdx(car)), move([car], [0, 0, -DRIVE_DIST], tdrive));
    this.lowerUpper(c, steps, false);
    if (moved) this.moveLowerBack(c, moved, steps);
  }

  ascii() {
    const f = (v) => (v ? '[车]' : '[  ]');
    const row = (d) => Array.from({ length: COLS }, (_, c) => f(d[c])).join('  ');
    return `上层  ${row(this.upper)}\n下层  ${row(this.lower)}`;
  }

  poses() {
    const p = {};
    for (let c = 0; c < COLS; c++) {
      const X = SimpleLift.x(c);
      p[`P${c}`] = [[X, H + 0.1, 0], 0];
      if (this.upper[c]) p[this.upper[c]] = [[X, H + 0.1, 0], 0];
      if (this.lower[c]) p[this.lower[c]] = [[X, 0, 0], 0];
    }
    return p;
  }

  build(ctx) {
    ctx.ground(0, 4, 10, 16);
    for (let c = 0; c < COLS; c++) {
      const X = SimpleLift.x(c);
      ctx.driveway(X, 0, DRIVE_DIST + 2);
      for (const sx of [-1, 1]) ctx.box([X + sx * W * 0.47, 1.4, -D / 2 + 0.2], [0.15, 2.8, 0.15]);
      // 立柱顶上的横梁和液压缸（示意）
      ctx.box([X, 2.85, -D / 2 + 0.2], [W * 0.94 + 0.15, 0.12, 0.15]);
      for (const sx of [-1, 1]) ctx.cyl([X + sx * W * 0.47, 0.2, -D / 2 + 0.42], [0, 2.4, 0], 0.06, [0.6, 0.62, 0.66]);
      ctx.text([X, 3.3, -D / 2], `第${c + 1}列`);
    }
    for (const [name, [pos, h]] of Object.entries(this.poses())) {
      if (name.startsWith('P')) ctx.pallet(name, pos, { tag: `${+name[1] + 1}上`, heading: h });
      else ctx.car(name, pos, carIdx(name), h);
    }
  }
}
