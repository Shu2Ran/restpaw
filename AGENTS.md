# RestPaw（休息小助手）— Agent 须知

离线单机 Electron 番茄钟，托盘常驻。纯 CommonJS，无框架、无打包器、无 linter、无 typecheck、无测试框架（用 `node:test`）。

## 边界

- **只在本目录 `timer/` 内读写**（`docs/休息小助手方案.md` 明文规定）。父目录 `AI-helper/` 是另一个项目（Excel 协议转换），别碰。
- 是本地 git 仓库（无远端），分支 `main`。改动前先 `git status` 看干净不干净；一个功能一件事一次提交。
- 界面与文档全中文；代码注释也用中文。

## 命令

```bash
npm test              # node --test → tests/*.test.js，63 条引擎/存储/抽签袋/路径单测（无 Electron 依赖）
node tools/ui-smoke.js 弹窗   # 只跑名字含「弹窗」的端到端用例（共 25 条）
npm run test:ui       # 跑全部 UI 端到端（Playwright 驱动 Electron）
npm start             # 先重建图标再 electron .
npm run icon          # tools/make-icon.js，纯 zlib 手绘，产出 build/icon.{png,ico}
node tools/build-cats.js   # 猫图素材管线，需要系统 ImageMagick（convert/identify），非 npm 依赖
npm run dist:win      # 产物 out/休息小助手 <版本号>.exe（约 100MB）
npm run dist:linux
```

**打包必须先设镜像**，否则会卡死 10 分钟后超时（`Timeout awaiting 'request' for 600000ms`，卡在 `downloaded label=electron progress=100%` 之后）：

```bash
export ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
npm run dist:linux
```

原因：`github.com` 在本机时通时不通（`releases/download` 路径尤其容易连上就卡死），而 `objects.githubusercontent.com`、`registry.npmmirror.com` 都正常。**注意这跟测试无关**——`tools/ui-smoke.js` 用 playwright 的 `_electron.launch()` 直接跑 `node_modules/electron/dist/electron` + 源码目录，全程不经过 electron-builder、不下载任何东西。

UI 用例名是中文子串匹配的（`process.argv[2]`），改用例名会改掉过滤关键字。

## 会直接把你卡住的坑

1. **开着 RestPaw 时什么都跑不起来。** `app.requestSingleInstanceLock()` 在 `src/main.js:12` 执行，早于 `RESTPAW_USER_DATA` 覆盖（`:20-26`），所以单例锁**永远锁在默认 userData `~/.config/休息小助手`**，跟 `RESTPAW_USER_DATA` 无关。只要有实例在跑（`ps aux | grep restpaw`，注意已安装的 AppImage/exe 也算），`npm start` 和**每一条** ui-smoke 用例都会以 exitCode=0 瞬间退出，Playwright 报 `Target page, context or browser has been closed`——**不是测试挂了，是没跑起来**。先杀掉在跑的实例。
2. **`tools/ui-smoke.js` 里硬编码了绝对路径** `'/data/usershare/AI-helper/timer'`（第 8、477、504 行）。移动或复制仓库后 `npm run test:ui` 必挂，要改成 `path.join(__dirname, '..')`。
3. **`npm run dist:*` 会联网且必须设镜像**（见上方「命令」节），`github.com` 连不通时会静默卡 10 分钟才报错。
4. **`src/ui/common.css` 是唯一的样式文件**，三个页面都 `<link href="common.css">` 引用同目录的这一份。根目录曾有一份同名死副本（无任何引用），已于 2026-10-14 删除，别再在根目录建。
5. **开机自启：只有 Windows 真的能用。** Electron 的 `app.setLoginItemSettings` / `getLoginItemSettings` **在 Linux 是空操作**——实测传 `openAtLogin: true` 等 1.5s 再读仍是 `false`，且 `~/.config/autostart/` 什么都没写。所以：① 决策逻辑做成了纯函数 `src/paths.js` 的 `buildLoginItemOptions(cfg, env, execPath)` 交给单测覆盖，**别再写基于该 API 的 Linux UI 用例，注定失败**；② **`PORTABLE_EXECUTABLE_FILE` / `PORTABLE_EXECUTABLE_DIR` 只有 Windows portable（NSIS 启动器）会注入**——AppImage 的 `AppRun` 里没有，`npm start` 也没有，所以那个 path 修复实际只对 Windows exe 生效；③ 设置页的「开机自动启动」在 Linux 上**只落库不生效**，这是**已知未实现项**（要做就自己写 `~/.config/autostart/*.desktop`），别以为它坏了反复排查。真机行为仍需在 Windows 上人工验证一次。
6. `docs/休息小助手方案.md` §3.3 的窗口尺寸已于 v2.2 订正，**以 `src/windows.js` 为准**（popup 380×352、panel 340×556、settings 372×560）。

## 架构约定（不读代码看不出来的）

