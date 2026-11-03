// 三维舞台：加载 GLB，画气流点，处理机位、爆炸、标注
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const V = (x, y, z) => new THREE.Vector3(x, z, -y);       // Blender 坐标 → three
const ease = (t) => t * t * (3 - 2 * t);

const VERT = /* glsl */`
uniform sampler2D uPaths; uniform float uTime, uM, uPx, uSize, uDust, uDpr;
attribute vec4 aA;  // path, phase0, y, mirror
attribute vec2 aB;  // rate, thresh
varying vec3 vC; varying float vO;
void main(){
  float ph = fract(aA.y + uTime * aB.x);
  float fi = ph * uM; int i0 = int(floor(fi)); int i1 = (i0 + 1) % int(uM); float f = fract(fi);
  int row = int(aA.x + .5);
  vec3 s = mix(texelFetch(uPaths, ivec2(i0, row), 0).xyz, texelFetch(uPaths, ivec2(i1, row), 0).xyz, f);
  vec4 mv = modelViewMatrix * vec4(aA.w * s.x, s.y, -aA.z, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize * uPx / -mv.z, 6.5 * uDpr);
  if (uDust > .5) { vC = vec3(1., .36, .47); vO = smoothstep(aB.y, aB.y + .012, ph) * .95; }
  else { vC = mix(vec3(.30,.70,1.), vec3(1.,.58,.26), s.z); vO = .82; }
}`;
const FRAG = /* glsl */`
varying vec3 vC; varying float vO;
void main(){ float r = length(gl_PointCoord - .5); if (r > .5 || vO < .01) discard;
  gl_FragColor = vec4(vC, vO * smoothstep(.5, .15, r)); }`;

