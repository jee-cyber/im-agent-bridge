'use strict';

/**
 * 业务规则全部来自 profiles/<name>.json。
 * 选择顺序：IM_BRIDGE_PROFILE / DINGTALK_PROFILE → profiles/local.json → profiles/yurun-tms.json → profiles/default.json。
 * 旧环境变量 DINGTALK_* 仍然有效，同名 IM_BRIDGE_* 优先。
 */

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const PROFILE_DIR = path.join(paths.repoRoot, 'profiles');
const ROLE_ORDER = [
  'awaitVariant',
  'awaitRequirement',
  'bootstrap',
  'clarify',
  'readyCode',
  'codeLookup',
  'run',
  'done',
];

function envOf(env, primary, legacy) {
  const primaryValue = env[primary];
  if (primaryValue != null && primaryValue !== '') return primaryValue;
  const legacyValue = env[legacy];
  if (legacyValue != null && legacyValue !== '') return legacyValue;
  return '';
}

function flag(env, primary, legacy, profileEnabled) {
  const value = envOf(env, primary, legacy);
  if (value === '0') return false;
  if (value === '1') return true;
  return !!profileEnabled;
}

function toRegExp(source, flags = 'i') {
  if (!source) return null;
  if (source instanceof RegExp) return source;
  const wrapped = String(source).match(/^\/(.*)\/([gimsuy]*)$/);
  if (wrapped) return new RegExp(wrapped[1], wrapped[2] || flags);
  return new RegExp(source, flags);
}

function fill(template, vars) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] == null || vars[key] === '' ? '' : String(vars[key])
  );
}

