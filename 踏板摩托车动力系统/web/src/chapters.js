// 十五章：总览 → 单元摆动 → 四冲程 → 油门 → 二冲程 → CVT → 离心离合器 → 开起来 → 转速和功率 → 热值和油耗 → 起动和怠速停止 → 电控 CVT → 混动 → 电动 → 怎么选。
// 章号不要写死在文案里：用 CH('章的 id')，插入新章后会自己变。
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
  ['Honda R&D 2003', 'Honda R&D Technical Review：Development of an ECU Integrated Throttle Body System Module for a Compact Fuel Injection System Used in Small Motorcycles and Scooters（节气门体 + 电脑 + 传感器 + 怠速空气控制做成一个模块）', 'https://global.honda/en/technical-review/PDF/015-1/015-1_83e.pdf'],
  ['Honda 维修手册 PGM-FI', 'Honda 110 cc 踏板车维修手册的 PGM-FI 系统图：喷油嘴、节气门体、ECM、油泵、传感器单元（MAP / TP / IAT）、CKP、ECT、O₂ 传感器、IACV', 'https://www.bike-parts-honda.be/thumbs/pdf_url/img/sav/SAV_NHX110WH8_9_A/2500_2500/0039.pdf'],
  ['US7273034', 'Keihin：Throttle control apparatus（摩托车节气门体：节气门轴、油门拉线杠杆、开度传感器的布置）', 'https://patents.google.com/patent/US7273034'],
  ['US7117846', 'Keihin：Throttle control apparatus（节气门体上绕过节气门的旁通空气通道和空气阀）', 'https://patents.google.com/patent/US7117846'],
  ['US7814885', 'Fast idle air amount control system in side stand-equipped two-wheeled motor vehicle（接在节气门体上的旁通控制阀，控制快怠速空气量）', 'https://patents.google.com/patent/US7814885'],
  ['Honda TBW', 'Honda CB1000R FACT BOOK：スロットルバイワイヤシステム（把手开度传感器 → ECU → 电机开节气门）', 'https://www.honda.co.jp/factbook/motor/CB1000R/201803/P19.pdf'],
  ['AFDC 燃料性质', '美国能源部 Alternative Fuels Data Center：Fuel Properties Comparison（汽油低热值 112,114 ～ 116,090 Btu/gal）', 'https://afdc.energy.gov/fuels/properties'],
  ['EPA CO₂', 'US EPA：Greenhouse Gas Emissions from a Typical Passenger Vehicle（每加仑汽油烧出约 8,887 g CO₂）', 'https://www.epa.gov/greenvehicles/greenhouse-gas-emissions-typical-passenger-vehicle'],
  ['Honda PCX 诸元', 'Honda PCX 主要诸元（124 cm³：9.2 kW / 8,750 rpm，12 N·m / 6,500 rpm，60 km/h 定地燃費 55.0 km/L〈2名乗車時〉，WMTC 47.7 km/L）', 'https://www.honda.co.jp/PCX/spec/'],
];
const srcIdx = (code) => SOURCES.findIndex((s) => s[0] === code) + 1;
const P = (...codes) => codes.map((c) => { const k = srcIdx(c); if (!k) throw new Error(`来源表里没有 ${c}`); return pat(k); }).join('');

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
    ${note('什么时候会不一样', 'd', `<p>上坡、逆风、两个人骑，需要的功率会明显变大；风阻和车速的三次方成正比，所以 90 km/h 以上，多一点车速就要多很多功率。实际最高速还受发动机限转和 CVT 最高档速比的限制（${CH('ride')}）。</p>`)}`,
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
    ${note('图怎么看', 'c', `<p>横轴是“变速进度”：0 = 最低档（速比 ${f2(S.G.iMax || 2.59)}），1 = 最高档（${f2(S.G.iMin || 0.8)}）。车速定了，速比定了，发动机转速也就定了（离合器已经咬住）：越往高档，发动机转得越慢。橙线是那个转速下滚子能给的推力，青线是从动轮那边要的力，<b>两线相交</b>的地方就是皮带停住的位置。满油门从 30 拖到 90 km/h：交点一路往右移，车速涨了三倍，发动机转速只涨了两三成 —— ${CH('ride')}那条“差不多水平”的线就是这么来的。</p>`)}
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
      if (n < S.CLUTCH.nEng + 100) msg = '车速太低：发动机转速还没到离合器咬合的转速，实际是<b>离合器打滑起步</b>那一段（' + CH('clutch') + '），皮带停在最低档。';
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
    ${note('这个实验依赖的假设', 'c', `<p>离合块的离心力和从动轮转速的平方成正比，减去弹簧力后乘摩擦系数和外鼓半径就是能传的扭矩：<b>T = K·(ω² − ω₀²)</b>，ω₀ 由“咬合转速”决定（按最低档换算成发动机转速）。起步实验用了${CH('ride')}的整车模型：锁住时算需要多大扭矩才能保持锁住，超过能力就打滑；打滑时两边按摩擦扭矩各自加速。</p>`)}
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
    ${note('上坡为什么会自己降档', 'c', `<p>选“定速 50 km/h”，再把坡度拉上去：要保持车速就得把油门开大，发动机扭矩变大，从动轮上的扭矩跟着变大，扭力凸轮把动盘夹得更紧 → ${CH('cvt')}的青线变高 → 平衡点往低档移。结果是同样 50 km/h，上坡时<b>速比更低、转速更高</b>，跟人手动降档一样，不用任何电子控制。</p>`)}
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
    ${note('这个实验依赖的假设', 'cd', `<p>怠速油耗用 ${CH('energy')} 的发动机模型算：怠速 1700 rpm、曲轴不出力时每秒约 ${S.idleFuel().toFixed(3)} g（约 ${(S.idleFuel() / S.FUEL.rho * 3.6).toFixed(2)} L/h）。每次重新起动多烧 0.25 g、等待不到 3 秒不熄火，是我设的量级，没有找到可以直接引用的实测值。实际省多少取决于路况和停车时长。</p>`)}`,
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
    ${note('这个实验依赖的假设', 'c', `<p>目标转速：D = 3000 + 3800 × 油门，S = 5200 + 2600 × 油门（rpm）；手动 6 档按固定变速进度。动盘最快每秒走完全程的 1.6 倍。其余（发动机、离合器、整车）和${CH('ride')}同一个模型。</p>`)}`,
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
    ${note('这个实验依赖的假设', 'c', `<p>摆臂电机：峰值 26 N·m、6 kW、最高 11000 rpm，减速比 ${f2(S.G.emI || 11.4)}；轮毂电机：峰值 150 N·m、4 kW、最高 830 rpm。汽油车是${CH('ride')}的模型。续航只算平路 40 km/h 匀速、电池全部可用、驱动效率 0.85。都是教学值，不对应任何车型。</p>`)}
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
      <tr><td>起步抖、咯噔咯噔</td><td>离合块摩擦片、外鼓（有油、磨出台阶）</td><td>${NO('clutch')}</td></tr>
      <tr><td>转速很高、车速上不去</td><td>皮带打滑或磨窄、离合器打滑</td><td>${NO('cvt')} · ${NO('ride')}</td></tr>
      <tr><td>最高速比以前低</td><td>皮带磨窄（到不了最高档）</td><td>${NO('cvt')}</td></tr>
      <tr><td>起步发闷、上坡没劲</td><td>滚子太重、离合弹簧太软</td><td>${NO('clutch')} · ${NO('ride')}</td></tr>
      <tr><td>升档发涩、转速忽高忽低</td><td>滚子磨出平面、动盘轴套缺油</td><td>${NO('cvt')}</td></tr>
      <tr><td>红灯不熄火了</td><td>没热车、电池电量低（怠速停止的保护条件）</td><td>${NO('start')}</td></tr>
      <tr><td>松手后怠速偏高、怠速不稳</td><td>油门拉线发涩、节气门和旁通孔积碳</td><td>${NO('throttle')}</td></tr>
      <tr><td>油耗突然变高</td><td>轮胎气压低、皮带打滑、空滤堵、氧传感器</td><td>${NO('throttle')} · ${NO('energy')}</td></tr>
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

// ================================================================ 新加三章共用：先猜再看的小题、分步算式
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
const f3 = (x) => x.toFixed(3);
const NO = (id) => String(CHAPTERS.findIndex((c) => c.id === id) + 1).padStart(2, '0');

// ================================================================ 04 油门
const GASC = { intake: '#4cc9f0', compress: '#8a7bff', power: '#ffb03c', exhaust: '#8d8f96' };
function thrSvg() {
  const dots = Array.from({ length: 16 }, (_, i) => `<circle class="air" r="1.9" data-i="${i}"/>`).join('');
  return `
