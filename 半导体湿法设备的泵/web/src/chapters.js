// 八章：总览 → 离心 → 磁力联轴器 → 磁悬浮 → 波纹管 → 气动隔膜 → 电磁计量 → 怎么选。
// 每章：舞台怎么摆（view）、讲义（lead / body / notes）、实验逻辑（enter 返回 tick / leave / tools）。
import { Plot, C, niceTicks } from './chart.js';
import * as S from './sim.js';

const $ = (id) => document.getElementById(id);
const EV = { a: '公认', b: '专利 / 厂家资料', c: '本页简化', d: '我的推测' };
const ev = (k) => `<span class="ev ${k}">${EV[k]}</span>`;
const note = (title, ks, html) => `<div class="note"><h3>${title}${(ks || '').split('').map(ev).join('')}</h3>${html}</div>`;
const ctl = (id, label, min, max, step, val) =>
  `<label class="ctl"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output id="${id}-o"></output></label>`;
const kpis = (list) => `<div class="kpis">${list.map(([id, k]) => `<div class="kpi"><div class="k">${k}</div><div class="v" id="${id}">–</div></div>`).join('')}</div>`;
const plot = (id, h, legend = '') => `<div class="plotwrap"><p class="pt">${legend}</p><canvas id="${id}" style="height:${h}px"></canvas></div>`;
const sw = (c) => `<i style="background:${c}"></i>`;
const seg = (id, items, cur) => `<div class="seg" id="${id}">${items.map(([v, t, sm]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${t}${sm ? `<small>${sm}</small>` : ''}</button>`).join('')}</div>`;
const f1 = (x) => x.toFixed(1), f0 = (x) => Math.round(x).toString(), f2 = (x) => x.toFixed(2), f3 = (x) => x.toFixed(3);
const pat = (n) => `<a class="rf" href="#src-${n}">[${n}]</a>`;

function range(id, fmt, fn) {
  const el = $(id), out = $(`${id}-o`);
  const upd = () => { out.textContent = fmt(+el.value); fn(+el.value); };
  el.addEventListener('input', upd);
  return { el, upd, get v() { return +el.value; }, set(v) { el.value = v; upd(); } };
}

function segBind(id, fn) {
  const box = $(id);
  box.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      fn(b.dataset.v);
    };
  });
}

export const PUMPINFO = {
  P1: { cn: '磁力泵', en: 'mag-drive pump', how: '叶轮旋转 · 离心', wet: 'PTFE / PFA + 陶瓷轴' },
  P2: { cn: '磁悬浮泵', en: 'bearingless pump', how: '转子悬浮旋转 · 离心', wet: 'PFA / PTFE' },
  P3: { cn: '波纹管泵', en: 'bellows pump', how: '左右往复 · 容积式', wet: 'PTFE / PFA' },
  P4: { cn: '气动隔膜泵', en: 'AODD pump', how: '左右往复 · 容积式', wet: 'PTFE' },
  P5: { cn: '电磁计量泵', en: 'solenoid metering', how: '脉冲推隔膜 · 容积式', wet: 'PVDF / PTFE + 陶瓷球' },
};

// 来源（页面最后一章列出全文）
export const SOURCES = [
  ['US5464333A', 'Iwaki：Magnet pump with rear thrust bearing member', 'https://patents.google.com/patent/US5464333'],
  ['US6843645B2', 'Iwaki：Cooling system for a magnetic pump', 'https://patents.google.com/patent/US6843645'],
  ['US7249939B2', 'Iwaki：Rear casing arrangement for magnetic drive pump', 'https://patents.google.com/patent/US7249939'],
  ['US4812108A', 'Seikow：Magnet pump', 'https://patents.google.com/patent/US4812108'],
  ['US6100618A', 'Sulzer Electronics / Lust（后归 Levitronix）：Rotary machine with an electromagnetic rotary drive', 'https://patents.google.com/patent/US6100618'],
  ['US6053705A', 'Sulzer Electronics / Lust：Rotary pump and process to operate it', 'https://patents.google.com/patent/US6053705'],
  ['US12188475B2', 'Levitronix：Centrifugal pump and a pump housing', 'https://patents.google.com/patent/US12188475'],
  ['US12345270B2', 'Iwaki：Pump（磁力联轴器 + 主动磁轴承）', 'https://patents.google.com/patent/US12345270'],
  ['US6874997B2', 'Iwaki：Pump system using a control fluid to drive a switching valve mechanism（双波纹管 + 空气换向）', 'https://patents.google.com/patent/US6874997'],
  ['US10408207B2', 'Nippon Pillar：Bellows pump device', 'https://patents.google.com/patent/US10408207'],
  ['US7374409B2', 'Nippon Pillar：Reciprocating pump', 'https://patents.google.com/patent/US7374409'],
  ['US6364640B1', 'Nippon Pillar：Pump with a pulsation suppression device', 'https://patents.google.com/patent/US6364640'],
  ['JPH11270459A', '日本ピラー工業：ポンプの脈動抑制装置', 'https://patents.google.com/patent/JPH11270459A/en'],
  ['US6142749A', 'Wilden：Air driven pumps and components therefor', 'https://patents.google.com/patent/US6142749'],
  ['US11448204B2', 'Yamada：Diaphragm pump with valve switching device', 'https://patents.google.com/patent/US11448204'],
  ['US5330330A', 'Iwaki：Electromagnetically operated fixed displacement pump', 'https://patents.google.com/patent/US5330330'],
  ['US6280147B1', 'Liquid Metronics：Apparatus for adjusting the stroke length of a pump element', 'https://patents.google.com/patent/US6280147'],
  ['US10677243B2', 'ProMinent：Displacement pump with forced venting', 'https://patents.google.com/patent/US10677243'],
  ['US2015/0159639A1', 'ProMinent：Metering system and metering pump therefor', 'https://patents.justia.com/patent/20150159639'],
  ['Iwaki 半导体手册', 'Iwaki 半导体产品手册（MD-F 等磁力泵）', 'https://www.iwaki.hk/catalog/images/download/SemiconPG-W0004-24.pdf'],
  ['Iwaki MDW', 'Iwaki MDW 系列（PFA 款 −10～120 °C）', 'https://pr.mono.ipros.com/iwakipumps/news/detail/191608/'],
  ['Levitronix BPS-600', 'Levitronix BPS-600（半导体湿法用，颗粒少 10～50 倍为厂家宣称）', 'https://pr.mono.ipros.com/en/levitronix/product/detail/2000056645/'],
  ['Chimia 2003', 'Gempp, Chimia 57 (2003)：Levitronix 无轴承泵在刻蚀、清洗、去胶中的应用（厂家人员撰写）', 'https://chimia.ch/chimia/article/download/2003_331/3006/13691'],
  ['Iwaki FS-N', 'Iwaki FS-N 空气驱动波纹管泵（最大 100 L/min，气压 0.2～0.7 MPa）', 'https://mono.ipros.com/product/detail/2917046'],
  ['Yamada PTFE', 'Yamada 高纯 PTFE 隔膜泵', 'https://www.yamadapump.com/ptfe/'],
  ['Iwaki EH-E', 'Iwaki EH-E 电磁计量泵（经销商页：75 L/h、行程 20～100 %、最高 360 次/分）', 'https://technology.bibus.com/ua-en/products/itm/eh-e-dosing-metering-pumps/'],
  ['Iwaki EWN-A', 'Iwaki EWN-A 自动排气型（双氧水、次氯酸钠不气锁）', 'https://pdf.directindustry.com/pdf/iwaki/ewn-a-series/5197-326705.html'],
];
const srcIdx = (code) => SOURCES.findIndex((s) => s[0] === code) + 1;
const P = (code) => pat(srcIdx(code));

// ================================================================ 00 总览
const ch0 = {
  id: 'overview', nav: '总览', title: '湿法设备里，泵在干什么',
  view: { pump: 'all' },
  lead: '湿法设备就是一池一池的药液：硫酸、氢氟酸、氨水、双氧水、超纯水……晶圆泡进去清洗或者腐蚀。泵在里面干三种活：把槽里的药液抽出来、过滤加热、再送回去（<b>循环</b>）；从药液罐往机台送（<b>供液</b>）；按毫升往槽里补一点（<b>计量</b>）。下面五台泵各管一摊，点名字直接去那一章。',
  body: () => `
    <div class="family">
      ${[['magnet', 'P1', '磁力泵', '隔着一层壳用磁铁带叶轮，循环的主力'], ['maglev', 'P2', '磁悬浮泵', '叶轮悬空，连轴承都没有'],
        ['bellows', 'P3', '波纹管泵', '左右动的那个，空气推手风琴'], ['aodd', 'P4', '气动隔膜泵', '波纹管泵的表兄弟，自己换向'],
        ['metering', 'P5', '电磁计量泵', '一下一小口，用来补药液']]
        .map(([id, p, t, s]) => `<button class="pick" type="button" data-go="${id}"><b>${t}</b><span>${s}</span></button>`).join('')}
    </div>
    <div class="card quiet"><h4>半导体对泵的四个硬要求</h4><p>
      ① <b>不掉渣</b>：几十纳米的颗粒落到晶圆上就可能是缺陷，所以要尽量少“两个面贴着磨”的地方。<br>
      ② <b>不溶出</b>：接触药液的零件用 PTFE、PFA 这类氟树脂，金属离子要管到极低的浓度。<br>
      ③ <b>不漏</b>：热硫酸、氢氟酸漏出来是安全事故，所以不用会磨损的“轴封”。<br>
      ④ <b>耐温耐腐蚀</b>：有的工艺药液在 100 °C 以上，塑料泵的强度和磁铁都会打折扣。</p></div>
    <p class="seglab">实验：过滤器慢慢堵了，“甩”和“挤”谁更稳？</p>
    ${ctl('clog', '滤芯堵塞', 0, 100, 1, 30)}
    ${plot('p0', 190, `<span>${sw(C.cf)}离心（磁力泵）</span><span>${sw(C.pd)}容积式（波纹管泵，0.5 MPa 气）</span>`)}
    ${kpis([['k0a', '离心 流量'], ['k0b', '容积 流量'], ['k0c', '离心 比干净时'], ['k0d', '容积 比干净时']])}`,
  notes: () => `
    ${note('两大家族：甩，还是挤', 'a', `<p><b>离心泵</b>（磁力泵、磁悬浮泵）靠转得快的叶轮把液体甩出去，出口压力来自速度。管路一堵，流量就明显往下掉，但出口不会憋出很高的压力。</p>
      <p><b>容积式泵</b>（波纹管、隔膜、计量泵）把一腔液体关起来挤出去，挤一下出多少基本是定的。管路堵了，它会使更大的劲接着挤，直到压力顶到上限（气压，或者电磁铁的力）。</p>`)}
    ${note('为什么不用普通水泵', 'a', `<p>普通泵的轴穿过泵壳，穿墙处靠机械密封（两个环贴着转）挡液体。贴着转就会磨损、掉渣，磨久了会漏。半导体用的泵几乎都在想办法<b>取消这个穿墙的轴</b>：磁力泵用磁铁隔墙传力，波纹管泵和隔膜泵用空气推一层膜，计量泵用电磁铁推隔膜。</p>`)}
    ${note('这个实验依赖的假设', 'c', `<p>同一条管路：抬高 2 m，加上随堵塞增长的阻力（阻力和流量平方成正比）。离心泵是本页的教学泵（关死扬程 18 m、最大 140 L/min），容积泵是 0.5 MPa 气压驱动的教学波纹管泵。两台泵大小不同，只比<b>趋势</b>，不比谁的绝对流量大。</p>`)}
    ${note('什么时候这个结论会反过来', 'd', `<p>容积泵也不是无限稳：出口压力一旦接近气压，它就越挤越慢、最后停住（第 5、6 章会看到）。而离心泵在流量很小时也能稳定工作，只是那时候效率低、发热多。</p>`)}`,
  enter(A) {
    A.setPins(['P1', 'P2', 'P3', 'P4', 'P5'].map((p) => {
      const o = A.spec.offset[p];
      const top = { P1: 330, P2: 380, P3: 540, P4: 420, P5: 300 }[p];
      const id = { P1: 'magnet', P2: 'maglev', P3: 'bellows', P4: 'aodd', P5: 'metering' }[p];
      return { t: PUMPINFO[p].cn, p: [o[0], o[1], top], onClick: () => A.go(id) };
    }));
    document.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => A.go(b.dataset.go); });
    A.stage.setFlows([]);
    const pl = new Plot($('p0'), { l: 44, b: 24 });
    const xs = Array.from({ length: 101 }, (_, i) => i / 100);
    const cf = xs.map((x) => S.clogCompare(x).cf.Q), pd = xs.map((x) => S.clogCompare(x).pd.Q);
    const r = range('clog', (v) => `${v} %`, (v) => {
      const x = v / 100, o = S.clogCompare(x), o0 = S.clogCompare(0);
      pl.clear().scale(0, 100, 0, 130).axes({ xt: niceTicks(0, 100, 5), yt: niceTicks(0, 130, 4), xl: '滤芯堵塞 %', yl: 'L/min' });
      pl.line(xs.map((q) => q * 100), cf, C.cf, 2).line(xs.map((q) => q * 100), pd, C.pd, 2);
      pl.vline(v, C.mute).dot(v, o.cf.Q, C.cf).dot(v, o.pd.Q, C.pd);
      pl.hover = { x: xs.map((q) => q * 100), xf: (q) => `堵塞 ${q.toFixed(0)} %`, series: [{ n: '离心', c: C.cf, y: cf, f: (q) => `${f0(q)} L/min` }, { n: '容积', c: C.pd, y: pd, f: (q) => `${f0(q)} L/min` }] };
      $('k0a').innerHTML = `${f0(o.cf.Q)}<small>L/min</small>`; $('k0b').innerHTML = `${f0(o.pd.Q)}<small>L/min</small>`;
      $('k0c').innerHTML = `${f0(o.cf.Q / o0.cf.Q * 100)}<small>%</small>`; $('k0d').innerHTML = `${f0(o.pd.Q / o0.pd.Q * 100)}<small>%</small>`;
    });
    r.upd();
    const D = A.stage.D;
    D.P1.rpm = 30; D.P1.slip = false; D.P2.on = true; D.P3.hold = null; D.P4.hold = null; D.P4.stall = 0; D.P5.L = 1; D.P5.gas = 0; D.P5.locked = false;
    return { tick() {}, tools: {} };
  },
};

// ================================================================ 01 离心
const kMap = (v) => 1e-4 * Math.pow(40, v / 100);       // 0..100 → 1e-4 .. 4e-3 m/(L/min)²
const ch1 = {
  id: 'centrifugal', nav: '甩：离心', title: '磁力泵①：叶轮把液体“甩”出去',
  view: { pump: 'P1', view: 'front', cut: 'front' },
  lead: '先别管磁铁，看叶轮。叶轮一转，叶片之间的液体被带着转，越往外圈跑得越快，像甩干桶把水甩到桶壁上。外面的<b>蜗壳</b>流道越走越宽，把“快”慢慢换成“压”，最后从切向的出口送出去。叶轮中心的液体被甩走、压力变低，进口的液体就被外面的压力推进来补位。',
  body: () => `
    ${ctl('rpm', '转速', 1500, 3600, 50, 2900)}
    ${ctl('res', '阀门 + 过滤器阻力', 0, 100, 1, 45)}
    ${ctl('hs', '要抬的高度', 0, 10, .5, 2)}
    ${plot('p1', 210, `<span>${sw(C.cf)}泵能给的扬程</span><span>${sw(C.mute)}2900 转</span><span>${sw(C.pd)}管路要的扬程</span><span>${sw(C.ok)}效率</span>`)}
    ${kpis([['k1q', '流量'], ['k1h', '扬程'], ['k1p', '出口压力（水）'], ['k1w', '轴功率']])}`,
  notes: () => `
    ${note('运行点 = 两条曲线的交点', 'a', `<p>泵的曲线是“给多大流量，我能抬多高”；管路的曲线是“要多大流量，你得抬多高”。泵自己不决定流量，<b>交点</b>才是实际流量。阀门关小、过滤器堵了，管路曲线变陡，交点往左走：流量少了，扬程反而高了。</p>`)}
    ${note('转速的三条规律', 'a', `<p>同一台泵，流量和转速成正比，扬程和转速平方成正比，功率和转速三次方成正比（相似定律）。所以变频调速省电：流量降 20 %，功率大约降一半。</p>`)}
    ${note('为什么叶片往后弯、蜗壳越来越宽', 'a', `<p>叶片往转向的反方向弯，扬程随流量平稳下降，功率不会随流量一路暴涨，电机不容易过载。蜗壳每转过一段，就多收进一段叶轮甩出来的液体，所以截面要越来越大，液体的速度才不会越来越快、白白损失掉。出口旁边那块尖角叫隔舌，把刚甩出来的液体和要出去的液体分开。</p>`)}
    ${note('本页这台泵', 'cb', `<p>关死扬程 18 m、最大 140 L/min、最高效率 45 %，是按小型树脂磁力泵的量级编的，不对应任何型号。作为参照，Iwaki 半导体用的 MD-F 系列标称最大流量在 125～135 L/min 一档 ${P('Iwaki 半导体手册')}。</p>`)}
    ${note('什么时候会失效', 'ab', `<ul>
      <li><b>气蚀</b>：叶轮中心压力低到液体沸点以下，就会冒气泡再被压碎，打坏叶轮、流量骤降。热药液离沸点近，更容易发生。</li>
      <li><b>不能自吸</b>：离心泵甩的是液体，泵里如果是空气就甩不出压力，开机前必须灌满液体。</li>
      <li><b>进气</b>：气泡比液体轻，会聚在叶轮中心和轴附近，冷却轴承的液体就不够了，Iwaki 的专利专门讲了这个问题 ${P('US6843645B2')}。</li>
      <li><b>出口全关</b>（憋泵）：电机的功率全变成热，泵里的液体越转越热，对树脂泵很危险。</li></ul>`)}`,
  enter(A) {
    A.setPins(A.pinsFor('P1', ['叶轮', '蜗壳', '进口', '出口']));
    A.stage.setFlows([{ pump: 'P1', key: 'main', speed: 150 }]);
    A.rampLegend();
    A.setSlow('转速放慢约 100 倍');
    const D = A.stage.D.P1; D.slip = false; D.circ = 0;
    const pl = new Plot($('p1'), { l: 40, b: 24, r: 34 });
    const st = { rpm: 2900, res: 45, hs: 2 };
    const draw = () => {
      const k = kMap(st.res), o = S.cfOperate({ rpm: st.rpm, Hs: st.hs, k });
      const Qs = Array.from({ length: 141 }, (_, i) => i);
      pl.clear().scale(0, 140, 0, 30).axes({ xt: niceTicks(0, 140, 7), yt: niceTicks(0, 30, 3), xl: '流量 L/min', yl: '扬程 m' });
      const hp = Qs.map((q) => S.pumpHead(q, st.rpm)), h0 = Qs.map((q) => S.pumpHead(q)), hsys = Qs.map((q) => st.hs + k * q * q);
      const eta = Qs.map((q) => S.pumpEta(q, st.rpm) * 60);
      pl.line(Qs, h0, C.mute, 1.2, [4, 4]).line(Qs, eta, C.ok, 1.2, [2, 3]).line(Qs, hp, C.cf, 2.2).line(Qs, hsys, C.pd, 2);
      if (!o.dead) pl.dot(o.Q, o.H, C.fg).label(o.Q, o.H, `运行点 ${f0(o.Q)} L/min`, C.fg);
      pl.g.fillStyle = C.ok; pl.g.textAlign = 'left'; pl.g.fillText('效率', pl.w - 30, pl.Y(27));
      pl.hover = { x: Qs, xf: (q) => `${q} L/min`, series: [{ n: '泵', c: C.cf, y: hp, f: (v) => `${f1(v)} m` }, { n: '管路', c: C.pd, y: hsys, f: (v) => `${f1(v)} m` }, { n: '效率', c: C.ok, y: eta, f: (v) => `${f0(v / .6)} %` }] };
      $('k1q').innerHTML = `${f0(o.Q)}<small>L/min</small>`; $('k1h').innerHTML = `${f1(o.H)}<small>m</small>`;
      $('k1p').innerHTML = `${f3(o.P)}<small>MPa</small>`; $('k1w').innerHTML = `${f0(o.shaftW || 0)}<small>W</small>`;
      D.rpm = 30 * st.rpm / 2900; D.flow = o.Q / 100;
    };
    range('rpm', (v) => `${v} rpm`, (v) => { st.rpm = v; draw(); }).upd();
    range('res', (v) => `${v} %`, (v) => { st.res = v; draw(); }).upd();
    range('hs', (v) => `${v} m`, (v) => { st.hs = v; draw(); }).upd();
    return { tools: {} };
  },
};

// ================================================================ 02 磁力联轴器
const LIQ = [['1.00', '水 / 稀药液'], ['1.16', '49 % 氢氟酸'], ['1.69', '85 % 磷酸'], ['1.84', '96 % 硫酸']];
const ch2 = {
  id: 'magnet', nav: '磁力联轴器', title: '磁力泵②：隔着一层壳转动',
  view: { pump: 'P1', view: 'long', cut: 'long' },
  lead: '普通泵的轴从电机一路穿进泵壳，穿墙处靠“轴封”挡液体，会磨、会漏。磁力泵把这个洞彻底取消：电机转<b>外磁铁</b>，外磁铁隔着一层封死的<b>隔离套</b>吸住里面的<b>内磁铁</b>一起转，叶轮就装在内磁铁上。液体被整个关在泵壳和隔离套里。注意看：红对蓝，异极相吸；转起来以后，里面那圈会落后外面一点角度。',
  body: () => `
    <p class="seglab">输送什么液体（比重越大越重）</p>
    <div class="presets" id="liq">${LIQ.map(([v, t]) => `<button class="btn" type="button" data-v="${v}">${t} · ${v}</button>`).join('')}</div>
    ${ctl('sg', '比重', 1, 1.9, .01, 1)}
    ${ctl('tmp', '液体温度', 20, 120, 1, 25)}
    ${ctl('res2', '阀门 + 过滤器阻力', 0, 100, 1, 45)}
    <p class="seglab">需要的扭矩 / 磁铁能传的最大扭矩</p>
    <div class="gauge" id="g2"><i></i><b style="left:100%"></b><span></span></div>
    ${kpis([['k2d', '内磁铁落后'], ['k2t', '需要扭矩'], ['k2m', '能传扭矩'], ['k2q', '流量']])}
    <div class="status" id="s2">–</div>
    <div class="btns"><button class="btn" id="b2r" type="button">停机再启动（重新同步）</button><button class="btn" id="b2d" type="button" aria-pressed="false">把泵抽空（干转）</button></div>
    <div class="gauge" id="g2h" hidden><i style="background:var(--warn)"></i><span>轴承温度（示意）</span></div>`,
  notes: () => `
    ${note('扭矩怎么隔着壳传过去', 'a', `<p>内外磁铁红对蓝、蓝对红互相吸着。外圈一转，内圈被“拽着”走，但要拽动叶轮得用力，所以内圈会落后一个角度 δ。能传的扭矩大致是 T<sub>max</sub>·sin(p·δ)，p 是极对数：落后得越多拽得越狠，落后到 90°/p 时到顶。本页用 8 极（p = 4），专利里没写极数，这是示意。</p>`)}
    ${note('为什么硫酸更难带', 'ac', `<p>流量和扬程（米）跟液体轻重无关，但抬起同样一米，重的液体要花更多功：功率和扭矩都跟比重成正比。96 % 硫酸比重约 1.84，同一个运行点，推液体的那部分扭矩是水的 1.84 倍，加上不随密度变的损耗，总扭矩大约是水的 1.8 倍。磁铁再遇上高温变弱（钕铁硼剩磁大约每度掉 0.1 %，扭矩按平方算），就可能带不动。实际选型会按比重和温度选磁铁规格。</p>`)}
    ${note('脱耦以后怎么办', 'b', `<p>负载超过能传的扭矩，内磁铁就“掉队”，之后外圈一圈圈扫过去，内圈只会原地抖、发热，流量没了。它不会自己追上，要<b>停机再启动</b>。Iwaki 的专利把这叫 step-out ${P('US12345270B2')}。</p>`)}
    ${note('隔离套为什么不用金属', 'b', `<p>磁铁扫过金属壳会在里面感应出涡流，白白发热、损失效率 ${P('US7249939B2')}。早期金属内衬的设计把壳做成两层打孔夹隔热层，说能把损耗减掉约一半 ${P('US4812108A')}。现在的做法是氟树脂内层接液，外面一层纤维增强的壳扛压力，再缠一道纤维带 ${P('US7249939B2')}。本页模型画了内外两层。</p>`)}
    ${note('轴承靠药液自己润滑、冷却', 'b', `<p>固定轴是陶瓷的，后端插在隔离套底部，前端由一个三爪支架托住；碳或陶瓷的滑动轴承压在内磁铁里跟着转 ${P('US6843645B2')}。叶轮背后压力高，一小股液体从内磁铁外圈的缝流到隔离套底，再穿过轴承的槽回到叶轮中心（压力低），一路把摩擦热带走 ${P('US5464333A')} ${P('US7249939B2')}。舞台上细的那股小点就是它。</p>`)}
    ${note('什么时候会失效', 'b', `<ul>
      <li><b>干转、进气</b>：没有液体，轴承和推力环干磨，热量出不去，会咬死或者把树脂泵壳烧变形；这时候再突然灌进液体，热冲击也伤泵 ${P('US5464333A')}。</li>
      <li><b>过载脱耦</b>：比重大、温度高、阀门开太大都会让扭矩逼近上限。</li>
      <li><b>隔离套变形</b>：受热受压鼓起来，就会蹭到里面转的磁铁，磁铁和壳之间的缝本来就窄 ${P('US7249939B2')}。</li></ul>`)}`,
  enter(A) {
    A.setPins(A.pinsFor('P1', ['外磁铁（主动）', '内磁铁（从动）', '隔离套', '固定轴 · 轴承', '叶轮', '电机']));
    A.stage.setFlows([{ pump: 'P1', key: 'main', speed: 150 }, { pump: 'P1', key: 'circ', speed: 70, size: 2.8 }]);
    A.rampLegend('<span>细的一股 = 冷却轴承的内部循环</span>');
    A.setSlow('转速放慢约 100 倍');
    const D = A.stage.D.P1; D.rpm = 30; D.circ = 1; D.flow = 1;
    const st = { sg: 1, temp: 25, res: 45, latched: false, dry: false, heat: 0 };
    const upd = () => {
      const c = S.coupling({ sg: st.sg, temp: st.temp, k: kMap(st.res), Hs: 2 });
      if (c.slip) st.latched = true;
      const slip = st.latched;
      D.slip = slip; D.lag = slip ? 0 : c.deg;
      D.flow = st.dry || slip ? 0 : c.Q / 100; D.circ = st.dry || slip ? 0 : 1;
      const g = $('g2'), pct = Math.min(1.2, c.ratio);
      g.querySelector('i').style.width = `${Math.min(100, pct / 1.2 * 100)}%`;
      g.querySelector('i').style.background = c.ratio >= 1 ? 'var(--warn)' : c.ratio > .85 ? 'var(--mid)' : 'var(--accent)';
      g.querySelector('b').style.left = `${100 / 1.2}%`;
      g.querySelector('span').textContent = `${f0(c.ratio * 100)} %`;
      $('k2d').innerHTML = slip ? '脱耦' : `${f1(c.deg)}<small>°</small>`;
      $('k2t').innerHTML = `${f2(c.T)}<small>N·m</small>`; $('k2m').innerHTML = `${f2(c.Tmax)}<small>N·m</small>`;
      $('k2q').innerHTML = `${slip || st.dry ? 0 : f0(c.Q)}<small>L/min</small>`;
      const s = $('s2');
      if (st.dry) { s.className = 'status bad'; s.textContent = '干转：没有液体流过轴承，摩擦热带不走。真机上要靠流量开关、电流监测或者液位联锁及时停泵。'; }
      else if (slip) { s.className = 'status bad'; s.textContent = c.slip ? '脱耦了：内磁铁追不上外磁铁，只在原地抖，流量为零。降低负载后，要停机再启动才能重新同步。' : '还处在脱耦状态。负载已经降下来了，按“停机再启动”重新同步。'; }
      else if (c.ratio > .85) { s.className = 'status'; s.textContent = `同步运转，但扭矩已用到 ${f0(c.ratio * 100)} %，余量很小。`; }
      else { s.className = 'status ok'; s.textContent = `同步运转：内磁铁落后 ${f1(c.deg)}°，扭矩用了 ${f0(c.ratio * 100)} %。`; }
    };
    const sg = range('sg', (v) => f2(v), (v) => { st.sg = v; upd(); });
    range('tmp', (v) => `${v} °C`, (v) => { st.temp = v; upd(); }).upd();
    range('res2', (v) => `${v} %`, (v) => { st.res = v; upd(); }).upd();
    sg.upd();
    document.querySelectorAll('#liq .btn').forEach((b) => { b.onclick = () => sg.set(+b.dataset.v); });
    $('b2r').onclick = () => { st.latched = false; upd(); };
    $('b2d').onclick = (e) => {
      st.dry = !st.dry; e.target.setAttribute('aria-pressed', st.dry); $('g2h').hidden = !st.dry; if (!st.dry) st.heat = 0; upd();
    };
    return {
      tools: {},
      tick(dt) {
        if (st.dry) {
          st.heat = Math.min(1, st.heat + dt * .12);
          const h = $('g2h'); h.querySelector('i').style.width = `${st.heat * 100}%`;
          h.querySelector('span').textContent = st.heat >= 1 ? '轴承过热（示意，不是实测时间）' : '轴承温度（示意）';
        }
      },
      leave() { D.slip = false; D.circ = 1; D.flow = 1; },
    };
  },
};

// ================================================================ 03 磁悬浮
const ch3 = {
  id: 'maglev', nav: '磁悬浮', title: '磁悬浮泵：叶轮悬在液体里',
  view: { pump: 'P2', view: 'long', cut: 'long' },
  lead: '磁力泵里还剩一处在磨：内磁铁套在固定轴上转，靠滑动轴承。磁悬浮泵把轴承也去掉了：<b>转子</b>（一圈磁铁 + 叶片）整个漂在液体里，什么都不碰。泵头外面一圈 L 形铁芯和线圈，一边推着它转，一边每秒上万次地量它偏了多少、把它推回中间。线圈的颜色是电流方向，跟着转子一起转。',
  body: () => `
    <p class="seglab">实验：把转子扶在正中间</p>
    <div class="btns"><button class="btn" id="b3k" type="button">液体冲它一下</button><button class="btn" id="b3c" type="button" aria-pressed="true">控制器：开</button></div>
    ${ctl('dly', '测量 + 计算延迟', .1, 3, .1, .2)}
    ${plot('p3', 200, `<span>${sw(C.cf)}转子偏离中心（µm）</span><span>${sw(C.warn)}碰到泵壳</span>`)}
    ${kpis([['k3m', '最大偏移'], ['k3s', '回到中间'], ['k3t', '不控制时翻倍时间']])}
    <div class="status" id="s3">–</div>`,
  notes: () => `
    ${note('为什么非要控制器', 'a', `<p>只靠永磁铁，不可能让一个东西在所有方向上都稳稳地浮着（Earnshaw 定理）。转子在定子里稍微偏一点，就会被偏的那一侧吸得更紧，越偏越吸。本页模型里，不控制的话偏差每 ${f1(Math.sqrt(S.LEV.m / S.LEV.ks) * 1000)} ms 左右放大约 2.7 倍，一百分之一秒出头就会撞到泵壳。</p>`)}
    ${note('哪几个方向在主动控制', 'b', `<p>专利里的做法：转子的 x、y 两个方向的位置和转速由线圈电流主动控制；上下方向和两个歪斜方向不用管，转子磁铁和定子铁芯之间的磁阻力会像“磁铁吸铁”一样把它拉回原位 ${P('US6100618A')} ${P('US12188475B2')}。定子是大约 6 个 L 形铁芯，长腿竖着绕线圈，短腿横过来对着转子，底下一圈软铁连起来，因为样子像庙宇的柱子，叫“庙宇电机” ${P('US12188475B2')}。线圈里叠着两套绕组：一套 p 对极负责转，一套 p±1 对极负责推 ${P('US6100618A')}，舞台上合成了一种颜色。</p>`)}
    ${note('为什么转子做得扁', 'b', `<p>被动的方向靠磁阻力拉回，转子越扁，歪斜的回复力越大。Levitronix 的专利要求磁芯直径大于高度的 2.6 倍 ${P('US12188475B2')}，本页模型约 3.5 倍。</p>`)}
    ${note('好在哪', 'b', `<p>没有轴承磨损，颗粒和金属溶出更少；厂家宣称颗粒比带轴承的泵少 10～50 倍 ${P('Levitronix BPS-600')}（这是厂家说法，本页没有独立数据）。泵头可以整块拆下来换，电机不接触药液。</p>`)}
    ${note('这个实验的假设', 'c', `<p>只算一个方向。转子 0.25 kg，偏心时被吸的“负刚度”3×10⁴ N/m，每安培电流推 15 N，控制器每 0.1 ms 算一次。真机是两个方向一起控制，还要考虑转速和液体的作用力，这里只看“延迟太大会扶不住”这个道理。舞台上的偏移放大了 6 倍。</p>`)}
    ${note('什么时候会失效', 'b', `<ul>
      <li><b>被动方向的力不够</b>：上下方向的回复力“比较小”，外力一大就会被拉出平衡、撞到壳上，所以专利里留了应急支撑 ${P('US6053705A')}；新专利还在泵壳底部和盖子上做凹坑来加强被动稳定 ${P('US12188475B2')}。</li>
      <li><b>进口在一侧</b>：液体从一边冲进来，会把转子推偏，还会带来轴向推力 ${P('US6100618A')}。</li>
      <li><b>断电、控制器故障</b>：转子落到泵壳上。</li>
      <li><b>规格范围</b>：2003 年的资料里，这类泵在 50 L/min、0.25 MPa 一档 ${P('Chimia 2003')}；现在的产品更大，但大流量高扬程仍是磁力泵的地盘。</li></ul>`)}`,
  enter(A) {
    A.setPins(A.pinsFor('P2', ['泵头（PFA）', '转子：磁铁环 + 叶轮', '定子爪', '线圈', '位置传感器']));
    A.stage.setFlows([{ pump: 'P2', key: 'main', speed: 140 }, { pump: 'P2', key: 'circ', speed: 60, size: 2.8 }]);
    A.rampLegend('<span>线圈颜色 = 电流方向</span>');
    A.setSlow('转速放慢约 170 倍 · 偏移放大 6 倍');
    const D = A.stage.D.P2; D.on = true; D.x = 0; D.y = 0;
    const pl = new Plot($('p3'), { l: 46, b: 24 });
    const st = { on: true, delay: .2, run: null, t: 0 };
    const sim = () => {
      const r = S.levitate({ on: st.on, delayMs: st.delay, kick: st.on ? 1 : 0 });
      st.run = r; st.t = 0;
      pl.clear().scale(0, 60, -1600, 1600).axes({ xt: niceTicks(0, 60, 6), yt: [-1500, -750, 0, 750, 1500], xl: '时间 ms', yl: 'µm', zero: true });
      pl.hline(1500, C.warn).hline(-1500, C.warn);
      pl.line(r.t, r.x, C.cf, 2);
      if (st.on) pl.vline(5, C.mute).label(5, 1300, '冲一下', C.text);
      if (r.touched) pl.label(r.tTouch, Math.sign(r.x[r.x.length - 1]) * 1400, `${f1(r.tTouch)} ms 撞壳`, C.warn, { dy: 10 });
      pl.hover = { x: r.t, xf: (t) => `${f1(t)} ms`, series: [{ n: '偏移', c: C.cf, y: r.x, f: (v) => `${f0(v)} µm` }] };
      $('k3m').innerHTML = r.touched ? '碰壁' : `${f0(r.maxDev)}<small>µm</small>`;
      $('k3s').innerHTML = r.touched || r.settle === null ? '—' : `${f0(r.settle)}<small>ms</small>`;
      $('k3t').innerHTML = `${f1(r.tau * Math.log(2))}<small>ms</small>`;
      const s = $('s3');
      if (!st.on) { s.className = 'status bad'; s.textContent = '控制器关掉：转子不到 12 ms 就被吸到一边撞上泵壳。真机上会掉到应急支撑上，叶轮停转。'; }
      else if (r.touched) { s.className = 'status bad'; s.textContent = `延迟 ${f1(st.delay)} ms 太长：控制器总是按“过时的位置”出力，越扶越晃，最后撞壳。`; }
      else if (r.settle === null) { s.className = 'status'; s.textContent = '扶住了，但还在来回晃，没有稳下来。'; }
      else { s.className = 'status ok'; s.textContent = `扶住了：被冲偏 ${f0(r.maxDev)} µm，大约 ${f0(r.settle)} ms 回到中间（缝隙只有 1500 µm）。`; }
      D.on = true;
    };
    range('dly', (v) => `${f1(v)} ms`, (v) => { st.delay = v; sim(); }).upd();
    $('b3k').onclick = () => { if (!st.on) return; sim(); };
    $('b3c').onclick = (e) => { st.on = !st.on; e.target.textContent = `控制器：${st.on ? '开' : '关'}`; e.target.setAttribute('aria-pressed', st.on); sim(); };
    return {
      tools: {},
      tick(dt) {
        // 把 60 ms 的仿真慢放成 3 秒，放完停在最后一刻
        const r = st.run; if (!r) return;
        st.t = Math.min(60, st.t + dt * 20 * A.stage.speed * (A.stage.paused ? 0 : 1));
        const i = Math.min(r.t.length - 1, Math.round(st.t / 60 * (r.t.length - 1)));
        D.x = r.x[i] / 1000; D.y = 0;
        D.on = !(r.touched && st.t >= r.tTouch);
      },
      leave() { D.on = true; D.x = 0; D.y = 0; },
    };
  },
};

// ================================================================ 04 波纹管泵
const P3STEPS = [
  { psi: .25, t: '左边挤', d: '空气进左边的空气室，把左波纹管压扁。左边的药液推开上面的出口球阀出去；左边下面的进口球阀被压死。同一时刻连杆把右波纹管拉长，右边的进口球阀被吸开、药液进来。' },
  { psi: .515, t: '到头换向', d: '连杆走到头，行程端检测发出信号（或者空气先导阀动作），换向阀把压缩空气从左边改送右边，左边的空气排掉。换向这一瞬间两边都不动，出口流量几乎掉到零。' },
  { psi: .75, t: '右边挤', d: '镜像过来：右波纹管被压扁往外挤，左波纹管被拉长往里吸。四个球阀都换了状态，但液体始终是下面进、上面出。' },
  { psi: .015, t: '再换回来', d: '又到头了，空气改回左边。一个来回 = 左右各挤一次。每分钟来回的次数乘以两倍单边容积，就是平均流量。' },
];
const DAMP = { none: 0, small: .25, big: .7 };
const ch4 = {
  id: 'bellows', nav: '波纹管泵', title: '波纹管泵：左右动的那个',
  view: { pump: 'P3', view: 'long', cut: 'long' },
  lead: '中间一块 PTFE 泵头，左右各一只像手风琴的 PTFE <b>波纹管</b>，两只波纹管的底由一根陶瓷<b>连杆</b>连在一起。压缩空气灌进左边的空气室，把左波纹管压扁，里面的药液被挤出去；连杆同时把右波纹管拉长，右边吸进药液。走到头，换向阀把空气改送右边，于是整套左右来回。四个<b>球阀</b>像单向门：液体只能从下面进、从上面出。',
  body: () => `
    <p class="seglab">一步一步看</p>
    <div class="steps" id="st4">${P3STEPS.map((s, i) => `<button class="btn" type="button" data-i="${i}" aria-pressed="false"><small>0${i + 1}</small>${s.t}</button>`).join('')}</div>
    <div class="stepnote" id="sn4">按上面的按钮停在某一步；按“连续运行”接着动。</div>
    <div class="btns"><button class="btn" id="b4run" type="button" aria-pressed="true">连续运行</button></div>
    <p class="seglab">实验：出口流量有多“抖”</p>
    ${ctl('pa', '驱动气压', .2, .7, .05, .5)}
    ${ctl('res4', '管路阻力', 0, 100, 1, 40)}
    <p class="seglab">脉动阻尼器</p>
    ${seg('dmp', [['none', '不装'], ['small', '小'], ['big', '大']], 'small')}
    ${plot('p4', 190, `<span>${sw(C.mute)}泵直接出来的</span><span>${sw(C.pd)}过了阻尼器</span>`)}
    ${kpis([['k4q', '平均流量'], ['k4c', '往返'], ['k4p', '出口压力'], ['k4r', '流量波动']])}`,
  notes: () => `
    ${note('出口压力为什么超不过气压', 'a', `<p>空气推波纹管的力 = 气压 × 面积，药液顶回来的力 = 液压 × 面积，两边面积差不多。所以出口压力最多接近气压，再往上就推不动、停在那里，<b>憋死了也不会坏</b>。管路越憋，推得越慢，流量越小。</p>`)}
    ${note('为什么能干转、能自吸', 'a', `<p>它不靠转速甩，也没有靠液体润滑的轴承：波纹管一拉长，腔里就变成负压，能把药液从低处吸上来；泵里是空气也一样能动。这一点离心泵做不到。</p>`)}
    ${note('换向那一下：流量掉到零', 'b', `<p>Nippon Pillar 的专利写明，换向瞬间出口压力会“瞬间掉到接近零” ${P('US10408207B2')}。过滤器、流量计都怕这种一抖一抖。办法是在出口加<b>脉动阻尼器</b>：里面再放一只薄壁波纹管，里面是药液、外面是空气，压力高时被压缩存一点，压力掉下去时吐出来 ${P('US6364640B1')} ${P('JPH11270459A')}。专利里用出口压力的波动（最大减最小、除以平均）来比：阻尼波纹管的壁厚和伸缩量选得合适时约 12～15 %，选得不合适时 20～70 % ${P('US6364640B1')}。本页的图画的是流量，道理一样。</p>`)}
    ${note('两种换向', 'b', `<p><b>全气动</b>：行程端的机械小阀把先导空气送去推换向阀芯，泵上没有金属和电线，但也就没有“停了”的电信号 ${P('US6874997B2')}。<b>接近开关 + 电磁阀</b>：每边两个接近开关检测活塞板，三位电磁阀换向，能接到设备的控制器上报警 ${P('US10408207B2')}。</p>`)}
    ${note('本页这台泵', 'cb', `<p>有效半径 48 mm、单边行程 60 mm，单边挤一次约 0.43 L。气压 0.2～0.7 MPa 是厂家资料里常见的范围，同类产品最大流量在 100 L/min 一档 ${P('Iwaki FS-N')}。阻尼器用一阶滤波近似，“小”“大”只是两个时间常数，不是实物尺寸。</p>`)}
    ${note('什么时候会失效', 'bd', `<ul>
      <li><b>波纹管疲劳开裂</b>：药液漏进空气室。所以空气室底部装<b>漏液传感器</b> ${P('US10408207B2')}，舞台上两只壳体下面那块就是。</li>
      <li><b>球阀卡颗粒</b>：关不严，挤出去的又流回来，流量下降。</li>
      <li><b>阀门颤振</b>：一个大的吸入阀容易抖，专利里拆成两个小阀；阀弹簧不用金属而用氟树脂，因为半导体里限制金属弹簧 ${P('US7374409B2')}。</li>
      <li><b>连杆穿过泵头的地方</b>要密封，这里会磨。厂家宣传自家的轴封能减少颗粒 ${P('Iwaki FS-N')}；这里是不是这类泵的主要颗粒来源，我没有找到公开数据 ${ev('d')}。</li></ul>`)}`,
  enter(A) {
    A.setPins(A.pinsFor('P3', ['中心泵头（PTFE）', '左波纹管', '右波纹管', '连杆', '空气室', '进口球阀', '出口球阀', '脉动阻尼器', '漏液传感器', '行程端检测', '进口', '出口']));
    A.stage.setFlows(['suctL', 'dischL', 'suctR', 'dischR'].map((k) => ({ pump: 'P3', key: k, speed: 160, on: false }))
      .concat(['airL', 'airR', 'exhL', 'exhR'].map((k) => ({ pump: 'P3', key: k, speed: 260, color: '#d6f3ff', size: 2.6, on: false }))));
    A.rampLegend('<span>淡白小点 = 压缩空气</span>');
    const D = A.stage.D.P3; D.hold = null; D.cpm = 18;
    const st = { pa: .5, res: 40, damp: 'small' };
    const pl = new Plot($('p4'), { l: 40, b: 24 });
    const upd = () => {
      const R = 1e-5 * Math.pow(60, st.res / 100);
      const o = S.airPump('bellows', { Pa: st.pa, R });
      const tau = DAMP[st.damp];
      const pu = S.pulsation({ cpm: Math.max(1, o.cpm), damperTau: tau, cycles: 3 });
      const raw = pu.raw.map((v) => v * o.Q), out = pu.out.map((v) => v * o.Q);
      const ymax = Math.max(10, Math.ceil(Math.max(...raw) / 10) * 10);
      pl.clear().scale(0, pu.t[pu.t.length - 1], 0, ymax).axes({ xt: niceTicks(0, pu.t[pu.t.length - 1], 5), yt: niceTicks(0, ymax, 4), xl: '时间 s', yl: 'L/min', xf: (v) => v.toFixed(1) });
      pl.line(pu.t, raw, C.mute, 1.3).line(pu.t, out, C.pd, 2.2);
      pl.hover = { x: pu.t, xf: (t) => `${f2(t)} s`, series: [{ n: '泵出口', c: C.mute, y: raw, f: (v) => `${f1(v)} L/min` }, { n: '阻尼后', c: C.pd, y: out, f: (v) => `${f1(v)} L/min` }] };
      $('k4q').innerHTML = `${f1(o.Q)}<small>L/min</small>`; $('k4c').innerHTML = `${f0(o.cpm)}<small>次/分</small>`;
      $('k4p').innerHTML = `${f2(o.Pd)}<small>MPa</small>`;
      $('k4r').innerHTML = `±${f0(pu.ripple / 2 * 100)}<small>%</small>`;
      D.cpm = Math.max(4, o.cpm * .5); D.damper = st.damp !== 'none';
    };
    range('pa', (v) => `${f2(v)} MPa`, (v) => { st.pa = v; upd(); }).upd();
    range('res4', (v) => `${v} %`, (v) => { st.res = v; upd(); }).upd();
    segBind('dmp', (v) => { st.damp = v; upd(); });
    const btns = [...document.querySelectorAll('#st4 .btn')];
    const pick = (i) => {
      btns.forEach((b, k) => b.setAttribute('aria-pressed', k === i ? 'true' : 'false'));
      $('b4run').setAttribute('aria-pressed', i === null ? 'true' : 'false');
      if (i === null) { D.hold = null; $('sn4').textContent = '连续运行中。舞台已放慢一半，好看清球阀。'; return; }
      const s = P3STEPS[i];
      D.psi = D.psi % 1; D.hold = D.psi + ((s.psi - D.psi) % 1 + 1) % 1;
      $('sn4').textContent = s.d;
    };
    btns.forEach((b, i) => { b.onclick = () => pick(i); });
    $('b4run').onclick = () => pick(null);
    pick(null);
    return { tools: {}, leave() { D.hold = null; } };
  },
};

// ================================================================ 05 气动隔膜泵
const P4STEPS = [
  { psi: .75, t: '空气进左边', d: '阀芯在右，压缩空气进左边的空气室（隔膜里侧），把左隔膜往外推：左液室变小，药液从上面的球阀出去。中心轴把右隔膜往里拉：右液室变大，从下面吸进药液。右边空气室里的旧空气经阀芯排走。' },
  { psi: .015, t: '到头：阀芯换位', d: '中心轴走到头，轴上的气口把先导空气送到阀芯一端，阀芯整段滑到另一边，没有弹簧，也不用电。' },
  { psi: .25, t: '空气进右边', d: '镜像过来：空气推右隔膜往外挤，左边被拉回来吸。' },
  { psi: .515, t: '再换回来', d: '又到头，阀芯滑回去。一个来回挤两次。' },
];
const ch5 = {
  id: 'aodd', nav: '气动隔膜泵', title: '气动隔膜泵：自己会换向',
  view: { pump: 'P4', view: 'long', cut: 'long' },
  lead: '它和波纹管泵是表兄弟：两片圆<b>隔膜</b>、一根<b>中心轴</b>、四个<b>球阀</b>，也是左右来回。不同在两处：空气在隔膜的<b>里侧</b>（靠中间），药液在外侧；换向不用电，靠顶上那根<b>滑阀</b>自己完成。',
  body: () => `
    <p class="seglab">一步一步看（阀芯在顶上的空气阀里）</p>
    <div class="steps" id="st5">${P4STEPS.map((s, i) => `<button class="btn" type="button" data-i="${i}" aria-pressed="false"><small>0${i + 1}</small>${s.t}</button>`).join('')}</div>
    <div class="stepnote" id="sn5">按上面的按钮停在某一步；按“连续运行”接着动。</div>
    <div class="btns"><button class="btn" id="b5run" type="button" aria-pressed="true">连续运行</button></div>
    <p class="seglab">实验：把出口阀慢慢关上</p>
    ${ctl('pa5', '驱动气压', .2, .7, .05, .4)}
    ${ctl('open5', '出口阀开度', 0, 100, 1, 60)}
    ${plot('p5', 190, `<span>${sw(C.pd)}这个气压下泵能给的</span><span>${sw(C.mute)}管路要的</span>`)}
    ${kpis([['k5q', '流量'], ['k5p', '出口压力'], ['k5c', '往返'], ['k5s', '状态']])}`,
  notes: () => `
    ${note('结构从哪来', 'b', `<p>模型参考 Wilden 的专利：中间体两侧是空气室，空气阀夹在中间；PTFE 隔膜里模压了一颗金属螺柱，穿过活塞板拧在中心轴上；进口歧管在下、出口歧管在上，四个 PTFE 球阀各带一个笼子 ${P('US6142749A')}。</p>`)}
    ${note('阀芯为什么不会停在半路', 'b', `<p>老设计的滑阀有时会停在中间，两边都不通气，泵就卡住了，得靠定位机构。Yamada 的专利让中心轴上的一段细颈在行程两端给阀芯送先导空气，阀芯被整段推过去 ${P('US11448204B2')}。</p>`)}
    ${note('憋死不坏，和离心泵正相反', 'a', `<p>出口阀关死，药液压力升到和气压平衡，隔膜就停住，不耗气、不发热，阀门一开又接着跑。离心泵出口关死则是电机照转，能量全变成热。所以输送管路可能被堵死的场合，气动泵更省心。</p>`)}
    ${note('和波纹管泵怎么选', 'd', `<p>隔膜泵行程短、零件少、便宜，能输送带颗粒的液体；波纹管泵行程长、每次挤得多，接液件形状简单，更常见于半导体药液供给。这是按结构推的大方向，具体还要看各家的规格。</p>`)}
    ${note('什么时候会失效', 'b', `<ul>
      <li><b>隔膜破</b>：专利直说隔膜是“最容易坏的零件”；它把螺柱设计成先被拔出来、泵停下，也不让隔膜撕破漏进空气侧 ${P('US6142749A')}。</li>
      <li><b>负载太轻</b>：几乎没阻力时往返太快，隔膜寿命变短 ${P('US11448204B2')}。</li>
      <li><b>脉动</b>：和波纹管泵一样，每次换向流量都会掉下去。</li>
      <li><b>排气</b>：排出来的空气要引走，不能直接吹进洁净室 ${P('US6142749A')}。</li></ul>`)}
    ${note('这个实验的假设', 'c', `<p>流量随出口压力线性下降，在出口压力接近气压时降到零；出口敞开时的流量随气压的平方根增加。真泵的曲线要看厂家资料，本页只看形状。</p>`)}`,
  enter(A) {
    A.setPins(A.pinsFor('P4'));
    A.stage.setFlows(['suctL', 'dischL', 'suctR', 'dischR'].map((k) => ({ pump: 'P4', key: k, speed: 140, on: false }))
      .concat(['airL', 'airR', 'exhL', 'exhR'].map((k) => ({ pump: 'P4', key: k, speed: 220, color: '#d6f3ff', size: 2.6, on: false }))));
    A.rampLegend('<span>淡白小点 = 压缩空气</span>');
    const D = A.stage.D.P4; D.hold = null; D.stall = 0;
    const st = { pa: .4, open: 60 };
    const pl = new Plot($('p5'), { l: 40, b: 24 });
    const upd = () => {
      const R = st.open <= 0 ? 1e9 : 6e-5 / Math.pow(st.open / 100, 2);
      const o = S.airPump('aodd', { Pa: st.pa, R, Pb: .02 });
      const Qs = Array.from({ length: 81 }, (_, i) => i);
      const c = S.AIR.aodd, Pst = st.pa - c.loss, Q0 = c.Q0ref * Math.sqrt(st.pa / .5);
      const pump = Qs.map((q) => Math.max(0, Pst * (1 - q / Q0))), sys = Qs.map((q) => .02 + R * q * q);
      pl.clear().scale(0, 80, 0, .8).axes({ xt: niceTicks(0, 80, 4), yt: niceTicks(0, .8, 4), xl: '流量 L/min', yl: 'MPa', yf: (v) => v.toFixed(1) });
      pl.line(Qs, pump, C.pd, 2.2).line(Qs, sys, C.mute, 1.6).dot(o.Q, o.Pd, C.fg);
      pl.label(o.Q, o.Pd, o.stalled ? '憋住，停在这里' : `${f0(o.Q)} L/min`, C.fg);
      pl.hover = { x: Qs, xf: (q) => `${q} L/min`, series: [{ n: '泵', c: C.pd, y: pump, f: (v) => `${f2(v)} MPa` }, { n: '管路', c: C.mute, y: sys, f: (v) => `${f2(v)} MPa` }] };
      $('k5q').innerHTML = `${f1(o.Q)}<small>L/min</small>`; $('k5p').innerHTML = `${f2(o.Pd)}<small>MPa</small>`;
      $('k5c').innerHTML = `${f0(o.cpm)}<small>次/分</small>`; $('k5s').textContent = o.stalled ? '憋停' : '运转';
      D.cpm = Math.max(3, o.cpm * .45); D.stallT = o.stalled ? 1 : 0;
    };
    range('pa5', (v) => `${f2(v)} MPa`, (v) => { st.pa = v; upd(); }).upd();
    range('open5', (v) => `${v} %`, (v) => { st.open = v; upd(); }).upd();
    const btns = [...document.querySelectorAll('#st5 .btn')];
    const pick = (i) => {
      btns.forEach((b, k) => b.setAttribute('aria-pressed', k === i ? 'true' : 'false'));
      $('b5run').setAttribute('aria-pressed', i === null ? 'true' : 'false');
      if (i === null) { D.hold = null; $('sn5').textContent = '连续运行中。点工具条的“剖开”可以换成看空气阀的角度。'; A.stage.applyView({ pump: 'P4', view: 'long', cut: 'long' }); A.toolbar(); return; }
      const s = P4STEPS[i];
      D.psi = D.psi % 1; D.hold = D.psi + ((s.psi - D.psi) % 1 + 1) % 1;
      $('sn5').textContent = s.d;
      A.stage.applyView({ pump: 'P4', view: 'valve', cut: 'long' }); A.toolbar();
    };
    btns.forEach((b, i) => { b.onclick = () => pick(i); });
    $('b5run').onclick = () => pick(null);
    $('sn5').textContent = '按上面的按钮停在某一步；按“连续运行”接着动。';
    return {
      tools: {},
      tick(dt) { D.stall += ((D.stallT || 0) - D.stall) * Math.min(1, dt * 2); },
      leave() { D.hold = null; D.stall = 0; },
    };
  },
};

// ================================================================ 06 电磁计量泵
const ch6 = {
  id: 'metering', nav: '电磁计量泵', title: '电磁计量泵：一下一小口',
  view: { pump: 'P5', view: 'long', cut: 'long' },
  lead: '往槽里补药液（比如补一点双氧水），要的是“准”，不是“多”。电磁计量泵每收到一个电脉冲，<b>线圈</b>就把<b>衔铁</b>一吸，推杆推着<b>隔膜</b>往前挤出一小口；断电后<b>弹簧</b>把它拉回来，同时从下面吸进一小口。流量 = 每一下的量 × 每分钟几下。后面那个红旋钮调的是每一下走多远。',
  body: () => `
    ${ctl('spm', '每分钟次数', 1, 360, 1, 120)}
    ${ctl('len', '行程长度', 20, 100, 5, 30)}
    ${kpis([['k6a', '每一下'], ['k6b', '每分钟'], ['k6c', '每小时']])}
    <p class="seglab">实验：双氧水在泵头里放气，会怎样</p>
    ${ctl('pd6', '出口压力', .05, 1, .05, .3)}
    ${ctl('gen', '放气速度', 0, .12, .005, .06)}
    <div class="btns"><button class="btn" id="b6v" type="button" aria-pressed="false">自动排气阀</button><button class="btn" id="b6p" type="button" aria-pressed="false">每 10 下走一次满行程</button><button class="btn" id="b6r" type="button">从头再放</button></div>
    ${plot('p6', 190, `<span>${sw(C.pd)}每一下实际挤出（占设定 %）</span><span>${sw(C.cf)}泵头里的气泡（mL）</span>`)}
    ${kpis([['k6r', '实际 / 设定'], ['k6l', '气锁'], ['k6t', '这个行程下气锁门槛']])}`,
  notes: () => `
    ${note('行程长度怎么调', 'b', `<p>衔铁回程时靠在后面一根螺杆挡块上，拧旋钮就是把挡块往前或往后移：挡块越靠前，衔铁每次走得越短 ${P('US5330330A')}。也有用偏心凸轮当挡块的做法 ${P('US6280147B1')}。每分钟次数由电路决定，常见的是 20～100 % 的行程、最高 360 次/分 ${P('Iwaki EH-E')}。</p>`)}
    ${note('为什么球阀两个串联', 'b', `<p>一个球阀偶尔关不严，计量就不准；进口、出口各串两个，一个漏了还有一个挡着。通道也尽量做短、做斜，减少“死体积”，原因见下一条 ${P('US2015/0159639A1')}。</p>`)}
    ${note('气锁：挤了，但什么都没出去', 'ac', `<p>泵头里有一个气泡时，每一下的前半段只是在压缩气泡，压力到了出口压力才推开出口阀。本页按等温压缩算：</p>
      <div class="f">每下挤出 = 行程容积 − 气泡体积 × (1 − 进口压力 / 出口压力)</div>
      <p>气泡大到等号右边为零，就一滴都挤不出去，气泡也再没机会被带走，越积越多。双氧水、次氯酸钠会自己放出气体，所以特别容易遇到。ProMinent 的专利描述的就是这个现象 ${P('US10677243B2')}。</p>`)}
    ${note('为什么短行程更容易气锁', 'c', `<p>上面那个式子里，门槛和行程容积成正比：行程调到 30 %，能容忍的气泡也只剩三成。这是从式子直接推出来的；ProMinent 的对策正好对得上：每隔 N 下走一次满行程把气挤出去 ${P('US2015/0159639A1')}。</p>`)}
    ${note('三种对付气锁的办法', 'b', `<ul><li><b>自动排气阀</b>：泵头上开一个排气通道，让气泡连同少量液体慢慢放回去 ${P('Iwaki EWN-A')}。</li>
      <li><b>阀座上刻一道极细的槽</b>（约 0.01～0.09 mm 深），口开在液室最高处，排出行程时把气顶出去 ${P('US10677243B2')}。</li>
      <li><b>定期满行程</b>，或者检测到有气时满行程 ${P('US2015/0159639A1')}。</li></ul>`)}
    ${note('什么时候会失效', 'ab', `<ul><li><b>出口压力比进口还低</b>（比如往低处的槽里加药）：药液会自己虹吸过去，加多了，要在出口装背压阀。</li>
      <li><b>吸入管太细太长</b>：回程太快时吸不满。</li>
      <li><b>衔铁撞到极靴</b>：噪声、发热、零件磨损；有的控制器连续几下没打成就停泵报警 ${P('US6280147B1')}。</li></ul>`)}
    ${note('这个实验的假设', 'c', `<p>最大 3.5 mL/下是按“360 下/分时 75 L/h”这一档反推的量级。放气速度、每次出口阀打开能带走多少气泡（15 %）、排气阀的效果都是我设的参数，只用来看趋势：同样的放气速度，行程越短、出口压力越高，越容易锁死。</p>`)}`,
  enter(A) {
    A.setPins(A.pinsFor('P5'));
    A.stage.setFlows([{ pump: 'P5', key: 'suct', speed: 120, on: false }, { pump: 'P5', key: 'disch', speed: 120, on: false }]);
    A.rampLegend();
    const D = A.stage.D.P5; D.gas = 0; D.locked = false;
    const st = { spm: 120, L: .3, pd: .3, gen: .06, vent: false, purge: false, run: null, k: 0, lastPsi: 0 };
    const pl = new Plot($('p6'), { l: 40, b: 24, r: 40 });
    const dose = () => {
      const d = S.dosing({ spm: st.spm, L: st.L });
      $('k6a').innerHTML = `${f2(d.mlStroke)}<small>mL</small>`; $('k6b').innerHTML = `${f0(d.mlMin)}<small>mL</small>`;
      $('k6c').innerHTML = `${f1(d.Lh)}<small>L</small>`;
      D.spm = Math.min(st.spm, 40); D.L = st.L;
      A.setSlow(st.spm > 40 ? `舞台放慢 ${f1(st.spm / 40)} 倍（${st.spm} 次/分太快看不清）` : '');
    };
    const gas = () => {
      const r = S.gasLock({ L: st.L, PdG: st.pd, gen: st.gen, vent: st.vent, purgeN: st.purge ? 10 : 0 });
      st.run = r; st.k = 0;
      const n = r.out.length, xs = Array.from({ length: n }, (_, i) => i + 1);
      const gmax = Math.max(1, Math.ceil(Math.max(...r.gas) * 2) / 2);
      pl.clear().scale(1, n, 0, 110).axes({ xt: niceTicks(0, n, 6).filter((x) => x >= 1), yt: [0, 25, 50, 75, 100], xl: '第几下', yl: '%' });
      pl.line(xs, r.out.map((v) => v * 100), C.pd, 1.8);
      pl.line(xs, r.gas.map((g) => g / gmax * 100), C.cf, 1.6, [4, 3]);
      const g = pl.g; g.fillStyle = C.cf; g.textAlign = 'left'; g.textBaseline = 'middle';
      [0, .5, 1].forEach((q) => g.fillText(`${(gmax * q).toFixed(1)}`, pl.w - 36, pl.Y(q * 100)));
      if (r.locked !== null) pl.vline(r.locked + 1, C.warn).label(r.locked + 1, 90, `第 ${r.locked + 1} 下锁死`, C.warn);
      pl.hover = { x: xs, xf: (x) => `第 ${x} 下`, series: [{ n: '挤出', c: C.pd, y: r.out.map((v) => v * 100), f: (v) => `${f0(v)} %` }, { n: '气泡', c: C.cf, y: r.gas, f: (v) => `${f2(v)} mL` }] };
      $('k6r').innerHTML = `${f0(r.ratio * 100)}<small>%</small>`;
      $('k6l').innerHTML = r.locked === null ? '没有' : `第 ${r.locked + 1} 下`;
      $('k6t').innerHTML = `${f2(r.threshold)}<small>mL</small>`;
    };
    range('spm', (v) => `${v} 次`, (v) => { st.spm = v; dose(); }).upd();
    range('len', (v) => `${v} %`, (v) => { st.L = v / 100; dose(); gas(); }).upd();
    range('pd6', (v) => `${f2(v)} MPa`, (v) => { st.pd = v; gas(); }).upd();
    range('gen', (v) => `${f3(v)} mL/下`, (v) => { st.gen = v; gas(); }).upd();
    $('b6v').onclick = (e) => { st.vent = !st.vent; e.target.setAttribute('aria-pressed', st.vent); gas(); };
    $('b6p').onclick = (e) => { st.purge = !st.purge; e.target.setAttribute('aria-pressed', st.purge); gas(); };
    $('b6r').onclick = () => { st.k = 0; };
    return {
      tools: {},
      tick() {
        // 舞台每打一下，往后读一下仿真结果：气泡长大，锁死后出口球阀不再打开
        const r = st.run; if (!r) return;
        if (D.psi < st.lastPsi) st.k = Math.min(r.out.length - 1, st.k + 3);
        st.lastPsi = D.psi;
        D.gas = Math.min(1, r.gas[st.k] / Math.max(.5, r.threshold));
        D.locked = r.out[st.k] < .02;
      },
      leave() { D.gas = 0; D.locked = false; A.stage.bubble.visible = false; },
    };
  },
};

// ================================================================ 07 怎么选
const ROWS = [
  ['原理', '离心，磁铁隔墙带动', '离心，转子悬浮', '空气推波纹管，往复', '空气推隔膜，往复', '电磁铁推隔膜，脉冲'],
  ['典型用途', '槽内药液循环、过滤', '颗粒要求最严的循环、浆料', '药液供给、输送', '药液输送、排液', '补液、加药'],
  ['流量', '大', '中', '中', '中', '很小（mL）'],
  ['出口脉动', '几乎没有', '几乎没有', '有，要阻尼器', '有', '一下一下'],
  ['能干转 / 自吸', '不能', '不能', '能', '能', '能自吸，但怕气'],
  ['会磨的地方', '滑动轴承、推力环', '基本没有', '连杆密封、球阀', '球阀、滑阀', '球阀、隔膜'],
  ['憋死出口', '发热，危险', '发热', '停住，不坏', '停住，不坏', '电磁铁有力上限'],
  ['复杂度 / 价钱', '中', '高（要控制器）', '中', '低', '低'],
];
const ch7 = {
  id: 'choose', nav: '怎么选', title: '怎么选：没有一台泵是全能的',
  view: { pump: 'all' },
  lead: '选泵就是在流量、脉动、颗粒、能不能干转和价钱之间挑一个组合。下面这张表是本页五台泵的大致对比，“大、中、小”是同类之间相比，不是具体数字。',
  body: () => `
    <div class="tw"><table class="cmp"><thead><tr><th></th>${['P1', 'P2', 'P3', 'P4', 'P5'].map((p, i) => `<th class="${i < 2 ? 'h-cf' : 'h-pd'}">${PUMPINFO[p].cn}</th>`).join('')}</tr></thead>
      <tbody>${ROWS.map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="seglab">槽内药液循环用哪种泵：三条路</p>
    <div class="card"><h4>A · 磁力泵 + 过滤器 + 加热器<span>最主流</span></h4><p>流量大、没有脉动、价钱适中，配件和维修经验最多。代价：不能干转，怕进气，要有液位和流量联锁；轴承是会磨的，要定期换。</p></div>
    <div class="card quiet"><h4>B · 磁悬浮泵<span>颗粒最敏感时</span></h4><p>没有轴承磨损，泵头可以整块更换。代价：要控制器，贵；流量扬程范围比磁力泵窄；断电时转子会落下。</p></div>
    <div class="card pd"><h4>C · 波纹管泵 + 脉动阻尼器<span>要能干转、自吸时</span></h4><p>泵在药液液面之上、需要自吸，或者管路可能被堵死时更省心。代价：脉动，必须配阻尼器；波纹管是疲劳件，要漏液检测。</p></div>
    <p class="seglab">现场常见症状 → 先查什么</p>
    <div class="tw"><table class="cmp"><thead><tr><th>症状</th><th>可能原因</th><th>哪类泵</th></tr></thead><tbody>
      <tr><td>流量慢慢变小</td><td>过滤器堵；离心泵叶轮或口环磨损；往复泵球阀卡颗粒</td><td>全部</td></tr>
      <tr><td>流量突然为零，电机还在转</td><td>磁力联轴器脱耦；进气；气锁</td><td>磁力泵、计量泵</td></tr>
      <tr><td>泵壳发烫、变形</td><td>干转；出口长时间关死</td><td>磁力泵</td></tr>
      <tr><td>出口压力一抖一抖</td><td>换向；阻尼器没充气或坏了</td><td>波纹管泵、隔膜泵</td></tr>
      <tr><td>漏液传感器报警</td><td>波纹管或隔膜裂了</td><td>波纹管泵、隔膜泵</td></tr>
      <tr><td>加药量不够</td><td>气锁；行程设太短；吸入侧阻力大</td><td>计量泵</td></tr></tbody></table></div>`,
  notes: () => `
    ${note('证据强弱一览', '', `<ul>
      <li>${ev('a')} 离心和容积式的区别、相似定律、Earnshaw 定理、磁铁随温度变弱、气动泵的力平衡。</li>
      <li>${ev('b')} 各泵的结构（零件怎么装、液体怎么走、哪里会坏）都来自下面列的专利；流量范围、颗粒倍数来自厂家资料，厂家宣称的部分已在正文标明。</li>
      <li>${ev('c')} 教学泵的曲线、磁铁扭矩、悬浮控制参数、阻尼器时间常数、计量泵放气速度，都是我设的量级，只看趋势。</li>
      <li>${ev('d')} 波纹管泵连杆密封是不是主要颗粒来源、隔膜泵和波纹管泵的选择倾向，是我按结构推的。</li></ul>`)}
    ${note('模型说明', 'c', `<p>五台泵都是 Blender 脚本建的教学模型，结构参考公开专利，尺寸按教学需要定，<b>不对应任何厂家的任何型号</b>，也不代表任何一家设备厂的实际配置。</p>`)}
    <div class="note" id="sources"><h3>来源</h3><ol class="sources">${SOURCES.map(([c, t, u], i) => `<li id="src-${i + 1}"><a href="${u}" target="_blank" rel="noopener">${c}</a>　${t}</li>`).join('')}</ol></div>`,
  enter(A) {
    A.setPins(['P1', 'P2', 'P3', 'P4', 'P5'].map((p) => {
      const o = A.spec.offset[p];
      const top = { P1: 330, P2: 380, P3: 540, P4: 420, P5: 300 }[p];
      const id = { P1: 'magnet', P2: 'maglev', P3: 'bellows', P4: 'aodd', P5: 'metering' }[p];
      return { t: PUMPINFO[p].cn, p: [o[0], o[1], top], onClick: () => A.go(id) };
    }));
    return { tools: {} };
  },
};

export const CHAPTERS = [ch0, ch1, ch2, ch3, ch4, ch5, ch6, ch7];
