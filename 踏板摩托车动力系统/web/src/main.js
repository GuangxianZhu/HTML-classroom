import glb from '../../blender/out/scooter.glb';
import spec from '../../blender/out/spec.json';
import { Stage, B } from './stage.js';
import { CHAPTERS, MODELINFO } from './chapters.js';
import * as S from './sim.js';

S.setGeom(spec);
S.calibrate();

const $ = (id) => document.getElementById(id);
const stage = new Stage($('c'), spec);
const side = $('side'), nav = $('nav'), tagsEl = $('tags'), lg = $('lg'), slow = $('slow'), tools = $('tools'), toast = $('toast');

// ---------------------------------------------------------------- 舞台工具条
function toolbar(opts = {}) {
  const m = stage.model;
  const M = spec.models[m];
  tools.innerHTML = '';
  const mk = (label, on, fn, title = '') => {
    const b = document.createElement('button');
    b.className = 'btn'; b.type = 'button'; b.textContent = label; if (title) b.title = title;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.onclick = () => { fn(); toolbar(opts); };
    tools.append(b);
    return b;
  };
  if (M) {
    const cuts = Object.keys(M.cuts || {});
    if (cuts.length) {
      const cur = stage.cutKey;
      mk(cur ? M.cuts[cur].cn : '剖开', !!cur, () => {
        const i = cuts.indexOf(cur);
        stage.setCut(i < 0 ? cuts[0] : (i + 1 < cuts.length ? cuts[i + 1] : null));
      }, cuts.length > 1 ? '每按一下换一种剖法，再按回到不剖' : '沿中心切开看里面');
    }
    if (m === 'U4') mk(stage.hidden.has('U4_CVTCover') ? '盖上 CVT 盖' : '揭开 CVT 盖', stage.hidden.has('U4_CVTCover'), () => stage.toggleHidden('U4_CVTCover'));
    const hasGhost = [...stage.parts.values()].some((q) => q.model === m && q.ghostable);
    if (hasGhost) mk('透视', stage.ghost, () => stage.setGhost(!stage.ghost), '外壳变透明');
    mk('拆开', stage.explodeT > 0, () => stage.setExplode(!(stage.explodeT > 0)));
  }
  mk(stage.paused ? '▶ 继续' : '❚❚ 暂停', stage.paused, () => { stage.paused = !stage.paused; });
  const spd = [0.1, 0.25, 0.5, 1];
  const i = spd.indexOf(stage.speed);
  mk(`动画 ×${stage.speed}`, false, () => { stage.speed = spd[(i + 1) % spd.length]; }, '只改动画快慢，不改实验里的数');
}

let toastT = null;
function showToast(t) {
  toast.textContent = t; toast.hidden = false; toast.style.opacity = 1;
  clearTimeout(toastT);
  toastT = setTimeout(() => { toast.style.opacity = 0; setTimeout(() => { toast.hidden = true; }, 300); }, 1800);
}

const A = {
  stage, spec, S,
  setSlow(t) { slow.textContent = t || ''; slow.hidden = !t; },
  setLegend(h) { lg.innerHTML = h; lg.hidden = !h; },
  _tags: [],
  /** list: [{ t, p: [x,y,z] 世界 mm, model, part, onClick }] */
  setPins(list) {
    tagsEl.innerHTML = ''; A._tags = [];
    for (const it of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = it.onClick ? 'tag' : 'tag pin';
      b.style.pointerEvents = 'auto';
      b.textContent = it.t;
      b.onclick = it.onClick || (() => { if (it.part) { stage.flash(it.part); const pt = stage.part(it.part); if (pt) showToast(pt.cn); } });
      tagsEl.append(b);
      A._tags.push({ el: b, v: B(...it.p), w: b.offsetWidth || 60, h: b.offsetHeight || 20, model: it.model || stage.model });
    }
  },
  pins(m, key = 'pins', filter = null) {
    return (spec.models[m][key] || []).filter((x) => !filter || filter.includes(x.t)).map((x) => ({ ...x, model: m }));
  },
  tagsUpdate() {
    const placed = [];
    for (const t of A._tags) {
      const v = stage.pinWorld(t.v, t.model);
      if (stage.cutOn && stage.clip[0].distanceToPoint(v) < -0.03) { t.el.hidden = true; continue; }
      const p = stage.project(v);
      let hide = p.behind;
      if (!hide) for (const q of placed) if (Math.abs(q.x - p.x) < (t.w + q.w) / 2 + 2 && Math.abs(q.y - p.y) < (t.h + q.h) / 2 + 1) { hide = true; break; }
      t.el.hidden = hide;
      if (!hide) placed.push({ x: p.x, y: p.y, w: t.w, h: t.h });
      t.el.style.transform = `translate(calc(${p.x.toFixed(1)}px - 50%),calc(${p.y.toFixed(1)}px - 50%))`;
    }
  },
  title(m, sub) {
    const I = MODELINFO[sub || m] || MODELINFO.all;
    $('tb-name').textContent = I.cn;
    $('tb-en').textContent = I.en;
    $('tb-k1').textContent = I.k1; $('tb-v1').textContent = I.v1;
    $('tb-k2').textContent = I.k2; $('tb-v2').textContent = I.v2;
  },
  toolbar: () => toolbar(),
  toast: showToast,
  go: (id) => { const i = CHAPTERS.findIndex((c) => c.id === id); if (i >= 0) go(i); },
};

let cur = null, curIdx = -1;

function go(i, push = true) {
  if (cur && cur.leave) cur.leave();
  A.setPins([]); A.setLegend(''); A.setSlow('');
  stage.setFlows([]); stage.paused = false; stage.speed = 1;
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
  stage.applyView(ch.view, false);
  A.title(ch.view.model, ch.view.sub);
  cur = ch.enter(A) || {};
  toolbar();
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
    const p = stage.pick(e.clientX, e.clientY);
    if (!p) return;
    if (cur && cur.onPick && cur.onPick(p)) return;
    stage.flash(p.name); showToast(p.cn);
  });
  const fromHash = () => {
    const i = CHAPTERS.findIndex((c) => `#${c.id}` === location.hash);
    return i < 0 ? 0 : i;
  };
  window.addEventListener('hashchange', () => { const i = fromHash(); if (i !== curIdx) go(i, false); });
  go(fromHash(), false);
  stage.settle();
  let last = performance.now();
  window.__ready = true;
  window.__go = go;
  window.__stage = stage;
  window.__settle = () => stage.settle();
  const loop = (t) => {
    const dt = Math.min((t - last) / 1000, .05); last = t;
    if (!document.hidden) {
      try { if (cur && cur.tick) cur.tick(dt); } catch (e) { console.error(e); }
      stage.frame(dt);
      A.tagsUpdate();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

stage.init(glb).then(() => { $('loading').hidden = true; start(); }).catch((e) => {
  console.error(e);
  $('loading').firstElementChild.textContent = '三维模型载入失败。这个页面需要 WebGL，请换用支持硬件加速的浏览器，或打开浏览器的硬件加速设置。';
});
