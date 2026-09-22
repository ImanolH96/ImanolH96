'use strict';

const STORE_KEY = 'comidas-libres:v1';
const MEALS = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Snack'];
// A full free meal = the three parts; each part counts as 1/3.
const PARTS = [
  ['comida', 'Comida fuera del plan', '🍔'],
  ['alcohol', 'Alcohol', '🍷'],
  ['postre', 'Postre', '🍰'],
];
// Start time of each auto-detected meal; before breakfast counts as dinner (late night).
const DEFAULT_RANGES = { Desayuno: '05:00', Almuerzo: '11:00', Merienda: '15:30', Cena: '19:00' };
// Excel column headers <-> entry fields
const COLUMNS = [
  ['fecha', 'Fecha'],
  ['hora', 'Hora'],
  ['momento', 'Momento'],
  ['descripcion', 'Descripción'],
  ['lugar', 'Dónde / con quién'],
  ['comida', 'Comida fuera del plan'],
  ['alcohol', 'Alcohol'],
  ['postre', 'Postre'],
  ['valor', 'Valor (comidas libres)'],
  ['disfrute', 'Disfrute (1-5)'],
  ['notas', 'Notas'],
  ['id', 'ID'],
];

const $ = (id) => document.getElementById(id);

// ---------- storage ----------

function load() {
  let data = null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) { /* fall through to defaults */ }
  data = data || { settings: { quota: 2, weekStart: 1 }, entries: [] };
  data.settings.ranges = { ...DEFAULT_RANGES, ...data.settings.ranges };
  // Entries from before partial counting were full free meals.
  for (const e of data.entries) {
    if (!e.partes) e.partes = { comida: true, alcohol: true, postre: true };
  }
  return data;
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
let parts = {};
let mealTouched = false; // user picked the meal by hand, stop auto-detecting

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

// ---------- partial counting (in thirds, to avoid float rounding) ----------

const thirdsOf = (e) => PARTS.filter(([k]) => e.partes && e.partes[k]).length;

function fmtThirds(n) {
  const whole = Math.floor(n / 3);
  const frac = ['', '⅓', '⅔'][n % 3];
  if (!whole) return frac || '0';
  return whole + frac;
}

const fmtDay = (s) => parseDate(s).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });

// ---------- render ----------

function renderQuota() {
  const [from, to] = weekBounds();
  const week = state.entries.filter((e) => e.fecha >= from && e.fecha <= to);
  const used = week.reduce((sum, e) => sum + thirdsOf(e), 0); // in thirds
  const quota = (Number(state.settings.quota) || 0) * 3;
  const over = used > quota;
  $('quotaUsed').textContent = fmtThirds(used);
  $('quotaUsed').classList.toggle('over', over);
  $('quotaText').textContent = over
    ? `de ${quota / 3} esta semana — te pasaste por ${fmtThirds(used - quota)}`
    : `de ${quota / 3} esta semana — te quedan ${fmtThirds(quota - used)}`;
  const byPart = PARTS.map(([k, , icon]) => `${icon} ${week.filter((e) => e.partes[k]).length}`).join('  ');
  $('quotaRange').textContent = `${fmtDay(from)} → ${fmtDay(to)} · ${byPart}`;
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
    b.onclick = () => { meal = m; mealTouched = true; renderChips(); };
    $('fMeal').appendChild(b);
  }
}

