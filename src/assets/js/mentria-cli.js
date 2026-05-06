/**
 * Mentria CLI — Interactive terminal hero
 * Handles command parsing, typing animation, and command history.
 */
(function () {
  'use strict';

  const COMMANDS = {
    help: {
      description: 'list available commands',
      run: function () {
        var lines = ['Available commands:', ''];
        var keys = Object.keys(COMMANDS);
        for (var i = 0; i < keys.length; i++) {
          lines.push('  ' + keys[i].padEnd(10) + ' — ' + COMMANDS[keys[i]].description);
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
        window.location.href = '/tools/';
        return { lines: ['> navigating to /tools/...'], type: 'result' };
      }
    },
    feed: {
      description: 'view the feed',
      run: function () {
        window.location.href = '/feed/';
        return { lines: ['> navigating to /feed/...'], type: 'result' };
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

    // Input handling
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var cmd = inputEl.value.trim().toLowerCase();
        inputEl.value = '';
        if (!cmd) return;

        // Add to history
        history.unshift(cmd);
        if (history.length > MAX_HISTORY) history.pop();
        historyIndex = -1;

        // Echo command
        appendLine(outputEl, '$ ' + cmd, 'command');

        // Execute
        if (COMMANDS[cmd]) {
          var result = COMMANDS[cmd].run();
          if (result.type === 'clear') {
            outputEl.innerHTML = '';
          } else {
            for (var i = 0; i < result.lines.length; i++) {
              appendLine(outputEl, result.lines[i], result.type);
            }
          }
        } else {
          appendLine(outputEl, 'command not found: ' + cmd + ". type 'help' for available commands.", 'error');
        }

        // Scroll output into view
        outputEl.scrollTop = outputEl.scrollHeight;
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
