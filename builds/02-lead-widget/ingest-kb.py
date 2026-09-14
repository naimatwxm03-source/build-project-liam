#!/usr/bin/env python3
"""Загружает kb/faq.md в Qdrant: режет на куски, считает эмбеддинги, пишет точки.

Запускается на VPS, зависимостей нет — только стандартная библиотека. `pip
install` на боевой машине ради разовой загрузки базы знаний не нужен.

    export YANDEX_API_KEY=...            # не печатать в терминал
    export YANDEX_FOLDER_ID=b1gg2h3lj0e41o47fkoo
    python3 ingest-kb.py --dry-run       # посмотреть куски, ничего не вызывая
    python3 ingest-kb.py --probe         # проверить, что эмбеддинги вообще едут
    python3 ingest-kb.py                 # загрузить

ПОЧЕМУ РЕЖЕМ ПО ЗАГОЛОВКАМ, А НЕ ПО СИМВОЛАМ
Нарезка по 500 символов рвёт ответ про гарантию пополам, retrieval возвращает
половину, и модель договаривает вторую сама. Один раздел — один законченный
ответ; если раздел не отвечает на свой вопрос целиком, это дефект документа,
а не настроек чанкинга.

ПОЧЕМУ РАЗМЕРНОСТЬ ВЕКТОРА НЕ ЗАХАРДКОЖЕНА
Её берём из первого же ответа API. Написать число из головы — значит однажды
создать коллекцию не того размера и получить ошибку на 40-й точке, уже потратив
деньги на 39 эмбеддингов.
"""

import argparse
import json
import os
import re
import pathlib
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
KB_FILE = HERE / "kb" / "faq.md"

COLLECTION = os.environ.get("QDRANT_COLLECTION", "kb_demo_balkon")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333").rstrip("/")
YANDEX_BASE = "https://llm.api.cloud.yandex.net"

# text-search-doc для документов, text-search-query для запросов. Это не
# взаимозаменяемо: индексировать документы моделью для запросов — тихая потеря
# качества поиска, которую потом принимают за «RAG не работает».
DOC_MODEL = "text-search-doc"

# Яндекс отдаёт 10 запросов эмбеддингов в секунду и отвечает 429 на одиннадцатый.
# Первый прогон упал ровно на 11-м куске. Держим 4 запроса в секунду: разница
# между 3 и 14 секундами на разовой загрузке несущественна, а запас от квоты
# избавляет от гонки, когда кто-то ещё работает с тем же аккаунтом.
MIN_INTERVAL = 0.25
_last_call = [0.0]


def pace():
    wait = MIN_INTERVAL - (time.monotonic() - _last_call[0])
    if wait > 0:
        time.sleep(wait)
    _last_call[0] = time.monotonic()


def die(msg: str) -> "NoReturn":
    print(f"ОШИБКА: {msg}", file=sys.stderr)
    raise SystemExit(1)


# --- нарезка ------------------------------------------------------------------

def chunks(markdown: str):
    """Каждый раздел `## ...` — отдельный кусок. Преамбула до первого `##` —
    служебная (пометка «это демо») и в базу знаний не идёт: она нужна человеку,
    читающему файл, а не модели, отвечающей клиенту."""
    parts = re.split(r"(?m)^##\s+(.+?)\s*$", markdown)
    out = []
    for i in range(1, len(parts), 2):
        title = parts[i].strip()
        body = parts[i + 1].strip()
        if not body:
            continue
        # Заголовок оставляем внутри текста: он и есть вопрос клиента, и он
        # сильно помогает попаданию при поиске.
        out.append({"title": title, "text": f"{title}\n\n{body}"})
    return out


# --- HTTP ---------------------------------------------------------------------

def post_json(url: str, payload: dict, headers: dict, timeout: int = 60, retries: int = 5) -> dict:
    """POST с повтором на 429.

    Ограничение по скорости — не ошибка, а нормальный ответ сервиса, который
    просит подождать. Падать на нём, потеряв уже оплаченные эмбеддинги, глупо.
    """
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        for k, v in headers.items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:600]
            if e.code == 429 and attempt < retries:
                delay = 2 ** attempt
                print(f"    лимит скорости, пауза {delay} c…")
                time.sleep(delay)
                continue
            die(f"{url} вернул {e.code}\n{detail}")
        except urllib.error.URLError as e:
            if attempt < retries:
                delay = 2 ** attempt
                print(f"    сеть подвела ({e.reason}), пауза {delay} c…")
                time.sleep(delay)
                continue
            die(f"{url} недоступен: {e.reason}")


def put_json(url: str, payload: dict, timeout: int = 60) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="PUT")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:600]
        die(f"{url} вернул {e.code}\n{detail}")
    except urllib.error.URLError as e:
        die(f"Qdrant недоступен по {url}: {e.reason}")


# --- эмбеддинги ---------------------------------------------------------------

