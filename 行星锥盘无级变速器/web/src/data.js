// 文字：零件说明、专利、来源。依据等级：a 公认 / b 资料（厂商样本、专利原文）/ c 推断 / d 估算（本页模型的数）
export const EV = { a: '公认', b: '资料', c: '推断', d: '估算' };
export const ev = (k) => `<i class="ev ${k}">${EV[k]}</i>`;

export const PARTS = {
  motor: { name: '电机', grp: '不转（外壳）', txt: '0.75 kW、4 极异步电机，额定约 1400 r/min。拧手轮时它的转速不变，变的是变速器里面的“齿比”。' },
  in_shaft: { name: '输入轴', grp: '输入（橙）', txt: '电机轴带着它转，1400 r/min。主动轮用键固定在上面，压盘用花键套在上面，所以这两个轮跟输入轴同速转。' },
  sun: { name: '主动轮（太阳轮）', grp: '输入（橙）', txt: '带锥度的盘，边上是一圈很窄的刃口（本页半径 40 mm），从一侧压在行星锥盘的锥面上。它转，就靠摩擦把行星锥盘搓转。' },
  press: { name: '压盘', grp: '输入（橙）', txt: '主动轮的“另一半”，从另一侧压住行星锥盘。主动轮和压盘一左一右，像钳子一样夹住盘的内侧。' },
  spring: { name: '碟簧', grp: '输入（橙）', txt: '几片碟形弹簧叠在一起，把主动轮和压盘往一起压，摩擦靠的就是这股力。行星盘往里走时会把这两个轮撑开，碟簧被压得更紧。' },
  seat: { name: '碟簧座', grp: '输入（橙）', txt: '锁在输入轴上，碟簧的另一头顶在这里。' },
  planet: { name: '行星锥盘', grp: '行星（银）', txt: '两个圆锥底对底合成的盘：中间厚、边上薄。内侧被主动轮和压盘夹着，外侧被定环和凸轮环夹着。它自己转（自转），同时跟着行星架绕中心转（公转）。共 6 个。' },
  slider: { name: '滑块（滑块轴承）', grp: '输出（蓝）', txt: '行星锥盘的心轴两头插在滑块里，滑块卡在行星架的径向槽里，能沿半径方向滑。调速时盘就是这样整个往里或往外挪的。' },
  carrier: { name: '行星架', grp: '输出（蓝）', txt: '两块带径向槽的板，中间用拉杆连起来。行星锥盘公转时推着它转，它就是输出。' },
  tie: { name: '拉杆', grp: '输出（蓝）', txt: '把两块行星架板连成一体，从相邻两个行星盘之间穿过。' },
  out_shaft: { name: '输出轴', grp: '输出（蓝）', txt: 'Ø19 带键，和行星架一体，转速 200 ~ 1000 r/min。和输入轴同轴、同方向转。' },
  ring_fixed: { name: '定环', grp: '不转（深灰）', txt: '装在壳体里，不转。刃口（本页半径 60 mm）从一侧压在行星锥盘外侧的锥面上。行星盘沿着它滚，所以会公转。' },
  ring_cam: { name: '调速凸轮环', grp: '不转（深灰）', txt: '也不转（只被手轮拨一个小角度），从另一侧夹住行星锥盘外侧。背面有斜坡，一转就前后移动，把外夹缝收窄或放宽。' },
  cam_teeth: { name: '齿扇和斜坡', grp: '调速（紫）', txt: '凸轮环顶上的一段齿让蜗杆拨，背面三段斜坡顶着壳体上的斜坡座：环转 40°，斜坡把它推着轴向走约 2 mm。' },
  cam_seat: { name: '斜坡座', grp: '不转（深灰）', txt: '固定在壳体上，和凸轮环背面的斜坡对顶。' },
  worm: { name: '蜗杆', grp: '调速（紫）', txt: '手轮经一对锥齿轮带它转，它再拨凸轮环的齿扇。蜗杆传动有自锁性：手松开后，弹簧的反力推不动它，转速不会自己跑。' },
  knob: { name: '调速手轮', grp: '调速（紫）', txt: '本页示意 13 圈走完 1000 → 200 r/min 的全程。顶箱侧面的指针跟着走。' },
  topbox: { name: '调速箱', grp: '不转（外壳）', txt: '盖住蜗杆和锥齿轮，正面是转速指示盘。' },
  dial: { name: '转速指示盘', grp: '不转（外壳）', txt: '指针随手轮转，刻度对应输出转速。' },
  housing: { name: '铝壳', grp: '不转（外壳）', txt: '一体铝铸件，外面带散热筋。里面灌油：摩擦面靠油膜传力，也靠油带走热量。' },
  cover: { name: '输出端盖', grp: '不转（外壳）', txt: '带输出轴承和法兰孔，可以直接法兰安装，也可以配底脚卧装。' },
};

