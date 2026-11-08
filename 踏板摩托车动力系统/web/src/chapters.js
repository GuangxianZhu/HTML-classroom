// 十二章：总览 → 单元摆动 → 四冲程 → 二冲程 → CVT → 离心离合器 → 开起来 → 起动和怠速停止 → 电控 CVT → 混动 → 电动 → 怎么选。
// 每章：舞台怎么摆（view）、讲义（lead / body / notes）、实验逻辑（enter 返回 tick / leave）。
import { Plot, C, niceTicks } from './chart.js';
import * as S from './sim.js';
import { GAS } from './stage.js';

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
const f1 = (x) => x.toFixed(1), f0 = (x) => Math.round(x).toString(), f2 = (x) => x.toFixed(2);
const pat = (n) => `<a class="rf" href="#src-${n}">[${n}]</a>`;
const TAU = Math.PI * 2;

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
function setSeg(id, v) { $(id).querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === v ? 'true' : 'false')); }
const setText = (id, h) => { const e = $(id); if (e) e.innerHTML = h; };

export const MODELINFO = {
  all: { cn: '踏板摩托车的动力系统', en: 'scooter powertrain', k1: '四台模型', v1: '四冲程 · 二冲程 · 轮毂电机 · 摆臂电机', k2: '共同点', v2: '不用换档，拧油门就走' },
  U4: { cn: '四冲程单元摆动总成', en: '4-stroke unit-swing', k1: '动力', v1: '125 cc 单缸 风冷 SOHC 两气门', k2: '变速', v2: '皮带无级变速 + 离心离合器' },
  ecvt: { cn: '电控 CVT', en: 'electronic CVT', k1: '动力', v1: '125 cc 单缸（同一台）', k2: '变速', v2: '电机推动盘，电脑定速比' },
  hyb: { cn: '轻混踏板车', en: 'mild hybrid', k1: '动力', v1: '125 cc + 发电机兼助力电机', k2: '电池', v2: '48 V 锂电池（教学值）' },
  T2: { cn: '二冲程 50 cc', en: '2-stroke', k1: '动力', v1: '50 cc 单缸 曲轴箱扫气', k2: '进气', v2: '簧片阀 + 缸壁上的气口' },
  EH: { cn: '电动 · 轮毂电机', en: 'in-wheel motor', k1: '动力', v1: '外转子永磁电机 = 轮毂', k2: '变速', v2: '没有，电机直接带轮' },
  EM: { cn: '电动 · 摆臂电机', en: 'swing-arm motor', k1: '动力', v1: '内转子永磁电机 在摆臂前端', k2: '变速', v2: '两级齿轮，固定减速比' },
};

// ================================================================ 来源
export const SOURCES = [
  ['JPS60179325A', 'ヤマハ発動機：ユニツトスイング式車輛（单元摆动式车辆）', 'https://patents.google.com/patent/JPS60179325A/en'],
  ['US4494623A', 'Honda：Power transmission casing apparatus in motorized two-wheeled vehicle（V 带室 + 湿式两级减速齿轮室）', 'https://patents.google.com/patent/US4494623A/en'],
  ['US4505352A', 'Honda：Swing type power unit for a two-wheeled motor vehicle', 'https://patents.google.com/patent/US4505352A/en'],
  ['JPS62149588A', '本田技研工業：ユニツトスイング式自動二輪車の後車軸', 'https://patents.google.com/patent/JPS62149588A/en'],
  ['US6612391B2', 'Suzuki：Engine unit for small-sized vehicle（发动机固定、只有传动部分摆动）', 'https://patents.google.com/patent/US6612391B2/en'],
  ['US8038557B2', 'Yamaha：Power unit and saddle-ride type vehicle（单元摆动 + 电控 CVT）', 'https://patents.google.com/patent/US8038557B2/en'],
  ['US4697664A', 'Honda：Scooter type motorcycle（二冲程发动机固定，只有 V 带变速箱摆动）', 'https://patents.google.com/patent/US4697664A/en'],
  ['US6682450B2', 'Honda：V-belt-type automatic transmission for vehicle（滚子、扭力凸轮、离心离合器、两级减速）', 'https://patents.google.com/patent/US6682450B2/en'],
  ['JPH0627869Y2', '本田技研工業 / 山田製作所：Vベルト式無段変速機のドライブプーリ', 'https://patents.google.com/patent/JPH0627869Y2/en'],
  ['US11105408B2', 'Piaggio：CVT device with device for varying the transmission curve', 'https://patents.google.com/patent/US11105408B2/en'],
  ['US11149805B2', 'FCC：Centrifugal clutch（踏板车用离心离合器）', 'https://patents.google.com/patent/US11149805B2/en'],
  ['US4585429A', 'Yamaha：V-belt type continuously variable transmission（从动轮扭力凸轮）', 'https://patents.google.com/patent/US4585429A/en'],
  ['EP2853700A1', 'Honda：Variable valve gear of internal combustion engine for saddle-ride type vehicle（摇臂切换式可变气门）', 'https://patents.google.com/patent/EP2853700A1/en'],
  ['US7066124B2', 'Yamaha：Engine for scooter（水冷单缸 DOHC，气缸前倾）', 'https://patents.google.com/patent/US7066124B2/en'],
  ['JPH0752333Y2', 'スズキ：2サイクルエンジンのリードバルブ取着装置', 'https://patents.google.com/patent/JPH0752333Y2/en'],
  ['JP2530849Y2', 'スズキ：スクータ型車両用2サイクルエンジンの潤滑装置', 'https://patents.google.com/patent/JP2530849Y2/en'],
  ['US6782860B2', 'Honda：Engine starting control apparatus（ACG 起动机、停机后反转到压缩前）', 'https://patents.google.com/patent/US6782860B2/en'],
  ['EP3604775B1', 'Honda：Engine control device for vehicle（怠速停止车，用 ACG 帮离合器重新结合）', 'https://patents.google.com/patent/EP3604775B1/en'],
  ['JPH09228936A', 'スズキ：ユニットスイングエンジンの始動装置（起动电机 → 齿轮 → 曲轴）', 'https://patents.google.com/patent/JPH09228936A/en'],
  ['US9551403B2', 'Honda：V-belt continuously variable transmission（保留离心滚子 + 电动执行器）', 'https://patents.google.com/patent/US9551403B2/en'],
  ['US7237638B2', 'Honda：V-belt type continuously variable transmission（电机 → 齿轮 → 滑块 → 螺纹推动盘）', 'https://patents.google.com/patent/US7237638B2/en'],
  ['US7290629B2', 'Honda：Power unit structure for hybrid vehicle', 'https://patents.google.com/patent/US7290629B2/en'],
  ['US7351265B2', 'Univ. Pisa / Piaggio：Hybrid drive assembly for a vehicle, in particular a scooter', 'https://patents.google.com/patent/US7351265B2/en'],
  ['IT202100029681A1', 'Piaggio：Veicolo a sella cavalcabile di tipo scooter a propulsione ibrida', 'https://patents.google.com/patent/IT202100029681A1/en'],
  ['US6590306B2', 'Yamaha：Electric motor driven wheel（轮内电机 + 两速行星变速）', 'https://patents.google.com/patent/US6590306B2/en'],
  ['JPH0746620Y2', '東京アールアンドデー / 新日本製鐵：ダイレクトドライブ式ホイールモータを用いた電気二輪車', 'https://patents.google.com/patent/JPH0746620Y2/en'],
  ['US9067615B2', 'Honda：Electric saddle-ridden vehicle（摆臂上的电机 + 减速齿轮单元）', 'https://patents.google.com/patent/US9067615B2'],
  ['WO2020161980A1', '本田技研工業：電動車両（摆臂内三相电机 → 中间轴 → 后轴）', 'https://patents.google.com/patent/WO2020161980A1/ja'],
  ['US8893833B2', 'Honda：Swing arm device for electric two- or three-wheeled vehicle', 'https://patents.google.com/patent/US8893833B2'],
  ['US8776936B2', 'Honda：Electric vehicle having swing arm with motor（摆臂内离心离合器 + 电机 + 两级减速）', 'https://patents.google.com/patent/US8776936B2/en'],
  ['US11400994B2', 'Honda：Battery attachment/detachment structure for saddle-ride type electric vehicle', 'https://patents.google.com/patent/US11400994B2/en'],
  ['US9424697B2', 'Gogoro：电池仓自动解锁（换电用）', 'https://patents.google.com/patent/US9424697B2/en'],
  ['US8878487B2', 'Gogoro：换电柜（充电、分发便携电池的机器）', 'https://patents.google.com/patent/US8878487B2/en'],
  ['Honda 怠速停止', 'Honda 技术页：Idling Stop System（ACG 起动机、反转、减压，厂家称省油约 7 %）', 'https://global.honda/en/tech/Idling_Stop_System/'],
  ['Honda R&D 2010', 'Honda R&D Technical Review：Development of Idling Stop System for PCX（外转子三相无刷 ACG）', 'https://global.honda/en/technical-review/PDF/022-2/22-2_78e.pdf'],
  ['Honda PCX HYBRID', 'Honda 技术页：PCX HYBRID 系统（ACG 起动机加助力，拧油门后约 3 秒）', 'https://global.honda/en/tech/Hybrid_System_PCX_HYBRID/'],
  ['Honda eSP+', 'Honda 技术页：eSP+（四气门、活塞喷油冷却；偏置气缸、滚子摇臂等减摩）', 'https://global.honda/en/tech/Engine_technology_eSP_plus/'],
  ['Yamaha BLUE CORE', 'Yamaha 新闻稿 2014：BLUE CORE（偏置气缸、DiASil 缸套、锻造活塞；125 cc 风冷 SOHC 两气门）', 'https://global.yamaha-motor.com/news/2014/0912/blue-core.html'],
];
const srcIdx = (code) => SOURCES.findIndex((s) => s[0] === code) + 1;
const P = (...codes) => codes.map((c) => pat(srcIdx(c))).join('');

// ================================================================ 共用：让 U4 总成按一组“真实转速”动起来（慢放）
const SLOW = 1 / 40;            // 动画慢放：7000 rpm 看起来是 2.9 圈/秒
function spinU4(A, dt, { n = 0, x = 0, wb = null, lock = true, clutch = 1 }, slow = SLOW) {
  const st = A.stage, U = st.U4, sp = st.paused ? 0 : st.speed;
  const w = n * S.RPM * slow * dt * sp;
  const g = S.cvtGeom(x);
  U.th += w; U.x = x;
  U.phi2 += w / g.i;
  if (wb === null) U.phiB += lock ? w / g.i : 0;
  else U.phiB += wb * slow * dt * sp;
  U.clutch = clutch;
  st.belt.scroll(w * g.r1);
  return g;
}
/** 舞台角落：慢放比例 + 发动机、后轮的真实转速（动画是慢放的，数字是真实的） */
function rpmNote(A, n, v) {
  const wheel = (v / 3.6) / S.G.wheelR / S.RPM;
  A.setSlow(`转动慢放 1/40 · 发动机 ${f0(n)} rpm · 后轮 ${f0(wheel)} rpm`);
}
/** 四冲程缸内气体的颜色 */
function gas4(thD, thr = 1) {
  const d = ((thD % 720) + 720) % 720;
  const T = S.G.timing;
  const ac = d > 360 ? d - 720 : d;           // −360..360，0 = 压缩上止点
  if (ac >= -22 && ac < 45) {
    const k = ac < -18 ? 0 : Math.min(1, (ac + 18) / 25);
    return { c: GAS.comp.clone().lerp(GAS.burn, k), e: 0.25 + 1.6 * k * (1 - Math.max(0, ac - 20) / 30), a: .55 };
  }
  if (ac >= 45 && ac < T.EVO) return { c: GAS.burn.clone().lerp(GAS.hot, (ac - 45) / (T.EVO - 45)), e: .9 * (1 - (ac - 45) / (T.EVO - 45)) + .2, a: .5 };
  if (d >= T.EVO && d < 360) return { c: GAS.exh, e: 0.05, a: .45 };
  if (d >= 360 && d < T.IVC) return { c: GAS.fresh, e: .15, a: .42 * (0.5 + 0.5 * thr) };
  return { c: GAS.fresh.clone().lerp(GAS.comp, (d - T.IVC) / (698 - T.IVC)), e: .2, a: .5 };
}

