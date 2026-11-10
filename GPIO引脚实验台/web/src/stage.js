// 三维舞台：加载 Blender 导出的开发板，按引脚电平给走线上色、点亮 LED、按下按键，点零件选引脚
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import glb from '../../blender/out/board.glb';

// 和页面里的颜色含义一致：橙 = 高电平，蓝 = 低电平，灰 = 悬空，红 = 短路
const COL = {
  H: new THREE.Color('#ff8a3d'), L: new THREE.Color('#3d86e0'),
  Z: new THREE.Color('#7d8a90'), X: new THREE.Color('#ff3b30'),
};

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,130,40,.9)'); r.addColorStop(0.35, 'rgba(255,90,20,.35)'); r.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(3, 6, 4); scene.add(sun);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const dir = new THREE.Vector3(0.0, 0.82, 0.57).normalize();
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false; controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 3; controls.maxDistance = 22;
  controls.target.set(0, 0, 0);

  const traces = [], leds = [], glows = [], pickable = [];
  let cap = null, capY = 0, view = null, pickCb = null, ready = false, dirty = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 10, 40), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  ring.rotation.x = Math.PI / 2; ring.visible = false; scene.add(ring);
  const legPos = [];
  const tex = glowTexture();

  const u8 = glb;
  new GLTFLoader().parse(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), '', (g) => {
    scene.add(g.scene);
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      let m = /^(TRACE|LEG|LED)_(\d)$/.exec(o.name);
      if (m) {
        const n = +m[2];
        o.userData.pin = n; pickable.push(o);
        if (m[1] === 'TRACE') { o.material = o.material.clone(); traces[n] = o; }
        if (m[1] === 'LED') {
          o.material = o.material.clone(); leds[n] = o;
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
          s.position.copy(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())); s.position.y += 0.06;
          s.scale.setScalar(0.95); s.visible = false; scene.add(s); glows[n] = s;
        }
        if (m[1] === 'LEG') legPos[n] = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      } else if (o.name === 'PAD_6') { o.userData.pin = 6; pickable.push(o); }
      else if (o.name === 'BTN_cap' || o.name === 'BTN_base') {
        o.userData.pin = 7; pickable.push(o);
        if (o.name === 'BTN_cap') { cap = o; capY = o.position.y; }
      }
    });
    ready = true; apply(); dirty = true;
  }, (e) => console.error('模型加载失败', e));

  function apply() {
    if (!ready || !view) return;
    for (let n = 0; n < 8; n++) {
      const t = traces[n]; if (!t) continue;
      const lv = view.levels[n], c = COL[lv] || COL.Z;
      t.material.color.copy(c);
      t.material.emissive.copy(c);
      t.material.emissiveIntensity = lv === 'H' ? 0.55 : lv === 'L' ? 0.4 : lv === 'X' ? 1.0 : 0.05;
    }
    for (let n = 0; n < 6; n++) {
      const on = !!view.leds[n];
      if (leds[n]) { leds[n].material.emissive.set('#ff6a1a'); leds[n].material.emissiveIntensity = on ? 1.6 : 0; }
      if (glows[n]) glows[n].visible = on;
    }
    if (cap) cap.position.y = capY - (view.btn ? 0.07 : 0);
    const p = legPos[view.sel];
    ring.visible = !!p;
    if (p) { ring.position.copy(p); ring.position.y += 0.03; ring.material.color.copy(COL[view.levels[view.sel]] || COL.Z).lerp(new THREE.Color('#ffffff'), 0.35); }
    dirty = true;
  }

  function fit() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const v = THREE.MathUtils.degToRad(camera.fov) / 2, hz = Math.atan(Math.tan(v) * camera.aspect);
    const dist = Math.max(2.9 / Math.tan(v), 3.7 / Math.tan(hz));
    camera.position.copy(dir).multiplyScalar(dist);
    camera.updateProjectionMatrix(); controls.update(); dirty = true;
  }
  fit();
  new ResizeObserver(fit).observe(canvas);
  controls.addEventListener('change', () => { dirty = true; });

  // 点一下（不是拖）才算选引脚
  const ray = new THREE.Raycaster(); let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    ray.params.Line = { threshold: 0.05 };
    const hit = ray.intersectObjects(pickable, false)[0];
    if (hit && pickCb) pickCb(hit.object.userData.pin);
  });

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  (function loop(t) {
    requestAnimationFrame(loop);
    const shorted = ready && view && view.levels.includes('X');
    if (shorted && !reduce) {           // 短路的走线闪烁
      const k = 0.5 + 0.5 * Math.sin((t || 0) / 90);
      view.levels.forEach((lv, n) => { if (lv === 'X' && traces[n]) traces[n].material.emissiveIntensity = 0.4 + 1.6 * k; });
      dirty = true;
    }
    if (controls.update()) dirty = true;
    if (dirty) { renderer.render(scene, camera); dirty = false; }
  })();

  return {
    set(v) { view = v; apply(); },
    onPick(fn) { pickCb = fn; },
  };
}
