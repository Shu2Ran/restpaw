'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { CatPicker } = require('../src/engine/cat-picker');

test('两只猫长期严格 50:50 平衡', () => {
  const p = new CatPicker(['a', 'b']);
  let a = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) if (p.pick() === 'a') a++;
  assert.equal(a, N / 2, `${N} 次取样应完全均分，实际 a=${a}`);
});

test('绝不出现连续 3 次同猫（袋内只有 2 只）', () => {
  const p = new CatPicker(['a', 'b']);
  const seq = [];
  for (let i = 0; i < 3000; i++) seq.push(p.pick());
  for (let i = 0; i < seq.length - 2; i++) {
    assert.ok(
      !(seq[i] === seq[i + 1] && seq[i] === seq[i + 2]),
      `第${i}位出现连续3次同猫: ${seq.slice(i, i + 3).join(',')}`
    );
  }
});

test('任何连续 4 次取样两只猫都各出现 2 次', () => {
  const p = new CatPicker(['a', 'b']);
  const seq = [];
  for (let i = 0; i < 500; i++) seq.push(p.pick());
  for (let i = 0; i < seq.length - 3; i += 4) {
    const win = seq.slice(i, i + 4);
    assert.equal(win.filter((x) => x === 'a').length, 2);
    assert.equal(win.filter((x) => x === 'b').length, 2);
  }
});

test('三只猫时袋内各 3 只，总量 9', () => {
  const p = new CatPicker(['a', 'b', 'c']);
  const seq = [];
  for (let i = 0; i < 9; i++) seq.push(p.pick());
  assert.equal(seq.filter((x) => x === 'a').length, 3);
  assert.equal(seq.filter((x) => x === 'b').length, 3);
  assert.equal(seq.filter((x) => x === 'c').length, 3);
});

test('同轮出现两只猫的比例约 67%，明显高于纯随机的 50%', () => {
  let both = 0;
  const N = 3000;
  for (let t = 0; t < N; t++) {
    const p = new CatPicker(['a', 'b']);
    if (p.pick() !== p.pick()) both++;
  }
  const bagRate = both / N;
  assert.ok(bagRate > 0.6, `抽签袋同轮双猫比例应 >60%，实际 ${(bagRate * 100).toFixed(1)}%`);
});

test('跨袋保护不破坏袋内自然分布（相邻对仍约 67% 不同猫）', () => {
  const p = new CatPicker(['a', 'b']);
  const seq = [];
  for (let i = 0; i < 4000; i++) seq.push(p.pick());
  let diff = 0;
  let tot = 0;
  for (let i = 0; i + 1 < seq.length; i++) {
    diff += seq[i] !== seq[i + 1] ? 1 : 0;
    tot++;
  }
  const rate = diff / tot;
  assert.ok(rate > 0.55 && rate < 0.75, `相邻对不同猫应接近 66.7%，实际 ${(rate * 100).toFixed(1)}%`);
});

test('无猫可用时返回 null', () => {
  assert.equal(new CatPicker([]).available, false);
  assert.equal(new CatPicker([]).pick(), null);
  assert.equal(new CatPicker(null).pick(), null);
});

test('reset 清空袋子后重新洗牌', () => {
  const p = new CatPicker(['a', 'b']);
  p.pick();
  p.pick();
  p.reset();
  assert.equal(p.bag.length, 0);
  assert.ok(['a', 'b'].includes(p.pick()));
});