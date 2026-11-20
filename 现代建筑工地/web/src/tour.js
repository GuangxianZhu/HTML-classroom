// 自动导览：十几站关键时刻，每站 = 一段工期 + 一段镜头运动 + 一句解说；站与站之间黑场切换，放完循环。
// 镜头、目标点都用 Blender 坐标（x 东、y 北、z 上），交给 stage.setTourCam。
// 机械的时间也由导览给（stage.lifeT）：需要卡动作的站（塔吊落钩、幕墙下放、无人机到位）写 t0，其余用导览自己的连续时钟。
import { perimPt } from './works.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const mix = (A, B, k) => [lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k)];
const rad = (d) => (d * Math.PI) / 180;
const B3 = (v) => [v.x, -v.z, v.y];                       // three → Blender
const orbit = (c, r, deg, z) => [c[0] + r * Math.cos(rad(deg)), c[1] + r * Math.sin(rad(deg)), z];

// 全景绕拍：距离跟着楼高走（和“全景”机位同一条规则）
function wide(c, a0, a1) {
  const h = Math.max(c.top, 20);
  const d = clamp(h * 2.3, 220, 760);
  const t = [6, 2, h * 0.58];
  const a = rad(lerp(a0, a1, c.u));
  return { p: [t[0] + d * 0.95 * Math.cos(a), t[1] + d * 0.95 * Math.sin(a), t[2] + d * 0.3], t };
}

