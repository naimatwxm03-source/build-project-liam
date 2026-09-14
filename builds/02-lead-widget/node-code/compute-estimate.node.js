/**
 * Остекление балконов — оценка стоимости по реальным опубликованным прайсам.
 *
 * ИСТОЧНИК (см. PRICING-SOURCES.md — там же даты, ссылки и все цифры):
 *   ООО ГК «Самстрой» / balkon63.ru — публикует настоящую матрицу
 *   8 профилей × 3 конфигурации для тёплого остекления, плюс цены «под ключ»
 *   для холодного. Цифры стабильные, не акционные.
 *
 * ГК «ИнРос» / inros63.ru проверен и ОТКЛОНЁН как источник цен: три страницы
 * сайта называют три разные цены «от» (39 150 / 51 130 / 36 190 ₽), и все под
 * вечным «скидка 60%, только до 14 сентября». Это рекламный якорь, а не
 * прайс-лист. Строить смету на таких числах нельзя.
 *
 * Ни одна цифра здесь не выдумана. Это правило из CLAUDE.md: никогда не
 * изобретать цены клиента. Оценка, построенная на придуманной матрице, — это
 * ложь, которую заказчик обнаружит при первом же звонке конкуренту.
 *
 * ЧТО ЭТО ВОЗВРАЩАЕТ: ВИЛКУ, а не одну цифру. Настоящая смета составляется
 * замерщиком на объекте. Виджет обязан дать честный диапазон и сказать, от чего
 * он зависит, иначе он обещает то, чего не может выполнить.
 *
 * Переносится в n8n Code node как есть — без импортов и Node-specific API.
 */

'use strict';

/**
 * Тёплое остекление «под ключ», руб. Источник: balkon63.ru, прайс 2026.
 * Ключ — конфигурация балкона, значение — [минимум по профилю, максимум].
 *
 * Минимум = Exprof Externa (самый доступный в прайсе).
 * Максимум = KBE-88 (самый дорогой в прайсе).
 */
const WARM_BY_CONFIG = {
  straight3: { low: 18050, high: 36722, label: 'прямой балкон 3 м' },
  pshaped: { low: 26840, high: 56090, label: 'П-образный балкон' },
  loggia6: { low: 33884, high: 69909, label: 'лоджия 6 м' },
};

/**
 * Классы профиля внутри матрицы Самстроя. Границы взяты по фактическим ценам
 * для прямого балкона 3 м, а не назначены произвольно.
 */
const PROFILE_TIERS = {
  economy: { factor: 0.0, label: 'эконом', examples: 'Exprof Externa, KBE Engine' },
  standard: { factor: 0.45, label: 'стандарт', examples: 'Rehau Thermo, KBE Energy' },
  premium: { factor: 1.0, label: 'премиум', examples: 'Rehau Brilliant, KBE-88' },
};

/**
 * Холодное дешевле тёплого.
 *
 * Выведено тремя независимыми способами из одного прайса (balkon63.ru):
 *   лоджия под ключ   13 890 / 18 990 = 0.731
 *   балкон под ключ   16 999 / 22 999 = 0.739
 *   цена за м²         5 149 /  7 149 = 0.720
 * Разброс 0.72–0.74. Берём 0.73.
 */
const COLD_FACTOR = 0.73;

/**
 * Надбавки. Проценты, а не рубли: в прайсах они отдельной строкой не указаны,
 * а выводятся из разницы между «остеклением» и «под ключ».
 *
 * ВНИМАНИЕ: это единственные оценочные коэффициенты в файле, и они помечены
 * как таковые в выводе. Их следует заменить на реальный прайс клиента при
 * внедрении — именно об этом надо говорить на встрече.
 */
const MODIFIERS = {
  topFloor: { factor: 0.18, label: 'крыша (последний этаж)', estimated: true },
  extension: { factor: 0.22, label: 'вынос до 30 см', estimated: true },
};

/** Минимальные цены по рынку — нижняя граница санитарной проверки. */
const MARKET_FLOOR = {
  cold: 13890, // «Лоджия (холодное остекление)» под ключ, balkon63.ru
  warm: 18050, // Exprof Externa, прямой балкон 3 м, balkon63.ru
};

function clampConfig(v) {
  return Object.prototype.hasOwnProperty.call(WARM_BY_CONFIG, v) ? v : 'straight3';
}

