// 十章内容。每章：文案 + enter(A) 返回 { tick(dt), leave() }。
import * as S from './sim.js';
import { Plot, C, niceTicks } from './chart.js';

const M0 = S.MOTOR, CAR = S.CAR, PI = Math.PI, DEG = PI / 180;
const $ = (id) => document.getElementById(id);
const f0 = (x) => Math.round(x).toLocaleString('en-US');
const f1 = (x) => x.toFixed(1);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------------------------------------------------------- 片段
const ctl = (id, label, min, max, step, val) => `<label class="ctl" for="${id}"><span>${label}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"><output id="${id}-o" for="${id}"></output></label>`;
const kpi = (id, label) => `<div class="kpi"><div class="k">${label}</div><div class="v" id="${id}">–</div></div>`;
const plot = (id, h, title) => `<div><p class="pt">${title}</p><div class="plotwrap"><canvas id="${id}" style="height:${h}px"></canvas></div></div>`;
const btn = (id, label, pressed) => `<button class="btn" id="${id}" type="button"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${label}</button>`;
const EV = { a: ['a', '公认'], b: ['b', '工程实践'], c: ['c', '本页简化'], d: ['d', '我的推测'] };
const note = (title, ev, body) => `<div class="note"><h3>${title}${(Array.isArray(ev) ? ev : ev ? [ev] : []).map((e) => ` <span class="ev ${EV[e][0]}">${EV[e][1]}</span>`).join('')}</h3>${body}</div>`;
const key = (c, t) => `<span><i style="background:${c}"></i>${t}</span>`;

function bind(id, fn, fmt) {
  const el = $(id), o = $(`${id}-o`);
  const run = () => { const v = +el.value; if (o) o.textContent = fmt ? fmt(v) : v; fn(v); };
  el.addEventListener('input', run); run();
  return { set(v) { el.value = v; run(); }, get: () => +el.value };
}
const set = (id, html) => { const e = $(id); if (e && e._v !== html) { e.innerHTML = html; e._v = html; } };
const unit = (v, u) => `${v}<small>${u}</small>`;
const n0 = (x) => (Math.abs(x) < .5 ? 0 : x).toFixed(0);

/** 让模型按工作点转起来：转子角度、线圈电流、定子磁场都从同一组 id/iq 来 */
function animate(A, dt, n, op, slow, { field = false } = {}) {
  A.thM += S.rpm2rad(n) / slow * dt;
  A.stage.setAngles(A.thM);
  const I = Math.hypot(op.id, op.iq), g = Math.atan2(op.iq, op.id);
  const thE = M0.p * A.thM + g;
  const [iu, iv, iw] = S.abc(I, thE);
  A.stage.setCoils(iu, iv, iw, M0.Imax);
  if (field) A.stage.setField(thE, clamp(I / 180, .25, 1));
  return thE;
}

/** 轴向视图的 N/S 字母。rotor：转子磁极；stator：定子磁极 */
function axialLabels(A, thM, thE, showStator = true, amp = 1) {
  const items = [];
  for (let j = 0; j < 8; j++) {
    const a = thM + j * PI / 4;
    items.push({ x: A.stage.projectAxial(a, 62), t: j % 2 ? 'S' : 'N', c: j % 2 ? '#bcd7ff' : '#ffd0d8' });
    if (showStator) {
      const b = (thE + j * PI) / 4;
      items.push({ x: A.stage.projectAxial(b, 104.2), t: j % 2 ? 'N' : 'S', c: '#ffffff', o: clamp(amp, 0, 1) });
    }
  }
  A.setLabels(items);
}

const LEG_AXIAL = `${key('#ff9f43', '导体：电流朝你')}${key('#3fc5ff', '导体：电流离开你')}${key('#d8383f', '转子 N')}${key('#2f6fdf', '转子 S')}<span>外圈字母 = 定子磁极</span>`;

function rolling(n) { return { x: [], ys: [], n, push(x, ...v) { this.x.push(x); this.ys.push(v); if (this.x.length > n) { this.x.shift(); this.ys.shift(); } }, col(i) { return this.ys.map((r) => r[i]); } }; }

// ---------------------------------------------------------- 第 1 章
const overview = {
  id: 'overview', nav: '全貌', view: 'home',
  title: '踩下踏板以后发生了什么',
  lead: '踩踏板时，你请求的是<b>扭矩</b>。控制器调三相电流的大小和相位，转速由扭矩和阻力较量出来。后面九章把这句话拆开讲。',
  body: () => `
    <div class="chain"><span>踏板</span><em>→</em><span>目标扭矩 T*</span><em>→</em><span>电流指令 i<sub>d</sub>* i<sub>q</sub>*</span><em>→</em><span>逆变器 6 个开关</span><em>→</em><span>三相电流</span><em>→</em><span>旋转磁场</span><em>→</em><span>转子</span><em>→</em><span>减速器 ×9.04</span><em>→</em><span>车轮</span></div>
    ${ctl('ex', '拆开', 0, 100, 1, 0)}
    <div class="btns">${btn('b-cut', '剖开电机', false)}${btn('b-gear', '打开减速器', false)}${btn('b-run', '转起来', true)}${btn('b-reset', '回到全景')}</div>
    <div id="part" class="card"><h4>点模型上的零件</h4><p>上面的标签和三维模型里的零件都能点，这里会说明它是干什么的。拖动可以旋转，滚轮或双指缩放。</p></div>
    <div class="tw"><table class="params" id="params"></table></div>`,
  notes: () => `
    ${note('这台车是虚构的', 'c', '<p>模型和全部参数都是按主流后驱纯电车的量级定的，不对应任何一款产品。页面上的曲线和读数都由上面这组参数实时算出来，不是画上去的示意图。</p>')}
    ${note('怎么看证据标签', '', `<ul><li><span class="ev a">公认</span> 教科书级结论，不同来源说法一致。</li><li><span class="ev b">工程实践</span> 行业常见做法或典型量级，具体数字各家不同。</li><li><span class="ev c">本页简化</span> 为了讲清楚而做的假设，真实电机不完全这样。</li><li><span class="ev d">我的推测</span> 我的判断，没有找到可靠来源支持。</li></ul>`)}`,
  enter(A) {
    const s = A.stage; let run = true, cut = false, gear = false;
    const nb = S.baseSpeed(M0), Pk = Math.max(...S.tnCurve(M0).map((c) => c.P)), Tk = S.maxTorqueAt(M0, S.wElec(M0, 1000)).T;
    $('params').innerHTML = [['极数 / 槽数', '8 极 48 槽（p = 4）'], ['永磁磁链 ψf', `${M0.psi} Wb`], ['Ld / Lq', `${M0.Ld * 1e3} / ${M0.Lq * 1e3} mH`], ['相电流上限', `${M0.Imax} A 峰值`], ['母线电压', `${M0.Vdc} V`], ['峰值扭矩', `${Tk.toFixed(0)} N·m`], ['基速', `约 ${f0(nb)} rpm`], ['峰值功率', `${(Pk / 1e3).toFixed(0)} kW`], ['最高转速', `${f0(M0.nMax)} rpm（${(S.vFromRpm(M0.nMax) * 3.6).toFixed(0)} km/h）`], ['减速比', CAR.G.toFixed(2)], ['整车 / 0–100 km/h', `${CAR.m} kg / ${S.zeroTo100(M0).toFixed(1)} s`]].map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('');
    let mark = () => {};
    const exS = bind('ex', (v) => {
      s.setExplode(v / 100);
      if (v > 1 && s.view !== 'exploded') s.applyView('exploded');
      else if (v <= 1 && s.view === 'exploded') s.applyView('home');
      if (cut || gear) { cut = false; gear = false; mark(); }
    }, (v) => `${v}%`);
    mark = () => { $('b-cut').setAttribute('aria-pressed', cut); $('b-gear').setAttribute('aria-pressed', gear); };
    $('b-cut').onclick = () => { const c = !cut; exS.set(0); cut = c; gear = false; mark(); s.applyView(cut ? 'cut' : 'home'); };
    $('b-gear').onclick = () => { const g = !gear; exS.set(0); gear = g; cut = false; mark(); s.applyView(gear ? 'gear' : 'home'); };
    $('b-run').onclick = () => { run = !run; $('b-run').setAttribute('aria-pressed', run); };
    $('b-reset').onclick = () => { exS.set(0); cut = false; gear = false; mark(); s.applyView('home'); };
    const anchors = [['batt_lid', '电池包', [-430, 1000, -66]], ['inv_lid', '逆变器', [-160, A.stage.MY - 40, A.stage.MZ + 250]], ['case', '电机', [-250, A.stage.MY - 120, A.stage.MZ - 20]], ['reducer_cover', '减速器', [108, 70, 60]], ['wheel_L', '车轮', [-898, 0, 0]]];
    A.setTags(anchors, (g) => A.showPart(g));
    A.setSlow('3D 慢放 ×100');
    A.setLegend('');
    s.setFlow(38);
    A.partHost = 'part';
    return {
      tick(dt) {
        if (run) animate(A, dt, 2400, { id: -40, iq: 170 }, 100); else s.clearCoils();
        s.setFlow(run && s.view === 'home' ? 38 : 0);
        A.tagsUpdate();
      },
      leave() { s.setExplode(0); s.setFlow(0); A.setTags([]); A.partHost = null; },
    };
  },
};

