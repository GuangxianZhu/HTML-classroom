// 每页"动手实验"一节的 HTML。画图和计算在 labs.js 里，id 要对上。
import { EV } from './data.js';
const A = EV.A, B = EV.B, Cc = EV.C;

const force = `
  <h2>力的账本：膜片上的力怎么平衡，流量越大为什么出口越低</h2>
  <p class="intro">上面的检修台是"看它动"，这里是"算给你看"：把作用在膜片 + 阀芯这一组零件上的每一股力都画出来。阀开着时，向下和向上两条一样长。</p>
  <div class="lab">
    <div>
      <canvas class="plot" id="cvForce" style="height:180px" aria-label="作用在膜片和阀芯上的力"></canvas>
      <p class="cap">作用在膜片 + 阀芯这一组零件上的力。阀开着的时候，上下两条一样长。</p>
      <canvas class="plot" id="cvFlow" style="height:260px;margin-top:12px" aria-label="出口压力随流量变化的曲线"></canvas>
      <p class="cap">流量曲线：实线是当前进口压力，虚线是另一档进口压力。橙点是现在的工作点。</p>
    </div>
    <div>
      <div class="ctl">
        <label>手轮设定（零流量时的出口）<output id="l1_set_o"></output><input type="range" id="l1_set" min="100" max="500" step="5" value="300"></label>
        <label>进口压力<output id="l1_p1_o"></output><input type="range" id="l1_p1" min="500" max="1000" step="500" value="1000"></label>
        <label>下游用气量（按 300 kPa 计）<output id="l1_q_o"></output><input type="range" id="l1_q" min="0" max="450" step="5" value="120"></label>
      </div>
      <div class="read" id="l1_read"></div>
      <p class="note"><b>先猜再拖：</b>把用气量从 0 拖到 450，橙点沿曲线往右下走。到"阀芯全开"那一点以后，曲线突然变陡：阀已经开到底，不再调节了。</p>
      <p class="note"><b>下垂。</b>阀芯要开大，膜片就得往下走一点，弹簧随之伸长，力变小。这是"只有比例、没有积分"的控制方式必然留下的误差。 ${A}</p>
      <p class="note"><b>进口压力效应。</b>把进口从 1000 切到 500 kPa，小流量那一段虚线在实线上面：进口低，出口反而高。 ${A}</p>
    </div>
  </div>
  <div class="callout">专利 US5732736（高纯气体调压阀，Veriflo）专门处理下垂：把阀芯头部做成先缓后陡的两段锥面，小行程时密封可靠，过了那一段以后开度增长更快，同样的流量需要更少的行程，于是掉压更小。文中例子是 80 psi 进口、30 psi 设定、300 L/min 时，掉压从 10 psi 降到 6 psi。 ${B}</div>`;

const two = `
  <h2>单级、平衡阀芯、两级：钢瓶从满用到空</h2>
  <p class="intro">同一个设定、同一个用气量，钢瓶从 15 MPa 一直用到 0.6 MPa。三条线分别是单级阀、平衡阀芯的单级阀、两级阀的出口。</p>
  <div class="lab">
    <div>
      <canvas class="plot" id="cvTwo" style="height:320px" aria-label="单级和两级减压阀出口随钢瓶压力变化"></canvas>
      <p class="cap">到最右端，钢瓶压力已经接近设定，谁都稳不住了。</p>
    </div>
    <div>
      <div class="ctl">
        <label>出口设定<output id="l2_set_o"></output><input type="range" id="l2_set" min="100" max="500" step="10" value="300"></label>
        <label>用气量<output id="l2_q_o"></output><input type="range" id="l2_q" min="10" max="60" step="5" value="30"></label>
      </div>
      <div class="read" id="l2_read"></div>
      <p class="note">另一条路是把阀芯做成"平衡式"，让进口压力在阀芯两面互相抵消（虚线）。专利 US6328054 和 US9678516 讲的都是这个。 ${B}</p>
      <p class="note">什么时候用两级：钢瓶直接供气、出口要求稳的场合（分析仪器、工艺气钢瓶柜）。 ${Cc}</p>
    </div>
  </div>
  <details class="assume"><summary>这个实验的假设</summary><ul>
    <li>单级阀的阀口面积 / 膜片面积 = 0.6%，第一级相同，第二级 0.8%。 ${Cc}</li>
    <li>"平衡阀芯"这条线只是把进口压力的作用面积减到 12%，表示"大部分抵消掉"，不是某个具体设计。</li>
  </ul></details>`;

