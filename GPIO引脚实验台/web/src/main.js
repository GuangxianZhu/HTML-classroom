// 页面逻辑：十关，每关一个小实验；所有关卡共用上方的三维开发板
import * as C from './core.js';
import { createStage } from './stage.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const LEVEL_TEXT = { H: '3.3 V，高电平', L: '0 V，低电平', Z: '悬空，电压不确定', X: '短路' };

// ---------- 共用部件 ----------

// 引脚内部电路：上开关接电源，下开关接地，引脚外接电阻和 LED
const CIRCUIT_SVG = `
<svg viewBox="0 0 320 300" role="img" aria-label="引脚内部电路：上开关接电源，下开关接地，引脚外接电阻和 LED">
<circle class="glow" cx="268" cy="150" r="30"/>
<rect class="chipbox" x="60" y="48" width="132" height="204" rx="8"/>
<text x="68" y="66">芯片内部</text><text x="30" y="20">电源 3.3 V</text><text x="30" y="294">地 0 V</text>
<line class="wire w-top" x1="30" y1="30" x2="150" y2="30"/><line class="wire w-top" x1="120" y1="30" x2="120" y2="80"/>
<line class="wire w-upmid" x1="120" y1="116" x2="120" y2="150"/><line class="wire w-downmid" x1="120" y1="150" x2="120" y2="184"/>
<line class="wire w-bot" x1="120" y1="220" x2="120" y2="275"/><line class="wire w-bot" x1="30" y1="275" x2="290" y2="275"/>
<line class="wire w-pin" x1="120" y1="150" x2="200" y2="150"/>
<polyline class="wire w-load" points="200,150 208,150 212,142 220,158 228,142 236,158 240,150 254,150"/>
<line class="wire w-load" x1="268" y1="164" x2="268" y2="275"/>
<path class="flow main" d="M120 30 V150 H268 V275"/><path class="flow short" d="M120 30 V275"/>
<line class="lever up" x1="120" y1="116" x2="102" y2="84"/><line class="lever down" x1="120" y1="220" x2="102" y2="188"/>
<circle class="term" cx="120" cy="80" r="4"/><circle class="term" cx="120" cy="116" r="4"/>
<circle class="term" cx="120" cy="184" r="4"/><circle class="term" cx="120" cy="220" r="4"/>
<circle class="pad" cx="120" cy="150" r="3.5"/><rect class="pad" x="184" y="142" width="16" height="16" rx="2"/>
<text x="176" y="134">引脚</text><text x="134" y="102">上开关</text><text x="134" y="206">下开关</text>
<circle class="led" cx="268" cy="150" r="14"/><text class="ld" x="268" y="122" text-anchor="middle">LED</text>
<text class="ld" x="224" y="134" text-anchor="middle">电阻</text>
<rect class="hit h-up" x="92" y="70" width="92" height="56"/><rect class="hit h-down" x="92" y="174" width="92" height="56"/>
</svg>`;
const circuitState = (up, down) => (up && down ? 'short' : up ? 'high' : down ? 'low' : 'float');
function makeCircuit(host, onUp, onDown) {
  host.innerHTML = CIRCUIT_SVG;
  const svg = $('svg', host), lu = $('.lever.up', svg), ld = $('.lever.down', svg), hu = $('.h-up', svg), hd = $('.h-down', svg);
  if (onUp) { hu.addEventListener('click', onUp); hd.addEventListener('click', onDown); } else { hu.remove(); hd.remove(); }
  return (up, down) => {
    svg.setAttribute('class', 's-' + circuitState(up, down));
    lu.setAttribute('x2', up ? 120 : 102); lu.setAttribute('y2', up ? 80 : 84);
    ld.setAttribute('x2', down ? 120 : 102); ld.setAttribute('y2', down ? 184 : 188);
  };
}

// 一排 8 个位。onFlip 存在时格子可以点
function makeBits(host, { onFlip, lamps = false } = {}) {
  host.classList.add('reg');
  const cols = [];
  for (let n = 7; n >= 0; n--) {
    const col = el(`<div class="col"><span class="idx">位${n}</span>${onFlip
      ? `<button class="bit" aria-label="位 ${n}"></button>` : '<span class="bit"></span>'}${lamps
      ? `<span class="stem"></span><span class="lamp${C.LED_PINS.includes(n) ? '' : ' none'}"></span><span class="idx">P${n}</span>` : ''}</div>`);
    if (onFlip) $('.bit', col).addEventListener('click', () => onFlip(n));
    host.appendChild(col); cols[n] = col;
  }
  return (value, sel = -1, changed = 0) => {
    for (let n = 0; n < 8; n++) {
      const on = (value >> n) & 1, b = $('.bit', cols[n]);
      b.textContent = on; b.classList.toggle('on', !!on);
      cols[n].classList.toggle('on', !!on); cols[n].classList.toggle('sel', n === sel);
      cols[n].classList.toggle('chg', !!((changed >> n) & 1));
    }
  };
}

const takeaway = (t) => `<p class="take"><b>记住</b>${t}</p>`;

// ---------- 第 1 关：高低电平 ----------
function ch1(root, api) {
  let v = 3.3, last = 1;
  root.append(el(`<div class="panel">
    <p>引脚上只有一样东西：电压。把它想成水管里的水压，水压高记作 1，水压低记作 0。芯片不认识别的，所有“信号”最后都是这两种状态。</p>
    <div class="vbar" aria-hidden="true"><div class="zone z0">读成 0</div><div class="zone zx">不确定</div><div class="zone z1">读成 1</div><div class="thumb" id="vThumb"></div></div>
    <div class="scale"><span>0 V</span><span>${C.VIL.toFixed(2)} V</span><span>${C.VIH.toFixed(2)} V</span><span>3.3 V</span></div>
    <label class="slider" for="vIn">拖动改变引脚上的电压<input id="vIn" type="range" min="0" max="3.3" step="0.01" value="3.3"></label>
    <div class="readout" id="vRead"><span class="sub">引脚电压</span><span class="big" id="vBig"></span><p id="vWhy"></p></div>
  </div>`));
  root.append(el(`<div class="panel">${takeaway('芯片把电压分成三段：够高算 1，够低算 0，中间那段读出来不可信。所以电路设计要保证引脚电压总是待在两头。')}
    <p class="note">这里的两条分界线取的是电源电压的 30% 和 70%，这是常见 CMOS 芯片的典型值。每颗芯片的准确数值写在它的数据手册里。</p></div>`));
  const inp = $('#vIn', root);
  function render() {
    const now = C.readLevel(v, null);
    if (now !== null) last = now;
    const s = now === 1 ? 'high' : now === 0 ? 'low' : 'float';
    $('#vThumb', root).style.left = (v / 3.3 * 100) + '%';
    $('#vRead', root).className = 'readout ' + s;
    $('#vBig', root).textContent = v.toFixed(2) + ' V';
    $('#vWhy', root).textContent = now === 1 ? '高于上面那条线，芯片稳稳地读成 1。'
      : now === 0 ? '低于下面那条线，芯片稳稳地读成 0。'
        : `落在中间。芯片可能读成 0 也可能读成 1，通常是保持上一次的结果（现在是 ${last}），有一点噪声就会翻。`;
    api.sync();
  }
  inp.addEventListener('input', () => { v = +inp.value; render(); });
  render();
  return { view: () => ({ levels: [v >= C.VIH ? 'H' : v <= C.VIL ? 'L' : 'Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z'], leds: [v >= C.VIH], btn: false, sel: 0 }) };
}

