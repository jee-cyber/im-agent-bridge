#!/usr/bin/env node
'use strict';

/**
 * 全自动：cursor-agent --print 执行工单 → send-pending-reply 回钉钉
 * 由 bridge 在入队时 detached 拉起。
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const config = require('./config');
const store = require('./store');
const { writePromptFiles, buildPrompt } = require('./build-agent-prompt');
const { resolveAgentSpawn } = require('./resolve-agent-bin');
const { sendPendingReply, pendingPath } = require('./send-pending-reply');
const { collectPendingReply } = require('./collect-pending-reply');
const { formatConsultantBody } = require('./format-consultant-body');
const { resolveLogDir } = require('./log-dir');

const LOG_DIR = resolveLogDir();

function log(jobId, msg) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(path.join(LOG_DIR, `agent-${jobId}.log`), line);
  process.stderr.write(line);
}

/** 判断锁文件中的 PID 是否仍在运行（避免僵尸锁导致 follow-up 永不执行） */
function isPidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(jobId) {
  store.ensureDirs();
  const lock = path.join(config.dirs.state, `agent-running-${jobId}.lock`);
  if (fs.existsSync(lock)) {
    const age = Date.now() - fs.statSync(lock).mtimeMs;
    const raw = fs.readFileSync(lock, 'utf8').trim();
    const heldPid = parseInt(raw.split(/\s+/)[0], 10);
    const alive = isPidAlive(heldPid);
    if (alive && age < 20 * 60 * 1000) {
      log(jobId, `skip: already running pid=${heldPid}`);
      return null;
    }
    fs.unlinkSync(lock);
  }
  fs.writeFileSync(lock, String(process.pid) + '\n', 'utf8');
  return lock;
}

function releaseLock(lock) {
  if (lock && fs.existsSync(lock)) fs.unlinkSync(lock);
}

function writeFallbackReply(job, agentLog, reason) {
  const body = [
    `【${job.requirementId || '工单'}】自动处理未完成（${reason}）`,
    '常见原因：Cursor 云端暂时不可用（日志里 Error: [unavailable]），或网络/登录过期。',
    '请稍后重试；我恢复后会续跑。若紧急请在本群再 @ 一次或单聊说明需求号。',
  ].join('\n');
  fs.writeFileSync(
    pendingPath,
    JSON.stringify({ jobId: job.jobId, body, completeJob: false }, null, 2) + '\n',
    'utf8'
  );
}

function runAgentWithStream(bin, args, agentLog) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(bin, args, {
      cwd: config.aiWorkflowRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ status: 124, error: 'timeout', stdout, stderr });
    }, config.fullAutoTimeoutMs);

    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      stdout += s;
      fs.appendFileSync(agentLog, s);
    });
    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderr += s;
      fs.appendFileSync(agentLog, s);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ status: 1, error: err.message, stdout, stderr });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? 1, error: '', stdout, stderr });
    });
  });
}

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('用法: node run-auto-agent.js <jobId>');
    process.exit(1);
  }

  const job = store.readJob(jobId);
  if (!job) {
    console.error('找不到 job:', jobId);
    process.exit(1);
  }

  const lock = acquireLock(jobId);
  if (!lock) {
    log(jobId, 'skip: already running');
    process.exit(0);
  }

  const agentLog = path.join(LOG_DIR, `agent-${jobId}.log`);
  const spawnEntry = resolveAgentSpawn();
  if (!spawnEntry) {
    log(jobId, 'fail: cursor-agent not found');
    writeFallbackReply(
      job,
      agentLog,
      '未安装 cursor-agent，请在本机执行: irm https://cursor.com/install?win32=true | iex'
    );
    sendPendingReply();
    releaseLock(lock);
    process.exit(1);
  }

  job.phase = job.phase || 'DIP_RUN';
  job.updatedAt = new Date().toISOString();
  store.writeJob(job);

  const prompt = buildPrompt(job, { fullAuto: true });
  writePromptFiles(job, { fullAuto: true });
  log(
    jobId,
    `start cursor-agent model=${config.agentModel} cmd=${spawnEntry.command} prefix=${spawnEntry.argsPrefix.join(',')}`
  );

  const agentArgs = [
    ...spawnEntry.argsPrefix,
    '--trust',
    '--yolo',
    '--model',
    config.agentModel,
    '--print',
    '--output-format',
    'text',
    prompt,
  ];
  fs.appendFileSync(agentLog, '\n--- agent live output ---\n');

  const result = await runAgentWithStream(spawnEntry.command, agentArgs, agentLog);

  if (result.status !== 0) {
    log(jobId, `agent exit code=${result.status} err=${result.error || ''}`);
    if (!fs.existsSync(pendingPath)) {
      writeFallbackReply(job, agentLog, `agent 异常退出 code=${result.status}`);
    }
  } else {
    log(jobId, 'agent finished ok');
    collectPendingReply(jobId);
    if (!fs.existsSync(pendingPath)) {
      const fromStdout = formatConsultantBody((result.stdout || '').trim());
      const body =
        fromStdout.slice(0, 1800) ||
        '【自动处理】已完成分析，但未生成标准回执，请联系管理员查看日志。';
      fs.writeFileSync(
        pendingPath,
        JSON.stringify({ jobId, body, completeJob: true }, null, 2) + '\n',
        'utf8'
      );
    }
  }

  const sent = sendPendingReply();
  log(jobId, 'sendPendingReply: ' + JSON.stringify(sent));

  if (fs.existsSync(path.join(config.dirs.state, `agent-code-${jobId}.flag`))) {
    log(jobId, 'READY_CODE follow-up not chained yet; run-auto-agent again manually if needed');
  }

  releaseLock(lock);
  process.exit(sent.sent ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
