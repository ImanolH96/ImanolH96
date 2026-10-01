import { STORE_KEY } from '../config.js';
import { toast } from '../ui/overlays.js';

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

export const state = load();

export function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    toast('No se pudo guardar en el dispositivo');
    return false;
  }
}

export const byId = (id) => state.notas.find((n) => n.id === id);