// ---------------------------------------------------------- 第 2 章
const field = {
  id: 'field', nav: '旋转磁场', view: 'axial',
  title: '三相电流怎么转出一个磁场',
  lead: '三相电流在时间上错开 120°，三相绕组在空间上错开 120°，合起来就是一个<b>大小不变、匀速旋转</b>的磁场。转子的磁钢被它拖着走。',
  body: () => `
    <div class="btns" role="group" aria-label="通电方式">${btn('m-3', '三相正序', true)}${btn('m-1', '只通 U 相', false)}${btn('m-s', '调换 V、W（倒车）', false)}</div>
    ${ctl('fe', '电频率（慢放）', .05, 1, .01, .3)}
    ${plot('w', 118, `三相电流 <span>${key(C.U, 'U')} ${key(C.V, 'V')} ${key(C.W, 'W')}</span>`)}
    <div class="duo">${plot('v', 142, '磁场矢量合成')}<div class="kpis" style="align-content:start">${kpi('k-mag', '合成磁场幅值')}${kpi('k-ang', '磁场电角度')}${kpi('k-mech', '机械角度')}</div></div>`,
  notes: () => `
    ${note('为什么这样做', 'a', '<p>永磁转子只会朝着磁场方向转。要它一直转，磁场就得一直跑在它前面。把三相电流代入三相绕组一算，脉动的部分正好抵消，只剩一个幅值恒定的旋转分量，大小是单相峰值的 1.5 倍。</p><p>这台电机有 8 个极，电流走一个周期，磁场只转 1/4 圈。所以 <b>机械角 = 电角度 ÷ 极对数</b>，15000 rpm 对应的电频率是 1000 Hz。</p>')}
    ${note('依赖的假设', 'c', '<p>绕组按正弦分布、三相完全平衡。真实绕组有谐波，定子齿和磁钢之间还有齿槽效应，所以真实的扭矩带一点脉动。厂家用斜极、分段错位来压它。</p>')}
    ${note('什么时候失效', 'a', '<p>少一相，合成磁场就退化成原地胀缩的脉动场，转子得不到持续的切向力。按“只通 U 相”可以看到。调换任意两相，磁场反转，<b>电动车的倒车就是这样实现的</b>，不需要倒挡齿轮。</p>')}`,
  enter(A) {
    let mode = '3', th = 0, thR = 0;
    const sel = (m) => { mode = m; for (const k of ['3', '1', 's']) $(`m-${k}`).setAttribute('aria-pressed', k === m); };
    for (const k of ['3', '1', 's']) $(`m-${k}`).onclick = () => sel(k);
    let f = .3; bind('fe', (v) => { f = v; }, (v) => `${v.toFixed(2)} Hz`);
    const pw = new Plot($('w'), { l: 30, b: 18, t: 6 }), pv = new Plot($('v'), { l: 0, r: 0, t: 0, b: 0 });
    A.setLegend(LEG_AXIAL); A.setSlow('电频率已慢放');
    const I = 400;
    const xs = Array.from({ length: 121 }, (_, i) => i * 6 * DEG);
    const wave = (ph) => xs.map((x) => Math.cos(x - ph));
    const Wu = wave(0), Wv = wave(2 * PI / 3), Wv2 = wave(-2 * PI / 3);
    return {
      tick(dt) {
        th += 2 * PI * f * dt;
        const c = Math.cos(th), a = [I * c, I * Math.cos(th - 2 * PI / 3), I * Math.cos(th + 2 * PI / 3)];
        let [iu, iv, iw] = a;
        if (mode === '1') { iv = 0; iw = 0; }
        if (mode === 's') [iv, iw] = [iw, iv];
        // 用实际三相电流合成矢量，单相时自然退化成脉动
        const fx = iu - .5 * iv - .5 * iw, fy = (Math.sqrt(3) / 2) * (iv - iw);
        const mag = Math.hypot(fx, fy) / (1.5 * I), ang = Math.atan2(fy, fx);
        const s = A.stage;
        s.setCoils(iu, iv, iw, 520);
        s.setField(ang, Math.max(mag, .03));
        if (mode !== '1') { // 转子同步跟随，滞后一点电角度
          const target = ang - .3 * (mode === 's' ? -1 : 1);
          let d = (target - thR * 4) % (2 * PI); if (d > PI) d -= 2 * PI; if (d < -PI) d += 2 * PI;
          thR += d / 4 * Math.min(1, 8 * dt);
        }
        s.setAngles(thR);
        axialLabels(A, thR, ang, true, mag);
        set('k-mag', unit(`${(mag * 150).toFixed(0)}`, '% 单相峰值'));
        set('k-ang', unit(`${((ang / DEG + 360) % 360).toFixed(0)}`, '°'));
        set('k-mech', unit(`${(((ang / DEG + 360) % 360) / 4).toFixed(1)}`, '°'));
        const ph = ((th % (2 * PI)) + 2 * PI) % (2 * PI);
        pw.clear().scale(0, 4 * PI, -1.15, 1.15).axes({ yt: [-1, 0, 1], xt: [0, PI, 2 * PI, 3 * PI, 4 * PI], xf: (v) => `${Math.round(v / DEG)}°`, zero: true });
        const off = mode === 's' ? [Wu, Wv2, Wv] : [Wu, Wv, Wv2];
        pw.line(xs, off[0], C.U, 2);
        pw.line(xs, off[1], mode === '1' ? 'rgba(72,214,176,.18)' : C.V, 2);
        pw.line(xs, off[2], mode === '1' ? 'rgba(229,72,77,.18)' : C.W, 2);
        pw.vline(ph + 2 * PI, C.fg, [], 1.2);
        pw.dot(ph + 2 * PI, Math.cos(ph), C.U, 3.5);
        pw.hover = { x: xs, xf: (v) => `${(v / DEG).toFixed(0)}° 电角度`, series: [{ n: 'U', c: C.U, y: off[0], f: (v) => v.toFixed(2) }, { n: 'V', c: C.V, y: off[1], f: (v) => v.toFixed(2) }, { n: 'W', c: C.W, y: off[2], f: (v) => v.toFixed(2) }] };
        // 矢量图
        pv.clear();
        const g = pv.g, cx = pv.w / 2, cy = pv.h / 2, R = Math.min(pv.w, pv.h) * .28 / I;
        const arrow = (x0, y0, x1, y1, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); const a2 = Math.atan2(y1 - y0, x1 - x0); if (Math.hypot(x1 - x0, y1 - y0) > 6) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - 7 * Math.cos(a2 - .4), y1 - 7 * Math.sin(a2 - .4)); g.lineTo(x1 - 7 * Math.cos(a2 + .4), y1 - 7 * Math.sin(a2 + .4)); g.closePath(); g.fillStyle = col; g.fill(); } };
        g.strokeStyle = C.grid; g.beginPath(); g.arc(cx, cy, 1.5 * I * R, 0, 7); g.stroke();
        let px = cx, py = cy;
        [[iu, 0, C.U], [iv, 2 * PI / 3, C.V], [iw, -2 * PI / 3, C.W]].forEach(([v, a2, col]) => {
          const nx = px + v * R * Math.cos(a2), ny = py - v * R * Math.sin(a2);
          arrow(px, py, nx, ny, col, 2); px = nx; py = ny;
        });
        arrow(cx, cy, px, py, C.fg, 2.5);
        g.fillStyle = C.text; g.font = '11px "Noto Sans SC",sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
        g.fillText('白 = 三相相加', 6, 6);
      },
      leave() { A.stage.clearCoils(); A.stage.ring.visible = false; A.setLabels([]); },
    };
  },
};

// ---------------------------------------------------------- 第 3 章
const torque = {
  id: 'torque', nav: '调扭矩', view: 'axial',
  title: '扭矩怎么调：电流大小和超前角',
  lead: '扭矩只看两个量：<b>电流多大</b>，以及定子磁场比转子<b>超前多少电角度</b>。控制器每个周期都在调这两个量。',
  body: () => `
    <div class="f">T = 3/2 · p · [ ψ<sub>f</sub> i<sub>q</sub> + (L<sub>d</sub> − L<sub>q</sub>) i<sub>d</sub> i<sub>q</sub> ]</div>
    ${ctl('cI', '电流幅值 I', 0, 520, 5, 300)}
    ${ctl('cg', '超前角 γ', 0, 180, 1, 90)}
    <div class="btns">${btn('b-mtpa', '跳到最大扭矩角')}${btn('b-free', '松开转子', false)}${btn('b-step', '磁场再往前拨 90°')}</div>
    <div class="kpis">${kpi('k-t', '总扭矩')}${kpi('k-m', '永磁扭矩')}${kpi('k-r', '磁阻扭矩')}${kpi('k-id', 'i<sub>d</sub>')}${kpi('k-iq', 'i<sub>q</sub>')}</div>
    ${plot('tg', 160, `同样电流下，扭矩随超前角的变化（N·m）`)}`,
  notes: () => `
    ${note('为什么 90° 附近出力最大', 'a', '<p>把转子想成指南针。磁场和磁钢对齐时，力全是径向的，转矩为零。磁场超前 90° 电角度时，吸引力全部变成切向，同样的电流拉得最狠。所以控制器把电流分成两份：<b>i<sub>q</sub></b> 垂直于转子磁场，负责出力；<b>i<sub>d</sub></b> 顺着转子磁场，用来调磁。</p>')}
    ${note('为什么 V 形内嵌磁钢的最佳角大于 90°', 'a', '<p>磁钢的磁导率接近空气，所以沿磁钢方向（d 轴）的磁路“难走”，L<sub>q</sub> 大于 L<sub>d</sub>。转子就像一块椭圆形的铁，总想把长轴转向磁场，多出一份和 sin 2γ 成正比的磁阻扭矩。两份叠加，最大值出现在 90° 之后。本页机型满电流时最佳角约 121°，磁阻扭矩贡献三成多。</p>')}
    ${note('依赖的假设', 'c', '<p>L<sub>d</sub>、L<sub>q</sub>、ψ<sub>f</sub> 都当常数。真实铁芯大电流下会饱和，L<sub>q</sub> 下降，所以扭矩随电流增长会变缓；磁钢升温时 ψ<sub>f</sub> 也会下降。量产控制器用台架测出来的查表代替这条公式。</p>')}
    ${note('什么时候失效', 'a', '<p>按“松开转子”：磁场不动，转子转过去对齐，超前角归零，扭矩也归零。<b>这说明磁场不能停</b>，必须随转子一起往前走，下一章接着讲。另外，电流太大又太热时，负的 i<sub>d</sub> 会让磁钢发生不可逆退磁，这是电流上限的来源之一。</p>')}`,
  enter(A) {
    const s = A.stage; let I = 300, g = 90 * DEG, free = false, w = 0, thR = 2 * PI / 16 * 0, fieldE = g;
    const m = M0, pt = new Plot($('tg'), { l: 40, b: 20 });
    let draw = true;
    const cI = bind('cI', (v) => { I = v; draw = true; }, (v) => `${v} A`);
    const cg = bind('cg', (v) => { if (!free) { g = v * DEG; fieldE = thR * m.p + g; } draw = true; }, (v) => `${v}°`);
    const setFree = (v) => { free = v; $('b-free').setAttribute('aria-pressed', v); $('b-free').textContent = v ? '锁住转子' : '松开转子'; };
    $('b-mtpa').onclick = () => { setFree(false); cg.set(Math.round(S.mtpaAngle(m, I) / DEG)); };
    $('b-free').onclick = () => { setFree(!free); if (free) { w = 0; } else { cg.set(clamp(Math.round(g / DEG), 0, 180)); } };
    $('b-step').onclick = () => { if (!free) setFree(true); fieldE += 90 * DEG; w *= .5; };
    A.setLegend(LEG_AXIAL); A.setSlow('转子静止时，电流是直流');
    const xs = Array.from({ length: 91 }, (_, i) => i * 2);
    return {
      tick(dt) {
        if (free) {
          g = fieldE - thR * m.p;
          const T = S.torqueOf(m, I * Math.cos(g), I * Math.sin(g));
          const J = 2.2;                         // 教学用放慢的惯量，让运动看得清
          w += (T / J - w * 2.4) * dt;
          thR += w * dt;
        }
        const id = I * Math.cos(g), iq = I * Math.sin(g), T = S.torqueOf(m, id, iq);
        const thE = thR * m.p + g;
        const [iu, iv, iw] = S.abc(I, thE);
        s.setAngles(thR); s.setCoils(iu, iv, iw, 520); s.setField(thE, clamp(I / 180, .1, 1));
        axialLabels(A, thR, thE, true, clamp(I / 100, 0, 1));
        set('k-t', unit(n0(T), 'N·m')); set('k-m', unit(n0(S.magTorque(m, iq)), 'N·m')); set('k-r', unit(n0(S.relTorque(m, id, iq)), 'N·m'));
        set('k-id', unit(n0(id), 'A')); set('k-iq', unit(n0(iq), 'A'));
        if (draw || free) {
          draw = false;
          const gs = xs.map((x) => x * DEG);
          const Tm = gs.map((a) => S.magTorque(m, I * Math.sin(a)));
          const Tr = gs.map((a) => S.relTorque(m, I * Math.cos(a), I * Math.sin(a)));
          const Tt = Tm.map((v, i) => v + Tr[i]);
          pt.clear().scale(0, 180, -120, 340).axes({ xt: [0, 45, 90, 135, 180], xf: (v) => `${v}°`, yt: [-100, 0, 100, 200, 300], zero: true, xl: '超前角 γ' });
          pt.line(xs, Tm, C.d, 2).line(xs, Tr, C.U, 2).line(xs, Tt, C.fg, 2.4);
          const gm = S.mtpaAngle(m, I) / DEG;
          pt.vline(gm, C.accent);
          const ga = clamp(((g / DEG) % 360 + 360) % 360, 0, 180);
          pt.dot(ga, clamp(T, -120, 340), C.accent, 5.5);
          pt.label(30, Tm[15], '永磁', C.fg, { dy: -10 }).label(150, Tr[75], '磁阻', C.fg, { dy: -10 }).label(gm, 330, `最佳 ${gm.toFixed(0)}°`, C.fg, { dx: 5, dy: 0 });
          pt.hover = { x: xs, xf: (v) => `γ = ${v}°`, series: [{ n: '总', c: C.fg, y: Tt, f: (v) => `${v.toFixed(0)} N·m` }, { n: '永磁', c: C.d, y: Tm, f: (v) => `${v.toFixed(0)}` }, { n: '磁阻', c: C.U, y: Tr, f: (v) => `${v.toFixed(0)}` }] };
        }
      },
      leave() { s.clearCoils(); s.ring.visible = false; A.setLabels([]); },
    };
  },
};

