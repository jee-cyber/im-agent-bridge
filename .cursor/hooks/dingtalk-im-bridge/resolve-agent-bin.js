'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

function latestVersionDir(versionsRoot) {
  if (!versionsRoot || !fs.existsSync(versionsRoot)) return null;
  const names = fs
    .readdirSync(versionsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '.tmp-install')
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const name of names) {
    const exe = path.join(versionsRoot, name, 'cursor-agent.exe');
    const bin = path.join(versionsRoot, name, 'cursor-agent');
    const index = path.join(versionsRoot, name, 'index.js');
    const node = path.join(versionsRoot, name, 'node.exe');
    if (fs.existsSync(exe)) return exe;
    if (fs.existsSync(bin)) return bin;
    if (fs.existsSync(node) && fs.existsSync(index)) return path.join(versionsRoot, name);
  }
  return null;
}

function resolveAgentBin() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const localApp = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

  const versionRoots = [
    path.join(home, '.cursor', 'cursor-agent', 'versions'),
    path.join(localApp, 'cursor-agent', 'versions'),
  ];

  const candidates = [
    process.env.CURSOR_AGENT_BIN,
    config.cursorAgentBin,
    path.join(localApp, 'cursor-agent', 'cursor-agent.cmd'),
    path.join(localApp, 'cursor-agent', 'agent.cmd'),
    path.join(home, 'bin', 'cursor-agent.exe'),
    path.join(home, 'bin', 'cursor-agent'),
    path.join(home, '.local', 'bin', 'cursor-agent.exe'),
    path.join(localApp, 'Programs', 'cursor-agent', 'cursor-agent.exe'),
    ...versionRoots.map(latestVersionDir),
  ].filter(Boolean);

  for (const bin of candidates) {
    if (bin && fs.existsSync(bin)) return bin;
  }
  return null;
}

/**
 * 解析 FULL_AUTO 用的 spawn 入口（Windows 官方安装为 node.exe + index.js）。
 * @returns {{ command: string, argsPrefix: string[] } | null}
 */
function resolveAgentSpawn() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const localApp = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

  const versionRoots = [
    path.join(localApp, 'cursor-agent', 'versions'),
    path.join(home, '.cursor', 'cursor-agent', 'versions'),
  ];

  for (const root of versionRoots) {
    const dir = latestVersionDir(root);
    if (!dir) continue;
    if (dir.endsWith('.exe') || dir.endsWith('cursor-agent')) {
      return { command: dir, argsPrefix: [] };
    }
    const node = path.join(dir, 'node.exe');
    const index = path.join(dir, 'index.js');
    if (fs.existsSync(node) && fs.existsSync(index)) {
      return { command: node, argsPrefix: [index] };
    }
  }

  const bin = resolveAgentBin();
  if (!bin) return null;

  if (bin.endsWith('.cmd')) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    return { command: comspec, argsPrefix: ['/d', '/s', '/c', bin] };
  }
  return { command: bin, argsPrefix: [] };
}

module.exports = { resolveAgentBin, resolveAgentSpawn, latestVersionDir };
