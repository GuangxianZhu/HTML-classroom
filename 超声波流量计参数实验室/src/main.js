// 超声波流量计参数实验室 —— 仿真 + 3D
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import glbB64 from '../model/flowmeter.glb';

const $ = s => document.querySelector(s);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const f2 = x => (Math.abs(x) < 0.005 ? 0 : x).toFixed(2);
function gauss() { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); }

// ======================= 物理常数（示意） =======================
const D = 0.008;                 // 测量管内径 8 mm
const A = Math.PI * D * D / 4;   // 截面积 m²
const LP = 0.100;                // 声程 100 mm
const RIN = 0.004;
const QMAX_PUMP = 10;            // 阀门全开时的流量 L/min
const FLUIDS = [
  { id: 'water', name: '纯水 25℃', nu: 0.89, c: 1497 },
  { id: 'hot', name: '热纯水 80℃', nu: 0.36, c: 1554 },
  { id: 'ipa', name: 'IPA', nu: 2.6, c: 1140 },
  { id: 'h2so4', name: '浓硫酸 约98%（示意）', nu: 14, c: 1470 },
  { id: 'h3po4', name: '磷酸 约85%（示意）', nu: 28, c: 1700 },
];
// 流速分布修正系数 K = 声束看到的速度 / 截面平均速度（示意值：层流 1.12，湍流约 1.03）
const kTurb = Re => 1 + 0.004 * Math.sqrt(6.25 + 431 * Math.pow(Re, -0.237));
function kProfile(Re) {
  const KL = 1.12;
  if (Re < 2300) return KL;
  if (Re > 4000) return kTurb(Re);
  const t = (Re - 2300) / 1700; return KL * (1 - t) + kTurb(4000) * t;
}
const regime = Re => Re < 2300 ? '层流' : Re < 4000 ? '过渡' : '湍流';
// 变换器用设定 ν 反推平均流速
function solveMean(vp, nuSet, corr) {
  if (!corr) return vp / 1.03;
  let v = vp / 1.03;
  for (let i = 0; i < 10; i++) v = vp / kProfile(Math.abs(v) * D / (nuSet * 1e-6));
  return v;
}

// ======================= 仪表参数 P / 过程状态 S =======================
const P = {
  FS: 8, tau: 1, lowcut: 1, nuSet: 0.89, profileCorr: true,
  almH: 7, almL: 1, hyst: 0, almDelay: 0, contact: 'NO',
  pulseW: 10, pulseWidth: 5, preset: 2.0,
  errTime: 1.0, errMode: 'hold', dsp: true, plcFS: 8, exag: 120,
};
const S = {
  valveCmd: 40, valvePos: 40, Qbase: 4, turb: 0, Qtrue: 4, trueTotal: 0,
  fluid: FLUIDS[0], nuAct: 0.89, noise: 0.8, drift: 0, bubbleRate: 0,
  tA: 0, tB: 0, vPath: 0, vMean: 0, ReTrue: 0, kTrue: 1, ReEst: 0, kEst: 1, errPct: 0,
  dtMeas: 0, zeroStored: 0, Qraw: 4, Qd: 4, Qcut: 4, Qout: 4, lastGood: 4,
  amp: 1, valid: true, invalidT: 0, error: false,
  mA: 12, plc: 4, freq: 500, total: 0, acc: 0, backlog: 0, pulseCarry: 0, plcCount: 0, pulseFlash: 0,
  almHi: { on: false, t: 0, n: 0 }, almLo: { on: false, t: 0, n: 0 },
  zeroing: null, zeroMsg: '', zeroBad: false, step: null, stepMsg: '', batch: null, batchMsg: '', batchBad: false,
  time: 0,
};
let simBubbles = [];

function alarm(a, condOn, condOff, dt) {
  if (!a.on) { if (condOn) { a.t += dt; if (a.t >= P.almDelay) { a.on = true; a.t = 0; a.n++; } } else a.t = 0; }
  else { if (condOff) { a.t += dt; if (a.t >= P.almDelay) { a.on = false; a.t = 0; a.n++; } } else a.t = 0; }
}

function step(dt) {
  S.time += dt;
  // 阀门执行机构 + 管路滞后
  const vr = 400 * dt;
  S.valvePos += clamp(S.valveCmd - S.valvePos, -vr, vr);
  const Qt = S.valvePos / 100 * QMAX_PUMP;
  S.Qbase += (Qt - S.Qbase) * (1 - Math.exp(-dt / 0.15));
  S.turb += -S.turb * dt / 0.25 + 0.012 * Math.sqrt(dt) * gauss();
  S.Qtrue = Math.max(0, S.Qbase * (1 + S.turb));
  S.trueTotal += S.Qtrue / 60 * dt;

  // ① 声波传播：顺流 tA、逆流 tB
  const c = S.fluid.c;
  const v = S.Qtrue / 60000 / A; S.vMean = v;
  const Re = v * D / (S.nuAct * 1e-6); S.ReTrue = Re;
  const k = kProfile(Re); S.kTrue = k;
  const vp = v * k; S.vPath = vp;
  S.tA = LP / (c + vp); S.tB = LP / (c - vp);
  let dtm = (S.tB - S.tA) + (S.drift + S.noise * gauss()) * 1e-9;

  // 气泡：经过声路时信号幅度下降
  if (S.bubbleRate > 0 && Math.random() < S.bubbleRate * dt) { simBubbles.push({ x: -LP / 2, s: 0.7 + Math.random() * 0.6 }); spawnVisBubble(); }
  const vc = Math.max(v * (Re < 2300 ? 2 : 1.22), 0.03);
  for (const b of simBubbles) b.x += vc * dt;
  simBubbles = simBubbles.filter(b => b.x < LP / 2);
  let amp = 1; for (const b of simBubbles) amp -= 0.5 * b.s;
  amp = Math.max(0, amp); S.amp = S.amp * 0.7 + amp * 0.3;
  let valid = amp >= 0.35;
  if (valid && amp < 0.95) { if (P.dsp) valid = false; else dtm += gauss() * 40e-9 * (1 - amp); }
  S.valid = valid; S.dtMeas = dtm;

  // 零点调整：采 1 秒平均
  if (S.zeroing) {
    const z = S.zeroing; z.t += dt;
    if (valid) { z.sum += dtm; z.n++; z.q += S.Qtrue; }
    if (z.t >= 1.0 && z.n > 0) {
      S.zeroStored = z.sum / z.n; const q = z.q / z.n;
      S.zeroBad = q > 0.05;
      S.zeroMsg = S.zeroBad
        ? `⚠ 零点已记录 ${(S.zeroStored * 1e9).toFixed(2)} ns，可当时真实流量有 ${q.toFixed(2)} L/min！这部分流量被当成"偏移"减掉了，之后所有读数都会偏小约 ${q.toFixed(2)} L/min。关死阀门重做一次。`
        : `✓ 零点已记录：${(S.zeroStored * 1e9).toFixed(2)} ns。以后每次测量都先减掉它。`;
      S.zeroing = null;
    }
  }

  if (valid) {
    S.invalidT = 0; S.error = false;
    // ② 零点修正 → ③ 时间差换算流速 → ④ 流速分布修正
    const dtc = dtm - S.zeroStored;
    const vpm = dtc * c * c / (2 * LP);
    const ve = solveMean(vpm, P.nuSet, P.profileCorr);
    S.ReEst = Math.abs(ve) * D / (P.nuSet * 1e-6);
    S.kEst = P.profileCorr ? kProfile(S.ReEst) : 1.03;
    S.Qraw = ve * A * 60000;
    // ⑤ 阻尼（一阶低通）
    const a = P.tau > 0 ? 1 - Math.exp(-dt / P.tau) : 1;
    S.Qd += (S.Qraw - S.Qd) * a;
  } else {
    S.invalidT += dt;
    if (S.invalidT >= P.errTime) S.error = true;
  }
  // 无噪声时的系统误差（用于粘度关卡）
  const ven = solveMean(vp, P.nuSet, P.profileCorr);
  S.errPct = v > 0.02 ? (ven / v - 1) * 100 : 0;

  // ⑥ 小流量切除
  const cut = P.lowcut / 100 * P.FS;
  S.Qcut = Math.abs(S.Qd) < cut ? 0 : S.Qd;
  // ⑦ 错误时输出
  if (!S.error) { S.lastGood = S.Qcut; S.Qout = S.Qcut; }
  else S.Qout = P.errMode === 'hold' ? S.lastGood : 0;

  // ⑧ 4-20 mA
  let mA = clamp(4 + 16 * S.Qout / P.FS, 3.8, 20.5);
  if (S.error) { if (P.errMode === 'low') mA = 3.6; else if (P.errMode === 'high') mA = 21.0; else if (P.errMode === 'zero') mA = 4; }
  S.mA = mA;
  S.plcFault = mA < 3.75 || mA > 20.75;
  S.plc = (mA - 4) / 16 * P.plcFS;
  S.freq = clamp(1000 * S.Qout / P.FS, 0, 1100);

  // ⑨ 积算 + 积算脉冲
  const q = Math.max(0, S.Qout);
  S.total += q / 60 * dt;
  S.acc += q / 60 * 1000 * dt;
  while (S.acc >= P.pulseW) { S.acc -= P.pulseW; S.backlog++; }
  const rate = 1 / (2 * P.pulseWidth / 1000);
  S.pulseCarry += rate * dt;
  const can = Math.floor(S.pulseCarry);
  const em = Math.min(can, S.backlog);
  S.pulseCarry = Math.min(S.pulseCarry - em, 1);
  S.backlog -= em; S.plcCount += em;
  if (em > 0) { S.pulseFlash = 0.06; S.pulseInWin = 1; }
  S.pulseFlash = Math.max(0, S.pulseFlash - dt);

  // ⑩ 报警（回差 + 延时）
  alarm(S.almHi, S.Qout > P.almH, S.Qout < P.almH - P.hyst, dt);
  if (P.almL > 0) alarm(S.almLo, S.Qout < P.almL, S.Qout > P.almL + P.hyst, dt);
  else S.almLo.on = false;

  // 阶跃测试
  if (S.step && !S.step.hit) {
    const st = S.step;
    if ((st.up && S.Qd >= st.th) || (!st.up && S.Qd <= st.th)) {
      st.hit = true;
      S.stepMsg = `显示值走到 63% 用了 ${(S.time - st.t0).toFixed(2)} s（阻尼 τ = ${P.tau} s，另外阀门和管路本身约有 0.15 s 滞后）`;
    }
  }
  // 定量补液
  if (S.batch) {
    const B = S.batch;
    if (B.phase === 'run' && S.total - B.t0 >= P.preset) { B.phase = 'closing'; S.valveCmd = 0; B.meterAtClose = S.total - B.t0; }
    if (B.phase === 'closing' && S.valvePos < 0.01 && S.Qtrue < 0.003) {
      const real = S.trueTotal - B.true0, over = (real / P.preset - 1) * 100;
      S.batchBad = Math.abs(over) > 2;
      S.batchMsg = `预置 ${P.preset.toFixed(3)} L → 实际送出 ${real.toFixed(3)} L（${over >= 0 ? '+' : ''}${over.toFixed(1)}%），仪表积算 ${(S.total - B.t0).toFixed(3)} L。阻尼 τ=${P.tau}s。`;
      S.batch = null;
    }
  }
}

