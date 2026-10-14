'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const Pomodoro = require('../src/engine/pomodoro');

const MIN = 60000;
const CFG = { workMin: 45, shortMin: 5, longMin: 15, roundsBeforeLong: 4, autoStart: true };

function makeEngine(overrides) {
  let t = 1700000000000;
  const events = [];
  const now = () => t;
  const cfg = Object.assign({}, CFG, overrides || {});
  const engine = new Pomodoro(cfg, (type, payload) => events.push({ type, payload }), now);
  const advance = (ms) => { t += ms; return t; };
  const types = () => events.map((e) => e.type);
  const last = (type) => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i].type === type) return events[i].payload;
    return null;
  };
  return { engine, events, advance, now, types, last };
}

test('初始为 idle，start 后进入工作阶段', () => {
  const h = makeEngine();
  assert.equal(h.engine.phase, 'idle');
  h.engine.start();
  assert.equal(h.engine.phase, 'work');
  assert.equal(h.engine.remainingMs(h.now()), 45 * MIN);
  assert.deepEqual(h.types(), ['started']);
});

test('工作结束触发 work-end 并停在 0 等待决策', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.awaiting, 'work-end');
  assert.equal(h.engine.remainingMs(h.now()), 0);
  assert.ok(h.types().includes('work-end'));
  assert.equal(h.last('work-end').nextBreak, 'short');
  assert.equal(h.engine.round, 1);
});

test('第 4 轮工作结束后进长休', () => {
  const h = makeEngine();
  h.engine.start();
  for (let i = 0; i < 3; i++) {
    h.advance(45 * MIN + 1000);
    h.engine.tick();
    h.engine.beginBreak();
    h.advance(5 * MIN + 1000);
    h.engine.tick();
    h.engine.beginWork();
  }
  assert.equal(h.engine.round, 3);
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.round, 4);
  assert.equal(h.last('work-end').nextBreak, 'long');
  h.engine.beginBreak();
  assert.equal(h.engine.phase, 'long');
  assert.equal(h.engine.remainingMs(h.now()), 15 * MIN);
});

test('跨天会话不继承，同一天必须继承', () => {
  const day = (d, h, m) => new Date(2026, 9, d, h, m, 0).getTime();
  const cfg = { workMin: 45, shortMin: 5, longMin: 15, roundsBeforeLong: 4 };

  // 昨天(10-12) 23:30 开始的 45 分钟工作轮，deadline 今天(10-13) 00:15
  const overnight = { phase: 'work', deadline: day(13, 0, 15), round: 3, awaiting: null };
  assert.equal(Pomodoro.isStaleSession(overnight, cfg, day(13, 9, 0)), true, '跨天的会话应丢弃');

  // 今天 09:00 开始、deadline 09:45（还没到点就退出又打开）
  const todayLive = { phase: 'work', deadline: day(12, 9, 45), round: 1, awaiting: null };
  assert.equal(Pomodoro.isStaleSession(todayLive, cfg, day(12, 9, 20)), false, '同一天未到点必须继承');

  // 今天 09:00 开始、deadline 09:45，但重开时已过点（同一天）
  const todayExpired = { phase: 'work', deadline: day(12, 9, 45), round: 1, awaiting: null };
  assert.equal(Pomodoro.isStaleSession(todayExpired, cfg, day(12, 10, 30)), false, '同一天过期也要继承');

  // 昨天(10-12) 23:58 开始的 5 分钟休息，deadline 今天(10-13) 00:03
  const overnightBreak = { phase: 'short', deadline: day(13, 0, 3), round: 2, awaiting: null };
  assert.equal(Pomodoro.isStaleSession(overnightBreak, cfg, day(13, 9, 0)), true, '跨天的休息轮应丢弃');

  // 等待决策中（昨天弹窗没处理）
  const waiting = { phase: 'work', deadline: day(13, 0, 15), round: 3, awaiting: 'work-end' };
  assert.equal(Pomodoro.isStaleSession(waiting, cfg, day(13, 9, 0)), false, '等待决策的会话保留给用户处理');

  // 空闲状态
  assert.equal(Pomodoro.isStaleSession({ phase: 'idle', deadline: 0, awaiting: null }, cfg, day(12, 9, 0)), false);
  assert.equal(Pomodoro.isStaleSession(null, cfg, day(12, 9, 0)), false);
});

