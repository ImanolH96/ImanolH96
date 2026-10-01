import { TIPOS } from './config.js';
import { startRouter } from './core/router.js';
import { byId } from './core/store.js';
import { viewList } from './views/list.js';
import { viewDetail } from './views/detail.js';
import { viewEdit } from './views/edit.js';
import { viewIA } from './views/ia.js';
import { viewSettings } from './views/settings.js';

startRouter(document.getElementById('app'), {
  '': viewList,
  n: (id) => byId(id) && viewDetail(byId(id)),
  e: (id) => byId(id) && viewEdit(byId(id)),
  nuevo: (tipo) => TIPOS[tipo] && viewEdit(null, tipo),
  ia: viewIA,
  ajustes: viewSettings,
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
