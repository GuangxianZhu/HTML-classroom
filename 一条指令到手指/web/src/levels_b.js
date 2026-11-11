// 第 6–10 关：电平转换、合线、总线上谁来听、舵机内部、线轴和腱绳
import * as C from './core.js';
import { $, $$, el, fmt, takeaway, basis, where, quiz, tasks, slider, seg, stats, bytesView, vbar, svg, wavePath, tween } from './ui.js';
import { GOAL_POS } from './levels_a.js';

// ---------- 第 6 关：3.3 V 变 5 V ----------
export function chLevel(root, api) {
  let v = 3.3, vcc = 5, r3 = 100000, sawLow = false;
  root.append(el(`<div class="panel">${where('TXB0104 小板。左边接 M7C（3.3 V），右边接 241 和舵机总线（5 V）。')}
    <p>M7C 的引脚输出“高”的时候是 3.3 V。后面的 241 芯片和舵机的数据线用 5 V 供电。同样叫“高电平”，两边的电压不一样。</p>
    <div id="q"></div></div>`));
  quiz($('#q', root), {
    q: '把 M7C 输出的 3.3 V“高电平”直接接到一颗 5 V 供电的芯片上，它会读成什么？',
    options: [
      { t: 'A　读成 1，3.3 V 已经挺高了', why: '高不高是相对电源说的。5 V 的芯片要看到约 3.5 V 以上才保证当成 1。' },
      { t: 'B　读成 0', why: '也不到那么低。要低于约 1.5 V 才保证当成 0。' },
      { t: 'C　说不准，可能 1 也可能 0', ok: true, why: '这类芯片的门限大约是电源电压的 70% 和 30%。电源 5 V 时就是 3.5 V 和 1.5 V。3.3 V 落在中间那段，碰巧能用、换一颗或者热一点就不行，这种问题最难查。所以中间要加一颗电平转换芯片。' },
    ],
  });
  const p = el(`<div class="panel"><p><b>实验一：同一个电压，两种芯片怎么读。</b>拖动电压，再切换是谁在读。</p>
    <div id="who"></div><div id="bar"></div><div id="vs"></div>
    <div class="readout" id="rd"><span class="sub">读的结果</span><span class="big"></span><p></p></div></div>`);
  root.append(p);
  const paintBar = vbar($('#bar', p));
  seg($('#who', p), { label: '谁在读', value: 5, options: [[3.3, '3.3 V 供电的芯片（M7C）'], [5, '5 V 供电的芯片（241）']], onChange: (x) => { vcc = +x; render(); } });
  slider($('#vs', p), { label: '线上的电压', min: 0, max: 5, step: 0.05, value: 3.3, show: (x) => x.toFixed(2) + ' V', onInput: (x) => { v = x; render(); } });
  const p2 = el(`<div class="panel"><p><b>实验二：这块板子上真的踩过的坑。</b>TXB0104 能自己判断信号往哪边走，代价是它的输出很“软”：内部像串了一个约 4 kΩ 的电阻。DIR 那根线上为了保险接了一个下拉电阻 R3。R3 选多大，直接决定 241 那边看到的“高”有多高。</p>
    <div id="rs"></div><div class="fig" id="fig"></div><div id="st"></div><div id="tk"></div></div>`);
  root.append(p2);
  const done = tasks($('#tk', p2), ['实验一：让 5 V 的芯片去读 3.3 V，看到“说不准”', '实验二：R3 换成 10 kΩ，看 241 那边只剩多少伏', '实验二：换回 100 kΩ']);
  seg($('#rs', p2), { label: '下拉电阻 R3', value: 100000, options: [[10000, '10 kΩ（当时插错的）'], [47000, '47 kΩ'], [100000, '100 kΩ（现在用的）']], onChange: (x) => { r3 = +x; render(); } });
  const setStats = stats($('#st', p2));
  function render() {
    paintBar(v, vcc);
    const r = C.logicRead(v, vcc), box = $('#rd', p);
    box.className = 'readout ' + (r === 1 ? 'high' : r === 0 ? 'low' : 'bad');
    $('.big', box).textContent = `${v.toFixed(2)} V → ${r === 1 ? '读成 1' : r === 0 ? '读成 0' : '说不准'}`;
    $('p', box).textContent = r === null ? `落在 ${(0.3 * vcc).toFixed(2)} V 和 ${(0.7 * vcc).toFixed(2)} V 之间。芯片不保证读成什么。` : `门限是电源 ${vcc} V 的 30% 和 70%。`;
    const vb = C.txbHigh(5, r3), ok = C.logicRead(vb, 5) === 1, margin = vb - 3.5;
    $('#fig', p2).innerHTML = svg(380, 130, `
      <rect class="box" x="8" y="34" width="92" height="56" rx="8"/><text class="ink b" x="54" y="58" text-anchor="middle">TXB0104</text><text x="54" y="76" text-anchor="middle">想输出 5 V</text>
      <line class="line H" x1="100" y1="62" x2="126" y2="62"/>
      <path class="line H" d="M126 62 l5 -8 l8 16 l8 -16 l8 16 l8 -16 l5 8"/><text x="147" y="44" text-anchor="middle">内部约 4 kΩ</text>
      <line class="line ${ok && margin > 0.5 ? 'H' : 'X'}" x1="168" y1="62" x2="290" y2="62"/>
      <circle class="${ok && margin > 0.5 ? 'f-hi' : 'f-bad'}" cx="220" cy="62" r="4"/>
      <text class="mono ink b" x="220" y="48" text-anchor="middle">${vb.toFixed(2)} V</text>
      <path class="line" d="M220 62 v10 l-8 5 l16 8 l-16 8 l16 8 l-8 5 v8"/><text x="236" y="96">R3 = ${r3 / 1000} kΩ</text>
      <line class="line" x1="208" y1="122" x2="232" y2="122"/><text x="244" y="126">地</text>
      <rect class="box" x="290" y="34" width="82" height="56" rx="8"/><text class="ink b" x="331" y="58" text-anchor="middle">241 的 DIR 脚</text><text x="331" y="76" text-anchor="middle">要 ≥ 3.5 V</text>`, 'TXB 输出、内部电阻、下拉电阻分压示意');
    setStats([{ k: '241 看到的高电平', v: vb.toFixed(2) + ' V', cls: margin > 0.5 ? 'ok' : 'bad' }, { k: '离门限 3.5 V', v: (margin >= 0 ? '+' : '') + margin.toFixed(2) + ' V', cls: margin > 0.5 ? 'ok' : 'bad' },
      { k: '结论', v: margin > 0.5 ? '稳' : '几乎没有余量', cls: margin > 0.5 ? 'ok' : 'bad' }]);
    if (vcc === 5 && C.logicRead(v, 5) === null) done(0);
    if (r3 === 10000) { done(1); sawLow = true; }
    if (r3 === 100000 && sawLow) done(2);
    api.sync();
  }
  root.append(el(`<div class="panel">${takeaway('电平转换芯片两边各接一种电源，把这边的“高”翻译成那边的“高”，反过来也一样。TXB 这种自动认方向的型号输出很软，线上不能挂小阻值的电阻。')}
    <p><b>为什么它要做得这么软：</b>它不知道哪边在说话，所以两边都用很弱的力气“扶着”线上的电平；谁真的在驱动，一推就能推过它。好处是不用告诉它方向，坏处是带不动重的负载。</p>
    <p><b>算式：</b>内部 4 kΩ 和外面的 R3 串起来把 5 V 分压，241 看到的是 5 V × R3 ÷ (R3 + 4 kΩ)。R3 = 10 kΩ 时只有约 3.6 V，贴着 3.5 V 的线。</p>
    ${basis([['仓库实测', 'R3 插成 10 kΩ 时，量到 DIR 高电平只有约 3.5 V；换成 100 kΩ 后量到 4.77 V（whj_MCU 的 HANDOFF.md）。和上面的算式对得上。'], ['手册典型值', '30% / 70% 的门限、TXB 输出约 4 kΩ、外接上下拉建议不小于 50 kΩ，来自 TI 数据手册的规格，具体数值以手上那颗芯片的手册为准。'], ['公认', '不同电源的芯片之间要做电平转换，是通用做法。']])}</div>`));
  render();
  return { view: () => {
    const vb = C.txbHigh(5, r3), ok = vb - 3.5 > 0.5;
    return { scene: 'desk', focus: ['m7c', 'txb', 'g241'], hot: ['txb'], wires: { WIRE_dir: 'H', WIRE_dir5: ok ? 'H' : 'X' }, info: `DIR 线：M7C 这边 3.3 V　→　241 这边 ${vb.toFixed(2)} V` };
  } };
}

