/**
 * Mentria CLI — Interactive terminal hero
 * Handles command parsing, typing animation, and command history.
 */
(function () {
  'use strict';

  function localePrefix() {
    var path = window.location.pathname || '/';
    var locs = window.MENTRIA_LOCALES || [];
    for (var i = 0; i < locs.length; i++) {
      var p = locs[i].prefix;
      if (p && (path === p || path.indexOf(p + '/') === 0)) return p;
    }
    return '';
  }

  var T = window.MENTRIA_CLI_I18N || {};
  function tfmt(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }

  const COMMANDS = {
    help: {
      description: T.descHelp || 'list available commands',
      run: function () {
        var lines = [T.helpHeading || 'Available commands:', ''];
        var keys = Object.keys(COMMANDS);
        for (var i = 0; i < keys.length; i++) {
          var cmd = COMMANDS[keys[i]];
          var name = cmd.usage || keys[i];
          lines.push('  ' + name.padEnd(18) + ' — ' + cmd.description);
        }
        return { lines: lines, type: 'result' };
      }
    },
    tools: {
      description: T.descTools || 'browse utility tools',
      run: function () {
        var toolsSection = document.getElementById('tools-preview');
        if (toolsSection) {
          var noMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          toolsSection.scrollIntoView({ behavior: noMotion ? 'auto' : 'smooth' });
          return { lines: [T.scrollingTools || '> scrolling to tools...'], type: 'result' };
        }
        var dest = localePrefix() + '/tools/';
        window.location.href = dest;
        return { lines: [tfmt(T.navigatingTo || '> navigating to {dest}...', { dest: dest })], type: 'result' };
      }
    },
    feed: {
      description: T.descFeed || 'view the feed',
      run: function () {
        var dest = localePrefix() + '/feed/';
        window.location.href = dest;
        return { lines: [tfmt(T.navigatingTo || '> navigating to {dest}...', { dest: dest })], type: 'result' };
      }
    },
    search: {
      description: T.descSearch || 'search the site (e.g. `search base64`)',
      usage: 'search <query>',
      argv: true,
      run: function (args) {
        var query = (args || '').trim();
        var dest = localePrefix() + '/tools/search/';
        if (query) dest += '?q=' + encodeURIComponent(query);
        window.location.href = dest;
        return { lines: [tfmt(T.navigatingTo || '> navigating to {dest}...', { dest: dest })], type: 'result' };
      }
    },
    about: {
      description: T.descAbout || 'about mentria',
      run: function () {
        return {
          lines: [T.aboutLine || '> mentria — a creative studio for tools, experiments & visual transmissions. est. 2025.'],
          type: 'result'
        };
      }
    },
    clear: {
      description: T.descClear || 'clear the terminal',
      run: function () {
        return { lines: [], type: 'clear' };
      }
    }
  };

  var BUILTIN_COMMANDS = Object.keys(COMMANDS);

  window.MentriaCLI = {
    register: function (name, def) {
      if (!name || typeof name !== 'string') return false;
      name = name.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return false;
      if (COMMANDS[name]) return false;
      if (!def || typeof def.run !== 'function') return false;
      var argv = !!def.argv;
      var userRun = def.run;
      COMMANDS[name] = {
        description: String(def.description || ''),
        usage: def.usage == null ? undefined : String(def.usage),
        argv: argv,
        run: function (args) {
          var r;
          try { r = argv ? userRun(args) : userRun(); }
          catch (e) { return { lines: ['command failed: ' + (e && e.message || e)], type: 'error' }; }
          if (!r || typeof r.type !== 'string') return { lines: [], type: 'result' };
          if (r.type !== 'clear' && !Array.isArray(r.lines)) return { lines: [], type: r.type };
          return r;
        }
      };
      return true;
    },
    unregister: function (name) {
      if (!COMMANDS[name] || BUILTIN_COMMANDS.indexOf(name) !== -1) return false;
      delete COMMANDS[name];
      return true;
    }
  };

  var MAX_HISTORY = 20;
  var history = [];
  var historyIndex = -1;
  var draft = '';

  function initCLI(containerEl) {
    if (!containerEl) return;

    var outputEl = containerEl.querySelector('.cli__output');
    var inputEl = containerEl.querySelector('.cli__input');
    if (!outputEl || !inputEl) return;

    // Typing animation for welcome message — strings come from the page
    // (window.MENTRIA_CLI_WELCOME) so they're localized per locale.
    var w = (window.MENTRIA_CLI_WELCOME) || {};
    var welcomeLines = [
      { text: w.cmd  || '$ welcome --to mentria',                 type: 'command', key: 'home.cli.welcomeCmd',  prefix: '' },
      { text: '> ' + (w.out1 || 'creative studio. tools & transmissions.'), type: 'result', key: 'home.cli.welcomeOut1', prefix: '> ' },
      { text: '> ' + (w.out2 || "type 'help' for commands."),     type: 'muted',   key: 'home.cli.welcomeOut2', prefix: '> ' }
    ];

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var typingState = { cancelled: false };

    if (reducedMotion) {
      for (var i = 0; i < welcomeLines.length; i++) {
        var wp = appendLine(outputEl, welcomeLines[i].text, welcomeLines[i].type);
        wp.dataset.welcomeKey = welcomeLines[i].key;
        wp.dataset.welcomePrefix = welcomeLines[i].prefix;
      }
    } else {
      typeLines(outputEl, welcomeLines, 0, function () {}, typingState);
    }

    document.addEventListener('mentria:localechange', function () {
      var I = window.MentriaI18n;
      if (!I || !I.t) return;
      var els = outputEl.querySelectorAll('[data-welcome-key]');
      for (var i = 0; i < els.length; i++) {
        var v = I.t(els[i].dataset.welcomeKey);
        if (v != null) els[i].textContent = (els[i].dataset.welcomePrefix || '') + v;
      }
    });

    // ── Autocomplete popover ───────────────────────────────────────
    var suggestEl = document.getElementById('cli-suggestions');
    var suggestState = { items: [], idx: -1 };

    function popoverSupported() {
      return suggestEl && typeof suggestEl.showPopover === 'function';
    }

    function positionSuggestions() {
      if (!suggestEl) return;
      var r = inputEl.getBoundingClientRect();
      // Cap at 320px wide, anchored to the input column.
      suggestEl.style.left = (window.scrollX + r.left) + 'px';
      suggestEl.style.top  = (window.scrollY + r.bottom + 4) + 'px';
      suggestEl.style.minWidth = r.width + 'px';
    }

    function filterCommands(prefix) {
      var p = (prefix || '').toLowerCase();
      if (!p) return [];
      var matches = [];
      var keys = Object.keys(COMMANDS);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(p) === 0) matches.push(keys[i]);
      }
      return matches;
    }

    function syncCombobox(expanded) {
      inputEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (expanded && suggestState.idx >= 0) {
        inputEl.setAttribute('aria-activedescendant', 'cli-sug-' + suggestState.idx);
      } else {
        inputEl.removeAttribute('aria-activedescendant');
      }
    }

    function renderSuggestions() {
      if (!suggestEl) return;
      suggestEl.innerHTML = '';
      for (var i = 0; i < suggestState.items.length; i++) {
        var name = suggestState.items[i];
        var cmd = COMMANDS[name];
        var row = document.createElement('div');
        row.className = 'cli__suggestion' + (i === suggestState.idx ? ' is-active' : '');
        row.setAttribute('role', 'option');
        row.id = 'cli-sug-' + i;
        row.setAttribute('aria-selected', i === suggestState.idx ? 'true' : 'false');
        row.dataset.name = name;
        var nameSpan = document.createElement('span');
        nameSpan.className = 'cli__suggestion-name';
        nameSpan.textContent = cmd.usage || name;
        var descSpan = document.createElement('span');
        descSpan.className = 'cli__suggestion-desc';
        descSpan.textContent = cmd.description;
        row.textContent = '';
        row.appendChild(nameSpan);
        row.appendChild(descSpan);
        row.addEventListener('mousedown', function (e) {
          e.preventDefault();
          inputEl.value = (COMMANDS[this.dataset.name].argv ? this.dataset.name + ' ' : this.dataset.name);
          hideSuggestions();
          inputEl.focus();
          if (!COMMANDS[this.dataset.name].argv) {
            // Run immediately for arg-less commands.
            inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          }
        });
        suggestEl.appendChild(row);
      }
    }

    function showSuggestions(prefix) {
      if (!popoverSupported()) return;
      var matches = filterCommands(prefix);
      if (matches.length === 0 || (matches.length === 1 && matches[0] === prefix)) {
        return hideSuggestions();
      }
      suggestState.items = matches;
      if (suggestState.idx >= matches.length) suggestState.idx = -1;
      renderSuggestions();
      positionSuggestions();
      if (!suggestEl.matches(':popover-open')) {
        try { suggestEl.showPopover(); } catch (_) {}
      }
      syncCombobox(true);
    }

    function hideSuggestions() {
      suggestState.items = [];
      suggestState.idx = -1;
      if (popoverSupported() && suggestEl.matches(':popover-open')) {
        try { suggestEl.hidePopover(); } catch (_) {}
      }
      syncCombobox(false);
    }

    inputEl.addEventListener('input', function () {
      var raw = inputEl.value.trim();
      // Only suggest while user hasn't yet started args (no space).
      if (raw.indexOf(' ') !== -1) return hideSuggestions();
      showSuggestions(raw.toLowerCase());
    });
    inputEl.addEventListener('blur', function () {
      // Defer so click-on-suggestion lands first.
      setTimeout(hideSuggestions, 120);
    });
    window.addEventListener('resize', function () {
      if (suggestEl && suggestEl.matches(':popover-open')) positionSuggestions();
    });

    // Input handling
    inputEl.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      var sugOpen = suggestEl && suggestEl.matches(':popover-open') && suggestState.items.length > 0;

      // Tab or Right-arrow at end-of-input: complete to highlighted (or first) suggestion.
      if (sugOpen && (e.key === 'Tab' || (e.key === 'ArrowRight' && inputEl.selectionStart === inputEl.value.length))) {
        e.preventDefault();
        var pickIdx = suggestState.idx >= 0 ? suggestState.idx : 0;
        var name = suggestState.items[pickIdx];
        inputEl.value = (COMMANDS[name].argv ? name + ' ' : name);
        hideSuggestions();
        return;
      }

      if (e.key === 'Escape' && sugOpen) {
        e.preventDefault();
        hideSuggestions();
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        typingState.cancelled = true;

        // If a suggestion is highlighted, treat Enter as accept-and-run.
        if (sugOpen && suggestState.idx >= 0) {
          var picked = suggestState.items[suggestState.idx];
          inputEl.value = (COMMANDS[picked].argv ? picked + ' ' : picked);
          hideSuggestions();
          if (COMMANDS[picked].argv) return; // wait for args
        }

        var raw = inputEl.value.trim();
        inputEl.value = '';
        hideSuggestions();
        if (!raw) return;

        // Split into command + remaining args.
        var spaceIdx = raw.indexOf(' ');
        var name = (spaceIdx === -1 ? raw : raw.slice(0, spaceIdx)).toLowerCase();
        var args = (spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1)).trim();

        // Add to history
        history.unshift(raw);
        if (history.length > MAX_HISTORY) history.pop();
        historyIndex = -1;

        appendLine(outputEl, '$ ' + raw, 'command');

        if (COMMANDS[name]) {
          var result = COMMANDS[name].argv ? COMMANDS[name].run(args) : COMMANDS[name].run();
          if (result.type === 'clear') {
            outputEl.innerHTML = '';
          } else {
            for (var i = 0; i < result.lines.length; i++) {
              appendLine(outputEl, result.lines[i], result.type);
            }
          }
        } else {
          appendLine(outputEl, tfmt(T.notFound || "command not found: {name}. type 'help' for available commands.", { name: name }), 'error');
        }

        outputEl.scrollTop = outputEl.scrollHeight;
      }

      // Suggestion navigation (preempts history when popover is open).
      if (sugOpen && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (e.key === 'ArrowDown') {
          suggestState.idx = (suggestState.idx + 1) % suggestState.items.length;
        } else {
          suggestState.idx = suggestState.idx <= 0 ? suggestState.items.length - 1 : suggestState.idx - 1;
        }
        renderSuggestions();
        syncCombobox(true);
        return;
      }

      // History navigation
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (historyIndex < history.length - 1) {
          if (historyIndex === -1) draft = inputEl.value;
          historyIndex++;
          inputEl.value = history[historyIndex];
        }
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex > 0) {
          historyIndex--;
          inputEl.value = history[historyIndex];
        } else if (historyIndex === 0) {
          historyIndex = -1;
          inputEl.value = draft;
          draft = '';
        }
      }
    });

  }

  function appendLine(outputEl, text, type) {
    var p = document.createElement('p');
    p.className = 'cli__line cli__line--' + (type || 'result');
    p.textContent = text;
    outputEl.appendChild(p);
    return p;
  }

  function typeLines(outputEl, lines, index, callback, state) {
    if (state && state.cancelled) return;
    if (index >= lines.length) {
      if (callback) callback();
      return;
    }

    var line = lines[index];
    var p = document.createElement('p');
    p.className = 'cli__line cli__line--' + (line.type || 'result');
    if (line.key) { p.dataset.welcomeKey = line.key; p.dataset.welcomePrefix = line.prefix || ''; }
    outputEl.appendChild(p);

    typeText(p, line.text, 0, function () {
      setTimeout(function () {
        typeLines(outputEl, lines, index + 1, callback, state);
      }, 200);
    }, state);
  }

  function typeText(el, text, charIndex, callback, state) {
    if (state && state.cancelled) return;
    if (charIndex >= text.length) {
      if (callback) callback();
      return;
    }
    el.textContent = text.substring(0, charIndex + 1);
    setTimeout(function () {
      typeText(el, text, charIndex + 1, callback, state);
    }, 30);
  }

  // Auto-init
  document.addEventListener('DOMContentLoaded', function () {
    var cli = document.querySelector('.cli');
    if (cli) initCLI(cli);
  });
})();
