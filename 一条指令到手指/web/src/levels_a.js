// 电脑这一头（全程地图、标定、数据包、UART、M7C 转发）
import * as C from './core.js';
import { $, $$, el, fmt, takeaway, basis, where, quiz, tasks, slider, seg, stats, bytesView, fieldKey, svg, wavePath, tween, rad, OUT, lv } from './ui.js';

export const GOAL_DEG = 45;
export const SIDE = [-1, 0.22, 0.75];        // 从侧面看手，食指往前弯才看得出来
export const GOAL_POS = C.jointToMotor(C.CAL_DEMO, GOAL_DEG);          // 2323
export const GOAL_PACKET = C.writePacket(8, C.ADDR.goalPos, 4, GOAL_POS);

// ---------- 全程地图 ----------
export function chMap(root, api) {
  const ST = [
    { t: '电脑：你写的那一行', form: '关节角度 45°', d: '程序里只有“食指根部弯到 45°”这个意思。', n: 0, focus: 'pc', hot: 'pc', lv: 'cal' },
    { t: '电脑：查标定表', form: `电机位置数 ${GOAL_POS}`, d: '舵机不认识角度，只认识 0 到 4095 的格数。', n: 0, focus: 'pc', hot: 'pc', lv: 'cal' },
    { t: '电脑：装进数据包', form: `${GOAL_PACKET.length} 个字节`, d: '加上给谁、写到哪、校验，像写信封。', n: 1, focus: 'pc', hot: 'pc', lv: 'packet' },
    { t: 'USB 线', form: '字节，走 USB', d: '电脑没有能直接接舵机的口，先经 USB 到 M7C 板。', n: 2, focus: ['pc', 'm7c'], hot: 'm7c', lv: 'bridge' },
    { t: 'M7C 板', form: '3.3 V 的高低电平', d: '把字节一位一位变成引脚上的高低电平发出去。', n: 3, focus: 'm7c', hot: 'm7c', lv: 'uart' },
    { t: '电平转换 TXB0104', form: '5 V 的高低电平', d: '后面的芯片和舵机用 5 V，3.3 V 的“高”它们认不稳。', n: 5, focus: ['m7c', 'txb'], hot: 'txb', lv: 'level' },
    { t: '合线 241', form: '一根 DATA 线', d: '发和收两根线，合成舵机用的一根。', n: 7, focus: ['txb', 'g241'], hot: 'g241', lv: 'duplex' },
    { t: '舵机总线', form: '17 个舵机都听到，8 号认领', d: '所有舵机并在同一根线上，只有 ID 对上的那个执行。', n: 11, focus: ['phb', 'tower'], hot: 'tower', lv: 'bus' },
    { t: '8 号舵机内部', form: '电流 → 电机转 → 齿轮减速', d: '舵机自己比较“目标”和“现在”，推着电机转过去。', n: 11, focus: 'tower', hot: 'tower', lv: 'servo' },
    { t: '线轴和腱绳', form: '线长 → 关节角 45°', d: '线轴卷进一段线，手指关节被拉弯。', n: 11, focus: ['tower', 'hand'], hot: 'hand', lv: 'tendon' },
  ];
  let cur = 0, t = 0, bend = 0, stop = () => {};
  const frac = (n) => (api.stage ? api.stage.frac(OUT, n) : n / OUT.length);
  root.append(el(`<div class="panel">
    <p>你在电脑上敲下这一行，回车：</p>
    <pre>hand.set_joint_positions({"index_mcp": 45})</pre>
    <p>大约半秒以后，桌上那只手的食指根部弯到了 45°。中间隔着一根 USB 线、一块小板子、两颗芯片、一排舵机和几根线。这门课跟着这一条指令走一遍，每一关只走一站。</p>
    <div id="q1"></div></div>`));
  quiz($('#q1', root), {
    q: '从按下回车到手指弯到位，时间主要花在哪里？',
    options: [
      { t: 'A　电信号在导线里跑', why: '导线里的信号一米只要几纳秒，桌上这点距离可以当成零。' },
      { t: 'B　把字节一位一位发出去', why: '这一段是毫秒级：16 个字节在 57600 下约 2.8 ms。比 A 慢得多，但还不是最大头。' },
      { t: 'C　电机带着齿轮和手指转过去', ok: true, why: '机械运动要几百毫秒，比前面所有电的环节加起来都长一两个数量级。所以后面你会看到：通信要“够快、不出错”，手感主要由舵机和腱绳决定。' },
    ],
  });
  const panel = el(`<div class="panel"><p>下面是这条指令要过的十站。点“下一站”让光点往前走，也可以直接点某一站，或者点模型上的零件。注意中间那一列：同一个意思，一路换了好几种形态。</p>
    <ol class="stations" id="stList"></ol>
    <div class="ops"><button id="prev">上一站</button><button id="next" class="primary">下一站</button></div></div>`);
  root.append(panel);
  ST.forEach((s, i) => {
    const li = el(`<li><span class="no">${i + 1}</span><div><div class="t">${s.t}</div><div class="form">→ ${s.form}</div><div class="d">${s.d}　<span class="sub">（${lv(s.lv)}）</span></div></div></li>`);
    li.addEventListener('click', () => goSt(i));
    $('#stList', root).append(li);
  });
  root.append(el(`<div class="panel">${takeaway('同一个意思“食指弯 45°”，一路变成：角度 → 一个数 → 一串字节 → 高低电平 → 电流和转角 → 线长和关节角。每一站只做一件事：换一种形态，交给下一站。出了问题，也是一站一站查。')}
    ${basis([['公认', '导线里信号的速度约为光速的一半到三分之二，一米几纳秒。'], ['算出来的', '16 字节 × 10 位 ÷ 57600 ≈ 2.8 ms。'], ['估算', '“几百毫秒”取决于你给舵机设的速度和要转的角度，这里只说量级。']])}</div>`));
  function paint() {
    $$('#stList li', root).forEach((li, i) => { li.classList.toggle('on', i === cur); li.classList.toggle('past', i < cur); });
    $('#prev', root).disabled = cur === 0; $('#next', root).disabled = cur === ST.length - 1;
    api.sync();
  }
  function goSt(i) {
    stop(); const from = t, to = frac(ST[i].n), b0 = bend, b1 = i === ST.length - 1 ? 1 : 0;
    cur = i; paint();
    stop = tween(0, 1, 600, (k) => { t = from + (to - from) * k; bend = b0 + (b1 - b0) * k; api.sync(); });
  }
  $('#prev', root).addEventListener('click', () => goSt(Math.max(0, cur - 1)));
  $('#next', root).addEventListener('click', () => goSt(Math.min(ST.length - 1, cur + 1)));
  paint();
  return {
    pick(k) { const i = ST.findIndex((s) => s.hot === k); if (i >= 0) goSt(k === 'tower' && cur === 7 ? 8 : i); },
    view: () => {
      const s = ST[cur];
      return { scene: 'desk', focus: cur === 0 && t === 0 ? 'all' : s.focus, dir: cur === 9 ? SIDE : null, hot: [s.hot], flow: { route: OUT, t, size: 1.2 },
        servos: cur >= 7 ? Object.fromEntries(C.ALL_IDS.map((id) => [id, id === 8 ? 'H' : cur === 7 ? 'L' : null]).filter((x) => x[1])) : {},
        spools: { 8: -bend * 0.9 }, tendon8: cur === 9, fingers: { index: [rad(GOAL_DEG) * bend, 0, 0] },
        info: `第 ${cur + 1} 站：${s.t}　→　${s.form}` };
    },
  };
}

