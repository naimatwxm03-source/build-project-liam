/**
 * Разбор аргументов, которые модель передала в инструмент расчёта.
 *
 * ЭТО ГРАНИЦА ДОВЕРИЯ. Всё, что приходит сюда, придумала языковая модель по
 * тексту живого человека. Она передаст «трёхметровый», «примерно 3м», «ну
 * обычный», null, пустую строку и слово «балкон» в поле типа остекления.
 * Бриф прямо предупреждает: «Model passes address as null — validate in the
 * sub-flow, don't trust it».
 *
 * Поэтому здесь не «приведение типов», а разбор естественного языка с явным
 * отказом. Чего не поняли — о том честно сообщаем наверх, и агент переспросит.
 * Молча подставить значение по умолчанию нельзя: клиент увидит цену за лоджию
 * 6 метров там, где у него балкон 3 метра, и это будет наша вина.
 */
'use strict';

/** Нормализация под сравнение: регистр, ё, дефисы, лишние пробелы. */
function fold(value) {
  if (value == null) return '';
  return String(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[-–—_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Конфигурация балкона.
 *
 * Порядок проверок важен. «П-образная лоджия» содержит и «лоджия», и «п
 * образн» — выиграть должно «п образн», потому что форма определяет метраж
 * сильнее, чем название помещения.
 */
function parseConfiguration(raw) {
  const t = fold(raw);
  if (!t) return null;

  if (/(^|\s)(п образн|побразн|п образный|углов)/.test(t)) return 'pshaped';
  if (/лодж/.test(t)) return 'loggia6';
  if (/(^|\s)(прям|балкон)/.test(t)) return 'straight3';

  // Иногда модель передаёт только длину.
  const metres = t.match(/(\d+(?:[.,]\d+)?)\s*(?:м|метр)/);
  if (metres) {
    const n = parseFloat(metres[1].replace(',', '.'));
    if (Number.isFinite(n)) return n >= 5 ? 'loggia6' : 'straight3';
  }

  // Английские ключи — на случай, если модель передала их из описания инструмента.
  if (/^(straight3|pshaped|loggia6)$/.test(t)) return t;

  return null;
}

/** Тип остекления. Отдельная функция: ошибка здесь меняет цену на четверть. */
function parseGlazing(raw) {
  const t = fold(raw);
  if (!t) return null;
  if (/(тепл|утепл|зим|жил)/.test(t)) return 'warm';
  if (/(холод|не тепл|летн)/.test(t)) return 'cold';
  if (/^(warm|cold)$/.test(t)) return t;
  return null;
}

/** Класс профиля — необязателен: без него отдаём вилку от эконома до премиума. */
function parseTier(raw) {
  const t = fold(raw);
  if (!t) return null;
  if (/(эконом|дешев|подешевл|бюджет|минимальн)/.test(t)) return 'economy';
  if (/(премиум|максимальн|лучш|дорог|топ)/.test(t)) return 'premium';
  if (/(стандарт|средн|обычн|оптимальн)/.test(t)) return 'standard';
  if (/^(economy|standard|premium)$/.test(t)) return t;
  return null;
}

/**
 * Булев флаг из чего угодно.
 *
 * Модель присылает true, "true", "да", "yes", 1, "нужен", "не нужен".
 * `Boolean("не нужен")` равен true — поэтому отрицания проверяются первыми,
 * иначе «крыша не нужна» превратится в наценку 18 %.
 */
function parseFlag(raw) {
  if (raw === true) return true;
  if (raw === false) return false;
  const t = fold(raw);
  if (!t) return false;
  if (/(^|\s)(не|нет|без)(\s|$)/.test(t)) return false;
  // Основа «нуж», а не «нужн»: в мужском роде беглая гласная даёт «нужен»,
  // и стем «нужн» его не ловит. На этом тест и поймал ошибку — «нужен вынос»
  // читался как «вынос не нужен» и тихо срезал 22 % из сметы.
  return /(^|\s)(да|нуж|надо|есть|true|yes|1|последн|верхн)/.test(t);
}

/** Этаж — только чтобы понять, последний ли он. Само число на цену не влияет. */
function parseFloor(raw) {
  if (raw == null || raw === '') return null;
  const n = parseInt(String(raw).replace(/\D+/g, ''), 10);
  return Number.isFinite(n) && n > 0 && n < 200 ? n : null;
}

/**
 * Адрес нужен не для цены, а для проверки реальности объекта и для лида.
 * Районных цен у нас нет, и выдумывать наценку по району мы не будем —
 * поэтому адрес сюда попадает как есть, а решает по нему геокодер.
 */
function parseAddress(raw) {
  const s = raw == null ? '' : String(raw).trim().replace(/\s+/g, ' ');
  return s.slice(0, 300);
}

/**
 * @returns {{ok: boolean, value: object, missing: string[], notes: string[]}}
 *   ok — хватает ли данных для расчёта
 *   missing — что переспросить у человека, человеческими словами
 */
function parseEstimateArgs(args) {
  const a = args && typeof args === 'object' ? args : {};

  const configuration = parseConfiguration(
    a.configuration !== undefined ? a.configuration : a.balcony_type
  );
  const glazing = parseGlazing(a.glazing !== undefined ? a.glazing : a.glazing_type);
  const profileTier = parseTier(a.profile_tier !== undefined ? a.profile_tier : a.tier);
  const floor = parseFloor(a.floor);

  // Последний этаж можно узнать двумя путями, и оба надо принять: модель то
  // передаёт отдельный флаг, то пишет «последний» прямо в поле этажа.
  const topFlagGiven = a.top_floor !== undefined || a.is_top_floor !== undefined;
  const topFloor = topFlagGiven
    ? parseFlag(a.top_floor !== undefined ? a.top_floor : a.is_top_floor)
    : parseFlag(a.floor);

  const extension = parseFlag(a.extension !== undefined ? a.extension : a.with_extension);
  const address = parseAddress(a.address);

  const missing = [];
  if (!configuration) missing.push('конфигурация балкона: прямой 3 метра, П-образный или лоджия');
  if (!glazing) missing.push('тип остекления: тёплое или холодное');

  const notes = [];
  if (!profileTier) notes.push('класс профиля не указан — вилка от эконома до премиума');
  if (floor === null && !topFlagGiven) notes.push('этаж не указан — крыша в расчёт не включена');

  return {
    ok: missing.length === 0,
    missing,
    notes,
    value: {
      configuration,
      glazing,
      profileTier,
      topFloor,
      extension,
      floor,
      address,
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseEstimateArgs,
    parseConfiguration,
    parseGlazing,
    parseTier,
    parseFlag,
    parseFloor,
    fold,
  };
}
