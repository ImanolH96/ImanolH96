import { APP_VERSION } from '../config.js';
import { state, persist } from '../core/store.js';
import { imgGet, blobToDataURL } from './images.js';
import { saveFile } from '../ui/platform.js';

export async function exportBackup() {
  const imagenesData = {};
  for (const n of state.notas) {
    for (const id of n.imagenes) {
      if (imagenesData[id]) continue;
      try { const b = await imgGet(id); if (b) imagenesData[id] = await blobToDataURL(b); } catch (e) { /* skip */ }
    }
  }
  const payload = { app: 'cuaderno', version: APP_VERSION, exportado: new Date().toISOString(), notas: state.notas, imagenesData };
  const stamp = new Date().toISOString().slice(0, 10);
  const ok = await saveFile(`cuaderno-${stamp}.json`, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  if (ok) {
    state.meta.lastBackup = new Date().toISOString();
    persist();
  }
  return ok;
}
