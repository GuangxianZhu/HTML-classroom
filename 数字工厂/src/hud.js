// HUD：工业控制台 —— 顶栏 / 分区索引 / KPI / dock / 标题栏 / 指南针 / inspector / 投影标签 / 巡游字幕
import * as THREE from 'three';
import { SIM } from './sim.js';
import { ZONES, STATIONS, TOUR } from './layout.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const pct = (v) => Math.round(v * 100);
const ZSHORT = { Z01: '立库', Z02: '冲压', Z03: '焊装', Z04: '涂装', Z05: '总装', Z06: '发运' };

export function createHUD(ctx) {
  const H = { zoneRows: {}, lastEvK: null, labels: [], hudRects: [] };

  // ---------- 左：分区 ----------
  const zl = $('#zlist');
  for (const z of ZONES) {
    const r = el('div', 'zrow');
    r.innerHTML = `<span class="zid"><i class="zst"></i>${z.id.slice(1)}</span><span class="zn">${z.cn}<small>${z.en}</small></span><span class="zu">--%</span><span class="zbar"><i></i></span>`;
    r.onclick = () => ctx.goZone(z.id);
    zl.appendChild(r);
    H.zoneRows[z.id] = { row: r, st: r.querySelector('.zst'), u: r.querySelector('.zu'), bar: r.querySelector('.zbar i') };
  }

  // ---------- OEE 环 ----------
  const svg = $('#oeesvg');
  const ring = (r, w, c, op = 1) => `<circle r="${r}" cx="54" cy="54" fill="none" stroke="rgba(233,222,198,.08)" stroke-width="${w}"/><circle class="arc" r="${r}" cx="54" cy="54" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width="${w}" stroke-dasharray="0 999" transform="rotate(-90 54 54)"/>`;
  svg.innerHTML = ring(48, 4, '#f2a73b') + ring(41, 3, '#f6c06a', 0.75) + ring(35, 2, '#9ed6b4', 0.8) +
    `<text x="54" y="56" text-anchor="middle" font-size="19" fill="#e9e3d5" font-family="Cascadia Mono,Consolas,monospace" id="oeeV">86.9</text><text x="54" y="69" text-anchor="middle" font-size="7" fill="#8f897d" letter-spacing="1.5" font-family="Bahnschrift,Arial">OEE %</text>`;
  H.arcs = [...svg.querySelectorAll('.arc')];
  H.rads = [48, 41, 35];
  $('#apq').innerHTML = ['A 可用率', 'P 性能', 'Q 质量'].map((t, i) => `<div><b>${'APQ'[i]}</b><span><i></i></span><em>--</em></div><div class="cap" style="margin:-4px 0 0 22px;letter-spacing:.06em">${t.slice(2)} ${['AVAILABILITY', 'PERFORMANCE', 'QUALITY'][i]}</div>`).join('');
  H.apq = [...document.querySelectorAll('#apq > div:not(.cap)')];

  // ---------- 能耗分区柱 / AGV 电量格 ----------
  $('#zbars').innerHTML = ZONES.map((z) => `<div><span>${z.id}</span><span><i></i></span><em>--</em></div>`).join('');
  H.zbars = [...document.querySelectorAll('#zbars > div')];
  $('#agvcells').innerHTML = Array.from({ length: SIM.agv.total }, () => '<i><b></b></i>').join('');
  H.cells = [...document.querySelectorAll('#agvcells i')];

  // ---------- dock / 速率 ----------
  document.querySelectorAll('#dock button').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.dataset.v) b.dataset.v === 'overview' ? ctx.goOverview() : ctx.goZone(b.dataset.v);
    const a = b.dataset.a;
    if (a === 'data') ctx.toggleData(); if (a === 'labels') ctx.toggleLabels(); if (a === 'tour') ctx.toggleTour();
    if (a === 'reset') ctx.reset(); if (a === 'full') ctx.toggleFull();
  }));
  document.querySelectorAll('#rate button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ctx.setRate(+b.dataset.r); }));
  $('#iClose').onclick = (e) => { e.stopPropagation(); ctx.closeInspector(); };
  const d = new Date(); $('#tbDate').textContent = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ---------- 投影标签 ----------
  const lab = $('#labels'), lead = $('#leaders');
  for (const z of ZONES) {
    const t = el('div', 'tag');
    t.innerHTML = `<div class="card"><b>${z.id}</b><span>${z.cn}</span><small>${z.en}</small><em>利用率 <span class="u">--</span>% · WIP <span class="w">--</span> · <i class="s">RUN</i></em></div>`;
    const dot = el('div', 'ldot');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'rgba(242,167,59,.75)'); line.setAttribute('stroke-width', '1');
    lead.appendChild(line); lab.appendChild(t); lab.appendChild(dot);
    t.querySelector('.card').addEventListener('click', (e) => { e.stopPropagation(); ctx.goZone(z.id); });
    H.labels.push({ z, t, dot, line, u: t.querySelector('.u'), w: t.querySelector('.w'), s: t.querySelector('.s'), size: null, anchor: new THREE.Vector3(...z.label) });
  }
  const measureHUD = () => {
    H.hudRects = ['#top', '#left', '#right', '#dock', '#tb', '#nav', '#insp', '#cap'].map((s) => $(s)).filter((e) => e && getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    for (const L of H.labels) L.size = null;
  };
  H.measureHUD = measureHUD;
  setTimeout(measureHUD, 1200);
  window.addEventListener('resize', () => setTimeout(measureHUD, 50));

  const v = new THREE.Vector3();
  const overlap = (a, b) => !(a.x + a.w < b.left || a.x > b.right || a.y + a.h < b.top || a.y > b.bottom);
  const overlap2 = (a, b) => !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
  H.updateLabels = (camera) => {
    if (document.body.classList.contains('nolabels') || document.body.classList.contains('film') || document.body.classList.contains('hideui')) return;
    const W = window.innerWidth, Hh = window.innerHeight; const placed = []; const now = performance.now();
    const camPos = camera.position;
    const items = H.labels.map((L) => {
      v.copy(L.anchor).project(camera);
      const dist = camPos.distanceTo(L.anchor);
      const vis = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && dist < 560;
      return { L, x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * Hh, vis, dist };
    }).sort((a, b) => a.dist - b.dist);
    for (const it of items) {
      const L = it.L;
      if (!it.vis) { L.t.style.display = 'none'; L.dot.style.display = 'none'; L.line.setAttribute('points', ''); continue; }
      L.t.style.display = ''; L.dot.style.display = '';
      if (!L.size || now - L.sizeT > 1000) { const ww = L.t.offsetWidth; if (ww > 0) { L.size = { w: ww, h: L.t.offsetHeight }; L.sizeT = now; } }
      if (!L.size) continue;
      const { w, h } = L.size;
      const cands = [[22, -h - 22], [-w - 22, -h - 22], [22, 18], [-w - 22, 18], [30, -h - 58], [-w - 30, -h - 58]];
      let ok = null;
      for (const [dx, dy] of cands) {
        const r = { x: it.x + dx, y: it.y + dy, w, h };
        if (r.x < 6 || r.y < 54 || r.x + w > W - 6 || r.y + h > Hh - 6) continue;
        if (H.hudRects.some((hr) => overlap(r, hr))) continue;
        if (placed.some((p) => overlap2(r, p))) continue;
        ok = r; break;
      }
      const dotInHud = H.hudRects.some((hr) => it.x > hr.left && it.x < hr.right && it.y > hr.top && it.y < hr.bottom);
      if (!ok || dotInHud) { L.t.style.display = 'none'; L.line.setAttribute('points', ''); L.dot.style.display = dotInHud ? 'none' : ''; L.dot.style.transform = `translate(${it.x}px,${it.y}px)`; continue; }
      placed.push(ok);
      L.t.style.transform = `translate(${ok.x.toFixed(1)}px,${ok.y.toFixed(1)}px)`;
      L.dot.style.transform = `translate(${it.x.toFixed(1)}px,${it.y.toFixed(1)}px)`;
      const ex = ok.x < it.x ? ok.x + w : ok.x, ey = ok.y + h * 0.5;
      const kx = ok.x < it.x ? it.x - 10 : it.x + 10;
      L.line.setAttribute('points', `${it.x.toFixed(1)},${it.y.toFixed(1)} ${kx.toFixed(1)},${ey.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`);
    }
  };

  // ---------- 周期刷新 ----------
  const setArc = (i, val) => { const C = 2 * Math.PI * H.rads[i]; H.arcs[i].setAttribute('stroke-dasharray', `${(C * val).toFixed(1)} ${C.toFixed(1)}`); };
  H.update = (rig) => {
    $('#clock').textContent = SIM.clockStr(true);
    const o = SIM.oee; setArc(0, o.v); setArc(1, o.P); setArc(2, o.Q);
    $('#oeeV').textContent = (o.v * 100).toFixed(1);
    [o.A, o.P, o.Q].forEach((x, i) => { H.apq[i].querySelector('i').style.width = pct(x) + '%'; H.apq[i].querySelector('em').textContent = (x * 100).toFixed(1); });
    $('#cnt').textContent = SIM.count; $('#tgt').textContent = SIM.target;
    $('#wip').innerHTML = `${SIM.wip}<small>台</small>`;
    $('#agv').innerHTML = `${SIM.agv.online}<small>/ ${SIM.agv.total} 在线</small>`;
    H.cells.forEach((c, i) => { c.className = SIM.agv.charging[i] ? 'ch' : ''; c.firstChild.style.height = pct(SIM.agv.battery[i]) + '%'; });
    $('#pwr').textContent = SIM.power.toFixed(3);
    const maxP = Math.max(...ZONES.map((z) => SIM.zones[z.id].power));
    H.zbars.forEach((b, i) => { const zz = SIM.zones[ZONES[i].id]; b.querySelector('i').style.width = (zz.power / maxP * 100).toFixed(0) + '%'; b.querySelector('em').textContent = (zz.power * 1000).toFixed(0) + ' kW'; });
    // 产量 sparkline
    const hs = SIM.history, mx = Math.max(34, ...hs);
    const pts = hs.map((h, i) => `${(i / (hs.length - 1) * 260).toFixed(1)},${(36 - h / mx * 32).toFixed(1)}`).join(' ');
    $('#spark').innerHTML = `<polygon points="0,38 ${pts} 260,38" fill="rgba(242,167,59,.10)"/><polyline points="${pts}" fill="none" stroke="#f2a73b" stroke-width="1"/><line x1="0" x2="260" y1="${(36 - 31 / mx * 32).toFixed(1)}" y2="${(36 - 31 / mx * 32).toFixed(1)}" stroke="rgba(233,222,198,.25)" stroke-dasharray="2 3"/>`;
    // 分区
    let run = 0;
    for (const s of SIM.stations) if (s.state === 'run') run++;
    $('#stcount').textContent = `${run} / ${SIM.stations.length} 运行`;
    for (const z of ZONES) {
      const zr = H.zoneRows[z.id], zz = SIM.zones[z.id];
      const sts = SIM.stations.filter((s) => s.zone === z.id).map((s) => s.state);
      const st = sts.includes('down') ? 'down' : sts.includes('idle') ? 'idle' : 'run';
      zr.st.className = 'zst ' + st; zr.u.textContent = pct(zz.util) + '%'; zr.bar.style.width = pct(zz.util) + '%';
      const L = H.labels.find((q) => q.z.id === z.id);
      L.u.textContent = pct(zz.util); L.w.textContent = zz.wip; L.s.className = 's ' + st; L.s.textContent = st.toUpperCase();
    }
    // 事件
    const k = SIM.events[0] && SIM.events[0].k;
    if (k !== H.lastEvK) {
      H.lastEvK = k;
      $('#events').innerHTML = SIM.events.slice(0, 6).map((e) => `<div class="ev ${e.sev}"><span class="t">${e.t}</span><span class="i">${e.id}</span><span class="m">${e.msg}</span></div>`).join('');
    }
    // 指南针 / 比例尺 / 视角
    const c = rig.cur;
    $('#cRose').setAttribute('transform', `rotate(${(c.azim * 180 / Math.PI).toFixed(1)})`);
    const mpp = 2 * c.dist * Math.tan(c.fov * Math.PI / 360) / window.innerHeight;
    const nice = [1, 2, 5, 10, 20, 50, 100, 200]; let best = 1; for (const n of nice) if (n / mpp <= 110) best = n;
    $('#scBar').style.width = (best / mpp).toFixed(0) + 'px'; $('#scLab').textContent = best + ' m';
    $('#tbScale').textContent = `1 : ${Math.round(mpp * 3779).toLocaleString('en')} · 单位 m`;
    const az = ((c.azim * 180 / Math.PI) % 360 + 360 + 180) % 360;
    $('#viewAng').textContent = `AZ ${az.toFixed(0).padStart(3, '0')}° · EL ${(c.elev * 180 / Math.PI).toFixed(0)}° · ${c.dist.toFixed(0)} m`;
    if (H.inspUpdate) H.inspUpdate();
  };

  // ---------- inspector（结构只建一次，之后原地刷新数值，点击不会丢） ----------
  const ib = $('#iBody'), it = $('#iTitle'), ins = $('#insp');
  const ST_TXT = { run: '运行 RUN', idle: '待机 IDLE', down: '故障 DOWN' };
  H.openZone = (id) => {
    const z = ZONES.find((q) => q.id === id); if (!z) return;
    it.innerHTML = `${z.id} · ${z.cn} <span class="cap" style="margin-left:4px">${z.en}</span>`;
    const sts = SIM.stations.filter((s) => s.zone === id);
    ib.innerHTML = `<span class="chip" id="iChip"></span>
      <div class="mgrid"><div><div class="cap">利用率</div><div class="kv"><span id="iU"></span><small>%</small></div></div><div><div class="cap">WIP</div><div class="kv" id="iW"></div></div><div><div class="cap">功率</div><div class="kv"><span id="iP"></span><small>kW</small></div></div></div>
      <div class="cap" style="margin-bottom:3px">工位 · 点击飞近聚焦</div>
      <div class="slist">${sts.map((s) => `<div class="srow" data-id="${s.id}"><i class="dot"></i><span class="i">${s.id}</span><span class="n">${s.cn}</span><span class="u"></span></div>`).join('')}</div>`;
    ib.querySelectorAll('.srow').forEach((r) => (r.onclick = (e) => { e.stopPropagation(); ctx.focusStation(r.dataset.id); }));
    const rows = [...ib.querySelectorAll('.srow')].map((r) => ({ r, s: SIM.byId[r.dataset.id], dot: r.querySelector('.dot'), u: r.querySelector('.u') }));
    const chip = ib.querySelector('#iChip'), iU = ib.querySelector('#iU'), iW = ib.querySelector('#iW'), iP = ib.querySelector('#iP');
    const draw = () => {
      const zz = SIM.zones[id];
      const st = sts.some((s) => s.state === 'down') ? 'down' : sts.some((s) => s.state === 'idle') ? 'idle' : 'run';
      chip.className = 'chip ' + st; chip.textContent = ST_TXT[st];
      iU.textContent = pct(zz.util); iW.textContent = zz.wip; iP.textContent = (zz.power * 1000).toFixed(0);
      for (const q of rows) { q.dot.className = 'dot ' + q.s.state; q.u.textContent = pct(q.s.util) + '%'; }
    };
    draw(); H.inspUpdate = draw; ins.classList.add('on'); measureHUD();
  };
  H.openStation = (id) => {
    const s = SIM.byId[id]; if (!s) return;
    it.innerHTML = `${s.id} · ${s.cn}`;
    const zn = ZONES.find((z) => z.id === s.zone);
    ib.innerHTML = `<span class="chip" id="iChip"></span> <span class="cap" style="margin-left:6px">${s.en}</span>
      <div class="mgrid"><div><div class="cap">利用率</div><div class="kv"><span id="iU"></span><small>%</small></div></div><div><div class="cap">分区</div><div class="kv" style="font-size:13px">${zn ? zn.id : s.zone === 'SP' ? '脊线' : '室外'}</div></div><div><div class="cap">信标 XYZ</div><div class="kv" style="font-size:11px">${s.beacon.map((n) => n.toFixed(0)).join(', ')}</div></div></div>
      <div class="cap" id="iMsg" style="letter-spacing:.04em;text-transform:none;font-family:var(--f-cn);font-size:10.5px"></div>
      <div class="act"><button id="iFocus">聚焦 FOCUS</button>${zn ? `<button id="iZone">返回 ${zn.id}</button>` : ''}<button id="iFault">注入故障 TEST</button></div>`;
    ib.querySelector('#iFocus').onclick = (e) => { e.stopPropagation(); ctx.focusStation(id); };
    const zb = ib.querySelector('#iZone'); if (zb) zb.onclick = (e) => { e.stopPropagation(); ctx.goZone(zn.id); };
    ib.querySelector('#iFault').onclick = (e) => { e.stopPropagation(); SIM.injectFault(id); draw(); };
    const chip = ib.querySelector('#iChip'), iU = ib.querySelector('#iU'), iMsg = ib.querySelector('#iMsg');
    const draw = () => {
      chip.className = 'chip ' + s.state; chip.textContent = ST_TXT[s.state];
      iU.textContent = pct(s.util);
      iMsg.textContent = s.state === 'down' ? '告警：' + ((SIM.alarms.find((a) => a.id === s.id) || {}).msg || '—') + ' · 预计 ' + Math.max(1, Math.round(s.until - SIM.time)) + ' s 后自动复位'
        : s.state === 'idle' ? '待机：等待上游 / 缺料' : '正常运行 · 状态同步 20 Hz';
    };
    draw(); H.inspUpdate = draw; ins.classList.add('on'); measureHUD();
  };
  H.closeInspector = () => { ins.classList.remove('on'); H.inspUpdate = null; measureHUD(); };

  // ---------- dock 状态 / 视角名 ----------
  H.setActiveView = (id) => {
    document.querySelectorAll('#dock button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === id));
    for (const z of ZONES) H.zoneRows[z.id].row.classList.toggle('on', z.id === id);
    const z = ZONES.find((q) => q.id === id);
    $('#viewName').textContent = id === 'overview' ? '总览 OVERVIEW' : z ? `${z.id} ${z.cn} ${z.en}` : id;
  };
  H.setToggle = (a, on) => { const b = document.querySelector(`#dock button[data-a="${a}"]`); if (b) b.classList.toggle('on', on); };

  // ---------- 巡游字幕 ----------
  const capEl = $('#cap'), capRow = $('#capRow');
  const prog = $('#capProg');
  let acc = 0; const total = TOUR.reduce((a, s) => a + s.dur, 0);
  for (let i = 1; i < TOUR.length; i++) { acc += TOUR[i - 1].dur; const t = el('s'); t.style.left = (acc / total * 100).toFixed(2) + '%'; prog.appendChild(t); }
  H.showCaption = (on) => { capEl.classList.toggle('on', on); measureHUD(); };
  H.setChapter = (i) => {
    const s = TOUR[i];
    capRow.style.opacity = 0;
    setTimeout(() => { $('#capN').textContent = `${s.n} / ${String(TOUR.length).padStart(2, '0')}`; $('#capCn').textContent = s.cn; $('#capEn').textContent = s.en; capRow.style.opacity = 1; }, 280);
    $('#tourS').textContent = `${i + 1}/${TOUR.length} · 停止`;
    const z = ZONES.find((q) => q.cn === s.cn); $('#viewName').textContent = `巡游 ${s.n} · ${s.cn} ${s.en}`;
  };
  H.setProgress = (p) => { $('#capBar').style.width = (p * 100).toFixed(2) + '%'; };
  H.tourButton = (on) => { H.setToggle('tour', on); if (!on) $('#tourS').textContent = 'TOUR · SPACE'; };

  H.toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(H._tt); H._tt = setTimeout(() => t.classList.remove('on'), 1600); };
  H.veil = (p, msg) => { $('#vpi').style.width = (p * 100) + '%'; if (msg) $('#vps').textContent = msg; };
  return H;
}

