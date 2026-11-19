// 电影级巡游：9 段连续长镜头，真实时钟驱动，第 09 段终点 = 第 01 段起点（无缝循环）
import { makeSegs, sampleSegs } from './tourmath.js';

export class Tour {
  constructor(rig, opt = {}) {
    this.rig = rig; this.k = opt.fast ? 0.16 : 1; this.at = opt.at ?? null;
    this.active = false; this.chapter = -1; this.loops = 0; this.onChapter = null; this.onProgress = null; this.visited = [];
    this.segs = makeSegs(this.k);
    this.total = this.segs.reduce((a, s) => a + s.dur, 0);
  }
  cur() { const c = this.rig.cur; return [c.tx, c.ty, c.tz, c.azim, c.elev, c.dist, c.fov]; }
  start(now = performance.now()) {
    this.active = true; this.t0 = now; this.chapter = -1; this.loops = 0; this.visited = [];
    this.first = this.cur();
    const twoPi = Math.PI * 2; const a0 = this.segs[0].m[3];   // 方位角就近，避免绕大圈
    while (this.first[3] - a0 > Math.PI) this.first[3] -= twoPi;
    while (this.first[3] - a0 < -Math.PI) this.first[3] += twoPi;
    this.rig.locked = true;
  }
  stop() { this.active = false; this.rig.locked = false; Object.assign(this.rig.goal, this.rig.cur); }
  sample(e, firstLoop) { return sampleSegs(this.segs, e, firstLoop ? this.first : null); }
  update(now) {
    if (!this.active) return;
    let e = this.at != null ? Math.min(this.at * this.k, this.total - 1e-3) : (now - this.t0) / 1000;
    const loops = Math.floor(e / this.total);
    this.loops = loops;
    e -= loops * this.total;
    const { arr, i } = this.sample(e, loops === 0);
    this.rig.setArr(arr);
    if (i !== this.chapter) { this.chapter = i; this.visited.push(i); if (this.onChapter) this.onChapter(i); }
    if (this.onProgress) this.onProgress(e / this.total);
  }
}
