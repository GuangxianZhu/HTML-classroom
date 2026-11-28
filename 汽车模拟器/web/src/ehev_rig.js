// 两电机混动（pt_ehev.glb）的零件怎么动。汽车模拟器和“飞度混动原理”两个页面共用这一份，
// 所以 three.js 由调用方传进来（各页面打包各自的 three，不能有两份）。
//
// 坐标：Blender 里 x 向右、y 向车头、z 向上；glb 导出成 y 向上，绕 x 轴的转角两边是同一个数。
// 往前开 = 车轮绕 +x 转负角。齿轮一对一对啮合，方向交替：
//   车轮 / 差速器  −thW
//   中间轴         +thW × 齿圈 / 主减速小齿轮
//   驱动电机       −thW × 8.40（经中间轴，方向又翻回来）
//   直驱齿轮       −thW × 2.757（空套在输入轴上，永远跟车轮）
//   曲轴 / 输入轴  −thI
//   发电机         +thI × 2（和曲轴反向）
//   凸轮轴         −thI / 2
const MM = 0.001, DEG = Math.PI / 180;

export const pistonHeight = (r, l, a) => r * Math.cos(a) + Math.sqrt(l * l - (r * Math.sin(a)) ** 2);
export const rodAngle = (r, l, a) => Math.asin(r * Math.sin(a) / l);
/** 气门升程 0…1。c = 这个缸在 720° 循环里的曲轴转角（0 = 做功行程开始），win = [开, 关] */
export function valveLift(win, c) {
  c = ((c % 720) + 720) % 720;
  const [a, b] = win;
  if (c < a || c > b) return 0;
  const s = Math.sin(Math.PI * (c - a) / (b - a));
  return s * s;
}

export const GLOW = { drive: '#4fe39a', regen: '#5ab4ff', ac: '#c78bff', eng: '#ff9a3c', wheel: '#3ccf7a' };

/**
 * nodes: Map(名字 → three 节点)，只要 H_ 开头的那些；spec = blender/out/spec_ehev.json
 * 网格的材质要是每个网格自己的一份（调用方载入时 clone 过），这里会改它们的 emissive。
 */
