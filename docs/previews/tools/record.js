// 录 README 用的预览动图：起一个本地静态服务器 -> Playwright 打开页面按 plan.json 点几下并录屏 -> ffmpeg 转成 GIF。
// 用法：node docs/previews/tools/record.js [名字 ...]   （不写名字就全部重录；名字见 plan.json）
// 依赖：Node.js、playwright（npm i playwright && npx playwright install chromium）、ffmpeg（在 PATH 里）
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');           // 仓库根目录
const OUT = path.resolve(__dirname, '..');                   // docs/previews
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan.json'), 'utf8'));
const W = 960, H = 600;          // 录制窗口
const GIF_W = 440, FPS = 6;      // GIF 宽度和帧率：控制体积的两个主要旋钮
const MAX_SEC = 9;               // 超过这个长度就加速播放

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

async function biggestCanvas(pg) {
  return pg.evaluate(() => { let best = null, a = 0; for (const c of document.querySelectorAll('canvas')) { const r = c.getBoundingClientRect(); const x0 = Math.max(r.left, 0), y0 = Math.max(r.top, 0), x1 = Math.min(r.right, innerWidth), y1 = Math.min(r.bottom, innerHeight); const v = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); if (v > a) { a = v; best = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; } } return a > 60000 ? best : null; });
}
async function scrollMain(pg, d) {   // 滚动页面里最大的那个可滚动区域
  await pg.evaluate(async d => { let el = document.scrollingElement, best = el.scrollHeight - el.clientHeight; for (const e of document.querySelectorAll('*')) { if (/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.clientHeight > 200) { const x = e.scrollHeight - e.clientHeight; if (x > best) { best = x; el = e; } } } for (let i = 0; i < 30; i++) { el.scrollTop += d / 30; await new Promise(r => setTimeout(r, 40)); } }, d);
}

async function recordOne(base, name, cfg, tmp) {
  // swiftshader：没有显卡也能跑 WebGL（慢，但录屏够用）
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const vdir = path.join(tmp, name);
  const ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: vdir, size: { width: W, height: H } } });
  const pg = await ctx.newPage();
  await pg.route(/fonts\.(googleapis|gstatic)/, r => r.abort());   // 不等外网字体
  const t0 = Date.now(), now = () => (Date.now() - t0) / 1000, log = [];
  await pg.goto(base + cfg.page.split('/').map(encodeURIComponent).join('/'), { waitUntil: 'load', timeout: 120000 });
  await pg.waitForTimeout(cfg.loadWait || 6000);
  let start = now();
  for (const [k, v] of cfg.steps) {
    try {
      if (k === 'mark') start = now();                        // 动图从这里开始（前面的滚动不要）
      else if (k === 'wait') await pg.waitForTimeout(v);
      else if (k === 'click') await pg.getByText(v, { exact: false }).filter({ visible: true }).first().click({ timeout: 8000 });
      else if (k === 'sel') await pg.locator(v).first().click({ timeout: 8000 });
      else if (k === 'jsclick') await pg.evaluate(s => document.querySelector(s).click(), v);   // 用脚本点，页面不会为了露出按钮而滚动
      else if (k === 'selopt') await pg.locator(v[0]).selectOption({ label: v[1] });
      else if (k === 'into') await pg.evaluate(s => { document.querySelector(s).scrollIntoView({ block: 'end' }); window.scrollBy(0, 40); }, v);
      else if (k === 'scroll') await scrollMain(pg, v);
      else if (k === 'drag') {                                 // 在最大的画布上拖一下，转动三维模型
        const c = await biggestCanvas(pg);
        if (c) { await pg.mouse.move(c.cx - 100, c.cy); await pg.mouse.down(); for (let i = 0; i <= 24; i++) { await pg.mouse.move(c.cx - 100 + i * 8, c.cy - Math.sin(i / 24 * Math.PI) * 25); await pg.waitForTimeout(40); } await pg.mouse.up(); await pg.mouse.move(2, 2); await pg.waitForTimeout(800); }
      }
    } catch (e) { log.push(`没成功: ${k} ${JSON.stringify(v)}`); }
  }
  const end = now();
  await ctx.close(); await b.close();
  const webm = path.join(vdir, fs.readdirSync(vdir)[0]);
  const dur = end - start, speed = Math.max(1, dur / MAX_SEC);
  const gif = path.join(OUT, name + '.gif');
  const vf = `setpts=PTS/${speed},fps=${FPS},scale=${GIF_W}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${cfg.colors || 80}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(start), '-t', String(dur), '-i', webm, '-vf', vf, gif]);
  console.log(`${name}: ${(fs.statSync(gif).size / 1024).toFixed(0)} KB, ${dur.toFixed(1)} s x${speed.toFixed(1)} ${log.join('; ')}`);
}

(async () => {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(plan);
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'previews-'));
  try { for (const n of names) { if (!plan[n]) { console.log('plan.json 里没有：' + n); continue; } await recordOne(base, n, plan[n], tmp); } }
  finally { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})();
