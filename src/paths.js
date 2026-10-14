'use strict';

const nodePath = require('path');

// 不能直接用 path.isAbsolute：它在 Linux 上不认 `D:\...` 这类 Windows 盘符路径。
// 开机自启只在 Windows 上生效，但测试要在 Linux 跑，所以两种绝对路径都要认。
const WIN_ABS = /^(?:[a-zA-Z]:[\\/]|\\\\)/;

function isAbsolute(p) {
  if (typeof p !== 'string' || !p) return false;
  return nodePath.isAbsolute(p) || WIN_ABS.test(p);
}

/**
 * 解析「开机自启」该注册哪个可执行文件路径。
 *
 * 背景：electron-builder 的 portable 目标每次启动都会把自身解压到
 * `%TEMP%` 下的随机目录再运行，此时 `process.execPath` 指向那个**临时路径**。
 * Windows 会定期清理 `%TEMP%`，注册表里留下的临时路径就失效了——
 * 开机自启会**静默失败**：不报错、不弹窗，重启后程序就是没自己起来，
 * 只能靠用户自己发现。
 *
 * electron-builder 的 portable 启动器会注入两个环境变量：
 *   `PORTABLE_EXECUTABLE_FILE` —— 原始 exe 的完整路径（首选）
 *   `PORTABLE_EXECUTABLE_DIR`  —— 原始 exe 所在目录
 *
 * 非 portable 场景（`npm start`、开发调试）两者都没有，返回 `undefined`，
 * 由调用方走 Electron 默认行为（注册 `process.execPath`）。
 *
 * 纯函数、零 Electron 依赖，可单测。
 */
function resolveLoginItemPath(env, execPath) {
  const e = env || {};

  const file = e.PORTABLE_EXECUTABLE_FILE;
  if (isAbsolute(file)) return file;

  const dir = e.PORTABLE_EXECUTABLE_DIR;
  if (isAbsolute(dir) && execPath) {
    // execPath 是 %TEMP%\随机目录\休息小助手.exe，取文件名拼回原始目录。
    // win32 路径必须用 path.win32 拼，否则在 Linux 测试里会拼出 `C:\a\b\c` 这种混合体。
    const win = WIN_ABS.test(dir) || WIN_ABS.test(execPath);
    const joiner = win ? nodePath.win32 : nodePath;
    return joiner.join(dir, joiner.basename(execPath));
  }

  return undefined;
}

/**
 * 构造传给 `app.setLoginItemSettings()` 的完整参数。
 *
 * 注意：Electron 的 `setLoginItemSettings` / `getLoginItemSettings`
 * **在 Linux 上是空操作**（实测传 true 读回仍是 false，path 被丢弃），
 * 只有 Windows / macOS 生效。所以这段逻辑必须做成纯函数才能在
 * Linux 上跑单测；真机行为仍需在 Windows 上人工验证一次。
 *
 * 非 portable 时**不设** `path` 字段，让 Electron 用默认的 `process.execPath`，
 * 避免多余地干预 `npm start` 之类的开发场景。
 */
function buildLoginItemOptions(cfg, env, execPath) {
  const opts = { openAtLogin: !!(cfg && cfg.openAtLogin), args: [] };
  const p = resolveLoginItemPath(env, execPath);
  if (p) opts.path = p;
  return opts;
}

module.exports = { resolveLoginItemPath, buildLoginItemOptions, isAbsolute };