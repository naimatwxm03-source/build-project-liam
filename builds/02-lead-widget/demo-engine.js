/**
 * Демо-движок для витрины.
 *
 * В боевой версии диалог ведёт AI-агент в n8n (Yandex AI Studio + база знаний
 * в Qdrant), а расчёт — подworkflow. Здесь тот же расчёт, но сценарием в
 * браузере, чтобы демо работало круглосуточно и без сервера.
 *
 * ЧТО ЗДЕСЬ НАСТОЯЩЕЕ: цены. Вызывается тот же estimate() из pricing.js, что и
 * на проде, с теми же цифрами из прайса. Демо не показывает выдуманных сумм.
 *
 * ЧТО ЗДЕСЬ НЕ НАСТОЯЩЕЕ: понимание речи. Сценарий ищет ключевые слова; агент
 * понимает фразу целиком. Поэтому в демо есть кнопкоподобные подсказки, а на
 * проде их не нужно.
 *
 * Порядок разговора повторяет боевой и нарушать его нельзя: сначала польза,
 * потом телефон. Форма контактов не появится, пока не показан расчёт.
 */
(function () {
  'use strict';

  var slots = { configuration: null, glazing: null, profileTier: null, topFloor: false, extension: false };
  var quoted = false;

  function has(text, words) {
    for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) !== -1) return true;
    return false;
  }

  // Факты ниже — условия демо-компании. При внедрении они заменяются на условия
  // заказчика из его же документов. Ни одна цифра не выдумана: диапазоны взяты
  // из публичного прайса, см. PRICING-SOURCES.md.
  var FAQ = [
    { k: ['гарант'], a: 'На конструкцию и монтаж — **5 лет**, на фурнитуру — **3 года**.\n\nЭто условия демо-компании. У вашего подрядчика они будут свои: в боевой версии бот отвечает строго из документов заказчика и никогда не придумывает срок гарантии.' },
    { k: ['срок', 'долго', 'быстро', 'когда сдел'], a: 'Изготовление — **от 5 дней**. Монтаж: холодное остекление **7 дней**, тёплое **9 дней**.\n\nЗамер бесплатный, в день обращения.' },
    { k: ['рассроч', 'кредит', 'частя'], a: 'Рассрочка **до 12 месяцев**: первый взнос 0 %, переплата 0 %, сумма до 500 000 ₽.' },
    { k: ['что вход', 'включ', 'в стоимост'], a: 'В цену «под ключ» входит:\n- монтаж конструкции\n- подоконники\n- козырьки\n- водоотливы и нащельники\n- герметизация\n\n**Не входит:** внутренняя отделка, утепление, электрика и тёплый пол, шкафы. Это отдельные работы — говорю прямо, чтобы сумма в договоре вас не удивила.' },
    { k: ['замер'], a: 'Замер **бесплатный** и в день обращения. Точный замер обычно снижает итоговую стоимость: не приходится закладывать запас на неизвестность.' },
    { k: ['профил', 'rehau', 'kbe', 'exprof', 'рехау', 'кбе'], a: 'Работаем с REHAU, KBE и EXPROF.\n\n- **эконом** — Exprof Externa, KBE Engine\n- **стандарт** — Rehau Thermo, KBE Energy\n- **премиум** — Rehau Brilliant, KBE-88\n\nРазница между эконом и премиум — примерно вдвое по цене.' },
  ];

  function readSlots(t) {
    if (has(t, ['п-образ', 'п образ', 'побразн'])) slots.configuration = 'pshaped';
    else if (has(t, ['лоджи', '6 м', '6м', 'шесть'])) slots.configuration = 'loggia6';
    else if (has(t, ['балкон', '3 м', '3м', 'три метр', 'прям'])) slots.configuration = slots.configuration || 'straight3';

    if (has(t, ['тепл', 'тёпл'])) slots.glazing = 'warm';
    else if (has(t, ['холод'])) slots.glazing = 'cold';

    if (has(t, ['эконом', 'дешев', 'подешевл', 'бюджет'])) slots.profileTier = 'economy';
    else if (has(t, ['премиум', 'лучш', 'дорог', 'максимальн'])) slots.profileTier = 'premium';
    else if (has(t, ['стандарт', 'средн', 'обычн'])) slots.profileTier = 'standard';

    if (has(t, ['последний этаж', 'верхний этаж', 'крыш', 'нет крыши'])) slots.topFloor = true;
    if (has(t, ['вынос', 'расшир'])) slots.extension = true;
  }

  function quote() {
    var r = estimate(slots);
    var lines = ['**' + formatRange(r) + '**', '', r.configurationLabel + ', ' +
      (r.glazing === 'warm' ? 'тёплое остекление' : 'холодное остекление')];

    lines.push('', 'Что входит:');
    r.includes.forEach(function (x) { lines.push('- ' + x); });
    lines.push('', 'Не входит: ' + r.excludes.join(', ') + '.');

    if (r.assumptions.length) {
      lines.push('', 'Допущения:');
      r.assumptions.forEach(function (x) { lines.push('- ' + x); });
    }

    lines.push('', 'Это **вилка, а не смета**. Точную цену назовёт замерщик на объекте — заочно её не знает никто, и тот, кто называет, потом её пересматривает.');
    quoted = true;
    return lines.join('\n');
  }

  function nextQuestion() {
    if (!slots.configuration) {
      return 'Какой у вас балкон?\n- **прямой**, около 3 метров\n- **П-образный**\n- **лоджия** 6 метров';
    }
    if (!slots.glazing) {
      return 'Остекление **тёплое** или **холодное**?\n\nТёплое — если хотите пользоваться балконом зимой как комнатой. Холодное — если нужно закрыть от пыли, дождя и ветра.';
    }
    return null;
  }

  function reply(text) {
    var t = String(text || '').toLowerCase();

    for (var i = 0; i < FAQ.length; i++) {
      if (has(t, FAQ[i].k)) {
        var q = nextQuestion();
        return { reply: FAQ[i].a + (quoted || !q ? '' : '\n\n---\n\n' + q) };
      }
    }

    readSlots(t);

    var need = nextQuestion();
    if (need) return { reply: need };

    // Все данные есть — считаем и ТОЛЬКО ПОСЛЕ этого просим контакты.
    return { reply: quote() + '\n\nОставьте имя и телефон — замерщик приедет бесплатно и назовёт точную цифру.', form: 'contact' };
  }

  function contactReply(contact) {
    var name = (contact && contact.name) || '';
    return {
      reply: 'Спасибо' + (name ? ', ' + name : '') + '! Заявка принята — менеджер перезвонит в рабочее время.\n\n' +
        '---\n\n_Это демонстрация: заявка никуда не отправлена и телефон нигде не сохранён. ' +
        'В боевой версии здесь создаётся лид в Bitrix24 с приложенным расчётом._',
    };
  }

  // Тот же интерфейс, что и у сетевого вызова, чтобы виджет не знал разницы.
  window.NXAI_DEMO_REPLY = function (payload) {
    var delay = 450 + Math.random() * 500;
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(payload.contact ? contactReply(payload.contact) : reply(payload.message));
      }, delay);
    });
  };
})();
