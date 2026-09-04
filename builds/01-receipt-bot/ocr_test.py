#!/usr/bin/env python3
"""
Send every image in test-receipts/ to Yandex Vision OCR, save raw JSON
responses to ocr-results/, and print recognized text per image.

Usage: python3 ocr_test.py
Reads YANDEX_API_KEY and YANDEX_CLOUD_FOLDER_ID from ../../.env
"""
import base64
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

BUILD_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BUILD_DIR.parent.parent
ENV_PATH = PROJECT_ROOT / ".env"
IMAGES_DIR = BUILD_DIR / "test-receipts"
RESULTS_DIR = BUILD_DIR / "ocr-results"
OCR_URL = "https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".pdf"}


def load_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def call_ocr(image_bytes: bytes, api_key: str, folder_id: str) -> dict:
    content_b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "folderId": folder_id,
        "analyze_specs": [
            {
                "content": content_b64,
                "features": [
                    {
                        "type": "TEXT_DETECTION",
                        "text_detection_config": {"language_codes": ["ru", "en"]},
                    }
                ],
            }
        ],
    }
    req = urllib.request.Request(
        OCR_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Api-Key {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {body}") from e


def extract_full_text(response: dict) -> str:
    lines = []
    try:
        results = response["results"][0]["results"][0]["textDetection"]["pages"]
    except (KeyError, IndexError, TypeError):
        return ""
    for page in results:
        for block in page.get("blocks", []):
            for line in block.get("lines", []):
                words = [w.get("text", "") for w in line.get("words", [])]
                lines.append(" ".join(words))
    return "\n".join(lines)


def main():
    env = load_env(ENV_PATH)
    api_key = os.environ.get("YANDEX_API_KEY") or env.get("YANDEX_API_KEY")
    folder_id = os.environ.get("YANDEX_CLOUD_FOLDER_ID") or env.get("YANDEX_CLOUD_FOLDER_ID")

    if not api_key or not folder_id:
        print("ERROR: YANDEX_API_KEY and/or YANDEX_CLOUD_FOLDER_ID not found in .env", file=sys.stderr)
        sys.exit(1)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    images = sorted(
        p for p in IMAGES_DIR.iterdir() if p.suffix.lower() in IMAGE_EXTS
    )
    if not images:
        print(f"No images found in {IMAGES_DIR}", file=sys.stderr)
        sys.exit(1)

    for image_path in images:
        print("=" * 70)
        print(f"Image: {image_path.name}")
        print("=" * 70)
        try:
            response = call_ocr(image_path.read_bytes(), api_key, folder_id)
        except Exception as e:
            print(f"OCR request failed: {e}")
            continue

        out_path = RESULTS_DIR / f"{image_path.stem}.json"
        out_path.write_text(json.dumps(response, ensure_ascii=False, indent=2))
        print(f"Raw JSON saved: {out_path}")

        text = extract_full_text(response)
        print("\n--- Recognized text ---")
        print(text if text else "(no text detected)")
        print()


if __name__ == "__main__":
    main()