// ---------- 第 2 关：两个开关 ----------
function ch2(root, api) {
  const TEXT = {
    high: ['3.3 V（高电平，记作 1）', '上开关把引脚接到电源。电流从电源出发，经过引脚、电阻、LED 流回地，灯亮。'],
    low: ['0 V（低电平，记作 0）', '下开关把引脚接到地。LED 两端没有电压差，没有电流，灯灭。'],
    float: ['不确定（悬空）', '两个开关都断开，引脚什么都没接上。这块板子上还有电阻和 LED 把它轻轻拉向地，灯不亮；如果外面什么都没接，电压就由噪声决定。'],
    short: ['短路！', '电源被直接接到地，大电流只在芯片内部流过，会烧坏芯片，灯反而不亮。真实芯片不会让代码做到这一步，原因在下一关。'],
  };
  let up = false, down = true; const seen = {};
  root.append(el(`<div class="panel">
    <p>一个引脚里面，对输出来说只有两个开关。上开关通向电源，下开关通向地。这一关由你亲手拨，点图里的开关或下面的按钮都可以。</p>
    <div class="circuit" id="c2"></div>
    <div class="switches"><button id="bUp">上开关<b></b></button><button id="bDown">下开关<b></b></button></div>
    <div class="readout" id="r2"><span class="sub">引脚电压</span><span class="big" id="v2"></span><p id="w2"></p></div>
  </div>`));
  root.append(el(`<div class="panel"><h3>试一试</h3><ul class="tasks" id="t2">
    <li data-s="high">让灯亮起来</li><li data-s="low">让灯灭掉，同时引脚稳定在 0 V</li>
    <li data-s="float">两个开关都断开，看引脚变成什么</li><li data-s="short">两个开关都闭合，看会出什么事</li></ul>
    ${takeaway('输出高电平就是“上开关闭合”，输出低电平就是“下开关闭合”。这两个开关在真实芯片里是一对 MOS 管，这种接法叫推挽。')}</div>`));
  const draw = makeCircuit($('#c2', root), () => { up = !up; render(true); }, () => { down = !down; render(true); });
  $('#bUp', root).addEventListener('click', () => { up = !up; render(true); });
  $('#bDown', root).addEventListener('click', () => { down = !down; render(true); });
  function render(byUser) {
    const s = circuitState(up, down);
    draw(up, down);
    $('#bUp', root).setAttribute('aria-pressed', up); $('#bDown', root).setAttribute('aria-pressed', down);
    $('#bUp b', root).textContent = up ? '闭合' : '断开'; $('#bDown b', root).textContent = down ? '闭合' : '断开';
    $('#r2', root).className = 'readout ' + s;
    $('#v2', root).textContent = TEXT[s][0]; $('#w2', root).textContent = TEXT[s][1];
    if (byUser) seen[s] = true;
    for (const li of $('#t2', root).children) li.classList.toggle('done', !!seen[li.dataset.s]);
    api.sync();
  }
  render(false);
  return { view: () => { const s = circuitState(up, down);
    return { levels: [{ high: 'H', low: 'L', float: 'L', short: 'X' }[s], 'Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z'], leds: [s === 'high'], btn: false, sel: 0 }; } };
}

// ---------- 第 3 关：寄存器 ----------
function ch3(root, api) {
  let value = 0x25, sel = 5;
  root.append(el(`<div class="panel">
    <p>你不用再拨开关了。芯片里有一排 8 个小格子，叫寄存器，每格连着一个引脚的那对开关。点格子把 0 改成 1，对应引脚的灯就亮。</p>
    <div id="reg3"></div>
    <dl class="values"><dt>二进制</dt><dd id="b3"></dd><dt>十六进制</dt><dd id="h3"></dd><dt>十进制</dt><dd id="d3"></dd></dl>
    <div class="ops"><button id="clr3">全部清 0</button><button id="set3">全部置 1</button><button id="inc3">加 1</button></div>
    <p class="note">连点几次“加 1”，灯会像数数一样变化。寄存器里存的就是一个普通的数，只是每一位都连着一根引脚。这块板子只在 P0 到 P5 上接了灯，P6 和 P7 留给后面的输入实验。</p>
  </div>`));
  root.append(el(`<div class="panel"><h3 id="t3"></h3><div class="circuit" id="c3"></div><p id="w3"></p>
    <p class="note">一个位同时管两个开关，而且让它们永远一开一关。所以上一关的悬空和短路，在输出模式下不会出现。</p></div>`));
  root.append(el(`<div class="panel"><h3>换成代码就是这一行</h3><pre id="code3"></pre>
    <p class="note">0x 开头的写法看不懂没关系，下一关专门讲。</p>
    ${takeaway('“控制引脚”就是“改寄存器里的数”。位 n 对应引脚 Pn，这就是你问的“有几个引脚，就有几个位”。')}</div>`));
  const drawBits = makeBits($('#reg3', root), { lamps: true, onFlip: (n) => { value ^= 1 << n; sel = n; render(); } });
  const draw = makeCircuit($('#c3', root));
  $('#clr3', root).addEventListener('click', () => { value = 0; render(); });
  $('#set3', root).addEventListener('click', () => { value = 0xFF; render(); });
  $('#inc3', root).addEventListener('click', () => { value = (value + 1) & 0xFF; render(); });
  function render() {
    drawBits(value, sel);
    $('#b3', root).textContent = '0b' + C.bin(value); $('#h3', root).textContent = C.hex(value); $('#d3', root).textContent = value;
    const bit = (value >> sel) & 1, led = C.LED_PINS.includes(sel);
    draw(!!bit, !bit);
    $('#c3', root).classList.toggle('noload', !led);
    $('#t3', root).textContent = `看进引脚 P${sel} 里面`;
    $('#w3', root).textContent = bit
      ? `位${sel} 是 1：上开关闭合，下开关断开，P${sel} 输出 3.3 V${led ? '，灯亮' : '（这个引脚上没接灯）'}。`
      : `位${sel} 是 0：上开关断开，下开关闭合，P${sel} 输出 0 V${led ? '，灯灭' : '（这个引脚上没接灯）'}。`;
    $('#code3', root).innerHTML = `OUT = ${C.hex(value)};   <span class="cm">// 输出数据寄存器</span>`;
    api.sync();
  }
  render();
  return {
    view: () => C.boardView({ clk: 1, dir: 0xFF, out: value, pull: 0, otype: 0 }, {}, sel),
    pick: (n) => { sel = n; render(); },
  };
}

