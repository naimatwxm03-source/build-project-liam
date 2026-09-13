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
      raw_text: (extracted.raw_text || '').slice(0, 2000),
    }};
  }

  const checked = parseReceipt({
    vendor: extracted.vendor || '',
    amount: extracted.total == null ? '' : String(extracted.total),
    date: extracted.expense_date || '',
  });

  const reasons = checked.review.map((r) => `${r.field}: ${r.reason}`);
  const confidence = Number(extracted.confidence);

  return { json: {
    ...envelope,
    vendor: checked.data.vendor || '',
    expense_date: checked.data.date || null,
    total: checked.data.amount == null ? null : checked.data.amount,
    currency: extracted.currency || 'RUB',
    category: extracted.category || 'прочее',
    confidence: Number.isFinite(confidence) ? confidence : 0,
    needs_review: reasons.length > 0,
    review_reason: reasons.join('; '),
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


def main() -> int:
    check_only = "--check" in sys.argv
    codes = {name: build_code(rel, glue) for name, (rel, glue) in NODE_SOURCES.items()}
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
