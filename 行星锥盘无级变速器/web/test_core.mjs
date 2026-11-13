// 物理核心的校验：node test_core.mjs
import * as C from './src/core.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok  ' : ' FAIL ') + msg); if (!cond) fail++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const g = C.PARAMS.geom;

console.log('速比和转速');
const f = C.solve(0), s = C.solve(1);
ok(near(f.i, 1.4, 1e-9) && near(s.i, 7, 1e-9), `两端速比 1:${f.i.toFixed(2)} ~ 1:${s.i.toFixed(2)}（照片上写 200~1000 转）`);
ok(near(f.nOutIdeal, 1000, 1e-6) && near(s.nOutIdeal, 200, 1e-6), `输入 1400 r/min 时输出 ${f.nOutIdeal.toFixed(0)} ~ ${s.nOutIdeal.toFixed(0)} r/min`);
ok(near(C.carrierSpeed(1400, 0, f.T), f.nOutIdeal, 1e-9), '外环不转时，Willis 公式给出的行星架转速和 geomAt 一致');
ok(near(C.carrierSpeed(1400, 1400, 3), 1400, 1e-9), '太阳轮和外环同速时整体一起转（行星机构的锁止）');
ok(near(C.uOfN(553.2), 0.5, 0.01), 'uOfN 是 geomAt 的反函数');
let mono = true;
for (let k = 1; k <= 100; k++) if (C.geomAt(k / 100).nOutIdeal >= C.geomAt((k - 1) / 100).nOutIdeal) mono = false;
ok(mono, '手轮往慢挡拧，输出转速单调下降');

console.log('几何能不能装下');
const Ef = C.E_FAST;
ok(2 * Ef * Math.sin(Math.PI / g.n_planet) - 2 * g.rho_p > 4, `最快挡（盘最靠里）时相邻行星盘之间还有 ${(2 * Ef * Math.sin(Math.PI / g.n_planet) - 2 * g.rho_p).toFixed(1)} mm`);
let inside = true, shaftClear = true;
for (let k = 0; k <= 100; k++) {
  const m = C.geomAt(k / 100);
  if (m.ra < g.planet_shaft_r + 1.2 || m.rb < g.planet_shaft_r + 1.2 || m.ra > g.rho_p - 2 || m.rb > g.rho_p - 2) inside = false;
  if (m.e - g.planet_shaft_r < 40.25 + 1 || m.e + g.planet_shaft_r > 59.4 - 0.5) shaftClear = false;
}
ok(inside, '两个接触点始终落在盘面上：离心轴至少 1.2 mm，离盘边至少 2 mm');
ok(shaftClear, '行星盘心轴始终从主动轮刃口和外环刃口之间穿过，不碰');
ok(C.thick(g.rho_p) > 1.5, `盘边厚度 ${C.thick(g.rho_p).toFixed(2)} mm`);

console.log('调速方向和碟簧');
ok(f.gOut < s.gOut, `外夹缝：快挡 ${f.gOut.toFixed(2)} mm < 慢挡 ${s.gOut.toFixed(2)} mm（凸轮收紧 → 变快）`);
ok(f.gIn > s.gIn && f.Fs > s.Fs, `内夹缝：快挡被撑开 ${f.gIn.toFixed(2)} mm，碟簧 ${f.Fs.toFixed(0)} N > 慢挡 ${s.Fs.toFixed(0)} N`);
ok(near(f.gIn - s.gIn, s.gOut - f.gOut, 1e-9), '内外夹缝的变化量相等（两边夹的是同一个楔角）');
ok(f.Nb > f.Na, `离心力让外侧正压力比内侧大：${f.Nb.toFixed(0)} N vs ${f.Na.toFixed(0)} N（快挡）`);

console.log('扭矩、功率和打滑');
ok(near(f.Trated, 6.4, 0.2) && f.limitBy === 'motor', `快挡额定输出 ${f.Trated.toFixed(2)} N·m，被电机卡住（样本表写 6）`);
ok(near(s.Trated, 12, 0.2) && s.limitBy === 'friction', `慢挡额定输出 ${s.Trated.toFixed(2)} N·m，被摩擦卡住（样本表写 12）`);
const p = C.solve(0.3, 8);
ok(near(p.Pout, p.Pin * p.eta, 1e-6), '功率守恒：输出功率 = 输入功率 × 效率');
ok(near(p.Fta * p.ra, p.Ftb * p.rb, 1e-9), '行星盘自转力矩平衡：内侧切向力 × ρa = 外侧 × ρb');
ok(!C.solve(1, 12).slipping && C.solve(1, 19).slipping, '慢挡 12 N·m 不滑，19 N·m 打滑（极限 18）');
ok(C.solve(0, 17).slipping && !C.solve(0, 16).slipping, '快挡极限约 16.2 N·m');
ok(C.solve(1, 12).creep > 0 && C.solve(1, 12).creep < 0.03, `额定负载下蠕滑 ${(C.solve(1, 12).creep * 100).toFixed(1)}%`);
const lowMu = C.solve(1, 12, { mu: 0.04 });
ok(lowMu.slipping, '换成普通润滑油（μ 0.04）时，慢挡 12 N·m 就会打滑');
const ch = C.characteristic();
ok(ch[0].P > ch[ch.length - 1].P * 2, `额定输出功率：最快 ${ch[0].P.toFixed(0)} W，最慢 ${ch[ch.length - 1].P.toFixed(0)} W（低速段功率掉下来）`);

console.log('两个摩擦轮');
const w = C.wheelPair({ r1: 30, r2: 60, N: 200, mu: 0.07, T2: 0.5, n1: 1400 });
ok(near(w.n2Ideal, 700, 1e-9) && !w.slipping, '半径 30 带 60：转速减半，不滑');
ok(C.wheelPair({ r1: 30, r2: 60, N: 200, mu: 0.07, T2: 1.0, n1: 1400 }).slipping, '负载超过 μN·r 就打滑');

console.log(fail ? `\n${fail} 项不通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
