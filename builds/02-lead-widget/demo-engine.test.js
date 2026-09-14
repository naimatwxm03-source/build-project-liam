/**
 * Прогон демо-сценария в изолированном контексте, как в браузере.
 *
 * Главный тест здесь — не технический, а коммерческий: форма контактов не
 * должна появляться раньше расчёта. Виджет, который просит телефон первым,
 * убивает воронку, и это ошибка, которую легко внести правкой в одну строку.
 */
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Пути от файла теста, а не от текущего каталога. С относительными путями
// `node --test builds/02-lead-widget/*.test.js` из корня репозитория падает
// девятью тестами — при полностью исправном коде. Один раз это уже стоило
// ложной тревоги; в CI стоило бы дороже.
const here = (name) => path.join(__dirname, name);

function newBot() {
  const ctx = vm.createContext({ Math, Promise, setTimeout, console, window: {} });
  for (const file of ['pricing.js', 'demo-engine.js']) {
    vm.runInContext(fs.readFileSync(here(file), 'utf8'), ctx, { filename: file });
  }
  return (payload) => ctx.window.NXAI_DEMO_REPLY(payload);
}

test('телефон не просят раньше расчёта', async () => {
  const bot = newBot();
  const turns = ['привет', 'сколько стоит', 'прямой балкон 3 метра'];
  for (const t of turns) {
    const r = await bot({ message: t });
    assert.notStrictEqual(r.form, 'contact',
      `форма контактов выскочила на «${t}» — до того, как показана цена`);
  }
});

test('после расчёта форма контактов появляется', async () => {
  const bot = newBot();
  await bot({ message: 'прямой балкон 3 метра' });
  const r = await bot({ message: 'тёплое' });
  assert.strictEqual(r.form, 'contact');
  assert.match(r.reply, /от [\d\s  ]+ до [\d\s  ]+ ₽/u, r.reply);
});

test('всё в одной фразе — расчёт за один ход', async () => {
  const bot = newBot();
  const r = await bot({ message: 'лоджия 6 метров, тёплое, премиум, последний этаж' });
  assert.strictEqual(r.form, 'contact');
  assert.match(r.reply, /лоджия 6 м/);
  assert.match(r.reply, /премиум/);
  assert.match(r.reply, /крыша/);
});

test('в расчёте всегда сказано, что цена — вилка, а не смета', async () => {
  const bot = newBot();
  const r = await bot({ message: 'п-образный балкон, холодное' });
  assert.match(r.reply, /вилка/i);
  assert.match(r.reply, /замерщик/i);
});

test('в расчёте всегда сказано, что НЕ входит', async () => {
  const bot = newBot();
  const r = await bot({ message: 'балкон 3 метра холодное' });
  assert.match(r.reply, /Не входит/);
  assert.match(r.reply, /отделка/);
});

test('вопрос из базы знаний отвечается без требования контактов', async () => {
  const bot = newBot();
  for (const q of ['какая гарантия', 'есть рассрочка?', 'какие сроки', 'что входит в стоимость']) {
    const r = await bot({ message: q });
    assert.notStrictEqual(r.form, 'contact', `«${q}» не должен требовать телефон`);
    assert.ok(r.reply.length > 40, `«${q}» остался без ответа`);
  }
});

test('ответ про гарантию честно помечен как условия демо-компании', async () => {
  const bot = newBot();
  const r = await bot({ message: 'какая гарантия' });
  assert.match(r.reply, /демо-компании/,
    'нельзя выдавать выдуманный срок гарантии за настоящий');
});

test('заявка в демо честно говорит, что никуда не отправлена', async () => {
  const bot = newBot();
  const r = await bot({ contact: { name: 'Наимат', phone: '+79270000000', consent: true } });
  assert.match(r.reply, /Наимат/);
  assert.match(r.reply, /демонстрация/i);
  assert.match(r.reply, /не отправлена/);
});

test('цена в демо совпадает с pricing.js, а не придумана сценарием', async () => {
  const bot = newBot();
  const P = require('./pricing');
  const expected = P.formatRange(P.estimate({ configuration: 'straight3', glazing: 'warm' }));
  const r = await bot({ message: 'прямой балкон 3 метра тёплое' });
  assert.ok(r.reply.includes(expected), `ожидалось «${expected}» в ответе:\n${r.reply}`);
});
