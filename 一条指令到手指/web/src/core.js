// 教学模型：一条指令从电脑走到手指，每一站用到的换算都在这里。
// 页面只负责显示；数字都从这里算，test_core.mjs 拿 whj_MCU 仓库里的已知数据包和时间账来对。

// ---------- 数据包（DYNAMIXEL Protocol 2.0） ----------
export const HEADER = [0xFF, 0xFF, 0xFD, 0x00];
export const BROADCAST = 0xFE;
export const INST = { PING: 0x01, READ: 0x02, WRITE: 0x03, STATUS: 0x55, SYNC_READ: 0x82, SYNC_WRITE: 0x83 };
export const INST_NAME = { 0x01: 'Ping', 0x02: 'Read', 0x03: 'Write', 0x55: 'Status（应答）', 0x82: 'Sync Read', 0x83: 'Sync Write' };
export const ADDR = { id: 7, baud: 8, returnDelay: 9, mode: 11, torque: 64, goalCurrent: 102, goalPos: 116, presentCurrent: 126, presentPos: 132 };
export const ADDR_NAME = { 7: 'ID', 8: 'Baud Rate', 9: 'Return Delay Time', 11: 'Operating Mode', 64: 'Torque Enable', 102: 'Goal Current', 116: 'Goal Position', 126: 'Present Current', 132: 'Present Position' };

export function crc16(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x8005) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}
export const le = (value, n) => { const o = []; let v = value >>> 0; for (let i = 0; i < n; i++) { o.push(v & 0xFF); v >>>= 8; } return o; };
export const fromLe = (bytes) => bytes.reduce((a, b, i) => a + b * 2 ** (8 * i), 0);
export const hex2 = (b) => b.toString(16).toUpperCase().padStart(2, '0');
export const hexs = (bytes) => bytes.map(hex2).join(' ');

export function packet(id, inst, params = []) {
  const body = [inst];
  for (const b of params) {                 // 字节填充：参数里出现 FF FF FD 时补一个 FD，免得被当成包头
    body.push(b);
    const n = body.length;
    if (n >= 3 && body[n - 3] === 0xFF && body[n - 2] === 0xFF && body[n - 1] === 0xFD) body.push(0xFD);
  }
  const len = body.length + 2;
  const p = [...HEADER, id, len & 0xFF, len >> 8, ...body];
  const c = crc16(p);
  return [...p, c & 0xFF, c >> 8];
}
export const writePacket = (id, addr, n, value) => packet(id, INST.WRITE, [...le(addr, 2), ...le(value, n)]);
export const readPacket = (id, addr, n) => packet(id, INST.READ, [...le(addr, 2), ...le(n, 2)]);
export const pingPacket = (id) => packet(id, INST.PING);
export const statusPacket = (id, err = 0, params = []) => packet(id, INST.STATUS, [err, ...params]);
export const syncWrite = (addr, n, pairs) => packet(BROADCAST, INST.SYNC_WRITE,
  [...le(addr, 2), ...le(n, 2), ...pairs.flatMap(([id, v]) => [id, ...le(v, n)])]);
export const syncRead = (addr, n, ids) => packet(BROADCAST, INST.SYNC_READ, [...le(addr, 2), ...le(n, 2), ...ids]);

