#!/usr/bin/env python3
"""Собирает builds/02-lead-widget/workflow.json.

Граф растёт с B1 до B11, и править тридцатиузловой JSON руками — верный способ
разорвать ссылку `$('Имя узла')` и не заметить этого до продакшена. Генератор
держит имена узлов в одном месте: переименование ломает сборку здесь, а не в
рантайме у клиента.

Версии узлов (typeVersion) не угаданы, а прочитаны: базовые — из рабочего
builds/01-receipt-bot/workflow.json, langchain-узлы — из исходников n8n по тегу
n8n@2.36.8. Неверная версия импортируется молча и падает уже при запуске, то
есть у клиента.

    python3 builds/02-lead-widget/make-workflow.py
    python3 builds/02-lead-widget/make-workflow.py --check
"""

import json
import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "workflow.json"
OUT_ESTIMATE = HERE / "estimate.workflow.json"
NODE_CODE_DIR = HERE / "node-code"

WORKFLOW_NAME = "02 Lead Widget — Chat"
ESTIMATE_WORKFLOW_NAME = "02 Lead Widget — Calc Estimate"

# Метка «этой сессии уже показали расчёт». Её ставит подworkflow, а основной
# поток по ней решает, показывать ли форму контактов. Промпт можно уговорить,
# ключ в Redis — нельзя: он либо есть, либо нет.
QUOTED_TTL = 3600

# Домены, которым разрешено обращаться к вебхуку. НЕ "*": открытый лид-вебхук —
# это чужой бесплатный LLM за счёт клиента. Меняется на домен заказчика.
ALLOWED_ORIGINS = "https://n-enterprise.ru,https://www.n-enterprise.ru"

# Публичный телефон заказчика. Не секрет и намеренно лежит в workflow, а не в
# переменной окружения: это конфигурация клиента, которую меняют при внедрении,
# и ради неё не должно требоваться перезапускать контейнер.
CLIENT_PHONE = "+7 (846) 000-00-00"

# Модель. yandexgpt-lite, а не Qwen: Build 1 показал 40.5с против 17.3с при
# одинаковой точности, плюс Яндекс накручивает ~30x на китайские модели.
# В диалоговом виджете задержка видна посетителю напрямую.
MODEL_URI = "gpt://b1gg2h3lj0e41o47fkoo/yandexgpt-lite/latest"

# Модель эмбеддингов ДЛЯ ПОИСКА. У Яндекса они разные и не взаимозаменяемы:
# text-search-doc индексирует документы, text-search-query обрабатывает запросы.
# Индексацию делает ingest-kb.py моделью doc, поиск — этот узел моделью query.
# Перепутать — значит тихо просесть в качестве поиска и потом объяснять клиенту,
# что «RAG почему-то не работает».
EMBEDDING_QUERY_URI = "emb://b1gg2h3lj0e41o47fkoo/text-search-query/latest"

QDRANT_COLLECTION = "kb_demo_balkon"

# ID подworkflow расчёта в ЭТОМ экземпляре n8n. На другой инсталляции он другой,
# и узел-инструмент придётся перевыбрать из выпадающего списка.
ESTIMATE_WORKFLOW_ID = "uS4PnrfyzBxTT0hd"