export function makeEhevRig(THREE, nodes, spec) {
  const D = spec.derived, T = spec.teeth;
  const kC = T.zr / T.zf, kM = kC * T.zcd / T.zm, kE = kC * T.zcd / T.zed, kG = T.zig / T.zgp;
  const order = Object.fromEntries(D.firing.map((c, k) => [c, k]));          // 缸号 → 第几个点火
  const by = { crank: [], cam: [], gen: [], motor: [], od: [], counter: [], diff: [] };
  const shafts = [], pistons = [], rods = [], valves = [], burns = [], clutch = {};
  const meshes = new Map();               // 轴名 → 这根轴上的网格（发光用）
  const copper = { mot: [], gen: [] };
  const sided = [];
  const addMeshes = (key, n) => { if (!meshes.has(key)) meshes.set(key, []); n.traverse((o) => { if (o.isMesh) meshes.get(key).push(o); }); };

  for (const [name, n] of nodes) {
    const ex = n.userData || {};
    n.userData.base = n.position.clone();
    if (ex.side) n.traverse((o) => { if (o.isMesh) sided.push([o, ex.side]); });
    if (ex.clutch) clutch[ex.clutch] = n;
    if (ex.kind === 'rot') {
      if (ex.axis) {
        const a = ex.axis;
        shafts.push({ n, axis: new THREE.Vector3(a[0], a[2], -a[1]).normalize(), sign: Math.sign(a[0]) });
      } else if (by[ex.shaft]) by[ex.shaft].push(n);
      addMeshes(ex.shaft, n);
    } else if (ex.kind === 'piston' || ex.kind === 'rod') {
      (ex.kind === 'piston' ? pistons : rods).push({ n, ph: ex.phase * DEG });
      addMeshes('crank', n);
    } else if (ex.kind === 'valve') {
      const d = ex.dir;
      valves.push({ n, base: n.position.clone(), dir: new THREE.Vector3(d[0], d[2], -d[1]).multiplyScalar(ex.lift * MM), side: ex.vside, k: order[ex.cyl] });
      addMeshes('cam', n);
    } else if (ex.kind === 'burn') {
      burns.push({ n, k: order[ex.cyl], mats: [] });
      n.traverse((o) => { if (o.isMesh) { o.material.transparent = true; o.material.depthWrite = false; burns[burns.length - 1].mats.push(o.material); } });
      n.visible = false;
    }
    const st = /^H_(Mot|Gen)Stator/.exec(name);
    if (st) n.traverse((o) => { if (o.isMesh && /Copper/.test(o.material.name)) copper[st[1] === 'Mot' ? 'mot' : 'gen'].push(o); });
  }
  // 零件的“原位”：建模时的位置 + 页面给的爆炸图偏移（userData.exOff，没有就是 0）
  const home = (n) => { n.position.copy(n.userData.base); if (n.userData.exOff) n.position.add(n.userData.exOff); return n.position; };
  const r = D.r_crank, L = D.rod;
  const h0 = (ph) => pistonHeight(r, L, ph);
  let engOn = false, tint = false, atkinson = true, burnK = 1;
  const glow = new Map();                 // 网格 → [颜色, 强度]
  const remember = (o) => { const m = o.material; if (!m.userData.em0) { m.userData.em0 = m.emissive.clone(); m.userData.ei0 = m.emissiveIntensity; } return m; };
  const paint = (o, col, k) => {
    const m = remember(o);
    if (m.userData.hl) return;            // 页面正在高亮这个件，不抢
    if (k > 0) { m.emissive.set(col); m.emissiveIntensity = k; } else { m.emissive.copy(m.userData.em0); m.emissiveIntensity = m.userData.ei0; }
  };

  const rig = {
    ratios: { counter: kC, motor: kM, engine: kE, gen: kG },
    /** thW 车轮转过的角度，thI 曲轴转过的角度（弧度，往前为正） */
    set(thW, thI) {
      for (const n of by.diff) n.rotation.x = -thW;
      for (const s of shafts) s.n.quaternion.setFromAxisAngle(s.axis, -thW * s.sign);
      for (const n of by.counter) n.rotation.x = thW * kC;
      for (const n of by.motor) n.rotation.x = -thW * kM;
      for (const n of by.od) n.rotation.x = -thW * kE;
      for (const n of by.crank) n.rotation.x = -thI;
      for (const n of by.gen) n.rotation.x = thI * kG;
      for (const n of by.cam) n.rotation.x = -thI / 2;
      for (let i = 0; i < pistons.length; i++) {
        const p = pistons[i], al = thI + p.ph, dy = (pistonHeight(r, L, al) - h0(p.ph)) * MM;
        const q = rods[i];
        home(p.n).y += dy;
        home(q.n).y += dy;
        q.n.rotation.x = rodAngle(r, L, al);
      }
      const deg = thI / DEG, V = D.valve;
      for (const v of valves) {
        const win = v.side === 'in' ? (atkinson ? V.in : V.in_otto) : V.ex;
        home(v.n).addScaledVector(v.dir, valveLift(win, deg - 180 * v.k));
      }
      for (const b of burns) {
        const c = (((deg - 180 * b.k) % 720) + 720) % 720;
        const x = engOn && c < 180 ? Math.pow(1 - c / 180, 1.4) * burnK : 0;
        b.n.visible = !b.n.userData.hid && x > .03;
        for (const m of b.mats) { m.emissiveIntensity = x * 6; m.opacity = .25 + .6 * x; }
      }
    },
    /** 这个缸现在在哪个冲程（0 做功 / 1 排气 / 2 进气 / 3 压缩）和循环里的角度 */
    stroke(thI, cyl) { const c = (((thI / DEG - 180 * order[cyl]) % 720) + 720) % 720; return { c, stroke: Math.floor(c / 180) }; },
    setEngine(on) { engOn = !!on; },
    setBurn(k) { burnK = k; },
    setAtkinson(on) { atkinson = !!on; },
    /** 离合器：open 分开 / sync 发电机正在把发动机转速拉到一样 / locked 压紧 */
    setClutch(state) {
      const shift = state === 'locked' ? .0030 : 0;
      for (const [k, f] of [['piston', 1], ['outer', .5]]) {
        const n = clutch[k];
        if (!n) continue;
        home(n).x += shift * f;
      }
      const col = state === 'locked' ? '#4fd18b' : state === 'sync' ? '#ffb547' : null;
      for (const k of ['inner', 'outer']) clutch[k] && clutch[k].traverse((o) => {
        if (!o.isMesh) return;
        const m = remember(o);
        m.userData.cl = !!col;
        if (m.userData.hl) return;
        if (col) { m.emissive.set(col); m.emissiveIntensity = .55; } else { m.emissive.copy(m.userData.em0); m.emissiveIntensity = m.userData.ei0; }
      });
    },
    /**
     * 哪根轴在传力就让哪根轴亮。o 单位 kW：eng_gen 发动机 → 发电机，eng_wheel 发动机 → 车轮（过离合器），
     * mot_wheel 驱动电机 → 车轮（负 = 车轮倒过来拖电机发电），ac_mot / ac_gen 两台电机绕组里的三相电
     */
    setGlow(o) {
      glow.clear();
      if (tint) return;
      const lv = (kw) => Math.min(1, Math.sqrt(Math.abs(kw || 0) / 40));
      const put = (key, col, k) => { for (const m of meshes.get(key) || []) { const g = glow.get(m); if (!g || g[1] < k) glow.set(m, [col, k]); } };
      const eg = lv(o.eng_gen), ew = lv(o.eng_wheel), mw = lv(o.mot_wheel), back = (o.mot_wheel || 0) < 0;
      if (eg > .02) { put('crank', GLOW.drive, .12 + .5 * eg); put('gen', GLOW.drive, .12 + .5 * eg); }
      if (ew > .02) for (const k of ['crank', 'od', 'counter', 'diff']) put(k, GLOW.drive, .12 + .5 * ew);
      if (mw > .02) for (const k of ['motor', 'counter', 'diff']) put(k, back ? GLOW.regen : GLOW.drive, .12 + .5 * mw);
      for (const list of meshes.values()) for (const m of list) { const g = glow.get(m); if (m.material.userData.cl) continue; paint(m, g ? g[0] : null, g ? g[1] : 0); }
      for (const [k, kw] of [['mot', o.ac_mot], ['gen', o.ac_gen]]) {
        const a = lv(kw);
        for (const m of copper[k]) paint(m, GLOW.ac, a > .02 ? .25 + .9 * a : 0);
      }
    },
    /** 按“跟谁一起转”上色：发动机这一边橙色，车轮这一边绿色（离合器就夹在两种颜色中间） */
    setTint(on) {
      tint = !!on;
      for (const [m, side] of sided) paint(m, on ? GLOW[side] : null, on ? .42 : 0);
      if (on) for (const k of ['mot', 'gen']) for (const m of copper[k]) paint(m, null, 0);
    },
    isTint: () => tint,
    /** 页面要高亮一个网格时调：on = true 以后这里不再改它的 emissive */
    lock(mesh, on) { remember(mesh).userData.hl = !!on; },
    restore(mesh) { const m = remember(mesh); m.emissive.copy(m.userData.em0); m.emissiveIntensity = m.userData.ei0; },
  };
  return rig;
}
