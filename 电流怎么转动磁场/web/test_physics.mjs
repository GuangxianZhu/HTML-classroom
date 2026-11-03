// 方向自检：node test_physics.mjs
import assert from 'node:assert';
import * as P from './src/physics.js';
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, `${a} != ${b}`);
const ang = (v) => Math.atan2(v[1], v[0]);

// 1. 电流朝你：磁力线逆时针。导线右边的磁场向上
let b = P.wireField(1, 0, 0, 0, 1, 0);
assert(b[1] > 0 && Math.abs(b[0]) < 1e-9, '⊙ 右侧向上');
b = P.wireField(0, 1, 0, 0, 1, 0);
assert(b[0] < 0, '⊙ 上方向左，逆时针');
b = P.wireField(1, 0, 0, 0, -1, 0);
assert(b[1] < 0, '⊗ 反向');

// 2. 线圈：I > 0 时内部向右，右端磁场朝外，左端磁场朝里，所以右端是 N
const W = P.coilWires(8, 1, .4);
const c = P.coilField(0, 0, W, 1, 1e-4);
assert(c[0] > 0 && Math.abs(c[1]) < 1e-6, '线圈内部向右');
const r = P.coilField(2, 0, W, 1, 1e-4), l = P.coilField(-2, 0, W, 1, 1e-4);
assert(r[0] > 0, '右端朝外 = N');
assert(l[0] > 0, '左端朝里 = S');
const cr = P.coilField(0, 0, W, -1, 1e-4);
assert(cr[0] < 0, '电流反向，内部磁场反向');
near(cr[0], -c[0]);

// 3. 瓶盖法则和“逆时针 = N”互相一致：
//    站在右端往回看，屏幕外（+z）在你的左手边。上排电流朝 +z，所以上面向左走，下面向右走：逆时针。
//    而右端确实是 N（上一条），和 faceOf('ccw') = 'N' 对得上。
assert.equal(P.faceOf('ccw'), 'N');
assert.equal(P.faceOf('cw'), 'S');

// 4. 条形磁铁：N 在右时，外部磁场从 N 出发。右端外面朝右；磁铁正上方朝左（从 N 回到 S）
const bar = P.barField(2, 0, .5, 1);
assert(bar[0] > 0, 'N 外侧朝外');
const top = P.barField(0, 1, .5, 1);
assert(top[0] < 0, '中间上方从 N 指回 S');
assert(P.barField(2, 0, .5, -1)[0] < 0, '调头后反向');

// 5. 两组线圈合成
near(P.combine2(1, 1).angle, Math.PI / 4);
near(P.combine2(-1, 0).angle, Math.PI);

// 6. 三相：任何角度合成幅值都是 1.5 倍，方向正好等于目标角；三相电流之和为零
for (let th = -3; th < 3; th += .37) {
  const i = P.threePhase(th, 1), s = P.combine3(...i);
  near(s.size, 1.5, 1e-9); near(P.wrap(s.angle - th), 0, 1e-9); near(i[0] + i[1] + i[2], 0, 1e-9);
}

// 7. 转子会转到和磁场对齐；正好反向时是死点，力为零
let s = { th: 1, w: 0 };
for (let i = 0; i < 4000; i++) s = P.rotorStep(s, .005, { fieldAngle: -.5, strength: 8, J: 1, damp: 3 });
near(P.wrap(s.th + .5), 0, 1e-3);
const dead = P.rotorStep({ th: Math.PI, w: 0 }, .01, { fieldAngle: 0, strength: 8 });
assert(Math.abs(dead.pull) < 1e-9, '死点没有力');

// 8. 开环：慢慢升速能跟上；一下跳到高速会失步
const open = (fn, T = 14) => {
  let d = { th: 0, w: 0, f: 0 }; const dt = .002;
  for (let t = 0; t < T; t += dt) d = P.dogStep(d, dt, { mode: 'open', fieldSpeed: fn(t), current: 1, load: .1 });
  return d;
};
const slow = open((t) => Math.min(t * .9, 1.5 * P.TAU));
console.log('慢升速：转子', (slow.w / P.TAU).toFixed(2), '转/秒，设定 1.50');
near(slow.w / P.TAU, 1.5, .05);
const jump = open(() => 1.5 * P.TAU);
console.log('跳变：转子', (jump.w / P.TAU).toFixed(2), '转/秒，设定 1.50');
assert(Math.abs(jump.w / P.TAU - 1.5) > .5, '跳到高速应当失步');

// 9. 闭环：速度由拉力和负载决定，负载变大速度下降，不会失步
const closed = (current, load) => {
  let d = { th: 0, w: 0, f: 0 };
  for (let t = 0; t < 20; t += .002) d = P.dogStep(d, .002, { mode: 'closed', current, load });
  return d.w / P.TAU;
};
const a = closed(1, .2), bb = closed(1, .6);
console.log('闭环 负载 .2 / .6：', a.toFixed(2), bb.toFixed(2), '转/秒');
assert(bb < a && a > 0, '闭环');
near(closed(.5, .6), 0, 1e-6);   // 拉力不够，转不起来

// 10. H 桥
assert.equal(P.hBridge({ s1: 1, s4: 1 }), 1);
assert.equal(P.hBridge({ s2: 1, s3: 1 }), -1);
assert.equal(P.hBridge({ s1: 1, s3: 1 }), 'short');
assert.equal(P.hBridge({ s1: 1 }), 0);

// 11. PWM：电流平均值接近占空比
for (const d of [.2, .5, .8]) {
  const t = P.pwmTrace(d, 1, 3, 40, 4000), avg = t.i.slice(2000).reduce((x, y) => x + y, 0) / 2000;
  near(avg, d, .02);
}
console.log('全部通过');
