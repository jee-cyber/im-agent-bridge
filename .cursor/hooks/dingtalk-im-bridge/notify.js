'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const hooksDir = path.join(__dirname, '..');
const config = require('./config');
const { writePromptFiles } = require('./build-agent-prompt');
const { resolveAgentSpawn } = require('./resolve-agent-bin');

function notifyMac(title, body) {
  if (process.platform !== 'darwin') return;
  const safe = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 200);
  spawnSync(
    'osascript',
    ['-e', `display notification "${safe(body)}" with title "${safe(title)}"`],
    { stdio: 'ignore' }
  );
}

function spawnFullAutoAgent(job) {
  if (!config.fullAuto) return false;
  if (!resolveAgentSpawn()) {
    process.stderr.write(
      '[dingtalk] FULL_AUTO: cursor-agent 未找到（请执行 irm https://cursor.com/install?win32=true | iex）\n'
    );
    return false;
  }
  writePromptFiles(job, { fullAuto: true });
  const child = spawn(process.execPath, [path.join(__dirname, 'run-auto-agent.js'), job.jobId], {
    cwd: config.aiWorkflowRoot,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  return !!child.pid;
}

function notifyAgentWake(job, phase, note) {
  const title = '钉钉工单 → 自动处理';
  const body = [job.requirementId || job.jobId, phase, note].filter(Boolean).join(' · ');
  notifyMac(title, body + '（cursor-agent 后台执行）');

  try {
    fs.writeFileSync(
      path.join(hooksDir, 'dingtalk-auto-reply.flag'),
      'enabled at ' + new Date().toISOString() + '\n',
      'utf8'
    );
  } catch {
    /* ignore */
  }

  if (!spawnFullAutoAgent(job)) {
    spawnSync(process.execPath, [path.join(__dirname, 'run-pending-job.js'), job.jobId], {
      cwd: config.aiWorkflowRoot,
      stdio: 'ignore',
      detached: true,
    });
  }
}

module.exports = { notifyAgentWake, notifyMac, spawnFullAutoAgent };