<svg class="dia thr" id="t4svg" viewBox="0 0 372 256" role="img" aria-label="油门示意图：把手、拉线、节气门、喷油嘴和气缸">
  <defs><marker id="t4ar" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6z" fill="#93a4bb"/></marker></defs>
  <g data-s="1" id="t4grip">
    <rect x="6" y="14" width="64" height="20" rx="9" class="k"/>
    <circle cx="82" cy="24" r="11" class="k"/>
    <line id="t4gl" x1="82" y1="24" x2="82" y2="13" class="ptr"/>
    <text x="8" y="48" class="lbl">油门把手</text>
    <text x="8" y="60" class="val" id="t4gv"></text>
  </g>
  <g id="t4engine">
    <g data-s="1"><path id="t4cable" class="cable" d=""/><text x="122" y="20" class="lbl" id="t4cl">钢丝拉线</text></g>
    <g data-s="2 3 4 5">
      <rect x="6" y="92" width="40" height="36" rx="3" class="k"/><text x="13" y="114" class="lbl">空滤</text>
      <path class="wall" d="M46 96H276V124 M46 124H252 M274 124H286 M284 124V96H354 M308 124H354 M250 124V206 M310 124V206"/>
      <text x="318" y="114" class="lbl">排气 →</text>
    </g>
    <g data-s="2 3 5">${dots}</g>
    <g data-s="1 2 5"><g id="t4rot"><line x1="128" y1="96" x2="128" y2="124" class="plate"/><line x1="128" y1="110" x2="152.5" y2="86.4" class="lever"/></g>
      <circle cx="128" cy="110" r="2.6" class="shaft"/></g>
    <g id="t4efi">
      <g data-s="1 2 5"><text x="58" y="89" class="lbl">节气门</text></g>
      <g data-s="5" id="t4iacv"><path class="byp" d="M114 124V152H142V124"/><circle cx="128" cy="152" r="5" class="k"/><text x="150" y="156" class="lbl">怠速旁通阀</text></g>
      <g data-s="3"><rect x="121" y="126" width="14" height="9" rx="2" class="sen"/><text x="109" y="135" class="lbl" text-anchor="end">开度 TP</text>
        <rect x="172" y="85" width="16" height="11" rx="2" class="sen"/><text x="158" y="80" class="lbl">压力 MAP</text>
        <rect x="322" y="85" width="16" height="11" rx="2" class="sen"/><text x="316" y="80" class="lbl">氧 O₂</text></g>
      <g data-s="3 5"><g transform="translate(232 97) rotate(-24)"><rect x="-4.5" y="-27" width="9" height="25" rx="2" class="inj"/></g>
        <path id="t4spray" class="fuel" d="M232 98L246 123H264Z"/><text x="226" y="62" class="lbl">喷油嘴</text></g>
      <g data-s="3 5"><rect x="6" y="172" width="196" height="78" rx="4" class="k"/>
        <text x="14" y="188" class="hd">电脑 ECU</text>
        <text x="14" y="204" class="lbl" id="t4e1"></text><text x="14" y="220" class="lbl" id="t4e2"></text><text x="14" y="236" class="val" id="t4e3"></text></g>
    </g>
    <g id="t4carb" hidden>
      <g data-s="2 3"><rect x="74" y="68" width="28" height="26" rx="3" class="k"/><text x="20" y="84" class="lbl">真空膜片</text>
        <rect id="t4slide" x="80" y="96" width="16" height="20" class="slide"/><line id="t4needle" x1="88" y1="116" x2="88" y2="138" class="needle"/>
        <path class="wall" d="M84 124V140 M92 124V140"/>
        <rect x="64" y="134" width="48" height="28" rx="3" class="k"/><rect x="65" y="146" width="46" height="15" class="fuel" opacity=".55"/>
        <text x="116" y="160" class="lbl">浮子室</text><text x="136" y="140" class="lbl">节气门</text></g>
      <g data-s="3 5"><rect x="6" y="172" width="196" height="78" rx="4" class="k"/>
        <text x="14" y="188" class="hd">化油器：没有电脑</text>
        <text x="14" y="204" class="lbl">气流越快，喉管处气压越低，</text><text x="14" y="220" class="lbl">油就被“吸”上来得越多</text><text x="14" y="236" class="val" id="t4c3"></text></g>
    </g>
    <g data-s="4">
      <rect id="t4gas" x="251" y="125" width="58" height="12"/>
      <line id="t4vi" x1="252" y1="124" x2="274" y2="124" class="valve"/><line id="t4vis" x1="263" y1="124" x2="263" y2="102" class="stem"/>
      <line id="t4ve" x1="286" y1="124" x2="308" y2="124" class="valve"/><line id="t4ves" x1="297" y1="124" x2="297" y2="102" class="stem"/>
      <circle id="t4spark" cx="280" cy="129" r="4" fill="#fff" opacity="0"/>
      <rect id="t4piston" x="251" y="138" width="58" height="14" rx="2" class="pist"/>
      <line id="t4rod" x1="280" y1="148" x2="280" y2="206" class="rod"/>
      <circle cx="280" cy="228" r="22" class="crank"/><circle id="t4pin" cx="280" cy="206" r="3.2" class="shaft"/>
      <text x="318" y="150" class="lbl" id="t4st"></text><text x="318" y="164" class="val" id="t4tq"></text>
    </g>
  </g>
  <g id="t4ev" hidden>
    <path class="ln" d="M94 24H102" marker-end="url(#t4ar)"/>
    <rect x="104" y="10" width="78" height="28" rx="4" class="k"/><text x="110" y="22" class="lbl">霍尔传感器</text><text x="110" y="34" class="val" id="t4v1"></text>
    <path class="ln" d="M182 24H210" marker-end="url(#t4ar)"/>
    <rect x="212" y="6" width="124" height="38" rx="4" class="k"/><text x="220" y="21" class="hd">控制器</text><text x="220" y="36" class="val" id="t4v2"></text>
    <rect x="104" y="62" width="78" height="26" rx="4" class="k"/><text x="110" y="79" class="lbl">电池（直流）</text>
    <path class="ln" d="M182 75C205 75 220 62 228 46" marker-end="url(#t4ar)"/>
    <path id="t4ph" class="ph" d="M258 44V106 M274 44V104 M290 44V106"/>
    <text x="298" y="78" class="lbl">三相电流</text>
    <circle cx="274" cy="152" r="46" class="k"/><circle cx="274" cy="152" r="30" class="crank"/>
    <line id="t4rotor" x1="274" y1="152" x2="274" y2="124" class="ptr"/>
    <text x="252" y="220" class="lbl">电机 → 后轮</text><text x="252" y="234" class="val" id="t4v3"></text>
    <rect x="6" y="112" width="196" height="96" rx="4" class="k"/>
    <text x="14" y="130" class="hd">电动车：没有节气门</text>
    <text x="14" y="148" class="lbl">把手里是一块磁铁 + 霍尔传感器，</text><text x="14" y="164" class="lbl">拧多少 → 电压多高；控制器按电压</text>
    <text x="14" y="180" class="lbl">决定给电机多大电流。电流和扭矩</text><text x="14" y="196" class="lbl">成正比，0 转就有劲。</text>
  </g>