# Системный промпт. Растёт по мере появления инструментов: на шаге B2 расчёта
# ещё нет, поэтому промпт ПРЯМО ЗАПРЕЩАЕТ называть цифры. Промпт, обещающий
# калькулятор, которого нет, — это инструкция галлюцинировать.
SYSTEM_PROMPT = """Ты — консультант компании по остеклению балконов в Самаре. Общаешься в чате на сайте.

=== СНАЧАЛА ОТВЕТ, ПОТОМ ВОПРОС ===
Если человек о чём-то спросил — сначала ответь ему, и только потом задавай
свой следующий вопрос. В одном сообщении: ответ, затем один вопрос.

Так нельзя: «Уточните сначала тип балкона, а потом расскажу про гарантию».
Так нужно: «Гарантия 5 лет на конструкцию и 3 года на фурнитуру. А балкон у
вас прямой, П-образный или лоджия?»

Никогда не заставляй человека пройти твою анкету, чтобы получить ответ.
Он пришёл с вопросом, а не заполнять форму, и закроет чат ровно там, где
его начнут допрашивать.

=== ПРАВИЛО ОДНОГО ВОПРОСА ===
В каждом своём сообщении задавай РОВНО ОДИН вопрос. Не два, не три, не список.
Задал вопрос — поставил точку и жди ответа.

Так нельзя: «Какая конфигурация? Тёплое или холодное? Какой этаж? Нужен вынос?»
Так нужно: «Какой у вас балкон — прямой примерно 3 метра, П-образный или лоджия?»

Это не стилистика. Четыре вопроса сразу превращают разговор в анкету, а анкету
человек закрывает. Ради этого правила всё и строилось.

=== ТОЛЬКО ИЗ БАЗЫ ЗНАНИЙ ===
На вопросы о ценах, сроках, гарантии, рассрочке, профилях и составе работ
отвечай ТОЛЬКО тем, что вернул инструмент knowledge_base. Вызывай его всякий
раз, когда спрашивают о чём-то из этого списка, даже если кажется, что ответ
очевиден.

Если в базе ответа нет — так и скажи: «этого у меня нет, уточню у менеджера».
Это нормальный ответ. Выдуманная цифра всплывёт при первом же звонке конкуренту
и будет стоить компании сделки, а «уточню» не стоит ничего.

Никогда не смешивай найденное с собственными догадками. Если база дала вилку
цен — назови именно её и скажи, что точная цифра будет после замера.

=== РАСЧЁТ ===
Как только знаешь конфигурацию балкона И тип остекления — вызывай инструмент
calc_estimate. Не жди, пока выяснишь всё: этаж и вынос уточняют цифру, но без
них расчёт тоже работает.

Передавай в инструмент то, что человек сказал, своими словами: «лоджия
6 метров», «тёплое», «последний этаж». Разбирать их — не твоя работа.
Адрес передавай, только если человек его назвал сам; не выпрашивай.

Результат инструмента показывай целиком, как он пришёл. Не пересчитывай, не
округляй, не «уточняй» цифры от себя. Если инструмент вернул ok=false — он
объяснил, чего не хватает; спроси именно это.

=== ЧТО ВЫЯСНИТЬ, В ЭТОМ ПОРЯДКЕ ===
Спрашивай по одному пункту за сообщение. Если человек назвал что-то сам —
не переспрашивай, переходи к следующему пункту.
1. конфигурация: прямой балкон около 3 метров, П-образный или лоджия 6 метров
2. остекление тёплое или холодное
3. этаж — на последнем нужна крыша
4. нужен ли вынос

Первых двух пунктов уже достаточно, чтобы вызвать расчёт. Остальные два
уточняют цифру — спрашивай их, но не держи из-за них человека без цены.

Объясняй разницу простыми словами, если спрашивают. Тёплое — чтобы пользоваться
балконом зимой как комнатой. Холодное — закрыть от пыли, дождя и ветра.

=== ТЕЛЕФОН ===
Телефон не спрашивай никогда — ни до расчёта, ни после. Форму контактов
показывает система, и она делает это сама, когда расчёт уже показан.
Твоё дело — довести до расчёта.

=== ТОН ===
Коротко, по-человечески, без канцелярита. Два-три предложения, потом один
вопрос. Ты не робот-анкета."""

# Что отвечаем, когда модель не ответила. Тупик на лид-форме стоит клиенту сделки,
# поэтому даже отказ заканчивается телефоном, а не сообщением об ошибке.
HANDOVER_REPLY = (
    "Секунду, соединяюсь с менеджером — а пока можно позвонить напрямую: **"
    + CLIENT_PHONE
    + "**"
)


# --- код для Code-узлов -------------------------------------------------------

def read_source(name: str) -> str:
    """Берёт модуль как есть, срезая CommonJS-экспорт: в песочнице n8n нет module."""
    src = (HERE / name).read_text(encoding="utf-8")
    src = re.sub(
        r"\nif \(typeof module !== 'undefined'.*?\n\}\n", "\n", src, flags=re.DOTALL
    )
    return src.rstrip()


NORMALIZE_GLUE = r"""

// ---------------------------------------------------------------------------
// Склейка с n8n. Всё выше внедряется из normalize-web.js генератором
// make-workflow.py. Не править здесь — править источник и перегенерировать.
// ---------------------------------------------------------------------------
return $input.all().map((item) => ({
  json: normalizeWebRequest(item.json.body !== undefined ? item.json.body : item.json),
}));
"""

RATE_LIMIT_GLUE = r"""

// ---------------------------------------------------------------------------
//   источник: builds/02-lead-widget/rate-limit.js
//
// Узел Redis подменяет элемент своим ответом, поэтому конверт берём обратно из
// узла нормализации, а не из $json — иначе session_id потеряется ровно здесь.
// ---------------------------------------------------------------------------
const envelope = $('Normalize Web Request').first().json;

return $input.all().map((item) => {
  const verdict = decide(readCount(item.json));
  return {
    json: {
      ...envelope,
      ...verdict,
      reply: verdict.rate_limited ? limitReply() : '',
    },
  };
});
"""

