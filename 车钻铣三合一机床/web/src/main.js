// 入口：八章讲义 + 三维舞台的动画。章节顺序只在 CHAPTERS 里定。
import * as THREE from 'three';
import glb from '../../blender/out/ct125e.glb';
import layout from '../../blender/out/layout.json';
import { Stage, B } from './stage.js';
import * as K from './core.js';
import { makeChapter } from './make.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (html) e.innerHTML = html; return e; };
const f1 = (x, d = 1) => Number(x).toFixed(d);
const TAU = Math.PI * 2;
const EV = { k: '<span class="ev k">公认</span>', s: '<span class="ev s">参数表</span>', g: '<span class="ev g">推测</span>', a: '<span class="ev a">假设</span>' };

let S, cur = null, curIdx = 0;
const side = $('#side'), hudEl = $('#hud'), tagsEl = $('#tags');
let tags = [];

function slider(label, min, max, step, value, fmt, on) {
  const row = el('label', { class: 'ctl' });
  row.append(el('span', {}, label));
  const inp = el('input', { type: 'range', min, max, step, value });
  const out = el('output');
  row.append(inp, out);
  const upd = () => { out.textContent = fmt(+inp.value); on(+inp.value); };
  inp.addEventListener('input', upd);
  setTimeout(upd);
  return { row, inp, set: (v) => { inp.value = v; upd(); } };
}
function btnRow(items, cls = 'btn') {
  const d = el('div', { class: 'btns' });
  for (const it of items) { const b = el('button', { class: cls }, it.t); b.onclick = () => it.on(b); d.append(b); it.el = b; }
  return d;
}
function box(title) { const b = el('div', { class: 'box' }); if (title) b.append(el('h3', {}, title)); return b; }
function hud(items) { hudEl.innerHTML = items.map((s) => `<div class="chip">${s}</div>`).join(''); }
function setTags(list) {
  tags = list; tagsEl.innerHTML = '';
  for (const t of list) { t.el = el('div', { class: 'tag' }, t.text); t.el.onclick = () => showPart(S.info(S.N[t.name])); tagsEl.append(t.el); }
}
function basis(html) { return el('div', { class: 'basis' }, '<b>依据</b>　' + html); }

// ---------------------------------------------------------------- 零件信息（全局点选）
let infoEl = null;
function showPart(p) {
  if (!p) return;
  S.select(p);
  if (!infoEl || !infoEl.isConnected) { infoEl = el('div', { class: 'info' }); side.insertBefore(infoEl, side.children[3] || null); }
  const g = p.userData.guess ? ' <span class="ev g">推测</span>' : '';
  infoEl.innerHTML = `<div class="n">${p.userData.cn}${g}</div><div>${p.userData.info || ''}</div>`;
}

function resetPose() {
  Object.assign(S.pose, { spin: 0, ls: 0, car: 0, cross: 0, yaw: 0, headZ: 0, quill: 0, mill: 0, tail: 0, tq: 0, mpul: 0, hwCross: 0, hwTop: 0, hwTail: 0 });
  S.explode = 0; S.setXray(false); S.setHidden([]); S.select(null); S.resetWork(); S.work.visible = true;
  for (const h of helices) h.visible = false;
  if (vise) vise.visible = false;
}

// ---------------------------------------------------------------- 螺纹槽（多刀时每刀一条）
const helices = [];
function helix(i, x0, x1, pitch, phase, lefthand) {
  while (helices.length <= i) {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: [0x2d3138, 0x7a3030, 0x30507a, 0x6a5a20, 0x306a40, 0x5a3070][helices.length % 6], metalness: 0.7, roughness: 0.4 }));
    S.workHolder.add(m); helices.push(m);
  }
  const m = helices[i];
  const turns = Math.max(0.05, (x1 - x0) / pitch), seg = Math.max(12, Math.round(turns * 28));
  const pts = [], r = (layout.work.r - 0.25) * 0.001;
  for (let k = 0; k <= seg; k++) {
    const t = k / seg, a = (lefthand ? 1 : -1) * t * turns * TAU + phase * Math.PI / 180;
    pts.push(new THREE.Vector3((x0 + (x1 - x0) * t) * 0.001, r * Math.cos(a), r * Math.sin(a)));
  }
  m.geometry.dispose();
  m.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, Math.max(0.16, pitch * 0.26) * 0.001, 6, false);
  m.visible = true;
}

// ---------------------------------------------------------------- 钻铣用的平口钳 + 铝块
let vise = null;
function ensureVise() {
  if (vise) return vise;
  vise = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.8, roughness: 0.4 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xd4d8de, metalness: 1, roughness: 0.3 });
  const add = (m, x0, x1, y0, y1, z0, z1) => { const g = new THREE.Mesh(new THREE.BoxGeometry((x1 - x0) * 1e-3, (z1 - z0) * 1e-3, (y1 - y0) * 1e-3), m); g.position.copy(B((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)); g.castShadow = g.receiveShadow = true; vise.add(g); return g; };
  const cx = layout.carriage_x, cy = layout.cross_y0, z = layout.table_top;
  add(steel, cx - 30, cx + 30, cy - 22, cy + 22, z, z + 14);
  add(steel, cx - 30, cx + 30, cy + 14, cy + 22, z + 14, z + 27);
  add(steel, cx - 30, cx + 30, cy - 22, cy - 14, z + 14, z + 27);
  vise.block = add(alu, cx - 22, cx + 22, cy - 14, cy + 14, z + 14, z + 37);
  // 放进中拖板组（跟着 X / Y 走）。先把姿态归零再取矩阵，否则会带上上一章留下的拖板位移
  const saved = { ...S.pose };
  for (const k of Object.keys(S.pose)) S.pose[k] = 0;
  S.applyPose();
  const G = S.N.G_Cross; G.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(G.matrixWorld).invert();
  vise.applyMatrix4(inv); G.add(vise);
  vise.holes = new THREE.Group(); vise.add(vise.holes);
  vise.groove = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0031, 0.0031, 0.002, 24), new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.6 }), 1200);
  vise.groove.count = 0; vise.groove.frustumCulled = false; vise.add(vise.groove);
  vise.clearMarks = () => { vise.holes.clear(); vise.groove.count = 0; vise.groove.instanceMatrix.needsUpdate = true; vise.lastCut = null; };
  Object.assign(S.pose, saved);
  return vise;
}

// ================================================================= 章节
const CH = {};

