const test = require('node:test');
const assert = require('node:assert');
const B = require('./bitrix');

const row = {
  session_id: 'w-77', created_at: '2026-09-17T10:00:00.000Z', channel: 'web',
  name: 'Иван Петров', phone: '+79171234567', consent: true,
  address_raw: 'Самара, Ново-Садовая 1', address_clean: 'г Самара, ул Ново-Садовая, д 1',
  address_note: '', price_low: 34000, price_high: 70000,
  configuration: 'loggia6', glazing: 'warm',
  needs_review: false, review_reason: '',
};

// --- дубли -----------------------------------------------------------------

test('дубль найден — комментарий, а НЕ второй лид', () => {
  const plan = B.planCall(row, { result: { LEAD: [412] } });
  assert.strictEqual(plan.method, 'crm.timeline.comment.add');
  assert.strictEqual(plan.existing_id, 412);
  assert.strictEqual(plan.body.fields.ENTITY_ID, 412);
  assert.strictEqual(plan.body.fields.ENTITY_TYPE, 'lead');
  assert.match(plan.body.fields.COMMENT, /Повторная заявка/);
});

test('дубля нет — создаётся лид', () => {
  for (const res of [{ result: [] }, { result: {} }, { result: { LEAD: [] } }, null, undefined, {}, 'мусор']) {
    const plan = B.planCall(row, res);
    assert.strictEqual(plan.method, 'crm.lead.add', JSON.stringify(res));
    assert.strictEqual(plan.existing_id, null);
  }
});

test('непонятный ответ о дублях = создать лид, а не дописать в чужую карточку', () => {
  // Лишний лид менеджер склеит за минуту. Заявка, ушедшая комментарием в
  // чужую карточку, не находится вообще.
  const plan = B.planCall(row, { result: { LEAD: ['не число'] } });
  assert.strictEqual(plan.method, 'crm.lead.add');
});

// --- поля лида -------------------------------------------------------------

test('телефон уходит строкой и с плюсом', () => {
  const f = B.leadFields(row);
  assert.strictEqual(f.PHONE[0].VALUE, '+79171234567');
  assert.strictEqual(typeof f.PHONE[0].VALUE, 'string');
});

test('сумма — нижняя граница, валюта рубли', () => {
  const f = B.leadFields(row);
  assert.strictEqual(f.OPPORTUNITY, 34000);
  assert.strictEqual(f.CURRENCY_ID, 'RUB');
});

test('без расчёта сумма не выдумывается', () => {
  const f = B.leadFields({ ...row, price_low: null, price_high: null });
  assert.ok(!('OPPORTUNITY' in f));
  assert.match(f.COMMENTS, /Расчёта в чате не было/);
});

test('СТАДИЯ НЕ ЗАДАЁТСЯ — у клиента на стадиях свои бизнес-процессы', () => {
  const f = B.leadFields(row);
  assert.ok(!('STATUS_ID' in f));
  const plan = B.planCall(row, { result: { LEAD: [412] } });
  assert.ok(!('STATUS_ID' in plan.body.fields));
});

test('пометка ручной проверки видна менеджеру в комментарии', () => {
  const f = B.leadFields({ ...row, needs_review: true, review_reason: 'адрес не подтверждён' });
  assert.match(f.COMMENTS, /ТРЕБУЕТ ПРОВЕРКИ: адрес не подтверждён/);
});

test('расчёт в комментарии читается человеком', () => {
  assert.match(B.comments(row), /34 000 ₽ — 70 000 ₽/);
});

// --- разбор ответа ---------------------------------------------------------

test('создан — id попадает в строку аудита', () => {
  const plan = B.planCall(row, null);
  assert.deepStrictEqual(B.readResult({ result: 99 }, plan),
    { crm_lead_id: '99', crm_status: 'создан' });
});

test('CRM МОЛЧИТ — лид не теряется, а помечается', () => {
  const plan = B.planCall(row, null);
  for (const res of [null, undefined, '', 'timeout']) {
    const r = B.readResult(res, plan);
    assert.strictEqual(r.crm_lead_id, '');
    assert.match(r.crm_status, /не ответила/);
  }
});

test('ошибка CRM попадает в строку дословно', () => {
  const plan = B.planCall(row, null);
  const r = B.readResult({ error: 'INVALID_CREDENTIALS', error_description: 'Неверный вебхук' }, plan);
  assert.match(r.crm_status, /ошибка CRM: Неверный вебхук/);
});

test('комментарий к дублю — id существующего лида, не пустота', () => {
  const plan = B.planCall(row, { result: { LEAD: [412] } });
  const r = B.readResult({ result: 1001 }, plan);
  assert.strictEqual(r.crm_lead_id, '412');
  assert.match(r.crm_status, /дубль по телефону/);
});

// --- сравнение телефонов ---------------------------------------------------

test('8 и +7 — это один и тот же человек', () => {
  assert.strictEqual(B.phoneKey('89171234567'), B.phoneKey('+7 917 123-45-67'));
});

test('ноль — это не «нет расчёта», и «нет расчёта» — это не ноль', () => {
  // Number(null) === 0. Из-за этого лид без сметы однажды показал бы
  // менеджеру «0 ₽ — 0 ₽» — цену, которой мы не называли.
  assert.strictEqual(B.num(null), null);
  assert.strictEqual(B.num(''), null);
  assert.strictEqual(B.num(undefined), null);
  assert.strictEqual(B.num(0), 0);
  for (const bad of [null, undefined, '']) {
    assert.match(B.comments({ ...row, price_low: bad, price_high: bad }), /Расчёта в чате не было/);
  }
  // а настоящий ноль от клиента всё-таки ноль, и его видно
  assert.match(B.comments({ ...row, price_low: 0, price_high: 0 }), /0 ₽ — 0 ₽/);
});

test('строка без Bitrix честно говорит «не отправлялось», а не молчит', () => {
  // Пустая клетка не отличает «не отправляли» от «отправили и не записали».
  const L = require('./lead');
  const r = L.buildLead({ envelope: { session_id: 'w-1', channel: 'web',
    contact_name: 'Иван', contact_phone: '+79171234567', contact_consent: true } });
  assert.strictEqual(r.row.crm_status, 'не отправлялось');
  assert.strictEqual(r.row.crm_lead_id, '');
});
