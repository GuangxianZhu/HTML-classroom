import { Stage } from './stage.js';
import { initLab } from './lab.js';
import { initToy } from './toy.js';
import { drawSeg } from './seg7.js';
import { FIELD_LUT, FIELD_ALPHA, WAVE_LUT, WAVE_ALPHA } from './color.js';
import glb from '../../blender/out/microwave.glb';
import simz from './sim.simz';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* 隐私模式下没有存储，不影响使用 */ } } };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;

async function loadSim(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  const hl = new DataView(buf).getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
  const base = 4 + hl, cache = {};
  return {
    meta,
    get(name) {
      if (cache[name]) return cache[name];
      const a = meta.arrays[name];
      const n = a.shape.reduce((x, y) => x * y, 1);
      const T = a.type === 'uint16' ? Uint16Array : Uint8Array;
      return (cache[name] = new T(buf, base + a.offset, n));
    },
  };
}

function fillNumbers(meta) {
  const f = meta.foods;
  $$('[data-num]').forEach(el => {
    const [k, m, s] = el.dataset.num.split('.');
    const o = m === 'stuck' ? f[k].stuck : f[k][m];
    el.textContent = pct(o[s || (m === 'stuck' ? 'med' : 'cv')]);
  });
}

function rng(list) { return [Math.min(...list), Math.max(...list)]; }

function buildChart(meta) {
  const host = $('#chart'), tip = $('#chartTip');
  const keys = ['bento', 'disc', 'cup', 'cupo'];
  const S = [['antenna', '回转天线'], ['turntable', '经典转盘'], ['stuck', '天线卡住']];
  const max = 1.42;              // 横轴 0–142%，能放下卡住时最差的角度
  const X = v => (v / max * 100).toFixed(2);
  const row = (k, m, n) => {
    const v = meta.foods[k];
    const val = m === 'stuck' ? v.stuck.med : v[m].cv;
    const [lo, hi] = m === 'stuck' ? [v.stuck.min, v.stuck.max] : rng(v[`${m}All`].length ? v[`${m}All`] : [val]);
    const what = m === 'stuck' ? `36 个角度中位数 ${pct(val, 1)}，范围 ${pct(lo)}–${pct(hi)}` : `基准 ${pct(val, 1)}，改布置后 ${pct(lo)}–${pct(hi)}`;
    return `<div class="bar s-${m}" tabindex="0" data-tip="${v.label} · ${n}：${what}"><i style="width:${X(val)}%"></i><u style="left:${X(lo)}%;width:${X(hi - lo)}%"></u><em style="left:calc(${X(Math.max(hi, val))}% + 6px)">${pct(val)}</em></div>`;
  };
  host.innerHTML = keys.map(k => {
    const v = meta.foods[k];
    return `<div class="row"><div class="cat"><b>${v.label}</b><span>${v.note}</span></div><div class="bars">${S.map(([m, n]) => row(k, m, n)).join('')}</div></div>`;
  }).join('');
  const move = e => { const r = host.parentElement.getBoundingClientRect(); tip.style.left = `${Math.max(0, Math.min(e.clientX - r.left + 12, r.width - 330))}px`; tip.style.top = `${e.clientY - r.top + 14}px`; };
  $$('.bar', host).forEach(b => {
    b.addEventListener('pointerenter', e => { tip.textContent = b.dataset.tip; tip.hidden = false; move(e); });
    b.addEventListener('pointermove', move);
    b.addEventListener('pointerleave', () => { tip.hidden = true; });
    b.addEventListener('focus', () => { tip.textContent = b.dataset.tip; tip.hidden = false; tip.style.left = '150px'; tip.style.top = `${b.offsetTop + 20}px`; });
    b.addEventListener('blur', () => { tip.hidden = true; });
  });
  const fmtAll = (l) => l.map(x => pct(x, 1)).join('、');
  $('#chartTable tbody').innerHTML = keys.map(k => {
    const v = meta.foods[k];
    return `<tr><th>${v.label}</th><td>${fmtAll(v.antennaAll.length ? v.antennaAll : [v.antenna.cv])}</td><td>${fmtAll(v.turntableAll.length ? v.turntableAll : [v.turntable.cv])}</td><td>${pct(v.stuck.med, 1)}（${pct(v.stuck.min)}–${pct(v.stuck.max)}）</td></tr>`;
  }).join('');
  const sr = s => `<tr><th>${s.name}</th><td>${s.antenna ? pct(s.antenna.cv, 1) : '—'}</td><td>${s.turntable ? pct(s.turntable.cv, 1) : '—'}</td></tr>`;
  $('#gridTable tbody').innerHTML = meta.grid.map(sr).join('');
  $('#sensTable tbody').innerHTML = meta.sens.map(sr).join('');
  $('#varP').hidden = !(meta.foods.bento.turntableAll.length > 1 && meta.foods.bento.antennaAll.length > 1);
  $$('[data-range]').forEach(el => {
    const [k, m] = el.dataset.range.split('.');
    const v = meta.foods[k], [lo, hi] = rng(v[`${m}All`].length ? v[`${m}All`] : [v[m].cv]);
    el.textContent = `${pct(lo)}–${pct(hi)}`;
  });
}

