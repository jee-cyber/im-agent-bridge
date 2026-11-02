'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const paths = require('./paths');

function modelLine() {
  if (config.agent.modelHint) return `${config.agentModel}（${config.agent.modelHint}）`;
  return config.agentModel;
}

function buildPrompt(job) {
  const pendingAbs = paths.files.pendingReply;
  const workflowAbs = job.workflowRel ? path.join(config.workspaceRoot, job.workflowRel) : config.workspaceRoot;
  const lines = [
    '【IM 工单·FULL_AUTO】你必须在本回合内完成处理并写回执文件，不要等待用户确认。',
    `模型：${modelLine()}。`,
    job.projectLabel ? `项目：${job.projectLabel}（${job.project || config.defaultProject}），优先工作区：${workflowAbs}` : '',
    '',
    '```json',
    JSON.stringify(job, null, 2),
    '```',
    '',
    `按 \`${path.relative(config.workspaceRoot, paths.files.promptsDoc)}\` 执行：`,
    `- phase=${job.phase} type=${job.type}`,
    job.skills?.length ? `- Skills: ${job.skills.join(', ')}` : '',
    '',
    '**结束前必做（否则视为失败）**：',
    `1. 写入文件（绝对路径）：${pendingAbs}`,
    '2. JSON 格式：',
    '```json',
    JSON.stringify({ jobId: job.jobId, body: '（见下方正文规范）', completeJob: true }, null, 2),
    '```',
    '',
    '**body 字段 = 直接发给提问人的正文（纯文本）**：',
    '- 只写业务结论：接口编码、报错含义、要对方核对什么、下一步要什么信息',
    '- 禁止：jobId、日志路径、命令、仓库路径、代码块、Markdown 表格',
    '- 结构建议：①一句话结论 ②编号核对清单（≤6条） ③请对方回复什么',
    '3. 必须写入上述绝对路径。',
    '4. 密钥勿入 Git；默认不 enable。',
    '5. headless 模式：直接执行，不要反问「是否开始」。',
  ];
  return lines.filter((line) => line !== undefined).join('\n');
}

function writePromptFiles(job) {
  const prompt = buildPrompt(job);
  fs.mkdirSync(path.dirname(paths.files.promptTxt), { recursive: true });
  fs.writeFileSync(paths.files.promptTxt, `${prompt}\n`, 'utf8');
  fs.writeFileSync(paths.files.promptMd, `${prompt}\n`, 'utf8');
  return prompt;
}

module.exports = { buildPrompt, writePromptFiles };
