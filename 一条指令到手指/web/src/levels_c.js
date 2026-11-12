// 预紧和回差、时间账、六块 M7C、全程回放和排查
import * as C from './core.js';
import { $, $$, el, fmt, takeaway, basis, where, quiz, tasks, slider, seg, stats, bytesView, svg, tween, rad, OUT, BACK, lv } from './ui.js';
import { GOAL_POS, GOAL_PACKET, GOAL_DEG, SIDE } from './levels_a.js';

// ---------- 预紧和回差 ----------
export function chPretension(root, api) {
  const RS = 10, RJ = 5;
  let tight = -2, ang = 0, y = 0, lastDir = 0, trace = [[0, 0]];
  const flags = new Set();
  const slack = () => (tight < 0 ? -tight : 0), pre = () => (tight > 0 ? tight : 0);
  root.append(el(`<div class="panel">${where('还是线轴和关节之间的两根线。上一关假设它们刚好绷直，这一关看松了和紧了会怎样。')}
    <p>装腱绳的时候，线不可能长得分毫不差。两根都略长一点，就是“松”；两根都拉着劲装上去，就是“预紧”。</p>
    <div id="q"></div></div>`));
  quiz($('#q', root), {
    q: '两根线一共松了 2 mm。舵机正在把手指往弯的方向拉，现在突然反过来往直的方向转。手指会怎样？',
    options: [
      { t: 'A　立刻跟着往回走', why: '往弯拉的时候，屈线是绷着的，伸线是松的。反转以后，先要把伸线那 2 mm 的松卷掉，它才开始吃上劲。' },
      { t: 'B　先不动，舵机空转一小段以后才跟着走', ok: true, why: '这一段“舵机转了、手指没动”的空程叫回差。它让同一个舵机位置对应两个不同的关节角度（取决于是从哪边转过来的），' + lv('cal') + '那条标定直线就不准了。' },
    ],
  });
  const p = el(`<div class="panel"><p>先保持“松 2 mm”，把舵机转角来回拖几次，看上面两根线哪根绷着、哪根垂着，再看下面的图。然后调松紧。</p>
    <div id="ts"></div><div id="as"></div><div class="fig" id="plot"></div><div id="st"></div>
    <div class="readout" id="say"><span class="sub">现在的状态</span><p></p></div><div id="tk"></div></div>`);
  root.append(p);
  const done = tasks($('#tk', p), ['松 2 mm：来回拖，在图上画出一个“环”', '调到刚好：再来回拖，环合成一条线', '预紧调到 8 N 以上，看空载电流']);
  slider($('#ts', p), { label: '松紧', min: -4, max: 10, step: 0.5, value: tight, show: (x) => (x < 0 ? `松 ${-x} mm` : x === 0 ? '刚好绷直' : `预紧 ${x} N`),
    onInput: (x) => { tight = x; y = C.backlash(y, C.tendonMm(RS, ang), slack()); trace = [[ang, y / RJ * 180 / Math.PI]]; render(); } });
  slider($('#as', p), { label: '舵机转角', min: -30, max: 60, step: 0.5, value: 0, show: (x) => x + '°',
    onInput: (x) => {
      const d = Math.sign(x - ang);
      if (d && lastDir && d !== lastDir) flags.add(slack() >= 1.5 ? 'rev-loose' : slack() === 0 ? 'rev-tight' : 'rev');
      if (d) lastDir = d;
      ang = x; y = C.backlash(y, C.tendonMm(RS, ang), slack());
      trace.push([ang, y / RJ * 180 / Math.PI]); if (trace.length > 400) trace.shift();
      render();
    } });
  const setStats = stats($('#st', p));
  const st = () => {
    const x = C.tendonMm(RS, ang), gap = x - y, h = slack() / 2;
    return { joint: y / RJ * 180 / Math.PI, slackFlex: Math.max(0, h - gap), slackExt: Math.max(0, h + gap), tautFlex: slack() === 0 || gap >= h - 1e-6, tautExt: slack() === 0 || gap <= -h + 1e-6 };
  };
  function render() {
    const s = st(), dead = C.deadSpoolDeg(slack(), RS), idle = C.idleCurrentmA(pre());
    const X = (a) => 46 + (a + 30) / 90 * 310, Y = (j) => 150 - (j + 70) / 200 * 136;
    $('#plot', p).innerHTML = svg(380, 185, `
      <line class="axis" x1="46" y1="${Y(0)}" x2="362" y2="${Y(0)}"/><line class="axis" x1="${X(0)}" y1="12" x2="${X(0)}" y2="152"/>
      <text x="204" y="180" text-anchor="middle">舵机转角</text><text x="4" y="12">关节角度</text>
      <text x="${X(-30)}" y="166" text-anchor="middle">−30°</text><text x="${X(60)}" y="166" text-anchor="middle">60°</text><text x="${X(0) - 6}" y="${Y(120) + 4}" text-anchor="end">120°</text>
      <line class="axis" x1="${X(-30)}" y1="${Y(-60)}" x2="${X(60)}" y2="${Y(120)}" stroke-dasharray="4 4"/>
      <text x="${X(34)}" y="${Y(88)}" text-anchor="end">没有松的时候</text>
      <path class="wave w-ac" d="${trace.map(([a, j], i) => `${i ? 'L' : 'M'}${X(a).toFixed(1)} ${Y(j).toFixed(1)}`).join(' ')}"/>
      <circle class="f-ac" cx="${X(ang)}" cy="${Y(s.joint)}" r="6"/>`, '舵机转角和关节角度的关系，线松时会画出一个环');
    setStats([{ k: '换方向时舵机空转', v: fmt(dead, 1) + '°', cls: dead > 3 ? 'bad' : 'ok' }, { k: '折合关节误差', v: fmt(dead * RS / RJ, 1) + '°', cls: dead > 3 ? 'bad' : 'ok' },
      { k: '空载电流（示意）', v: idle + ' mA', cls: idle > 80 ? 'bad' : 'ok' }, { k: '屈线 / 伸线', v: `${s.tautFlex ? '绷' : '松'} / ${s.tautExt ? '绷' : '松'}` }]);
    $('#say p', p).textContent = slack() > 0 ? `线松着。换方向时，舵机要先空转 ${fmt(dead, 1)}° 把松的那根卷紧，手指才动。同一个舵机位置，手指可能在两个地方。`
      : pre() <= 2 ? '两根线都刚好绷着。舵机一动，手指马上跟着动，来回走的是同一条线。这是想要的状态。'
        : pre() < 8 ? '两根线互相拉着。没有空程，但线在通道里的摩擦变大了，舵机不干活的时候电流也比刚才高。'
          : '拉得很紧。两根线在互相较劲，摩擦很大：舵机空着也要一直出力、发热；打的结、打印的孔一直受着大力；能走的行程还会变短。';
    if (flags.has('rev-loose')) done(0);
    if (flags.has('rev-tight') && tight >= 0 && tight <= 2) done(1);
    if (pre() >= 8) done(2);
    api.sync();
  }
  root.append(el(`<div class="panel">${takeaway('太松：换方向有一段空转，位置不准。太紧：摩擦大、发热、伤线、行程变短。目标是“刚好绷直再多一点点”。调过松紧以后，两头的极限位置变了，要重新标定。')}
    <p><b>实物上怎么判断松紧：</b>不靠手感，靠两个数。标定时测到的行程比同类关节明显短，或者不动的时候电流偏高，多半是太紧。换方向时手指明显慢半拍，是太松。</p>
    <p><b>宁松勿紧：</b>松了只是不准，重新调就行。紧了会把力一直压在结和孔上，${lv('servo')}说的绳结脱出就是这样被一点点挤出去的，修起来很费事。</p>
    ${basis([['公认', '回差（背隙）是所有靠线、齿轮、皮带传动的机构都有的现象。'], ['仓库', '“行程变短、电流偏高 = 太紧”是 ORCA 软件里判断预紧的办法；“宁松勿紧”是那次绳结脱出以后定的做法（whj_MCU 的 下一步_预紧到换KM1M7C.md）。'], ['示意', '空载电流那个数只是为了让你看到趋势，系数是随手取的，不是这只手的实测值。回差用的是最简单的“死区”模型，没有算线的弹性。']])}</div>`));
  render();
  return { view: () => {
    const s = st();
    return { scene: 'finger', zoom: 1.25, spoolDeg: ang, jointDeg: s.joint, rs: RS, rj: RJ, slackFlex: s.slackFlex, slackExt: s.slackExt, tautFlex: s.tautFlex, tautExt: s.tautExt, hot: ['joint'],
      info: `舵机 ${ang}°　关节 ${fmt(s.joint, 1)}°　${slack() ? `松 ${slack()} mm` : pre() ? `预紧 ${pre()} N` : '刚好'}` };
  } };
}

