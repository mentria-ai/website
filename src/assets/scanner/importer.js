import { decodeFile, fitBitmap, addPage } from './pages.js';
import { detectIn } from './detector.js';

export async function importFiles(files, doc, onProgress) {
  const failed = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (onProgress) onProgress(i + 1, files.length);
    let bmp = null;
    try {
      bmp = await fitBitmap(await decodeFile(file));
      let quad = null;
      try { quad = (await detectIn(bmp, 640)).quad; } catch (_) { quad = null; }
      await addPage(doc, bmp, quad);
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') throw e;
      failed.push(file.name || String(i + 1));
    } finally {
      if (bmp) bmp.close();
    }
  }
  return { failed };
}
