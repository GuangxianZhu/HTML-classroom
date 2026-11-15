// 打包成一个不用联网、双击就能开的 ../index.html：node build.mjs
// 三维模型（../blender/out/car.glb）、模型清单（spec.json）和参数表（../params.json）都塞进这一个文件里。
import { build } from 'esbuild';
import fs from 'fs';

const out = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020',
  loader: { '.glb': 'binary' }, legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const page = fs.readFileSync('src/page.html', 'utf8');
const styleAt = page.indexOf('<style>'), styleEnd = page.indexOf('</style>') + 8;
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${page.slice(0, styleAt)}${page.slice(styleAt, styleEnd)}</head>
<body>${page.slice(styleEnd)}
<script>${js}</script>
</body></html>
`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
fs.writeFileSync('../index.html', html);
console.log(`index.html ${(html.length / 1048576).toFixed(2)} MB`);
