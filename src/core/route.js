'use strict';

const config = require('./config');
const {
  classifyIntent,
  parseReqId,
  parseExtraRequirement,
  isCasualChat,
  hasBusinessSignals,
} = require('./intent');
const { detectProject, projectMeta, hasTriProjectBusinessSignals } = require('./projects');

function pattern(name) {
  return config.profile.routePatterns[name] || null;
}

function hits(name, text) {
  const re = pattern(name);
  return !!(re && re.test(String(text || '')));
}

function say(name, vars) {
  return config.fill(config.profile.routeReplies[name] || '', {
    modelHint: config.agent.modelHint || config.agent.model,
    projectLabel: vars?.projectLabel || '',
    ...vars,
  });
}

function extractQuotedText(evt) {
  const quoted = evt.quoted_message || evt.quotedMessage;
  if (!quoted) return '';
  if (typeof quoted === 'string') return quoted.trim();
  return String(quoted.text || quoted.content || quoted.textContent || quoted.body || JSON.stringify(quoted)).trim();
}

function buildRouteContext(evt, conv, job, listenKind) {
  return {
    senderName: evt.sender || '',
    conversationType: listenKind === 'all-direct' ? 'direct' : 'group',
    hasActiveJob: conv?.phase !== 'idle' && !!conv?.jobId && !!job,
    activeJobPhase: conv?.phase || 'idle',
    quotedText: extractQuotedText(evt),
    messageText: String(evt.content || '').trim(),
    recentMessages: [],
    activeJobProject: job?.project || null,
  };
}

function oneLineSummary(body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (!text) return say('emptyQuote');
  if (text.length <= 96) return text;
  return `${text.slice(0, 93)}…`;
}

function autoAgentRoute(params) {
  const meta = projectMeta(params.project);
  const keywords = [];
  if (params.reqId) keywords.push(params.reqId);
  if (params.extraReqId) keywords.push(params.extraReqId);
  return {
    route: 'AUTO_AGENT',
    confidence: params.confidence ?? 0.86,
    reason: params.reason,
    reply_text: params.reply_text,
    extracted: {
      reqId: params.reqId || params.extraReqId || null,
      project: params.project,
      projectLabel: meta?.label || params.project,
      workflowRel: meta?.workflowRel || '',
      intentHint: params.intentHint,
      keywords,
    },
    auto_agent_skills_hint: meta?.defaultSkills?.length ? [...meta.defaultSkills] : [],
  };
}

function light(reason, reply, extra) {
  return {
    route: 'LIGHT_REPLY',
    confidence: extra?.confidence ?? 0.8,
    reason,
    reply_text: reply,
    extracted: {
      reqId: null,
      project: extra?.project ?? null,
      intentHint: extra?.intentHint || 'OTHER',
      keywords: extra?.keywords || [],
    },
    auto_agent_skills_hint: [],
  };
}

function clarify(reason, reply, project, intentHint, keywords) {
  return {
    route: 'CLARIFY',
    confidence: 0.78,
    reason,
    reply_text: reply,
    extracted: { reqId: null, project, intentHint, keywords: keywords || [] },
    auto_agent_skills_hint: [],
  };
}

