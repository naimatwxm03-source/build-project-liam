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
SOURCE = REPO / "builds/vk-adapter/normalize-vk.js"
TARGET_NODE = "Normalize VK Event"

# Workflows carrying the adapter's Code node. Add new builds here.
WORKFLOWS = [
    "builds/vk-adapter/vk-echo.workflow.json",
    "builds/01-receipt-bot/workflow.json",
]

GLUE = """
// ---------------------------------------------------------------------------
// n8n glue. Everything above is builds/vk-adapter/normalize-vk.js, injected by
// sync-code-node.py. Do not edit it here — edit the source and re-run the sync.
// ---------------------------------------------------------------------------
return $input.all().map((item) => ({
  json: normalizeVkEvent(item.json.body !== undefined ? item.json.body : item.json),
}));
"""


def build_code() -> str:
    src = SOURCE.read_text(encoding="utf-8")
    # The CommonJS export is for the test runner; n8n's sandbox has no `module`.
    src = re.sub(
        r"\nif \(typeof module !== 'undefined'.*?\n\}\n",
        "\n",
        src,
        flags=re.DOTALL,
    )
    return src.rstrip() + "\n" + GLUE


def main() -> int:
    check_only = "--check" in sys.argv
    code = build_code()
    drifted, touched = [], []

    for rel in WORKFLOWS:
        path = REPO / rel
        if not path.exists():
            print(f"  skip   {rel} (not created yet)")
            continue

        wf = json.loads(path.read_text(encoding="utf-8"))
        nodes = [n for n in wf.get("nodes", []) if n.get("name") == TARGET_NODE]
        if not nodes:
            print(f"  skip   {rel} (no node named {TARGET_NODE!r})")
            continue

        changed = False
        for node in nodes:
            if node["parameters"].get("jsCode") != code:
                node["parameters"]["jsCode"] = code
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
