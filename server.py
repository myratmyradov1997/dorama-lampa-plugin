import os
import re
import json
import time
import logging
from urllib.parse import urlparse, quote

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
})

DORAMCLUB = 'https://doramclub.ru'

# ====== Helpers ======

def to_full_url(path_or_url):
    if not path_or_url:
        return ''
    if path_or_url.startswith('http'):
        return path_or_url
    return DORAMCLUB + path_or_url

# ====== DORAMCLUB.RU ======

@app.route('/api/doramclub/top')
def doramclub_top():
    resp = SESSION.get(f'{DORAMCLUB}/lists.html', timeout=15)
    resp.encoding = 'utf-8'
    html = resp.text

    items = []
    pattern = re.compile(
        r'<div class="poster-item[^"]*"[^>]*>.*?'
        r'<img[^>]*data-src="([^"]+)"[^>]*>.*?'
        r'<a href="([^"]+)" class="poster-item__link[^"]*">\s*'
        r'<div class="poster-item__title[^"]*">([^<]+)</div>',
        re.DOTALL
    )
    for m in pattern.finditer(html):
        img_url = m.group(1)
        link = m.group(2)
        items.append({
            'title': m.group(3).strip(),
            'url': to_full_url(link),
            'poster': to_full_url(img_url),
        })

    year_map = {}
    yr_pat = re.compile(
        r'<a href="([^"]+)" class="poster-item__link[^"]*">.*?'
        r'icon-calendar-check[^>]*>(\d{4})</div>',
        re.DOTALL
    )
    for m in yr_pat.finditer(html):
        u = to_full_url(m.group(1))
        year_map[u] = m.group(2)

    for item in items:
        if item['url'] in year_map:
            item['year'] = year_map[item['url']]
            item['first_air_date'] = year_map[item['url']] + '-01-01'

    return jsonify({'source': 'doramclub', 'items': items, 'count': len(items)})


@app.route('/api/doramclub/detail')
def doramclub_detail():
    url = request.args.get('url')
    if not url:
        return jsonify({'error': 'url required'}), 400

    resp = SESSION.get(url, timeout=15)
    resp.encoding = 'utf-8'
    html = resp.text

    # title
    title = ''
    m = re.search(r'<h1[^>]*itemprop="name">([^<]+)</h1>', html)
    if m:
        title = m.group(1).strip()

    # original_title
    original_title = ''
    m = re.search(r'<div class="page__original"[^>]*itemprop="alternativeHeadline">([^<]+)</div>', html)
    if m:
        original_title = m.group(1).strip()

    # overview
    overview = ''
    m = re.search(r'<div class="page__text full-text[^"]*"[^>]*itemprop="description"><p>([^<]+)</p>', html)
    if m:
        overview = m.group(1).strip()

    # poster
    poster = ''
    m = re.search(r'<img[^>]*itemprop="image"[^>]*>', html)
    if m:
        src_m = re.search(r'src="([^"]+)"', m.group(0))
        if src_m:
            poster = to_full_url(src_m.group(1))

    # id из URL, например .../1146-1seonjaeeopgotwieo.html
    item_id = 0
    m = re.search(r'/(\d+)-[^/]*\.html', url)
    if m:
        item_id = int(m.group(1))

    # year
    year = ''
    m = re.search(r'<li><span>Год выхода:\s*</span>(\d{4})</li>', html)
    if m:
        year = m.group(1)

    # premiere -> first_air_date
    first_air_date = ''
    m = re.search(r'<li><span>Премьера:\s*</span>([^<]+)</li>', html)
    if m:
        premiere = m.group(1).strip()
        # пытаемся спарсить дату "8 апреля 2024"
        months = {
            'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
            'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
            'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
        }
        dm = re.search(r'(\d{1,2})\s+(\w+)\s+(\d{4})', premiere)
        if dm:
            day = dm.group(1).zfill(2)
            month = months.get(dm.group(2).lower(), '01')
            first_air_date = f"{dm.group(3)}-{month}-{day}"
        elif year:
            first_air_date = year + '-01-01'
    elif year:
        first_air_date = year + '-01-01'

    # number_of_episodes
    number_of_episodes = 0
    m = re.search(r'<li><span>Сериал:\s*</span>(\d+)\s*серий', html)
    if m:
        number_of_episodes = int(m.group(1))

    # site rating
    vote_average = 0
    m = re.search(r'class="page__stars-rating-score[^"]*">([\d.]+)</div>', html)
    if m:
        vote_average = float(m.group(1))

    # IMDB
    imdb = 0
    m = re.search(r'page__meta-item--imdb[^>]*>IMDB:\s*<span>([\d.]+)</span>', html)
    if m:
        imdb = float(m.group(1))

    # Kinopoisk
    kp = 0
    m = re.search(r'page__meta-item--kp[^>]*>Кинопоиск:\s*<span>([\d.]+)</span>', html)
    if m:
        kp = float(m.group(1))

    # status
    status = ''
    m = re.search(r'<div class="poster-item__label poster-item__label--status[^"]*">([^<]+)</div>', html)
    if m:
        status = m.group(1).strip()

    return jsonify({
        'id': item_id,
        'title': title,
        'original_title': original_title,
        'poster_path': poster,
        'img': poster,
        'poster': poster,
        'backdrop_path': '',
        'background_image': '',
        'overview': overview,
        'vote_average': vote_average or imdb or kp,
        'type': 'tv',
        'first_air_date': first_air_date,
        'number_of_seasons': 1 if number_of_episodes else 0,
        'number_of_episodes': number_of_episodes,
        'release_date': first_air_date,
        'original_language': 'ko',
        'status': status,
        'url': url,
        'year': year
    })


