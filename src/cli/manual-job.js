#!/usr/bin/env node
'use strict';

/** 手动或 bridge 唤醒后：生成完整 Agent 提示词并复制到剪贴板 */
const fs = require('fs');
const { spawnSync } = require('child_process');
const store = require('../core/store');
const { writePromptFiles } = require('../core/prompt');
const config = require('../core/config');
const paths = require('../core/paths');

const flagPath = paths.files.wakeFlag;

function main() {
  const jobId = process.argv[2] || (fs.existsSync(flagPath) ? fs.readFileSync(flagPath, 'utf8').trim() : '');
  if (!jobId) {
    console.error('用法: node src/cli/manual-job.js [jobId]');
    process.exit(1);
  }
  const job = store.readJob(jobId);
  if (!job) {
    console.error('找不到 job:', jobId);
    process.exit(1);
  }
  const prompt = writePromptFiles(job);
  spawnSync('pbcopy', { input: prompt });
  spawnSync('open', ['-a', 'Cursor', config.workspaceRoot]);
  if (process.platform === 'darwin') {
    spawnSync(
      'osascript',
      [
        '-e',
        'display notification "提示词已复制。在 Agent 里粘贴发送" with title "工单 ' +
          jobId +
          '"',
      ],
      { stdio: 'ignore' }
    );
  }
  console.log('jobId:', jobId);
  console.log('phase:', job.phase);
  console.log('已写入 data/prompt.md 并复制到剪贴板');
}

main();
