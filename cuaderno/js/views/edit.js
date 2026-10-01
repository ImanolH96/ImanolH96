import { TIPOS } from '../config.js';
import { h, uid } from '../core/dom.js';
import { go, back } from '../core/router.js';
import { state, persist } from '../core/store.js';
import { imgEl, imgPut, removeImage, resizeImage } from '../data/images.js';
import { normalize, tagsOf, lines, str } from '../data/model.js';
import { toast } from '../ui/overlays.js';
import { appbar } from '../ui/components.js';

function autoGrow(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return ta;
}

export function viewEdit(existing, tipoNuevo) {
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
    for (const id of added) await removeImage(id);
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
    for (const id of existing ? existing.imagenes.filter((x) => !imgs.includes(x)) : []) await removeImage(id);
    added.length = 0;
    go('#/n/' + n.id, true);
  }

  return view;
}
