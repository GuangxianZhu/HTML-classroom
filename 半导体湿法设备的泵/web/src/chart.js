// 小型 Canvas 绘图工具（和同仓库其他页面同一套）。线、轴、标注都走同一套比例尺。
export const C = {
  bg: '#0b1628', grid: '#1d2d45', axis: '#42566f', text: '#93a4bb', fg: '#e8eef7', accent: '#4cc9f0',
  cf: '#4cc9f0', pd: '#ff9d3c', ok: '#4fd18b', warn: '#ff7066', mid: '#ffd166', vio: '#c78bff', mute: '#5d7089',
};

export class Plot {
  constructor(canvas, { l = 40, r = 10, t = 10, b = 22 } = {}) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.pad = { l, r, t, b };
    this.size();
    this.hover = null;
    const wrap = canvas.parentElement;
    if (wrap && wrap.classList.contains('plotwrap')) {
      const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true;
      const hair = document.createElement('div'); hair.className = 'hair'; hair.hidden = true;
      wrap.append(hair, tip);
      const hide = () => { tip.hidden = true; hair.hidden = true; };
      const move = (e) => {
        const H = this.hover;
        if (!H || !this.xr) return hide();
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left, { l, r } = this.pad;
        if (px < l || px > this.w - r) return hide();
        const xv = this.xr[0] + (px - l) / (this.w - l - r) * (this.xr[1] - this.xr[0]);
        const xs = H.x;
        let lo = 0, hi = xs.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] < xv) lo = m; else hi = m; }
        const i = Math.abs(xs[lo] - xv) < Math.abs(xs[hi] - xv) ? lo : hi;
        tip.innerHTML = `<b>${H.xf(xs[i])}</b>` + H.series.map((s) => `<span><i style="background:${s.c}"></i>${s.n} ${s.f(s.y[i])}</span>`).join('');
        tip.hidden = false; hair.hidden = false;
        const X = this.X(xs[i]);
        hair.style.left = `${X}px`;
        tip.style.left = `${X > this.w * .6 ? X - tip.offsetWidth - 8 : X + 8}px`;
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerdown', move);
      canvas.addEventListener('pointerleave', hide);
    }
  }

  size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.c.clientWidth || 300, h = this.c.clientHeight || 150;
    if (this.c.width !== Math.round(w * dpr) || this.c.height !== Math.round(h * dpr)) {
      this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
    }
    this.w = w; this.h = h; this.dpr = dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear() { this.size(); const g = this.g; g.clearRect(0, 0, this.w, this.h); g.fillStyle = C.bg; g.fillRect(0, 0, this.w, this.h); return this; }

  scale(x0, x1, y0, y1) { this.xr = [x0, x1]; this.yr = [y0, y1]; return this; }

  X(x) { const { l, r } = this.pad; return l + (x - this.xr[0]) / (this.xr[1] - this.xr[0]) * (this.w - l - r); }

  Y(y) { const { t, b } = this.pad; return this.h - b - (y - this.yr[0]) / (this.yr[1] - this.yr[0]) * (this.h - t - b); }

  axes({ xt = [], yt = [], xf = (v) => v, yf = (v) => v, xl = '', yl = '', zero = false } = {}) {
    const g = this.g, { l, r, t, b } = this.pad;
    g.font = '11px "IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace';
    g.lineWidth = 1;
    g.fillStyle = C.text; g.textAlign = 'center'; g.textBaseline = 'top';
    for (const v of xt) {
      const x = this.X(v);
      g.strokeStyle = C.grid; g.beginPath(); g.moveTo(x, t); g.lineTo(x, this.h - b); g.stroke();
      const s = String(xf(v)), tw = g.measureText(s).width;
      g.fillText(s, Math.max(tw / 2 + 1, Math.min(x, this.w - tw / 2 - 1)), this.h - b + 4);
    }
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const v of yt) {
      const y = this.Y(v);
      g.strokeStyle = C.grid; g.beginPath(); g.moveTo(l, y); g.lineTo(this.w - r, y); g.stroke();
      g.fillText(yf(v), l - 5, y);
    }
    g.strokeStyle = C.axis;
    g.beginPath(); g.moveTo(l, t); g.lineTo(l, this.h - b); g.lineTo(this.w - r, this.h - b); g.stroke();
    if (zero) { const y = this.Y(0); g.beginPath(); g.moveTo(l, y); g.lineTo(this.w - r, y); g.stroke(); }
    g.fillStyle = C.text; g.textAlign = 'left'; g.textBaseline = 'top';
    if (yl) g.fillText(yl, l + 5, t + 1);
    g.textAlign = 'right'; g.textBaseline = 'bottom';
    if (xl) g.fillText(xl, this.w - r - 2, this.h - b - 2);
    return this;
  }

  clip(fn) {
    const g = this.g, { l, r, t, b } = this.pad;
    g.save(); g.beginPath(); g.rect(l, t, this.w - l - r, this.h - t - b); g.clip(); fn(g); g.restore();
    return this;
  }

  line(xs, ys, color, w = 1.6, dash = null) {
    return this.clip((g) => {
      g.strokeStyle = color; g.lineWidth = w; g.lineJoin = 'round'; g.setLineDash(dash || []);
      g.beginPath();
      const n = ys.length, stepX = xs.length === n;
      for (let i = 0; i < n; i++) {
        const x = this.X(stepX ? xs[i] : xs(i)), y = this.Y(ys[i]);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke(); g.setLineDash([]);
    });
  }

  dot(x, y, color, r = 4.5, ring = true) {
    return this.clip((g) => {
      const X = this.X(x), Y = this.Y(y);
      g.fillStyle = color; g.beginPath(); g.arc(X, Y, r, 0, 7); g.fill();
      if (ring) { g.strokeStyle = C.fg; g.lineWidth = 1.2; g.stroke(); }
    });
  }

  vline(x, color, dash = [3, 3], w = 1) {
    const { t, b } = this.pad, g = this.g;
    g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash);
    g.beginPath(); g.moveTo(this.X(x), t); g.lineTo(this.X(x), this.h - b); g.stroke(); g.setLineDash([]);
    return this;
  }

  hline(y, color, dash = [3, 3], w = 1) {
    const { l, r } = this.pad, g = this.g;
    g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash);
    g.beginPath(); g.moveTo(l, this.Y(y)); g.lineTo(this.w - r, this.Y(y)); g.stroke(); g.setLineDash([]);
    return this;
  }

  /** 贴着数据点写字：自动避开右边界，文字带底色保证压在曲线上也读得清 */
  label(x, y, text, color = C.fg, { dx = 6, dy = -6, align = 'left', bg = true } = {}) {
    const g = this.g;
    g.font = '11.5px "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
    const w = g.measureText(text).width;
    let X = this.X(x) + dx, Y = this.Y(y) + dy;
    if (align === 'right') X -= w + 2 * dx;
    X = Math.max(this.pad.l + 2, Math.min(this.w - this.pad.r - w - 2, X));
    Y = Math.max(this.pad.t + 8, Math.min(this.h - this.pad.b - 8, Y));
    g.textBaseline = 'middle'; g.textAlign = 'left';
    if (bg) { g.fillStyle = 'rgba(11,22,40,.82)'; g.fillRect(X - 2, Y - 8, w + 4, 16); }
    g.fillStyle = color; g.fillText(text, X, Y);
    return this;
  }
}

export const niceTicks = (a, b, n = 5) => {
  const span = b - a, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
};
