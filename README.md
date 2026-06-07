# Dorama Plugin for Lampa

Моя жена очень любит смотреть корейские дорамы. На телевизоре через Lampa нет нормального отбора по популярным дорамам — только стандартные TMDB-категории. Поэтому я сделал плагин, который собирает популярные дорамы из нескольких источников и показывает их прямо в Lampa в кастомной сетке. Это первая попытка сделать что-то с Lampa, вышло вполне приемлемо, могло бы быть лучше, но для начала и так сойдёт.

## Возможности

- 🎬 **Кастомная сетка** с постерами, секциями и удобной навигацией с пульта
- 📌 **Популярное сейчас Dorama.land** из блока «Популярное» на dorama.land
- 📌 **Лучшие DoramyClub.pro** с doramyclub.pro/best.html
- 📌 **Топ-100 DoramClub** с doramclub.ru
- 🖼️ Постеры Dorama.land проксируются через backend и конвертируются из WebP в JPEG для старых TV/WebView
- 🔍 **Автопоиск в TMDB** — при клике на дораму ищет её через TMDB по названию или оригинальному названию
- 📺 Если найдена в TMDB — открывается **стандартная страница фильма** Lampa с актёрами, описанием, кнопкой «Смотреть»
- 🔄 Если не найдена в TMDB — открывается **поиск Lampa** с автозаполнением и результатами из CUB

## Как это работает

```
Меню Lampa → DoramClub → кастомная сетка топов
    ↓
Клик на дораму → поиск TMDB ID через сервер
    ↓
  ┌── Нашёлся? ──┐
  ↓               ↓
  Да              Нет
  ↓               ↓
Стандартный full  Поиск Lampa
через TMDB        (автоматический)
```

## Установка

### Backend-сервер

```bash
pip install flask flask-cors Pillow requests
python3 server.py
```

Сервер запустится на порту 5100. Убедитесь что порт открыт в firewall.

В переменной окружения `TMDB_API_KEY` укажите ваш API-ключ TMDB (получить: https://www.themoviedb.org/settings/api).

### Плагин в Lampa

1. **Настройки → Расширения → Добавить расширение**
2. URL: `http://IP_ВАШЕГО_СЕРВЕРА:5100/plugin.js`
3. **Перезапустить Lampa**

В боковом меню появится пункт **DoramClub**.

## API Endpoints

| Endpoint | Описание |
|----------|----------|
| `GET /plugin.js` | JS-плагин для Lampa |
| `GET /api/dorama/sections` | Все секции для кастомной сетки |
| `GET /api/doramclub/top` | Топ-100 дорам |
| `GET /api/doramyclub-pro/best` | Лучшие дорамы с DoramyClub.pro |
| `GET /api/doramaland/popular` | Популярное сейчас с Dorama.land |
| `GET /api/image?url=...` | Прокси постеров Dorama.land с WebP → JPEG |
| `GET /api/doramclub/detail?url=...` | Детали дорамы |
| `GET /api/tmdb/search?title=...&url=...` | Поиск TMDB ID |
| `GET /api/doramclub/play?url=...` | Плейлист CDNVideoHub |
| `GET /api/health` | Проверка сервера |

## Что работает / не работает

### ✅ Работает
- Кастомная сетка с несколькими секциями
- 12 популярных дорам из блока Dorama.land
- 100 лучших дорам с doramyclub.pro
- Список 100 дорам с doramclub.ru
- Постеры Dorama.land через image proxy с конвертацией WebP в JPEG
- Поиск TMDB ID по названию
- Для найденных в TMDB — стандартный `full` компонент Lampa
- Для ненайденных — поиск Lampa с автозаполнением

### ⚠️ Ограничения
- **Нет TMDB ID у дорам** — doramclub.ru не предоставляет TMDB ID, ищем по названию
- **Некоторые дорамы не находятся в TMDB** — открывается поиск Lampa (обычно находятся по другим названиям)
- **doramy.club/top-months недоступен** — сайт отдаёт 403/Cloudflare, поэтому используются рабочие альтернативы: doramyclub.pro и dorama.land
- **Автооткрытие первого результата** поиска — карточка находится, но программный `hover:enter` не отрабатывает (нужно нажать Enter вручную)

## Файлы проекта

```
dorama-proxy/
├── lampa-plugin.js    # JS-плагин для Lampa
├── server.py          # Python/Flask backend
├── start.sh           # Скрипт запуска
├── requirements.txt   # Python зависимости
└── README.md
```

## Лицензия

MIT
