import glb from '../../blender/out/pumps.glb';
import spec from '../../blender/out/spec.json';
import { Stage, B, RAMP_CSS } from './stage.js';
import { CHAPTERS, PUMPINFO } from './chapters.js';

const $ = (id) => document.getElementById(id);
const stage = new Stage($('c'), spec);
const side = $('side'), nav = $('nav'), tagsEl = $('tags'), lg = $('lg'), slow = $('slow'), tools = $('tools'), toast = $('toast');

// ---------------------------------------------------------------- 舞台工具条
const T = { cuts: [], cut: null };
function toolbar(opts = {}) {
  const p = stage.pump;
  const S = spec.pumps[p];
  T.cuts = opts.cuts || (S ? Object.keys(S.cuts) : []);
  tools.innerHTML = '';
  const mk = (label, on, fn, dis = false, title = '') => {
    const b = document.createElement('button');
    b.className = 'btn'; b.type = 'button'; b.textContent = label; b.disabled = dis; if (title) b.title = title;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.onclick = () => { fn(); toolbar(opts); };
    tools.append(b);
    return b;
  };
  if (S) {
    if (T.cuts.length) {
      const cur = stage.cutKey;
      const label = cur ? S.cuts[cur].cn : '剖开';
      mk(label, !!cur, () => {
        const i = T.cuts.indexOf(cur);
        const nx = i < 0 ? T.cuts[0] : (i + 1 < T.cuts.length ? T.cuts[i + 1] : null);
        stage.setCut(nx);
      }, false, '每按一下换一种剖法，再按回到不剖');
    }
    const hasGhost = [...stage.parts.values()].some((q) => q.pump === p && q.ghostable);
    if (hasGhost) mk('透视', stage.ghost, () => stage.setGhost(!stage.ghost), false, '外壳变透明');
    mk('拆开', stage.explodeT > 0, () => stage.setExplode(!(stage.explodeT > 0)));
  }
  mk(stage.paused ? '▶ 继续' : '❚❚ 暂停', stage.paused, () => { stage.paused = !stage.paused; });
  const spd = [0.25, 0.5, 1];
  const i = spd.indexOf(stage.speed);
  mk(`速度 ×${stage.speed}`, false, () => { stage.speed = spd[(i + 1) % spd.length]; });
}

let toastT = null;
function showToast(t) {
  toast.textContent = t; toast.hidden = false; toast.style.opacity = 1;
  clearTimeout(toastT);
  toastT = setTimeout(() => { toast.style.opacity = 0; setTimeout(() => { toast.hidden = true; }, 300); }, 1800);
}

const A = {
  stage, spec,
  setSlow(t) { slow.textContent = t || ''; slow.hidden = !t; },
  setLegend(h) { lg.innerHTML = h; lg.hidden = !h; },
  rampLegend(extra = '') {
    A.setLegend(`<span>液体压力 低<i class="ramp" style="background:${RAMP_CSS}"></i>高</span>${extra}`);
  },
  _tags: [],
  /** list: [{ t, p: [x,y,z] 世界 mm, part, onClick }] */
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
      A._tags.push({ el: b, v: B(...it.p), w: b.offsetWidth || 60, h: b.offsetHeight || 20, part: it.part });
    }
  },
  pinsFor(p, filter = null) {
    return (spec.pumps[p].pins || []).filter((x) => !filter || filter.includes(x.t));
  },
  tagsUpdate() {
    const placed = [];
    const ek = stage.explodeK;
    for (const t of A._tags) {
      let v = t.v;
      const pt = t.part && stage.part(t.part);
      if (pt) {
        if (!pt.obj.visible) { t.el.hidden = true; continue; }
        if (ek > .01) v = v.clone().addScaledVector(pt.ex, ek);
      }
      if (stage.cutOn && stage.clip[0].distanceToPoint(v) < -0.03) { t.el.hidden = true; continue; }
      const p = stage.project(v);
      let hide = p.behind;
      if (!hide) for (const q of placed) if (Math.abs(q.x - p.x) < (t.w + q.w) / 2 + 2 && Math.abs(q.y - p.y) < (t.h + q.h) / 2 + 1) { hide = true; break; }
      t.el.hidden = hide;
      if (!hide) placed.push({ x: p.x, y: p.y, w: t.w, h: t.h });
      t.el.style.transform = `translate(calc(${p.x.toFixed(1)}px - 50%),calc(${p.y.toFixed(1)}px - 50%))`;
    }
  },
  title(p) {
    const I = PUMPINFO[p];
    $('tb-name').textContent = I ? I.cn : '半导体湿法设备的泵';
    $('tb-en').textContent = I ? I.en : 'wet-process pumps';
    $('tb-k1').textContent = I ? '怎么动' : '五台泵';
    $('tb-v1').textContent = I ? I.how : '磁力 · 磁悬浮 · 波纹管 · 隔膜 · 计量';
    $('tb-k2').textContent = I ? '接液材料' : '共同点';
    $('tb-v2').textContent = I ? I.wet : '接液全氟树脂，没有轴封';
  },
  toolbar,
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
  stage.applyView(ch.view, curIdx < 0 || !cur);
  A.title(ch.view.pump);
  cur = ch.enter(A) || {};
  toolbar(cur.tools || {});
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