// ---------- 数的写法：0x21 是什么 ----------
function chHex(root, api) {
  let value = 0x00; const seen = {};
  root.append(el(`<div class="panel">
    <p>上一关的 8 个格子，写成 00100001 太长了。程序员的办法是：从右往左每 4 个格子分一组，每组换成一个字符。<code>0x21</code> 就是这样来的，开头的 <code>0x</code> 只是个记号，意思是“后面这个数是按 4 位一组写的”（十六进制）。</p>
    <div class="nibs" id="nibs"></div>
    <div class="readout high"><span class="sub">合起来写成</span><span class="big" id="hxBig"></span><p id="hxWhy"></p></div>
  </div>`));
  root.append(el(`<div class="panel"><h3>每组怎么换成一个字符</h3>
    <p>一组里 4 个格子从左到右分别值 8、4、2、1。把是 1 的格子加起来就行。一组最大是 8+4+2+1 = 15，可是数字只有 0 到 9，所以 10 到 15 借用字母：</p>
    <div class="hexmap"><span>10 = A</span><span>11 = B</span><span>12 = C</span><span>13 = D</span><span>14 = E</span><span>15 = F</span></div>
  </div>`));
  root.append(el(`<div class="panel"><h3>试一试</h3><ul class="tasks" id="tHex">
    <li data-v="33">点格子，做出 0x21（P0 和 P5 亮）</li><li data-v="63">做出 0x3F（P0 到 P5 全亮）</li><li data-v="128">做出 0x80（只有 P7 是 1）</li></ul>
    ${takeaway('看到 0x3F，就拆成 3 和 F 两组：3 是 0011，F 是 1111，拼起来是 00111111，也就是位 0 到位 5 都是 1。')}</div>`));
  const nibs = $('#nibs', root), btn = [];
  for (const hi of [1, 0]) {
    const box = el(`<div class="nib"><span class="sub">${hi ? '左边一组（位 7 到 4）' : '右边一组（位 3 到 0）'}</span><div class="cells"></div><div class="sum"></div></div>`);
    for (let k = 3; k >= 0; k--) {
      const n = hi * 4 + k;
      const c = el(`<div class="cell"><span class="idx">位${n}</span><button class="bit" aria-label="位 ${n}"></button><span class="w">值 ${1 << k}</span></div>`);
      $('button', c).addEventListener('click', () => { value ^= 1 << n; render(true); });
      $('.cells', box).append(c); btn[n] = $('button', c);
    }
    nibs.append(box);
  }
  function render(byUser) {
    for (let n = 0; n < 8; n++) { const on = (value >> n) & 1; btn[n].textContent = on; btn[n].classList.toggle('on', !!on); }
    [...nibs.children].forEach((box, i) => {
      const v = i === 0 ? value >> 4 : value & 15, parts = [8, 4, 2, 1].filter((w) => v & w);
      const ch = v.toString(16).toUpperCase();
      $('.sum', box).innerHTML = `${parts.length ? parts.join(' + ') : '0'} = ${v}${v > 9 ? `，写成 <b>${ch}</b>` : `，写成 <b>${ch}</b>`}`;
    });
    $('#hxBig', root).textContent = C.hex(value);
    const lit = C.LED_PINS.filter((n) => (value >> n) & 1).map((n) => 'P' + n);
    $('#hxWhy', root).textContent = `也就是 ${C.bin(value)}。把它写进 OUT，${lit.length ? lit.join('、') + ' 的灯亮' : '没有灯亮'}。`;
    if (byUser) seen[value] = true;
    for (const li of $('#tHex', root).children) li.classList.toggle('done', !!seen[li.dataset.v]);
    api.sync();
  }
  render(false);
  return { view: () => C.boardView({ clk: 1, dir: 0xFF, out: value, pull: 0, otype: 0 }, {}, -1) };
}

// ---------- 地址：每个格子都有门牌号 ----------
function chAddr(root, api) {
  const BOX = [
    { key: 'a', addr: '0x2000_0000', name: '内存格子', kind: 'ram', v: 0 },
    { key: 'b', addr: '0x2000_0001', name: '内存格子', kind: 'ram', v: 0 },
    { key: 'out', addr: C.addrText(C.REG.OUT.addr), name: 'OUT 寄存器', kind: 'reg', v: 0 },
    { key: 'none', addr: '0x5000_0000', name: '这个门牌号后面没有东西', kind: 'none', v: null },
  ];
  const VALS = [0x00, 0x01, 0x21, 0x3F];
  let sel = 0, val = 0x21, msg = '', last = null; const seen = {};
  root.append(el(`<div class="panel">
    <p>CPU 其实只会两个动作：往一个有编号的格子里<b>存</b>一个数，或者从一个有编号的格子里<b>取</b>一个数。这个编号就是地址，可以当成门牌号。</p>
    <p>大部分格子是内存，只负责记住数。少数几个格子后面连着硬件，前面见过的 OUT 寄存器就是其中一个。</p>
    <span class="sub">第一步：选一个门牌号</span>
    <div class="lockers" id="lockers"></div>
    <span class="sub">第二步：选要存的数</span>
    <div class="seg" id="vals"></div>
    <div class="envelope"><div><span class="sub">门牌号（走地址总线）</span><b id="envA"></b></div><div><span class="sub">要存的数（走数据总线）</span><b id="envD"></b></div></div>
    <div class="ops"><button class="primary" id="store">存进去</button></div>
    <p class="msg" id="addrMsg" aria-live="polite"></p>
  </div>`));
  root.append(el(`<div class="panel"><h3>试一试</h3><ul class="tasks" id="tAddr">
    <li data-s="ram">往内存格子存一个数，看灯有没有反应</li><li data-s="reg">往 OUT 存 0x21，看灯</li><li data-s="none">往没有东西的门牌号存一个数</li></ul>
    ${takeaway('寄存器就是一个有门牌号的格子，只是它后面连着硬件。“总线”就是送信的路：地址总线送门牌号，数据总线送要存的数。')}
    <p class="note">这一关已经替你把时钟和方向设好了，所以往 OUT 存数马上就能看到灯。真实代码里，<code>OUT</code> 这个名字就是门牌号的外号：</p>
    <pre>#define OUT (*(volatile uint8_t*)0x40002004)</pre></div>`));
  const lk = $('#lockers', root), vs = $('#vals', root);
  BOX.forEach((b, i) => { const r = el(`<button class="locker"><span class="mono a">${b.addr}</span><span class="nm">${b.name}${b.kind === 'reg' ? '<i class="tag">连着引脚</i>' : ''}</span><span class="mono v"></span></button>`);
    r.addEventListener('click', () => { sel = i; last = null; msg = ''; render(); }); lk.append(r); });
  VALS.forEach((v) => { const b = el(`<button>${C.hex(v)}</button>`); b.addEventListener('click', () => { val = v; last = null; msg = ''; render(); }); vs.append(b); });
  function render() {
    [...lk.children].forEach((r, i) => { r.setAttribute('aria-pressed', i === sel); r.classList.toggle('hitnow', last === i);
      $('.v', r).textContent = BOX[i].v === null ? '' : C.hex(BOX[i].v); });
    [...vs.children].forEach((b, i) => b.setAttribute('aria-pressed', VALS[i] === val));
    $('#envA', root).textContent = BOX[sel].addr; $('#envD', root).textContent = `${C.hex(val)}（${C.bin(val)}）`;
    $('#addrMsg', root).textContent = msg || '选好门牌号和数，按“存进去”。';
    for (const li of $('#tAddr', root).children) li.classList.toggle('done', !!seen[li.dataset.s]);
    api.sync();
  }
  $('#store', root).addEventListener('click', () => {
    const b = BOX[sel]; last = sel; seen[b.kind === 'reg' ? (val === 0x21 ? 'reg' : 'reg0') : b.kind] = true;
    if (b.kind === 'none') msg = '没有任何格子的门牌号是这个，这封信没人收。什么都没发生。';
    else { b.v = val;
      msg = b.kind === 'ram' ? `${b.addr} 这个内存格子记下了 ${C.hex(val)}。仅此而已，内存不连任何东西，灯没有反应。`
        : `OUT 收下了 ${C.hex(val)}。它的每一位都连着一个引脚的开关，所以板子上的灯马上跟着变了。同样是“存一个数”，只因为门牌号不同，结果就不同。`; }
    render();
  });
  render();
  return { view: () => C.boardView({ clk: 1, dir: 0x3F, out: BOX[2].v, pull: 0, otype: 0 }, {}, -1) };
}