def embed(text: str, api_key: str, folder: str, native: bool):
    """Возвращает вектор.

    Сначала пробуем OpenAI-совместимый путь — тогда в n8n подойдёт штатный узел
    Embeddings OpenAI и городить HTTP-узел не придётся. Если он не работает,
    --native уходит на родной эндпоинт Яндекса, и тогда в n8n инструмент базы
    знаний собирается на HTTP Request. Оба варианта дают один и тот же вектор,
    разница только в количестве узлов.
    """
    headers = {"Authorization": f"Api-Key {api_key}"}
    pace()

    if native:
        res = post_json(
            f"{YANDEX_BASE}/foundationModels/v1/textEmbedding",
            {"modelUri": f"emb://{folder}/{DOC_MODEL}/latest", "text": text},
            headers,
        )
        vec = res.get("embedding")
        if not vec:
            die(f"в ответе нет поля embedding: {json.dumps(res, ensure_ascii=False)[:400]}")
        return [float(x) for x in vec]

    res = post_json(
        f"{YANDEX_BASE}/v1/embeddings",
        {"model": f"emb://{folder}/{DOC_MODEL}/latest", "input": text},
        headers,
    )
    try:
        return [float(x) for x in res["data"][0]["embedding"]]
    except (KeyError, IndexError, TypeError):
        die(
            "OpenAI-совместимый ответ разобрать не удалось. Попробуйте --native.\n"
            + json.dumps(res, ensure_ascii=False)[:400]
        )


# --- Qdrant -------------------------------------------------------------------

def recreate_collection(size: int):
    """Пересоздаёт коллекцию. Именно пересоздаёт: при повторной загрузке
    изменённого файла старые куски обязаны исчезнуть, иначе бот будет цитировать
    условия, которые заказчик уже отменил. Это худший вид ошибки — правдоподобная
    и невидимая."""
    url = f"{QDRANT_URL}/collections/{COLLECTION}"
    try:
        req = urllib.request.Request(url, method="DELETE")
        urllib.request.urlopen(req, timeout=30).read()
    except urllib.error.HTTPError:
        pass  # не было — и хорошо
    except urllib.error.URLError as e:
        die(f"Qdrant недоступен по {QDRANT_URL}: {e.reason}")

    put_json(url, {"vectors": {"size": size, "distance": "Cosine"}})
    print(f"коллекция {COLLECTION} создана, размерность {size}")


def upsert(points):
    put_json(f"{QDRANT_URL}/collections/{COLLECTION}/points?wait=true", {"points": points})


# --- main ---------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="показать куски и выйти, не вызывая ни Яндекс, ни Qdrant")
    ap.add_argument("--probe", action="store_true",
                    help="посчитать один эмбеддинг и показать размерность")
    ap.add_argument("--native", action="store_true",
                    help="родной эндпоинт Яндекса вместо OpenAI-совместимого")
    args = ap.parse_args()

    if not KB_FILE.exists():
        die(f"нет файла {KB_FILE}")

    pieces = chunks(KB_FILE.read_text(encoding="utf-8"))
    if not pieces:
        die("в файле не нашлось ни одного раздела `## `")

    if args.dry_run:
        print(f"{len(pieces)} кусков из {KB_FILE.name}:\n")
        for i, c in enumerate(pieces, 1):
            print(f"--- {i}. {c['title']}  ({len(c['text'])} симв.)")
            print(c["text"])
            print()
        print("Прочитайте их глазами. Кусок, который не отвечает на свой вопрос")
        print("целиком, вернётся из поиска в одиночку — и модель договорит сама.")
        return 0

    api_key = os.environ.get("YANDEX_API_KEY", "").strip()
    folder = os.environ.get("YANDEX_FOLDER_ID", "").strip()
    if not api_key:
        die("не задан YANDEX_API_KEY")
    if not folder:
        die("не задан YANDEX_FOLDER_ID")

    if args.probe:
        vec = embed(pieces[0]["text"], api_key, folder, args.native)
        path = "родной эндпоинт" if args.native else "OpenAI-совместимый"
        print(f"{path}: работает, размерность {len(vec)}")
        print(f"первые 5 значений: {[round(x, 4) for x in vec[:5]]}")
        return 0

    print(f"считаю эмбеддинги для {len(pieces)} кусков…")
    vectors = []
    for i, c in enumerate(pieces, 1):
        vectors.append(embed(c["text"], api_key, folder, args.native))
        print(f"  {i}/{len(pieces)}  {c['title']}")

    sizes = {len(v) for v in vectors}
    if len(sizes) != 1:
        die(f"API вернул векторы разной длины: {sorted(sizes)}")
    recreate_collection(sizes.pop())

    upsert([
        {
            "id": i,
            "vector": vectors[i],
            "payload": {
                "title": pieces[i]["title"],
                "text": pieces[i]["text"],
                "source": "kb/faq.md",
            },
        }
        for i in range(len(pieces))
    ])
    print(f"загружено {len(pieces)} точек в {COLLECTION}")
    print("\nПроверьте поиск до того, как подключать это к агенту:")
    print(f"  curl -s {QDRANT_URL}/collections/{COLLECTION} | python3 -m json.tool")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
