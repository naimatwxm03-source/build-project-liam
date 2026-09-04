/**
 * OCR lookalike repair for Russian thermal-print receipts.
 *
 * Yandex Vision confuses Cyrillic letters with digits in receipt fonts.
 * Observed on real slips from ООО «Рафаэль» (Samara, 25.08.2026):
 *   "З'980.00 РУБ"   -> digit 3 read as Cyrillic З
 *   "ООО РАФАЗЛЬ"    -> Э read as З (text — must NOT be "repaired")
 *
 * DESIGN RULE: repair is applied ONLY to typed numeric fields (amount, date,
 * ИНН, card mask, terminal/auth ids). Free text — vendor names, addresses,
 * cashier names — goes through normalizeText(), which never touches
 * characters. This is what keeps ЗАО from becoming 3АО and ООО from becoming 000.
 *
 * Three guards, each sufficient on its own:
 *   1. Field typing — text fields never reach the repair path at all.
 *   2. Already-valid tokens are returned untouched. Repair only ever runs on
 *      a token that FAILED its pattern, so a value that already parses can
 *      never be silently altered.
 *   3. A token with no real ASCII digit is refused outright. "ЗАО" and "ООО"
 *      have none, so they can never be coerced into "3АО" / "000".
 *
 * Anything that cannot be repaired into a valid value returns a review record
 * ({ ok: false, reason }) — never a zero, never a silent drop, never an
 * automated rejection.
 *
 * Portable to an n8n Code node as-is (no imports, no Node built-ins).
 */

'use strict';

/**
 * Cyrillic/Latin glyphs → digits. Deliberately conservative: every entry here
 * is a substitution actually seen in RU thermal-receipt OCR. Adding speculative
 * pairs widens the chance of "repairing" a genuinely different value into a
 * plausible-but-wrong one, which is worse than a clean parse failure.
 */
const DIGIT_LOOKALIKES = {
  З: '3', з: '3', Э: '3',
  О: '0', о: '0', O: '0', o: '0',
  І: '1', I: '1', l: '1', '|': '1',
  Ч: '4',
  б: '6', Б: '6',
  S: '5', s: '5',
};

const AMOUNT_RE = /^\d{1,3}(?:['’  ]\d{3})*[.,]\d{2}$|^\d+[.,]\d{2}$/;
const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/;
const INN_RE = /^\d{10}$|^\d{12}$/;
const CARD_MASK_RE = /^\*{2,6}\d{4}$/;
const ID_RE = /^\d{4,20}$/;

/** Map lookalike glyphs to digits. Internal — never call this on free text. */
function mapGlyphs(token) {
  let out = '';
  for (const ch of token) out += DIGIT_LOOKALIKES[ch] || ch;
  return out;
}

/**
 * Core repair primitive. Returns the token if it already matches, else attempts
 * a single glyph-mapped repair, else null (caller routes to manual review).
 */
function repairToken(raw, pattern) {
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  if (!token) return null;

  // Guard 2: already valid — return untouched, never "repair" a good value.
  if (pattern.test(token)) return { value: token, repaired: false };

  // Guard 3: no real digit anywhere means this is not a numeric token.
  // Kills "ЗАО", "ООО", "ЗЗЗ" before any substitution can happen.
  if (!/[0-9]/.test(token)) return null;

  const candidate = mapGlyphs(token);
  if (candidate === token) return null; // nothing to repair; genuinely malformed
  if (pattern.test(candidate)) return { value: candidate, repaired: true };

  return null;
}

function review(field, raw, reason) {
  return { ok: false, field, raw, reason };
}

/** Free text — vendor, address, cashier. NO character substitution, ever. */
function normalizeText(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim();
}

/** "З'980.00" -> 3980.00 (repaired). "2'690.00" -> 2690.00 (clean). */
function parseAmount(raw) {
  const r = repairToken(raw, AMOUNT_RE);
  if (!r) return review('amount', raw, 'unparseable_amount');
  const numeric = r.value.replace(/['’  ]/g, '').replace(',', '.');
  const value = Number(numeric);
  if (!Number.isFinite(value)) return review('amount', raw, 'non_finite_amount');
  return { ok: true, field: 'amount', value, repaired: r.repaired, raw };
}

/** "25.08.2026" / "25.08.26" -> ISO date, with real calendar validation. */
function parseDate(raw, { pivot = 70 } = {}) {
  const r = repairToken(raw, DATE_RE);
  if (!r) return review('date', raw, 'unparseable_date');

  const m = r.value.match(DATE_RE);
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (m[3].length === 2) year += year <= pivot ? 2000 : 1900;

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return review('date', raw, 'invalid_calendar_date');
  }

  return {
    ok: true,
    field: 'date',
    value: d.toISOString().slice(0, 10),
    repaired: r.repaired,
    raw,
  };
}

/** Official ФНС control-digit algorithm for 10- and 12-digit ИНН. */
function innChecksumValid(inn) {
  const d = inn.split('').map(Number);
  const check = (coeffs, upTo) => {
    let sum = 0;
    for (let i = 0; i < coeffs.length; i++) sum += coeffs[i] * d[i];
    return (sum % 11) % 10 === d[upTo];
  };
  if (inn.length === 10) {
    return check([2, 4, 10, 3, 5, 9, 4, 6, 8], 9);
  }
  return (
    check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8], 10) &&
    check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8], 11)
  );
}