PARSE_ARGS_GLUE = r"""

// ---------------------------------------------------------------------------
//   источник: builds/02-lead-widget/estimate-input.js
//
// Всё, что приходит сюда, придумала языковая модель по фразе живого человека.
// Это граница доверия, а не приведение типов.
// ---------------------------------------------------------------------------
return $input.all().map((item) => {
  const parsed = parseEstimateArgs(item.json);
  return {
    json: {
      ...parsed.value,
      session_id: String(item.json.session_id || ''),
      args_ok: parsed.ok,
      missing: parsed.missing,
      missing_text: parsed.missing.join('; '),
      notes: parsed.notes,
      has_address: Boolean(parsed.value.address),
    },
  };
});
"""

CHECK_ADDRESS_GLUE = r"""

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
"""

COMPUTE_GLUE = r"""

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
      reply: lines.join('\n'),
    },
  };
});
"""

FORM_GATE_GLUE = r"""

// ---------------------------------------------------------------------------
//   источник: builds/02-lead-widget/form-gate.js
//
// Узлы Redis и Agent оба подменяют элемент своим выводом, поэтому и конверт,
// и ответ агента берём по именам узлов, а не из $json.
// ---------------------------------------------------------------------------
const envelope = $('Normalize Web Request').first().json;
const agent = $('Lead Agent').first().json;
const FALLBACK = __HANDOVER__;

return $input.all().map((item) => {
  const decided = decideForm({
    quoted: wasQuoted(item.json, 'quoted'),
    isContact: envelope.is_contact === true,
    agentReply: agent.output,
    fallbackReply: FALLBACK,
  });
  return { json: { ...envelope, ...decided } };
});
"""

CODE_NODES = {
    "Normalize Web Request": ("normalize-web.js", NORMALIZE_GLUE),
    "Check Rate Limit": ("rate-limit.js", RATE_LIMIT_GLUE),
    "Decide Form": ("form-gate.js", FORM_GATE_GLUE),
}

ESTIMATE_CODE_NODES = {
    "Parse Estimate Args": ("estimate-input.js", PARSE_ARGS_GLUE),
    "Check Address": ("address.js", CHECK_ADDRESS_GLUE),
    "Compute Estimate": ("pricing.js", COMPUTE_GLUE),
}


def build_code(source: str, glue: str) -> str:
    glue = glue.replace("__HANDOVER__", json.dumps(HANDOVER_REPLY, ensure_ascii=False))
    return read_source(source) + glue


# --- узлы ---------------------------------------------------------------------

def node(name, type_, version, params, x, y, extra=None):
    n = {
        "parameters": params,
        "id": name.lower().replace(" ", "-").replace("—", "-"),
        "name": name,
        "type": type_,
        "typeVersion": version,
        "position": [x, y],
    }
    if extra:
        n.update(extra)
    return n


def reply_node(name, text, x, y, form=""):
    """Set-узел, который собирает ответ виджету.

    session_id берётся из узла нормализации, а не из $json. Узел AI Agent
    ЗАМЕНЯЕТ элемент своим выводом `{output: ...}`, поэтому конверт после него
    не существует — на живом тесте ответ ушёл клиенту без session_id вообще.
    Один источник для всех трёх веток надёжнее, чем надежда на то, что конверт
    где-то уцелел.
    """
    fields = [
        {
            "id": "session_id",
            "name": "session_id",
            "type": "string",
            "value": "={{ $('Normalize Web Request').first().json.session_id }}",
        },
        {"id": "reply", "name": "reply", "type": "string", "value": text},
        {"id": "form", "name": "form", "type": "string", "value": form},
    ]
    return node(
        name,
        "n8n-nodes-base.set",
        3.4,
        {
            "mode": "manual",
            "includeOtherFields": True,
            "assignments": {"assignments": fields},
            "options": {},
        },
        x,
        y,
    )


def if_node(name, left, operator, right, x, y, right_type="string"):
    return node(
        name,
        "n8n-nodes-base.if",
        2.2,
        {
            "conditions": {
                "options": {
                    "caseSensitive": True,
                    "leftValue": "",
                    "typeValidation": "strict",
                    "version": 2,
                },
                "conditions": [
                    {
                        "id": name.lower().replace(" ", "-"),
                        "leftValue": left,
                        "rightValue": right,
                        "operator": operator,
                    }
                ],
                "combinator": "and",
            },
            "options": {},
        },
        x,
        y,
    )


BOOL_TRUE = {"type": "boolean", "operation": "true", "singleValue": True}


