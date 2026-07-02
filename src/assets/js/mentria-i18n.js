(function () {
  'use strict';

  var STORE_KEY = 'mentria_lang';
  var CHANNEL = 'mentria-locale';
  var DICT_BASE = '/assets/i18n/';

  var LOCALES = (window.MENTRIA_LOCALES && window.MENTRIA_LOCALES.length) ? window.MENTRIA_LOCALES : [
    { code: 'en', prefix: '', name: 'English' },
    { code: 'es', prefix: '/es', name: 'Español' },
    { code: 'pt-BR', prefix: '/pt-br', name: 'Português (BR)' },
    { code: 'fr', prefix: '/fr', name: 'Français' },
    { code: 'ja', prefix: '/ja', name: '日本語' }
  ];

  function byCode(c) {
    for (var i = 0; i < LOCALES.length; i++) if (LOCALES[i].code === c) return LOCALES[i];
    return null;
  }
  function localeForPath(p) {
    for (var i = 0; i < LOCALES.length; i++) {
      var pre = LOCALES[i].prefix;
      if (pre && (p === pre || p.indexOf(pre + '/') === 0)) return LOCALES[i];
    }
    return LOCALES[0];
  }
  function basePath(p) {
    var l = localeForPath(p);
    if (!l.prefix) return p || '/';
    return p.slice(l.prefix.length) || '/';
  }
  function urlForLocale(code, p) {
    var l = byCode(code);
    if (!l) return p;
    var b = basePath(p);
    return (l.prefix || '') + (b === '/' ? '/' : b);
  }
  function aboutHref(code) {
    var l = byCode(code);
    return (l ? l.prefix : '') + '/about/';
  }
  function lookup(dict, key) {
    var parts = key.split('.'), o = dict;
    for (var i = 0; i < parts.length; i++) {
      if (o == null) return null;
      o = o[parts[i]];
    }
    return o == null ? null : o;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var headSpec = null;
  function getHeadSpec() {
    if (headSpec) return headSpec;
    var el = document.getElementById('m-i18n-head');
    try { headSpec = el ? JSON.parse(el.textContent) : {}; } catch (_) { headSpec = {}; }
    return headSpec;
  }

  function applyText(dict) {
    var nodes = document.querySelectorAll('i18n-t[data-k]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i], val = lookup(dict, el.getAttribute('data-k'));
      if (val == null) continue;
      if (el.hasAttribute('data-vars')) {
        var out = String(val), pairs = el.getAttribute('data-vars').split(';');
        for (var p = 0; p < pairs.length; p++) {
          var eq = pairs[p].indexOf('=');
          if (eq < 0) continue;
          var name = pairs[p].slice(0, eq), vk = pairs[p].slice(eq + 1);
          var iv = lookup(dict, vk);
          out = out.split('{' + name + '}').join(iv == null ? vk : iv);
        }
        el.textContent = out;
      } else if (el.hasAttribute('data-brand')) {
        var word = el.getAttribute('data-brand');
        var link = '<a href="' + aboutHref(currentCode) + '">' + escapeHtml(word) + '</a>';
        el.innerHTML = escapeHtml(String(val)).split(word).join(link);
      } else if (el.hasAttribute('data-html')) {
        el.innerHTML = String(val);
      } else {
        el.textContent = String(val);
      }
    }
  }

  function applyAttrs(dict) {
    var els = document.querySelectorAll('[data-i18na]');
    for (var i = 0; i < els.length; i++) {
      var spec = els[i].getAttribute('data-i18na').split(';');
      for (var s = 0; s < spec.length; s++) {
        var eq = spec[s].indexOf('=');
        if (eq < 0) continue;
        var v = lookup(dict, spec[s].slice(eq + 1));
        if (v != null) els[i].setAttribute(spec[s].slice(0, eq), v);
      }
    }
  }

  function applyHead(dict) {
    var spec = getHeadSpec();
    if (spec.title && spec.title.key) {
      var tv = lookup(dict, spec.title.key);
      if (tv != null) document.title = (spec.title.prefix || '') + tv + (spec.title.suffix || '');
    }
    if (spec.desc && spec.desc.key) {
      var dv = lookup(dict, spec.desc.key), m = document.querySelector('meta[name="description"]');
      if (dv != null && m) m.setAttribute('content', dv);
    }
  }

  function updateSwitcher(code) {
    var loc = byCode(code), cur = document.querySelector('.lang-switcher__current');
    if (cur && loc) cur.textContent = loc.name;
    var items = document.querySelectorAll('.lang-switcher__item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('is-active', items[i].getAttribute('hreflang') === code);
    }
  }

  function rewriteLinks(code) {
    var links = document.querySelectorAll('a[href^="/"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.classList.contains('lang-switcher__item')) continue;
      var href = a.getAttribute('href');
      if (href.indexOf('/assets/') === 0) continue;
      var u;
      try { u = new URL(href, location.origin); } catch (_) { continue; }
      if (u.pathname !== '/' && u.pathname.slice(-1) !== '/') continue;
      a.setAttribute('href', urlForLocale(code, u.pathname) + u.search + u.hash);
    }
  }

  var activeDict = null;

  function apply(dict, code) {
    activeDict = dict;
    applyText(dict);
    applyAttrs(dict);
    applyHead(dict);
    document.documentElement.lang = code;
    updateSwitcher(code);
    rewriteLinks(code);
  }

  var cache = {};
  function getDict(code) {
    if (!cache[code]) {
      cache[code] = fetch(DICT_BASE + code + '.json').then(function (r) {
        if (!r.ok) throw new Error('dict ' + code);
        return r.json();
      });
    }
    return cache[code];
  }

  var buildTag = null;
  function i18nBuild() {
    if (buildTag) return buildTag;
    buildTag = 'v0';
    try {
      var s = document.querySelector('script[src*="mentria-i18n.js"]');
      if (s && s.src) {
        var m = s.src.match(/[?&]v=([^&]+)/);
        if (m) buildTag = decodeURIComponent(m[1]);
      }
    } catch (_) {}
    return buildTag;
  }

  function shellRoutes(prefix) {
    var routes = [prefix + '/', prefix + '/tools/', prefix + '/feed/', prefix + '/about/'];
    var data = window.MENTRIA_PALETTE_DATA;
    var tools = (data && data.tools) || [];
    for (var i = 0; i < tools.length; i++) {
      if (tools[i] && tools[i].slug) routes.push(prefix + '/tools/' + tools[i].slug + '/');
    }
    return routes;
  }

  var shellsBusy = {};
  function cacheLocaleShells(code) {
    if (code === 'en' || !('caches' in window)) return Promise.resolve();
    var loc = byCode(code);
    if (!loc || !loc.prefix) return Promise.resolve();
    if (shellsBusy[code]) return shellsBusy[code];
    var cacheName = 'mentria-locale-' + code + '-' + i18nBuild();
    var marker = '/__mentria-locale__/' + code;
    var p = caches.open(cacheName).then(function (shell) {
      return shell.match(marker).then(function (done) {
        if (done) return;
        var chain = Promise.resolve();
        shellRoutes(loc.prefix).forEach(function (route) {
          chain = chain.then(function () {
            return fetch(route).then(function (resp) {
              if (resp && resp.ok) return shell.put(route, resp.clone());
            }).catch(function () {});
          });
        });
        return chain
          .then(function () { return shell.put(marker, new Response('1')); })
          .then(function () { return caches.keys(); })
          .then(function (keys) {
            return Promise.all(keys.map(function (key) {
              if (key !== cacheName && key.indexOf('mentria-locale-' + code + '-') === 0) return caches.delete(key);
            }));
          });
      });
    }).catch(function () {}).then(function () { delete shellsBusy[code]; });
    shellsBusy[code] = p;
    return p;
  }

  function scheduleLocaleShells(code) {
    if (code === 'en' || !('caches' in window)) return;
    var run = function () { cacheLocaleShells(code); };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 4000 });
    else setTimeout(run, 1500);
  }

  var currentCode = (function () {
    var l = document.documentElement.getAttribute('lang');
    return byCode(l) ? l : localeForPath(location.pathname).code;
  })();
  var pending = null;

  var bc = null;
  try { if ('BroadcastChannel' in window) bc = new BroadcastChannel(CHANNEL); } catch (_) {}

  function setLocale(code, opts) {
    opts = opts || {};
    if (!byCode(code) || code === currentCode || code === pending) return;
    pending = code;
    getDict(code).then(function (dict) {
      if (pending === code) pending = null;
      var run = function () { apply(dict, code); };
      var vt = document.startViewTransition ? document.startViewTransition(run) : null;
      if (!vt) run();
      currentCode = code;
      scheduleLocaleShells(code);
      try { history.replaceState(history.state, '', urlForLocale(code, location.pathname) + location.search + location.hash); } catch (_) {}
      try { localStorage.setItem(STORE_KEY, code); } catch (_) {}
      if (!opts.fromRemote && bc) { try { bc.postMessage({ type: 'locale', code: code }); } catch (_) {} }
      var done = (vt && vt.updateCallbackDone) ? vt.updateCallbackDone : Promise.resolve();
      done.then(function () {
        document.dispatchEvent(new CustomEvent('mentria:localechange', { detail: { code: code } }));
      }, function () {});
    }).catch(function () {
      if (pending === code) pending = null;
      if (!opts.fromRemote) location.assign(urlForLocale(code, location.pathname) + location.search + location.hash);
    });
  }

  if (bc) {
    bc.onmessage = function (e) {
      if (e && e.data && e.data.type === 'locale') setLocale(e.data.code, { fromRemote: true });
    };
  }
  window.addEventListener('storage', function (e) {
    if (e.key === STORE_KEY && e.newValue) setLocale(e.newValue, { fromRemote: true });
  });

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest('.lang-switcher__item') : null;
    if (!a) return;
    var code = a.getAttribute('hreflang');
    if (!code || !byCode(code)) return;
    e.preventDefault();
    setLocale(code, {});
  });

  window.MentriaI18n = {
    set: function (code) { setLocale(code, {}); },
    locale: function () { return currentCode; },
    t: function (key) { return activeDict ? lookup(activeDict, key) : null; },
    cacheShells: function (code) { return cacheLocaleShells(code || currentCode); }
  };

  scheduleLocaleShells(currentCode);
})();
