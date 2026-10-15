# 猫素材目录（真实猫图不随代码分发）

本目录在运行时由 `src/ui/mascot.js` 读取 `manifest.json` 决定显示哪张猫图。

> **作者的真实猫形象是个人素材，不随本仓库分发**（根目录 `.gitignore` 已排除本目录下的
> `*.png` 与 `manifest.json`）。所以 fresh clone 下来的程序会**自动回退到内联手绘 SVG 猫**，
> 功能完全正常，只是长得不一样。

如果你想把程序换成**你自己的猫**，见项目根目录 `README.md` 的「换成你自己的猫」一节。
最简做法：

```
1. 准备两张 512×512 带透明通道的 PNG：<你的猫id>-open.png（睁眼）、<你的猫id>-closed.png（闭眼）
2. 拷进本目录
3. 在 manifest.json 的 cats 数组里加一项：
     { "id": "你的猫id", "open": "你的猫id-open.png", "closed": "你的猫id-closed.png" }
4. 重启程序
```

**没放也没关系**——`manifest.json` 缺失、为空数组、或图片加载失败时，都会自动回退到内联手绘 SVG 猫
（`tools/ui-smoke.js` 里有两条用例专门守着这个回退行为）。

本目录下的 `README.md` 会被提交，它解释了这里的约定。自动化测试用的合成替身素材在
`tests/fixtures/cats/`，与本目录无关。