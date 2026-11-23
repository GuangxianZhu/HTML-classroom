// 自检：CPU 模型（示例程序的显示结果、机器码、溢出回绕、反汇编往返）+ 课程数据（示例程序能汇编、选择题答案合法）。
// 运行：node test_core.mjs
import { CPU, EXAMPLE_PROGRAM, alu, assemble, disassemble } from './src/core.js';
import { CHAPTERS } from './src/chapters.js';
import { makePrediction, describePhase } from './src/teach.js';

let fail = 0;
const ok = (cond, msg) => { if (cond) console.log('OK  ' + msg); else { fail++; console.log('NG  ' + msg); } };

const cpu = new CPU();
cpu.load(assemble(EXAMPLE_PROGRAM));
while (!cpu.halted) cpu.step();
ok(cpu.display.map((c) => String.fromCharCode(c)).join('') === '324606', '示例程序显示 3 2 4 6 0 6');

const codes = assemble(EXAMPLE_PROGRAM).map(([c]) => c);
ok(codes.slice(0, 7).join() === [0x1000, 0x1101, 0x1203, 0x1303, 0x3023, 0x2420, 0xF441].join(), '示例程序前 7 条机器码');
ok(alu(1, 3, 3, 5).result === 14, '3 - 5 = 14（4 位回绕）');
ok(alu(0, 3, 15, 1).result === 0, '15 + 1 = 0（溢出丢掉最高位）');
ok(assemble(EXAMPLE_PROGRAM).every(([c]) => assemble(disassemble(c))[0][0] === c), '反汇编再汇编得到同一条机器码');

// 课程数据
let chOk = true;
CHAPTERS.forEach((ch, i) => {
  const q = ch.quiz;
  if (q.options.length !== 4 || !(q.answer >= 0 && q.answer < 4)) { chOk = false; console.log(`   第 ${i} 章选择题不合法`); }
  if (ch.program) {
    try {
      const c = new CPU();
      c.load(assemble(ch.program));
      while (!c.halted) {
        const t = c.preview();
        const p = makePrediction(t);
        if (new Set(p.options).size !== 4 || p.options[p.answer] === undefined) throw new Error('预测题选项重复');
        for (let k = 0; k < 5; k++) if (!describePhase(t, k)) throw new Error('讲解为空');
        c.commit(t);
      }
    } catch (e) { chOk = false; console.log(`   第 ${i} 章示例程序：${e.message}`); }
  }
});
ok(chOk, `${CHAPTERS.length} 章：选择题合法、示例程序能汇编并跑完、每一步都有讲解和预测题`);

// 第 9 章 HELLO 程序应该打出 HI!
const hello = CHAPTERS.find((c) => c.title.startsWith('9.'));
const c9 = new CPU();
c9.load(assemble(hello.program));
while (!c9.halted) c9.step();
ok(c9.display.map((c) => String.fromCharCode(c)).join('') === 'HI!', '第 9 章示例程序打出 HI!');

if (fail) { console.log(`\n${fail} 项不通过`); process.exit(1); }
console.log('\n全部通过');
