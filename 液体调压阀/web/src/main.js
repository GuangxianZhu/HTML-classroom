import glb from '../../blender/out/regulators.glb';
import spec from '../../blender/out/spec.json';
import { createStage, pColor } from './stage.js';
import { MODELS, partInfo, PATENTS, REFS } from './data.js';
import * as C from './reg_core.js';
import { setupLab1, setupSim, setupLoopLab, kOf } from './labs.js';
import { Color } from 'three';

const $ = (id) => document.getElementById(id);
const f3 = (v) => v.toFixed(3), f2 = (v) => v.toFixed(2);
const ORDER = ['spring', 'dome', 'fixed', 'bpr', 'loop'];
const STROKE = spec.stroke;
let stage = null, cur = 'dome', variant = 'cut';

// 每个模型自己的旋钮状态
const B = {
  spring: { set: 0.2, Pin: 0.4, u: 0.35 },
  dome: { Pp: 0.21, Pin: 0.4, u: 0.35 },
  fixed: { Pp: 0.2, Pin: 0.4, u: 0.35 },
  bpr: { set: 0.25, Qin: 12 },
  loop: { mode: 'qfb', Qsp: 1.5, Pin: 0.45, clog: 0 },
};
const PIN_ROW = { k: 'Pin', label: '供液压力', min: 0.1, max: 0.6, step: 0.005, fmt: (v) => `${f2(v)} MPa` };
const U_ROW = { k: 'u', label: '下游开度（开几个喷嘴）', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` };
const KNOBS = {
  spring: [{ k: 'set', label: '拧旋钮：设定压力', min: 0.05, max: 0.4, step: 0.005, fmt: (v) => `${f3(v)} MPa` }, PIN_ROW, U_ROW],
  dome: [{ k: 'Pp', label: '先导气压（电气比例阀给）', min: 0, max: 0.5, step: 0.005, fmt: (v) => `${f3(v)} MPa` }, PIN_ROW, U_ROW],
  fixed: [{ k: 'Pp', label: '先导气压', min: 0, max: 0.5, step: 0.005, fmt: (v) => `${f3(v)} MPa` }, PIN_ROW, U_ROW],
  bpr: [{ k: 'set', label: '设定气压（背压）', min: 0.05, max: 0.45, step: 0.005, fmt: (v) => `${f3(v)} MPa` },
    { k: 'Qin', label: '流进来的药液（循环主管的余量）', min: 0, max: 40, step: 0.5, fmt: (v) => `${v.toFixed(1)} L/min` }],
  loop: [{ k: 'Qsp', label: '配方流量', min: 0.6, max: 2.2, step: 0.05, fmt: (v) => `${f2(v)} L/min` },
    { k: 'Pin', label: '厂务供液压力', min: 0.25, max: 0.55, step: 0.005, fmt: (v) => `${f2(v)} MPa` },
    { k: 'clog', label: '过滤器堵塞程度', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` }],
};
const STATE_MSG = {
  reg: ['', '正常调节：三股力在这个开度上打平。'],
  lock: ['warn', '下游全关：阀芯压在阀座上，出口压力停在锁定压力。'],
  sat: ['bad', '阀全开了还不够：供压太低或者流量太大，出口压力掉到设定以下，调压失效。'],
  closed: ['warn', '加载力不够顶开阀芯，阀一直关着，出口没有压力。'],
};
const visOf = (x, xmax) => STROKE * Math.sqrt(Math.min(1, Math.max(0, x) / xmax));
const hex = (P) => '#' + pColor(P, new Color()).getHexString();

