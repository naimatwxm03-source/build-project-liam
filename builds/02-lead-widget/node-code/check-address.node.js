/**
 * Разбор ответа DaData «стандартизация адресов» в решение: считать или переспросить.
 *
 * Правило простое и на нём держится доверие к сборке: НЕТ ВНЯТНОГО АДРЕСА —
 * НЕТ ЦЕНЫ. Тест 3 из брифа именно про это: на «ул. Пушкина» бот обязан
 * переспросить, а не назвать сумму. Цена, названная по адресу, которого не
 * существует, — это счёт, который заказчик потом не выставит, и разговор,
 * который он проведёт с нами, а не с клиентом.
 *
 * Адрес НЕ влияет на стоимость. Районных прайсов у нас нет, и наценку по
 * району мы не изобретаем (см. PRICING-SOURCES.md). Адрес нужен, чтобы
 * (1) убедиться, что объект реальный, (2) убедиться, что он в зоне выезда,
 * (3) передать его замерщику в разобранном виде.
 *
 * Почему разбираем коды, а не смотрим на координаты: DaData отдаёт готовый
 * вердикт полями qc и qc_complete. Выводить то же самое из координат — писать
 * эвристику поверх сервиса, который уже ответил.
 */
'use strict';

/** Регионы, куда компания выезжает. Меняется при внедрении у заказчика. */
const SERVICE_REGIONS = ['самарская'];

/**
 * qc — нужна ли ручная проверка распознанного адреса.
 * Значения из документации DaData, не выдуманы.
 */
const QC = {
  CONFIDENT: 0, // распознан уверенно
  NEEDS_CHECK: 1, // лишние части или данных мало
  GARBAGE: 2, // пустой или заведомо мусорный
  AMBIGUOUS: 3, // есть альтернативные варианты
};

/**
 * qc_complete — годится ли адрес для доставки. Нам он говорит, чего не хватает.
 * Порядок в этой таблице — это порядок, в котором мы просим уточнить: нет
 * смысла спрашивать номер дома, если не назван город.
 */
const INCOMPLETE_REASON = {
  1: 'не указан регион',
  2: 'не указан город',
  3: 'не указана улица',
  4: 'не указан номер дома',
  6: 'адрес неполный',
  7: 'это адрес не в России',
};

function str(v) {
  return v == null ? '' : String(v).trim();
}

function firstRecord(response) {
  // DaData отвечает массивом даже на один адрес. Узел HTTP Request в n8n
  // отдаёт его то массивом, то объектом с полем data — принимаем оба.
  if (Array.isArray(response)) return response[0] || null;
  if (response && typeof response === 'object') {
    if (Array.isArray(response.data)) return response.data[0] || null;
    if (response.result !== undefined || response.qc !== undefined) return response;
  }
  return null;
}

function inServiceArea(region) {
  const r = str(region).toLowerCase().replace(/ё/g, 'е');
  if (!r) return false;
  return SERVICE_REGIONS.some((s) => r.includes(s));
}

/**
 * @returns {{ok: boolean, reason: string, ask: string, address: object}}
 *   ok      — можно ли считать смету
 *   reason  — техническая причина отказа, для лога
 *   ask     — что сказать человеку; пусто, если всё в порядке
 *   address — разобранный адрес для лида
 */
function interpretAddress(response) {
  const rec = firstRecord(response);

  if (!rec) {
    // Сервис не ответил или ответил непонятно. Это НЕ повод отказать человеку:
    // адрес на цену не влияет, а терять лид из-за сбоя стороннего сервиса —
    // худший из возможных исходов. Считаем, но помечаем адрес непроверенным.
    return {
      ok: true,
      degraded: true,
      reason: 'DaData не ответила — адрес не проверен',
      ask: '',
      address: { raw: '', result: '', city: '', street: '', house: '', region: '' },
    };
  }

  const address = {
    raw: str(rec.source),
    result: str(rec.result),
    region: str(rec.region_with_type) || str(rec.region),
    city: str(rec.city_with_type) || str(rec.city) || str(rec.settlement_with_type),
    district: str(rec.city_district_with_type),
    street: str(rec.street_with_type),
    house: str(rec.house),
    lat: str(rec.geo_lat),
    lon: str(rec.geo_lon),
    fias_level: rec.fias_level == null ? '' : String(rec.fias_level),
  };

  const qc = Number(rec.qc);
  const complete = Number(rec.qc_complete);

  if (qc === QC.GARBAGE) {
    return {
      ok: false,
      degraded: false,
      reason: 'qc=2: адрес пустой или мусорный',
      ask: 'Не разобрал адрес. Напишите, пожалуйста, город, улицу и номер дома.',
      address,
    };
  }

  // Иностранный адрес ловим раньше зоны выезда: человеку полезнее услышать
  // «мы работаем только в Самарской области», чем «не указан регион».
  if (complete === 7) {
    return {
      ok: false,
      degraded: false,
      reason: 'qc_complete=7: иностранный адрес',
      ask: 'Мы работаем в Самаре и Самарской области. Подскажите адрес объекта в этом регионе.',
      address,
    };
  }

  if (INCOMPLETE_REASON[complete]) {
    const what = INCOMPLETE_REASON[complete];
    return {
      ok: false,
      degraded: false,
      reason: `qc_complete=${complete}: ${what}`,
      ask: `Уточните, пожалуйста, адрес — ${what}.`,
      address,
    };
  }

  if (qc === QC.AMBIGUOUS) {
    return {
      ok: false,
      degraded: false,
      reason: 'qc=3: несколько подходящих адресов',
      ask: 'Таких адресов в городе несколько. Уточните, пожалуйста, район или полное название улицы.',
      address,
    };
  }

  // Регион определился, но не наш. Честно сказать сейчас дешевле, чем
  // отправить замерщика за 400 км и разбираться потом.
  if (address.region && !inServiceArea(address.region)) {
    return {
      ok: false,
      degraded: false,
      reason: `вне зоны выезда: ${address.region}`,
      ask: `Мы работаем в Самаре и Самарской области, а ${address.region} — за пределами выезда. Подсказать кого-то в вашем городе не смогу, но посчитать для объекта в Самарской области — с радостью.`,
      address,
    };
  }

  // qc=1 — данных маловато, но дом и город есть. Считаем, помечаем адрес
  // приблизительным: замерщик всё равно позвонит перед выездом.
  if (qc === QC.NEEDS_CHECK) {
    return {
      ok: true,
      degraded: true,
      reason: 'qc=1: адрес распознан неточно',
      ask: '',
      address,
    };
  }

  return { ok: true, degraded: false, reason: '', ask: '', address };
}

// ---------------------------------------------------------------------------
//   источник: builds/02-lead-widget/address.js
//
// Узел HTTP заменяет элемент ответом DaData, поэтому разобранные аргументы
// забираем обратно из узла разбора, а не из $json.
// ---------------------------------------------------------------------------
const args = $('Parse Estimate Args').first().json;

return $input.all().map((item) => {
  const verdict = interpretAddress(item.json);
  return {
    json: {
      ...args,
      address_ok: verdict.ok,
      address_degraded: verdict.degraded,
      address_reason: verdict.reason,
      address_ask: verdict.ask,
      address_clean: verdict.address,
    },
  };
});
