'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveLoginItemPath, buildLoginItemOptions } = require('../src/paths');

test('非 portable：无环境变量时返回 undefined，交回 Electron 默认行为', () => {
  assert.equal(resolveLoginItemPath({}, '/usr/bin/electron'), undefined);
  assert.equal(resolveLoginItemPath(undefined, '/usr/bin/electron'), undefined);
  assert.equal(resolveLoginItemPath(null, undefined), undefined);
});

test('portable：优先用 PORTABLE_EXECUTABLE_FILE 拼出原始 exe 路径', () => {
  const got = resolveLoginItemPath(
    {
      PORTABLE_EXECUTABLE_FILE: 'D:\\Tools\\休息小助手 2.1.0.exe',
      PORTABLE_EXECUTABLE_DIR: 'D:\\Tools',
    },
    'C:\\Users\\me\\AppData\\Local\\Temp\\aBcDeF\\休息小助手.exe'
  );
  assert.equal(got, 'D:\\Tools\\休息小助手 2.1.0.exe');
});

test('portable：Windows UNC 路径也能处理', () => {
  assert.equal(
    resolveLoginItemPath({ PORTABLE_EXECUTABLE_FILE: '\\\\NAS\\share\\休息小助手.exe' }, 'C:\\Temp\\x\\app.exe'),
    '\\\\NAS\\share\\休息小助手.exe'
  );
  assert.equal(
    resolveLoginItemPath({ PORTABLE_EXECUTABLE_DIR: '\\\\NAS\\share' }, 'C:\\Users\\me\\AppData\\Local\\Temp\\aBc\\休息小助手.exe'),
    '\\\\NAS\\share\\休息小助手.exe'
  );
});

test('portable：只有 DIR 时用 execPath 的文件名拼回原始目录', () => {
  const got = resolveLoginItemPath(
    { PORTABLE_EXECUTABLE_DIR: '/opt/apps' },
    '/tmp/aBcDeF/休息小助手'
  );
  assert.equal(got, '/opt/apps/休息小助手');
});

test('回归防护：绝不能返回 %TEMP% 下的临时路径', () => {
  // 这正是要修的 bug：不处理的话注册表里留下的就是这个会被清掉的临时路径
  const tempPath = '/tmp/aBcDeF/休息小助手';
  const got = resolveLoginItemPath({ PORTABLE_EXECUTABLE_DIR: '/opt/apps' }, tempPath);
  assert.ok(!got.startsWith('/tmp/'), `不应返回临时路径，实际 ${got}`);
  assert.equal(got, '/opt/apps/休息小助手');
});

test('相对路径的环境变量不可信，一律忽略', () => {
  assert.equal(
    resolveLoginItemPath({ PORTABLE_EXECUTABLE_FILE: '相对路径.exe', PORTABLE_EXECUTABLE_DIR: '相对目录' }, '/tmp/x/app'),
    undefined
  );
});

test('DIR 存在但没有 execPath 时不能拼出坏路径', () => {
  assert.equal(resolveLoginItemPath({ PORTABLE_EXECUTABLE_DIR: '/opt/apps' }, ''), undefined);
  assert.equal(resolveLoginItemPath({ PORTABLE_EXECUTABLE_DIR: '/opt/apps' }, undefined), undefined);
});

test('FILE 无效但 DIR 有效时降级用 DIR', () => {
  const got = resolveLoginItemPath(
    { PORTABLE_EXECUTABLE_FILE: '', PORTABLE_EXECUTABLE_DIR: '/opt/apps' },
    '/tmp/zzz/app'
  );
  assert.equal(got, path.join('/opt/apps', 'app'));
});
// --- buildLoginItemOptions：整个决策的形状（Linux 上 Electron API 是空操作，
//     只能靠纯函数单测；真机行为仍需在 Windows 上人工验证一次） ---

test('开机自启参数：portable 场景带上原始 exe 路径', () => {
  assert.deepEqual(
    buildLoginItemOptions(
      { openAtLogin: true },
      { PORTABLE_EXECUTABLE_FILE: 'D:\\Tools\\休息小助手 2.1.0.exe' },
      'C:\\Users\\me\\AppData\\Local\\Temp\\aBc\\休息小助手.exe'
    ),
    { openAtLogin: true, args: [], path: 'D:\\Tools\\休息小助手 2.1.0.exe' }
  );
});

test('开机自启参数：非 portable 场景完全不设 path，交给 Electron 默认', () => {
  const opts = buildLoginItemOptions({ openAtLogin: true }, {}, '/usr/bin/electron');
  assert.deepEqual(opts, { openAtLogin: true, args: [] });
  assert.equal('path' in opts, false, '非 portable 不应干预 process.execPath');
});

test('开机自启参数：关掉时 openAtLogin 为 false，且仍记住 portable 路径', () => {
  assert.deepEqual(
    buildLoginItemOptions(
      { openAtLogin: false },
      { PORTABLE_EXECUTABLE_DIR: '/opt/portable-home' },
      '/tmp/aBc/休息小助手'
    ),
    { openAtLogin: false, args: [], path: '/opt/portable-home/休息小助手' }
  );
});

test('开机自启参数：cfg 缺失或字段为假都按关闭处理', () => {
  for (const cfg of [undefined, null, {}, { openAtLogin: undefined }, { openAtLogin: 0 }, { openAtLogin: '' }]) {
    assert.equal(buildLoginItemOptions(cfg, {}, '/usr/bin/electron').openAtLogin, false, `cfg=${JSON.stringify(cfg)}`);
  }
});