CH.parts = {
  title: '先认识它：一台机床，三种用法',
  enter() {
    S.setView('home');
    side.append(el('p', { class: 'lead' }, '这是一台桌面大小的<b>车床</b>，头顶上又“长”出一个<b>钻铣头</b>。车削时工件转、刀不转；钻铣时刀转、工件不转。它和老款 CT125 最大的区别在丝杠：老款靠一串齿轮（挂轮）把主轴和丝杠连起来，E 版换成了<b>电子挂轮</b>——一个编码器、一块单片机、一台步进电机。后面几章就讲它。'));
    const b = box('拆开看看');
    b.append(slider('爆炸', 0, 1, 0.01, 0, (v) => Math.round(v * 100) + '%', (v) => { S.explode = v; }).row);
    const xr = btnRow([{ t: '透视外壳（看里面）', on: (e) => { S.setXray(!S.xray); e.classList.toggle('on', S.xray); if (S.xray) S.setView('inside'); } }]);
    b.append(xr, el('div', { class: 'mut' }, '点三维里的零件，或点下面的名字，看它是干什么的。虚线框的是推测件：CT125E 的内部没有公开，按同类机床的常见做法画的。'));
    side.append(b);
    const groups = { lathe: '车削部分', mill: '钻铣部分', ctrl: '操作面板', inside: '内部（大多是推测）', base: '底座和外壳' };
    const seen = new Map();
    for (const m of S.meshes) { const p = m.userData.part; if (p && p.userData.cn && !seen.has(p.userData.cn)) seen.set(p.userData.cn, p); }
    for (const [g, name] of Object.entries(groups)) {
      const bx = box(name), list = el('div', { class: 'partlist' });
      for (const [cn, p] of seen) if (p.userData.grp === g) { const bt = el('button', { class: p.userData.guess ? 'g' : '' }, cn); bt.onclick = () => showPart(p); list.append(bt); }
      bx.append(list); side.append(bx);
    }
    setTags([
      { name: 'Cabinet', text: '控制箱' }, { name: 'Headstock', text: '主轴箱' }, { name: 'Chuck_Body', text: '三爪卡盘' },
      { name: 'Saddle', text: '大拖板' }, { name: 'Cross_Base', text: '中拖板/工作台' }, { name: 'Tail_Body', text: '尾座' },
      { name: 'LeadScrew', text: '丝杠' }, { name: 'Head_Box', text: '钻铣头' }, { name: 'Column', text: '立柱' }, { name: 'Stepper_Cover', text: '步进电机罩' },
    ]);
    hud(['拖动旋转 · 双指缩放 · 点零件']);
    side.append(basis(`${EV.s} 回转直径、顶尖距、工作台尺寸、行程、转速、功率来自商品页参数表。${EV.k} 车床 / 钻铣床各部件的作用是通用知识。${EV.g} 外壳尺寸按产品图比例估；主电机、同步带、编码器、步进电机、控制板的位置没有公开资料，是推测。`));
  },
  tick(dt, t) { if (S.explode < 0.02) { S.pose.spin += dt * 1.2; S.pose.mpul = S.pose.spin * 2.6; } },
};

// ---------------------------------------------------------------- 车削
CH.turn = {
  title: '车削：工件转，刀沿着它走',
  enter() {
    S.setView('lathe');
    const st = this.st = { rpm: 900, f: 0.06, a: 0.4, mat: 'alu', ph: 'cut', x: 108, r: 9.6, tCross: 0 };
    side.append(el('p', { class: 'lead' }, '卡盘夹着铝棒转，车刀不转。大拖板带着刀从右往左走一趟，就削掉一圈薄皮；中拖板往里多进一点，再走一趟，工件就更细。<b>转速</b>决定刀和工件擦过的快慢，<b>进给</b>（每转走多少 mm）决定表面多光、一刀多快。'));
    const b = box('动手改');
    const rd = el('div', { class: 'readout' });
    b.append(slider('主轴转速', 50, 2250, 10, st.rpm, (v) => v + ' 转/分', (v) => { st.rpm = v; }).row);
    b.append(slider('进给', 0.02, 0.2, 0.01, st.f, (v) => f1(v, 2) + ' mm/转', (v) => { st.f = v; }).row);
    b.append(slider('每刀吃深', 0.1, 0.8, 0.05, st.a, (v) => f1(v, 2) + ' mm', (v) => { st.a = v; }).row);
    const mats = btnRow(Object.entries(K.MATERIALS).filter(([k]) => k !== 'wood').map(([k, m]) => ({ t: m.name, on: (e) => { st.mat = k; mats.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === e)); } })));
    mats.firstChild.classList.add('on');
    b.append(el('div', { class: 'mut' }, '材料'), mats, rd);
    side.append(b);
    this.rd = rd;
    side.append(el('div', { class: 'formula' }, '切削速度 v = π × D × n ÷ 1000   （m/分）\n进给速度   = f × n                （mm/分）\n每刀直径少 = 2 × 吃深'));
    const why = box('为什么要能调到很低的转速');
    why.append(el('div', {}, '老款 CT125 最低 560 转/分，E 版能到 50 转/分。车大直径的钢件、车螺纹、攻丝，都需要<b>慢而有劲</b>。普通交流电机降速靠换皮带挡，E 版用直流或无刷电机靠电子调速，低速也有扭矩（这一点推测，商品页只写了“无级调速”）。'));
    side.append(why);
    hud(['画面里主轴转动放慢、走刀加快 6 倍']);
    setTags([{ name: 'Tool_Tip', text: '车刀' }, { name: 'Chuck_Body', text: '卡盘' }, { name: 'LeadScrew', text: '丝杠（步进电机带）' }, { name: 'HW_Cross_Rim', text: '中拖板手轮' }]);
    side.append(basis(`${EV.k} v = πDn、进给速度 = f·n 是切削基本公式；推荐线速度取手册常见范围偏保守的值，小机床刚性差要再打折。${EV.s} 50 ~ 2250 转/分（E）、560 ~ 2500 转/分 5 挡（老款）。${EV.a} 中拖板丝杠按 1 mm/圈画手轮转角。`));
  },
  tick(dt) {
    const st = this.st, L = layout, K6 = 6;
    S.pose.spin += dt * TAU * Math.min(st.rpm, 90) / 60; S.pose.mpul = S.pose.spin * 2.6;
    const feedMMs = st.f * st.rpm / 60 * K6;
    const xL = 34, xR = 108;
    if (st.ph === 'cut') { st.x -= feedMMs * dt; S.cutTo(st.x, st.r); if (st.x <= xL) { st.x = xL; st.ph = 'retract'; st.t = 0; } }
    else if (st.ph === 'retract') { st.t += dt; if (st.t > 0.4) { st.ph = 'return'; } }
    else if (st.ph === 'return') { st.x += 40 * dt; if (st.x >= xR) { st.x = xR; st.ph = 'infeed'; st.t = 0; st.r -= st.a; if (st.r < 5) { S.resetWork(); st.r = 10 - st.a; } } }
    else if (st.ph === 'infeed') { st.t += dt; if (st.t > 0.5) st.ph = 'cut'; }
    const rTip = st.ph === 'retract' || st.ph === 'return' ? st.r + 1.5 : st.r;
    S.pose.cross += ((10 - rTip) - S.pose.cross) * Math.min(1, dt * 8);
    S.pose.hwCross = S.pose.cross * TAU;
    S.pose.car = st.x - L.carriage_x;
    S.pose.ls = (st.x - 108) / K.ASSUME.lead * TAU;
    const D = 2 * st.r, m = K.MATERIALS[st.mat];
    const v = K.surfaceSpeed(D, st.rpm), lo = K.rpmFor(D, m.v[0]), hi = K.rpmFor(D, m.v[1]);
    const ok = st.rpm >= lo * 0.8 && st.rpm <= hi;
    this.rd.innerHTML = `<span>当前直径 D</span><span>${f1(D)} mm</span><span>切削速度 v</span><span>${f1(v, 0)} m/分</span>
      <span>${m.name}推荐（这个直径）</span><span class="${ok ? 'good' : 'warn'}">${Math.round(lo)} ~ ${Math.min(2250, Math.round(hi))} 转/分</span>
      <span>进给速度 f×n</span><span>${f1(st.f * st.rpm, 0)} mm/分</span><span>丝杠转速（导程 1.5）</span><span>${f1(st.f * st.rpm / K.ASSUME.lead, 1)} 转/分</span>
      <span class="mut" style="grid-column:1/-1">${m.note}</span>`;
  },
};

