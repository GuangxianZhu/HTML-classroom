// 穿模审计：快进仿真，列出“动的零件 × 它钻进去的东西”。node qa/clearance.mjs [秒] [--all]
import { open } from './lib.mjs';
const secs = +(process.argv[2] || 150); const all = process.argv.includes('--all');
// 本来就该接触 / 重叠的组合（正则，匹配 "动件 × 障碍"）
const OK = [
  /^rb_(gun|wrist|fore_o) × (~biw_|jig|orange)/,   // 焊枪伸进白车身 / 夹具
  /^(carrier|battery|battLift) × ~(carrier|battery|battLift)/, // 电池升降台从载具两根纵梁之间顶上来（包围盒重叠，实体不碰）
  /^tk_\w+ × ~tk_/,                                // 牵引车和挂车在牵引销处搭接
  /^pr_coil × (graphite\*|panelSteel)/,            // 钢卷套在芯轴上、带料从卷上引出
  /^car_(tires|rims) × steel\*/,                   // 车轮压在滚台的滚筒上
  /^stk_(fork|load) × (#load|#coilS|#pallet|rackUpright|rackBeam)/, // 堆垛机货叉伸进货位
];
const { browser, page, log } = await open({ w: 320, h: 200, q: 'instant=1&lq=1&still=1&pr=0.25&nolabels=1&hideui=1' });
const r = await page.evaluate((s) => DF.audit({ seconds: s }), secs);
await browser.close();
const bad = r.hits.filter((h) => all || !OK.some((re) => re.test(h.pair)));
console.log(`静态障碍 ${r.nStatic} · 动态零件 ${r.nDynamic} · ${r.nSteps} 步（${secs} s）`);
for (const h of bad) console.log(String(h.n).padStart(6), h.pair.padEnd(44), 'at', JSON.stringify(h.at), 't', h.t, '|', h.spots);
console.log(bad.length ? `穿模审计：${bad.length} 组需要看` : '穿模审计通过：没有动件钻进别的东西');
if (log.errors.length) console.log('errors', log.errors.slice(0, 3));
process.exit(bad.length ? 1 : 0);
