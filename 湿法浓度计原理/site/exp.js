// 原理小实验（纯 Canvas，无依赖）
// 注意：标了“示意”的曲线只表现趋势/形状，不是某种药液的真实数据。
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function ctrl(box, label, min, max, step, val, unit, fmt) {
    const w = document.createElement('label'); w.className = 'ctl';
    w.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}"><b></b>`;
    const inp = w.querySelector('input'), out = w.querySelector('b');
    const show = () => out.textContent = (fmt ? fmt(+inp.value) : (+inp.value)) + (unit || '');
    inp.addEventListener('input', show); show();
    box.appendChild(w);
    return { get v() { return +inp.value; }, el: inp };
  }
  function check(box, label, val) {
    const w = document.createElement('label'); w.className = 'ctl chk';
    w.innerHTML = `<input type="checkbox" ${val ? 'checked' : ''}><span>${label}</span>`;
    box.appendChild(w);
    const i = w.querySelector('input');
    return { get v() { return i.checked; }, el: i };
  }
  function button(box, label) {
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = label; box.appendChild(b); return b;
  }
  function setup(root) {
    const cv = root.querySelector('canvas'), ctlBox = root.querySelector('.ctls'), out = root.querySelector('.readout');
    const fit = () => {
      const r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
      cv.width = r.width * d; cv.height = r.height * d;
      const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
      return { g, W: r.width, H: r.height };
    };
    return { cv, ctlBox, out, fit };
  }
  function onAny(ctrls, fn) { ctrls.forEach(c => c.el.addEventListener('input', fn)); window.addEventListener('resize', fn); fn(); }
  function axes(g, x0, y0, w, h, xl, yl) {
    g.strokeStyle = css('--ink3'); g.lineWidth = 1; g.beginPath();
    g.moveTo(x0, y0 - h); g.lineTo(x0, y0); g.lineTo(x0 + w, y0); g.stroke();
    g.fillStyle = css('--ink2'); g.font = '12px system-ui,sans-serif';
    g.textAlign = 'right'; g.fillText(xl, x0 + w, y0 + 16);
    g.save(); g.translate(x0 - 8, y0 - h); g.textAlign = 'left'; g.fillText(yl, 0, -6); g.restore();
  }
  const gauss = (x, m, s) => Math.exp(-((x - m) ** 2) / (2 * s * s));
  const loopers = [];
  function anim(fn) { loopers.push(fn); }
  (function tick(t) { loopers.forEach(f => f(t / 1000)); requestAnimationFrame(tick); })(0);
  const vis = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };

  const EXP = {};

  // ---------------------------------------------------------- 1 吸光：多成分 + 温度
  EXP.absorb = root => {
    const { ctlBox, out, fit } = setup(root);
    const cA = ctrl(ctlBox, '成分A 浓度', 0, 10, 0.1, 4, ' %');
    const cB = ctrl(ctlBox, '成分B 浓度', 0, 10, 0.1, 2, ' %');
    const T = ctrl(ctlBox, '药液温度', 20, 80, 1, 25, ' °C');
    const comp = check(ctlBox, '启用温度补偿（标定时也测了不同温度）', true);
    const lam = []; for (let l = 1300; l <= 2000; l += 5) lam.push(l);
    const water = (l, t) => 1.0 * gauss(l, 1450 - 0.25 * (t - 25), 45) + 1.6 * gauss(l, 1930 - 0.3 * (t - 25), 55); // 示意：水峰随温度移动
    const sA = l => 0.09 * gauss(l, 1530, 40) + 0.04 * gauss(l, 1700, 60);
    const sB = l => 0.08 * gauss(l, 1770, 35) + 0.03 * gauss(l, 1400, 50);
    const det = [1400, 1530, 1650, 1770, 1850];
    function solve(Ameas, t) { // 最小二乘解 cA,cB（2x2 正规方程）
      let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
      det.forEach((l, i) => { const y = Ameas[i] - water(l, t); const p = sA(l), q = sB(l);
        a11 += p * p; a12 += p * q; a22 += q * q; b1 += p * y; b2 += q * y; });
      const D = a11 * a22 - a12 * a12; return [(b1 * a22 - b2 * a12) / D, (a11 * b2 - a12 * b1) / D];
    }
    onAny([cA, cB, T, comp], () => {
      const { g, W, H } = fit(); g.clearRect(0, 0, W, H);
      const x0 = 46, y0 = H - 34, w = W - 66, h = H - 70;
      axes(g, x0, y0, w, h, '波长 / nm（近红外）', '吸光度（示意）');
      const X = l => x0 + (l - 1300) / 700 * w, Y = a => y0 - a / 2.2 * h;
      const tot = l => water(l, T.v) + cA.v * sA(l) + cB.v * sB(l);
      const lines = [[l => water(l, T.v), '#8aa4c8', '水'], [l => cA.v * sA(l), '#e0793a', '成分A'], [l => cB.v * sB(l), '#3aa776', '成分B'], [tot, css('--ink'), '合计（实际测到的）']];
      lines.forEach(([f, c, n], i) => {
        g.strokeStyle = c; g.lineWidth = i === 3 ? 2.4 : 1.5; g.setLineDash(i === 3 ? [] : [5, 4]); g.beginPath();
        lam.forEach((l, j) => j ? g.lineTo(X(l), Y(f(l))) : g.moveTo(X(l), Y(f(l)))); g.stroke();
        g.setLineDash([]); g.fillStyle = c; g.fillRect(x0 + 10 + i * 120, 8, 14, 3); g.font = '12px system-ui'; g.textAlign = 'left'; g.fillText(n, x0 + 28 + i * 120, 13);
      });
      det.forEach(l => { g.fillStyle = 'rgba(80,120,255,.12)'; g.fillRect(X(l) - 4, y0 - h, 8, h); g.fillStyle = css('--ink3'); g.textAlign = 'center'; g.fillText(l, X(l), y0 + 16 - 32 * 0); });
      const Am = det.map(tot);
      const [eA, eB] = solve(Am, comp.v ? T.v : 25);
      out.innerHTML = `检测器在 ${det.length} 个波长读到吸光度 → 联立方程解出：成分A <b>${eA.toFixed(2)} %</b>（真值 ${cA.v.toFixed(2)}）、成分B <b>${eB.toFixed(2)} %</b>（真值 ${cB.v.toFixed(2)}）` +
        (!comp.v && T.v !== 25 ? `<br><span class="warn">没做温度补偿：水的吸收峰随温度移动，被误算成了成分变化 → 误差 ${Math.abs(eA - cA.v).toFixed(2)} / ${Math.abs(eB - cB.v).toFixed(2)} %</span>` : '');
    });
  };

  // ---------------------------------------------------------- 2 折射：临界角
  EXP.refract = root => {
    const { ctlBox, out, fit } = setup(root);
    const c = ctrl(ctlBox, '药液浓度', 0, 60, 0.5, 20, ' %');
    const T = ctrl(ctlBox, '药液温度', 15, 60, 0.5, 25, ' °C');
    const comp = check(ctlBox, '启用温度补偿', true);
    const nP = 1.768; // 蓝宝石（589 nm 附近，寻常光）
    const nOf = (cc, t) => 1.3325 + 0.00145 * cc - 0.0001 * (t - 25); // 示意：线性近似
    onAny([c, T, comp], () => {
      const { g, W, H } = fit(); g.clearRect(0, 0, W, H);
      const n = nOf(c.v, T.v), thc = Math.asin(n / nP);
      const cx = W * 0.42, top = 70, pw = Math.min(W * 0.55, 380);
      g.fillStyle = 'rgba(70,140,240,.18)'; g.fillRect(0, 0, W, top);
      g.fillStyle = css('--ink2'); g.font = '13px system-ui'; g.textAlign = 'left'; g.fillText(`药液  n = ${n.toFixed(4)}`, 10, 22);
      // 棱镜（倒三角）
      g.fillStyle = 'rgba(150,190,255,.35)'; g.strokeStyle = '#6d8fc7'; g.beginPath();
      g.moveTo(cx - pw / 2, top); g.lineTo(cx + pw / 2, top); g.lineTo(cx, top + pw * 0.48); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = css('--ink2'); g.fillText(`蓝宝石棱镜  n = ${nP}`, cx - 60, top + 40);
      // 光线：从左下 LED 以不同入射角打到接液面中心
      const P = { x: cx, y: top }, L = 150;
      const angs = []; for (let a = 40; a <= 80; a += 2) angs.push(a * Math.PI / 180);
      const led = { x: cx - Math.sin(1.05) * 210, y: top + Math.cos(1.05) * 210 };
      angs.forEach(a => {
        const tir = a > thc;
        const sx = cx - Math.sin(a) * L * 1.4, sy = top + Math.cos(a) * L * 1.4;
        g.strokeStyle = tir ? 'rgba(255,170,30,.85)' : 'rgba(255,170,30,.35)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(sx, sy); g.lineTo(P.x, P.y); g.stroke();
        g.beginPath(); g.moveTo(P.x, P.y); g.lineTo(cx + Math.sin(a) * L * 1.4, top + Math.cos(a) * L * 1.4); g.stroke();
        if (!tir) { // 折射进药液
          const b = Math.asin(Math.min(1, nP / n * Math.sin(a)));
          g.strokeStyle = 'rgba(255,170,30,.55)'; g.beginPath(); g.moveTo(P.x, P.y); g.lineTo(cx + Math.sin(b) * 90, top - Math.cos(b) * 90); g.stroke();
        }
      });
      // 检测器：右下方一排像素
      const dx0 = cx + 30, dy = top + L * 1.4 * 0.62, dw = Math.min(W - dx0 - 20, 260);
      const px = 40;
      for (let i = 0; i < px; i++) {
        const a = (40 + 40 * i / (px - 1)) * Math.PI / 180, tir = a > thc;
        g.fillStyle = tir ? '#ffcc33' : '#2a2f3a';
        g.fillRect(dx0 + i * dw / px, dy, dw / px - 1, 16);
      }
      const fr = (thc * 180 / Math.PI - 40) / 40;
      g.strokeStyle = '#e33'; g.lineWidth = 2; g.beginPath(); g.moveTo(dx0 + fr * dw, dy - 8); g.lineTo(dx0 + fr * dw, dy + 24); g.stroke();
      g.fillStyle = css('--ink2'); g.fillText('图像传感器（暗 | 亮）', dx0, dy + 40);
      const nAssume = comp.v ? n + 0.0001 * (T.v - 25) : n; // 补偿：把读数换回 25 °C
      const est = (nAssume - 1.3325) / 0.00145;
      out.innerHTML = `临界角 θc = arcsin(${n.toFixed(4)} / ${nP}) = <b>${(thc * 180 / Math.PI).toFixed(2)}°</b> → 红线（明暗分界）位置 → 算出浓度 <b>${est.toFixed(1)} %</b>（真值 ${c.v} %）` +
        (!comp.v && T.v !== 25 ? `<br><span class="warn">温度偏离 25 °C 却没补偿：折射率变化被当成浓度变化，误差 ${(est - c.v).toFixed(1)} %</span>` : '');
    });
  };

  // ---------------------------------------------------------- 3 电导率：有峰的曲线 + 温度
  EXP.toroid = root => {
    const { ctlBox, out, fit } = setup(root);
    const c = ctrl(ctlBox, '硫酸浓度', 0, 98, 0.5, 15, ' wt%');
    const T = ctrl(ctlBox, '药液温度', 15, 60, 0.5, 25, ' °C');
    const comp = check(ctlBox, '启用温度补偿（约 2 %/°C）', true);
    // 示意：形状参考硫酸（约 30 wt% 处最大），数值为近似
    const pts = [[0, 0], [5, 21], [10, 39], [20, 65], [30, 74], [40, 68], [50, 54], [60, 37], [70, 22], [80, 11], [90, 10], [98, 8]];
    const k25 = x => { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, b] = [pts[i - 1], pts[i]]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return 8; };
    onAny([c, T, comp], () => {
      const { g, W, H } = fit(); g.clearRect(0, 0, W, H);
      const x0 = 50, y0 = H - 34, w = W - 70, h = H - 66;
      axes(g, x0, y0, w, h, '浓度 wt%', '电导率 S/m（25 °C，近似）');
      const X = v => x0 + v / 100 * w, Y = v => y0 - v / 90 * h;
      g.strokeStyle = css('--accent'); g.lineWidth = 2; g.beginPath();
      for (let v = 0; v <= 98; v += 0.5) v ? g.lineTo(X(v), Y(k25(v))) : g.moveTo(X(v), Y(k25(v))); g.stroke();
      const raw = k25(c.v) * (1 + 0.02 * (T.v - 25));
      const k = comp.v ? raw / (1 + 0.02 * (T.v - 25)) : raw;
      g.strokeStyle = '#e33'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(x0, Y(k)); g.lineTo(x0 + w, Y(k)); g.stroke(); g.setLineDash([]);
      // 找所有交点
      const sols = []; for (let v = 0; v < 98; v += 0.1) { const a = k25(v) - k, b = k25(v + 0.1) - k; if (a * b <= 0 && Math.abs(a - b) > 1e-9) sols.push(v + 0.1 * a / (a - b)); }
      const uniq = sols.filter((s, i) => i === 0 || s - sols[i - 1] > 1);
      uniq.forEach(s => { g.fillStyle = '#e33'; g.beginPath(); g.arc(X(s), Y(k), 5, 0, 7); g.fill(); g.fillStyle = css('--ink2'); g.textAlign = 'center'; g.fillText(s.toFixed(1) + '%', X(s), Y(k) - 10); });
      g.fillStyle = css('--accent'); g.beginPath(); g.arc(X(c.v), Y(k25(c.v)), 4, 0, 7); g.fill();
      out.innerHTML = `仪表读数（${comp.v ? '已换算到 25 °C' : '未补偿'}）：<b>${k.toFixed(1)} S/m</b>。曲线上与这条红线相交的点有 <b>${uniq.length}</b> 个：${uniq.map(s => s.toFixed(1) + '%').join('、')}` +
        (uniq.length > 1 ? '<br><span class="warn">同一个读数对应两个浓度！所以电导率法要限定量程（只用在峰的一侧），或者再配一个别的原理来判别。</span>' : '');
    });
  };

  // ---------------------------------------------------------- 4 超声：飞行时间
  EXP.ultra = root => {
    const { ctlBox, out, fit } = setup(root);
    const c = ctrl(ctlBox, '药液浓度', 0, 30, 0.5, 10, ' %');
    const T = ctrl(ctlBox, '药液温度', 15, 60, 0.5, 25, ' °C');
    const comp = check(ctlBox, '启用温度补偿', true);
    const dist = 0.05; // 50 mm
    const vw = t => 1402.39 + 5.0384 * t - 0.058109 * t * t + 3.3432e-4 * t ** 3; // 纯水（简化多项式）
    const vOf = (cc, t) => vw(t) + 6.0 * cc; // 示意：浓度每 1 % 声速 +6 m/s
    let state = {};
    onAny([c, T, comp], () => {
      const v = vOf(c.v, T.v), tof = dist / v * 1e6;
      const vUse = v - (comp.v ? vw(T.v) - vw(25) : 0);
      const est = (vUse - vw(25)) / 6.0;
      state = { v };
      out.innerHTML = `声速 <b>${v.toFixed(1)} m/s</b> → 50 mm 走一趟要 <b>${tof.toFixed(3)} µs</b> → 算出浓度 <b>${est.toFixed(1)} %</b>（真值 ${c.v} %）` +
        (!comp.v && T.v !== 25 ? `<br><span class="warn">没补偿：水本身的声速每 °C 变约 2.4 m/s，被误当成浓度变化，误差 ${(est - c.v).toFixed(1)} %</span>` : '');
    });
    anim(t => {
      if (!vis(root)) return;
      const { g, W, H } = fit(); g.clearRect(0, 0, W, H);
      const top = 40, bot = H - 40, cx = W / 2;
      g.fillStyle = 'rgba(70,140,240,.18)'; g.fillRect(40, top + 20, W - 80, bot - top - 40);
      g.fillStyle = '#c9a457'; g.fillRect(cx - 50, top, 100, 18); g.fillRect(cx - 50, bot - 18, 100, 18);
      g.fillStyle = css('--ink2'); g.font = '12px system-ui'; g.textAlign = 'left';
      g.fillText('发射探头', cx + 60, top + 13); g.fillText('接收探头', cx + 60, bot - 4);
      const speed = (state.v || 1500) / 1500;
      const ph = (t * 0.55 * speed) % 1;
      const y = top + 20 + ph * (bot - top - 40);
      for (let k = 0; k < 3; k++) { g.strokeStyle = `rgba(30,200,230,${0.9 - k * 0.28})`; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 44, y - k * 7); g.lineTo(cx + 44, y - k * 7); g.stroke(); }
      g.fillStyle = css('--ink3'); g.fillText('（动画已大幅放慢；声速越快，脉冲到得越早）', 44, top + 36);
    });
  };

  // ---------------------------------------------------------- 5 振动管密度
  EXP.density = root => {
    const { ctlBox, out, fit } = setup(root);
    const c = ctrl(ctlBox, '硫酸浓度', 0, 100, 0.5, 40, ' wt%');
    // 近似密度表（20 °C 附近）：0→0.998 … 约 97–98 % 附近最大后略降
    const tab = [[0, 0.998], [10, 1.066], [20, 1.139], [30, 1.219], [40, 1.303], [50, 1.395], [60, 1.498], [70, 1.611], [80, 1.727], [90, 1.814], [96, 1.835], [98, 1.837], [100, 1.830]];
    const rho = x => { for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) { const [a, b] = [tab[i - 1], tab[i]]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return 1.83; };
    const m0 = 1.0, V = 1.0, k = (2 * Math.PI * 500) ** 2 * (m0 + 0.998 * V); // 示意：装水时 500 Hz
    const f = r => Math.sqrt(k / (m0 + r * V)) / (2 * Math.PI);
    let cur = 500;
    onAny([c], () => {
      const r = rho(c.v); cur = f(r);
      out.innerHTML = `密度 ρ ≈ <b>${r.toFixed(3)} g/cm³</b> → 振动频率 <b>${cur.toFixed(1)} Hz</b>（示意：装纯水时设为 500 Hz）。关系：f = (1/2π)·√(k / (m₀ + ρV))，所以 ρ = A/f² − B` +
        (c.v > 90 ? '<br><span class="warn">硫酸在约 97–98 % 附近密度出现最大值，峰附近灵敏度很低、且一个密度对应两个浓度 —— 浓硫酸常要配合折射率等另一种方法。</span>' : '');
    });
    anim(t => {
      if (!vis(root)) return;
      const { g, W, H } = fit(); g.clearRect(0, 0, W, H);
      const bx = 60, cy = H / 2, len = Math.min(W - 160, 420);
      g.fillStyle = '#888'; g.fillRect(bx - 30, cy - 50, 30, 100);
      const amp = 12, wv = cur / 500 * 3; // 慢放
      const off = amp * Math.sin(t * wv * 2 * Math.PI);
      g.strokeStyle = '#7fb3e6'; g.lineWidth = 12; g.lineCap = 'round';
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(bx, cy + s * 20); for (let i = 0; i <= 20; i++) { const x = i / 20; g.lineTo(bx + x * len, cy + s * 20 + off * x * x); } g.stroke(); }
      g.beginPath(); g.arc(bx + len, cy + off, 20, -Math.PI / 2, Math.PI / 2); g.stroke();
      g.fillStyle = css('--ink2'); g.font = '12px system-ui'; g.textAlign = 'left';
      g.fillText('固定端', bx - 32, cy + 68); g.fillText('U 形管（装满药液，慢放示意）', bx + len * 0.3, cy - 40);
      g.fillStyle = '#c86'; g.fillRect(bx + len + 26, cy - 10 + off, 10, 20);
      g.fillStyle = '#b74'; g.fillRect(bx + len + 40, cy - 18, 16, 36); g.fillStyle = css('--ink2'); g.fillText('励振/检测线圈', bx + len - 30, cy + 50);
    });
  };

  // ---------------------------------------------------------- 6 自动滴定
  EXP.titration = root => {
    const { ctlBox, out, fit } = setup(root);
    const Ca = ctrl(ctlBox, '样品中酸的浓度', 0.02, 0.2, 0.005, 0.1, ' mol/L', v => v.toFixed(3));
    const go = button(ctlBox, '▶ 开始滴定');
    const Va = 10, Cb = 0.1, Vmax = 30; // 取样 10 mL，NaOH 0.1 mol/L
    const pH = (vb, ca) => { const h = ca * Va - Cb * vb, Vt = Va + vb; if (Math.abs(h) < 1e-12) return 7; if (h > 0) return -Math.log10(h / Vt); return 14 + Math.log10(-h / Vt); };
    let prog = 1, t0 = 0;
    go.onclick = () => { prog = 0; t0 = performance.now(); };
    function draw() {
      const { g, W, H } = fit(); g.clearRect(0, 0, W, H);
      const x0 = 46, y0 = H - 34, w = W - 66, h = H - 66;
      axes(g, x0, y0, w, h, '加入的 NaOH 体积 / mL', 'pH');
      const X = v => x0 + v / Vmax * w, Y = p => y0 - p / 14 * h;
      const vEnd = Vmax * prog;
      g.strokeStyle = css('--accent'); g.lineWidth = 2; g.beginPath();
      for (let v = 0; v <= vEnd; v += 0.05) { const y = Y(Math.max(0, Math.min(14, pH(v, Ca.v)))); v ? g.lineTo(X(v), y) : g.moveTo(X(v), y); } g.stroke();
      const veq = Ca.v * Va / Cb;
      if (vEnd >= veq) { g.strokeStyle = '#e33'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(veq), y0); g.lineTo(X(veq), y0 - h); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#e33'; g.font = '12px system-ui'; g.textAlign = 'left'; g.fillText('终点（pH 突跃）', X(veq) + 4, y0 - h + 14); }
      out.innerHTML = vEnd >= veq
        ? `终点在 <b>${veq.toFixed(2)} mL</b> → 浓度 = 0.1 mol/L × ${veq.toFixed(2)} mL ÷ 10 mL = <b>${(Cb * veq / Va).toFixed(3)} mol/L</b>`
        : '点「开始滴定」，看 pH 曲线怎样在终点突然跳起来';
    }
    Ca.el.addEventListener('input', () => { prog = 1; draw(); }); window.addEventListener('resize', draw); draw();
    anim(() => { if (prog < 1) { prog = Math.min(1, (performance.now() - t0) / 4000); draw(); } });
  };

  // ---------------------------------------------------------- 7 臭氧 UV
  EXP.ozone = root => {
    const { ctlBox, out, fit } = setup(root);
    const c = ctrl(ctlBox, '溶存臭氧', 0, 40, 0.5, 10, ' mg/L');
    const L = ctrl(ctlBox, '光程长', 0.2, 5, 0.1, 1, ' cm');
    onAny([c, L], () => {
      const { g, W, H } = fit(); g.clearRect(0, 0, W, H);
      const eps = 3000, M = c.v / 48000, A = eps * M * L.v, Tr = Math.pow(10, -A);
      const x0 = 40, y = H / 2 - 20, cw = 60 + L.v * 50;
      g.fillStyle = '#a77cf0'; g.beginPath(); g.arc(x0, y, 14, 0, 7); g.fill();
      g.fillStyle = css('--ink2'); g.font = '12px system-ui'; g.textAlign = 'center'; g.fillText('汞灯 254 nm', x0, y + 34);
      const cx = x0 + 60;
      g.fillStyle = 'rgba(70,140,240,.25)'; g.fillRect(cx, y - 30, cw, 60); g.strokeStyle = '#6d8fc7'; g.strokeRect(cx, y - 30, cw, 60); g.fillStyle = css('--ink2');
      g.fillText('测量池', cx + cw / 2, y + 48);
      const grad = g.createLinearGradient(cx, 0, cx + cw, 0);
      grad.addColorStop(0, 'rgba(160,110,255,.95)'); grad.addColorStop(1, `rgba(160,110,255,${0.05 + 0.9 * Tr})`);
      g.fillStyle = 'rgba(160,110,255,.95)'; g.fillRect(x0 + 14, y - 5, cx - x0 - 14, 10);
      g.fillStyle = grad; g.fillRect(cx, y - 5, cw, 10);
      g.fillStyle = `rgba(160,110,255,${0.05 + 0.9 * Tr})`; g.fillRect(cx + cw, y - 5, 50, 10);
      g.fillStyle = '#222'; g.fillRect(cx + cw + 50, y - 16, 14, 32); g.fillStyle = css('--ink2'); g.fillText('检测器', cx + cw + 57, y + 34);
      const bx = Math.min(cx + cw + 110, W - 120), bh = 120;
      g.strokeStyle = css('--ink3'); g.strokeRect(bx, y - bh / 2, 30, bh);
      g.fillStyle = Tr < 0.05 ? '#e33' : (Tr > 0.95 ? '#e9a23b' : '#3aa776'); g.fillRect(bx, y + bh / 2 - bh * Tr, 30, bh * Tr);
      g.fillStyle = css('--ink2'); g.fillText('透过率', bx + 15, y + bh / 2 + 16); g.fillText((Tr * 100).toFixed(1) + '%', bx + 15, y - bh / 2 - 6);
      out.innerHTML = `吸光度 A = ε·c·L = 3000 × ${(M * 1e6).toFixed(1)} µmol/L × ${L.v} cm = <b>${A.toFixed(3)}</b>，透过率 <b>${(Tr * 100).toFixed(1)} %</b>` +
        (Tr < 0.05 ? '<br><span class="warn">光几乎全被吸收，检测器只剩噪声 —— 高浓度要换更短的测量池。</span>' :
         Tr > 0.97 ? '<br><span class="warn">几乎没吸收，信号淹没在噪声里 —— 低浓度要用更长的测量池。</span>' : '');
    });
  };

  // ---------------------------------------------------------- 8 隔膜电极
  EXP.membrane = root => {
    const { ctlBox, out, fit } = setup(root);
    const c = ctrl(ctlBox, '溶存气体浓度', 0, 1.6, 0.01, 0.8, ' mg/L', v => v.toFixed(2));
    const T = ctrl(ctlBox, '样水温度', 10, 40, 0.5, 25, ' °C');
    const foul = ctrl(ctlBox, '隔膜脏污程度', 0, 60, 1, 0, ' %');
    const comp = check(ctlBox, '启用温度补偿', true);
    let rate = 1;
    onAny([c, T, foul, comp], () => {
      const perm = Math.exp(0.03 * (T.v - 25)) * (1 - foul.v / 100); // 示意：透气性约 3 %/°C
      const I = c.v * perm, est = comp.v ? I / Math.exp(0.03 * (T.v - 25)) : I;
      rate = Math.max(0.05, I);
      out.innerHTML = `电流 ∝ 透过隔膜的气体量 → 读数 <b>${est.toFixed(2)} mg/L</b>（真值 ${c.v.toFixed(2)}）` +
        (foul.v > 5 ? '<br><span class="warn">隔膜被污染，透过的气体变少，读数偏低 —— 所以要定期更换隔膜/内液并重新校正。</span>' : '') +
        (!comp.v && T.v !== 25 ? '<br><span class="warn">温度高时隔膜更“透气”，不补偿会读高。</span>' : '');
    });
    const mols = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), p: Math.random() }));
    anim(t => {
      if (!vis(root)) return;
      const { g, W, H } = fit(); g.clearRect(0, 0, W, H);
      const my = H * 0.55;
      g.fillStyle = 'rgba(70,140,240,.2)'; g.fillRect(0, my, W, H - my);
      g.fillStyle = 'rgba(120,230,150,.2)'; g.fillRect(0, 30, W, my - 30);
      g.fillStyle = '#f0a040'; g.fillRect(0, my - 3, W, 6);
      g.fillStyle = '#bbb'; g.fillRect(W * 0.3, 36, W * 0.4, 10);
      g.fillStyle = css('--ink2'); g.font = '12px system-ui'; g.textAlign = 'left';
      g.fillText('铂电极（气体在这里反应 → 电流）', W * 0.3, 62); g.fillText('透气隔膜', 8, my - 8); g.fillText('样水', 8, H - 8); g.fillText('内部电解液', 8, 46);
      const n = Math.round(6 + c.v * 15);
      mols.slice(0, n).forEach(m => {
        const ph = (m.p + t * 0.12 * rate) % 1;
        const y = H - 10 - ph * (H - 60), x = W * (0.32 + 0.36 * m.x) + 6 * Math.sin(t * 2 + m.y * 9);
        g.fillStyle = y < my ? '#fff' : '#e8f4ff'; g.strokeStyle = '#678'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); g.stroke();
      });
    });
  };

  // ---------------------------------------------------------- 9 比电阻（超纯水）
  EXP.resist = root => {
    const { ctlBox, out, fit } = setup(root);
    const ppb = ctrl(ctlBox, '混入的 NaCl', 0, 50, 0.5, 0, ' ppb');
    const T = ctrl(ctlBox, '水温', 5, 50, 0.5, 25, ' °C');
    const comp = check(ctlBox, '换算到 25 °C（温度补偿）', true);
    const kw = t => 0.0550 * Math.exp(0.058 * (t - 25));        // 纯水本身（水的自偶电离），近似
    const kNa = (p, t) => p * 0.00216 * (1 + 0.021 * (t - 25)); // 1 ppb NaCl ≈ 0.00216 µS/cm（25 °C）
    onAny([ppb, T, comp], () => {
      const { g, W, H } = fit(); g.clearRect(0, 0, W, H);
      const kRaw = kw(T.v) + kNa(ppb.v, T.v);
      const k = comp.v ? kw(25) + kNa(ppb.v, 25) : kRaw;
      const R = 1 / k;
      const x0 = 30, w = W - 60, y = H / 2;
      const X = r => x0 + Math.log10(r / 0.5) / Math.log10(100 / 0.5) * w;
      const grad = g.createLinearGradient(x0, 0, x0 + w, 0); grad.addColorStop(0, '#e9a23b'); grad.addColorStop(0.7, '#9fd0ff'); grad.addColorStop(1, '#3a7bd5');
      g.fillStyle = grad; g.fillRect(x0, y - 10, w, 20);
      g.fillStyle = css('--ink2'); g.font = '12px system-ui'; g.textAlign = 'center';
      [0.5, 1, 2, 5, 10, 18.2, 50, 100].forEach(r => { g.fillText(r, X(r), y + 30); g.fillRect(X(r) - 0.5, y + 10, 1, 6); });
      g.fillText('比电阻 MΩ·cm（对数刻度）', x0 + w / 2, y + 50);
      g.fillStyle = '#e33'; g.beginPath(); g.moveTo(X(Math.min(100, R)), y - 12); g.lineTo(X(Math.min(100, R)) - 8, y - 26); g.lineTo(X(Math.min(100, R)) + 8, y - 26); g.fill();
      g.fillText(R.toFixed(2) + ' MΩ·cm', X(Math.min(100, R)), y - 32);
      out.innerHTML = `电导率 ${k.toFixed(4)} µS/cm → 比电阻 <b>${R.toFixed(2)} MΩ·cm</b>${comp.v ? '（25 °C 换算值）' : '（实测温度下的原始值）'}` +
        (ppb.v === 0 && comp.v ? '<br>理论纯水在 25 °C 是 18.2 MΩ·cm —— 这是“水自己电离”决定的上限。' : '') +
        (!comp.v && Math.abs(T.v - 25) > 2 ? '<br><span class="warn">水温一变，纯水自身的电离就变，读数大幅漂移 —— 所以表上显示的都是换算到 25 °C 的值。</span>' : '');
    });
  };

  window.initExperiments = () => document.querySelectorAll('.exp[data-exp]').forEach(el => EXP[el.dataset.exp] && EXP[el.dataset.exp](el));
})();