const droop = `
  <h2>弹簧加载 vs 圆顶加载：同一套膜片和阀芯，只换加载方式</h2>
  <p class="intro">两条曲线用的是同一张膜片、同一颗阀芯，零流量时设定相同。唯一的区别：上面压着的是弹簧还是一腔气。</p>
  <div class="lab">
    <div>
      <canvas class="plot" id="cvDroop" style="height:280px" aria-label="弹簧加载和圆顶加载的流量曲线"></canvas>
      <p class="cap">同样的零流量设定，弹簧式和圆顶式在流量增大时各掉多少。</p>
    </div>
    <div>
      <div class="ctl">
        <label>零流量设定<output id="l3_set_o"></output><input type="range" id="l3_set" min="100" max="500" step="10" value="300"></label>
        <label>进口压力<output id="l3_p1_o"></output><input type="range" id="l3_p1" min="500" max="1000" step="50" value="1000"></label>
      </div>
      <div class="read" id="l3_read"></div>
      <p class="note">圆顶式那条线也在往下走：膜片自身刚度、阀芯弹簧、进口压力效应都还在。想让它完全不掉，要靠电子闭环（G、H 页）。</p>
    </div>
  </div>`;

const liq = `
  <h2>药液出口跟控制气走，但有两个天花板</h2>
  <p class="intro">横轴是控制气，纵轴是药液出口。贴着 1:1 虚线，说明"气压多少，液压就多少"。</p>
  <div class="lab">
    <div>
      <canvas class="plot" id="cvLiq" style="height:300px" aria-label="药液出口压力随控制气压力变化"></canvas>
      <p class="cap">三条线是下游三种开度；红色虚线是供液压力（泵出口）。</p>
    </div>
    <div>
      <div class="ctl">
        <label>供液压力（泵出口）<output id="l3_p1_o"></output><input type="range" id="l3_p1" min="150" max="500" step="10" value="400"></label>
        <label>下游阀开度（实线）<output id="l3_open_o"></output><input type="range" id="l3_open" min="5" max="100" step="1" value="50"></label>
      </div>
      <div class="read" id="l3_read2"></div>
      <p class="note"><b>天花板一：</b>出口不可能高过供液压力，控制气调得再高，曲线碰到红线就平了。</p>
      <p class="note"><b>天花板二：</b>下游开得越大，膜片需要更大的压差才能把阀芯推开，出口就越低于控制气。</p>
      <p class="note">液体那一侧（平衡膜片、闭环供液线、循环主管上的背压阀）在同一个仓库的 <a href="../../液体调压阀/index.html">液体调压阀</a> 页面里讲得更细。</p>
    </div>
  </div>`;

const bpr = `
  <h2>来气多了 40 倍，上游只涨十来 kPa</h2>
  <p class="intro">横轴是上游来气量，纵轴是被顶住的上游压力。线越平，背压阀"顶"得越好。</p>
  <div class="lab">
    <div>
      <canvas class="plot" id="cvBpr" style="height:300px" aria-label="背压阀上游压力随来气量变化"></canvas>
      <p class="cap">实线是当前圆顶设定，两条虚线是低一档、高一档。</p>
    </div>
    <div>
      <div class="ctl">
        <label>圆顶设定<output id="l5_dome_o"></output><input type="range" id="l5_dome" min="100" max="400" step="10" value="250"></label>
      </div>
      <div class="read" id="l5_read"></div>
      <p class="note">曲线一开始那一小段陡坡：膜片要先克服把它压在阀座上的那一点力才会离开阀座，所以刚开始放气时上游要比圆顶高几 kPa。 ${Cc}</p>
      <p class="note">往后变平：膜片抬高一点，放气能力就涨很多。涨的那十来 kPa 来自膜片自身的刚度。 ${Cc}</p>
    </div>
  </div>`;

