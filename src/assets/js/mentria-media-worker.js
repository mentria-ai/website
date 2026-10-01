self.onmessage = async (e) => {
  const { id, file, width } = e.data || {};
  let blob = null;
  try {
    let bmp;
    try {
      bmp = await createImageBitmap(file, { resizeWidth: width, resizeQuality: 'medium', imageOrientation: 'from-image' });
    } catch (err) {
      if (!err || err.name !== 'TypeError') throw err;
      bmp = await createImageBitmap(file, { resizeWidth: width, resizeQuality: 'medium' });
    }
    const w = Math.min(width, bmp.width);
    const h = Math.max(1, Math.round(w * bmp.height / bmp.width));
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    blob = await c.convertToBlob({ type: 'image/webp', quality: 0.78 });
    if (blob.type !== 'image/webp') {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#16181d';
      ctx.fillRect(0, 0, w, h);
      blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    }
  } catch (_) {
    blob = null;
  }
  self.postMessage({ id, blob });
};
