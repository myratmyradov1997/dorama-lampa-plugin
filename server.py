import os
import re
import json
import time
import logging
import hashlib
from io import BytesIO
from html import unescape
from urllib.parse import urlparse, quote

import requests
from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS

try:
    from PIL import Image
except ImportError:
    Image = None

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
DORAMYCLUB_PRO = 'https://doramyclub.pro'
DORAMALAND = 'https://dorama.land'

# ====== Helpers ======

def to_full_url(path_or_url, base=DORAMCLUB):
    if not path_or_url:
        return ''
    if path_or_url.startswith('http'):
        return path_or_url
    return base.rstrip('/') + '/' + path_or_url.lstrip('/')


def clean_text(value):
    value = re.sub(r'<[^>]+>', ' ', value or '')
    return re.sub(r'\s+', ' ', unescape(value)).strip()


def get_attr(tag, name):
    m = re.search(name + r'=["\']([^"\']+)', tag or '')
    return m.group(1) if m else ''


def stable_id(value):
    digest = hashlib.md5((value or 'dorama').encode('utf-8')).hexdigest()
    return int(digest[:8], 16)


def dedupe_items(items):
    seen = set()
    result = []
    for item in items:
        key = (item.get('url') or item.get('title') or '').lower()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def app_url(path):
    try:
        return request.host_url.rstrip('/') + path
    except RuntimeError:
        return path

# ====== DORAMCLUB.RU ======

