// 打包成一个不用联网的 HTML：node build.mjs
// ../index.html 是给仓库和 GitHub Pages 用的（链接到兄弟项目用相对路径）；
// dist/artifact.html 是单独发布用的（链接换成 GitHub Pages 的完整地址）。
import { build } from 'esbuild';
import fs from 'fs';

const out = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020', legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const page = fs.readFileSync('src/page.html', 'utf8');
const styleAt = page.indexOf('<style>'), styleEnd = page.indexOf('</style>') + 8;
const doc = (p) => `<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${p.slice(0, styleAt)}${p.slice(styleAt, styleEnd)}</head>\n<body>${p.slice(styleEnd)}\n<script>${js}</script>\n</body></html>\n`;
const local = doc(page);
fs.writeFileSync('../index.html', local);
const pages = 'https://guangxianzhu.github.io/HTML-classroom/';
const online = page.replace(/href="\.\.\/([^/"]+)\/index\.html"/g, (_, d) => `href="${pages}${encodeURIComponent(d)}/index.html"`);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/artifact.html', doc(online));
console.log(`index.html ${(local.length / 1e3).toFixed(0)} KB`);
