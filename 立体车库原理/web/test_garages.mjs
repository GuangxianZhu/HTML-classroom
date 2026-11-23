// 每种车库随机存取 1500 次，检查两件事：
// 1. 调度逻辑的不变量（比如升降横移每层空位数）一直成立；
// 2. 把动作原语“无动画地”执行到底，所有物体的最终位置和逻辑算出来的位置一致
//    （能抓住“逻辑说车板到了 A，动画却把它画到了 B”这类错误）。
// 运行：node test_garages.mjs
import { applyStep } from './src/motion.js';
import { ALL } from './src/garages/index.js';
import { totalTime } from './src/garages/base.js';
import { rng } from './src/rng.js';

const close = (p, q) => p.every((a, i) => Math.abs(a - q[i]) < 1e-6);
const isCar = (k) => /^car\d+$/.test(k);

function run(Cls, n = 1500, seed = 0) {
  const rand = rng(seed);
  const g = new Cls();
  let poses = g.poses();
  const times = { park: [], retrieve: [] };
  for (let it = 0; it < n; it++) {
    let steps, kind;
    if (rand() < 0.25) {
      steps = g.autoPark(); kind = 'park';
    } else {
      const sl = g.slots();
      const sid = sl[Math.floor(rand() * sl.length)];
      kind = g.hasCar(sid) ? 'retrieve' : 'park';
      steps = g.request(sid);
    }
    for (const st of steps) {
      for (const a of st.actions) {
        for (const nm of a.names || []) {
          if (!(nm in poses) && !st.actions.some((x) => x.op === 'spawn' && x.name === nm)) {
            throw new Error(`${Cls.title}: 动作里的 ${nm} 不存在`);
          }
        }
      }
      poses = applyStep(poses, st);
    }
    times[kind].push(totalTime(steps));
    g.check();
    const held = g.slots().map((s) => g.carIn(s));
    g.slots().forEach((s, i) => {
      if ((held[i] !== null) !== g.hasCar(s)) throw new Error(`${Cls.title}: carIn 和 hasCar 不一致 ${s}`);
    });
    const want = g.poses();
    const a = held.filter(Boolean).sort().join(), b = Object.keys(want).filter(isCar).sort().join();
    if (a !== b) throw new Error(`${Cls.title}: 车位里的车和场景里的车对不上`);
    const ka = Object.keys(want).sort().join(), kb = Object.keys(poses).sort().join();
    if (ka !== kb) throw new Error(`${Cls.title}: 物体集合不一致\n  逻辑 ${ka}\n  动画 ${kb}`);
    for (const [k, [p, h]] of Object.entries(want)) {
      if (!close(p, poses[k][0])) throw new Error(`${Cls.title}: ${k} 位置 逻辑 ${p} 动画 ${poses[k][0]}`);
      if (!k.startsWith('car') && Math.abs((((h - poses[k][1]) % 360) + 360) % 360) > 1e-6
        && Math.abs((((h - poses[k][1]) % 360) + 360) % 360 - 360) > 1e-6) {
        throw new Error(`${Cls.title}: ${k} 朝向 逻辑 ${h} 动画 ${poses[k][1]}`);
      }
      poses[k] = [p, poses[k][1]];   // 消除浮点累积误差
    }
  }
  return times;
}

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
let fail = 0;
for (const Cls of ALL) {
  try {
    const t = run(Cls);
    console.log(`OK  ${Cls.title.padEnd(22)} 平均存车 ${avg(t.park).toFixed(1).padStart(6)}s  平均取车 ${avg(t.retrieve).toFixed(1).padStart(6)}s`);
  } catch (e) {
    fail++;
    console.log(`NG  ${Cls.title}\n    ${e.message}`);
  }
}
// 车位分配试算不能改动真实状态
for (const Cls of ALL) {
  const g = new Cls();
  const before = JSON.stringify(g.poses()) + g.ascii() + g.carCount;
  g.bestEmptySlot();
  const after = JSON.stringify(g.poses()) + g.ascii() + g.carCount;
  if (before !== after) { fail++; console.log(`NG  ${Cls.title}: 试算改动了状态`); }
}
if (fail) { console.log(`\n${fail} 项不通过`); process.exit(1); }
console.log('\n全部通过');
