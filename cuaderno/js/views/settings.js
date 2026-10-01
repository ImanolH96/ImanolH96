import { APP_VERSION } from '../config.js';
import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import { state, persist } from '../core/store.js';
import { clearImages } from '../data/images.js';
import { parsePayload, planImport, applyImport } from '../data/ai.js';
import { exportBackup, exportMarkdown } from '../data/backup.js';
import { checkRepoChanges } from '../data/repo.js';
import { repoSyncSheet } from '../ui/repoSheet.js';
import { sheet, toast } from '../ui/overlays.js';
import { fmtDate } from '../ui/platform.js';
import { appbar, backBtn } from '../ui/components.js';

export function viewSettings() {
  const view = h('div', { class: 'view' }, appbar('Ajustes', backBtn()));
  const lastBackup = h('p', {}, `Última copia: ${fmtDate(state.meta.lastBackup)}`);
  const importInput = h('input', { type: 'file', accept: '.md,.markdown,.txt,.json,text/*,application/json', multiple: true, hidden: true, onchange: async () => {
    const files = [...importInput.files];
    importInput.value = '';
    if (!files.length) return;
    try {
      const parsed = parsePayload((await Promise.all(files.map((f) => f.text()))).join('\n\n'));
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

  const repoLine = h('p', {}, `Última sincronización: ${fmtDate(state.meta.lastRepoSync)}`);
  const repoBtn = h('button', { class: 'btn', onclick: async () => {
    repoBtn.disabled = true;
    try {
      const plan = await checkRepoChanges(true);
      if (!plan.total) toast('Todo al día');
      else repoSyncSheet(plan, () => { repoLine.textContent = `Última sincronización: ${fmtDate(state.meta.lastRepoSync)}`; });
    } catch (e) { toast(e.message); }
    repoBtn.disabled = false;
  } }, '🔄 Buscar cambios en el repo');

  const stale = !state.meta.lastBackup || Date.now() - Date.parse(state.meta.lastBackup) > 30 * 864e5;
  view.append(
    h('div', { class: 'panel' },
      h('h3', {}, 'Copia de seguridad'),
      h('p', {}, 'Todo vive solo en este dispositivo (texto y fotos). Guardá una copia de vez en cuando: si borrás los datos del navegador o cambiás de teléfono, es lo único que te salva.'),
      lastBackup, stale && state.notas.length > 0 && h('p', { style: 'color:var(--danger);font-weight:600' }, 'Hace tiempo que no hacés una copia.'),
      h('button', { class: 'btn primary', onclick: async () => { if (await exportBackup()) { lastBackup.textContent = `Última copia: ${fmtDate(state.meta.lastBackup)}`; toast('Copia lista'); } } }, '💾 Guardar copia (.json con fotos)'),
      h('button', { class: 'btn', onclick: () => importInput.click() }, '📂 Importar copia (.json) o notas (.md)'),
      h('button', { class: 'btn', disabled: !state.notas.length, onclick: async () => { if (await exportMarkdown()) toast('Markdown listo'); } }, '📝 Exportar todo como Markdown (sin fotos)'),
      importInput, storageLine),
    h('div', { class: 'panel' },
      h('h3', {}, 'Contenido del repo'),
      h('p', {}, 'Las notas que estén como archivos .md en la carpeta contenido/ del sitio se pueden traer acá. Solo se ofrece importar lo que cambió, y siempre ves antes qué se reemplaza.'),
      repoLine, repoBtn),
    h('div', { class: 'panel' },
      h('h3', {}, 'Instalar en el iPhone'),
      h('ol', { class: 'how' },
        h('li', {}, 'Abrí esta página en Safari.'),
        h('li', {}, 'Tocá Compartir → “Agregar a pantalla de inicio”.'),
        h('li', {}, 'Abrila desde el ícono: funciona sin conexión.'))),
    h('div', { class: 'panel' },
      h('h3', {}, 'Zona peligrosa'),
      h('button', { class: 'btn danger', disabled: !state.notas.length, onclick: () => sheet('¿Borrar todo el cuaderno?', [['Sí, borrar todo', async () => {
        await clearImages();
        state.notas = [];
        persist();
        go('#/', true);
        toast('Cuaderno vacío');
      }, 'danger']]) }, '🗑 Borrar todo')),
    h('p', { class: 'foot' }, `Cuaderno v${APP_VERSION}`));
  return view;
}
