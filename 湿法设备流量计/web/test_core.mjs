// 物理核心的校验：数值对照公认结论，或者对照本页的设计意图。跑法：node test_core.mjs
import fs from 'fs';
import * as P from './src/physics.js';
let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fail++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const geo = JSON.parse(fs.readFileSync('../blender/out/spec.json', 'utf8')).SPEC.flt;

// 水的物性（对照常用数据表）
ok(near(P.rhoWater(25), 997.05, 0.1), `水 25 °C 密度 ${P.rhoWater(25).toFixed(2)} ≈ 997.05`);
ok(near(P.muWater(25) * 1e3, 0.890, 0.01), `水 25 °C 黏度 ${(P.muWater(25) * 1e3).toFixed(3)} mPa·s ≈ 0.890`);
ok(near(P.cWater(25), 1496.7, 0.5), `水 25 °C 声速 ${P.cWater(25).toFixed(1)} ≈ 1496.7 m/s`);
ok(near(P.cWater(80), 1554.8, 1.0), `水 80 °C 声速 ${P.cWater(80).toFixed(1)} ≈ 1554.8 m/s`);

// 流速分布：层流沿直径平均 = 4/3 面平均；湍流 1.05–1.1
ok(near(P.lineFactor(1000), 4 / 3, 0.002), `层流线平均/面平均 ${P.lineFactor(1000).toFixed(4)} = 4/3`);
ok(P.lineFactor(1e5) > 1.04 && P.lineFactor(1e5) < 1.1, `湍流线平均/面平均 ${P.lineFactor(1e5).toFixed(3)} 在 1.04–1.1`);

// 超声波：1/t 算法约掉声速；Δt ≈ 2Lv/c²
const w25 = P.fluid('diw', 25), w80 = P.fluid('diw', 80);
const u1 = P.usInline({ Q: 2 * P.LPM, f: w80 });
ok(near(u1.QA / P.LPM, 2, 1e-9), `管内式 1/t 算法 80 °C 读数 ${(u1.QA / P.LPM).toFixed(6)} = 2`);
ok(u1.QB / P.LPM < 1.9, `Δt·c²/2L 算法按 25 °C 声速算 80 °C 水会偏低：${(u1.QB / P.LPM).toFixed(3)}`);
const u2 = P.usInline({ Q: 1 * P.LPM, f: w25 });
ok(near(u2.dt, 2 * 0.111 * u2.v / w25.c ** 2, u2.dt * 1e-4), `Δt ${(u2.dt * 1e9).toFixed(2)} ns ≈ 2Lv/c²`);
ok(near(P.usClamp({ Q: 3 * P.LPM, f: w25 }).Qm / P.LPM, 3, 0.01), '夹装式在标定条件（25 °C 水）下读数准确');

// 卡门涡街：线性、低流量切除、振动造成假流量
const v10 = P.vortexMeter({ Q: 10 * P.LPM, f: w25 });
ok(near(v10.Qm / P.LPM, 10, 0.15), `涡街 10 L/min 读数 ${(v10.Qm / P.LPM).toFixed(2)}`);
ok(near(P.vortex({ Q: 10 * P.LPM, f: w25 }).fv / P.vortex({ Q: 5 * P.LPM, f: w25 }).fv, 2, 1e-9), '涡街频率和流量成正比');
ok(P.vortexMeter({ Q: 0.4 * P.LPM, f: w25 }).Qm === 0, '涡街 0.4 L/min（Re≈700）读不出');
ok(P.vortexMeter({ Q: 0, f: w25, vibAmp: 10 }).Qm > 0, '没有流量但有振动时，涡街会读出假流量');

// 叶轮：标定点准确，小流量偏低，磨损后偏低
ok(near(P.paddle({ Q: 2 * P.LPM }).Qm / P.LPM, 2, 1e-9), '叶轮在标定点 2 L/min 读数准确');
ok(P.paddle({ Q: 0.5 * P.LPM }).Qm / P.LPM < 0.5, '叶轮小流量读数偏低');
ok(P.paddle({ Q: 2 * P.LPM, wear: 0.5 }).Qm < P.paddle({ Q: 2 * P.LPM }).Qm, '轴承磨损后读数偏低');

