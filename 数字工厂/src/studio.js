// 20-studio：渲染器、摄影棚灯光、虚空地面网格、相机机位
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { C, damp, clamp } from './util.js';
import { VIEW_OVERVIEW, HALL } from './layout.js';

export function createStudio(canvas, opt) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !!opt.raw, powerPreference: 'high-performance', stencil: false });
  const dprCap = opt.lq ? 1 : 1.75;
  renderer.setPixelRatio(opt.pr ?? Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.void);
  scene.fog = new THREE.Fog(C.void, 260, 980);
  scene.matrixWorldAutoUpdate = false;

  // 环境反射：程序化房间 → PMREM（只用于反射，压低强度保持暗棚）
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = env;
  pm.dispose();

  const camera = new THREE.PerspectiveCamera(29, window.innerWidth / window.innerHeight, 0.4, 3200);

  // 主光：左上暖色柔光（相对默认西南机位）
  const key = new THREE.DirectionalLight(0xffeedd, 2.6);
  const kdir = new THREE.Vector3(-0.52, 0.8, -0.3).normalize();
  key.position.copy(kdir).multiplyScalar(180);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  const sm = opt.lq ? 2048 : 4096;
  key.shadow.mapSize.set(sm, sm);
  const sc = key.shadow.camera;
  sc.left = -122; sc.right = 122; sc.top = 84; sc.bottom = -84; sc.near = 20; sc.far = 400;
  key.shadow.bias = -0.00035; key.shadow.normalBias = 0.035;
  key.shadow.radius = 2.2;
  scene.add(key, key.target);

  // 右侧冷轮廓光
  const rim = new THREE.DirectionalLight(0x9fbfff, 0.75);
  rim.position.set(160, 70, -90);
  scene.add(rim);
  // 低位补光 + 天地半球
  const hemi = new THREE.HemisphereLight(0x8e939c, 0x2a241f, 0.62);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xffe2c0, 0.25);
  fill.position.set(-60, 30, 140);
  scene.add(fill);

  // 虚空地面：暖石墨 + 微弱网格，远处淡出
  const gridMat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(C.void) }, uLine: { value: new THREE.Color(0x2a2724) }, uFogNear: { value: 260 }, uFogFar: { value: 980 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uCol; uniform vec3 uLine; varying vec3 vW;
      float grid(vec2 p, float s, float w){ vec2 g = abs(fract(p/s - 0.5) - 0.5)*s; vec2 fw = fwidth(p)*w; vec2 l = 1.0 - smoothstep(vec2(0.0), fw, g); return max(l.x,l.y); }
      void main(){
        float r = length(vW.xz*vec2(0.75,1.0));
        float fade = 1.0 - smoothstep(150.0, 520.0, r);
        float g = grid(vW.xz, 8.0, 1.0)*0.45 + grid(vW.xz, 40.0, 1.4)*0.75;
        vec3 c = mix(uCol, uLine, g*fade);
        c += vec3(0.012,0.010,0.008) * (1.0 - smoothstep(60.0, 380.0, r));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    depthWrite: true,
  });
  gridMat.extensions = { derivatives: true };
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), gridMat);
  grid.rotation.x = -Math.PI / 2; grid.position.y = HALL.apron - 0.06;
  grid.matrixAutoUpdate = true; grid.updateMatrix();
  scene.add(grid);

  return { renderer, scene, camera, key, rim, hemi, env };
}

// 相机机位：target + 方位角 azim（0 = 正南看北）+ 仰角 elev + 距离 dist + fov
export class CamRig {
  constructor(camera) {
    this.cam = camera;
    this.cur = { ...VIEW_OVERVIEW };
    this.goal = { ...VIEW_OVERVIEW };
    this.k = 2.8;
    this.par = { x: 0, y: 0, gx: 0, gy: 0 };
    this.idle = 0; this.drift = true; this.locked = false;
    this.pos = new THREE.Vector3();
  }
  set(v, instant = false) {
    Object.assign(this.goal, v);
    if (instant) Object.assign(this.cur, this.goal);
  }
  setArr(a) { const [tx, ty, tz, azim, elev, dist, fov] = a; this.cur.tx = tx; this.cur.ty = ty; this.cur.tz = tz; this.cur.azim = azim; this.cur.elev = elev; this.cur.dist = dist; this.cur.fov = fov; Object.assign(this.goal, this.cur); }
  clampGoal() {
    const g = this.goal;
    g.elev = clamp(g.elev, 0.04, 1.48);
    g.dist = clamp(g.dist, 6, 560);
    g.tx = clamp(g.tx, -140, 140); g.tz = clamp(g.tz, -110, 110); g.ty = clamp(g.ty, 0, 30);
    g.fov = clamp(g.fov, 18, 60);
  }
  update(dt, still) {
    if (!this.locked) {
      this.idle += dt;
      if (this.drift && !still && this.idle > 7) this.goal.azim += dt * 0.012 * Math.min(1, (this.idle - 7) / 4);
      this.clampGoal();
      const c = this.cur, g = this.goal, k = this.k;
      for (const p of ['tx', 'ty', 'tz', 'azim', 'elev', 'fov']) c[p] = damp(c[p], g[p], k, dt);
      c.dist = Math.exp(damp(Math.log(c.dist), Math.log(g.dist), k, dt));
    }
    this.par.x = damp(this.par.x, still ? 0 : this.par.gx, 2.5, dt);
    this.par.y = damp(this.par.y, still ? 0 : this.par.gy, 2.5, dt);
    this.apply();
  }
  apply() {
    const c = this.cur;
    const az = c.azim + this.par.x * 0.012, el = c.elev + this.par.y * 0.008;
    const ce = Math.cos(el);
    // 竖屏时拉远，保证横向能看全
    const asp = this.cam.aspect; const f = asp < 1.25 ? Math.pow(1.25 / asp, 0.8) : 1;
    const D = c.dist * (1 + (f - 1) * Math.min(1, Math.max(0, (c.dist - 50) / 60))); // 只拉远远景，室内机位不动（巡游路径不变）
    this.pos.set(c.tx + D * ce * Math.sin(az), c.ty + D * Math.sin(el), c.tz + D * ce * Math.cos(az));
    if (this.pos.y < 0.8) this.pos.y = 0.8;
    this.cam.position.copy(this.pos);
    this.cam.lookAt(c.tx, c.ty, c.tz);
    if (Math.abs(this.cam.fov - c.fov) > 1e-3) { this.cam.fov = c.fov; this.cam.updateProjectionMatrix(); }
    this.cam.updateMatrixWorld();
  }
  touch() { this.idle = 0; }
}