// 把一个包拆成几段，页面按段上色。只处理没有字节填充的常见包。
export function fields(bytes) {
  const f = [];
  const push = (key, name, from, to, note) => { if (to > from) f.push({ key, name, from, to, bytes: bytes.slice(from, to), note }); };
  const n = bytes.length;
  push('head', '包头', 0, 4, '固定的 FF FF FD 00，告诉所有舵机“新的一包从这里开始”');
  push('id', 'ID', 4, 5, bytes[4] === BROADCAST ? 'FE = 广播，所有舵机都要听' : `给 ${bytes[4]} 号舵机`);
  const len = fromLe(bytes.slice(5, 7));
  push('len', '长度', 5, 7, `后面还有 ${len} 个字节（指令 + 参数 + 校验）`);
  const inst = bytes[7];
  push('inst', '指令', 7, 8, INST_NAME[inst] || '指令');
  const pEnd = n - 2;
  if (inst === INST.WRITE || inst === INST.READ) {
    const a = fromLe(bytes.slice(8, 10));
    push('addr', '地址', 8, 10, `${a} 号格子${ADDR_NAME[a] ? '：' + ADDR_NAME[a] : ''}（低字节在前）`);
    push('data', inst === INST.WRITE ? '数值' : '要读几个字节', 10, pEnd,
      inst === INST.WRITE ? `${fromLe(bytes.slice(10, pEnd))}（低字节在前）` : `${fromLe(bytes.slice(10, pEnd))} 个`);
  } else if (inst === INST.STATUS) {
    push('err', '错误码', 8, 9, bytes[8] === 0 ? '00 = 没有错误' : '不是 00，舵机在报错');
    push('data', '读回的数', 9, pEnd, '');
  } else if (inst === INST.SYNC_WRITE || inst === INST.SYNC_READ) {
    const a = fromLe(bytes.slice(8, 10));
    push('addr', '地址', 8, 10, `${a} 号格子${ADDR_NAME[a] ? '：' + ADDR_NAME[a] : ''}`);
    push('dlen', '每个舵机几个字节', 10, 12, `${fromLe(bytes.slice(10, 12))} 个`);
    push('data', inst === INST.SYNC_WRITE ? '每个舵机：ID + 数值' : '要读的舵机 ID', 12, pEnd, '');
  } else push('data', '参数', 8, pEnd, '');
  push('crc', '校验', pEnd, n, '前面所有字节算出来的两个字节，收的人再算一遍，对不上就整包丢掉');
  return f;
}

// 收的一方做的检查。返回哪一步没过。
export function check(bytes) {
  if (bytes.length < 10) return { ok: false, why: 'short' };
  for (let i = 0; i < 4; i++) if (bytes[i] !== HEADER[i]) return { ok: false, why: 'header' };
  const len = fromLe(bytes.slice(5, 7));
  if (bytes.length !== 7 + len) return { ok: false, why: 'length' };
  const c = crc16(bytes.slice(0, -2));
  if ((c & 0xFF) !== bytes[bytes.length - 2] || (c >> 8) !== bytes[bytes.length - 1]) return { ok: false, why: 'crc' };
  return { ok: true, id: bytes[4], inst: bytes[7] };
}

// 总线上的每个舵机都收到同一包。谁执行、谁应答？
export function whoReacts(bytes, idsOnBus) {
  const c = check(bytes);
  if (!c.ok) return { valid: false, why: c.why, act: [], reply: [] };
  if (c.id === BROADCAST) {
    if (c.inst === INST.SYNC_WRITE) {
      const n = fromLe(bytes.slice(10, 12)), ids = [];
      for (let i = 12; i + n < bytes.length - 2; i += 1 + n) ids.push(bytes[i]);
      return { valid: true, act: ids.filter((i) => idsOnBus.includes(i)), reply: [] };
    }
    if (c.inst === INST.SYNC_READ) {
      const ids = bytes.slice(12, -2).filter((i) => idsOnBus.includes(i));
      return { valid: true, act: ids, reply: ids };
    }
    if (c.inst === INST.PING) return { valid: true, act: [...idsOnBus], reply: [...idsOnBus] };
    return { valid: true, act: [...idsOnBus], reply: [] };      // 其他广播指令：都执行，都不应答
  }
  const hit = idsOnBus.includes(c.id) ? [c.id] : [];
  return { valid: true, act: hit, reply: hit };
}

// ---------- 字节 → 电平（UART，8 个数据位、无校验、1 个停止位） ----------
export const BAUDS = [57600, 1000000];
export const bitUs = (baud) => 1e6 / baud;
export const byteUs = (baud) => 10 * bitUs(baud);
export const frameMs = (nBytes, baud) => nBytes * byteUs(baud) / 1000;
// 一个字节在线上的 10 个电平：起始位 0，数据位从最低位开始，停止位 1
export const uartBits = (b) => [0, ...Array.from({ length: 8 }, (_, i) => (b >> i) & 1), 1];
export const fromUartBits = (bits) => bits.slice(1, 9).reduce((a, v, i) => a | (v << i), 0);

