// 4 位 CPU 的模型（不含界面，node 里也能跑）。
// 行为逐条对照原项目的 cpu.v、alu.v、three_port_reg_file.v。为了教学，ALU 的加法用
// 4 个全加器逐位串起来算（对应 Logisim 电路里的 fulladder 子电路）；Verilog 版直接写的是
// a + xorB + sub，两者结果相同。
//
// 用法：
//   const cpu = new CPU(); cpu.load(assemble(source));
//   const t = cpu.preview();   // 只算出这一拍电路里每根线上的值，不改状态
//   cpu.commit(t);             // 相当于时钟上升沿：写寄存器、显示、PC+1

// ─── 指令集 ───
export const OPCODES = { NOP: 0x0, LD: 0x1, MOV: 0x2, DISP: 0x3, XOR: 0x4, AND: 0x5, OR: 0x6, ADD: 0x7, SUB: 0xF };
export const MNEMONIC = Object.fromEntries(Object.entries(OPCODES).map(([k, v]) => [v, k]));

// 指令译码器：opcode -> 7 位控制字，和 cpu.v 里的 case 表一模一样。
// 位：6=SUB  5:4=AFS  3:2=RSS  1=DWE  0=WE
export const CONTROL_ROM = { 0x1: 0x01, 0x2: 0x09, 0x3: 0x02, 0x4: 0x05, 0x5: 0x15, 0x6: 0x25, 0x7: 0x35, 0xF: 0x75 };

export const AFS_NAMES = ['XOR', 'AND', 'OR', 'ADD/SUB'];
export const RSS_NAMES = ['指令里的立即数 Data', 'ALU 结果', '寄存器 A 的值', '寄存器 A 的值'];

export function controlSignals(opcode) {
  const word = CONTROL_ROM[opcode] || 0;   // 没定义的 opcode 控制字全 0，等同 NOP
  return { word, WE: word & 1, DWE: (word >> 1) & 1, RSS: (word >> 2) & 3, AFS: (word >> 4) & 3, SUB: (word >> 6) & 1 };
}

// 把 16 位指令拆成各个字段（位置见 cpu.v 开头的 assign）
export function splitFields(code) {
  return {
    opcode: (code >> 12) & 0xF,   // [15:12]
    D: (code >> 8) & 0x7,         // [10:8]
    A: (code >> 4) & 0x7,         // [6:4]
    B: code & 0x7,                // [2:0]
    Data: code & 0xF,             // [3:0]
  };
}

export const bits = (value, width = 4) => (value & ((1 << width) - 1)).toString(2).padStart(width, '0');
export const hex = (v, w = 1) => v.toString(16).toUpperCase().padStart(w, '0');

// ─── ALU ───
// 一位全加器，门级写法与 fulladder.v 相同。返回 [和, 进位]
export function fullAdder(a, b, cin) {
  const t1 = a ^ b, t2 = a & b, t3 = cin & t1;
  return [cin ^ t1, t2 | t3];
}

// 4 个全加器串成行波进位加法器，返回每一位的细节，方便画出来
export function rippleAdd(a, b, cin) {
  const carries = [cin];
  const sums = [];
  for (let i = 0; i < 4; i++) {
    const [s, c] = fullAdder((a >> i) & 1, (b >> i) & 1, carries[carries.length - 1]);
    sums.push(s);
    carries.push(c);
  }
  const result = sums.reduce((acc, s, i) => acc + (s << i), 0);
  return [result, carries];   // carries[i] 是进入第 i 位的进位，carries[4] 是最高位溢出
}

// 和 alu.v 一样：四种运算同时算出来，再由 AFS 选一个
export function alu(sub, afs, a, b) {
  const bIn = b ^ (sub ? 0xF : 0);              // SUB=1 时把 B 每一位取反
  const [addRes, carries] = rippleAdd(a, bIn, sub);   // 再把 SUB 当作最低位进位 +1
  const candidates = [a ^ b, a & b, a | b, addRes];
  return { a, b, sub, afs, b_in: bIn, carries, candidates, result: candidates[afs] };
}

// ─── 汇编器 ───
export class AsmError extends Error {}

function reg(tok) {
  const t = tok.trim().toUpperCase().replace(/^\$+/, '').replace(/^R+/, '');
  if (!/^\d+$/.test(t) || +t > 7) throw new AsmError(`寄存器写法不对：${tok}（应为 $0~$7 或 R0~R7）`);
  return +t;
}

function imm(tok) {
  // 和 Python 的 int(tok, 0) 一样认 10 / 0x / 0b / 0o 几种写法
  const m = /^([+-]?)(0x[0-9a-f]+|0b[01]+|0o[0-7]+|0|[1-9][0-9]*)$/i.exec(tok);
  if (!m) throw new AsmError(`立即数不是数字：${tok}`);
  const body = m[2].toLowerCase();
  let v = body.startsWith('0b') ? parseInt(body.slice(2), 2) : body.startsWith('0o') ? parseInt(body.slice(2), 8) : Number(body);
  if (m[1] === '-') v = -v;
  if (v < 0 || v > 15) throw new AsmError(`立即数只能是 0~15（4 位），而你写了 ${v}`);
  return v;
}

