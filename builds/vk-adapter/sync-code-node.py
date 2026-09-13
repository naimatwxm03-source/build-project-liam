#!/usr/bin/env python3
"""Inject normalize-vk.js into the Code node of every VK workflow in this repo.

normalize-vk.js is the single source of truth and is unit-tested. n8n Code nodes
store their JavaScript as a string inside workflow.json, which means the logic
would otherwise exist in two places and drift the moment one is edited.

Run this after any change to normalize-vk.js, and commit both files together:

    python3 builds/vk-adapter/sync-code-node.py
    node --test builds/vk-adapter/

Exits non-zero if a workflow is already in sync with nothing to do only when
--check is passed, so CI can assert the two never drift.
"""

import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]

# Workflows to keep in sync. Add new builds here.
WORKFLOWS = [
    "builds/vk-adapter/vk-echo.workflow.json",
    "builds/01-receipt-bot/workflow.json",
]

VK_GLUE = """
// ---------------------------------------------------------------------------
// n8n glue. Everything above is injected by sync-code-node.py from the source
// named below. Do not edit it here — edit the source and re-run the sync.
//   source: builds/vk-adapter/normalize-vk.js
// ---------------------------------------------------------------------------
return $input.all().map((item) => ({
  json: normalizeVkEvent(item.json.body !== undefined ? item.json.body : item.json),
}));
"""

OCR_GLUE = """
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
"""

VALIDATE_GLUE = """
// ---------------------------------------------------------------------------
//   source: builds/01-receipt-bot/normalize.js
//
// The model extracts; this validates. Anything that fails its pattern becomes a
// review record with a stated reason — never a zero, never a silent drop, never
// an automated rejection.
// ---------------------------------------------------------------------------
const envelope = $('Normalize VK Event').first().json;

/** The model is asked for JSON but can still wrap it in prose or a fence. */
function parseModelJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw == null ? '' : raw);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

return $input.all().map((item) => {
  const src = item.json;
  const extracted = parseModelJson(src.text !== undefined ? src.text : src);

  if (!extracted) {
    return { json: {
      ...envelope,
      needs_review: true,
      review_reason: 'Модель вернула не-JSON — проверьте вручную',
      vendor: '', expense_date: null, total: null, currency: 'RUB',
      category: 'прочее', confidence: 0,
      items: [], items_json: '[]', items_count: 0, items_total: 0, items_reconciled: null,
      raw_text: String(src.text == null ? '' : src.text).slice(0, 2000),
    }};
  }

  // Several slips in one photo is a real case (seen in the test corpus). Never
  // silently log one of them as "the" expense.
  if (extracted.multiple_receipts === true) {
    return { json: {
      ...envelope,
      needs_review: true,
      review_reason: 'На фото несколько чеков — отправьте по одному',
      vendor: '', expense_date: null, total: null, currency: 'RUB',
      category: 'прочее', confidence: 0,
      items: [], items_json: '[]', items_count: 0, items_total: 0, items_reconciled: null,
      raw_text: (extracted.raw_text || '').slice(0, 2000),
    }};
  }

  const checked = parseReceipt({
    vendor: extracted.vendor || '',
    amount: extracted.total == null ? '' : String(extracted.total),
    date: extracted.expense_date || '',
  });

  const parsedItems = parseItems(extracted.items, checked.data.amount);

  const reasons = [];
  let dateAssumed = false;
  let expenseDate = checked.data.date || null;

  for (const r of checked.review) {
    // Many receipts print the date in a fiscal block people crop out of the
    // photo. Refusing the whole expense over that trains users to stop sending
    // receipts. Fall back to the day the photo was sent, record that the date
    // is an assumption, and keep the row flagged so a human can correct it.
    // This is an assumption made in the open, not an invented value.
    if (r.field === 'date') {
      expenseDate = String(envelope.ts || '').slice(0, 10) || null;
      dateAssumed = true;
      reasons.push('дата не найдена — поставил дату отправки');
      continue;
    }
    reasons.push(`${r.field}: ${r.reason}`);
  }

  // A receipt states its own total. If the lines do not add up to it, OCR lost
  // one or the model invented one — flag rather than trust.
  for (const p of parsedItems.problems) reasons.push(p);

  const confidence = Number(extracted.confidence);

  return { json: {
    ...envelope,
    vendor: checked.data.vendor || '',
    expense_date: expenseDate,
    date_assumed: dateAssumed,
    total: checked.data.amount == null ? null : checked.data.amount,
    currency: extracted.currency || 'RUB',
    category: extracted.category || 'прочее',
    confidence: Number.isFinite(confidence) ? confidence : 0,
    needs_review: reasons.length > 0,
    review_reason: reasons.join('; '),
    items: parsedItems.items,
    items_json: JSON.stringify(parsedItems.items),
    items_count: parsedItems.items.length,
    items_total: parsedItems.itemsTotal,
    items_reconciled: parsedItems.reconciled,
    repairs: checked.repairs.map((r) => `${r.field}: ${r.raw} -> ${r.value}`).join('; '),
    raw_text: (extracted.raw_text || '').slice(0, 2000),
  }};
});
"""

