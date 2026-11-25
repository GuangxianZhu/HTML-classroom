// 练习题：每课 5 个出题函数，r 是随机数（mech.js 的 rng），返回 { q 题目, opts 选项, ans 正确选项的下标, why 讲解, val 正确答案的数值 }。
// 错误选项都是常见的算错方式（忘了换单位、把路程当位移、用了平均值……），讲解里会点出来。
// 只用到这一课和之前学过的东西。test_mech.mjs 每个函数跑几百遍，查答案和选项。
import * as M from './mech.js';

const fmt = (x, d) => (Math.abs(x) < 1e-9 ? '0' : (+x).toFixed(d).replace(/\.?0+$/, (z) => (d && z.includes('.') ? '' : z))).replace('-', '−');
/** 拼选项：正确值 + 几个错误值，按 d 位小数格式化、去重，不够 4 个就补“正确值的倍数” */
function mc(correct, wrongs, d, unit = '') {
  const out = [fmt(correct, d)];
  for (const w of [...wrongs, correct * 2, correct / 2, correct * 1.5, correct + 10, -correct]) {
    if (!Number.isFinite(w)) continue;
    const s = fmt(w, d);
    if (!out.includes(s)) out.push(s);
    if (out.length === 4) break;
  }
  return { opts: out.map((s) => `${s}${unit ? ` ${unit}` : ''}`), ans: 0, val: correct };
}
const both = (a, b, ua, ub) => `${a} ${ua}，${b} ${ub}`;