// ================================================================ 01 总览
const ch1 = {
  id: 'overview', nav: '总览', title: '踏板车的动力：从油箱（或电池）到后轮',
  view: { model: 'all' },
  lead: '踏板车（スクーター）和一般摩托车最大的不同：<b>不用换档、没有离合器手柄</b>，拧油门就走。发动机藏在座位下面，和皮带变速箱、后轮装成一整块。舞台上是四台教学模型，点名字可以直接去对应的章：最主流的<b>四冲程 + 皮带无级变速</b>，已经少见的<b>二冲程</b>，以及两种<b>电动</b>的做法。',
  body: () => `
    <div class="family">
      ${[['unit', '四冲程 + CVT', '最主流：125 cc 级别几乎都是这样'], ['two', '二冲程', '50 cc 老车，排放规定后基本退场'],
        ['ecvt', '电控 CVT', '电机代替离心滚子决定速比'], ['hybrid', '轻混', '发电机兼做助力电机'],
        ['ev', '电动', '轮毂电机 / 摆臂电机']]
        .map(([id, t, s]) => `<button class="pick" type="button" data-go="${id}"><b>${t}</b><span>${s}</span></button>`).join('')}
    </div>
    <p class="seglab">实验：在平路上匀速跑，车速多少要多大功率？</p>
    ${ctl('v1', '车速', 10, 110, 1, 60)}
    ${ctl('m1', '人 + 车', 120, 260, 5, 195)}
    ${plot('p1', 200, `<span>${sw(C.accent)}需要的功率（风阻 + 滚动阻力）</span><span>${sw(C.pd)}125 cc 能送到后轮的最大功率</span><span>${sw(C.ok)}电动（教学值 6 kW）</span><span>${sw(C.vio)}50 cc 二冲程</span>`)}
    ${kpis([['k1a', '需要功率'], ['k1b', '其中风阻'], ['k1c', '125 cc 余量'], ['k1d', '每 100 km 能量']])}`,
  notes: () => `
    ${note('动力走的路线', 'a', `<p>四冲程踏板车：<b>发动机曲轴</b> → <b>主动皮带轮</b> → <b>橡胶 V 带</b> → <b>从动皮带轮</b> → <b>离心离合器</b> → <b>两级减速齿轮</b> → <b>后轮</b>。皮带轮的直径会自己变，所以叫无级变速（CVT）；离合器转速够了自己咬合，所以没有离合器手柄。</p>`)}
    ${note('为什么发动机需要“变速”', 'a', `<p>发动机只在一段转速里有劲（这台教学机大约 5000～8000 rpm），低于 1500 rpm 就转不稳；而后轮从 0 转到每分钟一千多转。中间必须有一个能改变“发动机转几圈、后轮转一圈”的东西。普通摩托车用几档齿轮让人手动换，踏板车用皮带轮让离心力自动换。</p>`)}
    ${note('这个实验依赖的假设', 'c', `<p>需要的功率 = 滚动阻力 × 车速 + 风阻 × 车速。滚动阻力系数 0.015、风阻面积 C<sub>d</sub>A = 0.56 m²（人坐在车上），平路、无风。125 cc 按最大 9 kW、皮带和齿轮效率 0.88 × 0.96 算；50 cc 二冲程按 3.3 kW；电动按 6 kW、效率 0.95。都是教学车的量级，不对应任何车型。</p>`)}
    ${note('什么时候会不一样', 'd', `<p>上坡、逆风、两个人骑，需要的功率会明显变大；风阻和车速的三次方成正比，所以 90 km/h 以上，多一点车速就要多很多功率。实际最高速还受发动机限转和 CVT 最高档速比的限制（第 7 章）。</p>`)}`,
  enter(A) {
    A.setPins([
      { t: '四冲程 + CVT', p: [0, 0, 300], model: 'U4', onClick: () => A.go('unit') },
      { t: '二冲程', p: [820, 0, 200], model: 'T2', onClick: () => A.go('two') },
      { t: '轮毂电机', p: [-1250, 0, 380], model: 'EH', onClick: () => A.go('ev') },
      { t: '摆臂电机', p: [-2150, 0, 470], model: 'EM', onClick: () => A.go('ev') },
    ]);
    document.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => A.go(b.dataset.go); });
    const pl = new Plot($('p1'), { l: 40, b: 24 });
    const need = (v, M) => { const ms = v / 3.6; return (M * 9.81 * 0.015 * ms + 0.5 * 1.2 * 0.56 * ms ** 3) / 1000; };
    const Pice = 9.0 * S.CVT.etaB * S.CVT.etaG, Pev = 6 * .95, P2 = 3.3 * S.CVT.etaB * S.CVT.etaG;
    let V = 60, M = 195, cr = S.cruiseAt(60);
    const draw = () => {
      const xs = Array.from({ length: 111 }, (_, i) => i);
      pl.clear().scale(0, 110, 0, 10).axes({ xt: niceTicks(0, 110, 5), yt: niceTicks(0, 10, 5), xl: 'km/h', yl: 'kW' });
      pl.line(xs, xs.map((v) => need(v, M)), C.accent, 2);
      pl.hline(Pice, C.pd, [], 1.6).hline(Pev, C.ok, [5, 4], 1.4).hline(P2, C.vio, [2, 3], 1.4);
      const pn = need(V, M);
      pl.vline(V, C.mute).dot(V, pn, C.accent).label(V, pn, `${f1(pn)} kW`);
      const ms = V / 3.6, aero = 0.5 * 1.2 * 0.56 * ms ** 3 / 1000;
      setText('k1a', `${f1(pn)}<small>kW</small>`);
      setText('k1b', `${f0(aero / pn * 100)}<small>%</small>`);
      setText('k1c', pn < Pice ? `${f1(Pice - pn)}<small>kW</small>` : '<small>不够</small>');
      setText('k1d', `${f1(pn / ms * 1e5 / 3600)}<small>kWh</small>`);
    };
    range('v1', (v) => `${v} km/h`, (v) => { V = v; cr = S.cruiseAt(v); rpmNote(A, cr.n, v); draw(); }).upd();
    range('m1', (v) => `${v} kg`, (v) => { M = v; draw(); }).upd();
    return {
      tick(dt) {
        const st = A.stage;
        const sp = st.paused ? 0 : st.speed, ms = V / 3.6;
        spinU4(A, dt, { n: cr.n, x: cr.x });
        st.U4.gas = gas4(st.U4.th * 180 / Math.PI, cr.q);
        st.T2.th += 1500 * S.RPM * SLOW * dt * sp;
        st.EH.phi += ms / 0.232 * SLOW * dt * sp; st.EH.amp = .5; st.EH.phase = Math.PI / 2;
        st.EM.phi += ms / S.G.wheelR * S.G.emI * SLOW * dt * sp; st.EM.amp = .5; st.EM.phase = Math.PI / 2;
      },
      leave() { A.stage.EH.amp = 0; A.stage.EM.amp = 0; },
    };
  },
};

// ================================================================ 02 单元摆动
const ch2 = {
  id: 'unit', nav: '单元摆动', title: '发动机为什么跟着后轮一起上下动',
  view: { model: 'U4', view: 'swing' },
  lead: '踏板车的发动机不是固定在车架上的。发动机、皮带变速箱、减速齿轮和后轮做成<b>一个整块</b>，前端用一根轴挂在车架上，后端靠减震器撑着，过坑的时候整块一起绕这根轴上下摆。这种布置叫<b>单元摆动</b>（ユニットスイング），125 cc 以下的踏板车几乎都这样。',
  body: () => `
    <p class="seglab">动力走的路线（点名字在模型上找）</p>
    <div class="chainrow" id="chain2">
      ${[['U4_Crank', '曲轴'], ['U4_DriveFixed', '主动皮带轮'], ['belt', 'V 带'], ['U4_DrivenFixed', '从动皮带轮'], ['U4_ClutchBell', '离心离合器'],
        ['U4_CounterShaft', '减速齿轮'], ['U4_WheelTire', '后轮']].map(([n, t], i) => `${i ? '<em>→</em>' : ''}<span data-p="${n}">${t}</span>`).join('')}
    </div>
    <p class="seglab">实验：开过一条减速带</p>
    ${ctl('b2', '减速带高度', 10, 80, 5, 50)}
    ${ctl('s2', '车速', 10, 60, 5, 30)}
    <div class="btns"><button class="btn" id="go2" type="button">开过去</button><button class="btn" id="cvr2" type="button" aria-pressed="false">揭开 CVT 盖</button></div>
    ${plot('p2', 160, `<span>${sw(C.accent)}后轮中心上下</span><span>${sw(C.pd)}减震器压缩量</span>`)}
    ${kpis([['k2a', '摆动角度'], ['k2b', '后轮上下'], ['k2c', '减震压缩'], ['k2d', '皮带中心距变化']])}`,
  notes: () => `
    ${note('最大的好处：皮带不用管悬挂', 'a', `<p>皮带两头的轴（曲轴、从动轴）都在同一个摆动的壳里，后轮上下跳的时候，它们之间的距离<b>一点都不变</b>（右边“皮带中心距变化”一直是 0）。如果发动机固定在车架上、只有后轮摆，皮带就得跟着松紧，没法做。链条车可以靠链条松一点来凑合，皮带 CVT 不行。</p>`)}
    ${note('其他好处和代价', 'ab', `<p>好处：零件少、便宜、窄，脚下能做成平的踏板，座位下还有地方放头盔。专利里常见的理由就是“收窄前部、加大脚踏空间”${P('JPS60179325A')}，以及把 V 带室和充油的减速齿轮室做在同一个箱体里、只拆 V 带盖就能换皮带${P('US4494623A')}。</p>
      <p>代价：减震器下面挂着的东西（叫<b>簧下质量</b>）很重，整个发动机都算进去了，所以过连续的小坑时后轮“跟不上”路面，比一般摩托车颠。</p>`)}
    ${note('也有不摆的', 'b', `<p>大排量踏板（双缸）常把发动机固定在车架上，只让皮带变速部分摆动${P('US6612391B2')}；早年也有二冲程踏板把发动机固定在踏板前下方、用传动轴把动力送到后面摆动的变速箱${P('US4697664A')}。四冲程放进摆动单元的难点之一是油底壳，专利里有把变速箱底部兼作油底壳的做法${P('US4505352A')}。</p>`)}
    ${note('这个实验依赖的假设', 'c', `<p>只看几何：后轮按一条平滑的减速带上下动（上坡、坎顶、下坡各 0.8 m），整个总成绕摆动轴转，减震器长度跟着变。没有算弹簧和阻尼的动态，也没有算轮胎变形。簧下质量多大要看车型，这里不给数。</p>`)}`,
  enter(A) {
    const st = A.stage, k = A.spec.models.U4.kin;
    A.setPins(A.pins('U4', 'pins', ['摆动轴', '后减震', 'CVT 箱', '后轮', '齿轮箱', '气缸']));
    document.querySelectorAll('#chain2 span').forEach((s) => {
      s.onclick = () => {
        if (s.dataset.p === 'belt') { A.toast('橡胶 V 带（内侧有齿，好弯）'); if (!st.hidden.has('U4_CVTCover')) { st.toggleHidden('U4_CVTCover'); A.toolbar(); } return; }
        st.flash(s.dataset.p); const pt = st.part(s.dataset.p); if (pt) A.toast(pt.cn);
      };
    });
    $('cvr2').onclick = () => { st.toggleHidden('U4_CVTCover'); $('cvr2').setAttribute('aria-pressed', st.hidden.has('U4_CVTCover')); A.toolbar(); };
    const pl = new Plot($('p2'), { l: 40, b: 22 });
    const ax = k.axl, pv = k.pivot;
    const armL = Math.hypot(ax[0] - pv[0], ax[2] - pv[2]);
    let H = 50, V = 30, t = -1, trace = [], cr = S.cruiseAt(30);
    const T_EV = 1.2;
    const bump = (tt) => {               // 后轮中心的上下（mm）：上坎 → 下坎
      const L = 0.8 / (V / 3.6);        // 上坡、坎顶、下坡各 0.8 m（像一条减速带）
      if (tt < 0 || tt > L * 3) return 0;
      const u = tt / L;
      return u < 1 ? H * (1 - Math.cos(Math.PI * u)) / 2 : u < 2 ? H : H * (1 + Math.cos(Math.PI * (u - 2))) / 2;
    };
    const geom = (z) => {
      const ang = Math.asin(Math.max(-.5, Math.min(.5, z / armL)));
      return ang;
    };
    const shockLen = (ang) => {
      const c = Math.cos(ang), s = Math.sin(ang);
      const b = k.shock[1], top = k.shock[0];
      const rx = b[0] - pv[0], rz = b[2] - pv[2];
      // 绕 +Y 转 −ang（车轮往上 = 总成绕摆动轴往上转）
      const a = ang;
      const bx = pv[0] + rx * Math.cos(a) + rz * Math.sin(a), bz = pv[2] - rx * Math.sin(a) + rz * Math.cos(a);
      return Math.hypot(bx - top[0], bz - top[2]);
    };
    const L0 = shockLen(0);
    const draw = () => {
      pl.clear().scale(0, T_EV, -10, 90).axes({ xt: [0, .25, .5, .75, 1], yt: [0, 20, 40, 60, 80], xl: 's', yl: 'mm' });
      if (trace.length > 1) {
        pl.line(trace.map((q) => q[0]), trace.map((q) => q[1]), C.accent, 2);
        pl.line(trace.map((q) => q[0]), trace.map((q) => q[2]), C.pd, 1.8);
      }
    };
    range('b2', (v) => `${v} mm`, (v) => { H = v; }).upd();
    range('s2', (v) => `${v} km/h`, (v) => { V = v; cr = S.cruiseAt(v); }).upd();
    $('go2').onclick = () => { t = 0; trace = []; };
    draw();
    A.setSlow('动画慢放：转动 1/40（按匀速巡航算），摆动 1/6');
    return {
      tick(dt) {
        const sp = st.paused ? 0 : st.speed;
        spinU4(A, dt, { n: cr.n, x: cr.x });
        st.U4.gas = gas4(st.U4.th * 180 / Math.PI, cr.q);
        let z = 0;
        if (t >= 0) {
          t += dt / 6 * sp;
          z = bump(t);
          trace.push([t, z, L0 - shockLen(geom(z))]);
          if (t > T_EV) t = -1;
          draw();
        }
        const ang = geom(z);
        st.U4.swing = ang;    // 车轮往上 = 绕 +Y 正方向转（车头朝 +X、后轮在摆动轴后面）
        setText('k2a', `${f1(ang * 180 / Math.PI)}<small>°</small>`);
        setText('k2b', `${f0(z)}<small>mm</small>`);
        setText('k2c', `${f0(L0 - shockLen(ang))}<small>mm</small>`);
        setText('k2d', '0<small>mm</small>');
      },
      leave() { st.U4.swing = 0; },
    };
  },
};