export function makeStations(sch, P, spec) {
  const ph = Object.fromEntries(sch.ph.map((p) => [p.key, p]));
  const S = P.schedule;
  const c27 = sch.cStart[27];
  const c30 = sch.cStart[30];                       // 第 30 层核心筒循环开始的那天：细节都在这几天看
  const jack0 = c30 + S.cycle * S.split[0], jack1 = c30 + S.cycle * S.split[1];
  const F = sch.N;
  return [
    {
      key: 'open', title: '从挖坑到竣工', dur: 9, d0: sch.end, d1: sch.end,
      text: `一栋 ${Math.round(spec.tower.top)} 米、${F} 层的超高层，从进场到竣工 ${Math.round(sch.end)} 天。跟着镜头从头看一遍。`,
      cam: (c) => ({ p: orbit([0, 0], 540, lerp(-62, -34, c.u), 190), t: [0, 0, 118] }),
    },
    {
      key: 'dwall', title: '围挡和地下连续墙', dur: 12, d0: 6, d1: ph.dwall.t1,
      text: '先围起来。成槽机沿基坑一圈抓出深槽，下钢筋笼、灌混凝土，连成一圈地下连续墙，挡土也挡水。',
      cam: (c) => ({ p: mix([122, -96, 62], [98, -116, 46], c.u), t: [10, 4, -4] }),
    },
    {
      key: 'dig', title: '挖土和内支撑', dur: 14, d0: ph.excavate.t0, d1: ph.excavate.t1,
      text: '一层层往下挖二十多米。每挖一段就架一道内支撑顶住四面的墙，土由渣土车拉走。',
      cam: (c) => ({ p: orbit([10, 6], 142, lerp(-68, -34, c.u), 72), t: [10, 6, -12] }),
    },
    {
      key: 'raft', title: '筏板', dur: 12, d0: ph.raft.t0 + 0.3, d1: ph.raft.t1 - 0.2,
      text: '坑底先绑钢筋，再浇筏板，塔楼下面有 4 米厚。泵车从西往东连续浇，整栋楼的重量都落在它上面。',
      cam: (c) => ({ p: mix([-48, -84, 36], [-8, -90, 32], c.u), t: [lerp(-6, 22, c.u), 4, -21] }),
    },
    {
      key: 'basement', title: '地下室', dur: 14, d0: ph.basement.t0, d1: ph.basement.t1,
      text: `地下 4 层自下而上做：墙柱立起来，搭满堂支模架、铺模板、绑钢筋、浇顶板，一层 ${S.basement_level} 天。`,
      cam: (c) => ({ p: mix([104, 98, 54], [116, 66, 46], c.u), t: [10, 6, -9] }),
    },
    {
      key: 'low', title: '核心筒起步，装造楼机', dur: 12, d0: ph.low.t0, d1: ph.install.t1,
      text: `核心筒最先冒出地面。前 ${S.low_floors} 层用普通模板，随后 ${S.install} 天把造楼机装在墙顶上。`,
      cam: (c) => ({ p: mix([88, -96, 38], [70, -108, 54], c.u), t: [0, 0, lerp(14, 22, c.u)] }),
    },
    {
      key: 'grow1', title: '一路长高', dur: 16, d0: ph.cycle.t0, d1: c30,
      text: `造楼机开动，核心筒 ${S.cycle} 天长一层。钢柱钢梁、楼板、幕墙隔几层跟在后面。`,
      cam: (c) => wide(c, -52, -12),
    },
    {
      key: 'zlj', title: '造楼机的一个循环', dur: 16, d0: c30, d1: c30 + S.cycle, cut: true,
      text: '剖开看造楼机：平台罩住三层半。绑钢筋、拆模顶升、合模浇筑、养护，四步一个循环。',
      cam: (c) => {
        const pl = c.st.plat, z = (pl.show ? pl.rootZ + pl.lift : c.Z(30)) + 2;
        const a = rad(lerp(-56, -44, c.u));
        return { p: [72 * Math.cos(a), 72 * Math.sin(a), z + 24], t: [0, 0, z] };
      },
    },
    {
      key: 'jack', title: '支点油缸顶升', dur: 13, d0: jack0, d1: jack1, mesh: false,
      text: `顶升靠 ${spec.zaoloji.supports.length} 个支点。油缸一次伸 ${P.platform.cyl.stroke} 米，${S.strokes} 个行程把整座平台抬高一层。`,
      cam: (c) => {
        const pl = c.st.plat, z = (pl.show ? pl.rootZ + pl.lift : c.Z(30)) - 10;
        const k = lerp(1.45, 1.2, c.u);
        return { p: [-4 + 6.5 * k, -12.6 - 10.5 * k, z + 1.2 * k], t: [-4, -12.6, z] };
      },
    },
    {
      key: 'flow', title: '竖向流水', dur: 16, d0: c30 + 2.5, d1: c30 + 2.6,
      text: '从上往下：造楼机、钢结构、楼承板、楼板、幕墙。每道工序隔开几层，同时干、互不挡路。',
      cam: (c) => {
        const z0 = c.Z(30) + 22, z1 = c.Z(c.st.counts.curtain + 1) - 2;
        const z = lerp(z0, z1, c.u * c.u * (3 - 2 * c.u));
        return { p: [74, -84, z + 6], t: [0, 0, z - 3] };
      },
    },
    {
      key: 'crane', title: '塔吊吊钢梁', dur: 18, d0: c30 + 2.6, d1: c30 + 2.6, t0: 29, smooth: 3,
      text: '两台塔吊站在核心筒里，跟着造楼机一起升。钢柱钢梁一件件吊到位，装满一层再装下一层。',
      cam: (c) => {
        const cr = c.stage.life && c.stage.life.cranes[0];
        const job = cr && cr.job;
        if (!job || !job.to || !cr.top.visible) return { p: [62, -52, c.Z(25) + 20], t: [10, 5, c.Z(25)] };
        const to = job.to, L = B3(cr.ld.position);
        let dx = to.x, dy = to.y;
        const n = Math.hypot(dx, dy);
        if (n < 4) { dx = 0.7; dy = 0.7; } else { dx /= n; dy /= n; }
        // 机位定在落点外侧，目标跟着吊着的构件：先仰着看它从造楼机上面转过来，再跟着落到楼面；松钩以后看落点
        const loaded = cr.beam.visible || cr.colm.visible || cr.bundle.visible;
        const t = loaded ? [lerp(to.x, L[0], 0.85), lerp(to.y, L[1], 0.85), Math.max(to.z, L[2] - 1)] : [to.x, to.y, to.z];
        return { p: [to.x + dx * 27 - dy * 12, to.y + dy * 27 + dx * 12, to.z + 7], t };
      },
    },
    {
      key: 'slab', title: '楼承板、钢筋、浇筑', dur: 14, d0: c27 + 2.6, d1: c27 + 2.85, smooth: 3,   // 早三层：避开加强层的大桁架
      text: '钢梁上先铺压型钢板当底模，再绑钢筋、浇混凝土。颜色深的那段是刚浇的。',
      cam: (c) => {
        const W = c.stage.works, f = c.st.counts.slab + 1, z = c.Z(f + 1);
        const s = W.U.slab.uFront.value, E = W.E.slab;
        const q = perimPt(s > 0.5 ? s : 30, E);
        return {
          p: [q.x + q.nx * 10 + q.tx * 9, q.y + q.ny * 10 + q.ty * 9, z + 3.1],
          t: [q.x - q.nx * 7 - q.tx * 3, q.y - q.ny * 7 - q.ty * 3, z + 0.4],
        };
      },
    },
    {
      key: 'curtain', title: '幕墙和临边防护', dur: 16, d0: c30 + 2.45, d1: c30 + 2.45, t0: 0, smooth: 3,   // 这一天装到一条边的中段，镜头不用拐角
      text: '幕墙单元板在工厂拼好，由上两层的单轨吊一块块放下来。还没装到的楼边有栏杆和安全网。',
      cam: (c) => {
        const W = c.stage.works, cf = W.curtainFront;
        const f = cf ? cf.f : c.st.counts.curtain + 1, z = c.Z(f);
        const q = perimPt(((cf ? Math.max(W.cw.j, cf.n) : 10) + 0.5) * W.mw, W.E.curtain);
        const k = lerp(1.1, 0.9, c.u);
        return {
          p: [q.x + (q.nx * 23 - q.tx * 13) * k, q.y + (q.ny * 23 - q.ty * 13) * k, z + 8],
          t: [q.x, q.y, z + 6],
        };
      },
    },
    {
      key: 'drone', title: '巡检无人机', dur: 14, d0: c30 + 2.9, d1: c30 + 2.9, t0: 3,
      text: '无人机定时从机场起飞，绕楼一圈拍外框和临边防护，再回舱充电。',
      cam: (c) => {
        const sm = c.stage.life && c.stage.life.smart;
        if (!sm) return wide(c, -40, -30);
        const D = B3(sm.drone.position);
        const n = Math.hypot(D[0], D[1]) || 1;
        return { p: [D[0] + (D[0] / n) * 5.5, D[1] + (D[1] / n) * 5.5, D[2] + 1.6], t: [0, 0, D[2] - 22] };
      },
    },
    {
      key: 'robots', title: '楼上的机器人', dur: 13, d0: c30 + S.cycle + 1.9, d1: c30 + S.cycle + 1.9,
      text: '焊接机器人绕着钢柱接头焊，绑扎机器人在楼板钢筋网上逐点绑扎。',
      cam: (c) => {
        const sm = c.stage.life && c.stage.life.smart;
        if (!sm) return wide(c, -40, -30);
        const weld = sm.welds[0].cart, bot = sm.rebar[0].o;
        if (c.u < 0.5 && weld.visible) {
          const col = sm.weldCols[0], z = B3(weld.position)[2];
          const k = lerp(1.15, 0.95, c.u * 2);
          return { p: [col[0] + 2.4 * k, col[1] + 3.6 * k, z + 1.0], t: [col[0], col[1], z + 0.15] };
        }
        if (bot.visible) {
          const R = B3(bot.position);
          return { p: [R[0] + 3.8, R[1] + 1.2, R[2] + 2.6], t: [R[0], R[1], R[2] + 0.5] };
        }
        return wide(c, -40, -30);
      },
    },
    {
      key: 'ground', title: '智慧工地', dur: 9, d0: c30 + S.cycle + 1.9, d1: c30 + S.cycle + 2.1,
      text: '门口刷脸进场，大屏汇总进度、扬尘和设备状态；塔吊司机在地面的操控室里开塔吊。',
      cam: (c) => ({ p: mix([48, -98, 16], [41, -92, 11], c.u), t: [27, -63, 3.2] }),
    },
    {
      key: 'grow2', title: '到封顶', dur: 13, d0: c30 + S.cycle + 2.1, d1: ph.cycle.t1,
      text: `一路到 ${F} 层。第 ${P.tower.outrigger.join('、')} 层是加强层，这两层要多花几天。`,
      cam: (c) => wide(c, -12, 30),
    },
    {
      key: 'top', title: '拆造楼机，幕墙收口', dur: 12, d0: ph.dismantle.t0, d1: ph.curtain.t1,
      text: '核心筒封顶，造楼机拆掉，塔吊随后撤场。幕墙继续往上收口。',
      cam: (c) => ({ p: orbit([0, 0], 128, lerp(-72, -34, c.u), 268), t: [0, 0, 226] }),
    },
    {
      key: 'done', title: '竣工', dur: 11, d0: ph.finish.t0, d1: sch.end,
      text: `最后是机电和装修，这页没有演示。第 ${Math.round(sch.end)} 天竣工。想细看，退出导览自己拖时间轴。`,
      cam: (c) => ({ p: [330, -385, lerp(12, 150, c.u)], t: [0, 0, lerp(122, 128, c.u)] }),
    },
  ];
}