function routeInbound(input) {
  const text = String(input.messageText || '').trim();
  const quoted = String(input.quotedText || '').trim();
  const reqId = parseReqId(text);
  const extraReqId = parseExtraRequirement(text);
  const intent = classifyIntent(text);
  const project = input.activeJobProject || detectProject(text);

  if (input.hasActiveJob) {
    let intentHint = 'OPS';
    let reason = '延续已有工单';
    let reply = say('followUp');
    if (hits('codeLookup', text) || hits('followUpLookup', text)) {
      intentHint = 'CODE_LOOKUP';
      reason = '延续工单·查代码逻辑';
      reply = say('followUpLookup');
    } else if (reqId || extraReqId) {
      intentHint = 'NEW_FEATURE';
      reason = '延续工单·带需求号';
    }
    return autoAgentRoute({
      project,
      reason,
      reply_text: reply,
      intentHint,
      reqId,
      extraReqId,
      confidence: 0.92,
    });
  }

  if (hits('linkOnly', text) && !quoted) {
    return light('裸链接无说明', say('linkOnly'), { confidence: 0.85 });
  }

  if (config.profile.unsupported && config.profile.unsupported.test(text) && !hasTriProjectBusinessSignals(text)) {
    return light('非已配置项目', say('unsupported'), { confidence: 0.88 });
  }

  if (isCasualChat(text) || (hits('office', text) && !hasTriProjectBusinessSignals(text))) {
    if (quoted && hits('quoteSummary', text)) {
      return light('引用摘要', oneLineSummary(quoted), { confidence: 0.9, keywords: ['引用摘要'] });
    }
    return light('办公或寒暄', say('office'), { confidence: 0.82 });
  }

  const proj = detectProject(text);
  const label = projectMeta(proj)?.label || proj;

  if (reqId || extraReqId || intent === config.profile.detect.dip?.intent || (config.dipKeywords && config.dipKeywords.test(text))) {
    const hint = intent === config.profile.detect.dip?.intent || (config.dipKeywords && config.dipKeywords.test(text))
      ? config.profile.detect.dip?.intent || 'DIP'
      : config.profile.detect.feature?.intent || 'NEW_FEATURE';
    return autoAgentRoute({
      project: proj,
      reason: reqId || extraReqId ? '带需求号' : '接口/发布',
      reply_text: say('receivedWork', { projectLabel: label }),
      intentHint: hint,
      reqId,
      extraReqId,
      confidence: 0.9,
    });
  }

  const featureIntent = config.profile.detect.feature?.intent;
  if (intent === featureIntent || (intent === config.profile.detect.issue?.intent && config.featureKeywords && config.featureKeywords.test(text))) {
    return autoAgentRoute({
      project: proj,
      reason: '新需求/功能',
      reply_text: say('receivedFeature', { projectLabel: label }),
      intentHint: featureIntent || 'NEW_FEATURE',
      reqId,
      extraReqId,
    });
  }

  if (hits('codeLookup', text)) {
    if (hits('vagueLookup', text) && !hits('vagueAnchor', text)) {
      return clarify('查逻辑缺定位', say('clarifyLookup'), proj, 'CODE_LOOKUP');
    }
    return autoAgentRoute({
      project: proj,
      reason: '查代码',
      reply_text: say('receivedLookup', { projectLabel: label }),
      intentHint: 'CODE_LOOKUP',
      reqId,
      extraReqId,
      confidence: 0.84,
    });
  }

  if (hits('vagueHandle', text) && !hasBusinessSignals(text)) {
    return clarify('缺执行对象', say('clarifyTarget'), proj, 'OPS');
  }

  if (hasTriProjectBusinessSignals(text) || hasBusinessSignals(text)) {
    return autoAgentRoute({
      project: proj,
      reason: '业务关键词',
      reply_text: say('receivedBusiness', { projectLabel: label }),
      intentHint: intent === 'GENERAL' ? 'OPS' : intent,
      reqId,
      extraReqId,
      confidence: 0.78,
    });
  }

  return light('范围外轻量', say('outOfScope'), { confidence: 0.7 });
}

function applyFollowUpJobPatch(job, text, decision) {
  const project = decision?.extracted?.project || job.project || detectProject(text);
  const meta = projectMeta(project);
  job.project = project;
  job.projectLabel = meta?.label || project;
  job.workflowRel = meta?.workflowRel || '';
  const trimmed = String(text || '').trim();
  if (trimmed) job.title = trimmed.slice(0, 80);
  const hint = decision?.extracted?.intentHint;
  if (hint === 'CODE_LOOKUP' || hits('codeLookup', trimmed)) {
    const lookup = config.jobTypeByKey(config.profile.intentMap.CODE_LOOKUP || 'code_lookup');
    if (lookup) {
      job.type = lookup.type;
      job.phase = lookup.phases.codeLookup || lookup.phases.run;
      if (meta?.defaultSkills?.length) job.skills = [...meta.defaultSkills];
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