// ---------- 角度 → 电机位置数（标定） ----------
export const STEPS = 4096;                       // 舵机一圈分成 4096 格
export const stepDeg = 360 / STEPS;              // 一格约 0.088°
// cal：关节的两个极限角（度），和撞到这两个极限时读到的电机位置数
export function jointToMotor(cal, deg) {
  const d = Math.max(cal.degMin, Math.min(cal.degMax, deg));
  const rho = (cal.mMax - cal.mMin) / (cal.degMax - cal.degMin);
  return Math.round(cal.mMin + rho * (d - cal.degMin));
}
export function motorToJoint(cal, m) {
  const rho = (cal.mMax - cal.mMin) / (cal.degMax - cal.degMin);
  return cal.degMin + (m - cal.mMin) / rho;
}
export const stepsPerDeg = (cal) => (cal.mMax - cal.mMin) / (cal.degMax - cal.degMin);
// 教学用的示例标定：食指 MCP。真实数值在你电脑上的 calibration.yaml 里，每只手都不一样。
export const CAL_DEMO = { joint: 'index_mcp', id: 8, degMin: -20, degMax: 95, mMin: 3210, mMax: 1640 };

// ---------- 电平：同一个电压，不同的芯片读法不同 ----------
// CMOS 输入的典型门限：高于 0.7 × 电源算 1，低于 0.3 × 电源算 0
export function logicRead(v, vcc) { return v >= 0.7 * vcc ? 1 : v <= 0.3 * vcc ? 0 : null; }
// TXB0104 的输出很弱（内部约串 4 kΩ），外面接的下拉电阻会把高电平分走一部分
export const TXB_ROUT = 4000;
export const txbHigh = (vcc, pullDownOhm) => vcc * pullDownOhm / (pullDownOhm + TXB_ROUT);

// ---------- 两根线合成一根（74LVC2G241） ----------
// DIR = 1：发送门打开，TX 推到 DATA，接收门关掉。DIR = 0：发送门松手，DATA 上的电平送到 RX。
// servo：舵机这时在 DATA 上推的电平（null = 舵机没在说话）
export function gate241({ dir, tx, servo = null }) {
  const txOn = dir === 1, rxOn = dir === 0;
  let data, fight = false;
  if (txOn && servo !== null) { fight = tx !== servo; data = fight ? null : tx; }
  else if (txOn) data = tx;
  else if (servo !== null) data = servo;
  else data = 1;                                 // 没人推：上拉电阻把 DATA 拉到高，这就是空闲状态
  return { txOn, rxOn, data, fight, rx: rxOn ? (data === null ? 1 : data) : 1 };
}

// ---------- TXEN 什么时候松手 ----------
// releaseUs：以最后一个停止位结束的时刻为 0，TXEN 提前（负）或推迟（正）多少微秒回到 0
export function txenOutcome({ releaseUs, returnDelayUs, baud }) {
  const bit = bitUs(baud);
  if (releaseUs < -bit) {
    const cut = Math.min(10, Math.ceil((-releaseUs - bit) / bit));
    return { kind: 'cut', bits: cut, text: `最后一个字节还有 ${cut} 位没发完就松手了，舵机收到的校验对不上，整包丢掉，不动也不应答。` };
  }
  if (releaseUs > returnDelayUs) {
    const lost = (releaseUs - returnDelayUs) / bit;
    return { kind: 'late', bits: lost, text: `舵机已经开始应答，发送门还占着线，应答开头被盖掉 ${lost < 1 ? '不到 1' : Math.floor(lost)} 位。电脑收到乱码或者收不全，表现是时好时坏。` };
  }
  return { kind: 'ok', marginUs: returnDelayUs - Math.max(0, releaseUs), text: `在舵机开口之前松了手，应答完整收到。离舵机开口还有 ${Math.round(returnDelayUs - Math.max(0, releaseUs))} µs。` };
}