// ---------- 角度变成电机位置数 ----------
export function chCal(root, api) {
  const cal = C.CAL_DEMO;
  let deg = 0, got = { min: false, max: false }, stop = () => {};
  root.append(el(`<div class="panel">${where('电脑里，orca_core 把关节角度换成舵机认识的数。')}
    <p>舵机不认识“45°”，也不认识“食指”。它只认识一个 0 到 4095 的数：输出轴转一圈分成 4096 格，一格约 ${C.stepDeg.toFixed(3)}°。所以第一步，电脑得把“关节 45°”换成“电机转到第几格”。</p>
    <div id="q"></div></div>`));
  quiz($('#q', root), {
    q: '关节要 45°。能不能直接算 45 ÷ 0.088 ≈ 512，就发 512？',
    options: [
      { t: 'A　能，角度换成格数就行', why: '这只算了“45° 是多少格”，没回答两个问题：关节 0° 的时候电机停在哪一格？关节转 1°，电机要转几格？中间隔着线轴和腱绳，这两个数每只手都不一样。' },
      { t: 'B　不能，还得先知道这只手的两个数', ok: true, why: '要知道“关节在某个已知角度时，电机在哪一格”和“关节每转 1°，电机转几格”。腱绳怎么绕、线轴装的时候转到哪，都会改变它们。测出这两个数的过程叫标定。' },
    ],
  });
  const p = el(`<div class="panel"><p>标定的办法很直接：让关节慢慢走到两头的机械极限（撞到头就停），各记一次电机的位置数。两个点连成一条直线，中间的角度按比例换算。先把两个极限都撞一次。</p>
    <div class="ops"><button id="bMin">撞伸直那头（${cal.degMin}°）</button><button id="bMax">撞弯曲那头（${cal.degMax}°）</button></div>
    <div class="fig" id="plot"></div>
    <div id="sl"></div><div id="st"></div><pre id="formula"></pre><div id="tk"></div></div>`);
  root.append(p);
  const done = tasks($('#tk', p), ['两个极限各撞一次', '把关节拖到 45°，读出要发给舵机的数']);
  const setStats = stats($('#st', p));
  const sl = slider($('#sl', p), { label: '关节角度', min: cal.degMin, max: cal.degMax, step: 1, value: 0, show: (v) => v + '°', onInput: (v) => { deg = v; render(); } });
  function moveTo(target, key) {
    stop(); const from = deg;
    stop = tween(from, target, 900, (v) => { deg = v; sl.set(Math.round(v)); render(); }, () => { got[key] = true; render(); });
  }
  $('#bMin', p).addEventListener('click', () => moveTo(cal.degMin, 'min'));
  $('#bMax', p).addEventListener('click', () => moveTo(cal.degMax, 'max'));
  function render() {
    const both = got.min && got.max, m = C.jointToMotor(cal, deg), rho = C.stepsPerDeg(cal);
    sl.input.disabled = !both;
    if (both) done(0);
    if (both && Math.round(deg) === 45) done(1);
    const X = (d) => 50 + (d - cal.degMin) / (cal.degMax - cal.degMin) * 300, Y = (mm) => 150 - (mm - 1500) / (3400 - 1500) * 130;
    $('#plot', p).innerHTML = svg(380, 185, `
      <line class="axis" x1="50" y1="150" x2="360" y2="150"/><line class="axis" x1="50" y1="14" x2="50" y2="150"/>
      <text x="205" y="180" text-anchor="middle">关节角度（度）</text><text x="12" y="16">电机位置数</text>
      <text x="50" y="165" text-anchor="middle">${cal.degMin}</text><text x="350" y="165" text-anchor="middle">${cal.degMax}</text>
      ${both ? `<line class="wave w-ac" x1="${X(cal.degMin)}" y1="${Y(cal.mMin)}" x2="${X(cal.degMax)}" y2="${Y(cal.mMax)}"/>` : ''}
      ${got.min ? `<circle class="f-lo" cx="${X(cal.degMin)}" cy="${Y(cal.mMin)}" r="5"/><text class="mono ink" x="${X(cal.degMin) + 8}" y="${Y(cal.mMin) - 6}">${cal.mMin}</text>` : ''}
      ${got.max ? `<circle class="f-hi" cx="${X(cal.degMax)}" cy="${Y(cal.mMax)}" r="5"/><text class="mono ink" x="${X(cal.degMax) - 8}" y="${Y(cal.mMax) - 8}" text-anchor="end">${cal.mMax}</text>` : ''}
      ${both ? `<line class="axis" x1="${X(deg)}" y1="${Y(m)}" x2="${X(deg)}" y2="150" stroke-dasharray="3 3"/><circle class="f-ac" cx="${X(deg)}" cy="${Y(m)}" r="6"/><text class="mono ink b" x="${X(deg) + 9}" y="${Y(m) + 16}">${m}</text>` : ''}
    `, '关节角度和电机位置数的直线关系');
    setStats(both ? [{ k: '关节角度', v: Math.round(deg) + '°' }, { k: '要发给舵机的数', v: m, cls: 'hi' }, { k: '关节每转 1°', v: fmt(rho, 2) + ' 格' }]
      : [{ k: '伸直那头', v: got.min ? cal.mMin : '还没测' }, { k: '弯曲那头', v: got.max ? cal.mMax : '还没测' }]);
    $('#formula', p).textContent = both
      ? `位置数 = 伸直那头的数 + 每度几格 × (角度 − 伸直那头的角度)\n       = ${cal.mMin} + (${fmt(rho, 2)}) × (${Math.round(deg)} − (${cal.degMin}))\n       = ${m}`
      : '两个极限都测到以后，这里会出现换算式。';
    api.sync();
  }
  root.append(el(`<div class="panel">${takeaway('标定就是找两个点、连一条线。之后任何角度都按比例换成电机位置数。这个例子里，45° 换出来是 <b style="display:inline;color:inherit;font-size:inherit;letter-spacing:0">' + GOAL_POS + '</b>，后面几关一直用它。')}
    <p>为什么数越弯越小：左手的 8 号舵机，弯曲时是顺时针转，位置数往小走。方向每个关节不一样，写在配置文件的映射表里。</p>
    <p><b>什么时候要重新标定：</b>腱绳重新装过、预紧调过，两个极限对应的电机位置就变了，要重标。只是把 U2D2 换成 M7C、换 USB 口，标定结果不用动。</p>
    <p><b>这条直线什么时候不准：</b>它假设“电机转多少，关节就跟着转多少”。线松了会有一段空转（${lv('pretension')}），线被拉长、在线轴上打滑，也会偏。</p>
    ${basis([['手册', '一圈 4096 格、一格 0.088° 是 DYNAMIXEL X 系列的规格。'], ['仓库', '撞两头限位、按比例换算，是 orca_core 标定的做法（whj_MCU 的 ORCA软件调研.md）；8 号弯曲时顺时针，来自左手 v2.0 的映射表。'], ['示例数字', `${cal.mMin}、${cal.mMax} 和 ${cal.degMin}°～${cal.degMax}° 是为了演示编的。你那只手的真实数值在 calibration.yaml 里。`]])}</div>`));
  render();
  return { view: () => ({ scene: 'finger', zoom: 1.25, jointDeg: deg, spoolDeg: deg * 0.5, hot: ['joint'], info: got.min && got.max ? `关节 ${Math.round(deg)}°　↔　电机位置 ${C.jointToMotor(cal, deg)}` : '先撞两头的极限' }) };
}

