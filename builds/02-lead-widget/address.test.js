const test = require('node:test');
const assert = require('node:assert');
const A = require('./address');

/** Ответ DaData по мотивам примера из их документации. */
function dadata(over) {
  return [Object.assign({
    source: 'Самара, ул. Ново-Садовая, д 1',
    result: 'г Самара, ул Ново-Садовая, д 1',
    region_with_type: 'Самарская обл',
    city_with_type: 'г Самара',
    city_district_with_type: 'р-н Октябрьский',
    street_with_type: 'ул Ново-Садовая',
    house: '1',
    geo_lat: '53.2345',
    geo_lon: '50.1234',
    fias_level: '8',
    qc: 0,
    qc_complete: 0,
  }, over)];
}

test('полный самарский адрес проходит', () => {
  const r = A.interpretAddress(dadata());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.degraded, false);
  assert.strictEqual(r.ask, '');
  assert.strictEqual(r.address.city, 'г Самара');
  assert.strictEqual(r.address.house, '1');
});

test('«ул. Пушкина» без дома — переспрашиваем, а НЕ считаем', () => {
  // Тест 3 из брифа. Это единственная защита клиента от цены, названной по
  // адресу, которого нет.
  const r = A.interpretAddress(dadata({ qc_complete: 4, house: '', result: 'г Самара, ул Пушкина' }));
  assert.strictEqual(r.ok, false);
  assert.match(r.ask, /номер дома/);
});

test('каждая нехватка компонента названа человеческими словами', () => {
  const cases = { 1: /регион/, 2: /город/, 3: /улиц/, 4: /номер дома/, 6: /адрес/ };
  for (const [code, expect] of Object.entries(cases)) {
    const r = A.interpretAddress(dadata({ qc_complete: Number(code) }));
    assert.strictEqual(r.ok, false, `qc_complete=${code}`);
    assert.match(r.ask, expect, `qc_complete=${code}: ${r.ask}`);
  }
});

test('мусор на входе — просьба написать адрес заново', () => {
  const r = A.interpretAddress(dadata({ qc: 2, result: '' }));
  assert.strictEqual(r.ok, false);
  assert.match(r.ask, /город.*улиц.*дом/s);
});

test('неоднозначный адрес — просим уточнить, а не выбираем сами', () => {
  // «Москва Тверская-Ямская» — их четыре. Выбрать одну наугад значит
  // отправить замерщика не туда.
  const r = A.interpretAddress(dadata({ qc: 3 }));
  assert.strictEqual(r.ok, false);
  assert.match(r.ask, /уточните/i);
});

test('иностранный адрес ловится раньше, чем «не указан регион»', () => {
  const r = A.interpretAddress(dadata({ qc_complete: 7, region_with_type: '' }));
  assert.strictEqual(r.ok, false);
  assert.match(r.ask, /Самар/);
  assert.ok(!/не указан регион/.test(r.ask), 'бесполезная формулировка для иностранного адреса');
});

test('другой регион — честный отказ до выезда, а не после', () => {
  const r = A.interpretAddress(dadata({
    region_with_type: 'г Москва', city_with_type: 'г Москва',
  }));
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /вне зоны выезда/);
  assert.match(r.ask, /Москва/);
});

test('вся Самарская область в зоне выезда, не только Самара', () => {
  for (const city of ['г Новокуйбышевск', 'г Отрадный', 'г Чапаевск', 'г Сызрань']) {
    const r = A.interpretAddress(dadata({ city_with_type: city }));
    assert.strictEqual(r.ok, true, city);
  }
});

test('регион сравнивается без учёта регистра и «ё»', () => {
  assert.strictEqual(A.inServiceArea('Самарская обл'), true);
  assert.strictEqual(A.inServiceArea('САМАРСКАЯ ОБЛАСТЬ'), true);
  assert.strictEqual(A.inServiceArea('Тверская обл'), false);
  assert.strictEqual(A.inServiceArea(''), false);
  assert.strictEqual(A.inServiceArea(null), false);
});

test('qc=1 считает, но помечает адрес неточным', () => {
  const r = A.interpretAddress(dadata({ qc: 1 }));
  assert.strictEqual(r.ok, true, 'неточный адрес не повод отказать в расчёте');
  assert.strictEqual(r.degraded, true, 'но замерщик должен знать, что адрес неточный');
});

test('СБОЙ DaData не отменяет расчёт', () => {
  // Адрес на цену не влияет. Потерять лид из-за недоступности стороннего
  // сервиса — худший исход из возможных.
  for (const bad of [null, undefined, [], {}, 'ошибка', { error: 'timeout' }]) {
    const r = A.interpretAddress(bad);
    assert.strictEqual(r.ok, true, JSON.stringify(bad));
    assert.strictEqual(r.degraded, true, JSON.stringify(bad));
    assert.strictEqual(r.ask, '', 'при сбое сервиса человека ни о чём не переспрашиваем');
  }
});

test('ответ читается и когда n8n завернул его в data', () => {
  const r = A.interpretAddress({ data: dadata() });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.address.city, 'г Самара');
});

test('разобранный адрес уходит в лид целиком', () => {
  const r = A.interpretAddress(dadata());
  for (const field of ['result', 'region', 'city', 'street', 'house', 'lat', 'lon']) {
    assert.ok(r.address[field], `в лиде не хватает поля ${field}`);
  }
});
