// 二维原理实验：每种流量计一块画布 + 一组旋钮 + 读数。物理都来自 physics.js。
import * as P from './physics.js';

const C = { bg: '#10171B', panel: '#16222A', grid: '#26343D', ink: '#DCE7EB', dim: '#8C9BA5', faint: '#4A5A64',
  blue: '#5BB8FF', orange: '#FFB04A', cyan: '#55E0FF', green: '#6BE39A', red: '#FF6B6B', purple: '#C79BFF', yellow: '#FFD45C', wall: '#C9D1D6', pfa: '#E7E8E0' };
const FONT = '"Noto Sans SC","PingFang SC","Microsoft YaHei","Hiragino Sans GB",system-ui,sans-serif';
const MONO = '"JetBrains Mono",ui-monospace,Consolas,monospace';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const fx = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : '—');
const pct = (m, t) => (t > 1e-12 ? `${(m / t - 1) * 100 >= 0 ? '+' : ''}${fx((m / t - 1) * 100, 1)} %` : '—');

// ---------- 画图小工具 ----------
function T(g, s, x, y, o = {}) {
  g.font = `${o.bold ? 700 : 500} ${o.size || 12}px ${o.mono ? MONO : FONT}`;
  g.fillStyle = o.c || C.ink;
  g.textAlign = o.align || 'left';
  g.textBaseline = o.base || 'alphabetic';
  g.fillText(s, x, y);
}
function L(g, pts, c, w = 1.5, dash = null) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = c; g.lineWidth = w; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]);
}
function R(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
function circ(g, x, y, r, c, stroke = false, w = 1.5) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  if (stroke) { g.strokeStyle = c; g.lineWidth = w; g.stroke(); } else { g.fillStyle = c; g.fill(); }
}
function arrow(g, x0, y0, x1, y1, c, w = 2, head = 7) {
  L(g, [[x0, y0], [x1, y1]], c, w);
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.beginPath(); g.moveTo(x1, y1);
  g.lineTo(x1 - head * Math.cos(a - 0.45), y1 - head * Math.sin(a - 0.45));
  g.lineTo(x1 - head * Math.cos(a + 0.45), y1 - head * Math.sin(a + 0.45));
  g.closePath(); g.fillStyle = c; g.fill();
}
/** 坐标框：返回把数据坐标换成像素的函数。 */
function frame(g, box, o) {
  const { x, y, w, h } = box;
  R(g, x, y, w, h, C.panel);
  const X = (v) => x + (v - o.x0) / (o.x1 - o.x0) * w;
  const Y = (v) => y + h - (v - o.y0) / (o.y1 - o.y0) * h;
  g.lineWidth = 1;
  for (const t of o.xt || []) { L(g, [[X(t), y], [X(t), y + h]], C.grid, 1); T(g, o.xf ? o.xf(t) : String(t), X(t), y + h + 13, { c: C.dim, size: 10.5, align: 'center', mono: true }); }
  for (const t of o.yt || []) { L(g, [[x, Y(t)], [x + w, Y(t)]], C.grid, 1); T(g, o.yf ? o.yf(t) : String(t), x - 5, Y(t) + 3.5, { c: C.dim, size: 10.5, align: 'right', mono: true }); }
  if (o.xl) T(g, o.xl, x + w, y + h + 27, { c: C.dim, size: 11, align: 'right' });
  if (o.yl) T(g, o.yl, x + 2, y - 6, { c: C.dim, size: 11 });
  return { X, Y };
}
function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

// ---------- 共用的液体选项 ----------
const FLUID_OPTS = (keys) => keys.map((k) => [k, P.FLUIDS[k].name]);

// ======================================================================
// 0. 管流：流速、雷诺数、流速分布（放在"测流量在测什么"那一节）
// ======================================================================
export const PIPE_LAB = {
  id: 'pipe',
  controls: [
    { k: 'Q', type: 'range', label: '流量', min: -1.3, max: 1.4, step: 0.01, val: 0, log: true, unit: 'L/min' },
    { k: 'D', type: 'seg', label: '管内径', opts: [['4', '4 mm'], ['8', '8 mm'], ['16', '16 mm'], ['22', '22 mm']], val: '8' },
    { k: 'fl', type: 'seg', label: '液体', opts: [['w25', 'DIW 25 °C'], ['w80', 'DIW 80 °C'], ['ipa', 'IPA'], ['h2so4', '浓硫酸']], val: 'w25' },
  ],
  calc(s) {
    const f = s.fl === 'w25' ? P.fluid('diw', 25) : s.fl === 'w80' ? P.fluid('diw', 80) : P.fluid(s.fl);
    const D = +s.D / 1000;
    const Q = 10 ** s.Q * P.LPM;
    return { f, D, Q, ...P.pipeFlow(Q, D, f), k: P.lineFactor(P.pipeFlow(Q, D, f).Re) };
  },
  draw(g, W, H, s, r) {
    const top = 26, pipeH = Math.min(150, H * 0.45);
    const x0 = 46, x1 = W - 20, cy = top + pipeH / 2 + 10;
    R(g, x0, cy - pipeH / 2 - 8, x1 - x0, 8, C.wall); R(g, x0, cy + pipeH / 2, x1 - x0, 8, C.wall);
    const col = r.regime === 'laminar' ? C.blue : r.regime === 'turbulent' ? C.orange : C.yellow;
    // 流速分布：箭头 + 包络线
    const umax = Math.max(...Array.from({ length: 41 }, (_, i) => P.profile(Math.abs(i / 20 - 1), r.Re)));
    const scale = (x1 - x0) * 0.42 / umax;
    const xb = x0 + 30;
    const env = [];
    for (let i = 0; i <= 40; i++) {
      const rr = i / 20 - 1;
      const u = P.profile(Math.abs(rr), r.Re) * scale;
      env.push([xb + u, cy + rr * pipeH / 2]);
      if (i % 4 === 0 && i > 0 && i < 40) arrow(g, xb, cy + rr * pipeH / 2, xb + u, cy + rr * pipeH / 2, col + 'AA', 1.6, 6);
    }
    L(g, [[xb, cy - pipeH / 2], [xb, cy + pipeH / 2]], C.faint, 1);
    L(g, env, col, 2.2);
    // 面平均流速
    L(g, [[xb + scale, cy - pipeH / 2], [xb + scale, cy + pipeH / 2]], C.green, 1.4, [5, 4]);
    T(g, '面平均流速', xb + scale + 6, cy - pipeH / 2 + 14, { c: C.green, size: 11.5 });
    // 流动的粒子
    const rnd = rng(7);
    for (let i = 0; i < 70; i++) {
      const rr = rnd() * 2 - 1;
      const u = P.profile(Math.abs(rr), r.Re);
      const span = x1 - xb - 30;
      const x = xb + 30 + ((rnd() * span + s.t * u * 60 * clamp(r.v, 0.05, 1.5)) % span);
      circ(g, x, cy + rr * pipeH / 2 * 0.96, 2, col + 'CC');
    }
    T(g, r.regime === 'laminar' ? '层流：中间快、壁上慢，抛物线' : r.regime === 'turbulent' ? '湍流：整体比较平，靠壁一薄层才慢下来' : '过渡区：一会儿层流一会儿湍流', x0, top + 2, { c: col, size: 13, bold: true });
    // 雷诺数刻度条
    const by = cy + pipeH / 2 + 46, bw = x1 - x0;
    const LX = (Re) => x0 + (Math.log10(clamp(Re, 10, 1e5)) - 1) / 4 * bw;
    R(g, x0, by, LX(2300) - x0, 12, C.blue + '66'); R(g, LX(2300), by, LX(4000) - LX(2300), 12, C.yellow + '66'); R(g, LX(4000), by, x1 - LX(4000), 12, C.orange + '66');
    for (const t of [10, 100, 1000, 1e4, 1e5]) T(g, t >= 1e4 ? `${t / 1000}k` : String(t), LX(t), by + 26, { c: C.dim, size: 10.5, align: 'center', mono: true });
    T(g, '层流', (x0 + LX(2300)) / 2, by - 5, { c: C.blue, size: 11, align: 'center' });
    T(g, '湍流', (LX(4000) + x1) / 2, by - 5, { c: C.orange, size: 11, align: 'center' });
    const mx = LX(r.Re);
    g.beginPath(); g.moveTo(mx, by - 2); g.lineTo(mx - 6, by - 11); g.lineTo(mx + 6, by - 11); g.closePath(); g.fillStyle = C.ink; g.fill();
    T(g, '雷诺数 Re', x0, by + 42, { c: C.dim, size: 11 });
  },
  read(s, r) {
    return [['平均流速', `${fx(r.v, 3)} m/s`], ['流量', `${fx(r.Q / P.LPM, r.Q / P.LPM < 1 ? 3 : 2)} L/min`], ['雷诺数 Re', fx(r.Re, 0)],
      ['沿直径平均 ÷ 面平均', fx(r.k, 3)]];
  },
  note(s, r) {
    return `Re = ρvD/μ，表示惯性力和黏性力谁占上风。小于约 2300 是层流，大于约 4000 是湍流。本页 8 mm 的管子 1 L/min 时 Re 约 ${fx(P.pipeFlow(P.LPM, 0.008, P.fluid('diw', 25)).Re, 0)}，刚好落在中间。所以半导体细管里的流量计，常常正好工作在最难估分布的那一段。`;
  },
};

