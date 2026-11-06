// 入口：把三维舞台、实验台、选型题、专利卡片接到页面上。
import glb from '../../blender/out/flowmeters.glb';
import spec from '../../blender/out/spec.json';
import { createStage, RANGES } from './stage.js';
import { LABS, PIPE_LAB, mountLab } from './labs.js';
import { BENCH, TYPES, ORDER, PATENTS, QUIZ, TABLE, SOURCES, EV } from './content.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// ---------- 三维检修台 ----------
const viewsEl = $('#views'), detail = $('#detail'), hud = $('#hud');
const KEYS = ['bench', ...ORDER];
viewsEl.innerHTML = KEYS.map((k) => `<button type="button" data-k="${k}" aria-pressed="${k === 'bench'}">${k === 'bench' ? BENCH.tab : TYPES[k].tab}</button>`).join('');
let current = 'bench';

function benchDetail() {
  return `<p class="kicker">${BENCH.kicker}</p><h2>${BENCH.name}</h2><p class="leadline">${BENCH.lead}</p>
    ${BENCH.body.map((p) => `<p>${p}</p>`).join('')}
    <h3>点一个看剖面</h3>
    <div class="meterlist">${ORDER.map((k) => `<button type="button" data-go="${k}">${TYPES[k].tab}<small>${esc(spec.SPEC.bench.meters[k]?.label.replace(/^[^（]*/, '') || TYPES[k].kicker)}</small></button>`).join('')}</div>`;
}
function typeDetail(k) {
  const t = TYPES[k];
  const pins = spec.PINS[k] || [];
  return `<p class="kicker">${t.kicker}</p><h2>${t.name}</h2><p class="leadline">${t.lead}</p>
    ${t.body.map((p) => `<p>${p}</p>`).join('')}
    <h3>图上的编号</h3><ol class="numlist">${pins.map(([, label], i) => `<li><b>${i + 1}</b>${label}</li>`).join('')}</ol>
    <h3>湿法设备里用在哪</h3><p>${t.where}</p>
    <h3>一款产品的规格</h3>
    <dl class="facts">${t.facts.map(([a, b, e]) => `<div><dt>${a}</dt><dd>${b} ${EV[e]}</dd></div>`).join('')}</dl>
    <p class="src">来自：${t.factSrc}（见文末来源）</p>
    <div class="pc"><div class="g"><h3>长处</h3><ul>${t.good.map((x) => `<li>${x}</li>`).join('')}</ul></div><div class="b"><h3>短处</h3><ul>${t.bad.map((x) => `<li>${x}</li>`).join('')}</ul></div></div>
    <p class="jump"><a href="#s-labs" data-lab="${k}">→ 到下面动手试</a><a href="#s-pat" data-pat="${k}">→ 看专利怎么做</a></p>`;
}
function select(k) {
  current = k;
  viewsEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
  detail.innerHTML = k === 'bench' ? benchDetail() : typeDetail(k);
  detail.parentElement.scrollTop = 0;
  stage.setView(k);
  const bench = k === 'bench';
  $('#flowbox').hidden = bench;
  $('#legend').hidden = !bench;
  hud.hidden = bench;
  updateFlowOut();
}
viewsEl.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) select(b.dataset.k); });
detail.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { select(go.dataset.go); return; }
  const lb = e.target.closest('[data-lab]');
  if (lb) { setLab(lb.dataset.lab); }
  const pt = e.target.closest('[data-pat]');
  if (pt) { setPat(pt.dataset.pat); }
});
$('#legend').innerHTML = BENCH.legend.map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join('');

const stage = createStage({
  canvas: $('#gl'), glb, spec, pinsEl: $('#pins'),
  onPin: (root, id) => { if (root === 'bench' && TYPES[id]) select(id); },
  onValues: (root, vals) => { if (root === current && root !== 'bench') hud.innerHTML = vals.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join(''); },
});
const flow = $('#flow'), flowOut = $('#flowout');
function updateFlowOut() {
  const r = RANGES[current];
  if (!r || current === 'bench') return;
  const v = +flow.value * r[0];
  flowOut.textContent = `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${r[1]}`;
}
flow.addEventListener('input', () => { stage.setFlow(+flow.value); updateFlowOut(); });
$('#tgP').addEventListener('change', (e) => stage.setOpt({ particles: e.target.checked }));
$('#tgL').addEventListener('change', (e) => stage.setOpt({ labels: e.target.checked }));
stage.ready.then(() => { $('#loading').hidden = true; }).catch((err) => { $('#loading').textContent = '模型载入失败：' + err; });
select('bench');

