#!/usr/bin/env python3
"""Generate the credentials tutorial PDF.

The menu paths in here were walked live on 2026-09-13 rather than taken from
documentation, which is why they include the steps the docs omit — the second
bot switch VK hides until messages are on, the fact that the audio scope does
not exist, and that n8n's Header Auth needs the literal word "Api-Key".

Regenerate:  python3 docs/make-credentials-tutorial-pdf.py
"""

import pathlib

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable, KeepTogether, ListFlowable, ListItem, PageBreak, Paragraph,
    SimpleDocTemplate, Spacer, Table, TableStyle,
)

FONTS = pathlib.Path("/usr/share/fonts/truetype/dejavu")
OUT = pathlib.Path(__file__).resolve().parent / "credentials-tutorial.pdf"

# Cyrillic throughout, so the built-in Type 1 fonts are not an option.
pdfmetrics.registerFont(TTFont("DJ", FONTS / "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DJ-Bold", FONTS / "DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DJ-Mono", FONTS / "DejaVuSansMono.ttf"))
pdfmetrics.registerFontFamily("DJ", normal="DJ", bold="DJ-Bold")

INK = colors.HexColor("#1a1a1a")
MUTED = colors.HexColor("#5b6470")
ACCENT = colors.HexColor("#0b5fff")
WARN_BG = colors.HexColor("#fff4e5")
WARN_EDGE = colors.HexColor("#e08600")
CODE_BG = colors.HexColor("#f4f5f7")
RULE = colors.HexColor("#d8dde3")

ss = getSampleStyleSheet()


def style(name, **kw):
    base = dict(fontName="DJ", textColor=INK, leading=14, fontSize=9.5, alignment=TA_LEFT)
    base.update(kw)
    return ParagraphStyle(name, **base)


S = {
    "title": style("title", fontName="DJ-Bold", fontSize=20, leading=24, spaceAfter=4),
    "sub": style("sub", fontSize=10, textColor=MUTED, leading=14, spaceAfter=14),
    "h1": style("h1", fontName="DJ-Bold", fontSize=14, leading=18, spaceBefore=16, spaceAfter=7,
                textColor=ACCENT),
    "h2": style("h2", fontName="DJ-Bold", fontSize=11, leading=15, spaceBefore=11, spaceAfter=4),
    "body": style("body", spaceAfter=5),
    "small": style("small", fontSize=8.5, textColor=MUTED, leading=12, spaceAfter=4),
    "code": style("code", fontName="DJ-Mono", fontSize=8.5, leading=12,
                  backColor=CODE_BG, borderPadding=6, spaceBefore=3, spaceAfter=6),
    "warn": style("warn", fontSize=9, leading=13),
    "cell": style("cell", fontSize=8.8, leading=12),
    "cellb": style("cellb", fontName="DJ-Bold", fontSize=8.8, leading=12),
}


def P(text, s="body"):
    return Paragraph(text, S[s])


def steps(items):
    return ListFlowable(
        [ListItem(P(t), leftIndent=14, value=i + 1) for i, t in enumerate(items)],
        bulletType="1", bulletFontName="DJ-Bold", bulletFontSize=9.5,
        leftIndent=16, bulletDedent=12, spaceAfter=6,
    )


def bullets(items):
    return ListFlowable(
        [ListItem(P(t), leftIndent=12) for t in items],
        bulletType="bullet", bulletFontName="DJ", bulletFontSize=9.5,
        leftIndent=14, bulletDedent=9, spaceAfter=6,
    )


def warn(title, text):
    """A box for the things that cost an hour when missed."""
    inner = [P(f"<b>{title}</b>", "warn"), P(text, "warn")]
    t = Table([[inner]], colWidths=[165 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WARN_BG),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, WARN_EDGE),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return KeepTogether([Spacer(1, 3), t, Spacer(1, 7)])


