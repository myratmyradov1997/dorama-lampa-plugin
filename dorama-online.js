// == Dorama Online Plugin for Lampa — стриминг с DoramyClub.pro ==
(function () {
  'use strict';

  var BASE_URL = '__BASE_URL__';
  if (BASE_URL.indexOf('__BASE' + '_URL__') >= 0) BASE_URL = '';

  var SOURCE_NAME = 'DoramyClub';

  function log(m) { try { console.log('[DoramaOnline] ' + m); } catch (e) {} }

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

      self.html.off('hover:enter click', '.voice-card').on('hover:enter click', '.voice-card', function () {
        var index = parseInt($(this).attr('data-index'), 10);
        selectedVoice = voiceList[index];
        self.renderEpisodes();
      });
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

      self.html.off('hover:enter click', '.episode-card').on('hover:enter click', '.episode-card', function () {
        var index = parseInt($(this).attr('data-index'), 10);
        var episode = playlistData.episodes[index];
        self.playEpisode(episode);
      });
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

      var element = {
        title: (card.title || card.name || playlistData.title || 'Дорама') + ' — S' + (episode.season || 1) + 'E' + (episode.episode || 1) + ' | ' + studio.name,
        url: best.url,
        timeline: {},
        isonline: true,
      };

      // Добавляем качества
      var q = {};
      if (streamData.qualities) {
        var qualityOrder = ['1080p', '720p', '480p', '360p', '240p', '144p'];
        qualityOrder.forEach(function (quality) {
          if (streamData.qualities[quality]) {
            q[quality] = streamData.qualities[quality];
          }
        });
      }
      if (Object.keys(q).length > 0) {
        element.quality = q;
      }

      log('play: ' + best.url.substring(0, 100) + '...');

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

  // ====== Регистрация online-источника ======
  function registerOnlineSource() {
    // Добавляем в меню online-при просмотре фильма
    // Это делается через перехват событий Lampa

    // Альтернативно: добавляем кнопку в карточку дорамы из каталога
    Lampa.Listener.follow('activity', function (event) {
      if (event.type === 'start' && event.component === 'dorama_detail') {
        // Добавляем кнопку "Смотреть онлайн" на страницу деталей
        setTimeout(function () {
          self.addOnlineButton(event.object);
        }, 500);
      }
    });
  }

  // ====== Интеграция с dorama_detail ======
  // Эта функция добавит кнопку в существующий компонент dorama_detail
  function initOnlineButton() {
    // Ждем загрузки плагина каталога
    if (!Lampa.Components || !Lampa.Components.dorama_detail) {
      setTimeout(initOnlineButton, 500);
      return;
    }

    // Перехватываем создание dorama_detail
    var originalCreate = Lampa.Components.dorama_detail.prototype.create;
    Lampa.Components.dorama_detail.prototype.create = function () {
      originalCreate.call(this);
      addOnlineButtonToDetail(this);
    };
  }

  function addOnlineButtonToDetail(component) {
    var card = component.activity && component.activity.card ? component.activity.card : {};
    if (!card.url || card.url.indexOf('doramyclub.pro') === -1) return;

    var btnHtml = '<div class="selector" style="padding:1em;background:#ff9800;color:#fff;text-align:center;margin:1em;border-radius:.5em;cursor:pointer;">' +
      '▶ Смотреть онлайн (DoramyClub)' +
      '</div>';
    var $btn = $(btnHtml);

    $btn.on('hover:enter click', function () {
      try { window.__dorama_online_card = card; } catch (e) {}
      Lampa.Activity.push({
        component: 'dorama_online',
        title: card.title || 'Онлайн',
        card: card,
        params: { card: card },
      });
    });

    // Вставляем кнопку в начало контента
    var $root = component.html || $(component.html);
    if ($root.length) {
      $root.prepend($btn);
    }
  }

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

    // Добавляем кнопку в детали
    setTimeout(initOnlineButton, 1000);
  }

  if (window.appready) {
    startPlugin();
  } else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') startPlugin();
    });
  }
})();