export class Tour {
  // api：{ setDay(d), setOpt(key, v), getOpt(key) }
  constructor(stage, sch, P, api) {
    this.stage = stage;
    this.sch = sch;
    this.api = api;
    this.list = makeStations(sch, P, stage.spec);
    this.total = this.list.reduce((a, s) => a + s.dur, 0);
    this.on = false;
    this.paused = false;
    this.frozen = false;
    this.clean = false;
    this.say = false;
    this.clock = 0;
    this.i = 0;
    this.el = 0;
    const $ = (s) => document.querySelector(s);
    this.ui = { bar: $('#tourBar'), fade: $('#tourFade'), idx: $('#tourIdx'), title: $('#tourTitle'), text: $('#tourText'), prog: $('#tourProg i'),
      pause: $('#tourPause'), sayBtn: $('#tourSay'), cleanBtn: $('#tourClean'), btn: $('#tourBtn') };
    $('#tourBtn').onclick = () => (this.on ? this.stop() : this.start());
    $('#tourPrev').onclick = () => this.prev();
    $('#tourNext').onclick = () => this.next();
    $('#tourPause').onclick = () => this.toggle();
    $('#tourExit').onclick = () => this.stop();
    $('#tourClean').onclick = () => this.setClean(!this.clean);
    $('#tourSay').onclick = () => this.setSay(!this.say);
    if (!('speechSynthesis' in window)) $('#tourSay').hidden = true;
    window.addEventListener('resize', () => this._shift());
  }