</svg>`;
}

const ch4thr = {
  id: 'throttle', nav: '油门', title: '油门：拧的不是速度，是进气量',
  view: { model: 'U4', view: 'thr', hide: ['U4_Frame'] },
  lead: '很多人以为油门是“速度旋钮”，拧一半就是一半速度。其实它更像<b>水龙头</b>：拧的是<b>放多少空气进发动机</b>。空气多了，电脑跟着多喷油，每一次燃烧推活塞的劲（<b>扭矩</b>）就大。至于车最后跑多快，要看这股劲和阻力谁大。这一章分五步把这条链讲完，再用一个实验看“同一个油门最后会稳在什么车速”。',
  body: () => `
    ${quiz('q4', '在平路上把油门固定在一半不动，一直骑，会怎样？', ['车速一直涨，直到这台车的极速', '车速涨到某个值就不再涨了', '发动机转速固定在最高转速的一半', '每秒喷的油始终不变，和车速无关'])}
    <p class="seglab">三种“油门”：点一下换示意图</p>
    ${seg('kind4', [['efi', '电喷', '现在最主流'], ['carb', '化油器', '老车、二冲程'], ['ev', '电动', '没有节气门']], 'efi')}
    ${thrSvg()}
    ${ctl('h4', '油门把手', 0, 100, 1, 35)}
    ${ctl('r4', '发动机转速', 1700, 9500, 100, 5000)}
    <div class="phases p5" id="ph4">${[['1', '把手和拉线', '第 1 步'], ['2', '节气门', '第 2 步'], ['3', '电脑配油', '第 3 步'], ['4', '烧出扭矩', '第 4 步'], ['5', '松油门', '第 5 步']]
      .map(([v, t, s]) => `<button class="btn" type="button" data-v="${v}" aria-pressed="false"><small>${s}</small>${t}</button>`).join('')}</div>
    <div class="stepnote" id="sn4"></div>
    <div id="kg4">${kpis([['k4a', '节气门转开'], ['k4b', '进气管压力'], ['k4c', '每次吸入空气'], ['k4d', '每次喷油'], ['k4e', '喷油嘴通电'], ['k4f', '曲轴扭矩']])}</div>
    <div id="ke4" hidden>${kpis([['k4v', '把手输出电压'], ['k4i', '电流指令'], ['k4t', '电机扭矩'], ['k4w', '后轮推力']])}</div>
    <p class="seglab">实验：同一个油门，最后跑多快？（把手用上面那个滑块）</p>
    ${ctl('g4', '坡度', 0, 15, 1, 0)}
    ${plot('p4', 190, `<span>${sw(C.pd)}后轮推力（这个油门下）</span><span>${sw(C.accent)}阻力（风 + 滚动 + 坡）</span><span>${sw(C.mute)}满油门</span>`)}
    ${kpis([['k4g', '最后稳在'], ['k4h', '那时发动机'], ['k4j', '那时油耗']])}`,
  notes: () => `
    ${note('一句话记住', 'a', `<p><b>油门 → 空气 → 油 → 扭矩</b>；扭矩比阻力大就加速，一样大就匀速。油门不直接决定车速，也不直接决定转速：车速是“推力 = 阻力”的那个平衡点；转速由 CVT 两边的力平衡决定（${CH('cvt')}），所以拧油门后转速很快到位、之后车速在涨而转速几乎不动（${CH('ride')}）。</p>`)}
    ${note('为什么汽油机要用一片圆盘“憋气”', 'a', `<p>汽油和空气要按大约 <b>14.7 : 1</b>（质量）混合才能点得着、烧得干净，排气管里的催化器也只在这个比例附近才管用。所以想让发动机少出力，不能只少喷油（混合气太稀会点不着），只能<b>油和空气一起减</b>。减空气的办法就是在进气管里放一片能转的圆盘把路堵小。</p>
      <p>代价：圆盘半关时，活塞吸气像隔着吸管吸，要额外费劲，这部分叫<b>泵气损失</b>。这是汽油机小油门时费油的主要原因之一（${CH('energy')} 的能量条里能看到这一块）。柴油机没有这片圆盘，只调喷油量。</p>`)}
    ${note('电脑怎么知道该喷多少', 'ab', `<p>小排量踏板车的电喷系统通常由这些东西组成：喷油嘴、节气门体、电脑（ECM）、油泵、装在节气门体上的<b>传感器单元</b>（进气管压力 MAP、节气门开度 TP、进气温度 IAT 三合一）、曲轴位置传感器、温度传感器、氧传感器和怠速空气阀 IACV${P('Honda 维修手册 PGM-FI')}。Honda 还把电脑直接和节气门体做成一个模块，省掉线束，让小车也用得起电喷${P('Honda R&D 2003')}。</p>
      <p>算法的骨架是：<b>压力 × 转速 → 这一次吸了多少空气 → ÷ 14.7 → 喷多少油 → 喷油嘴通电几毫秒</b>。TP 用来判断“驾驶人刚刚猛拧了一下”（先多喷一点，免得顿一下），大油门时进气管压力几乎不再变，很多小车这时改按“开度 × 转速”查表；氧传感器看废气里还剩不剩氧，告诉电脑上一次是喷多了还是喷少了。</p>`)}
    ${note('把手、拉线和怠速', 'b', `<p>节气门轴一头伸出壳体，装着拉线拽的杠杆；开度传感器也是套在这根轴上测转角的${P('US7273034')}。把手完全松开时圆盘关死，怠速需要的那一点点空气从绕过圆盘的<b>旁通通道</b>走，由一个小阀门调节${P('US7117846', 'US7814885')}；冷车时电脑让它开大一些，怠速就高一点。</p>`)}
    ${note('几种做法怎么选', 'ab', `<ul>
      <li><b>电喷 + 拉线</b>（最主流）：把手到圆盘是纯机械的，电脑只管配油和点火。便宜、可靠；省油和排放比化油器好得多。</li>
      <li><b>化油器</b>：没有电脑，靠气流自己把油吸上来。结构简单、坏了好修；但冷车、高海拔、急加速时配比不准，过不了现在的排放标准。</li>
      <li><b>电子油门</b>（TBW）：把手只接一个传感器，圆盘由电机开，电脑可以“改写”你的油门，比如做骑行模式、牵引力控制、定速巡航${P('Honda TBW')}。贵，多见于大排量车。</li>
      <li><b>电动车</b>：根本没有空气这一环。把手输出一个电压，控制器按它给电机电流，电流直接对应扭矩（${CH('ev')}）。</li></ul>`)}
    ${note('这一章依赖的假设', 'c', `<p>示意图是原理图，不是哪台车的剖面。数字来自本页的教学发动机：扭矩按“油门开度 × 转速”的经验曲线给，再反推要吸多少空气、喷多少油（空燃比 14.7，大油门加浓到约 13.2；喷油嘴按每毫秒 1.6 mg）。进气管压力是由扭矩反推的，不是按圆盘开口面积算的流量。第二个实验里，低速那一段离合器在打滑，按发动机停在 4200 rpm 左右近似。电动车把手电压按 0.8 ～ 4.2 V、电流和扭矩按比例给，是常见量级，没有对应具体产品。</p>`)}
    ${note('什么时候会出毛病', 'd', `<p>拉线生锈发涩：松手后油门回不干净，怠速偏高。圆盘和旁通孔积碳：怠速不稳、容易熄火。开度传感器坏：加速发闷。空滤堵：相当于圆盘前面又多了一道门，满油门也吸不够气，极速下降。</p>`)}`,
  enter(A) {
    const st = A.stage, U = st.U4, R = S.G.wheelR;
    A.setPins(A.pins('U4', 'pins', ['节气门体', '空滤箱', '气缸', '排气管', '火花塞']));
    quizBind('q4', 1, '油门固定，后轮上的<b>推力</b>就大致固定在一条曲线上；车越快风阻越大，等阻力涨到和推力一样大，车速就停在那里。下面第二个实验画的就是这两条线。转速由 CVT 决定，不是油门的一半；每秒喷的油还和转速有关。');
    st.setFlows([
      { model: 'U4', key: 'intake', color: '#4cc9f0', speed: 260, spacing: 9 },
      { model: 'U4', key: 'exhaust', color: '#b9a99a', speed: 300, spacing: 9 },
    ]);
    let kind = 'efi', q = 0.35, n = 5000, slope = 0, step = 0, e = null, Te = 0, rot = 0;
    const svg = $('t4svg'), el = (id) => svg.querySelector(`#${id}`);
    const airs = [...svg.querySelectorAll('.air')].map((c, i) => ({ c, u: i / 16, off: ((i * 5) % 9 - 4) * 2.2, fr: ((i * 7) % 16) / 16 }));
    const NOTE = [
      '拖“油门把手”，从左往右看一遍：把手 → 拉线 → 节气门 → 空气 → 电脑配油 → 气缸。再按下面五个按钮，一步一步看。',
      '<b>第 1 步 · 把手和拉线</b>：把手里卷着一根钢丝。往自己这边拧，钢丝被拉紧，另一头拽着节气门轴上的小杠杆转；松手，弹簧把它拉回去。<b>全程是机械的</b>，拧到底大约四分之一圈。',
      '<b>第 2 步 · 节气门</b>：进气管里有一片能转的<b>圆盘</b>，像烟囱里的风门。关着时几乎堵死，转开后空气才进得来。圆盘后面的气压比外面低：开得越小、发动机抽得越快，就越低（看“进气管压力”）。',
      '<b>第 3 步 · 电脑配油</b>：汽油和空气要按大约 <b>14.7 : 1</b> 配。电脑读<b>进气管压力</b>和<b>转速</b>，算出这一次吸了多少空气，除以 14.7 就是该喷多少油，再换成喷油嘴通电几毫秒。排气管上的<b>氧传感器</b>告诉它上一次喷得准不准。',
      '<b>第 4 步 · 烧出扭矩</b>：吸进去的混合气越多，点火后推活塞的劲越大，曲轴上的<b>扭矩</b>就越大。所以油门管的是“每一下推多大劲”，不是“转多快”。把转速滑块来回拖：同一个把手位置，扭矩也会变。',
      '<b>第 5 步 · 松油门</b>：把手拉到 0。停车时发动机还得自己转着（怠速），空气从圆盘旁边的<b>旁通阀</b>进。行驶中松油门、转速还高时，电脑干脆<b>一滴油都不喷</b>，车拖着发动机转，这就是松油门时那股“拖拽感”。把转速拖到 1700 和 5000 各看一次。',
    ];
    const NOTE_CARB = '<b>化油器</b>：把手和圆盘还是那一套，但没有电脑和喷油嘴。空气流过一段收窄的<b>喉管</b>时变快、气压变低，把浮子室里的油从油针旁边吸上来；气流越大，滑块升得越高、油针让出的缝越大。配比靠油针形状和量孔“调”出来。';
    const NOTE_EV = '<b>电动车</b>：没有空气、没有节气门。把手里是一块磁铁和一个霍尔传感器，拧多少就输出多高的电压；控制器按这个电压决定给电机多大电流，电流和扭矩成正比。所以电动车的油门更接近“扭矩旋钮”，而且 0 转就有劲。';
    const pl = new Plot($('p4'), { l: 40, b: 24 });
    const driveF = (v, qq) => {
      if (kind === 'ev') {
        const wm = v / 3.6 / R * S.G.emI;
        let T = qq * Math.min(26, 6000 / Math.max(wm, 1));
        if (wm > 11000 * S.RPM) T = 0;
        return T * S.G.emI * .95 / R;
      }
      const s = S.steadyAt(Math.max(v, 3), qq);
      if (s.n > S.ENG.limit) return 0;
      if (qq < 0.04 && s.n < S.CLUTCH.nEng) return 0;          // 低速松油门：离合器分开，发动机拖不到车
      return S.engTorque(Math.max(s.n, 4200), qq) * s.i * S.CVT.etaB * S.G.iF * S.CVT.etaG / R;
    };
    const drawPlot = () => {
      const xs = [], fa = [], fw = [], rr = [];
      for (let v = 2; v <= 110; v += 2) { xs.push(v); fa.push(driveF(v, q)); fw.push(driveF(v, 1)); rr.push(S.roadLoad(v, slope / 100).F); }
      pl.clear().scale(0, 110, -150, kind === 'ev' ? 1400 : 800).axes({ xt: niceTicks(0, 110, 5), yt: kind === 'ev' ? [0, 400, 800, 1200] : [0, 200, 400, 600, 800], xl: 'km/h', yl: 'N', zero: true });
      pl.line(xs, fw, C.mute, 1.2, [4, 4]).line(xs, rr, C.accent, 2).line(xs, fa, C.pd, 2);
      // 平衡点：推力第一次掉到阻力以下
      let vf = 0;
      if (fa[0] > rr[0]) {
        vf = 110;
        for (let k = 1; k < xs.length; k++) if (fa[k] < rr[k]) { const d0 = fa[k - 1] - rr[k - 1], d1 = rr[k] - fa[k]; vf = xs[k - 1] + 2 * d0 / (d0 + d1); break; }
      }
      if (vf > 0) { const y = S.roadLoad(vf, slope / 100).F; pl.vline(vf, C.mute).dot(vf, y, C.mid).label(vf, y, `推力 = 阻力：${f0(vf)} km/h`, C.fg, { dy: -14 }); }
      setText('k4g', vf > 0 ? `${f0(vf)}<small>km/h</small>` : '<small>走不动</small>');
      if (kind === 'ev' || vf < 12) { setText('k4h', '–'); setText('k4j', '–'); } else {
        const c = S.cruiseEnergy(vf, slope / 100);
        setText('k4h', `${f0(c.n)}<small>rpm</small>`);
        setText('k4j', `${f0(c.kmL)}<small>km/L</small>`);
      }
      pl.hover = { x: xs, xf: (v) => `${v} km/h`, series: [{ n: '推力', c: C.pd, y: fa, f: (v) => `${f0(v)} N` }, { n: '阻力', c: C.accent, y: rr, f: (v) => `${f0(v)} N` }] };
    };
    const upd = () => {
      Te = S.engTorque(n, q);
      e = S.engineFlows(n, Te);
      const p = S.throttlePlate(q);
      // 把手、拉线、圆盘
      el('t4gl').setAttribute('transform', `rotate(${-75 * q} 82 24)`);
      setText('t4gv', `拧了 ${f0(q * 100)} %`);
      if (kind !== 'ev') {
        el('t4rot').setAttribute('transform', `rotate(${-p.deg} 128 110)`);
        const ph = (46 - p.deg) * Math.PI / 180, tx = 128 + 34 * Math.sin(ph), ty = 110 - 34 * Math.cos(ph);
        el('t4cable').setAttribute('d', `M93 24 Q ${f1(tx + 14)} 26 ${f1(tx)} ${f1(ty)}`);
        el('t4spray').setAttribute('opacity', kind === 'efi' ? Math.min(1, e.mFuel / 7).toFixed(2) : 0);
        el('t4iacv').classList.toggle('on', q < 0.04 && !e.cut);
        setText('t4e1', `读：压力 ${f0(e.pMan)} kPa · 转速 ${f0(n)} rpm`);
        setText('t4e2', e.cut ? '算：松油门 + 转速高 → 断油' : `算：空气 ${f0(e.mAir)} mg ÷ ${f1(S.FUEL.AFR * e.lambda)} = 油 ${f1(e.mFuel)} mg`);
        setText('t4e3', e.cut ? '做：喷油嘴不通电' : `做：喷油嘴通电 ${f1(e.pulse)} ms`);
        const liftS = Math.sqrt(Math.min(1, e.air / 8));
        el('t4slide').setAttribute('height', f1(24 - 20 * liftS));
        el('t4needle').setAttribute('y1', f1(96 + 24 - 20 * liftS)); el('t4needle').setAttribute('y2', f1(140 - 14 * liftS));
        setText('t4c3', `滑块升起 ${f0(liftS * 100)} % · 每次吸油 ${f1(e.cut ? 0 : e.mFuel)} mg`);
        setText('t4tq', `${f1(Te)} N·m`);
        setText('k4a', `${f0(p.deg - 6)}<small>°</small>`);
        setText('k4b', `${f0(e.pMan)}<small>kPa</small>`);
        setText('k4c', `${f0(e.mAir)}<small>mg</small>`);
        setText('k4d', e.cut ? '<small>断油</small>' : `${f1(e.mFuel)}<small>mg</small>`);
        setText('k4e', kind === 'carb' ? '<small>没有</small>' : `${f1(e.pulse)}<small>ms</small>`);
        setText('k4f', `${f1(Te)}<small>N·m</small>`);
      } else {
        const T = 26 * q, F = T * S.G.emI * .95 / R;
        setText('t4v1', `${f2(0.8 + 3.4 * q)} V`);
        setText('t4v2', `电流指令 ${f0(120 * q)} A`);
        setText('t4v3', `${f1(T)} N·m`);
        el('t4ph').style.strokeWidth = (0.8 + 3 * q).toFixed(2);
        setText('k4v', `${f2(0.8 + 3.4 * q)}<small>V</small>`);
        setText('k4i', `${f0(120 * q)}<small>A</small>`);
        setText('k4t', `${f1(T)}<small>N·m</small>`);
        setText('k4w', `${f0(F)}<small>N</small>`);
      }
      drawPlot();
    };
    const setStep = (k) => {
      step = k;
      document.querySelectorAll('#ph4 button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.v === k ? 'true' : 'false'));
      svg.querySelectorAll('[data-s]').forEach((g) => g.classList.toggle('dim', k > 0 && kind !== 'ev' && !g.dataset.s.split(' ').includes(String(k))));
      setText('sn4', kind === 'ev' ? NOTE_EV : (kind === 'carb' && (k === 0 || k === 3) ? NOTE_CARB : NOTE[k]));
    };
    const hs = range('h4', (v) => `${v} %`, (v) => { q = v / 100; upd(); });
    const ns = range('r4', (v) => `${v} rpm`, (v) => { n = v; upd(); });
    range('g4', (v) => `${v} %`, (v) => { slope = v; drawPlot(); });
    $('g4-o').textContent = '0 %';
    document.querySelectorAll('#ph4 button').forEach((b) => {
      b.onclick = () => {
        const k = +b.dataset.v;
        if (k === step) return setStep(0);
        if (k === 5) hs.set(0);
        else if (q < 0.05) hs.set(35);
        setStep(k);
      };
    });
    segBind('kind4', (v) => {
      kind = v;
      el('t4engine').toggleAttribute('hidden', v === 'ev'); el('t4ev').toggleAttribute('hidden', v !== 'ev');
      el('t4efi').toggleAttribute('hidden', v !== 'efi'); el('t4carb').toggleAttribute('hidden', v !== 'carb');
      $('kg4').hidden = v === 'ev'; $('ke4').hidden = v !== 'ev';
      $('r4').disabled = v === 'ev'; $('ph4').hidden = v === 'ev';
      setStep(0); upd();
    });
    hs.upd(); ns.upd(); setStep(0);
    A.setLegend(`<span><i style="background:#4cc9f0"></i>吸进来的空气</span><span><i style="background:#b9a99a"></i>废气</span>`);
    return {
      tick(dt) {
        const sp = st.paused ? 0 : st.speed;
        spinU4(A, dt, { n, x: 0, wb: 0, lock: false, clutch: 0 });
        A.setSlow(`慢放 1/40 · 发动机空转 ${f0(n)} rpm`);
        U.gas = gas4(U.th * 180 / Math.PI, e && !e.cut ? Math.max(.15, e.x) : .1);
        const fi = st.flow('intake'), fe = st.flow('exhaust');
        const d = ((U.th * 180 / Math.PI % 720) + 720) % 720;
        const { inL, exL } = S.valveLifts(d);
        if (fi) { fi.target = inL > .4 ? 1 : 0; fi.rate = sp * (0.25 + (e ? e.x : .3)); }
        if (fe) { fe.target = exL > .4 ? 1 : 0; fe.rate = sp; }
        if (kind === 'ev') { rot += dt * sp * (0.4 + 5 * q) * (q > 0 ? 1 : 0); el('t4rotor').setAttribute('transform', `rotate(${f1(rot * 57.3)} 274 152)`); return; }
        // 二维示意图：活塞、气门、缸内颜色跟舞台同一个曲轴角
        const th = d * Math.PI / 180;
        const pinY = 228 - (22 * Math.cos(th) + Math.sqrt(58 * 58 - (22 * Math.sin(th)) ** 2));
        const top = pinY - 10;
        el('t4piston').setAttribute('y', f1(top));
        el('t4rod').setAttribute('y1', f1(pinY)); el('t4rod').setAttribute('x2', f1(280 + 22 * Math.sin(th))); el('t4rod').setAttribute('y2', f1(228 - 22 * Math.cos(th)));
        el('t4pin').setAttribute('cx', f1(280 + 22 * Math.sin(th))); el('t4pin').setAttribute('cy', f1(228 - 22 * Math.cos(th)));
        const s4 = S.stroke4(d), load = e && !e.cut ? e.x : 0;
        const gas = el('t4gas');
        gas.setAttribute('height', f1(Math.max(1, top - 125)));
        gas.setAttribute('fill', s4.k === 'power' && !load ? GASC.exhaust : GASC[s4.k]);
        gas.setAttribute('opacity', (s4.k === 'power' ? 0.2 + 0.7 * load : s4.k === 'exhaust' ? .35 : 0.15 + 0.4 * Math.max(load, .2)).toFixed(2));
        const vi = 124 + inL / 7 * 7, ve = 124 + exL / 7 * 7;
        el('t4vi').setAttribute('y1', f1(vi)); el('t4vi').setAttribute('y2', f1(vi)); el('t4vis').setAttribute('y1', f1(vi));
        el('t4ve').setAttribute('y1', f1(ve)); el('t4ve').setAttribute('y2', f1(ve)); el('t4ves').setAttribute('y1', f1(ve));
        el('t4spark').setAttribute('opacity', load && (d > 700 || d < 12) ? 1 : 0);
        setText('t4st', s4.cn);
        // 空气小点：圆盘前面一直是满的，圆盘后面按进气管压力变稀
        const spd = (0.05 + 0.75 * Math.min(1, (e ? e.air : 0) / 8)) * sp;
        const fuelX = kind === 'carb' ? 88 : 236;
        for (const a of airs) {
          a.u = (a.u + spd * dt) % 1;
          const x = 50 + a.u * 214, y = 110 + a.off + (x > 248 ? (x - 248) * 0.9 : 0);
          a.c.setAttribute('cx', f1(x)); a.c.setAttribute('cy', f1(Math.min(y, 121)));
          a.c.setAttribute('opacity', x < 128 || a.fr < (e ? e.x : .3) ? 1 : 0.08);
          a.c.setAttribute('fill', x > fuelX && e && !e.cut ? '#ffd166' : '#4cc9f0');
        }
      },
    };
  },
};

