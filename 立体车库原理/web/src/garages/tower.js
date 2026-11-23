// 垂直升降 / 塔库（8 层，每层左右各 1 个车位，载车板式）。
// 中央电梯井，电梯平台自带旋转盘，底层就是出入口。
// 所有车都要经过同一台电梯，电梯是唯一的瓶颈。
import { Garage, move, turn, spawn, remove, tOf, carIdx, DRIVE_SPEED, DRIVE_DIST } from './base.js';

const W = 2.9, H = 2.2, D = 5.2;
const LEVELS = 8;            // 存车层 1..8，0 层是出入口
const LIFT_SPEED = 90;       // 电梯 m/min（示意）
const SHIFT_SPEED = 20;      // 横向推拉车板 m/min（示意）
const TURN_TIME = 8;         // 旋转 180° 用时 s（示意）

export class Tower extends Garage {
  static key = 'tower';
  static title = '垂直升降 / 塔库（8 层）';
  static intro = '中央是电梯井，每层左右各一个车位，<b>底层电梯就是出入口</b>，电梯平台自带旋转盘。'
    + '存车：电梯先去取一块空板下来 → 车开上去 → 电梯升到目标层 → 把车板横推进车位。'
    + '所有车都要经过<b>同一台电梯</b>，它是唯一的瓶颈。';
  static camera = { center: [0, 9.5, 3], forward: [-0.5, -0.25, -1], range: 13 };
  static footprint = 3 * W * D;
  static speedNote = `电梯 ${LIFT_SPEED}、横推 ${SHIFT_SPEED} m/min，旋转 ${TURN_TIME} s`;

  reset() {
    this.slotIds = [];
    for (let lv = 1; lv <= LEVELS; lv++) for (const s of ['左', '右']) this.slotIds.push(`${lv}${s}`);
    this.slotPallet = {}; this.home = {}; this.car = {}; this.heading = {};
    this.slotIds.forEach((sid, i) => {
      const k = i + 1;
      this.slotPallet[sid] = k;
      this.home[k] = sid;
      this.heading[k] = 0;
      this.car[k] = k % 4 !== 0 ? this.newCar()[0] : null;
    });
    this.liftLv = 0;
    this.liftP = null;
  }

  slots() { return [...this.slotIds]; }
  slotLabel(sid) { return `${sid.slice(0, -1)}层${sid.slice(-1)}侧`; }
  hasCar(sid) { const p = this.slotPallet[sid]; return p !== null && this.car[p] !== null; }
  carIn(sid) { const p = this.slotPallet[sid]; return p !== null ? this.car[p] : null; }

  lvSide(sid) { return [parseInt(sid.slice(0, -1), 10), sid.slice(-1) === '左' ? -1 : 1]; }
  pos(sid) { const [lv, side] = this.lvSide(sid); return [side * W, lv * H + 0.1, 0]; }
  names(pid) { return [`P${pid}`].concat(this.car[pid] ? [this.car[pid]] : []); }
  payload() { return this.liftP ? this.names(this.liftP) : []; }

  liftTo(lv, steps, why, rotate = false) {
    if (lv === this.liftLv) {
      if (rotate) this.rotate(steps);
      return;
    }
    const dy = (lv - this.liftLv) * H;
    const t = tOf(dy, LIFT_SPEED);
    const acts = [move(['lift', ...this.payload()], [0, dy, 0], t)];
    const name = (k) => (k ? `${k} 层` : '底层');
    let txt = `电梯${why}，从${name(this.liftLv)}${dy > 0 ? '升' : '降'}到${name(lv)}，用时 ${t.toFixed(1)}s`;
    if (rotate) {
      this.heading[this.liftP] = (this.heading[this.liftP] + 180) % 360;
      acts.push(turn(this.payload(), 180, TURN_TIME));
      txt += `；下降的同时旋转盘把车转 180°（${TURN_TIME}s），让车头朝外`;
    }
    this.liftLv = lv;
    steps.add(txt + '。', ...acts);
  }

  rotate(steps) {
    this.heading[this.liftP] = (this.heading[this.liftP] + 180) % 360;
    steps.add('旋转盘把车转 180°，车头朝外。', turn(this.payload(), 180, TURN_TIME));
  }

  pull(sid, steps) {
    const pid = this.slotPallet[sid];
    this.slotPallet[sid] = null;
    this.liftP = pid;
    const [, side] = this.lvSide(sid);
    steps.add(`把 ${this.slotLabel(sid)} 的 ${pid} 号车板${this.car[pid] ? '（连车）' : '（空板）'}横拉进电梯。`,
      move(this.names(pid), [-side * W, 0, 0], tOf(W, SHIFT_SPEED)));
  }

  push(sid, steps) {
    const pid = this.liftP;
    this.slotPallet[sid] = pid;
    this.liftP = null;
    const [, side] = this.lvSide(sid);
    steps.add(`把 ${pid} 号车板横推进${this.slotLabel(sid)}。`, move(this.names(pid), [side * W, 0, 0], tOf(W, SHIFT_SPEED)));
  }

