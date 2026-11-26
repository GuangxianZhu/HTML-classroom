// 课本对照页共用：上面的导航、每张卡片里“回到小课”的链接。页面正文在 src/books/tN.html，练习题在 src/books/problems.js。
import { $ } from './ui.js';
import { KIDS, KID_SEGS, BOOKS, kidFile } from './course.js';

export function bookChrome(seg) {
  const B = BOOKS.find((b) => b.seg === seg), S = KID_SEGS.find((s) => s.id === seg), ks = KIDS.filter((k) => (k.seg || 1) === seg);
  $('top').innerHTML = `<a href="../index.html">← 力学课目录</a><span class="where">${B.title}</span>
    <span class="pn">${ks[0]?.ready ? `<a href="${kidFile(ks[0].n)}">${S.name.split(' · ')[0]}的小课 →</a>` : ''}</span>`;
  // 卡片：<article class="bk" data-k="16"> 自动补上小课的标题、那句话和链接
  document.querySelectorAll('.bk[data-k]').forEach((el) => {
    const k = KIDS.find((x) => x.n === +el.dataset.k); if (!k) return;
    const head = document.createElement('div'); head.className = 'bk-kid';
    head.innerHTML = `<span class="tag">启蒙 ${k.n}</span>${k.ready ? `<a href="${kidFile(k.n)}">${k.title}</a>` : `<b>${k.title}</b>`}<p>${k.got}</p>`;
    el.prepend(head);
  });
}