  start(i = 0) {
    if (this.on) return;
    this.on = true;
    this.paused = this.frozen = false;
    this.saved = { cut: this.api.getOpt('cut'), mesh: this.api.getOpt('mesh'), life: this.api.getOpt('life') };
    this.api.setOpt('life', true);
    document.body.classList.add('touring');
    this.ui.bar.hidden = false;
    this.ui.btn.textContent = '■ 退出导览';
    this.last = performance.now();
    this._enter(i);
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    this.cutting = false;
    this._hush();
    this.setClean(false);
    document.body.classList.remove('touring');
    this.ui.bar.hidden = true;
    this.ui.fade.classList.remove('on');
    this.ui.btn.textContent = '▶ 自动导览';
    this.stage.setTourCam(null);
    this.stage.lifeT = null;
    for (const k of ['cut', 'mesh', 'life']) this.api.setOpt(k, this.saved[k]);
    if (this.api.onStop) this.api.onStop();
  }

  toggle() {
    if (!this.on) return;
    this.paused = !this.paused;
    this.ui.pause.textContent = this.paused ? '▶' : '❚❚';
    this.ui.pause.setAttribute('aria-label', this.paused ? '继续' : '暂停');
    // 暂停：画面定住，镜头还给鼠标，可以自己转着看；继续时镜头回到导览的位置
    if (this.paused) { this.stage.setTourCam(null); this._hush(true); } else { this.snap = true; this._resume(); }
  }

  next() { if (this.on) this._cut(this.i + 1 < this.list.length ? this.i + 1 : 1); }   // 放完从第 2 站循环（开场只放一次）
  prev() { if (this.on) this._cut(Math.max(0, this.i - 1)); }

