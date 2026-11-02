'use strict';

const fs = require('fs');
const path = require('path');
const { dirs, files } = require('./paths');

function ensureDirs() {
  require('./paths').ensureDirs();
}

function conversationKey(evt) {
  return evt.conversation_id || evt.sender_open_dingtalk_id || 'unknown';
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function loadConversations() {
  return loadJson(path.join(dirs.state, 'conversations.json'), {});
}

function saveConversations(map) {
  saveJson(path.join(dirs.state, 'conversations.json'), map);
}

function loadSeen() {
  return loadJson(path.join(dirs.state, 'seen-events.json'), {});
}

function saveSeen(map) {
  const keys = Object.keys(map);
  if (keys.length > 5000) {
    keys.sort();
    map = Object.fromEntries(keys.slice(-3000).map((key) => [key, map[key]]));
  }
  saveJson(path.join(dirs.state, 'seen-events.json'), map);
}

function writeJob(job) {
  ensureDirs();
  const file = path.join(dirs.inbox, `${job.jobId}.json`);
  saveJson(file, job);
  return file;
}

function readJob(jobId) {
  return loadJson(path.join(dirs.inbox, `${jobId}.json`), null);
}

function listPendingJobs() {
  ensureDirs();
  const names = fs.readdirSync(dirs.inbox).filter((name) => name.endsWith('.json'));
  return names
    .map((name) => loadJson(path.join(dirs.inbox, name), null))
    .filter(Boolean)
    .sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''));
}

function appendAgentWake(record) {
  ensureDirs();
  const line = JSON.stringify({ ...record, at: new Date().toISOString() }) + '\n';
  fs.appendFileSync(path.join(dirs.state, 'agent-wake.jsonl'), line, 'utf8');
  fs.writeFileSync(files.wakeFlag, record.jobId + '\n', 'utf8');
}

function clearConversationForJob(job) {
  const conversations = loadConversations();
  const key = job.conversation_id || job.sender_open_dingtalk_id;
  if (key && conversations[key]?.jobId === job.jobId) {
    conversations[key] = { phase: 'idle', jobId: null };
    saveConversations(conversations);
  }
}

function clearAgentWakeFlag() {
  if (fs.existsSync(files.wakeFlag)) fs.unlinkSync(files.wakeFlag);
}

module.exports = {
  ensureDirs,
  conversationKey,
  loadConversations,
  saveConversations,
  loadSeen,
  saveSeen,
  writeJob,
  readJob,
  listPendingJobs,
  appendAgentWake,
  clearConversationForJob,
  clearAgentWakeFlag,
};
