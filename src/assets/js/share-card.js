(function (global) {
  'use strict';

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () { resolve(im); };
      im.onerror = reject;
      im.src = url;
    });
  }

  var NO_START = '、。，．,.・：:；;？?！!ー～…‥）)」』】〕〉》｝}］]〙〗’”ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ%％';
  var NO_END = '（(「『【〔〈《｛{［[〘〖‘“';

  function isWide(ch) {
    var c = ch.codePointAt(0);
    return (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x20000 && c <= 0x2fa1f);
  }

  function pieces(word) {
    var chars = Array.from(word), atoms = [], run = '', i;
    for (i = 0; i < chars.length; i++) {
      if (isWide(chars[i])) {
        if (run) { atoms.push(run); run = ''; }
        atoms.push(chars[i]);
      } else {
        run += chars[i];
      }
    }
    if (run) atoms.push(run);
    var out = [];
    for (i = 0; i < atoms.length; i++) {
      var prev = out[out.length - 1];
      if (prev && (NO_START.indexOf(atoms[i].charAt(0)) >= 0 || NO_END.indexOf(prev.charAt(prev.length - 1)) >= 0)) out[out.length - 1] = prev + atoms[i];
      else out.push(atoms[i]);
    }
    return out;
  }

  function breakUnits(ctx, text, maxWidth) {
    var words = text.split(/\s+/).filter(Boolean), out = [];
    for (var w = 0; w < words.length; w++) {
      var parts = pieces(words[w]);
      for (var p = 0; p < parts.length; p++) {
        var spaced = w > 0 && p === 0;
        if (ctx.measureText(parts[p]).width <= maxWidth) { out.push({ t: parts[p], sp: spaced }); continue; }
        var chars = Array.from(parts[p]);
        for (var c = 0; c < chars.length; c++) out.push({ t: chars[c], sp: spaced && c === 0 });
      }
    }
    return out;
  }

  function joinUnits(list) {
    var s = '';
    for (var i = 0; i < list.length; i++) s += (i && list[i].sp ? ' ' : '') + list[i].t;
    return s;
  }

  function wrapLines(ctx, text, maxWidth, maxLines) {
    var units = breakUnits(ctx, text, maxWidth);
    var lines = [];
    var line = [];
    var cut = false;
    for (var i = 0; i < units.length; i++) {
      var probe = line.concat(units[i]);
      if (!line.length || ctx.measureText(joinUnits(probe)).width <= maxWidth) {
        line = probe;
        continue;
      }
      if (lines.length === maxLines - 1) { cut = true; break; }
      lines.push(line);
      line = [units[i]];
    }
    if (line.length) lines.push(line);
    if (cut) {
      var last = lines[lines.length - 1];
      while (last.length > 1 && ctx.measureText(joinUnits(last) + '…').width > maxWidth) last.pop();
    }
    return lines.map(function (l, n) { return joinUnits(l) + (cut && n === lines.length - 1 ? '…' : ''); });
  }

  function render(opts) {
    opts = opts || {};
    var caption = (opts.caption || '').trim();
    var subtitle = (opts.subtitle || '').trim();
    var tag = (opts.tag || '').trim();
    var W = 1080, H = 1350;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, W, H);

    var drawImage = opts.imageUrl
      ? loadImage(opts.imageUrl).then(function (im) {
        var scale = Math.max(W / im.naturalWidth, H / im.naturalHeight);
        var dw = im.naturalWidth * scale, dh = im.naturalHeight * scale;
        ctx.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }).catch(function () {})
      : Promise.resolve();

    return drawImage.then(function () {
      var scrim = ctx.createLinearGradient(0, H * 0.42, 0, H);
      scrim.addColorStop(0, 'rgba(6,6,12,0)');
      scrim.addColorStop(0.45, 'rgba(6,6,12,0.72)');
      scrim.addColorStop(1, 'rgba(6,6,12,0.94)');
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, W, H);
      return document.fonts && document.fonts.ready ? document.fonts.ready.catch(function () {}) : null;
    }).then(function () {
      var MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace";
      var PAD = 72;
      var baseline = H - PAD;

      ctx.textBaseline = 'alphabetic';
      ctx.font = '500 30px ' + MONO;
      ctx.fillStyle = '#6ef3c5';
      ctx.fillText('mentria.ai', PAD, baseline);
      if (tag) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.textAlign = 'right';
        ctx.fillText(tag, W - PAD, baseline);
        ctx.textAlign = 'left';
      }
      baseline -= 54;
      ctx.strokeStyle = 'rgba(110,243,197,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(PAD, baseline);
      ctx.lineTo(PAD + 64, baseline);
      ctx.stroke();
      baseline -= 44;

      if (subtitle && subtitle !== caption) {
        ctx.font = '400 30px ' + MONO;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        var subLines = wrapLines(ctx, subtitle, W - PAD * 2, 2).reverse();
        subLines.forEach(function (line) { ctx.fillText(line, PAD, baseline); baseline -= 42; });
        baseline -= 18;
      }

      ctx.font = '600 52px ' + MONO;
      ctx.fillStyle = '#ffffff';
      var capLines = wrapLines(ctx, caption, W - PAD * 2, 6).reverse();
      capLines.forEach(function (line) { ctx.fillText(line, PAD, baseline); baseline -= 68; });

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('toBlob failed')); }, 'image/png');
      });
    });
  }

  function download(name, blob) {
    if (global.MentriaUI && global.MentriaUI.downloadFile) { global.MentriaUI.downloadFile(name, blob); return; }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  function share(blob, name, meta) {
    meta = meta || {};
    var file = new File([blob], name, { type: 'image/png' });
    var payload = { files: [file], title: meta.title || document.title, text: meta.text || '' };
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      return navigator.share(payload).catch(function (err) {
        if (!err || err.name !== 'AbortError') download(name, blob);
      });
    }
    download(name, blob);
    return Promise.resolve();
  }

  global.MentriaShareCard = { render: render, share: share, loadImage: loadImage, wrapLines: wrapLines };
})(window);