// 一条总线一轮的时间条：写（橙）→ 读的请求（绿）→ 每个舵机的应答（蓝）
function cycleBars(n, baud, rdUs, t0, scale) {
  const w = C.frameMs(C.syncWriteBytes(n), baud), q = C.frameMs(C.syncReadBytes(n), baud), r = C.frameMs(C.statusBytes(10), baud), gap = rdUs / 1000;
  let t = t0, h = '';
  const bar = (cls, len) => { h += `<span class="bar ${cls}" style="left:${(t * scale).toFixed(3)}%;width:${Math.max(0.15, len * scale).toFixed(3)}%"></span>`; t += len; };
  bar('w', w); bar('q', q);
  for (let i = 0; i < n; i++) { t += gap; bar('r', r); }
  return { html: h, end: t };
}

// ---------- 读回来和时间账 ----------
export function chTiming(root, api) {
  let n = 17, baud = 57600, rd = 20;
  const seen = new Set();
  root.append(el(`<div class="panel">${where('整条链路，来回都算上。')}
    <p>前面只发了一条指令。真正让手做动作的时候，电脑在不停地转圈：读一遍 17 个舵机现在在哪 → 算下一步 → 把 17 个新目标发出去 → 再读……转一圈叫一轮。一轮越短，动作越顺。</p>
    <div id="q"></div></div>`));
  quiz($('#q', root), {
    q: '17 个舵机在一条总线上，波特率 57600。读一遍再写一遍，这一轮大约要多久？',
    options: [
      { t: 'A　约 5 ms（一秒 200 轮）', why: '这是 1 Mbps 时的数。57600 慢了 17 倍多。' },
      { t: 'B　约 85 ms（一秒 12 轮）', ok: true, why: '一秒只能更新 12 次，手会一顿一顿的。时间几乎全花在“把字节一位一位发出去”上：读回来的数据有 300 多个字节，每个字节 10 位，每位 17 µs。' },
      { t: 'C　约 1 秒', why: '没那么慢。按字节数算是 85 ms 左右。' },
    ],
  });
  const p = el(`<div class="panel"><p>一轮里有两种包。写用 Sync Write：一包里装着所有舵机的“ID + 目标”，谁都不应答。读用 Sync Read：一包点名，被点到的舵机挨个应答。比如只给食指三个舵机写目标，长这样：</p>
    <div id="by"></div>
    <div id="ns"></div><div id="bd"></div><div id="rds"></div>
    <div class="gantt" id="g"></div>
    <p class="note"><span class="hi">橙</span> 写所有目标　<span style="color:var(--accent);font-weight:600">绿</span> 读的点名包　<span class="lo">蓝</span> 每个舵机的应答（一个接一个）</p>
    <div id="st"></div><div id="tk"></div></div>`);
  root.append(p);
  bytesView($('#by', p))(C.syncWrite(116, 4, [[7, 2048], [8, GOAL_POS], [9, 2048]]));
  const done = tasks($('#tk', p), ['17 个、57600：确认一轮约 85 ms', '换成 1 Mbps，看一轮变成多少', '在 57600 下把 Return Delay 在 500 和 20 之间切换，看差多少']);
  slider($('#ns', p), { label: '总线上的舵机数', min: 1, max: 17, step: 1, value: 17, show: (x) => x + ' 个', onInput: (x) => { n = x; render(); } });
  seg($('#bd', p), { label: '波特率', value: 57600, options: [[57600, '57600'], [1000000, '1 Mbps']], onChange: (x) => { baud = +x; render(); } });
  seg($('#rds', p), { label: 'Return Delay', value: 20, options: [[20, '20 µs'], [500, '500 µs']], onChange: (x) => { rd = +x; seen.add('rd' + x + baud); render(); } });
  const setStats = stats($('#st', p));
  function render() {
    const c = C.busCycle({ n, baud, returnDelayUs: rd }), full = Math.max(c.total, 1e-6);
    const bars = cycleBars(n, baud, rd, 0, 100 / full);
    $('#g', p).innerHTML = `<div class="lane"><span class="nm">一条总线 ${n} 个</span><div class="track">${bars.html}</div></div>
      <div class="scale"><span></span><div><span>0</span><span>${fmt(c.total / 2, c.total < 10 ? 2 : 1)}</span><span>${fmt(c.total, c.total < 10 ? 2 : 1)} ms</span></div></div>`;
    setStats([{ k: '写：一包', v: `${C.syncWriteBytes(n)} 字节 · ${fmt(c.write, c.write < 10 ? 2 : 1)} ms`, cls: 'hi' }, { k: '读：点名包', v: `${C.syncReadBytes(n)} 字节` },
      { k: '读：每个应答', v: `${C.statusBytes(10)} 字节 × ${n}`, cls: 'lo' }, { k: '读合计', v: fmt(c.read, c.read < 10 ? 2 : 1) + ' ms', cls: 'lo' },
      { k: '一轮', v: fmt(c.total, c.total < 10 ? 2 : 1) + ' ms', cls: c.total > 40 ? 'bad' : 'ok' }, { k: '一秒几轮', v: fmt(C.hz(c.total), 0) + ' 轮', cls: c.total > 40 ? 'bad' : 'ok' }]);
    if (n === 17 && baud === 57600 && rd === 20) done(0);
    if (baud === 1000000) done(1);
    if (seen.has('rd50057600') && seen.has('rd2057600')) done(2);
    api.sync();
  }
  root.append(el(`<div class="panel">${takeaway('总线上的时间 ≈ 字节数 × 10 位 ÷ 波特率，再加上每个舵机应答前的等待。一条线上同一时刻只能有一个在说话，所以舵机越多，一轮越长，是成正比地长。')}
    <p><b>最省事的提速办法是提高波特率：</b>同样 17 个舵机，57600 时一轮约 85 ms，1 Mbps 时约 5 ms。要改两处：每个舵机控制表里的波特率（8 号格子），和 M7C 固件里舵机那一侧串口的速度，两边必须一样（${lv('uart')}）。</p>
    <p><b>Return Delay 的影响：</b>17 个舵机每个多等 0.48 ms，一轮多 8 ms 左右。57600 时不起眼，1 Mbps 时就比传数据本身还长了。这是 orca_core 把它改成 20 µs 的原因，代价是${lv('txen')}那条更窄的缝。</p>
    <p><b>这些数没算什么：</b>只算了舵机那根线上的字节。电脑上 USB 一来一回、Python 程序自己的开销都没算，实际一轮会更长。USB 转接器如果有“攒一会儿再上报”的设置（U2D2 在 Windows 上默认 16 ms），会把这里省下的时间全吃掉。</p>
    ${basis([['算出来的', '字节数按协议格式数的：Sync Write = 14 + 5 × 舵机数，点名包 = 14 + 舵机数，每个应答 21 字节（读位置、速度、电流共 10 字节）。'], ['校验过', '85 ms、19 ms、5.2 ms 这几个数和 whj_MCU 的 六块M7C方案调研.md 里的表一致；orca_core 源码注释里写 1 Mbps 下全读约 3.8 ms，量级对得上。'], ['没实测', '仓库里有测速脚本 tools/orca/bus_timing.py，但没有记录实测结果。上面全是理论值。']])}</div>`));
  render();
  return { view: () => {
    const ids = C.ALL_IDS.slice(0, n);
    return { scene: 'desk', focus: ['m7c', 'tower'], hot: ['tower'], servos: Object.fromEntries(ids.map((id) => [id, 'G'])), flow: { route: OUT.slice(2), count: 6, speed: baud > 100000 ? 0.7 : 0.18 },
      info: `${n} 个舵机，${baud === 57600 ? '57600' : '1 Mbps'}：一轮 ${fmt(C.busCycle({ n, baud, returnDelayUs: rd }).total, 1)} ms` };
  } };
}

