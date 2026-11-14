// 原理实验：力的账本 + 流量曲线（A）、两级 vs 单级（B）、圆顶 vs 弹簧（C）、药液（D）、背压（E）、开环 vs 闭环（F G H）
import * as C from './core.js';
import { css, fit, bind, set, onTheme, whenVisible, plot } from './ui.js';

const f0 = (v) => v.toFixed(0), f1 = (v) => v.toFixed(1);

// ---------------- 实验一：力的账本 + 流量曲线 ----------------
export function setupForce() {
  const p = { ...C.ST_A };
  const s = { set: 300, P1: 1000, q: 120 };
  const cvF = document.getElementById('cvForce'), cvQ = document.getElementById('cvFlow');
  function curve(P1, F) {
    const out = [];
    for (let q = 0; q <= 900; q += q < 60 ? 3 : 12) {
      const r = C.steadyStage(p, P1, F, C.demandC(q));
      out.push([r.Q, r.P2g, r.X >= p.hmax * 0.999]);
    }
    return out;
  }
  function draw() {
    const F = C.forceFor(p, 1000, s.set);
    const r = C.steadyStage(p, s.P1, F, C.demandC(s.q));
    const x = Math.max(0, r.X);
    const down = [['弹簧', F - p.ks * x, '--s1']];
    const up = [['出口压力 × 膜片面积', r.P2g * 1e3 * p.Ad, '--s2'], ['进口压力 × 阀口面积', (s.P1 - r.P2g) * 1e3 * p.As, '--s4'],
      ['阀芯弹簧', p.Fp0 + p.kp * x, '--s3'], ['膜片自身刚度', p.kd * x, '--ink3']];
    const sumU = up.reduce((a, b) => a + b[1], 0), sumD = down[0][1];
    if (sumU > sumD + 0.05) down.push(['阀座顶回来的力', sumU - sumD, 'seat']);
    // 力的账本
    {
      const { c, w, h } = fit(cvF);
      c.clearRect(0, 0, w, h);
      const L = 112, R = 14, max = Math.max(sumU, sumD) * 1.06;
      const X = (v) => L + v / max * (w - L - R);
      const rows = [['向下推（开阀）', down, 44], ['向上推（关阀）', up, 112]];
      c.font = '500 13px ' + css('--sans');
      for (const [title, parts, y] of rows) {
        c.fillStyle = css('--ink2'); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(title, L - 10, y);
        let acc = 0;
        parts.forEach(([n, v, col], i) => {
          const x0 = X(acc), x1 = X(acc + v);
          if (col === 'seat') {
            c.save(); c.strokeStyle = css('--ink3'); c.setLineDash([4, 3]); c.strokeRect(x0, y - 14, Math.max(1, x1 - x0), 28); c.restore();
          } else { c.fillStyle = css(col); c.fillRect(x0, y - 14, Math.max(1, x1 - x0 - 1), 28); }
          if (x1 - x0 > 44) {
            c.fillStyle = col === 'seat' ? css('--ink3') : '#fff'; c.textAlign = 'center'; c.font = '700 11.5px ' + css('--mono');
            c.fillText(`${f0(v)} N`, (x0 + x1) / 2, y);
          }
          // 名字写在条下面
          c.font = '500 11.5px ' + css('--sans'); c.fillStyle = css('--ink3'); c.textAlign = 'left';
          if (x1 - x0 > 60 || i === 0) c.fillText(n, x0 + 2, y + 24);
          acc += v;
        });
        c.font = '500 13px ' + css('--sans');
      }
      c.fillStyle = css('--ink3'); c.font = '500 12px ' + css('--sans'); c.textAlign = 'left';
      c.fillText(r.X > 0 ? '两边相等：阀芯停在这个开度。' : '阀芯坐在阀座上：向上的力多出来的部分由阀座承受。', L, h - 14);
    }
    // 流量曲线
    {
      const { c, w, h } = fit(cvQ);
      c.clearRect(0, 0, w, h);
      const cur = curve(s.P1, F), low = curve(s.P1 === 1000 ? 500 : 1000, F);
      const ymax = s.set + 12, ymin = s.set - 45;
      const P = plot(c, w, h, { x: [0, 420], y: [ymin, ymax], xt: [0, 100, 200, 300, 400], yt: [ymin + 5, s.set - 20, s.set], xl: '流量 NL/min', yl: '出口压力 kPa', L: 50 });
      P.ln([[0, s.set], [420, s.set]], css('--ink3'), 1, [3, 4]);
      P.label(410, s.set, '零流量设定', css('--ink3'), 'right', -9);
      P.ln(low.map((q) => [q[0], q[1]]), css('--s4'), 1.6, [6, 4]);
      P.ln(cur.map((q) => [q[0], q[1]]), css('--s2'), 2.4);
      const sat = cur.find((q) => q[2]);
      if (sat) { P.dot(sat[0], sat[1], css('--ink3'), 3.5); P.label(sat[0], sat[1], '阀芯全开，之后不再调节', css('--ink3'), 'left', 12); }
      P.dot(r.Q, r.P2g, css('--s1'), 5.5);
      const lowEnd = low[Math.min(low.length - 1, 6)];
      P.label(lowEnd[0] + 4, lowEnd[1], `进口 ${s.P1 === 1000 ? 500 : 1000} kPa`, css('--s4'), 'left', s.P1 === 1000 ? -10 : 10);
    }
    const r0 = C.steadyStage(p, s.P1, F, C.demandC(0.5));
    set('l1_read', [['出口压力', `${f1(r.P2g)} kPa`], ['流量', `${f0(r.Q)} NL/min`], ['阀芯开度', `${(x * 1e3).toFixed(3)} mm`], ['比零流量低', `${f1(r0.P2g - r.P2g)} kPa`],
      ['弹簧（向下）', `${f1(down[0][1])} N`], ['出口 × 膜片', `${f1(up[0][1])} N`], ['进口 × 阀口', `${f1(up[1][1])} N`], ['阀芯弹簧 + 膜片刚度', `${f1(up[2][1] + up[3][1])} N`]]
      .map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join(''));
  }
  bind('l1_set', (v) => { s.set = v; draw(); }, (v) => `${v} kPa`);
  bind('l1_p1', (v) => { s.P1 = v; draw(); }, (v) => `${v} kPa`);
  bind('l1_q', (v) => { s.q = v; draw(); }, (v) => `${v} NL/min`);
  draw(); onTheme(draw); window.addEventListener('resize', draw);
}