// ---------- 一行代码怎么走到引脚（精简版：每次只亮一站） ----------
function chCode(root, api) {
  const PROG = [
    [{ reg: 'CLK', op: '=', val: 0x01 }, '打开 GPIO 的时钟'],
    [{ reg: 'DIR', op: '=', val: 0x3F }, 'P0 到 P5 设为输出'],
    [{ reg: 'OUT', op: '=', val: 0x21 }, '点亮 P0 和 P5'],
  ];
  const ST = ['CPU 读到这一行', '信上路', '寄存器收信', '引脚跟着变'];
  let st;
  root.append(el(`<div class="panel">
    <p>前两关的东西合起来，就是一行代码做的事：<code>OUT = 0x21;</code> 的意思是“往 OUT 的门牌号存 0x21”。下面三行程序，每按一次只往前走一站，只看亮着的那一站就行。</p>
    <ol class="code" id="codeC"></ol>
    <ol class="stations" id="stC"></ol>
    <div class="dock"><div class="ops"><button class="primary" id="nextC">下一步</button><button id="resetC">重来</button></div></div>
  </div>`));
  root.append(el(`<div class="panel">${takeaway('一行赋值 = 一封信：门牌号是寄存器的地址，信里是要存的数。寄存器收下，引脚就变。CPU 不需要知道“引脚”这回事。')}
    <p class="note">三行的顺序有讲究：先开时钟，寄存器才肯收信；再设方向，引脚才变成输出；最后写数据。漏掉一步会怎样，后面“踩坑”那一关专门讲。</p></div>`));
  const codeEl = $('#codeC', root), stEl = $('#stC', root);
  PROG.forEach(([s, cm]) => codeEl.append(el(`<li><code>${C.stmtText(s)}</code><span class="cm">// ${cm}</span></li>`)));
  ST.forEach((t, i) => stEl.append(el(`<li><span class="n">${i + 1}</span><div><b>${t}</b><p class="d"></p></div></li>`)));
  const litList = (chip) => { const a = C.boardView(chip).leds.map((on, i) => (on ? 'P' + i : '')).filter(Boolean); return a.length ? a.join('、') + ' 的灯亮了' : '还没有灯亮'; };
  function detail(k) {
    const [s] = PROG[st.pc], R = C.REG[s.reg], A = C.addrText(R.addr);
    if (k === 0) return `<code>${C.stmtText(s)}</code> 意思是：往 ${s.reg} 的门牌号存 ${C.hex(s.val)}。`;
    if (k === 1) return `门牌号 <span class="mono">${A}</span> 走地址总线，数 <span class="mono">${C.hex(s.val)}</span>（${C.bin(s.val)}）走数据总线。`;
    if (k === 2) return `只有 ${s.reg} 的门牌号对得上，它把 ${C.hex(s.val)} 存进自己的 8 个格子：<span class="mono hl">${C.bin(s.val)}</span>`;
    if (s.reg === 'CLK') return '时钟开了，GPIO 开始工作，以后的信它才会收。引脚暂时没变。';
    if (s.reg === 'DIR') return 'P0 到 P5 变成输出，里面的开关开始听 OUT 的。OUT 现在是 0，所以这六条走线变成蓝色（0 V）。';
    return `OUT 的格子直接连着开关：是 1 的位，引脚输出 3.3 V。${litList(st.chip)}。`;
  }
  function reset() { st = { pc: 0, k: -1, chip: C.createChip(), shown: C.createChip() }; render(); }
  function next() {
    if (st.pc >= PROG.length) return;
    st.k++;
    if (st.k === 2) C.exec(st.chip, PROG[st.pc][0]);
    if (st.k === 3) st.shown = C.cloneChip(st.chip);
    if (st.k > 3) { st.pc++; st.k = st.pc < PROG.length ? 0 : 4; }
    render();
  }
  function render() {
    const end = st.pc >= PROG.length;
    [...codeEl.children].forEach((li, i) => { li.classList.toggle('cur', !end && i === st.pc && st.k >= 0); li.classList.toggle('past', i < st.pc); });
    [...stEl.children].forEach((li, i) => {
      const act = !end && i === st.k;
      li.classList.toggle('act', act); li.classList.toggle('past', !end && i < st.k);
      $('.d', li).innerHTML = act ? detail(i) : '';
    });
    $('#nextC', root).disabled = end;
    $('#nextC', root).textContent = end ? '程序跑完了' : st.k < 0 ? '开始' : st.k === 3 ? (st.pc === PROG.length - 1 ? '完成' : '下一行') : '下一步';
    api.sync();
  }
  $('#nextC', root).addEventListener('click', next);
  $('#resetC', root).addEventListener('click', reset);
  reset();
  return { view: () => C.boardView(st.shown, {}, -1) };
}