test('跨天会话被丢弃后重新开始，轮数与工时归零', () => {
  let t = new Date(2026, 9, 12, 23, 30, 0).getTime();
  const saved = {
    phase: 'work',
    deadline: new Date(2026, 9, 13, 0, 15, 0).getTime(),
    round: 4,
    awaiting: null,
    workedMs: 5 * 60 * MIN,
    workedDay: '2026-10-12',
  };
  assert.equal(Pomodoro.isStaleSession(saved, { workMin: 45, shortMin: 5, longMin: 15, roundsBeforeLong: 4 }, t + 9 * 60 * MIN), true);

  const h = makeEngine();
  h.engine.reset();
  h.engine.workedDay = '2026-10-12';
  h.engine.workedMs = saved.workedMs;
  h.advance(9 * 60 * MIN);
  h.engine.tick();
  assert.equal(h.engine.phase, 'idle');
  assert.equal(h.engine.round, 0);
  assert.equal(h.engine.workedMs, 0, '跨天工时归零');
  h.engine.start();
  assert.equal(h.engine.remainingMs(h.now()), 45 * MIN, '从完整工作时长重新开始');
});

test('休息结束不自动开始，必须确认才开始工作', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  h.engine.beginBreak();
  assert.equal(h.engine.phase, 'short');
  h.advance(5 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.awaiting, 'break-end', '休息结束进入等待确认');
  assert.equal(h.engine.phase, 'short', '未自动开始工作');
  assert.equal(h.last('break-end').auto, false);
  h.advance(30 * MIN);
  h.engine.tick();
  assert.equal(h.engine.phase, 'short', '不点击就不会开始工作');
  h.engine.beginWork();
  assert.equal(h.engine.phase, 'work');
  assert.equal(h.engine.awaiting, null);
  assert.equal(h.engine.remainingMs(h.now()), 45 * MIN);
});

test('跳过休息直接开始下一轮工作', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  h.engine.skipRest();
  assert.equal(h.engine.phase, 'work');
  assert.equal(h.engine.awaiting, null);
  assert.ok(h.types().includes('skipped'));
});

test('稍后提醒：到期后再次触发 work-end', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  h.engine.snooze(5);
  h.advance(2 * MIN);
  h.engine.tick();
  const before = h.events.length;
  h.advance(3 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.snoozeUntil, 0);
  assert.ok(h.events.slice(before).some((e) => e.type === 'work-end'));
});

test('暂停冻结倒计时，恢复后继续', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(20 * MIN);
  h.engine.pause();
  const frozenAt = h.engine.remainingMs(h.now());
  assert.equal(frozenAt, 25 * MIN);
  h.advance(60 * MIN);
  h.engine.tick();
  assert.equal(h.engine.awaiting, null);
  assert.equal(h.engine.remainingMs(h.now()), 25 * MIN);
  h.engine.resume();
  assert.equal(h.engine.remainingMs(h.now()), 25 * MIN);
  h.advance(25 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.awaiting, 'work-end');
});

test('会议模式静音期间不弹提醒，恢复后补弹', () => {
  const h = makeEngine();
  h.engine.start();
  h.engine.setMute(60);
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.awaiting, 'work-end');
  assert.equal(h.events.filter((e) => e.type === 'work-end').length, 0);
  assert.equal(h.engine.muted(h.now()), true);
  h.advance(20 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.muted(h.now()), false);
  assert.equal(h.events.filter((e) => e.type === 'work-end').length, 1);
});

