// 动作原语的纯数学部分（不依赖 three.js，node 里也能跑）。
//
// 每个“步骤”是 {text: 讲解文字, actions: [动作...], state: 文字版状态图}。
// 同一步里的动作同时开始；每个动作有自己的模拟时长 t（秒），
// 所以“堆垛机横行 7 秒、升降 5 秒”会真实地体现为升降先结束。
//
// 动作种类：
//   move  : names 里的物体一起平移 d=[dx,dy,dz]
//   turn  : names 里的物体各自绕竖直轴转 deg 度
//   loop  : 一组物体沿“跑道形”闭合路径前进 ds（垂直循环的链条）
//   spawn : 新建一辆车（瞬间）
//   remove: 移除一辆车（瞬间）
//
// 坐标：x 右、y 上、z 朝向观众（和 three.js 一样）。朝向角 heading 绕 +y 转，
// 正角度把 +x 转向 -z（three.js 的 rotation.y 也是这个方向）。

export function smooth(u) {
  // 先加速后减速，比匀速看起来更像机械
  u = Math.max(0, Math.min(1, u));
  return u * u * (3 - 2 * u);
}

export function stadiumLength(p) {
  return 2 * p.h + 2 * Math.PI * p.r;
}

// 跑道形路径上弧长 s 处的点。s=0 在最底部正中，s 增大 = 从正面看逆时针。
export function stadiumPoint(p, s) {
  const { r, h, cx, cy, z } = p;
  const L = stadiumLength(p);
  s = ((s % L) + L) % L;
  const q = Math.PI * r / 2;
  if (s < q) {
    const th = -Math.PI / 2 + s / r;
    return [cx + r * Math.cos(th), cy - h / 2 + r * Math.sin(th), z];
  }
  s -= q;
  if (s < h) return [cx + r, cy - h / 2 + s, z];
  s -= h;
  if (s < Math.PI * r) {
    const th = s / r;
    return [cx + r * Math.cos(th), cy + h / 2 + r * Math.sin(th), z];
  }
  s -= Math.PI * r;
  if (s < h) return [cx - r, cy + h / 2 - s, z];
  s -= h;
  const th = Math.PI + s / r;
  return [cx + r * Math.cos(th), cy - h / 2 + r * Math.sin(th), z];
}

export function stepDuration(step) {
  let m = 0;
  for (const a of step.actions) m = Math.max(m, a.t || 0);
  return m;
}

// poses: {名字: [[x,y,z], 朝向角]}，为步骤开始时的位姿。返回 tau 秒时的位姿（新对象）。
export function posesAt(poses, step, tau) {
  const out = { ...poses };
  for (const a of step.actions) {
    const t = a.t || 0;
    const k = t <= 0 ? 1 : smooth(tau / t);
    if (a.op === 'move') {
      const [dx, dy, dz] = a.d;
      for (const n of a.names) {
        const [[x, y, z], h] = out[n];
        out[n] = [[x + dx * k, y + dy * k, z + dz * k], h];
      }
    } else if (a.op === 'turn') {
      for (const n of a.names) {
        const [p, h] = out[n];
        out[n] = [p, h + a.deg * k];
      }
    } else if (a.op === 'loop') {
      const path = a.path;
      for (const [names, s0] of a.items) {
        const [x, y, z] = stadiumPoint(path, s0 + a.ds * k);
        for (const n of names) out[n] = [[x, y - path.hang, z], out[n][1]];
      }
    }
  }
  return out;
}

// 无动画地把一步执行到底（自检用）
export function applyStep(poses, step) {
  poses = { ...poses };
  for (const a of step.actions) {
    if (a.op === 'spawn') poses[a.name] = [[...a.pos], a.heading || 0];
  }
  poses = posesAt(poses, step, stepDuration(step));
  for (const a of step.actions) {
    if (a.op === 'remove') delete poses[a.name];
  }
  return poses;
}
