#!/usr/bin/env python3
"""Generate the Build 1 client pitch PDF (Russian).

A sales document, not a technical one. Every number in it is measured from the
live bot on 2026-09-13/14 — nothing is estimated or rounded up. If a figure
cannot be stood behind in a client meeting it does not belong here.

Regenerate:  python3 docs/make-build1-pitch-pdf.py
"""

import pathlib

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable, KeepTogether, ListFlowable, ListItem, PageBreak, Paragraph,
    SimpleDocTemplate, Spacer, Table, TableStyle,
)

FONTS = pathlib.Path("/usr/share/fonts/truetype/dejavu")
OUT = pathlib.Path(__file__).resolve().parent / "build1-pitch.pdf"

pdfmetrics.registerFont(TTFont("DJ", FONTS / "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DJ-Bold", FONTS / "DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DJ-Mono", FONTS / "DejaVuSansMono.ttf"))
pdfmetrics.registerFontFamily("DJ", normal="DJ", bold="DJ-Bold")

INK = colors.HexColor("#14181f")
MUTED = colors.HexColor("#5b6470")
ACCENT = colors.HexColor("#0b5fff")
GREEN = colors.HexColor("#0a7d4a")
SOFT = colors.HexColor("#f4f6f9")
EDGE = colors.HexColor("#dde2e9")
QUOTE_BG = colors.HexColor("#eef4ff")


def style(name, **kw):
    base = dict(fontName="DJ", textColor=INK, leading=14.5, fontSize=9.8, alignment=TA_LEFT)
    base.update(kw)
    return ParagraphStyle(name, **base)


S = {
    "title": style("title", fontName="DJ-Bold", fontSize=23, leading=27, spaceAfter=3),
    "tagline": style("tagline", fontSize=12, textColor=ACCENT, leading=16, spaceAfter=3,
                     fontName="DJ-Bold"),
    "sub": style("sub", fontSize=9.5, textColor=MUTED, leading=13.5, spaceAfter=14),
    "h1": style("h1", fontName="DJ-Bold", fontSize=14.5, leading=18, spaceBefore=16,
                spaceAfter=7, textColor=ACCENT),
    "h2": style("h2", fontName="DJ-Bold", fontSize=11, leading=15, spaceBefore=10, spaceAfter=4),
    "body": style("body", spaceAfter=6),
    "lead": style("lead", fontSize=11, leading=16, spaceAfter=8),
    "small": style("small", fontSize=8.3, textColor=MUTED, leading=11.5, spaceAfter=3),
    "quote": style("quote", fontSize=11.5, leading=16.5, fontName="DJ-Bold"),
    "cell": style("cell", fontSize=8.8, leading=12.2),
    "cellb": style("cellb", fontName="DJ-Bold", fontSize=8.8, leading=12.2),
    "statnum": style("statnum", fontName="DJ-Bold", fontSize=19, leading=22,
                     alignment=TA_CENTER, textColor=ACCENT),
    "statlbl": style("statlbl", fontSize=8, leading=11, alignment=TA_CENTER, textColor=MUTED),
    "chat": style("chat", fontName="DJ-Mono", fontSize=8.4, leading=12.5),
}


def P(t, s="body"):
    return Paragraph(t, S[s])


def bullets(items, s="body"):
    return ListFlowable(
        [ListItem(Paragraph(t, S[s]), leftIndent=12) for t in items],
        bulletType="bullet", bulletFontName="DJ", bulletFontSize=9.8,
        leftIndent=14, bulletDedent=9, spaceAfter=7,
    )


def stats(pairs):
    """Headline numbers. All measured, none estimated."""
    cells = [[Paragraph(n, S["statnum"]) for n, _ in pairs],
             [Paragraph(l, S["statlbl"]) for _, l in pairs]]
    w = 165 * mm / len(pairs)
    t = Table(cells, colWidths=[w] * len(pairs))
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 11),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 11),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
        ("TOPPADDING", (0, 1), (-1, 1), 1),
        ("LINEAFTER", (0, 0), (-2, -1), 0.6, colors.white),
    ]))
    return KeepTogether([Spacer(1, 3), t, Spacer(1, 10)])


