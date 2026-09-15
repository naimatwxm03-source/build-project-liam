/**
 * Сборка строки лида из того, что накопилось за разговор.
 *
 * Лид — это единственный результат, за который клиент платит. Всё остальное в
 * сборке существует ради того, чтобы эта строка появилась и была полезной
 * менеджеру. Поэтому здесь два правила, и оба жёстче обычного:
 *
 * 1. БЕЗ СОГЛАСИЯ СТРОКИ НЕТ. 152-ФЗ. Галочку проверяет виджет, но виджет
 *    живёт в браузере посетителя и обходится консолью за десять секунд.
 *    Проверка здесь — единственная, которая что-то гарантирует.
 *
 * 2. ЛИД НЕ ТЕРЯЕТСЯ НИКОГДА. Плохой адрес, недоступная DaData, пропавший
 *    расчёт — всё это поводы пометить строку на ручную проверку, но не поводы
 *    выбросить телефон человека, который его оставил. Правило CLAUDE.md:
 *    «сбой разбора уходит на ручную проверку, а не в автоматический отказ».
 */
'use strict';

const MAX = { name: 120, phone: 32, address: 300, reason: 500 };

function str(v, max) {
  if (v == null) return '';
  return String(v).trim().replace(/\s+/g, ' ').slice(0, max);
}

/**
 * Читает снимок расчёта из Redis.
 *
 * Ключ `quoted:<session_id>` раньше хранил строку «1» — только факт расчёта.
 * Теперь там JSON со сметой, но старые ключи живут ещё час после обновления,
 * и разбор обязан пережить оба формата. Возврат null означает «расчёта не
 * видно» — это повод для ручной проверки, а не для отказа.
 */
function parseQuoted(raw) {
  if (raw == null) return null;
  const s = typeof raw === 'string' ? raw.trim() : raw;
  if (s === '' || s === '1' || s === 1) return null;

  let o = s;
  if (typeof s === 'string') {
    try { o = JSON.parse(s); } catch (e) { return null; }
  }
  if (!o || typeof o !== 'object') return null;

  const low = Number(o.price_low);
  const high = Number(o.price_high);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;

  return {
    price_low: low,
    price_high: high,
    configuration: str(o.configuration, 40),
    glazing: str(o.glazing, 20),
  };
}

/**
 * @param {object} opts
 * @param {object} opts.envelope   конверт из normalize-web.js
 * @param {object} opts.address    вердикт interpretAddress, или null если адреса нет
 * @param {object} opts.quoted     результат parseQuoted, или null
 * @returns {{ok: boolean, reason: string, row: object}}
 *   ok=false означает, что строку писать НЕЛЬЗЯ (нет согласия). Во всех
 *   остальных случаях строка пишется, но может быть помечена needs_review.
 */
function buildLead(opts) {
  const o = opts || {};
  const env = o.envelope && typeof o.envelope === 'object' ? o.envelope : {};
  const quoted = o.quoted || null;
  const addr = o.address || null;

  // Согласие. Единственная проверка во всей функции, которая отказывает.
  if (env.contact_consent !== true) {
    return { ok: false, reason: 'нет согласия на обработку персональных данных', row: null };
  }

  const phone = str(env.contact_phone, MAX.phone);
  if (phone.replace(/\D/g, '').length < 10) {
    return { ok: false, reason: 'телефон короче 10 цифр', row: null };
  }

  const review = [];
  if (!quoted) review.push('расчёт не найден — форма показалась без сметы');

  let addressRaw = '';
  let addressClean = '';
  let addressNote = '';
  if (addr) {
    addressRaw = str(addr.address && addr.address.raw, MAX.address);
    addressClean = str(addr.address && addr.address.result, MAX.address);
    addressNote = str(addr.reason, MAX.reason);
    if (addr.degraded) review.push('адрес не проверен — DaData недоступна');
    else if (!addr.ok) review.push('адрес не подтверждён: ' + addressNote);
  } else {
    addressNote = 'адрес не указан';
  }

  return {
    ok: true,
    reason: '',
    row: {
      session_id: str(env.session_id, 64),
      created_at: new Date().toISOString(),
      channel: str(env.channel, 16) || 'web',
      name: str(env.contact_name, MAX.name),
      phone,
      consent: true,
      address_raw: addressRaw,
      address_clean: addressClean,
      address_note: addressNote,
      price_low: quoted ? quoted.price_low : null,
      price_high: quoted ? quoted.price_high : null,
      configuration: quoted ? quoted.configuration : '',
      glazing: quoted ? quoted.glazing : '',
      needs_review: review.length > 0,
      review_reason: str(review.join('; '), MAX.reason),
    },
  };
}

/** Что сказать человеку после того, как строка записана. */
function leadReply(row, clientPhone) {
  const named = row && row.name ? row.name.split(' ')[0] : '';
  const hello = named ? named + ', заявка принята' : 'Заявка принята';
  const tail = clientPhone
    ? '\n\nЕсли удобнее позвонить самому: **' + clientPhone + '**'
    : '';
  return hello + '. Замерщик свяжется с вами, чтобы согласовать время — ' +
    'замер бесплатный и ни к чему не обязывает.' + tail;
}
// ---------------------------------------------------------------------------
//   источник: builds/02-lead-widget/lead.js
//
// Конверт и метку расчёта берём по именам узлов: и Redis, и HTTP подменяют
// элемент своим ответом, поэтому $json здесь — это не конверт.
//
// Вердикт по адресу может отсутствовать: поле адреса в форме необязательное,
// и при пустом адресе ветка DaData не выполняется вовсе. Обращение к узлу,
// который не выполнялся, бросает исключение — отсюда try/catch.
// ---------------------------------------------------------------------------
const envelope = $('Normalize Web Request').first().json;
const CLIENT_PHONE = "+7 (846) 000-00-00";

let quotedRaw = null;
try {
  const q = $('Check Quoted — Lead').first().json;
  quotedRaw = q && q.quoted !== undefined ? q.quoted : null;
} catch (e) {
  quotedRaw = null;
}

let addressVerdict = null;
if (envelope.contact_address) {
  try {
    addressVerdict = $('Check Lead Address').first().json.lead_address || null;
  } catch (e) {
    addressVerdict = null;
  }
}

const built = buildLead({
  envelope,
  address: addressVerdict,
  quoted: parseQuoted(quotedRaw),
});

return [{
  json: {
    session_id: envelope.session_id,
    lead_ok: built.ok,
    lead_reason: built.reason,
    ...(built.row || {}),
    reply: built.ok
      ? leadReply(built.row, CLIENT_PHONE)
      : 'Не получилось сохранить заявку: ' + built.reason +
        '. Позвоните, пожалуйста, напрямую: **' + CLIENT_PHONE + '**',
  },
}];
