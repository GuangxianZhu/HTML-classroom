// 能量流的画法（汽车模拟器和“飞度混动原理”共用；three.js 由调用方传进来）。
//
// 一种能量一种画法，不再是清一色的小圆点：
//   直流电   高压线外面套一层发亮的套管，上面跑箭头。粗细 = 功率，箭头方向 = 电往哪走（放电 / 充电）
//   交流电   每台电机三根铜排上各一条波，三条错开 120°；波的大小 = 功率，快慢跟转速
//   机械     半轴上转着的螺旋条纹（越密扭矩越大），前轮接地点一个箭头 = 路面推车的力（回收时朝后）
//   汽油     油管里一段一段往前走
//   废气     排气管里一团一团往后走
//   热       发动机、电驱单元上往上冒的热气，多少 = 损失掉的功率
// 轴和齿轮本身发不发亮由 ehev_rig.js 的 setGlow 管。
const TAU = Math.PI * 2;

export const FLOW_COL = { dc: '#ffb547', ac: '#c78bff', mech: '#4fe39a', regen: '#5ab4ff', fuel: '#ff6a4d', exhaust: '#a7b0bb', heat: '#ff8a5c' };
export const KINDS = { elec: '电', mech: '机械', fuel: '油和气', heat: '热' };

// 套管：顶点沿法向鼓出 uR。vS = 这一点在屏幕上离管子中线多远（−1…1，两边是轮廓），vF > 0 = 朝着镜头的那半边。
// 箭头按 vS 画，所以不管从哪边看都是一个尖朝前的“>”，前后两面不会叠成 X
const TUBE_V = `attribute vec3 aN; attribute vec3 aT; uniform float uR; varying vec2 vUv; varying float vS; varying float vF;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position + aN * uR, 1.);
  vec3 n = normalize(normalMatrix * aN), t = normalize(normalMatrix * aT), v = normalize(-mv.xyz);
  vec3 side = cross(t, v); float l = length(side);
  vS = l > 1e-4 ? dot(n, side / l) : 0.; vF = dot(n, v);
  gl_Position = projectionMatrix * mv;
}`;
const TUBE_F = `uniform vec3 uC; uniform float uT; uniform float uPitch; uniform float uA; uniform int uMode; uniform float uDir; uniform float uLen;
varying vec2 vUv; varying float vS; varying float vF;
void main(){
  float s = vUv.x / uPitch - uT;
  float a = abs(vS);
  float al;
  if (uMode == 3 && vF < 0.) discard;
  if (uMode == 0) { float f = fract(s + uDir * .55 * a); al = .16 + .84 * (smoothstep(0., .06, f) * (1. - smoothstep(.30, .36, f))); }
  else if (uMode == 1) { float f = fract(s); al = .10 + .90 * (smoothstep(0., .08, f) * (1. - smoothstep(.42, .55, f))); }
  else if (uMode == 2) { float f = fract(s); float q = sin(3.14159 * f); al = .05 + .45 * q * q; }
  else { float f = fract(vUv.x / uPitch + vUv.y - uT); al = .10 + .90 * (smoothstep(0., .06, f) * (1. - smoothstep(.40, .48, f))); }
  float fade = smoothstep(0., .03, vUv.x) * smoothstep(0., .03, uLen - vUv.x);
  gl_FragColor = vec4(uC, uA * al * fade);
}`;
const PT_V = `attribute float aA; attribute float aS; uniform float uK; varying float vA;
void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = aS * uK / max(-mv.z, .05); gl_Position = projectionMatrix * mv; }`;
const PT_F = `uniform vec3 uC; varying float vA;
void main(){ vec2 d = gl_PointCoord - .5; float r = dot(d, d) * 4.; if (r > 1.) discard; gl_FragColor = vec4(uC, vA * (1. - r) * (1. - r)); }`;

const fmt = (kw) => { const a = Math.abs(kw); return a >= 9.95 ? a.toFixed(0) : a.toFixed(1); };
/** 粗细：功率线性地映到 0.35…2 倍（原来开根号，2 kW 和 40 kW 看着差不多） */
export const widthOf = (kw, full = 60) => .35 + 1.65 * Math.min(1, Math.abs(kw) / full);

