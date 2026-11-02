/**
 * sessionStart：有工单唤醒标记时，把 inbox 任务注入 Agent。
 */
const fs = require('fs');
const path = require('path');
const paths = require('../../src/core/paths');
const config = require('../../src/core/config');

function readStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function loadJob(jobId) {
  const file = path.join(paths.dirs.inbox, `${jobId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const raw = readStdin().trim();
  if (!raw.startsWith('{')) {
    process.stdout.write('{}');
    return;
  }
  if (!fs.existsSync(paths.files.wakeFlag)) {
    process.stdout.write('{}');
    return;
  }
  const jobId = fs.readFileSync(paths.files.wakeFlag, 'utf8').trim();
  const job = loadJob(jobId);
  if (!job) {
    process.stdout.write('{}');
    return;
  }
  const prompts = fs.existsSync(paths.files.promptsDoc)
    ? fs.readFileSync(paths.files.promptsDoc, 'utf8')
    : '见 docs/AGENT-PROMPTS.md';
  const ctx = [
    `【IM 工单】模型 ${config.agentModel}。本回合优先处理以下 inbox 任务（直接执行；完成后更新 job.phase，并把回执写到 data/pending-reply.json）：`,
    '```json',
    JSON.stringify(job, null, 2),
    '```',
    '执行说明摘要：',
    prompts.slice(0, 4000),
  ].join('\n');
  const payload = { additional_context: ctx };
  fs.mkdirSync(paths.dirs.data, { recursive: true });
  fs.writeFileSync(paths.files.lastInject, ctx.slice(0, 12000), 'utf8');
  process.stdout.write(JSON.stringify(payload));
}

main();
