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
    ask: {
      description: T.descAsk || 'ask the AI running on this device',
      usage: 'ask <question>',
      argv: true,
      run: function (args, ctx) { return runAsk(args, ctx); }
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

  function runAsk(args, ctx) {
    var q = String(args || '').trim();
    if (!q) return { lines: ['ask <question>'], type: 'error' };
    if (!navigator.gpu) return { lines: [T.askUnsupported || 'the on-device model needs a WebGPU browser (Chrome or Edge on desktop, recent Android).'], type: 'error' };
    if (!ctx || !ctx.outputEl) return { lines: [], type: 'result' };
    var out = ctx.outputEl;
    var ansEl = null;
    var progEl = null;
    import('/assets/js/mentria-local-ask.js').then(function (M) {
      return M.isModelCached().catch(function () { return true; }).then(function (cached) {
        if (!cached) {
          appendLine(out, T.askDownload || '> first use may download the model, it stays on your device.', 'muted');
          out.scrollTop = out.scrollHeight;
        }
        return M.askLocal('You are the on-device assistant of mentria.ai, a privacy-first site where everything runs locally in the browser: 30+ tools (quick notes, timers, QR codes, unit converter, color picker, base64, rulers and levels), games (chess, sudoku, ludo, breakout, flappy, a retro FPS), P2P comms chat, Story Studio decks, and an AI-learning feed. You are a language model running on this device via WebGPU. When asked what is available or possible here, list items from that inventory. You answer questions only and cannot operate the tools yourself: if asked to do something (start a timer, save a note, make a QR code), do not claim to have done it; say which tool does it and that typing open followed by its name here opens it (open countdown-timer, open quick-notes, open qr-scanner, open decision-wheel, open color-picker, open base64-codec), or that the console at /tools/console/ has an on-device agent that does it for them. Answer briefly and plainly.', q, {
          maxTokens: 220,
          source: 'cli',
          onProgress: function (message) {
            if (!progEl) progEl = appendLine(out, '', 'muted');
            progEl.textContent = '> ' + message;
            out.scrollTop = out.scrollHeight;
          },
          onToken: function (_t, full) {
            if (!ansEl) ansEl = appendLine(out, '', 'result');
            ansEl.textContent = '> ' + full;
            out.scrollTop = out.scrollHeight;
          }
        });
      });
    }).then(function (answer) {
      if (!ansEl) ansEl = appendLine(out, '', 'result');
      ansEl.textContent = '> ' + answer;
      out.scrollTop = out.scrollHeight;
    }).catch(function (e) {
      var msg = (e && e.message === 'download-postponed')
        ? (T.askPostponed || 'model download postponed — run the command again whenever you like.')
        : (e && e.message === 'host-busy')
          ? (T.askBusy || 'the on-device model is busy in another tab — try again in a moment.')
          : (T.askError || 'the local model could not answer: ') + ((e && e.message) || e);
      appendLine(out, msg, 'error');
      out.scrollTop = out.scrollHeight;
    });
    return { lines: [T.askThinking || '> asking the model running on this device…'], type: 'muted' };
  }

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

  (function registerLaunchers() {
    var pdata = window.MENTRIA_PALETTE_DATA || {};
    var labels = pdata.labels || {};
    var prefix = typeof pdata.prefix === 'string' ? pdata.prefix : '';

    (pdata.tools || []).forEach(function (tool) {
      if (!tool || !tool.slug || !tool.title || COMMANDS[tool.slug]) return;
      COMMANDS[tool.slug] = {
        description: String(tool.title),
        run: function () {
          var dest = tool.url ? tool.url : prefix + '/tools/' + tool.slug + '/';
          window.location.href = dest;
          return { lines: [tfmt(T.navigatingTo || '> navigating to {dest}...', { dest: dest })], type: 'result' };
        }
      };
    });

    function saveQuickNote(text) {
      try {
        var S = window.MentriaStore;
        if (!S) return false;
        var inbox = S.get('quick_notes', 'inbox');
        if (!Array.isArray(inbox)) inbox = [];
        var now = Date.now();
        inbox.push({
          id: now.toString(36) + Math.random().toString(36).slice(2, 7),
          title: '',
          body: text,
          createdAt: now,
          updatedAt: now
        });
        return S.set('quick_notes', 'inbox', inbox);
      } catch (_) { return false; }
    }

    function parseDuration(raw) {
      var m = String(raw || '').trim().match(/^(\d+(?:\.\d+)?)\s*(h|hr|m|min|s|sec)?$/i);
      if (!m) return null;
      var n = parseFloat(m[1]);
      if (!isFinite(n) || n <= 0) return null;
      var unit = (m[2] || 'm').toLowerCase();
      var secs = unit[0] === 'h' ? n * 3600 : unit[0] === 's' ? n : n * 60;
      secs = Math.round(secs);
      if (secs < 1 || secs > 99 * 3600) return null;
      return secs;
    }

    if (!COMMANDS.note) {
      COMMANDS.note = {
        description: String(labels.actNote || 'Save note: {text}'),
        usage: 'note <text>',
        argv: true,
        run: function (args) {
          var text = String(args || '').replace(/^:\s*/, '').trim();
          if (!text) return { lines: ['note <text>'], type: 'error' };
          if (saveQuickNote(text)) return { lines: [String(labels.actNoteDone || 'Note saved')], type: 'result' };
          return { lines: [String(labels.actNoteFail || 'Could not save the note')], type: 'error' };
        }
      };
    }

    if (!COMMANDS.timer) {
      COMMANDS.timer = {
        description: String(labels.actTimer || 'Start a {dur} timer'),
        usage: 'timer <5m | 1h | 30s>',
        argv: true,
        run: function (args) {
          var secs = parseDuration(args);
          if (!secs) return { lines: ['timer <5m | 1h | 30s>'], type: 'error' };
          var dest = prefix + '/tools/countdown-timer/?start=' + secs;
          window.location.href = dest;
          return { lines: [tfmt(T.navigatingTo || '> navigating to {dest}...', { dest: dest })], type: 'result' };
        }
      };
    }

    if (!COMMANDS.flip) {
      COMMANDS.flip = {
        description: String(labels.actFlip || 'Flip a coin'),
        run: function () {
          var b = new Uint8Array(1);
          try { crypto.getRandomValues(b); } catch (_) { b[0] = Math.random() * 256; }
          var result = b[0] < 128 ? String(labels.actHeads || 'Heads') : String(labels.actTails || 'Tails');
          return { lines: ['\uD83E\uDE99 ' + result], type: 'result' };
        }
      };
    }
  })();

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

        var colonIdx = name.indexOf(':');
        if (!COMMANDS[name] && colonIdx > 0) {
          var colonBase = name.slice(0, colonIdx);
          if (COMMANDS[colonBase] && COMMANDS[colonBase].argv) {
            args = (name.slice(colonIdx + 1) + (args ? ' ' + args : '')).replace(/^\s+/, '');
            name = colonBase;
          }
        }

        // Add to history
        history.unshift(raw);
        if (history.length > MAX_HISTORY) history.pop();
        historyIndex = -1;

        appendLine(outputEl, '$ ' + raw, 'command');
        var ctx = { outputEl: outputEl };

        if (COMMANDS[name]) {
          var result = COMMANDS[name].argv ? COMMANDS[name].run(args, ctx) : COMMANDS[name].run(ctx);
          if (result.type === 'clear') {
            outputEl.innerHTML = '';
          } else {
            for (var i = 0; i < result.lines.length; i++) {
              appendLine(outputEl, result.lines[i], result.type);
            }
          }
        } else {
          var loose = raw.indexOf(' ') !== -1 ? [] : Object.keys(COMMANDS).filter(function (k) {
            if (k.indexOf(name) === 0) return true;
            if (name.length < 3) return false;
            return (COMMANDS[k].description || '').toLowerCase().indexOf(name) !== -1;
          });
          if (loose.length === 1) {
            var looseCmd = COMMANDS[loose[0]];
            var looseRes = looseCmd.argv ? looseCmd.run(args, ctx) : looseCmd.run(ctx);
            if (looseRes.type === 'clear') {
              outputEl.innerHTML = '';
            } else {
              for (var k2 = 0; k2 < looseRes.lines.length; k2++) {
                appendLine(outputEl, looseRes.lines[k2], looseRes.type);
              }
            }
          } else if (raw.indexOf(' ') !== -1 && navigator.gpu) {
            var askRes = runAsk(raw, ctx);
            for (var k3 = 0; k3 < askRes.lines.length; k3++) {
              appendLine(outputEl, askRes.lines[k3], askRes.type);
            }
          } else {
            appendLine(outputEl, tfmt(T.notFound || "command not found: {name}. type 'help' for available commands.", { name: name }), 'error');
          }
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