// 一问一答的时间线（时间以指令最后一位发完为 0，单位 µs）：主机实际占线到什么时候、舵机答不答、应答被盖住多少
export function txenTimeline({ releaseUs, returnDelayUs, baud, replyBytes = 11 }) {
  const o = txenOutcome({ releaseUs, returnDelayUs, baud }), bit = bitUs(baud), byte = byteUs(baud);
  const replyStart = returnDelayUs, replyEnd = returnDelayUs + replyBytes * byte;
  return {
    kind: o.kind, releaseUs, replyStart, replyEnd,
    hostEnd: o.kind === 'cut' ? releaseUs : 0,                                   // 松早了：指令到松手那一刻就断了
    replies: o.kind !== 'cut',                                                   // 指令没收全，舵机不应答
    coverEnd: o.kind === 'late' ? Math.min(releaseUs, replyEnd) : replyStart,    // 应答从开头被盖到这里
    lostCmdBytes: o.kind === 'cut' ? Math.ceil((-releaseUs - bit) / byte) : 0,
    lostReplyBytes: o.kind === 'late' ? Math.min(replyBytes, Math.ceil((releaseUs - returnDelayUs) / byte)) : 0,
  };
}
// 某一时刻线上的情况：host 主机在发 / cut 主机想发但已经松手 / idle 没人说 / servo 舵机在答 / clash 舵机在答而主机还占着线
export function txenAt(tl, t) {
  if (t < 0) return t < tl.hostEnd ? 'host' : 'cut';
  if (tl.replies && t >= tl.replyStart && t < tl.replyEnd) return t < tl.coverEnd ? 'clash' : 'servo';
  return 'idle';
}

// ---------- 舵机内部：位置环 + 电流上限（模式 5，电流限制的位置控制） ----------
export const STALL = { torqueNm: 1.0, currentmA: 880 };       // XC330-T288 在 12 V 的堵转数据（e-Manual）
export const GEAR_RATIO = 288.35;                              // XC330-T288 的减速比
export const torqueNm = (mA) => STALL.torqueNm * mA / STALL.currentmA;          // 估算：扭矩大致和电流成正比
export const pullN = (mA, spoolRmm) => torqueNm(mA) / (spoolRmm / 1000);        // 线上拉力 = 扭矩 ÷ 线轴半径
// 准静态：目标位置 goal，路上 wall 处有东西挡着（null = 没有），东西的硬度 stiff（每格要多少 mA 才压得进去）
export function servoSettle({ start, goal, limitmA, wall = null, stiff = 2.0, idlemA = 25 }) {
  const dir = Math.sign(goal - start) || 1;
  const blocked = wall !== null && (wall - start) * dir >= 0 && (goal - wall) * dir > 0;
  if (!blocked) return { pos: goal, currentmA: idlemA, reached: true, pressed: 0 };
  const want = Math.abs(goal - wall);                         // 想压进去多少格
  const can = Math.max(0, (limitmA - idlemA) / stiff);        // 电流上限允许压进去多少格
  const pressed = Math.min(want, can);
  const cur = Math.min(limitmA, idlemA + pressed * stiff);
  return { pos: wall + dir * pressed, currentmA: Math.round(cur), reached: pressed >= want, pressed };
}

// ---------- 线轴和腱绳 ----------
const rad = (d) => d * Math.PI / 180;
export const tendonMm = (rMm, deg) => rMm * rad(deg);                       // 转过一个角度，圆周上走过多长的线
export const jointDegFromSpool = (rs, rj, spoolDeg) => spoolDeg * rs / rj;  // 线长守恒：rs × 舵机转角 = rj × 关节转角
export const ratio = (rs, rj) => rs / rj;
// 线绑在舵盘孔上（曲柄）时，沿线方向拉过来的长度。最多 2r，转过 180° 反而往回放。
export const crankPullMm = (rMm, deg) => rMm * (1 - Math.cos(rad(deg)));
// 回差：两根线一共松了 slackMm。线轴位置 x、关节位置 y（都换成线长 mm）。松的那一段里线轴转了，关节不动。
export function backlash(y, x, slackMm) {
  const h = slackMm / 2;
  if (x - y > h) return x - h;
  if (x - y < -h) return x + h;
  return y;
}
export const deadSpoolDeg = (slackMm, rs) => slackMm / rs * 180 / Math.PI;  // 换方向时线轴要空转多少度
// 预紧越大摩擦越大，空载电流越高。定性模型，数字只用来比大小。
export const idleCurrentmA = (pretensionN) => Math.round(25 + 9 * pretensionN);

