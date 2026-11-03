// 八章内容。每章：文案 + enter(A) 返回 { tick(dt), leave() }。
import * as S from './sim.js';
import { Plot, C, niceTicks } from './chart.js';
import { B, WIRE } from './stage.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------------------------------------------------------- 来源
const REFS = {
  iota: ['IoT Analytics：SDV 采用的四个维度与领先车企', 'https://iot-analytics.com/software-defined-vehicles-adoption-4-dimensions-leading-oems/'],
  rivian: ['Popular Science：Rivian 减少 1.6 英里线束和 44 磅', 'https://www.popsci.com/technology/rivian-zonal-electrical-architecture'],
  vmodel: ['S&P AutoTechInsight：V-Model 重新编译（Elektrobit 问答）', 'https://autotechinsight.spglobal.com/news/5288288/the-v-model-recompiled-q-a-with-elektrobit'],
  r156: ['UL Solutions：UN R156 软件更新管理体系', 'https://www.ul.com/sis/insights/software-update-management-systems-according-unece-r156'],
  r155: ['SPK：R155 与 R156 对比', 'https://www.spkaa.com/blog/unece-r155-vs-r156-explained-what-automotive-engineering-leaders-need-to-know'],
  molex: ['Molex：互联汽车与线束', 'https://www.molex.com/en-us/blog/unleashing-the-power-of-connected-cars'],
  eating: ['IEEE Spectrum《软件吞噬汽车》摘要（Slashdot）', 'https://tech.slashdot.org/story/21/06/16/2232239/how-software-is-eating-the-car'],
  autosar: ['Promwad：中央计算上的 AUTOSAR Adaptive', 'https://promwad.com/news/autosar-adaptive-central-compute-classic-platform-bottleneck'],
  jeep: ['The Autopian：Jeep 召回 24,238 辆 OTA 变砖的牧马人', 'https://www.theautopian.com/jeep-recalls-24238-wranglers-after-bricking-them-with-an-ota-update-a-thing-that-keeps-happening/'],
  tesla: ['Engadget：Model 3 刹车更新后获 Consumer Reports 推荐', 'https://www.engadget.com/2018-05-30-tesla-model-3-earns-consumer-reports-recommendation-brake-fix.html'],
  arene: ['Woven by Toyota：Arene 在新款 RAV4 上首发', 'https://www.woven.toyota/en/news/20250521'],
  rvtech: ['InsideEVs：Rivian 与大众的合资进度', 'https://insideevs.com/news/778750/rivian-volkswagen-joint-venture-strong-progress-evs/'],
  winter: ['electrive：大众和 Rivian 结束冬测（2026-03）', 'https://www.electrive.com/2026/03/27/vw-and-rivian-conclude-winter-testing-programme/'],
  bmw: ['IEEE Spectrum：宝马 iX3 与 Neue Klasse', 'https://spectrum.ieee.org/bmw-ix3-neue-klasse'],
  mck: ['McKinsey：汽车产品开发加速（2025-08）', 'https://www.mckinsey.com/capabilities/operations/our-insights/automotive-product-development-accelerating-to-new-horizons'],
  wards: ['WardsAuto 专栏：车企追赶中国速度（2026-06）', 'https://www.wardsauto.com/news/automakers-catch-up-to-china-speed/822184/'],
  slow: ['Carscoops：中国车企该不该放慢开发（2026-09）', 'https://www.carscoops.com/2026/09/chinese-automakers-should-slow-down-development/'],
  mlit: ['国土交通省：特定改造等许可制度（2020）', 'https://www.mlit.go.jp/report/press/jidosha08_hh_003789.html'],
  jpdate: ['Car Watch：日本网络安全和软件更新基准的适用时间', 'https://car.watch.impress.co.jp/docs/news/1297733.html'],
  gb: ['IT之家：GB 44495/44496/44497 发布', 'https://www.ithome.com/0/793/286.htm'],
  gbt: ['新华网：GB/T 48140—2026 汽车软件质量与缺陷管理规范', 'https://www.news.cn/fortune/20260915/78ce53b7bd8c471db2292226dc3b0873/c.html'],
};
const RK = Object.keys(REFS);
const rf = (k) => `<a class="rf" href="${REFS[k][1]}" target="_blank" rel="noopener" title="${REFS[k][0]}">[${RK.indexOf(k) + 1}]</a>`;

// ---------------------------------------------------------- 片段
const ctl = (id, label, min, max, step, val) => `<label class="ctl" for="${id}"><span>${label}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"><output id="${id}-o" for="${id}"></output></label>`;
const kpi = (id, label) => `<div class="kpi"><div class="k">${label}</div><div class="v" id="${id}">–</div></div>`;
const plot = (id, h, title) => `<div><p class="pt">${title}</p><div class="plotwrap"><canvas id="${id}" style="height:${h}px"></canvas></div></div>`;
const btn = (id, label, pressed) => `<button class="btn" id="${id}" type="button"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${label}</button>`;
const EV = { a: ['a', '公认'], b: ['b', '工程实践'], c: ['c', '本页简化'], d: ['d', '我的推测'] };
const note = (title, ev, body) => `<div class="note"><h3>${title}${(Array.isArray(ev) ? ev : ev ? [ev] : []).map((e) => ` <span class="ev ${EV[e][0]}">${EV[e][1]}</span>`).join('')}</h3>${body}</div>`;
const key = (c, t) => `<span><i style="background:${c}"></i>${t}</span>`;
const unit = (v, u) => `${v}<small>${u}</small>`;
const setv = (id, html) => { const e = $(id); if (e && e._v !== html) { e.innerHTML = html; e._v = html; } };

function bind(id, fn, fmt) {
  const el = $(id), o = $(`${id}-o`);
  const run = () => { const v = +el.value; if (o) o.textContent = fmt ? fmt(v) : v; fn(v); };
  el.addEventListener('input', run); run();
  return { set(v) { el.value = v; run(); }, get: () => +el.value };
}

/** 三段开关。items: [[值, 文字, 小字]] */
const seg = (id, items, val, color) => `<div class="seg" id="${id}" role="group">${items.map(([v, t, sm]) => `<button type="button" data-v="${v}" aria-pressed="${v === val}" ${color ? `style="--sc:${color[v]}"` : ''}>${t}${sm ? `<small>${sm}</small>` : ''}</button>`).join('')}</div>`;
function bindSeg(id, fn) {
  const el = $(id);
  const pick = (v) => { [...el.children].forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v)); fn(v); };
  el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(b.dataset.v); });
  return { set: pick };
}
const ARCH_ITEMS3 = [['A', '分布式', '经典'], ['B', '域集中', '过渡'], ['C', '中央+区域', '软件定义']];
const ARCH_COL = { A: S.ARCH.A.color, B: S.ARCH.B.color, C: S.ARCH.C.color };
const fmtLen = (m) => `${Math.round(m)}`;
const LEG_WIRE = `${key(WIRE.sig, '信号线')}${key(WIRE.bus, 'CAN / LIN')}${key(WIRE.eth, '以太网 / 同轴')}${key(WIRE.pwr, '低压供电')}`;
const LEG_DOM = (spec) => Object.values(spec.domains).map((d) => key(d.color, d.cn)).join('');

function chainFor(A, id, list) {
  const spec = A.spec;
  $(id).innerHTML = list.map((k) => `<span>${spec.functions[k].cn}<em style="color:var(--muted)"> ${spec.functions[k].rate}</em></span>`).join('');
}

function buses(spec, a) { return Object.keys(spec.buses[a]).length; }

