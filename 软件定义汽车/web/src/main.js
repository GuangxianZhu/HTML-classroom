import glb from '../../blender/out/sdv.glb';
import spec from '../../blender/out/spec.json';
import { Stage, B } from './stage.js';
import { CHAPTERS } from './chapters.js';
import { ARCH } from './sim.js';

const $ = (id) => document.getElementById(id);
const stage = new Stage($('c'), spec);
const side = $('side'), nav = $('nav'), tagsEl = $('tags'), lg = $('lg'), slow = $('slow'), board = $('board');

const A = {
  stage, spec,
  setSlow(t) { slow.textContent = t || ''; slow.hidden = !t; },
  setLegend(h) { lg.innerHTML = h; lg.hidden = !h; },
  _tags: [],
  /** list: [{ t, p: [x,y,z] mm, c, onClick }] */
  setPins(list) {
    tagsEl.innerHTML = ''; A._tags = [];
    for (const it of list) {
      const b = document.createElement(it.onClick ? 'button' : 'div');
      b.className = it.onClick ? 'tag' : 'tag pin';
      if (it.onClick) { b.type = 'button'; b.onclick = it.onClick; }
      b.textContent = it.t;
      if (it.c) b.style.setProperty('--pc', it.c);
      tagsEl.append(b);
      A._tags.push({ el: b, v: B(...it.p), w: b.offsetWidth || 60, h: b.offsetHeight || 20 });
    }
  },
  tagsUpdate() {
    const placed = [];
    for (const t of A._tags) {
      const p = stage.project(t.v);
      // 标签太挤时后来的让路，免得叠成一团
      let hide = p.behind;
      if (!hide) for (const q of placed) if (Math.abs(q.x - p.x) < (t.w + q.w) / 2 + 2 && Math.abs(q.y - p.y) < (t.h + q.h) / 2 + 1) { hide = true; break; }
      t.el.hidden = hide;
      if (!hide) placed.push({ x: p.x, y: p.y, w: t.w, h: t.h });
      t.el.style.transform = `translate(calc(${p.x.toFixed(1)}px - 50%),calc(${p.y.toFixed(1)}px - 50%))`;
    }
  },
  showBoard(on) { board.hidden = !on; },
  tbMin(on) { document.querySelector('.tb').classList.toggle('min', on); },
  board,
  onPick: null,
  arch(a, animate = true) {
    stage.setArch(a, animate);
    const s = spec.stats[a];
    $('tb-arch').textContent = `${ARCH[a].tag} · ${ARCH[a].cn}`;
    $('tb-stat').textContent = `${s.ecu} 个 · ${Math.round(s.len_m)} m`;
  },
};

let cur = null, curIdx = -1;

function go(i, push = true) {
  if (cur && cur.leave) cur.leave();
  A.setPins([]); A.setLegend(''); A.setSlow(''); A.showBoard(false); A.onPick = null;
  stage.setFlows([]); stage.setTouched(null); stage.setTokens(false); stage.setColorMode('domain');
  stage.setScene('car'); stage.setExplode(0); A.tbMin(!!CHAPTERS[i].noArch);
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
    if (!dn || Math.hypot(e.clientX - dn[0], e.clientY - dn[1]) > 6 || !A.onPick) return;
    const k = stage.pick(e.clientX, e.clientY);
    if (k) A.onPick(k);
  });
  const fromHash = () => {
    const i = CHAPTERS.findIndex((c) => `#${c.id}` === location.hash);
    return i < 0 ? 0 : i;
  };
  window.addEventListener('hashchange', () => { const i = fromHash(); if (i !== curIdx) go(i, false); });
  go(fromHash(), false);
  let last = performance.now();
  window.__ready = true;
  window.__go = go;
  window.__stage = stage;
  window.__tick = (dt) => { if (cur && cur.tick) cur.tick(dt); };
  window.__tagsUpdate = A.tagsUpdate;
  const loop = (t) => {
    const dt = Math.min((t - last) / 1000, .05); last = t;
    if (!document.hidden) {
      try { if (cur && cur.tick) cur.tick(dt); } catch (e) { console.error(e); }
      A.tagsUpdate();
      stage.frame(dt);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

stage.init(glb).then(() => { $('loading').hidden = true; start(); }).catch((e) => {
  console.error(e);
  $('loading').firstElementChild.textContent = '三维模型载入失败。这个页面需要 WebGL，请换用支持硬件加速的浏览器，或打开浏览器的硬件加速设置。';
});
