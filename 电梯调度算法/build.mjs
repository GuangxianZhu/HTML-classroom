// 打包：把 src/ 里的 style.css、algorithms.js、app.js 内联进 src/index.html → index.html（单文件，离线、发给别人都方便）
// 不需要装任何包：node build.mjs
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`./src/${f}`, import.meta.url), 'utf8');
let html = src('index.html');
const swap = (tag, body) => {
  if (!html.includes(tag)) throw new Error(`src/index.html 里找不到 ${tag}`);
  html = html.replace(tag, () => body);
};
swap('<link rel="stylesheet" href="style.css" />', `<style>\n${src('style.css')}</style>`);
for (const f of ['algorithms.js', 'app.js']) {
  swap(`<script src="${f}"></script>`, `<script>\n${src(f).replace(/<\/script/gi, '<\\/script')}</script>`);
}
const out = new URL('./index.html', import.meta.url);
writeFileSync(out, html);
console.log(`index.html  ${(statSync(out).size / 1024).toFixed(0)} KB`);
