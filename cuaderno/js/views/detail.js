import { TIPOS, IA_LINKS } from '../config.js';
import { h, uid } from '../core/dom.js';
import { go, onLeave } from '../core/router.js';
import { state, persist } from '../core/store.js';
import { imgEl, removeImage } from '../data/images.js';
import { toPlainText } from '../data/model.js';
import { toMarkdown } from '../data/markdown.js';
import { promptEdit } from '../data/ai.js';
import { overlay, sheet, lightbox, toast } from '../ui/overlays.js';
import { copyText, fmtDate, saveFile } from '../ui/platform.js';
import { backBtn } from '../ui/components.js';

let wakeLock = null;
async function toggleWake(btn) {
  try {
    if (wakeLock) { await wakeLock.release(); wakeLock = null; btn.textContent = '💡 Mantener pantalla encendida'; return; }
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; btn.textContent = '💡 Mantener pantalla encendida'; });
    btn.textContent = '💡 Pantalla encendida (tocá para soltar)';
  } catch (e) { toast('Tu navegador no deja mantener la pantalla encendida'); }
}

export function viewDetail(n) {
  const checks = (items, ordered) => h('ul', { class: ordered ? 'steps' : 'checklist' },
    items.map((t) => h('li', { onclick: (e) => e.currentTarget.classList.toggle('done') }, h('span', { class: 'txt' }, t))));

  const view = h('div', { class: 'view' });
  const moreBtn = h('button', { class: 'icon-btn', 'aria-label': 'Más', onclick: () => sheet(n.titulo, [
    ['✨  Editar con una IA', () => askAI(n)],
    ['📤  Compartir / copiar texto', () => shareNote(n)],
    ['📋  Copiar como Markdown', async () => toast((await copyText(toMarkdown(n))) ? 'Markdown copiado' : 'No se pudo copiar')],
    ['⬇️  Descargar .md', () => saveFile(fileName(n), new Blob([toMarkdown(n)], { type: 'text/markdown' }))],
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
  onLeave(() => { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } });
  return view;
}

const fileName = (n) => (n.titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'nota') + '.md';

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
    for (const id of n.imagenes) await removeImage(id);
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