def build():
    codes = {n: build_code(src, glue) for n, (src, glue) in CODE_NODES.items()}

    nodes = [
        node(
            "Widget Webhook",
            "n8n-nodes-base.webhook",
            2,
            {
                "httpMethod": "POST",
                "path": "chat",
                "responseMode": "responseNode",
                # CORS живёт здесь. n8n сам отвечает на preflight OPTIONS,
                # когда список задан, — отдельный узел для этого не нужен.
                "options": {"allowedOrigins": ALLOWED_ORIGINS},
            },
            -220,
            300,
            {"webhookId": "REPLACE_ON_IMPORT"},
        ),
        node(
            "Normalize Web Request",
            "n8n-nodes-base.code",
            2,
            {"jsCode": codes["Normalize Web Request"]},
            0,
            300,
        ),
        if_node("Valid Request?", "={{ $json.valid }}", BOOL_TRUE, "", 220, 300),
        node(
            "Rate Limit",
            "n8n-nodes-base.redis",
            1,
            {
                "operation": "incr",
                "key": "=rl:{{ $json.session_id }}",
                "expire": True,
                "ttl": 600,
            },
            440,
            200,
            {
                "credentials": {"redis": {"id": "REPLACE_ON_IMPORT", "name": "Redis"}},
                # Redis лежит — посетитель всё равно должен получить ответ.
                # Ветка продолжается, а Check Rate Limit пометит деградацию.
                "onError": "continueRegularOutput",
            },
        ),
        node(
            "Check Rate Limit",
            "n8n-nodes-base.code",
            2,
            {"jsCode": codes["Check Rate Limit"]},
            660,
            200,
        ),
        if_node("Rate Limited?", "={{ $json.rate_limited }}", BOOL_TRUE, "", 880, 200),
        reply_node("Reply — Rate Limited", "={{ $json.reply }}", 1100, 100),
        node(
            "Lead Agent",
            "@n8n/n8n-nodes-langchain.agent",
            3.1,
            {
                "promptType": "define",
                "text": "={{ $json.text }}",
                "options": {"systemMessage": SYSTEM_PROMPT},
            },
            1100,
            320,
            # Модель недоступна — посетитель всё равно обязан получить ответ.
            # Ветка продолжается, а Reply — Agent подставит телефон менеджера.
            {"onError": "continueRegularOutput"},
        ),
        node(
            "YandexGPT Lite (Yandex AI Studio)",
            "@n8n/n8n-nodes-langchain.lmChatOpenAi",
            1.2,
            {
                "model": {"__rl": True, "mode": "list", "value": MODEL_URI},
                # 0.3, а не 0: нужен живой диалог. Фактов модель всё равно не
                # придумывает — это обеспечено промптом и инструментами, а не
                # температурой.
                "options": {"temperature": 0.3},
            },
            1020,
            520,
            {"credentials": {"openAiApi": {"id": "REPLACE_ON_IMPORT",
                                           "name": "Yandex AI Studio"}}},
        ),
        node(
            "Chat Memory",
            "@n8n/n8n-nodes-langchain.memoryRedisChat",
            1.6,
            {
                "sessionIdType": "customKey",
                # Ключ берём из узла нормализации, а не из $json: подузлы не
                # разделяют контекст элемента с основной веткой, и $json здесь
                # окажется пустым. Без ключа все посетители сайта попадают в
                # один общий разговор — это проверяется тестом на две вкладки.
                "sessionKey": "={{ $('Normalize Web Request').first().json.session_key }}",
                "sessionTTL": 2592000,  # 30 дней, как записано в брифе
                "contextWindowLength": 10,
            },
            1220,
            520,
            {"credentials": {"redis": {"id": "REPLACE_ON_IMPORT", "name": "Redis"}}},
        ),
        node(
            # ИМЯ УЗЛА = ИМЯ ИНСТРУМЕНТА. С версии 1.3 поле toolName убрано, и
            # агент видит инструмент под именем узла. Поэтому имя техническое,
            # а не «База знаний»: его читает модель, а не человек.
            "knowledge_base",
            "@n8n/n8n-nodes-langchain.vectorStoreQdrant",
            1.3,
            {
                "mode": "retrieve-as-tool",
                "toolDescription": (
                    "База знаний компании по остеклению балконов: цены, сроки, "
                    "гарантия, рассрочка, профили, что входит и не входит в "
                    "стоимость, подготовка к монтажу. Вызывай при ЛЮБОМ вопросе "
                    "об условиях или ценах."
                ),
                "qdrantCollection": {
                    "__rl": True,
                    "mode": "list",
                    "value": QDRANT_COLLECTION,
                    "cachedResultName": QDRANT_COLLECTION,
                },
                "topK": 4,
                "includeDocumentMetadata": True,
                "useReranker": False,
                "options": {},
            },
            1420,
            520,
            {"credentials": {"qdrantApi": {"id": "REPLACE_ON_IMPORT", "name": "Qdrant"}}},
        ),
        node(
            "Embeddings — Yandex (query)",
            "@n8n/n8n-nodes-langchain.embeddingsOpenAi",
            1.2,
            {
                # С версии 1.2 поле Base URL у этого узла СКРЫТО: адрес берётся
                # из креденшела. У «Yandex AI Studio» он уже прописан с Build 1.
                "model": EMBEDDING_QUERY_URI,
                "options": {},
            },
            1620,
            700,
            {"credentials": {"openAiApi": {"id": "REPLACE_ON_IMPORT",
                                           "name": "Yandex AI Studio"}}},
        ),
        node(
            # Имя узла = имя инструмента для модели.
            "calc_estimate",
            "@n8n/n8n-nodes-langchain.toolWorkflow",
            2.2,
            {
                "description": (
                    "Считает стоимость остекления балкона и возвращает вилку цен с "
                    "расшифровкой. Вызывай, как только известны конфигурация балкона "
                    "и тип остекления. Значения передавай словами человека, как он их "
                    "назвал."
                ),
                "workflowId": {
                    "__rl": True,
                    "value": ESTIMATE_WORKFLOW_ID,
                    "mode": "list",
                    "cachedResultName": ESTIMATE_WORKFLOW_NAME,
                },
                "workflowInputs": {
                    "mappingMode": "defineBelow",
                    "value": {
                        # session_id — из конверта, а не от модели: по нему
                        # подworkflow ставит метку расчёта, и подмена ключа
                        # открыла бы форму чужой сессии.
                        "session_id": "={{ $('Normalize Web Request').first().json.session_id }}",
                    },
                    "matchingColumns": [],
                    "schema": [],
                    "attemptToConvertTypes": False,
                    "convertFieldsToString": True,
                },
            },
            1380,
            520,
        ),
        node(
            "Check Quoted",
            "n8n-nodes-base.redis",
            1,
            {
                "operation": "get",
                "propertyName": "quoted",
                "key": "=quoted:{{ $('Normalize Web Request').first().json.session_id }}",
                "keyType": "automatic",
                "options": {},
            },
            1340,
            320,
            {
                "credentials": {"redis": {"id": "REPLACE_ON_IMPORT", "name": "Redis"}},
                # Redis лёг — ответ агента всё равно доедет до человека,
                # просто без формы контактов.
                "onError": "continueRegularOutput",
            },
        ),
        node("Decide Form", "n8n-nodes-base.code", 2,
             {"jsCode": codes["Decide Form"]}, 1560, 320),
        reply_node(
            "Reply — Invalid",
            "=Не получилось обработать запрос: {{ $json.invalid_reason }}",
            440,
            420,
        ),
        node(
            "Respond",
            "n8n-nodes-base.respondToWebhook",
            1.1,
            {
                "respondWith": "json",
                "responseBody": "={{ JSON.stringify({ session_id: $json.session_id, "
                "reply: $json.reply, form: $json.form || '' }) }}",
                "options": {},
            },
            1780,
            300,
        ),
    ]

    connections = {
        "Widget Webhook": {"main": [[{"node": "Normalize Web Request", "type": "main", "index": 0}]]},
        "Normalize Web Request": {"main": [[{"node": "Valid Request?", "type": "main", "index": 0}]]},
        "Valid Request?": {
            "main": [
                [{"node": "Rate Limit", "type": "main", "index": 0}],
                [{"node": "Reply — Invalid", "type": "main", "index": 0}],
            ]
        },
        "Rate Limit": {"main": [[{"node": "Check Rate Limit", "type": "main", "index": 0}]]},
        "Check Rate Limit": {"main": [[{"node": "Rate Limited?", "type": "main", "index": 0}]]},
        "Rate Limited?": {
            "main": [
                [{"node": "Reply — Rate Limited", "type": "main", "index": 0}],
                [{"node": "Lead Agent", "type": "main", "index": 0}],
            ]
        },
        "Lead Agent": {"main": [[{"node": "Check Quoted", "type": "main", "index": 0}]]},
        "Check Quoted": {"main": [[{"node": "Decide Form", "type": "main", "index": 0}]]},
        "Decide Form": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
        "calc_estimate": {
            "ai_tool": [[{"node": "Lead Agent", "type": "ai_tool", "index": 0}]]
        },
        # Подузлы подключаются К агенту, а не от него: связь идёт от модели и
        # памяти в сторону Lead Agent.
        "YandexGPT Lite (Yandex AI Studio)": {
            "ai_languageModel": [
                [{"node": "Lead Agent", "type": "ai_languageModel", "index": 0}]
            ]
        },
        "Chat Memory": {
            "ai_memory": [[{"node": "Lead Agent", "type": "ai_memory", "index": 0}]]
        },
        "knowledge_base": {
            "ai_tool": [[{"node": "Lead Agent", "type": "ai_tool", "index": 0}]]
        },
        "Embeddings — Yandex (query)": {
            "ai_embedding": [
                [{"node": "knowledge_base", "type": "ai_embedding", "index": 0}]
            ]
        },
        "Reply — Rate Limited": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
        "Reply — Invalid": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
    }

    # Каждая связь обязана указывать на существующий узел. В n8n опечатка в
    # имени не ошибка импорта — узел просто молча остаётся неподключённым.
    names = {n["name"] for n in nodes}
    for src, spec in connections.items():
        assert src in names, f"нет узла-источника: {src}"
        for kind, branches in spec.items():
            for branch in branches:
                for link in branch:
                    assert link["node"] in names, f"связь в никуда: {src} -[{kind}]-> {link['node']}"

    # У агента обязаны быть и модель, и память. Без модели он не запустится
    # вовсе; без памяти запустится молча и потеряет контекст на второй реплике —
    # и это заметит уже клиент, а не мы.
    incoming = {
        kind
        for spec in connections.values()
        for kind, branches in spec.items()
        for branch in branches
        for link in branch
        if link["node"] == "Lead Agent"
    }
    for required in ("ai_languageModel", "ai_memory", "ai_tool"):
        assert required in incoming, f"к Lead Agent не подключено: {required}"

    # У хранилища в режиме retrieve-as-tool обязан быть вход эмбеддингов.
    # Без него узел импортируется, но падает при первом же вызове инструмента —
    # то есть ровно тогда, когда посетитель задаст первый вопрос по существу.
    kb_incoming = {
        kind
        for spec in connections.values()
        for kind, branches in spec.items()
        for branch in branches
        for link in branch
        if link["node"] == "knowledge_base"
    }
    assert "ai_embedding" in kb_incoming, "к knowledge_base не подключены эмбеддинги"

    return {
        "name": WORKFLOW_NAME,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "nodes": nodes,
        "connections": connections,
        "pinData": {},
    }, codes