// 把一行汇编翻译成 16 位机器码；空行/注释返回 null
export function assembleLine(line) {
  const text = line.split('#')[0].split('//')[0].split(';')[0].trim();
  if (!text) return null;
  const toks = text.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  const op = toks[0].toUpperCase();
  const args = toks.slice(1);
  if (!(op in OPCODES)) throw new AsmError(`不认识的指令：${toks[0]}`);
  const need = { NOP: 0, LD: 2, MOV: 2, DISP: 2 }[op] ?? 3;
  if (args.length !== need) throw new AsmError(`${op} 需要 ${need} 个操作数，这里有 ${args.length} 个`);
  const opc = OPCODES[op] << 12;
  if (op === 'NOP') return 0;
  if (op === 'LD') return opc | (reg(args[0]) << 8) | imm(args[1]);
  if (op === 'MOV') return opc | (reg(args[0]) << 8) | (reg(args[1]) << 4);
  if (op === 'DISP') return opc | (reg(args[0]) << 4) | reg(args[1]);
  return opc | (reg(args[0]) << 8) | (reg(args[1]) << 4) | reg(args[2]);
}

// 返回 [[机器码, 原文], ...]；出错时抛 AsmError，并注明行号
export function assemble(source) {
  const program = [];
  source.split(/\r?\n/).forEach((line, i) => {
    let code;
    try {
      code = assembleLine(line);
    } catch (e) {
      if (e instanceof AsmError) throw new AsmError(`第 ${i + 1} 行：${e.message}`);
      throw e;
    }
    if (code !== null) program.push([code, disassemble(code)]);
  });
  return program;
}

export function disassemble(code) {
  const f = splitFields(code);
  const op = MNEMONIC[f.opcode];
  if (op === undefined) return `??? (未定义 opcode ${hex(f.opcode)}，当 NOP)`;
  if (op === 'NOP') return 'NOP';
  if (op === 'LD') return `LD $${f.D}, ${f.Data}`;
  if (op === 'MOV') return `MOV $${f.D}, $${f.A}`;
  if (op === 'DISP') return `DISP $${f.A}, $${f.B}`;
  return `${op} $${f.D}, $${f.A}, $${f.B}`;
}

// ─── CPU ───
export class CPU {
  constructor() {
    this.program = [];
    this.reset();
  }

  reset() {
    this.regs = [0, 0, 0, 0, 0, 0, 0, 0];
    this.pc = 0;
    this.display = [];   // 显示器上已经输出的内容（7 位码）
    this.cycles = 0;
  }

  load(program) {
    this.program = [...program];
    this.reset();
  }

  get halted() { return this.pc >= this.program.length; }

  // 算出这一拍里电路每个部分的值（组合逻辑），但还不写入任何东西
  preview() {
    if (this.halted) return null;
    const [code, text] = this.program[this.pc];
    const f = splitFields(code);
    const ctrl = controlSignals(f.opcode);
    const aVal = this.regs[f.A];     // 读端口 A：8 选 1 MUX 按地址 A 选出
    const bVal = this.regs[f.B];     // 读端口 B
    const aluOut = alu(ctrl.SUB, ctrl.AFS, aVal, bVal);
    const muxInputs = [f.Data, aluOut.result, aVal, aVal];   // cpu.v: mux_4to1(data, aluRes, a, a, ...)
    return {
      pc: this.pc, code, text, fields: f, ctrl,
      a_val: aVal, b_val: bVal, alu: aluOut,
      mux_inputs: muxInputs, write_data: muxInputs[ctrl.RSS],
      old_value: this.regs[f.D],
      disp_code: ((aVal & 0x7) << 4) | bVal,   // 送给 ASCII 显示器的 7 位
    };
  }

  // 时钟上升沿：WE=1 时把写回数据存进 Rd；DWE=1 时显示；PC+1
  commit(t) {
    if (t.ctrl.WE) this.regs[t.fields.D] = t.write_data;
    if (t.ctrl.DWE) this.display.push(t.disp_code);
    this.pc += 1;
    this.cycles += 1;
  }

  step() {
    const t = this.preview();
    if (t) this.commit(t);
    return t;
  }
}

// 把 7 位 ASCII 码变成能打印的字符
export const displayChar = (code7) => (code7 >= 32 && code7 < 127 ? String.fromCharCode(code7) : '·');

export const EXAMPLE_PROGRAM = `LD  $0, 0        # R0 = 0
LD  $1, 1        # R1 = 1
LD  $2, 3        # R2 = 3（显示时当 ASCII 的高位，见第 9 章）
LD  $3, 3        # R3 = 3
DISP $2, $3      # 显示 '3'
MOV $4, $2       # R4 = R2 = 3
SUB $4, $4, $1   # R4 = 3 - 1 = 2
DISP $2, $4      # 显示 '2'
ADD $3, $3, $1   # R3 = 3 + 1 = 4
DISP $2, $3      # 显示 '4'
XOR $5, $3, $4   # R5 = 4 XOR 2 = 6
DISP $2, $5      # 显示 '6'
AND $5, $3, $4   # R5 = 4 AND 2 = 0
DISP $2, $5      # 显示 '0'
OR  $5, $3, $4   # R5 = 4 OR 2 = 6
DISP $2, $5      # 显示 '6'
`;
