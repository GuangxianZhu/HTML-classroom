import glb from '../../blender/out/variator.glb';
import spec from '../../blender/out/spec.json';
import * as C from './core.js';
import { createStage } from './stage.js';
import { setupWheel, setupPlanet, setupSection, setupForce, setupChar, setupAdjust } from './labs.js';
import { PARTS, PATENTS, SOURCES, ev } from './data.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const f0 = (x) => x.toFixed(0), f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);

// ---------- 全局状态：手轮、负载、油 ----------
const S = { u: 0.5, T: 4, oil: 'traction' };
const mu = () => (S.oil === 'traction' ? C.PARAMS.load.mu : 0.04);
const solveNow = () => C.solve(S.u, S.T, { mu: mu() });
const listeners = [];
function update(from) {
  const s = solveNow();
  stage?.setU(S.u, s);
  for (const fn of listeners) fn(s, from);
}

// ---------- 依据标签：页面里写 <i data-ev="a"></i> ----------
for (const el of $$('[data-ev]')) el.outerHTML = ev(el.dataset.ev);

// ---------- 由模型算出来填进文案的数 ----------
{
  const f = C.solve(0), s = C.solve(1), m = C.solve(0.5);
  const ch = C.characteristic();
  const K = {
    e_fast: f1(f.e), e_slow: f1(s.e), ra_fast: f1(f.ra), rb_fast: f1(f.rb), ra_slow: f1(s.ra), rb_slow: f1(s.rb),
    gap_d: f2(s.gOut - f.gOut), Fs_fast: f0(f.Fs), Fs_slow: f0(s.Fs), Na_fast: f0(f.Na), Nb_fast: f0(f.Nb),
    Tcap_fast: f1(f.Tcap), Tcap_slow: f1(s.Tcap), Tr_fast: f1(f.Trated), Tr_slow: f1(s.Trated), Tr_mid: f1(m.Trated),
    P_fast: f0(ch[0].P), P_slow: f0(ch[ch.length - 1].P), spin_fast: f0(f.spinRel), spin_slow: f0(s.spinRel),
    clear: f1(f.ra - C.PARAMS.geom.planet_shaft_r), cam: f0(C.PARAMS.handwheel.cam_ring_deg), turns: f0(C.TURNS),
    motor_slow: f0(C.solve(1, s.Trated).motorLoad * 100), cf: f0((f.Nb / f.Na - 1) * 100),
    n_mid_turn: f0(C.geomAt(0.5).nOutIdeal),
  };
  for (const el of $$('[data-k]')) el.textContent = K[el.dataset.k] ?? '?';
}

// ---------- 三维舞台 ----------
let stage = null;
const detail = $('#detail');
const defaultDetail = detail.innerHTML;
function showPart(k) {
  const p = PARTS[k];
  if (!p) return;
  detail.innerHTML = `<p class="kicker">${p.grp}</p><h2>${p.name}</h2><p>${p.txt}</p><p><button type="button" class="link" id="backDetail">← 回到总说明</button></p>`;
  $('#backDetail').addEventListener('click', () => { detail.innerHTML = defaultDetail; stage.select(null); });
}
try {
  stage = createStage({ canvas: $('#gl'), glb, spec, pinsEl: $('#pins'), onPick: showPart });
  stage.setPinLabels((k) => PARTS[k]?.name ?? k);
  $('#loading').remove();
} catch (e) {
  $('#loading').textContent = '三维视图打不开（浏览器可能关了 WebGL）。下面的原理实验不受影响。';
  console.error(e);
}