// ---------------------------------------------------------- 第 4 章
const speed = {
  id: 'speed', nav: '调转速', view: 'road',
  title: '转速怎么调：其实是扭矩在调',
  lead: '控制器一直在给扭矩，转速由 <b>J·dω/dt = T − T<sub>负载</sub></b> 决定。扭矩大于阻力就加速，等于阻力就匀速，小于阻力就减速。电频率跟着转子走，它是结果。',
  body: () => `
    ${ctl('sT', '电机扭矩 T', 0, 320, 1, 90)}
    ${ctl('sg', '坡度', -10, 20, 1, 0)}
    <div class="btns">${btn('b-cr', '定速巡航（加一层转速环）', false)}</div>
    <div id="crw" hidden>${ctl('sv', '目标车速', 0, 160, 5, 90)}</div>
    <div class="kpis">${kpi('k-v', '车速')}${kpi('k-n', '电机转速')}${kpi('k-f', '电频率')}${kpi('k-l', '阻力矩')}${kpi('k-a', '加速度')}</div>
    ${plot('tn', 150, `扭矩线和阻力线的交点就是稳定车速 <span>${key(C.accent, '电机扭矩')} ${key(C.d, '阻力矩')}</span>`)}
    ${plot('vt', 104, '车速（km/h），最近 60 秒')}`,
  notes: () => `
    ${note('频率是结果，不是指令', 'a', '<p>旋转变压器每时每刻报告转子角度 θ<sub>m</sub>，控制器算出电角度 θ<sub>e</sub> = p·θ<sub>m</sub>，再把电流放在转子前方固定的角度上。转子快了，磁场就跟着快，电频率自动等于 p·n/60。这种“转子带着磁场走”的方式也叫自控式同步，它不会像开环同步电机那样失步。</p>')}
    ${note('调速的三种做法', 'a', '<ul><li><b>扭矩控制（电动车主流）</b>：踏板直接对应扭矩，手感像油门，响应快。转速交给驾驶员闭环。</li><li><b>扭矩内环 + 转速外环</b>：定速巡航、蠕行、单踏板停车在用。外环看车速误差，输出的还是扭矩指令。</li><li><b>开环 V/f</b>：直接给频率和电压，风机水泵常用，简单但动态差，负载一突变就可能失步，电动车不用。</li></ul>')}
    ${note('依赖的假设', 'c', '<p>阻力只算滚阻、风阻和坡度，电池电压恒定，不算轮胎滑移。</p>')}
    ${note('什么时候失效', 'b', '<p>车轮打滑时负载突然消失，同样的扭矩会让转速飞升。真实车辆的牵引力控制在几毫秒到几十毫秒内降扭矩。扭矩响应比发动机快一两个量级，这也是电动车防滑好做的原因。坡度太大、扭矩上限也拉不动时，车就停在坡上。</p>')}`,
  enter(A) {
    const s = A.stage, m = M0;
    let st = { v: 18, soc: .7, t: 0 }, Tc = 90, gr = 0, cr = false, vT = 25, xi = 0, Tnow = 90;
    bind('sT', (v) => { Tc = v; }, (v) => `${v} N·m`);
    bind('sg', (v) => { gr = v; }, (v) => `${v > 0 ? '+' : ''}${v}%`);
    bind('sv', (v) => { vT = v / 3.6; }, (v) => `${v} km/h`);
    $('b-cr').onclick = () => { cr = !cr; $('b-cr').setAttribute('aria-pressed', cr); $('crw').hidden = !cr; $('sT').disabled = cr; xi = Tnow; };
    const pn = new Plot($('tn'), { l: 40, b: 20 }), pv = new Plot($('vt'), { l: 34, b: 18, t: 6 });
    const curve = S.tnCurve(m, 80), R = rolling(200);
    let acc = 0, fast = 3;
    A.setSlow('3D 慢放 ×20 · 数值时间快进 ×3');
    A.setLegend(`${key('#58e0a0', '机械功率')}${key('#ffb547', '直流')}${key('#c78bff', '三相交流')}`);
    return {
      tick(dt) {
        const sdt = dt * fast;
        let cmd = Tc;
        if (cr) {
          const e = vT - st.v, raw = 45 * e + xi;
          if (raw > -120 && raw < 320) xi = clamp(xi + 6 * e * sdt, -60, 320);   // 饱和时停止积分，防止超调
          cmd = clamp(45 * e + xi, -120, 320);
        }
        for (let i = 0; i < 3; i++) st = S.stepCar(m, st, sdt / 3, cmd, 0, gr);
        Tnow = st.op.T;
        const Tl = st.res * CAR.r / CAR.G / CAR.eta;
        s.scrollRoad(st.v * dt / 20);
        animate(A, dt, st.n, st.op, 20);
        s.setFlow(st.P.Pdc / 1e3);
        acc += sdt;
        if (acc > .3) { acc = 0; R.push(st.t, st.v * 3.6); }
        set('k-v', unit(f1(st.v * 3.6), 'km/h')); set('k-n', unit(f0(st.n), 'rpm')); set('k-f', unit(f0(S.fElec(m, st.n)), 'Hz'));
        set('k-l', unit(f1(Tl), 'N·m')); set('k-a', unit(st.a.toFixed(2), 'm/s²'));
        const ns = curve.map((c) => c.n), Ts = curve.map((c) => c.T);
        const load = ns.map((n) => { const v = S.vFromRpm(n), r = S.resistForce(v, gr); return (r.roll + r.aero + r.grade) * CAR.r / CAR.G / CAR.eta; });
        pn.clear().scale(0, 16000, -60, 340).axes({ xt: [0, 4000, 8000, 12000, 16000], xf: (v) => `${v / 1000}k`, yt: [0, 100, 200, 300], zero: true, xl: 'rpm', yl: 'N·m' });
        pn.line(ns, Ts, C.axis, 1.6, [5, 4]).line(ns, load, C.d, 2);
        pn.hline(clamp(cmd, -60, 340), C.accent, [], 1.6);
        pn.dot(st.n, Tnow, C.accent, 5.5);
        pn.label(11500, Ts[58], '外特性上限', C.fg, { dy: -10 }).label(12800, clamp(load[64], -50, 330), '阻力矩', C.fg, { dy: 12, dx: -4 });
        pn.hover = { x: ns, xf: (v) => `${f0(v)} rpm（${(S.vFromRpm(v) * 3.6).toFixed(0)} km/h）`, series: [{ n: '上限', c: C.axis, y: Ts, f: (v) => `${v.toFixed(0)} N·m` }, { n: '阻力矩', c: C.d, y: load, f: (v) => `${v.toFixed(1)} N·m` }] };
        if (R.x.length > 1) {
          const t1 = R.x.at(-1), xs = R.x, ys = R.col(0), top = Math.max(60, Math.ceil(Math.max(...ys) / 40 + .3) * 40);
          pv.clear().scale(Math.max(0, t1 - 60), Math.max(60, t1), 0, top).axes({ yt: niceTicks(0, top, 3) });
          pv.line(xs, ys, C.accent, 2);
          pv.hover = { x: xs, xf: (v) => `${v.toFixed(0)} s`, series: [{ n: '车速', c: C.accent, y: ys, f: (v) => `${v.toFixed(0)} km/h` }] };
        }
      },
      leave() { s.setFlow(0); s.clearCoils(); },
    };
  },
};

