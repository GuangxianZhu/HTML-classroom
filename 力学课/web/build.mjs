// 打包：node build.mjs
// 产出 ../index.html（总目录）和 ../lessons/NN.html（每课一个离线单文件）。课程表在 src/course.js。
import { build } from 'esbuild';
import fs from 'fs';
import { LESSONS, PARTS, QUANTS, KIDS, KID_PART, KID_SEGS, BOOKS, lessonFile, kidFile, bookFile } from './src/course.js';

const css = fs.readFileSync('src/style.css', 'utf8');
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;700;900&display=swap">';
const bundle = async (entry) => {
  const out = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020', legalComments: 'none' });
  return out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
};
const doc = (title, body, js) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
${FONTS}
<style>${css}</style></head>
<body>${body}
<script>${js}</script>
</body></html>
`;

// 高中第 1～5 课现在是启蒙第一段的课本对照：开头先放一张“小课里说 → 课本上写”的表，和对应小课的链接
const bridge = (L) => {
  const ks = KIDS.filter((k) => (k.seg || 1) === 1 && k.back === L.n);
  return `<section class="bridge">
    <span class="tag">课本对照 · 启蒙第一段</span>
    <p>这一页讲的事，启蒙小课里都玩过了：${ks.map((k) => `<a href="${kidFile(k.n)}">启 ${k.n} ${k.title}</a>`).join('、')}。这里换成课本的字母和公式，再走一遍。还没玩过的话，先去玩小课。</p>
    <div class="tbwrap"><table class="tb"><tr><th>小课里说</th><th>课本上写</th></tr>${L.map.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table></div>
  </section>`;
};

fs.mkdirSync('../lessons', { recursive: true });
let n = 0;
for (const L of LESSONS.filter((l) => l.ready)) {
  const id = String(L.n).padStart(2, '0');
  if (!fs.existsSync(`src/lessons/${id}.html`)) { console.warn(`第 ${L.n} 课标了 ready，但 src/lessons/${id}.html 还没有`); process.exitCode = 1; continue; }
  const inner = fs.readFileSync(`src/lessons/${id}.html`, 'utf8');
  const body = `<div class="wrap">
  <nav class="top" id="top" aria-label="课程导航"></nav>
  <header class="hero">
    <div class="eyebrow">${L.map ? `课本对照 ${L.n} · 启蒙第一段` : `第 ${L.n} 课`}</div>
    <h1>${L.title}</h1>
    <div class="hero-grid"><div class="recap" id="recap"></div><div class="ask"><span class="tag">这一课回答</span><p id="ask"></p></div></div>
    <ul class="quants" id="quants" aria-label="到这一课为止认识的量"></ul>
  </header>
${L.map ? bridge(L) : ''}
${inner}
  <section class="end" id="end">
    <div class="remember"><span class="tag">这一课记住一句话</span><p id="got"></p></div>
    <h2>练习</h2>
    <div class="quiz" id="quiz" aria-live="polite"></div>
    <div class="next" id="next"></div>
  </section>
</div>`;
  fs.writeFileSync(`../lessons/${lessonFile(L.n)}`, doc(`第 ${L.n} 课 · ${L.title}`, body, await bundle(`src/lessons/${id}.js`)));
  n++;
}

// 启蒙篇：一步一步展开的小课，页面外壳和高中课不一样（没有量表，结尾多一栏“以后课本上会这样写”）
let nk = 0;
for (const K of KIDS.filter((k) => k.ready)) {
  const id = String(K.n).padStart(2, '0');
  if (!fs.existsSync(`src/kids/k${id}.html`)) { console.warn(`启 ${K.n} 标了 ready，但 src/kids/k${id}.html 还没有`); process.exitCode = 1; continue; }
  const inner = fs.readFileSync(`src/kids/k${id}.html`, 'utf8');
  const body = `<div class="wrap kid">
  <nav class="top" id="top" aria-label="课程导航"></nav>
  <header class="hero">
    <div class="eyebrow">启蒙 · 第 ${K.n} 小课</div>
    <h1>${K.title}</h1>
    <div class="hero-grid"><div class="recap" id="recap"></div><div class="ask"><span class="tag">这一课回答</span><p id="ask"></p></div></div>
    <p class="cap">一步一步来：做完一步，按“继续”再出下一步。<a href="#" id="showall">（老师和家长：一次全部展开）</a></p>
  </header>
${inner}
  <section class="end" id="end">
    <div class="remember"><span class="tag">这一课记住一句话</span><p id="got"></p></div>
    <h2>练习</h2>
    <div class="quiz" id="quiz" aria-live="polite"></div>
    <details class="later"><summary>以后课本上会这样写（可以先不看）</summary><p>${K.later || ''}</p><p>想看的话：<span id="backlink"></span>。</p></details>
    <div class="next" id="next"></div>
  </section>
</div>`;
  fs.writeFileSync(`../lessons/${kidFile(K.n)}`, doc(`启蒙 ${K.n} · ${K.title}`, body, await bundle(`src/kids/k${id}.js`)));
  nk++;
}

// 课本对照页：启蒙篇每一段配一页，字母和公式都在这里
let nb = 0;
for (const Bk of BOOKS.filter((b) => b.ready)) {
  const inner = fs.readFileSync(`src/books/t${Bk.seg}.html`, 'utf8'), sg = KID_SEGS.find((x) => x.id === Bk.seg);
  const body = `<div class="wrap kid book">
  <nav class="top" id="top" aria-label="课程导航"></nav>
  <header class="hero">
    <div class="eyebrow">课本对照 · ${sg.name.split(' · ')[0]}</div>
    <h1>${Bk.title.split(' · ')[1]}：课本上怎么写</h1>
    <p class="cap">${Bk.note}。左边是小课里的说法，右边是课本的写法。</p>
  </header>
${inner}
  <section class="end" id="end">
    <h2>用课本的写法做 5 道题</h2>
    <div class="quiz" id="quiz" aria-live="polite"></div>
  </section>
</div>`;
  fs.writeFileSync(`../lessons/${bookFile(Bk.seg)}`, doc(Bk.title, body, await bundle(`src/books/t${Bk.seg}.js`)));
  nb++;
}

// 总目录
// 目录下半部分：大学部分照旧；原来排在高中的第 6～19 课已经并进启蒙主线，收在一个折叠栏里留底
const lessonCard = (l, label) => {
  const inner = `<span class="n">${label || l.n}</span><span class="t">${l.title}</span><span class="h">${l.ask}</span><span class="st">${l.ready ? '可以学了' : '还在做'}</span>`;
  return `<li data-n="${l.n}" class="${l.ready ? 'ready' : 'todo'}">${l.ready ? `<a href="lessons/${lessonFile(l.n)}">${inner}</a>` : `<div>${inner}</div>`}</li>`;
};
const parts = PARTS.filter((p) => p.level === '大学').map((p) => `<section class="part">
    <h2><span class="lv">${p.level}</span>${p.name}</h2><p class="pnote">${p.note}</p>
    <ol class="cards">${LESSONS.filter((l) => l.part === p.id).map((l) => lessonCard(l)).join('')}</ol>
  </section>`).join('\n') + `
  <details class="merged"><summary>原来排在高中部分的第 6～19 课去哪了？</summary>
    <p>都并进上面的启蒙主线了（启 13～33），用同样“先玩再起名字”的办法讲。课本的写法放在每一段的课本对照页里。原来的题目留在这里备查：</p>
    <ul>${LESSONS.filter((l) => l.n >= 6 && l.n <= 19).map((l) => `<li>${l.title}</li>`).join('')}</ul>
  </details>`;
const kidCard = (k) => {
  const inner = `<span class="n">${k.n}</span><span class="t">${k.title}</span><span class="h">${k.ask}</span><span class="st">${k.ready ? '可以学了' : '还在做'}</span>`;
  return `<li data-n="k${k.n}" data-of="4" class="${k.ready ? 'ready' : 'todo'}">${k.ready ? `<a href="lessons/${kidFile(k.n)}">${inner}</a>` : `<div>${inner}</div>`}</li>`;
};
// 每一段小课后面跟着这一段的课本对照：第一段是原来的高中第 1～5 课，后面每段一页
const bookLink = (seg) => {
  const b = BOOKS.find((x) => x.seg === seg && x.ready);
  const cards = seg === 1 ? LESSONS.filter((l) => l.map).map((l) => lessonCard(l, `对照 ${l.n}`)).join('')
    : b ? `<li data-n="t${seg}" class="ready"><a href="lessons/${bookFile(seg)}"><span class="n">对照</span><span class="t">${b.title.split(' · ')[1]}：课本上怎么写</span><span class="h">${b.note}</span><span class="st">可以学了</span></a></li>` : '';
  return cards ? `\n    <p class="booknote">课本对照（学完这一段再看：同样的事，课本上怎么写）</p>\n    <ol class="cards bookcards">${cards}</ol>` : '';
};
const kidPart = `<section class="part kidpart">
    <h2><span class="lv">${KID_PART.level}</span>${KID_PART.name}</h2><p class="pnote">${KID_PART.note}</p>
    ${KID_SEGS.map((sg) => `<h3 class="seg">${sg.name}<small>${sg.note}</small></h3>
    <ol class="cards">${KIDS.filter((k) => (k.seg || 1) === sg.id).map(kidCard).join('')}</ol>${bookLink(sg.id)}`).join('\n    ')}
  </section>`;
const idxCss = `
.cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.cards li>a,.cards li>div{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;height:100%;padding:11px 13px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);text-decoration:none}
.cards li.ready>a:hover{border-color:var(--acc)}
.cards li.todo>div{opacity:.55;background:transparent;border-style:dashed}
.cards li.done>a{border-color:var(--ok)}
.kidpart .lv{background:var(--a)}
.kidpart h3.seg{margin:18px 0 8px;font-size:16px}
.kidpart h3.seg small{font-weight:400;color:var(--ink3);margin-left:10px;font-size:13.5px}
.kidpart .cards .n{color:var(--a)}
.booknote{margin:12px 0 6px;font-size:13.5px;color:var(--ink3)}
.kidpart .bookcards .n{font-size:15px;color:var(--acc);align-self:start;padding-top:4px}
.kidpart .bookcards li>a{background:transparent}
.merged{border:1px dashed var(--line);border-radius:6px;padding:10px 14px;font-size:14.5px;color:var(--ink2)}
.merged summary{cursor:pointer}
.merged ul{columns:2;margin:.5em 0 0;padding-left:1.2em}
@media (max-width:600px){.merged ul{columns:1}}
.cards .n{grid-row:span 3;font:700 26px/1 var(--f-num);color:var(--acc);min-width:1.4em}
.cards .t{font-weight:700;line-height:1.45}
.cards .h{font-size:13.5px;color:var(--ink2);line-height:1.55}
.cards .st{font-size:12px;color:var(--ink3)}
.cards li.done .st{color:var(--ok);font-weight:700}
.part h2{display:flex;align-items:baseline;gap:10px;margin:0 0 2px}
.lv{font:700 13px/1 var(--f-num);letter-spacing:.1em;color:var(--panel);background:var(--acc);border-radius:3px;padding:4px 6px}
.pnote{color:var(--ink3);margin:0 0 12px;font-size:14.5px}
.parts{display:flex;flex-direction:column;gap:34px}
.how{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none;counter-reset:h}
.how li{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:10px 12px;font-size:14.5px;line-height:1.6}
.how b{display:block;margin-bottom:2px}
@media (max-width:760px){.how{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
const index = `<div class="wrap">
  <header class="hero">
    <div class="eyebrow">力学课 · 从小学数学到大学</div>
    <h1>一辆车讲到底的力学</h1>
    <p style="font-size:17px;color:var(--ink2)">同一辆车从停车场开出来，一路上遇到的每个问题就是一小课：它在哪、多快、怎么停下、为什么会变快、拐弯要多大的力……每一小课回答上一课留下的问题，再留一个新问题给下一课。只要会小学数学：先玩、再画图、最后才起名字。课本上的字母和公式，放在每一段后面的“课本对照”里。</p>
    <ul class="how">
      <li><b>先猜</b>每一节先猜一道选择题，猜错了更记得住。</li>
      <li><b>拖一拖</b>每个概念配一张能动的图，数字跟着变。</li>
      <li><b>算式代数字</b>算式下面把当前的数代进去，一步不跳。</li>
      <li><b>练习</b>每课 4～5 道题，数字每次都变，可以一直刷。</li>
    </ul>
    <ul class="quants" aria-label="全课程用到的量和颜色">${QUANTS.map((q) => `<li class="on"><i style="background:var(--${q.c})"></i><b>${q.k}</b><span>${q.name}（${q.unit}）</span></li>`).join('')}</ul>
    <p id="prog" style="margin:0;color:var(--ink3);font-size:14px"></p>
  </header>
  <div class="parts">
${kidPart}
${parts}
  </div>
</div>`;
fs.writeFileSync('../index.html', doc('力学课：一辆车讲到底', index.replace('</header>', '</header>').replace('<div class="wrap">', `<style>${idxCss}</style><div class="wrap">`), await bundle('src/index.js')));
console.log(`index.html + ${n} 课 + 启蒙 ${nk} 小课 + 课本对照 ${nb} 页`);
