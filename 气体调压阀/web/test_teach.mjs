// 校验教学文案和模型对得上：步骤里的零件、控制项都存在；文案里引用的数字和仿真一致。
import fs from 'fs';
import * as C from './src/core.js';
import { MODELS, ORDER } from './src/data.js';
import { TEACH } from './src/teach.js';
const spec = JSON.parse(fs.readFileSync('../blender/out/spec.json', 'utf8'));
let bad = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };

for (const k of ORDER) {
  const m = MODELS[k], T = TEACH[k];
  const pins = new Set(spec.models[k].pins.map((p) => p.key).filter((x) => m.pins[x]));
  const ctl = new Set(m.controls.map((c) => c.id)), tog = new Set((m.toggles || []).map((t) => t.id));
  let fine = T.quiz.ans >= 0 && T.quiz.ans < T.quiz.opts.length && T.steps.length >= 4;
  for (const s of T.steps) {
    if (s.pin && !pins.has(s.pin)) { fine = false; console.log('  bad pin', k, s.pin); }
    for (const [id, v] of Object.entries(s.set || {})) {
      const c = m.controls.find((x) => x.id === id);
      if (!c || v < c.min || v > c.max) { fine = false; console.log('  bad control', k, id, v); }
    }
    for (const id of Object.keys(s.tog || {})) if (!tog.has(id)) { fine = false; console.log('  bad toggle', k, id); }
  }
  ok(fine && T.limits.length && T.alts.length && T.src.length, `${k}: quiz / steps / pins / controls consistent`);
  // 每个 mover 至少有一个零件在模型里（防止再出现"整台阀一动不动"）
  const parts = new Set(spec.models[k].movers.map((mv) => mv.part));
  ok(parts.size > 0, `${k}: ${parts.size} moving parts declared`);
}

// 文案里引用的数字
const p = { ...C.ST_A };
const F = C.forceFor(p, 1000, 300);
const at = (q, P1 = 1000) => C.steadyStage(p, P1, F, C.demandC(q));
ok(Math.abs(F / p.ks * 1e3 - 12.6) < 0.1, `A: spring compression at 300 kPa = ${(F / p.ks * 1e3).toFixed(2)} mm (text: 12.6)`);
ok(Math.abs(C.forceFor(p, 1000, 600) / p.ks * 1e3 - 24.7) < 0.1 && Math.abs(C.forceFor(p, 1000, 50) / p.ks * 1e3 - 2.5) < 0.1, 'A: compression 2.5 → 24.7 mm for 50 → 600 kPa');
const d300 = at(0).P2g - at(300).P2g;
ok(Math.abs(d300 - 15) < 1.5 && Math.abs(at(300).X * 1e3 - 0.35) < 0.03, `A: droop 0→300 = ${d300.toFixed(1)} kPa, lift ${(at(300).X * 1e3).toFixed(3)} mm (text: ~15 kPa, 0.35 mm)`);
ok(Math.abs(at(120).P2g - 295) < 1 && Math.abs(at(300).P2g - 288) < 1, `A quiz: 120 → ${at(120).P2g.toFixed(1)}, 300 → ${at(300).P2g.toFixed(1)} (text: 295 → 288)`);
const ie = at(10, 400).P2g - at(10, 1000).P2g;
ok(ie > 2.5 && ie < 5.5, `A: inlet 1000→400 at small flow raises outlet ${ie.toFixed(1)} kPa (text: ~4)`);
const pc = { ...C.ST_C }, Fc = C.forceFor(pc, 1000, 300);
const dA = at(0).P2g - at(250).P2g, dC = C.steadyStage(pc, 1000, Fc, 0).P2g - C.steadyStage(pc, 1000, Fc, C.demandC(250)).P2g;
ok(dC / dA > 0.35 && dC / dA < 0.65 && Math.abs(dA - 13) < 1.5, `C: droop 0→250 spring ${dA.toFixed(1)} vs dome ${dC.toFixed(1)} kPa (text: ~13 vs ~6.5, about half)`);
const pd = { ...C.ST_D };
ok(C.steadyPTFE(pd, 300, 380, 0.24).P2 < 300, `D quiz: supply 300, air 380 → ${C.steadyPTFE(pd, 300, 380, 0.24).P2.toFixed(1)} kPa (< 300)`);
const b10 = C.steadyBPR(250, 10).P1g, b400 = C.steadyBPR(250, 400).P1g;
ok(b400 - b10 > 5 && b400 - b10 < 20, `E quiz: 10 → 400 NL/min raises upstream ${b10.toFixed(1)} → ${b400.toFixed(1)} kPa (text: 十来 kPa)`);

console.log(bad ? `${bad} FAILED` : 'all passed');
process.exit(bad ? 1 : 0);