// ---------------------------------------------------------------- 挂轮 vs 电子挂轮
CH.gears = {
  title: '“挂轮”是什么：主轴转一圈，刀要走一个螺距',
  enter() {
    S.setView('lathe');
    const st = this.st = { P: 1.0, t: 0 };
    side.append(el('p', { class: 'lead' }, '车螺纹的规矩只有一条：<b>主轴转 1 圈，车刀必须正好走 1 个螺距</b>。刀是丝杠推着走的，所以丝杠和主轴的转速比必须固定成 <b>螺距 ÷ 丝杠导程</b>。老式车床用几只齿轮（挂在交换齿轮架上，所以叫“挂轮”）把主轴和丝杠硬连起来；想换螺距就拆下来换一组。'));
    const b = box('选一个螺距');
    const std = btnRow([0.5, 0.7, 0.8, 1.0, 1.25, 1.5, 1.75].map((p) => ({ t: 'M ' + p, on: () => sl.set(p) })));
    const sl = slider('螺距', 0.2, 3.0, 0.05, st.P, (v) => f1(v, 2) + ' mm', (v) => { st.P = v; this.update(); });
    const tpi = btnRow([20, 24, 32, 40].map((n) => ({ t: n + ' 牙/英寸', on: () => sl.set(+K.tpi2mm(n).toFixed(3)) })));
    b.append(std, sl.row, el('div', { class: 'mut' }, '英制：'), tpi);
    side.append(b);
    this.svg = el('div'); this.out = el('div', { class: 'readout' });
    const g = box('两种做法比一比'); g.append(this.svg, this.out); side.append(g);
    side.append(el('div', { class: 'formula' }, '挂轮：  螺距 = 导程 × (A/B) × (C/D)\n电子：  每个编码器计数给 N/D 步\n        N/D = (螺距 × 步数/圈) ÷ (导程 × 计数/圈)'));
    const n = box('老款和 E 版的差别');
    n.append(el('div', {}, '老款 CT125 参数表：公制 8 种（0.4 ~ 1.5 mm）、英制 8 种、纵向进给 2 挡（0.07 / 0.14 mm/转）——这就是机器里那几组齿轮能凑出来的全部。E 版这几行都写“程序设定”：螺距是一个数字，想车 0.65 也行。代价是多了编码器、单片机、步进电机，以及它们可能出的错（下一章）。'));
    side.append(n);
    hud(['主轴转 1 圈 → 丝杠转 P/导程 圈']);
    setTags([{ name: 'Chuck_Body', text: '主轴' }, { name: 'LeadScrew', text: '丝杠' }, { name: 'Stepper_Cover', text: '步进电机（推测在这里）' }]);
    side.append(basis(`${EV.k} 螺距 = 导程 × 传动比，是车螺纹的基本关系。${EV.s} 老款 8 种公制 / 8 种英制 / 2 挡进给，E 版“程序设定”。${EV.a} 丝杠导程按 1.5 mm、挂轮齿数表按常见迷你车床的一套 20 ~ 80 齿（每种一只），CT125 实际的齿轮配置没公开。`));
    this.update();
  },
  update() {
    const P = this.st.P, g = K.searchGears(P), r = K.elsRatio(P);
    const sz = (z) => 6 + z * 0.42;
    const gearsSVG = (() => {
      // A 啮合 B；C 和 B 同轴（双联）；C 啮合 D
      const R = (z) => z / 2;
      const ra = R(g.A), rb = R(g.B), rc = R(g.C), rd = R(g.D);
      const xa = ra, xb = xa + ra + rb, xd = xb + rc + rd;
      const totalW = xd + rd, totalH = 2 * Math.max(ra, rb, rc, rd);
      const W = 420, H = 170, k = Math.min((W - 40) / totalW, (H - 50) / totalH), ox = 20, cy = 18 + (H - 40) / 2;
      const circ = (x, r, col, lab, dy = 0) => `<circle cx="${ox + x * k}" cy="${cy}" r="${r * k}" fill="${col}22" stroke="${col}" stroke-width="2" stroke-dasharray="4 2"/><text x="${ox + x * k}" y="${cy + dy}" fill="#e8eef7" font-size="12" text-anchor="middle">${lab}</text>`;
      const big = rb >= rc;
      const parts = [
        circ(xa, ra, '#4cc3ff', 'A ' + g.A),
        big ? circ(xb, rb, '#4cc3ff', 'B ' + g.B, -rb * k + 14) : '', circ(xb, rc, '#c78bff', 'C ' + g.C, big ? 4 : -rc * k + 14), !big ? circ(xb, rb, '#4cc3ff', 'B ' + g.B, 4) : '',
        circ(xd, rd, '#c78bff', 'D ' + g.D),
        `<text x="${ox + xa * k}" y="${cy + ra * k + 16}" fill="#93a4bb" font-size="11" text-anchor="middle">接主轴</text>`,
        `<text x="${ox + xd * k}" y="${cy + rd * k + 16}" fill="#93a4bb" font-size="11" text-anchor="middle">接丝杠</text>`,
      ];
      return `<svg viewBox="0 0 ${W} ${H}" width="100%">${parts.join('')}<text x="4" y="${H - 4}" fill="#93a4bb" font-size="11">B 和 C 装在同一根轴上（双联）；圈的大小 ∝ 齿数</text></svg>`;
    })();
    this.svg.innerHTML = gearsSVG;
    const err = g.err * 100;
    this.out.innerHTML = `<span>挂轮最接近的组合</span><span>${g.A}/${g.B} × ${g.C}/${g.D}</span>
      <span>车出来的螺距</span><span class="${err < 0.05 ? 'good' : err < 1 ? '' : 'warn'}">${f1(g.pitch, 4)} mm（误差 ${f1(err, 2)}%）</span>
      <span>电子挂轮比 N/D</span><span>${r.num}/${r.den}</span>
      <span>主轴 1 圈给步进</span><span>${f1(r.stepsPerRev, 2)} 步</span>
      <span>电子挂轮的螺距误差</span><span class="good">累积为 0（只有 ±1 步 = ${f1(K.ASSUME.lead / K.ASSUME.stepsRev * 1000, 2)} µm 的抖动）</span>`;
  },
  tick(dt) {
    const st = this.st;
    const sp = dt * TAU * 0.5;   // 主轴 30 转/分（画面）
    S.pose.spin += sp; S.pose.mpul = S.pose.spin * 2.6;
    S.pose.ls += sp * st.P / K.ASSUME.lead;
    st.t += dt * 0.5 * st.P;     // 走过的 mm
    if (st.t > 60) st.t = 0;
    S.pose.car = (108 - st.t) - layout.carriage_x;
  },
};

