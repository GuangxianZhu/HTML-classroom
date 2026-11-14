// 检修台：三维模型 + 右侧手册 + 下面的控制条。拆页以后每页只有一种阀、一台仿真。
import * as C from './core.js';
import { MODELS } from './data.js';
import { cssColor } from './stage.js';

const $ = (id) => document.getElementById(id);
const f0 = (v) => (Math.abs(v) < 0.05 ? '0' : v.toFixed(0));
const f1 = (v) => v.toFixed(1);
const PA = C.PA;

function makeSim(name) {
  if (name === 'spring') {
    const m = C.simSpring();
    return {
      set(k, v) { if (k === 'set') { m.u.set = v; m.recalcSet(); } else m.u[k] = v; },
      step: (dt) => m.step(dt), vis: () => m.vis(),
      read() {
        const r = m.read();
        return [['出口压力', `${f1(r.P2)} kPa`], ['流量', `${f0(r.Q)} NL/min`], ['阀芯开度', `${(r.lift).toFixed(3)} mm`], ['弹簧压缩', `${r.comp.toFixed(2)} mm`]];
      },
    };
  }
  if (name === 'twostg') {
    const m = C.simTwoStage();
    return {
      set(k, v) { if (k === 'set') { m.u.set = v; m.recalcSet(); } else m.u[k] = v; },
      step: (dt) => m.step(dt), vis: () => m.vis(),
      read() { const r = m.read(); return [['钢瓶', `${(r.P1 / 1000).toFixed(1)} MPa`], ['中间压力', `${f0(r.Pm)} kPa`], ['出口压力', `${f1(r.P2)} kPa`], ['流量', `${f0(r.Q)} NL/min`]]; },
    };
  }
  if (name === 'dome') {
    const m = C.simDome();
    return {
      set(k, v) { m.u[k] = v; }, step: (dt) => m.step(dt), vis: () => m.vis(),
      read() { const r = m.read(); return [['出口压力', `${f1(r.P2)} kPa`], ['出口 − 圆顶', `${f1(r.P2 - r.Pd)} kPa`], ['流量', `${f0(r.Q)} NL/min`], ['阀芯开度', `${r.lift.toFixed(3)} mm`]]; },
    };
  }
  if (name === 'ptfe') {
    const m = C.simPTFE();
    return {
      set(k, v) { if (k === 'open') m.u.KvL = v / 100 * 0.6; else m.u[k] = v; },
      step: (dt) => m.step(dt), vis: () => m.vis(),
      read() { const r = m.read(); return [['药液出口', `${f1(r.P2)} kPa`], ['出口 − 控制气', `${f1(r.P2 - r.Pa)} kPa`], ['药液流量', `${f1(r.Q)} L/min`], ['阀芯开度', `${r.lift.toFixed(2)} mm`]]; },
    };
  }
  if (name === 'bpr') {
    const m = C.simBPR();
    return {
      set(k, v) { m.u[k] = v; }, step: (dt) => m.step(dt), vis: () => m.vis(),
      read() { const r = m.read(); return [['上游压力', `${f1(r.P1)} kPa`], ['上游 − 圆顶', `${f1(r.P1 - r.Pd)} kPa`], ['放走的流量', `${f0(r.Q)} NL/min`], ['膜片抬起', `${r.lift.toFixed(3)} mm`]]; },
    };
  }
  // 三种电气式共用一个"环境"
  const env = { setP: 200, sig: 40, P1g: 700, q: 60, dead: false, power: true, V: 0.08, sensorStuck: null };
  env.qOut = (P2) => (env.dead ? 0 : C.demandQ(env.q, P2, 200));
  if (name === 'epopen') {
    const u = C.makeOpenEP(500);
    u.s.P2g = 200;
    return {
      set(k, v) { if (k === 'demand') env.q = v; else if (k === 'temp') u.s.temp = v; else env[k] = v; },
      step: (dt) => u.step(dt, env),
      vis() { const v = u.vis(); return { ch: v.ch, zones: { hi: env.P1g + PA, lo: u.s.P2g + PA }, flows: { main: u.s.qin, vent: u.s.qv } }; },
      read() { const nom = env.sig / 100 * 500; return [['出口压力', `${f1(u.s.P2g)} kPa`], ['信号对应的名义值', `${f0(nom)} kPa`], ['误差', `${f1(u.s.P2g - nom)} kPa`], ['流量', `${f0(u.s.qo || 0)} NL/min`]]; },
    };
  }
  if (name === 'epclose') {
    const u = C.makeClosedEP(500);
    u.s.P2g = 200; u.s.Pp = 205;
    return {
      set(k, v) { if (k === 'demand') env.q = v; else if (k === 'offset') u.s.sensorOffset = v; else if (k === 'off') env.power = !v; else env[k] = v; },
      step: (dt) => u.step(dt, env),
      vis() {
        const v = u.vis();
        return { ch: v.ch, zones: { hi: env.P1g + PA, lo: u.s.P2g + PA, pilot: u.s.Pp + PA, exh: PA, pex: PA }, flows: { main: u.s.qin, sup: u.s.qs, exs: u.s.qe, vent: u.s.qv } };
      },
      read() { return [['真实出口', `${f1(u.s.P2g)} kPa`], ['传感器读数', `${f1(u.s.sensor)} kPa`], ['先导腔', `${f1(u.s.Pp)} kPa`], ['电磁阀动作', `${u.s.clicks} 次`]]; },
    };
  }
  const u = C.makePiezo(500);
  u.s.P2g = 200; u.s.I = 0.25;
  return {
    set(k, v) { if (k === 'demand') env.q = v; else if (k === 'dead') env.dead = v; else if (k === 'off') env.power = !v; else env[k] = v; },
    step: (dt) => u.step(dt, env),
    vis() { const v = u.vis(); return { ch: v.ch, zones: { hi: env.P1g + PA, lo: u.s.P2g + PA }, flows: { main: u.s.q } }; },
    read() { return [['出口压力', `${f1(u.s.P2g)} kPa`], ['传感器读数', `${f1(u.s.sensor)} kPa`], ['阀开度', `${(u.s.u * 100).toFixed(0)} %`], ['流量', `${f0(u.s.q)} NL/min`]]; },
  };
}

