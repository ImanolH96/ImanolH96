import { TIPOS } from '../config.js';
import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import { state } from '../core/store.js';
import { imgEl } from '../data/images.js';
import { sheet } from '../ui/overlays.js';

// Filter state survives navigating into a note and back.
const filters = { q: '', tipo: 'todo', tag: '' };

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

export function viewList() {
  const view = h('div', { class: 'view', 'data-list': '' });
  const listBox = h('div', { class: 'list' });
  const chipsBox = h('div', { class: 'chips' });
  const tagsBox = h('div', { class: 'chips tags' });
  const count = h('p', { class: 'count' });

  function refresh() {
    const all = state.notas;
    chipsBox.replaceChildren(...[['todo', 'Todo'], ['receta', 'Recetas'], ['ejercicio', 'Ejercicios'], ['nota', 'Notas'], ['fav', '★ Favoritos']]
      .map(([k, label]) => h('button', {
        class: 'chip', 'aria-pressed': String(filters.tipo === k),
        onclick: () => { filters.tipo = k; filters.tag = ''; refresh(); },
      }, label)));

    const scoped = all.filter((n) => filters.tipo === 'todo' || (filters.tipo === 'fav' ? n.favorito : n.tipo === filters.tipo));
    const tagCount = {};
    scoped.forEach((n) => n.etiquetas.forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
    const tags = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a] || a.localeCompare(b));
    if (filters.tag && !tags.includes(filters.tag)) filters.tag = '';
    tagsBox.hidden = !tags.length;
    tagsBox.replaceChildren(...tags.map((t) => h('button', {
      class: 'chip', 'aria-pressed': String(filters.tag === t),
      onclick: () => { filters.tag = filters.tag === t ? '' : t; refresh(); },
    }, '#' + t)));

    const shown = scoped
      .filter((n) => (!filters.tag || n.etiquetas.includes(filters.tag)) && matches(n, filters.q))
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
    class: 'search', type: 'search', placeholder: 'Buscar recetas, ejercicios, notas…', value: filters.q,
    enterKeyHint: 'search', autocomplete: 'off',
    oninput: () => { filters.q = search.value; refresh(); },
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
