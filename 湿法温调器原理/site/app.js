// 页面装配：3D 查看器框、专利卡片、首页卡片、导航高亮
(function () {
  const IMG = window.__IMG || {}; // 离线版：图片以 data URI 内嵌
  const src = n => IMG[n] || `img/${n}.png`;
  const names = { immersion: '① 槽内浸入式', wall: '② 槽外贴壁式', lamp: '③ 红外灯管式', sheath: '④ 氟树脂包覆电阻式',
    induction: '⑤ 感应加热式', hx: '⑥ 换热器式', peltier: '⑦ 珀耳帖式（電子冷熱）', system: '整体：循环槽 + 控温' };
  const IDLE = 'Blender 渲染图 · 点按钮可 3D 交互';

  document.querySelectorAll('.viewer[data-model]').forEach(v => {
    const m = v.dataset.model;
    v.innerHTML = `<div class="stage"><img src="${src(m)}" alt="${names[m]} 的 Blender 模型渲染图"><button class="play">▶ 3D 旋转查看（可悬停看零件）</button><div class="tip"></div></div><div class="status">${IDLE}</div><div class="chips"></div>`;
    v.querySelector('.play').onclick = () => {
      if (!window.open3D) { v.querySelector('.status').textContent = '3D 引擎没加载成功：请用「启动源码版.bat」或单文件版 index.html 打开'; return; }
      document.querySelectorAll('.viewer.live').forEach(o => { o.classList.remove('live'); o.querySelector('.chips').innerHTML = ''; o.querySelector('.status').textContent = IDLE; });
      window.open3D(v, `models/${m}.glb`);
    };
  });

  const P = window.PATENTS || {};
  document.querySelectorAll('.patents[data-k]').forEach(box => {
    const list = P[box.dataset.k] || [];
    box.innerHTML = list.map(p => `
      <article class="pat">
        <header><a href="${p.url}" target="_blank" rel="noopener">${p.no}</a><span class="ev ${p.v === 'ok' ? 'b' : 'c'}">${p.v === 'ok' ? '已核对' : '部分书目未显示'}</span></header>
        <h4>${p.t}</h4>
        <div class="meta">${p.who} · ${p.y}</div>
        <ul>${p.pts.map(x => `<li>${x}</li>`).join('')}</ul>
      </article>`).join('');
  });

  const cards = document.getElementById('cards');
  if (cards) cards.innerHTML = Object.entries(names).filter(([k]) => k !== 'system').map(([k, n]) => `<a class="card" href="#${k}"><img src="${src(k)}" alt=""><span>${n}</span></a>`).join('');

  const links = [...document.querySelectorAll('#nav a')];
  const secs = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const hl = () => {
    let cur = secs[0];
    secs.forEach(s => { if (s.getBoundingClientRect().top < 140) cur = s; });
    links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + cur.id));
  };
  addEventListener('scroll', hl, { passive: true }); hl();

  if (location.protocol === 'file:' && !window.__OFFLINE) {
    const b = document.createElement('div'); b.className = 'banner';
    b.innerHTML = '你是直接双击打开的源码版：实验和图片都能用，但 <b>3D 模型需要</b>用「启动源码版.bat」打开，或直接打开上一级文件夹里的 index.html（单文件离线版）。';
    document.querySelector('main').prepend(b);
  }
  window.initExperiments && window.initExperiments();
})();
