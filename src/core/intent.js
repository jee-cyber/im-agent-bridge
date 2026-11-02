'use strict';

const config = require('./config');

function parseReqId(text) {
  return config.parseRequirement(text, 'primary');
}

function parseExtraRequirement(text) {
  const body = String(text || '');
  for (const item of config.profile.requirementIds) {
    if (!item.pattern || item.name === 'primary') continue;
    const matched = body.match(item.pattern);
    if (matched) return matched[0].toUpperCase();
  }
  return null;
}

function hasPrimaryRequirement(text) {
  return !!parseReqId(text);
}

function classifyIntent(text) {
  const body = String(text || '');
  const hasReq = hasPrimaryRequirement(body);
  for (const key of config.profile.detectOrder) {
    const rule = config.profile.detect[key];
    if (!rule) continue;
    const keywordHit = !!(rule.keywords && rule.keywords.test(body));
    if (rule.unlessPrimaryRequirement && hasReq) continue;
    if (rule.orPrimaryRequirement && (hasReq || keywordHit)) return rule.intent;
    if (!rule.orPrimaryRequirement && keywordHit) return rule.intent;
  }
  return 'GENERAL';
}

function isCasualChat(text) {
  const body = String(text || '').trim();
  if (!body || body.length <= 2) return true;
  return !!(config.profile.casual && config.profile.casual.test(body));
}

function hasAnyRequirement(text) {
  return config.profile.requirementIds.some((item) => item.pattern && item.pattern.test(text));
}

function hasBusinessSignals(text) {
  const body = String(text || '').trim();
  if (!body || isCasualChat(body)) return false;
  if (hasAnyRequirement(body)) return true;
  return !!(config.profile.signals && config.profile.signals.test(body));
}

module.exports = {
  classifyIntent,
  parseReqId,
  parseExtraRequirement,
  isCasualChat,
  hasBusinessSignals,
  hasAnyRequirement,
};