function renderParts() {
  $('fParts').innerHTML = '';
  for (const [k, label, icon] of PARTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${icon} ${label}`;
    b.className = parts[k] ? 'on' : '';
    b.onclick = () => { parts[k] = !parts[k]; renderParts(); };
    $('fParts').appendChild(b);
  }
  const n = thirdsOf({ partes: parts });
  $('fPartsValue').textContent = n === 3
    ? 'Cuenta como 1 comida libre completa'
    : n ? `Cuenta como ${fmtThirds(n)} de comida libre` : 'Elegí al menos una';
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
    tag.textContent = `${e.momento} · ${fmtThirds(thirdsOf(e))}`;
    const icons = document.createElement('div');
    icons.className = 'meta';
    icons.textContent = PARTS.filter(([k]) => e.partes[k]).map(([, label, icon]) => `${icon} ${label}`).join('  ');
    body.insertBefore(icons, meta.nextSibling);
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
    right.className = 'actions';
    const btns = document.createElement('div');
    btns.append(edit, del);
    right.append(tag, btns);
    li.append(body, right);
    list.appendChild(li);
  }
}

function render() {
  renderQuota();
  renderChips();
  renderParts();
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
  meal = guessMeal(isoTime(now));
  mealTouched = false;
  parts = { comida: true, alcohol: false, postre: false };
  rating = 0;
  $('formTitle').textContent = 'Registrar comida libre';
  $('btnSave').textContent = 'Guardar';
  $('btnCancel').classList.add('hidden');
  render();
}

// time is "HH:MM"; zero-padded strings compare correctly.
function guessMeal(time) {
  const r = state.settings.ranges;
  if (time < r.Desayuno) return 'Cena';
  if (time < r.Almuerzo) return 'Desayuno';
  if (time < r.Merienda) return 'Almuerzo';
  if (time < r.Cena) return 'Merienda';
  return 'Cena';
}

$('fTime').addEventListener('input', () => {
  if (mealTouched || !$('fTime').value) return;
  meal = guessMeal($('fTime').value);
  renderChips();
});

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
  mealTouched = true;
  parts = { ...e.partes };
  rating = e.disfrute || 0;
  $('formTitle').textContent = 'Editar comida libre';
  $('btnSave').textContent = 'Guardar cambios';
  $('btnCancel').classList.remove('hidden');
  render();
  $('formTitle').scrollIntoView({ behavior: 'smooth' });
}

async function remove(id) {
  if (await ask('¿Borrar este registro?', [['Borrar', 'ok', 'danger']]) !== 'ok') return;
  state.entries = state.entries.filter((e) => e.id !== id);
  persist();
  if (editingId === id) resetForm(); else render();
  toast('Registro borrado');
}

$('form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!thirdsOf({ partes: parts })) { toast('Elegí qué incluyó: comida, alcohol o postre'); return; }
  const entry = {
    id: editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    fecha: $('fDate').value,
    hora: $('fTime').value,
    momento: meal,
    partes: { ...parts },
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
  for (const m of Object.keys(DEFAULT_RANGES)) $(`sRange${m}`).value = state.settings.ranges[m];
  if (!s.classList.contains('hidden')) s.scrollIntoView({ behavior: 'smooth' });
};

$('btnSaveSettings').onclick = () => {
  state.settings.quota = Math.max(0, parseInt($('sQuota').value, 10) || 0);
  state.settings.weekStart = Number($('sWeekStart').value);
  const ranges = {};
  for (const m of Object.keys(DEFAULT_RANGES)) ranges[m] = $(`sRange${m}`).value || DEFAULT_RANGES[m];
  const order = Object.values(ranges);
  if (order.some((t, i) => i && t <= order[i - 1])) { toast('Los horarios tienen que ir en orden'); return; }
  state.settings.ranges = ranges;
  persist();
  $('settings').classList.add('hidden');
  render();
  toast('Ajustes guardados');
};

$('btnWipe').onclick = async () => {
  const msg = '¿Borrar TODOS los registros? Exportá un Excel antes si querés conservarlos.';
  if (await ask(msg, [['Borrar todo', 'ok', 'danger']]) !== 'ok') return;
  state.entries = [];
  persist();
  resetForm();
  toast('Datos borrados');
};

// ---------- Excel ----------

async function exportXlsx() {
  const rows = [...state.entries]
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))
    .map((e) => {
      const flat = { ...e, valor: Math.round((thirdsOf(e) / 3) * 100) / 100 };
      for (const [k] of PARTS) flat[k] = e.partes[k] ? 'Sí' : 'No';
      return Object.fromEntries(COLUMNS.map(([k, h]) => [h, flat[k] ?? '']));
    });
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS.map(([, h]) => h) });
  ws['!cols'] = [12, 7, 11, 20, 9, 9, 20, 40, 22, 12, 40, 12].map((wch) => ({ wch }));

  // Weekly summary sheet
  const weeks = {};
  for (const e of state.entries) {
    const [from] = weekBounds(parseDate(e.fecha));
    const w = weeks[from] || (weeks[from] = { thirds: 0, comida: 0, alcohol: 0, postre: 0 });
    w.thirds += thirdsOf(e);
    for (const [k] of PARTS) if (e.partes[k]) w[k]++;
  }
  const round2 = (x) => Math.round(x * 100) / 100;
  const quota = Number(state.settings.quota);
  const summary = Object.keys(weeks).sort().map((w) => ({
    'Semana desde': w,
    'Comidas fuera del plan': weeks[w].comida,
    'Alcohol': weeks[w].alcohol,
    'Postre': weeks[w].postre,
    'Comidas libres': round2(weeks[w].thirds / 3),
    'Permitidas': quota,
    'Diferencia': round2(quota - weeks[w].thirds / 3),
  }));
  const ws2 = XLSX.utils.json_to_sheet(summary, {
    header: ['Semana desde', 'Comidas fuera del plan', 'Alcohol', 'Postre', 'Comidas libres', 'Permitidas', 'Diferencia'],
  });

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

const yes = (v) => /^(s[ií]|si|x|1|true|verdadero)$/i.test(String(v).trim());

function cellsToParts(row) {
  const cols = PARTS.map(([k]) => COLUMNS.find(([c]) => c === k)[1]);
  // Spreadsheets without part columns (older exports) are full free meals.
  if (!cols.some((h) => h in row)) return { comida: true, alcohol: true, postre: true };
  const partes = {};
  PARTS.forEach(([k], i) => { partes[k] = yes(row[cols[i]]); });
  if (!thirdsOf({ partes })) partes.comida = true;
  return partes;
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
      partes: cellsToParts(r),
      descripcion: String(e.descripcion),
      lugar: String(e.lugar || ''),
      disfrute: Math.max(0, Math.min(5, parseInt(e.disfrute, 10) || 0)),
      notas: String(e.notas || ''),
    });
  }
  if (!imported.length) { toast('No encontré filas válidas en el archivo'); return; }
  const choice = await ask(`Encontré ${imported.length} registros en el Excel.`, [
    ['Combinar con lo actual', 'merge'],
    ['Reemplazar todo', 'replace', 'danger'],
  ]);
  if (!choice) return;
  if (choice === 'replace') {
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

// In-page confirmation dialog (native confirm() is unreliable in embedded views).
// actions: [label, value, variant?]; resolves to the chosen value, or null on cancel.
function ask(message, actions) {
  return new Promise((resolve) => {
    const dlg = $('dialog');
    $('dialogMsg').textContent = message;
    const box = $('dialogActions');
    box.innerHTML = '';
    const close = (v) => { dlg.hidden = true; resolve(v); };
    for (const [label, value, variant] of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (variant === 'danger' ? ' danger' : '');
      b.textContent = label;
      b.onclick = () => close(value);
      box.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn secondary';
    cancel.textContent = 'Cancelar';
    cancel.onclick = () => close(null);
    box.appendChild(cancel);
    dlg.hidden = false;
  });
}

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