// ---------- 只改一位：|= 和 &= ~ ----------
function chBit(root, api) {
  let out = 0x21, mask = 0, mode = 'or'; const seen = {};
  root.append(el(`<div class="panel">
    <p><code>OUT = 0x21;</code> 会把 8 个格子一次全部重写。如果只想多点亮一盏灯，别的灯保持原样，就要用另外两种写法。它们看着吓人，其实只是在说“我只动我点名的那几位”。</p>
    <div class="seg" role="group" aria-label="想做什么"><button id="mOr">点亮几位（|=）</button><button id="mAnd">熄灭几位（&amp;= ~）</button></div>
    <div class="rows3">
      <span class="sub">OUT 现在的值</span><div id="rOld"></div>
      <span class="sub" id="pickLbl"></span><div id="rMask"></div>
      <span class="sub">执行之后</span><div id="rNew"></div>
    </div>
    <p id="bitRule"></p>
    <pre id="bitCode"></pre>
    <div class="ops"><button class="primary" id="bitRun">执行这一行</button><button id="bitReset">重来</button></div>
    <p class="note" id="bitCmp"></p>
  </div>`));
  root.append(el(`<div class="panel"><h3>CPU 实际上分三步做</h3>
    <p>CPU 没办法只碰一个格子，它只会整格取、整格存。所以这一行在机器里是三步：</p>
    <ol class="plain" id="rmw3"></ol>
    <p class="note">记住“读、改、写是三步”这件事，最后一关会用到。</p></div>`));
  root.append(el(`<div class="panel"><h3>试一试</h3><ul class="tasks" id="tBit">
    <li data-s="or">再点亮 P1，原来亮着的灯不能灭</li><li data-s="and">只熄灭 P0，别的灯不能变</li></ul>
    ${takeaway('<code>OUT |= 数</code>：数里是 1 的位被点亮，其余不动。<code>OUT &= ~数</code>：数里是 1 的位被熄灭，其余不动。符号不用背，记住“点名”就行。')}</div>`));
  const dOld = makeBits($('#rOld', root)), dNew = makeBits($('#rNew', root));
  const dMask = makeBits($('#rMask', root), { onFlip: (n) => { mask ^= 1 << n; render(); } });
  const nv = () => (mode === 'or' ? out | mask : out & ~mask) & 0xFF;
  function render() {
    const or = mode === 'or', r = nv();
    $('#mOr', root).setAttribute('aria-pressed', or); $('#mAnd', root).setAttribute('aria-pressed', !or);
    $('#pickLbl', root).textContent = or ? '点名：点你想点亮的位' : '点名：点你想熄灭的位';
    dOld(out); dMask(mask); dNew(r, -1, r ^ out);
    $('#bitRule', root).textContent = or ? '规则：被点名的位变成 1，没点名的位照抄上面一行。' : '规则：被点名的位变成 0，没点名的位照抄上面一行。';
    $('#bitCode', root).innerHTML = `OUT ${or ? '|=' : '&= ~'}${or ? ' ' : ''}${C.hex(mask)};   <span class="cm">// 点名的位写成一个数就是 ${C.hex(mask)}</span>`;
    $('#bitCmp', root).textContent = mask ? `对比一下：如果偷懒直接写 OUT = ${C.hex(mask)};，结果会是 ${C.bin(mask)}，没点名的灯全被改掉了。` : '先在中间一行点名。';
    $('#bitRun', root).disabled = !mask;
    $('#rmw3', root).innerHTML = `<li>读：把 OUT 整格取出来，拿到 <span class="mono">${C.bin(out)}</span></li><li>改：在 CPU 手里把点名的位${or ? '变成 1' : '变成 0'}，得到 <span class="mono">${C.bin(r)}</span></li><li>写：把 <span class="mono">${C.bin(r)}</span> 整格存回 OUT</li>`;
    for (const li of $('#tBit', root).children) li.classList.toggle('done', !!seen[li.dataset.s]);
    api.sync();
  }
  $('#mOr', root).addEventListener('click', () => { mode = 'or'; mask = 0; render(); });
  $('#mAnd', root).addEventListener('click', () => { mode = 'and'; mask = 0; render(); });
  $('#bitRun', root).addEventListener('click', () => {
    const before = out; out = nv();
    if (mode === 'or' && mask === 0x02 && (before & 0x02) === 0) seen.or = true;
    if (mode === 'and' && mask === 0x01 && (before & 0x01)) seen.and = true;
    mask = 0; render();
  });
  $('#bitReset', root).addEventListener('click', () => { out = 0x21; mask = 0; render(); });
  render();
  return { view: () => C.boardView({ clk: 1, dir: 0x3F, out, pull: 0, otype: 0 }, {}, -1) };
}

// ---------- 第 5 关：输入 ----------
const INPUT_SVG = `
<svg viewBox="0 0 320 250" role="img" aria-label="输入引脚：内部上拉电阻，外接按键到地">
<rect class="chipbox" x="24" y="44" width="170" height="166" rx="8"/><text x="32" y="62">芯片内部</text>
<text x="30" y="20">电源 3.3 V</text><text x="30" y="246">地 0 V</text>
<line class="wire w-vdd" x1="30" y1="30" x2="170" y2="30"/><line class="wire w-vdd" x1="130" y1="30" x2="130" y2="58"/>
<line class="lever pull" x1="130" y1="86" x2="114" y2="62"/>
<circle class="term" cx="130" cy="58" r="4"/><circle class="term" cx="130" cy="86" r="4"/>
<polyline class="wire w-pull" points="130,86 130,96 123,100 137,108 123,116 137,124 130,128 130,150"/>
<text x="142" y="76">上拉开关</text><text x="142" y="114">上拉电阻</text>
<line class="wire w-pin" x1="70" y1="150" x2="250" y2="150"/>
<polygon class="buf" points="70,138 70,162 50,150"/><text x="34" y="182">读进 IN</text><text class="inbit" x="40" y="154" text-anchor="middle" id="inBit">?</text>
<circle class="pad" cx="130" cy="150" r="3.5"/><rect class="pad" x="186" y="142" width="16" height="16" rx="2"/><text x="180" y="134">P7</text>
<line class="wire w-pin" x1="250" y1="150" x2="250" y2="170"/>
<line class="lever btn" x1="250" y1="204" x2="234" y2="176"/>
<circle class="term" cx="250" cy="170" r="4"/><circle class="term" cx="250" cy="204" r="4"/>
<line class="wire" x1="250" y1="204" x2="250" y2="230"/><line class="wire" x1="30" y1="230" x2="290" y2="230"/>
<text x="262" y="192">按键</text>
</svg>`;
function ch5(root, api) {
  let pull = false, btn = false, timer = 0; const hist = [];
  root.append(el(`<div class="panel">
    <p>反过来，让芯片“看”外面。把引脚设成输入后，两个开关都断开，引脚只负责量电压，结果出现在 IN 寄存器里。板子上 P7 接了一个按键，按下时把引脚接到地。</p>
    <div class="circuit" id="c5">${INPUT_SVG}</div>
    <div class="switches"><button id="bBtn">按键<b></b></button><button id="bPull">内部上拉<b></b></button></div>
    <div class="readout" id="r5"><span class="sub">P7 上的电压</span><span class="big" id="v5"></span><p id="w5"></p></div>
    <p class="sub">程序每 0.2 秒读一次 IN 的位 7，最近 32 次的结果：</p>
    <div class="strip" id="strip5" aria-hidden="true"></div>
    <pre>if ((IN &amp; 0x80) == 0) {   <span class="cm">// 位 7 是 0</span>
    <span class="cm">// 按键被按下了</span>
}</pre>
  </div>`));
  root.append(el(`<div class="panel"><h3>试一试</h3><ul class="tasks" id="t5">
    <li data-s="z">不开上拉、不按按键，看读数乱跳</li><li data-s="h">打开上拉，读数稳定在 1</li><li data-s="l">开着上拉按下按键，读数变成 0</li></ul>
    ${takeaway('输入引脚不能悬空，要用上拉或下拉电阻给它一个默认电平。这种接法下，按下读到的是 0，松开读到的是 1，和直觉相反。')}
    <p class="note">上拉电阻阻值很大（几十千欧），只能轻轻把引脚拉到 3.3 V。按键一按，引脚被直接接地，电阻拉不过，电压就变成 0 V，流过电阻的电流也很小。</p></div>`));
  const svg = $('#c5 svg', root), seen = {};
  const chip = () => ({ clk: 1, dir: 0, out: 0, pull: pull ? 0x80 : 0, otype: 0 });
  function render() {
    const s = C.pinState(chip(), C.BTN_PIN, { btn });
    svg.setAttribute('class', 's-' + s.level + (pull ? ' pull-on' : ''));
    $('.lever.pull', svg).setAttribute('x2', pull ? 130 : 114); $('.lever.pull', svg).setAttribute('y2', pull ? 58 : 62);
    $('.lever.btn', svg).setAttribute('x2', btn ? 250 : 234); $('.lever.btn', svg).setAttribute('y2', btn ? 170 : 176);
    $('#bBtn', root).setAttribute('aria-pressed', btn); $('#bPull', root).setAttribute('aria-pressed', pull);
    $('#bBtn b', root).textContent = btn ? '按下' : '松开'; $('#bPull b', root).textContent = pull ? '接上' : '断开';
    $('#r5', root).className = 'readout ' + { H: 'high', L: 'low', Z: 'float' }[s.level];
    $('#v5', root).textContent = { H: '3.3 V，读成 1', L: '0 V，读成 0', Z: '不确定，读数乱跳' }[s.level];
    $('#w5', root).textContent = s.level === 'Z' ? '引脚什么都没接上，像一根天线。手靠近、旁边的线有信号，都会让它变。程序会以为按键在被乱按。'
      : s.level === 'H' ? '上拉电阻把引脚轻轻拉到 3.3 V。没人按按键时，读数稳稳地是 1。'
        : pull ? '按键把引脚直接接到地，上拉电阻拉不过它。读数是 0，表示“按下”。' : '按键把引脚接到地，读数是 0。松开后又会回到悬空。';
    seen[s.level.toLowerCase()] = true;
    for (const li of $('#t5', root).children) li.classList.toggle('done', !!seen[li.dataset.s] && (li.dataset.s !== 'l' || seen.lp));
    api.sync();
  }
  function sample() {
    const v = (C.readIN(chip(), { btn, noise: () => (Math.random() < 0.5 ? 1 : 0) }) >> 7) & 1;
    hist.push(v); if (hist.length > 32) hist.shift();
    $('#inBit', root).textContent = v;
    $('#strip5', root).innerHTML = hist.map((b) => `<i class="${b ? 'one' : 'zero'}">${b}</i>`).join('');
  }
  $('#bBtn', root).addEventListener('click', () => { btn = !btn; if (btn && pull) seen.lp = true; render(); sample(); });
  $('#bPull', root).addEventListener('click', () => { pull = !pull; if (btn && pull) seen.lp = true; render(); sample(); });
  render(); for (let i = 0; i < 32; i++) sample();
  return {
    view: () => C.boardView(chip(), { btn }, C.BTN_PIN),
    enter: () => { timer = setInterval(sample, 200); },
    leave: () => clearInterval(timer),
  };
}