function splitKeywords(raw) {
  return String(raw || '')
    .split(/[,，|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveProfilePath(env) {
  const explicit = envOf(env, 'IM_BRIDGE_PROFILE', 'DINGTALK_PROFILE');
  if (explicit) {
    const candidate = explicit.endsWith('.json')
      ? path.resolve(explicit)
      : path.join(PROFILE_DIR, `${explicit}.json`);
    if (!fs.existsSync(candidate)) {
      throw new Error(`profile 不存在: ${candidate}`);
    }
    return candidate;
  }
  const local = path.join(PROFILE_DIR, 'local.json');
  if (fs.existsSync(local)) return local;
  const shipped = path.join(PROFILE_DIR, 'yurun-tms.json');
  if (fs.existsSync(shipped)) return shipped;
  return path.join(PROFILE_DIR, 'default.json');
}

function normalizeJobType(name, raw = {}) {
  const variant = raw.variant
    ? {
        ask: raw.variant.ask || '',
        tokens: (raw.variant.tokens || []).map((token) => ({
          match: toRegExp(token.match),
          jobType: token.jobType || name,
          label: token.label || token.jobType || name,
        })),
      }
    : null;
  const specDir =
    typeof raw.specDir === 'string'
      ? { base: raw.specDir, withTitle: raw.specDir }
      : {
          base: raw.specDir?.base || '',
          withTitle: raw.specDir?.withTitle || raw.specDir?.base || '',
        };
  return {
    key: name,
    type: raw.type || name.toUpperCase(),
    skills: raw.skills || [],
    skillsFromProject: !!raw.skillsFromProject,
    fallbackSkills: raw.fallbackSkills || [],
    requiresRequirementId: !!raw.requiresRequirementId,
    bindRequirement: raw.bindRequirement || (raw.requiresRequirementId ? 'primary' : 'none'),
    titleFrom: raw.titleFrom || 'none',
    specOn: raw.specOn || '',
    setAutoCodeInGroup: !!raw.setAutoCodeInGroup,
    autoCodeAfterClarify: !!raw.autoCodeAfterClarify,
    variantLabel: raw.variantLabel || '',
    variant,
    specDir,
    phases: raw.phases || {},
  };
}

function normalize(raw, env) {
  const detectEntries = Object.entries(raw.detect || {});
  const jobTypes = {};
  for (const [name, def] of Object.entries(raw.jobTypes || {})) {
    jobTypes[name] = normalizeJobType(name, def);
  }

  const intentMap = {};
  for (const [, rule] of detectEntries) {
    if (rule.intent && rule.jobType) intentMap[rule.intent] = rule.jobType;
  }
  Object.assign(intentMap, raw.intentMap || {});

  const requirementIds = (raw.requirementIds || []).map((item) => ({
    name: item.name,
    project: item.project || raw.defaultProject || '',
    pattern: toRegExp(item.pattern),
    source: item.pattern || '',
  }));

  const projects = {};
  for (const [key, project] of Object.entries(raw.projects || {})) {
    projects[key] = {
      key,
      label: project.label || key,
      workflowRel: project.workflowRel || '',
      defaultSkills: project.defaultSkills || [],
      detect: toRegExp(project.detect),
      orDip: !!project.orDip,
    };
  }

  const routePatterns = {};
  for (const [key, source] of Object.entries(raw.route?.patterns || {})) {
    routePatterns[key] = toRegExp(source);
  }

  const detect = {};
  for (const [key, rule] of detectEntries) {
    detect[key] = {
      keywords: toRegExp(rule.keywords),
      unlessPrimaryRequirement: !!rule.unlessPrimaryRequirement,
      orPrimaryRequirement: !!rule.orPrimaryRequirement,
      intent: rule.intent || key,
      jobType: rule.jobType || key,
    };
  }

  const deptRaw = envOf(env, 'IM_BRIDGE_DEPT_PATTERN', 'DINGTALK_REPLY_DEPT');
  const replyDeptPatterns = deptRaw
    ? splitKeywords(deptRaw)
    : splitKeywords(raw.gate?.senderDept?.pattern || '');

  return {
    name: raw.name || 'default',
    description: raw.description || '',
    defaultProject: raw.defaultProject || Object.keys(projects)[0] || 'main',
    agentModelHint: raw.agent?.modelHint || '',
    requirementIds,
    signals: toRegExp(raw.signals),
    projects,
    projectDetectOrder: raw.projectDetectOrder || Object.keys(projects),
    unsupported: toRegExp(raw.unsupported?.pattern),
    detect,
    detectOrder: detectEntries.map(([key]) => key),
    casual: toRegExp(raw.casual),
    jobTypes,
    intentMap,
    routePatterns,
    routeReplies: raw.route?.replies || {},
    policy: {
      autoCodeInGroup: raw.policy?.autoCodeInGroup !== false,
      complexClarifyQuestionThreshold: raw.policy?.complexClarifyQuestionThreshold ?? 3,
      directClarifyInPlace: raw.policy?.directClarifyInPlace !== false,
      gateSenderDept: flag(env, 'IM_BRIDGE_GATE_DEPT', 'DINGTALK_GATE_CLOUD_DEPT', raw.gate?.senderDept?.enabled),
      replyDeptPatterns,
      gateWorkOnly: flag(env, 'IM_BRIDGE_GATE_WORK', 'DINGTALK_GATE_WORK', raw.gate?.workOnly?.enabled),
      gateLinks: flag(env, 'IM_BRIDGE_GATE_LINKS', 'DINGTALK_GATE_LINKS', raw.gate?.links?.enabled),
    },
    linkPatterns: [
      ...(raw.gate?.links?.patterns || []).map((item) => toRegExp(item)).filter(Boolean),
      ...String(envOf(env, 'IM_BRIDGE_ALLOWED_LINK_EXTRA', 'DINGTALK_ALLOWED_LINK_EXTRA') || '')
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          try {
            return new RegExp(item, 'i');
          } catch {
            process.stderr.write(`[链接门禁] 忽略无效额外规则: ${item}\n`);
            return null;
          }
        })
        .filter(Boolean),
    ],
    templates: raw.templates || {},
    listenKinds: raw.im?.listenKinds || ['at-me', 'all-direct'],
  };
}

function createConfig(env = process.env) {
  const profilePath = resolveProfilePath(env);
  const profile = normalize(readJson(profilePath), env);
  const primaryReq = profile.requirementIds.find((item) => item.name === 'primary') || profile.requirementIds[0];
  const dipRule = profile.detect.dip;

  function requirementByName(name) {
    return profile.requirementIds.find((item) => item.name === name) || null;
  }

  function parseRequirement(text, name) {
    const item = name ? requirementByName(name) : primaryReq;
    if (!item?.pattern) return null;
    const matched = String(text || '').match(item.pattern);
    return matched ? matched[0].toUpperCase() : null;
  }

  function jobTypeByType(type) {
    return Object.values(profile.jobTypes).find((item) => item.type === type) || null;
  }

  function jobTypeByKey(key) {
    return profile.jobTypes[key] || null;
  }

  function phaseRole(phase) {
    for (const role of ROLE_ORDER) {
      for (const jobType of Object.values(profile.jobTypes)) {
        if (jobType.phases[role] && jobType.phases[role] === phase) return role;
      }
    }
    return null;
  }

  function phaseName(role) {
    for (const jobType of Object.values(profile.jobTypes)) {
      if (jobType.phases[role]) return jobType.phases[role];
    }
    return null;
  }

  function matchVariant(jobType, text) {
    if (!jobType?.variant) return null;
    for (const token of jobType.variant.tokens) {
      if (token.match && token.match.test(text)) return token;
    }
    return null;
  }

  function renderSpecDir(jobType, reqId, title) {
    if (!jobType?.specDir?.base || !reqId) return null;
    const shortTitle = String(title || '').slice(0, 40);
    const template = shortTitle && jobType.specDir.withTitle ? jobType.specDir.withTitle : jobType.specDir.base;
    return fill(template, { reqId, title: shortTitle });
  }

  function projectMeta(project) {
    return profile.projects[project] || profile.projects[profile.defaultProject];
  }

  function replyTemplate(name, vars) {
    const template = profile.templates[name] || profile.routeReplies[name] || '';
    const reqId = vars?.reqId || vars?.requirementId || '需求';
    return fill(template, {
      modelHint: profile.agentModelHint || agent.model,
      projectLabel: '项目',
      reason: '',
      label: '',
      ...vars,
      reqId,
    });
  }

  const agent = {
    model: envOf(env, 'IM_BRIDGE_AGENT_MODEL', 'DINGTALK_AGENT_MODEL') || 'composer-2.5',
    bin: env.CURSOR_AGENT_BIN || env.IM_BRIDGE_AGENT_BIN || '',
    cursorBin: env.CURSOR_CLI || '',
    fullAuto: envOf(env, 'IM_BRIDGE_FULL_AUTO', 'DINGTALK_FULL_AUTO') !== '0',
    timeoutMs: Number(envOf(env, 'IM_BRIDGE_AGENT_TIMEOUT_MS', 'DINGTALK_AGENT_TIMEOUT_MS') || 900000),
    modelHint: profile.agentModelHint,
    sendRetry: Number(envOf(env, 'IM_BRIDGE_SEND_RETRY', 'DINGTALK_SEND_RETRY') || 3),
  };

  return {
    profilePath,
    profileName: profile.name,
    profile,
    paths,
    workspaceRoot: paths.workspaceRoot,
    selfOpenDingTalkId: envOf(env, 'IM_BRIDGE_SELF_OPEN_ID', 'DINGTALK_SELF_OPEN_ID'),
    agent,
    fullAuto: agent.fullAuto,
    fullAutoTimeoutMs: agent.timeoutMs,
    agentModel: agent.model,
    cursorAgentBin: agent.bin,
    cursorBin: agent.cursorBin,
    dirs: paths.dirs,
    files: paths.files,
    policy: profile.policy,
    projects: profile.projects,
    defaultProject: profile.defaultProject,
    listenKinds: profile.listenKinds,
    dws: {
      profile: env.DWS_PROFILE || '',
      listenFormat: ['-f', 'ndjson'],
    },
    primaryReq,
    dipKeywords: dipRule?.keywords || null,
    featureKeywords: profile.detect.feature?.keywords || null,
    handleKeywords: profile.detect.issue?.keywords || null,
    reqIdPattern: primaryReq?.pattern || null,
    parseRequirement,
    jobTypeByType,
    jobTypeByKey,
    phaseRole,
    phaseName,
    matchVariant,
    renderSpecDir,
    projectMeta,
    fill,
    replyTemplate,
    templates: {
      askReqId: profile.templates.askReqId || '',
      askSystem: profile.jobTypes.dip?.variant?.ask || profile.templates.askSystem || '',
      queuedAgent: (jobId) => replyTemplate('queued', { jobId }),
      complexClarifyIntro: (reqId) => replyTemplate('complexClarifyIntro', { reqId: reqId || '需求' }),
      progressNote: profile.templates.progressNote || '',
      followClarify: profile.templates.followClarify || '',
      followLookup: profile.templates.followLookup || '',
    },
  };
}

module.exports = createConfig(process.env);
module.exports.createConfig = createConfig;