def check_javascript(codes):
    """Проверяет, что каждый Code-узел вообще разбирается как JavaScript.

    Генератор, который печатает JS, обязан убедиться, что напечатал JS. Без
    этой проверки опечатка в склейке доезжает до n8n и всплывает как
    «Invalid or unexpected token» на живом прогоне — так и случилось: экранирование
    перевода строки в Python-строке превратилось в настоящий перенос внутри
    JS-литерала, и сломался узел Compute Estimate.

    Проверка идёт последней: к этому моменту уже видно, что граф собран, и
    падение указывает ровно на узел, а не на весь файл.
    """
    if not shutil_which("node"):
        print("  node не найден — синтаксис JS не проверен", file=sys.stderr)
        return True

    ok = True
    for name, code in codes.items():
        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
            f.write(code)
            tmp = f.name
        res = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
        pathlib.Path(tmp).unlink(missing_ok=True)
        if res.returncode != 0:
            ok = False
            print(f"  СИНТАКСИС СЛОМАН в узле «{name}»:", file=sys.stderr)
            for line in res.stderr.strip().splitlines()[:6]:
                print(f"    {line}", file=sys.stderr)
    return ok


def shutil_which(cmd):
    import shutil
    return shutil.which(cmd)


def write_paste_copies(codes):
    """Копии для вставки в живой узел без переимпорта.

    Переимпорт стирает выбранные в интерфейсе креденшелы. Когда меняется только
    код, дешевле открыть файл, выделить всё и вставить поверх редактора узла.
    """
    NODE_CODE_DIR.mkdir(parents=True, exist_ok=True)
    for name, code in codes.items():
        slug = name.lower().replace(" ", "-")
        (NODE_CODE_DIR / f"{slug}.node.js").write_text(code, encoding="utf-8")


