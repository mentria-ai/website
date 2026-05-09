/**
 * Mentria CLI — Interactive terminal hero
 * Handles command parsing, typing animation, and command history.
 */
(function () {
  'use strict';

  function localePrefix() {
    var path = window.location.pathname || '/';
    var prefixes = ['/es', '/pt-br', '/fr', '/ja'];
    for (var i = 0; i < prefixes.length; i++) {
      if (path === prefixes[i] || path.indexOf(prefixes[i] + '/') === 0) return prefixes[i];
    }
    return '';
  }

  const COMMANDS = {
    help: {
      description: 'list available commands',
      run: function () {
        var lines = ['Available commands:', ''];
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
      description: 'browse utility tools',
      run: function () {
        var toolsSection = document.getElementById('tools-preview');
        if (toolsSection) {
          toolsSection.scrollIntoView({ behavior: 'smooth' });
          return { lines: ['> scrolling to tools...'], type: 'result' };
        }
        window.location.href = localePrefix() + '/tools/';
        return { lines: ['> navigating to /tools/...'], type: 'result' };
      }
    },
    feed: {
      description: 'view the feed',
      run: function () {
        window.location.href = localePrefix() + '/feed/';
        return { lines: ['> navigating to /feed/...'], type: 'result' };
      }
    },
    search: {
      description: 'search the site (e.g. `search base64`)',
      usage: 'search <query>',
      argv: true,
      run: function (args) {
        var query = (args || '').trim();
        var dest = localePrefix() + '/tools/search/';
        if (query) dest += '?q=' + encodeURIComponent(query);
        window.location.href = dest;
        return { lines: ['> navigating to ' + dest + '...'], type: 'result' };
      }
    },
    about: {
      description: 'about mentria',
      run: function () {
        return {
          lines: ['> mentria — a creative studio for tools, experiments & visual transmissions. est. 2025.'],
          type: 'result'
        };
      }
    },
    clear: {
      description: 'clear the terminal',
      run: function () {
        return { lines: [], type: 'clear' };
      }
    }
  };

  var MAX_HISTORY = 20;
  var history = [];
  var historyIndex = -1;

  function initCLI(containerEl) {
    if (!containerEl) return;

    var outputEl = containerEl.querySelector('.cli__output');
    var inputEl = containerEl.querySelector('.cli__input');
    if (!outputEl || !inputEl) return;

    // Typing animation for welcome message — strings come from the page
    // (window.MENTRIA_CLI_WELCOME) so they're localized per locale.
    var w = (window.MENTRIA_CLI_WELCOME) || {};
    var welcomeLines = [
      { text: w.cmd  || '$ welcome --to mentria',                 type: 'command' },
      { text: '> ' + (w.out1 || 'creative studio. tools & transmissions.'), type: 'result' },
      { text: '> ' + (w.out2 || "type 'help' for commands."),     type: 'muted'   }
    ];

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      // Instant render
      for (var i = 0; i < welcomeLines.length; i++) {
        appendLine(outputEl, welcomeLines[i].text, welcomeLines[i].type);
      }
    } else {
      typeLines(outputEl, welcomeLines, 0, function () {});
    }

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

    function renderSuggestions() {
      if (!suggestEl) return;
      suggestEl.innerHTML = '';
      for (var i = 0; i < suggestState.items.length; i++) {
        var name = suggestState.items[i];
        var cmd = COMMANDS[name];
        var row = document.createElement('div');
        row.className = 'cli__suggestion' + (i === suggestState.idx ? ' is-active' : '');
        row.setAttribute('role', 'option');
        row.dataset.name = name;
        row.innerHTML =
          '<span class="cli__suggestion-name">' + (cmd.usage || name) + '</span>' +
          '<span class="cli__suggestion-desc">' + cmd.description + '</span>';
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
    }

    function hideSuggestions() {
      suggestState.items = [];
      suggestState.idx = -1;
      if (popoverSupported() && suggestEl.matches(':popover-open')) {
        try { suggestEl.hidePopover(); } catch (_) {}
      }
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
          appendLine(outputEl, 'command not found: ' + name + ". type 'help' for available commands.", 'error');
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
        return;
      }

      // History navigation
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (historyIndex < history.length - 1) {
          historyIndex++;
          inputEl.value = history[historyIndex];
        }
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex > 0) {
          historyIndex--;
          inputEl.value = history[historyIndex];
        } else {
          historyIndex = -1;
          inputEl.value = '';
        }
      }
    });

  }

  function appendLine(outputEl, text, type) {
    var p = document.createElement('p');
    p.className = 'cli__line cli__line--' + (type || 'result');
    p.textContent = text;
    outputEl.appendChild(p);
  }

  function typeLines(outputEl, lines, index, callback) {
    if (index >= lines.length) {
      if (callback) callback();
      return;
    }

    var line = lines[index];
    var p = document.createElement('p');
    p.className = 'cli__line cli__line--' + (line.type || 'result');
    outputEl.appendChild(p);

    typeText(p, line.text, 0, function () {
      setTimeout(function () {
        typeLines(outputEl, lines, index + 1, callback);
      }, 200);
    });
  }

  function typeText(el, text, charIndex, callback) {
    if (charIndex >= text.length) {
      if (callback) callback();
      return;
    }
    el.textContent = text.substring(0, charIndex + 1);
    setTimeout(function () {
      typeText(el, text, charIndex + 1, callback);
    }, 30);
  }

  // Scroll reveal observer
  function initReveal() {
    var elements = document.querySelectorAll('.reveal');
    if (!elements.length) return;

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      for (var i = 0; i < elements.length; i++) {
        elements[i].classList.add('revealed');
      }
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add('revealed');
          observer.unobserve(entries[i].target);
        }
      }
    }, { threshold: 0.1 });

    for (var i = 0; i < elements.length; i++) {
      observer.observe(elements[i]);
    }
  }

  // Auto-init
  document.addEventListener('DOMContentLoaded', function () {
    var cli = document.querySelector('.cli');
    if (cli) initCLI(cli);
    initReveal();
  });
})();
