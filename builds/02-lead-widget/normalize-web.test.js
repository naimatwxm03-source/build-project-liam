const test = require('node:test');
const assert = require('node:assert');
const N = require('./normalize-web');
const R = require('./rate-limit');

// --- конверт -----------------------------------------------------------------

test('обычное сообщение проходит и получает ключ сессии', () => {
  const e = N.normalizeWebRequest({ session_id: 'abc-123', message: 'сколько стоит балкон' });
  assert.strictEqual(e.valid, true);
  assert.strictEqual(e.channel, 'web');
  assert.strictEqual(e.session_key, 'web:abc-123');
  assert.strictEqual(e.text, 'сколько стоит балкон');
});

test('конверт совпадает по форме с VK-адаптером', () => {
  const e = N.normalizeWebRequest({ session_id: 's', message: 'привет' });
  // Эти поля читает агент. Разойдутся — и один агент перестанет обслуживать
  // оба канала, а именно ради этого адаптер и написан.
  for (const k of ['channel', 'user_id', 'session_key', 'text', 'ts']) {
    assert.ok(k in e, `в конверте нет поля ${k}`);
  }
});

test('без session_id запрос отклоняется', () => {
  const e = N.normalizeWebRequest({ message: 'привет' });
  assert.strictEqual(e.valid, false);
  assert.match(e.invalid_reason, /session_id/);
});

test('пустое сообщение отклоняется', () => {
  for (const bad of ['', '   ', null, undefined]) {
    const e = N.normalizeWebRequest({ session_id: 's', message: bad });
    assert.strictEqual(e.valid, false, JSON.stringify(bad));
  }
});

test('мусор вместо тела не роняет узел', () => {
  for (const bad of [undefined, null, 'строка', 42, []]) {
    const e = N.normalizeWebRequest(bad);
    assert.strictEqual(e.valid, false);
    assert.ok(e.invalid_reason.length > 0);
  }
});

test('простыня обрезается по лимиту', () => {
  const e = N.normalizeWebRequest({ session_id: 's', message: 'я'.repeat(50000) });
  assert.strictEqual(e.text.length, N.MAX_TEXT);
});

test('управляющие символы вычищаются', () => {
  const dirty = 'при' + String.fromCharCode(0) + 'вет' + String.fromCharCode(27) + String.fromCharCode(127);
  const e = N.normalizeWebRequest({ session_id: 's', message: dirty });
  assert.strictEqual(e.text, 'привет');
});

test('перевод строки тоже управляющий символ и не должен ломать ключ сессии', () => {
  const e = N.normalizeWebRequest({ session_id: 'abc\ndef', message: 'привет' });
  assert.strictEqual(e.session_key, 'web:abcdef');
});

// --- контакты и 152-ФЗ --------------------------------------------------------

test('контакт с согласием принимается', () => {
  const e = N.normalizeWebRequest({
    session_id: 's',
    contact: { name: 'Наимат', phone: '+7 927 000-00-00', consent: true },
  });
  assert.strictEqual(e.valid, true);
  assert.strictEqual(e.is_contact, true);
  assert.strictEqual(e.contact_name, 'Наимат');
});

test('БЕЗ СОГЛАСИЯ телефон не принимается — проверка на сервере, а не в браузере', () => {
  for (const consent of [false, undefined, null, 'true', 1, 'да']) {
    const e = N.normalizeWebRequest({
      session_id: 's',
      contact: { name: 'Наимат', phone: '+79270000000', consent: consent },
    });
    assert.strictEqual(e.valid, false, 'согласие=' + JSON.stringify(consent));
    assert.match(e.invalid_reason, /согласия/);
  }
});

test('короткий телефон отклоняется', () => {
  const e = N.normalizeWebRequest({
    session_id: 's',
    contact: { name: 'Наимат', phone: '12345', consent: true },
  });
  assert.strictEqual(e.valid, false);
  assert.match(e.invalid_reason, /телефон/);
});

test('телефон сохраняется как введён, не переформатируется', () => {
  const e = N.normalizeWebRequest({
    session_id: 's',
    contact: { name: 'Н', phone: '+7 (927) 123-45-67', consent: true },
  });
  assert.strictEqual(e.contact_phone, '+7 (927) 123-45-67');
});

// --- лимит --------------------------------------------------------------------

test('счётчик читается независимо от того, под каким ключом его вернул Redis', () => {
  assert.strictEqual(R.readCount({ 'rl:abc-123': 7 }), 7);
  assert.strictEqual(R.readCount({ propertyName: '7' }), 7);
  assert.strictEqual(R.readCount(7), 7);
  assert.strictEqual(R.readCount('7'), 7);
});

test('непонятный ответ Redis не выдаёт себя за ноль', () => {
  // Ноль означал бы «лимит не превышен» по чистой случайности. Нужен null,
  // чтобы деградация была явной.
  for (const bad of [null, undefined, {}, { ok: true }, 'нет']) {
    assert.strictEqual(R.readCount(bad), null, JSON.stringify(bad));
  }
});

test('превышение лимита ловится, а не пропускается', () => {
  assert.strictEqual(R.decide(R.MAX_MESSAGES).rate_limited, false);
  assert.strictEqual(R.decide(R.MAX_MESSAGES + 1).rate_limited, true);
});

test('сбой Redis пропускает посетителя, но помечает деградацию', () => {
  const d = R.decide(null);
  assert.strictEqual(d.rate_limited, false, 'сайт не должен падать из-за Redis');
  assert.strictEqual(d.rate_degraded, true, 'но это обязано быть видно в логе');
});

// --- адрес в форме контактов (B9) -------------------------------------------

test('адрес из формы контактов попадает в конверт', () => {
  const e = N.normalizeWebRequest({
    session_id: 'w-1',
    contact: { name: 'Иван', phone: '+79171234567', address: '  Самара,  Ново-Садовая 1 ', consent: true },
  });
  assert.strictEqual(e.is_contact, true);
  assert.strictEqual(e.valid, true);
  assert.strictEqual(e.contact_address, 'Самара, Ново-Садовая 1');
});

test('без адреса форма контактов по-прежнему валидна', () => {
  // Адрес объявлен необязательным в виджете. Если он начнёт блокировать лид,
  // мы потеряем людей, которые дали бы его по телефону.
  const e = N.normalizeWebRequest({
    session_id: 'w-2',
    contact: { name: 'Иван', phone: '+79171234567', consent: true },
  });
  assert.strictEqual(e.valid, true);
  assert.strictEqual(e.contact_address, '');
});

test('адрес не обходит проверку согласия', () => {
  const e = N.normalizeWebRequest({
    session_id: 'w-3',
    contact: { name: 'Иван', phone: '+79171234567', address: 'Самара', consent: false },
  });
  assert.strictEqual(e.valid, false);
  assert.match(e.invalid_reason, /соглас/);
});
