// 智能建造：巡检无人机 + 机场、四足机器狗、钢筋绑扎机器人、钢柱焊接机器人、墙面打磨机器人、全站仪、
// AI 监控杆、塔吊远程操控室、智慧工地大屏、扬尘监测 + 雾炮联动、实名制闸机。
// 和 life.js 一样：哪些在场看施工阶段，怎么动看真实时间（秒）。坐标先写 Blender 的 (x, y, z)，再用 V() 转。
import * as THREE from 'three';
import { V, AX, rot, place, angLerp, Path, clamp, lerp, smooth, frac, hash } from './util.js';
import { dateOf } from './core.js';

const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

// 沿 Blender 局部轴平移（在初始位置上叠加）
function slide(o, axis, d) {
  if (!o) return;
  if (!o.userData.p0) o.userData.p0 = o.position.clone();
  o.position.copy(o.userData.p0).addScaledVector(AX[axis], d);
}

export class Smart {
  constructor(life) {
    this.L = life;
    this.g = life.g;
    this.sch = life.sch;
    this.P = life.P;
    this.spec = life.spec;
    this.mats = life.mats;
    const g = this.g;
    // 屏幕材质：自己发一点蓝光（操控室、闸机上的屏）
    for (const m of this.mats) if (m.name === 'screen' && m.emissive) { m.emissive.setHex(0x1d3a5c); m.emissiveIntensity = 0.9; }
    const put = (name, x, y, z = 0, h = 0) => { const o = life.clone(name); o.userData.base = name; place(o, x, y, z, h); return o; };
    const N = (o, s) => life.node(o, s);

    // ---- 无人机机场：项目部屋顶；无人机每 150 s 出一趟，绕楼巡一圈
    this.dockPos = { x: -38.5, y: g.road - 27, z: 5.8 };
    this.dock = put('M_Dock', this.dockPos.x, this.dockPos.y, this.dockPos.z, 0);
    this.lids = [N(this.dock, '_LidP'), N(this.dock, '_LidN')];
    this.drone = put('M_Drone', this.dockPos.x, this.dockPos.y, this.dockPos.z + 0.49, 0);
    this.rotors = [0, 1, 2, 3].map((i) => N(this.drone, `_Rot${i}`));

    // ---- 机器狗：一只在地面绕基坑巡，一只在最新一层楼板上绕核心筒巡
    const dogLegs = (o) => ['FL', 'FR', 'RL', 'RR'].map((tag) => ({ tag, hip: N(o, `_${tag}_Hip`), knee: o.getObjectByName(`${o.name}_${tag}_Knee`) }));
    this.dogs = [put('M_RobotDog', 0, 0), put('M_RobotDog', 0, 0)].map((o) => ({ o, legs: dogLegs(o) }));
    const d = 2.5;
    // 闭合路线从一条边的中点开始、到同一点结束，接缝在直线上，循环不会跳
    const mx = (g.hx0 + g.hx1) / 2;
    this.dogPath = new Path([[mx, g.hy0 - d], [g.hx1 + d, g.hy0 - d], [g.hx1 + d, g.hy1 + 7.2], [g.hx0 - d, g.hy1 + 7.2], [g.hx0 - d, g.hy0 - d], [mx, g.hy0 - d]], 3);
    this.dogPath2 = new Path([[0, -17.5], [17.5, -17.5], [17.5, 17.5], [-17.5, 17.5], [-17.5, -17.5], [0, -17.5]], 2);

    // ---- 钢筋绑扎机器人：楼承板铺好、楼板还没浇的那层（counts.slab + 1），南北各一台，网格是那片钢筋网
    this.rebar = [put('M_RebarBot', 0, 0), put('M_RebarBot', 0, 0)].map((o) => ({ o, car: N(o, '_Car'), gun: o.getObjectByName('M_RebarBot_Gun') }));
    // 钢筋网本身在 works.js 里整层画

    // ---- 钢柱焊接机器人：最新一个钢柱对接节点（每三层一个），四根中柱各一台
    this.weldCols = [[0, 24], [24, 0], [0, -24], [-24, 0]];
    this.welds = this.weldCols.map(() => ({ ring: put('M_WeldRing', 0, 0), cart: put('M_WeldCart', 0, 0) }));
    const sc = document.createElement('canvas');
    sc.width = sc.height = 64;
    const sx = sc.getContext('2d');
    const gr = sx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(190,220,255,0.9)'); gr.addColorStop(1, 'rgba(120,160,255,0)');
    sx.fillStyle = gr; sx.fillRect(0, 0, 64, 64);
    const sm = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.sparks = this.welds.map(() => { const s = new THREE.Sprite(sm); life.root.add(s); return s; });

    // ---- 墙面打磨机器人：幕墙封闭以后，往下几层开始做内墙（贴着核心筒北墙走）
    this.grinder = put('M_Grinder', 0, 0);
    this.grLift = N(this.grinder, '_Lift');
    this.grHead = this.grinder.getObjectByName('M_Grinder_Head');

    // ---- 全站仪：一台在基坑边做变形监测，一台在最新一层楼板上放线
    this.tsGround = put('M_TotalStation', g.hx0 - 4.5, g.hy0 - 4.5);
    this.tsFloor = put('M_TotalStation', -21, -21);

    // ---- AI 监控杆
    this.poles = [[g.cx + 14.4, g.fy0 + 1.4, Math.PI / 2], [g.hx0 - 5, g.hy1 + 4, -Math.PI / 4], [g.hx1 + 4, g.hy0 - 5, 3 * Math.PI / 4], [g.hx1 + 4, g.hy1 + 4, -3 * Math.PI / 4]]
      .map(([x, y, h], i) => { const o = put('P_CamPole', x, y, 0, h); return { o, ptz: N(o, '_PTZ'), i }; });

    // ---- 塔吊远程操控室（项目部旁边），窗朝北
    this.cab = put('P_RemoteCab', -28, g.road - 27.2, 0, 0);

    // ---- 实名制闸机（大门东边的人行口）
    this.gate = put('P_FaceGate', g.cx + 11, g.fy0 + 0.2, 0, 0);

    // ---- 智慧工地大屏、扬尘噪声监测站：屏朝南（朝市政路）
    this.led = put('P_LEDScreen', g.cx + 26, g.fy0 + 1.4, 0, -Math.PI / 2);
    this.ledTex = this._screen(this.led, 1280, 720);
    this.dust = put('P_DustStation', g.cx + 33.5, g.fy0 + 1.6, 0, -Math.PI / 2);
    this.dustTex = this._screen(this.dust, 512, 307);
    this.cups = N(this.dust, '_Cups');

    // ---- 雾炮机：基坑东西两边，扬尘高了自动开
    this.fogs = [[g.hx0 - 7, 6, 0], [g.hx1 + 5.5, 20, Math.PI]].map(([x, y, h]) => {
      const o = put('M_FogCannon', x, y, 0, h);
      const barrel = N(o, '_Barrel');
      const mist = new THREE.Group();
      for (const [r, h2, op] of [[2.5, 14, 0.32], [5, 24, 0.2], [8, 32, 0.1]]) {
        const geo = new THREE.ConeGeometry(r, h2, 24, 1, true).translate(0, -h2 / 2, 0).rotateZ(Math.PI / 2);
        const mm = new THREE.MeshBasicMaterial({ color: 0xf4f8fb, map: this._mistTex(), alphaMap: this._mistTex(), transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide });
        this.mats.add(mm);
        mist.add(new THREE.Mesh(geo, mm));
      }
      mist.position.set(0.75, 0, 0);
      barrel.add(mist);
      return { o, slew: N(o, '_Slew'), barrel, mist };
    });

    this.env = { pm10: 50, pm25: 22, noise: 62, wind: 2, temp: 18, fog: false };
    this.lastDraw = -1;
  }

