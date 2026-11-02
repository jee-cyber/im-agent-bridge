'use strict';

/**
 * 钉钉 dws 的唯一出口：拼 profile、解析 Windows 入口、发送重试、监听与下载。
 * 换 IM 时替换本文件；核心层只调用 send / listen / json / run。
 */

const { spawn, spawnSync } = require('child_process');
const config = require('../../core/config');
const { dwsSpawnOptions } = require('./resolve-bin');

function withProfile(tail) {
  const profile = config.dws.profile || process.env.DWS_PROFILE;
  return profile ? ['--profile', profile, ...tail] : tail;
}

function spawnOptions(tail) {
  return dwsSpawnOptions(withProfile(tail));
}

function sleepMs(ms) {
  if (ms <= 0) return;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    /* 短等待，避开网关瞬时超时 */
  }
}

function run(tail, opts = {}) {
  const { command, args } = spawnOptions(tail);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: process.env,
    timeout: opts.timeout ?? 120000,
  });
  if (result.error) {
    return { ok: false, error: result.error.message, stdout: '', stderr: '' };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || '').trim() || `exit ${result.status}`,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  }
  return { ok: true, stdout: (result.stdout || '').trim(), stderr: result.stderr || '' };
}

function json(tail, opts = {}) {
  const args = tail.includes('-f') ? tail : [...tail, '-f', 'json'];
  const out = run(args, opts);
  if (!out.ok) return null;
  try {
    return JSON.parse(out.stdout || '{}');
  } catch {
    return null;
  }
}

function isRetryable(errText) {
  return /timeout|i\/o timeout|request_timeout|deadline|ECONNRESET|ETIMEDOUT/i.test(String(errText || ''));
}

function sendOnce(target) {
  const tail = ['chat', '+messages-send', '--as', 'user', '-y', '--text', target.text];
  if (target.channel === 'group' && target.conversation_id) {
    tail.push('--group', target.conversation_id);
  } else if (target.sender_open_dingtalk_id) {
    tail.push('--open-dingtalk-id', target.sender_open_dingtalk_id);
  } else {
    return { ok: false, error: 'missing reply target' };
  }
  const timeoutMs = (Number(process.env.DWS_HTTP_TIMEOUT_SEC || 180) + 30) * 1000;
  return run(tail, { timeout: timeoutMs });
}

function send(target) {
  const maxAttempts = config.agent.sendRetry || 3;
  let last = { ok: false, error: 'unknown' };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = sendOnce(target);
    if (last.ok) return last;
    if (!isRetryable(last.error) || attempt >= maxAttempts) return last;
    process.stderr.write(
      `[dws] 发送失败，${attempt}/${maxAttempts} 次，准备重试: ${String(last.error).slice(0, 120)}\n`
    );
    sleepMs(2000 * attempt);
  }
  return last;
}

function listen(kind) {
  const tail = ['event', '+listen-im', ...config.dws.listenFormat, '--kind', kind];
  const { command, args } = spawnOptions(tail);
  return spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function downloadResource({ resourceId, messageId, conversationId, output, cwd }) {
  return run(
    [
      'chat',
      '+messages-resource-download',
      '--resource-id',
      resourceId,
      '--message-id',
      messageId,
      '--open-conversation-id',
      conversationId,
      '--output',
      output,
    ],
    { cwd, timeout: 120000 }
  );
}

module.exports = { run, json, send, listen, downloadResource };