// 看法按钮
for (const b of $$('[data-view]')) {
  b.addEventListener('click', () => {
    stage?.setView(b.dataset.view);
    $$('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
}
// 慢放
for (const b of $$('[data-speed]')) {
  b.addEventListener('click', () => {
    const v = +b.dataset.speed;
    stage?.setRunning(v > 0);
    if (v > 0) stage?.setSpeed(v);
    $$('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
}
$('#tContacts').addEventListener('change', (e) => stage?.setContacts(e.target.checked));
$('#tPins').addEventListener('change', (e) => stage?.setPins(e.target.checked));

// 手轮、负载、油
const hw = $('#hw'), load = $('#load');
hw.addEventListener('input', () => { S.u = +hw.value / 1000; update('hw'); });
load.addEventListener('input', () => { S.T = +load.value / 10; update('load'); });
for (const b of $$('[data-goto]')) b.addEventListener('click', () => { S.u = +b.dataset.goto; update('btn'); });
for (const r of $$('input[name=oilsel],input[name=oilsel2]')) r.addEventListener('change', () => { S.oil = r.value; update('oil'); });

listeners.push((s) => {
  hw.value = Math.round(S.u * 1000);
  $('#hwOut').textContent = `第 ${f1(S.u * C.TURNS)} / ${C.TURNS} 圈`;
  $('#loadOut').textContent = `${f1(S.T)} N·m`;
  const set = (id, v) => { $(id).textContent = v; };
  set('#rIn', `${C.N_IN} r/min`);
  set('#rOut', `${f0(s.nOut)} r/min`);
  set('#rI', `1 : ${f2(s.i)}`);
  set('#rE', `${f1(s.e)} mm`);
  set('#rRa', `${f1(s.ra)} / ${f1(s.rb)} mm`);
  set('#rGap', `${f2(s.gIn)} / ${f2(s.gOut)} mm`);
  set('#rFs', `${f0(s.Fs)} N`);
  set('#rSpin', `${f0(s.spinRel)} r/min`);
  set('#rCap', `${f1(s.Tcap)} N·m`);
  set('#rRated', `${f1(s.Trated)} N·m`);
  set('#rU', `${f0(s.ua * 100)}% / ${f0(s.ub * 100)}%`);
  set('#rMotor', `${f0(s.motorLoad * 100)}%`);
  const st = $('#state');
  if (s.slipping) {
    st.className = 'state bad';
    st.textContent = `打滑：${s.critical === 'inner' ? '内侧（主动轮那一圈）' : '外侧（定环那一圈）'}的摩擦力不够。输出掉到 ${f0(s.nOut)} r/min，接触面在磨、在发热。把负载降到 ${f1(s.Tcap)} N·m 以下，或者换个挡位。`;
  } else if (s.motorLoad > 1.02) {
    st.className = 'state warn';
    st.textContent = `摩擦还够，但电机要出 ${f0(s.motorLoad * 100)}% 的额定扭矩，长时间会过热。快挡更容易碰到这条线。`;
  } else if (s.U > 1 / C.PARAMS.load.safety) {
    st.className = 'state warn';
    st.textContent = `没滑，但摩擦力已经用掉 ${f0(s.U * 100)}%，超过了留 1.5 倍余量的额定线。`;
  } else {
    st.className = 'state';
    st.textContent = `正常：摩擦力用掉 ${f0(s.U * 100)}%，蠕滑 ${f1(s.creep * 100)}%，电机负载 ${f0(s.motorLoad * 100)}%。`;
  }
});

// ---------- 原理实验 ----------
setupWheel($('#lab-wheel'));
setupPlanet($('#lab-planet'));
const drawSection = setupSection($('#lab-section'), () => S.u, (u) => { S.u = u; update('section'); });
const drawForce = setupForce($('#lab-force'), () => ({ u: S.u, T: S.T, mu: mu() }));
const drawChar = setupChar($('#lab-char'), () => ({ u: S.u, mu: mu() }));
const drawAdjust = setupAdjust($('#lab-adjust'), () => S.u);
// 第四章自己的负载滑块和油（和上面的检修台共用状态）
const load2 = $('#load2');
load2.addEventListener('input', () => { S.T = +load2.value / 10; update('load2'); });
const hw2 = $('#hw2');
hw2.addEventListener('input', () => { S.u = +hw2.value / 1000; update('hw2'); });
listeners.push((s) => {
  load2.value = Math.round(S.T * 10);
  hw2.value = Math.round(S.u * 1000);
  $('#load2Out').textContent = `${f1(S.T)} N·m`;
  $('#hw2Out').textContent = `${f0(s.nOutIdeal)} r/min`;
  $$('input[name=oilsel],input[name=oilsel2]').forEach((r) => { r.checked = r.value === S.oil; });
  const o = $('#forceOut');
  o.className = 'state' + (s.slipping ? ' bad' : s.U > 1 / 1.5 ? ' warn' : '');
  o.innerHTML = s.slipping
    ? `打滑。这个挡位摩擦最多传 ${f1(s.Tcap)} N·m，先滑的是${s.critical === 'inner' ? '内侧（主动轮）' : '外侧（定环）'}。`
    : `这个挡位最多传 ${f1(s.Tcap)} N·m，现在用掉 ${f0(s.U * 100)}%。最吃紧的是${s.critical === 'inner' ? '内侧（主动轮那一圈）' : '外侧（定环那一圈）'}。`;
  drawSection(); drawForce(); drawChar(); drawAdjust();
});
let rz = 0;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => update('resize'), 120); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => update('theme'));

// ---------- 开头的猜题 ----------
for (const b of $$('#guess button')) {
  b.addEventListener('click', () => {
    $$('#guess button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const right = b.dataset.a === 'same';
    const a = $('#guessAns');
    a.hidden = false;
    a.className = 'state' + (right ? '' : ' warn');
    a.innerHTML = (right ? '对。' : '其实不变。') + '电机一直是 1400 r/min 左右，拧手轮改的是变速器里的“齿比”：行星盘在里面挪了位置，摩擦接触点离中心的距离变了。下面的三维模型可以边拧边看。';
  });
}

// ---------- 专利、来源 ----------
$('#patents').innerHTML = PATENTS.map((p) => `<article><h3><a href="${p.url}" target="_blank" rel="noopener">${p.no}</a> ${p.title}</h3>
<p class="meta">${p.meta} · 本页读到的程度：${p.read}</p><p>${p.body}</p><p class="rel"><b>和本页的关系：</b>${p.rel}</p></article>`).join('');
$('#sources').innerHTML = SOURCES.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('');

update('init');