// ---------- 六块 M7C ----------
export function chMultibus(root, api) {
  let mode = 'one', baud = 57600, dead = new Set();
  const seen = new Set();
  root.append(el(`<div class="panel">${where('整只手的接法。现在是 1 块 M7C 带 17 个舵机；仓库里的下一步是 6 块 M7C，每根手指一块。')}
    <p>分法：四根手指各 3 个舵机，各用一块板；拇指 4 个舵机，3 个用一块，剩下 1 个和手腕合用一块。一共 6 块板、6 条互相独立的总线，每块板在电脑上是一个串口。</p>
    <div id="q"></div></div>`));
  quiz($('#q', root), {
    q: '57600 下，一条总线带 17 个舵机一轮约 85 ms。分成 6 条总线以后，电脑一条一条轮流收发，一轮要多久？',
    options: [
      { t: 'A　约 19 ms，快了 4 倍多', why: '19 ms 是 6 条总线同时收发时的数。轮流的话，是把 6 条的时间加起来。' },
      { t: 'B　约 109 ms，比原来还慢', ok: true, why: '要发的数据总量没少，每条总线还各自多了一份包头和点名包，加起来反而更长。分成多条的好处只有在“同时”收发时才拿得到：这时一轮的时间由最长的那一条决定。所以电脑那边的程序必须并行，这不是锦上添花，是前提。' },
    ],
  });
  const p = el(`<div class="panel"><div id="ms"></div><div id="bd"></div>
    <div class="gantt" id="g"></div>
    <p class="note">点左边的板子名，可以让那条总线“断掉”（比如线松了、板子坏了），看模型上哪些关节不受控。</p>
    <div id="st"></div><div id="tk"></div></div>`);
  root.append(p);
  const done = tasks($('#tk', p), ['6 条轮流：确认比 1 条还慢', '6 条同时：看一轮多少', '分别在“1 条”和“6 条同时”下弄断一条总线，对比丢了几个关节']);
  seg($('#ms', p), { label: '接法', value: 'one', options: [['one', '1 条总线'], ['seq', '6 条，轮流收发'], ['par', '6 条，同时收发']], onChange: (x) => { mode = x; dead = new Set(); render(); } });
  seg($('#bd', p), { label: '波特率', value: 57600, options: [[57600, '57600'], [1000000, '1 Mbps']], onChange: (x) => { baud = +x; render(); } });
  const setStats = stats($('#st', p));
  const lanes = () => (mode === 'one' ? [{ name: '一条总线', what: '全部 17 个', ids: C.ALL_IDS }] : C.BOARDS);
  const deadIds = () => lanes().filter((_, i) => dead.has(i)).flatMap((b) => b.ids);
  function render() {
    const L = lanes(), each = L.map((b) => C.busCycle({ n: b.ids.length, baud }).total);
    const total = mode === 'seq' ? each.reduce((a, b) => a + b, 0) : Math.max(...each);
    const ref = Math.max(total, C.busCycle({ n: 17, baud }).total), scale = 100 / ref;
    let t = 0;
    $('#g', p).innerHTML = L.map((b, i) => {
      const t0 = mode === 'seq' ? t : 0; t += each[i];
      const bars = dead.has(i) ? `<span class="bar x" style="left:${t0 * scale}%;width:${each[i] * scale}%"></span>` : cycleBars(b.ids.length, baud, 20, t0, scale).html;
      return `<div class="lane"><button class="nm ${dead.has(i) ? 'dead' : ''}" data-i="${i}" title="${b.what}：${b.ids.join('、')} 号">${b.name}　${b.what}</button><div class="track">${bars}</div></div>`;
    }).join('') + `<div class="scale"><span></span><div><span>0</span><span>${fmt(ref / 2, ref < 10 ? 2 : 0)}</span><span>${fmt(ref, ref < 10 ? 2 : 0)} ms</span></div></div>`;
    $$('#g button', p).forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.i; if (dead.has(i)) dead.delete(i); else dead.add(i); seen.add('kill-' + mode); render(); }));
    const lost = deadIds().length;
    setStats([{ k: '一轮', v: fmt(total, total < 10 ? 2 : 1) + ' ms', cls: total > 40 ? 'bad' : 'ok' }, { k: '一秒几轮', v: fmt(C.hz(total), 0) + ' 轮', cls: total > 40 ? 'bad' : 'ok' },
      { k: '对比：1 条总线', v: fmt(C.busCycle({ n: 17, baud }).total, 1) + ' ms' }, { k: '还受控的关节', v: `${17 - lost} / 17`, cls: lost ? 'bad' : 'ok' }]);
    if (mode === 'seq') done(0);
    if (mode === 'par') done(1);
    if (seen.has('kill-one') && seen.has('kill-par')) done(2);
    api.sync();
  }
  root.append(el(`<div class="panel">
    <div class="scroll"><table><tr><th></th><th>A　6 个串口（推荐先做）</th><th>B　CAN-FD 组网</th><th>C　板子串成一条链</th></tr>
      <tr><td>电脑看到</td><td>6 个串口</td><td>1 个</td><td>1 个</td></tr>
      <tr><td>固件</td><td>不改，同一份烧 6 次</td><td>大改</td><td>中等改动</td></tr>
      <tr><td>电脑软件</td><td>加一层“6 条合成一只手”</td><td>可以不改</td><td>可以不改</td></tr>
      <tr><td>进手的线</td><td>最多</td><td>最少</td><td>少</td></tr>
      <tr><td>一处坏了</td><td>只丢一根手指</td><td>网关板坏了全断</td><td>中间一块坏，后面全断</td></tr></table></div>
    ${takeaway('分成多条总线，只有同时收发才快；轮流反而更慢。分板真正带来的是三件事：一条线出问题只丢一根手指、每条线变短、以后每根手指可以在自己的板子上做控制。')}
    <p><b>先想清楚目的：</b>如果只是嫌慢，单条总线提到 1 Mbps 就够了（约 5 ms 一轮），不用分板。到了 1 Mbps 再分成 6 条，线上只剩 1 ms 左右，这时卡脖子的是 USB 一来一回的时间，线上再快也没用。</p>
    <p><b>A 为什么是推荐先做的：</b>改动全在电脑这边，固件、舵机 ID、标定结果都不用动，出了问题最好查。代价是线多、离不开电脑。B 更接近成品机器人的做法，但要等固件能力补上。两者不冲突，A 的硬件和分组以后都能留给 B。</p>
    ${basis([['算出来的', '各种接法的时间，算法同上一关。'], ['仓库，调研阶段', '分组、三个方向的比较、推荐 A，来自 whj_MCU 的 六块M7C方案调研.md。写那份文档时还没有在实物上试过；拇指分出哪一个电机也还没定，表里暂时写的是 CMC（10 号）。'], ['没算进去', '6 个串口同时收发时，USB 和电脑程序的开销会比单条时更明显，实际能到多少轮要实测。']])}</div>`));
  render();
  return { view: () => {
    const lost = deadIds(), by = (ids) => ids.filter((i) => lost.includes(i)).length / ids.length;
    const pose = (k) => [0.25 + 1.0 * k, 0.2 + 0.9 * k, 0.1 + 0.5 * k];
    const servos = Object.fromEntries(C.ALL_IDS.map((id) => [id, lost.includes(id) ? 'X' : mode === 'one' ? 'A' : ['H', 'L', 'G', 'A', 'P', 'Y'][C.boardOf(id)]]));
    return { scene: 'desk', focus: ['tower', 'hand'], hot: ['tower'], servos,
      fingers: { index: pose(by([7, 8, 9])), middle: pose(by([6, 17, 2])), ring: pose(by([5, 4, 3])), pinky: pose(by([14, 15, 16])), thumb: pose(by([10, 13, 12, 11])) },
      info: lost.length ? `断了的总线带着 ${lost.length} 个舵机，这些关节不受控` : mode === 'one' ? '17 个舵机在同一条总线上' : '同一种颜色的舵机在同一条总线上' };
  } };
}

