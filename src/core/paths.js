'use strict';

/**
 * 路径只在这里解析。
 * 源码在 src/，运行时数据在 data/，Cursor 钩子仍留在 .cursor/hooks/ 作为薄入口。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

function envValue(name) {
  const value = process.env[name];
  return value == null || value === '' ? '' : value;
}

const workspaceRoot = path.resolve(
  envValue('IM_BRIDGE_WORKSPACE') || envValue('DINGTALK_WORKSPACE_ROOT') || repoRoot
);

const runtimeRoot = envValue('IM_BRIDGE_HOME')
  ? path.resolve(envValue('IM_BRIDGE_HOME'))
  : repoRoot;

const dataDir = path.join(runtimeRoot, 'data');

const dirs = {
  data: dataDir,
  state: path.join(dataDir, 'state'),
  inbox: path.join(dataDir, 'inbox'),
  media: path.join(dataDir, 'media'),
};

const files = {
  pendingReply: path.join(dataDir, 'pending-reply.json'),
  wakeFlag: path.join(dataDir, 'agent-wake.flag'),
  codeFlag: path.join(dataDir, 'code.flag'),
  autoReplyFlag: path.join(dataDir, 'auto-reply.flag'),
  promptTxt: path.join(dataDir, 'prompt.txt'),
  promptMd: path.join(dataDir, 'prompt.md'),
  lastInject: path.join(dataDir, 'last-inject.txt'),
  promptsDoc: path.join(repoRoot, 'docs', 'AGENT-PROMPTS.md'),
};

const legacyRoot = path.join(repoRoot, '.cursor', 'hooks');
const legacy = {
  inbox: path.join(legacyRoot, 'dingtalk-im-bridge', 'inbox'),
  state: path.join(legacyRoot, 'dingtalk-im-bridge', 'state'),
  media: path.join(legacyRoot, 'dingtalk-im-bridge', 'media'),
  pendingReply: path.join(legacyRoot, 'dingtalk-im-bridge', 'pending-reply.json'),
  wakeFlag: path.join(legacyRoot, 'dingtalk-agent-wake.flag'),
  codeFlag: path.join(legacyRoot, 'dingtalk-code.flag'),
  autoReplyFlag: path.join(legacyRoot, 'dingtalk-auto-reply.flag'),
  promptTxt: path.join(legacyRoot, 'dingtalk-open-chat-prompt.txt'),
  promptMd: path.join(legacyRoot, 'dingtalk-auto-prompt.md'),
  lastInject: path.join(legacyRoot, 'dingtalk-last-inject.txt'),
};

function logDirCandidate(name) {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, name, 'logs');
  }
  return path.join(os.homedir(), 'Library', 'Logs', name);
}

function resolveLogDir() {
  const explicit = envValue('IM_BRIDGE_LOG_DIR') || envValue('DINGTALK_LOG_DIR');
  if (explicit) return explicit;
  const next = logDirCandidate('im-agent-bridge');
  const previous = logDirCandidate('cursor-dingtalk-bridge');
  if (!fs.existsSync(next) && fs.existsSync(previous)) return previous;
  return next;
}

function moveIfNeeded(from, to) {
  if (!fs.existsSync(from) || fs.existsSync(to)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

function ensureDirs() {
  if (runtimeRoot === repoRoot) {
    moveIfNeeded(legacy.inbox, dirs.inbox);
    moveIfNeeded(legacy.state, dirs.state);
    moveIfNeeded(legacy.media, dirs.media);
    moveIfNeeded(legacy.pendingReply, files.pendingReply);
    moveIfNeeded(legacy.wakeFlag, files.wakeFlag);
    moveIfNeeded(legacy.codeFlag, files.codeFlag);
    moveIfNeeded(legacy.autoReplyFlag, files.autoReplyFlag);
    moveIfNeeded(legacy.promptTxt, files.promptTxt);
    moveIfNeeded(legacy.promptMd, files.promptMd);
    moveIfNeeded(legacy.lastInject, files.lastInject);
  }
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = {
  repoRoot,
  workspaceRoot,
  runtimeRoot,
  dirs,
  files,
  resolveLogDir,
  ensureDirs,
};