// ---------- 实验台 ----------
const CAPS = {
  us: '上：流道和两个脉冲（动画把顺流、逆流的速度差放大了）。下：两只换能器收到的波形，竖虚线是各自的到达时刻。',
  vor: '上：发生体后面交替甩出的旋涡。下：探头感受到的压力脉动，过了门限就算一个旋涡。',
  pad: '左：叶轮（转速放慢一半）和霍尔脉冲。右：读数和真实流量的关系，虚线是理想的直线。',
  flt: '刻度是按 20 °C 的水刻的。换液体看浮子停在哪。',
  dp: '上：孔板、两只压力表、沿管的压力分布。下：同样的传感器噪声，在不同流量下折算成多大的流量误差。',
  thm: '上：毛细管上的温度分布，虚线是没有流动时。下：传感器特性曲线，黄点是当前工作点。',
  cor: '上：两条腿的摆动（放大了振幅和相位差）。下：两个拾振器的信号。',
  mag: '左：管子截面，磁场方向每秒翻一次，正负离子被推向两侧电极。右：电极间电压，虚线是不含噪声的信号。',
};
const labTabs = $('#labtabs');
labTabs.innerHTML = LABS.map((l) => `<button type="button" data-id="${l.id}" aria-pressed="false">${l.tab}</button>`).join('');
const labCv = $('#labcv');
LABS.find((l) => l.id === 'flt').setGeo(spec.SPEC.flt);
const mounted = {};
let activeLab = null;
function sizeLab() {
  const W = labCv.clientWidth || 600;
  labCv.style.height = `${W < 560 ? Math.round(Math.max(460, W * 1.35)) : Math.round(Math.min(560, Math.max(400, W * 0.66)))}px`;
}
function setLab(k, scroll = false) {
  const id = k === 'usc' ? 'us' : k;
  const lab = LABS.find((l) => l.id === id);
  labTabs.querySelectorAll('button').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.id === id)));
  if (!mounted[id]) mounted[id] = mountLab(lab, { canvas: labCv, ctlEl: $('#labctl'), readEl: $('#labread'), noteEl: $('#labnote') });
  else mounted[id].rebuild();
  activeLab = mounted[id];
  if (id === 'us' && (k === 'us' || k === 'usc')) activeLab.set('mode', k === 'usc' ? 'clamp' : 'in');
  $('#labtitle').textContent = id === 'us' ? '超声波（管内式 / 夹装式）' : TYPES[id].name;
  $('#labcap').textContent = CAPS[id];
  if (scroll) $('#s-labs').scrollIntoView({ behavior: 'smooth' });
}
labTabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setLab(b.dataset.id === 'us' ? (mounted.us?.state.mode === 'clamp' ? 'usc' : 'us') : b.dataset.id); });
sizeLab();
new ResizeObserver(sizeLab).observe(labCv.parentElement);
setLab('us');

const pipeCv = $('#pipecv');
const pipe = mountLab(PIPE_LAB, { canvas: pipeCv, ctlEl: $('#pipectl'), readEl: $('#piperead'), noteEl: $('#pipenote') });

const visible = new Set();
const io = new IntersectionObserver((ents) => ents.forEach((e) => (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id))), { rootMargin: '100px' });
io.observe($('#s-labs')); io.observe($('#s-what'));
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (visible.has('s-labs') && activeLab) activeLab.render(dt);
  if (visible.has('s-what')) pipe.render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- 对比表 ----------
const yes = new Set(['无', '能', '好', '好（100:1）', '小', '几乎没有', '无（夹在外面）']);
const noes = new Set(['不能', '有', '很怕', '差，平方根', '差，有最小流量']);
$('#cmp').innerHTML = `<thead><tr><th>类型</th>${TABLE.cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
  TABLE.rows.map(([k, ...cells]) => `<tr><th>${TYPES[k].tab}</th>${cells.map((c) => `<td class="${yes.has(c) ? 'yes' : noes.has(c) ? 'no' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody>`;

// ---------- 选择题 ----------
const answered = new Map();
$('#quiz').innerHTML = QUIZ.map((q, i) => `<div class="qc" data-i="${i}"><p class="q">${i + 1}. ${q.q}</p><div class="opts">${q.opts.map((o, j) => `<button type="button" data-j="${j}">${o}</button>`).join('')}</div><p class="why" hidden>${q.why}</p></div>`).join('');
function score() {
  const n = answered.size, ok = [...answered.values()].filter(Boolean).length;
  $('#score').textContent = n ? `答了 ${n} / ${QUIZ.length} 题，第一次就选对 ${ok} 题。` : '';
}
$('#quiz').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const card = b.closest('.qc'), i = +card.dataset.i, j = +b.dataset.j, q = QUIZ[i];
  if (!answered.has(i)) answered.set(i, j === q.a);
  card.querySelectorAll('button').forEach((x) => {
    const jj = +x.dataset.j;
    if (jj === q.a) x.classList.add('right');
    else if (jj === j) x.classList.add('wrong');
    x.disabled = true;
  });
  card.querySelector('.why').hidden = false;
  score();
});

// ---------- 专利 ----------
const patTabs = $('#pattabs');
patTabs.innerHTML = ORDER.map((k) => `<button type="button" data-k="${k}" aria-pressed="false">${TYPES[k].tab}<span style="opacity:.6"> · ${PATENTS[k].length}</span></button>`).join('');
function setPat(k) {
  patTabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
  $('#pats').innerHTML = PATENTS[k].map((p) => `<article class="pat"><p class="no">${p.no}</p><p class="who">${p.who} · ${p.year}</p><h3>${p.title}</h3>
    <p class="pb"><b>要解决的问题：</b>${p.problem}</p><ul>${p.how.map((h) => `<li>${h} ${EV.b}</li>`).join('')}</ul>
    <a href="${p.url}" target="_blank" rel="noopener">Google Patents 原文 ↗</a></article>`).join('');
}
patTabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setPat(b.dataset.k); });
setPat('us');

// ---------- 来源 ----------
const pats = ORDER.flatMap((k) => PATENTS[k].map((p) => [`${p.no}（${p.who}）${p.title}`, p.url]));
$('#sources').innerHTML = [...SOURCES, ...pats].map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join('');