/**
 * P（都是 three 坐标，米）:
 *   dc       [点…]           电池 → PCU 的高压线（正 = 放电，沿这个方向走）
 *   acMot    [[点, 点] × 3]  PCU → 驱动电机的三根铜排（正 = 往电机送电）
 *   acGen    [[点, 点] × 3]  发电机 → PCU 的三根铜排（正 = 发电）
 *   fuel     [点…]           油箱 → 油轨
 *   exhaust  [点…]           排气歧管 → 尾管
 *   shafts   [{a, b}]         半轴：差速器端 a、车轮端 b
 *   contact  [点]             前轮接地点
 *   heat     { eng, drive, tail }   冒热气的位置
 *   label    { dc, acMot, acGen, fuel, heatEng, heatDrive, axle }   标字的位置
 */
export function makeFlowViz(THREE, scene, P) {
  const C = (hex) => new THREE.Color(hex).convertLinearToSRGB();
  const group = new THREE.Group();
  group.renderOrder = 8;
  scene.add(group);
  const V = THREE.Vector3;

  function tube(points, radius, sides, mode, color, pitch) {
    const curve = points.length > 2 ? new THREE.CatmullRomCurve3(points, false, 'centripetal', .08) : new THREE.LineCurve3(points[0], points[1]);
    const len = curve.getLength(), n = Math.max(2, Math.min(260, Math.round(len / .03)));
    const pos = [], nor = [], tan = [], uv = [], idx = [];
    let up = new V(0, 1, 0), prevT = null, nrm = null;
    for (let i = 0; i <= n; i++) {
      const u = i / n, c = curve.getPointAt(u), t = curve.getTangentAt(u).normalize();
      if (!prevT) { if (Math.abs(t.dot(up)) > .9) up = new V(1, 0, 0); nrm = new V().crossVectors(t, up).normalize(); }
      else { const ax = new V().crossVectors(prevT, t); const s = ax.length(); if (s > 1e-6) nrm.applyAxisAngle(ax.normalize(), Math.asin(Math.min(1, s))); nrm.sub(t.clone().multiplyScalar(nrm.dot(t))).normalize(); }
      prevT = t;
      const bin = new V().crossVectors(t, nrm);
      for (let k = 0; k <= sides; k++) {
        const a = k / sides * TAU, d = nrm.clone().multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
        pos.push(c.x, c.y, c.z); nor.push(d.x, d.y, d.z); tan.push(t.x, t.y, t.z); uv.push(u * len, k / sides);
      }
    }
    for (let i = 0; i < n; i++) for (let k = 0; k < sides; k++) {
      const a = i * (sides + 1) + k, b = a + sides + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aN', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(tan, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      vertexShader: TUBE_V, fragmentShader: TUBE_F, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      uniforms: { uR: { value: radius }, uC: { value: C(color) }, uT: { value: 0 }, uPitch: { value: pitch }, uA: { value: 1 }, uMode: { value: mode }, uDir: { value: 1 }, uLen: { value: len } },
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.renderOrder = 8; mesh.visible = false;
    group.add(mesh);
    return { mesh, u: m.uniforms, r0: radius, len, kw: 0, t: 0 };
  }

  // ---- 直流、汽油、废气、半轴
  const dc = tube(P.dc, .026, 10, 0, FLOW_COL.dc, .13);
  const fuel = tube(P.fuel, .012, 8, 1, FLOW_COL.fuel, .10);
  const exh = tube(P.exhaust, .036, 8, 2, FLOW_COL.exhaust, .30);
  const shafts = P.shafts.map((s) => Object.assign(tube([s.a, s.b], .021, 12, 3, FLOW_COL.mech, .10), { sign: s.sign }));

  // ---- 三相交流：每根铜排一条波
  function waves(paths, color) {
    const N = 22, S = 6, list = [];
    paths.forEach((p, ph) => {
      const a = p[0], b = p[1], dir = b.clone().sub(a), len = dir.length();
      dir.normalize();
      const lat = new V(0, 0, 1);                                   // 波往车头车尾方向摆（three 的 z）
      if (Math.abs(dir.dot(lat)) > .9) lat.set(1, 0, 0);
      lat.sub(dir.clone().multiplyScalar(lat.dot(dir))).normalize();
      const bin = new V().crossVectors(dir, lat);
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array((N + 1) * (S + 1) * 3), idx = [];
      for (let i = 0; i < N; i++) for (let k = 0; k < S; k++) { const q = i * (S + 1) + k, r = q + S + 1; idx.push(q, r, q + 1, q + 1, r, r + 1); }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .95, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false; mesh.renderOrder = 9; mesh.visible = false;
      group.add(mesh);
      list.push({ mesh, pos, a, dir, len, lat, bin, ph, N, S });
    });
    return { list, kw: 0, t: 0, hz: 1 };
  }
  const acMot = waves(P.acMot, FLOW_COL.ac), acGen = waves(P.acGen, FLOW_COL.ac);
  function drawWaves(w) {
    const amp = .003 + .007 * Math.min(1, Math.sqrt(Math.abs(w.kw) / 40)), rad = .0032;
    for (const l of w.list) {
      const { pos, N, S } = l;
      let o = 0;
      for (let i = 0; i <= N; i++) {
        const u = i / N, env = Math.sin(Math.PI * u);
        const off = amp * env * Math.sin(u * 9 - w.t * TAU - l.ph * TAU / 3);
        const cx = l.a.x + l.dir.x * u * l.len + l.lat.x * off, cy = l.a.y + l.dir.y * u * l.len + l.lat.y * off, cz = l.a.z + l.dir.z * u * l.len + l.lat.z * off;
        for (let k = 0; k <= S; k++) {
          const a = k / S * TAU, c = Math.cos(a) * rad, s = Math.sin(a) * rad;
          pos[o++] = cx + l.lat.x * c + l.bin.x * s; pos[o++] = cy + l.lat.y * c + l.bin.y * s; pos[o++] = cz + l.lat.z * c + l.bin.z * s;
        }
      }
      l.mesh.geometry.attributes.position.needsUpdate = true;
    }
  }

  // ---- 前轮接地点的力箭头（平躺在地上，朝车头 = three 的 −z）
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(-.03, 0); arrowShape.lineTo(.03, 0); arrowShape.lineTo(.03, .62); arrowShape.lineTo(.075, .62); arrowShape.lineTo(0, 1); arrowShape.lineTo(-.075, .62); arrowShape.lineTo(-.03, .62);
  const arrowGeo = new THREE.ShapeGeometry(arrowShape);
  arrowGeo.rotateX(-Math.PI / 2);
  const arrows = P.contact.map((p) => {
    const m = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: FLOW_COL.mech, transparent: true, opacity: .92, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(p); m.renderOrder = 9; m.visible = false; m.frustumCulled = false;
    group.add(m);
    return m;
  });

  // ---- 热气
  function emitter(at, n, spread, color) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), aA = new Float32Array(n), aS = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aA', new THREE.BufferAttribute(aA, 1));
    g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: PT_V, fragmentShader: PT_F, transparent: true, depthWrite: false, depthTest: false, uniforms: { uC: { value: C(color) }, uK: { value: 600 } } });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false; pts.renderOrder = 7; pts.visible = false;
    group.add(pts);
    const seed = Array.from({ length: n }, (_, i) => [(i * .6180339) % 1, (i * .7548776) % 1, (i * .5698403) % 1]);
    return { pts, pos, aA, aS, at, n, spread, seed, kw: 0, t: 0 };
  }
  const heat = { eng: emitter(P.heat.eng, 28, [.16, .10], FLOW_COL.heat), drive: emitter(P.heat.drive, 18, [.10, .09], FLOW_COL.heat), tail: emitter(P.heat.tail, 16, [.04, .04], FLOW_COL.exhaust) };
  function drawHeat(e, full) {
    const act = Math.min(e.n, Math.ceil(e.n * Math.min(1, Math.abs(e.kw) / full)));
    for (let i = 0; i < e.n; i++) {
      const [s1, s2, s3] = e.seed[i], life = (e.t * (.35 + .25 * s3) + s1) % 1;
      e.pos[i * 3] = e.at.x + (s2 - .5) * 2 * e.spread[0] + Math.sin(life * 6 + s1 * 9) * .02;
      e.pos[i * 3 + 1] = e.at.y + life * .34 * (.4 + .6 * scope.k);
      e.pos[i * 3 + 2] = e.at.z + (s3 - .5) * 2 * e.spread[1];
      e.aA[i] = i < act ? .55 * Math.sin(Math.PI * life) : 0;
      e.aS[i] = (.05 + .09 * life) * (.4 + .6 * scope.k);
    }
    for (const k of ['position', 'aA', 'aS']) e.pts.geometry.attributes[k].needsUpdate = true;
  }

  const filter = { elec: true, mech: true, fuel: true, heat: true };
  // 近景（只看电驱单元或只看发动机）时，远处那些管线会横在镜头前面：scope.show 说这个机位只画哪几样，scope.k 把粗细缩小
  const ALL = ['dc', 'ac', 'shaft', 'arrow', 'fuel', 'exhaust', 'heatEng', 'heatDrive'];
  const scope = { show: new Set(ALL), k: 1 };
  let cur = {}, thW = 0, pxK = 600;

  const api = {
    group,
    /** o 单位 kW（force 是牛顿）。正方向见上面 P 的说明 */
    set(o) {
      cur = o || {};
      const sh = scope.show;
      const on = (k, kind, part) => filter[kind] && sh.has(part) && Math.abs(cur[k] || 0) > .05;
      const tb = (t, kw, vis, full) => { t.kw = kw || 0; t.mesh.visible = vis; if (vis) { t.u.uR.value = t.r0 * widthOf(t.kw, full) * scope.k; t.u.uDir.value = t.kw < 0 ? -1 : 1; } };
      tb(dc, cur.batt_pcu, on('batt_pcu', 'elec', 'dc'), 40);
      dc.u.uC.value = C(cur.batt_pcu < 0 ? FLOW_COL.regen : FLOW_COL.dc);
      tb(fuel, cur.fuel, on('fuel', 'fuel', 'fuel'), 160);
      tb(exh, cur.exhaust, on('exhaust', 'fuel', 'exhaust'), 60);
      for (const [w, k] of [[acMot, 'pcu_mot'], [acGen, 'gen_pcu']]) { w.kw = cur[k] || 0; const v = on(k, 'elec', 'ac'); for (const l of w.list) l.mesh.visible = v; }
      const ax = (cur.axle_L || 0) + (cur.axle_R || 0), axOn = filter.mech && sh.has('shaft') && Math.abs(ax) > .05;
      for (const s of shafts) s.u.uR.value = s.r0 * scope.k;
      for (const s of shafts) { s.kw = ax / 2; s.mesh.visible = axOn; if (axOn) { s.u.uPitch.value = .16 / (.5 + 2.5 * Math.min(1, Math.abs(ax) / 60)); s.u.uC.value = C(ax < 0 ? FLOW_COL.regen : FLOW_COL.mech); } }
      const F = cur.force || 0, fOn = filter.mech && sh.has('arrow') && Math.abs(F) > 30;
      for (const a of arrows) {
        a.visible = fOn;
        if (!fOn) continue;
        const L = .25 + .75 * Math.min(1, Math.abs(F) / 4000);
        a.scale.set(1 + L * .6, 1, L * Math.sign(F));     // 箭头是朝车头（−z）画的；力朝后就翻过来
        a.material.color.set(F < 0 ? FLOW_COL.regen : FLOW_COL.mech);
      }
      heat.eng.kw = cur.heat_eng || 0; heat.drive.kw = cur.heat_drive || 0; heat.tail.kw = cur.exhaust || 0;
      heat.eng.pts.visible = filter.heat && sh.has('heatEng') && heat.eng.kw > .3;
      heat.drive.pts.visible = filter.heat && sh.has('heatDrive') && heat.drive.kw > .15;
      heat.tail.pts.visible = filter.fuel && sh.has('exhaust') && heat.tail.kw > .3;
    },
    /** 这个机位只画哪几样（dc / ac / shaft / arrow / fuel / exhaust / heatEng / heatDrive），不给 = 全画；k = 粗细的倍数 */
    setScope(show, k = 1) { scope.show = new Set(show || ALL); scope.k = k; api.set(cur); },
    /** 只改粗细的倍数（镜头拉近时调小，不然管线会糊住画面） */
    setK(k) { if (Math.abs(k - scope.k) > .04) { scope.k = k; api.set(cur); } },
    setFilter(f) { Object.assign(filter, f); api.set(cur); },
    filter,
    /** 每帧调一次。o.thW = 车轮转过的角度（半轴上的条纹跟着转），o.px = 画布高度的像素数（热气的点大小） */
    tick(dt, o = {}) {
      if (o.thW != null) thW = o.thW;
      if (o.px) pxK = o.px;
      const step = (t, speed) => { if (t.mesh.visible) { t.t += dt * speed * (t.kw < 0 ? -1 : 1); t.u.uT.value = t.t; } };
      step(dc, 1.3 + 1.2 * Math.min(1, Math.abs(dc.kw) / 40));
      step(fuel, 1.0 + 1.5 * Math.min(1, Math.abs(fuel.kw) / 120));
      step(exh, .8 + .8 * Math.min(1, Math.abs(exh.kw) / 40));
      for (const s of shafts) if (s.mesh.visible) s.u.uT.value = -thW * s.sign / TAU;
      for (const w of [acMot, acGen]) {
        if (!w.list[0].mesh.visible) continue;
        w.t += dt * (w.hz || 1.2) * (w.kw < 0 ? -1 : 1);
        drawWaves(w);
      }
      for (const [e, full] of [[heat.eng, 60], [heat.drive, 8], [heat.tail, 40]]) {
        if (!e.pts.visible) continue;
        e.t += dt; e.pts.material.uniforms.uK.value = pxK; drawHeat(e, full);
      }
    },
    /** 交流电的波一秒钟走几个周期（按电机转速给，页面自己定慢放多少） */
    setHz(mot, gen) { acMot.hz = mot; acGen.hz = gen; },
    /** 给页面标字用：[{ id, kind, pos, text, color }]，只返回现在在显示的 */
    labels() {
      const out = [], L = P.label, add = (id, kind, pos, text, color) => out.push({ id, kind, pos, text, color });
      const b = cur.batt_pcu || 0, m = cur.pcu_mot || 0, g = cur.gen_pcu || 0, ax = (cur.axle_L || 0) + (cur.axle_R || 0);
      if (dc.mesh.visible) add('dc', 'elec', L.dc, b > 0 ? `电池放电 ${fmt(b)} kW` : `给电池充电 ${fmt(b)} kW`, b > 0 ? FLOW_COL.dc : FLOW_COL.regen);
      if (acMot.list[0].mesh.visible) add('acMot', 'elec', L.acMot, m > 0 ? `三相交流 → 驱动电机 ${fmt(m)} kW` : `驱动电机发电 ${fmt(m)} kW`, FLOW_COL.ac);
      if (acGen.list[0].mesh.visible) add('acGen', 'elec', L.acGen, g > 0 ? `发电机发电 ${fmt(g)} kW` : `发电机拖发动机 ${fmt(g)} kW`, FLOW_COL.ac);
      if (fuel.mesh.visible) add('fuel', 'fuel', L.fuel, `汽油 ${fmt(cur.fuel)} kW`, FLOW_COL.fuel);
      if (heat.eng.pts.visible) add('heatEng', 'heat', L.heatEng, `发动机废热 ${fmt(heat.eng.kw)} kW`, FLOW_COL.heat);
      if (heat.drive.pts.visible) add('heatDrive', 'heat', L.heatDrive, `电和齿轮的损耗 ${fmt(heat.drive.kw)} kW`, FLOW_COL.heat);
      if (shafts[0].mesh.visible) add('axle', 'mech', L.axle, ax > 0 ? `到车轮 ${fmt(ax)} kW` : `车轮往回送 ${fmt(ax)} kW`, ax > 0 ? FLOW_COL.mech : FLOW_COL.regen);
      return out;
    },
  };
  return api;
}