// ---------- 第 7 关：两根线合成一根 ----------
export function chDuplex(root, api) {
  let dir = 0, tx = 1, servo = null, touched = false;
  const seen = new Set();
  root.append(el(`<div class="panel">${where('241 小板（74LVC2G241）。它把 M7C 的 TX、RX 两根线，接到舵机的一根 DATA 线上。')}
    <p>M7C 的串口有两根线：TX 只管发，RX 只管收。舵机为了少接线，只有一根 DATA：指令从它进，应答也从它出。</p>
    <div id="q"></div></div>`));
  quiz($('#q', root), {
    q: '同一根线上，如果 M7C 和舵机同时在发，会怎么样？',
    options: [
      { t: 'A　两边的数据叠在一起，各自都能收到', why: '一根线一个时刻只有一个电压，叠不起来。' },
      { t: 'B　一个往高推、一个往低拉，电平打架，谁的数据都坏', ok: true, why: '所以要有规矩：同一时刻只有一方说话，这叫半双工。这套协议的规矩是：主机（电脑这边）先说，说完了，被点名的舵机才答。主机说话的时候要“按住话筒”，说完要“松开”，这个开关就是 DIR，也叫 TXEN。' },
    ],
  });
  const p = el(`<div class="panel"><p>241 里面是两个带开关的“门”。门开着，信号过得去；门关着，等于断开。两个门的开关接在同一根 DIR 上，而且是反着的：一个开，另一个就关。自己拨一拨。</p>
    <div id="s1"></div><div id="s2"></div><div id="s3"></div>
    <div class="fig" id="fig"></div><div id="st"></div>
    <div class="readout" id="say"><span class="sub">现在的状态</span><p></p></div><div id="tk"></div></div>`);
  root.append(p);
  const done = tasks($('#tk', p), ['DIR = 1，把 TX 上的 0 送到 DATA', 'DIR = 0，让舵机的 0 传回 RX', '做出一次“打架”', '两边都不说话时，看 DATA 是高还是低']);
  seg($('#s1', p), { label: 'DIR（TXEN）', value: 0, options: [[1, '1：我说'], [0, '0：我听']], onChange: (x) => { dir = +x; touched = true; render(); } });
  seg($('#s2', p), { label: 'M7C 的 TX', value: 1, options: [[1, '高'], [0, '低']], onChange: (x) => { tx = +x; touched = true; render(); } });
  seg($('#s3', p), { label: '舵机', value: 'n', options: [['n', '不说话'], ['1', '往高推'], ['0', '往低拉']], onChange: (x) => { servo = x === 'n' ? null : +x; touched = true; render(); } });
  const setStats = stats($('#st', p));
  const cls = (lv) => (lv === null ? 'X' : lv ? 'H' : 'L');
  function render() {
    const g = C.gate241({ dir, tx, servo });
    $('#fig', p).innerHTML = svg(380, 215, `
      <rect class="box" x="6" y="30" width="62" height="160" rx="8"/><text class="ink b" x="37" y="22" text-anchor="middle">M7C</text>
      <text x="14" y="64">TX</text><text x="14" y="114">DIR</text><text x="14" y="164">RX</text>
      <line class="line ${cls(tx)}" x1="68" y1="60" x2="150" y2="60"/>
      <path class="box ${g.txOn ? 'on' : 'off'}" d="M150 44 L186 60 L150 76 Z"/><text x="168" y="36" text-anchor="middle">发送门（${g.txOn ? '开' : '关'}）</text>
      <line class="line ${g.txOn ? cls(tx) : 'Z'}" x1="186" y1="60" x2="262" y2="60"/>
      <line class="line ${dir ? 'H' : 'L'}" x1="68" y1="110" x2="168" y2="110"/>
      <line class="line ${dir ? 'H' : 'L'}" x1="168" y1="110" x2="168" y2="70"/><line class="line ${dir ? 'H' : 'L'}" x1="168" y1="110" x2="168" y2="146"/>
      <circle class="box" cx="168" cy="149" r="4"/><text x="176" y="132">小圆圈 = 反过来</text>
      <path class="box ${g.rxOn ? 'on' : 'off'}" d="M186 144 L150 160 L186 176 Z"/><text x="168" y="194" text-anchor="middle">接收门（${g.rxOn ? '开' : '关'}）</text>
      <line class="line ${cls(g.rx)}" x1="68" y1="160" x2="150" y2="160"/>
      <line class="line ${g.rxOn ? cls(g.data) : 'Z'}" x1="186" y1="160" x2="262" y2="160"/>
      <line class="line ${cls(g.data)}" x1="262" y1="60" x2="262" y2="160"/><line class="line ${cls(g.data)}" x1="262" y1="110" x2="312" y2="110"/>
      <circle class="${g.fight ? 'f-bad' : g.data ? 'f-hi' : 'f-lo'}" cx="262" cy="110" r="4.5"/><text class="ink b" x="270" y="102">DATA</text>
      <path class="line" d="M262 60 v-8 l-5 -4 l10 -6 l-10 -6 l10 -6 l-5 -4 v-6"/><text x="272" y="30">上拉电阻</text><text x="238" y="14">5 V</text>
      <rect class="box" x="312" y="80" width="62" height="60" rx="8"/><text class="ink b" x="343" y="72" text-anchor="middle">舵机</text>
      <text x="343" y="114" text-anchor="middle">${servo === null ? '在听' : servo ? '推高' : '拉低'}</text>`, '241 内部两个门的示意');
    setStats([{ k: 'DATA 线', v: g.fight ? '打架' : g.data ? '高' : '低', cls: g.fight ? 'bad' : g.data ? 'hi' : 'lo' }, { k: 'M7C 的 RX 读到', v: g.rx ? '高' : '低', cls: g.rx ? 'hi' : 'lo' },
      { k: '发送门', v: g.txOn ? '开' : '关' }, { k: '接收门', v: g.rxOn ? '开' : '关' }]);
    $('#say p', p).textContent = g.fight ? 'M7C 和舵机同时在推这根线，一个要高、一个要低。线上的电压夹在中间，两边都读不对，电流还很大。正常工作时绝不能出现这个状态。'
      : dir === 1 ? (servo !== null ? '两边同时在推，只是碰巧推的方向一样，没打起来。下一位就可能打架。' : `发送门开着，TX 的${tx ? '高' : '低'}直接到了 DATA。接收门关着，RX 被上拉在高，M7C 听不到自己发的东西。`)
        : servo !== null ? `发送门松手了。舵机把 DATA ${servo ? '推高' : '拉低'}，接收门把它送回 RX。` : '没人推这根线。上拉电阻把 DATA 轻轻拉到高。串口空闲时本来就是高，所以这正好是“没人说话”的样子。';
    if (dir === 1 && tx === 0 && g.data === 0) seen.add(0);
    if (dir === 0 && servo === 0 && g.rx === 0) seen.add(1);
    if (g.fight) seen.add(2);
    if (dir === 0 && servo === null && touched) seen.add(3);
    seen.forEach(done);
    api.sync();
  }
  root.append(el(`<div class="panel">${takeaway('DIR = 1 我说，DIR = 0 我听。没人说话时，上拉电阻把线留在高。主机一说完就要把 DIR 放回 0，不然舵机的应答进不来。')}
    <p><b>仓库里对应的故障：</b>有一次发送的时候，RX 上也出现了波形，M7C 把自己发的东西又收了回来（回显）。按上图，发送时接收门应该是关的。原因是地线分在两条轨上，DIR 这根线上有毛刺，接收门被短暂地打开了。把所有地线接到同一条轨以后就好了。</p>
    <p><b>这个解释可靠到哪一步：</b>“两种改法都能解决”（地线并到一条轨，或在 DIR 上加小电容）是实测的。“毛刺来自地线”是据此做的推断，最可疑的那条轨到底是不是中间断开，还没有量过。</p>
    ${basis([['公认', '半双工、三态门、空闲时靠上拉保持高电平，是单线串行总线的通用做法。'], ['手册', '241 两个门的使能一个高有效、一个低有效，所以一根 DIR 就能让它们一开一关。'], ['仓库实测 + 推断', '回显故障的现象和两种解决办法是实测；根本原因是推断（HANDOFF.md“踩过的坑 2”）。']])}</div>`));
  render();
  return { view: () => {
    const g = C.gate241({ dir, tx, servo }), lv = (x) => (x === null ? 'X' : x ? 'H' : 'L');
    return { scene: 'desk', focus: ['txb', 'g241', 'phb'], hot: ['g241'], wires: { WIRE_tx5: lv(tx), WIRE_dir5: lv(dir), WIRE_rx5: lv(g.rx), WIRE_data: lv(g.data) },
      info: g.fight ? 'DATA 线上在打架' : `DIR = ${dir}　DATA 是${g.data ? '高' : '低'}　RX 读到${g.rx ? '高' : '低'}` };
  } };
}

