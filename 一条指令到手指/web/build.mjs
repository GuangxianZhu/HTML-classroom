// 打包：把 three.js、三个 GLB 模型、坐标表和页面逻辑塞进一个 HTML，双击就能离线打开。
import { build } from 'esbuild';
import fs from 'fs';
const out = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020',
  loader: { '.glb': 'binary', '.json': 'json' }, legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const page = fs.readFileSync('src/page.html', 'utf8');
if (!page.includes('<!--SCRIPT-->')) throw new Error('page.html 里找不到 <!--SCRIPT--> 占位');
const html = page.replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
fs.writeFileSync('../index.html', html);
console.log('index.html', (html.length / 1e6).toFixed(2), 'MB');
