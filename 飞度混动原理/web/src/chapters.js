// 八章内容。每章：文案 + enter(A) 返回 { tick(dt), leave() }。
import * as S from './sim.js';
import { Plot, C, niceTicks } from './chart.js';

const { CAR, ENG } = S;
const PI = Math.PI;
const $ = (id) => document.getElementById(id);
const f0 = (x) => (isFinite(x) ? Math.round(x).toLocaleString('en-US') : '–');
const f1 = (x) => (isFinite(x) ? x.toFixed(1) : '–');
const f2 = (x) => (isFinite(x) ? x.toFixed(2) : '–');
const clamp = S.clamp;
const AUX = CAR.Paux / CAR.etaDcdc;

// ---------------------------------------------------------------- 片段
const ctl = (id, label, min, max, step, val) => `<label class="ctl" for="${id}"><span>${label}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"><output id="${id}-o" for="${id}"></output></label>`;
const kpi = (id, label) => `<div class="kpi"><div class="k">${label}</div><div class="v" id="${id}">–</div></div>`;
const plot = (id, h, title) => `<div><p class="pt">${title}</p><div class="plotwrap"><canvas id="${id}" style="height:${h}px"></canvas></div></div>`;
const btn = (id, label, pressed) => `<button class="btn" id="${id}" type="button"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${label}</button>`;
const EV = { o: ['b', '官方资料'], a: ['a', '公认'], b: ['c', '工程实践 / 媒体'], c: ['c', '本页简化'], d: ['d', '我的推测'] };
const note = (title, ev, body) => `<div class="note"><h3>${title}${(Array.isArray(ev) ? ev : ev ? [ev] : []).map((e) => ` <span class="ev ${EV[e][0]}">${EV[e][1]}</span>`).join('')}</h3>${body}</div>`;
const key = (c, t) => `<span><i style="background:${c}"></i>${t}</span>`;
// 先猜再看的小题、分步算式（和 踏板摩托车动力系统 同一套写法）
const CH = (id) => `第 ${CHAPTERS.findIndex((c) => c.id === id) + 1} 章`;
const quiz = (id, q, opts) => `<div class="quiz" id="${id}"><p class="qq"><b>先猜一猜</b>${q}</p>
  <div class="qo">${opts.map((o, i) => `<button type="button" class="btn" data-i="${i}">${'ABCD'[i]}. ${o}</button>`).join('')}</div>
  <div class="qa stepnote" hidden></div></div>`;
function quizBind(id, right, explain) {
  const box = $(id), ans = box.querySelector('.qa');
  box.querySelectorAll('.qo button').forEach((b) => {
    b.onclick = () => {
      const ok = +b.dataset.i === right;
      box.querySelectorAll('.qo button').forEach((x) => { x.classList.remove('yes', 'no'); if (+x.dataset.i === right) x.classList.add('yes'); });
      if (!ok) b.classList.add('no');
      ans.hidden = false;
      ans.innerHTML = `<b>${ok ? '对了。' : '不是这个。'}</b>${explain}`;
    };
  });
}
const calc = (no, title, html) => `<div class="calc"><h4><i>${no}</i>${title}</h4>${html}</div>`;
const eq = (id) => `<div class="eq" id="${id}"></div>`;
const hl = (v) => `<b>${v}</b>`;        // 会跟着滑块变的数
const rs = (v) => `<u>${v}</u>`;        // 这一步算出来的结果

function bind(id, fn, fmt) {
  const el = $(id), o = $(`${id}-o`);
  const run = () => { const v = +el.value; if (o) o.textContent = fmt ? fmt(v) : v; fn(v); };
  el.addEventListener('input', run); run();
  return { set(v) { el.value = v; run(); }, get: () => +el.value };
}
const set = (id, html) => { const e = $(id); if (e && e._v !== html) { e.innerHTML = html; e._v = html; } };
const unit = (v, u) => `${v}<small>${u}</small>`;
const group = (ids, sel) => { for (const k of ids) { const e = $(k); if (e) e.setAttribute('aria-pressed', k === sel); } };

const COLF = { fuel: '#ff5a5a', mech: '#58e0a0', ac: '#c78bff', dc: '#ffb547', exh: '#a7b0bb' };
export const MODE_COL = { EV: '#ffb547', HYB: '#c78bff', ENG: '#58e0a0', REGEN: '#4cc3ff', EBRK: '#ff7066', SYNC: '#ffd166', OFF: '#6b7a90' };
const MODE_CN = { EV: 'EV 纯电', HYB: '混动：发动机发电', ENG: '发动机直驱', REGEN: '能量回收', EBRK: '回收 + 拖发动机', SYNC: '同步转速，准备直连', OFF: '停车' };
const LEG_FLOW = `<span><i class="lf"></i>燃油</span><span><i class="lm"></i>机械动力</span><span><i class="la"></i>交流电（电机 ↔ PCU）</span><span><i class="ld"></i>直流电（电池 ↔ PCU）</span><span><i class="lx"></i>排气</span>`;

// ---------------------------------------------------------------- 能量流框图（SVG）
const FD_BOX = { tank: [8, 16, 56, 30, '油箱'], eng: [96, 16, 70, 30, '发动机'], clu: [204, 16, 64, 30, '离合器'], gen: [96, 86, 70, 30, '发电机'],
  pcu: [190, 86, 50, 30, 'PCU'], mot: [262, 86, 62, 30, '驱动电机'], whl: [336, 86, 38, 30, '车轮'], bat: [190, 152, 50, 30, '电池'] };
const FD_PATH = { fuel: ['M64 31H96', 'fuel', [80, 8, 'middle']], e2g: ['M131 46V86', 'mech', [137, 66, 'start']], e2c: ['M166 31H204', 'mech', [185, 8, 'middle']],
  c2w: ['M268 31H355V86', 'mech', [312, 8, 'middle']], g2p: ['M166 101H190', 'ac', [178, 77, 'middle']], p2m: ['M240 101H262', 'ac', [251, 77, 'middle']],
  m2w: ['M324 101H336', 'mech', [322, 128, 'middle']], b2p: ['M215 152V116', 'dc', [222, 136, 'start']] };
const fdHtml = (id) => `<svg class="fd" id="${id}" viewBox="0 0 380 192" role="img" aria-label="能量流框图">
  ${Object.entries(FD_PATH).map(([k, [d, c]]) => `<path class="p" data-k="${k}" d="${d}" stroke="${COLF[c]}"/>`).join('')}
  ${Object.entries(FD_BOX).map(([k, [x, y, w, h, t]]) => `<g class="bx" data-b="${k}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/><text x="${x + w / 2}" y="${y + h / 2}">${t}</text></g>`).join('')}
  ${Object.entries(FD_PATH).map(([k, [, c, [x, y, a]]]) => `<text class="kw" data-l="${k}" x="${x}" y="${y}" text-anchor="${a}" fill="${COLF[c]}"></text>`).join('')}