// ---------- 第 6 关：配置和踩坑 ----------
function ch6(root, api) {
  const LINES = [['CLK', { reg: 'CLK', op: '=', val: 1 }, '打开时钟'], ['DIR', { reg: 'DIR', op: '=', val: 0x3F }, 'P0 到 P5 设为输出'], ['OUT', { reg: 'OUT', op: '=', val: 0x15 }, '点亮 P0、P2、P4']];
  const on = { CLK: false, DIR: true, OUT: true };
  let hot = false, btn = false, chip = C.createChip();
  root.append(el(`<div class="panel">
    <p>想让灯亮，要按顺序做三件事：开时钟、设方向、写数据。少一件，灯就不亮，而且芯片不会告诉你哪里错了。下面的程序故意漏了一行，先看结果，再把它补上。</p>
    <div class="lines" id="lines6"></div>
    <table class="map"><thead><tr><th>寄存器</th><th>程序想写</th><th>实际的值</th></tr></thead><tbody id="map6"></tbody></table>
    <div class="readout" id="r6"><span class="sub">结果</span><span class="big" id="v6"></span><p id="w6"></p></div>
  </div>`));
  root.append(el(`<div class="panel"><h3>另一个坑：输出脚被外面接到地</h3>
    <p>P7 接着按键。如果程序把 P7 也设成输出并输出高电平，按键一按会怎样？</p>
    <div class="switches"><button id="bHot">P7 设成输出高<b></b></button><button id="bBtn6">按键<b></b></button></div>
    <div class="readout" id="r6b"><span class="sub">P7</span><span class="big" id="v6b"></span><p id="w6b"></p></div>
    ${takeaway('灯不亮先查三样：时钟开了吗、方向设了吗、数据写对了吗。接着按键、传感器的引脚不要设成输出。')}
    <p class="note">时钟这一步在不同芯片上差别最大。STM32 这类芯片每个外设都要先开时钟；有些小芯片上电后 GPIO 就能用。具体要查你那颗芯片的手册。</p></div>`));
  const linesEl = $('#lines6', root), mapEl = $('#map6', root);
  LINES.forEach(([k, s, cm]) => {
    const row = el(`<label class="line"><input type="checkbox" id="ck6${k}" ${on[k] ? 'checked' : ''}><code>${C.stmtText(s)}</code><span class="cm">// ${cm}</span></label>`);
    $('input', row).addEventListener('change', (e) => { on[k] = e.target.checked; render(); });
    linesEl.append(row);
    mapEl.append(el(`<tr data-r="${k}"><td><b>${k}</b> ${C.REG[k].zh}</td><td class="want mono"></td><td class="val mono"></td></tr>`));
  });
  function render() {
    chip = C.createChip();
    for (const [k, s] of LINES) if (on[k]) C.exec(chip, s);
    if (hot) { C.write(chip, 'DIR', chip.dir | 0x80); C.write(chip, 'OUT', chip.out | 0x80); }
    for (const [k, s] of LINES) {
      const tr = $(`tr[data-r="${k}"]`, mapEl), real = k === 'CLK' ? chip.clk : chip[k.toLowerCase()] & 0x7F;
      $('.want', tr).textContent = on[k] ? C.hex(s.val) : '没写';
      $('.val', tr).textContent = C.hex(real);
      tr.classList.toggle('bad', on[k] && real !== s.val);
    }
    const lit = C.boardView(chip).leds.filter(Boolean).length;
    const r = $('#r6', root);
    let big, why, cls = 'low';
    if (lit === 3) { big = '三盏灯亮了'; why = '三步都做了，P0、P2、P4 按 0x15 亮起来。'; cls = 'high'; }
    else if (!on.CLK) { big = '灯不亮'; why = '时钟没开，后面所有写入都被忽略。寄存器还是 0，也没有任何报错。这是新手最常卡住的地方。'; }
    else if (!on.DIR) { big = '灯不亮'; why = on.OUT ? 'OUT 里确实存进了 0x15，但 DIR 还是 0，引脚仍然是输入，里面的开关都断开，数送不到引脚上。' : '时钟开了，但方向和数据都没写。'; }
    else if (!on.OUT) { big = '灯不亮'; why = '引脚已经是输出了，但 OUT 是 0，所以六个引脚都在输出 0 V。'; }
    else { big = '灯不亮'; why = '检查一下三行是不是都勾上了。'; }
    r.className = 'readout ' + cls; $('#v6', root).textContent = big; $('#w6', root).textContent = why;
    const p7 = C.pinState(chip, 7, { btn });
    $('#bHot', root).setAttribute('aria-pressed', hot); $('#bBtn6', root).setAttribute('aria-pressed', btn);
    $('#bHot b', root).textContent = hot ? '是' : '否'; $('#bBtn6 b', root).textContent = btn ? '按下' : '松开';
    $('#r6b', root).className = 'readout ' + { H: 'high', L: 'low', Z: 'float', X: 'short' }[p7.level];
    $('#v6b', root).textContent = p7.short ? '短路！' : LEVEL_TEXT[p7.level];
    $('#w6b', root).textContent = hot && !chip.clk ? '时钟没开，这次设置同样被忽略了，P7 还是输入。先把上面 CLK 那一行勾上。'
      : p7.short ? '上开关把 P7 接到电源，按键又把它接到地，电源直接对地短路。轻则引脚烧坏，重则整颗芯片报废。'
      : hot ? 'P7 正在输出 3.3 V。现在没事，但只要有人按下按键就会短路。' : btn ? 'P7 是输入，按键按下只是把它拉到 0 V，没有危险。' : 'P7 是输入，没开上拉，所以悬空。';
    api.sync();
  }
  $('#bHot', root).addEventListener('click', () => { hot = !hot; render(); });
  $('#bBtn6', root).addEventListener('click', () => { btn = !btn; render(); });
  render();
  return { view: () => C.boardView(chip, { btn }, hot || btn ? 7 : -1) };
}