def table(rows, widths):
    data = [[P(c, "cellb" if r == 0 else "cell") for c in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), CODE_BG),
        ("GRID", (0, 0), (-1, -1), 0.5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return KeepTogether([Spacer(1, 2), t, Spacer(1, 8)])


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("DJ", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(22 * mm, 12 * mm, "NXAI / N-Enterprise — получение ключей доступа")
    canvas.drawRightString(A4[0] - 22 * mm, 12 * mm, f"стр. {doc.page}")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(22 * mm, 16 * mm, A4[0] - 22 * mm, 16 * mm)
    canvas.restoreState()


story = []
A = story.append

# ---------------------------------------------------------------- title -----
A(P("Ключи доступа: Yandex Cloud и VK", "title"))
A(P("Пошаговая инструкция. Проверено вживую 13.09.2026 на рабочем сервере "
    "n8n.n-enterprise.ru — включая те шаги, которых нет в официальной документации.",
    "sub"))
A(HRFlowable(width="100%", color=RULE, thickness=0.8, spaceAfter=4))

A(P("Что вам понадобится", "h2"))
A(table([
    ["Ключ", "Для чего", "Где хранится"],
    ["Yandex API key", "Распознавание чеков (Vision OCR) и извлечение полей (YandexGPT)",
     "Два credential в n8n"],
    ["VK community token", "Чтение и отправка сообщений от имени сообщества",
     "Один credential в n8n"],
    ["VK confirmation string", "Подтверждение адреса Callback API", "docker-compose.yml"],
    ["Callback secret", "Проверка, что запрос действительно от VK", "docker-compose.yml"],
], [38 * mm, 82 * mm, 45 * mm]))

A(warn("Правило номер один",
       "Ключ показывается <b>один раз</b>. Скопируйте сразу. Не вставляйте его в чат, "
       "в переписку и в файлы репозитория — только в credential n8n или в "
       "docker-compose.yml на сервере."))

# ------------------------------------------------------------- yandex -------
A(P("Часть 1. Yandex Cloud API key", "h1"))
A(P("Один ключ обслуживает и распознавание текста, и языковую модель. Это сделано "
    "намеренно: один аккаунт, один счёт, одна схема авторизации.", "body"))

A(P("Шаг 1. Сервисный аккаунт", "h2"))
A(steps([
    "Откройте <font color='#0b5fff'>console.yandex.cloud</font> и выберите ваш каталог "
    "(папку). Идентификатор каталога начинается с <font name='DJ-Mono'>b1g</font> — "
    "он понадобится позже.",
    "Слева: <b>Identity and Access Management</b> → <b>Сервисные аккаунты</b>.",
    "Если аккаунта ещё нет — <b>Создать сервисный аккаунт</b>. Имя любое, например "
    "<font name='DJ-Mono'>nxai-sa</font>.",
    "Откройте аккаунт и проверьте роли в каталоге. Нужны три: "
    "<font name='DJ-Mono'>ai.languageModels.user</font>, "
    "<font name='DJ-Mono'>ai.vision.user</font>, "
    "<font name='DJ-Mono'>ai.speechkit-stt.user</font>. "
    "Последняя — на будущее, для голосовых сообщений.",
]))

A(warn("Роли и права ключа — разные вещи",
       "Роль даёт права сервисному аккаунту. Scope ограничивает конкретный ключ. "
       "Нужно и то, и другое: роль без scope или scope без роли дадут "
       "<font name='DJ-Mono'>401 Unauthorized</font> без внятного объяснения."))

A(P("Шаг 2. Создание ключа", "h2"))
A(steps([
    "На странице сервисного аккаунта нажмите <b>Create new key</b> → <b>API key</b>.",
    "<b>Description</b>: осмысленное имя, например <font name='DJ-Mono'>nxai-n8n-v3</font>. "
    "Когда ключей станет несколько, вы будете благодарны.",
    "<b>Scope</b>: отметьте <font name='DJ-Mono'>yc.ai.languageModels.execute</font> и "
    "<font name='DJ-Mono'>yc.ai.vision.execute</font>. Список множественного выбора.",
    "<b>Expires at</b>: <b>оставьте пустым</b>.",
    "<b>Create</b> → скопируйте ключ. Он начинается с "
    "<font name='DJ-Mono'>AQVN…</font> и показывается один раз.",
]))

A(warn("Почему без срока действия",
       "Ключ со сроком перестанет работать в произвольный день без предупреждения. "
       "Бот просто начнёт молча отваливаться, и узнает об этом первым клиент. "
       "Ротацию делайте вручную и осознанно."))

A(P("Шаг 3. Куда вставить в n8n", "h2"))
A(P("Один и тот же ключ, но в двух разных credential, потому что сервисы ждут "
    "разные заголовки:", "body"))
A(table([
    ["Credential", "Тип", "Поля"],
    ["Yandex AI Studio", "OpenAI",
     "API Key: <font name='DJ-Mono'>AQVN…</font><br/>"
     "Base URL: <font name='DJ-Mono'>https://llm.api.cloud.yandex.net/v1</font>"],
    ["Yandex Api-Key", "Header Auth",
     "Name: <font name='DJ-Mono'>Authorization</font><br/>"
     "Value: <font name='DJ-Mono'>Api-Key AQVN…</font>"],
], [38 * mm, 26 * mm, 101 * mm]))

A(warn("Api-Key, а не Bearer",
       "В поле Value должно быть буквально слово <font name='DJ-Mono'>Api-Key</font>, "
       "затем <b>один пробел</b>, затем ключ. С <font name='DJ-Mono'>Bearer</font> "
       "Yandex вернёт «Authorization failed» и ничего больше. Лишний пробел или "
       "перенос строки в конце — та же ошибка."))

A(P("Проверка ключа отдельно от n8n", "h2"))
A(P("Если n8n ругается на авторизацию, сначала проверьте сам ключ. Выполните на "
    "сервере, подставив свой ключ и идентификатор каталога:", "body"))
A(P("curl -s -X POST https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze \\<br/>"
    "&nbsp;&nbsp;-H \"Authorization: Api-Key ВАШ_КЛЮЧ\" \\<br/>"
    "&nbsp;&nbsp;-H \"Content-Type: application/json\" \\<br/>"
    "&nbsp;&nbsp;-d '{\"folderId\":\"b1g…\",\"analyze_specs\":"
    "[{\"content\":\"\",\"features\":[{\"type\":\"TEXT_DETECTION\"}]}]}'", "code"))
A(bullets([
    "Ответ <font name='DJ-Mono'>«Image content is not passed»</font> — ключ рабочий. "
    "Проблема в том, как его хранит n8n: удалите credential и создайте заново.",
    "Ответ про аутентификацию или права — проблема в самом ключе. "
    "Проверьте scope и роли.",
]))

A(PageBreak())

# ----------------------------------------------------------------- vk -------
A(P("Часть 2. VK: сообщество и токен", "h1"))
A(P("Нужен только личный аккаунт VK. Ни ИП, ни ООО, ни карта, ни покупка номера.", "body"))

A(P("Шаг 1. Сообщество", "h2"))
A(steps([
    "<font color='#0b5fff'>vk.com/groups?w=groups_create</font> → тип <b>Бизнес</b>.",
    "Название — то, что увидит клиент.",
]))
A(warn("Не «Публичная страница»",
       "У публичной страницы нет полноценных сообщений сообщества. Подходят "
       "«Бизнес» и «Группа по интересам»."))

A(P("Шаг 2. Два переключателя, а не один", "h2"))
A(steps([
    "<b>Управление</b> → <b>Сообщения</b> → <b>Сообщения сообщества</b>: <b>Включены</b>.",
    "Теперь появится вкладка <b>Настройки для бота</b> → "
    "<b>Возможности ботов</b>: <b>Включены</b>.",
    "Полезно: включите кнопку <b>«Начать»</b> — аккуратный первый экран для демонстрации.",
]))
A(warn("Самая частая ошибка",
       "Вкладка «Настройки для бота» <b>появляется только после</b> включения сообщений. "
       "Если её не видно — первый шаг не сохранился. Без второго переключателя бот "
       "не сможет работать с API, хотя сообщения будут приходить."))

A(P("Шаг 3. Токен сообщества", "h2"))
A(steps([
    "<b>Управление</b> → <b>Работа с API</b> → <b>Ключи доступа</b> → <b>Создать ключ</b>.",
    "Отметьте ровно три: <b>Сообщения сообщества</b>, <b>Фотографии</b>, <b>Документы</b>.",
    "Остальное не трогайте: управление сообществом, истории, стена, товары — "
    "это больше прав, чем нужно боту.",
    "Токен начинается с <font name='DJ-Mono'>vk1.a.</font> Вставьте его в n8n в "
    "credential <b>VK Group Token</b> типа <b>Query Auth</b>: "
    "Name = <font name='DJ-Mono'>access_token</font>, Value = токен.",
]))
A(warn("Отдельного доступа к аудио не существует",
       "В диалоге нет пункта «Аудиозаписи». Голосовые сообщения приходят вложением "
       "к сообщению и покрываются доступом «Сообщения сообщества». Искать нечего."))

A(P("Шаг 4. Идентификаторы", "h2"))
A(table([
    ["Значение", "Где взять", "Пример"],
    ["group_id", "Адрес сообщества <font name='DJ-Mono'>vk.com/clubХХХ</font> — "
                 "только цифры, без «club»", "238091644"],
    ["ваш личный id", "Адрес вашего профиля <font name='DJ-Mono'>vk.com/idХХХ</font>. "
                      "Нужен для оповещений о сбоях", "12345678"],
], [32 * mm, 100 * mm, 33 * mm]))

A(P("Шаг 5. Callback API", "h2"))
A(warn("Порядок действий важен",
       "Workflow в n8n должен быть <b>опубликован до</b> нажатия «Подтвердить». "
       "VK проверяет адрес ровно один раз: если n8n не отвечает, адрес помечается "
       "как нерабочий и попытку придётся повторять."))
A(steps([
    "Придумайте секрет на сервере: <font name='DJ-Mono'>openssl rand -hex 24</font>. "
    "Это ваше значение, VK его не выдаёт.",
    "<b>Работа с API</b> → <b>Callback API</b>. Версия API: "
    "<font name='DJ-Mono'>5.199</font>. Адрес: "
    "<font name='DJ-Mono'>https://n8n.n-enterprise.ru/webhook/vk-receipt</font>. "
    "Секретный ключ: то, что сгенерировали. Нажмите <b>Сохранить</b> под секретом.",
    "VK покажет <b>«Строку, которую должен вернуть сервер»</b>. Запишите её в "
    "<font name='DJ-Mono'>VK_CONFIRMATION_STRING</font> в docker-compose.yml и "
    "перезапустите n8n.",
    "<b>Проверьте рукопожатие до нажатия кнопки</b> (команда ниже). "
    "Если строка возвращается — подтверждение не может не сработать.",
    "Нажмите <b>Подтвердить</b>.",
    "Вкладка <b>Типы событий</b> → отметьте <b>Входящее сообщение</b>. "
    "Без этого адрес будет подтверждён, но сообщения не придут.",
]))
A(P("curl -s -X POST https://n8n.n-enterprise.ru/webhook/vk-receipt \\<br/>"
    "&nbsp;&nbsp;-H 'Content-Type: application/json' \\<br/>"
    "&nbsp;&nbsp;-d '{\"type\":\"confirmation\",\"group_id\":238091644}'", "code"))
A(P("Должна вывестись ровно строка подтверждения и ничего больше.", "small"))

A(warn("Проверьте адрес посимвольно",
       "Путь <font name='DJ-Mono'>vk-receipt</font> должен совпадать с тем, что задан "
       "в workflow. Похожая опечатка вроде <font name='DJ-Mono'>vk-bot</font> даёт 404, "
       "а VK сообщает лишь об общей ошибке. Одна попытка так уже была потрачена."))

A(P("Переменные окружения на сервере", "h2"))
A(P("На этом сервере n8n берёт настройки из раздела "
    "<font name='DJ-Mono'>environment:</font> в "
    "<font name='DJ-Mono'>/root/n8n/docker-compose.yml</font>. "
    "Файла <font name='DJ-Mono'>.env</font> здесь нет, и создавать его бесполезно — "
    "compose на него не ссылается.", "body"))
A(P("      - N8N_BLOCK_ENV_ACCESS_IN_NODE=false<br/>"
    "      - VK_CALLBACK_SECRET=…<br/>"
    "      - VK_CONFIRMATION_STRING=…<br/>"
    "      - VK_ADMIN_PEER_ID=…<br/>"
    "      - WEBHOOK_URL=https://n8n.n-enterprise.ru/", "code"))
A(P("cd /root/n8n &amp;&amp; docker-compose down &amp;&amp; docker-compose up -d", "code"))
A(bullets([
    "<font name='DJ-Mono'>N8N_BLOCK_ENV_ACCESS_IN_NODE=false</font> обязательна. "
    "Без неё <font name='DJ-Mono'>$env</font> не читается, ответ на подтверждение "
    "уходит пустым, и VK отклоняет адрес — без единой ошибки в интерфейсе n8n.",
    "<font name='DJ-Mono'>docker-compose</font> через дефис. Версия 1.29.2 падает с "
    "<font name='DJ-Mono'>KeyError: 'ContainerConfig'</font> при пересоздании, поэтому "
    "<font name='DJ-Mono'>down</font> и затем <font name='DJ-Mono'>up</font>, "
    "а не <font name='DJ-Mono'>restart</font>.",
    "Проверить, не раскрывая значений: "
    "<font name='DJ-Mono'>grep -E \"SECRET|CONFIRMATION\" docker-compose.yml | "
    "sed 's/=.*/=***/'</font>",
]))

A(P("Проверка: работает или нет", "h1"))
A(P("Единственный достоверный источник — ответ VK, а не интерфейс n8n:", "body"))
A(P("curl -s \"https://api.vk.com/method/groups.getCallbackServers"
    "?group_id=238091644&amp;access_token=ВАШ_ТОКЕН&amp;v=5.199\" \\<br/>"
    "&nbsp;&nbsp;| python3 -m json.tool", "code"))
A(table([
    ["status", "Что значит", "Что делать"],
    ["ok", "VK доставляет события", "Ничего"],
    ["failed", "VK отказался от адреса", "Исправить и подтвердить заново"],
    ["wait", "Подтверждение не завершено", "Вернуться к шагу 5"],
], [24 * mm, 66 * mm, 75 * mm]))

A(P("Ротация ключей", "h2"))
A(P("Меняйте оба ключа, если они попали в переписку, на скриншот или в общий доступ. "
    "Порядок: создать новый → обновить credential в n8n → опубликовать workflow → "
    "удалить старый ключ. Workflow обращается к credential по имени, поэтому сам "
    "workflow менять не нужно.", "body"))

doc = SimpleDocTemplate(
    str(OUT), pagesize=A4,
    leftMargin=22 * mm, rightMargin=22 * mm, topMargin=18 * mm, bottomMargin=20 * mm,
    title="Ключи доступа: Yandex Cloud и VK",
    author="NXAI / N-Enterprise",
    subject="Пошаговая инструкция по получению API-ключей",
)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(f"wrote {OUT}")