// ---------------------------------------------------------- 第 5 章
const LEGS = ['U', 'V', 'W'];
const bridgeSvg = () => {
  let h = '<svg class="dia" viewBox="0 0 360 118" role="img" aria-label="三相全桥的六个开关，当前导通的高亮">';
  h += '<line class="ln" x1="30" y1="12" x2="340" y2="12"/><line class="ln" x1="30" y1="106" x2="340" y2="106"/><text x="8" y="16">+</text><text x="8" y="110">−</text>';
  LEGS.forEach((p, i) => {
    const x = 80 + i * 100;
    h += `<line class="ln" x1="${x}" y1="12" x2="${x}" y2="106"/><rect id="sw-${p}H" x="${x - 19}" y="19" width="38" height="24" rx="2"/><rect id="sw-${p}L" x="${x - 19}" y="75" width="38" height="24" rx="2"/><text id="swt-${p}H" x="${x}" y="35" text-anchor="middle">${p}上</text><text id="swt-${p}L" x="${x}" y="91" text-anchor="middle">${p}下</text><line class="ln" x1="${x}" y1="59" x2="${x + 34}" y2="59"/><text x="${x + 38}" y="63">${p}</text>`;
  });
  return `${h}</svg>`;
};
const inverter = {
  id: 'inverter', nav: '逆变器', view: 'inverter',
  title: '六个开关怎么拼出正弦电流',
  lead: '电池只有直流。逆变器让每相桥臂高速切换，用<b>占空比</b>表示想要的电压，电机绕组的电感再把脉冲滤成平滑电流。电压大小和频率都能这样调出来。',
  body: () => `
    ${ctl('pm', '调制比', .1, 1.15, .01, .8)}
    ${ctl('pf', '开关频率', 2, 20, 1, 8)}
    ${ctl('pe', '电频率', 50, 1000, 10, 200)}
    <div class="btns">${btn('b-play', '暂停', true)}</div>
    ${bridgeSvg()}
    <div class="kpis">${kpi('k-r', '载波比')}${kpi('k-v', '基波电压')}${kpi('k-i', '电流纹波')}${kpi('k-l', '开关损耗')}</div>
    ${plot('pa', 104, `调制波和三角载波 <span>${key(C.U, 'U')} ${key(C.V, 'V')} ${key(C.W, 'W')}</span>`)}
    ${plot('pb', 84, 'U 相对中性点电压（V）')}
    ${plot('pc', 104, `U 相电流（A） <span>${key(C.accent, '实际')} ${key(C.fg, '基波')}</span>`)}`,
  notes: () => `
    ${note('为什么靠通断就能调电压', 'a', '<p>开关要么全开要么全关，自身几乎不耗电，比用电阻分压高效得多。一个开关周期里接通的比例就是平均电压。电感不让电流突变，所以电流看到的基本是平均值。调制波比载波高的时候上管开，这就是 PWM。</p>')}
    ${note('取舍：开关频率', 'b', '<p>开得快，电流纹波小，电机铁损和噪声低；代价是每次开关都有损耗，频率翻倍，开关损耗也翻倍。SiC 器件的开关损耗比硅 IGBT 低，所以能开得更快，这是 800 V 平台偏爱它的原因之一。量产逆变器的开关频率大致在几 kHz 到 20 kHz 量级，这个范围是我的经验值，没有逐家核实。</p>')}
    ${note('依赖的假设', 'c', '<p>开关理想，没有死区和延迟。电感取 L<sub>d</sub>、L<sub>q</sub> 平均值，基波电流固定为 200 A，方便只看纹波，开关损耗也按 200 A 估算。调制波注入了零序分量，等效 SVPWM，线性区上限是 1.15，比纯正弦 SPWM 多 15% 电压。</p>')}
    ${note('什么时候失效', 'a', '<ul><li>同一桥臂上下管同时导通就是母线短路，所以要插入几百纳秒到几微秒的死区，代价是波形略有畸变。</li><li>转速很高时，每个电周期只分到很少几个载波，载波比低于 10 左右时波形会明显变差。把电频率拉到 1000 Hz、开关频率拉到 8 kHz 可以看到。</li><li>调制比超过 1.15 进入过调制，电压增加有限，电流谐波变大。</li></ul>')}`,
  enter(A) {
    const s = A.stage, m = M0;
    let mi = .8, fs = 8000, fe = 200, dirty = true, W = null, u = 0, play = true;
    const ch = () => { dirty = true; };
    bind('pm', (v) => { mi = v; ch(); }, (v) => v.toFixed(2));
    bind('pf', (v) => { fs = v * 1000; ch(); }, (v) => `${v} kHz`);
    bind('pe', (v) => { fe = v; ch(); }, (v) => `${v} Hz`);
    $('b-play').onclick = () => { play = !play; $('b-play').setAttribute('aria-pressed', play); $('b-play').textContent = play ? '暂停' : '继续'; };
    const pa = new Plot($('pa'), { l: 34, b: 16, t: 6 }), pb = new Plot($('pb'), { l: 34, b: 16, t: 6 }), pc = new Plot($('pc'), { l: 34, b: 16, t: 6 });
    const heads = [pa, pb, pc].map((p) => { const d = document.createElement('div'); d.className = 'hair'; d.style.opacity = '1'; d.style.background = C.fg; p.c.parentElement.append(d); return d; });
    A.setLegend(`${key('#ffd166', '发亮的开关 = 正在导通')}`);
    const render = () => {
      W = S.pwmPeriod({ m, mi, fsw: fs, fe });
      A.setSlow(`开关动作慢放约 ${f0(Math.round(fe / .035 / 100) * 100)} 倍`);
      const N = W.N, T = 1 / fe, ms = 1e3;
      const step = Math.max(1, Math.floor(N / 2400)), xsms = [], ra = [], rb = [], rc = [], car = [], vu = [], iu = [], ifu = [];
      for (let i = 0; i < N; i += step) { xsms.push(W.t[i] * ms); ra.push(W.ra[i]); rb.push(W.rb[i]); rc.push(W.rc[i]); car.push(W.car[i]); vu.push(W.vun[i]); iu.push(W.iu[i]); ifu.push(W.ifund[i]); }
      const xm = T * ms, xt = niceTicks(0, xm, 4);
      pa.clear().scale(0, xm, -1.25, 1.25).axes({ xt, yt: [-1, 0, 1], zero: true });
      pa.line(xsms, car, C.axis, .8).line(xsms, ra, C.U, 2).line(xsms, rb, C.V, 2).line(xsms, rc, C.W, 2);
      pb.clear().scale(0, xm, -300, 300).axes({ xt, yt: [-266, 0, 266], yf: (v) => `${v}`, zero: true });
      pb.line(xsms, vu, C.d, 1);
      const top = Math.max(260, 200 + W.ripple * 1.2);
      pc.clear().scale(0, xm, -top, top).axes({ xt, xf: (v) => `${v} ms`, yt: [-200, 0, 200], zero: true });
      pc.line(xsms, iu, C.accent, 1.3).line(xsms, ifu, C.fg, 1.4);
      pc.hover = { x: xsms, xf: (v) => `${v.toFixed(2)} ms`, series: [{ n: '实际', c: C.accent, y: iu, f: (v) => `${v.toFixed(0)} A` }, { n: '基波', c: C.fg, y: ifu, f: (v) => `${v.toFixed(0)} A` }] };
      set('k-r', unit((fs / fe).toFixed(1), '倍'));
      set('k-v', unit((W.V1).toFixed(0), 'V 峰值'));
      set('k-i', unit(`±${W.ripple.toFixed(0)}`, 'A'));
      set('k-l', unit((S.losses(m, 200, 0, 0, fs).sw).toFixed(0), 'W'));
    };
    return {
      tick(dt) {
        if (dirty) { dirty = false; render(); }
        if (play) u = (u + dt * .035) % 1;
        const k = Math.floor(u * W.N);
        const st = {};
        ['U', 'V', 'W'].forEach((p, i) => { const g = [W.ga, W.gb, W.gc][i][k]; st[`${p}H`] = g; st[`${p}L`] = g ? 0 : 1; });
        s.setSwitches(st);
        for (const key2 in st) { const el = $(`sw-${key2}`), tx = $(`swt-${key2}`); if (el) { el.style.fill = st[key2] ? '#ffd166' : ''; tx.style.fill = st[key2] ? '#1d1203' : ''; } }
        const x = pa.pad.l + u * (pa.w - pa.pad.l - pa.pad.r);
        heads.forEach((d) => { d.style.left = `${x}px`; });
        A.thM += .25 * dt; s.setAngles(A.thM);
      },
      leave() { s.setSwitches(null); },
    };
  },
};

