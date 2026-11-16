// 页面：时间轴、阶段讲解、核心筒循环、竖向流水图。
import P from '../../params.json';
import spec from '../../blender/out/spec.json';
import towerGlb from '../dist/tower.glb';
import zljGlb from '../dist/zaoloji.glb';
import machGlb from '../dist/machines.glb';
import { makeSchedule, stateAt, STEPS, TRADES, TRADE_NAME } from './core.js';
import { Stage } from './stage.js';

const sch = makeSchedule(P, spec);
const $ = (s) => document.querySelector(s);
const S = P.schedule;
const Q = P.platform;
const T = P.tower;

// ------------------------------------------------------------ 文案
// 每段末尾的〔〕是依据：资料 = 公开报道 / 论文 / 产品参数，推断 = 按资料比例推的，假设 = 本页定的
const PHASE = {
  site: {
    view: 'pit', color: '#7d7a70',
    text: () => `<p>先把工地圈起来：装配式围挡、大门、洗车槽，场地硬化，接水接电，搭项目部板房。这些叫“三通一平”和临建。</p>
      <p class="mach">现场：项目部板房、门卫、洗车台、五牌一图、钢筋加工棚、充电站陆续就位，管理人员的皮卡进进出出。</p>
      <p class="basis">〔常规做法〕</p>`,
  },
  dwall: {
    view: 'pit', color: '#8f8e88',
    text: () => `<p>还没开挖，先沿基坑一圈在地下“浇”出一道 1 m 厚的混凝土墙：成槽机挖一条深槽，槽里灌泥浆撑住土，放进钢筋笼，再从底下往上灌混凝土把泥浆挤出来。一幅一幅接成一圈，叫<b>地下连续墙</b>。</p>
      <p>它先当挡土挡水的围护墙，之后和里面的内衬墙一起当地下室外墙。顶上一圈是把各幅连成整体的冠梁。</p>
      <p class="mach">现场：<b>液压抓斗成槽机</b>沿基坑一幅幅抓槽（抓斗宽 2.8 m、厚 0.8 m），旁边的<b>履带吊</b>把钢筋笼竖着吊进槽里；塔楼底下一台<b>旋挖钻机</b>在打工程桩，打完的桩孔口留着钢护筒。渣土车把槽里的土运走，罐车来浇墙。</p>
      <p class="basis">〔常规做法；墙深 36 m、每幅 6 m 是假设〕</p>`,
  },
  excavate: {
    view: 'pit', color: '#7a6650',
    text: (st) => `<p>围护墙圈好了才往下挖。现在挖到 <b class="num">${(-st.pit.depth).toFixed(1)} m</b>。</p>
      <p>坑越深，外面的土把墙往里推得越厉害，所以挖到第一层就要加<b>内支撑</b>：沿墙一圈围檩，四个角用斜撑顶住。真实项目常有好几道支撑，这里只画了一道。</p>
      <p class="mach">现场：坑里两台 30 t 级挖机把土倒到坑边，北边坑沿上的<b>长臂挖机</b>（臂长约 20 m）一斗斗把土装进<b>纯电渣土车</b>，车装满就走，下一辆接着进。电动渣土车多是换电式，驾驶室后面那个箱子就是电池仓。挖土扬尘大，门口监测站测到 PM10 超标，基坑两边的<b>雾炮</b>会自动开。</p>
      <p class="basis">〔坑底 -20.6 m = 地下 4 层 + 1.6 m 底板，见参数表〕</p>`,
  },
  raft: {
    view: 'pit', color: '#5f5e5a',
    text: () => `<p>坑底浇<b>筏板</b>：塔楼底下 ${T.basement.raft_t} m 厚，其余 ${T.basement.raft_t_outer} m。整栋楼的重量最后都落到这块板上，再传给下面的桩和土。</p>
      <p>这么厚的混凝土叫“大体积混凝土”，一般连续浇几十个小时不停，免得出现冷缝；水泥水化发热，里外温差大会开裂，所以要预埋测温点、控制降温速度。</p>
      <p class="mach">现场：南边坑沿停着<b>混凝土泵车</b>，五节臂伸进坑里；罐车一辆接一辆把混凝土喂进泵车后面的料斗。</p>
      <p class="basis">〔超高层筏板常见 3 ~ 5 m：推断；连续浇筑和控温：常规做法〕</p>`,
  },
  basement: {
    view: 'pit', color: '#8a8a86',
    text: () => `<p>地下室从最底层往上做（<b>顺作法</b>）：每层先做墙和柱，再做顶板。核心筒和钢管柱也从筏板上开始往上长。</p>
      <p>地下室顶板做完以后，楼板就能接替内支撑顶住四周的墙，这时才把内支撑拆掉，叫<b>换撑</b>。看基坑里那圈支撑什么时候消失。</p>
      <p class="mach">现场：两台<b>动臂塔吊</b>已经立在核心筒的两个角筒格里（站在筏板上），把钢柱、钢筋吊进坑里；平板车把钢构件运到两个堆场。</p>
      <p class="basis">〔每层 ${S.basement_level} 天是假设〕</p>`,
  },
  low: {
    view: 'all', color: '#b8b3a6',
    text: () => `<p>地上头 ${S.low_floors} 层还没装造楼机，核心筒用常规模板一层层做，大约 ${S.low_cycle} 天一层。首层是大堂，层高 ${T.f1_height} m。</p>
      <p>先把这几层核心筒做出来，是为了给造楼机留出“抓手”：它的支点要挂在已经硬了的墙上。</p>
      <p class="mach">现场：从这里开始用<b>超高压地泵</b>：罐车把混凝土倒进地泵，地泵沿地面的泵管、再沿核心筒里竖着的泵管把混凝土一路打上去。</p>
      <p class="basis">〔${S.low_cycle} 天一层：普通爬模约 7 天一层（科技日报报道）〕</p>`,
  },
  install: {
    view: 'zlj', color: '#ff7a2f',
    text: () => `<p>在核心筒上组装<b>造楼机</b>（顶模集成平台）：先装墙上的附墙支座、油缸和 12 根支撑立柱，再拼贝雷片钢平台，然后挂架、大钢模、防护网，最后上布料机和集装箱。</p>
      <p>新一代平台像搭积木一样用标准模块拼，资料里安装约 20 天。</p>
      <p class="mach">现场：两台塔吊跟造楼机做成一体：塔身穿过平台的角筒格，用爬升框固定在平台上，以后平台顶升时塔吊跟着一起升。</p>
      <p class="basis">〔资料：泰康金融中心新一代平台“仅用 20 天即可完成”安装；组成照长江中心轻量化平台〕</p>`,
  },
  cycle: {
    view: 'all', color: '#ffb52e',
    text: (st) => `<p>超高层的施工顺序是<b>核心筒先行</b>：核心筒（混凝土）领先，钢柱、钢梁、楼承板、楼板、幕墙按顺序一层层跟在下面，每个工种都在不同的楼层同时干活，叫<b>竖向流水</b>。</p>
      <p>为什么核心筒先走？它是整栋楼抗风抗震的主心骨，造楼机和（之后要加的）塔吊都靠在它上面；外框钢结构安装时要以它为基准。</p>
      <p>造楼机罩住核心筒顶上 3.5 层，标准层 <b>${S.cycle} 天一层</b>。现在核心筒 <b class="num">${st.counts.core}F</b>，楼板 <b class="num">${st.counts.slab}F</b>。</p>
      <p class="mach">现场：两台塔吊高低错开 8 m（回转时平衡臂才不会打架），一台管东北、一台管西南，从堆场吊钢柱、钢梁到正在装的那层，也往平台上吊钢筋。吊上去的钢柱、钢梁直接落到正在装的那层它该在的位置，松了钩就留在那儿，这层装完才算“长”出来。南立面的<b>双笼施工电梯</b>送人送料，每隔几层用附墙架拉在楼板边上。楼上还有钢筋绑扎机器人、钢柱焊接机器人、巡检机器狗，见下面“智能建造”。</p>
      <p class="basis">〔4 天一层：资料（武汉中心、泰康金融中心报道）；各工种落后的层数是假设：钢柱 ${S.lags.column}、钢梁 ${S.lags.steel}、楼承板 ${S.lags.deck}、楼板 ${S.lags.slab}、幕墙 ${S.lags.curtain}〕</p>`,
  },
  dismantle: {
    view: 'zlj', color: '#e4602a',
    text: () => `<p>核心筒浇到顶（包括屋顶机房层）就是<b>核心筒封顶</b>。造楼机按安装的反顺序拆：先拆布料机、防护网和附属设施，再拆挂架和模板，最后拆平台和支点，一件件用塔吊吊下去。</p>
      <p>拆完以后做屋顶：机房、冷却塔和一圈 ${T.roof_screen} m 高的幕墙屏风（塔冠）。</p>
      <p class="mach">现场：塔吊把造楼机拆下来的部件一件件吊回地面堆场。</p>
      <p class="basis">〔拆除 ${S.dismantle} 天是假设〕</p>`,
  },
  curtain: {
    view: 'all', color: '#6fd3c8',
    text: () => `<p>结构已经到顶，外面还在挂幕墙。单元式幕墙的板块在工厂里把玻璃、铝框、竖翅拼好，运到现场一块块挂到楼板边上的挂件上，比楼板晚十几层。</p>
      <p>避难层（11、22、33、44 层）不装玻璃，装百叶，让火灾时的避难区能通风排烟。</p>
      <p class="mach">现场：塔吊已经拆走，施工电梯还在，平板车把幕墙板块运进来；等最后几层幕墙装完，施工电梯拆掉，那一列的幕墙最后补上。</p>
      <p class="basis">〔避难层间距不超过 50 m：《建筑设计防火规范》；百叶：常见做法〕</p>`,
  },
  finish: {
    view: 'all', color: '#5bd08c',
    text: () => `<p>主体结构和幕墙都完成了。现实里接下来还有机电（电梯、空调、给排水、强弱电）、精装修、消防和各项验收，往往还要一年左右，这页不演示。</p>
      <p>总高 ${spec.tower.top.toFixed(1)} m：2020 年以后国内严格限制新建 250 m 以上的楼，2026 年开工的超高层大多压在这条线下面。</p>
      <p class="basis">〔资料：住建部、发改委 建科〔2020〕38 号〕</p>`,
  },
};

