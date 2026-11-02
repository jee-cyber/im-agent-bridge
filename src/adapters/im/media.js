'use strict';

const fs = require('fs');
const path = require('path');
const dws = require('./dws');
const paths = require('../../core/paths');

const MEDIA_HINT =
  /\[图片\]|\[图片消息\]|\[Image\]|\[photo\]|发送了一张图片|图片消息|mediaId/i;

function walkForMediaIds(node, out) {
  if (node == null) return;
  if (typeof node === 'string') {
    if (node.startsWith('@') && node.length > 8) out.add(node);
    const matched = node.match(/mediaId[=:]?\s*([A-Za-z0-9@_+\-/=]+)/i);
    if (matched) out.add(matched[1]);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => walkForMediaIds(item, out));
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (/mediaId|media_id|resourceId|resource_id/i.test(key) && typeof value === 'string') out.add(value);
      walkForMediaIds(value, out);
    }
  }
}

function extractMediaIds(content) {
  const ids = new Set();
  if (!content) return [];
  walkForMediaIds(content, ids);
  if (typeof content === 'string') {
    try {
      walkForMediaIds(JSON.parse(content), ids);
    } catch {
      const re = /"mediaId"\s*:\s*"([^"]+)"/gi;
      let matched;
      while ((matched = re.exec(content))) ids.add(matched[1]);
    }
  }
  return [...ids].filter(Boolean);
}

function listMessageById(conversationId, messageId) {
  const data = dws.json(
    ['chat', 'message', 'list', '--conversation-id', conversationId, '--limit', '20', '--direction', 'newer'],
    { cwd: paths.workspaceRoot, timeout: 60000 }
  );
  if (!data) return null;
  const messages = data.messages || data.result?.messages || [];
  return messages.find(
    (row) => row.messageId === messageId || row.openMessageId === messageId || row.message_id === messageId
  );
}

function downloadTo(outputDir, resourceId, messageId, conversationId) {
  fs.mkdirSync(outputDir, { recursive: true });
  const relOut = path.relative(paths.workspaceRoot, outputDir);
  if (relOut.startsWith('..')) return { ok: false, error: 'output escapes workspace' };
  const result = dws.downloadResource({
    resourceId,
    messageId,
    conversationId,
    output: relOut || '.',
    cwd: paths.workspaceRoot,
  });
  if (!result.ok) return { ok: false, error: String(result.error || '').slice(0, 500) };
  const files = fs.existsSync(outputDir) ? fs.readdirSync(outputDir).map((name) => path.join(outputDir, name)) : [];
  return { ok: true, files, stdout: result.stdout };
}

function enrichEventMedia(evt) {
  const media = { images: [], mediaIds: [], errors: [] };
  if (!evt.message_id || !evt.conversation_id) return media;

  let ids = extractMediaIds(evt.rawContent || evt.content || '');
  const needsLookup = !ids.length && (MEDIA_HINT.test(evt.content || '') || !String(evt.content || '').trim());
  if (needsLookup) {
    const row = listMessageById(evt.conversation_id, evt.message_id);
    if (row) ids = extractMediaIds(JSON.stringify(row));
    if (row?.text && !evt.content) evt.content = String(row.text).trim();
  }

  media.mediaIds = ids;
  if (!ids.length) return media;

  const outDir = path.join(paths.dirs.media, String(evt.message_id).replace(/[^\w+/=-]/g, '_').slice(0, 80));
  for (const resourceId of ids) {
    const downloaded = downloadTo(outDir, resourceId, evt.message_id, evt.conversation_id);
    if (downloaded.ok && downloaded.files?.length) {
      for (const file of downloaded.files) {
        if (/\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(file) || !path.extname(file)) {
          media.images.push(path.relative(paths.workspaceRoot, file));
        }
      }
    } else {
      media.errors.push({ resourceId, error: downloaded.error || 'download failed' });
    }
  }
  return media;
}

function buildTextForIntent(evt, media) {
  const parts = [];
  if (evt.content) parts.push(evt.content);
  if (media.images.length) parts.push(`[图片×${media.images.length}]`);
  else if (media.mediaIds.length && !media.images.length) {
    parts.push(`[媒体附件 mediaId×${media.mediaIds.length} 下载失败或未识别为图片]`);
  }
  return parts.join('\n').trim() || '[仅媒体消息]';
}

module.exports = { enrichEventMedia, buildTextForIntent, extractMediaIds, MEDIA_HINT };
