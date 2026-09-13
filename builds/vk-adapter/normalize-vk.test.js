const test = require('node:test');
const assert = require('node:assert');
const { normalizeVkEvent, largestPhotoUrl, extractAttachment, docExt } = require('./normalize-vk');

/** A realistic message_new body, minus attachments. */
function event(overrides = {}, msgOverrides = {}) {
  return {
    type: 'message_new',
    event_id: 'e1a2b3c4d5',
    group_id: 123456789,
    v: '5.199',
    secret: 'shh',
    object: {
      client_info: {},
      message: {
        id: 42,
        date: 1757700000,
        peer_id: 7654321,
        from_id: 7654321,
        text: 'чек за такси',
        attachments: [],
        random_id: 0,
        conversation_message_id: 11,
        ...msgOverrides,
      },
    },
    ...overrides,
  };
}

test('maps the core envelope fields', () => {
  const e = normalizeVkEvent(event());
  assert.strictEqual(e.channel, 'vk');
  assert.strictEqual(e.user_id, '7654321');
  assert.strictEqual(e.chat_id, '7654321');
  assert.strictEqual(e.session_key, 'vk:7654321');
  assert.strictEqual(e.text, 'чек за такси');
  assert.strictEqual(e.message_id, '42');
  assert.strictEqual(e.event_id, 'e1a2b3c4d5');
  assert.strictEqual(e.ts, new Date(1757700000 * 1000).toISOString());
});

test('ids are strings, so Data Table and Redis keys never vary by type', () => {
  const e = normalizeVkEvent(event());
  for (const k of ['user_id', 'chat_id', 'message_id', 'group_id', 'event_id']) {
    assert.strictEqual(typeof e[k], 'string', `${k} must be a string`);
  }
});

test('peer_id differs from from_id in a group chat, and the reply goes to peer_id', () => {
  const e = normalizeVkEvent(event({}, { peer_id: 2000000001, from_id: 555 }));
  assert.strictEqual(e.chat_id, '2000000001', 'reply target');
  assert.strictEqual(e.user_id, '555', 'author');
  assert.strictEqual(e.session_key, 'vk:555', 'memory is per-person, not per-chat');
});

test('picks the best rendition under the cap, regardless of array order', () => {
  // Was "widest wins". The 2560px original is now deliberately skipped: it costs
  // download, base64 expansion and Vision upload time for detail a thermal slip
  // does not need. See MAX_USEFUL_WIDTH.
  const e = normalizeVkEvent(event({}, {
    attachments: [{
      type: 'photo',
      photo: {
        id: 1,
        sizes: [
          { type: 'm', url: 'https://cdn.vk/m.jpg', width: 130, height: 100 },
          { type: 'w', url: 'https://cdn.vk/w.jpg', width: 2560, height: 1920 },
          { type: 'z', url: 'https://cdn.vk/z.jpg', width: 1080, height: 810 },
          { type: 'x', url: 'https://cdn.vk/x.jpg', width: 604, height: 453 },
        ],
      },
    }],
  }));
  assert.strictEqual(e.file_url, 'https://cdn.vk/z.jpg');
  assert.strictEqual(e.file_kind, 'photo');
});

test('falls back to size-type rank when width is missing', () => {
  const url = largestPhotoUrl({
    sizes: [
      { type: 'm', url: 'https://cdn.vk/m.jpg' },
      { type: 'z', url: 'https://cdn.vk/z.jpg' },
      { type: 's', url: 'https://cdn.vk/s.jpg' },
    ],
  });
  assert.strictEqual(url, 'https://cdn.vk/z.jpg');
});

test('a photo wins over a doc when the user sends both', () => {
  const att = extractAttachment([
    { type: 'doc', doc: { url: 'https://cdn.vk/d.jpg', ext: 'jpg', title: 'd.jpg' } },
    { type: 'photo', photo: { sizes: [{ type: 'x', url: 'https://cdn.vk/x.jpg', width: 604 }] } },
  ]);
  assert.strictEqual(att.file_url, 'https://cdn.vk/x.jpg');
  assert.strictEqual(att.file_kind, 'photo');
});

test('an image doc is usable OCR input', () => {
  const e = normalizeVkEvent(event({}, {
    attachments: [{ type: 'doc', doc: { url: 'https://cdn.vk/r.png', ext: 'png', title: 'receipt.png' } }],
  }));
  assert.strictEqual(e.file_url, 'https://cdn.vk/r.png');
  assert.strictEqual(e.file_kind, 'doc');
});

test('a PDF doc is flagged unsupported rather than sent to OCR', () => {
  const e = normalizeVkEvent(event({}, {
    attachments: [{ type: 'doc', doc: { url: 'https://cdn.vk/r.pdf', ext: 'pdf', title: 'receipt.pdf' } }],
  }));
  assert.strictEqual(e.file_kind, 'doc_unsupported', 'must route to manual review, never to OCR');
  assert.strictEqual(e.file_url, 'https://cdn.vk/r.pdf');
});

