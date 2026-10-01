import { TIPOS, IA_LINKS } from '../config.js';
import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import { state } from '../core/store.js';
import { promptNew, promptEdit, parsePayload, planImport, applyImport } from '../data/ai.js';
import { toast } from '../ui/overlays.js';
import { copyText } from '../ui/platform.js';
import { appbar, backBtn } from '../ui/components.js';

export function viewIA() {
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
