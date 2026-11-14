// 单种调压阀页面的入口。__MODEL__ 由 build.mjs 在打包时替换成 'spring' 'twostg' ……，
// 'model:glb' / 'model:spec' 是只含这一种阀的模型和标注（打包时从 regulators.glb 里拆出来）。
import glb from 'model:glb';
import spec from 'model:spec';
import { createStage } from './stage.js';
import { setupBench } from './bench.js';
import { setupGuide } from './guide.js';
import { TEACH } from './teach.js';
import { setupForce, setupTwo, setupDroop, setupLiq, setupBPR, setupArena } from './labs.js';

const KEY = __MODEL__;
const $ = (id) => document.getElementById(id);
let bench = null;
const stage = createStage({ canvas: $('gl'), glb, spec, pinsEl: $('pins'), onPin: (p, i) => bench && bench.onPin(p, i) });
stage.ready.then(() => {
  bench = setupBench(stage, spec, KEY);
  setupGuide(bench, KEY);
  $('loading').hidden = true;
}).catch((e) => { $('loading').textContent = '模型载入失败：' + e.message; });

const T = TEACH[KEY];
({ force: setupForce, two: setupTwo, droop: setupDroop, liq: setupLiq, bpr: setupBPR, arena: () => setupArena(T.focus ?? -1) })[T.lab]();
