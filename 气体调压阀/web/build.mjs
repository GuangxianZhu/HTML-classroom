// 打包：一个入口页 + 八个单页，全部离线可用。
//   ../index.html            入口：猜题、八张卡片、怎么选、现场排查、来源（不带三维，打开快）
//   ../pages/A-spring.html … 每种一页：三维剖面 + 分步手册 + 实验 + 失效条件（只带这一种阀的模型）
// 模型：blender/out/regulators.glb 里八台都有，这里按 ROOT_<名字> 拆成八份，每页只塞自己那份。
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MODELS, ORDER, EV } from './src/data.js';
import { TEACH, SOURCES } from './src/teach.js';
import { labHTML } from './src/labs_html.js';
import { pageFile } from './src/pages.js';

const ROOT = path.resolve('..');
const OUT = path.join(ROOT, 'blender/out');
const css = fs.readFileSync('src/style.css', 'utf8');
const spec = JSON.parse(fs.readFileSync(path.join(OUT, 'spec.json'), 'utf8'));

// ---------- 拆模型 ----------
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function splitGlb(key) {
  const doc = await io.read(path.join(OUT, 'regulators.glb'));
  doc.setLogger(new Logger(Logger.Verbosity.WARN));
  for (const scene of doc.getRoot().listScenes()) {
    for (const n of scene.listChildren()) if (n.getName() !== 'ROOT_' + key) n.dispose();
  }
  // 子节点要先断开才会被 prune 掉：直接把不属于这台的节点全部删掉
  const keep = new Set();
  const root = doc.getRoot().listNodes().find((n) => n.getName() === 'ROOT_' + key);
  root.traverse((n) => keep.add(n));
  for (const n of doc.getRoot().listNodes()) if (!keep.has(n)) n.dispose();
  await doc.transform(prune());
  return io.writeBinary(doc);
}

