// 每一小步的文字说明 + 执行前的预测题（不依赖界面，node 里也能跑）。
import { MNEMONIC, RSS_NAMES, bits, hex, displayChar } from './core.js';

export const PHASE_NAMES = ['① 取指令', '② 读懂指令', '③ 拿数据', '④ 计算', '⑤ 存结果'];
export const OP_CN = { NOP: '什么也不做', LD: '装数字', MOV: '复制', DISP: '显示', XOR: '异或', AND: '与', OR: '或', ADD: '加法', SUB: '减法' };
const AFS_CN = ['异或', '与', '或', '加法'];
const SOURCE_CN = ['指令里写的数字', '计算器的结果', '盒子里的数', '盒子里的数'];

// 这条指令真正“用到”的通路（其它通路上照样有值，只是没人要）
export function uses(t) {
  const c = t.ctrl;
  const useAlu = !!(c.WE && c.RSS === 1);
  return {
    alu: useAlu,
    A: useAlu || !!(c.WE && c.RSS >= 2) || !!c.DWE,
    B: useAlu || !!c.DWE,
    data: !!(c.WE && c.RSS === 0),
    D: !!c.WE,
    disp: !!c.DWE,
  };
}

export const aluOpCn = (ctrl) => (ctrl.SUB ? '减法' : AFS_CN[ctrl.AFS]);

// 用一句话说这条指令要干什么
export function meaning(t) {
  const f = t.fields;
  const op = MNEMONIC[f.opcode];
  const { D: d, A: a, B: b } = f;
  if (op === 'LD') return `把数字 ${f.Data} 放进盒子 R${d}`;
  if (op === 'MOV') return `把盒子 R${a} 里的数复制到盒子 R${d}`;
  if (op === 'DISP') return `用盒子 R${a} 和 R${b} 里的数拼成一个字，显示到屏幕上`;
  if (op === 'ADD') return `R${a} 加 R${b}，结果放进 R${d}`;
  if (op === 'SUB') return `R${a} 减 R${b}，结果放进 R${d}`;
  if (op === 'XOR' || op === 'AND' || op === 'OR') return `R${a} 和 R${b} 做“${OP_CN[op]}”，结果放进 R${d}`;
  return '什么也不做';
}

// 给初学者看的说明：先说在干嘛，少用术语
export function describePhase(t, phase) {
  const f = t.fields, c = t.ctrl, u = uses(t), al = t.alu;
  const op = MNEMONIC[f.opcode];
  if (phase === 0) {
    return `① 取指令：书签（PC）指着第 ${t.pc} 行，CPU 把这一行命令取出来：${t.text}。意思是“${meaning(t)}”。`;
  }
  if (phase === 1) {
    if (op === undefined) return '② 读懂指令：领班查不到这种命令，于是什么指示都不发，等于“什么也不做”。';
    const orders = [];
    if (c.WE) {
      let src = SOURCE_CN[c.RSS];
      if (c.RSS === 0) src += ` ${f.Data} `;
      else if (c.RSS >= 2) src = `盒子 R${f.A} 里的数`;
      orders.push(`把${src}存进盒子 R${f.D}`);
    }
    if (u.alu) orders.push(`计算器做${aluOpCn(c)}`);
    if (c.DWE) orders.push('往屏幕上写一个字');
    if (!c.WE) orders.push('这次不往任何盒子里存东西');
    return `② 读懂指令：前 4 位 ${bits(f.opcode)} 代表“${OP_CN[op]}”。领班（译码器）看懂后向各部件下指示：${orders.join('；')}。`;
  }
  if (phase === 2) {
    let s = `③ 拿数据：按命令里写的编号，从盒子 R${f.A} 拿出 ${t.a_val} 当“数1”，从盒子 R${f.B} 拿出 ${t.b_val} 当“数2”。`;
    if (!(u.A || u.B)) s += '这条命令其实用不上它们，但电路每次都会顺手拿出来，没人要就算了。';
    else if (!u.B) s += '这条命令只用得上数1。';
    if (op === 'LD') s += `要放的数字 ${f.Data} 就写在命令里，不用去盒子里拿。`;
    return s;
  }
  if (phase === 3) {
    if (!u.alu) return '④ 计算：这条命令不需要计算。不过计算器一直通着电，还是把能算的都算了一遍，结果没人要，会被扔掉。';
    const { a, b, result: r } = al;
    if (c.AFS === 3) {
      const raw = c.SUB ? a - b : a + b;
      let s = `④ 计算：计算器（ALU）做${aluOpCn(c)}：${a} ${c.SUB ? '−' : '+'} ${b} = ${r}。`;
      if (raw !== r) {
        s += `数学上应该是 ${raw}，但盒子只能放 0~15，${raw < 0 ? '没有负数' : '多出来的那一位被丢掉了'}，所以得到 ${r}（第 7 章讲为什么）。`;
      }
      return s;
    }
    return `④ 计算：计算器（ALU）做“${AFS_CN[c.AFS]}”，一位一位比：${bits(a)} 和 ${bits(b)} → ${bits(r)}，也就是 ${r}。`;
  }
  if (phase === 4) {
    if (c.WE) {
      const p = ['数字', '计算结果', '盒子的数', '盒子的数'][c.RSS];
      const v = t.write_data;
      const change = t.old_value === v ? `之前是 ${t.old_value}，之后还是 ${v}，没变` : `之前是 ${t.old_value}，之后变成 ${v}`;
      return `⑤ 存结果：岔路口有“数字、计算结果、盒子的数”几个入口，它不自己拿主意，而是照领班第②步说的“存哪个？${p}”，`
        + `选了“${p}”这一路的 ${v}。时钟“咔哒”一响，${v} 被放进盒子 R${f.D}：${change}。书签挪到第 ${t.pc + 1} 行。`;
    }
    if (c.DWE) return `⑤ 显示：屏幕上出现字符 '${displayChar(t.disp_code)}'。这次没有改动任何盒子。书签挪到第 ${t.pc + 1} 行。`;
    return `⑤ 存结果：什么也不存。书签挪到第 ${t.pc + 1} 行。`;
  }
  return '';
}

