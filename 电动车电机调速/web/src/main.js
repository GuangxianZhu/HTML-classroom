import glb from '../../blender/out/ev_drive.glb';
import spec from '../../blender/out/spec.json';
import { Stage, B } from './stage.js';
import { CHAPTERS } from './chapters.js';

const $ = (id) => document.getElementById(id);
const stage = new Stage($('c'), spec);
const side = $('side'), nav = $('nav'), ov = $('ov'), tagsEl = $('tags'), lg = $('lg'), slow = $('slow');
const SVGNS = 'http://www.w3.org/2000/svg';

const A = {
  stage, spec, thM: 0, partHost: null,
  setSlow(t) { slow.textContent = t || ''; slow.hidden = !t; },
  setLegend(h) { lg.innerHTML = h; lg.hidden = !h; },
  setLabels(items) {
    while (ov.children.length > items.length) ov.lastChild.remove();
    while (ov.children.length < items.length) ov.append(document.createElementNS(SVGNS, 'text'));
    items.forEach((it, i) => {
      const n = ov.children[i];
      n.setAttribute('x', it.x.x.toFixed(1)); n.setAttribute('y', it.x.y.toFixed(1));
      n.setAttribute('fill', it.c); n.setAttribute('opacity', it.o === undefined ? 1 : it.o.toFixed(2));
      if (n.textContent !== it.t) n.textContent = it.t;
    });
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
  tagsUpdate() {
    const show = stage.view === 'home';
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
  A.setLabels([]); A.setLegend(''); A.setSlow('');
  stage.highlight(null);
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
  // 单击选零件；拖动不算
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
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

stage.init(glb).then(() => { $('loading').hidden = true; start(); }).catch((e) => {
  console.error(e);
  $('loading').firstElementChild.textContent = '三维模型载入失败。这个页面需要 WebGL，请换用支持硬件加速的浏览器，或打开浏览器的硬件加速选项后刷新。';
});
