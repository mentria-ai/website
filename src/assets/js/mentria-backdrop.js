(function (global) {
  'use strict';

  var PALETTES = [
    ['#6ef3c5', '#22d3ee', '#a78bfa'],
    ['#22d3ee', '#a78bfa', '#6ef3c5'],
    ['#a78bfa', '#f472b6', '#22d3ee'],
    ['#6ef3c5', '#fbbf24', '#22d3ee'],
    ['#f472b6', '#6ef3c5', '#a78bfa'],
    ['#22d3ee', '#6ef3c5', '#fbbf24']
  ];

  function hash(str) {
    var h = 2166136261 >>> 0;
    str = String(str == null ? '' : str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    var a = hash(seed) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  function n(v) { return Math.round(v * 10) / 10; }

  function svg(seed, opts) {
    opts = opts || {};
    var r = rng(seed);
    var W = 900, H = opts.square ? 900 : 1500;
    var pal = pick(r, PALETTES);
    var dim = opts.dim == null ? 1 : opts.dim;
    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice">');
    parts.push('<defs>');
    for (var i = 0; i < 3; i++) {
      var cx = n(W * (0.15 + r() * 0.7)), cy = n(H * (0.1 + r() * 0.8)), rad = n(Math.min(W, H) * (0.45 + r() * 0.35));
      var a = (0.22 + r() * 0.14) * dim;
      parts.push('<radialGradient id="g' + i + '" cx="' + cx + '" cy="' + cy + '" r="' + rad + '" gradientUnits="userSpaceOnUse">' +
        '<stop offset="0" stop-color="' + pal[i] + '" stop-opacity="' + n(a) + '"/>' +
        '<stop offset="0.55" stop-color="' + pal[i] + '" stop-opacity="' + n(a * 0.35) + '"/>' +
        '<stop offset="1" stop-color="' + pal[i] + '" stop-opacity="0"/></radialGradient>');
    }
    var step = 36 + Math.floor(r() * 3) * 8;
    parts.push('<pattern id="dots" width="' + step + '" height="' + step + '" patternUnits="userSpaceOnUse"><circle cx="' + (step / 2) + '" cy="' + (step / 2) + '" r="1.2" fill="#ffffff" fill-opacity="0.16"/></pattern>');
    parts.push('</defs>');
    parts.push('<rect width="' + W + '" height="' + H + '" fill="#07090c"/>');
    parts.push('<rect width="' + W + '" height="' + H + '" fill="url(#dots)"/>');
    for (var k = 0; k < 3; k++) parts.push('<rect width="' + W + '" height="' + H + '" fill="url(#g' + k + ')"/>');
    var shapes = 2 + Math.floor(r() * 2);
    var stroke = 'stroke="#ffffff" stroke-opacity="' + n(0.14 * dim + 0.04) + '" fill="none" stroke-width="1.5"';
    for (var s = 0; s < shapes; s++) {
      var kind = Math.floor(r() * 4);
      var x = n(W * (0.1 + r() * 0.8)), y = n(H * (0.1 + r() * 0.8)), size = n(Math.min(W, H) * (0.12 + r() * 0.22));
      if (kind === 0) parts.push('<circle cx="' + x + '" cy="' + y + '" r="' + size + '" ' + stroke + '/>');
      else if (kind === 1) parts.push('<rect x="' + n(x - size / 2) + '" y="' + n(y - size / 2) + '" width="' + size + '" height="' + size + '" transform="rotate(' + n(r() * 90) + ' ' + x + ' ' + y + ')" ' + stroke + '/>');
      else if (kind === 2) { var ang = r() * Math.PI; var dx = n(Math.cos(ang) * size * 2), dy = n(Math.sin(ang) * size * 2); parts.push('<line x1="' + n(x - dx) + '" y1="' + n(y - dy) + '" x2="' + n(x + dx) + '" y2="' + n(y + dy) + '" ' + stroke + '/>'); }
      else parts.push('<path d="M' + n(x - size) + ' ' + y + ' A ' + size + ' ' + size + ' 0 0 1 ' + n(x + size) + ' ' + y + '" ' + stroke + '/>');
    }
    var ax = n(W * (0.2 + r() * 0.6)), ay = n(H * (0.2 + r() * 0.6));
    parts.push('<circle cx="' + ax + '" cy="' + ay + '" r="5" fill="' + pal[0] + '" fill-opacity="' + n(0.7 * dim) + '"/>');
    parts.push('<rect width="' + W + '" height="' + H + '" fill="url(#g0)" opacity="0"/>');
    parts.push('</svg>');
    return parts.join('');
  }

  function dataUri(seed, opts) {
    var s = svg(seed, opts);
    if (typeof btoa === 'function') return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(s)));
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(s);
  }

  function apply(el, seed, opts) {
    if (!el) return;
    el.style.backgroundImage = 'url("' + dataUri(seed, opts) + '")';
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
  }

  var api = { svg: svg, dataUri: dataUri, apply: apply, hash: hash };
  global.MentriaBackdrop = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