// ---------------- 实验二：两级 vs 单级 ----------------
export function setupTwo() {
  const p1 = { ...C.ST_B1 }, p2 = { ...C.ST_A };
  const pS = { ...C.ST_B1, Ad: C.ST_A.Ad, As: 0.006 * C.ST_A.Ad, ks: C.ST_A.ks, C: 0.06 };
  const pBal = { ...pS, As: pS.As * 0.12 };
  const s = { set: 300, q: 50 };
  const cv = document.getElementById('cvTwo');
  let cache = null;
  function compute() {
    const F1 = C.forceFor(p1, 15000, 1000), F2 = C.forceFor(p2, 1000, s.set);
    const Fs = C.forceFor(pS, 15000, s.set), Fb = C.forceFor(pBal, 15000, s.set);
    const Cl = C.demandC(s.q, s.set);
    const two = [], single = [], bal = [], mid = [];
    for (let cyl = 15000; cyl >= 600; cyl -= 300) {
      const t = C.steadyTwo(p1, F1, p2, F2, cyl, Cl);
      two.push([cyl / 1000, t.P2g]); mid.push([cyl / 1000, t.Pm]);
      single.push([cyl / 1000, C.steadyStage(pS, cyl, Fs, Cl).P2g]);
      bal.push([cyl / 1000, C.steadyStage(pBal, cyl, Fb, Cl).P2g]);
    }
    cache = { two, single, bal, mid };
  }
  function draw() {
    if (!cache) compute();
    const { c, w, h } = fit(cv);
    c.clearRect(0, 0, w, h);
    const lo = s.set * 0.72, hi = s.set * 1.36;
    const P = plot(c, w, h, { x: [15, 0.6], y: [lo, hi], xt: [15, 12, 9, 6, 3, 1], yt: [s.set * 0.8, s.set, s.set * 1.2], yf: (v) => v.toFixed(0), xl: '钢瓶剩余压力 MPa（从左往右用掉）', yl: '出口压力 kPa', L: 50 });
    P.ln([[15, s.set], [0.6, s.set]], css('--ink3'), 1, [3, 4]);
    P.ln(cache.single, css('--s1'), 2.4);
    P.ln(cache.bal, css('--s4'), 1.8, [6, 4]);
    P.ln(cache.two, css('--s2'), 2.6);
    const at = (arr, x) => arr.reduce((b, q) => (Math.abs(q[0] - x) < Math.abs(b[0] - x) ? q : b));
    const a = at(cache.single, 4), b = at(cache.bal, 7), d = at(cache.two, 10);
    P.label(a[0], a[1], '单级', css('--s1'), 'left', -12);
    P.label(b[0], b[1], '单级（平衡阀芯）', css('--s4'), 'left', -12);
    P.label(d[0], d[1], '两级', css('--s2'), 'left', 13);
    const sd = (arr) => { const v = arr.filter((q) => q[0] >= 1.5).map((q) => q[1]); return Math.max(...v) - Math.min(...v); };
    set('l2_read', [['单级：出口漂移', `${f1(sd(cache.single))} kPa`], ['平衡阀芯单级', `${f1(sd(cache.bal))} kPa`], ['两级：出口漂移', `${f1(sd(cache.two))} kPa`], ['两级的中间压力', `${f0(cache.mid[0][1])} → ${f0(at(cache.mid, 1.5)[1])} kPa`]]
      .map(([x, y]) => `<div><span>${x}</span><b>${y}</b></div>`).join(''));
  }
  bind('l2_set', (v) => { s.set = v; cache = null; draw(); }, (v) => `${v} kPa`);
  bind('l2_q', (v) => { s.q = v; cache = null; draw(); }, (v) => `${v} NL/min`);
  let started = false;
  whenVisible(cv, (v) => { if (v && !started) { started = true; draw(); } });
  onTheme(() => started && draw()); window.addEventListener('resize', () => started && draw());
}