// ---------------------------------------------------------------- 电子挂轮算法
CH.els = {
  title: '电子挂轮：一个数数的小程序',
  enter() {
    S.setView('inside'); S.setXray(true);
    const st = this.st = { P: 1.0, rpm: 300, acc: 0, hist: [], tc: 0, total: 0 };
    side.append(el('p', { class: 'lead' }, '主轴尾巴上有个带缝的码盘，转一圈让读头发出固定数目的脉冲（这里假设 4000 个计数）。单片机<b>每收到一个计数，就往一个累加器里加 N</b>；累加器一满 D，就减掉 D、给步进电机发<b>一步</b>。N/D 就是“挂轮比”。这就是画直线的 Bresenham 算法，全程只用整数，所以车 100 圈也不会差出一丝。'));
    const b = box('动手改');
    b.append(slider('螺距 P', 0.25, 3, 0.05, st.P, (v) => f1(v, 2) + ' mm', (v) => { st.P = v; st.acc = 0; st.hist = []; this.ratio = K.elsRatio(v); }).row);
    b.append(slider('主轴转速', 50, 2250, 10, st.rpm, (v) => v + ' 转/分', (v) => { st.rpm = v; }).row);
    this.cv = el('canvas', { class: 'plot', width: 840, height: 300 });
    this.rd = el('div', { class: 'readout' });
    b.append(this.cv, el('div', { class: 'mut' }, '<span class="enc">■</span> 编码器计数　<span class="vio" style="color:var(--vio)">■</span> 累加器（满 D 就出一步）　<span class="stp">■</span> 步进脉冲'), this.rd);
    side.append(b);
    side.append(el('div', { class: 'formula' }, `// 编码器每来一个计数（中断里跑）
acc += N;              // N = P × 步数/圈
while (acc >= D) {     // D = 导程 × 计数/圈
    acc -= D;
    step_pulse(dir);   // 给驱动器一个 STEP
}`));
    const lim = box('什么时候会失效');
    lim.append(el('div', {}, '① <b>主轴太快</b>：步进电机转速 = 主轴转速 × P ÷ 导程。开环步进电机转快了扭矩掉得厉害，带不动就<b>丢步</b>，而它自己不知道——这一圈螺纹就乱了。上面读数里的“最高主轴转速”就是这个限制（按 600 转/分估）。所以车螺纹都用低速。<br>② <b>编码器读错</b>：电机干扰让读头多数、少数一个计数，误差会一直留着。要用 A/B 两相 + 屏蔽。<br>③ <b>机械间隙</b>：丝杠和螺母之间的间隙、皮带弹性，电子挂轮管不到，只能靠单方向走刀消除。<br>④ <b>换向</b>：反转退刀时只要不丢计数，回来还在同一条线上；一断电就丢了。'));
    side.append(lim);
    const dir = box('同一件事的三种做法');
    dir.append(el('div', {}, '<b>A. 开环步进跟随编码器</b>（最主流：同类小车床的电子挂轮和 DIY 的 ELS 项目大多这样做；推测 CT125E 也是）——便宜、简单；缺点是丢步不知道。<br><b>B. 闭环步进 / 伺服</b>——电机后面再加一个编码器，跟不上会报警或追回来；多花几百元，适合要车长螺纹、钢件的人。<br><b>C. 整机数控</b>——主轴编码器 + 插补器，按 G 代码车螺纹（G32 / G76）。下面专利里 1976 年那件就是这条路；能车锥螺纹、多头螺纹，但要编程。'));
    side.append(dir);
    hud(['透视模式：码盘、步进电机高亮']);
    setTags([{ name: 'Encoder_Disc', text: '编码器码盘' }, { name: 'Encoder_Sensor', text: '读头' }, { name: 'Board_PCB', text: '控制板' }, { name: 'Stepper', text: '步进电机' }, { name: 'LeadScrew', text: '丝杠' }]);
    side.append(basis(`${EV.k} 用整数累加器做分数比的脉冲分频（DDA / Bresenham）是电子齿轮的标准做法；步进电机高速扭矩下降、开环丢步是公认特性。${EV.a} 4000 计数/圈、1600 步/圈、导程 1.5 mm、步进 600 转/分上限都是同类产品的常见值，CT125E 的实际值没公开。${EV.g} CT125E 内部是否开环没有资料。`));
    this.ratio = K.elsRatio(st.P);
    S.select(S.info(S.N.Encoder_Disc));
  },
  tick(dt) {
    const st = this.st, r = this.ratio;
    // 画面主轴放慢：真转速 / 20，最高 0.8 转/秒
    const vis = Math.min(st.rpm / 60 / 20, 0.8);
    S.pose.spin += dt * TAU * vis; S.pose.mpul = S.pose.spin * 2.6;
    S.pose.ls += dt * TAU * vis * st.P / K.ASSUME.lead;
    // 波形：每秒推进约 10 个计数，看得清
    st.tc += dt * 10;
    while (st.tc >= 1) {
      st.tc -= 1; st.acc += r.num; let s = 0;
      while (st.acc >= r.den) { st.acc -= r.den; s++; }
      st.hist.push({ acc: st.acc, s }); if (st.hist.length > 42) st.hist.shift(); st.total++;
    }
    this.draw();
    const ld = K.loads(st.rpm, st.P);
    this.rd.innerHTML = `<span>N / D</span><span>${r.num} / ${r.den}</span>
      <span>主轴 1 圈 → 步进</span><span>${f1(r.stepsPerRev, 1)} 步</span>
      <span>编码器计数频率</span><span>${f1(ld.encHz / 1000, 1)} kHz</span>
      <span>步进脉冲频率</span><span>${f1(ld.stepHz / 1000, 2)} kHz</span>
      <span>步进电机转速</span><span class="${ld.ok ? 'good' : 'warn'}">${f1(ld.motorRpm, 0)} 转/分${ld.ok ? '' : '（会丢步）'}</span>
      <span>这个螺距的最高主轴转速</span><span>${f1(Math.min(2250, ld.maxRpm), 0)} 转/分</span>
      <span>一步走多少</span><span>${f1(ld.stepRes * 1000, 2)} µm</span>`;
  },
  draw() {
    const c = this.cv, g = c.getContext('2d'), W = c.width, H = c.height, h = this.st.hist, r = this.ratio;
    g.clearRect(0, 0, W, H);
    const n = 42, dx = (W - 60) / n, x0 = 50;
    g.font = '20px sans-serif'; g.fillStyle = '#93a4bb';
    g.fillText('计数', 4, 50); g.fillText('累加', 4, 160); g.fillText('步进', 4, 270);
    h.forEach((e, i) => {
      const x = x0 + i * dx;
      g.fillStyle = '#ffb547'; g.fillRect(x, 30, dx * 0.45, 34);
      const hh = (e.acc / r.den) * 110;
      g.fillStyle = '#c78bff'; g.fillRect(x, 200 - hh, dx * 0.7, hh);
      if (e.s) { g.fillStyle = '#58e0a0'; g.fillRect(x, 238, dx * 0.45, 40); }
    });
    g.strokeStyle = '#ff7066'; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(x0, 90); g.lineTo(W - 6, 90); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ff7066'; g.fillText('D', W - 26, 84);
  },
};

