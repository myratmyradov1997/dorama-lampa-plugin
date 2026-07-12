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
- ▶️ **Online-просмотр с DoramyClub.pro** — прямой стриминг эпизодов с выбором озвучки и автовыбором наилучшего качества (1080p → 144p)
- 🎮 Единая штатная навигация Lampa для пульта, мыши и сенсорного экрана
- 🔁 Автовосстановление потока: HLS → резервный MP4 → обновление CDN-ссылки
- 🛡️ Видеопрокси с allowlist CDN, Range, HLS rewriting и повторным подключением

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
| `GET /api/doramyclub/info?url=...` | Плейлист эпизодов и озвучек для online-просмотра |
| `GET /api/doramyclub/stream?vk_id=...` | Stream-ссылки (HLS/MP4/DASH) для плеера |
| `GET /online.js` | JS-плагин online-просмотра для Lampa |
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
- **Online-стриминг с DoramyClub.pro** — выбор озвучки, список эпизодов, автовыбор HLS или наилучшего MP4 (1080p → 144p)

### ⚠️ Ограничения
- **Нет TMDB ID у дорам** — doramclub.ru не предоставляет TMDB ID, ищем по названию
- **Некоторые дорамы не находятся в TMDB** — открывается поиск Lampa (обычно находятся по другим названиям)
- **doramy.club/top-months недоступен** — сайт отдаёт 403/Cloudflare, поэтому используются рабочие альтернативы: doramyclub.pro и dorama.land
- **Выбор результата поиска выполняет пользователь** — запрос передаётся через штатный `Lampa.Search.open({input})`, без синтетических нажатий

## Online-просмотр

Для дорам из каталога **DoramyClub.pro** появляется кнопка **«▶ Смотреть онлайн»**. Работает так:

1. Выбираете дораму в каталоге → клик
2. Вместо сраза TMDB-поиска появляется выбор:
   - **«Открыть в Lampa»** — стандартный поиск TMDB
   - **«▶ Смотреть онлайн»** — прямой стриминг с doramyclub.pro
3. Выбираете озвучку (если доступно несколько)
4. Выбираете эпизод
5. Видео запускается через адаптивный HLS; MP4 используется как резерв и для ручного выбора качества

Технически:
- Backend парсит страницу doramyclub.pro, извлекает `title_id` из плеера
- Запрашивает плейлист у CDN Video Hub → получает список эпизодов и озвучек
- По `vk_id` получает прямые ссылки HLS/MP4/DASH
- Lampa плеер получает готовый URL для воспроизведения
- При фатальной ошибке Lampa сначала переключается на резервный MP4, затем обновляет подписанную CDN-ссылку и продолжает с сохранённой позиции

## Production-запуск

`start.sh` запускает приложение через Gunicorn на порту `5100` (по умолчанию 2 процесса × 8 потоков). Настройки можно переопределить переменными `DORAMA_PORT`, `DORAMA_WORKERS`, `DORAMA_THREADS`, `DORAMA_TIMEOUT`.

Готовый unit находится в `deploy/dorama-proxy.service`; он запускает `start.sh`, сохраняет существующий `.env` и пишет stdout/stderr в `server.log`.

Видеопрокси принимает только домены из `VIDEO_PROXY_HOST_SUFFIXES` (по умолчанию `okcdn.ru,mycdn.me,cdnvideohub.com`). Таймауты и число переподключений задаются через `VIDEO_CONNECT_TIMEOUT`, `VIDEO_READ_TIMEOUT`, `VIDEO_STREAM_RETRIES`.

## Проверка

```bash
python3 -m unittest discover -s tests -v
node --check lampa-plugin.js
node --check dorama-online.js
bash -n start.sh
```

## Файлы проекта

```
dorama-proxy/
├── lampa-plugin.js    # JS-плагин каталога для Lampa
├── dorama-online.js   # JS-плагин online-просмотра для Lampa
├── server.py          # Python/Flask backend
├── start.sh           # Скрипт запуска
├── requirements.txt   # Python зависимости
└── README.md
```

## Лицензия

MIT
