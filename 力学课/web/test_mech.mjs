// 自检：node test_mech.mjs
// 1) 课程表前后接得上；2) 文案和猜题里写死的数字；3) 每课的练习题跑几百遍：选项不重复、答案在里面、数值对得上。
import fs from 'fs';
import * as M from './src/mech.js';
import { LESSONS, known } from './src/course.js';
import { GEN } from './src/problems.js';

let pass = 0, fail = 0;
const ok = (name, c, d = '') => { if (c) pass++; else fail++; console.log(`${c ? '  ok ' : 'FAIL '} ${name}${d ? '  ' + d : ''}`); };
const near = (name, x, want, tol) => ok(name, Math.abs(x - want) <= tol, `${(+x).toFixed(3)}（文案写 ${want}）`);

console.log('— 课程表');
ok('27 课，编号 1～27 连续', LESSONS.length === 27 && LESSONS.every((l, i) => l.n === i + 1));
const ready = LESSONS.filter((l) => l.ready);
ok('做好的课是从第 1 课开始连续的', ready.every((l, i) => l.n === i + 1));
ok('做好的课都有“学会的一句话”，下一课开头要用', ready.every((l) => l.got && l.got.length > 10));
ok('每课都有“这一课回答的问题”', LESSONS.every((l) => l.ask && l.ask.length > 5));
for (const l of ready) ok(`第 ${l.n} 课的页面和脚本都在`, fs.existsSync(`src/lessons/${String(l.n).padStart(2, '0')}.html`) && fs.existsSync(`src/lessons/${String(l.n).padStart(2, '0')}.js`));
ok('第 5 课学完认识 x、v、a 三个量', [...known(5)].sort().join() === 'a,v,x');

console.log('— 文案里的数字');
const T1 = M.tripTime(M.TRIP1), end = M.trip(M.TRIP1, T1);
ok('第 1 课：最远开到 40 m', Math.abs(M.trip(M.TRIP1, 4).x - 40) < 1e-9);
ok('第 1 课：停在便利店门口（30 m），位移 30 m、路程 50 m', end.x === M.STORE && end.x === 30 && end.path === 50);
near('第 1 课：半径 40 m 的一圈约 251 m', 2 * Math.PI * 40, 251, 0.5);
near('第 2 课：整趟平均速度约 4.3 m/s', end.x / T1, 4.3, 0.05);
near('第 2 课：整趟平均速率约 7.1 m/s', end.path / T1, 7.1, 0.05);
ok('第 2 课：Δt 缩到 0.003 s，连线斜率和速度表差不到 0.01 m/s', Math.abs(M.avgV((t) => M.accelX(2.5, t), 4, 0.003) - 2.5 * 4) < 0.01);
near('第 2 课：100 km/h 每秒约 5.8 个车身', 100 / 3.6 / M.CAR.len, 5.8, 0.05);
near('第 3 课：0→100 用 11 s，平均约 2.5 m/s²', 100 / 3.6 / 11, 2.5, 0.03);
near('第 3 课：2.5 m/s² 每秒涨 9 km/h', 2.5 * 3.6, 9, 1e-9);
near('第 4 课：60 km/h 开 30 s 约 500 m', 60 / 3.6 * 30, 500, 1);
near('第 4 课：0→100 用 11.1 s、2.5 m/s²，约 154 m', M.xAt(0, 2.5, 11.1), 154, 0.5);
ok('第 4 课：切成 80 条，差距 1% 左右', (() => { const VF = (t) => 40 * (1 - Math.exp(-t / 12)), ex = 40 * (16 - 12 * (1 - Math.exp(-16 / 12))); const r = Math.abs(ex - M.strips(VF, 0, 16, 80)) / ex; return r > 0.005 && r < 0.015; })());
ok('第 5 课：车速翻倍，刹车距离 4 倍', Math.abs(M.stopping(30, 0, 7).db / M.stopping(15, 0, 7).db - 4) < 1e-9);
near('第 5 课：60 km/h、0.8 s 反应约 13 m', M.stopping(60 / 3.6, 0.8, 7).dr, 13, 0.4);
ok('第 5 课：v² − v₀² = 2ax 和前两个公式一致', Math.abs(M.xByV(20, 8, -3) - M.xAt(20, -3, 4)) < 1e-9);
near('第 5 课：20 m/s、5 m/s²，6 s 内实际 40 m', M.brakeDist(20, 5, 6), 40, 1e-9);
near('第 5 课：硬代公式得 30 m', M.xAt(20, -5, 6), 30, 1e-9);
ok('第 5 课：干路 60 km/h、0.8 s 能在 45 m 内停住；120 km/h 停不住', M.stopping(60 / 3.6, 0.8, M.ROAD.dry).d < 45 && M.stopping(120 / 3.6, 0.8, M.ROAD.dry).d > 45);

console.log('— 练习题（每个出题函数跑 400 遍）');
for (const l of ready) {
  const gens = GEN[l.n];
  ok(`第 ${l.n} 课有 5 个出题函数`, gens?.length === 5);
  gens.forEach((gen, k) => {
    let bad = '';
    for (let s = 1; s <= 400 && !bad; s++) {
      const q = gen(M.rng(s * 7919 + k));
      if (!q.q || q.opts.length !== 4) bad = `选项不是 4 个（种子 ${s}）：${JSON.stringify(q.opts)}`;
      else if (new Set(q.opts).size !== 4) bad = `选项有重复（种子 ${s}）：${q.opts.join(' | ')}`;
      else if (!(q.ans >= 0 && q.ans < 4)) bad = '答案下标不对';
      else if (!q.why || /NaN|undefined|Infinity/.test(q.q + q.opts.join('') + q.why)) bad = `有 NaN / undefined（种子 ${s}）：${q.q} ${q.opts.join('|')}`;
      else if (typeof q.val === 'number') {
        const m = q.opts[q.ans].replace('−', '-').match(/^-?\d+(\.(\d+))?/);
        const tol = m ? 0.5 * 10 ** -(m[2] ? m[2].length : 0) + 1e-9 : 0;
        if (m && Math.abs(parseFloat(m[0]) - q.val) > tol) bad = `正确选项 ${q.opts[q.ans]} 和数值 ${q.val} 对不上（种子 ${s}）`;
      }
    }
    ok(`第 ${l.n} 课第 ${k + 1} 题`, !bad, bad);
  });
}
console.log(`\n${pass} 项通过，${fail} 项失败`);
process.exit(fail ? 1 : 0);
