// 什么时候松开说话键（TXEN）。原来挤在“谁来听”那一关的后半段，看不懂，拆出来单独讲。
// 讲法：先只看一问一答，再加上说话键，最后把舵机的等待改短。图上每个方块是一个字节，不画波形。
import * as C from './core.js';
import { $, $$, el, takeaway, basis, where, quiz, tasks, slider, seg, svg, tween, lv } from './ui.js';
import { GOAL_PACKET } from './levels_a.js';

export function chTxen(root, api) {
  const BAUD = 57600, B = C.byteUs(BAUD);                    // 一个字节约 174 µs
  const T0 = -3.25 * B, T1 = 500 + 3.6 * B;                  // 图上画的时间范围（两种等待时间用同一把尺，才看得出差别）
  const PX0 = 14, PX1 = 386, X = (t) => PX0 + (Math.max(T0, Math.min(T1, t)) - T0) / (T1 - T0) * (PX1 - PX0);
  const CMD = GOAL_PACKET.slice(-3), REPLY = C.statusPacket(8);
  const PRESET = {
    now: { t: '发完马上松', rel: 2 },
    early: { t: '最后一个字节还没发完就松', rel: -Math.round(B) },
    late1: { t: '发完又多按了 1 ms', rel: 1000 },
    late01: { t: '发完又多按了 0.1 ms', rel: 100 },
  };
  let step = 1, rd = 500, rel = 2, playT = null, stop = () => {}, dragging = false;
  const tried2 = new Set(), tried3 = new Set(), flags = new Set();

  root.append(el(`<div class="panel">${where('还在那根 DATA 线上。8 号舵机收到了指令，要把应答发回来。')}
    <p>上一关说，被点名的舵机会回一包应答。指令和应答走的是同一根线，所以得讲好谁先说、谁后说。</p>
    <p>可以把它想成对讲机：<b>按住说话键才能说，按着的时候听不到对方</b>。M7C 这边的“说话键”就是${lv('duplex')}那根 DIR，也叫 TXEN：它是 1 的时候，241 的发送门开着（M7C 占着线），接收门关着（M7C 听不到舵机）。</p>
    <div id="q"></div></div>`));
  quiz($('#q', root), {
    q: '用对讲机问了一句话，对方马上要回答。你的说话键应该什么时候松开？',
    options: [
      { t: 'A　话还剩最后一个字，就可以先松了', why: '最后一个字没发出去。对方听到的是半句话，不知道你问了什么，也就不回答。' },
      { t: 'B　最后一个字说完，立刻松', ok: true, why: '松早了，自己的话没说完；松晚了，对方已经开始回答，你还按着键，开头几个字听不到。只有“刚说完就松”两头都不误。下面把这件事放到 DATA 线上看。' },
      { t: 'C　说完以后多按一会儿，保险', why: '你按着的时候听不到对方。对方已经开口了，你还没松，他开头的几个字就丢了。' },
    ],
  });

  const p = el(`<div class="panel">
    <div id="steps"></div>
    <p id="lead"></p>
    <div class="fig wide" id="fig" style="touch-action:pan-y"></div>
    <p class="note" id="cap"></p>
    <div id="rds"></div>
    <div class="ops" id="pre"></div>
    <div id="sl"></div>
    <div class="ops"><button id="play" class="primary">播放这一次</button></div>
    <div class="readout" id="out"><span class="sub"></span><span class="big"></span><p></p></div>
    <div id="tk"></div></div>`);
  root.append(p);
  const done = tasks($('#tk', p), ['第一步：播放一遍，看一问一答', '第二步：三个按钮各试一次', '第三步：舵机只等 20 µs 时，试“多按了 0.1 ms”，再试“发完马上松”']);
  const stepSeg = seg($('#steps', p), { value: 1, options: [[1, '第一步　一问一答'], [2, '第二步　加上说话键'], [3, '第三步　舵机只等 20 µs']], onChange: (x) => setStep(+x) });
  const rdSeg = seg($('#rds', p), { label: '舵机发完指令后等多久再答', value: 500, options: [[500, '500 µs（出厂）'], [20, '20 µs（orca_core 改过以后）']], onChange: (x) => { rd = +x; halt(); render(); } });
  const sl = slider($('#sl', p), { label: '说话键松开的时刻（0 = 指令的最后一位刚发完；也可以直接拖图上的圆点）', min: -400, max: 1100, step: 2, value: rel,
    show: (x) => (x === 0 ? '0' : x > 0 ? `晚 ${x} µs` : `早 ${-x} µs`), onInput: (x) => { rel = x; flags.add('drag'); halt(); render(); } });
  Object.entries(PRESET).forEach(([k, v]) => {
    const b = el(`<button data-p="${k}">${v.t}</button>`);
    b.addEventListener('click', () => { rel = v.rel; sl.set(rel); (step === 2 ? tried2 : tried3).add(k + (step === 3 ? rd : '')); halt(); render(); });
    $('#pre', p).append(b);
  });
  function setStep(n) {
    step = n; halt();
    if (n === 1) { rd = 500; rel = 2; }
    if (n === 2) { rd = 500; }
    if (n === 3) { rd = 20; }
    rdSeg.set(rd); sl.set(rel); stepSeg.set(n); render();
  }
  function halt() { stop(); playT = null; }
  $('#play', p).addEventListener('click', () => {
    halt(); playT = T0; render();
    stop = tween(T0, T1, 6000, (t) => { playT = t; render(); }, () => { playT = null; if (step === 1) flags.add('played'); render(); });
  });
  // 直接在图上拖圆点
  const fig = $('#fig', p);
  const toTime = (e) => {
    const r = fig.querySelector('svg').getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * 400, vy = (e.clientY - r.top) / r.height * 190;
    return { t: Math.round((T0 + (vx - PX0) / (PX1 - PX0) * (T1 - T0)) / 2) * 2, vy };
  };
  fig.addEventListener('pointerdown', (e) => {
    if (step < 2) return;
    const { t, vy } = toTime(e);
    if (vy < 22 || vy > 70) return;
    dragging = true; fig.setPointerCapture(e.pointerId); e.preventDefault();
    rel = Math.max(-400, Math.min(1100, t)); sl.set(rel); flags.add('drag'); halt(); render();
  });
  fig.addEventListener('pointermove', (e) => { if (!dragging) return; rel = Math.max(-400, Math.min(1100, toTime(e).t)); sl.set(rel); render(); });
  const endDrag = () => { dragging = false; };
  fig.addEventListener('pointerup', endDrag); fig.addEventListener('pointercancel', endDrag);

  const TL = () => C.txenTimeline({ releaseUs: step === 1 ? 0 : rel, returnDelayUs: rd, baud: BAUD });
  const box = (t0, t1, cls, label, extra = '') => {
    const x0 = X(t0), w = X(t1) - x0;
    return w < 1 ? '' : `<rect class="${cls}" x="${x0 + 0.6}" y="92" width="${Math.max(0.5, w - 1.2)}" height="28" rx="3" ${extra}/>${label && w > 20 ? `<text class="mono b" x="${x0 + w / 2}" y="110" text-anchor="middle" style="fill:var(--panel);font-size:11px">${label}</text>` : ''}`;
  };
  function render() {
    const tl = TL(), showKey = step >= 2;
    $('#lead', p).innerHTML = step === 1
      ? '先不管说话键，只看线上的先后顺序。M7C 把指令的最后几个字节发完，线上安静一小会儿，然后 8 号舵机开始应答。舵机故意等的这一小会儿叫 Return Delay，出厂是 500 µs，差不多是发 3 个字节的时间。按“播放这一次”看一遍，同时看上面模型里线的颜色。'
      : step === 2
        ? '现在把说话键画上去（上面那一条）。<b>绿色那一段，是“指令发完”到“舵机开口”之间的空当。说话键必须在这一段里松开。</b>点下面三个按钮各试一次，或者直接拖图上的圆点，看松早了、松晚了各会怎样。'
        : 'orca_core 为了读得更快，会把舵机的等待从 500 µs 改成 20 µs。看图：蓝色的应答紧贴着指令，绿色那一段从三个方块宽缩成了一条缝。上一步里“多按一会儿”还可能碰巧没事，现在哪怕只多按 0.1 ms 也会撞上。';
    $('#rds', p).classList.toggle('hidden', step !== 3);
    $('#pre', p).classList.toggle('hidden', step === 1);
    sl.el.classList.toggle('hidden', step === 1);
    $$('#pre button', p).forEach((b) => b.classList.toggle('hidden', b.dataset.p === 'late01' && step !== 3));
    // ---- 图 ----
    const xr = X(tl.releaseUs), x0 = X(0), xd = X(rd), gapW = xd - x0;
    let s = `<defs><pattern id="txenHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" class="f-bad"/></pattern>
      <clipPath id="txenClip"><rect x="${PX0}" y="0" width="${PX1 - PX0}" height="190"/></clipPath></defs>`;
    // 能松手的空当
    if (showKey) {
      s += `<rect class="f-ok" opacity=".2" x="${x0}" y="24" width="${Math.max(2.5, gapW)}" height="100"/>`;
      s += gapW > 60 ? `<text class="f-ok b" x="${x0 + gapW / 2}" y="16" text-anchor="middle">在这一段里松开才行</text>`
        : `<text class="f-ok b" x="${x0 - 4}" y="16" text-anchor="end">只能在这条缝里松开 ▸</text>`;
    }
    // 说话键
    if (showKey) {
      s += `<text x="${PX0}" y="36">M7C 的说话键（TXEN）</text>
        <rect class="f-ac" x="${PX0}" y="42" width="${Math.max(0, xr - PX0)}" height="22" rx="4"/>
        ${xr - PX0 > 44 ? `<text class="b" x="${PX0 + 8}" y="57" style="fill:var(--accent-ink)">${xr - PX0 > 190 ? '按着：M7C 占着线，听不到舵机' : '按着'}</text>` : ''}
        <line class="line" x1="${xr}" y1="53" x2="${PX1}" y2="53" style="stroke-width:2"/>
        ${PX1 - xr > 60 ? `<text x="${xr + 16}" y="68">松开：M7C 让出线，开始听</text>`.replace('松开：M7C 让出线，开始听', PX1 - xr > 170 ? '松开：M7C 让出线，开始听' : '松开') : ''}
        <circle class="${tl.kind === 'ok' ? 'f-ok' : 'f-bad'}" cx="${xr}" cy="53" r="9" stroke="var(--panel)" stroke-width="2" style="cursor:ew-resize"/>
        <text class="b" x="${xr}" y="57" text-anchor="middle" style="fill:var(--panel);font-size:11px;pointer-events:none">↔</text>`;
    }
    // DATA 线上谁在说
    s += `<text x="${PX0}" y="86">DATA 线上实际是谁在说话</text><g clip-path="url(#txenClip)">`;
    s += box(T0, -3 * B, 'f-hi', '', 'opacity=".45"');
    CMD.forEach((b, i) => {
      const a = (i - 3) * B, e = a + B, gone = tl.kind === 'cut' && e > tl.hostEnd + 1;
      s += gone ? `<rect x="${X(a) + 0.6}" y="92" width="${X(e) - X(a) - 1.2}" height="28" rx="3" fill="url(#txenHatch)" opacity=".55"/><rect x="${X(a) + 0.6}" y="92" width="${X(e) - X(a) - 1.2}" height="28" rx="3" fill="none" stroke="var(--danger)" stroke-dasharray="3 3"/>`
        : box(a, e, 'f-hi', C.hex2(b));
    });
    if (tl.replies) {
      REPLY.forEach((b, i) => {
        const a = rd + i * B, e = a + B;
        if (a > T1) return;
        s += box(a, e, 'f-lo', C.hex2(b));
        if (a < tl.coverEnd) s += `<rect x="${X(a) + 0.6}" y="92" width="${X(Math.min(e, tl.coverEnd)) - X(a) - 0.6}" height="28" rx="3" fill="url(#txenHatch)" opacity=".8"/>`;
      });
    }
    s += '</g>';
    // 两条时间线和下面的说明
    s += `<line class="axis" x1="${x0}" y1="24" x2="${x0}" y2="128" stroke-dasharray="3 3"/><line class="axis" x1="${xd}" y1="24" x2="${xd}" y2="128" stroke-dasharray="3 3"/>
      <text class="f-hi b" x="${X(-1.6 * B)}" y="138" text-anchor="middle">${tl.kind === 'cut' ? '指令没发全' : 'M7C 发指令'}</text>
      ${gapW > 60 ? `<text x="${x0 + gapW / 2}" y="138" text-anchor="middle">舵机等 ${rd} µs</text>` : ''}
      <text class="${tl.replies ? (tl.kind === 'late' ? 'f-bad' : 'f-lo') : 'f-bad'} b" x="${X(rd + (rd > 100 ? 1.6 : 2.6) * B)}" y="138" text-anchor="middle">${!tl.replies ? '8 号舵机不应答' : tl.kind === 'late' ? `应答开头 ${tl.lostReplyBytes} 个字节被盖住` : '8 号舵机应答'}</text>
      <text x="${x0}" y="154" text-anchor="middle">▲</text><text x="${x0}" y="168" text-anchor="${gapW > 60 ? 'middle' : 'end'}">指令发完</text>
      <text x="${xd}" y="154" text-anchor="middle">▲</text><text x="${xd}" y="168" text-anchor="${gapW > 60 ? 'middle' : 'start'}">${gapW > 60 ? '舵机开口' : '　舵机开口（只隔 20 µs）'}</text>`;
    if (playT !== null) s += `<line x1="${X(playT)}" y1="20" x2="${X(playT)}" y2="176" stroke="var(--ink)" stroke-width="2"/><path d="M${X(playT) - 5} 14 h10 l-5 8 z" fill="var(--ink)"/>`;
    fig.innerHTML = svg(400, 190, s, '时间从左到右：M7C 发指令，舵机等一会儿，舵机应答；上面一条是说话键什么时候松开');
    $('#cap', p).textContent = `时间从左往右走。每个方块是 1 个字节，发一个要约 ${Math.round(B)} µs（波特率 57600）。橙色是 M7C 发的指令，蓝色是舵机的应答，红色斜纹是坏掉的部分。`;
    // ---- 结果 ----
    const o = $('#out', p), now = playT === null ? null : C.txenAt(tl, playT);
    if (now !== null) {
      o.className = 'readout ' + (now === 'clash' || now === 'cut' ? 'bad' : now === 'host' ? 'high' : now === 'servo' ? 'low' : '');
      $('.sub', o).textContent = '播放中，现在这一刻';
      $('.big', o).textContent = { host: 'M7C 在发指令', cut: 'M7C 还想发，但说话键已经松了', idle: '线上没人说话', servo: '8 号舵机在应答', clash: '撞上了' }[now];
      $('p', o).textContent = { host: '说话键按着，发送门开着，字节一个一个上线。', cut: '发送门已经关了，剩下的字节出不去。舵机收到的是缺了尾巴的一包。',
        idle: playT < rd && playT >= 0 ? (tl.replies ? '指令发完了，舵机在等，还没开口。' : '指令发完的时刻。') : tl.replies ? '这一问一答结束了。' : '舵机没有应答，线上一直安静。电脑还在等。',
        servo: '说话键已经松开，接收门开着，应答顺利传回 M7C，再传回电脑。', clash: '舵机已经在答，M7C 的说话键还按着：它的发送门还占着线，接收门还关着。这几个字节电脑收不到。' }[now];
    } else if (step === 1) {
      o.className = 'readout ok'; $('.sub', o).textContent = '这一步要看到的'; $('.big', o).textContent = '一问，等一会儿，一答';
      $('p', o).textContent = '同一根线上，M7C 和舵机不会同时说话：指令发完到应答开始，中间隔着舵机故意等的 500 µs。下一步看 M7C 这边要配合做什么。';
    } else {
      o.className = 'readout ' + (tl.kind === 'ok' ? 'ok' : 'bad'); $('.sub', o).textContent = '结果';
      $('.big', o).textContent = tl.kind === 'ok' ? '成功：应答完整收到' : tl.kind === 'cut' ? '松早了：指令没发全' : '松晚了：应答的开头被盖住';
      $('p', o).textContent = tl.kind === 'ok' ? `说话键在绿色这一段里松开了。舵机开口时线已经让出来。这一段有 ${rd} µs 宽${rd === 500 ? '，大约是发 3 个字节的时间，比较宽裕。' : '，只有发 1 位多一点的时间，程序必须“一发完就松”，不能磨蹭。'}`
        : tl.kind === 'cut' ? `说话键松开时，指令最后 ${tl.lostCmdBytes} 个字节还没发出去（红色虚线框）。舵机收到的包缺了尾巴，校验对不上，整包丢掉，所以它不动、也不应答。电脑那边看到的是：超时。`
          : `舵机在 +${rd} µs 开口，说话键到 +${rel} µs 才松。中间这段 M7C 还占着线、也听不到，应答开头的 ${tl.lostReplyBytes} 个字节没了（红色斜纹）。包头都没收全，电脑认不出这是一包应答。电脑那边看到的是：超时，或者一堆乱码。`;
    }
    if (flags.has('played')) done(0);
    if (['now', 'early', 'late1'].every((k) => tried2.has(k))) done(1);
    if (tried3.has('late0120') && tried3.has('now20')) done(2);
    api.sync();
  }

  root.append(el(`<div class="panel"><p><b>程序里怎么知道“发完了”。</b>上面三个按钮，对应固件里三种常见的写法：</p>
    <div class="scroll"><table><tr><th>你刚才点的</th><th>固件里的写法</th><th>结果</th></tr>
      <tr><td>发完马上松</td><td>等串口的“发送完成”标志再松。这个标志的意思是：最后一位已经离开引脚了。（英文缩写 TC）</td><td class="good">对。标准做法</td></tr>
      <tr><td>最后一个字节还没发完就松</td><td>看到“发送缓冲区空”标志就松。这个标志的意思只是：可以把下一个字节交给我了。这时最后一个字节才刚开始往外发。（英文缩写 TXE）</td><td class="bad">指令被截断。两个标志名字像，很多人第一次写都选错</td></tr>
      <tr><td>发完又多按一会儿</td><td>发完以后用延时函数等一段固定的时间再松</td><td class="bad">舵机等 500 µs 时可能碰巧能用；改成 20 µs 以后必错</td></tr></table></div>
    ${takeaway('说话键（TXEN）要在“指令的最后一位发完”之后、“舵机开口”之前松开。这段空当出厂时有 500 µs，orca_core 改过以后只有 20 µs。做法只有一个：等“发送完成”标志，一到就松。')}
    <p><b>为什么“时好时坏”最该怀疑这里：</b>松得稍晚一点时，盖掉的可能只是应答开头的一两位。有时刚好没盖到，有时盖到了，于是同一条命令有时成功、有时超时。电压、接线这类问题通常是一直不行，时好时坏的多半是时间上卡着边。</p>
    <p><b>波特率换成 1 Mbps 以后：</b>每个字节从 174 µs 缩短到 10 µs，图上的方块会窄很多；但舵机等的 20 µs 不变，所以空当还是 20 µs。对固件的要求没变：一发完就松。</p>
    <p><b>图上省略了什么：</b>指令最后一位是“停止位”，它本来就是高电平，和线空闲时一样。所以严格说，提前不到一位的时间（约 17 µs）松手也不会出错。这个细节不影响结论，图上按“发完才能松”画。</p>
    ${basis([['手册', 'Return Delay 出厂 500 µs（控制表 9 号格子，单位 2 µs）；应答包的格式。'], ['仓库（读源码）', 'orca_core 的设 ID 脚本会把 Return Delay 改成 20 µs（whj_MCU 的 下一步_预紧到换KM1M7C.md“坑 2”）。'],
      ['公认', '发送完成（TC）和发送缓冲区空（TXE）的区别，是带方向控制的串口通信里的常识。'], ['还不知道', '你板子上实际在跑的透传固件，说话键是按哪个标志松的，仓库里没有记录。它能稳定控制整只手，说明至少落在空当里。'],
      ['简化', '“应答开头被盖住几个字节”按整字节算；实际上盖掉半个字节，那个字节也就坏了。']])}</div>`));
  render();
  return {
    leave() { halt(); },
    view: () => {
      const tl = TL(), now = playT === null ? null : C.txenAt(tl, playT), key = playT === null ? null : playT < tl.releaseUs;
      const wires = now === null ? { WIRE_dir5: 'A', WIRE_data: step === 1 || tl.kind === 'ok' ? 'A' : 'X', WIRE_bus: step === 1 || tl.kind === 'ok' ? 'A' : 'X' }
        : { WIRE_dir: key ? 'H' : 'L', WIRE_dir5: key ? 'H' : 'L', WIRE_tx5: now === 'host' || now === 'cut' ? 'H' : null,
          WIRE_data: now === 'host' ? 'H' : now === 'servo' ? 'G' : now === 'clash' ? 'X' : null, WIRE_bus: now === 'host' ? 'H' : now === 'servo' ? 'G' : now === 'clash' ? 'X' : null,
          WIRE_rx5: now === 'servo' ? 'G' : null, WIRE_rx: now === 'servo' ? 'G' : null };
      const s8 = now === null ? 'H' : now === 'servo' ? 'G' : now === 'clash' ? 'X' : playT >= 0 && !tl.replies ? 'X' : playT >= 0 ? 'H' : 'L';
      const flow = now === 'host' ? { route: ['WIRE_tx5', 'in_241', 'WIRE_data', 'in_phb', 'WIRE_bus', 'chain'], count: 5, speed: 0.6 }
        : now === 'servo' ? { route: [['chain', -1], ['WIRE_bus', -1], ['in_phb', -1], ['WIRE_data', -1], ['in_241', -1], ['WIRE_rx5', -1]], count: 5, speed: 0.6, color: '#3fbf5f' } : null;
      return { scene: 'desk', focus: ['txb', 'g241', 'tower'], hot: ['g241'], wires, servos: { 8: s8 }, flow,
        info: now === null ? '按“播放这一次”，看线的颜色怎么变：橙 = M7C 在说，绿 = 舵机在答，红 = 撞上了'
          : { host: 'M7C 在说（说话键按着）', cut: '说话键已松，剩下的字节出不去', idle: '线上没人说话', servo: '8 号舵机在答，M7C 在听', clash: '撞上了：舵机在答，M7C 还按着说话键' }[now] };
    },
  };
}
