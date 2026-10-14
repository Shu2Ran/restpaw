'use strict';

/**
 * 抽签袋换猫策略
 *
 * 目标（两只猫时的数学保证）：
 *   - 绝对公平：每 4 次取样两只猫各出现 2 次，长期严格 50:50
 *   - 不会连续 3 轮同猫：袋内单只猫最多 catCount 个，抽完必换
 *   - 看起来随机：每轮重新洗牌，顺序不可预测
 *   - 3 只以上自动扩展为 [A×n, B×n, C×n]
 *
 * 纯函数，不依赖 Electron，便于单测。
 */

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class CatPicker {
  constructor(catIds, rnd) {
    this.ids = Array.isArray(catIds) ? catIds.slice() : [];
    this.rnd = typeof rnd === 'function' ? rnd : Math.random;
    this.bag = [];
    this.lastPick = null;
  }

  get available() {
    return this.ids.length > 0;
  }

  reset() {
    this.bag = [];
    this.lastPick = null;
  }

  _refill() {
    const n = this.ids.length;
    this.bag = [];
    for (const id of this.ids) {
      for (let i = 0; i < n; i++) this.bag.push(id);
    }
    shuffle(this.bag, this.rnd);
    // 跨袋保护：新袋「最后被 pop 的元素」(tail) 紧接着上一袋最后 pop 的元素，
    // 若两者相同，就把 tail 与袋内一个不同的元素交换——只动这一个位置，
    // 不扰动袋内其余顺序，从而保住「袋内相邻对 66.7% 不同猫」的自然分布。
    if (this.lastPick !== null && this.ids.length > 1 && this.bag.length > 1) {
      const tail = this.bag.length - 1;
      if (this.bag[tail] === this.lastPick) {
        for (let i = 0; i < tail; i++) {
          if (this.bag[i] !== this.lastPick) {
            [this.bag[i], this.bag[tail]] = [this.bag[tail], this.bag[i]];
            break;
          }
        }
      }
    }
  }

  pick() {
    if (!this.available) return null;
    if (!this.bag.length) this._refill();
    const id = this.bag.pop();
    this.lastPick = id;
    return id;
  }
}

module.exports = { CatPicker, shuffle };