// ======================= 趋势记录 =======================
const NH = 1000, HDT = 0.02; // 20 s
const H = { t: new Float32Array(NH), raw: new Float32Array(NH), out: new Float32Array(NH), hi: new Uint8Array(NH), lo: new Uint8Array(NH), er: new Uint8Array(NH), pu: new Uint8Array(NH), i: 0, n: 0 };
let hAcc = 0;
function record() {
  const i = H.i;
  H.t[i] = S.Qtrue; H.raw[i] = S.Qraw; H.out[i] = S.error && P.errMode !== 'hold' ? NaN : S.Qout;
  H.hi[i] = S.almHi.on; H.lo[i] = S.almLo.on; H.er[i] = S.error; H.pu[i] = S.pulseInWin || 0; S.pulseInWin = 0;
  H.i = (i + 1) % NH; H.n = Math.min(NH, H.n + 1);
}

// ======================= 3D =======================
const canvas = $('#c3d'), view = $('#view3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xe8ecf1);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.5));
const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(-0.3, 0.6, 0.5); scene.add(dl);
const camera = new THREE.PerspectiveCamera(34, 1, 0.002, 5);
const CAMS = {
  all: { p: [0.03, 0.17, 0.66], t: [0.03, -0.025, 0] },
  tube: { p: [-0.004, 0.032, 0.125], t: [0, -0.003, 0] },
  conv: { p: [0.205, 0.03, 0.17], t: [0.205, 0.0, 0] },
};
camera.position.set(...CAMS.all.p);
const controls = new OrbitControls(camera, canvas);
controls.target.set(...CAMS.all.t); controls.enableDamping = true; controls.minDistance = 0.05; controls.maxDistance = 1.5;
let camGoal = null;
function goCam(k) { camGoal = { p: new THREE.Vector3(...CAMS[k].p), t: new THREE.Vector3(...CAMS[k].t) }; document.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('on', b.dataset.cam === k)); }
document.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => goCam(b.dataset.cam));
controls.addEventListener('start', () => camGoal = null);

const M = {}; // 模型部件
let bodyMats = [], lcdTex, lcdCtx;
const ledM = {};
const piezo = {};

function setupModel(root) {
  scene.add(root);
  const meshes = name => { const o = root.getObjectByName(name); const a = []; o && o.traverse(m => m.isMesh && a.push(m)); return a; };
  meshes('MeasureTube').forEach(m => m.material = new THREE.MeshPhysicalMaterial({ color: 0xd6eef6, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }));
  ['Pipe_In', 'Pipe_Out'].forEach(n => meshes(n).forEach(m => m.material = new THREE.MeshPhysicalMaterial({ color: 0xf4f6f4, transparent: true, opacity: 0.6, roughness: 0.3, depthWrite: false })));
  meshes('PFABody').forEach(m => { m.material = m.material.clone(); bodyMats.push(m.material); });
  [['LED_H', 0xff3030], ['LED_L', 0xffa500], ['LED_ERR', 0xff3030], ['LED_PULSE', 0x30ff60]].forEach(([n, col]) => {
    meshes(n).forEach(m => { m.material = m.material.clone(); ledM[n] = { m: m.material, col: new THREE.Color(col), base: m.material.color.clone() }; });
  });
  ['Piezo_A', 'Piezo_B'].forEach(n => meshes(n).forEach(m => { m.material = m.material.clone(); piezo[n] = m.material; m.renderOrder = 2; }));
  // LCD 动态贴图
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 204; lcdCtx = cv.getContext('2d');
  lcdTex = new THREE.CanvasTexture(cv); lcdTex.flipY = false; lcdTex.colorSpace = THREE.SRGBColorSpace;
  meshes('LCD').forEach(m => m.material = new THREE.MeshBasicMaterial({ map: lcdTex, toneMapped: false }));
  M.valve = root.getObjectByName('ValveHandle');
  setXray(true);
}
const glbBin = Uint8Array.from(atob(glbB64), ch => ch.charCodeAt(0));
new GLTFLoader().parse(glbBin.buffer, '', g => setupModel(g.scene), e => console.error(e));

let xray = true;
function setXray(on) {
  xray = on; $('#xray').classList.toggle('on', on);
  bodyMats.forEach(m => { m.transparent = on; m.opacity = on ? 0.28 : 1; m.depthWrite = !on; m.needsUpdate = true; });
}
$('#xray').onclick = () => setXray(!xray);

// 粒子（示踪颗粒，颜色=局部流速）
const NP = 240;
const parts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0007, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), NP);
parts.renderOrder = 3; parts.frustumCulled = false; scene.add(parts);
const pr = [];
for (let i = 0; i < NP; i++) pr.push({ r: Math.sqrt(Math.random()) * RIN * 0.9, th: Math.random() * Math.PI * 2, x: (Math.random() - 0.5) * LP });
const dummy = new THREE.Object3D(), tmpCol = new THREE.Color();
function profileU(rr, v, Re) { // 局部流速 / 平均流速
  const lam = 2 * (1 - rr * rr), tur = 1.224 * Math.pow(Math.max(0, 1 - rr), 1 / 7);
  if (Re < 2300) return lam; if (Re > 4000) return tur;
  const t = (Re - 2300) / 1700; return lam * (1 - t) + tur * t;
}
// 气泡（视觉）
const NB = 30;
const bubMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0016, 12, 8), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.9 }), NB);
bubMesh.renderOrder = 3; bubMesh.frustumCulled = false; scene.add(bubMesh);
const vb = [];
function spawnVisBubble() { if (vb.length < NB) vb.push({ x: -LP / 2, y: (Math.random() - 0.5) * 0.003, z: (Math.random() - 0.5) * 0.003, s: 0.7 + Math.random() * 0.6 }); }
// 超声波波前
const ringGeo = new THREE.CircleGeometry(RIN * 0.93, 40); ringGeo.rotateY(Math.PI / 2);
const mkWave = col => { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })); m.renderOrder = 4; scene.add(m); return m; };
const wDown = mkWave(0x22c55e), wUp = mkWave(0xf97316);
let wPhase = 0; const WPERIOD = 1.9, CVIS = LP / 1.2;

