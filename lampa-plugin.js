// == Dorama Plugin for Lampa — топ-100 дорам с doramclub.ru ==
(function () {
  'use strict';

  var BASE_URL = '__BASE_URL__' || '';
  var SOURCE_NAME = 'DoramClub';
  var ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#ff9800"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

  function log(m) { try { console.log('[Dorama] ' + m); } catch (e) {} }

  // ====== Api.sources — для списка категорий ======
  function DoramclubApiService() {
    var self = this;
    self.network = new Lampa.Reguest();
    self.get = function (u, cb, eb) { self.network.silent(u, cb, eb); };

    self.normalizeItem = function (item) {
      if (!item) item = {};
      var poster = item.poster_path || item.poster || item.img || '';
      if (poster && poster.charAt(0) === '/') poster = 'https://doramclub.ru' + poster;
      var id = item.id || 0;
      if (!id) { try { id = Lampa.Utils.hash(item.url || item.title || ''); } catch (e) { id = 1; } }
      return {
        id: id || 1, title: item.title || '', name: item.title || '',
        original_title: item.original_title || item.original_name || '',
        original_name: item.original_title || item.original_name || '',
        poster_path: '', img: poster, poster: poster, backdrop_path: poster,
        overview: item.overview || item.description || '',
        vote_average: item.vote_average || 0, type: 'tv', media_type: 'tv',
        first_air_date: item.first_air_date || (item.year ? item.year + '-01-01' : ''),
        release_date: item.first_air_date || (item.year ? item.year + '-01-01' : ''),
        number_of_seasons: 1, number_of_episodes: item.number_of_episodes || 0,
        year: item.year || '', url: item.url || '', source: SOURCE_NAME,
        genres: [], seasons: []
      };
    };

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

  // ====== Компонент: страница дорамы (с TMDB поиском) ======
  Lampa.Component.add('dorama_detail', function () {
    this.html = $('<div class="dorama-detail-root"></div>');
    var self = this;

    this.create = function () {
      var card =
        (this.activity && this.activity.card) ||
        (this.activity && this.activity.params && this.activity.params.card) ||
        (typeof window.__dorama_card !== 'undefined' ? window.__dorama_card : {}) || {};
      try { window.__dorama_card = null; } catch (e) {}
      var title = card.original_title || card.title || '';
      var url = card.url || '';

      self.html.html('<div style="padding:60px;text-align:center;color:#aaa;font-size:18px">Поиск в TMDB...</div>');
      try { Lampa.Controller.toggle('content'); } catch (e) {}

      if (!title && !url) { self.fallbackSearch(title); return; }

      var api = Lampa.Api.sources.doramclub;
      if (!api || !api.get) { self.fallbackSearch(title); return; }

      api.get(BASE_URL + '/api/tmdb/search?title=' + encodeURIComponent(title) + '&url=' + encodeURIComponent(url), function (json) {
        if (json && json.id) {
          try {
            Lampa.Activity.replace({
              component: 'full', id: json.id,
              card: { id: json.id, title: json.title || json.name || title },
              source: 'tmdb', method: json.type || 'tv'
            });
          } catch (e) { self.fallbackSearch(title); }
        } else {
          self.fallbackSearch(title);
        }
      }, function () { self.fallbackSearch(title); });
    };

    this.fallbackSearch = function (query) {
      if (!query) { try { Lampa.Activity.backward(); } catch (e) {} return; }
      log('fallback search: ' + query);

      // 1. TMDB proxy search
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
                component: 'full', id: first.id,
                card: { id: first.id, title: first.name || first.title || query },
                source: 'tmdb', method: first.media_type || 'tv'
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
        Lampa.Search.open({ query: query });

        // Через 1.5с отправляем Enter в поле поиска
        setTimeout(function () {
          try {
            var inputs = document.querySelectorAll('input');
            for (var i = 0; i < inputs.length; i++) {
              var inp = inputs[i];
              if (inp.offsetParent !== null || inp.getBoundingClientRect) {
                inp.value = query; inp.focus();
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
              }
            }
          } catch (e) {}

          // Ждём новые карточки (результаты поиска)
          var beforeCount = document.querySelectorAll('.card.selector').length;
          var found = false;
          var pt = setInterval(function () {
            if (found) return;
            try {
              var cards = document.querySelectorAll('.card.selector');
              if (cards.length <= beforeCount) return;
              found = true; clearInterval(pt);
              var nc = cards[beforeCount];
              try { nc.classList.add('focus'); } catch (e) {}
              setTimeout(function () {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
              }, 500);
            } catch (e) {}
          }, 800);
          setTimeout(function () { clearInterval(pt); }, 8000);
        }, 1500);
      } catch (e) {}
    }

    this.render = function (js) { return js ? this.html : $(this.html); };
    this.start = function () {
      Lampa.Controller.add('content', {
        toggle: function () { Lampa.Controller.collectionSet(self.html[0]); Lampa.Controller.collectionFocus(false, self.html[0]); },
        left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
        up: function () { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
        down: function () { Navigator.move('down'); },
        right: function () { Navigator.move('right'); },
        back: function () { Lampa.Activity.backward(); }
      });
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
      var s = Object.assign({}, (Lampa.Params.values && Lampa.Params.values['source']) ? Lampa.Params.values['source'] : {});
      s[SOURCE_NAME] = SOURCE_NAME;
      Lampa.Params.select('source', s, 'tmdb');
    } catch (e) {}

    var mi = $('<li data-action="doramclub" class="menu__item selector">' +
      '<div class="menu__ico">' + ICON + '</div><div class="menu__text">' + SOURCE_NAME + '</div></li>');
    $('.menu .menu__list').eq(0).append(mi);
    mi.on('hover:enter', function () {
      Lampa.Activity.push({ title: SOURCE_NAME, component: 'category', source: SOURCE_NAME, page: 1, url: '' });
    });

    log('plugin loaded');
  }

  if (window.appready) startPlugin();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') startPlugin(); });

  // CSS
  $('head').append('<style>' +
    '.dorama-detail-root{height:100%;overflow-y:auto;background:#141414}' +
    '.dd-wrap{position:relative;min-height:100%}' +
    '.dd-bg{position:absolute;inset:0;background-size:cover;background-position:center}' +
    '.dd-bgo{position:absolute;inset:0;background:linear-gradient(90deg,rgba(20,20,20,1) 0,rgba(20,20,20,0.9) 60%,rgba(20,20,20,0.7) 100%)}' +
    '.dd-inner{position:relative;z-index:1;padding:30px}' +
    '.dd-top{display:flex;gap:30px;align-items:flex-start}' +
    '.dd-pcol{flex-shrink:0}' +
    '.dd-img{width:260px;height:390px;border-radius:8px;object-fit:cover;display:block}' +
    '.dcol{flex:1;color:#eee}' +
    '.dd-title{font-size:26px;font-weight:700;color:#fff;margin-bottom:4px}' +
    '.dd-orig{font-size:14px;color:#999;margin-bottom:12px}' +
    '.dd-tags{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}' +
    '.dd-tag{background:rgba(255,255,255,0.1);padding:4px 12px;border-radius:4px;font-size:13px;color:#ccc}' +
    '.dd-overview{font-size:14px;line-height:1.6;color:#bbb;margin-bottom:24px;max-width:700px}' +
    '.dd-acts{display:flex;gap:12px}' +
    '.dd-btn{padding:12px 28px;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer;outline:none}' +
    '.dd-btn[data-do=watch]{background:#ff9800;color:#141414}' +
    '.dd-btn[data-do=watch].focus{box-shadow:0 0 0 3px #ffb74d}' +
    '.dd-btn[data-do=back]{background:rgba(255,255,255,0.1);color:#eee}' +
    '.dd-btn[data-do=back].focus{box-shadow:0 0 0 3px rgba(255,255,255,0.3)}' +
  '</style>');
})()
