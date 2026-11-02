'use strict';

/**
 * 云交付 @/单聊消息路由：AUTO_AGENT | LIGHT_REPLY | CLARIFY。
 * 仅 AUTO_AGENT 会钉钉回复并唤醒开发助手；LIGHT_REPLY/CLARIFY 在 router 层静默丢弃。
 * 支持雨润、明泰（hnmtly）、大众（sqdz）三项目需求/排障/查代码。
 */

const config = require('./config');
const {
  classifyIntent,
  parseReqId,
  isCasualChat,
  hasBusinessSignals,
} = require('./intent');
const {
  detectProject,
  projectMeta,
  parseSqdzReqId,
  hasTriProjectBusinessSignals,
  UNSUPPORTED_CUSTOMER_RE,
} = require('./project-detect');

/** 纯办公/写作类 */
const OFFICE_RE =
  /总结|润色|翻译|改写|写一段|帮我写|闲聊|打卡|表情包|在吗|在不在|早上好|晚上好/i;

/** 查代码/逻辑（三项目通用） */
const CODE_LOOKUP_RE =
  /车辆登记|运单|OpenAPI|Service|页面|按钮|TMS|接口逻辑|代码逻辑|功能实现|菜单|Controller|\.cs\b|查一下.*逻辑|行车|Outbound|调度/i;

/** 系统通知、裸链接 */
const LINK_ONLY_RE = /^https?:\/\/\S+$/i;

/**
 * 从事件中提取引用/转发正文（供「总结引用」类 LIGHT_REPLY）。
 * @param {object} evt
 * @returns {string}
 */
function extractQuotedText(evt) {
  const q = evt.quoted_message || evt.quotedMessage;
  if (!q) return '';
  if (typeof q === 'string') return q.trim();
  return String(
    q.text || q.content || q.textContent || q.body || JSON.stringify(q)
  ).trim();
}

/**
 * @param {object} evt
 * @param {object} conv
 * @param {object|null} job
 * @param {string} listenKind
 */
function buildRouteContext(evt, conv, job, listenKind) {
  const text = String(evt.content || '').trim();
  return {
    senderName: evt.sender || '',
    conversationType: listenKind === 'all-direct' ? 'direct' : 'group',
    hasActiveJob: conv?.phase !== 'idle' && !!conv?.jobId && !!job,
    activeJobPhase: conv?.phase || 'idle',
    quotedText: extractQuotedText(evt),
    messageText: text,
    recentMessages: [],
    activeJobProject: job?.project || null,
  };
}

