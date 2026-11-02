'use strict';

const { spawnSync } = require('child_process');
const { dwsSpawnOptions } = require('./resolve-dws-bin');

/** dws 发消息失败时短暂等待后重试（MCP 网关偶发超时） */
function sleepMs(ms) {
  if (ms <= 0) return;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    /* 短等待，避免 MCP 网关瞬时超时 */
  }
}

/**
 * 单次调用 dws chat +messages-send。
 * @param {{ channel: 'group'|'direct', conversation_id?: string, sender_open_dingtalk_id?: string, text: string }} target
 */
function sendTextOnce(target) {
  const tail = ['chat', '+messages-send', '--as', 'user', '-y', '--text', target.text];
  if (target.channel === 'group' && target.conversation_id) {
    tail.push('--group', target.conversation_id);
  } else if (target.sender_open_dingtalk_id) {
    tail.push('--open-dingtalk-id', target.sender_open_dingtalk_id);
  } else {
    return { ok: false, error: 'missing reply target' };
  }

  const profile = process.env.DWS_PROFILE;
  const args = profile ? ['--profile', profile, ...tail] : tail;

  const dwsTimeoutMs =
    (Number(process.env.DWS_HTTP_TIMEOUT_SEC || 180) + 30) * 1000;

  const { command, args: spawnArgs } = dwsSpawnOptions(args);
  const result = spawnSync(command, spawnArgs, {
    encoding: 'utf8',
    env: process.env,
    timeout: dwsTimeoutMs,
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || '').trim() || `exit ${result.status}`,
    };
  }
  return { ok: true, stdout: (result.stdout || '').trim() };
}

function isRetryableDwsError(errText) {
  const t = String(errText || '');
  return /timeout|i\/o timeout|request_timeout|deadline|ECONNRESET|ETIMEDOUT/i.test(
    t
  );
}

/**
 * 发送钉钉文本（带超时重试）。
 * @param {{ channel: 'group'|'direct', conversation_id?: string, sender_open_dingtalk_id?: string, text: string }} target
 */
function sendText(target) {
  const maxAttempts = Number(process.env.DINGTALK_SEND_RETRY || 3);
  let last = { ok: false, error: 'unknown' };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = sendTextOnce(target);
    if (last.ok) return last;
    if (!isRetryableDwsError(last.error) || attempt >= maxAttempts) {
      return last;
    }
    process.stderr.write(
      `[reply] dws 发送失败，${attempt}/${maxAttempts} 次，准备重试: ${last.error.slice(0, 120)}\n`
    );
    sleepMs(2000 * attempt);
  }
  return last;
}

module.exports = { sendText };