test('手动静音期间工作结束不弹窗，解除后仍不弹（保留待决策）', () => {
  const h = makeEngine();
  h.engine.start();
  h.engine.setMute(null);
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.awaiting, 'work-end');
  assert.equal(h.engine.muted(h.now()), true);
  assert.equal(h.events.filter((e) => e.type === 'work-end').length, 0);
  h.advance(120 * MIN);
  h.engine.clearExpiredMute();
  assert.equal(h.engine.muted(h.now()), true);
  assert.equal(h.events.filter((e) => e.type === 'work-end').length, 0);
  h.engine.clearMute();
  assert.equal(h.engine.muted(h.now()), false);
  assert.equal(h.events.filter((e) => e.type === 'work-end').length, 0, '手动模式不补弹');
  assert.equal(h.engine.awaiting, 'work-end', '保持待决策，用户可自行处理');
  h.engine.beginBreak();
  assert.equal(h.engine.phase, 'short');
});

test('自动开始关闭时，休息结束弹窗询问', () => {
  const h = makeEngine({ autoStart: false });
  h.engine.start();
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  h.engine.beginBreak();
  h.advance(5 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.awaiting, 'break-end');
  assert.equal(h.engine.phase, 'short');
  assert.deepEqual(h.last('break-end'), { auto: false, early: false, wasLong: false });
});

test('提前结束休息后需确认才开始工作', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  h.engine.beginBreak();
  h.advance(1 * MIN);
  h.engine.endBreakEarly();
  assert.equal(h.engine.phase, 'short', '提前结束只是进入等待确认');
  assert.deepEqual(h.last('break-end'), { auto: false, early: true, wasLong: false });
  h.engine.beginWork();
  assert.equal(h.engine.phase, 'work');
});

test('跳过工作轮：计入轮次并进入休息决策', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(10 * MIN);
  h.engine.skipWork();
  assert.equal(h.engine.round, 1);
  assert.equal(h.engine.awaiting, 'work-end');
  assert.equal(h.engine.lastReason, 'skip');
  assert.equal(h.last('work-end').reason, 'skip');
  assert.equal(h.last('work-end').nextBreak, 'short');
});

test('跳过工作轮影响长休节奏（第 4 轮跳过进长休）', () => {
  const h = makeEngine();
  h.engine.start();
  for (let i = 0; i < 3; i++) {
    h.advance(20 * MIN);
    h.engine.skipWork();
    h.engine.beginBreak();
    h.advance(5 * MIN + 1000);
    h.engine.tick();
    h.engine.beginWork();
  }
  h.advance(20 * MIN);
  h.engine.skipWork();
  assert.equal(h.engine.round, 4);
  assert.equal(h.last('work-end').nextBreak, 'long');
});

test('冻结状态下也能跳过工作，跳过后解除冻结', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(5 * MIN);
  h.engine.pause();
  h.engine.skipWork();
  assert.equal(h.engine.awaiting, 'work-end');
  assert.equal(h.engine.frozen, false);
});

test('静音期间跳过工作不弹窗（与到点一致）', () => {
  const h = makeEngine();
  h.engine.start();
  h.engine.setMute(null);
  h.advance(10 * MIN);
  h.engine.skipWork();
  assert.equal(h.engine.awaiting, 'work-end');
  assert.equal(h.events.filter((e) => e.type === 'work-end').length, 0);
  h.engine.clearMute();
  assert.equal(h.events.filter((e) => e.type === 'work-end').length, 0);
});

test('非工作阶段不能跳过工作', () => {
  const h = makeEngine();
  assert.throws(() => h.engine.skipWork());
  h.engine.start();
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  assert.throws(() => h.engine.skipWork());
  h.engine.beginBreak();
  assert.throws(() => h.engine.skipWork());
});

test('会议模式：到工作时间 = 静音到本轮工作结束', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(20 * MIN);
  h.engine.setMuteForWork();
  assert.equal(h.engine.muteMode, 'work');
  assert.equal(h.engine.muteUntil, h.now() + 25 * MIN);
  h.advance(25 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.muted(h.now()), false);
  assert.ok(h.types().includes('work-end'), '到工作时间应弹窗');
});

