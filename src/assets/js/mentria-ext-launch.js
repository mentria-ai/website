(function () {
  'use strict';
  var pages = document.querySelector('.launcher__pages');
  if (!pages || !window.MentriaStore) return;

  import('/assets/js/mentria-extensions.js').then(function (X) {
    var entries = X.getRegistry().filter(function (e) { return e.enabled; });
    if (!entries.length) return;

    var withTool = entries.filter(function (e) { return e.manifest.mounts && e.manifest.mounts.tool; });
    if (withTool.length) {
      var section = document.createElement('section');
      section.className = 'launcher__cat launcher__cat--extensions';
      section.setAttribute('data-group', 'Extensions');
      var label = document.createElement('h2');
      label.className = 'launcher__label';
      var i18n = window.MentriaI18n;
      label.textContent = (i18n && i18n.t && i18n.t('home.launcher.extensions')) || 'Extensions';
      var grid = document.createElement('div');
      grid.className = 'launcher__grid';
      withTool.forEach(function (e) {
        var m = e.manifest;
        var slugSel = (window.CSS && CSS.escape) ? CSS.escape(m.id) : m.id.replace(/[^a-z0-9-]/g, '');
        if (document.querySelector('.launcher .launch-tile[data-slug="' + slugSel + '"]')) return;
        var a = document.createElement('a');
        a.className = 'launch-tile';
        a.setAttribute('data-slug', m.id);
        a.setAttribute('data-group', 'Extensions');
        a.setAttribute('data-search', m.name + ' ' + (m.description || '') + ' extension');
        a.href = '/tools/extensions/run/?id=' + encodeURIComponent(m.id);
        var icon = document.createElement('span');
        icon.className = 'launch-tile__icon launch-tile__icon--ext';
        icon.setAttribute('aria-hidden', 'true');
        if (/^data:image\//.test(m.icon || '')) {
          var img = document.createElement('img');
          img.src = m.icon; img.alt = '';
          icon.appendChild(img);
        } else {
          icon.textContent = m.icon || '🧩';
        }
        var lab = document.createElement('span');
        lab.className = 'launch-tile__label';
        lab.textContent = m.name;
        a.appendChild(icon); a.appendChild(lab);
        grid.appendChild(a);
      });
      if (grid.children.length) {
        section.appendChild(label);
        section.appendChild(grid);
        pages.appendChild(section);
      }
    }

    if (window.MentriaCLI) {
      entries.forEach(function (e) {
        var m = e.manifest;
        var cmds = (m.mounts && m.mounts.commands) || [];
        cmds.forEach(function (c) {
          var ok = window.MentriaCLI.register(c.name, {
            description: c.description + ' (' + m.name + ')',
            usage: c.usage,
            argv: true,
            run: function (args) {
              var dest = '/tools/extensions/run/?id=' + encodeURIComponent(m.id) +
                '#cmd=' + encodeURIComponent(c.name) + '&args=' + encodeURIComponent(args || '');
              setTimeout(function () { window.location.href = dest; }, 0);
              return { lines: ['> opening ' + m.name + '...'], type: 'result' };
            }
          });
          if (!ok) console.warn('[mentria-ext] command skipped (collision): ' + c.name);
        });
      });
    }
  }).catch(function (err) {
    console.warn('[mentria-ext] launch integration failed:', err);
  });
})();
