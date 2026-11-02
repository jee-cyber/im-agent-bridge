'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** @type {{ command: string, prefixArgs: string[] } | undefined} */
let cachedEntry;

/**
 * 解析本机 dws 的 spawn 入口。
 * Windows 上 npm 全局 `dws` 多为 .cmd/.ps1 包装，Node 直接 spawn('dws') 会 ENOENT，需 `node .../dws.js`。
 *
 * @returns {{ command: string, prefixArgs: string[] }} command 为可执行文件，prefixArgs 为置于 CLI 参数前的固定前缀（如 dws.js 路径）
 */
function resolveDwsCommand() {
  if (cachedEntry !== undefined) {
    return cachedEntry;
  }

  const explicit = process.env.DWS_BIN;
  if (explicit) {
    cachedEntry = { command: explicit, prefixArgs: [] };
    return cachedEntry;
  }

  if (process.platform !== 'win32') {
    cachedEntry = { command: 'dws', prefixArgs: [] };
    return cachedEntry;
  }

  /** @type {string[]} */
  const scriptCandidates = [];

  try {
    const npmCli = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const npmGlobal = execFileSync(npmCli, ['prefix', '-g'], {
      encoding: 'utf8',
      env: process.env,
      windowsHide: true,
    }).trim();
    scriptCandidates.push(
      path.join(npmGlobal, 'node_modules', 'dingtalk-workspace-cli', 'bin', 'dws.js'),
    );
  } catch {
    // 计划任务 PATH 可能无 npm，由下方路径兜底
  }

  const pathDirs = (process.env.Path || process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const dir of pathDirs) {
    scriptCandidates.push(
      path.join(dir, 'node_modules', 'dingtalk-workspace-cli', 'bin', 'dws.js'),
    );
  }

  const localApp = process.env.LOCALAPPDATA || '';
  if (localApp) {
    scriptCandidates.push(
      path.join(localApp, 'Programs', 'dingtalk-workspace-cli', 'dws.js'),
    );
  }

  for (const script of scriptCandidates) {
    if (script && fs.existsSync(script)) {
      cachedEntry = { command: process.execPath, prefixArgs: [script] };
      return cachedEntry;
    }
  }

  // 最后兜底：依赖 PATH 中的 dws.cmd（部分 Node 版本需 shell，不推荐）
  cachedEntry = { command: 'dws.cmd', prefixArgs: [] };
  return cachedEntry;
}

/**
 * 合并 dws 子命令参数，供 child_process.spawn / spawnSync 使用。
 *
 * @param {string[]} cliArgs dws 子命令及 flags（不含 `dws` 可执行名本身）
 * @returns {{ command: string, args: string[] }}
 */
function dwsGlobalPrefixArgs() {
  const timeoutSec = Number(process.env.DWS_HTTP_TIMEOUT_SEC || 180);
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    return [];
  }
  return ['--timeout', String(Math.floor(timeoutSec))];
}

function dwsSpawnOptions(cliArgs) {
  const { command, prefixArgs } = resolveDwsCommand();
  return {
    command,
    args: [...prefixArgs, ...dwsGlobalPrefixArgs(), ...cliArgs],
  };
}

module.exports = { resolveDwsCommand, dwsSpawnOptions };