// ---------------------------------------------------------- 第 1 章
const overview = {
  id: 'overview', nav: '全貌', view: 'xray',
  title: '同一辆车，两种造法',
  lead: '这是一辆虚构的教学车。车身、底盘、电池、电机、传感器都不换，只换两样：车里的<b>电子电气架构</b>，和背后的<b>研发流程</b>。这样你看到的差别，都来自这两样。',
  body: () => `
    ${seg('o-arch', [['A', '经典模式', '分布式'], ['C', '软件定义', '中央 + 区域']], 'A', ARCH_COL)}
    ${seg('o-view', [['xray', '透视'], ['solid', '实车'], ['ex', '拆开']], 'xray')}
    <div class="kpis">${kpi('o-k1', '控制盒')}${kpi('o-k2', '线总长')}${kpi('o-k3', 'CAN 总线')}${kpi('o-k4', '写软件的')}</div>
    <div class="tw"><table class="cmp">
      <tr><th></th><th class="h-cl">经典模式</th><th class="h-sd">软件定义</th></tr>
      <tr><td>把车看成</td><td>一件交付的产品</td><td>一个持续运行的平台</td></tr>
      <tr><td>软硬件</td><td>软件长在零件里，一起定点、一起冻结</td><td>软件和硬件各走各的节奏</td></tr>
      <tr><td>功能放哪</td><td>一个功能一个盒子</td><td>逻辑集中，I/O 就近</td></tr>
      <tr><td>谁写软件</td><td>主要是供应商，整车厂写规格、做集成</td><td>整车厂掌握平台和关键功能</td></tr>
      <tr><td>流程</td><td>一个大 V，按样件阶段走</td><td>硬件还走 V，软件持续集成、频繁发布</td></tr>
      <tr><td>SOP 意味着</td><td>研发结束</td><td>第一次发布</td></tr>
      <tr><td>上市以后</td><td>年改；出问题就召回</td><td>OTA 改进；要长期养团队和云</td></tr>
    </table></div>`,
  notes: () => `
    ${note('软件定义汽车不等于什么', 'a', `<ul>
      <li><b>不等于电动车。</b>这一章左边的经典模式也是电动车，电动只换了动力，没换研发方式。</li>
      <li><b>不等于大屏。</b>屏幕只是座舱域的一个外设。</li>
      <li><b>不等于能 OTA。</b>只升级地图和车机的车，车身和底盘逻辑可能还是老样子。</li>
    </ul><p>IoT Analytics 把它拆成四个维度：车辆架构、车云集成、软件驱动的工程方式、交付后的运营${rf('iota')}。四样都有才算，所以它首先是一种研发和运营方式。</p>`)}
    ${note('这辆教学车的假设', 'c', `<p>经典架构画了 34 个盒子、85 个外设。真车更多：报道里高端车 150 个以上，低端车也接近 100 个${rf('eating')}。线束按“每根线走最短路”算出来，所以三种架构的相对差别有意义，绝对长度只是教学车的量级。功能的 ASIL 等级是我按常见做法估的，实车要看各家的危害分析。</p>`)}`,
  enter(A) {
    const s = A.stage;
    const paint = (a) => {
      A.arch(a);
      setv('o-k1', unit(A.spec.stats[a].ecu, '个'));
      setv('o-k2', unit(fmtLen(A.spec.stats[a].len_m), 'm'));
      setv('o-k3', unit(buses(A.spec, a), '条'));
      setv('o-k4', unit(S.owners(A.spec, a).length, '方'));
    };
    bindSeg('o-arch', paint);
    bindSeg('o-view', (v) => {
      s.setShell(v === 'solid' ? 'solid' : 'xray');
      s.setExplode(v === 'ex' ? 1 : 0);
      s.applyView(v === 'solid' ? 'home' : v === 'ex' ? 'explode' : 'xray');
      A.setLegend(v === 'solid' ? '' : LEG_WIRE);
    });
    s.setShell('xray');
    A.setLegend(LEG_WIRE);
    paint('A');
    return {};
  },
};

// ---------------------------------------------------------- 第 2 章
const nerve = {
  id: 'nerve', nav: '神经系统', view: 'top',
  title: '把软件从盒子里搬出来',
  lead: '小球是软件功能，颜色代表它属于哪个域。切换架构时外设一个不少，<b>搬家的是逻辑</b>。小球摞得越高，这个盒子跑的功能越多。',
  body: () => `
    ${seg('n-arch', ARCH_ITEMS3, 'A', ARCH_COL)}
    <div class="kpis">${kpi('n-k1', '控制盒')}${kpi('n-k2', '线总长')}${kpi('n-k3', '单根线数')}${kpi('n-k4', '相比分布式')}</div>
    <div class="lgd" id="n-wires">
      ${['sig', 'bus', 'eth', 'pwr'].map((c) => `<button type="button" data-c="${c}" aria-pressed="true"><i style="background:${WIRE[c]}"></i>${{ sig: '信号线', bus: 'CAN / LIN', eth: '以太网 / 同轴', pwr: '低压供电' }[c]}</button>`).join('')}
    </div>
    <div class="btns">${btn('n-top', '俯视', true)}${btn('n-side', '侧视', false)}${btn('n-3d', '斜视', false)}${btn('n-tok', '软件小球', true)}</div>
    <div class="card" id="n-card"><h4>点车里的一个盒子</h4><p>这里会列出它是谁、跑着哪些功能。</p></div>`,
  notes: () => `
    ${note('经典车为什么一个功能一个盒子', 'a', `<p>这个做法在当年很合理。功能是一个个加上去的，每加一个就买一个盒子：报价清楚，责任清楚，坏了只影响自己。代价慢慢才显出来，盒子越来越多，跨功能的事要靠几条 CAN 上的信号表对接。报道里 F-150 的代码超过 1.5 亿行${rf('eating')}，线束是车上第三重的部件${rf('molex')}（后者是连接器厂商的说法）。</p>`)}
    ${note('域集中：算力集中了，线没少', 'c', `<p>这辆车上，域集中的线总长反而比分布式<b>长</b>一点。原因是逻辑收进了域控，但灯、门、座椅的 I/O 没动，有的域控离传感器更远。域架构解决的是算力和软件组织，线束要等区域架构才明显变短。</p>`)}
    ${note('中央 + 区域：按位置分，不按功能分', ['b', 'c'], `<p>区控只管附近的负载，把它们变成以太网上的服务，逻辑收到中央。这辆车的线因此少了约三分之一。这个数字依赖一个假设：门内、座椅、超声波这些负载按<b>智能执行器</b>算，共用一根低速总线。如果每个负载都从区控单独拉线，这辆车的线只少约 13%。</p>
      <p>实车例子：Rivian 第一代 17 个 ECU，第二代文章列出 5 个独立 ECU 加 3 个区控，线束少 1.6 英里、减重 44 磅，公司称物料成本降 20%${rf('rivian')}。宝马 iX3 用四个“超级大脑”，线缆少约 600 米、减重约 30%${rf('bmw')}。这些都是厂商自报，口径不同。</p>
      <p><b>什么时候不划算：</b>本来 ECU 就少的小车省不了多少线；区控和中央算力比小盒子贵；四个区控都成了关键节点，电源和通信要做冗余。</p>`)}
    ${note('有些功能不搬', 'a', `<p>切到中央 + 区域时，下面这些小球留在原地。循环太快、失效后果太重的逻辑，留在离执行器最近的地方最稳：延迟确定，通信断了也能自己动作。</p><div class="fns" id="n-edge"></div>`)}`,
  enter(A) {
    const s = A.stage, spec = A.spec;
    let arch = 'A', sel = null;
    const show = (k) => {
      sel = k;
      const e = spec.ecus[k];
      const fs = S.functionsOn(spec, arch, k).map((f) => spec.functions[f]);
      $('n-card').innerHTML = `<h4>${e.cn}<span>${e.en}</span></h4><p>${e.desc}</p><div class="fns">${fs.length ? fs.map((f) => `<span class="${/[CD]/.test(f.asil) ? 'h' : ''}">${f.cn} · ${f.asil}</span>`).join('') : '<span>这里主要是 I/O 驱动</span>'}</div>`;
      A.setPins([{ t: e.cn, p: [e.pos[0], e.pos[1], e.pos[2] + 130], c: spec.domains[e.dom].color }]);
    };
    A.onPick = show;
    const base = spec.stats.A.len_m;
    const paint = (a) => {
      arch = a; A.arch(a);
      const st = spec.stats[a];
      setv('n-k1', unit(st.ecu, '个'));
      setv('n-k2', unit(fmtLen(st.len_m), 'm'));
      setv('n-k3', unit(st.wires, '根'));
      const d = (st.len_m / base - 1) * 100;
      setv('n-k4', a === 'A' ? '基准' : unit(`${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}`, '%'));
      if (sel) { if (spec.ecus[sel].arch.includes(a)) show(sel); else { sel = null; A.setPins([]); $('n-card').innerHTML = '<h4>这个盒子在这种架构里没有了</h4><p>它的功能搬到了别的盒子上，看小球的去向。</p>'; } }
    };
    bindSeg('n-arch', paint);
    s.setShell('xray'); s.setTokens(true);
    paint('A');
    A.setLegend(LEG_DOM(spec));
    $('n-edge').innerHTML = Object.values(spec.functions).filter((f) => !f.central).map((f) => `<span>${f.cn} · ${f.rate}</span>`).join('');
    $('n-wires').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', on); s.setClass(b.dataset.c, on);
    });
    const vb = { 'n-top': 'top', 'n-side': 'side', 'n-3d': 'xray' };
    for (const id in vb) $(id).onclick = () => { for (const j in vb) $(j).setAttribute('aria-pressed', j === id); s.applyView(vb[id]); };
    $('n-tok').onclick = () => { const on = $('n-tok').getAttribute('aria-pressed') !== 'true'; $('n-tok').setAttribute('aria-pressed', on); s.setTokens(on); };
    return { leave() { for (const c of ['sig', 'bus', 'eth', 'pwr']) s.setClass(c, true); } };
  },
};