// 3D 标签
const LBL = [
  { t: '换能器 A（上游）', p: [-0.087, 0.022, 0] },
  { t: '换能器 B（下游）', p: [0.087, 0.022, 0] },
  { t: '测量管 Ø8 × 100 mm', p: [0, 0.011, 0] },
  { t: '变换器', p: [0.205, 0.056, 0] },
  { t: '手动阀（改流量）', p: [-0.17, -0.068, 0] },
  { t: '流入 →', p: [-0.225, -0.104, 0], c: 'flow' },
  { t: '→ 流出', p: [0.30, -0.104, 0], c: 'flow' },
];
const lblBox = $('#labels');
LBL.forEach(l => { const d = document.createElement('div'); d.className = 'lbl ' + (l.c || ''); d.textContent = l.t; lblBox.appendChild(d); l.el = d; l.v = new THREE.Vector3(...l.p); });
let showLbl = true;
$('#lblBtn').onclick = () => { showLbl = !showLbl; $('#lblBtn').classList.toggle('on', showLbl); lblBox.style.display = showLbl ? '' : 'none'; };

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view); resize();

let dtReal = 0.016;
function update3D(dt) {
  if (camGoal) {
    const k = 1 - Math.exp(-(dtReal || 0.016) * 5);
    camera.position.lerp(camGoal.p, k); controls.target.lerp(camGoal.t, k);
    if (camera.position.distanceTo(camGoal.p) < 0.001) camGoal = null;
  }
  controls.update();
  // 粒子
  const v = S.vMean, Re = S.ReTrue, vref = P.FS / 60000 / A;
  for (let i = 0; i < NP; i++) {
    const p = pr[i], rr = p.r / RIN, u = v * profileU(rr, v, Re);
    p.x += u / 25 * dt; if (p.x > LP / 2) p.x -= LP;
    dummy.position.set(p.x, p.r * Math.sin(p.th), p.r * Math.cos(p.th)); dummy.updateMatrix();
    parts.setMatrixAt(i, dummy.matrix);
    tmpCol.setHSL(0.62 * (1 - clamp(u / (vref * 1.6), 0, 1)), 0.9, 0.5); parts.setColorAt(i, tmpCol);
  }
  parts.instanceMatrix.needsUpdate = true; parts.instanceColor.needsUpdate = true;
  // 气泡
  const vc = Math.max(v * (Re < 2300 ? 2 : 1.22), 0.03) / 25;
  for (const b of vb) b.x += vc * dt;
  for (let i = vb.length - 1; i >= 0; i--) if (vb[i].x > LP / 2 + 0.004) vb.splice(i, 1);
  for (let i = 0; i < NB; i++) {
    if (i < vb.length) { dummy.position.set(vb[i].x, vb[i].y, vb[i].z); dummy.scale.setScalar(vb[i].s); }
    else { dummy.position.set(0, -9, 0); dummy.scale.setScalar(1); }
    dummy.updateMatrix(); bubMesh.setMatrixAt(i, dummy.matrix);
  }
  dummy.scale.setScalar(1);
  bubMesh.instanceMatrix.needsUpdate = true;
  // 声波：A→B 顺流（绿），B→A 逆流（橙）
  wPhase += dt; if (wPhase > WPERIOD) wPhase -= WPERIOD;
  const r = clamp(S.vPath / S.fluid.c * P.exag, -0.6, 0.6);
  const xd = -LP / 2 + CVIS * (1 + r) * wPhase, xu = LP / 2 - CVIS * (1 - r) * wPhase;
  const sigOk = S.amp > 0.35;
  wDown.visible = xd <= LP / 2; wDown.position.x = xd; wDown.material.opacity = 0.55 * Math.max(0.15, S.amp);
  wUp.visible = xu >= -LP / 2; wUp.position.x = xu; wUp.material.opacity = 0.55 * Math.max(0.15, S.amp);
  const flash = (m, on, col) => { if (!m) return; m.emissive.set(on ? col : 0x000000); m.emissiveIntensity = on ? 1.6 : 0; };
  const arrB = !wDown.visible && xd - LP / 2 < CVIS * 0.12, arrA = !wUp.visible && -LP / 2 - xu < CVIS * 0.12;
  flash(piezo.Piezo_A, wPhase < 0.1 || (arrA && sigOk), 0xffa040);
  flash(piezo.Piezo_B, wPhase < 0.1 || (arrB && sigOk), 0xffa040);
  // LED
  const led = (n, on) => { const L = ledM[n]; if (!L) return; L.m.color.copy(L.base).multiplyScalar(on ? 1 : 0.22); L.m.emissive.copy(on ? L.col : new THREE.Color(0)); L.m.emissiveIntensity = on ? 2.2 : 0; };
  led('LED_H', S.almHi.on); led('LED_L', S.almLo.on); led('LED_ERR', S.error && (S.time % 0.6 < 0.3)); led('LED_PULSE', S.pulseFlash > 0);
  // 阀门手轮
  if (M.valve) M.valve.rotation.y = -S.valvePos / 100 * Math.PI * 3;
  renderer.render(scene, camera);
  // 标签
  if (showLbl) {
    const w = view.clientWidth, h = view.clientHeight, tv = new THREE.Vector3();
    for (const l of LBL) {
      tv.copy(l.v).project(camera);
      const vis = tv.z < 1 && Math.abs(tv.x) < 1.05 && Math.abs(tv.y) < 1.05;
      l.el.style.display = vis ? '' : 'none';
      if (vis) { l.el.style.left = ((tv.x + 1) / 2 * w) + 'px'; l.el.style.top = ((1 - tv.y) / 2 * h) + 'px'; }
    }
  }
}

function drawLCD() {
  if (!lcdCtx) return;
  const g = lcdCtx; g.fillStyle = '#b5c79e'; g.fillRect(0, 0, 320, 204);
  g.fillStyle = '#1b2815'; g.textBaseline = 'alphabetic';
  g.font = 'bold 22px monospace';
  const flags = [S.almHi.on ? 'H' : ' ', S.almLo.on ? 'L' : ' ', S.zeroing ? 'ZERO' : ''].join(' ');
  g.fillText('FLOW', 14, 30); g.textAlign = 'right'; g.fillText(flags, 306, 30); g.textAlign = 'left';
  g.font = 'bold 74px monospace'; g.textAlign = 'right';
  const big = S.error && P.errMode !== 'hold' ? (S.time % 0.8 < 0.4 ? 'Err' : '') : f2(S.Qout);
  g.fillText(big, 306, 116);
  g.font = 'bold 20px monospace'; g.fillText('L/min', 306, 142);
  g.textAlign = 'left'; g.font = 'bold 22px monospace';
  g.fillText('Σ' + S.total.toFixed(3) + 'L', 14, 186);
  if (S.error) { g.textAlign = 'right'; g.fillText('ERR', 306, 186); }
  g.textAlign = 'left';
  lcdTex.needsUpdate = true;
}

// ======================= 面板 / 信号链 =======================
const CHAIN = [
  { h: '① 时间差 Δt', f: () => `${(S.dtMeas * 1e9).toFixed(1)} ns` },
  { h: '② 零点修正', f: () => `−${(S.zeroStored * 1e9).toFixed(1)} → ${((S.dtMeas - S.zeroStored) * 1e9).toFixed(1)} ns` },
  { h: '③ 换算 + 分布修正', f: () => `K=${S.kEst.toFixed(3)} → ${f2(S.Qraw)}` },
  { h: '④ 阻尼', f: () => `τ=${P.tau}s → ${f2(S.Qd)}` },
  { h: '⑤ 小流量切除', f: () => `${P.lowcut}% → ${f2(S.Qcut)}` },
  { h: '⑥ 错误处理', f: () => S.error ? `ERR → ${P.errMode === 'hold' ? '保持' : '异常输出'}` : (S.valid ? '正常' : '丢弃本样本') },
  { h: '⑦ 输出', f: () => `${S.mA.toFixed(2)} mA · ${S.freq.toFixed(0)} Hz` },
  { h: '⑧ 报警 / 积算', f: () => `${S.almHi.on ? 'H ' : ''}${S.almLo.on ? 'L ' : ''}Σ${S.total.toFixed(2)}L` },
];
const chainEl = $('#chain');
CHAIN.forEach((c, i) => { const d = document.createElement('div'); d.className = 'cb'; d.innerHTML = `<h4>${c.h}</h4><div></div>`; chainEl.appendChild(d); c.el = d; c.v = d.querySelector('div'); });