// ======================================================================
// 1. 超声波
// ======================================================================
const US = {
  id: 'us', tab: '超声波',
  controls: [
    { k: 'mode', type: 'seg', label: '形式', opts: [['in', '管内式'], ['clamp', '夹装式']], val: 'in' },
    { k: 'Q', type: 'range', label: '流量', min: 0, max: 6, step: 0.05, val: 1, unit: 'L/min' },
    { k: 'fl', type: 'select', label: '液体', opts: FLUID_OPTS(['diw', 'dhf', 'ipa', 'h2so4']), val: 'diw' },
    { k: 'T', type: 'range', label: '水温（只对 DIW）', min: 10, max: 80, step: 1, val: 25, unit: '°C', fmt: (v) => v.toFixed(0) },
    { k: 'bub', type: 'range', label: '气泡', min: 0, max: 0.5, step: 0.01, val: 0, unit: '', fmt: (v) => `${(v * 200).toFixed(0)} %` },
    { k: 'algo', type: 'seg', label: '算法（管内式）', opts: [['A', '(L/2)(1/t↓−1/t↑)'], ['B', 'Δt·c²/2L，c 按 25 °C']], val: 'A', when: (s) => s.mode === 'in' },
    { k: 'autoC', type: 'check', label: '仪表实时测声速（夹装式）', val: false, when: (s) => s.mode === 'clamp' },
  ],
  calc(s) {
    const f = P.fluid(s.fl, s.T);
    const Q = s.Q * P.LPM;
    if (s.mode === 'in') {
      const r = P.usInline({ Q, f, bubbles: s.bub });
      return { f, Q, r, Qm: s.algo === 'A' ? r.QA : r.QB, lost: r.lost, amp: r.amp, dt: r.dt, freq: 2e6, win: 0.3e-6 };
    }
    const r = P.usClamp({ Q, f, bubbles: s.bub, autoC: s.autoC });
    return { f, Q, r, Qm: r.Qm, lost: r.lost, amp: r.amp, dt: r.dt, freq: 4e6, win: 0.06e-6 };
  },
  draw(g, W, H, s, z) {
    const top = 14, sh = H * 0.46;
    const x0 = 60, x1 = W - 60, cy = top + sh * 0.55, rh = Math.min(28, sh * 0.2);
    const k = clamp(s.Q / 6, 0, 1) * 0.45;
    const per = 1.8, ph = (s.t % per) / per;
    if (s.mode === 'in') {
      // 曲柄形流道
      R(g, x0 - 40, cy + 40 - rh, 40, rh * 2, C.pfa + '33'); R(g, x1, cy + 40 - rh, 40, rh * 2, C.pfa + '33');
      R(g, x0, cy - rh, x1 - x0, rh * 2, '#1E3A4A');
      L(g, [[x0, cy - rh], [x1, cy - rh]], C.wall, 2); L(g, [[x0 + 2 * rh, cy + rh], [x1 - 2 * rh, cy + rh]], C.wall, 2);
      R(g, x0 - 16, cy - rh - 4, 14, rh * 2 + 8, '#9A8F7A'); R(g, x1 + 2, cy - rh - 4, 14, rh * 2 + 8, '#9A8F7A');
      T(g, '换能器 A', x0 - 9, cy - rh - 10, { c: C.orange, size: 11, align: 'center' });
      T(g, '换能器 B', x1 + 9, cy - rh - 10, { c: C.cyan, size: 11, align: 'center' });
      // 粒子
      const rnd = rng(3);
      for (let i = 0; i < 46; i++) {
        const yy = (rnd() * 2 - 1) * rh * 0.85;
        const u = 1.5 * (1 - (yy / rh) ** 2);
        const x = x0 + ((rnd() * (x1 - x0) + s.t * u * s.Q * 18) % (x1 - x0));
        circ(g, x, cy + yy, 2, C.blue + 'BB');
      }
      const L0 = x1 - x0;
      const qd = ph / 0.75 * (1 + k), qu = ph / 0.75 * (1 - k);
      const drawP = (x, dir, c) => { for (let j = 0; j < 3; j++) { g.beginPath(); g.arc(x - dir * j * 7, cy, rh * 0.9, dir > 0 ? -0.9 : Math.PI - 0.9, dir > 0 ? 0.9 : Math.PI + 0.9); g.strokeStyle = c; g.globalAlpha = 1 - j * 0.3; g.lineWidth = 2.5; g.stroke(); } g.globalAlpha = 1; };
      if (qd < 1 && !z.lost) drawP(x0 + L0 * qd, 1, C.orange);
      if (qu < 1 && !z.lost) drawP(x1 - L0 * qu, -1, C.cyan);
      T(g, '顺流（橙）先到，逆流（青）后到；动画里把差别放大了', W / 2, cy + rh + 58, { c: C.dim, size: 11.5, align: 'center' });
      arrow(g, x0 - 34, cy + 40, x0 - 6, cy + 40, C.blue, 2);
    } else {
      R(g, x0 - 20, cy - rh, x1 - x0 + 40, rh * 2, '#1E3A4A');
      L(g, [[x0 - 20, cy - rh], [x1 + 20, cy - rh]], C.wall, 3); L(g, [[x0 - 20, cy + rh], [x1 + 20, cy + rh]], C.wall, 3);
      const xa = W / 2 - rh * 1.3, xb = W / 2 + rh * 1.3, xm = W / 2;
      g.fillStyle = '#C99B4F';
      g.beginPath(); g.moveTo(xa - 70, cy - rh - 2); g.lineTo(xa + 4, cy - rh - 2); g.lineTo(xa - 30, cy - rh - 52); g.lineTo(xa - 70, cy - rh - 52); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(xb + 70, cy - rh - 2); g.lineTo(xb - 4, cy - rh - 2); g.lineTo(xb + 30, cy - rh - 52); g.lineTo(xb + 70, cy - rh - 52); g.closePath(); g.fill();
      T(g, '楔块', xa - 48, cy - rh - 30, { c: '#241600', size: 11, align: 'center', bold: true });
      T(g, '楔块', xb + 48, cy - rh - 30, { c: '#241600', size: 11, align: 'center', bold: true });
      const P1 = [xa, cy - rh], P2 = [xm, cy + rh], P3 = [xb, cy - rh];
      L(g, [[xa - 30, cy - rh - 46], P1, P2, P3, [xb + 30, cy - rh - 46]], C.cyan + '88', 1.4, [5, 4]);
      const rnd = rng(3);
      for (let i = 0; i < 46; i++) {
        const yy = (rnd() * 2 - 1) * rh * 0.85;
        const x = x0 - 20 + ((rnd() * (x1 - x0 + 40) + s.t * 1.5 * (1 - (yy / rh) ** 2) * s.Q * 18) % (x1 - x0 + 40));
        circ(g, x, cy + yy, 2, C.blue + 'BB');
      }
      const along = (q, rev) => {
        const pts = rev ? [P3, P2, P1] : [P1, P2, P3];
        const t2 = clamp(q, 0, 1) * 2, i = t2 < 1 ? 0 : 1;
        return [lerp(pts[i][0], pts[i + 1][0], t2 - i), lerp(pts[i][1], pts[i + 1][1], t2 - i)];
      };
      const qd = ph / 0.75 * (1 + k), qu = ph / 0.75 * (1 - k);
      if (qd < 1 && !z.lost) { const [x, y] = along(qd, false); circ(g, x, y, 6, C.orange); }
      if (qu < 1 && !z.lost) { const [x, y] = along(qu, true); circ(g, x, y, 6, C.cyan); }
      T(g, `声束在液体里的角度 ${fx(z.r.th * 180 / Math.PI, 1)}°（随声速变）`, W / 2, cy + rh + 30, { c: C.dim, size: 11.5, align: 'center' });
    }
    // 接收波形
    const box = { x: 54, y: H * 0.6, w: W - 74, h: H * 0.3 };
    const tc = (s.mode === 'in' ? z.r.tDown + z.r.tUp : z.r.tDown + z.r.tUp) / 2;
    const half = z.win;
    const { X, Y } = frame(g, box, { x0: -half * 1e9, x1: half * 1e9, y0: -1.1, y1: 1.1, xt: [-half * 1e9, 0, half * 1e9].map((v) => Math.round(v)), xf: (v) => `${v > 0 ? '+' : ''}${v}`, xl: '相对平均到达时刻（ns）', yl: '收到的波形（只放大看一个周期左右）' });
    const tau = 1.6 / z.freq;
    const rnd = rng(Math.floor(s.t * 6) + 1);
    for (const [t0, c] of [[z.r.tDown - tc, C.orange], [z.r.tUp - tc, C.cyan]]) {
      const pts = [];
      for (let i = 0; i <= 300; i++) {
        const tt = -half + 2 * half * i / 300;
        const env = Math.exp(-(((tt - t0) / tau) ** 2));
        const v = z.lost ? (rnd() - 0.5) * 0.3 : z.amp * env * Math.sin(2 * Math.PI * z.freq * (tt - t0) + Math.PI / 2) + (rnd() - 0.5) * 0.12 * (s.bub > 0 ? 1 : 0.2);
        pts.push([X(tt * 1e9), Y(clamp(v, -1.05, 1.05))]);
      }
      L(g, pts, c, 1.8);
      if (!z.lost) L(g, [[X(t0 * 1e9), box.y], [X(t0 * 1e9), box.y + box.h]], c + '99', 1, [3, 3]);
    }
    if (z.lost) T(g, '信号太弱，仪表报错', box.x + box.w / 2, box.y + box.h / 2, { c: C.red, size: 14, bold: true, align: 'center' });
    else if (z.dt > 0) {
      const xa = X((z.r.tDown - tc) * 1e9), xb = X((z.r.tUp - tc) * 1e9), yy = box.y + 12;
      L(g, [[xa, yy], [xb, yy]], C.yellow, 1.5);
      T(g, `Δt = ${fx(z.dt * 1e9, 2)} ns`, Math.max(xa, xb) + 6, yy + 4, { c: C.yellow, size: 11.5, mono: true });
    }
  },
  read(s, z) {
    const out = [['平均流速', `${fx(z.r.v, 3)} m/s`]];
    if (s.mode === 'in') out.push(['顺流传播时间', `${fx(z.r.tDown * 1e6, 3)} µs`]);
    else out.push(['雷诺数', `${fx(z.r.Re, 0)}`]);
    out.push(['逆流比顺流慢', `${fx(z.dt * 1e9, 2)} ns`], ['仪表读数', z.lost ? '报错' : `${fx(z.Qm / P.LPM, 3)} L/min`, 'hl'], ['误差', z.lost ? '—' : pct(z.Qm, z.Q), Math.abs(z.Qm / z.Q - 1) > 0.02 && !z.lost ? 'bad' : 'good']);
    return out;
  },
  note(s, z) {
    if (z.lost) return '气泡把声波散射掉了，接收幅度低于门限。真实产品会报"信号弱"，这就是为什么超声波流量计前后要避免产生和积存气泡。';
    if (s.mode === 'in') {
      if (s.algo === 'B' && Math.abs(z.f.c - 1497) > 3) return `液体实际声速是 ${fx(z.f.c, 0)} m/s，算法却按 1497 m/s 算，误差约等于两者之比的平方。换成上面那个算法，声速会约掉，误差回到 0。`;
      return '管内式里声音沿管轴走完整条测量管，两个方向的时间都量出来，声速就能从公式里约掉。剩下的误差主要来自计时电路，本页没有模拟。';
    }
    if (!s.autoC && Math.abs(z.f.c - 1497) > 3) return `液体声速 ${fx(z.f.c, 0)} m/s，仪表按 1497 m/s 算折射角，读数随之偏。打开"实时测声速"可以消掉这一项，剩下的是流速分布估得准不准。`;
    return `夹装式测到的是沿声束的平均流速，要除以分布系数才是面平均。雷诺数 ${fx(z.r.Re, 0)}：${z.r.Re < 2300 ? '层流，系数约 1.33' : z.r.Re < 4000 ? '过渡区，系数最难估' : '湍流，系数约 1.05–1.1'}。`;
  },
};

