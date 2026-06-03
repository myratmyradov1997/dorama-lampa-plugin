#!/bin/bash
# Запуск backend-сервера для Dorama Lampa Plugin
cd "$(dirname "$0")"
source venv/bin/activate
exec python3 server.py