test('会议模式：非工作阶段选「到工作时间」退化为 60 分钟', () => {
  const h = makeEngine();
  h.engine.setMuteForWork();
  assert.equal(h.engine.muteMode, 'timed');
  assert.equal(h.engine.muteUntil, h.now() + 60 * MIN);
});

test('立即生效：按新时长重算当前阶段剩余', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(10 * MIN);
  assert.equal(h.engine.remainingMs(h.now()), 35 * MIN);
  h.engine.applyConfigNow({ workMin: 40 });
  assert.equal(h.engine.remainingMs(h.now()), 30 * MIN);
  assert.equal(h.engine.totalMs(), 40 * MIN);
  assert.equal(h.engine.phase, 'work');
});

test('立即生效：已进行超过新时长则立即结束本轮', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(40 * MIN);
  h.engine.applyConfigNow({ workMin: 25 });
  assert.equal(h.engine.awaiting, 'work-end');
  assert.equal(h.events.filter((e) => e.type === 'work-end').length, 1);
});

test('立即生效：冻结状态同步重算冻结剩余', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(10 * MIN);
  h.engine.pause();
  h.engine.applyConfigNow({ workMin: 30 });
  assert.equal(h.engine.frozen, true);
  assert.equal(h.engine.remainingMs(h.now()), 20 * MIN);
  h.engine.resume();
  assert.equal(h.engine.remainingMs(h.now()), 20 * MIN);
});

test('立即生效：等待决策 / 空闲时不改当前状态', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  h.engine.applyConfigNow({ workMin: 60 });
  assert.equal(h.engine.awaiting, 'work-end');
  h.engine.beginBreak();
  assert.equal(h.engine.remainingMs(h.now()), 5 * MIN);

  const idle = makeEngine();
  idle.engine.applyConfigNow({ workMin: 30 });
  idle.engine.start();
  assert.equal(idle.engine.remainingMs(idle.now()), 30 * MIN);
});

test('今日工时累计：仅工作时段与「等决策」期累加，冻结/休息/休息结束等待期不计', () => {
  const h = makeEngine();
  const tickFor = (ms) => {
    h.advance(ms);
    h.engine.tick();
  };
  h.engine.start();
  tickFor(10 * MIN);
  const afterWork = h.engine.workedMs;
  assert.ok(afterWork >= 10 * MIN && afterWork < 11 * MIN);
  h.advance(5 * MIN);
  h.engine.pause();
  tickFor(30 * MIN);
  assert.equal(h.engine.workedMs, afterWork, '冻结期间不累计');
  h.engine.resume();
  tickFor(5 * MIN);
  const afterResume = h.engine.workedMs;
  assert.ok(afterResume > afterWork + 4 * MIN);
  h.advance(45 * MIN);
  h.engine.tick();
  h.engine.beginBreak();
  const atBreak = h.engine.workedMs;
  tickFor(4 * MIN);
  assert.equal(h.engine.workedMs, atBreak, '休息期间不累计');
  tickFor(2 * MIN);
  assert.equal(h.engine.workedMs, atBreak, '休息结束后等待确认期间不累计');
  h.engine.beginWork();
  tickFor(2 * MIN);
  assert.ok(h.engine.workedMs > atBreak, '确认开始工作后重新累计');
});

test('跨天自动清零今日工时', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(30 * MIN);
  h.engine.tick();
  assert.ok(h.engine.workedMs > 29 * MIN);
  h.advance(20 * 60 * MIN);
  h.engine.tick();
  assert.ok(h.engine.workedMs < 2 * MIN, '新的一天从零开始累计');
});

test('工时随断点保存与恢复', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(25 * MIN);
  for (let i = 0; i < 3; i++) { h.advance(1000); h.engine.tick(); }
  const saved = JSON.parse(JSON.stringify(h.engine.toJSON()));
  assert.ok(saved.workedMs > 24 * MIN);

  const h2 = makeEngine();
  h2.engine.restore(saved);
  assert.ok(h2.engine.workedMs > 24 * MIN);
  assert.equal(h2.engine.lastAccrued, h2.now(), '恢复后不计入停机时间');
  h2.advance(5 * MIN);
  for (let i = 0; i < 3; i++) { h2.advance(1000); h2.engine.tick(); }
  assert.ok(h2.engine.workedMs > 29 * MIN && h2.engine.workedMs < 31 * MIN);
});