// ---------------------------------------------------------- 第 6 章
function focDiagram() {
  const b = (x, y, w, h, t, id) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/><text x="${x + w / 2}" y="${y + (id ? 14 : h / 2 + 4)}" text-anchor="middle">${t}</text>${id ? `<text class="v" id="${id}" x="${x + w / 2}" y="${y + 28}" text-anchor="middle"></text>` : ''}`;
  const ln = (d, c = '') => `<path class="ln ${c}" d="${d}" marker-end="url(#ar)"/>`;
  return `<svg class="dia" viewBox="0 0 400 268" role="img" aria-label="磁场定向控制框图：扭矩指令经查表得到电流指令，经过电流环和反 Park 变换到 PWM，电流和转角反馈回来">
  <defs><marker id="ar" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6z" fill="#93a4bb"/></marker></defs>
  ${b(6, 8, 84, 36, '扭矩指令 T*', 'd-t')}${b(112, 8, 84, 36, 'MTPA / 弱磁表', 'd-ref')}${b(218, 8, 84, 36, 'PI 电流环', 'd-v')}${b(320, 8, 66, 36, '反 Park', 'd-ab')}
  ${b(320, 76, 74, 36, 'SVPWM', 'd-d')}${b(218, 76, 84, 36, '逆变器 6 开关')}${b(112, 76, 84, 36, '电机')}
  ${b(112, 144, 84, 36, '电流传感器', 'd-abc')}${b(218, 144, 84, 36, 'Clarke', 'd-cl')}${b(320, 144, 74, 36, 'Park', 'd-dq')}
  ${b(6, 76, 84, 36, '旋转变压器', 'd-th')}
  ${ln('M90 26H110')}${ln('M196 26H216')}${ln('M302 26H318')}${ln('M353 44V74')}${ln('M320 94H304')}${ln('M218 94H198')}
  ${ln('M154 112V142', 'fb')}${ln('M196 162H216', 'fb')}${ln('M302 162H318', 'fb')}
  ${ln('M357 180V200H207V54H236V46', 'fb')}
  ${ln('M112 94H92', 'fb')}${ln('M48 112V226H380V182', 'fb')}${ln('M380 226H397V26H388', 'fb')}
  <text x="56" y="250" class="v" style="fill:#93a4bb">蓝线 = 反馈。整圈每 100 μs 左右跑一次（典型量级）</text>
  </svg>`;
}
// 效率分档：单色系，越亮越高
const BANDS = [.8, .85, .9, .92, .94, .95];
const BAND_LABELS = ['<80%', '80–85', '85–90', '90–92', '92–94', '94–95', '>95%'];
const BAND_RGB = [[16, 38, 66], [24, 62, 104], [33, 88, 142], [45, 118, 178], [68, 150, 208], [110, 186, 232], [176, 224, 250]];

const CODE = `// 控制周期中断（示意）
void pwm_isr(void) {
  float th = resolver_angle() * POLE_PAIRS;      // 电角度
  float ia = adc_ia(), ib = adc_ib();            // 两相够了，ic = -ia-ib

  float al = ia, be = (ia + 2*ib) / SQRT3;       // Clarke
  float id =  al*cos(th) + be*sin(th);           // Park：转到转子坐标
  float iq = -al*sin(th) + be*cos(th);

  lookup_mtpa(torque_cmd, speed, &id_ref, &iq_ref);
  float vd = pi_run(&pid, id_ref - id) - we*Lq*iq;       // 解耦前馈
  float vq = pi_run(&piq, iq_ref - iq) + we*(Ld*id+psi);

  float va = vd*cos(th) - vq*sin(th);            // 反 Park
  float vb = vd*sin(th) + vq*cos(th);
  svpwm_update(va, vb, vbus);                    // 下一拍生效
}`;
const foc = {
  id: 'foc', nav: '矢量控制', view: 'cut',
  title: '矢量控制：站到转子上看电流',
  lead: '在定子上看，电流是几百赫兹的交流，控制器很难追。换到跟转子一起转的坐标系里，同样的电流变成两个<b>直流量 i<sub>d</sub>、i<sub>q</sub></b>，普通 PI 就能把它们调准。这就是 FOC。',
  body: () => `
    ${focDiagram()}
    ${ctl('fn', '电机转速', 500, 12000, 100, 3000)}
    ${ctl('fq', '目标 i<sub>q</sub>', 100, 440, 10, 300)}
    ${ctl('fb', '电流环带宽', 100, 3000, 50, 500)}
    <div class="btns">${btn('b-go', '重新踩一脚')}</div>
    ${plot('fa', 112, `定子坐标：三相电流（A） <span>${key(C.U, 'a')} ${key(C.V, 'b')} ${key(C.W, 'c')}</span>`)}
    ${plot('fd', 120, `转子坐标：同一段电流变成了两条直线（A） <span>${key(C.accent, 'i<sub>q</sub>')} ${key(C.d, 'i<sub>d</sub>')}</span>`)}
    <div class="kpis">${kpi('k-rise', 'i<sub>q</sub> 上升 90%')}${kpi('k-over', '超调')}${kpi('k-fe', '电频率')}</div>
    <details><summary>控制周期里的代码长这样</summary><pre>${CODE}</pre></details>`,
  notes: () => `
    ${note('为什么要做坐标变换', 'a', '<p>PI 控制器的积分项只能把<b>直流</b>误差消到零。直接追交流，转速一高就跟不上，相位和幅值都有误差。Clarke 把三相压成两相，Park 再按转子角度旋转，交流就成了直流。i<sub>q</sub> 只管扭矩，i<sub>d</sub> 只管磁场，这两个旋钮基本解耦，和调一台他励直流电机差不多。</p>')}
    ${note('三种电流/扭矩控制路线', '', `<ul><li><b>FOC + PI <span class="ev a">主流</span></b>：稳态好，纹波小，工程师熟悉。需要准确的转角和电机参数。</li><li><b>直接转矩控制 DTC <span class="ev b">工业传动常见</span></b>：不做电流环，用开关表直接调扭矩和磁链，响应快，代价是纹波和开关频率不固定。</li><li><b>模型预测控制 MPC <span class="ev d">研究活跃</span></b>：每拍预测未来几步选最优电压，能显式处理电压电流约束，算力要求高。量产占比我没有查到可靠统计。</li></ul>`)}
    ${note('依赖的假设', 'c', '<p>这里的电流环是真的在逐拍仿真：100 μs 控制周期、一拍计算延迟、带解耦前馈。电机参数用的是准确值，所以看起来很干净。</p>')}
    ${note('什么时候失效', 'a', '<ul><li>把带宽拉到 2000 Hz 以上：控制周期的延迟开始吃相位裕度，超调明显变大。经验上带宽要低于采样频率的十分之一左右。</li><li>旋变零位偏了，算出的 d、q 轴就是歪的，扭矩下降，严重时方向都不对。所以下线要做零位标定。</li><li>电压到顶时电流环饱和，这时调不动了，第 7 章讲怎么办。</li></ul>')}`,
  enter(A) {
    const s = A.stage, m = M0;
    let n = 3000, iq = 300, fc = 500, data = null, prog = 0, dirty = true;
    const ch = () => { dirty = true; };
    bind('fn', (v) => { n = v; ch(); }, (v) => `${f0(v)} rpm`);
    bind('fq', (v) => { iq = v; ch(); }, (v) => `${v} A`);
    bind('fb', (v) => { fc = v; ch(); }, (v) => `${v} Hz`);
    $('b-go').onclick = ch;
    const pa = new Plot($('fa'), { l: 40, b: 16, t: 6 }), pd = new Plot($('fd'), { l: 40, b: 18, t: 6 });
    A.setSlow('3D 慢放 ×200'); A.setLegend(`${key('#d8383f', '转子 N')}${key('#2f6fdf', '转子 S')}`);
    const calc = () => {
      const g = S.mtpaAngle(m, iq), id1 = -Math.min(iq * .55, 260);
      data = S.currentLoopStep(m, { n, fc, iq0: 60, id0: -10, iq1: iq, id1 });
      data.id1 = id1; data.iq1 = iq;
      const t0 = .004, i90 = data.iq.findIndex((x) => x > 60 + .9 * (iq - 60));
      const over = Math.max(...data.iq) - iq;
      set('k-rise', unit(i90 > 0 ? ((data.t[i90] - t0) * 1e3).toFixed(2) : '–', 'ms'));
      set('k-over', unit(Math.max(over, 0).toFixed(0), 'A'));
      set('k-fe', unit(f0(S.fElec(m, n)), 'Hz'));
      prog = 0;
    };
    const fmt = (v) => `${(v * 1e3).toFixed(0)}`;
    return {
      tick(dt) {
        if (dirty) { dirty = false; calc(); }
        prog = Math.min(1, prog + dt / 2.2);
        const D = data, K = Math.max(2, Math.floor(prog * D.t.length));
        const tM = .02;
        const top = Math.max(data.iq1 * 1.45, 200);
        const sl = (arr) => arr.slice(0, K);
        const xs = sl(D.t);
        pa.clear().scale(0, tM, -top, top).axes({ xt: [0, .005, .01, .015, .02], xf: fmt, yt: niceTicks(-top, top, 3), zero: true });
        pa.line(xs, sl(D.ia), C.U, 1.6).line(xs, sl(D.ib), C.V, 1.6).line(xs, sl(D.ic), C.W, 1.6);
        pd.clear().scale(0, tM, -280, top).axes({ xt: [0, .005, .01, .015, .02], xf: (v) => `${fmt(v)} ms`, yt: niceTicks(-280, top, 3), zero: true });
        pd.line(xs, sl(D.iqr), C.fg, 1, [4, 4]).line(xs, sl(D.idr), C.fg, 1, [4, 4]);
        pd.line(xs, sl(D.iq), C.accent, 2).line(xs, sl(D.id), C.d, 2);
        pd.hover = { x: D.t, xf: (v) => `${(v * 1e3).toFixed(2)} ms`, series: [{ n: 'iq', c: C.accent, y: D.iq, f: (v) => `${v.toFixed(0)} A` }, { n: 'id', c: C.d, y: D.id, f: (v) => `${v.toFixed(0)} A` }] };
        pa.hover = { x: D.t, xf: (v) => `${(v * 1e3).toFixed(2)} ms`, series: [{ n: 'a', c: C.U, y: D.ia, f: (v) => `${v.toFixed(0)} A` }, { n: 'b', c: C.V, y: D.ib, f: (v) => `${v.toFixed(0)} A` }, { n: 'c', c: C.W, y: D.ic, f: (v) => `${v.toFixed(0)} A` }] };
        const i = K - 1, op = { id: D.id[i], iq: D.iq[i] };
        const T = S.torqueOf(m, op.id, op.iq);
        animate(A, dt, n, op, 200);
        const thE = (M0.p * A.thM) % (2 * PI);
        const s3 = (id, t) => { const e = $(id); if (e && e.textContent !== t) e.textContent = t; };
        s3('d-t', `${T.toFixed(0)} N·m`); s3('d-ref', `${data.id1.toFixed(0)} / ${data.iq1} A`);
        const v = S.voltages(m, op.id, op.iq, S.wElec(m, n));
        s3('d-v', `${v.vd.toFixed(0)} / ${v.vq.toFixed(0)} V`); s3('d-ab', `${v.vs.toFixed(0)} V`); s3('d-d', `${(v.vs / S.vLimit(m) * 100).toFixed(0)}%`);
        s3('d-abc', `${D.ia[i].toFixed(0)} A…`); s3('d-cl', 'iα iβ'); s3('d-dq', `${op.id.toFixed(0)} / ${op.iq.toFixed(0)} A`);
        s3('d-th', `θe ${((thE / DEG + 360) % 360).toFixed(0)}°`);
      },
      leave() { s.clearCoils(); },
    };
  },
};

// ---------------------------------------------------------- 第 7 章
const weaken = {
  id: 'weakening', nav: '高速弱磁', view: 'axial',
  title: '高速为什么还能转：弱磁',
  lead: '转子的永磁体切割绕组，产生和转速成正比的<b>反电动势</b>。满载时转速到约 4000 rpm，反电动势加上电感压降就顶到了电压上限，再往上电流灌不进去。办法是加负的 i<sub>d</sub> 抵消一部分磁场，用扭矩换转速。',
  body: () => `
    ${ctl('wn', '电机转速', 500, 16000, 100, 7000)}
    ${ctl('wv', '母线电压', 300, 800, 10, 400)}
    <div class="btns">${btn('b-fw', '弱磁打开', true)}</div>
    <div class="kpis">${kpi('k-e', '反电动势峰值')}${kpi('k-vm', '可用电压')}${kpi('k-t', '最大扭矩')}${kpi('k-p', '功率')}${kpi('k-id', 'i<sub>d</sub>')}</div>
    ${plot('wc', 200, `工作点在 i<sub>d</sub>–i<sub>q</sub> 平面：只能待在两个边界的重叠区`)}
    ${plot('wt', 128, `外特性：扭矩（N·m） <span>${key(C.accent, '弱磁')} ${key(C.axis, '不弱磁')}</span>`)}
    ${plot('wp', 96, '功率（kW）')}`,
  notes: () => `
    ${note('为什么这样做', 'a', '<p>电压方程可以近似写成 V ≈ ω·λ，λ 是绕组里的总磁链。电压封顶以后，转速想翻倍，磁链就得减半。负的 i<sub>d</sub> 产生和永磁体相反的磁场，把 λ 压下来。图里电压椭圆的中心在 i<sub>d</sub> = −ψ<sub>f</sub>/L<sub>d</sub>，转速越高椭圆越小，工作点被推着往左走。</p><p>这段区域 V、I 都顶到上限，功率基本恒定，所以外特性是一条双曲线。基速往上的这一大段让单挡减速器够用：约 4000 到 16000 rpm 都在满功率。</p>')}
    ${note('高速的几条路', '', `<ul><li><b>负 i<sub>d</sub> 弱磁 <span class="ev a">永磁主流</span></b>：不加硬件。代价是持续的无功电流和铜损。</li><li><b>提高母线电压 <span class="ev b">800 V 平台</span></b>：基速直接外推。把电压拉到 800 试试。真实的 800 V 电机通常同时增加匝数，所以基速不一定翻倍，好处主要落在同样功率下电流减半。</li><li><b>电励磁转子 <span class="ev a">宝马、雷诺</span></b>：直接把转子电流调小，不用靠负 i<sub>d</sub>。第 9 章有对比。</li><li><b>两挡变速箱 <span class="ev b">保时捷 Taycan 后轴</span></b>：用机械换转速，代价是结构复杂。</li></ul>`)}
    ${note('依赖的假设', 'c', '<p>电感恒定、忽略电阻压降。可用电压取 V<sub>dc</sub>/√3 再留 5% 裕量。真实电机高速时铁损和机械损耗上升，所以功率曲线通常会往下掉，不会这么平。</p>')}
    ${note('什么时候失效', 'a', '<p>本机型 16000 rpm 时相反电动势峰值约 503 V，线电压峰值约 870 V，远高于 400 V 母线。如果这时逆变器突然封管，六个续流二极管就成了整流桥，电机变成不受控的发电机，往母线灌电流，车轮上出现一个没人要的制动力。这叫不控整流，所以高速故障时控制器通常走主动短路，而不是直接关管。</p>')}`,
  enter(A) {
    const s = A.stage;
    let n = 7000, Vdc = 400, fw = true, dirty = true;
    const pc = new Plot($('wc'), { l: 38, b: 20, t: 8 }), pt = new Plot($('wt'), { l: 38, b: 16, t: 6 }), pp = new Plot($('wp'), { l: 38, b: 18, t: 6 });
    bind('wn', (v) => { n = v; dirty = true; }, (v) => `${f0(v)} rpm`);
    bind('wv', (v) => { Vdc = v; dirty = true; }, (v) => `${v} V`);
    $('b-fw').onclick = () => { fw = !fw; $('b-fw').setAttribute('aria-pressed', fw); $('b-fw').textContent = fw ? '弱磁打开' : '弱磁关闭'; dirty = true; };
    A.setLegend(LEG_AXIAL); A.setSlow('3D 慢放 ×160');
    let op = { id: 0, iq: 0 }, curve, nofw, m = { ...M0 };
    const render = () => {
      m = { ...M0, Vdc };
      curve = S.tnCurve(m, 110); nofw = S.tnNoFw(m, 110);
      const we = S.wElec(m, n);
      if (fw) { const mx = S.maxTorqueAt(m, we); op = { id: mx.id, iq: mx.iq, T: mx.T }; } else { const i = nofw.reduce((b, c, k) => (Math.abs(c.n - n) < Math.abs(nofw[b].n - n) ? k : b), 0); const T = nofw[i].T; op = { id: 0, iq: T / (1.5 * m.p * m.psi), T }; }
      const Vl = S.vLimit(m), E = S.backEmf(m, we);
      set('k-e', unit(E.toFixed(0), 'V')); set('k-vm', unit(Vl.toFixed(0), 'V')); set('k-t', unit(op.T.toFixed(0), 'N·m'));
      set('k-p', unit(n0(op.T * S.rpm2rad(n) / 1e3), 'kW')); set('k-id', unit(n0(op.id), 'A'));
      // 平面图：两轴等比例，圆才是圆
      pc.size();
      const pw = pc.w - pc.pad.l - pc.pad.r, ph = pc.h - pc.pad.t - pc.pad.b, yTop = 620, k = ph / yTop, xSpan = pw / k;
      pc.clear().scale(120 - xSpan, 120, 0, yTop).axes({ xt: niceTicks(120 - xSpan, 120, 4), yt: [0, 200, 400, 600], xl: 'id (A)', yl: 'iq (A)' });
      const g = pc.g, tau = 2 * PI;
      const circ = () => { g.beginPath(); g.arc(pc.X(0), pc.Y(0), m.Imax * k, 0, tau); };
      const ell = (w) => { const r = S.vLimit(m) / w; g.beginPath(); g.ellipse(pc.X(-m.psi / m.Ld), pc.Y(0), r / m.Ld * k, r / m.Lq * k, 0, 0, tau); };
      pc.clip(() => {
        g.save(); circ(); g.clip(); ell(we); g.fillStyle = 'rgba(255,157,60,.18)'; g.fill(); g.restore();
        g.lineWidth = 2; g.strokeStyle = C.d; circ(); g.stroke();
        g.strokeStyle = C.accent; ell(we); g.stroke();
        g.lineWidth = 1; g.strokeStyle = 'rgba(255,157,60,.3)'; g.setLineDash([3, 4]); for (const nn of [3000, 16000]) { ell(S.wElec(m, nn)); g.stroke(); } g.setLineDash([]);
      });
      const mtx = [], mty = [];
      for (let I = 0; I <= m.Imax; I += 10) { const a = S.mtpaAngle(m, I); mtx.push(I * Math.cos(a)); mty.push(I * Math.sin(a)); }
      pc.line(mtx, mty, C.fg, 1.4, [5, 3]);
      pc.dot(op.id, op.iq, C.fg, 5.5);
      pc.label(mtx.at(-1), mty.at(-1), 'MTPA', C.fg, { dx: 4, dy: -12 }).label(-m.Imax * .72, m.Imax * .72, `电流圆 ${m.Imax} A`, C.fg, { dx: -10, dy: -14 });
      pc.label(-m.psi / m.Ld, S.vLimit(m) / we / m.Lq * .8, '电压椭圆', C.fg, { dx: 6, dy: 0 });
      const ns = curve.map((c) => c.n), Ts = curve.map((c) => c.T), Pk = curve.map((c) => c.P / 1e3), Tn = nofw.map((c) => c.T), Pn = nofw.map((c, i) => c.T * S.rpm2rad(c.n) / 1e3);
      const xt = [0, 4000, 8000, 12000, 16000], xf = (v) => `${v / 1000}k`;
      const tTop = 380, pTop = Math.max(200, Math.ceil(Math.max(...Pk) / 50 + .4) * 50);
      pt.clear().scale(0, 16000, 0, tTop).axes({ xt, xf, yt: [0, 100, 200, 300] });
      pt.line(ns, Tn, C.axis, 2, [5, 4]).line(ns, Ts, C.accent, 2).vline(n, C.fg, [], 1).dot(n, op.T, C.accent, 5);
      pt.hover = { x: ns, xf: (v) => `${f0(v)} rpm`, series: [{ n: '弱磁', c: C.accent, y: Ts, f: (v) => `${v.toFixed(0)} N·m` }, { n: '不弱磁', c: C.axis, y: Tn, f: (v) => `${v.toFixed(0)} N·m` }] };
      pp.clear().scale(0, 16000, 0, pTop).axes({ xt, xf, yt: niceTicks(0, pTop, 3), xl: 'rpm' });
      pp.line(ns, Pn, C.axis, 2, [5, 4]).line(ns, Pk, C.accent, 2).vline(n, C.fg, [], 1).dot(n, op.T * S.rpm2rad(n) / 1e3, C.accent, 5);
      pp.hover = { x: ns, xf: (v) => `${f0(v)} rpm`, series: [{ n: '弱磁', c: C.accent, y: Pk, f: (v) => `${v.toFixed(0)} kW` }, { n: '不弱磁', c: C.axis, y: Pn, f: (v) => `${v.toFixed(0)} kW` }] };
    };
    return {
      tick(dt) {
        if (dirty) { dirty = false; render(); }
        const thE = animate(A, dt, n, op, 160, { field: true });
        axialLabels(A, A.thM, thE, true, clamp(Math.hypot(op.id, op.iq) / 120, 0, 1));
      },
      leave() { s.clearCoils(); s.ring.visible = false; A.setLabels([]); },
    };
  },
};

// ---------------------------------------------------------- 第 8 章
function brakeSplit(m, v, Fdem, Pacc) {
  const n = S.motorRpmFromV(v), wm = S.rpm2rad(n), we = S.wElec(m, n);
  const want = Fdem * CAR.r / CAR.G * CAR.eta;
  const Tlim = S.maxTorqueAt(m, Math.max(we, 40)).T;
  const TP = wm > 5 ? Pacc * 1e3 / (wm * .92) : Tlim;
  const kmh = v * 3.6, fade = clamp((kmh - 5) / 7, 0, 1);
  const T = Math.min(want, Tlim, TP) * fade;
  const Freg = T * CAR.G / (CAR.eta * CAR.r);
  return { T, Freg, Ffr: Math.max(Fdem - Freg, 0), why: want < 1 ? '' : fade < .99 ? '低速淡出' : T >= want - .5 ? '全靠回收' : TP < Tlim ? '电池功率限制' : '电机能力限制' };
}
const regen = {
  id: 'regen', nav: '能量回收', view: 'road',
  title: '能量回收：把扭矩翻成负的',
  lead: '同一个电机、同一套开关，把 <b>i<sub>q</sub> 变成负值</b>，扭矩就反向。车轮拖着转子转，机械功率倒灌，电机变发电机，电流经逆变器回到电池。回收不够的部分由摩擦制动补上。',
  body: () => `
    ${ctl('rd', '制动强度', 0, .5, .01, .2)}
    ${ctl('rp', '电池能收的功率', 5, 150, 5, 90)}
    <div class="btns">${btn('b-re', '从 100 km/h 重新开始')}${btn('b-120', '从 160 km/h 开始')}</div>
    <div class="kpis">${kpi('k-v', '车速')}${kpi('k-t', '电机扭矩')}${kpi('k-p', '回到电池')}${kpi('k-w', '累计回收')}${kpi('k-s', '谁在主导')}</div>
    ${plot('ra', 136, `制动力由谁出（kN），横轴是时间 <span>${key(C.d, '电机回收')} ${key(C.accent, '摩擦制动')}</span>`)}
    ${plot('rb', 130, '这个制动扭矩下，回到电池的净功率（kW，低速段）')}`,
  notes: () => `
    ${note('为什么同一套硬件能双向', 'a', '<p>电机的功率是 T·ω。转子一直朝前转，所以扭矩反号，功率就反号。逆变器每个开关都并着一个二极管（或者同步导通的 MOSFET），电流本来就能双向流，控制上只改了 i<sub>q</sub> 的符号。</p>')}
    ${note('为什么低速回收不了', 'a', '<p>扭矩不变时，机械功率随转速线性下降，但铜损只看电流，不随转速变。上面第二张图的曲线穿过零点：转速低于这一点，为了维持这个制动扭矩，电池反而要往外放电。所以实车在很低的车速把回收淡出，由液压接手；也有车型继续用电机扭矩把车刹停，这时不再是回收，是在花电做制动。</p>')}
    ${note('另外两个上限', 'b', '<ul><li><b>电池收不下</b>：满电或低温时充电功率很低，把“电池能收的功率”调小看看，这时摩擦制动占比上升。这也解释了冬天动能回收为什么变弱。</li><li><b>电机外特性</b>：高速段受恒功率区限制，能给的制动扭矩比低速少。</li></ul>')}
    ${note('依赖的假设', 'c', '<p>只算一个后驱电机，制动力全部走后轮。真实车辆要按载荷转移分配前后轴，急刹时大部分制动力在前轮，所以单电机后驱车的回收比例受限于稳定性。这里的 5 到 12 km/h 淡出区间是我设的示意值。</p>')}`,
  enter(A) {
    const s = A.stage, m = M0;
    let a = .2, Pa = 90, st = { v: 27.8, soc: .6, t: 0 }, Wh = 0, acc = 0, dirty = true;
    const R = rolling(160);
    const reset = (v) => { st = { v: v / 3.6, soc: .6, t: 0 }; Wh = 0; R.x.length = 0; R.ys.length = 0; };
    bind('rd', (v) => { a = v; dirty = true; }, (v) => `${v.toFixed(2)} g`);
    bind('rp', (v) => { Pa = v; }, (v) => `${v} kW`);
    $('b-re').onclick = () => reset(100); $('b-120').onclick = () => reset(160);
    const pa = new Plot($('ra'), { l: 34, b: 20 }), pb = new Plot($('rb'), { l: 40, b: 20 });
    A.setSlow('3D 慢放 ×20'); A.setLegend(`${key('#58e0a0', '机械功率，回收时倒流')}${key('#ffb547', '直流')}`);
    return {
      tick(dt) {
        const Fdem = a * CAR.m * S.G0;
        const sp = st.v > .05 ? brakeSplit(m, st.v, Fdem, Pa) : { T: 0, Freg: 0, Ffr: 0, why: '已停车' };
        for (let i = 0; i < 2; i++) st = S.stepCar(m, st, dt / 2, -sp.T, st.v > .05 ? sp.Ffr : 0, 0);
        Wh += Math.max(-st.P.Pdc, 0) * dt / 3600;
        s.scrollRoad(st.v * dt / 20);
        animate(A, dt, st.n, st.op, 20);
        s.setFlow(st.P.Pdc / 1e3);
        s.setBrakeGlow(clamp(sp.Ffr / 6000, 0, 1));
        acc += dt; if (acc > .12 && st.v > .05) { acc = 0; R.push(st.t, sp.Freg / 1e3, (sp.Freg + sp.Ffr) / 1e3); }
        set('k-v', unit(f1(st.v * 3.6), 'km/h')); set('k-t', unit(n0(st.op.T), 'N·m'));
        set('k-p', unit((-st.P.Pdc / 1e3).toFixed(1), 'kW')); set('k-w', unit(Wh.toFixed(0), 'Wh')); set('k-s', `<span style="font:500 14px var(--f-cn)">${sp.why || '滑行'}</span>`);
        const xs = R.x, top = Math.max(4, Math.ceil(Fdem / 1e3 + .6));
        const tEnd = Math.max(12, xs.at(-1) || 0);
        pa.clear().scale(0, tEnd, 0, top).axes({ xt: niceTicks(0, tEnd, 5), xf: (v) => `${v}s`, yt: niceTicks(0, top, 3) });
        if (xs.length > 1) {
          const y1 = R.col(0), y2 = R.col(1);
          const area = (lo, hi, col) => pa.clip((g) => { g.fillStyle = col; g.beginPath(); xs.forEach((x, i) => g.lineTo(pa.X(x), pa.Y(hi[i]))); for (let i = xs.length - 1; i >= 0; i--) g.lineTo(pa.X(xs[i]), pa.Y(lo[i])); g.closePath(); g.fill(); });
          area(xs.map(() => 0), y1, C.d); area(y1, y2, C.accent);
          pa.hover = { x: xs, xf: (v) => `${v.toFixed(1)} s`, series: [{ n: '回收', c: C.d, y: y1, f: (v) => `${v.toFixed(1)} kN` }, { n: '摩擦', c: C.accent, y: y2.map((v, i) => v - y1[i]), f: (v) => `${v.toFixed(1)} kN` }] };
        }
        if (dirty || st.v > .05) {
          dirty = false;
          const T = -Math.max(Fdem * CAR.r / CAR.G * CAR.eta, 5), ns = [], Ps = [];
          for (let n = 40; n <= 1500; n += 20) { const we = S.wElec(m, n), op = S.solveOp(m, T, we), P = S.powerAt(m, op.T, op.id, op.iq, we); ns.push(n); Ps.push(-P.Pdc / 1e3); }
          const mx = Math.max(...Ps, 4), mn = Math.min(...Ps, -2), y0 = Math.floor(mn), y1 = Math.ceil(mx * 1.1);
          pb.clear().scale(0, 1500, y0, y1).axes({ xt: [0, 500, 1000, 1500], xl: 'rpm', yt: niceTicks(y0, y1, 3), zero: true });
          pb.line(ns, Ps, C.d, 2);
          const zi = Ps.findIndex((v) => v > 0);
          if (zi > 0) { pb.dot(ns[zi], 0, C.accent, 5); pb.label(ns[zi], 0, `${ns[zi]} rpm（约 ${(S.vFromRpm(ns[zi]) * 3.6).toFixed(0)} km/h）以下倒贴`, C.fg, { dx: 8, dy: 14 }); }
          pb.hover = { x: ns, xf: (v) => `${v} rpm`, series: [{ n: '净回收', c: C.d, y: Ps, f: (v) => `${v.toFixed(1)} kW` }] };
        }
      },
      leave() { s.setFlow(0); s.clearCoils(); s.setBrakeGlow(0); },
    };
  },
};

// ---------------------------------------------------------- 第 9 章
const routes = {
  id: 'routes', nav: '三条路线', view: 'cut',
  title: '换一种电机，调法有什么不同',
  lead: '前面讲的都是内嵌永磁同步电机。另外两种电机同样用 FOC 这一套框架，区别在<b>转子磁场从哪来</b>，这决定了扭矩和高速段怎么调。',
  body: () => `
    <div class="tw"><table>
      <thead><tr><th></th><th>永磁同步（主流）</th><th>感应异步</th><th>电励磁同步</th></tr></thead>
      <tbody>
      <tr><th>转子磁场</th><td>磁钢，一直在</td><td>定子感应出转子电流</td><td>转子线圈通直流</td></tr>
      <tr><th>调扭矩</th><td>i<sub>q</sub>，加 i<sub>d</sub> 的磁阻份额</td><td>转差频率和转子电流</td><td>i<sub>q</sub> 加励磁电流</td></tr>
      <tr><th>高速段</th><td>负 i<sub>d</sub> 弱磁</td><td>减小励磁分量即可</td><td>直接减小转子电流</td></tr>
      <tr><th>长处</th><td>功率密度高，中低速效率好</td><td>无稀土；断电后几乎没有拖曳</td><td>无稀土；磁场可调，轻载高速效率好</td></tr>
      <tr><th>代价</th><td>依赖稀土；磁场关不掉，空转有铁损</td><td>转子铜损发热，功率密度偏低</td><td>励磁持续耗电；电刷滑环会磨损，无刷方案更复杂</td></tr>
      <tr><th>代表</th><td>绝大多数纯电车</td><td>宝马 Gen6 前轴；早期特斯拉 Model S</td><td>宝马 Gen5、Gen6 后轴；雷诺</td></tr>
      </tbody>
    </table></div>
    <div id="part" class="card"><h4>转子是这三种电机差别最大的地方</h4><p>可以在模型上点转子、定子、水道，看它们各自的作用。定子和逆变器三种电机基本一样。</p></div>`,
  notes: () => `
    ${note('我的建议', 'b', '<p>想理解电动车调速，先把永磁同步这一套吃透，它占绝大多数。Adamas Intelligence 的统计里，2021 年上半年新装车的电机有 92.1% 是永磁同步，这是我查到的最近一份按类型拆分的公开数字，之后几年的比例我没有查到可靠更新。</p>')}
    ${note('趋势判断', 'd', '<p>稀土价格和供应风险会继续把一部分车型推向电励磁和感应电机，尤其是双电机车的副驱轴，因为不出力时断开磁场能省能耗。永磁在紧凑型和高功率密度场合的优势短期内不容易被替代。这段是我的推测。</p>')}
    <div class="note"><h3>来源</h3><ul class="sources">
      <li><a href="https://www.adamasintel.com/?p=11819" target="_blank" rel="noopener">Adamas Intelligence：EV 电机类型占比（2021 H1）</a></li>
      <li><a href="https://evkx.net/en/technology/motors/wrsm/" target="_blank" rel="noopener">EVKX：电励磁同步电机原理、优缺点和车型</a></li>
      <li><a href="https://www.bmwblog.com/2025/02/20/bmw-gen6-electric-motors-neue-klasse-powertrain/" target="_blank" rel="noopener">BMW Blog：Gen6 电驱的电机类型</a></li>
      <li><a href="https://www.lesics.com/tesla-model-3_s-ipm-synrm-electric-motor.html" target="_blank" rel="noopener">Lesics：Model 3 IPM-SynRM 电机与高速弱磁</a></li>
      <li><a href="https://autos.yahoo.com/why-porsche-taycan-evs-two-010000491.html" target="_blank" rel="noopener">Yahoo Autos：保时捷 Taycan 两挡变速箱</a></li>
      <li><a href="https://www.ttii.com/content/ttii/en/marketeye/articles/categories/new-technology/me-slovick-20250429.html" target="_blank" rel="noopener">TTI：SiC 牵引逆变器与 800 V 趋势</a></li>
    </ul></div>`,
  enter(A) {
    const s = A.stage;
    A.setSlow('3D 慢放 ×200'); A.setLegend(`${key('#29a8d8', '冷却水道')}${key('#d8383f', '转子 N')}${key('#2f6fdf', '转子 S')}`);
    A.partHost = 'part';
    return {
      tick(dt) { animate(A, dt, 1400, { id: -60, iq: 220 }, 200); },
      leave() { s.clearCoils(); A.partHost = null; },
    };
  },
};

// ---------------------------------------------------------- 第 10 章
const drive = {
  id: 'drive', nav: '试驾', view: 'road',
  title: '自己开一下',
  lead: '把前面的东西连起来。加速时看工作点沿外特性走完恒扭矩段、进入恒功率段，松踏板看它翻到负扭矩。',
  body: () => `
    ${ctl('dp', '加速踏板', 0, 100, 1, 22)}
    ${ctl('db', '制动踏板', 0, 100, 1, 0)}
    ${ctl('dg', '坡度', -10, 20, 1, 0)}
    <div class="btns">${btn('b-lau', '全油门测 0–100')}${btn('b-one', '松踏板回收', true)}${btn('b-stop', '回到静止')}</div>
    <p class="pt">键盘：<b>↑</b> 加速，<b>↓</b> 制动（焦点不在滑杆上时）</p>
    <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">${kpi('k-v', '车速')}${kpi('k-n', '电机转速')}${kpi('k-t', '扭矩')}${kpi('k-p', '电池功率')}${kpi('k-e', '效率')}${kpi('k-m', '工况')}</div>
    ${plot('dm', 190, '效率地图和工作点（模型估算，电池到电机轴）')}
    <p class="pt" id="dleg">${BAND_LABELS.map((t, i) => `<span style="margin-left:0"><i style="background:rgb(${BAND_RGB[i].join(',')});width:12px;height:10px;vertical-align:-1px"></i>${t}</span>`).join(' ')}</p>
    ${plot('di', 110, `dq 电流（A），最近 20 秒 <span>${key(C.accent, 'i<sub>q</sub>')} ${key(C.d, 'i<sub>d</sub>')}</span>`)}`,
  notes: () => `
    ${note('试着看这几件事', '', '<ul><li>全油门起步：i<sub>q</sub> 和 i<sub>d</sub> 都顶到 MTPA 的值，扭矩是平的。约 55 km/h 过基速后 i<sub>q</sub> 下降、i<sub>d</sub> 继续变负，进入恒功率。</li><li>高速巡航：扭矩不大，但 i<sub>d</sub> 还是负的，这份电流只用来压反电动势，所以高速轻载效率会掉。</li><li>坡度调到 +20%：同样的踏板下车速平衡点往下移。</li></ul>')}
    ${note('效率地图可信吗', 'c', '<p>损耗用的是简化模型：铜损按电流平方，铁损按频率和磁链估算，逆变器损耗按电流和开关频率估算，系数只是量级合理。真实地图要台架逐点测，能看趋势，别当具体数字用。</p>')}`,
  enter(A) {
    const s = A.stage, m = M0;
    let st = { v: 16.7, soc: .8, t: 0 }, pedal = .22, brake = 0, gr = 0, one = true, Wup = false, Wdn = false, laun = null, res = null;
    const pdl = bind('dp', (v) => { pedal = v / 100; }, (v) => `${v}%`);
    const brk = bind('db', (v) => { brake = v / 100; }, (v) => `${v}%`);
    bind('dg', (v) => { gr = v; }, (v) => `${v > 0 ? '+' : ''}${v}%`);
    $('b-one').onclick = () => { one = !one; $('b-one').setAttribute('aria-pressed', one); };
    $('b-stop').onclick = () => { st = { v: 0, soc: st.soc, t: 0 }; pdl.set(0); brk.set(0); laun = null; };
    $('b-lau').onclick = () => { st = { v: 0, soc: st.soc, t: 0 }; brk.set(0); pdl.set(100); laun = 0; res = null; };
    const kd = (e) => { if (document.activeElement && document.activeElement.tagName === 'INPUT') return; if (e.key === 'ArrowUp') { Wup = true; e.preventDefault(); } if (e.key === 'ArrowDown') { Wdn = true; e.preventDefault(); } };
    const ku = (e) => { if (e.key === 'ArrowUp') Wup = false; if (e.key === 'ArrowDown') Wdn = false; };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    const pm = new Plot($('dm'), { l: 38, b: 20, t: 6 }), pi = new Plot($('di'), { l: 38, b: 16, t: 6 });
    // 效率地图：逐点算一遍，画到离屏画布
    const cols = 140, rows = 92, nTop = 16000, tTop = 340;
    const off = document.createElement('canvas'); off.width = cols; off.height = rows;
    const gx = off.getContext('2d'), im = gx.createImageData(cols, rows);
    const ramp = (e) => { let k = 0; while (k < BANDS.length && e >= BANDS[k]) k++; return BAND_RGB[k]; };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const n = (i + .5) / cols * nTop, T = (rows - j - .5) / rows * tTop, we = S.wElec(m, Math.max(n, 30));
      const mx = S.maxTorqueAt(m, we, 80).T, o = (j * cols + i) * 4;
      if (T > mx) { im.data[o + 3] = 0; continue; }
      const op = S.solveOp(m, T, we, 70), P = S.powerAt(m, op.T, op.id, op.iq, we), c = ramp(P.eff);
      im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
    }
    gx.putImageData(im, 0, 0);
    const cv = S.tnCurve(m, 80), R = rolling(200);
    let acc = 0, label = 1;
    A.setSlow('3D 慢放 ×20'); A.setLegend(`${key('#58e0a0', '机械功率')}${key('#ffb547', '直流')}${key('#c78bff', '三相交流')}`);
    return {
      tick(dt) {
        const pu = Wup ? 1 : pedal, br = Wdn ? 1 : brake, nNow = S.motorRpmFromV(st.v), we0 = S.wElec(m, Math.max(nNow, 30));
        let cmd = pu * S.maxTorqueAt(m, we0).T, Ff = 0;
        if (br > .01 || (one && pu < .02 && st.v > .3)) {
          const a = br > .01 ? .1 + br * .7 : .09;
          const sp = brakeSplit(m, st.v, a * CAR.m * S.G0, 90);
          cmd = -sp.T; Ff = sp.Ffr;
        }
        for (let i = 0; i < 3; i++) st = S.stepCar(m, st, dt / 3, cmd, Ff, gr);
        if (laun !== null) { laun += dt; if (st.v >= 100 / 3.6) { res = laun; laun = null; pdl.set(0); } }
        s.scrollRoad(st.v * dt / 20);
        animate(A, dt, st.n, st.op, 20);
        s.setFlow(st.P.Pdc / 1e3);
        s.setBrakeGlow(clamp(Ff / 6000, 0, 1));
        acc += dt; if (acc > .1) { acc = 0; R.push(performance.now() / 1e3, st.op.iq, st.op.id); }
        label += dt;
        if (label > .12) {
          label = 0;
          set('k-v', unit(f0(st.v * 3.6), 'km/h')); set('k-n', unit(f0(st.n), 'rpm')); set('k-t', unit(n0(st.op.T), 'N·m'));
          set('k-p', unit(n0(st.P.Pdc / 1e3), 'kW')); set('k-e', unit(Math.abs(st.P.Pm) > 300 ? (st.P.eff * 100).toFixed(1) : '–', '%'));
          const mode = st.v < .05 && Math.abs(st.op.T) < 1 ? '静止' : st.op.T < -.5 ? '回收' : st.op.mode === 'fw' ? '弱磁' : st.op.T > .5 ? '恒扭矩区' : '滑行';
          set('k-m', `<span style="font:500 14px var(--f-cn)">${res ? `0–100：${res.toFixed(1)} s` : mode}</span>`);
        }
        pm.clear().scale(0, nTop, 0, tTop).axes({ xt: [0, 4000, 8000, 12000, 16000], xf: (v) => `${v / 1000}k`, yt: [0, 100, 200, 300], xl: 'rpm', yl: 'N·m' });
        const g = pm.g; g.imageSmoothingEnabled = true;
        g.drawImage(off, pm.X(0), pm.Y(tTop), pm.X(nTop) - pm.X(0), pm.Y(0) - pm.Y(tTop));
        pm.line(cv.map((c) => c.n), cv.map((c) => c.T), C.fg, 1.6);
        pm.dot(clamp(st.n, 0, nTop), clamp(Math.abs(st.op.T), 0, tTop), st.op.T < -.5 ? C.d : C.accent, 6);
        pm.label(9000, 268, '外特性', C.fg, { bg: true, dy: 0 });
        const xs = R.x, t1 = xs.at(-1) ?? 20, iq = R.col(0), id = R.col(1);
        pi.clear().scale(t1 - 20, t1, -520, 520).axes({ yt: [-400, 0, 400], zero: true });
        if (xs.length > 1) {
          pi.line(xs, iq, C.accent, 2).line(xs, id, C.d, 2);
          pi.hover = { x: xs.slice(), xf: (v) => `${(v - t1).toFixed(1)} s`, series: [{ n: 'iq', c: C.accent, y: iq, f: (v) => `${v.toFixed(0)} A` }, { n: 'id', c: C.d, y: id, f: (v) => `${v.toFixed(0)} A` }] };
        }
      },
      leave() { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); s.setFlow(0); s.clearCoils(); s.setBrakeGlow(0); },
    };
  },
};

export const CHAPTERS = [overview, field, torque, speed, inverter, foc, weaken, regen, routes, drive];
