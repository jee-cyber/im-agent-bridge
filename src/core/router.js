'use strict';

const crypto = require('crypto');
const config = require('./config');
const store = require('./store');
const { notifyAgentWake } = require('./notify');
const { evaluateDeptInbound } = require('./gate');
const { evaluateLinkInbound } = require('./link-gate');
const { classifyIntent, parseReqId, parseExtraRequirement } = require('./intent');
const { buildRouteContext, routeInbound, applyFollowUpJobPatch } = require('./route');

function newJobId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function channelOf(evt, listenKind) {
  return listenKind === 'all-direct' ? 'direct' : 'group';
}

function pickTitle(text, reqId) {
  if (!reqId || !config.reqIdPattern) return null;
  const rest = text.replace(new RegExp(config.reqIdPattern.source, 'gi'), '').replace(/\s+/g, ' ').trim();
  return rest.slice(0, 80) || null;
}

function shouldClarifyInDirect(job, questionCount, complexFlag) {
  if (job.channel === 'direct' && config.policy.directClarifyInPlace) return false;
  if (complexFlag) return true;
  return questionCount >= config.policy.complexClarifyQuestionThreshold;
}

function planClarifyDelivery(job, payload) {
  const questions = payload.questions || [];
  const complex = payload.complexClarify || shouldClarifyInDirect(job, questions.length, false);
  if (complex && job.channel === 'group') {
    return {
      channel: 'direct',
      introInGroup: config.templates.complexClarifyIntro(job.requirementId),
      text:
        payload.body ||
        `【${job.requirementId || '需求'}】请确认：\n` +
          questions.map((question, index) => `${index + 1}. ${question}`).join('\n'),
    };
  }
  const text =
    payload.body ||
    (questions.length
      ? `【${job.requirementId || '需求'}】请确认：\n${questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}`
      : '');
  return { channel: job.channel, text, introInGroup: null };
}

function messageRecord(evt, text, channel) {
  return {
    at: new Date().toISOString(),
    from: 'asker',
    text,
    channel,
    message_id: evt.message_id || null,
    images: evt.media?.images || [],
    mediaIds: evt.media?.mediaIds || [],
  };
}

function stampProject(job, decision) {
  const project = decision?.extracted?.project || job.project || config.defaultProject;
  const meta = config.projectMeta(project);
  job.project = project;
  job.projectLabel = decision?.extracted?.projectLabel || meta?.label || project;
  job.workflowRel = decision?.extracted?.workflowRel || meta?.workflowRel || '';
  if (decision?.auto_agent_skills_hint?.length && !job.skills?.length) {
    job.skills = decision.auto_agent_skills_hint.slice();
  }
  return job;
}

function resolveSkills(jobType, decision, projectKey) {
  if (!jobType.skillsFromProject) return (jobType.skills || []).slice();
  if (decision?.auto_agent_skills_hint?.length) return decision.auto_agent_skills_hint.slice();
  const project = config.projects[projectKey];
  if (project?.defaultSkills?.length) return project.defaultSkills.slice();
  return (jobType.fallbackSkills || []).slice();
}

function wakeAgent(job, phase, note) {
  job.phase = phase;
  job.updatedAt = new Date().toISOString();
  store.writeJob(job);
  store.appendAgentWake({
    jobId: job.jobId,
    phase,
    type: job.type,
    requirementId: job.requirementId,
    specDir: job.specDir,
    note: note || '',
  });
  notifyAgentWake(job, phase, note);
}

function blankJob(evt, channel, text, fields) {
  const now = new Date().toISOString();
  const job = {
    jobId: newJobId(),
    type: fields.type,
    phase: fields.phase,
    requirementId: fields.requirementId ?? null,
    title: fields.title ?? null,
    specDir: fields.specDir ?? null,
    dipSystem: fields.dipSystem ?? null,
    skills: fields.skills || [],
    conversation_id: evt.conversation_id,
    sender_open_dingtalk_id: evt.sender_open_dingtalk_id,
    sender_display: evt.sender || '',
    channel,
    messages: [messageRecord(evt, text, channel)],
    autoCodeAfterClarify: !!fields.autoCodeAfterClarify,
    createdAt: now,
    updatedAt: now,
  };
  if (fields.setAutoCodeInGroup) job.autoCodeInGroup = config.policy.autoCodeInGroup;
  return job;
}

function boundFields(jobType, text, reqId, extraReqId) {
  const title =
    jobType.titleFrom === 'text'
      ? text.slice(0, 80)
      : jobType.titleFrom === 'rest'
        ? pickTitle(text, reqId)
        : null;
  let requirementId = null;
  if (jobType.bindRequirement === 'primary') requirementId = reqId;
  else if (jobType.bindRequirement === 'any') requirementId = reqId || extraReqId;
  const specSource = jobType.specOn === 'primary' || jobType.requiresRequirementId ? reqId : null;
  return {
    requirementId,
    title,
    specDir: specSource ? config.renderSpecDir(jobType, specSource, title) : null,
  };
}

