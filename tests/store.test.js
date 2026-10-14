'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../src/engine/store');

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restpaw-test-'));
  return new Store(dir);
}

test('默认配置与统计', () => {
  const store = makeStore();
  assert.equal(store.getConfig().workMin, 45);
  assert.equal(store.getConfig().roundsBeforeLong, 4);
  assert.equal(store.getConfig().autoStart, undefined, '已移除自动开始选项');
  const stats = store.getStats();
  assert.equal(stats.workRounds, 0);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(stats.day));
});

test('updateConfig 与 bump 落盘并可重新读取', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restpaw-test-'));
  new Store(dir).updateConfig({ workMin: 25, autoStart: false });
  const store2 = new Store(dir);
  assert.equal(store2.getConfig().workMin, 25);
  assert.equal(store2.getConfig().autoStart, false);

  store2.bump('shortRests');
  store2.bump('shortRests');
  store2.bump('skippedRests');
  const store3 = new Store(dir);
  assert.equal(store3.getStats().shortRests, 2);
  assert.equal(store3.getStats().skippedRests, 1);
});

test('旧版 stats.json（缺少新字段）补零且不清空已有计数', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restpaw-test-'));
  const day = new Date();
  const dayStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  fs.writeFileSync(
    path.join(dir, 'stats.json'),
    JSON.stringify({ day: dayStr, workRounds: 3, shortRests: 2, longRests: 0, skippedRests: 1 })
  );
  const store = new Store(dir);
  const s = store.getStats();
  assert.equal(s.day, dayStr, 'day 不能被当作数字字段清零');
  assert.equal(s.workRounds, 3);
  assert.equal(s.shortRests, 2);
  assert.equal(s.skippedRests, 1);
  assert.equal(s.skippedWorks, 0, '新增字段补零');
});

test('状态存取', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restpaw-test-'));
  const store = new Store(dir);
  assert.equal(store.getState(), null);
  store.setState({ phase: 'work', round: 2 });
  assert.equal(new Store(dir).getState().round, 2);
});
