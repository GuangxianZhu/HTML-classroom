// 车和动力总成的模型都是“汽车模拟器”那边建的，这一页只管讲原理
import carGlb from '../../../汽车模拟器/blender/out/car.glb';
import ptGlb from '../../../汽车模拟器/blender/out/pt_ehev.glb';
import specCar from '../../../汽车模拟器/blender/out/spec.json';
import specE from '../../../汽车模拟器/blender/out/spec_ehev.json';
import { Stage, B } from './stage.js';
import { CHAPTERS } from './chapters.js';

const $ = (id) => document.getElementById(id);
// car.glb 里的件（两套动力共用的那些）在这一页的说明
const EXTRA = {
  tank: { cn: '油箱', en: 'Fuel tank', desc: '装汽油的塑料箱，在后排座椅下面。一根细油管沿地板下面走到发动机的油轨。飞度本身的油箱在前排座椅下面，这辆演示车的车身是模拟器那辆三厢车，所以位置不一样。' },
  radiator: { cn: '水箱和风扇', en: 'Radiator & fan', desc: '发动机烧油有一大半变成了热，冷却液把热带到这里，被迎面的风吹走。电机和 PCU 也要散热，走另一条温度低一些的回路。' },
  chassis: { cn: '副车架和悬架', en: 'Subframe & suspension', desc: '动力总成坐在前副车架上，车轮通过摆臂和减振器连在车身上。' },
  body: { cn: '车身', en: 'Body', desc: '模拟器那辆直线造型的三厢车。这一页的数字按飞度 e:HEV 的官方参数算，车身只是个载体。' },
};
for (const t of ['FL', 'FR', 'RL', 'RR']) {
  EXTRA[`wheel_${t}`] = { cn: `${{ F: '前', R: '后' }[t[0]]}轮（${{ L: '左', R: '右' }[t[1]]}）`, en: 'Wheel', desc: t[0] === 'F'
    ? '前轮是驱动轮：半轴把扭矩送到这里，轮胎往后蹬地，地面往前推车。松油门或踩刹车时反过来，车轮拖着电机发电。'
    : '后轮不带动力，只管承重和跟着滚。' };
}
const spec = { ...specE, axes: specE.derived.axes, groups: { ...specE.groups, ...EXTRA }, car: specCar };
const stage = new Stage($('c'), spec, specCar);
const side = $('side'), nav = $('nav'), tagsEl = $('tags'), lg = $('lg'), slow = $('slow'), flab = $('flab');
const KIND = [['elec', '电', 'var(--dc)'], ['mech', '机械', 'var(--mech)'], ['fuel', '油和气', 'var(--fuel)'], ['heat', '热', 'var(--heat)']];
const flowUi = { elec: true, mech: true, fuel: true, heat: true, num: true, tint: false };