const STEP_TEXT = [
  (n) => `在刚浇好的墙顶上，绑第 ${n} 层核心筒墙的钢筋（钢筋绑扎层，线框是钢筋笼）。平台下面同时在养护下一层的墙。`,
  (n, h) => `拆掉下面那层的模板，12 个液压油缸同步把整个平台往上顶一层（${h.toFixed(1)} m）。油缸行程只有 ${Q.cyl.stroke} m，所以分 ${S.strokes} 次顶：伸缸顶起平台 → 立柱挂到附墙支座上 → 缩缸把油缸支架提上来，再顶下一次。切到“支点油缸”机位看。`,
  (n) => `大钢模跟着平台一起上来了，合模后布料机把从地面泵上来的混凝土浇进第 ${n} 层的墙模（浇筑层），墙从下往上“长”出来。`,
  (n) => `第 ${n} 层的墙在模板里保湿养护（养护层），强度够了才能挂支座、承受平台的重量。`,
];

// 智能建造：点一下镜头跟过去
const SMART = [
  { key: 'drone', name: '巡检无人机', text: `项目部屋顶上是<b>无人机机场</b>（关盖 0.64 × 0.745 × 0.77 m、约 55 kg）。到点自己开盖，无人机（轴距约 0.5 m、1.85 kg）起飞绕楼拍一圈，看外框、幕墙和临边防护有没有缺口，再回舱充电，全程没人操作。真实项目在城市里飞，要先报批空域。`, basis: '尺寸：DJI Dock 3 / Matrice 4D 公开参数，外形原创；航线是示意' },
  { key: 'dog', name: '四足机器狗', text: `站着 1.1 × 0.45 × 0.65 m、约 60 kg，能上下楼梯。背上有激光雷达和相机，沿固定路线巡检：一只在地面绕基坑看裂缝、积水，一只在最新那层楼板上绕核心筒看临边防护。腿是对角小跑（trot）：左前和右后一起迈。`, basis: '尺寸：宇树 B2 公开参数，外形原创；巡检内容是常见用途' },
  { key: 'rebar', name: '钢筋绑扎机器人', text: `楼承板铺好以后、浇楼板之前，楼板钢筋的每个交叉点都要绑一下，一层上万个点。机器人骑在钢筋网上往前挪，相机找交叉点，横梁上的小车把绑扎枪送过去，枪头往下一按就绑好一个。`, basis: '外形和尺寸是推断的示意；这类机器人国内外都有在研、试用' },
  { key: 'weld', name: '钢柱焊接机器人', text: `钢柱每三层接一次，接头要在高空焊满一圈。现场用的是绑在柱子上的一圈柔性轨道 + 一台焊接小车，激光找坡口、焊枪沿着走。报道里中建钢构这类机器人整机 9.8 kg、两人能搬，定位误差 1 mm 以内。`, basis: '资料：新华网、南方都市报 2026 年 7 月报道；外形原创' },
  { key: 'grind', name: '墙面打磨机器人', text: `幕墙封闭以后，下面几层开始做内墙：喷涂、刮腻子、打磨。这台按一款“喷涂 + 腻子 + 打磨”三合一机器人的尺寸做：0.85 × 0.70 × 1.75 m、约 575 kg，作业高度 3.3 m。它在核心筒外墙边来回磨，楼外看不到，打开“剖开一半”或跟拍进去看。`, basis: '尺寸：一款三合一内墙机器人的公开参数，外形原创' },
  { key: 'survey', name: '全站仪测量', text: `测角、测距的仪器。基坑阶段盯着地连墙有没有往坑里挪（变形监测）；上了楼以后每层都要放线，定钢柱、墙的位置，造楼机顶升前后也要测垂直度。`, basis: '常规做法' },
  { key: 'remote', name: '塔吊远程操控', text: `塔吊司机不用再爬到一两百米高的驾驶室，坐在地面这个集装箱里看屏幕、握手柄开塔吊，一个人还能分时管几台；系统带群塔防碰撞。山西、武汉、广州都有项目在用 5G 远程塔吊。`, basis: '资料：科技日报 2025-01-15、2026-06-26 报道' },
  { key: 'screen', name: '智慧工地大屏', text: `门口这块 6 × 3.4 m 的屏把进度、扬尘噪声、塔吊状态、在场人数、AI 视频预警放在一起。工地四周的 AI 监控杆（球机来回扫）识别没戴安全帽、闯入吊装区这类事。屏上的数随工期变，但都是示意值。`, basis: '常规做法；屏上数值是示意' },
  { key: 'gate', name: '人脸识别闸机', text: `工人从大门东边的实名制通道刷脸进出，系统记出勤、核对是不是持证上岗，在场人数实时上大屏。现在大部分工地都有。`, basis: '常规做法' },
  { key: 'fog', name: '扬尘监测 + 雾炮', prefer: () => sch.excavate.t0 + 30, text: `门口的监测站一直测 PM10、PM2.5、噪声；PM10 超过阈值，基坑两边的雾炮自动开，喷水雾压尘。挖土的时候最容易超。这页把阈值设成 80 μg/m³。`, basis: '常规做法；阈值和数值是假设' },
];

