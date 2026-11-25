// 自检：node test_mech.mjs
// 1) 课程表前后接得上；2) 文案和猜题里写死的数字；3) 每课的练习题跑几百遍：选项不重复、答案在里面、数值对得上。
import fs from 'fs';
import * as M from './src/mech.js';
import { LESSONS, known, KIDS } from './src/course.js';
import { KGEN } from './src/kids/problems.js';
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

console.log('— 启蒙篇：课表');
ok('启蒙篇 12 小课，编号连续', KIDS.length === 12 && KIDS.every((k, i) => k.n === i + 1));
ok('每小课都有问题、一句话、对应的高中课', KIDS.every((k) => k.ask && k.got && LESSONS.some((l) => l.n === k.back)));
ok('每小课最多 2 个新词', KIDS.every((k) => (k.words || []).length <= 2));
const kready = KIDS.filter((k) => k.ready);
for (const k of kready) ok(`启 ${k.n} 的页面和脚本都在`, ['html', 'js'].every((e) => fs.existsSync(`src/kids/k${String(k.n).padStart(2, '0')}.${e}`)));

console.log('— 启蒙篇：页面上的字（读者只有小学数学）');
// 孩子在页面上看得到的字：正文（去掉标签）+ 脚本里带中文的字符串 + 课表里显示的那几栏。“以后课本上会这样写”那一栏不算。
const strip = (h) => h.replace(/<details class="later">[\s\S]*?<\/details>/g, '').replace(/<[^>]+>/g, '\n').replace(/&[a-z]+;/g, ' ');
const jsText = (src) => [...src.matchAll(/(['`])((?:\\.|(?!\1)[^\\])*?)\1/g)].map((m) => m[2]).filter((x) => /[一-鿿]/.test(x) && !/=>| \? |\.join\(|\?\./.test(x)).map((x) => strip(x.replace(/\$\{[^}]*\}/g, '8'))).join('\n');
const common = jsText(fs.readFileSync('src/kid.js', 'utf8'));
const TERMS = { 位置时间图: /位置-时间图/, 速度时间图: /速度-时间图/, 速度: /(?<!加)速度(?!表|-时间图)/, 加速度: /加速度/, 位移: /位移/, 路程: /路程/, 刹车距离: /刹车距离/, 反应距离: /反应距离/ };
const named = (n) => new Set(KIDS.filter((k) => k.n <= n).flatMap((k) => k.words || []).map((w) => w.replace('-', '')));
for (const k of kready) {
  const id = String(k.n).padStart(2, '0');
  const html = fs.readFileSync(`src/kids/k${id}.html`, 'utf8'), js = fs.readFileSync(`src/kids/k${id}.js`, 'utf8');
  const prev = KIDS.find((x) => x.n === k.n - 1), next = KIDS.find((x) => x.n === k.n + 1);
  const body = strip(html), shown = [body, jsText(js), common, k.title, k.ask, k.got, prev?.got, prev?.title, next?.ask, next?.title].filter(Boolean).join('\n');
  const bad = shown.match(/[A-Za-z]+|Δ|斜率|切线|₀|²|匀加速|坐标|横轴|纵轴/g)?.filter((w) => !/^(px|py)$/.test(w));
  ok(`启 ${k.n}：没有字母和高中记号`, !bad?.length, bad ? [...new Set(bad)].join(' ') : '');
  const used = Object.entries(TERMS).filter(([, re]) => re.test(shown.replace(new RegExp(`${prev?.got ?? '\\0'}`), ''))).map(([w]) => w);
  const miss = used.filter((w) => !named(k.n).has(w));
  ok(`启 ${k.n}：用到的词都起过名字（${used.join('、') || '无'}）`, !miss.length, miss.join('、'));
  const sents = (body + '\n' + jsText(js)).split(/[。！？；\n]/).map((x) => x.replace(/\s/g, '')).filter((x) => x.length);
  const long = sents.filter((x) => x.length > 30);
  ok(`启 ${k.n}：每句不超过 30 个字`, !long.length, long.slice(0, 3).join(' | '));
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => strip(m[1]).split(/[。！？]/).filter((x) => x.trim()).length);
  ok(`启 ${k.n}：每段不超过 3 句`, paras.every((c) => c <= 3), `最多 ${Math.max(...paras)} 句`);
}
ok('启 4：示范那趟拍 8 张（第 0～7 秒）', M.tripTime(M.TRIP1) === 7);
ok('启 6：前 3 秒紫车在前面，第 4 秒并排，第 5 秒红车在前', [1, 2, 3].every((t) => 20 + 10 * t > 15 * t) && 20 + 10 * 4 === 15 * 4 && 15 * 5 > 20 + 50);
ok('启 6：3 秒红车走 45 米、紫车走 30 米', 15 * 3 === 45 && 10 * 3 === 30);
ok('启 6：滑块默认值不是答案（第 4 秒追上，不是第 3 秒）', 20 / (15 - 10) === 4);
ok('启 7：36 千米每小时是每秒 10 米，表上的数 = 每秒几米 × 3.6', 36000 / 3600 === 10 && [18, 36, 72, 108].every((v, i) => v * 5 / 18 === [5, 10, 20, 30][i]));
ok('启 9：三种踩法 5 秒后是每秒 5、10、15 米；每秒 20 米轻刹 4 秒停、急刹 2 秒停', [1, 2, 3].every((x) => x * 5 === [5, 10, 15][x - 1]) && 20 / 5 === 4 && 20 / 10 === 2);

console.log('— 启蒙篇：练习题（每个跑 400 遍，数字要能口算）');
for (const k of kready) {
  const gens = KGEN[k.n];
  ok(`启 ${k.n} 有 4 个出题函数`, gens?.length === 4);
  gens.forEach((gen, j) => {
    let bad = '';
    for (let s = 1; s <= 400 && !bad; s++) {
      const q = gen(M.rng(s * 104729 + j)), all = q.q + q.opts.join('|') + q.why;
      if (q.opts.length !== 4 || new Set(q.opts).size !== 4) bad = `选项不是 4 个不重复的（种子 ${s}）：${q.opts.join(' | ')}`;
      else if (!(q.ans >= 0 && q.ans < 4)) bad = '答案下标不对';
      else if (/NaN|undefined|Infinity/.test(all)) bad = `有 NaN（种子 ${s}）`;
      else if (/[A-Za-z]/.test(all)) bad = `有字母（种子 ${s}）：${all.match(/[A-Za-z]+/)[0]}`;
      else if (!q.neg && /[−-]\s?\d/.test(q.q + q.opts.join('|')) && !/\d\s[−-]\s\d/.test(q.q)) bad = `有负数（种子 ${s}）`;
      else if ((q.q + q.opts.join('|')).match(/\d+(\.\d+)?/g)?.some((x) => /\.\d\d/.test(x))) bad = `数字超过一位小数（种子 ${s}）`;
      else if (typeof q.val === 'number') { const m = q.opts[q.ans].match(/\d+(\.\d+)?/); if (!m || Math.abs(+m[0] - q.val) > 1e-9) bad = `正确选项 ${q.opts[q.ans]} 和 ${q.val} 对不上`; }
    }
    ok(`启 ${k.n} 第 ${j + 1} 题`, !bad, bad);
  });
}
console.log(`\n${pass} 项通过，${fail} 项失败`);
process.exit(fail ? 1 : 0);
