// 外壳：导航、三维舞台、关卡切换。十四关的内容在 levels_a / b / c 里。
import { createStage } from './stage.js';
import { $, el } from './ui.js';
import { chMap, chCal, chPacket, chUart, chBridge } from './levels_a.js';
import { chLevel, chDuplex, chBus, chServo, chTendon } from './levels_b.js';
import { chPretension, chTiming, chMultibus, chReplay } from './levels_c.js';

const CHAPTERS = [
  { nav: '全程地图', title: '一条指令要过几站', build: chMap },
  { nav: '角度变成数', title: '关节角度换成电机位置数', build: chCal },
  { nav: '数据包', title: '把数装进数据包', build: chPacket },
  { nav: '高低电平', title: '字节变成线上的高和低', build: chUart },
  { nav: 'M7C 转发', title: 'M7C 板：在两个串口之间搬字节', build: chBridge },
  { nav: '3.3 V 变 5 V', title: '电平转换：3.3 V 的“高”不够高', build: chLevel },
  { nav: '两根合一根', title: '发和收两根线，合成一根', build: chDuplex },
  { nav: '谁来听', title: '17 个舵机在一根线上，谁来听', build: chBus },
  { nav: '舵机内部', title: '舵机里面：自己跟自己较劲的小闭环', build: chServo },
  { nav: '线轴和腱绳', title: '线轴卷线，手指弯曲', build: chTendon },
  { nav: '预紧和回差', title: '线太松、太紧会怎样', build: chPretension },
  { nav: '时间账', title: '读回来，再算一笔时间账', build: chTiming },
  { nav: '六块 M7C', title: '一条总线拆成六条', build: chMultibus },
  { nav: '全程回放', title: '回放一遍，再练排查', build: chReplay },
].filter((c) => c.build);
CHAPTERS.forEach((c, i) => { c.id = 'level' + (i + 1); c.title = `第 ${i + 1} 关　${c.title}`; });

let stage = null, current = null;
const built = {};

function pushView() {
  if (!current || !current.inst) return;
  const v = current.inst.view();
  if (stage) stage.set(v);
  $('#stageInfo').textContent = v.info || '';
}

function show(i, scroll) {
  i = Math.max(0, Math.min(CHAPTERS.length - 1, i));
  const ch = CHAPTERS[i];
  if (current && current.inst && current.inst.leave) current.inst.leave();
  const host = $('#chapter');
  [...host.children].forEach((c) => { c.hidden = true; });
  if (!built[ch.id]) {
    const sec = el(`<section class="level" id="sec-${ch.id}"><h2>${ch.title}</h2></section>`);
    host.append(sec);
    current = { ch, inst: null };                 // 构建过程里的 sync 不要指向上一关
    const body = el('<div class="body"></div>'); sec.append(body);
    const inst = ch.build(body, { stage, sync() { if (current && current.ch === ch && current.inst) pushView(); }, go: (n) => go(n - 1) });
    const nav = el(`<div class="pager">${i > 0 ? `<button data-go="${i - 1}">上一关</button>` : '<span></span>'}${i < CHAPTERS.length - 1 ? `<button class="primary" data-go="${i + 1}">下一关：${CHAPTERS[i + 1].nav}</button>` : '<span></span>'}</div>`);
    nav.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) go(+g.dataset.go); });
    sec.append(nav);
    built[ch.id] = { sec, inst };
  }
  built[ch.id].sec.hidden = false;
  current = { ch, inst: built[ch.id].inst };
  if (current.inst.enter) current.inst.enter();
  [...$('#nav').children].forEach((b, k) => b.setAttribute('aria-current', k === i ? 'step' : 'false'));
  const cur = $('#nav').children[i];
  cur.classList.add('seen');
  if (cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
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
    stage = createStage($('#stage'), $('#labels'));
    stage.onPick((k, id) => { if (current && current.inst && current.inst.pick) current.inst.pick(k, id); });
  } catch (e) {
    console.error(e);
    $('#stageWrap').classList.add('nogl');
    $('#stageInfo').textContent = '这台设备打不开三维画面，下面的实验不受影响。';
  }
  const fromHash = () => Math.max(0, CHAPTERS.findIndex((c) => '#' + c.id === location.hash));
  show(fromHash(), false);
  window.addEventListener('hashchange', () => show(fromHash(), true));
}
init();
