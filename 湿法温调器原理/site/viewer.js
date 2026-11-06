// 3D 查看器：加载 Blender 导出的 GLB，悬停显示零件名称与说明，点击零件标签可“聚焦”
import * as THREE from 'three';
import { GLTFLoader } from './lib/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from './lib/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from './lib/jsm/environments/RoomEnvironment.js';

let active = null; // 同一时间只保留一个 WebGL 场景，省显存

function disposeActive() {
  if (!active) return;
  cancelAnimationFrame(active.raf);
  active.ro.disconnect();
  active.renderer.dispose();
  active.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  active.host.querySelector('canvas')?.remove();
  active.host.classList.remove('live');
  active = null;
}

export function open3D(host, url) {
  disposeActive();
  const stage = host.querySelector('.stage');
  const tip = host.querySelector('.tip');
  const chips = host.querySelector('.chips');
  const status = host.querySelector('.status');
  status.textContent = '加载 3D 模型中…';
  host.classList.add('live');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const ctl = new OrbitControls(cam, renderer.domElement);
  ctl.enableDamping = true; ctl.autoRotate = true; ctl.autoRotateSpeed = 0.6;
  renderer.domElement.addEventListener('pointerdown', () => ctl.autoRotate = false);

  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(stage); resize();

  const clock = new THREE.Clock();
  let mixer = null;
  const meshes = [];
  const st = { renderer, scene, host, ro, raf: 0 };
  active = st;

  const onLoad = gltf => {
    if (active !== st) return;
    const root = gltf.scene;
    scene.add(root);
    root.traverse(o => {
      if (o.isMesh) {
        // glTF extras 在节点上；Blender 曲线转网格后标签也在节点上
        let p = o, ud = {};
        while (p && !ud.label) { ud = p.userData || {}; p = p.parent; }
        o.userData.label = ud.label || ''; o.userData.desc = ud.desc || '';
        o.material = o.material.clone();
        o.userData.baseOpacity = o.material.opacity;
        o.userData.baseTransparent = o.material.transparent;
        if (o.material.transparent) o.material.depthWrite = false;
        meshes.push(o);
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length();
    ctl.target.copy(c);
    cam.position.copy(c).add(new THREE.Vector3(0.55, 0.45, 0.9).normalize().multiplyScalar(s * 1.05));
    cam.near = s / 100; cam.far = s * 20; cam.updateProjectionMatrix();
    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(root);
      gltf.animations.forEach(a => mixer.clipAction(a).play());
    }
    // 零件标签（去重）
    const labels = [...new Set(meshes.map(m => m.userData.label).filter(Boolean))];
    chips.innerHTML = '';
    let focus = null;
    labels.forEach(l => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = l;
      b.onclick = () => {
        focus = focus === l ? null : l;
        chips.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x.textContent === focus));
        meshes.forEach(m => {
          const dim = focus && m.userData.label !== focus;
          m.material.transparent = dim || m.userData.baseTransparent;
          m.material.opacity = dim ? 0.06 : m.userData.baseOpacity;
          m.material.depthWrite = !m.material.transparent;
        });
        const hit = meshes.find(m => m.userData.label === l);
        if (focus && hit) { tip.innerHTML = `<b>${l}</b>${hit.userData.desc ? '<br>' + hit.userData.desc : ''}`; tip.style.display = 'block'; tip.style.left = '12px'; tip.style.top = '12px'; }
        else tip.style.display = 'none';
      };
      chips.appendChild(b);
    });
    status.textContent = '拖动旋转 · 滚轮缩放 · 鼠标悬停看零件 · 点下方标签单独显示';
  };
  const onErr = err => {
    status.textContent = '模型加载失败：请用「启动源码版.bat」打开，或打开单文件离线版 index.html';
    console.error(err);
  };
  const loader = new GLTFLoader();
  const name = url.split('/').pop().replace('.glb', '');
  if (window.__GLB && window.__GLB[name]) {
    // 离线单文件版：模型以 base64 内嵌在网页里
    const bin = Uint8Array.from(atob(window.__GLB[name]), c => c.charCodeAt(0));
    loader.parse(bin.buffer, '', onLoad, onErr);
  } else {
    loader.load(url, onLoad, undefined, onErr);
  }

  // 悬停提示：优先选不太透明的零件（外壳是半透明示意，不挡住里面）
  const ray = new THREE.Raycaster(), mp = new THREE.Vector2();
  renderer.domElement.addEventListener('pointermove', e => {
    const r = renderer.domElement.getBoundingClientRect();
    mp.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mp, cam);
    const hits = ray.intersectObjects(meshes, false).filter(h => h.object.material.opacity > 0.05 && h.object.userData.label);
    const h = hits.find(h => h.object.material.opacity >= 0.5) || hits[0];
    if (h) {
      tip.innerHTML = `<b>${h.object.userData.label}</b>${h.object.userData.desc ? '<br>' + h.object.userData.desc : ''}`;
      tip.style.display = 'block';
      tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 260) + 'px';
      tip.style.top = (e.clientY - r.top + 14) + 'px';
    } else tip.style.display = 'none';
  });
  renderer.domElement.addEventListener('pointerleave', () => tip.style.display = 'none');

  const loop = () => {
    st.raf = requestAnimationFrame(loop);
    const dt = clock.getDelta();
    if (mixer) mixer.update(dt);
    ctl.update();
    renderer.render(scene, cam);
  };
  loop();
}

export function close3D() { disposeActive(); }
