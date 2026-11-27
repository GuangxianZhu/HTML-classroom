// 把 src/sim.js 塞进 src/page.html 的 /*SIM*/ 位置，生成单文件 index.html（不需要装包）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, 'src/page.html'), 'utf8');
const sim = readFileSync(join(here, 'src/sim.js'), 'utf8');
if (!page.includes('/*SIM*/')) throw new Error('src/page.html 里找不到 /*SIM*/');
writeFileSync(join(here, 'index.html'), page.replace('/*SIM*/', () => sim));
console.log('index.html written');
