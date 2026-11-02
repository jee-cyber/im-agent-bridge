#!/usr/bin/env node
'use strict';

/**
 * 钉钉 IM 桥接：监听 @我 + 单聊，路由到 DIP / 新功能 job，并触发 Cursor Agent 唤醒标记。
 * 启动：node .cursor/hooks/dingtalk-im-bridge/bridge.js
 */

const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');
const config = require('./config');
const { sendText } = require('./reply');
const { handleMessage } = require('./router');
const store = require('./store');
const { enrichEventMedia, buildTextForIntent, MEDIA_HINT } = require('./media');
const { dwsSpawnOptions } = require('./resolve-dws-bin');

function dwsArgs(kind) {
  const tail = ['event', '+listen-im', ...config.dws.listenFormat, '--kind', kind];
  if (config.dws.profile) {
    return ['--profile', config.dws.profile, ...tail];
  }
  return tail;
}

function parseDataField(raw) {
  if (typeof raw.data === 'string' && raw.data.trim().startsWith('{')) {
    try {
      return JSON.parse(raw.data);
    } catch {
      return null;
    }
  }
  if (raw.data && typeof raw.data === 'object') return raw.data;
  return null;
}

/** 兼容 transport envelope / flatten NDJSON */
function normalizeMessageEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;

  if (raw.type === 'event' && raw.event_type && !raw.message_id) {
    const inner = parseDataField(raw);
    if (inner) raw = { ...inner, subscribe_id: raw.subscribe_id, event_id: raw.event_id || inner.event_id };
  }

  const payload = raw.payload || raw;
  const body = payload.body || payload.message || payload;
  let content =
    raw.content ||
    body.content ||
    body.text ||
    body.textContent ||
    (typeof body === 'string' ? body : null);
  if (content != null) content = String(content).trim();

  const message_id =
    raw.message_id ||
    body.messageId ||
    body.msgId ||
    body.openMessageId;
  const conversation_id =
    raw.conversation_id ||
    body.conversationId ||
    body.openConversationId ||
    body.cid;

  const hasMediaHint = MEDIA_HINT.test(content || '') || /mediaId/i.test(JSON.stringify(raw));
  if (!content && !hasMediaHint && !message_id) return null;
  if (!content && !message_id) return null;

  return {
    type: raw.type || payload.eventType || 'message',
    event_id: raw.event_id || raw.eventId || payload.eventId,
    message_id,
    conversation_id,
    sender_open_dingtalk_id:
      raw.sender_open_dingtalk_id ||
      body.senderOpenDingTalkId ||
      body.senderId,
    sender: raw.sender || body.senderNick || body.sender,
    content: content || '',
    rawContent: typeof raw.data === 'string' ? raw.data : JSON.stringify(body),
    quoted_message: raw.quoted_message || body.quotedMessage,
    forward_messages: raw.forward_messages || body.forwardMessages,
  };
}

function isReadyLine(raw) {
  if (String(raw.type || '').includes('ready')) return true;
  if (raw.type === 'ready') return true;
  return false;
}

function spawnListener(kind) {
  const args = dwsArgs(kind);
  const { command, args: spawnArgs } = dwsSpawnOptions(args);
  const child = spawn(command, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (buf) => {
    process.stderr.write(`[${kind}] ${buf}`);
  });
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let raw;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (isReadyLine(raw)) return;
    const evt = normalizeMessageEvent(raw);
    if (!evt) return;
    routeEvent(evt, kind).catch((err) => {
      process.stderr.write(`route error: ${err.message}\n`);
    });
  });
  child.on('exit', (code, signal) => {
    process.stderr.write(`[${kind}] exited code=${code} signal=${signal}\n`);
    setTimeout(() => spawnListener(kind), 5000);
  });
  return child;
}

async function routeEvent(evt, listenKind) {
  const media = enrichEventMedia(evt);
  evt.media = media;
  evt.content = buildTextForIntent(evt, media);
  if (media.images.length) {
    process.stderr.write(
      `[media] message=${evt.message_id} saved ${media.images.join(', ')}\n`
    );
  }
  if (media.errors.length) {
    process.stderr.write(`[media] errors ${JSON.stringify(media.errors)}\n`);
  }

  const replies = await handleMessage(evt, listenKind);
  if (!replies || !replies.length) return;
  for (const r of replies) {
    const result = sendText(r);
    if (!result.ok) {
      process.stderr.write(`reply failed: ${result.error}\n`);
    }
  }
}

function main() {
  store.ensureDirs();
  fs.mkdirSync(config.dirs.media, { recursive: true });
  const deptGate = config.policy.gateCloudDeliveryDept
    ? config.policy.replyDeptPatterns.join('|')
    : 'off';
  const workGate = config.policy.gateWorkOnly ? '业务关键词' : 'off';
  process.stderr.write(
    `dingtalk-im-bridge 已启动（群@我 + 单聊）。门禁：部门=[${deptGate}] 项目=雨润|明泰|大众 autoCodeInGroup=${config.policy.autoCodeInGroup} media=on\n`
  );
  spawnListener('at-me');
  spawnListener('all-direct');
}

main();
