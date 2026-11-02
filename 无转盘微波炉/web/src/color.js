// 颜色表：热量（低 → 高，单一路径的深蓝紫到琥珀到白）、场强、带符号的波形。
function ramp(stops) {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [a, ca] = stops[k], [b, cb] = stops[k + 1], u = Math.min(1, Math.max(0, (t - a) / (b - a)));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = ca[c] + (cb[c] - ca[c]) * u;
  }
  return lut;
}

// 热量图：0 = 冷，0.5（平均值）= 橙，1.0（平均值 2 倍）= 接近白
export const HEAT_LUT = ramp([[0, [12, 16, 62]], [.22, [70, 22, 112]], [.42, [176, 44, 86]], [.56, [238, 96, 38]], [.76, [252, 178, 40]], [1, [255, 246, 214]]]);
export const FIELD_LUT = ramp([[0, [8, 9, 22]], [.3, [62, 18, 96]], [.55, [186, 48, 72]], [.78, [246, 136, 34]], [1, [255, 240, 180]]]);

// 带符号的波：128 = 0（深底），蓝 ← → 红；0 留给金属（透明）
export const WAVE_LUT = (() => {
  const lut = new Uint8Array(256 * 3);
  const neg = [[0, [14, 19, 40]], [.35, [20, 72, 150]], [.7, [52, 160, 232]], [1, [190, 240, 255]]];
  const pos = [[0, [14, 19, 40]], [.35, [150, 34, 44]], [.7, [240, 92, 38]], [1, [255, 226, 150]]];
  const pick = (st, t) => {
    let k = 0;
    while (k < st.length - 2 && t > st[k + 1][0]) k++;
    const [a, ca] = st[k], [b, cb] = st[k + 1], u = (t - a) / (b - a);
    return ca.map((x, i) => x + (cb[i] - x) * Math.min(1, Math.max(0, u)));
  };
  for (let i = 0; i < 256; i++) {
    const x = (i - 128) / 126, c = pick(x >= 0 ? pos : neg, Math.min(1, Math.abs(x)));
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = c[k];
  }
  return lut;
})();
export const WAVE_ALPHA = (() => {
  const t = new Uint8Array(256);
  t.fill(244); t[0] = 0;
  return t;
})();
export const FIELD_ALPHA = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 255; t[i] = Math.min(235, Math.pow(x, 1.1) * 330 + 8); }
  return t;
})();