test('toJSON / restore 断点续跑（含等待决策与手动静音）', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  h.engine.setMute(null);
  const saved = JSON.parse(JSON.stringify(h.engine.toJSON()));
  assert.equal(saved.awaiting, 'work-end');
  assert.equal(saved.muteUntil, 'manual');
  assert.equal(saved.muteMode, 'manual');

  const h2 = makeEngine();
  h2.engine.restore(saved);
  assert.equal(h2.engine.phase, 'work');
  assert.equal(h2.engine.awaiting, 'work-end');
  assert.equal(h2.engine.muted(h2.now()), true);
  assert.equal(h2.engine.round, 1);
  h2.engine.clearMute();
  assert.equal(h2.types().includes('work-end'), false, '手动模式不补弹');
  h2.engine.beginBreak();
  assert.equal(h2.engine.phase, 'short');
});

test('toJSON / restore 断点续跑（定时静音到期补弹）', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  h.engine.setMute(60);
  const saved = JSON.parse(JSON.stringify(h.engine.toJSON()));
  assert.equal(saved.muteMode, 'timed');

  const h2 = makeEngine();
  h2.engine.restore(saved);
  h2.engine.clearMute();
  assert.ok(h2.types().includes('work-end'), '定时模式补弹提醒');
});

test('restore 后 deadline 过期会立即触发提醒', () => {
  const h = makeEngine({ autoStart: false });
  h.engine.start();
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  h.engine.beginBreak();
  h.advance(5 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.awaiting, 'break-end');
  const saved = JSON.parse(JSON.stringify(h.engine.toJSON()));

  const h2 = makeEngine({ autoStart: false });
  h2.engine.restore(saved);
  h2.engine.tick();
  assert.equal(h2.engine.awaiting, 'break-end');
  assert.equal(h2.engine.phase, 'short');
});

test('configure 对下一阶段生效、阶段切换后使用新时长', () => {
  const h = makeEngine();
  h.engine.start();
  h.engine.configure({ workMin: 25 });
  assert.equal(h.engine.remainingMs(h.now()), 45 * MIN);
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  h.engine.skipRest();
  assert.equal(h.engine.remainingMs(h.now()), 25 * MIN);
});

test('休息结束询问后：马上开始 / 再休息 5 分钟', () => {
  const h = makeEngine({ autoStart: false });
  h.engine.start();
  h.advance(45 * MIN + 1000);
  h.engine.tick();
  h.engine.beginBreak();
  h.advance(5 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.awaiting, 'break-end');

  h.engine.extendBreak(5);
  assert.equal(h.engine.awaiting, null);
  assert.equal(h.engine.phase, 'short');
  assert.equal(h.engine.remainingMs(h.now()), 5 * MIN);

  h.advance(5 * MIN + 1000);
  h.engine.tick();
  assert.equal(h.engine.awaiting, 'break-end');

  h.engine.beginWork();
  assert.equal(h.engine.awaiting, null);
  assert.equal(h.engine.phase, 'work');
  assert.equal(h.engine.remainingMs(h.now()), 45 * MIN);
});

test('未满足前置条件的动作会抛错', () => {
  const h = makeEngine();
  assert.throws(() => h.engine.beginBreak());
  assert.throws(() => h.engine.skipRest());
  assert.throws(() => h.engine.skipWork());
  assert.throws(() => h.engine.endBreakEarly());
});

