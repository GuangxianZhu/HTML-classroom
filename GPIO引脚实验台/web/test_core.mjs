// 校验教学芯片模型：node test_core.mjs
import assert from 'node:assert/strict';
import * as C from './src/core.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('门限：高、低、中间保持', () => {
  assert.equal(C.readLevel(3.3, 0), 1);
  assert.equal(C.readLevel(0, 1), 0);
  assert.equal(C.readLevel(1.65, 1), 1);
  assert.equal(C.readLevel(1.65, 0), 0);
});

t('没开时钟：写入被忽略，读回 0', () => {
  const c = C.createChip();
  assert.deepEqual(C.write(c, 'DIR', 0x3F), { ok: false, why: 'noclock' });
  assert.equal(c.dir, 0);
  assert.equal(C.read(c, 'OUT'), 0);
});

t('开时钟、设方向、写 OUT：对应的灯亮', () => {
  const c = C.createChip();
  C.write(c, 'CLK', 1); C.write(c, 'DIR', 0x3F); C.write(c, 'OUT', 0x15);
  assert.deepEqual(C.boardView(c).leds, [true, false, true, false, true, false]);
  assert.deepEqual(C.boardView(c).levels.slice(0, 6), ['H', 'L', 'H', 'L', 'H', 'L']);
});

t('只写 OUT 不设方向：寄存器有值，灯不亮', () => {
  const c = C.createChip();
  C.write(c, 'CLK', 1); C.write(c, 'OUT', 0x15);
  assert.equal(c.out, 0x15);
  assert.ok(C.boardView(c).leds.every((x) => !x));
});

t('一个位同时管两个开关，永远一开一关', () => {
  const c = C.createChip();
  C.write(c, 'CLK', 1); C.write(c, 'DIR', 0xFF);
  for (const v of [0x00, 0xFF, 0xA5]) {
    C.write(c, 'OUT', v);
    for (let p = 0; p < 8; p++) { const s = C.pinState(c, p); assert.notEqual(s.up, s.down); }
  }
});

t('输入：悬空乱跳，上拉后稳定，按键按下读到 0', () => {
  const c = C.createChip();
  C.write(c, 'CLK', 1);
  assert.equal(C.pinState(c, 7).level, 'Z');
  assert.equal(C.readIN(c, { noise: () => 1 }) >> 7, 1);
  assert.equal(C.readIN(c, { noise: () => 0 }) >> 7, 0);
  C.write(c, 'PULL', 0x80);
  assert.equal(C.pinState(c, 7).level, 'H');
  assert.equal(C.readIN(c, { noise: () => 0 }) >> 7, 1);
  assert.equal(C.pinState(c, 7, { btn: true }).level, 'L');
  assert.equal(C.readIN(c, { btn: true }) >> 7, 0);
});

t('输出高的引脚被按键接到地：短路', () => {
  const c = C.createChip();
  C.write(c, 'CLK', 1); C.write(c, 'DIR', 0x80); C.write(c, 'OUT', 0x80);
  assert.equal(C.pinState(c, 7, { btn: true }).short, true);
  assert.equal(C.pinState(c, 7, { btn: false }).short, false);
});

t('开漏：写 1 只是放手，按键按下也不短路', () => {
  const c = C.createChip();
  C.write(c, 'CLK', 1); C.write(c, 'DIR', 0x80); C.write(c, 'OTYPE', 0x80); C.write(c, 'OUT', 0x80);
  const s = C.pinState(c, 7, { btn: true });
  assert.equal(s.up, false); assert.equal(s.short, false); assert.equal(s.level, 'L');
});

t('SET / CLR 只动写 1 的位', () => {
  const c = C.createChip();
  C.write(c, 'CLK', 1); C.write(c, 'OUT', 0x21);
  C.write(c, 'SET', 0x02); assert.equal(c.out, 0x23);
  C.write(c, 'CLR', 0x01); assert.equal(c.out, 0x22);
});

t('语句执行：= 、|= 、&=~', () => {
  const c = C.createChip();
  for (const s of [{ reg: 'CLK', op: '=', val: 1 }, { reg: 'DIR', op: '=', val: 0x3F }, { reg: 'OUT', op: '=', val: 0x21 },
    { reg: 'OUT', op: '|=', val: 0x02 }, { reg: 'OUT', op: '&=~', val: 0x01 }]) C.exec(c, s);
  assert.equal(c.out, 0x22);
  assert.equal(C.stmtText({ reg: 'OUT', op: '&=~', val: 1 }), 'OUT &= ~0x01;');
});

t('读-改-写竞争：中断插在读和写之间会丢，SET 不会', () => {
  assert.equal(C.raceFinal(0, 'rmw'), 0x03);
  assert.equal(C.raceFinal(1, 'rmw'), 0x01);
  assert.equal(C.raceFinal(2, 'rmw'), 0x01);
  assert.equal(C.raceFinal(3, 'rmw'), 0x03);
  assert.equal(C.raceFinal(0, 'set'), 0x03);
  assert.equal(C.raceFinal(1, 'set'), 0x03);
});

t('地址和格式', () => {
  assert.equal(C.addrText(C.REG.OUT.addr), '0x4000_2004');
  assert.equal(C.hex(0x5), '0x05');
  assert.equal(C.bin(0x25), '00100101');
});

console.log(`\n${n} 项全部通过`);