// ---------------------------------------------------------------- 车螺纹
CH.thread = {
  title: '车螺纹：每一刀都要踩进同一条槽',
  enter() {
    S.setView('thread');
    const st = this.st = { P: 1.0, n: 4, sync: true, lh: false, k: 0, ph: 'wait', x: 106, phases: [], t: 0, wait: 0, speed: 1 };
    side.append(el('p', { class: 'lead' }, '螺纹一刀车不出来，要分 4 ~ 8 刀一点点加深。问题是：<b>第二刀怎么保证落在第一刀的槽里？</b> 码盘上除了 4000 个计数，还有一个“零点”脉冲，每圈一次。每一刀开始前，单片机先<b>等零点脉冲</b>，等到了才让丝杠开始走——这样每一刀起步时主轴都在同一个角度。'));
    const b = box('动手试');
    b.append(slider('螺距', 0.5, 2, 0.25, st.P, (v) => f1(v, 2) + ' mm', (v) => { st.P = v; this.restart(); }).row);
    const tg = btnRow([
      { t: '每刀等零点脉冲 ✓', on: (e) => { st.sync = !st.sync; e.textContent = st.sync ? '每刀等零点脉冲 ✓' : '不等零点脉冲 ✗'; e.classList.toggle('on', st.sync); this.restart(); } },
      { t: '右旋', on: (e) => { st.lh = !st.lh; e.textContent = st.lh ? '左旋（丝杠反转）' : '右旋'; this.restart(); } },
      { t: '重新开始', on: () => this.restart() },
      { t: '快进 ×3', on: (e) => { st.speed = st.speed === 1 ? 3 : 1; e.classList.toggle('on', st.speed > 1); } },
    ]);
    tg.firstChild.classList.add('on');
    this.cv = el('canvas', { class: 'plot', width: 840, height: 260 });
    this.rd = el('div', { class: 'readout' });
    b.append(tg, this.cv, el('div', { class: 'mut' }, '上图是螺纹的纵剖面：每种颜色是一刀切出的牙槽。对齐时叠成一个干净的 60° 牙；不对齐就“乱扣”。三维里每一刀也用同色螺旋线画出来。'), this.rd);
    side.append(b);
    const n = box('电子挂轮比老式车床多出来的方便');
    n.append(el('div', {}, '老式车床靠开合螺母和“螺纹指示盘”找时机合上，螺距和丝杠不成整数比时只能不开螺母、开反车退回。电子挂轮里，退刀就是让步进电机反转、继续数着计数退回来；只要计数不丢，下一刀照样在同一条线上。左旋螺纹只要让丝杠反方向转，不用加惰轮。'));
    side.append(n);
    hud(['画面里车螺纹的速度是示意']);
    setTags([{ name: 'Tool_Tip', text: '螺纹车刀' }, { name: 'Encoder_Disc', text: '零点脉冲来自码盘' }]);
    side.append(basis(`${EV.k} 多刀车螺纹必须保持主轴角度和刀位同步，用主轴一转信号（零点 / Z 相）对齐是数控车床通行做法；60° 公制外螺纹牙高约 0.613P。${EV.g} CT125E 退刀和对零点的具体操作流程没公开，以说明书为准。`));
    this.restart();
  },
  restart() {
    const st = this.st; st.k = 0; st.ph = 'wait'; st.x = 106; st.t = 0; st.wait = 0;
    st.phases = K.passPhases(st.n, st.sync, 7 + Math.floor(Math.random() * 99));
    for (const h of helices) h.visible = false;
    this.draw();
  },
  tick(dt) {
    const st = this.st, L = layout, sp = 1.5 * st.speed;    // 画面主轴 1.5 转/秒
    const dSpin = dt * TAU * sp;
    S.pose.spin += dSpin; S.pose.mpul = S.pose.spin * 2.6;
    const ang = ((S.pose.spin / TAU) % 1) * 360;
    const x0 = 106, x1 = 72, depth = K.threadDepth(st.P);
    if (st.ph === 'wait') {   // 等零点（或者随便哪个角度就开）
      const target = st.phases[st.k] || 0;
      st.wait += dt;
      const d = ((ang - target) % 360 + 360) % 360;
      if (st.wait > 0.2 && d < dSpin * 180 / Math.PI + 1) { st.ph = 'cut'; st.startAng = S.pose.spin; }
    } else if (st.ph === 'cut') {
      st.x = x0 - (S.pose.spin - st.startAng) / TAU * st.P;
      S.pose.ls = -(x0 - st.x) / K.ASSUME.lead * TAU * (st.lh ? -1 : 1);
      if (st.lh) st.x = x0 - (S.pose.spin - st.startAng) / TAU * st.P;   // 刀仍然从右往左走，丝杠方向示意
      const phaseDeg = ((st.startAng / TAU) % 1) * 360;
      helix(st.k, Math.max(st.x, x1), x0, st.P, -phaseDeg + 0, st.lh);
      if (st.x <= x1) { st.ph = 'back'; st.t = 0; this.draw(); }
    } else if (st.ph === 'back') {
      st.x += 30 * dt * st.speed;
      if (st.x >= x0) { st.x = x0; st.k++; st.ph = st.k >= st.n ? 'done' : 'wait'; st.wait = 0; this.draw(); }
    } else if (st.ph === 'done') { st.t += dt; if (st.t > 3) this.restart(); }
    const r = st.ph === 'back' ? L.work.r + 1.5 : L.work.r - depth * Math.sqrt((st.k + 1) / st.n) * 0.3;
    S.pose.cross += ((10 - r) - S.pose.cross) * Math.min(1, dt * 10);
    S.pose.car = st.x - L.carriage_x;
    S.pose.hwCross = S.pose.cross * TAU;
    this.rd.innerHTML = `<span>第几刀</span><span>${Math.min(st.k + 1, st.n)} / ${st.n}</span><span>牙深（60° 公制）</span><span>${f1(depth, 3)} mm</span>
      <span>这一刀起步角度</span><span>${st.phases[Math.min(st.k, st.n - 1)] !== undefined ? f1(st.phases[Math.min(st.k, st.n - 1)], 0) + '°' : '-'}</span>`;
  },
  draw() {
    const c = this.cv, g = c.getContext('2d'), W = c.width, H = c.height, st = this.st;
    g.clearRect(0, 0, W, H);
    const P = st.P, px = W / 6.2 / P * 1.0, top = 50, depth = K.threadDepth(P), dpx = 140 / 1.0;
    const cols = ['#4cc3ff', '#ff7066', '#ffb547', '#58e0a0', '#c78bff', '#e8eef7'];
    g.fillStyle = '#5b6573'; g.fillRect(0, top, W, H - top);
    g.font = '20px sans-serif'; g.fillStyle = '#93a4bb'; g.fillText('工件表面', 8, 36);
    const done = Math.min(st.k + (st.ph === 'cut' ? 1 : 0), st.n);
    for (let k = 0; k < done; k++) {
      const shift = (st.phases[k] / 360) * P;
      const dk = depth * Math.sqrt((k + 1) / st.n);
      g.fillStyle = cols[k % 6] + 'cc';
      for (let i = -1; i < 8; i++) {
        const xc = (i * P + shift + 0.5) * px * 1.0;
        const half = dk * Math.tan(Math.PI / 6) * px;
        g.beginPath(); g.moveTo(xc - half, top); g.lineTo(xc + half, top); g.lineTo(xc, top + dk * dpx); g.closePath(); g.fill();
      }
    }
    g.fillStyle = '#e8eef7'; g.fillText(st.sync ? '每刀从同一角度起步 → 槽叠在一起' : '起步角度随机 → 槽错开（乱扣）', 8, H - 12);
  },
};