// ---------- 数装进数据包 ----------
export function chPacket(root, api) {
  let id = 8, value = GOAL_POS, sel = 'data', selByte = -1, broken = -1, seen = new Set();
  root.append(el(`<div class="panel">${where('还在电脑里。手里有两个数：给 8 号舵机、位置 ' + GOAL_POS + '。')}
    <p>要把这两个数通过一根线送过去，得先装进一个“信封”，这个信封叫数据包。舵机收到一串字节，要能分清：从哪开始、给谁的、多长、要干什么、有没有在路上坏掉。</p>
    <div id="q"></div></div>`));
  quiz($('#q', root), {
    q: `${GOAL_POS} 写成十六进制是 0x0913，占两个字节：09 和 13。在包里，这两个字节谁在前？`,
    options: [
      { t: 'A　09 在前，13 在后（和写出来的顺序一样）', why: '这套协议规定低字节在前。发的人和收的人只要约定一致就行，但约定是“低位先走”。' },
      { t: 'B　13 在前，09 在后（低字节在前）', ok: true, why: '协议规定多字节的数都是低字节在前。所以包里你会看到 13 09 00 00：四个字节的位置数，从低到高排。看别人抓的包时最容易在这里读反。' },
    ],
  });
  const p = el(`<div class="panel"><p>下面是这一包的每一个字节。点任意一个字节，看它属于哪一段、管什么。</p>
    ${fieldKey()}<div id="by"></div><div class="fieldinfo" id="fi"></div>
    <div id="idSeg"></div><div id="vs"></div><pre id="hexline"></pre>
    <div class="ops"><button id="brk">把选中的字节弄坏一位</button><button id="fix">修好</button></div>
    <div class="readout" id="chk"><span class="sub">舵机收到以后的检查</span><span class="big"></span><p></p></div><div id="tk"></div></div>`);
  root.append(p);
  const done = tasks($('#tk', p), ['点过四段以上，知道每段管什么', '把位置改成 2048，看“数值”那四个字节变成 00 08 00 00', '弄坏一个字节，看舵机怎么处理']);
  const draw = bytesView($('#by', p), { onByte: (i, f) => { selByte = i; sel = f ? f.key : null; if (f) seen.add(f.key); render(); } });
  seg($('#idSeg', p), { label: '给哪个舵机', value: 8, options: [[8, '8 食指 MCP'], [7, '7 食指外展'], [12, '12 拇指 MCP'], [1, '1 手腕'], [254, '254 广播']], onChange: (v) => { id = +v; broken = -1; render(); } });
  const vs = slider($('#vs', p), { label: '目标位置', min: 0, max: 4095, step: 1, value, show: (v) => `${v}（0x${v.toString(16).toUpperCase().padStart(4, '0')}）`, onInput: (v) => { value = v; broken = -1; render(); } });
  $('#brk', p).addEventListener('click', () => { if (selByte >= 0) { broken = selByte; render(); } });
  $('#fix', p).addEventListener('click', () => { broken = -1; render(); });
  void vs;
  function render() {
    const good = C.writePacket(id, C.ADDR.goalPos, 4, value), b = [...good];
    if (broken >= 0 && broken < b.length) b[broken] ^= 0x04;
    const f = draw(b, { sel, broken: broken >= 0 ? [broken] : [] });
    const cur = f.find((x) => x.key === sel);
    $('#fi', p).innerHTML = cur ? `<b>${cur.name}：${C.hexs(cur.bytes)}</b>${cur.note}` : '点上面的字节。';
    const h = value.toString(16).toUpperCase().padStart(8, '0');
    $('#hexline', p).textContent = `${value} = 0x${h}\n拆成四个字节：${h.match(/../g).join(' ')}\n低字节在前：  ${C.hexs(C.le(value, 4))}`;
    const c = C.check(b), box = $('#chk', p);
    box.className = 'readout ' + (c.ok ? 'ok' : 'bad');
    $('.big', box).textContent = c.ok ? '校验对上了，收下' : c.why === 'header' ? '包头不对，当成噪声' : c.why === 'crc' ? '校验对不上，整包丢掉' : '长度不对，丢掉';
    $('p', box).textContent = c.ok ? `这一包共 ${b.length} 个字节。舵机把前 ${b.length - 2} 个字节重新算一遍校验，和最后两个字节一样，才会执行。`
      : c.why === 'header' ? '舵机靠 FF FF FD 00 找一包的开头。开头坏了，它根本不知道有一包来过。'
        : '舵机自己算出来的校验和包尾的两个字节不一样，说明路上坏了。它不会去猜哪一位错了，直接整包不要，也不应答。电脑那边等不到应答，就知道这次没成。';
    if (seen.size >= 4) done(0);
    if (value === 2048) done(1);
    if (broken >= 0) done(2);
    api.sync();
  }
  root.append(el(`<div class="panel">${takeaway('一包 = 包头 + 给谁 + 多长 + 干什么 + 写到哪个格子 + 写什么 + 校验。舵机里面也有一排带编号的格子（叫控制表），116 号格子是“目标位置”。往格子里写数，硬件就跟着变，这和 GPIO 那一课的寄存器是同一个思路。')}
    <p><b>这里做了一个简化：</b>真正的 orca_core 不是一个舵机发一包，而是把 17 个舵机的目标装进同一包（Sync Write）。先用最简单的单个 Write 看清结构，${lv('timing')}再看 17 个的。</p>
    ${basis([['手册', '包的格式、低字节在前、CRC 的算法，都是 DYNAMIXEL Protocol 2.0 的规定。'], ['校验过', '页面里的组包函数用 whj_MCU 仓库 HANDOFF.md 里的 6 个已知数据包对过，逐字节一致。']])}</div>`));
  render();
  return { view: () => ({ scene: 'desk', focus: 'pc', hot: ['pc'], zoom: 1, info: `电脑里组好的包：${C.hexs(C.writePacket(id, 116, 4, value))}` }) };
}

