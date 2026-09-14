const test = require('node:test');
const assert = require('node:assert');
const P = require('./pricing');

test('прямой балкон 3 м, тёплое — вилка совпадает с прайсом Самстроя', () => {
  const r = P.estimate({ configuration: 'straight3', glazing: 'warm' });
  // Exprof Externa 18 050 ... KBE-88 36 722, округление до 500
  assert.ok(r.low >= 18000 && r.low <= 18100, `low=${r.low}`);
  assert.ok(r.high >= 36500 && r.high <= 37000, `high=${r.high}`);
});

test('лоджия 6 м дороже прямого балкона 3 м — как в прайсе', () => {
  const a = P.estimate({ configuration: 'straight3', glazing: 'warm' });
  const b = P.estimate({ configuration: 'loggia6', glazing: 'warm' });
  assert.ok(b.low > a.low && b.high > a.high);
});

test('холодное дешевле тёплого и не ниже рынка', () => {
  const warm = P.estimate({ configuration: 'straight3', glazing: 'warm' });
  const cold = P.estimate({ configuration: 'straight3', glazing: 'cold' });
  assert.ok(cold.low < warm.low, 'холодное должно быть дешевле');
  assert.ok(cold.low >= P.MARKET_FLOOR.cold, `не ниже рынка: ${cold.low}`);
});

test('оценка никогда не опускается ниже реальной рыночной цены', () => {
  for (const cfg of ['straight3', 'pshaped', 'loggia6']) {
    for (const g of ['cold', 'warm']) {
      for (const t of [null, 'economy', 'standard', 'premium']) {
        const r = P.estimate({ configuration: cfg, glazing: g, profileTier: t });
        assert.ok(r.low >= P.MARKET_FLOOR[g],
          `${cfg}/${g}/${t}: ${r.low} < ${P.MARKET_FLOOR[g]}`);
        assert.ok(r.high >= r.low, `${cfg}/${g}/${t}: high < low`);
      }
    }
  }
});

test('класс профиля сужает вилку, а не расширяет', () => {
  const all = P.estimate({ configuration: 'straight3', glazing: 'warm' });
  const std = P.estimate({ configuration: 'straight3', glazing: 'warm', profileTier: 'standard' });
  assert.ok((std.high - std.low) < (all.high - all.low), 'выбор профиля должен сузить вилку');
});

test('премиум дороже эконома', () => {
  const eco = P.estimate({ configuration: 'loggia6', glazing: 'warm', profileTier: 'economy' });
  const prem = P.estimate({ configuration: 'loggia6', glazing: 'warm', profileTier: 'premium' });
  assert.ok(prem.low > eco.low && prem.high > eco.high);
});

test('надбавки увеличивают цену и попадают в расшифровку', () => {
  const plain = P.estimate({ configuration: 'straight3', glazing: 'warm' });
  const withRoof = P.estimate({ configuration: 'straight3', glazing: 'warm', topFloor: true });
  assert.ok(withRoof.high > plain.high);
  assert.ok(withRoof.breakdown.some((b) => b.item.includes('крыша')));
});

test('оценочные коэффициенты помечаются как оценочные', () => {
  const r = P.estimate({ configuration: 'straight3', glazing: 'warm', extension: true });
  assert.ok(r.assumptions.some((a) => a.includes('оценочный')),
    'клиент должен видеть, что коэффициент уточняется на замере');
});

test('всегда сказано, что входит и что НЕ входит', () => {
  const r = P.estimate({ configuration: 'straight3', glazing: 'warm' });
  assert.ok(r.includes.length > 0 && r.excludes.length > 0);
  assert.ok(r.excludes.some((e) => e.includes('отделка')),
    'отделка не считается — об этом нужно сказать прямо');
});

test('мусор на входе не ломает расчёт', () => {
  for (const bad of [undefined, null, {}, { configuration: 'нет такого', glazing: 'ой' }]) {
    const r = P.estimate(bad);
    assert.ok(r.low > 0 && r.high >= r.low, 'должна вернуться валидная вилка');
  }
});

test('формат вилки читается по-русски', () => {
  const r = P.estimate({ configuration: 'straight3', glazing: 'warm' });
  const s = P.formatRange(r);
  assert.match(s, /^от .+ до .+ ₽$/, s);
});
