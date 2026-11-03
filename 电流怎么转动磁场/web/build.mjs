// 打包成一个 HTML：发布版（平台补文档骨架）和离线版（自带骨架）。
import { build } from 'esbuild';
import fs from 'fs';
const out = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020', legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const img = fs.existsSync('src/section.jpg') ? `data:image/jpeg;base64,${fs.readFileSync('src/section.jpg').toString('base64')}` : '';
const page = fs.readFileSync('src/page.html', 'utf8').replace('__SECTION_IMG__', img);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/artifact.html', `${page}\n<script>${js}</script>\n`);
const styleAt = page.indexOf('<style>'), styleEnd = page.indexOf('</style>') + 8;
const local = `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${page.slice(0, styleAt)}${page.slice(styleAt, styleEnd)}</head>\n<body>${page.slice(styleEnd)}\n<script>${js}</script>\n</body></html>\n`;
fs.writeFileSync('../index.html', local);
console.log('artifact + index.html', (local.length / 1e3).toFixed(0), 'KB');