</svg>`;
class FlowDia {
  constructor(id) {
    this.el = $(id); this.off = {}; this.rate = {};
    this.p = {}; this.l = {}; this.b = {};
    this.el.querySelectorAll('.p').forEach((n) => { this.p[n.dataset.k] = n; this.off[n.dataset.k] = 0; });
    this.el.querySelectorAll('.kw').forEach((n) => { this.l[n.dataset.l] = n; });
    this.el.querySelectorAll('.bx').forEach((n) => { this.b[n.dataset.b] = n; });
  }
  /** f: 各路径 kW（带符号），clutch, eng */
  update(f) {
    for (const k in this.p) {
      const kw = f[k] || 0, on = Math.abs(kw) > .05;
      this.p[k].classList.toggle('on', on);
      this.rate[k] = on ? Math.sign(kw) * (14 + 26 * Math.sqrt(Math.min(Math.abs(kw), 60) / 60)) : 0;
      const word = k === 'b2p' ? (kw < 0 ? '充 ' : '放 ') : (k === 'p2m' || k === 'm2w') && kw < 0 ? '回收 ' : k === 'g2p' && kw < 0 ? '拖转 ' : '';
      const t = on ? `${word}${Math.abs(kw) < 10 ? Math.abs(kw).toFixed(1) : Math.abs(kw).toFixed(0)} kW` : '';
      if (this.l[k].textContent !== t) this.l[k].textContent = t;
    }
    const cl = { open: '离合 分开', sync: '离合 同步中', locked: '离合 接合' }[f.clutch || 'open'];
    const ct = this.b.clu.querySelector('text');
    if (ct.textContent !== cl) ct.textContent = cl;
    this.b.clu.classList.toggle('on', f.clutch === 'locked');
    this.b.eng.classList.toggle('off', !f.eng); this.b.eng.classList.toggle('on', !!f.eng);
    this.b.tank.classList.toggle('off', !f.eng);
  }
  tick(dt) {
    for (const k in this.p) {
      if (!this.rate[k]) continue;
      this.off[k] = (this.off[k] - this.rate[k] * dt) % 140;
      this.p[k].style.strokeDashoffset = this.off[k].toFixed(1);
    }
  }
}

// ---------------------------------------------------------------- 状态 → 3D 和框图
/**
 * st: { v m/s, nE rpm, eng(燃烧中), spin(发动机在转), clutch, Pw 车轮, Pe 发动机, fuel W, Pgen 发电机直流（+发电）, Pmot 电机交流（+驱动）, Pbat 电池（+放电）, direct(直驱) }
 */
function flowsOf(st) {
  const k = 1e-3;
  const dir = st.clutch === 'locked';
  const genMech = dir ? (st.Pgen > 150 ? st.Pgen / 0.9 : 0) : st.spin ? st.Pe : 0;   // 发动机分给发电机的机械功率
  const toClutch = dir ? Math.max(st.Pe - genMech, 0) : 0;
  const mech = toClutch * k * CAR.etaMesh;
  const pmMech = st.Pmot * k;
  return {
    three: {
      fuel: st.eng ? st.fuel * k / 3 : 0, exhaust: st.eng ? st.fuel * k / 6 + 1 : 0,
      eng_gen: genMech * k, eng_wheel: toClutch * k, mot_wheel: pmMech,
      axle_L: st.Pw * k / 2, axle_R: st.Pw * k / 2,
      gen_pcu: Math.abs(st.Pgen) > 400 ? st.Pgen * k : 0, pcu_mot: pmMech, batt_pcu: st.Pbat * k,
    },
    dia: {
      fuel: st.eng ? st.fuel * k : 0, e2g: genMech * k, e2c: toClutch * k, c2w: mech,
      g2p: Math.abs(st.Pgen) > 200 ? st.Pgen * k : 0, p2m: st.Pmot * k, m2w: st.Pmot * k * .9, b2p: st.Pbat * k, clutch: st.clutch, eng: st.eng || st.spin,
    },
  };
}

/** 让 3D 转起来：车轮和曲轴按真实转速除以慢放倍数 */
function animate(A, dt, st, slowK, fd, noFlow) {
  const s = A.stage;
  s.th.W += S.wheelW(st.v) / slowK * dt;
  s.th.I += S.rpm2rad(st.nE || 0) / slowK * dt;
  s.setEngine(!!st.eng);
  s.setClutch(st.clutch || 'open');
  s.setAngles(s.th.W, s.th.I);
  if (s.view === 'drive') s.scrollRoad(st.v / slowK * dt);
  const fl = flowsOf(st);
  s.setFlows(noFlow ? {} : fl.three);   // noFlow：这一步只看转速，不画能量粒子
  if (fd) { fd.update(fl.dia); fd.tick(dt); }
  return fl;
}

// 典型工况
function presetEV(kmh = 40) {
  const v = kmh / 3.6, F = S.roadForce(v), m = S.motorDcDemand(v, F);
  return { v, nE: 0, eng: false, spin: false, clutch: 'open', Pw: F * v, Pe: 0, fuel: 0, Pgen: 0, Pmot: m.Pac, Pbat: m.Pdc + AUX };
}
function presetHYB(kmh = 50, acc = 0.8) {
  const v = kmh / 3.6, F = S.roadForce(v) + CAR.mEq * acc, m = S.motorDcDemand(v, F);
  const D = m.Pdc + AUX, g = S.engineForDc(D * 0.82, S.nvhCap(v));
  return { v, nE: g.op.n, eng: true, spin: true, clutch: 'open', Pw: F * v, Pe: g.Pe, fuel: S.fuelPower(g.op.n, g.op.T), Pgen: g.Pdc, Pmot: m.Pac, Pbat: D - g.Pdc, g };
}
function presetENG(kmh = 100) {
  const v = kmh / 3.6, d = S.direct(v);
  return { v, nE: d.n, eng: true, spin: true, clutch: 'locked', Pw: d.Pw, Pe: d.Pe, fuel: d.fuel, Pgen: AUX, Pmot: 0, Pbat: 0, d };
}
function presetREGEN(kmh = 60, dec = 1.5) {
  const v = kmh / 3.6, F = S.roadForce(v) - CAR.mEq * dec, r = S.motorDcDemand(v, F);
  return { v, nE: 0, eng: false, spin: false, clutch: 'open', Pw: F * v, Pe: 0, fuel: 0, Pgen: 0, Pmot: r.Pac, Pbat: r.Pdc + AUX };
}

function rolling(n) { return { x: [], ys: [], n, push(x, ...v) { this.x.push(x); this.ys.push(v); if (this.x.length > n) { this.x.shift(); this.ys.shift(); } }, col(i) { return this.ys.map((r) => r[i]); }, clear() { this.x = []; this.ys = []; } }; }

// ---------------------------------------------------------------- 第 1 章 全貌
const overview = {
  id: 'overview', nav: '全貌', view: 'home',
  title: '你的飞度里装了两台电机和一台发动机',
  lead: '车轮由<b>驱动电机</b>推。发动机大部分时间带着<b>发电机</b>发电，只有高速匀速时才经一个<b>离合器</b>直接推车。电池很小，只负责“缓冲”。',
  body: () => `
    <div class="chain"><span>油箱</span><em>→</em><span>发动机</span><em>→</em><span>发电机</span><em>→</em><span>PCU</span><em>→</em><span>驱动电机</span><em>→</em><span>车轮</span></div>
    <div class="chain"><span>发动机</span><em>→</em><span>离合器（只在高速匀速时合上）</span><em>→</em><span>车轮</span></div>
    ${ctl('ex', '拆开', 0, 100, 1, 0)}
    <div class="btns" role="group" aria-label="看哪里">${btn('v-home', '外观', true)}${btn('v-pt', '动力总成', false)}${btn('v-under', '底盘下面', false)}</div>
    <div class="btns" role="group" aria-label="车身">${btn('b-ghost', '车身半透明', true)}${btn('b-solid', '车身实体', false)}${btn('b-hide', '隐藏车身', false)}</div>
    <div id="part" class="card"><h4>点模型上的零件</h4><p>标签和三维模型里的零件都能点，这里会说明它是干什么的。拖动旋转，滚轮或双指缩放。现在这辆车在 40 km/h 纯电行驶：发动机停着，电从后面的电池流到前面的电机。</p></div>
    <div class="tw"><table class="params" id="params"></table></div>`,
  notes: () => `
    ${note('参数从哪来', 'o', '<p>表里的数字来自本田日本官网的飞度诸元表（2022 年 10 月小改款以后的版本）。如果你的车是 2022 年 10 月以前出厂的，发动机是 72 kW、驱动电机 80 kW，原理完全一样。</p>')}
    ${note('模型和真车的差别', 'c', '<p>车身只是一个紧凑两厢车的示意外形，不是飞度的外观。e-CVT 里面各根轴的相对位置、齿轮大小是我按官方齿比凑出来的示意，本田没有公开图纸。发电机那一级的齿比（2.0）是假设值。</p>')}
    ${note('怎么看证据标签', '', `<ul><li><span class="ev b">官方资料</span> 本田官网、诸元表、技术说明。</li><li><span class="ev a">公认</span> 教科书级结论。</li><li><span class="ev c">工程实践 / 媒体</span> 行业常见做法、拆解报告、媒体或车主的观察，具体数字因车而异。</li><li><span class="ev c">本页简化</span> 为了讲清楚做的假设，或者本页模型算出来的数。</li><li><span class="ev d">我的推测</span> 没找到可靠来源支持的判断。</li></ul>`)}`,
  enter(A) {
    const s = A.stage;
    $('params').innerHTML = [
      ['发动机', 'LEB 1.5 L 直列四缸，阿特金森循环<br>78 kW / 127 N·m（小改前 72 kW）'],
      ['驱动电机', 'H5 交流同步电机<br>90 kW / 253 N·m（小改前 80 kW）'],
      ['变速比', '电机行驶 2.454 · 发动机行驶 0.805'],
      ['减速比', '3.423'],
      ['合起来', `电机 → 车轮 ${(2.454 * 3.423).toFixed(2)} · 发动机 → 车轮 ${(0.805 * 3.423).toFixed(3)}`],
      ['发动机直驱时', `每 1 km/h 对应约 ${S.rpmPerKmh.toFixed(1)} rpm（100 km/h ≈ ${f0(S.lockRpm(100 / 3.6))} rpm）`],
      ['动力电池', '锂离子，48 个单体，标称约 173 V'],
      ['燃油箱', '40 L，放在前排座椅下面'],
      ['轮胎 / 车重', '185/60R15 等 · 约 1,190–1,290 kg'],
    ].map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('');
    let viewSel = 'v-home';
    const exS = bind('ex', (v) => {
      s.setExplode(v / 100);
      if (v > 1 && s.view !== 'home') { s.applyView('home'); group(['v-home', 'v-pt', 'v-under'], 'v-home'); viewSel = 'v-home'; }
    }, (v) => `${v}%`);
    const views = { 'v-home': 'home', 'v-pt': 'ptrain', 'v-under': 'under' };
    for (const k in views) $(k).onclick = () => { exS.set(0); viewSel = k; group(Object.keys(views), k); s.applyView(views[k]); };
    const bodies = { 'b-ghost': 'ghost', 'b-solid': 'solid', 'b-hide': 'hidden' };
    for (const k in bodies) $(k).onclick = () => { group(Object.keys(bodies), k); s.setBody(bodies[k]); };
    const sp = A.spec.anchors;
    A.setTags([['eng_block', '发动机', sp.eng_block], ['gen_stator', '发电机', sp.gen_stator], ['mot_stator', '驱动电机', sp.mot_stator], ['clutch', '离合器', sp.clutch],
      ['pcu', 'PCU', sp.pcu], ['ipu', '电池 IPU', sp.ipu], ['tank', '油箱', sp.tank], ['wheel_FL', '前轮', sp.wheel_FL]], (g) => A.showPart(g));
    A.partHost = 'part';
    A.setSlow('3D 转动慢放 ×20');
    A.setLegend(LEG_FLOW);
    const st = presetEV(40);
    return {
      tick(dt) { animate(A, dt, st, 20); A.tagsUpdate(['home', 'ptrain', 'under']); },
      leave() { s.setExplode(0); s.setFlows({}); A.setTags([]); A.partHost = null; s.setBody('ghost'); },
    };
  },
};

// ---------------------------------------------------------------- 第 2 章 三种模式
const MODES2 = {
  EV: { make: () => presetEV(40), t: 'EV 纯电', d: '电池 → PCU → 驱动电机 → 车轮。发动机熄火，发电机跟着停。起步、低速、轻踩油门时用。' },
  HYB: { make: () => presetHYB(50, 0.8), t: '混动（发动机发电）', d: '发动机 → 发电机 → PCU → 驱动电机 → 车轮。车还是电机推的，发动机只是“随车发电站”。用力加速、电池电量低时用。电池在这里可以补一点，也可以吸收多发的电。' },
  ENG: { make: () => presetENG(100), t: '发动机直驱', d: '发动机 → 离合器 → 固定齿轮 → 车轮。只有一个挡，等于手动挡的最高挡。高速匀速巡航时用。驱动电机还连着车轮在空转，需要时可以帮忙或发电。' },
  REGEN: { make: () => presetREGEN(60, 1.5), t: '能量回收', d: '车轮 → 驱动电机（当发电机用）→ PCU → 电池。松油门、踩刹车时，动能变回电。回收不够的部分才用刹车片。' },
};
const ROLE = {
  EV: ['熄火', '停', '驱动', '分开', '放电'], HYB: ['发电', '发电', '驱动', '分开', '补电或充电'], ENG: ['推车', '空转（只发 12 V 用电）', '空转（可助力）', '接合', '基本不动'], REGEN: ['熄火', '停', '发电', '分开', '充电'],
};
const modes = {
  id: 'modes', nav: '三种模式', view: 'ptrain',
  title: '三种行驶模式 + 能量回收',
  lead: '同一套硬件，靠电脑决定<b>能量走哪条路</b>。点下面四个按钮，看三维模型和框图里的能量流怎么变。',
  body: () => `
    <div class="btns" role="group" aria-label="模式">${btn('m-EV', 'EV 纯电', true)}${btn('m-HYB', '混动', false)}${btn('m-ENG', '发动机直驱', false)}${btn('m-REGEN', '能量回收', false)}</div>
    <div class="mode" id="mbox"><span class="dot" id="mdot"></span><div><b id="mt"></b><p id="md"></p></div></div>
    ${fdHtml('fd2')}
    <div class="kpis">${kpi('k2-v', '车速')}${kpi('k2-ne', '发动机')}${kpi('k2-nm', '驱动电机')}${kpi('k2-pw', '车轮功率')}${kpi('k2-f', '油耗')}</div>
    <div class="tw"><table><thead><tr><th>部件</th><th>在干什么</th></tr></thead><tbody id="role"></tbody></table></div>`,
  notes: () => `
    ${note('为什么说它“串联为主”', 'o', '<p>本田的说法是：低中速时像串联混动（发动机发电、电机驱动），高速巡航时像并联混动（发动机直连车轮）。日常开车大部分时间是前两种模式，所以“电机推车、发动机发电”这个理解对了八成。</p>')}
    ${note('框图里的数字', 'c', '<p>四个工况是本页模型按典型场景算的：40 km/h 匀速、50 km/h 以 0.08 g 加速、100 km/h 匀速、60 km/h 以 0.15 g 减速。损耗系数取的是同级电机和发动机的常见量级，只用来看谁大谁小。</p>')}
    ${note('和日产 e-POWER 的区别', 'a', '<p>e-POWER 是纯串联：发动机和车轮之间根本没有机械连接，所以它只有前两种模式。e:HEV 多出来的就是“发动机直驱”这一条路，代价是多一个离合器和一对齿轮。</p>')}`,
  enter(A) {
    const fd = new FlowDia('fd2');
    let cur = null, st = null;
    const pick = (m) => {
      cur = m; st = MODES2[m].make();
      group(['m-EV', 'm-HYB', 'm-ENG', 'm-REGEN'], `m-${m}`);
      $('mt').textContent = MODES2[m].t; $('md').textContent = MODES2[m].d;
      $('mdot').style.background = MODE_COL[m];
      const r = ROLE[m];
      $('role').innerHTML = ['发动机', '发电机', '驱动电机', '离合器', '电池'].map((n, i) => `<tr><th>${n}</th><td>${r[i]}</td></tr>`).join('');
      set('k2-v', unit(f0(st.v * 3.6), 'km/h'));
      set('k2-ne', st.nE ? unit(f0(st.nE), 'rpm') : unit('停', ''));
      set('k2-nm', unit(f0(S.motorRpm(st.v)), 'rpm'));
      set('k2-pw', unit(f1(st.Pw / 1000), 'kW'));
      set('k2-f', st.eng ? unit(f1(S.l100(st.fuel, st.v)), 'L/100km') : unit('0', ''));
    };
    for (const m of Object.keys(MODES2)) $(`m-${m}`).onclick = () => pick(m);
    pick('EV');
    A.setSlow('3D 转动慢放 ×25');
    A.setLegend(LEG_FLOW);
    return {
      tick(dt) { animate(A, dt, st, 25, fd); },
      leave() { A.stage.setFlows({}); },
    };
  },
};

// ---------------------------------------------------------------- 第 3 章 e-CVT 里面
// 拆成六小步，一步只加一个新概念：车速→车轮转速、一对齿轮、电机这条路、发动机这条路、离合器、后果。
const STEP3 = ['车速 → 车轮转速', '一对齿轮', '电机 → 车轮', '发动机这边', '合上离合器', '只有一个挡'];
const R3 = { F: 65 / 19, M: 54 / 22, E: 54 / 67, circ: 2 * PI * CAR.rw };
const ecvt = {
  id: 'ecvt', nav: '一个离合器', view: 'ecvt',
  title: '拆开 e-CVT：两台电机、几对齿轮、一个离合器',
  lead: '这一章只想讲明白一句话：<b>离合器一合上，发动机转速就被车速钉死了</b>。要走到这句话，中间有几个小台阶，下面分六步，一步只加一个新东西。每一步都可以拖车速。',
  body: () => `
    <div class="steps s6" role="group" aria-label="六小步">${STEP3.map((t, i) => `<button class="btn" id="s3-${i}" type="button" aria-pressed="${i === 0}"><small>第 ${i + 1} 步</small>${t}</button>`).join('')}</div>
    ${ctl('sp3', '车速', 0, 150, 1, 80)}
    <div id="s3" class="lab"></div>
    <div id="part3" class="card"><h4>点三维里的标签</h4><p>三维模型上只标了这一步用到的零件（已经点亮）。点标签或零件，这里会说明它是干什么的。</p></div>`,
  notes: () => `
    ${note('为什么只要一个挡', 'o', '<p>本田说这个直驱齿比相当于手动挡的<b>最高挡</b>。低速、起步、加速全交给电机，电机从 0 rpm 就有最大扭矩，用不着低挡；发动机只在高速巡航时才上场，一个高挡就够。少了变速箱，结构简单、损耗小。</p>')}
    ${note('合上之前要先同步', 'b', '<p>离合器两边转速不一样时硬合，会冲击、磨片。所以合上前先用发电机把发动机转速拉到和直驱齿轮一样（第 5 步的图里两条线重合），再合。车速一变，发动机转速跟着变：直驱时 <b>发动机转速 ≈ 24.6 × 车速（km/h）</b>。</p>')}
    ${note('什么时候合不上', 'c', `<p>车速太低时，锁死的发动机转速太低（50 km/h 只有约 ${f0(S.lockRpm(50 / 3.6))} rpm），容易抖、效率也差，所以低速不直驱。拖着重物爬坡这种要大扭矩的时候，一个高挡也不够用，就退回混动模式。</p><p>这正是本田后来在 CR-V（2023）上给直驱多加一个<b>低挡</b>的原因（媒体报道）。飞度这代只有一个。</p>`)}
    ${note('驱动电机为什么一直在转', 'a', `<p>电机和车轮之间没有离合器，车动它就转。直驱时它零电流空转，但永磁体的磁场还在，会有一点铁损。这是这种结构躲不掉的小代价，${CH('highway')}会算进去。</p>`)}
    ${note('这一章里哪些数是示意', 'c', '<p>齿数（22、54、19、65、67）是我按官方齿比凑出来的，乘出来和官方的 8.40、2.757 对得上，但本田没有公布真实齿数。发电机那一级的 2 倍是假设。轮胎滚动半径取 0.297 m。“45 km/h 以下不让合”是本页为了演示定的门槛，真车的标定没有公开。</p>')}`,
  enter(A) {
    const s = A.stage, sp = A.spec.anchors, ax = A.spec.axes, K80 = 80 / 3.6;
    let v = K80, mode = 'off', nGen = 1200, nE = 0, clutch = 'open', step = 0, p3 = null, t = 0;
    const hist = rolling(240);
    const msg = (txt, cls = '') => { const e = $('msg3'); if (e) { e.textContent = txt; e.className = `mini ${cls}`; } };
    bind('sp3', (x) => { v = x / 3.6; }, (x) => `${x} km/h`);

    // 三维标签：[零件组, 文字, 位置（Blender 坐标 mm）]
    const TAG = {
      wheel: ['wheel_FR', '车轮', [-sp.wheel_FL[0], sp.wheel_FL[1], sp.wheel_FL[2]]],
      diff: ['diff', '差速器齿圈 65 齿', sp.diff],
      counter: ['counter', '中间轴 54 齿 + 19 齿', sp.counter],
      mot: ['mot_rotor', '驱动电机 22 齿', sp.mot_stator],
      eng: ['eng_block', '发动机', sp.eng_block],
      gen: ['gen_rotor', '发电机', sp.gen_stator],
      clu: ['clutch', '离合器', sp.clutch],
      ed: ['edrive', '直驱齿轮 67 齿', [A.spec.x.p1, ax.I[0], ax.I[1]]],
    };

    const pickMode = (m) => {
      if (m === 'lock' && v * 3.6 < 45) { msg(`车速 ${Math.round(v * 3.6)} km/h 时合上，发动机只有 ${f0(S.lockRpm(v))} rpm，太低了。先把车速加到 45 km/h 以上。`, 'warn'); return; }
      mode = m; group(['e-off', 'e-gen', 'e-lock'], `e-${m}`);
      if (m === 'lock') { clutch = 'sync'; msg('同步中：发电机正在把发动机转速拉到和直驱齿轮一致…'); }
      else { clutch = 'open'; msg(m === 'off' ? '发动机熄火：车靠电池驱动，发动机和发电机都停着，直驱齿轮照样跟着车轮转。' : '离合器分开：发动机转速可以随便定（拖滑块），和车速无关。'); }
    };

    const DEF = [
      // ---- 1 车速 → 车轮转速
      {
        tags: ['wheel'], hl: ['wheel_FR'], flows: false, mode: 'off',
        html: () => `
          <p class="stepnote"><b>这一步只看车轮。</b>轮胎每滚一圈，车就前进一个轮胎周长。所以知道车速，就能算出车轮每分钟转几圈（rpm）。</p>
          ${calc(1, '把车速换成车轮转速', `<p>本页取轮胎滚动半径 0.297 m，周长 = 2 × 3.14 × 0.297 ≈ <b>${f2(R3.circ)} m</b>。</p>${eq('q1a')}${eq('q1b')}`)}
          <div class="kpis">${kpi('r-w', '车轮')}</div>
          <p class="stepnote"><b>记住这一条：</b>轮胎不打滑时，车速定了，车轮转速就定了，没有别的可能。后面所有转速都从这个数出发。</p>`,
        live: (n) => {
          const k = Math.round(v * 3.6);
          set('q1a', `${hl(k)} km/h = ${hl(k)} × 1000 m ÷ 60 分 = ${hl(f0(k * 1000 / 60))} m/分`);
          set('q1b', `${hl(f0(k * 1000 / 60))} m/分 ÷ ${f2(R3.circ)} m/圈 = ${rs(f0(n.W))} 圈/分（rpm）`);
        },
      },
      // ---- 2 一对齿轮
      {
        tags: ['wheel', 'diff', 'counter'], hl: ['diff', 'counter'], flows: false, mode: 'off',
        html: () => `
          <p class="stepnote"><b>这一步只看一对齿轮。</b>车轮连着一个 65 齿的大齿圈（差速器），它咬着旁边一根轴上的 19 齿小齿轮。这根轴叫<b>中间轴</b>。</p>
          ${quiz('q3a', '小齿轮（19 齿）转 1 圈，大齿圈（65 齿）转了多少？', ['也是 1 圈', '约 0.29 圈（19 ÷ 65）', '约 3.42 圈（65 ÷ 19）', '不一定，看转得多快'])}
          ${calc(2, '齿咬着齿，一个齿只能推过去一个齿', `<p>两个齿轮在咬合的地方，每分钟走过的<b>齿数必须一样多</b>，不会打滑。所以齿少的转得快，齿多的转得慢，倍数就是齿数比，而且是<b>固定</b>的。</p><p>反过来算：车轮（大齿圈）转 1 圈走过 65 个齿，小齿轮只有 19 个齿，要转 65 ÷ 19 ≈ <b>${f2(R3.F)}</b> 圈。</p>${eq('q2a')}`)}
          <div class="kpis">${kpi('r-w', '车轮')}${kpi('r-c', '中间轴')}</div>
          <p class="stepnote"><b>顺带一句</b> <span class="ev a">公认</span>：转速降几倍，扭矩（拧的力气）就大几倍。中间轴转得快、劲小；到车轮转得慢、劲大。齿轮不凭空多出功率，只是在“快”和“有劲”之间换。</p>`,
        bind: () => quizBind('q3a', 1, '小齿轮转 1 圈推过去 19 个齿，大齿圈有 65 个齿，所以只转了 19 ÷ 65 ≈ 0.29 圈。和转得多快没关系，这个比例永远不变。'),
        live: (n) => set('q2a', `中间轴 = 车轮 ${hl(f0(n.W))} × 65 ÷ 19 = ${rs(f0(n.C))} rpm`),
      },
      // ---- 3 电机 → 车轮
      {
        tags: ['mot', 'counter', 'diff', 'wheel'], hl: ['mot_rotor', 'counter', 'diff'], flows: false, mode: 'off',
        html: () => `
          <p class="stepnote"><b>这一步加上驱动电机。</b>中间轴上其实有<b>两个</b>齿轮：刚才的 19 齿，还有一个 54 齿的大齿轮。它们固定在同一根轴上，所以转速一样。电机轴头上的 22 齿小齿轮，咬着这个 54 齿。</p>
          <div class="chain"><span>驱动电机 22 齿</span><em>→</em><span>54 齿 ·（中间轴，同一根轴）· 19 齿</span><em>→</em><span>差速器 65 齿</span><em>→</em><span>车轮</span></div>
          ${calc(3, '两对齿轮串起来，倍数相乘', `${eq('q3x')}${eq('q3y')}<p>合起来：65 ÷ 19 × 54 ÷ 22 ≈ <b>${f2(CAR.Gm)}</b>。这就是“电机到车轮固定 8.40 倍”（官方数字 2.454 × 3.423 = 8.40）。</p>`)}
          <div class="kpis">${kpi('r-w', '车轮')}${kpi('r-c', '中间轴')}${kpi('r-m', '驱动电机')}</div>
          <p class="stepnote"><b>注意：</b>电机和车轮之间<b>没有离合器</b>，也没有别的挡可换。车一动电机就转，车速定了电机转速也定了。拖车速到 150 km/h，电机到 ${f0(S.motorRpm(150 / 3.6))} rpm，还在它的最高转速（约 13,300 rpm）以内，所以电机这边一个固定齿比就够用。</p>`,
        live: (n) => {
          set('q3x', `中间轴 = 车轮 ${hl(f0(n.W))} × 65 ÷ 19 = ${rs(f0(n.C))} rpm`);
          set('q3y', `电机 = 中间轴 ${hl(f0(n.C))} × 54 ÷ 22 = ${rs(f0(n.M))} rpm`);
        },
      },
      // ---- 4 发动机这边
      {
        tags: ['eng', 'gen', 'clu', 'ed', 'counter'], hl: ['edrive', 'input', 'gen_rotor'], flows: false, mode: 'gen',
        html: () => `
          <p class="stepnote"><b>这一步看发动机那根轴。</b>发动机的曲轴直接连着一根<b>输入轴</b>，轴上挂着两样东西：</p>
          ${calc('a', '发电机：永远跟着发动机', `<p>输入轴上的 60 齿，咬着发电机的 30 齿，中间没有离合器。所以发电机永远是发动机的 60 ÷ 30 = <b>2 倍</b>（这个 2 是本页假设）。</p>${eq('q4g')}`)}
          ${calc('b', '直驱齿轮：永远跟着车轮', `<p>还有一个 67 齿的<b>直驱齿轮</b>，它是<b>空套</b>在输入轴上的（轴转它可以不转），咬着中间轴那个 54 齿。所以它和电机一样，永远被车轮带着转。</p>${eq('q4e')}<p>合起来：65 ÷ 19 × 54 ÷ 67 ≈ <b>${f2(CAR.Ge)}</b>（更精确是 2.757）。这就是“发动机到车轮固定 2.757 倍”里的那个数，不过现在它还只是直驱齿轮的转速，和发动机没关系。</p>`)}
          ${ctl('ng3', '发动机转速', 1000, 4500, 50, nGen)}
          <p class="pt">跟着<b>车轮</b>的一组</p>
          <div class="kpis">${kpi('r-w', '车轮')}${kpi('r-c', '中间轴')}${kpi('r-m', '驱动电机')}${kpi('r-e', '直驱齿轮')}</div>
          <p class="pt">跟着<b>发动机</b>的一组</p>
          <div class="kpis">${kpi('r-i', '发动机')}${kpi('r-g', '发电机')}</div>
          <p class="stepnote"><b>动手试：</b>拖<b>车速</b>，只有上面一组在变；拖<b>发动机转速</b>，只有下面一组在变。两组之间只隔着一个<b>离合器</b>：它的一半在输入轴上，另一半连着直驱齿轮。现在它是分开的，所以两组各转各的。</p>`,
        bind: () => bind('ng3', (x) => { nGen = x; }, (x) => `${x} rpm`),
        live: (n) => {
          set('q4g', `发电机 = 发动机 ${hl(f0(nE))} × 2 = ${rs(f0(nE * CAR.Gg))} rpm`);
          set('q4e', `直驱齿轮 = 中间轴 ${hl(f0(n.C))} × 54 ÷ 67 = ${rs(f0(n.L))} rpm`);
        },
      },
      // ---- 5 合上离合器
      {
        tags: ['eng', 'gen', 'clu', 'ed'], hl: ['edrive', 'input'], flows: true, mode: 'gen',
        html: () => `
          <p class="stepnote"><b>这一步只加离合器。</b>离合器就是两组叠在一起的摩擦片，一组跟输入轴（发动机），一组跟直驱齿轮（车轮）。<b>分开</b>时两边各转各的；<b>压紧</b>后变成一个整体，两边转速必须一样。</p>
          ${quiz('q3b', '车速 80 km/h，离合器合上以后，发动机是多少转？', ['看油门，踩得深就转得快', `约 ${f0(S.lockRpm(K80))} rpm，只由车速决定`, `和驱动电机一样，约 ${f0(S.motorRpm(K80))} rpm`, `和车轮一样，约 ${f0(S.rad2rpm(S.wheelW(K80)))} rpm`])}
          <div class="btns" role="group" aria-label="发动机">${btn('e-off', '发动机熄火', false)}${btn('e-gen', '发电（离合器分开）', true)}${btn('e-lock', '合上离合器（直驱）', false)}</div>
          ${ctl('ng3', '发电时转速', 1000, 4500, 50, nGen)}
          <p class="mini" id="msg3"></p>
          <div class="kpis">${kpi('r-e', '直驱齿轮（车轮那边）')}${kpi('r-i', '发动机')}${kpi('r-g', '发电机')}</div>
          ${plot('p3', 132, `离合器两边的转速 <span>${key('#58e0a0', '直驱齿轮（跟着车轮）')} ${key('#ff9d3c', '发动机')}</span>`)}
          ${calc(5, '合上以后', `${eq('q5a')}<p>把前面几步连起来：车速 → 车轮转速 → × ${f2(CAR.Ge)} → 直驱齿轮 → 离合器压紧 → 发动机。每一环都是固定的，所以<b>发动机转速被车速钉死</b>，每 1 km/h 对应约 ${f1(S.rpmPerKmh)} rpm。</p>`)}
          <p class="stepnote"><b>动手试：</b>① 现在两条线是分开的，拖“发电时转速”，橙线动、绿线不动。② 点“合上离合器”：发电机先把发动机拉到和绿线一样高（同步），再压紧。③ 合上以后拖车速，两条线一起走；这时“发电时转速”滑块不再起作用。</p>`,
        bind: () => {
          quizBind('q3b', 1, `合上以后，发动机和直驱齿轮是一个整体。直驱齿轮永远是车轮的 ${f2(CAR.Ge)} 倍，所以发动机也是：${f0(S.rad2rpm(S.wheelW(K80)))} × ${f2(CAR.Ge)} ≈ ${f0(S.lockRpm(K80))} rpm。油门这时只改变发动机出多大的力，改不了转速。`);
          bind('ng3', (x) => { nGen = x; }, (x) => `${x} rpm`);
          $('e-off').onclick = () => pickMode('off'); $('e-gen').onclick = () => pickMode('gen'); $('e-lock').onclick = () => pickMode('lock');
          p3 = new Plot($('p3'), { l: 40, b: 18, t: 8 });
        },
        live: (n) => set('q5a', clutch === 'locked'
          ? `发动机 = 直驱齿轮 = 车轮 ${hl(f0(n.W))} × ${f2(CAR.Ge)} = ${rs(f0(n.L))} rpm（≈ ${hl(Math.round(v * 3.6))} km/h × ${f1(S.rpmPerKmh)}）`
          : `现在还没合上：直驱齿轮 ${hl(f0(n.L))} rpm，发动机 ${hl(f0(nE))} rpm，相差 ${rs(f0(Math.abs(n.L - nE)))} rpm`),
      },
      // ---- 6 后果：只有一个挡
      {
        tags: ['eng', 'clu', 'ed'], hl: ['edrive', 'input'], flows: true, mode: 'auto',
        html: () => `
          <p class="stepnote"><b>最后一步：这有什么后果。</b>发动机转速被车速钉死，倍数还只有一个。把各个车速对应的发动机转速列出来：</p>
          <div class="tw"><table><thead><tr><th>车速</th><th>合上时发动机转速</th><th>能不能合</th></tr></thead><tbody>${[20, 40, 60, 80, 100, 120].map((k) => `<tr><th>${k} km/h</th><td>${f0(S.lockRpm(k / 3.6))} rpm</td><td>${k < 45 ? '太低，不合' : '可以'}</td></tr>`).join('')}</tbody></table></div>
          ${quiz('q3c', '在 20 km/h 的小路上，能不能合上离合器让发动机直接推车？', ['能：电脑会自动换到低挡', '能：多踩点油门，把转速拉上去就行', `不能：发动机只有约 ${f0(S.lockRpm(20 / 3.6))} rpm，转得太慢，会抖甚至熄火`, '能：离合器可以只合上一半，一直打滑着用'])}
          <p class="mini" id="msg3"></p>
          <div class="kpis">${kpi('r-e', '直驱齿轮')}${kpi('r-i', '发动机')}</div>
          <p class="stepnote"><b>和普通汽油车比：</b>普通车有好几个挡（或一套无级变速），就是为了不管车速多少，都能让发动机待在合适的转速。这里只有一个固定倍数，相当于只有<b>最高挡</b>。所以低速、起步、急加速都不合离合器，交给电机；发动机只管发电，转速想定多少定多少（第 4 步）。</p>
          <p class="stepnote"><b>下一章接着问：</b>表里写“可以”不等于“划算”。合上以后发动机转速没得选，只能靠油门调出力，不一定落在省油的地方。${CH('engmap')}看这件事，${CH('highway')}算什么车速以上合上才真的省。</p>`,
        bind: () => quizBind('q3c', 2, '没有低挡可换；合上以后油门改不了转速（第 5 步）；一直打滑会把摩擦片烧掉，这个离合器只用来“合”或“分”。所以低速就是不合，车由电机推。'),
      },
    ];

    const show = (k, top) => {
      step = k; p3 = null;
      const d = DEF[k];
      STEP3.forEach((_, i) => $(`s3-${i}`).setAttribute('aria-pressed', i === k));
      $('s3').innerHTML = `${d.html()}
        <div class="pn">${k > 0 ? btn('s3-pv', `← ${STEP3[k - 1]}`) : '<span></span>'}${k < DEF.length - 1 ? btn('s3-nx', `下一步：${STEP3[k + 1]} →`) : '<span class="mini">六步走完了。下面是补充说明。</span>'}</div>`;
      if ($('s3-pv')) $('s3-pv').onclick = () => show(k - 1, true);
      if ($('s3-nx')) $('s3-nx').onclick = () => show(k + 1, true);
      if (d.bind) d.bind();
      if (d.mode === 'auto') { pickMode('gen'); if (v * 3.6 >= 45) pickMode('lock'); else msg('现在车速低于 45 km/h，离合器合不上，车由电机推。把车速拖到 45 km/h 以上，它会自动同步、合上。', 'warn'); } else pickMode(d.mode);
      A.setTags(d.tags.map((x) => TAG[x]), (g) => A.showPart(g));
      s.highlight(d.hl);
      A.setLegend(d.flows ? LEG_FLOW : '');
      if (top) { const sd = $('side'); if (sd) sd.scrollTop = 0; }
    };
    STEP3.forEach((_, i) => { $(`s3-${i}`).onclick = () => show(i); });
    A.partHost = 'part3';
    A.setSlow('3D 转动慢放 ×40');
    show(0);

    return {
      tick(dt) {
        t += dt;
        const nLock = S.lockRpm(v);
        if (mode === 'off') nE = Math.max(0, nE - 2500 * dt);
        else if (mode === 'gen') {
          nE += clamp(nGen - nE, -2500 * dt, 2500 * dt);
          if (step === 5 && v * 3.6 >= 45) pickMode('lock');   // 第 6 步：车速够了就自动合上
        } else {
          if (v * 3.6 < 45) { pickMode('gen'); msg('车速掉到 45 km/h 以下，离合器自动分开，回到发电模式。', 'warn'); }
          else if (clutch === 'sync') { nE += clamp(nLock - nE, -1500 * dt, 1500 * dt); if (Math.abs(nLock - nE) < 20) { clutch = 'locked'; msg(`已接合：发动机 = 直驱齿轮 = ${f0(nLock)} rpm。现在拖车速滑块，发动机转速会跟着变。`, 'ok'); } }
          else nE = nLock;
        }
        // 能量：按匀速工况估算
        let st;
        const F = S.roadForce(v);
        if (mode === 'off' || v < .3) {
          const m = S.motorDcDemand(v, F);
          st = { v, nE, eng: false, spin: nE > 50, clutch, Pw: F * v, Pe: 0, fuel: 0, Pgen: 0, Pmot: m.Pac, Pbat: m.Pdc + AUX };
        } else if (clutch === 'locked') {
          const d = S.direct(v);
          st = { v, nE, eng: true, spin: true, clutch, Pw: F * v, Pe: d.Pe, fuel: d.fuel || 0, Pgen: AUX, Pmot: 0, Pbat: 0 };
        } else {
          const m = S.motorDcDemand(v, F), D = m.Pdc + AUX;
          const g = S.genChain(Math.max(D, 3000) * 1.2, nE > 900 ? nE : 1000);
          st = { v, nE, eng: nE > 900, spin: nE > 50, clutch, Pw: F * v, Pe: Math.max(D, 3000) * 1.2, fuel: S.fuelPower(Math.max(nE, 1000), Math.max(D, 3000) * 1.2 / S.rpm2rad(Math.max(nE, 1000))), Pgen: g.Pdc, Pmot: m.Pac, Pbat: D - g.Pdc };
        }
        animate(A, dt, st, 40, null, !DEF[step].flows);
        A.tagsUpdate(['ecvt']);
        const nW = S.rad2rpm(S.wheelW(v));
        const n = { W: nW, C: nW * R3.F, M: nW * CAR.Gm, L: nLock };
        set('r-w', unit(f0(n.W), 'rpm')); set('r-m', unit(f0(n.M), 'rpm')); set('r-c', unit(f0(n.C), 'rpm'));
        set('r-e', unit(f0(nLock), 'rpm')); set('r-i', unit(f0(nE), 'rpm')); set('r-g', unit(f0(nE * CAR.Gg), 'rpm'));
        if (DEF[step].live) DEF[step].live(n);
        hist.push(t, nLock, nE);
        if (p3 && Math.round(t * 30) % 2 === 0) {
          const x = hist.x, x0 = x[0], x1 = Math.max(x0 + 8, x[x.length - 1]);
          const ymax = Math.max(4000, ...hist.col(0), ...hist.col(1)) * 1.08;
          p3.clear().scale(x0, x1, 0, ymax).axes({ yt: niceTicks(0, ymax, 4), yf: (y) => y >= 1000 ? `${y / 1000}k` : y, yl: 'rpm' });
          p3.line(x, hist.col(0), '#58e0a0', 2).line(x, hist.col(1), '#ff9d3c', 2, clutch === 'locked' ? [5, 4] : null);
        }
      },
      leave() { s.setFlows({}); s.setClutch('open'); s.highlight(null); A.setTags([]); A.partHost = null; },
    };
  },
};

// ---------------------------------------------------------------- 第 4 章 发动机效率图
function etaColor(e) {
  const st = [[0, [14, 26, 48]], [.22, [22, 54, 92]], [.29, [27, 96, 128]], [.33, [31, 138, 138]], [.36, [63, 191, 127]], [.385, [183, 216, 74]], [.40, [255, 209, 102]]];
  if (e <= 0) return [11, 22, 40];
  for (let i = 1; i < st.length; i++) if (e <= st[i][0]) {
    const [a, ca] = st[i - 1], [b, cb] = st[i], k = (e - a) / (b - a);
    return ca.map((c, j) => Math.round(c + (cb[j] - c) * k));
  }
  return st[st.length - 1][1];
}
/** 发动机效率图：热力底图 + 等效率线 + 外特性 + 最优工作线 */
class EngMap {
  constructor(canvas) {
    this.p = new Plot(canvas, { l: 38, b: 22, t: 8, r: 8 });
    this.nx = [1000, 6400]; this.ty = [0, 135];
    this._bg = null; this._w = 0;
  }
  _base() {
    const p = this.p; p.clear().scale(this.nx[0], this.nx[1], this.ty[0], this.ty[1]);
    const { l, r, t, b } = p.pad, W = Math.round(p.w - l - r), H = Math.round(p.h - t - b);
    if (this._bg && this._w === p.w && this._h === p.h) return this._bg;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), img = g.createImageData(W, H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const n = this.nx[0] + (i + .5) / W * (this.nx[1] - this.nx[0]);
      const T = this.ty[1] - (j + .5) / H * (this.ty[1] - this.ty[0]);
      const ok = T <= S.engTmax(n);
      const c = ok ? etaColor(S.engEta(n, T)) : [11, 22, 40];
      const k = (j * W + i) * 4; img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // 等效率线（marching squares）
    const NX = 108, NY = 54, grid = [];
    for (let j = 0; j <= NY; j++) { grid.push([]); for (let i = 0; i <= NX; i++) {
      const n = this.nx[0] + i / NX * (this.nx[1] - this.nx[0]), T = this.ty[0] + j / NY * (this.ty[1] - this.ty[0]);
      grid[j].push(T <= S.engTmax(n) ? S.engEta(n, T) : 0);
    } }
    const X = (i) => i / NX * W, Y = (j) => H - j / NY * H;
    g.strokeStyle = 'rgba(232,238,247,.55)'; g.lineWidth = 1;
    g.font = '10px "IBM Plex Mono",monospace'; g.fillStyle = 'rgba(232,238,247,.85)';
    const TX = { .25: .78, .30: .70, .33: .60, .35: .50, .37: .38, .38: .30, .39: .22 };
    for (const lv of [.25, .30, .33, .35, .37, .38, .39]) {
      const tx = TX[lv];
      g.beginPath();
      let lab = null;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const a = grid[j][i], b2 = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
        const pts = [];
        const e = (v1, v2, x1, y1, x2, y2) => { if ((v1 - lv) * (v2 - lv) < 0) { const k = (lv - v1) / (v2 - v1); pts.push([x1 + (x2 - x1) * k, y1 + (y2 - y1) * k]); } };
        e(a, b2, X(i), Y(j), X(i + 1), Y(j)); e(b2, c, X(i + 1), Y(j), X(i + 1), Y(j + 1)); e(c, d, X(i + 1), Y(j + 1), X(i), Y(j + 1)); e(d, a, X(i), Y(j + 1), X(i), Y(j));
        if (pts.length >= 2) {
          g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]);
          const sc = (q) => Math.abs(q[0] - tx * W) - .35 * q[1];
          if (!lab || sc(pts[0]) < sc(lab)) lab = pts[0];
        }
      }
      g.stroke();
      if (lab) { const tx = `${Math.round(lv * 100)}%`, tw = g.measureText(tx).width; g.fillStyle = 'rgba(11,22,40,.6)'; g.fillRect(lab[0] + 2, lab[1] - 7, tw + 4, 13); g.fillStyle = 'rgba(232,238,247,.92)'; g.fillText(tx, lab[0] + 4, lab[1] + 3); }
    }
    this._bg = cv; this._w = p.w; this._h = p.h;
    return cv;
  }
  draw(pts, extra) {
    const p = this.p, bg = this._base();
    p.clear().scale(this.nx[0], this.nx[1], this.ty[0], this.ty[1]);
    p.g.drawImage(bg, p.pad.l, p.pad.t);
    p.axes({ xt: [1000, 2000, 3000, 4000, 5000, 6000], xf: (v) => `${v / 1000}k`, yt: [0, 40, 80, 120], xl: 'rpm', yl: 'N·m' });
    const ns = []; const ts = [];
    for (let n = 1000; n <= 6400; n += 50) { ns.push(n); ts.push(S.engTmax(n)); }
    p.line(ns, ts, '#e8eef7', 1.6);
    const on = S.OOL_TABLE.filter((o) => o.P <= 70e3);
    p.line(on.map((o) => o.n), on.map((o) => o.T), '#4cc3ff', 2, [6, 4]);
    if (extra) extra(p);
    for (const q of pts) if (q && isFinite(q.n) && isFinite(q.T)) { p.dot(q.n, q.T, q.c, 5.5); p.label(q.n, q.T, q.t, q.c, { dx: 8, dy: q.dy || -10 }); }
  }
}

const engmap = {
  id: 'engmap', nav: '发动机效率', view: 'engine',
  title: '把发动机和车轮“脱开”有什么好处',
  lead: '发动机的效率取决于<b>转速和扭矩两个数</b>。直连车轮时转速被车速定死，只能在一条竖线上找点；脱开以后，同样的功率可以挑一个最省油的点去发电。',
  body: () => `
    ${ctl('sp4', '车速', 20, 140, 1, 50)}
    ${ctl('ad4', '加速另需', 0, 40, 1, 0)}
    <div class="btns" role="group" aria-label="看哪一个工作点">${btn('w-s', '三维里看串联工作点', true)}${btn('w-d', '三维里看直驱工作点', false)}</div>
    ${plot('p4', 250, `发动机效率图 <span>${key('#4cc3ff', '最优工作线')} ${key('#c78bff', '串联：挑最好的点')} ${key('#58e0a0', '直驱：只能在竖线上')}</span>`)}
    <div class="grid2"><div class="kpis">${kpi('k4-sn', '串联转速')}${kpi('k4-se', '串联效率')}</div><div class="kpis">${kpi('k4-dn', '直驱转速')}${kpi('k4-de', '直驱效率')}</div></div>
    <p class="mini" id="msg4"></p>`,
  notes: () => `
    ${note('为什么这样做', 'a', `<p>发动机在<b>中低转速、接近满负荷</b>时最省油：节气门开得大、泵气损失小，摩擦损失占比也小。轻负荷时（图的下半部分）效率掉得很快。普通汽油车高速巡航大多就在这片低效区里。</p><p>串联模式下，发电机可以把发动机的负荷加到合适的大小，转速也不用跟着车速走，所以能沿着蓝色虚线（每个功率下最省油的点）运行。</p>`)}
    ${note('效率图是怎么来的', 'c', `<p>本田没有公开这台发动机的效率图。这张图是按平均有效压力模型画的：指示效率 × (有效压力 ÷ (有效压力 + 摩擦 + 泵气))，再加上低速大负荷爆震、高速满负荷加浓两个修正。模型的最高点约 ${(S.ENG_BEST.eta * 100).toFixed(1)}%（${f0(S.ENG_BEST.n)} rpm、${f0(S.ENG_BEST.T)} N·m），和混动专用阿特金森发动机公开的 40% 上下是一个量级，但每个点的具体数字别当真。</p>`)}
    ${note('什么时候失效', 'b', '<p>脱开不是白送的：发动机的功率要先变成电、再变回机械能，每一道都有损耗（第 5 章算）。另外为了安静，低速时发动机转速不能太高，本页给串联点加了一个随车速变化的转速上限（本页假设）。冷车时发动机还要先暖机、暖催化器，那段时间也不在最优线上。</p>')}`,
  enter(A) {
    const s = A.stage;
    let v = 50 / 3.6, add = 0, show = 's';
    const map = new EngMap($('p4'));
    let ser, dir, Pe;
    const upd = () => {
      const F = S.roadForce(v) + (add > 0 ? add * 1000 / v : 0);
      const m = S.motorDcDemand(v, F);
      const g = S.engineForDc(m.Pdc + AUX, S.nvhCap(v));
      ser = { n: g.op.n, T: g.op.T, eta: S.engEta(g.op.n, g.op.T) };
      Pe = g.Pe;
      const dPw = F * v;
      const nL = S.lockRpm(v), wL = S.rpm2rad(nL);
      const dd = S.direct(v);
      const PeD = (dPw + dd.Pmot) / CAR.etaMesh ** 2 + dd.Pgen;
      const TD = PeD / wL;
      dir = { n: nL, T: TD, eta: nL >= 1050 && TD <= S.engTmax(nL) ? S.engEta(nL, TD) : NaN, Pe: PeD };
      map.draw([{ n: ser.n, T: ser.T, c: '#c78bff', t: `串联 ${(ser.eta * 100).toFixed(1)}%` }, { n: dir.n, T: Math.min(dir.T, 133), c: '#58e0a0', t: isFinite(dir.eta) ? `直驱 ${(dir.eta * 100).toFixed(1)}%` : '直驱：不可行', dy: 12 }], (p) => {
        p.vline(nL, '#58e0a0', [4, 3], 1.4);
        const ns = [], ts = [];
        for (let n = 1000; n <= 6400; n += 40) { const T = Pe / S.rpm2rad(n); if (T < 135) { ns.push(n); ts.push(T); } }
        p.line(ns, ts, 'rgba(199,139,255,.75)', 1.2, [2, 3]);
      });
      set('k4-sn', unit(f0(ser.n), 'rpm')); set('k4-se', unit(f1(ser.eta * 100), '%'));
      set('k4-dn', unit(f0(dir.n), 'rpm')); set('k4-de', isFinite(dir.eta) ? unit(f1(dir.eta * 100), '%') : unit('—', ''));
      const t = !isFinite(dir.eta) ? (dir.n < 1050 ? `${Math.round(v * 3.6)} km/h 时直驱的发动机只有 ${f0(dir.n)} rpm，转不起来。` : `这个车速下发动机最大扭矩也不够推，只能交给电机。`)
        : `同样约 ${f1(Pe / 1000)} kW：串联挑的点比直驱高 ${f1((ser.eta - dir.eta) * 100)} 个百分点。但串联要多绕“发电 → 再驱动”一道，第 5 章看这笔账谁赢。`;
      $('msg4').textContent = t;
    };
    bind('sp4', (x) => { v = x / 3.6; upd(); }, (x) => `${x} km/h`);
    bind('ad4', (x) => { add = x; upd(); }, (x) => (x ? `+${x} kW` : '匀速'));
    $('w-s').onclick = () => { show = 's'; group(['w-s', 'w-d'], 'w-s'); };
    $('w-d').onclick = () => { show = 'd'; group(['w-s', 'w-d'], 'w-d'); };
    let rs = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(rs); rs = requestAnimationFrame(upd); });
    ro.observe($('p4'));
    A.setSlow('3D 转动慢放 ×30 · 燃烧室在做功行程发光');
    return {
      tick(dt) {
        const q = show === 's' ? ser : dir;
        const ok = q && isFinite(q.eta) && q.n >= 1000;
        const st = { v, nE: ok ? q.n : 0, eng: ok, spin: ok, clutch: show === 'd' && ok ? 'locked' : 'open', Pw: 0, Pe: 0, fuel: 0, Pgen: 0, Pmot: 0, Pbat: 0 };
        animate(A, dt, st, 30);
        A.stage.setFlows({});
      },
      leave() { ro.disconnect(); },
    };
  },
};

// ---------------------------------------------------------------- 第 5 章 高速为什么直连
const STRAT = { series: ['串联跟随负荷', '#c78bff'], buffer: ['串联发电 + 纯电交替', '#ffb547'], dbuf: ['直驱顺便充电 + 纯电交替', '#4cc3ff'], direct: ['一直直驱', '#58e0a0'] };
let _curve = null;
/** 4 种策略在 40–140 km/h 的平路匀速油耗，以及模型选哪个（只算一次） */
function stratCurve() {
  if (_curve) return _curve;
  const xs = [], L = { series: [], buffer: [], dbuf: [], direct: [] }, pick = [];
  for (let k = 40; k <= 140; k += 2) {
    const vv = k / 3.6, b = S.bestAt(vv);
    xs.push(k);
    L.series.push(S.l100(b.s.fuel, vv)); L.buffer.push(b.b.ok ? S.l100(b.b.fuel, vv) : NaN);
    L.dbuf.push(b.db.ok ? S.l100(b.db.fuel, vv) : NaN); L.direct.push(b.d.ok ? S.l100(b.d.fuel, vv) : NaN);
    pick.push(b.pick);
  }
  const first = (p) => { const i = pick.findIndex((q) => p.includes(q)); return i < 0 ? null : xs[i]; };
  _curve = { xs, L, pick, xDir: first(['dbuf', 'direct']), xPure: first(['direct']) };
  return _curve;
}
function chainRows(v) {
  const s = S.seriesFollow(v), d = S.direct(v);
  const Pw = s.Pw;
  const m = s.m, g = s.g;
  const motShaft = m.w * m.T;
  const ser = [
    ['车轮需要', Pw, '#e8eef7'],
    ['电机轴', motShaft, '#58e0a0'],
    ['电机输入', m.Pac, '#c78bff'],
    ['直流母线', s.D, '#ffb547'],
    ['发电机输出', s.D + S.invLoss(s.D), '#c78bff'],
    ['发电机轴', s.Pe * CAR.etaMesh, '#58e0a0'],
    ['发动机输出', s.Pe, '#58e0a0'],
    ['燃油', s.fuel, '#ff5a5a'],
  ];
  const dir = d.ok ? [
    ['车轮需要', Pw, '#e8eef7'],
    ['加电机空转', Pw + d.Pmot, '#58e0a0'],
    ['加两级齿轮', (Pw + d.Pmot) / CAR.etaMesh ** 2, '#58e0a0'],
    ['发动机输出', d.Pe, '#58e0a0'],
    ['燃油', d.fuel, '#ff5a5a'],
  ] : null;
  return { s, d, ser, dir };
}
const highway = {
  id: 'highway', nav: '高速为什么直连', view: 'drive',
  title: '高速巡航：直接推车比“发电再驱动”更省',
  lead: '串联模式多绕一道：发动机 → 发电机 → 逆变器 → 逆变器 → 电机，每一道都损耗。车速越高，电机转得越快、负荷却很轻，效率越差。到了某个车速，直驱这条短路更划算。',
  body: () => `
    ${ctl('sp5', '巡航车速', 40, 140, 1, 100)}
    <div class="mode" id="mb5"><span class="dot" id="md5"></span><div><b id="mt5"></b><p id="mp5"></p></div></div>
    <div class="wf" id="wf5"></div>
    <div class="kpis">${kpi('k5-s', '串联油耗')}${kpi('k5-d', '直驱油耗')}${kpi('k5-x', '直驱省')}</div>
    <div><p class="pt">比“串联跟随负荷”省多少（平路匀速，本页模型）</p><p class="pt">${Object.values(STRAT).map(([t, c]) => key(c, t)).join(' ')}</p><div class="plotwrap"><canvas id="p5" style="height:200px"></canvas></div></div>`,
  notes: () => `
    ${note('为什么这样做', 'o', '<p>本田官方的解释：高速巡航需要的驱动力小，这时用发动机直驱比让电机高速旋转效率更高。官方资料还点名了一般串联方式的毛病——高速巡航时负荷虽轻，电机却要高速旋转，只好让发动机多发电，效率不好。</p>')}
    ${note('上面的账是怎么算的', 'c', '<p>电机损耗 = 铜损 + 永磁铁损 + 逆变器开关带来的谐波损耗 + 高速弱磁电流的铜损；逆变器损耗 = 1.5% + 120 W。直驱时电机逆变器关断，电机零电流空转，只剩铁损。风阻 CdA = 0.70 m²、滚阻 0.0095。这些系数按同级车常见量级取，所以“交叉车速”只是个量级。</p>')}
    ${(() => { const c = stratCurve(); return note('模型给出的分工', 'c', `<ul><li><b>约 ${c.xDir ? c.xDir - 2 : '?'} km/h 以下</b>：串联发电 + 纯电交替最省（第 6 章）。</li><li><b>约 ${c.xDir} km/h 起</b>：合上离合器直驱，顺便多带点负荷给电池充电，充满了熄火纯电跑一段，再起动、同步、合上。</li><li><b>约 ${c.xPure} km/h 起</b>：一直直驱。阻力已经够大，发动机本身就在高效区，不用再“多带负荷”。</li></ul><p>有车主在平路匀速时观察到大约 70 km/h（43 mph）就进直驱（论坛帖子，车主观察），和模型的量级一致。直驱时电池也可以进出一点电，车主论坛里也有这样的描述。</p>`); })()}
    ${note('依赖的假设', 'c', '<p>分界点会随假设移动：风阻越大、电机高速损耗越大，直驱越早划算；发动机低负荷效率越差，直驱越晚划算；电池容量和起停代价也会挪动“交替”策略的位置。所以这些车速只是量级。</p>')}
    ${note('什么时候失效', 'b', '<ul><li>要加速、上坡：一个高挡的发动机扭矩不够，马上退回混动（感觉像降挡）。</li><li>电池电量低：直驱时可以让发电机顺便充电，但电量太低时会改用混动多发电。</li><li>车速很高时（比如 140 km/h 以上）阻力大，发动机满负荷也可能不够，电机会从电池补电（boost）。</li></ul>')}`,
  enter(A) {
    const s = A.stage;
    let v = 100 / 3.6;
    const cv = stratCurve(), xs = cv.xs;
    const rel = {};
    for (const k of Object.keys(STRAT)) rel[k] = cv.L[k].map((y, i) => (isFinite(y) ? (1 - y / cv.L.series[i]) * 100 : NaN));
    const p5 = new Plot($('p5'), { l: 34, b: 20, t: 8 });
    p5.hover = { x: xs, xf: (x) => `${x} km/h`, series: Object.entries(STRAT).map(([k, [n, c]]) => ({ n, c, y: cv.L[k], f: (y) => (isFinite(y) ? `${y.toFixed(2)} L/100km` : '—') })) };
    let st = null;
    const upd = () => {
      const r = chainRows(v);
      const mx = Math.max(...r.ser.map((q) => q[1]));
      const rows = (arr) => arr.map(([t, P, c]) => `<div class="r"><span>${t}</span><span class="bar"><i style="width:${(P / mx * 100).toFixed(1)}%;background:${c}"></i></span><span>${f1(P / 1000)} kW</span></div>`).join('');
      $('wf5').innerHTML = `<h5 style="color:#c78bff">串联：链路效率 ${f1(r.s.Pw / r.s.Pe * 100)}%，发动机 ${f1(r.s.eta * 100)}%（${f0(r.s.n)} rpm）</h5>${rows(r.ser)}`
        + (r.dir ? `<h5 style="color:#58e0a0">直驱：链路效率 ${f1(r.d.Pw / r.d.Pe * 100)}%，发动机 ${f1(r.d.eta * 100)}%（${f0(r.d.n)} rpm）</h5>${rows(r.dir)}` : '<h5 class="warn">这个车速直驱转不起来</h5>');
      const ls = S.l100(r.s.fuel, v), ld = r.d.ok ? S.l100(r.d.fuel, v) : NaN;
      set('k5-s', unit(f2(ls), 'L/100km')); set('k5-d', unit(f2(ld), 'L/100km'));
      set('k5-x', isFinite(ld) ? unit(`${ld < ls ? '' : '−'}${f1(Math.abs(1 - ld / ls) * 100)}`, '%') : unit('—', ''));
      const b = S.bestAt(v);
      const m = b.pick === 'direct' || b.pick === 'dbuf' ? 'ENG' : 'HYB';
      $('md5').style.background = STRAT[b.pick][1];
      $('mt5').textContent = `这个车速，本页模型会选：${STRAT[b.pick][0]}`;
      $('mp5').textContent = b.pick === 'buffer' ? `离合器分开，发动机在 ${f1(b.b.Pe / 1000)} kW 的高效点发电约 ${f0(b.b.f * 100)}% 的时间，多的电存进电池，再熄火纯电跑。第 6 章细看。`
        : b.pick === 'dbuf' ? `离合器合上直驱，发动机负荷从 ${f0(b.d.T)} 加到 ${f0(b.db.T)} N·m（效率 ${f1(b.d.eta * 100)}% → ${f1(b.db.eta * 100)}%），多出来的给电池充电；约 ${f0(b.db.f * 100)}% 的时间开着，其余时间熄火纯电。`
        : b.pick === 'direct' ? `离合器一直合着，发动机 ${f0(b.d.n)} rpm 直接推车，比串联跟随少烧 ${f1((1 - b.d.fuel / b.s.fuel) * 100)}%。` : '发动机跟着负荷发电。';
      st = m === 'ENG' ? { ...presetENG(v * 3.6) } : { v, nE: b.s.n, eng: true, spin: true, clutch: 'open', Pw: b.s.Pw, Pe: b.s.Pe, fuel: b.s.fuel, Pgen: b.s.D, Pmot: b.s.m.Pac, Pbat: 0 };
      p5.clear().scale(40, 140, -6, 24).axes({ xt: [40, 60, 80, 100, 120, 140], yt: [-5, 0, 5, 10, 15, 20], yf: (y) => `${y}%`, xl: 'km/h', zero: true });
      for (const [k, [, c]] of Object.entries(STRAT)) p5.line(xs, rel[k], c, k === 'series' ? 1.4 : 2.2, k === 'series' ? [4, 4] : null);
      if (cv.xDir) { p5.vline(cv.xDir, 'rgba(76,195,255,.6)', [2, 3]); p5.label(cv.xDir, 21, `${cv.xDir} km/h 起用直驱`, '#4cc3ff', { dx: 4 }); }
      p5.vline(v * 3.6, '#e8eef7', [4, 3], 1.2);
    };
    bind('sp5', (x) => { v = x / 3.6; upd(); }, (x) => `${x} km/h`);
    const ro = new ResizeObserver(() => upd()); ro.observe($('p5'));
    A.setSlow('3D 转动慢放 ×15');
    A.setLegend(LEG_FLOW);
    return {
      tick(dt) { if (st) animate(A, dt, st, 15); },
      leave() { ro.disconnect(); s.setFlows({}); s.setClutch('open'); },
    };
  },
};

// ---------------------------------------------------------------- 第 6 章 小电池：间歇发电
const buffer = {
  id: 'buffer', nav: '电池当缓冲', view: 'drive',
  title: '中低速：发动机“开一会儿、停一会儿”',
  lead: '低速巡航只要几 kW，让发动机这么轻地转着很浪费。更好的办法：在高效点<b>多发一些电</b>，一部分推车、一部分存进电池；存够了就<b>熄火纯电</b>，电用完再起动。',
  body: () => `
    ${ctl('sp6', '巡航车速', 20, 90, 1, 50)}
    <div class="btns" role="group" aria-label="策略">${btn('s-b', '间歇发电', true)}${btn('s-f', '发动机跟着负荷', false)}</div>
    ${plot('p6a', 120, `电池电量 <span>${key('#ffb547', '间歇')} ${key('#c78bff', '跟随')}</span>`)}
    ${plot('p6b', 120, `发动机功率 <span>${key('#ffb547', '间歇')} ${key('#c78bff', '跟随')}</span>`)}
    <div class="kpis">${kpi('k6-b', '间歇油耗')}${kpi('k6-f', '跟随油耗')}${kpi('k6-on', '开机时间')}${kpi('k6-cy', '每个循环')}</div>
    <p class="mini" id="msg6"></p>`,
  notes: () => `
    ${note('为什么这样做', 'a', '<p>同样发 1 kWh 电，发动机在 20 多 kW、约 39% 效率的点上发，比在 5 kW、30% 出头的点上发省得多。多出来的电进电池要损失一点（充放电各几个百分点），但比发动机轻负荷的浪费小。这就是电池在混动车里的主要作用：<b>把发动机的工作点和车轮需要的功率错开</b>。</p>')}
    ${note('依赖的假设', 'c', `<p>电池按约 1 kWh、每个循环用掉 10% 电量来算；每次起动额外算 ${S.START_PENALTY_J / 1000} kJ 燃油（起动、暖催化器、过渡加浓）。本田没公布电池容量和真实的起停策略，这些都是本页假设。图里的时间被加速了 6 倍。</p>`)}
    ${note('什么时候失效', 'b', '<ul><li>电池太小、太冷或太热时，能吞吐的功率有限，循环会变短、起停更频繁。</li><li>冷车时发动机要暖机暖催化器，冬天要暖风，发动机会多转。</li><li>为了安静，低速时发动机转速不能拉太高（本页加了随车速的上限）。</li><li>车速高到直驱更省的时候（第 5 章），就不走这条路了。</li></ul>')}`,
  enter(A) {
    let v = 50 / 3.6, strat = 'b';
    const pa = new Plot($('p6a'), { l: 34, b: 18, t: 6 }), pb = new Plot($('p6b'), { l: 34, b: 18, t: 6 });
    const hist = rolling(600);
    let sim;
    const reset = () => {
      const b = S.seriesBuffer(v), f = S.seriesFollow(v);
      sim = { t: 0, socB: 0.55, socF: 0.55, on: true, fuelB: 0, fuelF: 0, dist: 0, b, f, onT: 0, cyc: [], lastOn: 0 };
      hist.clear();
      set('k6-b', b.ok ? unit(f2(S.l100(b.fuel, v)), 'L/100km') : '—');
      set('k6-f', unit(f2(S.l100(f.fuel, v)), 'L/100km'));
      set('k6-on', b.ok ? unit(f0(b.f * 100), '%') : '—');
      set('k6-cy', b.ok ? unit(f0(b.period), 's') : '—');
      $('msg6').textContent = b.ok ? `间歇时发动机在 ${f1(b.Pe / 1000)} kW、${f0(b.n)} rpm（效率 ${f1(b.eta * 100)}%）运转；跟随负荷时只需 ${f1(f.Pe / 1000)} kW、效率 ${f1(f.eta * 100)}%。间歇比跟随省 ${f1((1 - b.fuel / f.fuel) * 100)}%（已扣掉电池进出的损耗和起停代价）。` : '';
    };
    bind('sp6', (x) => { v = x / 3.6; reset(); }, (x) => `${x} km/h`);
    $('s-b').onclick = () => { strat = 'b'; group(['s-b', 's-f'], 's-b'); };
    $('s-f').onclick = () => { strat = 'f'; group(['s-b', 's-f'], 's-f'); };
    A.setSlow('时间加速 ×6 · 3D 转动慢放 ×15');
    A.setLegend(LEG_FLOW);
    const SPEED = 6;
    return {
      tick(dt) {
        const b = sim.b, f = sim.f, h = dt * SPEED;
        if (!b.ok) return;
        const E = S.batWh * 3600;
        // 间歇：开机时在 Pon 发电，电量到上限熄火；熄火时纯电，电量到下限起动
        const D = b.D;
        if (sim.on) { sim.socB += b.stored / E * h; if (sim.socB >= .55 + S.BUF_WINDOW / 2) sim.on = false; } else { sim.socB -= b.drain / E * h; if (sim.socB <= .55 - S.BUF_WINDOW / 2) sim.on = true; }
        sim.t += h;
        hist.push(sim.t, sim.socB * 100, sim.socF * 100, sim.on ? b.Pe / 1000 : 0, f.Pe / 1000);
        if (Math.round(sim.t * 10) % 3 === 0) {
          const x = hist.x, x0 = x[0], x1 = Math.max(x0 + 60, x[x.length - 1]);
          pa.clear().scale(x0, x1, 40, 70).axes({ yt: [45, 55, 65], yf: (y) => `${y}%` });
          pa.line(x, hist.col(1), '#c78bff', 1.6, [5, 4]).line(x, hist.col(0), '#ffb547', 2);
          pb.clear().scale(x0, x1, 0, Math.max(30, b.Pe / 1000 * 1.15)).axes({ yt: niceTicks(0, Math.max(30, b.Pe / 1000 * 1.15), 3), yl: 'kW' });
          pb.line(x, hist.col(3), '#c78bff', 1.6, [5, 4]).line(x, hist.col(2), '#ffb547', 2);
        }
        let st;
        if (strat === 'f') {
          st = { v, nE: f.n, eng: true, spin: true, clutch: 'open', Pw: f.Pw, Pe: f.Pe, fuel: f.fuel, Pgen: f.D, Pmot: f.m.Pac, Pbat: 0 };
        } else if (sim.on) {
          st = { v, nE: b.n, eng: true, spin: true, clutch: 'open', Pw: b.Pw, Pe: b.Pe, fuel: S.fuelPower(b.n, b.T), Pgen: b.g.Pdc, Pmot: b.m.Pac, Pbat: D - b.g.Pdc };
        } else {
          st = { v, nE: 0, eng: false, spin: false, clutch: 'open', Pw: b.Pw, Pe: 0, fuel: 0, Pgen: 0, Pmot: b.m.Pac, Pbat: D };
        }
        animate(A, dt, st, 15);
      },
      leave() { A.stage.setFlows({}); },
      _reset: reset,
    };
  },
};
// enter 里要先 reset 一次
const _bufEnter = buffer.enter;
buffer.enter = (A) => { const r = _bufEnter(A); r._reset(); return r; };

// ---------------------------------------------------------------- 第 7 章 试驾
const PRESETS = {
  start: { t: '起步到 40', pedal: .35, cruise: null, grade: 0, soc: .55, v: 0, after: { at: 40, cruise: 40 } },
  city: { t: '市区 40 匀速', pedal: 0, cruise: 40, grade: 0, soc: .5, v: 40 },
  hwy: { t: '高速 100 匀速', pedal: 0, cruise: 100, grade: 0, soc: .55, v: 100 },
  pass: { t: '100 → 130 超车', pedal: 1, cruise: null, grade: 0, soc: .55, v: 100, after: { at: 128, cruise: 120 } },
  climb: { t: '高速上坡 5%', pedal: 0, cruise: 90, grade: .05, soc: .5, v: 90 },
  down: { t: '长下坡 −6%（电池快满）', pedal: 0, cruise: 70, grade: -.06, soc: .76, v: 70 },
  low: { t: '电量低，市区 30', pedal: 0, cruise: 30, grade: 0, soc: .36, v: 30 },
};
const drive = {
  id: 'drive', nav: '试驾', view: 'drive',
  title: '自己开一下：电脑每一刻在选哪条路',
  lead: '踩油门、定速巡航、改坡度，看电脑怎么在 EV、混动、直驱、回收之间切换，以及它为什么这么选。',
  body: () => `
    <div class="btns">${Object.entries(PRESETS).map(([k, p]) => btn(`ps-${k}`, p.t)).join('')}</div>
    <div class="mode"><span class="dot" id="d-dot"></span><div><b id="d-mode"></b><p id="d-why"></p></div></div>
    <div class="kpis">${kpi('d-v', '车速')}${kpi('d-ne', '发动机')}${kpi('d-nm', '驱动电机')}${kpi('d-fi', '瞬时油耗')}${kpi('d-fa', '本次平均')}</div>
    <div><p class="pt">电池电量 <b id="d-soc"></b></p><div class="socbar"><i id="d-socb"></i><em style="left:42%"></em><em style="left:80%"></em></div></div>
    ${fdHtml('fd7')}
    ${ctl('d-ped', '油门', 0, 100, 1, 0)}
    <div class="btns">${btn('d-brk', '按住刹车')}${btn('d-cr', '定速巡航', false)}${btn('d-nd', '禁止直驱（对比）', false)}</div>
    ${ctl('d-crv', '巡航车速', 20, 140, 5, 60)}
    ${ctl('d-gr', '坡度', -8, 8, .5, 0)}
    ${plot('p7', 150, `最近 60 秒 <span>${key('#e8eef7', '车速 km/h')} ${key('#ff9d3c', '发动机 rpm ÷ 40')}</span><span>底部色条 = 模式</span>`)}`,
  notes: () => `
    ${note('电脑怎么选（本页的简化版）', 'c', '<ol style="margin:0;padding-left:1.2em;font-size:13.5px;line-height:1.7;color:#c6d2e2"><li>松油门或踩刹车：回收。电池快满又在下长坡时，让发电机拖着熄火的发动机空转，把多的能量耗掉。</li><li>车速 ≥ 约 62 km/h、匀速、直驱比串联省 3% 以上：合离合器直驱（先同步转速）。</li><li>需求超过纯电门槛，或电量低于 42%：起动发动机，按最优工作线发电，顺便把电量往 58% 拉。</li><li>其余情况：纯电。起停之间留了几秒的滞后，免得来回切。</li></ol>')}
    ${note('真车和这里的差别', 'd', '<p>本田的真实策略还要考虑驾驶感受（发动机转速跟着车速和油门“像换挡一样”升降）、噪音、电池和催化器温度、暖风需求等，标定表没有公开。这里的门槛值是我按公开描述和车主观察定的，用来演示逻辑，不是复刻。</p><p>“下长坡电池满了让发电机拖发动机”这一条，是车主们普遍观察到的现象（下坡时发动机空转作响），本田没有详细说明，属于推测。</p>')}
    ${note('在你的车上怎么观察', 'b', '<p>仪表或中控的能量流画面会显示现在是哪种模式（具体叫法和位置看你车的说明书）。可以在高速上把车速稳在 80~100 km/h，留意直驱出现的时刻；再轻踩油门加速，看它退回混动。</p>')}`,
  enter(A) {
    const fd = new FlowDia('fd7');
    let S0 = S.makeDrive();
    const cmd = { pedal: 0, brake: 0, cruise: null, grade: 0, noDirect: false };
    let after = null;
    const ped = bind('d-ped', (x) => { cmd.pedal = x / 100; if (x > 0 && cmd.cruise != null) { cmd.cruise = null; $('d-cr').setAttribute('aria-pressed', false); } }, (x) => `${x}%`);
    const crv = bind('d-crv', (x) => { if (cmd.cruise != null) cmd.cruise = x; }, (x) => `${x} km/h`);
    const gr = bind('d-gr', (x) => { cmd.grade = x / 100; }, (x) => `${x > 0 ? '+' : ''}${x}%`);
    $('d-cr').onclick = () => {
      if (cmd.cruise == null) { cmd.cruise = Math.max(20, Math.round(S0.v * 3.6 / 5) * 5) || crv.get(); crv.set(cmd.cruise); ped.set(0); cmd.cruise = crv.get(); S0.iv = 0; $('d-cr').setAttribute('aria-pressed', true); } else { cmd.cruise = null; $('d-cr').setAttribute('aria-pressed', false); }
    };
    $('d-nd').onclick = () => { cmd.noDirect = !cmd.noDirect; $('d-nd').setAttribute('aria-pressed', cmd.noDirect); };
    const brk = $('d-brk');
    brk.classList.add('hold');
    const bOn = (e) => { e.preventDefault(); cmd.brake = .5; brk.setAttribute('aria-pressed', true); if (cmd.cruise != null) { cmd.cruise = null; $('d-cr').setAttribute('aria-pressed', false); } };
    const bOff = () => { cmd.brake = 0; brk.removeAttribute('aria-pressed'); };
    brk.addEventListener('pointerdown', bOn); brk.addEventListener('pointerup', bOff); brk.addEventListener('pointerleave', bOff); brk.addEventListener('pointercancel', bOff);
    const hist = rolling(600);
    const p7 = new Plot($('p7'), { l: 32, b: 18, t: 6 });
    const preset = (k) => {
      const p = PRESETS[k];
      S0 = S.makeDrive(); S0.v = p.v / 3.6; S0.soc = p.soc;
      if (p.cruise != null && p.v >= 62 && p.grade === 0) { S0.mode = 'ENG'; S0.clutch = 'locked'; S0.eng = true; S0.nE = S.lockRpm(S0.v); }
      ped.set(p.pedal * 100);
      cmd.cruise = p.cruise; if (p.cruise != null) crv.set(p.cruise);
      $('d-cr').setAttribute('aria-pressed', p.cruise != null);
      gr.set(p.grade * 100);
      after = p.after || null;
      hist.clear();
    };
    for (const k in PRESETS) $(`ps-${k}`).onclick = () => preset(k);
    preset('hwy');
    A.setSlow('车速和油耗按真实时间算 · 3D 转动慢放 ×12');
    A.setLegend(LEG_FLOW);
    let acc = 0;
    return {
      tick(dt) {
        // 仿真用小步长
        const n = Math.max(1, Math.ceil(dt / .02));
        for (let i = 0; i < n; i++) S.driveStep(S0, cmd, dt / n);
        if (after && S0.v * 3.6 >= after.at) { ped.set(0); cmd.cruise = after.cruise; crv.set(after.cruise); $('d-cr').setAttribute('aria-pressed', true); S0.iv = 0; after = null; }
        const m = S0.mode;
        const st = { v: S0.v, nE: S0.nE, eng: S0.eng && S0.Pe > 0 && S0.nE > 600, spin: S0.nE > 50, clutch: S0.clutch, Pw: S0.Pw, Pe: S0.Pe, fuel: S0.fuelGs * ENG.LHV / 1000, Pgen: S0.Pgen, Pmot: S0.Pmot, Pbat: S0.Pbat };
        animate(A, dt, st, 12, fd);
        $('d-dot').style.background = MODE_COL[m] || '#888';
        set('d-mode', MODE_CN[m] || m);
        set('d-why', S0.ecuWhy);
        set('d-v', unit(f0(S0.v * 3.6), 'km/h'));
        set('d-ne', S0.nE > 50 ? unit(f0(S0.nE), 'rpm') : unit('停', ''));
        set('d-nm', unit(f0(S.motorRpm(S0.v)), 'rpm'));
        set('d-fi', S0.fuelGs > 0 && S0.v > 1 ? unit(f1(S0.fuelGs / ENG.rhoF / 1000 / S0.v * 1e5), 'L/100km') : unit(S0.fuelGs > 0 ? f2(S0.fuelGs) : '0', S0.fuelGs > 0 ? 'g/s' : ''));
        set('d-fa', S0.distM > 200 ? unit(f2(S0.fuelG / ENG.rhoF / 1000 / (S0.distM / 1e5)), 'L/100km') : unit('—', ''));
        set('d-soc', `${f0(S0.soc * 100)}%`);
        $('d-socb').style.width = `${(S0.soc * 100).toFixed(1)}%`;
        acc += dt;
        hist.push(S0.t, S0.v * 3.6, S0.nE / 40, m);
        if (acc > .08) {
          acc = 0;
          const x = hist.x, x1 = x[x.length - 1], x0 = x1 - 60;
          p7.clear().scale(x0, x1, 0, 160).axes({ yt: [0, 40, 80, 120, 160] });
          const g = p7.g;
          for (let i = 1; i < x.length; i++) {
            const md = hist.ys[i][2];
            g.fillStyle = MODE_COL[md] || '#555';
            const a = p7.X(Math.max(x[i - 1], x0)), b = p7.X(x[i]);
            if (b > p7.pad.l) g.fillRect(Math.max(a, p7.pad.l), p7.h - p7.pad.b - 6, b - Math.max(a, p7.pad.l) + .5, 6);
          }
          p7.line(x, hist.col(1), '#ff9d3c', 1.6).line(x, hist.col(0), '#e8eef7', 2);
        }
      },
      leave() { A.stage.setFlows({}); A.stage.setClutch('open'); },
    };
  },
};

// ---------------------------------------------------------------- 第 8 章 对比与边界
const archSvg = (kind) => {
  const box = (x, y, w, t, c = 'var(--line)') => `<rect x="${x}" y="${y}" width="${w}" height="24" rx="4" style="stroke:${c}"/><text x="${x + w / 2}" y="${y + 12}" text-anchor="middle" dominant-baseline="central">${t}</text>`;
  const ln = (d, c) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="2.4"/>`;
  const m = '#58e0a0', e = '#c78bff';
  let body = '';
  if (kind === 'epower') body = ln('M70 18H96', m) + ln('M146 18H170', e) + ln('M220 18H244', m) + box(6, 6, 64, '发动机') + box(96, 6, 50, '发电机') + box(170, 6, 50, '电机') + box(244, 6, 50, '车轮');
  if (kind === 'ehev') body = ln('M70 18H96', m) + ln('M146 18H170', e) + ln('M220 18H244', m) + ln('M38 30V48H269V30', m) + box(6, 6, 64, '发动机') + box(96, 6, 50, '发电机') + box(170, 6, 50, '电机') + box(244, 6, 50, '车轮') + `<rect x="130" y="40" width="60" height="16" rx="3" style="fill:var(--panel);stroke:${m}"/><text x="160" y="48" text-anchor="middle" dominant-baseline="central">离合器</text>`;
  if (kind === 'ths') body = ln('M70 18H96', m) + ln('M156 18H244', m) + ln('M126 30V48H150', m) + ln('M200 48H220V30', e) + box(6, 6, 64, '发动机') + box(96, 6, 60, '行星齿轮') + box(150, 36, 50, '发电机') + box(196, 6, 48, '电机') + box(244, 6, 50, '车轮');
  return `<svg class="dia" viewBox="0 0 300 62" role="img" aria-label="结构简图">${body}</svg>`;
};
const compare = {
  id: 'compare', nav: '对比和边界', view: 'home',
  title: '和其他混动比，以及这套逻辑什么时候会变',
  lead: '一句话：e:HEV 是<b>“以串联为主、高速时多一条直连”</b>。它和纯串联、功率分流两种路线各有取舍。',
  body: () => `
    <div><p class="pt">日产 e-POWER：纯串联</p>${archSvg('epower')}</div>
    <div><p class="pt">本田 e:HEV：串联 + 一个直连挡</p>${archSvg('ehev')}</div>
    <div><p class="pt">丰田 THS：行星齿轮功率分流</p>${archSvg('ths')}</div>
    <div class="tw"><table>
      <thead><tr><th></th><th>e-POWER</th><th>e:HEV</th><th>THS</th></tr></thead>
      <tbody>
        <tr><th>发动机能直接推车吗</th><td>不能</td><td>高速巡航时能，一个固定挡</td><td>一直有一部分机械直传</td></tr>
        <tr><th>驾驶感</th><td>纯电动车的感觉</td><td>大部分时候像电动车，高速像一辆高挡汽油车</td><td>发动机转速和车速关联较弱</td></tr>
        <tr><th>高速巡航</th><td>全部要绕电，吃亏</td><td>直连，损耗少</td><td>大部分机械直传，效率也好</td></tr>
        <tr><th>结构</th><td>最简单</td><td>多一个离合器和一对齿轮</td><td>行星齿轮，控制最复杂</td></tr>
      </tbody></table></div>`,
  notes: () => `
    ${note('三条路线各自的取舍', 'b', '<ul><li><b>纯串联（e-POWER）</b>：结构最简单，驾驶感最“电”；代价是高速时所有能量都要转两次，高速油耗吃亏。适合城市为主。</li><li><b>串联 + 直连（e:HEV）</b>：只多一个离合器，就把高速这块短板补上；代价是直连只有一个挡，中速大负荷时帮不上忙（后来本田在 CR-V 上加了第二个直驱挡）。这是本田的主流路线。</li><li><b>功率分流（THS）</b>：行星齿轮让发动机功率随时按比例分成机械和电两路，覆盖的工况最全；代价是机构和控制最复杂。丰田大量量产多年，是业界最主流的强混方案。</li></ul>')}
    ${note('这套逻辑什么时候会变', 'b', '<ul><li><b>冷车、冬天开暖风</b>：发动机要先暖机、暖催化器，还要提供暖风热量，即使不需要动力也会运转。</li><li><b>电池电量低</b>：EV 模式门槛降低，发动机更多地发电。</li><li><b>电池满、下长坡</b>：回收不进去了，回收力度变弱，或者（车主观察）让发电机拖着发动机空转耗能。</li><li><b>上坡、加速、载重</b>：直驱的一个高挡扭矩不够，退回混动。</li><li><b>很低速（大约 45 km/h 以下）</b>：直驱时发动机转速太低，物理上就不合适。</li><li><b>运动模式</b>：电脑会让发动机更早起动、转速更高，省油让位给响应。</li></ul>')}
    ${note('来源', '', `<ol class="sources">
      <li><a href="https://www.honda.co.jp/Fit/common/pdf/fit_spec_list.pdf" target="_blank" rel="noopener">本田：飞度主要诸元表（PDF）</a>：功率、扭矩、变速比 2.454 / 0.805、减速比 3.423、锂离子 48 单体、油箱 40 L</li>
      <li><a href="https://global.honda/en/tech/two_motor_hybrid_system_honda_eHEV/" target="_blank" rel="noopener">Honda：e:HEV 技术说明</a>：三种模式、直驱齿比相当于手动挡最高挡、高速巡航直驱更高效</li>
      <li><a href="https://www.honda.co.jp/factbook/auto/ACCORD/202002/P23.pdf" target="_blank" rel="noopener">本田雅阁 factbook（e:HEV 与一般串联方式的比较）</a></li>
      <li><a href="https://car-me.jp/articles/22485" target="_blank" rel="noopener">car-me：飞度动力总成解说</a>：2022 年 10 月小改款功率变化</li>
      <li><a href="https://bestcarweb.jp/?p=1625707" target="_blank" rel="noopener">ベストカーWeb：飞度 e:HEV 的三种行驶模式</a></li>
      <li><a href="https://motor-fan.jp/?p=206823" target="_blank" rel="noopener">Motor-Fan：e:HEV 和 THS、e-POWER 的区别</a></li>
      <li><a href="https://www.marklines.com/statics/teardown/ltec_pdf_078.pdf" target="_blank" rel="noopener">エルテック：FIT e:HEV PCU 拆解</a>：电池约 172 V，升压到最高约 570 V</li>
      <li><a href="https://www.honda.co.jp/rescue-auto/fit-hybrid/fit-ehev202002.pdf" target="_blank" rel="noopener">本田：FIT e:HEV 救援手册</a>：高压电池在后部地板下，最高约 173 V</li>
      <li><a href="https://www.electrichybridvehicletechnology.com/news/feature-under-the-skin-of-the-new-sixth-generation-honda-cr-v.html" target="_blank" rel="noopener">E&amp;H Vehicle Technology：新 CR-V 增加低速直驱挡</a></li>
      <li><a href="https://www.hondaforums.co.uk/viewtopic.php?p=8143" target="_blank" rel="noopener">Honda Forums UK：车主观察约 43 mph 进直驱</a>（论坛，车主观察）</li>
    </ol>`)}`,
  enter(A) {
    A.setSlow('3D 转动慢放 ×20');
    A.setLegend(LEG_FLOW);
    const st = presetENG(100);
    return { tick(dt) { animate(A, dt, st, 20); }, leave() { A.stage.setFlows({}); A.stage.setClutch('open'); } };
  },
};

export const CHAPTERS = [overview, modes, ecvt, engmap, highway, buffer, drive, compare];
