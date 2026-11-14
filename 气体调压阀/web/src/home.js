// 入口页：旧链接 index.html#epclose 跳到对应的单页；开头的猜题。
import { ORDER } from './data.js';
import { pageFile } from './pages.js';

const want = (location.hash.match(/^#(?:m=)?(\w+)/) || [])[1];
if (want && ORDER.includes(want)) location.replace(pageFile(want));

const box = document.getElementById('homequiz');
if (box) {
  const ans = +box.dataset.ans;
  const btns = box.querySelectorAll('.opts button');
  const show = (i) => {
    btns.forEach((b, k) => { b.disabled = true; b.classList.toggle('right', k === ans); b.classList.toggle('wrong', k === i && i !== ans); });
    box.querySelector('.verdict').hidden = false;
    box.querySelector('.verdict b').textContent = i == null ? '' : i === ans ? '猜对了。' : `答案是 ${'ABC'[ans]}。`;
    document.getElementById('hqSkip').hidden = true;
  };
  btns.forEach((b, k) => b.addEventListener('click', () => show(k)));
  document.getElementById('hqSkip').addEventListener('click', () => show(null));
}