/** 引用内容压成一句摘要（轻量回复，不跑 Agent） */
function oneLineSummary(body) {
  const t = String(body || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '引用里没看到正文，你可以把要点再贴一次。';
  if (t.length <= 96) return t;
  return `${t.slice(0, 93)}…`;
}

/**
 * 构造 AUTO_AGENT 路由结果。
 * @param {object} params
 */
function autoAgentRoute(params) {
  const {
    project,
    reason,
    reply_text,
    intentHint,
    reqId,
    sqdzReqId,
    keywords,
    confidence = 0.86,
  } = params;
  const meta = projectMeta(project);
  return {
    route: 'AUTO_AGENT',
    confidence,
    reason,
    reply_text,
    extracted: {
      reqId: reqId || sqdzReqId || null,
      project,
      projectLabel: meta.label,
      workflowRel: meta.workflowRel,
      intentHint,
      keywords,
    },
    auto_agent_skills_hint: meta.defaultSkills.length
      ? [...meta.defaultSkills]
      : [],
  };
}

/**
 * @param {ReturnType<typeof buildRouteContext>} input
 */
function routeInbound(input) {
  const text = String(input.messageText || '').trim();
  const quoted = String(input.quotedText || '').trim();
  const reqId = parseReqId(text);
  const sqdzReqId = parseSqdzReqId(text);
  const intent = classifyIntent(text);
  const project = input.activeJobProject || detectProject(text);
  const keywords = [];

  const pushKw = (re) => {
    const m = text.match(re);
    if (m && m[0] && keywords.length < 5) keywords.push(m[0].slice(0, 24));
  };

  if (reqId) keywords.push(reqId);
  if (sqdzReqId) keywords.push(sqdzReqId);

  /** 进行中工单：延续 AUTO_AGENT（按最新正文刷新意图，避免只 ack 不跑 Agent） */
  if (input.hasActiveJob) {
    let intentHint = 'OPS';
    let reason = '延续已有工单';
    let reply_text = '收到，我继续跟这单处理。';
    if (CODE_LOOKUP_RE.test(text) || /查一下.*逻辑|登记查询|菜单.*查询/.test(text)) {
      intentHint = 'CODE_LOOKUP';
      reason = '延续工单·查代码逻辑';
      reply_text = '收到，我继续查代码逻辑。';
    } else if (reqId || sqdzReqId) {
      intentHint = 'NEW_FEATURE';
      reason = '延续工单·带需求号';
    }
    return autoAgentRoute({
      project,
      reason,
      reply_text,
      intentHint,
      reqId,
      sqdzReqId,
      keywords,
      confidence: 0.92,
    });
  }

  if (LINK_ONLY_RE.test(text) && !quoted) {
    return {
      route: 'LIGHT_REPLY',
      confidence: 0.85,
      reason: '裸链接无说明',
      reply_text:
        '链接收到了。请补一句要做什么（YJ2RQ/RQ 需求号、接口编码或报错原文），我好接雨润/明泰/大众对应流水线。',
      extracted: { reqId: null, project: null, intentHint: 'OTHER', keywords: [] },
      auto_agent_skills_hint: [],
    };
  }

  if (
    UNSUPPORTED_CUSTOMER_RE.test(text) &&
    !hasTriProjectBusinessSignals(text)
  ) {
    return {
      route: 'LIGHT_REPLY',
      confidence: 0.88,
      reason: '非三项目客户',
      reply_text:
        '这类客户项目我这边还没接自动流水线；雨润/明泰/上汽大众 SQDZ 的需求请带编号或具体菜单/接口再 @我。',
      extracted: { reqId: null, project: null, intentHint: 'OTHER', keywords },
      auto_agent_skills_hint: [],
    };
  }

  if (isCasualChat(text) || (OFFICE_RE.test(text) && !hasTriProjectBusinessSignals(text))) {
    if (quoted && /总结|一句|概括|摘要/.test(text)) {
      return {
        route: 'LIGHT_REPLY',
        confidence: 0.9,
        reason: '引用摘要',
        reply_text: oneLineSummary(quoted),
        extracted: { reqId: null, project: null, intentHint: 'OTHER', keywords: ['引用摘要'] },
        auto_agent_skills_hint: [],
      };
    }
    return {
      route: 'LIGHT_REPLY',
      confidence: 0.82,
      reason: '办公或寒暄',
      reply_text:
        '在的。我可以接雨润、明泰、大众 SQDZ 的需求/Spec、编码、排障和 DIP；请带需求号或具体功能/接口说明。',
      extracted: { reqId: null, project: null, intentHint: 'OTHER', keywords },
      auto_agent_skills_hint: [],
    };
  }

  const proj = detectProject(text);

  if (reqId || sqdzReqId || intent === 'DIP' || config.dipKeywords.test(text)) {
    pushKw(config.dipKeywords);
    const hint =
      intent === 'DIP' || config.dipKeywords.test(text) ? 'DIP' : 'NEW_FEATURE';
    return autoAgentRoute({
      project: proj,
      reason: reqId || sqdzReqId ? '带需求号' : 'DIP/SAP',
      reply_text: `已收到，我转开发助手（Composer）处理【${projectMeta(proj).label}】这单。`,
      intentHint: hint,
      reqId,
      sqdzReqId,
      keywords,
      confidence: 0.9,
    });
  }

  if (intent === 'NEW_FEATURE' || (intent === 'HANDLE' && config.featureKeywords.test(text))) {
    pushKw(config.featureKeywords);
    return autoAgentRoute({
      project: proj,
      reason: '新需求/功能',
      reply_text: `已收到，我转开发助手处理【${projectMeta(proj).label}】需求/Spec。`,
      intentHint: 'NEW_FEATURE',
      reqId,
      sqdzReqId,
      keywords,
    });
  }

  if (CODE_LOOKUP_RE.test(text)) {
    pushKw(CODE_LOOKUP_RE);
    if (/帮我看看|看一下|查一下/.test(text) && !/页面|菜单|接口|OpenAPI|Service|TMS|Outbound/i.test(text)) {
      return {
        route: 'CLARIFY',
        confidence: 0.75,
        reason: '查逻辑缺定位',
        reply_text:
          '可以帮查代码逻辑。请补：哪个项目（雨润/明泰/大众）、菜单/页面名或 OpenAPI/Service 路径，有 YJ2RQ/RQ 编号也带上。',
        extracted: { reqId: null, project: proj, intentHint: 'CODE_LOOKUP', keywords },
        auto_agent_skills_hint: [],
      };
    }
    return autoAgentRoute({
      project: proj,
      reason: '查代码',
      reply_text: `收到，我转开发助手查【${projectMeta(proj).label}】实现逻辑。`,
      intentHint: 'CODE_LOOKUP',
      reqId,
      sqdzReqId,
      keywords,
      confidence: 0.84,
    });
  }

  if (/处理一下|帮忙看|看一下|排查/.test(text) && !hasBusinessSignals(text)) {
    return {
      route: 'CLARIFY',
      confidence: 0.8,
      reason: '缺执行对象',
      reply_text:
        '要处理哪一块？请说明项目（雨润/明泰/大众）、需求号 YJ2RQ 或 RQ，或接口编码/报错原文、具体功能点。',
      extracted: { reqId: null, project: proj, intentHint: 'OPS', keywords },
      auto_agent_skills_hint: [],
    };
  }

  if (hasTriProjectBusinessSignals(text) || hasBusinessSignals(text)) {
    return autoAgentRoute({
      project: proj,
      reason: '业务关键词',
      reply_text: `已收到，我转开发助手处理【${projectMeta(proj).label}】。`,
      intentHint: intent === 'GENERAL' ? 'OPS' : intent,
      reqId,
      sqdzReqId,
      keywords,
      confidence: 0.78,
    });
  }

  return {
    route: 'LIGHT_REPLY',
    confidence: 0.7,
    reason: '范围外轻量',
    reply_text:
      '我这边自动流水线接雨润/明泰/大众 SQDZ 的需求与排障；请补 YJ2RQ、RQ 编号或接口/报错信息，我再转开发助手。',
    extracted: { reqId: null, project: null, intentHint: 'OTHER', keywords },
    auto_agent_skills_hint: [],
  };
}

/**
 * 顾问追加消息时，把 job 类型/阶段与项目信息同步到最新意图（供 router 写回 inbox 后再 wakeAgent）。
 * @param {object} job
 * @param {string} text
 * @param {ReturnType<typeof routeInbound>} decision
 */
function applyFollowUpJobPatch(job, text, decision) {
  const project =
    decision?.extracted?.project || job.project || detectProject(text);
  const meta = projectMeta(project);
  job.project = project;
  job.projectLabel = meta.label;
  job.workflowRel = meta.workflowRel;
  const trimmed = String(text || '').trim();
  if (trimmed) {
    job.title = trimmed.slice(0, 80);
  }
  const hint = decision?.extracted?.intentHint;
  if (hint === 'CODE_LOOKUP' || CODE_LOOKUP_RE.test(trimmed)) {
    job.type = 'CODE_LOOKUP';
    job.phase = 'CODE_LOOKUP';
    if (meta.defaultSkills?.length) {
      job.skills = [...meta.defaultSkills];
    }
  }
  return job;
}

module.exports = {
  buildRouteContext,
  routeInbound,
  extractQuotedText,
  applyFollowUpJobPatch,
};
