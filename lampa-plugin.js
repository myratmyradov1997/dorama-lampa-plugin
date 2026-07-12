// == Dorama Plugin for Lampa — кастомная сетка топов дорам ==
(function () {
  'use strict';

  var BASE_URL = '__BASE_URL__';
  if (BASE_URL.indexOf('__BASE' + '_URL__') >= 0) BASE_URL = '';

  var SOURCE_NAME = 'DoramClub';
  var ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#ff9800"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

  function log(m) { try { console.log('[Dorama] ' + m); } catch (e) {} }

  function activateContent(root) {
    try {
      Lampa.Controller.collectionSet(root[0]);
      Lampa.Controller.collectionFocus(false, root[0]);
      Lampa.Controller.toggle('content');
    } catch (e) { log('controller activation failed: ' + e.message); }
  }

  function loadOnlinePlugin(attempt) {
    attempt = attempt || 0;
    if (window.dorama_online_plugin || window.__dorama_online_loading) return;

    window.__dorama_online_loading = true;
    var script = document.createElement('script');
    script.src = BASE_URL + '/online.js?v=2';
    script.async = true;
    script.onload = function () {
      window.__dorama_online_loading = false;
      log('online plugin loaded');
    };
    script.onerror = function () {
      window.__dorama_online_loading = false;
      if (attempt < 3) {
        log('online plugin retry ' + (attempt + 1));
        setTimeout(function () { loadOnlinePlugin(attempt + 1); }, 1000 * (attempt + 1));
      } else {
        log('online plugin load failed');
      }
    };
    document.head.appendChild(script);
  }

  function openOnlineCard(card, attempt) {
    attempt = attempt || 0;
    if (!window.dorama_online_plugin) {
      loadOnlinePlugin(0);
      if (attempt < 20) {
        if (attempt === 0) Lampa.Noty.show('Подготавливаю онлайн-плеер...');
        setTimeout(function () { openOnlineCard(card, attempt + 1); }, 250);
      } else {
        Lampa.Noty.show('Не удалось загрузить онлайн-плеер');
      }
      return;
    }

    try { window.__dorama_online_card = card; } catch (e) {}
    Lampa.Activity.push({
      component: 'dorama_online',
      title: card.title || 'Онлайн',
      card: card,
      params: { card: card },
    });
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (s) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s];
    });
  }

  function hashCode(value) {
    var str = String(value || 'dorama');
    var hash = 0;
    for (var i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
    return Math.abs(hash) || 1;
  }

  function posterOf(item) {
    return item.poster_path || item.poster || item.img || item.background_image || '';
  }

  function normalizeItem(item) {
    if (!item) item = {};
    var poster = posterOf(item);
    if (poster && poster.indexOf('/api/') === 0) poster = BASE_URL + poster;
    else if (poster && poster.charAt(0) === '/') poster = 'https://doramclub.ru' + poster;
    var id = item.id || hashCode(item.url || item.title || item.name || '');

    return {
      id: id,
      title: item.title || item.name || '',
      name: item.title || item.name || '',
      original_title: item.original_title || item.original_name || '',
      original_name: item.original_title || item.original_name || '',
      poster_path: '',
      img: poster,
      poster: poster,
      backdrop_path: poster,
      overview: item.overview || item.description || '',
      vote_average: item.vote_average || 0,
      type: 'tv',
      media_type: 'tv',
      first_air_date: item.first_air_date || (item.year ? item.year + '-01-01' : ''),
      release_date: item.first_air_date || (item.year ? item.year + '-01-01' : ''),
      number_of_seasons: 1,
      number_of_episodes: item.number_of_episodes || 0,
      year: item.year || '',
      url: item.url || '',
      status: item.status || '',
      catalog_source: item.source || '',
      source: SOURCE_NAME,
      genres: [],
      seasons: []
    };
  }

  // Api.sources оставляем для совместимости со стандартными компонентами Lampa.
  function DoramclubApiService() {
    var self = this;
    self.network = new Lampa.Reguest();
    self.get = function (u, cb, eb) { self.network.silent(u, cb, eb); };
    self.normalizeItem = normalizeItem;

    self.list = function (p, cb, eb) {
      self.get(BASE_URL + '/api/doramclub/top', function (j) {
        var r = (j.items || []).map(self.normalizeItem);
        cb({ results: r, page: 1, total_pages: 1, total_results: r.length });
      }, eb);
    };

    self.category = function (p, s, e) {
      self.list(p, function (j) {
        s([{ url: '', title: 'Топ-100 дорам', page: 1, total_results: j.total_results, total_pages: 1, more: false, results: j.results, source: SOURCE_NAME }]);
      }, e);
      return function (a, b) { b([]); };
    };

    self.full = function (p, s) { s(self.normalizeItem(p.card)); };
    self.main = function (p, c) { if (typeof c === 'function') c([]); };
  }

  // ====== Компонент: кастомная сетка топов ======
  Lampa.Component.add('dorama_grid', function () {
    var self = this;
    this.html = $('<div class="dorama-grid-root"></div>');
    this.cards = [];

    this.create = function () {
      self.renderLoading('Загружаю топы дорам...');

      var network = new Lampa.Reguest();
      network.silent(BASE_URL + '/api/dorama/sections', function (json) {
        self.renderSections(json && json.sections ? json.sections : []);
      }, function () {
        self.renderError('Не удалось загрузить топы. Проверьте сервер или интернет.');
      });
    };

    this.renderLoading = function (text) {
      self.html.html('<div class="dg-state"><div class="dg-spinner"></div><div>' + escapeHtml(text) + '</div></div>');
    };

    this.renderError = function (text) {
      self.html.html('<div class="dg-state dg-error"><div class="dg-error-title">Ошибка</div><div>' + escapeHtml(text) + '</div></div>');
    };

    this.renderSections = function (sections) {
      self.cards = [];

      var visibleSections = (sections || []).filter(function (section) {
        return section && section.items && section.items.length;
      });

      if (!visibleSections.length) {
        self.renderError('Сайты не отдали ни одной дорамы.');
        return;
      }

      var total = 0;
      visibleSections.forEach(function (section) { total += section.items.length; });

      var html = '';
      html += '<div class="dg-page">';
      html += '<div class="dg-hero">';
      html += '<div class="dg-kicker">Для удобного просмотра на ТВ</div>';
      html += '<div class="dg-title">Топы дорам</div>';
      html += '<div class="dg-subtitle">Сначала популярное Dorama.land, затем DoramyClub.pro и DoramClub в одной кастомной сетке.</div>';
      html += '<div class="dg-badges"><span>' + total + ' карточек</span><span>TMDB + поиск Lampa</span></div>';
      html += '</div>';

      visibleSections.forEach(function (section) {
        html += '<section class="dg-section">';
        html += '<div class="dg-section-head"><div class="dg-section-title">' + escapeHtml(section.title || 'Дорамы') + '</div><div class="dg-count">' + section.items.length + '</div></div>';
        html += '<div class="dg-grid">';

        section.items.forEach(function (raw, index) {
          var card = normalizeItem(raw);
          var globalIndex = self.cards.length;
          self.cards.push(card);

          var poster = posterOf(card);
          var title = card.title || card.name || 'Без названия';
          var meta = [];
          if (card.year) meta.push(card.year);
          if (card.status) meta.push(card.status);
          if (card.number_of_episodes) meta.push(card.number_of_episodes + ' сер.');
          if (card.overview && meta.length < 2) meta.push(card.overview);

          html += '<div class="dg-card selector" data-index="' + globalIndex + '">';
          html += '<div class="dg-rank">' + (index + 1) + '</div>';
          if (poster) html += '<img class="dg-poster" src="' + escapeHtml(poster) + '" loading="lazy" alt="' + escapeHtml(title) + '">';
          else html += '<div class="dg-poster dg-poster-empty"><span>Нет постера</span></div>';
          html += '<div class="dg-card-title">' + escapeHtml(title) + '</div>';
          html += '<div class="dg-card-meta">' + escapeHtml(meta.join(' • ')) + '</div>';
          html += '</div>';
        });

        html += '</div>';
        html += '</section>';
      });

      html += '</div>';
      self.html.html(html);

      self.html.find('.dg-card').off('hover:enter click').on('hover:enter click', function () {
        self.openCardElement(this);
      });

      try {
        Lampa.Controller.collectionSet(self.html[0]);
        Lampa.Controller.collectionFocus(false, self.html[0]);
      } catch (e) {}
    };

    this.render = function (js) { return js ? this.html : $(this.html); };

    this.openCardElement = function (element) {
      var $card = $(element).closest('.dg-card');
      if (!$card.length) return;

      var index = parseInt($card.attr('data-index'), 10);
      var card = self.cards[index];
      if (!card) return;

      try { window.__dorama_card = card; } catch (e) {}
      Lampa.Activity.push({
        component: 'dorama_detail',
        title: card.title || SOURCE_NAME,
        source: SOURCE_NAME,
        card: card,
        params: { card: card }
      });
    };

    this.scrollToFocused = function () {
      var focused = self.html.find('.dg-card.focus').eq(0);
      if (!focused.length) return;

      var card = focused[0];
      var root = self.html[0];
      if (!card || !root) return;

      try {
        var cardRect = card.getBoundingClientRect();
        var rootRect = root.getBoundingClientRect();
        var padding = 80;

        if (cardRect.top < rootRect.top + padding) {
          root.scrollTop -= (rootRect.top + padding - cardRect.top);
        } else if (cardRect.bottom > rootRect.bottom - padding) {
          root.scrollTop += (cardRect.bottom - (rootRect.bottom - padding));
        }

        if (typeof card.scrollIntoView === 'function') {
          card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      } catch (e) {}
    };

    this.afterMove = function () {
      setTimeout(function () { self.scrollToFocused(); }, 40);
      setTimeout(function () { self.scrollToFocused(); }, 160);
    };

    this.start = function () {
      Lampa.Controller.add('content', {
        toggle: function () { Lampa.Controller.collectionSet(self.html[0]); Lampa.Controller.collectionFocus(false, self.html[0]); self.afterMove(); },
        left: function () { if (Navigator.canmove('left')) { Navigator.move('left'); self.afterMove(); } else Lampa.Controller.toggle('menu'); },
        up: function () { if (Navigator.canmove('up')) { Navigator.move('up'); self.afterMove(); } else Lampa.Controller.toggle('head'); },
        down: function () { Navigator.move('down'); self.afterMove(); },
        right: function () { Navigator.move('right'); self.afterMove(); },
        back: function () { Lampa.Activity.backward(); }
      });
      Lampa.Controller.toggle('content');
    };

    this.destroy = function () {
      this.html.remove();
    };
  });

  // ====== Компонент: страница дорамы (TMDB поиск + fallback) ======
  Lampa.Component.add('dorama_detail', function () {
    this.html = $('<div class="dorama-detail-root"></div>');
    var self = this;

    this.create = function () {
      var card =
        (this.activity && this.activity.card) ||
        (this.activity && this.activity.params && this.activity.params.card) ||
        (typeof window.__dorama_card !== 'undefined' ? window.__dorama_card : {}) || {};
      try { window.__dorama_card = null; } catch (e) {}

      var title = card.title || card.name || '';
      var originalTitle = card.original_title || card.original_name || '';
      var fallbackTitle = title || originalTitle;
      var url = card.url || '';

      // Если есть URL DoramyClub.pro — показываем выбор: Lampa или онлайн
      if (url && url.indexOf('doramyclub.pro') !== -1) {
        self.renderChoice(card, fallbackTitle);
        return;
      }

      self.searchTmdb(card, fallbackTitle);
    };

    this.renderChoice = function (card, fallbackTitle) {
      self.currentCard = card;
      self.currentFallbackTitle = fallbackTitle;
      self.screenMode = 'choice';

      var html = '<div class="dg-page">';
      html += '<div class="dg-hero">';
      html += '<div class="dg-title">' + escapeHtml(card.title || 'Дорама') + '</div>';
      html += '<div class="dg-subtitle">Выберите действие</div>';
      html += '</div>';
      html += '<div class="dg-grid">';
      html += '<div class="dg-card selector choice-tmdb" data-action="tmdb"><div class="dg-card-title">Открыть в Lampa</div><div class="dg-card-meta">Поиск в TMDB</div></div>';
      html += '<div class="dg-card selector choice-online" data-action="online"><div class="dg-card-title">▶ Смотреть онлайн</div><div class="dg-card-meta">DoramyClub.pro</div></div>';
      html += '</div></div>';

      self.html.html(html);

      // Обработчики для hover:enter (TV/пульт) и click (мышь)
      self.html.find('.choice-tmdb').off('hover:enter click').on('hover:enter click', function () {
        self.searchTmdb(card, fallbackTitle);
      });

      self.html.find('.choice-online').off('hover:enter click').on('hover:enter click', function () {
        openOnlineCard(card);
      });

      // Устанавливаем фокус для навигации с пульта
      try {
        Lampa.Controller.collectionSet(self.html[0]);
        Lampa.Controller.collectionFocus(false, self.html[0]);
      } catch (e) {}
    };

    this.searchTmdb = function (card, fallbackTitle) {
      var title = card.title || card.name || '';
      var originalTitle = card.original_title || card.original_name || '';
      var url = card.url || '';

      self.html.html('<div class="dg-state"><div class="dg-spinner"></div><div>Поиск в TMDB...</div></div>');
      try { Lampa.Controller.toggle('content'); } catch (e) {}

      if (!fallbackTitle && !url) { self.fallbackSearch(fallbackTitle); return; }

      var api = Lampa.Api.sources.doramclub;
      if (!api || !api.get) { self.fallbackSearch(fallbackTitle); return; }

      var tmdbUrl = BASE_URL + '/api/tmdb/search?title=' + encodeURIComponent(title) + '&original_title=' + encodeURIComponent(originalTitle) + '&url=' + encodeURIComponent(url);
      api.get(tmdbUrl, function (json) {
        if (json && json.id) {
          try {
            Lampa.Activity.replace({
              component: 'full',
              id: json.id,
              card: { id: json.id, title: json.title || json.name || fallbackTitle },
              source: 'tmdb',
              method: json.type || 'tv'
            });
          } catch (e) { self.fallbackSearch(fallbackTitle); }
        } else {
          self.fallbackSearch(fallbackTitle);
        }
      }, function () { self.fallbackSearch(fallbackTitle); });
    };

    this.fallbackSearch = function (query) {
      if (!query) { try { Lampa.Activity.backward(); } catch (e) {} return; }
      log('fallback search: ' + query);

      try {
        var proxyBase = 'http://tmdbapi.bylampa.online';
        try { var stored = Lampa.Storage.get('tmdb_proxy_api', ''); if (stored) proxyBase = stored; } catch (e) {}
        var searchUrl = proxyBase + '/3/search/multi?query=' + encodeURIComponent(query) + '&language=ru';
        var req = new Lampa.Reguest();
        req.silent(searchUrl, function (json) {
          if (json && json.results && json.results.length > 0 && json.results[0].id) {
            var first = json.results[0];
            try {
              Lampa.Activity.replace({
                component: 'full',
                id: first.id,
                card: { id: first.id, title: first.name || first.title || query },
                source: 'tmdb',
                method: first.media_type || 'tv'
              });
              return;
            } catch (e) {}
          }
          openSearchFallback(query);
        }, function () { openSearchFallback(query); });
      } catch (e) { openSearchFallback(query); }
    };

    function openSearchFallback(query) {
      log('openSearchFallback: ' + query);
      try {
        Lampa.Search.open({
          input: query,
          onBack: function () { try { Lampa.Controller.toggle('content'); } catch (e) {} }
        });
      } catch (e) {
        log('search open failed: ' + e.message);
        try { Lampa.Controller.toggle('content'); } catch (ignore) {}
      }
    }

    this.render = function (js) { return js ? this.html : $(this.html); };
    this.start = function () {
      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(self.html[0]);
          Lampa.Controller.collectionFocus(false, self.html[0]);
        },
        left: function () {
          if (Navigator.canmove('left')) Navigator.move('left');
          else Lampa.Controller.toggle('menu');
        },
        up: function () {
          if (Navigator.canmove('up')) Navigator.move('up');
          else Lampa.Controller.toggle('head');
        },
        down: function () { Navigator.move('down'); },
        right: function () { Navigator.move('right'); },
        back: function () { Lampa.Activity.backward(); }
      });
      activateContent(self.html);
    };
    this.destroy = function () { this.html.remove(); };
  });

  // ====== Запуск ======
  function startPlugin() {
    if (window.doramclub_plugin) return;
    window.doramclub_plugin = true;

    var api = new DoramclubApiService();
    Lampa.Api.sources.doramclub = api;
    Lampa.Api.sources[SOURCE_NAME] = api;

    var pu = Lampa.Activity.push, rp = Lampa.Activity.replace;
    Lampa.Activity.push = function (p) {
      if (p && p.component === 'full' && p.source === SOURCE_NAME) {
        p.component = 'dorama_detail';
        try { window.__dorama_card = p.card; } catch (e) {}
      }
      return pu.call(this, p);
    };
    Lampa.Activity.replace = function (p) {
      if (p && p.component === 'full' && p.source === SOURCE_NAME) {
        p.component = 'dorama_detail';
        try { window.__dorama_card = p.card; } catch (e) {}
      }
      return rp.call(this, p);
    };

    try {
      var s = Object.assign({}, (Lampa.Params.values && Lampa.Params.values.source) ? Lampa.Params.values.source : {});
      s[SOURCE_NAME] = SOURCE_NAME;
      Lampa.Params.select('source', s, 'tmdb');
    } catch (e) {}

    var mi = $('<li data-action="doramclub" class="menu__item selector">' +
      '<div class="menu__ico">' + ICON + '</div><div class="menu__text">' + SOURCE_NAME + '</div></li>');
    $('.menu .menu__list').eq(0).append(mi);
    mi.on('hover:enter', function () {
      Lampa.Activity.push({ title: SOURCE_NAME, component: 'dorama_grid', source: SOURCE_NAME, page: 1 });
    });

    log('plugin loaded');
    loadOnlinePlugin(0);
  }

  if (window.appready) startPlugin();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') startPlugin(); });

  $('head').append('<style>' +
    '.dorama-grid-root,.dorama-detail-root{height:100%;overflow-y:auto;background:#101014;color:#fff}' +
    '.dg-page{padding:2.4em 2.8em 4em;background:radial-gradient(circle at 15% 0,rgba(255,152,0,.18),transparent 34em),linear-gradient(180deg,#15151c,#0d0d11)}' +
    '.dg-hero{margin-bottom:2.2em;max-width:58em}' +
    '.dg-kicker{display:inline-block;margin-bottom:.8em;padding:.35em .7em;border:1px solid rgba(255,152,0,.35);border-radius:999px;color:#ffb74d;font-size:.85em}' +
    '.dg-title{font-size:3.2em;font-weight:800;line-height:1;margin-bottom:.22em;letter-spacing:-.03em}' +
    '.dg-subtitle{font-size:1.15em;color:#c6c6d2;line-height:1.45;max-width:46em}' +
    '.dg-badges{display:flex;gap:.7em;flex-wrap:wrap;margin-top:1.1em}' +
    '.dg-badges span{padding:.45em .75em;border-radius:.55em;background:rgba(255,255,255,.08);color:#e8e8ef;font-size:.9em}' +
    '.dg-section{margin-top:2.5em}' +
    '.dg-section-head{display:flex;align-items:center;gap:.8em;margin-bottom:1em}' +
    '.dg-section-title{font-size:1.45em;font-weight:700}' +
    '.dg-count{padding:.25em .55em;border-radius:.45em;background:#ff9800;color:#111;font-weight:700;font-size:.85em}' +
    '.dg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(9.5em,1fr));gap:1.2em}' +
    '.dg-card{position:relative;min-width:0;cursor:pointer;border-radius:.9em;padding:.45em;background:rgba(255,255,255,.045);transition:transform .15s ease,background .15s ease,box-shadow .15s ease}' +
    '.dg-card.focus{transform:translateY(-.35em) scale(1.035);background:rgba(255,152,0,.18);box-shadow:0 0 0 .18em #ff9800,0 1em 2.4em rgba(0,0,0,.35)}' +
    '.dg-poster{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:.65em;display:block;background:#222}' +
    '.dg-poster-empty{display:flex;align-items:center;justify-content:center;color:#777;text-align:center;font-size:.9em}' +
    '.dg-rank{position:absolute;left:.7em;top:.7em;z-index:2;min-width:2em;height:2em;border-radius:999px;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:.9em}' +
    '.dg-card-title{font-size:.98em;font-weight:700;line-height:1.22;margin-top:.7em;min-height:2.35em;color:#fff;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
    '.dg-card-meta{font-size:.78em;color:#aaa;margin-top:.35em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.dg-state{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1em;color:#cfcfd8;font-size:1.15em;text-align:center;padding:2em}' +
    '.dg-spinner{width:2.6em;height:2.6em;border:.22em solid rgba(255,255,255,.16);border-top-color:#ff9800;border-radius:50%;animation:dg-spin .8s linear infinite}' +
    '.dg-error-title{font-size:1.5em;font-weight:800;color:#ffb74d}' +
    '@keyframes dg-spin{to{transform:rotate(360deg)}}' +
    '@media(max-width:700px){.dg-page{padding:1.3em}.dg-title{font-size:2.2em}.dg-grid{grid-template-columns:repeat(auto-fill,minmax(7.4em,1fr));gap:.85em}}' +
  '</style>');
})();
