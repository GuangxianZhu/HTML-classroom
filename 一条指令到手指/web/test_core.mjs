// 校验教学模型：node test_core.mjs
// 已知答案来自 whj_MCU 仓库（HANDOFF.md 的常用数据包、六块M7C方案调研.md 的时间账、路线图_腱绳手指.md 的算例）。
import assert from 'node:assert/strict';
import * as C from './src/core.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const H = (s) => s.trim().split(/\s+/).map((x) => parseInt(x, 16));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} 得到 ${a}，应该约 ${b}`);

t('ping 1 和仓库里的包一致', () => assert.deepEqual(C.pingPacket(1), H('FF FF FD 00 01 03 00 01 19 4E')));
t('Goal Position 2048 / 3072 / 1024 和仓库里的包一致', () => {
  assert.deepEqual(C.writePacket(1, 116, 4, 2048), H('FF FF FD 00 01 09 00 03 74 00 00 08 00 00 42 89'));
  assert.deepEqual(C.writePacket(1, 116, 4, 3072).slice(-6), H('00 0C 00 00 11 09'));
  assert.deepEqual(C.writePacket(1, 116, 4, 1024).slice(-6), H('00 04 00 00 B2 89'));
});
t('Torque 开 / 关', () => {
  assert.deepEqual(C.writePacket(1, 64, 1, 1), H('FF FF FD 00 01 06 00 03 40 00 01 DB 66'));
  assert.deepEqual(C.writePacket(2, 64, 1, 0), H('FF FF FD 00 02 06 00 03 40 00 00 EE E5'));
});
t('写入的正常应答', () => assert.deepEqual(C.statusPacket(1), H('FF FF FD 00 01 04 00 55 00 A1 0C')));
t('Sync Write 两个舵机', () => assert.deepEqual(C.syncWrite(116, 4, [[1, 1024], [2, 3072]]),
  H('FF FF FD 00 FE 11 00 83 74 00 04 00 01 00 04 00 00 02 00 0C 00 00 13 0C')));
t('Sync Read 两个当前位置', () => assert.deepEqual(C.syncRead(132, 4, [1, 2]), H('FF FF FD 00 FE 09 00 82 84 00 04 00 01 02 CE FA')));

t('拆段：每个字节正好属于一段', () => {
  for (const p of [C.writePacket(8, 116, 4, 2323), C.statusPacket(8), C.syncWrite(116, 4, [[7, 1], [8, 2]]), C.syncRead(132, 4, [7, 8, 9]), C.pingPacket(3)]) {
    const f = C.fields(p); let at = 0;
    for (const s of f) { assert.equal(s.from, at); at = s.to; }
    assert.equal(at, p.length);
  }
});
t('检查：改一个字节校验就对不上；少一个字节长度对不上', () => {
  const p = C.writePacket(8, 116, 4, 2323);
  assert.equal(C.check(p).ok, true);
  const bad = [...p]; bad[10] ^= 0x01;
  assert.equal(C.check(bad).why, 'crc');
  assert.equal(C.check(p.slice(0, -1)).why, 'length');
});
t('谁应答：点名的那个；广播写都执行都不答；Sync Read 列出的各答一次', () => {
  const ids = C.ALL_IDS;
  assert.deepEqual(C.whoReacts(C.writePacket(8, 116, 4, 2000), ids), { valid: true, act: [8], reply: [8] });
  assert.deepEqual(C.whoReacts(C.writePacket(30, 116, 4, 2000), ids).reply, []);
  const b = C.whoReacts(C.writePacket(C.BROADCAST, 64, 1, 0), ids);
  assert.equal(b.act.length, 17); assert.equal(b.reply.length, 0);
  assert.deepEqual(C.whoReacts(C.syncRead(132, 4, [7, 8, 9]), ids).reply, [7, 8, 9]);
  assert.deepEqual(C.whoReacts(C.syncWrite(116, 4, [[7, 1], [8, 2]]), ids), { valid: true, act: [7, 8], reply: [] });
  assert.equal(C.whoReacts(C.pingPacket(C.BROADCAST), ids).reply.length, 17);
});

