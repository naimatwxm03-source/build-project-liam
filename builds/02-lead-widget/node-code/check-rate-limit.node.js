/**
 * Разбор ответа Redis INCR и решение по лимиту запросов.
 *
 * Виджет стоит на чужом сайте и открыт всему интернету. Без лимита один
 * человек с консолью браузера за ночь выставляет клиенту счёт за Yandex AI
 * Studio. Поэтому лимит — часть сборки, а не опция.
 *
 * Почему не читаем ответ Redis напрямую: узел Redis в n8n кладёт результат
 * INCR под именем ключа, а ключ у нас собирается выражением. Полагаться на
 * форму ответа — значит однажды получить `undefined > 20 === false` и молча
 * остаться без защиты, ничего при этом не заметив. Берём первое числовое
 * значение, какой бы ни была обёртка.
 */
'use strict';

const WINDOW_SECONDS = 600; // 10 минут — обязано совпадать с TTL в узле Redis
const MAX_MESSAGES = 20;

function readCount(redisJson) {
  if (redisJson == null) return null;
  if (typeof redisJson === 'number') return Number.isFinite(redisJson) ? redisJson : null;
  if (typeof redisJson === 'string') return /^\d+$/.test(redisJson.trim()) ? Number(redisJson.trim()) : null;
  if (typeof redisJson !== 'object') return null;
  for (const v of Object.values(redisJson)) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  }
  return null;
}

/**
 * Если Redis недоступен или ответил непонятно — пропускаем запрос.
 *
 * Это осознанный выбор в пользу доступности. Отказать всем посетителям сайта
 * из-за сбоя вспомогательного сервиса дороже, чем на несколько минут остаться
 * без лимита: первое стоит клиенту всех лидов, второе — нескольких рублей.
 * Но факт помечается флагом, чтобы в логе исполнения было видно, что защита
 * не сработала, а не казалось, что всё в порядке.
 */
function decide(count, exempt) {
  if (count == null) {
    return { rate_count: null, rate_limited: false, rate_degraded: true,
             rate_exempt: exempt === true };
  }
  return {
    rate_count: count,
    // Тому, кому уже показали цену, лимит не применяется. Лимит существует,
    // чтобы чужой человек не жёг бюджет клиента на LLM, — а такой человек до
    // расчёта не доходит. Зато посетитель, задавший двенадцать вопросов и
    // получивший вилку, — самый ценный в воронке, и старое правило обрывало
    // разговор именно с ним.
    rate_limited: exempt === true ? false : count > MAX_MESSAGES,
    rate_degraded: false,
    rate_exempt: exempt === true,
  };
}

/**
 * Была ли этой сессии показана цена. ЧИТАЕТСЯ СТРОГО.
 *
 * Направление безопасности здесь такое же, как у метки заявки, и обратное
 * метке расчёта в воротах формы: ошибочное «да» означает «лимит не
 * применяется», то есть открытую дверь к бюджету клиента. Поэтому считается
 * только явное непустое значение под своим именем — никакого перебора полей.
 */
function wasQuotedStrict(redisJson, propertyName) {
  if (redisJson == null || typeof redisJson !== 'object') return false;
  const v = redisJson[propertyName];
  if (v === undefined || v === null) return false;
  return String(v).trim() !== '';
}

function limitReply() {
  return 'Слишком много сообщений подряд — сделайте паузу на пару минут.\n\n' +
    'Если вопрос срочный, позвоните напрямую: так быстрее.';
}

// ---------------------------------------------------------------------------
//   источник: builds/02-lead-widget/rate-limit.js
//
// Узел Redis подменяет элемент своим ответом, поэтому конверт берём обратно из
// узла нормализации, а не из $json — иначе session_id потеряется ровно здесь.
// ---------------------------------------------------------------------------
const envelope = $('Normalize Web Request').first().json;

// Освобождение от лимита для того, кому уже показали цену. Читается СТРОГО:
// ошибочное «да» здесь открывает дверь к бюджету клиента, а не задерживает
// форму на ход. Узел Redis при отсутствии ключа отдаёт дальше предыдущий
// элемент, в котором перебор полей нашёл бы что угодно непустое.
let exempt = false;
try {
  exempt = wasQuotedStrict($('Check Quoted — Rate').first().json, 'quoted_rate');
} catch (e) {
  exempt = false;
}

return $input.all().map((item) => {
  const verdict = decide(readCount(item.json), exempt);
  return {
    json: {
      ...envelope,
      ...verdict,
      reply: verdict.rate_limited ? limitReply() : '',
    },
  };
});
