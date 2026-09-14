#!/usr/bin/env python3
"""Собирает builds/02-lead-widget/workflow.json.

Граф растёт с B1 до B11, и править тридцатиузловой JSON руками — верный способ
разорвать ссылку `$('Имя узла')` и не заметить этого до продакшена. Генератор
держит имена узлов в одном месте: переименование ломает сборку здесь, а не в
рантайме у клиента.

Версии узлов (typeVersion) взяты из рабочего builds/01-receipt-bot/workflow.json,
который импортируется в этот n8n без ошибок. Не угадывать: неверная версия
импортируется молча, а падает уже при запуске.

    python3 builds/02-lead-widget/make-workflow.py
    python3 builds/02-lead-widget/make-workflow.py --check
"""

import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "workflow.json"
NODE_CODE_DIR = HERE / "node-code"

WORKFLOW_NAME = "02 Lead Widget — Chat"

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

# Системный промпт. Растёт по мере появления инструментов: на шаге B2 расчёта
# ещё нет, поэтому промпт ПРЯМО ЗАПРЕЩАЕТ называть цифры. Промпт, обещающий
# калькулятор, которого нет, — это инструкция галлюцинировать.
SYSTEM_PROMPT = """Ты — консультант компании по остеклению балконов в Самаре. Общаешься в чате на сайте.

ГЛАВНОЕ ПРАВИЛО: не выдумывай ничего. Цены, сроки, гарантии, условия рассрочки, \
состав работ — если этого нет в том, что тебе дали, скажи честно, что уточнишь, \
и предложи связать с менеджером. Выдуманная цифра всплывёт при первом звонке \
конкуренту и будет стоить компании сделки.

СЕЙЧАС У ТЕБЯ НЕТ ИНСТРУМЕНТА РАСЧЁТА И НЕТ БАЗЫ ЗНАНИЙ. Поэтому конкретных цен, \
сроков и условий ты не называешь вообще. Ни одной цифры. Вместо этого выясняй \
параметры объекта и говори, что расчёт покажешь следом.

Что нужно выяснить для расчёта, по одному вопросу за раз, а не анкетой:
1. конфигурация балкона: прямой примерно 3 метра, П-образный или лоджия 6 метров
2. тип остекления: тёплое или холодное
3. этаж (на последнем нужна крыша)
4. нужен ли вынос

Объясняй разницу простыми словами, если спрашивают. Тёплое — чтобы пользоваться \
балконом зимой как комнатой. Холодное — закрыть от пыли, дождя и ветра.

Телефон не спрашивай. Его спросит система после того, как покажет расчёт: \
просить контакт раньше, чем дал человеку пользу, — верный способ его потерять.

Тон: коротко, по-человечески, без канцелярита. Два-три предложения на реплику. \
Ты не робот-анкета."""

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


NORMALIZE_GLUE = """

// ---------------------------------------------------------------------------
// Склейка с n8n. Всё выше внедряется из normalize-web.js генератором
// make-workflow.py. Не править здесь — править источник и перегенерировать.
// ---------------------------------------------------------------------------
return $input.all().map((item) => ({
  json: normalizeWebRequest(item.json.body !== undefined ? item.json.body : item.json),
}));
"""

RATE_LIMIT_GLUE = """

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

CODE_NODES = {
    "Normalize Web Request": ("normalize-web.js", NORMALIZE_GLUE),
    "Check Rate Limit": ("rate-limit.js", RATE_LIMIT_GLUE),
}


def build_code(source: str, glue: str) -> str:
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
    """Set-узел, который кладёт готовый ответ виджету в поле reply."""
    fields = [
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
        reply_node(
            "Reply — Agent",
            "={{ $json.output || " + json.dumps(HANDOVER_REPLY, ensure_ascii=False) + " }}",
            1340,
            320,
        ),
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
            1560,
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
        "Lead Agent": {"main": [[{"node": "Reply — Agent", "type": "main", "index": 0}]]},
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
        "Reply — Agent": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
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
    for required in ("ai_languageModel", "ai_memory"):
        assert required in incoming, f"к Lead Agent не подключено: {required}"

    return {
        "name": WORKFLOW_NAME,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "nodes": nodes,
        "connections": connections,
        "pinData": {},
    }, codes


def write_paste_copies(codes):
    """Копии для вставки в живой узел без переимпорта.

    Переимпорт стирает выбранные в интерфейсе креденшелы. Когда меняется только
    код, дешевле открыть файл, выделить всё и вставить поверх редактора узла.
    """
    NODE_CODE_DIR.mkdir(parents=True, exist_ok=True)
    for name, code in codes.items():
        slug = name.lower().replace(" ", "-")
        (NODE_CODE_DIR / f"{slug}.node.js").write_text(code, encoding="utf-8")


def main() -> int:
    check_only = "--check" in sys.argv
    wf, codes = build()
    rendered = json.dumps(wf, indent=2, ensure_ascii=False) + "\n"

    if check_only:
        if not OUT.exists():
            print("workflow.json не собран", file=sys.stderr)
            return 1
        if OUT.read_text(encoding="utf-8") != rendered:
            print("workflow.json разошёлся с источниками.", file=sys.stderr)
            print("Запустите: python3 builds/02-lead-widget/make-workflow.py", file=sys.stderr)
            return 1
        print("workflow.json в актуальном состоянии")
        return 0

    OUT.write_text(rendered, encoding="utf-8")
    write_paste_copies(codes)
    print(f"собрано {len(wf['nodes'])} узлов -> {OUT.relative_to(HERE.parents[1])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
