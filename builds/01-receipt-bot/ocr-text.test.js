const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ocrToText, lineText, lineConfidence, isUsable } = require('./ocr-text');

const RESULTS = path.join(__dirname, 'ocr-results');
const real = fs.existsSync(RESULTS)
  ? fs.readdirSync(RESULTS).filter((f) => f.endsWith('.json'))
  : [];

test('rebuilds a line from its words, because lines carry no text field', () => {
  // This is the trap: Vision emits words[].text and NO line.text. Reading
  // line.text yields undefined for every line and an empty prompt, silently.
  const line = { words: [{ text: 'ООО' }, { text: '"Рафаэль"' }] };
  assert.strictEqual(line.text, undefined, 'guards the assumption this test exists for');
  assert.strictEqual(lineText(line), 'ООО "Рафаэль"');
});

test('skips words with no text instead of emitting undefined', () => {
  assert.strictEqual(lineText({ words: [{ text: 'A' }, {}, { text: 'B' }] }), 'A B');
  assert.strictEqual(lineText({}), '');
  assert.strictEqual(lineText(null), '');
});

test('line confidence is the mean of its words, 0 when unscored', () => {
  assert.strictEqual(lineConfidence({ words: [{ confidence: 1 }, { confidence: 0.5 }] }), 0.75);
  assert.strictEqual(lineConfidence({ words: [{ text: 'x' }] }), 0);
  assert.strictEqual(lineConfidence(null), 0);
});

test('a malformed or empty response yields empty text, not a throw', () => {
  for (const bad of [undefined, null, {}, { results: [] }, { results: [{ results: [{}] }] }]) {
    const r = ocrToText(bad);
    assert.strictEqual(r.text, '');
    assert.strictEqual(r.lines.length, 0);
    assert.strictEqual(r.pages, 0);
  }
});

test('empty OCR is refused before it reaches the model', () => {
  assert.strictEqual(isUsable(ocrToText(null)).ok, false);
});

test('too few lines routes to manual review with a stated reason', () => {
  const r = isUsable({ text: 'ЧЕК 1', lines: [{ text: 'ЧЕК 1', confidence: 0.9 }] });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /строк/);
});

test('text with no digit at all is refused — a receipt always has numbers', () => {
  const lines = [{ text: 'ОДОБРЕНО' }, { text: 'СПАСИБО' }, { text: 'ПРИХОДИТЕ' }];
  const r = isUsable({ text: lines.map((l) => l.text).join('\n'), lines });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /цифр/);
});

test('a refusal always carries a human-readable reason, never a bare false', () => {
  for (const bad of [null, { text: '', lines: [] }, { text: 'ЧЕК', lines: [{ text: 'ЧЕК' }] }]) {
    const r = isUsable(bad);
    assert.strictEqual(r.ok, false);
    assert.ok(r.reason && r.reason.length > 0, 'manual review needs a reason to show');
  }
});

// --- against the real captured responses -----------------------------------

test('real Vision responses flatten to usable text', { skip: real.length === 0 }, () => {
  for (const f of real) {
    const raw = JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8'));
    const r = ocrToText(raw);

    assert.strictEqual(r.pages, 1, `${f}: expected one page`);
    assert.ok(r.lines.length > 10, `${f}: only ${r.lines.length} lines`);
    assert.strictEqual(isUsable(r).ok, true, `${f}: judged unusable`);
    assert.ok(!r.text.includes('undefined'), `${f}: leaked an undefined into the text`);
    assert.ok(/РАФА/.test(r.text), `${f}: vendor name missing from flattened text`);
  }
});

test('the multi-receipt photo really does contain several slips', { skip: real.length === 0 }, () => {
  // 20.48.36 is one photo of a pile of slips. The agent must not silently pick
  // one and log it as "the" expense — this asserts the condition it must detect.
  const f = real.find((x) => x.includes('20.48.36'));
  if (!f) return;
  const r = ocrToText(JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')));
  const totals = (r.text.match(/СУММА/g) || []).length;
  assert.ok(totals > 1, `expected multiple СУММА blocks, found ${totals}`);
});
