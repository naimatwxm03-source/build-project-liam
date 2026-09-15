const test = require('node:test');
const assert = require('node:assert');
const L = require('./lead');

const consented = {
  session_id: 'w-1', channel: 'web', contact_name: 'Иван Петров',
  contact_phone: '+7 917 123-45-67', contact_consent: true,
};
const quoted = { price_low: 34000, price_high: 70000, configuration: 'loggia6', glazing: 'warm' };

// --- согласие: единственное, что даёт право на отказ ------------------------

test('БЕЗ СОГЛАСИЯ СТРОКА НЕ ПИШЕТСЯ', () => {
  // Виджет тоже проверяет галочку, но виджет обходится консолью браузера.
  // Эта проверка — единственная, которая что-то гарантирует. 152-ФЗ.
  for (const bad of [false, undefined, null, 'true', 1, 'да']) {
    const r = L.buildLead({ envelope: { ...consented, contact_consent: bad }, quoted });
    assert.strictEqual(r.ok, false, JSON.stringify(bad));
    assert.strictEqual(r.row, null);
    assert.match(r.reason, /соглас/);
  }
});

test('короткий телефон не пишется', () => {
  const r = L.buildLead({ envelope: { ...consented, contact_phone: '12345' }, quoted });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.row, null);
});

// --- лид не теряется ---------------------------------------------------------

test('нет адреса — лид всё равно пишется и НЕ уходит на проверку', () => {
  // Адрес необязателен. Человек, не пожелавший его вводить, — обычный лид.
  const r = L.buildLead({ envelope: consented, address: null, quoted });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.row.needs_review, false);
  assert.strictEqual(r.row.address_note, 'адрес не указан');
});

test('DaData недоступна — лид пишется, помечен на проверку', () => {
  const degraded = { ok: true, degraded: true, reason: 'DaData не ответила — адрес не проверен',
                     address: { raw: '', result: '' } };
  const r = L.buildLead({ envelope: consented, address: degraded, quoted });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.row.needs_review, true);
  assert.match(r.row.review_reason, /DaData/);
  assert.strictEqual(r.row.phone, '+7 917 123-45-67', 'телефон потерян — худший исход');
});

test('адрес не подтверждён — лид пишется, помечен на проверку', () => {
  const bad = { ok: false, degraded: false, reason: 'qc_complete=7: иностранный адрес',
                address: { raw: 'Берлин', result: 'Германия, Берлин' } };
  const r = L.buildLead({ envelope: consented, address: bad, quoted });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.row.needs_review, true);
  assert.match(r.row.review_reason, /иностранн/);
});

test('форма показалась без расчёта — это аномалия, на проверку', () => {
  // Ворота формы открываются только после расчёта. Если расчёта нет, а форма
  // была — сломаны ворота, и менеджер должен это увидеть.
  const r = L.buildLead({ envelope: consented, quoted: null });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.row.needs_review, true);
  assert.match(r.row.review_reason, /расчёт не найден/);
  assert.strictEqual(r.row.price_low, null);
});

test('чистый лид: адрес хороший, расчёт есть — на проверку не идёт', () => {
  const good = { ok: true, degraded: false, reason: '',
                 address: { raw: 'Самара Ново-Садовая 1', result: 'г Самара, ул Ново-Садовая, д 1' } };
  const r = L.buildLead({ envelope: consented, address: good, quoted });
  assert.strictEqual(r.row.needs_review, false);
  assert.strictEqual(r.row.review_reason, '');
  assert.strictEqual(r.row.address_clean, 'г Самара, ул Ново-Садовая, д 1');
  assert.strictEqual(r.row.price_low, 34000);
  assert.strictEqual(r.row.price_high, 70000);
  assert.strictEqual(r.row.configuration, 'loggia6');
});

// --- снимок расчёта из Redis -------------------------------------------------

test('снимок расчёта читается из JSON', () => {
  const q = L.parseQuoted(JSON.stringify(quoted));
  assert.deepStrictEqual(q, quoted);
});

test('старый формат «1» — это НЕ смета', () => {
  // Ключи в старом формате живут ещё час после обновления. Они означают
  // «расчёт был», но сметы в них нет — значит лид уйдёт на ручную проверку,
  // а не получит выдуманные цифры.
  for (const old of ['1', 1, '', '   ', null, undefined]) {
    assert.strictEqual(L.parseQuoted(old), null, JSON.stringify(old));
  }
});

test('мусор в Redis не роняет узел и не выдумывает цену', () => {
  for (const bad of ['{не json', '[]', '{}', '{"price_low":"дорого"}', 42, {}]) {
    assert.strictEqual(L.parseQuoted(bad), null, JSON.stringify(bad));
  }
});

test('снимок с нечисловой ценой отбрасывается целиком', () => {
  assert.strictEqual(L.parseQuoted('{"price_low":34000}'), null, 'нет price_high');
});

// --- ответ человеку ----------------------------------------------------------

test('ответ называет человека по имени и не обещает лишнего', () => {
  const r = L.leadReply({ name: 'Иван Петров' }, '+7 (846) 000-00-00');
  assert.match(r, /^Иван, заявка принята/);
  assert.match(r, /бесплатн/);
  assert.match(r, /\+7 \(846\) 000-00-00/);
});

test('без имени ответ не ломается', () => {
  const r = L.leadReply({ name: '' }, '');
  assert.match(r, /^Заявка принята/);
  assert.ok(!r.includes('**'), 'пустой телефон не должен оставлять пустую разметку');
});

// Заголовок CSV — первая строка, НЕ начинающаяся с «#»: рядом со схемой лежат
// комментарии с типами колонок, потому что тип колонки CSV не передаёт, а
// ошибка в типе не падает — она молча портит данные (phone как Number съел «+»).
function readHeader() {
  const fs = require('node:fs');
  const path = require('node:path');
  return fs.readFileSync(path.join(__dirname, 'leads-schema.csv'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))[0]
    .split(',');
}

// --- стык с таблицей n8n -----------------------------------------------------

test('колонки таблицы совпадают с генератором', () => {
  // Разъехавшееся имя колонки не падает: n8n просто пишет пустое значение,
  // и менеджер получает отчёт, который выглядит полным, но им не является.
  const fs = require('node:fs');
  const path = require('node:path');
  const header = readHeader();
  const gen = fs.readFileSync(path.join(__dirname, 'make-workflow.py'), 'utf8');
  const block = gen.match(/LEAD_COLUMNS = \[([\s\S]*?)\]/);
  assert.ok(block, 'LEAD_COLUMNS пропал из генератора');
  const columns = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(columns, header);
});

test('строка лида отдаёт ровно те поля, что ждёт таблица', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const header = readHeader();
  const r = L.buildLead({ envelope: consented, quoted });
  assert.deepStrictEqual(Object.keys(r.row).sort(), header.slice().sort());
});
