/**
 * stop：读取 data/pending-reply.json，经 dws 回 IM。
 */
const fs = require('fs');
const paths = require('../../src/core/paths');
const { sendPendingReply } = require('../../src/core/outbox');

function readStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  readStdin();
  const out = {};
  sendPendingReply();
  if (fs.existsSync(paths.files.codeFlag)) {
    const jobHint = fs.readFileSync(paths.files.codeFlag, 'utf8').trim();
    out.followup_message =
      '【IM 工单·自动续跑】请按 docs/AGENT-PROMPTS.md 的 READY_CODE 阶段编码。jobId=' + jobHint;
    fs.unlinkSync(paths.files.codeFlag);
  }
  process.stdout.write(JSON.stringify(out));
}

main();