function compute(m) {
  const b = B[m];
  if (m === 'spring' || m === 'dome' || m === 'fixed') {
    const r = C.REG[m];
    const sv = m === 'spring' ? { F0: C.F0For(r, b.set, 0.4, 0) } : { Pp: b.Pp };
    const s = C.steady(r, b.Pin, kOf(b.u), sv);
    const rows = [['出口压力', `${f3(s.P)} MPa`], ['流量', `${f2(s.Q)} L/min`], ['真实开度', `${s.x.toFixed(3)} mm`], ['阀口压降', `${f3(Math.max(0, b.Pin - s.P))} MPa`]];
    if (m !== 'spring') rows.push(['关死时压力', `${f3(Math.max(0, Math.min(b.Pin, s.P0)))} MPa`]);
    return { rows, state: STATE_MSG[s.state], motion: { vis: visOf(s.x, r.xmax), up: b.Pin, down: s.P, air: b.Pp ?? null, flowScale: s.Q / 1.5 } };
  }
  if (m === 'bpr') {
    const r = C.bprUpstream(b.Qin, b.set);
    const rows = [['上游压力', `${f3(r.Pu)} MPa`], ['开启压力', `${f3(r.Pc)} MPa`], ['真实开度', `${r.x.toFixed(3)} mm`], ['回流量', `${r.Q.toFixed(1)} L/min`]];
    const state = b.Qin <= 0 ? ['warn', '没有多余的液体流进来：阀关着，上游压力取决于泵和用液。']
      : r.over ? ['bad', '流进来的量超过这台阀能放的上限，上游压力压不住。'] : ['', `阀芯抬开 ${r.x.toFixed(2)} mm，把多余的液体放回槽里，上游压力只比开启压力高 ${((r.Pu - r.Pc) * 1000).toFixed(1)} kPa。`];
    return { rows, state, motion: { vis: visOf(r.x, C.BPR.xmax), up: r.Pu, down: 0.01, air: b.set, flowScale: r.Q / 10 } };
  }
  const s = C.lineSteady({ mode: b.mode, Qsp: b.Qsp, Pin: b.Pin, clog: b.clog });
  const err = (s.Q / b.Qsp - 1) * 100;
  const Pnz = (s.Q / C.LINE.Kn) ** 2;
  const rows = [['先导气压', `${f3(s.Pp)} MPa`], ['调压阀出口', `${f3(s.P)} MPa`], ['喷嘴流量', `${f2(s.Q)} L/min`], ['和配方差', `${err >= 0 ? '+' : ''}${err.toFixed(1)}%`]];
  let state;
  if (s.sat) state = ['bad', '补不回来：电气比例阀给满了或调压阀全开了，供压撑不起这个流量。'];
  else if (Math.abs(err) > 2) state = ['warn', b.mode === 'open' ? '开环：控制器按开机时的标定给气压，看不到流量变了。' : '压力闭环：出口压力守住了，可下游阻力变了，流量跟着变。'];
  else state = ['', b.mode === 'qfb' ? '流量闭环：控制器盯着流量计，把先导气压调到让流量正好的位置。' : '流量还在配方附近。'];
  return { rows, state, loop: { mode: b.mode, up: b.Pin, down: s.P, mid: Pnz, Q: s.Q }, s };
}