// ---------------------------------------------------------- 第 3 章
const change = {
  id: 'change', nav: '改一个功能', view: 'xray',
  title: '改一个功能，要动多少东西',
  lead: '挑一个需求。亮起来的盒子都要改，发亮的细线是信号要走的路。同一个需求，看三种架构差多少。',
  body: () => `
    <div class="picks" id="c-pick"></div>
    ${seg('c-arch', ARCH_ITEMS3, 'A', ARCH_COL)}
    <div class="card" id="c-card"></div>
    <div class="kpis">${kpi('c-k1', '要改的盒子')}${kpi('c-k2', '涉及几方')}${kpi('c-k3', '新增跨盒信号')}${kpi('c-k4', '同住的功能')}</div>
    <div class="tw"><table class="cmp" id="c-tab"></table></div>`,
  notes: () => `
    ${note('差别从哪来', 'b', `<p>经典架构里，逻辑和 I/O 焊在同一个盒子里。要让灯配合门锁，就得改灯的盒子和门的盒子，每个盒子一张变更单，通信矩阵也要跟着改，网关要重新配路由。中央架构里，I/O 变成区控提供的稳定服务，改逻辑时只动中央这一份软件。</p>`)}
    ${note('最右一格是代价', ['c', 'd'], `<p>“同住的功能”算的是：被改动的盒子上一共跑着多少功能。这个数字在中央架构里反而大得多。改动的范围小了，<b>一次出错能连累的范围却大了</b>，所以中央计算必须靠分区隔离，回归测试也要自动化。这一点我认为比“少改几个盒子”更决定成败。</p>`)}
    ${note('ABS 这一项，架构帮不上忙', 'a', `<p>ABS 留在 ESC 里，三种架构都只动这一个盒子。它能不能远程改，要看 ESC 能否安全刷写、标定权在谁手里。2018 年 Consumer Reports 测 Model 3 的 60–0 mph 制动距离多为 152 英尺，一次 OTA 后稳定在 133 英尺${rf('tesla')}。这说明<b>整车厂握着标定权</b>时能做到什么，和有没有区控无关。</p>`)}
    ${note('激光雷达这一项，软件变不出来', 'a', `<p>车上没有的传感器，改多少代码都没用。软件定义只对已经装在车上的硬件起作用，所以才有“硬件预埋”这种做法，把成本提前花掉，换以后的可能性。第 4 章可以试这个开关。</p>`)}`,
  enter(A) {
    const s = A.stage, spec = A.spec;
    let arch = 'A', fe = spec.features[1];
    const graphs = { A: S.netGraph(spec, 'A'), B: S.netGraph(spec, 'B'), C: S.netGraph(spec, 'C') };
    $('c-pick').innerHTML = spec.features.map((f) => `<button class="pick" type="button" data-id="${f.id}" aria-pressed="${f === fe}"><b>${f.cn}</b><span>${f.tag} · ${f.asil === 'QM' ? '非安全' : `ASIL ${f.asil}`}</span></button>`).join('');
    const paint = () => {
      A.arch(arch);
      const r = S.impact(spec, fe, arch);
      $('c-card').innerHTML = `<h4>${fe.cn}<span>${fe.asil === 'QM' ? 'QM' : `ASIL ${fe.asil}`}</span></h4><p>${fe.story}</p>`;
      $('c-card').className = fe.hw ? 'card cl' : 'card';
      setv('c-k1', unit(r.touched.length, '个'));
      setv('c-k2', unit(r.parties, '方'));
      setv('c-k3', unit(r.signals, '条'));
      setv('c-k4', unit(r.shared, '个'));
      const rows = ['A', 'B', 'C'].map((a) => [a, S.impact(spec, fe, a)]);
      const head = `<tr><th></th><th class="h-cl">分布式</th><th class="h-mid">域集中</th><th class="h-sd">中央+区域</th></tr>`;
      const row = (t, f) => `<tr><td>${t}</td>${rows.map(([, x]) => `<td class="num">${f(x)}</td>`).join('')}</tr>`;
      $('c-tab').innerHTML = head + row('要改的盒子', (x) => x.touched.length) + row('涉及几方', (x) => x.parties) + row('新增跨盒信号', (x) => x.signals) + row('同住的功能', (x) => x.shared);
      s.setTouched({ hosts: r.touched, used: r.used, eps: fe.eps });
      const fl = S.featureFlows(spec, fe, arch, graphs[arch]);
      const flows = [];
      fl.forEach((f) => {
        const pts = [];
        for (const leg of f.legs) for (const p of leg) { const v = B(p[0], p[1], p[2] + 22); if (!pts.length || pts[pts.length - 1].distanceTo(v) > 1e-4) pts.push(v); }
        flows.push({ pts, order: f.order, color: ARCH_COL[arch] });
      });
      s.setFlows(flows);
      A.setPins(r.touched.map((h) => { const e = spec.ecus[h]; return { t: e.cn, p: [e.pos[0], e.pos[1], e.pos[2] + 120], c: spec.domains[e.dom].color }; }));
      A.setLegend(`${key('#ffffff', '亮的盒子：要改')}${arch === 'C' ? key('#3ddc97', '微亮：只是被调用') : ''}${key(ARCH_COL[arch], '细线：信号路径')}`);
    };
    $('c-pick').addEventListener('click', (e) => {
      const b = e.target.closest('.pick'); if (!b) return;
      fe = spec.features.find((f) => f.id === b.dataset.id);
      [...$('c-pick').children].forEach((x) => x.setAttribute('aria-pressed', x === b));
      paint();
    });
    bindSeg('c-arch', (a) => { arch = a; paint(); });
    s.setShell('xray');
    paint();
    return {};
  },
};

