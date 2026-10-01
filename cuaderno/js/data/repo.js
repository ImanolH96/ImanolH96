// Notes that live as .md files in the site's own contenido/ folder (listed in contenido/index.json).
// The repo is read-only from here: a note is only proposed for import when its file changed since the
// last time it was imported, so edits made in the app survive until the file itself changes.

import { state, byId, persist } from '../core/store.js';
import { parseMarkdown } from './markdown.js';
import { normalize } from './model.js';
import { applyImport } from './ai.js';

const BASE = 'contenido/';

const hash = (s) => {
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
  return (x >>> 0).toString(36);
};
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const safePath = (f) => typeof f === 'string' && /\.md$/i.test(f) && !f.includes('..') && !/^[/\\]|:/.test(f);
const url = (file) => BASE + file.split('/').map(encodeURIComponent).join('/');

export async function fetchRepoNotes() {
  const res = await fetch(BASE + 'index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('No encontré contenido/index.json en el sitio.');
  let files;
  try { files = await res.json(); } catch (e) { throw new Error('contenido/index.json no es un JSON válido.'); }
  if (!Array.isArray(files)) throw new Error('contenido/index.json tiene que ser una lista de archivos .md.');

  const loaded = await Promise.all(files.filter(safePath).map(async (file) => {
    try {
      const r = await fetch(url(file), { cache: 'no-cache' });
      return r.ok ? { file, text: await r.text() } : null;
    } catch (e) { return null; }
  }));

  const out = [];
  for (const f of loaded.filter(Boolean)) {
    const raws = parseMarkdown(f.text);
    raws.forEach((raw, k) => {
      if (!raw.id) raw.id = 'md-' + slug(f.file) + (raws.length > 1 ? '-' + (k + 1) : ''); // stable id: the file name
      const note = normalize(raw);
      if (note) out.push({ note, hash: hash(f.text), file: f.file });
    });
  }
  return out;
}

export function planRepoSync(items) {
  const seen = state.meta.repoHashes || {};
  const nuevos = [];
  const actualizados = [];
  for (const it of items) {
    if (seen[it.note.id] === it.hash) continue;           // same file as last import
    (byId(it.note.id) ? actualizados : nuevos).push(it);
  }
  return { nuevos, actualizados, total: nuevos.length + actualizados.length };
}

let pending = null;
// Checked once per page load unless forced; rejects (silently ignored by callers) when there is no contenido/.
export function checkRepoChanges(force) {
  if (!pending || force) pending = fetchRepoNotes().then(planRepoSync);
  return pending;
}

export async function applyRepoSync(plan) {
  const items = [...plan.nuevos, ...plan.actualizados];
  await applyImport({ notas: items.map((i) => i.note), imagenes: null });
  state.meta.repoHashes = state.meta.repoHashes || {};
  for (const i of items) state.meta.repoHashes[i.note.id] = i.hash;
  state.meta.lastRepoSync = new Date().toISOString();
  persist();
  pending = null;
}