function renderKnobs() {
  const m = cur, b = B[m];
  let html = '<div class="ctl">';
  if (m === 'loop') html += `<div class="btns" role="group" aria-label="控制方式" id="loopMode">${[['open', '开环'], ['pfb', '压力闭环'], ['qfb', '流量闭环']].map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${b.mode === v}">${t}</button>`).join('')}</div>`;
  for (const k of KNOBS[m]) html += `<label>${k.label} <span class="v" id="kv_${k.k}">${k.fmt(b[k.k])}</span><input type="range" id="kn_${k.k}" min="${k.min}" max="${k.max}" step="${k.step}" value="${b[k.k]}"></label>`;
  html += '<div class="read" id="benchRead"></div><div class="state" id="benchState"></div></div>';
  $('knobs').innerHTML = html;
  for (const k of KNOBS[m]) {
    const el = $('kn_' + k.k);
    el.addEventListener('input', () => { b[k.k] = +el.value; $('kv_' + k.k).textContent = k.fmt(b[k.k]); update(); });
  }
  if (m === 'loop') $('loopMode').querySelectorAll('button').forEach((bt) => bt.addEventListener('click', () => {
    b.mode = bt.dataset.v; $('loopMode').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === bt)); update();
  }));
  update();
}

function update() {
  const r = compute(cur);
  $('benchRead').innerHTML = r.rows.map(([a, v]) => `<div>${a}<b>${v}</b></div>`).join('');
  const el = $('benchState'); el.className = 'state ' + r.state[0]; el.textContent = r.state[1];
  if (!stage) return;
  if (r.motion) stage.setMotion(cur, r.motion);
  if (r.loop) {
    stage.setLoop(r.loop);
    const b = B.loop;
    stage.setPinValue('supply', `${f2(b.Pin)} MPa`);
    stage.setPinValue('ep', `${f3(r.s.Pp)} MPa`);
    stage.setPinValue('pt', `${f3(r.s.P)} MPa`);
    stage.setPinValue('fm', `${f2(r.s.Q)} L/min`);
    stage.setPinValue('filter', `堵 ${Math.round(b.clog * 100)}%`);
  }
}

function showModel(m, fly = true) {
  cur = m;
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.m === m));
  const d = MODELS[m];
  $('detail').innerHTML = `<p class="kicker">${d.tag}</p><h2>${d.title}</h2><p class="leadline">${d.lead}</p><p>${d.body}</p><p class="cap">${d.ref}。点图上的圆点看零件。</p><div class="partbox" id="partbox" hidden></div>`;
  const isLoop = m === 'loop';
  $('tgCut').hidden = isLoop; $('tgFluid').hidden = isLoop;
  $('legendNote').textContent = isLoop ? '管内光点颜色 = 压力　黄色光点：信号　蓝色光点：先导气' : '绿色气室：先导气压　阀芯动作放大显示';
  renderKnobs();
  if (stage) {
    stage.setModel(m);
    const v = stage.specOf(m).view;
    if (fly) stage.fly(v.cam, v.at); else stage.jump(v.cam, v.at);
    update();
  }
}

function onPin(m, key) {
  const [nm, desc] = partInfo(m, key);
  const box = $('partbox');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `<h3>${nm}</h3><p>${desc}</p>`;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderStatic() {
  $('tabs').innerHTML = ORDER.map((m) => `<button type="button" data-m="${m}" aria-pressed="${m === cur}">${MODELS[m].tab}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => showModel(b.dataset.m)));
  $('patents').innerHTML = PATENTS.map((p) => `<article><h3><a href="${p.url}" target="_blank" rel="noopener">${p.no}</a></h3><p class="meta">${p.who} · ${p.year} · 本页对应：${p.model}</p><p><b>结构：</b>${p.what}</p><p><b>要解决什么：</b>${p.why}</p></article>`).join('');
  $('sources').innerHTML = [...PATENTS.map((p) => [`${p.no}（${p.who}）`, p.url]), ...REFS].map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('');
  const tg = (id, fn) => $(id).addEventListener('click', () => { const on = $(id).getAttribute('aria-pressed') !== 'true'; $(id).setAttribute('aria-pressed', on); fn(on); });
  tg('tgCut', (on) => { variant = on ? 'cut' : 'full'; $('tgCut').textContent = on ? '剖开' : '外观'; stage && stage.setVariant(variant); update(); });
  tg('tgFluid', (on) => stage && stage.setFluid(on));
  tg('tgFlow', (on) => stage && stage.setParticles(on));
  tg('tgLabels', (on) => $('pins').classList.toggle('labels', on));
}

async function main() {
  renderStatic();
  showModel(cur, false);
  setupLab1();
  setupSim();
  setupLoopLab(hex);
  try {
    stage = createStage({ canvas: $('gl'), glb, spec, pinsEl: $('pins'), onPin });
    await stage.ready;
    $('loading').hidden = true;
    window.__stage = stage;
    showModel(cur, false);
  } catch (err) {
    console.error(err);
    $('loading').textContent = '这台设备打不开三维视图（需要 WebGL）。下面的实验不受影响。';
  }
}
main();
