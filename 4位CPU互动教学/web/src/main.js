// 4 位 CPU 互动教学：界面。数据通路用 SVG 画（坐标系 920 × 480），每次状态变化整张重画。
import { CPU, EXAMPLE_PROGRAM, AsmError, alu, assemble, assembleLine, bits, hex, controlSignals,
  disassemble, displayChar, splitFields, MNEMONIC } from './core.js';
import { CHAPTERS } from './chapters.js';
import { OP_CN, PHASE_NAMES, aluOpCn, describeDetail, describePhase, makePrediction, meaning, uses } from './teach.js';

// 颜色
const ACTIVE = '#e8590c';   // 这一步正在用的通路
const USED = '#f4a261';     // 这条指令前几步用过的通路
const LIVE = '#adb5bd';     // 有值但这条指令不用
const IDLE = '#dee2e6';
const INK = '#212529';
const MUTED = '#868e96';
const BOX = '#ffffff';
const FIELD_COLORS = { opcode: '#c92a2a', D: '#1971c2', A: '#2f9e44', B: '#7048e8', '-': '#adb5bd' };
const HEX_FADED = { opcode: '#e8a3a3', D: '#8fb8e0', A: '#97cfa2', B: '#b8a6f3' };
const fieldOfBit = (b) => (b >= 12 ? 'opcode' : b >= 8 && b <= 10 ? 'D' : b >= 4 && b <= 6 ? 'A' : b <= 2 ? 'B' : '-');
const FONTS = {        // tkinter 原版的几种字号，换算成画布单位
  small: 'font-size="11.5"', base: 'font-size="13.5"', bold: 'font-size="13.5" font-weight="700"',
  big: 'font-size="17" font-weight="700"', mono: 'class="m" font-size="12.5"',
  monoBold: 'class="m" font-size="12.5" font-weight="700"', monoBig: 'class="m" font-size="15" font-weight="700"',
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CJK = /[⺀-￯]/;
// 等宽排版：全角字符固定占 2 个半角宽，表格类文字在任何字体下都对得齐
const monoHtml = (s) => [...s].map((ch) => (CJK.test(ch) ? `<span class="w">${esc(ch)}</span>` : esc(ch))).join('');
// 和 Python 版 pad() 一样：按显示宽度补空格
const textWidth = (s) => [...s].reduce((n, ch) => n + (CJK.test(ch) ? 2 : 1), 0);
const pad = (s, w = 14) => s + ' '.repeat(Math.max(1, w - textWidth(s)));

// ─── 状态 ───
const S = {
  cpu: new CPU(), source: EXAMPLE_PROGRAM,
  trace: null,    // 正在执行的那条指令的“电路快照”
  phase: -1,      // -1 = 还没开始这一条；0~4 = 五小步
  timer: null, pendingPred: null, chapter: 0,
};
S.cpu.load(assemble(S.source));

// ─── SVG 小工具 ───
function text(x, y, s, { anchor = 'center', font = 'base', fill = INK } = {}) {
  const ta = anchor === 'w' ? 'start' : anchor === 'e' ? 'end' : 'middle';
  const lines = String(s).split('\n');
  if (lines.length === 1) {
    return `<text x="${x}" y="${y}" text-anchor="${ta}" dominant-baseline="central" fill="${fill}" ${FONTS[font]}>${esc(s)}</text>`;
  }
  const lh = 15, y0 = y - (lines.length - 1) * lh / 2;
  return `<text x="${x}" y="${y0}" text-anchor="${ta}" dominant-baseline="central" fill="${fill}" ${FONTS[font]}>`
    + lines.map((l, i) => `<tspan x="${x}" dy="${i ? lh : 0}">${esc(l)}</tspan>`).join('') + '</text>';
}
const rect = (x0, y0, x1, y1, fill, stroke = 'none', w = 1) =>
  `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${fill}" stroke="${stroke}" stroke-width="${w}"/>`;
const poly = (pts, fill, stroke, w) => `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round"/>`;
const ARROW_ID = { [ACTIVE]: 'aA', [USED]: 'aU', [LIVE]: 'aL', [IDLE]: 'aI' };
const DEFS = '<defs>' + Object.entries(ARROW_ID).map(([c, id]) =>
  `<marker id="${id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,4 L0,8 z" fill="${c}"/></marker>`).join('') + '</defs>';

// ─── 画数据通路 ───
function redraw(keepLabel = false) {
  const t = S.trace, ph = S.phase, cpu = S.cpu;
  const detail = $('cDetail').checked;
  const u = t ? uses(t) : {};
  if (t) u.A2 = !!(t.ctrl.WE && t.ctrl.RSS >= 2);   // MOV：寄存器 A 直接送去写回
  const regs = cpu.regs;
  let o = DEFS;

  // phases：这根线在第几步被用到。返回 [颜色, 粗细]
  const style = (name, phases) => {
    if (!t || ph < 0) return [IDLE, 2];
    const used = name in u ? u[name] : name !== '_';
    const lo = Math.min(...phases);
    if (used && phases.includes(ph)) return [ACTIVE, 4];
    if (used && ph > lo) return [USED, 3];
    if (ph >= lo) return [LIVE, 2];
    return [IDLE, 2];
  };
  const wire = (pts, name, phases, label = null, lpos = null, anchor = 'w', arrow = true) => {
    const [col, w] = style(name, phases);
    o += `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"${arrow ? ` marker-end="url(#${ARROW_ID[col]})"` : ''}/>`;
    if (label !== null && label !== undefined && label !== false && t && ph >= Math.min(...phases)) {
      const [x, y] = lpos || pts.slice(-2);
      o += text(x, y, label, { anchor, font: 'small', fill: col === ACTIVE || col === USED ? INK : MUTED });
    }
  };
  const box = (x0, y0, x1, y1, title, hot = false) => {
    o += rect(x0, y0, x1, y1, BOX, hot ? ACTIVE : '#868e96', hot ? 3 : 1.5);
    o += text((x0 + x1) / 2, y0 + 12, title, { font: 'bold' });
  };

  // PC
  box(20, 12, 110, 62, 'PC（书签）', ph === 0);
  const pcShow = t ? t.pc : cpu.pc;
  o += text(65, 44, `第 ${pcShow} 行`, { font: 'bold', fill: ph === 0 ? ACTIVE : INK });
  wire([65, 62, 65, 88], 'pc', [0], `去找第 ${pcShow} 行`, [70, 76]);

  // 程序存储器
  box(20, 88, 220, 318, '程序存储器', ph === 0);
  const prog = cpu.program;
  for (const [xh, head] of [[26, '行'], [48, '机器码'], [98, '汇编']]) o += text(xh, 117, head, { anchor: 'w', font: 'small', fill: MUTED });
  const start = Math.max(0, Math.min(pcShow - 4, prog.length - 10));
  prog.slice(start, start + 10).forEach(([code, txt], k) => {
    const addr = start + k, y = 135 + k * 18, cur = addr === pcShow;
    if (cur) o += rect(24, y - 9, 216, y + 9, '#fff4e6');
    const col = cur ? (ph === 0 ? ACTIVE : INK) : MUTED;
    o += text(42, y, String(addr), { anchor: 'e', font: 'mono', fill: col });
    // 4 位十六进制分开画，颜色和上面那排格子一致：做什么 / 存到哪 / 数1 / 数2
    ['opcode', 'D', 'A', 'B'].forEach((key, j) => {
      o += text(48 + j * 11, y, hex((code >> (12 - 4 * j)) & 0xF), { anchor: 'w', font: 'monoBold', fill: cur || !t ? FIELD_COLORS[key] : HEX_FADED[key] });
    });
    o += text(98, y, txt.length > 17 ? txt.slice(0, 16) + '…' : txt, { anchor: 'w', font: 'mono', fill: cur ? INK : MUTED });
  });
  if (!prog.length) o += text(120, 200, '（空）', { fill: MUTED });
  wire([220, 110, 236, 110, 236, 34, 252, 34], 'fetch', [0]);
  if (t) o += text(231, 72, `取出第 ${t.pc} 行`, { anchor: 'e', font: 'small', fill: ph === 0 ? ACTIVE : MUTED });

  // 指令（16 个格子）
  const x0 = 252;
  const code = t ? t.code : 0;
  for (let i = 0; i < 16; i++) {
    const bit = 15 - i, x = x0 + i * 38;
    o += rect(x, 16, x + 36, 50, t ? FIELD_COLORS[fieldOfBit(bit)] : '#f1f3f5', 'white', 1);
    if (t) {
      o += text(x + 18, 33, String((code >> bit) & 1), { font: 'monoBig', fill: 'white' });
      if (detail) o += text(x + 3, 22, String(bit), { anchor: 'w', font: 'small', fill: 'white' });
    }
  }
  // 每 4 格合起来就是一位十六进制数
  for (let g = 0; g < 4; g++) {
    const gx = x0 + g * 152, cx = gx + 75;
    o += `<polyline points="${gx + 2},8 ${gx + 2},13 ${gx + 148},13 ${gx + 148},8" fill="none" stroke="#adb5bd"/>`;
    o += rect(cx - 10, 2, cx + 10, 16, BOX);
    if (t) o += text(cx, 8, hex((code >> (12 - 4 * g)) & 0xF), { font: 'bold', fill: FIELD_COLORS[['opcode', 'D', 'A', 'B'][g]] });
  }
  for (const [name, key, lo, hi] of [['做什么', 'opcode', 0, 3], ['存到哪', 'D', 5, 7], ['数1 从哪拿', 'A', 9, 11], ['数2 从哪拿 / 数字', 'B', 12, 15]]) {
    o += text(x0 + (lo + hi + 1) * 19, 60, name, { font: 'small', fill: FIELD_COLORS[key] });
  }
  if (t) {
    o += text(x0 + 16 * 38 + 4, 30, `=${hex(code, 4)}`, { anchor: 'w', font: 'bold', fill: ph === 0 ? ACTIVE : INK });
    o += text(x0 + 16 * 38 + 4, 48, '十六进制', { anchor: 'w', font: 'small', fill: MUTED });
  }

  const f = t ? t.fields : null;
  const ctrl = t ? t.ctrl : null;

  // 译码器
  wire([328, 68, 328, 100], 'op', [1], f && bits(f.opcode), [333, 84]);
  box(252, 100, 400, 140, '译码器（领班）', ph === 1);
  if (t && ph >= 1) o += text(326, 130, OP_CN[MNEMONIC[f.opcode]] || '看不懂', { font: 'small', fill: MUTED });
  box(252, 150, 400, 318, '领班的指示', ph === 1);
  wire([326, 140, 326, 150], 'op', [1], null, null, 'w', false);
  [['存进盒子？', 'WE'], ['上屏幕？', 'DWE'], ['存哪个？', 'RSS'], ['计算器做', 'AFS']].forEach(([label, key], k) => {
    const y = 182 + k * 34;
    let val = '', hot = false;
    if (t && ph >= 1) {
      if (key === 'WE' || key === 'DWE') [val, hot] = ctrl[key] ? ['要', true] : ['不要', false];
      else if (key === 'RSS') { val = ctrl.WE ? ['数字', '计算结果', '盒子里的数', '盒子里的数'][ctrl.RSS] : '—'; hot = !!ctrl.WE; }
      else { val = u.alu ? aluOpCn(ctrl) : '—'; hot = u.alu; }
    }
    o += text(262, y, label, { anchor: 'w', font: 'small' });
    o += text(334, y, val, { anchor: 'w', font: 'bold', fill: hot ? ACTIVE : MUTED });
    if (detail && t && ph >= 1) {
      let s = `${key}=${key === 'RSS' || key === 'AFS' ? bits(ctrl[key], 2) : ctrl[key]}`;
      if (key === 'AFS') s += ` SUB=${ctrl.SUB}`;
      o += text(262, y + 15, s, { anchor: 'w', font: 'small', fill: MUTED });
    }
  });

  // 寄存器堆
  const RX0 = 450, RX1 = 650;
  box(RX0, 100, RX1, 420, '小盒子（寄存器）', (ph === 2 || ph === 4) && !!t && (u.A || u.D));
  for (const [xh, head] of [[RX0 + 10, '盒子'], [RX0 + 72, '之前'], [RX0 + 122, '之后']]) {
    o += text(xh, 132, head, { anchor: xh > RX0 + 10 ? 'center' : 'w', font: 'small', fill: MUTED });
  }
  const written = !!t && ph === 4 && u.D;
  for (let i = 0; i < 8; i++) {
    const y = 154 + i * 32;
    const before = written && i === f.D ? t.old_value : regs[i];
    let fill = BOX, chip = '', chipCol = INK;
    if (t && ph >= 2) {
      const roles = [['数1', 'A'], ['数2', 'B']].filter(([, key]) => i === f[key] && u[key]).map(([n]) => n);
      if (roles.length) {
        chip = '→' + roles.join('、');
        chipCol = roles[0] === '数1' ? FIELD_COLORS.A : FIELD_COLORS.B;
        fill = roles[0] === '数1' ? '#ebfbee' : '#f3f0ff';
      }
    }
    if (written && i === f.D) { fill = '#e7f5ff'; chip = '←存入'; chipCol = FIELD_COLORS.D; }
    const show = detail ? (v) => bits(v) : (v) => String(v);
    o += rect(RX0 + 6, y - 13, RX1 - 6, y + 13, fill, '#dee2e6', 1);
    o += text(RX0 + 10, y, `R${i}`, { anchor: 'w', font: 'bold' });
    o += text(RX0 + 72, y, show(before), { font: 'monoBig' });
    if (t && ph === 4) {
      const changed = written && i === f.D && before !== regs[i];
      o += text(RX0 + 122, y, show(regs[i]), { font: 'monoBig', fill: changed ? ACTIVE : INK });
    } else {
      o += text(RX0 + 122, y, '…', { font: 'mono', fill: MUTED });
    }
    if (chip) o += text(RX1 - 9, y, chip, { anchor: 'e', font: 'small', fill: chipCol });
  }
  if (t && ph === 4) o += text((RX0 + RX1) / 2, 410, u.D ? '“之后”是时钟咔哒一响以后的值' : '这次没有盒子变化', { font: 'small', fill: MUTED });

  // 地址线
  wire([x0 + 6.5 * 38, 68, x0 + 6.5 * 38, 100], 'D', [4], f && `R${f.D}`, [x0 + 6.5 * 38 + 4, 82]);
  const ax = x0 + 10.5 * 38;
  wire([ax, 68, ax, 76, 560, 76, 560, 100], 'A', [2], f && `R${f.A}`, [ax + 4, 72]);
  const bx = x0 + 14.5 * 38;
  wire([bx, 68, bx, 88, 600, 88, 600, 100], 'B', [2], f && `R${f.B}`, [bx + 4, 80]);

  // ALU（计算器）
  const AX0 = 685, AX1 = 785;
  const aVal = t ? t.a_val : 0, bVal = t ? t.b_val : 0;
  const hotAlu = !!t && ph === 3;
  o += poly([AX0, 160, AX1, 205, AX1, 325, AX0, 370, AX0, 285, AX0 + 18, 265, AX0, 245], BOX, hotAlu ? ACTIVE : '#868e96', hotAlu ? 3 : 1.5);
  wire([RX1, 200, AX0, 200], 'alu', [2, 3], t && `数1=${aVal}`, [RX1 + 3, 190]);
  wire([RX1, 330, AX0, 330], 'alu', [2, 3], t && `数2=${bVal}`, [RX1 + 3, 320]);
  o += text(AX0 + 48, 180, '计算器', { font: 'bold' });
  if (t && ph >= 3) {
    const al = t.alu;
    const names = ['异或', '与', '或', al.sub ? '减' : '加'];
    for (let k = 0; k < 4; k++) {
      const sel = k === al.afs && u.alu;
      o += text(AX0 + 30, 222 + k * 22, `${names[k]} ${al.candidates[k]}`, { anchor: 'w', font: sel ? 'bold' : 'small', fill: sel ? ACTIVE : MUTED });
    }
  }
  if (t && ph >= 1) o += text(AX0 + 48, 388, u.alu ? '做：' + aluOpCn(ctrl) : '这次用不上', { font: 'small', fill: ph === 1 && u.alu ? ACTIVE : MUTED });

  // 写回选择器（岔路口）
  const MX0 = 830, MX1 = 892;
  const hotMux = !!t && ph === 4;
  o += poly([MX0, 150, MX1, 172, MX1, 358, MX0, 380], BOX, hotMux ? ACTIVE : '#868e96', hotMux ? 3 : 1.5);
  o += text(861, 140, '岔路口', { font: 'bold' });
  const rss = t ? ctrl.RSS : -1;
  if (t && ph >= 1) {
    const say = ctrl.WE ? '听领班的：\n存' + ['数字', '计算结果', '盒子的数', '盒子的数'][rss] : '领班说：不存';
    o += text(900, 400, say, { anchor: 'e', font: 'small', fill: (ph === 1 || ph === 4) && ctrl.WE ? ACTIVE : MUTED });
  }
  [[190, '数字'], [250, '计算结果'], [310, '盒子的数'], [350, '盒子的数']].forEach(([y, name], k) => {
    const on = !!t && ph === 4 && k === rss && !!ctrl.WE;
    o += text(MX0 + 4, y, name, { anchor: 'w', font: 'small', fill: on ? ACTIVE : MUTED });
  });
  // 输入 0：指令里的数字（立即数）
  const dx = x0 + 15.5 * 38;
  wire([dx, 68, dx, 128, 805, 128, 805, 190, MX0, 190], 'data', [2, 4], f && `数字 ${f.Data}`, [dx + 4, 112]);
  // 输入 1：ALU 结果
  wire([AX1, 265, 805, 265, 805, 250, MX0, 250], 'alu', rss === 1 ? [3, 4] : [3], t && String(t.alu.result), [AX1 + 3, 257]);
  // 输入 2、3：寄存器 A
  wire([668, 200, 668, 400, 812, 400, 812, 310, MX0, 310], 'A2', [2, 4], t && `数1=${aVal}`, [672, 392]);
  wire([812, 350, MX0, 350], '_', [2]);
  // 输出 → 写端口
  wire([MX1, 265, 910, 265, 910, 452, 540, 452, 540, 420], 'D', [4], t && `存入 ${t.write_data}`, [700, 444]);

  // 显示器
  box(20, 340, 400, 456, '屏幕', !!t && ph === 4 && u.disp);
  const scr = cpu.display.map(displayChar).join('');
  o += text(36, 395, scr + '▌', { anchor: 'w', font: 'monoBig', fill: '#2b8a3e' });
  wire([RX0, 380, 400, 380], 'disp', [2, 4]);
  if (t && ph >= 2) o += text(405, 368, '拼成字', { anchor: 'w', font: 'small', fill: MUTED });

  o += text(20, 470, '线的颜色：橙＝这一步在用  浅橙＝刚用过  灰＝有值但没人用', { anchor: 'w', font: 'small', fill: MUTED });

  // 阶段条
  PHASE_NAMES.forEach((nm, k) => {
    const x = 440 + k * 94;
    const on = !!t && k === ph, done = !!t && k < ph;
    o += rect(x, 462, x + 90, 478, on ? ACTIVE : done ? USED : '#f1f3f5');
    o += text(x + 45, 470, nm, { font: 'small', fill: on ? 'white' : INK });
  });

  $('dp').innerHTML = o;

  if (!keepLabel) {
    if (!t || ph < 0) {
      let msg;
      if (cpu.halted) msg = '程序执行完了。点“重置”从头再来。';
      else {
        const nxt = cpu.preview();
        msg = `下一行是第 ${cpu.pc} 行：${nxt.text}，意思是“${meaning(nxt)}”。点“下一小步”，看 CPU 分 5 小步把它做完。`;
      }
      $('phase').textContent = msg;
      $('detail').textContent = '';
    } else {
      $('phase').textContent = describePhase(t, ph);
      $('detail').textContent = detail ? '电路细节：' + describeDetail(t, ph) : '';
    }
  }
  $('bStep').disabled = $('bInstr').disabled = !!S.pendingPred;
}

// ─── 执行控制 ───
function clearStep() {
  S.trace = null;
  S.phase = -1;
  S.pendingPred = null;
  $('pred').hidden = true;
}

function loadSource(src) {
  const prog = assemble(src);   // 出错会抛 AsmError，由调用方显示
  stopRun();
  S.source = src;
  S.cpu.load(prog);
  clearStep();
  redraw();
}

function reset() {
  stopRun();
  S.cpu.reset();
  clearStep();
  redraw();
}

function nextPhase() {
  if (S.pendingPred) return;
  if (S.phase === 4 || !S.trace) {
    if (S.cpu.halted) {
      $('phase').textContent = '程序已经执行完了。点“重置”从头再来，或者“编辑程序…”写新的。';
      return;
    }
    S.trace = S.cpu.preview();
    S.phase = -1;
    if ($('cPred').checked && !S.timer) {
      askPrediction();
      return;
    }
  }
  S.phase += 1;
  if (S.phase === 4) S.cpu.commit(S.trace);   // 时钟上升沿
  redraw();
}

function finishInstruction() {
  if (S.pendingPred) return;
  if (S.phase === 4 || !S.trace) {
    nextPhase();
    if (S.pendingPred || !S.trace) return;
  }
  while (S.phase < 4) nextPhase();
}

function toggleRun() {
  if (S.timer) { stopRun(); return; }
  $('bRun').textContent = '暂停';
  $('bRun').classList.add('on');
  const tick = () => {
    if (S.cpu.halted && (S.phase === 4 || !S.trace)) { stopRun(); return; }
    nextPhase();
  };
  S.timer = setInterval(tick, 450);
  tick();
}

function stopRun() {
  if (S.timer) clearInterval(S.timer);
  S.timer = null;
  $('bRun').textContent = '连续运行';
  $('bRun').classList.remove('on');
}

// ─── 预测 ───
function askPrediction() {
  const p = makePrediction(S.trace);
  S.pendingPred = p;
  $('predQ').textContent = p.q;
  $('predOpts').innerHTML = p.options.map((opt, i) =>
    `<label><input type="radio" name="pred" value="${i}">${esc(opt)}</label>`).join('');
  $('predFb').textContent = '';
  $('predFb').className = 'fb';
  $('pred').hidden = false;
  $('phase').textContent = '先预测这条指令的结果，再一步步看电路是怎么算出来的。';
  redraw(true);
  $('pred').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function answerPrediction(skip = false) {
  const p = S.pendingPred;
  if (!p) return;
  const sel = document.querySelector('input[name=pred]:checked');
  const pick = sel ? +sel.value : -1;
  if (!skip && pick < 0) { $('predFb').textContent = '先选一个。'; $('predFb').className = 'fb dim'; return; }
  [...$('predOpts').children].forEach((l, i) => {
    l.classList.add(i === p.answer ? 'right' : 'dim');
    l.querySelector('input').disabled = true;
  });
  const right = p.options[p.answer];
  const fb = $('predFb');
  if (skip) { fb.textContent = `答案是 ${right}。接着点“下一小步”看它是怎么来的。`; fb.className = 'fb'; }
  else if (pick === p.answer) { fb.textContent = '猜对了！点“下一小步”验证一下电路是不是这么算的。'; fb.className = 'fb ok'; }
  else { fb.textContent = `答案是 ${right}。点“下一小步”，看看电路实际怎么走，哪里和你想的不一样。`; fb.className = 'fb bad'; }
  S.pendingPred = null;
  redraw(true);
}

// ─── 课程 ───
function lessonHtml(body) {
  let html = '', pre = [];
  const flush = () => { if (pre.length) { html += `<pre>${pre.map(monoHtml).join('\n')}</pre>`; pre = []; } };
  const tags = (s) => esc(s).replace(/【[^】]*】/g, (m) => {
    const cls = m.includes('源码') ? 'tag-src' : m.includes('推断') ? 'tag-inf' : 'tag-gen';
    return `<span class="${cls}">${m}</span>`;
  });
  for (const line of body.split('\n')) {
    if (line.startsWith('    ')) { pre.push(line.slice(4)); continue; }
    flush();
    if (line.startsWith('## ')) html += `<h3>${esc(line.slice(3))}</h3>`;
    else if (line.trim()) html += `<p>${tags(line)}</p>`;
  }
  flush();
  return html;
}

function setBody(body) {
  $('body').innerHTML = body === null
    ? '<p class="hint">先回答上面的选择题，讲解就会出现在这里。</p><p class="hint">猜错完全没关系：先有一个自己的预期，再看到结果，记得最牢。</p>'
    : lessonHtml(body);
  $('body').scrollTop = 0;
}

function showChapter(i) {
  if (i < 0 || i >= CHAPTERS.length) return;
  S.chapter = i;
  const ch = CHAPTERS[i];
  $('chap').value = String(i);
  $('prev').disabled = i === 0;
  $('nextCh').disabled = i === CHAPTERS.length - 1;
  const q = ch.quiz;
  $('quizQ').textContent = q.q;
  $('quizOpts').innerHTML = q.options.map((opt, k) =>
    `<label class="opt"><input type="radio" name="quiz" value="${k}"><span>${'ABCD'[k]}. ${esc(opt)}</span></label>`).join('');
  $('quizFb').textContent = '';
  $('quizOk').disabled = $('quizSkip').disabled = false;
  setBody(null);
  const acts = $('actions');
  acts.innerHTML = '';
  const add = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; acts.append(b); };
  if (ch.program) add('装载本章示例程序', () => loadSource(ch.program));
  const tools = { decoder_tool: ['指令拆解器', openDecoder], alu_tool: ['ALU 实验台', openAlu], editor: ['编辑程序', openEditor] };
  for (const key of ch.actions || []) add(...tools[key]);
  if (ch.program) loadSource(ch.program);
  history.replaceState(null, '', `#${i}`);
}

function answerQuiz(skip = false) {
  const q = CHAPTERS[S.chapter].quiz;
  const sel = document.querySelector('input[name=quiz]:checked');
  const pick = sel ? +sel.value : -1;
  const fb = $('quizFb');
  if (!skip && pick < 0) { fb.textContent = '先选一个答案（猜错也没关系）。'; fb.className = 'fb dim'; return; }
  [...$('quizOpts').children].forEach((l, k) => {
    l.classList.add(k === q.answer ? 'right' : 'dim');
    l.querySelector('input').disabled = true;
  });
  $('quizOk').disabled = $('quizSkip').disabled = true;
  let head, cls;
  if (skip) { head = `正确答案是 ${'ABCD'[q.answer]}。`; cls = 'fb'; }
  else if (pick === q.answer) { head = '答对了！'; cls = 'fb ok'; }
  else { head = `不对，正确答案是 ${'ABCD'[q.answer]}。`; cls = 'fb bad'; }
  fb.textContent = head + q.why;
  fb.className = cls;
  setBody(CHAPTERS[S.chapter].body);
}

// ─── 小工具 ───
const openModal = (id) => { $(id).hidden = false; };
for (const m of document.querySelectorAll('.modal')) {
  m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-close')) m.hidden = true; });
}

function openEditor() {
  $('edSrc').value = S.source;
  $('edErr').textContent = '';
  openModal('mEdit');
  $('edSrc').focus();
}
$('edLoad').onclick = () => {
  try { loadSource($('edSrc').value); } catch (e) {
    if (e instanceof AsmError) { $('edErr').textContent = e.message; return; }
    throw e;
  }
  $('mEdit').hidden = true;
};
$('edExample').onclick = () => { $('edSrc').value = EXAMPLE_PROGRAM; $('edErr').textContent = ''; };

function updateDecoder() {
  const s = $('decIn').value.trim();
  const svg = $('decSvg'), out = $('decOut');
  let code = null;
  try {
    code = /^(0x)?[0-9a-fA-F]{1,4}$/.test(s) ? parseInt(s.replace(/^0x/i, ''), 16) : assembleLine(s);
  } catch (e) {
    if (!(e instanceof AsmError)) throw e;
    svg.innerHTML = '';
    out.textContent = e.message;
    out.style.color = '#c92a2a';
    return;
  }
  out.style.color = '';
  if (code === null) { svg.innerHTML = ''; out.textContent = ''; return; }
  let g = '';
  for (let i = 0; i < 16; i++) {
    const bit = 15 - i, x = 10 + i * 42;
    g += rect(x, 22, x + 40, 62, FIELD_COLORS[fieldOfBit(bit)], 'white', 1);
    g += text(x + 20, 42, String((code >> bit) & 1), { font: 'monoBig', fill: 'white' });
    g += text(x + 20, 12, String(bit), { font: 'small', fill: MUTED });
  }
  for (const [name, key, lo, hi] of [['做什么', 'opcode', 0, 3], ['存到哪', 'D', 5, 7], ['数1 从哪拿', 'A', 9, 11], ['数2 从哪拿 / 数字', 'B', 12, 15]]) {
    g += text(10 + (lo + hi + 1) * 21, 76, name, { font: 'small', fill: FIELD_COLORS[key] });
  }
  svg.innerHTML = g;
  const f = splitFields(code);
  const c = controlSignals(f.opcode);
  out.innerHTML = monoHtml(`意思是：${meaning({ fields: f })}\n\n`
    + `机器码 0x${hex(code, 4)}  =  ${disassemble(code)}\n`
    + `opcode = ${bits(f.opcode)} → ${MNEMONIC[f.opcode] || '未定义（当 NOP）'}\n`
    + `D = ${bits(f.D, 3)} (R${f.D})   A = ${bits(f.A, 3)} (R${f.A})   B = ${bits(f.B, 3)} (R${f.B})   Data = ${bits(f.Data)} (${f.Data})\n`
    + `译码器输出控制字 ${bits(c.word, 7)}：SUB=${c.SUB} AFS=${bits(c.AFS, 2)} RSS=${bits(c.RSS, 2)} DWE=${c.DWE} WE=${c.WE}`);
}
function openDecoder() { openModal('mDec'); updateDecoder(); $('decIn').focus(); }
$('decIn').oninput = updateDecoder;

function updateAlu() {
  const a = (parseInt($('aluA').value, 10) || 0) & 15, b = (parseInt($('aluB').value, 10) || 0) & 15;
  const op = $('aluOp').value;
  const afs = { XOR: 0, AND: 1, OR: 2, ADD: 3, SUB: 3 }[op];
  const sub = op === 'SUB' ? 1 : 0;
  const r = alu(sub, afs, a, b);
  const sp = (v) => bits(v).split('').join('  ');
  const n2 = (v) => String(v).padStart(2, ' ');
  const lines = [pad('  第几位') + '3  2  1  0', pad(`  A = ${n2(a)}`) + sp(a), pad(`  B = ${n2(b)}`) + sp(b)];
  if (afs < 3) {
    const rule = { 0: '两位不同 → 1', 1: '两位都是 1 → 1', 2: '有一个 1 → 1' }[afs];
    lines.push('  ' + '─'.repeat(30), pad('  ' + op) + `${sp(r.result)}   （逐位：${rule}）`);
  } else {
    const cs = r.carries;
    if (sub) lines.push(pad('  B 取反') + `${sp(r.b_in)}   （SUB=1：每位和 1 异或）`);
    lines.push(pad('  进位') + `${[3, 2, 1, 0].map((i) => cs[i]).join('  ')}   （送进这一位的进位；最低位进位 = SUB = ${sub}）`,
      '  ' + '─'.repeat(30),
      pad('  结果') + `${sp(r.result)}   = ${r.result}`,
      `  最高位进位 c4 = ${cs[4]} ${cs[4] ? '（被丢掉）' : ''}`);
    const exact = sub ? a - b : a + b;
    if (exact !== r.result) lines.push(`  数学上应是 ${exact}，但 4 位只能存 0~15，所以得到 ${r.result}。`);
    lines.push('', '  每一位是一个全加器：和 = A XOR B XOR 进位，进位 = (A AND B) OR (进位 AND (A XOR B))');
  }
  lines.push('', `  ALU 四路同时算出：XOR=${r.candidates[0]} AND=${r.candidates[1]} OR=${r.candidates[2]} ${sub ? 'SUB' : 'ADD'}=${r.candidates[3]}，AFS=${bits(afs, 2)} 选第 ${afs} 路`);
  $('aluOut').innerHTML = monoHtml(lines.join('\n'));
}
function openAlu() { openModal('mAlu'); updateAlu(); }
for (const id of ['aluA', 'aluB', 'aluOp']) $(id).oninput = updateAlu;

// ─── 绑定 ───
CHAPTERS.forEach((c, i) => {
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = c.title;
  $('chap').append(o);
});
$('chap').onchange = () => showChapter(+$('chap').value);
$('prev').onclick = () => showChapter(S.chapter - 1);
$('nextCh').onclick = () => showChapter(S.chapter + 1);
$('quizOk').onclick = () => answerQuiz();
$('quizSkip').onclick = () => answerQuiz(true);
$('bStep').onclick = nextPhase;
$('bInstr').onclick = finishInstruction;
$('bRun').onclick = toggleRun;
$('bReset').onclick = reset;
$('bEdit').onclick = openEditor;
$('cDetail').onchange = () => redraw(!!S.pendingPred);
$('predOk').onclick = () => answerPrediction();
$('predSkip').onclick = () => answerPrediction(true);
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input[type=text], input[type=number], textarea, select')) return;
  if (!document.querySelector('.modal:not([hidden])') && (e.key === 'ArrowRight' || e.key === ' ')) {
    e.preventDefault();
    nextPhase();
  }
});

const start = parseInt(location.hash.slice(1), 10);
showChapter(Number.isInteger(start) && start >= 0 && start < CHAPTERS.length ? start : 0);
redraw();

// 给自动化测试用的入口
window.CPU4 = { S, nextPhase, finishInstruction, showChapter, answerQuiz, loadSource, openDecoder, openAlu, openEditor };