// ---------- 第 8 关：17 个舵机，谁来听 ----------
export function chBus(root, api) {
  const KIND = {
    w8: { t: '写给 8 号', pkt: () => C.writePacket(8, 116, 4, GOAL_POS) },
    w30: { t: '写给 30 号（没有这个舵机）', pkt: () => C.writePacket(30, 116, 4, GOAL_POS) },
    wall: { t: '广播：全部关扭矩', pkt: () => C.writePacket(C.BROADCAST, 64, 1, 0) },
    sr: { t: 'Sync Read：读 7、8、9 号的位置', pkt: () => C.syncRead(132, 4, [7, 8, 9]) },
    ping: { t: '广播 Ping：都有谁在', pkt: () => C.pingPacket(C.BROADCAST) },
  };
  let kind = 'w8', rd = 20, rel = 2, picked = null;
  const seen = new Set(), ok = new Set();
  root.append(el(`<div class="panel">${where('舵机总线。17 个舵机的 DATA 脚全都并在同一根线上。')}
    <p>包从 241 出来，沿着这根线到了手腕下面的舵机堆。线是并联的：一个舵机收到的电平，另外 16 个也同时收到。</p>
    <div id="q"></div></div>`));
  quiz($('#q', root), {
    q: '这一包里 ID 写的是 8。其余 16 个舵机会怎么样？',
    options: [
      { t: 'A　根本收不到，线只通到 8 号', why: '线是并着的，没有哪个开关把信号只导向 8 号。' },
      { t: 'B　都收到了，各自看一眼 ID，不是自己的就不管', ok: true, why: '每个舵机里都有一颗小芯片，一直在听这根线。它们都收下了完整的一包，都检查了校验，然后比 ID：只有 8 号往下执行，并且只有 8 号应答。所以每个舵机的 ID 必须不一样，这就是装手之前要一个一个设 ID 的原因。' },
    ],
  });
  const p = el(`<div class="panel"><p><b>实验一：换几种包，看谁执行、谁应答。</b>模型上：<span class="lo">蓝</span> = 听到了但不管，<span class="hi">橙</span> = 执行，<span class="good">绿</span> = 执行并应答。点模型上的舵机可以看它是几号。</p>
    <div id="kd"></div><div id="by"></div><div id="st"></div>
    <div class="readout" id="say"><span class="sub">结果</span><p></p></div></div>`);
  root.append(p);
  seg($('#kd', p), { value: 'w8', options: Object.entries(KIND).map(([k, v]) => [k, v.t]), onChange: (x) => { kind = x; seen.add(x); render(); } });
  const draw = bytesView($('#by', p));
  const setStats = stats($('#st', p));
  const p2 = el(`<div class="panel"><p><b>实验二：TXEN 什么时候松手。</b>舵机收完指令，会等一小段时间（Return Delay）再开口应答。主机必须在这之前把 TXEN 放回 0，把线让出来；但也不能在最后一位发完之前就松手。</p>
    <div id="rd"></div><div class="ops"><button data-r="tc">用“发送完成”标志松手</button><button data-r="txe">用“缓冲区空”标志松手</button><button data-r="dly">发完后固定等 1 ms 再松手</button></div>
    <div id="sl"></div><div class="fig" id="fig"></div>
    <div class="readout" id="out"><span class="sub">结果</span><span class="big"></span><p></p></div><div id="tk"></div></div>`);
  root.append(p2);
  const done = tasks($('#tk', p2), ['实验一：五种包都试一遍', '实验二：Return Delay 20 µs 时，三个按钮各试一次', '实验二：拖滑块，找出能成功的范围有多宽']);
  seg($('#rd', p2), { label: '舵机的 Return Delay', value: 20, options: [[500, '500 µs（出厂）'], [20, '20 µs（orca_core 设过以后）']], onChange: (x) => { rd = +x; render(); } });
  const sl = slider($('#sl', p2), { label: 'TXEN 松手的时刻（0 = 最后一位刚发完）', min: -260, max: 1100, step: 2, value: rel, show: (x) => (x > 0 ? '+' : '') + x + ' µs', onInput: (x) => { rel = x; ok.add('drag'); render(); } });
  $$('[data-r]', p2).forEach((b) => b.addEventListener('click', () => {
    rel = b.dataset.r === 'tc' ? 2 : b.dataset.r === 'txe' ? -Math.round(C.byteUs(57600)) : 1000;
    if (rd === 20) ok.add(b.dataset.r);
    sl.set(rel); render();
  }));
  function render() {
    const pkt = KIND[kind].pkt(), who = C.whoReacts(pkt, C.ALL_IDS);
    draw(pkt);
    setStats([{ k: '听到这一包的', v: '17 个' }, { k: '执行的', v: who.act.length ? (who.act.length > 6 ? who.act.length + ' 个' : who.act.join('、') + ' 号') : '没有', cls: who.act.length ? 'hi' : '' },
      { k: '应答的', v: who.reply.length ? (who.reply.length > 6 ? who.reply.length + ' 个，挨个答' : who.reply.join('、') + ' 号') : '没有', cls: who.reply.length ? 'ok' : '' }]);
    $('#say p', p).innerHTML = {
      w8: `8 号执行，然后回一包很短的应答：<span class="mono">${C.hexs(C.statusPacket(8))}</span>。里面 55 表示“这是应答”，后面的 00 表示没有错误。`,
      w30: '17 个都看了，没有一个是 30 号，全都不管。线上一片安静。电脑等不到应答，过一会儿报超时。ID 设错、舵机没上电、线没接好，看到的都是这个现象。',
      wall: 'ID 写 FE 是广播：所有舵机都执行。但是都不应答，因为 17 个同时开口会在线上打架。',
      sr: '这一包点了三个名。7、8、9 号按包里列的顺序，一个答完下一个再答，不会撞在一起。读回整只手的状态用的就是这种包，第 12 关算它要多久。',
      ping: '广播 Ping 是例外：每个舵机都应答，但各自按自己的 ID 错开时间，一个一个来。用它可以一次扫出线上都有谁。',
    }[kind];
    // 时间轴
    const bit = C.bitUs(57600), t0 = rd === 20 ? -200 : -260, t1 = rd === 20 ? 150 : rd + 320, X = (t) => 60 + (Math.max(t0, Math.min(t1, t)) - t0) / (t1 - t0) * 310;
    const res = C.txenOutcome({ releaseUs: rel, returnDelayUs: rd, baud: 57600 });
    const last = C.uartBits(C.writePacket(8, 116, 4, GOAL_POS).slice(-1)[0]);
    const hostWave = last.map((b, i) => `${i ? 'L' : 'M'}${X(-(10 - i) * bit)} ${b ? 32 : 52} L${X(-(9 - i) * bit)} ${b ? 32 : 52}`).join(' ');
    const rep = C.uartBits(0xFF), repWave = rep.map((b, i) => `${i ? 'L' : 'M'}${X(rd + i * bit)} ${b ? 122 : 142} L${X(rd + (i + 1) * bit)} ${b ? 122 : 142}`).join(' ');
    const relX = X(rel);
    $('#fig', p2).innerHTML = svg(380, 180, `
      <text x="2" y="46">主机发</text><text x="2" y="92">TXEN</text><text x="2" y="136">舵机答</text>
      <line class="axis" x1="${X(0)}" y1="14" x2="${X(0)}" y2="156" stroke-dasharray="3 3"/><text x="${X(0)}" y="170" text-anchor="middle">0</text>
      <line class="axis" x1="${X(rd)}" y1="14" x2="${X(rd)}" y2="156" stroke-dasharray="3 3"/><text x="${X(rd) + (rd < 100 ? 16 : 0)}" y="170" text-anchor="${rd < 100 ? 'start' : 'middle'}">+${rd} µs 舵机开口</text>
      ${res.kind === 'late' ? `<rect class="f-bad" opacity=".22" x="${X(rd)}" y="60" width="${Math.max(2, relX - X(rd))}" height="90"/>` : ''}
      ${res.kind === 'cut' ? `<rect class="f-bad" opacity=".22" x="${relX}" y="22" width="${Math.max(2, X(-bit) - relX)}" height="78"/>` : ''}
      ${res.kind === 'ok' ? `<rect class="f-ok" opacity=".18" x="${X(-bit)}" y="60" width="${Math.max(2, X(rd) - X(-bit))}" height="46"/>` : ''}
      <path class="wave" d="M60 32 L${X(-10 * bit)} 32 ${hostWave.replace(/^M/, 'L')} L${X(0)} 32"/><text x="${X(-5 * bit)}" y="24" text-anchor="middle">最后一个字节</text>
      <path class="wave ${res.kind === 'ok' ? 'w-ok' : 'w-bad'}" d="M60 78 L${relX} 78 L${relX} 98 L370 98"/>
      <text class="mono ${res.kind === 'ok' ? 'f-ok' : 'f-bad'} b" x="${Math.min(relX + 4, 300)}" y="74">松手</text>
      <path class="wave w-lo" d="M60 122 L${X(rd)} 122 ${repWave.replace(/^M/, 'L')} L370 122"/>`, 'TXEN 松手时刻和舵机应答的时间关系');
    const o = $('#out', p2);
    o.className = 'readout ' + (res.kind === 'ok' ? 'ok' : 'bad');
    $('.big', o).textContent = res.kind === 'ok' ? '成功' : res.kind === 'cut' ? '松早了：指令被截断' : '松晚了：应答被盖住';
    $('p', o).textContent = res.text + (res.kind === 'ok' ? ` 能成功的范围：从 ${-Math.round(bit)} µs（停止位本来就是高，提前这一位松手没关系）到 +${rd} µs，一共约 ${Math.round(rd + bit)} µs 宽。` : '');
    if (seen.size >= 4) done(0);
    if (['tc', 'txe', 'dly'].every((k) => ok.has(k))) done(1);
    if (ok.has('drag')) done(2);
    api.sync();
  }
  root.append(el(`<div class="panel">${takeaway('17 个舵机都听得到每一包，靠 ID 认领。主机说完要立刻松开 TXEN：窗口从“最后一位发完”到“舵机开口”，出厂设置有 500 µs，orca_core 配过以后只有 20 µs。')}
    <p><b>三种松手办法：</b></p>
    <ul class="plain"><li><b>发送完成标志（TC）</b>：串口硬件告诉程序“最后一位已经离开引脚了”。这时松手正好，是标准做法。</li>
      <li><b>缓冲区空标志（TXE）</b>：只表示“下一个字节可以交给我了”，这时最后一个字节才刚开始往外发。按它松手，最后一个字节被截断。很多人第一次写都栽在这里，因为两个标志名字很像。</li>
      <li><b>固定延时</b>：出厂 500 µs 时偶尔能蒙对，改成 20 µs 以后必错。而且换个波特率就要重调。</li></ul>
    <p><b>换成 1 Mbps 会不会更紧：</b>一位从 17 µs 变成 1 µs，字节变短了，但舵机的 20 µs 不变，所以窗口还是 20 µs 左右。要求没变，只是程序动作要够快。</p>
    ${basis([['手册', 'ID 认领、广播不应答、Sync Read 按顺序应答、Return Delay 出厂 500 µs，都是协议和控制表的规定。'], ['仓库（读源码）', 'orca_core 的设 ID 脚本会把 Return Delay 改成 20 µs（whj_MCU 的 下一步_预紧到换KM1M7C.md“坑 2”）。'], ['还不知道', '你板子上实际在跑的透传固件，TXEN 是按哪个标志松手的，仓库里没有记录。它在实物上能稳定控制整只手，说明至少落在窗口里。']])}</div>`));
  render();
  return {
    pick(k, id) { if (id) { picked = id; api.sync(); } },
    view: () => {
      const who = C.whoReacts(KIND[kind].pkt(), C.ALL_IDS);
      const servos = Object.fromEntries(C.ALL_IDS.map((id) => [id, who.reply.includes(id) ? 'G' : who.act.includes(id) ? 'H' : 'L']));
      const j = picked ? C.jointOf(picked) : null;
      return { scene: 'desk', focus: ['phb', 'tower'], hot: ['tower'], servos, wires: { WIRE_bus: 'A', WIRE_data: 'A' }, flow: { route: ['WIRE_data', 'in_phb', 'WIRE_bus', 'chain'], count: 4, speed: 0.5 },
        info: j ? `你点的是 ${picked} 号：${j.name}` : '点一个舵机，看它是几号、管哪个关节' };
    },
  };
}

