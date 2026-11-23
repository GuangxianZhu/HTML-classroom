// 打包：src/*.js → 单个 IIFE，内联进 src/shell.html → ../index.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const minify = !process.argv.includes('--dev');
const r = await build({
  entryPoints: ['src/main.js'], bundle: true, format: 'iife', write: false, minify, target: 'es2020',
  legalComments: 'none', charset: 'utf8', logLevel: 'warning',
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const shell = readFileSync('src/shell.html', 'utf8');
writeFileSync('../index.html', shell.replace('/*__APP__*/', () => js));
console.log(`index.html  ${(statSync('../index.html').size / 1024).toFixed(0)} KB  (${minify ? 'minified' : 'dev'})`);
