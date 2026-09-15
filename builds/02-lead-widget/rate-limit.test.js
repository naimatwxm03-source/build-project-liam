const test = require('node:test');
const assert = require('node:assert');
const R = require('./rate-limit');

// Лимит запросов защищает бюджет клиента: виджет стоит на открытом сайте, и
// без лимита один человек с консолью браузера за ночь выставляет клиенту счёт
// за Yandex AI Studio.
// --- у кого уже есть цена, тот не упирается в лимит (B15) --------------------

test('посетителя с расчётом лимит не отсекает', () => {
  // Лимит защищает бюджет клиента от чужого человека. Такой человек до
  // расчёта не доходит. А тот, кто получил вилку, — самый ценный в воронке,
  // и обрывать разговор именно с ним было бы худшим из возможных решений.
  const r = R.decide(R.MAX_MESSAGES + 50, true);
  assert.strictEqual(r.rate_limited, false);
  assert.strictEqual(r.rate_exempt, true);
});

test('без расчёта лимит работает как раньше', () => {
  assert.strictEqual(R.decide(R.MAX_MESSAGES + 1, false).rate_limited, true);
  assert.strictEqual(R.decide(R.MAX_MESSAGES + 1).rate_limited, true);
  assert.strictEqual(R.decide(R.MAX_MESSAGES, false).rate_limited, false);
});

test('только явное true снимает лимит', () => {
  // Ошибочное «да» здесь — это открытая дверь к бюджету клиента.
  for (const sneaky of ['true', 1, {}, [], 'yes', null, undefined]) {
    assert.strictEqual(R.decide(R.MAX_MESSAGES + 1, sneaky).rate_limited, true,
      JSON.stringify(sneaky));
  }
});

test('метка расчёта для лимита читается строго', () => {
  // Узел Redis при отсутствии ключа отдаёт дальше предыдущий элемент.
  // Перебор полей нашёл бы там что угодно непустое и снял лимит всем.
  assert.strictEqual(R.wasQuotedStrict({ text: 'привет', session_id: 'w-1' }, 'quoted_rate'), false);
  assert.strictEqual(R.wasQuotedStrict({ quoted_rate: '1' }, 'quoted_rate'), true);
  for (const empty of [null, undefined, '', '  ']) {
    assert.strictEqual(R.wasQuotedStrict({ quoted_rate: empty }, 'quoted_rate'), false);
  }
});
