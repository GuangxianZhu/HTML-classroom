// 页面：把仿真（core.js）、三维舞台（stage.js）和仪表、图、踏板接起来。
import glb from '../../blender/out/car.glb';
import spec from '../../blender/out/spec.json';
import ptGlb from '../../blender/out/pt_ehev.glb';
import specE from '../../blender/out/spec_ehev.json';
import P from '../../params.json';
import { makeCar, run, RPM, clamp, stroke, valveLift } from './core.js';
// 第二套动力（两电机混动）的仿真：用的是“飞度混动原理”那一页的能量模型，把车换成这辆三厢车
import * as HY from '../../../飞度混动原理/web/src/sim.js';
import { Stage } from './stage.js';

const $ = (id) => document.getElementById(id);
const car = makeCar(P), S = P.sim, C = P.cvt, V = P.vehicle, E = P.engine, CK = spec.cockpit;
const H = 1 / 240;                                  // 仿真步长
let s = car.initial();
let o = car.step(s, { pedal: 0, brake: 0 }, H);
const set = { pedal: 0, brake: 0, grade: 0 };       // 滑块上设的
const act = { pedal: 0, brake: 0, grade: 0 };       // 脚实际踩到的（跟着滑块走，略慢一点）
const keys = { up: false, down: false };
let slow = 20, stage = null, toast = '', toastT = 0;
// PT = 现在装的是哪套动力：'cvt' 燃油 + CVT / 'ehev' 两电机混动（网址带 ?pt=ehev 直接进混动）
let PT = new URLSearchParams(location.search).get('pt') === 'ehev' ? 'ehev' : 'cvt';
HY.setVehicle({ m: P.vehicle.mass, CdA: P.vehicle.cd * P.vehicle.area, Crr: P.vehicle.crr, rw: P.vehicle.r_roll / 1000 });
let hs = HY.makeDrive();
const HMODE = { EV: ['纯电', 'ok'], HYB: ['混动：发动机发电', 'on'], ENG: ['发动机直驱', 'ok'], REGEN: ['能量回收', 'on'], EBRK: ['回收 + 拖发动机', 'warn'], SYNC: ['同步转速，准备直连', 'on'] };
const trace = { v: [], n: [], t: 0 };
const timer = { armed: true, t0: -1, last: 0, vmax: 0 };
const f0 = (x) => x.toFixed(0), f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);
const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
const COL = { ink: css('--ink'), dim: css('--dim'), line: css('--line'), needle: css('--needle'), amber: css('--amber'), bad: css('--bad'), info: css('--info'), ok: css('--ok'), warn: css('--warn') };