  setClean(v) {
    this.clean = v;
    document.body.classList.toggle('clean', v);
    this.ui.cleanBtn.setAttribute('aria-pressed', String(v));
    this._shift();
  }

  setSay(v) {
    this.say = v;
    this.ui.sayBtn.setAttribute('aria-pressed', String(v));
    if (v && this.on) this._speak(); else this._hush();
  }

  // 调试 / 截图：停在第 i 站的 u 处
  seek(i, u = 0) {
    if (!this.on) this.start(i); else this._enter(i);
    this.el = clamp(u, 0, 1) * this.s.dur;
    this.frozen = true;
  }

  _cut(i) {
    if (this.cutting) return;
    this.cutting = true;
    this.ui.fade.classList.add('on');
    setTimeout(() => {
      if (!this.on) return;
      this._enter(i);
      setTimeout(() => { this.ui.fade.classList.remove('on'); this.cutting = false; }, 140);
    }, 330);
  }

  _enter(i) {
    this.i = i;
    this.s = this.list[i];
    this.el = 0;
    this.mem = {};
    this.topS = null;
    this.camS = null;
    this.day = null;
    this.before = this.list.slice(0, i).reduce((a, s) => a + s.dur, 0);
    if (this.paused) { this.paused = false; this.ui.pause.textContent = '❚❚'; }
    this.api.setOpt('cut', !!this.s.cut);
    this.api.setOpt('mesh', this.s.mesh !== false);
    this.ui.idx.textContent = `${i + 1} / ${this.list.length}`;
    this.ui.title.textContent = this.s.title;
    this.ui.text.textContent = this.s.text;
    this._shift();
    if (this.say) this._speak();
  }

  // 字幕条占了多高，告诉 stage 把画面往上挪一半
  _shift() { this.stage.tourShift = this.on ? this.ui.bar.offsetHeight + 12 : 0; }

  _speak() {
    try {
      const ss = window.speechSynthesis;
      ss.cancel();
      const u = new SpeechSynthesisUtterance(`${this.s.title}。${this.s.text}`);
      u.lang = 'zh-CN';
      u.rate = 1.05;
      ss.speak(u);
    } catch (e) { /* 没有语音就算了 */ }
  }
  _hush(pauseOnly = false) { try { if (pauseOnly) window.speechSynthesis.pause(); else window.speechSynthesis.cancel(); } catch (e) { /* */ } }
  _resume() { try { window.speechSynthesis.resume(); } catch (e) { /* */ } }
  _speaking() { try { return this.say && window.speechSynthesis.speaking; } catch (e) { return false; } }

  // 每帧：在 stage.frame 之前调
  tick(now) {
    if (!this.on) return;
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const s = this.s, run = !this.paused && !this.frozen;
    if (run) { this.el += dt; this.clock += dt; }
    const u = clamp(this.el / s.dur, 0, 1);
    const d = lerp(s.d0, s.d1, u);
    if (this.day == null || Math.abs(d - this.day) > 1e-5) { this.day = d; this.api.setDay(d); }
    this.stage.lifeT = s.t0 != null ? s.t0 + this.el : this.clock;
    const top = this.stage.topZ();
    this.topS = this.topS == null ? top : this.topS + (top - this.topS) * Math.min(1, dt * 2.5);
    if (!this.paused) {
      const N = this.sch.N;
      const c = { u, el: this.el, st: this.stage.state, stage: this.stage, sch: this.sch, top: this.topS, mem: this.mem,
        Z: (f) => this.sch.z[clamp(Math.round(f), 1, N + 1)] };
      let cam = s.cam(c);
      if (s.smooth && this.camS && !this.snap && !this.frozen) {
        const k = Math.min(1, dt * s.smooth);
        cam = { p: mix(this.camS.p, cam.p, k), t: mix(this.camS.t, cam.t, k) };
      }
      this.snap = false;
      this.camS = cam;
      this.stage.setTourCam(cam.p, cam.t);
    }
    this.ui.prog.style.width = `${(((this.before + Math.min(this.el, s.dur)) / this.total) * 100).toFixed(2)}%`;
    if (run && !this.cutting && this.el >= s.dur && (!this._speaking() || this.el > s.dur + 10)) this.next();
  }
}
