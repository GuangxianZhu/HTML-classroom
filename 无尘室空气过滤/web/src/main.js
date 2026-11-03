import glb from '../../blender/out/cleanroom.glb';
import pathsBin from '../../blender/out/flow_paths.dat';
import spec from '../../blender/out/spec.json';
import { createStage } from './stage.js';
import { STATIONS, FFU_PARTS, MAU_NOTES, LOOP, PRESSURE } from './data.js';
import { setupFilter } from './filter_lab.js';
import { setupFlow } from './flow_lab.js';
import { setupBudget } from './budget_lab.js';
import { setupClimate } from './climate_lab.js';
import { css, fit, tooltip, onTheme } from './ui.js';

const $ = (id) => document.getElementById(id);
const VIEWS = {
  section: { cam: [0, -46, 13.4], at: [0, 3, 9.6] },
  layers: { cam: [17, -55, 23], at: [0, 3, 10.4] },
  ffu: { cam: [1.5, -3.2, 1.35], at: [0, 0, .24] },
  mau: { cam: [5.5, -19.5, 3.8], at: [5.5, 1.2, 1.0] },
};
let stage, tourTimer = null, cur = 0, view = 'section';

function pinsFor(v) {
  if (v === 'ffu') return FFU_PARTS.map((p) => ({ name: p[1], tag: '', part: p, at: p[3], lift: spec.EXPLODE[p[0]] ?? 0 }));
  if (v === 'mau') return spec.MAU_STAGES.map((s) => ({ name: s.name, tag: s.id, stage: s, at: [(s.x0 + s.x1) / 2, .1, 2.42] }));
  return STATIONS.filter((s) => s.scene === 'fab').map((s) => ({ name: s.n, tag: STATIONS.indexOf(s) + 1, station: s, at: s.pin }));
}
function stationHtml(s, i) {
  return `<p class="kicker">第 ${i + 1} 站 / 共 ${STATIONS.length} 站</p><h2>${s.n}</h2><p class="leadline">${s.lead}</p><p>${s.body}</p>
  <dl class="facts">${s.facts.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>`;
}
function renderList() {
  $('stations').innerHTML = STATIONS.map((s, i) => `<button type="button" data-i="${i}"><b>${i + 1}</b>${s.n}</button>`).join('');
  $('stations').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { stopTour(); go(+b.dataset.i); }));
}
function setView(v, keepCam) {
  view = v;
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === v));
  if (v === 'ffu') { stage.setMode('ffu'); stage.setExplode(true); } else if (v === 'mau') { stage.setMode('mau'); stage.setExplode(false); } else { stage.setMode('fab'); stage.setExplode(v === 'layers'); }
  stage.setPins(pinsFor(v));
  $('pins').classList.toggle('keep', v === 'ffu');
  const showStations = v === 'section' || v === 'layers';
  $('airtoggles').hidden = v !== 'section';
  if (!keepCam) stage.fly(VIEWS[v].cam, VIEWS[v].at, 900);
  if (v === 'ffu') {
    $('detail').innerHTML = `<p class="kicker">FFU 爆炸图</p><h2>一台 FFU 拆开看</h2><p class="leadline">点图上的名字看每个零件的作用。</p><p>ULPA 滤纸的褶是按真实节距建的：3 mm 一褶，一块 1.2 × 0.6 m 的滤芯里约 380 褶。把镜头推近能看到热熔胶线。</p>`;
    $('stations').hidden = true;
  } else if (v === 'mau') {
    $('detail').innerHTML = `<p class="kicker">MAU 剖切</p><h2>新风一路走过的功能段</h2><p class="leadline">点图上的数字看每一段做什么。</p><p>空气从左往右走。这是一种常见排列，具体顺序和段数每个工厂不一样。</p>`;
    $('stations').hidden = true;
  } else { $('stations').hidden = false; if (showStations) go(cur, true); }
}
function go(i, noCam) {
  cur = i;
  const s = STATIONS[i];
  $('detail').innerHTML = stationHtml(s, i);
  $('stations').querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-current', k === i));
  if (noCam) return;
  const want = s.scene === 'mau' ? 'mau' : 'section';
  if (want !== view) {
    view = want;
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === want));
    stage.setMode(s.scene); stage.setExplode(false); stage.setPins(pinsFor(want));
    $('pins').classList.remove('keep');
    $('airtoggles').hidden = want !== 'section';
    $('stations').hidden = false;
  }
  stage.fly(s.cam, s.at);
  const idx = stage.state.pins.findIndex((p) => p.p.station === s);
  stage.activePin(idx);
}
function stopTour() { if (tourTimer) { clearInterval(tourTimer); tourTimer = null; $('btnTour').setAttribute('aria-pressed', false); $('btnTour').textContent = '自动走一圈'; } }
function startTour() {
  $('btnTour').setAttribute('aria-pressed', true); $('btnTour').textContent = '停止巡游';
  go(0);
  tourTimer = setInterval(() => { const n = cur + 1; if (n >= STATIONS.length) { stopTour(); setView('section'); return; } go(n); }, 7200);
}
function drawPressure() {
  const cv = $('cvPress');
  const { c, w, h } = fit(cv);
  c.clearRect(0, 0, w, h);
  const L = 46, R = 14, T = 16, B = 34;
  const Y0 = -40, Y1 = 120;
  const X = (i) => L + i / (PRESSURE.length - 1) * (w - L - R);
  const Y = (v) => h - B - (v - Y0) / (Y1 - Y0) * (h - T - B);
  const mute = css('--ink3'), line = css('--line');
  c.font = '500 11px ' + css('--mono'); c.textBaseline = 'middle';
  for (const v of [-40, 0, 40, 80, 120]) {
    c.strokeStyle = line; c.globalAlpha = v === 0 ? 1 : .6; c.lineWidth = 1; c.beginPath(); c.moveTo(L, Y(v)); c.lineTo(w - R, Y(v)); c.stroke(); c.globalAlpha = 1;
    c.fillStyle = mute; c.textAlign = 'right'; c.fillText(v > 0 ? `+${v}` : `${v}`, L - 6, Y(v));
  }
  c.textAlign = 'center';
  PRESSURE.forEach(([n], i) => { if (w > 520 || i % 2 === 0) c.fillText(n, X(i), h - B + 14); });
  c.fillText('静压 Pa，以室外为 0', (L + w - R) / 2, 8);
  c.strokeStyle = css('--s2'); c.lineWidth = 2; c.lineJoin = 'round'; c.beginPath();
  PRESSURE.forEach(([, v], i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)))); c.stroke();
  PRESSURE.forEach(([, v], i) => {
    c.fillStyle = css('--panel'); c.beginPath(); c.arc(X(i), Y(v), 6, 0, 7); c.fill();
    c.fillStyle = css('--s2'); c.beginPath(); c.arc(X(i), Y(v), 4, 0, 7); c.fill();
  });
  c.fillStyle = css('--ink2'); c.font = '700 12px ' + css('--sans'); c.textAlign = 'left';
  c.fillText('风机升压约 122 Pa', X(1) + 12, Y(112));
  c.fillText('滤芯压降约 92 Pa', X(1.6), Y(68));
  c.fillText('盘管压降约 25 Pa', X(5) - 30, Y(-30));
  cv._m = { X };
}