export function createStage({ canvas, glb, pathsBin, spec, pinsEl, onPin }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#10171B');
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture;
  scene.environmentIntensity = .42;
  const cam = new THREE.PerspectiveCamera(26, 1.6, .1, 300);
  const ctl = new OrbitControls(cam, canvas);
  ctl.enableDamping = true; ctl.dampingFactor = .08; ctl.maxDistance = 95; ctl.minDistance = 1.2;
  canvas.style.touchAction = 'pan-y';

  scene.add(new THREE.HemisphereLight('#DCEBF2', '#39424A', 1.15));
  const key = new THREE.DirectionalLight('#FFFFFF', 2.1);
  key.position.set(-12, 22, 34);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 90 });
  key.shadow.bias = -.0008;
  key.shadow.normalBias = .02;
  key.target.position.set(0, 9, -3);
  scene.add(key, key.target);

  const state = { view: 'section', mode: 'fab', explode: 0, explodeTo: 0, air: true, dust: true, t: 0, fly: null, playing: true, ready: false, pins: [] };
  const groups = {};
  const fanSpin = [];
  const moved = [];

  function tuneMaterial(m) {
    const n = m.name;
    if (n === 'poche') return new THREE.MeshBasicMaterial({ color: '#242B31', name: n });
    if (n === 'led' || n === 'amber' || n === 'led_cyan') return new THREE.MeshBasicMaterial({ color: n === 'led' ? '#F4FBFF' : n === 'amber' ? '#FFB23E' : '#6FE0F5', name: n });
    if (n === 'glass') { m.transparent = true; m.opacity = .16; m.depthWrite = false; m.roughness = .1; m.metalness = 0; }
    if (n === 'foup') { m.transparent = true; m.opacity = .6; m.depthWrite = false; }
    if (n === 'water') { m.transparent = true; m.opacity = .75; }
    if (n === 'tile') { m.transparent = false; m.alphaTest = .5; m.side = THREE.DoubleSide; if (m.map) { m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping; m.map.anisotropy = 8; m.map.needsUpdate = true; } }
    if (n === 'media') m.side = THREE.DoubleSide;
    return m;
  }

  const ready = new Promise((resolve, reject) => {
    new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', (g) => {
      const seen = new Map();
      for (const name of ['fab', 'ffu', 'mau']) {
        const root = g.scene.getObjectByName('ROOT_' + name);
        root.position.set(0, 0, 0);
        groups[name] = root;
      }
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (!seen.has(o.material)) seen.set(o.material, tuneMaterial(o.material));
        o.material = seen.get(o.material);
        const fab = o.parent === groups.fab;
        o.castShadow = fab && !/glass|foup|poche/.test(o.material.name);
        o.receiveShadow = fab;
        o.userData.part = o.name.split('__')[0];
      });
      scene.add(g.scene);
      // 风机：FFU 叶轮绕自身轴转；MAU 风轮要换个枢轴
      groups.ffu.traverse((o) => { if (o.isMesh && o.userData.part === 'FFU_impeller') fanSpin.push([o, 'y', 1]); });
      const piv = new THREE.Group(); piv.position.copy(V(7.05, 1.2, 1.25)); groups.mau.add(piv);
      const list = []; groups.mau.traverse((o) => { if (o.isMesh && o.userData.part === 'MAU_09fan') list.push(o); });
      for (const o of list) { piv.add(o); o.position.sub(piv.position); }
      fanSpin.push([piv, 'x', 1.4]);
      // 爆炸位移记录
      groups.fab.traverse((o) => { if (o.isMesh) moved.push([o, o.position.y, spec.LAYERS[o.userData.part] ?? 0]); });
      groups.ffu.traverse((o) => { if (o.isMesh) moved.push([o, o.position.y, spec.EXPLODE[o.userData.part] ?? 0, true]); });
      buildAir();
      state.ready = true;
      resolve();
    }, reject);
  });

  // ---- 气流点 ----
  let airPts, dustPts, uni, extra;
  function buildAir() {
    const dv = new DataView(pathsBin.buffer, pathsBin.byteOffset, pathsBin.byteLength);
    const N = dv.getUint32(0, true), M = dv.getUint32(4, true);
    let o = 8;
    const period = [], pFloor = [];
    for (let i = 0; i < N; i++) { period.push(dv.getFloat32(o, true)); o += 4; }
    for (let i = 0; i < N; i++) { pFloor.push(dv.getFloat32(o, true)); o += 4; }
    const tex = new Float32Array(N * M * 4);
    for (let i = 0; i < N * M; i++) {
      tex[4 * i] = dv.getInt16(o, true) / 1000; tex[4 * i + 1] = dv.getInt16(o + 2, true) / 1000; tex[4 * i + 2] = dv.getInt16(o + 4, true) / 32767; tex[4 * i + 3] = 1;
      o += 6;
    }
    const dt = new THREE.DataTexture(tex, M, N, THREE.RGBAFormat, THREE.FloatType);
    dt.needsUpdate = true;
    uni = { uPaths: { value: dt }, uTime: { value: 0 }, uM: { value: M }, uPx: { value: 1 }, uSize: { value: 1 }, uDust: { value: 0 }, uDpr: { value: renderer.getPixelRatio() } };
    const make = (count, dust) => {
      const a = new Float32Array(count * 4), b = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const p = Math.floor(Math.random() * N);
        a[4 * i] = p; a[4 * i + 1] = Math.random(); a[4 * i + 2] = .12 + Math.random() * (spec.P.depth - .24); a[4 * i + 3] = i % 2 ? 1 : -1;
        b[2 * i] = 1 / period[p];
        b[2 * i + 1] = dust ? .03 + Math.random() * pFloor[p] : 0;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      g.setAttribute('aA', new THREE.BufferAttribute(a, 4));
      g.setAttribute('aB', new THREE.BufferAttribute(b, 2));
      const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
        uniforms: { ...uni, uSize: { value: dust ? 7.5 : 8.5 }, uDust: { value: dust ? 1 : 0 } } });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      scene.add(pts);
      return pts;
    };
    airPts = make(11000, false);
    dustPts = make(1500, true);
    buildStreams();
  }

  // 走折线的三股支流：新风、工艺排风、微环境
  function buildStreams() {
    const S = spec, rx = S.X_OUT + .6;
    const lines = [];
    const fresh = () => {
      const y = 2.9 + Math.random() * 1.4, dy = (Math.random() - .5) * 1.4;
      const end = [-5.5 + (Math.random() - .35) * 8, 1 + Math.random() * 5, 11.2 + Math.random() * 1.2];
      return { col: [.42, 1, .66], pts: [[6.6, y, 16.3 + dy * .6], [5, y, 16.3 + dy * .6], [-5.2, y, 16.3 + dy * .6], [-5.5, y, 14.8], [-5.5, 3.6 + (y - 3.6) * .8, 12.7], end], spd: .13 + Math.random() * .03 };
    };
    const exhaust = () => {
      const s = Math.random() < .5 ? -1 : 1, j = (Math.random() - .5) * .3, k = (Math.random() - .5) * .3;
      return { col: [1, .66, .28], pts: [[s * 3.6 + j * .3, 6.0, 7.0], [s * 3.6 + j * .3, 6.0, 4.1 + k], [rx + j, 6.3, 4.05 + k], [rx + j, 6.3, 15.35 + k], [9 + j, 6.3, 15.35 + k], [9 + j, 3.6, 15.35 + k], [9, 3.6, 18.6], [9, 3.6, 19.8]], spd: .11 + Math.random() * .03 };
    };
    const efem = () => {
      const s = Math.random() < .5 ? -1 : 1, x = 1.8 + (Math.random() - .5) * 1.1, y = (Math.random() < .5 ? 1.0 : 4.1) + Math.random() * 2.3;
      return { col: [.5, .93, 1], pts: [[s * x, y, 8.82], [s * x, y, 7.45]], spd: .55 + Math.random() * .2 };
    };
    const add = (fn, n) => { for (let i = 0; i < n; i++) { const l = fn(); l.ph = Math.random(); l.len = []; let s = 0; for (let k = 1; k < l.pts.length; k++) { const a = l.pts[k - 1], b = l.pts[k]; s += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); l.len.push(s); } l.L = s; lines.push(l); } };
    add(fresh, 420); add(exhaust, 280); add(efem, 300);
    const pos = new Float32Array(lines.length * 3), col = new Float32Array(lines.length * 3);
    lines.forEach((l, i) => col.set(l.col, 3 * i));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: .1, vertexColors: true, transparent: true, opacity: .75, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    scene.add(pts);
    extra = { lines, pos, g, pts };
  }
  function stepStreams(dt) {
    const { lines, pos, g } = extra;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      l.ph = (l.ph + dt * l.spd) % 1;
      const d = l.ph * l.L;
      let k = 0; while (k < l.len.length - 1 && l.len[k] < d) k++;
      const s0 = k ? l.len[k - 1] : 0, u = (d - s0) / (l.len[k] - s0);
      const a = l.pts[k], b = l.pts[k + 1];
      pos[3 * i] = a[0] + (b[0] - a[0]) * u; pos[3 * i + 1] = a[2] + (b[2] - a[2]) * u; pos[3 * i + 2] = -(a[1] + (b[1] - a[1]) * u);
    }
    g.attributes.position.needsUpdate = true;
  }

  // ---- 视图 ----
  function setMode(mode) {
    state.mode = mode;
    for (const k in groups) groups[k].visible = k === mode;
    syncAir();
  }
  function syncAir() {
    const v = state.mode === 'fab' && state.explode < .02;
    if (airPts) { airPts.visible = v && state.air; dustPts.visible = v && state.dust; extra.pts.visible = v && state.air; }
  }
  function aspectFit(pos, at) {
    const asp = cam.aspect, need = state.mode === 'fab' ? 1.55 : 1.5;
    if (asp >= need) return pos;
    const k = need / asp;
    return at.clone().add(pos.clone().sub(at).multiplyScalar(Math.min(k, 2.1)));
  }
  function fly(p, t, ms = 1100) {
    const at = V(...t), pos = aspectFit(V(...p), at);
    state.fly = { p0: cam.position.clone(), p1: pos, t0: ctl.target.clone(), t1: at, s: performance.now(), ms };
  }
  function jump(p, t) {
    const at = V(...t), pos = aspectFit(V(...p), at);
    cam.position.copy(pos); ctl.target.copy(at); ctl.update();
  }
  function setExplode(on) { state.explodeTo = on ? 1 : 0; }

  // ---- 标注针 ----
  function setPins(list) {
    pinsEl.textContent = '';
    state.pins = list.map((p, i) => {
      const b = document.createElement('button');
      b.className = 'pin'; b.type = 'button';
      b.innerHTML = `<b>${p.tag ?? i + 1}</b><span>${p.name}</span>`;
      b.addEventListener('click', () => onPin(p, i));
      pinsEl.append(b);
      return { el: b, at: V(...p.at), p };
    });
  }
  function activePin(i) { state.pins.forEach((q, k) => q.el.classList.toggle('on', k === i)); }
  const tmp = new THREE.Vector3();
  function layoutPins() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const q of state.pins) {
      tmp.copy(q.at);
      if (q.p.lift) tmp.y += q.p.lift * state.explode;
      tmp.project(cam);
      const vis = tmp.z < 1 && Math.abs(tmp.x) < 1 && Math.abs(tmp.y) < 1;
      q.el.style.display = vis ? '' : 'none';
      q.el.style.transform = `translate(${((tmp.x + 1) / 2 * w).toFixed(1)}px, ${((1 - tmp.y) / 2 * h).toFixed(1)}px)`;
    }
  }

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    cam.aspect = r.width / r.height; cam.updateProjectionMatrix();
    if (uni) { airPts.material.uniforms.uPx.value = r.height * renderer.getPixelRatio() / (2 * Math.tan(cam.fov * Math.PI / 360)) / 60; dustPts.material.uniforms.uPx.value = airPts.material.uniforms.uPx.value; }
  }
  new ResizeObserver(resize).observe(canvas.parentElement);

  let vis = true;
  new IntersectionObserver((e) => { vis = e[0].isIntersecting; }, { threshold: .01 }).observe(canvas);
  let last = performance.now();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!vis || !state.ready) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (state.fly) {
      const u = Math.min(1, (now - state.fly.s) / state.fly.ms), e = ease(u);
      cam.position.lerpVectors(state.fly.p0, state.fly.p1, e);
      ctl.target.lerpVectors(state.fly.t0, state.fly.t1, e);
      if (u >= 1) state.fly = null;
    }
    if (Math.abs(state.explode - state.explodeTo) > .001) {
      state.explode += Math.sign(state.explodeTo - state.explode) * Math.min(dt * 1.1, Math.abs(state.explodeTo - state.explode));
      const e = ease(state.explode);
      for (const [o, y0, d] of moved) o.position.y = y0 + d * e;
      syncAir();
    }
    if (!reduced) {
      state.t += dt * 4;
      if (uni) { airPts.material.uniforms.uTime.value = state.t; dustPts.material.uniforms.uTime.value = state.t; }
      if (extra && extra.pts.visible) stepStreams(dt);
      for (const [o, ax, k] of fanSpin) o.rotation[ax] += dt * 9 * k;
    }
    ctl.update();
    renderer.render(scene, cam);
    layoutPins();
  }
  ready.then(() => { resize(); requestAnimationFrame(frame); });
  return { ready, setMode, setExplode, fly, jump, setPins, activePin, state, syncAir, resize, renderer, scene, cam, ctl };
}