function remember(job, convKey, conversations) {
  store.writeJob(job);
  conversations[convKey] = { phase: job.phase, jobId: job.jobId };
}

function resolveJobTypeKey(intent, decision) {
  if (intent && intent !== 'GENERAL' && config.profile.intentMap[intent]) {
    return config.profile.intentMap[intent];
  }
  const hint = decision?.extracted?.intentHint;
  if (hint === 'CODE_LOOKUP' && config.profile.intentMap.CODE_LOOKUP) {
    return config.profile.intentMap.CODE_LOOKUP;
  }
  if (decision?.route === 'AUTO_AGENT') return config.profile.intentMap.OPS || 'ops';
  return null;
}

function openJob(evt, channel, text, decision, reqId, extraReqId, intent) {
  const jobType = config.jobTypeByKey(resolveJobTypeKey(intent, decision));
  if (!jobType) return null;
  const projectKey = decision?.extracted?.project || config.defaultProject;
  const skills = resolveSkills(jobType, decision, projectKey);
  const fields = boundFields(jobType, text, reqId, extraReqId);

  if (jobType.requiresRequirementId && !reqId) {
    const job = blankJob(evt, channel, text, {
      ...fields,
      requirementId: null,
      title: null,
      specDir: null,
      type: jobType.type,
      phase: jobType.phases.awaitRequirement,
      skills,
      autoCodeAfterClarify: jobType.autoCodeAfterClarify,
      setAutoCodeInGroup: jobType.setAutoCodeInGroup,
    });
    stampProject(job, decision);
    return {
      job,
      replies: [config.templates.askReqId],
      wake: null,
    };
  }

  const variant = config.matchVariant(jobType, text);
  if (jobType.variant && variant) {
    const dest = config.jobTypeByKey(variant.jobType) || jobType;
    const job = blankJob(evt, channel, text, {
      ...fields,
      type: dest.type,
      phase: dest.phases.run,
      dipSystem: variant.label,
      skills,
      autoCodeAfterClarify: jobType.autoCodeAfterClarify,
    });
    stampProject(job, decision);
    return {
      job,
      replies: [config.templates.queuedAgent(job.jobId)],
      wake: { phase: dest.phases.run, note: config.replyTemplate('wakeVariant', { label: variant.label }) },
    };
  }

  if (jobType.variant) {
    const job = blankJob(evt, channel, text, {
      ...fields,
      type: jobType.type,
      phase: jobType.phases.awaitVariant,
      skills,
      autoCodeAfterClarify: jobType.autoCodeAfterClarify,
    });
    stampProject(job, decision);
    return { job, replies: [jobType.variant.ask || config.templates.askSystem], wake: null };
  }

  const phase = jobType.phases.bootstrap || jobType.phases.run;
  const job = blankJob(evt, channel, text, {
    ...fields,
    type: jobType.type,
    phase,
    skills,
    autoCodeAfterClarify: jobType.autoCodeAfterClarify,
    setAutoCodeInGroup: jobType.setAutoCodeInGroup,
  });
  stampProject(job, decision);
  const note =
    jobType.phases.bootstrap && phase === jobType.phases.bootstrap
      ? config.replyTemplate('wakeBootstrap')
      : job.type === config.jobTypeByKey(config.profile.intentMap.CODE_LOOKUP || '')?.type
        ? config.replyTemplate('wakeLookup', { projectLabel: job.projectLabel || '项目' })
        : config.replyTemplate('wakeOps', { reason: decision?.reason || '业务消息入队' });
  return {
    job,
    replies: [config.templates.queuedAgent(job.jobId)],
    wake: { phase, note },
  };
}

