'use strict';

const config = require('./config');

/** 从正文提取 http/https 链接（钉钉分享卡片常带重复 url: 前缀） */
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"')\]\u2019\u3001]+/gi;

/**
 * 三项目相关默认可信链接规则（hostname + pathname 拼成 haystack 做匹配）。
 * 可通过环境变量 DINGTALK_ALLOWED_LINK_EXTRA 追加正则（竖线 | 分隔）。
 */
function buildDefaultLinkPatterns() {
  /** @type {RegExp[]} */
  const patterns = [
    /** 内网 Git：定制仓 yurun / hnmtly / sqdz */
    /192\.168\.100\.155.*\/(yurun|hnmtly|sqdz)\//i,
    /192\.168\.100\.155.*scm\.customization/i,
    /192\.168\.100\.155.*quantum-scm/i,
    /** 雨润 DIP 阿里云 Codeup */
    /codeup\.aliyun\.com.*(di-ai-dip|di-ai-global\/di-ai-dip)/i,
    /codeup\.aliyun\.com.*\/(yurun|hnmtly|sqdz)\//i,
    /** 钉钉文档 / 知识库（三项目 Spec、会议纪要等） */
    /alidocs\.dingtalk\.com/i,
    /(docs|page|h5|qr)\.dingtalk\.com/i,
  ];

  const extra = process.env.DINGTALK_ALLOWED_LINK_EXTRA || '';
  if (extra.trim()) {
    for (const part of extra.split(/[|]/)) {
      const s = part.trim();
      if (!s) continue;
      try {
        patterns.push(new RegExp(s, 'i'));
      } catch {
        process.stderr.write(`[链接门禁] 忽略无效 DINGTALK_ALLOWED_LINK_EXTRA 片段: ${s}\n`);
      }
    }
  }
  return patterns;
}

/** @type {RegExp[] | undefined} */
let cachedPatterns;

function linkAllowPatterns() {
  if (!cachedPatterns) {
    cachedPatterns = buildDefaultLinkPatterns();
  }
  return cachedPatterns;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractHttpUrls(text) {
  const raw = String(text || '').match(URL_IN_TEXT_RE) || [];
  const normalized = raw.map((u) => u.replace(/[.,;:!?，。；：！？]+$/u, '').trim());
  return [...new Set(normalized.filter(Boolean))];
}

/**
 * 单个 URL 是否属于雨润/明泰/大众 SQDZ 相关资源。
 * @param {string} urlString
 */
function isAllowedProjectUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  const haystack = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  return linkAllowPatterns().some((re) => re.test(haystack) || re.test(urlString));
}

/**
 * 消息含 http(s) 链接时：全部链接须命中白名单，否则静默丢弃（不回复、不入队）。
 * 关：DINGTALK_GATE_LINKS=0
 *
 * @param {string} text
 * @returns {{ allow: boolean, reason?: string, urls?: string[] }}
 */
function evaluateLinkInbound(text) {
  if (process.env.DINGTALK_GATE_LINKS === '0') {
    return { allow: true };
  }
  const urls = extractHttpUrls(text);
  if (!urls.length) {
    return { allow: true };
  }
  const rejected = urls.filter((u) => !isAllowedProjectUrl(u));
  if (rejected.length) {
    return {
      allow: false,
      reason: `含非三项目链接（${rejected.length}/${urls.length}）`,
      urls: rejected,
    };
  }
  return { allow: true, urls };
}

module.exports = {
  evaluateLinkInbound,
  extractHttpUrls,
  isAllowedProjectUrl,
  linkAllowPatterns,
};