export const GEN = {
  1: [
    (r) => { // 往返：位移和路程
      const a = r.step(200, 900, 50), b = r.step(50, a - 50, 50);
      const opts = [both(a - b, a + b, '', ''), both(a + b, a + b, '', ''), both(a - b, a - b, '', ''), both(a + b, a - b, '', '')].map((s) => s.replace(/(\d+) ，(\d+) /, '位移 $1 m，路程 $2 m'));
      return { q: `从家出发往东走 ${a} m，再往回走 ${b} m。位移和路程分别是多少？`, opts, ans: 0, val: a - b,
        why: `位移只看起点到终点：${a} − ${b} = ${a - b} m（朝东）。路程把两段都加起来：${a} + ${b} = ${a + b} m。` };
    },
    (r) => { // 换原点：位置变，位移不变
      const st = r.step(20, 80, 10), a = r.step(10, 120, 10), b = r.step(10, 120, 10);
      const dx = -b - a, x2 = -b - st;
      const m = mc(dx, [x2, dx - st, -dx], 0, 'm');
      return { q: `以家为原点、朝东为正，车先在 x = ${a} m，后来在 x = −${b} m。现在把原点挪到家东边 ${st} m 的便利店，这段的位移是多少？`, ...m,
        why: `挪原点只会让每个位置都减去 ${st}，两个位置相减时 ${st} 被消掉，位移还是 −${b} − ${a} = ${fmt(dx, 0)} m。` };
    },
    (r) => { // 正负号：从负的位置开到正的位置
      const a = r.step(10, 60, 5), b = r.step(10, 80, 5);
      const m = mc(a + b, [b - a, a - b, -(a + b)], 0, 'm');
      return { q: `朝东为正。车从 x = −${a} m 开到 x = +${b} m，位移是多少？`, ...m,
        why: `位移 = 末位置 − 初位置 = ${b} − (−${a}) = ${a + b} m。减一个负数就是加。` };
    },
    (r) => { // 圆形跑道半圈
      const R = r.step(20, 60, 5);
      const opts = [both(2 * R, fmt(Math.PI * R, 0), 'm', 'm'), both(fmt(Math.PI * R, 0), fmt(Math.PI * R, 0), 'm', 'm'), both(0, fmt(Math.PI * R, 0), 'm', 'm'), both(2 * R, 2 * R, 'm', 'm')]
        .map((s) => `位移 ${s.replace('，', '，路程 ')}`);
      return { q: `在半径 ${R} m 的圆形场地上跑了半圈。位移的大小和路程分别约是多少？（π 取 3.14）`, opts, ans: 0, val: 2 * R,
        why: `位移是起点到终点的直线：正好一条直径，2 × ${R} = ${2 * R} m。路程是走过的弧长：半个圆周 π × ${R} ≈ ${fmt(Math.PI * R, 0)} m。` };
    },
    (r) => { // 三段行程
      const a = r.step(100, 500, 50), b = r.step(50, 400, 50), c = r.step(50, 300, 50);
      const d = a - b + c, s = a + b + c;
      const opts = [`位移 ${fmt(d, 0)} m，路程 ${s} m`, `位移 ${s} m，路程 ${s} m`, `位移 ${fmt(d, 0)} m，路程 ${fmt(d, 0)} m`, `位移 ${fmt(a + b - c, 0)} m，路程 ${s} m`];
      return { q: `车往东开 ${a} m，掉头往西 ${b} m，再掉头往东 ${c} m。朝东为正，位移和路程是？`, opts: [...new Set(opts)].length === 4 ? opts : [opts[0], opts[1], opts[2], `位移 ${fmt(-d, 0)} m，路程 ${s} m`], ans: 0, val: d,
        why: `位移把带方向的三段加起来：${a} − ${b} + ${c} = ${fmt(d, 0)} m。路程不管方向：${a} + ${b} + ${c} = ${s} m。` };
    },
  ],
  2: [
    (r) => { // 平均速度（带正负）
      const dx = -r.step(20, 120, 10), dt = r.step(4, 20, 2);
      const m = mc(dx / dt, [-dx / dt, dt / dx, dx * dt], 1, 'm/s');
      return { q: `朝东为正。车 ${dt} s 内从 x = 50 m 开到 x = ${50 + dx} m，平均速度是多少？`, ...m,
        why: `平均速度 = 位移 ÷ 时间 = (${50 + dx} − 50) ÷ ${dt} = ${fmt(dx / dt, 1)} m/s。负号表示朝西。` };
    },
    (r) => { // 往返：平均速度和平均速率
      const a = r.step(100, 400, 50), t1 = r.step(10, 30, 5), t2 = r.step(10, 30, 5);
      const opts = [`平均速度 0，平均速率 ${fmt(2 * a / (t1 + t2), 1)} m/s`, `都是 ${fmt(2 * a / (t1 + t2), 1)} m/s`, `平均速度 ${fmt(a / (t1 + t2), 1)} m/s，平均速率 ${fmt(2 * a / (t1 + t2), 1)} m/s`, '都是 0'];
      return { q: `车开出去 ${a} m 用了 ${t1} s，再原路开回来用了 ${t2} s。整个来回的平均速度和平均速率是？`, opts, ans: 0, val: 0,
        why: `回到起点，位移是 0，所以平均速度是 0。平均速率 = 路程 ÷ 时间 = ${2 * a} ÷ ${t1 + t2} ≈ ${fmt(2 * a / (t1 + t2), 1)} m/s。` };
    },
    (r) => { // km/h → m/s
      const k = r.pick([36, 54, 72, 90, 108, 126]);
      const m = mc(k / 3.6, [k * 3.6, k / 60, k / 1000], 1, 'm/s');
      return { q: `${k} km/h 等于多少 m/s？`, ...m, why: `1 m/s = 3.6 km/h，所以 ${k} ÷ 3.6 = ${fmt(k / 3.6, 1)} m/s。` };
    },
    (r) => { // m/s → km/h
      const v = r.pick([5, 10, 15, 20, 25, 30, 35]);
      const m = mc(v * 3.6, [v / 3.6, v * 60, v * 36], 0, 'km/h');
      return { q: `速度表外面的人量出车速是 ${v} m/s，速度表上该显示多少 km/h？`, ...m, why: `每秒 ${v} m，一小时 3600 s 走 ${v * 3600} m，就是 ${v * 3.6} km。直接 × 3.6 就行。` };
    },
    (r) => { // 前一半路程、后一半路程
      const [v1, v2] = r.pick([[20, 30], [30, 60], [40, 60], [60, 90], [40, 120]]);
      const avg = 2 * v1 * v2 / (v1 + v2);
      const m = mc(avg, [(v1 + v2) / 2, Math.max(v1, v2), Math.sqrt(v1 * v2)], 0, 'km/h');
      return { q: `去公司的路，前一半路程车速 ${v1} km/h，后一半路程 ${v2} km/h。全程的平均速度是多少？`, ...m,
        why: `设一半路程是 d：前一半用时 d/${v1}，后一半 d/${v2}。平均速度 = 2d ÷ (d/${v1} + d/${v2}) = ${fmt(avg, 0)} km/h。慢的那一半花的时间多，所以比 ${(v1 + v2) / 2} 小。` };
    },
  ],
  3: [
    (r) => { // 0→100 的平均加速度
      const t = r.pick([8, 9, 10, 11, 12, 14]);
      const m = mc(100 / 3.6 / t, [100 / t, 100 / 3.6 * t, 3.6 / t], 2, 'm/s²');
      return { q: `车从静止加速到 100 km/h 用了 ${t} s，平均加速度是多少？`, ...m, why: `先换单位：100 km/h = 27.8 m/s。a = Δv ÷ Δt = 27.8 ÷ ${t} ≈ ${fmt(100 / 3.6 / t, 2)} m/s²。` };
    },
    (r) => { // 减速：负的加速度
      const v1 = r.step(15, 30, 1), v2 = r.step(0, v1 - 5, 1), t = r.step(2, 8, 1);
      const m = mc((v2 - v1) / t, [(v1 - v2) / t, (v2 + v1) / t, (v2 - v1) * t], 2, 'm/s²');
      return { q: `朝前为正。车速 ${t} s 内从 ${v1} m/s 降到 ${v2} m/s，加速度是多少？`, ...m,
        why: `a = (末速度 − 初速度) ÷ 时间 = (${v2} − ${v1}) ÷ ${t} = ${fmt((v2 - v1) / t, 2)} m/s²。负号说明加速度朝后，和速度方向相反，所以在减速。` };
    },
    (r) => { // 已知加速度求末速度（km/h）
      const a = r.pick([1.5, 2, 2.5, 3]), t = r.step(3, 8, 1), v0k = r.pick([0, 18, 36]);
      const vk = v0k + a * t * 3.6;
      const m = mc(vk, [v0k + a * t, a * t * 3.6, v0k + a * t * 3.6 / 2], 0, 'km/h');
      return { q: `车速 ${v0k} km/h 时开始以 ${a} m/s² 加速，${t} s 后车速是多少 km/h？`, ...m,
        why: `每秒涨 ${a} m/s，${t} s 涨 ${fmt(a * t, 1)} m/s，合 ${fmt(a * t * 3.6, 0)} km/h。再加上原来的 ${v0k} km/h，是 ${fmt(vk, 0)} km/h。` };
    },
    (r) => { // v-t 图两点求斜率
      const t1 = r.step(1, 4, 1), t2 = t1 + r.step(2, 6, 1), v1 = r.step(2, 10, 2), v2 = v1 + r.step(4, 16, 2);
      const m = mc((v2 - v1) / (t2 - t1), [v2 / t2, (v2 - v1) / t2, (t2 - t1) / (v2 - v1)], 2, 'm/s²');
      return { q: `v-t 图是一条直线，经过 (${t1} s, ${v1} m/s) 和 (${t2} s, ${v2} m/s)。加速度是多少？`, ...m,
        why: `加速度就是 v-t 图的斜率：(${v2} − ${v1}) ÷ (${t2} − ${t1}) = ${fmt((v2 - v1) / (t2 - t1), 2)} m/s²。` };
    },
    (r) => { // 加速还是减速
      const cases = [[-1, 1, '减速'], [-1, -1, '加速'], [1, -1, '减速'], [1, 1, '加速']];
      const [sv, sa, ans] = r.pick(cases), v = r.step(3, 12, 1), a = r.step(1, 4, 1);
      const opts = ['加速（越开越快）', '减速（越开越慢）', '匀速', '没法判断'];
      return { q: `朝东为正。某一刻 v = ${sv < 0 ? '−' : ''}${v} m/s，a = ${sa < 0 ? '−' : ''}${a} m/s²。车在加速还是减速？`, opts, ans: ans === '加速' ? 0 : 1, val: sv * sa,
        why: `看速度和加速度是不是同一个方向：${sv * sa > 0 ? '同号，同方向，越来越快' : '一正一负，方向相反，越来越慢'}。正负号只代表朝东还是朝西，不代表快慢。` };
    },
  ],
  4: [
    (r) => { // 匀速：长方形面积
      const k = r.pick([36, 54, 60, 72, 90, 108]), t = r.step(10, 60, 5);
      const m = mc(k / 3.6 * t, [k * t, k / 3.6 * t / 2, k * t / 60], 0, 'm');
      return { q: `车以 ${k} km/h 匀速开了 ${t} s，走了多远？`, ...m, why: `${k} km/h = ${fmt(k / 3.6, 1)} m/s；v-t 图下面是一个长方形，面积 = ${fmt(k / 3.6, 1)} × ${t} ≈ ${fmt(k / 3.6 * t, 0)} m。` };
    },
    (r) => { // 从 0 匀加速：三角形
      const v = r.step(10, 30, 2), t = r.step(4, 12, 1);
      const m = mc(v * t / 2, [v * t, v / t, v * t * t / 2], 0, 'm');
      return { q: `车从静止匀加速，${t} s 后车速 ${v} m/s。这 ${t} s 走了多远？`, ...m, why: `v-t 图是一个三角形，面积 = ½ × ${t} × ${v} = ${fmt(v * t / 2, 0)} m。不是 ${v} × ${t}：前面开得慢，走得少。` };
    },
    (r) => { // x = v0 t + ½ a t²
      const v0 = r.step(2, 20, 2), a = r.pick([1, 1.5, 2, 2.5, 3]), t = r.step(2, 10, 1);
      const x = M.xAt(v0, a, t);
      const m = mc(x, [v0 * t + a * t * t, v0 * t, v0 * t + 0.5 * a * t], 1, 'm');
      return { q: `车速 ${v0} m/s 时开始以 ${a} m/s² 匀加速，${t} s 内走了多远？`, ...m, why: `x = v₀t + ½at² = ${v0} × ${t} + ½ × ${a} × ${t}² = ${v0 * t} + ${fmt(0.5 * a * t * t, 1)} = ${fmt(x, 1)} m。长方形加上面那个三角形。` };
    },
    (r) => { // 先加速后匀速：两块面积
      const a = r.pick([2, 2.5, 3]), t1 = r.step(4, 8, 1), t2 = r.step(5, 20, 5);
      const v = a * t1, x = 0.5 * v * t1 + v * t2;
      const m = mc(x, [v * (t1 + t2), 0.5 * v * (t1 + t2), v * t2], 0, 'm');
      return { q: `车从静止以 ${a} m/s² 加速 ${t1} s，然后匀速开 ${t2} s。一共走了多远？`, ...m,
        why: `加速段末速度 ${a} × ${t1} = ${fmt(v, 0)} m/s。v-t 图下面是三角形 + 长方形：½ × ${t1} × ${fmt(v, 0)} + ${fmt(v, 0)} × ${t2} = ${fmt(0.5 * v * t1, 0)} + ${fmt(v * t2, 0)} = ${fmt(x, 0)} m。` };
    },
    (r) => { // 平均速度 = (v0 + v)/2
      const v0 = r.step(4, 14, 2), v = v0 + r.step(4, 16, 2), t = r.step(3, 10, 1);
      const m = mc((v0 + v) / 2 * t, [v * t, v0 * t, (v - v0) / 2 * t], 0, 'm');
      return { q: `车匀加速，${t} s 内车速从 ${v0} m/s 涨到 ${v} m/s。走了多远？`, ...m,
        why: `梯形面积 = (上底 + 下底) ÷ 2 × 高 = (${v0} + ${v}) ÷ 2 × ${t} = ${fmt((v0 + v) / 2 * t, 0)} m。匀加速时平均速度正好是首尾速度的平均。` };
    },
  ],
  5: [
    (r) => { // 刹车距离
      const k = r.pick([36, 54, 72, 90, 108]), b = r.pick([5, 6, 7, 8]);
      const v = k / 3.6, d = v * v / (2 * b);
      const m = mc(d, [k * k / (2 * b), v * v / b, v / (2 * b)], 1, 'm');
      return { q: `车速 ${k} km/h，急刹的减速度 ${b} m/s²。刹车距离是多少？`, ...m, why: `先换单位：${fmt(v, 1)} m/s。v² − v₀² = 2ax，末速度 0：x = v₀² ÷ (2a) = ${fmt(v, 1)}² ÷ ${2 * b} ≈ ${fmt(d, 1)} m。` };
    },
    (r) => { // 车速 ×k → 距离 ×k²
      const k = r.pick([2, 3, 1.5]), d = r.step(10, 40, 5);
      const m = mc(d * k * k, [d * k, d * k * 2, d + k], 1, 'm');
      return { q: `同一条路、同样用力踩刹车，某个车速下刹车距离是 ${d} m。车速变成 ${k} 倍，刹车距离是多少？`, ...m, why: `刹车距离 = v₀² ÷ (2a)，跟着车速的平方走：${k}² = ${fmt(k * k, 2)} 倍，${d} × ${fmt(k * k, 2)} = ${fmt(d * k * k, 1)} m。` };
    },
    (r) => { // 反应距离 + 刹车距离
      const k = r.pick([36, 54, 72, 90]), tr = r.pick([0.6, 0.8, 1.0]), b = r.pick([6, 7]);
      const s = M.stopping(k / 3.6, tr, b);
      const m = mc(s.d, [s.db, s.dr, k * tr + s.db], 1, 'm');
      return { q: `车速 ${k} km/h，看到情况 ${tr} s 后才踩下刹车，减速度 ${b} m/s²。从看到到停下，一共要多远？`, ...m,
        why: `反应时间里车照原速开：${fmt(k / 3.6, 1)} × ${tr} = ${fmt(s.dr, 1)} m；刹车距离 ${fmt(k / 3.6, 1)}² ÷ ${2 * b} = ${fmt(s.db, 1)} m；加起来 ${fmt(s.d, 1)} m。` };
    },
    (r) => { // 刹车陷阱
      const v = r.step(10, 24, 2), b = r.pick([4, 5]), tstop = v / b, t = Math.ceil(tstop) + r.step(1, 3, 1);
      const real = v * v / (2 * b), naive = M.xAt(v, -b, t);
      const m = mc(real, [naive, v * t, v * t / 2], 1, 'm');
      return { q: `车以 ${v} m/s 开始刹车，减速度 ${b} m/s²。刹车后 ${t} s 内车走了多远？`, ...m,
        why: `先算多久停下：${v} ÷ ${b} = ${fmt(tstop, 1)} s，比 ${t} s 短，后面车已经停了。所以是 ${v}² ÷ (2 × ${b}) = ${fmt(real, 1)} m。直接把 ${t} s 代进 x = v₀t − ½at² 会得到 ${fmt(naive, 1)} m，那是假装车停了还会倒着开。` };
    },
    (r) => { // 给定距离，最高车速
      const d = r.step(20, 60, 5), b = r.pick([5, 6, 7]);
      const v = Math.sqrt(2 * b * d);
      const m = mc(v * 3.6, [v, 2 * b * d / 3.6, Math.sqrt(b * d) * 3.6], 0, 'km/h');
      return { q: `前方 ${d} m 有障碍，减速度 ${b} m/s²，不算反应时间。车速最高多少 km/h 还能停住？`, ...m,
        why: `v₀² = 2ax → v₀ = √(2 × ${b} × ${d}) ≈ ${fmt(v, 1)} m/s，× 3.6 ≈ ${fmt(v * 3.6, 0)} km/h。` };
    },
  ],
};