t('UART：起始位 0、低位在前、停止位 1，能还原', () => {
  assert.deepEqual(C.uartBits(0x74), [0, 0, 0, 1, 0, 1, 1, 1, 0, 1]);
  for (const b of [0x00, 0xFF, 0xFD, 0x55, 0x08]) assert.equal(C.fromUartBits(C.uartBits(b)), b);
});
t('波特率：57600 一位约 17.4 µs，1 Mbps 一位 1 µs', () => {
  near(C.bitUs(57600), 17.36, 0.01); assert.equal(C.bitUs(1000000), 1);
  near(C.frameMs(16, 57600), 2.78, 0.01);
});

t('标定换算：两端对上，中间成比例，超出范围夹住', () => {
  const c = C.CAL_DEMO;
  assert.equal(C.jointToMotor(c, c.degMin), c.mMin);
  assert.equal(C.jointToMotor(c, c.degMax), c.mMax);
  assert.equal(C.jointToMotor(c, 200), c.mMax);
  near(C.motorToJoint(c, C.jointToMotor(c, 45)), 45, 0.1);
});

t('门限：3.3 V 在 5 V 芯片眼里不算高', () => {
  assert.equal(C.logicRead(3.3, 3.3), 1);
  assert.equal(C.logicRead(3.3, 5), null);
  assert.equal(C.logicRead(4.8, 5), 1);
});
t('TXB 弱输出：下拉 10k 只有约 3.5 V，100k 约 4.8 V（和实测 3.5 / 4.77 V 对得上）', () => {
  near(C.txbHigh(5, 10000), 3.57, 0.02);
  near(C.txbHigh(5, 100000), 4.81, 0.05);
  assert.equal(C.logicRead(C.txbHigh(5, 100000), 5), 1);
});

t('241：DIR=1 发送，DIR=0 接收，没人说话时线是高', () => {
  assert.deepEqual(C.gate241({ dir: 1, tx: 0 }), { txOn: true, rxOn: false, data: 0, fight: false, rx: 1 });
  assert.equal(C.gate241({ dir: 0, tx: 0, servo: 0 }).rx, 0);
  assert.equal(C.gate241({ dir: 0, tx: 0 }).data, 1);
  assert.equal(C.gate241({ dir: 1, tx: 1, servo: 0 }).fight, true);
});
t('TXEN：停止位里松手没事；太早截断；太晚盖掉应答', () => {
  const b = 57600;
  assert.equal(C.txenOutcome({ releaseUs: -10, returnDelayUs: 20, baud: b }).kind, 'ok');
  assert.equal(C.txenOutcome({ releaseUs: -60, returnDelayUs: 20, baud: b }).kind, 'cut');
  assert.equal(C.txenOutcome({ releaseUs: 15, returnDelayUs: 20, baud: b }).kind, 'ok');
  assert.equal(C.txenOutcome({ releaseUs: 100, returnDelayUs: 20, baud: b }).kind, 'late');
  assert.equal(C.txenOutcome({ releaseUs: 100, returnDelayUs: 500, baud: b }).kind, 'ok');
});

t('时间线：按时松手一问一答；松早了舵机不答；松晚了应答开头撞上', () => {
  const b = 57600, B = C.byteUs(b);
  const ok = C.txenTimeline({ releaseUs: 2, returnDelayUs: 500, baud: b });
  assert.deepEqual([C.txenAt(ok, -50), C.txenAt(ok, 100), C.txenAt(ok, 600), C.txenAt(ok, 500 + 11 * B + 1)], ['host', 'idle', 'servo', 'idle']);
  assert.equal(ok.lostCmdBytes + ok.lostReplyBytes, 0);
  const early = C.txenTimeline({ releaseUs: -Math.round(B), returnDelayUs: 500, baud: b });
  assert.equal(early.replies, false); assert.equal(early.lostCmdBytes, 1);
  assert.deepEqual([C.txenAt(early, -300), C.txenAt(early, -50), C.txenAt(early, 600)], ['host', 'cut', 'idle']);
  const late = C.txenTimeline({ releaseUs: 1000, returnDelayUs: 500, baud: b });
  assert.equal(late.lostReplyBytes, 3);
  assert.deepEqual([C.txenAt(late, 300), C.txenAt(late, 700), C.txenAt(late, 1100)], ['idle', 'clash', 'servo']);
  assert.equal(C.txenTimeline({ releaseUs: 100, returnDelayUs: 20, baud: b }).lostReplyBytes, 1);
  assert.equal(C.txenTimeline({ releaseUs: 100, returnDelayUs: 500, baud: b }).kind, 'ok');
});
t('电流限制：没东西挡就到位；有东西挡，电流停在上限，位置停在半路', () => {
  const free = C.servoSettle({ start: 2000, goal: 2600, limitmA: 60 });
  assert.equal(free.pos, 2600); assert.equal(free.reached, true);
  const hit = C.servoSettle({ start: 2000, goal: 2600, limitmA: 60, wall: 2300 });
  assert.equal(hit.reached, false); assert.equal(hit.currentmA, 60); assert.ok(hit.pos < 2600 && hit.pos >= 2300);
  const hard = C.servoSettle({ start: 2000, goal: 2600, limitmA: 300, wall: 2300 });
  assert.ok(hard.pos > hit.pos);
  const back = C.servoSettle({ start: 2600, goal: 2000, limitmA: 60, wall: 2300 });
  assert.equal(back.reached, false);
  assert.equal(C.servoSettle({ start: 2000, goal: 2200, limitmA: 60, wall: 2300 }).reached, true);
});
t('拉力估算：60 / 150 / 300 mA，线轴半径 10 mm 时约 7 / 17 / 34 N', () => {
  near(C.pullN(60, 10), 6.8, 0.3); near(C.pullN(150, 10), 17, 0.3); near(C.pullN(300, 10), 34, 0.3);
});