// ---------- 第 9 关：舵机内部 ----------
export function chServo(root, api) {
  const PARTS = {
    conn: ['总线接口', '数据线和电源从这里进来。两个口是通的，方便一个接一个串下去。'],
    mcu: ['控制芯片', '舵机里自己的一颗小单片机。它收包、查 ID 和校验、把数写进控制表，然后一刻不停地重复下面这件事：读现在的位置，和目标比，决定给电机多大的电。'],
    motor: ['电机', '一个很小的直流电机。它转得快、力气小，直接带不动手指。'],
    gears: ['减速齿轮', '几级齿轮把转速降下来，力气换上去。这颗舵机的减速比约 288：电机转 288 圈，输出轴才转 1 圈。画面上为了看得清，齿轮转得比真实的慢。'],
    out: ['输出轴和线轴', '齿轮组最后一级带着输出轴。轴上装着线轴，腱绳就绕在上面。'],
    enc: ['磁铁和编码器', '输出轴的另一头有一小块磁铁（红蓝两半是它的两极），正下方的芯片读磁场的方向，就知道轴现在转到了第几格，一圈 4096 格。不接触，所以不磨损。'],
  };
  let pos = 2800, goal = GOAL_POS, limit = 150, wall = null, cur = 25, hot = 'enc', stop = () => {}, res = { reached: true };
  const seen = new Set();
  root.append(el(`<div class="panel">${where('8 号舵机里面。它收下了“目标位置 ' + GOAL_POS + '”。')}
    <p>舵机不是“给多少电转多少”的简单电机。它是一个自带大脑的小系统：知道自己现在在哪，也知道该去哪，自己想办法过去。</p>
    <div id="q"></div></div>`));
  quiz($('#q', root), {
    q: '舵机怎么知道自己转到 ' + GOAL_POS + ' 了没有？',
    options: [
      { t: 'A　记着电机一共转了多少圈', why: '只靠数圈的话，一断电就忘了，被外力掰动也不知道。' },
      { t: 'B　输出轴上有一块磁铁，芯片读它朝哪个方向', ok: true, why: '位置是直接从输出轴上量出来的，上电就知道现在在哪，被掰动了也读得出来。有了“现在的位置”，才能和“目标位置”比，这就是闭环。上面的模型已经把前盖去掉了，点下面的零件名可以看它在哪。' },
    ],
  });
  const p = el(`<div class="panel"><div id="parts"></div><div class="fieldinfo" id="pinfo"></div></div>`);
  root.append(p);
  seg($('#parts', p), { value: 'enc', options: Object.entries(PARTS).map(([k, v]) => [k, v[0]]), onChange: (x) => { hot = x; render(); } });
  const p2 = el(`<div class="panel"><p>下面让它动起来。舵机现在用的是“限电流的位置控制”（模式 5）：目标位置决定去哪，电流上限决定最多用多大的力。</p>
    <div class="fig" id="loop"></div>
    <div id="gs"></div><div id="ls"></div><div id="ws"></div><div id="st"></div>
    <div class="readout" id="say"><span class="sub">现在的状态</span><p></p></div><div id="tk"></div></div>`);
  root.append(p2);
  const done = tasks($('#tk', p2), ['路上没东西：改几次目标，看它每次都到位', '放上东西，电流上限 60 mA：看它停在半路', '还是挡着，上限调到 300 mA：看它压进去多少、拉力多大']);
  slider($('#gs', p2), { label: '目标位置', min: 1700, max: 3200, step: 1, value: goal, show: (x) => x, onInput: (x) => { goal = x; run(); } });
  seg($('#ls', p2), { label: '电流上限（Goal Current）', value: 150, options: [[60, '60 mA'], [150, '150 mA'], [300, '300 mA']], onChange: (x) => { limit = +x; run(); } });
  seg($('#ws', p2), { label: '路上', value: 'n', options: [['n', '什么都没有'], ['y', '2500 处有个软东西挡着']], onChange: (x) => { wall = x === 'y' ? 2500 : null; run(); } });
  const setStats = stats($('#st', p2));
  function run() {
    stop();
    const start = pos;
    res = C.servoSettle({ start, goal, limitmA: limit, wall, stiff: 1.6 });
    const dist = Math.abs(res.pos - start);
    cur = dist > 2 ? Math.min(limit, 110) : res.currentmA;
    stop = tween(start, res.pos, Math.min(1400, 250 + dist * 1.6), (x) => { pos = x; render(); }, () => { cur = res.currentmA; render(); });
    render();
  }
  function render() {
    const info = PARTS[hot];
    $('#pinfo', p).innerHTML = `<b>${info[0]}</b>${info[1]}`;
    const err = Math.round(goal - pos), moving = Math.abs(res.pos - pos) > 1;
    $('#loop', p2).innerHTML = svg(380, 150, `
      <rect class="box" x="4" y="20" width="70" height="40" rx="6"/><text class="ink" x="39" y="37" text-anchor="middle">目标位置</text><text class="mono ink b" x="39" y="53" text-anchor="middle">${goal}</text>
      <line class="line" x1="74" y1="40" x2="96" y2="40"/><circle class="box" cx="108" cy="40" r="12"/><text class="ink b" x="108" y="45" text-anchor="middle">−</text>
      <text x="108" y="18" text-anchor="middle">差 ${err} 格</text>
      <line class="line" x1="120" y1="40" x2="138" y2="40"/>
      <rect class="box ${cur >= limit ? 'on' : ''}" x="138" y="20" width="78" height="40" rx="6"/><text class="ink" x="177" y="37" text-anchor="middle">控制芯片</text><text x="177" y="53" text-anchor="middle">最多 ${limit} mA</text>
      <line class="line H" x1="216" y1="40" x2="236" y2="40"/><text class="mono f-hi b" x="226" y="14" text-anchor="middle">${cur} mA</text>
      <rect class="box" x="236" y="20" width="52" height="40" rx="6"/><text class="ink" x="262" y="45" text-anchor="middle">电机</text>
      <line class="line" x1="288" y1="40" x2="302" y2="40"/>
      <rect class="box" x="302" y="20" width="74" height="40" rx="6"/><text class="ink" x="339" y="37" text-anchor="middle">齿轮 288 : 1</text><text x="339" y="53" text-anchor="middle">→ 输出轴</text>
      <path class="line" d="M339 60 V110 H250"/>
      <rect class="box" x="150" y="92" width="100" height="36" rx="6"/><text class="ink" x="200" y="108" text-anchor="middle">磁铁 + 编码器</text><text class="mono ink b" x="200" y="123" text-anchor="middle">现在 ${Math.round(pos)}</text>
      <path class="line" d="M150 110 H108 V52"/><text x="100" y="134" text-anchor="middle">量回来，再比</text>`, '舵机的闭环：目标和现在相减，控制芯片出电流，电机经齿轮带动输出轴，编码器把位置量回来');
    setStats([{ k: '现在的位置', v: Math.round(pos) }, { k: '离目标', v: err + ' 格', cls: !moving && !res.reached ? 'bad' : '' }, { k: '电流', v: cur + ' mA', cls: cur >= limit ? 'bad' : 'hi' },
      { k: '线上拉力（估）', v: fmt(C.pullN(cur, 10), 0) + ' N' }]);
    $('#say p', p2).textContent = moving ? '离目标还有差距，控制芯片给电机通电，往目标那边转。'
      : res.reached ? '到位了。差是 0，电流回到很小的值，只够抵消一点摩擦。'
        : `被挡住了。控制芯片想再加力，但电流已经到了上限 ${limit} mA，只能停在这里，压进去了 ${Math.round(res.pressed)} 格。它会一直用这么大的力顶着，直到你改目标。`;
    if (wall === null && res.reached && !moving) { seen.add('g' + goal); if ([...seen].filter((x) => x[0] === 'g').length >= 3) done(0); }
    if (wall !== null && limit === 60 && !moving && !res.reached) done(1);
    if (wall !== null && limit === 300 && !moving) done(2);
    api.sync();
  }
  root.append(el(`<div class="panel">${takeaway('舵机 = 电机 + 减速齿轮 + 位置传感器 + 一颗控制芯片。它不停地比“目标”和“现在”，差多少就用力往回拉。模式 5 再加一道上限：最多用这么大的电流，也就是最多用这么大的力。')}
    <p><b>为什么抓东西要限电流：</b>不限的话，手指碰到东西还没到目标位置，舵机就会一直加力到它的最大值，线上的拉力能到几十上百牛，足够拉断细线、拉坏打印件。限了电流，碰到东西就停在那里，力是你定的。</p>
    <p><b>仓库里对应的事故：</b>测最大活动范围时，中指外展的腱绳末端的结被拉出了孔，掉进了手掌的通道里。当时关节顶到了机械极限，舵机以 300 mA 的上限一直拉着。这是在官方默认设置下发生的，更根本的原因可能在这一版硬件上（通道摩擦大、结和孔配合不牢）。</p>
    <p><b>“拉力”那个数怎么来的、多可靠：</b>按“扭矩大致和电流成正比”，用堆转数据（12 V 时 1.0 N·m、0.88 A）折算，再除以线轴半径（这里按 10 mm）。这是粗估：没有扣除空载电流和摩擦，你手上线轴的半径也可能不是 10 mm。只适合比大小，不能当测量值用。</p>
    ${basis([['手册', '磁编码器一圈 4096 格、减速比 288.35、堆转扭矩和电流，来自 XC330-T288 的 e-Manual。'], ['公认', '位置闭环、减速齿轮“降速增力”的原理。'], ['仓库实测 + 推断', '绳结脱出的现象是实测；原因分析是推断（whj_MCU 的 docs/遇到问题/中指ABD腱绳脱出.md）。'], ['示意', '模型里零件的摆放是为了看清楚自己排的，不是这颗舵机真实的内部布局。挡住时“压进去多少格”用的是简化的弹簧模型。']])}</div>`));
  run();
  return { view: () => ({ scene: 'servo', zoom: 0.82, outDeg: pos * 360 / 4096, current: cur, hot: [hot], info: `输出轴在第 ${Math.round(pos)} 格　电流 ${cur} mA` }) };
}

