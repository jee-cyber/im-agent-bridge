'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { dwsSpawnOptions } = require('./resolve-dws-bin');
const { classifyIntent, parseReqId, isCasualChat, hasBusinessSignals } = require('./intent');

const CACHE_FILE = path.join(config.dirs.state, 'sender-org-cache.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function dwsArgs(tail) {
  const profile = config.dws.profile || process.env.DWS_PROFILE;
  return profile ? ['--profile', profile, ...tail] : tail;
}

function runDwsJson(args) {
  const { command, args: spawnArgs } = dwsSpawnOptions(dwsArgs(args));
  const result = spawnSync(command, spawnArgs, {
    encoding: 'utf8',
    timeout: 45000,
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout || '{}');
  } catch {
    return null;
  }
}

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
    for (const d of depts) {
      if (d.deptName) names.push(String(d.deptName));
      if (d.deptPathName) names.push(String(d.deptPathName));
    }
  }
  return [...new Set(names)];
}

/**
 * 提问者部门是否属于云交付相关部门（config.policy.replyDeptPatterns 任一命中即可）。
 */
function matchCloudDelivery(deptNames) {
  const patterns = config.policy.replyDeptPatterns || ['云交付'];
  if (!patterns.length) return true;
  return deptNames.some((deptLabel) =>
    patterns.some((keyword) => {
      const escaped = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(escaped).test(deptLabel);
    })
  );
}

function resolveUserId(openDingTalkId, displayName) {
  const cache = loadCache();
  const hit = cache[openDingTalkId];
  if (hit?.userId && Date.now() - (hit.checkedAt || 0) < CACHE_TTL_MS) {
    return hit.userId;
  }

  let userId = null;
  const byOpen = runDwsJson([
    'contact',
    'user',
    'get-by-open-dingtalk-id',
    '--open-dingtalk-id',
    openDingTalkId,
    '-f',
    'json',
  ]);
  if (byOpen?.userId) userId = byOpen.userId;
  if (!userId && byOpen?.result?.userId) userId = byOpen.result.userId;

  const name = String(displayName || '')
    .replace(/\(.*\)/g, '')
    .trim();
  if (!userId && name) {
    const search = runDwsJson([
      'contact',
      'user',
      'search',
      '--query',
      name,
      '-f',
      'json',
    ]);
    const list = search?.result || [];
    const row =
      list.find((u) => u.openDingTalkId === openDingTalkId) || list[0] || null;
    if (row?.userId) userId = row.userId;
  }

  if (userId) {
    cache[openDingTalkId] = {
      userId,
      displayName: name,
      checkedAt: Date.now(),
    };
    saveCache(cache);
  }
  return userId;
}

function resolveDeptNames(openDingTalkId, displayName) {
  if (!openDingTalkId) return [];
  const cache = loadCache();
  const hit = cache[openDingTalkId];
  if (hit?.deptNames?.length && Date.now() - (hit.checkedAt || 0) < CACHE_TTL_MS) {
    return hit.deptNames;
  }

  const userId = resolveUserId(openDingTalkId, displayName);
  if (!userId) return [];

  const detail = runDwsJson([
    'contact',
    'user',
    'get',
    '--user-id',
    String(userId),
    '-f',
    'json',
  ]);
  const deptNames = deptNamesFromGetResult(detail);
  cache[openDingTalkId] = {
    ...(cache[openDingTalkId] || {}),
    userId,
    deptNames,
    checkedAt: Date.now(),
  };
  saveCache(cache);
  return deptNames;
}

function isCloudDeliverySender(openDingTalkId, displayName) {
  if (!config.policy.gateCloudDeliveryDept) return true;
  const depts = resolveDeptNames(openDingTalkId, displayName);
  if (!depts.length) {
    return { ok: false, reason: '无法解析提问者部门，默认不回复' };
  }
  if (!matchCloudDelivery(depts)) {
    return {
      ok: false,
      reason: `非云交付部门（${depts.join(' / ')}）`,
    };
  }
  return { ok: true, depts };
}

/**
 * 是否为业务相关消息（需求/DIP/排障/Spec 等）。进行中工单内短回复放行。
 */
function isWorkRequirement(text, intent, conv, job) {
  if (!config.policy.gateWorkOnly) return true;
  if (conv?.phase !== 'idle' && conv?.jobId && job) {
    return true;
  }
  if (isCasualChat(text)) return false;
  if (intent === 'GENERAL') return false;
  if (parseReqId(text)) return true;
  if (intent === 'DIP' || intent === 'NEW_FEATURE' || intent === 'HANDLE') {
    return hasBusinessSignals(text);
  }
  return hasBusinessSignals(text);
}

/**
 * 仅部门门禁：云交付相关部门才进入路由（非云交付静默、不回复）。
 * 业务分流见 message-route.js：未命中 AUTO_AGENT 的寒暄/范围外消息同样静默。
 *
 * @returns {Promise<{ allow: boolean, reason?: string, depts?: string[], channel?: string }>}
 */
async function evaluateDeptInbound(evt, listenKind) {
  const openId = evt.sender_open_dingtalk_id;
  const displayName = evt.sender || '';
  const channel = listenKind === 'all-direct' ? 'direct' : 'group';

  const dept = isCloudDeliverySender(openId, displayName);
  if (!dept.ok) {
    return {
      allow: false,
      reason: dept.reason,
      channel,
    };
  }

  return { allow: true, depts: dept.depts, channel };
}

/** @deprecated 使用 evaluateDeptInbound + message-route */
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
  isCloudDeliverySender,
  isWorkRequirement,
  resolveDeptNames,
};
