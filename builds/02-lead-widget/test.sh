#!/bin/sh
# Все проверки Build 2 одной командой. Запускается из любого каталога.
set -e
cd "$(dirname "$0")"
node --test ./*.test.js
python3 make-workflow.py --check
python3 ingest-kb.py --dry-run > /dev/null && echo "kb/faq.md режется без ошибок"
