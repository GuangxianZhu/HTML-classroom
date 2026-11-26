// 课本对照页的练习：用课本的字母、单位和说法出题（g 取 10 m/s²）。每页 5 个出题函数，格式和 src/problems.js 一样。
const pick4 = (right, wrongs) => {
  const out = [right];
  for (const w of wrongs) { if (!out.includes(w)) out.push(w); if (out.length === 4) break; }
  return out;
};

export const BGEN = {
  2: [
    (r) => { // 牛顿第二定律
      const m = r.pick([2, 4, 5, 8, 10]), a = r.int(2, 6), F = m * a;
      return { q: `质量 m = ${m} kg 的物体放在光滑水平面上，要让它以 a = ${a} m/s² 的加速度运动，水平拉力 F 是多少？`,
        opts: pick4(`${F} N`, [`${m + a} N`, `${F * 10} N`, `${m * 10} N`, `${F + 2} N`]), ans: 0, val: F,
        why: `F = ma = ${m} × ${a} = ${F} N。小课里的说法：力 = 质量 × 速度每秒涨多少。` };
    },
    (r) => { // 合力
      const f = r.pick([500, 1000, 1500]), a = r.int(1, 3), F = f + 1000 * a;
      return { q: `汽车质量 m = 1000 kg，牵引力 F = ${F} N，阻力 f = ${f} N，在水平路面上做直线运动。加速度 a 是多少？`,
        opts: pick4(`${a} m/s²`, [`${F / 1000} m/s²`, `${(F + f) / 1000} m/s²`, `${f / 1000} m/s²`, `${a + 4} m/s²`]), ans: 0, val: a,
        why: `F合 = F − f = ${F} − ${f} = ${1000 * a} N，a = F合 ÷ m = ${a} m/s²。牛顿第二定律里的 F 是合力。` };
    },
    (r) => { // 自由落体
      const t = r.int(2, 5), h = 5 * t * t, v = 10 * t;
      return { q: `物体从静止开始自由下落，g 取 10 m/s²，不计空气阻力。下落 t = ${t} s 时，下落的高度 h 是多少？`,
        opts: pick4(`${h} m`, [`${v * t} m`, `${v} m`, `${5 * t} m`, `${h + 5} m`]), ans: 0, val: h,
        why: `h = ½gt² = ½ × 10 × ${t}² = ${h} m。这时速度 v = gt = ${v} m/s；${v * t} m 是忘了乘 ½。` };
    },
    (r) => { // 斜面上重力的分力
      const m = r.pick([2, 5, 10, 20]), s = r.pick([3, 5, 6]), G = m * 10, P = G * s / 10;
      return { q: `质量 m = ${m} kg 的物体放在斜面上，斜面倾角 θ 满足 sin θ = 0.${s}，g 取 10 m/s²。重力沿斜面向下的分力是多少？`,
        opts: pick4(`${P} N`, [`${G} N`, `${m * s / 10} N`, `${G - P} N`, `${P + 10} N`, `${G * 2} N`, `${P + 5} N`]), ans: 0, val: P,
        why: `G = mg = ${G} N，沿斜面向下的分力 = mg sin θ = ${G} × 0.${s} = ${P} N。sin θ = 0.${s} 就是“沿坡走 10 米升高 ${s} 米”。` };
    },
    (r) => { // 超重和失重
      const m = r.pick([40, 50, 60]), a = r.int(1, 3), up = r.int(0, 1) === 1, G = m * 10, N = up ? G + m * a : G - m * a;
      return { q: `电梯里的人质量 m = ${m} kg，g 取 10 m/s²。电梯以 a = ${a} m/s² 的加速度${up ? '加速上升' : '加速下降'}，地板对人的支持力是多少？`,
        opts: pick4(`${N} N`, [`${G} N`, `${up ? G - m * a : G + m * a} N`, `${m * a} N`]), ans: 0, val: N,
        why: up ? `加速度向上：F<sub>N</sub> − mg = ma，F<sub>N</sub> = m(g + a) = ${m} × ${10 + a} = ${N} N，比重力大，是超重。`
          : `加速度向下：mg − F<sub>N</sub> = ma，F<sub>N</sub> = m(g − a) = ${m} × ${10 - a} = ${N} N，比重力小，是失重。` };
    },
  ],
  3: [
    (r) => { // 平抛：水平位移
      const [h, t] = r.pick([[5, 1], [20, 2], [45, 3]]), v = r.pick([4, 6, 8, 10, 15]), x = v * t;
      return { q: `小球从 h = ${h} m 高处以 v₀ = ${v} m/s 水平抛出，g 取 10 m/s²，不计空气阻力。落地点离抛出点的水平距离 x 是多少？`,
        opts: pick4(`${x} m`, [`${v * h} m`, `${h} m`, `${v} m`, `${x + 5} m`, `${x + 10} m`]), ans: 0, val: x,
        why: `先由竖直方向求时间：h = ½gt²，t = ${t} s。再算水平方向：x = v₀t = ${v} × ${t} = ${x} m。` };
    },
    (r) => { // 平抛：落地时的竖直分速度
      const t = r.int(1, 4), v = r.pick([5, 8, 12]), vy = 10 * t;
      return { q: `小球以 v₀ = ${v} m/s 水平抛出，经过 t = ${t} s 落地，g 取 10 m/s²。落地时竖直方向的分速度 v<sub>y</sub> 是多少？`,
        opts: pick4(`${vy} m/s`, [`${v} m/s`, `${vy + v} m/s`, `${5 * t * t} m/s`, `${vy + 5} m/s`, `${vy + 20} m/s`]), ans: 0, val: vy,
        why: `竖直方向是自由落体：v<sub>y</sub> = gt = 10 × ${t} = ${vy} m/s，和 v₀ 无关。` };
    },
    (r) => { // 向心力
      const v = r.pick([10, 20, 30]), R = r.pick([50, 100, 200]), F = 1000 * v * v / R;
      return { q: `质量 m = 1000 kg 的汽车以 v = ${v} m/s 通过半径 r = ${R} m 的水平弯道。需要的向心力是多少？`,
        opts: pick4(`${F} N`, [`${1000 * v / R * 10} N`, `${1000 * v} N`, `${F * 2} N`, `${F + 1000} N`, `${F + 500} N`]), ans: 0, val: F,
        why: `F = mv²/r = 1000 × ${v}² ÷ ${R} = ${F} N，由地面的静摩擦力提供。` };
    },
    (r) => { // 向心加速度
      const v = r.pick([10, 20]), R = r.pick([20, 50, 100]), a = v * v / R;
      return { q: `物体以 v = ${v} m/s 做半径 r = ${R} m 的匀速圆周运动。向心加速度 a 是多少？`,
        opts: pick4(`${a} m/s²`, ['0', `${v / R * 10} m/s²`, `${a * 2} m/s²`, `${a + 3} m/s²`, `${a + 6} m/s²`]), ans: 0, val: a,
        why: `a = v²/r = ${v}² ÷ ${R} = ${a} m/s²，方向指向圆心。速度大小不变，但方向在变，所以加速度不是 0。` };
    },
    (r) => { // 第一宇宙速度
      const t = r.pick([10, 100, 1000]), d = 7.9 * t;
      return { q: `近地卫星的速度约为第一宇宙速度 7.9 km/s。它在 ${t} s 内飞过的路程约是多少？`,
        opts: pick4(`${d} km`, [`${t} km`, `${d * 10} km`, `${7.9 + t} km`]), ans: 0, val: d,
        why: `s = vt = 7.9 × ${t} = ${d} km。小课里取整成了每秒 8 千米。` };
    },
  ],
};
