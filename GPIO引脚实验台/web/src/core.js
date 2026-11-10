// 教学芯片 T8 的模型：一个端口、8 个引脚、每项配置每个引脚只占 1 位。
// 这是为了讲清楚主线做的简化，不是任何一颗真实芯片；和真实芯片的差别写在 README 里。

export const VDD = 3.3;
export const VIL = 0.3 * VDD;   // 低于它读成 0
export const VIH = 0.7 * VDD;   // 高于它读成 1

// 输入门限：中间那段读数不确定，这里按“保持上一次”处理（施密特触发器的回差）
export function readLevel(v, prev) {
  if (v >= VIH) return 1;
  if (v <= VIL) return 0;
  return prev;
}

export const REGS = [
  { name: 'CLK',   addr: 0x40001000, zh: '时钟开关',     note: '位 0 写 1，GPIO 才开始工作' },
  { name: 'DIR',   addr: 0x40002000, zh: '方向',         note: '0 输入，1 输出' },
  { name: 'OUT',   addr: 0x40002004, zh: '输出数据',     note: '输出模式下：1 高电平，0 低电平' },
  { name: 'IN',    addr: 0x40002008, zh: '输入数据',     note: '只读：引脚上现在的电平' },
  { name: 'PULL',  addr: 0x4000200C, zh: '上拉',         note: '1 接上内部上拉电阻' },
  { name: 'OTYPE', addr: 0x40002010, zh: '输出类型',     note: '0 推挽，1 开漏' },
  { name: 'SET',   addr: 0x40002014, zh: '置位',         note: '写 1 的位把 OUT 对应位变 1，其余位不动' },
  { name: 'CLR',   addr: 0x40002018, zh: '清零',         note: '写 1 的位把 OUT 对应位变 0，其余位不动' },
];
export const REG = Object.fromEntries(REGS.map((r) => [r.name, r]));
export const hex = (v, n = 2) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
export const bin = (v) => (v & 0xFF).toString(2).padStart(8, '0');
export const addrText = (a) => { const s = a.toString(16).toUpperCase().padStart(8, '0'); return '0x' + s.slice(0, 4) + '_' + s.slice(4); };

// 板子：P0~P5 接电阻和 LED 到地，P6 什么都没接，P7 接按键到地
export const LED_PINS = [0, 1, 2, 3, 4, 5];
export const FLOAT_PIN = 6;
export const BTN_PIN = 7;

export function createChip() {
  return { clk: 0, dir: 0, out: 0, pull: 0, otype: 0 };
}
export const cloneChip = (c) => ({ ...c });

// 写寄存器。时钟没开时，除 CLK 以外的写入全部被忽略，而且不报错
export function write(chip, name, val) {
  val &= 0xFF;
  if (name === 'CLK') { chip.clk = val & 1; return { ok: true }; }
  if (name === 'IN') return { ok: false, why: 'readonly' };
  if (!chip.clk) return { ok: false, why: 'noclock' };
  if (name === 'DIR') chip.dir = val;
  else if (name === 'OUT') chip.out = val;
  else if (name === 'PULL') chip.pull = val;
  else if (name === 'OTYPE') chip.otype = val;
  else if (name === 'SET') chip.out |= val;
  else if (name === 'CLR') chip.out &= ~val & 0xFF;
  else throw new Error('未知寄存器 ' + name);
  return { ok: true };
}

// 一个引脚的电气状态
// env: { btn: 按键是否按下, noise: () => 0|1 悬空时读到的随机值 }
export function pinState(chip, n, env = {}) {
  const isOut = !!((chip.dir >> n) & 1);
  const bit = (chip.out >> n) & 1;
  const od = !!((chip.otype >> n) & 1);
  const pull = !!((chip.pull >> n) & 1);
  const up = isOut && bit === 1 && !od;      // 上开关闭合
  const down = isOut && bit === 0;           // 下开关闭合
  const extLow = n === BTN_PIN && !!env.btn; // 按键把引脚接到地
  const hasLed = LED_PINS.includes(n);
  const short = up && extLow;
  let level;
  if (short) level = 'X';
  else if (down || extLow) level = 'L';
  else if (up) level = 'H';
  else if (hasLed) level = 'L';              // 没人驱动时，电阻和 LED 把它拉向地；内部上拉太弱，点不亮灯
  else level = pull ? 'H' : 'Z';
  return { n, isOut, bit, od, pull, up, down, extLow, short, level, led: hasLed && up && !short };
}

export function readIN(chip, env = {}) {
  if (!chip.clk) return 0;
  let v = 0;
  for (let n = 0; n < 8; n++) {
    const s = pinState(chip, n, env);
    const b = s.level === 'H' ? 1 : s.level === 'Z' ? ((env.noise ? env.noise() : 0) & 1) : 0;
    v |= b << n;
  }
  return v;
}

export function read(chip, name, env) {
  if (name === 'CLK') return chip.clk;
  if (!chip.clk) return 0;
  if (name === 'DIR') return chip.dir;
  if (name === 'OUT') return chip.out;
  if (name === 'IN') return readIN(chip, env);
  if (name === 'PULL') return chip.pull;
  if (name === 'OTYPE') return chip.otype;
  return 0; // SET / CLR 只写
}

// 一条语句：{ reg, op: '=' | '|=' | '&=~', val }
export function stmtText(s) {
  const v = hex(s.val);
  return s.op === '&=~' ? `${s.reg} &= ~${v};` : `${s.reg} ${s.op} ${v};`;
}
export function newValue(s, old) {
  if (s.op === '=') return s.val & 0xFF;
  if (s.op === '|=') return (old | s.val) & 0xFF;
  return old & ~s.val & 0xFF;
}
export function exec(chip, s, env) {
  const old = s.op === '=' ? 0 : read(chip, s.reg, env);
  return write(chip, s.reg, newValue(s, old));
}

// 板子给三维舞台看的样子
export function boardView(chip, env = {}, sel = -1) {
  const pins = [];
  for (let n = 0; n < 8; n++) pins.push(pinState(chip, n, env));
  return { levels: pins.map((p) => p.level), leds: LED_PINS.map((n) => pins[n].led), btn: !!env.btn, sel };
}

// 读-改-写竞争：主程序想把位 0 置 1，中断想把位 1 置 1。
// isrAt：中断插在主程序第几步之前（0 = 最前面，steps = 最后面）
// 'rmw' 模式主程序有 读、改、写 三步；'set' 模式只有一步
export function raceFinal(isrAt, mode) {
  let out = 0, tmp = 0;
  const steps = mode === 'rmw'
    ? [() => { tmp = out; }, () => { tmp |= 0x01; }, () => { out = tmp; }]
    : [() => { out |= 0x01; }];
  for (let i = 0; i <= steps.length; i++) {
    if (i === isrAt) out |= 0x02;
    if (i < steps.length) steps[i]();
  }
  return out;
}
