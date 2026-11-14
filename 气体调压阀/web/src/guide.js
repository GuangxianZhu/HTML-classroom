// 右侧手册：先猜题，猜完（或"不猜了"）才解锁分步拆解。每一步只回答一个小问题，标题就是答案；
// 进入某一步时先把控制条复位，再套这一步的改动，并把镜头飞到对应零件。
import { TEACH } from './teach.js';

const $ = (id) => document.getElementById(id);
const LETTERS = ['A', 'B', 'C', 'D'];

export function setupGuide(bench, name) {
  const T = TEACH[name];
  const meta = bench.meta;
  const el = $('detail');
  let step = -1;          // -1 = 猜题
  let guessed = null;     // 选了第几个；'skip' = 不猜了

  function describe(s) {
    // 把这一步相对默认值的改动写成一句人话
    const out = [];
    for (const [id, v] of Object.entries(s.set || {})) {
      const c = meta.controls.find((x) => x.id === id);
      if (c) out.push(`${c.label.replace(/（.*）/, '')}调到 ${v} ${c.unit}`);
    }
    for (const [id, on] of Object.entries(s.tog || {})) {
      const t = meta.toggles?.find((x) => x.id === id);
      if (t) out.push(`${on ? '打开' : '关掉'}"${t.label}"`);
    }
    return out.length ? out.join('，') + '。' : '';
  }

  function quiz() {
    step = -1;
    const q = T.quiz;
    const done = guessed !== null;
    el.innerHTML = `<p class="kicker">${meta.tag} 型 · 先猜一下</p>
      <div class="quiz"><p class="q">${q.q}</p></div>
      <div class="opts">${q.opts.map((o, i) => `<button type="button" data-i="${i}"${done ? ' disabled' : ''} class="${done && i === q.ans ? 'right' : done && i === guessed ? 'wrong' : ''}"><b>${LETTERS[i]}</b><span>${o}</span></button>`).join('')}</div>
      ${done ? `<p class="verdict">${guessed === 'skip' ? '' : guessed === q.ans ? '<b>猜对了。</b>' : `<b>答案是 ${LETTERS[q.ans]}。</b>`}${q.why}</p>
        <button type="button" class="go" id="gStart">开始拆：${T.steps.length} 步看懂它 →</button>`
        : '<p><button type="button" class="link" id="gSkip">不猜了，直接看答案</button></p><p class="hint">先凭直觉选一个，后面每一步都会回到这道题。</p>'}`;
    el.querySelectorAll('.opts button').forEach((b) => b.addEventListener('click', () => { guessed = +b.dataset.i; quiz(); }));
    $('gSkip')?.addEventListener('click', () => { guessed = 'skip'; quiz(); });
    $('gStart')?.addEventListener('click', () => go(0));
  }

  function go(i) {
    step = i;
    const s = T.steps[i];
    bench.reset();
    for (const [id, v] of Object.entries(s.set || {})) bench.setControl(id, v);
    for (const [id, on] of Object.entries(s.tog || {})) bench.setToggle(id, on);
    if (s.pin) bench.focusPin(s.pin);
    render();
  }

  function render() {
    const s = T.steps[step], n = T.steps.length;
    const did = describe(s);
    el.innerHTML = `<p class="kicker">${meta.tag} 型 · 第 ${step + 1} / ${n} 步</p>
      <h2>${s.t}</h2>
      <p>${s.b}</p>
      ${did ? `<p class="did">${did}</p>` : ''}
      ${s.try ? `<p class="try">${s.try}</p>` : ''}
      ${step === n - 1 ? '<p class="hint">拆完了。往下翻：弹簧到底动不动、动手实验、它在什么情况下会失效。</p>' : ''}
      <div class="stepnav">
        <button type="button" id="gPrev">${step === 0 ? '← 回到猜题' : '← 上一步'}</button>
        <div class="dots">${T.steps.map((_, k) => `<button type="button" data-k="${k}" aria-label="第 ${k + 1} 步"${k === step ? ' aria-current="step"' : ''}></button>`).join('')}</div>
        <button type="button" id="gNext"${step === n - 1 ? ' disabled' : ''}>下一步 →</button>
      </div>`;
    $('gPrev').addEventListener('click', () => (step === 0 ? quiz() : go(step - 1)));
    $('gNext').addEventListener('click', () => step < n - 1 && go(step + 1));
    el.querySelectorAll('.dots button').forEach((b) => b.addEventListener('click', () => go(+b.dataset.k)));
  }

  function back() { bench.focusPin(null); if (step < 0) quiz(); else render(); }

  // 点模型上的数字：临时显示这个零件的说明，可以回到刚才那一步
  bench.onPinClick = (p) => {
    bench.focusPin(p.key);
    el.innerHTML = `<p class="kicker">${meta.tag} 型 · ${meta.name}</p><h2>${p.name}</h2><p class="leadline">${p.text}</p>
      <p><button type="button" class="link" id="gBack">← 回到${step < 0 ? '猜题' : `第 ${step + 1} 步`}</button></p>`;
    $('gBack').addEventListener('click', back);
  };

  quiz();
  return { go, quiz, get step() { return step; } };
}
