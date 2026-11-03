// 页面里所有方向判断都走这里，方便单独测试。
// 坐标约定：x 向右，y 向上（画到 Canvas 时再翻转），角度是数学角，逆时针为正。
// 电流 I > 0 表示“流出屏幕，朝着你”（⊙），I < 0 表示“流进屏幕”（⊗）。

export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

/** 一根垂直于屏幕的长直导线在 (x, y) 处的磁场。磁力线绕导线转，I > 0 时逆时针 */
export function wireField(x, y, wx, wy, I, soft = 1e-3) {
  const dx = x - wx, dy = y - wy, r2 = dx * dx + dy * dy + soft;
  return [-I * dy / r2, I * dx / r2];
}

/** 把线圈从中间切开：上排电流朝你（⊙），下排电流离开你（⊗）。I > 0 时线圈里的磁场向右 */
export function coilWires(n, halfLen, radius) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : -halfLen + 2 * halfLen * i / (n - 1);
    out.push({ x, y: radius, s: 1 }, { x, y: -radius, s: -1 });
  }
  return out;
}

export function coilField(x, y, wires, I, soft) {
  let bx = 0, by = 0;
  for (const w of wires) {
    const [a, b] = wireField(x, y, w.x, w.y, I * w.s, soft);
    bx += a; by += b;
  }
  return [bx, by];
}

/** 条形磁铁：两端当成一个正“磁荷”（N）和一个负“磁荷”（S）。dir = 1 时 N 在右 */
export function barField(x, y, halfLen, dir = 1, soft = 1e-3) {
  const f = (cx, sign) => {
    const dx = x - cx, dy = y, r2 = dx * dx + dy * dy + soft, r3 = r2 * Math.sqrt(r2);
    return [sign * dx / r3, sign * dy / r3];
  };
  const a = f(halfLen * dir, 1), b = f(-halfLen * dir, -1);
  return [a[0] + b[0], a[1] + b[1]];
}

/** 看着线圈的一面，电流绕的方向决定这一面是 N 还是 S。逆时针 = N，顺时针 = S */
export const faceOf = (spin) => (spin === 'ccw' ? 'N' : 'S');

/** 两组垂直线圈的合成：A 沿 x，B 沿 y */
export const combine2 = (a, b) => ({ x: a, y: b, angle: Math.atan2(b, a), size: Math.hypot(a, b) });

/** 想让总磁场指向 th：三相线圈（轴线 0°、120°、240°）各给多少电流 */
export const threePhase = (th, I = 1) => [0, 1, 2].map((k) => I * Math.cos(th - k * TAU / 3));

/** 三相线圈的合成磁场 */
export function combine3(iu, iv, iw) {
  const x = iu + iv * Math.cos(TAU / 3) + iw * Math.cos(2 * TAU / 3);
  const y = iv * Math.sin(TAU / 3) + iw * Math.sin(2 * TAU / 3);
  return { x, y, angle: Math.atan2(y, x), size: Math.hypot(x, y) };
}

/** 转子就是一根可以转的大磁针：总想让自己的 N 指向磁场方向 */
export function rotorStep(s, dt, { fieldAngle = 0, strength = 1, J = 1, damp = 1, load = 0 } = {}) {
  const pull = strength * Math.sin(fieldAngle - s.th);
  const fric = load * Math.tanh(s.w * 12);
  const w = s.w + (pull - fric - damp * s.w) / J * dt;
  return { th: s.th + w * dt, w, pull };
}

/** 第 7 步的模型：J dω/dt = 拉力 − 负载 − 摩擦。开环时磁场按设定转速自己走；闭环时磁场永远超前转子 90° */
export const DOG = { J: .1, c: .053, stiff: .22 };
export function dogStep(s, dt, { mode = 'closed', fieldSpeed = 0, current = 1, load = 0 }) {
  let f = s.f;
  if (mode === 'closed') f = s.th + Math.PI / 2;
  else f += fieldSpeed * dt;
  const delta = wrap(f - s.th);
  const pull = current * Math.sin(delta);
  const fw = mode === 'open' ? fieldSpeed : s.w;
  const damper = mode === 'open' ? DOG.stiff * Math.tanh((fw - s.w) * .6) * Math.cos(delta) * current : 0;   // 真电机铁芯里的涡流等效，让小幅晃动能停下来
  // 负载当成干摩擦：拉力小于它时根本转不起来
  const net = pull + damper - DOG.c * s.w;
  let w = s.w;
  if (Math.abs(w) < 1e-3 && Math.abs(net) <= load) w = 0;
  else {
    const dir = Math.abs(w) < 1e-3 ? Math.sign(net) : Math.sign(w);
    const next = w + (net - load * dir) / DOG.J * dt;
    w = next * dir < 0 ? 0 : next;          // 摩擦只能把速度减到零，不能把它反推回去
  }
  return { th: s.th + w * dt, w, f, delta, pull };
}

/** H 桥四个开关：1 左上、2 右上、3 左下、4 右下。返回流过线圈的方向（+1 从左到右），0 无电流，'short' 短路 */
export function hBridge({ s1, s2, s3, s4 }) {
  if ((s1 && s3) || (s2 && s4)) return 'short';
  if (s1 && s4) return 1;
  if (s2 && s3) return -1;
  return 0;
}

/** RL 负载上的 PWM：duty 占空比，period 周期（秒），tau 线圈时间常数（秒）。返回一段电流波形 */
export function pwmTrace(duty, period, tau, cycles = 6, N = 600) {
  const dt = period * cycles / N, out = [], gate = [];
  let i = duty;                   // 从平均值附近开始，少看一段过渡
  for (let k = 0; k < N; k++) {
    const on = ((k * dt) % period) < duty * period ? 1 : 0;
    i += (on - i) / tau * dt;
    out.push(i); gate.push(on);
  }
  return { i: out, gate };
}
