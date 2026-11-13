// 三个例子的工艺步骤。纯逻辑：只改工件模型、返回刀具位置，不碰 three / DOM，所以 node 里也能跑自检。
// 每一步 play(c, u)：u∈[0,1]，从头算到 u 为止的全部切削（切削都是取最小 / 最大，重复算不出错），
// 返回这一刻的姿态 {tool, x, r, rpm, spin?, mill?, tail?}。跳步 = 前面每一步 play(c, 1)。
import { WorkModel } from './work.js';
import * as K from './core.js';

const TAU = Math.PI * 2;

export function makeJobs(L) {
  const HY0 = L.head_yaw_deg * Math.PI / 180;
  const spPos = (yaw) => { const a = HY0 + yaw; return [L.column[0] + L.head_r * Math.cos(a), L.column[1] + L.head_r * Math.sin(a)]; };
  const YAW_HEX = Math.asin(-L.column[1] / L.head_r) - HY0;   // 铣刀转到主轴中心线正上方
  const XM = spPos(YAW_HEX)[0];                                  // 这时铣刀的 X（≈95.3）
  const HEADZ = -60;                                             // 钻铣头降到底
  const quillFor = (z) => L.head_z0 + HEADZ - 84 - z;            // 刀刃底到 z 需要的套筒伸出量
  const PARK = { x: 125, r: 15 };
  const CHUCK_NOSE = 164;                                        // 尾座钻夹头前端（尾座、套筒都在原位时）
  const MILL0 = { yaw: 0, headZ: 0, quill: 0, spin: false };

  // ------------------------------------------------------------ 走刀路径
  // pts: [x, r, mode]，mode 是走到这一点的方式：r 快移 / t 车削 / f 端面 / p 切断
  function path(pts, { tool = 'turn', rpm = 1200, feed = 3.5, w = 0.15, partW = 1.5 } = {}) {
    const segs = []; let T = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, r0] = pts[i - 1], [x1, r1, mode = 'r'] = pts[i];
      const len = Math.hypot(x1 - x0, r1 - r0);
      const v = mode === 'r' ? 30 : mode === 'p' ? 0.9 : mode === 'f' ? 2.2 : feed;
      const d = Math.max(0.08, len / v);
      segs.push({ x0, r0, x1, r1, mode, t0: T, d }); T += d;
    }
    return {
      dur: T, tool, rpm,
      play(c, u) {
        const t = u * T; let x = pts[0][0], r = pts[0][1];
        for (const s of segs) {
          if (t <= s.t0) break;
          const k = Math.min(1, (t - s.t0) / s.d);
          x = s.x0 + (s.x1 - s.x0) * k; r = s.r0 + (s.r1 - s.r0) * k;
          if (s.mode === 't') c.m.cutLine(s.x0, s.r0, x, r, w);
          else if (s.mode === 'f') { faceCut(c.m, x, r); }
          else if (s.mode === 'p') c.part(x, r, partW);
        }
        return { tool, x, r, rpm };
      },
    };
  }
  function faceCut(m, x, r) {
    for (let k = m.i(x); k < m.n; k++) if (m.prof[k] > r) { m.prof[k] = Math.max(0, r); m.ver++; }
    if (r <= 0.01) m.setEnd(x);
  }

  // ------------------------------------------------------------ 车螺纹（电子挂轮）
  function threadStep({ xs, xe, P, depths, rpm, Rmaj }) {
    const travelRevs = (xs - xe) / P;
    const vis = Math.min(rpm, 150) / 60;                        // 画面里主轴每秒转几圈
    const tTravel = travelRevs / vis, tEng = 0.35, tRet = 0.3, tBack = 0.7;
    const tPass = tEng + tTravel + tRet + tBack, n = depths.length;
    return {
      dur: tPass * n, tool: 'thread', rpm, P,
      play(c, u) {
        let t = c.m.threads.find((q) => q.tag === 'ext');
        if (!t) { t = { tag: 'ext', a: xe, b: xs, P, hand: 1, Rmaj, xref: xs - P / 4, depth: 0, cur: { d: 0, from: 1e9 } }; c.m.threads.push(t); }
        const T = u * tPass * n, k = Math.min(n - 1, Math.floor(T / tPass)), tt = T - k * tPass;
        const prev = k > 0 ? depths[k - 1] : 0, d = depths[k];
        if (t.depth !== prev || t.cur.d !== d) c.m.ver++;
        t.depth = prev; t.cur.d = d;
        const base = k * (Math.ceil(travelRevs) + 1) * TAU;       // 每刀起步都在整圈上（等零点脉冲）
        let x, r, spin;
        if (tt < tEng) { x = xs; r = Rmaj + 1 - (1 + d) * (tt / tEng); spin = base; t.cur.from = 1e9; }
        else if (tt < tEng + tTravel) {
          const q = (tt - tEng) / tTravel; x = xs - (xs - xe) * q; r = Rmaj - d; spin = base + q * travelRevs * TAU;
          if (Math.abs(t.cur.from - x) > 1e-6) { t.cur.from = x; c.m.ver++; }
        } else {
          t.cur.from = xe;
          const q = Math.min(1, (tt - tEng - tTravel) / (tRet + tBack));
          const q1 = Math.min(1, (tt - tEng - tTravel) / tRet), q2 = Math.max(0, (tt - tEng - tTravel - tRet) / tBack);
          r = Rmaj - d + (1 + d) * q1; x = xe + (xs - xe) * q2;
          spin = base + travelRevs * TAU + (Math.ceil(travelRevs) + 1 - travelRevs) * TAU * q;
        }
        if (u >= 1) { t.depth = depths[n - 1]; t.cur = { d: 0, from: 1e9 }; c.m.ver++; }
        return { tool: 'thread', x, r, rpm, spin };
      },
    };
  }

  // ------------------------------------------------------------ 钻铣头转过来 / 铣六角 / 复位
  function millPrep() {
    return {
      dur: 3.2, tool: 'part', rpm: 0, mill: true,
      play(c, u) {
        const e = Math.min(1, u / 0.85), s = e * e * (3 - 2 * e);
        const x = PARK.x + (170 - PARK.x) * Math.min(1, u / 0.3), r = PARK.r + (16 - PARK.r) * Math.min(1, u / 0.3);
        return { tool: 'part', x, r, rpm: 0, spin: c.spin0 || 0, mill: { yaw: YAW_HEX * s, headZ: HEADZ * s, quill: 0, spin: false } };
      },
    };
  }
  function hexStep({ apo = 5, faces = 6, toolR = 3 }) {
    const tIdx = 0.7, tDown = 0.6, tSweep = 1.5, tUp = 0.5, tF = tIdx + tDown + tSweep + tUp;
    const dYaw = 2.4 / L.head_r;                               // 左右各摆 2.4 mm（弧长）
    const qCut = quillFor(L.axis_z + apo), qUp = qCut - 4;
    return {
      dur: tF * faces, tool: 'part', rpm: 0, mill: true,
      play(c, u) {
        const T = u * tF * faces, k = Math.min(faces - 1, Math.floor(T / tF)), tt = T - k * tF;
        const phiK = k * TAU / faces;
        for (let j = 0; j < faces; j++) {
          let f = c.m.flats[j];
          if (!f && j <= k) { f = { phi: j * TAU / faces, apo, toolR, segs: [] }; c.m.flats.push(f); }
          if (!f) continue;
          const [ax, ay] = spPos(YAW_HEX - dYaw), [bx, by] = spPos(YAW_HEX + dYaw);
          let segs = [];
          if (j < k || u >= 1) segs = [[ax, ay, bx, by]];
          else if (j === k && tt >= tIdx + tDown) {
            const q = Math.min(1, (tt - tIdx - tDown) / tSweep), [cx, cy] = spPos(YAW_HEX - dYaw + 2 * dYaw * q);
            segs = [[ax, ay, cx, cy]];
          }
          if (JSON.stringify(segs) !== JSON.stringify(f.segs)) { f.segs = segs; c.m.ver++; }
        }
        let spin = phiK, yaw = YAW_HEX - dYaw, quill = qUp;
        if (tt < tIdx) spin = (k - 1 + tt / tIdx) * TAU / faces, quill = qUp;
        else if (tt < tIdx + tDown) quill = qUp + (qCut - qUp) * (tt - tIdx) / tDown;
        else if (tt < tIdx + tDown + tSweep) { quill = qCut; yaw = YAW_HEX - dYaw + 2 * dYaw * (tt - tIdx - tDown) / tSweep; }
        else { quill = qCut + (qUp - qCut) * (tt - tIdx - tDown - tSweep) / tUp; yaw = YAW_HEX + dYaw; }
        if (k === 0 && tt < tIdx) spin = 0;
        return { tool: 'part', x: 170, r: 16, rpm: 0, spin: Math.max(0, spin), mill: { yaw, headZ: HEADZ, quill, spin: true }, toolR };
      },
    };
  }
  // 切断（之前铣过六角的话，先把钻铣头复位）
  function partStep({ xp, R, afterMill = false, rpm = 600 }) {
    const p = path([[PARK.x, PARK.r], [xp, R + 1], [xp, 0, 'p'], [xp, R + 1.5], [PARK.x, PARK.r]], { tool: 'part', rpm });
    const tm = afterMill ? 1.6 : 0, T = p.dur + tm;
    return {
      dur: T, tool: 'part', rpm,
      play(c, u) {
        const t = u * T;
        if (t < tm) {
          const s = 1 - t / tm, e = s * s * (3 - 2 * s);
          return { tool: 'part', x: 170 + (PARK.x - 170) * (t / tm), r: 16 + (PARK.r - 16) * (t / tm), rpm: 0, spin: c.spin0 || 0, mill: { yaw: YAW_HEX * e, headZ: HEADZ * e, quill: 0, spin: false } };
        }
        return p.play(c, (t - tm) / p.dur);
      },
    };
  }

  // ------------------------------------------------------------ 尾座：中心钻 / 钻孔 / 攻丝
  // 刀尖 x = CHUCK_NOSE - Lbit + tail - tq；先把尾座推到离端面 2 mm，再摇套筒
  function tailStep({ tool, Lbit, depth, rOf, pecks = 1, rpm, tap = null }) {
    const tIn = 1.0, tOut = 1.0, tCut = tap ? depth / tap.P / (Math.min(rpm, 60) / 60) : 1.4 * pecks + depth * 0.25;
    const T = tIn + tCut + (tap ? tCut * 0.6 : 0) + tOut;
    // 一次啄钻：进到 d_i，退 2 mm……
    const tipAt = (c, t) => {
      const x1 = c.m.x1, start = x1 + 2, tailPos = start - (CHUCK_NOSE - Lbit);
      let tq = 0, tail = 0;
      if (t < tIn) { tail = tailPos * (t / tIn); }
      else if (t < tIn + tCut) {
        tail = tailPos; const q = (t - tIn) / tCut;
        if (tap) tq = (depth + 2) * q;
        else { const pk = Math.min(pecks - 1, Math.floor(q * pecks)), w = q * pecks - pk, d0 = (depth + 2) * pk / pecks, d1 = (depth + 2) * (pk + 1) / pecks; tq = w < 0.7 ? d0 + (d1 - d0) * (w / 0.7) : d1 - (d1 - Math.max(0, d0 - 1)) * ((w - 0.7) / 0.3) * 0.6; }
      } else if (tap && t < tIn + tCut * 1.6) { tail = tailPos; tq = (depth + 2) * (1 - (t - tIn - tCut) / (tCut * 0.6)); }
      else {
        const q = Math.min(1, Math.max(0, (t - (T - tOut)) / tOut));
        const tqEnd = tap ? 0 : (depth + 2) * (1 - 0.6) + Math.max(0, (depth + 2) * (pecks - 1) / pecks - 1) * 0.6;
        tail = tailPos * (1 - q); tq = tqEnd * (1 - Math.min(1, q * 2));
      }
      return { tail, tq, tip: CHUCK_NOSE - Lbit + tail - tq };
    };
    return {
      dur: T, tool, rpm, tailTool: tool,
      play(c, u) {
        const t = u * T, now = tipAt(c, t);
        // 到目前为止刀尖最深到过哪（取样找最小值）
        let deepest = 1e9;
        for (let s = 0; s <= 60; s++) deepest = Math.min(deepest, tipAt(c, t * s / 60).tip);
        if (tap) {
          let it = c.m.ithreads.find((q) => q.tag === 'tap');
          if (!it) { it = { tag: 'tap', a: c.m.x1 - depth - 1, b: c.m.x1 + 1, P: tap.P, hand: 1, Rt: tap.Rt, xref: 0, to: 1e9 }; c.m.ithreads.push(it); }
          const to = Math.max(it.a, deepest);
          if (to < it.to) { it.to = to; c.m.ver++; }
        } else if (deepest < c.m.x1) c.m.drillTo(deepest, rOf);
        // 攻丝时主轴跟着丝锥转：进 1 个螺距转 1 圈
        const spin = tap ? ((c.m.x1 + 2) - now.tip) / tap.P * TAU : undefined;
        return { tool: c.tool || 'turn', x: 75, r: 16, rpm, spin, tail: { tool, tail: now.tail, tq: now.tq } };
      },
    };
  }

  function showStep() { return { dur: 8, show: true, rpm: 0, play: (c) => ({ tool: c.tool || 'turn', x: PARK.x, r: PARK.r, rpm: 0, spin: c.spin0 || 0 }) }; }

  // ------------------------------------------------------------ 三个零件
  const T60 = Math.tan(59 * Math.PI / 180);
  const drill5 = (d) => (d < 0 ? 0 : Math.min(2.5, d * Math.tan(59 * Math.PI / 180)));
  const center = (d) => (d < 0 ? 0 : d < 2.4 ? Math.min(1.25, d * T60) : Math.min(3.0, 1.25 + (d - 2.4) * Math.tan(Math.PI / 6)));

  const HEAD_L = XM - 2, HEAD_R = XM + 2, BOLT_END = HEAD_R + 12;     // 螺栓头厚 4（M6 标准头高 k=4）
  const bolt = {
    id: 'bolt', name: 'M6×12 六角螺栓', mat: 'brass', stock: { R: 6, x1: 114 }, stockText: '黄铜棒 Φ12，伸出卡盘 100 mm',
    final: '六角头对边 10、厚 4；杆 Φ6 × 12，M6×1 右旋螺纹', len: 16,
    steps: [
      { name: '车端面（定总长）', ...path([[PARK.x, PARK.r], [BOLT_END, 7], [BOLT_END, 0, 'f'], [BOLT_END + 1, 0], [BOLT_END + 1, 8], [PARK.x, PARK.r]], { rpm: 1200 }) },
      { name: '车头部外圆 Φ11.5', ...path([[PARK.x, PARK.r], [BOLT_END + 1, 5.75], [HEAD_L - 2.5, 5.75, 't'], [HEAD_L - 2.5, 7], [PARK.x, PARK.r]], { rpm: 1200 }) },
      { name: '车杆部 Φ6（粗车三刀 + 精车）', ...path([[PARK.x, PARK.r],
        [BOLT_END + 1, 5.0], [HEAD_R, 5.0, 't'], [HEAD_R + 0.5, 5.6], [BOLT_END + 1, 5.6],
        [BOLT_END + 1, 4.1], [HEAD_R, 4.1, 't'], [HEAD_R + 0.5, 4.7], [BOLT_END + 1, 4.7],
        [BOLT_END + 1, 3.3], [HEAD_R, 3.3, 't'], [HEAD_R + 0.5, 3.9], [BOLT_END + 1, 3.9],
        [BOLT_END + 1, 3.0], [HEAD_R, 3.0, 't'], [HEAD_R, 5.75, 't'], [HEAD_R + 1, 7], [PARK.x, PARK.r]], { rpm: 1200 }) },
      { name: '倒角 0.8 × 45°', ...path([[PARK.x, PARK.r], [BOLT_END + 1, 2.0], [BOLT_END, 2.2, 'r'], [BOLT_END - 0.8, 3.0, 't'], [BOLT_END - 1.4, 3.6, 't'], [BOLT_END, 6], [PARK.x, PARK.r]], { rpm: 1200, feed: 1.5 }) },
      { name: '车螺纹 M6×1（电子挂轮）', ...threadStep({ xs: BOLT_END + 2, xe: HEAD_R + 1.5, P: 1.0, depths: [0.15, 0.3, 0.42, 0.52, 0.6, 0.613], rpm: 150, Rmaj: 3.0 }) },
      { name: '把钻铣头转到工件上方', ...millPrep() },
      { name: '铣六角（主轴当分度头）', ...hexStep({ apo: 5, toolR: 3 }) },
      { name: '切断', ...partStep({ xp: HEAD_L - 0.75, R: 6, afterMill: true }) },
      { name: '成品', ...showStep() },
    ],
  };

  const NUT_L = XM - 2.5, NUT_END = XM + 2.5;
  const nut = {
    id: 'nut', name: 'M6 六角螺母', mat: 'brass', stock: { R: 6, x1: 100 }, stockText: '黄铜棒 Φ12，伸出卡盘 86 mm',
    final: '对边 10、厚 5；M6×1 右旋内螺纹（底孔 Φ5）', len: 5,
    steps: [
      { name: '车端面', ...path([[PARK.x, PARK.r], [NUT_END, 7], [NUT_END, 0, 'f'], [NUT_END + 1, 0], [NUT_END + 1, 8], [PARK.x, PARK.r]], { rpm: 1200 }) },
      { name: '车外圆 Φ11.5', ...path([[PARK.x, PARK.r], [NUT_END + 1, 5.75], [NUT_L - 3, 5.75, 't'], [NUT_L - 3, 7], [PARK.x, PARK.r]], { rpm: 1200 }) },
      { name: '打中心孔（尾座）', ...tailStep({ tool: 'center', Lbit: 18, depth: 3.2, rOf: center, pecks: 1, rpm: 1500 }) },
      { name: '钻底孔 Φ5（啄钻）', ...tailStep({ tool: 'drill', Lbit: 40, depth: 9, rOf: drill5, pecks: 3, rpm: 1200 }) },
      { name: '攻丝 M6（主轴 50 转/分）', ...tailStep({ tool: 'tap', Lbit: 36, depth: 7, rOf: null, rpm: 50, tap: { P: 1.0, Rt: 3.0 } }) },
      { name: '把钻铣头转到工件上方', ...millPrep() },
      { name: '铣六角（换 Φ8 立铣刀）', ...hexStep({ apo: 5, toolR: 4 }) },
      { name: '切断', ...partStep({ xp: NUT_L - 0.75, R: 6, afterMill: true }) },
      { name: '成品：拧到螺栓上', ...showStep() },
    ],
  };

  const TR_END = 110, TR_SH = 100, TR_HEAD = 92;
  const tripod = {
    id: 'tripod', name: '1/4″-20 相机螺丝', mat: 'alu', stock: { R: 10, x1: 114 }, stockText: '铝棒 Φ20，伸出卡盘 100 mm',
    final: '滚花头 Φ18 × 8；杆 Φ6.35 × 10，1/4″-20 UNC（螺距 1.27 mm）', len: 18,
    steps: [
      { name: '车端面', ...path([[PARK.x, PARK.r], [TR_END, 11], [TR_END, 0, 'f'], [TR_END + 1, 0], [TR_END + 1, 12], [PARK.x, PARK.r]], { rpm: 1000 }) },
      { name: '车头部外圆 Φ18', ...path([[PARK.x, PARK.r], [TR_END + 1, 9.0], [TR_HEAD - 3, 9.0, 't'], [TR_HEAD - 3, 11], [PARK.x, PARK.r]], { rpm: 1000 }) },
      { name: '车杆部 Φ6.35（五刀）', ...path([[PARK.x, PARK.r],
        ...[7.6, 6.2, 4.8, 3.7].flatMap((r) => [[TR_END + 1, r], [TR_SH, r, 't'], [TR_SH + 0.5, r + 0.6], [TR_END + 1, r + 0.6]]),
        [TR_END + 1, 3.175], [TR_SH, 3.175, 't'], [TR_SH, 9.0, 't'], [TR_SH + 1, 11], [PARK.x, PARK.r]], { rpm: 1200, feed: 4.5 }) },
      { name: '倒角', ...path([[PARK.x, PARK.r], [TR_END + 1, 2.0], [TR_END, 2.4], [TR_END - 0.8, 3.2, 't'], [TR_END - 1.2, 3.6, 't'], [TR_END + 1, 6],
        [TR_SH + 1.5, 10], [TR_SH + 0.6, 9.2], [TR_SH, 8.6, 't'], [TR_SH - 0.6, 9.2, 't'], [TR_SH + 1, 11], [PARK.x, PARK.r]], { rpm: 1000, feed: 1.5 }) },
      { name: '滚花头部', ...knurlStep({ a: TR_HEAD - 1, b: TR_SH - 0.6, R: 9, rpm: 100 }) },
      { name: '车螺纹 1/4″-20（英制，电子挂轮）', ...threadStep({ xs: TR_END + 2, xe: TR_SH + 1.5, P: K.tpi2mm(20), depths: [0.2, 0.38, 0.53, 0.66, 0.74, 0.78], rpm: 120, Rmaj: 3.175 }) },
      { name: '切断', ...partStep({ xp: TR_HEAD - 0.75, R: 10, rpm: 500 }) },
      { name: '成品', ...showStep() },
    ],
  };
  function knurlStep({ a, b, R, rpm, depth = 0.38, n = 30 }) {
    const p = path([[PARK.x, PARK.r], [b + 1, R + 2], [b + 1, R], [a, R, 'k'], [a, R + 3], [PARK.x, PARK.r]], { tool: 'knurl', rpm, feed: 1.6 });
    return {
      dur: p.dur, tool: 'knurl', rpm,
      play(c, u) {
        const pose = p.play(c, u);
        let k = c.m.knurls[0];
        if (!k) { k = { a, b, R, n, lam: 3.2, depth, from: 1e9 }; c.m.knurls.push(k); }
        // 滚花轮从右往左滚过去的地方压出花纹
        const from = u >= 1 ? a : (pose.r <= R + 0.01 && pose.x <= b + 1 ? Math.max(a, pose.x - 3) : k.from);
        if (from < k.from) { k.from = from; c.m.ver++; }
        return pose;
      },
    };
  }

  return { jobs: [bolt, nut, tripod], XM, YAW_HEX, HEADZ, PARK, CHUCK_NOSE, spPos, quillFor, bolt: { HEAD_L, HEAD_R, BOLT_END }, nut: { NUT_L, NUT_END } };
}

/** 新开一份工件，快进到第 upto 步之前（不含） */
export function startJob(job, upto = 0) {
  const c = { m: new WorkModel({ R: job.stock.R, x1: job.stock.x1 }), piece: null, tool: 'turn', spin0: 0 };
  c.part = (x, r, w) => { if (c.piece) return; const p = c.m.partAt(x, r, w); if (p) c.piece = p; };
  for (let i = 0; i < upto; i++) { const s = job.steps[i]; const pose = s.play(c, 1); if (s.tool && !s.show && !s.tailTool) c.tool = s.tool; if (pose && pose.spin !== undefined) c.spin0 = pose.spin % TAU; }
  return c;
}

/** 刀具的中文名 */
export const TOOL_NAME = { turn: '外圆车刀', thread: '60° 螺纹车刀', part: '切断刀', knurl: '滚花刀', center: '中心钻', drill: 'Φ5 麻花钻', tap: 'M6 丝锥' };