// ---------------------------------------------------------- 第 4 章
function drawBoard(A, st) {
  const el = A.board, W = el.clientWidth, H = el.clientHeight;
  if (!W || !H) return;
  const small = W < 620;
  const T0 = -48, T1 = 36, pl = small ? 14 : 34, pr = small ? 14 : 34;
  const top = small ? 74 : 104, bot = H - (small ? 24 : 34);
  const X = (t) => pl + (t - T0) / (T1 - T0) * (W - pl - pr);
  const rowH = (bot - top) / 2;
  const ya = top + 16, yb = top + rowH - 26, ya2 = top + rowH + 16, yb2 = bot - 14;
  const fs = small ? 10.5 : 12.5;
  const cl = 'var(--cl)', sd = 'var(--sd)', mu = 'var(--muted)', fg = 'var(--fg)';
  const txt = (x, y, t, c = fg, a = 'middle', w = 400, f = fs) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${a}" font-size="${f}" font-weight="${w}" style="fill:${c}">${t}</text>`;
  const line = (x0, y0, x1, y1, c, w = 1, d = '') => `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${c}" stroke-width="${w}" ${d ? `stroke-dasharray="${d}"` : ''}/>`;
  let h = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="经典研发的大 V 和软件定义的小 V 串，时间轴上标出需求提出和上车的时刻">`;
  // 时间轴
  for (const t of [-48, -36, -24, -12, 0, 12, 24, 36]) {
    h += line(X(t), top, X(t), bot, t === 0 ? '#5a7290' : '#1d2d45', 1, t === 0 ? '4 4' : '');
    h += txt(X(t), bot + (small ? 15 : 19), t === 0 ? 'SOP' : `${t > 0 ? '+' : ''}${t}`, t === 0 ? fg : mu, 'middle', t === 0 ? 700 : 400);
  }
  if (!small) h += txt(W - pr, bot + 19 + 0, '', mu, 'end');
  // 经典：一个大 V
  const vx0 = X(-48), vx1 = X(-24), vx2 = X(0);
  h += txt(pl, ya - 2, '经典模式', cl, 'start', 700, fs + 1.5);
  h += `<path d="M${vx0} ${ya + 12} L${vx1} ${yb} L${vx2} ${ya}" fill="none" stroke="${cl}" stroke-width="3" stroke-linejoin="round"/>`;
  if (!small) {
    const L = ['需求', '系统设计', '部件规格', '供应商开发'], R = ['部件测试', '系统集成', '整车验证'];
    L.forEach((t, i) => { const u = (i + .6) / 4.2; const x = vx0 + (vx1 - vx0) * u, y = ya + 12 + (yb - ya - 12) * u; h += `<circle cx="${x}" cy="${y}" r="3" fill="${cl}"/>` + txt(x + 9, y + 4, t, fg, 'start'); });
    R.forEach((t, i) => { const u = (i + .7) / 3.4; const x = vx1 + (vx2 - vx1) * u, y = yb + (ya - yb) * u; h += `<circle cx="${x}" cy="${y}" r="3" fill="${cl}"/>` + txt(x + 9, y + 5, t, fg, 'start'); });
  }
  h += line(vx2, ya, X(T1), ya, cl, 3);
  for (const t of [12, 24, 36]) { h += line(X(t), ya - 7, X(t), ya + 7, cl, 3); h += txt(X(t), ya + 22, '年改', cl, t === 36 ? 'end' : 'middle'); }
  const xf = X(-st.freeze);
  h += line(xf, ya - 12, xf, ya + 30, '#fff', 1.4, '3 3') + txt(xf, ya - 18, '软件冻结', fg, 'middle', 500);
  // 软件定义：硬件 V + 软件小 V 串
  h += txt(pl, ya2 - 2, '软件定义', sd, 'start', 700, fs + 1.5);
  const hx0 = X(-36), hx1 = X(-18), hx2 = X(0);
  h += `<path d="M${hx0} ${ya2 + 14} L${hx1} ${yb2} L${hx2} ${ya2 + 14}" fill="none" stroke="#5a7290" stroke-width="2.4" stroke-linejoin="round"/>`;
  h += txt(hx1, yb2 - 34, '硬件仍走 V', mu, 'middle', 500);
  const trainY = ya2 + 18, dip = small ? 8 : 12;
  let d = '';
  for (let t = -30; t < T1; t += st.cadence) { const x0 = X(t), x1 = X(Math.min(t + st.cadence, T1)); d += `M${x0.toFixed(1)} ${trainY} L${((x0 + x1) / 2).toFixed(1)} ${trainY + dip} L${x1.toFixed(1)} ${trainY}`; }
  h += `<path d="${d}" fill="none" stroke="${sd}" stroke-width="1.8"/>`;
  if (!small) h += txt(X(-27), trainY + dip + 18, '软件小 V：持续集成，定期发布', sd, 'start');
  // 车队数据回流
  const fy = trainY + dip + (small ? 40 : 62), fx0 = X(T1 - 3), fx1 = X(5);
  h += `<path d="M${fx0} ${trainY + dip + 6} C${fx0} ${fy + 8},${fx1} ${fy + 8},${fx1} ${trainY + dip + 6}" fill="none" stroke="${sd}" stroke-width="1.4" stroke-dasharray="5 4"/>`;
  h += `<path d="M${fx1 - 5} ${trainY + dip + 13} L${fx1} ${trainY + dip + 5} L${fx1 + 5} ${trainY + dip + 13}" fill="none" stroke="${sd}" stroke-width="1.4"/>`;
  h += txt((fx0 + fx1) / 2, fy + 20, '车队数据回到下一轮', sd);
  // 需求和交付
  const xr = X(clamp(st.t, T0, T1));
  h += line(xr, top - 2, xr, bot, '#fff', 1.6);
  const lab = st.t > 18 ? 'end' : st.t < -38 ? 'start' : 'middle';
  h += txt(xr + (lab === 'end' ? -5 : lab === 'start' ? 5 : 0), top - 8, '需求提出', fg, lab, 600);
  const dot = (t, y, c) => {
    const inside = t <= T1;
    const x = X(Math.min(t, T1));
    const wait = t - st.t;
    const tag = `等 ${wait.toFixed(1).replace('.0', '')} 月`;
    const end = x > W - 60;
    return `<path d="M${xr} ${y} L${x} ${y}" stroke="${c}" stroke-width="2.4" stroke-dasharray="${inside ? '' : '4 3'}"/><circle cx="${x}" cy="${y}" r="6.5" fill="${c}" stroke="#fff" stroke-width="1.6"/>` + txt(x + (end ? -10 : 0), y - 13, tag, c, end ? 'end' : 'middle', 700);
  };
  h += dot(st.cAt, ya, cl) + dot(st.sAt, ya2 + 18, sd);
  h += '</svg>';
  el.innerHTML = h;
}

const cadence = {
  id: 'cadence', noArch: true, nav: '研发节奏', view: 'home',
  title: 'V 模型还在，软件从上面拆了下来',
  lead: '上排是经典流程：一个大 V 走到 SOP，软件跟着冻结，之后只有年改。下排的硬件还走 V，软件变成一串小 V，一直跑到 SOP 之后。拖动滑块，看一个需求什么时候能上车。',
  body: () => `
    <p class="seglab">这个需求是</p>
    ${seg('d-kind', [['comfort', '舒适'], ['adas', '智驾'], ['safety', '安全相关'], ['hw', '要新硬件']], 'comfort')}
    ${ctl('d-t', '提出时间', -36, 36, 1, 6)}
    <div class="kpis">${kpi('d-k1', '经典：等多久')}${kpi('d-k2', '软件定义：等多久')}${kpi('d-k3', '已售车能收到')}</div>
    ${plot('d-p', 190, '<b>等待时间</b>随提出时刻的变化（月，横轴 0 = SOP）')}
    ${ctl('d-fr', '软件冻结提前', 3, 12, 1, 6)}
    ${ctl('d-ca', '发布节奏', .5, 6, .5, 1)}
    ${ctl('d-au', '回归自动化率', 0, 100, 5, 70)}
    <div class="btns">${btn('d-pre', '硬件已预埋', false)}</div>`,
  notes: () => `
    ${note('经典流程为什么要冻结', 'a', `<p>样件、模具、认证、产线刷写，都要对着一个确定的版本。软件又长在供应商的盒子里，晚改一次要走变更单，牵连多家。冻结是控制风险的办法。从曲线上能看到它的代价：错过冻结线的需求，要等到下一次年改，而且已售车拿不到。</p>`)}
    ${note('V 留下了什么，换掉了什么', 'b', `<p>Elektrobit 的说法很清楚：V 模型仍然有效，需求追溯、ISO 26262、分层验证都还在；变的是从车型项目转向可复用的平台，从 SOP 前验证一次转向全生命周期验证。他们强调的是持续集成和持续验证，<b>安全软件并不做持续部署</b>${rf('vmodel')}。</p>`)}
    ${note('快多少，要拆开看', 'b', `<p>McKinsey 2025 年的估算：中国新能源车企从概念到上市约 24 个月，其他车企通常 40–50 个月以上。可缩短的时间里，软硬解耦占 3–10 个月，虚拟和自动化测试占 9–11 个月，其余来自精简产品、垂直整合、模具和决策方式${rf('mck')}。所以<b>软件只解释一部分速度</b>。另一篇专栏提到规格书的差别：传统车企给供应商约 2 万条，中国新势力约 600 条${rf('wards')}。</p>`)}
    ${note('什么时候失效', ['b', 'c'], `<ul>
      <li>把“回归自动化率”拉到 0：发布节奏再快也卡在人工验证上。频繁发布的前提是测试便宜。</li>
      <li>切到“安全相关”：优势还在，但缩水很多，证据要一轮轮做。</li>
      <li>切到“要新硬件”：两条线重合。除非打开“硬件已预埋”。</li>
      <li>物理耐久压缩不了。中国监管方在担心开发过快，一项拟议规定把新能源车强制路试里程加倍到 3 万公里${rf('slow')}。</li>
    </ul>`)}
    ${note('这个模型的参数', 'c', `<p>经典：舒适 9 个月、智驾 14、安全 18、新硬件 24 走完变更，赶不上冻结线就等下一次年改。软件定义：验证时间 = 必做部分 + 手工部分 ×（1 − 自动化率），等下一班发布，再灰度 1 个月。这些数字是我选的，用来显示曲线的形状，换成别的数字形状不变。</p>`)}`,
  enter(A) {
    const s = A.stage;
    let kind = 'comfort', t = 6, freeze = 6, cad = 1, auto = .7, pre = false;
    s.setScene('car');
    A.showBoard(true);
    const plotC = new Plot($('d-p'), { l: 34, r: 10, t: 10, b: 20 });
    const paint = () => {
      const opt = { freeze, cadence: cad, auto, preinstalled: pre };
      const c = S.classicDelivery(t, kind, opt), d = S.sdvDelivery(t, kind, opt);
      setv('d-k1', unit(c.at - t, '月'));
      setv('d-k2', unit((d.at - t).toFixed(1).replace('.0', ''), '月'));
      setv('d-k3', d.at === 0 ? '出厂就有' : d.sold ? '能' : '不能');
      const k3 = $('d-k3'); if (k3) k3.style.fontSize = d.at === 0 ? '16px' : '';
      drawBoard(A, { t, freeze, cadence: cad, cAt: c.at, sAt: d.at });
      const cv = S.deliveryCurve(kind, opt);
      const ymax = Math.max(...cv.classic, ...cv.sdv) * 1.08;
      plotC.clear().scale(-36, 36, 0, ymax).axes({ xt: [-36, -24, -12, 0, 12, 24, 36], yt: niceTicks(0, ymax, 4), xl: '月', yl: '等待（月）' });
      plotC.line(cv.x, cv.classic, ARCH_COL.A, 1.7).line(cv.x, cv.sdv, ARCH_COL.C, 1.9);
      plotC.vline(0, C.axis).dot(t, c.at - t, ARCH_COL.A).dot(t, d.at - t, ARCH_COL.C);
      plotC.hover = { x: cv.x, xf: (v) => `第 ${v.toFixed(0)} 月提出`, series: [{ n: '经典', c: ARCH_COL.A, y: cv.classic, f: (v) => `${v.toFixed(1)} 月` }, { n: '软件定义', c: ARCH_COL.C, y: cv.sdv, f: (v) => `${v.toFixed(1)} 月` }] };
      const ind = (kind === 'hw' && !pre) ? '两条线重合：软件再快也要等硬件' : '';
      A.setSlow(ind);
    };
    bindSeg('d-kind', (v) => { kind = v; paint(); });
    bind('d-t', (v) => { t = v; paint(); }, (v) => (v === 0 ? 'SOP' : `${v > 0 ? '+' : ''}${v} 月`));
    bind('d-fr', (v) => { freeze = v; paint(); }, (v) => `${v} 月`);
    bind('d-ca', (v) => { cad = v; paint(); }, (v) => `${v} 月`);
    bind('d-au', (v) => { auto = v / 100; paint(); }, (v) => `${v}%`);
    $('d-pre').onclick = () => { pre = !pre; $('d-pre').setAttribute('aria-pressed', pre); paint(); };
    const onR = () => paint();
    window.addEventListener('resize', onR);
    return { leave() { window.removeEventListener('resize', onR); A.showBoard(false); } };
  },
};

// ---------------------------------------------------------- 第 5 章
const LG_FLEET = `${key('#46566b', '旧版')}${key('#4cc9f0', '新版')}${key('#ffb347', '失败，已自动回滚')}${key('#ff4d4f', '失败，趴窝')}`;
const fleet = {
  id: 'fleet', noArch: true, nav: 'SOP 之后', view: 'fleet',
  title: 'SOP 之后，车还在更新',
  lead: '这 240 辆车代表一个车队。先给这版更新埋一个 bug，再选推送方式，看出事时能拦住多少。最后一项是经典模式的做法：等车主回店刷写。',
  body: () => `
    ${seg('f-mode', [['bigbang', '一次全推'], ['staged', '分批灰度'], ['recall', '经典：回店']], 'staged')}
    ${ctl('f-p', '失败率', 0, 10, .5, 3)}
    ${ctl('f-d', '发现到叫停', 2, 48, 2, 12)}
    <div class="btns">${btn('f-ab', 'A/B 分区回滚', true)}${btn('f-go', '开始')}</div>
    <div class="bar"><i id="f-bar"></i></div>
    <div class="kpis">${kpi('f-k0', '时间')}${kpi('f-k1', '已装新版')}${kpi('f-k2', '回滚')}${kpi('f-k3', '趴窝')}${kpi('f-k4', '被拦下')}</div>
    <div class="tw"><table class="cmp" id="f-tab"></table></div>`,
  notes: () => `
    ${note('灰度的原理', 'b', `<p>用少量车先试，换到“这版有没有问题”的信息，再决定要不要继续。它依赖两个假设：问题能被监控看到，而且在小批次里就会暴露。只在冬天、某种配置、某个地区才触发的 bug，小批次看不出来。把失败率调低试试，有时前几批一辆都没坏。</p>`)}
    ${note('A/B 分区', 'b', `<p>存两份系统，新版写到备用区，启动失败就切回旧的。这要多一倍存储，也只解决“装坏了”。装上能跑、但行为错了的版本，它回不来。跨多个盒子的更新还要一起回滚，版本不能错配。</p>`)}
    ${note('真实翻车：Jeep，2025 年 10 月', 'a', `<p>一次 OTA 后，美国约 24,238 辆、加拿大约 1,707 辆 Wrangler 4xe 可能进入跛行模式或无法运行，召回通告说动力系统可能无预警关闭，厂方表示未发现事故或伤亡。内部调查指向远程通信模块和混动控制处理器之间的间歇性通信故障，修复方式是再推一次软件${rf('jeep')}。同一篇文章还提到 Rivian、Lucid 有过类似报告。OTA 让修复变快，也让一次错误同时到达所有车。</p>`)}
    ${note('法规已经把这件事管起来了', 'a', `<ul>
      <li><b>UN R155 / R156：</b>车企要有经过审核的网络安全管理体系（CSMS）和软件更新管理体系（SUMS）。软件版本和型式认证绑定，用 RXSWIN 追踪${rf('r156')}${rf('r155')}，更新失败要有恢复手段${rf('r155')}。</li>
      <li><b>日本：</b>2020 年 11 月 23 日起，用通信改变性能或增加功能的软件更新需要“特定改造等”许可${rf('mlit')}。网络安全和软件更新基准：支持 OTA 的新型车 2022 年 7 月起，继续生产车 2024 年 7 月起；不支持 OTA 的新型车 2024 年 1 月起，继续生产车 2026 年 5 月起${rf('jpdate')}。</li>
      <li><b>中国：</b>GB 44495、GB 44496 自 2026 年 1 月 1 日起实施${rf('gb')}。2026 年 9 月又发布 GB/T 48140—2026，专家解读里提到要防止靠后续推送回避质量缺陷${rf('gbt')}。</li>
    </ul>`)}
    ${note('这个模型', 'c', `<p>分批比例 1% → 10% → 50% → 100%，每批观察 24 小时，车辆平均 8 小时内装上；累计 2 辆失败触发调查，再过“发现到叫停”的时间停推。回店模式假设每月 10% 的剩余车到店，这是我选的数字，实际完成率差别很大。</p>`)}`,
  enter(A) {
    const s = A.stage;
    s.setScene('fleet');
    A.setLegend(LG_FLEET);
    const N = s.fleetN, st = new Uint8Array(N);
    let mode = 'staged', pFail = .03, detect = 12, ab = true, sim = null, t = 0, tMax = 1, playing = false, fix = null;
    const unitOf = () => (mode === 'recall' ? '月' : '小时');
    const rebuild = () => {
      if (mode === 'recall') { fix = S.recall(N, .1); tMax = 24; sim = null; } else {
        sim = S.rollout({ N, mode, pFail, detect, ab });
        tMax = Math.max(sim.tEnd, Math.min(sim.haltAt, sim.tEnd + 30)) * 1.04 + 2;
      }
      t = 0; playing = false; $('f-go').textContent = '开始';
      render(); table();
    };
    const render = () => {
      let a = 0, b = 0, c = 0;
      if (mode === 'recall') { for (let i = 0; i < N; i++) { st[i] = t >= fix[i] ? S.CAR.DONE : S.CAR.OLD; if (st[i] === S.CAR.DONE) a++; } } else {
        for (let i = 0; i < N; i++) {
          const k = S.carState(sim.cars[i], t, ab); st[i] = k;
          if (k === S.CAR.DONE) a++; else if (k === S.CAR.ROLLED) b++; else if (k === S.CAR.DEAD) c++;
        }
      }
      s.setFleet(st);
      const halted = sim && t >= sim.haltAt;
      setv('f-k0', mode === 'recall' ? unit(t.toFixed(0), '月') : unit(t < 48 ? t.toFixed(0) : (t / 24).toFixed(1), t < 48 ? '小时' : '天'));
      setv('f-k1', unit(a, '辆')); setv('f-k2', unit(b, '辆')); setv('f-k3', unit(c, '辆'));
      setv('f-k4', mode === 'recall' ? '–' : unit(halted ? sim.untouched : 0, '辆'));
      $('f-bar').style.width = `${clamp(t / tMax, 0, 1) * 100}%`;
      A.setSlow(halted ? '已叫停，后面的批次不再推送' : '');
    };
    const table = () => {
      const run = (m) => S.rollout({ N, mode: m, pFail, detect, ab });
      const x = run('bigbang'), y = run('staged');
      const cell = (r) => `<td class="num">${ab ? r.rolled : r.dead}</td><td class="num">${r.done}</td><td class="num">${r.untouched}</td>`;
      $('f-tab').innerHTML = `<tr><th></th><th>${ab ? '回滚' : '趴窝'}</th><th>装上新版</th><th>被拦下</th></tr><tr><td>一次全推</td>${cell(x)}</tr><tr><td>分批灰度</td>${cell(y)}</tr>`;
    };
    bindSeg('f-mode', (v) => { mode = v; rebuild(); });
    bind('f-p', (v) => { pFail = v / 100; rebuild(); }, (v) => `${v}%`);
    bind('f-d', (v) => { detect = v; rebuild(); }, (v) => `${v} 小时`);
    $('f-ab').onclick = () => { ab = !ab; $('f-ab').setAttribute('aria-pressed', ab); rebuild(); };
    $('f-go').onclick = () => {
      if (t >= tMax - 1e-6) t = 0;
      playing = !playing; $('f-go').textContent = playing ? '暂停' : t > 0 ? '继续' : '开始';
    };
    rebuild();
    return {
      tick(dt) {
        if (!playing) return;
        t = Math.min(tMax, t + tMax / 9 * dt);
        if (t >= tMax) { playing = false; $('f-go').textContent = '再看一次'; }
        render();
      },
      leave() { A.setSlow(''); },
    };
  },
};

// ---------------------------------------------------------- 第 6 章
const PARTS = {
  soc: ['应用 SoC', '多核 CPU + GPU + NPU，跑智驾感知和座舱。性能高，但实时性和功能安全都不是它的强项。'],
  mcu: ['安全 MCU', '锁步核，常见到 ASIL D。车辆逻辑和安全监控放这里，SoC 挂了它还要能把车带到安全状态。'],
  switch: ['以太网交换', '把四个区控、摄像头之外的数据接进来，还要按时间敏感网络的规则保证关键流量。'],
  ram: ['内存', 'SoC 上所有分区共用，这也是隔离最难的地方：时间片分开了，内存带宽还是抢的。'],
  pmic: ['电源管理', '多路供电和电压监控，一路出错要能单独切断。'],
};
const decouple = {
  id: 'decouple', noArch: true, nav: '软硬解耦', view: 'detail',
  title: '软硬解耦难在哪',
  lead: '左边是一个经典 ECU，一颗 MCU 只干一件事。右边是中央计算，几十毫秒一帧的界面和几毫秒必须算完的控制要同住。下面这个实验把它们放到一起。',
  body: () => `
    <div class="btns" id="p-parts">${Object.entries(PARTS).map(([k, v]) => `<button class="btn" type="button" data-k="${k}" aria-pressed="false">${v[0]}</button>`).join('')}</div>
    <div class="card quiet" id="p-card"><h4>点上面的芯片</h4><p>三维模型里对应的零件会亮起来。</p></div>
    <p class="seglab">控制环（周期 5 ms，计算 1 ms）放在哪</p>
    ${seg('p-s', [['shared', '共享核', '同一系统'], ['part', '时间分区', '虚拟化'], ['mcu', '独立 MCU', '物理隔开']], 'shared')}
    ${ctl('p-l', '大负载占用', 0, 95, 5, 60)}
    <div class="kpis">${kpi('p-k1', '最坏响应')}${kpi('p-k2', '超时比例')}${kpi('p-k3', '平均响应')}</div>
    ${plot('p-p', 160, '<b>每一拍控制的响应时间</b>（ms），虚线是 5 ms 截止线')}
    <div class="tw"><table class="cmp" id="p-tab"></table></div>`,
  notes: () => `
    ${note('这个实验说明什么', 'c', `<p>共享核时，控制任务优先级再高，碰上驱动和内核里的不可抢占段也得等，负载越高，撞上的概率越大。平均值很好看，超时全藏在尾巴里，而控制系统怕的就是尾巴。时间分区把抖动压住了，但缓存和内存总线还共享，计算时间会被拖长。独立 MCU 最稳，这也是中央计算里常留一颗安全 MCU 的原因。</p><p>共享核这一档用的是没做实时配置的通用系统。PREEMPT_RT 这类配置能把延迟压低很多，但这个模型没有算它。</p>`)}
    ${note('“互不干扰”是硬要求', 'a', `<p>ISO 26262 允许不同安全等级的软件同处一颗芯片，前提是能证明低等级的部分不会干扰高等级的部分（freedom from interference），时间、内存、通信三方面都要证明。这就是虚拟化和分区的工作，也是集中化最贵的一笔隐性成本。</p>`)}
    ${note('从信号到服务', 'b', `<div class="tw"><table class="cmp">
      <tr><th></th><th class="h-cl">信号式（CAN）</th><th class="h-sd">服务式（SOME/IP、DDS）</th></tr>
      <tr><td>定义时机</td><td>编译期，通信矩阵写死</td><td>运行期，服务发现</td></tr>
      <tr><td>多一个接收方</td><td>改矩阵、重新生成、刷写相关盒子</td><td>订阅一下，要有权限和接口版本</td></tr>
      <tr><td>好处</td><td>确定、好验证、成熟</td><td>灵活、能独立升级</td></tr>
      <tr><td>代价</td><td>改一点动全身</td><td>时序更难证明，接口要长期兼容</td></tr>
    </table></div><p>对应到标准上：AUTOSAR Classic 静态配置、硬实时，跑在安全 MCU 上；Adaptive 基于 POSIX，用服务通信，按服务升级。区控常把两者混用，Classic 管硬实时，Adaptive 管通信和诊断${rf('autosar')}。</p>`)}
    ${note('解耦有一笔长期的账', 'd', `<p>我的看法：汽车服役十几年，消费级 SoC 的生命周期短得多。软硬解耦解决了“软件不用等硬件”，但没解决“十年后的软件还跑得动吗”。算力要预留，接口要兼容好多代，老车型迟早要分叉。这是软件定义比经典模式多出来的负担，目前行业还没有足够长的实测经验。</p>`)}`,
  enter(A) {
    const s = A.stage;
    s.setScene('detail'); s.setDetailOpen(1);
    let strat = 'shared', load = .6;
    const dx = A.spec.detail_x;
    A.setPins([
      { t: '经典 ECU', p: [dx - 900, 0, 330], c: '#ff9d3c' },
      { t: '中央计算', p: [dx + 560, 560, 330], c: '#4cc9f0' },
    ]);
    const plotP = new Plot($('p-p'), { l: 30, r: 10, t: 8, b: 18 });
    const paint = () => {
      const r = S.schedule({ strategy: strat, load });
      setv('p-k1', unit(r.maxR.toFixed(1), 'ms'));
      setv('p-k2', unit(r.missPct.toFixed(1), '%'));
      setv('p-k3', unit(r.avg.toFixed(2), 'ms'));
      const n = 200, xs = Array.from({ length: n }, (_, i) => i), ys = r.res.slice(0, n);
      const ymax = Math.max(7, ...ys) * 1.1;
      plotP.clear().scale(0, n - 1, 0, ymax).axes({ xt: [0, 50, 100, 150, 199], yt: niceTicks(0, ymax, 4), xl: '第几拍' });
      plotP.hline(5, C.warn, [4, 3], 1.2);
      plotP.line(xs, ys, ARCH_COL.C, 1.3);
      plotP.hover = { x: xs, xf: (v) => `第 ${v} 拍`, series: [{ n: '响应', c: ARCH_COL.C, y: ys, f: (v) => `${v.toFixed(2)} ms` }] };
      const rows = Object.entries(S.SCHED).map(([k, v]) => { const x = S.schedule({ strategy: k, load }); return `<tr><td>${v.cn}</td><td class="num">${x.maxR.toFixed(1)} ms</td><td class="num">${x.missPct.toFixed(1)}%</td></tr>`; }).join('');
      $('p-tab').innerHTML = `<tr><th>同样负载下</th><th>最坏响应</th><th>超时</th></tr>${rows}`;
    };
    bindSeg('p-s', (v) => { strat = v; paint(); });
    bind('p-l', (v) => { load = v / 100; paint(); }, (v) => `${v}%`);
    $('p-parts').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const k = b.dataset.k;
      [...$('p-parts').children].forEach((x) => x.setAttribute('aria-pressed', x === b));
      s.highlightDetail(k);
      $('p-card').innerHTML = `<h4>${PARTS[k][0]}</h4><p>${PARTS[k][1]}</p>`;
      $('p-card').className = 'card';
    });
    return { leave() { s.setDetailOpen(0); s.highlightDetail(null); } };
  },
};

// ---------------------------------------------------------- 第 7 章
const SUP_PAL = ['#ff9d3c', '#ffb86b', '#e07a5f', '#f2cc8f', '#c08552', '#ff6b6b', '#d4a5a5', '#ffd166', '#b5838d', '#e9c46a', '#f4a261', '#cdb4a0', '#e5989b', '#ddb892', '#ffcb77', '#c9ada7'];
const money = {
  id: 'money', nav: '组织和钱', view: 'xray',
  title: '架构背后是组织',
  lead: '盒子现在按<b>谁负责这块软件</b>上色。暖色是一家家供应商，青色是整车厂自己。架构变了，分工和账都跟着变。',
  body: () => `
    ${seg('m-arch', ARCH_ITEMS3, 'A', ARCH_COL)}
    <div class="kpis">${kpi('m-k1', '负责软件的')}${kpi('m-k2', '回本年份')}${kpi('m-k3', '第 15 年累计')}</div>
    ${plot('m-p', 180, '<b>相比继续走经典模式的累计现金流</b>（亿元）')}
    ${ctl('m-v', '年销量', 10, 500, 10, 150)}
    ${ctl('m-i', '平台投入', 10, 200, 5, 60)}
    ${ctl('m-t', '软件团队', 2, 40, 1, 12)}
    ${ctl('m-b', '单车硬件', -1000, 2000, 50, 300)}
    ${ctl('m-s', '单车节省', 0, 1500, 50, 400)}
    ${ctl('m-a', '单车年收入', 0, 1000, 25, 200)}`,
  notes: () => `
    ${note('康威定律：架构会长成组织的样子', 'b', `<p>经典架构的盒子边界，就是采购合同的边界，每个盒子一家供应商、一份规格书。想把逻辑收到中央，就要有人负责中央，这个人只能是整车厂。所以转型的难点常常在组织：谁写、谁测、谁担责、供应商的利益怎么办。IoT Analytics 的调研里，18% 的车企把内部技能不足列为主要挑战${rf('iota')}。</p>`)}
    ${note('账的形状变了', 'c', `<p>经典模式的成本大头是单车物料，卖一辆算一辆。软件定义把一部分成本变成固定成本：平台投入和常年养着的团队，不随销量变。所以<b>量</b>决定一切：同样一笔投入，年销 500 万辆摊得开，年销 30 万辆摊不开。把年销量拉到 30 万试试。</p>`)}
    ${note('软件收入别算太满', ['b', 'd'], `<p>Stellantis 曾预计到 2030 年软件订阅等模式每年带来 200 亿欧元${rf('iota')}，这是公司目标，不是结果。我认为更稳的收益在别处：线束和装配节省、召回变成推送、开发提速。这些也是模型里“单车节省”的含义。把“单车年收入”拉到 0，再调高单车节省，看要省多少才回得了本。</p>`)}
    ${note('这个模型', 'c', `<p>现金流 = −平台投入（前 3 年摊销）− 软件团队 + 年销量 ×（单车节省 − 单车硬件增量）+ 在役车队 × 单车年收入。第 3 年开始卖车，车在役 10 年。默认值全是我选的，只为显示规模效应，不代表任何车企。开发提速带来的销量和定价收益没有算进去。</p>`)}`,
  enter(A) {
    const s = A.stage, spec = A.spec;
    const supIds = Object.keys(spec.suppliers).filter((k) => k !== 'OEM');
    const map = { OEM: '#4cc9f0' };
    supIds.forEach((k, i) => { map[k] = SUP_PAL[i % SUP_PAL.length]; });
    s.setSupplierColors(map); s.setColorMode('supplier'); s.setShell('xray');
    const v = { vol: 150, invest: 60, team: 12, bom: 300, save: 400, arpu: 200 };
    const plotM = new Plot($('m-p'), { l: 42, r: 10, t: 10, b: 20 });
    const arch = (a) => {
      A.arch(a);
      const o = S.owners(spec, a), sup = o.filter((k) => k !== 'OEM').length;
      setv('m-k1', unit(sup + (o.includes('OEM') ? '+整车厂' : ''), o.includes('OEM') ? '' : '家'));
      A.setLegend(`${key('#ff9d3c', `暖色：${sup} 家供应商`)}${key('#4cc9f0', '青色：整车厂')}`);
    };
    bindSeg('m-arch', arch); arch('A');
    const paint = () => {
      const r = S.cash({ ...v, years: 15 });
      setv('m-k2', r.payback === null ? '15 年内不回本' : unit(`第 ${r.payback}`, '年'));
      const e = $('m-k2'); if (e) e.style.fontSize = r.payback === null ? '14px' : '';
      setv('m-k3', unit(Math.round(r.end), '亿'));
      const mn = Math.min(...r.cum, 0), mx = Math.max(...r.cum, 0), pad = (mx - mn) * .1 || 1;
      plotM.clear().scale(0, 15, mn - pad, mx + pad).axes({ xt: [0, 3, 6, 9, 12, 15], yt: niceTicks(mn - pad, mx + pad, 4), yf: (x) => x.toFixed(0), xl: '年', zero: true });
      plotM.vline(3, C.axis);
      plotM.line(r.x, r.cum, ARCH_COL.C, 2);
      if (r.payback !== null) plotM.dot(r.payback, r.cum[r.payback], ARCH_COL.C);
      plotM.label(3, mx + pad, '开始卖车', C.text, { dx: 5, dy: 10 });
      plotM.hover = { x: r.x, xf: (y) => `第 ${y} 年`, series: [{ n: '累计', c: ARCH_COL.C, y: r.cum, f: (x) => `${x.toFixed(0)} 亿` }] };
    };
    bind('m-v', (x) => { v.vol = x; paint(); }, (x) => `${x} 万辆`);
    bind('m-i', (x) => { v.invest = x; paint(); }, (x) => `${x} 亿`);
    bind('m-t', (x) => { v.team = x; paint(); }, (x) => `${x} 亿/年`);
    bind('m-b', (x) => { v.bom = x; paint(); }, (x) => `${x > 0 ? '+' : ''}${x} 元`);
    bind('m-s', (x) => { v.save = x; paint(); }, (x) => `${x} 元`);
    bind('m-a', (x) => { v.arpu = x; paint(); }, (x) => `${x} 元`);
    return {};
  },
};

// ---------------------------------------------------------- 第 8 章
const ROUTES = {
  grad: { cn: '渐进融合', arch: 'B', who: '多数传统车企的起点', tag: '最主流的路径',
    how: '先把座舱、智驾收成域控，再跨域融合，最后走到中央 + 区域。老平台、老供应商、老产线都能接着用。',
    gain: '风险分摊，现金流压力小，组织有时间学。',
    cost: '要长期同时维护几代架构，新旧接口叠在一起。迁移越慢，被快的对手甩得越远。',
    fail: '如果组织没跟着变，域控只是换了个大盒子，软件还是一家家供应商的黑盒。' },
  clean: { cn: '一步到位', arch: 'C', who: 'Tesla、Rivian，以及一批中国新势力', tag: '',
    how: `新平台从零设计中央 + 区域，软件大量自研。Rivian 第二代的电气架构由内部硬件和软件团队完成${rf('rivian')}。`,
    gain: '架构最干净，接口自己说了算，迭代最快。',
    cost: '一次性投入大，人才难招，没有老车型的销量托底。',
    fail: `软件进度直接决定上市时间。大众自有软件部门 Cariad 的延误影响过车型上市${rf('iota')}，这正是把自研赌在一个部门上的风险。` },
  buy: { cn: '买平台或合资', arch: 'C', who: '大众与 Rivian，部分车企与科技公司', tag: '',
    how: `大众承诺投入最多 58 亿美元和 Rivian 成立合资公司${rf('iota')}，把现成的区域架构用到自家车上。`,
    gain: '跳过最难的几年，直接用验证过的架构。',
    cost: '差异化和主导权要让出一部分，两家组织和节奏要对齐。',
    fail: `架构要适配自家几十款车型。2025 年底的报道称 ID.Every1 计划 2027 年成为首款${rf('rvtech')}；2026 年 3 月冬测结束，大众称架构在严寒下运行可靠，同时也有报道质疑进展没有宣传的那么顺${rf('winter')}。真正的答案要等量产。` },
};
const routes = {
  id: 'routes', nav: '三条路', view: 'xray',
  title: '三条路，怎么选',
  lead: '方向上行业基本一致：约八成车企已开始往区域架构迁移，另有 11% 有明确计划。分歧在怎么走过去。',
  body: () => `
    ${seg('r-s', [['grad', '渐进融合', '主流'], ['clean', '一步到位'], ['buy', '买平台']], 'grad')}
    <div class="card" id="r-card"></div>
    <div class="tw"><table class="cmp" id="r-tab"></table></div>`,
  notes: () => `
    ${note('方向和路径的数据', 'b', `<p>IoT Analytics 的调研：超过九成车企承诺走区域架构，约 80% 已开始迁移，另有 11% 有明确计划。领先者是 Tesla、Rivian、NIO、BYD，部分传统车企开发新车比它们慢一年以上${rf('iota')}。传统车企也有新平台直接换架构的例子，比如宝马 iX3${rf('bmw')}。丰田选的是另一种渐进：新款 RAV4 上，语音、中控和 TSS 软件用 Arene 平台开发，官方没有说覆盖全车${rf('arene')}。所以“用上 SDV 平台”不等于“全车软件定义”。</p>`)}
    ${note('怎么选', 'd', `<p>我的判断：主要看三件事。年销量够不够摊固定成本，内部有没有能带架构的人，老平台还要养多久。量大、老平台多的车企走渐进最合理；新品牌没有包袱，可以一步到位；量不小但软件积累落后太多的，买平台比硬撑便宜。这是推测，要等 ID.Every1 这类车量产后才看得清。</p>`)}
    ${note('证据强弱一览', null, `<div class="tw"><table class="cmp">
      <tr><th>强度</th><th>结论</th></tr>
      <tr><td><span class="ev a">公认</span></td><td>分布式架构盒子多、跨域改动贵；V 模型和功能安全要求没有消失；硬实时控制留在边缘；OTA 受法规管理。</td></tr>
      <tr><td><span class="ev b">工程实践</span></td><td>中央 + 区域能减线束和 ECU（厂商报告，口径各不相同）；分批灰度和 A/B 分区；开发周期能明显缩短（归因是混合的）。</td></tr>
      <tr><td><span class="ev c">本页简化</span></td><td>线长、影响范围来自这辆教学车；等待时间、灰度、调度、现金流都是玩具模型，默认值是我选的。</td></tr>
      <tr><td><span class="ev d">我的推测</span></td><td>共享宿主的连带风险比少改几个盒子更决定成败；十年后的算力和兼容负担会成为新问题；软件收入兑现慢于预期。</td></tr>
    </table></div>`)}
    ${note('来源', null, `<ol class="sources">${RK.map((k) => `<li><a href="${REFS[k][1]}" target="_blank" rel="noopener">${REFS[k][0]}</a></li>`).join('')}</ol><p style="font-size:12.5px;color:var(--muted)">资料截至 2026 年 11 月。厂商和咨询公司的数字多是自报，口径不一。</p>`)}`,
  enter(A) {
    const s = A.stage;
    s.setShell('xray');
    const tab = () => {
      const rows = [['适合', 'who'], ['好处', 'gain'], ['代价', 'cost']];
      const heads = Object.values(ROUTES).map((r) => `<th>${r.cn}</th>`).join('');
      $('r-tab').innerHTML = `<tr><th></th>${heads}</tr>${rows.map(([t, k]) => `<tr><td>${t}</td>${Object.values(ROUTES).map((r) => `<td>${r[k]}</td>`).join('')}</tr>`).join('')}`;
    };
    const pick = (k) => {
      const r = ROUTES[k];
      A.arch(r.arch);
      $('r-card').innerHTML = `<h4>${r.cn}${r.tag ? `<span>${r.tag}</span>` : ''}</h4><p>${r.how}</p><p style="margin-top:6px"><b>可能翻车的地方：</b>${r.fail}</p>`;
      A.setLegend(`<span>这条路当前阶段的架构：${S.ARCH[r.arch].cn}</span>`);
    };
    bindSeg('r-s', pick);
    tab(); pick('grad');
    return {};
  },
};

export const CHAPTERS = [overview, nerve, change, cadence, fleet, decouple, money, routes];