// ---------- 第 10 关：线轴和腱绳 ----------
export function chTendon(root, api) {
  let ang = 0, rs = 10, rj = 5, crank = false;
  const seen = new Set();
  root.append(el(`<div class="panel">${where('舵机输出轴上的线轴，和手指关节之间的两根腱绳。')}
    <p>舵机在手腕下面，手指在上面，中间靠线连着。线轴转，线被卷进去，关节那头就被拉动。人的手也是这个结构：肌肉在前臂，靠肌腱拉手指。</p>
    <div id="q1"></div><div id="q2"></div></div>`));
  quiz($('#q1', root), {
    q: '一个关节为什么要两根线？一根线，舵机正转拉弯、反转推直，不行吗？',
    options: [
      { t: 'A　行，一根就够', why: '线是软的。舵机反转时，线只会松下来堆在那里，推不动任何东西。' },
      { t: 'B　不行，线只能拉、不能推', ok: true, why: '所以要第二根线从另一面把手指拉直。两根线反方向绕在同一个线轴上：线轴往一边转，一根卷进来、另一根放出去。上面模型里橙色的是屈线（拉弯），蓝色的是伸线（拉直）。' },
    ],
  });
  quiz($('#q2', root), {
    q: '线轴半径 10 mm，关节上的滑轮半径 5 mm。舵机转 45°，关节转多少？',
    options: [
      { t: 'A　22.5°', why: '反了。线轴大，转一点就卷进很多线；滑轮小，同样多的线要转更大的角度才用得掉。' },
      { t: 'B　45°', why: '只有两个半径一样大时才相等。' },
      { t: 'C　90°', ok: true, why: '线轴卷进的线长 = 10 mm × 45° 对应的弧长 ≈ 7.9 mm。这 7.9 mm 的线在半径 5 mm 的滑轮上要转 90° 才用得完。卷进多少，那头就得用掉多少。' },
    ],
  });
  const p = el(`<div class="panel"><p>拖动舵机的转角，看两根线和关节。再改两个半径试试。</p>
    <div id="ms"></div><div id="as"></div><div id="r1"></div><div id="r2"></div><div id="st"></div>
    <div class="fig" id="plot"></div><div id="tk"></div></div>`);
  root.append(p);
  const done = tasks($('#tk', p), ['卷线轮：让关节正好弯到 90°', '把关节滑轮调大，看同样的舵机转角下关节转得少了', '换成“绑在舵盘孔上”，转过 180° 看线反而放回去']);
  seg($('#ms', p), { label: '线怎么固定在舵机上', value: 'w', options: [['w', '绕在卷线轮上'], ['c', '绑在舵盘的一个孔上']], onChange: (x) => { crank = x === 'c'; ang = 0; as.input.max = crank ? 360 : 120; as.set(0); render(); } });
  const as = slider($('#as', p), { label: '舵机转角', min: 0, max: 120, step: 1, value: 0, show: (x) => x + '°', onInput: (x) => { ang = x; render(); } });
  slider($('#r1', p), { label: '线轴半径（孔到中心的距离）', min: 6, max: 14, step: 0.5, value: 10, show: (x) => x + ' mm', onInput: (x) => { rs = x; render(); } });
  slider($('#r2', p), { label: '关节滑轮半径', min: 4, max: 10, step: 0.5, value: 5, show: (x) => x + ' mm', onInput: (x) => { rj = x; render(); } });
  const setStats = stats($('#st', p));
  const state = () => {
    const pulled = crank ? C.crankPullMm(rs, ang) : C.tendonMm(rs, ang);
    const jRaw = pulled / rj * 180 / Math.PI, joint = Math.min(100, jRaw);
    return { pulled, joint, hit: jRaw > 100 };
  };
  function render() {
    const s = state(), F = C.pullN(150, rs);
    setStats([{ k: '屈线卷进', v: fmt(s.pulled, 1) + ' mm', cls: 'hi' }, { k: '伸线放出', v: crank ? '对不上' : fmt(s.pulled, 1) + ' mm', cls: crank ? 'bad' : 'lo' },
      { k: '关节角度', v: fmt(s.joint, 0) + '°' + (s.hit ? '（到头了）' : '') }, { k: '舵机 1° → 关节', v: crank ? '一直在变' : fmt(C.ratio(rs, rj), 2) + '°' },
      { k: '150 mA 时线上拉力', v: fmt(F, 0) + ' N' }, { k: '关节上的力矩', v: fmt(F * rj / 10, 1) + ' N·cm' }]);
    const X = (a) => 40 + a / 360 * 320, Y = (mm) => 150 - mm / (2 * Math.PI * 14) * 130;
    const wheel = `M${X(0)} ${Y(0)} L${X(360)} ${Y(C.tendonMm(rs, 360))}`;
    const cr = Array.from({ length: 73 }, (_, i) => `${i ? 'L' : 'M'}${X(i * 5)} ${Y(C.crankPullMm(rs, i * 5))}`).join(' ');
    $('#plot', p).innerHTML = svg(380, 185, `
      <line class="axis" x1="40" y1="150" x2="366" y2="150"/><line class="axis" x1="40" y1="14" x2="40" y2="150"/>
      <text x="203" y="180" text-anchor="middle">舵机转角</text><text x="6" y="12">拉过来的线长（mm）</text>
      ${[0, 90, 180, 270, 360].map((a) => `<text x="${X(a)}" y="165" text-anchor="middle">${a}°</text>`).join('')}
      <path class="wave ${crank ? 'w-mu' : 'w-ac'}" d="${wheel}"/><path class="wave ${crank ? 'w-hi' : 'w-mu'}" d="${cr}"/>
      <text class="${crank ? 'f-mu' : 'f-ac'}" x="${X(250)}" y="${Y(C.tendonMm(rs, 250)) - 8}" text-anchor="end">卷线轮：一直往上</text>
      <text class="${crank ? 'f-hi' : 'f-mu'}" x="${X(196)}" y="${Y(2 * rs) - 8}">舵盘孔：最多 ${fmt(2 * rs, 0)} mm</text>
      <circle class="${crank ? 'f-hi' : 'f-ac'}" cx="${X(ang)}" cy="${Y(s.pulled)}" r="6"/>`, '卷线轮和舵盘孔两种固定方式下，拉过来的线长随舵机转角的变化');
    if (!crank && Math.abs(s.joint - 90) < 1.5) done(0);
    if (!crank && rj >= 8) done(1);
    if (crank && ang > 200) { seen.add(1); done(2); }
    api.sync();
  }
  root.append(el(`<div class="panel">${takeaway('线长守恒：线轴半径 × 舵机转角 = 滑轮半径 × 关节转角。线轴卷进多少线，关节那头就用掉多少。')}
    <p><b>大小线轴的取舍：</b>线轴越大，舵机转一点关节就转很多（快），但同样的电流，线上的拉力越小（力气小）。反过来也一样。上面最后两个读数就是在比这个。</p>
    <p><b>为什么不把线直接绑在舵盘孔上：</b>孔在绕圈，沿着线的方向最多只能拉“孔到中心距离的两倍”，转过 180° 线反而放回去；而且一根线收进的和另一根放出的长度对不上，会一边松一边紧。所以正式做都用卷线轮，两根线贴着圆周走，一收一放永远相等。</p>
    <p><b>这个式子什么时候不准：</b>它假设线不伸长、不打滑、一直贴着圆周。细线受力会被拉长一点；多个关节的手指上，通往指尖的线要路过根部关节，根部一弯，指尖会被带着动（叫耦合）。ORCA 的手靠走线位置和标定来处理这些。</p>
    ${basis([['公认', '弧长 = 半径 × 转角；线只能拉不能推，所以要成对。'], ['仓库', '半径 10 / 5 mm 的算例、舵盘孔最多拉 2r，来自 whj_MCU 的 路线图_腱绳手指.md 和 腱绳收紧确认.md。'], ['估算', '拉力那一栏同第 9 关，是粗估。'], ['示例数字', '10 mm、5 mm 是讲原理用的，不是你那只手上的实际尺寸。']])}</div>`));
  render();
  return { view: () => {
    const s = state();
    return { scene: 'finger', zoom: 1.25, spoolDeg: ang, jointDeg: s.joint, rs, rj, crank, hot: ['spool'], info: `舵机转 ${ang}°　卷进 ${fmt(s.pulled, 1)} mm　关节 ${fmt(s.joint, 0)}°` };
  } };
}