(async function boot() {
  const hdr = $('#hdrSeg');
  if (hdr) { const c = hdr.getContext('2d'); c.fillStyle = '#120a04'; c.fillRect(0, 0, hdr.width, hdr.height); drawSeg(c, '2.45', 16, 12, 30, 52, '#ffa533', 'rgba(255,165,51,.08)'); }

  const sim = await loadSim(simz);
  const { meta } = sim;
  fillNumbers(meta);
  $('#gainVal').textContent = meta.wave.gain.toFixed(0);
  buildChart(meta);

  // ---- 舞台 ----
  const vp = $('#viewport'), tipEl = $('#tip');
  const stage = new Stage($('#gl'), vp);
  window.__stage = stage;
  stage.onPick = p => {
    $('#partName').textContent = p.label;
    $('#partDesc').textContent = p.desc;
    $('#partCard').hidden = false;
  };
  stage.hoverCb = (p, e) => {
    if (!p) { tipEl.hidden = true; return; }
    const r = vp.getBoundingClientRect();
    tipEl.textContent = p.label; tipEl.hidden = false;
    tipEl.style.left = `${Math.min(e.clientX - r.left + 14, r.width - 130)}px`; tipEl.style.top = `${e.clientY - r.top + 14}px`;
  };
  await stage.load(glb);
  $('#loading').hidden = true;

  // 叠加：水平面
  const H = sim.get('stage.h'), hn = 80 * 85, tmpH = new Uint8Array(hn);
  const W = sim.get('stage.wave'), wn = 119 * 71, wm = meta.wave;
  const fb = { showHeat: true, spin: !reduced, wave: 'steady', f: 0, t: 0, playing: true };
  const cvs = meta.foods.bento.stuck.cvs, NA = meta.N;
  $('#angRange').step = 360 / NA; $('#angRange').max = 360 - 360 / NA;

  function drawH() {
    const a = ((stage.antennaAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * NA;
    const i0 = Math.floor(a) % NA, i1 = (i0 + 1) % NA, u = a - Math.floor(a);
    const o0 = i0 * hn, o1 = i1 * hn;
    for (let i = 0; i < hn; i++) tmpH[i] = H[o0 + i] * (1 - u) + H[o1 + i] * u;
    stage.writeTex(stage.hTex, tmpH, 80, 85, FIELD_LUT, FIELD_ALPHA, false);
    const deg = Math.round(a * 360 / NA) % 360;
    $('#angVal').textContent = `${deg}°`;
    $('#angCv').textContent = pct(cvs[Math.round(a) % NA]);
    if (document.activeElement !== $('#angRange')) $('#angRange').value = deg;
  }
  function drawW(k) {
    stage.writeTex(stage.vTex, W.subarray(k * wn, (k + 1) * wn), 119, 71, WAVE_LUT, WAVE_ALPHA, false);
    const steps = k < wm.transient ? k * wm.stepTrans : null;
    $('#waveClock').textContent = steps !== null ? `通电后第 ${(steps / wm.spp).toFixed(1)} 个周期，${(steps / wm.spp * wm.periodNs).toFixed(2)} ns` : '稳态：波场每 0.41 ns 重复一次';
  }

  stage.listeners.push(dt => {
    if (stage.view === 'floor') { if (stage.hPlane.visible) drawH(); }
    if (stage.view === 'section' && stage.vPlane.visible && fb.playing) {
      fb.t += dt;
      if (fb.wave === 'trans') {
        const k = Math.floor(fb.t * 13);
        if (k >= wm.transient) { fb.wave = 'steady'; fb.t = 0; } else if (k !== fb.f) { fb.f = k; drawW(k); }
      } else {
        const k = wm.transient + (Math.floor(fb.t * 18) % 18);
        if (k !== fb.f) { fb.f = k; drawW(k); }
      }
    }
  });

  const tabs = $$('.tab'), panes = $$('[data-pane]');
  function go(name) {
    if (name !== 'look' && !unlocked) return;
    tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
    panes.forEach(p => { p.hidden = p.dataset.pane !== name; });
    $('#partCard').hidden = true; stage.highlight(null);
    if (name === 'look') { stage.setView(doorOpen ? 'open' : 'closed'); stage.spin = 0; stage.run = false; stage.setDisplay('0:30'); }
    if (name === 'floor') {
      stage.setView('floor'); stage.spin = fb.spin ? 0.34 : 0; stage.run = true; stage.setDisplay('0:30');
      setTimeout(() => { if (stage.view === 'floor') stage.hPlane.visible = fb.showHeat; }, 900);
    }
    if (name === 'section') {
      stage.setView('section'); stage.spin = fb.spin ? 0.34 : 0; stage.run = true;
      stage.antennaAngle = 0; stage.spin = 0;
      fb.wave = 'steady'; fb.t = 0;
      setTimeout(() => { if (stage.view === 'section') { stage.vPlane.visible = true; drawW(wm.transient); } }, 1000);
    }
    if (name === 'explode') { stage.setView('explode'); stage.spin = 0; stage.run = false; }
  }
  tabs.forEach(t => t.addEventListener('click', () => go(t.dataset.tab)));
  $$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

  let doorOpen = false;
  const doorBtn = $('#doorBtn');
  doorBtn.addEventListener('click', () => { doorOpen = !doorOpen; doorBtn.textContent = doorOpen ? '关上门' : '打开门'; stage.setView(doorOpen ? 'open' : 'closed'); });
  setTimeout(() => { if (stage.view === 'closed' && !doorOpen) doorBtn.click(); }, reduced ? 0 : 900);

  $('#heatToggle').addEventListener('change', e => { fb.showHeat = e.target.checked; stage.hPlane.visible = fb.showHeat; });
  $('#spinToggle').addEventListener('change', e => { fb.spin = e.target.checked; stage.spin = fb.spin ? 0.34 : 0; });
  $('#angRange').addEventListener('input', e => { $('#spinToggle').checked = false; fb.spin = false; stage.spin = 0; stage.antennaAngle = +e.target.value * Math.PI / 180; });
  $('#replay').addEventListener('click', () => { fb.wave = 'trans'; fb.t = 0; fb.f = -1; fb.playing = true; drawW(0); });
  $$('[data-part]').forEach(b => b.addEventListener('click', () => stage.focusPart(b.dataset.part)));

  // ---- 第一题 ----
  let unlocked = false;
  const after = $('#after');
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    tabs.forEach(t => t.removeAttribute('disabled'));
    after.hidden = false;
    $('#q1skip').hidden = true;
    initLater();
  }
  const Q1 = {
    a: '常见家用机只有一只磁控管。多路馈电是固态机型的路线，后面"三条路线"里会讲。',
    b: '猜对了。平板下面藏着一块不对称的金属片，一直在转。',
    c: `这个猜法最常见。可腔体是金属盒，驻波一定存在。这台模型里天线一停，便当的不均匀度就到 ${pct(meta.foods.bento.stuck.med)} 左右。`,
    d: '金属网的任务是把波挡在门内。它的孔比波长小得多，对腔内的场来说基本就是一面金属墙。',
  };
  $$('#q1 button').forEach(b => b.addEventListener('click', () => {
    $$('#q1 button').forEach(x => { x.disabled = true; x.classList.toggle('right', x.dataset.a === 'b'); x.classList.toggle('wrong', x === b && x.dataset.a !== 'b'); });
    $('#q1note').textContent = Q1[b.dataset.a];
    $('#q1r').hidden = false;
    store.set('mw.q1', '1');
    unlock();
  }));
  $('#q1skip').addEventListener('click', () => {
    $$('#q1 button').forEach(x => { x.disabled = true; x.classList.toggle('right', x.dataset.a === 'b'); });
    $('#q1note').textContent = Q1.b.replace('猜对了。', '答案：');
    $('#q1r').hidden = false;
    unlock();
  });

  // ---- 第二题 + 实验（解锁后才初始化，省 CPU） ----
  let inited = false;
  function initLater() {
    if (inited) return;
    inited = true;
    const lab = initLab(sim, {
      run: $('#labRun'), reset: $('#labReset'), foods: $$('[data-food]'), note: $('#foodNote'),
      stuckRange: $('#stuckRange'), stuckLabel: $('#stuckLabel'),
    });
    window.__lab = lab;
    initToy($('#toy'), { views: $$('[data-view]'), pos: $('#toyPos') });
  }
  const Q2R = {
    a: '便当和居中的杯子是这样，大圆盘和靠边的杯子就输了。',
    b: '大圆盘和靠边的杯子是这样，便当和居中的杯子就反过来了。',
    c: '猜对了。没有固定赢家。',
    d: '差很多。两种转动都明显好过卡住。',
  };
  $$('#q2 button').forEach(b => b.addEventListener('click', () => {
    $$('#q2 button').forEach(x => { x.disabled = true; x.classList.toggle('right', x.dataset.a === 'c'); x.classList.toggle('wrong', x === b && x.dataset.a !== 'c'); });
    $('#q2note').textContent = Q2R[b.dataset.a];
    $('#q2r').hidden = false;
    $('#labBody').hidden = false;
    $('#q2skip').hidden = true;
    window.__lab && window.__lab.runAll && $('#labRun').click();
  }));
  $('#q2skip').addEventListener('click', () => {
    $$('#q2 button').forEach(x => { x.disabled = true; x.classList.toggle('right', x.dataset.a === 'c'); });
    $('#q2note').textContent = Q2R.c.replace('猜对了。', '');
    $('#q2r').hidden = false; $('#labBody').hidden = false; $('#q2skip').hidden = true;
  });

  if (store.get('mw.q1')) { /* 回访时不再拦题 */ unlock(); $('#q1hint').hidden = false; }
  window.__wave = k => { fb.playing = false; drawW(k); };   // 测试用：定格到某一帧
  window.__ready = true;
})().catch(err => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) { l.hidden = false; l.textContent = `载入失败：${err.message}。请换用新版 Chrome 或 Edge 打开。`; }
});
