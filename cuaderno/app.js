'use strict';

const STORE_KEY = 'cuaderno:v1';
const APP_VERSION = '1';

const TIPOS = {
  receta: { label: 'Receta', plural: 'Recetas', emoji: '🍳' },
  ejercicio: { label: 'Ejercicio', plural: 'Ejercicios', emoji: '🏋️' },
  nota: { label: 'Nota', plural: 'Notas', emoji: '📝' },
};

const IA_LINKS = [
  ['ChatGPT', 'https://chatgpt.com/'],
  ['Claude', 'https://claude.ai/new'],
  ['Gemini', 'https://gemini.google.com/app'],
];

// ---------- tiny DOM helper (user text always goes through textContent) ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const app = document.getElementById('app');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- text storage ----------

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      d.notas = Array.isArray(d.notas) ? d.notas : [];
      d.meta = d.meta || {};
      return d;
    }
  } catch (e) { /* start empty */ }
  return { notas: [], meta: {} };
}

let state = load();

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    toast('No se pudo guardar en el dispositivo');
    return false;
  }
}

const byId = (id) => state.notas.find((n) => n.id === id);

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
const imgPut = (id, blob) => idbOp('readwrite', (s) => s.put(blob, id));
const imgGet = (id) => idbOp('readonly', (s) => s.get(id));
const imgDel = (id) => idbOp('readwrite', (s) => s.delete(id)).catch(() => {});
const imgKeys = () => idbOp('readonly', (s) => s.getAllKeys()).then((k) => k || []).catch(() => []);

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

function imgEl(id, props) {
  const el = h('img', { alt: '', ...props });
  imgURL(id).then((u) => { if (u) el.src = u; else el.classList.add('missing'); });
  return el;
}

