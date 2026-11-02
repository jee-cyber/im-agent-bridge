'use strict';

const config = require('./config');

function parseReqId(text) {
  const m = text.match(config.reqIdPattern);
  return m ? m[0].toUpperCase() : null;
}

/** 大众 SQDZ 需求号 RQ… */
function parseSqdzReqId(text) {
  const m = String(text || '').match(/RQ\d{9,}/i);
  return m ? m[0].toUpperCase() : null;
}

function classifyIntent(text) {
  const hasReq = !!parseReqId(text);
  if (config.dipKeywords.test(text) && !hasReq) {
    return 'DIP';
  }
  if (hasReq || config.featureKeywords.test(text)) {
    return 'NEW_FEATURE';
  }
  if (config.handleKeywords.test(text)) {
    return 'HANDLE';
  }
  return 'GENERAL';
}

/** 寒暄/无实质内容，不做业务回复 */
function isCasualChat(text) {
  const t = String(text || '').trim();
  if (!t || t.length <= 2) return true;
  return /^(在吗|在不在|你好|您好|早上好|下午好|晚上好|谢谢|多谢|好的|收到|嗯嗯?|ok|okay|hi|hello|嗨)[\s!?？。~…]*$/i.test(
    t
  );
}

/** 是否含明确业务信号（需求编号、DIP、接口、排障、Spec 等） */
function hasBusinessSignals(text) {
  const t = String(text || '').trim();
  if (!t || isCasualChat(t)) return false;
  if (parseReqId(t) || parseSqdzReqId(t)) return true;
  return config.businessKeywords.test(t);
}

module.exports = {
  classifyIntent,
  parseReqId,
  parseSqdzReqId,
  isCasualChat,
  hasBusinessSignals,
};
