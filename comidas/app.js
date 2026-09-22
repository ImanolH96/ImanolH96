'use strict';

const STORE_KEY = 'comidas-libres:v1';
const MEALS = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Snack'];
// Excel column headers <-> entry fields
const COLUMNS = [
  ['fecha', 'Fecha'],
  ['hora', 'Hora'],
  ['momento', 'Momento'],
  ['descripcion', 'Descripción'],
  ['lugar', 'Dónde / con quién'],
  ['disfrute', 'Disfrute (1-5)'],
  ['notas', 'Notas'],
  ['id', 'ID'],
];

const $ = (id) => document.getElementById(id);

// ---------- storage ----------

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through to defaults */ }
  return { settings: { quota: 2, weekStart: 1 }, entries: [] };
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('No se pudo guardar en el dispositivo');
  }
}

let state = load();
let editingId = null;
let meal = MEALS[1];
let rating = 0;

// Ask iOS not to evict our storage (best effort).
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- dates ----------

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function weekBounds(ref = new Date()) {
  const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const diff = (start.getDay() - state.settings.weekStart + 7) % 7;
  start.setDate(start.getDate() - diff);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return [isoDate(start), isoDate(end)];
}

const fmtDay = (s) => parseDate(s).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });

// ---------- render ----------

function renderQuota() {
  const [from, to] = weekBounds();
  const used = state.entries.filter((e) => e.fecha >= from && e.fecha <= to).length;
  const quota = Number(state.settings.quota) || 0;
  const over = used > quota;
  $('quotaUsed').textContent = used;
  $('quotaUsed').classList.toggle('over', over);
  $('quotaText').textContent = over
    ? `de ${quota} esta semana — te pasaste por ${used - quota}`
    : `de ${quota} esta semana — te quedan ${quota - used}`;
  $('quotaRange').textContent = `${fmtDay(from)} → ${fmtDay(to)}`;
  const bar = $('quotaBar');
  bar.style.width = `${quota ? Math.min(100, (used / quota) * 100) : (used ? 100 : 0)}%`;
  bar.classList.toggle('over', over);
}

function renderChips() {
  $('fMeal').innerHTML = '';
  for (const m of MEALS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m;
    b.className = m === meal ? 'on' : '';
    b.onclick = () => { meal = m; renderChips(); };
    $('fMeal').appendChild(b);
  }
}

function renderStars() {
  $('fRating').innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = '⭐';
    b.className = i <= rating ? 'on' : '';
    b.onclick = () => { rating = rating === i ? 0 : i; renderStars(); };
    $('fRating').appendChild(b);
  }
}

function renderList() {
  const list = $('list');
  list.innerHTML = '';
  const sorted = [...state.entries].sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
  if (!sorted.length) {
    list.innerHTML = '<li class="empty">Todavía no registraste comidas libres</li>';
    return;
  }
  for (const e of sorted) {
    const li = document.createElement('li');
    const body = document.createElement('div');
    body.className = 'grow';
    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = e.descripcion;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [fmtDay(e.fecha), e.hora, e.lugar].filter(Boolean).join(' · ')
      + (e.disfrute ? ' · ' + '⭐'.repeat(e.disfrute) : '');
    body.append(desc, meta);
    if (e.notas) {
      const notes = document.createElement('div');
      notes.className = 'meta';
      notes.textContent = e.notas;
      body.appendChild(notes);
    }
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = e.momento;
    const edit = document.createElement('button');
    edit.className = 'icon-btn';
    edit.textContent = '✏️';
    edit.setAttribute('aria-label', 'Editar');
    edit.onclick = () => startEdit(e.id);
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '🗑️';
    del.setAttribute('aria-label', 'Borrar');
    del.onclick = () => remove(e.id);
    const right = document.createElement('div');
    right.style.textAlign = 'right';
    right.append(tag, document.createElement('br'), edit, del);
    li.append(body, right);
    list.appendChild(li);
  }
}

function render() {
  renderQuota();
  renderChips();
  renderStars();
  renderList();
}

// ---------- form ----------

function resetForm() {
  const now = new Date();
  editingId = null;
  $('form').reset();
  $('fDate').value = isoDate(now);
  $('fTime').value = isoTime(now);
  meal = guessMeal(now);
  rating = 0;
  $('formTitle').textContent = 'Registrar comida libre';
  $('btnSave').textContent = 'Guardar';
  $('btnCancel').classList.add('hidden');
  render();
}

function guessMeal(d) {
  const h = d.getHours();
  if (h < 11) return 'Desayuno';
  if (h < 16) return 'Almuerzo';
  if (h < 20) return 'Merienda';
  return 'Cena';
}

function startEdit(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  $('fDate').value = e.fecha;
  $('fTime').value = e.hora;
  $('fDesc').value = e.descripcion;
  $('fPlace').value = e.lugar || '';
  $('fNotes').value = e.notas || '';
  meal = e.momento;
  rating = e.disfrute || 0;
  $('formTitle').textContent = 'Editar comida libre';
  $('btnSave').textContent = 'Guardar cambios';
  $('btnCancel').classList.remove('hidden');
  render();
  $('formTitle').scrollIntoView({ behavior: 'smooth' });
}

