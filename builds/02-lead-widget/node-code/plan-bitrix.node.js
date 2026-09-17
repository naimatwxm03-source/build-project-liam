/**
 * Bitrix24 — создание лида и защита от дублей (B10).
 *
 * Этот модуль НИЧЕГО не отправляет. Он только решает, что отправить, и
 * разбирает ответ. Сами HTTP-вызовы делают узлы n8n — так решение можно
 * проверить тестами, не имея под рукой живого портала.
 *
 * Три правила, каждое из CLAUDE.md:
 *
 * 1. CRM НИКОГДА НЕ РЕШАЕТ СУДЬБУ ЛИДА. Портал недоступен, вернул ошибку,
 *    отдал мусор — строка в Data Table пишется всё равно, с пометкой о том,
 *    что в CRM лид не ушёл. Data Table здесь и есть та самая таблица аудита:
 *    по ней видно, что мы отправили и что ответил Bitrix.
 *
 * 2. МЫ НЕ ДВИГАЕМ СТАДИИ. Робот создаёт лид и пишет комментарий. Менять
 *    STATUS_ID существующего лида он не имеет права: у клиента на стадиях
 *    висят его собственные бизнес-процессы, и «умный» робот их сломает.
 *
 * 3. ДУБЛЬ — ЭТО КОММЕНТАРИЙ, А НЕ ВТОРОЙ ЛИД. Человек, который вернулся на
 *    сайт и посчитал второй балкон, не должен превращаться в двух разных
 *    лидов в работе у двух разных менеджеров.
 */
'use strict';

/** Телефон в виде, пригодном для сравнения: только цифры, 8→7 для РФ. */
function phoneKey(raw) {
  const d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') return '7' + d.slice(1);
  return d;
}

/**
 * Число или null. Именно null, а не 0.
 *
 * Number(null) === 0, и Number.isFinite(0) === true — поэтому лид без расчёта
 * однажды показал бы менеджеру «Расчёт в чате: 0 ₽ — 0 ₽», то есть цену,
 * которой мы клиенту не называли. Отсутствие расчёта должно читаться как
 * отсутствие, а не как ноль.
 */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(n) {
  const v = num(n);
  if (v === null) return '';
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}

/** Человекочитаемая сводка разговора — то, что менеджер прочитает первым. */
function comments(row) {
  const r = row || {};
  const lines = [];

  if (num(r.price_low) !== null && num(r.price_high) !== null) {
    lines.push('Расчёт в чате: ' + money(r.price_low) + ' — ' + money(r.price_high));
  } else {
    lines.push('Расчёта в чате не было.');
  }

  if (r.configuration || r.glazing) {
    lines.push('Конфигурация: ' + [r.configuration, r.glazing].filter(Boolean).join(', '));
  }
  if (r.address_clean) lines.push('Адрес: ' + r.address_clean);
  else if (r.address_raw) lines.push('Адрес со слов клиента: ' + r.address_raw);
  if (r.address_note) lines.push('Об адресе: ' + r.address_note);

  if (r.needs_review === true && r.review_reason) {
    lines.push('');
    lines.push('ТРЕБУЕТ ПРОВЕРКИ: ' + r.review_reason);
  }

  lines.push('');
  lines.push('Источник: чат-виджет на сайте, сессия ' + (r.session_id || '—') + '.');
  return lines.join('\n');
}

/**
 * Ответ crm.duplicate.findbycomm → id существующего лида или null.
 *
 * Читается мягко нарочно. Неизвестная форма ответа означает «дубля не видно»,
 * то есть создаётся новый лид. Ошибиться в эту сторону — лишний лид, который
 * менеджер склеит за минуту. Ошибка в другую сторону — заявка, дописанная
 * комментарием к чужой карточке, где её никто не ждёт.
 */
