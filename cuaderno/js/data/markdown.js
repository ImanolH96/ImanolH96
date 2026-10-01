// Notes <-> Markdown. This is the format shared with the AIs and with .md files:
// a "---" header with key: value lines, then "## Section" blocks. Parsing is lenient
// (accents, case, bullets, bold, tables or lists) because the text usually comes from a chatbot.

const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const oneLine = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').trim();
const unbold = (s) => s.replace(/\*\*(.*?)\*\*/g, '$1').trim();

const HEADER = /^---[ \t]*\n\s*(?:tipo|t[ií]tulo|id)\s*:/im;
export const looksLikeMarkdown = (text) => HEADER.test(text);

const SECTIONS = {
  ingredientes: 'ingredientes',
  pasos: 'pasos', preparacion: 'pasos', instrucciones: 'pasos', procedimiento: 'pasos', elaboracion: 'pasos',
  ejercicios: 'ejercicios', rutina: 'ejercicios', entrenamiento: 'ejercicios',
  notas: 'notas', nota: 'notas', observaciones: 'notas', tips: 'notas', consejos: 'notas', comentarios: 'notas',
};
const COLUMN = {
  ejercicio: 'nombre', nombre: 'nombre', series: 'series', sets: 'series', reps: 'reps', repeticiones: 'reps',
  peso: 'peso', carga: 'peso', descanso: 'descanso', pausa: 'descanso', notas: 'notas', nota: 'notas', observaciones: 'notas',
};
const DEFAULT_COLUMNS = ['nombre', 'series', 'reps', 'peso', 'descanso', 'notas'];

// ---------- note -> markdown ----------

