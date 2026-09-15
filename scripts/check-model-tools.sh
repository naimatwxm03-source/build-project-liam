#!/usr/bin/env bash
# Проверка: умеет ли модель вызывать функции.
#
# ЗАПУСКАТЬ ДО ТОГО, как собран хоть один узел AI Agent.
#
# Модель, которая не умеет вызывать инструменты, не падает с ошибкой — она
# складно ПЕРЕСКАЗЫВАЕТ вызов: «сейчас посчитаю…». Это выглядит как проблема
# промпта и втягивает в правки промпта, которые не могут сработать в принципе.
# На Build 2 это стоило трёх итераций. Один curl отвечает на вопрос за минуту.
#
# Использование (на VPS):  bash check-model-tools.sh
set -u

FOLDER="${YC_FOLDER:-b1gg2h3lj0e41o47fkoo}"
BASE="${YC_BASE:-https://llm.api.cloud.yandex.net/v1}"

# Ключ читается интерактивно: не попадает ни в историю оболочки, ни на экран.
if [ -z "${YC_KEY:-}" ]; then
  read -rs -p "Yandex AI Studio API key: " YC_KEY; echo
fi

# Кандидаты. Порядок = предпочтение. yandexgpt-lite в списке намеренно:
# он должен ПРОВАЛИТЬ проверку, и это доказывает, что проверка работает.
MODELS="${*:-yandexgpt-5.1/latest yandexgpt-5-pro/latest yandexgpt/rc yandexgpt-lite/latest}"

TOOLS='[{"type":"function","function":{"name":"calc_estimate",
  "description":"Считает стоимость остекления балкона по конфигурации и типу остекления",
  "parameters":{"type":"object","properties":{
    "configuration":{"type":"string","description":"прямой 3 м, П-образный или лоджия"},
    "glazing":{"type":"string","description":"тёплое или холодное"}},
  "required":["configuration","glazing"]}}}]'

PASSED=""
for M in $MODELS; do
  URI="gpt://$FOLDER/$M"
  BODY=$(printf '{"model":"%s","messages":[{"role":"user","content":"Посчитай стоимость остекления лоджии 6 метров, тёплое."}],"tools":%s}' "$URI" "$TOOLS")

  RESP=$(curl -s -m 60 "$BASE/chat/completions" \
    -H "Authorization: Api-Key $YC_KEY" \
    -H 'Content-Type: application/json' \
    -d "$BODY")

  if printf '%s' "$RESP" | grep -q '"tool_calls"'; then
    echo "УМЕЕТ ВЫЗЫВАТЬ ФУНКЦИИ   $URI"
    PASSED="${PASSED:-$URI}"
  elif printf '%s' "$RESP" | grep -q '"error"'; then
    echo "ОШИБКА                   $URI"
    printf '%s\n' "$RESP" | head -c 300 | sed 's/^/                           /'
    echo
  else
    echo "НЕ УМЕЕТ (вернул текст)  $URI"
  fi
done

echo
if [ -n "$PASSED" ]; then
  echo "Ставь в MODEL_URI:  $PASSED"
else
  echo "Ни одна модель не вернула tool_calls."
  echo "НЕ правь промпт. Архитектура на инструментах здесь не работает —"
  echo "нужен детерминированный вызов расчёта из Code-узла."
fi
