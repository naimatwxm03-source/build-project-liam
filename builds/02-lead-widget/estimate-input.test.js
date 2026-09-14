const test = require('node:test');
const assert = require('node:assert');
const E = require('./estimate-input');
const P = require('./pricing');

// Аргументы сюда приходят от языковой модели, а не из формы. Тесты написаны
// на том, что модель реально присылает: живые русские фразы, null, пустые
// строки, отрицания и числа строкой.

test('конфигурация распознаётся из живых формулировок', () => {
  const cases = {
    straight3: ['прямой', 'прямой балкон 3 метра', 'обычный балкон', 'балкон', '3 м', '3,2 метра'],
    pshaped: ['П-образный', 'п образный балкон', 'побразный', 'угловой'],
    loggia6: ['лоджия', 'лоджия 6 метров', 'ЛОДЖИЯ', '6 м'],
  };
  for (const [expected, inputs] of Object.entries(cases)) {
    for (const raw of inputs) {
      assert.strictEqual(E.parseConfiguration(raw), expected, `«${raw}»`);
    }
  }
});

test('П-образная лоджия — это П-образный, форма важнее названия помещения', () => {
  // Строка содержит и «лоджия», и «п образн». Метраж определяет форма.
  assert.strictEqual(E.parseConfiguration('П-образная лоджия'), 'pshaped');
});

test('непонятная конфигурация возвращает null, а не догадку', () => {
  for (const raw of ['ну обычный такой', '', null, undefined, 'не знаю', 42, {}]) {
    assert.strictEqual(E.parseConfiguration(raw), null, JSON.stringify(raw));
  }
});

test('тип остекления распознаётся, включая «е» вместо «ё»', () => {
  for (const raw of ['тёплое', 'теплое', 'ТЕПЛОЕ', 'с утеплением', 'чтобы зимой сидеть']) {
    assert.strictEqual(E.parseGlazing(raw), 'warm', `«${raw}»`);
  }
  for (const raw of ['холодное', 'ХОЛОДНОЕ', 'летний вариант']) {
    assert.strictEqual(E.parseGlazing(raw), 'cold', `«${raw}»`);
  }
});

test('ОТРИЦАНИЕ не превращается в true', () => {
  // Boolean('не нужен') === true. Без явной проверки отрицаний «крыша не нужна»
  // добавила бы 18 % к смете — ошибка, которую клиент найдёт в счёте.
  for (const raw of ['не нужен', 'нет', 'без выноса', 'не надо', 'нет, не нужно']) {
    assert.strictEqual(E.parseFlag(raw), false, `«${raw}»`);
  }
  for (const raw of ['да', 'нужен', 'нужно', true, 'yes', 'последний']) {
    assert.strictEqual(E.parseFlag(raw), true, `«${raw}»`);
  }
});

test('этаж читается из строки, мусор отбрасывается', () => {
  assert.strictEqual(E.parseFloor('5'), 5);
  assert.strictEqual(E.parseFloor('5 этаж'), 5);
  assert.strictEqual(E.parseFloor(9), 9);
  for (const bad of [null, '', 'не знаю', 0, '0', 'последний']) {
    assert.strictEqual(E.parseFloor(bad), null, JSON.stringify(bad));
  }
});

test('«последний этаж» в поле floor включает крышу', () => {
  // Модель то шлёт отдельный флаг, то пишет слово прямо в поле этажа.
  const r = E.parseEstimateArgs({ configuration: 'прямой', glazing: 'тёплое', floor: 'последний' });
  assert.strictEqual(r.value.topFloor, true);
});

test('явный флаг top_floor: false побеждает, даже если этаж высокий', () => {
  const r = E.parseEstimateArgs({
    configuration: 'прямой', glazing: 'тёплое', floor: 9, top_floor: false,
  });
  assert.strictEqual(r.value.topFloor, false);
});