// ---------- 第 7 关：进阶 ----------
function ch7(root, api) {
  // 开漏
  let mode = 'od', a = 1, b = 1;
  root.append(el(`<div class="panel"><h3>开漏：只会拉低，不会推高</h3>
    <p>有时候几个芯片要共用一根线（比如 I²C）。如果大家都用推挽，一个输出高、一个输出低，就短路了。开漏的做法是把上开关拿掉，高电平交给一个外接的上拉电阻。</p>
    <div class="seg" role="group" aria-label="输出类型"><button id="mOd">开漏</button><button id="mPp">推挽</button></div>
    <div class="line2" id="odLine"><span class="sub">共用的这根线</span><b id="odLv"></b></div>
    <div class="switches"><button id="dA">芯片 A<b></b></button><button id="dB">芯片 B<b></b></button></div>
    <p id="odWhy"></p>
    ${takeaway('开漏输出写 1 的意思是“放手”，线上的高电平是电阻给的。谁拉低，整根线就是低，永远不会短路。')}</div>`));
  function renderOd() {
    const od = mode === 'od';
    $('#mOd', root).setAttribute('aria-pressed', od); $('#mPp', root).setAttribute('aria-pressed', !od);
    const txt = (v) => (od ? (v ? '放手' : '拉低') : (v ? '输出高' : '输出低'));
    $('#dA b', root).textContent = txt(a); $('#dB b', root).textContent = txt(b);
    $('#dA', root).setAttribute('aria-pressed', !a); $('#dB', root).setAttribute('aria-pressed', !b);
    const short = !od && a !== b, lv = short ? 'X' : (a && b ? 'H' : 'L');
    $('#odLine', root).className = 'line2 ' + { H: 'high', L: 'low', X: 'short' }[lv];
    $('#odLv', root).textContent = short ? '短路！' : LEVEL_TEXT[lv];
    $('#odWhy', root).textContent = short ? '一个把线接到电源，一个把线接到地，电流直接从 A 灌进 B。这就是推挽不能共用一根线的原因。'
      : od ? (a && b ? '两个都放手，上拉电阻把线拉到 3.3 V。' : '有人拉低，线就是 0 V。另一个放手的芯片不受影响，它还能从线上读到“有人在拉低”。')
        : '两个输出一样，暂时没事。把其中一个改掉试试。';
  }
  $('#mOd', root).addEventListener('click', () => { mode = 'od'; renderOd(); });
  $('#mPp', root).addEventListener('click', () => { mode = 'pp'; renderOd(); });
  $('#dA', root).addEventListener('click', () => { a ^= 1; renderOd(); });
  $('#dB', root).addEventListener('click', () => { b ^= 1; renderOd(); });

  // 读-改-写竞争
  let rm;
  root.append(el(`<div class="panel"><h3>读、改、写中间被打断</h3>
    <p>“改一位”那一关讲过，<code>OUT |= 0x01</code> 在机器里要走“读、改、写”三步。主程序想点亮 P0，中断程序想点亮 P1。你来决定中断在哪一刻插进来。</p>
    <div class="seg" role="group" aria-label="写法"><button id="rmA">OUT |= 写法</button><button id="rmB">SET 寄存器写法</button></div>
    <div class="two">
      <div><span class="sub">主程序</span><ol class="code" id="rmMain"></ol></div>
      <div><span class="sub">中断程序</span><ol class="code" id="rmIsr"></ol></div>
    </div>
    <div class="two"><div><span class="sub">OUT 寄存器</span><div id="rmBits"></div></div><div><span class="sub">CPU 手里的临时值</span><p class="mono big2" id="rmTmp"></p></div></div>
    <p class="msg" id="rmMsg" aria-live="polite"></p>
    <div class="ops"><button class="primary" id="rmStep">主程序走一步</button><button id="rmInt">现在来中断</button><button id="rmReset">重来</button></div>
    ${takeaway('“读、改、写”不是一个动作，中间被打断就可能把别人的修改盖掉。专门的置位、清零寄存器一次写入只动指定的位，不需要先读。')}
    <p class="note">STM32 上这个寄存器叫 BSRR。厂商的库函数（比如 HAL_GPIO_WritePin）内部用的就是它，所以平时用库函数不会踩到这个坑。</p></div>`));
  const drawRm = makeBits($('#rmBits', root));
  const MAIN = { rmw: [['读', 'tmp = OUT;'], ['改', 'tmp = tmp | 0x01;'], ['写', 'OUT = tmp;']], set: [['写', 'SET = 0x01;']] };
  function resetRm(m) {
    rm = { mode: m || (rm ? rm.mode : 'rmw'), k: 0, isr: false, out: 0, tmp: null, isrAt: -1, msg: 'OUT 一开始是 0。先让主程序走一步，再挑一个时刻按“现在来中断”。' };
    renderRm();
  }
  function renderRm() {
    const steps = MAIN[rm.mode];
    $('#rmA', root).setAttribute('aria-pressed', rm.mode === 'rmw'); $('#rmB', root).setAttribute('aria-pressed', rm.mode === 'set');
    $('#rmMain', root).innerHTML = steps.map(([t, c], i) => `<li class="${i < rm.k ? 'past' : ''}${i === rm.k ? ' cur' : ''}"><code>${c}</code><span class="cm">// ${t}</span></li>`).join('');
    $('#rmIsr', root).innerHTML = `<li class="${rm.isr ? 'past' : ''}"><code>${rm.mode === 'rmw' ? 'OUT |= 0x02;' : 'SET = 0x02;'}</code><span class="cm">// 点亮 P1</span></li>`;
    drawRm(rm.out);
    $('#rmTmp', root).textContent = rm.tmp === null ? '还没有' : C.hex(rm.tmp);
    const done = rm.k >= steps.length && rm.isr;
    let msg = rm.msg;
    if (done) {
      const ok = rm.out === 0x03;
      msg += ok ? (rm.mode === 'set' ? ' 结果是 0x03，两盏灯都亮。SET 写法不管中断什么时候来都不会丢。' : ' 结果是 0x03，两盏灯都亮。这次中断来的时机刚好不碍事，换个时机再试。')
        : ' 结果是 0x01，P1 没亮。中断改过的 OUT 被主程序手里的旧值盖掉了。这种错误时有时无，很难查。';
    }
    $('#rmMsg', root).textContent = msg; $('#rmMsg', root).classList.toggle('bad', done && rm.out !== 0x03);
    $('#rmStep', root).disabled = rm.k >= steps.length; $('#rmInt', root).disabled = rm.isr;
    api.sync();
  }
  $('#rmStep', root).addEventListener('click', () => {
    if (rm.mode === 'set') { rm.out |= 0x01; rm.msg = '主程序往 SET 写 0x01。硬件只把位 0 变成 1，别的位原样不动，一步完成。'; }
    else if (rm.k === 0) { rm.tmp = rm.out; rm.msg = `读：主程序把 OUT 现在的值 ${C.hex(rm.out)} 抄到手里。`; }
    else if (rm.k === 1) { rm.tmp |= 0x01; rm.msg = `改：在手里把位 0 变成 1，得到 ${C.hex(rm.tmp)}。OUT 本身还没动。`; }
    else { rm.out = rm.tmp; rm.msg = `写：把手里的 ${C.hex(rm.tmp)} 整个写回 OUT。`; }
    rm.k++; renderRm();
  });
  $('#rmInt', root).addEventListener('click', () => {
    rm.out |= 0x02; rm.isr = true; rm.isrAt = rm.k;
    rm.msg = '中断来了：主程序被暂停，中断程序把 OUT 的位 1 变成 1，然后把 CPU 还给主程序。' + (rm.mode === 'rmw' && rm.k > 0 && rm.k < 3 ? '注意主程序手里还拿着中断之前读的旧值。' : '');
    renderRm();
  });
  $('#rmReset', root).addEventListener('click', () => resetRm());
  $('#rmA', root).addEventListener('click', () => resetRm('rmw'));
  $('#rmB', root).addEventListener('click', () => resetRm('set'));

  root.append(el(`<div class="panel"><h3>学到这里，再回头看真实芯片</h3>
    <p>这个实验台用的是一颗虚构的简化芯片。换到你手上的芯片时，原理不变，下面这些细节会不一样：</p>
    <ul class="plain">
      <li>引脚按端口分组（GPIOA、GPIOB……），每个端口各有一套寄存器。</li>
      <li>配置寄存器里一个引脚常常占 2 位或 4 位，因为模式不止两种（输入、输出、复用、模拟）。</li>
      <li>寄存器的名字和地址每家都不同。这里的 DIR、OUT、IN 在 STM32 上大致对应 MODER、ODR、IDR。</li>
      <li>时钟开关通常在另一个外设里（STM32 叫 RCC），不在 GPIO 自己的地址段。</li>
      <li>每个引脚能提供的电流有限，一般是几毫安到二十几毫安，驱动电机、继电器要加三极管或驱动芯片。</li>
    </ul></div>`));
  renderOd(); resetRm('rmw');
  return { view: () => C.boardView({ clk: 1, dir: 0x3F, out: rm.out, pull: 0, otype: 0 }, {}, -1) };
}