// 3D 标注点 → 零件键
export const PIN_LABEL = {
  sun: 'sun', press: 'press', spring: 'spring', in_shaft: 'in_shaft', planet: 'planet', carrier: 'carrier', out_shaft: 'out_shaft',
  slider: 'slider', ring_fixed: 'ring_fixed', ring_cam: 'ring_cam', cam_teeth: 'cam_teeth', worm: 'worm', knob: 'knob',
  housing: 'housing', topbox: 'topbox', dial: 'dial', motor: 'motor',
};

export const PATENTS = [
  {
    no: 'CN2477894Y', url: 'https://patents.google.com/patent/CN2477894Y/zh', title: '行星锥盘摩擦式无级变速器',
    meta: '广东星光机电有限公司 · 申请 2001-05 · 公告 2002-02 · 实用新型，已失效', read: '摘要',
    body: '主动轮 + 锥盘行星轮 + 让两者贴紧的<b>压力弹簧</b>；主动轮轴线上同轴装<b>两个圆环</b>：一个周向固定、能轴向移动，另一个既能转又能轴向移动。写明的目的是让<b>低速输出扭矩大</b>、承载强、恒功率输出特性好。',
    rel: '和照片里的 MB/UDL 是同一类。“能转又能轴向移动的环”对应本页的调速凸轮环。它特意强调低速扭矩，说明这一类变速器的弱点正在低速段（第四、五章能看到原因）。',
  },
  {
    no: 'CN101398067B', url: 'https://patents.google.com/patent/CN101398067B/zh', title: '汽车行星无级变速器',
    meta: '授权 2013-02', read: '说明书片段',
    body: '指出通常的行星轮带<b>连体心轴</b>，心轴粗细限制了行星轮能挪多远；为了拿到大的变速范围，只好把主动轮或外压圈的<b>工作面做得很窄（约 1 mm）</b>。它的做法是行星轮的两个工作锥不带心轴，工作面做宽。',
    rel: '本页模型的刃口很窄、最快挡时主动轮刃口离行星盘心轴只剩约 1.7 mm，正是这里说的限制。',
  },
  {
    no: 'US4653349', url: 'https://patents.google.com/patent/US4653349A/en', title: 'Auxiliary device driving unit driven by an engine',
    meta: '美国专利', read: '说明书片段',
    body: '行星锥件装在行星架上；<b>变速环</b>贴在锥件的母线上，步进电机经丝杠让它<b>轴向移动</b>，接触位置一变，锥件自转速度就变。另有一个<b>钢球凸轮</b>，按传递的扭矩产生压紧力。',
    rel: '两点可以对照本页：一是“环沿锥面走”是另一种改变接触半径的办法；二是“按扭矩加压”是碟簧以外的另一条加压路线（第四章的方向二）。',
  },
  {
    no: 'US5484346A', url: 'https://patents.google.com/patent/US5484346A/en', title: 'Stepless speed changing apparatus',
    meta: '光洋精工（Koyo Seiko）· 1993 优先权', read: '说明书片段',
    body: '行星锥 + 变速环 + 输出盘。变速环靠壳体内壁的<b>导向键</b>挡住不让转，只能轴向走；说明书给了速比公式，讨论了变速环接触点落在锥尖和锥底附近两种极端。',
    rel: '“环不转、只轴向走”的一种具体做法。本页的定环、凸轮环也是不转的，变速全靠它们的轴向位置。',
  },
  {
    no: 'DE102013010423A1', url: 'https://patents.google.com/patent/DE102013010423A1/en', title: 'Friction gear with stepless transmission adjustment',
    meta: '德国申请', read: '说明书片段',
    body: '摩擦锥和摩擦环按行星方式布置；<b>行星轴在行星架的槽里能径向移动</b>；摩擦环轴向移动来改变速比。',
    rel: '和本页的滑块轴承同一思路：行星盘不是钉死在行星架上，而是能沿半径滑。',
  },
  {
    no: 'JPH10274306A', url: 'https://patents.google.com/patent/JPH10274306A/ja', title: '摩擦式無段変速機及びそのコーン',
    meta: '日本公开', read: '说明书片段',
    body: '遊星コーン只和三个件接触：入力円板、カムディスク、変速リング，每个一处，<b>只靠这三处的法线力就自己平衡</b>；入力円板一侧的接触面做成二次曲面，所以变速环轴向移动时力系仍然闭合。',
    rel: '这是“行星环锥”（Ring-cone 类）：输出取自凸轮盘、是差动输出，能降到很低转速。和 MB/UDL 的行星架输出是两条路线，对比见第七章。',
  },
  {
    no: 'JPH10115356A', url: 'https://patents.google.com/patent/JPH10115356A/ja', title: '遊星摩擦車式無段変速機',
    meta: '日本公开', read: '说明书片段',
    body: '锥形遊星車的轴承支架在行星架上<b>能摆动</b>，公转的离心力把它甩向变速环、压紧；变速环被导轨挡着不转、能移动，由转轴上的拨杆推着走；输出能连续从正转经停止到反转。',
    rel: '用离心力加压是又一种加压办法。本页的模型里离心力也在起作用：它让外侧正压力比内侧大一些（快挡约大 18%）。',
  },
  {
    no: 'JP4978557B2', url: 'https://patents.google.com/patent/JP4978557B2/ja', title: '摩擦車式の無段変速装置',
    meta: '日本专利', read: '说明书片段',
    body: '遊星ホイール带<b>变速锥面</b>，端部外周压着输出环；变速环“转动方向固定、轴向可动”，压在变速锥面上，位置一变转速就变。',
    rel: '又一个“不转、轴向走的环”调速的例子。',
  },
  {
    no: 'EP0087547B1', url: 'https://patents.google.com/patent/EP0087547B1/en', title: 'Epicyclic transmission with steplessly-variable speed control, having tapered planet wheels of dual conicity',
    meta: 'FIAT Auto · 1982 优先权', read: '只看到标题',
    body: '标题就是“带<b>双锥度</b>锥形行星轮的无级调速周转（行星）传动”。',
    rel: '“双锥行星轮”和本页行星锥盘的形状说法一致；正文没有读到，结构细节不作推断。',
  },
  {
    no: 'US5129869A', url: 'https://patents.google.com/patent/US5129869A/en', title: 'Ring cone type stepless transmission',
    meta: '久保田（Kubota）· 1989 优先权', read: '只看到标题',
    body: '环锥式无级变速。', rel: '列出来方便你继续查。',
  },
  {
    no: 'JPS58137657A', url: 'https://patents.google.com/patent/JPS58137657A/ja', title: '摩擦無段変速機',
    meta: '新宝工业（シンポ工業）· 1982', read: '只看到标题',
    body: '新宝是日本做摩擦无级变速机（リングコーン）的厂家之一。', rel: '列出来方便你继续查。',
  },
];