// ======================================================================
// 2. 卡门涡街
// ======================================================================
const VOR = {
  id: 'vor', tab: '卡门涡街',
  controls: [
    { k: 'Q', type: 'range', label: '流量', min: 0, max: 20, step: 0.1, val: 6, unit: 'L/min' },
    { k: 'fl', type: 'select', label: '液体', opts: FLUID_OPTS(['diw', 'ipa', 'h2so4']), val: 'diw' },
    { k: 'vib', type: 'range', label: '管道振动（50 Hz）', min: 0, max: 20, step: 0.5, val: 0, unit: 'Pa' },
  ],
  calc(s) {
    const f = P.fluid(s.fl);
    const m = P.vortexMeter({ Q: s.Q * P.LPM, f, vibAmp: s.vib, vibF: 50 });
    return { f, m };
  },
  init(s) { s.vx = []; s.clock = 0; s.side = 1; },
  step(s, dt, z) {
    const m = z.m;
    const fvis = m.Red > 50 && m.regular > 0 ? clamp(m.fv / 20, 0.3, 3.5) : 0;
    s.clock += dt * fvis * 2;
    while (s.clock > 1) { s.clock -= 1; s.side = -s.side; s.vx.push({ x: 0, y: s.side * 0.35, age: 0, side: s.side, j: (Math.random() - 0.5) * (1 - m.regular) }); }
    const v = clamp(m.v, 0, 2.5) * 0.23 + 0.04;
    s.vx.forEach((q) => { q.age += dt; q.x += v * dt; q.y += (q.side * 0.22 + q.j - q.y) * dt * 1.5; });
    s.vx = s.vx.filter((q) => q.x < 1.05);
  },
  draw(g, W, H, s, z) {
    const top = 18, ch = H * 0.48, x0 = 30, x1 = W - 20, cy = top + ch / 2, hh = ch / 2 - 6;
    R(g, x0, cy - hh, x1 - x0, hh * 2, '#1E3A4A');
    L(g, [[x0, cy - hh], [x1, cy - hh]], C.wall, 3); L(g, [[x0, cy + hh], [x1, cy + hh]], C.wall, 3);
    const xb = x0 + (x1 - x0) * 0.2, d = hh * 0.56;
    g.fillStyle = '#E7DCBE';
    g.beginPath(); g.moveTo(xb - 10, cy - d / 2); g.lineTo(xb + 14, cy - d / 4.6); g.lineTo(xb + 14, cy + d / 4.6); g.lineTo(xb - 10, cy + d / 2); g.closePath(); g.fill();
    T(g, '发生体', xb + 2, cy + d / 2 + 16, { c: C.dim, size: 11, align: 'center' });
    const xp = x0 + (x1 - x0) * 0.45;
    R(g, xp - 5, cy - hh - 22, 10, 30, '#F5F5F1');
    T(g, '探头', xp, cy - hh - 27, { c: C.orange, size: 11, align: 'center' });
    const span = x1 - xb - 16;
    const rnd = rng(11);
    for (let i = 0; i < 50; i++) {
      const yy = (rnd() * 2 - 1) * hh * 0.9;
      const x = x0 + ((rnd() * (x1 - x0) + s.t * clamp(z.m.v, 0, 2.5) * 70) % (x1 - x0));
      circ(g, x, cy + yy, 1.8, C.blue + '99');
    }
    let hit = 0;
    for (const q of s.vx) {
      const x = xb + 16 + q.x * span, y = cy + q.y * hh;
      const rr = 7 + Math.min(16, q.age * 9);
      g.save(); g.translate(x, y); g.rotate(-q.side * q.age * 6);
      g.beginPath();
      for (let a = 0; a < 3.6 * Math.PI; a += 0.2) { const r2 = rr * a / (3.6 * Math.PI); g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); }
      g.strokeStyle = q.side > 0 ? C.cyan : C.purple; g.globalAlpha = clamp(1.3 - q.x, 0, 1); g.lineWidth = 2; g.stroke(); g.restore(); g.globalAlpha = 1;
      if (q.side < 0 && Math.abs(x - xp) < 10) hit = 1;
    }
    if (hit) circ(g, xp, cy - hh - 6, 9, C.orange + '88');
    if (!(z.m.Red > 50) || z.m.regular <= 0) T(g, s.Q > 0 ? '流太慢：尾流里还没形成稳定的涡街' : '没有流动', W / 2, cy + 5, { c: C.yellow, size: 13, align: 'center', bold: true });
    // 探头信号
    const box = { x: 54, y: H * 0.62, w: W - 74, h: H * 0.28 };
    const sig = z.m.sig, fs = z.m.fs, n = Math.round(0.25 * fs), off = sig.length - n;
    const amax = Math.max(15, ...Array.from({ length: 60 }, (_, i) => Math.abs(sig[off + Math.floor(i * n / 60)])));
    const { X, Y } = frame(g, box, { x0: 0, x1: 250, y0: -amax * 1.1, y1: amax * 1.1, xt: [0, 50, 100, 150, 200, 250], xl: '时间（ms）', yl: '探头感受到的压力脉动（Pa）', yt: [-6, 6], yf: (v) => (v > 0 ? '+门限' : '−门限') });
    const pts = [];
    for (let i = 0; i < n; i += 2) pts.push([X(i / fs * 1000), Y(sig[off + i])]);
    L(g, pts, C.orange, 1.3);
  },
  read(s, z) {
    const m = z.m;
    return [['雷诺数', fx(m.ReD, 0)], ['涡街频率（理论）', m.Red > 50 ? `${fx(m.fv, 1)} Hz` : '—'], ['仪表数到的频率', `${fx(m.fm, 1)} Hz`],
      ['仪表读数', `${fx(m.Qm / P.LPM, 2)} L/min`, 'hl'], ['误差', s.Q > 0 ? pct(m.Qm, s.Q * P.LPM) : m.Qm > 0.05 * P.LPM ? '凭空有流量' : '—', (s.Q > 0 && Math.abs(m.Qm / (s.Q * P.LPM) - 1) > 0.03) || (s.Q === 0 && m.Qm > 0.05 * P.LPM) ? 'bad' : 'good']];
  },
  note(s, z) {
    const m = z.m;
    if (s.Q === 0 && m.Qm > 0) return '管里根本没流，振动的压力过了门限，仪表就把振动当成旋涡数进去了。真实产品会设"小流量切除"，并在机械上隔振。';
    if (m.Red > 50 && m.regular < 1 && s.Q > 0) return `雷诺数只有 ${fx(m.ReD, 0)}，涡街断断续续，频率不稳，读数会跳甚至归零。样本上每一档的最小流量就是这么来的。`;
    if (s.fl === 'h2so4') return '浓硫酸黏度约 22 mPa·s，是水的 20 多倍，同样流量下雷诺数低得多。涡街流量计样本一般限定黏度在 3 mPa·s 以下。';
    return `f = St·v/d，St 约 0.2。仪表只是在数过门限的脉冲：频率 ${fx(m.fv, 1)} Hz，除以出厂标定的 K 系数就是流量。`;
  },
};