// ---------------- 实验三：圆顶 vs 弹簧（C 页） ----------------
const lazy = (cv, draw) => {
  let started = false;
  whenVisible(cv, (v) => { if (v && !started) { started = true; draw(); } });
  onTheme(() => started && draw()); window.addEventListener('resize', () => started && draw());
  return () => started;
};
const rows = (arr) => arr.map(([x, y]) => `<div><span>${x}</span><b>${y}</b></div>`).join('');
const nearest = (arr, x) => arr.reduce((b, q) => (Math.abs(q[0] - x) < Math.abs(b[0] - x) ? q : b));

export function setupDroop() {
  const pA = { ...C.ST_A }, pC = { ...C.ST_C };
  const s = { set: 300, P1: 1000 };
  const cvD = document.getElementById('cvDroop');
  function draw() {
    const { c, w, h } = fit(cvD);
    c.clearRect(0, 0, w, h);
    const FA = C.forceFor(pA, 1000, s.set), FC = C.forceFor(pC, 1000, s.set);
    const ca = [], cc = [];
    for (let q = 0; q <= 900; q += q < 60 ? 3 : 12) {
      const a = C.steadyStage(pA, s.P1, FA, C.demandC(q)); ca.push([a.Q, a.P2g]);
      const b = C.steadyStage(pC, s.P1, FC, C.demandC(q)); cc.push([b.Q, b.P2g]);
    }
    const P = plot(c, w, h, { x: [0, 420], y: [s.set - 40, s.set + 10], xt: [0, 100, 200, 300, 400], yt: [s.set - 30, s.set - 15, s.set], xl: '流量 NL/min', yl: '出口压力 kPa', L: 50 });
    P.ln(ca, css('--s1'), 2.4); P.ln(cc, css('--s2'), 2.4);
    const a = nearest(ca, 230), b = nearest(cc, 230);
    P.label(a[0], a[1], '弹簧加载（A 型）', css('--s1'), 'left', 12); P.label(b[0], b[1], '圆顶加载（C 型）', css('--s2'), 'left', -12);
    const a2 = nearest(ca, 250), b2 = nearest(cc, 250);
    set('l3_read', rows([['弹簧式 0→250 NL/min 掉', `${f1(ca[0][1] - a2[1])} kPa`], ['圆顶式 0→250 NL/min 掉', `${f1(cc[0][1] - b2[1])} kPa`]]));
  }
  bind('l3_set', (v) => { s.set = v; draw(); }, (v) => `${v} kPa`);
  bind('l3_p1', (v) => { s.P1 = v; draw(); }, (v) => `${v} kPa`);
  lazy(cvD, draw);
}

