#!/usr/bin/env python3
"""Generate the Build 2 client pitch PDF (Russian).

A sales document, not a technical one. Every number is measured on the live
widget at n-enterprise.ru/demo on 2026-09-15, or cited to its source. Nothing
is estimated. A figure that cannot be defended in a client meeting does not
belong in a client document.

Regenerate:  python3 docs/make-build2-pitch-pdf.py
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
OUT = pathlib.Path(__file__).resolve().parent / "build2-pitch.pdf"

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
A(P("Виджет-консультант с расчётом цены", "title"))
A(P("Посетитель узнаёт цену за минуту — и оставляет телефон сам", "tagline"))
A(P("Работающее решение, а не концепция. Посмотреть живьём прямо сейчас: "
    "<b>n-enterprise.ru/demo</b>", "sub"))
A(HRFlowable(width="100%", color=EDGE, thickness=0.8, spaceAfter=10))

A(stats([("2 вопроса", "и посетитель видит цену"),
         ("0", "телефонов спрошено до цены"),
         ("~9 ₽", "стоимость одного диалога"),
         ("152-ФЗ", "согласие проверяется на сервере")]))

# --------------------------------------------------------------- problem ---
A(P("Проблема, которую это решает", "h1"))
A(P("Человек ищет, во сколько обойдётся остеклить балкон. Открывает сайт — "
    "и видит «оставьте телефон, мы перезвоним и всё рассчитаем». "
    "Он закрывает вкладку и открывает следующий сайт.", "lead"))
A(P("Он не вредный. Он просто не хочет, чтобы ему звонили, пока он ещё "
    "выбирает. Цена нужна ему <b>сейчас</b>, а телефон он отдаст тогда, когда "
    "получит что-то взамен. Сайт, который требует контакт до того, как дал "
    "пользу, теряет большинство таких людей — и никогда не узнаёт, скольких.",
    "body"))
A(quote("Форма «оставьте заявку» собирает тех, кто и так уже решил. "
        "Все остальные уходят молча."))

A(P("Как это работает", "h1"))
A(P("Виджет в углу сайта. Отвечает на вопросы по материалам самой компании, "
    "выясняет ровно два факта — и называет цену. Настоящий диалог с живого "
    "сайта:", "body"))
A(chat([
    "<b>Посетитель:</b> какая гарантия?",
    "<b>Бот:</b> Гарантия на конструкцию — 5 лет, на фурнитуру — 3 года.",
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Какой у вас балкон — прямой примерно 3 метра,",
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;П-образный или лоджия?",
    "",
    "<b>Посетитель:</b> лоджия 6 метров, тёплое",
    "<b>Бот:</b> <b>от 34 000 до 70 000 ₽</b>",
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;лоджия 6 м, тёплое остекление",
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Что входит: монтаж, подоконники, козырьки,",
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;водоотливы, герметизация.",
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Не входит: отделка, утепление, электрика, мебель.",
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Это вилка, а не смета — точную цену назовёт замерщик.",
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;На каком этаже находится лоджия?",
    "",
    "→ <b>и только теперь</b> появляется форма: имя, телефон, адрес",
]))
A(P("Обратите внимание на порядок. Сначала ответ на заданный вопрос, потом "
    "один свой вопрос — не анкета из четырёх пунктов. Потом цена. "
    "И только потом телефон.", "small"))

# ------------------------------------------------------------ the guarantee -
A(P("Главное: телефон спрашивается после цены — и это не обещание", "h1"))
A(P("Любой чат-бот можно уговорить. «Дайте форму», «мне срочно», достаточно "
    "длинный разговор — и модель уступит, потому что ей велели быть полезной. "
    "Инструкция в тексте — это пожелание, а не гарантия.", "body"))
A(P("Здесь иначе. Форма контактов физически не может появиться, пока расчёт не "
    "выполнен: её открывает <b>не бот, а система</b> — по факту того, что цена "
    "действительно была показана. Уговорить этот механизм нельзя, потому что он "
    "не читает текст.", "body"))
A(P("Проверено на живом сайте: на прямое требование «дайте форму, мне срочно» "
    "до расчёта форма не появляется.", "small"))

# ------------------------------------------------------------------ prices --
A(P("Откуда берутся цифры", "h1"))
A(P("<b>Ни одна цена не выдумана.</b> Матрица собрана из опубликованного "
    "прайса реальной самарской компании (balkon63.ru, снято 14.09.2026): "
    "восемь классов профиля, от Exprof Externa до KBE-88. Вилка — это "
    "границы этого прайса, а не оценка «на глаз».", "body"))
A(table([
    ["Профиль", "Прямой балкон 3 м", "П-образный"],
    ["Exprof Externa — нижняя граница", "18 050 ₽", "26 840 ₽"],
    ["Rehau Thermo", "25 770 ₽", "39 490 ₽"],
    ["KBE-88 — верхняя граница", "36 722 ₽", "56 090 ₽"],
], [75 * mm, 45 * mm, 45 * mm]))
A(P("Каждая цифра в проекте записана вместе со ссылкой на источник и датой "
    "снятия. Когда прайс меняется — меняется одна таблица, и бот перестаёт "
    "называть прошлогоднюю цену. Это входит в сопровождение.", "small"))
A(P("Бот честно говорит, что это <b>вилка, а не смета</b>, и что точную цену "
    "назовёт замерщик. Завышенное обещание на сайте — это скандал на замере "
    "и потерянная сделка.", "body"))

A(PageBreak())

# ------------------------------------------------------- what never breaks --
A(P("Что происходит, когда что-то ломается", "h1"))
A(P("Лид — единственное, за что вы платите. Поэтому потерять его система не "
    "может ни при каком сбое:", "body"))
A(table([
    ["Что сломалось", "Что видит посетитель", "Что происходит с заявкой"],
    ["Сервис проверки адресов недоступен",
     "Ничего не замечает", "Сохраняется, помечена «проверить адрес»"],
    ["Адрес за пределами области",
     "Ничего не замечает", "Сохраняется, помечена для менеджера"],
    ["База знаний недоступна",
     "Бот честно говорит «уточню у менеджера»", "Сохраняется"],
    ["Сервер не отвечает вовсе",
     "Получает ваш телефон и может позвонить", "—"],
    ["Не поставлена галочка согласия",
     "Просьба её поставить", "<b>Не сохраняется. 152-ФЗ</b>"],
], [45 * mm, 55 * mm, 65 * mm]))
A(P("Единственное, что отменяет запись — отсутствие согласия на обработку "
    "персональных данных. Галочка проверяется <b>на сервере</b>, а не только в "
    "браузере: браузерную проверку обходят за десять секунд, серверную — нет.",
    "body"))

# ---------------------------------------------------------- plain language --
A(P("Если совсем просто", "h1"))
A(P("Представьте магазин, который ставит окна на балконы. Человек заходит на "
    "сайт и хочет знать одно: сколько это стоит. А на сайте написано — "
    "«оставьте телефон, мы перезвоним». Человек звонков не хочет. Он уходит, "
    "и магазин про него никогда не узнаёт.", "body"))
A(P("Мы поставили на сайт помощника. Он спрашивает всего две вещи: какой у вас "
    "балкон и нужно ли, чтобы зимой там было тепло. И сразу называет цену — "
    "например, от 34 до 70 тысяч, и объясняет, что в неё входит.", "body"))
A(P("И только после этого, когда человек уже получил ответ, помощник просит "
    "телефон. И человек его оставляет — потому что ему <b>сначала помогли</b>. "
    "Раньше эти люди просто уходили. Теперь они становятся заявками.", "body"))
A(quote("Мы не придумали новый способ выпрашивать телефон. "
        "Мы поменяли порядок: сначала польза, потом контакт."))

# ------------------------------------------------------------------ for you -
A(P("Что вы получаете", "h1"))
A(bullets([
    "<b>Заявки вместо ушедших посетителей.</b> Человек, который раньше "
    "закрывал вкладку, теперь оставляет телефон — уже зная цену, то есть "
    "готовым к разговору.",
    "<b>Менеджер звонит подготовленным.</b> В заявке уже есть конфигурация "
    "балкона, тип остекления, вилка цены и проверенный адрес. Не «здравствуйте, "
    "чем могу помочь», а «по вашей лоджии 6 метров вышло 34–70 тысяч».",
    "<b>Отсев пустых звонков.</b> Кто увидел цену и ушёл — тот и по телефону бы "
    "ушёл, только отняв у менеджера двадцать минут.",
    "<b>Ответы на вопросы круглосуточно</b>, и всегда одни и те же — те, что "
    "вы сами написали. Бот не выдумывает: чего нет в ваших материалах, он "
    "честно обещает уточнить у менеджера.",
]))

A(P("Что нужно от вас", "h2"))
A(table([
    ["1", "Ваш прайс — в любом виде, хоть фотографией. Мы переведём его в "
          "расчётную матрицу и покажем вам на проверку"],
    ["2", "Ответы на частые вопросы: гарантия, сроки, рассрочка, что входит в "
          "стоимость. Своими словами — переписывать не нужно"],
    ["3", "Доступ к сайту, чтобы вставить одну строку кода. Или дайте контакт "
          "того, кто ведёт сайт"],
    ["4", "Аккаунт Яндекс Облака на вашу организацию — помогаем оформить"],
], [8 * mm, 157 * mm], head=False))

# ------------------------------------------------------------------ price ---
A(P("Стоимость и условия", "h1"))
A(table([
    ["Позиция", "Стоимость", "Что входит"],
    ["Внедрение", "<b>70 000 – 110 000 ₽</b>",
     "Ваш прайс — в расчётную матрицу, ваши материалы — в базу знаний, "
     "виджет на сайт в ваших цветах, настройка маршрута заявок, запуск "
     "и обучение менеджера"],
    ["Сопровождение", "<b>12 000 ₽ / мес</b>",
     "Актуализация прайса при его изменении, правки базы знаний, "
     "мониторинг, разбор заявок, помеченных на проверку, "
     "один новый канал в год (ВКонтакте, Авито)"],
    ["Расходы на облако", "оплачиваются вами напрямую",
     "Модель и проверка адресов. Один диалог — около 9 ₽, "
     "проверка адреса — 20 копеек. Счёт приходит вам, не через посредника"],
], [32 * mm, 38 * mm, 95 * mm]))
A(P("Облачный аккаунт оформляется <b>на ваше юридическое лицо</b>. Вы платите "
    "напрямую Яндексу, в рублях, с закрывающими документами. Мы не берём "
    "наценку за перепродажу и не становимся посредником в ваших платежах. "
    "Данные остаются в российском контуре — это требование 152-ФЗ, а не "
    "предпочтение.", "small"))

A(P("Порядок работы", "h2"))
A(P("Сначала мы собираем расчёт по вашему прайсу и показываем его вам — "
    "до всякой оплаты. Вы видите, какие цифры бот будет называть вашим "
    "клиентам, и говорите, что поправить. Только после вашего «да» это "
    "уходит на сайт.", "body"))
A(P("Посмотреть, как это работает, можно прямо сейчас, без звонков и заявок: "
    "<b>n-enterprise.ru/demo</b>", "lead"))
A(P("NXAI · N-Enterprise · n-enterprise.ru", "small"))

doc = SimpleDocTemplate(
    str(OUT), pagesize=A4,
    leftMargin=22 * mm, rightMargin=22 * mm, topMargin=18 * mm, bottomMargin=20 * mm,
    title="Виджет-консультант с расчётом цены — NXAI",
    author="NXAI / N-Enterprise",
    subject="Лид-форма с мгновенным расчётом стоимости для сайта",
)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(f"wrote {OUT}")