function contactSVG(closed) {
  return closed
    ? '<svg width="60" height="16"><circle cx="8" cy="8" r="3" fill="#16a34a"/><circle cx="52" cy="8" r="3" fill="#16a34a"/><line x1="8" y1="8" x2="52" y2="8" stroke="#16a34a" stroke-width="2.5"/></svg>'
    : '<svg width="60" height="16"><circle cx="8" cy="8" r="3" fill="#667085"/><circle cx="52" cy="8" r="3" fill="#667085"/><line x1="8" y1="8" x2="46" y2="1" stroke="#667085" stroke-width="2.5"/></svg>';
}
function updPanel() {
  const errShow = S.error && P.errMode !== 'hold';
  $('#lcdBig').textContent = errShow ? 'Err' : f2(S.Qout);
  $('#lcdTot').textContent = S.total.toFixed(3);
  $('#lcdFlags').textContent = [S.almHi.on ? 'H' : '', S.almLo.on ? 'L' : '', S.zeroing ? 'ZERO…' : ''].join(' ');
  $('#lcdState').textContent = S.error ? 'ERR' : (S.Qout > P.FS ? 'OVER' : 'RUN');
  $('#ledH').classList.toggle('on', S.almHi.on); $('#ledL').classList.toggle('on', S.almLo.on);
  $('#ledE').classList.toggle('on', S.error); $('#ledP').classList.toggle('on', S.pulseFlash > 0 || S.backlog > 0 && S.time % 0.2 < 0.1);
  $('#maBar').style.width = clamp((S.mA - 3.2) / (21.2 - 3.2) * 100, 0, 100) + '%';
  $('#pvMA').innerHTML = S.mA.toFixed(2) + ' mA' + (S.mA >= 20.49 && !S.error ? ' <span class="warn">已顶满</span>' : '');
  $('#pvPLC').innerHTML = S.plcFault ? '<span class="warn">断线/故障</span>' : f2(S.plc) + ' L/min';
  $('#pvHz').textContent = S.freq.toFixed(0) + ' Hz';
  $('#pvCnt').innerHTML = S.plcCount + (S.backlog > 3 ? ` <span class="warn">积压 ${S.backlog}</span>` : '');
  $('#pvTrue').textContent = f2(S.Qtrue) + ' L/min';
  const ct = (id, name, alarmOn, nc) => {
    const closed = nc ? !alarmOn : alarmOn;
    const el = $(id); el.classList.toggle('closed', closed);
    el.innerHTML = `${name}<br>${contactSVG(closed)}${nc ? 'NC 常闭' : 'NO 常开'} · ${closed ? '闭合' : '断开'}`;
  };
  const nc = P.contact === 'NC';
  ct('#ctH', '上限触点', S.almHi.on, nc); ct('#ctL', '下限触点', S.almLo.on, nc); ct('#ctE', '错误触点', S.error, nc);
  CHAIN.forEach(c => c.v.textContent = c.f());
}

// ======================= 趋势图 =======================
const chart = $('#chart'); let zoom = false;
$('#zoomBtn').onclick = () => setZoom(!zoom);
function setZoom(z) { zoom = z; $('#zoomBtn').textContent = z ? '恢复 Y 轴' : 'Y 轴放大到零点附近'; }
function drawChart() {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = chart.clientWidth, Ht = chart.clientHeight;
  if (chart.width !== Math.round(W * dpr)) { chart.width = Math.round(W * dpr); chart.height = Math.round(Ht * dpr); }
  const g = chart.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Ht);
  const L = 46, R = 10, T = 18, PH = Ht - T - 22 - 4 * 13 - 6, PW = W - L - R;
  const ymax = zoom ? P.FS * 0.12 : Math.max(P.FS, 10) * 1.12, ymin = zoom ? -P.FS * 0.04 : -Math.max(P.FS, 10) * 0.03;
  const Y = q => T + PH * (1 - (q - ymin) / (ymax - ymin));
  const X = k => L + PW * k / (NH - 1);
  g.font = '11px sans-serif'; g.fillStyle = '#667085'; g.strokeStyle = '#e5e7eb'; g.lineWidth = 1;
  // 网格
  const stepY = niceStep((ymax - ymin) / 5);
  for (let y = Math.ceil(ymin / stepY) * stepY; y <= ymax; y += stepY) {
    g.beginPath(); g.moveTo(L, Y(y)); g.lineTo(W - R, Y(y)); g.stroke();
    g.textAlign = 'right'; g.fillText(+y.toFixed(3) + '', L - 4, Y(y) + 4);
  }
  g.save(); g.beginPath(); g.rect(L, T, PW, PH); g.clip();
  // 小流量切除带
  const cut = P.lowcut / 100 * P.FS;
  if (cut > 0) { g.fillStyle = curLv === 'lowcut' ? '#16a34a33' : '#16a34a14'; g.fillRect(L, Y(cut), PW, Y(-cut) - Y(cut)); }
  // 报警线
  const hline = (y, col, dash, w = 1.2) => { g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash); g.beginPath(); g.moveTo(L, Y(y)); g.lineTo(W - R, Y(y)); g.stroke(); g.setLineDash([]); };
  const em = curLv === 'alarm';
  hline(P.FS, '#94a3b8', [2, 3]);
  hline(P.almH, em ? '#dc2626' : '#dc262666', [6, 4], em ? 1.6 : 1);
  if (P.hyst > 0) hline(P.almH - P.hyst, '#dc262655', [2, 3]);
  if (P.almL > 0) { hline(P.almL, em ? '#d97706' : '#d9770666', [6, 4], em ? 1.6 : 1); if (P.hyst > 0) hline(P.almL + P.hyst, '#d9770655', [2, 3]); }
  // 曲线
  const n = H.n, start = (H.i - n + NH) % NH, off = NH - n;
  const line = (arr, col, w, dash) => {
    g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); let pen = false;
    for (let k = 0; k < n; k++) { const v = arr[(start + k) % NH]; if (Number.isNaN(v)) { pen = false; continue; } const x = X(off + k), y = Y(v); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; }
    g.stroke(); g.setLineDash([]);
  };
  line(H.raw, '#93c5fd', 1);
  line(H.t, '#6b7280', 1.4, [5, 4]);
  line(H.out, '#1d4ed8', 2.2);
  g.restore();
  // 标注
  g.textAlign = 'right'; g.fillStyle = '#94a3b8'; g.fillText('F.S.', W - R - 2, Y(P.FS) - 3);
  g.textAlign = 'left';
  const lg = [['#6b7280', '真实流量'], ['#93c5fd', '原始值（阻尼前）'], ['#1d4ed8', '显示/输出值']];
  let lx = L; lg.forEach(([c, t]) => { g.fillStyle = c; g.fillRect(lx, 5, 14, 3); g.fillStyle = '#475467'; g.fillText(t, lx + 18, 11); lx += g.measureText(t).width + 34; });
  g.fillStyle = '#667085'; g.fillText('L/min', 4, 11);
  // 数字信号条
  const strips = [['上限H', H.hi, '#ef4444'], ['下限L', H.lo, '#f59e0b'], ['错误', H.er, '#b91c1c'], ['脉冲', H.pu, '#22c55e']];
  strips.forEach(([name, arr, col], s) => {
    const y0 = T + PH + 8 + s * 13;
    g.fillStyle = '#f1f3f6'; g.fillRect(L, y0, PW, 10);
    g.fillStyle = col;
    for (let k = 0; k < n; k++) if (arr[(start + k) % NH]) g.fillRect(X(off + k), y0, Math.max(1, PW / NH + 0.5), 10);
    g.fillStyle = '#667085'; g.textAlign = 'right'; g.fillText(name, L - 4, y0 + 9);
  });
  g.textAlign = 'left'; g.fillStyle = '#98a2b3';
  g.fillText('−20 s', L, Ht - 3); g.textAlign = 'right'; g.fillText('现在', W - R, Ht - 3); g.textAlign = 'left';
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }

// ======================= 控件工具 =======================
const syncers = [];
function mkSlider(c) {
  const w = document.createElement('label'); w.className = 'ctl';
  w.innerHTML = `<span>${c.label}</span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}"><b class="cv"></b>`;
  const inp = w.querySelector('input'), out = w.querySelector('b');
  const show = () => out.textContent = c.fmt ? c.fmt(c.get()) : c.get();
  inp.addEventListener('input', () => { c.set(parseFloat(inp.value)); show(); });
  syncers.push(() => { if (document.activeElement !== inp) inp.value = c.get(); show(); });
  inp.value = c.get(); show(); return w;
}
function mkSelect(c) {
  const w = document.createElement('label'); w.className = 'ctl';
  w.innerHTML = `<span>${c.label}</span><select>${c.opts.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('')}</select><b class="cv">${c.unit || ''}</b>`;
  const s = w.querySelector('select');
  s.addEventListener('change', () => c.set(s.value));
  syncers.push(() => { if (document.activeElement !== s) s.value = String(c.get()); });
  s.value = String(c.get()); return w;
}
function mkToggle(c) {
  const w = document.createElement('label'); w.className = 'ctl';
  w.innerHTML = `<span>${c.label}</span><span><input type="checkbox"> <small>${c.hint || ''}</small></span><b></b>`;
  const i = w.querySelector('input'); i.checked = c.get(); i.onchange = () => c.set(i.checked);
  syncers.push(() => i.checked = c.get()); return w;
}
function mkButtons(list) {
  const d = document.createElement('div'); d.className = 'btnrow';
  list.forEach(b => { const e = document.createElement('button'); e.className = 'btn' + (b.ghost ? ' ghost' : ''); e.textContent = b.label; e.onclick = b.fn; d.appendChild(e); });
  return d;
}
const roList = [];
function mkRO(list) {
  const d = document.createElement('div'); d.className = 'ro';
  list.forEach(r => { const e = document.createElement('div'); e.innerHTML = `<small>${r[0]}</small><b></b>`; d.appendChild(e); roList.push({ el: e.querySelector('b'), f: r[1] }); });
  return d;
}
const msgList = [];
function mkMsg(f, badF) { const d = document.createElement('div'); d.className = 'msg'; msgList.push({ el: d, f, badF }); return d; }

// 常驻过程控制
const valveCtl = { label: '阀门开度', min: 0, max: 100, step: 1, get: () => S.valveCmd, set: v => { S.valveCmd = v; S.batch = null; }, fmt: v => `${(+v).toFixed(0)}%` };
const proc = $('#proc');
proc.appendChild(mkSlider(valveCtl));
proc.appendChild(mkButtons([
  { label: '关死', ghost: true, fn: () => { S.valveCmd = 0; S.batch = null; } },
  { label: '3%', ghost: true, fn: () => { S.valveCmd = 3; S.batch = null; } },
  { label: '40%', ghost: true, fn: () => { S.valveCmd = 40; S.batch = null; } },
  { label: '全开', ghost: true, fn: () => { S.valveCmd = 100; S.batch = null; } },
]));
const procInfo = document.createElement('span'); procInfo.style.cssText = 'font-size:12px;color:#667085'; proc.appendChild(procInfo);

// 常用控件定义
const C = {
  noise: { label: '计时噪声 σ', min: 0, max: 5, step: 0.1, get: () => S.noise, set: v => S.noise = v, fmt: v => `${(+v).toFixed(1)} ns` },
  drift: { label: '零点偏移(漂移)', min: -5, max: 5, step: 0.1, get: () => S.drift, set: v => S.drift = v, fmt: v => `${(+v).toFixed(1)} ns` },
  tau: { label: '阻尼 τ', opts: [0, 0.2, 0.5, 1, 2, 3, 5, 10].map(x => [x, x + ' s']), get: () => P.tau, set: v => P.tau = +v },
  lowcut: { label: '小流量切除', min: 0, max: 30, step: 0.5, get: () => P.lowcut, set: v => P.lowcut = v, fmt: v => `${(+v).toFixed(1)} %FS` },
  FS: { label: '满量程 F.S.', opts: [3, 6, 8, 10, 20].map(x => [x, x + ' L/min']), get: () => P.FS, set: v => P.FS = +v },
  plcFS: { label: 'PLC 侧量程', opts: [3, 6, 8, 10, 20].map(x => [x, x + ' L/min']), get: () => P.plcFS, set: v => P.plcFS = +v },
  almH: { label: '上限 H', min: 0, max: 12, step: 0.1, get: () => P.almH, set: v => P.almH = v, fmt: v => `${(+v).toFixed(1)} L/min` },
  almL: { label: '下限 L（0=不用）', min: 0, max: 8, step: 0.1, get: () => P.almL, set: v => P.almL = v, fmt: v => `${(+v).toFixed(1)} L/min` },
  hyst: { label: '回差（滞环）', min: 0, max: 1.5, step: 0.05, get: () => P.hyst, set: v => P.hyst = v, fmt: v => `${(+v).toFixed(2)} L/min` },
  delay: { label: '报警延时', min: 0, max: 3, step: 0.1, get: () => P.almDelay, set: v => P.almDelay = v, fmt: v => `${(+v).toFixed(1)} s` },
  contact: { label: '触点形式', opts: [['NO', 'NO 常开（a 接点）'], ['NC', 'NC 常闭（b 接点）']], get: () => P.contact, set: v => P.contact = v },
  pulseW: { label: '脉冲当量', opts: [[1, '1 mL/脉冲'], [10, '10 mL/脉冲'], [100, '100 mL/脉冲'], [1000, '1 L/脉冲']], get: () => P.pulseW, set: v => P.pulseW = +v },
  pulseWidth: { label: '脉宽', opts: [1, 5, 10, 50, 100].map(x => [x, x + ' ms']), get: () => P.pulseWidth, set: v => P.pulseWidth = +v },
  preset: { label: '预置量', min: 0.2, max: 5, step: 0.1, get: () => P.preset, set: v => P.preset = v, fmt: v => `${(+v).toFixed(1)} L` },
  fluid: { label: '流体', opts: FLUIDS.map(f => [f.id, f.name]), get: () => S.fluid.id, set: v => { S.fluid = FLUIDS.find(f => f.id === v); S.nuAct = S.fluid.nu; } },
  nuAct: { label: '实际动粘度 ν', min: 0.3, max: 40, step: 0.01, get: () => S.nuAct, set: v => S.nuAct = v, fmt: v => `${(+v).toFixed(2)} mm²/s` },
  nuSet: { label: '设定动粘度 ν', min: 0.3, max: 40, step: 0.01, get: () => P.nuSet, set: v => P.nuSet = v, fmt: v => `${(+v).toFixed(2)} mm²/s` },
  corr: { label: '分布修正', hint: '按设定 ν 自动修正 K', get: () => P.profileCorr, set: v => P.profileCorr = v },
  bubble: { label: '气泡频率', min: 0, max: 20, step: 0.5, get: () => S.bubbleRate, set: v => S.bubbleRate = v, fmt: v => `${(+v).toFixed(1)} 个/s` },
  dsp: { label: 'DSP 抗气泡', hint: '丢弃信号变弱的样本', get: () => P.dsp, set: v => P.dsp = v },
  errTime: { label: '错误判定时间', min: 0.1, max: 5, step: 0.1, get: () => P.errTime, set: v => P.errTime = v, fmt: v => `${(+v).toFixed(1)} s` },
  errMode: { label: '错误时输出', opts: [['hold', '保持最后值'], ['zero', '输出 0（4 mA）'], ['low', '下跌 3.6 mA'], ['high', '上冲 21 mA']], get: () => P.errMode, set: v => P.errMode = v },
  exag: { label: '声波差视觉放大', min: 0, max: 300, step: 10, get: () => P.exag, set: v => P.exag = v, fmt: v => `${v}×` },
};

function startStep() {
  const to = S.valveCmd < 40 ? 70 : 20;
  const q1 = to / 100 * QMAX_PUMP, q0 = S.Qd;
  S.valveCmd = to; S.batch = null;
  S.step = { t0: S.time, th: q0 + 0.632 * (q1 - q0), up: q1 > q0, hit: false };
  S.stepMsg = `阀门 → ${to}%，计时中…`;
}
function startBatch() {
  S.batch = { phase: 'run', t0: S.total, true0: S.trueTotal };
  S.valveCmd = 60; S.batchMsg = `补液中：阀门 60%，积算到 ${P.preset.toFixed(1)} L 自动关阀…`; S.batchBad = false;
}

