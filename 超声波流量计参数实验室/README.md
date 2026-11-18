# 超声波流量计参数实验室

时间差式 PFA 超声波流量计的交互教学页：3D 模型（Blender 脚本建模）+ 信号链仿真。
把阻尼、小流量切除、零点调整、满量程/4-20 mA、上下限报警（回差/延时/NO·NC）、脉冲当量/积算/定量补液、动粘度修正、气泡与错误输出，一关一关拆开演示。

## 使用
- Windows：双击 `启动演示.bat`（先 `git pull --ff-only origin main` 检查更新，再打开页面）
- 改了建模脚本：双击 `重新生成模型.bat`（找本机 Blender 重建 `model/flowmeter.glb`），再 `npm install` + `python build.py` 重新打包
- 或者直接双击 `index.html`。单文件，离线可用（three.js 和模型都已内嵌）

## 文件
| 文件 | 说明 |
|---|---|
| index.html | 成品页面（单文件离线版） |
| 启动演示.bat / 重新生成模型.bat | Windows 一键启动 / 重建模型 |
| model/flowmeter.glb | Blender 导出的模型 |
| model/preview.png | Blender Cycles 预览渲染 |
| blender/build_flowmeter.py | 建模脚本：`blender -b -P blender/build_flowmeter.py`（或 `pip install bpy` 后 `python blender/build_flowmeter.py`） |
| src/main.js, src/template.html | 页面源码（仿真 + three.js） |
| build.py | 重新打包：`npm install` 后 `python build.py` → 生成 index.html |

## 说明
- 模型是原创通用造型，不对应任何厂家具体产品。
- 分布修正系数 K、药液物性、噪声大小是教学示意值；参数范围引用自东京计装、东フロ、基恩士、富士电机、Levitronix 公开资料，实际以所用机型说明书为准。

## 结构备忘（给以后改的人）
- `src/main.js` 一个文件：物理常数 → 仿真 `step(dt)`（每 10 ms 一步，信号链顺序：时间差 → 零点 → 分布修正 → 阻尼 → 小流量切除 → 错误处理 → 4-20 mA / 频率 / 积算脉冲 → 报警 → 阶跃测试 / 定量补液）→ 趋势记录 → three.js 场景 → 面板 / 趋势图 → 控件定义 `C` → 关卡 `LEVELS`。
- 关卡顺序只在 `LEVELS` 里定；网址 `#关卡id`（principle / zero / damping / lowcut / output / alarm / pulse / visc / bubble / table）直接打开某一关。
- 模型里网页用到的节点名：MeasureTube、PFABody、Piezo_A/B、LCD、LED_H / LED_L / LED_ERR / LED_PULSE、ValveHandle、Pipe_In/Out。改建模脚本时别改这些名字。
- 测试时 `window.__step(dt)` 可以跳过动画直接推仿真，`__S` / `__P` 是状态和参数。
