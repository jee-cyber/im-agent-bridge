'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const paths = require('./paths');

const pendingPath = paths.files.pendingReply;

function docsCandidates(jobId) {
  const base = path.join(config.workspaceRoot, 'docs');
  const hits = [];
  if (!fs.existsSync(base)) return hits;
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) stack.push(file);
      else if (name === `pending-reply-${jobId}.json`) hits.push(file);
    }
  }
  return hits;
}

function collectPendingReply(jobId) {
  if (fs.existsSync(pendingPath)) return pendingPath;
  for (const source of docsCandidates(jobId)) {
    try {
      fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
      fs.copyFileSync(source, pendingPath);
      return pendingPath;
    } catch {
      /* 换下一个候选 */
    }
  }
  return null;
}

module.exports = { collectPendingReply, pendingPath, docsCandidates };