// 浮子：刻度自洽；轻液体读数偏低；修正公式
const sc = P.floatScale(geo);
for (const q of [0.6, 1.5, 2.8]) ok(near(sc(P.floatMeter({ Q: q * P.LPM, f: P.fluid('diw', 20), geo }).z) / P.LPM, q, 0.02), `浮子刻度在 20 °C 水 ${q} L/min 处自洽`);
const ipa = P.fluid('ipa'), w20 = P.fluid('diw', 20);
const rd = sc(P.floatMeter({ Q: 1.5 * P.LPM, f: ipa, geo }).z) / P.LPM;
const corr = Math.sqrt((w20.rho * (geo.rho_f - ipa.rho)) / (ipa.rho * (geo.rho_f - w20.rho)));
ok(rd < 1.5 && near(rd * corr, 1.5, 0.25), `IPA 读数 ${rd.toFixed(2)} 偏低；按密度修正后 ${(rd * corr).toFixed(2)} 接近 1.5（剩下的是黏度）`);

// 差压：平方根、10% 流量只有 1% 压差、密度修正
const d1 = P.dpMeter({ Q: 2 * P.LPM, f: w25 }), d2 = P.dpMeter({ Q: 0.2 * P.LPM, f: w25 });
ok(near(d2.dpQ / d1.dpQ, 0.01, 1e-9), '差压：10% 流量时平方项只剩 1%');
ok(near(d1.Qm / P.LPM, 2, 0.01), `差压在水里读数 ${(d1.Qm / P.LPM).toFixed(3)} ≈ 2`);
const h = P.fluid('h2so4');
ok(near(P.dpMeter({ Q: 1 * P.LPM, f: h }).Qm / P.LPM, Math.sqrt(h.rho / 997), 0.06), '浓硫酸当水算：读数约偏大 √(ρ/ρ水)');

// 热式：无流量时上下游对称；小流量线性；转换系数
const c0 = P.capillaryT(0), ca = P.capillaryT(0.3), cb = P.capillaryT(0.6);
ok(Math.abs(c0.dT) < 1e-9, '没有流动时上下游绕组温度相同');
ok(near(cb.dT / ca.dT, 2, 0.05), `小流量时温差和流量成正比（比值 ${(cb.dT / ca.dT).toFixed(3)}）`);
ok(P.capillaryT(20).dT < P.capillaryT(6).dT, '流量很大时温差反而下降');
ok(near(P.mfc({ frac: 0.5, gas: 'Ar' }).read / 0.5, 1 / 1.4, 0.02), '氩气按 N₂ 读，读数约为真实的 1/1.4');

// 科里奥利：密度两点标定自洽；Δt 正比于质量流量
for (const rho of [781, 997, 1830]) ok(near(P.coriolis({ mdot: 0.01, rho }).rhoM, rho, 0.5), `科里奥利密度读数 ${rho}`);
ok(near(P.coriolis({ mdot: 0.02, rho: 997 }).dt / P.coriolis({ mdot: 0.01, rho: 997 }).dt, 2, 1e-9), '科里奥利时间差正比于质量流量');
ok(P.coriolis({ mdot: 0.01, rho: 1830 }).freq < P.coriolis({ mdot: 0.01, rho: 781 }).freq, '液体越重，振动频率越低');

// 电磁：E=BvD；纯水不行
const m = P.magMeter({ Q: 20 * P.LPM, sigma: 5000 });
ok(near(m.E, 0.005 * m.v * 0.025, 1e-12), 'E = B·v·D');
ok(!P.magMeter({ Q: 20 * P.LPM, sigma: 0.055 }).ok, '超纯水 0.055 µS/cm 低于普通电磁流量计下限');
ok(P.magMeter({ Q: 20 * P.LPM, sigma: 0.055, capacitive: true }).ok, '电容式的资料下限 0.01 µS/cm 低于超纯水电导率');

console.log(fail ? `\n${fail} 项不通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
