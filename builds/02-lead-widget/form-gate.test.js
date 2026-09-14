const test = require('node:test');
const assert = require('node:assert');
const G = require('./form-gate');

// Это тесты на коммерческое правило, а не на код. Просить телефон раньше, чем
// показана цена, — единственная ошибка в этой сборке, которая стоит клиенту
// не рублей, а всех лидов сразу.

test('НЕТ расчёта — НЕТ формы контактов', () => {
  const r = G.decideForm({ quoted: false, agentReply: 'Какой у вас балкон?' });
  assert.strictEqual(r.form, '');
});

test('есть расчёт — форма появляется', () => {
  const r = G.decideForm({ quoted: true, agentReply: 'от 76 000 до 89 000 ₽' });
  assert.strictEqual(r.form, 'contact');
});

test('форма не появляется в ответ на присланные контакты', () => {
  // Иначе человек отправляет телефон и снова видит форму — выглядит так,
  // будто заявка не ушла, и он отправляет второй раз.
  const r = G.decideForm({ quoted: true, isContact: true, agentReply: 'Спасибо!' });
  assert.strictEqual(r.form, '');
});

test('только явное true открывает форму', () => {
  // Никаких «правдоподобных» значений: строка «false», единица, непустой
  // объект. Открыть форму должен факт расчёта, а не совпадение типов.
  for (const sneaky of ['true', 1, {}, [], 'yes', undefined, null]) {
    const r = G.decideForm({ quoted: sneaky, agentReply: 'текст' });
    assert.strictEqual(r.form, '', JSON.stringify(sneaky));
  }
});

test('молчание агента подменяется запасным ответом', () => {
  // Пустой ответ в виджете — это тупик, а тупик на лид-форме стоит сделки.
  const r = G.decideForm({ quoted: false, agentReply: '', fallbackReply: 'Звоните: +7…' });
  assert.strictEqual(r.reply, 'Звоните: +7…');
  assert.strictEqual(r.agent_silent, true);

  for (const empty of [null, undefined, '   ']) {
    const x = G.decideForm({ agentReply: empty, fallbackReply: 'запасной' });
    assert.strictEqual(x.reply, 'запасной', JSON.stringify(empty));
  }
});

test('нормальный ответ агента не трогается', () => {
  const r = G.decideForm({ quoted: true, agentReply: 'от 76 000 до 89 000 ₽', fallbackReply: 'з' });
  assert.strictEqual(r.reply, 'от 76 000 до 89 000 ₽');
  assert.strictEqual(r.agent_silent, false);
});

// --- чтение метки из ответа Redis --------------------------------------------

test('метка расчёта читается из ответа Redis', () => {
  assert.strictEqual(G.wasQuoted({ quoted: '1' }, 'quoted'), true);
  assert.strictEqual(G.wasQuoted({ quoted: 1 }, 'quoted'), true);
});

test('отсутствующий ключ Redis — это НЕ расчёт', () => {
  // Redis отдаёт отсутствие ключа по-разному в зависимости от версии узла.
  for (const empty of [{ quoted: null }, { quoted: undefined }, { quoted: '' }, { quoted: '  ' }]) {
    assert.strictEqual(G.wasQuoted(empty, 'quoted'), false, JSON.stringify(empty));
  }
});

test('мусор вместо ответа Redis не открывает форму', () => {
  for (const bad of [null, undefined, 'строка', 42, []]) {
    assert.strictEqual(G.wasQuoted(bad, 'quoted'), false, JSON.stringify(bad));
  }
});

test('переименованное поле не ломает ворота насовсем', () => {
  // Если имя свойства в узле разошлось с кодом, лучше показать форму по
  // любому непустому значению, чем не показать никогда. Ошибка в сторону
  // «на ход позже» безопаснее, чем «никогда».
  assert.strictEqual(G.wasQuoted({ propertyName: '1' }, 'quoted'), true);
  assert.strictEqual(G.wasQuoted({ propertyName: '' }, 'quoted'), false);
});