def build_estimate():
    """Подworkflow расчёта. Вызывается агентом как инструмент.

    Порядок ветвлений здесь — это порядок, в котором отказ дешевле:
    сначала «не хватает данных» (бесплатно), потом «адрес непонятен» (один
    запрос в DaData), и только потом расчёт. Обратный порядок платил бы за
    проверку адреса в случаях, когда считать всё равно нечего.
    """
    codes = {n: build_code(src, glue) for n, (src, glue) in ESTIMATE_CODE_NODES.items()}

    nodes = [
        node(
            "When Executed by Another Workflow",
            "n8n-nodes-base.executeWorkflowTrigger",
            1.2,
            # Поля объявлены — иначе инструмент не показывает модели, что
            # вообще можно передать, и она вызывает расчёт пустым.
            #
            # ВСЕ поля строковые, включая этаж. Человек говорит «последний», и
            # число здесь только выбросило бы это слово. Разбор всё равно делает
            # наш код: схема сообщает модели, что слать, а не заменяет проверку.
            {
                "inputSource": "workflowInputs",
                "workflowInputs": {
                    "values": [
                        {"name": "session_id", "type": "string"},
                        {"name": "configuration", "type": "string"},
                        {"name": "glazing", "type": "string"},
                        {"name": "profile_tier", "type": "string"},
                        {"name": "floor", "type": "string"},
                        {"name": "extension", "type": "string"},
                        {"name": "address", "type": "string"},
                    ]
                },
            },
            -240,
            300,
        ),
        node("Parse Estimate Args", "n8n-nodes-base.code", 2,
             {"jsCode": codes["Parse Estimate Args"]}, -20, 300),
        if_node("Args Complete?", "={{ $json.args_ok }}", BOOL_TRUE, "", 200, 300),
        node(
            "Result — Need Details",
            "n8n-nodes-base.set",
            3.4,
            {
                "mode": "manual",
                "includeOtherFields": True,
                "assignments": {"assignments": [
                    {"id": "ok", "name": "ok", "type": "boolean", "value": False},
                    {"id": "reply", "name": "reply", "type": "string",
                     "value": "=Для расчёта не хватает: {{ $json.missing_text }}. "
                              "Спроси это у человека и вызови расчёт ещё раз."},
                ]},
                "options": {},
            },
            420,
            460,
        ),
        if_node("Address Given?", "={{ $json.has_address }}", BOOL_TRUE, "", 420, 180),
        node(
            "DaData — Clean Address",
            "n8n-nodes-base.httpRequest",
            4.2,
            {
                "method": "POST",
                "url": "https://cleaner.dadata.ru/api/v1/clean/address",
                "authentication": "genericCredentialType",
                # Custom Auth, а не Header Auth: методу clean нужны ДВА
                # заголовка — Authorization и X-Secret. Header Auth умеет один,
                # и второй пришлось бы вписать в workflow, то есть в git.
                "genericAuthType": "httpCustomAuth",
                "sendBody": True,
                "specifyBody": "json",
                # DaData принимает массив адресов даже для одного адреса.
                "jsonBody": "={{ JSON.stringify([$json.address]) }}",
                "options": {},
            },
            640,
            120,
            {
                "credentials": {"httpCustomAuth": {"id": "REPLACE_ON_IMPORT",
                                                   "name": "DaData"}},
                # DaData лежит — считаем всё равно. Адрес на цену не влияет,
                # а потерять лид из-за стороннего сервиса — худший исход.
                "onError": "continueRegularOutput",
            },
        ),
        node("Check Address", "n8n-nodes-base.code", 2,
             {"jsCode": codes["Check Address"]}, 860, 120),
        if_node("Address Usable?", "={{ $json.address_ok }}", BOOL_TRUE, "", 1080, 120),
        node(
            "Result — Clarify Address",
            "n8n-nodes-base.set",
            3.4,
            {
                "mode": "manual",
                "includeOtherFields": True,
                "assignments": {"assignments": [
                    {"id": "ok", "name": "ok", "type": "boolean", "value": False},
                    {"id": "reply", "name": "reply", "type": "string",
                     "value": "={{ $json.address_ask }}"},
                ]},
                "options": {},
            },
            1300,
            0,
        ),
        node("Compute Estimate", "n8n-nodes-base.code", 2,
             {"jsCode": codes["Compute Estimate"]}, 1300, 300),
        node(
            "Mark Quoted",
            "n8n-nodes-base.redis",
            1,
            {
                "operation": "set",
                "key": "=quoted:{{ $json.session_id }}",
                "value": "1",
                "keyType": "string",
                "expire": True,
                "ttl": QUOTED_TTL,
            },
            1520,
            300,
            {
                "credentials": {"redis": {"id": "REPLACE_ON_IMPORT", "name": "Redis"}},
                # Не смогли поставить метку — расчёт всё равно показываем.
                # Человек получит цену, просто форму контактов предложит агент
                # словами, а не виджет полями.
                "onError": "continueRegularOutput",
            },
        ),
        node(
            "Result — Estimate",
            "n8n-nodes-base.set",
            3.4,
            {
                "mode": "manual",
                "includeOtherFields": False,
                "assignments": {"assignments": [
                    {"id": "ok", "name": "ok", "type": "boolean", "value": True},
                    {"id": "reply", "name": "reply", "type": "string",
                     "value": "={{ $('Compute Estimate').first().json.reply }}"},
                    {"id": "price_low", "name": "price_low", "type": "number",
                     "value": "={{ $('Compute Estimate').first().json.price_low }}"},
                    {"id": "price_high", "name": "price_high", "type": "number",
                     "value": "={{ $('Compute Estimate').first().json.price_high }}"},
                    {"id": "address", "name": "address", "type": "string",
                     "value": "={{ $('Compute Estimate').first().json.address_clean?.result || '' }}"},
                ]},
                "options": {},
            },
            1740,
            300,
        ),
    ]

    connections = {
        "When Executed by Another Workflow": {
            "main": [[{"node": "Parse Estimate Args", "type": "main", "index": 0}]]},
        "Parse Estimate Args": {
            "main": [[{"node": "Args Complete?", "type": "main", "index": 0}]]},
        "Args Complete?": {"main": [
            [{"node": "Address Given?", "type": "main", "index": 0}],
            [{"node": "Result — Need Details", "type": "main", "index": 0}],
        ]},
        "Address Given?": {"main": [
            [{"node": "DaData — Clean Address", "type": "main", "index": 0}],
            [{"node": "Compute Estimate", "type": "main", "index": 0}],
        ]},
        "DaData — Clean Address": {
            "main": [[{"node": "Check Address", "type": "main", "index": 0}]]},
        "Check Address": {
            "main": [[{"node": "Address Usable?", "type": "main", "index": 0}]]},
        "Address Usable?": {"main": [
            [{"node": "Compute Estimate", "type": "main", "index": 0}],
            [{"node": "Result — Clarify Address", "type": "main", "index": 0}],
        ]},
        "Compute Estimate": {"main": [[{"node": "Mark Quoted", "type": "main", "index": 0}]]},
        "Mark Quoted": {"main": [[{"node": "Result — Estimate", "type": "main", "index": 0}]]},
    }

    names = {n["name"] for n in nodes}
    for src, spec in connections.items():
        assert src in names, f"нет узла-источника: {src}"
        for kind, branches in spec.items():
            for branch in branches:
                for link in branch:
                    assert link["node"] in names, f"связь в никуда: {src} -> {link['node']}"

    # Каждая ветка обязана чем-то закончиться: инструмент, вернувший пустоту,
    # заставляет агента выдумывать ответ вместо отказа.
    terminal = {"Result — Need Details", "Result — Clarify Address", "Result — Estimate"}
    assert terminal <= names
    for t in terminal:
        assert t not in connections, f"терминальный узел {t} куда-то ведёт"

    return {
        "name": ESTIMATE_WORKFLOW_NAME,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "nodes": nodes,
        "connections": connections,
        "pinData": {},
    }, codes


