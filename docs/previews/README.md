# README 预览动图

根目录 README 里每个在线页面旁边的动图都在这里，文件名和 `tools/plan.json` 里的名字一一对应。

## 怎么来的

`tools/record.js` 做三件事：

1. 在本机起一个静态文件服务器，根目录就是仓库根目录，所以打开的就是 GitHub Pages 上会发布的同一份文件。
2. 用 Playwright 的无头 Chromium 打开页面，按 `plan.json` 里写好的步骤点几下（切章节、拖动三维模型、滚动），同时录屏。没有显卡的机器用 SwiftShader 软件渲染 WebGL，所以重的页面（比如干法刻蚀机）会卡，脚本会把过长的片段加速到 9 秒以内。
3. 用 ffmpeg 把录屏转成 GIF：440 px 宽、每秒 6 帧、48~80 色调色板。这样每张大约 0.2~0.8 MB，13 张合计约 6.5 MB。

## 重新录

- Windows：双击 `record_previews.bat`（先 `git pull` 检查更新，第一次会自动装 Playwright）。只录某几张：`record_previews.bat pump flash`。
- 其他系统：`node docs/previews/tools/record.js [名字 ...]`，需要 Node.js、`playwright` 和 ffmpeg。

页面改版后，按钮文字变了的话步骤会点不到（终端会打印"没成功"），改 `plan.json` 里对应的文字就行。

## 体积怎么调

GIF 体积主要看三个数：宽度、帧率、颜色数（`record.js` 顶部的 `GIF_W`、`FPS`，`plan.json` 里每页的 `colors`）。三维页面画面变化大、颜色多，压得最狠；纯 2D 页本来就小。
如果以后嫌 GIF 太大，可以换成 MP4/WebM（体积能小 5~10 倍），但 GitHub 的 README 里视频不会像 GIF 那样自动循环播放，所以这里先用 GIF。
