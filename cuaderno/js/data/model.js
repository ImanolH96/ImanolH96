import { TIPOS } from '../config.js';
import { uid } from '../core/dom.js';

// ---------- normalizing notes (accepts whatever an AI gives back) ----------

export const str = (v) => (v == null ? '' : String(v).trim());

export function lines(v) {
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

export function tagsOf(v) {
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

export function normalize(raw) {
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

export function toPlainText(n) {
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

export function exerciseSummary(e) {
  const sr = e.series && e.reps ? `${e.series}×${e.reps}` : e.series || e.reps;
  return [e.nombre, sr, e.peso, e.descanso && `desc. ${e.descanso}`].filter(Boolean).join(' · ');
}