def main() -> int:
    check_only = "--check" in sys.argv

    wf, codes = build()
    est, est_codes = build_estimate()
    all_codes = {**codes, **est_codes}

    targets = [
        (OUT, json.dumps(wf, indent=2, ensure_ascii=False) + "\n"),
        (OUT_ESTIMATE, json.dumps(est, indent=2, ensure_ascii=False) + "\n"),
    ]

    if check_only and not check_javascript(all_codes):
        return 1

    if check_only:
        for path, rendered in targets:
            if not path.exists():
                print(f"{path.name} не собран", file=sys.stderr)
                return 1
            if path.read_text(encoding="utf-8") != rendered:
                print(f"{path.name} разошёлся с источниками.", file=sys.stderr)
                print("Запустите: python3 builds/02-lead-widget/make-workflow.py", file=sys.stderr)
                return 1
        print("workflow.json и estimate.workflow.json в актуальном состоянии")
        return 0

    if not check_javascript(all_codes):
        print("\nСборка остановлена: JS не разбирается.", file=sys.stderr)
        return 1

    for path, rendered in targets:
        path.write_text(rendered, encoding="utf-8")
    write_paste_copies(all_codes)
    print(f"собрано {len(wf['nodes'])} узлов -> {OUT.name}")
    print(f"собрано {len(est['nodes'])} узлов -> {OUT_ESTIMATE.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