@app.route('/api/doramclub/play')
def doramclub_play():
    title_id = request.args.get('title_id')
    url = request.args.get('url')
    html = request.args.get('html')

    if not title_id and html:
        m = re.search(r'data-title-id="(\d+)"', html)
        if m:
            title_id = m.group(1)

    if not title_id and url:
        resp = SESSION.get(url, timeout=15)
        resp.encoding = 'utf-8'
        html = resp.text
        m = re.search(r'data-title-id="(\d+)"', html)
        if m:
            title_id = m.group(1)

    if not title_id:
        return jsonify({'error': 'title_id required. Pass ?title_id=X or ?html=... or ?url=...'}), 400

    pub_id = request.args.get('pub_id', '1608')
    aggr = request.args.get('aggr', 'mdl')

    return jsonify(get_cdnvideohub_playlist(title_id, pub_id, aggr))


# ====== TMDB Search Proxy ======

TMDB_API_KEY = os.environ.get('TMDB_API_KEY', '')

@app.route('/api/tmdb/search')
def tmdb_search():
    title = request.args.get('title', '').strip()
    detail_url = request.args.get('url', '').strip()
    if not title and not detail_url:
        return jsonify({'error': 'title or url required', 'id': None}), 400

    logger.info('TMDB search: title=%s url=%s', title, detail_url)

    # Собираем варианты для поиска (в порядке приоритета)
    queries = []
    if title:
        queries.append(title)  # исходное название (русское)

    # Если есть URL дорамы, пытаемся достать оригинальное название
    if detail_url:
        try:
            resp = SESSION.get(detail_url, timeout=15)
            resp.encoding = 'utf-8'
            html = resp.text
            m = re.search(r'<div class="page__original"[^>]*itemprop="alternativeHeadline">([^<]+)</div>', html)
            if m:
                orig = m.group(1).strip()
                if orig and orig not in queries:
                    queries.append(orig)  # оригинальное (корейское/английское)
            m = re.search(r'<h1[^>]*itemprop="name">([^<]+)</h1>', html)
            if m:
                name = m.group(1).strip()
                if name and name not in queries:
                    queries.append(name)
        except Exception as e:
            logger.error('Detail fetch error for orig title: %s', e)

    if not queries:
        return jsonify({'id': None, 'error': 'no queries'})

    # Пробуем каждый вариант, сначала TV, потом MOVIE
    for q in queries:
        for media_type in ['tv', 'movie']:
            try:
                url = f'https://api.themoviedb.org/3/search/{media_type}?api_key={TMDB_API_KEY}&query={quote(q)}&language=ru'
                resp = SESSION.get(url, timeout=10)
                data = resp.json()
                if data.get('results') and len(data['results']) > 0:
                    r = data['results'][0]
                    logger.info('TMDB found %s by [%s]: id=%d name=%s', media_type, q[:30], r['id'], r.get('name') or r.get('title', ''))
                    return jsonify({'id': r['id'], 'title': r.get('name') or r.get('title', ''), 'type': media_type})
            except Exception as e:
                logger.error('TMDB %s search error for [%s]: %s', media_type, q[:30], e)

    return jsonify({'id': None, 'error': 'not found'})


def get_cdnvideohub_playlist(title_id, pub_id, aggr):
    pl_resp = SESSION.get(
        f'https://plapi.cdnvideohub.com/api/v1/player/sv/playlist'
        f'?pub={pub_id}&aggr={aggr}&id={title_id}',
        timeout=10
    )
    playlist = pl_resp.json()

    result = {
        'title': playlist.get('titleName', ''),
        'is_serial': playlist.get('isSerial', False),
        'episodes': [],
    }

    for item in playlist.get('items', []):
        vk_id = item.get('vkId', '')
        if not vk_id:
            continue
        try:
            vr = SESSION.get(
                f'https://plapi.cdnvideohub.com/api/v1/player/sv/video/{vk_id}',
                timeout=10
            )
            vd = vr.json()
            src = vd.get('sources', {})
            result['episodes'].append({
                'season': item.get('season', 1),
                'episode': item.get('episode', 1),
                'voice': item.get('voiceStudio', '') or item.get('voiceType', ''),
                'hls': src.get('hlsUrl', ''),
                'dash': src.get('dashUrl', ''),
                'thumb': vd.get('thumbUrl', ''),
                'duration': vd.get('duration', 0),
            })
        except Exception as e:
            logger.error('vkId=%s error: %s', vk_id, e)

    return result


# ====== DORAMY.CLUB ======

@app.route('/api/doramyclub/top-months')
def doramyclub_top_months():
    return jsonify({
        'source': 'doramyclub',
        'error': 'cloudflare_protected',
        'message': 'Сайт защищён Cloudflare. Откройте в браузере: https://doramy.club/top-months',
        'direct_url': 'https://doramy.club/top-months',
    })


@app.route('/api/doramyclub/play')
def doramyclub_play():
    return jsonify({
        'error': 'cloudflare_protected',
        'message': 'Сайт защищён Cloudflare. Откройте страницу в браузере на TV',
        'note': 'Копируйте ссылку на фильм и откройте в браузере',
    })


# ====== HEALTH ======

@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'time': time.time()})


@app.route('/plugin.js')
def serve_plugin():
    import os
    plugin_path = os.path.join(os.path.dirname(__file__), 'lampa-plugin.js')
    with open(plugin_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Подставляем базовый URL сервера в плагин
    base_url = request.host_url.rstrip('/')
    content = content.replace('__BASE_URL__', base_url)

    resp = app.response_class(
        response=content,
        status=200,
        mimetype='application/javascript'
    )
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Cache-Control'] = 'no-cache, max-age=300'
    return resp


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5100, debug=False, threaded=True)