t('线长守恒：线轴 10 mm、关节 5 mm，舵机转 45° 关节转 90°，用线约 7.9 mm', () => {
  assert.equal(C.jointDegFromSpool(10, 5, 45), 90);
  near(C.tendonMm(5, 90), 7.85, 0.01);
  near(C.tendonMm(10, 45), C.tendonMm(5, 90), 1e-9);
});
t('舵盘孔是曲柄：最多拉 2r，过了 180° 往回走', () => {
  near(C.crankPullMm(10, 180), 20, 1e-9);
  assert.ok(C.crankPullMm(10, 270) < C.crankPullMm(10, 180));
});
t('回差：松 2 mm，换方向后线轴先空走 2 mm 关节才动', () => {
  let y = 0;
  y = C.backlash(y, 5, 2); assert.equal(y, 4);
  y = C.backlash(y, 4, 2); assert.equal(y, 4);      // 回头 1 mm：关节没动
  y = C.backlash(y, 3, 2); assert.equal(y, 4);      // 回头 2 mm：还没动
  y = C.backlash(y, 2, 2); assert.equal(y, 3);      // 再回头才动
  near(C.deadSpoolDeg(2, 10), 11.46, 0.01);
  assert.equal(C.backlash(0, 5, 0), 5);
});

t('时间账：和六块 M7C 调研里的表一致', () => {
  const a = C.busCycle({ n: 17, baud: 57600 });
  near(a.read, 67.7, 0.1, '17 个 57600 读'); near(a.write, 17.2, 0.1, '写'); near(a.total, 84.9, 0.1, '合计');
  const b = C.busCycle({ n: 3, baud: 57600 });
  near(b.read, 13.9, 0.1); near(b.write, 5.0, 0.1); near(b.total, 19.0, 0.1);
  const c = C.busCycle({ n: 17, baud: 1000000 });
  near(c.read, 4.2, 0.1); near(c.write, 1.0, 0.1); near(c.total, 5.2, 0.1);
});
t('六条总线：同时约 19 ms，轮流约 109 ms，比单总线 85 ms 还慢', () => {
  near(C.multiBus({ baud: 57600, parallel: true }).total, 19.0, 0.1);
  const seq = C.multiBus({ baud: 57600, parallel: false }).total;
  assert.ok(seq > 108 && seq < 115, '轮流 ' + seq);
  assert.ok(seq > C.busCycle({ n: 17, baud: 57600 }).total);
  near(C.multiBus({ baud: 1000000, parallel: true }).total, 1.2, 0.1);
});
t('分组：17 个 ID 各在一块板上，不重不漏', () => {
  const all = C.BOARDS.flatMap((b) => b.ids).sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 17 }, (_, i) => i + 1));
  assert.deepEqual(C.ALL_IDS, all);
  assert.equal(C.boardOf(8), 0); assert.equal(C.boardOf(1), 5);
});

console.log(`\n${n} 项全部通过`);
