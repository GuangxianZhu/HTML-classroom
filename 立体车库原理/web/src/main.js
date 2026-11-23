// 立体车库原理演示：6 种车库，一个页面。
// 两种模式：司机视角（只和出入口终端打交道）/ 原理演示（直接点车位、单步讲解、对比）。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Ctx } from './scene.js';
import { ALL } from './garages/index.js';
import { totalTime } from './garages/base.js';
import { stepDuration } from './motion.js';
import { rng } from './rng.js';

const PLAYBACK_BASE = 10;   // 速度 1x 时，1 秒真实时间播放 10 秒模拟时间
const FOV = 50;
const VIEWS = { 正面: [0, -0.12, -1], 侧面: [-1, -0.15, -0.05], 俯视: [0, -1, -0.25] };
const PROVINCES = '京沪粤苏浙川鄂湘鲁豫';
const PLATE_CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ================= three.js 场景 =================
const viewEl = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewEl.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
viewEl.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9eef5);
scene.fog = new THREE.Fog(0xe9eef5, 70, 240);
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 600);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.minDistance = 2;
controls.maxDistance = 200;
controls.maxPolarAngle = THREE.MathUtils.degToRad(95);
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

scene.add(new THREE.HemisphereLight(0xeef3ff, 0x8f949c, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xdfe6ff, 0.55);
fill.position.set(-30, 18, -25);
scene.add(fill);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0xd5dbe3, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.115;
floor.receiveShadow = true;
scene.add(floor);

const ctx = new Ctx(scene);

function resize() {
  const w = viewEl.clientWidth, h = viewEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  const aspect = w / h;
  camera.aspect = aspect;
  // 和原版一样：窄的那个方向保持 50° 视角（手机竖屏时整台车库也能放进画面）
  camera.fov = aspect >= 1 ? FOV : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / aspect));
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewEl);

// 阴影范围跟着车库大小走
function fitShadow() {
  const b = ctx.bounds();
  const c = b.getCenter(new THREE.Vector3());
  const r = b.getSize(new THREE.Vector3()).length() / 2 + 2;
  sun.position.copy(c).add(new THREE.Vector3(0.55, 1, 0.75).normalize().multiplyScalar(r * 2));
  sun.target.position.copy(c);
  const sc = sun.shadow.camera;
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.5; sc.far = r * 4;
  sc.updateProjectionMatrix();
}

// ---- 每帧：异步任务用 await nextFrame() 一帧一帧推进，不卡住页面 ----
let waiters = [];
const nextFrame = () => new Promise((res) => waiters.push(res));
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.1);   // 切到别的标签页回来时不要让动画一下跳过去
  last = now;
  const w = waiters;
  waiters = [];
  for (const r of w) r(dt);
  controls.update();
  ctx.pulse(now / 1000);
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// ================= 状态 =================
const S = {
  mode: 'driver', idx: 0, garage: null, busy: false, paused: false, next: false,
  history: { park: [], retrieve: [] }, log: [], notice: '', extra: '',
  plates: {}, parkedAt: {}, mine: new Set(), clockMin: 8 * 60, rand: rng(1),
  introOpen: false, entrance: null, choice: null,
};
const speedValue = () => +$('speed').value;
const playback = () => PLAYBACK_BASE * speedValue();

// ================= 相机 =================
function setCamera(kind) {
  const cam = ALL[S.idx].camera;
  const f = new THREE.Vector3(...(VIEWS[kind] || cam.forward)).normalize();
  let center = new THREE.Vector3(...cam.center);
  let dist = cam.range / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  if (S.mode === 'driver' && S.entrance) {
    // 司机视角：镜头往入口那边挪一点、拉远一点，让等在门口的车也在画面里
    const e = new THREE.Vector3(S.entrance[0], center.y, S.entrance[2]);
    const gap = e.distanceTo(center);
    center = center.multiplyScalar(0.7).add(e.multiplyScalar(0.3));
    dist += gap * 0.3;
  }
  dist *= camera.aspect < 1 ? 1.1 : 0.88;
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(f, -dist);
  controls.update();
}

