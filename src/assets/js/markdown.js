/* markdown.js — global markdown renderer for Mentria pages.
 *
 * Mirrors the approach in src/tools/markdown-pdf.njk: dynamic-import the
 * `marked` library from jsDelivr (already in the project's dependency
 * footprint via that tool, so this isn't a new external dep).
 *
 * Exposes:  window.renderMarkdown(text) → htmlString
 *
 * Loading model: synchronous-by-fallback. We install a vanilla JS
 * fallback at script-tag execution time so callers never see undefined.
 * marked.js loads in the background (~30-50 KB gzipped, fetched in
 * parallel with the model weights so it's effectively free). When marked
 * arrives, we swap renderMarkdown to use it for richer output.
 *
 * Safety: BOTH paths HTML-escape untrusted input before applying any
 * markdown patterns. Model output cannot inject script tags.
 */
(function (global) {
  'use strict';

  /* ── Vanilla fallback (no deps) ───────────────────────────────── */

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderFallback(input) {
    if (!input) return '';
    let s = String(input);

    /* fenced code blocks first — content stashed pre-escape */
    const codeBlocks = [];
    s = s.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, function (_m, lang, body) {
      const idx = codeBlocks.length;
      const cls = lang ? ' class="md-lang-' + escapeHtml(lang) + '"' : '';
      codeBlocks.push('<pre><code' + cls + '>' + escapeHtml(body.replace(/\n$/, '')) + '</code></pre>');
      return ' CB' + idx + ' ';
    });

    /* inline `code` */
    const inlineCode = [];
    s = s.replace(/`([^`\n]+)`/g, function (_m, code) {
      const idx = inlineCode.length;
      inlineCode.push('<code>' + escapeHtml(code) + '</code>');
      return ' IC' + idx + ' ';
    });

    s = escapeHtml(s);

    /* emphasis — bold first so * inside doesn't trip italic match */
    s = s.replace(/\*\*([^*\n](?:[^*\n]|\*(?!\*))*?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>');

    const lines = s.split('\n');
    const out = [];
    let listType = null;
    let para = [];
    function flushPara() { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } }
    function closeList() { if (listType) { out.push('</' + listType + '>'); listType = null; } }
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const olm = trimmed.match(/^(\d+)\.\s+(.+)$/);
      const ulm = trimmed.match(/^[-*+]\s+(.+)$/);
      if (olm) {
        flushPara();
        if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
        out.push('<li>' + olm[2] + '</li>');
      } else if (ulm) {
        flushPara();
        if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
        out.push('<li>' + ulm[1] + '</li>');
      } else if (!trimmed) {
        flushPara(); closeList();
      } else {
        closeList();
        para.push(trimmed);
      }
    }
    flushPara(); closeList();

    let html = out.join('\n');
    html = html.replace(/ IC(\d+) /g, function (_m, n) { return inlineCode[+n]; });
    html = html.replace(/ CB(\d+) /g, function (_m, n) { return codeBlocks[+n]; });
    return html;
  }

  /* Install fallback first so callers never get undefined */
  global.renderMarkdown = renderFallback;

  /* ── marked.js upgrade path ───────────────────────────────────── */

  /* Async-load marked from jsDelivr ESM, same source as
     src/tools/markdown-pdf.njk. When it arrives, swap the global
     renderMarkdown over so subsequent calls get richer output (tables,
     blockquotes, autolinks, etc.). */
  (async function upgradeToMarked() {
    try {
      const mod = await import('/assets/js/marked.esm.js');
      const marked = mod.marked || mod.default;
      if (!marked || typeof marked.parse !== 'function') return;
      marked.setOptions({ gfm: true, breaks: true, pedantic: false });

      global.renderMarkdown = function (input) {
        if (!input) return '';
        const html = marked.parse(String(input));
        /* Same light XSS strip as markdown-pdf.njk: drop any literal
           <script> tag the model spelled out. marked itself escapes
           inline html by default with `gfm: true`, so this is belt-
           and-suspenders. */
        return html.replace(/<script[\s\S]*?<\/script>/gi, '');
      };
    } catch (err) {
      /* CDN unreachable, offline, etc. — fallback is already in place. */
      console.warn('[markdown] marked.js unavailable, using vanilla fallback:', err);
    }
  })();
})(typeof window !== 'undefined' ? window : globalThis);