const arena = (focus) => `
  <h2>开环和闭环，差的是"电信号到压力"这一层</h2>
  <p class="intro">F、G、H 三台都是"用电信号来设定"的调压阀。区别在于：有没有一个电子压力传感器，把真实出口压力告诉控制板。下面三台同时接在一样的气源和负载上，你给它们同一组扰动。${focus >= 0 ? '本页这台用粗实线画。' : ''}</p>
  <div class="loop">
    <div>
      <h3>开环（F 型）</h3>
      <div class="chain"><span>电信号</span><em>→</em><span>电磁力</span><em>→</em><span>膜片力平衡</span><em>→</em><span>出口压力</span></div>
      <p>电信号只决定"推多大力"。机械那一层仍是闭环，但没有人回头核对"出口到底是不是信号要的值"，准不准全靠出厂标定。 ${B}</p>
    </div>
    <div>
      <h3>闭环（G 型、H 型）</h3>
      <div class="chain"><span>设定</span><em>→</em><span class="hot">控制板</span><em>→</em><span>电磁阀 / 压电阀</span><em>→</em><span>出口压力</span><em>→</em><span class="hot">压力传感器</span><em>↩ 控制板</em></div>
      <p>控制板一直拿传感器读数和设定比，差多少就补多少。流量和进口压力的影响都能补回来，直到阀的通径不够为止。代价是：它只认传感器。 ${B}</p>
    </div>
  </div>
  <div class="lab wide">
    <div>
      <canvas class="plot" id="cvArena" style="height:300px" aria-label="三种电气式调压阀的出口压力随时间变化"></canvas>
      <div class="legend" id="arenaLegend"></div>
      <canvas class="plot" id="cvPwm" style="height:58px;margin-top:8px" aria-label="闭环电气比例阀两只电磁阀的动作"></canvas>
      <p class="cap">下面一条：闭环电气比例阀（G）的充气阀和排气阀每一下开关。稳住以后它们大多数时间是关着的。</p>
    </div>
    <div>
      <div class="ctl">
        <label>设定（三台同时）<output id="a_set_o"></output><input type="range" id="a_set" min="0" max="450" step="5" value="200"></label>
        <label>进口压力<output id="a_p1_o"></output><input type="range" id="a_p1" min="250" max="900" step="10" value="700"></label>
        <label>下游用气量<output id="a_q_o"></output><input type="range" id="a_q" min="0" max="250" step="5" value="60"></label>
      </div>
      <div class="btns" style="margin-top:10px">
        <button type="button" id="bJump">设定跳一下</button>
        <button type="button" id="bDrift" aria-pressed="false">传感器漂 +10 kPa</button>
        <button type="button" id="bDead" aria-pressed="false">出口堵死</button>
        <button type="button" id="bPower" aria-pressed="false">断电</button>
        <button type="button" id="bLimit" aria-pressed="false">关掉压电式防冲过头</button>
        <button type="button" id="bReset">复位</button>
      </div>
      <div class="read" id="arenaRead"></div>
      <p class="note" id="arenaNote"></p>
    </div>
  </div>
  <div class="tw">
    <table>
      <thead><tr><th></th><th>开环电气比例阀（F）</th><th>闭环电气比例阀（G）</th><th>压电数字式（H）</th></tr></thead>
      <tbody>
        <tr><th>精度靠什么</th><td>出厂标定</td><td>压力传感器</td><td>压力传感器</td></tr>
        <tr><th>流量 / 进口变化</th><td>直接变成误差</td><td>自动补偿</td><td>自动补偿</td></tr>
        <tr><th>出口能不能往外放</th><td>带溢流的能</td><td>能（溢流 + 排气阀）</td><td>不能，只能等下游用掉 ${Cc}</td></tr>
        <tr><th>平时耗气</th><td>喷嘴挡板式一直漏一点；电磁铁式几乎不耗</td><td>只在调节时排气</td><td>不耗</td></tr>
        <tr><th>传感器坏了</th><td>不受影响（本来就没有）</td><td>把错的值守得很准</td><td>把错的值守得很准</td></tr>
        <tr><th>常见用途</th><td>要求不高、要便宜的场合</td><td>气缸推力、喷涂、各种先导气</td><td>高纯气体面板、快速稳压</td></tr>
      </tbody>
    </table>
  </div>`;

export function labHTML(key, focus = -1) {
  return { force, two, droop, liq, bpr, arena: arena(focus) }[key];
}