async function handleMessage(evt, listenKind) {
  const eventId = evt.event_id || evt.message_id;
  if (!eventId || !evt.content) return;

  if (evt.sender_open_dingtalk_id && evt.sender_open_dingtalk_id === config.selfOpenDingTalkId && config.selfOpenDingTalkId) {
    return [];
  }

  const seen = store.loadSeen();
  if (seen[eventId]) return;

  const channel = channelOf(evt, listenKind);
  const convKey = store.conversationKey(evt);
  const conversations = store.loadConversations();
  let conv = conversations[convKey] || { phase: 'idle', jobId: null };
  const text = String(evt.content).trim();
  const intent = classifyIntent(text);
  const reqId = parseReqId(text);
  const extraReqId = parseExtraRequirement(text);
  const replies = [];
  const replyTarget = {
    channel,
    conversation_id: evt.conversation_id,
    sender_open_dingtalk_id: evt.sender_open_dingtalk_id,
  };

  const jobForGate = conv.phase !== 'idle' && conv.jobId ? store.readJob(conv.jobId) : null;
  const gate = await evaluateDeptInbound(evt, listenKind);
  if (!gate.allow) {
    seen[eventId] = Date.now();
    store.saveSeen(seen);
    process.stderr.write(`[门禁] 忽略 ${gate.channel === 'direct' ? '单聊' : '群聊'} sender=${evt.sender || ''} ${gate.reason || ''}\n`);
    return [];
  }

  const linkGate = evaluateLinkInbound(text);
  if (!linkGate.allow) {
    seen[eventId] = Date.now();
    store.saveSeen(seen);
    const sample = (linkGate.urls || []).slice(0, 2).join(' | ');
    process.stderr.write(`[链接门禁] 静默 ${gate.channel === 'direct' ? '单聊' : '群聊'} ${linkGate.reason || ''} ${sample}\n`);
    return [];
  }

  seen[eventId] = Date.now();
  store.saveSeen(seen);

  const decision = routeInbound(buildRouteContext(evt, conv, jobForGate, listenKind));
  process.stderr.write(`[路由] ${decision.route} ${decision.reason} project=${decision.extracted?.project || '-'} conf=${decision.confidence}\n`);

  if (decision.route === 'LIGHT_REPLY' || decision.route === 'CLARIFY') {
    process.stderr.write(`[路由] 静默不回复 route=${decision.route} reason=${decision.reason || ''}\n`);
    conversations[convKey] = conv;
    store.saveConversations(conversations);
    return [];
  }

  if (decision.reply_text) replies.push({ ...replyTarget, text: decision.reply_text });

  if (conv.phase !== 'idle' && conv.jobId) {
    const job = store.readJob(conv.jobId);
    if (job) {
      job.messages.push(messageRecord(evt, text, channel));
      const role = config.phaseRole(job.phase);
      const currentType = config.jobTypeByType(job.type);
      if (role === 'awaitRequirement' && reqId) {
        const feature = currentType || config.jobTypeByKey(config.profile.intentMap.NEW_FEATURE || 'feature');
        job.requirementId = reqId;
        job.title = pickTitle(text, reqId) || job.title;
        job.specDir = feature ? config.renderSpecDir(feature, reqId, job.title) : job.specDir;
        const next = feature?.phases.bootstrap || job.phase;
        wakeAgent(job, next, config.replyTemplate('wakeReqReceived'));
        replies.push({ ...replyTarget, text: config.templates.queuedAgent(job.jobId) });
      } else if (role === 'awaitVariant' && currentType) {
        const token = config.matchVariant(currentType, text);
        if (token) {
          const dest = config.jobTypeByKey(token.jobType) || currentType;
          job.dipSystem = token.label;
          job.type = dest.type;
          wakeAgent(job, dest.phases.run, config.replyTemplate('wakeVariantFollow', { label: token.label }));
          replies.push({ ...replyTarget, text: config.templates.queuedAgent(job.jobId) });
        } else if (decision.route === 'AUTO_AGENT') {
          applyFollowUpJobPatch(job, text, decision);
          wakeAgent(job, job.phase, decision.reason || '顾问追加说明');
        }
      } else if (role === 'clarify' || role === 'bootstrap' || role === 'codeLookup') {
        if (role === 'codeLookup') {
          wakeAgent(job, job.phase, '补充上下文后继续查代码');
          replies.push({ ...replyTarget, text: config.templates.followLookup });
        } else {
          const next = config.phaseName('clarify') || job.phase;
          job.phase = next;
          wakeAgent(job, next, '提问者补充澄清');
          replies.push({ ...replyTarget, text: config.templates.followClarify });
        }
      } else if (role === 'readyCode') {
        replies.push({ ...replyTarget, text: config.templates.progressNote });
      } else if (decision.route === 'AUTO_AGENT') {
        applyFollowUpJobPatch(job, text, decision);
        wakeAgent(job, job.phase, decision.reason || '顾问追加说明');
      }
      job.updatedAt = new Date().toISOString();
      store.writeJob(job);
      conv.phase = job.phase;
      conversations[convKey] = conv;
      store.saveConversations(conversations);
      return replies;
    }
  }

  const opened = openJob(evt, channel, text, decision, reqId, extraReqId, intent);
  if (opened) {
    if (opened.wake) wakeAgent(opened.job, opened.wake.phase, opened.wake.note);
    else store.writeJob(opened.job);
    for (const textReply of opened.replies) {
      if (textReply) replies.push({ ...replyTarget, text: textReply });
    }
    remember(opened.job, convKey, conversations);
    store.saveConversations(conversations);
    return replies;
  }

  conversations[convKey] = conv;
  store.saveConversations(conversations);
  return replies;
}

module.exports = {
  handleMessage,
  planClarifyDelivery,
  wakeAgent,
  parseReqId,
  classifyIntent,
  shouldClarifyInDirect,
};