export const SOURCES = [
  ['MB 系列行星锥盘无级变速机：基本结构和工作原理（减速机网，2006）', 'http://www.jiansuji001.com/2006-10/20061026164701.htm'],
  ['MB 系列行星摩擦机械无级变速机的外形及传动变速原理（减速机网，2006）', 'http://www.jiansuji001.com/2006-4/200642283429.htm'],
  ['MB 无级变速器选型资料（格鲁夫）', 'https://www.gelufu.com/article_read_1544'],
  ['UDL 变速器：1:1.4 ~ 1:7、输入输出同向（angmotor）', 'https://www.angmotor.com/gearbox/variator/'],
  ['UDL 系列样本表：n2、M2（ever-power）', 'https://www.ever-power.net/hu/product/udl-series-planetary-discone-stepless-speed-variator/'],
  ['UDL/UD 系列：0.18 ~ 7.5 kW、1.5 ~ 118 N·m（DirectIndustry）', 'https://www.directindustry.com/prod/zhengzhou-aokman-machinery-co-ltd/product-224526-2319099.html'],
  ['MB 系列：变速比 1:5、同轴同向（威高）', 'https://china-weigao.com/m_cp_x.asp?id=192'],
  ['行星锥盘式无级变速器的设计（知乎）', 'https://zhuanlan.zhihu.com/p/1908541402389939736'],
  ['冯澄宙：行星锥盘无级变速器的传动比和受力分析，《机械传动》1990', 'https://doaj.org/article/30ef01ac3d1748db99b9fe630c459310'],
  ['U.S. Tsubaki DISCO 变速机构（目录页）', 'https://catalog.ustsubaki.com/view/303480282/330/'],
  ['无级变速机构参考图例（嘉立创 FA 手册）', 'https://www.jlc-jdgf.com/mcbook/W4-4-1.3.htm'],
  ['RX 系列行星环锥式无级变速机（格鲁夫）', 'https://www.gelufu.com.cn/wujibiansuqi/4628.html'],
  ['機械式無段変速機の原理と構造（兵神装備）', 'https://www.mohno-pump.co.jp/learning/manabiya/b2e.html'],
  ['リングコーン SCM-E シリーズ：自動調圧カム機構内蔵（MEKASYS）', 'https://www.mekasys.jp/series/detail/id/SNP_0010/?filter=category&code=73670000&number=21'],
];