const A = {
  stage, spec, partHost: null,
  setSlow(t) { slow.textContent = t || ''; slow.hidden = !t; },
  /** 能量流的图例：现在是一排开关，点一下只看 / 不看某一种 */
  setLegend(h) {
    lg.hidden = !h;
    if (!h) { flab.innerHTML = ''; A._fl = {}; return; }
    lg.innerHTML = `<span class="lgt">只看</span>${KIND.map(([k, t, c]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="${flowUi[k]}"><i style="background:${c}"></i>${t}</button>`).join('')}`
      + `<button type="button" class="chip" data-k="num" aria-pressed="${flowUi.num}">标数字</button>`
      + `<button type="button" class="chip" data-k="tint" aria-pressed="${flowUi.tint}" title="发动机这一边橙色，车轮这一边绿色，离合器夹在中间">按跟谁转上色</button>`;
    lg.querySelectorAll('.chip').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.k;
        flowUi[k] = !flowUi[k];
        b.setAttribute('aria-pressed', flowUi[k]);
        if (k === 'tint') stage.setTint(flowUi.tint);
        else if (k !== 'num') stage.setFlowFilter({ [k]: flowUi[k] });
      };
    });
  },
  _fl: {},
  /** 三维里每条能量流旁边的字（多少千瓦、往哪走） */
  flowLabels() {
    const list = !lg.hidden && flowUi.num && stage.explodeT < .02 ? stage.flowLabels() : [];
    const seen = new Set(), placed = [];
    for (const f of list) {
      seen.add(f.id);
      let el = A._fl[f.id];
      if (!el) { el = A._fl[f.id] = document.createElement('div'); el.className = 'fl'; flab.append(el); }
      const p = stage.project(f.pos);
      el.hidden = p.behind;
      if (el._t !== f.text) { el.textContent = f.text; el._t = f.text; el._w = 0; }
      if (p.behind) continue;
      if (!el._w) el._w = el.offsetWidth || f.text.length * 9 + 14;
      // 几条流挤在前舱里时字会叠在一起：后来的那条往下让
      let y = p.y;
      for (let i = 0; i < 8 && placed.some((q) => Math.abs(q.x - p.x) < (q.w + el._w) / 2 + 4 && Math.abs(q.y - y) < 23); i++) y += 23;
      placed.push({ x: p.x, y, w: el._w });
      el.style.color = f.color; el.style.borderColor = f.color;
      el.style.transform = `translate(calc(${p.x.toFixed(1)}px - 50%),calc(${y.toFixed(1)}px - 50%))`;
    }
    for (const k in A._fl) if (!seen.has(k)) { A._fl[k].remove(); delete A._fl[k]; }
  },
  _tags: [],
  setTags(list, onClick) {
    tagsEl.innerHTML = ''; A._tags = [];
    for (const [g, t, p] of list) {
      const b = document.createElement('button');
      b.className = 'tag'; b.type = 'button'; b.textContent = t;
      b.onclick = () => onClick(g);
      tagsEl.append(b);
      A._tags.push({ el: b, v: B(p[0], p[1], p[2]), g });
    }
  },
  tagsUpdate(views = ['home', 'ptrain']) {
    const show = views.includes(stage.view) && stage.explodeT < .02;
    for (const t of A._tags) {
      const p = stage.project(t.v);
      t.el.hidden = !show || p.behind;
      t.el.style.transform = `translate(calc(${p.x.toFixed(1)}px - 50%),calc(${p.y.toFixed(1)}px - 50%))`;
    }
  },
  showPart(g) {
    const info = spec.groups[g];
    stage.highlight(g);
    if (!info || !A.partHost) return;
    const el = $(A.partHost);
    if (el) el.innerHTML = `<h4>${info.cn}<span>${info.en}</span></h4><p>${info.desc}</p>`;
  },
};

let cur = null, curIdx = -1;

function go(i, push = true) {
  if (cur && cur.leave) cur.leave();
  A.setLegend(''); A.setSlow(''); A.setTags([]);
  stage.highlight(null); stage.hiddenExtra = []; stage.setExplode(0);
  curIdx = i;
  const ch = CHAPTERS[i], total = CHAPTERS.length;
  side.scrollTop = 0;
  side.innerHTML = `
    <header><div class="chno">${String(i + 1).padStart(2, '0')} / ${total}</div><h2>${ch.title}</h2><p class="lead">${ch.lead}</p></header>
    <section class="lab" aria-label="实验">${ch.body()}</section>
    <section class="notes">${ch.notes()}</section>
    <div class="pn">
      ${i > 0 ? `<button class="btn" id="pv" type="button">← ${CHAPTERS[i - 1].nav}</button>` : '<span></span>'}
      ${i < total - 1 ? `<button class="btn" id="nx" type="button">下一章：${CHAPTERS[i + 1].nav} →</button>` : ''}
    </div>`;
  const pv = $('pv'), nx = $('nx');
  if (pv) pv.onclick = () => go(i - 1);
  if (nx) nx.onclick = () => go(i + 1);
  [...nav.children].forEach((b, k) => { if (k === i) { b.setAttribute('aria-current', 'true'); b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } else b.removeAttribute('aria-current'); });
  stage.applyView(ch.view, !cur);
  cur = ch.enter(A);
  if (push && location.hash !== `#${ch.id}`) { try { history.replaceState(null, '', `#${ch.id}`); } catch (e) { location.hash = ch.id; } }
}

function start() {
  CHAPTERS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'nv'; b.type = 'button';
    b.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b>${c.nav}`;
    b.onclick = () => go(i);
    nav.append(b);
  });
  let dn = null;
  const cv = $('c');
  cv.addEventListener('pointerdown', (e) => { dn = [e.clientX, e.clientY]; });
  cv.addEventListener('pointerup', (e) => {
    if (!dn || Math.hypot(e.clientX - dn[0], e.clientY - dn[1]) > 6) return;
    if (!A.partHost) return;
    const g = stage.pick(e.clientX, e.clientY);
    if (g) A.showPart(g);
  });
  const fromHash = () => {
    const i = CHAPTERS.findIndex((c) => `#${c.id}` === location.hash);
    return i < 0 ? 0 : i;
  };
  window.addEventListener('hashchange', () => { const i = fromHash(); if (i !== curIdx) go(i, false); });
  go(fromHash(), false);
  let last = performance.now();
  window.__ready = true;
  window.__jump = () => { if (stage.fly) stage.fly.t = .999; };
  const loop = (t) => {
    const dt = Math.min((t - last) / 1000, .05); last = t;
    if (!document.hidden) {
      try { if (cur && cur.tick) cur.tick(dt); } catch (e) { console.error(e); }
      stage.frame(dt);
      A.flowLabels();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

stage.init(carGlb, ptGlb).then(() => { $('loading').hidden = true; start(); }).catch((e) => {
  console.error(e);
  $('loading').firstElementChild.textContent = '三维模型载入失败。这个页面需要 WebGL，请换用支持硬件加速的浏览器，或打开浏览器的硬件加速选项后刷新。';
});
