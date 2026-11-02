'use strict';

const fs = require('fs');
const { send } = require('../adapters/im/dws');
const { planClarifyDelivery } = require('./router');
const store = require('./store');
const { formatConsultantBody } = require('./format-body');
const paths = require('./paths');

const pendingPath = paths.files.pendingReply;

function writeCodeFlag(jobId) {
  fs.mkdirSync(paths.dirs.data, { recursive: true });
  fs.writeFileSync(paths.files.codeFlag, `${jobId || 'ready'}\n`, 'utf8');
}

function sendPendingReply() {
  if (!fs.existsSync(pendingPath)) return { sent: false, detail: 'no pending-reply.json' };
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  } catch (err) {
    return { sent: false, detail: err.message };
  }
  if (!payload?.jobId) {
    fs.unlinkSync(pendingPath);
    return { sent: false, detail: 'invalid payload' };
  }
  if (payload.body) payload.body = formatConsultantBody(payload.body);

  const job = store.readJob(payload.jobId);
  if (job) {
    const plan = planClarifyDelivery(job, payload);
    const groupTarget = {
      channel: job.channel,
      conversation_id: job.conversation_id,
      sender_open_dingtalk_id: job.sender_open_dingtalk_id,
    };
    if (plan.introInGroup) send({ ...groupTarget, text: plan.introInGroup });
    const directTarget = {
      channel: plan.channel === 'direct' ? 'direct' : job.channel,
      conversation_id: job.conversation_id,
      sender_open_dingtalk_id: job.sender_open_dingtalk_id,
    };
    if (plan.text) {
      const result = send({ ...directTarget, text: plan.text });
      if (!result.ok) return { sent: false, detail: result.error };
    }
    if (payload.nextPhase) {
      job.phase = payload.nextPhase;
      job.updatedAt = new Date().toISOString();
      store.writeJob(job);
      if (payload.nextPhase === 'READY_CODE' && job.autoCodeAfterClarify) writeCodeFlag(job.jobId);
    }
    if (payload.completeJob) {
      job.phase = 'DONE';
      job.updatedAt = new Date().toISOString();
      store.writeJob(job);
      store.clearConversationForJob(job);
      store.clearAgentWakeFlag();
    }
  }
  fs.unlinkSync(pendingPath);
  return { sent: true };
}

function main() {
  const result = sendPendingReply();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.sent ? 0 : 1);
}

if (require.main === module) main();

module.exports = { sendPendingReply, pendingPath };
