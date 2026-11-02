'use strict';

/**
 * 不连钉钉，只验证 profile 分流与入队结果。
 * IM_BRIDGE_HOME 指向临时目录，避免碰本机 data/。
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'im-bridge-'));
process.env.IM_BRIDGE_HOME = home;
process.env.IM_BRIDGE_PROFILE = 'yurun-tms';
process.env.IM_BRIDGE_GATE_DEPT = '0';
process.env.IM_BRIDGE_DISABLE_WAKE = '1';
process.env.IM_BRIDGE_SELF_OPEN_ID = 'self-e2e';

const config = require('../src/core/config');
const { routeInbound } = require('../src/core/route');
const { handleMessage } = require('../src/core/router');
const { evaluateLinkInbound } = require('../src/core/link-gate');
const store = require('../src/core/store');

let seq = 0;

function fail(message) {
  console.error('FAIL', message);
  process.exitCode = 1;
}

function check(name, ok, detail) {
  if (!ok) fail(`${name}: ${detail}`);
  else console.log('PASS', name);
}

function route(text, extra) {
  return routeInbound({
    messageText: text,
    quotedText: '',
    hasActiveJob: false,
    activeJobProject: null,
    ...extra,
  });
}

async function inbound(text, listenKind) {
  seq += 1;
  const id = `evt-${seq}`;
  const conversationId = `cid-${seq}`;
  const replies = await handleMessage(
    {
      event_id: id,
      message_id: id,
      conversation_id: conversationId,
      sender_open_dingtalk_id: 'sender-1',
      sender: '同事',
      content: text,
    },
    listenKind || 'all-direct'
  );
  const conv = store.loadConversations()[conversationId];
  const job = conv?.jobId ? store.readJob(conv.jobId) : null;
  return { replies: replies || [], job };
}

async function main() {
  assert.strictEqual(config.profileName, 'yurun-tms');

  const feature = route('YJ2RQ202610223704 运单撤销优化 请开发');
  check('yurun-req-route', feature.route === 'AUTO_AGENT' && feature.extracted.project === 'yurun', JSON.stringify(feature.extracted));

  const sqdz = route('RQ2026102237041 Outbound 接口逻辑');
  check('sqdz-route', sqdz.route === 'AUTO_AGENT' && sqdz.extracted.project === 'sqdz', sqdz.extracted.project);

  const hnmtly = route('明泰 行车 配载 查一下菜单逻辑');
  check('hnmtly-route', hnmtly.extracted.project === 'hnmtly', hnmtly.extracted.project);

  const casual = route('在吗');
  check('casual-silent-class', casual.route === 'LIGHT_REPLY', casual.route);

  const unsupported = route('洛阳钼业 帮我看下合同');
  check('unsupported', unsupported.route === 'LIGHT_REPLY', unsupported.reason);

  check('link-reject', evaluateLinkInbound('看下 https://evil.example/a').allow === false, 'expected reject');
  check('link-doc', evaluateLinkInbound('https://alidocs.dingtalk.com/i/nodes/abc').allow === true, 'expected allow');
  check(
    'link-git',
    evaluateLinkInbound('http://192.168.100.155/scm/yurun/ai-workflow').allow === true,
    'expected allow'
  );

  const silent = await inbound('在吗');
  check('casual-no-reply', silent.replies.length === 0, String(silent.replies.length));

  const blocked = await inbound('帮我看 https://evil.example/invite');
  check('evil-link-no-reply', blocked.replies.length === 0, String(blocked.replies.length));

  const dip = await inbound('LE009 S4 401 帮忙看下');
  check('dip-type', dip.job && dip.job.type === 'DIP_S4' && dip.job.phase === 'DIP_RUN', `${dip.job?.type}/${dip.job?.phase}`);
  check('dip-skill', dip.job?.skills?.includes('yurun-dip-publish'), JSON.stringify(dip.job?.skills));
  check('dip-project', dip.job?.project === 'yurun', dip.job?.project);

  const ask = await inbound('DIP 接口配置 出站管道');
  check('dip-ask', ask.job?.type === 'DIP_UNKNOWN' && ask.job?.phase === 'AWAIT_SYSTEM', `${ask.job?.type}/${ask.job?.phase}`);

  const spec = await inbound('YJ2RQ202610223704 运单撤销优化 请开发');
  check('feature-phase', spec.job?.type === 'NEW_FEATURE' && spec.job?.phase === 'SPEC_BOOTSTRAP' && spec.job?.project === 'yurun', `${spec.job?.type}/${spec.job?.phase}/${spec.job?.project}`);
  check('feature-spec', String(spec.job?.specDir || '').includes('YJ2RQ202610223704'), spec.job?.specDir);
  check(
    'feature-skills',
    spec.job?.skills?.includes('yurun-fullflow') && spec.job?.skills?.includes('yurun-req-practice'),
    JSON.stringify(spec.job?.skills)
  );

  const needId = await inbound('新功能 导出 页面');
  check('ask-req', needId.job?.phase === 'ASK_REQ_ID', needId.job?.phase);

  const lookup = await inbound('RQ2026102237999 车辆登记 菜单 查询');
  check('sqdz-job', lookup.job?.project === 'sqdz', lookup.job?.project);
  check('sqdz-not-feature-ask', lookup.job?.phase !== 'ASK_REQ_ID', lookup.job?.phase);

  const threadId = `cid-thread-${Date.now()}`;
  async function say(text) {
    seq += 1;
    return handleMessage(
      {
        event_id: `thr-${seq}`,
        message_id: `thr-${seq}`,
        conversation_id: threadId,
        sender_open_dingtalk_id: 'sender-1',
        sender: '同事',
        content: text,
      },
      'all-direct'
    );
  }
  await say('接口配置 出站 发布一下');
  await say('ECC 会话失效');
  const threadJob = store.readJob(store.loadConversations()[threadId].jobId);
  check('follow-ecc', threadJob?.type === 'DIP_ECC' && threadJob?.phase === 'DIP_RUN' && threadJob?.dipSystem === 'ECC', `${threadJob?.type}/${threadJob?.phase}/${threadJob?.dipSystem}`);

  const child = spawnSync(process.execPath, ['-e', `
    process.env.IM_BRIDGE_PROFILE = 'default';
    process.env.IM_BRIDGE_GATE_DEPT = '0';
    process.env.IM_BRIDGE_HOME = ${JSON.stringify(home + '-default')};
    const config = require(${JSON.stringify(path.join(repoRoot, 'src/core/config.js'))});
    if (config.profileName !== 'default') process.exit(2);
    const blob = JSON.stringify(config.projects);
    if (/雨润|云交付|YJ2RQ|明泰/.test(blob)) process.exit(3);
  `], { encoding: 'utf8' });
  check('default-profile', child.status === 0, child.stderr || child.stdout || String(child.status));

  if (process.exitCode) process.exit(process.exitCode);
  console.log('routing ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