// 车从哪里开进来：在副本上试存一辆车，找 spawn 动作的位置。车库满了返回 null
function entrance() {
  const g = S.garage;
  const empty = g.slots().filter((s) => !g.hasCar(s));
  if (!empty.length) return null;
  for (const st of g.clone().request(empty[0])) for (const a of st.actions) if (a.op === 'spawn') return a.pos;
  return null;
}

// ================= 显示 =================
const CJK = /[⺀-￯]/;
// 状态图上色：有车的格子绿色，空的灰色；全角字符固定占 2 个半角宽，等宽对齐不受字体影响
function gridHtml(text) {
  const wrapW = (s) => [...s].map((ch) => (CJK.test(ch) ? `<span class="w">${esc(ch)}</span>` : esc(ch))).join('');
  const re = /\[[^\]\n]*\]|\d+车|\d+空|空位|(?<![\w[])--(?![\w\]])/g;
  let out = '', i = 0, m;
  while ((m = re.exec(text))) {
    out += wrapW(text.slice(i, m.index));
    const tok = m[0];
    const cls = (tok.includes('空') || !tok.replace(/[[\] ]/g, '') || tok === '--') ? 'empty' : (tok.includes('车') ? 'car' : '');
    out += cls ? `<span class="${cls}">${wrapW(tok)}</span>` : wrapW(tok);
    i = m.index + tok.length;
  }
  return out + wrapW(text.slice(i));
}
const showGrid = (text) => { $('grid').innerHTML = gridHtml(text); };

function renderLog() {
  const ol = $('log');
  const n = S.log.length;
  let html = S.notice ? `<li class="notice">${esc(S.notice)}</li>` : '';
  S.log.forEach((e, i) => {
    const cls = S.busy ? (i === n - 1 ? 'cur' : 'done') : '';
    const t = e.d ? ` <span class="t">[${e.d.toFixed(1)}s]</span>` : '';
    html += `<li class="${cls}">${e.n ? e.n + '. ' : ''}${esc(e.text)}${t}</li>`;
  });
  if (S.extra) html += `<li class="extra">${esc(S.extra)}</li>`;
  ol.innerHTML = html;
  ol.scrollTop = ol.scrollHeight;
}
const setLog = (lines) => { S.log = lines.map((text) => ({ text })); renderLog(); };

function refreshButtons() {
  const g = S.garage;
  for (const b of $('slots').children) {
    const full = g.hasCar(b.dataset.sid);
    b.textContent = g.slotShort(b.dataset.sid) + (full ? ' ●' : ' ○');
    b.classList.toggle('full', full);
  }
}

function showStats(lastT = null) {
  const h = S.history;
  const avg = (xs) => (xs.length ? `${(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1)}s` : '—');
  const g = S.garage;
  const cars = g.slots().filter((s) => g.hasCar(s)).length;
  let s = `在库 <b>${cars}/${g.slots().length}</b> 辆`;
  if (lastT !== null) s += `　本次耗时 <b>${lastT.toFixed(1)}s</b>`;
  s += `<br>平均存车 <b>${avg(h.park)}</b>　平均取车 <b>${avg(h.retrieve)}</b>`;
  s += `<br><small>速度是示意值：${esc(ALL[S.idx].speedNote)}</small>`;
  $('stats').innerHTML = s;
}

function renderIntro() {
  $('introToggle').textContent = S.introOpen ? '收起说明 ▲' : '看原理说明 ▼';
  $('intro').hidden = !S.introOpen;
}

