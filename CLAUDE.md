# HTML-classroom — 给 Claude 的入口

每个顶层文件夹是一个独立的小项目，动手前先读该项目的 README.md。
下面这些 Blender 建模项目是 2026-11-02 从 GuangxianZhu/ITBasics（commit e94e631）原样复制过来的；ITBasics 里的原件没有删。

| 项目 | 说明 |
|---|---|
| `无刷电机爆炸图/` | 57 型无刷直流电机：Blender 脚本建模 + 网页查看器（结构/原理/模型） |
| `三相电机爆炸图/` | 三相异步电机：Blender 脚本建模 + 结构/原理/电动/发电网页 |
| `涵道无人机/` | 原创 3 寸涵道机：Blender 脚本建模 + 飞行演示 + 爆炸图 |
| `E235电车模型/` | Blender 脚本建模 + 网页查看器，门/灯可动 |
| `五指灵巧手/` | 20 自由度直驱手：零件树 + params.json + 逐件建模，网页查看器 |
| `干法刻蚀机/` | 原创 ICP 刻蚀机教学：离线网页里操作机台跑完一次工艺 |
| `迷你车床爆炸图/` | 8 合 1 迷你桌面车床：Blender 脚本建模 + 爆炸图 |
| `万用表爆炸图/` | 数字万用表：Blender 脚本建模 + 原理爆炸图 |
| `AI服务器爆炸图/` | 8U 八卡 HGX 训练服务器：Blender 脚本建模 + 原理爆炸图 |
| `四缸发动机爆炸图/` | 2.0L DOHC 16V 直列四缸：Blender 脚本建模 + 原理爆炸图 |
| `电流怎么转动磁场/` | 零基础电机课：指南针 → 线圈 → 三相 → 扭矩转速 → 逆变器，九步互动，纯 2D 单文件 |
| `电动车电机调速/` | 三合一电驱：Blender 脚本建模 + dq 仿真网页，十章讲扭矩和转速控制 |
| `按D到闪现/` | 通信原理教学：按 D 到闪现的 12 站往返，猜题 + 分步动画 + 三个延迟实验，纯 2D 单文件 |
| `无尘室空气过滤/` | 半导体无尘室空气过滤：Blender 脚本建模（厂房剖面/FFU/MAU）+ 三维气流 + 四个原理实验，单文件页面 |
| `软件定义汽车/` | 教学车：Blender 脚本建模（按车框 → 车板 → 玻璃 → 座椅 → 内饰的顺序，用 `blender/carkit.py`；外形是五条沿车长的曲线 + 超椭圆收口，比例照 2025 年主流电动轿车的公开参数，依据和查出过的问题写在它的 README 里；调外形用 `--noexport --check 机位` 只渲检查图）+ 三代 E/E 架构的线束计算，八章讲 SDV 和经典研发的区别，单文件页面；`trim` 组是贴在车身上的内饰板，`web/src/stage.js` 里和 shell / frame / cabin 并列 |
| `汽车建模套件/` | 汽车类 Blender 建模的共用函数 `carkit.py`（外皮、按片展开、侧窗区布置、帽形车框、车板留缝 + 三维量缝、玻璃 + 胶条、座椅、门板扶手 `door_ridge`、沿车宽拉伸 `xloft`、正视投影画灯和车牌 `face_patch`）；每个项目复制一份到自己的 `blender/`，改了回写母版。先读它的 README；1.2 版加了直板造型用的 `fillet_section`（“直线 + 圆角”截面）和 `Skin.crease_lines`（棱线当约束边），`软件定义汽车/` 里的副本还是 1.1 |
| `汽车模拟器/` | 直线造型的老式三厢教学车（原创，不照某款真车改），1.5 L 四缸 + 液力变矩器 + 钢带 CVT，**能直线开的模拟器**（单文件 `index.html`，能坐进驾驶位）：`params.json` 是唯一参数表（`place` / `engine` / `cvt` 给建模，`vehicle` / `sim` 给仿真）；`blender/shape.py` 定外形，`build_car.py` 建车身，`powertrain.py` 建动力系统（会动的件各是一个物体，原点在转轴上，extras 里的 `shaft` / `kind` 说明怎么动），建完量间隙写进 `out/spec.json`；`web/src/core.js` 是仿真（发动机查表 + Willans 油耗、变矩器 + 锁止、按目标转速调速比、整车纵向），`web/test_core.mjs` 自检（含“模型和 params.json 是不是同一份”）；`stage.js` 让零件按转速动、按速比重摆钢带，五种视图（第五种“驾驶位”：机位在 `spec.cockpit.eye`，OrbitControls 半径夹成 1 cm 当转头用，路是 `_buildWorld` 里的实例化网格）；`main.js` 是仪表、图、文字，车里表盘和挡位面板上的字画在 `stage._canvasPlane` 给的画布上；`build_car.py` 的 `build_cabin` 按 `params.json` 的 `cockpit`（H 点、眼点、踏板行程、挡杆倾角）摆驾驶位，仪表的高度按“视线穿过方向盘气囊盖和轮圈之间的缝”算，结果写进 `spec.cockpit`，自检会查；`node build.mjs` 打包。改了 `place` / `engine` / `cvt` / `cockpit` 要先重跑 `build_car.py` 再打包。方向盘是单独的件但还不转，转向、悬架还没做；方案、进度、等用户定的事都在 `规划.md`，动手前先读 |
| `湿法浓度计原理/` | 半导体湿法浓度计九种原理：Blender 脚本建模（9 个 GLB）+ 原理实验 + 公开专利卡片；`site/` 是分文件源码，`build_offline.py` 打包成单文件 `index.html` |
| `湿法温调器原理/` | 半导体湿法液体加热器七种方式 + 温调器（PID / SSR / 安全互锁）：Blender 脚本建模（8 个 GLB）+ 11 个原理实验 + 30 件公开专利卡片；结构同 `湿法浓度计原理/` |
| `液体调压阀/` | 湿法设备的液体调压阀：Blender 脚本建模四种阀的剖切 + 闭环供液线（参照公开专利），三个实验讲下垂、开环/闭环、背压阀，单文件页面 |
| `湿法设备流量计/` | 半导体湿法设备流量计：Blender 脚本建模（虚构清洗台 + 九种流量计剖面）+ 八个原理实验 + 专利拆解，单文件页面 |
| `超声波流量计参数实验室/` | 时间差式 PFA 超声波流量计的**参数**教学（和 `湿法设备流量计/` 互补，那边讲九种原理）：`blender/build_flowmeter.py` 建 U 形检测器 + 变换器 + 手动阀（导出 `model/flowmeter.glb`，网页按节点名找件，名字列在它的 README），`src/main.js` 一个文件包含仿真信号链（时间差 → 零点 → 分布修正 → 阻尼 → 小流量切除 → 错误处理 → 4-20 mA / 频率 / 脉冲 → 报警）、three.js 场景和十个关卡 `LEVELS`；`python build.py`（esbuild）打包成单文件 `index.html`；K 系数和药液物性是示意值，参数范围引用的厂家资料写在第 9 关表里 |
| `气体调压阀/` | 气体 regulator：Blender 脚本建模八种剖面（参照公开专利）+ `web/src/core.js` 力平衡 / 电子控制器仿真；**每种一页**（`pages/A-spring.html` … `H-piezo.html`，入口 `index.html`），每页猜题 → 分步手册 → 弹簧动不动 → 实验 → 失效条件，文案在 `web/src/teach.js`（步骤的滑块改动相对默认值）；`build.mjs` 把 `regulators.glb` 按台拆开塞进各页；`web/test_teach.mjs` 校验文案里的数字；和 `液体调压阀/` 互补（那边讲液体侧） |
| `半导体湿法设备的泵/` | 湿法用的五种泵：Blender 脚本建模（参照公开专利）+ 剖切三维（切面上色）+ 七个原理实验，八章，单文件页面；`web/test_sim.mjs` 校验模型和文案 |
| `飞度混动原理/` | 本田飞度 e:HEV 两电机混动：Blender 脚本建模（整车 + 发动机 / 双电机 / 离合器 / 齿轮 / PCU / 电池）+ `web/src/sim.js` 能量模型和试驾仿真，八章讲三种模式、直驱为什么在高速更省；`web/test_sim.mjs` 校验齿比和策略分工 |
| `踏板摩托车动力系统/` | 踏板车发动机和动力系统：Blender 脚本建模四台（四冲程单元摆动总成带电控 CVT / 传统起动 / 轻混三套变体、二冲程、轮毂电机、摆臂电机，参照公开专利）+ `web/src/sim.js` CVT 力平衡 / 离心离合器 / 整车模拟 / 空气-燃油-能量模型，十五章（含油门、转速和功率、热值和油耗三章零基础讲解：先猜题、分步算式），单文件页面；`web/test_sim.mjs` 校验模型和文案；文案里的章号用 `CH('id')`，不要写死 |
| `GPIO引脚实验台/` | 零基础 GPIO 课：Blender 脚本建模一块虚构开发板 + 十关实验（电平、两个开关、寄存器、数的写法、地址、代码、改一位、输入、踩坑、开漏和读改写），一关只引入一个新概念，`web/src/core.js` 是虚构教学芯片 T8 的模型，单文件页面；`web/test_core.mjs` 校验模型；`规划.md` 是动手前定的方案 |
| `一条指令到手指/` | whj_MCU 项目的全程课：跟着一条指令“食指弯到 45°”从电脑走到指尖，零基础十五关（标定、数据包、UART、M7C 转发、电平转换、241 合线、ID 认领、TXEN 松手时机、舵机闭环、线轴腱绳、预紧回差、时间账、六块 M7C、排查题）；Blender 脚本建模三个（桌面全景 / 舵机剖视 / 一根手指，`blender/out/layout.json` 给网页坐标），`web/src/core.js` 是唯一的数字来源，`web/test_core.mjs` 拿 whj_MCU 里的已知数据包和时间表校验；每关末尾的“依据”分公认 / 手册 / 仓库实测 / 推断 / 估算，改文案时保持；关卡顺序只在 `web/src/main.js` 的 `CHAPTERS` 里定，文案里提到别的关用 `lv('key')`，不要写死数字；`规划.md` 是动手前确认的方案和后来的改动记录 |
| `车钻铣三合一机床/` | 参照 CT125E 的车钻铣三合一微型机床：Blender 脚本建模（运动组 G_Spin / G_LeadScrew / G_Carriage / G_Cross / G_Head 等，推测件 extras 里 guess=1）+ 九章讲车削、挂轮、电子挂轮（DDA 整数算法）、车螺纹对零点、钻铣、做零件（M6 螺栓 / M6 螺母 / 1/4″-20 相机螺丝，`web/src/work.js` 工件模型 + `jobs.js` 工艺步骤，切削都是取最小 / 最大所以跳步 = 前面每步 play(c,1)）、参数、11 件公开专利；`web/src/core.js` 是唯一的数字来源，`web/test_core.mjs` 自检（含三个零件的尺寸）；每章“依据”分公认 / 参数表 / 推测 / 假设 |
| `行星锥盘无级变速器/` | MB / UDL 型机械无级变速器（照片里带手轮的那种）：Blender 脚本建模电机 + 变速器（`params.json` 是 Blender 和网页共用的唯一参数表），转的件在网页里用裁剪平面剖开、不转的件出 `__cut` 剖切版；`web/src/core.js` 几何 / Willis 速比 / 碟簧 + 离心力 / 两圈接触打滑 / 电机限制，`web/test_core.mjs` 校验（含零件间隙）；七章 + 11 件专利卡片，结论分公认 / 资料 / 推断 / 估算，单文件页面 |
| `现代建筑工地/` | 原创 248 m 超高层工地（2026 年，守 250 m 限高）的 **4D 施工进度演示**（单文件 `index.html`）：Blender 脚本建模，`params.json` 是唯一参数表（含工期 `schedule`）；`blender/tower.py` 主楼（每层每类一个物体，extras `stage` / `floor`，楼层号约定见 README），`blender/zaoloji.py` 造楼机（参照中建三局长江中心轻量化集成平台：贝雷片平台、12 支点、7 层挂架、大钢模、布料机，原点在墙顶 TOC），`blender/build_site.py` 总入口（导出 `tower.glb` / `zaoloji.glb` / `site.blend` / `spec.json`，`--render` 出预览图，`--views` 只渲指定机位）；`web/src/core.js` 进度模型（按天算各工种层数、核心筒循环四步、造楼机位置和油缸行程、基坑深度），`web/test_core.mjs` 自检，`stage.js` 显隐 / 墙长出来 / 钢筋笼 / 活塞杆自己画（glb 里的 `ZLJ_CylRods` 隐藏）/ 基坑地连墙内支撑围挡现场生成，`main.js` 文案和竖向流水图；`blender/machines.py` 建机械 / 车辆 / 工人 / 临建原型（导出 `machines.glb`，会动的件是单独节点、原点在转轴、extras 写 kind / axis），`web/src/life.js` 让它们按阶段在场、按真实时间动（车辆路线和停靠点、挖机姿态循环、塔吊吊装循环和钢丝绳、施工电梯、实例化工人；塔吊吊的钢柱钢梁用和 `tower.py` 同一套坐标落到第 counts.steel+1 / counts.column+1 层，落位的件实例化留在原处，那层显示了就清掉），`web/src/works.js` 是楼层和地下室工序（正在做的那层换“揭开”材质：着色器按沿楼层一圈的周长 s 或沿 x 丢片元、浇筑前沿压深；楼承板 / 钢筋 / 浇筑 / 幕墙逐块、临边栏杆和安全网、满堂支模架、单轨吊；`stat` 给侧栏“现在在干的工序”，`crew` 给工人站位，`pour` 给泵车对准；不受“机械和人”开关影响，在 `stage.frame` 里先于 life 更新），`web/src/tour.js` 是自动导览（`makeStations` 一站一条：工期区间 + 时长 + 解说 + 镜头函数，Blender 坐标；要卡机械动作的站写 `t0`；镜头走 `stage.setTourCam`，画面按字幕条高度上移、窄屏自动放宽视角；改了站点或镜头用 `?station=N&u=0.5` 逐站截图看有没有穿模；`?tour=1` 自动开始，`&clean=1` 只留画面），`web/src/smart.js` 是智能建造（无人机 + 机场、机器狗步态、绑扎 / 焊接 / 打磨机器人、全站仪、雾炮 + 扬尘联动、大屏和监测屏的画布；`present()` / `target()` 给侧栏“智能建造”跟拍用，`stage.setTrack`），共用小工具在 `util.js`；网址参数 `&track=设备` 跟拍、`&t=秒` 钉住机械时间（截图用）；`web/build.mjs` 先 meshopt 压缩 glb（`compress.mjs`，量化后 mesh 节点会带变换，动画一律在初始变换上叠加）再打包；改了模型要先重跑 Blender 再 `node build.mjs`；`建模清单.md` 是 A~G 七类模型的清单和完成状态（周边楼群、裙楼、卸料平台还没做），`参考资料.md` 写每个尺寸和工期的依据（资料 / 推断 / 假设） |
| `数字工厂/` | DF-01 新能源总装车间三维数字孪生（three.js r160 程序化建模，无 Blender，单文件 `index.html`）：`src/layout.js` 是共享契约（坐标、结构轴线 `LBX` / `ICOL`、分区、21 个工位的信标和拾取盒、压机位置 `PRESS_X`、空中输送线 `OC_W` / `OC_E` 和吊杆位置、视角、巡游分镜 `TOUR`，`via` 是避穿模途经点），`src/sim.js` 是 HUD 和三维共用的唯一数据源 `SIM`（设备按 `SIM.speed(id)` 减速 / 停），场景模块 building / process / logistics / assembly / data 都往 `ctx.B`（静态：同材质单位盒实例化 + 几何合并）和 `ctx.P`（实例化零件，节点是不进场景的 Object3D，每帧 `P.sync()`）里加东西；车身流在 `process.js`：白车身一条 `Flow`，漆后车身两条 `Flow` 共用干线（同速同间距错半个间距），速度 = 间距 / 节拍，落到 2.4 m 高交给总装线，总装线初始车位按 `ctx.lineHeadPhase` 对齐；`src/tourmath.js` 是巡游采样（纯数学，`qa/campath.mjs` 用同一份）；`src/audit.js` 是穿模审计（`DF.audit()`，快进仿真做有向包围盒相交）；相机 `CamRig`（`studio.js`）的 `off` 是画面中心横向偏移，`main.js` 的 `layoutOffset` 按 HUD 面板算；inspector 接在左侧分区索引下面；发光体颜色乘到 1 以上才会 bloom（阈值 1.0）；`node build.mjs` 用 esbuild 把 src + three 打成 IIFE 内联进 `src/shell.html` → `index.html`；QA：`qa/campath.mjs`（运镜离桁架 / 灯带 / 输送线 / 设备 ≥ 0.9 m）、`qa/clearance.mjs`（动件不钻进别的东西，允许接触的组合列在脚本的 `OK` 里）、`qa/regress.mjs`（38 项交互回归）、`qa/tour.mjs`（9/9 章节 + 无缝）、`qa/flicker.mjs`（暗背景帧间差 = 0），截图 `qa/views.mjs` / `qa/tourshots.mjs`；改了设备位置、输送路线、柱网、灯带、吊杆、巡游关键帧要重跑 `campath` 和 `clearance`；性能预算 draw call < 400、三角面 < 1.2M（含阴影一遍） |
| `立体车库原理/` | 6 种立体车库（简易升降 / 升降横移 / 垂直循环 / 巷道堆垛 / 塔库 / 平面移动）的交互页，three.js 程序化建模（无 Blender），单文件 `index.html`：`web/src/garages/*.js` 一种车库一个文件，只做调度逻辑和外形描述（不 import three），存 / 取车输出步骤列表（每步 = 一句讲解 + 同时开始的动作 move / turn / loop / spawn / remove，`state` 是这一步做完后的文字状态图）；`motion.js` 是插值和跑道形链条路径；`scene.js` 的 `Ctx` 搭场景、`play(step).tick(模拟秒)` 播放；`main.js` 是界面，司机视角流程是 async 函数，终端按钮用 `waitChoice()` / `choose(v)` 等用户；`web/test_garages.mjs` 每种随机存取 1500 次，核对不变量和“动画执行到底的位置 = 逻辑位置”；`node build.mjs` 打包到 `../index.html`；网址参数 `?type=0~5&mode=lab`；速度、占地是示意值 |
| `4位CPU互动教学/` | 4 位玩具 CPU（开源项目 SimDaSong/4-bit-cpu 的指令集，9 条指令、8 个寄存器）的零基础课，纯 2D 单文件 `index.html`：`web/src/core.js` 是 CPU 模型（汇编器、控制字查表 `CONTROL_ROM`、全加器 ALU、`preview()` 算这一拍每根线的值 / `commit()` 是时钟沿），`teach.js` 是五小步的说人话 / 电路细节文字和预测题，`chapters.js` 是 12 章（选择题 + 讲解 + 示例程序，讲解里【源码】【通识】【推断】标证据强弱，改文案时保持），`main.js` 用 SVG 画数据通路（坐标系 920 × 480，`style(name, phases)` 定每根线在第几步变橙）；`web/test_core.mjs` 自检；`node build.mjs` 打包到 `../index.html`；网址 `#章号` 直接打开某章 |
| `电梯调度算法/` | 单台电梯 FCFS / SSTF / SCAN / LOOK 调度的动画页，纯 2D 单文件 `index.html`（由 `src/` 内联，`node build.mjs`，不需要装包）：`src/algorithms.js` 是纯函数（`stops()` 到站停不停、接谁；`decide()` 不停时去哪，返回带讲解的 `reason`；外呼 up / down、内呼 car，SCAN / LOOK 只顺路接同方向外呼），浏览器和 Node 通用；`src/app.js` 是实时模拟、轨迹图、离线对比；`tests/algorithms.test.js` 用教材磁盘调度例子 + 2000 组随机场景校验；改了 `src/` 要重新打包 |
| `Copilot检索提示词/` | 不是程序，只有一个 README：给 Microsoft 365 Copilot（Work IQ）查邮件 / Teams / 文件用的提示词模板，中文和日文各一版（查某版本的功能、查变更历史、两步法、自定义指令一句话）；模板里只用【客户X / 分支Y / 功能Z】占位，不写真实名称 |

通用约定：
- 回答用中文。
- 写程序要带 Windows 一键启动 `.bat`，bat 里先 `git pull --ff-only origin main` 检查更新。
- bat 文件只写 ASCII（中文注释会因为代码页乱码），CRLF 换行。
- 涉及 MyVRToyBox（虚幻工程）的导出脚本仍指向用户本机的 MyVRToyBox 工程，和放在哪个仓库无关。