// ======================================================================
// 3. 叶轮
// ======================================================================
const PAD = {
  id: 'pad', tab: '叶轮',
  controls: [
    { k: 'Q', type: 'range', label: '流量', min: 0, max: 4, step: 0.02, val: 1.5, unit: 'L/min' },
    { k: 'wear', type: 'range', label: '轴承磨损', min: 0, max: 1, step: 0.01, val: 0, fmt: (v) => `${(v * 100).toFixed(0)} %` },
    { k: 'gvf', type: 'range', label: '气泡（体积比）', min: 0, max: 0.3, step: 0.01, val: 0, fmt: (v) => `${(v * 100).toFixed(0)} %` },
  ],
  calc(s) { return { r: P.paddle({ Q: s.Q * P.LPM, wear: s.wear, gvf: s.gvf, f: P.FLUIDS.diw }) }; },
  init(s) { s.ang = 0; s.particles = 0; s.pulses = []; s.lastHit = 0; },
  step(s, dt, z) {
    const r = z.r;
    const prev = s.ang;
    s.ang += r.rps * 2 * Math.PI * dt * 0.5;
    const k0 = Math.floor(prev / Math.PI), k1 = Math.floor(s.ang / Math.PI);
    if (k1 > k0) s.pulses.push(s.t);
    s.pulses = s.pulses.filter((t) => s.t - t < 2.2);
    s.particles += r.rps * dt * (0.02 + 2.5 * s.wear * s.wear);
  },
  draw(g, W, H, s, z) {
    const narrow = W < 560;
    const cx = narrow ? W * 0.5 : W * 0.28, cy = H * 0.3, R0 = Math.min(H * 0.22, narrow ? W * 0.28 : W * 0.2);
    circ(g, cx, cy, R0 + 10, C.pfa + '22'); circ(g, cx, cy, R0 + 4, '#1E3A4A');
    const jy = cy + R0 * 0.72;
    R(g, cx - R0 * 2.2, jy - 9, R0 * 1.5, 18, '#1E3A4A'); R(g, cx + R0 * 0.7, jy - 9, R0 * 1.5, 18, '#1E3A4A');
    arrow(g, cx - R0 * 2.1, jy, cx - R0 * 0.8, jy, C.blue, 3, 9);
    for (let i = 0; i < 6; i++) {
      const a = s.ang + i * Math.PI / 3;
      L(g, [[cx + Math.cos(a) * R0 * 0.2, cy + Math.sin(a) * R0 * 0.2], [cx + Math.cos(a) * R0, cy + Math.sin(a) * R0]], '#E7DCBE', 5);
      if (i === 0 || i === 3) circ(g, cx + Math.cos(a) * R0 * 0.72, cy + Math.sin(a) * R0 * 0.72, 5.5, i === 0 ? C.red : C.blue);
    }
    circ(g, cx, cy, R0 * 0.22, '#E7DCBE');
    const hit = s.pulses.length && s.t - s.pulses[s.pulses.length - 1] < 0.08;
    R(g, cx - 8, cy - R0 - 26, 16, 10, hit ? C.red : '#2A3238');
    T(g, '霍尔元件', cx + 14, cy - R0 - 17, { c: C.dim, size: 11 });
    if (s.gvf > 0) { const rnd = rng(5); for (let i = 0; i < 30 * s.gvf * 10; i++) circ(g, cx - R0 * 2 + rnd() * R0 * 3, jy + (rnd() - 0.5) * 14, 2.5, '#FFFFFF88'); }
    // 脉冲串
    const pb = narrow ? { x: 54, y: H * 0.6, w: W - 74, h: H * 0.12 } : { x: 54, y: H * 0.66, w: W * 0.5 - 70, h: H * 0.2 };
    const pf = frame(g, pb, { x0: -2, x1: 0, y0: 0, y1: 1.3, xt: [-2, -1, 0], xl: '最近 2 秒（放慢一半）', yl: '霍尔脉冲' });
    s.pulses.forEach((t) => { const x = pf.X(t - s.t); L(g, [[x, pf.Y(0)], [x, pf.Y(1)], [x + 4, pf.Y(1)], [x + 4, pf.Y(0)]], C.red, 1.6); });
    // 读数–真实流量曲线
    const cb = narrow ? { x: 54, y: H * 0.8, w: W - 74, h: H * 0.13 } : { x: W * 0.58, y: 28, w: W * 0.4 - 12, h: H * 0.8 };
    const { X, Y } = frame(g, cb, { x0: 0, x1: 4, y0: 0, y1: 4.4, xt: [0, 1, 2, 3, 4], yt: narrow ? [0, 4] : [0, 1, 2, 3, 4], xl: '真实流量 L/min', yl: narrow ? '' : '仪表读数 L/min' });
    L(g, [[X(0), Y(0)], [X(4), Y(4)]], C.faint, 1.2, [4, 4]);
    const pts = [];
    for (let i = 0; i <= 80; i++) { const q = i / 20; pts.push([X(q), Y(P.paddle({ Q: q * P.LPM, wear: s.wear, gvf: s.gvf }).Qm / P.LPM)]); }
    L(g, pts, C.orange, 2);
    circ(g, X(s.Q), Y(z.r.Qm / P.LPM), 5, C.yellow);
  },
  read(s, z) {
    const r = z.r;
    return [['射流速度', `${fx(r.vj, 2)} m/s`], ['叶轮转速', r.stalled ? '不转' : `${fx(r.rpm, 0)} rpm`], ['脉冲频率', `${fx(r.hz, 1)} Hz`],
      ['仪表读数', `${fx(r.Qm / P.LPM, 2)} L/min`, 'hl'], ['误差', s.Q > 0 ? pct(r.Qm, s.Q * P.LPM) : '—', s.Q > 0 && Math.abs(r.Qm / (s.Q * P.LPM) - 1) > 0.05 ? 'bad' : 'good'],
      ['累计磨出的颗粒（示意）', fx(s.particles, 0), s.wear > 0.3 ? 'bad' : '']];
  },
  note(s, z) {
    if (z.r.stalled && s.Q > 0) return `射流速度 ${fx(z.r.vj, 2)} m/s 还推不动叶轮（门槛约 ${fx(z.r.vth, 2)} m/s）。这一段就是叶轮式的"死区"。`;
    if (s.wear > 0.3) return '轴承磨损后摩擦变大，起转门槛变高，整条曲线往下沉。磨下来的颗粒会跟着液体走，所以半导体用的要用蓝宝石轴和轴承。';
    if (s.gvf > 0.05) return '气泡带不了多少动量，射流推叶片的力变小，叶轮转慢了，读数偏低。光电检测的还会被气泡反光干扰。';
    return '仪表假设"脉冲频率 ∝ 流量"，用一个 K 系数换算。实际曲线在小流量处往下弯，是因为要先克服轴承摩擦。';
  },
};