// ---------- 字节变成高低电平 ----------
export function chUart(root, api) {
  const pkt = GOAL_PACKET;
  let idx = 8, baud = 57600, rx = 1, play = -1, timer = 0;
  root.append(el(`<div class="panel">${where('M7C 板的串口引脚上。16 个字节要变成一根线上的高和低。')}
    <p>一根线一个时刻只能是高或者低，一次只能表示一位。所以做法是排队：一位一位发，每一位占同样长的一小段时间。这种发法叫 UART，也就是常说的“串口”。</p>
    <div id="q"></div></div>`));
  quiz($('#q', root), {
    q: '发的人和收的人之间只有一根数据线，没有另外的线告诉对方“现在是下一位了”。收的人怎么知道一位有多长？',
    options: [
      { t: 'A　信号里自己带着，收的人能看出来', why: '连着几个 1 的时候，线上就是一段平的高电平，中间没有任何记号。光看波形分不出那是 3 个 1 还是 4 个 1。' },
      { t: 'B　双方事先约好同一个速度', ok: true, why: '这个约好的速度就是波特率：每秒多少位。57600 就是每秒 57600 位，一位约 17.4 µs。收的人看到线从高变低（起始位），就按约好的节拍每隔一位的时间看一次。两边约得不一样，读出来就是乱码。' },
    ],
  });
  const p = el(`<div class="panel"><p>先选包里的一个字节，看它在线上长什么样。空闲时线是高的；先发一个低的起始位，再发 8 个数据位（<b>最低位先发</b>），最后一个高的停止位。</p>
    <div id="by"></div><div class="fig" id="wave"></div>
    <div class="ops"><button id="play">一位一位播放</button></div>
    <div id="bd"></div><div id="rxs"></div><div id="st"></div><div id="tk"></div></div>`);
  root.append(p);
  const done = tasks($('#tk', p), ['选 0x74，对着波形从左到右读出 0 0 1 0 1 1 1 0', '把波特率换成 1 Mbps，看整包时间', '让收的人用错波特率，看读成什么']);
  const draw = bytesView($('#by', p), { onByte: (i) => { idx = i; render(); } });
  seg($('#bd', p), { label: '发的人的波特率', value: 57600, options: [[57600, '57600'], [1000000, '1 Mbps']], onChange: (v) => { baud = +v; render(); } });
  seg($('#rxs', p), { label: '收的人用的波特率', value: 1, options: [[1, '和发的人一样'], [2, '慢一半'], [0.5, '快一倍']], onChange: (v) => { rx = +v; render(); } });
  const setStats = stats($('#st', p));
  $('#play', p).addEventListener('click', () => {
    clearInterval(timer); play = 0; render();
    timer = setInterval(() => { play++; if (play > 9) { clearInterval(timer); play = -1; } render(); }, 450);
  });
  function render() {
    const b = pkt[idx], bits = C.uartBits(b);
    const slots = Math.max(12, Math.ceil(9.5 * rx) + 3), bw = 330 / slots, x0 = 36;
    const lv = [1, ...bits, ...Array(slots - 11).fill(1)];
    const names = ['空闲', '起始', ...Array.from({ length: 8 }, (_, i) => '位' + i), '停止'];
    const at = (tau) => (tau < 0 ? 1 : tau < 10 ? bits[Math.floor(tau)] : 1);          // 发的人在某一时刻的电平（单位：发的人的一位）
    const samples = Array.from({ length: 8 }, (_, i) => (1.5 + i) * rx), stopT = 9.5 * rx;
    const read = samples.reduce((a, tau, i) => a | (at(tau) << i), 0), stopOk = at(stopT) === 1;
    draw(pkt, { selByte: idx });
    $('#wave', p).innerHTML = svg(380, 150, `
      <text x="4" y="34">高</text><text x="4" y="84">低</text>
      ${play >= 0 ? `<rect class="f-soft" x="${x0 + (play + 1) * bw}" y="14" width="${bw}" height="84"/>` : ''}
      <path class="wave" d="${wavePath(lv, x0, 30, 80, bw)}"/>
      ${lv.map((v, i) => (i < 11 ? `<text class="mono ${i > 1 && i < 10 ? 'ink b' : ''}" x="${x0 + (i + 0.5) * bw}" y="${v ? 24 : 96}" text-anchor="middle">${v}</text><text x="${x0 + (i + 0.5) * bw}" y="114" text-anchor="middle" style="font-size:${bw < 22 ? 9 : 11}px">${names[i]}</text>` : '')).join('')}
      ${samples.map((tau) => `<path class="${rx === 1 ? 'f-ok' : 'f-bad'}" d="M${x0 + (1 + tau) * bw} 126 l-4 9 h8 z"/>`).join('')}
      <path class="${stopOk ? 'f-mu' : 'f-bad'}" d="M${x0 + (1 + stopT) * bw} 126 l-4 9 h8 z"/>
      <text x="${x0}" y="147">▲ 收的人在这些时刻看一眼线上的电平</text>`, '一个字节的波形');
    const bad = read !== b || !stopOk;
    setStats([{ k: '发的字节', v: '0x' + C.hex2(b) }, { k: '一位多长', v: fmt(C.bitUs(baud), baud > 100000 ? 0 : 1) + ' µs' },
      { k: '整包 16 字节', v: fmt(C.frameMs(pkt.length, baud), 2) + ' ms' },
      { k: '收的人读成', v: '0x' + C.hex2(read) + (stopOk ? '' : '（停止位也不对）'), cls: bad ? 'bad' : 'ok' }]);
    if (idx === 8) done(0);
    if (baud === 1000000) done(1);
    if (rx !== 1) done(2);
    api.sync();
  }
  root.append(el(`<div class="panel">${takeaway('一个字节在线上是 10 位：1 个起始位 + 8 个数据位（低位先发）+ 1 个停止位。波特率是每秒多少位，收发两边必须一样。')}
    <p><b>仓库里对应的坑：</b>M7C 板的 USB 虚拟串口不管电脑软件设了多少波特率，真正决定舵机那一侧速度的是固件里串口的设置。orca_core 默认会自动探测波特率，在这块板上可能误判成 1 Mbps，而固件其实是 57600，结果每次读都超时。所以配置文件里要把波特率写死。</p>
    <p><b>为什么收的人在每一位的正中间看：</b>两边的时钟总有一点点误差，在中间看，前后各有半位的余量。一个字节 10 位，误差累计不能超过半位，所以两边的速度大约差 5% 以内才行；差一倍肯定读错。</p>
    ${basis([['公认', '起始位、低位先发、停止位、在位中间采样，是 UART 的通用做法。'], ['仓库', '自动探测误判这一条来自 whj_MCU 的 换M7C_一页纸.md，是读 orca_core 源码得出的隐患。后来换 M7C 成功了，但过程中具体改了什么，仓库里没有记录。'], ['简化', '这里只看单个字节。真实情况下字节一个接一个，收错一位后面会跟着全错。“5% 以内”是粗略的数。']])}</div>`));
  render();
  return {
    leave() { clearInterval(timer); play = -1; },
    view: () => {
      const bits = C.uartBits(pkt[idx]), lv = play >= 0 ? (bits[play] ? 'H' : 'L') : 'A';
      return { scene: 'desk', focus: ['m7c', 'txb'], hot: ['m7c'], wires: { WIRE_tx: lv },
        info: play >= 0 ? `TX 线现在是${bits[play] ? '高' : '低'}：${play === 0 ? '起始位' : play === 9 ? '停止位' : '位' + (play - 1)}` : 'M7C 的 TX 引脚把字节一位一位送上这根线' };
    },
  };
}

