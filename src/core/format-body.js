'use strict';

/** 钉钉给顾问的正文：去 Markdown、截断技术句 */
function formatConsultantBody(raw) {
  if (!raw) return '';
  let t = String(raw);
  t = t.replace(/^【202610\d+-[\w]+】自动处理结束[\s\S]*?--- 摘要 ---\s*/m, '');
  t = t.replace(/```[\s\S]*?```/g, '');
  t = t.replace(/\*\*/g, '');
  t = t.replace(/^#+\s*/gm, '');
  t = t.replace(/\|[^|\n]+\|/g, '');
  t = t.replace(/`[^`]+`/g, (m) => m.replace(/`/g, ''));
  t = t.replace(/请在本机执行[\s\S]*$/m, '');
  t = t.replace(/pending-reply[\s\S]*?gitignore[\s\S]*?\n\n/gi, '');
  t = t.replace(/docs\/\S+\.json/g, '');
  t = t.replace(/\.cursor\/hooks\/\S+/g, '');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

module.exports = { formatConsultantBody };
