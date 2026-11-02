'use strict';

const crypto = require('crypto');
const config = require('./config');
const store = require('./store');
const { notifyAgentWake } = require('./notify');
const { evaluateDeptInbound } = require('./sender-gate');
const { evaluateLinkInbound } = require('./link-gate');
const { classifyIntent, parseReqId, parseSqdzReqId } = require('./intent');
const {
  buildRouteContext,
  routeInbound,
  applyFollowUpJobPatch,
} = require('./message-route');

function newJobId() {
  const t = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${t}-${crypto.randomBytes(3).toString('hex')}`;
}

function channelOf(evt, listenKind) {
  if (listenKind === 'all-direct') return 'direct';
  return 'group';
}

function pickTitle(text, reqId) {
  if (!reqId) return null;
  const rest = text.replace(config.reqIdPattern, '').replace(/\s+/g, ' ').trim();
  return rest.slice(0, 80) || null;
}

function shouldClarifyInDirect(job, questionCount, complexFlag) {
  if (job.channel === 'direct' && config.policy.directClarifyInPlace) {
    return false;
  }
  if (complexFlag) return true;
  return questionCount >= config.policy.complexClarifyQuestionThreshold;
}

/**
 * Agent 或 stop 钩子写入 pending-reply.json 后，由 bridge 或 stop 脚本发送。
 * @param {object} job
 * @param {{ questions?: string[], complexClarify?: boolean, body?: string }} payload
 */
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
          questions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
    };
  }
  const text =
    payload.body ||
    (questions.length
      ? `【${job.requirementId || '需求'}】请确认：\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : '');
  return {
    channel: job.channel,
    text,
    introInGroup: null,
  };
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

