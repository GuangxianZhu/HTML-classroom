// 原理小实验（纯 Canvas，无依赖）
// 物性数据用的是常见手册/文献的近似值；标了“示意”的参数只为表现趋势，不对应任何真实设备。
(function () {
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------------------------------------------------------------- 控件
  function ctrl(box, label, min, max, step, val, unit, fmt) {
    const w = document.createElement('label'); w.className = 'ctl';
    w.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}"><b></b>`;
    const inp = w.querySelector('input'), out = w.querySelector('b');
    const show = () => out.textContent = (fmt ? fmt(+inp.value) : (+inp.value)) + (unit || '');
    inp.addEventListener('input', show); show();
    box.appendChild(w);
    return { get v() { return +inp.value; }, el: inp };
  }
  function logctrl(box, label, min, max, val, unit, fmt) {
    const w = document.createElement('label'); w.className = 'ctl';
    w.innerHTML = `<span>${label}</span><input type="range" min="0" max="1000" step="1"><b></b>`;
    const inp = w.querySelector('input'), out = w.querySelector('b');
    const toV = p => min * Math.pow(max / min, p / 1000);
    inp.value = Math.round(1000 * Math.log(val / min) / Math.log(max / min));
    const show = () => out.textContent = (fmt ? fmt(toV(+inp.value)) : toV(+inp.value).toPrecision(3)) + (unit || '');
    inp.addEventListener('input', show); show();
    box.appendChild(w);
    return { get v() { return toV(+inp.value); }, el: inp };
  }
  function check(box, label, val) {
    const w = document.createElement('label'); w.className = 'ctl chk';
    w.innerHTML = `<input type="checkbox" ${val ? 'checked' : ''}><span>${label}</span>`;
    box.appendChild(w);
    const i = w.querySelector('input');
    return { get v() { return i.checked; }, el: i };
  }
  function select(box, label, opts, val) {
    const w = document.createElement('label'); w.className = 'ctl';
    w.innerHTML = `<span>${label}</span><select>${opts.map((o, i) => `<option value="${i}" ${i === val ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    box.appendChild(w);
    const s = w.querySelector('select');
    return { get v() { return +s.value; }, el: s };
  }
  function setup(root) {
    const cv = root.querySelector('canvas'), ctlBox = root.querySelector('.ctls'), out = root.querySelector('.readout');
    const fit = () => {
      const r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
      const w = Math.round(r.width * d), h = Math.round(r.height * d);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, r.width, r.height);
      return { g, W: r.width, H: r.height };
    };
    return { cv, ctlBox, out, fit };
  }
  function onAny(ctrls, fn) {
    ctrls.forEach(c => { c.el.addEventListener('input', () => fn()); c.el.addEventListener('change', () => fn()); });
    window.addEventListener('resize', () => fn()); fn();
  }
  function axes(g, x0, y0, w, h, xl, yl) {
    g.strokeStyle = css('--ink3'); g.lineWidth = 1; g.beginPath();
    g.moveTo(x0, y0 - h); g.lineTo(x0, y0); g.lineTo(x0 + w, y0); g.stroke();
    g.fillStyle = css('--ink2'); g.font = '12px system-ui,sans-serif';
    g.textAlign = 'right'; g.fillText(xl, x0 + w, y0 + 28);
    g.textAlign = 'left'; g.fillText(yl, x0 + 4, y0 - h - 6);
  }
  function plot(g, xs, f, X, Y, color, width, dash) {
    g.strokeStyle = color; g.lineWidth = width || 2; g.setLineDash(dash || []); g.beginPath();
    xs.forEach((x, i) => { const px = X(x), py = Y(f(x, i)); i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.stroke(); g.setLineDash([]);
  }
  function txt(g, s, x, y, color, align, size, bold) {
    g.fillStyle = color || css('--ink2'); g.textAlign = align || 'left';
    g.font = `${bold ? '700 ' : ''}${size || 12}px system-ui,sans-serif`; g.fillText(s, x, y);
  }
  function legend(g, items, x, y) {
    x = Math.max(8, x);
    items.forEach(([c, n, dash], i) => {
      g.strokeStyle = c; g.lineWidth = 2.5; g.setLineDash(dash || []);
      g.beginPath(); g.moveTo(x, y + i * 17); g.lineTo(x + 18, y + i * 17); g.stroke(); g.setLineDash([]);
      txt(g, n, x + 24, y + i * 17 + 4, css('--ink2'));
    });
  }
  const heatColor = T => { // 温度 → 颜色（示意）
    const t = clamp((T - 20) / 600, 0, 1);
    const r = Math.round(120 + 135 * Math.min(1, t * 2.2)), gg = Math.round(40 + 200 * Math.max(0, t - 0.35) / 0.65), b = Math.round(30 + 160 * Math.max(0, t - 0.75) / 0.25);
    return `rgb(${r},${gg},${b})`;
  };
  const loopers = [];
  const anim = fn => loopers.push(fn);
  (function tick(t) { loopers.forEach(f => f(t / 1000)); requestAnimationFrame(tick); })(0);
  const vis = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };

  const EXP = {};

  // ---------------------------------------------------------- 0 差 1 °C 有多大影响（阿伦尼乌斯）
  EXP.arrhenius = root => {
    const { ctlBox, out, fit } = setup(root);
    const Ea = ctrl(ctlBox, '活化能 Ea', 20, 100, 1, 50, ' kJ/mol');
    const T = ctrl(ctlBox, '工作温度', 20, 180, 1, 80, ' °C');
    const dT = ctrl(ctlBox, '温度波动 ±', 0.1, 5, 0.1, 1, ' °C', v => v.toFixed(1));
    onAny([Ea, T, dT], () => {
      const { g, W, H } = fit();
      const R = 8.314, Tk = T.v + 273.15, E = Ea.v * 1000;
      const rel = t => Math.exp(-E / R * (1 / (t + 273.15) - 1 / Tk));
      const x0 = 56, y0 = H - 40, w = W - 80, h = H - 70, lo = T.v - 10, hi = T.v + 10;
      const ymin = rel(lo) * 0.97, ymax = rel(hi) * 1.02;
      const X = t => x0 + (t - lo) / (hi - lo) * w, Y = r => y0 - (r - ymin) / (ymax - ymin) * h;
      g.fillStyle = 'rgba(233,138,26,.16)'; g.fillRect(X(T.v - dT.v), y0 - h, X(T.v + dT.v) - X(T.v - dT.v), h);
      axes(g, x0, y0, w, h, '温度 / °C', '相对反应速率（工作温度时 = 1）');
      for (let t = Math.ceil(lo / 2) * 2; t <= hi; t += 2) txt(g, t, X(t), y0 + 14, css('--ink3'), 'center');
      for (let r = Math.ceil(ymin * 10) / 10; r <= ymax; r += 0.1) { txt(g, r.toFixed(1), x0 - 6, Y(r) + 4, css('--ink3'), 'right'); g.fillStyle = '#eef1f6'; g.fillRect(x0 + 1, Y(r), w, 1); }
      const xs = []; for (let t = lo; t <= hi + 1e-9; t += 0.1) xs.push(t);
      plot(g, xs, rel, X, Y, css('--accent'), 2.5);
      [T.v - dT.v, T.v + dT.v].forEach(t => { g.fillStyle = css('--accent2'); g.beginPath(); g.arc(X(t), Y(rel(t)), 4.5, 0, 7); g.fill(); });
      g.fillStyle = css('--ink'); g.beginPath(); g.arc(X(T.v), Y(1), 4.5, 0, 7); g.fill();
      const s = E / (R * Tk * Tk) * 100;
      const up = (rel(T.v + dT.v) - 1) * 100, dn = (1 - rel(T.v - dT.v)) * 100;
      out.innerHTML = `在 ${T.v} °C 附近，温度每高 1 °C，反应速率约快 <b>${s.toFixed(1)} %</b>。温度波动 ±${dT.v.toFixed(1)} °C → 速率在 <b>−${dn.toFixed(1)} % ～ +${up.toFixed(1)} %</b> 之间晃。<br>如果要求“刻掉的量”误差不超过 1 %，单看温度这一项，就得控制在 <b>±${(1 / s).toFixed(2)} °C</b> 以内。`;
    });
  };

  // ---------------------------------------------------------- 1 浸入式：表面热流密度与空烧
  EXP.immersion = root => {
    const { ctlBox, out, fit } = setup(root);
    const q = ctrl(ctlBox, '表面功率密度', 0.5, 10, 0.1, 1.5, ' W/cm²', v => v.toFixed(1));
    const TL = ctrl(ctlBox, '药液温度', 20, 170, 1, 80, ' °C');
    const Tb = ctrl(ctlBox, '药液沸点', 100, 200, 1, 100, ' °C');
    const mode = select(ctlBox, '加热器周围', ['泡在液里，液体基本静止', '泡在液里，有循环流动', '液位太低，露出液面（空烧）'], 0);
    const Hc = [800, 3000, 15]; // W/m²·K 示意：自然对流 / 强制对流 / 空气
    let S = {};
    const calc = () => {
      const h = Hc[mode.v], dry = mode.v === 2;
      const Ts = TL.v + q.v * 1e4 / h;
      S = { h, dry, Ts, boil: !dry && Ts > Tb.v, qmax: (Tb.v - TL.v) * h / 1e4 };
      out.innerHTML = `加热器表面温度 ≈ 药液温度 + 功率密度 ÷ 传热系数 = ${TL.v} + ${(q.v * 1e4).toFixed(0)} ÷ ${h} ≈ <b>${S.Ts > 1500 ? '1500 °C 以上（算出来 ' + S.Ts.toFixed(0) + ' °C）' : S.Ts.toFixed(0) + ' °C'}</b>` +
        (S.dry ? `<br><span class="warn">空烧：周围是空气，传热系数只有液体的几十分之一，热量散不出去。按公式会冲到上千度——实际在那之前发热丝就烧断、石英管失透或炸裂。所以必须有液位联锁，液位一低就断电，而且不能只靠控温程序。</span>`
          : S.boil ? `<br><span class="warn">表面超过沸点 → 加热器表面局部沸腾冒泡（槽里整体还没沸腾）。气泡可能附着到晶圆上，或引起液面飞溅。</span>`
            : `<br>表面没到沸点，热量安静地交给药液。` ) +
        (S.dry ? '' : `<br>在这个液温、这种流动条件下，不想让表面沸腾，功率密度上限约 <b>${Math.max(0, S.qmax).toFixed(1)} W/cm²</b>。功率一定时，只能把加热器做得更长、面积更大。`);
    };
    const bubbles = Array.from({ length: 26 }, (_, i) => ({ x: Math.random(), p: Math.random(), s: 0.6 + Math.random() * 0.8 }));
    const draw = (t = 0) => {
      const { g, W, H } = fit();
      const narrow = W < 560;
      const tw = narrow ? W * 0.45 : Math.min(W * 0.58, 520), tx = 16, ty = 18, th = H - 46;
      // 槽
      g.strokeStyle = '#8fb3e0'; g.lineWidth = 3; g.strokeRect(tx, ty, tw, th);
      const lvl = S.dry ? ty + th - 26 : ty + 40;
      g.fillStyle = 'rgba(70,140,240,.22)'; g.fillRect(tx + 2, lvl, tw - 4, ty + th - lvl - 2);
      txt(g, S.dry ? '液面（太低了）' : '液面', tx + 8, lvl - 6, '#4a78c2');
      // 加热器（截面两根）
      const hy = ty + th - 46;
      [0.3, 0.7].forEach(fx => {
        const cx = tx + tw * fx;
        g.fillStyle = 'rgba(220,235,255,.9)'; g.beginPath(); g.arc(cx, hy, 20, 0, 7); g.fill();
        g.strokeStyle = '#9ab'; g.lineWidth = 1.5; g.stroke();
        g.fillStyle = heatColor(S.Ts); g.beginPath(); g.arc(cx, hy, 12, 0, 7); g.fill();
        if (!S.dry) for (let k = 0; k < 3; k++) { // 对流
          const yy = hy - 30 - ((t * 30 + k * 40) % 120);
          g.strokeStyle = `rgba(230,90,40,${0.45 - (hy - yy) / 400})`; g.lineWidth = 2; g.beginPath();
          g.moveTo(cx - 8, yy + 10); g.quadraticCurveTo(cx, yy - 2, cx + 8, yy + 10); g.stroke();
        }
      });
      txt(g, '发热段（截面）', tx + tw * 0.5, hy + 40, css('--ink2'), 'center');
      if (S.boil) bubbles.forEach(b => {
        const cx = tx + tw * (b.x < 0.5 ? 0.3 : 0.7) + (b.x % 0.5 - 0.25) * 50;
        const y = hy - 18 - ((t * 60 * b.s + b.p * 200) % (hy - lvl - 18));
        g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, y, 3 + 2 * b.s, 0, 7); g.stroke();
      });
      if (S.dry) { txt(g, '空气', tx + tw / 2, ty + 40, css('--ink3'), 'center', 13); }
      // 温度计
      const bx = tx + tw + (narrow ? 50 : 70), bw = narrow ? 18 : 26, by = ty + 8, bh = th - 30, Tmax = 400;
      const Yt = T => by + bh - clamp(T, 0, Tmax) / Tmax * bh;
      const grd = g.createLinearGradient(0, by + bh, 0, by); grd.addColorStop(0, '#cfe3ff'); grd.addColorStop(0.5, '#ffd59a'); grd.addColorStop(1, '#ff6a3a');
      g.fillStyle = grd; g.fillRect(bx, by, bw, bh); g.strokeStyle = '#aab'; g.strokeRect(bx, by, bw, bh);
      for (let T = 0; T <= Tmax; T += 50) { txt(g, T + ' °C', bx - 6, Yt(T) + 4, css('--ink3'), 'right', 11); }
      const marks = [[TL.v, `药液 ${TL.v} °C`, '#2a5bb0'], [Tb.v, `沸点 ${Tb.v} °C`, '#2f9e6a']];
      if (S.Ts <= Tmax) marks.push([S.Ts, `${narrow ? '表面' : '加热器表面'} ${S.Ts.toFixed(0)} °C`, css('--warn')]);
      else txt(g, `↑ 表面 ${S.Ts > 1500 ? '>1500' : S.Ts.toFixed(0)} °C`, bx + bw + 10, by + 12, css('--warn'), 'left', 13, true);
      marks.sort((a, b) => a[0] - b[0]);
      let lastY = 1e9;
      marks.forEach(([T, label, c]) => {   // 标签彼此挤开，不重叠
        const y = Yt(T); g.fillStyle = c; g.fillRect(bx - 4, y - 1, bw + 8, 2.5);
        const ly = Math.min(y + 4, lastY - 15); lastY = ly;
        txt(g, label, bx + bw + 10, ly, c, 'left', 12, true);
      });
    };
    onAny([q, TL, Tb, mode], () => { calc(); draw(performance.now() / 1000); });
    anim(t => { if (vis(root) && (S.boil || !S.dry)) draw(t); });
  };

  // ---------------------------------------------------------- 2 贴壁式：热要先穿过石英壁
  EXP.wall = root => {
    const { ctlBox, out, fit } = setup(root);
    const P = ctrl(ctlBox, '加热器功率', 500, 4000, 50, 2000, ' W');
    const t = ctrl(ctlBox, '石英壁厚', 2, 12, 0.5, 6, ' mm');
    const V = ctrl(ctlBox, '药液量', 10, 60, 1, 30, ' L');
    const SV = 80, LIM = 200; // 设定 80 °C；加热片表面上限 200 °C（示意）
    onAny([P, t, V], () => {
      const { g, W, H } = fit();
      const A = 0.3, k = 1.4, hin = 500, Ta = 25, G0 = 6;
      const Cw = 2200 * 750 * A * (t.v / 1000) + 600;
      const G = 1 / ((t.v / 1000) / (k * A) + 1 / (hin * A));
      const Cl = V.v * 4180;
      let Tw = Ta, Tl = Ta, on = true, ts = null, trip = false, Twmax = Ta, Tlmax = Ta;
      const dt = 2, tEnd = Math.max(3600, 1.9 * Cl * (SV - Ta) / Math.max(200, P.v - 300));
      const rec = [];
      for (let s = 0; s <= tEnd; s += dt) {
        if (Tl >= SV) on = false; else if (Tl < SV - 0.3) on = true;
        let p = on ? P.v : 0;
        if (Tw > LIM) { p = 0; trip = true; }
        const qw = G * (Tw - Tl);
        Tw += (p - qw) / Cw * dt;
        Tl += (qw - G0 * (Tl - Ta)) / Cl * dt;
        if (ts === null && Tl >= SV - 0.05) ts = s;
        Twmax = Math.max(Twmax, Tw); if (ts !== null) Tlmax = Math.max(Tlmax, Tl);
        if (s % 20 === 0) rec.push([s / 60, Tl, Tw, on]);
      }
      const x0 = 50, y0 = H - 40, w = W - 150, h = H - 64, tm = tEnd / 60;
      const Ymax = Math.max(140, Math.ceil(Math.min(Twmax, 260) / 20) * 20 + 10);
      const X = m => x0 + m / tm * w, Y = T => y0 - (T - 20) / (Ymax - 20) * h;
      axes(g, x0, y0, w, h, '时间 / 分钟', '温度 / °C');
      for (let T = 20; T <= Ymax; T += 20) { txt(g, T, x0 - 6, Y(T) + 4, css('--ink3'), 'right'); g.fillStyle = '#eef1f6'; g.fillRect(x0 + 1, Y(T), w, 1); }
      const stepM = (tm > 150 ? 30 : tm > 60 ? 15 : 10) * (w < 400 ? 2 : 1);
      for (let m = 0; m <= tm; m += stepM) txt(g, m, X(m), y0 + 14, css('--ink3'), 'center');
      g.setLineDash([4, 4]); g.strokeStyle = '#2f9e6a'; g.beginPath(); g.moveTo(x0, Y(SV)); g.lineTo(x0 + w, Y(SV)); g.stroke();
      g.strokeStyle = css('--warn'); g.beginPath(); g.moveTo(x0, Y(LIM)); g.lineTo(x0 + w, Y(LIM)); g.stroke(); g.setLineDash([]);
      txt(g, '设定 80 °C', x0 + w + 6, Y(SV) + 4, '#2f9e6a');
      txt(g, '加热片上限（示意）', x0 + w + 6, Y(LIM) + 4, css('--warn'));
      const xs = rec.map((_, i) => i);
      plot(g, xs, i => rec[i][2], i => X(rec[i][0]), Y, '#e0793a', 1.6);
      plot(g, xs, i => rec[i][1], i => X(rec[i][0]), Y, css('--accent'), 2.6);
      legend(g, [[css('--accent'), '药液温度'], ['#e0793a', '加热片 / 槽壁温度']], x0 + w - 170, y0 - h + 12);
      const dTw = P.v / G;
      out.innerHTML = `升到 80 °C 用时约 <b>${ts === null ? '（没升到）' : (ts / 60).toFixed(0) + ' 分钟'}</b>；全功率时加热片要比药液高约 <b>${dTw.toFixed(0)} °C</b>（热穿过石英壁的“落差”）；加热片最高 <b>${Twmax.toFixed(0)} °C</b>；断电后药液还会再涨 <b>${Math.max(0, Tlmax - SV).toFixed(1)} °C</b>（槽壁里存的热继续往里走）。` +
        (trip ? `<br><span class="warn">加热片表面超过上限，保护动作切断了功率（图里加热片曲线在 200 °C 附近被削平）。壁太厚或功率太大，热“堵”在槽壁外面。</span>` : '') +
        `<br>趋势：壁越厚 → 落差越大、加热片越烫、过冲越大；药液越多 → 升温越慢，但温度也越“稳”。`;
    });
  };

  // ---------------------------------------------------------- 3 红外灯：灯丝温度、石英、水的吸收
  // 水的吸收系数（cm⁻¹）近似值，据 Hale & Querry (1973) 等文献的数量级做的对数插值
  const WATER = [[0.3, 0.0004], [0.5, 0.0003], [0.6, 0.002], [0.7, 0.006], [0.75, 0.026], [0.8, 0.02], [0.85, 0.043], [0.9, 0.068],
    [0.95, 0.39], [0.98, 0.48], [1.05, 0.2], [1.1, 0.2], [1.15, 0.6], [1.2, 1.0], [1.3, 1.5], [1.35, 5], [1.4, 13], [1.45, 29], [1.5, 20],
    [1.6, 6.7], [1.7, 5], [1.8, 8], [1.9, 70], [1.94, 114], [2.0, 69], [2.1, 25], [2.2, 15], [2.3, 22], [2.4, 50], [2.5, 110], [2.6, 300],
    [2.7, 1200], [2.8, 5000], [2.9, 11000], [3.0, 11400], [3.2, 3500], [3.4, 900], [3.6, 300], [3.8, 120], [4.0, 145], [4.5, 330], [5.0, 125]];
  const alphaW = l => {
    for (let i = 0; i < WATER.length - 1; i++) {
      const [a, va] = WATER[i], [b, vb] = WATER[i + 1];
      if (l <= b) return Math.exp(Math.log(va) + (Math.log(vb) - Math.log(va)) * (l - a) / (b - a));
    }
    return WATER[WATER.length - 1][1];
  };
  const tauQ = l => (l < 0.2 ? 0 : l < 3.5 ? 0.92 : l < 4.5 ? 0.92 * (4.5 - l) : 0) * (1 - 0.3 * Math.exp(-((l - 2.73) ** 2) / (2 * 0.04 * 0.04)));
  const planck = (l, T) => Math.pow(l, -5) / (Math.exp(14388 / (l * T)) - 1);
  EXP.lamp = root => {
    const { ctlBox, out, fit } = setup(root);
    const T = ctrl(ctlBox, '灯丝温度', 1200, 3200, 50, 2600, ' K');
    const d = ctrl(ctlBox, '水层厚度', 1, 40, 1, 8, ' mm');
    const refl = check(ctlBox, '外面加反射罩（光再过一次水）', true);
    onAny([T, d, refl], () => {
      const { g, W, H } = fit();
      const ls = []; for (let l = 0.3; l <= 5.0001; l += 0.01) ls.push(l);
      const L = d.v / 10 * (refl.v ? 2 : 1);
      const emit = ls.map(l => planck(l, T.v));
      const thru = ls.map((l, i) => emit[i] * tauQ(l));
      const abs = ls.map((l, i) => thru[i] * (1 - Math.exp(-alphaW(l) * L)));
      const sum = a => a.reduce((s, v) => s + v, 0);
      const fq = sum(thru) / sum(emit), fa = sum(abs) / sum(thru);
      const mx = Math.max(...emit);
      const x0 = 46, y0 = H - 40, w = W - 100, h = H - 72;
      const X = l => x0 + (l - 0.3) / 4.7 * w, Y = v => y0 - v / mx * h;
      g.fillStyle = 'rgba(120,120,140,.12)'; g.fillRect(X(3.6), y0 - h, X(5) - X(3.6), h);
      txt(g, '石英基本不透明', X(4.3), y0 - h + 14, css('--ink3'), 'center');
      const narrow = W < 560;
      axes(g, x0, y0, w, h, '波长 / µm', narrow ? '光谱强度（示意）' : '光谱强度（各自最大值归一，示意）');
      for (let l = 0.5; l <= 5; l += 0.5) txt(g, l.toFixed(1), X(l), y0 + 14, css('--ink3'), 'center');
      g.fillStyle = 'rgba(233,120,40,.42)'; g.beginPath(); g.moveTo(X(0.3), y0);
      ls.forEach((l, i) => g.lineTo(X(l), Y(abs[i]))); g.lineTo(X(5), y0); g.fill();
      plot(g, ls, (l, i) => emit[i], X, Y, '#b9a46a', 1.5, [5, 4]);
      plot(g, ls, (l, i) => thru[i], X, Y, '#d08a1c', 2);
      // 水的吸收系数（对数，右轴）
      const Ya = a => y0 - (Math.log10(a) + 4) / 9 * h;
      plot(g, ls, l => alphaW(l), X, Ya, '#3a7bd5', 1.5);
      [0.001, 0.1, 10, 1000].forEach(a => txt(g, a >= 1 ? a : a.toString(), x0 + w + 8, Ya(a) + 4, '#3a7bd5', 'left', 11));
      txt(g, narrow ? '水吸收 cm⁻¹' : '水的吸收系数 cm⁻¹（对数）', x0 + w + 4, y0 - h - 6, '#3a7bd5', 'right', 11);
      const lp = 2898 / T.v;
      g.strokeStyle = css('--ink3'); g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(lp), y0); g.lineTo(X(lp), y0 - h); g.stroke(); g.setLineDash([]);
      txt(g, `峰值 ${lp.toFixed(2)} µm`, X(lp) + 4, y0 - h + 30, css('--ink2'));
      if (!narrow) legend(g, [['#b9a46a', '灯丝发出的光', [5, 4]], ['#d08a1c', '穿过石英后'], ['rgba(233,120,40,.7)', '被水吸收的部分（填色）'], ['#3a7bd5', '水的吸收系数']], x0 + w - 260, y0 - h + 50);
      out.innerHTML = (narrow ? '<span class="cap">黄虚线 = 灯丝发出的光，橙线 = 穿过石英后，橙色填充 = 被水吸收，蓝线 = 水的吸收系数（右轴，对数）</span><br>' : '') + `灯丝 ${T.v} K，光谱峰在 <b>${lp.toFixed(2)} µm</b>（维恩定律 2898 ÷ T）。穿过石英的部分占 <b>${(fq * 100).toFixed(0)} %</b>（其余被石英吸收，变成石英管的热，再间接传给水）；穿过来的光里有 <b>${(fa * 100).toFixed(0)} %</b> 在${refl.v ? '来回两趟、共 ' + (L * 10).toFixed(0) + ' mm 的' : ' ' + (L * 10).toFixed(0) + ' mm '}水里被吸收。` +
        (fa < 0.5 ? `<br><span class="warn">吸收不到一半：灯丝越热，光越偏向水比较“透明”的 1 µm 附近，会穿过水层打到外面。要么水层厚一点、加反射罩，要么降低灯丝温度（光谱往长波移）。</span>` : '') +
        `<br>注意：吸收不完的光不是凭空消失，会打到反射罩、外壳上变成热——所以外壳和端部也要冷却。`;
    });
  };

  // ---------------------------------------------------------- 4 氟树脂包覆加热棒：一层一层的温度落差
  EXP.sheath = root => {
    const { ctlBox, out, fit } = setup(root);
    const q = ctrl(ctlBox, '表面功率密度', 0.5, 8, 0.1, 2, ' W/cm²', v => v.toFixed(1));
    const tp = ctrl(ctlBox, 'PFA 厚度', 0.2, 2.5, 0.05, 0.6, ' mm', v => v.toFixed(2));
    const TL = ctrl(ctlBox, '药液温度', 20, 180, 1, 80, ' °C');
    const hh = logctrl(ctlBox, '流动强度（对流传热系数）', 300, 8000, 2000, ' W/m²K', v => v.toFixed(0));
    const LIM = 260;
    onAny([q, tp, TL, hh], () => {
      const { g, W, H } = fit();
      const Q = q.v * 1e4;
      const nr = W < 560;
      const layers = [ // [名称, 热阻 m²K/W, 颜色, 视觉宽度]
        [nr ? '氧化镁' : '氧化镁粉 1.5 mm', 0.0015 / 2.5, '#f2f2ee', 1.2],
        [nr ? '护套' : '金属护套 0.8 mm', 0.0008 / 16, '#c4c7cc', 0.8],
        [nr ? 'PFA' : `PFA ${tp.v.toFixed(2)} mm`, tp.v / 1000 / 0.2, '#f6f2e6', 1.4],
        [nr ? '液膜' : '液膜（边界层）', 1 / hh.v, 'rgba(120,170,240,.25)', 1.0],
      ];
      const Ts = [TL.v]; // 从药液往里推
      for (let i = layers.length - 1; i >= 0; i--) Ts.unshift(Ts[0] + Q * layers[i][1]);
      // Ts[0]=发热丝, Ts[1]=MgO/护套界面, Ts[2]=护套/PFA, Ts[3]=PFA/液膜, Ts[4]=药液
      const x0 = 70, y0 = H - 46, w = W - 100, h = H - 80;
      const tot = layers.reduce((s, l) => s + l[3], 0) + 0.8;
      const Tmax = Math.max(300, Math.ceil(Ts[0] / 50) * 50 + 20);
      const Y = T => y0 - (T - 0) / Tmax * h;
      let xx = x0 + 0.35 * w / tot;
      const xs = [x0, xx];
      g.fillStyle = '#ffd2b8'; g.fillRect(x0, y0 - h, xx - x0, h); txt(g, nr ? '丝' : '发热丝', (x0 + xx) / 2, y0 + 16, css('--ink2'), 'center');
      layers.forEach(([n, r, c, vw], i) => {
        const nx = xx + vw * w / tot;
        g.fillStyle = c; g.fillRect(xx, y0 - h, nx - xx, h); g.strokeStyle = '#d5d9e2'; g.strokeRect(xx, y0 - h, nx - xx, h);
        txt(g, n, (xx + nx) / 2, y0 + 16, css('--ink2'), 'center', 11.5);
        xx = nx; xs.push(nx);
      });
      g.fillStyle = 'rgba(70,140,240,.25)'; g.fillRect(xx, y0 - h, x0 + w - xx, h); txt(g, '药液', (xx + x0 + w) / 2, y0 + 16, css('--ink2'), 'center');
      for (let T = 0; T <= Tmax; T += 50) txt(g, T + ' °C', x0 - 6, Y(T) + 4, css('--ink3'), 'right', 11);
      g.setLineDash([5, 4]); g.strokeStyle = css('--warn'); g.beginPath(); g.moveTo(x0, Y(LIM)); g.lineTo(x0 + w, Y(LIM)); g.stroke(); g.setLineDash([]);
      txt(g, nr ? 'PFA 上限 260 °C' : 'PFA 连续使用上限 约 260 °C', x0 + w - 6, Y(LIM) - 6, css('--warn'), 'right');
      const pts = [[x0, Ts[0]], [xs[1], Ts[0]], [xs[2], Ts[1]], [xs[3], Ts[2]], [xs[4], Ts[3]], [xs[5], Ts[4]], [x0 + w, Ts[4]]];
      g.strokeStyle = '#d23'; g.lineWidth = 3; g.beginPath(); pts.forEach(([x, T], i) => i ? g.lineTo(x, Y(T)) : g.moveTo(x, Y(T))); g.stroke();
      pts.slice(1, 6).forEach(([x, T]) => { g.fillStyle = '#d23'; g.beginPath(); g.arc(x, Y(T), 3.5, 0, 7); g.fill(); });
      txt(g, `${Ts[0].toFixed(0)} °C`, xs[1] - 4, Y(Ts[0]) - 8, '#d23', 'right', 12, true);
      txt(g, `PFA 内侧 ${Ts[2].toFixed(0)} °C`, xs[3] + 6, Y(Ts[2]) - 8, Ts[2] > LIM ? css('--warn') : css('--ink'), 'left', 12, true);
      txt(g, `接液面 ${Ts[3].toFixed(0)} °C`, xs[4] + 6, Y(Ts[3]) - 8, css('--ink'), 'left', 12);
      const dP = Ts[2] - Ts[3], dAll = Ts[0] - Ts[4];
      const qmax = (LIM - TL.v) / (tp.v / 1000 / 0.2 + 1 / hh.v) / 1e4;
      out.innerHTML = `从发热丝到药液总共落差 <b>${dAll.toFixed(0)} °C</b>，其中光 PFA 这一层就占 <b>${(dP / dAll * 100).toFixed(0)} %</b>（氟树脂导热只有不锈钢的约 1/80）。PFA 最热的地方（内侧）<b>${Ts[2].toFixed(0)} °C</b>。` +
        (Ts[2] > LIM ? `<br><span class="warn">超过 PFA 的耐温上限：会软化、变形，药液和气体也更容易渗透进去。</span>` : '') +
        `<br>在这个液温和流动条件下，PFA 不超限的最大功率密度约 <b>${Math.max(0, qmax).toFixed(1)} W/cm²</b>。所以氟树脂加热器通常“又长又粗、功率密度低”，并靠流速把液膜热阻压下来。`;
    });
  };

  // ---------------------------------------------------------- 5 感应加热：趋肤深度
  EXP.induction = root => {
    const { ctlBox, out, fit } = setup(root);
    const MATS = [['不锈钢 SUS304', 7.2e-7], ['石墨（碳）', 1.0e-5], ['铜', 1.7e-8], ['导电性很好的药液（约 50 S/m，示意）', 0.02], ['超纯水（18 MΩ·cm）', 1.8e5]];
    const f = logctrl(ctlBox, '频率', 1e3, 5e5, 3e4, '', v => v >= 1e3 ? (v / 1e3).toFixed(v < 1e4 ? 1 : 0) + ' kHz' : v.toFixed(0) + ' Hz');
    const mt = select(ctlBox, '被加热的东西', MATS.map(m => m[0]), 0);
    const th = ctrl(ctlBox, '发热体厚度', 0.1, 10, 0.1, 1.5, ' mm', v => v.toFixed(1));
    const fmtL = m => m < 1e-3 ? (m * 1e6).toFixed(0) + ' µm' : m < 1 ? (m * 1e3).toFixed(2) + ' mm' : m < 1000 ? m.toFixed(1) + ' m' : (m / 1000).toFixed(1) + ' km';
    onAny([f, mt, th], () => {
      const { g, W, H } = fit();
      const rho = MATS[mt.v][1], mu0 = 4e-7 * Math.PI;
      const delta = Math.sqrt(rho / (Math.PI * f.v * mu0));
      const d = th.v / 1000, ratio = d / delta;
      const absorb = 1 - Math.exp(-2 * ratio);
      // 左：线圈 — 树脂管壁 — 发热体截面（板厚画成固定宽度，颜色 = 发热强度）
      const x0 = 30, y0 = 34, hh = H - 90;
      txt(g, '线圈 →', x0, y0 + hh / 2, '#c0702c', 'left', 13, true);
      g.fillStyle = '#f2efe6'; g.fillRect(x0 + 60, y0, 26, hh); txt(g, '树脂管壁', x0 + 73, y0 - 8, css('--ink3'), 'center', 11);
      const ex = x0 + 104, dpx = Math.min(170, W * 0.22), N = 100;
      const Aw = clamp(absorb / 0.6, 0.02, 1);   // 颜色深浅再乘上“接住磁场的程度”，否则纯水也会被画成很热
      for (let i = 0; i < N; i++) {
        const jj = Math.exp(-2 * (i / N * d) / delta) * Aw;
        g.fillStyle = `rgba(255,${Math.round(220 - 160 * jj)},${Math.round(160 - 140 * jj)},${0.25 + 0.75 * jj})`;
        g.fillRect(ex + i / N * dpx, y0, dpx / N + 1, hh);
      }
      g.strokeStyle = '#888'; g.lineWidth = 1; g.strokeRect(ex, y0, dpx, hh);
      txt(g, '发热体截面', ex + dpx / 2, y0 - 8, css('--ink3'), 'center', 11);
      txt(g, `${MATS[mt.v][0].split('（')[0]}，厚 ${th.v.toFixed(1)} mm`, ex + dpx / 2, y0 + hh + 18, css('--ink2'), 'center', 12);
      if (delta < d) {
        const dx = delta / d * dpx;
        g.setLineDash([5, 4]); g.strokeStyle = css('--accent'); g.beginPath(); g.moveTo(ex + dx, y0); g.lineTo(ex + dx, y0 + hh); g.stroke(); g.setLineDash([]);
        txt(g, 'δ', ex + dx + 4, y0 + 16, css('--accent'), 'left', 13, true);
      }
      // 右：发热强度随深度
      const gx = ex + dpx + 80, gw = W - gx - 24;
      if (gw > 140) {
        const gy0 = y0 + hh, gh = hh - 8, Dm = Math.max(d, Math.min(3 * delta, 4 * d));
        const GX = x => gx + x / Dm * gw;
        if (d < Dm) { g.fillStyle = 'rgba(120,120,140,.13)'; g.fillRect(GX(d), gy0 - gh, gw - (GX(d) - gx), gh); txt(g, '板子外面（没有材料）', GX(d) + 6, gy0 - gh + 14, css('--ink3'), 'left', 11); }
        axes(g, gx, gy0, gw, gh, '离线圈侧表面的深度', '发热强度（形状 ∝ e^(−2x/δ)，示意）');
        const xs = []; for (let i = 0; i <= 100; i++) xs.push(i / 100 * Math.min(d, Dm));
        plot(g, xs, x => Math.exp(-2 * x / delta) * Aw, GX, v => gy0 - v * gh * 0.85, '#e0793a', 2.4);
        if (delta < Dm) {
          g.setLineDash([5, 4]); g.strokeStyle = css('--accent'); g.beginPath(); g.moveTo(GX(delta), gy0); g.lineTo(GX(delta), gy0 - gh * 0.9); g.stroke(); g.setLineDash([]);
          txt(g, `δ = ${fmtL(delta)}`, GX(delta) + 4, gy0 - gh * 0.55, css('--accent'), 'left', 12, true);
        } else txt(g, `δ = ${fmtL(delta)}（远比板子厚）`, gx + gw - 4, gy0 - gh * 0.55, css('--accent'), 'right', 12, true);
        txt(g, '0', gx, gy0 + 14, css('--ink3'), 'center', 11);
        txt(g, `${(Dm * 1000).toFixed(Dm < 0.01 ? 1 : 0)} mm`, gx + gw, gy0 + 14, css('--ink3'), 'right', 11);
      }
      const verdict = rho > 1 ? '<span class="warn">几乎不被加热：电阻太大，感应出来的电流微乎其微。这正是“只加热发热体、不直接加热纯水”的原因。</span>'
        : rho > 1e-3 ? '<span class="warn">药液本身会有一点点感应发热，但趋肤深度有几十厘米，磁场几乎全穿过去，效率很低。实际是靠专门的导电发热体。</span>'
          : ratio < 0.3 ? '<span class="warn">发热体比趋肤深度薄太多：大部分磁场穿过去了，没被“接住”。可以提高频率或加厚。</span>'
            : ratio > 6 ? '发热集中在面向线圈的极薄表层；再厚也没用，多出来的厚度只是结构强度。'
              : '厚度和趋肤深度相当：磁场被有效“接住”，热量产生在发热体里。';
      out.innerHTML = `趋肤深度 δ = √(ρ ÷ (π·f·μ₀)) = <b>${fmtL(delta)}</b>；发热体厚度 / δ = <b>${ratio < 0.01 ? ratio.toExponential(1) : ratio.toFixed(2)}</b>；粗略的“接住磁场”程度约 <b>${(absorb * 100).toFixed(0)} %</b>（示意）。<br>${verdict}`;
    });
  };

  // ---------------------------------------------------------- 6 换热器：逆流 vs 顺流
  EXP.hx = root => {
    const { ctlBox, out, fit } = setup(root);
    const Fc = ctrl(ctlBox, '药液流量', 2, 30, 1, 10, ' L/min');
    const Fu = ctrl(ctlBox, '热媒流量', 2, 40, 1, 20, ' L/min');
    const Tu = ctrl(ctlBox, '热媒入口温度', 5, 95, 1, 90, ' °C');
    const Tc = ctrl(ctlBox, '药液入口温度', 10, 90, 1, 25, ' °C');
    const n = ctrl(ctlBox, 'PFA 细管根数（1 m 长）', 20, 300, 10, 120, ' 根');
    const wall = ctrl(ctlBox, '管壁厚', 0.2, 1.5, 0.05, 0.5, ' mm', v => v.toFixed(2));
    const counter = check(ctlBox, '逆流（两边反方向流）', true);
    onAny([Fc, Fu, Tu, Tc, n, wall, counter], () => {
      const { g, W, H } = fit();
      const cp = 4180, Cc = Fc.v / 60 * cp, Cu = Fu.v / 60 * cp;
      const hi = 1500, ho = 3000, k = 0.2;
      const Rw = wall.v / 1000 / k, U = 1 / (1 / hi + Rw + 1 / ho);
      const A = n.v * Math.PI * 0.006 * 1.0, UA = U * A;
      const Cmin = Math.min(Cc, Cu), Cmax = Math.max(Cc, Cu), Cr = Cmin / Cmax, NTU = UA / Cmin;
      let eps;
      if (counter.v) eps = Math.abs(1 - Cr) < 1e-6 ? NTU / (1 + NTU) : (1 - Math.exp(-NTU * (1 - Cr))) / (1 - Cr * Math.exp(-NTU * (1 - Cr)));
      else eps = (1 - Math.exp(-NTU * (1 + Cr))) / (1 + Cr);
      const Q = eps * Cmin * (Tu.v - Tc.v); // >0 = 药液被加热
      const TcOut = Tc.v + Q / Cc, TuOut = Tu.v - Q / Cu;
      // 沿管长积分画温度分布（药液从 x=0 流向 x=1）
      const N = 200, pc = [Tc.v], pu = [counter.v ? TuOut : Tu.v];
      for (let i = 0; i < N; i++) {
        const dq = UA / N * (pu[i] - pc[i]);
        pc.push(pc[i] + dq / Cc);
        pu.push(pu[i] + (counter.v ? dq / Cu : -dq / Cu));
      }
      const x0 = 50, y0 = H - 44, w = W - 170, h = H - 74;
      const lo = Math.min(Tc.v, Tu.v) - 5, hiT = Math.max(Tc.v, Tu.v) + 5;
      const X = i => x0 + i / N * w, Y = T => y0 - (T - lo) / (hiT - lo) * h;
      axes(g, x0, y0, w, h, '位置：药液入口 → 药液出口', '温度 / °C');
      for (let T = Math.ceil(lo / 10) * 10; T <= hiT; T += 10) { txt(g, T, x0 - 6, Y(T) + 4, css('--ink3'), 'right'); g.fillStyle = '#eef1f6'; g.fillRect(x0 + 1, Y(T), w, 1); }
      const idx = pc.map((_, i) => i);
      const uc = Tu.v >= Tc.v ? '#d9534f' : '#3a7bd5';
      plot(g, idx, i => pu[i], X, Y, uc, 2.4, [6, 4]);
      plot(g, idx, i => pc[i], X, Y, '#2f9e6a', 2.8);
      // 流向箭头
      const arrow = (x, y, dir, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(x + 8 * dir, y); g.lineTo(x - 6 * dir, y - 6); g.lineTo(x - 6 * dir, y + 6); g.fill(); };
      [0.25, 0.5, 0.75].forEach(f => { arrow(X(f * N), Y(pc[Math.round(f * N)]), 1, '#2f9e6a'); arrow(X(f * N), Y(pu[Math.round(f * N)]), counter.v ? -1 : 1, uc); });
      txt(g, `药液出口 ${TcOut.toFixed(1)} °C`, x0 + w + 6, Y(TcOut) + 4, '#2f9e6a', 'left', 12, true);
      txt(g, `热媒${counter.v ? '入口' : '出口'} ${(counter.v ? Tu.v : TuOut).toFixed(1)} °C`, x0 + w + 6, Y(counter.v ? Tu.v : TuOut) + (Math.abs(TcOut - (counter.v ? Tu.v : TuOut)) < 4 ? 18 : 4), uc, 'left', 12);
      if (w >= 300) legend(g, [['#2f9e6a', '药液（管内）'], [uc, Tu.v >= Tc.v ? '温水（管外）' : '冷却水（管外）', [6, 4]]], x0 + w - 150, y0 - 44);
      const wallShare = Rw / (1 / hi + Rw + 1 / ho) * 100;
      out.innerHTML = `${Q >= 0 ? '加热' : '冷却'}功率 <b>${Math.abs(Q / 1000).toFixed(2)} kW</b>，药液 ${Tc.v} → <b>${TcOut.toFixed(1)} °C</b>。总传热系数 U ≈ ${U.toFixed(0)} W/m²K，其中 <b>${wallShare.toFixed(0)} %</b> 的热阻在 PFA 管壁上；换热面积 ${A.toFixed(2)} m²。` +
        `<br>药液出口最多只能接近热媒入口温度（${Tu.v} °C），永远到不了也超不过——所以换热器<b>天生不会把药液烧过头</b>，这是它的安全感来源。` +
        (!counter.v ? '<br><span class="warn">顺流：两股流体在出口处趋于同一个温度，药液出口被卡在“中间值”，同样面积换热量更少。</span>' : '');
    });
  };

  // ---------------------------------------------------------- 7 珀耳帖：电流方向 = 加热还是冷却
  EXP.peltier = root => {
    const { ctlBox, out, fit } = setup(root);
    const I = ctrl(ctlBox, '电流（负 = 反向）', -6, 6, 0.1, 3, ' A', v => v.toFixed(1));
    const Tl = ctrl(ctlBox, '药液侧温度', 5, 60, 1, 20, ' °C');
    const Tw = ctrl(ctlBox, '冷却水侧温度', 15, 40, 1, 25, ' °C');
    const N = ctrl(ctlBox, '模块数', 1, 12, 1, 4, ' 块');
    const S = 0.05, R = 2.0, K = 0.5; // 典型 127 对碲化铋模块的量级（示意）
    onAny([I, Tl, Tw, N], () => {
      const { g, W, H } = fit();
      const Tc = Tl.v + 273.15, Th = Tw.v + 273.15;
      const Qc = i => N.v * (S * i * Tc - 0.5 * i * i * R - K * (Th - Tc));   // 从药液侧抽走的热（>0 冷却）
      const Pe = i => N.v * (S * i * (Th - Tc) + i * i * R);                 // 电功率
      const x0 = 56, y0 = H / 2 + 10, w = W - 120, h = H / 2 - 30;
      const is = []; for (let i = -6; i <= 6.0001; i += 0.05) is.push(i);
      const vmax = Math.max(...is.map(i => Math.max(Math.abs(Qc(i)), Pe(i)))) * 1.05;
      const X = i => x0 + (i + 6) / 12 * w, Y = v => y0 - v / vmax * h;
      g.fillStyle = 'rgba(58,123,213,.08)'; g.fillRect(x0, y0 - h, w, h);
      g.fillStyle = 'rgba(217,83,79,.08)'; g.fillRect(x0, y0, w, h);
      txt(g, '药液被冷却（热被抽走）', x0 + 8, y0 - h + 14, '#3a7bd5', 'left', 12, true);
      txt(g, '药液被加热（热被送入）', x0 + 8, y0 + h - 6, '#d9534f', 'left', 12, true);
      g.strokeStyle = css('--ink3'); g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + w, y0); g.moveTo(X(0), y0 - h); g.lineTo(X(0), y0 + h); g.stroke();
      for (let i = -6; i <= 6; i += 2) txt(g, i + ' A', X(i), y0 + h + 14, css('--ink3'), 'center', 11);
      plot(g, is, i => Qc(i), X, Y, '#2f6fd6', 2.6);
      plot(g, is, i => Pe(i), X, Y, '#999', 1.6, [5, 4]);
      legend(g, [['#2f6fd6', '药液侧的热流 Qc（W）'], ['#999', '消耗电功率（W）', [5, 4]]], x0 + w - 200, y0 - h + 30);
      const q = Qc(I.v), p = Pe(I.v);
      g.fillStyle = q >= 0 ? '#2f6fd6' : '#d9534f'; g.beginPath(); g.arc(X(I.v), Y(q), 6, 0, 7); g.fill();
      txt(g, `${q >= 0 ? '冷却' : '加热'} ${Math.abs(q).toFixed(0)} W`, X(I.v) + 9, Y(q) - 6, q >= 0 ? '#2f6fd6' : '#d9534f', 'left', 12, true);
      const cop = q >= 0 ? q / p : -q / p;
      out.innerHTML = (q >= 0
        ? `冷却模式：从药液抽走 <b>${q.toFixed(0)} W</b>，耗电 ${p.toFixed(0)} W，冷却水那边要带走 ${(q + p).toFixed(0)} W（抽来的热 + 电变的热）。制冷系数 COP = <b>${cop.toFixed(2)}</b>。`
        : `加热模式：送进药液 <b>${(-q).toFixed(0)} W</b>，耗电 ${p.toFixed(0)} W。COP = <b>${cop.toFixed(2)}</b>${cop > 1 ? '——比电阻丝（COP = 1）还高，因为它顺便从冷却水那边“搬”来了热' : ''}。`) +
        (I.v > 0 && q < 0 ? '<br><span class="warn">电流是“冷却方向”，但温差太大 / 电流太大，焦耳热和回流的热压过了珀耳帖效应，实际在加热。</span>' : '') +
        `<br>看曲线：冷却能力在某个电流达到顶点后反而下降（I²R 发热增长更快）；温差越大，能抽走的热越少。所以珀耳帖适合<b>小功率、要冷热双向、要很稳</b>的场合。`;
    });
  };

  // ---------------------------------------------------------- 8 PID 控温模拟
  EXP.control = root => {
    const { ctlBox, out, fit } = setup(root);
    const mode = select(ctlBox, '控制方式', ['ON/OFF（位式）', 'P（比例）', 'PI', 'PID'], 3);
    const Kp = ctrl(ctlBox, '比例增益 Kp', 1, 60, 1, 12, ' %/°C');
    const Ti = logctrl(ctlBox, '积分时间 Ti', 20, 2000, 300, ' s', v => v.toFixed(0));
    const Td = ctrl(ctlBox, '微分时间 Td', 0, 120, 1, 20, ' s');
    const th = ctrl(ctlBox, '测温滞后（死区时间）', 2, 90, 1, 15, ' s');
    const dist = check(ctlBox, '第 30 分钟补加 1 L 常温药液', true);
    const SV = 80;
    onAny([mode, Kp, Ti, Td, th, dist], () => {
      const { g, W, H } = fit();
      // 被控对象（示意）：10 L 药液，3 kW 加热器，加热器热容 + 测温死区时间
      const Cl = 10 * 4180, Ch = 3000, Gh = 120, G0 = 8, Pmax = 3000, Ta = 25, dt = 0.5, tEnd = 50 * 60;
      let Tl = Ta, Th = Ta, I = 0, on = true, prevPV = Ta;
      const buf = new Array(Math.round(th.v / dt) + 1).fill(Ta);
      const rec = [];
      let reached = null, over = 0;
      for (let k = 0; k * dt <= tEnd; k++) {
        const t = k * dt;
        buf.push(Tl); const PV = buf.shift();
        const e = SV - PV;
        let u;
        if (mode.v === 0) { if (PV < SV - 0.5) on = true; else if (PV > SV) on = false; u = on ? 100 : 0; }
        else {
          const D = mode.v === 3 ? -Td.v * (PV - prevPV) / dt : 0;
          const Iterm = mode.v >= 2 ? I / Ti.v : 0;
          u = Kp.v * (e + Iterm + D);
          const sat = u > 100 || u < 0;
          if (mode.v >= 2 && (!sat || (u > 100 && e < 0) || (u < 0 && e > 0))) I += e * dt; // 抗积分饱和：饱和时停止积分
          u = clamp(u, 0, 100);
        }
        prevPV = PV;
        const qh = Gh * (Th - Tl);
        Th += (u / 100 * Pmax - qh) / Ch * dt;
        Tl += (qh - G0 * (Tl - Ta)) / Cl * dt;
        if (dist.v && Math.abs(t - 1800) < dt / 2) Tl = (Tl * 10 + Ta * 1) / 11;
        if (reached === null && PV >= SV - 0.5) reached = t;
        if (reached !== null && t < 1800) over = Math.max(over, PV - SV);
        if (k % 10 === 0) rec.push([t / 60, PV, Tl, u]);
      }
      const last = rec.filter(r => r[0] > 24 && r[0] < 29.9);
      const avg = last.reduce((s, r) => s + r[1], 0) / Math.max(1, last.length);
      const amp = last.length ? Math.max(...last.map(r => r[1])) - Math.min(...last.map(r => r[1])) : 0;
      const x0 = 50, w = W - 110, yT = 24, hT = (H - 70) * 0.66, yU = yT + hT + 26, hU = (H - 70) * 0.34 - 10;
      const lo = 20, hi = 95;
      const X = m => x0 + m / 50 * w, Y = T => yT + hT - (clamp(T, lo, hi) - lo) / (hi - lo) * hT, YU = u => yU + hU - u / 100 * hU;
      g.fillStyle = 'rgba(47,158,106,.12)'; g.fillRect(x0, Y(SV + 0.5), w, Y(SV - 0.5) - Y(SV + 0.5));
      g.strokeStyle = css('--ink3'); g.lineWidth = 1; g.beginPath(); g.moveTo(x0, yT); g.lineTo(x0, yT + hT); g.lineTo(x0 + w, yT + hT); g.moveTo(x0, yU); g.lineTo(x0, yU + hU); g.lineTo(x0 + w, yU + hU); g.stroke();
      for (let T = 20; T <= 90; T += 10) txt(g, T, x0 - 6, Y(T) + 4, css('--ink3'), 'right', 11);
      for (let m = 0; m <= 50; m += 5) txt(g, m, X(m), yU + hU + 14, css('--ink3'), 'center', 11);
      txt(g, '时间 / 分钟', x0 + w, yU + hU + 28, css('--ink2'), 'right');
      txt(g, '温度 / °C', x0 + 4, yT - 8, css('--ink2'));
      txt(g, '加热器输出 %', x0 + 4, yU - 6, css('--ink2'));
      g.setLineDash([4, 4]); g.strokeStyle = '#2f9e6a'; g.beginPath(); g.moveTo(x0, Y(SV)); g.lineTo(x0 + w, Y(SV)); g.stroke(); g.setLineDash([]);
      txt(g, 'SV 80 °C', x0 + w + 6, Y(SV) + 4, '#2f9e6a', 'left', 12, true);
      const xs = rec.map((_, i) => i);
      plot(g, xs, i => rec[i][2], i => X(rec[i][0]), Y, '#9ab3d6', 1.3, [3, 3]);
      plot(g, xs, i => rec[i][1], i => X(rec[i][0]), Y, css('--accent'), 2.4);
      g.fillStyle = 'rgba(233,138,26,.35)'; g.beginPath(); g.moveTo(X(0), YU(0));
      rec.forEach(r => g.lineTo(X(r[0]), YU(r[3]))); g.lineTo(X(50), YU(0)); g.fill();
      if (w >= 420) legend(g, [[css('--accent'), 'PV（测到的温度）'], ['#9ab3d6', '真实液温（测温点看到的要晚一点）', [3, 3]]], x0 + w - 300, yT + hT - 40);
      if (dist.v) { g.strokeStyle = css('--ink3'); g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(30), yT); g.lineTo(X(30), yU + hU); g.stroke(); g.setLineDash([]); txt(g, '补液', X(30) + 4, yT + 12, css('--ink3')); }
      const names = ['ON/OFF', 'P', 'PI', 'PID'];
      let tip = '';
      if (mode.v === 0) tip = '位式控制只会“全开 / 全关”，加上测温滞后，温度必然在设定值上下来回晃。滞后越大，晃得越厉害。';
      else if (mode.v === 1) tip = `只有比例项：要维持 80 °C 需要一定的输出来抵消散热，而 P 控制只有“有偏差”时才有输出——所以温度停在设定值下面一点（稳态偏差 / 残差）。Kp 调大偏差变小，但太大会振荡。`;
      else if (mode.v === 2) tip = '积分项把长期存在的小偏差一点点累加成输出，所以最终能精确停在 80 °C；代价是可能过冲。Ti 越短，积分越猛。';
      else tip = '微分项看温度变化的“速度”提前刹车，可以压住过冲；但它对噪声敏感，测温信号抖的时候要谨慎。';
      out.innerHTML = (w < 420 ? '<span class="cap">蓝实线 = 测到的温度 PV，浅色虚线 = 真实液温</span><br>' : '') + `${names[mode.v]}：首次到达 ${reached === null ? '—' : (reached / 60).toFixed(1) + ' 分钟'}，过冲 <b>${over.toFixed(1)} °C</b>，补液前 5 分钟平均 <b>${avg.toFixed(2)} °C</b>（偏差 ${(avg - SV).toFixed(2)}），波动幅度 ${amp.toFixed(2)} °C。<br>${tip}` +
        (th.v > 40 ? '<br><span class="warn">测温滞后很大：控制器看到的永远是“过去的温度”，增益只能调小，响应变慢。把传感器装得离加热器 / 循环出口近一点，比调参数更有效。</span>' : '');
    });
  };

  // ---------------------------------------------------------- 9 SSR 怎么调功率
  EXP.ssr = root => {
    const { ctlBox, out, fit } = setup(root);
    const u = ctrl(ctlBox, '调节器输出', 0, 100, 1, 40, ' %');
    const m = select(ctlBox, '调功方式', ['时间比例（SSR，周期 2 秒）', '过零 · 周波数控制', '相位控制（晶闸管）'], 0);
    let t0 = 0;
    const draw = (tt = 0) => {
      const { g, W, H } = fit();
      const x0 = 30, w = W - 60, yc = H / 2 - 6, A = H / 2 - 50;
      const p = u.v / 100;
      g.strokeStyle = css('--line'); g.beginPath(); g.moveTo(x0, yc); g.lineTo(x0 + w, yc); g.stroke();
      if (m.v === 0) {
        // 时间轴 6 秒，周期 2 秒：前 p×2 秒全波导通
        const span = 6, X = s => x0 + s / span * w;
        for (let c = 0; c < 3; c++) {
          g.fillStyle = 'rgba(233,138,26,.25)'; g.fillRect(X(c * 2), yc - A, X(c * 2 + 2 * p) - X(c * 2), 2 * A);
          g.strokeStyle = css('--ink3'); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(c * 2), yc - A - 10); g.lineTo(X(c * 2), yc + A + 10); g.stroke(); g.setLineDash([]);
        }
        g.strokeStyle = '#e0793a'; g.lineWidth = 1; g.beginPath();
        for (let i = 0; i <= 3000; i++) {
          const s = i / 3000 * span, conduct = (s % 2) < 2 * p;
          const v = conduct ? Math.sin(2 * Math.PI * 50 * s) : 0;
          i ? g.lineTo(X(s), yc - v * A) : g.moveTo(X(s), yc - v * A);
        }
        g.stroke();
        for (let s = 0; s <= span; s++) txt(g, s + ' s', X(s), yc + A + 24, css('--ink3'), 'center', 11);
        txt(g, '（50 Hz 的交流波太密，看起来像一块色带）', x0 + w, yc - A - 14, css('--ink3'), 'right', 11);
      } else {
        const cyc = m.v === 1 ? 20 : 5, span = cyc / 50, X = s => x0 + s / span * w;
        let alpha = 0;
        if (m.v === 2) { // 解 1 − α/π + sin2α/(2π) = p
          let a = 0, b = Math.PI;
          for (let k = 0; k < 40; k++) { const c = (a + b) / 2, f = 1 - c / Math.PI + Math.sin(2 * c) / (2 * Math.PI); f > p ? a = c : b = c; }
          alpha = (a + b) / 2;
        }
        const on = []; let acc = 0;
        for (let c = 0; c < cyc; c++) { acc += p; if (acc >= 1 - 1e-9) { on.push(true); acc -= 1; } else on.push(false); }
        g.strokeStyle = 'rgba(150,150,160,.5)'; g.lineWidth = 1; g.beginPath();
        for (let i = 0; i <= 2000; i++) { const s = i / 2000 * span, v = Math.sin(2 * Math.PI * 50 * s); i ? g.lineTo(X(s), yc - v * A) : g.moveTo(X(s), yc - v * A); }
        g.stroke();
        g.fillStyle = 'rgba(233,120,40,.55)';
        for (let i = 0; i < 2000; i++) {
          const s = i / 2000 * span, ph = (2 * Math.PI * 50 * s) % Math.PI, c = Math.floor(s * 50);
          const conduct = m.v === 1 ? on[c] : ph >= alpha;
          if (conduct) { const v = Math.sin(2 * Math.PI * 50 * s); g.fillRect(X(s), Math.min(yc, yc - v * A), w / 2000 + 0.6, Math.abs(v * A)); }
        }
        for (let c = 0; c <= cyc; c += (m.v === 1 ? 5 : 1)) txt(g, (c * 20) + ' ms', X(c / 50), yc + A + 24, css('--ink3'), 'center', 11);
        if (m.v === 2) txt(g, `每个半波在相位角 ${(alpha / Math.PI * 180).toFixed(0)}° 之后才导通`, x0 + w, yc - A - 14, css('--ink2'), 'right', 12);
        else txt(g, `每 ${cyc} 个周波里导通 ${on.filter(Boolean).length} 个，而且都从电压过零点开始`, x0 + w, yc - A - 14, css('--ink2'), 'right', 12);
      }
      const notes = [
        '最常见、最便宜：温度调节器每 1–2 秒算一次输出，SSR 在这个周期里按比例通 / 断。药液热容量大，几秒的通断它“感觉”不到，只感觉到平均功率。<b>依赖的假设</b>：被加热对象比通断周期慢得多。对热容量极小的东西（比如灯丝）就不合适。',
        '只在电压过零时开关，电磁干扰小；按“导通几个整周波”调功率，比时间比例更细。缺点：功率按周波跳变，对灯丝类负载会闪烁。',
        '在每个半波中途才导通，功率最平滑、响应最快，适合红外灯这种热惯性小的负载，也能做“软启动”（冷钨丝电阻小，直接全压会有很大的冲击电流）。代价：波形被切开，产生谐波和电磁干扰，需要滤波。'];
      out.innerHTML = `平均功率 = 满功率的 <b>${u.v} %</b>。<br>${notes[m.v]}`;
    };
    onAny([u, m], () => draw());
  };

  // ---------------------------------------------------------- 10 安全互锁：任何一条不满足就断电
  EXP.interlock = root => {
    const { ctlBox, out, fit } = setup(root);
    const C = [
      ['急停没被按下', true, 'hw'], ['液位正常（高于发热段）', true, 'hw'], ['循环流量正常', true, 'hw'],
      ['没有漏液', true, 'hw'], ['加热器 / 药液没有超温（独立保护器）', true, 'hw'], ['温度调节器要求加热（输出 > 0）', true, 'sw']];
    const cs = C.map(([n, v]) => check(ctlBox, n, v));
    const ssrFail = check(ctlBox, '假设 SSR 坏成短路（常通）', false);
    const draw = (tt = 0) => {
      const { g, W, H } = fit();
      const ok = cs.map(c => c.v);
      const hwOK = ok.slice(0, 5).every(Boolean), ssrOn = ssrFail.v || ok[5], heat = hwOK && ssrOn;
      const x0 = 24, x1 = W - 24, y1 = 50, y2 = H - 60;
      g.lineWidth = 3;
      g.strokeStyle = '#999'; g.beginPath(); g.moveTo(x0, 30); g.lineTo(x0, H - 30); g.moveTo(x1, 30); g.lineTo(x1, H - 30); g.stroke();
      txt(g, '控制电源', x0 + 4, 22, css('--ink3')); txt(g, '', x1, 22);
      // 上排：硬件联锁串联 → 接触器线圈
      const n = 5, seg = (x1 - x0 - 140) / n;
      let live = true;
      for (let i = 0; i < n; i++) {
        const xa = x0 + i * seg, xb = xa + seg, mid = (xa + xb) / 2;
        g.strokeStyle = live ? '#2f9e6a' : '#bbb'; g.beginPath(); g.moveTo(xa, y1); g.lineTo(mid - 12, y1); g.stroke();
        g.strokeStyle = ok[i] ? (live ? '#2f9e6a' : '#bbb') : css('--warn');
        g.beginPath(); g.moveTo(mid - 12, y1 - 10); g.lineTo(mid - 12, y1 + 10); g.moveTo(mid + 12, y1 - 10); g.lineTo(mid + 12, y1 + 10); g.stroke();
        if (ok[i]) { g.beginPath(); g.moveTo(mid - 12, y1); g.lineTo(mid + 12, y1); g.stroke(); }
        else { g.beginPath(); g.moveTo(mid - 12, y1); g.lineTo(mid + 10, y1 - 14); g.stroke(); }
        live = live && ok[i];
        g.strokeStyle = live ? '#2f9e6a' : '#bbb'; g.beginPath(); g.moveTo(mid + 12, y1); g.lineTo(xb, y1); g.stroke();
        txt(g, ['急停', '液位', '流量', '漏液', '超温'][i], mid, y1 + 28, ok[i] ? css('--ink2') : css('--warn'), 'center', 12, !ok[i]);
      }
      const cx = x1 - 70;
      g.strokeStyle = live ? '#2f9e6a' : '#bbb'; g.beginPath(); g.moveTo(x0 + n * seg, y1); g.lineTo(cx - 22, y1); g.moveTo(cx + 22, y1); g.lineTo(x1, y1); g.stroke();
      g.fillStyle = hwOK ? '#dff3e9' : '#f6f6f6'; g.strokeStyle = hwOK ? '#2f9e6a' : '#bbb'; g.beginPath(); g.arc(cx, y1, 22, 0, 7); g.fill(); g.stroke();
      txt(g, 'MC', cx, y1 + 5, css('--ink'), 'center', 13, true); txt(g, '接触器线圈', cx, y1 + 38, css('--ink3'), 'center', 11);
      // 下排：动力回路 = 电源 → MC 触点 → SSR → 加热器
      const yy = y2, pts = [x0, x0 + 0.25 * (x1 - x0), x0 + 0.5 * (x1 - x0), x0 + 0.78 * (x1 - x0), x1];
      txt(g, '动力电源（如 200 V）', x0 + 4, yy - 26, css('--ink3'));
      const segc = (a, b, on) => { g.strokeStyle = on ? '#e0793a' : '#bbb'; g.lineWidth = 4; g.beginPath(); g.moveTo(a, yy); g.lineTo(b, yy); g.stroke(); };
      segc(pts[0], pts[1] - 16, true);
      g.strokeStyle = hwOK ? '#e0793a' : css('--warn'); g.lineWidth = 3; g.beginPath(); g.moveTo(pts[1] - 16, yy - 10); g.lineTo(pts[1] - 16, yy + 10); g.moveTo(pts[1] + 16, yy - 10); g.lineTo(pts[1] + 16, yy + 10); g.stroke();
      if (hwOK) { g.beginPath(); g.moveTo(pts[1] - 16, yy); g.lineTo(pts[1] + 16, yy); g.stroke(); } else { g.beginPath(); g.moveTo(pts[1] - 16, yy); g.lineTo(pts[1] + 12, yy - 16); g.stroke(); }
      txt(g, 'MC 触点', pts[1], yy + 28, css('--ink2'), 'center', 12);
      segc(pts[1] + 16, pts[2] - 26, hwOK);
      g.fillStyle = ssrOn ? '#ffe9c7' : '#f2f2f2'; g.strokeStyle = ssrFail.v ? css('--warn') : '#888'; g.lineWidth = 2; g.fillRect(pts[2] - 26, yy - 16, 52, 32); g.strokeRect(pts[2] - 26, yy - 16, 52, 32);
      txt(g, 'SSR', pts[2], yy + 5, ssrFail.v ? css('--warn') : css('--ink'), 'center', 13, true);
      txt(g, ssrFail.v ? '已短路（不听指挥）' : '听温度调节器的', pts[2], yy + 30, ssrFail.v ? css('--warn') : css('--ink3'), 'center', 11);
      segc(pts[2] + 26, pts[3] - 30, hwOK && ssrOn);
      const glow = heat ? 0.55 + 0.45 * Math.abs(Math.sin(tt * 3)) : 0;
      g.fillStyle = heat ? `rgba(255,${Math.round(120 - 60 * glow)},40,${0.4 + 0.6 * glow})` : '#eee';
      g.fillRect(pts[3] - 30, yy - 14, 60, 28); g.strokeStyle = '#a55'; g.strokeRect(pts[3] - 30, yy - 14, 60, 28);
      txt(g, '加热器', pts[3], yy + 5, css('--ink'), 'center', 13, true);
      segc(pts[3] + 30, pts[4], heat);
      // 虚线：温度调节器 → SSR
      g.setLineDash([4, 4]); g.strokeStyle = ok[5] ? '#2f6fd6' : '#bbb'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(pts[2], yy - 16); g.lineTo(pts[2], (y1 + yy) / 2 + 10); g.stroke(); g.setLineDash([]);
      txt(g, `温度调节器：${ok[5] ? '要热' : '不要热'}`, pts[2], (y1 + yy) / 2, ok[5] ? '#2f6fd6' : css('--ink3'), 'center', 12);
      const bad = C.slice(0, 5).filter((c, i) => !ok[i]).map(c => c[0]);
      let msg = heat ? '<b>加热器通电。</b>' : '<b>加热器断电。</b>';
      if (!hwOK) msg += ` 原因：${bad.join('、')} → 硬件联锁断开接触器，<b>不管温度调节器和 SSR 怎么想，电都过不去</b>。`;
      else if (!ssrOn) msg += ' 这是正常控温：温度够了，温度调节器让 SSR 关掉。';
      if (ssrFail.v && hwOK) msg += '<br><span class="warn">SSR 坏成短路时，温度调节器已经管不住加热器了——这时只有“超温保护 → 断接触器”这一层能救场。这就是为什么保护回路要独立、要串一个机械触点。</span>';
      if (ssrFail.v && !hwOK) msg += '<br>SSR 虽然坏了，但接触器已断开，加热器安全。';
      out.innerHTML = msg + '<br>设计原则：<b>断线 = 停止</b>（触点平时是闭合的，线断了等于条件不满足），这叫“故障安全”。';
    };
    [...cs, ssrFail].forEach(c => c.el.addEventListener('change', () => draw()));
    window.addEventListener('resize', () => draw()); draw();
    anim(t => { if (vis(root)) draw(t); });
  };

  window.initExperiments = () => document.querySelectorAll('.exp[data-exp]').forEach(el => EXP[el.dataset.exp] && EXP[el.dataset.exp](el));
})();
