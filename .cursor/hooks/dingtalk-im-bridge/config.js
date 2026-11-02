'use strict';

const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..');

/**
 * 解析允许自动回复的提问者部门名关键词（逗号/竖线分隔）。
 * 部门名或 deptPathName 任一包含即视为「云交付相关部门」。
 */
function parseReplyDeptPatterns() {
  const raw = process.env.DINGTALK_REPLY_DEPT || '云交付';
  return raw
    .split(/[,，|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function defaultCursorBin() {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    return path.join(local, 'Programs', 'cursor', 'Cursor.exe');
  }
  return '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
}

module.exports = {
  aiWorkflowRoot: root,
  /** 必填：dws 身份 openDingTalkId，防回复死循环（env: DINGTALK_SELF_OPEN_ID） */
  selfOpenDingTalkId: process.env.DINGTALK_SELF_OPEN_ID || '',
  cursorBin: process.env.CURSOR_CLI || defaultCursorBin(),
  fullAuto: process.env.DINGTALK_FULL_AUTO !== '0',
  fullAutoTimeoutMs: Number(process.env.DINGTALK_AGENT_TIMEOUT_MS || 900000),
  /** 钉钉 FULL_AUTO 调用 cursor-agent 的模型，默认 Composer 2.5（env: DINGTALK_AGENT_MODEL） */
  agentModel: process.env.DINGTALK_AGENT_MODEL || 'composer-2.5',
  cursorAgentBin: process.env.CURSOR_AGENT_BIN || '',
  dirs: {
    state: path.join(__dirname, 'state'),
    inbox: path.join(__dirname, 'inbox'),
    media: path.join(__dirname, 'media'),
  },
  policy: {
    autoCodeInGroup: true,
    complexClarifyQuestionThreshold: 3,
    directClarifyInPlace: true,
    /** 仅部门名匹配的提问者才自动回复（dws 通讯录）；关：DINGTALK_GATE_CLOUD_DEPT=0 */
    gateCloudDeliveryDept: process.env.DINGTALK_GATE_CLOUD_DEPT !== '0',
    /** 部门白名单关键词列表，默认「云交付」匹配云交付研发部等 */
    replyDeptPatterns: parseReplyDeptPatterns(),
    /** 须判定为开发/需求/DIP/排障类才回复；关：DINGTALK_GATE_WORK=0 */
    gateWorkOnly: process.env.DINGTALK_GATE_WORK !== '0',
    /** 群聊仅处理 @我 事件（dws at-me）；单聊走 all-direct，同样过部门+业务门禁 */
    groupAtMeOnly: true,
  },
  reqIdPattern: /(YJ2RQ|RJ2RQ)\d+/gi,
  /** 云交付三项目：工作流根目录（相对 aiWorkflowRoot）与默认 Skills */
  projects: {
    yurun: {
      label: '雨润',
      workflowRel: 'yurun/ai-workflow',
      defaultSkills: ['yurun-fullflow', 'yurun-dip-publish'],
    },
    hnmtly: {
      label: '明泰',
      workflowRel: 'hnmtly/ai-workflow',
      defaultSkills: [],
    },
    sqdz: {
      label: '上汽大众SQDZ',
      workflowRel: 'sqdz/sqdzout-tms-java',
      defaultSkills: [],
    },
  },
  dipKeywords:
    /DIP|tmsdemo|S4|ECC|ECS|YURUN_LE|运单同步|模拟|发布|接口配置|出站|管道|SAP|PO\b|401|会话失效|字段约束/i,
  featureKeywords: /新功能|新需求|开发|需求|页面|字段|流程|导出|优化|改造|YJ2RQ|RJ2RQ/i,
  handleKeywords: /处理|排查|修|问题|报错|失败|帮忙|看一下/i,
  /** 业务门禁：单聊/群聊均须命中其一才自动回复（进行中的工单会话除外） */
  businessKeywords:
    /YJ2RQ\d+|RJ2RQ\d+|RQ\d{9,}|DIP|tmsdemo|S4|ECC|ECS|YURUN_|Spec|\.spec-workflow|skill|工单|联调|接口|报错|异常|失败|发布|编码|新功能|新需求|需求编号|页面|字段|流程|导出|改造|优化|运单|401|会话失效|接口配置|出站|管道|SAP|PO\b|字段约束|明泰|hnmtly|sqdz|上汽大众|Outbound|工位器具|行车|配载|WMS|TMS/i,
  ackText: '已收到，我看一下。',
  templates: {
    askReqId:
      '这是新功能类需求的话，请先给需求编号（如 YJ2RQ202610223704）和一句话名称。若是 S4/ECC 接口配置问题，请回复 S4 或 ECC，并带上接口编码或报错原文。',
    askSystem: '请确认是 S4 还是 ECC 相关？回复 S4 或 ECC，并补充接口编码或报错信息。',
    queuedAgent: (jobId) =>
      `已入队（${jobId}），我会在 Cursor 里按项目 Spec/Skill 处理；有结论会在本对话或单聊回复你。`,
    complexClarifyIntro: (reqId) =>
      `【${reqId || '需求'}】有几项需要和你单独确认，后续几条我会私信你，群里先不展开细节。`,
  },
  dws: {
    listenFormat: ['-f', 'ndjson'],
    profile: process.env.DWS_PROFILE || '',
  },
};