// ---------------- 实验三 b：药液调压阀（D 页） ----------------
export function setupLiq() {
  const pD = { ...C.ST_D };
  const s = { P1: 400, open: 50 };
  const cvL = document.getElementById('cvLiq');
  function draw() {
    const { c, w, h } = fit(cvL);
    c.clearRect(0, 0, w, h);
    const P = plot(c, w, h, { x: [0, 380], y: [0, 400], xt: [0, 100, 200, 300], yt: [0, 100, 200, 300, 400], xl: '控制气压力 kPa', yl: '药液出口压力 kPa', L: 46 });
    P.ln([[0, 0], [380, 380]], css('--ink3'), 1, [3, 4]);
    P.label(330, 345, '1 : 1', css('--ink3'), 'right');
    P.ln([[0, s.P1], [380, s.P1]], css('--no'), 1, [2, 3]);
    P.label(6, s.P1, `供液压力 ${s.P1}`, css('--no'), 'left', -9);
    const cols = ['--s3', '--s2', '--s1'];
    [20, s.open, 95].forEach((op, i) => {
      const pts = [];
      for (let a = 0; a <= 380; a += 5) pts.push([a, C.steadyPTFE(pD, s.P1, a, op / 100 * 0.6).P2]);
      P.ln(pts, css(cols[i]), i === 1 ? 2.6 : 1.6, i === 1 ? null : [5, 4]);
      const q = pts[Math.round(pts.length * (0.38 + 0.12 * i))];
      P.label(q[0], q[1], `下游开 ${op}%`, css(cols[i]), 'left', 12);
    });
    const r = C.steadyPTFE(pD, s.P1, 200, s.open / 100 * 0.6);
    set('l3_read2', rows([['控制气 200 kPa 时药液', `${f1(r.P2)} kPa`], ['药液流量', `${f1(r.Q)} L/min`]]));
  }
  bind('l3_p1', (v) => { s.P1 = v; draw(); }, (v) => `${v} kPa`);
  bind('l3_open', (v) => { s.open = v; draw(); }, (v) => `${v} %`);
  lazy(cvL, draw);
}

// ---------------- 背压阀：来气量 vs 上游压力（E 页） ----------------
export function setupBPR() {
  const s = { dome: 250 };
  const cv = document.getElementById('cvBpr');
  function draw() {
    const { c, w, h } = fit(cv);
    c.clearRect(0, 0, w, h);
    const P = plot(c, w, h, { x: [0, 600], y: [0, 600], xt: [0, 150, 300, 450, 600], yt: [0, 150, 300, 450, 600], xl: '上游来气量 NL/min', yl: '上游压力 kPa', L: 46 });
    const cols = ['--s3', '--s2', '--s1'];
    [s.dome - 100, s.dome, s.dome + 150].forEach((d, i) => {
      if (d < 20 || d > 560) return;
      const pts = [];
      for (let q = 0; q <= 600; q += q < 20 ? 1 : 10) pts.push([q, C.steadyBPR(d, q).P1g]);
      P.ln(pts, css(cols[i]), i === 1 ? 2.6 : 1.6, i === 1 ? null : [5, 4]);
      P.label(480, pts[pts.length - 12][1], `圆顶 ${d} kPa`, css(cols[i]), 'left', -10);
    });
    const r0 = C.steadyBPR(s.dome, 10), r1 = C.steadyBPR(s.dome, 400);
    set('l5_read', rows([['来气 10 NL/min', `${f1(r0.P1g)} kPa`], ['来气 400 NL/min', `${f1(r1.P1g)} kPa`], ['多来 390 NL/min 只涨', `${f1(r1.P1g - r0.P1g)} kPa`], ['膜片抬起', `${(r1.e * 1e3).toFixed(2)} mm`]]));
  }
  bind('l5_dome', (v) => { s.dome = v; draw(); }, (v) => `${v} kPa`);
  lazy(cv, draw);
}