// ---------- 页面骨架 ----------
const shell = (title, body, js, desc) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${desc}">
<style>
${css}</style></head>
<body>
${body}
<script>${js.replace(/<\/script/g, '<\\/script')}</script>
</body></html>
`;
const esc = (s) => s.replace(/"/g, '&quot;');
const table = (rows) => `<table><thead><tr>${rows[0].map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr><th>${r[0]}</th>${r.slice(1).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const srcList = (ids) => `<ol class="sources">${ids.map((id) => { const [h, t, n] = SOURCES[id]; return `<li><a href="${h}">${t}</a>：${n}</li>`; }).join('')}</ol>`;
const evLegend = `<p class="intro">每句结论后面的小标签表示证据有多硬：${EV.A} 教科书和厂家资料反复出现的内容；${EV.B} 来自某一份专利或产品资料，结构可信、参数不一定；${EV.C} 本页的模型参数、仿真结果或推测，只看趋势。</p>`;

function typePage(key) {
  const m = MODELS[key], T = TEACH[key];
  const i = ORDER.indexOf(key);
  const prev = ORDER[i - 1], next = ORDER[i + 1];
  const rel = (k) => pageFile(k).replace('pages/', '');
  const bar = ORDER.map((k) => `<a href="${rel(k)}"${k === key ? ' aria-current="page"' : ''}><b>${MODELS[k].tag}</b>${MODELS[k].short}</a>`).join('');
  const pager = `<div class="wrap pager">${prev ? `<a href="${rel(prev)}"><small>← 上一种</small><b>${MODELS[prev].tag} ${MODELS[prev].name}</b></a>` : '<a href="../index.html"><small>← 回到</small><b>八种结构总览</b></a>'}${next ? `<a href="${rel(next)}" style="text-align:right"><small>下一种 →</small><b>${MODELS[next].tag} ${MODELS[next].name}</b></a>` : '<a href="../index.html" style="text-align:right"><small>看完了 →</small><b>回到总览：怎么选、现场排查</b></a>'}</div>`;
  const body = `
<header class="top"><div class="wrap">
  <nav class="crumbs"><a href="../index.html">← 气体调压阀 · 八种结构总览</a><span class="sp"></span>${prev ? `<a href="${rel(prev)}">← ${MODELS[prev].tag} ${MODELS[prev].short}</a>` : ''}${next ? `<a href="${rel(next)}">${MODELS[next].tag} ${MODELS[next].short} →</a>` : ''}</nav>
  <p class="num">${m.tag} 型 · 第 ${i + 1} / ${ORDER.length} 种</p>
  <h1>${m.name}</h1>
  <p class="lead">${m.lead}</p>
  <p class="intro">${m.body}</p>
  <div class="facts">${T.facts.map(([h, b, p]) => `<div><h3>${h}</h3><b>${b}</b><p>${p}</p></div>`).join('')}</div>
</div></header>
<div class="bench">
  <div class="viewport" id="vp">
    <canvas id="gl" aria-label="${m.name}剖面三维模型，可拖动旋转"></canvas>
    <div id="pins"></div>
    <div id="loading">正在载入模型</div>
    <nav class="bar" aria-label="八种结构">${bar}</nav>
    <div class="hud">
      <div id="zonelegend"></div>
      <div>
        <span class="sclbl">压力色 低 <span class="scale"></span> 高</span>
        <label><input type="checkbox" id="tgGas" checked>压力色</label>
        <label><input type="checkbox" id="tgFlow" checked>气流</label>
        <button type="button" id="btnFrame">回正视角</button>
      </div>
    </div>
  </div>
  <aside class="manual">
    <div id="detail"></div>
    <div id="benchread"></div>
  </aside>
</div>
<div class="ctlbar"><div class="wrap"><div id="benchctl"></div><p class="cap" style="margin:-6px 0 10px">模型里阀芯和膜片的行程放大了约 7.5 倍（真实只有零点几毫米）；手轮和弹簧的预压缩按真实的 0.3 倍画。仿真参数是教学用的合理量级，不对应任何具体产品。拖动模型可以旋转，点数字看零件。</p></div></div>
<section class="sec" id="spring"><div class="wrap">
  <p class="num">01 · 弹簧动不动</p>
  <h2>${T.spring.h}</h2>
  <div class="springbox">
    <div>${T.spring.p.map((p) => `<p class="intro">${p}</p>`).join('')}</div>
    <div class="tw" style="margin-top:8px">${table(T.spring.table)}</div>
  </div>
</div></section>
<section class="sec" id="lab"><div class="wrap">
  <p class="num">02 · 动手实验</p>
  ${labHTML(T.lab, T.focus ?? -1)}
</div></section>
<section class="sec" id="limits"><div class="wrap">
  <p class="num">03 · 前提和失效条件</p>
  <h2>它在什么情况下会稳不住</h2>
  <ul class="fail">${T.limits.map((l) => `<li>${l}</li>`).join('')}</ul>
</div></section>
<section class="sec" id="alts"><div class="wrap">
  <p class="num">04 · 其他路线</p>
  <h2>同一个问题，还有哪些做法</h2>
  <div class="alts">${T.alts.map(([h, main, p]) => `<div><h3>${h}${main ? '<span class="main">主流</span>' : ''}</h3><p>${p}</p></div>`).join('')}</div>
</div></section>
<section class="sec" id="src"><div class="wrap">
  <p class="num">05 · 证据和来源</p>
  <h2>这页的话有多可靠</h2>
  ${evLegend}
  ${srcList(T.src)}
</div></section>
${pager}
<footer><div class="wrap">HTML 教室 · 气体调压阀 · ${m.tag} 型。模型由 Blender 脚本生成，结构参考公开专利，外形和尺寸不对应任何具体产品；仿真在浏览器里实时计算。</div></footer>`;
  return { body, title: `${m.tag} 型 ${m.name} · 气体调压阀`, desc: m.lead };
}

function homePage() {
  const img = (k) => `data:image/jpeg;base64,${fs.readFileSync(path.join(OUT, `view_${k}.jpg`)).toString('base64')}`;
  const cards = ORDER.map((k) => {
    const m = MODELS[k], T = TEACH[k];
    return `<a class="card" href="${pageFile(k)}"><img src="${img(k)}" alt="${m.name}剖面渲染" loading="lazy"><div><span class="tag">${m.tag} 型 · 第 ${ORDER.indexOf(k) + 1} 页</span><h3>${m.name}</h3><p>${T.card}</p><span class="chips">${T.facts.slice(0, 2).map(([h, b]) => `<span>${h}：${b}</span>`).join('')}</span></div></a>`;
  }).join('');
  const P = (k) => `<a href="${pageFile(k)}">${MODELS[k].tag} ${MODELS[k].short}</a>`;
  const src = Object.keys(SOURCES);
  const body = `
<header class="top"><div class="wrap">
  <h1>气体调压阀：八种结构，一种一页</h1>
  <p class="lead">半导体湿法设备里，氮气、压缩空气、药液，几乎每一路都要先"稳压"再用。干这件事的零件叫调压阀（regulator）。这里把八种常见结构拆开，每种单独一页：先猜一道题，再一步一步拆给你看，最后讲它在什么情况下会失灵。</p>
  <div class="homequiz" id="homequiz" data-ans="1">
    <p class="kicker">先猜一下</p>
    <p class="q" style="font-size:17px;font-weight:800">下游用气量忽大忽小，调压阀的出口压力却基本不变。它是怎么"知道"出口压力的？</p>
    <div class="opts">
      <button type="button"><b>A</b><span>里面有一个压力传感器，控制板看着它调</span></button>
      <button type="button"><b>B</b><span>出口压力直接推着一张膜片，膜片带着阀芯开大关小</span></button>
      <button type="button"><b>C</b><span>它不知道，靠阀口大小固定，压力自然就稳</span></button>
    </div>
    <p><button type="button" class="link" id="hqSkip">不猜了，直接看答案</button></p>
    <p class="verdict" hidden><b></b>八种里有六种（A 到 F）靠的是 B：膜片被出口压力推着，自己就是"传感器 + 比较器"，不需要任何电子元件。只有 G、H 两种才多了一个电子压力传感器（A 的说法），而它们的主阀里其实还是有膜片。C 不对：阀口固定时，用气量一变出口就会跟着大变。零基础建议从 ${P('spring')} 开始看。</p>
  </div>
  <div class="namebox">
    <div>
      <h2>先把名字弄对：它不叫"整流器"</h2>
      <p>"整流器"（rectifier）是电学里把交流电变成直流电的器件，和气体没有关系。气体的这个零件，中文叫<b>减压阀</b>、<b>调压阀</b>或<b>压力调节器</b>，日本现场一般就叫<b>レギュレータ</b>或<b>減圧弁</b>，英文是 <b>pressure regulator</b>。</p>
      <p>它稳的是<b>压力</b>，不是流量。稳流量的是另一类零件（质量流量控制器 MFC 一类）。</p>
    </div>
    <div class="tw" style="margin-top:0">
      <table>
        <thead><tr><th>你可能听到的叫法</th><th>指的是</th><th>看哪页</th></tr></thead>
        <tbody>
          <tr><th>減圧弁、レギュレータ、减压阀</th><td>把高压降成稳定的低压，管下游</td><td>${P('spring')} ${P('twostg')} ${P('dome')}</td></tr>
          <tr><th>背圧弁、back pressure regulator</th><td>把上游顶在设定值，多的放掉</td><td>${P('bpr')}</td></tr>
          <tr><th>電空レギュレータ、E/P、电气比例阀</th><td>电信号改设定的调压阀</td><td>${P('epopen')} ${P('epclose')}</td></tr>
          <tr><th>Auto / Automatic Pressure Regulator</th><td>多指传感器 + 电动阀 + 控制板的电子式</td><td>${P('piezo')}（也可能是 G）</td></tr>
          <tr><th>薬液レギュレータ、气控调压阀</th><td>用气压设定液体压力</td><td>${P('ptfe')}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div></header>
<section class="sec" id="cards"><div class="wrap">
  <p class="num">01 · 八种结构</p>
  <h2>点一张卡片进去，每页都是同样的顺序：猜题 → 分步拆 → 实验 → 失效条件</h2>
  <div class="path"><em>推荐顺序：</em>${ORDER.map(P).join('<em>→</em>')}</div>
  <p class="intro">前三种讲"纯机械怎么稳压"，D、E 是同一原理的两个变形（管液体、管上游），最后三种讲"电信号怎么来设定"。每一页都能单独看，看不懂某个词时回到 A 页最稳。</p>
  <div class="cards">${cards}</div>
</div></section>
<section class="sec" id="same"><div class="wrap">
  <p class="num">02 · 共同点</p>
  <h2>八种结构，做的其实是同一件事：比较，然后修正</h2>
  <div class="who">
    <div><h3>设定从哪来</h3><b>弹簧 / 气 / 电磁铁 / 程序</b><p>A、B 用弹簧，C、D、E 用一腔气，F 用电磁力，G、H 用控制板里的一个数字。</p></div>
    <div><h3>谁在感受出口</h3><b>膜片 / 传感器</b><p>A 到 F 都靠膜片直接感受出口压力；G、H 多了一个电子压力传感器。</p></div>
    <div><h3>谁来修正</h3><b>阀芯开大或关小</b><p>出口低了就多放气进来，高了就少放；带溢流的还能往外放。</p></div>
    <div><h3>误差去了哪</h3><b>下垂 · 漂移 · 传感器</b><p>纯机械的误差跟着流量和进口压力走；电子闭环的误差跟着传感器走。</p></div>
  </div>
  <div class="tw">
    <table>
      <thead><tr><th>你的需求</th><th>先看</th><th>为什么</th></tr></thead>
      <tbody>
        <tr><th>设备上一路氮气，手调一次就不动</th><td>${P('spring')}</td><td>最简单、不耗气、不用电</td></tr>
        <tr><th>钢瓶直供，从满用到空出口都要稳</th><td>${P('twostg')}</td><td>挡住钢瓶压力的大变化</td></tr>
        <tr><th>流量大、下垂要小，或者要在控制柜里改设定</th><td>${P('dome')}</td><td>气弹簧几乎不变力；先导口可以远程</td></tr>
        <tr><th>药液 / 纯水要稳压，接液不能有金属</th><td>${P('ptfe')}</td><td>用控制气设定，氟树脂隔离</td></tr>
        <tr><th>管路或容器的压力不许超过某个值</th><td>${P('bpr')}</td><td>管上游，多的放走</td></tr>
        <tr><th>PLC 给一个电信号就要改压力</th><td>${P('epclose')}，便宜要求低看 ${P('epopen')}</td><td>闭环的把流量、进口影响补掉</td></tr>
        <tr><th>高纯气体面板、要快、全金属</th><td>${P('piezo')}</td><td>压电阀 + 传感器 + PID</td></tr>
      </tbody>
    </table>
  </div>
</div></section>
<section class="sec" id="auto"><div class="wrap">
  <p class="num">03 · 你们的 auto pressure regulator</p>
  <h2>它到底是哪一种？三个候选，和现场分辨的方法</h2>
  <p class="intro">"Auto pressure regulator"不是一个严格的标准术语，不同厂家用法不同。在半导体设备的气路里，最常见的是下面三种之一。看一眼实物和接线，一般就能分出来。 ${EV.C}</p>
  <div class="cands">
    <div><h3>候选 1：数字式（${P('piezo')}）</h3><b>传感器 + 压电或电磁比例阀 + PID</b>
      <ul><li>HORIBA STEC 把它的 UR 系列叫 Automatic Pressure Regulator：内置高精度压力传感器和压电阀，按外部信号控压，接气部分可全金属。 ${EV.B}</li>
      <li>外观像一块金属块加一个电子外罩，接头多是面密封（VCR 一类）。 ${EV.C}</li>
      <li>单阀结构的没有排气口，往下调设定要靠下游用气。 ${EV.C}</li>
      <li>线缆里有设定输入和压力监视输出（模拟量或 DeviceNet）。</li></ul></div>
    <div><h3>候选 2：闭环电气比例阀（${P('epclose')}）</h3><b>两只开关电磁阀 + 传感器 + 先导主阀</b>
      <ul><li>型号上常写 electro-pneumatic regulator / 電空レギュレータ。</li>
      <li>有 EXH 排气口，往下调设定时会排气。</li>
      <li>调节时能听到电磁阀"嗒嗒"响。</li>
      <li>多半带数码管显示，供气压力要求比设定高一截（SMC 手册写的是至少高 0.1 MPa）。 ${EV.B}</li></ul></div>
    <div><h3>候选 3：开环电气比例阀（${P('epopen')}）</h3><b>比例电磁铁或喷嘴挡板，没有传感器</b>
      <ul><li>没有显示，线缆里只有输入、没有压力反馈输出。</li>
      <li>喷嘴挡板式即使不调节也一直有一点点排气声。</li>
      <li>精度主要看标定，流量一大出口就掉。</li>
      <li>老设备、成本敏感的地方更常见。 ${EV.C}</li></ul></div>
  </div>
  <p class="note">如果它管的是<b>药液或纯水</b>的压力，那多半是"电气比例阀 + 氟树脂气控调压阀（${P('ptfe')}）"这一对：电气比例阀出一路控制气，氟树脂阀把它变成液压。查型号时两个都要看。</p>
  <h3 style="font-size:18px;font-weight:800;margin-top:24px">现场现象 → 先怀疑什么</h3>
  <div class="tw">
    <table>
      <thead><tr><th>看到的现象</th><th>先怀疑</th><th>看哪页</th></tr></thead>
      <tbody>
        <tr><th>没人用气时，出口慢慢往上爬</th><td>阀座内漏（爬升）；闭环式也可能是下游有一路在倒灌</td><td>${P('spring')} 第 6 步</td></tr>
        <tr><th>一用气压力就掉，停了又回来</th><td>机械式的下垂；或者阀的通径、供气压力不够，闭环也补不回来</td><td>${P('spring')}、${P('epclose')}</td></tr>
        <tr><th>显示一切正常，工艺结果却偏了</th><td>闭环式的传感器零点漂了：它在"准确地"守一个错的值。拿一块校准过的表在出口比一比</td><td>${P('epclose')} 第 7 步</td></tr>
        <tr><th>设定调低，出口不降</th><td>不溢流的阀，或者只有进气阀的数字式，加上下游关着</td><td>${P('piezo')} 第 5 步</td></tr>
        <tr><th>设定调高，出口上不去</th><td>供气压力不够高；先导支路堵了；闭环式控制板报警</td><td>${P('epclose')}、${P('ptfe')}</td></tr>
        <tr><th>电气比例阀一直"嗒嗒"响、排气不停</th><td>下游有漏；或者供气压力在抖；或者设定正好卡在保持带边上</td><td>${P('epclose')}</td></tr>
        <tr><th>药液出口一直比控制气低一截</th><td>下游开太大（药液阀下垂）；供液压力不足；膜片老化变硬</td><td>${P('ptfe')} 第 3、4 步</td></tr>
        <tr><th>控制气这一侧闻到药液味、有腐蚀</th><td>氟树脂膜片渗透或破损</td><td>${P('ptfe')}</td></tr>
      </tbody>
    </table>
  </div>
  <p class="note">还有一条容易被忽略：调压阀不是截止阀，关着也不保证完全不漏，检修时要用单独的隔断阀把它前后隔开。 ${EV.B}</p>
</div></section>
<section class="sec" id="limits"><div class="wrap">
  <p class="num">04 · 结论和它的边界</p>
  <h2>这些页面能说什么，不能说什么</h2>
  ${evLegend}
  <div class="limits">
    <div><h3>比较可靠的</h3><p>力平衡、下垂、进口压力效应、锁定、爬升，这些是调压阀的教科书内容，产品资料和专利里反复出现。 ${EV.A}</p></div>
    <div><h3>来自专利，结构是真的，参数不是</h3><p>八种结构都能在公开专利或产品原理图里找到出处（见下面）。但专利描述的是"一种实施方式"，具体产品可能改了很多。模型尺寸和仿真参数都是本页定的。 ${EV.B}</p></div>
    <div><h3>数字只看趋势</h3><p>仿真里的 kPa 和 NL/min 是合理量级，用来比较"谁比谁大、往哪边变"。真实的下垂、进口压力效应、响应时间请看所用型号的规格书。 ${EV.C}</p></div>
    <div><h3>"auto pressure regulator"是哪种，这里没法替你确认</h3><p>上一节给的是分辨方法和最常见的三种可能。确切答案在设备的零件表和铭牌上。 ${EV.C}</p></div>
  </div>
</div></section>
<section class="sec" id="src"><div class="wrap">
  <p class="num">05 · 来源</p>
  <h2>专利和资料</h2>
  ${srcList(src)}
</div></section>
<footer><div class="wrap">HTML 教室 · 模型由 Blender 脚本生成，所有实验都是在浏览器里实时算出来的。结构参考公开专利，外形和尺寸不对应任何具体产品。液体那一侧见同仓库的 <a href="../液体调压阀/index.html">液体调压阀</a>。</div></footer>`;
  return body;
}

// ---------- 打包 ----------
const modelPlugin = (glbBytes, specObj) => ({
  name: 'model',
  setup(b) {
    b.onResolve({ filter: /^model:/ }, (a) => ({ path: a.path, namespace: 'model' }));
    b.onLoad({ filter: /.*/, namespace: 'model' }, (a) => (a.path === 'model:glb'
      ? { contents: glbBytes, loader: 'binary' }
      : { contents: JSON.stringify(specObj), loader: 'json' }));
  },
});
const opts = { bundle: true, minify: true, format: 'iife', write: false, target: 'es2020', legalComments: 'none' };

fs.mkdirSync(path.join(ROOT, 'pages'), { recursive: true });
let total = 0;
for (const key of ORDER) {
  const glb = await splitGlb(key);
  const sp = { ...spec, models: { [key]: spec.models[key] } };
  const out = await build({ ...opts, entryPoints: ['src/type.js'], define: { __MODEL__: JSON.stringify(key) }, plugins: [modelPlugin(glb, sp)] });
  const { body, title, desc } = typePage(key);
  const html = shell(title, body, out.outputFiles[0].text, esc(desc));
  fs.writeFileSync(path.join(ROOT, pageFile(key)), html);
  total += html.length;
  console.log(pageFile(key).padEnd(22), (glb.byteLength / 1e6).toFixed(2), 'MB glb ·', (html.length / 1e6).toFixed(2), 'MB page');
}
const home = await build({ ...opts, entryPoints: ['src/home.js'] });
const homeHtml = shell('气体调压阀：八种结构，一种一页', homePage(), home.outputFiles[0].text, '八种气体调压阀，每种一页：猜题、分步拆解、实验、失效条件。');
fs.writeFileSync(path.join(ROOT, 'index.html'), homeHtml);
console.log('index.html'.padEnd(22), (homeHtml.length / 1e6).toFixed(2), 'MB; all', ((total + homeHtml.length) / 1e6).toFixed(1), 'MB');