// ================================================================ 03 四冲程
const ch3 = {
  id: 'four', nav: '四冲程', title: '四冲程：吸、压、功、排',
  view: { model: 'U4', view: 'eng', cut: 'eng', hide: ['U4_AirBox', 'U4_Frame'] },
  lead: '模型沿气缸中心剖开了。活塞往复四趟（曲轴转两圈）完成一次循环：<b>进气</b>（活塞往外走，进气门开，吸进汽油和空气的混合气）→ <b>压缩</b>（两个气门都关，挤小到原来的约 1/11）→ <b>做功</b>（火花塞点火，燃烧把活塞推回去）→ <b>排气</b>（排气门开，把废气推出去）。踏板车的气缸几乎是<b>躺着</b>的，往前倾，只比水平高 12°，这样才能塞进座位下面、让踏板是平的。',
  body: () => `
    <div class="phases" id="ph3">${[['0', '进气', '360→540°'], ['1', '压缩', '540→720°'], ['2', '做功', '0→180°'], ['3', '排气', '180→360°']]
      .map(([v, t, s]) => `<button class="btn" type="button" data-v="${v}"><small>${s}</small>${t}</button>`).join('')}</div>
    <div class="btns"><button class="btn" id="run3" type="button" aria-pressed="true">▶ 连续转</button><button class="btn" id="chain3" type="button" aria-pressed="false">看正时链（透视）</button></div>
    ${ctl('a3', '曲轴角度', 0, 719, 1, 0)}
    ${ctl('t3', '油门', 10, 100, 5, 100)}
    <div class="stepnote" id="n3"></div>
    <div class="duo2">
      ${plot('p3a', 170, `<span>${sw(C.pd)}p–V 图（缸压 – 容积）</span>`)}
      ${plot('p3b', 170, `<span>${sw(C.accent)}进气门</span><span>${sw(C.warn)}排气门</span>`)}
    </div>
    ${kpis([['k3a', '冲程'], ['k3b', '缸压'], ['k3c', '每循环做功'], ['k3d', '相当于扭矩']])}`,
  notes: () => `
    ${note('为什么要转两圈', 'a', `<p>活塞往外、往里各一趟只够做两件事。进气、压缩、做功、排气四件事就要四趟、两圈。所以凸轮轴的链轮比曲轴的大一倍，<b>曲轴转两圈它转一圈</b>，每个凸轮每两圈顶一次摇臂、开一次气门。</p>`)}
    ${note('气门为什么早开晚关', 'a', `<p>右上图里进气门在上止点前 10° 就开、下止点后 40° 才关；排气门在下止点前 40° 就开。气体有惯性：早开晚关能多吸一点、排干净一点。两个气门同时开着的那一小段叫<b>气门重叠</b>。这些角度是本页设的典型值。</p>`)}
    ${note('踏板车发动机的常见做法', 'ab', `<p>125 cc 级别常见单缸、单凸轮轴（SOHC）两气门或四气门，风冷或水冷。为了省油，厂家会想办法减少摩擦：Honda 资料里列了<b>偏置气缸</b>（气缸中心稍微偏离曲轴中心，做功时活塞不那么用力压缸壁）、<b>滚子摇臂</b>${P('Honda eSP+')}；Yamaha 的 BLUE CORE 也用偏置气缸、镀层缸套、锻造活塞，125 cc 版本是风冷 SOHC 两气门、缸径 × 行程 52.4 × 57.9 mm${P('Yamaha BLUE CORE')}（本页教学机用了相近的 52.4 × 58 mm）。也有水冷 DOHC 四气门的踏板车发动机${P('US7066124B2')}。</p>
      <p>还有<b>可变气门</b>：进气用两套摇臂，电磁铁推销子把它们连起来或分开，低转速用温和的凸轮、高转速用“猛”的凸轮${P('EP2853700A1')}。</p>`)}
    ${note('这个实验依赖的假设', 'c', `<p>p–V 图是单区模型：压缩和膨胀按多变指数 1.32，燃烧放热按 Wiebe 函数从上止点前 20° 开始、持续 55°，气门开着时缸压往进气 / 排气压力靠拢。油门只改变进气压力（节气门关小 → 吸进去的气少 → 放热少）。曲线形状和量级是对的，数字不是任何发动机的实测。“相当于扭矩” = 每循环做功 ÷ 4π，没扣摩擦。</p>`)}
    ${note('什么时候会失效', 'd', `<p>点火太早（或油品太差、积碳）会爆震；空滤堵、气门间隙不对，进气量下降，扭矩就掉。冷车时摩擦大、混合气要加浓，怠速会高一些。</p>`)}`,
  enter(A) {
    const st = A.stage;
    st.U4.x = 0;
    A.setPins(A.pins('U4', 'pinsEng'));
    let run = true, th = 0, thr = 1, cyc = S.cycle4(1, 20);
    const pa = new Plot($('p3a'), { l: 36, b: 22 }), pb = new Plot($('p3b'), { l: 30, b: 22 });
    const ang = range('a3', (v) => `${v}°`, (v) => { th = v; run = false; $('run3').setAttribute('aria-pressed', 'false'); $('run3').textContent = '▶ 连续转'; });
    range('t3', (v) => `${v} %`, (v) => { thr = v / 100; cyc = S.cycle4(thr, 20 + (1 - thr) * 15); }).upd();
    ang.el.nextElementSibling.textContent = '0°';
    $('run3').onclick = () => { run = !run; $('run3').setAttribute('aria-pressed', run); $('run3').textContent = run ? '❚❚ 停' : '▶ 连续转'; };
    $('run3').textContent = '❚❚ 停';
    $('chain3').onclick = () => { const on = !st.ghost; st.setCut(on ? null : 'eng'); st.setGhost(on); $('chain3').setAttribute('aria-pressed', on); A.toolbar(); };
    document.querySelectorAll('#ph3 button').forEach((b) => {
      b.onclick = () => { th = [450, 630, 90, 270][+b.dataset.v]; run = false; $('run3').setAttribute('aria-pressed', 'false'); $('run3').textContent = '▶ 连续转'; };
    });
    const NOTE = {
      intake: '<b>进气</b>：活塞往曲轴方向走，缸里变大、气压变低；进气门开着，节气门后面的混合气被吸进来（青色小点）。',
      compress: '<b>压缩</b>：两个气门都关了，活塞往缸盖方向走，把混合气挤小。挤得越小，点火后推力越大，但太小会爆震。',
      power: '<b>做功</b>：上止点前一点火花塞跳火，火焰烧过整个燃烧室，压力冲到几十个大气压，把活塞推回去 —— 这是唯一往外出力的一趟。',
      exhaust: '<b>排气</b>：排气门打开，活塞往回走，把废气推进排气管（灰色小点）。',
    };
    A.stage.setFlows([
      { model: 'U4', key: 'intake', color: '#4cc9f0', speed: 260, spacing: 9 },
      { model: 'U4', key: 'exhaust', color: '#b9a99a', speed: 300, spacing: 9 },
      { model: 'U4', key: 'chain', color: '#d0d6de', speed: 60, spacing: 6, size: 2.6, loop: true },
    ]);
    const draw = () => {
      const d = ((th % 720) + 720) % 720;
      pa.clear().scale(0, 145, 0, 70).axes({ xt: [0, 50, 100, 140], yt: [0, 20, 40, 60], xl: 'cc', yl: 'bar' });
      pa.line(Array.from(cyc.V), Array.from(cyc.p), C.pd, 1.6);
      const ai = Math.round(d);
      pa.dot(cyc.V[ai], cyc.p[ai], C.mid);
      pb.clear().scale(0, 720, 0, 8).axes({ xt: [0, 180, 360, 540, 720], yt: [0, 4, 8], xl: '曲轴角 °', yl: 'mm' });
      const xs = Array.from({ length: 721 }, (_, i) => i);
      pb.line(xs, xs.map((a) => S.valveLifts(a).inL), C.accent, 1.8).line(xs, xs.map((a) => S.valveLifts(a).exL), C.warn, 1.8);
      pb.vline(d, C.fg, [2, 2]);
      const s4 = S.stroke4(d);
      setText('k3a', s4.cn);
      setText('k3b', `${f1(cyc.p[ai])}<small>bar</small>`);
      setText('k3c', `${f0(cyc.W)}<small>J</small>`);
      setText('k3d', `${f1(cyc.W / (4 * Math.PI))}<small>N·m</small>`);
      setText('n3', NOTE[s4.k]);
      document.querySelectorAll('#ph3 button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.v === s4.i ? 'true' : 'false'));
    };
    let acc = 0;
    A.setSlow('慢放：约 4 秒转两圈');
    return {
      tick(dt) {
        const sp = st.paused ? 0 : st.speed;
        if (run) { th = (th + 180 * dt * sp) % 720; ang.el.value = Math.round(th); ang.el.nextElementSibling.textContent = `${Math.round(th)}°`; }
        const U = st.U4;
        // 舞台的曲轴角度直接跟着实验走
        const target = th * Math.PI / 180;
        const prev = U.th;
        U.th = target; U.x = 0;
        U.phi2 = target / S.cvtGeom(0).i; U.phiB = U.phi2;
        st.belt.scroll((target - prev) * 27);
        const d = ((th % 720) + 720) % 720;
        U.gas = gas4(d, thr);
        U.spark = Math.abs(((d - 700 + 720) % 720)) < 8 ? 1 : 0;
        const { inL, exL } = S.valveLifts(d);
        const fi = st.flow('intake'), fe = st.flow('exhaust'), fc = st.flow('chain');
        if (fi) { fi.target = inL > .4 ? 1 : 0; fi.rate = sp * (run ? 1 : .3) * (0.3 + thr); }
        if (fe) { fe.target = exL > .4 ? 1 : 0; fe.rate = sp * (run ? 1 : .3); }
        if (fc) fc.rate = run ? sp : 0;
        acc += dt;
        if (acc > 1 / 30) { acc = 0; draw(); }
      },
      leave() { st.U4.spark = 0; },
    };
  },
};

// ================================================================ 04 二冲程
const ch4 = {
  id: 'two', nav: '二冲程', title: '二冲程：没有气门，活塞自己开关气口',
  view: { model: 'T2', view: 'cut', cut: 'mid' },
  lead: '二冲程发动机<b>没有气门、没有凸轮轴</b>。缸壁上开着几个口：排气口、扫气口；活塞往返时把它们盖住或露出来，自己就是阀门。<b>曲轴箱</b>也被利用起来：活塞往缸盖走时，曲轴箱变大、把混合气从簧片阀吸进来；活塞往回走时，又把它压一压，等扫气口一露出来就冲进气缸。所以曲轴每转<b>一圈</b>就做功一次。',
  body: () => `
    <div class="phases p5" id="ph4">${[['power', '做功', '0→90°'], ['blow', '排气口先开', '90→118°'], ['scav', '扫气', '118→242°'], ['loss', '漏新气', '242→270°'], ['comp', '压缩', '270→360°']]
      .map(([v, t, s]) => `<button class="btn" type="button" data-v="${v}"><small>${s}</small>${t}</button>`).join('')}</div>
    <div class="btns"><button class="btn" id="run4" type="button" aria-pressed="true">❚❚ 停</button></div>
    ${ctl('a4', '曲轴角度', 0, 359, 1, 0)}
    <div class="stepnote" id="n4"></div>
    <div class="duo2">
      <svg class="ring" id="r4" viewBox="-130 -130 260 260" aria-label="二冲程气口正时圆"></svg>
      <div>${kpis([['k4a', '排气口'], ['k4b', '扫气口'], ['k4c', '簧片阀']])}</div>
    </div>
    <div class="tw"><table class="cmp"><tr><th></th><th>二冲程 50 cc</th><th>四冲程 125 cc</th></tr>
      <tr><td>每转做功</td><td>1 次</td><td>半次（两圈一次）</td></tr>
      <tr><td>气门</td><td>没有（活塞开关气口）</td><td>进、排各 1～2 个</td></tr>
      <tr><td>润滑</td><td>机油跟混合气一起烧掉</td><td>油底壳循环</td></tr>
      <tr><td>排放</td><td>新气漏进排气、烧机油 → HC 多、冒烟</td><td>好控制，配三元催化</td></tr>
      <tr><td>同排量的劲</td><td>大</td><td>小一些，但省油</td></tr></table></div>`,
  notes: () => `
    ${note('曲轴箱就是打气筒', 'a', `<p>曲柄做成两片整圆，把曲轴箱里的空地方塞满，曲轴箱一被活塞压小，混合气就有压力。<b>簧片阀</b>是一片很薄的弹性片：曲轴箱是负压时被吸开、混合气进来；变成正压时自己贴回阀座，混合气就跑不回化油器。专利里有把簧片阀整个埋进曲轴箱进气孔、少占曲轴箱容积的做法，曲轴箱越小，一次压缩越强${P('JPH0752333Y2')}。</p>`)}
    ${note('为什么会漏新气', 'a', `<p>排气口比扫气口高，活塞往回走时，扫气口先被盖住（242°），排气口还开着（到 270°）。这 28° 里，缸里一部分新混合气会直接跑进排气管（舞台上偶尔从扫气口冲到排气口的青点）。扫气口的方向特意朝着背对排气口的缸壁，让新气先绕一圈再推废气（叫回流扫气），能少漏一点，但漏不干净。</p>`)}
    ${note('机油怎么办', 'ab', `<p>曲轴箱里走的是混合气，不能装机油。所以二冲程用<b>机油泵把机油按比例送进化油器</b>，跟着燃油一起进曲轴箱润滑轴承、再进气缸烧掉，这就是二冲程冒蓝烟的原因${P('JP2530849Y2')}。踏板车的布置也受它影响：有的设计把发动机固定在踏板前下方、用传动轴把动力送到后面${P('US4697664A')}。</p>`)}
    ${note('为什么踏板车不用二冲程了', 'ad', `<p>漏新气 + 烧机油，碳氢化合物排放很难压下去。日本、欧洲、中国的摩托车排放标准一步步收紧后，二冲程踏板车基本停产，换成了四冲程和电动。（具体是哪一年哪一阶段标准让它退场，各国不同，本页不给日期。）</p>`)}
    ${note('这个实验依赖的假设', 'c', `<p>气口正时是本页设的典型值：排气口上止点后 90° 开、270° 关；扫气口 118° 开、242° 关（对称，因为都是活塞开关的）。簧片阀按角度近似（活塞往缸盖走时开，带一点滞后），实际要看曲轴箱压力。</p>`)}`,
  enter(A) {
    const st = A.stage, k = A.spec.models.T2.kin;
    A.setPins(A.pins('T2'));
    let run = true, th = 0;
    const ang = range('a4', (v) => `${v}°`, (v) => { th = v; run = false; $('run4').textContent = '▶ 连续转'; $('run4').setAttribute('aria-pressed', 'false'); });
    ang.el.nextElementSibling.textContent = '0°';
    $('run4').onclick = () => { run = !run; $('run4').setAttribute('aria-pressed', run); $('run4').textContent = run ? '❚❚ 停' : '▶ 连续转'; };
    document.querySelectorAll('#ph4 button').forEach((b) => {
      b.onclick = () => { th = { power: 40, blow: 104, scav: 180, loss: 256, comp: 315 }[b.dataset.v]; run = false; $('run4').textContent = '▶ 连续转'; $('run4').setAttribute('aria-pressed', 'false'); };
    });
    st.setFlows([
      { model: 'T2', key: 'intake', color: '#4cc9f0', speed: 160, spacing: 7 },
      { model: 'T2', key: 'transfer+transfer2', color: '#7fe3ff', speed: 200, spacing: 7 },
      { model: 'T2', key: 'exhaust', color: '#b9a99a', speed: 260, spacing: 8 },
      { model: 'T2', key: 'short', color: '#4cc9f0', speed: 260, spacing: 10, size: 3.8 },
    ]);
    // 气口正时圆
    const svg = $('r4');
    const arc = (a0, a1, r, col, w) => {
      const p = (a) => { const t = (a - 90) * Math.PI / 180; return [r * Math.cos(t), r * Math.sin(t)]; };
      const [x0, y0] = p(a0), [x1, y1] = p(a1);
      return `<path d="M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="butt"/>`;
    };
    const ring = () => `${arc(0.5, 359.5, 104, '#1d2d45', 2)}
      ${arc(k.eo, 360 - k.eo, 100, '#b9a99a', 12)}${arc(k.to, 360 - k.to, 84, '#7fe3ff', 12)}${arc(205, 359.9, 68, '#4cc9f0', 10)}${arc(0, 25, 68, '#4cc9f0', 10)}
      <text x="0" y="-112" text-anchor="middle">上止点 0°</text><text x="0" y="122" text-anchor="middle">下止点 180°</text>
      <text x="58" y="-30" style="fill:#b9a99a">排气口</text><text x="44" y="-4" style="fill:#7fe3ff">扫气口</text><text x="-108" y="-40" style="fill:#4cc9f0">簧片阀</text>
      <line id="r4n" x1="0" y1="0" x2="0" y2="-108" stroke="#ffd166" stroke-width="2.5"/><circle r="4" fill="#ffd166"/>`;
    svg.innerHTML = ring();
    const NOTE = {
      power: '<b>做功</b>：燃烧把活塞推向曲轴。同时活塞下面的曲轴箱被压小，里面的混合气被压缩（簧片阀已经关上）。',
      blow: '<b>排气口先露出来</b>：缸里还有几个大气压，废气自己冲进排气管（灰点），缸压掉下来。',
      scav: '<b>扫气口也露出来</b>：曲轴箱里被压过的新混合气从两侧和上方的扫气口冲进气缸，把剩下的废气往排气口推。',
      loss: '<b>扫气口先被盖住、排气口还开着</b>：这一小段里会有一点新混合气直接跑进排气管（青点冲进排气管）。',
      comp: '<b>压缩</b>：两个口都被盖住，活塞压缩缸里的混合气；活塞下面的曲轴箱变大成负压，簧片阀被吸开，下一口混合气进来。',
    };
    let acc = 0;
    A.setSlow('慢放：约 3 秒转一圈');
    return {
      tick(dt) {
        const sp = st.paused ? 0 : st.speed;
        if (run) { th = (th + 120 * dt * sp) % 360; ang.el.value = Math.round(th); ang.el.nextElementSibling.textContent = `${Math.round(th)}°`; }
        const p = S.ports2(th);
        const T = st.T2;
        T.th = th * Math.PI / 180;
        T.reed = p.reed;
        const ac = th > 180 ? th - 360 : th;
        T.spark = Math.abs(ac + 18) < 7 ? 1 : 0;
        let gas;
        if (p.k === 'power') gas = { c: GAS.burn.clone().lerp(GAS.hot, th / 90), e: 1.4 * (1 - th / 90) + .3, a: .55 };
        else if (p.k === 'blow') gas = { c: GAS.exh, e: .05, a: .45 };
        else if (p.k === 'scav') gas = { c: GAS.exh.clone().lerp(GAS.fresh, Math.min(1, (th - k.to) / 70)), e: .1, a: .45 };
        else if (p.k === 'loss') gas = { c: GAS.fresh, e: .12, a: .45 };
        else gas = { c: GAS.fresh.clone().lerp(GAS.comp, (th - 270) / 75), e: .2, a: .5 };
        if (ac > -20 && ac < 0) gas = { c: GAS.comp.clone().lerp(GAS.burn, (ac + 20) / 20), e: .3 + 1.2 * (ac + 20) / 20, a: .55 };
        T.gas = gas;
        const fl = (key, on, r = 1) => { const f = st.flow(key); if (f) { f.target = on ? 1 : 0; f.rate = sp * (run ? r : .25); } };
        fl('intake', p.reed > .3);
        fl('transfer+transfer2', p.trOpen > .05);
        fl('exhaust', p.exOpen > .05 && p.k !== 'comp');
        fl('short', p.k === 'loss' || (p.k === 'scav' && th > 200));
        acc += dt;
        if (acc > 1 / 30) {
          acc = 0;
          const n = $('r4n'); if (n) n.setAttribute('transform', `rotate(${th})`);
          setText('k4a', `${f0(p.exOpen * 100)}<small>% 开</small>`);
          setText('k4b', `${f0(p.trOpen * 100)}<small>% 开</small>`);
          setText('k4c', p.reed > .3 ? '开' : '关');
          setText('n4', NOTE[p.k]);
          document.querySelectorAll('#ph4 button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === p.k ? 'true' : 'false'));
        }
      },
      leave() { st.T2.spark = 0; },
    };
  },
};

// ================================================================ 05 CVT
const ch5 = {
  id: 'cvt', nav: 'CVT', title: '皮带无级变速：两个皮带轮怎么自己变',
  view: { model: 'U4', view: 'cvt', hide: ['U4_CVTCover', 'U4_AirBox'] },
  lead: '每个皮带轮都是两片<b>锥形的盘</b>，一片固定、一片能沿轴滑。两片靠近，V 形槽变窄，皮带被挤得往外爬，皮带轮的“有效半径”变大；两片分开，皮带就往里掉。皮带总长不变，所以前面变大时后面一定变小。<b>前小后大 = 低档</b>（起步有劲），<b>前大后小 = 高档</b>（跑得快）。谁来推这片盘？前面靠<b>离心滚子</b>，后面靠<b>弹簧和扭力凸轮</b>。两边的力拉锯，停在哪里，速比就是多少。',
  body: () => `
    <div class="btns"><button class="btn" id="cut5" type="button" aria-pressed="false">沿两根轴剖开（看 V 形槽）</button><button class="btn" id="rl5" type="button" aria-pressed="false">看滚子（藏起两片盘）</button></div>
    ${ctl('v5', '车速', 0, 100, 1, 45)}
    ${ctl('q5', '油门（负载）', 0, 100, 5, 100)}
    ${ctl('m5', '滚子重量（每颗）', 8, 22, 0.5, 15)}
    ${plot('p5', 200, `<span>${sw(C.pd)}滚子推力 F<sub>1</sub></span><span>${sw(C.accent)}弹簧 + 扭力凸轮 F<sub>2</sub></span><span>${sw(C.mid)}平衡点</span>`)}
    ${kpis([['k5a', '速比'], ['k5f', '发动机转速'], ['k5b', '主动轮半径'], ['k5c', '从动轮半径'], ['k5d', '两边的力']])}
    <div class="stepnote" id="n5"></div>`,
  notes: () => `
    ${note('前面：离心滚子', 'ab', `<p>主动轮动盘背后有几条斜坡，每条里放一颗<b>滚子</b>（ウエイトローラー，十几克的金属芯 + 树脂皮）。转得越快，滚子被甩得越往外，沿斜坡把动盘往定盘那边挤，皮带就往外爬。离心力和转速的平方成正比，所以这一边的力只看<b>发动机转速</b>和<b>滚子多重</b>。专利里有轻、重两组滚子混用、用止挡做出中间速比的设计${P('US6682450B2')}，也有在动盘背后加凸轮、急加油时延迟升档的设计${P('US11105408B2')}。</p>`)}
    ${note('后面：弹簧 + 扭力凸轮', 'ab', `<p>从动轮的动盘被一根粗弹簧往紧里推（往低档推）。动盘的轴套上还开着几条<b>斜槽</b>，导销在里面滑：后轮阻力越大，从动轮上的扭矩越大，斜槽就把这股扭矩“拧”成轴向力，把动盘夹得更紧 → 降档。这叫<b>扭力凸轮</b>（トルクカム）。专利里有在斜槽里放树脂滚珠、把滑动摩擦变成滚动摩擦的做法${P('US4585429A')}。所以上坡、满油门时 CVT 会自己降档，跟汽车的“踩到底降档”很像。</p>`)}
    ${note('图怎么看', 'c', `<p>横轴是“变速进度”：0 = 最低档（速比 ${f2(S.G.iMax || 2.59)}），1 = 最高档（${f2(S.G.iMin || 0.8)}）。车速定了，速比定了，发动机转速也就定了（离合器已经咬住）：越往高档，发动机转得越慢。橙线是那个转速下滚子能给的推力，青线是从动轮那边要的力，<b>两线相交</b>的地方就是皮带停住的位置。满油门从 30 拖到 90 km/h：交点一路往右移，车速涨了三倍，发动机转速只涨了两三成 —— 第 7 章那条“差不多水平”的线就是这么来的。</p>`)}
    ${note('这个实验依赖的假设', 'c', `<p>滚子推力 = 滚子数 × 质量 × 角速度² × 半径 × 斜坡杠杆 × 标定系数；标定系数让 15 g 滚子、满油门时在 7000 rpm 左右开始升档。弹簧预紧 250 N、刚度 20 N/mm，扭力凸轮每 1 N·m 从动轮扭矩给 40 N。皮带两侧的推力比实际随速比和扭矩变化，这里当成 1:1。所以<b>趋势</b>可信，绝对的力不对应任何车型。</p>`)}
    ${note('什么时候会失效', 'd', `<p>皮带磨窄了，在同样的盘距下会往里掉，相当于整体往低档偏，<b>最高速下降</b>；滚子磨出平面，滚不动了，升档发涩、转速偏高；动盘轴套缺油、卡滞，会忽高忽低。这些是维修上常见的说法，本页没有做定量。</p>`)}`,
  enter(A) {
    const st = A.stage;
    A.setPins(A.pins('U4', 'pinsCvt'));
    const pl = new Plot($('p5'), { l: 44, b: 24 });
    let v = 45, q = 1, m = 15, xs = 0, xNow = 0, nNow = 3000;
    const nOf = (x) => S.cvtGeom(x).i * (v / 3.6) / S.G.wheelR * S.G.iF / S.RPM;
    const f1 = (x) => S.F1(nOf(x), x, m);
    const f2 = (x) => S.F2(x, Math.max(0, S.engTorque(Math.min(nOf(x), 9700), q)) * S.cvtGeom(x).i * S.CVT.etaB);   // 只看扭矩，不看断油限转
    const solve = () => S.steadyAt(v, q, m).x;
    const draw = () => {
      xs = solve();
      const X = Array.from({ length: 51 }, (_, i) => i / 50);
      const a = X.map(f1), b = X.map(f2);
      const top = Math.max(1200, Math.min(4000, Math.max(...a, ...b) * 1.1));
      pl.clear().scale(0, 1, 0, top).axes({ xt: [0, .25, .5, .75, 1], yt: niceTicks(0, top, 4), xf: (t) => t === 0 ? '低档' : t === 1 ? '高档' : t, xl: '变速进度', yl: 'N' });
      pl.line(X, a, C.pd, 2).line(X, b, C.accent, 2);
      const g = S.cvtGeom(xs), n = nOf(xs);
      pl.vline(xs, C.mid).dot(xs, f2(xs), C.mid).label(xs, f2(xs), `速比 ${f2v(g.i)}`);
      nNow = n;
      setText('k5a', f2v(g.i));
      setText('k5f', `${f0(n)}<small>rpm</small>`);
      setText('k5b', `${f0(g.r1)}<small>mm</small>`);
      setText('k5c', `${f0(g.r2)}<small>mm</small>`);
      setText('k5d', `${f0(f2(xs))}<small>N</small>`);
      let msg;
      if (n < S.CLUTCH.nEng + 100) msg = '车速太低：发动机转速还没到离合器咬合的转速，实际是<b>离合器打滑起步</b>那一段（第 6 章），皮带停在最低档。';
      else if (xs === 0) msg = '滚子推力还不够大，皮带停在<b>最低档</b>：发动机转速随车速一起涨。';
      else if (xs === 1) msg = '已经到<b>最高档</b>：再快，发动机转速只能跟着车速涨，直到功率不够或者限转。';
      else msg = '<b>正在变速</b>：两边的力在交点平衡。拖动车速，看交点往哪边走、发动机转速变了多少。';
      setText('n5', msg);
      rpmNote(A, n, v);
    };
    const f2v = (x) => x.toFixed(2);
    range('v5', (val) => `${val} km/h`, (val) => { v = val; draw(); }).upd();
    range('q5', (val) => `${val} %`, (val) => { q = val / 100; draw(); }).upd();
    range('m5', (val) => `${val} g`, (val) => { m = val; draw(); }).upd();
    $('cut5').onclick = () => {
      const on = st.cutKey !== 'pulley';
      st.applyView({ model: 'U4', view: on ? 'pulley' : 'cvt', cut: on ? 'pulley' : null, hide: ['U4_CVTCover', 'U4_AirBox', ...(st.hidden.has('U4_DriveFixed') ? ['U4_DriveFixed', 'U4_DriveMovable'] : [])] });
      $('cut5').setAttribute('aria-pressed', on); A.toolbar();
    };
    $('rl5').onclick = () => {
      const on = !st.hidden.has('U4_DriveFixed');
      for (const nm of ['U4_DriveFixed', 'U4_DriveMovable']) { if (on) st.hidden.add(nm); else st.hidden.delete(nm); }
      st.setHidden([...st.hidden]);
      $('rl5').setAttribute('aria-pressed', on);
    };
    return {
      tick(dt) {
        xNow += (xs - xNow) * (1 - Math.exp(-3 * dt));
        spinU4(A, dt, { n: nNow, x: xNow });
        st.U4.gas = gas4(st.U4.th * 180 / Math.PI);
      },
    };
  },
};

// ================================================================ 06 离心离合器
const ch6 = {
  id: 'clutch', nav: '离合器', title: '离心离合器：怠速不走，一拧油门就咬上',
  view: { model: 'U4', view: 'clutch', cut: 'clutch', hide: ['U4_CVTCover', 'U4_AirBox', 'U4_Frame'] },
  lead: '从动皮带轮的外侧装着一个托盘，上面用销子挂着三块<b>离合块</b>（带摩擦片），被小弹簧往里拉着。外面罩着一个<b>离合器外鼓</b>，外鼓连着往后轮去的轴。怠速时从动轮转得慢，离合块甩不出去，外鼓不动，车停着；转速一高，离合块被甩开、贴住外鼓，靠摩擦把扭矩传过去。',
  body: () => `
    ${ctl('n6', '发动机转速', 1500, 7000, 50, 1700)}
    ${ctl('e6', '咬合转速', 2600, 4400, 100, 3200)}
    ${plot('p6', 180, `<span>${sw(C.accent)}离合器能传的扭矩（换算到曲轴）</span><span>${sw(C.pd)}发动机满油门扭矩</span>`)}
    ${kpis([['k6a', '从动轮转速'], ['k6b', '离合器'], ['k6c', '能传扭矩'], ['k6d', '离合块外摆']])}
    <p class="seglab">实验：从停车满油门起步，看前 3 秒</p>
    <div class="btns"><button class="btn" id="go6" type="button">起步</button></div>
    ${plot('p6b', 150, `<span>${sw(C.pd)}发动机转速</span><span>${sw(C.accent)}外鼓转速（换算到曲轴）</span><span>${sw(C.mute)}打滑的那一段</span>`)}`,
  notes: () => `
    ${note('为什么用离心离合器', 'a', `<p>踏板车没有离合器手柄，又必须能停在红灯前不熄火。离心离合器自己按转速决定：低于咬合转速完全分开，高于它逐渐贴紧。起步时有一小段是<b>半离合打滑</b>（下图灰色那段），发动机先冲到有劲的转速，再把车拖起来。</p>`)}
    ${note('它在哪里', 'b', `<p>离合器装在<b>从动轮</b>那一侧、外鼓连着减速齿轮的输入轴，这是专利里常见的布置${P('US6682450B2', 'US4494623A')}。三块离合配重一端用销子铰接、另一端被弹簧往里拉，外端带摩擦片${P('US11149805B2')}。</p>`)}
    ${note('这个实验依赖的假设', 'c', `<p>离合块的离心力和从动轮转速的平方成正比，减去弹簧力后乘摩擦系数和外鼓半径就是能传的扭矩：<b>T = K·(ω² − ω₀²)</b>，ω₀ 由“咬合转速”决定（按最低档换算成发动机转速）。起步实验用了第 7 章的整车模型：锁住时算需要多大扭矩才能保持锁住，超过能力就打滑；打滑时两边按摩擦扭矩各自加速。</p>`)}
    ${note('什么时候会失效', 'd', `<p>摩擦片磨损或外鼓上有油、有台阶，会出现<b>起步抖</b>（ジャダー）：摩擦力忽大忽小。专利里有让滚子凸轮和配重曲面配合、摩擦片磨损后助推力不变的设计，就是为了起步稳${P('US11149805B2')}。离合弹簧疲劳变软，咬合转速变低，起步发闷；反过来咬合转速调太高，起步猛但离合器发热、磨得快。</p>`)}`,
  enter(A) {
    const st = A.stage, U = st.U4;
    A.setPins(A.pins('U4', 'pinsCvt', ['离合块', '离合器外鼓', '从动轮', '弹簧']));
    const pl = new Plot($('p6'), { l: 40, b: 24 }), pb = new Plot($('p6b'), { l: 44, b: 22 });
    let n = 1700, ne = 3200, run = null, trace = [];
    const i0 = S.G.iMax;
    const draw = () => {
      const xs = Array.from({ length: 111 }, (_, i) => 1500 + i * 50);
      pl.clear().scale(1500, 7000, 0, 16).axes({ xt: [2000, 3000, 4000, 5000, 6000, 7000], yt: [0, 4, 8, 12, 16], xl: 'rpm', yl: 'N·m' });
      pl.line(xs, xs.map((r) => Math.min(16, S.clutchCap(r * S.RPM / i0, ne) / i0)), C.accent, 2);
      pl.line(xs, xs.map((r) => S.tqWot(r)), C.pd, 2);
      pl.vline(ne, C.mute).label(ne, 14, '开始咬合', C.text);
      pl.vline(n, C.fg, [2, 2]);
      const cap = S.clutchCap(n * S.RPM / i0, ne);
      setText('k6a', `${f0(n / i0)}<small>rpm</small>`);
      setText('k6b', cap <= 0 ? '分开' : cap / i0 < S.tqWot(n) ? '打滑' : '咬住');
      setText('k6c', `${f1(cap / i0)}<small>N·m</small>`);
    };
    range('n6', (v) => `${v} rpm`, (v) => { n = v; draw(); }).upd();
    range('e6', (v) => `${v} rpm`, (v) => { ne = v; draw(); }).upd();
    const drawB = () => {
      pb.clear().scale(0, 3, 0, 8000).axes({ xt: [0, 1, 2, 3], yt: [0, 2000, 4000, 6000, 8000], xl: 's', yl: 'rpm' });
      if (trace.length < 2) return;
      const ts = trace.map((q) => q[0]);
      const slipEnd = trace.findIndex((q) => q[3]);
      if (slipEnd > 0) pb.clip((g) => { g.fillStyle = 'rgba(93,112,137,.18)'; g.fillRect(pb.X(trace.find((q) => q[1] > ne - 50)?.[0] ?? 0), pb.pad.t, pb.X(trace[slipEnd][0]) - pb.X(trace.find((q) => q[1] > ne - 50)?.[0] ?? 0), pb.h - pb.pad.t - pb.pad.b); });
      pb.line(ts, trace.map((q) => q[1]), C.pd, 2).line(ts, trace.map((q) => q[2]), C.accent, 2);
    };
    $('go6').onclick = () => { run = new S.Ride({ clutchN: ne }); trace = []; };
    drawB();
    let sh = 0;
    A.setSlow('转动慢放 1/40');
    return {
      tick(dt) {
        const sp = st.paused ? 0 : st.speed;
        let rpm = n, wb = 0, lock = false, cl = 0;
        if (run) {
          for (let k = 0; k < 2; k++) run.step(dt / 2 * sp, 1);
          trace.push([run.t, run.n, run.v * S.G.iF / S.G.wheelR / S.RPM * run.geom().i, run.lock]);
          rpm = run.n; wb = run.v * S.G.iF / S.G.wheelR; lock = run.lock;
          cl = S.clutchCap(rpm * S.RPM / run.geom().i, ne) > 0 ? 1 : 0;
          drawB();
          if (run.t > 3) run = null;
        } else {
          cl = S.clutchCap(n * S.RPM / i0, ne) > 0 ? 1 : 0;
          lock = S.clutchCap(n * S.RPM / i0, ne) / i0 > S.tqWot(n);
          wb = lock ? n * S.RPM / i0 : 0;
        }
        sh += (cl - sh) * (1 - Math.exp(-8 * dt));
        spinU4(A, dt, { n: rpm, x: run ? run.x : 0, wb, lock, clutch: sh });
        U.gas = gas4(U.th * 180 / Math.PI);
        setText('k6d', `${f1(sh * 2.6)}<small>°</small>`);
      },
    };
  },
};

// ================================================================ 07 开起来
const ch7 = {
  id: 'ride', nav: '开起来', title: '开起来：转速“粘”在一条线上，车速一直往上走',
  view: { model: 'U4', view: 'cvt', hide: ['U4_CVTCover', 'U4_AirBox'] },
  lead: '把前面几章合起来，放一辆车（人 + 车约 195 kg）在路上跑。满油门起步：离合器先打滑，转速冲上去；咬住后，CVT 一边升档一边让<b>发动机转速差不多停在一个值</b>，车速一直往上涨，直到最高档。这就是 CVT 车开起来“嗡——”一声一直往前走、没有换档顿挫的原因。改滚子重量、坡度，看这条线怎么移动。',
  body: () => `
    ${seg('c7', [['hand', '自己拧油门', ''], ['cruise', '定速 50 km/h', '电脑替你拧']], 'hand')}
    ${ctl('q7', '油门', 0, 100, 5, 100)}
    ${ctl('m7', '滚子重量（每颗）', 10, 20, 0.5, 15)}
    ${ctl('g7', '坡度', 0, 20, 1, 0)}
    ${ctl('w7', '骑手体重', 45, 150, 5, 65)}
    <div class="btns"><button class="btn" id="go7" type="button">停车 → 重新起步</button><button class="btn" id="ref7" type="button" aria-pressed="false">留一条对比线</button></div>
    ${plot('p7a', 190, `<span>${sw(C.pd)}发动机转速 – 车速</span><span>${sw(C.mute)}最低档 / 最高档</span><span>${sw(C.vio)}对比线</span>`)}
    ${plot('p7b', 130, `<span>${sw(C.accent)}车速 – 时间</span><span>${sw(C.vio)}对比线</span>`)}
    ${kpis([['k7a', '车速'], ['k7b', '转速'], ['k7c', '速比'], ['k7d', '离合器'], ['k7e', '0–60 km/h']])}`,
  notes: () => `
    ${note('左图怎么看', 'a', `<p>两条灰色斜线是“如果速比固定”时转速和车速的关系：陡的是最低档，平的是最高档。起步时先在左下角打滑（离合器还没咬住，转速涨、车速几乎不涨），咬住后沿最低档线往上，到了某个转速 CVT 开始升档，曲线变成<b>几乎水平</b>的一段，车速往右走；等皮带爬到最高档，又沿最高档那条线往上，直到功率和阻力平衡。</p>`)}
    ${note('滚子重量是“改车”最常动的地方', 'ad', `<p><b>滚子轻</b>：同样转速离心力小，要转得更高才推得动动盘，那条水平线往上移 → 起步加速更猛，但更吵、更费油。<b>滚子重</b>：水平线往下移 → 安静省油，加速发闷，上坡可能没劲。实验里换 12 g 和 18 g 能看到大约 1000 rpm 的差别（本页模型的数）。改车的人还会同时换离合弹簧和扭力弹簧，因为三者是一起配的。</p>`)}
    ${note('上坡为什么会自己降档', 'c', `<p>选“定速 50 km/h”，再把坡度拉上去：要保持车速就得把油门开大，发动机扭矩变大，从动轮上的扭矩跟着变大，扭力凸轮把动盘夹得更紧 → 第 5 章的青线变高 → 平衡点往低档移。结果是同样 50 km/h，上坡时<b>速比更低、转速更高</b>，跟人手动降档一样，不用任何电子控制。</p>`)}
    ${note('这个实验依赖的假设', 'c', `<p>发动机按满油门扭矩曲线（峰值约 11.7 N·m / 7000 rpm，最大约 9 kW）和油门开度换算；皮带效率 0.88、齿轮 0.96；滚动阻力 0.015、C<sub>d</sub>A 0.56 m²；变速的快慢按两边力差的一阶响应。都是教学车的量级，0–60 用时、最高速只适合比较“改了什么、往哪边变”。</p>`)}
    ${note('什么时候会失效', 'd', `<p>皮带打滑（皮带老化、有油）时，转速冲上去车速却跟不上，图上的线会往上“飘”；离合器打滑也一样。皮带磨窄，最高档到不了，最高速下降。</p>`)}`,
  enter(A) {
    const st = A.stage, U = st.U4;
    A.setPins([]);
    let q = 1, m = 15, slope = 0, rider = 65, cruise = false, qc = 0.3;
    let ride = new S.Ride({ roll: m, slope, rider }), ref = null;
    const pa = new Plot($('p7a'), { l: 44, b: 24 }), pb = new Plot($('p7b'), { l: 40, b: 22 });
    const restart = () => { ride = new S.Ride({ roll: m, slope: slope / 100, rider }); };
    range('q7', (v) => `${v} %`, (v) => { q = v / 100; }).upd();
    range('m7', (v) => `${v} g`, (v) => { m = v; ride.o.roll = v; }).upd();
    range('g7', (v) => `${v} %`, (v) => { slope = v; ride.o.slope = v / 100; }).upd();
    range('w7', (v) => `${v} kg`, (v) => { rider = v; ride.o.rider = v; }).upd();
    $('go7').onclick = restart;
    segBind('c7', (v) => { cruise = v === 'cruise'; $('q7').disabled = cruise; });
    $('ref7').onclick = () => { ref = ride.trace.slice(); $('ref7').setAttribute('aria-pressed', 'true'); };
    const rr = (v, i) => v / 3.6 / S.G.wheelR * S.G.iF * i / S.RPM;
    const draw = () => {
      pa.clear().scale(0, 110, 0, 10000).axes({ xt: niceTicks(0, 110, 5), yt: [0, 2500, 5000, 7500, 10000], xl: 'km/h', yl: 'rpm' });
      pa.line([0, 110], [0, rr(110, S.G.iMax)], C.mute, 1, [4, 4]).line([0, 110], [0, rr(110, S.G.iMin)], C.mute, 1, [4, 4]);
      pa.hline(S.ENG.limit, C.warn, [2, 3]);
      if (ref && ref.length > 1) pa.line(ref.map((p) => p[1]), ref.map((p) => p[2]), C.vio, 1.4);
      const tr = ride.trace;
      if (tr.length > 1) pa.line(tr.map((p) => p[1]), tr.map((p) => p[2]), C.pd, 2).dot(ride.v * 3.6, ride.n, C.pd);
      pb.clear().scale(0, 20, 0, 110).axes({ xt: [0, 5, 10, 15, 20], yt: [0, 30, 60, 90], xl: 's', yl: 'km/h' });
      if (ref && ref.length > 1) pb.line(ref.map((p) => p[0]), ref.map((p) => p[1]), C.vio, 1.4);
      if (tr.length > 1) pb.line(tr.map((p) => p[0]), tr.map((p) => p[1]), C.accent, 2);
      const t60 = tr.find((p) => p[1] >= 60);
      setText('k7a', `${f0(ride.v * 3.6)}<small>km/h</small>`);
      setText('k7b', `${f0(ride.n)}<small>rpm</small>`);
      setText('k7c', f2(ride.geom().i));
      setText('k7d', ride.lock ? '咬住' : (S.clutchCap(ride.n * S.RPM / ride.geom().i) > 0 ? '打滑' : '分开'));
      setText('k7e', t60 ? `${f1(t60[0])}<small>s</small>` : '–');
    };
    let acc = 0, rec = 0;
    A.setSlow('转动慢放 1/40；车速、时间按真实');
    return {
      tick(dt) {
        const sp = st.paused ? 0 : 1;
        if (sp) {
          let thr = q;
          if (cruise) {
            // 定速：简单的比例 + 积分，油门开度显示在滑块上
            const e = 50 - ride.v * 3.6;
            qc = Math.max(0, Math.min(1, qc + (0.02 * e) * dt * 4));
            thr = Math.max(0, Math.min(1, qc + 0.06 * e));
            $('q7').value = Math.round(thr * 100); $('q7-o').textContent = `${Math.round(thr * 100)} %`;
          }
          ride.step(dt, thr);
          rec += dt;
          if (rec > 0.05 && ride.t < 40) { rec = 0; ride.record(); }
        }
        const g = spinU4(A, dt, { n: ride.n, x: ride.x, wb: ride.v * S.G.iF / S.G.wheelR, lock: ride.lock, clutch: S.clutchCap(ride.n * S.RPM / ride.geom().i) > 0 ? 1 : 0 });
        U.gas = gas4(U.th * 180 / Math.PI, +$('q7').value / 100);
        acc += dt;
        if (acc > .1) { acc = 0; draw(); }
      },
    };
  },
};

// ================================================================ 08 起动、发电和怠速停止
const ch8 = {
  id: 'start', nav: '起动 / 怠速停止', title: '起动、发电和怠速停止',
  view: { model: 'U4', view: 'acg', cut: 'acg', hide: ['U4_FanCover', 'U4_Muffler', 'U4_Frame'] },
  lead: '曲轴右端装着一个<b>外转子发电机</b>（ACG）：外面一圈磁铁跟曲轴一起转，里面固定的线圈就发出电来给电池充电。很多新踏板车让它<b>兼做起动机</b>：起动时反过来给线圈通电，磁铁就带着曲轴转起来，不再需要单独的起动电机和一串减速齿轮。起动快、几乎没声音，于是红灯时可以放心<b>自动熄火</b>，一拧油门马上重新起动，这就是<b>怠速停止</b>。',
  body: () => `
    ${seg('s8', [['acg', 'ACG 起动机', '发电机兼起动'], ['conv', '传统起动', '起动电机 + 齿轮']], 'acg')}
    <div class="btns"><button class="btn" id="go8" type="button">起动一次</button></div>
    <div class="stepnote" id="n8">按“起动一次”。</div>
    ${plot('p8', 140, `<span>${sw(C.pd)}曲轴转速</span>`)}
    <p class="seglab">实验：一天上下班要停多少次红灯？</p>
    ${ctl('c8', '停车次数', 2, 40, 1, 14)}
    ${ctl('w8', '每次等多久', 5, 120, 5, 35)}
    ${kpis([['k8a', '怠速烧掉'], ['k8b', '停机能省'], ['k8c', '一年（250 天）']])}`,
  notes: () => `
    ${note('ACG 起动机的几个小技巧', 'b', `<p>单缸发动机最难转过的是<b>压缩上止点</b>。Honda 的专利和技术资料里写了：停机后让曲轴<b>反转</b>一点，停在压缩之前的位置，下次起动时先空转一段积攒速度再冲过压缩${P('US6782860B2', 'Honda 怠速停止')}；正转起动后的一小段时间里不点火，避免“白点火”${P('US6782860B2')}。外转子三相无刷的 ACG 去掉了起动电机和减速齿轮，Honda 资料称更轻更窄${P('Honda R&D 2010')}。</p>`)}
    ${note('传统方式', 'b', `<p>单独一台小直流电机，经过小齿轮、减速齿轮，再经一个<b>单向离合器</b>带曲轴；发动机一着车，单向离合器就自动脱开，不让发动机反拖电机。专利里有把起动从动齿轮做成薄环、兼作 CVT 动盘止挡的设计${P('JPH09228936A')}。这种方式起动时有“嗞嗞”的齿轮声，频繁起停会磨损。</p>`)}
    ${note('怠速停止什么时候不工作', 'ab', `<p>常见的条件：发动机还没热、电池电量不够、车速没归零、刚起步没开到一定速度……这些都在 Honda 的研发资料里讨论过${P('Honda R&D 2010')}。Honda 技术页给出的省油效果约 7 %（厂家说法，测试工况未知）${P('Honda 怠速停止')}。还有专利让 ACG 在离合器快要重新咬合时帮一把，让收油再加油时不拖沓${P('EP3604775B1')}。</p>`)}
    ${note('这个实验依赖的假设', 'cd', `<p>怠速油耗按 0.075 g/s（约 0.36 L/h）、每次重新起动多烧 0.25 g、等待不到 3 秒不熄火，都是我设的量级，没有找到可以直接引用的实测值。实际省多少取决于路况和停车时长。</p>`)}`,
  enter(A) {
    const st = A.stage, U = st.U4;
    A.setPins([{ t: 'ACG 线圈（定子）', p: [-30, -84, -30] }, { t: '磁铁（外转子）', p: [36, -84, 36] }, { t: '曲轴', p: [0, -84, 0] }]
      .map((x) => ({ ...x, model: 'U4' })));
    let mode = 'acg', anim = null, trace = [];
    const pl = new Plot($('p8'), { l: 44, b: 22 });
    const setMode = (v) => {
      mode = v; st.setVars({ conv: v === 'conv' });
      st.setHidden(v === 'conv' ? ['U4_FanCover', 'U4_Muffler', 'U4_Frame', 'U4_Crankcase'] : ['U4_FanCover', 'U4_Muffler', 'U4_Frame']);
      A.toolbar();
    };
    segBind('s8', setMode);
    setMode('acg');
    // 起动过程：ACG：反转 → 正转冲过压缩 → 着车；传统：电机带着慢慢转 → 着车
    const run = () => {
      anim = { t: 0, rpm: 0, fired: false }; trace = [];
    };
    $('go8').onclick = run;
    const drawP = () => {
      pl.clear().scale(0, 2.5, -400, 2200).axes({ xt: [0, .5, 1, 1.5, 2, 2.5], yt: [0, 1000, 2000], xl: 's', yl: 'rpm', zero: true });
      if (trace.length > 1) pl.line(trace.map((q) => q[0]), trace.map((q) => q[1]), C.pd, 2);
    };
    drawP();
    const calc = () => {
      const r = S.idleStop({ stops: +$('c8').value, wait: +$('w8').value });
      setText('k8a', `${f0(r.mlBurned)}<small>mL</small>`);
      setText('k8b', `${f0(r.mlSaved)}<small>mL</small>`);
      setText('k8c', `${f1(r.mlSaved * 250 / 1000)}<small>L</small>`);
    };
    range('c8', (v) => `${v} 次`, calc).upd();
    range('w8', (v) => `${v} s`, calc).upd();
    let idle = 0;
    return {
      tick(dt) {
        const sp = st.paused ? 0 : st.speed;
        let rpm = 0, acg = 0, phase = Math.PI / 2;
        if (anim) {
          anim.t += dt * sp * .5;
          const t = anim.t;
          if (mode === 'acg') {
            if (t < .25) { rpm = -220 * Math.sin(Math.PI * t / .25); acg = .9; phase = -Math.PI / 2; setText('n8', '<b>反转</b>：ACG 先让曲轴往回转一点，停到压缩之前，给下一步留出助跑距离。'); }
            else if (t < .7) { rpm = 900 * Math.min(1, (t - .25) / .2); acg = 1; setText('n8', '<b>正转</b>：线圈按顺序通电，磁铁带着曲轴加速，冲过压缩上止点。'); }
            else { rpm = 1700 + 300 * Math.exp(-(t - .7) * 4); acg = .25; if (!anim.fired) anim.fired = true; setText('n8', '<b>着车</b>：火花塞开始点火，发动机自己转起来。ACG 马上变回发电机（线圈只剩微弱的发电电流）。'); }
          } else {
            U.starter += dt * sp * 30;
            if (t < .9) { rpm = 280 + 40 * Math.sin(t * 40); setText('n8', '<b>起动电机</b>带小齿轮 → 减速齿轮 → 单向离合器 → 曲轴，转得慢（几百 rpm），能听到齿轮声。'); }
            else { rpm = 1700 + 300 * Math.exp(-(t - .9) * 4); acg = .25; setText('n8', '<b>着车</b>后发动机比起动电机转得快，<b>单向离合器</b>自己脱开，起动电机停下。'); }
          }
          trace.push([t, rpm]);
          drawP();
          if (t > 2.5) anim = null;
        } else rpm = trace.length ? 1700 : 0;
        if (!anim && trace.length) acg = .2;
        idle += rpm * S.RPM * dt * sp * (mode === 'acg' ? .12 : .12);
        U.th = idle; U.x = 0; U.phi2 = idle / S.G.iMax; U.phiB = 0;
        U.acg = acg; U.acgPhase = phase;
        U.gas = rpm > 1000 ? gas4(U.th * 180 / Math.PI) : { c: GAS.fresh, e: 0, a: .3 };
      },
      leave() { st.setVars({ conv: false }); U.acg = 0; },
    };
  },
};

// ================================================================ 09 电控 CVT
const ch9 = {
  id: 'ecvt', nav: '电控 CVT', title: '电控 CVT：让电脑决定速比',
  view: { model: 'U4', view: 'ecvt', sub: 'ecvt', ghost: true, hide: ['U4_CVTCover', 'U4_AirBox', 'U4_Frame'], vars: { cent: false, ecvt: true } },
  lead: '离心滚子 CVT 的速比只能由“转速 × 滚子重量”和“弹簧 + 扭矩”拉锯决定，想改就得拆开换滚子。<b>电控 CVT</b> 把滚子拿掉，换成一台小电机：电机经齿轮转动套在动盘上的<b>滑块</b>，滑块带螺纹，转一圈就把动盘推进（或拉出）一个螺距。电脑看油门、车速、模式，算出想要的发动机转速，再把动盘推到对应的位置。',
  body: () => `
    ${seg('s9', [['ecvtD', 'D 模式', '安静省油'], ['ecvtS', 'S 模式', '转速高'], ['ecvtM', '手动', '模拟 6 档']], 'ecvtD')}
    <div class="btns" id="mg9"><button class="btn" id="dn9" type="button">− 降档</button><button class="btn" id="up9" type="button">+ 升档</button><span class="status" id="gear9">1 档</span></div>
    ${ctl('q9', '油门', 0, 100, 5, 100)}
    <div class="btns"><button class="btn" id="go9" type="button">停车 → 重新起步</button></div>
    ${plot('p9', 190, `<span>${sw(C.vio)}电控</span><span>${sw(C.pd)}离心滚子（同样油门，对照）</span><span>${sw(C.mute)}最低档 / 最高档</span>`)}
    ${kpis([['k9a', '车速'], ['k9b', '转速'], ['k9c', '目标转速'], ['k9d', '动盘位置']])}`,
  notes: () => `
    ${note('结构', 'b', `<p>本页的执行器按 Honda 的一件专利画：电机 → 齿轮系 → 滑块 → 螺纹进给环推动主动轮动盘，再用转角传感器反馈位置${P('US7237638B2')}。Yamaha 的专利是电机经减速齿轮和进给螺杆推动盘，气缸相对曲轴往下偏，空出地方放这套机构${P('US8038557B2')}。也有<b>保留离心滚子</b>、另加电动执行器去推动盘的折中做法${P('US9551403B2')}。从动轮那边一般不变：弹簧 + 扭力凸轮 + 离心离合器。</p>`)}
    ${note('多了什么', 'a', `<p>速比和转速“脱钩”了：同一个油门，D 模式可以让转速低、安静省油，S 模式让转速高、随时有劲；还可以把速比锁在几个固定值，模拟“手动换档”，下坡时也能主动降档用发动机制动。离心 CVT 做不到这些。</p>`)}
    ${note('代价和失效', 'd', `<p>多了电机、齿轮、位置传感器和控制器，贵、重一点；执行器坏了速比就卡在一个位置，所以要有保护（比如回到低档才能起步）。我的推测：在 125 cc 级通勤车上，离心滚子已经够好又便宜，这是电控 CVT 一直不普及的主要原因。</p>`)}
    ${note('这个实验依赖的假设', 'c', `<p>目标转速：D = 3000 + 3800 × 油门，S = 5200 + 2600 × 油门（rpm）；手动 6 档按固定变速进度。动盘最快每秒走完全程的 1.6 倍。其余（发动机、离合器、整车）和第 7 章同一个模型。</p>`)}`,
  enter(A) {
    const st = A.stage, U = st.U4;
    A.setPins([{ t: '电机', p: [42, 110, 140] }, { t: '中间齿轮', p: [40, 70, 84] }, { t: '滑块齿轮（带螺纹，在动盘后面）', p: [14, 66, 30] }, { t: '动盘', p: [0, 100, -70] }]
      .map((x) => ({ ...x, model: 'U4' })));
    let mode = 'ecvtD', q = 1, gear = 1;
    let ride = new S.Ride({ mode }), ref = new S.Ride({ mode: 'cent' });
    const restart = () => { ride = new S.Ride({ mode, mgear: gear }); ref = new S.Ride({ mode: 'cent' }); };
    segBind('s9', (v) => { mode = v; ride.o.mode = v; $('mg9').style.opacity = v === 'ecvtM' ? 1 : .35; });
    $('mg9').style.opacity = .35;
    const sg = (d) => { gear = Math.max(1, Math.min(6, gear + d)); ride.o.mgear = gear; setText('gear9', `${gear} 档`); };
    $('up9').onclick = () => sg(1); $('dn9').onclick = () => sg(-1);
    range('q9', (v) => `${v} %`, (v) => { q = v / 100; }).upd();
    $('go9').onclick = restart;
    const pl = new Plot($('p9'), { l: 44, b: 24 });
    const rr = (v, i) => v / 3.6 / S.G.wheelR * S.G.iF * i / S.RPM;
    let acc = 0, rec = 0;
    A.setSlow('转动慢放 1/40');
    return {
      tick(dt) {
        if (!st.paused) {
          ride.step(dt, q); ref.step(dt, q);
          rec += dt; if (rec > .05 && ride.t < 40) { rec = 0; ride.record(); ref.record(); }
        }
        spinU4(A, dt, { n: ride.n, x: ride.x, wb: ride.v * S.G.iF / S.G.wheelR, lock: ride.lock, clutch: 1 });
        U.gas = gas4(U.th * 180 / Math.PI, q);
        acc += dt;
        if (acc > .1) {
          acc = 0;
          pl.clear().scale(0, 110, 0, 10000).axes({ xt: niceTicks(0, 110, 5), yt: [0, 2500, 5000, 7500, 10000], xl: 'km/h', yl: 'rpm' });
          pl.line([0, 110], [0, rr(110, S.G.iMax)], C.mute, 1, [4, 4]).line([0, 110], [0, rr(110, S.G.iMin)], C.mute, 1, [4, 4]);
          const a = ref.trace, b = ride.trace;
          if (a.length > 1) pl.line(a.map((p) => p[1]), a.map((p) => p[2]), C.pd, 1.4);
          if (b.length > 1) pl.line(b.map((p) => p[1]), b.map((p) => p[2]), C.vio, 2).dot(ride.v * 3.6, ride.n, C.vio);
          setText('k9a', `${f0(ride.v * 3.6)}<small>km/h</small>`);
          setText('k9b', `${f0(ride.n)}<small>rpm</small>`);
          setText('k9c', mode === 'ecvtM' ? `${gear}<small>档</small>` : `${f0(ride.nt || 0)}<small>rpm</small>`);
          setText('k9d', `${f1(ride.geom().delta)}<small>mm</small>`);
        }
      },
      leave() { st.setVars({ cent: true, ecvt: false }); },
    };
  },
};

// ================================================================ 10 混动
const ch10 = {
  id: 'hybrid', nav: '混动', title: '轻混：起步那几秒，发电机推一把',
  view: { model: 'U4', view: 'hyb', sub: 'hyb', vars: { hyb: true }, ghost: true },
  lead: '在 ACG 起动机的基础上再走一步：给它配一块高电压的锂电池和一个电力控制单元（逆变器），让它在<b>起步和加速的头几秒</b>当电机，往曲轴上额外加扭矩。平时它照常发电、给电池充回去。发动机、CVT、离合器都不变，所以叫<b>轻混</b>（マイルドハイブリッド）。',
  body: () => `
    ${seg('s10', [['on', '助力开', ''], ['off', '助力关', '普通 125 cc']], 'on')}
    <div class="btns"><button class="btn" id="go10" type="button">两台一起起步</button></div>
    ${plot('p10a', 170, `<span>${sw(C.ok)}有助力</span><span>${sw(C.pd)}没有助力</span><span>${sw(C.mute)}助力的那几秒</span>`)}
    ${plot('p10b', 150, `<span>${sw(C.pd)}发动机满油门扭矩</span><span>${sw(C.ok)}+ 电机助力</span>`)}
    ${kpis([['k10a', '0–30 有助力'], ['k10b', '0–30 无助力'], ['k10c', '助力扭矩'], ['k10d', '电池']])}`,
  notes: () => `
    ${note('PCX HYBRID 公开的做法', 'b', `<p>Honda 技术页说：在 ACG 起动机上加了助力功能，锂电池放在储物箱后面，拧油门后助力大约 <b>3 秒</b>，4000 rpm 时扭矩比纯汽油版高约 33 %（厂家说法）${P('Honda PCX HYBRID')}。所以本页的助力只在“油门开大后的 3 秒、转速不太高、电量够”时出现。</p>`)}
    ${note('别的混动布置', 'b', `<p>电机不一定装在曲轴上：Honda 有一件专利把<b>驱动电机的输出轴就做成从动轴</b>，接在 CVT 后面${P('US7290629B2')}；比亚乔（Piaggio）和比萨大学的专利把电机转子和离合器外鼓做成一体，放在 CVT 下游，方便回收能量，能纯油、纯电、串联、并联切换${P('US7351265B2')}；Piaggio 还有一件让电机经一组完全独立的齿轮带后轮、两边减速比各自优化的设计${P('IT202100029681A1')}。</p>`)}
    ${note('为什么只助力几秒', 'd', `<p>我的理解：小排量踏板车最“缺”的就是起步那一下（离合器打滑、转速还没起来）；而电池小、电机小，持续助力电池撑不住，也装不下大电池。只在起步加速时用，花小钱买手感最划算。</p>`)}
    ${note('这个实验依赖的假设', 'c', `<p>助力扭矩按 3.6 N·m（约为这台教学机 4000 rpm 扭矩的 1/3），在油门开大后 0.15 秒内加满、3 秒时撤掉，6500 rpm 以上不助力。电池容量和效率都是教学值。</p>`)}`,
  enter(A) {
    const st = A.stage, U = st.U4;
    A.setPins([{ t: '48 V 锂电池', p: [-150, 0, 340] }, { t: 'PCU（逆变器）', p: [20, -40, 252] }, { t: 'ACG（这时是电机）', p: [0, -116, 60] }, { t: '高压线', p: [40, -80, 150] }]
      .map((x) => ({ ...x, model: 'U4' })));
    st.setFlows([{ model: 'U4', key: 'hyb', color: '#4fd18b', speed: 160, spacing: 8, size: 4 }]);
    let on = true;
    let a = new S.Ride({ hybrid: true }), b = new S.Ride({ hybrid: false });
    const restart = () => { a = new S.Ride({ hybrid: on }); b = new S.Ride({ hybrid: false }); };
    segBind('s10', (v) => { on = v === 'on'; restart(); });
    $('go10').onclick = restart;
    const pa = new Plot($('p10a'), { l: 40, b: 22 }), pb = new Plot($('p10b'), { l: 36, b: 22 });
    pb.clear().scale(1500, 9000, 0, 18).axes({ xt: [2000, 4000, 6000, 8000], yt: [0, 6, 12, 18], xl: 'rpm', yl: 'N·m' });
    const xs = Array.from({ length: 76 }, (_, i) => 1500 + i * 100);
    pb.line(xs, xs.map((r) => S.tqWot(r)), C.pd, 2).line(xs, xs.map((r) => S.tqWot(r) + (r < 6500 ? 3.6 : 0)), C.ok, 2);
    let acc = 0, rec = 0;
    A.setSlow('转动慢放 1/40');
    return {
      tick(dt) {
        if (!st.paused && a.t < 8) {
          a.step(dt, 1); b.step(dt, 1);
          rec += dt; if (rec > .04) { rec = 0; a.record(); b.record(); }
        }
        spinU4(A, dt, { n: a.n, x: a.x, wb: a.v * S.G.iF / S.G.wheelR, lock: a.lock, clutch: 1 });
        U.gas = gas4(U.th * 180 / Math.PI);
        U.acg = a.Ta > .1 ? 1 : .15; U.acgPhase = Math.PI / 2;
        const f = st.flow('hyb'); if (f) { f.target = a.Ta > .1 ? 1 : 0; f.rate = st.paused ? 0 : 1; }
        acc += dt;
        if (acc > .1) {
          acc = 0;
          pa.clear().scale(0, 8, 0, 80).axes({ xt: [0, 2, 4, 6, 8], yt: [0, 20, 40, 60, 80], xl: 's', yl: 'km/h' });
          if (on) pa.clip((g) => { g.fillStyle = 'rgba(79,209,139,.10)'; g.fillRect(pa.X(0), pa.pad.t, pa.X(3) - pa.X(0), pa.h - pa.pad.t - pa.pad.b); });
          const ta = a.trace, tb = b.trace;
          if (tb.length > 1) pa.line(tb.map((p) => p[0]), tb.map((p) => p[1]), C.pd, 1.8);
          if (ta.length > 1) pa.line(ta.map((p) => p[0]), ta.map((p) => p[1]), C.ok, 2);
          const t30 = (tr) => { const p = tr.find((q) => q[1] >= 30); return p ? `${f2(p[0])}<small>s</small>` : '–'; };
          setText('k10a', on ? t30(ta) : '–'); setText('k10b', t30(tb));
          setText('k10c', `${f1(a.Ta)}<small>N·m</small>`);
          setText('k10d', `${f0(a.soc * 100)}<small>%</small>`);
        }
      },
      leave() { st.setVars({ hyb: false }); U.acg = 0; },
    };
  },
};

// ================================================================ 11 电动
const ch11 = {
  id: 'ev', nav: '电动', title: '电动踏板车：不要皮带，也不要离合器',
  view: { model: 'EM', view: 'home' },
  lead: '电机和发动机最大的不同：<b>从 0 转开始就有最大扭矩</b>，而且能转到一万多转。所以电动踏板车不需要离合器（停车时电机就停着），也不需要无级变速，一组固定的减速齿轮（或者干脆没有）就够。常见两种：电机装在<b>摆臂</b>前端、经齿轮带后轮；或者电机直接做成<b>后轮的轮毂</b>。',
  body: () => `
    ${seg('s11', [['EM', '摆臂电机', '两级齿轮减速'], ['EH', '轮毂电机', '直接驱动']], 'EM')}
    <div class="btns"><button class="btn" id="cut11" type="button" aria-pressed="false">剖开电机</button><button class="btn" id="go11" type="button">和 125 cc 一起起步</button></div>
    ${plot('p11a', 170, `<span>${sw(C.ok)}电动</span><span>${sw(C.pd)}125 cc 汽油</span>`)}
    ${plot('p11b', 150, `<span>${sw(C.ok)}电动的最大驱动力</span><span>${sw(C.pd)}汽油车实测（本页模型）</span>`)}
    ${ctl('b11', '电池容量', 1, 6, 0.1, 2.6)}
    ${kpis([['k11a', '0–30 电动'], ['k11b', '0–30 汽油'], ['k11c', '40 km/h 续航'], ['k11d', '每 km 用电']])}`,
  notes: () => `
    ${note('摆臂电机', 'b', `<p>把单元摆动的思路照搬：发动机和 CVT 的位置换成电机和齿轮。Honda 的专利里，摆臂内装三相电机，经电机轴 → 中间轴 → 后轴两级减速，电池在座垫下、电力控制单元（PCU）在后轮前方${P('WO2020161980A1')}；也有把电机放在悬臂摆臂后端、电池和控制器都塞进中空摆臂的${P('US8893833B2')}；还有在摆臂里串一个离心离合器、电机先空转到转速再咬合，方便坡道起步、推车时不拖电机的${P('US8776936B2')}。</p>`)}
    ${note('轮毂电机', 'b', `<p>电机的“外转子”（贴着磁铁的圈）直接用螺栓固定在轮盘上，定子装在不转的轴上，这就是直接驱动的轮毂电机${P('JPH0746620Y2')}。没有齿轮、没有链条，最简单；代价是后轮又重又大（簧下质量大），电机转得慢，要靠很多磁极和很大的扭矩。也有在轮毂电机里塞两速行星齿轮的设计${P('US6590306B2')}。</p>`)}
    ${note('可以换的电池', 'b', `<p>两块竖着放的电池并排在座垫下，中间一根操作杆：往上拉，底部的端子分开，拎走充电；往下压，端子接合并压住电池${P('US11400994B2')}。Gogoro 的做法是车上电池仓靠近换电柜时自动解锁${P('US9424697B2')}，换电柜放在便利店、加油站，手机能看哪里有满电电池${P('US8878487B2')}。</p>`)}
    ${note('这个实验依赖的假设', 'c', `<p>摆臂电机：峰值 26 N·m、6 kW、最高 11000 rpm，减速比 ${f2(S.G.emI || 11.4)}；轮毂电机：峰值 150 N·m、4 kW、最高 830 rpm。汽油车是第 7 章的模型。续航只算平路 40 km/h 匀速、电池全部可用、驱动效率 0.85。都是教学值，不对应任何车型。</p>`)}
    ${note('什么时候会不一样', 'd', `<p>冬天电池容量会掉、开空调（踏板车没有）、频繁加速、上坡，续航都会明显缩短；电机连续大扭矩会发热，控制器会限流。</p>`)}`,
  enter(A) {
    const st = A.stage;
    let model = 'EM';
    const opts = { EM: { mode: 'ev', evT: 26, evP: 6, evMax: 11000, evI: S.G.emI }, EH: { mode: 'ev', evT: 150, evP: 4, evMax: 830, evI: 1 } };
    let a = new S.Ride(opts[model]), b = new S.Ride({});
    const restart = () => { a = new S.Ride(opts[model]); b = new S.Ride({}); };
    const setModel = (m) => {
      model = m;
      st.applyView({ model: m, view: 'home' });
      A.title(m);
      A.setPins(A.pins(m));
      st.setFlows([{ model: m, key: 'pw', color: '#4fd18b', speed: 140, spacing: 9, size: 4 }]);
      $('cut11').setAttribute('aria-pressed', 'false');
      A.toolbar();
      restart(); drawF();
    };
    segBind('s11', setModel);
    $('cut11').onclick = () => {
      const on = !st.cutOn;
      st.applyView({ model, view: on ? 'cut' : 'home', cut: on ? 'mid' : null, hide: on && model === 'EH' ? ['EH_CapL'] : [] });
      $('cut11').setAttribute('aria-pressed', on); A.toolbar();
    };
    $('go11').onclick = restart;
    A.setPins(A.pins('EM'));
    st.setFlows([{ model: 'EM', key: 'pw', color: '#4fd18b', speed: 140, spacing: 9, size: 4 }]);
    const pa = new Plot($('p11a'), { l: 40, b: 22 }), pb = new Plot($('p11b'), { l: 44, b: 22 });
    // 汽油车的驱动力 – 车速：跑一遍模型，用加速度反推
    const ice = S.launch({}, 1, 30, 0.05).tr;
    const iceF = [];
    for (let i = 1; i < ice.length; i++) {
      const v0 = ice[i - 1][1] / 3.6, v1 = ice[i][1] / 3.6, dt = ice[i][0] - ice[i - 1][0];
      const M = 195, Fres = M * 9.81 * .015 + .5 * 1.2 * .56 * v1 * v1;
      iceF.push([ice[i][1], M * (v1 - v0) / dt + Fres]);
    }
    const drawF = () => {
      const o = opts[model];
      const ev = S.evCurve(o.evI, o.evT, o.evP, o.evMax);
      pb.clear().scale(0, 110, 0, 1800).axes({ xt: niceTicks(0, 110, 5), yt: [0, 600, 1200, 1800], xl: 'km/h', yl: 'N' });
      pb.line(Array.from({ length: 111 }, (_, i) => i), ev, C.ok, 2);
      pb.line(iceF.map((p) => p[0]), iceF.map((p) => Math.max(0, p[1])), C.pd, 1.6);
    };
    drawF();
    const rangeKm = () => {
      const kwh = +$('b11').value, v = 40 / 3.6;
      const P = (195 * 9.81 * .015 * v + .5 * 1.2 * .56 * v ** 3) / .85;
      const whkm = P / v * 1000 / 3600;
      setText('k11c', `${f0(kwh * 1000 / whkm)}<small>km</small>`);
      setText('k11d', `${f0(whkm)}<small>Wh</small>`);
    };
    range('b11', (v) => `${v.toFixed(1)} kWh`, rangeKm).upd();
    let acc = 0, rec = 0;
    A.setSlow('转动慢放 1/40');
    return {
      tick(dt) {
        if (!st.paused && a.t < 12) {
          a.step(dt, 1); b.step(dt, 1);
          rec += dt; if (rec > .05) { rec = 0; a.record(); b.record(); }
        }
        const sp = st.paused ? 0 : st.speed;
        const wW = a.v / S.G.wheelR;
        if (model === 'EM') { st.EM.phi += wW * opts.EM.evI * SLOW * dt * sp; st.EM.amp = a.v < 25 && a.t < 12 ? .9 : .4; st.EM.phase = Math.PI / 2; }
        else { st.EH.phi += wW * SLOW * 4 * dt * sp; st.EH.amp = a.t < 12 ? .9 : .4; st.EH.phase = Math.PI / 2; }
        const f = st.flow('pw'); if (f) { f.target = a.t < 12 ? 1 : .3; f.rate = st.paused ? 0 : (a.t < 12 ? 1.4 : .5); }
        acc += dt;
        if (acc > .1) {
          acc = 0;
          pa.clear().scale(0, 12, 0, 100).axes({ xt: [0, 3, 6, 9, 12], yt: [0, 25, 50, 75, 100], xl: 's', yl: 'km/h' });
          if (b.trace.length > 1) pa.line(b.trace.map((p) => p[0]), b.trace.map((p) => p[1]), C.pd, 1.8);
          if (a.trace.length > 1) pa.line(a.trace.map((p) => p[0]), a.trace.map((p) => p[1]), C.ok, 2);
          const t30 = (tr) => { const p = tr.find((q) => q[1] >= 30); return p ? `${f2(p[0])}<small>s</small>` : '–'; };
          setText('k11a', t30(a.trace)); setText('k11b', t30(b.trace));
        }
      },
      leave() { st.EH.amp = 0; st.EM.amp = 0; },
    };
  },
};

// ================================================================ 12 怎么选
const ch12 = {
  id: 'choose', nav: '怎么选', title: '六种动力放在一起比',
  view: { model: 'all' },
  lead: '最后把六种做法放在一张表里，再列一份“开起来不对劲时先怀疑哪里”的速查，以及本页用到的全部来源。今天在路上跑的 125 cc 踏板车，<b>四冲程 + 离心滚子 CVT + 离心离合器 + 单元摆动</b>是最主流的组合；其他几种都是在它的某一环上换了做法。',
  body: () => `
    <div class="family">
      ${[['四冲程 + 离心 CVT', '最主流', '—（基准）', '离合器打滑起步', '离心力自己定', '便宜、成熟', '皮带、滚子、离合块要定期换'],
        ['二冲程', '', '发动机', '离合器打滑起步', '离心力自己定', '轻、同排量劲大', '排放、烧机油'],
        ['电控 CVT', '', '谁来推主动轮动盘', '离合器打滑起步', '电脑定（可选模式 / 手动）', '同一油门转速可高可低', '贵、多一套执行器和传感器'],
        ['轻混', '', '曲轴上多一台电机', '打滑 + 电机推一把', '离心力自己定', '起步更顺', '贵、多一块电池'],
        ['摆臂电机', '', '发动机 + CVT → 电机 + 齿轮', '电机 0 转就有劲', '固定', '安静、零排放', '续航、充电时间'],
        ['轮毂电机', '', '全换成轮毂里的电机', '电机 0 转就有劲', '1:1 直驱', '结构最简单', '簧下重、电机要很大扭矩']]
        .map(([t, tag, a, b, c, d, e]) => `<div class="card${tag ? '' : ' quiet'}"><h4>${t}${tag ? `<span>${tag}</span>` : ''}</h4><p>换了哪一环：${a}<br>起步：${b}<br>速比：${c}<br>好处：${d}<br>代价：${e}</p></div>`).join('')}
    </div>
    <p class="seglab">开起来不对劲，先怀疑哪里</p>
    <div class="tw"><table class="cmp">
      <tr><th>现象</th><th>先怀疑</th><th>道理在哪一章</th></tr>
      <tr><td>起步抖、咯噔咯噔</td><td>离合块摩擦片、外鼓（有油、磨出台阶）</td><td>06</td></tr>
      <tr><td>转速很高、车速上不去</td><td>皮带打滑或磨窄、离合器打滑</td><td>05 · 07</td></tr>
      <tr><td>最高速比以前低</td><td>皮带磨窄（到不了最高档）</td><td>05</td></tr>
      <tr><td>起步发闷、上坡没劲</td><td>滚子太重、离合弹簧太软</td><td>06 · 07</td></tr>
      <tr><td>升档发涩、转速忽高忽低</td><td>滚子磨出平面、动盘轴套缺油</td><td>05</td></tr>
      <tr><td>红灯不熄火了</td><td>没热车、电池电量低（怠速停止的保护条件）</td><td>08</td></tr>
    </table></div>
    <p class="seglab">证据强弱怎么标</p>
    <p class="pt">${ev('a')} 教科书级的原理　${ev('b')} 来自下面列的专利或厂家资料　${ev('c')} 这一页为了能算而做的简化　${ev('d')} 我自己的推测，没找到直接来源</p>`,
  notes: () => `
    ${note('全部来源', '', `<ol class="sources srcs">${SOURCES.map(([code, t, u], i) => `<li id="src-${i + 1}"><code>${code}</code> ${t}　<a href="${u}" target="_blank" rel="noopener">链接</a></li>`).join('')}</ol>`)}
    ${note('模型和数字', 'c', `<p>四台三维模型都是 Blender 脚本建的教学模型，结构参照上面的专利，尺寸是 125 cc / 50 cc 级别的量级，<b>不对应任何厂家的任何车型</b>。实验里的发动机扭矩、滚子推力、弹簧、离合器、电机参数都是我设的教学值，适合看“改了什么、往哪边变”，不适合当某台车的数据。</p>`)}`,
  enter(A) {
    A.setPins([
      { t: '四冲程 + CVT', p: [0, 0, 300], model: 'U4', onClick: () => A.go('unit') },
      { t: '二冲程', p: [820, 0, 200], model: 'T2', onClick: () => A.go('two') },
      { t: '轮毂电机', p: [-1250, 0, 380], model: 'EH', onClick: () => A.go('ev') },
      { t: '摆臂电机', p: [-2150, 0, 470], model: 'EM', onClick: () => A.go('ev') },
    ]);
    return {
      tick(dt) {
        const st = A.stage;
        spinU4(A, dt, { n: 2400, x: .2 });
        st.U4.gas = gas4(st.U4.th * 180 / Math.PI);
        st.T2.th += 1200 * S.RPM * SLOW * dt;
      },
    };
  },
};

export const CHAPTERS = [ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8, ch9, ch10, ch11, ch12];
