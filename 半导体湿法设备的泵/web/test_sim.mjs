// 校验数字模型，以及页面文案里写死的判断（改了参数要能发现文案过时）。
import * as S from './src/sim.js';
import fs from 'fs';
let bad = 0;
const ok = (cond, msg) => { if (!cond) { bad++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 离心：相似定律（不抬高时 Q∝n，H∝n²）
const a = S.cfOperate({ rpm: 2900, Hs: 0, k: 1e-3 }), b = S.cfOperate({ rpm: 1450, Hs: 0, k: 1e-3 });
ok(near(b.Q / a.Q, .5, .01) && near(b.H / a.H, .25, .01), `相似定律 Q 比 ${(b.Q / a.Q).toFixed(3)}，H 比 ${(b.H / a.H).toFixed(3)}`);
ok(near(.8 ** 3, .51, .01), '文案：流量降 20 %，功率约降一半（0.8³）');
const r1 = S.cfOperate({ k: 2e-4 }), r2 = S.cfOperate({ k: 3e-3 });
ok(r2.Q < r1.Q && r2.H > r1.H, '阻力变大：流量变小、扬程变高');

// 磁力联轴器
const w = S.coupling({ sg: 1, temp: 25, k: 1e-4 * 40 ** .45 });
const h = S.coupling({ sg: 1.84, temp: 25, k: 1e-4 * 40 ** .45 });
const ph = S.coupling({ sg: 1.69, temp: 25, k: 1e-4 * 40 ** .45 }), ph70 = S.coupling({ sg: 1.69, temp: 70, k: 1e-4 * 40 ** .45 }), open = S.coupling({ sg: 1.69, temp: 25, k: 1e-4 });
ok(!ph.slip && ph.ratio > .85 && ph70.slip && open.slip, `85 % 磷酸：默认余量小（${(ph.ratio * 100).toFixed(0)} %），加热到 70 °C 或阀门全开就脱耦`);
ok(!w.slip && h.slip, `默认阻力：水同步（${(w.ratio * 100).toFixed(0)} %），96 % 硫酸脱耦（${(h.ratio * 100).toFixed(0)} %）`);
ok(near(h.T / w.T, 1.8, .05), `文案：硫酸总扭矩约为水的 1.8 倍（实际 ${(h.T / w.T).toFixed(2)}）`);
ok(S.coupling({ sg: 1, temp: 100 }).Tmax < S.coupling({ sg: 1, temp: 20 }).Tmax, '温度高，能传扭矩变小');
ok(w.deg < 90 / S.MAG.pp, '同步时落后角小于 90°/p');

// 磁悬浮
const off = S.levitate({ on: false });
ok(off.touched && off.tTouch > 10 && off.tTouch < 12, `文案：不控制 11～12 ms 撞壳（实际 ${off.tTouch.toFixed(1)} ms）`);
ok(near(off.tau, 2.9, .05), `文案：每 2.9 ms 放大约 2.7 倍（τ = ${off.tau.toFixed(2)} ms）`);
const on = S.levitate({ on: true, delayMs: .2 });
ok(!on.touched && on.settle !== null && on.settle < 30, `默认延迟扶得住，${on.settle.toFixed(0)} ms 回中，最大 ${on.maxDev.toFixed(0)} µm`);
ok(S.levitate({ on: true, delayMs: 3 }).touched, '延迟 3 ms 扶不住');

// 行程波形
let sum = 0, mn = 9, mx = -9;
for (let i = 0; i < 4000; i++) { const st = S.stroke(i / 4000); sum += st.sp; mn = Math.min(mn, st.s); mx = Math.max(mx, st.s); }
ok(near(sum / 4000, 4, .02) && near(mn, -1, 1e-3) && near(mx, 1, 1e-3), `行程波形：平均 |ds/dψ| = ${(sum / 4000).toFixed(3)}，范围 [${mn.toFixed(3)}, ${mx.toFixed(3)}]`);
const p0 = S.pulsation({ damperTau: 0 }), p1 = S.pulsation({ damperTau: .25 }), p2 = S.pulsation({ damperTau: .7 });
ok(p0.ripple > p1.ripple && p1.ripple > p2.ripple, `阻尼器越大越平：${p0.ripple.toFixed(2)} > ${p1.ripple.toFixed(2)} > ${p2.ripple.toFixed(2)}`);
ok(Math.min(...p0.raw) < .01, '不装阻尼器时换向那一下流量掉到零');

// 气动泵
const s1 = S.airPump('bellows', { Pa: .5, R: 1e-5 }), s2 = S.airPump('bellows', { Pa: .5, R: 1e-3 });
ok(s2.Q < s1.Q && s2.Pd > s1.Pd, '管路越憋，流量越小、出口压力越高');
ok(S.airPump('aodd', { Pa: .4, R: 1e9 }).stalled, '出口阀关死：憋停');
ok(S.airPump('bellows', { Pa: .5, R: 1e6 }).Pd <= .5, '出口压力不超过气压');

// 计量泵
ok(near(S.dosing({ spm: 360, L: 1 }).Lh, 75.6, .1), '满行程 360 次/分 ≈ 75 L/h');
const g0 = S.gasLock({ L: .3, gen: .06, PdG: .3 });
ok(g0.locked !== null, `默认（30 % 行程、0.06 mL/下）会气锁：第 ${g0.locked + 1} 下`);
ok(S.gasLock({ L: .3, gen: .06, PdG: .3, vent: true }).locked === null, '自动排气阀能避免气锁');
ok(S.gasLock({ L: .3, gen: .06, PdG: .3, purgeN: 10 }).locked === null, '每 10 下满行程能避免气锁');
ok(S.gasLock({ L: 1, gen: .06, PdG: .3 }).locked === null, '同样放气，满行程不锁：短行程更容易气锁');

// 第一章
const c0 = S.clogCompare(0), c1 = S.clogCompare(1);
ok(c1.cf.Q / c0.cf.Q < c1.pd.Q / c0.pd.Q, `堵塞时离心掉得多（${(c1.cf.Q / c0.cf.Q * 100).toFixed(0)} %），容积掉得少（${(c1.pd.Q / c0.pd.Q * 100).toFixed(0)} %）`);

// 数据完整性
const spec = JSON.parse(fs.readFileSync('../blender/out/spec.json', 'utf8'));
const need = { P1: ['main', 'circ'], P2: ['main', 'circ'], P3: ['suctL', 'dischL', 'suctR', 'dischR', 'airL', 'airR', 'exhL', 'exhR'], P4: ['suctL', 'dischL', 'suctR', 'dischR', 'airL', 'airR', 'exhL', 'exhR'], P5: ['suct', 'disch'] };
for (const [p, ks] of Object.entries(need)) ok(ks.every((k) => spec.pumps[p].flows[k] && spec.pumps[p].flows[k].length), `${p} 流线齐全`);
const movs = Object.values(spec.parts).map((x) => x.mov).filter(Boolean);
for (const m of ['rotO', 'rotI', 'rotL', 'bellowsL', 'bellowsR', 'plate', 'shaft', 'spool', 'diaphragm', 'armature', 'spring', 'stop', 'ballOut', 'ballIn']) ok(movs.includes(m), `运动零件 ${m}`);
const chs = fs.readFileSync('src/chapters.js', 'utf8');
for (const p of Object.values(spec.pumps)) for (const pin of p.pins) ok(spec.parts[pin.part], `标注 ${pin.t} 指向的零件存在`);
const refs = [...chs.matchAll(/P\('([^']+)'\)/g)].map((m) => m[1]);
const codes = [...chs.matchAll(/^\s+\['([^']+)', '/gm)].map((m) => m[1]);
ok(refs.every((r) => codes.includes(r)), `正文引用 ${new Set(refs).size} 个来源都在来源表里`);

console.log(bad ? `\n${bad} 项不通过` : '\n全部通过');
process.exit(bad ? 1 : 0);