// ------------------------------------------------------------------ 表盘
function dial(svg, { max, minor, major, label, unit, red }) {
  const cx = 100, cy = 100, R = 88;
  const pt = (v, r) => { const a = (-135 + 270 * v / max) * Math.PI / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
  let h = `<circle class="dial-face" cx="${cx}" cy="${cy}" r="${R + 7}"/>`;
  if (red) {
    const [x0, y0] = pt(red[0], R - 3), [x1, y1] = pt(red[1], R - 3);
    h += `<path class="dial-red" stroke-width="6" d="M${x0.toFixed(1)} ${y0.toFixed(1)}A${R - 3} ${R - 3} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}"/>`;
  }
  for (let i = 0; i <= Math.round(max / minor); i++) {
    const v = i * minor, big = Math.abs(v / major - Math.round(v / major)) < 1e-9;
    const [x0, y0] = pt(v, R), [x1, y1] = pt(v, R - (big ? 12 : 6));
    h += `<line class="tick${big ? '' : ' minor'}" stroke-width="${big ? 2 : 1}" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`;
    if (big) { const [x, y] = pt(v, R - 25); h += `<text class="dial-num" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${label(v)}</text>`; }
  }
  h += `<text class="dial-unit" x="${cx}" y="${cy + 36}">${unit}</text><text class="dial-big" x="${cx}" y="${cy + 66}"></text>`;
  h += `<polygon class="target" points="${cx - 5},${cy - R - 5} ${cx + 5},${cy - R - 5} ${cx},${cy - R + 4}" visibility="hidden"/>`;
  h += `<line class="needle" x1="${cx}" y1="${cy + 16}" x2="${cx}" y2="${cy - R + 15}"/><circle class="hub" cx="${cx}" cy="${cy}" r="8"/>`;
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.innerHTML = h;
  const needle = svg.querySelector('.needle'), big = svg.querySelector('.dial-big'), tgt = svg.querySelector('.target');
  const rot = (v) => `rotate(${(-135 + 270 * clamp(v, 0, max) / max).toFixed(2)} ${cx} ${cy})`;
  return {
    set(v, text) { needle.setAttribute('transform', rot(v)); if (text !== big.textContent) big.textContent = text; },
    target(v) { if (v == null) tgt.setAttribute('visibility', 'hidden'); else { tgt.setAttribute('visibility', 'visible'); tgt.setAttribute('transform', rot(v)); } },
  };
}
const tach = dial($('tach'), { max: 7000, minor: 500, major: 1000, label: (v) => v / 1000, unit: '×1000 rpm', red: [S.limit, 7000] });
const speedo = dial($('speedo'), { max: 200, minor: 10, major: 20, label: (v) => v, unit: 'km/h' });

// ------------------------------------------------------------------ 数字小格
const TILES = [['tq', '发动机扭矩'], ['pw', '发动机功率'], ['tc', '变矩器'], ['fx', '驱动力'], ['ins', '瞬时油耗'], ['avg', '平均油耗'], ['acc', '加速度'], ['t100', '0→100 km/h']];
const TILES_E = { tq: '发动机', pw: '驱动电机', tc: '电池' };          // 混动时前三格换成这三样
$('tiles').innerHTML = TILES.map(([id, k]) => `<div class="tile"><div class="k" id="k_${id}">${k}</div><div class="v" id="t_${id}">—</div><div class="s" id="s_${id}">&nbsp;</div></div>`).join('');
const tile = (id, v, unit, sub) => {
  const a = $(`t_${id}`), b = $(`s_${id}`), h = unit ? `${v}<small>${unit}</small>` : v;
  if (a.innerHTML !== h) a.innerHTML = h;
  if (b.textContent !== sub) b.textContent = sub;
};

function tiles() {
  const kmh = Math.abs(o.kmh);
  if (PT === 'ehev') {
    tile('tq', hs.eng ? f1(hs.Pe / 1000) : '熄火', hs.eng ? 'kW' : '', hs.eng ? `${f0(hs.nE / 10) * 10} rpm` : '一动不动');
    tile('pw', f1(hs.Pmot / 1000), 'kW', `${f0(HY.motorRpm(hs.v) / 10) * 10} rpm${hs.Pmot < -200 ? '，在发电' : ''}`);
    tile('tc', f1(Math.abs(hs.Pbat) / 1000), 'kW', `${hs.Pbat > 150 ? '放电' : hs.Pbat < -150 ? '充电' : '几乎不动'}，电量 ${f0(hs.soc * 100)}%`);
    tile('fx', f0(o.fDrive), 'N', `阻力 ${f0(o.fRes)} N`);
  } else {
  tile('tq', f0(o.te), 'N·m', `负荷 ${f0(o.lam * 100)}%`);
  tile('pw', f1(o.pShaft / 1000), 'kW', `想要 ${f0(o.pDes / 1000)} kW`);
  if (o.lock > .95) tile('tc', '锁止', '', '硬连，不打滑');
  else tile('tc', `×${f2(o.tr)}`, '', `涡轮 ${f0(o.nTurbine)}`);
  tile('fx', f0(o.fDrive), 'N', `阻力 ${f0(o.fAero * Math.sign(o.kmh || 1) + (kmh > .1 ? o.fRoll : 0) + o.fGrade * Math.sign(o.kmh || 1))} N`);
  }
  if (kmh > 3) tile('ins', f1(Math.min(99.9, o.lph / kmh * 100)), 'L/100km', `${f1(o.lph)} L/h`);
  else tile('ins', f2(o.lph), 'L/h', '车没走');
  const lit = s.fuel / S.rho_fuel;
  tile('avg', s.dist > 100 ? f1(lit / (s.dist / 1000) * 100) : '—', s.dist > 100 ? 'L/100km' : '', `${f2(s.dist / 1000)} km，${f0(lit * 1000)} mL`);
  tile('acc', f2(o.a), 'm/s²', `${f2(o.a / 9.81)} g`);
  if (timer.t0 >= 0) tile('t100', f1(s.t - timer.t0), 's', '计时中');
  else tile('t100', timer.last ? f1(timer.last) : '—', timer.last ? 's' : '', '起步自动计时');
}

// ------------------------------------------------------------------ 现在在发生什么
let nPrev = o.n, dnFilt = 0;
/** 混动：电脑现在选了哪条路、为什么（理由是能量模型自己给的） */
function explainE() {
  const g = s.gear, [mt, mc] = HMODE[hs.mode] || ['', ''];
  const chips = [[mt, mc], [{ open: '离合器分开', sync: '离合器同步中', locked: '离合器压紧' }[hs.clutch], hs.clutch === 'locked' ? 'ok' : ''], [`电量 ${f0(hs.soc * 100)}%`, '']];
  if (act.grade) chips.push([`${act.grade > 0 ? '上' : '下'}坡 ${f0(Math.abs(act.grade) * 100)}%`, '']);
  let t;
  if (toastT > 0) t = toast;
  else if (g === 'P') t = 'P 挡：驻车机构把车轮卡住。发动机是熄火的，混动车停着不用怠速。挂到 D、踩油门，先是电池带着电机起步。';
  else if (g === 'N') t = 'N 挡：电机不出力。这套系统里发动机和车轮之间本来就靠离合器断开，N 挡只是让电机也歇着。';
  else if (hs.v < .3 && act.pedal < .01) t = '停着：发动机熄火，电机不通电，什么都不转。踩油门就走。';
  else t = `${hs.ecuWhy}。`;
  const hc = chips.map(([a, c]) => `<span class="chip ${c}">${a}</span>`).join('');
  if ($('chips').innerHTML !== hc) $('chips').innerHTML = hc;
  if ($('nowText').textContent !== t) $('nowText').textContent = t;
}

function explain() {
  if (PT === 'ehev') return explainE();
  const chips = [], kmh = o.kmh, av = Math.abs(kmh), moving = av > .5, g = s.gear;
  if (o.lock > .95) chips.push(['锁止离合器压紧', 'ok']);
  else if (o.lock > .02) chips.push(['锁止离合器正在压紧', 'on']);
  else chips.push([`变矩器滑差 ${f0(clamp(1 - o.sr, 0, 1) * 100)}%`, o.tr > 1.02 ? 'on' : '']);
  if (o.tr > 1.02 && o.lock < .5) chips.push([`扭矩 ×${f2(o.tr)}`, 'on']);
  if (o.cut) chips.push(['断油', 'ok']);
  if (o.tcs) chips.push(['抓地力到头，收油', 'warn']);
  if (o.limiter) chips.push(['断油限速', 'bad']);
  if (act.grade) chips.push([`${act.grade > 0 ? '上' : '下'}坡 ${f0(Math.abs(act.grade) * 100)}%`, '']);
  let t;
  if (toastT > 0) t = toast;
  else if (o.limiter) t = `转速到了 ${S.limit} rpm，电脑断油不让再高。`;
  else if (g === 'P') t = o.pedal > .02 ? 'P 挡踩油门：发动机带着泵轮空转，涡轮跟着转，但前进离合器是松开的，动力到不了钢带。' : 'P 挡：驻车机构把车轮卡住。发动机在怠速，泵轮带着涡轮空转。挂到 D、松开刹车，车就会自己慢慢走。';
  else if (g === 'N') t = moving ? 'N 挡滑行：前进离合器松开，发动机和车轮之间断开了。车轮还在带着钢带和两个锥轮转。' : 'N 挡：前进离合器松开，涡轮跟着泵轮空转，动力到不了钢带。';
  else {
    const pre = g === 'R' ? '倒挡：行星排把转动方向反过来，钢带停在最低挡。' : '';
    if (!moving && o.brake > .05 && o.pedal > .15) t = `失速：刹车把涡轮顶住不让转，泵轮在使劲搅油，扭矩放大到 ${f2(o.tr)} 倍。发动机出的 ${f0(o.pShaft / 1000)} kW 全变成了变速箱油的热，真车上别超过几秒。`;
    else if (!moving && o.brake > .05) t = `踩着刹车停着：泵轮 ${f0(o.n)} rpm 搅着油，涡轮不转。发动机得多喷一点油顶住这份阻力，所以 D 挡怠速比 N 挡费油。`;
    else if (o.tcs) t = `驱动力到了前轮抓地力的上限（约 ${f0(car.fTraction)} N），电脑在收油，不然车轮就要空转了。`;
    else if (o.cut) t = `松了油门：喷油量是 0。车轮通过钢带和锁止离合器倒拖着发动机转（${f0(o.te)} N·m），这就是发动机制动。转速掉到 ${S.cut_off} rpm 以下才恢复喷油。`;
    else if (o.lock < .05 && o.pedal <= .005 && av < 12) t = `蠕行：没踩油门，变矩器传过来的那点扭矩推着车慢慢走。泵轮 ${f0(o.n)} rpm，涡轮 ${f0(o.nTurbine)} rpm。`;
    else if (o.lock < .5 && o.tr > 1.03) t = `起步：涡轮（${f0(o.nTurbine)} rpm）比泵轮（${f0(o.n)} rpm）慢，变矩器把扭矩放大到 ${f2(o.tr)} 倍。车速上来以后这个倍数会掉回 1。`;
    else if (o.lock > .02 && o.lock < .95) t = '锁止离合器正在压紧：发动机转速被拉到和主动轮一样，之后就不再靠油传力，不白白发热。';
    else if (o.ratio > car.ratioLow - .01 && o.pedal > .02) t = `速比还在最低挡 ${f2(car.ratioLow)}：车速不够，主动轮转速还没到目标（${f0(o.nTarget)} rpm），转速跟着车速一起涨。`;
    else if (o.ratio < car.ratioHigh + .004 && o.pedal > .02) t = `速比已经到最高挡 ${f2(car.ratioHigh)}，没法再高了：从这儿起车再快，转速就得跟着涨。`;
    else if (o.a > .15 && Math.abs(dnFilt) < 120) t = `定着油门加速：转速停在 ${f0(o.n / 10) * 10} rpm 附近不动，车越来越快，全靠速比在变（现在 ${f2(o.ratio)}）。有挡位的变速箱做不到这一点。`;
    else if (o.a < -.15) t = `在减速：速比往低挡回（现在 ${f2(o.ratio)}），给下一次加速做准备。`;
    else if (o.a > .15) t = `踩深了：电脑把目标转速提到 ${f0(o.nTarget)} rpm，速比往低挡退，转速先上去，力才跟上来。`;
    else t = `匀速：驱动力刚好抵掉风阻和滚阻。发动机 ${f0(o.n / 10) * 10} rpm，速比 ${f2(o.ratio)}。`;
    t = pre + t;
  }
  const hc = chips.map(([a, c]) => `<span class="chip ${c}">${a}</span>`).join('');
  if ($('chips').innerHTML !== hc) $('chips').innerHTML = hc;
  if ($('nowText').textContent !== t) $('nowText').textContent = t;
}

// ------------------------------------------------------------------ 画布
function fit(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  return [x, w, h];
}

function drawPulleys() {
  const [x, w, h] = fit($('pul'));
  if (w < 20) return;
  const Rs = C.sheave_r, a = C.centre, sc = Math.min((h - 30) / (2 * Rs), (w - 20) / (a + 2 * Rs));
  const cy = (h - 14) / 2, c0 = w / 2 - a / 2 * sc, c1 = w / 2 + a / 2 * sc;
  const r1 = stage.r1 * sc, r2 = stage.r2 * sc, ph = Math.asin((stage.r2 - stage.r1) / a);
  for (const [cx, ang] of [[c0, stage.ang.pri], [c1, stage.ang.sec]]) {
    x.beginPath(); x.arc(cx, cy, Rs * sc, 0, 7); x.fillStyle = '#1c232b'; x.fill(); x.strokeStyle = COL.line; x.lineWidth = 1; x.stroke();
    x.strokeStyle = '#3b4753'; x.lineWidth = 2; x.beginPath();
    for (let i = 0; i < 6; i++) { const t = ang + i * Math.PI / 3; x.moveTo(cx + 9 * Math.cos(t), cy + 9 * Math.sin(t)); x.lineTo(cx + (Rs * sc - 4) * Math.cos(t), cy + (Rs * sc - 4) * Math.sin(t)); }
    x.stroke();
    x.beginPath(); x.arc(cx, cy, 8, 0, 7); x.fillStyle = '#3b4753'; x.fill();
  }
  const path = () => {
    x.beginPath();
    x.moveTo(c0 - r1 * Math.sin(ph), cy - r1 * Math.cos(ph));
    x.lineTo(c1 - r2 * Math.sin(ph), cy - r2 * Math.cos(ph));
    x.arc(c1, cy, r2, -Math.PI / 2 - ph, Math.PI / 2 + ph);
    x.lineTo(c0 - r1 * Math.sin(ph), cy + r1 * Math.cos(ph));
    x.arc(c0, cy, r1, Math.PI / 2 + ph, Math.PI * 1.5 - ph);
    x.closePath();
  };
  x.lineJoin = 'round';
  path(); x.strokeStyle = '#aab3bc'; x.lineWidth = Math.max(4, C.belt_t * sc); x.stroke();
  const per = car.BELT * sc / 10;
  path(); x.setLineDash([5, per - 5]); x.lineDashOffset = -(stage.ang.belt * sc % per); x.strokeStyle = COL.needle; x.stroke(); x.setLineDash([]);
  x.fillStyle = COL.dim; x.font = '11px system-ui, sans-serif'; x.textAlign = 'center';
  x.fillText('主动轮：接发动机', c0, h - 5); x.fillText('从动轮：接车轮', c1, h - 5);
}

function drawVario() {
  const [x, w, h] = fit($('vario'));
  if (w < 20) return;
  const L = 40, R = 12, T = 10, Bm = 28, pw = w - L - R, ph = h - T - Bm, VX = 200, NY = 7000;
  const X = (v) => L + v / VX * pw, Y = (n) => T + ph - n / NY * ph, k = car.rpmPerKmh, lim = S.limit;
  x.font = '11px system-ui, sans-serif'; x.lineWidth = 1;
  x.strokeStyle = '#1e262e'; x.fillStyle = COL.dim; x.beginPath();
  for (let v = 0; v <= VX; v += 20) { x.moveTo(X(v), T); x.lineTo(X(v), T + ph); }
  for (let n = 0; n <= NY; n += 1000) { x.moveTo(L, Y(n)); x.lineTo(L + pw, Y(n)); }
  x.stroke();
  x.textAlign = 'center'; for (let v = 0; v <= VX; v += 40) x.fillText(v, X(v), T + ph + 14);
  x.textAlign = 'right'; for (let n = 0; n <= NY; n += 1000) x.fillText(n, L - 6, Y(n) + 4);
  x.textAlign = 'right'; x.fillText('车速 km/h', L + pw, h - 3);
  x.save(); x.beginPath(); x.rect(L, T, pw, ph); x.clip();
  // 假想的 5 挡手动：只能待在五条线上
  const km = 1 / 3.6 / car.rRoll * RPM * S.manual5_final;
  x.setLineDash([4, 4]); x.strokeStyle = '#4b5a69'; x.fillStyle = '#6d7d8c'; x.textAlign = 'left';
  S.manual5.forEach((g, i) => {
    const vEnd = Math.min(VX, lim / (km * g));
    x.beginPath(); x.moveTo(X(0), Y(0)); x.lineTo(X(vEnd), Y(vEnd * km * g)); x.stroke();
    x.fillText(i + 1, X(vEnd) - (vEnd >= VX ? 12 : -3), Y(vEnd * km * g) + (vEnd >= VX ? -5 : 12));
  });
  x.setLineDash([]);
  // CVT 够得着的范围
  const vL = lim / (k * car.ratioLow), vH = Math.min(VX, lim / (k * car.ratioHigh));
  x.beginPath(); x.moveTo(X(0), Y(0)); x.lineTo(X(vL), Y(lim)); x.lineTo(X(vH), Y(lim));
  if (vH >= VX) x.lineTo(X(VX), Y(VX * k * car.ratioHigh));
  x.closePath(); x.fillStyle = 'rgba(255,178,62,.09)'; x.fill();
  x.strokeStyle = COL.amber; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(X(0), Y(0)); x.lineTo(X(vL), Y(lim)); x.moveTo(X(0), Y(0)); x.lineTo(X(VX), Y(VX * k * car.ratioHigh)); x.stroke();
  x.fillStyle = COL.amber; x.textAlign = 'left'; x.fillText(`最低挡 ${f2(car.ratioLow)}`, X(vL) + 6, Y(lim) + 14);
  x.textAlign = 'right'; x.fillText(`最高挡 ${f2(car.ratioHigh)}`, X(VX) - 4, Y(VX * k * car.ratioHigh) + 15);
  x.strokeStyle = COL.bad; x.lineWidth = 1; x.setLineDash([2, 4]); x.beginPath(); x.moveTo(L, Y(lim)); x.lineTo(L + pw, Y(lim)); x.stroke(); x.setLineDash([]);
  // 走过的路
  const n = trace.v.length;
  if (n > 1) {
    x.lineWidth = 2; x.lineJoin = 'round';
    for (let b = 0; b < 4; b++) {
      const i0 = Math.floor(n * b / 4), i1 = Math.min(n - 1, Math.floor(n * (b + 1) / 4));
      x.strokeStyle = `rgba(255,90,46,${.18 + .22 * b})`; x.beginPath(); x.moveTo(X(trace.v[i0]), Y(trace.n[i0]));
      for (let i = i0 + 1; i <= i1; i++) x.lineTo(X(trace.v[i]), Y(trace.n[i]));
      x.stroke();
    }
  }
  const v = Math.abs(o.kmh), px = X(v), py = Y(o.n);
  if (o.dir && Math.abs(o.n - Math.abs(o.nPri)) > 40) {             // 变矩器在打滑：主动轮（涡轮）在发动机下面
    const qy = Y(Math.abs(o.nPri));
    x.strokeStyle = COL.dim; x.lineWidth = 1; x.beginPath(); x.moveTo(px, py); x.lineTo(px, qy); x.stroke();
    x.beginPath(); x.arc(px, qy, 4, 0, 7); x.strokeStyle = COL.ink; x.lineWidth = 1.5; x.stroke();
  }
  x.beginPath(); x.arc(px, py, 5.5, 0, 7); x.fillStyle = COL.needle; x.fill(); x.strokeStyle = '#0d1014'; x.lineWidth = 1.5; x.stroke();
  x.restore();
  if (o.dir) { const ty = Y(o.nTarget); x.fillStyle = COL.amber; x.beginPath(); x.moveTo(L, ty); x.lineTo(L - 6, ty - 4); x.lineTo(L - 6, ty + 4); x.fill(); }
}

const ESEG_C = [['wheel', '到车轮', COL.ok], ['cvt', '钢带和齿轮的损失', '#7f93a8'], ['tc', '变矩器发热', COL.warn], ['eng', '发动机摩擦、泵气、附件', '#b9805c'], ['heat', '排气和冷却带走', '#6b4743']];
const ESEG_E = [['wheel', '到车轮', COL.ok], ['chg', '存进电池', COL.info], ['drv', '电机、逆变器、齿轮的损耗', '#7f93a8'], ['heat', '发动机变成热的那部分', '#6b4743']];
let ESEG = ESEG_C;
function energyLayout() {
  ESEG = PT === 'ehev' ? ESEG_E : ESEG_C;
  $('eTitle').textContent = PT === 'ehev' ? '油和电池出的功率去哪了' : '油烧出来的功率去哪了';
  $('ebar').innerHTML = ESEG.map(([id, , c]) => `<i id="e_${id}" style="background:${c};flex:0 1 0"></i>`).join('');
  $('elegend').innerHTML = ESEG.map(([id, k, c]) => `<div><span class="key" style="background:${c}"></span>${k}<span class="num" id="el_${id}"></span></div>`).join('');
}
energyLayout();
/** 混动的功率账：进来的 = 油 + 电池放的电；出去的 = 到车轮 + 存进电池 + 损耗 + 发动机的热 */
function energyE() {
  const pf = o.pFuel, dis = Math.max(hs.Pbat, 0), chg = Math.max(-hs.Pbat, 0), inp = pf + dis + Math.max(-hs.Pw, 0);
  if (inp < 50) {
    $('etotal').innerHTML = '现在既不烧油也不用电。';
    for (const [id] of ESEG) { $(`e_${id}`).style.flexGrow = 0; $(`el_${id}`).textContent = '0'; }
    return;
  }
  const wheel = Math.max(hs.Pw, 0), heat = pf > 0 ? Math.max(pf - hs.Pe, 0) : 0, drv = Math.max(inp - wheel - chg - heat, 0);
  const val = { wheel, chg, drv, heat };
  $('etotal').innerHTML = hs.Pw < -200 ? `车轮往回送 <b>${f1(-hs.Pw / 1000)}</b> kW，其中 <b>${f0(chg / -hs.Pw * 100)}%</b> 存进了电池`
    : pf < 1 ? `没烧油：电池每秒放出 <b>${f1(dis / 1000)}</b> kW，其中 <b>${f0(wheel / inp * 100)}%</b> 到了车轮`
      : `油每秒放出 <b>${f1(pf / 1000)}</b> kW 的热${dis > 200 ? `，电池另出 <b>${f1(dis / 1000)}</b> kW` : ''}，其中 <b>${f0(wheel / inp * 100)}%</b> 到了车轮`;
  for (const [id] of ESEG) { $(`e_${id}`).style.flexGrow = Math.max(0, val[id]); $(`el_${id}`).textContent = `${f1(val[id] / 1000)} kW`; }
  $('socFill').style.width = `${f0(hs.soc * 100)}%`; $('socTxt').textContent = `${f0(hs.soc * 100)}%`;
  $('hE').textContent = hs.eng ? f1(hs.Pe / 1000) : '0'; $('hB').textContent = `${hs.Pbat < -150 ? '充 ' : hs.Pbat > 150 ? '放 ' : ''}${f1(Math.abs(hs.Pbat) / 1000)}`;
  $('hM').textContent = f1(hs.Pmot / 1000);
}
function energy() {
  if (PT === 'ehev') return energyE();
  const pf = o.pFuel;
  if (pf < 1) {
    $('etotal').innerHTML = '断油了：喷油量是 0，现在是车的动能在带着发动机转。';
    for (const [id] of ESEG) { $(`e_${id}`).style.flexGrow = 0; $(`el_${id}`).textContent = '0'; }
    return;
  }
  const wheel = Math.max(0, o.pWheel), cvt = Math.max(0, o.pIn - o.pWheel), heat = pf - o.pInd;
  const eng = Math.max(0, pf - heat - o.pTcLoss - cvt - wheel);            // 剩下的：摩擦、泵气、附件，还有让曲轴自己加速的那部分
  const val = { wheel, cvt, tc: o.pTcLoss, eng, heat };
  $('etotal').innerHTML = `现在烧的油每秒放出 <b>${f1(pf / 1000)}</b> kW 的热，其中 <b>${f0(wheel / pf * 100)}%</b> 到了车轮`;
  for (const [id] of ESEG) { $(`e_${id}`).style.flexGrow = Math.max(0, val[id]); $(`el_${id}`).textContent = `${f1(val[id] / 1000)} kW`; }
}

// ------------------------------------------------------------------ 车里的仪表盘和挡位面板：画在三维模型的表面上
const NUMF = css('--num') || 'sans-serif';
function cDial(x, cx, cy, R, { max, major, minor, every = major, label, red, unit }, val) {
  const a0 = 210, sweep = 240;                         // 从左下 210° 顺时针扫到右下 −30°
  const ang = (v) => (a0 - sweep * Math.min(Math.max(v, 0), max) / max) * Math.PI / 180;
  const P_ = (v, r) => [cx + r * Math.cos(ang(v)), cy - r * Math.sin(ang(v))];
  x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fillStyle = '#0c0f12'; x.fill();
  x.lineWidth = R * .025; x.strokeStyle = '#2b333b'; x.stroke();
  if (red) { x.beginPath(); x.arc(cx, cy, R * .9, -ang(red[0]), -ang(red[1])); x.strokeStyle = '#e0412b'; x.lineWidth = R * .09; x.stroke(); }
  for (let v = 0; v <= max + 1e-6; v += minor) {
    const big = Math.abs(v / major - Math.round(v / major)) < 1e-6, [x0, y0] = P_(v, R * .95), [x1, y1] = P_(v, R * (big ? .78 : .86));
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.strokeStyle = big ? '#f4efe4' : '#9aa3ab'; x.lineWidth = R * (big ? .04 : .022); x.stroke();
    if (big && Math.abs(v / every - Math.round(v / every)) < 1e-6) { const [tx, ty] = P_(v, R * .6); x.fillStyle = '#f4efe4'; x.font = `600 ${R * .19}px ${NUMF}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label(v), tx, ty); }
  }
  x.fillStyle = '#9aa3ab'; x.font = `${R * .12}px system-ui, sans-serif`; x.textAlign = 'center'; x.fillText(unit, cx, cy + R * .42);
  const [nx, ny] = P_(val, R * .9), [bx, by] = P_(val, -R * .16);
  x.save(); x.shadowColor = 'rgba(255,90,46,.8)'; x.shadowBlur = R * .08;
  x.beginPath(); x.moveTo(bx, by); x.lineTo(nx, ny); x.strokeStyle = '#ff5a2e'; x.lineWidth = R * .05; x.lineCap = 'round'; x.stroke(); x.restore();
  x.beginPath(); x.arc(cx, cy, R * .09, 0, 7); x.fillStyle = '#1d232a'; x.fill();
}
const TACH = { max: 7, major: 1, minor: .5, label: (v) => v, red: [S.limit / 1000, 7], unit: '×1000 r/min' };
const SPEEDO = { max: 200, major: 20, minor: 10, every: 40, label: (v) => v, unit: 'km/h' };   // 表盘小，数字每 40 标一个，不然挤在一起
function drawCluster() {
  const { ctx: x, canvas: c, tex } = stage.cluster, W = c.width, Hh = c.height, k = W / CK.cluster.w;
  x.fillStyle = '#050607'; x.fillRect(0, 0, W, Hh);
  const R = 52 * k, cy = Hh / 2;
  cDial(x, W / 2 - 90 * k, cy, R, TACH, o.n / 1000);
  cDial(x, W / 2 + 90 * k, cy, R, SPEEDO, Math.abs(o.kmh));
  // 中间一条：挡位（亮的是现在这个挡）和这一趟的里程
  x.textAlign = 'center'; x.textBaseline = 'middle';
  ['P', 'R', 'N', 'D'].forEach((g, i) => {
    const on = g === s.gear;
    x.font = `700 ${12 * k}px ${NUMF}`; x.fillStyle = on ? '#ffb23e' : '#3a434c';
    if (on) { x.shadowColor = 'rgba(255,178,62,.9)'; x.shadowBlur = 3 * k; }
    x.fillText(g, W / 2, cy - 33 * k + i * 15 * k); x.shadowBlur = 0;
  });
  x.fillStyle = '#10161b'; x.fillRect(W / 2 - 17 * k, cy + 28 * k, 34 * k, 13 * k);
  x.fillStyle = '#9fd3a8'; x.font = `600 ${7.5 * k}px ${NUMF}`; x.fillText((s.dist / 1000).toFixed(2), W / 2, cy + 35 * k);
  x.fillStyle = '#6c757e'; x.font = `${4.6 * k}px system-ui, sans-serif`; x.fillText('TRIP km', W / 2, cy + 47 * k);
  if (PT === 'ehev') {                        // 混动：发动机熄火、车还能走的时候亮一个绿色的 EV
    x.font = `700 ${8 * k}px ${NUMF}`; x.fillStyle = !hs.eng && s.gear !== 'P' ? '#58e0a0' : '#27313a';
    x.fillText('EV', W / 2 - 90 * k, cy + 30 * k);
  }
  tex.needsUpdate = true;
}
let gateDrawn = '';
function drawGate() {
  if (gateDrawn === s.gear) return;
  gateDrawn = s.gear;
  const { ctx: x, canvas: c, tex } = stage.gatePlate, k = c.height / CK.gate.h;
  x.clearRect(0, 0, c.width, c.height); x.textAlign = 'center'; x.textBaseline = 'middle';
  for (const [g, at] of Object.entries(CK.gate.at)) {
    const on = g === s.gear;
    x.font = `700 ${12 * k}px ${NUMF}`; x.fillStyle = on ? '#ffb23e' : '#6f7880';
    x.shadowColor = on ? 'rgba(255,178,62,.9)' : 'transparent'; x.shadowBlur = on ? 4 * k : 0;
    x.fillText(g, c.width / 2, c.height / 2 - at * k);
  }
  tex.needsUpdate = true;
}

// ------------------------------------------------------------------ 点零件
const order = Object.fromEntries(E.firing.map((c, k) => [String(c), k]));
const cyc = (c) => stage.ang.crank * 180 / Math.PI - 180 * order[c];
const rpm = (x) => `${f0(Math.abs(x))} rpm`;
const WHEEL = { FL: '左前', FR: '右前', RL: '左后', RR: '右后' };
const PARTS = [
  [/^Eng_Crank$/, () => '曲轴', () => `${rpm(o.n)}。活塞的上下运动靠它变成转动；左端的挠性盘接变矩器。`],
  [/^Eng_Piston(\d)$/, (m) => `${m[1]} 缸活塞`, (m) => `现在是${stroke(cyc(m[1]))}冲程。点火顺序 ${E.firing.join('-')}。`],
  [/^Eng_Rod(\d)$/, (m) => `${m[1]} 缸连杆`, () => '把活塞和曲轴连起来。'],
  [/^Eng_Cam(In|Ex)$/, (m) => `${m[1] === 'In' ? '进气' : '排气'}凸轮轴`, () => `${rpm(o.n / 2)}，是曲轴的一半：曲轴转两圈，每个气门开一次。`],
  [/^Eng_Valve(In|Ex)(\d)$/, (m) => `${m[2]} 缸${m[1] === 'In' ? '进' : '排'}气门`, (m) => (valveLift(m[1].toLowerCase(), cyc(m[2])) > .03 ? '现在开着。' : '现在关着。')],
  [/^Eng_Chain$/, () => '正时链条', () => '曲轴带着两根凸轮轴转，凸轮轴链轮的齿数是曲轴链轮的两倍。'],
  [/^Eng_Block$/, () => '缸体和油底壳', () => '四个缸孔在里面。切到“内部”能看到活塞和曲轴。'],
  [/^Eng_Head$/, () => '缸盖和气门室盖', () => '气门和凸轮轴装在里面，上面四个是点火线圈。'],
  [/^Eng_Intake$/, () => '进气歧管和节气门', () => `把空气分给四个缸。现在的负荷是 ${f0(o.lam * 100)}%。`],
  [/^Eng_Exhaust$/, () => '排气歧管', () => '四个缸的废气在这里汇到一起。'],
  [/^Eng_Acc$/, () => '发动机附件', () => '发电机、空调压缩机这些，由曲轴皮带轮带着转。'],
  [/^Cvt_Case$/, () => '变速箱壳体', () => '变矩器、两个锥轮、钢带和主减速都在里面。切到“内部”看。'],
  [/^Cvt_Impeller$/, () => '变矩器外壳和泵轮', () => `跟曲轴一起转，${rpm(o.n)}，把油甩向涡轮。`],
  [/^Cvt_Turbine$/, () => '涡轮', () => `${rpm(o.nTurbine)}。被泵轮甩过来的油冲着转；${o.lock > .95 ? '现在锁止离合器把它和外壳压在了一起。' : `现在比泵轮慢 ${f0(clamp(1 - o.sr, 0, 1) * 100)}%。`}`],
  [/^Cvt_FwdRev$/, () => '前进 / 倒挡切换机构', () => '一组行星齿轮加离合器。N 和 P 挡时把涡轮和主动轮断开，R 挡时把转向反过来。'],
  [/^Cvt_PriFixed$/, () => '主动轮的固定锥盘', () => `${rpm(o.nPri)}。`],
  [/^Cvt_PriMove$/, () => '主动轮的可动锥盘', () => `油压推着它靠近固定盘，钢带就被挤到更大的半径上。现在半径 ${f0(stage.r1)} mm。`],
  [/^Cvt_SecFixed$/, () => '从动轮的固定锥盘', () => `${rpm(o.nSec)}。`],
  [/^Cvt_SecMove$/, () => '从动轮的可动锥盘', () => `它让开，钢带就落到小半径上。现在半径 ${f0(stage.r2)} mm。`],
  [/^Cvt_Belt$/, () => '钢带', () => `线速度 ${f1(Math.abs(o.wPri) * stage.r1 / 1000)} m/s。它的长度不变，所以一头半径变大，另一头就得变小。`],
  [/^Cvt_OutGear$/, () => '输出齿轮', () => `和从动轮同轴，${rpm(o.nSec)}。`],
  [/^Cvt_Idler$/, () => '中间轴', () => `两级减速中间的那根，${rpm(o.nSec * C.z_out / C.z_idler)}。`],
  [/^Cvt_Diff$/, () => '主减速齿圈和差速器', () => `${rpm(o.nSec / car.final)}，和车轮一样。从从动轮到这里一共减速 ${f2(car.final)} 倍。`],
  [/^Drv_Shaft(L|R)$/, (m) => `${m[1] === 'L' ? '左' : '右'}半轴`, () => `把差速器的转动传给前轮，${rpm(o.nSec / car.final)}。`],
  [/^PT_Mounts$/, () => '悬置', () => '把发动机和变速箱挂在车身上的橡胶垫。'],
  [/^Bay_Cooling$/, () => '水箱、冷凝器和水管', () => '这一版没有模拟水温。'],
  [/^Bay_Fan$/, () => '散热风扇', () => '这一版没有模拟水温，所以它不转。'],
  [/^Bay_Intake$/, () => '空气滤清器、进气管和电瓶', () => ''],
  [/^Exh_Pipe$/, () => '排气管和消声器', () => ''],
  [/^Fuel_Tank$/, () => '油箱', () => `这一趟已经用了 ${f0(s.fuel / S.rho_fuel * 1000)} mL。`],
  [/^Wheel_(FL|FR|RL|RR)$/, (m) => `${WHEEL[m[1]]}车轮`, (m) => `${rpm(o.nSec / car.final)}。${m[1][0] === 'F' ? '前轮是驱动轮。' : '后轮只是跟着转。'}`],
  [/^Brake_/, () => '制动盘和卡钳', () => ''],
  [/^Panel_Hood$/, () => '前盖', () => '在“整车”里点右下角的“开前盖”。'],
  [/^SteeringWheel$/, () => '方向盘', () => '转向还没做，现在它只是摆着。转轴已经装在转向管柱的中心线上，下一步做转向时它会跟着打。'],
  [/^SteeringColumn$/, () => '转向管柱护罩和拨杆', () => '两根拨杆一根管转向灯和大灯、一根管雨刮。方向盘转的时候它不动。'],
  [/^Shifter$/, () => '挡杆', () => `现在在 ${s.gear} 挡。从前往后是 P、R、N、D。车在动的时候挂不进 P，也不能直接从前进换到倒车。`],
  [/^Pedal_Acc$/, () => '油门踏板', () => `踩下 ${f0(o.pedal * 100)}%（踩到底绕铰链转 ${P.cockpit.acc_travel}°）。这台车的油门不直接拉节气门：踩多深代表想要多少功率，电脑再去定节气门和速比。`],
  [/^Pedal_Brake$/, () => '刹车踏板', () => `踩下 ${f0(o.brake * 100)}%（踩到底绕铰链转 ${P.cockpit.brake_travel}°），踩到底大约 ${f1(V.brake_g)} g 的减速度。自动挡没有离合，所以刹车踏板做得宽。`],
  [/^Pedal_Box$/, () => '踏板支架', () => '挂在前围板上，两个踏板的铰链都在它上面。'],
  [/^Dash_Cluster$/, () => '仪表', () => `左边转速表，右边车速表，中间是挡位和这一趟的里程。位置是按视线定的：从驾驶员的眼睛看过去，正好从方向盘轮圈和气囊盖之间那道缝里露出来。`],
  [/^Dash$/, () => '仪表台', () => '中间凸出来的是中控台：两个出风口、收音机、三个空调旋钮（风量、温度、出风位置）。这一版只是摆设。'],
  [/^Console$/, () => '中央通道', () => '挡位面板、两个杯架、扶手箱。挡位面板上亮的字母是现在的挡。'],
];
let tipName = '', tipT = 0;
function tipText() {
  if (tipName.startsWith('H_')) { const g = specE.groups[specE.objects[tipName]]; return g ? `<b>${g.cn}</b>　${g.desc}` : '<b>混动动力总成</b>'; }
  for (const [re, name, info] of PARTS) { const m = tipName.match(re); if (m) return `<b>${name(m)}</b>　${info(m)}`; }
  const g = spec.groups[spec.objects[tipName]];
  return `<b>${g ? g.cn : '车身'}</b>`;
}
function showTip(name) { tipName = name; tipT = name ? 8 : 0; const el = $('tip'); el.hidden = !name; if (name) el.innerHTML = tipText(); }

// ------------------------------------------------------------------ 操作
const slider = (id, key) => {
  const el = $(id), out = $(`${id}Out`);
  const show = () => { el.style.setProperty('--p', `${el.value}%`); out.textContent = `${el.value}%`; };
  el.addEventListener('input', () => { set[key] = el.value / 100; show(); });
  return (v) => { el.value = Math.round(v * 100); set[key] = v; show(); };
};
const setThr = slider('thr', 'pedal'), setBrk = slider('brk', 'brake');
function setGear(g) {
  if (PT === 'ehev' && g === 'R') { toast = '混动这套还没做倒车。真车倒车就是驱动电机反着转，里面没有倒挡齿轮。'; toastT = 3; return false; }
  const why = car.shift(s, g);
  if (why) { toast = why; toastT = 2.5; }
  document.querySelectorAll('#gears button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.gear === s.gear));
  return !why;
}
document.querySelectorAll('#gears button').forEach((b) => b.addEventListener('click', () => setGear(b.dataset.gear)));
$('grade').addEventListener('change', (e) => { set.grade = +e.target.value; });
function reset() {
  s = car.initial(); o = car.step(s, { pedal: 0, brake: 0 }, H);
  hs = HY.makeDrive();
  if (PT === 'ehev') stepE(H);
  setThr(0); setBrk(0); set.grade = 0; $('grade').value = '0'; act.pedal = act.brake = act.grade = 0;
  trace.v.length = trace.n.length = 0; timer.armed = true; timer.t0 = -1; timer.last = 0;
  setGear('P');
}
$('reset').addEventListener('click', reset);

const TRY_E = [
  ['轻踩 20% 起步', '发动机不响，电池带着电机走', () => { setGear('D'); setBrk(0); setThr(.2); }],
  ['踩到 60%', '发动机起动，但它只发电，推车的还是电机', () => { setGear('D'); setBrk(0); setThr(.6); }],
  ['地板油', '发电机和电池一起供电，自动记 0→100', () => { setGear('D'); setBrk(0); setThr(1); }],
  ['松油门', '电机反过来发电，电往电池里流', () => { setThr(0); setBrk(0); }],
  ['轻踩刹车 20%', '大部分减速还是靠电机回收', () => { setThr(0); setBrk(.2); }],
  ['到 100 km/h 后保持', '油门收到 15% 左右稳住，等离合器合上', () => { setGear('D'); setBrk(0); setThr(.16); }],
];
const TRY_C = [
  ['松刹车，不踩油门', '车自己慢慢走，这是变矩器的蠕行', () => { setGear('D'); setThr(0); setBrk(0); }],
  ['轻踩 25% 起步', '变矩器先放大扭矩，18 km/h 后锁止', () => { setGear('D'); setBrk(0); setThr(.25); }],
  ['40% 油门一直踩着', '转速不动、车在加速，盯着速比看', () => { setGear('D'); setBrk(0); setThr(.4); }],
  ['地板油', '转速顶到最大功率点，自动记 0→100', () => { setGear('D'); setBrk(0); setThr(1); }],
  ['松油门滑行', '喷油量变成 0，发动机在拖车', () => { setThr(0); setBrk(0); }],
  ['失速试验', '刹车踩死加地板油，看变矩器发多少热', () => { setGear('D'); setBrk(1); setThr(1); }],
];
let TRY = TRY_C;
function tryLayout() { TRY = PT === 'ehev' ? TRY_E : TRY_C; $('try').innerHTML = TRY.map(([b, t], i) => `<button data-i="${i}"><b>${b}</b><span>${t}</span></button>`).join(''); }
tryLayout();
$('try').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) TRY[+b.dataset.i][2](); });

const KEY = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ' ': 'down' };
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === 'SELECT') return;
  const k = KEY[e.key];
  if (k) {
    keys[k] = true; e.preventDefault();
    const f = document.activeElement;                      // 焦点还在滑块或按钮上的话，方向键和空格会被它们吃掉
    if (f && f !== document.body && f.blur) f.blur();
    return;
  }
  const g = e.key.toUpperCase();
  if ('PRND'.includes(g) && g.length === 1) setGear(g);
});
window.addEventListener('keyup', (e) => {
  const k = KEY[e.key];
  if (!k) return;
  keys[k] = false;
  if (k === 'up') setThr(0); else setBrk(0);            // 键盘踩的：松手就回位
});
window.addEventListener('blur', () => { keys.up = keys.down = false; });

function setMode(m) {
  stage.setMode(m);
  document.querySelectorAll('#modes button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === m));
  const drive = m === 'drive';
  $('hood').hidden = m !== 'car'; $('camEng').hidden = $('camCvt').hidden = m === 'car' || drive;
  for (const id of ['camAhead', 'camGauge', 'camFeet']) $(id).hidden = !drive;
  $('slowWrap').hidden = drive;                          // 坐在车里一切都是真实速度
  showTip('');
}
document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('hood').addEventListener('click', () => { const on = $('hood').getAttribute('aria-pressed') !== 'true'; $('hood').setAttribute('aria-pressed', on); $('hood').textContent = on ? '关前盖' : '开前盖'; stage.setHood(on); });
$('camEng').addEventListener('click', () => stage.lookAt('engine'));
$('camCvt').addEventListener('click', () => stage.lookAt('cvt'));
$('camAhead').addEventListener('click', () => stage.lookAt('drive'));
$('camGauge').addEventListener('click', () => stage.lookAt('gauges'));
$('camFeet').addEventListener('click', () => stage.lookAt('feet'));
$('slow').addEventListener('change', (e) => { slow = +e.target.value; });
{
  let down = null;
  const cv = $('gl');
  cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener('pointerup', (e) => {
    if (!down || !stage) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 500) showTip(stage.pick(e.clientX, e.clientY));
    down = null;
  });
}

// ------------------------------------------------------------------ 静态文字
const SUB = { cvt: `${f1(car.disp / 1000)} L 四缸汽油机 + 液力变矩器 + 钢带 CVT，前轮驱动。数字都是虚构的教学设定。`,
  ehev: '1.5 L 阿特金森发动机 + 发电机 + 驱动电机 + 一个离合器，前轮驱动。动力的参数按飞度 e:HEV 的官方数字，车还是这辆。' };
$('hNote').innerHTML = '车轮永远由驱动电机带着。发动机大部分时间只发电；匀速跑到 60 多 km/h 以上，电脑才把离合器合上让发动机直接推车。电池只有 1 度电左右，是个缓冲。每一步为什么这么选，<a href="../飞度混动原理/index.html" target="_blank" rel="noopener">飞度混动原理</a> 那一页分八章讲。';
$('pulNote').textContent = `钢带长 ${f0(car.BELT)} mm 不变，两根轴隔 ${C.centre} mm。主动轮的两片锥盘夹紧，钢带被挤到大半径上；从动轮同时让开，钢带落到小半径上。速比 = 从动轮半径 ÷ 主动轮半径，能从 ${f2(car.ratioLow)} 一直滑到 ${f2(car.ratioHigh)}，中间没有台阶。`;
$('varioNote').innerHTML = `橙点是发动机现在的转速和车速，拖着的线是刚才走过的路。两条琥珀色的线之间是 CVT 够得着的范围，左边的小三角是电脑想要的转速。虚线是一台假想的 5 挡手动：它只能待在五条线上，加速时转速得一遍遍从低爬到高。空心圈是主动轮的转速，它和橙点分开时说明变矩器在打滑。`;
function factsE(r) {
  const cells = [
    ['发动机', '78', 'kW'], ['驱动电机', '90', 'kW'], ['电机最大扭矩', '253', 'N·m'],
    ['电机 → 车轮', f2(HY.CAR.Gm), ''], ['发动机 → 车轮', f2(HY.CAR.Ge), ''], ['车重（含驾驶员）', f0(V.mass), 'kg'],
    ['0→100 km/h', r ? f1(r.t100) : '…', 's'], ['电池', '1.0', 'kWh'], ['100 km/h 匀速', r ? f1(r.c100) : '…', 'L/100km'],
  ];
  $('spec').innerHTML = cells.map(([k, v, u]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div></div>`).join('');
  const li = [
    ['t1', '资料', '发动机 78 kW / 127 N·m、驱动电机 90 kW / 253 N·m、电机行驶 2.454、发动机行驶 0.805、减速比 3.423，是本田飞度 e:HEV 诸元表上的数字。'],
    ['t1', '资料', '结构照公开资料建：发电机和驱动电机同轴，发电机的细轴从驱动电机的空心轴里穿过去；驱动电机靠发动机、发电机在最外面；绕组是扁铜线；PCU 直接坐在电机壳上。'],
    ['t2', '设定', `车还是这辆三厢车：${f0(V.mass)} kg、风阻面积 ${f2(V.cd * V.area)} m²，比飞度重、风阻大，所以油耗和“多少车速开始直驱”都和真飞度不一样。电池立在后排靠背后面，两根橙色高压线从地板下面走。`],
    ['t2', '设定', '各根轴的位置、齿数（按官方速比凑的）、发电机那一对齿轮的 2 倍、电机的槽数和极数没有公开数据，是示意。'],
    ['t3', '估算', '发动机的效率图、电机和逆变器的损耗、电池 1.0 kWh、选模式的规则，都是“飞度混动原理”那一页的模型：量级对，具体数字不是本田的标定。100 km/h 的油耗是跑一长段取的平均，电池电量的起止差没有折算。'],
    ['', '没算', '倒车、蠕行、冷车暖机、暖风、电池温度、轮胎打滑。能量流只在“透视 / 动力总成 / 内部”三种看法里画。'],
  ];
  $('facts').innerHTML = li.map(([c, t, x]) => `<li><span class="tag ${c}">${t}</span>${x}</li>`).join('');
}
function headlineE() {
  const q = HY.makeDrive();
  let t = 0;
  while (q.v * 3.6 < 100 && t < 60) { HY.driveStep(q, { pedal: 1, brake: 0, cruise: null, grade: 0 }, 1 / 60); t += 1 / 60; }
  const c = HY.makeDrive(); c.v = 100 / 3.6;
  let d0 = 0, g0 = 0;
  for (let i = 0; i < 30000; i++) { HY.driveStep(c, { pedal: 0, brake: 0, cruise: 100, grade: 0 }, .05); if (i === 6000) { d0 = c.distM; g0 = c.fuelG; } }
  factsE({ t100: t, c100: (c.fuelG - g0) / (HY.ENG.rhoF * 1000) / (c.distM - d0) * 1e5 });
}
function facts(r) {
  const tk = car.tqWot(4200), cells = [
    ['排量', `${f0(car.disp)}`, 'cc'], ['最大功率', `${f0(S.p_max_kw)}`, 'kW'], ['最大扭矩', `${f0(tk)}`, 'N·m'],
    ['速比范围', `${f2(car.ratioLow)}–${f2(car.ratioHigh)}`, ''], ['主减速比', f2(car.final), ''], ['车重（含驾驶员）', f0(V.mass), 'kg'],
    ['0→100 km/h', r ? f1(r.t100) : '…', 's'], ['极速', r ? f0(r.vmax) : '…', 'km/h'], ['100 km/h 匀速', r ? f1(r.c100) : '…', 'L/100km'],
  ];
  $('spec').innerHTML = cells.map(([k, v, u]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div></div>`).join('');
  const li = [
    ['t1', '公认', `钢带长度不变，所以一个轮上的半径变大，另一个就得变小；速比等于从动轮半径除以主动轮半径。`],
    ['t1', '公认', `活塞高度和连杆摆角按曲柄连杆的几何算。四冲程一个循环是曲轴转 720°，点火顺序 ${E.firing.join('-')}，凸轮轴转速是曲轴的一半。`],
    ['t1', '公认', `变矩器传的扭矩和泵轮转速的平方成正比；涡轮越接近泵轮的转速，传的扭矩越小，放大倍数越接近 1。`],
    ['t2', '设定', `发动机、变速箱和整车的参数都是虚构的，按 1.5 L 自然吸气家用车常见的范围取，不对应哪一款真车。全部写在 params.json 里，三维模型和这页的计算读的是同一份。`],
    ['t2', '设定', `踏板踩多深代表想要多少功率。变速箱电脑按这个功率挑一个转速（负荷高、转速低的省油点），再调速比让主动轮待在那个转速上。真车的标定比这复杂得多。`],
    ['t2', '设定', `变矩器失速时把扭矩放大 ${S.tc_stall_ratio} 倍；车速过 ${S.lock_on_kmh} km/h 锁止离合器压紧，低于 ${S.lock_off_kmh} km/h 松开。`],
    ['t3', '估算', `油耗 = 缸内做的功 ÷ ${f0(S.eta_ind * 100)}% ÷ 汽油热值。摩擦和泵气损失按转速的直线估，算出来最好的有效热效率约 35%。`],
    ['t3', '估算', `钢带这一段的效率固定取 ${f0(S.eta_cvt * 100)}%、主减速 ${f0(S.eta_final * 100)}%。真的会随速比和扭矩变。上面三个性能数字是这套设定算出来的结果。`],
    ['t2', '设定', `驾驶员坐左边，眼点在 H 点后 ${-P.cockpit.eye_offset[0]} mm、上 ${P.cockpit.eye_offset[1]} mm。从这里往前看，车头前面约 ${f1(CK.blind.ahead_of_nose / 1000)} m 以内的地面被前盖挡住。仪表的高度按视线算：要从方向盘轮圈和气囊盖之间那道缝里露出来。`],
    ['', '没算', `轮胎打滑（只把驱动力封顶在前轮抓地力上）、冷车、水温和风扇、钢带打滑、转向和悬架（方向盘还不能打）。坡度只算了重力的分力，画面不会倾斜，车身也不会因为加速、刹车前后点头。`],
  ];
  $('facts').innerHTML = li.map(([c, t, x]) => `<li><span class="tag ${c}">${t}</span>${x}</li>`).join('');
}
facts(null);
function headline() {
  const wot = run(car, () => ({ pedal: 1, gear: 'D' }), 90, 1 / 120).log;
  const cruise = () => { const q = car.initial(); q.gear = 'D'; q.v = 100 / 3.6; q.lock = 1; q.lockOn = true; q.ratio = car.ratioHigh; q.we = 100 * car.rpmPerKmh * car.ratioHigh / RPM; return q; };
  let a = 0, b = 1, x;
  for (let i = 0; i < 12; i++) { const m = (a + b) / 2; x = run(car, () => ({ pedal: m }), 40, 1 / 120, cruise()).log.at(-1); if (x.kmh < 100) a = m; else b = m; }
  facts({ t100: wot.find((q) => q.kmh >= 100).t, vmax: wot.at(-1).kmh, c100: x.lph / x.kmh * 100 });
}

// ------------------------------------------------------------------ 混动：走一步，把结果摆成和燃油版差不多的样子（表盘、三维、计时共用）
function stepE(dt) {
  const g = s.gear, v0 = hs.v;
  HY.driveStep(hs, { pedal: g === 'D' ? act.pedal : 0, brake: g === 'P' ? 1 : act.brake, cruise: null, grade: act.grade }, dt);
  s.v = hs.v; s.t += dt; s.dist += hs.v * dt; s.fuel += hs.fuelGs / 1000 * dt;
  o = { n: hs.nE, nTarget: hs.nE, kmh: hs.v * 3.6, a: (hs.v - v0) / dt, pedal: act.pedal, brake: act.brake, dir: g === 'D' ? 1 : 0,
    lph: hs.fuelGs / 1000 * 3600 / S.rho_fuel, pFuel: hs.fuelGs / 1000 * HY.ENG.LHV, fDrive: hs.Fw, fRes: hs.Fres, eng: hs.eng, clutch: hs.clutch };
}
/** 给三维的能量流（kW）。燃油版只有油、废气、半轴和热；混动多了直流、交流和三条机械路 */
function flows() {
  const k = 1e-3;
  if (PT !== 'ehev') {
    return [{ fuel: o.pFuel * k, exhaust: Math.max(o.pFuel - o.pShaft, 0) * k * .45, axle_L: o.pWheel * k / 2, axle_R: o.pWheel * k / 2, force: o.fDrive,
      heat_eng: Math.max(o.pFuel - o.pShaft, 0) * k, heat_drive: Math.max(o.pTcLoss + (o.pIn - o.pWheel), 0) * k }, null];
  }
  const dir = hs.clutch === 'locked', genMech = dir ? (hs.Pgen > 150 ? hs.Pgen / .9 : 0) : hs.eng ? hs.Pe : 0, toCl = dir ? Math.max(hs.Pe - genMech, 0) : 0;
  const pf = o.pFuel, heat = pf > 0 ? Math.max(pf - hs.Pe, 0) : 0;
  const f = { fuel: pf * k, exhaust: heat * k * .45, batt_pcu: hs.Pbat * k, gen_pcu: Math.abs(hs.Pgen) > 400 ? hs.Pgen * k : 0, pcu_mot: hs.Pmot * k,
    axle_L: hs.Pw * k / 2, axle_R: hs.Pw * k / 2, force: hs.v > .3 ? hs.Fw : 0, heat_eng: heat * k, heat_drive: Math.max(hs.Pe + hs.Pbat - hs.Pw, 0) * k };
  stage.flow.setHz(clamp(.5 + HY.motorRpm(hs.v) / 2500, .5, 4.5), clamp(.5 + hs.nE * 2 / 2500, .5, 4.5));
  return [f, { eng_gen: genMech * k, eng_wheel: toCl * k, mot_wheel: hs.Pmot * k, ac_mot: f.pcu_mot, ac_gen: f.gen_pcu }];
}
/** 换动力：车停回原位，表盘、按钮、说明都换成这一套的 */
function setPT(pt) {
  PT = pt;
  document.body.dataset.pt = pt;
  document.querySelectorAll('#pts button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.pt === pt));
  for (const [id, k] of TILES) $(`k_${id}`).textContent = pt === 'ehev' && TILES_E[id] ? TILES_E[id] : k;
  $('sub').textContent = SUB[pt];
  $('camCvt').textContent = pt === 'ehev' ? '看电驱单元' : '看 CVT';
  document.querySelector('#gears button[data-gear="R"]').disabled = pt === 'ehev';
  energyLayout(); tryLayout();
  if (stage) stage.setPowertrain(pt);
  reset();
  if (pt === 'ehev') { factsE(null); setTimeout(headlineE, 60); } else { facts(null); setTimeout(headline, 60); }
  try { history.replaceState(null, '', pt === 'ehev' ? '?pt=ehev' : location.pathname); } catch (e) { /* file:// 下有的浏览器不让改网址，不要紧 */ }
}
document.querySelectorAll('#pts button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.pt !== PT) setPT(b.dataset.pt); }));

// ------------------------------------------------------------------ 主循环
let last = performance.now(), accT = 0, uiT = 0, plotT = 0;
function tick(dt) {
  if (keys.up) setThr(Math.min(1, set.pedal + 1.6 * dt));
  if (keys.down) setBrk(Math.min(1, set.brake + 4 * dt));
  accT += dt;
  while (accT >= H) {
    accT -= H;
    const kf = Math.min(1, H / .05);
    act.pedal += (set.pedal - act.pedal) * kf; act.brake += (set.brake - act.brake) * kf; act.grade += (set.grade - act.grade) * Math.min(1, H / .6);
    if (Math.abs(act.grade) < 1e-4 && !set.grade) act.grade = 0;
    if (PT === 'ehev') stepE(H); else o = car.step(s, act, H);
    // 0→100 自动计时
    const kmh = o.kmh;
    if (Math.abs(kmh) < .3) { timer.armed = true; timer.t0 = -1; timer.vmax = 0; }
    else if (timer.armed && kmh > .3) { timer.armed = false; timer.t0 = s.t; timer.vmax = kmh; }
    if (timer.t0 >= 0) {
      timer.vmax = Math.max(timer.vmax, kmh);
      if (kmh >= 100) { timer.last = s.t - timer.t0; timer.t0 = -1; }
      else if (kmh < timer.vmax - 3 || o.brake > .05) timer.t0 = -1;
    }
    trace.t += H;
    if (trace.t >= .1) { trace.t = 0; trace.v.push(Math.abs(kmh)); trace.n.push(o.n); if (trace.v.length > 900) { trace.v.shift(); trace.n.shift(); } }
  }
  dnFilt += ((o.n - nPrev) / Math.max(dt, 1e-3) - dnFilt) * Math.min(1, dt / .4); nPrev = o.n;
  if (toastT > 0) toastT -= dt;
}
function frame(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  tick(dt);
  stage.update(dt, o, slow, s.gear);
  tach.set(o.n, f0(Math.round(o.n / 10) * 10)); tach.target(PT === 'cvt' && o.dir ? o.nTarget : null);
  speedo.set(Math.abs(o.kmh), f0(Math.abs(o.kmh)));
  uiT += dt; plotT += dt;
  if (plotT > .033) { plotT = 0; if (PT === 'cvt') drawPulleys(); drawCluster(); drawGate(); }
  if (uiT > .12) {
    uiT = 0; tiles(); explain(); energy();
    stage.setFlows(...flows());
    if (PT === 'cvt') { drawVario(); $('pr1').textContent = f1(stage.r1); $('pr2').textContent = f1(stage.r2); $('pratio').textContent = f2(o.ratio); }
    if (tipName) { tipT -= .12; if (tipT <= 0) showTip(''); else $('tip').innerHTML = tipText(); }
  }
  requestAnimationFrame(frame);
}

async function boot() {
  stage = new Stage($('gl'), car, spec, specE);
  try {
    await stage.init(glb, ptGlb);
  } catch (err) {
    $('loading').textContent = `三维模型没装上（${err.message}）。换一个支持 WebGL 的浏览器试试。`;
    throw err;
  }
  $('loading').hidden = true;
  new ResizeObserver(() => stage.resize()).observe($('stageWrap'));
  // 调试和自动检查用：advance(秒) 不等画面，直接把仿真往前推
  window.__sim = { get s() { return s; }, get o() { return o; }, get hs() { return hs; }, get pt() { return PT; }, stage, car, set, setThr, setBrk, setGear, setMode, setPT, reset, timer, advance(t) { for (let i = 0; i < t / .05; i++) tick(.05); } };
  window.__ready = true;
  setMode('xray');
  setPT(PT);                                   // 按网址里的 ?pt= 装上对应的动力，顺便算右下角那三个性能数字
  last = performance.now();
  requestAnimationFrame(frame);
}
boot();