// ================================================================ 09 算一算：转速、扭矩、功率、车速
const ch9num = {
  id: 'numbers', nav: '转速和功率', title: '算一算：转速、扭矩、功率、车速',
  view: { model: 'U4', view: 'cvt', hide: ['U4_CVTCover', 'U4_AirBox'] },
  lead: '仪表盘和说明书上的这几个数，其实只靠四步乘除法就能互相算出来。先认识三个词：<b>转速</b>是曲轴一分钟转几圈（rpm）；<b>扭矩</b>是“拧的劲”，1 N·m 大约是用 1 米长的扳手、在末端挂一袋 100 克的东西那么大的劲；<b>功率</b>是“每秒干多少活”，等于劲 × 转得多快。下面每一步都把当前的数字直接代进公式里，拖滑块看它们怎么跟着变。',
  body: () => `
    ${quiz('q9', '两台发动机曲轴上的扭矩一样大，甲转 3000 rpm，乙转 6000 rpm。谁的功率大？', ['一样大，因为扭矩一样', '乙是甲的 2 倍', '甲大，转得慢更有劲', '乙是甲的 4 倍'])}
    ${seg('m9', [['fix', '定住看', '自己定车速和油门'], ['live', '开起来', '实时仿真']], 'fix')}
    ${ctl('v9', '车速', 20, 100, 1, 40)}
    ${ctl('q9s', '油门', 0, 100, 5, 100)}
    ${ctl('g9', '坡度', 0, 15, 1, 0)}
    <div class="btns" id="b9" hidden><button class="btn" id="go9" type="button">停车 → 重新起步</button></div>
    ${kpis([['k9a', '发动机转速'], ['k9b', '车速'], ['k9c', '曲轴扭矩'], ['k9d', '曲轴功率'], ['k9e', '后轮推力'], ['k9f', '加速度']])}
    <div class="status" id="s9"></div>
    ${calc(1, '转速 → 车速（只是几何）', `<p>曲轴转的圈数，先被皮带轮除以<b>速比</b>，再被两级齿轮除以 <b>${f2(S.G.iF || 9.67)}</b>，就是后轮的转速。后轮每转一圈，车往前走一个轮周长。</p>${eq('e9a')}${eq('e9b')}`)}
    ${calc(2, '扭矩 × 转速 = 功率', `<p>同样的劲，转得快一倍，每秒干的活就多一倍。把单位换成常用的 kW，要除以 9549（就是 60 ÷ 2π × 1000，纯粹换单位）。1 kW ≈ 1.36 马力。</p>${eq('e9c')}`)}
    ${calc(3, '扭矩 → 后轮推力', `<p>减速机构是“用转速换劲”：转得慢了多少倍，扭矩就大多少倍（再扣掉皮带和齿轮的损耗）。后轮扭矩除以轮子半径，就是轮胎往后蹬地的力。</p>${eq('e9d')}${eq('e9e')}`)}
    ${calc(4, '推力 − 阻力 = 加速', `<p>推力比阻力大，多出来的力让车加速（牛顿第二定律：力 = 质量 × 加速度）；一样大就匀速；比阻力小就慢下来。</p>${eq('e9f')}${eq('e9g')}`)}
    ${plot('p9', 180, `<span>${sw(C.pd)}扭矩 N·m（这个油门下）</span><span>${sw(C.accent)}功率 kW</span><span>${sw(C.mute)}满油门</span>`)}
    <div id="acc9" hidden>${kpis([['k9g', '已经跑了'], ['k9h', '已经烧油'], ['k9i', '平均油耗']])}</div>`,
  notes: () => `
    ${note('最容易混的一点：扭矩大 ≠ 功率大', 'a', `<p>扭矩说的是“这一下推多大劲”，功率说的是“每秒总共干多少活”。上面的图里，扭矩在 7000 rpm 左右最大，功率却要到 8500 rpm 附近才最大：扭矩虽然开始往下掉，但转得更快，乘起来还在涨。<b>决定极速和加速快慢的是功率</b>（经过变速之后送到后轮的功率）；扭矩大只说明“不用转那么快也有劲”。</p>`)}
    ${note('CVT 在这四步里做了什么', 'a', `<p>第 1 步里的<b>速比</b>是会变的。选“定住看”，把车速从 20 拖到 100：发动机转速只涨了一点，速比一路变小。CVT 的本事就是让发动机一直待在功率大的那段转速，把“转得快”换成后轮上“推力大”或者“车速高”（${CH('cvt')}、${CH('ride')}）。</p>`)}
    ${note('为什么越快越难再加速', 'a', `<p>第 4 步里风阻和车速的<b>平方</b>成正比，克服它要的功率和车速的<b>三次方</b>成正比：从 60 到 90 km/h，车速是 1.5 倍，风阻要的功率是 3.4 倍。发动机能给的功率有上限，所以推力和阻力总会在某个车速碰上，那就是极速。</p>`)}
    ${note('这个实验依赖的假设', 'c', `<p>“定住看”假设离合器已经咬住、皮带停在力平衡的位置（${CH('cvt')} 的算法），再问“这一瞬间”各个数是多少；这时车一般正在加速，不是匀速。“开起来”用的是 ${CH('ride')} 同一个整车模型，1 毫秒一步往前算；起步的头一两秒离合器在打滑，第 1 步的等式暂时不成立，页面会提示。阻力只算滚动（系数 0.015）、风（C<sub>d</sub>A 0.56 m²）和坡，人 + 车 195 kg；皮带效率 0.88、齿轮 0.96。都是教学车的量级。</p>`)}
    ${note('什么时候不准', 'd', `<p>真实的车在急加速时，发动机自己转速上升也要“吃掉”一部分扭矩（转动惯量），轮胎会有一点滑移，逆风顺风会让阻力差很多。说明书上的“最大功率”是在测功机上、满油门、某一个转速测的，平时骑车用到的功率通常只有它的两三成。</p>`)}`,
  enter(A) {
    const st = A.stage, U = st.U4, R = S.G.wheelR, circ = 2 * Math.PI * R;
    A.setPins([]);
    quizBind('q9', 1, '功率 = 扭矩 × 转速 ÷ 9549。扭矩一样，转速是 2 倍，功率就是 2 倍。这也是小排量发动机要转得很高的原因：劲不大，就靠转得快来凑功率。');
    let mode = 'fix', v = 40, q = 1, slope = 0, ride = null, d = null, acc = 0;
    const pl = new Plot($('p9'), { l: 36, b: 24 });
    const render = () => {
      let s;
      if (mode === 'fix') {
        d = S.driveChain(v, q, slope / 100);
        s = { n: d.n, i: d.i, x: d.x, v, Te: d.Te, F: d.F, res: d.res, a: d.acc, lock: true, wheelRpm: d.wheelRpm, M: d.M };
      } else {
        const g = ride.geom(), res = S.roadLoad(ride.v * 3.6, slope / 100, ride.M);
        const F = ride.Tc * S.G.iF * S.CVT.etaG / R;
        s = { n: ride.n, i: g.i, x: ride.x, v: ride.v * 3.6, Te: ride.Te, F, res, a: (F - res.F) / ride.M, lock: ride.lock, wheelRpm: ride.v / R / S.RPM, M: ride.M };
        if (ride.v < 0.05 && s.a < 0) s.a = 0;
      }
      const P = S.powerKW(s.n, s.Te);
      setText('k9a', `${f0(s.n)}<small>rpm</small>`);
      setText('k9b', `${f0(s.v)}<small>km/h</small>`);
      setText('k9c', `${f1(s.Te)}<small>N·m</small>`);
      setText('k9d', `${f1(P)}<small>kW</small>`);
      setText('k9e', `${f0(s.F)}<small>N</small>`);
      setText('k9f', `${f2(s.a)}<small>m/s²</small>`);
      const st9 = $('s9');
      const msg = !s.lock ? ['', '离合器还在打滑：发动机先转起来了，后轮还没跟上。']
        : s.a > 0.05 ? ['ok', `推力比阻力大 ${f0(s.F - s.res.F)} N：正在加速，每秒快 ${f1(s.a * 3.6)} km/h。`]
          : s.a < -0.05 ? ['bad', `推力比阻力小 ${f0(s.res.F - s.F)} N：车在慢下来${s.Te < 0 ? '（松油门，发动机在拖着车）' : ''}。`]
            : ['', '推力和阻力几乎一样大：匀速。'];
      st9.className = `status ${msg[0]}`; st9.innerHTML = msg[1];
      if (s.lock) {
        setText('e9a', `后轮转速 = ${hl(f0(s.n))} ÷ ${hl(f2(s.i))} ÷ ${f2(S.G.iF)} = ${rs(`${f0(s.wheelRpm)} rpm`)}`);
        setText('e9b', `车速 = ${hl(f0(s.wheelRpm))} × ${f2(circ)} m × 60 ÷ 1000 = ${rs(`${f0(s.v)} km/h`)}`);
      } else {
        setText('e9a', `发动机 ${hl(f0(s.n))} rpm，后轮只有 ${hl(f0(s.wheelRpm))} rpm`);
        setText('e9b', '离合器在打滑，两边对不上；等咬住再看这一步');
      }
      setText('e9c', `功率 = ${hl(f1(s.Te))} N·m × ${hl(f0(s.n))} rpm ÷ 9549 = ${rs(`${f1(P)} kW`)}（${f1(P * 1.36)} 马力）`);
      const Tw = s.F * R;
      if (s.lock) setText('e9d', `后轮扭矩 = ${hl(f1(s.Te))} × ${hl(f2(s.i))} × ${f2(S.G.iF)} × 0.88 × 0.96 = ${rs(`${f0(Tw)} N·m`)}`);
      else setText('e9d', `后轮扭矩 = 离合器这时能传过来的 → ${rs(`${f0(Tw)} N·m`)}`);
      setText('e9e', `推力 = ${hl(f0(Tw))} ÷ ${f3(R)} m = ${rs(`${f0(s.F)} N`)}（约 ${f0(s.F / 9.81)} 公斤力）`);
      setText('e9f', `阻力 = 滚动 ${hl(f0(s.res.roll))} + 风 ${hl(f0(s.res.aero))} + 坡 ${hl(f0(s.res.grade))} = ${rs(`${f0(s.res.F)} N`)}`);
      setText('e9g', `加速度 = (${hl(f0(s.F))} − ${hl(f0(s.res.F))}) ÷ ${f0(s.M)} kg = ${rs(`${f2(s.a)} m/s²`)}`);
      // 扭矩、功率曲线
      const xs = [], tq = [], pw = [], pw1 = [];
      for (let nn = 1500; nn <= 9800; nn += 100) { xs.push(nn); const T = Math.max(0, S.engTorque(nn, q)); tq.push(T); pw.push(S.powerKW(nn, T)); pw1.push(S.powerKW(nn, S.tqWot(nn))); }
      pl.clear().scale(1500, 9800, 0, 14).axes({ xt: [2000, 4000, 6000, 8000], yt: [0, 4, 8, 12], xl: 'rpm', yl: 'N·m / kW' });
      pl.line(xs, pw1, C.mute, 1.2, [4, 4]).line(xs, tq, C.pd, 2).line(xs, pw, C.accent, 2);
      const nn = Math.max(1500, Math.min(9800, s.n));
      pl.vline(nn, C.mute).dot(nn, Math.max(0, s.Te), C.pd).dot(nn, Math.max(0, P), C.accent);
      pl.label(nn, Math.max(0, P), `${f1(P)} kW`, C.fg, { dy: 12 });
      pl.hover = { x: xs, xf: (x) => `${x} rpm`, series: [{ n: '扭矩', c: C.pd, y: tq, f: (y) => `${f1(y)} N·m` }, { n: '功率', c: C.accent, y: pw, f: (y) => `${f1(y)} kW` }] };
      if (mode === 'live') {
        setText('k9g', ride.dist < 1000 ? `${f0(ride.dist)}<small>m</small>` : `${f2(ride.dist / 1000)}<small>km</small>`);
        setText('k9h', `${f1(ride.fuel / S.FUEL.rho)}<small>mL</small>`);
        setText('k9i', ride.fuel > 0.05 && ride.dist > 5 ? `${f0(ride.dist / 1000 / (ride.fuel / 1000 / S.FUEL.rho))}<small>km/L</small>` : '–');
      }
      return s;
    };
    range('v9', (x) => `${x} km/h`, (x) => { v = x; if (mode === 'fix') render(); }).upd();
    range('q9s', (x) => `${x} %`, (x) => { q = x / 100; if (mode === 'fix') render(); }).upd();
    range('g9', (x) => `${x} %`, (x) => { slope = x; if (ride) ride.o.slope = x / 100; if (mode === 'fix') render(); });
    $('g9-o').textContent = '0 %';
    const restart = () => { ride = new S.Ride({ slope: slope / 100 }); };
    $('go9').onclick = restart;
    segBind('m9', (m) => {
      mode = m;
      $('v9').disabled = m === 'live'; $('b9').hidden = m !== 'live'; $('acc9').hidden = m !== 'live';
      if (m === 'live') restart();
      render();
    });
    let cur = render();
    return {
      tick(dt) {
        const sp = st.paused ? 0 : 1;
        if (mode === 'live') {
          if (sp) ride.step(dt, q);
          acc += dt;
          if (acc > 0.1) { acc = 0; cur = render(); }
          spinU4(A, dt, { n: ride.n, x: ride.x, wb: ride.v * S.G.iF / R, lock: ride.lock, clutch: S.clutchCap(ride.n * S.RPM / ride.geom().i) > 0 ? 1 : 0 });
          rpmNote(A, ride.n, ride.v * 3.6);
        } else {
          spinU4(A, dt, { n: d.n, x: d.x });
          rpmNote(A, d.n, v);
        }
        U.gas = gas4(U.th * 180 / Math.PI, q);
      },
    };
  },
};

