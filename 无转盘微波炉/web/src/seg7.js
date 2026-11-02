// 七段数码管：微波炉显示屏的字形，模型屏幕和页面读数共用。
const MAP = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '', E: 'adefg', r: 'eg', d: 'bcdeg', o: 'cdeg', n: 'ceg' };

function seg(c, x, y, w, h, t, s) {
  // 每段是一个削角六边形
  const P = { a: [x + t, y, w - 2 * t, t, 0], g: [x + t, y + h / 2 - t / 2, w - 2 * t, t, 0], d: [x + t, y + h - t, w - 2 * t, t, 0],
    f: [x, y + t, t, h / 2 - t, 1], b: [x + w - t, y + t, t, h / 2 - t, 1], e: [x, y + h / 2, t, h / 2 - t, 1], c: [x + w - t, y + h / 2, t, h / 2 - t, 1] }[s];
  const [a, b, l, m, v] = P, q = t * .42;
  c.beginPath();
  if (!v) { c.moveTo(a + q, b); c.lineTo(a + l - q, b); c.lineTo(a + l, b + m / 2); c.lineTo(a + l - q, b + m); c.lineTo(a + q, b + m); c.lineTo(a, b + m / 2); }
  else { c.moveTo(a, b + q); c.lineTo(a + l / 2, b); c.lineTo(a + l, b + q); c.lineTo(a + l, b + m - q); c.lineTo(a + l / 2, b + m); c.lineTo(a, b + m - q); }
  c.closePath(); c.fill();
}

export function drawSeg(c, text, x, y, w, h, on, off) {
  const t = Math.max(2, w * .17), gap = w * .26;
  let cx = x;
  for (const ch of String(text)) {
    if (ch === ':' || ch === '.') {
      c.fillStyle = on;
      if (ch === ':') { c.fillRect(cx, y + h * .28, t * .8, t * .8); c.fillRect(cx, y + h * .66, t * .8, t * .8); }
      else c.fillRect(cx, y + h - t * .9, t * .8, t * .8);
      cx += t + gap * .7;
      continue;
    }
    if (off) { c.fillStyle = off; for (const s of 'abcdefg') seg(c, cx, y, w, h, t, s); }
    c.fillStyle = on;
    for (const s of MAP[ch] ?? '') seg(c, cx, y, w, h, t, s);
    cx += w + gap;
  }
  return cx;
}

export function segWidth(text, w) {
  const t = Math.max(2, w * .17), gap = w * .26;
  let cx = 0;
  for (const ch of String(text)) cx += (ch === ':' || ch === '.') ? t + gap * .7 : w + gap;
  return cx - gap;
}
