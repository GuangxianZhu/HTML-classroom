// 第 7 章：动手做三个零件。工艺在 jobs.js，这里负责三维（工件网格、四方刀架、尾座刀具、成品展示）和讲义。
import * as THREE from 'three';
import { buildGeometry } from './work.js';
import { makeJobs, startJob, TOOL_NAME } from './jobs.js';
import * as K from './core.js';

const TAU = Math.PI * 2;

export function makeChapter(ctx) {
  const { S, layout: L, el, box, hud, setTags, basis, EV, B, side } = ctx;
  const J = makeJobs(L);
  const CX = L.carriage_x, AX = L.axis_z;
  const MAT = {
    brass: new THREE.MeshStandardMaterial({ color: 0xd6ad55, metalness: 1, roughness: 0.32 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xd3d7dd, metalness: 1, roughness: 0.3 }),
  };
  const mk = (c, m = 0.8, r = 0.4) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r });
  const M3 = { dark: mk(0x1c1d21, 0.5, 0.5), steel: mk(0x9aa0a8, 1, 0.3), tin: mk(0xd9a53a, 1, 0.3), black: mk(0x111215, 0.3, 0.55), hss: mk(0xc7ccd3, 1, 0.22) };

  // Blender 坐标(mm) 的盒子 / 沿 X 的圆柱 → three 网格
  const bbox = (m, x0, x1, y0, y1, z0, z1) => { const g = new THREE.Mesh(new THREE.BoxGeometry((x1 - x0) * 1e-3, (z1 - z0) * 1e-3, (y1 - y0) * 1e-3), m); g.position.copy(B((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)); g.castShadow = true; return g; };
  const xcyl = (m, x0, x1, r0, r1 = r0, y = 0, z = 0, n = 24) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(r1 * 1e-3, r0 * 1e-3, (x1 - x0) * 1e-3, n), m); g.rotation.z = -Math.PI / 2; g.position.copy(B((x0 + x1) / 2, y, z)); g.castShadow = true; return g; };
  const ycyl = (m, y0, y1, r, x = 0, z = 0, n = 24) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(r * 1e-3, r * 1e-3, (y1 - y0) * 1e-3, n), m); g.rotation.x = Math.PI / 2; g.position.copy(B(x, (y0 + y1) / 2, z)); g.castShadow = true; return g; };
  const zcyl = (m, z0, z1, r, x = 0, y = 0, n = 16) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(r * 1e-3, r * 1e-3, (z1 - z0) * 1e-3, n), m); g.position.copy(B(x, y, (z0 + z1) / 2)); g.castShadow = true; return g; };

  // 姿态归零后把 obj（按世界坐标搭好）挂到 parent 下
  function attachAtZero(obj, parent) {
    const saved = { ...S.pose }; for (const k of Object.keys(S.pose)) S.pose[k] = 0; S.applyPose();
    parent.updateWorldMatrix(true, false);
    obj.applyMatrix4(new THREE.Matrix4().copy(parent.matrixWorld).invert()); parent.add(obj);
    Object.assign(S.pose, saved);
  }

  // ------------------------------------------------------------ 四方刀架（四把刀）
  // 刀架中心在 Blender (CX, -37, 166)；转 0° 时朝 +Y（指向工件）的那把是工作刀，刀尖在 (CX, -10, AX)
  let turret = null, tailTools = null, workMesh = null, piece = null, extra = [], tipMark = null, tipObj = null;
  const TOOLS = ['turn', 'thread', 'part', 'knurl'];
  function buildTurret() {
    // B() 是线性的，所以直接传“相对刀架中心”的 mm 坐标即可
    const c = { x: CX, y: -37, z: 166 }, zt = AX - c.z;   // 刀尖高度（相对刀架中心）
    const holder = new THREE.Group();
    holder.add(bbox(M3.dark, -15, 15, -15, 15, -14, 14));
    for (const [dx, dy] of [[-8, -6], [8, -6], [-8, 6], [8, 6]]) holder.add(zcyl(M3.steel, 14, 22, 3.2, dx, dy));
    holder.add(zcyl(M3.steel, 14, 28, 4, 0, 0));
    // 第 k 把刀先按“朝 +Y”搭好，再绕竖轴转 k×90°；刀架转 -k×90° 时它就朝向工件
    const tool = (k, build) => { const t = new THREE.Group(); build(t); t.rotation.y = k * Math.PI / 2; holder.add(t); };
    tool(0, (t) => { t.add(bbox(M3.black, -4, 4, 6, 24, zt - 6, zt + 2), bbox(M3.tin, -4, 4, 23.5, 27, zt - 6, zt)); });
    tool(1, (t) => {
      t.add(bbox(M3.black, -4, 4, 6, 23.5, zt - 6, zt + 2));
      const sh = new THREE.Shape([new THREE.Vector2(-2.2, 23.5), new THREE.Vector2(2.2, 23.5), new THREE.Vector2(0, 27)]);
      const ge = new THREE.ExtrudeGeometry(sh, { depth: 3, bevelEnabled: false });   // 形状在 Blender XY 平面，沿 Z 拉伸
      ge.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, zt - 3, 0, -1, 0, 0, 0, 0, 0, 1)); ge.scale(1e-3, 1e-3, 1e-3);
      const m = new THREE.Mesh(ge, M3.hss); m.castShadow = true; t.add(m);
    });
    tool(2, (t) => { t.add(bbox(M3.black, -5, 5, 0, 12, zt - 12, zt + 1), bbox(M3.hss, -0.75, 0.75, 10, 27, zt - 10, zt)); });
    tool(3, (t) => {
      t.add(bbox(M3.black, -5, 5, 4, 16, zt - 9, zt - 1), bbox(M3.black, -4.5, -3.2, 14, 22, zt - 8, zt + 1), bbox(M3.black, 3.2, 4.5, 14, 22, zt - 8, zt + 1));
      t.add(xcyl(M3.steel, -3, 3, 6, 6, 21, zt, 28));
      for (let i = 0; i < 16; i++) { const a = i * TAU / 16, r = bbox(M3.dark, -3.05, 3.05, 21 + 6 * Math.sin(a) - 0.3, 21 + 6 * Math.sin(a) + 0.3, zt + 6 * Math.cos(a) - 0.3, zt + 6 * Math.cos(a) + 0.3); t.add(r); }
    });
    holder.position.copy(B(c.x, c.y, c.z));
    attachAtZero(holder, S.N.G_Cross);
    tipMark = new THREE.Object3D(); tipMark.position.copy(B(CX, -10, AX)); attachAtZero(tipMark, S.N.G_Cross);
    return holder;
  }
  // ------------------------------------------------------------ 尾座钻夹头 + 三种刀
  function buildTail() {
    const g = new THREE.Group(), N = J.CHUCK_NOSE;
    g.add(xcyl(M3.dark, N + 6, N + 28, 11, 11, 0, AX, 32), xcyl(M3.dark, N, N + 6, 7, 11, 0, AX, 32), xcyl(M3.steel, N + 28, N + 42, 5.5, 5.5, 0, AX));
    const bits = {
      center: [xcyl(M3.hss, N - 18, N - 15, 0.2, 1.25, 0, AX), xcyl(M3.hss, N - 15, N - 11.7, 1.25, 1.25, 0, AX), xcyl(M3.hss, N - 11.7, N - 9, 1.25, 3.15, 0, AX), xcyl(M3.hss, N - 9, N, 3.15, 3.15, 0, AX)],
      drill: [xcyl(M3.tin, N - 40, N - 38.5, 0.1, 2.5, 0, AX, 18), xcyl(M3.tin, N - 38.5, N, 2.5, 2.5, 0, AX, 18)],
      tap: [xcyl(M3.hss, N - 36, N - 33, 2.4, 3, 0, AX, 4), xcyl(M3.hss, N - 33, N - 18, 3, 3, 0, AX, 4), xcyl(M3.hss, N - 18, N, 2.4, 2.4, 0, AX, 12)],
    };
    for (const [k, arr] of Object.entries(bits)) { const s = new THREE.Group(); arr.forEach((o) => s.add(o)); s.name = k; g.add(s); }
    // 钻头 / 丝锥上的槽：几圈深色细环
    const dg = g.children.find((o) => o.name === 'drill'), tg = g.children.find((o) => o.name === 'tap');
    for (let i = 0; i < 6; i++) dg.add(xcyl(M3.dark, N - 34 + i * 5.5, N - 32.5 + i * 5.5, 2.56, 2.56, 0, AX, 18));
    for (let i = 0; i < 14; i++) tg.add(xcyl(M3.dark, N - 33 + i, N - 32.6 + i, 3.02, 3.02, 0, AX, 4));
    attachAtZero(g, S.N.G_TailQuill);
    return g;
  }

  // ------------------------------------------------------------ 状态
  let job = null, c = null, si = 0, u = 0, playing = true, speed = 2, hold = 0, spinOff = 0, spinDisp = 0, blend = null, lastVer = -1, lastModel = null;
  let pieceAnim = null, showT = 0, boltForShow = null;
  const ui = {};

  function setJob(k) {
    job = J.jobs[k]; jumpTo(0);
    renderJobCard(); renderSteps();
    ui.jobBtns.forEach((b, i) => b.classList.toggle('on', i === k));
  }
  function jumpTo(k) {
    si = Math.max(0, Math.min(job.steps.length - 1, k)); u = 0; hold = 0;
    c = startJob(job, si);
    clearPiece();
    if (c.piece) { piece = makePieceMesh(c.piece); placeOnTray(piece); }
    spinOff = Math.ceil(spinDisp / TAU) * TAU; blend = { from: spinDisp, t: 0 }; lastVer = -1;   // 按角度走的步骤都从整圈开始，螺纹槽才对得上刀尖
    workMesh.material = MAT[job.mat];
    // 螺母那一步用 Φ8 立铣刀：把铣刀刃部放粗
    const fl = S.N.EndMill_Flute; if (fl) { const r = job.id === 'nut' ? 4 / 3 : 1; fl.scale.set(r, 1, r); }
    renderSteps(); renderDetail();
  }
  function clearPiece() {
    for (const o of [piece, ...extra]) if (o) { o.parent && o.parent.remove(o); o.geometry && o.geometry.dispose(); }
    piece = null; extra = []; pieceAnim = null; showT = 0; boltForShow = null;
  }
  function makePieceMesh(pm) {
    const m = new THREE.Mesh(buildGeometry(THREE, pm, pm.x0, pm.x1, pm.knurls.length ? 150 : 96), MAT[job.mat]);
    m.castShadow = true; m.userData.model = pm; S.scene.add(m);
    return m;
  }
  const TRAY = () => B(0, -60, 34);      // 掉到托盘上
  function placeOnTray(m) { m.position.copy(TRAY()); m.rotation.set(0.6, 0, 0); }
  const SHOW = B(-60, -205, 135);        // 成品展示位置（机床前方）

  // ------------------------------------------------------------ 每帧
  function tick(dt) {
    const step = job.steps[si];
    if (playing) {
      if (u < 1) u = Math.min(1, u + dt * speed / step.dur);
      else if (!step.show) { hold += dt; if (hold > 0.6) { if (si < job.steps.length - 1) { advance(); } } }
    }
    const prevPiece = c.piece;
    const pose = job.steps[si].play(c, u);
    if (!prevPiece && c.piece) { piece = makePieceMesh(c.piece); pieceAnim = { t: 0, rot: spinDisp }; }
    applyPose(pose, dt);
    // 工件网格
    if (c.m !== lastModel || c.m.ver !== lastVer) {
      lastModel = c.m; lastVer = c.m.ver;
      workMesh.geometry.dispose();
      workMesh.geometry = buildGeometry(THREE, c.m, c.m.x0, c.m.x1, c.m.knurls.length ? 150 : 96);
    }
    // 切下来的零件：先掉到托盘，最后一步飞到展示位置
    if (piece && pieceAnim) {
      pieceAnim.t += dt * speed;
      const t = Math.min(1, pieceAnim.t / 0.8);
      const p0 = B(0, 0, AX), p1 = TRAY();
      piece.position.lerpVectors(p0, p1, t * t); piece.rotation.set(pieceAnim.rot + t * 0.6, 0, 0);
      if (t >= 1) pieceAnim = null;
    }
    if (step.show && piece) showcase(dt);
    ui.prog && (ui.prog.style.width = Math.round(u * 100) + '%');
  }
  function advance() {
    const s = job.steps[si], pose = s.play(c, 1);
    if (s.tool && !s.show && !s.tailTool) c.tool = s.tool;
    si++; u = 0; hold = 0; blend = { from: spinDisp, t: 0 };
    renderSteps(); renderDetail();
  }
  function applyPose(p, dt) {
    const P = S.pose;
    P.car = p.x - CX; P.cross = 10 - p.r; P.hwCross = P.cross * TAU; P.ls = (p.x - 110) / K.ASSUME.lead * TAU;
    // 主轴：给了角度就按角度（车螺纹 / 分度 / 攻丝），否则按转速积分
    if (p.spin !== undefined) {
      const target = p.spin + spinOff;
      if (blend) { blend.t += dt * 2.5; const e = Math.min(1, blend.t); spinDisp = blend.from + (target - blend.from) * e; if (e >= 1) blend = null; }
      else spinDisp = target;
    } else {
      spinDisp += dt * TAU * Math.min((p.rpm || 0) / 60, 2.2) * (playing ? 1 : 0);
      spinOff = Math.ceil(spinDisp / TAU) * TAU;      // 下一段按角度走时从整圈开始
    }
    P.spin = spinDisp; P.mpul = spinDisp * 2.6;
    const m = p.mill || { yaw: 0, headZ: 0, quill: 0, spin: false };
    P.yaw = m.yaw; P.headZ = m.headZ; P.quill = m.quill; if (m.spin && playing) P.mill += dt * TAU * 5;
    const t = p.tail || { tool: null, tail: 0, tq: 0 };
    P.tail = t.tail; P.tq = t.tq;
    for (const ch of tailTools.children) if (TOOL_NAME[ch.name]) ch.visible = ch.name === t.tool;
    // 刀架转到这一步要用的刀
    const want = -TOOLS.indexOf(p.tool) * Math.PI / 2;
    let d = want - turret.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
    turret.rotation.y += d * Math.min(1, dt * 6);
    ui.tagText = t.tool ? TOOL_NAME[t.tool] : (p.mill && p.mill.spin ? (job.id === 'nut' ? 'Φ8 立铣刀' : 'Φ6 立铣刀') : TOOL_NAME[p.tool]);
  }
  function showcase(dt) {
    showT += dt;
    const pm = piece.userData.model;
    if (!piece.userData.show) {
      const sh = piece.userData.show = { from: piece.position.clone(), fromRot: piece.rotation.x };
      if (job.id === 'nut') {
        // 拿例子 1 的螺栓来，螺母从杆端拧进去
        const bc = startJob(J.jobs[0], J.jobs[0].steps.length), bm = bc.piece;
        boltForShow = new THREE.Mesh(buildGeometry(THREE, bm, bm.x0, bm.x1, 96), MAT.brass);
        boltForShow.castShadow = true; S.scene.add(boltForShow); extra.push(boltForShow);
        sh.base = SHOW.clone().add(B(-(bm.x0 + bm.x1) / 2, 0, 0));
        boltForShow.position.copy(sh.base);
        sh.startX = bm.x1 + 1.5 - pm.x0; sh.endX = J.bolt.HEAD_R + 0.15 - pm.x0;
        sh.to = sh.base.clone().add(B(sh.startX, 0, 0));
      } else sh.to = SHOW.clone().add(B(-(pm.x0 + pm.x1) / 2, 0, 0));
    }
    const sh = piece.userData.show, e = Math.min(1, showT / 1.2), s = e * e * (3 - 2 * e);
    piece.position.lerpVectors(sh.from, sh.to, s);
    if (job.id !== 'nut') { piece.rotation.set(sh.fromRot * (1 - s) + showT * 0.8, 0, 0); return; }
    piece.rotation.set(sh.fromRot * (1 - s), 0, 0);
    if (e < 1) return;
    // 每转一圈前进 1 mm（右旋：从杆端看顺时针拧进去），靠到螺栓头为止
    const tr = Math.min(1, Math.max(0, (showT - 1.4) / 7)), dx = sh.startX + (sh.endX - sh.startX) * tr;
    piece.position.copy(sh.base).add(B(dx, 0, 0));
    piece.rotation.set((sh.startX - dx) / 1.0 * TAU, 0, 0);
  }

  // ------------------------------------------------------------ 讲义
  const DETAIL = {
    bolt: [
      '先把棒料端面车平，同时定出总长。端面车刀从外圈走到中心；黄铜 Φ12 用 1200 转/分（线速度约 45 m/分）。',
      '六角头对边 10，对角 = 10 ÷ cos30° ≈ 11.55，所以先把头部车到 Φ11.5：铣完六面后，六个角正好留一点点圆弧，不扎手。',
      '粗车三刀（每刀半径吃 0.8 ~ 0.9 mm），最后精车一刀到 Φ6，并顺着台阶往外刮一刀，台阶面就平了。电子挂轮这时当自动进给用：设 0.06 mm/转，丝杠自己走。',
      '螺纹起头倒 45° 角：第一扣牙不会是个尖片，拧螺母也好对。',
      'THREAD',
      '钻铣头绕立柱转约 8°，让铣刀中心正好在主轴中心线正上方，再整体降 60 mm；大拖板退到右边让开，刀架顺手转到切断刀。',
      '主轴不开电机，当“分度头”用：铣完一面，用手把卡盘转 60°，一共六次（可以在卡盘外圆贴一圈 6 等分刻度纸）。立铣刀下到离中心 5 mm（对边 10 的一半），钻铣头绕立柱左右摆一点点，刀底面扫过整个面。',
      '钻铣头复位，主轴 600 转/分，切断刀慢慢往里进；切透的一瞬间螺栓掉进托盘。切断刀要对准中心高、伸出短，转速比车外圆低。',
      'SHOW',
    ],
    nut: [
      '端面车平，并把端面定在钻铣头够得到的位置（铣刀只能在 X≈95 处对准主轴中心线）。',
      '外圆车到 Φ11.5，理由同螺栓头：对边 10 的六角，对角 11.55。',
      '直接拿钻头钻端面会“跑偏”。先用中心钻钻一个带 60° 锥口的小坑给钻头定心。尾座装钻夹头，推到离端面 2 mm 锁住，再摇尾座手轮让套筒伸出去。',
      'M6 的底孔 = 6 − 螺距 1 = Φ5。钻 9 mm 深（螺母 5 + 切断刀宽 1.5 + 余量），每进 3 mm 退一下排屑（啄钻）。尾座套筒行程只有 18 mm，这里够用。',
      'TAP',
      '和螺栓一样，把钻铣头转到主轴中心线正上方。',
      'MILL8',
      '切断：螺母掉下来，中间是通的螺纹孔。',
      'SHOWNUT',
    ],
    tripod: [
      '铝 Φ20，主轴 1000 转/分。端面车平定长度。',
      '头部车到 Φ18，留着下一步滚花。',
      '1/4 英寸 = 6.35 mm。铝软，每刀可以吃深一点（半径 1.4 mm），五刀到尺寸，最后刮平台阶。',
      '杆端倒角，头部外沿也倒一个小角。',
      '换滚花刀：它不切削，是把带斜齿的硬轮子压进表面，把金属“挤”成菱形格子，好用手拧。真实滚花会让直径略微变大，这里简化成只压出纹路。主轴低速 100 转/分，压力要大，一次走到位。',
      'INCH',
      '切断，螺丝掉下来。',
      'SHOW',
    ],
  };
  const settingOf = (s) => {
    const parts = [];
    if (s.tool) parts.push('刀具：' + (s.tailTool ? TOOL_NAME[s.tailTool] + '（装在尾座）' : s.mill ? (job.id === 'nut' && s.name.includes('六角') ? 'Φ8 立铣刀' : 'Φ6 立铣刀') + '（钻铣头）' : TOOL_NAME[s.tool]));
    if (s.rpm) parts.push('主轴 ' + s.rpm + ' 转/分');
    if (s.mill && !s.name.includes('转到')) parts.push('铣主轴 2000 转/分左右');
    return parts.join('　·　');
  };
  function threadInfo(P, rpm, label) {
    const r = K.elsRatio(+P.toFixed(3)), ld = K.loads(rpm, P);
    return `换螺纹车刀（四方刀架转 90°）。数显屏设：<b>螺距 ${P.toFixed(P < 1.2 ? 2 : 3)} mm</b>${label ? '（' + label + '）' : ''}、右旋、终点在台阶前 1.5 mm。主轴 ${rpm} 转/分。分 6 刀加深到牙高 ${K.threadDepth(P).toFixed(2)} mm；每刀起步前都等编码器的零点脉冲，所以六刀落在同一条槽里（第 5 章）。
      <div class="readout" style="margin-top:6px"><span>电子挂轮比 N/D</span><span>${r.num}/${r.den}</span><span>主轴 1 圈给步进</span><span>${r.stepsPerRev.toFixed(1)} 步</span><span>步进电机转速</span><span class="${ld.ok ? 'good' : 'warn'}">${ld.motorRpm.toFixed(0)} 转/分</span><span>刀每秒走</span><span>${ld.feedMMs.toFixed(2)} mm</span></div>`;
  }
  function renderDetail() {
    const s = job.steps[si];
    let txt = DETAIL[job.id][si] || '';
    if (txt === 'THREAD') txt = threadInfo(1.0, 150);
    if (txt === 'INCH') txt = '英制螺纹按“每英寸几牙”标：20 牙/英寸 → 螺距 25.4 ÷ 20 = 1.27 mm。老式车床要换一套英制挂轮（常用 127 齿那只，因为 25.4 = 127 ÷ 5）；电子挂轮直接输入 1.27。' + threadInfo(K.tpi2mm(20), 120, '20 牙/英寸');
    if (txt === 'TAP') txt = '丝锥装在尾座钻夹头里，<b>尾座套筒不锁</b>、能自由滑。主轴开到最低 <b>50 转/分</b>，丝锥的螺纹会按螺距把自己往孔里“拽”，套筒跟着走；攻到底后主轴反转退出来。老款 CT125 最低 560 转/分，攻丝只能关电机用手转卡盘——E 版能到 50 转/分，就是为这种活准备的。攻丝不用电子挂轮：进给是丝锥自己定的。';
    if (txt === 'MILL8') txt = '和螺栓一样分度铣六面，但这次<b>换 Φ8 立铣刀</b>。原因：钻铣头只能绕立柱摆，刀走的是一条和工件轴线斜着约 18° 的弧线；要用一条直线扫过 5 × 5.77 的整个面，刀的半径至少要 2.5·cos18° + 2.89·sin18° ≈ 3.27 mm，Φ6 刀（半径 3）会在两个角上留下没铣到的小三角。螺栓头只有 4 mm 厚，需要 2.79 mm，Φ6 够用。';
    if (txt === 'SHOW') txt = '零件完成，飞到机床前面转给你看。';
    if (txt === 'SHOWNUT') txt = '把例子 1 的螺栓拿过来，螺母每转一圈前进 1 mm，一直拧到螺栓头。';
    ui.detail.innerHTML = `<h3>第 ${si + 1} 步 · ${s.name}</h3><div class="mut">${settingOf(s)}</div><div>${txt}</div><div style="height:4px;background:#091426;border-radius:2px;overflow:hidden"><div style="height:100%;width:0;background:var(--accent)" id="mkprog"></div></div>`;
    ui.prog = ui.detail.querySelector('#mkprog');
    ui.view = s.show ? (job.id === 'nut' ? 'shownut' : 'show') : s.mill ? 'make_mill' : s.tailTool ? 'make_tail' : 'make';
    S.setView(ui.view);
  }
  function renderSteps() {
    ui.steps.innerHTML = '';
    job.steps.forEach((s, i) => {
      const b = el('button', { class: 'mkstep' + (i === si ? ' on' : i < si ? ' done' : '') }, `<b>${i + 1}</b>${s.name}`);
      b.onclick = () => { jumpTo(i); playing = true; ui.play.textContent = '⏸ 暂停'; };
      ui.steps.append(b);
    });
  }
  // 零件图：轴向剖面（上边 θ=0、下边 θ=π），虚线是内孔
  function renderJobCard() {
    const full = startJob(job, job.steps.length).piece;
    const x0 = full.x0, x1 = full.x1, len = x1 - x0, Rm = Math.max(...Array.from({ length: 60 }, (_, i) => full.rOut(x0 + len * i / 59, 0.3)));
    const W = 420, H = 150, k = Math.min((W - 60) / len, (H - 40) / (2 * Rm + 2)), ox = 30, oy = H / 2 - 6;
    const pts = (th, sign, f) => { const a = []; for (let x = x0; x <= x1 + 1e-6; x += 0.05) a.push(`${(ox + (x - x0) * k).toFixed(1)},${(oy - sign * f(x, th) * k).toFixed(1)}`); return a.join(' '); };
    const top = pts(0, 1, (x, t) => full.rOut(x, t)), bot = pts(Math.PI, -1, (x, t) => full.rOut(x, t));
    const hasBore = full.rIn((x0 + x1) / 2, 0) > 0;
    const itop = hasBore ? pts(0, 1, (x, t) => full.rIn(x, t)) : '', ibot = hasBore ? pts(Math.PI, -1, (x, t) => full.rIn(x, t)) : '';
    ui.card.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%">
      <polyline points="${top}" fill="none" stroke="#e8eef7" stroke-width="1.6"/><polyline points="${bot}" fill="none" stroke="#e8eef7" stroke-width="1.6"/>
      ${hasBore ? `<polyline points="${itop}" fill="none" stroke="#ffb547" stroke-width="1.2" stroke-dasharray="3 2"/><polyline points="${ibot}" fill="none" stroke="#ffb547" stroke-width="1.2" stroke-dasharray="3 2"/>` : ''}
      <line x1="${ox - 8}" y1="${oy}" x2="${ox + len * k + 8}" y2="${oy}" stroke="#4cc3ff" stroke-width="0.8" stroke-dasharray="8 3 2 3"/>
      <line x1="${ox}" y1="${H - 14}" x2="${ox + len * k}" y2="${H - 14}" stroke="#93a4bb"/><text x="${ox + len * k / 2}" y="${H - 2}" fill="#93a4bb" font-size="12" text-anchor="middle">${len.toFixed(1)} mm</text>
    </svg><div class="mut">轴向剖面（这条中心线所在的平面切开看）：上下两条边的螺纹齿错开半个螺距，正是螺旋线的样子${hasBore ? '；橙色虚线是内孔和内螺纹' : ''}。</div>
    <div class="readout" style="grid-template-columns:auto 1fr"><span>材料</span><span>${job.stockText}</span><span>成品</span><span>${job.final}</span></div>`;
  }

  return {
    // 自检脚本用：跳到第 k 步的 uu 处并暂停
    dbg: { setJob: (k) => setJob(k), at: (k, uu, play = false) => { jumpTo(k); u = uu; playing = play; ui.play.textContent = play ? '⏸ 暂停' : '▶ 继续'; S.setView(ui.view, true); }, get: () => ({ job: job.id, si, u, piece: !!piece }) },
    title: '动手做：三个小零件',
    enter() {
      S.setView('make');
      S.setHidden(['ToolPost', 'Tool_', 'Tail_Center']); S.work.visible = false;
      if (!turret) { turret = buildTurret(); tailTools = buildTail(); workMesh = new THREE.Mesh(new THREE.BufferGeometry(), MAT.brass); workMesh.castShadow = true; workMesh.receiveShadow = true; S.workHolder.add(workMesh); }
      turret.visible = tailTools.visible = workMesh.visible = true;
      // 从前上方往下看：视线从四方刀架上面越过去，才看得见刀尖和工件
      S.VIEWS.make = { pos: B(116, -50, 305), tgt: B(100, -4, 160) };
      S.VIEWS.make_mill = { pos: B(150, -118, 268), tgt: B(96, 0, 172) };
      S.VIEWS.make_tail = { pos: B(124, -60, 300), tgt: B(108, -2, 160) };
      S.VIEWS.show = { pos: B(-20, -300, 185), tgt: B(-60, -205, 135) };
      S.VIEWS.shownut = { pos: B(-25, -290, 180), tgt: B(-60, -205, 135) };
      side.append(el('p', { class: 'lead' }, '前面几章是原理，这一章把它们串起来做真东西：从一根棒料开始，一步一步车出成品。三个例子各用到机床的不同本事——<b>螺栓</b>用电子挂轮车螺纹、用钻铣头铣六角；<b>螺母</b>用尾座钻孔、50 转/分低速攻丝；<b>相机螺丝</b>用滚花和英制螺纹。'));
      const jb = el('div', { class: 'btns' });
      ui.jobBtns = J.jobs.map((j, i) => { const b = el('button', { class: 'btn' }, ['①', '②', '③'][i] + ' ' + j.name); b.onclick = () => setJob(i); jb.append(b); return b; });
      side.append(jb);
      ui.card = el('div', { class: 'box' });
      const ctl = box(); ctl.style.gap = '6px';
      ui.play = el('button', { class: 'btn on' }, '⏸ 暂停');
      ui.play.onclick = () => { playing = !playing; ui.play.textContent = playing ? '⏸ 暂停' : '▶ 继续'; };
      const prev = el('button', { class: 'btn' }, '◀ 上一步'); prev.onclick = () => jumpTo(si - 1);
      const next = el('button', { class: 'btn' }, '下一步 ▶'); next.onclick = () => jumpTo(si + 1);
      const restart = el('button', { class: 'btn' }, '⟲ 从头'); restart.onclick = () => { jumpTo(0); playing = true; ui.play.textContent = '⏸ 暂停'; };
      const sp = el('button', { class: 'btn' }, '速度 ×2'); sp.onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; sp.textContent = '速度 ×' + speed; };
      const row = el('div', { class: 'btns' }); row.append(ui.play, prev, next, restart, sp);
      ui.detail = el('div', { class: 'box', style: 'border-color:var(--accent)' });
      side.append(row);
      ui.steps = el('div', { class: 'mksteps' });
      ctl.append(el('h3', {}, '全部步骤（点一下跳过去）'), ui.steps); side.append(ui.detail, ctl, ui.card);   // 当前步骤说明放最上面，手机上不用往下翻
      const st = el('style', {}, `.mksteps{display:flex;flex-direction:column;gap:3px}.mkstep{text-align:left;font-size:13px;padding:5px 8px;border:1px solid var(--line);border-radius:4px;background:transparent;cursor:pointer;color:var(--muted)}
        .mkstep b{font-family:var(--f-mono);color:var(--accent);margin-right:6px;font-weight:500}.mkstep.done{color:#8fb59c}.mkstep.on{color:var(--fg);border-color:var(--accent);background:#0f2a45}`);
      side.append(st);
      side.append(basis(`${EV.k} 工艺顺序（端面 → 外圆 → 倒角 → 螺纹 → 切断）、M6 底孔 Φ5、60° 牙高 0.613P、六角对角 = 对边 ÷ cos30°、127 齿换算英制是通用做法。${EV.s} 主轴 50 ~ 2250 转/分、尾座行程 18、钻铣头升降 60、套筒 40、绕立柱 360°、最大钻 6。${EV.g} 用卡盘当分度头、Φ8 立铣刀能不能装（要看夹头规格）、各步具体转速和进给，是按同类小机床的经验取的；画面里走刀加快了。`));
      if (!tipObj) { tipObj = new THREE.Object3D(); S.scene.add(tipObj); }
      S.N.__tip = tipObj;
      setTags([{ name: '__tip', text: '刀具' }]);
      hud(['画面加快：走刀约 ×3，可再调速度']);
      setJob(0);
    },
    tick(dt) {
      tick(dt);
      // 标签跟着正在干活的刀
      const t = ctx.tags()[0];
      if (t) {
        const p = new THREE.Vector3(), tt = tailTools.children.find((o) => o.visible && TOOL_NAME[o.name]);
        if (tt) { const Lb = { center: 18, drill: 40, tap: 36 }[tt.name]; p.copy(B(J.CHUCK_NOSE - Lb + S.pose.tail - S.pose.tq, 0, AX)); }
        else if (S.pose.quill > 0.5 || job.steps[si].mill) S.N.EndMill_Flute.getWorldPosition(p);
        else tipMark.getWorldPosition(p);
        tipObj.position.copy(p);
        t.el.textContent = ui.tagText || '刀具';
      }
    },
    exit() {
      if (turret) turret.visible = tailTools.visible = workMesh.visible = false;
      clearPiece();
      const fl = S.N.EndMill_Flute; if (fl) fl.scale.set(1, 1, 1);
    },
  };
}