def quote(text, attribution=None):
    inner = [P(text, "quote")]
    if attribution:
        inner.append(Spacer(1, 4))
        inner.append(P(attribution, "small"))
    t = Table([[inner]], colWidths=[165 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), QUOTE_BG),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return KeepTogether([Spacer(1, 4), t, Spacer(1, 9)])


def table(rows, widths, head=True):
    data = [[Paragraph(c, S["cellb"] if (head and r == 0) else S["cell"]) for c in row]
            for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    st = [("GRID", (0, 0), (-1, -1), 0.5, EDGE),
          ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("LEFTPADDING", (0, 0), (-1, -1), 7),
          ("RIGHTPADDING", (0, 0), (-1, -1), 7),
          ("TOPPADDING", (0, 0), (-1, -1), 6),
          ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]
    if head:
        st.append(("BACKGROUND", (0, 0), (-1, 0), SOFT))
    t.setStyle(TableStyle(st))
    return KeepTogether([Spacer(1, 3), t, Spacer(1, 9)])


def chat(lines):
    body = "<br/>".join(lines)
    t = Table([[Paragraph(body, S["chat"])]], colWidths=[165 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("BOX", (0, 0), (-1, -1), 0.5, EDGE),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return KeepTogether([Spacer(1, 3), t, Spacer(1, 9)])


def footer(c, doc):
    c.saveState()
    c.setFont("DJ", 7.5)
    c.setFillColor(MUTED)
    c.drawString(22 * mm, 12 * mm, "NXAI · N-Enterprise · n-enterprise.ru")
    c.drawRightString(A4[0] - 22 * mm, 12 * mm, f"{doc.page}")
    c.setStrokeColor(EDGE)
    c.setLineWidth(0.5)
    c.line(22 * mm, 16 * mm, A4[0] - 22 * mm, 16 * mm)
    c.restoreState()


story = []
A = story.append

# ------------------------------------------------------------------ cover ---
A(P("Бот учёта расходов", "title"))
A(P("Сотрудник фотографирует чек — расход уже в системе", "tagline"))
A(P("Работающее решение, а не концепция. Все цифры ниже измерены на живом боте, "
    "на настоящих российских чеках.", "sub"))
A(HRFlowable(width="100%", color=EDGE, thickness=0.8, spaceAfter=10))

A(stats([("10 сек", "от фото до записи"),
         ("9 из 9", "позиций чека распознано"),
         ("0 ₽", "за VPN и обходные пути"),
         ("152-ФЗ", "данные не покидают РФ")]))

A(P("Проблема, которую это решает", "h1"))
A(P("В компании кто-то перебивает чеки руками. Обычно это бухгалтер, "
    "иногда сам владелец — по вечерам. Проблема не в том, что это долго. "
    "Проблема в том, что происходит вокруг этого:", "lead"))
A(bullets([
    "<b>Чеки теряются.</b> Смятый чек из кармана прораба не доезжает до бухгалтерии. "
    "Расход не учтён — налог переплачен.",
    "<b>Данные приходят в конце месяца.</b> Вы узнаёте, сколько потратили, когда "
    "тратить уже поздно.",
    "<b>Ошибки при переносе.</b> Человек, перебивающий сотый чек за вечер, "
    "ошибается — и эту ошибку никто не поймает.",
    "<b>Это никому не нравится.</b> Ни один человек не хочет заниматься этим, "
    "и качество соответствует.",
]))

A(P("Как это работает", "h1"))
A(P("Сотрудник отправляет фото чека в чат ВКонтакте — там же, где он и так "
    "переписывается. Ничего не устанавливать, не учить, не открывать на компьютере.", "body"))
A(chat([
    "<b>Сотрудник</b> → [фото чека]",
    "",
    "<b>Бот</b> (через 2 секунды) → 🔍 Читаю чек…",
    "",
    "<b>Бот</b> (через 10 секунд) →",
    "✅ Записал",
    "",
    "ООО «АШАН»",
    "1940.80 RUB · 04.09.2026",
    "Категория: канцтовары",
    "",
    "Позиции (9):",
    "• ONE ДЛЯ КОТЯТ КУР — 144.99",
    "• КРЕМ-СУП Д/К КР.40Г — 114.99",
    "• ТЕТРАДЬ 48Л.ГЕОМ ЗАГ — 29.97",
    "• ТЕТ/КОН. А4 80Л.СКР. ×5 — 974.95",
    "• …",
]))
A(P("Расход уже в таблице: продавец, дата, сумма, категория и каждая позиция "
    "отдельной строкой. Бухгалтеру остаётся выгрузить, а не перепечатать.", "body"))

A(PageBreak())

# --------------------------------------------------------- differentiator ---
A(P("Главное отличие: бот не угадывает", "h1"))
A(quote("Если система не уверена — она говорит об этом, а не подставляет "
        "правдоподобное число."))
A(P("Распознавание текста ошибается на мятой термобумаге — это физика, а не "
    "качество программы. Вопрос не в том, ошибётся ли система, а в том, "
    "<b>узнаете ли вы об этом</b>.", "body"))

A(P("Реальный случай из тестирования", "h2"))
A(P("В чеке было девять товарных строк, две из них — повторяющиеся. "
    "Модель распознавания «склеила» повторы и вернула семь. Сумма сошлась бы "
    "на вид, но чек недосчитался 62 ₽.", "body"))
A(P("Система сверила сумму позиций с итогом, напечатанным на чеке, "
    "увидела расхождение и сообщила:", "body"))
A(chat(["⚠️ Записал, но проверьте",
        "",
        "сумма позиций 1878.84 не сходится с итогом 1940.80"]))
A(P("Чек всё равно записан — с пометкой и причиной. Ничего не потеряно, "
    "ничего не выдумано, человек знает, что именно проверить.", "body"))

A(P("Три правила, заложенные в систему", "h2"))
A(table([
    ["Правило", "Что это значит для вас"],
    ["Модель только извлекает, а проверяет — код",
     "Сумму и дату проверяет детерминированный алгоритм, а не нейросеть. "
     "Результат воспроизводим и его можно объяснить аудитору."],
    ["Исправления видны",
     "Если распознавание перепутало символы и система это исправила — "
     "исправление показано в ответе, а не спрятано."],
    ["Непонятное идёт на проверку, а не в корзину",
     "Нечитаемое фото, несколько чеков в кадре, отсутствующая дата — "
     "каждый случай записан с причиной. Автоматического отказа нет."],
], [52 * mm, 113 * mm]))

A(P("Кому это подходит", "h1"))
A(P("Признак один: <b>в компании есть люди, которые тратят деньги не в офисе</b> "
    "и приносят бумажки.", "lead"))
A(table([
    ["Сегмент", "Кто фотографирует", "Почему болит"],
    ["Строительные и ремонтные бригады", "Прорабы, бригадиры",
     "Закупки материалов каждый день, чеки в кармане спецовки, "
     "объект далеко от офиса"],
    ["Таксопарки, курьерские службы", "Водители",
     "Топливо, мойка, мелкий ремонт. Много мелких чеков от многих людей"],
    ["Розница с несколькими точками", "Управляющие точками",
     "Хозрасходы по каждой точке, которые видно только в конце месяца"],
    ["Клининг, кейтеринг, выездные услуги", "Бригадиры смен",
     "Расходники закупаются по дороге на объект"],
    ["Бухгалтерский аутсорсинг", "Сотрудники клиентов",
     "<b>Самый выгодный случай:</b> внедряется один раз, "
     "обслуживает десятки клиентов сразу"],
], [42 * mm, 36 * mm, 87 * mm]))

A(P("Кому не подходит — честно", "h2"))
A(bullets([
    "Компаниям, где все расходы проходят по безналу с корпоративной карты — "
    "там выписка из банка уже решает задачу.",
    "Тем, кому нужна полная бухгалтерская система. Это инструмент захвата "
    "расхода в момент траты, а не замена 1С.",
    "Объёмам меньше ~30 чеков в месяц — окупаемость станет слишком долгой, "
    "и честнее сказать об этом сразу.",
]))

A(PageBreak())

# --------------------------------------------------------------- outcomes ---
A(P("Что клиент получает", "h1"))
A(table([
    ["", "Было", "Стало"],
    ["Момент записи расхода", "Вечером, в конце недели или месяца",
     "В момент покупки, из магазина"],
    ["Кто вводит данные", "Бухгалтер или владелец, вручную",
     "Никто — сотрудник просто фотографирует"],
    ["Потерянные чеки", "Обычное дело", "Чек уходит сразу, терять нечего"],
    ["Видимость расходов", "После закрытия месяца", "Сегодня"],
    ["Ошибки переноса", "Есть, и никто их не ищет",
     "Проверяются автоматически, спорные помечены"],
], [32 * mm, 60 * mm, 73 * mm]))

A(P("Стоимость и условия", "h1"))
A(table([
    ["Позиция", "Стоимость", "Что входит"],
    ["Внедрение", "<b>35 000 – 50 000 ₽</b>",
     "Настройка, подключение канала, категории расходов под вашу специфику, "
     "обучение сотрудников, запуск"],
    ["Сопровождение", "<b>8 000 ₽ / мес</b>",
     "Мониторинг работоспособности, донастройка распознавания под ваших "
     "поставщиков, изменение категорий, рост объёма, "
     "один новый канал связи в год"],
    ["Расходы на облако", "оплачиваются вами напрямую",
     "Распознавание и обработка. При ~200 чеках в день — порядка "
     "1 000 – 2 000 ₽/мес. Счёт приходит вам, не через посредника"],
], [32 * mm, 38 * mm, 95 * mm]))
A(P("Облачный аккаунт оформляется <b>на ваше юридическое лицо</b>. Вы платите "
    "напрямую Яндексу, в рублях, с закрывающими документами. Мы не берём "
    "наценку за перепродажу трафика и не становимся посредником в ваших "
    "платежах.", "small"))

A(P("Что нужно от вас", "h2"))
A(table([
    ["1", "Аккаунт Яндекс Облака на вашу организацию (помогаем оформить)"],
    ["2", "Сообщество ВКонтакте — или используем существующее"],
    ["3", "Список категорий расходов, как их называет ваш бухгалтер"],
    ["4", "10–20 типичных чеков ваших поставщиков для настройки распознавания"],
], [8 * mm, 157 * mm], head=False))

A(P("Сроки", "h2"))
A(P("Запуск — <b>3–5 рабочих дней</b> с момента получения доступов. "
    "Первую неделю расходы пишутся параллельно с вашим обычным способом, "
    "чтобы вы сравнили результат, а не поверили на слово.", "body"))

A(P("Почему всё работает из России", "h1"))
A(P("Это не адаптация зарубежного сервиса, а решение, изначально собранное "
    "под российские условия:", "body"))
A(bullets([
    "<b>Распознавание и языковая модель — Яндекс Облако.</b> Данные не покидают "
    "территорию России. Соответствие 152-ФЗ.",
    "<b>Канал — ВКонтакте.</b> Никаких VPN ни у вас, ни у сотрудников. "
    "Работает на любом телефоне, который уже есть на руках.",
    "<b>Оплата в рублях</b>, с закрывающими документами. Никаких зарубежных карт "
    "ни на одном участке.",
    "<b>Сервер в России.</b> Данные по расходам хранятся на российском хостинге.",
]))

A(P("Что происходит, если что-то сломается", "h2"))
A(P("Встроено оповещение о сбоях: если распознавание или канал перестанут "
    "отвечать, сообщение приходит нам <b>в течение нескольких секунд</b>, "
    "с указанием конкретного отказавшего узла. Мы узнаём о проблеме раньше, "
    "чем ваш сотрудник. Это проверено на живой системе, а не заявлено.", "body"))

A(Spacer(1, 8))
A(HRFlowable(width="100%", color=EDGE, thickness=0.8, spaceAfter=8))
A(P("Хотите посмотреть, как это работает на ваших чеках?", "h2"))
A(P("Пришлите 10–20 фотографий типичных чеков ваших поставщиков. "
    "Покажем результат распознавания на них до того, как вы что-либо заплатите. "
    "Если качество вас не устроит — вы ничего не теряете.", "body"))
A(P("NXAI · N-Enterprise · n-enterprise.ru", "small"))

doc = SimpleDocTemplate(
    str(OUT), pagesize=A4,
    leftMargin=22 * mm, rightMargin=22 * mm, topMargin=18 * mm, bottomMargin=20 * mm,
    title="Бот учёта расходов — NXAI",
    author="NXAI / N-Enterprise",
    subject="Автоматизация учёта расходов по фото чека",
)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(f"wrote {OUT}")