def get_doramclub_top():
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
        url = to_full_url(link)
        items.append({
            'id': stable_id(url),
            'title': m.group(3).strip(),
            'url': url,
            'poster': to_full_url(img_url),
            'source': 'doramclub',
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

    return items


@app.route('/api/doramclub/top')
def doramclub_top():
    items = get_doramclub_top()
    return jsonify({'source': 'doramclub', 'items': items, 'count': len(items)})


def get_doramyclub_pro_best():
    resp = SESSION.get(f'{DORAMYCLUB_PRO}/best.html', timeout=15)
    resp.encoding = 'utf-8'
    html = resp.text

    items = []
    blocks = re.findall(r'<section class="post-list">(.*?)</section>', html, re.DOTALL)
    for block in blocks:
        link_m = re.search(r'<div class="img-link">\s*(<a\b[^>]*>(.*?)</a>)', block, re.DOTALL)
        if not link_m:
            continue

        link_tag = link_m.group(1).split('>', 1)[0]
        link_inner = link_m.group(2)
        url = to_full_url(get_attr(link_tag, 'href'), DORAMYCLUB_PRO)

        img_tag_m = re.search(r'<img\b[^>]*>', link_inner, re.DOTALL)
        img_tag = img_tag_m.group(0) if img_tag_m else ''
        poster = get_attr(img_tag, 'data-src') or get_attr(img_tag, 'src')
        poster = to_full_url(poster, DORAMYCLUB_PRO)

        title_m = re.search(r'<span>(.*?)</span>', link_inner, re.DOTALL)
        title = clean_text(title_m.group(1) if title_m else '')
        if not title:
            title = clean_text(get_attr(img_tag, 'alt')).replace('Дорама ', '')

        original_m = re.search(r'<em>(.*?)</em>', block, re.DOTALL)
        original_title = clean_text(original_m.group(1) if original_m else '')

        meta_values = [clean_text(v) for v in re.findall(r'<u>(.*?)</u>', block, re.DOTALL)]
        meta = ' • '.join([v for v in meta_values if v])
        year = ''
        year_m = re.search(r'(19\d{2}|20\d{2})', meta or clean_text(block))
        if year_m:
            year = year_m.group(1)

        episodes = 0
        episodes_m = re.search(r'Сериал:\s*</span>\s*(\d+)\s*сер', block, re.DOTALL)
        if episodes_m:
            episodes = int(episodes_m.group(1))

        status_m = re.search(r'<div class="status">(.*?)</div>', block, re.DOTALL)
        status = clean_text(status_m.group(1) if status_m else '')

        if title and url:
            items.append({
                'id': stable_id(url),
                'title': title,
                'original_title': original_title,
                'url': url,
                'poster': poster,
                'year': year,
                'first_air_date': year + '-01-01' if year else '',
                'number_of_episodes': episodes,
                'status': status,
                'description': meta,
                'source': 'doramyclub_pro',
            })

    return dedupe_items(items)


@app.route('/api/doramyclub-pro/best')
def doramyclub_pro_best():
    items = get_doramyclub_pro_best()
    return jsonify({'source': 'doramyclub_pro', 'items': items, 'count': len(items)})


def get_doramaland_popular():
    resp = SESSION.get(DORAMALAND, timeout=15)
    resp.encoding = 'utf-8'
    html = resp.text

    items = []
    pattern = re.compile(r'<a\b(?=[^>]*class="[^"]*navigation-popular-serial)[^>]*>(.*?)</a>', re.DOTALL)
    for m in pattern.finditer(html):
        full_link = m.group(0)
        link_tag = full_link.split('>', 1)[0]
        block = m.group(1)

        url = to_full_url(get_attr(link_tag, 'href'), DORAMALAND)
        title = clean_text(get_attr(link_tag, 'title'))

        name_m = re.search(r'<div class="navigation-popular-serial__name">(.*?)</div>', block, re.DOTALL)
        if name_m:
            title = clean_text(name_m.group(1)) or title

        img_tag_m = re.search(r'<img\b[^>]*>', block, re.DOTALL)
        img_tag = img_tag_m.group(0) if img_tag_m else ''
        poster = get_attr(img_tag, 'data-src') or get_attr(img_tag, 'src')
        if poster.startswith('data:image'):
            poster = ''
        poster = to_full_url(poster, DORAMALAND)
        if poster:
            poster = app_url('/api/image?url=' + quote(poster, safe=''))

        appends = [clean_text(v) for v in re.findall(r'<div class="navigation-popular-serial__append">(.*?)</div>', block, re.DOTALL)]
        year = ''
        genres = ''
        for value in appends:
            if re.fullmatch(r'\d{4}', value):
                year = value
            elif value and not genres:
                genres = value

        if title and url:
            items.append({
                'id': stable_id(url),
                'title': title,
                'url': url,
                'poster': poster,
                'year': year,
                'first_air_date': year + '-01-01' if year else '',
                'description': genres,
                'source': 'doramaland',
            })

    return dedupe_items(items)


@app.route('/api/doramaland/popular')
def doramaland_popular():
    items = get_doramaland_popular()
    return jsonify({'source': 'doramaland', 'items': items, 'count': len(items)})


@app.route('/api/image')
def image_proxy():
    image_url = request.args.get('url', '').strip()
    if not image_url:
        return jsonify({'error': 'url required'}), 400

    parsed = urlparse(image_url)
    allowed_hosts = {'dorama.land', 'www.dorama.land', '6.doramaland.center'}
    if parsed.scheme not in {'http', 'https'} or parsed.netloc not in allowed_hosts:
        return jsonify({'error': 'host not allowed'}), 400

    try:
        resp = SESSION.get(
            image_url,
            headers={
                'Referer': DORAMALAND + '/',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            },
            timeout=15,
        )
        resp.raise_for_status()
    except Exception as e:
        logger.error('image proxy error for %s: %s', image_url, e)
        return jsonify({'error': 'image fetch failed'}), 502

    content_type = (resp.headers.get('Content-Type') or 'image/jpeg').split(';')[0].strip().lower()
    content = resp.content

    # Media Station X / старые TV WebView часто не показывают WebP, поэтому отдаём JPEG.
    if Image and (content_type == 'image/webp' or parsed.path.lower().endswith('.webp')):
        try:
            image = Image.open(BytesIO(content)).convert('RGB')
            buffer = BytesIO()
            image.save(buffer, format='JPEG', quality=88, optimize=True)
            content = buffer.getvalue()
            content_type = 'image/jpeg'
        except Exception as e:
            logger.error('image convert error for %s: %s', image_url, e)

    response = Response(content, mimetype=content_type)
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Cache-Control'] = 'public, max-age=86400'
    return response


@app.route('/api/dorama/sections')
def dorama_sections():
    sections = []

    sources = [
        ('doramaland_popular', 'Популярное сейчас Dorama.land', get_doramaland_popular),
        ('doramyclub_best', 'Лучшие DoramyClub.pro', get_doramyclub_pro_best),
        ('doramclub_top', 'Топ-100 DoramClub', get_doramclub_top),
    ]

    for key, title, loader in sources:
        try:
            items = loader()
            sections.append({
                'key': key,
                'title': title,
                'items': items,
                'count': len(items),
            })
        except Exception as e:
            logger.error('section %s error: %s', key, e)
            sections.append({
                'key': key,
                'title': title,
                'items': [],
                'count': 0,
                'error': str(e),
            })

    return jsonify({'sections': sections, 'count': sum(len(s['items']) for s in sections)})


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
    original_title = request.args.get('original_title', '').strip()
    detail_url = request.args.get('url', '').strip()
    if not title and not original_title and not detail_url:
        return jsonify({'error': 'title or url required', 'id': None}), 400

    logger.info('TMDB search: title=%s original_title=%s url=%s', title, original_title, detail_url)

    # Собираем варианты для поиска (в порядке приоритета)
    queries = []
    if title:
        queries.append(title)  # исходное название (русское)
    if original_title and original_title not in queries:
        queries.append(original_title)

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


# ====== DORAMYCLUB.PRO STREAMING ======

CDN_API_PLAYLIST = "https://plapi.cdnvideohub.com/api/v1/player/sv/playlist"
CDN_API_VIDEO = "https://plapi.cdnvideohub.com/api/v1/player/sv/video"


def extract_episode_id_doramyclub(url_or_id):
    m = re.search(r'/(\d+)-[^/]+\.html', url_or_id)
    if m:
        return m.group(1), url_or_id
    if url_or_id.isdigit():
        return url_or_id, None
    m = re.search(r'/(\d+)', url_or_id)
    if m:
        return m.group(1), None
    return None, None


def fetch_page_data_doramyclub(episode_id, known_url=None):
    if known_url:
        url = known_url
    else:
        url = f"{DORAMYCLUB_PRO}/index.php?newsid={episode_id}"

    resp = SESSION.get(
        url,
        headers={
            **SESSION.headers,
            "Accept": "text/html,application/xhtml+xml",
        },
        allow_redirects=True,
        timeout=15,
    )
    resp.raise_for_status()
    html = resp.text

    player_data = None
    player_match = re.search(
        r'<video-player[^>]*data-title-id="(\d+)"[^>]*data-publisher-id="(\d+)"[^>]*data-aggregator="([^"]*)"',
        html,
    )

    if player_match:
        player_data = player_match.groups()
    else:
        player_match = re.search(r'data-title-id="(\d+)"', html)
        if player_match:
            title_id = player_match.group(1)
            pub_match = re.search(r'data-publisher-id="(\d+)"', html)
            pub_id = pub_match.group(1) if pub_match else "2256"
            aggr_match = re.search(r'data-aggregator="([^"]*)"', html)
            aggregator = aggr_match.group(1) if aggr_match else "mdl"
            player_data = (title_id, pub_id, aggregator)

    if player_data is None:
        return None

    # AJAX логирование (опционально)
    try:
        SESSION.post(
            f"{DORAMYCLUB_PRO}/engine/cdnvideohub/ajax.php",
            data={"id": episode_id},
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": resp.url,
            },
            timeout=5,
        )
    except Exception:
        pass

    page_title = ""
    title_match = re.search(r'<title>(.*?)</title>', html)
    if title_match:
        page_title = title_match.group(1)

    return {
        "title_id": player_data[0],
        "publisher_id": player_data[1],
        "aggregator": player_data[2],
        "news_id": episode_id,
        "page_url": resp.url,
        "page_title": page_title,
    }


def get_playlist_doramyclub(title_id, publisher_id, aggregator):
    resp = SESSION.get(
        CDN_API_PLAYLIST,
        params={"pub": publisher_id, "aggr": aggregator, "id": title_id},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def get_video_urls_doramyclub(vk_id):
    resp = SESSION.get(f"{CDN_API_VIDEO}/{vk_id}", timeout=15)
    resp.raise_for_status()
    data = resp.json()
    sources = data.get("sources", {})

    hls_url = sources.get("hlsUrl", "")
    if hls_url and hls_url.startswith("/"):
        dash_url = sources.get("dashUrl", "")
        if dash_url and dash_url.startswith("http"):
            parsed = urlparse(dash_url)
            hls_url = f"{parsed.scheme}://{parsed.netloc}{hls_url}"

    return {
        "hls": hls_url,
        "dash": sources.get("dashUrl", ""),
        "mp4_fullhd": sources.get("mpegFullHdUrl", ""),
        "mp4_high": sources.get("mpegHighUrl", ""),
        "mp4_medium": sources.get("mpegMediumUrl", ""),
        "mp4_low": sources.get("mpegLowUrl", ""),
        "mp4_lowest": sources.get("mpegLowestUrl", ""),
        "mp4_tiny": sources.get("mpegTinyUrl", ""),
        "duration": data.get("duration", 0),
    }


@app.route('/api/doramyclub/info')
def doramyclub_info():
    url = request.args.get('url', '').strip()
    if not url:
        return jsonify({'error': 'url required'}), 400

    episode_id, known_url = extract_episode_id_doramyclub(url)
    if not episode_id:
        return jsonify({'error': 'invalid url format'}), 400

    try:
        page_data = fetch_page_data_doramyclub(episode_id, known_url)
        if not page_data:
            return jsonify({'error': 'player data not found'}), 404

        playlist = get_playlist_doramyclub(
            page_data["title_id"],
            page_data["publisher_id"],
            page_data["aggregator"]
        )

        # Группируем эпизоды и озвучки
        items = playlist.get("items", [])
        episodes = {}

        for item in items:
            season = item.get("season", 1)
            episode = item.get("episode", 1)
            key = f"S{season:02d}E{episode:02d}"

            if key not in episodes:
                episodes[key] = {
                    "season": season,
                    "episode": episode,
                    "voice_studios": [],
                }

            episodes[key]["voice_studios"].append({
                "name": item.get("voiceStudio", "—"),
                "type": item.get("voiceType", ""),
                "vk_id": item.get("vkId", ""),
            })

        return jsonify({
            "title": playlist.get("titleName", ""),
            "is_serial": playlist.get("isSerial", False),
            "page_title": page_data["page_title"],
            "episodes": list(episodes.values()),
        })

    except Exception as e:
        logger.error('doramyclub info error: %s', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/doramyclub/stream')
def doramyclub_stream():
    vk_id = request.args.get('vk_id', '').strip()
    if not vk_id:
        return jsonify({'error': 'vk_id required'}), 400

    try:
        urls = get_video_urls_doramyclub(vk_id)

        # Определяем наилучшее качество
        quality_map = [
            ("1080p", urls.get("mp4_fullhd")),
            ("720p", urls.get("mp4_high")),
            ("480p", urls.get("mp4_medium")),
            ("360p", urls.get("mp4_low")),
            ("240p", urls.get("mp4_lowest")),
            ("144p", urls.get("mp4_tiny")),
        ]

        best_mp4 = None
        for quality, url in quality_map:
            if url:
                best_mp4 = {"quality": quality, "url": url}
                break

        return jsonify({
            "hls": urls.get("hls", ""),
            "dash": urls.get("dash", ""),
            "best_mp4": best_mp4,
            "qualities": {
                "1080p": urls.get("mp4_fullhd", ""),
                "720p": urls.get("mp4_high", ""),
                "480p": urls.get("mp4_medium", ""),
                "360p": urls.get("mp4_low", ""),
                "240p": urls.get("mp4_lowest", ""),
                "144p": urls.get("mp4_tiny", ""),
            },
            "duration": urls.get("duration", 0),
        })

    except Exception as e:
        logger.error('doramyclub stream error: %s', e)
        return jsonify({'error': str(e)}), 500


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
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp


@app.route('/online.js')
def serve_online_plugin():
    import os
    plugin_path = os.path.join(os.path.dirname(__file__), 'dorama-online.js')
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
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp


@app.route('/api/doramyclub/proxy')
def doramyclub_proxy():
    video_url = request.args.get('url', '').strip()
    if not video_url:
        return jsonify({'error': 'url required'}), 400

    try:
        resp = SESSION.get(
            video_url,
            headers={
                'User-Agent': '',
                'Accept': '*/*',
            },
            timeout=30,
            stream=True,
        )
        resp.raise_for_status()

        @stream_with_context
        def generate():
            for chunk in resp.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk

        response = Response(
            generate(),
            status=resp.status_code,
            mimetype=resp.headers.get('Content-Type', 'application/octet-stream'),
        )
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    except Exception as e:
        logger.error('doramyclub proxy error: %s', e)
        return jsonify({'error': str(e)}), 502


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5100, debug=False, threaded=True)