function remove(id) {
  if (!confirm('¿Borrar este registro?')) return;
  state.entries = state.entries.filter((e) => e.id !== id);
  persist();
  if (editingId === id) resetForm(); else render();
  toast('Registro borrado');
}

$('form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const entry = {
    id: editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    fecha: $('fDate').value,
    hora: $('fTime').value,
    momento: meal,
    descripcion: $('fDesc').value.trim(),
    lugar: $('fPlace').value.trim(),
    disfrute: rating,
    notas: $('fNotes').value.trim(),
  };
  if (editingId) {
    state.entries = state.entries.map((e) => (e.id === editingId ? entry : e));
  } else {
    state.entries.push(entry);
  }
  persist();
  toast(editingId ? 'Cambios guardados' : 'Comida libre registrada');
  resetForm();
});

$('btnCancel').onclick = resetForm;

// ---------- settings ----------

$('btnSettings').onclick = () => {
  const s = $('settings');
  s.classList.toggle('hidden');
  $('sQuota').value = state.settings.quota;
  $('sWeekStart').value = String(state.settings.weekStart);
  if (!s.classList.contains('hidden')) s.scrollIntoView({ behavior: 'smooth' });
};

$('btnSaveSettings').onclick = () => {
  state.settings.quota = Math.max(0, parseInt($('sQuota').value, 10) || 0);
  state.settings.weekStart = Number($('sWeekStart').value);
  persist();
  $('settings').classList.add('hidden');
  render();
  toast('Ajustes guardados');
};

$('btnWipe').onclick = () => {
  if (!confirm('¿Borrar TODOS los registros? Exportá un Excel antes si querés conservarlos.')) return;
  state.entries = [];
  persist();
  resetForm();
  toast('Datos borrados');
};

// ---------- Excel ----------

async function exportXlsx() {
  const rows = [...state.entries]
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))
    .map((e) => Object.fromEntries(COLUMNS.map(([k, h]) => [h, e[k] ?? ''])));
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS.map(([, h]) => h) });
  ws['!cols'] = [12, 7, 11, 40, 22, 12, 40, 12].map((wch) => ({ wch }));

  // Weekly summary sheet
  const weeks = {};
  for (const e of state.entries) {
    const [from] = weekBounds(parseDate(e.fecha));
    weeks[from] = (weeks[from] || 0) + 1;
  }
  const summary = Object.keys(weeks).sort().map((w) => ({
    'Semana desde': w,
    'Comidas libres': weeks[w],
    'Permitidas': Number(state.settings.quota),
    'Diferencia': Number(state.settings.quota) - weeks[w],
  }));
  const ws2 = XLSX.utils.json_to_sheet(summary, { header: ['Semana desde', 'Comidas libres', 'Permitidas', 'Diferencia'] });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Comidas');
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen semanal');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const name = `comidas-libres-${isoDate(new Date())}.xlsx`;
  const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const file = new File([buf], name, { type });

  // iOS: the share sheet lets you "Guardar en Archivos", AirDrop, WhatsApp, etc.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cellToDate(v) {
  if (v instanceof Date) return isoDate(v);
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return `${d.y}-${pad(d.m)}-${pad(d.d)}`; }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // dd/mm/yyyy
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : s.slice(0, 10);
}

function cellToTime(v) {
  if (typeof v === 'number') { const mins = Math.round((v % 1) * 1440); return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`; }
  return String(v || '00:00').trim().slice(0, 5);
}

async function importXlsx(file) {
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
  const ws = wb.Sheets['Comidas'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const imported = [];
  for (const r of rows) {
    const e = Object.fromEntries(COLUMNS.map(([k, h]) => [k, r[h]]));
    if (!e.fecha || !e.descripcion) continue;
    imported.push({
      id: String(e.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6))),
      fecha: cellToDate(e.fecha),
      hora: cellToTime(e.hora),
      momento: MEALS.includes(e.momento) ? e.momento : 'Snack',
      descripcion: String(e.descripcion),
      lugar: String(e.lugar || ''),
      disfrute: Math.max(0, Math.min(5, parseInt(e.disfrute, 10) || 0)),
      notas: String(e.notas || ''),
    });
  }
  if (!imported.length) { toast('No encontré filas válidas en el archivo'); return; }
  const replace = confirm(
    `Encontré ${imported.length} registros.\n\nAceptar = reemplazar todo lo actual\nCancelar = combinar con lo actual`
  );
  if (replace) {
    state.entries = imported;
  } else {
    const byId = new Map(state.entries.map((e) => [e.id, e]));
    for (const e of imported) byId.set(e.id, e);
    state.entries = [...byId.values()];
  }
  persist();
  resetForm();
  toast(`Importados ${imported.length} registros`);
}

$('btnExport').onclick = () => exportXlsx().catch(() => toast('No se pudo exportar'));
$('btnImport').onclick = () => $('fileInput').click();
$('fileInput').onchange = async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (f) importXlsx(f).catch(() => toast('No se pudo leer el archivo'));
};

// ---------- misc ----------

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

resetForm();