// 给想深入的同学：原电路里的信号名、二进制和控制字
export function describeDetail(t, phase) {
  const f = t.fields, c = t.ctrl;
  if (phase === 0) {
    const b = [12, 8, 4, 0].map((s) => bits(t.code >> s)).join(' ');
    return `PC = ${t.pc}，程序存储器（ROM）输出 16 位指令 0x${hex(t.code, 4)} = ${b}。`;
  }
  if (phase === 1) {
    return `opcode = ${bits(f.opcode)}，译码器查表输出 7 位控制字 ${bits(c.word, 7)}：WE（写寄存器）=${c.WE}，DWE（写显示器）=${c.DWE}，`
      + `RSS（写回选择）=${bits(c.RSS, 2)}，AFS（ALU 功能）=${bits(c.AFS, 2)}，SUB（减法）=${c.SUB}。`;
  }
  if (phase === 2) {
    return `读端口 A：地址 ${f.A} → R${f.A} = ${bits(t.a_val)}；读端口 B：地址 ${f.B} → R${f.B} = ${bits(t.b_val)}。`
      + `读端口是组合逻辑（8 选 1 MUX），一直在输出。立即数 Data = 指令[3:0] = ${bits(f.Data)}。`;
  }
  if (phase === 3) {
    const al = t.alu;
    const cand = al.candidates;
    const chain = [...al.carries].reverse().join('');
    let s = `ALU 四路并行：XOR=${cand[0]} AND=${cand[1]} OR=${cand[2]} ${al.sub ? 'SUB' : 'ADD'}=${cand[3]}，`
      + `AFS=${bits(al.afs, 2)} 选第 ${al.afs} 路 → ${al.result}。`;
    if (al.sub) s += `减法 = A + (B 按位取反) + 1：${bits(al.a)} + ${bits(al.b_in)} + 1，进位链 c4..c0 = ${chain}，结果 ${bits(al.result)}。`;
    else if (al.afs === 3) s += `进位链 c4..c0 = ${chain}${al.carries[4] ? '，c4=1 溢出被丢弃' : ''}。`;
    return s;
  }
  if (phase === 4) {
    let s = `写回 MUX：RSS=${bits(c.RSS, 2)} 选第 ${c.RSS} 路（${RSS_NAMES[c.RSS]}）= ${t.write_data}。`;
    s += c.WE ? `时钟上升沿，WE=1，3-8 译码器打开 R${f.D} 的写使能，写入 ${bits(t.write_data)}。` : 'WE=0，不写寄存器。';
    if (c.DWE) s += `DWE=1，显示器收到 7 位码 ${bits(t.disp_code, 7)} = 0x${hex(t.disp_code, 2)}（R${f.A} 低 3 位 + R${f.B} 4 位）。`;
    return s + `PC ← PC + 1 = ${t.pc + 1}。`;
  }
  return '';
}

// ─── 执行前的预测题 ───
const randint = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickOpts(right, pool, rand, chars = false) {
  const opts = [right];
  for (const p of pool) if (!opts.includes(p) && opts.length < 4) opts.push(p);
  while (opts.length < 4) {
    const p = chars ? String.fromCharCode(randint(rand, 0x30, 0x5A)) : randint(rand, 0, 15);
    if (!opts.includes(p)) opts.push(p);
  }
  return shuffle(opts, rand);
}

// 根据下一条指令出一道四选一的预测题：{q, options, answer, why}
export function makePrediction(t, rand = Math.random) {
  const f = t.fields, c = t.ctrl, al = t.alu;
  if (c.WE) {
    const right = t.write_data;
    const pool = [];
    if (c.AFS === 3 && c.RSS === 1) {
      const raw = al.sub ? al.a - al.b : al.a + al.b;
      if (raw !== right) pool.push(raw);   // 不懂溢出回绕的人最容易选的答案，放在最前面
    }
    pool.push(...al.candidates, t.old_value, t.a_val, t.b_val, f.Data);
    const opts = pickOpts(right, pool, rand);
    return {
      q: `${t.text}（${meaning(t)}）。执行完以后，盒子 R${f.D} 里是多少？`,
      options: opts.map(String), answer: opts.indexOf(right),
      why: c.RSS === 1 ? describePhase(t, 3) : describePhase(t, 4),
    };
  }
  if (c.DWE) {
    const right = displayChar(t.disp_code);
    const pool = [String(t.b_val % 10), displayChar(((t.b_val & 7) << 4) | t.a_val),
      displayChar(t.disp_code + 1), displayChar(t.disp_code ^ 0x10)];
    const opts = pickOpts(right, pool, rand, true);
    return { q: `${t.text}（${meaning(t)}）。屏幕上会多出哪个字符？`, options: opts, answer: opts.indexOf(right), why: describePhase(t, 4) };
  }
  const opts = ['没有盒子改变（只是书签往下挪）', 'R0 变成 0', '所有盒子清零', `R${f.D} 加 1`];
  return { q: `${t.text}：执行时会发生什么？`, options: opts, answer: 0, why: describePhase(t, 4) };
}