// ======================================================================
// 4. 浮子
// ======================================================================
const FLT = {
  id: 'flt', tab: '浮子',
  controls: [
    { k: 'Q', type: 'range', label: '流量', min: 0, max: 3.5, step: 0.02, val: 1.5, unit: 'L/min' },
    { k: 'fl', type: 'select', label: '液体（刻度按 20 °C 水刻）', opts: FLUID_OPTS(['diw', 'dhf', 'ipa', 'h2so4']), val: 'diw' },
    { k: 'pulse', type: 'check', label: '泵有脉动', val: false },
    { k: 'bub', type: 'check', label: '浮子上挂了一个气泡', val: false },
  ],
  setGeo(geo) { this.geo = geo; this.scale = P.floatScale(geo); },
  calc(s) {
    const f = P.fluid(s.fl, 20);
    const r = P.floatMeter({ Q: s.Q * P.LPM, f, geo: this.geo, bubble: s.bub ? 0.03 : 0 });
    return { f, r, read: this.scale(r.z) };
  },
  init(s) { s.z = null; },
  step(s, dt, z) {
    let target = z.r.z;
    if (s.pulse && s.Q > 0) {
      const q = s.Q * (1 + 0.35 * Math.sin(s.t * 2 * Math.PI * 1.2));
      target = P.floatMeter({ Q: q * P.LPM, f: z.f, geo: this.geo, bubble: s.bub ? 0.03 : 0 }).z;
    }
    s.z = s.z == null ? target : s.z + (target - s.z) * Math.min(1, dt * 4);
  },
  draw(g, W, H, s, z) {
    const G = this.geo;
    const cx = W * 0.4, ty = 24, by = H - 30;
    const Z = (zz) => by - (zz - G.z0) / (G.z1 - G.z0) * (by - ty);
    const sc = (by - ty) / (G.z1 - G.z0) * 0.9;
    const Rr = (zz) => (G.r0 + (G.r1 - G.r0) * (zz - G.z0) / (G.z1 - G.z0)) * sc;
    g.fillStyle = '#1E3A4A';
    g.beginPath(); g.moveTo(cx - Rr(G.z0), by); g.lineTo(cx - Rr(G.z1), ty); g.lineTo(cx + Rr(G.z1), ty); g.lineTo(cx + Rr(G.z0), by); g.closePath(); g.fill();
    L(g, [[cx - Rr(G.z0), by], [cx - Rr(G.z1), ty]], C.wall, 2.5); L(g, [[cx + Rr(G.z0), by], [cx + Rr(G.z1), ty]], C.wall, 2.5);
    L(g, [[cx, ty], [cx, by]], '#F5F5F1', 1.5);
    // 刻度（按 20 °C 水）
    const w20 = P.fluid('diw', 20);
    for (let q = 0.5; q <= 3.01; q += 0.5) {
      const zz = P.floatMeter({ Q: q * P.LPM, f: w20, geo: G }).z;
      L(g, [[cx + Rr(G.z1) + 6, Z(zz)], [cx + Rr(G.z1) + 18, Z(zz)]], C.ink, 1.4);
      T(g, fx(q, 1), cx + Rr(G.z1) + 22, Z(zz) + 4, { c: C.ink, size: 11, mono: true });
    }
    T(g, 'L/min（水）', cx + Rr(G.z1) + 6, ty - 8, { c: C.dim, size: 11 });
    // 浮子
    const zf = s.z ?? z.r.z;
    const fy = Z(zf), fr = G.rf * sc, fh = 0.011 * sc / 0.9 * 0.9;
    g.fillStyle = '#F5F5F1';
    g.beginPath(); g.moveTo(cx - fr * 0.3, fy + fh * 0.75); g.lineTo(cx - fr, fy); g.lineTo(cx - fr * 0.65, fy - fh * 0.2); g.lineTo(cx + fr * 0.65, fy - fh * 0.2); g.lineTo(cx + fr, fy); g.lineTo(cx + fr * 0.3, fy + fh * 0.75); g.closePath(); g.fill();
    L(g, [[cx - fr, fy], [cx + fr, fy]], C.orange, 2.5);
    if (s.bub) circ(g, cx - fr * 0.7, fy + fh * 0.4, 5, '#FFFFFFCC');
    L(g, [[cx - Rr(G.z1) - 10, fy], [cx + Rr(G.z1) + 18, fy]], C.orange + '88', 1, [3, 3]);
    // 受力
    const wNet = z.r.net;
    const ax = cx - Rr(G.z1) - 60;
    arrow(g, ax, fy - 4, ax, fy + 46, C.red, 2.5);
    T(g, '重力 − 浮力', ax - 6, fy + 62, { c: C.red, size: 11, align: 'center' });
    if (s.Q > 0 && zf > G.zrest + 1e-4) { arrow(g, ax + 22, fy + 4, ax + 22, fy - 42, C.blue, 2.5); T(g, '液体托力', ax + 22, fy - 50, { c: C.blue, size: 11, align: 'center' }); }
    const rnd = rng(9);
    for (let i = 0; i < 36; i++) {
      const zz = G.z0 + ((rnd() * (G.z1 - G.z0) + s.t * s.Q * 0.02) % (G.z1 - G.z0));
      const rr = (rnd() * 2 - 1) * Rr(zz) * 0.9;
      if (Math.abs(rr) > fr * 1.1 || Math.abs(Z(zz) - fy) > 14) circ(g, cx + rr, Z(zz), 1.8, C.blue + '99');
    }
    T(g, `液体 ${fx(z.f.rho / 1000, 3)} g/cm³ · 浮子 ${fx(G.rho_f / 1000, 2)} g/cm³`, W - 12, H - 10, { c: C.dim, size: 11, align: 'right' });
  },
  read(s, z) {
    const zf = s.z ?? z.r.z;
    const rd = this.scale(zf) / P.LPM;
    return [['浮子上沿离底', `${fx((zf - this.geo.zrest) * 1000, 1)} mm`], ['刻度读数', z.r.pegged ? `顶到头（> ${fx(this.scale(this.geo.zmax) / P.LPM, 1)}）` : `${fx(rd, 2)} L/min`, 'hl'],
      ['真实流量', `${fx(s.Q, 2)} L/min`], ['误差', s.Q > 0 && !z.r.pegged ? pct(rd, s.Q) : '—', s.Q > 0 && Math.abs(rd / s.Q - 1) > 0.05 ? 'bad' : 'good']];
  },
  note(s, z) {
    if (s.fl === 'h2so4') return '浓硫酸密度 1.83，PTFE 浮子 2.15，浮子在里面几乎没了重量，一点流量就被冲到顶。测浓硫酸要用专门刻度，或者换更重的浮子。';
    if (s.fl === 'ipa') return 'IPA 比水轻，浮子"相对更重"，同样流量浮子停得更低，读数偏小；IPA 黏度是水的两倍，又把浮子往上推一点。两者叠加，读数偏低约两成。';
    if (s.bub) return '一个气泡粘在浮子上，浮子等效变轻，被托得更高，读数偏大。所以浮子流量计装在气泡容易积存的地方要注意排气。';
    if (s.pulse) return '泵每次脉动，浮子就跟着上下跳，只能读个平均。隔膜泵、风箱泵出口常见这种情况。';
    return '锥形管越往上越粗：浮子一升高，旁边的缝变宽，同样流量托它的力就变小。所以总能找到一个高度刚好平衡，高度和流量近似成正比。';
  },
};

