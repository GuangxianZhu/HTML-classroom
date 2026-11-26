// 总目录：把这个浏览器里记下的进度标到每一课上
import { loadProgress } from './course.js';
const p = loadProgress();
let done = 0;
document.querySelectorAll('[data-n]').forEach((el) => {
  const q = p[el.dataset.n];
  if (q?.done) { done++; el.classList.add('done'); el.querySelector('.st').textContent = `学过 · 练习最好 ${q.best ?? 0}/${el.dataset.of || 5}`; }
});
const s = document.getElementById('prog');
// 启蒙篇的进度存在 k1～k12 下面
if (s) s.textContent = done ? `这个浏览器里已经学过 ${done} 课。` : '还没开始？从“启蒙”第 1 小课开始。学过高中的，可以直接看每段后面的课本对照。';