// ---- 出入口终端 ----
const K = { progress: null };
function kioskShow(heading, body = '', buttons = [], chips = [], progress = null) {
  const el = $('kiosk');
  el.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'khead';
  head.innerHTML = `<span>出入口终端 · ${esc(ALL[S.idx].title)}</span><span>${clockText()}</span>`;
  const h = document.createElement('h4');
  h.textContent = heading;
  el.append(head, h);
  if (body) {
    const b = document.createElement('div');
    b.className = 'kbody';
    b.textContent = body;
    el.append(b);
  }
  K.bar = K.barTxt = null;
  if (progress) {
    const bar = document.createElement('div');
    bar.className = 'kbar';
    bar.innerHTML = '<i></i>';
    const t = document.createElement('div');
    t.className = 'kbartxt';
    el.append(bar, t);
    K.bar = bar.firstChild; K.barTxt = t;
  }
  K.progress = progress;
  setProgress(progress);
  if (chips.length) {
    const box = document.createElement('div');
    box.className = 'chips';
    for (const [text, cb, mine] of chips) {
      const c = document.createElement('button');
      c.textContent = text;
      if (mine) c.classList.add('mine');
      c.onclick = cb;
      box.append(c);
    }
    el.append(box);
  }
  if (buttons.length) {
    const box = document.createElement('div');
    box.className = 'kbtns';
    for (const [text, cb, main] of buttons) {
      const c = document.createElement('button');
      c.textContent = text;
      if (main) c.classList.add('primary');
      c.onclick = cb;
      box.append(c);
    }
    el.append(box);
  }
}
function setProgress(p) {
  K.progress = p;
  if (!p || !K.bar) return;
  K.bar.style.width = `${Math.max(0, Math.min(1, p[0])) * 100}%`;
  K.barTxt.textContent = p[1];
}

// 等用户在终端上按一个按钮，返回按钮对应的值
function waitChoice() {
  return new Promise((res) => { S.choice = res; });
}
function choose(v) {
  const r = S.choice;
  S.choice = null;
  if (r) r(v);
}

// ================= 命令 =================
function submit(cmd) {
  if (S.busy) {
    S.notice = '正在执行上一个任务，请稍等。';
    renderLog();
    return;
  }
  S.notice = '';
  S.busy = true;
  runJob(cmd).catch((e) => {
    console.error(e);
    S.notice = '出错了：' + e.message;
  }).finally(() => {
    S.busy = false;
    S.extra = '';
    renderLog();
  });
}

async function runJob(cmd) {
  const g = S.garage;
  switch (cmd[0]) {
    case 'switch': switchTo(cmd[1]); break;
    case 'slot': await runSteps(g.request(cmd[1]), g.hasCar(cmd[1]) ? 'retrieve' : 'park'); break;
    case 'auto': {
      const hasEmpty = g.slots().some((s) => !g.hasCar(s));
      await runSteps(g.autoPark(), hasEmpty ? 'park' : null);
      break;
    }
    case 'random_out': {
      const full = g.slots().filter((s) => g.hasCar(s));
      if (full.length) await runSteps(g.request(full[Math.floor(Math.random() * full.length)]), 'retrieve');
      else setLog(['车库是空的。']);
      break;
    }
    case 'compare': await compare(); break;
    case 'drv_park': await driverPark(); break;
    case 'drv_pick': await driverPick(); break;
    default: break;
  }
}

function switchTo(i) {
  S.idx = i;
  $('type').value = String(i);
  $('cmp').hidden = true;
  ctx.clear();
  const Cls = ALL[i];
  const g = S.garage = new Cls();
  g.build(ctx);
  ctx.finish();
  fitShadow();
  S.entrance = entrance();
  setCamera('默认');
  const slots = $('slots');
  slots.innerHTML = '';
  for (const sid of g.slots()) {
    const b = document.createElement('button');
    b.dataset.sid = sid;
    b.title = g.slotLabel(sid);
    b.onclick = () => submit(['slot', sid]);
    slots.append(b);
  }
  refreshButtons();
  S.history = { park: [], retrieve: [] };
  // 已经停在库里的车：随机给车牌和存入时刻（每次打开都一样）
  S.rand = rng(i + 1);
  S.clockMin = 8 * 60;
  S.plates = {}; S.parkedAt = {}; S.mine = new Set();
  for (const [, name] of carsInGarage()) {
    S.plates[name] = newPlate();
    S.parkedAt[name] = S.clockMin - randint(30, 600);
  }
  $('title').textContent = Cls.title;
  $('intro').innerHTML = Cls.intro;
  setLog([S.mode === 'lab' ? '点车位按钮或“自动选位存车”开始。' : '在右边的出入口终端上点“我要存车”开始。']);
  $('logHint').textContent = '';
  S.notice = '';
  showGrid(g.ascii());
  if (S.mode === 'driver') kioskIdle();
  showStats();
}