// ---------------- 实验四：开环 vs 闭环 ----------------
const NOTES = {
  start: '三台阀都设定在 200 kPa。开环的那条线停在离设定差几 kPa 的地方：这是出厂标定 + 下垂 + 磁滞加起来的误差。两台闭环的压在设定线上。',
  set: '改设定：闭环的两台很快追上；开环的按标定走，但误差还在。往下调设定时，看一下压电式：它没有排气口，只能等下游把气用掉。',
  q: '下游用气量变了：开环的跟着掉（下垂），闭环的把它补回来，前提是阀的通径还够。',
  p1: '进口压力变了：开环的漂一点（进口压力效应），闭环的补回来。进口压力太低、接近设定时，谁都补不回来，闭环电气比例阀的说明书一般要求供气至少比设定高 0.1 MPa。',
  drift: '传感器零点漂了 +10 kPa：两台闭环都"以为"压力高了，于是把真实出口压到 190 kPa，显示却还是 200。开环的没有传感器，不受影响。闭环的精度上限就是传感器的精度。',
  driftOff: '传感器恢复正常，闭环的回到 200 kPa。',
  dead: '出口被堵死（下游阀全关）。现在把设定往下调试试：开环和闭环电气比例阀都带溢流，会从排气口放气降下来；压电式只能进不能出，压力就停在那里。',
  deadOff: '出口重新打开。',
  power: '断电。示意模型里：开环的电磁力消失，出口经溢流放到 0；闭环的两只电磁阀都关上，先导腔被封住，出口暂时保持；压电式（常开型）阀全开，出口冲向进口压力。真实产品各不相同，以说明书为准。',
  powerOn: '恢复供电。',
  limitOff: '关掉了压电式的"防冲过头"：积分一直累加。把设定从低往高跳一下，看它冲过头多少。',
  limitOn: '打开"防冲过头"：偏差大时积分放慢，输出饱和时积分停住。再跳一次设定对比。',
};
export function setupArena(focus = -1) {
  const A = C.makeArena(500);
  const env = A.env;
  for (const u of A.units) u.s.P2g = 0;
  const cv = document.getElementById('cvArena'), cvP = document.getElementById('cvPwm');
  const note = (k) => set('arenaNote', NOTES[k]);
  const toggle = (id, on) => document.getElementById(id).setAttribute('aria-pressed', on);
  bind('a_set', (v) => { env.setP = v; note('set'); }, (v) => `${v} kPa`);
  bind('a_p1', (v) => { env.P1g = v; note('p1'); }, (v) => `${v} kPa`);
  bind('a_q', (v) => { env.q = v; note('q'); }, (v) => `${v} NL/min`);
  const btn = (id, fn) => document.getElementById(id).addEventListener('click', fn);
  btn('bDrift', () => { env.sensorOffset = env.sensorOffset ? 0 : 10; toggle('bDrift', !!env.sensorOffset); note(env.sensorOffset ? 'drift' : 'driftOff'); });
  btn('bDead', () => { env.deadEnd = !env.deadEnd; toggle('bDead', env.deadEnd); note(env.deadEnd ? 'dead' : 'deadOff'); });
  btn('bPower', () => { env.power = !env.power; toggle('bPower', !env.power); note(env.power ? 'powerOn' : 'power'); });
  btn('bLimit', () => { const u = A.units[2]; u.c.limit = !u.c.limit; toggle('bLimit', !u.c.limit); note(u.c.limit ? 'limitOn' : 'limitOff'); });
  btn('bJump', () => {
    const v = env.setP < 250 ? 350 : 150;
    env.setP = v; document.getElementById('a_set').value = v; document.getElementById('a_set_o').textContent = `${v} kPa`; note('set');
  });
  btn('bReset', () => {
    Object.assign(env, { setP: 200, P1g: 700, q: 60, sensorOffset: 0, power: true, deadEnd: false });
    A.units[2].c.limit = true;
    for (const [id, v] of [['a_set', 200], ['a_p1', 700], ['a_q', 60]]) { document.getElementById(id).value = v; document.getElementById(id + '_o').textContent = `${v} ${id === 'a_q' ? 'NL/min' : 'kPa'}`; }
    ['bDrift', 'bDead', 'bPower', 'bLimit'].forEach((b) => toggle(b, false));
    note('start');
  });
  note('start');
  const NAMES = [['开环电气比例阀（F）', '--s1'], ['闭环电气比例阀（G）', '--s2'], ['压电数字式（H）', '--s3']];
  set('arenaLegend', `<span><i style="border-top:2px dashed var(--ink3);background:none"></i>设定</span>` + NAMES.map(([n, c], i) => `<span><i style="background:var(${c})"></i>${i === focus ? `<b>${n}（本页）</b>` : n}</span>`).join(''));
  function draw() {
    const hist = A.st.hist;
    if (!hist.length) return;
    const t1 = A.st.t, t0 = t1 - A.st.lim;
    const vmax = Math.max(500, ...hist.map((r) => Math.max(r[2], r[3], r[4]))) * 1.05;
    {
      const { c, w, h } = fit(cv);
      c.clearRect(0, 0, w, h);
      const yt = vmax > 600 ? [0, 200, 400, 600, 800] : [0, 100, 200, 300, 400, 500];
      const P = plot(c, w, h, { x: [t0, t1], y: [0, vmax], xt: [], yt, xl: '最近 12 秒', yl: '真实出口压力 kPa', L: 46, B: 26 });
      P.ln(hist.map((r) => [r[0], r[1]]), css('--ink3'), 1.2, [4, 4]);
      [2, 3, 4].forEach((k, i) => P.ln(hist.map((r) => [r[0], r[k]]), css(NAMES[i][1]), focus < 0 ? 2.2 : i === focus ? 3.2 : 1.4, focus < 0 || i === focus ? null : [5, 3]));
    }
    {
      const { c, w, h } = fit(cvP);
      c.clearRect(0, 0, w, h);
      const L = 46, R = 14, X = (t) => L + (t - t0) / (t1 - t0) * (w - L - R);
      c.font = '500 11px ' + css('--sans'); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillStyle = css('--ink3');
      c.fillText('充气阀', L - 6, h * 0.3); c.fillText('排气阀', L - 6, h * 0.75);
      const bar = (k, y, col) => {
        c.fillStyle = css(col);
        for (const r of hist) if (r[k] > 0.001) c.fillRect(X(r[0]), y - 7 * Math.min(1, r[k] * 4) , Math.max(1, (w - L - R) / 720), 14 * Math.min(1, r[k] * 4));
      };
      bar(5, h * 0.3, '--s2'); bar(6, h * 0.75, '--s1');
    }
    const last = hist[hist.length - 1];
    const cl = A.units[1].s;
    set('arenaRead', [['开环 误差', `${f1(last[2] - env.setP)} kPa`], ['闭环 误差', `${f1(last[3] - env.setP)} kPa`], ['压电 误差', `${f1(last[4] - env.setP)} kPa`], ['闭环 显示值', `${f1(cl.sensor)} kPa`]]
      .map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join(''));
  }
  const vis = whenVisible(cv);
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!vis()) return;
    A.step(dt);
    draw();
  }
  requestAnimationFrame(frame);
}