// ======================= 关卡 =======================
const LEVELS = [
  {
    id: 'principle', tab: '0 原理：时间差', cam: 'tube', chain: [0], zoom: false,
    html: `<h2>原理：顺流快、逆流慢</h2>
<p>测量管两端各有一片压电陶瓷（3D 里的橙色圆片）。通电脉冲让它振动发出超声波，收到超声波时它又能把振动变回电信号。变换器让 A、B <b>轮流发、轮流收</b>：</p>
<ul><li>A→B 顺着流走（绿色波前），用时 <code>tA = L / (c + v)</code></li>
<li>B→A 逆着流走（橙色波前），用时 <code>tB = L / (c − v)</code></li></ul>
<p>c 是液体里的声速（水约 1500 m/s），v 是流速，L 是声程。两者之差 Δt = tB − tA 和流速成正比。8 mm 的管子跑满量程，Δt 也只有两三百<b>纳秒</b>，所以变换器的计时电路要分辨到 0.1 ns 级。</p>
<span class="formula">v = L/2 × (1/tA − 1/tB)　　← 式子里没有声速 c</span>
<p>这一步最关键：把两个时间取倒数相减，声速被消掉了。换成 IPA、硫酸这些声速不同的药液，流速照样算得对，只要声速在仪表允许范围内（东京计装 UCUF-K 写的是 1000～2200 m/s）。最后 <code>流量 Q = 截面积 × 平均流速</code>。</p>
<div class="tasks"><b>试试看</b><ol><li>阀门从 0 拉到全开，看右边 Δt 跟着变大。</li><li>流体换成 IPA：tA、tB 都变大了（声速慢），流量读数基本不变。</li><li>把"声波差视觉放大"拉到 300×，看绿色和橙色谁先到对面。</li></ol></div>`,
    ctls: [['sel', 'fluid'], ['sl', 'exag']],
    ro: [['顺流 tA', () => (S.tA * 1e6).toFixed(4) + ' μs'], ['逆流 tB', () => (S.tB * 1e6).toFixed(4) + ' μs'],
      ['时间差 Δt（真实）', () => ((S.tB - S.tA) * 1e9).toFixed(2) + ' ns'], ['声速 c', () => S.fluid.c + ' m/s'],
      ['平均流速 v', () => S.vMean.toFixed(3) + ' m/s'], ['显示流量', () => f2(S.Qout) + ' L/min']],
  },
  {
    id: 'zero', tab: '1 零点调整', cam: 'all', chain: [0, 1], zoom: true,
    html: `<h2>零点调整：先认出"静止时的假时间差"</h2>
<p>流量为零时 Δt 应该是 0。实际两片换能器、两根电缆、电路通道不可能完全对称，温度一变还会漂，静止时也会残留一点时间差，这就是<b>零点偏移</b>。1 ns 的偏移在这台表上就是约 0.03 L/min 的"假流量"。</p>
<p>零点调整做的事：在管里<b>充满液体、液体完全静止</b>时，让变换器测 1 秒平均 Δt 记下来，之后每次测量先减掉它（信号链第 ② 格）。</p>
<p>现场要守住三条：</p>
<ol><li>管子必须满液、没气泡；</li><li>阀门真的关死，泵停或走旁通；</li><li>液温稳定在实际使用温度再做。</li></ol>
<div class="tasks"><b>试试看</b><ol><li>点"关死"，把零点偏移拉到 3 ns，看静止时显示多少（Y 轴已放大）。</li><li>点"执行零点调整"，1 秒后显示回到 0。</li><li>故意把阀门开到 30% 再做一次零点，再把阀门关死，看会发生什么。</li></ol></div>`,
    ctls: [['sl', 'drift'], ['sl', 'noise'], ['btn', [{ label: '执行零点调整', fn: () => { S.zeroing = { t: 0, sum: 0, n: 0, q: 0 }; S.zeroMsg = '零点采样中（1 秒）…'; S.zeroBad = false; } }, { label: '清除零点', ghost: true, fn: () => { S.zeroStored = 0; S.zeroMsg = '零点已清除（= 0 ns）'; S.zeroBad = false; } }]], ['msg', () => S.zeroMsg, () => S.zeroBad]],
    ro: [['记录的零点', () => (S.zeroStored * 1e9).toFixed(2) + ' ns'], ['当前测到的 Δt', () => (S.dtMeas * 1e9).toFixed(2) + ' ns'],
      ['显示流量', () => f2(S.Qout) + ' L/min'], ['真实流量', () => f2(S.Qtrue) + ' L/min']],
  },
  {
    id: 'damping', tab: '2 阻尼', cam: 'all', chain: [3], zoom: false,
    html: `<h2>阻尼：让读数稳下来，代价是变慢</h2>
<p>变换器大约每 10 ms 算出一个原始流量（浅蓝线），这个值会抖：湍流本身在波动，计时也有纳秒级误差。阻尼把它平滑成显示值（深蓝线），相当于一个一阶低通滤波，时间常数 τ：</p>
<span class="formula">显示值 ← 显示值 + (原始值 − 显示值) × (1 − e^(−Δt/τ))</span>
<p>流量突然变化时，显示值经过 <b>τ 秒走到 63%</b>，约 2.3τ 走到 90%，约 3τ 走到 95%。有的厂家写的是"响应时间"（例如基恩士 FD-Q 的 0.5～60 s），它可能按 90% 定义，换算前先看清说明书。</p>
<p>τ 越大越稳，反应也越慢：报警会迟到，定量补液会超量（第 6 关会看到）。各家范围：东京计装 UCM 0～10 s 共 8 档，富士 0～100 s。</p>
<div class="tasks"><b>试试看</b><ol><li>τ 设 0，把噪声拉到 3 ns，看深蓝线抖得多厉害。</li><li>τ 改成 3 s，点"阶跃测试"，看几秒走到 63%。</li><li>再试 τ = 10 s，想想报警会晚多久。</li></ol></div>`,
    ctls: [['sel', 'tau'], ['sl', 'noise'], ['btn', [{ label: '阶跃测试（阀门 20%↔70%）', fn: startStep }]], ['msg', () => S.stepMsg]],
    ro: [['原始值', () => f2(S.Qraw) + ' L/min'], ['显示值', () => f2(S.Qout) + ' L/min'], ['真实流量', () => f2(S.Qtrue) + ' L/min'], ['阻尼 τ', () => P.tau + ' s']],
  },
  {
    id: 'lowcut', tab: '3 小流量切除', cam: 'all', chain: [4], zoom: true,
    html: `<h2>小流量切除：静止时强制归零</h2>
<p>阀门关死后，显示值还会在 0 附近跳（噪声 + 没调干净的零点）。积算器会把正的小值一点点加起来，放一晚上就是一堆"幽灵流量"。</p>
<p>小流量切除：当 |显示值| < 设定% × 满量程 时，强制当 0 处理。显示、4-20 mA、频率、脉冲、积算<b>全部按 0 走</b>。图上绿色带就是切除区。</p>
<p>代价是真实的小流量也被吃掉：满量程 8 L/min、切除 5% 时，0.4 L/min 以下全看不见。设到"刚好压住静止时的抖动"就够了。各家范围：东京计装 UCM 0～30%FS，SFC4000 0～25%FS，富士按流速 0～5 m/s 设。</p>
<div class="tasks"><b>试试看</b><ol><li>点"关死"，阻尼设 0、切除设 0、噪声 3 ns，看积算慢慢涨。</li><li>把切除慢慢调大，调到刚好不跳为止。</li><li>阀门点"3%"（真实约 0.3 L/min），切除设 5%，显示多少？</li></ol></div>`,
    ctls: [['sl', 'lowcut'], ['sel', 'tau'], ['sl', 'noise'], ['sl', 'drift'], ['btn', [{ label: '积算清零', ghost: true, fn: () => { S.total = 0; S.plcCount = 0; S.acc = 0; S.backlog = 0; } }]]],
    ro: [['切除阈值', () => (P.lowcut / 100 * P.FS).toFixed(3) + ' L/min'], ['阻尼后的值', () => S.Qd.toFixed(3) + ' L/min'],
      ['显示值', () => f2(S.Qout) + ' L/min'], ['积算', () => S.total.toFixed(4) + ' L']],
  },
  {
    id: 'output', tab: '4 满量程与 4-20mA', cam: 'conv', chain: [6], zoom: false,
    html: `<h2>满量程与 4-20 mA：把流量翻译成电流</h2>
<span class="formula">I = 4 + 16 × Q / 满量程　　（mA）</span>
<p>0 流量对应 4 mA，满量程对应 20 mA。留出 0～4 mA 这一段，是为了让 PLC 分得清"零流量"和"断线"（断线时电流掉到 0）。超过满量程时电流顶在约 20.5 mA（NAMUR NE43 的饱和值），PLC 只知道"满了"，不知道到底多少。</p>
<p>PLC 那边要用<b>同一个量程</b>换算回来：<code>Q = (I − 4) / 16 × 量程</code>。两边对不上，读数就按比例错。频率输出同理：东京计装 UF / SFC4000 满量程对应 1000 Hz，东フロ可在 100～3000 Hz 之间改。</p>
<p>满量程设小，小流量的分辨率更好；设太小，大流量全部顶满。</p>
<div class="tasks"><b>试试看</b><ol><li>阀门全开（真实 10 L/min），看电流顶在多少，PLC 读到多少。</li><li>把 PLC 侧量程改成 10 L/min，和仪表的 8 不一致，看误差。</li><li>满量程改成 3 L/min，阀门 20%，再看 mA。</li></ol></div>`,
    ctls: [['sel', 'FS'], ['sel', 'plcFS']],
    ro: [['电流', () => S.mA.toFixed(2) + ' mA'], ['PLC 读到', () => S.plcFault ? '故障' : f2(S.plc) + ' L/min'],
      ['仪表显示', () => f2(S.Qout) + ' L/min'], ['频率输出', () => S.freq.toFixed(0) + ' Hz'],
      ['PLC 误差', () => S.Qout > 0.05 ? ((S.plc / S.Qout - 1) * 100).toFixed(1) + ' %' : '—'], ['超量程？', () => S.Qout > P.FS ? '是，已顶满' : '否']],
  },
  {
    id: 'alarm', tab: '5 上下限报警', cam: 'conv', chain: [7], zoom: false,
    html: `<h2>上下限报警：回差和延时治"抖振"</h2>
<p><b>上限 H</b>：流量超过 H 报警，比如泵失控、阀没关。<b>下限 L</b>：流量低于 L 报警，比如过滤器堵、供液断。</p>
<p>测量值在阈值附近抖的时候，触点会一秒开合好几次，叫<b>抖振（chattering）</b>，PLC 会收到一串报警。两招：</p>
<ul><li><b>回差（滞环）</b>：报警后要降到 H − 回差 以下才解除（图上细虚线）；</li><li><b>延时</b>：条件持续 N 秒才动作。</li></ul>
<p>触点形式：<b>NO 常开</b>＝报警时闭合；<b>NC 常闭</b>＝平时闭合、报警时断开。NC 的好处是断线或仪表掉电时触点也会断开，PLC 当作报警处理，这叫<b>故障安全（fail-safe）</b>。SFC4000 的报警和 FAULT 输出都能选 NO/NC。</p>
<div class="tasks"><b>试试看</b><ol><li>阻尼 0、回差 0、延时 0，阀门拉到 70% 左右让流量贴着 H，看"上限H"信号条有多乱。</li><li>回差加到 0.3，再加 0.5 s 延时，对比切换次数。</li><li>切换 NC，看右上角触点图的变化。</li></ol></div>`,
    ctls: [['sl', 'almH'], ['sl', 'almL'], ['sl', 'hyst'], ['sl', 'delay'], ['sel', 'contact'], ['sel', 'tau'], ['sl', 'noise'], ['btn', [{ label: '切换次数清零', ghost: true, fn: () => { S.almHi.n = 0; S.almLo.n = 0; } }]]],
    ro: [['上限状态', () => S.almHi.on ? '报警中' : '正常'], ['下限状态', () => S.almLo.on ? '报警中' : '正常'],
      ['上限切换次数', () => S.almHi.n + ' 次'], ['下限切换次数', () => S.almLo.n + ' 次'], ['显示值', () => f2(S.Qout) + ' L/min'], ['上限解除点', () => (P.almH - P.hyst).toFixed(2) + ' L/min']],
  },
  {
    id: 'pulse', tab: '6 脉冲与积算', cam: 'conv', chain: [6, 7], zoom: false,
    html: `<h2>积算与脉冲：数一共流了多少</h2>
<p><b>积算</b>＝流量对时间累加，得到总体积。<b>积算脉冲</b>：每流过一个"脉冲当量"（比如 10 mL）就发一个脉冲，PLC 数个数 × 当量 = 体积。</p>
<p>两个坑：</p>
<ol><li>当量太小、流量太大时，每秒要发的脉冲超过上限。上限 = 1 / (2 × 脉宽)：脉宽 50 ms 最多 10 个/秒；全开 10 L/min、当量 1 mL 要 167 个/秒，发不完就<b>积压</b>，PLC 的数越来越落后。</li>
<li>当量太大，分辨率变差：1 L/脉冲时 PLC 只能按整升算。</li></ol>
<p><b>定量补液</b>：积算到预置量就关阀（SFC4000 的"积算预置报警"就是干这个）。关阀动作和显示滞后，会让实际送出量多一点，阻尼越大超得越多。厂家范围：东フロ当量 0.001～32 L、脉宽 1～800 ms；SFC4000 倍率 ×0.1～×100。</p>
<div class="tasks"><b>试试看</b><ol><li>当量 1 mL、脉宽 50 ms、阀门全开，看 PLC 计数旁边的"积压"。</li><li>阻尼 0 s 跑一次定量补液，再用 5 s 跑一次，比较超量百分比。</li></ol></div>`,
    ctls: [['sel', 'pulseW'], ['sel', 'pulseWidth'], ['sl', 'preset'], ['sel', 'tau'],
      ['btn', [{ label: '开始定量补液', fn: startBatch }, { label: '积算清零', ghost: true, fn: () => { S.total = 0; S.plcCount = 0; S.acc = 0; S.backlog = 0; } }]], ['msg', () => S.batchMsg, () => S.batchBad]],
    ro: [['仪表内部积算', () => S.total.toFixed(3) + ' L'], ['PLC 按脉冲算', () => (S.plcCount * P.pulseW / 1000).toFixed(3) + ' L'],
      ['需要的脉冲速率', () => (Math.max(0, S.Qout) / 60 * 1000 / P.pulseW).toFixed(1) + ' 个/s'], ['能发的上限', () => (1000 / (2 * P.pulseWidth)).toFixed(0) + ' 个/s'],
      ['积压脉冲', () => S.backlog + ' 个'], ['频率输出', () => S.freq.toFixed(0) + ' Hz']],
  },
  {
    id: 'visc', tab: '7 动粘度与流速分布', cam: 'tube', chain: [2], zoom: false,
    html: `<h2>动粘度：药液要告诉仪表"我有多黏"</h2>
<p>管里的流速不均匀：管壁处为 0，中心最快。流得慢、液体又黏时是<b>层流</b>，截面上是抛物线，中心速度是平均速度的 2 倍；流得快时是<b>湍流</b>，分布比较平。3D 里粒子颜色就是局部流速（红快蓝慢），切到"测量管特写"看得最清楚。</p>
<span class="formula">雷诺数 Re = v × D / ν　　Re < 2300 层流，> 4000 湍流</span>
<p>声束测到的是声路上的速度，它和截面平均速度之间差一个系数 K，K 跟分布形状有关（本页示意：层流约 1.12，湍流约 1.03）。变换器得知道 ν 才能算出 Re、选对 K，所以药液用的流量计都有"动粘度"这一项：SFC4000 按动粘度自动补偿，Levitronix 的配置软件里叫 Kinem. Viscosity。<b>设定 ν 和实际不一样，读数就系统性地偏</b>，阻尼和零点都救不回来。</p>
<div class="tasks"><b>试试看</b><ol><li>流体换成磷酸，设定 ν 保持 0.89（纯水），看"系统误差"。</li><li>把设定 ν 改成 28，误差消失。</li><li>换回纯水，关掉"分布修正"，阀门从全开慢慢关到 5%，看进入层流后误差跳到多少。</li></ol></div>`,
    ctls: [['sel', 'fluid'], ['sl', 'nuAct'], ['sl', 'nuSet'], ['tg', 'corr']],
    ro: [['实际 Re', () => S.ReTrue.toFixed(0)], ['实际流态', () => regime(S.ReTrue)],
      ['仪表估算 Re', () => P.profileCorr ? S.ReEst.toFixed(0) : '不计算'], ['仪表用的 K', () => S.kEst.toFixed(3) + ' (真 ' + S.kTrue.toFixed(3) + ')'],
      ['系统误差', () => (S.errPct >= 0 ? '+' : '') + S.errPct.toFixed(1) + ' %'], ['显示 / 真实', () => f2(S.Qout) + ' / ' + f2(S.Qtrue)]],
  },
  {
    id: 'bubble', tab: '8 气泡与错误输出', cam: 'tube', chain: [5], zoom: false,
    html: `<h2>气泡：信号变弱时仪表怎么办</h2>
<p>超声波碰到气泡会被强烈反射、散射，接收端的信号幅度一下子掉下来。H₂O₂、热药液、泵吸入口漏气都容易带气泡。</p>
<ul><li>信号弱一点：时间差测不准，读数出<b>尖刺</b>；</li>
<li>信号太弱：这一次测量直接<b>无效</b>。</li></ul>
<p>变换器的对策：</p>
<ol><li><b>DSP 抗气泡</b>：发现信号异常的样本就丢掉，用上一个好值顶着（东京计装 SFC、Levitronix 都主打这一点）；</li>
<li>连续无效超过<b>错误判定时间</b> → ERR 灯亮，错误触点动作；</li>
<li><b>错误时输出</b>可选：保持最后值 / 输出 0 / 下跌 3.6 mA / 上冲 21 mA。选"保持"时积算器还在按旧值累加，做定量控制要小心。</li></ol>
<p>流量为 0 时气泡停在管里不走，会一直报错。所以厂家一般建议检测器<b>竖装、液体从下往上流</b>，让气泡自己跑掉。</p>
<div class="tasks"><b>试试看</b><ol><li>气泡 5 个/s，关掉 DSP，看浅蓝线的尖刺。</li><li>打开 DSP，尖刺没了。</li><li>阀门关死后再加气泡，等出错，切换各种"错误时输出"看 mA。</li></ol></div>`,
    ctls: [['sl', 'bubble'], ['tg', 'dsp'], ['sl', 'errTime'], ['sel', 'errMode'], ['sel', 'tau']],
    ro: [['接收信号强度', () => (S.amp * 100).toFixed(0) + ' %'], ['连续无效时间', () => S.invalidT.toFixed(2) + ' s'],
      ['错误状态', () => S.error ? 'ERR' : '正常'], ['电流', () => S.mA.toFixed(2) + ' mA'], ['显示值', () => (S.error && P.errMode !== 'hold') ? 'Err' : f2(S.Qout)], ['管内气泡', () => simBubbles.length + ' 个']],
  },
  {
    id: 'table', tab: '9 参数总表 & 调试顺序', cam: 'all', chain: [], zoom: false,
    html: `<h2>参数总表</h2>
<div style="overflow-x:auto"><table class="ptab">
<tr><th>参数</th><th>管什么</th><th>设错的后果</th><th>厂家资料里的例子</th></tr>
<tr><td>满量程 F.S.</td><td>4-20 mA、频率的对应关系</td><td>大了分辨率差，小了容易顶满；和 PLC 不一致就按比例错</td><td>东京计装 UCUF-06K 可设 0～0.4 到 0～8 L/min</td></tr>
<tr><td>动粘度 ν / 流体</td><td>层流、湍流的分布修正</td><td>读数系统性偏差</td><td>SFC4000 按动粘度自动补偿；Levitronix 设 Kinem. Viscosity、液温，另有最多 10 点线性化</td></tr>
<tr><td>零点调整</td><td>抵消静止时的残余时间差</td><td>有流量时做 → 全部偏小</td><td>各家都有：按键 / 外部输入 / 软件</td></tr>
<tr><td>阻尼 / 响应时间</td><td>平滑抖动</td><td>大 → 慢，小 → 抖</td><td>东京计装 UCM 0～10 s 8 档；基恩士 FD-Q 0.5～60 s；富士 0～100 s</td></tr>
<tr><td>小流量切除</td><td>静止时强制为 0</td><td>大 → 吃掉真实小流量</td><td>UCM 0～30%FS；SFC4000 0～25%FS；富士 0～5 m/s</td></tr>
<tr><td>上/下限报警、回差、延时、NO/NC</td><td>流量异常报警</td><td>回差、延时为 0 → 抖振</td><td>SFC4000 上限或下限、NO/NC 可选；基恩士回差可调</td></tr>
<tr><td>积算 / 预置</td><td>累计体积、定量</td><td>保持模式下出错仍在累加</td><td>SFC4000 积算预置报警 A/B、外部接点复位</td></tr>
<tr><td>脉冲当量 / 脉宽</td><td>积算脉冲给 PLC</td><td>当量小 + 脉宽大 → 积压</td><td>东フロ 0.001～32 L、脉宽 1～800 ms；SFC4000 ×0.1～×100、mL/L/m³</td></tr>
<tr><td>频率输出</td><td>瞬时流量 → 频率</td><td>PLC 换算系数要一致</td><td>东京计装 UF/SFC 满量程 1000 Hz；东フロ 100～3000 Hz</td></tr>
<tr><td>错误判定 / 错误时输出</td><td>气泡、空管时怎么输出</td><td>选错 → PLC 看不出故障</td><td>SFC4000 FAULT 输出 NO/NC</td></tr>
<tr><td>通信地址 / 波特率</td><td>远程设参数、读流量</td><td>地址冲突 → 通不上</td><td>RS-485 Modbus：东京计装最多 32 台、东フロ最多 31 台</td></tr>
</table></div>
<h2 style="margin-top:14px">现场调参顺序（建议）</h2>
<ol><li>确认流体、液温，设好动粘度（药液必做）；</li><li>满管、静止、液温稳定后做零点；</li><li>定满量程，和 PLC 侧量程对齐；</li><li>阻尼：先小后大，调到读数够稳、报警不迟到；</li><li>小流量切除：刚好压住静止时的抖动；</li><li>报警值 + 回差 + 延时，NO/NC 按故障安全原则选；</li><li>脉冲当量 / 脉宽：算一下最大流量时的脉冲速率；</li><li>错误时输出：和 PLC 的故障处理逻辑对上。</li></ol>`,
    ctls: [], ro: [],
  },
];

