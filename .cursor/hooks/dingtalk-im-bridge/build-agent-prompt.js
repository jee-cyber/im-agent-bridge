'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

function buildPrompt(job, opts = {}) {
  const pendingAbs = path.join(
    config.aiWorkflowRoot,
    '.cursor/hooks/dingtalk-im-bridge/pending-reply.json'
  );
  const workflowAbs = job.workflowRel
    ? path.join(config.aiWorkflowRoot, job.workflowRel)
    : config.aiWorkflowRoot;
  const lines = [
    '【钉钉工单·FULL_AUTO】你必须在本回合内完成处理并写回执文件，不要等待用户确认。',
    `模型：${config.agentModel}（Composer 2.5 系）。`,
    job.projectLabel
      ? `项目：${job.projectLabel}（${job.project || 'yurun'}），优先工作区：${workflowAbs}`
      : '',
    '',
    '```json',
    JSON.stringify(job, null, 2),
    '```',
    '',
    '按 `.cursor/hooks/dingtalk-im-bridge/AGENT-PROMPTS.md` 执行：',
    `- phase=${job.phase} type=${job.type}`,
    job.skills?.length ? `- Skills: ${job.skills.join(', ')}` : '',
    '',
    '**结束前必做（否则视为失败）**：',
    `1. 写入文件（绝对路径）：${pendingAbs}`,
    '2. JSON 格式：',
    '```json',
    JSON.stringify(
      {
        jobId: job.jobId,
        body: '（见下方钉钉正文规范）',
        completeJob: true,
      },
      null,
      2
    ),
    '```',
    '',
    '**body 字段 = 直接发钉钉给提问顾问的正文（纯文本）**：',
    '- 只写业务结论：接口编码、报错含义、要对方核对什么、下一步要什么信息',
    '- 禁止：jobId、日志路径、bash/node 命令、仓库路径、gitignore、代码块、Markdown 表格、英文文件名',
    '- 结构建议：①一句话结论 ②编号核对清单（≤6条） ③请对方回复什么',
    '3. 必须写入上述 pending-reply 绝对路径；禁止只写到 docs/ 下其它文件。',
    '4. DIP：yurun-dip-publish；密钥勿入 Git；默认不 enable。',
  ];
  if (opts.fullAuto) {
    lines.push('5. headless 模式：直接执行，不要反问「是否开始」。');
  }
  return lines.join('\n');
}

function writePromptFiles(job, opts = {}) {
  const hooksDir = path.join(__dirname, '..');
  const prompt = buildPrompt(job, opts);
  fs.writeFileSync(path.join(hooksDir, 'dingtalk-open-chat-prompt.txt'), prompt + '\n', 'utf8');
  fs.writeFileSync(path.join(hooksDir, 'dingtalk-auto-prompt.md'), prompt + '\n', 'utf8');
  return prompt;
}

module.exports = { buildPrompt, writePromptFiles };
