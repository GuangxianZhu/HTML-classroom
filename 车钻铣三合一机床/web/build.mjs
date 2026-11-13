// 打包：three.js、GLB 模型、layout 全部塞进一个 HTML，双击就能离线打开。
import { build } from 'esbuild';
import fs from 'fs';
const out = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020',
  loader: { '.glb': 'binary' }, legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const page = fs.readFileSync('src/page.html', 'utf8');
fs.mkdirSync('dist', { recursive: true });
const body = `${page}\n<script>${js}</script>\n`;
fs.writeFileSync('dist/artifact.html', body);
// 本地版：补上文档骨架（发布版由平台补，所以不能带）
const styleAt = page.indexOf('<style>');
const head = page.slice(0, styleAt), styleEnd = page.indexOf('</style>') + 8;
const local = `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n${head}${page.slice(styleAt, styleEnd)}</head>\n<body>${page.slice(styleEnd)}\n<script>${js}</script>\n</body></html>\n`;
fs.writeFileSync('dist/index.html', local);
fs.writeFileSync('../index.html', local);
console.log('artifact', (body.length / 1e6).toFixed(2), 'MB; local', (local.length / 1e6).toFixed(2), 'MB');
