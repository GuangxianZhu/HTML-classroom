// 课程表：一条线讲到底。总目录、每课开头的“上一课”、结尾的“下一课要回答的问题”都从这里来，改一处全课跟着变。
// ask  = 这一课要回答的问题（上一课结尾留下的）
// got  = 这一课学会的一句话（下一课开头回顾用）
// adds = 这一课新认识的量（量表里点亮）
// ready = 已经做好、能点开的课

export const PARTS = [
  { id: 'p1', level: '高中', name: '描述运动', note: '车在哪、多快、速度怎么变，先不问为什么' },
  { id: 'p2', level: '高中', name: '为什么会这样动', note: '力从哪来，力怎么改变运动' },
  { id: 'p3', level: '高中', name: '换一本账：能量和动量', note: '不看过程，只看前后' },
  { id: 'p4', level: '大学', name: '把简化拿掉', note: '还是这辆车：加速度一直在变、有风阻、车轮会转、悬架会晃' },
];

export const LESSONS = [
  { n: 1, part: 'p1', title: '车在哪：位置、位移、路程', ask: '往前开 40 m、又倒回 10 m，车到底“走了多远”？', got: '位置要先定原点和正方向；位移只看起点和终点，路程把走过的每一段都加起来。', adds: ['x'], ready: true },
  { n: 2, part: 'p1', title: '多快：速度', ask: 'x-t 图上的线有的地方陡、有的地方平，陡代表什么？', got: '速度 = 位移 ÷ 时间，就是 x-t 图的斜率；时间取得足够短，就是速度表上那一刻的读数。', adds: ['v'], ready: true },
  { n: 3, part: 'p1', title: '速度怎么变：加速度', ask: '速度表的指针一直在动，“变得有多快”怎么描述？', got: '加速度 = 速度的变化 ÷ 时间，就是 v-t 图的斜率；它的方向和速度相反，车就在减速。', adds: ['a'], ready: true },
  { n: 4, part: 'p1', title: '反过来：从速度算距离', ask: '知道速度怎么变，能不能反过来算出车走了多远？', got: 'v-t 图下面的面积就是位移；匀加速时它是一个梯形，算出来就是 x = v₀t + ½at²。', adds: [], ready: true },
  { n: 5, part: 'p1', title: '停下来：刹车距离和反应时间', ask: '只知道车速和刹车的减速度，不知道刹了多久，停车要多远？', got: 'v² − v₀² = 2ax：车速翻倍，刹车距离变成 4 倍；刹车之前还有一段反应距离。', adds: [], ready: true },
  { n: 6, part: 'p1', title: '量自己的反应时间：自由落体', ask: '上一课的反应时间 0.8 s 是哪来的？我自己的是多少？', got: '' },
  { n: 7, part: 'p1', title: '两个方向一起动：平抛', ask: '东西带着水平速度飞出去，边飞边掉，怎么算？', got: '' },
  { n: 8, part: 'p1', title: '拐弯也是加速度', ask: '车速不变、只拐弯，算不算在加速？', got: '' },
  { n: 9, part: 'p2', title: '为什么会加速：力和质量', ask: '前面算了那么多加速度，它到底是谁给的？', got: '', adds: ['F', 'm'] },
  { n: 10, part: 'p2', title: '车轮怎么推动车：摩擦力', ask: '发动机在车里面，是什么把车往前推？', got: '' },
  { n: 11, part: 'p2', title: '上坡：把一个力拆成两个', ask: '坡越陡越难开，差在哪？', got: '' },
  { n: 12, part: 'p2', title: '拖车：成对出现的力', ask: '车拖着另一辆车，两边的力一样大吗？', got: '' },
  { n: 13, part: 'p2', title: '被按在座椅上：超重和失重', ask: '起步时觉得被往后按，那个力是哪来的？', got: '' },
  { n: 14, part: 'p2', title: '拐弯要多大的力：向心力', ask: '弯道为什么限速？摩托为什么要倾斜？', got: '' },
  { n: 15, part: 'p2', title: '一直在拐弯的“车”：卫星', ask: '卫星为什么掉不下来？', got: '' },
  { n: 16, part: 'p3', title: '刹车距离为什么跟着 v² 走：功和动能', ask: '第 5 课的 v²，换一个角度看是什么？', got: '', adds: ['E'] },
  { n: 17, part: 'p3', title: '下坡不踩油门：机械能守恒', ask: '从坡顶滑下来，到坡底有多快？', got: '' },
  { n: 18, part: 'p3', title: '功率：每秒能给多少能量', ask: '同样的车，为什么高速时加速变慢了？', got: '' },
  { n: 19, part: 'p3', title: '两车相撞：动量', ask: '撞在一起以后，两辆车怎么动？', got: '', adds: ['p'] },
  { n: 20, part: 'p4', title: '加速度一直在变：微积分', ask: '真实的起步加速度不是常数，第 4 课的梯形还能用吗？', got: '' },
  { n: 21, part: 'p4', title: '有风阻：牛顿定律变成微分方程', ask: '风阻随车速变，怎么一步一步算出车速？', got: '' },
  { n: 22, part: 'p4', title: '坐在车里看：非惯性系', ask: '第 13 课被按在座椅上的“力”，到底算不算力？', got: '' },
  { n: 23, part: 'p4', title: '车轮也在转：力矩和转动惯量', ask: '起步时，一部分力气花在了让车轮转起来上吗？', got: '' },
  { n: 24, part: 'p4', title: '滚动和打滑', ask: '车轮什么时候在滚，什么时候在打滑？', got: '' },
  { n: 25, part: 'p4', title: '悬架：振动、阻尼、共振', ask: '过减速带时车为什么晃几下就停？', got: '' },
  { n: 26, part: 'p4', title: '轨道为什么是椭圆', ask: '回到第 15 课：卫星的轨道不是正圆会怎样？', got: '' },
  { n: 27, part: 'p4', title: '不画受力图也能列方程（选学）', ask: '力太多、画不清楚的时候，有没有别的办法？', got: '' },
];

/** 全课程的量：符号、名字、单位、颜色（CSS 变量名） */
export const QUANTS = [
  { k: 'x', name: '位置 / 位移', unit: 'm', c: 'x' },
  { k: 'v', name: '速度', unit: 'm/s', c: 'v' },
  { k: 'a', name: '加速度', unit: 'm/s²', c: 'a' },
  { k: 'F', name: '力', unit: 'N', c: 'F' },
  { k: 'm', name: '质量', unit: 'kg', c: 'm' },
  { k: 'E', name: '能量', unit: 'J', c: 'E' },
  { k: 'p', name: '动量', unit: 'kg·m/s', c: 'p' },
];
/** 学到第 n 课时认识了哪些量 */
export const known = (n) => new Set(LESSONS.filter((l) => l.n <= n).flatMap((l) => l.adds || []));

export const pad = (n) => String(n).padStart(2, '0');
export const lessonFile = (n) => `${pad(n)}.html`;

// 学习进度只存在这个浏览器里；存不了（隐私模式、被禁用）就当没有
const KEY = 'mech-course-v1';
export function loadProgress() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
export function saveProgress(n, patch) {
  try { const p = loadProgress(); p[n] = { ...(p[n] || {}), ...patch }; localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 存不了就算了 */ }
}
