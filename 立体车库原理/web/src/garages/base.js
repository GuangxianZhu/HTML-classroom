// 所有车库类型共用的基类和动作构造函数（不依赖 three.js）。
import { stepDuration } from '../motion.js';

export const DRIVE_SPEED = 60;   // 车开进/开出的速度，m/min（约 3.6 km/h）
export const DRIVE_DIST = 9.0;   // 车从车道外开到交接位的距离，m

// 按速度算移动时间（秒）。忽略加减速，是示意值。
export const tOf = (dist, speedMPerMin) => Math.abs(dist) / (speedMPerMin / 60);

export const move = (names, d, t) => ({ op: 'move', names: [...names], d: [...d], t: Math.max(t, 0.05) });
export const turn = (names, deg, t) => ({ op: 'turn', names: [...names], deg, t });
export const loop = (items, path, ds, t) => ({ op: 'loop', items, path, ds, t: Math.max(t, 0.05) });
export const spawn = (name, pos, color, heading = 0) => ({ op: 'spawn', name, pos: [...pos], color, heading, t: 0 });
export const remove = (name) => ({ op: 'remove', name, t: 0 });

export const carIdx = (name) => parseInt(name.slice(3), 10);

// 等宽字体里的显示宽度：汉字等全角字符算 2，英文数字算 1
export const textWidth = (s) => [...s].reduce((n, ch) => n + (/[\u2e80-\uffef]/.test(ch) ? 2 : 1), 0);
// 居中补空格到显示宽度 w
export function padc(s, w) {
  const g = Math.max(0, w - textWidth(s));
  return ' '.repeat(g >> 1) + s + ' '.repeat(g - (g >> 1));
}

// 收集步骤。调用 add 前先改好状态，这样记下的状态图就是“这一步做完之后”的样子。
export class Steps extends Array {
  static get [Symbol.species]() { return Array; }
  constructor(garage) { super(); this.g = garage; }
  add(text, ...actions) {
    this.push({ text, actions: actions.filter(Boolean), state: this.g.ascii() });
  }
}

export const totalTime = (steps) => steps.reduce((s, st) => s + stepDuration(st), 0);

export class Garage {
  constructor() {
    this.carCount = 0;
    this.reset();
  }

  // ---- 子类必须实现 ----
  reset() { throw new Error('reset'); }
  slots() { throw new Error('slots'); }          // 所有车位的编号（按钮顺序）
  hasCar(sid) { throw new Error('hasCar'); }
  carIn(sid) { throw new Error('carIn'); }       // 这个车位上停的是哪辆车（名字），没车返回 null
  park(sid, steps) { throw new Error('park'); }
  retrieve(sid, steps) { throw new Error('retrieve'); }
  ascii() { throw new Error('ascii'); }
  poses() { throw new Error('poses'); }          // {名字: [[x,y,z], 朝向]}，自检用来核对动画
  build(ctx) { throw new Error('build'); }       // 用 ctx 提供的函数搭出 3D 场景
  check() {}                                     // 不变量检查，出错时抛异常

  // ---- 通用 ----
  slotLabel(sid) { return String(sid); }
  slotShort(sid) { return String(sid); }

  newCar() {
    this.carCount += 1;
    return [`car${this.carCount}`, this.carCount];
  }

  // 深拷贝：试算“如果存到这里要多久”时用，不影响真实状态
  clone() {
    const g = Object.create(Object.getPrototypeOf(this));
    for (const k of Object.keys(this)) g[k] = structuredClone(this[k]);
    return g;
  }

  request(sid) {
    const steps = new Steps(this);
    if (this.hasCar(sid)) {
      steps.add(`任务：取 ${this.slotLabel(sid)} 的车。`);
      this.retrieve(sid, steps);
    } else {
      steps.add(`任务：把一辆车存到 ${this.slotLabel(sid)}。`);
      this.park(sid, steps);
    }
    steps.add('完成。');
    return [...steps];
  }

  bestEmptySlot() {
    const empty = this.slots().filter((s) => !this.hasCar(s));
    if (!empty.length) return null;
    let best = null, bt = Infinity;
    for (const s of empty) {
      const t = totalTime(this.clone().request(s));
      if (t < bt) { bt = t; best = s; }
    }
    return best;
  }

  autoPark() {
    const best = this.bestEmptySlot();
    if (best === null) return [{ text: '车库已满，没有空车位。', actions: [], state: this.ascii() }];
    const steps = this.request(best);
    steps[0].text = `自动选位：把每个空车位都试算一遍，${this.slotLabel(best)} 的模拟耗时最短，`
      + '就存到那里。（这就是最简单的“车位分配策略”）';
    return steps;
  }
}
