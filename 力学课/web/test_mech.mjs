// 自检：node test_mech.mjs
// 1) 课程表前后接得上；2) 文案和猜题里写死的数字；3) 每课的练习题跑几百遍：选项不重复、答案在里面、数值对得上。
import fs from 'fs';
import * as M from './src/mech.js';
import { LESSONS, known, KIDS, BOOKS } from './src/course.js';
import { BGEN } from './src/books/problems.js';
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
ok('启蒙篇 36 小课，编号连续', KIDS.length === 36 && KIDS.every((k, i) => k.n === i + 1));
ok('每小课都有问题、一句话、对应的高中课', KIDS.every((k) => k.ask && k.got && LESSONS.some((l) => l.n === k.back)));
ok('每小课最多 2 个新词', KIDS.every((k) => (k.words || []).length <= 2));
const kready = KIDS.filter((k) => k.ready);
for (const k of kready) ok(`启 ${k.n} 的页面和脚本都在`, ['html', 'js'].every((e) => fs.existsSync(`src/kids/k${String(k.n).padStart(2, '0')}.${e}`)));

console.log('— 启蒙篇：页面上的字（读者只有小学数学）');
// 孩子在页面上看得到的字：正文（去掉标签）+ 脚本里带中文的字符串 + 课表里显示的那几栏。“以后课本上会这样写”那一栏不算。
const strip = (h) => h.replace(/<details class="later">[\s\S]*?<\/details>/g, '').replace(/<[^>]+>/g, '\n').replace(/&[a-z]+;/g, ' ');
const jsText = (src) => [...src.matchAll(/(['`])((?:\\.|(?!\1)[^\\])*?)\1/g)].map((m) => m[2]).filter((x) => /[一-鿿]/.test(x) && !/=>| \? |\.join\(|\?\./.test(x)).map((x) => strip(x.replace(/\$\{[^}]*\}/g, '8'))).join('\n');
const common = jsText(fs.readFileSync('src/kid.js', 'utf8'));
const TERMS = { 位置时间图: /位置-时间图/, 速度时间图: /速度-时间图/, 速度: /(?<!加)速度(?!表|-时间图)/, 加速度: /加速度/, 位移: /位移/, 路程: /路程/, 刹车距离: /刹车距离/, 反应距离: /反应距离/, 质量: /质量/, 合力: /合力/, 重力: /重力/, 摩擦力: /摩擦力/, 动能: /动能/, 能量: /能量/, 功率: /功率/, 动量: /动量/ };
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
ok('启 11：每秒涨 2 开 4 秒，1 + 3 + 5 + 7 = 16 = 4 × 8 ÷ 2；8 秒是 64，4 倍', 1 + 3 + 5 + 7 === 16 && 4 * 8 / 2 === 16 && 8 * 16 / 2 === 64);
ok('启 12：每秒掉 5，车速 10 / 20 / 30 的刹车距离是 10 / 40 / 90 米', [10, 20, 30].every((v) => v * (v / 5) / 2 === v * v / 10) && 10 * 10 / 10 === 10 && 20 * 20 / 10 === 40 && 30 * 30 / 10 === 90);
ok('启 12：湿路每秒 20 米正好 60 米停住，每秒 25 米停不住', 20 + 20 * 4 / 2 === 60 && 25 + 25 * 5 / 2 > 60);
ok('启 14：每秒 10 米松油门，每秒掉 5 / 2 / 0.5，滑 10 / 25 / 100 米', [5, 2, 0.5].every((d, i) => 10 * (10 / d) / 2 === [10, 25, 100][i]));
ok('启 20：重力 10000 牛，走 10 米升高 3 米往下拉 3000 牛；冰面（抓 1000 牛）最陡是升高 1 米', 10000 * 3 / 10 === 3000 && 10000 * 1 / 10 <= 1000 && 10000 * 2 / 10 > 1000);
ok('启 13：每秒涨 10，3 秒掉 45 米；每秒 20 米往上扔 2 秒到顶', 3 * 30 / 2 === 45 && 20 / 10 === 2 && [1, 2, 3, 4].every((t) => t * 10 * t / 2 === 5 * t * t));
ok('启 15：同样的力推 20 / 40 / 80 千克，每秒涨 4 / 2 / 1；80 千克要 4 个人才每秒涨 4', [20, 40, 80].every((m, i) => 80 / m === [4, 2, 1][i]) && 4 * 80 / 80 === 4);
ok('启 16：2 千克每秒涨 3 要 6 牛；1000 千克 5 秒到每秒 20 米要 4000 牛；急刹每秒掉 5 要 5000 牛', 2 * 3 === 6 && 1000 * (20 / 5) === 4000 && 1000 * 5 === 5000 && 3000 / 6000 === 0.5);
ok('启 17：推 3000 拖 1000 每秒涨 2；推 4000 拖 2000 也是；推多少最后拖多少（500 / 1000 / 2000 / 3500 稳在每秒 10 / 20 / 30 / 40 米）', (3000 - 1000) / 1000 === 2 && (4000 - 2000) / 1000 === 2);
ok('启 18：每千克 10 牛，1 / 2 / 5 / 10 千克重 10 / 20 / 50 / 100 牛；重力 ÷ 质量总是 10；月球上 1200 牛的人是 200 牛', [1, 2, 5, 10].every((m) => m * 10 / m === 10) && 1200 / 6 === 200);
ok('启 19：干 / 湿 / 冰最多抓 8000 / 4000 / 1000 牛，1000 千克每秒最多涨（掉）8 / 4 / 1；冰面刹车距离是干路 8 倍', [8000, 4000, 1000].every((f, i) => f / 1000 === [8, 4, 1][i]) && (20 * 20 / 1 / 2) / (20 * (20 / 8) / 2) === 8);
ok('启 21：120 牛推 1 秒，30 千克每秒 4 米、60 千克每秒 2 米；两车各 1000 千克每秒涨 2，地面推 4000、绳子 2000', 120 / 30 === 4 && 120 / 60 === 2 && 4000 / 2000 === 2 && 1000 * 2 === 2000 && (4000 - 2000) / 1000 === 2);
ok('启 22：50 千克每秒涨 2，秤 600 / 500 / 400 牛；往下每秒涨 10 秤是 0；一趟 7 秒走 20 米', 500 + 50 * 2 === 600 && 500 - 50 * 2 === 400 && 500 - 50 * 10 === 0 && 2 * 2 * 2 / 2 + 4 * 3 + 4 * 2 / 2 === 20);
ok('启 23：45 米高 3 秒落地，横着每秒 5 / 10 / 15 米落在 15 / 30 / 45 米；每秒 20 米的无人机要提前 60 米', 5 * 3 * 3 === 45 && [5, 10, 15].every((v) => v * 3 === v * 3) && 20 * 3 === 60);
ok('启 25：1000 千克过半径 100 米的弯，每秒 10 / 20 / 30 米要 1000 / 4000 / 9000 牛；半径 50 米每秒 20 米要 8000 牛，每秒 25 米过不去', [10, 20, 30].every((v, i) => 1000 * v * v / 100 === [1000, 4000, 9000][i]) && 1000 * 20 * 20 / 50 === 8000 && 1000 * 25 * 25 / 50 > 8000 && 1000 * 28 * 28 / 100 < 8000);
ok('启 26：每秒 8 千米飞 1 秒，地面大约弯下去 5 米（地球半径 6400 千米）；绕 40000 千米要 5000 秒', Math.abs(8000 * 8000 / (2 * 6400000) - 5) < 0.1 && 40000 / 8 === 5000);
ok('启 27：100 千克雪橇，力 × 距离 = 800 时推完是每秒 4 米；500 牛抬 1 米和 50 牛推 10 米都是 500 焦', [[100, 8], [200, 4], [400, 2]].every(([F, d]) => Math.abs(Math.sqrt(2 * F * d / 100) - 4) < 1e-9) && 500 * 1 === 50 * 10);
ok('启 28：1000 千克车每秒 10 / 20 / 30 米的动能是 5 万 / 20 万 / 45 万焦；2000 牛要推 25 / 100 / 225 米；5000 牛刹车 10 / 40 / 90 米', [10, 20, 30].every((v, i) => 1000 * v * v / 2 === [50000, 200000, 450000][i] && 1000 * v * v / 2 / 2000 === [25, 100, 225][i] && 1000 * v * v / 2 / 5000 === [10, 40, 90][i]));
ok('启 29：1000 千克从 5 / 20 / 45 米高下来，重力做功 5 万 / 20 万 / 45 万焦，到底是每秒 10 / 20 / 30 米', [[5, 10], [20, 20], [45, 30], [80, 40]].every(([h, v]) => 10000 * h === 1000 * v * v / 2));
ok('启 30：坡上有摩擦的三档账目对得上', [[0, 20], [72000, 16], [150000, 10]].every(([q, v]) => 200000 - q === 1000 * v * v / 2));
ok('启 31：到每秒 10 / 20 / 30 米是第 1 / 4 / 9 秒，推力表对得上', [[10, 1], [20, 4], [30, 9]].every(([v, t]) => 500 * v * v === 50000 * t) && [[5, 10000], [10, 5000], [25, 2000], [50, 1000]].every(([v, f]) => v * f === 50000));
ok('启 32：三次追尾和三次迎面撞，动量前后相等', [[1000, 10], [3000, 5], [9000, 2]].every(([m, v]) => (1000 + m) * v === 20000) && [[10, 5], [20, 0], [30, 5]].every(([u, v]) => Math.abs(20000 - 1000 * u) === 2000 * v));
ok('启 33：四种停法，力 × 时间都是 500', [[100, 5], [500, 1], [5000, 0.1], [50000, 0.01]].every(([f, t]) => Math.abs(f * t - 500) < 1e-9));
ok('启 34：一步 5 秒是 40、20、10、5；一步 1 秒、0.1 秒时第 5 秒是 23.6、24.2', (() => { const f = (h) => { let v = 40; for (let i = 0; i < Math.round(5 / h); i++) v -= v * 100 / 1000 * h; return Math.round(v * 10) / 10; }; return f(5) === 20 && f(1) === 23.6 && f(0.1) === 24.2 && Math.abs(40 * Math.exp(-0.5) - 24.3) < 0.05; })());
ok('启 35：推力和风的力在每秒 50 米碰头；改车以后是 63、63、79', [[10, 5000, 40], [20, 2500, 160], [25, 2000, 250], [40, 1250, 640], [50, 1000, 1000]].every(([v, a, b]) => 50000 / v === a && 0.4 * v * v === b) && [[1e5, 0.4, 63], [5e4, 0.2, 63], [1e5, 0.2, 79]].every(([P, c, v]) => Math.round(Math.cbrt(P / c)) === v));
ok('启 36：三种减震器的晃法对得上表里的说法', (() => { const peak = (z, t1) => { let y = -6, v = 0, m = 0; const w = 2 * Math.PI, h = 0.001; for (let t = 0; t < 9; t += h) { v += (-w * w * y - 2 * z * w * v) * h; y += v * h; if (t > t1) m = Math.max(m, Math.abs(y)); } return m; }; return peak(0, 8) > 5.5 && peak(0.08, 3) > 1 && peak(0.08, 8) < 0.3 && peak(0.35, 1.5) < 0.3; })());

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

console.log('— 课本对照页');
ok('高中第 1～5 课都有“小课里说 → 课本上写”的表，第一段每一小课都对得上其中一课', LESSONS.filter((l) => l.n <= 5).every((l) => l.map?.length >= 3) && KIDS.filter((k) => (k.seg || 1) === 1).every((k) => LESSONS.find((l) => l.n === k.back)?.map));
ok('启蒙第二到四段，做好的小课都有课本对照页可去（第五段选做，指到第四段那页）', kready.filter((k) => (k.seg || 1) > 1 && k.seg < 5).every((k) => BOOKS.some((b) => b.seg === k.seg)), '');
for (const b of BOOKS.filter((x) => x.ready)) {
  ok(`对照页 ${b.seg}：页面和脚本都在`, ['html', 'js'].every((e) => fs.existsSync(`src/books/t${b.seg}.${e}`)));
  const html = fs.readFileSync(`src/books/t${b.seg}.html`, 'utf8'), cards = [...html.matchAll(/data-k="(\d+)"/g)].map((m) => +m[1]);
  const want = KIDS.filter((k) => k.seg === b.seg).map((k) => k.n);
  ok(`对照页 ${b.seg}：这一段的每一小课都有一张卡片`, want.every((n) => cards.includes(n)), want.filter((n) => !cards.includes(n)).join(' '));
  const gens = BGEN[b.seg];
  ok(`对照页 ${b.seg} 有 5 个出题函数`, gens?.length === 5);
  (gens || []).forEach((gen, j) => {
    let bad = '';
    for (let s = 1; s <= 400 && !bad; s++) {
      const q = gen(M.rng(s * 7919 + j));
      if (!q.q || q.opts.length !== 4 || new Set(q.opts).size !== 4) bad = `选项不是 4 个不同的（种子 ${s}）：${q.opts.join(' | ')}`;
      else if (!(q.ans >= 0 && q.ans < 4) || !q.why || /NaN|undefined|Infinity/.test(q.q + q.opts.join('') + q.why)) bad = `答案或讲解有问题（种子 ${s}）`;
      else if (typeof q.val === 'number') { const m = q.opts[q.ans].match(/\d+(\.\d+)?/); if (!m || Math.abs(+m[0] - q.val) > 1e-9) bad = `正确选项 ${q.opts[q.ans]} 和 ${q.val} 对不上`; }
    }
    ok(`对照页 ${b.seg} 第 ${j + 1} 题`, !bad, bad);
  });
}
console.log(`\n${pass} 项通过，${fail} 项失败`);
process.exit(fail ? 1 : 0);
