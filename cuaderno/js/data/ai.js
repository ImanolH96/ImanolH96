import { TIPOS } from '../config.js';
import { state, byId, persist } from '../core/store.js';
import { imgPut, imgKeys, dataURLToBlob } from './images.js';
import { normalize } from './model.js';

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

export function promptNew(tipo, pedido) {
  const que = tipo === 'todo' ? 'una receta, una rutina de ejercicios o una nota (lo que corresponda)' : `una ${TIPOS[tipo].label.toLowerCase()}`;
  return `${PROMPT_INTRO}\n\n${SCHEMA_DOC}\n\nQuiero que me armes ${que}.\nPedido: ${pedido || '(completá acá lo que querés)'}`;
}

export function promptEdit(notas, cambio) {
  const lista = Array.isArray(notas) ? notas.map(forAI) : forAI(notas);
  return `${PROMPT_INTRO}\n\n${SCHEMA_DOC}\n\nEsto es lo que ya tengo guardado:\n${fence(lista)}\n\n` +
    `Aplicá este cambio y devolvé el JSON completo de lo que modifiques (conservando los id): ${cambio || '(completá acá lo que querés cambiar)'}`;
}

export function parsePayload(text) {
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

export function planImport(notas) {
  const nuevos = [];
  const actualizados = [];
  for (const n of notas) {
    const old = byId(n.id);
    if (old) actualizados.push({ old, nuevo: n }); else nuevos.push(n);
  }
  return { nuevos, actualizados };
}

export async function applyImport(parsed) {
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
