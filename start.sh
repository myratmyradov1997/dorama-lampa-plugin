#!/bin/bash
# Запуск backend-сервера для Dorama Lampa Plugin
set -euo pipefail
cd "$(dirname "$0")"
source venv/bin/activate
exec gunicorn \
  --bind "0.0.0.0:${DORAMA_PORT:-5100}" \
  --workers "${DORAMA_WORKERS:-2}" \
  --threads "${DORAMA_THREADS:-8}" \
  --timeout "${DORAMA_TIMEOUT:-0}" \
  --access-logfile - \
  --error-logfile - \
  server:app
