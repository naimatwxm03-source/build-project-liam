/**
 * VK Callback API → shared channel envelope.
 *
 * The envelope is deliberately identical in shape to the Telegram one, so the
 * agent and its tools never learn which channel they are on. Adding Avito or
 * MAX later means writing another normalizer, not touching any build.
 *
 * This file is the single source of truth. It is injected verbatim into the
 * Code node of every VK workflow by sync-code-node.py — never hand-edit the
 * copy inside a workflow.json.
 */

/**
 * Widest rendition worth fetching, in pixels.
 *
 * VK keeps originals up to 2560px. For receipt OCR that is wasted: the payload
 * is downloaded, base64-expanded by a third, and uploaded again to Vision, and
 * every one of those steps is on the user's clock. Around 1600px the characters
 * on a thermal slip are still comfortably legible.
 *
 * If nothing is at or below the cap, the SMALLEST rendition above it is used —
 * never no image at all.
 */
const MAX_USEFUL_WIDTH = 1600;

/** VK photo size types, worst to best. Used only as a tiebreak when width is absent. */
const SIZE_RANK = ['s', 'm', 'o', 'p', 'q', 'r', 'x', 'y', 'z', 'w'];

/** Image extensions we are willing to send to OCR. A .pdf doc is not one. */
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'heic', 'webp', 'bmp']);

/**
 * Pick the largest available rendition of a VK photo.
 * VK does not guarantee `sizes` is ordered, and older payloads omit `width`.
 */
function largestPhotoUrl(photo, maxWidth = MAX_USEFUL_WIDTH) {
  const sizes = (Array.isArray(photo && photo.sizes) ? photo.sizes : []).filter(
    (s) => s && s.url
  );
  if (sizes.length === 0) return '';

  const better = (a, b) => {
    const byWidth = (a.width || 0) - (b.width || 0);
    if (byWidth !== 0) return byWidth > 0;
    return SIZE_RANK.indexOf(a.type) > SIZE_RANK.indexOf(b.type);
  };

  // Biggest that still fits the cap — the sweet spot for OCR cost vs legibility.
  let best = null;
  for (const s of sizes) {
    if ((s.width || 0) > maxWidth) continue;
    if (best === null || better(s, best)) best = s;
  }
  if (best) return best.url;

  // Everything is oversized (or widths are missing): take the smallest of them
  // rather than returning nothing.
  let smallest = sizes[0];
  for (const s of sizes) if (better(smallest, s)) smallest = s;
  return smallest.url;
}

/** Lowercase extension of a VK doc, '' when absent. */
function docExt(doc) {
  if (doc && typeof doc.ext === 'string' && doc.ext) return doc.ext.toLowerCase();
  const title = (doc && doc.title) || '';
  const dot = title.lastIndexOf('.');
  return dot === -1 ? '' : title.slice(dot + 1).toLowerCase();
}

/**
 * Find the first attachment we know how to handle.
 * Order matters: a photo is a better OCR input than a doc of the same receipt,
 * and users regularly send both.
 */
function extractAttachment(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const none = { file_url: '', file_kind: '', audio_url: '' };

  const photo = list.find((a) => a && a.type === 'photo' && a.photo);
  if (photo) {
    const url = largestPhotoUrl(photo.photo);
    if (url) return { file_url: url, file_kind: 'photo', audio_url: '' };
  }

  const doc = list.find((a) => a && a.type === 'doc' && a.doc && a.doc.url);
  if (doc) {
    const ext = docExt(doc.doc);
    // A non-image doc still gets reported, so the caller can route it to manual
    // review with an honest reason instead of failing inside OCR.
    return {
      file_url: doc.doc.url,
      file_kind: IMAGE_EXTS.has(ext) ? 'doc' : 'doc_unsupported',
      audio_url: '',
    };
  }

  const voice = list.find((a) => a && a.type === 'audio_message' && a.audio_message);
  if (voice) {
    const am = voice.audio_message;
    const url = am.link_ogg || am.link_mp3 || '';
    if (url) return { file_url: '', file_kind: 'audio_message', audio_url: url };
  }

  return none;
}

/**
 * A stable non-zero 31-bit integer derived from a string.
 *
 * VK requires `random_id` on messages.send to be non-zero, and dedups sends
 * that repeat one. Deriving it from the event id rather than from the clock
 * means an n8n retry of the same event cannot produce a second reply.
 */
function replyRandomId(seed) {
  let h = 7;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0) % 2147483647 || 1; // never 0 — VK rejects it
}

/**
 * @param {object} body - the raw parsed JSON body of a VK Callback POST
 * @returns {object} the shared envelope
 */
function normalizeVkEvent(body) {
  const b = body || {};
  const msg = (b.object && b.object.message) || {};
  const att = extractAttachment(msg.attachments);

  const fromId = msg.from_id === undefined || msg.from_id === null ? '' : String(msg.from_id);
  const peerId = msg.peer_id === undefined || msg.peer_id === null ? '' : String(msg.peer_id);

  // VK's event_id is stable across its own retries; message id is not a safe
  // dedup key because a retry of the *same* delivery carries the same message.
  // Fall back to a composite only when VK omits event_id (it does for some
  // older community settings).
  const eventId = b.event_id ? String(b.event_id) : `${b.group_id || 'g'}:${msg.id || 'm'}:${msg.date || '0'}`;

  return {
    channel: 'vk',
    event_id: eventId,
    group_id: b.group_id === undefined ? '' : String(b.group_id),
    user_id: fromId,
    chat_id: peerId,
    session_key: `vk:${fromId || 'unknown'}`,
    text: typeof msg.text === 'string' ? msg.text : '',
    file_url: att.file_url,
    file_kind: att.file_kind,
    audio_url: att.audio_url,
    message_id: msg.id === undefined || msg.id === null ? '' : String(msg.id),
    ts: msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString(),
    reply_random_id: replyRandomId(eventId),
  };
}

// ---------------------------------------------------------------------------
// n8n glue. Everything above is injected by sync-code-node.py from the source
// named below. Do not edit it here — edit the source and re-run the sync.
//   source: builds/vk-adapter/normalize-vk.js
// ---------------------------------------------------------------------------
return $input.all().map((item) => ({
  json: normalizeVkEvent(item.json.body !== undefined ? item.json.body : item.json),
}));
