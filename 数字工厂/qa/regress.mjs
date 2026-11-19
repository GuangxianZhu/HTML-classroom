// 交互回归：node qa/regress.mjs
import { open, frames, sleep } from './lib.mjs';
const results = []; const ok = (name, pass, info = '') => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };
const ev = (p, f, a) => p.evaluate(f, a);

const { browser, page, log } = await open({ w: 1440, h: 900, q: 'instant=1&lq=1&still=1&pr=0.5' });
await frames(page, 2);
ok('启动 boot ready', await ev(page, () => DF.ready));
ok('HUD 顶栏/索引/KPI/dock 可见', await ev(page, () => ['#top', '#left', '#right', '#dock', '#nav'].every((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; })));
ok('分区索引 6 行', (await ev(page, () => document.querySelectorAll('.zrow').length)) === 6);
ok('KPI 已填充（OEE / 产量 / 能耗）', await ev(page, () => /^\d+\.\d$/.test(document.getElementById('oeeV').textContent) && +document.getElementById('cnt').textContent >= 936 && /^1\.\d{3}$/.test(document.getElementById('pwr').textContent)));
const c0 = await ev(page, () => DF.SIM.clock); await frames(page, 2);
ok('工厂时钟推进', (await ev(page, () => DF.SIM.clock)) > c0);
ok('21 个工位', (await ev(page, () => DF.SIM.stations.length)) === 21);

await page.click('#dock button[data-v="Z02"]', { noWaitAfter: true }); await frames(page, 1);
ok('dock → Z02 视角', await ev(page, () => Math.abs(DF.rig.goal.tx + 30) < 0.01 && DF.ctx.view === 'Z02'));
ok('inspector 打开分区', await ev(page, () => document.getElementById('insp').classList.contains('on') && document.getElementById('iTitle').textContent.includes('Z02')));
await page.keyboard.press('3'); await frames(page, 1);
ok('键盘 3 → Z03', await ev(page, () => DF.ctx.view === 'Z03' && document.querySelector('#dock button[data-v="Z03"]').classList.contains('on')));
await page.click('#zlist .zrow:nth-child(5)'); await frames(page, 1);
ok('分区索引点击 → Z05', await ev(page, () => DF.ctx.view === 'Z05'));
await page.click('#iBody .srow', { noWaitAfter: true }); await frames(page, 1);
ok('inspector 工位列表 → 聚焦', await ev(page, () => /AS-0\d/.test(document.getElementById('iTitle').textContent) && DF.rig.goal.dist < 80));
await page.keyboard.press('0'); await frames(page, 1);
ok('键盘 0 → 总览', await ev(page, () => DF.ctx.view === 'overview' && Math.abs(DF.rig.goal.dist - 300) < 0.01));