  // 水雾贴图：一些竖条（沿喷射方向）+ 往尖端淡出，偏移着滚动
  _mistTex() {
    if (this._mt) return this._mt;
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 70; i++) {
      const x = hash(i) * 128, w = 2 + hash(i + 50) * 6, a = 0.25 + hash(i + 99) * 0.5;
      const g = c.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.5, `rgba(255,255,255,${a * 0.6})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(x, 0, w, 128);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this._mt = tex;
    return tex;
  }

  // 屏面：_Face 节点上贴一块画布
  _screen(o, w, h) {
    const face = this.L.node(o, '_Face');
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const ud = face.userData;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(ud.w || 1, ud.h || 1), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    plane.rotation.y = Math.PI / 2;      // 平面默认朝 +z（three），转到朝 Blender +X
    plane.position.x = 0.012;
    face.add(plane);
    this.mats.add(plane.material);
    return { tex, ctx: cv.getContext('2d'), w, h };
  }

  // ================================================================== 每帧
  update(st, t) {
    const sch = this.sch, k = sch.ph[st.phase].key;
    this._env(st, t, k);
    this._drone(st, t);
    this._dogs(st, t);
    this._rebar(st, t);
    this._weld(st, t);
    this._grind(st, t);
    // 全站仪：地面那台从地连墙到地下室结束；楼上那台跟着最新楼板
    const pitWork = st.day >= sch.dwall.t0 && st.day < sch.ph.find((p) => p.key === 'basement').t1;
    this.tsGround.visible = pitWork;
    if (pitWork) rot(this.L.node(this.tsGround, '_Head'), 'z', Math.floor(t / 9) * 1.3 + smooth(frac(t / 9) * 3) * 1.3);
    const f = st.counts.slab;
    this.tsFloor.visible = f >= 2 && st.day < sch.done.curtain[sch.N];
    if (this.tsFloor.visible) {
      place(this.tsFloor, -21, -21, sch.z[f + 1]);
      rot(this.L.node(this.tsFloor, '_Head'), 'z', Math.floor(t / 7) * 0.9 + smooth(frac(t / 7) * 3) * 0.9);
    }
    // 监控杆的球机来回扫
    for (const p of this.poles) rot(p.ptz, 'z', Math.sin(t * 0.15 + p.i * 1.3) * 1.0);
    this.cab.visible = st.day >= sch.raft.t1 && st.day < sch.dismantle.t1 + 6;
    // 雾炮
    const fogShow = st.day < sch.ph.find((p) => p.key === 'basement').t1;
    this.fogs.forEach((F, i) => {
      F.o.visible = fogShow;
      if (!fogShow) return;
      rot(F.slew, 'z', Math.sin(t * 0.12 + i * 2) * 0.6);
      rot(F.barrel, 'y', -0.28);
      F.mist.visible = this.env.fog;
      if (i === 0 && this._mt) this._mt.offset.set((t * 0.05) % 1, (-t * 0.6) % 1);
      const s = 1 + Math.sin(t * 2.1 + i) * 0.04;
      F.mist.scale.set(1, s, s);
    });
    rot(this.cups, 'z', t * (2 + this.env.wind * 1.5));
    // 屏幕每秒刷新一次
    const sec = Math.floor(t);
    if (sec !== this.lastDraw) {
      this.lastDraw = sec;
      this._drawLED(st, t, k);
      this._drawDust();
    }
  }

  // ---------------------------------------------------------------- 环境监测（示意数值）+ 雾炮联动
  _env(st, t, k) {
    const dusty = { site: 0.6, dwall: 0.8, excavate: 1.0, raft: 0.7, basement: 0.45 }[k] ?? 0.25;
    const raw = 38 + 58 * dusty + 14 * Math.sin(t / 37) + 8 * Math.sin(t / 11.3);
    const fog = raw > 80 && st.day < this.sch.ph.find((p) => p.key === 'basement').t1;
    const pm10 = fog ? raw * 0.72 : raw;
    const doy = (st.day + 61) % 365;                   // 开工 3 月 2 日
    const temp = 17 + 11 * Math.sin(2 * Math.PI * (doy - 105) / 365) + 2 * Math.sin(t / 50);
    const busy = { site: 0.5, finish: 0.4 }[k] ?? 1;
    this.env = { pm10, pm25: pm10 * 0.46, noise: 56 + 12 * busy + 2.5 * Math.sin(t / 7), wind: 2.2 + 1.4 * Math.sin(t / 23) + 0.6 * Math.sin(t / 5), temp, fog };
  }

  // ---------------------------------------------------------------- 无人机
  _drone(st, t) {
    const D = this.dockPos, T = 150;
    const u = frac((t + 17) / T) * T;
    const top = Math.min(this.L.stage.topZ(), 262);
    const Ho = Math.max(35, top + 12), Ro = 46;
    const a0 = Math.atan2(D.y, D.x);
    const pad = D.z + 0.49, C = { x: D.x, y: D.y, z: D.z + 22 }, E = { x: Ro * Math.cos(a0), y: Ro * Math.sin(a0), z: Ho };
    const dGo = Math.hypot(E.x - C.x, E.y - C.y, E.z - C.z), tGo = dGo / 15, tOrb = (2 * Math.PI * Ro) / 9;
    const seg = [5, 8, tGo, tOrb, tGo, 8, 5];
    const b = [0];
    for (const s of seg) b.push(b[b.length - 1] + s);
    let x = D.x, y = D.y, z = pad, h = 0, pitch = 0, lid = 0, spin = false;
    const L3 = (A, B, s) => [lerp(A.x, B.x, s), lerp(A.y, B.y, s), lerp(A.z, B.z, s)];
    if (u < b[1]) lid = smooth(u / 5);
    else if (u < b[2]) { lid = 1; spin = true; z = lerp(pad, C.z, smooth((u - b[1]) / 8)); }
    else if (u < b[3]) { lid = 1; spin = true; const s = smooth((u - b[2]) / tGo); [x, y, z] = L3(C, E, s); h = Math.atan2(E.y - C.y, E.x - C.x); pitch = 0.18 * Math.sin(Math.PI * s); }
    else if (u < b[4]) {
      lid = 1; spin = true;
      const a = a0 + 2 * Math.PI * ((u - b[3]) / tOrb);
      x = Ro * Math.cos(a); y = Ro * Math.sin(a); z = Ho + 3 * Math.sin(2 * a);
      h = a + Math.PI;                                // 机头（相机）对着楼
    } else if (u < b[5]) { lid = 1; spin = true; const s = smooth((u - b[4]) / tGo); [x, y, z] = L3(E, C, s); h = Math.atan2(C.y - E.y, C.x - E.x); pitch = 0.18 * Math.sin(Math.PI * s); }
    else if (u < b[6]) { lid = 1; spin = true; z = lerp(C.z, pad, smooth((u - b[5]) / 8)); h = 0; }
    else if (u < b[7]) lid = 1 - smooth((u - b[6]) / 5);
    // 机头方向慢慢转过去（掉头、转向楼时不瞬间跳）
    if (u >= b[2] && u < b[6]) this.hS = angLerp(this.hS ?? h, h, 0.06); else this.hS = angLerp(this.hS ?? 0, 0, 0.06);
    if (u < b[1] || u >= b[6] + 3) this.hS = 0;
    h = this.hS;
    this.drone.position.copy(V(x, y, z));
    this.drone.quaternion.copy(_q1.setFromAxisAngle(AX.z, h)).multiply(_q2.setFromAxisAngle(AX.y, pitch));
    this.rotors.forEach((r, i) => rot(r, 'z', spin ? t * 70 * (i % 2 ? -1 : 1) : 0.4 * i));
    this.lids.forEach((l) => rot(l, 'y', (l.userData.open || 2.38) * lid));
    this.droneState = u < b[1] ? '出舱' : u < b[3] ? '飞往楼顶' : u < b[4] ? '环绕巡检' : u < b[6] ? '返航' : u < b[7] ? '入舱' : '充电待命';
  }

  // ---------------------------------------------------------------- 机器狗：对角小跑（trot）
  _gait(dog, s) {
    const A = 0.24, stride = 0.6;
    const ph = s / stride;
    for (const L of dog.legs) {
      const p = frac(ph + (L.tag === 'FL' || L.tag === 'RR' ? 0 : 0.5));
      let hip, knee = 0;
      if (p < 0.5) hip = lerp(-A, A, p / 0.5);                         // 着地：脚往后蹬
      else { const v = (p - 0.5) / 0.5; hip = lerp(A, -A, smooth(v)); knee = -0.6 * Math.sin(Math.PI * v); }   // 抬腿往前摆
      rot(L.hip, 'y', hip);
      rot(L.knee, 'y', knee);
    }
  }

  _dogs(st, t) {
    const sch = this.sch;
    const v = 1.1;
    const P1 = this.dogPath;
    const p1 = P1.at(frac((t * v) / P1.len) * P1.len);
    const d0 = this.dogs[0];
    place(d0.o, p1.x, p1.y, 0.0, p1.h);
    d0.o.position.y += Math.abs(Math.sin((t * v) / 0.6 * Math.PI)) * 0.012;
    this._gait(d0, t * v);
    const d1 = this.dogs[1], f = st.counts.slab;
    d1.o.visible = f >= 3 && st.day < sch.done.curtain[sch.N];
    if (d1.o.visible) {
      const P2 = this.dogPath2;
      const p2 = P2.at(frac((t * 0.9 + 20) / P2.len) * P2.len);
      place(d1.o, p2.x, p2.y, sch.z[f + 1], p2.h);
      this._gait(d1, t * 0.9);
    }
  }

  // ---------------------------------------------------------------- 钢筋绑扎机器人
  _rebar(st, t) {
    const sch = this.sch, f = st.counts.slab + 1;
    const ok = f >= 1 && f <= sch.N && st.counts.deck >= f && st.day < sch.dismantle.t1 + 30;
    this.rebar.forEach((r) => { r.o.visible = ok; });
    if (!ok) return;
    const z = sch.z[f + 1] - 0.03;
    const rows = 10, stops = 96, tStop = 5.6, tRow = stops * tStop + 3;
    const offs = [-0.3, -0.1, 0.1, 0.3];
    this.rebar.forEach((r, i) => {
      const tau = frac((t + i * 777) / (rows * tRow)) * rows * tRow;
      const row = Math.floor(tau / tRow), tr = tau - row * tRow;
      const dir = row % 2 ? -1 : 1;
      const yr = 14.6 + row * 0.8;
      let x, yy = yr, cy = 0, gz = 0;
      if (tr < stops * tStop) {
        const j = Math.floor(tr / tStop), ts = tr - j * tStop;
        const xa = -9.2 + 0.2 * j, xb = xa + 0.2;
        if (ts < 4.8) {
          const c = Math.floor(ts / 1.2), w = (ts - c * 1.2) / 1.2;
          cy = lerp(c ? offs[c - 1] : offs[3], offs[c], smooth(w / 0.3));
          gz = w > 0.35 && w < 0.8 ? -0.12 * Math.sin(Math.PI * (w - 0.35) / 0.45) : 0;
          x = xa;
        } else x = lerp(xa, xb, smooth((ts - 4.8) / 0.8));
        if (dir < 0) x = -x;
      } else {
        x = dir > 0 ? 10.0 : -10.0;
        yy = lerp(yr, yr + 0.8, smooth((tr - stops * tStop) / 3));
      }
      const sgn = i === 0 ? 1 : -1;            // 第二台在南边那片
      place(r.o, sgn * x, sgn * yy, z, i === 0 ? 0 : Math.PI);
      slide(r.car, 'y', cy);
      slide(r.gun, 'z', gz);
    });
  }

  // ---------------------------------------------------------------- 钢柱焊接机器人
  _weld(st, t) {
    const sch = this.sch, c = st.counts.column;
    let jf = c;
    while (jf >= 1 && jf % 3 !== 1) jf--;
    const ok = jf >= 4 && c < sch.N && c - jf <= 1 && st.day >= sch.raft.t1;
    this.welds.forEach((w, i) => {
      w.ring.visible = w.cart.visible = this.sparks[i].visible = ok;
      if (!ok) return;
      const [cx, cy] = this.weldCols[i];
      const r = (this.spec.tower.col_d[jf] || 1.0) / 2;
      const seam = sch.z[jf] + 1.26;
      const zr = seam - 0.17;
      place(w.ring, cx, cy, zr);
      w.ring.scale.set(r + 0.03, 1, r + 0.03);
      const th = t * 0.11 + i * 1.7;
      const R = r + 0.03;
      place(w.cart, cx + R * Math.cos(th), cy + R * Math.sin(th), zr, th + Math.PI);
      const sp = this.sparks[i];
      sp.position.copy(V(cx + (r + 0.01) * Math.cos(th), cy + (r + 0.01) * Math.sin(th), seam));
      const fl = 0.22 + 0.18 * hash(Math.floor(t * 24) + i * 31);
      sp.scale.set(fl, fl, fl);
    });
  }

  // ---------------------------------------------------------------- 墙面打磨机器人（核心筒北墙外侧）
  _grind(st, t) {
    const sch = this.sch, fg = st.counts.curtain - 3;
    const ok = fg >= 2 && st.day < sch.end;
    this.grinder.visible = ok;
    if (!ok) return;
    const x = 8.2 * Math.sin(t * 0.012);
    place(this.grinder, x, 12 + 0.6, sch.z[fg], -Math.PI / 2);
    slide(this.grLift, 'z', 0.45 + 0.42 * Math.sin(t * 0.21));
    rot(this.grHead, 'x', t * 18);
  }

  // ---------------------------------------------------------------- 大屏 / 监测屏
  _drawLED(st, t, k) {
    const { ctx: c, w: W, h: H, tex } = this.ledTex;
    const sch = this.sch, e = this.env;
    const g0 = c.createLinearGradient(0, 0, 0, H);
    g0.addColorStop(0, '#071322'); g0.addColorStop(1, '#0b1d33');
    c.fillStyle = g0; c.fillRect(0, 0, W, H);
    c.fillStyle = '#0f2a4a'; c.fillRect(0, 0, W, 78);
    c.fillStyle = '#ffb52e'; c.fillRect(0, 76, W, 3);
    c.textBaseline = 'middle';
    c.fillStyle = '#e8f1ff'; c.font = `600 38px ${FONT}`; c.textAlign = 'left';
    c.fillText('智慧工地 · 项目指挥屏', 32, 40);
    c.textAlign = 'right'; c.font = `500 28px ${FONT}`;
    c.fillText(`${dateOf(sch, st.day)}  ·  第 ${Math.floor(st.day)} 天`, W - 32, 40);
    // 进度
    const box = (x, y, w, h, title) => {
      c.fillStyle = 'rgba(40, 90, 150, 0.22)'; c.fillRect(x, y, w, h);
      c.strokeStyle = 'rgba(110, 170, 240, 0.45)'; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
      c.fillStyle = '#8fc3ff'; c.font = `600 26px ${FONT}`; c.textAlign = 'left'; c.fillText(title, x + 18, y + 28);
    };
    box(24, 100, 410, 450, '施工进度');
    const rows = [['核心筒', st.counts.core, sch.topCore, '#c9c6bd'], ['钢柱', st.counts.column, sch.N, '#8fb4d9'], ['钢梁', st.counts.steel, sch.N, '#6f9fe0'],
      ['楼承板', st.counts.deck, sch.N, '#b9c4cf'], ['楼板', st.counts.slab, sch.N, '#e0d49a'], ['幕墙', st.counts.curtain, sch.N, '#6fd3c8']];
    rows.forEach(([nm, n, tot, col], i) => {
      const y = 170 + i * 62;
      c.fillStyle = '#cfe0f5'; c.font = `500 25px ${FONT}`; c.textAlign = 'left'; c.fillText(nm, 44, y);
      c.textAlign = 'right'; c.fillStyle = '#ffffff'; c.font = `600 26px ${FONT}`; c.fillText(`${n}F / ${tot}`, 414, y);
      c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(44, y + 20, 370, 10);
      c.fillStyle = col; c.fillRect(44, y + 20, 370 * clamp(n / tot, 0, 1), 10);
    });
    // 环境
    box(454, 100, 390, 450, '环境监测');
    const lv = (v, a, b) => (v < a ? '#5fd38d' : v < b ? '#ffb52e' : '#ff6b5a');
    const env = [['PM2.5', e.pm25.toFixed(0), 'μg/m³', lv(e.pm25, 35, 75)], ['PM10', e.pm10.toFixed(0), 'μg/m³', lv(e.pm10, 80, 150)],
      ['噪声', e.noise.toFixed(0), 'dB(A)', lv(e.noise, 70, 75)], ['风速', e.wind.toFixed(1), 'm/s', lv(e.wind, 8, 10.8)], ['气温', e.temp.toFixed(0), '°C', '#cfe0f5']];
    env.forEach(([nm, v, unit, col], i) => {
      const y = 172 + i * 64;
      c.textAlign = 'left'; c.fillStyle = '#cfe0f5'; c.font = `500 25px ${FONT}`; c.fillText(nm, 476, y);
      c.textAlign = 'right'; c.fillStyle = col; c.font = `700 40px ${FONT}`; c.fillText(v, 740, y);
      c.fillStyle = '#8fa9c8'; c.font = `400 20px ${FONT}`; c.textAlign = 'left'; c.fillText(unit, 748, y + 4);
    });
    c.fillStyle = e.fog ? '#5fd38d' : '#8fa9c8'; c.font = `500 22px ${FONT}`; c.textAlign = 'left';
    c.fillText(e.fog ? '● 扬尘偏高：雾炮已自动开启' : '○ 雾炮待命（PM10 > 80 自动开）', 476, 515);
    // 设备
    box(864, 100, 392, 450, '设备与人员');
    const show = st.day >= sch.raft.t1 && st.day < sch.dismantle.t1 + 6;
    const ppl = Math.round(({ site: 60, dwall: 180, excavate: 220, raft: 320, basement: 600, low: 520, install: 480, cycle: 900, dismantle: 850, curtain: 700, finish: 380 }[k] ?? 300) * (1 + 0.04 * Math.sin(st.day)));
    const dev = [['塔吊（远程操控）', show ? '2 / 2 在线' : '未安装'], ['施工电梯', st.counts.slab >= 2 && st.day < sch.done.curtain[sch.N] - 3 ? '2 / 2 运行' : '—'],
      ['巡检无人机', this.droneState || '待命'], ['机器狗', this.dogs[1].o.visible ? '2 台巡检中' : '1 台巡检中'], ['在场人数', `${ppl} 人`], ['安全生产', `${Math.floor(st.day)} 天`]];
    dev.forEach(([nm, v], i) => {
      const y = 172 + i * 62;
      c.textAlign = 'left'; c.fillStyle = '#cfe0f5'; c.font = `500 25px ${FONT}`; c.fillText(nm, 884, y);
      c.textAlign = 'right'; c.fillStyle = '#ffffff'; c.font = `600 26px ${FONT}`; c.fillText(v, 1236, y);
    });
    // 滚动消息
    c.fillStyle = 'rgba(255, 181, 46, 0.14)'; c.fillRect(24, 572, W - 48, 118);
    const msgs = ['AI 视频：塔吊吊装区域有人闯入，已语音提醒', `塔吊力矩 ${(62 + 12 * Math.sin(t / 9)).toFixed(0)}%，群塔防碰撞正常`, 'AI 视频：1 人未系安全带，已推送给安全员',
      `扬尘 PM10 ${e.pm10.toFixed(0)} μg/m³${e.fog ? '，雾炮联动中' : ''}`, `无人机巡检：${this.droneState || '待命'}`, '实名制闸机：今日进场人员全部持证'];
    const m0 = Math.floor(t / 4) % msgs.length;
    c.fillStyle = '#ffb52e'; c.font = `600 26px ${FONT}`; c.textAlign = 'left';
    c.fillText('预警与消息', 44, 600);
    c.fillStyle = '#f2ead6'; c.font = `500 28px ${FONT}`;
    c.fillText(msgs[m0], 44, 642);
    c.fillStyle = '#8fa9c8'; c.font = `400 20px ${FONT}`; c.fillText(msgs[(m0 + 1) % msgs.length], 44, 676);
    c.textAlign = 'right'; c.fillStyle = '#5c7896'; c.font = `400 18px ${FONT}`; c.fillText('教学演示，数值为示意', W - 40, 676);
    tex.needsUpdate = true;
  }

  _drawDust() {
    const { ctx: c, w: W, h: H, tex } = this.dustTex, e = this.env;
    c.fillStyle = '#04080c'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#e83b2e'; c.font = `700 34px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('扬尘噪声在线监测', W / 2, 36);
    const row = (y, nm, v, unit, col) => {
      c.textAlign = 'left'; c.fillStyle = '#ffd34a'; c.font = `600 34px ${FONT}`; c.fillText(nm, 24, y);
      c.textAlign = 'right'; c.fillStyle = col; c.font = `700 44px ${FONT}`; c.fillText(v, 380, y);
      c.textAlign = 'left'; c.fillStyle = '#ffd34a'; c.font = `500 24px ${FONT}`; c.fillText(unit, 392, y + 4);
    };
    row(100, 'PM2.5', e.pm25.toFixed(0), 'μg/m³', '#4dff7c');
    row(160, 'PM10', e.pm10.toFixed(0), 'μg/m³', e.pm10 > 80 ? '#ff5a4a' : '#4dff7c');
    row(220, '噪声', e.noise.toFixed(0), 'dB', '#4dff7c');
    row(276, '风速', e.wind.toFixed(1), 'm/s', '#4dff7c');
    tex.needsUpdate = true;
  }

