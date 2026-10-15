# 合成猫素材（测试替身）

这里的 4 张 PNG 是**几何色块假猫**，由 `node tools/make-test-cats.js` 生成（纯 zlib 手写，零依赖），**不是任何真实的猫**。

## 为什么存在

本项目作者的真实猫形象属于个人素材，**不进版本库**（见根目录 `.gitignore`）。但下面这些自动化用例都需要「真实可加载的图片素材」才能跑：

- 两只猫随机（需要 manifest 里至少两只猫）
- 工作中眨眼（需要观察背景图在 open/closed 之间切换）
- 伸懒腰（`playStretch` 遇到 `cat-fallback` 会直接 return）
- 素材缺失 / 损坏时回退手绘 SVG 猫

所以提交这套合成素材做替身，让 fresh clone 上 25 条 UI 用例一条不少地跑完。

## 画法为什么这样

睁眼画成**实心圆点**，闭眼画成**横杠**——刻意做成肉眼可区分，这样「眨眼时短暂切到 closed 图」这类断言才真的在断言东西，而不是碰巧通过。

## 不要手改

改了 `tools/make-test-cats.js` 之后重新生成即可：

```bash
node tools/make-test-cats.js
```

## 真实猫图放哪

想让程序用你自己的猫，把图片放到 `src/ui/assets/cats/` 并在同目录的 `manifest.json` 里登记，详见 `src/ui/assets/cats/README.md`。