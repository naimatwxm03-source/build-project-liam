/**
 * Приведение запроса виджета к общему конверту.
 *
 * Конверт тот же, что у VK-адаптера (builds/vk-adapter/normalize-vk.js):
 * channel, user_id, session_key, text, ts. Это не лишняя работа — благодаря
 * одинаковому конверту один и тот же агент обслужит и сайт, и VK, и Авито,
 * а добавление канала станет новым адаптером, а не переписыванием сборки.
 *
 * У веб-канала нет user_id, поэтому session_id играет обе роли. Он приходит
 * из браузера, то есть управляем снаружи — значит всё, что на нём завязано,
 * должно быть безвредно при подделке. Чужая память — это чужой разговор об
 * остеклении, не более; лимит считается по тому же ключу, поэтому подделка
 * не даёт обхода, а лишь делит чужую квоту.
 */
'use strict';

const MAX_TEXT = 2000; // человек столько не пишет; отсекаем вставленную простыню
const MAX_NAME = 120;
const MAX_PHONE = 32;

/**
 * Выбрасывает управляющие символы и обрезает по длине.
 *
 * Посимвольно, а не регуляркой с диапазоном: диапазон управляющих символов
 * приходится записывать escape-последовательностями, которые невидимы при
 * ревью и легко ломаются при копировании. Здесь условие видно глазами.
 */
function clean(value, max) {
  if (value == null) return '';
  const s = String(value);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 32 || code === 127) continue;
    out += s[i];
  }
  return out.trim().slice(0, max);
}

/** Телефон нужен менеджеру, а не парсеру: храним как есть, сверяем только длину. */
function phoneDigits(raw) {
  return clean(raw, MAX_PHONE).replace(/\D/g, '').length;
}

function normalizeWebRequest(body) {
  const b = body && typeof body === 'object' ? body : {};
  const sessionId = clean(b.session_id, 64);
  const contact = b.contact && typeof b.contact === 'object' ? b.contact : null;

  const envelope = {
    channel: 'web',
    session_id: sessionId,
    user_id: sessionId,
    session_key: sessionId ? 'web:' + sessionId : '',
    text: clean(b.message, MAX_TEXT),
    ts: new Date().toISOString(),
    is_contact: false,
    contact_name: '',
    contact_phone: '',
    contact_consent: false,
    valid: false,
    invalid_reason: '',
  };

  if (!sessionId) {
    envelope.invalid_reason = 'нет session_id';
    return envelope;
  }

  if (contact) {
    envelope.is_contact = true;
    envelope.contact_name = clean(contact.name, MAX_NAME);
    envelope.contact_phone = clean(contact.phone, MAX_PHONE);
    envelope.contact_consent = contact.consent === true;

    // 152-ФЗ. Галочка проверяется и в виджете, и здесь. Клиентскую проверку
    // обойдёт любой, кто открыл консоль; серверную — нет. Телефон без согласия
    // не сохраняется, и это не обсуждается.
    if (!envelope.contact_consent) {
      envelope.invalid_reason = 'нет согласия на обработку персональных данных';
      return envelope;
    }
    if (phoneDigits(envelope.contact_phone) < 10) {
      envelope.invalid_reason = 'телефон короче 10 цифр';
      return envelope;
    }
    envelope.valid = true;
    return envelope;
  }

  if (!envelope.text) {
    envelope.invalid_reason = 'пустое сообщение';
    return envelope;
  }

  envelope.valid = true;
  return envelope;
}

// ---------------------------------------------------------------------------
// Склейка с n8n. Всё выше внедряется из normalize-web.js генератором
// make-workflow.py. Не править здесь — править источник и перегенерировать.
// ---------------------------------------------------------------------------
return $input.all().map((item) => ({
  json: normalizeWebRequest(item.json.body !== undefined ? item.json.body : item.json),
}));