let curLv = 'principle';
const tabs = $('#tabs');
LEVELS.forEach(l => { const b = document.createElement('button'); b.textContent = l.tab; b.onclick = () => showLevel(l.id); tabs.appendChild(b); l.btn = b; });
function showLevel(id) {
  const L = LEVELS.find(l => l.id === id); curLv = id;
  LEVELS.forEach(l => l.btn.classList.toggle('on', l === L));
  $('#lvText').innerHTML = L.html;
  const box = $('#lvCtl'); box.innerHTML = '';
  syncers.length = 0; roList.length = 0; msgList.length = 0;
  const h = document.createElement('h3'); h.style.cssText = 'margin:0 0 6px;font-size:15px'; h.textContent = L.ctls.length ? '本关参数' : '提示'; box.appendChild(h);
  if (!L.ctls.length) box.insertAdjacentHTML('beforeend', '<p style="color:#667085;font-size:13px">左边是整理好的参数表。上面的阀门、趋势图仍然可以用，回到前面的关卡继续试。</p>');
  for (const [t, a] of L.ctls) {
    if (t === 'sl') box.appendChild(mkSlider(C[a]));
    else if (t === 'sel') box.appendChild(mkSelect(C[a]));
    else if (t === 'tg') box.appendChild(mkToggle(C[a]));
    else if (t === 'btn') box.appendChild(mkButtons(a));
  }
  L.ctls.filter(c => c[0] === 'msg').forEach(c => box.appendChild(mkMsg(c[1], c[2])));
  if (L.ro.length) box.appendChild(mkRO(L.ro));
  CHAIN.forEach((c, i) => c.el.classList.toggle('hl', L.chain.includes(i)));
  setZoom(L.zoom); goCam(L.cam);
  if (L.id === 'principle' || L.id === 'visc' || L.id === 'bubble') setXray(true);
  try { history.replaceState(null, '', '#' + id); } catch (e) { }
}
// 常驻阀门滑块同步
const procSyncers = syncers.slice();
setInterval(() => {
  procSyncers.forEach(f => f());
  syncers.forEach(f => f());
  roList.forEach(r => r.el.textContent = r.f());
  msgList.forEach(m => { const t = m.f(); m.el.textContent = t; m.el.classList.toggle('bad', !!(m.badF && m.badF())); });
  procInfo.textContent = `真实流量 ${f2(S.Qtrue)} L/min · 流体 ${S.fluid.name}`;
}, 120);