// 设备拾取：把相机放到 Z02，投影 PR-02 信标附近点击
await ev(page, () => { DF.ctx.goZone('Z02'); Object.assign(DF.rig.cur, DF.rig.goal); DF.rig.apply(); DF.ctx.closeInspector(); });
await frames(page, 2);
const pt = await ev(page, () => { const s = DF.SIM.byId['PR-02']; const v = new DF.camera.position.constructor((s.box[0] + s.box[1]) / 2, 4, (s.box[4] + s.box[5]) / 2).project(DF.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
await page.mouse.click(pt.x, pt.y); await frames(page, 1);
ok('点击设备 → 工位 inspector', await ev(page, () => document.getElementById('iTitle').textContent.includes('PR-0')), JSON.stringify(pt));
await page.click('#iFault', { noWaitAfter: true }); await frames(page, 1);
ok('注入故障 → 红色告警', await ev(page, () => document.getElementById('iTitle').textContent && DF.SIM.stations.some((s) => s.state === 'down') && DF.SIM.events[0].sev === 'crit'));
// 点击地面分区
await ev(page, () => { DF.ctx.goOverview(); Object.assign(DF.rig.cur, DF.rig.goal); DF.rig.apply(); });
await frames(page, 1);
const gp = await ev(page, () => { const v = new DF.camera.position.constructor(40, 0, 32.5).project(DF.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
await page.mouse.click(gp.x, gp.y); await frames(page, 1);
ok('点击地面 → 分区导航', await ev(page, () => DF.ctx.view === 'Z05'), JSON.stringify(gp));

await page.keyboard.press('d'); await frames(page, 1);
ok('D 关闭数据层', await ev(page, () => DF.ctx.data.group.visible === false));
await page.keyboard.press('d'); await frames(page, 1);
ok('D 打开数据层', await ev(page, () => DF.ctx.data.group.visible === true));
await page.keyboard.press('l'); await frames(page, 1);
ok('L 隐藏标签', await ev(page, () => document.body.classList.contains('nolabels')));
await page.keyboard.press('l');
ok('L 显示标签', await ev(page, () => !document.body.classList.contains('nolabels')));
await page.click('#rate button[data-r="4"]', { noWaitAfter: true });
ok('4× 演示速率', await ev(page, () => DF.SIM.rate === 4));
await page.click('#rate button[data-r="1"]', { noWaitAfter: true });

await ev(page, () => { DF.ctx.goOverview(); Object.assign(DF.rig.cur, DF.rig.goal); });
const d0 = await ev(page, () => DF.rig.goal.dist);
await page.mouse.move(720, 450); await page.mouse.wheel(0, 400); await frames(page, 1);
ok('滚轮缩放', (await ev(page, () => DF.rig.goal.dist)) > d0 * 1.2);
const a0 = await ev(page, () => DF.rig.goal.azim);
await page.mouse.move(700, 500); await page.mouse.down(); await page.mouse.move(800, 520, { steps: 4 }); await page.mouse.up(); await frames(page, 1);
ok('拖拽环绕', Math.abs((await ev(page, () => DF.rig.goal.azim)) - a0) > 0.2);

await page.keyboard.press(' '); await frames(page, 2);
ok('Space 开始巡游', await ev(page, () => DF.tour.active && document.getElementById('cap').classList.contains('on') && /\d\/9/.test(document.getElementById('tourS').textContent)));
await page.keyboard.press(' '); await frames(page, 1);
ok('Space 停止巡游', await ev(page, () => !DF.tour.active && !document.getElementById('cap').classList.contains('on')));
await page.click('#bTour', { noWaitAfter: true }); await frames(page, 1);
await page.keyboard.press('Escape'); await frames(page, 1);
ok('Esc 停止巡游', await ev(page, () => !DF.tour.active));
await page.click('#bTour', { noWaitAfter: true }); await frames(page, 1);
await page.mouse.move(700, 500); await page.mouse.down(); await page.mouse.move(760, 500, { steps: 3 }); await page.mouse.up();
ok('拖拽打断巡游', await ev(page, () => !DF.tour.active));
await page.keyboard.press('h');
ok('H 隐藏 UI', await ev(page, () => document.body.classList.contains('hideui') && getComputedStyle(document.getElementById('dock')).display === 'none'));
await page.keyboard.press('h');
await page.keyboard.press('b'); await frames(page, 2); await sleep(1500);
ok('B 电影遮幅', await ev(page, () => document.body.classList.contains('letterbox') && document.getElementById('lbT').getBoundingClientRect().height > 50));
await page.keyboard.press('b');
await page.click('#dock button[data-a="reset"]', { noWaitAfter: true });
ok('复位', await ev(page, () => DF.ctx.view === 'overview' && DF.SIM.rate === 1));
ok('控制台零报错', log.errors.length === 0, log.errors.slice(0, 3).join(' | '));
ok('零外部请求', log.requests.length === 0, log.requests.slice(0, 3).join(' | '));

// 移动端
await page.setViewportSize({ width: 390, height: 844 }); await sleep(500); await frames(page, 1);
ok('移动端：无横向溢出', await ev(page, () => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth));
ok('移动端：侧栏隐藏、dock 贴底可横滑', await ev(page, () => getComputedStyle(document.getElementById('left')).display === 'none' && getComputedStyle(document.getElementById('right')).display === 'none' && (() => { const r = document.getElementById('dock').getBoundingClientRect(); return r.bottom >= innerHeight - 2 && r.width <= innerWidth + 1; })()));
await page.screenshot({ path: process.argv[2] || 'qa/shots/mobile.png' });
await browser.close();
const fail = results.filter((r) => !r.pass);
console.log(`\n交互回归 ${results.length - fail.length}/${results.length} 通过`);
process.exit(fail.length ? 1 : 0);
