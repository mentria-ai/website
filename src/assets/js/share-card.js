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

  function wrapLines(ctx, text, maxWidth, maxLines) {
    var words = text.split(/\s+/).filter(Boolean);
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var probe = line ? line + ' ' + w : w;
      if (ctx.measureText(probe).width <= maxWidth || !line) {
        line = probe;
      } else {
        lines.push(line);
        line = w;
        if (lines.length === maxLines - 1) break;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    var used = lines.join(' ');
    if (used.length < text.length && lines.length) {
      var last = lines[lines.length - 1];
      while (last && ctx.measureText(last + '…').width > maxWidth) last = last.replace(/\s*\S*$/, '');
      if (!last && lines.length > 1) {
        lines.pop();
        last = lines[lines.length - 1];
        while (last && ctx.measureText(last + '…').width > maxWidth) last = last.replace(/\s*\S*$/, '');
      }
      lines[lines.length - 1] = last + '…';
    }
    return lines;
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