function setMode(mode) {
  if (S.busy) {
    S.notice = '正在执行任务，做完再切换模式。';
    renderLog();
    return;
  }
  S.mode = mode;
  for (const b of document.querySelectorAll('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === mode);
  const lab = mode === 'lab';
  for (const el of document.querySelectorAll('.lab-only')) el.style.display = lab ? '' : 'none';
  $('slots').style.display = lab ? '' : 'none';
  $('kiosk').style.display = lab ? 'none' : '';
  S.introOpen = lab;
  renderIntro();
  setCamera('默认');
  if (lab) {
    $('midHdr').textContent = '车位';
    $('midHint').textContent = '绿色 = 有车。点一下：有车就取，没车就存到这里';
    setLog(['点车位按钮或“自动选位存车”开始。']);
  } else {
    $('midHdr').textContent = '出入口终端';
    $('midHint').textContent = '你是司机，按屏幕提示操作';
    setLog(['在出入口终端上点“我要存车”开始。']);
    kioskIdle();
  }
  $('logHint').textContent = '';
}

// 播放一串步骤。driver=[park|pick, 车名, 车位] 时是司机视角：
// 车开进来、开出去这两步是司机自己的动作，要等用户在终端上确认；其余是设备动作，自动播放。
async function runSteps(steps, kind, driver = null) {
  S.log = [];
  const total = totalTime(steps);
  let done = 0;
  const barOf = (x) => [total ? x / total : 1, `已用 ${x.toFixed(0)} 秒 / 预计 ${total.toFixed(0)} 秒（模拟时间）`];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    $('logHint').textContent = `第 ${i + 1}/${steps.length} 步`;
    const d = stepDuration(s);
    S.log.push({ n: S.log.length + 1, text: s.text, d });
    renderLog();
    const ops = new Set(s.actions.map((a) => a.op));
    if (driver) {
      const [what] = driver;
      if (what === 'park' && ops.has('spawn')) {
        kioskShow('请把车开进交接区', '停稳、熄火、拉好手刹，带上随身物品下车。确认车里没人后，设备才会开始动作。',
          [['已停好，下车离开', () => choose(1), true]], [], barOf(done));
        await waitChoice();
      } else if (what === 'pick' && ops.has('remove')) {
        kioskShow('您的车已到出口', '车头已经朝外，请上车直接开走。', [['上车驶离', () => choose(1), true]], [], barOf(done));
        await waitChoice();
      } else if (s.actions.length) {
        const parked = steps.slice(0, i).some((st) => st.actions.some((a) => a.op === 'spawn'));
        const head = what === 'pick' ? '正在为您取车' : (parked ? '正在存车，请离开交接区' : '设备准备中，请稍候');
        kioskShow(head, s.text, [], [], barOf(done));
      }
    } else if ($('stepMode').checked && s.actions.length) {
      S.next = false;
      S.extra = '（单步模式：点“下一步”或按 N 执行这一步）';
      renderLog();
      while (!S.next) await nextFrame();
      S.extra = '';
      renderLog();
    }
    // 播放这一步，同时推进终端上的进度条
    const player = ctx.play(s);
    let fin = d <= 0;
    while (!fin) {
      const dt = await nextFrame();
      if (!S.paused) fin = player.tick(dt * playback());
      if (driver && K.progress) setProgress(barOf(done + player.tau));
    }
    done += d;
    showGrid(s.state);
  }
  const t = totalTime(steps);
  if (kind) S.history[kind].push(t);
  refreshButtons();
  showStats(t);
}

async function compare() {
  $('cmpBody').innerHTML = '<p>正在计算……</p>';
  $('cmp').hidden = false;
  await nextFrame();
  const rows = [];
  for (const Cls of ALL) {
    const rand = rng(1);
    const g = new Cls();
    const times = { park: [], retrieve: [] };
    for (let k = 0; k < 200; k++) {
      const full = g.slots().filter((s) => g.hasCar(s));
      if (rand() < 0.5 && full.length < g.slots().length) times.park.push(totalTime(g.autoPark()));
      else if (full.length) times.retrieve.push(totalTime(g.request(full[Math.floor(rand() * full.length)])));
    }
    const cap = g.slots().length;
    const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    rows.push({ name: Cls.title, cap, fp: Cls.footprint, dens: cap / Cls.footprint * 100,
      park: avg(times.park), ret: avg(times.retrieve), worst: Math.max(...times.retrieve) });
    await nextFrame();      // 每算完一种让页面刷新一下
  }
  const best = (key, lowGood) => rows.reduce((b, r) => ((lowGood ? r[key] < b[key] : r[key] > b[key]) ? r : b))[key];
  const cell = (r, key, digits, lowGood) => `<td class="${r[key] === best(key, lowGood) ? 'best' : ''}">${r[key].toFixed(digits)}</td>`;
  let html = '<table><tr><th>类型</th><th>车位数</th><th>占地 m²</th><th>每 100 m² 车位</th><th>平均存车 s</th><th>平均取车 s</th><th>最慢取车 s</th></tr>';
  for (const r of rows) {
    html += `<tr><td>${esc(r.name)}</td><td>${r.cap}</td><td>${r.fp.toFixed(0)}</td>${cell(r, 'dens', 1, false)}`
      + `${cell(r, 'park', 1, true)}${cell(r, 'ret', 1, true)}${cell(r, 'worst', 1, true)}</tr>`;
  }
  html += '</table><p class="note">绿色是这一列最好的。注意：各类型规模不同（4 到 24 个车位），速度和占地都是示意值，'
    + '只适合看趋势，不代表真实产品。占地没算车道和坡道。<br>'
    + '怎么读：塔库每 100 m² 停得最多，但所有车都排一台电梯；垂直循环存车最快（自动挑离底部最近的空吊篮），'
    + '取车时吊篮在哪由不得人，平均要多转好几格；升降横移最慢的一次要 150 s 左右，因为上层车板要等下面逐层横移让位，升降本身也慢；'
    + '巷道堆垛和平面移动规模最大，平面移动的升降机和台车能同时干活，最慢的一次比堆垛机短。</p>';
  $('cmpBody').innerHTML = html;
}

// ================= 司机视角 =================
function randint(a, b) { return a + Math.floor(S.rand() * (b - a + 1)); }
const pick = (s) => s[Math.floor(S.rand() * s.length)];
function clockText(minutes = null) {
  const m = (Math.floor(minutes === null ? S.clockMin : minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function newPlate() {
  const used = new Set(Object.values(S.plates));
  for (;;) {
    let p = pick(PROVINCES) + pick('ABCDEFG') + '·';
    for (let k = 0; k < 5; k++) p += pick(PLATE_CHARS);
    if (!used.has(p)) return p;
  }
}
function carsInGarage() {
  const g = S.garage;
  return g.slots().filter((s) => g.hasCar(s)).map((s) => [s, g.carIn(s)]);
}
// 原理演示模式里存取的车没有车牌，回到司机视角时补上；已经开走的车去掉
function syncPlates() {
  const cars = new Set(carsInGarage().map(([, n]) => n));
  for (const name of cars) {
    if (!(name in S.plates)) {
      S.plates[name] = newPlate();
      if (!(name in S.parkedAt)) S.parkedAt[name] = S.clockMin - randint(30, 600);
    }
  }
  for (const name of Object.keys(S.plates)) if (!cars.has(name)) { delete S.plates[name]; delete S.parkedAt[name]; }
  for (const name of [...S.mine]) if (!cars.has(name)) S.mine.delete(name);
  for (const name of S.mine) ctx.tag(name, `您的车 ${S.plates[name]}`, false);
}
function myCarsText() {
  const g = S.garage;
  return carsInGarage().filter(([, n]) => S.mine.has(n)).map(([sid, n]) => `${S.plates[n]}（${g.slotLabel(sid)}）`);
}
function kioskIdle() {
  syncPlates();
  const g = S.garage;
  const empty = g.slots().filter((s) => !g.hasCar(s)).length;
  let body = `剩余空位 ${empty}/${g.slots().length}。存车时系统自动分配车位，取车时刷卡（这里选车牌）即可。`;
  if (S.mine.size) body += '\n您存的车：' + myCarsText().join('、');
  kioskShow('欢迎使用立体车库', body, [['我要存车', () => submit(['drv_park']), true], ['我要取车', () => submit(['drv_pick']), true]]);
}

async function driverPark() {
  const g = S.garage;
  if (g.slots().every((s) => g.hasCar(s))) {
    kioskShow('车位已满', '抱歉，现在没有空车位，请稍后再来。', [['返回', () => choose(1), true]]);
    await waitChoice();
    kioskIdle();
    return;
  }
  S.clockMin += randint(3, 25);
  // 先在副本上试算：系统会分配哪个车位、车从哪里开进来。真正确认后才改车库状态
  const sid = g.bestEmptySlot();
  const trial = g.clone().request(sid);
  let arrive = null;
  for (const st of trial) for (const a of st.actions) if (!arrive && a.op === 'spawn') arrive = a;
  const name = arrive.name, plate = newPlate();
  S.plates[name] = plate;
  ctx.car(name, arrive.pos, +name.slice(3), arrive.heading || 0);    // 停在入口车道上等候
  ctx.tag(name, `您的车 ${plate}`);
  setLog([`一辆车开到入口，摄像头识别车牌 ${plate}。`]);
  kioskShow('车辆已到达', `识别车牌：${plate}\n车型检测：长 4.0 m，宽 1.7 m，高 1.45 m，合格。\n要把车存进来吗？`,
    [['确认存车', () => choose('ok'), true], ['取消', () => choose('no'), false]]);
  if ((await waitChoice()) === 'no') {
    ctx.remove(name);
    delete S.plates[name];
    setLog(['司机取消了存车，车开走了。']);
    kioskIdle();
    return;
  }
  const steps = g.request(sid);
  S.parkedAt[name] = S.clockMin;
  ctx.highlight({ pos: g.poses()[name][0] });
  const t = totalTime(steps);
  kioskShow(`已为您分配：${g.slotLabel(sid)}`, `预计用时 ${t.toFixed(0)} 秒。目标车位已在画面里用黄色框标出。`);
  await runSteps(steps, 'park', ['park', name, sid]);
  ctx.clearHighlight();
  S.mine.add(name);              // 车上的“您的车”标签留着，取车时一眼就能在画面里找到
  S.clockMin += t / 60;
  kioskShow('存车完成，请保管好凭证',
    `车牌　${plate}\n车位　${g.slotLabel(sid)}\n存入　${clockText(S.parkedAt[name])}\n用时　${t.toFixed(0)} 秒（模拟）`,
    [['完成', () => choose(1), true]]);
  await waitChoice();
  kioskIdle();
}

async function driverPick() {
  const g = S.garage;
  const cars = carsInGarage();
  if (!cars.length) {
    kioskShow('车库是空的', '现在库里没有车。', [['返回', () => choose(1), true]]);
    await waitChoice();
    kioskIdle();
    return;
  }
  S.clockMin += randint(20, 240);    // 模拟：过了一段时间，车主回来取车
  // 自己的车排在前面、用黄色标出（和画面里车顶的“您的车”标签同色）；其余是其他车主的车
  cars.sort((a, b) => (S.mine.has(b[1]) ? 1 : 0) - (S.mine.has(a[1]) ? 1 : 0));
  const chips = cars.map(([sid, name]) => [S.plates[name] || name, () => choose(sid), S.mine.has(name)]);
  const body = S.mine.size
    ? '您存的车：' + myCarsText().join('、') + '\n黄色的是您的车，画面里车顶也有黄色标签。白色的是其他车主的车，演示时也可以点。'
    : '您还没有存过车。下面是其他车主的车（打开页面时就在库里），演示时可以任选一辆，相当于替那位车主刷卡。';
  kioskShow('请刷卡取车', body, [['返回', () => choose('back'), false]], chips);
  const sid = await waitChoice();
  if (sid === 'back') { kioskIdle(); return; }
  const name = g.carIn(sid);
  const plate = S.plates[name] || name;
  ctx.tag(name, S.mine.has(name) ? `您的车 ${plate}` : `取车 ${plate}`);
  ctx.highlight({ follow: name });
  const steps = g.request(sid);
  const t = totalTime(steps);
  kioskShow(`正在为您取车：${plate}`, `车在${g.slotLabel(sid)}，预计 ${t.toFixed(0)} 秒后到出口。`);
  await runSteps(steps, 'retrieve', ['pick', name, sid]);
  ctx.clearHighlight();
  S.clockMin += t / 60;
  const stay = S.clockMin - (name in S.parkedAt ? S.parkedAt[name] : S.clockMin);
  delete S.parkedAt[name];
  delete S.plates[name];
  S.mine.delete(name);
  kioskShow('取车完成，一路顺风',
    `车牌　${plate}\n停车　${Math.floor(stay / 60)} 小时 ${Math.floor(stay % 60)} 分（模拟）\n等车　${t.toFixed(0)} 秒`,
    [['完成', () => choose(1), true]]);
  await waitChoice();
  kioskIdle();
}

// ================= 控件 =================
function onPause() {
  S.paused = !S.paused;
  $('pause').textContent = S.paused ? '继续 ▶' : '暂停 ‖';
  $('pause').classList.toggle('on', S.paused);
}

ALL.forEach((C, i) => {
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = C.title;
  $('type').append(o);
});
$('type').onchange = () => {
  const i = +$('type').value;
  if (S.busy) $('type').value = String(S.idx);      // 正在执行时不允许切换，把菜单拨回去
  submit(['switch', i]);
};
for (const b of document.querySelectorAll('#modeSeg button')) b.onclick = () => setMode(b.dataset.mode);
for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setCamera(b.dataset.view);
$('reset').onclick = () => submit(['switch', S.idx]);
$('cmpBtn').onclick = () => submit(['compare']);
$('cmpClose').onclick = () => { $('cmp').hidden = true; };
$('cmp').onclick = (e) => { if (e.target === $('cmp')) $('cmp').hidden = true; };
$('speed').oninput = () => { $('speedTxt').textContent = `${speedValue()}x`; };
$('pause').onclick = onPause;
$('auto').onclick = () => submit(['auto']);
$('randOut').onclick = () => submit(['random_out']);
$('next').onclick = () => { S.next = true; };
$('introToggle').onclick = () => { S.introOpen = !S.introOpen; renderIntro(); };
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); onPause(); }
  if (e.key === 'n' || e.key === 'N') S.next = true;
});

// 网址参数：?type=3（0~5 选车库）&mode=lab
const qs = new URLSearchParams(location.search);
const startType = Math.max(0, Math.min(ALL.length - 1, +(qs.get('type') || 0)));
resize();
switchTo(startType);
setMode(qs.get('mode') === 'lab' ? 'lab' : 'driver');
requestAnimationFrame(loop);

// 给自动化测试用的入口
window.PARK = { S, submit, choose, ctx, ALL };
