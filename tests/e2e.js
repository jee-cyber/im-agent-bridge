#!/usr/bin/env node
'use strict';

/**
 * 本地 E2E：模拟入站 → 路由 → dws 把回复发到你自己的 openDingTalkId。
 * 身份从环境变量读取，不要把真实 id 写进仓库。
 *
 *   IM_BRIDGE_SELF_OPEN_ID=... node tests/e2e.js
 *   （DINGTALK_SELF_OPEN_ID 同样可用）
 */

const fs = require('fs');
const path = require('path');
const { handleMessage, classifyIntent } = require('../src/core/router');
const { send } = require('../src/adapters/im/dws');
const store = require('../src/core/store');
const paths = require('../src/core/paths');

const SELF_OPEN_ID = process.env.IM_BRIDGE_SELF_OPEN_ID || process.env.DINGTALK_SELF_OPEN_ID || '';
const FAKE_SENDER = 'D_FAKE_SENDER_E2E_TEST_001';
const results = [];

function log(name, ok, detail) {
  results.push({ name, ok, detail });
  process.stderr.write(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}\n`);
}

async function runScenario(name, text, listenKind, channel) {
  const eventId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const evt = {
    type: 'message',
    event_id: eventId,
    message_id: `${eventId}-msg`,
    conversation_id: channel === 'group' ? 'cid_e2e_test_group' : undefined,
    sender_open_dingtalk_id: FAKE_SENDER,
    sender: 'E2E测试同事',
    content: text,
  };
  const intent = classifyIntent(text);
  const replies = await handleMessage(evt, listenKind);
  if (!replies || !replies.length) {
    log(name, false, 'router 无回复');
    return;
  }
  const sent = [];
  for (const reply of replies) {
    const target = {
      channel: 'direct',
      sender_open_dingtalk_id: SELF_OPEN_ID,
      text: channel === 'direct' ? reply.text : `[模拟群${listenKind}] ${reply.text}`,
    };
    const out = send(target);
    sent.push({ text: reply.text.slice(0, 60), ok: out.ok, error: out.error });
  }
  log(name, sent.every((item) => item.ok), `intent=${intent} replies=${sent.length} ${JSON.stringify(sent)}`);
}

async function main() {
  if (!SELF_OPEN_ID) {
    console.error('请设置 IM_BRIDGE_SELF_OPEN_ID 或 DINGTALK_SELF_OPEN_ID 后再跑 E2E');
    process.exit(1);
  }
  store.ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const convFile = path.join(paths.dirs.state, 'conversations.json');
  if (fs.existsSync(convFile)) {
    fs.copyFileSync(convFile, path.join(paths.dirs.state, `conversations.backup-${stamp}.json`));
  }

  await runScenario('general_ack', '在吗', 'all-direct', 'direct');
  await runScenario('dip_s4', 'LE009 S4 401 帮忙看下', 'all-direct', 'direct');
  await runScenario('new_feature_req', 'YJ2RQ202610223704 运单撤销优化 请开发', 'at-me', 'group');

  const jobs = fs.readdirSync(paths.dirs.inbox).filter((name) => name.endsWith('.json'));
  const wake = fs.existsSync(paths.files.wakeFlag);
  log('inbox_jobs', jobs.length >= 1, jobs.join(', ') || 'empty');
  log('agent_wake_flag', wake, wake ? fs.readFileSync(paths.files.wakeFlag, 'utf8').trim() : 'missing');

  process.stdout.write(`${JSON.stringify({ results, jobs }, null, 2)}\n`);
  process.exit(results.some((item) => !item.ok) ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
