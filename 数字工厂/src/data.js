// 60-data：琥珀数据层 —— 分区轮廓、能源流、物料流、扫描带、孪生包络、工位信标、选中高亮、剖切线
import * as THREE from 'three';
import { ZONES, STATIONS, HALL, LINES } from './layout.js';
import { SIM } from './sim.js';
import { textPlate } from './util.js';

const AMBER = new THREE.Color(0xf2a73b);
const STATE_COL = { run: new THREE.Color(0x9ed6b4), idle: new THREE.Color(0xf2a73b), down: new THREE.Color(0xff5638) };

function lineMat(opacity = 0.9, color = AMBER) {
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false });
  return m;
}
function dotTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}

export function buildData(ctx) {
  const { scene } = ctx;
  const G = new THREE.Group(); G.name = 'dataLayer'; scene.add(G);
  const uTime = { value: 0 };
  const dyn = [];

  // ---------- 分区轮廓 + 角标 + 填充 + 地面编号 ----------
  const zoneFill = [];
  {
    const pos = [];
    const seg = (a, b) => pos.push(...a, ...b);
    const y = 0.07;
    for (const z of ZONES) {
      const [x0, x1, z0, z1] = z.rect;
      seg([x0, y, z0], [x1, y, z0]); seg([x1, y, z0], [x1, y, z1]); seg([x1, y, z1], [x0, y, z1]); seg([x0, y, z1], [x0, y, z0]);
      const t = 2.2, g = 0.6; // 外延角标
      for (const [cx, cz, sx, sz] of [[x0, z0, -1, -1], [x1, z0, 1, -1], [x1, z1, 1, 1], [x0, z1, -1, 1]]) {
        seg([cx + sx * g, y, cz + sz * g], [cx + sx * (g + t), y, cz + sz * g]);
        seg([cx + sx * g, y, cz + sz * g], [cx + sx * g, y, cz + sz * (g + t)]);
      }
      // 半透明填充
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.035, depthWrite: false, fog: false }));
      fill.rotation.x = -Math.PI / 2; fill.position.set((x0 + x1) / 2, 0.035, (z0 + z1) / 2); fill.renderOrder = 2; G.add(fill);
      zoneFill.push({ id: z.id, mesh: fill });
      // 地面编号牌
      const tex = textPlate([{ t: z.id, size: 120, x: 20, y: 76, color: '#f2a73b' }, { t: z.cn, size: 58, x: 22, y: 170, color: '#f2c37b' }, { t: z.en, size: 30, x: 24, y: 226, color: '#c9a46a' }], { w: 512, h: 256 });
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
      plate.rotation.x = -Math.PI / 2; plate.position.set(x1 - 3.6, 0.05, z0 + 2.0); plate.renderOrder = 3; G.add(plate);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const ls = new THREE.LineSegments(geo, lineMat(0.95)); ls.renderOrder = 4; G.add(ls);
  }

  // ---------- 剖切线（西墙切口 / 南侧板边） ----------
  {
    const pos = [];
    pos.push(-78.15, HALL.west + 0.2, -40, -78.15, HALL.west + 0.2, 40);
    pos.push(-78.3, 1.2, 40.3, 78.3, 1.2, 40.3);
    pos.push(-78.3, HALL.west + 0.2, 40.3, -78.3, 1.2, 40.3);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    G.add(new THREE.LineSegments(geo, lineMat(0.7)));
  }

  // ---------- 能源流：室外能源站 → 穿北墙 → 主干 + 6 支路 ----------
  const flowMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uCol: { value: AMBER.clone() }, uOp: { value: 1 } },
    vertexShader: `attribute float aS; varying float vS; void main(){ vS = aS; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; uniform vec3 uCol; uniform float uOp; varying float vS;
      void main(){
        float dash = step(0.42, fract(vS/1.8 - uTime*0.7));
        float d = mod(vS - uTime*16.0, 46.0) - 3.0;
        float pulse = exp(-d*d/3.0);
        vec3 c = uCol*(0.6 + 0.8*dash) + vec3(1.0,0.74,0.36)*pulse*0.9;
        float a = (0.22 + 0.5*dash + 0.5*pulse) * uOp;
        gl_FragColor = vec4(c*a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const routes = [];
  const Y = 10.7, ZT = -38.7;
  routes.push([[-35.6, HALL.apron + 6, -48.5], [-35.6, Y, -48.5], [-35.6, Y, ZT]]);           // 室外 → 穿墙
  routes.push([[-35.6, Y, ZT], [69, Y, ZT]]);                                                  // 主干（东）
  routes.push([[-35.6, Y, ZT], [-55, Y, ZT]]);                                                 // 主干（西）
  routes.push([[-55, Y, ZT], [-55, Y, -10], [-55, 0.3, -10]]);                                 // Z01
  routes.push([[-30, Y, ZT], [-30, Y, -27.6], [-30, 0.5, -27.6]]);                             // Z02
  routes.push([[-38, Y, ZT], [-38, Y, 7.2], [-38, 0.3, 7.2]]);                                   // Z03
  routes.push([[2, Y, ZT], [2, Y, -27.3], [2, 7.3, -27.3]]);                                   // Z04
  routes.push([[40, Y, ZT], [40, Y, 20], [40, 0.3, 20]]);                                      // Z05
  routes.push([[68, Y, ZT], [68, Y, 20], [68, 3.5, 20]]);                                      // Z06
  const flowGeos = []; const linePos = [];
  for (const r of routes) {
    const cp = new THREE.CurvePath(); let L = 0;
    for (let i = 1; i < r.length; i++) { const a = new THREE.Vector3(...r[i - 1]), b = new THREE.Vector3(...r[i]); cp.add(new THREE.LineCurve3(a, b)); L += a.distanceTo(b); linePos.push(...r[i - 1], ...r[i]); }
    const g = new THREE.TubeGeometry(cp, Math.max(8, Math.ceil(L / 1.5)), 0.08, 6, false);
    const uv = g.attributes.uv; const aS = new Float32Array(uv.count);
    for (let i = 0; i < uv.count; i++) aS[i] = uv.getX(i) * L;
    g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    flowGeos.push(g.index ? g.toNonIndexed() : g);
  }
  {
    // 合并成一次绘制
    let n = 0; for (const g of flowGeos) n += g.attributes.position.count;
    const P = new Float32Array(n * 3), S = new Float32Array(n); let o = 0;
    for (const g of flowGeos) { P.set(g.attributes.position.array, o * 3); S.set(g.attributes.aS.array, o); o += g.attributes.position.count; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('aS', new THREE.BufferAttribute(S, 1));
    const mesh = new THREE.Mesh(geo, flowMat); mesh.frustumCulled = false; mesh.renderOrder = 5; G.add(mesh);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    G.add(new THREE.LineSegments(lg, lineMat(0.35)));
  }

  // ---------- 物料流：移动光点 ----------
  const mfPaths = [];
  if (ctx.agvPath) mfPaths.push({ p: ctx.agvPath, n: 14, v: 2.4 });
  const linePath = (z) => ({ L: 45, at: (s, o) => { o.x = 17.5 + s; o.y = 2.2; o.z = z; return o; } });
  for (const L of LINES) mfPaths.push({ p: linePath(L.z), n: 6, v: 1.3 });
  const nDots = mfPaths.reduce((a, m) => a + m.n, 0);
  const dPos = new Float32Array(nDots * 3);
  const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3).setUsage(THREE.DynamicDrawUsage));
  const dots = new THREE.Points(dGeo, new THREE.PointsMaterial({ color: 0xf6c06a, size: 7, sizeAttenuation: false, map: dotTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  dots.frustumCulled = false; dots.renderOrder = 6; G.add(dots);
  let mfT = 0;
  dyn.push((dt) => {
    mfT += dt * SIM.rate; let k = 0; const o = {};
    for (const m of mfPaths) for (let i = 0; i < m.n; i++) {
      const s = (mfT * m.v + (i / m.n) * m.p.L) % m.p.L; m.p.at(s, o);
      dPos[k * 3] = o.x; dPos[k * 3 + 1] = (o.y || 0) + 1.1; dPos[k * 3 + 2] = o.z; k++;
    }
    dGeo.attributes.position.needsUpdate = true;
  });

  // ---------- 地面扫描带 ----------
  const scanMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uCol: { value: AMBER.clone() } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uCol; varying vec3 vW;
      void main(){
        float x = -86.0 + mod(uTime*11.0, 176.0);
        float d = vW.x - x;
        float band = exp(-d*d/5.0) * 0.5 + exp(-max(0.0,-d)/9.0) * step(d, 0.0) * 0.08;
        vec2 g = abs(fract(vW.xz/2.0 - 0.5) - 0.5)*2.0; float grid = 1.0 - smoothstep(0.0, 0.06, min(g.x, g.y));
        float a = band * (0.35 + 0.65*grid) * 0.55;
        gl_FragColor = vec4(uCol*a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(156, 80), scanMat); scan.rotation.x = -Math.PI / 2; scan.position.y = 0.04; scan.renderOrder = 1; G.add(scan);

  // ---------- 数字孪生虚线包络 ----------
  {
    const boxes = [[-76, -58, 0, 21, -32.5, 20.5], [-46.2, -14.6, 0, 9.4, -22.8, -17.2], [-8.6, 12.9, 0, 6.2, -21.5, -7], [-8, 12.4, 0, 7.6, -31, -23.6], [17, 62.2, 0, 3.6, 8.6, 15.4], [17, 62.2, 0, 3.6, 24.6, 31.4], [63.4, 69.8, 0, 3.6, 9.8, 14.2], [63.4, 69.8, 0, 3.6, 25.8, 30.2], [17, 33, 0, 4.4, -39.6, -28]];
    const mat = new THREE.LineDashedMaterial({ color: AMBER, dashSize: 0.7, gapSize: 0.45, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
    for (const [x0, x1, y0, y1, z0, z1] of boxes) {
      const e = new THREE.EdgesGeometry(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0));
      const ls = new THREE.LineSegments(e, mat); ls.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); ls.computeLineDistances(); G.add(ls);
    }
  }

  // ---------- 工位信标 ----------
  const bGeo = new THREE.SphereGeometry(0.26, 18, 12);
  const bMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const beacons = new THREE.InstancedMesh(bGeo, bMat, STATIONS.length); beacons.frustumCulled = false;
  const haloMat = new THREE.SpriteMaterial({ map: dotTex(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const halos = []; const rings = [];
  const ringGeo = new THREE.RingGeometry(0.9, 1.0, 48);
  const stemPos = [];
  STATIONS.forEach((s, i) => {
    const sp = new THREE.Sprite(haloMat.clone()); sp.position.set(...s.beacon); sp.scale.setScalar(1.4); G.add(sp); halos.push(sp);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff5638, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending }));
    ring.position.set(...s.beacon); ring.visible = false; G.add(ring); rings.push(ring);
    const floorY = s.id === 'EN-01' ? HALL.apron : 0;
    stemPos.push(s.beacon[0], s.beacon[1] - 0.4, s.beacon[2], s.beacon[0], floorY + 0.05, s.beacon[2]);
  });
  G.add(beacons);
  { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(stemPos, 3)); G.add(new THREE.LineSegments(g, lineMat(0.32))); }
  const m4 = new THREE.Matrix4(), col = new THREE.Color(), _bp = new THREE.Vector3();
  dyn.push((dt, time, camera) => {
    STATIONS.forEach((s, i) => {
      const st = SIM.state(s.id);
      // 离镜头近时缩小，不让近景里的信标糊成一大团
      const near = Math.min(1, Math.max(0.4, camera.position.distanceTo(_bp.set(s.beacon[0], s.beacon[1], s.beacon[2])) / 42));
      const breathe = (1 + Math.sin(time * (st === 'down' ? 7 : 2.2) + i) * (st === 'down' ? 0.18 : 0.08)) * near;
      m4.makeScale(breathe, breathe, breathe).setPosition(...s.beacon); beacons.setMatrixAt(i, m4);
      col.copy(STATE_COL[st]).multiplyScalar(st === 'down' ? 3.0 : 2.0); beacons.setColorAt(i, col);
      halos[i].material.color.copy(STATE_COL[st]).multiplyScalar(st === 'down' ? 0.6 : 0.28);
      halos[i].scale.setScalar(1.3 * breathe + (st === 'down' ? 0.7 * near : 0));
      const r = rings[i];
      if (st === 'down') {
        r.visible = true; const u = (time * 0.9 + i * 0.13) % 1;
        r.scale.setScalar((0.6 + u * 3.6) * near); r.material.opacity = (1 - u) * 0.9; r.quaternion.copy(camera.quaternion);
      } else r.visible = false;
    });
    beacons.instanceMatrix.needsUpdate = true; if (beacons.instanceColor) beacons.instanceColor.needsUpdate = true;
  });

  // ---------- 选中高亮 ----------
  const selGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const sel = new THREE.LineSegments(selGeo, lineMat(1.0, new THREE.Color(0xffc56a))); sel.visible = false; sel.renderOrder = 9; scene.add(sel);
  // 选中时只在地面铺一层淡底（不用整块体积：隔着它看，里面的设备会整片发灰发黄）
  const selFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.07, depthWrite: false, fog: false })); selFill.visible = false; selFill.renderOrder = 2; scene.add(selFill);
  const setSelection = (box) => {
    if (!box) { sel.visible = selFill.visible = false; return; }
    const [x0, x1, y0, y1, z0, z1] = box;
    sel.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); sel.scale.set(x1 - x0 + 0.4, y1 - y0 + 0.3, z1 - z0 + 0.4); sel.visible = true;
    const big = (x1 - x0) * (z1 - z0) > 600; // 分区本来就有地面填充，不再叠一层
    selFill.position.set((x0 + x1) / 2, Math.max(0, y0) + 0.045, (z0 + z1) / 2); selFill.scale.set(x1 - x0 + 0.4, 1, z1 - z0 + 0.4); selFill.visible = !big && y0 < 1;
  };

  ctx.data = {
    group: G, zoneFill, setSelection, sel,
    setVisible(v) { G.visible = v; },
    highlightZone(id) { for (const z of zoneFill) z.mesh.material.opacity = z.id === id ? 0.11 : 0.035; },
    update(dt, time, camera) { uTime.value = time; for (const f of dyn) f(dt, time, camera); const k = 0.75 + 0.25 * Math.sin(time * 3); sel.material.opacity = k; },
  };
}
