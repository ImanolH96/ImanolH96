import { TIPOS } from '../config.js';
import { state, byId, persist } from '../core/store.js';
import { imgPut, imgKeys, dataURLToBlob } from './images.js';
import { normalize } from './model.js';
import { looksLikeMarkdown, parseMarkdown, toMarkdownAll } from './markdown.js';

const PROMPT_INTRO =
  'Estás ayudándome con mi cuaderno personal (recetas, ejercicios del gimnasio y notas). ' +
  'Respondé SOLO con un bloque de código markdown (```markdown), sin texto antes ni después, con este formato. ' +
  'Podés devolver varias notas una detrás de otra. Todo el contenido en español.';

const FORMAT_DOC = `Cada nota empieza con un encabezado entre líneas "---" y sigue con secciones "## ...":
- "tipo": receta, ejercicio o nota
- "titulo": texto
- "etiquetas": palabras cortas en minúscula separadas por comas
- "id": si estás editando algo que ya existe, conservá el id tal cual; si es nuevo, omitilo
- Solo recetas: "porciones", "tiempo", y las secciones "## Ingredientes" (lista con "-", con cantidad) y "## Pasos" (lista numerada)
- Solo ejercicios: "grupo" y la sección "## Ejercicios" como tabla con columnas Ejercicio | Series | Reps | Peso | Descanso | Notas
- "## Notas" (opcional): observaciones. En una nota de tipo "nota", todo lo que sigue al encabezado es el contenido.

Ejemplo de receta:
\`\`\`markdown
---
tipo: receta
titulo: Tortilla de papas
etiquetas: cena, rapido
porciones: 4
tiempo: 40 min
---
## Ingredientes
- 4 papas
- 6 huevos
- 1 cebolla
## Pasos
1. Pelar y cortar las papas
2. Freírlas a fuego bajo
3. Mezclar con los huevos y cuajar
## Notas
Queda mejor con papas amarillas.
\`\`\`

Ejemplo de ejercicios:
\`\`\`markdown
---
tipo: ejercicio
titulo: Día de pecho
etiquetas: gym
grupo: Pecho y tríceps
---
## Ejercicios
| Ejercicio | Series | Reps | Peso | Descanso | Notas |
|---|---|---|---|---|---|
| Press banca | 4 | 8-10 | 60 kg | 90 s | |
| Fondos | 3 | 12 | peso corporal | 60 s | |
\`\`\``;

export function promptNew(tipo, pedido) {
  const que = tipo === 'todo' ? 'una receta, una rutina de ejercicios o una nota (lo que corresponda)' : `una ${TIPOS[tipo].label.toLowerCase()}`;
  return `${PROMPT_INTRO}\n\n${FORMAT_DOC}\n\nQuiero que me armes ${que}.\nPedido: ${pedido || '(completá acá lo que querés)'}`;
}

export function promptEdit(notas, cambio) {
  const md = toMarkdownAll(Array.isArray(notas) ? notas : [notas]); // photos stay on the phone
  return `${PROMPT_INTRO}\n\n${FORMAT_DOC}\n\nEsto es lo que ya tengo guardado:\n\`\`\`markdown\n${md}\`\`\`\n\n` +
    `Aplicá este cambio y devolvé completo lo que modifiques (conservando los id): ${cambio || '(completá acá lo que querés cambiar)'}`;
}

// Accepts markdown (what the app asks the AIs for) or JSON (older answers and the .json backup).
export function parsePayload(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Pegá primero la respuesta de la IA.');
  if (looksLikeMarkdown(t)) {
    const notas = parseMarkdown(t).map(normalize).filter(Boolean);
    if (notas.length) return { notas, imagenes: null };
  }
  return parseJSON(t);
}

function parseJSON(text) {
  let t = text;
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  let data;
  try {
    data = JSON.parse(t);
  } catch (e) {
    const fixed = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    const a = fixed.search(/[[{]/);
    const b = Math.max(fixed.lastIndexOf('}'), fixed.lastIndexOf(']'));
    if (a < 0 || b <= a) throw new Error('No encontré notas. Esperaba markdown con un encabezado "---" (tipo, titulo…) o un JSON.');
    try {
      data = JSON.parse(fixed.slice(a, b + 1));
    } catch (e2) {
      throw new Error('El JSON no es válido (' + e2.message + '). Pedile a la IA que lo corrija.');
    }
  }
  const items = Array.isArray(data) ? data : Array.isArray(data.notas) ? data.notas : [data];
  const notas = items.map(normalize).filter(Boolean);
  if (!notas.length) throw new Error('No encontré ninguna nota.');
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