async function main() {
  $('looptable').innerHTML = LOOP.map((r) => `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('');
  drawPressure(); addEventListener('resize', drawPressure); onTheme(drawPressure);
  const tip = tooltip(), cvp = $('cvPress');
  cvp.addEventListener('pointermove', (e) => {
    const r = cvp.getBoundingClientRect(); const x = e.clientX - r.left;
    let best = 0, bd = 1e9; PRESSURE.forEach((_, i) => { const d = Math.abs(cvp._m.X(i) - x); if (d < bd) { bd = d; best = i; } });
    tip.show(`${PRESSURE[best][0]}<br><b>${PRESSURE[best][1] > 0 ? '+' : ''}${PRESSURE[best][1]} Pa</b>`, e.clientX, e.clientY);
  });
  cvp.addEventListener('pointerleave', () => tip.hide());
  setupFilter(); setupFlow(); setupBudget(); setupClimate();
  renderList();
  try {
    stage = createStage({
      canvas: $('gl'), glb, pathsBin, spec, pinsEl: $('pins'),
      onPin(p) {
        stopTour();
        if (p.station) return go(STATIONS.indexOf(p.station));
        if (p.part) {
          $('detail').innerHTML = `<p class="kicker">FFU 零件</p><h2>${p.part[1]}</h2><p class="leadline">${p.part[2]}</p>`;
          return;
        }
        if (p.stage) {
          $('detail').innerHTML = `<p class="kicker">MAU 第 ${p.stage.id} 段</p><h2>${p.stage.name}</h2><p class="leadline">${MAU_NOTES[p.stage.id]}</p>`;
          const cx = (p.stage.x0 + p.stage.x1) / 2;
          stage.fly([cx + .6, -4.6, 2.1], [cx, 1.2, 1.15]);
        }
      },
    });
    await stage.ready;
    $('loading').hidden = true;
    stage.setMode('fab');
    stage.setPins(pinsFor('section'));
    stage.jump(VIEWS.section.cam, VIEWS.section.at);
    window.__stage = stage;
    go(0, true);
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { stopTour(); setView(b.dataset.view); }));
    $('tgAir').addEventListener('change', (e) => { stage.state.air = e.target.checked; stage.syncAir(); });
    $('tgDust').addEventListener('change', (e) => { stage.state.dust = e.target.checked; stage.syncAir(); });
    $('btnTour').addEventListener('click', () => (tourTimer ? stopTour() : startTour()));
  } catch (err) {
    console.error(err);
    $('loading').textContent = '这台设备打不开三维视图（需要 WebGL2）。下面的实验不受影响。';
  }
}
main();
