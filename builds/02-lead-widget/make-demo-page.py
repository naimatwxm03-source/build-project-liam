#!/usr/bin/env python3
"""Собирает боевую страницу демо из демонстрационной.

`demo.html` в репозитории работает БЕЗ СЕРВЕРА: диалог ведёт сценарий по
ключевым словам из `demo-engine.js`. Это нужно, чтобы ссылка в портфолио
работала, даже когда VPS лежит.

Боевая страница — та же вёрстка, но разговор ведёт живой агент. Отличий ровно
три, и они генерируются, а не правятся руками: иначе две страницы разъедутся
через месяц и на боевой останется демонстрационный движок.

    python3 make-demo-page.py            # собрать в dist/
    python3 make-demo-page.py --check    # убедиться, что dist/ не отстал
"""

import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
DIST = HERE / "dist"

ENDPOINT = "https://n8n.n-enterprise.ru/webhook/chat"

# Скрипты демонстрационного режима. На боевой странице их не должно быть:
# pricing.js там — это вторая, расходящаяся копия матрицы цен в браузере.
DEMO_SCRIPTS = re.compile(
    r'\s*<script src="(?:pricing\.js|demo-engine\.js)"></script>')

OLD_FOOTER = re.compile(
    r'<p><b>Чем демо отличается от боевой версии\.</b>.*?</p>', re.S)

NEW_FOOTER = (
    '<p><b>Это рабочая версия.</b> Фразу целиком понимает AI-агент в n8n на '
    'Yandex AI Studio: отвечает из базы знаний в Qdrant, вызывает расчёт '
    'отдельным workflow и сохраняет заявку. Форма контактов появляется только '
    'после того, как показана цена, — это решает сервер, а не страница.</p>'
)


def build() -> str:
    html = (HERE / "demo.html").read_text(encoding="utf-8")

    html = DEMO_SCRIPTS.sub("", html)

    # Виджет едет с корня сайта: /assets/ в этом Nginx отдаётся с
    # Cache-Control на 30 дней, и правка виджета не доехала бы до посетителей,
    # которые уже открывали страницу.
    html = html.replace(
        '<script src="widget/widget.js"\n',
        '<script src="/nxai-widget.js"\n        data-endpoint="%s"\n' % ENDPOINT,
    )

    if OLD_FOOTER.search(html) is None:
        raise SystemExit("не найден абзац про демо-режим — вёрстка разошлась")
    html = OLD_FOOTER.sub(NEW_FOOTER, html)

    # Проверки: собранная страница не должна нести демонстрационный движок.
    for bad in ("demo-engine.js", 'src="pricing.js"', "widget/widget.js"):
        if bad in html:
            raise SystemExit("в боевой странице остался %s" % bad)
    if ENDPOINT not in html:
        raise SystemExit("в боевой странице нет data-endpoint")

    return html


def main() -> int:
    html = build()
    widget = (HERE / "widget" / "widget.js").read_text(encoding="utf-8")

    check = "--check" in sys.argv
    files = {"demo.html": html, "nxai-widget.js": widget}

    if check:
        for name, want in files.items():
            path = DIST / name
            if not path.exists() or path.read_text(encoding="utf-8") != want:
                print("dist/%s отстал — запусти make-demo-page.py" % name)
                return 1
        print("dist/ в актуальном состоянии")
        return 0

    DIST.mkdir(exist_ok=True)
    for name, text in files.items():
        (DIST / name).write_text(text, encoding="utf-8")
        print("собрано dist/%s" % name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