test('工作结束等待决策期间：工时继续累计，overMs 递增', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN);
  h.engine.tick();
  assert.equal(h.engine.awaiting, 'work-end');
  const atEnd = h.engine.workedMs;
  assert.ok(atEnd >= 45 * MIN - 1000, `本轮工时应已计满，实际 ${atEnd}`);
  assert.equal(h.engine.overMs(h.now()), 0, '刚结束时已超时为 0');

  h.advance(3 * MIN);
  h.engine.tick();
  assert.ok(
    h.engine.workedMs >= atEnd + 3 * MIN - 1000,
    `等决策期间应继续累计工时，实际 ${h.engine.workedMs}`
  );
  const over = h.engine.overMs(h.now());
  assert.ok(over >= 3 * MIN - 1000 && over <= 3 * MIN, `overMs 应约等于等待时长，实际 ${over}`);
  assert.equal(h.engine.getState(h.now()).overMs, over, 'overMs 应随 state 广播给三个窗口');
});

test('「稍后 5 分钟」等待期工时继续累计', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN);
  h.engine.tick();
  const before = h.engine.workedMs;

  h.engine.snooze(5);
  h.advance(4 * MIN);
  h.engine.tick();
  assert.equal(h.engine.awaiting, 'work-end', '稍后期间仍是等待决策');
  assert.ok(
    h.engine.workedMs >= before + 4 * MIN - 1000,
    `稍后等待期应继续累计，实际 ${h.engine.workedMs}`
  );
  assert.ok(h.engine.overMs(h.now()) >= 4 * MIN - 1000, '超时应一并累加');
});

test('点「去休息」后工时立即停止累计，overMs 归零', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN);
  h.engine.tick();
  h.advance(2 * MIN);
  h.engine.tick();
  assert.ok(h.engine.overMs(h.now()) > 0);

  h.engine.beginBreak();
  assert.equal(h.engine.overMs(h.now()), 0, '进入休息后不再有超时');
  const atBreak = h.engine.workedMs;
  h.advance(3 * MIN);
  h.engine.tick();
  assert.equal(h.engine.workedMs, atBreak, '休息期间不累计');
});

test('点「跳过休息」后进入下一轮并继续累计', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN);
  h.engine.tick();
  h.advance(2 * MIN);
  h.engine.tick();
  const before = h.engine.workedMs;

  h.engine.skipRest();
  assert.equal(h.engine.awaiting, null);
  assert.equal(h.engine.overMs(h.now()), 0, '跳过休息后超时归零');
  h.advance(MIN);
  h.engine.tick();
  assert.ok(h.engine.workedMs > before, '新的一轮应继续累计工时');
});

test('会议模式压住提醒期间工时继续累计，解除后保留', () => {
  const h = makeEngine();
  h.engine.start();
  h.engine.setMute(60);
  h.advance(45 * MIN);
  h.engine.tick();
  assert.equal(h.engine.awaiting, 'work-end');
  assert.ok(!h.types().includes('work-end'), '静音期间不弹窗');

  h.advance(2 * MIN);
  h.engine.tick();
  const during = h.engine.workedMs;
  assert.ok(during >= 47 * MIN - 1000, `静音压着等待期也应累计，实际 ${during}`);
  assert.ok(h.engine.overMs(h.now()) >= 2 * MIN - 1000, '静音期间同样累加超时');

  h.engine.clearMute();
  assert.equal(h.engine.workedMs, during, '解除静音本身不改变累计值');
  h.advance(MIN);
  h.engine.tick();
  assert.ok(h.engine.workedMs > during, '解除后继续累计');
});

test('等待决策期间冻结：overMs 归零，超时不进断点', () => {
  const h = makeEngine();
  h.engine.start();
  h.advance(45 * MIN);
  h.engine.tick();
  h.advance(2 * MIN);
  h.engine.tick();
  assert.ok(h.engine.overMs(h.now()) > 0);
  assert.equal('overMs' in h.engine.toJSON(), false, '超时应是派生量，不落盘');

  h.engine.pause();
  assert.equal(h.engine.overMs(h.now()), 0, '冻结时不再显示超时');
  const before = h.engine.workedMs;
  h.advance(MIN);
  h.engine.tick();
  assert.equal(h.engine.workedMs, before, '冻结期间不累计');
});