export function toMarkdown(n) {
  const out = ['---', `tipo: ${n.tipo}`, `titulo: ${oneLine(n.titulo)}`, `id: ${n.id}`];
  if (n.etiquetas.length) out.push(`etiquetas: ${n.etiquetas.join(', ')}`);
  if (n.favorito) out.push('favorito: si');
  if (n.tipo === 'receta') {
    if (n.porciones) out.push(`porciones: ${oneLine(n.porciones)}`);
    if (n.tiempo) out.push(`tiempo: ${oneLine(n.tiempo)}`);
  }
  if (n.tipo === 'ejercicio' && n.grupo) out.push(`grupo: ${oneLine(n.grupo)}`);
  out.push('---', '');

  if (n.tipo === 'receta') {
    if (n.ingredientes.length) out.push('## Ingredientes', ...n.ingredientes.map((i) => `- ${i}`), '');
    if (n.pasos.length) out.push('## Pasos', ...n.pasos.map((p, i) => `${i + 1}. ${p}`), '');
  } else if (n.tipo === 'ejercicio' && n.ejercicios.length) {
    const cell = (v) => oneLine(v).replace(/\|/g, '/');
    out.push('## Ejercicios', '| Ejercicio | Series | Reps | Peso | Descanso | Notas |', '|---|---|---|---|---|---|',
      ...n.ejercicios.map((e) => `| ${[e.nombre, e.series, e.reps, e.peso, e.descanso, e.notas].map(cell).join(' | ')} |`), '');
  }
  if (n.notas) out.push(...(n.tipo === 'nota' ? [n.notas] : ['## Notas', n.notas]), '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export const toMarkdownAll = (notas) => notas.map(toMarkdown).join('\n');

// ---------- markdown -> raw notes (run them through normalize() afterwards) ----------

export function parseMarkdown(text) {
  // chatbots wrap the answer in a ```markdown fence so it can be copied
  const blocks = [...text.matchAll(/```[ \t]*(?:markdown|md)?[ \t]*\n([\s\S]*?)\n[ \t]*```/gi)].map((m) => m[1]).filter((b) => HEADER.test(b));
  const lines = (blocks.length ? blocks.join('\n\n') : text).replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/); // templates carry <!-- hints -->
  const isStart = (i) => lines[i].trim() === '---' && /^\s*(?:tipo|t[ií]tulo|id)\s*:/i.test(lines[i + 1] || '');

  const notes = [];
  let i = 0;
  while (i < lines.length) {
    if (!isStart(i)) { i++; continue; }
    i++;
    const head = [];
    while (i < lines.length && lines[i].trim() !== '---') head.push(lines[i++]);
    i++;
    const body = [];
    while (i < lines.length && !isStart(i)) body.push(lines[i++]);
    notes.push(buildNote(head, body));
  }
  return notes;
}

function buildNote(head, body) {
  const meta = {};
  for (const l of head) {
    const m = l.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    if (m) meta[plain(m[1])] = m[2].replace(/\s+#\s.*$/, '').trim().replace(/^["']|["']$/g, ''); // "value   # hint"
  }
  const tags = (meta.etiquetas || meta.tags || '').replace(/^\[|\]$/g, '');
  const raw = {
    id: meta.id, tipo: meta.tipo, titulo: meta.titulo, etiquetas: tags,
    favorito: ['si', 'true', 'yes', '1'].includes(plain(meta.favorito || '')),
    porciones: meta.porciones, tiempo: meta.tiempo, grupo: meta.grupo || meta.musculo,
  };

  while (body.length && /^```\w*\s*$/.test(body[body.length - 1].trim())) body.pop();
  const firstReal = body.findIndex((l) => l.trim());
  if (firstReal >= 0 && /^#\s+/.test(body[firstReal]) && !raw.titulo) {
    raw.titulo = body[firstReal].replace(/^#\s+/, '').trim();
    body.splice(firstReal, 1);
  }

  if (plain(raw.tipo || '').startsWith('not')) {          // a note is all body, headings included
    raw.notas = body.join('\n').trim();
    return raw;
  }

  const sections = { intro: [] };
  let cur = 'intro';
  for (const l of body) {
    const m = l.match(/^#{1,2}\s+(.*?)\s*#*\s*$/);
    if (m) {
      cur = SECTIONS[plain(m[1]).replace(/[:：]$/, '')] || 'x:' + m[1].trim();
      sections[cur] = sections[cur] || [];
    } else sections[cur].push(l);
  }

  const items = (ls) => ls.map((l) => unbold(l.replace(/^#{3,}\s*(.*?)\s*#*$/, (_, t) => (t.endsWith(':') ? t : t + ':'))));
  raw.ingredientes = items(sections.ingredientes || []);
  raw.pasos = items(sections.pasos || []);
  raw.ejercicios = parseExercises(sections.ejercicios || []);
  const extra = Object.keys(sections).filter((k) => k.startsWith('x:')).map((k) => `${k.slice(2)}\n${sections[k].join('\n').trim()}`);
  raw.notas = [sections.intro.join('\n').trim(), (sections.notas || []).join('\n').trim(), ...extra].filter(Boolean).join('\n\n');
  return raw;
}

function parseExercises(ls) {
  const out = [];
  const rows = ls.filter((l) => l.trim().startsWith('|'));
  if (rows.length) {
    const cells = (l) => l.trim().replace(/^\||\|\s*$/g, '').split('|').map((c) => unbold(c));
    let cols = DEFAULT_COLUMNS;
    let first = true;
    for (const r of rows) {
      const c = cells(r);
      if (c.every((x) => /^:?-+:?$/.test(x) || !x)) continue;                 // |---|---| or empty
      if (first) {
        first = false;
        const mapped = c.map((x) => COLUMN[plain(x)]);
        if (mapped.filter(Boolean).length >= 2) { cols = mapped; continue; }  // header row
      }
      const e = { nombre: '', series: '', reps: '', peso: '', descanso: '', notas: '' };
      c.forEach((v, i) => { if (cols[i]) e[cols[i]] = v; });
      out.push(e);
    }
    return out;
  }
  // fallback: "- Press banca: 4x8-10, 60 kg, descanso 90 s"
  for (const l of ls) {
    if (!/^\s*(?:[-*•]|\d+[.)])\s+/.test(l)) continue;
    const t = unbold(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''));
    const m = t.match(/^(.*?)\s*(?::|—|–| - )\s*(.*)$/);
    const rest = m ? m[2] : '';
    const sr = rest.match(/(\d+)\s*[x×]\s*(\d+(?:\s*[-–]\s*\d+)?)/i);
    const peso = rest.match(/(\d+(?:[.,]\d+)?\s*(?:kg|lbs?|libras?))/i);
    const desc = rest.match(/desc(?:anso)?\.?\s*:?\s*(\d+\s*(?:seg\w*|min\w*|s\b))/i);
    out.push({
      nombre: m ? m[1] : t, series: sr ? sr[1] : '', reps: sr ? sr[2].replace(/\s/g, '') : '',
      peso: peso ? peso[1] : '', descanso: desc ? desc[1] : '', notas: sr || peso || desc ? '' : rest,
    });
  }
  return out;
}