// ======================================================================
// 5. 差压
// ======================================================================
const DP = {
  id: 'dp', tab: '差压',
  controls: [
    { k: 'Q', type: 'range', label: '流量', min: 0, max: 2, step: 0.01, val: 1, unit: 'L/min' },
    { k: 'fl', type: 'select', label: '液体（仪表按水标定）', opts: FLUID_OPTS(['diw', 'ipa', 'h2so4']), val: 'diw' },
    { k: 'drift', type: 'range', label: '传感器零点漂移', min: -300, max: 300, step: 10, val: 0, unit: 'Pa', fmt: (v) => v.toFixed(0) },
    { k: 'setRho', type: 'check', label: '仪表里设了这种液体的密度', val: false },
  ],
  calc(s) { const f = P.fluid(s.fl); return { f, r: P.dpMeter({ Q: s.Q * P.LPM, f, drift: s.drift, setRho: s.setRho }) }; },
  draw(g, W, H, s, z) {
    const r = z.r;
    const top = 70, ph = Math.min(60, H * 0.12), x0 = 30, x1 = W - 20, cy = top + ph / 2, xo = W / 2;
    R(g, x0, cy - ph / 2, x1 - x0, ph, '#1E3A4A');
    L(g, [[x0, cy - ph / 2], [x1, cy - ph / 2]], C.wall, 3); L(g, [[x0, cy + ph / 2], [x1, cy + ph / 2]], C.wall, 3);
    const oh = ph * 0.26;
    R(g, xo - 3, cy - ph / 2, 6, ph / 2 - oh, '#E7DCBE'); R(g, xo - 3, cy + oh, 6, ph / 2 - oh, '#E7DCBE');
    const rnd = rng(4);
    const sp = s.Q * 40;
    for (let i = 0; i < 60; i++) {
      const lane = rnd() * 2 - 1;
      let x = x0 + ((rnd() * (x1 - x0) + s.t * sp) % (x1 - x0));
      const near = Math.exp(-(((x - xo) / 26) ** 2));
      const y = cy + lane * (ph / 2 * 0.85) * (1 - near * 0.72);
      circ(g, x, y, 1.8, C.blue + 'AA');
    }
    // 压力表
    const xt = (x1 - x0) * 0.2;
    const p1 = 200e3 + r.dp, p2 = 200e3;
    for (const [x, p, lab] of [[xo - xt, p1, '上游 p₁'], [xo + xt, p2, '下游 p₂']]) {
      L(g, [[x, cy - ph / 2], [x, cy - ph / 2 - 16]], C.wall, 2);
      circ(g, x, cy - ph / 2 - 36, 20, '#E5E1D5'); circ(g, x, cy - ph / 2 - 36, 20, C.faint, true, 1.5);
      const a = -Math.PI * 1.15 + (p - 200e3) / 120e3 * Math.PI * 1.3;
      L(g, [[x, cy - ph / 2 - 36], [x + Math.cos(a) * 15, cy - ph / 2 - 36 + Math.sin(a) * 15]], C.red, 2);
      T(g, lab, x + 26, cy - ph / 2 - 40, { c: C.dim, size: 11 });
      T(g, `${fx(p / 1000, 1)} kPa`, x + 26, cy - ph / 2 - 25, { c: C.ink, size: 11, mono: true });
    }
    // 沿管压力分布
    const pb = { x: 54, y: cy + ph / 2 + 22, w: W - 74, h: H * 0.16 };
    const dpv = Math.max(r.dp, 1);
    const pf = frame(g, pb, { x0: 0, x1: 1, y0: -1.25, y1: 0.15, yl: '沿管的压力（相对上游）' });
    const prof = [];
    for (let i = 0; i <= 120; i++) {
      const u = i / 120, xx = x0 + u * (x1 - x0);
      const k = (xx - xo) / ((x1 - x0) * 0.5);
      // 孔前不变；过孔急降，在缩流断面最低；之后部分恢复，永久损失约 1 − β^1.9
      const perm = 1 - 0.26 ** 1.9;
      const p = k < 0 ? 0 : k < 0.07 ? -1.18 * (k / 0.07) : -perm - (1.18 - perm) * Math.exp(-(k - 0.07) / 0.12);
      prof.push([pf.X((xx - pb.x) / pb.w), pf.Y(p)]);
    }
    L(g, prof, C.orange, 2);
    T(g, `Δp = ${fx(dpv / 1000, 2)} kPa`, pb.x + pb.w - 6, pb.y + 14, { c: C.ink, size: 11.5, align: 'right', mono: true });
    // 噪声误差曲线
    const eb = { x: 54, y: H * 0.68, w: W - 74, h: H * 0.22 };
    const { X, Y } = frame(g, eb, { x0: 0, x1: 2, y0: 0, y1: 20, xt: [0, 0.2, 0.5, 1, 1.5, 2], yt: [0, 5, 10, 20], yf: (v) => `${v}%`, xl: '流量 L/min', yl: '两只传感器各 60 Pa 噪声，折算到流量上的误差' });
    const pts = [];
    for (let i = 1; i <= 200; i++) { const q = i / 100; pts.push([X(q), Y(clamp(P.dpRelErr(P.dpMeter({ Q: q * P.LPM, f: z.f }).dp) * 100, 0, 20))]); }
    L(g, pts, C.purple, 2);
    if (s.Q > 0) circ(g, X(s.Q), Y(clamp(P.dpRelErr(r.dp) * 100, 0, 20)), 5, C.yellow);
    R(g, X(0), eb.y, X(0.2) - X(0), eb.h, C.red + '22');
    T(g, '10% 量程以下', X(0.1), eb.y + 14, { c: C.red, size: 10.5, align: 'center' });
  },
  read(s, z) {
    const r = z.r;
    return [['前后压差', `${fx(r.dp / 1000, 3)} kPa`], ['孔里流速', `${fx(r.vo, 2)} m/s`], ['黏性损失占比', `${fx(r.dpV / Math.max(r.dp, 1e-9) * 100, 1)} %`],
      ['仪表读数', `${fx(r.Qm / P.LPM, 3)} L/min`, 'hl'], ['误差', s.Q > 0 ? pct(r.Qm, s.Q * P.LPM) : r.Qm > 0 ? '零点不为零' : '—', (s.Q > 0 && Math.abs(r.Qm / (s.Q * P.LPM) - 1) > 0.02) || (s.Q === 0 && r.Qm > 0) ? 'bad' : 'good'],
      ['噪声带来的误差', s.Q > 0 ? `±${fx(P.dpRelErr(r.dp) * 100, 1)} %` : '—']];
  },
  note(s, z) {
    const r = z.r;
    if (s.drift !== 0 && s.Q < 0.4) return `零点漂了 ${s.drift} Pa，在小流量时压差本身只有 ${fx(r.dp, 0)} Pa，漂移就是大头。Entegris 的专利在小流量干脆换成单传感器模式，就是在躲这个。`;
    if (s.fl === 'h2so4' && !s.setRho) return '浓硫酸比水重 1.8 倍，同样流量压差大得多；仪表还当它是水，读数偏大约 √1.83 ≈ 1.35 倍。设上密度后还剩一点偏差，来自黏性损失（浓硫酸黏）。';
    if (s.fl !== 'diw' && s.setRho) return '设了密度以后，剩下的误差来自孔里的黏性损失：液体越黏、流量越小，这一项占比越大。精确的流量控制器会按液体再做标定。';
    return '压差和流量的平方成正比。看下面那条紫线：流量减半，压差变成四分之一，传感器噪声折算出来的误差翻到四倍。所以差压式的可用范围一般从满量程的 10% 起。';
  },
};

