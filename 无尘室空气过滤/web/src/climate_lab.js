// 第五节：温度和湿度分开管。焓湿图上画 MAU 和 DCC 各做了什么。
import { css, fit, bind, set, tooltip, onTheme } from './ui.js';

const PATM = 101325;
export const ps = (T) => 610.94 * Math.exp(17.625 * T / (T + 243.04));     // Magnus，Pa
export const wOf = (T, rh) => { const p = rh / 100 * ps(T); return 622 * p / (PATM - p); };     // g/kg
export const dew = (T, rh) => { const g = Math.log(rh / 100 * ps(T) / 610.94); return 243.04 * g / (17.625 - g); };
export const hOf = (T, w) => 1.006 * T + w / 1000 * (2501 + 1.86 * T);     // kJ/kg
const tOfW = (w) => { const p = w / 622 * PATM / (1 + w / 622); const g = Math.log(p / 610.94); return 243.04 * g / (17.625 - g); };

export function setupClimate() {
  const s = { To: 33, RHo: 65, Tr: 23, RHr: 45, Tw: 13 };
  const cv = document.getElementById('cvClimate');
  const tip = tooltip();
  function state() {
    const Wr = wOf(s.Tr, s.RHr);
    const Td = dew(s.Tr, s.RHr);
    const Wo = wOf(s.To, s.RHo);
    // MAU 把新风露点压到略低于室内，用来吸收人和工艺散的一点湿
    const Wm = Wr - .15;
    const Tm = 16;                  // MAU 送风温度，本页取值
    const Tc = tOfW(Wm);
    const coilSurface = s.Tw + 1.5; // 干盘管翅片表面比水温高一点，这里取 1.5 K
    const wet = coilSurface < Td;
    const Ts = s.Tr - .6, Tret = s.Tr + 1.4;
    const needH = Wo > Wm ? hOf(s.To, Wo) - hOf(Tc, Wm) : 0;
    const latent = Wo > Wm ? (Wo - Wm) / 1000 * 2501 : 0;
    return { Wr, Td, Wo, Wm, Tm, Tc, coilSurface, wet, Ts, Tret, needH, latent };
  }
  function draw() {
    const st = state();
    const { c, w, h } = fit(cv);
    c.clearRect(0, 0, w, h);
    const L = 46, R = 92, T = 14, B = 36;
    const X0 = -5, X1 = 40, Y0 = 0, Y1 = 26;
    const X = (v) => L + (v - X0) / (X1 - X0) * (w - L - R);
    const Y = (v) => h - B - (v - Y0) / (Y1 - Y0) * (h - T - B);
    const mute = css('--ink3'), line = css('--line'), ink = css('--ink'), ink2 = css('--ink2');
    c.font = '500 11px ' + css('--mono'); c.textBaseline = 'middle';
    for (let t = 0; t <= 40; t += 10) { c.strokeStyle = line; c.globalAlpha = .6; c.lineWidth = 1; c.beginPath(); c.moveTo(X(t), T); c.lineTo(X(t), h - B); c.stroke(); c.globalAlpha = 1; c.fillStyle = mute; c.textAlign = 'center'; c.fillText(`${t}`, X(t), h - B + 14); }
    for (let v = 0; v <= 25; v += 5) { c.strokeStyle = line; c.globalAlpha = .6; c.beginPath(); c.moveTo(L, Y(v)); c.lineTo(w - R, Y(v)); c.stroke(); c.globalAlpha = 1; c.fillStyle = mute; c.textAlign = 'right'; c.fillText(`${v}`, L - 6, Y(v)); }
    c.textAlign = 'center'; c.fillText('干球温度 °C', (L + w - R) / 2, h - 8);
    c.save(); c.translate(12, (T + h - B) / 2); c.rotate(-Math.PI / 2); c.fillText('含湿量 g/kg', 0, 0); c.restore();
    c.save(); c.beginPath(); c.rect(L, T, w - L - R, h - T - B); c.clip();
    for (const rh of [100, 60, 30]) {
      c.strokeStyle = rh === 100 ? ink2 : line; c.lineWidth = rh === 100 ? 2 : 1;
      c.beginPath();
      for (let t = X0; t <= X1; t += .5) { const y = Y(wOf(t, rh)); if (t === X0) c.moveTo(X(t), y); else c.lineTo(X(t), y); }
      c.stroke();
    }
    c.restore();
    // RH 线的直接标注（放在右侧边界外）
    c.font = '500 11px ' + css('--mono'); c.textAlign = 'left'; c.fillStyle = mute;
    c.fillText('RH 30%', w - R + 6, Y(wOf(X1, 30)));
    { let t = X0; while (wOf(t, 60) < Y1 - .6 && t < X1) t += .2; c.fillText('RH 60%', X(t) + 6, Y(wOf(t, 60))); }
    c.fillText('饱和线', X(tOfW(Y1)) + 8, T + 8);
    // MAU 路径：沿等湿降到饱和 → 沿饱和线除湿 → 再热
    const cold = css('--s2'), warm = css('--s1'), mau = css('--s3');
    const arrow = (pts, col, wid = 2) => {
      c.strokeStyle = col; c.lineWidth = wid; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); pts.forEach(([a, b], i) => (i ? c.lineTo(X(a), Y(b)) : c.moveTo(X(a), Y(b)))); c.stroke();
      const [a0, b0] = pts[pts.length - 2], [a1, b1] = pts[pts.length - 1];
      const ang = Math.atan2(Y(b1) - Y(b0), X(a1) - X(a0));
      c.fillStyle = col; c.beginPath(); c.moveTo(X(a1), Y(b1));
      c.lineTo(X(a1) - 9 * Math.cos(ang - .4), Y(b1) - 9 * Math.sin(ang - .4));
      c.lineTo(X(a1) - 9 * Math.cos(ang + .4), Y(b1) - 9 * Math.sin(ang + .4)); c.closePath(); c.fill();
    };
    if (st.Wo > st.Wm) {
      const Tsat = tOfW(st.Wo);
      const pts = [[s.To, st.Wo], [Tsat, st.Wo]];
      for (let t = Tsat; t > st.Tc; t -= .7) pts.push([t, wOf(t, 100)]);
      pts.push([st.Tc, st.Wm]); pts.push([st.Tm, st.Wm]);
      arrow(pts, mau);
    } else {
      arrow([[s.To, st.Wo], [s.To, st.Wm], [st.Tm, st.Wm]], mau);
    }
    // DCC / 房间循环：只在水平线上走
    arrow([[st.Tret, st.Wr], [st.Ts, st.Wr]], cold, 3);
    arrow([[st.Ts, st.Wr + .55], [st.Tret, st.Wr + .55]], warm, 3);
    const dot = (a, b, t, dx = 8, dy = -10, al = 'left') => {
      c.fillStyle = css('--panel'); c.beginPath(); c.arc(X(a), Y(b), 6, 0, 7); c.fill();
      c.fillStyle = ink; c.beginPath(); c.arc(X(a), Y(b), 4, 0, 7); c.fill();
      c.font = '700 12px ' + css('--sans'); c.fillStyle = ink2; c.textAlign = al; c.fillText(t, X(a) + dx, Y(b) + dy);
    };
    dot(s.To, st.Wo, '室外');
    dot(st.Tm, st.Wm, 'MAU 送风', 9, -13, 'left');
    c.font = '700 12px ' + css('--sans'); c.fillStyle = ink2; c.textAlign = 'left';
    c.fillText('循环风：干盘管降温 ← → 设备加热', X(st.Tret) + 8, Y(st.Wr) - 22);
    // 露点竖线 + 盘管表面
    c.setLineDash([4, 4]); c.strokeStyle = st.wet ? css('--no') : mute; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(X(st.coilSurface), Y(st.Wr) + 34); c.lineTo(X(st.coilSurface), Y(st.Wr) - 10); c.stroke(); c.setLineDash([]);
    c.fillStyle = st.wet ? css('--no') : mute; c.font = '500 11px ' + css('--mono'); c.textAlign = 'center';
    c.fillText(`盘管表面 ${st.coilSurface.toFixed(1)}°C`, X(st.coilSurface), Y(st.Wr) + 46);
    set('cDew', `${st.Td.toFixed(1)} °C`);
    set('cW', `${st.Wr.toFixed(1)} g/kg`);
    set('cMau', st.Wo > st.Wm ? `${st.needH.toFixed(0)} kJ/kg` : '不用除湿');
    set('cLat', st.Wo > st.Wm ? `${(st.latent / st.needH * 100).toFixed(0)} %` : '—');
    set('cCoil', st.wet ? `<span class="bad">已结露</span>` : `<span class="good">干工况</span>`);
    const need = st.Wo < st.Wm;
    set('cNote', st.wet
      ? `水温太低了：盘管表面 ${st.coilSurface.toFixed(1)} °C 低于室内露点 ${st.Td.toFixed(1)} °C，循环风里的水汽会在翅片上凝结。湿表面会抢走 MAU 的控湿权，也让盘管变成微生物和离子污染的温床。`
      : need
        ? `冬季情形：新风比室内还干，MAU 要加湿而不是除湿。循环风这边不用变，这就是把温度和湿度分开的好处。`
        : `盘管表面比露点高 ${(st.coilSurface - st.Td).toFixed(1)} K，循环风只降温不脱水。全部除湿都由 MAU 完成，于是湿度只需要盯 MAU 一处。`);
    set('lab_cTo', `${s.To} °C`); set('lab_cRHo', `${s.RHo} %`); set('lab_cTw', `${s.Tw.toFixed(1)} °C`); set('lab_cRHr', `${s.RHr} %`);
  }
  bind('sl_cTo', (v) => { s.To = v; draw(); });
  bind('sl_cRHo', (v) => { s.RHo = v; draw(); });
  bind('sl_cTw', (v) => { s.Tw = v; draw(); });
  bind('sl_cRHr', (v) => { s.RHr = v; draw(); });
  cv.addEventListener('pointerleave', () => tip.hide());
  draw(); addEventListener('resize', draw); onTheme(draw);
}