// ---------- M7C 转发 ----------
export function chBridge(root, api) {
  const N = GOAL_PACKET.length;
  let mode = 'pass', step = 0, bad = false, timer = 0;
  const badSeen = new Set();
  root.append(el(`<div class="panel">${where('M7C 板。一头接电脑，一头接舵机。')}
    <p>电脑只有 USB，舵机只认串口的高低电平。M7C 板夹在中间当搬运工：电脑来的字节经板上的 USB 转串口进到它的一个串口（UART5），它再从另一个串口（UART2）发给舵机。舵机的应答反过来走一遍。</p>
    <div id="q"></div></div>`));
  quiz($('#q', root), {
    q: 'M7C 上的转发程序，需要看懂数据包的内容吗？',
    options: [
      { t: 'A　需要，不然不知道要发给哪个舵机', why: '“发给谁”写在包里，是舵机自己看的。所有舵机接在同一根线上，M7C 只管把字节送上线，不用替它们分拣。' },
      { t: 'B　不需要，把字节原样搬过去就行', ok: true, why: '这叫透传。你现在板子上跑的固件就是这样：UART5 收到什么，UART2 就发什么。它只额外管一件事：自己在发的时候，把“我在说话”那根线（TXEN）拉高。' + lv('duplex') + '和' + lv('txen') + '讲这根线。' },
    ],
  });
  const p = el(`<div class="panel"><p>两种转发办法都能用，各有代价。点“下一步”看字节怎么过板子。</p>
    <div id="md"></div><div id="bd"></div>
    <div class="fig" id="fig"></div>
    <div class="ops"><button id="nx" class="primary">下一步</button><button id="auto">自动走完</button><button id="rs">重来</button></div>
    <div id="st"></div><div class="readout" id="say"><span class="sub">现在发生了什么</span><p></p></div><div id="tk"></div></div>`);
  root.append(p);
  const done = tasks($('#tk', p), ['透传走完一包', '按包转发走完一包，对比第一个字节什么时候上线', '让一个字节在路上坏掉，两种办法各试一次']);
  seg($('#md', p), { label: '转发办法', value: 'pass', options: [['pass', '透传：来一个发一个'], ['pkt', '按包：收齐一包再发']], onChange: (v) => { mode = v; reset(); } });
  seg($('#bd', p), { label: '路上', value: 'ok', options: [['ok', '一切正常'], ['bad', '有一个字节坏了']], onChange: (v) => { bad = v === 'bad'; reset(); } });
  const setStats = stats($('#st', p));
  const total = () => (mode === 'pass' ? N : (bad ? N + 1 : 2 * N + 1));
  const S = () => {                                  // 当前这一步：电脑还剩几个、板子里攒着几个、已经上线几个
    if (mode === 'pass') return { pc: N - step, buf: 0, sent: step, txen: step > 0 && step < N ? 1 : 0, drop: false, checked: false };
    const inb = Math.min(step, N), checked = step > N, drop = checked && bad, sent = drop ? 0 : Math.max(0, step - N - 1);
    return { pc: N - inb, buf: checked ? (drop ? 0 : N - sent) : inb, sent, txen: !drop && sent > 0 && sent < N ? 1 : 0, drop, checked };
  };
  function reset() { clearInterval(timer); step = 0; render(); }
  $('#nx', p).addEventListener('click', () => { if (step < total()) step++; render(); });
  $('#rs', p).addEventListener('click', reset);
  $('#auto', p).addEventListener('click', () => { clearInterval(timer); timer = setInterval(() => { if (step < total()) { step++; render(); } else clearInterval(timer); }, 160); });
  const cells = (n, x, y, cls, max = N) => Array.from({ length: max }, (_, i) => `<rect x="${x + (i % 8) * 11}" y="${y + Math.floor(i / 8) * 11}" width="9" height="9" rx="2" class="${i < n ? cls : 'f-soft'}"/>`).join('');
  function render() {
    const s = S();
    $('#fig', p).innerHTML = svg(380, 150, `
      <rect class="box" x="4" y="30" width="100" height="70" rx="8"/><text class="ink b" x="54" y="24" text-anchor="middle">电脑</text>
      ${cells(s.pc, 10, 52, 'f-ac')}
      <text x="54" y="92" text-anchor="middle">还没发的字节</text>
      <line class="line ${s.pc < N && s.pc > 0 ? 'H' : ''}" x1="104" y1="65" x2="132" y2="65"/><text x="118" y="58" text-anchor="middle">USB</text>
      <rect class="box on" x="132" y="14" width="118" height="104" rx="8"/><text class="ink b" x="191" y="32" text-anchor="middle">M7C</text>
      <text x="138" y="50">UART5</text><text x="244" y="50" text-anchor="end">UART2</text>
      ${mode === 'pkt' ? cells(s.buf, 147, 58, s.drop ? 'f-bad' : 'f-hi') + `<text x="191" y="94" text-anchor="middle">${s.drop ? '校验不过，扔掉' : s.checked ? '校验通过，开始发' : '先攒着'}</text>` : '<text x="191" y="78" text-anchor="middle">来一个，发一个</text>'}
      <text class="mono b ${s.txen ? 'f-hi' : 'f-lo'}" x="191" y="112" text-anchor="middle">TXEN = ${s.txen}</text>
      <line class="line ${s.txen ? 'H' : ''}" x1="250" y1="65" x2="278" y2="65"/><text x="264" y="58" text-anchor="middle">TX</text>
      <rect class="box" x="278" y="30" width="100" height="70" rx="8"/><text class="ink b" x="328" y="24" text-anchor="middle">去舵机的线</text>
      ${cells(s.sent, 284, 52, bad ? 'f-bad' : 'f-ok')}
      <text x="328" y="92" text-anchor="middle">已经上线的字节</text>
      <text x="6" y="140">每个小方块是一个字节，一包共 ${N} 个。</text>`, 'M7C 转发示意');
    const first = mode === 'pass' ? '第 1 个字节一到就上线' : `要等 ${N} 个字节到齐，晚约 ${fmt(C.frameMs(N, 57600), 1)} ms（57600 时）`;
    setStats([{ k: '电脑还剩', v: s.pc }, { k: '板子里攒着', v: s.buf }, { k: '已经上线', v: s.sent, cls: s.sent ? (bad ? 'bad' : 'ok') : '' }, { k: '第一个字节', v: first }]);
    const fin = step >= total();
    $('#say p', p).textContent = mode === 'pass'
      ? (step === 0 ? '还没开始。' : !fin ? '板子收到一个字节，马上从另一个串口发出去。它不知道这是包的第几个字节，也不知道包什么时候结束。'
        : bad ? '坏字节也原样上了线。舵机收到后自己算校验，对不上，整包不要、不应答。透传的板子对此一无所知，但结果是安全的。'
          : '16 个字节都上线了。最后一个字节发完，板子靠“发送完成”这个标志把 TXEN 放回 0。')
      : (step <= N && !fin ? '板子先把字节收进来攒着，一个都不往外发。' : s.drop ? '收齐了，板子自己算了一遍校验，对不上，整包扔掉。舵机那一侧的线上什么都没出现。'
        : !fin ? '收齐、校验通过，现在整包连着发出去。板子确切知道哪个是最后一个字节，TXEN 可以切得很准。' : '整包发完，TXEN 回到 0。');
    if (fin && mode === 'pass' && !bad) done(0);
    if (fin && mode === 'pkt' && !bad) done(1);
    if (fin && bad) { badSeen.add(mode); if (badSeen.size === 2) done(2); }
    api.sync();
  }
  root.append(el(`<div class="panel">
    <div class="scroll"><table><tr><th></th><th>透传（你板子上现在跑的）</th><th>按包转发（仓库 firmware/bridge 里的设计）</th></tr>
      <tr><td>程序</td><td>很短，不用懂协议</td><td>要认包头、读长度、算校验、排队</td></tr>
      <tr><td>多出来的延迟</td><td>几乎没有</td><td>多一整包的时间</td></tr>
      <tr><td>知道包在哪结束吗</td><td>不知道，TXEN 靠“发送完成”标志</td><td>知道，TXEN 切得准</td></tr>
      <tr><td>坏包</td><td>照发，舵机自己丢</td><td>板子直接丢，不上线</td></tr>
      <tr><td>以后板子自己发指令（接传感器）</td><td>要另外加逻辑</td><td>现成：多一个“指令来源”排进同一个队列</td></tr></table></div>
    ${takeaway('M7C 做的事：在两个串口之间搬字节，自己在发的时候把 TXEN 拉高。它不改内容，所以电脑上的软件感觉不到它，能用它代替 U2D2。')}
    <p><b>怎么选：</b>只是让电脑控制手，透传最省事，也是成品转接器的主流做法。等到想让板子自己根据传感器发指令，按包转发的结构才值得。</p>
    ${basis([['仓库实测', '透传固件（UART5 ⇄ UART2，GPIO 控制 TXEN）在实物上跑通了，11 月 4 日用它控制整只手成功。'], ['仓库，未上板', '按包转发的 firmware/bridge 只在电脑上测过，没在 M7C 上跑过。'], ['我的理解', 'U2D2 这类成品转接器是芯片自动切方向加透传。这句是凭我对这类产品的了解说的，没有查它的原理图。']])}</div>`));
  render();
  return {
    leave() { clearInterval(timer); },
    view: () => {
      const s = S();
      return { scene: 'desk', focus: ['pc', 'm7c', 'txb'], hot: ['m7c'], wires: { WIRE_usb: s.pc < N && s.pc > 0 ? 'A' : null, WIRE_tx: s.txen ? 'H' : null, WIRE_dir: s.txen ? 'H' : 'L' },
        flow: s.txen ? { route: ['in_m7c', 'WIRE_tx'], count: 3, speed: 0.6 } : null, info: `TXEN = ${s.txen}　${s.txen ? 'M7C 正在往舵机那边发' : 'M7C 没在发'}` };
    },
  };
}