test('derives the extension from the title when ext is absent', () => {
  assert.strictEqual(docExt({ title: 'скан чека.JPEG' }), 'jpeg');
  assert.strictEqual(docExt({ title: 'noextension' }), '');
  assert.strictEqual(docExt({}), '');
});

test('voice message lands in audio_url, prefers ogg, and leaves file_url empty', () => {
  const e = normalizeVkEvent(event({}, {
    text: '',
    attachments: [{
      type: 'audio_message',
      audio_message: { duration: 7, link_ogg: 'https://cdn.vk/v.ogg', link_mp3: 'https://cdn.vk/v.mp3' },
    }],
  }));
  assert.strictEqual(e.audio_url, 'https://cdn.vk/v.ogg');
  assert.strictEqual(e.file_url, '', 'a voice note is not an OCR input');
  assert.strictEqual(e.file_kind, 'audio_message');
});

test('a sticker or unknown attachment yields no file, not a crash', () => {
  const e = normalizeVkEvent(event({}, { attachments: [{ type: 'sticker', sticker: { sticker_id: 9 } }] }));
  assert.strictEqual(e.file_url, '');
  assert.strictEqual(e.file_kind, '');
});

test('text-only message has empty file fields', () => {
  const e = normalizeVkEvent(event());
  assert.strictEqual(e.file_url, '');
  assert.strictEqual(e.file_kind, '');
  assert.strictEqual(e.audio_url, '');
});

test('synthesises a dedup key when VK omits event_id', () => {
  const body = event();
  delete body.event_id;
  const e = normalizeVkEvent(body);
  assert.strictEqual(e.event_id, '123456789:42:1757700000');
});

test('the same delivery retried twice produces the same dedup key', () => {
  assert.strictEqual(normalizeVkEvent(event()).event_id, normalizeVkEvent(event()).event_id);
});

test('survives a malformed body without throwing', () => {
  for (const bad of [undefined, null, {}, { object: {} }, { object: { message: null } }]) {
    const e = normalizeVkEvent(bad);
    assert.strictEqual(e.channel, 'vk');
    assert.strictEqual(e.text, '');
    assert.strictEqual(e.session_key, 'vk:unknown');
    assert.ok(e.ts, 'ts always present');
  }
});

const { replyRandomId } = require('./normalize-vk');

test('reply_random_id is stable for the same event and non-zero', () => {
  const a = normalizeVkEvent(event()).reply_random_id;
  const b = normalizeVkEvent(event()).reply_random_id;
  assert.strictEqual(a, b, 'a retried event must not produce a second reply');
  assert.ok(a > 0 && a < 2147483648, `must be a non-zero 31-bit int, got ${a}`);
  assert.strictEqual(Number.isInteger(a), true);
});

test('reply_random_id differs between events', () => {
  const a = normalizeVkEvent(event({ event_id: 'aaa' })).reply_random_id;
  const b = normalizeVkEvent(event({ event_id: 'bbb' })).reply_random_id;
  assert.notStrictEqual(a, b);
});

test('replyRandomId never returns 0, even for an empty seed', () => {
  for (const seed of ['', null, undefined, 0]) {
    assert.ok(replyRandomId(seed) > 0, `seed ${JSON.stringify(seed)} produced 0`);
  }
});

const { MAX_USEFUL_WIDTH } = require('./normalize-vk');

test('picks the biggest rendition at or below the OCR width cap', () => {
  const url = largestPhotoUrl({ sizes: [
    { type: 'm', url: 'm', width: 130 },
    { type: 'x', url: 'x', width: 604 },
    { type: 'z', url: 'z', width: 1080 },
    { type: 'w', url: 'w', width: 2560 },
  ]});
  assert.strictEqual(url, 'z', 'must not fetch the 2560px original');
});

test('takes a rendition exactly on the cap', () => {
  const url = largestPhotoUrl({ sizes: [
    { type: 'x', url: 'x', width: 604 },
    { type: 'y', url: 'y', width: MAX_USEFUL_WIDTH },
  ]});
  assert.strictEqual(url, 'y');
});

test('when every rendition is oversized, takes the smallest rather than none', () => {
  const url = largestPhotoUrl({ sizes: [
    { type: 'w', url: 'w', width: 2560 },
    { type: 'z', url: 'z', width: 1800 },
  ]});
  assert.strictEqual(url, 'z');
});

test('still returns a url when widths are missing entirely', () => {
  const url = largestPhotoUrl({ sizes: [{ type: 'm', url: 'm' }, { type: 'z', url: 'z' }] });
  assert.ok(url, 'must not return empty');
});