- 主进程是唯一状态源。`src/engine/*`（pomodoro / store / cat-picker）**必须保持零 Electron 依赖**，`Pomodoro` 通过构造参数注入时钟（`new Pomodoro(cfg, onEvent, now)`），`node --test` 靠这个才能脱离 Electron 跑。
- 时间一律存**绝对 deadline 时间戳**，不是倒计时差值——这样系统休眠/杀进程重启都不丢进度。改状态机时不要引入「每秒减一」。
- 渲染进程**不持有状态**。主进程每秒 `broadcast('state', ...)`，页面只负责渲染；`src/preload.js` 只暴露 `window.api.call(name, arg)` 和 `window.api.onState(cb)`。
- 所有用户操作收敛到 `src/main.js` 的**单个** `ipcMain.handle('cmd', ...)` switch。加一个新动作 = 在这里加 case + 在页面里 `window.api.call('cmdName')`。
- 弹窗渲染哪一块由主进程算好的 `prompt` 字段决定（`currentPrompt()`，`main.js:135`），页面**不得**自己从 `phase/awaiting` 推导。
- 关窗口 ≠ 退出：`src/windows.js` 拦截 `close` 事件改成 `hide()`，只有 `wm.setQuitting(true)` 后才真关。

## UI 约定

- 三个窗口就是三个独立 HTML + 内联 `<script>`，共用 `src/ui/common.css`；猫形象走 `src/ui/mascot.js`（读 `assets/cats/manifest.json`，图片加载失败自动回退内联 SVG 猫）。
- **每个页面都要保留 `window.__lastState = s`**（popup/panel/settings 都有）——UI 测试全靠它断言。
- **DOM id 是测试契约**，别随手改：`#btn-toggle`、`#btn-skip`、`#btn-save`、`#btn-break`、`#btn-early`、`#btn-work`、`#m-work`、`#mascot`、`#worked-label`、`#worked-fill`、`#mute-badge`。
- 按钮文案/命令由阶段决定时，看 `panel.html` 的 `skipAction(s)`，标签与 `data-cmd` 要一起改。

### 猫的眨眼（v2.2 重写，改之前先读）

`mascot.js` 的眨眼调度有三条**不能破**的约束，破一条就会出现「休息时两只猫不停变化」：

1. **不许闭包捕获 `mood` / `catId`** —— 触发时现读 `moodOf(el)` 和 `activeCat`。捕获旧值会让工作期排下的链子一直拿换猫前的猫画图，和面板每秒的重绘交替。
2. **进闭眼心情（`CLOSED_MOODS`）必须主动 `clearBlink(el)`** —— `render()` 只在非闭眼心情排程，不清的话残留链子会活下来。
3. **`scheduleBlink` 里必须有 `if (blink.has(el)) return;` 守卫** —— 面板每秒调一次 `mount()` → `render()`，没有守卫计时器会被无限重排，**眨眼一次都触发不了**。

另外 `fireBlink` 画上闭眼图后必须**立刻同步 `el.dataset.src`**，否则在 260ms 窗口内切进休息会被 `clearBlink` 砍掉恢复定时器，留下「闭眼图 + 过期 dataset」。

### CSS 动画陷阱（v2.1.1 踩过）

- 同一元素上多个动画只要动**同一个 transform 属性**就会按列表顺序互相覆盖：所以 `breathe` 只写 `scale`、`sway` 只写 `rotate`、`stretch` 两个都写。改动画时保持这个分工。
- `animation-play-state: paused` 的动画**仍参与层叠**，会盖掉基础样式。所以 `.cat-hover` 是 `animation: none` + 静态 `scale/rotate` + `transition` 回弹。
- UI 测试现在断言的是**实际数值**（scale 波动 >0.02、rotate 波动 >3 等），不是「动画名存在」——后者对覆盖缺陷完全无效。写新动画断言照此办理。

## 持久化

userData（`~/.config/休息小助手`）下三个 JSON：`config.json` / `state.json` / `stats.json`。
- `state.json`：阶段切换、每次命令、以及每秒「签名变化」时落盘，另有 30s 兜底（`main.js:72`、`:360`）。落盘必须走 `Store._saveJSON` 的 tmp+rename 原子写。
- `stats.json`：带 `day` 字段跨天自动归零；旧文件缺新字段补零且**不能**把已有计数清空（有单测守着）。
- 启动时 `Pomodoro.isStaleSession()`：**只有跨天**（阶段开始时刻 < 今天零点）的会话才丢弃，同一天无论是否过期一律继承续跑。这个语义是用户明确要求的，别改。

## 流程

`docs/休息小助手方案.md` 是唯一权威方案，末尾有修订记录表。改行为前先跟用户确认，落地后在修订记录里加一行（日期 + 版本号 + 改动摘要 + 测试条数）。

## 版本号

**发布版本 = `Vx.y`**（当前 **V2.1**）。小数点**后**加一 = 该大版本内的小 bug 修复 / 功能迭代（V2.1 → V2.2）；小数点**前**加一 = 大版本修改，比如迭代出下一个版本（V2.1 → V3.0）。

`package.json` 里必须写合法 semver 三段（npm 与 electron-builder 都会校验，`2.1` 会被 electron-builder 的 `fixVersionField` 拒掉），所以 **V2.1 写作 `2.1.0`**，产物名也据此生成（`休息小助手 2.1.0.exe`）。改版本号时 `package.json` 和 `package-lock.json` 要一起改（`npm install --package-lock-only`）。

方案文末修订记录里的 `v1.0 / v2.1.1 / v2.2` 是**开发迭代流水号**，跟发布版本号不是一回事，别混淆。