# node name -> (source file, glue appended after it)
NODE_SOURCES = {
    "Normalize VK Event": ("builds/vk-adapter/normalize-vk.js", VK_GLUE),
    "OCR To Text": ("builds/01-receipt-bot/ocr-text.js", OCR_GLUE),
    "Validate Receipt": ("builds/01-receipt-bot/normalize.js", VALIDATE_GLUE),
}


def build_code(source_rel: str, glue: str) -> str:
    src = (REPO / source_rel).read_text(encoding="utf-8")
    # The CommonJS export is for the test runner; n8n's sandbox has no `module`.
    src = re.sub(
        r"\nif \(typeof module !== 'undefined'.*?\n\}\n",
        "\n",
        src,
        flags=re.DOTALL,
    )
    src = re.sub(r"\nmodule\.exports = \{.*?\n\};\n", "\n", src, flags=re.DOTALL)
    return src.rstrip() + "\n" + glue


PASTE_DIR = REPO / "builds/01-receipt-bot/node-code"


def write_paste_copies(codes: dict) -> None:
    """Emit each Code node's contents as a standalone .js file.

    Re-importing a workflow wipes the credentials selected in the UI, so for a
    live instance the cheap update path is: open the raw file, select all, paste
    over the node's editor. These files exist purely for that.
    """
    PASTE_DIR.mkdir(parents=True, exist_ok=True)
    for name, code in codes.items():
        slug = name.lower().replace(" ", "-")
        (PASTE_DIR / f"{slug}.node.js").write_text(code, encoding="utf-8")


def main() -> int:
    check_only = "--check" in sys.argv
    codes = {name: build_code(rel, glue) for name, (rel, glue) in NODE_SOURCES.items()}
    if not check_only:
        write_paste_copies(codes)
    drifted, touched = [], []

    for rel in WORKFLOWS:
        path = REPO / rel
        if not path.exists():
            print(f"  skip   {rel} (not created yet)")
            continue

        wf = json.loads(path.read_text(encoding="utf-8"))
        nodes = [n for n in wf.get("nodes", []) if n.get("name") in codes]
        if not nodes:
            print(f"  skip   {rel} (no synced Code nodes)")
            continue

        changed = False
        for node in nodes:
            want = codes[node["name"]]
            if node["parameters"].get("jsCode") != want:
                node["parameters"]["jsCode"] = want
                changed = True

        if not changed:
            print(f"  ok     {rel}")
            continue

        drifted.append(rel)
        if check_only:
            print(f"  DRIFT  {rel}")
        else:
            path.write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            touched.append(rel)
            print(f"  synced {rel}")

    if check_only and drifted:
        print(f"\n{len(drifted)} workflow(s) out of sync with normalize-vk.js.", file=sys.stderr)
        print("Run: python3 builds/vk-adapter/sync-code-node.py", file=sys.stderr)
        return 1

    print(f"\n{len(touched)} updated." if touched else "\nAll in sync.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
