import { h } from '../core/dom.js';

// ---------- photo storage (IndexedDB) ----------

const idb = new Promise((resolve, reject) => {
  if (!window.indexedDB) return reject(new Error('sin IndexedDB'));
  const r = indexedDB.open('cuaderno', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('img');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
idb.catch(() => {});

function idbOp(mode, fn) {
  return idb.then((db) => new Promise((resolve, reject) => {
    const t = db.transaction('img', mode);
    const req = fn(t.objectStore('img'));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
export const imgPut = (id, blob) => idbOp('readwrite', (s) => s.put(blob, id));
export const imgGet = (id) => idbOp('readonly', (s) => s.get(id));
export const imgDel = (id) => idbOp('readwrite', (s) => s.delete(id)).catch(() => {});
export const imgKeys = () => idbOp('readonly', (s) => s.getAllKeys()).then((k) => k || []).catch(() => []);

const urlCache = new Map();
async function imgURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  let blob = null;
  try { blob = await imgGet(id); } catch (e) { /* missing */ }
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urlCache.set(id, u);
  return u;
}

export function imgEl(id, props) {
  const el = h('img', { alt: '', ...props });
  imgURL(id).then((u) => { if (u) el.src = u; else el.classList.add('missing'); });
  return el;
}

// Downscale to keep storage small: phone photos are 3-8 MB, a recipe photo needs ~200 KB.
export async function resizeImage(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const hh = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hh;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, hh);
    ctx.drawImage(img, 0, 0, w, hh);
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
export const dataURLToBlob = async (u) => (await fetch(u)).blob();

// Forget a photo everywhere: its cached object URL and the stored blob.
export async function removeImage(id) {
  const u = urlCache.get(id);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
  await imgDel(id);
}

export async function clearImages() {
  for (const id of await imgKeys()) await removeImage(id);
}