/** ИНН — repaired, then checksum-validated. A bad checksum goes to review. */
function parseInn(raw) {
  const r = repairToken(raw, INN_RE);
  if (!r) return review('inn', raw, 'unparseable_inn');
  if (!innChecksumValid(r.value)) return review('inn', raw, 'inn_checksum_failed');
  return { ok: true, field: 'inn', value: r.value, repaired: r.repaired, raw };
}

/** "****5353" -> last 4 digits. Never returns a full PAN. */
function parseCardMask(raw) {
  const r = repairToken(raw, CARD_MASK_RE);
  if (!r) return review('card_mask', raw, 'unparseable_card_mask');
  return {
    ok: true,
    field: 'card_mask',
    value: r.value.slice(-4),
    repaired: r.repaired,
    raw,
  };
}

/** TID / MID / RRN / КОД.АВТ — plain digit ids. */
function parseId(raw, field = 'id') {
  const r = repairToken(raw, ID_RE);
  if (!r) return review(field, raw, 'unparseable_id');
  return { ok: true, field, value: r.value, repaired: r.repaired, raw };
}

/**
 * Parse a whole extracted receipt. `fields` is the field-typed output of your
 * extraction step — the typing is what routes each value to the right parser
 * and keeps text away from the repair path entirely.
 *
 * Returns { ok, data, repairs, review } — `review` non-empty means a human
 * looks at it before anything is written to the CRM.
 */
function parseReceipt(fields) {
  const PARSERS = {
    amount: parseAmount,
    date: parseDate,
    inn: parseInn,
    card_mask: parseCardMask,
    tid: (v) => parseId(v, 'tid'),
    mid: (v) => parseId(v, 'mid'),
    rrn: (v) => parseId(v, 'rrn'),
    auth_code: (v) => parseId(v, 'auth_code'),
  };
  const TEXT_FIELDS = new Set(['vendor', 'address', 'cashier', 'raw_text']);

  const data = {};
  const repairs = [];
  const needsReview = [];

  for (const [key, raw] of Object.entries(fields || {})) {
    if (TEXT_FIELDS.has(key)) {
      data[key] = normalizeText(raw); // never character-substituted
      continue;
    }
    const parser = PARSERS[key];
    if (!parser) {
      data[key] = raw; // unknown field — pass through untouched
      continue;
    }
    const result = parser(raw);
    if (result.ok) {
      data[key] = result.value;
      if (result.repaired) repairs.push({ field: key, raw, value: result.value });
    } else {
      data[key] = null;
      needsReview.push(result);
    }
  }

  return { ok: needsReview.length === 0, data, repairs, review: needsReview };
}

module.exports = {
  DIGIT_LOOKALIKES,
  normalizeText,
  parseAmount,
  parseDate,
  parseInn,
  parseCardMask,
  parseId,
  parseReceipt,
  innChecksumValid,
  repairToken,
};