// ======================= 主循环 =======================
let paused = false, speed = 1, last = performance.now(), simAcc = 0, lcdT = 0, panelT = 0, chartT = 0;
$('#pauseBtn').onclick = () => { paused = !paused; $('#pauseBtn').textContent = paused ? '继续' : '暂停'; };
$('#speedSel').onchange = e => speed = +e.target.value;
const SIM_DT = 0.01;
function loop(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now; dtReal = dt;
  if (!paused) {
    simAcc += dt * speed;
    let n = 0;
    while (simAcc >= SIM_DT && n < 60) { step(SIM_DT); simAcc -= SIM_DT; n++; hAcc += SIM_DT; if (hAcc >= HDT) { hAcc -= HDT; record(); } }
  }
  update3D(paused ? 0 : dt * speed);
  lcdT += dt; if (lcdT > 0.1) { lcdT = 0; drawLCD(); }
  panelT += dt; if (panelT > 0.1) { panelT = 0; updPanel(); }
  chartT += dt; if (chartT > 0.033) { chartT = 0; drawChart(); }
  requestAnimationFrame(loop);
}
const start = (location.hash || '').slice(1);
showLevel(LEVELS.some(l => l.id === start) ? start : 'principle');
requestAnimationFrame(loop);
window.__S = S; window.__P = P; window.__showLevel = showLevel; window.__step = step;
