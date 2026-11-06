import glb from '../../blender/out/regulators.glb';
import spec from '../../blender/out/spec.json';
import { createStage } from './stage.js';
import { setupBench } from './bench.js';
import { setupForce, setupTwo, setupGas, setupArena } from './labs.js';

const $ = (id) => document.getElementById(id);
let bench = null;
const stage = createStage({ canvas: $('gl'), glb, spec, pinsEl: $('pins'), onPin: (p, i) => bench && bench.onPin(p, i) });
bench = setupBench(stage, spec);
stage.ready.then(() => {
  $('loading').hidden = true;
  const want = (location.hash.match(/m=(\w+)/) || [])[1];
  bench.select(spec.models[want] ? want : 'spring');
}).catch((e) => { $('loading').textContent = '模型载入失败：' + e.message; });

setupForce();
setupTwo();
setupGas();
setupArena();