// ---------- 全程回放 + 排查 ----------
export function chReplay(root, api) {
  const KEYS = { pc: '电脑和配置文件', baud: '波特率', level: '电平转换', gnd: '合线和地线', txen: 'TXEN 松手时机', servo: '舵机和电流上限', tendon: '腱绳' };
  const CASES = [
    { sym: '用万用表量：DIR 拉高时，M7C 那边是 3.3 V，241 那边只有约 3.5 V，应该接近 5 V。', ans: 'level', lv: 'level',
      why: '下拉电阻 R3 插成了 10 kΩ。TXB 输出很软，被这个电阻分走了一截。换成 100 kΩ 后量到 4.77 V。【实测】' },
    { sym: '发指令的时候，M7C 的 RX 上也有波形，自己发的被自己收回来了；把逻辑分析仪的地线夹上去，反而好了。', ans: 'gnd', lv: 'duplex',
      why: '地线分在两条轨上，DIR 上有毛刺，接收门被误打开。逻辑分析仪的地线碰巧把两处地连得更好了。把所有地并到一条轨后解决。【现象和解法是实测，根因是推断】' },
    { sym: '用 U2D2 一切正常。换成 M7C 后，orca_core 每次读舵机都报超时。', ans: 'baud', lv: 'uart',
      why: 'M7C 的 USB 虚拟串口不理会电脑设的波特率，orca_core 自动探测时会误以为是 1 Mbps，固件其实是 57600。在配置文件里把波特率写死。【读源码预先发现的隐患；换 M7C 最后成功了，过程中具体改了什么仓库里没有记录】' },
    { sym: '能扫到舵机，但时有时无，同一条命令有时成功有时超时。', ans: 'txen', lv: 'txen',
      why: '舵机的 Return Delay 被设成了 20 µs，主机松开 TXEN 稍慢一点就盖住了应答的开头。看一下固件是按哪个标志松手的，用逻辑分析仪同时看 DIR 和 DATA。【读源码推出来的隐患，没在实物上复现过】' },
    { sym: '标定时，拇指有两个关节往反方向使劲。', ans: 'pc', lv: 'cal',
      why: '配置里的硬件版本号填成了 21。v2.0 和 v2.1 的左手，拇指 MCP 和 DIP 两根绳的绕向相反，方向表选错了。改回 2。【读源码】' },
    { sym: '小角度都正常。测最大活动范围时听到连续的“嘎嘣”声，之后中指的外展不动了。', ans: 'tendon', lv: 'pretension',
      why: '腱绳末端的结被拉出了孔，掉进手掌的通道。关节顶到机械极限后舵机以上限电流一直拉着。也可以说是“舵机和电流上限”那一站的事，两个都算对。【现象实测，原因是推断】', also: 'servo' },
    { sym: '一运行就报 PermissionError: Access is denied。', ans: 'pc', lv: 'bridge',
      why: '串口被别的程序占着：串口助手、Dynamixel Wizard 或者另一个终端。一个串口同一时刻只能被一个程序打开。【文档】' },
  ];
  let baud = 57600, phase = 0, t = 0, bend = 0, stop = () => {}, right = 0;
  const answered = new Set();
  root.append(el(`<div class="panel">${where('从头到尾再走一遍，这次带上时间。')}
    <p>前面一关一关拆开看完了。现在把它们接起来：按“播放”，看这条指令走完全程，再对着下面的时间表，体会每一段各占多少。</p>
    <div id="bd"></div>
    <div class="ops"><button id="play" class="primary">播放全程</button><button id="rst">回到起点</button></div>
    <div class="scroll"><table id="tb"></table></div>
    <p class="note">右边的条是对数刻度：每长一格是 10 倍。不这样画的话，前几行短得看不见。</p></div>`));
  seg($('#bd', root), { label: '波特率', value: 57600, options: [[57600, '57600'], [1000000, '1 Mbps']], onChange: (x) => { baud = +x; table(); } });
  const rows = () => [
    ['电脑：换算、组包', 0.05, '估', '程序里几步计算'],
    ['USB 到 M7C', 1, '估', 'USB 大约每 1 ms 传一批'],
    [`${GOAL_PACKET.length} 个字节上线`, C.frameMs(GOAL_PACKET.length, baud), '算', lv('uart')],
    ['舵机等 Return Delay', 0.02, '手册', lv('txen')],
    ['应答 11 个字节回来', C.frameMs(11, baud), '算', lv('bus')],
    ['电机带着手指转 45°', 400, '估', '取决于速度设置，量级是几百毫秒'],
  ];
  function table() {
    const R = rows(), bar = (ms) => Math.max(2, (Math.log10(ms) + 2) / 5 * 100);
    $('#tb', root).innerHTML = '<tr><th>阶段</th><th class="num">时间</th><th>依据</th><th style="width:38%">有多长</th></tr>' + R.map((r, i) =>
      `<tr${phase === i + 1 ? ' style="background:var(--soft)"' : ''}><td>${r[0]}</td><td class="num">${r[1] < 1 ? fmt(r[1], 2) : fmt(r[1], r[1] < 10 ? 1 : 0)} ms</td><td class="sub">${r[2]}</td>
       <td><div style="height:12px;border-radius:3px;width:${bar(r[1])}%;background:${i === 5 ? 'var(--hi)' : i === 2 || i === 4 ? 'var(--lo)' : 'var(--muted)'}"></div></td></tr>`).join('');
  }
  function play() {
    stop(); phase = 1; t = 0; bend = 0; table(); api.sync();
    const seq = [
      [1, 500, (k) => { t = k * 0.02; }], [2, 700, (k) => { t = 0.02 + k * 0.16; }], [3, 1500, (k) => { t = 0.18 + k * 0.82; }],
      [4, 400, () => {}], [5, 1500, (k) => { t = k; }], [6, 1600, (k) => { bend = k; }],
    ];
    let i = 0;
    const next = () => {
      if (i >= seq.length) { phase = 7; table(); api.sync(); return; }
      const [ph, ms, fn] = seq[i++]; phase = ph; if (ph === 5) t = 0; table();
      stop = tween(0, 1, ms, (k) => { fn(k); api.sync(); }, next);
    };
    next();
  }
  $('#play', root).addEventListener('click', play);
  $('#rst', root).addEventListener('click', () => { stop(); phase = 0; t = 0; bend = 0; table(); api.sync(); });
  const p = el(`<div class="panel"><p><b>排查练习。</b>下面七个现象都来自 whj_MCU 仓库里记录过的问题。每个先自己判断：该先去查哪一站？</p>
    <div class="cases" id="cs"></div><p class="take" id="score"><b>成绩</b><span></span></p></div>`);
  root.append(p);
  CASES.forEach((c, i) => {
    const box = el(`<div class="case"><p class="sym">${i + 1}. ${c.sym}</p><div class="opts">${Object.entries(KEYS).map(([k, v]) => `<button data-k="${k}">${v}</button>`).join('')}</div><p class="fb" hidden></p></div>`);
    $$('button', box).forEach((b) => b.addEventListener('click', () => {
      const ok = b.dataset.k === c.ans || b.dataset.k === c.also;
      if (!answered.has(i)) { answered.add(i); if (ok) right++; }
      $$('button', box).forEach((x) => x.classList.remove('wrong'));
      b.classList.add(ok ? 'right' : 'wrong');
      if (ok || box.dataset.tries) {
        $$('button', box).forEach((x) => { if (x.dataset.k === c.ans) x.classList.add('right'); });
        const fb = $('.fb', box); fb.hidden = false; fb.innerHTML = `${c.why}　<span class="sub">（${lv(c.lv)}）</span>`;
      } else box.dataset.tries = '1';
      $('#score span', p).textContent = `答了 ${answered.size} / ${CASES.length} 题，第一次就选对 ${right} 题。`;
    }));
    $('#cs', p).append(box);
  });
  $('#score span', p).textContent = '每题第一次选的算数；选错了可以再点一次看答案。';
  root.append(el(`<div class="panel">${takeaway('排查的顺序和信号走的顺序一样：一站一站来，先查能直接量的（电压、通断、波形），再查要推理的（时序、配置）。每一站只问一句：进来的对不对，出去的对不对。')}
    <p><b>这门课简化了什么：</b>用单个 Write 包代替了真实的 Sync Write 来讲结构；标定数字、线轴半径是示例；舵机内部和面包板的摆放是示意；所有时间都是按字节数算的理论值。原理部分（闭环、半双工、线长守恒、回差）是通用的，换一只手、换一种舵机也成立。</p>
    <p><b>接着可以看：</b>whj_MCU 仓库里的 <code>docs/course/orca_pitfall_course.html</code>（避坑课，10 关，偏工程习惯）和 <code>docs/exploded/xl330_exploded.html</code>（面包板实物接线的爆炸图）。这一页讲的是“为什么是这样”，那两页讲的是“实物上怎么做、怎么查”。</p>
    ${basis([['仓库', '七个现象和处理办法都出自 whj_MCU（HANDOFF.md、换M7C_一页纸.md、orca_core代码导读_左手v2.0.md、docs/遇到问题）。每条后面标了它是实测、推断还是读源码得出的。'], ['估', '时间表里标“估”的三行只有量级可信。']])}</div>`));
  table();
  return {
    leave() { stop(); },
    view: () => {
      const back = phase === 5;
      return { scene: 'desk', focus: phase >= 6 ? ['tower', 'hand'] : 'all', dir: phase >= 6 ? SIDE : null, hot: [['pc', 'pc', 'm7c', 'g241', 'tower', 'tower', 'hand', 'hand'][phase]],
        flow: phase >= 1 && phase <= 5 ? { route: back ? BACK : OUT, t, size: 1.2, color: back ? '#3fbf5f' : '#ff8a3d' } : null,
        servos: phase >= 4 ? { 8: phase === 5 ? 'G' : 'H' } : {}, spools: { 8: -bend * 0.9 }, tendon8: phase >= 6, fingers: { index: [rad(GOAL_DEG) * bend, 0, 0] },
        info: ['按“播放全程”', '电脑：换算、组包', 'USB 到 M7C', '字节一位一位上线，经电平转换、合线，到舵机', '8 号舵机认领，等 20 µs', '应答沿原路回到电脑', '电机转，线轴卷线，食指弯到 45°', '走完了'][phase] };
    },
  };
}
void GOAL_POS;
