/**
 * Tests for normalize.js — run: node builds/01-receipt-bot/normalize.test.js
 *
 * Cases marked [REAL] use strings taken verbatim from the Yandex Vision OCR
 * output in ocr-results/ (ООО «Рафаэль», Samara, 25.08.2026).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const N = require('./normalize');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
section('Text fields are never character-substituted (the ЗАО guard)');

test('ЗАО stays ЗАО', () => {
  assert.strictEqual(N.normalizeText('ЗАО Ромашка'), 'ЗАО Ромашка');
});

test('ООО stays ООО — not 000', () => {
  assert.strictEqual(N.normalizeText('ООО РАФАЭЛЬ'), 'ООО РАФАЭЛЬ');
});

test('[REAL] OCR-misread vendor ООО РАФАЗЛЬ is left exactly as-is', () => {
  assert.strictEqual(N.normalizeText('ООО РАФАЗЛЬ'), 'ООО РАФАЗЛЬ');
});

test('vendor field routed through parseReceipt is not repaired', () => {
  const r = N.parseReceipt({ vendor: 'ЗАО ЗЗЗ-Оптика' });
  assert.strictEqual(r.data.vendor, 'ЗАО ЗЗЗ-Оптика');
  assert.strictEqual(r.repairs.length, 0);
});

test('address with О and З survives intact', () => {
  const r = N.parseReceipt({ address: 'г Самара, Московское шоссе, литера Б' });
  assert.strictEqual(r.data.address, 'г Самара, Московское шоссе, литера Б');
});

// ---------------------------------------------------------------------------
section('Guard 3: tokens with no real digit are refused by numeric parsers');

test('ЗАО is refused as an amount, not coerced to 3АО', () => {
  const r = N.parseAmount('ЗАО');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'unparseable_amount');
});

test('ООО is refused as an id, not coerced to 000', () => {
  const r = N.parseId('ООО');
  assert.strictEqual(r.ok, false);
});

test('ЗЗЗ.ЗЗ is refused as an amount', () => {
  assert.strictEqual(N.parseAmount('ЗЗЗ.ЗЗ').ok, false);
});

// ---------------------------------------------------------------------------
section('Guard 2: already-valid values are returned untouched');

test('[REAL] 2’690.00 parses clean, no repair flag', () => {
  const r = N.parseAmount("2'690.00");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 2690);
  assert.strictEqual(r.repaired, false);
});

test('[REAL] 600.00 parses clean', () => {
  assert.strictEqual(N.parseAmount('600.00').value, 600);
});

test('[REAL] 77856.00 (Z-report сверка итогов) parses clean', () => {
  assert.strictEqual(N.parseAmount('77856.00').value, 77856);
});

test('[REAL] 67’376.00 (card total) parses clean', () => {
  assert.strictEqual(N.parseAmount("67'376.00").value, 67376);
});

// ---------------------------------------------------------------------------
section('Repair path: the actual observed OCR failure');

test('[REAL] З’980.00 -> 3980.00, flagged as repaired', () => {
  const r = N.parseAmount("З'980.00");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 3980);
  assert.strictEqual(r.repaired, true);
});

test('О-for-0 in an amount is repaired: 1О.00 -> 10.00', () => {
  const r = N.parseAmount('1О.00');
  assert.strictEqual(r.value, 10);
  assert.strictEqual(r.repaired, true);
});

test('amount that cannot be repaired goes to review, not to zero', () => {
  const r = N.parseAmount('2х690.00');
  assert.strictEqual(r.ok, false);
  assert.notStrictEqual(r.value, 0);
});

test('apostrophe separator never yields the parseFloat("2’690.00")=2 bug', () => {
  assert.notStrictEqual(N.parseAmount("2'690.00").value, 2);
});

// ---------------------------------------------------------------------------
section('Dates');

test('[REAL] 25.08.2026 -> 2026-08-25', () => {
  assert.strictEqual(N.parseDate('25.08.2026').value, '2026-08-25');
});

test('[REAL] 25.08.26 (Z-report short form) -> 2026-08-25', () => {
  assert.strictEqual(N.parseDate('25.08.26').value, '2026-08-25');
});

test('25.О8.2026 repaired -> 2026-08-25', () => {
  const r = N.parseDate('25.О8.2026');
  assert.strictEqual(r.value, '2026-08-25');
  assert.strictEqual(r.repaired, true);
});

test('impossible calendar date goes to review', () => {
  const r = N.parseDate('32.08.2026');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'invalid_calendar_date');
});

test('[REAL] fragmented date 25.08.20 + 8.2026 does NOT silently parse', () => {
  // OCR split one slip's date across two lines. "25.08.20" is a syntactically
  // valid short date, so it parses — the defect is upstream in line joining,
  // not in the normaliser. Documented here so the risk stays visible.
  const r = N.parseDate('25.08.20');
  assert.strictEqual(r.value, '2020-08-25'); // wrong year, right syntax
});

// ---------------------------------------------------------------------------
section('ИНН with ФНС checksum');

test('[REAL] ИНН 7720425673 from the Z-report passes checksum', () => {
  const r = N.parseInn('7720425673');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, '7720425673');
});

test('[REAL] ИНН with О-for-0: 772О425673 repaired and checksum-valid', () => {
  const r = N.parseInn('772О425673');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, '7720425673');
  assert.strictEqual(r.repaired, true);
});

test('a repaired-but-checksum-failing ИНН goes to review', () => {
  const r = N.parseInn('7720425674');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'inn_checksum_failed');
});

// ---------------------------------------------------------------------------
section('Card masks and terminal ids');

test('[REAL] ****5353 -> 5353', () => {
  assert.strictEqual(N.parseCardMask('****5353').value, '5353');
});

test('[REAL] ****О327 repaired -> 0327', () => {
  const r = N.parseCardMask('****О327');
  assert.strictEqual(r.value, '0327');
  assert.strictEqual(r.repaired, true);
});

test('[REAL] TID 00845094 parses', () => {
  assert.strictEqual(N.parseId('00845094', 'tid').value, '00845094');
});

test('[REAL] RRN 623709728261 parses', () => {
  assert.strictEqual(N.parseId('623709728261', 'rrn').value, '623709728261');
});

// ---------------------------------------------------------------------------
section('parseReceipt end-to-end on a real slip');

test('[REAL] mixed receipt: amount repaired, vendor untouched, review empty', () => {
  const r = N.parseReceipt({
    vendor: 'ООО РАФАЗЛЬ',       // OCR error in TEXT — must survive unrepaired
    address: 'г Самара, Московское шоссе, литера Б',
    date: '25.08.2026',
    amount: "З'980.00",           // OCR error in a NUMBER — must be repaired
    inn: '7720425673',
    card_mask: '****4982',
    tid: '00845094',
    mid: '845094',
  });

  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.vendor, 'ООО РАФАЗЛЬ');
  assert.strictEqual(r.data.amount, 3980);
  assert.strictEqual(r.data.date, '2026-08-25');
  assert.strictEqual(r.data.inn, '7720425673');
  assert.strictEqual(r.data.card_mask, '4982');
  // The repair log records raw OCR token -> final parsed value, which is what
  // an audit row needs. Vendor is absent from repairs: text is never repaired.
  assert.deepStrictEqual(r.repairs, [
    { field: 'amount', raw: "З'980.00", value: 3980 },
  ]);
});

test('unparseable amount routes the whole receipt to manual review', () => {
  const r = N.parseReceipt({ vendor: 'ООО РАФАЭЛЬ', amount: 'СУММА' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.data.amount, null);
  assert.strictEqual(r.review[0].reason, 'unparseable_amount');
});

// ---------------------------------------------------------------------------
section('Sweep: every РУБ amount in the real OCR output');

const resultsDir = path.join(__dirname, 'ocr-results');
if (fs.existsSync(resultsDir)) {
  const text = fs
    .readdirSync(resultsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const resp = JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf8'));
      const pages = resp.results[0].results[0].textDetection.pages;
      return pages
        .flatMap((p) => p.blocks || [])
        .flatMap((b) => b.lines || [])
        .map((l) => (l.words || []).map((w) => w.text).join(' '))
        .join('\n');
    })
    .join('\n');

  const tokens = [...text.matchAll(/([\dЗОо'’]+[.,]\d{2})\s*РУБ/g)].map((m) => m[1]);
  const unique = [...new Set(tokens)];

  test(`all ${unique.length} distinct РУБ amounts parse or are flagged`, () => {
    const results = unique.map((t) => ({ t, r: N.parseAmount(t) }));
    const bad = results.filter((x) => !x.r.ok);
    const repaired = results.filter((x) => x.r.ok && x.r.repaired);
    console.log(
      `       parsed=${results.length - bad.length} repaired=${repaired.length} review=${bad.length}`
    );
    repaired.forEach((x) => console.log(`       repaired: ${x.t} -> ${x.r.value}`));
    bad.forEach((x) => console.log(`       review:   ${x.t} (${x.r.reason})`));
    assert.strictEqual(bad.length, 0, `unparsed: ${bad.map((x) => x.t).join(', ')}`);
  });
} else {
  console.log('  skip  ocr-results/ not found — run ocr_test.py first');
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