// ---------- 外壳：导航、三维舞台、关卡切换 ----------
const CHAPTERS = [
  { key: 'level', nav: '电平', title: '高电平和低电平', build: ch1 },
  { key: 'switch', nav: '开关', title: '引脚里的两个开关', build: ch2 },
  { key: 'reg', nav: '寄存器', title: '寄存器：一排连着引脚的格子', build: ch3 },
  { key: 'hex', nav: '数的写法', title: '0x21 是什么意思', build: chHex },
  { key: 'addr', nav: '地址', title: '每个格子都有门牌号', build: chAddr },
  { key: 'code', nav: '代码', title: '一行代码怎么走到引脚', build: chCode },
  { key: 'bit', nav: '改一位', title: '只改一位，别的不动', build: chBit },
  { key: 'input', nav: '输入', title: '输入：让芯片读按键', build: ch5 },
  { key: 'pitfall', nav: '踩坑', title: '灯为什么不亮', build: ch6 },
  { key: 'adv', nav: '进阶', title: '开漏和读改写', build: ch7 },
];
CHAPTERS.forEach((c, i) => { c.id = 'level' + (i + 1); c.title = `第 ${i + 1} 关　${c.title}`; });

let stage = null, current = null, infoSel = -1;
const built = {};

function pushView() {
  const v = { ...current.inst.view() };
  if (v.sel < 0) v.sel = infoSel;
  if (stage) stage.set(v);
  const info = $('#pinInfo');
  info.textContent = v.sel >= 0 ? `P${v.sel}：${LEVEL_TEXT[v.levels[v.sel]]}${v.sel <= 5 ? (v.leds[v.sel] ? '，灯亮' : '，灯灭') : ''}`
    : '点板子上的走线或管脚，可以查看那个引脚';
}

function show(i, scroll) {
  i = Math.max(0, Math.min(CHAPTERS.length - 1, i));
  const ch = CHAPTERS[i];
  if (current && current.inst.leave) current.inst.leave();
  const host = $('#chapter');
  [...host.children].forEach((c) => { c.hidden = true; });
  if (!built[ch.id]) {
    const sec = el(`<section class="level" id="sec-${ch.id}"><h2>${ch.title}</h2></section>`);
    host.append(sec);
    current = { ch, inst: null };            // 让构建过程里的 sync 不指向上一关
    const body = el('<div class="body"></div>'); sec.append(body);
    const inst = ch.build(body, { sync() { if (current && current.ch === ch && current.inst) pushView(); } });
    const nav = el(`<div class="pager">${i > 0 ? `<button data-go="${i - 1}">上一关</button>` : '<span></span>'}${i < CHAPTERS.length - 1 ? `<button class="primary" data-go="${i + 1}">下一关：${CHAPTERS[i + 1].nav}</button>` : '<span></span>'}</div>`);
    nav.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) go(+g.dataset.go); });
    sec.append(nav);
    built[ch.id] = { sec, inst };
  }
  built[ch.id].sec.hidden = false;
  current = { ch, inst: built[ch.id].inst };
  infoSel = -1;
  if (current.inst.enter) current.inst.enter();
  [...$('#nav').children].forEach((b, k) => b.setAttribute('aria-current', k === i ? 'step' : 'false'));
  const cur = $('#nav').children[i];
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  pushView();
  if (scroll) window.scrollTo({ top: 0 });
}
function go(i) {
  try { history.replaceState(null, '', '#' + CHAPTERS[i].id); } catch (e) { /* 有的环境不让改地址 */ }
  show(i, true);
}

function init() {
  const nav = $('#nav');
  CHAPTERS.forEach((c, i) => {
    const b = el(`<button><span class="n">${i + 1}</span>${c.nav}</button>`);
    b.addEventListener('click', () => go(i)); nav.append(b);
  });
  try {
    stage = createStage($('#stage'));
    stage.onPick((n) => { if (current.inst.pick) current.inst.pick(n); else { infoSel = n; pushView(); } });
  } catch (e) {
    console.error(e);
    $('#stageWrap').classList.add('nogl');
    $('#pinInfo').textContent = '这台设备打不开三维画面，下面的实验不受影响。';
  }
  const fromHash = () => Math.max(0, CHAPTERS.findIndex((c) => '#' + c.id === location.hash));
  show(fromHash(), false);
  window.addEventListener('hashchange', () => show(fromHash(), true));
}
init();