// ---------------------------------------------------------------- 钻铣
CH.mill = {
  title: '钻铣：把头转过来，拖板当工作台',
  enter() {
    S.setView('mill');
    ensureVise(); vise.visible = true;
    S.setHidden(['ToolPost', 'Tool_', 'TopSlide', 'HW_Top']); S.work.visible = false;
    S.pose.car = layout.mill_x - layout.carriage_x;
    const st = this.st = { yaw: 0, headZ: -45, quill: 0, mode: 'idle', t: 0, d: 6, rpm: 1500 };
    side.append(el('p', { class: 'lead' }, '钻铣时把四方刀架卸掉，平口钳压在中拖板的 T 形槽上。现在<b>刀转、工件不转</b>：钻铣头里的主轴带着钻头或立铣刀转，套筒往下伸就是钻孔；工件则由大拖板（左右 X）和中拖板（前后 Y）推着走，铣刀就在它上面“啃”出槽。钻铣头能绕立柱转一整圈，也能整体升降 60 mm。'));
    const b = box('动手改');
    this.sYaw = slider('绕立柱转', -180, 180, 1, 0, (v) => v + '°', (v) => { st.yaw = v; });
    this.sZ = slider('钻铣头升降', -60, 0, 1, -45, (v) => v + ' mm', (v) => { st.headZ = v; });
    this.sQ = slider('套筒下伸', 0, 40, 0.5, 0, (v) => f1(v, 1) + ' mm', (v) => { st.quill = v; });
    b.append(this.sYaw.row, this.sZ.row, this.sQ.row);
    b.append(btnRow([
      { t: '钻孔演示', on: () => { this.sYaw.set(0); this.sZ.set(-60); this.sQ.set(0); st.mode = 'drill'; st.t = 0; vise.clearMarks(); S.setView('drill'); setTags([{ name: 'Head_Box', text: '钻铣头' }, { name: 'Quill_Lever', text: '套筒进给手柄' }]); } },
      { t: '铣槽演示', on: () => { this.sYaw.set(0); this.sZ.set(-60); this.sQ.set(0); st.mode = 'mill'; st.t = 0; vise.clearMarks(); S.setView('drill'); setTags([{ name: 'Head_Box', text: '钻铣头' }, { name: 'Quill_Lever', text: '套筒进给手柄' }]); } },
      { t: '停', on: () => { st.mode = 'idle'; } },
      { t: '转开，让出车削', on: () => { st.mode = 'idle'; this.sYaw.set(110); this.sZ.set(0); } },
      { t: '转回工作台上方', on: () => { this.sYaw.set(0); this.sZ.set(-45); } },
    ]));
    side.append(b);
    const c = box('铣刀该开多快');
    c.append(slider('刀具直径', 1, 6, 0.5, 6, (v) => f1(v, 1) + ' mm', (v) => { st.d = v; this.calc(); }).row);
    this.rd = el('div', { class: 'readout' }); c.append(this.rd); side.append(c);
    const lim = box('它的边界在哪');
    lim.append(el('div', {}, '• <b>最大钻 6 mm</b>、电机 200 W：铝、铜、塑料没问题，钢件只能小刀浅吃。<br>• <b>工作台只有 85 × 60</b>，X 行程靠大拖板，Y 行程是中拖板那一点点（参数表没写，按产品图估计几十毫米）。<br>• <b>刚性</b>：钻铣头悬在 125 mm 外，中拖板本来是为车削设计的，铣削时容易振，吃刀要比专门的铣床浅得多。<br>• 头能转 360° 的好处是不用拆就能让开；代价是每次转回来都要重新对刀（找主轴中心）。'));
    side.append(lim);
    hud(['刀架已卸下，平口钳装在 T 形槽上']);
    setTags([{ name: 'Head_Box', text: '钻铣头' }, { name: 'Column', text: '立柱（绕它转）' }, { name: 'Quill_Lever', text: '套筒进给手柄' }, { name: 'Cross_Base', text: '85×60 工作台' }]);
    side.append(basis(`${EV.s} 最大钻孔 6 mm、主轴端到台面 180 mm、主轴中心到立柱 125 mm、绕立柱 360°、升降 60 mm、套筒 40 mm、台面 85 × 60、T 形槽 8 mm × 2、50 ~ 2250 转/分。${EV.k} 铣削转速 n = 1000v ÷ (πD)。${EV.g} 平口钳和铝块是示意；钻铣头和车床主轴是一台电机切换还是两台电机，资料不足（图上有“主 / 铣切换”开关）。`));
    this.calc();
  },
  // 刀尖要伸进铝块 mm 深时，套筒该伸出多少（钻铣头已经降到 st.headZ）
  quillFor(mm) {
    const L = layout, tip0 = L.head_z0 + this.st.headZ - 84;   // 立铣刀刃底在头底下 84 mm
    const top = L.table_top + 37;                              // 平口钳 14 + 铝块 23
    return Math.max(0, Math.min(40, tip0 - (top - mm)));
  },
  // 刀刃在铝块顶面以下、又在铝块范围内时，在刀轴位置印一个刀径大小的圆；走过的路连成槽
  markCut() {
    const L = layout, tip = L.head_z0 + S.pose.headZ - 84 - S.pose.quill, top = L.table_top + 37;
    if (tip > top - 0.2) { vise.lastCut = null; return; }
    const flute = S.N.EndMill_Flute; if (!flute) return;
    S.applyPose(); S.root.updateMatrixWorld(true);
    const p = new THREE.Vector3(); flute.getWorldPosition(p); vise.holes.worldToLocal(p);
    const b = vise.block.position;
    if (Math.abs(p.x - b.x) > 0.022 + 0.003 || Math.abs(p.z - b.z) > 0.014 + 0.003) { vise.lastCut = null; return; }
    const add = (x, z) => {
      const g = vise.groove; if (g.count >= g.instanceMatrix.count) return;
      g.setMatrixAt(g.count++, new THREE.Matrix4().makeTranslation(x, b.y + 0.0115 - 0.001 + 0.0003, z));
      g.instanceMatrix.needsUpdate = true;
    };
    const last = vise.lastCut;
    if (!last) add(p.x, p.z);
    else {   // 一帧走得多时中间补点，槽才连续
      const d = Math.hypot(p.x - last.x, p.z - last.z), n = Math.floor(d / 0.0004);
      if (n < 1) return;
      for (let i = 1; i <= n; i++) add(last.x + (p.x - last.x) * i / n, last.z + (p.z - last.z) * i / n);
    }
    vise.lastCut = { x: p.x, z: p.z };
  },
  // 孔打在刀尖此刻真正对着的位置：取刀具的世界坐标，换到铝块的坐标系里
  markHole(k) {
    const flute = S.N.EndMill_Flute; if (!flute) return;
    S.applyPose(); S.root.updateMatrixWorld(true);
    const p = new THREE.Vector3(); flute.getWorldPosition(p);
    vise.holes.worldToLocal(p);
    const top = vise.block.position.y + 0.0115;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0031, 0.0031, 0.008, 24), new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.6 }));
    m.position.set(p.x, top - 0.004 + 0.0003, p.z); m.userData.k = k; vise.holes.add(m);
  },
  calc() {
    const d = this.st.d;
    const al = K.rpmFor(d, 90), st = K.rpmFor(d, 25);
    this.rd.innerHTML = `<span>铝（v≈90 m/分）</span><span>${Math.round(Math.min(al, 99999))} 转/分 ${al > 2250 ? '<span class="warn">→ 机器上限 2250</span>' : ''}</span>
      <span>低碳钢（v≈25 m/分）</span><span>${Math.round(st)} 转/分</span>
      <span class="mut" style="grid-column:1/-1">小直径刀具在铝上本该转得更快，2250 转/分是它的天花板——只能把进给放慢来补。</span>`;
  },
  tick(dt) {
    const st = this.st, L = layout;
    st.t += dt;
    let quill = st.quill;
    S.pose.car = (L.mill_x - L.carriage_x);
    let cross = 0;
    if (st.mode === 'drill') {
      const cyc = 3.2, k = Math.floor(st.t / cyc) % 4, u = (st.t % cyc) / cyc;
      const holes = [[-12, -7], [12, -7], [12, 7], [-12, 7]];   // 工作台相对“对中位置”的位移（mm）
      const prev = holes[(k + 3) % 4], w = k === 0 && st.t < cyc ? 1 : Math.min(1, u / 0.15);
      S.pose.car += prev[0] + (holes[k][0] - prev[0]) * w;
      cross = prev[1] + (holes[k][1] - prev[1]) * w;
      const depth = this.quillFor(8);   // 钻 8 mm 深
      quill = u < 0.15 ? 0 : u < 0.55 ? depth * (u - 0.15) / 0.4 : u < 0.65 ? depth : u < 0.85 ? depth * (1 - (u - 0.65) / 0.2) : 0;
      if (u > 0.55 && u < 0.65 && !vise.holes.children.some((h) => h.userData.k === k)) this.pendingHole = k;   // 等下面拖板姿态更新完再打
      if (st.t > cyc * 4) { st.t = 0; vise.clearMarks(); }
    } else if (st.mode === 'mill') {
      // 工作台相对“对中位置”的位移（mm）；刀相对铝块走的是反方向的同一个矩形
      const pts = [[-12, -6], [12, -6], [12, 6], [-12, 6], [-12, -6]];
      const T_PLUNGE = 1.2, T_LOOP = 12, T_UP = 1.0, T_SHOW = 3.0;
      let tt = st.t, u = 0;
      if (tt < T_PLUNGE) { quill = this.quillFor(2) * tt / T_PLUNGE; u = 0; }
      else if ((tt -= T_PLUNGE) < T_LOOP) { quill = this.quillFor(2); u = tt / T_LOOP; }
      else if ((tt -= T_LOOP) < T_UP) { quill = this.quillFor(2) * (1 - tt / T_UP); u = 1; }
      else if ((tt -= T_UP) < T_SHOW) { quill = 0; u = 1; }
      else { st.t = 0; vise.clearMarks(); u = 0; quill = 0; }
      const s = Math.min(u * 4, 3.9999), seg = Math.floor(s), w = s - seg;
      S.pose.car += pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * w;
      cross = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * w;
    }
    S.pose.cross = cross; S.pose.hwCross = cross * TAU;
    if (this.pendingHole !== undefined && this.pendingHole !== null) { this.markHole(this.pendingHole); this.pendingHole = null; }
    S.pose.yaw += ((st.yaw * Math.PI / 180) - S.pose.yaw) * Math.min(1, dt * 5);
    S.pose.headZ += (st.headZ - S.pose.headZ) * Math.min(1, dt * 5);
    S.pose.quill += (quill - S.pose.quill) * Math.min(1, dt * 8);
    if (st.mode !== 'idle' || st.quill > 0) S.pose.mill += dt * TAU * 3;
    if (st.mode === 'mill' || st.quill > 0) this.markCut();
    S.pose.ls = (S.pose.car) / K.ASSUME.lead * TAU;
  },
};