  // ================================================================== 给“智能建造”面板用：在不在场、跟拍哪个点
  present(key, st) {
    const sch = this.sch;
    switch (key) {
      case 'rebar': { const f = st.counts.slab + 1; return f >= 1 && f <= sch.N && st.counts.deck >= f && st.day < sch.dismantle.t1 + 30; }
      case 'weld': { const c = st.counts.column; let jf = c; while (jf >= 1 && jf % 3 !== 1) jf--; return jf >= 4 && c < sch.N && c - jf <= 1 && st.day >= sch.raft.t1; }
      case 'grind': return st.counts.curtain - 3 >= 2;
      case 'remote': return st.day >= sch.raft.t1 && st.day < sch.dismantle.t1 + 6;
      case 'fog': return st.day < sch.ph.find((p) => p.key === 'basement').t1;
      case 'survey': return (st.day >= sch.dwall.t0 && st.day < sch.ph.find((p) => p.key === 'basement').t1) || (st.counts.slab >= 2 && st.day < sch.done.curtain[sch.N]);
      default: return true;
    }
  }

  // 跟拍目标（three 坐标）；off 是初始机位相对目标的偏移（Blender 坐标）
  target(key) {
    const up = (o, dz) => (o && o.visible ? o.position.clone().add(new THREE.Vector3(0, dz, 0)) : null);
    switch (key) {
      case 'drone': return { get: () => this.drone.position.clone().add(new THREE.Vector3(0, 0.15, 0)), off: [3.5, -4.5, 1.6] };
      case 'dog': return { get: () => up(this.dogs[0].o, 0.4), off: [3.0, -3.6, 1.6] };
      case 'rebar': return { get: () => up(this.rebar[0].o, 0.5), off: [3.8, 1.2, 2.6] };
      case 'weld': return { get: () => up(this.welds[0].cart, 0.1), off: [1.6, 2.6, 0.9] };
      case 'grind': return { get: () => up(this.grinder, 0.9), off: [4.5, 3.6, 1.1] };
      case 'survey': return { get: () => up(this.tsFloor, 1.3) || up(this.tsGround, 1.3), off: [2.4, -3.2, 1.2] };
      case 'remote': return { get: () => up(this.cab, 1.3), off: [5, 9.5, 3] };
      case 'screen': return { get: () => up(this.led, 3.9), off: [2.5, -13, 3.2] };
      case 'gate': return { get: () => up(this.gate, 1.3), off: [6, -9, 3.5] };
      case 'fog': return { get: () => up(this.fogs[0].o, 1.5), off: [-6, -8, 4] };
      default: return null;
    }
  }
}
