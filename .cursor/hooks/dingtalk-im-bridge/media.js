'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { dwsSpawnOptions } = require('./resolve-dws-bin');

const MEDIA_HINT =
  /\[图片\]|\[图片消息\]|\[Image\]|\[photo\]|发送了一张图片|图片消息|mediaId/i;

function dwsArgs(tail) {
  const profile = config.dws.profile || process.env.DWS_PROFILE;
  return profile ? ['--profile', profile, ...tail] : tail;
}

function walkForMediaIds(node, out) {
  if (node == null) return;
  if (typeof node === 'string') {
    if (node.startsWith('@') && node.length > 8) out.add(node);
    const m = node.match(/mediaId[=:]?\s*([A-Za-z0-9@_+\-/=]+)/i);
    if (m) out.add(m[1]);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((x) => walkForMediaIds(x, out));
    return;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (/mediaId|media_id|resourceId|resource_id/i.test(k) && typeof v === 'string') {
        out.add(v);
      }
      walkForMediaIds(v, out);
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
      let m;
      while ((m = re.exec(content))) ids.add(m[1]);
    }
  }
  return [...ids].filter(Boolean);
}

function listMessageById(conversationId, messageId) {
  const args = dwsArgs([
    'chat',
    'message',
    'list',
    '--conversation-id',
    conversationId,
    '--limit',
    '20',
    '--direction',
    'newer',
    '-f',
    'json',
  ]);
  const { command, args: spawnArgs } = dwsSpawnOptions(args);
  const result = spawnSync(command, spawnArgs, {
    cwd: config.aiWorkflowRoot,
    encoding: 'utf8',
    timeout: 60000,
  });
  if (result.status !== 0) return null;
  let data;
  try {
    data = JSON.parse(result.stdout || '{}');
  } catch {
    return null;
  }
  const messages = data.messages || data.result?.messages || [];
  return messages.find(
    (m) =>
      m.messageId === messageId ||
      m.openMessageId === messageId ||
      m.message_id === messageId
  );
}

function mediaIdsFromListRow(row) {
  if (!row) return [];
  const blob = JSON.stringify(row);
  return extractMediaIds(blob);
}

function downloadResource({ resourceId, messageId, conversationId, outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const relOut = path.relative(config.aiWorkflowRoot, outputDir);
  if (relOut.startsWith('..')) {
    return { ok: false, error: 'output escapes repo' };
  }
  const args = dwsArgs([
    'chat',
    '+messages-resource-download',
    '--resource-id',
    resourceId,
    '--message-id',
    messageId,
    '--open-conversation-id',
    conversationId,
    '--output',
    relOut || '.',
  ]);
  const { command, args: spawnArgs } = dwsSpawnOptions(args);
  const result = spawnSync(command, spawnArgs, {
    cwd: config.aiWorkflowRoot,
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || '').trim().slice(0, 500),
    };
  }
  const files = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).map((f) => path.join(outputDir, f))
    : [];
  return { ok: true, files, stdout: result.stdout };
}

/**
 * @param {object} evt normalized event (message_id, conversation_id, content, rawContent)
 */
function enrichEventMedia(evt) {
  const media = { images: [], mediaIds: [], errors: [] };
  if (!evt.message_id || !evt.conversation_id) {
    return media;
  }

  let ids = extractMediaIds(evt.rawContent || evt.content || '');
  const needsLookup =
    !ids.length &&
    (MEDIA_HINT.test(evt.content || '') || !String(evt.content || '').trim());

  if (needsLookup) {
    const row = listMessageById(evt.conversation_id, evt.message_id);
    ids = mediaIdsFromListRow(row);
    if (row?.text && !evt.content) {
      evt.content = String(row.text).trim();
    }
  }

  media.mediaIds = ids;
  if (!ids.length) return media;

  const outDir = path.join(
    config.dirs.media || path.join(__dirname, 'media'),
    String(evt.message_id).replace(/[^\w+/=-]/g, '_').slice(0, 80)
  );

  for (const resourceId of ids) {
    const dl = downloadResource({
      resourceId,
      messageId: evt.message_id,
      conversationId: evt.conversation_id,
      outputDir: outDir,
    });
    if (dl.ok && dl.files?.length) {
      for (const f of dl.files) {
        if (/\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(f) || !path.extname(f)) {
          media.images.push(path.relative(config.aiWorkflowRoot, f));
        }
      }
    } else {
      media.errors.push({ resourceId, error: dl.error || 'download failed' });
    }
  }
  return media;
}

function buildTextForIntent(evt, media) {
  const parts = [];
  if (evt.content) parts.push(evt.content);
  if (media.images.length) {
    parts.push(`[图片×${media.images.length}]`);
  } else if (media.mediaIds.length && !media.images.length) {
    parts.push(`[媒体附件 mediaId×${media.mediaIds.length} 下载失败或未识别为图片]`);
  }
  return parts.join('\n').trim() || '[仅媒体消息]';
}

module.exports = {
  enrichEventMedia,
  buildTextForIntent,
  extractMediaIds,
  MEDIA_HINT,
};
