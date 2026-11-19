// 模拟系统：HUD 与三维状态的唯一数据源
import { STATIONS, ZONES } from './layout.js';
import { mulberry32, clamp, lerp } from './util.js';

const rnd = mulberry32(7357);
const rr = (a, b) => a + (b - a) * rnd();
const fmt2 = (n) => String(n).padStart(2, '0');

export const SIM = {
  simX: 8,            // 仿真时钟 8×
  rate: 1,            // 演示速率 1/2/4
  clock: 14 * 3600 + 36 * 60,
  shiftStart: 8 * 3600, shiftEnd: 20 * 3600,
  count: 936, target: 1488,
  takt: 58,           // s / 台 / 线
  oee: { A: 0.931, P: 0.948, Q: 0.986, v: 0 },
  wip: 184, power: 1.24, powerZones: {},
  agv: { total: 10, online: 9, battery: [], charging: [] },
  history: [], alarms: [], events: [],
  stations: [], byId: {}, zones: {},
  time: 0, _nextFault: 9, _nextIdle: 5, _histT: 0, listeners: {},
  paused: false,

  init() {
    this.stations = STATIONS.map((s) => ({ ...s, state: 'run', until: 0, util: rr(0.78, 0.95), runAcc: 0, totAcc: 0 }));
    this.stations.forEach((s) => (this.byId[s.id] = s));
    ZONES.forEach((z) => (this.zones[z.id] = { util: rr(0.8, 0.92), wip: 0, power: 0 }));
    for (let i = 0; i < this.agv.total; i++) { this.agv.battery.push(rr(0.38, 0.96)); this.agv.charging.push(false); }
    // 96 点产量历史（每 15 min 一个点，单位 台/15min，最后一个是当前）
    let base = 30;
    for (let i = 0; i < 96; i++) {
      const h = (i / 4 + 14.6 + 24 - 24) % 24;
      const onShift = h >= 8 && h < 20;
      base = onShift ? 29 + Math.sin(i * 0.7) * 1.6 + rr(-1.5, 1.5) : 26 + rr(-2, 2);
      this.history.push(Math.round(base));
    }
    this.history[95] = 15; this._unitsSince = 15; this._histT = 450;
    this.pushEvent('info', 'SYS', '数字孪生已同步 · 21 个工位在线');
    this.pushEvent('info', 'AS-01', '换型完成 · 车型 NX-7');
    return this;
  },
  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); },
  emit(evt, a) { (this.listeners[evt] || []).forEach((f) => f(a)); },

  state(id) { const s = this.byId[id]; return s ? s.state : 'run'; },
  running(id) { return this.state(id) === 'run'; },
  // 设备速度系数：run 1，idle 0.25（等料），down 0
  speed(id) { const s = this.state(id); return s === 'run' ? 1 : s === 'idle' ? 0.25 : 0; },

  clockStr(withSec = true) {
    const t = Math.floor(this.clock) % 86400;
    return fmt2(Math.floor(t / 3600)) + ':' + fmt2(Math.floor(t / 60) % 60) + (withSec ? ':' + fmt2(t % 60) : '');
  },

  pushEvent(sev, id, msg) {
    const e = { sev, id, msg, t: this.clockStr(false), k: Math.random() };
    this.events.unshift(e); if (this.events.length > 24) this.events.pop();
    this.emit('event', e);
  },

  setState(id, st, dur) {
    const s = this.byId[id]; if (!s) return;
    const prev = s.state; s.state = st; s.until = st === 'run' ? 0 : this.time + dur;
    if (st === 'down' && prev !== 'down') {
      const msgs = { PR: '伺服过载 · 滑块急停', WB: '焊枪电极磨损 · 光幕触发', AS: '拧紧扭矩超差 · 停线', PT: '雾化器流量偏低', OV: '炉温偏离设定 ±5 ℃', ASRS: '堆垛机定位超时', AGV: '激光避障 · 通道阻塞', OC: '吊具防坠报警', EOL: '四轮定位超差复检', DOCK: '月台调平板故障', XF: '真空吸盘失压', EN: '冷水机组高压报警' };
      const key = Object.keys(msgs).find((k) => id.startsWith(k)) || 'PR';
      this.alarms.unshift({ id, msg: msgs[key], t: this.clockStr(false), sev: 'crit' });
      if (this.alarms.length > 8) this.alarms.pop();
      this.pushEvent('crit', id, msgs[key]);
      this.emit('fault', s);
    } else if (st === 'idle' && prev === 'run') {
      this.pushEvent('warn', id, id.startsWith('AS') ? '等待车身 · 缺料' : '待机 · 等待上游');
    } else if (st === 'run' && prev !== 'run') {
      this.pushEvent(prev === 'down' ? 'ok' : 'info', id, prev === 'down' ? '故障已复位 · 恢复运行' : '恢复运行');
      this.emit('recover', s);
    }
  },

  // 车辆下线（三维的总装线车辆真正走到线尾时调用）
  completeUnit(zone) {
    this.count++;
    this._unitsSince = (this._unitsSince || 0) + 1;
    this.emit('unit', zone);
  },

  injectFault(id) { this.setState(id || this.stations[Math.floor(rnd() * this.stations.length)].id, 'down', rr(6, 15)); },

  update(dtReal) {
    if (this.paused) return;
    const dt = dtReal * this.rate;
    this.time += dt;
    this.clock += dt * this.simX;
    if (this.clock >= this.shiftEnd) { this.clock = this.shiftStart; this.count = 0; this.pushEvent('info', 'SYS', '交接班 · 白班开始'); }

    // 状态恢复
    for (const s of this.stations) {
      if (s.state !== 'run' && this.time >= s.until) this.setState(s.id, 'run');
      s.totAcc += dt; if (s.state === 'run') s.runAcc += dt; else if (s.state === 'idle') s.runAcc += dt * 0.4;
      if (s.totAcc > 60) { s.runAcc *= 0.5; s.totAcc *= 0.5; }
      const u = s.totAcc > 0 ? s.runAcc / s.totAcc : 1;
      s.util = lerp(s.util, clamp(u * 0.94 + 0.03 * Math.sin(this.time * 0.05 + s.beacon[0]), 0.35, 0.99), 1 - Math.exp(-dt * 0.4));
    }
    // 随机故障与待机
    if (this.time > this._nextFault) {
      this._nextFault = this.time + rr(16, 30);
      const cands = this.stations.filter((s) => s.state === 'run');
      if (cands.length) this.setState(cands[Math.floor(rnd() * cands.length)].id, 'down', rr(6, 15));
    }
    if (this.time > this._nextIdle) {
      this._nextIdle = this.time + rr(7, 14);
      const cands = this.stations.filter((s) => s.state === 'run' && !s.id.startsWith('EN'));
      if (cands.length) this.setState(cands[Math.floor(rnd() * cands.length)].id, 'idle', rr(3, 7));
    }

    // 分区利用率 / WIP / 功率
    for (const z of ZONES) {
      const st = this.stations.filter((s) => s.zone === z.id);
      const u = st.length ? st.reduce((a, s) => a + s.util, 0) / st.length : 0.85;
      const zz = this.zones[z.id];
      zz.util = u;
    }
    const downN = this.stations.filter((s) => s.state === 'down').length;
    const idleN = this.stations.filter((s) => s.state === 'idle').length;
    const k = 1 - Math.exp(-dt * 0.5);
    this.oee.A = lerp(this.oee.A, clamp(0.955 - downN * 0.028 - idleN * 0.008, 0.78, 0.97), k);
    this.oee.P = lerp(this.oee.P, clamp(0.952 - idleN * 0.012 + Math.sin(this.time * 0.11) * 0.008, 0.85, 0.97), k);
    this.oee.Q = lerp(this.oee.Q, 0.986 + Math.sin(this.time * 0.07) * 0.003, k);
    this.oee.v = this.oee.A * this.oee.P * this.oee.Q;
    this.wip = Math.round(lerp(this.wip, 184 + Math.sin(this.time * 0.09) * 9 + downN * 6, k));
    this.power = lerp(this.power, 1.25 + Math.sin(this.time * 0.13) * 0.035 + Math.sin(this.time * 0.71) * 0.008 - downN * 0.01, k);
    this.power = clamp(this.power, 1.2, 1.3);
    const share = { Z01: 0.09, Z02: 0.27, Z03: 0.21, Z04: 0.25, Z05: 0.12, Z06: 0.06 };
    for (const id in share) {
      const zz = this.zones[id];
      zz.power = this.power * share[id] * (0.85 + 0.3 * zz.util);
      zz.wip = Math.round(this.wip * { Z01: 0.22, Z02: 0.14, Z03: 0.16, Z04: 0.2, Z05: 0.22, Z06: 0.06 }[id]);
    }

    // AGV 电量
    const agvDown = this.state('AGV-01') === 'down';
    let online = 0;
    for (let i = 0; i < this.agv.total; i++) {
      if (this.agv.charging[i]) { this.agv.battery[i] += dt * 0.012; if (this.agv.battery[i] > 0.95) this.agv.charging[i] = false; }
      else { this.agv.battery[i] -= dt * 0.0016; if (this.agv.battery[i] < 0.22) { this.agv.charging[i] = true; } }
      if (!this.agv.charging[i] && !agvDown) online++;
    }
    this.agv.online = online;

    // 产量历史：每 15 仿真分钟一个点
    this._histT += dt * this.simX;
    if (this._histT >= 900) {
      this._histT -= 900;
      this.history.push(this._unitsSince || 0); this._unitsSince = 0;
      if (this.history.length > 96) this.history.shift();
    } else {
      this.history[this.history.length - 1] = this._unitsSince || 0;
    }
  },
};