// ================================================================ 10 热值、效率、油耗
const EPART = [['wheel', '到后轮（推车）', '#4fd18b'], ['trans', '皮带和齿轮发热', '#c78bff'], ['fric', '发动机内部摩擦', '#ffd166'], ['pump', '吸气费的劲（泵气）', '#4cc9f0'],
  ['cool', '缸壁散掉的热', '#ff9d3c'], ['exh', '排气带走的热', '#ff7066']];
const ch10en = {
  id: 'energy', nav: '热值和油耗', title: '一滴油的去向：热值、效率、油耗',
  view: { model: 'U4', view: 'home' },
  lead: '汽油里存的是<b>化学能</b>，烧掉才变成热。<b>热值</b>就是“1 千克燃料完全烧掉能放出多少热”：汽油大约 <b>43 MJ/kg</b>，换成按升算约 32 MJ/L，也就是 8.9 kWh（度）—— 1 升汽油的热，够一台 1 kW 的电暖器开将近 9 小时。可惜发动机只能把其中两三成变成推车的功，其余都变成热散掉了。这一章跟着一滴油，一步一步算到“每升能跑多少公里”。',
  body: () => `
    ${quiz('q10', '在平路上匀速 60 km/h，烧掉的汽油里，大约有多少变成了推车往前走的功？', ['九成左右', '一半左右', '两成左右', '不到百分之五'])}
    ${ctl('v10', '匀速车速', 20, 95, 1, 60)}
    ${ctl('g10', '坡度', 0, 12, 1, 0)}
    ${ctl('m10', '人 + 车', 160, 280, 5, 195)}
    <div class="status" id="s10"></div>
    ${kpis([['k10a', '每升跑'], ['k10b', '百公里油耗'], ['k10c', '烧油的热功率'], ['k10d', '到后轮的功率'], ['k10e', '油箱 → 车轮'], ['k10f', '二氧化碳']])}
    <p class="seglab">烧掉的热都去哪了（整条 = 100 %）</p>
    <div class="ebar" id="eb10"></div>
    <div class="elist" id="el10"></div>
    ${calc(1, '一次进气：吸多少空气，配多少油', `<p>125 cc 的气缸，一次最多吸进约 0.15 克空气。匀速时节气门只开一点，进气管里的气压比外面低，吸进去的就更少。电脑按 14.7 : 1 配油（${CH('throttle')}）。一滴水大约 50 mg，对比一下每次喷的油有多少。</p>${eq('e10a')}`)}
    ${calc(2, '每秒烧多少油', `<p>四冲程是曲轴转两圈才点一次火，所以每秒点火次数 = 转速 ÷ 120。</p>${eq('e10b')}${eq('e10c')}`)}
    ${calc(3, '这些油有多少热（热值）', `<p>1 克汽油烧完放出约 43 kJ 的热，够把一小杯水（约 130 mL）从 20 °C 烧开。每秒放出多少千焦，就是多少千瓦（1 kW = 1 kJ/s）。</p>${eq('e10d')}`)}
    ${calc(4, '多少变成了功', `<p>曲轴上的功率照上一章的公式算；它除以烧油的热功率，就是发动机的<b>热效率</b>。再乘皮带和齿轮的效率，才是到后轮的。</p>${eq('e10e')}${eq('e10e2')}${eq('e10f')}`)}
    ${calc(5, '换成油耗', `<p>每小时烧几升，除以每小时跑几公里。</p>${eq('e10g')}${eq('e10h')}${eq('e10i')}`)}
    ${plot('p10', 180, `<span>${sw(C.pd)}每升跑多少公里（匀速）</span><span>${sw(C.accent)}油箱 → 车轮的效率 %</span><span>${sw(C.mid)}一台量产 125 cc 的厂家数字</span>`)}`,
  notes: () => `
    ${note('热值是什么，数字靠不靠谱', 'ab', `<p>热值是燃料本身的性质，和发动机无关。车用汽油的低热值，美国能源部的资料给的是每加仑 112,114 ～ 116,090 Btu，换算后约 <b>31.2 ～ 32.4 MJ/L</b>${P('AFDC 燃料性质')}；本页用 43 MJ/kg × 0.745 kg/L ≈ 32.0 MJ/L，在这个范围里。掺了乙醇的汽油会低一点。“低”热值的意思是：不算废气里水蒸气凝结还能放出的那部分热，因为发动机用不上。</p>
      <p>二氧化碳按每升汽油约 2.35 kg 算${P('EPA CO₂')}：1 kg 汽油烧出 3 kg 多的 CO₂，多出来的重量是空气里的氧。</p>`)}
    ${note('为什么只有两三成变成功', 'a', `<p>发动机是<b>热机</b>：先把油烧成高温高压的气体，再让气体膨胀推活塞。气体推完活塞排出去时还有几百度，这部分热直接从排气管走了；气缸壁必须冷却（不然会烧坏），又带走一大块。这两项加起来通常占六七成，是原理决定的，不是哪家做得不好。剩下的还要扣掉发动机内部摩擦、吸气费的劲、皮带和齿轮的损耗。</p>
      <p>把车速拖到 20 km/h 看能量条：要的功率很小，但摩擦和泵气几乎不随着变小，所以<b>小负荷时效率特别低</b>。这也是堵车费油、汽车要做混动的原因之一。</p>`)}
    ${note('为什么不是越慢越省油', 'cd', `<p>下面的图里，每升能跑的公里数在 30 ～ 40 km/h 附近最高。再快，风阻涨得太猛；再慢，发动机自己“空耗”的那些（摩擦、泵气、散热）摊到每公里上反而更多。这个最省油的车速是本页模型算出来的，真实的车会因为风阻、齿比、发动机标定不同而不一样，我没有找到可以直接对照的实测曲线。</p>`)}
    ${note('和厂家数字对一下', 'bc', `<p>一台量产的 124 cc 踏板车，厂家公布的数字是：60 km/h 匀速 <b>55.0 km/L</b>（两人乘坐），包含起步、加速、停车的 WMTC 模式 <b>47.7 km/L</b>（一人）；最大功率 9.2 kW / 8750 rpm、最大扭矩 12 N·m / 6500 rpm${P('Honda PCX 诸元')}。本页的教学车在 60 km/h、两人（把“人 + 车”拖到 260 kg）时算出来大约 49 km/L，同一个量级、略差一些。两者不是同一台车，只能说明模型没有离谱。</p>`)}
    ${note('和电动车比', 'ac', `<p>第 5 步最后一行把同一段路换成 kWh：后轮真正需要的能量只有几度电，汽油车却要烧掉十几度电那么多的热。电动车的电机和控制器加起来效率通常在八九成（${CH('ev')}），所以从电池里取的电只比后轮需要的多一点。这里只比“车上”这一段，没算发电和炼油的损耗。</p>`)}
    ${note('这一章依赖的假设', 'c', `<p>发动机的扭矩曲线是本页设的；油耗是倒推的：要出这么大扭矩 → 燃烧要推活塞做多少功（加上摩擦和泵气）→ 假设烧出来的热有 39 %（大负荷）到约 29 %（怠速附近）推到了活塞上 → 得出要喷多少油。充气效率由满油门扭矩反推。没变成功的热，在“缸壁”和“排气”之间按一个随负荷变化的比例分（缸壁约占 38 ～ 48 %），这个比例是我按教科书里的典型范围设的。滚动阻力 0.015、C<sub>d</sub>A 0.56 m²、皮带 0.88、齿轮 0.96。所有数字只适合看趋势和量级。</p>`)}
    ${note('什么时候会差很多', 'd', `<p>冷车（电脑加浓、机油稠）、短途、频繁起步、逆风、轮胎气压低、皮带打滑，都会让实际油耗比这里高。猛拧油门时电脑会加浓到约 13 : 1，多喷的油烧不掉，直接从排气管走（能量条里“排气带走”会变大）。</p>`)}`,
  enter(A) {
    const st = A.stage, U = st.U4;
    A.setPins(A.pins('U4', 'pins', ['气缸', '排气管', 'CVT 箱', '后轮', '节气门体']));
    quizBind('q10', 2, '这台教学车在 60 km/h 时大约是 19 %。排气和缸壁散热就带走了六七成，剩下的还要分给摩擦、泵气、皮带和齿轮。看下面的能量条。');
    st.setFlows([
      { model: 'U4', key: 'intake', color: '#4cc9f0', speed: 260, spacing: 9 },
      { model: 'U4', key: 'exhaust', color: '#b9a99a', speed: 300, spacing: 9 },
    ]);
    let v = 60, slope = 0, M = 195, c = null;
    const pl = new Plot($('p10'), { l: 36, b: 24 });
    $('eb10').innerHTML = EPART.map(([k, , col]) => `<i data-k="${k}" style="background:${col}"></i>`).join('');
    $('el10').innerHTML = EPART.map(([k, t, col]) => `<i style="background:${col}"></i><span>${t}</span><b id="el-${k}"></b><em id="ep-${k}"></em>`).join('');
    const render = () => {
      c = S.cruiseEnergy(v, slope / 100, M);
      const e = c.e, Q = e.Q;
      const parts = { wheel: c.Pwheel, trans: c.Pbelt + c.Pgear, fric: e.Pfric, pump: e.Ppump, cool: e.Pcool, exh: e.Pexh };
      for (const [k] of EPART) {
        const fr = parts[k] / Q;
        $('eb10').querySelector(`[data-k="${k}"]`).style.width = `${(fr * 100).toFixed(2)}%`;
        setText(`el-${k}`, `${f2(parts[k])} kW`); setText(`ep-${k}`, `${f0(fr * 100)} %`);
      }
      const s10 = $('s10');
      if (!c.enough) { s10.className = 'status bad'; s10.innerHTML = '这个坡和车速，满油门也不够：实际车速会掉下来。下面的数按满油门算。'; }
      else { s10.className = 'status'; s10.innerHTML = `匀速需要：油门约 ${f0(c.q * 100)} %，发动机 ${f0(c.n)} rpm，速比 ${f2(c.i)}，进气管压力 ${f0(e.pMan)} kPa（大气压 101）。`; }
      setText('k10a', `${f0(c.kmL)}<small>km</small>`);
      setText('k10b', `${f2(c.lPer100)}<small>L</small>`);
      setText('k10c', `${f1(Q)}<small>kW</small>`);
      setText('k10d', `${f2(c.Pwheel)}<small>kW</small>`);
      setText('k10e', `${f0(c.Pwheel / Q * 100)}<small>%</small>`);
      setText('k10f', `${f0(c.co2)}<small>g/km</small>`);
      const afr = S.FUEL.AFR * e.lambda;
      setText('e10a', `燃油 = 空气 ${hl(f0(e.mAir))} mg ÷ ${f1(afr)} = ${rs(`${f2(e.mFuel)} mg`)}（约 1/${f0(50 / e.mFuel)} 滴水）`);
      setText('e10b', `每秒点火 = ${hl(f0(c.n))} rpm ÷ 120 = ${rs(`${f1(e.cps)} 次`)}`);
      setText('e10c', `每秒烧油 = ${hl(f2(e.mFuel))} mg × ${hl(f1(e.cps))} = ${rs(`${f3(e.fuel)} g`)}（每分钟 ${f1(e.mlMin)} mL）`);
      setText('e10d', `热功率 = ${hl(f3(e.fuel))} g/s × 43 kJ/g = ${rs(`${f1(Q)} kW`)}`);
      setText('e10e', `曲轴功率 = ${hl(f2(c.Te))} N·m × ${hl(f0(c.n))} ÷ 9549 = ${rs(`${f2(e.Pe)} kW`)}`);
      setText('e10e2', `热效率 = ${hl(f2(e.Pe))} ÷ ${hl(f1(Q))} = ${rs(`${f0(e.eff * 100)} %`)}`);
      setText('e10f', `到后轮 = ${hl(f2(e.Pe))} × 0.88 × 0.96 = ${rs(`${f2(c.Pwheel)} kW`)}（油箱到车轮 ${rs(`${f0(c.Pwheel / Q * 100)} %`)}）`);
      const lph = e.fuel * 3600 / (S.FUEL.rho * 1000);
      setText('e10g', `每小时烧油 = ${hl(f3(e.fuel))} g/s × 3600 ÷ 745 g/L = ${rs(`${f2(lph)} L`)}`);
      setText('e10h', `油耗 = ${hl(f2(lph))} L ÷ ${hl(v)} km × 100 = ${rs(`${f2(c.lPer100)} L/100 km`)} = ${rs(`${f0(c.kmL)} km/L`)}`);
      setText('e10i', `每 100 km：烧掉的热 ${hl(f1(c.kWhFuel))} kWh，后轮只用了 ${hl(f1(c.kWhWheel))} kWh`);
      const xs = [], km = [], ef = [];
      for (let x = 20; x <= 95; x += 2.5) { const cc = S.cruiseEnergy(x, slope / 100, M); xs.push(x); km.push(cc.enough ? cc.kmL : NaN); ef.push(cc.enough ? cc.Pwheel / cc.e.Q * 100 : NaN); }
      const ok = (arr) => arr.map((y, k) => [xs[k], y]).filter((p) => !Number.isNaN(p[1]));
      pl.clear().scale(15, 100, 0, 70).axes({ xt: [20, 40, 60, 80, 100], yt: [0, 20, 40, 60], xl: 'km/h', yl: 'km/L · %' });
      const a = ok(km), b = ok(ef);
      if (a.length > 1) pl.line(a.map((p) => p[0]), a.map((p) => p[1]), C.pd, 2).line(b.map((p) => p[0]), b.map((p) => p[1]), C.accent, 1.8);
      pl.dot(60, 55, C.mid, 4, false).label(60, 55, '厂家 55（两人）', C.mid, { dy: -12 });
      if (c.enough) pl.vline(v, C.mute).dot(v, c.kmL, C.pd).dot(v, c.Pwheel / Q * 100, C.accent);
      pl.hover = { x: xs, xf: (x) => `${x} km/h`, series: [{ n: '每升', c: C.pd, y: km, f: (y) => (Number.isNaN(y) ? '–' : `${f0(y)} km`) }, { n: '效率', c: C.accent, y: ef, f: (y) => (Number.isNaN(y) ? '–' : `${f0(y)} %`) }] };
      rpmNote(A, c.n, v);
    };
    range('v10', (x) => `${x} km/h`, (x) => { v = x; render(); });
    range('g10', (x) => `${x} %`, (x) => { slope = x; render(); });
    range('m10', (x) => `${x} kg`, (x) => { M = x; render(); });
    $('v10-o').textContent = '60 km/h'; $('g10-o').textContent = '0 %'; $('m10-o').textContent = '195 kg';
    render();
    return {
      tick(dt) {
        const sp = st.paused ? 0 : st.speed;
        spinU4(A, dt, { n: c.n, x: c.x });
        const d = ((U.th * 180 / Math.PI % 720) + 720) % 720;
        U.gas = gas4(d, Math.max(.2, c.e.x));
        const { inL, exL } = S.valveLifts(d);
        const fi = st.flow('intake'), fe = st.flow('exhaust');
        if (fi) { fi.target = inL > .4 ? 1 : 0; fi.rate = sp * (0.3 + c.e.x); }
        if (fe) { fe.target = exL > .4 ? 1 : 0; fe.rate = sp; }
      },
    };
  },
};

export const CHAPTERS = [ch1, ch2, ch3, ch4thr, ch4, ch5, ch6, ch7, ch9num, ch10en, ch8, ch9, ch10, ch11, ch12];
