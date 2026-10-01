import { TIPOS } from '../config.js';
import { h } from '../core/dom.js';
import { applyRepoSync } from '../data/repo.js';
import { overlay, toast } from './overlays.js';

// Shows what changed in contenido/ and applies it on confirmation.
export function repoSyncSheet(plan, onDone) {
  const row = (it, tag) => h('div', {}, `${TIPOS[it.note.tipo].emoji} ${it.note.titulo} `, h('span', { class: 'hint' }, tag));
  const close = overlay(h('div', { class: 'sheet' },
    h('h3', {}, 'Cambios en el repo'),
    h('p', { class: 'hint' }, 'Lo que cambió en contenido/ reemplaza la versión que tenés acá, incluidas las ediciones que hayas hecho en la app.'),
    h('div', { class: 'preview' }, plan.nuevos.map((it) => row(it, 'nueva')), plan.actualizados.map((it) => row(it, 'reemplaza la actual'))),
    h('button', { class: 'btn primary', onclick: async () => {
      await applyRepoSync(plan);
      close();
      toast(`Sincronizado: ${plan.nuevos.length} nueva(s), ${plan.actualizados.length} actualizada(s)`);
      if (onDone) onDone();
    } }, 'Aplicar'),
    h('button', { class: 'btn', onclick: () => close() }, 'Ahora no')));
}
