// == Dorama Online Plugin for Lampa — стриминг с DoramyClub.pro ==
(function () {
  'use strict';

  var BASE_URL = '__BASE_URL__';
  if (BASE_URL.indexOf('__BASE' + '_URL__') >= 0) BASE_URL = '';

  var SOURCE_NAME = 'DoramyClub';

  function log(m) { try { console.log('[DoramaOnline] ' + m); } catch (e) {} }

  function proxyUrl(url) {
    return url ? BASE_URL + '/api/doramyclub/proxy?url=' + encodeURIComponent(url) : '';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (s) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s];
    });
  }

  // ====== API ======

  function apiInfo(url, onSuccess, onError) {
    var network = new Lampa.Reguest();
    network.silent(
      BASE_URL + '/api/doramyclub/info?url=' + encodeURIComponent(url),
      onSuccess,
      onError
    );
  }

  function apiStream(vkId, onSuccess, onError) {
    var network = new Lampa.Reguest();
    network.silent(
      BASE_URL + '/api/doramyclub/stream?vk_id=' + encodeURIComponent(vkId),
      onSuccess,
      onError
    );
  }

  // ====== Компонент: Online просмотр ======
  Lampa.Component.add('dorama_online', function () {
    var self = this;
    this.html = $('<div class="dorama-online-root"></div>');

    var card =
      (this.activity && this.activity.card) ||
      (this.activity && this.activity.params && this.activity.params.card) ||
      (typeof window.__dorama_online_card !== 'undefined' ? window.__dorama_online_card : {}) || {};
    try { window.__dorama_online_card = null; } catch (e) {}

    var sourceUrl = card.url || '';
    var playlistData = null;
    var selectedVoice = null;

    this.refreshSelectors = function () {
      try {
        Lampa.Controller.collectionSet(self.html[0]);
        Lampa.Controller.collectionFocus(false, self.html[0]);
      } catch (e) { log('selector refresh failed: ' + e.message); }
    };

    this.create = function () {
      self.html.html('<div class="dg-state"><div class="dg-spinner"></div><div>Загрузка плейлиста...</div></div>');

      if (!sourceUrl) {
        self.renderError('Нет URL источника. Откройте дораму из каталога DoramyClub/DoramClub.');
        return;
      }

      apiInfo(sourceUrl, function (json) {
        playlistData = json;
        self.renderVoiceSelect();
      }, function () {
        self.renderError('Не удалось загрузить плейлист. Проверьте интернет или попробуйте позже.');
      });
    };

    this.renderError = function (text) {
      self.html.html('<div class="dg-state dg-error"><div class="dg-error-title">Ошибка</div><div>' + escapeHtml(text) + '</div></div>');
    };

    // Экран выбора озвучки
    this.renderVoiceSelect = function () {
      if (!playlistData || !playlistData.episodes || !playlistData.episodes.length) {
        self.renderError('Плейлист пуст или не содержит эпизодов.');
        return;
      }

      // Собираем уникальные озвучки
      var voices = {};
      playlistData.episodes.forEach(function (ep) {
        ep.voice_studios.forEach(function (v) {
          if (!voices[v.name]) voices[v.name] = v;
        });
      });

      var voiceList = Object.keys(voices);

      // Если только одна озвучка — сразу показываем эпизоды
      if (voiceList.length <= 1) {
        selectedVoice = voiceList[0] || null;
        self.renderEpisodes();
        return;
      }

      var html = '<div class="dg-page">';
      html += '<div class="dg-hero">';
      html += '<div class="dg-title">' + escapeHtml(playlistData.title || 'Дорама') + '</div>';
      html += '<div class="dg-subtitle">Выберите озвучку</div>';
      html += '</div>';

      html += '<section class="dg-section">';
      html += '<div class="dg-grid">';

      voiceList.forEach(function (voice, index) {
        var v = voices[voice];
        html += '<div class="dg-card selector voice-card" data-index="' + index + '">';
        html += '<div class="dg-card-title">' + escapeHtml(voice) + '</div>';
        if (v.type) html += '<div class="dg-card-meta">' + escapeHtml(v.type) + '</div>';
        html += '</div>';
      });

      html += '</div></section></div>';
      self.html.html(html);

      self.html.find('.voice-card').off('hover:enter click').on('hover:enter click', function () {
        var index = parseInt($(this).attr('data-index'), 10);
        selectedVoice = voiceList[index];
        self.renderEpisodes();
      });
      self.refreshSelectors();
    };

    // Экран выбора эпизода
    this.renderEpisodes = function () {
      if (!playlistData || !playlistData.episodes) return;

      var html = '<div class="dg-page">';
      html += '<div class="dg-hero">';
      html += '<div class="dg-title">' + escapeHtml(playlistData.title || 'Дорама') + '</div>';
      html += '<div class="dg-subtitle">' + (selectedVoice ? escapeHtml(selectedVoice) : '') + '</div>';
      html += '</div>';

      html += '<section class="dg-section">';
      html += '<div class="dg-section-head"><div class="dg-section-title">Эпизоды</div><div class="dg-count">' + playlistData.episodes.length + '</div></div>';
      html += '<div class="dg-grid">';

      playlistData.episodes.forEach(function (ep, index) {
        var epTitle = 'S' + (ep.season || 1) + 'E' + (ep.episode || 1);
        html += '<div class="dg-card selector episode-card" data-index="' + index + '">';
        html += '<div class="dg-card-title">' + epTitle + '</div>';

        // Показываем доступные озвучки для этого эпизода
        var hasVoice = ep.voice_studios.some(function (v) { return v.name === selectedVoice; });
        if (!hasVoice) {
          html += '<div class="dg-card-meta">Нет ' + escapeHtml(selectedVoice) + '</div>';
        }
        html += '</div>';
      });

      html += '</div></section></div>';
      self.html.html(html);

      self.html.find('.episode-card').off('hover:enter click').on('hover:enter click', function () {
        var index = parseInt($(this).attr('data-index'), 10);
        var episode = playlistData.episodes[index];
        self.playEpisode(episode);
      });
      self.refreshSelectors();
    };

    this.playEpisode = function (episode) {
      if (!episode || !episode.voice_studios) {
        Lampa.Noty.show('Ошибка: нет данных об эпизоде');
        return;
      }

      var studio = episode.voice_studios.find(function (v) {
        return v.name === selectedVoice;
      });

      // Если выбранная озвучка не найдена, берем первую доступную
      if (!studio) studio = episode.voice_studios[0];
      if (!studio || !studio.vk_id) {
        Lampa.Noty.show('Видео не найдено для выбранной озвучки');
        return;
      }

      Lampa.Loading.start(function () {
        Lampa.Loading.stop();
        Lampa.Controller.toggle('content');
      });

      apiStream(studio.vk_id, function (streamData) {
        Lampa.Loading.stop();
        self.startPlayer(streamData, episode, studio);
      }, function () {
        Lampa.Loading.stop();
        Lampa.Noty.show('Ошибка загрузки видео');
      });
    };

    this.startPlayer = function (streamData, episode, studio) {
      var best = streamData.best_mp4;

      if (!best || !best.url) {
        Lampa.Noty.show('Видео не найдено');
        return;
      }

      // MP4 через backend proxy стабильно работает в TV WebView. HLS требует
      // manifest XHR и на части телевизоров падает с manifestLoadError.
      var primaryUrl = proxyUrl(best.url);
      var retryCount = 0;

      var element = {
        title: (card.title || card.name || playlistData.title || 'Дорама') + ' — S' + (episode.season || 1) + 'E' + (episode.episode || 1) + ' | ' + studio.name,
        url: primaryUrl,
        timeline: {},
        isonline: true,
        card: card,
        hls_manifest_timeout: 20000,
        hls_retry_timeout: 45000,
      };

      // Качества тоже через proxy
      var q = {};
      if (streamData.qualities) {
        var qualityOrder = ['1080p', '720p', '480p', '360p', '240p', '144p'];
        qualityOrder.forEach(function (quality) {
          if (streamData.qualities[quality]) {
            q[quality] = proxyUrl(streamData.qualities[quality]);
          }
        });
      }
      if (Object.keys(q).length > 0) {
        element.quality = q;
      }

      // Штатный recovery callback Lampa: обновляем подписанные CDN URL и
      // сохраняем timeline, который плеер использует для возврата к позиции.
      element.error = function (work, useReserve) {
        if (retryCount >= 2) {
          log('stream recovery limit reached');
          return;
        }
        retryCount += 1;
        log('refresh stream after player error, attempt ' + retryCount);

        apiStream(studio.vk_id, function (fresh) {
          var renewed = '';
          if (work.quality_switched && fresh.qualities && fresh.qualities[work.quality_switched]) {
            renewed = proxyUrl(fresh.qualities[work.quality_switched]);
          } else if (fresh.best_mp4 && fresh.best_mp4.url) {
            renewed = proxyUrl(fresh.best_mp4.url);
          }

          if (renewed) {
            work.url = renewed;
            useReserve(renewed);
          } else {
            Lampa.Noty.show('Не удалось восстановить видеопоток');
          }
        }, function () {
          Lampa.Noty.show('Не удалось обновить ссылку на видео');
        });
      };

      log('play: ' + primaryUrl.substring(0, 100) + '...');

      Lampa.Player.play(element);
    };

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
        back: function () { Lampa.Activity.backward(); },
      });
      Lampa.Controller.toggle('content');
    };

    this.destroy = function () { this.html.remove(); };
  });

  // ====== Запуск ======
  function startPlugin() {
    if (window.dorama_online_plugin) return;
    window.dorama_online_plugin = true;

    log('Online plugin started');

    // Регистрируем источник данных для API
    Lampa.Api.sources.doramyclub_online = {
      name: SOURCE_NAME,
      get: function (url, onSuccess, onError) {
        var network = new Lampa.Reguest();
        network.silent(url, onSuccess, onError);
      },
    };

  }

  if (window.appready) {
    startPlugin();
  } else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') startPlugin();
    });
  }
})();
