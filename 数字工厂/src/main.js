// 90-boot：组装场景、相机交互、HUD、巡游、主循环
import * as THREE from 'three';
import { Q, flag, num, initMaterials, MAT, Builder, Parts } from './util.js';
import { createStudio, CamRig } from './studio.js';
import { createPost } from './post.js';
import { buildBuilding } from './building.js';
import { buildProcess } from './process.js';
import { buildLogistics } from './logistics.js';
import { buildAssembly } from './assembly.js';
import { buildData } from './data.js';
import { createHUD } from './hud.js';
import { Tour } from './tour.js';
import { SIM } from './sim.js';
import { runAudit } from './audit.js';
import { ZONES, STATIONS, VIEW_OVERVIEW, TOUR, zoneAt } from './layout.js';

const opt = {
  raw: flag('raw'), lq: flag('lq'), pr: Q.has('pr') ? num('pr', 1) : undefined,
  instant: flag('instant'), still: flag('still'), debug: flag('debug'),
  tour: flag('tour'), film: flag('film'), letterbox: flag('letterbox'), tourfast: flag('tourfast'),
  tourat: Q.has('tourat') ? num('tourat', 0) : null,
};
const body = document.body;
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  const canvas = document.getElementById('c');
  for (const k of ['hideui', 'nolabels', 'nocard', 'debug']) if (flag(k)) body.classList.add(k);
  if (opt.film) body.classList.add('film', 'letterbox');
  if (opt.letterbox) body.classList.add('letterbox');

  const st = createStudio(canvas, opt);
  const { renderer, scene, camera } = st;
  renderer.info.autoReset = false;
  initMaterials();
  SIM.init();
  if (Q.has('sim')) SIM.rate = [1, 2, 4].includes(num('sim', 1)) ? num('sim', 1) : 1;

  const ctx = { scene, renderer, camera, MAT, B: new Builder(scene), P: new Parts(scene), updaters: [], opt };
  const hud = createHUD(ctx);
  const steps = [['厂房 · 结构 BUILDING', buildBuilding], ['工艺 · 冲压 / 焊装 / 涂装 PROCESS', buildProcess], ['物流 · 立库 / AGV / 卡车 LOGISTICS', buildLogistics], ['总装 · EOL · 发运 ASSEMBLY', buildAssembly], ['数据层 DATA LAYER', buildData]];
  for (let i = 0; i < steps.length; i++) { hud.veil(i / (steps.length + 1), steps[i][0]); await frame(); steps[i][1](ctx); }
  hud.veil(0.92, '合并几何 · 实例化 MERGING'); await frame();
  ctx.B.finalize(); ctx.P.finalize(scene);

  const rig = new CamRig(camera);
  const post = opt.raw ? null : createPost(renderer, scene, camera, opt);
  const tour = new Tour(rig, { fast: opt.tourfast, at: opt.tourat });
  tour.onChapter = (i) => hud.setChapter(i);
  tour.onProgress = (p) => hud.setProgress(p);

  // ---------- 初始机位 ----------
  const v0 = { ...VIEW_OVERVIEW };
  const vq = Q.get('view');
  const zq = ZONES.find((z) => z.id === vq);
  if (zq) Object.assign(v0, zq.view);
  for (const k of ['azim', 'elev', 'dist', 'fov', 'tx', 'ty', 'tz']) if (Q.has(k)) v0[k] = num(k, v0[k]);
  if (opt.instant || opt.tourat != null || opt.film) rig.set(v0, true);
  else { rig.set({ ...v0, dist: v0.dist * 1.7, azim: v0.azim - 0.55, elev: Math.min(1.2, v0.elev + 0.32), fov: v0.fov + 4 }, true); rig.set(v0); rig.k = 1.1; setTimeout(() => (rig.k = 2.8), 3800); }
  if (zq) { hud.setActiveView(zq.id); }

  // ---------- 动作 ----------
  let dataOn = !flag('nodata'), labelsOn = !flag('nolabels');
  ctx.data.setVisible(dataOn); hud.setToggle('data', dataOn); hud.setToggle('labels', labelsOn);
  const stopTour = () => { if (tour.active) { tour.stop(); hud.showCaption(false); hud.tourButton(false); body.classList.remove('touring'); } };
  ctx.goZone = (id) => {
    stopTour(); const z = ZONES.find((q) => q.id === id); if (!z) return;
    rig.set(z.view); rig.touch();
    ctx.data.highlightZone(id); ctx.data.setSelection([z.rect[0], z.rect[1], 0, 7, z.rect[2], z.rect[3]]);
    hud.openZone(id); hud.setActiveView(id); ctx.view = id;
  };
  ctx.goOverview = () => { stopTour(); rig.set(VIEW_OVERVIEW); rig.touch(); ctx.data.highlightZone(null); ctx.data.setSelection(null); hud.closeInspector(); hud.setActiveView('overview'); ctx.view = 'overview'; };
  ctx.focusStation = (id) => {
    stopTour(); const s = SIM.byId[id]; if (!s) return;
    const b = s.box; const size = Math.max(b[1] - b[0], b[5] - b[4], b[3] - b[2]);
    rig.set({ tx: (b[0] + b[1]) / 2, ty: Math.min(6, (b[2] + b[3]) * 0.35), tz: (b[4] + b[5]) / 2, dist: Math.min(120, Math.max(13, size * 1.55)), elev: 0.34, fov: 40 }); rig.touch();
    ctx.data.setSelection(b); hud.openStation(id); ctx.view = id;
    hud.setActiveView(s.zone);
  };
  ctx.closeInspector = () => { hud.closeInspector(); ctx.data.setSelection(null); ctx.data.highlightZone(null); };
  ctx.toggleData = () => { dataOn = !dataOn; ctx.data.setVisible(dataOn); hud.setToggle('data', dataOn); hud.toast(dataOn ? '数据层 已开启 · DATA ON' : '数据层 已关闭 · DATA OFF'); };
  ctx.toggleLabels = () => { labelsOn = !labelsOn; body.classList.toggle('nolabels', !labelsOn); hud.setToggle('labels', labelsOn); };
  ctx.startTour = () => { tour.start(performance.now()); hud.showCaption(true); hud.tourButton(true); body.classList.add('touring'); hud.closeInspector(); ctx.data.setSelection(null); };
  ctx.toggleTour = () => (tour.active ? stopTour() : ctx.startTour());
  ctx.setRate = (r) => { SIM.rate = r; document.querySelectorAll('#rate button').forEach((b) => b.classList.toggle('on', +b.dataset.r === r)); hud.toast(`演示速率 ${r}× · 仿真时钟 ${8 * r}×`); };
  ctx.reset = () => { stopTour(); ctx.goOverview(); ctx.setRate(1); if (!dataOn) ctx.toggleData(); if (!labelsOn) ctx.toggleLabels(); body.classList.remove('letterbox', 'hideui'); };
  ctx.toggleFull = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.(); };
  ctx.toggleUI = () => body.classList.toggle('hideui');
  ctx.toggleLetterbox = () => { const on = !body.classList.contains('letterbox'); body.classList.toggle('letterbox', on); body.classList.toggle('hideui', on); };

  // ---------- 拾取 ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), box = new THREE.Box3(), hit = new THREE.Vector3();
  const stBoxes = STATIONS.map((s) => ({ s, box: new THREE.Box3(new THREE.Vector3(s.box[0], s.box[2], s.box[4]), new THREE.Vector3(s.box[1], s.box[3], s.box[5])) }));
  ctx.pick = (cx, cy) => {
    ndc.set(cx / window.innerWidth * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = null, bd = 1e9;
    for (const { s, box: b } of stBoxes) { if (ray.ray.intersectBox(b, hit)) { const d = hit.distanceTo(ray.ray.origin); if (d < bd) { bd = d; best = { kind: 'station', id: s.id }; } } }
    for (const a of ctx.agvs || []) { box.setFromCenterAndSize(a.root.position.clone().setY(0.6), new THREE.Vector3(2.4, 1.6, 2.4)); if (ray.ray.intersectBox(box, hit)) { const d = hit.distanceTo(ray.ray.origin); if (d < bd) { bd = d; best = { kind: 'station', id: 'AGV-01' }; } } }
    // 地面分区（比工位更远时让位给工位）
    if (ray.ray.direction.y < 0) {
      const t = -ray.ray.origin.y / ray.ray.direction.y; hit.copy(ray.ray.origin).addScaledVector(ray.ray.direction, t);
      const z = zoneAt(hit.x, hit.z);
      if (z && (!best || t < bd - 2)) best = { kind: 'zone', id: z.id };
      if (!best && z) best = { kind: 'zone', id: z.id };
    }
    return best;
  };
  const doPick = (x, y) => {
    const lz = hud.labelAt(x, y); if (lz) { ctx.goZone(lz); return; }
    const p = ctx.pick(x, y);
    if (!p) return;
    if (p.kind === 'zone') { if (ctx.view === p.id) hud.openZone(p.id); else ctx.goZone(p.id); }
    else { ctx.data.setSelection(SIM.byId[p.id].box); hud.openStation(p.id); ctx.view = p.id; }
  };

  // ---------- 指针 / 触控 ----------
  const ptrs = new Map(); let drag = null; let pinch = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const filmOn = () => body.classList.contains('film'); // 录屏模式：鼠标碰到画面不打断巡游，Esc 退出
  canvas.addEventListener('pointerdown', (e) => {
    if (filmOn()) return;
    canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, pan: e.button === 2 || e.shiftKey || e.button === 1 };
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; drag = null; }
  });
  const panBy = (dx, dy) => {
    const c = rig.goal; const mpp = 2 * c.dist * Math.tan(c.fov * Math.PI / 360) / window.innerHeight;
    const s = Math.sin(c.azim), co = Math.cos(c.azim);
    c.tx += (-dx * co - dy * s / Math.max(0.3, Math.sin(c.elev))) * mpp; c.tz += (dx * s - dy * co / Math.max(0.3, Math.sin(c.elev))) * mpp;
  };
  canvas.addEventListener('pointermove', (e) => {
    rig.par.gx = (e.clientX / window.innerWidth - 0.5) * 2; rig.par.gy = (e.clientY / window.innerHeight - 0.5) * 2;
    const p = ptrs.get(e.pointerId); if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      stopTour(); rig.goal.dist *= pinch.d / Math.max(1, d); panBy(mx - pinch.mx, my - pinch.my); pinch = { d, mx, my }; rig.touch(); return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) { drag.moved = true; stopTour(); canvas.classList.add('drag'); }
    if (!drag.moved) return;
    if (drag.pan) panBy(dx, dy); else { rig.goal.azim -= dx * 0.0052; rig.goal.elev += dy * 0.0042; }
    rig.touch();
  });
  const up = (e) => {
    const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag && !drag.moved && p && e.type === 'pointerup' && e.button !== 2) { stopTour(); doPick(e.clientX, e.clientY); }
    if (ptrs.size === 0) { drag = null; canvas.classList.remove('drag'); }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (filmOn()) return; stopTour(); rig.goal.dist *= Math.exp(e.deltaY * 0.0012); rig.touch(); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl+F / Ctrl+D 这些留给浏览器
    const k = e.key;
    if (k >= '1' && k <= '6') ctx.goZone('Z0' + k);
    else if (k === '0') ctx.goOverview();
    else if (k === 'l' || k === 'L') ctx.toggleLabels();
    else if (k === 'd' || k === 'D') ctx.toggleData();
    else if (k === ' ') { e.preventDefault(); ctx.toggleTour(); }
    else if (k === 'h' || k === 'H') ctx.toggleUI();
    else if (k === 'b' || k === 'B') ctx.toggleLetterbox();
    else if (k === 'f' || k === 'F') ctx.toggleFull();
    else if (k === 'Escape') { if (filmOn()) { body.classList.remove('film', 'letterbox'); stopTour(); hud.measureHUD(); } else if (tour.active) stopTour(); else ctx.closeInspector(); }
  });

  // ---------- 尺寸 / 自动降级 ----------
  let dpr = renderer.getPixelRatio();
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    if (post) post.resize();
  };
  window.addEventListener('resize', resize);
  let slow = 0, ema = 16.7, degraded = 0;
  const degrade = (ft) => {
    if (ft > 250 || clock.t < 5) return; // 切走标签页再回来、刚开场编译着色器时的长帧不算数
    ema = ema * 0.95 + ft * 0.05;
    if (opt.pr || opt.lq) return;
    if (ema > 21) slow += ft / 1000; else slow = Math.max(0, slow - ft / 2000);
    if (slow > 2.5) {
      slow = 0;
      if (dpr > 1.01) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); resize(); }
      else if (degraded === 0 && post) { post.fin.uniforms.uTilt.value = 0; degraded = 1; }
      else if (degraded === 1) { renderer.shadowMap.autoUpdate = false; degraded = 2; }
    }
  };

  // ---------- 画面中心让开 HUD ----------
  const shown = (id) => { const e = document.getElementById(id); if (!e || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return r.width > 0 ? r : null; };
  const layoutOffset = () => {
    if (tour.active || filmOn() || body.classList.contains('hideui')) { rig.off.gx = 0; return; }
    const W = window.innerWidth, l = shown('left'), r = shown('right'), i = shown('insp');
    let R = W; if (r) R = Math.min(R, r.left); if (i && i.left > W * 0.35) R = Math.min(R, i.left);
    rig.off.gx = ((W - R) - (l ? l.right : 0)) / 2;
  };
  // ---------- 主循环 ----------
  const clock = { last: performance.now(), t: 0 };
  let labAcc = 0, hudAcc = 0, dbgAcc = 0, frames = 0, fpsT = 0, fps = 60;
  const DF = (window.DF = { SIM, rig, tour, ctx, hud, renderer, scene, camera, ready: false, frames: 0, fps: () => fps, opt });
  const loop = (now) => {
    requestAnimationFrame(loop);
    const ft = now - clock.last; clock.last = now;
    const dt = Math.min(0.05, Math.max(0, ft / 1000));
    clock.t += dt; frames++; DF.frames++;
    fpsT += ft; if (fpsT > 500) { fps = frames * 1000 / fpsT; frames = 0; fpsT = 0; }
    SIM.update(dt);
    for (const u of ctx.updaters) u(dt, clock.t);
    ctx.P.sync();
    for (const f of ctx.fans || []) f.rotation.y += dt * 6 * SIM.rate;
    if (tour.active) { tour.update(now); rig.update(dt, true); } else rig.update(dt, opt.still);
    ctx.data.update(dt, clock.t, camera);
    if (degraded === 2) renderer.shadowMap.needsUpdate = (DF.frames % 2 === 0);
    scene.updateMatrixWorld();
    renderer.info.reset();
    if (post) post.render(); else renderer.render(scene, camera);
    labAcc += dt; if (labAcc > 0.05) { labAcc = 0; hud.updateLabels(camera); }
    hudAcc += dt; if (hudAcc > 0.15) { hudAcc = 0; hud.update(rig); layoutOffset(); }
    if (opt.debug) { dbgAcc += dt; if (dbgAcc > 0.5) { dbgAcc = 0; const i = renderer.info; document.getElementById('dbg').textContent = `FPS ${fps.toFixed(0)}  DPR ${renderer.getPixelRatio().toFixed(2)}\nCALLS ${i.render.calls}  TRIS ${(i.render.triangles / 1000).toFixed(0)}k\nGEO ${i.memory.geometries}  TEX ${i.memory.textures}`; } }
    degrade(ft);
  };
  // 先渲一帧再揭开
  for (const u of ctx.updaters) u(0.016, 0);
  ctx.P.sync(); ctx.data.update(0.016, 0, camera); rig.apply(); scene.updateMatrixWorld();
  if (post) post.render(); else renderer.render(scene, camera);
  hud.update(rig);
  hud.veil(1, 'READY · 21 STATIONS ONLINE');
  requestAnimationFrame(loop);
  await frame();
  document.getElementById('veil').classList.add('out');
  body.classList.add('ready');
  setTimeout(() => hud.measureHUD(), 1300);
  DF.ready = true;
  if (opt.tour || opt.film || opt.tourat != null) ctx.startTour();
  DF.audit = (o) => runAudit(ctx, SIM, o);
  DF.stats = () => { const i = renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, dpr: renderer.getPixelRatio(), fps }; };
}

boot().catch((e) => { console.error(e); const v = document.getElementById('vps'); if (v) v.textContent = 'ERROR: ' + e.message; });