test('без конфигурации или типа остекления расчёт НЕ выполняется', () => {
  const noConfig = E.parseEstimateArgs({ glazing: 'тёплое' });
  assert.strictEqual(noConfig.ok, false);
  assert.ok(noConfig.missing.some((m) => m.includes('конфигурация')));

  const noGlazing = E.parseEstimateArgs({ configuration: 'лоджия' });
  assert.strictEqual(noGlazing.ok, false);
  assert.ok(noGlazing.missing.some((m) => m.includes('остекления')));
});

test('null во всех полях не роняет узел и не выдаёт цену', () => {
  // Бриф прямо предупреждает про этот случай.
  for (const bad of [null, undefined, {}, 'строка', 42, []]) {
    const r = E.parseEstimateArgs(bad);
    assert.strictEqual(r.ok, false, JSON.stringify(bad));
    assert.ok(r.missing.length > 0);
  }
});

test('чего не хватает — сказано по-русски, чтобы агент мог переспросить', () => {
  const r = E.parseEstimateArgs({});
  for (const m of r.missing) {
    assert.ok(/[а-яё]/i.test(m), `не по-русски: ${m}`);
    assert.ok(m.length > 10, `слишком коротко, чтобы переспросить: ${m}`);
  }
});

test('неуказанные необязательные поля становятся пометками, а не отказом', () => {
  const r = E.parseEstimateArgs({ configuration: 'лоджия', glazing: 'холодное' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.notes.some((n) => n.includes('профил')));
  assert.ok(r.notes.some((n) => n.includes('этаж')));
});

test('разобранные аргументы напрямую скармливаются pricing.js', () => {
  // Это стык двух модулей. Разойдутся имена полей — расчёт молча вернёт
  // вилку для прямого балкона на любой запрос, потому что clampConfig
  // подставит straight3 по умолчанию.
  const parsed = E.parseEstimateArgs({
    configuration: 'лоджия 6 метров',
    glazing: 'тёплое',
    profile_tier: 'премиум',
    floor: 'последний',
  });
  assert.strictEqual(parsed.ok, true);

  const r = P.estimate(parsed.value);
  assert.strictEqual(r.configuration, 'loggia6');
  assert.strictEqual(r.glazing, 'warm');
  assert.ok(r.breakdown.some((b) => b.item.includes('крыша')), 'крыша не попала в расчёт');
  assert.ok(r.assumptions.some((a) => a.includes('премиум')), 'класс профиля не применился');
});

test('адрес проходит как есть и обрезается по длине', () => {
  const r = E.parseEstimateArgs({
    configuration: 'прямой', glazing: 'холодное',
    address: '  Самара,   улица   Ново-Садовая,  д. 1  ',
  });
  assert.strictEqual(r.value.address, 'Самара, улица Ново-Садовая, д. 1');

  const long = E.parseEstimateArgs({
    configuration: 'прямой', glazing: 'холодное', address: 'а'.repeat(1000),
  });
  assert.strictEqual(long.value.address.length, 300);
});

test('заметка про крышу не противоречит расчёту', () => {
  // Поймано на живом прогоне: «последний» в поле этажа не даёт числа, но даёт
  // флаг крыши. Расчёт крышу добавлял, а заметка сообщала, что не добавлял.
  const top = E.parseEstimateArgs({ configuration: 'лоджия', glazing: 'тёплое', floor: 'последний' });
  assert.strictEqual(top.value.topFloor, true);
  assert.ok(!top.notes.some((n) => n.includes('крыша')),
    'крыша посчитана — заметка о её отсутствии лжёт: ' + top.notes.join('; '));

  // А когда этажа действительно нет — заметка нужна.
  const none = E.parseEstimateArgs({ configuration: 'лоджия', glazing: 'тёплое' });
  assert.strictEqual(none.value.topFloor, false);
  assert.ok(none.notes.some((n) => n.includes('крыша')));

  // Обычный этаж: крыши нет, но этаж назван — переспрашивать не о чем.
  const mid = E.parseEstimateArgs({ configuration: 'лоджия', glazing: 'тёплое', floor: 5 });
  assert.strictEqual(mid.value.topFloor, false);
  assert.ok(!mid.notes.some((n) => n.includes('крыша')));
});
