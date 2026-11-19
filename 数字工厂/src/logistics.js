// 45-logistics：立体库、堆垛机、P&D 输送、叉车、卡车（铰接挂车）、AGV
import * as THREE from 'three';
import { C, M, MAT, trs, rr, R, ri, pick, clamp, smooth, canvasTex, textPlate } from './util.js';
import { truckGeoms, forkliftGeoms, agvGeoms, workerGeoms, rbox, mergeT, mtx } from './geo.js';
import { Path, Flow } from './path.js';
import { SIM } from './sim.js';
import { HALL } from './layout.js';

export const RACK = { x0: -75.5, row: 2.8, aisle: 2.0, z0: -32, z1: 20, bay: 2.6, levels: 12, lh: 1.62, h: 19.8 };
export const AISLES = [0, 1, 2].map((i) => RACK.x0 + RACK.row * (i + 1) + RACK.aisle * i + RACK.aisle / 2);

const LOAD_COLS = ['#a27a51', '#9a7450', '#b08a5e', '#8e6c4a', '#cbc7bd', '#c2beb3', '#56687a', '#4d5d6c', '#6d7175', '#7a6a55'];

export function buildLogistics(ctx) {
  const { B, P, scene } = ctx;
  const steel = ctx.MAT.structure;
  const upd = [];
  const rackBlue = M('rackUpright', { color: 0x44505c, roughness: 0.5, metalness: 0.5 });
  const rackBeam = M('rackBeam', { color: 0xb5622e, roughness: 0.5, metalness: 0.3 });

  // =============== 立体库货架 ===============
  const nb = Math.round((RACK.z1 - RACK.z0) / RACK.bay);
  P.def('load', new THREE.BoxGeometry(1.1, 1, 1.0), MAT.kraft, { color: true, dyn: false });
  P.def('pallet', new THREE.BoxGeometry(1.2, 0.14, 1.0), MAT.wood, { dyn: false });
  P.def('coilS', (() => { const g = new THREE.CylinderGeometry(0.5, 0.5, 0.9, 20); g.rotateX(Math.PI / 2); return g; })(), MAT.steel, { dyn: false });
  for (let r = 0; r < 4; r++) {
    const x0 = RACK.x0 + r * (RACK.row + RACK.aisle);
    const faces = [[x0 + 0.05, x0 + 1.3], [x0 + 1.5, x0 + 2.75]];
    // 立柱
    for (let b = 0; b <= nb; b++) {
      const z = RACK.z0 + b * RACK.bay;
      for (const ux of [x0 + 0.05, x0 + 1.3, x0 + 1.5, x0 + 2.75]) B.box(rackBlue, 0.1, RACK.h, 0.1, ux, RACK.h / 2, z);
      // 侧框斜撑（每两层）
      for (const [fa, fb] of faces) for (let lv = 0; lv < RACK.levels; lv += 2) B.beam(rackBlue, [fa, lv * RACK.lh + 0.2, z], [fb, (lv + 2) * RACK.lh, z], 0.04);
    }
    // 横梁 + 货物
    for (let lv = 0; lv < RACK.levels; lv++) {
      const y = 0.25 + lv * RACK.lh;
      for (const [fa, fb] of faces) {
        B.box(rackBeam, 0.08, 0.12, nb * RACK.bay, fa, y, (RACK.z0 + RACK.z1) / 2);
        B.box(rackBeam, 0.08, 0.12, nb * RACK.bay, fb, y, (RACK.z0 + RACK.z1) / 2);
        const cx = (fa + fb) / 2;
        for (let b = 0; b < nb; b++) for (const k of [0, 1]) {
          if (R() > 0.64) continue;
          const z = RACK.z0 + b * RACK.bay + 0.68 + k * 1.24;
          const pl = P.node('pallet'); pl.position.set(cx, y + 0.13, z);
          if (lv < 3 && R() < 0.18) { const c = P.node('coilS'); c.position.set(cx, y + 0.7, z); continue; }
          const h = rr(0.75, 1.3);
          const ld = P.node('load', P.root, pick(LOAD_COLS)); ld.position.set(cx, y + 0.2 + h / 2, z); ld.scale.set(rr(0.92, 1.0), h, rr(0.94, 1.0));
        }
      }
    }
    // 顶部连梁
    B.box(rackBlue, 2.8, 0.14, nb * RACK.bay, x0 + 1.4, RACK.h, (RACK.z0 + RACK.z1) / 2);
  }
  // 巷道：地轨 + 天轨 + 端头标牌
  AISLES.forEach((ax, i) => {
    B.box(MAT.steel, 0.14, 0.12, RACK.z1 - RACK.z0 + 3, ax, 0.06, (RACK.z0 + RACK.z1) / 2 + 1.5);
    B.box(steel, 0.25, 0.25, RACK.z1 - RACK.z0 + 3, ax, RACK.h + 0.5, (RACK.z0 + RACK.z1) / 2 + 1.5);
    const t = textPlate([{ t: 'A' + (i + 1), size: 150, x: 40 }, { t: 'AS/RS', size: 54, x: 270, y: 92 }, { t: 'AISLE', size: 54, x: 270, y: 168 }], { w: 512, h: 256, bg: 'rgba(24,26,29,0.96)', border: '#f2a73b' });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0), new THREE.MeshBasicMaterial({ map: t, color: 0xbdbdbd }));
    m.position.set(ax, 7.6, RACK.z1 + 0.3); m.updateMatrix(); m.matrixAutoUpdate = false; scene.add(m);
  });

  // =============== 堆垛机 ===============
  P.def('stk_mast', mergeT([[new THREE.BoxGeometry(0.42, RACK.h + 0.2, 0.5), mtx(0, (RACK.h + 0.2) / 2 + 0.6, -1.15)], [new THREE.BoxGeometry(0.42, RACK.h + 0.2, 0.5), mtx(0, (RACK.h + 0.2) / 2 + 0.6, 1.15)], [rbox(1.2, 0.8, 3.4, 0.08), mtx(0, 0.45, 0)], [new THREE.BoxGeometry(0.6, 0.4, 2.8), mtx(0, RACK.h + 0.8, 0)], [rbox(0.9, 1.6, 0.8, 0.06), mtx(0, 1.65, -1.9)]]), MAT.ivory);
  P.def('stk_car', mergeT([[rbox(1.5, 0.8, 1.7, 0.06), mtx(0, 0, 0)], [new THREE.BoxGeometry(0.2, 0.2, 1.6), mtx(0, 0.5, 0)]]), MAT.orange);
  P.def('stk_fork', mergeT([[new THREE.BoxGeometry(1.25, 0.06, 0.16), mtx(0, -0.38, -0.32)], [new THREE.BoxGeometry(1.25, 0.06, 0.16), mtx(0, -0.38, 0.32)]]), MAT.steelDark);
  P.def('stk_load', rbox(1.05, 1.0, 1.0, 0.05), MAT.kraft, { color: true });
  P.def('stk_lamp', new THREE.SphereGeometry(0.12, 10, 8), MAT.lampAmber);
  const stackers = AISLES.map((ax, i) => {
    const root = P.group(); root.position.set(ax, 0, 10);
    P.node('stk_mast', root);
    const car = P.group(root); car.position.y = 2; P.node('stk_car', car);
    const fork = P.group(car); P.node('stk_fork', fork);
    const load = P.node('stk_load', fork, pick(LOAD_COLS)); load.position.y = 0.2;
    const lamp = P.node('stk_lamp', root); lamp.position.set(0, RACK.h + 1.15, 0);
    return { root, car, fork, load, lamp, ax, id: i < 2 ? 'ASRS-01' : 'ASRS-02', job: null, t: 0, z: 10, y: 2, side: 1 };
  });
  const newJob = (s) => {
    const toPD = s.z < 15 && R() < 0.5;
    const tz = toPD ? 18.4 : rr(RACK.z0 + 1.6, RACK.z1 - 1.8);
    const ty = toPD ? 0.7 : 0.6 + ri(0, RACK.levels - 1) * RACK.lh;
    const dist = Math.abs(tz - s.z) + Math.abs(ty - s.y) * 1.6;
    s.job = { z0: s.z, y0: s.y, z1: tz, y1: ty, dur: 1.6 + dist / 3.2, t: 0, fork: toPD ? 0 : (R() < 0.5 ? -1 : 1), pd: toPD };
  };
  upd.push((dt) => {
    for (const s of stackers) {
      const sp = SIM.speed(s.id) * SIM.rate;
      if (!s.job) newJob(s);
      const j = s.job; j.t += dt * sp;
      const total = j.dur + 2.2;
      const u = clamp(j.t / j.dur, 0, 1), k = smooth(u);
      s.z = j.z0 + (j.z1 - j.z0) * k; s.y = j.y0 + (j.y1 - j.y0) * smooth(clamp(u * 1.15 - 0.05, 0, 1));
      let fx = 0;
      if (j.t > j.dur) { const f = (j.t - j.dur) / 2.2; fx = Math.sin(Math.min(1, f) * Math.PI) * 1.25 * (j.fork || (s.ax < -70 ? 1 : 1)); if (f > 0.5 && !j.swapped) { j.swapped = true; s.load.visible = !s.load.visible; } }
      if (j.t > total) s.job = null;
      s.root.position.z = s.z; s.car.position.y = s.y + 0.4; s.fork.position.x = j.pd ? 0 : fx; s.fork.position.z = j.pd ? fx * 0.8 : 0;
    }
  });

  // =============== P&D 输送 → AGV 交接 ===============
  const conv = M('conveyor', { color: 0x3c4046, roughness: 0.5, metalness: 0.5 });
  const roller = M('roller', { color: 0x9aa0a6, roughness: 0.3, metalness: 0.8 });
  const cvPts = [];
  AISLES.forEach((ax) => { B.box(conv, 1.3, 0.55, 3.0, ax, 0.275, 21.7); cvPts.push(ax); });
  B.box(conv, 21.0, 0.55, 1.3, -62.4, 0.275, 23.9);
  B.box(conv, 1.3, 0.55, 20.0, -52.2, 0.275, 14.6);
  for (let x = -72.6; x < -51.8; x += 0.5) B.box(roller, 0.07, 0.07, 1.2, x, 0.58, 23.9);
  for (let z = 4.8; z < 24.5; z += 0.5) B.box(roller, 1.2, 0.07, 0.07, -52.2, 0.58, z);
  for (const ax of AISLES) for (let z = 20.4; z < 23; z += 0.5) B.box(roller, 1.2, 0.07, 0.07, ax, 0.58, z);
  B.box(MAT.yellow, 1.8, 0.7, 1.8, -52.2, 0.35, 3.6); // 交接升降台
  const pCV = new Path([[-71.7, 0.62, 20.4], [-71.7, 0.62, 23.9], [-52.2, 0.62, 23.9], [-52.2, 0.62, 4.0]], { round: 0.9 });
  const fCV = new Flow(pCV, 9, { speed: 0.55, hideEnds: 0.3 });
  P.def('cv_pallet', new THREE.BoxGeometry(1.2, 0.14, 1.0), MAT.wood);
  P.def('cv_load', rbox(1.05, 0.95, 0.95, 0.05), MAT.kraft, { color: true });
  for (let i = 0; i < 9; i++) { const g = P.group(); P.node('cv_pallet', g).position.y = 0.07; P.node('cv_load', g, pick(LOAD_COLS)).position.y = 0.62; fCV.add(g); }
  upd.push((dt) => fCV.update(dt * SIM.rate, Math.min(SIM.speed('ASRS-01'), 1)));
  // 叉车充电位
  for (let i = 0; i < 3; i++) { B.box(MAT.graphite, 0.5, 1.4, 0.4, -55 + i * 2.2, 0.7, 33.9); B.box(MAT.lampGreen, 0.2, 0.06, 0.02, -55 + i * 2.2, 1.2, 33.69); }

  // =============== 操作工（共用零件） ===============
  const wg = workerGeoms();
  P.def('w_legs', wg.legs, M('workwear', { color: 0x2f3742, roughness: 0.85 }));
  P.def('w_torso', wg.torso, M('vest', { color: 0xffffff, roughness: 0.8 }, { grime: 0.4 }), { color: true });
  P.def('w_arm', wg.arm, M('workwear'));
  P.def('w_head', wg.head, M('skin', { color: 0xb08a6e, roughness: 0.7 }, { grime: 0.2 }));
  P.def('w_helmet', wg.helmet, M('helmet', { color: 0xffffff, roughness: 0.4 }, { grime: 0.2 }), { color: true });
  ctx.makeWorker = (parent, opt = {}) => {
    const root = P.group(parent);
    const hip = P.group(root); hip.position.y = 0.88;
    const lL = P.node('w_legs', hip); lL.position.x = -0.1; const lR = P.node('w_legs', hip); lR.position.x = 0.1;
    const torso = P.node('w_torso', hip, opt.vest ?? '#c27a3a'); torso.position.y = 0.02;
    const aL = P.node('w_arm', hip); aL.position.set(-0.26, 0.56, 0); const aR = P.node('w_arm', hip); aR.position.set(0.26, 0.56, 0);
    const head = P.node('w_head', hip); head.position.y = 0.78;
    const hel = P.node('w_helmet', hip, opt.helmet ?? '#e8e2d2'); hel.position.y = 0.82;
    // 身体朝向 +z；root.rotation.y 设定面向
    return { root, hip, lL, lR, aL, aR, torso, t: R() * 10 };
  };
  ctx.animWorker = (w, dt, mode, k = 1) => {
    w.t += dt;
    if (mode === 'walk') { const s = Math.sin(w.t * 7) * 0.45 * k; w.lL.rotation.x = s; w.lR.rotation.x = -s; w.aL.rotation.x = -s * 0.8; w.aR.rotation.x = s * 0.8; w.hip.position.y = 0.88 + Math.abs(Math.cos(w.t * 7)) * 0.03 * k; }
    else if (mode === 'work') { w.lL.rotation.x = w.lR.rotation.x = 0; w.aL.rotation.x = -0.9 + Math.sin(w.t * 2.3) * 0.25 * k; w.aR.rotation.x = -1.1 + Math.sin(w.t * 3.1 + 1) * 0.35 * k; w.hip.rotation.x = 0.12; }
    else if (mode === 'sit') { w.lL.rotation.x = w.lR.rotation.x = -1.45; w.hip.position.y = 0.5; w.aL.rotation.x = w.aR.rotation.x = -0.9; }
    else { w.lL.rotation.x = w.lR.rotation.x = 0; w.aL.rotation.x = Math.sin(w.t * 0.8) * 0.05; w.aR.rotation.x = -Math.sin(w.t * 0.8) * 0.05; }
  };

  // =============== 叉车 ===============
  const fg = forkliftGeoms();
  P.def('fk_body', fg.body, M('forkBody', { color: 0xc96b2c, roughness: 0.45 }));
  P.def('fk_guard', fg.guard, MAT.graphite); P.def('fk_mast', fg.mast, MAT.graphite); P.def('fk_forks', fg.forks, MAT.steelDark); P.def('fk_tires', fg.tires, MAT.rubber);
  P.def('fk_pallet', mergeT([[new THREE.BoxGeometry(1.2, 0.14, 1.0), mtx(0, 0.07, 0)]]), MAT.wood);
  P.def('fk_load', rbox(1.05, 1.05, 0.95, 0.05), MAT.kraft, { color: true });
  P.def('fk_beacon', new THREE.SphereGeometry(0.07, 8, 6), MAT.lampAmber);
  const pFK = new Path([[-75.4, 0, 24.0], [-73.2, 0, 26.4], [-58.0, 0, 26.4], [-55.4, 0, 29.4], [-62, 0, 32.2], [-75.4, 0, 33.0], [-70.5, 0, 28.5]], { round: 2.4, closed: true });
  const forklifts = [0, 0.5].map((off, i) => {
    const root = P.group(); P.node('fk_body', root); P.node('fk_guard', root); P.node('fk_mast', root); P.node('fk_tires', root);
    const lift = P.group(root); P.node('fk_forks', lift);
    const pal = P.node('fk_pallet', lift); pal.position.set(1.55, 0.06, 0);
    const ld = P.node('fk_load', lift, pick(LOAD_COLS)); ld.position.set(1.55, 0.72, 0);
    const bc = P.node('fk_beacon', root); bc.position.set(-0.05, 2.32, 0);
    const drv = ctx.makeWorker(root, { vest: '#c27a3a' }); drv.root.position.set(-0.35, 0.55, 0); drv.root.rotation.y = Math.PI / 2;
    return { root, lift, pal, ld, s: off * pFK.L, drv };
  });
  upd.push((dt) => {
    const sp = SIM.speed('DOCK-IN') * SIM.rate;
    const o = {};
    for (const f of forklifts) {
      f.s = (f.s + dt * sp * 1.7) % pFK.L;
      pFK.at(f.s, o); f.root.position.set(o.x, 0, o.z); f.root.rotation.y = o.yaw;
      const u = f.s / pFK.L; const loaded = u < 0.42;
      f.pal.visible = f.ld.visible = loaded; f.lift.position.y = loaded ? 0.25 : 0.08;
      ctx.animWorker(f.drv, dt, 'sit');
    }
  });

  // =============== 卡车（牵引车 + 铰接挂车） ===============
  const tg = truckGeoms();
  const ribTex = canvasTex(256, 256, (g, W, H) => { g.fillStyle = '#c7c3ba'; g.fillRect(0, 0, W, H); for (let x = 0; x < W; x += 16) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x, 0, 3, H); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 3, 0, 2, H); } g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, W, 6); g.fillRect(0, H - 6, W, 6); }, { repeat: true });
  ribTex.repeat.set(1 / 1.0, 1 / 2.75);
  const trailerMat = M('trailerBox', { color: 0xffffff, map: ribTex, roughness: 0.55, metalness: 0.2 });
  P.def('tk_cab', tg.cab, M('cab', { color: 0xffffff, roughness: 0.35, metalness: 0.25 }, { grime: 0.4 }), { color: true });
  P.def('tk_glass', tg.cabGlass, MAT.glassDark); P.def('tk_chassis', tg.chassis, MAT.graphite); P.def('tk_ttires', tg.tractorTires, MAT.rubber);
  P.def('tk_box', tg.box, trailerMat, { color: true }); P.def('tk_tchassis', tg.tChassis, MAT.graphite); P.def('tk_trtires', tg.trailerTires, MAT.rubber);
  P.def('tk_stripe', new THREE.BoxGeometry(13.5, 0.12, 2.57).translate(-6.8, 3.2, 0), MAT.lampAmber, { shadow: false });
  const makeTractor = (col) => { const r = P.group(); P.node('tk_cab', r, col); P.node('tk_glass', r); P.node('tk_chassis', r); P.node('tk_ttires', r); return r; };
  const makeTrailer = (col) => { const r = P.group(); P.node('tk_box', r, col); P.node('tk_tchassis', r); P.node('tk_trtires', r); return r; };
  const Y = HALL.apron;
  // 停靠的挂车（28.5 带车头 / 33 已甩挂）
  const parkTruck = (z, withCab, colCab, colBox) => {
    const tr = makeTrailer(colBox); tr.position.set(-92.3, Y, z); tr.rotation.y = Math.PI;
    if (withCab) { const c = makeTractor(colCab); c.position.set(-94.5, Y, z); c.rotation.y = Math.PI; }
  };
  parkTruck(28.5, true, '#d8d2c4', '#d4d0c7'); parkTruck(33, false, '#3f5566', '#c9c4b9');
  // 铰接运动学：F 前轴（引导前进）、P 牵引销、A 挂车后轴组（引导倒车）
  const LC = 3.6, LT = 9.8;
  class Truck {
    constructor(colCab, colBox, script, id) { this.tractor = makeTractor(colCab); this.trailer = makeTrailer(colBox); this.script = script; this.i = 0; this.s = 0; this.wait = rr(2, 8); this.id = id; this.F = new THREE.Vector2(); this.P = new THREE.Vector2(); this.A = new THREE.Vector2(); this.hide(); }
    hide() { this.tractor.visible = this.trailer.visible = false; }
    placeChain(fx, fz, yaw) { const dx = Math.cos(yaw), dz = -Math.sin(yaw); this.F.set(fx, fz); this.P.set(fx - dx * LC, fz - dz * LC); this.A.set(this.P.x - dx * LT, this.P.y - dz * LT); }
    apply() {
      const Fv = this.F, Pv = this.P, Av = this.A;
      const yT = Math.atan2(-(Fv.y - Pv.y), Fv.x - Pv.x), yR = Math.atan2(-(Pv.y - Av.y), Pv.x - Av.x);
      // 牵引车原点：牵引销在其局部 x = -3.4
      this.tractor.position.set(Pv.x + Math.cos(yT) * 3.4, Y, Pv.y - Math.sin(yT) * 3.4); this.tractor.rotation.y = yT;
      this.trailer.position.set(Pv.x + Math.cos(yR) * 1.2, Y, Pv.y - Math.sin(yR) * 1.2); this.trailer.rotation.y = yR;
      this.tractor.visible = this.trailer.visible = true;
    }
    update(dt) {
      const sp = SIM.speed(this.id) * SIM.rate;
      const st = this.script[this.i]; const o = {};
      if (st.wait != null) { this.wait -= dt * sp; if (this.wait <= 0) this.next(); if (st.hidden) this.hide(); return; }
      this.s += dt * sp * (st.v ?? 4);
      const L = st.path.L, s = Math.min(this.s, L);
      st.path.at(s, o);
      if (st.dir > 0) { // 前进：F 跟路径
        this.F.set(o.x, o.z);
        const d1 = this.F.clone().sub(this.P).normalize(); this.P.copy(this.F).addScaledVector(d1, -LC);
        const d2 = this.P.clone().sub(this.A).normalize(); this.A.copy(this.P).addScaledVector(d2, -LT);
      } else {        // 倒车：A 跟路径
        this.A.set(o.x, o.z);
        const d2 = this.P.clone().sub(this.A).normalize(); this.P.copy(this.A).addScaledVector(d2, LT);
        const d1 = this.F.clone().sub(this.P).normalize(); this.F.copy(this.P).addScaledVector(d1, LC);
      }
      this.apply();
      if (this.s >= L) this.next();
    }
    next() { this.i = (this.i + 1) % this.script.length; this.s = 0; const st = this.script[this.i]; if (st.wait != null) this.wait = st.wait * rr(0.8, 1.25); if (st.init) { this.placeChain(...st.init); this.apply(); } }
  }
  // 西侧进厂（第 1 号门 z=24）
  const W1 = new Path([[-128, 0, 29], [-101, 0, 29], [-101, 0, -1.4]], { round: 9 });
  const W2 = new Path([[-101, 0, 12.0], [-101, 0, 18], [-96, 0, 24], [-81.3, 0, 24]], { round: 6 });
  const W3 = new Path([[-94.7, 0, 24], [-122, 0, 24], [-136, 0, 14], [-136, 0, -76]], { round: 8 });
  const truckW = new Truck('#d8d2c4', '#cdc9bf', [
    { wait: 6, hidden: true }, { path: W1, dir: 1, v: 5, init: [-128, 29, 0] }, { wait: 1.2 }, { path: W2, dir: -1, v: 1.6 }, { wait: 26 }, { path: W3, dir: 1, v: 4.5 },
  ], 'DOCK-IN');
  // 东侧发运（z=20）
  const E1 = new Path([[124, 0, 11], [101, 0, 11], [101, 0, -19.4]], { round: 9 });
  const E2 = new Path([[101, 0, -6.0], [101, 0, 0], [96, 0, 6], [81.3, 0, 6]], { round: 6 });
  const E3 = new Path([[94.7, 0, 6], [116, 0, 6], [124, 0, -4], [124, 0, -84]], { round: 8 });
  const truckE = new Truck('#3f5566', '#d3cfc6', [
    { wait: 18, hidden: true }, { path: E1, dir: 1, v: 5, init: [124, 11, Math.PI] }, { wait: 1.2 }, { path: E2, dir: -1, v: 1.6 }, { wait: 30 }, { path: E3, dir: 1, v: 4.5 },
  ], 'DOCK-OUT');
  upd.push((dt) => { truckW.update(dt); truckE.update(dt); });

  // =============== AGV ===============
  const ag = agvGeoms();
  P.def('agv_chassis', ag.chassis, MAT.graphite); P.def('agv_deck', ag.deck, MAT.ivory); P.def('agv_lidar', ag.lidar, MAT.graphite);
  P.def('agv_strip', ag.strip, MAT.lampAmber, { shadow: false }); P.def('agv_stripR', ag.strip, MAT.lampRed, { shadow: false });
  P.def('agv_cart', ag.cart, MAT.steel); P.def('agv_bins', ag.bins, M('bins', { color: 0xffffff, roughness: 0.6 }, { grime: 0.6 }), { color: true });
  const pAGV = new Path([[-47.6, 0, -1.5], [61.2, 0, -1.5], [61.2, 0, 1.5], [-47.6, 0, 1.5]], { round: 1.5, closed: true });
  ctx.agvPath = pAGV;
  const binCols = ['#56687a', '#6d7175', '#7a6a55', '#4d5a55', '#8a8f95'];
  const mkAGV = (parent) => {
    const root = P.group(parent); P.node('agv_chassis', root); P.node('agv_deck', root); P.node('agv_lidar', root);
    const sa = P.node('agv_strip', root), sr = P.node('agv_stripR', root);
    const cart = P.group(root); P.node('agv_cart', cart); P.node('agv_bins', cart, pick(binCols));
    return { root, sa, sr, cart };
  };
  const agvs = [];
  for (let i = 0; i < 8; i++) { const a = mkAGV(); a.s = (i / 8) * pAGV.L; a.lift = 0; agvs.push(a); }
  // 充电位上的两台
  for (let i = 0; i < 2; i++) { const a = mkAGV(); a.root.position.set(-46 + i * 2.4 + 1.1, 0, 4.9); a.root.rotation.y = Math.PI / 2; a.sr.visible = false; a.cart.visible = false; }
  for (let i = 0; i < 4; i++) { B.box(MAT.graphite, 0.6, 0.9, 0.25, -46 + i * 2.4 + 1.1, 0.45, 6.0); B.box(i < 2 ? MAT.lampGreen : MAT.lampAmber, 0.3, 0.05, 0.02, -46 + i * 2.4 + 1.1, 0.75, 5.86); }
  ctx.agvs = agvs;
  upd.push((dt) => {
    const st = SIM.state('AGV-01'); const sp = SIM.speed('AGV-01') * SIM.rate; const o = {};
    for (const a of agvs) {
      a.s = (a.s + dt * sp * 1.25) % pAGV.L;
      pAGV.at(a.s, o); a.root.position.set(o.x, 0, o.z); a.root.rotation.y = o.yaw;
      a.sa.visible = st !== 'down'; a.sr.visible = st === 'down';
    }
  });

  ctx.logistics = { stackers, forklifts, agvs, trucks: [truckW, truckE] };
  ctx.updaters.push((dt, t) => { for (const f of upd) f(dt, t); });
}