/** 写入 job 所属项目（雨润/明泰/大众）与工作流目录，供 Agent 与 FULL_AUTO 使用 */
function stampProject(job, decision) {
  const project = decision?.extracted?.project || job.project || 'yurun';
  const meta = config.projects[project] || config.projects.yurun;
  job.project = project;
  job.projectLabel = decision?.extracted?.projectLabel || meta.label;
  job.workflowRel = decision?.extracted?.workflowRel || meta.workflowRel;
  if (decision?.auto_agent_skills_hint?.length && !job.skills?.length) {
    job.skills = decision.auto_agent_skills_hint;
  }
  return job;
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

async function handleMessage(evt, listenKind) {
  const eventId = evt.event_id || evt.message_id;
  if (!eventId || !evt.content) return;

  if (
    evt.sender_open_dingtalk_id &&
    evt.sender_open_dingtalk_id === config.selfOpenDingTalkId
  ) {
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
  const sqdzReqId = parseSqdzReqId(text);
  const replies = [];

  const replyTarget = {
    channel,
    conversation_id: evt.conversation_id,
    sender_open_dingtalk_id: evt.sender_open_dingtalk_id,
  };

  const jobForGate =
    conv.phase !== 'idle' && conv.jobId ? store.readJob(conv.jobId) : null;
  const gate = await evaluateDeptInbound(evt, listenKind);
  if (!gate.allow) {
    seen[eventId] = Date.now();
    store.saveSeen(seen);
    process.stderr.write(
      `[门禁] 忽略 ${gate.channel === 'direct' ? '单聊' : '群聊'} sender=${evt.sender || ''} ${gate.reason || ''}\n`
    );
    return [];
  }

  const linkGate = evaluateLinkInbound(text);
  if (!linkGate.allow) {
    seen[eventId] = Date.now();
    store.saveSeen(seen);
    const sample = (linkGate.urls || []).slice(0, 2).join(' | ');
    process.stderr.write(
      `[链接门禁] 静默 ${gate.channel === 'direct' ? '单聊' : '群聊'} ${linkGate.reason || ''} ${sample}\n`
    );
    return [];
  }

  seen[eventId] = Date.now();
  store.saveSeen(seen);

  const routeCtx = buildRouteContext(evt, conv, jobForGate, listenKind);
  const decision = routeInbound(routeCtx);
  process.stderr.write(
    `[路由] ${decision.route} ${decision.reason} project=${decision.extracted?.project || '-'} conf=${decision.confidence}\n`
  );

  /** 未入开发助手流水线：静默（部门门禁拦截同理，不打扰用户） */
  if (decision.route === 'LIGHT_REPLY' || decision.route === 'CLARIFY') {
    process.stderr.write(
      `[路由] 静默不回复 route=${decision.route} reason=${decision.reason || ''}\n`
    );
    conversations[convKey] = conv;
    store.saveConversations(conversations);
    return [];
  }

  if (decision.reply_text) {
    replies.push({ ...replyTarget, text: decision.reply_text });
  }

  if (conv.phase !== 'idle' && conv.jobId) {
    const job = store.readJob(conv.jobId);
    if (job) {
      job.messages.push(messageRecord(evt, text, channel));
      let agentWoken = false;
      if (job.phase === 'ASK_REQ_ID' && reqId) {
        job.requirementId = reqId;
        job.title = pickTitle(text, reqId) || job.title;
        job.specDir = `.spec-workflow/specs/${reqId}${job.title ? '-' + job.title.slice(0, 40) : ''}`;
        wakeAgent(job, 'SPEC_BOOTSTRAP', '收到需求编号，开始落盘与设计');
        replies.push({ ...replyTarget, text: config.templates.queuedAgent(job.jobId) });
        agentWoken = true;
      } else if (job.phase === 'AWAIT_SYSTEM' && /S4|ECC/i.test(text)) {
        job.dipSystem = /ECC/i.test(text) ? 'ECC' : 'S4';
        job.type = job.dipSystem === 'ECC' ? 'DIP_ECC' : 'DIP_S4';
        wakeAgent(job, 'DIP_RUN', `确认 ${job.dipSystem}`);
        replies.push({ ...replyTarget, text: config.templates.queuedAgent(job.jobId) });
        agentWoken = true;
      } else if (
        job.phase === 'CLARIFY' ||
        job.phase === 'SPEC_BOOTSTRAP' ||
        job.phase === 'CODE_LOOKUP'
      ) {
        if (job.phase === 'CODE_LOOKUP') {
          wakeAgent(job, 'CODE_LOOKUP', '补充上下文后继续查代码');
          replies.push({ ...replyTarget, text: '收到，我继续查代码逻辑。' });
        } else {
          job.phase = 'CLARIFY';
          wakeAgent(job, 'CLARIFY', '提问者补充澄清');
          replies.push({ ...replyTarget, text: '收到，我更新需求说明后继续。' });
        }
        agentWoken = true;
      } else if (job.phase === 'READY_CODE') {
        replies.push({ ...replyTarget, text: '这单已在编码中，有进展我会回复。' });
      } else if (decision.route === 'AUTO_AGENT') {
        /** DIP_RUN/OPS 等阶段追加说明时，此前只回「收到」未再次 FULL_AUTO */
        applyFollowUpJobPatch(job, text, decision);
        wakeAgent(job, job.phase, decision.reason || '顾问追加说明');
        agentWoken = true;
      }
      job.updatedAt = new Date().toISOString();
      store.writeJob(job);
      conv.phase = job.phase;
      conversations[convKey] = conv;
      store.saveConversations(conversations);
      return replies;
    }
  }

  if (intent === 'DIP' || (intent === 'HANDLE' && config.dipKeywords.test(text))) {
    const job = {
      jobId: newJobId(),
      type: 'DIP_UNKNOWN',
      phase: 'AWAIT_SYSTEM',
      requirementId: null,
      title: null,
      specDir: null,
      dipSystem: null,
      skills: ['yurun-dip-publish'],
      conversation_id: evt.conversation_id,
      sender_open_dingtalk_id: evt.sender_open_dingtalk_id,
      sender_display: evt.sender || '',
      channel,
      messages: [messageRecord(evt, text, channel)],
      autoCodeAfterClarify: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (/S4/i.test(text) && !/ECC/i.test(text)) {
      job.type = 'DIP_S4';
      job.dipSystem = 'S4';
      job.phase = 'DIP_RUN';
      stampProject(job, decision);
      store.writeJob(job);
      wakeAgent(job, 'DIP_RUN', '消息已含 S4');
      replies.push({ ...replyTarget, text: config.templates.queuedAgent(job.jobId) });
    } else if (/ECC/i.test(text)) {
      job.type = 'DIP_ECC';
      job.dipSystem = 'ECC';
      job.phase = 'DIP_RUN';
      stampProject(job, decision);
      store.writeJob(job);
      wakeAgent(job, 'DIP_RUN', '消息已含 ECC');
      replies.push({ ...replyTarget, text: config.templates.queuedAgent(job.jobId) });
    } else {
      stampProject(job, decision);
      store.writeJob(job);
      replies.push({ ...replyTarget, text: config.templates.askSystem });
    }
    conv = { phase: job.phase, jobId: job.jobId };
  } else if (intent === 'NEW_FEATURE' || (intent === 'HANDLE' && config.featureKeywords.test(text))) {
    if (!reqId) {
      const job = {
        jobId: newJobId(),
        type: 'NEW_FEATURE',
        phase: 'ASK_REQ_ID',
        requirementId: null,
        title: null,
        specDir: null,
        skills: ['yurun-fullflow', 'yurun-req-practice'],
        conversation_id: evt.conversation_id,
        sender_open_dingtalk_id: evt.sender_open_dingtalk_id,
        sender_display: evt.sender || '',
        channel,
        messages: [messageRecord(evt, text, channel)],
        autoCodeAfterClarify: true,
        autoCodeInGroup: config.policy.autoCodeInGroup,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      stampProject(job, decision);
      store.writeJob(job);
      replies.push({ ...replyTarget, text: config.templates.askReqId });
      conv = { phase: 'ASK_REQ_ID', jobId: job.jobId };
    } else {
      const title = pickTitle(text, reqId);
      const job = {
        jobId: newJobId(),
        type: 'NEW_FEATURE',
        phase: 'SPEC_BOOTSTRAP',
        requirementId: reqId,
        title,
        specDir: `.spec-workflow/specs/${reqId}${title ? '-' + title.slice(0, 40) : ''}`,
        skills: ['yurun-fullflow', 'yurun-req-practice'],
        conversation_id: evt.conversation_id,
        sender_open_dingtalk_id: evt.sender_open_dingtalk_id,
        sender_display: evt.sender || '',
        channel,
        messages: [messageRecord(evt, text, channel)],
        autoCodeAfterClarify: true,
        autoCodeInGroup: config.policy.autoCodeInGroup,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      stampProject(job, decision);
      store.writeJob(job);
      wakeAgent(job, 'SPEC_BOOTSTRAP', '新功能带编号入队');
      replies.push({ ...replyTarget, text: config.templates.queuedAgent(job.jobId) });
      conv = { phase: 'SPEC_BOOTSTRAP', jobId: job.jobId };
    }
  } else if (intent === 'HANDLE') {
    const job = {
      jobId: newJobId(),
      type: 'DIP_UNKNOWN',
      phase: 'AWAIT_SYSTEM',
      requirementId: null,
      title: null,
      specDir: null,
      dipSystem: null,
      skills: ['yurun-dip-publish'],
      conversation_id: evt.conversation_id,
      sender_open_dingtalk_id: evt.sender_open_dingtalk_id,
      sender_display: evt.sender || '',
      channel,
      messages: [messageRecord(evt, text, channel)],
      autoCodeAfterClarify: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    stampProject(job, decision);
    store.writeJob(job);
    replies.push({ ...replyTarget, text: config.templates.askSystem });
    conv = { phase: 'AWAIT_SYSTEM', jobId: job.jobId };
  } else if (decision.extracted?.intentHint === 'CODE_LOOKUP') {
    const job = {
      jobId: newJobId(),
      type: 'CODE_LOOKUP',
      phase: 'CODE_LOOKUP',
      requirementId: reqId || sqdzReqId,
      title: text.slice(0, 80),
      specDir: null,
      skills: decision.auto_agent_skills_hint?.length
        ? decision.auto_agent_skills_hint
        : config.projects[decision.extracted?.project || 'yurun'].defaultSkills,
      conversation_id: evt.conversation_id,
      sender_open_dingtalk_id: evt.sender_open_dingtalk_id,
      sender_display: evt.sender || '',
      channel,
      messages: [messageRecord(evt, text, channel)],
      autoCodeAfterClarify: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    stampProject(job, decision);
    store.writeJob(job);
    wakeAgent(job, 'CODE_LOOKUP', `${job.projectLabel || '项目'}代码/逻辑查询`);
    replies.push({ ...replyTarget, text: config.templates.queuedAgent(job.jobId) });
    conv = { phase: 'CODE_LOOKUP', jobId: job.jobId };
  } else if (decision.route === 'AUTO_AGENT') {
    const skills =
      decision.auto_agent_skills_hint?.length > 0
        ? decision.auto_agent_skills_hint
        : ['yurun-fullflow'];
    const job = {
      jobId: newJobId(),
      type: 'OPS',
      phase: 'DIP_RUN',
      requirementId: reqId || sqdzReqId,
      title: text.slice(0, 80),
      specDir: reqId
        ? `.spec-workflow/specs/${reqId}${pickTitle(text, reqId) ? '-' + pickTitle(text, reqId).slice(0, 40) : ''}`
        : null,
      skills,
      conversation_id: evt.conversation_id,
      sender_open_dingtalk_id: evt.sender_open_dingtalk_id,
      sender_display: evt.sender || '',
      channel,
      messages: [messageRecord(evt, text, channel)],
      autoCodeAfterClarify: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    stampProject(job, decision);
    store.writeJob(job);
    wakeAgent(job, 'DIP_RUN', decision.reason || '业务消息入队');
    replies.push({ ...replyTarget, text: config.templates.queuedAgent(job.jobId) });
    conv = { phase: job.phase, jobId: job.jobId };
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