/**
 * 从 spec_ehev.json 里的路径（Blender 坐标，毫米）拼出 makeFlowViz 要的 P。
 * dims = spec.json 的 dims（轴距、轮距、轮胎半径），shaftPos(tag) = 半轴节点（H_ShaftL / H_ShaftR）的位置（three 坐标）
 */
export function ehevFlowPaths(THREE, spec, dims, shaftPos) {
  const MM = .001, B = (x, y, z) => new THREE.Vector3(x * MM, z * MM, -y * MM), P = (p) => B(p[0], p[1], p[2]);
  const F = spec.flows, half = dims.track / 2, wb = dims.WB / 2;
  const sh = (tag, sx) => ({ a: shaftPos(tag).clone(), b: B(sx * (half - 62), wb, dims.r_tyre), sign: sx });
  const exh = F.exhaust.map(P);
  return {
    dc: F.dc.map(P).reverse(),                                   // 电池 → PCU
    acMot: F.ac_mot.map((p) => [P(p[1]), P(p[0])]),              // PCU → 驱动电机
    acGen: F.ac_gen.map((p) => [P(p[0]), P(p[1])]),              // 发电机 → PCU
    fuel: F.fuel.map(P), exhaust: exh,
    shafts: [sh('L', -1), sh('R', 1)],
    contact: [B(-(half + 175), wb, 6), B(half + 175, wb, 6)],
    heat: { eng: B(128, 1560, 850), drive: B(-285, 1520, 770), tail: exh[exh.length - 1].clone().add(new THREE.Vector3(0, 0, .12)) },
    label: { dc: B(-650, 100, 420), acMot: B(-430, 1440, 880), acGen: B(-430, 1640, 780), fuel: B(-100, 520, 200), heatEng: B(128, 1560, 1180),
      heatDrive: B(-285, 1500, 1020), axle: B(-720, 1400, 120) },
  };
}