// ---------------------------------------------------------------- 参数
CH.spec = {
  title: '参数：老款和 E 版差在哪',
  enter() {
    S.setView('front');
    side.append(el('p', { class: 'lead' }, '下面是商品页“产品参数”里的数字，左边一列是这些数字在机器上指的是哪儿。E 版改的全是“驱动和控制”那几行：电机变大、调速变无级、螺纹和进给变成程序设定；机械尺寸一样。'));
    const rows = [
      ['床身回转直径', '125 mm', '工件最大直径（在床面上方）；主轴中心比床面高 62.5'],
      ['两顶尖距离', '180 mm', '能夹多长的工件'],
      ['中拖板回转直径', '60 mm', '工件越过拖板时的最大直径'],
      ['主轴通孔 / 锥孔', '9 mm / MT1', '细棒能从主轴里穿过去；MT1 莫氏锥'],
      ['尾座套筒行程 / 锥孔', '18 mm / MT1', ''],
      ['主轴转速', '老款 560 ~ 2500，5 挡<br>E：50 ~ 2250，无级', 'E 版低速好得多，车螺纹、车钢件更从容'],
      ['公制螺纹', '老款 8 种 0.4 ~ 1.5<br>E：程序设定', '电子挂轮'],
      ['英制螺纹', '老款 8 种<br>E：程序设定', ''],
      ['纵向进给', '老款 0.07 / 0.14 mm/转<br>E：程序设定', ''],
      ['电机功率', '老款 120 W　E：200 W', ''],
      ['最大钻孔直径', '6 mm', ''],
      ['主轴端面至工作台', '180 mm', '能放多高的工件 + 夹具'],
      ['主轴中心至立柱表面', '125 mm', '“喉深”，决定头能伸多远'],
      ['钻铣头绕立柱回转', '360°', ''],
      ['钻铣头升降 / 套筒行程', '60 mm / 40 mm', ''],
      ['工作台 / T 形槽', '85 × 60 mm / 8 mm', '就是中拖板'],
      ['钻铣主轴转速', '老款 500 ~ 2500，10 挡<br>E：50 ~ 2250，无级', ''],
      ['主轴径向跳动', '近端至 100 mm 处 0.01 ~ 0.02 mm', '精度指标'],
    ];
    const t = el('table');
    t.innerHTML = '<tr><th>项目</th><th>参数</th><th>说明</th></tr>' + rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="mut">${r[2]}</td></tr>`).join('');
    const b = box(); b.append(t); side.append(b);
    const can = box('适合 / 不适合');
    can.append(el('div', {}, '<b>适合</b>：铝、黄铜、塑料、木头的小零件；航模、钟表零件；教学演示；车 M3 ~ M10 左右的螺纹。<br><b>吃力</b>：钢件（能车，但要小吃刀、低速）、直径接近 125 的盘件、长于 180 的轴。<br><b>不适合</b>：大余量铣削、需要高刚性的平面铣、批量生产。'));
    side.append(can);
    hud(['参数来自商品页截图']);
    setTags([]);
    side.append(basis(`${EV.s} 全部数字来自商品页“产品参数”截图，商品页注明参数可能随产品更新而变。厂家英文站把 CT125E 称作 7 寸电子挂轮车铣一体机。${EV.k} “适合 / 不适合”是按 200 W 和这个尺寸的常识判断，不是厂家说法。`));
  },
  tick(dt) { S.pose.spin += dt * 0.6; },
};

// ---------------------------------------------------------------- 专利
const PATENTS = [
  { g: '电子挂轮（主轴和进给同步）', n: 'US4079235A', t: 'Computer numerically controlled threadcutting machine tool', who: 'McDonnell Douglas，1976 年申请，1978 年公开（已过期）',
    s: '数控车螺纹：主轴上的旋转变压器给出角度和速度，插补计算机每隔几毫秒、在主轴转到预定角度时重算丝杠伺服的速度指令，所以多刀车螺纹不乱扣。背景部分对比了两种老办法：主轴和丝杠机械硬连，以及把主轴发出的脉冲直接送给丝杠上的步进电机——后者就是今天小车床电子挂轮的雏形。', rel: '第 4、5 章讲的“按主轴角度驱动丝杠”和“三种做法”里的 C。' },
  { g: '电子挂轮（主轴和进给同步）', n: 'JPS5633249A', t: 'Synchronous operation control system for electric motor', who: 'FANUC，1979 年优先权，1981 年公开',
    s: '攻丝时让主轴转动和进给严格按螺距同步，避免丝锥被拉长或挤压，提高螺纹精度、减少丝锥损坏。思路和车螺纹一样：进给量 = 螺距 × 主轴转数。', rel: '同一个“比例同步”原理用在攻丝上。' },
  { g: '电子挂轮（主轴和进给同步）', n: 'US4571687A', t: 'Screw cutting control system', who: 'Fujitsu Fanuc，1980 年优先权，1986 年公开',
    s: '数控机床车螺纹的控制系统，目标是提高螺纹精度、简化控制。（这里只核对了摘要，细节请看原文。）', rel: '数控车螺纹控制的早期专利之一。' },
  { g: '电子挂轮（主轴和进给同步）', n: 'US5307549A', t: 'Apparatus and method for synchronized control of machine tools', who: '申请人和日期见原文',
    s: '主轴夹着预钻孔的工件转，丝锥由一台电机驱动转动、另一台电机驱动进退，两台电机都直连编码器，控制器做负反馈，按设定深度把螺纹攻进去。', rel: '对应“三种做法”里的 B：执行电机自己也带编码器，闭环。' },
  { g: '电机 + 手轮并存', n: 'CN2406752Y', t: '车床电动尾架', who: '1999 年申请（已失效）',
    s: '在传统尾架丝杠上加一套传动机构和步进（或伺服）电机，由单轴数控控制；电机不工作时手轮仍可手动。', rel: '和 CT125E 的丝杠一样：步进电机直接带丝杠，手轮保留。' },
  { g: '车钻铣三合一结构', n: 'US1620522A', t: 'Combined lathe, drilling and milling machine', who: '1921 年申请',
    s: '车床床身一端支在箱形立柱上，主轴箱装在立柱这一头，立柱正面挂铣床升降台；可以在卧铣、立铣、钻之间转换，几种加工能同时进行。', rel: '“车床 + 立柱 + 钻铣”合在一台机器上的早期思路。' },
  { g: '车钻铣三合一结构', n: 'US2341061A', t: 'Combination machine', who: '1941 年申请',
    s: '一根可绕自身轴线转动的立柱，上面套一个能上下移动的万能动力头，动力头可以转到立柱周围任意位置（360°），换几个附件就能钻、镗、铣、攻丝，还能搭成普通车床。', rel: '和 CT125E“钻铣头绕立柱 360° + 升降 60 mm”是同一种布局思路。' },
  { g: '车钻铣三合一结构', n: 'US5885199A', t: 'Compact machining center for multifunction', who: 'Wenyuan Shao（个人），1996 年优先权，1999 年公开（已失效）',
    s: '另一条路线：工件主轴不动或只沿 Z 走，车刀固定在框形刀库上，刀库另一部分装带动力的刀轴，能绕 A 轴摆角度来钻、铣、滚齿。', rel: '对比用：它是“刀去找工件”，CT125E 是“头转过来、拖板当工作台”。' },
  { g: '小型 / 教学车床', n: 'CN104841952A', t: '一种小型车床', who: '中国发明专利申请',
    s: '床身、床脚、小刀架、电机皮带传动的主轴箱和尾座，强调小巧、可搬动，用于教学模型、实验室和模型爱好者。', rel: '和 CT125E 的目标用户（教学、DIY）一样。' },
  { g: '工业级对照', n: 'CN205393994U', t: '一种车钻铣一体化的高速数控机床', who: '中国实用新型',
    s: 'X / Y / Z 三根丝杠 + 自动换刀，在一台数控机床上完成车、钻、铣。', rel: '同样叫“车钻铣一体”，工业版靠数控和换刀，CT125E 靠手动 + 电子挂轮。' },
  { g: '工业级对照', n: 'CN203665074U', t: '主轴升降式数控车钻铣复合加工机床', who: '中国实用新型',
    s: '框式立柱上的主轴箱可升降，工作台上立着排刀座和动力钻铣主轴。', rel: '复合机床的另一种布局。' },
];
CH.patent = {
  title: '公开专利：这些想法从哪来',
  enter() {
    S.setView('home');
    side.append(el('p', { class: 'lead' }, '没有检索到 CT125E 厂家名下的专利。“电子挂轮”是商品上的叫法，专利里一般写作<b>螺纹切削同步</b>、<b>电子齿轮</b>、<b>主轴与进给同步</b>。下面按主题列出和这台机器原理最相关的公开专利，点编号打开 Google Patents 原文。'));
    let g0 = '';
    for (const p of PATENTS) {
      if (p.g !== g0) { side.append(el('div', { class: 'chno' }, p.g)); g0 = p.g; }
      side.append(el('div', { class: 'pat' }, `<a href="https://patents.google.com/patent/${p.n}" target="_blank" rel="noopener">${p.n}</a>　<span class="t">${p.t}</span><div class="m">${p.who}</div><div>${p.s}</div><div class="m">和这台机器的关系：${p.rel}</div>`));
    }
    hud(['专利摘要是转述，不是原文']);
    setTags([]);
    side.append(basis(`${EV.k} 专利信息来自 Google Patents 的著录项和摘要（法律状态是 Google 的估计，不是法律结论）。“和这台机器的关系”是我的对照解读，不代表 CT125E 用了这些专利。`));
  },
  tick(dt) { S.pose.spin += dt * 0.6; },
};

const CHAPTERS = ['parts', 'turn', 'gears', 'els', 'thread', 'mill', 'make', 'spec', 'patent'];
const SHORT = { parts: '认识它', turn: '车削', gears: '挂轮', els: '电子挂轮', thread: '车螺纹', mill: '钻铣', make: '做零件', spec: '参数', patent: '专利' };

function go(i) {
  if (cur && cur.exit) cur.exit();
  curIdx = i; const id = CHAPTERS[i]; cur = CH[id];
  resetPose();
  side.innerHTML = ''; infoEl = null;
  side.append(el('div', { class: 'chno' }, `第 ${i + 1} 章 / 共 ${CHAPTERS.length} 章`), el('h2', {}, cur.title));
  cur.enter();
  const nav = el('div', { class: 'btns' });
  if (i > 0) { const b = el('button', { class: 'btn' }, '← ' + SHORT[CHAPTERS[i - 1]]); b.onclick = () => go(i - 1); nav.append(b); }
  if (i < CHAPTERS.length - 1) { const b = el('button', { class: 'btn on' }, '下一章：' + SHORT[CHAPTERS[i + 1]] + ' →'); b.onclick = () => go(i + 1); nav.append(b); }
  side.append(nav);
  side.scrollTop = 0;
  document.querySelectorAll('#nav button').forEach((b, k) => b.classList.toggle('on', k === i));
  try { history.replaceState(null, '', '#' + id); } catch (e) { /* 预览环境可能不允许 */ }
}

async function main() {
  S = new Stage($('#c'), layout);
  await S.init(glb);
  CH.make = makeChapter({ S, layout, el, box, btnRow, hud, setTags, basis, EV, B, side, tags: () => tags });
  $('#loading').remove();
  const nav = $('#nav');
  CHAPTERS.forEach((id, i) => { const b = el('button', {}, `<b>${i + 1}</b>${SHORT[id]}`); b.onclick = () => go(i); nav.append(b); });
  const views = $('#views');
  for (const [k, t] of [['home', '全景'], ['lathe', '车削'], ['inside', '内部'], ['mill', '钻铣']]) { const b = el('button', {}, t); b.onclick = () => S.setView(k); views.append(b); }
  // 点选（拖动不算）
  let down = null;
  S.canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  S.canvas.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) showPart(S.pick(e)); down = null; });
  window.addEventListener('hashchange', () => { const k = CHAPTERS.indexOf(location.hash.slice(1)); if (k >= 0 && k !== curIdx) go(k); });
  window.__ct = { S, CH, layout, get vise() { return vise; } };
  const start = Math.max(0, CHAPTERS.indexOf((location.hash || '').slice(1)));
  go(start);
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (cur && cur.tick) cur.tick(dt, now / 1000);
    S.frame(dt);
    for (const t of tags) { const p = S.screenOf(t.name); if (p) { t.el.style.left = p.x + 'px'; t.el.style.top = p.y + 'px'; t.el.hidden = false; } else t.el.hidden = true; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
main().catch((e) => { const l = $('#loading'); if (l) l.innerHTML = `<div>加载失败：${e.message}</div>`; console.error(e); });