function clampTier(v) {
  return Object.prototype.hasOwnProperty.call(PROFILE_TIERS, v) ? v : null;
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

/**
 * Оценить стоимость остекления.
 *
 * @param {object} input
 * @param {string} input.configuration  straight3 | pshaped | loggia6
 * @param {string} input.glazing        cold | warm
 * @param {string} [input.profileTier]  economy | standard | premium; без него
 *                                      возвращается вся вилка по профилям
 * @param {boolean} [input.topFloor]    последний этаж — нужна крыша
 * @param {boolean} [input.extension]   с выносом
 * @returns {object} { low, high, currency, breakdown, assumptions, includes, excludes }
 */
function estimate(input) {
  const inp = input || {};
  const configuration = clampConfig(inp.configuration);
  const glazing = inp.glazing === 'cold' ? 'cold' : 'warm';
  const tier = clampTier(inp.profileTier);

  const base = WARM_BY_CONFIG[configuration];
  const assumptions = [];
  const breakdown = [];

  // Базовая вилка по профилям
  let low = base.low;
  let high = base.high;

  if (tier) {
    // Конкретный класс профиля — сужаем вилку вокруг точки на шкале.
    const f = PROFILE_TIERS[tier].factor;
    const span = base.high - base.low;
    const point = base.low + span * f;
    // ±8 % — разброс между марками внутри одного класса.
    low = point * 0.92;
    high = point * 1.08;
    assumptions.push(
      `класс профиля: ${PROFILE_TIERS[tier].label} (${PROFILE_TIERS[tier].examples})`
    );
  } else {
    assumptions.push('класс профиля не выбран — показана вилка от эконома до премиума');
  }

  breakdown.push({
    item: `Остекление, ${base.label}`,
    low: Math.round(low),
    high: Math.round(high),
  });

  if (glazing === 'cold') {
    low *= COLD_FACTOR;
    high *= COLD_FACTOR;
    breakdown.push({
      item: 'Холодное остекление вместо тёплого',
      low: -Math.round(breakdown[0].low * (1 - COLD_FACTOR)),
      high: -Math.round(breakdown[0].high * (1 - COLD_FACTOR)),
    });
  }

  for (const key of ['topFloor', 'extension']) {
    if (!inp[key]) continue;
    const m = MODIFIERS[key];
    const addLow = low * m.factor;
    const addHigh = high * m.factor;
    low += addLow;
    high += addHigh;
    breakdown.push({ item: m.label, low: Math.round(addLow), high: Math.round(addHigh) });
    if (m.estimated) assumptions.push(`${m.label} — коэффициент оценочный, уточняется на замере`);
  }

  // Округляем ПЕРЕД проверкой на минимум. Иначе округление вниз до 500 может
  // само увести цифру ниже рынка — так и случилось при первом прогоне тестов:
  // 13 600 превращалось в 13 500, то есть в обещание, которого никто на рынке
  // не даёт.
  let roundedLow = roundTo(low, 500);
  let roundedHigh = roundTo(high, 500);

  const floor = MARKET_FLOOR[glazing];
  let flooredTo = null;
  if (roundedLow < floor) {
    flooredTo = floor;
    roundedLow = floor;
    if (roundedHigh < roundedLow) roundedHigh = roundTo(roundedLow * 1.15, 500);
  }

  return {
    low: roundedLow,
    high: roundedHigh,
    currency: 'RUB',
    configuration,
    configurationLabel: base.label,
    glazing,
    breakdown,
    assumptions,
    flooredTo,
    // Перечень «что входит» — дословно из balkon63.ru: «монтаж подоконников,
    // козырьков от верхнего этажа, водоотливов, нащельников и герметизация
    // конструкции остекления». Не наша выдумка.
    includes: [
      'монтаж конструкции',
      'подоконники',
      'козырьки',
      'водоотливы и нащельники',
      'герметизация',
    ],
    excludes: [
      'внутренняя отделка',
      'утепление',
      'электрика и тёплый пол',
      'шкафы и мебель',
    ],
  };
}

/** Человекочитаемая вилка: «от 18 000 до 37 000 ₽». */
function formatRange(result) {
  const fmt = (n) => n.toLocaleString('ru-RU');
  if (!result || result.low == null) return 'не удалось рассчитать';
  if (result.low === result.high) return `${fmt(result.low)} ₽`;
  return `от ${fmt(result.low)} до ${fmt(result.high)} ₽`;
}

// ---------------------------------------------------------------------------
//   источник: builds/02-lead-widget/pricing.js
//
// Тот же модуль, что вызывает демо-страница, и те же цифры из прайса.
// ---------------------------------------------------------------------------
return $input.all().map((item) => {
  const a = item.json;
  const r = estimate({
    configuration: a.configuration,
    glazing: a.glazing,
    profileTier: a.profileTier,
    topFloor: a.topFloor,
    extension: a.extension,
  });

  const lines = [
    `**${formatRange(r)}**`,
    '',
    `${r.configurationLabel}, ${r.glazing === 'warm' ? 'тёплое остекление' : 'холодное остекление'}`,
    '',
    'Что входит:',
    ...r.includes.map((x) => `- ${x}`),
    '',
    `Не входит: ${r.excludes.join(', ')}.`,
  ];

  if (r.assumptions.length) {
    lines.push('', 'Допущения:', ...r.assumptions.map((x) => `- ${x}`));
  }
  if (a.address_degraded && a.has_address) {
    lines.push('', '_Адрес проверить не удалось — замерщик уточнит его при звонке._');
  }
  lines.push(
    '',
    'Это **вилка, а не смета**. Точную цену назовёт замерщик на объекте — заочно её не знает никто.'
  );

  return {
    json: {
      ...a,
      ok: true,
      price_low: r.low,
      price_high: r.high,
      price_text: formatRange(r),
      estimate_json: JSON.stringify(r),
      reply: lines.join('
'),
    },
  };
});