// Downscale to keep storage small: phone photos are 3-8 MB, a recipe photo needs ~200 KB.
async function resizeImage(file, max = 1280) {
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

const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
const dataURLToBlob = async (u) => (await fetch(u)).blob();

// ---------- normalizing notes (accepts whatever an AI gives back) ----------

const str = (v) => (v == null ? '' : String(v).trim());

function lines(v) {
  const arr = Array.isArray(v) ? v : String(v == null ? '' : v).split(/\r?\n/);
  return arr
    .map((x) => {
      if (x == null) return '';
      if (typeof x === 'object') return Object.values(x).filter(Boolean).join(' ');
      return String(x);
    })
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

function tagsOf(v) {
  const arr = Array.isArray(v) ? v : String(v == null ? '' : v).split(',');
  const out = [];
  for (const t of arr) {
    const s = str(t).replace(/^#/, '').toLowerCase();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function tipoOf(raw) {
  const t = str(raw.tipo || raw.type).toLowerCase();
  if (t.startsWith('rec')) return 'receta';
  if (t.startsWith('ej') || t.startsWith('rut') || t === 'gym') return 'ejercicio';
  if (t.startsWith('not')) return 'nota';
  if (raw.ingredientes || raw.pasos) return 'receta';
  if (raw.ejercicios) return 'ejercicio';
  return 'nota';
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const now = new Date().toISOString();
  const validDate = (d) => (d && !isNaN(Date.parse(d)) ? new Date(d).toISOString() : null);
  const n = {
    id: str(raw.id) || uid(),
    tipo: tipoOf(raw),
    titulo: str(raw.titulo || raw.title || raw.nombre) || 'Sin título',
    etiquetas: tagsOf(raw.etiquetas || raw.tags),
    favorito: raw.favorito === true,
    notas: str(raw.notas || raw.texto || raw.nota || raw.contenido),
    imagenes: Array.isArray(raw.imagenes) ? raw.imagenes.filter((x) => typeof x === 'string') : [],
    creado: validDate(raw.creado) || now,
    actualizado: now,
  };
  if (n.tipo === 'receta') {
    n.porciones = str(raw.porciones);
    n.tiempo = str(raw.tiempo);
    n.ingredientes = lines(raw.ingredientes);
    n.pasos = lines(raw.pasos);
  } else if (n.tipo === 'ejercicio') {
    n.grupo = str(raw.grupo || raw.musculo);
    const list = Array.isArray(raw.ejercicios) ? raw.ejercicios : [];
    n.ejercicios = list
      .map((e) => {
        if (typeof e === 'string') return { nombre: str(e), series: '', reps: '', peso: '', descanso: '', notas: '' };
        if (!e || typeof e !== 'object') return null;
        return {
          nombre: str(e.nombre || e.ejercicio || e.name), series: str(e.series), reps: str(e.reps || e.repeticiones),
          peso: str(e.peso), descanso: str(e.descanso), notas: str(e.notas),
        };
      })
      .filter((e) => e && e.nombre);
  }
  return n;
}

// ---------- the bridge to the AIs ----------

const PROMPT_INTRO =
  'Estás ayudándome con mi cuaderno personal (recetas, ejercicios del gimnasio y notas). ' +
  'Respondé SOLO con un bloque de código JSON válido, sin texto antes ni después y sin comentarios. ' +
  'Podés devolver un objeto o una lista de objetos. Todo el contenido en español.';

const SCHEMA_DOC = `Campos de cada objeto:
- "tipo": "receta", "ejercicio" o "nota"
- "titulo": texto
- "etiquetas": lista de palabras cortas en minúscula (ej. ["almuerzo","pollo"])
- "notas": texto libre u observaciones (en una "nota" es todo el contenido)
- "id": opcional. Si estás editando algo que ya existe, conservá el id tal cual; si es algo nuevo, omitilo.
- Solo recetas: "porciones", "tiempo", "ingredientes" (lista de textos con cantidad, ej. "200 g de harina"), "pasos" (lista de textos, un paso cada uno, sin numerar)
- Solo ejercicios: "grupo" (ej. "Pecho y tríceps") y "ejercicios": lista de objetos con "nombre", "series", "reps", "peso", "descanso", "notas"

Ejemplo de receta:
{"tipo":"receta","titulo":"Tortilla de papas","etiquetas":["cena"],"porciones":"4","tiempo":"40 min","ingredientes":["4 papas","6 huevos","1 cebolla"],"pasos":["Pelar y cortar las papas","Freír a fuego bajo","Mezclar con los huevos y cuajar"],"notas":""}

Ejemplo de ejercicios:
{"tipo":"ejercicio","titulo":"Día de pecho","etiquetas":["gym"],"grupo":"Pecho y tríceps","ejercicios":[{"nombre":"Press banca","series":"4","reps":"8-10","peso":"60 kg","descanso":"90 s","notas":""}],"notas":""}`;

function forAI(n) {
  const { imagenes, creado, actualizado, ...rest } = n; // photos stay on the phone
  void imagenes; void creado; void actualizado;
  return rest;
}

const fence = (obj) => '```json\n' + JSON.stringify(obj, null, 2) + '\n```';

function promptNew(tipo, pedido) {
  const que = tipo === 'todo' ? 'una receta, una rutina de ejercicios o una nota (lo que corresponda)' : `una ${TIPOS[tipo].label.toLowerCase()}`;
  return `${PROMPT_INTRO}\n\n${SCHEMA_DOC}\n\nQuiero que me armes ${que}.\nPedido: ${pedido || '(completá acá lo que querés)'}`;
}

function promptEdit(notas, cambio) {
  const lista = Array.isArray(notas) ? notas.map(forAI) : forAI(notas);
  return `${PROMPT_INTRO}\n\n${SCHEMA_DOC}\n\nEsto es lo que ya tengo guardado:\n${fence(lista)}\n\n` +
    `Aplicá este cambio y devolvé el JSON completo de lo que modifiques (conservando los id): ${cambio || '(completá acá lo que querés cambiar)'}`;
}

function parsePayload(text) {
  let t = String(text || '').trim();
  if (!t) throw new Error('Pegá primero la respuesta de la IA.');
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  let data;
  try {
    data = JSON.parse(t);
  } catch (e) {
    const fixed = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    const a = fixed.search(/[[{]/);
    const b = Math.max(fixed.lastIndexOf('}'), fixed.lastIndexOf(']'));
    if (a < 0 || b <= a) throw new Error('No encontré JSON en el texto pegado.');
    try {
      data = JSON.parse(fixed.slice(a, b + 1));
    } catch (e2) {
      throw new Error('El JSON no es válido (' + e2.message + '). Pedile a la IA que lo corrija.');
    }
  }
  const items = Array.isArray(data) ? data : Array.isArray(data.notas) ? data.notas : [data];
  const notas = items.map(normalize).filter(Boolean);
  if (!notas.length) throw new Error('El JSON no tiene ninguna nota.');
  return { notas, imagenes: data && !Array.isArray(data) && typeof data.imagenesData === 'object' ? data.imagenesData : null };
}

function planImport(notas) {
  const nuevos = [];
  const actualizados = [];
  for (const n of notas) {
    const old = byId(n.id);
    if (old) actualizados.push({ old, nuevo: n }); else nuevos.push(n);
  }
  return { nuevos, actualizados };
}

async function applyImport(parsed) {
  if (parsed.imagenes) {
    for (const [id, dataUrl] of Object.entries(parsed.imagenes)) {
      try { await imgPut(id, await dataURLToBlob(dataUrl)); } catch (e) { /* skip bad photo */ }
    }
  }
  const known = new Set(await imgKeys());
  const plan = planImport(parsed.notas);
  for (const n of plan.nuevos) {
    n.imagenes = n.imagenes.filter((i) => known.has(i));
    state.notas.push(n);
  }
  for (const { old, nuevo } of plan.actualizados) {
    const imgs = nuevo.imagenes.filter((i) => known.has(i));
    nuevo.imagenes = imgs.length ? imgs : old.imagenes;
    nuevo.creado = old.creado;
    nuevo.favorito = nuevo.favorito || old.favorito;
    state.notas[state.notas.indexOf(old)] = nuevo;
  }
  persist();
  return plan;
}

// ---------- helpers: clipboard, toast, files, dates ----------

let toastTimer;
function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2400);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = h('textarea', { value: text, style: 'position:fixed;top:0;left:0;opacity:0' });
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
    ta.remove();
    return ok;
  }
}

async function saveFile(name, blob) {
  try {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}

const fmtDate = (iso) => {
  if (!iso) return 'nunca';
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
};

function toPlainText(n) {
  const out = [`${TIPOS[n.tipo].emoji} ${n.titulo}`];
  if (n.tipo === 'receta') {
    const m = [n.porciones && `Porciones: ${n.porciones}`, n.tiempo && `Tiempo: ${n.tiempo}`].filter(Boolean).join(' · ');
    if (m) out.push(m);
    if (n.ingredientes.length) out.push('', 'Ingredientes:', ...n.ingredientes.map((i) => `• ${i}`));
    if (n.pasos.length) out.push('', 'Pasos:', ...n.pasos.map((p, i) => `${i + 1}. ${p}`));
  } else if (n.tipo === 'ejercicio') {
    if (n.grupo) out.push(n.grupo);
    out.push('', ...n.ejercicios.map((e) => '• ' + exerciseSummary(e)));
  }
  if (n.notas) out.push('', n.notas);
  return out.join('\n');
}

function exerciseSummary(e) {
  const sr = e.series && e.reps ? `${e.series}×${e.reps}` : e.series || e.reps;
  return [e.nombre, sr, e.peso, e.descanso && `desc. ${e.descanso}`].filter(Boolean).join(' · ');
}

// ---------- overlays ----------

function overlay(content, cls) {
  const el = h('div', { class: 'overlay ' + (cls || '') }, content);
  const close = () => el.remove();
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  document.body.append(el);
  return close;
}

function sheet(title, buttons) {
  let close;
  const body = h('div', { class: 'sheet' },
    title && h('h3', {}, title),
    buttons.filter(Boolean).map(([label, fn, cls]) =>
      h('button', { class: 'btn ' + (cls || ''), onclick: () => { close(); fn(); } }, label)),
    h('button', { class: 'btn', onclick: () => close() }, 'Cancelar'));
  close = overlay(body);
}

function lightbox(id) {
  const close = overlay(h('div', { onclick: () => close() }, imgEl(id)), 'lightbox');
}

// ---------- routing ----------

const ui = { q: '', tipo: 'todo', tag: '', scroll: 0 };
let cleanup = null;

function go(hash, replace) {
  if (replace) location.replace(hash); else location.hash = hash;
}

function back() {
  if (history.length > 1) history.back(); else go('#/', true);
}

function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const [, name, arg] = (location.hash || '#/').split('/');
  app.replaceChildren();
  let view;
  if (name === 'n' && byId(arg)) view = viewDetail(byId(arg));
  else if (name === 'e' && byId(arg)) view = viewEdit(byId(arg));
  else if (name === 'nuevo' && TIPOS[arg]) view = viewEdit(null, arg);
  else if (name === 'ia') view = viewIA();
  else if (name === 'ajustes') view = viewSettings();
  else view = viewList();
  app.append(view);
  window.scrollTo(0, name ? 0 : ui.scroll);
}

window.addEventListener('hashchange', () => {
  if (!app.querySelector('[data-list]')) { /* leaving a non-list view */ } else ui.scroll = window.scrollY;
  route();
});

// ---------- views ----------

function appbar(title, left, right) {
  return h('header', { class: 'appbar' }, left, h('h2', {}, title), right || h('span', { style: 'min-width:44px' }));
}

const backBtn = () => h('button', { class: 'icon-btn text', onclick: back, 'aria-label': 'Volver' }, '‹ Volver');

function matches(n, q) {
  if (!q) return true;
  const hay = [n.titulo, n.notas, n.grupo, n.etiquetas.join(' '), (n.ingredientes || []).join(' '),
    (n.ejercicios || []).map((e) => e.nombre).join(' ')].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function subtitle(n) {
  if (n.tipo === 'receta') {
    return [n.tiempo, n.porciones && `${n.porciones} porciones`, n.ingredientes.length && `${n.ingredientes.length} ingredientes`]
      .filter(Boolean).join(' · ') || n.notas;
  }
  if (n.tipo === 'ejercicio') {
    return [n.grupo, `${n.ejercicios.length} ejercicio${n.ejercicios.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  }
  return n.notas;
}

function viewList() {
  const view = h('div', { class: 'view', 'data-list': '' });
  const listBox = h('div', { class: 'list' });
  const chipsBox = h('div', { class: 'chips' });
  const tagsBox = h('div', { class: 'chips tags' });
  const count = h('p', { class: 'count' });

  function refresh() {
    const all = state.notas;
    chipsBox.replaceChildren(...[['todo', 'Todo'], ['receta', 'Recetas'], ['ejercicio', 'Ejercicios'], ['nota', 'Notas'], ['fav', '★ Favoritos']]
      .map(([k, label]) => h('button', {
        class: 'chip', 'aria-pressed': String(ui.tipo === k),
        onclick: () => { ui.tipo = k; ui.tag = ''; refresh(); },
      }, label)));

    const scoped = all.filter((n) => ui.tipo === 'todo' || (ui.tipo === 'fav' ? n.favorito : n.tipo === ui.tipo));
    const tagCount = {};
    scoped.forEach((n) => n.etiquetas.forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
    const tags = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a] || a.localeCompare(b));
    if (ui.tag && !tags.includes(ui.tag)) ui.tag = '';
    tagsBox.hidden = !tags.length;
    tagsBox.replaceChildren(...tags.map((t) => h('button', {
      class: 'chip', 'aria-pressed': String(ui.tag === t),
      onclick: () => { ui.tag = ui.tag === t ? '' : t; refresh(); },
    }, '#' + t)));

    const shown = scoped
      .filter((n) => (!ui.tag || n.etiquetas.includes(ui.tag)) && matches(n, ui.q))
      .sort((a, b) => b.actualizado.localeCompare(a.actualizado));
    count.textContent = all.length ? `${shown.length} de ${all.length}` : '';
    count.hidden = !all.length;

    if (!all.length) {
      listBox.replaceChildren(h('div', { class: 'empty' },
        h('div', { class: 'big' }, '📓'),
        h('p', {}, 'Tu cuaderno está vacío. Anotá una receta, una rutina del gimnasio o pedile a una IA que te arme una.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => go('#/ia') }, '✨ Pedirle a una IA'),
          h('button', { class: 'btn', onclick: addSheet }, '＋ Nueva'))));
      return;
    }
    if (!shown.length) {
      listBox.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🔍'), h('p', {}, 'No encontré nada con ese filtro.')));
      return;
    }
    listBox.replaceChildren(...shown.map(card));
  }

  function card(n) {
    const sub = subtitle(n);
    return h('button', { class: 'card-link', onclick: () => go('#/n/' + n.id) },
      n.imagenes.length
        ? imgEl(n.imagenes[0], { class: 'thumb', loading: 'lazy' })
        : h('div', { class: 'thumb ' + n.tipo }, TIPOS[n.tipo].emoji),
      h('div', { class: 'card-body' },
        h('div', { class: 'card-title' }, n.titulo, n.favorito && h('span', { class: 'star' }, '★')),
        sub && h('div', { class: 'card-sub' }, sub),
        n.etiquetas.length > 0 && h('div', { class: 'tagline' }, n.etiquetas.slice(0, 4).map((t) => h('span', { class: 'tag' }, '#' + t)))));
  }

  const search = h('input', {
    class: 'search', type: 'search', placeholder: 'Buscar recetas, ejercicios, notas…', value: ui.q,
    enterKeyHint: 'search', autocomplete: 'off',
    oninput: () => { ui.q = search.value; refresh(); },
  });

  view.append(
    h('header', { class: 'appbar' },
      h('h1', {}, 'Cuaderno'),
      h('button', { class: 'icon-btn', onclick: () => go('#/ia'), 'aria-label': 'IA' }, '✨'),
      h('button', { class: 'icon-btn', onclick: () => go('#/ajustes'), 'aria-label': 'Ajustes' }, '⚙️')),
    search, chipsBox, tagsBox, count, listBox,
    h('button', { class: 'fab', onclick: addSheet, 'aria-label': 'Nueva' }, '+'));
  refresh();
  return view;
}

function addSheet() {
  sheet('¿Qué querés anotar?', [
    ['🍳  Receta', () => go('#/nuevo/receta')],
    ['🏋️  Ejercicios del gym', () => go('#/nuevo/ejercicio')],
    ['📝  Nota', () => go('#/nuevo/nota')],
    ['✨  Pedirle a una IA que la arme', () => go('#/ia')],
  ]);
}

// ----- detail -----

let wakeLock = null;
async function toggleWake(btn) {
  try {
    if (wakeLock) { await wakeLock.release(); wakeLock = null; btn.textContent = '💡 Mantener pantalla encendida'; return; }
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; btn.textContent = '💡 Mantener pantalla encendida'; });
    btn.textContent = '💡 Pantalla encendida (tocá para soltar)';
  } catch (e) { toast('Tu navegador no deja mantener la pantalla encendida'); }
}

function viewDetail(n) {
  const checks = (items, ordered) => h('ul', { class: ordered ? 'steps' : 'checklist' },
    items.map((t) => h('li', { onclick: (e) => e.currentTarget.classList.toggle('done') }, h('span', { class: 'txt' }, t))));

  const view = h('div', { class: 'view' });
  const moreBtn = h('button', { class: 'icon-btn', 'aria-label': 'Más', onclick: () => sheet(n.titulo, [
    ['✨  Editar con una IA', () => askAI(n)],
    ['📤  Compartir / copiar texto', () => shareNote(n)],
    ['⧉  Duplicar', () => duplicate(n)],
    ['🗑  Eliminar', () => removeNote(n), 'danger'],
  ]) }, '⋯');
  const starBtn = h('button', {
    class: 'icon-btn', 'aria-label': 'Favorito',
    onclick: () => { n.favorito = !n.favorito; persist(); starBtn.textContent = n.favorito ? '★' : '☆'; },
  }, n.favorito ? '★' : '☆');

  view.append(
    h('header', { class: 'appbar' }, backBtn(), h('span', { style: 'flex:1' }), starBtn,
      h('button', { class: 'icon-btn text', onclick: () => go('#/e/' + n.id) }, 'Editar'), moreBtn));

  if (n.imagenes.length) {
    view.append(h('div', { class: 'gallery' + (n.imagenes.length > 1 ? ' multi' : '') },
      n.imagenes.map((id) => imgEl(id, { onclick: () => lightbox(id) }))));
  }

  view.append(h('div', {},
    h('span', { class: 'badge ' + n.tipo }, TIPOS[n.tipo].label),
    h('h1', { class: 'title' }, n.titulo)));

  if (n.etiquetas.length) view.append(h('div', { class: 'tagline' }, n.etiquetas.map((t) => h('span', { class: 'tag' }, '#' + t))));

  if (n.tipo === 'receta') {
    const meta = [n.tiempo && `⏱ ${n.tiempo}`, n.porciones && `🍽 ${n.porciones} porciones`].filter(Boolean);
    if (meta.length) view.append(h('div', { class: 'meta' }, meta.map((m) => h('span', {}, m))));
    if (navigator.wakeLock) {
      const wb = h('button', { class: 'btn small', onclick: () => toggleWake(wb) }, '💡 Mantener pantalla encendida');
      view.append(h('div', {}, wb));
    }
    if (n.ingredientes.length) view.append(h('section', { class: 'section' }, h('h3', {}, 'Ingredientes'), checks(n.ingredientes, false)));
    if (n.pasos.length) view.append(h('section', { class: 'section' }, h('h3', {}, 'Preparación'), checks(n.pasos, true)));
  } else if (n.tipo === 'ejercicio') {
    if (n.grupo) view.append(h('div', { class: 'meta' }, h('span', {}, '💪 ' + n.grupo)));
    if (n.ejercicios.length) {
      view.append(h('section', { class: 'section' }, h('h3', {}, 'Rutina'),
        h('div', { class: 'list', style: 'gap:8px' }, n.ejercicios.map((e) => h('div', { class: 'ex', onclick: (ev) => ev.currentTarget.classList.toggle('done') },
          h('div', { class: 'ex-name' }, e.nombre),
          h('div', { class: 'ex-stats' },
            (e.series || e.reps) && h('span', {}, e.series && e.reps ? `${e.series} × ${e.reps}` : e.series ? `${e.series} series` : `${e.reps} reps`),
            e.peso && h('span', {}, e.peso),
            e.descanso && h('span', {}, 'desc. ' + e.descanso)),
          e.notas && h('div', { class: 'ex-note' }, e.notas))))));
    }
  }
  if (n.notas) {
    view.append(h('section', { class: 'section' }, n.tipo !== 'nota' && h('h3', {}, 'Notas'), h('div', { class: 'prose' }, n.notas)));
  }
  view.append(h('p', { class: 'foot' }, `Actualizado ${fmtDate(n.actualizado)}`));
  cleanup = () => { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } };
  return view;
}

async function shareNote(n) {
  const text = toPlainText(n);
  if (navigator.share) {
    try { await navigator.share({ title: n.titulo, text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  toast((await copyText(text)) ? 'Copiado' : 'No se pudo copiar');
}

function duplicate(n) {
  const copy = JSON.parse(JSON.stringify(n));
  copy.id = uid();
  copy.titulo = n.titulo + ' (copia)';
  copy.creado = copy.actualizado = new Date().toISOString();
  copy.favorito = false;
  state.notas.push(copy);
  persist();
  go('#/n/' + copy.id, true);
  toast('Duplicada');
}

function removeNote(n) {
  sheet(`¿Eliminar “${n.titulo}”?`, [['Sí, eliminar', async () => {
    state.notas = state.notas.filter((x) => x.id !== n.id);
    persist();
    for (const id of n.imagenes) { urlCache.delete(id); await imgDel(id); }
    go('#/', true);
    toast('Eliminada');
  }, 'danger']]);
}

function askAI(n) {
  const cambio = h('textarea', { class: 'input', rows: 3, placeholder: 'Ej.: pasalo a versión vegetariana · agregá 1 serie a cada ejercicio · ordená los pasos' });
  let close;
  const copyBtn = h('button', {
    class: 'btn primary',
    onclick: async () => toast((await copyText(promptEdit(n, cambio.value.trim()))) ? 'Copiado. Pegalo en tu IA' : 'No se pudo copiar'),
  }, '📋 Copiar para la IA');
  close = overlay(h('div', { class: 'sheet' },
    h('h3', {}, 'Editar con una IA'),
    h('p', { class: 'hint' }, '1. Contale qué querés cambiar y copiá. 2. Abrí tu IA y pegalo. 3. Volvé y pegá su respuesta en ✨.'),
    cambio, copyBtn,
    h('div', { class: 'links' }, IA_LINKS.map(([name, url]) => h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Abrir ' + name))),
    h('button', { class: 'btn', onclick: () => { close(); go('#/ia'); } }, '✨ Ya tengo la respuesta'),
    h('button', { class: 'btn', onclick: () => close() }, 'Cerrar')));
}

// ----- editor -----

function autoGrow(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return ta;
}

function viewEdit(existing, tipoNuevo) {
  const isNew = !existing;
  const n = existing ? JSON.parse(JSON.stringify(existing)) : normalize({ tipo: tipoNuevo, titulo: '' });
  if (isNew) n.titulo = '';
  const added = [];            // photos added in this session (deleted again if you cancel)
  let imgs = [...n.imagenes];

  const f = {};
  const field = (label, node, hint) => h('div', { class: 'field' }, h('label', {}, label), node, hint && h('p', { class: 'hint' }, hint));
  f.titulo = h('input', { class: 'input', value: n.titulo, placeholder: n.tipo === 'receta' ? 'Ej.: Tarta de calabaza' : n.tipo === 'ejercicio' ? 'Ej.: Día de pierna' : 'Título', autocomplete: 'off' });
  f.etiquetas = h('input', { class: 'input', value: n.etiquetas.join(', '), placeholder: 'almuerzo, rápido, sin gluten', autocapitalize: 'none' });
  f.notas = autoGrow(h('textarea', { class: 'input', value: n.notas, placeholder: n.tipo === 'nota' ? 'Escribí tu nota…' : 'Observaciones, trucos, cómo salió…', rows: n.tipo === 'nota' ? 10 : 3 }));

  const photosBox = h('div', { class: 'photos' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => {
    for (const file of fileInput.files) {
      try {
        const blob = await resizeImage(file);
        const id = uid();
        await imgPut(id, blob);
        imgs.push(id); added.push(id);
      } catch (e) { toast('No pude cargar una de las fotos'); }
    }
    fileInput.value = '';
    drawPhotos();
  } });
  function drawPhotos() {
    photosBox.replaceChildren(
      ...imgs.map((id) => h('div', { class: 'photo' }, imgEl(id),
        h('button', { type: 'button', 'aria-label': 'Quitar foto', onclick: () => { imgs = imgs.filter((x) => x !== id); drawPhotos(); } }, '✕'))),
      h('button', { type: 'button', class: 'addphoto', onclick: () => fileInput.click() }, h('span', {}, '📷'), 'Foto'));
  }
  drawPhotos();

  const view = h('div', { class: 'view' },
    appbar(isNew ? `Nueva ${TIPOS[n.tipo].label.toLowerCase()}` : `Editar ${TIPOS[n.tipo].label.toLowerCase()}`,
      h('button', { class: 'icon-btn text', onclick: cancel }, 'Cancelar')),
    field('Título', f.titulo));

  if (n.tipo === 'receta') {
    f.porciones = h('input', { class: 'input', value: n.porciones, placeholder: '4', inputMode: 'numeric' });
    f.tiempo = h('input', { class: 'input', value: n.tiempo, placeholder: '45 min' });
    f.ingredientes = autoGrow(h('textarea', { class: 'input', value: n.ingredientes.join('\n'), rows: 5, placeholder: '200 g de harina\n2 huevos\nSal' }));
    f.pasos = autoGrow(h('textarea', { class: 'input', value: n.pasos.join('\n'), rows: 6, placeholder: 'Precalentar el horno\nMezclar todo\nHornear 30 minutos' }));
    view.append(
      h('div', { class: 'grid2' }, field('Porciones', f.porciones), field('Tiempo', f.tiempo)),
      field('Fotos', photosBox),
      field('Ingredientes', f.ingredientes, 'Uno por línea.'),
      field('Pasos', f.pasos, 'Uno por línea; se numeran solos.'));
  } else if (n.tipo === 'ejercicio') {
    f.grupo = h('input', { class: 'input', value: n.grupo, placeholder: 'Pecho y tríceps' });
    const rowsBox = h('div', { class: 'list', style: 'gap:10px' });
    const rows = n.ejercicios.length ? n.ejercicios : [blankEx()];
    function blankEx() { return { nombre: '', series: '', reps: '', peso: '', descanso: '', notas: '' }; }
    function drawRows() {
      rowsBox.replaceChildren(...rows.map((e, i) => {
        const inp = (key, ph, extra) => h('input', { class: 'input', value: e[key], placeholder: ph, oninput: (ev) => { e[key] = ev.target.value; }, ...extra });
        return h('div', { class: 'exrow' },
          inp('nombre', 'Ejercicio (ej. Press banca)', { autocomplete: 'off' }),
          h('div', { class: 'grid4' },
            inp('series', 'Series', { inputMode: 'numeric' }), inp('reps', 'Reps'), inp('peso', 'Peso'), inp('descanso', 'Desc.')),
          inp('notas', 'Notas'),
          h('div', { class: 'tools' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Subir', onclick: () => { if (i > 0) { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; drawRows(); } } }, '↑'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Bajar', onclick: () => { if (i < rows.length - 1) { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; drawRows(); } } }, '↓'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Quitar', onclick: () => { rows.splice(i, 1); drawRows(); } }, '🗑')));
      }));
    }
    drawRows();
    f.rows = rows;
    view.append(
      field('Grupo muscular', f.grupo),
      field('Fotos', photosBox),
      h('div', { class: 'field' }, h('label', {}, 'Ejercicios'), rowsBox,
        h('button', { type: 'button', class: 'btn', onclick: () => { rows.push(blankEx()); drawRows(); } }, '＋ Agregar ejercicio')));
  } else {
    view.append(field('Fotos', photosBox));
  }

  view.append(field(n.tipo === 'nota' ? 'Nota' : 'Notas', f.notas), field('Etiquetas', f.etiquetas, 'Separadas por comas.'), fileInput,
    h('div', { class: 'savebar' }, h('div', { class: 'inner' },
      h('button', { class: 'btn', onclick: cancel }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: save }, 'Guardar'))));

  async function cancel() {
    for (const id of added) { urlCache.delete(id); await imgDel(id); }
    back();
  }

  async function save() {
    const titulo = f.titulo.value.trim();
    if (!titulo) { toast('Ponele un título'); f.titulo.focus(); return; }
    n.titulo = titulo;
    n.etiquetas = tagsOf(f.etiquetas.value);
    n.notas = f.notas.value.trim();
    n.imagenes = imgs;
    if (n.tipo === 'receta') {
      n.porciones = f.porciones.value.trim();
      n.tiempo = f.tiempo.value.trim();
      n.ingredientes = lines(f.ingredientes.value);
      n.pasos = lines(f.pasos.value);
    } else if (n.tipo === 'ejercicio') {
      n.grupo = f.grupo.value.trim();
      n.ejercicios = f.rows.map((e) => ({ nombre: str(e.nombre), series: str(e.series), reps: str(e.reps), peso: str(e.peso), descanso: str(e.descanso), notas: str(e.notas) })).filter((e) => e.nombre);
    }
    n.actualizado = new Date().toISOString();
    if (isNew) state.notas.push(n); else state.notas[state.notas.indexOf(existing)] = n;
    if (!persist()) return;
    for (const id of existing ? existing.imagenes.filter((x) => !imgs.includes(x)) : []) { urlCache.delete(id); await imgDel(id); }
    added.length = 0;
    go('#/n/' + n.id, true);
  }

  return view;
}

// ----- IA page -----

function viewIA() {
  const view = h('div', { class: 'view' }, appbar('Con una IA', backBtn()));

  // 1) ask for something new
  let tipo = 'todo';
  const pedido = h('textarea', { class: 'input', rows: 3, placeholder: 'Ej.: receta de pollo al horno con papas, para 4, que no lleve más de 1 hora' });
  const seg = h('div', { class: 'seg' });
  const drawSeg = () => seg.replaceChildren(...[['todo', 'Lo que sea'], ['receta', 'Receta'], ['ejercicio', 'Gym'], ['nota', 'Nota']]
    .map(([k, label]) => h('button', { class: 'chip', 'aria-pressed': String(tipo === k), onclick: () => { tipo = k; drawSeg(); } }, label)));
  drawSeg();

  view.append(
    h('div', { class: 'panel' },
      h('h3', {}, '1 · Pedile algo nuevo'),
      h('p', {}, 'Escribí qué querés, copiá el pedido y pegalo en ChatGPT, Claude o Gemini. Ellos saben el formato del cuaderno.'),
      seg, pedido,
      h('button', { class: 'btn primary', onclick: async () => toast((await copyText(promptNew(tipo, pedido.value.trim()))) ? 'Copiado. Pegalo en tu IA' : 'No se pudo copiar') }, '📋 Copiar pedido'),
      h('div', { class: 'links' }, IA_LINKS.map(([name, url]) => h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Abrir ' + name)))));

  // 2) edit existing
  view.append(h('div', { class: 'panel' },
    h('h3', {}, '2 · Editar lo que ya tenés'),
    h('p', {}, 'Para una sola nota, abrila y tocá ⋯ → Editar con una IA. Para cambios grandes, copiá todo el cuaderno (sin fotos).'),
    h('button', { class: 'btn', disabled: !state.notas.length, onclick: async () => toast((await copyText(promptEdit(state.notas, ''))) ? `Copiadas ${state.notas.length} notas` : 'No se pudo copiar') }, '📋 Copiar todo el cuaderno')));

  // 3) paste back
  const box = h('textarea', { class: 'input', rows: 5, placeholder: 'Pegá acá la respuesta de la IA (el bloque JSON)' });
  const out = h('div', { hidden: true });
  const reviewBtn = h('button', { class: 'btn primary', onclick: review }, 'Revisar');
  let parsed = null;

  function listLine(n, tag) { return h('div', {}, `${TIPOS[n.tipo].emoji} ${n.titulo} `, h('span', { class: 'hint' }, tag)); }

  function review() {
    out.hidden = false;
    try {
      parsed = parsePayload(box.value);
    } catch (e) {
      parsed = null;
      out.replaceChildren(h('div', { class: 'preview' }, h('div', { class: 'err' }, e.message)));
      return;
    }
    const plan = planImport(parsed.notas);
    out.replaceChildren(
      h('div', { class: 'preview' },
        h('strong', {}, `${plan.nuevos.length} nueva${plan.nuevos.length === 1 ? '' : 's'} · ${plan.actualizados.length} actualizada${plan.actualizados.length === 1 ? '' : 's'}`),
        plan.nuevos.map((n) => listLine(n, 'nueva')),
        plan.actualizados.map(({ nuevo }) => listLine(nuevo, 'reemplaza la versión actual'))),
      h('button', { class: 'btn primary', style: 'margin-top:10px;width:100%', onclick: async () => {
        const p = await applyImport(parsed);
        toast(`Guardado: ${p.nuevos.length} nueva(s), ${p.actualizados.length} actualizada(s)`);
        const first = p.nuevos[0] || (p.actualizados[0] && p.actualizados[0].nuevo);
        if (first && p.nuevos.length + p.actualizados.length === 1) go('#/n/' + first.id, true); else go('#/', true);
      } }, 'Guardar en el cuaderno'));
  }

  view.append(h('div', { class: 'panel' },
    h('h3', {}, '3 · Pegá la respuesta'),
    h('p', {}, 'Antes de guardar vas a ver qué se agrega y qué se reemplaza. Si la IA agregó texto alrededor del JSON, no pasa nada.'),
    box,
    h('div', { class: 'row' },
      navigator.clipboard && navigator.clipboard.readText && h('button', { class: 'btn', onclick: async () => {
        try { box.value = await navigator.clipboard.readText(); review(); } catch (e) { box.focus(); toast('Pegá manualmente en el cuadro'); }
      } }, '📥 Pegar'),
      reviewBtn),
    out));
  return view;
}

// ----- settings -----

async function exportBackup() {
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

function viewSettings() {
  const view = h('div', { class: 'view' }, appbar('Ajustes', backBtn()));
  const lastBackup = h('p', {}, `Última copia: ${fmtDate(state.meta.lastBackup)}`);
  const importInput = h('input', { type: 'file', accept: 'application/json,.json,text/plain', hidden: true, onchange: async () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file) return;
    try {
      const parsed = parsePayload(await file.text());
      const plan = planImport(parsed.notas);
      sheet(`Importar ${parsed.notas.length} nota(s): ${plan.nuevos.length} nueva(s), ${plan.actualizados.length} reemplazan las actuales`, [
        ['Importar', async () => { await applyImport(parsed); toast('Importado'); go('#/', true); }, 'primary'],
      ]);
    } catch (e) { toast(e.message); }
  } });

  const storageLine = h('p', {}, 'Calculando espacio…');
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(({ usage }) => { storageLine.textContent = `Ocupa ${(usage / 1048576).toFixed(1)} MB en este dispositivo.`; });
  } else storageLine.textContent = '';
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  const stale = !state.meta.lastBackup || Date.now() - Date.parse(state.meta.lastBackup) > 30 * 864e5;
  view.append(
    h('div', { class: 'panel' },
      h('h3', {}, 'Copia de seguridad'),
      h('p', {}, 'Todo vive solo en este dispositivo (texto y fotos). Guardá una copia de vez en cuando: si borrás los datos del navegador o cambiás de teléfono, es lo único que te salva.'),
      lastBackup, stale && state.notas.length > 0 && h('p', { style: 'color:var(--danger);font-weight:600' }, 'Hace tiempo que no hacés una copia.'),
      h('button', { class: 'btn primary', onclick: async () => { if (await exportBackup()) { lastBackup.textContent = `Última copia: ${fmtDate(state.meta.lastBackup)}`; toast('Copia lista'); } } }, '💾 Guardar copia (.json con fotos)'),
      h('button', { class: 'btn', onclick: () => importInput.click() }, '📂 Importar copia o JSON'),
      importInput, storageLine),
    h('div', { class: 'panel' },
      h('h3', {}, 'Instalar en el iPhone'),
      h('ol', { class: 'how' },
        h('li', {}, 'Abrí esta página en Safari.'),
        h('li', {}, 'Tocá Compartir → “Agregar a pantalla de inicio”.'),
        h('li', {}, 'Abrila desde el ícono: funciona sin conexión.'))),
    h('div', { class: 'panel' },
      h('h3', {}, 'Zona peligrosa'),
      h('button', { class: 'btn danger', disabled: !state.notas.length, onclick: () => sheet('¿Borrar todo el cuaderno?', [['Sí, borrar todo', async () => {
        for (const id of await imgKeys()) await imgDel(id);
        urlCache.clear();
        state.notas = [];
        persist();
        go('#/', true);
        toast('Cuaderno vacío');
      }, 'danger']]) }, '🗑 Borrar todo')),
    h('p', { class: 'foot' }, `Cuaderno v${APP_VERSION}`));
  return view;
}

// ---------- boot ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
route();