// ======================================================================
// 6. 热式
// ======================================================================
const THM = {
  id: 'thm', tab: '热式',
  controls: [
    { k: 'frac', type: 'range', label: '真实流量（占满量程 10 SLM）', min: 0, max: 1, step: 0.01, val: 0.5, fmt: (v) => `${(v * 10).toFixed(1)} SLM` },
    { k: 'gas', type: 'select', label: '实际流过的气体（仪表按 N₂ 标定）', opts: Object.entries(P.GASES).map(([k, v]) => [k, v.name]), val: 'N2' },
  ],
  calc(s) { return { r: P.mfc({ frac: s.frac, gas: s.gas }), r0: P.capillaryT(0) }; },
  draw(g, W, H, s, z) {
    const r = z.r, r0 = z.r0;
    const x0 = 46, x1 = W - 20, cy = 40;
    R(g, x0, cy - 5, x1 - x0, 10, '#5C656C');
    for (const [a, b] of P.COILS) {
      const xa = x0 + a * (x1 - x0), xb = x0 + b * (x1 - x0);
      for (let x = xa; x < xb; x += 4) L(g, [[x, cy - 10], [x + 2, cy + 10]], '#B86B3D', 2.2);
    }
    T(g, '上游绕组', x0 + 0.40 * (x1 - x0), cy - 16, { c: C.dim, size: 11, align: 'center' });
    T(g, '下游绕组', x0 + 0.60 * (x1 - x0), cy - 16, { c: C.dim, size: 11, align: 'center' });
    arrow(g, x0 - 36, cy, x0 - 6, cy, C.green, 2.2);
    // 温度分布
    const tb = { x: 54, y: cy + 34, w: W - 74, h: H * 0.32 };
    const Tmax = Math.max(...r0.T) * 1.12;
    const tf = frame(g, tb, { x0: 0, x1: 1, y0: 0, y1: 1.1, yl: '毛细管上的温升（相对无流量时的最高点）' });
    for (const [a, b] of P.COILS) R(g, tf.X(a), tb.y, tf.X(b) - tf.X(a), tb.h, '#B86B3D22');
    const line = (Tarr, c, w, dash) => L(g, Array.from(Tarr, (v, i) => [tf.X((i + 1) * r.dx), tf.Y(v / Tmax)]), c, w, dash);
    line(r0.T, C.dim, 1.4, [5, 4]);
    line(r.T, C.orange, 2.4);
    T(g, '没有流动', tf.X(0.5), tf.Y(Math.max(...r0.T) / Tmax) - 8, { c: C.dim, size: 11, align: 'center' });
    // 特性曲线
    const cb = { x: 54, y: H * 0.64, w: W - 74, h: H * 0.26 };
    const PeMax = P.MFC.PeFS * 7;
    const { X, Y } = frame(g, cb, { x0: 0, x1: PeMax, y0: 0, y1: 0.0115, xt: [0, P.MFC.PeFS], xf: (v) => (v ? '满量程' : '0'), xl: '质量流量 × 比热 →', yl: '上下游温差（电桥输出）' });
    THM._curve ||= Array.from({ length: 141 }, (_, i) => { const pe = PeMax * i / 140; return [pe, P.capillaryT(pe, { N: 80 }).dT]; });
    const pts = THM._curve.map(([pe, d]) => [X(pe), Y(d)]);
    R(g, X(0), cb.y, X(P.MFC.PeFS) - X(0), cb.h, C.green + '18');
    L(g, pts, C.orange, 2);
    circ(g, X(r.Pe), Y(r.dT), 5, C.yellow);
    T(g, '直线段：MFC 的量程放在这里', X(P.MFC.PeFS) + 6, cb.y + 14, { c: C.green, size: 11 });
    T(g, '流太大时两个绕组都被吹凉，温差反而变小', X(PeMax) - 4, Y(THM._curve[126][1]) - 10, { c: C.dim, size: 10.5, align: 'right' });
  },
  read(s, z) {
    const r = z.r;
    return [['真实流量', `${fx(s.frac * 10, 2)} SLM`], ['上下游温差', `${fx(r.dT / 0.0323 * 100, 2)} %`], ['仪表读数（按 N₂）', `${fx(r.read * 10, 2)} SLM`, 'hl'],
      ['偏差', s.frac > 0 ? pct(r.read, s.frac) : '—', s.frac > 0 && Math.abs(r.read / s.frac - 1) > 0.02 ? 'bad' : 'good'], ['要乘的转换系数（估算）', fx(r.cf, 2)]];
  },
  note(s, z) {
    if (s.gas !== 'N2') return `同样的 sccm 是同样多的分子。${P.GASES[s.gas].name}每摩尔带走的热是 N₂ 的 ${fx(1 / z.r.cf, 2)} 倍，所以读数要乘 ${fx(z.r.cf, 2)} 才对。真实转换系数表还会按分子结构再修正一点。`;
    return '流动把热从上游绕组带到下游绕组：上游被吹凉、下游变热。两组绕组接成电桥，输出的就是温差。它正比于"质量流量 × 比热"，所以热式测的是质量，不是体积。';
  },
};

// ======================================================================
// 7. 科里奥利
// ======================================================================
const COR = {
  id: 'cor', tab: '科里奥利',
  controls: [
    { k: 'm', type: 'range', label: '质量流量', min: 0, max: 1500, step: 10, val: 750, unit: 'g/min', fmt: (v) => v.toFixed(0) },
    { k: 'fl', type: 'select', label: '液体', opts: FLUID_OPTS(['diw', 'ipa', 'h2so4']), val: 'diw' },
    { k: 'gvf', type: 'range', label: '混进的气泡（体积比）', min: 0, max: 0.1, step: 0.005, val: 0, fmt: (v) => `${(v * 100).toFixed(1)} %` },
    { k: 'vib', type: 'check', label: '旁边有台泵在振', val: false },
  ],
  calc(s) { const f = P.fluid(s.fl); return { f, c: P.coriolis({ mdot: s.m / 60000, rho: f.rho, gvf: s.gvf, vib: s.vib ? 1 : 0, seed: 1 + Math.floor(performance.now() / 300) }) }; },
  live: true,
  draw(g, W, H, s, z) {
    const c = z.c;
    const top = 16, uh = H * 0.42, cx = W / 2, sep = Math.min(W * 0.2, 130);
    const w = 2 * Math.PI * 1.1 * s.t;
    const lag = (s.m / 1500) * 0.9;
    const A = 16 / c.damp;
    // 两条腿 + 底部弯头（俯视示意：左右摆）
    const legs = [[-1, '进口侧'], [1, '出口侧']];
    const pos = legs.map(([side]) => A * Math.sin(w + side * lag / 2));
    T(g, '俯视：一对 U 管的两条腿在左右摆（放大了很多倍）', cx, top + 8, { c: C.dim, size: 11, align: 'center' });
    legs.forEach(([side, lab], i) => {
      const x = cx + side * sep;
      L(g, [[x - 26, top + 50], [x + 26, top + 50]], C.faint, 1);
      L(g, [[x, top + 40], [x, top + 60]], C.faint, 1);
      circ(g, x + pos[i], top + 50, 11, C.pfa);
      circ(g, x + pos[i], top + 50, 11, C.faint, true, 1);
      T(g, lab, x, top + 84, { c: i ? C.cyan : C.orange, size: 12, align: 'center', bold: true });
    });
    L(g, [[cx - sep + pos[0], top + 50], [cx + sep + pos[1], top + 50]], C.pfa + '55', 3);
    if (s.gvf > 0) { const rnd = rng(Math.floor(s.t * 10)); for (let i = 0; i < s.gvf * 200; i++) circ(g, cx + (rnd() - 0.5) * sep * 1.8, top + 50 + (rnd() - 0.5) * 18, 2, '#FFFFFFAA'); }
    T(g, s.m > 0 ? '有流量：出口侧比进口侧晚一点到最右边' : '没有流量：两条腿完全同步', cx, top + uh - 6, { c: s.m > 0 ? C.yellow : C.dim, size: 12, align: 'center' });
    // 拾振器信号
    const box = { x: 54, y: H * 0.5, w: W - 74, h: H * 0.38 };
    const { X, Y } = frame(g, box, { x0: 0, x1: 2, y0: -1.2, y1: 1.2, xl: '时间（周期）', yl: '两个拾振器的信号（时间差放大了）' });
    const rnd = rng(Math.floor(s.t * 8) + 3);
    for (const [side, col] of [[-1, C.orange], [1, C.cyan]]) {
      const pts = [];
      for (let i = 0; i <= 240; i++) {
        const ph = i / 120;
        const v = Math.sin(2 * Math.PI * ph + w + side * lag / 2) / c.damp + (s.vib ? 0.12 * Math.sin(2 * Math.PI * ph * 3.7 + w * 0.3) : 0) + (s.gvf > 0 ? (rnd() - 0.5) * s.gvf * 5 : 0);
        pts.push([X(ph), Y(v)]);
      }
      L(g, pts, col, 2);
    }
  },
  read(s, z) {
    const c = z.c;
    const mr = c.mread * 60000;
    return [['振动频率', `${fx(c.freq, 1)} Hz`], ['两侧时间差', `${fx(c.dt * 1e6, 3)} µs`], ['质量流量读数', `${fx(mr, 0)} g/min`, 'hl'],
      ['误差', s.m > 0 ? pct(mr, s.m) : `${fx(mr, 1)} g/min`, (s.m > 0 && Math.abs(mr / s.m - 1) > 0.02) ? 'bad' : 'good'], ['密度读数', `${fx(c.rhoM / 1000, 3)} g/cm³`],
      ['换算成体积流量', `${fx(mr / (c.rhoM / 1000), 0)} mL/min`]];
  },
  note(s, z) {
    if (s.gvf > 0) return '混进气泡后，管子里的液体不再"跟着管子一起振"，振动被阻尼、信号变噪，质量读数偏低，密度读数也掉下去。科里奥利最怕两相流。';
    if (s.vib) return '外面的振动叠加到管子上，时间差里混进噪声。PFA 管又轻又软，所以专利里要用几千倍重的底座或主动平衡来隔振。';
    return `换液体看看：频率变了（越重越慢），但质量流量照样准。频率换算出密度 ${fx(z.c.rhoM / 1000, 3)} g/cm³，配比时可以拿它当浓度检查。时间差只有几微秒，相位差还不到 0.1°。`;
  },
};

