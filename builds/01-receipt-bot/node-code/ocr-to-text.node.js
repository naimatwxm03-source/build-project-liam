/**
 * Yandex Vision OCR response → flat text for the extraction model.
 *
 * Verified against the real responses in ocr-results/, captured from Russian
 * thermal receipts on 2026-09-03.
 *
 * The shape is deeper than it looks and has one trap: `lines` carry NO `text`
 * field. Only `words[].text` exists, so a line must be rebuilt by joining its
 * words. Reading `line.text` yields `undefined` for every line and produces an
 * empty prompt with no error anywhere.
 *
 *   results[].results[].textDetection.pages[].blocks[].lines[].words[].text
 *
 * Portable to an n8n Code node as-is — no imports, no Node built-ins.
 */

'use strict';

/** Words below this confidence are kept but marked, so the model can discount them. */
const LOW_CONFIDENCE = 0.6;

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Rebuild one line's text from its words.
 * Vision returns words in reading order, so a plain join is correct; sorting by
 * boundingBox would reorder correctly-ordered output on skewed thermal paper.
 */
function lineText(line) {
  return asArray(line && line.words)
    .map((w) => (w && typeof w.text === 'string' ? w.text : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** Mean word confidence for a line, 0 when the line has no scored words. */
function lineConfidence(line) {
  const scores = asArray(line && line.words)
    .map((w) => (w && typeof w.confidence === 'number' ? w.confidence : null))
    .filter((c) => c !== null);
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * @param {object} response - raw Vision batchAnalyze JSON
 * @returns {{text: string, lines: Array<{text: string, confidence: number}>, pages: number, lowConfidenceLines: number}}
 */
function ocrToText(response) {
  const lines = [];

  for (const outer of asArray(response && response.results)) {
    for (const inner of asArray(outer && outer.results)) {
      const pages = asArray(inner && inner.textDetection && inner.textDetection.pages);
      for (const page of pages) {
        for (const block of asArray(page && page.blocks)) {
          for (const line of asArray(block && block.lines)) {
            const text = lineText(line);
            if (!text) continue;
            lines.push({ text, confidence: lineConfidence(line) });
          }
        }
      }
    }
  }

  return {
    text: lines.map((l) => l.text).join('\n'),
    lines,
    pages: countPages(response),
    lowConfidenceLines: lines.filter((l) => l.confidence < LOW_CONFIDENCE).length,
  };
}

function countPages(response) {
  let n = 0;
  for (const outer of asArray(response && response.results)) {
    for (const inner of asArray(outer && outer.results)) {
      n += asArray(inner && inner.textDetection && inner.textDetection.pages).length;
    }
  }
  return n;
}

/**
 * Did OCR produce enough to be worth sending to a model?
 *
 * A blurred or dark photo comes back as a handful of junk lines, not as an
 * error. Routing that to the model wastes tokens and invites a hallucinated
 * receipt. Below this bar the message goes to manual review with an honest
 * reason — never to an automated rejection.
 */
function isUsable(result) {
  if (!result || !result.text) return { ok: false, reason: 'OCR вернул пустой текст' };
  if (result.lines.length < 3) {
    return { ok: false, reason: `OCR распознал только ${result.lines.length} строк(и)` };
  }
  if (!/\d/.test(result.text)) {
    return { ok: false, reason: 'В распознанном тексте нет ни одной цифры' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
//   source: builds/01-receipt-bot/ocr-text.js
// ---------------------------------------------------------------------------
const envelope = $('Normalize VK Event').first().json;

return $input.all().map((item) => {
  const flat = ocrToText(item.json);
  const usable = isUsable(flat);
  return {
    json: {
      ...envelope,
      receipt_text: flat.text,
      ocr_lines: flat.lines.length,
      ocr_low_confidence_lines: flat.lowConfidenceLines,
      ocr_usable: usable.ok,
      ocr_reason: usable.ok ? '' : usable.reason,
    },
  };
});