function parseDuplicate(res) {
  if (!res || typeof res !== 'object') return null;
  const result = res.result;
  if (!result || typeof result !== 'object') return null;
  const ids = result.LEAD || result.lead;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const id = Number(ids[0]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Поля нового лида. */
function leadFields(row) {
  const r = row || {};
  const who = r.name || r.phone || 'клиент с сайта';
  const f = {
    TITLE: 'Остекление балкона — ' + who + ' (сайт)',
    NAME: r.name || '',
    PHONE: [{ VALUE: r.phone, VALUE_TYPE: 'MOBILE' }],
    COMMENTS: comments(r),
    SOURCE_ID: 'WEB',
    SOURCE_DESCRIPTION: 'Чат-виджет NXAI',
    OPENED: 'Y',
  };
  if (r.address_clean) f.ADDRESS = r.address_clean;
  // Сумма — нижняя граница расчёта, не середина. В воронке лучше приятный
  // сюрприз, чем сделка, которая всю дорогу выглядела дороже, чем закрылась.
  const low = num(r.price_low);
  if (low !== null && low > 0) {
    f.OPPORTUNITY = low;
    f.CURRENCY_ID = 'RUB';
  }
  return f;
}

/**
 * Что вызывать и с чем. Возвращает метод REST и тело — URL собирает узел n8n,
 * потому что в нём лежит секретный код вебхука, которому нечего делать в коде.
 *
 * @param {object} row       строка лида из buildLead
 * @param {object} dupRes    ответ crm.duplicate.findbycomm (или null/ошибка)
 */
function planCall(row, dupRes) {
  const existing = parseDuplicate(dupRes);
  if (existing) {
    return {
      method: 'crm.timeline.comment.add',
      existing_id: existing,
      body: {
        fields: {
          ENTITY_ID: existing,
          ENTITY_TYPE: 'lead',
          COMMENT: 'Повторная заявка с сайта.\n\n' + comments(row),
        },
      },
    };
  }
  return { method: 'crm.lead.add', existing_id: null,
           body: { fields: leadFields(row), params: { REGISTER_SONET_EVENT: 'Y' } } };
}

/**
 * Ответ Bitrix → две колонки для строки аудита.
 *
 * crm_status — то, что менеджер прочитает, когда спросит «а лид точно ушёл?».
 * Поэтому значения человеческие, а не коды.
 */
function readResult(res, plan) {
  const p = plan || {};
  const dup = p.existing_id ? String(p.existing_id) : '';

  if (!res || typeof res !== 'object') {
    return { crm_lead_id: dup, crm_status: 'CRM не ответила — лид только в таблице' };
  }
  if (res.error || res.error_description) {
    const msg = String(res.error_description || res.error).slice(0, 200);
    return { crm_lead_id: dup, crm_status: 'ошибка CRM: ' + msg };
  }
  if (p.existing_id) {
    return { crm_lead_id: dup, crm_status: 'дубль по телефону — комментарий к лиду ' + dup };
  }
  const id = Number(res.result);
  if (Number.isFinite(id) && id > 0) {
    return { crm_lead_id: String(id), crm_status: 'создан' };
  }
  return { crm_lead_id: '', crm_status: 'CRM ответила неожиданно — лид только в таблице' };
}

// ---------------------------------------------------------------------------
//   источник: builds/02-lead-widget/bitrix.js
//
// Решает, что отправить в Bitrix: новый лид или комментарий к найденному
// дублю. Строку лида берём по имени узла — предыдущий узел HTTP подменил
// $json своим ответом, и в нём лида уже нет.
//
// Узел поиска дублей стоит с onError: continueRegularOutput, поэтому здесь
// в $json может лежать не ответ Bitrix, а объект ошибки. Это штатный случай:
// planCall на непонятном входе создаёт новый лид.
// ---------------------------------------------------------------------------
const lead = $('Build Lead').first().json;
const dupResponse = $json && $json.result !== undefined ? $json : null;
const plan = planCall(lead, dupResponse);

return [{
  json: {
    ...lead,
    bitrix_method: plan.method,
    bitrix_body: plan.body,
    bitrix_existing_id: plan.existing_id,
  },
}];