  returnLiftPallet(steps) {
    const h = this.home[this.liftP];
    steps.add(`电梯上还放着 ${this.liftP} 号空板（家在${this.slotLabel(h)}），得先把它送回去，电梯才能干别的。`);
    this.liftTo(this.lvSide(h)[0], steps, '带着空板');
    this.push(h, steps);
  }

  park(sid, steps) {
    const [lv] = this.lvSide(sid);
    if (this.liftP && this.home[this.liftP] !== sid) this.returnLiftPallet(steps);
    if (this.liftP === null) {
      steps.add(`载车板式的代价：存车前电梯要先去${this.slotLabel(sid)}把空板取下来。`);
      this.liftTo(lv, steps, '去取空板');
      this.pull(sid, steps);
    } else {
      steps.add(`电梯上刚好就是${this.slotLabel(sid)}的空板，省掉取板这一趟。`);
    }
    this.liftTo(0, steps, '带着空板');
    const pid = this.liftP;
    const [car, idx] = this.newCar();
    this.car[pid] = car;
    steps.add('车从正面开上电梯里的空板，司机下车离开。',
      spawn(car, [0, 0.1, DRIVE_DIST], idx), move([car], [0, 0, -DRIVE_DIST], tOf(DRIVE_DIST, DRIVE_SPEED)));
    this.liftTo(lv, steps, '载着车');
    this.push(sid, steps);
  }

  retrieve(sid, steps) {
    const [lv] = this.lvSide(sid);
    if (this.liftP) this.returnLiftPallet(steps);
    this.liftTo(lv, steps, '去取车');
    this.pull(sid, steps);
    this.liftTo(0, steps, '载着车', true);
    const pid = this.liftP;
    const car = this.car[pid];
    this.car[pid] = null;
    steps.add(`车往前开走。${pid} 号空板留在电梯上，下一个人存车时如果正好分到它的车位，就能省一趟。`,
      move([car], [0, 0, DRIVE_DIST], tOf(DRIVE_DIST, DRIVE_SPEED)), remove(car));
  }

  ascii() {
    const cell = (sid) => {
      const p = this.slotPallet[sid];
      return p === null ? '  --  ' : (this.car[p] ? '[有车]' : '[空板]');
    };
    const lines = [];
    for (let lv = LEVELS; lv >= 0; lv--) {
      const mid = this.liftLv === lv ? (this.liftP ? '电梯+板' : ' 电梯  ') : '   |   ';
      if (lv === 0) lines.push(`底层        ${mid}        ← 出入口`);
      else lines.push(`${lv}层  ${cell(`${lv}左`)} ${mid} ${cell(`${lv}右`)}`);
    }
    return lines.join('\n');
  }

  poses() {
    const p = {};
    for (const [sid, pid] of Object.entries(this.slotPallet)) {
      if (pid === null) continue;
      p[`P${pid}`] = [this.pos(sid), this.heading[pid]];
      if (this.car[pid]) p[this.car[pid]] = [this.pos(sid), 0];
    }
    const y = this.liftLv * H;
    p.lift = [[0, y, 0], 0];
    if (this.liftP) p[`P${this.liftP}`] = [[0, y + 0.1, 0], this.heading[this.liftP]];
    return p;
  }

  check() {
    const missing = this.slotIds.filter((s) => this.slotPallet[s] === null);
    if (this.liftP === null) {
      if (missing.length) throw new Error('电梯上没板，却有车位缺板');
    } else if (!(missing.length === 1 && missing[0] === this.home[this.liftP] && this.car[this.liftP] === null)) {
      throw new Error('电梯上的空板和缺板车位对不上');
    }
  }

  build(ctx) {
    ctx.ground(0, 4, 14, 18);
    ctx.driveway(0, D / 2, DRIVE_DIST + 2);
    const top = (LEVELS + 1) * H;
    for (const x of [-1.5 * W, -0.5 * W, 0.5 * W, 1.5 * W]) {
      for (const z of [-D / 2, D / 2]) ctx.box([x, top / 2, z], [0.14, top, 0.14]);
    }
    for (let lv = 1; lv <= LEVELS + 1; lv++) {
      for (const z of [-D / 2, D / 2]) ctx.box([0, lv * H - 0.05, z], [3 * W, 0.1, 0.1]);
      if (lv <= LEVELS) ctx.text([-1.5 * W - 0.8, lv * H + 0.6, D / 2], `${lv}层`, 13);
    }
    ctx.text([0, 2.0, D / 2 + 1], '出入口', 14);
    for (const [sid, pid] of Object.entries(this.slotPallet)) {
      ctx.pallet(`P${pid}`, this.pos(sid), { tag: sid, heading: this.heading[pid] });
      if (this.car[pid]) ctx.car(this.car[pid], this.pos(sid), carIdx(this.car[pid]));
    }
    ctx.part('lift', [0, this.liftLv * H, 0], [
      ['box', [0, 0, 0], [2.8, 0.06, 5.0], [0.9, 0.6, 0.1]],
      ['cyl', [0, 0.03, 0], [0, 0.04, 0], 1.35, [0.5, 0.5, 0.55]],
      ['label', [0, 0.4, 2.6], '电梯']]);
  }
}