// ---------- 时间账 ----------
export const syncWriteBytes = (n, dataLen = 4) => 14 + n * (1 + dataLen);
export const syncReadBytes = (n) => 14 + n;
export const statusBytes = (dataLen) => 11 + dataLen;
// 一轮 = 读一次所有舵机（位置 + 速度 + 电流共 10 字节）+ 写一次目标位置（4 字节）
export function busCycle({ n, baud, readLen = 10, writeLen = 4, returnDelayUs = 20 }) {
  const write = frameMs(syncWriteBytes(n, writeLen), baud);
  const read = frameMs(syncReadBytes(n), baud) + n * (frameMs(statusBytes(readLen), baud) + returnDelayUs / 1000);
  return { read, write, total: read + write };
}
// 左手 v2.0 的电机 ID（whj_MCU/docs/orca_core代码导读_左手v2.0.md）
export const JOINTS = [
  { id: 1, joint: 'wrist', name: '手腕', finger: 'wrist' },
  { id: 7, joint: 'index_abd', name: '食指 外展', finger: 'index' }, { id: 8, joint: 'index_mcp', name: '食指 MCP', finger: 'index' }, { id: 9, joint: 'index_pip', name: '食指 PIP', finger: 'index' },
  { id: 6, joint: 'middle_abd', name: '中指 外展', finger: 'middle' }, { id: 17, joint: 'middle_mcp', name: '中指 MCP', finger: 'middle' }, { id: 2, joint: 'middle_pip', name: '中指 PIP', finger: 'middle' },
  { id: 5, joint: 'ring_abd', name: '无名指 外展', finger: 'ring' }, { id: 4, joint: 'ring_mcp', name: '无名指 MCP', finger: 'ring' }, { id: 3, joint: 'ring_pip', name: '无名指 PIP', finger: 'ring' },
  { id: 14, joint: 'pinky_abd', name: '小指 外展', finger: 'pinky' }, { id: 15, joint: 'pinky_mcp', name: '小指 MCP', finger: 'pinky' }, { id: 16, joint: 'pinky_pip', name: '小指 PIP', finger: 'pinky' },
  { id: 10, joint: 'thumb_cmc', name: '拇指 CMC', finger: 'thumb' }, { id: 13, joint: 'thumb_abd', name: '拇指 外展', finger: 'thumb' }, { id: 12, joint: 'thumb_mcp', name: '拇指 MCP', finger: 'thumb' }, { id: 11, joint: 'thumb_dip', name: '拇指 DIP', finger: 'thumb' },
];
export const ALL_IDS = JOINTS.map((j) => j.id).sort((a, b) => a - b);
export const jointOf = (id) => JOINTS.find((j) => j.id === id);
// 六块 M7C 的分法（whj_MCU/docs/六块M7C方案调研.md）
export const BOARDS = [
  { name: 'M7C-1', what: '食指', ids: [7, 8, 9] },
  { name: 'M7C-2', what: '中指', ids: [6, 17, 2] },
  { name: 'M7C-3', what: '无名指', ids: [5, 4, 3] },
  { name: 'M7C-4', what: '小指', ids: [14, 15, 16] },
  { name: 'M7C-5', what: '拇指 3 个', ids: [13, 12, 11] },
  { name: 'M7C-6', what: '手腕 + 拇指 1 个', ids: [1, 10] },
];
export const boardOf = (id) => BOARDS.findIndex((b) => b.ids.includes(id));
export function multiBus({ baud, parallel, boards = BOARDS, returnDelayUs = 20 }) {
  const each = boards.map((b) => busCycle({ n: b.ids.length, baud, returnDelayUs }).total);
  const total = parallel ? Math.max(...each) : each.reduce((a, b) => a + b, 0);
  return { each, total };
}
export const hz = (ms) => 1000 / ms;
