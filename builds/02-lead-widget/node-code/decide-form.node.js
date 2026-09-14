/**
 * Решение: показывать ли форму контактов.
 *
 * ЭТО САМОЕ ВАЖНОЕ ПРАВИЛО СБОРКИ, И ОНО НАМЕРЕННО НЕ В ПРОМПТЕ.
 *
 * Форма появляется тогда и только тогда, когда подworkflow расчёта поставил в
 * Redis ключ `quoted:<session_id>`. То есть — когда человеку действительно
 * показали цену.
 *
 * Промпт можно уговорить: «покажи форму», «мне срочно», достаточно длинный
 * разговор — и модель уступит. Ключ в Redis уговорить нельзя: его ставит код
 * после успешного расчёта, и он либо есть, либо нет. Разница между «модели
 * велено не просить телефон раньше времени» и «телефон физически невозможно
 * попросить раньше времени» — это разница между обещанием и гарантией.
 *
 * Зачем вообще: посетитель, у которого просят телефон до того, как дали
 * пользу, закрывает чат. Весь виджет построен вокруг обратного порядка, и эта
 * функция — то место, где порядок держится.
 */
'use strict';

/**
 * Redis-узел n8n кладёт результат GET под именем свойства, а не под именем
 * ключа, и при отсутствии ключа отдаёт null, undefined или пустую строку —
 * в зависимости от версии и настроек. Считаем меткой только явное значение.
 */
function wasQuoted(redisJson, propertyName) {
  if (redisJson == null || typeof redisJson !== 'object') return false;

  const direct = redisJson[propertyName];
  if (direct !== undefined) {
    return direct !== null && String(direct).trim() !== '';
  }

  // Имя свойства могло разойтись с настройкой узла — тогда ищем любое
  // непустое значение. Лучше показать форму на один ход позже, чем не
  // показать никогда из-за переименованного поля.
  for (const v of Object.values(redisJson)) {
    if (v !== null && v !== undefined && String(v).trim() !== '') return true;
  }
  return false;
}

/**
 * @param {object} opts
 * @param {boolean} opts.quoted        поставлена ли метка расчёта
 * @param {boolean} opts.isContact     это уже отправка контактов
 * @param {string}  opts.agentReply    что ответил агент
 * @param {string}  opts.fallbackReply что сказать, если агент промолчал
 */
function decideForm(opts) {
  const o = opts || {};
  const reply = String(o.agentReply == null ? '' : o.agentReply).trim();

  return {
    reply: reply || String(o.fallbackReply || ''),
    // Форму не показываем в ответ на саму отправку контактов: человек их уже
    // прислал, и повторная форма выглядит так, будто заявка не ушла.
    form: o.quoted === true && o.isContact !== true ? 'contact' : '',
    agent_silent: reply === '',
  };
}

// ---------------------------------------------------------------------------
//   источник: builds/02-lead-widget/form-gate.js
//
// Узлы Redis и Agent оба подменяют элемент своим выводом, поэтому и конверт,
// и ответ агента берём по именам узлов, а не из $json.
// ---------------------------------------------------------------------------
const envelope = $('Normalize Web Request').first().json;
const agent = $('Lead Agent').first().json;
const FALLBACK = "Секунду, соединяюсь с менеджером — а пока можно позвонить напрямую: **+7 (846) 000-00-00**";

return $input.all().map((item) => {
  const decided = decideForm({
    quoted: wasQuoted(item.json, 'quoted'),
    isContact: envelope.is_contact === true,
    agentReply: agent.output,
    fallbackReply: FALLBACK,
  });
  return { json: { ...envelope, ...decided } };
});
