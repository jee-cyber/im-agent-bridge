'use strict';

const config = require('./config');

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"')\]\u2019\u3001]+/gi;

function extractHttpUrls(text) {
  const raw = String(text || '').match(URL_IN_TEXT_RE) || [];
  const normalized = raw.map((url) => url.replace(/[.,;:!?，。；：！？]+$/u, '').trim());
  return [...new Set(normalized.filter(Boolean))];
}

function isAllowedProjectUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  const haystack = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
  return config.profile.linkPatterns.some((pattern) => pattern.test(haystack) || pattern.test(urlString));
}

function evaluateLinkInbound(text) {
  if (!config.policy.gateLinks) return { allow: true };
  const urls = extractHttpUrls(text);
  if (!urls.length) return { allow: true };
  if (!config.profile.linkPatterns.length) return { allow: true, urls };
  const rejected = urls.filter((url) => !isAllowedProjectUrl(url));
  if (rejected.length) {
    return {
      allow: false,
      reason: `含未允许链接（${rejected.length}/${urls.length}）`,
      urls: rejected,
    };
  }
  return { allow: true, urls };
}

module.exports = {
  evaluateLinkInbound,
  extractHttpUrls,
  isAllowedProjectUrl,
};
