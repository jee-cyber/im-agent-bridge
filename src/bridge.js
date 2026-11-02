#!/usr/bin/env node
'use strict';

/**
 * IM 桥接入口：监听会话，路由成工单，并唤醒本机 Agent。
 * 启动：node src/bridge.js
 */

const config = require('./core/config');
const dws = require('./adapters/im/dws');
const { handleMessage } = require('./core/router');
const store = require('./core/store');
const { enrichEventMedia, buildTextForIntent, MEDIA_HINT } = require('./adapters/im/media');
const readline = require('readline');

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

function normalizeMessageEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'event' && raw.event_type && !raw.message_id) {
    const inner = parseDataField(raw);
    if (inner) raw = { ...inner, subscribe_id: raw.subscribe_id, event_id: raw.event_id || inner.event_id };
  }

  const payload = raw.payload || raw;
  const body = payload.body || payload.message || payload;
  let content = raw.content || body.content || body.text || body.textContent || (typeof body === 'string' ? body : null);
  if (content != null) content = String(content).trim();

  const messageId = raw.message_id || body.messageId || body.msgId || body.openMessageId;
  const conversationId = raw.conversation_id || body.conversationId || body.openConversationId || body.cid;
  const hasMediaHint = MEDIA_HINT.test(content || '') || /mediaId/i.test(JSON.stringify(raw));
  if (!content && !hasMediaHint && !messageId) return null;
  if (!content && !messageId) return null;

  return {
    type: raw.type || payload.eventType || 'message',
    event_id: raw.event_id || raw.eventId || payload.eventId,
    message_id: messageId,
    conversation_id: conversationId,
    sender_open_dingtalk_id: raw.sender_open_dingtalk_id || body.senderOpenDingTalkId || body.senderId,
    sender: raw.sender || body.senderNick || body.sender,
    content: content || '',
    rawContent: typeof raw.data === 'string' ? raw.data : JSON.stringify(body),
    quoted_message: raw.quoted_message || body.quotedMessage,
    forward_messages: raw.forward_messages || body.forwardMessages,
  };
}

function spawnListener(kind) {
  const child = dws.listen(kind);
  child.stderr.on('data', (buf) => process.stderr.write(`[${kind}] ${buf}`));
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let raw;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (String(raw.type || '').includes('ready') || raw.type === 'ready') return;
    const evt = normalizeMessageEvent(raw);
    if (!evt) return;
    routeEvent(evt, kind).catch((err) => process.stderr.write(`route error: ${err.message}\n`));
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
  if (media.images.length) process.stderr.write(`[media] message=${evt.message_id} saved ${media.images.join(', ')}\n`);
  if (media.errors.length) process.stderr.write(`[media] errors ${JSON.stringify(media.errors)}\n`);
  const replies = await handleMessage(evt, listenKind);
  if (!replies || !replies.length) return;
  for (const reply of replies) {
    const result = dws.send(reply);
    if (!result.ok) process.stderr.write(`reply failed: ${result.error}\n`);
  }
}

function main() {
  store.ensureDirs();
  const deptGate = config.policy.gateSenderDept ? config.policy.replyDeptPatterns.join('|') || 'on' : 'off';
  const labels = Object.values(config.projects).map((project) => project.label).join('|');
  process.stderr.write(
    `im-agent-bridge 已启动 profile=${config.profileName}（${config.listenKinds.join(' + ')}）。门禁：部门=[${deptGate}] 项目=${labels} autoCodeInGroup=${config.policy.autoCodeInGroup} media=on\n`
  );
  for (const kind of config.listenKinds) spawnListener(kind);
}

main();