// ======================================================================
// 8. 电磁
// ======================================================================
const MAG = {
  id: 'mag', tab: '电磁',
  controls: [
    { k: 'Q', type: 'range', label: '流量', min: 0, max: 60, step: 0.5, val: 20, unit: 'L/min' },
    { k: 'fl', type: 'select', label: '液体', opts: FLUID_OPTS(['diw', 'ipa', 'dhf', 'h2so4']), val: 'dhf' },
    { k: 'cap', type: 'seg', label: '电极', opts: [['wet', '接触式（普通）'], ['cap', '电容式（不接触）']], val: 'wet' },
  ],
  calc(s) { const f = P.FLUIDS[s.fl]; return { f, r: P.magMeter({ Q: s.Q * P.LPM, sigma: f.sigma, capacitive: s.cap === 'cap' }) }; },
  init(s) { s.ions = Array.from({ length: 90 }, (_, i) => { let a, b; do { a = Math.random() * 2 - 1; b = Math.random() * 2 - 1; } while (a * a + b * b > 1); return { a, b, q: i % 2 ? 1 : -1 }; }); },
  draw(g, W, H, s, z) {
    const r = z.r;
    const narrow = W < 560;
    const cx = narrow ? W / 2 : W * 0.27, cy = H * 0.3, R0 = Math.min(H * 0.22, narrow ? W * 0.26 : W * 0.17);
    const dir = (s.t % 2) < 1 ? 1 : -1;
    circ(g, cx, cy, R0 + 9, '#E7E8E0'); circ(g, cx, cy, R0, '#1E3A4A');
    R(g, cx - R0 * 0.8, cy - R0 - 28, R0 * 1.6, 12, '#B86B3D'); R(g, cx - R0 * 0.8, cy + R0 + 16, R0 * 1.6, 12, '#B86B3D');
    T(g, '线圈', cx + R0 * 0.9, cy - R0 - 18, { c: C.dim, size: 11 });
    for (const x of [-0.5, 0, 0.5]) arrow(g, cx + x * R0, cy + dir * R0 * 0.85, cx + x * R0, cy - dir * R0 * 0.85, C.purple + 'AA', 1.6, 7);
    T(g, `B ${dir > 0 ? '↑' : '↓'}`, cx - R0 - 34, cy + 4, { c: C.purple, size: 12, bold: true });
    const drift = r.ok ? clamp(s.Q / 40, 0, 1) : clamp(s.Q / 40, 0, 1) * 0.15;
    s.ions.forEach((q) => {
      const tx = q.q * dir * 0.9;
      const x = q.a + (tx - q.a) * drift * 0.8;
      const lim = Math.sqrt(Math.max(0, 1 - x * x));
      circ(g, cx + x * R0, cy + clamp(q.b, -lim, lim) * R0, 3, q.q > 0 ? C.red : C.blue);
    });
    for (const sd of [-1, 1]) R(g, cx + sd * (R0 + 2) - (sd > 0 ? 0 : 8), cy - 6, 8, 12, '#DADEE1');
    T(g, '电极', cx + R0 + 14, cy + 22, { c: C.dim, size: 11 });
    T(g, '⊙ 液体朝你流过来', cx, cy + R0 + 48, { c: C.dim, size: 11, align: 'center' });
    // 电极信号
    const box = narrow ? { x: 54, y: H * 0.68, w: W - 74, h: H * 0.22 } : { x: W * 0.52, y: 30, w: W * 0.46 - 12, h: H * 0.8 };
    const Emax = Math.max(r.E * 1e6 * 1.4, 5);
    const { X, Y } = frame(g, box, { x0: 0, x1: 4, y0: -Emax, y1: Emax, xt: [0, 1, 2, 3, 4], xl: '时间（s）', yl: '电极间电压（µV）', yt: [-Math.round(Emax * 0.7), 0, Math.round(Emax * 0.7)] });
    const rnd = rng(Math.floor(s.t * 5) + 2);
    const pts = [], ex = [];
    for (let i = 0; i <= 400; i++) {
      const tt = i / 100;
      const d = ((tt + s.t) % 2) < 1 ? 1 : -1;
      const nz = (rnd() + rnd() + rnd() - 1.5) * 2 * r.noise * 1e6;
      pts.push([X(tt), Y(clamp(d * r.E * 1e6 + nz, -Emax, Emax))]);
      ex.push([X(tt), Y(d * r.E * 1e6)]);
    }
    L(g, pts, C.orange, 1.2);
    L(g, ex, C.green, 1.6, [5, 4]);
  },
  read(s, z) {
    const r = z.r;
    const snr = r.E / r.noise;
    return [['平均流速', `${fx(r.v, 2)} m/s`], ['液体电导率', `${z.f.sigma >= 100 ? fx(z.f.sigma, 0) : fx(z.f.sigma, 3)} µS/cm${z.f.est ? '（估）' : ''}`], ['电极电压 E', `${fx(r.E * 1e6, 1)} µV`],
      ['噪声（示意）', `${fx(r.noise * 1e6, 2)} µV`], ['信噪比', fx(snr, 0)], ['能不能测', r.ok ? '能' : '不行：电导率低于下限', r.ok ? 'good' : 'bad']];
  },
  note(s, z) {
    if (!z.r.ok && s.cap === 'wet') return `${z.f.name}的电导率只有 ${fx(z.f.sigma, 3)} µS/cm，普通电磁流量计要求 ≥ 5 µS/cm（脱盐水 ≥ 20）。电极看到的源阻抗太高，信号淹在噪声里。湿法机台里的 DIW、IPA 都不用电磁式。`;
    if (s.cap === 'cap') return '电容式把电极放在绝缘管外面，隔着管壁取信号，资料写的下限是 0.01 µS/cm。注意：噪声系数是本页示意的，真实能不能在湿法机台测超纯水，要看具体产品说明。';
    return `E = B·v·D：磁场 0.005 T、管径 25 mm，流速 1 m/s 才 125 µV。励磁做成方波来回翻，正负两半相减，可以去掉电极上的直流漂移。`;
  },
};

export const LABS = [US, VOR, PAD, FLT, DP, THM, COR, MAG];

// ======================================================================
// 实验台框架：标签、旋钮、画布、读数
// ======================================================================
export function mountLab(lab, { canvas, ctlEl, readEl, noteEl }) {
  const s = { t: 0 };
  for (const c of lab.controls) s[c.k] = c.val;
  if (lab.init) lab.init(s);
  let z = lab.calc(s);
  let dirty = false;
  function buildControls() {
    ctlEl.innerHTML = '';
    for (const c of lab.controls) {
      if (c.when && !c.when(s)) continue;
      const wrap = document.createElement('div');
      wrap.className = 'cf';
      const id = `${lab.id}_${c.k}`;
      if (c.type === 'range') {
        const show = () => (c.log ? `${fx(10 ** s[c.k], 10 ** s[c.k] < 1 ? 2 : 1)} ${c.unit}` : c.fmt ? c.fmt(s[c.k]) : `${fx(s[c.k], c.step < 0.1 ? 2 : 1)} ${c.unit || ''}`);
        wrap.innerHTML = `<label for="${id}"><span>${c.label}</span><output>${show()}</output></label><input type="range" id="${id}" min="${c.min}" max="${c.max}" step="${c.step}" value="${s[c.k]}">`;
        const inp = wrap.querySelector('input'), out = wrap.querySelector('output');
        inp.addEventListener('input', () => { s[c.k] = +inp.value; out.textContent = show(); dirty = true; });
      } else if (c.type === 'select') {
        wrap.innerHTML = `<label for="${id}"><span>${c.label}</span></label><select id="${id}">${c.opts.map(([k, v]) => `<option value="${k}"${k === s[c.k] ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
        wrap.querySelector('select').addEventListener('change', (e) => { s[c.k] = e.target.value; dirty = true; });
      } else if (c.type === 'seg') {
        wrap.innerHTML = `<span class="cl">${c.label}</span><div class="btns" role="group" aria-label="${c.label}">${c.opts.map(([k, v]) => `<button type="button" data-v="${k}" aria-pressed="${k === s[c.k]}">${v}</button>`).join('')}</div>`;
        wrap.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { s[c.k] = b.dataset.v; dirty = true; buildControls(); }));
      } else if (c.type === 'check') {
        wrap.innerHTML = `<label class="chk"><input type="checkbox" id="${id}"${s[c.k] ? ' checked' : ''}> ${c.label}</label>`;
        wrap.querySelector('input').addEventListener('change', (e) => { s[c.k] = e.target.checked; dirty = true; });
      }
      ctlEl.appendChild(wrap);
    }
  }
  buildControls();
  let readT = 0;
  function render(dt) {
    s.t += dt;
    if (dirty || lab.live && s.t - readT > 0.3) { z = lab.calc(s); if (dirty) readT = -1; dirty = false; }
    if (lab.step) lab.step(s, dt, z);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    R(g, 0, 0, W, H, C.bg);
    lab.draw(g, W, H, s, z);
    if (s.t - readT > 0.3) {
      readT = s.t;
      readEl.innerHTML = lab.read(s, z).map(([k, v, cls]) => `<div class="${cls || ''}"><span>${k}</span><b>${v}</b></div>`).join('');
      noteEl.innerHTML = lab.note(s, z);
    }
  }
  return {
    render, state: s, lab,
    /** 切回这个实验时，旋钮的 DOM 要重新生成（几个实验共用一个容器）。 */
    rebuild() { buildControls(); dirty = true; readT = -1; },
    set(k, v) { s[k] = v; buildControls(); dirty = true; readT = -1; },
  };
}