const BASIS = [
  '造楼机组成、12 个支点、油缸 1500 kN / 内径 280 mm / 行程 1.6 m、挂架 7 层每层 2.2 m、覆盖 3.5 个结构层、标准层高 4.4 m：武汉长江中心轻量化集成平台（施工技术 2022 年第 10 期，参考网转载）',
  '平台约 4 天一层、自重 500 t、全封闭、安装约 20 天：科技日报 2023-07-18 报道（泰康金融中心）',
  '橘红色“金钢罩”、微凸支点、平均 4 天一个结构层：人民网 2015-02-11 报道（武汉中心）',
  '布料机 HGY28D：大臂 12.6 m、中臂 8.8 m、小臂 6.1 m、泵管 Ø125：产品参数',
  '限高 250 m：住建部、发改委 建科〔2020〕38 号',
  '各尺寸的来历逐项写在仓库里的 参考资料.md（资料 / 推断 / 假设）',
];

// ------------------------------------------------------------ 界面
const stage = new Stage($('#gl'), sch, spec, P);
window.__stage = stage;   // 调试用
let day = 0;
let playing = false;
let speed = 6;
let lastPhase = -1;

function buildChapters() {
  const box = $('#chapters');
  sch.ph.forEach((p, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="i">${i + 1}</span><span>${p.name}</span><span class="d">${Math.round(p.t0)}–${Math.round(p.t1)} 天</span>`;
    b.onclick = () => {
      const off = p.key === 'cycle' ? (sch.cStart[30] - p.t0) + 1.0 : p.key === 'install' ? (p.t1 - p.t0) * 0.55 : (p.t1 - p.t0) * 0.5;
      setDay(p.t0 + off);
      setView(PHASE[p.key].view);
    };
    box.appendChild(b);
  });
  const tr = $('#track');
  for (const p of sch.ph) {
    const i = document.createElement('i');
    i.style.width = `${((p.t1 - p.t0) / sch.end) * 100}%`;
    i.style.background = PHASE[p.key].color;
    i.title = p.name;
    tr.appendChild(i);
  }
  const ul = $('#basis');
  for (const t of BASIS) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
  const steps = $('#cycle .steps');
  for (const s of STEPS) { const d = document.createElement('div'); d.className = 'st'; d.innerHTML = `${s.name}<i></i>`; steps.appendChild(d); }
  const cnt = $('#counts');
  for (const t of TRADES) {
    const d = document.createElement('div');
    d.className = 'cnt';
    d.style.borderColor = `var(--c-${t})`;
    d.innerHTML = `<span>${TRADE_NAME[t]}</span><b id="cnt-${t}">0</b>`;
    cnt.appendChild(d);
  }
}

function setView(v) {
  for (const b of document.querySelectorAll('#views button')) b.setAttribute('aria-pressed', String(b.dataset.view === v));
  stage.setView(v);
  smartPick(null);
}

// ------------------------------------------------------------ 智能建造
function buildSmart() {
  const box = $('#smart');
  for (const d of SMART) {
    const b = document.createElement('button');
    b.className = 'chipbtn';
    b.dataset.key = d.key;
    b.textContent = d.name;
    b.setAttribute('aria-pressed', 'false');
    b.onclick = () => smartGo(d.key);
    box.appendChild(b);
  }
  $('#smartBack').onclick = () => setView('all');
}

function smartPick(key) {
  for (const b of document.querySelectorAll('#smart button')) b.setAttribute('aria-pressed', String(b.dataset.key === key));
  const d = SMART.find((x) => x.key === key);
  $('#smartCard').hidden = !d;
  if (d) {
    $('#smartName').textContent = d.name;
    $('#smartText').innerHTML = `${d.text}<span class="basis">〔${d.basis}〕</span>`;
  }
}

function smartGo(key) {
  const sm = stage.life && stage.life.smart;
  if (!sm) return;
  // 设备这个阶段不在场：往后找一个它在的时候（找不到再从头找）
  const def = SMART.find((x) => x.key === key);
  if (!sm.present(key, stateAt(sch, day)) && def.prefer) setDay(def.prefer());
  if (!sm.present(key, stateAt(sch, day))) {
    let found = null;
    for (const [a, b] of [[day, sch.end], [0, day]]) {
      for (let d = a; d < b && found == null; d += 0.5) if (sm.present(key, stateAt(sch, d))) found = d + 0.25;
      if (found != null) break;
    }
    if (found != null) setDay(found);
  }
  if (stage.opts.life === false) $('#tLife').click();
  stage.frame(performance.now());           // 先让设备摆到当前位置
  for (const b of document.querySelectorAll('#views button')) b.setAttribute('aria-pressed', 'false');
  if (stage.setTrack(key)) smartPick(key);
}

function setDay(d) {
  day = Math.max(0, Math.min(sch.end, d));
  $('#slider').value = String(day);
  update();
}

const htmlCache = {};
function setHTML(sel, html) {
  if (htmlCache[sel] === html) return;
  htmlCache[sel] = html;
  $(sel).innerHTML = html;
}

function update() {
  const st = stateAt(sch, day);
  stage.apply(st);
  const p = sch.ph[st.phase];
  const info = PHASE[p.key];
  $('#phaseName').textContent = p.name;
  $('#phaseWhen').textContent = `第 ${Math.round(p.t0)} – ${Math.round(p.t1)} 天`;
  setHTML('#phaseText', info.text(st));
  $('#clockDay').textContent = `第 ${Math.floor(day)} 天`;
  $('#clockDate').textContent = st.date;
  for (const t of TRADES) $('#cnt-' + t).textContent = st.counts[t] ? `${st.counts[t]}F` : '—';
  if (st.phase !== lastPhase) {
    document.querySelectorAll('#chapters button').forEach((b, i) => b.setAttribute('aria-current', String(i === st.phase)));
    lastPhase = st.phase;
  }
  // 核心筒循环
  const c = st.core;
  const showCycle = c.cur != null && c.cur <= sch.N + 1;
  $('#cycle').hidden = !showCycle;
  if (showCycle) {
    const n = c.cur;
    const h = sch.z[n + 1] - sch.z[n];
    const withPlat = n > S.low_floors;
    $('#cycleTitle').textContent = `核心筒第 ${n > sch.N ? '屋顶机房' : n} 层：${(sch.cEnd[n] - sch.cStart[n]).toFixed(0)} 天一个循环${withPlat ? '' : '（还没装造楼机）'}`;
    document.querySelectorAll('#cycle .st').forEach((d, i) => {
      d.className = 'st' + (i === c.step ? ' on' : i < c.step ? ' done' : '');
      d.querySelector('i').style.width = i === c.step ? `${c.stepFrac * 100}%` : i < c.step ? '100%' : '0';
    });
    let txt = STEP_TEXT[c.step](n > sch.N ? '屋顶机房' : n, h);
    if (!withPlat && c.step === 0) txt = `在刚浇好的墙顶上，绑第 ${n} 层核心筒墙的钢筋（线框是钢筋笼）。`;
    if (!withPlat && c.step === 1) txt = `拆掉下面那层的模板，把常规模板一块块提到上一层装好（这几层还没有造楼机）。`;
    setHTML('#cycleText', txt);
  }
  drawFlow(st);
}

// ------------------------------------------------------------ 竖向流水图
function drawFlow(st) {
  const cv = $('#flow');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const fMin = -4, fMax = sch.N + 1;
  const L = 34, R = W - 6, top = 8, bot = H - 22;
  const y = (f) => bot - ((f - fMin) / (fMax - fMin)) * (bot - top);
  g.font = '11px system-ui, sans-serif';
  g.fillStyle = '#96a1ab';
  g.strokeStyle = 'rgba(255,255,255,.07)';
  g.lineWidth = 1;
  for (const f of [0, 10, 20, 30, 40, 50]) {
    g.beginPath(); g.moveTo(L, y(f) + 0.5); g.lineTo(R, y(f) + 0.5); g.stroke();
    g.fillText(f === 0 ? '地面' : `${f}F`, 2, y(f) + 4);
  }
  g.fillStyle = 'rgba(122,102,80,.25)';
  g.fillRect(L, y(0), R - L, y(fMin) - y(0));
  g.setLineDash([3, 3]);
  g.strokeStyle = 'rgba(255,181,46,.35)';
  for (const f of T.outrigger) { g.beginPath(); g.moveTo(L, y(f) + 0.5); g.lineTo(R, y(f) + 0.5); g.stroke(); }
  g.setLineDash([]);
  const n = TRADES.length;
  const bw = (R - L) / n;
  // 地下室：所有工种一起
  const bDone = [-4, -3, -2, -1].filter((f) => day >= sch.bSlab[f]).length;
  TRADES.forEach((t, i) => {
    const x = L + i * bw + bw * 0.18, w = bw * 0.64;
    const col = css.getPropertyValue(`--c-${t}`).trim();
    if ((t === 'core' || t === 'column' || t === 'slab') && bDone > 0) {
      g.fillStyle = col + '88';
      g.fillRect(x, y(fMin + bDone), w, y(fMin) - y(fMin + bDone));
    }
    const c = st.counts[t];
    if (c > 0) {
      g.fillStyle = col;
      g.fillRect(x, y(c), w, y(0) - y(c));
      g.fillStyle = '#ebe8e0';
      g.textAlign = 'center';
      g.fillText(String(c), x + w / 2, y(c) - 3);
      g.textAlign = 'left';
    }
    g.fillStyle = '#96a1ab';
    g.textAlign = 'center';
    g.fillText(TRADE_NAME[t], x + w / 2, H - 6);
    g.textAlign = 'left';
  });
  // 造楼机罩住的 3.5 层
  const pl = st.plat;
  if (pl.show) {
    const zTop = pl.rootZ + pl.lift;
    let f = 0;
    for (let k = 1; k <= sch.topCore + 1; k++) if (sch.z[k] <= zTop + 1e-6) f = k;
    const fl = f - 1 + (zTop - sch.z[f]) / (sch.z[f + 1] - sch.z[f] || 4.4);
    const x = L + bw * 0.06, w = bw * 0.88;
    g.strokeStyle = '#ff7a2f';
    g.lineWidth = 2;
    g.strokeRect(x, y(fl + 1 + 1.2), w, y(fl + 1 - 2.3) - y(fl + 1 + 1.2));
    g.fillStyle = '#ff7a2f';
    g.fillText('造楼机', x + w + 2 > R - 30 ? x : x + 2, y(fl + 1 + 1.2) - 3);
  }
  const lead = st.counts.core - st.counts.slab;
  $('#lead').innerHTML = st.counts.core > 0
    ? `核心筒领先楼板 <b>${lead}</b> 层，领先幕墙 <b>${st.counts.core - st.counts.curtain}</b> 层。虚线是加强层（${T.outrigger.join('、')} 层）。`
    : '地上还没开始。棕色区域是地下室（4 层）。';
}

// ------------------------------------------------------------ 事件
function bind() {
  const sl = $('#slider');
  sl.max = String(sch.end);
  sl.addEventListener('input', () => { day = +sl.value; update(); });
  $('#play').onclick = () => {
    playing = !playing;
    if (playing && day >= sch.end) day = 0;
    $('#play').textContent = playing ? '❚❚' : '▶';
    $('#play').setAttribute('aria-label', playing ? '暂停' : '播放');
  };
  for (const b of document.querySelectorAll('#speed button')) b.onclick = () => {
    speed = +b.dataset.speed;
    for (const c of document.querySelectorAll('#speed button')) c.setAttribute('aria-pressed', String(c === b));
  };
  for (const b of document.querySelectorAll('#views button')) b.onclick = () => setView(b.dataset.view);
  const tog = (id, key, fn) => {
    const b = $(id);
    b.onclick = () => {
      const v = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(v));
      stage.opts[key] = v;
      if (fn) fn(v);
      update();
    };
  };
  tog('#tMesh', 'mesh');
  tog('#tCut', 'cut', (v) => stage.setCut(v));
  tog('#tFollow', 'follow');
  tog('#tLife', 'life');
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.key !== ' ') return;
    if (e.key === ' ') { e.preventDefault(); $('#play').click(); }
    if (e.key === 'ArrowRight') setDay(day + (e.shiftKey ? 10 : 1));
    if (e.key === 'ArrowLeft') setDay(day - (e.shiftKey ? 10 : 1));
  });
  window.addEventListener('resize', () => drawFlow(stateAt(sch, day)));
}

let tPrev = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - tPrev) / 1000);
  tPrev = now;
  if (playing) {
    // 顶升那一小段放慢，看得清油缸
    const c = stateAt(sch, day).core;
    const slow = c.cur > S.low_floors && c.step === 1 && speed <= 6 ? 0.35 : 1;
    day += dt * speed * slow;
    if (day >= sch.end) { day = sch.end; playing = false; $('#play').textContent = '▶'; }
    $('#slider').value = String(day);
    update();
  }
  stage.frame(now);
  requestAnimationFrame(loop);
}

async function start() {
  buildChapters();
  buildSmart();
  bind();
  await stage.load(towerGlb, zljGlb, machGlb);
  $('#loading').hidden = true;
  const q = new URLSearchParams(location.search);
  setDay(q.has('day') ? +q.get('day') : sch.cStart[30] + S.cycle * (S.split[0] + 0.5 * (S.split[1] - S.split[0])));
  setView(q.get('view') || 'all');
  stage.setView(q.get('view') || 'all', true);
  if (q.has('cam')) stage.setCam(...q.get('cam').split(',').map(Number));
  if (q.has('t')) stage.lifeT = +q.get('t');          // 调试：机械时间钉在第 t 秒
  if (q.has('cut')) $('#tCut').click();
  if (q.has('nomesh')) $('#tMesh').click();
  if (q.has('track')) smartGo(q.get('track'));
  requestAnimationFrame(loop);
}

start().catch((e) => { $('#loading').textContent = '模型载入失败：' + e.message; console.error(e); });