export function setupBench(stage, spec, name) {
  const meta = MODELS[name];
  const sim = makeSim(name);
  let onPinCb = null;

  function pins() {
    return spec.models[name].pins.filter((p) => meta.pins[p.key]).map((p) => ({ key: p.key, name: meta.pins[p.key][0], text: meta.pins[p.key][1], at: p.at }));
  }
  const pinList = pins();
  function legend() {
    $('zonelegend').innerHTML = Object.entries(meta.zones).map(([k, z]) => `<span data-z="${k}"><i></i>${z.n} <b>—</b></span>`).join('');
  }
  // 控制条：滑块 + 勾选框。setControl / setToggle 给分步手册用
  function controls() {
    const el = $('benchctl');
    el.innerHTML = meta.controls.map((c) => `<label>${c.label}<output id="o_${c.id}">${c.v} ${c.unit}</output><input type="range" id="c_${c.id}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.v}"></label>`).join('')
      + (meta.toggles ? `<div class="toggles">${meta.toggles.map((t) => `<label class="chk"><input type="checkbox" id="t_${t.id}">${t.label}</label>`).join('')}</div>` : '');
    for (const c of meta.controls) {
      const inp = $('c_' + c.id), out = $('o_' + c.id);
      const apply = () => { out.textContent = `${inp.value} ${c.unit}`; sim.set(c.id, +inp.value); };
      inp.addEventListener('input', apply);
      apply();
    }
    for (const t of meta.toggles || []) $('t_' + t.id).addEventListener('change', (e) => sim.set(t.id, e.target.checked));
  }
  function setControl(id, v) {
    const inp = $('c_' + id);
    if (!inp) return;
    inp.value = v; inp.dispatchEvent(new Event('input'));
  }
  function setToggle(id, on) {
    const inp = $('t_' + id);
    if (!inp || inp.checked === on) return;
    inp.checked = on; inp.dispatchEvent(new Event('change'));
  }
  function reset() {
    for (const c of meta.controls) setControl(c.id, c.v);
    for (const t of meta.toggles || []) setToggle(t.id, false);
  }
  function focusPin(key) {
    const i = pinList.findIndex((p) => p.key === key);
    if (i < 0) { stage.activePin(-1); return null; }
    stage.activePin(i);
    stage.focus(pinList[i].at);
    return pinList[i];
  }

  legend(); controls();
  stage.setModel(name, true);
  stage.setPins(pinList);
  for (let i = 0; i < 40; i++) sim.step(1 / 60);   // 先跑到稳态再显示

  let readT = 0;
  stage.onTick((dt, visible) => {
    if (!visible) return;
    sim.step(dt);
    const v = sim.vis();
    stage.applyState(name, v, meta);
    stage.stepFlow(name, dt, meta);
    readT -= dt;
    if (readT <= 0) {
      readT = 0.12;
      $('benchread').innerHTML = sim.read().map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
      for (const span of $('zonelegend').querySelectorAll('[data-z]')) {
        const z = span.dataset.z, P = v.zones?.[z];
        if (P == null) continue;
        span.querySelector('i').style.background = cssColor(P, meta.pmax, meta.zones[z].liquid);
        span.querySelector('b').textContent = P - PA > 1000 ? `${((P - PA) / 1000).toFixed(2)} MPa` : `${(P - PA).toFixed(0)} kPa`;
      }
    }
  });
  $('tgGas').addEventListener('change', (e) => stage.setGas(e.target.checked));
  $('tgFlow').addEventListener('change', (e) => stage.setFlow(e.target.checked));
  $('btnFrame').addEventListener('click', () => { stage.activePin(-1); stage.reframe(); });
  return {
    meta, sim, pins: pinList, setControl, setToggle, reset, focusPin,
    onPin(p, i) { onPinCb && onPinCb(p, i); },
    set onPinClick(fn) { onPinCb = fn; },
  };
}
