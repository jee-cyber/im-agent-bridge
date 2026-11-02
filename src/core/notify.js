'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const paths = require('./paths');
const { writePromptFiles } = require('./prompt');
const { resolveAgentSpawn } = require('../adapters/agent/resolve-bin');

function notifyMac(title, body) {
  if (process.platform !== 'darwin') return;
  const safe = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 200);
  spawnSync('osascript', ['-e', `display notification "${safe(body)}" with title "${safe(title)}"`], { stdio: 'ignore' });
}

function spawnFullAutoAgent(job) {
  if (!config.fullAuto) return false;
  if (!resolveAgentSpawn()) {
    process.stderr.write('[bridge] FULL_AUTO: 未找到本机 agent 可执行文件\n');
    return false;
  }
  writePromptFiles(job, { fullAuto: true });
  const child = spawn(process.execPath, [path.join(paths.repoRoot, 'src', 'agent', 'run-job.js'), job.jobId], {
    cwd: config.workspaceRoot,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  return !!child.pid;
}

function notifyAgentWake(job, phase, note) {
  if (process.env.IM_BRIDGE_DISABLE_WAKE === '1') return;
  const title = '工单已入队';
  const body = [job.requirementId || job.jobId, phase, note].filter(Boolean).join(' · ');
  notifyMac(title, body);
  try {
    fs.writeFileSync(paths.files.autoReplyFlag, `enabled at ${new Date().toISOString()}\n`, 'utf8');
  } catch {
    /* 标记写失败不阻断入队 */
  }
  if (!spawnFullAutoAgent(job)) {
    spawnSync(process.execPath, [path.join(paths.repoRoot, 'src', 'cli', 'manual-job.js'), job.jobId], {
      cwd: config.workspaceRoot,
      stdio: 'ignore',
      detached: true,
    });
  }
}

module.exports = { notifyAgentWake, notifyMac, spawnFullAutoAgent };
