// ===== 热磷酸槽物理模型（纯函数，无 DOM） =====
const SIM = (() => {
  // 常压沸点 vs H3PO4 质量分数（85%≈158℃ 见 US9911631，其余为近似拟合）
  const TAB = [[78,140],[80,145],[82,150],[83,153],[84,155.5],[85,158],[86,161.2],[87,164.5],[88,168],[89,172],[90,176]];
  const xs = TAB.map(t => t[0]), ys = TAB.map(t => t[1]), n = xs.length;
  const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i+1] - ys[i]) / (xs[i+1] - xs[i]);
  m[0] = d[0]; m[n-1] = d[n-2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i-1] * d[i] <= 0 ? 0 : (d[i-1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    const a = m[i] / d[i], b = m[i+1] / d[i], s = a*a + b*b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t*a*d[i]; m[i+1] = t*b*d[i]; }
  }
  function tb0(wp) {
    if (wp <= xs[0]) return ys[0] + d[0] * (wp - xs[0]);
    if (wp >= xs[n-1]) return ys[n-1] + d[n-2] * (wp - xs[n-1]);
    let i = 0; while (wp > xs[i+1]) i++;
    const h = xs[i+1] - xs[i], t = (wp - xs[i]) / h, t2 = t*t, t3 = t2*t;
    return (2*t3 - 3*t2 + 1)*ys[i] + (t3 - 2*t2 + t)*h*m[i] + (-2*t3 + 3*t2)*ys[i+1] + (t3 - t2)*h*m[i+1];
  }
  // 沸点随气压：Clausius-Clapeyron（US9257292 写明沸点由浓度和大气压决定；ΔH 取值为推理）
  const R = 8.314, DH = 46000, P0 = 1013.25;
  function tb(wp, P) { const T0 = tb0(wp) + 273.15; return 1 / (1/T0 - R*Math.log(P/P0)/DH) - 273.15; }
  function wOf(T, P) { let lo = 60, hi = 95; for (let k = 0; k < 40; k++) { const mid = (lo+hi)/2; if (tb(mid, P) < T) lo = mid; else hi = mid; } return (lo+hi)/2; }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // 常数（示意量级，均为推理）
  const K = {
    M0: 90, CHW: 25000, UA: 7.4, KEXH: 300, QOPEN: 600, TAMB: 25, PMAX: 12000, L: 2.25e6,
    CPW: 4180, CPA: 1500, FV: 0.012, TC: 2, TAUS: 3, TAUM: 20, TDIW: 25,
    CW: 50*0.128*710 + 1.0*750, TAUW: 12, SURF: 0.0004, TSP: 160, BAND: 0.3, MARGIN: 0.12,
    BLK: 2.7, VOID: 0.05, DENS: 1.5,
  };
  const PI = { safe: { kp: 0.4, ti: 120 }, aggr: { kp: 4.0, ti: 5 } };
  const W0 = wOf(K.TSP, P0), WT = W0 + K.MARGIN;
  const tsp = s => s.mode === 'coupled' && s.comp ? tb(W0, s.P) : K.TSP;
  const wp = s => 100 * s.mA / (s.mA + s.mW);
  const cap = s => s.mA*K.CPA + s.mW*K.CPW + K.CHW;
  const lossOf = (s, T) => K.UA*(T - K.TAMB) + (K.KEXH*s.exh + (s.lotIn ? 0 : K.QOPEN)) * (T - K.TAMB)/135;

  function setConc(s, w) { const M = s.mA + s.mW; s.mA = M*w/100; s.mW = M - s.mA; }
  function create(opt = {}) {
    const s = {
      t: 0, mA: 0, mW: 0, T: K.TSP, Tm: K.TSP, wm: W0,
      P: P0, Ptarget: P0, comp: false, exh: 10,
      mode: 'coupled', ff: 'freeze', pi: 'safe', dead: 8, pbase: 8700, meterOff: false, bubbleBias: false,
      queue: [], I: 0.12, Ic: 0.03, Ih: 5400, duty: 0.12, dutyAvg: 0.12, cycleT: 0, valve: false, bandOpen: false,
      heater: 8700, boost: false, frozen: false, frozenT: 0, warm: false,
      wafer: null, waferPending: 0, lotIn: false,
      evap: 0, boil: 0, bl: 4, diw: 0, boiling: true, pour: 0, log: [], logT: 0,
    };
    s.mA = K.M0*W0/100; s.mW = K.M0 - s.mA;
    if (opt.mode === 'split') { s.mode = 'split'; setConc(s, WT); s.wm = WT; s.boiling = false; s.bl = 0; s.boil = 0; s.duty = 0.03; }
    if (opt.fresh) { setConc(s, 85.0); s.T = s.Tm = 25; s.wm = 85.0; s.warm = true; s.boiling = false; s.bl = 0; s.boil = 0; s.I = 0; s.duty = 0; s.Ih = 0; s.heater = K.PMAX; }
    return s;
  }

  function control(s) {
    const sp = tsp(s);
    if (s.warm && s.Tm >= sp - 0.5) s.warm = false;
    if (s.mode === 'split') {
      // US8153017：加热器 PI 控温 160±0.3，超上限加热器断开；浓度计控补水，且只在温度区间内进行
      const e = K.TSP - s.Tm, kp = 6000, ti = 120, raw = kp*e + s.Ih;
      if ((raw > 0 || e > 0) && (raw < K.PMAX || e < 0)) s.Ih += kp*K.TC/ti*e;
      s.Ih = clamp(s.Ih, 0, K.PMAX);
      s.heater = s.Tm > K.TSP + K.BAND ? 0 : clamp(kp*e + s.Ih, 0, K.PMAX);
      s.boost = false;
      const inBand = Math.abs(s.Tm - K.TSP) <= K.BAND;
      s.frozen = !inBand;
      if (s.meterOff || !inBand) { s.duty = 0; return; }
      const ec = s.wm - WT, kc = 2, tic = 150, rc = kc*ec + s.Ic;
      if ((rc > 0 || ec > 0) && (rc < 1 || ec < 0)) s.Ic += kc*K.TC/tic*ec;
      s.duty = clamp(kc*ec + s.Ic, 0, 1);
      return;
    }
    // 沸腾耦合（US6399517）：温度高→开阀补水，低→关阀
    const e = s.Tm - sp;
    if (s.frozen) {
      s.duty = s.ff === 'base' ? s.dutyAvg : 0;
      s.boost = s.Tm < sp - 0.6;
      if ((s.frozenT > 8 && s.Tm >= sp - 0.3 && s.boiling) || s.frozenT > 240) { s.frozen = false; s.boost = false; s.bandOpen = false; }
    }
    if (!s.frozen) {
      if (s.pi === 'band') {
        if (s.Tm > sp + 0.1) s.bandOpen = true; else if (s.Tm < sp - 0.1) s.bandOpen = false;
        s.duty = s.bandOpen ? 1 : 0;
      } else {
        const g = PI[s.pi], raw = g.kp*e + s.I;
        if (s.ff === 'none') { s.I += g.kp*K.TC/g.ti*e; s.I = clamp(s.I, -6, 6); }
        else if ((raw > 0 || e > 0) && (raw < 1 || e < 0)) s.I += g.kp*K.TC/g.ti*e;
        s.duty = clamp(g.kp*e + s.I, 0, 1);
      }
    }
    s.heater = (s.warm || s.boost) ? K.PMAX : s.pbase;
  }

  function step(s, dt) {
    s.t += dt;
    s.P += (s.Ptarget - s.P) * Math.min(1, dt/20);
    s.lotIn = !!s.wafer || s.waferPending > 0;
    s.cycleT += dt; if (s.frozen) s.frozenT += dt;
    if (s.cycleT >= K.TC) { s.cycleT -= K.TC; control(s); }
    s.valve = s.cycleT < s.duty*K.TC;
    if (!s.frozen && !s.warm) s.dutyAvg += (s.duty - s.dutyAvg) * Math.min(1, dt/300);
    const add = s.valve ? K.FV*dt : 0;
    s.diw += (add/dt - s.diw) * Math.min(1, dt/15);
    if (add) {
      const rt = s.t + s.dead, q = s.queue, last = q[q.length - 1];
      if (last && rt - last.rt < 0.5) last.m += add; else q.push({ rt, m: add });
    }
    let C = cap(s);
    while (s.queue.length && s.queue[0].rt <= s.t) {
      const p = s.queue.shift();
      s.T = (C*s.T + p.m*K.CPW*K.TDIW) / (C + p.m*K.CPW); s.mW += p.m; C = cap(s);
    }
    if (s.waferPending > 0) { s.waferPending -= dt; if (s.waferPending <= 0) s.wafer = { T: 25 }; }
    let Tb = tb(wp(s), s.P);
    const surf = K.SURF * Math.exp(Math.min(0, s.T - Tb) / 5);
    let Q = s.heater - lossOf(s, s.T) - surf*K.L;
    if (s.wafer) { const qw = (K.CW/K.TAUW)*(s.T - s.wafer.T); s.wafer.T += qw*dt/K.CW; Q -= qw; }
    s.T += Q*dt/C; s.mW -= surf*dt;
    Tb = tb(wp(s), s.P);
    let boil = 0;
    if (s.T > Tb) { boil = (s.T - Tb)*C/K.L; s.mW -= boil; s.T = Tb; }
    s.boil += (boil/dt - s.boil) * Math.min(1, dt/4);
    s.boiling = s.boil > 0.00005;
    s.bl = s.boiling ? clamp(1 + K.BLK*s.boil*1000, 1, 5) : 0;
    s.evap += ((boil/dt + surf) - s.evap) * Math.min(1, dt/4);
    s.Tm += (s.T - s.Tm) * dt / K.TAUS;
    // 鼓泡比重式浓度计：沸腾气泡让读数偏低（推理），并带 20 s 滞后（推理）
    const read = wp(s) - (s.bubbleBias ? K.DENS*K.VOID*s.bl : 0);
    s.wm += (read - s.wm) * dt / K.TAUM;
    if (s.pour > 0) s.pour -= dt;
    if (s.t >= s.logT) {
      s.logT += 0.5;
      s.log.push({ t: s.t, Tm: s.Tm, Tb: tb(wp(s), s.P), sp: tsp(s), w: wp(s), wi: wOf(s.Tm, P0), wm: s.wm,
        wt: s.mode === 'split' ? WT : null, h: s.heater, v: s.duty, bl: s.bl });
      if (s.log.length > 1400) s.log.splice(0, s.log.length - 1400);
    }
  }

  function dropWafers(s) {
    s.waferPending = 2.5;
    if (s.mode === 'coupled' && s.ff !== 'none') { s.frozen = true; s.frozenT = 0; }
  }
  function liftWafers(s) { s.wafer = null; s.waferPending = 0; }
  function pour(s) {
    const m = 0.15, C = cap(s);
    s.T = (C*s.T + m*K.CPW*K.TDIW) / (C + m*K.CPW); s.mW += m; s.pour = 3;
  }
  function setMode(s, mode) {
    if (mode === s.mode) return;
    if (mode === 'split') { s.Ih = s.heater; s.Ic = 0.03; s.boost = false; }
    else { s.I = s.dutyAvg; s.frozen = false; s.bandOpen = false; }
    s.frozen = false; s.mode = mode;
  }
  return { create, step, dropWafers, liftWafers, pour, setMode, tb, wOf, wp, tsp, K, PI, W0, WT, P0 };
})();
if (typeof module !== 'undefined') module.exports = SIM;
