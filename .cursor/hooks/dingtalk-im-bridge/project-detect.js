'use strict';

const config = require('./config');
const { parseReqId } = require('./intent');

/** 大众 / SQDZ 需求与业务词 */
const SQDZ_RE =
  /RQ\d{9,}|上汽大众|sqdz|Outbound|outbound|工位器具|LCMS|OMD|TOS\+TMS|sqdzout/i;

/** 明泰 / hnmtly 需求与业务词 */
const HNMTLY_RE =
  /明泰|hnmtly|mingtai|数字明泰|铝业WT|行车|配载|库内交易|RF队列|WMS.*明泰|TMS.*明泰/i;

/** 雨润（默认云交付三项目之一） */
const YURUN_RE = /雨润|yurun|YURUN_|哈尔滨大众肉联/i;

/** 暂不支持自动流水线的其它客户（仅无三项目信号时轻量回复） */
const UNSUPPORTED_CUSTOMER_RE = /洛阳钼业|钼业(?!.*明泰)/i;

/**
 * 解析 SQDZ 需求号（RQ 开头）。
 * @param {string} text
 * @returns {string|null}
 */
function parseSqdzReqId(text) {
  const m = String(text || '').match(/RQ\d{9,}/i);
  return m ? m[0].toUpperCase() : null;
}

/**
 * 判定消息所属交付项目（雨润 / 明泰 / 大众 sqdz）。
 * @param {string} text
 * @returns {'yurun'|'hnmtly'|'sqdz'}
 */
function detectProject(text) {
  const t = String(text || '');
  if (parseSqdzReqId(t) || SQDZ_RE.test(t)) {
    return 'sqdz';
  }
  if (HNMTLY_RE.test(t)) {
    return 'hnmtly';
  }
  if (parseReqId(t) || YURUN_RE.test(t) || config.dipKeywords.test(t)) {
    return 'yurun';
  }
  return 'yurun';
}

/**
 * @param {'yurun'|'hnmtly'|'sqdz'} project
 */
function projectMeta(project) {
  const key = config.projects[project] ? project : 'yurun';
  return config.projects[key];
}

/**
 * 是否命中三项目之一的需求/开发类信号。
 * @param {string} text
 */
function hasTriProjectBusinessSignals(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (parseReqId(t) || parseSqdzReqId(t)) return true;
  if (SQDZ_RE.test(t) || HNMTLY_RE.test(t) || YURUN_RE.test(t)) return true;
  return config.businessKeywords.test(t);
}

module.exports = {
  detectProject,
  projectMeta,
  parseSqdzReqId,
  hasTriProjectBusinessSignals,
  UNSUPPORTED_CUSTOMER_RE,
};
