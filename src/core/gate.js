'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const dws = require('../adapters/im/dws');
const { classifyIntent, parseReqId, isCasualChat, hasBusinessSignals } = require('./intent');

const CACHE_FILE = path.join(config.dirs.state, 'sender-org-cache.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(map) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(map, null, 2) + '\n', 'utf8');
}

function deptNamesFromGetResult(data) {
  const rows = data?.result || [];
  const names = [];
  for (const row of rows) {
    const depts = row?.orgEmployeeModel?.depts || [];
    for (const dept of depts) {
      if (dept.deptName) names.push(String(dept.deptName));
      if (dept.deptPathName) names.push(String(dept.deptPathName));
    }
  }
  return [...new Set(names)];
}

function matchAllowedDept(deptNames) {
  const patterns = config.policy.replyDeptPatterns || [];
  if (!patterns.length) return true;
  return deptNames.some((label) =>
    patterns.some((keyword) => {
      const escaped = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(escaped).test(label);
    })
  );
}

function resolveUserId(openDingTalkId, displayName) {
  const cache = loadCache();
  const hit = cache[openDingTalkId];
  if (hit?.userId && Date.now() - (hit.checkedAt || 0) < CACHE_TTL_MS) return hit.userId;

  let userId = null;
  const byOpen = dws.json([
    'contact', 'user', 'get-by-open-dingtalk-id',
    '--open-dingtalk-id', openDingTalkId,
    '-f', 'json',
  ]);
  if (byOpen?.userId) userId = byOpen.userId;
  if (!userId && byOpen?.result?.userId) userId = byOpen.result.userId;

  const name = String(displayName || '').replace(/\(.*\)/g, '').trim();
  if (!userId && name) {
    const search = dws.json(['contact', 'user', 'search', '--query', name, '-f', 'json']);
    const list = search?.result || [];
    const row = list.find((user) => user.openDingTalkId === openDingTalkId) || list[0] || null;
    if (row?.userId) userId = row.userId;
  }

  if (userId) {
    cache[openDingTalkId] = { userId, displayName: name, checkedAt: Date.now() };
    saveCache(cache);
  }
  return userId;
}

function resolveDeptNames(openDingTalkId, displayName) {
  if (!openDingTalkId) return [];
  const cache = loadCache();
  const hit = cache[openDingTalkId];
  if (hit?.deptNames?.length && Date.now() - (hit.checkedAt || 0) < CACHE_TTL_MS) return hit.deptNames;

  const userId = resolveUserId(openDingTalkId, displayName);
  if (!userId) return [];

  const detail = dws.json(['contact', 'user', 'get', '--user-id', String(userId), '-f', 'json']);
  const deptNames = deptNamesFromGetResult(detail);
  cache[openDingTalkId] = { ...(cache[openDingTalkId] || {}), userId, deptNames, checkedAt: Date.now() };
  saveCache(cache);
  return deptNames;
}

function isAllowedSender(openDingTalkId, displayName) {
  if (!config.policy.gateSenderDept) return { ok: true, depts: [] };
  const depts = resolveDeptNames(openDingTalkId, displayName);
  if (!depts.length) return { ok: false, reason: '无法解析提问者部门，默认不回复' };
  if (!matchAllowedDept(depts)) return { ok: false, reason: `部门不在允许范围（${depts.join(' / ')}）` };
  return { ok: true, depts };
}

function isWorkRequirement(text, intent, conv, job) {
  if (!config.policy.gateWorkOnly) return true;
  if (conv?.phase !== 'idle' && conv?.jobId && job) return true;
  if (isCasualChat(text)) return false;
  if (intent === 'GENERAL') return false;
  if (parseReqId(text)) return true;
  return hasBusinessSignals(text);
}

async function evaluateDeptInbound(evt, listenKind) {
  const channel = listenKind === 'all-direct' ? 'direct' : 'group';
  const dept = isAllowedSender(evt.sender_open_dingtalk_id, evt.sender || '');
  if (!dept.ok) return { allow: false, reason: dept.reason, channel };
  return { allow: true, depts: dept.depts, channel };
}

async function evaluateInbound(evt, conv, job, listenKind) {
  const gate = await evaluateDeptInbound(evt, listenKind);
  if (!gate.allow) return gate;
  const text = String(evt.content || '').trim();
  const intent = classifyIntent(text);
  if (!isWorkRequirement(text, intent, conv, job)) {
    return {
      allow: false,
      reason: isCasualChat(text) ? '寒暄或无实质内容' : `非业务类消息（intent=${intent}）`,
      channel: gate.channel,
    };
  }
  return { allow: true, intent, depts: gate.depts, channel: gate.channel };
}

module.exports = {
  evaluateDeptInbound,
  evaluateInbound,
  isAllowedSender,
  isCloudDeliverySender: isAllowedSender,
  isWorkRequirement,
  resolveDeptNames,
};
