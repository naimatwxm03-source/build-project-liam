/**
 * NXAI lead-gen chat widget.
 *
 * Embeds on a client's site with one tag:
 *
 *   <script src="widget.js"
 *           data-endpoint="https://n8n.n-enterprise.ru/webhook/chat"
 *           data-phone="+7 (846) 000-00-00"
 *           data-title="Остекление балконов"></script>
 *
 * Design rules that are not negotiable:
 *
 * 1. THE WIDGET NEVER DECIDES WHEN TO ASK FOR A PHONE. The server replies with
 *    `form: "contact"` when the estimate has already been delivered. Asking for
 *    a phone before giving value kills the funnel, and making that a server
 *    decision means it cannot be broken by editing CSS.
 *
 * 2. NO PHONE WITHOUT CONSENT. The contact form will not submit without the
 *    152-ФЗ checkbox ticked. Client-side is not legal protection on its own,
 *    but shipping a form that collects a phone with no consent box is not
 *    something we do.
 *
 * 3. SHADOW DOM. A client's site CSS must not reach inside, and ours must not
 *    leak out. A marketing team will restyle their page the week after launch.
 *
 * 4. AN ERROR IS NEVER A DEAD END. If the backend is unreachable the widget
 *    hands over a phone number. A lead-gen widget that says "произошла ошибка"
 *    and stops has cost the client a sale.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var data = (script && script.dataset) || {};

  var cfg = {
    endpoint: data.endpoint || '',
    phone: data.phone || '',
    title: data.title || 'Остекление балконов',
    subtitle: data.subtitle || 'Рассчитаем стоимость за минуту',
    accent: data.accent || '#1f6feb',
    privacyUrl: data.privacyUrl || '',
    greeting: data.greeting ||
      'Здравствуйте! Отвечу на вопросы по остеклению и бесплатно посчитаю стоимость вашего балкона. Что вас интересует?',
  };

  // ---------------------------------------------------------------------------
  // Session id. Kept in localStorage so a reload continues the same conversation
  // rather than starting a stranger. Private-mode browsers throw on access, and
  // a thrown error here would take the whole widget down, so every touch is
  // guarded and falls back to a per-tab id.
  // ---------------------------------------------------------------------------
  var SESSION_KEY = 'nxai_widget_session';

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function sessionId() {
    try {
      var v = localStorage.getItem(SESSION_KEY);
      if (!v) { v = uuid(); localStorage.setItem(SESSION_KEY, v); }
      return v;
    } catch (e) {
      if (!window.__nxaiSession) window.__nxaiSession = uuid();
      return window.__nxaiSession;
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering. The server returns light markdown; we render a deliberately tiny
  // subset and escape everything else. Never innerHTML a server string whole —
  // the reply passes through an LLM, and an LLM will eventually emit a tag.
  // ---------------------------------------------------------------------------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderText(s) {
    return escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?:^|\n)[-•]\s+(.+)/g, '\n<span class="li">• $1</span>')
      .replace(/\n/g, '<br>');
  }

  var CSS = [
    ':host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
    '*{box-sizing:border-box}',
    '.launcher{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;',
    'border:0;cursor:pointer;background:var(--accent);color:#fff;font-size:26px;line-height:1;',
    'box-shadow:0 6px 24px rgba(0,0,0,.22);z-index:2147483000;transition:transform .15s}',
    '.launcher:hover{transform:scale(1.06)}',
    '.launcher[hidden]{display:none}',
    '.panel{position:fixed;right:20px;bottom:20px;width:380px;max-width:calc(100vw - 32px);',
    'height:600px;max-height:calc(100vh - 40px);background:#fff;border-radius:16px;display:flex;',
    'flex-direction:column;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.24);z-index:2147483000}',
    '.panel[hidden]{display:none}',
    '.head{background:var(--accent);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;flex:0 0 auto}',
    '.head h3{margin:0;font-size:15px;font-weight:600}',
    '.head p{margin:2px 0 0;font-size:12px;opacity:.85}',
    '.head button{margin-left:auto;background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer;opacity:.85;line-height:1}',
    '.log{flex:1 1 auto;overflow-y:auto;padding:16px;background:#f6f7f9;display:flex;flex-direction:column;gap:10px}',
    '.msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:normal;word-wrap:break-word}',
    '.msg.bot{background:#fff;color:#16181d;border-bottom-left-radius:4px;align-self:flex-start;box-shadow:0 1px 3px rgba(0,0,0,.08)}',
    '.msg.user{background:var(--accent);color:#fff;border-bottom-right-radius:4px;align-self:flex-end}',
    '.msg .li{display:block;padding-left:2px}',
    '.typing{align-self:flex-start;background:#fff;border-radius:14px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.08);display:flex;gap:4px}',
    '.typing span{width:7px;height:7px;border-radius:50%;background:#b3b8c2;animation:b 1.3s infinite}',
    '.typing span:nth-child(2){animation-delay:.18s}.typing span:nth-child(3){animation-delay:.36s}',
    '@keyframes b{0%,60%,100%{opacity:.3}30%{opacity:1}}',
    '.foot{flex:0 0 auto;border-top:1px solid #e6e8ec;background:#fff;padding:10px}',
    '.row{display:flex;gap:8px;align-items:flex-end}',
    'textarea{flex:1;resize:none;border:1px solid #d7dae0;border-radius:10px;padding:9px 11px;',
    'font:inherit;font-size:14px;max-height:110px;outline:0;color:#16181d;background:#fff}',
    'textarea:focus{border-color:var(--accent)}',
    '.send{flex:0 0 auto;width:38px;height:38px;border:0;border-radius:10px;background:var(--accent);',
    'color:#fff;cursor:pointer;font-size:17px}',
    '.send:disabled{opacity:.45;cursor:default}',
    '.form{display:flex;flex-direction:column;gap:8px}',
    '.form input{border:1px solid #d7dae0;border-radius:10px;padding:9px 11px;font:inherit;font-size:14px;outline:0;color:#16181d;background:#fff}',
    '.form input:focus{border-color:var(--accent)}',
    '.form .consent{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;color:#5c6370;line-height:1.4}',
    '.form .consent input{flex:0 0 auto;margin-top:1px;width:14px;height:14px}',
    '.form .consent a{color:var(--accent)}',
    '.form button{border:0;border-radius:10px;background:var(--accent);color:#fff;padding:10px;font:inherit;font-size:14px;font-weight:600;cursor:pointer}',
    '.form button:disabled{opacity:.45;cursor:default}',
    '.note{font-size:11px;color:#8b919c;text-align:center;padding:6px 0 0}',
    '@media(max-width:440px){.panel{right:0;bottom:0;width:100vw;height:100dvh;max-height:100dvh;border-radius:0}',
    '.launcher{right:14px;bottom:14px}}',
  ].join('');

  var host = document.createElement('div');
  host.setAttribute('data-nxai-widget', '');
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var style = document.createElement('style');
  style.textContent = ':host{--accent:' + cfg.accent + '}' + CSS;
  root.appendChild(style);

  var wrap = document.createElement('div');
  wrap.innerHTML = [
    '<button class="launcher" part="launcher" aria-label="Открыть чат">💬</button>',
    '<section class="panel" hidden role="dialog" aria-label="Чат с консультантом">',
    '  <header class="head">',
    '    <div><h3></h3><p></p></div>',
    '    <button class="close" aria-label="Закрыть">×</button>',
    '  </header>',
    '  <div class="log" aria-live="polite"></div>',
    '  <div class="foot"></div>',
    '</section>',
  ].join('');
  root.appendChild(wrap);

  var $ = function (s) { return wrap.querySelector(s); };
  var launcher = $('.launcher');
  var panel = $('.panel');
  var log = $('.log');
  var foot = $('.foot');
  $('.head h3').textContent = cfg.title;
  $('.head p').textContent = cfg.subtitle;

  function scroll() { log.scrollTop = log.scrollHeight; }

  function addMessage(who, text) {
    var el = document.createElement('div');
    el.className = 'msg ' + who;
    el.innerHTML = renderText(text);
    log.appendChild(el);
    scroll();
    return el;
  }

  var typingEl = null;
  function typing(on) {
    if (on && !typingEl) {
      typingEl = document.createElement('div');
      typingEl.className = 'typing';
      typingEl.innerHTML = '<span></span><span></span><span></span>';
      log.appendChild(typingEl);
      scroll();
    } else if (!on && typingEl) {
      typingEl.remove();
      typingEl = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Composer — either the message box or the contact form, never both.
  // ---------------------------------------------------------------------------
  function showComposer() {
    foot.innerHTML =
      '<div class="row">' +
      '<textarea rows="1" placeholder="Напишите сообщение…" aria-label="Сообщение"></textarea>' +
      '<button class="send" aria-label="Отправить">➤</button>' +
      '</div>';
    var ta = foot.querySelector('textarea');
    var send = foot.querySelector('.send');

    function submit() {
      var text = ta.value.trim();
      if (!text) return;
      ta.value = '';
      ta.style.height = 'auto';
      sendMessage(text);
    }
    send.addEventListener('click', submit);
    ta.addEventListener('input', function () {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 110) + 'px';
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    return ta;
  }

  function showContactForm() {
    var privacy = cfg.privacyUrl
      ? '<a href="' + escapeHtml(cfg.privacyUrl) + '" target="_blank" rel="noopener">обработку персональных данных</a>'
      : 'обработку персональных данных';

    foot.innerHTML =
      '<div class="form">' +
      '<input type="text" name="name" placeholder="Как вас зовут?" autocomplete="name">' +
      '<input type="tel" name="phone" placeholder="Телефон" autocomplete="tel" inputmode="tel">' +
      '<label class="consent"><input type="checkbox" name="consent">' +
      '<span>Согласен на ' + privacy + ' для обратной связи</span></label>' +
      '<button type="button" disabled>Отправить</button>' +
      '</div>';

    var name = foot.querySelector('[name=name]');
    var phone = foot.querySelector('[name=phone]');
    var consent = foot.querySelector('[name=consent]');
    var btn = foot.querySelector('button');

    // Consent is a hard gate, not a nudge. No tick, no submit.
    function validate() {
      var digits = phone.value.replace(/\D/g, '').length;
      btn.disabled = !(consent.checked && digits >= 10 && name.value.trim().length >= 2);
    }
    [name, phone].forEach(function (el) { el.addEventListener('input', validate); });
    consent.addEventListener('change', validate);

    btn.addEventListener('click', function () {
      btn.disabled = true;
      sendContact({ name: name.value.trim(), phone: phone.value.trim(), consent: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------
  var busy = false;

  function post(payload) {
    return fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ session_id: sessionId() }, payload)),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fallbackMessage() {
    return cfg.phone
      ? 'Секунду, соединяюсь с менеджером — а пока можно позвонить напрямую: **' + cfg.phone + '**'
      : 'Секунду, соединяюсь с менеджером.';
  }

  function handleReply(res) {
    addMessage('bot', res && res.reply ? res.reply : fallbackMessage());
    if (res && res.form === 'contact') showContactForm();
    else showComposer();
  }

  function withRequest(payload) {
    busy = true;
    typing(true);
    var run = cfg.endpoint ? post(payload) : window.NXAI_DEMO_REPLY(payload);
    return run
      .then(function (res) { typing(false); handleReply(res); })
      .catch(function (err) {
        typing(false);
        // Never a dead end: hand over a phone number and keep the box open.
        addMessage('bot', fallbackMessage());
        showComposer();
        if (window.console) console.warn('[nxai-widget]', err);
      })
      .then(function () { busy = false; });
  }

  function sendMessage(text) {
    if (busy) return;
    addMessage('user', text);
    withRequest({ message: text });
  }

  function sendContact(contact) {
    if (busy) return;
    addMessage('user', contact.name + ' · ' + contact.phone);
    withRequest({ contact: contact });
  }

  // ---------------------------------------------------------------------------
  // Open / close
  // ---------------------------------------------------------------------------
  var started = false;
  function open() {
    panel.hidden = false;
    launcher.hidden = true;
    if (!started) {
      started = true;
      addMessage('bot', cfg.greeting);
      var ta = showComposer();
      if (window.matchMedia('(min-width:441px)').matches && ta) ta.focus();
    }
    scroll();
  }
  function close() { panel.hidden = true; launcher.hidden = false; }

  launcher.addEventListener('click', open);
  $('.close').addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) close();
  });

  (document.body || document.documentElement).appendChild(host);

  window.NXAIWidget = { open: open, close: close, sessionId: sessionId, config: cfg };
})();
